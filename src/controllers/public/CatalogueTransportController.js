// src/controllers/public/CatalogueTransportController.js
const db = require('../../configuration/database');
const { ValidationError } = require('../../utils/errors/AppError');
const CacheService = require('../../services/cache/CacheService');
const GeoService = require('../../services/geo/GeoService');

class CatalogueTransportController {
    /**
     * Liste des compagnies de transport
     * @route GET /api/v1/public/transport/compagnies
     */
    async listCompagnies(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                avec_tickets = true,
                lat,
                lng,
                rayon_km = 10
            } = req.query;

            const offset = (page - 1) * limit;
            const cacheKey = `transport:compagnies:${page}:${limit}:${JSON.stringify(req.query)}`;
            
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    success: true,
                    data: cached,
                    fromCache: true
                });
            }

            let query = `
                SELECT 
                    c.id,
                    c.nom_compagnie as nom,
                    c.logo_compagnie as logo,
                    c.description_compagnie as description,
                    COUNT(DISTINCT e.id) as nombre_emplacements,
                    COUNT(DISTINCT t.id) as nombre_tickets,
                    MIN(t.prix_vente_produit) as prix_min_ticket,
                    MAX(t.prix_vente_produit) as prix_max_ticket
                FROM COMPAGNIESTRANSPORT c
                LEFT JOIN EMPLACEMENTSTRANSPORT e ON e.compagnie_id = c.id AND e.est_actif = true
                LEFT JOIN TICKETSTRANSPORT t ON t.compagnie_id = c.id AND t.actif = true
                WHERE c.est_actif = true AND c.est_supprime = false
            `;

            const params = [];
            let paramIndex = 1;

            if (avec_tickets === 'true') {
                query += ` AND EXISTS (
                    SELECT 1 FROM TICKETSTRANSPORT t2 
                    WHERE t2.compagnie_id = c.id AND t2.actif = true
                )`;
            }

            if (lat && lng) {
                const point = await GeoService.createPoint(parseFloat(lng), parseFloat(lat));
                query += ` AND EXISTS (
                    SELECT 1 FROM EMPLACEMENTSTRANSPORT e2
                    WHERE e2.compagnie_id = c.id
                      AND ST_DWithin(e2.localisation_emplacement::geography, $${paramIndex}::geography, $${paramIndex + 1})
                )`;
                params.push(point, parseFloat(rayon_km) * 1000);
                paramIndex += 2;
            }

            query += ` GROUP BY c.id`;

            // Compter le total
            const countQuery = `
                SELECT COUNT(*) as total
                FROM COMPAGNIESTRANSPORT
                WHERE est_actif = true AND est_supprime = false
            `;
            const countResult = await db.query(countQuery);

            query += ` ORDER BY c.nom_compagnie ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);

            const response = {
                compagnies: result.rows,
                total: parseInt(countResult.rows[0].total),
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(countResult.rows[0].total / limit)
            };

            await CacheService.set(cacheKey, response, 300);

            res.json({
                success: true,
                data: response
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Détails d'une compagnie de transport
     * @route GET /api/v1/public/transport/compagnies/:id
     */
    async getCompagnieDetails(req, res, next) {
        try {
            const { id } = req.params;

            const cacheKey = `transport:compagnie:${id}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    success: true,
                    data: cached,
                    fromCache: true
                });
            }

            const compagnie = await db.query(`
                SELECT 
                    c.id,
                    c.nom_compagnie as nom,
                    c.logo_compagnie as logo,
                    c.description_compagnie as description,
                    c.date_creation
                FROM COMPAGNIESTRANSPORT c
                WHERE c.id = $1 AND c.est_actif = true AND c.est_supprime = false
            `, [id]);

            if (compagnie.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Compagnie non trouvée'
                });
            }

            // Emplacements
            const emplacements = await db.query(`
                SELECT 
                    e.id,
                    e.nom_emplacement,
                    e.jours_ouverture_emplacement_transport,
                    ST_AsGeoJSON(e.localisation_emplacement) as geojson,
                    ST_AsGeoJSON(e.localisation_arret_bus) as arret_geojson,
                    (
                        SELECT COUNT(*) FROM TICKETSTRANSPORT 
                        WHERE emplacement_id = e.id AND actif = true
                    ) as nombre_tickets
                FROM EMPLACEMENTSTRANSPORT e
                WHERE e.compagnie_id = $1 AND e.est_actif = true
                ORDER BY e.nom_emplacement
            `, [id]);

            // Types de tickets disponibles
            const typesTickets = await db.query(`
                SELECT 
                    bool_or(journalier) as a_journalier,
                    bool_or(hebdomadaire) as a_hebdomadaire,
                    bool_or(mensuel) as a_mensuel
                FROM TICKETSTRANSPORT
                WHERE compagnie_id = $1 AND actif = true
            `, [id]);

            const response = {
                ...compagnie.rows[0],
                emplacements: emplacements.rows.map(e => ({
                    ...e,
                    geojson: e.geojson ? JSON.parse(e.geojson) : null,
                    arret_geojson: e.arret_geojson ? JSON.parse(e.arret_geojson) : null
                })),
                types_tickets_disponibles: typesTickets.rows[0]
            };

            await CacheService.set(cacheKey, response, 300);

            res.json({
                success: true,
                data: response
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Liste des tickets d'un emplacement
     * @route GET /api/v1/public/transport/emplacements/:id/tickets
     */
    async getTicketsByEmplacement(req, res, next) {
        try {
            const { id } = req.params;
            const { type } = req.query; // journalier, hebdomadaire, mensuel

            let query = `
                SELECT 
                    t.id,
                    t.nom_produit as nom,
                    t.description_produit as description,
                    t.prix_vente_produit as prix,
                    t.donnees_secondaires_produit as donnees,
                    t.quantite_stock as stock,
                    t.journalier,
                    t.hebdomadaire,
                    t.mensuel,
                    t.date_creation
                FROM TICKETSTRANSPORT t
                WHERE t.emplacement_id = $1 AND t.actif = true
            `;

            const params = [id];

            if (type === 'journalier') {
                query += ` AND t.journalier = true`;
            } else if (type === 'hebdomadaire') {
                query += ` AND t.hebdomadaire = true`;
            } else if (type === 'mensuel') {
                query += ` AND t.mensuel = true`;
            }

            query += ` ORDER BY t.prix_vente_produit ASC`;

            const result = await db.query(query, params);

            // Informations sur l'emplacement
            const emplacement = await db.query(`
                SELECT 
                    e.nom_emplacement,
                    c.nom_compagnie
                FROM EMPLACEMENTSTRANSPORT e
                JOIN COMPAGNIESTRANSPORT c ON c.id = e.compagnie_id
                WHERE e.id = $1
            `, [id]);

            res.json({
                success: true,
                data: {
                    emplacement: emplacement.rows[0] || { nom_emplacement: 'Inconnu' },
                    tickets: result.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Détails d'un ticket
     * @route GET /api/v1/public/transport/tickets/:id
     */
    async getTicketDetails(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(`
                SELECT 
                    t.id,
                    t.nom_produit as nom,
                    t.description_produit as description,
                    t.prix_vente_produit as prix,
                    t.donnees_secondaires_produit as donnees,
                    t.quantite_stock as stock,
                    t.journalier,
                    t.hebdomadaire,
                    t.mensuel,
                    e.nom_emplacement,
                    e.jours_ouverture_emplacement_transport,
                    c.nom_compagnie,
                    c.logo_compagnie as logo
                FROM TICKETSTRANSPORT t
                JOIN EMPLACEMENTSTRANSPORT e ON e.id = t.emplacement_id
                JOIN COMPAGNIESTRANSPORT c ON c.id = t.compagnie_id
                WHERE t.id = $1 AND t.actif = true
            `, [id]);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Ticket non trouvé'
                });
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
     * Recherche d'itinéraires
     * @route GET /api/v1/public/transport/itineraires
     */
    async searchItineraires(req, res, next) {
        try {
            const {
                from_lat, from_lng,
                to_lat, to_lng,
                date = new Date().toISOString()
            } = req.query;

            if (!from_lat || !from_lng || !to_lat || !to_lng) {
                throw new ValidationError('Points de départ et arrivée requis');
            }

            // Recherche des compagnies et emplacements proches
            const from = await GeoService.createPoint(parseFloat(from_lng), parseFloat(from_lat));
            const to = await GeoService.createPoint(parseFloat(to_lng), parseFloat(to_lat));

            const itinéraires = await db.query(`
                WITH emplacements_proches_depart AS (
                    SELECT 
                        e.id,
                        e.nom_emplacement,
                        e.compagnie_id,
                        c.nom_compagnie,
                        ST_Distance(e.localisation_emplacement::geography, $1::geography) as distance_depart
                    FROM EMPLACEMENTSTRANSPORT e
                    JOIN COMPAGNIESTRANSPORT c ON c.id = e.compagnie_id
                    WHERE e.est_actif = true
                      AND ST_DWithin(e.localisation_emplacement::geography, $1::geography, 5000)
                ),
                emplacements_proches_arrivee AS (
                    SELECT 
                        e.id,
                        e.nom_emplacement,
                        e.compagnie_id,
                        ST_Distance(e.localisation_emplacement::geography, $2::geography) as distance_arrivee
                    FROM EMPLACEMENTSTRANSPORT e
                    WHERE e.est_actif = true
                      AND ST_DWithin(e.localisation_emplacement::geography, $2::geography, 5000)
                )
                SELECT 
                    d.compagnie_id,
                    d.nom_compagnie,
                    d.id as emplacement_depart_id,
                    d.nom_emplacement as emplacement_depart_nom,
                    d.distance_depart,
                    a.id as emplacement_arrivee_id,
                    a.nom_emplacement as emplacement_arrivee_nom,
                    a.distance_arrivee,
                    (d.distance_depart + a.distance_arrivee) as distance_totale
                FROM emplacements_proches_depart d
                JOIN emplacements_proches_arrivee a ON a.compagnie_id = d.compagnie_id
                ORDER BY distance_totale ASC
                LIMIT 10
            `, [from, to]);

            res.json({
                success: true,
                data: {
                    from: { lat: parseFloat(from_lat), lng: parseFloat(from_lng) },
                    to: { lat: parseFloat(to_lat), lng: parseFloat(to_lng) },
                    itinéraires: itinéraires.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new CatalogueTransportController();