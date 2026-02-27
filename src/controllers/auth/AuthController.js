console.log('🚀 Début chargement AuthController');

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const db = require('../../configuration/database');
const crypto = require('crypto');

const { 
    AppError,
    AuthenticationError,
    BadRequestError, 
    UnauthorizedError, 
    NotFoundError,
    catchAsync 
} = require('../../utils/errors/AuthControllerError');

const TokenService = require('../../services/security/TokenService');
const AuditService = require('../../services/audit/AuditService');
const EmailService = require('../../services/email/EmailService');
const SmsService = require('../../services/sms/SmsService');
const { ENUM_COMPTE_ROLE, ENUM_STATUT_COMPTE, ENUM_TYPES_CONNEXION, ENUM_STATUTS_CONNEXION } = require('../../utils/constants/enums');

class AuthController {
    /**
     * Inscription d'un nouvel utilisateur
     * POST /api/v1/auth/register
     */
    static async register(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { email, mot_de_passe, nom_utilisateur, numero_de_telephone, ...autresDonnees } = req.body;

            // Vérifier si l'utilisateur existe déjà
            const existingUser = await client.query(
                `SELECT id FROM COMPTES WHERE email = $1 OR nom_utilisateur_compte = $2 OR numero_de_telephone = $3`,
                [email, nom_utilisateur, numero_de_telephone]
            );

            if (existingUser.rows.length > 0) {
                throw new AppError('Un compte avec ces informations existe déjà', 409);
            }

            // Hacher le mot de passe
            const saltRounds = 10;
            const motDePasseHash = await bcrypt.hash(mot_de_passe, saltRounds);

            // Générer code d'authentification
            const codeAuth = Math.floor(100000 + Math.random() * 900000).toString();
            const codeExpiration = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

            // Insérer le nouveau compte
            const result = await client.query(
                `INSERT INTO COMPTES (
                    email, mot_de_passe_compte, nom_utilisateur_compte, 
                    numero_de_telephone, code_authentification, 
                    code_authentification_expiration, compte_role, statut,
                    photo_profil_compte, date_creation, date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
                RETURNING id, email, nom_utilisateur_compte, compte_role, statut`,
                [email, motDePasseHash, nom_utilisateur, numero_de_telephone, 
                 codeAuth, codeExpiration, 'UTILISATEUR_PRIVE_SIMPLE', 'NON_AUTHENTIFIE',
                 autresDonnees.photo_profil || null]
            );

            const newUser = result.rows[0];

            // Envoyer code de vérification par SMS
            await SmsService.sendVerificationCode(numero_de_telephone, codeAuth);

            // Envoyer email de bienvenue
            await EmailService.sendWelcomeEmail(email, nom_utilisateur);

            // Journaliser l'action
            await AuditService.log({
                action: 'REGISTER',
                ressource_type: 'COMPTES',
                ressource_id: newUser.id,
                donnees_apres: newUser,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent')
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Inscription réussie. Un code de vérification vous a été envoyé par SMS.',
                data: {
                    utilisateur: newUser,
                    requires_verification: true
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Connexion utilisateur
     * POST /api/v1/auth/login
     */
    static async login(req, res, next) {
        const client = await db.getClient();
        try {
            const { email, mot_de_passe } = req.body;

            // Récupérer l'utilisateur avec son mot de passe
            const result = await client.query(
                `SELECT id, email, mot_de_passe_compte, nom_utilisateur_compte, 
                        compte_role, statut, tentatives_echec_connexion, 
                        date_verouillage, numero_de_telephone
                 FROM COMPTES 
                 WHERE email = $1 AND est_supprime = false`,
                [email]
            );

            if (result.rows.length === 0) {
                throw new AuthenticationError('Email ou mot de passe incorrect');
            }

            const user = result.rows[0];

            // Vérifier si le compte est verrouillé
            if (user.statut === 'SUSPENDU' || user.statut === 'BANNI') {
                throw new AuthenticationError('Votre compte est suspendu. Contactez le support.');
            }

            if (user.date_verouillage && user.date_verouillage > new Date()) {
                throw new AuthenticationError('Compte temporairement verrouillé. Réessayez plus tard.');
            }

            // Vérifier le mot de passe
            const validPassword = await bcrypt.compare(mot_de_passe, user.mot_de_passe_compte);
            
            if (!validPassword) {
                // Incrémenter les tentatives échouées
                await client.query(
                    `UPDATE COMPTES 
                     SET tentatives_echec_connexion = tentatives_echec_connexion + 1
                     WHERE id = $1`,
                    [user.id]
                );

                // Journaliser la tentative échouée
                await client.query(
                    `INSERT INTO HISTORIQUE_CONNEXIONS 
                     (compte_id, type_connexion, adresse_ip, utilisateur_agent, statut_connexion)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [user.id, 'CONNEXION', req.ip, req.get('User-Agent'), 'FAILED']
                );

                throw new AuthenticationError('Email ou mot de passe incorrect');
            }

            // Réinitialiser les tentatives échouées
            await client.query(
                `UPDATE COMPTES 
                 SET tentatives_echec_connexion = 0, date_derniere_connexion = NOW()
                 WHERE id = $1`,
                [user.id]
            );

            // Générer tokens
            const accessToken = TokenService.generateAccessToken({
                id: user.id,
                email: user.email,
                role: user.compte_role,
                nom: user.nom_utilisateur_compte
            });

            const refreshToken = TokenService.generateRefreshToken({
                id: user.id,
                type: 'refresh',
                sessionId: crypto.randomUUID()
            });

            // Hasher le refresh token pour stockage
            const refreshTokenHash = TokenService.hashToken(refreshToken);

            // Créer la session
            const sessionResult = await client.query(
                `INSERT INTO SESSIONS 
                 (compte_id, token_hash, refresh_token_hash, adresse_ip, user_agent, plateforme)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING session_uuid, date_expiration`,
                [user.id, 
                 TokenService.hashToken(accessToken), 
                 refreshTokenHash,
                 req.ip, 
                 req.get('User-Agent'),
                 req.headers['x-platform'] || 'WEB']
            );

            // Journaliser la connexion réussie
            await client.query(
                `INSERT INTO HISTORIQUE_CONNEXIONS 
                 (compte_id, type_connexion, adresse_ip, utilisateur_agent, statut_connexion)
                 VALUES ($1, $2, $3, $4, $5)`,
                [user.id, 'CONNEXION', req.ip, req.get('User-Agent'), 'SUCCESS']
            );

            // Journaliser l'action
            await AuditService.log({
                action: 'LOGIN',
                ressource_type: 'COMPTES',
                ressource_id: user.id,
                donnees_avant: null,
                donnees_apres: { statut: 'CONNECTE' },
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: sessionResult.rows[0].session_uuid
            });

            res.json({
                success: true,
                message: 'Connexion réussie',
                data: {
                    utilisateur: {
                        id: user.id,
                        email: user.email,
                        nom: user.nom_utilisateur_compte,
                        role: user.compte_role,
                        telephone: user.numero_de_telephone
                    },
                    tokens: {
                        access_token: accessToken,
                        refresh_token: refreshToken,
                        expires_in: sessionResult.rows[0].date_expiration
                    }
                }
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Rafraîchir le token d'accès
     * POST /api/v1/auth/refresh-token
     */

    static async refreshToken(req, res, next) {
        const client = await db.getClient();
        try {
            const { refresh_token } = req.body;

            if (!refresh_token) {
                throw new AuthenticationError('Refresh token requis');
            }

            const refreshTokenHash = TokenService.hashToken(refresh_token);

            // Vérifier la session avec ce refresh token
            const sessionResult = await client.query(
                `SELECT s.*, c.email, c.compte_role, c.nom_utilisateur_compte
                 FROM SESSIONS s
                 JOIN COMPTES c ON c.id = s.compte_id
                 WHERE s.refresh_token_hash = $1 
                   AND s.est_active = true 
                   AND s.date_refresh_expiration > NOW()`,
                [refreshTokenHash]
            );

            if (sessionResult.rows.length === 0) {
                throw new AuthenticationError('Refresh token invalide ou expiré');
            }

            const session = sessionResult.rows[0];

            // Générer nouveau access token
            const newAccessToken = TokenService.generateAccessToken({
                id: session.compte_id,
                email: session.email,
                role: session.compte_role,
                nom: session.nom_utilisateur_compte
            });

            const newAccessTokenHash = TokenService.hashToken(newAccessToken);

            // Mettre à jour la session
            await client.query(
                `UPDATE SESSIONS 
                 SET token_hash = $1, date_derniere_activite = NOW()
                 WHERE id = $2`,
                [newAccessTokenHash, session.id]
            );

            res.json({
                success: true,
                data: {
                    access_token: newAccessToken,
                    expires_in: session.date_expiration
                }
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Déconnexion
     * POST /api/v1/auth/logout
     */
    static async logout(req, res, next) {
        const client = await db.getClient();
        try {
            const token = req.headers.authorization?.split(' ')[1];
            
            if (token) {
                const tokenHash = TokenService.hashToken(token);

                // Désactiver la session
                const result = await client.query(
                    `UPDATE SESSIONS 
                     SET est_active = false, date_revocation = NOW(), motif_revocation = 'LOGOUT'
                     WHERE token_hash = $1 AND est_active = true
                     RETURNING compte_id, session_uuid`,
                    [tokenHash]
                );

                if (result.rows.length > 0) {
                    // Journaliser la déconnexion
                    await client.query(
                        `INSERT INTO HISTORIQUE_CONNEXIONS 
                         (compte_id, type_connexion, adresse_ip, utilisateur_agent, statut_connexion)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [result.rows[0].compte_id, 'DECONNEXION', req.ip, req.get('User-Agent'), 'SUCCESS']
                    );

                    // Ajouter le token à la liste noire
                    await client.query(
                        `INSERT INTO TOKENS_REVOQUES (token_hash, compte_id, motif, date_expiration)
                         VALUES ($1, $2, $3, $4)`,
                        [tokenHash, result.rows[0].compte_id, 'LOGOUT', new Date(Date.now() + 24 * 60 * 60 * 1000)]
                    );
                }
            }

            res.json({
                success: true,
                message: 'Déconnexion réussie'
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Vérification du code 2FA
     * POST /api/v1/auth/verify
     */
    static async verifyCode(req, res, next) {
        const client = await db.getClient();
        try {
            const { email, code } = req.body;

            const result = await client.query(
                `SELECT id, code_authentification, code_authentification_expiration, statut
                 FROM COMPTES 
                 WHERE email = $1 AND est_supprime = false`,
                [email]
            );

            if (result.rows.length === 0) {
                throw new AppError('Utilisateur non trouvé', 404);
            }

            const user = result.rows[0];

            // Vérifier le code
            if (user.code_authentification !== code) {
                throw new AppError('Code de vérification invalide', 400);
            }

            if (new Date() > user.code_authentification_expiration) {
                throw new AppError('Code de vérification expiré', 400);
            }

            // Mettre à jour le statut du compte
            await client.query(
                `UPDATE COMPTES 
                 SET statut = $1, code_authentification = NULL, 
                     code_authentification_expiration = NULL, date_mise_a_jour = NOW()
                 WHERE id = $2`,
                ['EST_AUTHENTIFIE', user.id]
            );

            res.json({
                success: true,
                message: 'Compte vérifié avec succès'
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Renvoyer le code de vérification
     * POST /api/v1/auth/resend-code
     */
    static async resendVerificationCode(req, res, next) {
        const client = await db.getClient();
        try {
            const { email, telephone } = req.body;

            if (!email && !telephone) {
                throw new AppError('Email ou téléphone requis', 400);
            }

            let query;
            let params;

            if (email) {
                query = `SELECT id, numero_de_telephone FROM COMPTES WHERE email = $1 AND est_supprime = false`;
                params = [email];
            } else {
                query = `SELECT id, email, numero_de_telephone FROM COMPTES WHERE numero_de_telephone = $1 AND est_supprime = false`;
                params = [telephone];
            }

            const result = await client.query(query, params);

            if (result.rows.length === 0) {
                throw new AppError('Utilisateur non trouvé', 404);
            }

            const user = result.rows[0];

            // Générer nouveau code
            const codeAuth = Math.floor(100000 + Math.random() * 900000).toString();
            const codeExpiration = new Date(Date.now() + 15 * 60 * 1000);

            await client.query(
                `UPDATE COMPTES 
                 SET code_authentification = $1, code_authentification_expiration = $2
                 WHERE id = $3`,
                [codeAuth, codeExpiration, user.id]
            );

            // Envoyer le code par SMS
            await SmsService.sendVerificationCode(user.numero_de_telephone, codeAuth);

            res.json({
                success: true,
                message: 'Nouveau code de vérification envoyé'
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }
}

module.exports = AuthController;