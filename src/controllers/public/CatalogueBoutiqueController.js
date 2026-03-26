// src/controllers/public/CatalogueBoutiquesController.js
const db = require('../../configuration/database');
const { ValidationError } = require('../../utils/errors/AppError');
const CacheService = require('../../services/cache/CacheService');

class CatalogueBoutiquesController {
    /**
     * Liste toutes les boutiques
     * @route GET /api/v1/public/boutiques
     */
    async listBoutiques(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                categorie,
                note_min,
                tri = 'note'
            } = req.query;

            const offset = (page - 1) * limit;
            const cacheKey = `boutiques:list:${page}:${limit}:${JSON.stringify(req.query)}`;
            
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
                    b.id,
                    b.nom_boutique as nom,
                    b.logo_boutique as logo,
                    b.description_boutique as description,
                    b.types_produits_vendu,
                    COUNT(DISTINCT p.id) as nombre_produits,
                    COALESCE(v_stats.note_moyenne, 0) as note_moyenne,
                    COALESCE(v_stats.nombre_avis, 0) as nombre_avis
                FROM BOUTIQUES b
                LEFT JOIN PRODUITSBOUTIQUE p ON p.id_boutique = b.id AND p.est_disponible = true
                LEFT JOIN VUE_NOTES_MOYENNES v_stats ON v_stats.entite_type = 'BOUTIQUE' AND v_stats.entite_id = b.id
                WHERE b.est_actif = true AND b.est_supprime = false
            `;

            const params = [];
            let paramIndex = 1;

            if (categorie) {
                query += ` AND b.types_produits_vendu ? $${paramIndex}`;
                params.push(categorie);
                paramIndex++;
            }

            if (note_min) {
                query += ` AND COALESCE(v_stats.note_moyenne, 0) >= $${paramIndex}`;
                params.push(parseFloat(note_min));
                paramIndex++;
            }

            query += ` GROUP BY b.id, v_stats.note_moyenne, v_stats.nombre_avis`;

            switch (tri) {
                case 'note':
                    query += ` ORDER BY note_moyenne DESC, nombre_avis DESC`;
                    break;
                case 'popularite':
                    query += ` ORDER BY nombre_avis DESC, note_moyenne DESC`;
                    break;
                case 'produits':
                    query += ` ORDER BY nombre_produits DESC`;
                    break;
                default:
                    query += ` ORDER BY note_moyenne DESC`;
            }

            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);

            const countQuery = `
                SELECT COUNT(*) as total
                FROM BOUTIQUES
                WHERE est_actif = true AND est_supprime = false
            `;
            const countResult = await db.query(countQuery);

            const response = {
                boutiques: result.rows,
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
     * Détails d'une boutique
     * @route GET /api/v1/public/boutiques/:id
     */
    async getBoutiqueDetails(req, res, next) {
        try {
            const { id } = req.params;

            const cacheKey = `boutique:details:${id}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    success: true,
                    data: cached,
                    fromCache: true
                });
            }

            const boutique = await db.query(`
                SELECT 
                    b.id,
                    b.nom_boutique as nom,
                    b.logo_boutique as logo,
                    b.favicon_boutique,
                    b.description_boutique as description,
                    b.types_produits_vendu,
                    b.date_creation,
                    COALESCE(v_stats.note_moyenne, 0) as note_moyenne,
                    COALESCE(v_stats.nombre_avis, 0) as nombre_avis,
                    (
                        SELECT COUNT(*) FROM PRODUITSBOUTIQUE 
                        WHERE id_boutique = b.id AND est_disponible = true
                    ) as produits_disponibles
                FROM BOUTIQUES b
                LEFT JOIN VUE_NOTES_MOYENNES v_stats ON v_stats.entite_type = 'BOUTIQUE' AND v_stats.entite_id = b.id
                WHERE b.id = $1 AND b.est_actif = true AND b.est_supprime = false
            `, [id]);

            if (boutique.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Boutique non trouvée'
                });
            }

            // Catégories de la boutique
            const categories = await db.query(`
                SELECT 
                    id,
                    nom_categorie,
                    description_categorie,
                    slug_categorie,
                    ordre_affichage,
                    (
                        SELECT COUNT(*) FROM PRODUITSBOUTIQUE 
                        WHERE id_categorie = c.id AND est_disponible = true
                    ) as nombre_produits
                FROM CATEGORIES_BOUTIQUE c
                WHERE boutique_id = $1 AND est_actif = true
                ORDER BY ordre_affichage, nom_categorie
            `, [id]);

            // Produits populaires
            const produitsPopulaires = await db.query(`
                SELECT 
                    p.id,
                    p.nom_produit,
                    p.image_produit,
                    p.prix_unitaire_produit as prix,
                    p.prix_promo,
                    c.nom_categorie
                FROM PRODUITSBOUTIQUE p
                JOIN CATEGORIES_BOUTIQUE c ON c.id = p.id_categorie
                WHERE p.id_boutique = $1 AND p.est_disponible = true
                ORDER BY p.date_creation DESC
                LIMIT 8
            `, [id]);

            const response = {
                ...boutique.rows[0],
                categories: categories.rows,
                produits_populaires: produitsPopulaires.rows
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
     * Liste des produits d'une boutique
     * @route GET /api/v1/public/boutiques/:id/produits
     */
    async getProduitsByBoutique(req, res, next) {
        try {
            const { id } = req.params;
            const {
                page = 1,
                limit = 20,
                categorie_id,
                prix_min,
                prix_max,
                tri = 'nom_asc'
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    p.id,
                    p.nom_produit,
                    p.slug_produit,
                    p.image_produit,
                    p.images_produit,
                    p.description_produit,
                    p.prix_unitaire_produit as prix,
                    p.prix_promo,
                    p.quantite as stock,
                    c.id as categorie_id,
                    c.nom_categorie,
                    c.slug_categorie
                FROM PRODUITSBOUTIQUE p
                JOIN CATEGORIES_BOUTIQUE c ON c.id = p.id_categorie
                WHERE p.id_boutique = $1 AND p.est_disponible = true
            `;

            const params = [id];
            let paramIndex = 2;

            if (categorie_id) {
                query += ` AND p.id_categorie = $${paramIndex}`;
                params.push(parseInt(categorie_id));
                paramIndex++;
            }

            if (prix_min) {
                query += ` AND p.prix_unitaire_produit >= $${paramIndex}`;
                params.push(parseFloat(prix_min));
                paramIndex++;
            }

            if (prix_max) {
                query += ` AND p.prix_unitaire_produit <= $${paramIndex}`;
                params.push(parseFloat(prix_max));
                paramIndex++;
            }

            switch (tri) {
                case 'prix_asc':
                    query += ` ORDER BY p.prix_unitaire_produit ASC`;
                    break;
                case 'prix_desc':
                    query += ` ORDER BY p.prix_unitaire_produit DESC`;
                    break;
                case 'nom_desc':
                    query += ` ORDER BY p.nom_produit DESC`;
                    break;
                default:
                    query += ` ORDER BY p.nom_produit ASC`;
            }

            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);

            // Compter le total
            const countQuery = `
                SELECT COUNT(*) as total
                FROM PRODUITSBOUTIQUE
                WHERE id_boutique = $1 AND est_disponible = true
            `;
            const countResult = await db.query(countQuery, [id]);

            res.json({
                success: true,
                data: {
                    produits: result.rows,
                    total: parseInt(countResult.rows[0].total),
                    page: parseInt(page),
                    limit: parseInt(limit),
                    pages: Math.ceil(countResult.rows[0].total / limit)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Détails d'un produit
     * @route GET /api/v1/public/produits/:id
     */
    async getProduitDetails(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(`
                SELECT 
                    p.id,
                    p.nom_produit,
                    p.slug_produit,
                    p.image_produit,
                    p.images_produit,
                    p.description_produit,
                    p.donnees_supplementaires,
                    p.prix_unitaire_produit as prix,
                    p.prix_promo,
                    p.quantite as stock,
                    c.id as categorie_id,
                    c.nom_categorie,
                    b.id as boutique_id,
                    b.nom_boutique as boutique_nom,
                    b.logo_boutique as boutique_logo
                FROM PRODUITSBOUTIQUE p
                JOIN CATEGORIES_BOUTIQUE c ON c.id = p.id_categorie
                JOIN BOUTIQUES b ON b.id = p.id_boutique
                WHERE p.id = $1 AND p.est_disponible = true
            `, [id]);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Produit non trouvé'
                });
            }

            // Produits similaires (même catégorie)
            const similaires = await db.query(`
                SELECT 
                    p.id,
                    p.nom_produit,
                    p.image_produit,
                    p.prix_unitaire_produit as prix,
                    p.prix_promo
                FROM PRODUITSBOUTIQUE p
                WHERE p.id_categorie = $1 
                  AND p.id != $2 
                  AND p.est_disponible = true
                ORDER BY RANDOM()
                LIMIT 4
            `, [result.rows[0].categorie_id, id]);

            res.json({
                success: true,
                data: {
                    ...result.rows[0],
                    produits_similaires: similaires.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new CatalogueBoutiquesController();