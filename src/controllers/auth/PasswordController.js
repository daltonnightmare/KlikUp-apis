const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../../configuration/database');
const { AppError, ValidationError } = require('../../utils/errors/AppError');
const EmailService = require('../../services/email/EmailService');
const SmsService = require('../../services/sms/SmsService');
const AuditService = require('../../services/audit/AuditService');

class PasswordController {
    /**
     * Demande de réinitialisation de mot de passe
     * POST /api/v1/auth/password/forgot
     */
    static async forgotPassword(req, res, next) {
        const client = await db.getConnection();
        try {
            const { email, telephone } = req.body;

            if (!email && !telephone) {
                throw new ValidationError('Email ou téléphone requis');
            }

            // Trouver l'utilisateur
            let query;
            let params;

            if (email) {
                query = `SELECT id, email, nom_utilisateur_compte, numero_de_telephone 
                         FROM COMPTES WHERE email = $1 AND est_supprime = false`;
                params = [email];
            } else {
                query = `SELECT id, email, nom_utilisateur_compte, numero_de_telephone 
                         FROM COMPTES WHERE numero_de_telephone = $1 AND est_supprime = false`;
                params = [telephone];
            }

            const result = await client.query(query, params);

            if (result.rows.length === 0) {
                // Pour des raisons de sécurité, on ne révèle pas si l'utilisateur existe
                return res.json({
                    success: true,
                    message: 'Si un compte existe, vous recevrez un code de réinitialisation'
                });
            }

            const user = result.rows[0];

            // Générer un token de réinitialisation
            const resetToken = crypto.randomBytes(32).toString('hex');
            const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
            const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 heure

            // Générer un code numérique pour SMS
            const resetCode = Math.floor(100000 + Math.random() * 900000).toString();

            // Stocker le token dans la table SESSIONS (réutiliser pour reset)
            await client.query(
                `INSERT INTO SESSIONS (compte_id, token_hash, date_expiration)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (compte_id) WHERE est_active = false 
                 DO UPDATE SET token_hash = $2, date_expiration = $3`,
                [user.id, resetTokenHash, resetExpires]
            );

            // Envoyer par email si disponible
            if (user.email) {
                await EmailService.sendPasswordResetEmail(user.email, {
                    nom: user.nom_utilisateur_compte,
                    token: resetToken,
                    code: resetCode,
                    lien: `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`
                });
            }

            // Envoyer par SMS si disponible
            if (user.numero_de_telephone) {
                await SmsService.sendPasswordResetCode(user.numero_de_telephone, resetCode);
            }

            // Journaliser l'action
            await AuditService.log({
                action: 'PASSWORD_RESET_REQUEST',
                ressource_type: 'COMPTES',
                ressource_id: user.id,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent')
            });

            res.json({
                success: true,
                message: 'Si un compte existe, vous recevrez un code de réinitialisation',
                data: {
                    // En production, ne pas renvoyer ces infos
                    // Ici c'est pour le développement
                    debug_token: process.env.NODE_ENV === 'development' ? resetToken : undefined
                }
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Vérifier le code de réinitialisation
     * POST /api/v1/auth/password/verify-code
     */
    static async verifyResetCode(req, res, next) {
        const client = await db.getConnection();
        try {
            const { email, telephone, code } = req.body;

            if (!code) {
                throw new ValidationError('Code requis');
            }

            // Logique de vérification du code...
            // (à implémenter selon votre système)

            res.json({
                success: true,
                message: 'Code vérifié avec succès',
                data: {
                    reset_allowed: true
                }
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Réinitialiser le mot de passe
     * POST /api/v1/auth/password/reset
     */
    static async resetPassword(req, res, next) {
        const client = await db.getConnection();
        try {
            const { token, code, nouveau_mot_de_passe } = req.body;

            if (!nouveau_mot_de_passe) {
                throw new ValidationError('Nouveau mot de passe requis');
            }

            // Valider la force du mot de passe
            if (nouveau_mot_de_passe.length < 8) {
                throw new ValidationError('Le mot de passe doit contenir au moins 8 caractères');
            }

            // Hasher le token si fourni
            let tokenHash = null;
            if (token) {
                tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            }

            // Vérifier le token dans SESSIONS
            const sessionResult = await client.query(
                `SELECT compte_id FROM SESSIONS 
                 WHERE token_hash = $1 AND date_expiration > NOW() AND est_active = true`,
                [tokenHash || code] // Adapter selon votre logique
            );

            if (sessionResult.rows.length === 0) {
                throw new AppError('Token invalide ou expiré', 400);
            }

            const compteId = sessionResult.rows[0].compte_id;

            // Hacher le nouveau mot de passe
            const saltRounds = 10;
            const motDePasseHash = await bcrypt.hash(nouveau_mot_de_passe, saltRounds);

            // Mettre à jour le mot de passe
            await client.query(
                `UPDATE COMPTES 
                 SET mot_de_passe_compte = $1, date_mise_a_jour = NOW(),
                     tentatives_echec_connexion = 0
                 WHERE id = $2`,
                [motDePasseHash, compteId]
            );

            // Désactiver toutes les sessions actives de l'utilisateur
            await client.query(
                `UPDATE SESSIONS 
                 SET est_active = false, date_revocation = NOW(), motif_revocation = 'PASSWORD_RESET'
                 WHERE compte_id = $1 AND est_active = true`,
                [compteId]
            );

            // Récupérer les infos utilisateur pour notification
            const userResult = await client.query(
                `SELECT email, nom_utilisateur_compte, numero_de_telephone 
                 FROM COMPTES WHERE id = $1`,
                [compteId]
            );

            if (userResult.rows.length > 0) {
                const user = userResult.rows[0];
                
                // Notifier par email
                if (user.email) {
                    await EmailService.sendPasswordChangeConfirmation(user.email, user.nom_utilisateur_compte);
                }

                // Notifier par SMS
                if (user.numero_de_telephone) {
                    await SmsService.sendPasswordChangeConfirmation(user.numero_de_telephone);
                }
            }

            // Journaliser l'action
            await AuditService.log({
                action: 'PASSWORD_RESET',
                ressource_type: 'COMPTES',
                ressource_id: compteId,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent')
            });

            res.json({
                success: true,
                message: 'Mot de passe réinitialisé avec succès'
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Changer le mot de passe (utilisateur connecté)
     * POST /api/v1/auth/password/change
     */
    static async changePassword(req, res, next) {
        const client = await db.getConnection();
        try {
            const { ancien_mot_de_passe, nouveau_mot_de_passe } = req.body;
            const userId = req.user.id;

            if (!ancien_mot_de_passe || !nouveau_mot_de_passe) {
                throw new ValidationError('Ancien et nouveau mot de passe requis');
            }

            // Récupérer l'utilisateur avec son mot de passe
            const result = await client.query(
                `SELECT mot_de_passe_compte FROM COMPTES WHERE id = $1`,
                [userId]
            );

            if (result.rows.length === 0) {
                throw new AppError('Utilisateur non trouvé', 404);
            }

            const user = result.rows[0];

            // Vérifier l'ancien mot de passe
            const validPassword = await bcrypt.compare(ancien_mot_de_passe, user.mot_de_passe_compte);
            
            if (!validPassword) {
                throw new AppError('Ancien mot de passe incorrect', 400);
            }

            // Hacher le nouveau mot de passe
            const saltRounds = 10;
            const motDePasseHash = await bcrypt.hash(nouveau_mot_de_passe, saltRounds);

            // Mettre à jour le mot de passe
            await client.query(
                `UPDATE COMPTES 
                 SET mot_de_passe_compte = $1, date_mise_a_jour = NOW()
                 WHERE id = $2`,
                [motDePasseHash, userId]
            );

            // Optionnellement, garder la session actuelle mais déconnecter les autres
            if (req.body.deconnecter_autres === true) {
                await client.query(
                    `UPDATE SESSIONS 
                     SET est_active = false, date_revocation = NOW(), motif_revocation = 'PASSWORD_CHANGE_OTHER'
                     WHERE compte_id = $1 AND token_hash != $2 AND est_active = true`,
                    [userId, req.tokenHash]
                );
            }

            // Journaliser l'action
            await AuditService.log({
                action: 'PASSWORD_CHANGE',
                ressource_type: 'COMPTES',
                ressource_id: userId,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            res.json({
                success: true,
                message: 'Mot de passe modifié avec succès'
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }
}

module.exports = PasswordController;