const db = require('../../configuration/database');
const { AppError, ValidationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const GeoService = require('../../services/geo/GeoService');
const { ENUM_JOURS_OUVERTURE } = require('../../utils/constants/enums');

class EmplacementController {
    /**
     * Récupérer tous les emplacements d'une compagnie
     * GET /api/v1/transport/compagnies/:compagnieId/emplacements
     */
    static async getAll(req, res, next) {
        try {
            const { compagnieId } = req.params;
            const { 
                page = 1, 
                limit = 20, 
                actif,
                avec_tickets = false,
                recherche 
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    et.id, et.nom_emplacement,
                    ST_AsGeoJSON(et.localisation_emplacement) as localisation,
                    ST_AsGeoJSON(et.localisation_arret_bus) as localisation_arret,
                    et.jours_ouverture_emplacement_transport,
                    et.portefeuille_emplacement,
                    et.est_actif, et.date_creation,
                    ct.nom_compagnie
            `;

            if (avec_tickets === 'true') {
                query += `,
                    (
                        SELECT json_agg(json_build_object(
                            'id', tt.id,
                            'nom', tt.nom_produit,
                            'prix', tt.prix_vente_produit,
                            'quantite_stock', tt.quantite_stock,
                            'journalier', tt.journalier,
                            'hebdomadaire', tt.hebdomadaire,
                            'mensuel', tt.mensuel
                        ))
                        FROM TICKETSTRANSPORT tt
                        WHERE tt.emplacement_id = et.id AND tt.actif = true
                    ) as tickets
                `;
            }

            query += `
                FROM EMPLACEMENTSTRANSPORT et
                JOIN COMPAGNIESTRANSPORT ct ON ct.id = et.compagnie_id
                WHERE et.compagnie_id = $1
            `;

            const params = [compagnieId];
            let paramIndex = 2;

            if (actif !== undefined) {
                query += ` AND et.est_actif = $${paramIndex}`;
                params.push(actif === 'true');
                paramIndex++;
            }

            if (recherche) {
                query += ` AND et.nom_emplacement ILIKE $${paramIndex}`;
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            query += ` ORDER BY et.nom_emplacement ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await db.query(query, params);

            // Formater les résultats
            const emplacements = result.rows.map(emp => ({
                ...emp,
                localisation: emp.localisation ? JSON.parse(emp.localisation) : null,
                localisation_arret: emp.localisation_arret ? JSON.parse(emp.localisation_arret) : null,
                portefeuille_emplacement: parseFloat(emp.portefeuille_emplacement)
            }));

            // Compter le total
            const countResult = await db.query(
                `SELECT COUNT(*) as total 
                 FROM EMPLACEMENTSTRANSPORT 
                 WHERE compagnie_id = $1`,
                [compagnieId]
            );

            res.json({
                success: true,
                data: emplacements,
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
     * Récupérer un emplacement par ID
     * GET /api/v1/transport/emplacements/:id
     */
    static async getById(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT 
                    et.*,
                    ST_AsGeoJSON(et.localisation_emplacement) as localisation,
                    ST_AsGeoJSON(et.localisation_arret_bus) as localisation_arret,
                    ct.nom_compagnie,
                    ct.logo_compagnie,
                    (
                        SELECT json_agg(json_build_object(
                            'id', tt.id,
                            'nom', tt.nom_produit,
                            'description', tt.description_produit,
                            'prix', tt.prix_vente_produit,
                            'quantite_stock', tt.quantite_stock,
                            'quantite_vendu', tt.quantite_vendu,
                            'journalier', tt.journalier,
                            'hebdomadaire', tt.hebdomadaire,
                            'mensuel', tt.mensuel,
                            'donnees', tt.donnees_secondaires_produit
                        ))
                        FROM TICKETSTRANSPORT tt
                        WHERE tt.emplacement_id = et.id AND tt.actif = true
                        ORDER BY tt.prix_vente_produit ASC
                    ) as tickets_disponibles,
                    (
                        SELECT json_agg(json_build_object(
                            'id', s.id,
                            'nom', s.nom_service,
                            'type', s.type_service,
                            'prix', s.prix_service,
                            'duree_validite', s.duree_validite_jours
                        ))
                        FROM SERVICES s
                        WHERE s.emplacement_id = et.id AND s.actif = true
                    ) as services_disponibles
                FROM EMPLACEMENTSTRANSPORT et
                JOIN COMPAGNIESTRANSPORT ct ON ct.id = et.compagnie_id
                WHERE et.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Emplacement non trouvé', 404);
            }

            const emplacement = result.rows[0];
            
            // Formater les géométries
            if (emplacement.localisation) {
                emplacement.localisation = JSON.parse(emplacement.localisation);
            }
            if (emplacement.localisation_arret) {
                emplacement.localisation_arret = JSON.parse(emplacement.localisation_arret);
            }

            res.json({
                success: true,
                data: emplacement
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Créer un nouvel emplacement
     * POST /api/v1/transport/compagnies/:compagnieId/emplacements
     */
    static async create(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { compagnieId } = req.params;
            const {
                nom_emplacement,
                localisation,
                jours_ouverture,
                localisation_arret_bus
            } = req.body;

            // Vérifier que la compagnie existe
            const compagnieExists = await client.query(
                `SELECT id FROM COMPAGNIESTRANSPORT WHERE id = $1`,
                [compagnieId]
            );

            if (compagnieExists.rows.length === 0) {
                throw new AppError('Compagnie non trouvée', 404);
            }

            // Construire la requête d'insertion avec PostGIS
            let query = `
                INSERT INTO EMPLACEMENTSTRANSPORT (
                    nom_emplacement,
                    compagnie_id,
                    jours_ouverture_emplacement_transport,
                    date_creation,
                    date_mise_a_jour
            `;

            const values = [nom_emplacement, compagnieId, jours_ouverture || 'LUNDI_VENDREDI'];
            let valueIndex = 4;

            if (localisation) {
                query += `, localisation_emplacement`;
                values.push(`POINT(${localisation.lng} ${localisation.lat})`);
                valueIndex++;
            }

            if (localisation_arret_bus) {
                query += `, localisation_arret_bus`;
                values.push(`POINT(${localisation_arret_bus.lng} ${localisation_arret_bus.lat})`);
                valueIndex++;
            }

            query += `) VALUES ($1, $2, $3, NOW(), NOW()`;

            for (let i = 4; i < valueIndex; i++) {
                query += `, $${i}`;
            }

            query += `) RETURNING *`;

            // Exécuter avec conversion PostGIS
            const result = await client.query(query, values);

            const newEmplacement = result.rows[0];

            // Journaliser l'action
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'EMPLACEMENTSTRANSPORT',
                ressource_id: newEmplacement.id,
                donnees_apres: newEmplacement,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Emplacement créé avec succès',
                data: newEmplacement
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour un emplacement
     * PUT /api/v1/transport/emplacements/:id
     */
    static async update(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const {
                nom_emplacement,
                localisation,
                jours_ouverture,
                localisation_arret_bus,
                est_actif
            } = req.body;

            // Récupérer l'état actuel
            const currentResult = await client.query(
                `SELECT * FROM EMPLACEMENTSTRANSPORT WHERE id = $1`,
                [id]
            );

            if (currentResult.rows.length === 0) {
                throw new AppError('Emplacement non trouvé', 404);
            }

            const current = currentResult.rows[0];

            // Construire la requête de mise à jour dynamique
            let updates = [];
            let params = [];
            let paramIndex = 1;

            if (nom_emplacement) {
                updates.push(`nom_emplacement = $${paramIndex++}`);
                params.push(nom_emplacement);
            }

            if (jours_ouverture) {
                updates.push(`jours_ouverture_emplacement_transport = $${paramIndex++}`);
                params.push(jours_ouverture);
            }

            if (est_actif !== undefined) {
                updates.push(`est_actif = $${paramIndex++}`);
                params.push(est_actif);
            }

            if (localisation) {
                updates.push(`localisation_emplacement = ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)`);
                params.push(localisation.lng, localisation.lat);
                paramIndex += 2;
            }

            if (localisation_arret_bus) {
                updates.push(`localisation_arret_bus = ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)`);
                params.push(localisation_arret_bus.lng, localisation_arret_bus.lat);
                paramIndex += 2;
            }

            if (updates.length === 0) {
                return res.json({
                    success: true,
                    message: 'Aucune modification',
                    data: current
                });
            }

            updates.push(`date_mise_a_jour = NOW()`);
            params.push(id);

            const updateQuery = `
                UPDATE EMPLACEMENTSTRANSPORT 
                SET ${updates.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING *
            `;

            const result = await client.query(updateQuery, params);

            const updated = result.rows[0];

            // Journaliser l'action
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'EMPLACEMENTSTRANSPORT',
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
                message: 'Emplacement mis à jour avec succès',
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
     * Récupérer les emplacements à proximité
     * GET /api/v1/transport/emplacements/proximite
     */
    static async getNearby(req, res, next) {
        try {
            const { 
                lat, 
                lng, 
                rayon_km = 5, 
                limit = 20,
                avec_tickets = true 
            } = req.query;

            if (!lat || !lng) {
                throw new ValidationError('Latitude et longitude requises');
            }

            let query = `
                SELECT 
                    et.id, et.nom_emplacement,
                    ct.nom_compagnie,
                    ct.logo_compagnie,
                    ST_Distance(
                        et.localisation_emplacement::geography,
                        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                    ) as distance,
                    ST_AsGeoJSON(et.localisation_emplacement) as localisation,
                    et.jours_ouverture_emplacement_transport
            `;

            if (avec_tickets === 'true') {
                query += `,
                    (
                        SELECT json_agg(json_build_object(
                            'id', tt.id,
                            'nom', tt.nom_produit,
                            'prix', tt.prix_vente_produit,
                            'type', CASE 
                                WHEN tt.journalier THEN 'journalier'
                                WHEN tt.hebdomadaire THEN 'hebdomadaire'
                                WHEN tt.mensuel THEN 'mensuel'
                            END
                        ))
                        FROM TICKETSTRANSPORT tt
                        WHERE tt.emplacement_id = et.id AND tt.actif = true
                        ORDER BY tt.prix_vente_produit ASC
                        LIMIT 5
                    ) as tickets_populaires
                `;
            }

            query += `
                FROM EMPLACEMENTSTRANSPORT et
                JOIN COMPAGNIESTRANSPORT ct ON ct.id = et.compagnie_id
                WHERE et.est_actif = true
                  AND ct.est_actif = true
                  AND ST_DWithin(
                      et.localisation_emplacement::geography,
                      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                      $3 * 1000
                  )
                ORDER BY distance ASC
                LIMIT $4
            `;

            const result = await db.query(query, [lng, lat, rayon_km, limit]);

            const emplacements = result.rows.map(emp => ({
                ...emp,
                distance: Math.round(emp.distance),
                localisation: emp.localisation ? JSON.parse(emp.localisation) : null
            }));

            res.json({
                success: true,
                data: emplacements,
                meta: {
                    centre: { lat: parseFloat(lat), lng: parseFloat(lng) },
                    rayon_km: parseFloat(rayon_km),
                    total: emplacements.length
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Vérifier la disponibilité d'un emplacement
     * GET /api/v1/transport/emplacements/:id/disponibilite
     */
    static async checkDisponibilite(req, res, next) {
        try {
            const { id } = req.params;
            const { date, type_ticket } = req.query;

            const checkDate = date ? new Date(date) : new Date();

            // Vérifier si l'emplacement est ouvert à cette date
            const estOuvert = await db.query(
                `SELECT fn_est_ouvert('EMPLACEMENT_TRANSPORT'::entite_reference, $1, $2) as est_ouvert`,
                [id, checkDate]
            );

            // Récupérer les tickets disponibles
            const ticketsResult = await db.query(
                `SELECT 
                    id, nom_produit, prix_vente_produit, quantite_stock,
                    journalier, hebdomadaire, mensuel,
                    CASE 
                        WHEN journalier THEN 'journalier'
                        WHEN hebdomadaire THEN 'hebdomadaire'
                        WHEN mensuel THEN 'mensuel'
                    END as type_ticket
                FROM TICKETSTRANSPORT
                WHERE emplacement_id = $1 
                  AND actif = true
                  AND quantite_stock > 0
                ORDER BY prix_vente_produit ASC`,
                [id]
            );

            res.json({
                success: true,
                data: {
                    emplacement_id: id,
                    date: checkDate,
                    est_ouvert: estOuvert.rows[0].est_ouvert,
                    tickets_disponibles: ticketsResult.rows,
                    horaires: {
                        // À compléter avec la table HORAIRES
                    }
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les statistiques d'un emplacement
     * GET /api/v1/transport/emplacements/:id/stats
     */
    static async getStats(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT 
                    et.id, et.nom_emplacement,
                    et.portefeuille_emplacement,
                    COUNT(DISTINCT tt.id) as nombre_tickets,
                    COALESCE(SUM(tt.quantite_vendu), 0) as tickets_vendus,
                    COALESCE(SUM(tt.quantite_vendu * tt.prix_vente_produit), 0) as chiffre_affaires,
                    (
                        SELECT COUNT(*)
                        FROM ACHATSTICKETSPRIVE asp
                        JOIN TICKETSTRANSPORT tt2 ON tt2.id = asp.ticket_id
                        WHERE tt2.emplacement_id = et.id
                          AND asp.date_achat_prive >= NOW() - INTERVAL '30 days'
                    ) as achats_30j,
                    (
                        SELECT json_agg(json_build_object(
                            'nom', tt3.nom_produit,
                            'ventes', tt3.quantite_vendu,
                            'revenu', tt3.quantite_vendu * tt3.prix_vente_produit
                        ))
                        FROM TICKETSTRANSPORT tt3
                        WHERE tt3.emplacement_id = et.id
                        ORDER BY tt3.quantite_vendu DESC
                        LIMIT 5
                    ) as tickets_plus_vendus
                FROM EMPLACEMENTSTRANSPORT et
                LEFT JOIN TICKETSTRANSPORT tt ON tt.emplacement_id = et.id
                WHERE et.id = $1
                GROUP BY et.id`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Emplacement non trouvé', 404);
            }

            res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Supprimer un emplacement
     * DELETE /api/v1/transport/emplacements/:id
     */
    static async delete(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            // Vérifier les dépendances
            const dependencies = await client.query(
                `SELECT 
                    (SELECT COUNT(*) FROM TICKETSTRANSPORT WHERE emplacement_id = $1) as tickets,
                    (SELECT COUNT(*) FROM SERVICES WHERE emplacement_id = $1) as services,
                    (SELECT COUNT(*) FROM COMPTES WHERE emplacement_id = $1) as comptes`,
                [id]
            );

            const deps = dependencies.rows[0];
            if (deps.tickets > 0 || deps.services > 0 || deps.comptes > 0) {
                throw new AppError(
                    'Impossible de supprimer : l\'emplacement a des dépendances actives',
                    409
                );
            }

            // Récupérer l'état actuel
            const currentResult = await client.query(
                `SELECT * FROM EMPLACEMENTSTRANSPORT WHERE id = $1`,
                [id]
            );

            if (currentResult.rows.length === 0) {
                throw new AppError('Emplacement non trouvé', 404);
            }

            // Supprimer (soft delete en mettant est_actif = false)
            await client.query(
                `UPDATE EMPLACEMENTSTRANSPORT 
                 SET est_actif = false, date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [id]
            );

            // Journaliser l'action
            await AuditService.log({
                action: 'DELETE',
                ressource_type: 'EMPLACEMENTSTRANSPORT',
                ressource_id: id,
                donnees_avant: currentResult.rows[0],
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Emplacement désactivé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }
}

module.exports = EmplacementController;