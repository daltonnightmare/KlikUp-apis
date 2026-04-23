// src/controllers/messagerie/MessageController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError, AuthorizationError } = require('../../utils/errors/AppError');
const NotificationService = require('../../services/notification/NotificationService');
const FileService = require('../../services/file/FileService');
const { v4: uuidv4 } = require('uuid');
const sanitizeHtml = require('sanitize-html');

class MessageController {
    /**
     * Envoyer un message
     * @route POST /api/v1/messagerie/conversations/:conversationId/messages
     */
    async send(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { conversationId } = req.params;
            const {
                contenu_message,
                type_message = 'TEXTE',
                est_important = false,
                est_silencieux = false,
                message_parent_id,
                reponse_a_id,
                mentions_comptes = [],
                metadata = {}
            } = req.body;

            // Vérifier que l'utilisateur est participant et peut écrire
            const participant = await client.query(
                `SELECT pc.*, c.est_verrouille, c.est_archive
                 FROM PARTICIPANTS_CONVERSATION pc
                 JOIN CONVERSATIONS c ON c.id = pc.conversation_id
                 WHERE pc.conversation_id = $1 
                   AND pc.compte_id = $2 
                   AND pc.est_actif = true
                   AND pc.est_bloque = false`,
                [conversationId, req.user.id]
            );

            if (participant.rows.length === 0) {
                throw new AuthorizationError('Vous ne pouvez pas envoyer de message dans cette conversation');
            }

            const conv = participant.rows[0];

            if (conv.est_verrouille) {
                throw new AuthorizationError('Cette conversation est verrouillée');
            }

            if (conv.est_archive) {
                throw new AuthorizationError('Cette conversation est archivée');
            }

            // Vérifier les permissions d'écriture
            const permissions = conv.permissions || {};
            if (permissions.peut_ecrire === false) {
                throw new AuthorizationError('Vous n\'avez pas la permission d\'écrire dans cette conversation');
            }

            // Sanitizer le contenu HTML
            let contenuSecurise = contenu_message;
            if (type_message === 'TEXTE') {
                contenuSecurise = sanitizeHtml(contenu_message, {
                    allowedTags: ['b', 'i', 'em', 'strong', 'a', 'code', 'pre'],
                    allowedAttributes: {
                        'a': ['href', 'target']
                    }
                });
            }

            // Créer le message
            const result = await client.query(
                `INSERT INTO MESSAGES (
                    uuid_message, conversation_id, expediteur_id, message_parent_id,
                    contenu_message, contenu_formatte, type_message, est_important,
                    est_silencieux, reponse_a_id, mentions_comptes, metadata,
                    adresse_ip, user_agent, statut
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'ENVOYE')
                RETURNING *`,
                [
                    uuidv4(), conversationId, req.user.id, message_parent_id,
                    contenuSecurise, contenu_message, type_message, est_important,
                    est_silencieux, reponse_a_id, mentions_comptes,
                    JSON.stringify(metadata), req.ip, req.headers['user-agent']
                ]
            );

            const message = result.rows[0];

            // Gérer les pièces jointes si présentes
            if (req.files && req.files.length > 0) {
                await this.handleAttachments(message.id, req.files, client);
            }

            // Notifier les participants mentionnés
            if (mentions_comptes.length > 0) {
                await this.notifyMentions(message, mentions_comptes, client);
            }

            // Notifier les autres participants (sauf si message silencieux)
            if (!est_silencieux) {
                await this.notifyParticipants(message, conversationId, req.user.id, client);
            }

            // Mettre à jour la date de dernière activité du participant
            await client.query(
                `UPDATE PARTICIPANTS_CONVERSATION 
                 SET date_derniere_activite = NOW()
                 WHERE conversation_id = $1 AND compte_id = $2`,
                [conversationId, req.user.id]
            );

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: message,
                message: 'Message envoyé'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les messages d'une conversation
     * @route GET /api/v1/messagerie/conversations/:conversationId/messages
     */
    async getMessages(req, res, next) {
        try {
            const { conversationId } = req.params;
            const {
                before,
                after,
                limit = 50,
                around,
                type_message,
                search
            } = req.query;

            // Vérifier que l'utilisateur est participant
            const participant = await db.query(
                'SELECT id FROM PARTICIPANTS_CONVERSATION WHERE conversation_id = $1 AND compte_id = $2',
                [conversationId, req.user.id]
            );

            if (participant.rows.length === 0) {
                throw new AuthorizationError('Vous n\'êtes pas dans cette conversation');
            }

            let query = `
                SELECT m.*,
                       exp.nom_utilisateur_compte as expediteur_nom,
                       exp.photo_profil_compte as expediteur_photo,
                       exp.email as expediteur_email,
                       (
                           SELECT json_agg(pj)
                           FROM (
                               SELECT id, nom_fichier, type_fichier, mime_type,
                                      taille_fichier, url_telechargement, thumbnail_url
                               FROM PIECES_JOINTES
                               WHERE message_id = m.id
                           ) pj
                       ) as pieces_jointes,
                       (
                           SELECT json_agg(r)
                           FROM (
                               SELECT emoji, compte_id, date_reaction,
                                      cmp.nom_utilisateur_compte as auteur_nom
                               FROM REACTIONS_MESSAGES rm
                               JOIN COMPTES cmp ON cmp.id = rm.compte_id
                               WHERE rm.message_id = m.id
                           ) r
                       ) as reactions
                FROM MESSAGES m
                JOIN COMPTES exp ON exp.id = m.expediteur_id
                WHERE m.conversation_id = $1
                  AND m.date_suppression IS NULL
            `;

            const params = [conversationId];
            let paramIndex = 2;

            if (before) {
                query += ` AND m.date_envoi < $${paramIndex}`;
                params.push(new Date(before));
                paramIndex++;
            }

            if (after) {
                query += ` AND m.date_envoi > $${paramIndex}`;
                params.push(new Date(after));
                paramIndex++;
            }

            if (around) {
                // Récupérer les messages autour d'un ID spécifique
                const aroundMsg = await db.query(
                    'SELECT date_envoi FROM MESSAGES WHERE id = $1',
                    [around]
                );
                if (aroundMsg.rows.length > 0) {
                    const date = aroundMsg.rows[0].date_envoi;
                    query += ` AND m.date_envoi BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
                    params.push(
                        new Date(new Date(date).setHours(date.getHours() - 1)),
                        new Date(new Date(date).setHours(date.getHours() + 1))
                    );
                    paramIndex += 2;
                }
            }

            if (type_message) {
                query += ` AND m.type_message = $${paramIndex}`;
                params.push(type_message);
                paramIndex++;
            }

            if (search) {
                query += ` AND m.contenu_message ILIKE $${paramIndex}`;
                params.push(`%${search}%`);
                paramIndex++;
            }

            query += ` ORDER BY m.date_envoi DESC LIMIT $${paramIndex}`;
            params.push(parseInt(limit));

            const result = await db.query(query, params);

            // Marquer les messages comme lus
            if (result.rows.length > 0) {
                await this._markMessagesAsRead(conversationId, req.user.id);
            }

            // Grouper les messages par date
            const messages = this.groupMessagesByDate(result.rows);

            res.json({
                success: true,
                data: messages,
                has_more: result.rows.length === parseInt(limit)
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Modifier un message
     * @route PUT /api/v1/messagerie/messages/:id
     */
    async update(req, res, next) {
        try {
            const { id } = req.params;
            const { contenu_message } = req.body;

            // Vérifier que l'utilisateur est l'auteur
            const message = await db.query(
                'SELECT * FROM MESSAGES WHERE id = $1 AND expediteur_id = $2',
                [id, req.user.id]
            );

            if (message.rows.length === 0) {
                throw new NotFoundError('Message non trouvé ou vous n\'êtes pas l\'auteur');
            }

            // Sauvegarder l'historique
            const historique = message.rows[0].historique_modifications || [];
            historique.push({
                contenu: message.rows[0].contenu_message,
                date: new Date()
            });

            const contenuSecurise = sanitizeHtml(contenu_message, {
                allowedTags: ['b', 'i', 'em', 'strong', 'a', 'code', 'pre'],
                allowedAttributes: {
                    'a': ['href', 'target']
                }
            });

            await db.query(
                `UPDATE MESSAGES 
                 SET contenu_message = $1,
                     contenu_formatte = $2,
                     statut = 'MODIFIE',
                     date_modification = NOW(),
                     historique_modifications = $3
                 WHERE id = $4`,
                [contenuSecurise, contenu_message, JSON.stringify(historique), id]
            );

            res.json({
                success: true,
                message: 'Message modifié'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Supprimer un message (soft delete)
     * @route DELETE /api/v1/messagerie/messages/:id
     */
    async delete(req, res, next) {
        try {
            const { id } = req.params;
            const { motif } = req.body;

            // Vérifier les droits (auteur ou admin)
            const message = await db.query(
                `SELECT m.*, pc.est_administrateur
                 FROM MESSAGES m
                 JOIN PARTICIPANTS_CONVERSATION pc ON pc.conversation_id = m.conversation_id AND pc.compte_id = $2
                 WHERE m.id = $1`,
                [id, req.user.id]
            );

            if (message.rows.length === 0) {
                throw new NotFoundError('Message non trouvé');
            }

            const msg = message.rows[0];

            if (msg.expediteur_id !== req.user.id && !msg.est_administrateur) {
                throw new AuthorizationError('Vous ne pouvez pas supprimer ce message');
            }

            await db.query(
                `UPDATE MESSAGES 
                 SET statut = 'SUPPRIME',
                     date_suppression = NOW(),
                     supprime_par = $1,
                     motif_suppression = $2
                 WHERE id = $3`,
                [req.user.id, motif, id]
            );

            res.json({
                success: true,
                message: 'Message supprimé'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Marquer les messages comme lus
     * @route POST /api/v1/messagerie/conversations/:conversationId/lire
     */
    async markAsRead(req, res, next) {
        try {
            const { conversationId } = req.params;

            /*await db.query(
                `SELECT marquer_messages_comme_lus($1, $2)`,
                [conversationId, req.user.id]
            );*/
            await this._markMessagesAsRead(conversationId, req.user.id)

            res.json({
                success: true,
                message: 'Messages marqués comme lus'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Rechercher des messages
     * @route GET /api/v1/messagerie/recherche
     */
    async searchMessages(req, res, next) {
        try {
            const {
                q,
                conversation_id,
                expediteur_id,
                date_debut,
                date_fin,
                page = 1,
                limit = 50
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT m.*,
                       c.titre_conversation,
                       exp.nom_utilisateur_compte as expediteur_nom,
                       exp.photo_profil_compte as expediteur_photo,
                       COUNT(*) OVER() as total_count
                FROM MESSAGES m
                JOIN CONVERSATIONS c ON c.id = m.conversation_id
                JOIN COMPTES exp ON exp.id = m.expediteur_id
                JOIN PARTICIPANTS_CONVERSATION pc ON pc.conversation_id = m.conversation_id
                WHERE pc.compte_id = $1
                  AND m.date_suppression IS NULL
            `;

            const params = [req.user.id];
            let paramIndex = 2;

            if (q) {
                query += ` AND m.contenu_message ILIKE $${paramIndex}`;
                params.push(`%${q}%`);
                paramIndex++;
            }

            if (conversation_id) {
                query += ` AND m.conversation_id = $${paramIndex}`;
                params.push(conversation_id);
                paramIndex++;
            }

            if (expediteur_id) {
                query += ` AND m.expediteur_id = $${paramIndex}`;
                params.push(expediteur_id);
                paramIndex++;
            }

            if (date_debut) {
                query += ` AND m.date_envoi >= $${paramIndex}`;
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                query += ` AND m.date_envoi <= $${paramIndex}`;
                params.push(date_fin);
                paramIndex++;
            }

            query += ` ORDER BY m.date_envoi DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
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
     * Gérer les pièces jointes
     */
    async handleAttachments(messageId, files, client) {
        for (const file of files) {
            const filePath = await FileService.upload(file, 'messagerie/pieces-jointes');
            
            await client.query(
                `INSERT INTO PIECES_JOINTES (
                    message_id, nom_fichier, type_fichier, mime_type,
                    taille_fichier, chemin_fichier, url_telechargement
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    messageId,
                    file.originalname,
                    this.determineFileType(file.mimetype),
                    file.mimetype,
                    file.size,
                    filePath,
                    `/uploads/messagerie/${file.filename}`
                ]
            );
        }
    }

    /**
     * Déterminer le type de fichier
     */
    determineFileType(mimeType) {
        if (mimeType.startsWith('image/')) return 'IMAGE';
        if (mimeType.startsWith('video/')) return 'VIDEO';
        if (mimeType.startsWith('audio/')) return 'AUDIO';
        return 'DOCUMENT';
    }

    /**
     * Notifier les participants mentionnés
     */
    async notifyMentions(message, mentions, client) {
        for (const compteId of mentions) {
            if (compteId !== message.expediteur_id) {
                await NotificationService.send({
                    destinataire_id: compteId,
                    type: 'MENTION',
                    titre: 'Vous avez été mentionné',
                    corps: `${message.expediteur_nom} vous a mentionné dans un message`,
                    entite_source_type: 'MESSAGE',
                    entite_source_id: message.id
                });
            }
        }
    }

    /**
     * Notifier les autres participants
     */
    async notifyParticipants(message, conversationId, expediteurId, client) {
        const participants = await client.query(
            `SELECT compte_id 
             FROM PARTICIPANTS_CONVERSATION 
             WHERE conversation_id = $1 
               AND compte_id != $2 
               AND est_actif = true 
               AND notifications_actives = true`,
            [conversationId, expediteurId]
        );

        for (const p of participants.rows) {
            await NotificationService.send({
                destinataire_id: p.compte_id,
                type: 'NOUVEAU_MESSAGE',
                titre: 'Nouveau message',
                corps: `Nouveau message dans la conversation`,
                entite_source_type: 'MESSAGE',
                entite_source_id: message.id
            });
        }
    }

    /**
     * Grouper les messages par date
     */
    groupMessagesByDate(messages) {
        const groups = {};
        
        for (const msg of messages) {
            const date = new Date(msg.date_envoi).toLocaleDateString('fr-FR', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            
            if (!groups[date]) {
                groups[date] = [];
            }
            
            groups[date].push(msg);
        }
        
        return groups;
    }

    /**
     * MÉTHODE PRIVÉE: Marquer les messages comme lus
     * @param {number} conversationId - ID de la conversation
     * @param {number} userId - ID de l'utilisateur
     */
    async _markMessagesAsRead(conversationId, userId) {
        try {
            // Mettre à jour le statut des messages
            await db.query(
                `UPDATE MESSAGES m
                 SET statut = 'LU'
                 FROM PARTICIPANTS_CONVERSATION pc
                 WHERE m.conversation_id = $1
                   AND m.expediteur_id != $2
                   AND m.statut != 'LU'
                   AND pc.conversation_id = m.conversation_id
                   AND pc.compte_id = $2`,
                [conversationId, userId]
            );

            // Mettre à jour les messages non lus du participant
            await db.query(
                `UPDATE PARTICIPANTS_CONVERSATION
                 SET messages_non_lus = 0,
                     date_derniere_lecture = NOW(),
                     dernier_message_lu_id = (
                         SELECT id FROM MESSAGES 
                         WHERE conversation_id = $1 
                         ORDER BY date_envoi DESC 
                         LIMIT 1
                     )
                 WHERE conversation_id = $1 AND compte_id = $2`,
                [conversationId, userId]
            );

            // Appeler la fonction PostgreSQL si elle existe
            try {
                await db.query(
                    `SELECT marquer_messages_comme_lus($1, $2)`,
                    [conversationId, userId]
                );
            } catch (e) {
                // La fonction n'existe pas, ignorer
                console.log('Fonction marquer_messages_comme_lus non disponible');
            }

        } catch (error) {
            console.error('Erreur _markMessagesAsRead:', error);
            throw error;
        }
    }
}

module.exports = new MessageController();