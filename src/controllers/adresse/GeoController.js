// src/controllers/adresse/GeoController.js
const pool = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const GeoService = require('../../services/geo/GeoService');
const CacheService = require('../../services/cache/CacheService');
const { logInfo, logError, logDebug } = require('../../configuration/logger');

class GeoController {
    /**
     * Rechercher des entités à proximité
     * @route GET /api/v1/geo/proximite
     * @access PUBLIC
     */
    async findNearby(req, res, next) {
        try {
            const {
                type,
                lat,
                lng,
                rayon_km = 5,
                limit = 20,
                page = 1,
                filters = {}
            } = req.query;

            if (!lat || !lng) {
                throw new ValidationError('Latitude et longitude requises');
            }

            if (!type) {
                throw new ValidationError('Type d\'entité requis');
            }

            const offset = (page - 1) * limit;
            const point = `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;

            let query;
            let countQuery;
            const params = [parseFloat(rayon_km) * 1000, parseFloat(limit), offset];
            let paramIndex = 4;

            switch (type) {
                case 'boutiques':
                    query = `
                        SELECT 
                            b.id,
                            b.nom_boutique,
                            b.logo_boutique,
                            b.description_boutique,
                            b.est_actif,
                            a.ligne_1,
                            a.ville,
                            ST_Distance(a.coordonnees::geography, ${point}::geography) as distance_meters,
                            ST_AsGeoJSON(a.coordonnees) as coordonnees,
                            (
                                SELECT AVG(note_globale) 
                                FROM AVIS 
                                WHERE entite_type = 'BOUTIQUE' 
                                AND entite_id = b.id 
                                AND statut = 'PUBLIE'
                            ) as note_moyenne
                        FROM BOUTIQUES b
                        JOIN ADRESSES_ENTITES ae ON ae.entite_type = 'BOUTIQUE' AND ae.entite_id = b.id
                        JOIN ADRESSES a ON a.id = ae.adresse_id
                        WHERE b.est_actif = true 
                        AND b.est_supprime = false
                        AND ST_DWithin(a.coordonnees::geography, ${point}::geography, $1)
                        ${this._buildFilters('b', filters, paramIndex)}
                        ORDER BY distance_meters
                        LIMIT $2 OFFSET $3
                    `;

                    countQuery = `
                        SELECT COUNT(DISTINCT b.id)
                        FROM BOUTIQUES b
                        JOIN ADRESSES_ENTITES ae ON ae.entite_type = 'BOUTIQUE' AND ae.entite_id = b.id
                        JOIN ADRESSES a ON a.id = ae.adresse_id
                        WHERE b.est_actif = true 
                        AND b.est_supprime = false
                        AND ST_DWithin(a.coordonnees::geography, ${point}::geography, $1)
                    `;
                    break;

                case 'restaurants':
                    query = `
                        SELECT 
                            r.id,
                            r.nom_restaurant_fast_food as nom,
                            r.logo_restaurant as logo,
                            r.description_restaurant_fast_food as description,
                            r.est_actif,
                            e.nom_emplacement,
                            e.adresse_complete,
                            e.frais_livraison,
                            ST_Distance(e.localisation_restaurant::geography, ${point}::geography) as distance_meters,
                            ST_AsGeoJSON(e.localisation_restaurant) as coordonnees,
                            (
                                SELECT AVG(note_globale) 
                                FROM AVIS 
                                WHERE entite_type = 'RESTAURANT_FAST_FOOD' 
                                AND entite_id = r.id 
                                AND statut = 'PUBLIE'
                            ) as note_moyenne
                        FROM RESTAURANTSFASTFOOD r
                        JOIN EMPLACEMENTSRESTAURANTFASTFOOD e ON e.id_restaurant_fast_food = r.id
                        WHERE r.est_actif = true 
                        AND r.est_supprime = false
                        AND ST_DWithin(e.localisation_restaurant::geography, ${point}::geography, $1)
                        ${this._buildFilters('r', filters, paramIndex)}
                        ORDER BY distance_meters
                        LIMIT $2 OFFSET $3
                    `;

                    countQuery = `
                        SELECT COUNT(DISTINCT r.id)
                        FROM RESTAURANTSFASTFOOD r
                        JOIN EMPLACEMENTSRESTAURANTFASTFOOD e ON e.id_restaurant_fast_food = r.id
                        WHERE r.est_actif = true 
                        AND r.est_supprime = false
                        AND ST_DWithin(e.localisation_restaurant::geography, ${point}::geography, $1)
                    `;
                    break;

                case 'livreurs':
                    query = `
                        SELECT 
                            l.id,
                            l.nom_livreur,
                            l.prenom_livreur,
                            l.photo_livreur,
                            l.note_moyenne,
                            l.est_disponible,
                            ST_Distance(l.localisation_actuelle::geography, ${point}::geography) as distance_meters,
                            ST_AsGeoJSON(l.localisation_actuelle) as coordonnees,
                            el.nom_entreprise_livraison
                        FROM LIVREURS l
                        LEFT JOIN ENTREPRISE_LIVRAISON el ON el.id = l.id_entreprise_livraison
                        WHERE l.est_actif = true 
                        AND l.est_disponible = true
                        AND l.localisation_actuelle IS NOT NULL
                        AND ST_DWithin(l.localisation_actuelle::geography, ${point}::geography, $1)
                        ${this._buildFilters('l', filters, paramIndex)}
                        ORDER BY distance_meters
                        LIMIT $2 OFFSET $3
                    `;

                    countQuery = `
                        SELECT COUNT(*)
                        FROM LIVREURS l
                        WHERE l.est_actif = true 
                        AND l.est_disponible = true
                        AND l.localisation_actuelle IS NOT NULL
                        AND ST_DWithin(l.localisation_actuelle::geography, ${point}::geography, $1)
                    `;
                    break;

                default:
                    throw new ValidationError('Type d\'entité non supporté');
            }

            const result = await pool.query(query, params);
            const countResult = await pool.query(countQuery, [params[0]]);
            const total = parseInt(countResult.rows[0].count);

            // Ajouter les distances en km
            const data = result.rows.map(row => ({
                ...row,
                distance_km: Math.round((row.distance_meters / 1000) * 100) / 100,
                distance_meters: Math.round(row.distance_meters)
            }));

            res.json({
                status: 'success',
                data,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                },
                meta: {
                    centre: { lat: parseFloat(lat), lng: parseFloat(lng) },
                    rayon_km: parseFloat(rayon_km)
                }
            });

        } catch (error) {
            logError('Erreur recherche proximité:', error);
            next(error);
        }
    }

    /**
     * Calculer l'itinéraire entre deux points
     * @route GET /api/v1/geo/itinerary
     * @access PRIVATE
     */
    async getItinerary(req, res, next) {
        try {
            const {
                start_lat, start_lng,
                end_lat, end_lng,
                mode = 'driving'
            } = req.query;

            if (!start_lat || !start_lng || !end_lat || !end_lng) {
                throw new ValidationError('Points de départ et d\'arrivée requis');
            }

            const start = [parseFloat(start_lng), parseFloat(start_lat)];
            const end = [parseFloat(end_lng), parseFloat(end_lat)];

            // Vérification cache
            const cacheKey = `itinerary:${start.join(',')}:${end.join(',')}:${mode}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    status: 'success',
                    data: cached,
                    from_cache: true
                });
            }

            const itinerary = await GeoService.calculerItineraire(start, end, mode);

            // Mise en cache (1 heure)
            await CacheService.set(cacheKey, itinerary, 3600);

            res.json({
                status: 'success',
                data: itinerary
            });

        } catch (error) {
            logError('Erreur calcul itinéraire:', error);
            next(error);
        }
    }

    /**
     * Autocomplétion d'adresses
     * @route GET /api/v1/geo/autocomplete
     * @access PUBLIC
     */
    async autocomplete(req, res, next) {
        try {
            const { q, limit = 10 } = req.query;

            if (!q || q.length < 3) {
                throw new ValidationError('La recherche doit contenir au moins 3 caractères');
            }

            // Recherche dans les adresses existantes
            const result = await pool.query(
                `SELECT 
                    id,
                    libelle,
                    ligne_1,
                    quartier,
                    ville,
                    code_postal,
                    pays,
                    ST_AsGeoJSON(coordonnees) as coordonnees,
                    ts_rank(to_tsvector('french', 
                        coalesce(ligne_1,'') || ' ' || 
                        coalesce(quartier,'') || ' ' || 
                        coalesce(ville,'')
                    ), plainto_tsquery('french', $1)) as rank
                FROM ADRESSES
                WHERE to_tsvector('french', 
                    coalesce(ligne_1,'') || ' ' || 
                    coalesce(quartier,'') || ' ' || 
                    coalesce(ville,'')
                ) @@ plainto_tsquery('french', $1)
                ORDER BY rank DESC, est_verifiee DESC
                LIMIT $2`,
                [q, limit]
            );

            // Si pas assez de résultats, utiliser un service externe
            let suggestions = result.rows;
            if (suggestions.length < 3) {
                try {
                    const externalSuggestions = await GeoService.autocomplete(q);
                    suggestions = [...suggestions, ...externalSuggestions];
                } catch (geoError) {
                    logDebug('Service externe indisponible:', geoError);
                }
            }

            res.json({
                status: 'success',
                data: suggestions.slice(0, limit),
                meta: {
                    query: q,
                    total: suggestions.length
                }
            });

        } catch (error) {
            logError('Erreur autocomplétion:', error);
            next(error);
        }
    }

    /**
     * Géocoder une adresse
     * @route GET /api/v1/geo/geocode
     * @access PUBLIC
     */
    async geocode(req, res, next) {
        try {
            const { adresse } = req.query;

            if (!adresse) {
                throw new ValidationError('Adresse requise');
            }

            // Vérifier si l'adresse existe déjà
            const existing = await pool.query(
                `SELECT 
                    id,
                    ligne_1,
                    ville,
                    ST_X(coordonnees) as lng,
                    ST_Y(coordonnees) as lat
                FROM ADRESSES
                WHERE to_tsvector('french', 
                    coalesce(ligne_1,'') || ' ' || 
                    coalesce(ville,'')
                ) @@ plainto_tsquery('french', $1)
                AND coordonnees IS NOT NULL
                LIMIT 1`,
                [adresse]
            );

            if (existing.rows.length > 0) {
                return res.json({
                    status: 'success',
                    data: existing.rows[0],
                    from_cache: true
                });
            }

            // Appel au service de géocodage
            const coordonnees = await GeoService.geocode(adresse);

            res.json({
                status: 'success',
                data: {
                    adresse,
                    lng: coordonnees[0],
                    lat: coordonnees[1]
                }
            });

        } catch (error) {
            logError('Erreur géocodage:', error);
            next(error);
        }
    }

    /**
     * Géocoder inverse (coordonnées -> adresse)
     * @route GET /api/v1/geo/reverse
     * @access PUBLIC
     */
    async reverseGeocode(req, res, next) {
        try {
            const { lat, lng } = req.query;

            if (!lat || !lng) {
                throw new ValidationError('Latitude et longitude requises');
            }

            const point = `POINT(${lng} ${lat})`;

            // Chercher l'adresse la plus proche
            const result = await pool.query(
                `SELECT 
                    id,
                    ligne_1,
                    quartier,
                    ville,
                    code_postal,
                    pays,
                    ST_Distance(coordonnees::geography, ST_GeomFromText($1, 4326)::geography) as distance
                FROM ADRESSES
                WHERE coordonnees IS NOT NULL
                ORDER BY distance
                LIMIT 1`,
                [point]
            );

            if (result.rows.length > 0 && result.rows[0].distance < 100) { // Moins de 100m
                return res.json({
                    status: 'success',
                    data: result.rows[0],
                    from_cache: true
                });
            }

            // Appel au service externe
            const adresse = await GeoService.reverseGeocode([parseFloat(lng), parseFloat(lat)]);

            res.json({
                status: 'success',
                data: {
                    ...adresse,
                    latitude: parseFloat(lat),
                    longitude: parseFloat(lng)
                }
            });

        } catch (error) {
            logError('Erreur géocodage inverse:', error);
            next(error);
        }
    }

    /**
     * Obtenir la zone de livraison d'une boutique
     * @route GET /api/v1/geo/delivery-zone/:boutiqueId
     * @access PUBLIC
     */
    async getDeliveryZone(req, res, next) {
        try {
            const { boutiqueId } = req.params;

            // Récupérer l'adresse de la boutique
            const boutique = await pool.query(
                `SELECT 
                    a.coordonnees,
                    b.nom_boutique,
                    c.valeur as rayon_livraison
                FROM BOUTIQUES b
                JOIN ADRESSES_ENTITES ae ON ae.entite_type = 'BOUTIQUE' AND ae.entite_id = b.id
                JOIN ADRESSES a ON a.id = ae.adresse_id
                LEFT JOIN CONFIGURATIONS c ON c.entite_type = 'BOUTIQUE' 
                    AND c.entite_id = b.id 
                    AND c.cle = 'delivery_radius'
                WHERE b.id = $1 AND ae.type_adresse = 'PRINCIPALE'`,
                [boutiqueId]
            );

            if (boutique.rows.length === 0) {
                throw new AppError('Boutique non trouvée ou adresse non configurée', 404);
            }

            const rayon = parseFloat(boutique.rows[0].rayon_livraison) || 10; // 10 km par défaut

            // Générer le polygone de la zone de livraison
            const zone = await GeoService.generateDeliveryZone(
                boutique.rows[0].coordonnees,
                rayon
            );

            res.json({
                status: 'success',
                data: {
                    boutique: boutique.rows[0].nom_boutique,
                    centre: boutique.rows[0].coordonnees,
                    rayon_km: rayon,
                    zone,
                    est_dans_zone: req.query.lat && req.query.lng ? 
                        await this._checkPointInZone(
                            [parseFloat(req.query.lng), parseFloat(req.query.lat)],
                            boutique.rows[0].coordonnees,
                            rayon
                        ) : null
                }
            });

        } catch (error) {
            logError('Erreur récupération zone livraison:', error);
            next(error);
        }
    }

    /**
     * Vérifier si une adresse est dans la zone de livraison
     * @route POST /api/v1/geo/check-delivery
     * @access PUBLIC
     */
    async checkDelivery(req, res, next) {
        try {
            const { adresse_id, lat, lng, boutique_id } = req.body;

            let point;

            if (adresse_id) {
                const adresse = await pool.query(
                    'SELECT coordonnees FROM ADRESSES WHERE id = $1',
                    [adresse_id]
                );
                if (adresse.rows.length === 0) {
                    throw new AppError('Adresse non trouvée', 404);
                }
                point = adresse.rows[0].coordonnees;
            } else if (lat && lng) {
                point = `POINT(${lng} ${lat})`;
            } else {
                throw new ValidationError('Adresse ou coordonnées requises');
            }

            // Récupérer la boutique et sa zone
            const boutique = await pool.query(
                `SELECT 
                    a.coordonnees,
                    c.valeur as rayon_livraison
                FROM BOUTIQUES b
                JOIN ADRESSES_ENTITES ae ON ae.entite_type = 'BOUTIQUE' AND ae.entite_id = b.id
                JOIN ADRESSES a ON a.id = ae.adresse_id
                LEFT JOIN CONFIGURATIONS c ON c.entite_type = 'BOUTIQUE' 
                    AND c.entite_id = b.id 
                    AND c.cle = 'delivery_radius'
                WHERE b.id = $1 AND ae.type_adresse = 'PRINCIPALE'`,
                [boutique_id]
            );

            if (boutique.rows.length === 0) {
                throw new AppError('Boutique non trouvée', 404);
            }

            const rayon = parseFloat(boutique.rows[0].rayon_livraison) || 10;

            const distance = await GeoService.calculerDistance(
                boutique.rows[0].coordonnees,
                point
            );

            const estDansZone = distance <= rayon;

            res.json({
                status: 'success',
                data: {
                    est_dans_zone: estDansZone,
                    distance_km: Math.round(distance * 100) / 100,
                    rayon_km: rayon,
                    frais_livraison: estDansZone ? await this._calculerFraisLivraison(boutique_id, distance) : null
                }
            });

        } catch (error) {
            logError('Erreur vérification livraison:', error);
            next(error);
        }
    }

    /**
     * Obtenir les statistiques géographiques
     * @route GET /api/v1/geo/stats
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getGeoStats(req, res, next) {
        try {
            const stats = await pool.query(`
                WITH stats_globales AS (
                    SELECT 
                        COUNT(*) as total_adresses,
                        COUNT(*) FILTER (WHERE coordonnees IS NOT NULL) as adresses_geocodees,
                        COUNT(*) FILTER (WHERE est_verifiee) as adresses_verifiees,
                        COUNT(DISTINCT ville) as villes_couvertes,
                        COUNT(DISTINCT pays) as pays_couverts
                    FROM ADRESSES
                ),
                repartition_par_ville AS (
                    SELECT 
                        ville,
                        COUNT(*) as nombre,
                        COUNT(DISTINCT entite_type) as types_entites
                    FROM ADRESSES a
                    LEFT JOIN ADRESSES_ENTITES ae ON ae.adresse_id = a.id
                    GROUP BY ville
                    ORDER BY nombre DESC
                    LIMIT 10
                ),
                adresses_par_jour AS (
                    SELECT 
                        DATE(date_creation) as date,
                        COUNT(*) as nouvelles_adresses
                    FROM ADRESSES
                    WHERE date_creation >= NOW() - INTERVAL '30 days'
                    GROUP BY DATE(date_creation)
                    ORDER BY date DESC
                )
                SELECT 
                    jsonb_build_object(
                        'global', row_to_json(sg),
                        'top_villes', json_agg(rv),
                        'evolution', json_agg(aj)
                    ) as stats
                FROM stats_globales sg
                CROSS JOIN repartition_par_ville rv
                CROSS JOIN adresses_par_jour aj
                GROUP BY sg.total_adresses, sg.adresses_geocodees, sg.adresses_verifiees,
                         sg.villes_couvertes, sg.pays_couverts
            `);

            res.json({
                status: 'success',
                data: stats.rows[0]?.stats || {}
            });

        } catch (error) {
            logError('Erreur récupération stats géo:', error);
            next(error);
        }
    }

    // ==================== MÉTHODES PRIVÉES ====================

    /**
     * Construire les filtres additionnels
     */
    _buildFilters(alias, filters, startIndex) {
        if (!filters || Object.keys(filters).length === 0) {
            return '';
        }

        const conditions = [];
        let index = startIndex;

        for (const [key, value] of Object.entries(filters)) {
            if (value) {
                conditions.push(`AND ${alias}.${key} = $${index}`);
                index++;
            }
        }

        return conditions.join(' ');
    }

    /**
     * Vérifier si un point est dans la zone
     */
    async _checkPointInZone(point, centre, rayon) {
        const distance = await GeoService.calculerDistance(centre, point);
        return {
            est_dans_zone: distance <= rayon,
            distance_km: Math.round(distance * 100) / 100
        };
    }

    /**
     * Calculer les frais de livraison
     */
    async _calculerFraisLivraison(boutiqueId, distance) {
        const config = await pool.query(
            `SELECT valeur FROM CONFIGURATIONS 
             WHERE entite_type = 'BOUTIQUE' 
             AND entite_id = $1 
             AND cle = 'delivery_fees'`,
            [boutiqueId]
        );

        if (config.rows.length === 0) {
            // Tarif par défaut
            return Math.round(distance * 500); // 500 FCFA/km
        }

        const fees = config.rows[0].valeur;
        // Logique de calcul selon la configuration
        return fees.base + (fees.per_km * distance);
    }
}

module.exports = new GeoController();