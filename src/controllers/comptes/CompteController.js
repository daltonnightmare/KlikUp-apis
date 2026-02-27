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

            if (compagnie_id) {
                conditions.push(`c.compagnie_id = $${params.length + 1}`);
                params.push(compagnie_id);
            }

            if (restaurant_id) {
                conditions.push(`c.restaurant_id = $${params.length + 1}`);
                params.push(restaurant_id);
            }

            if (boutique_id) {
                conditions.push(`c.boutique_id = $${params.length + 1}`);
                params.push(boutique_id);
            }

            if (recherche) {
                conditions.push(`(
                    c.nom_utilisateur_compte ILIKE $${params.length + 1} OR
                    c.email ILIKE $${params.length + 1} OR
                    c.numero_de_telephone ILIKE $${params.length + 1}
                )`);
                params.push(`%${recherche}%`);
            }

            // Tri sécurisé (éviter injection)
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

            const query = `
                SELECT 
                    c.id, c.email, c.nom_utilisateur_compte, c.numero_de_telephone,
                    c.photo_profil_compte, c.statut, c.compte_role,
                    c.date_creation, c.date_derniere_connexion,
                    c.compagnie_id, c.emplacement_id, c.restaurant_id, c.boutique_id,
                    cmp.nom_compagnie,
                    rf.nom_restaurant_fast_food as nom_restaurant,
                    b.nom_boutique
                FROM COMPTES c
                LEFT JOIN COMPAGNIESTRANSPORT cmp ON cmp.id = c.compagnie_id
                LEFT JOIN RESTAURANTSFASTFOOD rf ON rf.id = c.restaurant_id
                LEFT JOIN BOUTIQUES b ON b.id = c.boutique_id
                ${whereClause}
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
    
    /**
     * Récupérer un compte par ID
     * GET /api/v1/comptes/:id
     */
    static async getById(req, res, next) {
        try {
            const { id } = req.params;

            // Vérifier les permissions
            if (req.user.id !== parseInt(id) && !req.user.roles.includes('ADMINISTRATEUR_PLATEFORME')) {
                throw new AuthorizationError('Vous n\'avez pas les permissions pour voir ce compte');
            }

            const result = await db.query(
                `SELECT 
                    c.id, c.email, c.nom_utilisateur_compte, c.numero_de_telephone,
                    c.photo_profil_compte, c.localisation_livraison, c.statut, 
                    c.compte_role, c.date_creation, c.date_derniere_connexion,
                    c.compagnie_id, c.emplacement_id, c.restaurant_id, c.boutique_id,
                    cmp.nom_compagnie,
                    rf.nom_restaurant_fast_food as nom_restaurant,
                    b.nom_boutique,
                    (
                        SELECT json_agg(json_build_object(
                            'id', d.id,
                            'type_document', d.type_document,
                            'statut', d.statut,
                            'date_upload', d.date_upload
                        ))
                        FROM DOCUMENTS d
                        WHERE d.entite_type = 'COMPTE' AND d.entite_id = c.id
                    ) as documents
                FROM COMPTES c
                LEFT JOIN COMPAGNIESTRANSPORT cmp ON cmp.id = c.compagnie_id
                LEFT JOIN RESTAURANTSFASTFOOD rf ON rf.id = c.restaurant_id
                LEFT JOIN BOUTIQUES b ON b.id = c.boutique_id
                WHERE c.id = $1 AND c.est_supprime = false`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Compte non trouvé', 404);
            }

            // Pour les utilisateurs non-admin, masquer certaines données sensibles
            const compte = result.rows[0];
            if (req.user.id !== parseInt(id)) {
                delete compte.email;
                delete compte.numero_de_telephone;
            }

            res.json({
                success: true,
                data: compte
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Mettre à jour un compte
     * PUT /api/v1/comptes/:id
     */
    static async update(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const {
                nom_utilisateur_compte,
                numero_de_telephone,
                photo_profil_compte,
                localisation_livraison,
                // Champs admin seulement
                statut,
                compte_role,
                compagnie_id,
                emplacement_id,
                restaurant_id,
                boutique_id
            } = req.body;

            // Vérifier les permissions
            const isAdmin = req.user.roles.includes('ADMINISTRATEUR_PLATEFORME');
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
            let updates = [];
            let params = [];
            let paramIndex = 1;

            // Champs que l'utilisateur peut modifier lui-même
            if (nom_utilisateur_compte && nom_utilisateur_compte !== currentUser.nom_utilisateur_compte) {
                // Vérifier unicité
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
                // Vérifier unicité
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

            if (localisation_livraison) {
                updates.push(`localisation_livraison = ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)`);
                params.push(localisation_livraison.lng, localisation_livraison.lat);
                paramIndex += 2;
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

                if (compagnie_id !== undefined) {
                    updates.push(`compagnie_id = $${paramIndex++}`);
                    params.push(compagnie_id);
                }

                if (emplacement_id !== undefined) {
                    updates.push(`emplacement_id = $${paramIndex++}`);
                    params.push(emplacement_id);
                }

                if (restaurant_id !== undefined) {
                    updates.push(`restaurant_id = $${paramIndex++}`);
                    params.push(restaurant_id);
                }

                if (boutique_id !== undefined) {
                    updates.push(`boutique_id = $${paramIndex++}`);
                    params.push(boutique_id);
                }
            }

            if (updates.length === 0) {
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

            // Journaliser l'action
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'COMPTES',
                ressource_id: id,
                donnees_avant: currentUser,
                donnees_apres: result.rows[0],
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
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
        const client = await db.getConnection();
        try {
            const { id } = req.params;

            if (req.user.id !== parseInt(id) && !req.user.roles.includes('ADMINISTRATEUR_PLATEFORME')) {
                throw new AuthorizationError('Non autorisé');
            }

            if (!req.file) {
                throw new ValidationError('Aucun fichier fourni');
            }

            // Uploader le fichier
            const fileResult = await FileService.upload(req.file, {
                folder: 'profiles',
                userId: id,
                resize: true,
                sizes: [
                    { width: 150, height: 150, suffix: 'small' },
                    { width: 300, height: 300, suffix: 'medium' }
                ]
            });

            // Mettre à jour le compte
            await client.query(
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
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer un compte (soft delete)
     * DELETE /api/v1/comptes/:id
     */
    static async delete(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            // Vérifier les permissions
            if (req.user.id !== parseInt(id) && !req.user.roles.includes('ADMINISTRATEUR_PLATEFORME')) {
                throw new AuthorizationError('Non autorisé');
            }

            // Récupérer l'état actuel
            const currentResult = await client.query(
                `SELECT * FROM COMPTES WHERE id = $1`,
                [id]
            );

            if (currentResult.rows.length === 0) {
                throw new AppError('Compte non trouvé', 404);
            }

            // Soft delete
            await client.query(
                `UPDATE COMPTES 
                 SET est_supprime = true, 
                     date_suppression = NOW(),
                     statut = 'SUSPENDU'
                 WHERE id = $1`,
                [id]
            );

            // Désactiver toutes les sessions
            await client.query(
                `UPDATE SESSIONS 
                 SET est_active = false, date_revocation = NOW(), motif_revocation = 'ACCOUNT_DELETED'
                 WHERE compte_id = $1 AND est_active = true`,
                [id]
            );

            // Journaliser l'action
            await AuditService.log({
                action: 'DELETE',
                ressource_type: 'COMPTES',
                ressource_id: id,
                donnees_avant: currentResult.rows[0],
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
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
        const client = await db.getConnection();
        try {
            const { id } = req.params;

            // Vérifier que l'utilisateur existe et est supprimé
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
                localisation,
                rayon_km,
                page = 1,
                limit = 20
            } = req.query;

            let query = `
                SELECT 
                    c.id, c.nom_utilisateur_compte, c.photo_profil_compte,
                    c.compte_role, c.statut,
                    ST_AsGeoJSON(c.localisation_livraison) as localisation
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

            if (localisation && rayon_km) {
                const [lng, lat] = localisation.split(',').map(Number);
                query += ` AND ST_DWithin(
                    c.localisation_livraison::geography,
                    ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)::geography,
                    $${paramIndex + 2}
                )`;
                params.push(lng, lat, rayon_km * 1000);
                paramIndex += 3;
            }

            query += ` ORDER BY c.date_creation DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, (page - 1) * limit);

            const result = await db.query(query, params);

            res.json({
                success: true,
                data: result.rows.map(row => ({
                    ...row,
                    localisation: row.localisation ? JSON.parse(row.localisation) : null
                })),
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
                    json_agg(DISTINCT compte_role) as roles_disponibles,
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