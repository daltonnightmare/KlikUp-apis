// src/routes/middlewares/auth.middleware.js
const jwt = require('jsonwebtoken');
const db = require('../../configuration/database');
const TokenService = require('../../services/security/TokenService'); // ✅ Importer TokenService
const { AuthenticationError, AuthorizationError } = require('../../utils/errors/AppError');
const { TOKEN_SECRET, REFRESH_SECRET } = require('../../configuration/env');

class AuthMiddleware {
    constructor(){
        this.authenticate = this.authenticate.bind(this);
        this.optionalAuthenticate = this.optionalAuthenticate.bind(this);
        this.refreshToken = this.refreshToken.bind(this);
        this.logout = this.logout.bind(this);
        // ✅ extractToken n'est plus nécessaire car on utilise TokenService
    }

    /**
     * Vérifie que l'utilisateur est authentifié
     */
    async authenticate(req, res, next) {
        try {
            // ✅ Utiliser TokenService pour extraire le token
            let token = null;
            const authHeader = req.headers.authorization;
            
            if (authHeader) {
                try {
                    token = TokenService.extractBearerToken(authHeader);
                } catch (error) {
                    // Si ce n'est pas un Bearer token, on continue avec les autres méthodes
                }
            }

            // Fallback sur les autres méthodes si pas de token dans le header
            if (!token) {
                token = req.cookies?.token || req.query?.token || null;
            }

            if (!token) {
                throw new AuthenticationError('Token d\'authentification manquant');
            }

            // Vérifier si le token est révoqué
            const tokenHash = TokenService.hashToken(token); // ✅ Utiliser TokenService

            const revoked = await db.query(
                'SELECT id FROM TOKENS_REVOQUES WHERE token_hash = $1',
                [tokenHash]
            );

            if (revoked.rows.length > 0) {
                throw new AuthenticationError('Token révoqué');
            }

            // Vérifier et décoder le token
            const decoded = TokenService.verifyAccessToken(token); // ✅ Utiliser TokenService

            // Vérifier que la session est active
            const session = await db.query(
                `SELECT s.*, c.* 
                 FROM SESSIONS s
                 JOIN COMPTES c ON c.id = s.compte_id
                 WHERE s.session_uuid = $1 
                   AND s.est_active = true 
                   AND s.date_expiration > NOW()
                   AND c.est_supprime = false`,
                [decoded.session_id]
            );

            if (session.rows.length === 0) {
                throw new AuthenticationError('Session expirée ou inactive');
            }

            // Attacher l'utilisateur à la requête
            req.user = session.rows[0];
            req.session = {
                id: decoded.session_id,
                token: token
            };

            // Mettre à jour la dernière activité
            await db.query(
                `UPDATE SESSIONS 
                 SET date_derniere_activite = NOW()
                 WHERE session_uuid = $1`,
                [decoded.session_id]
            );

            next();

        } catch (error) {
            if (error.name === 'JsonWebTokenError') {
                next(new AuthenticationError('Token invalide'));
            } else if (error.name === 'TokenExpiredError') {
                next(new AuthenticationError('Token expiré'));
            } else {
                next(error);
            }
        }
    }

    /**
     * Authentification optionnelle (utilisateur peut être connecté ou non)
     */
    async optionalAuthenticate(req, res, next) {
        try {
            // ✅ Utiliser TokenService
            let token = null;
            const authHeader = req.headers.authorization;
            
            if (authHeader) {
                try {
                    token = TokenService.extractBearerToken(authHeader);
                } catch (error) {
                    // Ignorer
                }
            }

            if (!token) {
                token = req.cookies?.token || req.query?.token || null;
            }
            
            if (token) {
                try {
                    const decoded = TokenService.verifyAccessToken(token);
                    
                    const session = await db.query(
                        `SELECT c.* 
                         FROM SESSIONS s
                         JOIN COMPTES c ON c.id = s.compte_id
                         WHERE s.session_uuid = $1 AND s.est_active = true`,
                        [decoded.session_id]
                    );

                    if (session.rows.length > 0) {
                        req.user = session.rows[0];
                    }
                } catch (error) {
                    // Ignorer les erreurs de token pour l'auth optionnelle
                }
            }
            
            next();
        } catch (error) {
            next(error);
        }
    }

    /**
     * Rafraîchir le token d'accès
     */
    async refreshToken(req, res, next) {
        try {
            const { refresh_token } = req.body;

            if (!refresh_token) {
                throw new AuthenticationError('Refresh token manquant');
            }

            // ✅ Utiliser TokenService pour rafraîchir
            const result = TokenService.refreshAccessToken(refresh_token);

            res.json({
                success: true,
                data: {
                    token: result.accessToken,
                    expires_in: result.expiresIn
                }
            });

        } catch (error) {
            next(new AuthenticationError('Refresh token invalide'));
        }
    }

    /**
     * Invalider la session (logout)
     */
    async logout(req, res, next) {
        try {
            // ✅ Utiliser TokenService
            let token = null;
            const authHeader = req.headers.authorization;
            
            if (authHeader) {
                try {
                    token = TokenService.extractBearerToken(authHeader);
                } catch (error) {
                    // Ignorer
                }
            }

            if (!token) {
                token = req.cookies?.token || req.query?.token || null;
            }
            
            if (token) {
                const tokenHash = TokenService.hashToken(token); // ✅ Utiliser TokenService

                // Révoquer le token
                await db.query(
                    `INSERT INTO TOKENS_REVOQUES (token_hash, compte_id, date_expiration)
                     VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
                    [tokenHash, req.user?.id]
                );

                // Désactiver la session
                if (req.session?.id) {
                    await db.query(
                        `UPDATE SESSIONS 
                         SET est_active = false,
                             date_revocation = NOW(),
                             motif_revocation = 'LOGOUT'
                         WHERE session_uuid = $1`,
                        [req.session.id]
                    );
                }

                // Journaliser la déconnexion
                if (req.user?.id) {
                    await db.query(
                        `INSERT INTO HISTORIQUE_CONNEXIONS 
                         (compte_id, type_connexion, adresse_ip, utilisateur_agent, statut_connexion)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [req.user.id, 'DECONNEXION', req.ip, req.get('User-Agent'), 'SUCCESS']
                    );
                }
            }

            res.json({
                success: true,
                message: 'Déconnexion réussie'
            });

        } catch (error) {
            next(error);
        }
    }

    // ✅ La méthode extractToken n'est plus nécessaire
    // extractToken(req) { ... }
}

module.exports = new AuthMiddleware();