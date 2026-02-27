// src/controllers/public/CatalogueController.js
const db = require('../../configuration/database');
const { ValidationError } = require('../../utils/errors/AppError');
const GeoService = require('../../services/geo/GeoService');
const CacheService = require('../../services/cache/CacheService');

class CatalogueController {
    /**
     * Recherche unifiée dans tout le catalogue
     * @route GET /api/v1/public/recherche
     */
    async search(req, res, next) {
        try {
            const {
                q,
                type, // 'tout', 'restaurants', 'boutiques', 'produits', 'menus', 'transport'
                categorie,
                localisation_lat,
                localisation_lng,
                rayon_km = 10,
                note_min,
                prix_min,
                prix_max,
                disponible = true,
                tri = 'pertinence',
                page = 1,
                limit = 20
            } = req.query;

            const offset = (page - 1) * limit;
            const results = {
                restaurants: { count: 0, items: [] },
                boutiques: { count: 0, items: [] },
                produits: { count: 0, items: [] },
                menus: { count: 0, items: [] },
                transport: { count: 0, items: [] }
            };

            // Cache key based on query
            const cacheKey = `catalogue:search:${q}:${type}:${page}:${limit}:${JSON.stringify(req.query)}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    success: true,
                    data: cached,
                    fromCache: true
                });
            }

            // Construire le point de localisation pour les recherches géographiques
            let locationPoint = null;
            if (localisation_lat && localisation_lng) {
                locationPoint = await GeoService.createPoint(
                    parseFloat(localisation_lng),
                    parseFloat(localisation_lat)
                );
            }

            const searchTerm = q ? `%${q}%` : '%%';

            // Recherche dans les restaurants
            if (type === 'tout' || type === 'restaurants') {
                const restaurants = await this.searchRestaurants(
                    searchTerm, categorie, locationPoint, rayon_km, note_min, tri, limit, offset
                );
                results.restaurants = restaurants;
            }

            // Recherche dans les boutiques
            if (type === 'tout' || type === 'boutiques') {
                const boutiques = await this.searchBoutiques(
                    searchTerm, locationPoint, rayon_km, note_min, tri, limit, offset
                );
                results.boutiques = boutiques;
            }

            // Recherche dans les produits
            if (type === 'tout' || type === 'produits') {
                const produits = await this.searchProduits(
                    searchTerm, categorie, prix_min, prix_max, disponible, tri, limit, offset
                );
                results.produits = produits;
            }

            // Recherche dans les menus
            if (type === 'tout' || type === 'menus') {
                const menus = await this.searchMenus(
                    searchTerm, categorie, prix_min, prix_max, disponible, tri, limit, offset
                );
                results.menus = menus;
            }

            // Recherche dans le transport
            if (type === 'tout' || type === 'transport') {
                const transport = await this.searchTransport(
                    searchTerm, locationPoint, rayon_km, tri, limit, offset
                );
                results.transport = transport;
            }

            // Calculer le total général
            const totalGeneral = Object.values(results).reduce((acc, curr) => acc + curr.count, 0);

            const response = {
                results,
                total: totalGeneral,
                facets: await this.getSearchFacets(searchTerm, type)
            };

            // Mise en cache (5 minutes)
            await CacheService.set(cacheKey, response, 300);

            res.json({
                success: true,
                data: response,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalGeneral,
                    pages: Math.ceil(totalGeneral / limit)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Obtenir les suggestions de recherche
     * @route GET /api/v1/public/suggestions
     */
    async suggestions(req, res, next) {
        try {
            const { q, limit = 10 } = req.query;

            if (!q || q.length < 2) {
                return res.json({
                    success: true,
                    data: []
                });
            }

            const searchTerm = `%${q}%`;

            // Suggestions combinées de différentes sources
            const suggestions = await db.query(
                `(SELECT 'restaurant' as type, nom_restaurant_fast_food as label, id
                  FROM RESTAURANTSFASTFOOD 
                  WHERE nom_restaurant_fast_food ILIKE $1 AND est_actif = true
                  LIMIT 5)
                 UNION
                 (SELECT 'boutique' as type, nom_boutique as label, id
                  FROM BOUTIQUES 
                  WHERE nom_boutique ILIKE $1 AND est_actif = true
                  LIMIT 5)
                 UNION
                 (SELECT 'produit' as type, nom_produit as label, id
                  FROM PRODUITSBOUTIQUE 
                  WHERE nom_produit ILIKE $1 AND est_disponible = true
                  LIMIT 5)
                 UNION
                 (SELECT 'menu' as type, nom_menu as label, id
                  FROM MENURESTAURANTFASTFOOD 
                  WHERE nom_menu ILIKE $1 AND disponible = true
                  LIMIT 5)
                 UNION
                 (SELECT 'compagnie' as type, nom_compagnie as label, id
                  FROM COMPAGNIESTRANSPORT 
                  WHERE nom_compagnie ILIKE $1 AND est_actif = true
                  LIMIT 5)
                 ORDER BY type
                 LIMIT $2`,
                [searchTerm, parseInt(limit)]
            );

            res.json({
                success: true,
                data: suggestions.rows
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Obtenir les filtres disponibles
     * @route GET /api/v1/public/filtres
     */
    async getFilters(req, res, next) {
        try {
            const filters = {
                categories_restaurant: await db.query(
                    `SELECT unnest(enum_range(NULL::categories_menu))::text as categorie`
                ),
                categories_produits: await db.query(
                    `SELECT unnest(enum_range(NULL::categories_produits))::text as categorie`
                ),
                villes: await db.query(
                    `SELECT DISTINCT ville, COUNT(*) as count
                     FROM ADRESSES 
                     WHERE ville IS NOT NULL
                     GROUP BY ville
                     ORDER BY count DESC
                     LIMIT 20`
                ),
                notes: [1, 2, 3, 4, 5],
                fourchettes_prix: [
                    { min: 0, max: 1000, label: 'Moins de 1000 FCFA' },
                    { min: 1000, max: 5000, label: '1000 - 5000 FCFA' },
                    { min: 5000, max: 10000, label: '5000 - 10000 FCFA' },
                    { min: 10000, max: null, label: 'Plus de 10000 FCFA' }
                ]
            };

            res.json({
                success: true,
                data: filters
            });

        } catch (error) {
            next(error);
        }
    }

    // ==================== Méthodes privées de recherche ====================

    async searchRestaurants(searchTerm, categorie, locationPoint, rayonKm, noteMin, tri, limit, offset) {
        let query = `
            SELECT 
                r.id,
                r.nom_restaurant_fast_food as nom,
                r.logo_restaurant as logo,
                r.description_restaurant_fast_food as description,
                COUNT(DISTINCT e.id) as nombre_emplacements,
                COALESCE(AVG(v.note_globale), 0) as note_moyenne,
                COUNT(v.id) as nombre_avis
            FROM RESTAURANTSFASTFOOD r
            LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD e ON e.id_restaurant_fast_food = r.id
            LEFT JOIN AVIS v ON v.entite_type = 'RESTAURANT_FAST_FOOD' AND v.entite_id::integer = r.id
            WHERE r.est_actif = true
              AND r.est_supprime = false
        `;

        const params = [];
        let paramIndex = 1;

        if (searchTerm !== '%%') {
            query += ` AND (r.nom_restaurant_fast_food ILIKE $${paramIndex} OR r.description_restaurant_fast_food ILIKE $${paramIndex})`;
            params.push(searchTerm);
            paramIndex++;
        }

        if (categorie) {
            query += ` AND EXISTS (
                SELECT 1 FROM MENURESTAURANTFASTFOOD m 
                WHERE m.id_restaurant_fast_food_emplacement IN (
                    SELECT id FROM EMPLACEMENTSRESTAURANTFASTFOOD WHERE id_restaurant_fast_food = r.id
                ) AND m.categorie_menu = $${paramIndex}
            )`;
            params.push(categorie);
            paramIndex++;
        }

        if (locationPoint) {
            query += ` AND EXISTS (
                SELECT 1 FROM EMPLACEMENTSRESTAURANTFASTFOOD e
                WHERE e.id_restaurant_fast_food = r.id
                  AND ST_DWithin(e.localisation_restaurant::geography, $${paramIndex}::geography, $${paramIndex + 1})
            )`;
            params.push(locationPoint, rayonKm * 1000);
            paramIndex += 2;
        }

        if (noteMin) {
            query += ` HAVING COALESCE(AVG(v.note_globale), 0) >= $${paramIndex}`;
            params.push(parseFloat(noteMin));
            paramIndex++;
        }

        query += ` GROUP BY r.id`;

        // Tri
        if (tri === 'note') {
            query += ` ORDER BY note_moyenne DESC`;
        } else if (tri === 'popularite') {
            query += ` ORDER BY nombre_avis DESC`;
        } else {
            query += ` ORDER BY r.nom_restaurant_fast_food ASC`;
        }

        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await db.query(query, params);
        const count = await this.getCountQuery(query, params.slice(0, -2));

        return {
            count: parseInt(count.rows[0]?.count || 0),
            items: result.rows
        };
    }

    async searchBoutiques(searchTerm, locationPoint, rayonKm, noteMin, tri, limit, offset) {
        let query = `
            SELECT 
                b.id,
                b.nom_boutique as nom,
                b.logo_boutique as logo,
                b.description_boutique as description,
                COUNT(DISTINCT p.id) as nombre_produits,
                COALESCE(AVG(v.note_globale), 0) as note_moyenne,
                COUNT(v.id) as nombre_avis
            FROM BOUTIQUES b
            LEFT JOIN PRODUITSBOUTIQUE p ON p.id_boutique = b.id
            LEFT JOIN AVIS v ON v.entite_type = 'BOUTIQUE' AND v.entite_id::integer = b.id
            WHERE b.est_actif = true
              AND b.est_supprime = false
        `;

        const params = [];
        let paramIndex = 1;

        if (searchTerm !== '%%') {
            query += ` AND (b.nom_boutique ILIKE $${paramIndex} OR b.description_boutique ILIKE $${paramIndex})`;
            params.push(searchTerm);
            paramIndex++;
        }

        if (locationPoint) {
            // TODO: Ajouter la géolocalisation des boutiques si disponible
        }

        if (noteMin) {
            query += ` HAVING COALESCE(AVG(v.note_globale), 0) >= $${paramIndex}`;
            params.push(parseFloat(noteMin));
            paramIndex++;
        }

        query += ` GROUP BY b.id`;

        if (tri === 'note') {
            query += ` ORDER BY note_moyenne DESC`;
        } else if (tri === 'popularite') {
            query += ` ORDER BY nombre_avis DESC`;
        } else {
            query += ` ORDER BY b.nom_boutique ASC`;
        }

        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await db.query(query, params);
        const count = await this.getCountQuery(query, params.slice(0, -2));

        return {
            count: parseInt(count.rows[0]?.count || 0),
            items: result.rows
        };
    }

    async searchProduits(searchTerm, categorie, prixMin, prixMax, disponible, tri, limit, offset) {
        let query = `
            SELECT 
                p.id,
                p.nom_produit as nom,
                p.image_produit as image,
                p.prix_unitaire_produit as prix,
                p.prix_promo,
                p.description_produit as description,
                b.nom_boutique as boutique_nom,
                b.id as boutique_id,
                c.nom_categorie as categorie
            FROM PRODUITSBOUTIQUE p
            JOIN BOUTIQUES b ON b.id = p.id_boutique
            JOIN CATEGORIES_BOUTIQUE c ON c.id = p.id_categorie
            WHERE b.est_actif = true
        `;

        const params = [];
        let paramIndex = 1;

        if (searchTerm !== '%%') {
            query += ` AND (p.nom_produit ILIKE $${paramIndex} OR p.description_produit ILIKE $${paramIndex})`;
            params.push(searchTerm);
            paramIndex++;
        }

        if (categorie) {
            query += ` AND c.nom_categorie = $${paramIndex}`;
            params.push(categorie);
            paramIndex++;
        }

        if (prixMin) {
            query += ` AND p.prix_unitaire_produit >= $${paramIndex}`;
            params.push(parseFloat(prixMin));
            paramIndex++;
        }

        if (prixMax) {
            query += ` AND p.prix_unitaire_produit <= $${paramIndex}`;
            params.push(parseFloat(prixMax));
            paramIndex++;
        }

        if (disponible) {
            query += ` AND p.est_disponible = true`;
        }

        // Tri
        if (tri === 'prix_asc') {
            query += ` ORDER BY p.prix_unitaire_produit ASC`;
        } else if (tri === 'prix_desc') {
            query += ` ORDER BY p.prix_unitaire_produit DESC`;
        } else {
            query += ` ORDER BY p.nom_produit ASC`;
        }

        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await db.query(query, params);
        const count = await this.getCountQuery(query, params.slice(0, -2));

        return {
            count: parseInt(count.rows[0]?.count || 0),
            items: result.rows
        };
    }

    async searchMenus(searchTerm, categorie, prixMin, prixMax, disponible, tri, limit, offset) {
        let query = `
            SELECT 
                m.id,
                m.nom_menu as nom,
                m.photo_menu as image,
                m.prix_menu as prix,
                m.description_menu as description,
                r.nom_restaurant_fast_food as restaurant_nom,
                e.nom_emplacement as emplacement_nom,
                m.categorie_menu as categorie
            FROM MENURESTAURANTFASTFOOD m
            JOIN EMPLACEMENTSRESTAURANTFASTFOOD e ON e.id = m.id_restaurant_fast_food_emplacement
            JOIN RESTAURANTSFASTFOOD r ON r.id = e.id_restaurant_fast_food
            WHERE m.disponible = true
        `;

        const params = [];
        let paramIndex = 1;

        if (searchTerm !== '%%') {
            query += ` AND (m.nom_menu ILIKE $${paramIndex} OR m.description_menu ILIKE $${paramIndex})`;
            params.push(searchTerm);
            paramIndex++;
        }

        if (categorie) {
            query += ` AND m.categorie_menu = $${paramIndex}`;
            params.push(categorie);
            paramIndex++;
        }

        if (prixMin) {
            query += ` AND m.prix_menu >= $${paramIndex}`;
            params.push(parseFloat(prixMin));
            paramIndex++;
        }

        if (prixMax) {
            query += ` AND m.prix_menu <= $${paramIndex}`;
            params.push(parseFloat(prixMax));
            paramIndex++;
        }

        // Tri
        if (tri === 'prix_asc') {
            query += ` ORDER BY m.prix_menu ASC`;
        } else if (tri === 'prix_desc') {
            query += ` ORDER BY m.prix_menu DESC`;
        } else {
            query += ` ORDER BY m.nom_menu ASC`;
        }

        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await db.query(query, params);
        const count = await this.getCountQuery(query, params.slice(0, -2));

        return {
            count: parseInt(count.rows[0]?.count || 0),
            items: result.rows
        };
    }

    async searchTransport(searchTerm, locationPoint, rayonKm, tri, limit, offset) {
        let query = `
            SELECT 
                c.id,
                c.nom_compagnie as nom,
                c.logo_compagnie as logo,
                c.description_compagnie as description,
                COUNT(DISTINCT t.id) as nombre_tickets,
                COUNT(DISTINCT e.id) as nombre_emplacements
            FROM COMPAGNIESTRANSPORT c
            LEFT JOIN TICKETSTRANSPORT t ON t.compagnie_id = c.id
            LEFT JOIN EMPLACEMENTSTRANSPORT e ON e.compagnie_id = c.id
            WHERE c.est_actif = true
              AND c.est_supprime = false
        `;

        const params = [];
        let paramIndex = 1;

        if (searchTerm !== '%%') {
            query += ` AND (c.nom_compagnie ILIKE $${paramIndex} OR c.description_compagnie ILIKE $${paramIndex})`;
            params.push(searchTerm);
            paramIndex++;
        }

        if (locationPoint) {
            query += ` AND EXISTS (
                SELECT 1 FROM EMPLACEMENTSTRANSPORT e
                WHERE e.compagnie_id = c.id
                  AND ST_DWithin(e.localisation_emplacement::geography, $${paramIndex}::geography, $${paramIndex + 1})
            )`;
            params.push(locationPoint, rayonKm * 1000);
            paramIndex += 2;
        }

        query += ` GROUP BY c.id`;

        if (tri === 'popularite') {
            query += ` ORDER BY nombre_tickets DESC`;
        } else {
            query += ` ORDER BY c.nom_compagnie ASC`;
        }

        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await db.query(query, params);
        const count = await this.getCountQuery(query, params.slice(0, -2));

        return {
            count: parseInt(count.rows[0]?.count || 0),
            items: result.rows
        };
    }

    async getSearchFacets(searchTerm, type) {
        const facets = {};

        // Facettes pour les catégories de restaurants
        if (type === 'tout' || type === 'restaurants') {
            const categoriesResto = await db.query(
                `SELECT m.categorie_menu, COUNT(DISTINCT m.id) as count
                 FROM MENURESTAURANTFASTFOOD m
                 WHERE m.disponible = true
                 GROUP BY m.categorie_menu
                 ORDER BY count DESC
                 LIMIT 10`
            );
            facets.categories_restaurant = categoriesResto.rows;
        }

        // Facettes pour les catégories de produits
        if (type === 'tout' || type === 'produits') {
            const categoriesProduits = await db.query(
                `SELECT c.nom_categorie, COUNT(p.id) as count
                 FROM PRODUITSBOUTIQUE p
                 JOIN CATEGORIES_BOUTIQUE c ON c.id = p.id_categorie
                 WHERE p.est_disponible = true
                 GROUP BY c.nom_categorie
                 ORDER BY count DESC
                 LIMIT 10`
            );
            facets.categories_produits = categoriesProduits.rows;
        }

        // Fourchettes de prix
        if (type === 'tout' || type === 'produits' || type === 'menus') {
            facets.prix_ranges = [
                { label: 'Moins de 1000 FCFA', min: 0, max: 1000 },
                { label: '1000 - 5000 FCFA', min: 1000, max: 5000 },
                { label: '5000 - 10000 FCFA', min: 5000, max: 10000 },
                { label: 'Plus de 10000 FCFA', min: 10000, max: null }
            ];
        }

        return facets;
    }

    async getCountQuery(query, params) {
        // Transformer la requête SELECT en COUNT
        const countQuery = query
            .replace(/SELECT.*?FROM/, 'SELECT COUNT(DISTINCT id) as count FROM')
            .split('ORDER BY')[0];
        
        return await db.query(countQuery, params);
    }
}

module.exports = new CatalogueController();