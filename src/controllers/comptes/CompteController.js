const db = require('../../configuration/database');
const { AppError, ValidationError, AuthorizationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const FileService = require('../../services/file/FileService');
const { ENUM_COMPTE_ROLE, ENUM_STATUT_COMPTE } = require('../../utils/constants/enums');

class CompteController {
    /**
     * Récupérer tous les comptes (avec pagination et filtres)
     * GET /api/v1/comptes
     */
    static async getAll(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                role,
                statut,
                recherche,
                compagnie_id,
                restaurant_id,
                boutique_id,
                tri = 'date_creation_desc'
            } = req.query;

            const offset = (page - 1) * limit;
            const params = [];
            const conditions = ['c.est_supprime = false'];

            // Construction dynamique mais SÉCURISÉE des conditions
            if (role) {
                conditions.push(`c.compte_role = $${params.length + 1}`);
                params.push(role);
            }

            if (statut) {
                conditions.push(`c.statut = $${params.length + 1}`);
                params.push(statut);
            }

            if (recherche) {
                conditions.push(`(
                    c.nom_utilisateur_compte ILIKE $${params.length + 1} OR
                    c.email ILIKE $${params.length + 1} OR
                    c.numero_de_telephone ILIKE $${params.length + 1}
                )`);
                params.push(`%${recherche}%`);
            }

            // Filtres via les tables de liaison (corrigé)
            let havingConditions = '';
            if (compagnie_id) {
                havingConditions = `HAVING COUNT(DISTINCT cc.compagnie_id) > 0 
                                    AND COUNT(DISTINCT cc.compagnie_id) = COUNT(DISTINCT CASE WHEN cc.compagnie_id = $${params.length + 1} THEN cc.compagnie_id END)`;
                params.push(compagnie_id);
            }

            if (restaurant_id) {
                const condition = ` AND COUNT(DISTINCT cr.restaurant_id) > 0 
                                   AND COUNT(DISTINCT cr.restaurant_id) = COUNT(DISTINCT CASE WHEN cr.restaurant_id = $${params.length + 1} THEN cr.restaurant_id END)`;
                havingConditions += havingConditions ? ' AND ' + condition.substring(4) : condition;
                params.push(restaurant_id);
            }

            if (boutique_id) {
                const condition = ` AND COUNT(DISTINCT cb.boutique_id) > 0 
                                   AND COUNT(DISTINCT cb.boutique_id) = COUNT(DISTINCT CASE WHEN cb.boutique_id = $${params.length + 1} THEN cb.boutique_id END)`;
                havingConditions += havingConditions ? ' AND ' + condition.substring(4) : condition;
                params.push(boutique_id);
            }

            // Tri sécurisé
            const orderMap = {
                'date_creation_asc': 'c.date_creation ASC',
                'date_creation_desc': 'c.date_creation DESC',
                'nom_asc': 'c.nom_utilisateur_compte ASC',
                'nom_desc': 'c.nom_utilisateur_compte DESC',
                'derniere_connexion_desc': 'c.date_derniere_connexion DESC NULLS LAST'
            };
            const orderBy = orderMap[tri] || 'c.date_creation DESC';

            const whereClause = conditions.length > 0 
                ? 'WHERE ' + conditions.join(' AND ')
                : '';

            // Requête corrigée avec les tables de liaison
            const query = `
                SELECT 
                    c.id, c.email, c.nom_utilisateur_compte, c.numero_de_telephone,
                    c.photo_profil_compte, c.statut, c.compte_role,
                    c.date_creation, c.date_derniere_connexion,
                    -- Récupérer les entités associées
                    (
                        SELECT json_agg(
                            json_build_object(
                                'id', cc.compagnie_id,
                                'nom', ct.nom_compagnie,
                                'role', cc.role_dans_compagnie,
                                'est_defaut', cc.est_defaut
                            )
                        )
                        FROM COMPTES_COMPAGNIES cc
                        LEFT JOIN COMPAGNIESTRANSPORT ct ON ct.id = cc.compagnie_id
                        WHERE cc.compte_id = c.id
                    ) as compagnies,
                    (
                        SELECT json_agg(
                            json_build_object(
                                'id', cr.restaurant_id,
                                'nom', rf.nom_restaurant_fast_food,
                                'role', cr.role_dans_resto,
                                'est_defaut', cr.est_defaut
                            )
                        )
                        FROM COMPTES_RESTAURANTS cr
                        LEFT JOIN RESTAURANTSFASTFOOD rf ON rf.id = cr.restaurant_id
                        WHERE cr.compte_id = c.id
                    ) as restaurants,
                    (
                        SELECT json_agg(
                            json_build_object(
                                'id', cb.boutique_id,
                                'nom', b.nom_boutique,
                                'role', cb.role_dans_boutique,
                                'est_defaut', cb.est_defaut
                            )
                        )
                        FROM COMPTES_BOUTIQUES cb
                        LEFT JOIN BOUTIQUES b ON b.id = cb.boutique_id
                        WHERE cb.compte_id = c.id
                    ) as boutiques
                FROM COMPTES c
                ${whereClause}
                GROUP BY c.id, c.email, c.nom_utilisateur_compte, c.numero_de_telephone,
                         c.photo_profil_compte, c.statut, c.compte_role,
                         c.date_creation, c.date_derniere_connexion
                ${havingConditions}
                ORDER BY ${orderBy}
                LIMIT $${params.length + 1} OFFSET $${params.length + 2}
            `;

            const result = await db.query(query, [...params, limit, offset]);

            // Compter le total
            const countQuery = `
                SELECT COUNT(*) as total 
                FROM COMPTES c
                ${whereClause}
            `;
            const countResult = await db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].total);

            // Parser les JSON
            const rows = result.rows.map(row => ({
                ...row,
                compagnies: row.compagnies || [],
                restaurants: row.restaurants || [],
                boutiques: row.boutiques || [],
                nb_compagnies: row.compagnies?.length || 0,
                nb_restaurants: row.restaurants?.length || 0,
                nb_boutiques: row.boutiques?.length || 0
            }));

            res.json({
                success: true,
                data: rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            });

        } catch (error) {
            console.error('Erreur getAll:', error);
            next(error);
        }
    }
    
    /**
     * Récupérer un compte par ID
     * GET /api/v1/comptes/:id
     */
    static async getById(req, res, next) {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            const userRole = req.user.compte_role;

            // Vérifier les permissions
            if (userId !== parseInt(id) && userRole !== 'ADMINISTRATEUR_PLATEFORME') {
                throw new AuthorizationError('Vous n\'avez pas les permissions pour voir ce compte');
            }

            const result = await db.query(
                `SELECT 
                    c.id, c.email, c.nom_utilisateur_compte, c.numero_de_telephone,
                    c.photo_profil_compte, c.statut, c.compte_role,
                    c.date_creation, c.date_mise_a_jour, c.date_derniere_connexion,
                    c.date_verouillage, c.tentatives_echec_connexion,
                    -- Récupérer les compagnies associées
                    (
                        SELECT json_agg(
                            json_build_object(
                                'id', cc.compagnie_id,
                                'nom', ct.nom_compagnie,
                                'role', cc.role_dans_compagnie,
                                'est_defaut', cc.est_defaut,
                                'matricule', cc.matricule,
                                'service', cc.service,
                                'emplacement_id', cc.emplacement_compagnie_id
                            )
                        )
                        FROM COMPTES_COMPAGNIES cc
                        LEFT JOIN COMPAGNIESTRANSPORT ct ON ct.id = cc.compagnie_id
                        WHERE cc.compte_id = c.id
                    ) as compagnies,
                    -- Récupérer les restaurants associés
                    (
                        SELECT json_agg(
                            json_build_object(
                                'id', cr.restaurant_id,
                                'nom', rf.nom_restaurant_fast_food,
                                'role', cr.role_dans_resto,
                                'est_defaut', cr.est_defaut
                            )
                        )
                        FROM COMPTES_RESTAURANTS cr
                        LEFT JOIN RESTAURANTSFASTFOOD rf ON rf.id = cr.restaurant_id
                        WHERE cr.compte_id = c.id
                    ) as restaurants,
                    -- Récupérer les boutiques associées
                    (
                        SELECT json_agg(
                            json_build_object(
                                'id', cb.boutique_id,
                                'nom', b.nom_boutique,
                                'role', cb.role_dans_boutique,
                                'est_defaut', cb.est_defaut
                            )
                        )
                        FROM COMPTES_BOUTIQUES cb
                        LEFT JOIN BOUTIQUES b ON b.id = cb.boutique_id
                        WHERE cb.compte_id = c.id
                    ) as boutiques,
                    -- Récupérer les documents
                    (
                        SELECT json_agg(json_build_object(
                            'id', d.id,
                            'type_document', d.type_document,
                            'statut', d.statut,
                            'date_upload', d.date_upload,
                            'nom_fichier', d.nom_fichier
                        ))
                        FROM DOCUMENTS d
                        WHERE d.entite_type = 'COMPTE' AND d.entite_id = c.id
                    ) as documents,
                    -- Compter les sessions actives
                    (
                        SELECT COUNT(*) FROM SESSIONS 
                        WHERE compte_id = c.id AND est_active = true
                    ) as sessions_actives,
                    -- Compter les messages non lus
                    (
                        SELECT COALESCE(SUM(messages_non_lus), 0)
                        FROM PARTICIPANTS_CONVERSATION
                        WHERE compte_id = c.id AND est_actif = true
                    ) as messages_non_lus
                FROM COMPTES c
                WHERE c.id = $1 AND c.est_supprime = false`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Compte non trouvé', 404);
            }

            const compte = result.rows[0];

            // Parser les JSON
            compte.compagnies = compte.compagnies || [];
            compte.restaurants = compte.restaurants || [];
            compte.boutiques = compte.boutiques || [];
            compte.documents = compte.documents || [];

            // Compter les entités
            compte.nb_compagnies = compte.compagnies.length;
            compte.nb_restaurants = compte.restaurants.length;
            compte.nb_boutiques = compte.boutiques.length;

            // Récupérer l'entité principale (celle par défaut ou la première)
            if (compte.compagnies.length > 0) {
                const defaut = compte.compagnies.find(c => c.est_defaut) || compte.compagnies[0];
                compte.compagnie_principale = defaut;
            }
            if (compte.restaurants.length > 0) {
                const defaut = compte.restaurants.find(r => r.est_defaut) || compte.restaurants[0];
                compte.restaurant_principal = defaut;
            }
            if (compte.boutiques.length > 0) {
                const defaut = compte.boutiques.find(b => b.est_defaut) || compte.boutiques[0];
                compte.boutique_principale = defaut;
            }

            // Pour les utilisateurs non-admin, masquer certaines données sensibles
            if (userId !== parseInt(id)) {
                delete compte.email;
                delete compte.numero_de_telephone;
            }

            res.json({
                success: true,
                data: compte
            });

        } catch (error) {
            console.error('Erreur getById:', error);
            next(error);
        }
    }

    /**
     * Mettre à jour un compte
     * PUT /api/v1/comptes/:id
     */
    static async update(req, res, next) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const {
                nom_utilisateur_compte,
                numero_de_telephone,
                photo_profil_compte,
                // Champs admin seulement
                statut,
                compte_role
            } = req.body;

            // Vérifier les permissions
            const isAdmin = req.user.compte_role === 'ADMINISTRATEUR_PLATEFORME';
            const isSelf = req.user.id === parseInt(id);

            if (!isSelf && !isAdmin) {
                throw new AuthorizationError('Vous ne pouvez modifier que votre propre compte');
            }

            // Récupérer l'état actuel pour l'audit
            const currentResult = await client.query(
                `SELECT * FROM COMPTES WHERE id = $1`,
                [id]
            );

            if (currentResult.rows.length === 0) {
                throw new AppError('Compte non trouvé', 404);
            }

            const currentUser = currentResult.rows[0];

            // Construire la requête de mise à jour
            const updates = [];
            const params = [];
            let paramIndex = 1;

            // Champs que l'utilisateur peut modifier lui-même
            if (nom_utilisateur_compte && nom_utilisateur_compte !== currentUser.nom_utilisateur_compte) {
                const existing = await client.query(
                    `SELECT id FROM COMPTES WHERE nom_utilisateur_compte = $1 AND id != $2`,
                    [nom_utilisateur_compte, id]
                );
                if (existing.rows.length > 0) {
                    throw new ValidationError('Ce nom d\'utilisateur est déjà pris');
                }
                updates.push(`nom_utilisateur_compte = $${paramIndex++}`);
                params.push(nom_utilisateur_compte);
            }

            if (numero_de_telephone && numero_de_telephone !== currentUser.numero_de_telephone) {
                const existing = await client.query(
                    `SELECT id FROM COMPTES WHERE numero_de_telephone = $1 AND id != $2`,
                    [numero_de_telephone, id]
                );
                if (existing.rows.length > 0) {
                    throw new ValidationError('Ce numéro de téléphone est déjà utilisé');
                }
                updates.push(`numero_de_telephone = $${paramIndex++}`);
                params.push(numero_de_telephone);
            }

            if (photo_profil_compte !== undefined) {
                updates.push(`photo_profil_compte = $${paramIndex++}`);
                params.push(photo_profil_compte);
            }

            // Champs réservés aux admins
            if (isAdmin) {
                if (statut && statut !== currentUser.statut) {
                    updates.push(`statut = $${paramIndex++}`);
                    params.push(statut);
                }

                if (compte_role && compte_role !== currentUser.compte_role) {
                    updates.push(`compte_role = $${paramIndex++}`);
                    params.push(compte_role);
                }
            }

            if (updates.length === 0) {
                await client.query('COMMIT');
                return res.json({
                    success: true,
                    message: 'Aucune modification à effectuer',
                    data: currentUser
                });
            }

            updates.push(`date_mise_a_jour = NOW()`);
            params.push(id);

            const updateQuery = `
                UPDATE COMPTES 
                SET ${updates.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING id, email, nom_utilisateur_compte, numero_de_telephone,
                          photo_profil_compte, statut, compte_role, date_mise_a_jour
            `;

            const result = await client.query(updateQuery, params);

            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'COMPTES',
                ressource_id: id,
                donnees_avant: currentUser,
                donnees_apres: result.rows[0],
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent')
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Compte mis à jour avec succès',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Upload de photo de profil
     * POST /api/v1/comptes/:id/photo
     */
    static async uploadPhoto(req, res, next) {
        try {
            const { id } = req.params;
            const isAdmin = req.user.compte_role === 'ADMINISTRATEUR_PLATEFORME';
            const isSelf = req.user.id === parseInt(id);

            if (!isSelf && !isAdmin) {
                throw new AuthorizationError('Non autorisé');
            }

            if (!req.file) {
                throw new ValidationError('Aucun fichier fourni');
            }

            const fileResult = await FileService.upload(req.file, {
                folder: 'profiles',
                userId: id
            });

            await db.query(
                `UPDATE COMPTES 
                 SET photo_profil_compte = $1, date_mise_a_jour = NOW()
                 WHERE id = $2`,
                [fileResult.url, id]
            );

            res.json({
                success: true,
                message: 'Photo de profil mise à jour',
                data: fileResult
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Supprimer un compte (soft delete)
     * DELETE /api/v1/comptes/:id
     */
    static async delete(req, res, next) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const isAdmin = req.user.compte_role === 'ADMINISTRATEUR_PLATEFORME';
            const isSelf = req.user.id === parseInt(id);

            if (!isSelf && !isAdmin) {
                throw new AuthorizationError('Non autorisé');
            }

            const currentResult = await client.query(
                `SELECT * FROM COMPTES WHERE id = $1`,
                [id]
            );

            if (currentResult.rows.length === 0) {
                throw new AppError('Compte non trouvé', 404);
            }

            await client.query(
                `UPDATE COMPTES 
                 SET est_supprime = true, 
                     date_suppression = NOW(),
                     statut = 'SUSPENDU'
                 WHERE id = $1`,
                [id]
            );

            await client.query(
                `UPDATE SESSIONS 
                 SET est_active = false, date_revocation = NOW(), motif_revocation = 'ACCOUNT_DELETED'
                 WHERE compte_id = $1 AND est_active = true`,
                [id]
            );

            await AuditService.log({
                action: 'DELETE',
                ressource_type: 'COMPTES',
                ressource_id: id,
                donnees_avant: currentResult.rows[0],
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent')
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Compte supprimé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Restaurer un compte supprimé (admin seulement)
     * POST /api/v1/comptes/:id/restaurer
     */
    static async restore(req, res, next) {
        const client = await db.pool.connect();
        try {
            const { id } = req.params;

            const result = await client.query(
                `SELECT * FROM COMPTES WHERE id = $1 AND est_supprime = true`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Compte non trouvé ou non supprimé', 404);
            }

            await client.query(
                `UPDATE COMPTES 
                 SET est_supprime = false, 
                     date_suppression = NULL,
                     statut = 'NON_AUTHENTIFIE',
                     date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [id]
            );

            res.json({
                success: true,
                message: 'Compte restauré avec succès'
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Recherche avancée de comptes
     * GET /api/v1/comptes/recherche
     */
    static async search(req, res, next) {
        try {
            const {
                q,
                role,
                statut,
                page = 1,
                limit = 20
            } = req.query;

            let query = `
                SELECT 
                    c.id, c.nom_utilisateur_compte, c.photo_profil_compte,
                    c.compte_role, c.statut
                FROM COMPTES c
                WHERE c.est_supprime = false
            `;

            const params = [];
            let paramIndex = 1;

            if (q) {
                query += ` AND (
                    c.nom_utilisateur_compte ILIKE $${paramIndex} OR
                    c.email ILIKE $${paramIndex}
                )`;
                params.push(`%${q}%`);
                paramIndex++;
            }

            if (role) {
                query += ` AND c.compte_role = $${paramIndex}`;
                params.push(role);
                paramIndex++;
            }

            if (statut) {
                query += ` AND c.statut = $${paramIndex}`;
                params.push(statut);
                paramIndex++;
            }

            query += ` ORDER BY c.nom_utilisateur_compte ASC 
                       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, (page - 1) * limit);

            const result = await db.query(query, params);

            res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Statistiques des comptes (admin)
     * GET /api/v1/comptes/stats
     */
    static async getStats(req, res, next) {
        try {
            const result = await db.query(`
                SELECT 
                    COUNT(*) as total_comptes,
                    COUNT(*) FILTER (WHERE date_creation >= NOW() - INTERVAL '30 days') as nouveaux_30j,
                    COUNT(*) FILTER (WHERE statut = 'EST_AUTHENTIFIE') as comptes_actifs,
                    COUNT(*) FILTER (WHERE statut = 'SUSPENDU') as comptes_suspendus,
                    COUNT(*) FILTER (WHERE statut = 'BANNI') as comptes_bannis,
                    (
                        SELECT json_object_agg(role, count)
                        FROM (
                            SELECT compte_role as role, COUNT(*) as count
                            FROM COMPTES
                            GROUP BY compte_role
                        ) roles_count
                    ) as repartition_par_role,
                    (
                        SELECT json_object_agg(statut, count)
                        FROM (
                            SELECT statut, COUNT(*) as count
                            FROM COMPTES
                            GROUP BY statut
                        ) statuts_count
                    ) as repartition_par_statut
                FROM COMPTES
                WHERE est_supprime = false
            `);

            res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = CompteController;