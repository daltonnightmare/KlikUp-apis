// src/controllers/messagerie/ContactEntiteController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError, AuthorizationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const NotificationService = require('../../services/notification/NotificationService');
const { v4: uuidv4 } = require('uuid');

/**
 * Types d'entités supportés (constante en dehors de la classe)
 */
const ENTITE_TYPES = {
    COMPAGNIE: 'COMPAGNIE_TRANSPORT',
    EMPLACEMENT_TRANSPORT: 'EMPLACEMENT_TRANSPORT',
    RESTAURANT: 'RESTAURANT_FAST_FOOD',
    EMPLACEMENT_RESTAURANT: 'EMPLACEMENT_RESTAURANT',
    BOUTIQUE: 'BOUTIQUE',
    ENTREPRISE_LIVRAISON: 'ENTREPRISE_LIVRAISON'
};

class ContactEntiteController {
    
    // Constructeur pour binder les méthodes si nécessaire
    constructor() {
        this.contacterEntite = this.contacterEntite.bind(this);
        this.getMesConversationsEntites = this.getMesConversationsEntites.bind(this);
        this.getConversationsEntite = this.getConversationsEntite.bind(this);
        this.marquerResolue = this.marquerResolue.bind(this);
        this.getEntitesDisponibles = this.getEntitesDisponibles.bind(this);
        this.getEntiteDetails = this.getEntiteDetails.bind(this);
    }

