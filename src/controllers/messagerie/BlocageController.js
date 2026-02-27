// src/controllers/messagerie/BlocageController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError, AuthorizationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const NotificationService = require('../../services/notification/NotificationService');

class BlocageController {
    /**
     * Récupérer la liste des comptes bloqués
     * @route GET /api/v1/messagerie/blocages
     */
    async getMyBlocks(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                type_blocage
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    b.*,
                    c.id as compte_bloque_id,
                    c.nom_utilisateur_compte,
                    c.email,
                    c.photo_profil_compte,
                    c.date_creation,
                    COUNT(*) OVER() as total_count
                FROM BLOCAGES b
                JOIN COMPTES c ON c.id = b.compte_bloque
                WHERE b.compte_id = $1
            `;

            const params = [req.user.id];
            let paramIndex = 2;

            if (type_blocage) {
                query += ` AND b.type_blocage = $${paramIndex}`;
                params.push(type_blocage);
                paramIndex++;
            }

            query += ` ORDER BY b.date_blocage DESC
                       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Obtenir les statistiques
            const stats = await db.query(
                `SELECT 
                    type_blocage,
                    COUNT(*) as nombre
                 FROM BLOCAGES
                 WHERE compte_id = $1
                 GROUP BY type_blocage`,
                [req.user.id]
            );

            res.json({
                success: true,
                data: result.rows,
                stats: stats.rows,
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
     * Vérifier si un utilisateur est bloqué
     * @route GET /api/v1/messagerie/blocages/check/:userId
     */
    async checkBlockStatus(req, res, next) {
        try {
            const { userId } = req.params;

            // Vérifier si l'utilisateur courant a bloqué cet utilisateur
            const blockedByMe = await db.query(
                `SELECT id, type_blocage, date_blocage
                 FROM BLOCAGES
                 WHERE compte_id = $1 AND compte_bloque = $2`,
                [req.user.id, userId]
            );

            // Vérifier si cet utilisateur a bloqué l'utilisateur courant
            const blockedMe = await db.query(
                `SELECT id, type_blocage, date_blocage
                 FROM BLOCAGES
                 WHERE compte_id = $1 AND compte_bloque = $2`,
                [userId, req.user.id]
            );

            res.json({
                success: true,
                data: {
                    blocked_by_me: blockedByMe.rows.length > 0 ? blockedByMe.rows[0] : null,
                    blocked_me: blockedMe.rows.length > 0 ? blockedMe.rows[0] : null,
                    can_message: blockedByMe.rows.length === 0 && blockedMe.rows.length === 0
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Bloquer un utilisateur
     * @route POST /api/v1/messagerie/blocages
     */
    async block(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const {
                compte_bloque,
                type_blocage = 'MESSAGERIE',
                conversation_id,
                raison
            } = req.body;

            // Validation
            if (!compte_bloque) {
                throw new ValidationError('compte_bloque requis');
            }

            if (compte_bloque === req.user.id) {
                throw new ValidationError('Vous ne pouvez pas vous bloquer vous-même');
            }

            // Vérifier que l'utilisateur bloqué existe
            const userExists = await client.query(
                'SELECT id FROM COMPTES WHERE id = $1',
                [compte_bloque]
            );

            if (userExists.rows.length === 0) {
                throw new NotFoundError('Utilisateur non trouvé');
            }

            // Vérifier si un blocage existe déjà
            const existing = await client.query(
                `SELECT id FROM BLOCAGES
                 WHERE compte_id = $1 AND compte_bloque = $2`,
                [req.user.id, compte_bloque]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError('Cet utilisateur est déjà bloqué');
            }

            // Créer le blocage
            const result = await client.query(
                `INSERT INTO BLOCAGES (
                    compte_id, compte_bloque, type_blocage,
                    conversation_id, raison
                ) VALUES ($1, $2, $3, $4, $5)
                RETURNING *`,
                [req.user.id, compte_bloque, type_blocage, conversation_id, raison]
            );

            const blocage = result.rows[0];

            // Si GLOBAL, fermer les conversations actives
            if (type_blocage === 'GLOBAL') {
                await client.query(
                    `UPDATE CONVERSATIONS
                     SET est_verrouille = true
                     WHERE id IN (
                         SELECT DISTINCT c.id
                         FROM CONVERSATIONS c
                         JOIN PARTICIPANTS_CONVERSATION pc1 ON pc1.conversation_id = c.id
                         JOIN PARTICIPANTS_CONVERSATION pc2 ON pc2.conversation_id = c.id
                         WHERE pc1.compte_id = $1 AND pc2.compte_id = $2
                     )`,
                    [req.user.id, compte_bloque]
                );
            }

            // Enregistrer l'action dans l'audit
            await AuditService.log({
                action: 'BLOQUER_UTILISATEUR',
                table: 'BLOCAGES',
                record_id: blocage.id,
                user_id: req.user.id,
                changes: {
                    compte_bloque,
                    type_blocage
                }
            }, client);

            // Notifier l'utilisateur (optionnel, dépend de la politique)
            // await NotificationService.notify({
            //     user_id: compte_bloque,
            //     type: 'UTILISATEUR_BLOQUE',
            //     data: { por_compte_id: req.user.id }
            // }, client);

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: blocage,
                message: 'Utilisateur bloqué avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Débloquer un utilisateur
     * @route DELETE /api/v1/messagerie/blocages/:id
     */
    async unblock(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;

            // Vérifier que le blocage existe et appartient à l'utilisateur
            const blocage = await client.query(
                'SELECT * FROM BLOCAGES WHERE id = $1 AND compte_id = $2',
                [id, req.user.id]
            );

            if (blocage.rows.length === 0) {
                throw new NotFoundError('Blocage non trouvé');
            }

            const blk = blocage.rows[0];

            // Supprimer le blocage
            await client.query(
                'DELETE FROM BLOCAGES WHERE id = $1',
                [id]
            );

            // Si GLOBAL, vérifier si on peut rouvrir les conversations
            if (blk.type_blocage === 'GLOBAL') {
                // Maintien verrouillé car c'est un choix de l'utilisateur
                // L'utilisateur peut le rouvrir manuellement s'il le souhaite
            }

            // Enregistrer l'action dans l'audit
            await AuditService.log({
                action: 'DEBLOQUER_UTILISATEUR',
                table: 'BLOCAGES',
                record_id: blk.id,
                user_id: req.user.id,
                changes: {
                    compte_bloque: blk.compte_bloque,
                    type_blocage: blk.type_blocage
                }
            }, client);

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Utilisateur débloqué avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }
}

module.exports = new BlocageController();
