// src/controllers/blog/StatsBlogController.js
const db = require('../../configuration/database');

class StatsBlogController {
    /**
     * Récupérer les statistiques globales du blog
     * @route GET /api/v1/blog/stats/globales
     */
    async getGlobalStats(req, res, next) {
        try {
            const { periode = '30d' } = req.query;

            let interval;
            switch (periode) {
                case '24h': interval = "INTERVAL '24 hours'"; break;
                case '7d': interval = "INTERVAL '7 days'"; break;
                case '30d': interval = "INTERVAL '30 days'"; break;
                case '1y': interval = "INTERVAL '1 year'"; break;
                default: interval = "INTERVAL '30 days'";
            }

            // Statistiques générales
            const generales = await db.query(`
                SELECT 
                    COUNT(*) as total_articles,
                    COUNT(*) FILTER (WHERE statut = 'PUBLIE') as articles_publies,
                    COUNT(*) FILTER (WHERE statut = 'BROUILLON') as articles_brouillons,
                    COUNT(*) FILTER (WHERE date_creation >= NOW() - ${interval}) as nouveaux_articles,
                    SUM(nombre_vues) as total_vues,
                    SUM(nombre_likes) as total_likes,
                    SUM(nombre_commentaires) as total_commentaires,
                    SUM(nombre_partages) as total_partages
                FROM ARTICLES_BLOG_PLATEFORME
            `);

            // Top catégories
            const categories = await db.query(`
                SELECT 
                    categorie_principale,
                    COUNT(*) as nombre_articles,
                    SUM(nombre_vues) as total_vues
                FROM ARTICLES_BLOG_PLATEFORME
                WHERE statut = 'PUBLIE'
                GROUP BY categorie_principale
                ORDER BY total_vues DESC
                LIMIT 10
            `);

            // Top auteurs
            const auteurs = await db.query(`
                SELECT 
                    a.auteur_id,
                    c.nom_utilisateur_compte,
                    c.photo_profil_compte,
                    COUNT(*) as nombre_articles,
                    SUM(a.nombre_vues) as total_vues,
                    SUM(a.nombre_likes) as total_likes,
                    AVG(
                        (SELECT AVG(note_globale) FROM AVIS 
                         WHERE entite_type = 'ARTICLE_BLOG' AND entite_id = a.id)
                    ) as note_moyenne
                FROM ARTICLES_BLOG_PLATEFORME a
                JOIN COMPTES c ON c.id = a.auteur_id
                WHERE a.statut = 'PUBLIE'
                GROUP BY a.auteur_id, c.nom_utilisateur_compte, c.photo_profil_compte
                ORDER BY total_vues DESC
                LIMIT 10
            `);

            // Évolution sur la période
            const evolution = await db.query(`
                SELECT 
                    DATE(date_creation) as date,
                    COUNT(*) as articles_crees,
                    COUNT(*) FILTER (WHERE statut = 'PUBLIE') as articles_publies
                FROM ARTICLES_BLOG_PLATEFORME
                WHERE date_creation >= NOW() - ${interval}
                GROUP BY DATE(date_creation)
                ORDER BY date ASC
            `);

            // Engagement moyen
            const engagement = await db.query(`
                SELECT 
                    ROUND(AVG(nombre_vues)::numeric, 2) as vues_moyennes,
                    ROUND(AVG(nombre_likes)::numeric, 2) as likes_moyens,
                    ROUND(AVG(nombre_commentaires)::numeric, 2) as commentaires_moyens,
                    ROUND(AVG(nombre_partages)::numeric, 2) as partages_moyens
                FROM ARTICLES_BLOG_PLATEFORME
                WHERE statut = 'PUBLIE'
                    AND date_publication >= NOW() - ${interval}
            `);

            res.json({
                success: true,
                data: {
                    generales: generales.rows[0],
                    categories: categories.rows,
                    auteurs: auteurs.rows,
                    evolution: evolution.rows,
                    engagement: engagement.rows[0]
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les statistiques par catégorie
     * @route GET /api/v1/blog/stats/categories
     */
    async getCategoryStats(req, res, next) {
        try {
            const { periode = '30d' } = req.query;

            const result = await db.query(`
                SELECT 
                    categorie_principale,
                    COUNT(*) as total_articles,
                    SUM(CASE WHEN date_creation >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END) as nouveaux_30j,
                    SUM(nombre_vues) as total_vues,
                    SUM(nombre_likes) as total_likes,
                    SUM(nombre_commentaires) as total_commentaires,
                    ROUND(AVG(nombre_vues)::numeric, 2) as vues_moyennes
                FROM ARTICLES_BLOG_PLATEFORME
                WHERE statut = 'PUBLIE'
                GROUP BY categorie_principale
                ORDER BY total_vues DESC
            `);

            res.json({
                success: true,
                data: result.rows
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les statistiques de lecture (temps, progression)
     * @route GET /api/v1/blog/stats/lecture
     */
    async getReadingStats(req, res, next) {
        try {
            const { periode = '30d', article_id } = req.query;

            let whereClause = '';
            const params = [];

            if (article_id) {
                whereClause = 'WHERE article_id = $1';
                params.push(article_id);
            }

            const result = await db.query(`
                SELECT 
                    ROUND(AVG(temps_lecture_secondes)::numeric, 2) as temps_moyen_secondes,
                    ROUND(AVG(pourcentage_lu)::numeric, 2) as pourcentage_moyen,
                    COUNT(*) as total_lectures,
                    COUNT(DISTINCT compte_id) as lecteurs_uniques,
                    COUNT(DISTINCT session_id) as sessions_uniques
                FROM STATS_LECTURE_ARTICLES
                ${whereClause}
                WHERE date_lecture >= NOW() - INTERVAL '30 days'
            `, params);

            // Distribution des pourcentages lus
            const distribution = await db.query(`
                SELECT 
                    CASE 
                        WHEN pourcentage_lu < 25 THEN '0-25%'
                        WHEN pourcentage_lu < 50 THEN '25-50%'
                        WHEN pourcentage_lu < 75 THEN '50-75%'
                        ELSE '75-100%'
                    END as intervalle,
                    COUNT(*) as nombre
                FROM STATS_LECTURE_ARTICLES
                ${whereClause}
                WHERE pourcentage_lu IS NOT NULL
                GROUP BY intervalle
                ORDER BY intervalle
            `, params);

            res.json({
                success: true,
                data: {
                    global: result.rows[0],
                    distribution: distribution.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new StatsBlogController();