    /**
     * Contacter une entité (entreprise, boutique, restaurant, livraison)
     * @route POST /api/v1/messagerie/contacter-entite
     */
    async contacterEntite(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const {
                entite_type,
                entite_id,
                sujet,
                message,
                type_conversation = 'SERVICE_CLIENT',
                reference_id,
                reference_type
            } = req.body;

            // Validation - Utiliser la constante ENTITE_TYPES
            if (!Object.values(ENTITE_TYPES).includes(entite_type)) {
                throw new ValidationError(`Type d'entité invalide. Types acceptés: ${Object.values(ENTITE_TYPES).join(', ')}`);
            }

            if (!entite_id) {
                throw new ValidationError('ID de l\'entité requis');
            }

            if (!message || message.trim().length < 3) {
                throw new ValidationError('Message requis (minimum 3 caractères)');
            }

            // Récupérer les informations de l'entité
            const entiteInfo = await this.getEntiteInfo(client, entite_type, entite_id);
            
            if (!entiteInfo) {
                throw new NotFoundError('Entité non trouvée');
            }

            // Vérifier si une conversation existe déjà
            let conversation = null;
            if (reference_id && reference_type) {
                conversation = await this.findExistingServiceConversation(
                    client,
                    req.user.id,
                    entite_type,
                    entite_id,
                    reference_type,
                    reference_id
                );
            }

            // Créer une nouvelle conversation si nécessaire
            if (!conversation) {
                const titre = this.generateConversationTitle(entiteInfo, sujet, reference_type, reference_id);
                
                const result = await client.query(
                    `INSERT INTO CONVERSATIONS (
                        uuid_conversation, type_conversation, titre_conversation,
                        description_conversation, entite_type, entite_id,
                        metadata, cree_par, est_prive
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
                    RETURNING *`,
                    [
                        uuidv4(),
                        type_conversation,
                        titre,
                        message.substring(0, 500),
                        entite_type,
                        entite_id,
                        JSON.stringify({
                            entite_nom: entiteInfo.nom,
                            sujet: sujet || null,
                            reference_type: reference_type || null,
                            reference_id: reference_id || null,
                            contacte_par: req.user.id,
                            date_contact: new Date().toISOString()
                        }),
                        req.user.id
                    ]
                );

                conversation = result.rows[0];

                // Ajouter l'utilisateur comme participant
                await client.query(
                    `INSERT INTO PARTICIPANTS_CONVERSATION (
                        conversation_id, compte_id, role_participant,
                        est_administrateur, est_actif, notifications_actives
                    ) VALUES ($1, $2, $3, $4, true, true)`,
                    [conversation.id, req.user.id, 'PARTICIPANT', false]
                );

                // Ajouter les administrateurs/staff de l'entité comme participants
                await this.addEntiteStaffAsParticipants(client, conversation.id, entite_type, entite_id);
            }

            // Envoyer le premier message
            const messageResult = await client.query(
                `INSERT INTO MESSAGES (
                    uuid_message, conversation_id, expediteur_id,
                    contenu_message, type_message, statut,
                    adresse_ip, user_agent, metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING *`,
                [
                    uuidv4(),
                    conversation.id,
                    req.user.id,
                    message,
                    'TEXTE',
                    'ENVOYE',
                    req.ip,
                    req.headers['user-agent'],
                    JSON.stringify({
                        sujet: sujet || null,
                        entite_type,
                        entite_id,
                        entite_nom: entiteInfo.nom
                    })
                ]
            );

            // Mettre à jour les statistiques de la conversation
            await client.query(
                `UPDATE CONVERSATIONS 
                 SET nombre_messages = nombre_messages + 1,
                     dernier_message_id = $1,
                     date_dernier_message = NOW(),
                     date_mise_a_jour = NOW()
                 WHERE id = $2`,
                [messageResult.rows[0].id, conversation.id]
            );

            // Notifier les staffs de l'entité
            await this.notifyEntiteStaff(client, conversation.id, entite_type, entite_id, req.user, message);

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: {
                    conversation_id: conversation.id,
                    conversation_uuid: conversation.uuid_conversation,
                    message: messageResult.rows[0],
                    entite: entiteInfo
                },
                message: 'Message envoyé à l\'entité'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer toutes les conversations avec des entités
     * @route GET /api/v1/messagerie/conversations-entites
     */
    async getMesConversationsEntites(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                entite_type,
                statut = 'actives'
            } = req.query;

            const offset = (page - 1) * limit;
            const userId = req.user.id;

            let query = `
                SELECT 
                    c.id,
                    c.uuid_conversation,
                    c.titre_conversation,
                    c.type_conversation,
                    c.entite_type,
                    c.entite_id,
                    c.metadata,
                    c.date_creation,
                    c.date_dernier_message,
                    c.nombre_messages,
                    c.nombre_participants,
                    pc.role_participant,
                    pc.messages_non_lus,
                    pc.est_bloque,
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
                        SELECT COALESCE(json_agg(DISTINCT jsonb_build_object(
                            'id', pc2.compte_id,
                            'nom', cmp.nom_utilisateur_compte,
                            'photo', cmp.photo_profil_compte,
                            'role', pc2.role_participant
                        )), '[]'::json)
                        FROM PARTICIPANTS_CONVERSATION pc2
                        JOIN COMPTES cmp ON cmp.id = pc2.compte_id
                        WHERE pc2.conversation_id = c.id
                          AND pc2.est_actif = true
                    ) as participants,
                    COUNT(*) OVER() as total_count
                FROM CONVERSATIONS c
                JOIN PARTICIPANTS_CONVERSATION pc ON pc.conversation_id = c.id
                WHERE pc.compte_id = $1
                  AND c.entite_type IS NOT NULL
                  AND c.est_archive = false
            `;

            const params = [userId];
            let paramIndex = 2;

            if (entite_type) {
                query += ` AND c.entite_type = $${paramIndex}`;
                params.push(entite_type);
                paramIndex++;
            }

            if (statut === 'resolues') {
                query += ` AND c.metadata->>'statut' = 'RESOLUE'`;
            } else if (statut === 'actives') {
                query += ` AND (c.metadata->>'statut' IS NULL OR c.metadata->>'statut' != 'RESOLUE')`;
            }

            query += ` ORDER BY c.date_dernier_message DESC NULLS LAST
                       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Enrichir avec les informations des entités
            const conversations = await Promise.all(result.rows.map(async (conv) => {
                const entiteInfo = await this.getEntiteInfoSimple(conv.entite_type, conv.entite_id);
                return {
                    ...conv,
                    entite: entiteInfo,
                    participants: conv.participants || []
                };
            }));

            // Statistiques
            const stats = await db.query(
                `SELECT 
                    COUNT(*) as total_conversations,
                    COUNT(*) FILTER (WHERE messages_non_lus > 0) as conversations_non_lues,
                    COUNT(DISTINCT entite_type) as types_entites_contactees
                 FROM CONVERSATIONS c
                 JOIN PARTICIPANTS_CONVERSATION pc ON pc.conversation_id = c.id
                 WHERE pc.compte_id = $1
                   AND c.entite_type IS NOT NULL
                   AND c.est_archive = false`,
                [userId]
            );

            res.json({
                success: true,
                data: {
                    conversations,
                    stats: stats.rows[0] || { total_conversations: 0, conversations_non_lues: 0, types_entites_contactees: 0 }
                },
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(total),
                    pages: Math.ceil(parseInt(total) / parseInt(limit))
                }
            });

        } catch (error) {
            console.error('Erreur getMesConversationsEntites:', error);
            next(error);
        }
    }

    /**
     * Récupérer les conversations d'une entité (pour les staffs)
     * @route GET /api/v1/messagerie/entites/:entiteType/:entiteId/conversations
     */
    async getConversationsEntite(req, res, next) {
        try {
            const { entiteType, entiteId } = req.params;
            const { page = 1, limit = 20, statut = 'actives' } = req.query;
            const offset = (page - 1) * limit;

            // Vérifier que l'utilisateur a le droit de voir ces conversations
            const hasAccess = await this.userHasEntiteAccess(req.user.id, entiteType, entiteId);
            if (!hasAccess) {
                throw new AuthorizationError('Vous n\'avez pas accès aux conversations de cette entité');
            }

            let query = `
                SELECT 
                    c.id,
                    c.uuid_conversation,
                    c.titre_conversation,
                    c.type_conversation,
                    c.metadata,
                    c.date_creation,
                    c.date_dernier_message,
                    c.nombre_messages,
                    c.nombre_participants,
                    (
                        SELECT row_to_json(m)
                        FROM (
                            SELECT m2.id, m2.contenu_message, m2.date_envoi,
                                   m2.type_message,
                                   exp.nom_utilisateur_compte as expediteur_nom,
                                   exp.photo_profil_compte as expediteur_photo,
                                   exp.id as expediteur_id
                            FROM MESSAGES m2
                            JOIN COMPTES exp ON exp.id = m2.expediteur_id
                            WHERE m2.conversation_id = c.id
                              AND m2.date_suppression IS NULL
                            ORDER BY m2.date_envoi DESC
                            LIMIT 1
                        ) m
                    ) as dernier_message,
                    (
                        SELECT COALESCE(json_agg(DISTINCT jsonb_build_object(
                            'id', pc2.compte_id,
                            'nom', cmp.nom_utilisateur_compte,
                            'photo', cmp.photo_profil_compte,
                            'role', pc2.role_participant
                        )), '[]'::json)
                        FROM PARTICIPANTS_CONVERSATION pc2
                        JOIN COMPTES cmp ON cmp.id = pc2.compte_id
                        WHERE pc2.conversation_id = c.id
                          AND pc2.est_actif = true
                    ) as participants,
                    COUNT(*) OVER() as total_count
                FROM CONVERSATIONS c
                WHERE c.entite_type = $1
                  AND c.entite_id = $2
                  AND c.est_archive = false
            `;

            const params = [entiteType, entiteId];
            let paramIndex = 3;

            if (statut === 'resolues') {
                query += ` AND c.metadata->>'statut' = 'RESOLUE'`;
            } else if (statut === 'actives') {
                query += ` AND (c.metadata->>'statut' IS NULL OR c.metadata->>'statut' != 'RESOLUE')`;
            }

            query += ` ORDER BY c.date_dernier_message DESC NULLS LAST
                       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Statistiques pour cette entité
            const stats = await db.query(
                `SELECT 
                    COUNT(*) as total_conversations,
                    COUNT(*) FILTER (WHERE (c.metadata->>'statut' IS NULL OR c.metadata->>'statut' != 'RESOLUE')) as conversations_actives,
                    COUNT(*) FILTER (WHERE c.metadata->>'statut' = 'RESOLUE') as conversations_resolues,
                    COALESCE(AVG((c.metadata->>'temps_reponse')::int), 0) as temps_reponse_moyen
                 FROM CONVERSATIONS c
                 WHERE c.entite_type = $1
                   AND c.entite_id = $2
                   AND c.est_archive = false`,
                [entiteType, entiteId]
            );

            res.json({
                success: true,
                data: {
                    conversations: result.rows.map(conv => ({
                        ...conv,
                        participants: conv.participants || []
                    })),
                    stats: stats.rows[0] || { total_conversations: 0, conversations_actives: 0, conversations_resolues: 0, temps_reponse_moyen: 0 }
                },
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(total),
                    pages: Math.ceil(parseInt(total) / parseInt(limit))
                }
            });

        } catch (error) {
            console.error('Erreur getConversationsEntite:', error);
            next(error);
        }
    }

    /**
     * Marquer une conversation comme résolue
     * @route PATCH /api/v1/messagerie/conversations-entites/:conversationId/resoudre
     */
    async marquerResolue(req, res, next) {
        try {
            const { conversationId } = req.params;
            const { commentaire } = req.body;

            // Vérifier que l'utilisateur est staff de l'entité ou admin
            const conversation = await db.query(
                `SELECT c.*, pc.compte_id as participant_id
                 FROM CONVERSATIONS c
                 JOIN PARTICIPANTS_CONVERSATION pc ON pc.conversation_id = c.id
                 WHERE c.id = $1 AND pc.compte_id = $2`,
                [conversationId, req.user.id]
            );

            if (conversation.rows.length === 0) {
                throw new NotFoundError('Conversation non trouvée');
            }

            const hasAccess = await this.userHasEntiteAccess(
                req.user.id,
                conversation.rows[0].entite_type,
                conversation.rows[0].entite_id
            );

            if (!hasAccess) {
                throw new AuthorizationError('Seul le staff de l\'entité peut marquer une conversation comme résolue');
            }

            const metadata = conversation.rows[0].metadata || {};
            metadata.statut = 'RESOLUE';
            metadata.date_resolution = new Date().toISOString();
            metadata.resolu_par = req.user.id;
            metadata.commentaire_resolution = commentaire;

            await db.query(
                `UPDATE CONVERSATIONS 
                 SET metadata = $1,
                     date_modification = NOW()
                 WHERE id = $2`,
                [JSON.stringify(metadata), conversationId]
            );

            // Envoyer un message système
            await db.query(
                `INSERT INTO MESSAGES (
                    uuid_message, conversation_id, expediteur_id,
                    contenu_message, type_message, est_systeme, statut
                ) VALUES ($1, $2, $3, $4, 'SYSTEME', true, 'ENVOYE')`,
                [
                    uuidv4(),
                    conversationId,
                    req.user.id,
                    `✅ Cette conversation a été marquée comme résolue.${commentaire ? `\n\nCommentaire: ${commentaire}` : ''}`
                ]
            );

            res.json({
                success: true,
                message: 'Conversation marquée comme résolue'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Obtenir les entités disponibles pour contact
     * @route GET /api/v1/messagerie/entites-disponibles
     */
    async getEntitesDisponibles(req, res, next) {
        try {
            const { type, recherche, limit = 20 } = req.query;

            const result = {
                compagnies: [],
                restaurants: [],
                boutiques: [],
                entreprises_livraison: []
            };

            // Récupérer les compagnies de transport
            if (!type || type === 'COMPAGNIE') {
                const compagnies = await db.query(
                    `SELECT 
                        id, nom_compagnie as nom, description_compagnie as description,
                        logo_compagnie as logo, est_actif
                     FROM COMPAGNIESTRANSPORT
                     WHERE est_actif = true AND est_supprime = false
                     ${recherche ? `AND nom_compagnie ILIKE $1` : ''}
                     ORDER BY nom_compagnie
                     LIMIT $${recherche ? 2 : 1}`,
                    recherche ? [`%${recherche}%`, parseInt(limit)] : [parseInt(limit)]
                );
                result.compagnies = compagnies.rows;
            }

            // Récupérer les restaurants
            if (!type || type === 'RESTAURANT') {
                const restaurants = await db.query(
                    `SELECT 
                        id, nom_restaurant_fast_food as nom, description_restaurant_fast_food as description,
                        logo_restaurant as logo, est_actif
                     FROM RESTAURANTSFASTFOOD
                     WHERE est_actif = true AND est_supprime = false
                     ${recherche ? `AND nom_restaurant_fast_food ILIKE $1` : ''}
                     ORDER BY nom_restaurant_fast_food
                     LIMIT $${recherche ? 2 : 1}`,
                    recherche ? [`%${recherche}%`, parseInt(limit)] : [parseInt(limit)]
                );
                result.restaurants = restaurants.rows;
            }

            // Récupérer les boutiques
            if (!type || type === 'BOUTIQUE') {
                const boutiques = await db.query(
                    `SELECT 
                        id, nom_boutique as nom, description_boutique as description,
                        logo_boutique as logo, est_actif
                     FROM BOUTIQUES
                     WHERE est_actif = true AND est_supprime = false
                     ${recherche ? `AND nom_boutique ILIKE $1` : ''}
                     ORDER BY nom_boutique
                     LIMIT $${recherche ? 2 : 1}`,
                    recherche ? [`%${recherche}%`, parseInt(limit)] : [parseInt(limit)]
                );
                result.boutiques = boutiques.rows;
            }

            // Récupérer les entreprises de livraison
            if (!type || type === 'LIVRAISON') {
                const livraisons = await db.query(
                    `SELECT 
                        id, nom_entreprise_livraison as nom, description_entreprise_livraison as description,
                        logo_entreprise_livraison as logo, est_actif
                     FROM ENTREPRISE_LIVRAISON
                     WHERE est_actif = true
                     ${recherche ? `AND nom_entreprise_livraison ILIKE $1` : ''}
                     ORDER BY nom_entreprise_livraison
                     LIMIT $${recherche ? 2 : 1}`,
                    recherche ? [`%${recherche}%`, parseInt(limit)] : [parseInt(limit)]
                );
                result.entreprises_livraison = livraisons.rows;
            }

            res.json({
                success: true,
                data: result
            });

        } catch (error) {
            console.error('Erreur getEntitesDisponibles:', error);
            next(error);
        }
    }

    /**
     * Obtenir les détails d'une entité
     * @route GET /api/v1/messagerie/entites/:type/:id
     */
    async getEntiteDetails(req, res, next) {
        try {
            const { type, id } = req.params;

            const entiteInfo = await this.getEntiteInfoComplete(type, id);

            if (!entiteInfo) {
                throw new NotFoundError('Entité non trouvée');
            }

            // Récupérer les horaires
            const horaires = await db.query(
                `SELECT * FROM HORAIRES 
                 WHERE entite_type = $1 AND entite_id = $2
                 ORDER BY jour_semaine`,
                [type, id]
            );

            // Récupérer la note moyenne
            const note = await db.query(
                `SELECT 
                    ROUND(AVG(note_globale)::numeric, 2) as note_moyenne,
                    COUNT(*) as nombre_avis
                 FROM AVIS
                 WHERE entite_type = $1 
                   AND entite_id = $2 
                   AND statut = 'PUBLIE'`,
                [type, id]
            );

            res.json({
                success: true,
                data: {
                    ...entiteInfo,
                    horaires: horaires.rows,
                    note: note.rows[0] || { note_moyenne: null, nombre_avis: 0 }
                }
            });

        } catch (error) {
            next(error);
        }
    }

    // ==================== MÉTHODES PRIVÉES ====================

    /**
     * Récupérer les informations d'une entité
     */
    async getEntiteInfo(client, entite_type, entite_id) {
        let query = '';
        let result;

        switch (entite_type) {
            case ENTITE_TYPES.COMPAGNIE:
                query = `SELECT id, nom_compagnie as nom, 'COMPAGNIE_TRANSPORT' as type FROM COMPAGNIESTRANSPORT WHERE id = $1 AND est_supprime = false`;
                break;
            case ENTITE_TYPES.EMPLACEMENT_TRANSPORT:
                query = `SELECT et.id, et.nom_emplacement as nom, 'EMPLACEMENT_TRANSPORT' as type, et.compagnie_id
                         FROM EMPLACEMENTSTRANSPORT et
                         WHERE et.id = $1 AND et.est_actif = true`;
                break;
            case ENTITE_TYPES.RESTAURANT:
                query = `SELECT id, nom_restaurant_fast_food as nom, 'RESTAURANT_FAST_FOOD' as type FROM RESTAURANTSFASTFOOD WHERE id = $1 AND est_supprime = false`;
                break;
            case ENTITE_TYPES.EMPLACEMENT_RESTAURANT:
                query = `SELECT er.id, er.nom_emplacement as nom, 'EMPLACEMENT_RESTAURANT' as type, er.id_restaurant_fast_food as restaurant_id
                         FROM EMPLACEMENTSRESTAURANTFASTFOOD er
                         WHERE er.id = $1 AND er.est_actif = true`;
                break;
            case ENTITE_TYPES.BOUTIQUE:
                query = `SELECT id, nom_boutique as nom, 'BOUTIQUE' as type FROM BOUTIQUES WHERE id = $1 AND est_supprime = false`;
                break;
            case ENTITE_TYPES.ENTREPRISE_LIVRAISON:
                query = `SELECT id, nom_entreprise_livraison as nom, 'ENTREPRISE_LIVRAISON' as type FROM ENTREPRISE_LIVRAISON WHERE id = $1 AND est_actif = true`;
                break;
            default:
                return null;
        }

        result = await client.query(query, [entite_id]);
        
        if (result.rows.length === 0) return null;
        
        return result.rows[0];
    }

    /**
     * Version simple sans client transactionnel
     */
    async getEntiteInfoSimple(entite_type, entite_id) {
        let query = '';

        switch (entite_type) {
            case ENTITE_TYPES.COMPAGNIE:
                query = `SELECT id, nom_compagnie as nom, logo_compagnie as logo FROM COMPAGNIESTRANSPORT WHERE id = $1`;
                break;
            case ENTITE_TYPES.EMPLACEMENT_TRANSPORT:
                query = `SELECT id, nom_emplacement as nom FROM EMPLACEMENTSTRANSPORT WHERE id = $1`;
                break;
            case ENTITE_TYPES.RESTAURANT:
                query = `SELECT id, nom_restaurant_fast_food as nom, logo_restaurant as logo FROM RESTAURANTSFASTFOOD WHERE id = $1`;
                break;
            case ENTITE_TYPES.EMPLACEMENT_RESTAURANT:
                query = `SELECT id, nom_emplacement as nom FROM EMPLACEMENTSRESTAURANTFASTFOOD WHERE id = $1`;
                break;
            case ENTITE_TYPES.BOUTIQUE:
                query = `SELECT id, nom_boutique as nom, logo_boutique as logo FROM BOUTIQUES WHERE id = $1`;
                break;
            case ENTITE_TYPES.ENTREPRISE_LIVRAISON:
                query = `SELECT id, nom_entreprise_livraison as nom, logo_entreprise_livraison as logo FROM ENTREPRISE_LIVRAISON WHERE id = $1`;
                break;
            default:
                return null;
        }

        const result = await db.query(query, [entite_id]);
        return result.rows[0] || null;
    }

    /**
     * Version complète avec détails
     */
    async getEntiteInfoComplete(entite_type, entite_id) {
        let query = '';

        switch (entite_type) {
            case ENTITE_TYPES.COMPAGNIE:
                query = `SELECT 
                            id, nom_compagnie as nom, description_compagnie as description,
                            logo_compagnie as logo, pourcentage_commission_plateforme,
                            portefeuille_compagnie, est_actif, date_creation
                         FROM COMPAGNIESTRANSPORT WHERE id = $1`;
                break;
            case ENTITE_TYPES.EMPLACEMENT_TRANSPORT:
                query = `SELECT 
                            et.id, et.nom_emplacement as nom, et.jours_ouverture_emplacement_transport,
                            et.portefeuille_emplacement, et.est_actif, et.date_creation,
                            c.nom_compagnie as compagnie_nom
                         FROM EMPLACEMENTSTRANSPORT et
                         LEFT JOIN COMPAGNIESTRANSPORT c ON c.id = et.compagnie_id
                         WHERE et.id = $1`;
                break;
            case ENTITE_TYPES.RESTAURANT:
                query = `SELECT 
                            id, nom_restaurant_fast_food as nom, description_restaurant_fast_food as description,
                            logo_restaurant as logo, pourcentage_commission_plateforme,
                            portefeuille_restaurant_fast_food, est_actif, date_creation
                         FROM RESTAURANTSFASTFOOD WHERE id = $1`;
                break;
            case ENTITE_TYPES.EMPLACEMENT_RESTAURANT:
                query = `SELECT 
                            er.id, er.nom_emplacement as nom, er.adresse_complete,
                            er.frais_livraison, er.heure_ouverture, er.heure_fermeture,
                            er.jours_ouverture_emplacement_restaurant, er.est_actif,
                            r.nom_restaurant_fast_food as restaurant_nom
                         FROM EMPLACEMENTSRESTAURANTFASTFOOD er
                         LEFT JOIN RESTAURANTSFASTFOOD r ON r.id = er.id_restaurant_fast_food
                         WHERE er.id = $1`;
                break;
            case ENTITE_TYPES.BOUTIQUE:
                query = `SELECT 
                            id, nom_boutique as nom, description_boutique as description,
                            logo_boutique as logo, pourcentage_commission_plateforme,
                            portefeuille_boutique, est_actif, date_creation
                         FROM BOUTIQUES WHERE id = $1`;
                break;
            case ENTITE_TYPES.ENTREPRISE_LIVRAISON:
                query = `SELECT 
                            id, nom_entreprise_livraison as nom, description_entreprise_livraison as description,
                            logo_entreprise_livraison as logo, pourcentage_commission_plateforme,
                            portefeuille_entreprise_livraison, est_actif, date_creation
                         FROM ENTREPRISE_LIVRAISON WHERE id = $1`;
                break;
            default:
                return null;
        }

        const result = await db.query(query, [entite_id]);
        return result.rows[0] || null;
    }

    /**
     * Vérifier si un utilisateur a accès à une entité (staff/admin)
     */
    async userHasEntiteAccess(userId, entite_type, entite_id) {
        // Vérifier si l'utilisateur est admin plateforme
        const user = await db.query(
            'SELECT compte_role FROM COMPTES WHERE id = $1',
            [userId]
        );

        if (user.rows[0]?.compte_role === 'ADMINISTRATEUR_PLATEFORME') {
            return true;
        }

        // Vérifier les rôles spécifiques à l'entité
        switch (entite_type) {
            case ENTITE_TYPES.COMPAGNIE:
                const compagnieAccess = await db.query(
                    `SELECT id FROM COMPTES_COMPAGNIES 
                     WHERE compte_id = $1 AND compagnie_id = $2
                     AND (role_dans_compagnie IN ('ADMINISTRATEUR_COMPAGNIE', 'STAFF_COMPAGNIE'))`,
                    [userId, entite_id]
                );
                return compagnieAccess.rows.length > 0;

            case ENTITE_TYPES.RESTAURANT:
                const restoAccess = await db.query(
                    `SELECT id FROM COMPTES_RESTAURANTS 
                     WHERE compte_id = $1 AND restaurant_id = $2
                     AND (role_dans_resto IN ('ADMINISTRATEUR_RESTAURANT_FAST_FOOD', 'STAFF_RESTAURANT_FAST_FOOD'))`,
                    [userId, entite_id]
                );
                return restoAccess.rows.length > 0;

            case ENTITE_TYPES.BOUTIQUE:
                const boutiqueAccess = await db.query(
                    `SELECT id FROM COMPTES_BOUTIQUES 
                     WHERE compte_id = $1 AND boutique_id = $2
                     AND (role_dans_boutique IN ('ADMINISTRATEUR_BOUTIQUE', 'STAFF_BOUTIQUE'))`,
                    [userId, entite_id]
                );
                return boutiqueAccess.rows.length > 0;

            case ENTITE_TYPES.ENTREPRISE_LIVRAISON:
                const livraisonAccess = await db.query(
                    `SELECT id FROM LIVREURS 
                     WHERE compte_id = $1 AND id_entreprise_livraison = $2 AND est_actif = true`,
                    [userId, entite_id]
                );
                return livraisonAccess.rows.length > 0;

            default:
                return false;
        }
    }

    /**
     * Trouver une conversation de service existante
     */
    async findExistingServiceConversation(client, userId, entite_type, entite_id, reference_type, reference_id) {
        const result = await client.query(
            `SELECT c.id
             FROM CONVERSATIONS c
             JOIN PARTICIPANTS_CONVERSATION pc ON pc.conversation_id = c.id
             WHERE c.entite_type = $1
               AND c.entite_id = $2
               AND c.metadata->>'reference_type' = $3
               AND c.metadata->>'reference_id' = $4
               AND pc.compte_id = $5
               AND c.est_archive = false
             LIMIT 1`,
            [entite_type, entite_id, reference_type, String(reference_id), userId]
        );

        return result.rows[0] || null;
    }

    /**
     * Générer un titre de conversation
     */
    generateConversationTitle(entiteInfo, sujet, reference_type, reference_id) {
        if (sujet) {
            return `${entiteInfo.nom} - ${sujet}`;
        }

        if (reference_type && reference_id) {
            return `${entiteInfo.nom} - ${reference_type} #${reference_id}`;
        }

        return `Contact ${entiteInfo.nom}`;
    }

    /**
     * Ajouter le staff de l'entité comme participants
     */
    async addEntiteStaffAsParticipants(client, conversationId, entite_type, entite_id) {
        let query = '';

        switch (entite_type) {
            case ENTITE_TYPES.COMPAGNIE:
                query = `
                    SELECT DISTINCT compte_id
                    FROM COMPTES_COMPAGNIES
                    WHERE compagnie_id = $1
                      AND (role_dans_compagnie IN ('ADMINISTRATEUR_COMPAGNIE', 'STAFF_COMPAGNIE'))
                `;
                break;
            case ENTITE_TYPES.RESTAURANT:
                query = `
                    SELECT DISTINCT compte_id
                    FROM COMPTES_RESTAURANTS
                    WHERE restaurant_id = $1
                      AND (role_dans_resto IN ('ADMINISTRATEUR_RESTAURANT_FAST_FOOD', 'STAFF_RESTAURANT_FAST_FOOD'))
                `;
                break;
            case ENTITE_TYPES.BOUTIQUE:
                query = `
                    SELECT DISTINCT compte_id
                    FROM COMPTES_BOUTIQUES
                    WHERE boutique_id = $1
                      AND (role_dans_boutique IN ('ADMINISTRATEUR_BOUTIQUE', 'STAFF_BOUTIQUE'))
                `;
                break;
            case ENTITE_TYPES.ENTREPRISE_LIVRAISON:
                query = `
                    SELECT DISTINCT compte_id
                    FROM LIVREURS
                    WHERE id_entreprise_livraison = $1 AND est_actif = true
                `;
                break;
            default:
                return;
        }

        const staffResult = await client.query(query, [entite_id]);

        for (const staff of staffResult.rows) {
            await client.query(
                `INSERT INTO PARTICIPANTS_CONVERSATION (
                    conversation_id, compte_id, role_participant,
                    est_administrateur, est_actif, notifications_actives
                ) VALUES ($1, $2, $3, $4, true, true)
                ON CONFLICT (conversation_id, compte_id) DO NOTHING`,
                [conversationId, staff.compte_id, 'MODERATEUR', false]
            );
        }
    }

    /**
     * Notifier le staff de l'entité
     */
    async notifyEntiteStaff(client, conversationId, entite_type, entite_id, user, message) {
        let query = '';
        switch (entite_type) {
            case ENTITE_TYPES.COMPAGNIE:
                query = `
                    SELECT DISTINCT compte_id
                    FROM COMPTES_COMPAGNIES
                    WHERE compagnie_id = $1
                      AND (role_dans_compagnie IN ('ADMINISTRATEUR_COMPAGNIE', 'STAFF_COMPAGNIE'))
                      AND compte_id != $2
                `;
                break;
            case ENTITE_TYPES.RESTAURANT:
                query = `
                    SELECT DISTINCT compte_id
                    FROM COMPTES_RESTAURANTS
                    WHERE restaurant_id = $1
                      AND (role_dans_resto IN ('ADMINISTRATEUR_RESTAURANT_FAST_FOOD', 'STAFF_RESTAURANT_FAST_FOOD'))
                      AND compte_id != $2
                `;
                break;
            case ENTITE_TYPES.BOUTIQUE:
                query = `
                    SELECT DISTINCT compte_id
                    FROM COMPTES_BOUTIQUES
                    WHERE boutique_id = $1
                      AND (role_dans_boutique IN ('ADMINISTRATEUR_BOUTIQUE', 'STAFF_BOUTIQUE'))
                      AND compte_id != $2
                `;
                break;
            case ENTITE_TYPES.ENTREPRISE_LIVRAISON:
                query = `
                    SELECT DISTINCT compte_id
                    FROM LIVREURS
                    WHERE id_entreprise_livraison = $1 AND est_actif = true
                      AND compte_id != $2
                `;
                break;
            default:
                return;
        }

        const staffResult = await client.query(query, [entite_id, user.id]);

        for (const staff of staffResult.rows) {
            await NotificationService.send({
                destinataire_id: staff.compte_id,
                type: 'NOUVEAU_MESSAGE_ENTITE',
                titre: 'Nouveau message client',
                corps: `${user.nom_utilisateur_compte} vous a contacté : ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`,
                entite_source_type: 'CONVERSATION',
                entite_source_id: conversationId,
                action_url: `/staff/messagerie/conversation/${conversationId}`
            });
        }
    }
}

module.exports = new ContactEntiteController();