const db = require('../../configuration/database');
const { AppError, ValidationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const GeoService = require('../../services/geo/GeoService');

class CompagnieController {
    /**
     * Récupérer toutes les compagnies
     * GET /api/v1/transport/compagnies
     */
    static async getAll(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                actif,
                recherche,
                avec_stats = false
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    ct.id, ct.nom_compagnie, ct.description_compagnie,
                    ct.logo_compagnie, ct.pourcentage_commission_plateforme,
                    ct.portefeuille_compagnie, ct.est_actif, ct.date_creation,
                    COUNT(DISTINCT et.id) as nombre_emplacements
            `;

            if (avec_stats === 'true') {
                query += `,
                    COUNT(DISTINCT tt.id) as nombre_tickets,
                    COALESCE(SUM(tt.quantite_vendu), 0) as total_tickets_vendus,
                    (
                        SELECT json_agg(json_build_object(
                            'nom', et2.nom_emplacement,
                            'id', et2.id,
                            'localisation', ST_AsGeoJSON(et2.localisation_emplacement)
                        ))
                        FROM EMPLACEMENTSTRANSPORT et2
                        WHERE et2.compagnie_id = ct.id AND et2.est_actif = true
                        LIMIT 5
                    ) as emplacements_principaux
                `;
            }

            query += `
                FROM COMPAGNIESTRANSPORT ct
                LEFT JOIN EMPLACEMENTSTRANSPORT et ON et.compagnie_id = ct.id
            `;

            if (avec_stats === 'true') {
                query += ` LEFT JOIN TICKETSTRANSPORT tt ON tt.compagnie_id = ct.id AND tt.actif = true`;
            }

            query += ` WHERE ct.est_supprime = false`;

            const params = [];
            let paramIndex = 1;

            if (actif !== undefined) {
                query += ` AND ct.est_actif = $${paramIndex}`;
                params.push(actif === 'true');
                paramIndex++;
            }

            if (recherche) {
                query += ` AND ct.nom_compagnie ILIKE $${paramIndex}`;
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            query += ` GROUP BY ct.id`;

            if (avec_stats === 'true') {
                query += ` ORDER BY ct.nom_compagnie ASC`;
            } else {
                query += ` ORDER BY ct.date_creation DESC`;
            }

            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await db.query(query, params);

            // Formater les résultats
            const compagnies = result.rows.map(comp => ({
                ...comp,
                portefeuille_compagnie: parseFloat(comp.portefeuille_compagnie),
                pourcentage_commission_plateforme: parseFloat(comp.pourcentage_commission_plateforme),
                emplacements_principaux: comp.emplacements_principaux ? 
                    comp.emplacements_principaux.map(emp => ({
                        ...emp,
                        localisation: emp.localisation ? JSON.parse(emp.localisation) : null
                    })) : null
            }));

            // Compter le total
            const countResult = await db.query(
                `SELECT COUNT(*) as total FROM COMPAGNIESTRANSPORT WHERE est_supprime = false`
            );

            res.json({
                success: true,
                data: compagnies,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(countResult.rows[0].total),
                    pages: Math.ceil(parseInt(countResult.rows[0].total) / limit)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer une compagnie par ID
     * GET /api/v1/transport/compagnies/:id
     */
    static async getById(req, res, next) {
        try {
            const { id } = req.params;
            const { include_emplacements = true, include_tickets = true } = req.query;

            const result = await db.query(
                `SELECT 
                    ct.*,
                    p.nom_plateforme,
                    (
                        SELECT json_agg(json_build_object(
                            'id', et.id,
                            'nom', et.nom_emplacement,
                            'localisation', ST_AsGeoJSON(et.localisation_emplacement),
                            'jours_ouverture', et.jours_ouverture_emplacement_transport,
                            'portefeuille', et.portefeuille_emplacement,
                            'est_actif', et.est_actif,
                            'nombre_tickets', (
                                SELECT COUNT(*) FROM TICKETSTRANSPORT tt 
                                WHERE tt.emplacement_id = et.id AND tt.actif = true
                            )
                        ))
                        FROM EMPLACEMENTSTRANSPORT et
                        WHERE et.compagnie_id = ct.id AND et.est_actif = true
                    ) as emplacements,
                    (
                        SELECT json_agg(json_build_object(
                            'id', s.id,
                            'nom_service', s.nom_service,
                            'type_service', s.type_service,
                            'prix_service', s.prix_service,
                            'actif', s.actif
                        ))
                        FROM SERVICES s
                        WHERE s.compagnie_id = ct.id AND s.actif = true
                        LIMIT 10
                    ) as services_recents
                FROM COMPAGNIESTRANSPORT ct
                LEFT JOIN PLATEFORME p ON p.id = ct.plateforme_id
                WHERE ct.id = $1 AND ct.est_supprime = false`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Compagnie non trouvée', 404);
            }

            const compagnie = result.rows[0];
            
            // Formater les données
            if (compagnie.emplacements) {
                compagnie.emplacements = compagnie.emplacements.map(emp => ({
                    ...emp,
                    localisation: emp.localisation ? JSON.parse(emp.localisation) : null
                }));
            }

            res.json({
                success: true,
                data: compagnie
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Créer une nouvelle compagnie
     * POST /api/v1/transport/compagnies
     */
    static async create(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const {
                nom_compagnie,
                description_compagnie,
                logo_compagnie,
                pourcentage_commission_plateforme,
                plateforme_id
            } = req.body;

            // Vérifier si le nom existe déjà
            const existing = await client.query(
                `SELECT id FROM COMPAGNIESTRANSPORT WHERE nom_compagnie = $1`,
                [nom_compagnie]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError('Une compagnie avec ce nom existe déjà');
            }

            const result = await client.query(
                `INSERT INTO COMPAGNIESTRANSPORT (
                    nom_compagnie, description_compagnie, logo_compagnie,
                    pourcentage_commission_plateforme, plateforme_id,
                    date_creation, date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                RETURNING *`,
                [nom_compagnie, description_compagnie, logo_compagnie,
                 pourcentage_commission_plateforme, plateforme_id || 1]
            );

            const newCompagnie = result.rows[0];

            // Journaliser l'action
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'COMPAGNIESTRANSPORT',
                ressource_id: newCompagnie.id,
                donnees_apres: newCompagnie,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Compagnie créée avec succès',
                data: newCompagnie
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour une compagnie
     * PUT /api/v1/transport/compagnies/:id
     */
    static async update(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const {
                nom_compagnie,
                description_compagnie,
                logo_compagnie,
                pourcentage_commission_plateforme,
                est_actif
            } = req.body;

            // Récupérer l'état actuel
            const currentResult = await client.query(
                `SELECT * FROM COMPAGNIESTRANSPORT WHERE id = $1`,
                [id]
            );

            if (currentResult.rows.length === 0) {
                throw new AppError('Compagnie non trouvée', 404);
            }

            const current = currentResult.rows[0];

            // Vérifier unicité du nom si modifié
            if (nom_compagnie && nom_compagnie !== current.nom_compagnie) {
                const existing = await client.query(
                    `SELECT id FROM COMPAGNIESTRANSPORT WHERE nom_compagnie = $1 AND id != $2`,
                    [nom_compagnie, id]
                );
                if (existing.rows.length > 0) {
                    throw new ValidationError('Une compagnie avec ce nom existe déjà');
                }
            }

            const result = await client.query(
                `UPDATE COMPAGNIESTRANSPORT 
                 SET nom_compagnie = COALESCE($1, nom_compagnie),
                     description_compagnie = COALESCE($2, description_compagnie),
                     logo_compagnie = COALESCE($3, logo_compagnie),
                     pourcentage_commission_plateforme = COALESCE($4, pourcentage_commission_plateforme),
                     est_actif = COALESCE($5, est_actif),
                     date_mise_a_jour = NOW()
                 WHERE id = $6
                 RETURNING *`,
                [nom_compagnie, description_compagnie, logo_compagnie,
                 pourcentage_commission_plateforme, est_actif, id]
            );

            const updated = result.rows[0];

            // Journaliser l'action
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'COMPAGNIESTRANSPORT',
                ressource_id: id,
                donnees_avant: current,
                donnees_apres: updated,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Compagnie mise à jour avec succès',
                data: updated
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les statistiques d'une compagnie
     * GET /api/v1/transport/compagnies/:id/stats
     */
    static async getStats(req, res, next) {
        try {
            const { id } = req.params;
            const { periode = '30d' } = req.query;

            let interval = "30 days";
            if (periode === '7d') interval = "7 days";
            if (periode === '90d') interval = "90 days";
            if (periode === '1y') interval = "1 year";

            const result = await db.query(
                `WITH stats AS (
                    SELECT 
                        ct.id,
                        ct.nom_compagnie,
                        ct.portefeuille_compagnie,
                        COUNT(DISTINCT et.id) as total_emplacements,
                        COUNT(DISTINCT tt.id) as total_tickets,
                        COALESCE(SUM(tt.quantite_vendu), 0) as tickets_vendus_total,
                        COALESCE(SUM(tt.quantite_vendu * tt.prix_vente_produit), 0) as chiffre_affaires_total,
                        (
                            SELECT COUNT(*)
                            FROM ACHATSTICKETSPRIVE asp
                            JOIN TICKETSTRANSPORT tt2 ON tt2.id = asp.ticket_id
                            WHERE tt2.compagnie_id = ct.id
                              AND asp.date_achat_prive >= NOW() - $2::interval
                        ) as achats_recents,
                        (
                            SELECT json_agg(json_build_object(
                                'date', DATE(asp.date_achat_prive),
                                'total', SUM(asp.total_transaction)
                            ))
                            FROM ACHATSTICKETSPRIVE asp
                            JOIN TICKETSTRANSPORT tt3 ON tt3.id = asp.ticket_id
                            WHERE tt3.compagnie_id = ct.id
                              AND asp.date_achat_prive >= NOW() - $2::interval
                            GROUP BY DATE(asp.date_achat_prive)
                            ORDER BY DATE(asp.date_achat_prive) DESC
                            LIMIT 30
                        ) as evolution_ventes
                    FROM COMPAGNIESTRANSPORT ct
                    LEFT JOIN EMPLACEMENTSTRANSPORT et ON et.compagnie_id = ct.id
                    LEFT JOIN TICKETSTRANSPORT tt ON tt.compagnie_id = ct.id AND tt.actif = true
                    WHERE ct.id = $1
                    GROUP BY ct.id
                )
                SELECT * FROM stats`,
                [id, interval]
            );

            if (result.rows.length === 0) {
                throw new AppError('Compagnie non trouvée', 404);
            }

            res.json({
                success: true,
                data: {
                    ...result.rows[0],
                    periode
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les compagnies à proximité
     * GET /api/v1/transport/compagnies/proximite
     */
    static async getNearby(req, res, next) {
        try {
            const { lat, lng, rayon_km = 5, limit = 20 } = req.query;

            if (!lat || !lng) {
                throw new ValidationError('Latitude et longitude requises');
            }

            const result = await db.query(
                `SELECT DISTINCT
                    ct.id, ct.nom_compagnie, ct.logo_compagnie,
                    et.nom_emplacement,
                    ST_Distance(
                        et.localisation_emplacement::geography,
                        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                    ) as distance,
                    ST_AsGeoJSON(et.localisation_emplacement) as localisation,
                    tt.id as ticket_id,
                    tt.nom_produit as ticket_nom,
                    tt.prix_vente_produit as ticket_prix
                FROM COMPAGNIESTRANSPORT ct
                JOIN EMPLACEMENTSTRANSPORT et ON et.compagnie_id = ct.id
                LEFT JOIN TICKETSTRANSPORT tt ON tt.emplacement_id = et.id AND tt.actif = true
                WHERE ct.est_actif = true
                  AND et.est_actif = true
                  AND ST_DWithin(
                      et.localisation_emplacement::geography,
                      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                      $3 * 1000
                  )
                ORDER BY distance ASC
                LIMIT $4`,
                [lng, lat, rayon_km, limit]
            );

            // Grouper par compagnie
            const compagniesMap = new Map();
            
            result.rows.forEach(row => {
                if (!compagniesMap.has(row.id)) {
                    compagniesMap.set(row.id, {
                        id: row.id,
                        nom_compagnie: row.nom_compagnie,
                        logo_compagnie: row.logo_compagnie,
                        distance: row.distance,
                        emplacements: [],
                        tickets: []
                    });
                }

                const compagnie = compagniesMap.get(row.id);
                
                // Ajouter l'emplacement s'il n'existe pas déjà
                const emplacementExistant = compagnie.emplacements.find(e => e.nom === row.nom_emplacement);
                if (!emplacementExistant) {
                    compagnie.emplacements.push({
                        nom: row.nom_emplacement,
                        localisation: row.localisation ? JSON.parse(row.localisation) : null
                    });
                }

                // Ajouter le ticket s'il existe et n'est pas déjà dans la liste
                if (row.ticket_id) {
                    const ticketExistant = compagnie.tickets.find(t => t.id === row.ticket_id);
                    if (!ticketExistant) {
                        compagnie.tickets.push({
                            id: row.ticket_id,
                            nom: row.ticket_nom,
                            prix: parseFloat(row.ticket_prix)
                        });
                    }
                }
            });

            res.json({
                success: true,
                data: Array.from(compagniesMap.values()),
                meta: {
                    centre: { lat: parseFloat(lat), lng: parseFloat(lng) },
                    rayon_km: parseFloat(rayon_km)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Supprimer une compagnie (soft delete)
     * DELETE /api/v1/transport/compagnies/:id
     */
    static async delete(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            // Vérifier s'il y a des dépendances
            const dependencies = await client.query(
                `SELECT 
                    (SELECT COUNT(*) FROM EMPLACEMENTSTRANSPORT WHERE compagnie_id = $1) as emplacements,
                    (SELECT COUNT(*) FROM TICKETSTRANSPORT WHERE compagnie_id = $1) as tickets,
                    (SELECT COUNT(*) FROM SERVICES WHERE compagnie_id = $1) as services,
                    (SELECT COUNT(*) FROM COMPTES WHERE compagnie_id = $1) as comptes`,
                [id]
            );

            const deps = dependencies.rows[0];
            if (deps.emplacements > 0 || deps.tickets > 0 || deps.services > 0 || deps.comptes > 0) {
                throw new AppError(
                    'Impossible de supprimer : la compagnie a des dépendances actives', 
                    409
                );
            }

            // Récupérer l'état actuel
            const currentResult = await client.query(
                `SELECT * FROM COMPAGNIESTRANSPORT WHERE id = $1`,
                [id]
            );

            if (currentResult.rows.length === 0) {
                throw new AppError('Compagnie non trouvée', 404);
            }

            // Soft delete
            await client.query(
                `UPDATE COMPAGNIESTRANSPORT 
                 SET est_supprime = true, 
                     date_suppression = NOW(),
                     est_actif = false
                 WHERE id = $1`,
                [id]
            );

            // Journaliser l'action
            await AuditService.log({
                action: 'DELETE',
                ressource_type: 'COMPAGNIESTRANSPORT',
                ressource_id: id,
                donnees_avant: currentResult.rows[0],
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Compagnie supprimée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }
}

module.exports = CompagnieController;