// src/routes/middlewares/auth.middleware.js
const jwt = require('jsonwebtoken');
const db = require('../../configuration/database');
const { AuthenticationError, AuthorizationError } = require('../../utils/errors/AppError');
const { TOKEN_SECRET, REFRESH_SECRET } = require('../../configuration/env');

class AuthMiddleware {
    /**
     * Vérifie que l'utilisateur est authentifié
     */
    async authenticate(req, res, next) {
        try {
            const token = this.extractToken(req);

            if (!token) {
                throw new AuthenticationError('Token d\'authentification manquant');
            }

            // Vérifier si le token est révoqué
            const tokenHash = require('crypto')
                .createHash('sha256')
                .update(token)
                .digest('hex');

            const revoked = await db.query(
                'SELECT id FROM TOKENS_REVOQUES WHERE token_hash = $1',
                [tokenHash]
            );

            if (revoked.rows.length > 0) {
                throw new AuthenticationError('Token révoqué');
            }

            // Vérifier et décoder le token
            const decoded = jwt.verify(token, TOKEN_SECRET);

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
            const token = this.extractToken(req);
            
            if (token) {
                const decoded = jwt.verify(token, TOKEN_SECRET, { ignoreExpiration: false });
                
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
            }
            
            next();
        } catch (error) {
            // Ignorer les erreurs d'authentification
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

            const decoded = jwt.verify(refresh_token, REFRESH_SECRET);

            const session = await db.query(
                `SELECT * FROM SESSIONS 
                 WHERE session_uuid = $1 
                   AND est_active = true 
                   AND date_refresh_expiration > NOW()`,
                [decoded.session_id]
            );

            if (session.rows.length === 0) {
                throw new AuthenticationError('Session invalide ou expirée');
            }

            // Générer un nouveau token d'accès
            const newToken = jwt.sign(
                { 
                    user_id: session.rows[0].compte_id,
                    session_id: decoded.session_id,
                    role: session.rows[0].compte_role
                },
                TOKEN_SECRET,
                { expiresIn: '24h' }
            );

            res.json({
                success: true,
                data: {
                    token: newToken,
                    expires_in: 86400
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
            const token = this.extractToken(req);
            
            if (token) {
                const tokenHash = require('crypto')
                    .createHash('sha256')
                    .update(token)
                    .digest('hex');

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
            }

            res.json({
                success: true,
                message: 'Déconnexion réussie'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Extraire le token de la requête
     */
    extractToken(req) {
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            return req.headers.authorization.substring(7);
        }
        
        if (req.cookies && req.cookies.token) {
            return req.cookies.token;
        }
        
        if (req.query && req.query.token) {
            return req.query.token;
        }
        
        return null;
    }
}

module.exports = new AuthMiddleware();