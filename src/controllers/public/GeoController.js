// src/controllers/public/GeoController.js
const db = require('../../configuration/database');
const { ValidationError } = require('../../utils/errors/AppError');
const GeoService = require('../../services/geo/GeoService');
const CacheService = require('../../services/cache/CacheService');

class GeoController {
    /**
     * Recherche géographique des entités à proximité
     * @route GET /api/v1/public/geo/proximite
     */
    async findNearby(req, res, next) {
        try {
            const {
                lat,
                lng,
                type = 'tout', // 'restaurants', 'boutiques', 'transport', 'tout'
                rayon_km = 5,
                limit = 50,
                categories
            } = req.query;

            if (!lat || !lng) {
                throw new ValidationError('Latitude et longitude requises');
            }

            const point = await GeoService.createPoint(parseFloat(lng), parseFloat(lat));
            const rayon_m = parseFloat(rayon_km) * 1000;

            const cacheKey = `geo:nearby:${lat}:${lng}:${type}:${rayon_km}:${categories}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    success: true,
                    data: cached,
                    fromCache: true
                });
            }

            const results = {};

            // Restaurants à proximité
            if (type === 'tout' || type === 'restaurants') {
                const restaurants = await db.query(
                    `SELECT 
                        e.id,
                        e.nom_emplacement,
                        r.nom_restaurant_fast_food as restaurant_nom,
                        r.logo_restaurant as logo,
                        e.adresse_complete,
                        ST_Distance(e.localisation_restaurant::geography, $1::geography) as distance,
                        ST_AsGeoJSON(e.localisation_restaurant) as geojson,
                        e.frais_livraison,
                        e.heure_ouverture,
                        e.heure_fermeture,
                        COALESCE(AVG(a.note_globale), 0) as note_moyenne
                     FROM EMPLACEMENTSRESTAURANTFASTFOOD e
                     JOIN RESTAURANTSFASTFOOD r ON r.id = e.id_restaurant_fast_food
                     LEFT JOIN AVIS a ON a.entite_type = 'EMPLACEMENT_RESTAURANT' 
                         AND a.entite_id::integer = e.id
                     WHERE e.est_actif = true
                       AND ST_DWithin(e.localisation_restaurant::geography, $1::geography, $2)
                     GROUP BY e.id, r.nom_restaurant_fast_food, r.logo_restaurant
                     ORDER BY distance ASC
                     LIMIT $3`,
                    [point, rayon_m, parseInt(limit)]
                );

                results.restaurants = await Promise.all(restaurants.rows.map(async (r) => ({
                    ...r,
                    distance_km: Math.round(r.distance / 10) / 100,
                    geojson: JSON.parse(r.geojson),
                    est_ouvert: await this.checkEstOuvert(r.id, 'EMPLACEMENT_RESTAURANT')
                })));
            }

            // Boutiques à proximité (si disponibles)
            if (type === 'tout' || type === 'boutiques') {
                // Note: Les boutiques n'ont pas de localisation directe dans le schéma actuel
                // À implémenter si des adresses sont disponibles
            }

            // Transport à proximité
            if (type === 'tout' || type === 'transport') {
                const transport = await db.query(
                    `SELECT 
                        e.id,
                        e.nom_emplacement,
                        c.nom_compagnie,
                        c.logo_compagnie as logo,
                        ST_Distance(e.localisation_emplacement::geography, $1::geography) as distance,
                        ST_AsGeoJSON(e.localisation_emplacement) as geojson,
                        e.jours_ouverture_emplacement_transport,
                        COUNT(t.id) as nombre_tickets
                     FROM EMPLACEMENTSTRANSPORT e
                     JOIN COMPAGNIESTRANSPORT c ON c.id = e.compagnie_id
                     LEFT JOIN TICKETSTRANSPORT t ON t.emplacement_id = e.id
                     WHERE e.est_actif = true
                       AND ST_DWithin(e.localisation_emplacement::geography, $1::geography, $2)
                     GROUP BY e.id, c.nom_compagnie, c.logo_compagnie
                     ORDER BY distance ASC
                     LIMIT $3`,
                    [point, rayon_m, parseInt(limit)]
                );

                results.transport = transport.rows.map(t => ({
                    ...t,
                    distance_km: Math.round(t.distance / 10) / 100,
                    geojson: JSON.parse(t.geojson)
                }));
            }

            await CacheService.set(cacheKey, results, 300); // 5 minutes

            res.json({
                success: true,
                data: results,
                centre: { lat: parseFloat(lat), lng: parseFloat(lng), rayon_km: parseFloat(rayon_km) }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Obtenir les détails d'une localisation
     * @route GET /api/v1/public/geo/details/:type/:id
     */
    async getLocationDetails(req, res, next) {
        try {
            const { type, id } = req.params;

            let result;
            switch (type) {
                case 'restaurant':
                    result = await db.query(
                        `SELECT 
                            e.id,
                            e.nom_emplacement,
                            e.adresse_complete,
                            ST_AsGeoJSON(e.localisation_restaurant) as geojson,
                            e.frais_livraison,
                            e.heure_ouverture,
                            e.heure_fermeture,
                            e.jours_ouverture_emplacement_restaurant,
                            r.nom_restaurant_fast_food,
                            r.logo_restaurant,
                            r.description_restaurant_fast_food
                         FROM EMPLACEMENTSRESTAURANTFASTFOOD e
                         JOIN RESTAURANTSFASTFOOD r ON r.id = e.id_restaurant_fast_food
                         WHERE e.id = $1`,
                        [id]
                    );
                    break;

                case 'transport':
                    result = await db.query(
                        `SELECT 
                            e.id,
                            e.nom_emplacement,
                            ST_AsGeoJSON(e.localisation_emplacement) as geojson,
                            ST_AsGeoJSON(e.localisation_arret_bus) as arret_geojson,
                            e.jours_ouverture_emplacement_transport,
                            c.nom_compagnie,
                            c.logo_compagnie,
                            c.description_compagnie
                         FROM EMPLACEMENTSTRANSPORT e
                         JOIN COMPAGNIESTRANSPORT c ON c.id = e.compagnie_id
                         WHERE e.id = $1`,
                        [id]
                    );
                    break;

                default:
                    throw new ValidationError('Type de localisation invalide');
            }

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Localisation non trouvée'
                });
            }

            const location = result.rows[0];
            location.geojson = JSON.parse(location.geojson);
            if (location.arret_geojson) {
                location.arret_geojson = JSON.parse(location.arret_geojson);
            }

            res.json({
                success: true,
                data: location
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Calculer l'itinéraire entre deux points
     * @route GET /api/v1/public/geo/itineraire
     */
    async getItinerary(req, res, next) {
        try {
            const {
                from_lat, from_lng,
                to_lat, to_lng,
                mode = 'driving' // 'driving', 'walking', 'bicycling'
            } = req.query;

            if (!from_lat || !from_lng || !to_lat || !to_lng) {
                throw new ValidationError('Points de départ et arrivée requis');
            }

            const from = await GeoService.createPoint(parseFloat(from_lng), parseFloat(from_lat));
            const to = await GeoService.createPoint(parseFloat(to_lng), parseFloat(to_lat));

            // Calculer la distance à vol d'oiseau
            const distance = await GeoService.calculerDistance(from, to);

            // Estimer le temps selon le mode
            let vitesseKmh = 30; // Voiture par défaut
            if (mode === 'walking') vitesseKmh = 5;
            if (mode === 'bicycling') vitesseKmh = 15;

            const tempsMinutes = Math.ceil((distance / vitesseKmh) * 60);

            // Obtenir les informations de trafic si disponible
            const traffic = await this.getTrafficInfo(from, to);

            res.json({
                success: true,
                data: {
                    distance_km: Math.round(distance * 100) / 100,
                    temps_estime_minutes: tempsMinutes,
                    mode,
                    traffic: traffic,
                    from: { lat: parseFloat(from_lat), lng: parseFloat(from_lng) },
                    to: { lat: parseFloat(to_lat), lng: parseFloat(to_lng) }
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Obtenir les informations de trafic
     * @route GET /api/v1/public/geo/trafic
     */
    async getTraffic(req, res, next) {
        try {
            const { lat, lng, rayon_km = 2 } = req.query;

            if (!lat || !lng) {
                throw new ValidationError('Position requise');
            }

            // Implémentation selon API de trafic disponible
            // Exemple avec données simulées
            const traffic = {
                niveau: Math.random() > 0.7 ? 'élevé' : Math.random() > 0.4 ? 'modéré' : 'faible',
                incidents: Math.floor(Math.random() * 3),
                vitesse_moyenne: 25 + Math.floor(Math.random() * 20),
                timestamp: new Date().toISOString()
            };

            res.json({
                success: true,
                data: traffic
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Autocomplétion d'adresses
     * @route GET /api/v1/public/geo/adresses
     */
    async autocompleteAddress(req, res, next) {
        try {
            const { q, limit = 10 } = req.query;

            if (!q || q.length < 3) {
                return res.json({
                    success: true,
                    data: []
                });
            }

            const result = await db.query(
                `SELECT 
                    id,
                    libelle,
                    ligne_1,
                    ligne_2,
                    quartier,
                    ville,
                    commune,
                    pays,
                    ST_AsGeoJSON(coordonnees) as geojson
                 FROM ADRESSES
                 WHERE ligne_1 ILIKE $1 
                    OR ligne_2 ILIKE $1
                    OR quartier ILIKE $1
                    OR ville ILIKE $1
                 ORDER BY 
                    CASE 
                        WHEN ville ILIKE $1 THEN 1
                        WHEN quartier ILIKE $1 THEN 2
                        ELSE 3
                    END
                 LIMIT $2`,
                [`%${q}%`, parseInt(limit)]
            );

            const addresses = result.rows.map(a => ({
                ...a,
                geojson: a.geojson ? JSON.parse(a.geojson) : null,
                label: [a.ligne_1, a.ligne_2, a.quartier, a.ville].filter(Boolean).join(', ')
            }));

            res.json({
                success: true,
                data: addresses
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Obtenir les villes populaires
     * @route GET /api/v1/public/geo/villes-populaires
     */
    async getPopularCities(req, res, next) {
        try {
            const result = await db.query(
                `SELECT 
                    ville,
                    pays,
                    COUNT(*) as nombre_adresses,
                    COUNT(DISTINCT a.id) FILTER (
                        WHERE EXISTS (
                            SELECT 1 FROM EMPLACEMENTSRESTAURANTFASTFOOD e 
                            WHERE ST_DWithin(e.localisation_restaurant, a.coordonnees, 10000)
                        )
                    ) as nombre_restaurants
                 FROM ADRESSES a
                 WHERE ville IS NOT NULL
                 GROUP BY ville, pays
                 ORDER BY nombre_adresses DESC
                 LIMIT 20`
            );

            res.json({
                success: true,
                data: result.rows
            });

        } catch (error) {
            next(error);
        }
    }

    // ==================== Méthodes privées ====================

    async checkEstOuvert(entiteId, entiteType) {
        try {
            const now = new Date();
            const jour = now.getDay(); // 0 = Dimanche, 1 = Lundi, ...
            const heure = now.toTimeString().slice(0, 5);

            const horaires = await db.query(
                `SELECT * FROM HORAIRES 
                 WHERE entite_type = $1 AND entite_id = $2 AND jour_semaine = $3`,
                [entiteType, entiteId, jour]
            );

            if (horaires.rows.length === 0) return false;

            const h = horaires.rows[0];
            if (!h.est_ouvert) return false;

            return heure >= h.heure_ouverture && heure <= h.heure_fermeture;
        } catch (error) {
            return false;
        }
    }

    async getTrafficInfo(from, to) {
        // Simuler des données de trafic
        // À remplacer par une vraie API de trafic
        return {
            niveau: ['faible', 'modéré', 'élevé'][Math.floor(Math.random() * 3)],
            incidents: Math.random() > 0.8 ? 1 : 0,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = new GeoController();