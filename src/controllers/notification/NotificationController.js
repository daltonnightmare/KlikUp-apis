// src/controllers/notification/NotificationController.js
const db = require('../../configuration/database');
const { ValidationError } = require('../../utils/errors/AppError');
const NotificationService = require('../../services/notification/NotificationService');
const PushService = require('../../services/push/PushService');
const EmailService = require('../../services/email/EmailService');
const SmsService = require('../../services/sms/SmsService');

class NotificationController {
    /**
     * Récupérer les notifications de l'utilisateur connecté
     * @route GET /api/v1/notifications
     */
    async getMesNotifications(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                non_lues = false,
                type,
                priorite,
                canal,
                date_debut,
                date_fin
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT n.*,
                       mn.code as modele_code,
                       mn.titre_template,
                       COUNT(*) OVER() as total_count
                FROM NOTIFICATIONS n
                LEFT JOIN MODELES_NOTIFICATIONS mn ON mn.id = n.modele_id
                WHERE n.destinataire_id = $1
                  AND n.est_archivee = false
            `;

            const params = [req.user.id];
            let paramIndex = 2;

            if (non_lues === 'true') {
                query += ` AND n.est_lue = false`;
            }

            if (type) {
                query += ` AND n.action_type = $${paramIndex}`;
                params.push(type);
                paramIndex++;
            }

            if (priorite) {
                query += ` AND n.priorite = $${paramIndex}`;
                params.push(priorite);
                paramIndex++;
            }

            if (canal) {
                query += ` AND n.canal = $${paramIndex}`;
                params.push(canal);
                paramIndex++;
            }

            if (date_debut) {
                query += ` AND n.date_creation >= $${paramIndex}`;
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                query += ` AND n.date_creation <= $${paramIndex}`;
                params.push(date_fin);
                paramIndex++;
            }

            query += ` ORDER BY n.date_creation DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Statistiques rapides
            const stats = await db.query(
                `SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE est_lue = false) as non_lues,
                    COUNT(*) FILTER (WHERE priorite = 'CRITIQUE' AND est_lue = false) as critiques_non_lues
                 FROM NOTIFICATIONS
                 WHERE destinataire_id = $1 AND est_archivee = false`,
                [req.user.id]
            );

            res.json({
                success: true,
                data: {
                    notifications: result.rows,
                    stats: stats.rows[0]
                },
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer une notification spécifique
     * @route GET /api/v1/notifications/:id
     */
    async getOne(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT n.*,
                        mn.code as modele_code,
                        mn.titre_template,
                        mn.corps_template
                 FROM NOTIFICATIONS n
                 LEFT JOIN MODELES_NOTIFICATIONS mn ON mn.id = n.modele_id
                 WHERE n.id = $1 AND n.destinataire_id = $2`,
                [id, req.user.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Notification non trouvée'
                });
            }

            // Marquer comme lue si ce n'est pas déjà fait
            if (!result.rows[0].est_lue) {
                await db.query(
                    `UPDATE NOTIFICATIONS 
                     SET est_lue = true,
                         date_lecture = NOW()
                     WHERE id = $1`,
                    [id]
                );
                result.rows[0].est_lue = true;
                result.rows[0].date_lecture = new Date();
            }

            res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Marquer une notification comme lue
     * @route PATCH /api/v1/notifications/:id/lire
     */
    async markAsRead(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `UPDATE NOTIFICATIONS 
                 SET est_lue = true,
                     date_lecture = NOW()
                 WHERE id = $1 AND destinataire_id = $2
                 RETURNING id`,
                [id, req.user.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Notification non trouvée'
                });
            }

            res.json({
                success: true,
                message: 'Notification marquée comme lue'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Marquer toutes les notifications comme lues
     * @route POST /api/v1/notifications/lire-toutes
     */
    async markAllAsRead(req, res, next) {
        try {
            const { type, avant_date } = req.body;

            let query = `
                UPDATE NOTIFICATIONS 
                SET est_lue = true,
                    date_lecture = NOW()
                WHERE destinataire_id = $1 AND est_lue = false
            `;

            const params = [req.user.id];

            if (type) {
                query += ` AND action_type = $2`;
                params.push(type);
            }

            if (avant_date) {
                query += ` AND date_creation <= $${params.length + 1}`;
                params.push(avant_date);
            }

            const result = await db.query(query, params);

            res.json({
                success: true,
                message: `${result.rowCount} notification(s) marquée(s) comme lue(s)`
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Archiver une notification
     * @route PATCH /api/v1/notifications/:id/archiver
     */
    async archive(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `UPDATE NOTIFICATIONS 
                 SET est_archivee = true
                 WHERE id = $1 AND destinataire_id = $2
                 RETURNING id`,
                [id, req.user.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Notification non trouvée'
                });
            }

            res.json({
                success: true,
                message: 'Notification archivée'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Archiver toutes les notifications
     * @route POST /api/v1/notifications/archiver-toutes
     */
    async archiveAll(req, res, next) {
        try {
            const { avant_date } = req.body;

            let query = `
                UPDATE NOTIFICATIONS 
                SET est_archivee = true
                WHERE destinataire_id = $1
            `;

            const params = [req.user.id];

            if (avant_date) {
                query += ` AND date_creation <= $2`;
                params.push(avant_date);
            }

            const result = await db.query(query, params);

            res.json({
                success: true,
                message: `${result.rowCount} notification(s) archivée(s)`
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Supprimer une notification
     * @route DELETE /api/v1/notifications/:id
     */
    async delete(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                'DELETE FROM NOTIFICATIONS WHERE id = $1 AND destinataire_id = $2 RETURNING id',
                [id, req.user.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Notification non trouvée'
                });
            }

            res.json({
                success: true,
                message: 'Notification supprimée'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Nettoyer les anciennes notifications
     * @route DELETE /api/v1/notifications/nettoyer
     */
    async cleanup(req, res, next) {
        try {
            const { avant_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } = req.query;

            const result = await db.query(
                `DELETE FROM NOTIFICATIONS 
                 WHERE destinataire_id = $1 
                   AND date_creation < $2
                   AND est_lue = true
                   AND est_archivee = true
                 RETURNING id`,
                [req.user.id, avant_date]
            );

            res.json({
                success: true,
                message: `${result.rowCount} notification(s) ancienne(s) supprimée(s)`
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Obtenir les statistiques des notifications
     * @route GET /api/v1/notifications/stats
     */
    async getStats(req, res, next) {
        try {
            const { periode = '30d' } = req.query;

            let interval;
            switch (periode) {
                case '24h': interval = "INTERVAL '24 hours'"; break;
                case '7d': interval = "INTERVAL '7 days'"; break;
                case '30d': interval = "INTERVAL '30 days'"; break;
                case '1y': interval = "INTERVAL '1 year'"; break;
                default: interval = "INTERVAL '30 days'";
            }

            const stats = await db.query(
                `SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE est_lue = true) as lues,
                    COUNT(*) FILTER (WHERE est_lue = false) as non_lues,
                    COUNT(*) FILTER (WHERE priorite = 'CRITIQUE') as critiques,
                    COUNT(*) FILTER (WHERE priorite = 'HAUTE') as hautes,
                    COUNT(*) FILTER (WHERE priorite = 'NORMALE') as normales,
                    COUNT(*) FILTER (WHERE priorite = 'BASSE') as basses,
                    COUNT(DISTINCT action_type) as types_distincts,
                    MIN(date_creation) as plus_ancienne,
                    MAX(date_creation) as plus_recente
                 FROM NOTIFICATIONS
                 WHERE destinataire_id = $1
                   AND date_creation >= NOW() - ${interval}`,
                [req.user.id]
            );

            // Évolution quotidienne
            const evolution = await db.query(
                `SELECT 
                    DATE(date_creation) as date,
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE est_lue = false) as non_lues
                 FROM NOTIFICATIONS
                 WHERE destinataire_id = $1
                   AND date_creation >= NOW() - ${interval}
                 GROUP BY DATE(date_creation)
                 ORDER BY date ASC`,
                [req.user.id]
            );

            // Répartition par type
            const parType = await db.query(
                `SELECT 
                    action_type,
                    COUNT(*) as nombre
                 FROM NOTIFICATIONS
                 WHERE destinataire_id = $1
                   AND date_creation >= NOW() - ${interval}
                 GROUP BY action_type
                 ORDER BY nombre DESC
                 LIMIT 10`,
                [req.user.id]
            );

            res.json({
                success: true,
                data: {
                    global: stats.rows[0],
                    evolution: evolution.rows,
                    types: parType.rows,
                    periode
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Envoyer une notification (admin)
     * @route POST /api/v1/notifications/envoyer
     */
    async send(req, res, next) {
        try {
            const {
                destinataire_id,
                type,
                titre,
                corps,
                canal = 'IN_APP',
                priorite = 'NORMALE',
                action_type,
                action_id,
                action_url,
                image_url,
                entite_source_type,
                entite_source_id,
                date_envoi_prevu
            } = req.body;

            if (!destinataire_id || !titre || !corps) {
                throw new ValidationError('Destinataire, titre et corps requis');
            }

            const notification = await NotificationService.send({
                destinataire_id,
                type,
                titre,
                corps,
                canal,
                priorite,
                action_type,
                action_id,
                action_url,
                image_url,
                entite_source_type,
                entite_source_id,
                date_envoi_prevu
            });

            res.status(201).json({
                success: true,
                data: notification,
                message: 'Notification envoyée'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Envoyer une notification à plusieurs destinataires (admin)
     * @route POST /api/v1/notifications/envoyer-multiple
     */
    async sendBulk(req, res, next) {
        try {
            const {
                destinataires,
                type,
                titre,
                corps,
                canal = 'IN_APP',
                priorite = 'NORMALE',
                action_type,
                action_id,
                action_url
            } = req.body;

            if (!destinataires || !Array.isArray(destinataires) || destinataires.length === 0) {
                throw new ValidationError('Liste de destinataires requise');
            }

            if (!titre || !corps) {
                throw new ValidationError('Titre et corps requis');
            }

            const results = [];
            for (const destId of destinataires) {
                try {
                    const notif = await NotificationService.send({
                        destinataire_id: destId,
                        type,
                        titre,
                        corps,
                        canal,
                        priorite,
                        action_type,
                        action_id,
                        action_url
                    });
                    results.push({ destinataire_id: destId, success: true, id: notif.id });
                } catch (error) {
                    results.push({ destinataire_id: destId, success: false, error: error.message });
                }
            }

            res.status(201).json({
                success: true,
                data: {
                    total: destinataires.length,
                    reussites: results.filter(r => r.success).length,
                    echecs: results.filter(r => !r.success).length,
                    details: results
                },
                message: `${results.filter(r => r.success).length} notification(s) envoyée(s)`
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new NotificationController();