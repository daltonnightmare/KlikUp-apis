// src/controllers/comptes/VerificationController.js
const pool = require('../../configuration/database');
const bcrypt = require('bcrypt');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const EmailService = require('../../services/email/EmailService');
const SmsService = require('../../services/sms/SmsService');
const AuditService = require('../../services/audit/AuditService');
const { logInfo, logError } = require('../../configuration/logger');
 
class VerificationController {
    /**
     * Vérifier le code d'authentification
     * @route POST /api/v1/verifier-code
     * @access PUBLIC
     */
    async verifierCode(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { email, code } = req.body;

            const result = await client.query(
                `SELECT id, code_authentification, code_authentification_expiration 
                 FROM COMPTES 
                 WHERE email = $1 AND est_supprime = false`,
                [email.toLowerCase()]
            );

            if (result.rows.length === 0) {
                throw new AppError('Compte non trouvé', 404);
            }

            const compte = result.rows[0];

            // Vérification expiration
            if (new Date() > new Date(compte.code_authentification_expiration)) {
                throw new ValidationError('Code expiré');
            }

            // Vérification code
            if (compte.code_authentification !== code) {
                throw new ValidationError('Code incorrect');
            }

            // Mise à jour statut
            await client.query(
                `UPDATE COMPTES 
                 SET statut = 'EST_AUTHENTIFIE',
                     code_authentification = NULL,
                     code_authentification_expiration = NULL,
                     date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [compte.id]
            );

            await client.query('COMMIT');

            logInfo(`Compte ${compte.id} vérifié avec succès`);

            res.json({
                status: 'success',
                message: 'Compte vérifié avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur vérification code:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Renvoyer un code de vérification
     * @route POST /api/v1/renvoyer-code
     * @access PUBLIC
     */
    async renvoyerCode(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { email } = req.body;

            const result = await client.query(
                `SELECT id, nom_utilisateur_compte, numero_de_telephone 
                 FROM COMPTES 
                 WHERE email = $1 AND est_supprime = false`,
                [email.toLowerCase()]
            );

            if (result.rows.length === 0) {
                throw new AppError('Compte non trouvé', 404);
            }

            const compte = result.rows[0];

            // Génération nouveau code
            const nouveauCode = Math.floor(100000 + Math.random() * 900000).toString();
            const expiration = new Date(Date.now() + 15 * 60 * 1000);

            await client.query(
                `UPDATE COMPTES 
                 SET code_authentification = $1,
                     code_authentification_expiration = $2,
                     date_mise_a_jour = NOW()
                 WHERE id = $3`,
                [nouveauCode, expiration, compte.id]
            );

            // Envoi du code
            await EmailService.sendTemplate('verification-code', email, {
                nom: compte.nom_utilisateur_compte,
                code: nouveauCode,
                validite: '15 minutes'
            });

            if (compte.numero_de_telephone) {
                await SmsService.send(compte.numero_de_telephone,
                    `Votre nouveau code de vérification est: ${nouveauCode}`
                );
            }

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: 'Nouveau code envoyé'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur renvoi code:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Activer la 2FA
     * @route POST /api/v1/2fa/activer
     * @access PRIVATE
     */
    async activer2FA(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.user;

            // Génération secret
            const secret = speakeasy.generateSecret({
                name: `MonProjet:${req.user.email}`
            });

            // Sauvegarde temporaire
            await client.query(
                `UPDATE COMPTES 
                 SET two_factor_temp_secret = $1,
                     date_mise_a_jour = NOW()
                 WHERE id = $2`,
                [secret.base32, id]
            );

            // Génération QR code
            const qrCode = await QRCode.toDataURL(secret.otpauth_url);

            await client.query('COMMIT');

            res.json({
                status: 'success',
                data: {
                    secret: secret.base32,
                    qr_code: qrCode
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur activation 2FA:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Valider et activer la 2FA
     * @route POST /api/v1/2fa/valider
     * @access PRIVATE
     */
    async valider2FA(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.user;
            const { token } = req.body;

            // Récupération secret temporaire
            const result = await client.query(
                'SELECT two_factor_temp_secret FROM COMPTES WHERE id = $1',
                [id]
            );

            if (!result.rows[0]?.two_factor_temp_secret) {
                throw new AppError('Aucune activation 2FA en cours', 400);
            }

            // Vérification token
            const verified = speakeasy.totp.verify({
                secret: result.rows[0].two_factor_temp_secret,
                encoding: 'base32',
                token
            });

            if (!verified) {
                throw new ValidationError('Code invalide');
            }

            // Activation permanente
            await client.query(
                `UPDATE COMPTES 
                 SET two_factor_secret = two_factor_temp_secret,
                     two_factor_temp_secret = NULL,
                     two_factor_actif = true,
                     date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [id]
            );

            // Codes de secours
            const backupCodes = await this._genererCodesSecours();
            await client.query(
                `UPDATE COMPTES 
                 SET two_factor_backup_codes = $1
                 WHERE id = $2`,
                [JSON.stringify(backupCodes), id]
            );

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: '2FA activée avec succès',
                data: { backup_codes: backupCodes }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur validation 2FA:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Désactiver la 2FA
     * @route POST /api/v1/2fa/desactiver
     * @access PRIVATE
     */
    async desactiver2FA(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.user;
            const { mot_de_passe } = req.body;

            // Vérification mot de passe
            const result = await client.query(
                'SELECT mot_de_passe_compte FROM COMPTES WHERE id = $1',
                [id]
            );

            const motDePasseValide = await bcrypt.compare(
                mot_de_passe,
                result.rows[0].mot_de_passe_compte
            );

            if (!motDePasseValide) {
                throw new ValidationError('Mot de passe incorrect');
            }

            // Désactivation
            await client.query(
                `UPDATE COMPTES 
                 SET two_factor_secret = NULL,
                     two_factor_temp_secret = NULL,
                     two_factor_actif = false,
                     two_factor_backup_codes = NULL,
                     date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [id]
            );

            await client.query('COMMIT');

            // Notification
            await EmailService.sendTemplate('2fa-desactivee', req.user.email, {
                date: new Date().toLocaleString('fr-FR')
            });

            res.json({
                status: 'success',
                message: '2FA désactivée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur désactivation 2FA:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Vérifier 2FA pendant login
     * @route POST /api/v1/2fa/verifier
     * @access PUBLIC
     */
    async verifier2FA(req, res, next) {
        try {
            const { userId, token, backupCode } = req.body;

            const result = await pool.query(
                `SELECT two_factor_secret, two_factor_backup_codes 
                 FROM COMPTES 
                 WHERE id = $1`,
                [userId]
            );

            if (result.rows.length === 0) {
                throw new AppError('Utilisateur non trouvé', 404);
            }

            const { two_factor_secret, two_factor_backup_codes } = result.rows[0];

            // Vérification token standard
            if (token) {
                const verified = speakeasy.totp.verify({
                    secret: two_factor_secret,
                    encoding: 'base32',
                    token,
                    window: 2
                });

                if (verified) {
                    return res.json({
                        status: 'success',
                        verified: true
                    });
                }
            }

            // Vérification code de secours
            if (backupCode && two_factor_backup_codes) {
                const codes = two_factor_backup_codes;
                const index = codes.indexOf(backupCode);

                if (index !== -1) {
                    // Supprimer le code utilisé
                    codes.splice(index, 1);
                    await pool.query(
                        `UPDATE COMPTES 
                         SET two_factor_backup_codes = $1
                         WHERE id = $2`,
                        [JSON.stringify(codes), userId]
                    );

                    return res.json({
                        status: 'success',
                        verified: true,
                        backup_used: true,
                        remaining_codes: codes.length
                    });
                }
            }

            throw new ValidationError('Code 2FA invalide');

        } catch (error) {
            logError('Erreur vérification 2FA:', error);
            next(error);
        }
    }

    /**
     * Vérifier l'email
     * @route GET /api/v1/verifier-email/:token
     * @access PUBLIC
     */
    async verifierEmail(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { token } = req.params;

            // Vérification token
            const result = await client.query(
                `SELECT compte_id FROM EMAIL_VERIFICATIONS 
                 WHERE token = $1 AND expire_le > NOW()`,
                [token]
            );

            if (result.rows.length === 0) {
                throw new AppError('Lien de vérification invalide ou expiré', 400);
            }

            const compteId = result.rows[0].compte_id;

            // Marquer email comme vérifié
            await client.query(
                `UPDATE COMPTES 
                 SET email_verifie = true,
                     date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [compteId]
            );

            // Supprimer le token
            await client.query(
                'DELETE FROM EMAIL_VERIFICATIONS WHERE token = $1',
                [token]
            );

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: 'Email vérifié avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur vérification email:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Vérifier le numéro de téléphone
     * @route POST /api/v1/verifier-telephone
     * @access PRIVATE
     */
    async verifierTelephone(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.user;
            const { code } = req.body;

            const result = await client.query(
                `SELECT telephone_verification_code 
                 FROM COMPTES 
                 WHERE id = $1`,
                [id]
            );

            if (result.rows[0]?.telephone_verification_code !== code) {
                throw new ValidationError('Code incorrect');
            }

            await client.query(
                `UPDATE COMPTES 
                 SET telephone_verifie = true,
                     telephone_verification_code = NULL,
                     date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [id]
            );

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: 'Téléphone vérifié avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur vérification téléphone:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    // ==================== MÉTHODES PRIVÉES ====================

    /**
     * Générer des codes de secours
     */
    async _genererCodesSecours() {
        const codes = [];
        for (let i = 0; i < 8; i++) {
            const code = Math.random().toString(36).substring(2, 10).toUpperCase();
            codes.push(code);
        }
        return codes;
    }
}

module.exports = new VerificationController();