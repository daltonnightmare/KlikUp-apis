// src/controllers/public/CatalogueRestaurantsController.js
const db = require('../../configuration/database');
const { ValidationError } = require('../../utils/errors/AppError');
const CacheService = require('../../services/cache/CacheService');
const GeoService = require('../../services/geo/GeoService');

class CatalogueRestaurantsController {
    /**
     * Liste tous les restaurants avec filtres
     * @route GET /api/v1/public/restaurants
     */
    async listRestaurants(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                ville,
                note_min,
                categorie,
                ouvert_maintenant,
                lat,
                lng,
                rayon_km = 10,
                tri = 'note'
            } = req.query;

            const offset = (page - 1) * limit;
            const cacheKey = `restaurants:list:${page}:${limit}:${JSON.stringify(req.query)}`;
            
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
                    r.id,
                    r.nom_restaurant_fast_food as nom,
                    r.logo_restaurant as logo,
                    r.description_restaurant_fast_food as description,
                    COUNT(DISTINCT e.id) as nombre_emplacements,
                    COALESCE(v_stats.note_moyenne, 0) as note_moyenne,
                    COALESCE(v_stats.nombre_avis, 0) as nombre_avis,
                    COALESCE(
                        (
                            SELECT json_agg(json_build_object(
                                'id', e2.id,
                                'nom', e2.nom_emplacement,
                                'adresse', e2.adresse_complete,
                                'frais_livraison', e2.frais_livraison,
                                'est_ouvert', fn_est_ouvert('EMPLACEMENT_RESTAURANT', e2.id)
                            ))
                            FROM EMPLACEMENTSRESTAURANTFASTFOOD e2
                            WHERE e2.id_restaurant_fast_food = r.id AND e2.est_actif = true
                            LIMIT 3
                        ), '[]'::json
                    ) as emplacements_principaux
                FROM RESTAURANTSFASTFOOD r
                LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD e ON e.id_restaurant_fast_food = r.id AND e.est_actif = true
                LEFT JOIN VUE_NOTES_MOYENNES v_stats ON v_stats.entite_type = 'RESTAURANT_FAST_FOOD' AND v_stats.entite_id = r.id
                WHERE r.est_actif = true AND r.est_supprime = false
            `;

            const params = [];
            let paramIndex = 1;

            // Filtre par ville via les adresses des emplacements
            if (ville) {
                query += ` AND EXISTS (
                    SELECT 1 FROM EMPLACEMENTSRESTAURANTFASTFOOD e2
                    JOIN ADRESSES_ENTITES ae ON ae.entite_type = 'EMPLACEMENT_RESTAURANT' AND ae.entite_id = e2.id
                    JOIN ADRESSES a ON a.id = ae.adresse_id
                    WHERE e2.id_restaurant_fast_food = r.id AND a.ville ILIKE $${paramIndex}
                )`;
                params.push(`%${ville}%`);
                paramIndex++;
            }

            // Filtre par note minimum
            if (note_min) {
                query += ` AND COALESCE(v_stats.note_moyenne, 0) >= $${paramIndex}`;
                params.push(parseFloat(note_min));
                paramIndex++;
            }

            // Filtre par catégorie de menu
            if (categorie) {
                query += ` AND EXISTS (
                    SELECT 1 FROM MENURESTAURANTFASTFOOD m
                    JOIN EMPLACEMENTSRESTAURANTFASTFOOD e2 ON e2.id = m.id_restaurant_fast_food_emplacement
                    WHERE e2.id_restaurant_fast_food = r.id AND m.categorie_menu = $${paramIndex} AND m.disponible = true
                )`;
                params.push(categorie);
                paramIndex++;
            }

            // Filtre géographique
            if (lat && lng) {
                const point = await GeoService.createPoint(parseFloat(lng), parseFloat(lat));
                query += ` AND EXISTS (
                    SELECT 1 FROM EMPLACEMENTSRESTAURANTFASTFOOD e2
                    WHERE e2.id_restaurant_fast_food = r.id
                      AND ST_DWithin(e2.localisation_restaurant::geography, $${paramIndex}::geography, $${paramIndex + 1})
                )`;
                params.push(point, parseFloat(rayon_km) * 1000);
                paramIndex += 2;
            }

            // Filtre "ouvert maintenant"
            if (ouvert_maintenant === 'true') {
                query += ` AND EXISTS (
                    SELECT 1 FROM EMPLACEMENTSRESTAURANTFASTFOOD e2
                    WHERE e2.id_restaurant_fast_food = r.id
                      AND fn_est_ouvert('EMPLACEMENT_RESTAURANT', e2.id) = true
                )`;
            }

            query += ` GROUP BY r.id, v_stats.note_moyenne, v_stats.nombre_avis`;

            // Tri
            switch (tri) {
                case 'note':
                    query += ` ORDER BY note_moyenne DESC, nombre_avis DESC`;
                    break;
                case 'popularite':
                    query += ` ORDER BY nombre_avis DESC, note_moyenne DESC`;
                    break;
                case 'nom_asc':
                    query += ` ORDER BY r.nom_restaurant_fast_food ASC`;
                    break;
                case 'nom_desc':
                    query += ` ORDER BY r.nom_restaurant_fast_food DESC`;
                    break;
                default:
                    query += ` ORDER BY note_moyenne DESC`;
            }

            // Pagination
            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);

            // Compter le total pour la pagination
            const countQuery = `
                SELECT COUNT(DISTINCT r.id) as total
                FROM RESTAURANTSFASTFOOD r
                WHERE r.est_actif = true AND r.est_supprime = false
            `;
            const countResult = await db.query(countQuery);

            const response = {
                restaurants: result.rows,
                total: parseInt(countResult.rows[0].total),
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(countResult.rows[0].total / limit)
            };

            await CacheService.set(cacheKey, response, 300); // 5 minutes

            res.json({
                success: true,
                data: response
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Détails d'un restaurant avec ses emplacements
     * @route GET /api/v1/public/restaurants/:id
     */
    async getRestaurantDetails(req, res, next) {
        try {
            const { id } = req.params;

            const cacheKey = `restaurant:details:${id}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    success: true,
                    data: cached,
                    fromCache: true
                });
            }

            // Infos générales du restaurant
            const restaurant = await db.query(`
                SELECT 
                    r.id,
                    r.nom_restaurant_fast_food as nom,
                    r.logo_restaurant as logo,
                    r.description_restaurant_fast_food as description,
                    r.date_creation,
                    COALESCE(v_stats.note_moyenne, 0) as note_moyenne,
                    COALESCE(v_stats.nombre_avis, 0) as nombre_avis,
                    COALESCE(v_stats.avis_5_etoiles, 0) as avis_5_etoiles,
                    COALESCE(v_stats.avis_4_etoiles, 0) as avis_4_etoiles,
                    COALESCE(v_stats.avis_3_etoiles, 0) as avis_3_etoiles,
                    COALESCE(v_stats.avis_negatifs, 0) as avis_negatifs
                FROM RESTAURANTSFASTFOOD r
                LEFT JOIN VUE_NOTES_MOYENNES v_stats ON v_stats.entite_type = 'RESTAURANT_FAST_FOOD' AND v_stats.entite_id = r.id
                WHERE r.id = $1 AND r.est_actif = true AND r.est_supprime = false
            `, [id]);

            if (restaurant.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Restaurant non trouvé'
                });
            }

            // Liste des emplacements avec leurs menus
            const emplacements = await db.query(`
                SELECT 
                    e.id,
                    e.nom_emplacement,
                    e.adresse_complete,
                    e.frais_livraison,
                    e.heure_ouverture,
                    e.heure_fermeture,
                    e.jours_ouverture_emplacement_restaurant,
                    ST_AsGeoJSON(e.localisation_restaurant) as geojson,
                    fn_est_ouvert('EMPLACEMENT_RESTAURANT', e.id) as est_ouvert,
                    (
                        SELECT COUNT(*) FROM MENURESTAURANTFASTFOOD 
                        WHERE id_restaurant_fast_food_emplacement = e.id AND disponible = true
                    ) as nombre_menus,
                    COALESCE(e_stats.note_moyenne, 0) as note_moyenne,
                    COALESCE(e_stats.nombre_avis, 0) as nombre_avis
                FROM EMPLACEMENTSRESTAURANTFASTFOOD e
                LEFT JOIN VUE_NOTES_MOYENNES e_stats ON e_stats.entite_type = 'EMPLACEMENT_RESTAURANT' AND e_stats.entite_id = e.id
                WHERE e.id_restaurant_fast_food = $1 AND e.est_actif = true
                ORDER BY e.nom_emplacement
            `, [id]);

            // Avis récents
            const avisRecents = await db.query(`
                SELECT 
                    a.id,
                    a.note_globale,
                    a.titre,
                    a.contenu,
                    a.date_creation,
                    c.nom_utilisateur_compte as auteur,
                    c.photo_profil_compte as auteur_photo
                FROM AVIS a
                JOIN COMPTES c ON c.id = a.auteur_id
                WHERE a.entite_type = 'RESTAURANT_FAST_FOOD' 
                  AND a.entite_id = $1 
                  AND a.statut = 'PUBLIE'
                ORDER BY a.date_creation DESC
                LIMIT 10
            `, [id]);

            const response = {
                ...restaurant.rows[0],
                emplacements: emplacements.rows.map(e => ({
                    ...e,
                    geojson: e.geojson ? JSON.parse(e.geojson) : null
                })),
                avis_recents: avisRecents.rows
            };

            await CacheService.set(cacheKey, response, 300); // 5 minutes

            res.json({
                success: true,
                data: response
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Liste des menus d'un emplacement
     * @route GET /api/v1/public/emplacements/:id/menus
     */
    async getMenusByEmplacement(req, res, next) {
        try {
            const { id } = req.params;
            const { categorie, disponible = true } = req.query;

            let query = `
                SELECT 
                    m.id,
                    m.nom_menu,
                    m.description_menu,
                    m.photo_menu,
                    m.prix_menu,
                    m.temps_preparation_min,
                    m.categorie_menu,
                    m.composition_menu,
                    COALESCE(
                        (
                            SELECT json_agg(json_build_object(
                                'id', p.id,
                                'nom', p.nom_produit,
                                'prix', p.prix_produit
                            ))
                            FROM PRODUITSINDIVIDUELRESTAURANT p
                            WHERE p.id = ANY(
                                SELECT jsonb_array_elements_text(m.composition_menu)::int
                                WHERE jsonb_typeof(m.composition_menu) = 'array'
                            )
                        ), '[]'::json
                    ) as produits_composition
                FROM MENURESTAURANTFASTFOOD m
                WHERE m.id_restaurant_fast_food_emplacement = $1
            `;

            const params = [id];
            let paramIndex = 2;

            if (categorie) {
                query += ` AND m.categorie_menu = $${paramIndex}`;
                params.push(categorie);
                paramIndex++;
            }

            if (disponible === 'true') {
                query += ` AND m.disponible = true`;
            }

            query += ` ORDER BY m.categorie_menu, m.nom_menu`;

            const result = await db.query(query, params);

            // Grouper par catégorie
            const menusParCategorie = result.rows.reduce((acc, menu) => {
                if (!acc[menu.categorie_menu]) {
                    acc[menu.categorie_menu] = [];
                }
                acc[menu.categorie_menu].push(menu);
                return acc;
            }, {});

            res.json({
                success: true,
                data: {
                    emplacement_id: parseInt(id),
                    menus: result.rows,
                    menus_par_categorie: menusParCategorie
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Détails d'un menu
     * @route GET /api/v1/public/menus/:id
     */
    async getMenuDetails(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(`
                SELECT 
                    m.id,
                    m.nom_menu,
                    m.description_menu,
                    m.photo_menu,
                    m.photos_menu,
                    m.prix_menu,
                    m.temps_preparation_min,
                    m.categorie_menu,
                    m.composition_menu,
                    m.disponible,
                    e.nom_emplacement,
                    e.adresse_complete,
                    r.nom_restaurant_fast_food as restaurant_nom,
                    r.id as restaurant_id
                FROM MENURESTAURANTFASTFOOD m
                JOIN EMPLACEMENTSRESTAURANTFASTFOOD e ON e.id = m.id_restaurant_fast_food_emplacement
                JOIN RESTAURANTSFASTFOOD r ON r.id = e.id_restaurant_fast_food
                WHERE m.id = $1 AND m.disponible = true
            `, [id]);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Menu non trouvé'
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
}

module.exports = new CatalogueRestaurantsController();