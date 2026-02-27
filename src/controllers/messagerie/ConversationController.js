// src/controllers/messagerie/ConversationController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError, AuthorizationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const NotificationService = require('../../services/notification/NotificationService');
const { v4: uuidv4 } = require('uuid');

class ConversationController {
    /**
     * Créer une nouvelle conversation
     * @route POST /api/v1/messagerie/conversations
     */
    async create(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const {
                type_conversation = 'DIRECT',
                titre_conversation,
                description_conversation,
                est_prive = true,
                necessite_approbation = false,
                entite_type,
                entite_id,
                participants = [], // Liste des IDs des participants initiaux
                metadata = {}
            } = req.body;

            // Validation
            if (!['DIRECT', 'GROUPE', 'SUPPORT', 'COMMANDE', 'LIVRAISON', 'SERVICE_CLIENT', 'NOTIFICATION_ADMIN', 'ANNONCE_PLATEFORME', 'SIGNALEMENT', 'RECLAMATION'].includes(type_conversation)) {
                throw new ValidationError('Type de conversation invalide');
            }

            // Pour une conversation DIRECT, vérifier qu'elle n'existe pas déjà
            if (type_conversation === 'DIRECT' && participants.length === 1) {
                const existing = await client.query(
                    `SELECT c.id 
                     FROM CONVERSATIONS c
                     JOIN PARTICIPANTS_CONVERSATION p1 ON p1.conversation_id = c.id
                     JOIN PARTICIPANTS_CONVERSATION p2 ON p2.conversation_id = c.id
                     WHERE c.type_conversation = 'DIRECT'
                       AND p1.compte_id = $1
                       AND p2.compte_id = $2
                       AND p1.est_actif = true
                       AND p2.est_actif = true`,
                    [req.user.id, participants[0]]
                );

                if (existing.rows.length > 0) {
                    return res.json({
                        success: true,
                        data: await this.getConversationDetails(existing.rows[0].id, req.user.id),
                        message: 'Conversation existante récupérée'
                    });
                }
            }

            // Créer la conversation
            const result = await client.query(
                `INSERT INTO CONVERSATIONS (
                    uuid_conversation, type_conversation, titre_conversation,
                    description_conversation, est_prive, necessite_approbation,
                    entite_type, entite_id, metadata, cree_par
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *`,
                [
                    uuidv4(), type_conversation, titre_conversation,
                    description_conversation, est_prive, necessite_approbation,
                    entite_type, entite_id, JSON.stringify(metadata), req.user.id
                ]
            );

            const conversation = result.rows[0];

            // Ajouter le créateur comme participant
            await client.query(
                `INSERT INTO PARTICIPANTS_CONVERSATION (
                    conversation_id, compte_id, role_participant,
                    est_administrateur, est_actif
                ) VALUES ($1, $2, $3, $4, true)`,
                [conversation.id, req.user.id, 'ADMIN', true]
            );

            // Ajouter les autres participants
            for (const participantId of participants) {
                if (participantId !== req.user.id) {
                    await client.query(
                        `INSERT INTO PARTICIPANTS_CONVERSATION (
                            conversation_id, compte_id, role_participant,
                            est_actif, notifications_actives
                        ) VALUES ($1, $2, $3, true, true)`,
                        [conversation.id, participantId, 'PARTICIPANT']
                    );

                    // Notifier le participant
                    await NotificationService.send({
                        destinataire_id: participantId,
                        type: 'NOUVELLE_CONVERSATION',
                        titre: 'Nouvelle conversation',
                        corps: `Vous avez été ajouté à une conversation${titre_conversation ? ` : ${titre_conversation}` : ''}`,
                        entite_source_type: 'CONVERSATION',
                        entite_source_id: conversation.id
                    });
                }
            }

            // Mettre à jour le nombre de participants
            await client.query(
                `UPDATE CONVERSATIONS 
                 SET nombre_participants = (
                     SELECT COUNT(*) FROM PARTICIPANTS_CONVERSATION 
                     WHERE conversation_id = $1 AND est_actif = true
                 )
                 WHERE id = $1`,
                [conversation.id]
            );

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: await this.getConversationDetails(conversation.id, req.user.id),
                message: 'Conversation créée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les conversations de l'utilisateur connecté
     * @route GET /api/v1/messagerie/conversations
     */
    async getMesConversations(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                type_conversation,
                est_archive = false,
                recherche,
                non_lus = false
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    c.*,
                    pc.role_participant,
                    pc.messages_non_lus,
                    pc.est_bloque,
                    pc.notifications_actives,
                    pc.surnom_dans_conversation,
                    pc.couleur_affichage,
                    (
                        SELECT row_to_json(m)
                        FROM (
                            SELECT m2.id, m2.contenu_message, m2.date_envoi,
                                   m2.type_message, m2.statut,
                                   exp.nom_utilisateur_compte as expediteur_nom,
                                   exp.photo_profil_compte as expediteur_photo
                            FROM MESSAGES m2
                            JOIN COMPTES exp ON exp.id = m2.expediteur_id
                            WHERE m2.conversation_id = c.id
                              AND m2.date_suppression IS NULL
                            ORDER BY m2.date_envoi DESC
                            LIMIT 1
                        ) m
                    ) as dernier_message,
                    (
                        SELECT json_agg(p ORDER BY p.role_participant)
                        FROM (
                            SELECT pc2.compte_id,
                                   cmp.nom_utilisateur_compte,
                                   cmp.photo_profil_compte,
                                   pc2.role_participant,
                                   pc2.est_actif,
                                   pc2.est_en_vedette
                            FROM PARTICIPANTS_CONVERSATION pc2
                            JOIN COMPTES cmp ON cmp.id = pc2.compte_id
                            WHERE pc2.conversation_id = c.id 
                              AND pc2.est_actif = true
                            LIMIT 5
                        ) p
                    ) as apercu_participants,
                    COUNT(*) OVER() as total_count
                FROM CONVERSATIONS c
                JOIN PARTICIPANTS_CONVERSATION pc ON pc.conversation_id = c.id
                WHERE pc.compte_id = $1
                  AND c.est_archive = $2
            `;

            const params = [req.user.id, est_archive === 'true'];
            let paramIndex = 3;

            if (type_conversation) {
                query += ` AND c.type_conversation = $${paramIndex}`;
                params.push(type_conversation);
                paramIndex++;
            }

            if (non_lus === 'true') {
                query += ` AND pc.messages_non_lus > 0`;
            }

            if (recherche) {
                query += ` AND (c.titre_conversation ILIKE $${paramIndex} OR c.description_conversation ILIKE $${paramIndex})`;
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            query += ` ORDER BY c.date_dernier_message DESC NULLS LAST
                       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);

            // Traiter les résultats
            const conversations = await Promise.all(result.rows.map(async (row) => {
                const conv = { ...row };
                
                // Parser l'aperçu des participants
                if (conv.apercu_participants) {
                    conv.apercu_participants = JSON.parse(conv.apercu_participants);
                }

                // Pour les conversations DIRECT, déterminer l'autre participant
                if (conv.type_conversation === 'DIRECT' && conv.apercu_participants) {
                    const autre = conv.apercu_participants.find(p => p.compte_id !== req.user.id);
                    if (autre) {
                        conv.nom_affichage = autre.nom_utilisateur_compte;
                        conv.avatar = autre.photo_profil_compte;
                    }
                }

                return conv;
            }));

            const total = result.rows[0]?.total_count || 0;

            // Statistiques rapides
            const stats = await db.query(
                `SELECT 
                    SUM(messages_non_lus) as total_non_lus,
                    COUNT(*) FILTER (WHERE pc.est_bloque = true) as conversations_bloquees
                 FROM PARTICIPANTS_CONVERSATION pc
                 WHERE pc.compte_id = $1 AND pc.est_actif = true`,
                [req.user.id]
            );

            res.json({
                success: true,
                data: {
                    conversations,
                    stats: stats.rows[0] || { total_non_lus: 0, conversations_bloquees: 0 }
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
     * Récupérer les détails d'une conversation
     * @route GET /api/v1/messagerie/conversations/:id
     */
    async getOne(req, res, next) {
        try {
            const { id } = req.params;

            const conversation = await this.getConversationDetails(id, req.user.id);

            if (!conversation) {
                throw new NotFoundError('Conversation non trouvée');
            }

            // Vérifier que l'utilisateur est participant
            if (!conversation.participants.some(p => p.compte_id === req.user.id)) {
                throw new AuthorizationError('Vous n\'êtes pas membre de cette conversation');
            }

            res.json({
                success: true,
                data: conversation
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Mettre à jour une conversation
     * @route PUT /api/v1/messagerie/conversations/:id
     */
    async update(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const updateData = { ...req.body };

            // Vérifier les droits (admin seulement)
            const participant = await client.query(
                `SELECT * FROM PARTICIPANTS_CONVERSATION 
                 WHERE conversation_id = $1 AND compte_id = $2 AND est_administrateur = true`,
                [id, req.user.id]
            );

            if (participant.rows.length === 0) {
                throw new AuthorizationError('Seuls les administrateurs peuvent modifier la conversation');
            }

            const setClauses = [];
            const values = [id];
            let valueIndex = 2;

            const allowedFields = [
                'titre_conversation', 'description_conversation', 'avatar_conversation',
                'est_prive', 'necessite_approbation', 'est_archive', 'est_verrouille',
                'metadata', 'tags'
            ];

            for (const field of allowedFields) {
                if (updateData[field] !== undefined) {
                    setClauses.push(`${field} = $${valueIndex}`);
                    
                    if (field === 'metadata') {
                        values.push(JSON.stringify(updateData[field]));
                    } else if (field === 'tags') {
                        values.push(updateData[field]);
                    } else {
                        values.push(updateData[field]);
                    }
                    
                    valueIndex++;
                }
            }

            if (setClauses.length > 0) {
                setClauses.push('date_modification = NOW()');

                const updateQuery = `
                    UPDATE CONVERSATIONS 
                    SET ${setClauses.join(', ')}
                    WHERE id = $1
                    RETURNING *
                `;

                await client.query(updateQuery, values);
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                data: await this.getConversationDetails(id, req.user.id),
                message: 'Conversation mise à jour'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Archiver/Restaurer une conversation
     * @route PATCH /api/v1/messagerie/conversations/:id/archive
     */
    async toggleArchive(req, res, next) {
        try {
            const { id } = req.params;
            const { archived } = req.body;

            // Vérifier que l'utilisateur est participant
            const participant = await db.query(
                'SELECT id FROM PARTICIPANTS_CONVERSATION WHERE conversation_id = $1 AND compte_id = $2',
                [id, req.user.id]
            );

            if (participant.rows.length === 0) {
                throw new AuthorizationError('Vous n\'êtes pas membre de cette conversation');
            }

            await db.query(
                `UPDATE CONVERSATIONS 
                 SET est_archive = $1,
                     date_archivage = CASE WHEN $1 THEN NOW() ELSE NULL END,
                     date_modification = NOW()
                 WHERE id = $2`,
                [archived, id]
            );

            res.json({
                success: true,
                message: archived ? 'Conversation archivée' : 'Conversation restaurée'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Quitter une conversation
     * @route POST /api/v1/messagerie/conversations/:id/quitter
     */
    async quitter(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;

            const participant = await client.query(
                'SELECT * FROM PARTICIPANTS_CONVERSATION WHERE conversation_id = $1 AND compte_id = $2',
                [id, req.user.id]
            );

            if (participant.rows.length === 0) {
                throw new NotFoundError('Vous n\'êtes pas dans cette conversation');
            }

            // Si c'est le dernier admin, vérifier
            if (participant.rows[0].est_administrateur) {
                const admins = await client.query(
                    'SELECT COUNT(*) FROM PARTICIPANTS_CONVERSATION WHERE conversation_id = $1 AND est_administrateur = true',
                    [id]
                );

                if (parseInt(admins.rows[0].count) === 1) {
                    // Transférer les droits admin à un autre participant
                    await client.query(
                        `UPDATE PARTICIPANTS_CONVERSATION 
                         SET est_administrateur = true
                         WHERE conversation_id = $1 
                           AND compte_id != $2
                         ORDER BY date_ajout ASC
                         LIMIT 1`,
                        [id, req.user.id]
                    );
                }
            }

            // Soft delete du participant
            await client.query(
                `UPDATE PARTICIPANTS_CONVERSATION 
                 SET est_actif = false,
                     date_sortie = NOW()
                 WHERE conversation_id = $1 AND compte_id = $2`,
                [id, req.user.id]
            );

            // Mettre à jour le nombre de participants
            await client.query(
                `UPDATE CONVERSATIONS 
                 SET nombre_participants = (
                     SELECT COUNT(*) FROM PARTICIPANTS_CONVERSATION 
                     WHERE conversation_id = $1 AND est_actif = true
                 )
                 WHERE id = $1`,
                [id]
            );

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Vous avez quitté la conversation'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Rechercher des conversations
     * @route GET /api/v1/messagerie/conversations/recherche
     */
    async search(req, res, next) {
        try {
            const {
                q,
                type,
                entite_type,
                entite_id,
                page = 1,
                limit = 20
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT DISTINCT c.*,
                       COUNT(*) OVER() as total_count
                FROM CONVERSATIONS c
                LEFT JOIN PARTICIPANTS_CONVERSATION pc ON pc.conversation_id = c.id
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            if (q) {
                query += ` AND (c.titre_conversation ILIKE $${paramIndex} OR c.description_conversation ILIKE $${paramIndex})`;
                params.push(`%${q}%`);
                paramIndex++;
            }

            if (type) {
                query += ` AND c.type_conversation = $${paramIndex}`;
                params.push(type);
                paramIndex++;
            }

            if (entite_type && entite_id) {
                query += ` AND c.entite_type = $${paramIndex} AND c.entite_id = $${paramIndex + 1}`;
                params.push(entite_type, entite_id);
                paramIndex += 2;
            }

            query += ` ORDER BY c.date_dernier_message DESC NULLS LAST
                       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            res.json({
                success: true,
                data: result.rows,
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

    // ==================== Méthodes privées ====================

    /**
     * Récupérer les détails complets d'une conversation
     */
    async getConversationDetails(conversationId, userId) {
        const result = await db.query(
            `SELECT 
                c.*,
                (
                    SELECT json_agg(p ORDER BY p.role_participant, p.date_ajout)
                    FROM (
                        SELECT 
                            pc.compte_id,
                            cmp.nom_utilisateur_compte,
                            cmp.photo_profil_compte,
                            cmp.email,
                            pc.role_participant,
                            pc.est_actif,
                            pc.est_administrateur,
                            pc.est_en_vedette,
                            pc.est_bloque,
                            pc.surnom_dans_conversation,
                            pc.couleur_affichage,
                            pc.date_ajout,
                            pc.date_derniere_activite,
                            pc.messages_non_lus
                        FROM PARTICIPANTS_CONVERSATION pc
                        JOIN COMPTES cmp ON cmp.id = pc.compte_id
                        WHERE pc.conversation_id = c.id
                        ORDER BY 
                            CASE WHEN pc.compte_id = $2 THEN 0 ELSE 1 END,
                            pc.role_participant,
                            pc.date_ajout
                    ) p
                ) as participants
             FROM CONVERSATIONS c
             WHERE c.id = $1`,
            [conversationId, userId]
        );

        if (result.rows.length === 0) {
            return null;
        }

        const conversation = result.rows[0];
        
        // Parser les participants
        if (conversation.participants) {
            conversation.participants = JSON.parse(conversation.participants);
            
            // Déterminer le rôle de l'utilisateur courant
            const monParticipant = conversation.participants.find(p => p.compte_id === userId);
            conversation.mon_role = monParticipant?.role_participant;
            conversation.mes_notifications = monParticipant?.notifications_actives;
            conversation.mon_surnom = monParticipant?.surnom_dans_conversation;
        }

        return conversation;
    }
}

module.exports = new ConversationController();