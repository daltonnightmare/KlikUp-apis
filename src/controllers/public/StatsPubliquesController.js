// src/controllers/public/StatsPubliquesController.js
const db = require('../../configuration/database');
const CacheService = require('../../services/cache/CacheService');

class StatsPubliquesController {
    /**
     * Obtenir les statistiques générales de la plateforme
     * @route GET /api/v1/public/stats/globales
     */
    async getGlobalStats(req, res, next) {
        try {
            const cacheKey = 'public:stats:globales';
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    success: true,
                    data: cached,
                    fromCache: true
                });
            }

            const stats = {};

            // Compter les restaurants actifs
            const restaurants = await db.query(
                `SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (
                        WHERE EXISTS (
                            SELECT 1 FROM EMPLACEMENTSRESTAURANTFASTFOOD 
                            WHERE id_restaurant_fast_food = r.id AND est_actif = true
                        )
                    ) as avec_emplacements
                 FROM RESTAURANTSFASTFOOD r
                 WHERE r.est_actif = true AND r.est_supprime = false`
            );
            stats.restaurants = restaurants.rows[0];

            // Compter les boutiques actives
            const boutiques = await db.query(
                `SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (
                        WHERE EXISTS (
                            SELECT 1 FROM PRODUITSBOUTIQUE 
                            WHERE id_boutique = b.id AND est_disponible = true
                        )
                    ) as avec_produits
                 FROM BOUTIQUES b
                 WHERE b.est_actif = true AND b.est_supprime = false`
            );
            stats.boutiques = boutiques.rows[0];

            // Compter les compagnies de transport
            const transport = await db.query(
                `SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (
                        WHERE EXISTS (
                            SELECT 1 FROM TICKETSTRANSPORT 
                            WHERE compagnie_id = c.id AND actif = true
                        )
                    ) as avec_tickets
                 FROM COMPAGNIESTRANSPORT c
                 WHERE c.est_actif = true AND c.est_supprime = false`
            );
            stats.transport = transport.rows[0];

            // Compter les utilisateurs
            const utilisateurs = await db.query(
                `SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE date_creation >= NOW() - INTERVAL '30 days') as nouveaux_30j
                 FROM COMPTES
                 WHERE est_supprime = false`
            );
            stats.utilisateurs = utilisateurs.rows[0];

            // Compter les commandes (30 derniers jours)
            const commandes = await db.query(
                `SELECT 
                    (SELECT COUNT(*) FROM COMMANDESEMPLACEMENTFASTFOOD 
                     WHERE date_commande >= NOW() - INTERVAL '30 days') as commandes_restaurants,
                    (SELECT COUNT(*) FROM COMMANDESBOUTIQUES 
                     WHERE date_commande >= NOW() - INTERVAL '30 days') as commandes_boutiques`
            );
            stats.commandes = commandes.rows[0];

            // Compter les avis
            const avis = await db.query(
                `SELECT 
                    COUNT(*) as total,
                    ROUND(AVG(note_globale)::numeric, 2) as note_moyenne
                 FROM AVIS
                 WHERE statut = 'PUBLIE'`
            );
            stats.avis = avis.rows[0];

            // Top villes
            const villes = await db.query(
                `SELECT 
                    a.ville,
                    COUNT(DISTINCT r.id) as restaurants,
                    COUNT(DISTINCT b.id) as boutiques,
                    COUNT(DISTINCT e.id) as emplacements_transport
                 FROM ADRESSES a
                 LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD r ON ST_DWithin(r.localisation_restaurant, a.coordonnees, 5000)
                 LEFT JOIN BOUTIQUES b ON 1=0 -- À adapter quand les boutiques auront des adresses
                 LEFT JOIN EMPLACEMENTSTRANSPORT e ON ST_DWithin(e.localisation_emplacement, a.coordonnees, 5000)
                 WHERE a.ville IS NOT NULL
                 GROUP BY a.ville
                 ORDER BY COUNT(DISTINCT r.id) DESC
                 LIMIT 10`
            );
            stats.top_villes = villes.rows;

            // Mise en cache (1 heure)
            await CacheService.set(cacheKey, stats, 3600);

            res.json({
                success: true,
                data: stats
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Obtenir les tendances actuelles
     * @route GET /api/v1/public/stats/tendances
     */
    async getTrends(req, res, next) {
        try {
            const cacheKey = 'public:stats:tendances';
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    success: true,
                    data: cached,
                    fromCache: true
                });
            }

            // Produits les plus commandés
            const topProduits = await db.query(
                `SELECT 
                    p.id,
                    p.nom_produit,
                    b.nom_boutique,
                    COUNT(*) as commandes
                 FROM PRODUITSBOUTIQUE p
                 JOIN BOUTIQUES b ON b.id = p.id_boutique
                 JOIN COMMANDESBOUTIQUES c ON c.id_boutique = b.id
                 WHERE c.date_commande >= NOW() - INTERVAL '7 days'
                 GROUP BY p.id, p.nom_produit, b.nom_boutique
                 ORDER BY commandes DESC
                 LIMIT 10`
            );

            // Menus les plus commandés
            const topMenus = await db.query(
                `SELECT 
                    m.id,
                    m.nom_menu,
                    r.nom_restaurant_fast_food,
                    COUNT(*) as commandes
                 FROM MENURESTAURANTFASTFOOD m
                 JOIN EMPLACEMENTSRESTAURANTFASTFOOD e ON e.id = m.id_restaurant_fast_food_emplacement
                 JOIN RESTAURANTSFASTFOOD r ON r.id = e.id_restaurant_fast_food
                 JOIN COMMANDESEMPLACEMENTFASTFOOD c ON c.id_restaurant_fast_food_emplacement = e.id
                 WHERE c.date_commande >= NOW() - INTERVAL '7 days'
                 GROUP BY m.id, m.nom_menu, r.nom_restaurant_fast_food
                 ORDER BY commandes DESC
                 LIMIT 10`
            );

            // Catégories populaires
            const categories = await db.query(
                `SELECT 
                    categorie_principale,
                    COUNT(*) as articles,
                    SUM(nombre_vues) as vues
                 FROM ARTICLES_BLOG_PLATEFORME
                 WHERE date_publication >= NOW() - INTERVAL '30 days'
                   AND statut = 'PUBLIE'
                 GROUP BY categorie_principale
                 ORDER BY vues DESC
                 LIMIT 10`
            );

            const trends = {
                produits_populaires: topProduits.rows,
                menus_populaires: topMenus.rows,
                categories_tendances: categories.rows,
                periode: '7 derniers jours'
            };

            await CacheService.set(cacheKey, trends, 1800); // 30 minutes

            res.json({
                success: true,
                data: trends
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Obtenir le classement des entités
     * @route GET /api/v1/public/stats/classement
     */
    async getRankings(req, res, next) {
        try {
            const { type = 'restaurants', periode = '30d', limit = 20 } = req.query;

            const cacheKey = `public:rankings:${type}:${periode}:${limit}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    success: true,
                    data: cached,
                    fromCache: true
                });
            }

            let interval;
            switch (periode) {
                case '7d': interval = "INTERVAL '7 days'"; break;
                case '30d': interval = "INTERVAL '30 days'"; break;
                case '90d': interval = "INTERVAL '90 days'"; break;
                default: interval = "INTERVAL '30 days'";
            }

            let rankings = [];

            switch (type) {
                case 'restaurants':
                    rankings = await db.query(
                        `SELECT 
                            r.id,
                            r.nom_restaurant_fast_food as nom,
                            r.logo_restaurant as logo,
                            COUNT(DISTINCT c.id) as commandes,
                            COUNT(DISTINCT a.id) as avis,
                            COALESCE(AVG(a.note_globale), 0) as note_moyenne
                         FROM RESTAURANTSFASTFOOD r
                         LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD e ON e.id_restaurant_fast_food = r.id
                         LEFT JOIN COMMANDESEMPLACEMENTFASTFOOD c ON c.id_restaurant_fast_food_emplacement = e.id
                             AND c.date_commande >= NOW() - ${interval}
                         LEFT JOIN AVIS a ON a.entite_type = 'RESTAURANT_FAST_FOOD' 
                             AND a.entite_id::integer = r.id
                             AND a.date_creation >= NOW() - ${interval}
                         WHERE r.est_actif = true
                         GROUP BY r.id
                         ORDER BY commandes DESC, note_moyenne DESC
                         LIMIT $1`,
                        [parseInt(limit)]
                    );
                    break;

                case 'boutiques':
                    rankings = await db.query(
                        `SELECT 
                            b.id,
                            b.nom_boutique as nom,
                            b.logo_boutique as logo,
                            COUNT(DISTINCT c.id) as commandes,
                            COUNT(DISTINCT a.id) as avis,
                            COALESCE(AVG(a.note_globale), 0) as note_moyenne
                         FROM BOUTIQUES b
                         LEFT JOIN COMMANDESBOUTIQUES c ON c.id_boutique = b.id
                             AND c.date_commande >= NOW() - ${interval}
                         LEFT JOIN AVIS a ON a.entite_type = 'BOUTIQUE' 
                             AND a.entite_id::integer = b.id
                             AND a.date_creation >= NOW() - ${interval}
                         WHERE b.est_actif = true
                         GROUP BY b.id
                         ORDER BY commandes DESC, note_moyenne DESC
                         LIMIT $1`,
                        [parseInt(limit)]
                    );
                    break;

                case 'produits':
                    rankings = await db.query(
                        `SELECT 
                            p.id,
                            p.nom_produit as nom,
                            p.image_produit as image,
                            b.nom_boutique,
                            COUNT(*) as ventes,
                            SUM(c.prix_total_commande) as chiffre_affaires
                         FROM PRODUITSBOUTIQUE p
                         JOIN BOUTIQUES b ON b.id = p.id_boutique
                         JOIN COMMANDESBOUTIQUES c ON c.id_boutique = b.id
                         WHERE c.date_commande >= NOW() - ${interval}
                         GROUP BY p.id, p.nom_produit, p.image_produit, b.nom_boutique
                         ORDER BY ventes DESC
                         LIMIT $1`,
                        [parseInt(limit)]
                    );
                    break;

                case 'auteurs':
                    rankings = await db.query(
                        `SELECT 
                            c.id,
                            c.nom_utilisateur_compte as nom,
                            c.photo_profil_compte as photo,
                            COUNT(a.id) as articles,
                            SUM(a.nombre_vues) as vues,
                            SUM(a.nombre_likes) as likes
                         FROM COMPTES c
                         JOIN ARTICLES_BLOG_PLATEFORME a ON a.auteur_id = c.id
                         WHERE a.statut = 'PUBLIE'
                           AND a.date_publication >= NOW() - ${interval}
                         GROUP BY c.id
                         ORDER BY vues DESC
                         LIMIT $1`,
                        [parseInt(limit)]
                    );
                    break;
            }

            await CacheService.set(cacheKey, rankings.rows, 3600); // 1 heure

            res.json({
                success: true,
                data: rankings.rows,
                type,
                periode
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Obtenir l'évolution temporelle
     * @route GET /api/v1/public/stats/evolution
     */
    async getEvolution(req, res, next) {
        try {
            const { type = 'commandes', periode = '30d' } = req.query;

            let interval;
            let groupFormat;
            
            switch (periode) {
                case '7d':
                    interval = "INTERVAL '7 days'";
                    groupFormat = "DATE";
                    break;
                case '30d':
                    interval = "INTERVAL '30 days'";
                    groupFormat = "DATE";
                    break;
                case '90d':
                    interval = "INTERVAL '90 days'";
                    groupFormat = "DATE_TRUNC('week', ";
                    break;
                case '1y':
                    interval = "INTERVAL '1 year'";
                    groupFormat = "DATE_TRUNC('month', ";
                    break;
                default:
                    interval = "INTERVAL '30 days'";
                    groupFormat = "DATE";
            }

            let evolution;

            switch (type) {
                case 'commandes':
                    evolution = await db.query(
                        `SELECT 
                            ${groupFormat} date_commande as periode,
                            COUNT(*) FILTER (WHERE commande_type = 'restaurant') as restaurants,
                            COUNT(*) FILTER (WHERE commande_type = 'boutique') as boutiques,
                            COUNT(*) as total
                         FROM (
                             SELECT date_commande, 'restaurant' as commande_type
                             FROM COMMANDESEMPLACEMENTFASTFOOD
                             WHERE date_commande >= NOW() - ${interval}
                             UNION ALL
                             SELECT date_commande, 'boutique'
                             FROM COMMANDESBOUTIQUES
                             WHERE date_commande >= NOW() - ${interval}
                         ) c
                         GROUP BY periode
                         ORDER BY periode ASC`
                    );
                    break;

                case 'utilisateurs':
                    evolution = await db.query(
                        `SELECT 
                            ${groupFormat} date_creation as periode,
                            COUNT(*) as inscriptions
                         FROM COMPTES
                         WHERE date_creation >= NOW() - ${interval}
                         GROUP BY periode
                         ORDER BY periode ASC`
                    );
                    break;

                case 'avis':
                    evolution = await db.query(
                        `SELECT 
                            ${groupFormat} date_creation as periode,
                            COUNT(*) as avis,
                            ROUND(AVG(note_globale)::numeric, 2) as note_moyenne
                         FROM AVIS
                         WHERE date_creation >= NOW() - ${interval}
                           AND statut = 'PUBLIE'
                         GROUP BY periode
                         ORDER BY periode ASC`
                    );
                    break;

                default:
                    throw new ValidationError('Type d\'évolution invalide');
            }

            res.json({
                success: true,
                data: evolution.rows,
                type,
                periode
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new StatsPubliquesController();