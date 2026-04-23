// src/controllers/messagerie/ContactController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');

class ContactController {
    async getMesContacts(req, res, next) {
    try {
        const {
            page = 1,
            limit = 50,
            recherche = '',
            uniquement_actifs = true
        } = req.query;

        const offset = (page - 1) * limit;
        const userId = req.user.id;

        // ÉTAPE 1: Récupérer les IDs des contacts avec pagination
        let contactsIdsQuery = `
            SELECT u.id
            FROM COMPTES u
            WHERE u.id != $1
                AND u.est_supprime = false
                AND EXISTS (
                    SELECT 1
                    FROM PARTICIPANTS_CONVERSATION pc
                    JOIN CONVERSATIONS c ON c.id = pc.conversation_id
                    WHERE pc.compte_id = $1
                        AND c.type_conversation = 'DIRECT'
                        AND EXISTS (
                            SELECT 1 FROM PARTICIPANTS_CONVERSATION pc2
                            WHERE pc2.conversation_id = c.id
                                AND pc2.compte_id = u.id
                                AND pc2.est_actif = true
                        )
                )
        `;

        const params = [userId];
        
        if (recherche) {
            contactsIdsQuery += ` AND (u.nom_utilisateur_compte ILIKE $2 
                               OR u.email ILIKE $2
                               OR u.numero_de_telephone ILIKE $2)`;
            params.push(`%${recherche}%`);
        }

        if (uniquement_actifs === 'true') {
            contactsIdsQuery += ` AND u.statut = 'EST_AUTHENTIFIE'`;
        }

        // Ajouter ORDER BY et LIMIT/OFFSET
        contactsIdsQuery += ` ORDER BY u.nom_utilisateur_compte ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(parseInt(limit), offset);

        const contactsResult = await db.query(contactsIdsQuery, params);
        const contactIds = contactsResult.rows.map(r => r.id);

        // ÉTAPE 2: Compter le total
        let countQuery = `
            SELECT COUNT(*) as total
            FROM COMPTES u
            WHERE u.id != $1
                AND u.est_supprime = false
                AND EXISTS (
                    SELECT 1
                    FROM PARTICIPANTS_CONVERSATION pc
                    JOIN CONVERSATIONS c ON c.id = pc.conversation_id
                    WHERE pc.compte_id = $1
                        AND c.type_conversation = 'DIRECT'
                        AND EXISTS (
                            SELECT 1 FROM PARTICIPANTS_CONVERSATION pc2
                            WHERE pc2.conversation_id = c.id
                                AND pc2.compte_id = u.id
                                AND pc2.est_actif = true
                        )
                )
        `;
        
        const countParams = [userId];
        if (recherche) {
            countQuery += ` AND (u.nom_utilisateur_compte ILIKE $2 
                           OR u.email ILIKE $2
                           OR u.numero_de_telephone ILIKE $2)`;
            countParams.push(`%${recherche}%`);
        }
        if (uniquement_actifs === 'true') {
            countQuery += ` AND u.statut = 'EST_AUTHENTIFIE'`;
        }
        
        const totalResult = await db.query(countQuery, countParams);
        const total = parseInt(totalResult.rows[0]?.total || 0);

        // ÉTAPE 3: Récupérer les détails si des contacts existent
        let contacts = [];
        if (contactIds.length > 0) {
            const detailsResult = await db.query(`
                SELECT 
                    u.id,
                    u.nom_utilisateur_compte,
                    u.email,
                    u.numero_de_telephone,
                    u.photo_profil_compte,
                    u.statut,
                    u.date_derniere_connexion,
                    u.date_creation,
                    (
                        SELECT json_build_object(
                            'id', c.id,
                            'uuid', c.uuid_conversation,
                            'dernier_message', m.contenu_message,
                            'date_dernier_message', c.date_dernier_message,
                            'messages_non_lus', pc.messages_non_lus
                        )
                        FROM CONVERSATIONS c
                        JOIN PARTICIPANTS_CONVERSATION pc ON pc.conversation_id = c.id
                        LEFT JOIN LATERAL (
                            SELECT m2.contenu_message, m2.date_envoi
                            FROM MESSAGES m2
                            WHERE m2.conversation_id = c.id
                                AND m2.date_suppression IS NULL
                            ORDER BY m2.date_envoi DESC
                            LIMIT 1
                        ) m ON true
                        WHERE c.type_conversation = 'DIRECT'
                            AND c.est_archive = false
                            AND pc.compte_id = $1
                            AND EXISTS (
                                SELECT 1 FROM PARTICIPANTS_CONVERSATION pc2
                                WHERE pc2.conversation_id = c.id
                                    AND pc2.compte_id = u.id
                                    AND pc2.est_actif = true
                            )
                        LIMIT 1
                    ) as derniere_conversation
                FROM COMPTES u
                WHERE u.id = ANY($2::int[])
                ORDER BY u.nom_utilisateur_compte ASC
            `, [userId, contactIds]);
            contacts = detailsResult.rows;
        }

        res.json({
            success: true,
            data: {
                contacts: contacts,
                stats: {
                    total_contacts: total
                }
            },
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });

    } catch (error) {
        console.error('Erreur getMesContacts:', error);
        next(error);
    }
}
    /**
     * Rechercher des utilisateurs (pour ajout de contacts ou nouvelles conversations)
     * @route GET /api/v1/messagerie/contacts/recherche
     */
    async rechercherUtilisateurs(req, res, next) {
        try {
            const {
                q,
                role,
                page = 1,
                limit = 20,
                exclus_contacts = false,
                exclus_moi = true
            } = req.query;

            if (!q || q.length < 2) {
                throw new ValidationError('La recherche doit contenir au moins 2 caractères');
            }

            const offset = (page - 1) * limit;
            const userId = req.user.id;

            let query = `
                SELECT 
                    u.id,
                    u.nom_utilisateur_compte,
                    u.email,
                    u.numero_de_telephone,
                    u.photo_profil_compte,
                    u.statut,
                    u.compte_role,
                    u.date_derniere_connexion,
                    u.date_creation,
                    EXISTS (
                        SELECT 1
                        FROM PARTICIPANTS_CONVERSATION pc
                        JOIN CONVERSATIONS c ON c.id = pc.conversation_id
                        WHERE pc.compte_id = $1
                            AND c.type_conversation = 'DIRECT'
                            AND EXISTS (
                                SELECT 1 FROM PARTICIPANTS_CONVERSATION pc2
                                WHERE pc2.conversation_id = c.id
                                    AND pc2.compte_id = u.id
                                    AND pc2.est_actif = true
                            )
                    ) as deja_en_contact,
                    (
                        SELECT json_build_object(
                            'id', c.id,
                            'uuid', c.uuid_conversation
                        )
                        FROM CONVERSATIONS c
                        JOIN PARTICIPANTS_CONVERSATION pc ON pc.conversation_id = c.id
                        WHERE c.type_conversation = 'DIRECT'
                            AND pc.compte_id = $1
                            AND EXISTS (
                                SELECT 1 FROM PARTICIPANTS_CONVERSATION pc2
                                WHERE pc2.conversation_id = c.id
                                    AND pc2.compte_id = u.id
                                    AND pc2.est_actif = true
                            )
                        LIMIT 1
                    ) as conversation_existante,
                    COUNT(*) OVER() as total_count
                FROM COMPTES u
                WHERE u.est_supprime = false
            `;

            const params = [userId];
            let paramIndex = 2;

            if (exclus_moi === 'true') {
                query += ` AND u.id != $${paramIndex}`;
                params.push(userId);
                paramIndex++;
            }

            if (exclus_contacts === 'true') {
                query += ` AND NOT EXISTS (
                    SELECT 1
                    FROM PARTICIPANTS_CONVERSATION pc
                    JOIN CONVERSATIONS c ON c.id = pc.conversation_id
                    WHERE pc.compte_id = $1
                        AND c.type_conversation = 'DIRECT'
                        AND EXISTS (
                            SELECT 1 FROM PARTICIPANTS_CONVERSATION pc2
                            WHERE pc2.conversation_id = c.id
                                AND pc2.compte_id = u.id
                                AND pc2.est_actif = true
                        )
                )`;
            }

            query += ` AND (
                    u.nom_utilisateur_compte ILIKE $${paramIndex}
                    OR u.email ILIKE $${paramIndex}
                    OR u.numero_de_telephone ILIKE $${paramIndex}
                )`;
            params.push(`%${q}%`);
            paramIndex++;

            if (role) {
                query += ` AND u.compte_role = $${paramIndex}`;
                params.push(role);
                paramIndex++;
            }

            query += ` ORDER BY 
                        CASE WHEN u.statut = 'EST_AUTHENTIFIE' THEN 0 ELSE 1 END,
                        u.nom_utilisateur_compte ASC
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
                    total: parseInt(total),
                    pages: Math.ceil(parseInt(total) / parseInt(limit)),
                    recherche: q
                }
            });

        } catch (error) {
            console.error('Erreur rechercherUtilisateurs:', error);
            next(error);
        }
    }

    /**
     * Récupérer les suggestions de contacts (utilisateurs actifs, recommandés)
     * @route GET /api/v1/messagerie/contacts/suggestions
     */
    async getSuggestions(req, res, next) {
        try {
            const { limit = 10 } = req.query;
            const userId = req.user.id;

            const result = await db.query(
                `WITH user_activites AS (
                    SELECT DISTINCT
                        c2.auteur_id as user_id,
                        COUNT(*) as points_communs,
                        1 as type_suggestion
                    FROM COMMENTAIRES c1
                    JOIN COMMENTAIRES c2 ON c2.article_id = c1.article_id
                    WHERE c1.auteur_id = $1
                        AND c2.auteur_id != $1
                        AND c2.auteur_id NOT IN (
                            SELECT pc.compte_id
                            FROM PARTICIPANTS_CONVERSATION pc
                            JOIN CONVERSATIONS c ON c.id = pc.conversation_id
                            WHERE pc.compte_id = $1
                                AND c.type_conversation = 'DIRECT'
                        )
                    GROUP BY c2.auteur_id
                    
                    UNION ALL
                    
                    SELECT DISTINCT
                        c2.compte_id as user_id,
                        COUNT(*) as points_communs,
                        2 as type_suggestion
                    FROM COMMANDESEMPLACEMENTFASTFOOD c1
                    JOIN COMMANDESEMPLACEMENTFASTFOOD c2 ON c2.id_restaurant_fast_food_emplacement = c1.id_restaurant_fast_food_emplacement
                    WHERE c1.compte_id = $1
                        AND c2.compte_id != $1
                        AND c2.compte_id IS NOT NULL
                    GROUP BY c2.compte_id
                )
                SELECT 
                    u.id,
                    u.nom_utilisateur_compte,
                    u.email,
                    u.photo_profil_compte,
                    u.statut,
                    u.compte_role,
                    u.date_derniere_connexion,
                    SUM(ua.points_communs) as points_communs,
                    COUNT(DISTINCT ua.type_suggestion) as types_communs
                FROM user_activites ua
                JOIN COMPTES u ON u.id = ua.user_id
                WHERE u.est_supprime = false
                    AND u.statut = 'EST_AUTHENTIFIE'
                GROUP BY u.id, u.nom_utilisateur_compte, u.email, u.photo_profil_compte, u.statut, u.compte_role, u.date_derniere_connexion
                ORDER BY points_communs DESC, u.date_derniere_connexion DESC
                LIMIT $2`,
                [userId, parseInt(limit)]
            );

            res.json({
                success: true,
                data: result.rows
            });

        } catch (error) {
            console.error('Erreur getSuggestions:', error);
            next(error);
        }
    }

    /**
     * Récupérer les contacts favoris
     * @route GET /api/v1/messagerie/contacts/favoris
     */
    async getFavoris(req, res, next) {
        try {
            const { page = 1, limit = 50 } = req.query;
            const offset = (page - 1) * limit;
            const userId = req.user.id;

            const result = await db.query(
                `SELECT 
                    u.id,
                    u.nom_utilisateur_compte,
                    u.email,
                    u.photo_profil_compte,
                    u.statut,
                    u.date_derniere_connexion,
                    pc.est_en_vedette,
                    pc.surnom_dans_conversation,
                    pc.couleur_affichage,
                    pc.messages_non_lus,
                    (
                        SELECT json_build_object(
                            'id', c.id,
                            'uuid', c.uuid_conversation,
                            'dernier_message', m.contenu_message,
                            'date_dernier_message', c.date_dernier_message
                        )
                        FROM CONVERSATIONS c
                        JOIN PARTICIPANTS_CONVERSATION pc2 ON pc2.conversation_id = c.id
                        LEFT JOIN LATERAL (
                            SELECT m2.contenu_message, m2.date_envoi
                            FROM MESSAGES m2
                            WHERE m2.conversation_id = c.id
                                AND m2.date_suppression IS NULL
                            ORDER BY m2.date_envoi DESC
                            LIMIT 1
                        ) m ON true
                        WHERE c.type_conversation = 'DIRECT'
                            AND pc2.compte_id = $1
                            AND EXISTS (
                                SELECT 1 FROM PARTICIPANTS_CONVERSATION pc3
                                WHERE pc3.conversation_id = c.id
                                    AND pc3.compte_id = u.id
                                    AND pc3.est_actif = true
                            )
                        LIMIT 1
                    ) as derniere_conversation,
                    COUNT(*) OVER() as total_count
                FROM PARTICIPANTS_CONVERSATION pc
                JOIN COMPTES u ON u.id = pc.compte_id
                WHERE pc.conversation_id IN (
                        SELECT c2.id
                        FROM CONVERSATIONS c2
                        JOIN PARTICIPANTS_CONVERSATION pc2 ON pc2.conversation_id = c2.id
                        WHERE pc2.compte_id = $1
                            AND c2.type_conversation = 'DIRECT'
                    )
                    AND pc.est_en_vedette = true
                    AND u.id != $1
                ORDER BY pc.date_derniere_activite DESC NULLS LAST
                LIMIT $2 OFFSET $3`,
                [userId, parseInt(limit), offset]
            );

            const total = result.rows[0]?.total_count || 0;

            res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(total),
                    pages: Math.ceil(parseInt(total) / parseInt(limit))
                }
            });

        } catch (error) {
            console.error('Erreur getFavoris:', error);
            next(error);
        }
    }

    /**
     * Ajouter/Retirer un contact des favoris
     * @route PUT /api/v1/messagerie/contacts/:contactId/favori
     */
    async toggleFavori(req, res, next) {
        try {
            const { contactId } = req.params;
            const { favori } = req.body;

            const conversation = await db.query(
                `SELECT c.id
                 FROM CONVERSATIONS c
                 JOIN PARTICIPANTS_CONVERSATION pc1 ON pc1.conversation_id = c.id
                 JOIN PARTICIPANTS_CONVERSATION pc2 ON pc2.conversation_id = c.id
                 WHERE c.type_conversation = 'DIRECT'
                     AND pc1.compte_id = $1
                     AND pc2.compte_id = $2
                     AND pc1.est_actif = true
                     AND pc2.est_actif = true
                 LIMIT 1`,
                [req.user.id, contactId]
            );

            if (conversation.rows.length === 0) {
                throw new NotFoundError('Aucune conversation trouvée avec ce contact');
            }

            await db.query(
                `UPDATE PARTICIPANTS_CONVERSATION 
                 SET est_en_vedette = $1,
                     date_derniere_activite = NOW()
                 WHERE conversation_id = $2 AND compte_id = $3`,
                [favori, conversation.rows[0].id, req.user.id]
            );

            res.json({
                success: true,
                message: favori ? 'Contact ajouté aux favoris' : 'Contact retiré des favoris'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Bloquer/Débloquer un contact
     * @route PUT /api/v1/messagerie/contacts/:contactId/bloquer
     */
    async toggleBlock(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { contactId } = req.params;
            const { bloquer } = req.body;

            if (bloquer) {
                await client.query(
                    `INSERT INTO BLOCAGES_UTILISATEURS (
                        compte_bloqueur, compte_bloque, type_blocage
                    ) VALUES ($1, $2, 'MESSAGERIE')
                    ON CONFLICT (compte_bloqueur, compte_bloque) 
                    WHERE conversation_id IS NULL
                    DO NOTHING`,
                    [req.user.id, contactId]
                );

                await client.query(
                    `UPDATE PARTICIPANTS_CONVERSATION 
                     SET est_bloque = true,
                         date_blocage = NOW()
                     WHERE conversation_id IN (
                         SELECT c.id
                         FROM CONVERSATIONS c
                         JOIN PARTICIPANTS_CONVERSATION pc1 ON pc1.conversation_id = c.id
                         JOIN PARTICIPANTS_CONVERSATION pc2 ON pc2.conversation_id = c.id
                         WHERE c.type_conversation = 'DIRECT'
                             AND pc1.compte_id = $1
                             AND pc2.compte_id = $2
                     )
                     AND compte_id = $2`,
                    [req.user.id, contactId]
                );
            } else {
                await client.query(
                    `UPDATE BLOCAGES_UTILISATEURS 
                     SET date_deblocage = NOW()
                     WHERE compte_bloqueur = $1 
                       AND compte_bloque = $2
                       AND type_blocage = 'MESSAGERIE'
                       AND date_deblocage IS NULL`,
                    [req.user.id, contactId]
                );

                await client.query(
                    `UPDATE PARTICIPANTS_CONVERSATION 
                     SET est_bloque = false,
                         date_blocage = NULL
                     WHERE conversation_id IN (
                         SELECT c.id
                         FROM CONVERSATIONS c
                         JOIN PARTICIPANTS_CONVERSATION pc1 ON pc1.conversation_id = c.id
                         JOIN PARTICIPANTS_CONVERSATION pc2 ON pc2.conversation_id = c.id
                         WHERE c.type_conversation = 'DIRECT'
                             AND pc1.compte_id = $1
                             AND pc2.compte_id = $2
                     )
                     AND compte_id = $2`,
                    [req.user.id, contactId]
                );
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                message: bloquer ? 'Contact bloqué' : 'Contact débloqué'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les contacts bloqués
     * @route GET /api/v1/messagerie/contacts/bloques
     */
    async getBloques(req, res, next) {
        try {
            const { page = 1, limit = 50 } = req.query;
            const offset = (page - 1) * limit;

            const result = await db.query(
                `SELECT 
                    b.id as blocage_id,
                    b.date_blocage,
                    b.motif,
                    u.id,
                    u.nom_utilisateur_compte,
                    u.email,
                    u.photo_profil_compte,
                    COUNT(*) OVER() as total_count
                 FROM BLOCAGES_UTILISATEURS b
                 JOIN COMPTES u ON u.id = b.compte_bloque
                 WHERE b.compte_bloqueur = $1
                     AND b.type_blocage = 'MESSAGERIE'
                     AND b.date_deblocage IS NULL
                 ORDER BY b.date_blocage DESC
                 LIMIT $2 OFFSET $3`,
                [req.user.id, parseInt(limit), offset]
            );

            const total = result.rows[0]?.total_count || 0;

            res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(total),
                    pages: Math.ceil(parseInt(total) / parseInt(limit))
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer le profil d'un utilisateur (pour affichage contact)
     * @route GET /api/v1/messagerie/contacts/:contactId
     */
    async getContactProfile(req, res, next) {
        try {
            const { contactId } = req.params;
            const userId = req.user.id;

            const result = await db.query(
                `SELECT 
                    u.id,
                    u.nom_utilisateur_compte,
                    u.email,
                    u.numero_de_telephone,
                    u.photo_profil_compte,
                    u.statut,
                    u.compte_role,
                    u.date_derniere_connexion,
                    u.date_creation,
                    (
                        SELECT json_build_object(
                            'id', c.id,
                            'uuid', c.uuid_conversation,
                            'messages_non_lus', pc.messages_non_lus,
                            'est_bloque', pc.est_bloque
                        )
                        FROM CONVERSATIONS c
                        JOIN PARTICIPANTS_CONVERSATION pc ON pc.conversation_id = c.id
                        WHERE c.type_conversation = 'DIRECT'
                            AND pc.compte_id = $1
                            AND EXISTS (
                                SELECT 1 FROM PARTICIPANTS_CONVERSATION pc2
                                WHERE pc2.conversation_id = c.id
                                    AND pc2.compte_id = u.id
                                    AND pc2.est_actif = true
                            )
                        LIMIT 1
                    ) as conversation,
                    EXISTS (
                        SELECT 1 FROM BLOCAGES_UTILISATEURS
                        WHERE compte_bloqueur = $1
                            AND compte_bloque = u.id
                            AND type_blocage = 'MESSAGERIE'
                            AND date_deblocage IS NULL
                    ) as est_bloque_par_moi,
                    EXISTS (
                        SELECT 1 FROM BLOCAGES_UTILISATEURS
                        WHERE compte_bloqueur = u.id
                            AND compte_bloque = $1
                            AND type_blocage = 'MESSAGERIE'
                            AND date_deblocage IS NULL
                    ) as m_a_bloque,
                    (
                        SELECT ROUND(AVG(note_globale)::numeric, 2)
                        FROM AVIS
                        WHERE entite_type = 'COMPTE'::entite_reference
                            AND entite_id = u.id
                            AND statut = 'PUBLIE'
                    ) as note_moyenne
                FROM COMPTES u
                WHERE u.id = $2 AND u.est_supprime = false`,
                [userId, contactId]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Utilisateur non trouvé');
            }

            res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new ContactController();