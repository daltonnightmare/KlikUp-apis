// src/controllers/notification/PushTokenController.js
const db = require('../../configuration/database');
const { ValidationError } = require('../../utils/errors/AppError');
const PushService = require('../../services/push/PushService');

class PushTokenController {
    /**
     * Enregistrer un token push
     * @route POST /api/v1/notifications/tokens-push
     */
    async registerToken(req, res, next) {
        try {
            const { token, plateforme } = req.body;

            if (!token) {
                throw new ValidationError('Token requis');
            }

            if (!['IOS', 'ANDROID', 'WEB'].includes(plateforme)) {
                throw new ValidationError('Plateforme invalide');
            }

            // Désactiver les anciens tokens du même appareil
            await db.query(
                `UPDATE TOKENS_PUSH 
                 SET est_actif = false
                 WHERE compte_id = $1 AND token = $2`,
                [req.user.id, token]
            );

            // Enregistrer le nouveau token
            const result = await db.query(
                `INSERT INTO TOKENS_PUSH (compte_id, token, plateforme, est_actif)
                 VALUES ($1, $2, $3, true)
                 ON CONFLICT (token) 
                 DO UPDATE SET 
                    compte_id = EXCLUDED.compte_id,
                    plateforme = EXCLUDED.plateforme,
                    est_actif = true,
                    date_derniere_utilisation = NOW()
                 RETURNING *`,
                [req.user.id, token, plateforme]
            );

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message: 'Token push enregistré'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Désenregistrer un token push
     * @route DELETE /api/v1/notifications/tokens-push/:token
     */
    async unregisterToken(req, res, next) {
        try {
            const { token } = req.params;

            const result = await db.query(
                `UPDATE TOKENS_PUSH 
                 SET est_actif = false
                 WHERE compte_id = $1 AND token = $2
                 RETURNING id`,
                [req.user.id, token]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Token non trouvé'
                });
            }

            res.json({
                success: true,
                message: 'Token désenregistré'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les tokens actifs de l'utilisateur
     * @route GET /api/v1/notifications/tokens-push
     */
    async getMyTokens(req, res, next) {
        try {
            const result = await db.query(
                `SELECT id, token, plateforme, date_enregistrement, date_derniere_utilisation
                 FROM TOKENS_PUSH
                 WHERE compte_id = $1 AND est_actif = true
                 ORDER BY date_derniere_utilisation DESC NULLS LAST`,
                [req.user.id]
            );

            res.json({
                success: true,
                data: result.rows
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Mettre à jour la date de dernière utilisation d'un token
     * @route POST /api/v1/notifications/tokens-push/:token/utilisation
     */
    async updateLastUsed(req, res, next) {
        try {
            const { token } = req.params;

            await db.query(
                `UPDATE TOKENS_PUSH 
                 SET date_derniere_utilisation = NOW()
                 WHERE token = $1 AND compte_id = $2`,
                [token, req.user.id]
            );

            res.json({
                success: true,
                message: 'Date de dernière utilisation mise à jour'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Nettoyer les tokens expirés/inactifs
     * @route DELETE /api/v1/notifications/tokens-push/nettoyer
     */
    async cleanupTokens(req, res, next) {
        try {
            // Désactiver les tokens non utilisés depuis plus de 30 jours
            const result = await db.query(
                `UPDATE TOKENS_PUSH 
                 SET est_actif = false
                 WHERE compte_id = $1 
                   AND (date_derniere_utilisation < NOW() - INTERVAL '30 days'
                        OR date_derniere_utilisation IS NULL AND date_enregistrement < NOW() - INTERVAL '7 days')
                 RETURNING id`,
                [req.user.id]
            );

            res.json({
                success: true,
                message: `${result.rowCount} token(s) nettoyé(s)`
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Tester l'envoi d'une notification push
     * @route POST /api/v1/notifications/tokens-push/test
     */
    async testPush(req, res, next) {
        try {
            const { token, titre, corps } = req.body;

            if (!token) {
                throw new ValidationError('Token requis');
            }

            const result = await PushService.sendToDevice(token, {
                title: titre || 'Test Notification',
                body: corps || 'Ceci est une notification de test',
                data: {
                    type: 'TEST',
                    timestamp: new Date().toISOString()
                }
            });

            res.json({
                success: true,
                data: result,
                message: 'Notification test envoyée'
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new PushTokenController();