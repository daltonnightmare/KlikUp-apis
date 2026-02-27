// src/controllers/messagerie/ReactionController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');

class ReactionController {
    /**
     * Ajouter/Modifier une réaction à un message
     * @route POST /api/v1/messagerie/messages/:messageId/reactions
     */
    async addOrUpdate(req, res, next) {
        try {
            const { messageId } = req.params;
            const { emoji } = req.body;

            if (!emoji) {
                throw new ValidationError('Emoji requis');
            }

            // Vérifier que l'utilisateur a accès au message
            const message = await db.query(
                `SELECT m.* 
                 FROM MESSAGES m
                 JOIN PARTICIPANTS_CONVERSATION pc ON pc.conversation_id = m.conversation_id
                 WHERE m.id = $1 AND pc.compte_id = $2`,
                [messageId, req.user.id]
            );

            if (message.rows.length === 0) {
                throw new NotFoundError('Message non trouvé ou accès non autorisé');
            }

            // Vérifier si une réaction existe déjà
            const existing = await db.query(
                'SELECT id FROM REACTIONS_MESSAGES WHERE message_id = $1 AND compte_id = $2 AND emoji = $3',
                [messageId, req.user.id, emoji]
            );

            let result;
            if (existing.rows.length > 0) {
                // Supprimer la réaction (toggle off)
                await db.query(
                    'DELETE FROM REACTIONS_MESSAGES WHERE id = $1',
                    [existing.rows[0].id]
                );
                result = { action: 'removed', emoji };
            } else {
                // Ajouter la réaction
                result = await db.query(
                    `INSERT INTO REACTIONS_MESSAGES (message_id, compte_id, emoji)
                     VALUES ($1, $2, $3)
                     RETURNING *`,
                    [messageId, req.user.id, emoji]
                );
                result = { action: 'added', reaction: result.rows[0] };
            }

            // Récupérer toutes les réactions pour ce message
            const reactions = await db.query(
                `SELECT rm.emoji, rm.compte_id, rm.date_reaction,
                        c.nom_utilisateur_compte,
                        c.photo_profil_compte
                 FROM REACTIONS_MESSAGES rm
                 JOIN COMPTES c ON c.id = rm.compte_id
                 WHERE rm.message_id = $1
                 ORDER BY rm.date_reaction DESC`,
                [messageId]
            );

            // Grouper par emoji
            const grouped = this.groupReactions(reactions.rows);

            res.json({
                success: true,
                data: {
                    action: result.action,
                    reactions: grouped
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les réactions d'un message
     * @route GET /api/v1/messagerie/messages/:messageId/reactions
     */
    async getReactions(req, res, next) {
        try {
            const { messageId } = req.params;

            const reactions = await db.query(
                `SELECT rm.emoji, 
                        COUNT(*) as count,
                        json_agg(
                            json_build_object(
                                'compte_id', rm.compte_id,
                                'nom', c.nom_utilisateur_compte,
                                'photo', c.photo_profil_compte,
                                'date', rm.date_reaction
                            ) ORDER BY rm.date_reaction DESC
                        ) as users
                 FROM REACTIONS_MESSAGES rm
                 JOIN COMPTES c ON c.id = rm.compte_id
                 WHERE rm.message_id = $1
                 GROUP BY rm.emoji
                 ORDER BY count DESC, rm.emoji ASC`,
                [messageId]
            );

            // Vérifier si l'utilisateur courant a réagi
            const myReactions = await db.query(
                'SELECT emoji FROM REACTIONS_MESSAGES WHERE message_id = $1 AND compte_id = $2',
                [messageId, req.user.id]
            );

            res.json({
                success: true,
                data: {
                    reactions: reactions.rows,
                    my_reactions: myReactions.rows.map(r => r.emoji)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Supprimer une réaction spécifique
     * @route DELETE /api/v1/messagerie/messages/:messageId/reactions/:emoji
     */
    async remove(req, res, next) {
        try {
            const { messageId, emoji } = req.params;

            const result = await db.query(
                'DELETE FROM REACTIONS_MESSAGES WHERE message_id = $1 AND compte_id = $2 AND emoji = $3 RETURNING id',
                [messageId, req.user.id, emoji]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Réaction non trouvée');
            }

            res.json({
                success: true,
                message: 'Réaction supprimée'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Grouper les réactions par emoji
     */
    groupReactions(reactions) {
        const grouped = {};
        
        for (const r of reactions) {
            if (!grouped[r.emoji]) {
                grouped[r.emoji] = {
                    count: 0,
                    users: []
                };
            }
            
            grouped[r.emoji].count++;
            grouped[r.emoji].users.push({
                compte_id: r.compte_id,
                nom: r.nom_utilisateur_compte,
                photo: r.photo_profil_compte,
                date: r.date_reaction
            });
        }
        
        return grouped;
    }
}

module.exports = new ReactionController();