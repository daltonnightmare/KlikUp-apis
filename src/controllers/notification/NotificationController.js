// src/controllers/notification/NotificationController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');
const NotificationService = require('../../services/notification/NotificationService');
const { v4: uuidv4 } = require('uuid');

class NotificationController {
    
    /**
     * Envoyer une notification (admin)
     * @route POST /api/v1/notifications
     */
    async send(req, res, next) {
        try {
            const {
                destinataire_id,
                type = 'GENERAL',
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

            if (!destinataire_id) {
                throw new ValidationError('Destinataire requis');
            }
            if (!titre) {
                throw new ValidationError('Titre requis');
            }
            if (!corps) {
                throw new ValidationError('Corps du message requis');
            }

            // Vérifier que le destinataire existe
            const destinataire = await db.query(
                `SELECT id, email, nom_utilisateur_compte 
                 FROM COMPTES 
                 WHERE id = $1 AND est_supprime = false`,
                [destinataire_id]
            );

            if (destinataire.rows.length === 0) {
                throw new NotFoundError('Destinataire non trouvé');
            }

            // Envoyer la notification
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
                message: 'Notification envoyée avec succès'
            });

        } catch (error) {
            console.error('Erreur send notification:', error);
            next(error);
        }
    }

    /**
     * Envoyer une notification à plusieurs destinataires (admin)
     * @route POST /api/v1/notifications/bulk
     */
    async sendBulk(req, res, next) {
        try {
            const {
                destinataires,
                type = 'GENERAL',
                titre,
                corps,
                canal = 'IN_APP',
                priorite = 'NORMALE',
                action_type,
                action_id,
                action_url,
                image_url,
                entite_source_type,
                entite_source_id
            } = req.body;

            if (!destinataires || !Array.isArray(destinataires) || destinataires.length === 0) {
                throw new ValidationError('Liste de destinataires requise');
            }
            if (!titre) {
                throw new ValidationError('Titre requis');
            }
            if (!corps) {
                throw new ValidationError('Corps du message requis');
            }

            const results = {
                total: destinataires.length,
                reussites: 0,
                echecs: 0,
                details: []
            };

            for (const destId of destinataires) {
                try {
                    // Vérifier que le destinataire existe
                    const destinataire = await db.query(
                        `SELECT id FROM COMPTES WHERE id = $1 AND est_supprime = false`,
                        [destId]
                    );

                    if (destinataire.rows.length === 0) {
                        results.echecs++;
                        results.details.push({ 
                            destinataire_id: destId, 
                            success: false, 
                            error: 'Destinataire non trouvé' 
                        });
                        continue;
                    }

                    const notification = await NotificationService.send({
                        destinataire_id: destId,
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
                        entite_source_id
                    });

                    results.reussites++;
                    results.details.push({ 
                        destinataire_id: destId, 
                        success: true, 
                        id: notification.id 
                    });

                } catch (error) {
                    results.echecs++;
                    results.details.push({ 
                        destinataire_id: destId, 
                        success: false, 
                        error: error.message 
                    });
                }
            }

            res.status(201).json({
                success: true,
                data: results,
                message: `${results.reussites} notification(s) envoyée(s) sur ${results.total}`
            });

        } catch (error) {
            console.error('Erreur sendBulk:', error);
            next(error);
        }
    }

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
            const userId = req.user.id;

            let query = `
                SELECT 
                    n.id,
                    n.uuid_notification,
                    n.titre,
                    n.corps,
                    n.canal,
                    n.priorite,
                    n.action_type,
                    n.action_id,
                    n.action_url,
                    n.image_url,
                    n.est_lue,
                    n.est_archivee,
                    n.date_lecture,
                    n.date_creation,
                    n.date_expiration,
                    n.entite_source_type,
                    n.entite_source_id,
                    COUNT(*) OVER() as total_count
                FROM NOTIFICATIONS n
                WHERE n.destinataire_id = $1
                  AND n.est_archivee = false
                  AND (n.date_expiration IS NULL OR n.date_expiration > NOW())
            `;

            const params = [userId];
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

            query += ` ORDER BY n.date_creation DESC 
                       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = parseInt(result.rows[0]?.total_count || 0);

            // Statistiques
            const stats = await db.query(
                `SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE est_lue = false) as non_lues,
                    COUNT(*) FILTER (WHERE priorite = 'CRITIQUE' AND est_lue = false) as critiques_non_lues,
                    COUNT(*) FILTER (WHERE priorite = 'CRITIQUE') as critiques_total
                 FROM NOTIFICATIONS
                 WHERE destinataire_id = $1 
                   AND est_archivee = false
                   AND (date_expiration IS NULL OR date_expiration > NOW())`,
                [userId]
            );

            res.json({
                success: true,
                data: {
                    notifications: result.rows,
                    stats: stats.rows[0] || { total: 0, non_lues: 0, critiques_non_lues: 0, critiques_total: 0 }
                },
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: total,
                    pages: Math.ceil(total / parseInt(limit))
                }
            });

        } catch (error) {
            console.error('Erreur getMesNotifications:', error);
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
            const userId = req.user.id;

            const result = await db.query(
                `SELECT 
                    n.*,
                    (SELECT json_agg(json_build_object(
                        'id', pj.id,
                        'nom_fichier', pj.nom_fichier,
                        'type_fichier', pj.type_fichier,
                        'url', pj.url_telechargement
                    )) FROM PIECES_JOINTES pj WHERE pj.message_id = n.id
                ) as pieces_jointes
                FROM NOTIFICATIONS n
                WHERE n.id = $1 AND n.destinataire_id = $2`,
                [id, userId]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Notification non trouvée');
            }

            const notification = result.rows[0];

            // Marquer comme lue automatiquement si consultée
            if (!notification.est_lue) {
                await db.query(
                    `UPDATE NOTIFICATIONS 
                     SET est_lue = true, date_lecture = NOW()
                     WHERE id = $1`,
                    [id]
                );
                notification.est_lue = true;
                notification.date_lecture = new Date();
            }

            res.json({
                success: true,
                data: notification
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Marquer une notification comme lue
     * @route PATCH /api/v1/notifications/:id/read
     */
    async markAsRead(req, res, next) {
        try {
            const { id } = req.params;
            const userId = req.user.id;

            const result = await db.query(
                `UPDATE NOTIFICATIONS 
                 SET est_lue = true, date_lecture = NOW()
                 WHERE id = $1 AND destinataire_id = $2
                 RETURNING id`,
                [id, userId]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Notification non trouvée');
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
     * @route POST /api/v1/notifications/read-all
     */
    async markAllAsRead(req, res, next) {
        try {
            const { type, before_date } = req.body;
            const userId = req.user.id;

            let query = `
                UPDATE NOTIFICATIONS 
                SET est_lue = true, date_lecture = NOW()
                WHERE destinataire_id = $1 AND est_lue = false
            `;
            const params = [userId];

            if (type) {
                query += ` AND action_type = $2`;
                params.push(type);
            }

            if (before_date) {
                query += ` AND date_creation <= $${params.length + 1}`;
                params.push(before_date);
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
     * @route PATCH /api/v1/notifications/:id/archive
     */
    async archive(req, res, next) {
        try {
            const { id } = req.params;
            const userId = req.user.id;

            const result = await db.query(
                `UPDATE NOTIFICATIONS 
                 SET est_archivee = true
                 WHERE id = $1 AND destinataire_id = $2
                 RETURNING id`,
                [id, userId]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Notification non trouvée');
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
     * @route POST /api/v1/notifications/archive-all
     */
    async archiveAll(req, res, next) {
        try {
            const { before_date } = req.body;
            const userId = req.user.id;

            let query = `
                UPDATE NOTIFICATIONS 
                SET est_archivee = true
                WHERE destinataire_id = $1
            `;
            const params = [userId];

            if (before_date) {
                query += ` AND date_creation <= $2`;
                params.push(before_date);
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
            const userId = req.user.id;

            const result = await db.query(
                `DELETE FROM NOTIFICATIONS 
                 WHERE id = $1 AND destinataire_id = $2
                 RETURNING id`,
                [id, userId]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Notification non trouvée');
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
     * @route DELETE /api/v1/notifications/cleanup
     */
    async cleanup(req, res, next) {
        try {
            const { days = 30 } = req.query;
            const userId = req.user.id;
            const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

            const result = await db.query(
                `DELETE FROM NOTIFICATIONS 
                 WHERE destinataire_id = $1 
                   AND date_creation < $2
                   AND est_lue = true
                   AND est_archivee = true
                 RETURNING id`,
                [userId, cutoffDate]
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
            const { period = '30d' } = req.query;
            const userId = req.user.id;

            let interval;
            switch (period) {
                case '24h': interval = "INTERVAL '24 hours'"; break;
                case '7d': interval = "INTERVAL '7 days'"; break;
                case '30d': interval = "INTERVAL '30 days'"; break;
                case '90d': interval = "INTERVAL '90 days'"; break;
                default: interval = "INTERVAL '30 days'";
            }

            // Statistiques globales
            const globalStats = await db.query(
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
                   AND date_creation >= NOW() - ${interval}
                   AND est_archivee = false`,
                [userId]
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
                   AND est_archivee = false
                 GROUP BY DATE(date_creation)
                 ORDER BY date ASC`,
                [userId]
            );

            // Répartition par type
            const byType = await db.query(
                `SELECT 
                    COALESCE(action_type, 'AUTRE') as type,
                    COUNT(*) as count
                 FROM NOTIFICATIONS
                 WHERE destinataire_id = $1
                   AND date_creation >= NOW() - ${interval}
                   AND est_archivee = false
                 GROUP BY action_type
                 ORDER BY count DESC
                 LIMIT 10`,
                [userId]
            );

            // Répartition par canal
            const byCanal = await db.query(
                `SELECT 
                    canal,
                    COUNT(*) as count,
                    COUNT(*) FILTER (WHERE est_lue = false) as non_lues
                 FROM NOTIFICATIONS
                 WHERE destinataire_id = $1
                   AND date_creation >= NOW() - ${interval}
                   AND est_archivee = false
                 GROUP BY canal
                 ORDER BY count DESC`,
                [userId]
            );

            res.json({
                success: true,
                data: {
                    period,
                    global: globalStats.rows[0] || {
                        total: 0, lues: 0, non_lues: 0,
                        critiques: 0, hautes: 0, normales: 0, basses: 0,
                        types_distincts: 0, plus_ancienne: null, plus_recente: null
                    },
                    evolution: evolution.rows,
                    by_type: byType.rows,
                    by_canal: byCanal.rows
                }
            });

        } catch (error) {
            console.error('Erreur getStats:', error);
            next(error);
        }
    }

    /**
     * Obtenir le nombre de notifications non lues
     * @route GET /api/v1/notifications/unread-count
     */
    async getUnreadCount(req, res, next) {
        try {
            const userId = req.user.id;

            const result = await db.query(
                `SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE priorite = 'CRITIQUE') as critiques,
                    COUNT(*) FILTER (WHERE priorite = 'HAUTE') as hautes
                 FROM NOTIFICATIONS
                 WHERE destinataire_id = $1 
                   AND est_lue = false 
                   AND est_archivee = false
                   AND (date_expiration IS NULL OR date_expiration > NOW())`,
                [userId]
            );

            res.json({
                success: true,
                data: {
                    unread_count: parseInt(result.rows[0]?.total || 0),
                    critical_count: parseInt(result.rows[0]?.critiques || 0),
                    high_count: parseInt(result.rows[0]?.hautes || 0)
                }
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new NotificationController();