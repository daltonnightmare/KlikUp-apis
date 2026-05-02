// src/controllers/blog/StatsBlogController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');
const CacheService = require('../../services/cache/CacheService');

class StatsBlogController {

    // ========================================================================
    // STATISTIQUES GLOBALES
    // ========================================================================

    /**
     * Récupérer les statistiques globales du blog
     * @route GET /api/v1/blog/stats/globales
     */
    async getGlobalStats(req, res, next) {
        try {
            const { periode = '30d', comparer = false } = req.query;

            const interval = this.getInterval(periode);
            const previousInterval = this.getPreviousInterval(periode);

            const cacheKey = `blog:stats:global:${periode}:${comparer}`;
            const cached = await CacheService.get(cacheKey);
            if (cached && req.query.skip_cache !== 'true') {
                return res.json({ success: true, data: cached, fromCache: true });
            }

            // ✅ Statistiques générales
            const generales = await db.query(`
                SELECT 
                    COUNT(*) as total_articles,
                    COUNT(*) FILTER (WHERE statut = 'PUBLIE') as articles_publies,
                    COUNT(*) FILTER (WHERE statut = 'BROUILLON') as brouillons,
                    COUNT(*) FILTER (WHERE statut = 'PROGRAMME') as programmes,
                    COUNT(*) FILTER (WHERE statut = 'SIGNALE') as signales,
                    COUNT(*) FILTER (WHERE date_creation >= NOW() - ${interval}) as nouveaux_articles,
                    COALESCE(SUM(nombre_vues), 0) as total_vues,
                    COALESCE(SUM(nombre_likes), 0) as total_likes,
                    COALESCE(SUM(nombre_dislikes), 0) as total_dislikes,
                    COALESCE(SUM(nombre_commentaires), 0) as total_commentaires,
                    COALESCE(SUM(nombre_partages), 0) as total_partages,
                    COALESCE(SUM(COALESCE(nombre_favoris, 0)), 0) as total_favoris,
                    COUNT(DISTINCT auteur_id) as auteurs_actifs
                FROM ARTICLES_BLOG_PLATEFORME
            `);

            // ✅ Statistiques de la période précédente (pour comparaison)
            let comparaison = null;
            if (comparer === 'true') {
                comparaison = await db.query(`
                    SELECT 
                        COUNT(*) as articles_precedents,
                        COALESCE(SUM(nombre_vues), 0) as vues_precedentes,
                        COALESCE(SUM(nombre_likes), 0) as likes_precedents,
                        COALESCE(SUM(nombre_commentaires), 0) as commentaires_precedents
                    FROM ARTICLES_BLOG_PLATEFORME
                    WHERE date_creation >= NOW() - ${previousInterval}
                      AND date_creation < NOW() - ${interval}
                `);
            }

            // ✅ Top catégories
            const categories = await db.query(`
                SELECT 
                    categorie_principale,
                    COUNT(*) as nombre_articles,
                    COALESCE(SUM(nombre_vues), 0) as total_vues,
                    COALESCE(SUM(nombre_likes), 0) as total_likes,
                    COALESCE(SUM(nombre_commentaires), 0) as total_commentaires,
                    ROUND(AVG(nombre_vues)::numeric, 1) as vues_moyennes,
                    ROUND(
                        CASE WHEN COALESCE(SUM(nombre_vues), 0) > 0 
                        THEN (COALESCE(SUM(nombre_likes), 0) + COALESCE(SUM(nombre_commentaires), 0)) * 100.0 / COALESCE(SUM(nombre_vues), 1)
                        ELSE 0 END, 2
                    ) as taux_engagement
                FROM ARTICLES_BLOG_PLATEFORME
                WHERE statut = 'PUBLIE'
                GROUP BY categorie_principale
                ORDER BY total_vues DESC
                LIMIT 15
            `);

            // ✅ Top auteurs
            const auteurs = await db.query(`
                SELECT 
                    a.auteur_id,
                    c.nom_utilisateur_compte,
                    c.photo_profil_compte,
                    COUNT(*) as nombre_articles,
                    COALESCE(SUM(a.nombre_vues), 0) as total_vues,
                    COALESCE(SUM(a.nombre_likes), 0) as total_likes,
                    COALESCE(SUM(a.nombre_commentaires), 0) as total_commentaires,
                    COALESCE(SUM(a.nombre_partages), 0) as total_partages,
                    COALESCE(SUM(COALESCE(a.nombre_favoris, 0)), 0) as total_favoris,
                    COUNT(DISTINCT ab.compte_id) as nombre_abonnes,
                    ROUND(AVG(
                        COALESCE((SELECT AVG(note_globale)::numeric FROM AVIS WHERE entite_type = 'ARTICLE_BLOG' AND entite_id = a.id), 0)
                    ), 1) as note_moyenne
                FROM ARTICLES_BLOG_PLATEFORME a
                JOIN COMPTES c ON c.id = a.auteur_id
                LEFT JOIN ABONNEMENTS_BLOG ab ON ab.type_abonnement = 'AUTEUR' AND ab.reference_id = a.auteur_id AND ab.actif = TRUE
                WHERE a.statut = 'PUBLIE'
                GROUP BY a.auteur_id, c.nom_utilisateur_compte, c.photo_profil_compte
                ORDER BY total_vues DESC
                LIMIT 10
            `);

            // ✅ Top articles
            const topArticles = await db.query(`
                SELECT 
                    a.id, a.titre_article, a.slug, a.image_principale,
                    a.nombre_vues, a.nombre_likes, a.nombre_commentaires, 
                    a.nombre_partages, COALESCE(a.nombre_favoris, 0) as nombre_favoris,
                    c.nom_utilisateur_compte as auteur_nom,
                    (a.nombre_vues * 1 + a.nombre_likes * 3 + a.nombre_commentaires * 5 + a.nombre_partages * 8 + COALESCE(a.nombre_favoris, 0) * 10) as score_popularite
                FROM ARTICLES_BLOG_PLATEFORME a
                LEFT JOIN COMPTES c ON c.id = a.auteur_id
                WHERE a.statut = 'PUBLIE' AND a.est_archive = FALSE
                ORDER BY score_popularite DESC
                LIMIT 10
            `);

            // ✅ Évolution temporelle
            const evolution = await db.query(`
                SELECT 
                    DATE(date_creation) as date,
                    COUNT(*) as articles_crees,
                    COUNT(*) FILTER (WHERE statut = 'PUBLIE') as articles_publies,
                    COUNT(*) FILTER (WHERE statut = 'BROUILLON') as brouillons,
                    COALESCE(SUM(nombre_vues), 0) as vues,
                    COALESCE(SUM(nombre_likes), 0) as likes,
                    COALESCE(SUM(nombre_commentaires), 0) as commentaires
                FROM ARTICLES_BLOG_PLATEFORME
                WHERE date_creation >= NOW() - ${interval}
                GROUP BY DATE(date_creation)
                ORDER BY date ASC
            `);

            // ✅ Engagement
            const engagement = await db.query(`
                SELECT 
                    ROUND(AVG(nombre_vues)::numeric, 1) as vues_moyennes,
                    ROUND(AVG(nombre_likes)::numeric, 1) as likes_moyens,
                    ROUND(AVG(nombre_commentaires)::numeric, 1) as commentaires_moyens,
                    ROUND(AVG(nombre_partages)::numeric, 1) as partages_moyens,
                    ROUND(AVG(COALESCE(nombre_favoris, 0))::numeric, 1) as favoris_moyens,
                    ROUND(AVG(temps_lecture_moyen)::numeric, 0) as temps_lecture_moyen_secondes,
                    ROUND(AVG(taux_completion)::numeric, 1) as taux_completion_moyen
                FROM ARTICLES_BLOG_PLATEFORME
                WHERE statut = 'PUBLIE' AND date_publication >= NOW() - ${interval}
            `);

            // ✅ Statistiques en temps réel (dernières 24h)
            const tempsReel = await db.query(`
                SELECT 
                    COUNT(DISTINCT article_id) as articles_actifs_24h,
                    COALESCE(SUM(nombre_vues), 0) as vues_24h,
                    COALESCE(SUM(nombre_likes), 0) as likes_24h,
                    COALESCE(SUM(nombre_commentaires), 0) as commentaires_24h
                FROM (
                    SELECT article_id, 
                           COUNT(*) as nombre_vues,
                           0 as nombre_likes,
                           0 as nombre_commentaires
                    FROM STATS_LECTURE_ARTICLES 
                    WHERE date_lecture > NOW() - INTERVAL '24 hours'
                    GROUP BY article_id
                    UNION ALL
                    SELECT article_id, 0, COUNT(*), 0
                    FROM LIKES_ARTICLES 
                    WHERE date_like > NOW() - INTERVAL '24 hours'
                    GROUP BY article_id
                    UNION ALL
                    SELECT article_id, 0, 0, COUNT(*)
                    FROM COMMENTAIRES 
                    WHERE date_creation > NOW() - INTERVAL '24 hours'
                    GROUP BY article_id
                ) realtime
            `);

            // ✅ Distribution par jour de la semaine
            const joursSemaine = await db.query(`
                SELECT 
                    EXTRACT(DOW FROM date_creation) as jour_semaine,
                    COUNT(*) as nombre_articles,
                    ROUND(AVG(nombre_vues)::numeric, 1) as vues_moyennes
                FROM ARTICLES_BLOG_PLATEFORME
                WHERE statut = 'PUBLIE'
                GROUP BY EXTRACT(DOW FROM date_creation)
                ORDER BY jour_semaine
            `);

            // ✅ Distribution par heure de publication
            const heuresPublication = await db.query(`
                SELECT 
                    EXTRACT(HOUR FROM date_publication) as heure,
                    COUNT(*) as nombre_articles,
                    ROUND(AVG(nombre_vues)::numeric, 1) as vues_moyennes
                FROM ARTICLES_BLOG_PLATEFORME
                WHERE statut = 'PUBLIE' AND date_publication IS NOT NULL
                GROUP BY EXTRACT(HOUR FROM date_publication)
                ORDER BY heure
            `);

            const responseData = {
                success: true,
                data: {
                    periode,
                    generales: generales.rows[0],
                    comparaison: comparaison?.rows[0] || null,
                    top_categories: categories.rows,
                    top_auteurs: auteurs.rows,
                    top_articles: topArticles.rows,
                    evolution: evolution.rows,
                    engagement: engagement.rows[0],
                    temps_reel: tempsReel.rows[0],
                    jours_semaine: joursSemaine.rows,
                    heures_publication: heuresPublication.rows
                }
            };

            CacheService.set(cacheKey, responseData, 600).catch(() => {}); // 10 minutes
            res.json(responseData);

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

            const cacheKey = `blog:stats:categories:${periode}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) return res.json({ success: true, data: cached, fromCache: true });

            const result = await db.query(`
                SELECT 
                    categorie_principale,
                    COUNT(*) as total_articles,
                    COUNT(*) FILTER (WHERE date_creation >= NOW() - INTERVAL '30 days') as nouveaux_30j,
                    COUNT(*) FILTER (WHERE date_creation >= NOW() - INTERVAL '7 days') as nouveaux_7j,
                    COALESCE(SUM(nombre_vues), 0) as total_vues,
                    COALESCE(SUM(nombre_likes), 0) as total_likes,
                    COALESCE(SUM(nombre_commentaires), 0) as total_commentaires,
                    COALESCE(SUM(nombre_partages), 0) as total_partages,
                    COALESCE(SUM(COALESCE(nombre_favoris, 0)), 0) as total_favoris,
                    ROUND(AVG(nombre_vues)::numeric, 1) as vues_moyennes,
                    ROUND(AVG(nombre_likes)::numeric, 1) as likes_moyens,
                    ROUND(
                        CASE WHEN COALESCE(SUM(nombre_vues), 0) > 0 
                        THEN (COALESCE(SUM(nombre_likes), 0) + COALESCE(SUM(nombre_commentaires), 0) + COALESCE(SUM(nombre_partages), 0) + COALESCE(SUM(COALESCE(nombre_favoris, 0)), 0)) * 100.0 / COALESCE(SUM(nombre_vues), 1)
                        ELSE 0 END, 2
                    ) as taux_engagement,
                    COUNT(DISTINCT auteur_id) as auteurs_actifs,
                    ROUND(AVG(temps_lecture_moyen)::numeric, 0) as temps_lecture_moyen,
                    ROUND(AVG(taux_completion)::numeric, 1) as taux_completion_moyen
                FROM ARTICLES_BLOG_PLATEFORME
                WHERE statut = 'PUBLIE'
                GROUP BY categorie_principale
                ORDER BY total_vues DESC
            `);

            CacheService.set(cacheKey, result.rows, 600).catch(() => {});
            res.json({ success: true, data: result.rows });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les statistiques de lecture
     * @route GET /api/v1/blog/stats/lecture
     */
    async getReadingStats(req, res, next) {
        try {
            const { periode = '30d', article_id } = req.query;
            const interval = this.getInterval(periode);

            const params = [];
            let articleFilter = '';
            if (article_id) {
                articleFilter = 'WHERE al.article_id = $1';
                params.push(article_id);
            }

            // ✅ Statistiques globales de lecture
            const global = await db.query(`
                SELECT 
                    COUNT(*) as total_lectures,
                    COUNT(DISTINCT al.compte_id) as lecteurs_uniques,
                    COUNT(DISTINCT al.article_id) as articles_lus,
                    COUNT(DISTINCT al.session_id) as sessions_uniques,
                    ROUND(AVG(al.temps_passe_secondes)::numeric, 1) as temps_moyen_secondes,
                    ROUND(AVG(al.pourcentage_lu)::numeric, 1) as pourcentage_moyen,
                    COUNT(*) FILTER (WHERE al.est_termine = TRUE) as lectures_completes,
                    ROUND(
                        COUNT(*) FILTER (WHERE al.est_termine = TRUE) * 100.0 / NULLIF(COUNT(*), 0), 1
                    ) as taux_completion,
                    SUM(al.temps_passe_secondes) as temps_total_secondes,
                    ROUND(SUM(al.temps_passe_secondes) / 3600.0, 1) as temps_total_heures
                FROM ANALYTIQUES_LECTURE al
                ${articleFilter}
                WHERE al.date_debut >= NOW() - ${interval}
            `, params);

            // ✅ Distribution des pourcentages lus
            const distribution = await db.query(`
                SELECT 
                    CASE 
                        WHEN al.pourcentage_lu < 10 THEN '0-10%'
                        WHEN al.pourcentage_lu < 25 THEN '10-25%'
                        WHEN al.pourcentage_lu < 50 THEN '25-50%'
                        WHEN al.pourcentage_lu < 75 THEN '50-75%'
                        WHEN al.pourcentage_lu < 90 THEN '75-90%'
                        ELSE '90-100%'
                    END as intervalle,
                    COUNT(*) as nombre,
                    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pourcentage
                FROM ANALYTIQUES_LECTURE al
                ${articleFilter}
                WHERE al.pourcentage_lu IS NOT NULL
                GROUP BY intervalle
                ORDER BY 
                    CASE intervalle
                        WHEN '0-10%' THEN 1
                        WHEN '10-25%' THEN 2
                        WHEN '25-50%' THEN 3
                        WHEN '50-75%' THEN 4
                        WHEN '75-90%' THEN 5
                        ELSE 6
                    END
            `, params);

            // ✅ Top articles lus
            const topArticles = await db.query(`
                SELECT 
                    al.article_id,
                    a.titre_article,
                    a.slug,
                    a.image_principale,
                    COUNT(*) as lectures,
                    COUNT(DISTINCT al.compte_id) as lecteurs,
                    ROUND(AVG(al.pourcentage_lu)::numeric, 1) as pourcentage_moyen,
                    ROUND(AVG(al.temps_passe_secondes)::numeric, 0) as temps_moyen_secondes
                FROM ANALYTIQUES_LECTURE al
                JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = al.article_id
                ${articleFilter}
                WHERE al.date_debut >= NOW() - ${interval}
                GROUP BY al.article_id, a.titre_article, a.slug, a.image_principale
                ORDER BY lectures DESC
                LIMIT 10
            `, params);

            // ✅ Appareils utilisés
            const appareils = await db.query(`
                SELECT 
                    COALESCE(al.appareil_type, 'DESKTOP') as type,
                    COUNT(*) as nombre,
                    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pourcentage,
                    ROUND(AVG(al.pourcentage_lu)::numeric, 1) as pourcentage_moyen,
                    ROUND(AVG(al.temps_passe_secondes)::numeric, 0) as temps_moyen_secondes
                FROM ANALYTIQUES_LECTURE al
                ${articleFilter}
                WHERE al.date_debut >= NOW() - ${interval}
                GROUP BY al.appareil_type
                ORDER BY nombre DESC
            `, params);

            // ✅ Sources de trafic (referer)
            const sources = await db.query(`
                SELECT 
                    'DIRECT' as source,
                    COUNT(*) as nombre
                FROM ANALYTIQUES_LECTURE al
                ${articleFilter}
                WHERE al.date_debut >= NOW() - ${interval}
                LIMIT 5
            `, params);

            // ✅ Évolution des lectures par jour
            const evolution = await db.query(`
                SELECT 
                    DATE(al.date_debut) as date,
                    COUNT(*) as lectures,
                    COUNT(DISTINCT al.compte_id) as lecteurs,
                    ROUND(AVG(al.pourcentage_lu)::numeric, 1) as pourcentage_moyen
                FROM ANALYTIQUES_LECTURE al
                ${articleFilter}
                WHERE al.date_debut >= NOW() - ${interval}
                GROUP BY DATE(al.date_debut)
                ORDER BY date DESC
            `, params);

            res.json({
                success: true,
                data: {
                    global: global.rows[0],
                    distribution: distribution.rows,
                    top_articles: topArticles.rows,
                    appareils: appareils.rows,
                    sources: sources.rows,
                    evolution: evolution.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * ✅ NOUVEAU : Statistiques d'engagement (likes, commentaires, partages)
     * @route GET /api/v1/blog/stats/engagement
     */
    async getEngagementStats(req, res, next) {
        try {
            const { periode = '30d' } = req.query;
            const interval = this.getInterval(periode);

            const cacheKey = `blog:stats:engagement:${periode}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) return res.json({ success: true, data: cached, fromCache: true });

            // Likes sur la période
            const likes = await db.query(`
                SELECT 
                    DATE(la.date_like) as date,
                    COUNT(*) as likes,
                    COUNT(*) FILTER (WHERE la.type_like = 'LIKE') as likes_positifs,
                    COUNT(*) FILTER (WHERE la.type_like = 'DISLIKE') as dislikes
                FROM LIKES_ARTICLES la
                WHERE la.date_like >= NOW() - ${interval}
                GROUP BY DATE(la.date_like)
                ORDER BY date DESC
            `);

            // Commentaires sur la période
            const commentaires = await db.query(`
                SELECT 
                    DATE(c.date_creation) as date,
                    COUNT(*) as commentaires,
                    COUNT(DISTINCT c.auteur_id) as commentateurs,
                    COUNT(*) FILTER (WHERE c.statut = 'APPROUVE') as approuves,
                    COUNT(*) FILTER (WHERE c.statut = 'REJETE') as rejetes
                FROM COMMENTAIRES c
                WHERE c.date_creation >= NOW() - ${interval}
                GROUP BY DATE(c.date_creation)
                ORDER BY date DESC
            `);

            // Top commentateurs
            const topCommentateurs = await db.query(`
                SELECT 
                    c.auteur_id,
                    comp.nom_utilisateur_compte,
                    comp.photo_profil_compte,
                    COUNT(*) as total_commentaires,
                    COUNT(*) FILTER (WHERE c.statut = 'APPROUVE') as commentaires_approuves,
                    COUNT(DISTINCT c.article_id) as articles_commentes
                FROM COMMENTAIRES c
                JOIN COMPTES comp ON comp.id = c.auteur_id
                WHERE c.date_creation >= NOW() - ${interval}
                GROUP BY c.auteur_id, comp.nom_utilisateur_compte, comp.photo_profil_compte
                ORDER BY total_commentaires DESC
                LIMIT 15
            `);

            // Partages sur la période
            const partages = await db.query(`
                SELECT 
                    p.type_partage,
                    COUNT(*) as nombre,
                    COUNT(DISTINCT p.article_id) as articles_partages,
                    COUNT(DISTINCT p.compte_id) as partageurs
                FROM PARTAGES_ARTICLES p
                WHERE p.date_partage >= NOW() - ${interval}
                GROUP BY p.type_partage
                ORDER BY nombre DESC
            `);

            // Favoris sur la période
            const favoris = await db.query(`
                SELECT 
                    DATE(fa.date_ajout) as date,
                    COUNT(*) as favoris,
                    COUNT(DISTINCT fa.compte_id) as utilisateurs,
                    COUNT(DISTINCT fa.article_id) as articles
                FROM FAVORIS_ARTICLES fa
                WHERE fa.date_ajout >= NOW() - ${interval}
                GROUP BY DATE(fa.date_ajout)
                ORDER BY date DESC
            `);

            // Taux d'engagement global
            const tauxEngagement = await db.query(`
                SELECT 
                    ROUND(
                        (COALESCE(SUM(nombre_likes), 0) + COALESCE(SUM(nombre_commentaires), 0) + COALESCE(SUM(nombre_partages), 0) + COALESCE(SUM(COALESCE(nombre_favoris, 0)), 0)) * 100.0 
                        / NULLIF(COALESCE(SUM(nombre_vues), 1), 0), 2
                    ) as taux_engagement_global,
                    ROUND(AVG(
                        CASE WHEN nombre_vues > 0 
                        THEN (nombre_likes + nombre_commentaires + nombre_partages + COALESCE(nombre_favoris, 0)) * 100.0 / nombre_vues
                        ELSE 0 END
                    )::numeric, 2) as taux_engagement_moyen
                FROM ARTICLES_BLOG_PLATEFORME
                WHERE statut = 'PUBLIE' AND date_publication >= NOW() - ${interval}
            `);

            const responseData = {
                success: true,
                data: {
                    likes: likes.rows,
                    commentaires: commentaires.rows,
                    top_commentateurs: topCommentateurs.rows,
                    partages: partages.rows,
                    favoris: favoris.rows,
                    taux_engagement: tauxEngagement.rows[0]
                }
            };

            CacheService.set(cacheKey, responseData, 600).catch(() => {});
            res.json(responseData);

        } catch (error) {
            next(error);
        }
    }

    /**
     * ✅ NOUVEAU : Statistiques dashboard auteur
     * @route GET /api/v1/blog/stats/dashboard
     */
    async getDashboardAuteur(req, res, next) {
        try {
            if (!req.user) throw new Error('Authentification requise');

            const auteurId = req.query.auteur_id || req.user.id;

            const cacheKey = `blog:stats:dashboard:${auteurId}`;
            const cached = await CacheService.get(cacheKey);
            if (cached && req.query.skip_cache !== 'true') {
                return res.json({ success: true, data: cached, fromCache: true });
            }

            // Vue d'ensemble
            const overview = await db.query(`
                SELECT 
                    COUNT(*) as total_articles,
                    COUNT(*) FILTER (WHERE statut = 'PUBLIE') as publies,
                    COUNT(*) FILTER (WHERE statut = 'BROUILLON') as brouillons,
                    COUNT(*) FILTER (WHERE statut = 'PROGRAMME') as programmes,
                    COUNT(*) FILTER (WHERE statut = 'SIGNALE') as signales,
                    COALESCE(SUM(nombre_vues), 0) as total_vues,
                    COALESCE(SUM(nombre_likes), 0) as total_likes,
                    COALESCE(SUM(nombre_commentaires), 0) as total_commentaires,
                    COALESCE(SUM(nombre_partages), 0) as total_partages,
                    COALESCE(SUM(COALESCE(nombre_favoris, 0)), 0) as total_favoris,
                    COUNT(DISTINCT ab.compte_id) as nombre_abonnes,
                    ROUND(AVG(taux_completion)::numeric, 1) as taux_completion_moyen
                FROM ARTICLES_BLOG_PLATEFORME a
                LEFT JOIN ABONNEMENTS_BLOG ab ON ab.type_abonnement = 'AUTEUR' AND ab.reference_id = a.auteur_id AND ab.actif = TRUE
                WHERE a.auteur_id = $1
            `, [auteurId]);

            // Articles récents
            const articlesRecents = await db.query(`
                SELECT id, titre_article, slug, statut, date_creation, date_publication,
                       nombre_vues, nombre_likes, nombre_commentaires, nombre_partages
                FROM ARTICLES_BLOG_PLATEFORME
                WHERE auteur_id = $1
                ORDER BY date_modification DESC
                LIMIT 10
            `, [auteurId]);

            // Évolution des vues
            const evolutionVues = await db.query(`
                SELECT 
                    DATE(sla.date_lecture) as date,
                    COUNT(*) as vues,
                    COUNT(DISTINCT sla.compte_id) as visiteurs
                FROM STATS_LECTURE_ARTICLES sla
                JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = sla.article_id
                WHERE a.auteur_id = $1 AND sla.date_lecture >= NOW() - INTERVAL '30 days'
                GROUP BY DATE(sla.date_lecture)
                ORDER BY date DESC
            `, [auteurId]);

            // Répartition par catégorie
            const categories = await db.query(`
                SELECT categorie_principale, COUNT(*) as nombre,
                       COALESCE(SUM(nombre_vues), 0) as total_vues
                FROM ARTICLES_BLOG_PLATEFORME
                WHERE auteur_id = $1 AND statut = 'PUBLIE'
                GROUP BY categorie_principale
                ORDER BY nombre DESC
            `, [auteurId]);

            const responseData = {
                success: true,
                data: {
                    overview: overview.rows[0],
                    articles_recents: articlesRecents.rows,
                    evolution_vues: evolutionVues.rows,
                    categories: categories.rows
                }
            };

            CacheService.set(cacheKey, responseData, 300).catch(() => {});
            res.json(responseData);

        } catch (error) {
            next(error);
        }
    }

    /**
     * ✅ NOUVEAU : Statistiques des quiz
     * @route GET /api/v1/blog/stats/quiz
     */
    async getQuizStats(req, res, next) {
        try {
            const { periode = '30d' } = req.query;
            const interval = this.getInterval(periode);

            const stats = await db.query(`
                SELECT 
                    COUNT(DISTINCT q.article_id) as articles_avec_quiz,
                    COUNT(q.id) as total_quiz,
                    COUNT(rq.id) as total_reponses,
                    COUNT(DISTINCT rq.compte_id) as participants,
                    ROUND(AVG(rq.points_obtenus)::numeric, 1) as points_moyens,
                    COUNT(rq.id) FILTER (WHERE rq.est_correcte = TRUE) as bonnes_reponses,
                    ROUND(
                        COUNT(rq.id) FILTER (WHERE rq.est_correcte = TRUE) * 100.0 / NULLIF(COUNT(rq.id), 0), 1
                    ) as taux_reussite,
                    ROUND(AVG(rq.temps_reponse_secondes)::numeric, 1) as temps_moyen_secondes
                FROM QUIZ_ARTICLES q
                LEFT JOIN REPONSES_QUIZ rq ON rq.quiz_id = q.id
                    AND rq.date_reponse >= NOW() - ${interval}
            `);

            res.json({ success: true, data: stats.rows[0] });

        } catch (error) {
            next(error);
        }
    }

    /**
     * ✅ NOUVEAU : Statistiques des badges
     * @route GET /api/v1/blog/stats/badges
     */
    async getBadgeStats(req, res, next) {
        try {
            const stats = await db.query(`
                SELECT 
                    b.categorie_badge,
                    COUNT(DISTINCT b.id) as badges_disponibles,
                    COUNT(bu.id) as badges_attribues,
                    COUNT(DISTINCT bu.compte_id) as utilisateurs_decernes,
                    ROUND(AVG(b.points_requis)::numeric, 0) as points_moyens
                FROM BADGES_LECTURE b
                LEFT JOIN BADGES_UTILISATEUR bu ON bu.badge_id = b.id
                WHERE b.est_actif = TRUE
                GROUP BY b.categorie_badge
                ORDER BY badges_attribues DESC
            `);

            const topUsers = await db.query(`
                SELECT 
                    c.id, c.nom_utilisateur_compte, c.photo_profil_compte,
                    COUNT(bu.id) as nombre_badges,
                    COALESCE(SUM(b.points_requis), 0) as total_points
                FROM BADGES_UTILISATEUR bu
                JOIN COMPTES c ON c.id = bu.compte_id
                JOIN BADGES_LECTURE b ON b.id = bu.badge_id
                GROUP BY c.id, c.nom_utilisateur_compte, c.photo_profil_compte
                ORDER BY nombre_badges DESC, total_points DESC
                LIMIT 20
            `);

            res.json({
                success: true,
                data: {
                    stats: stats.rows,
                    top_users: topUsers.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }

    // ========================================================================
    // MÉTHODES PRIVÉES
    // ========================================================================

    getInterval(periode) {
        const intervals = {
            '24h': "INTERVAL '24 hours'",
            '7d': "INTERVAL '7 days'",
            '30d': "INTERVAL '30 days'",
            '90d': "INTERVAL '90 days'",
            '1y': "INTERVAL '1 year'"
        };
        return intervals[periode] || "INTERVAL '30 days'";
    }

    getPreviousInterval(periode) {
        const intervals = {
            '24h': "INTERVAL '48 hours'",
            '7d': "INTERVAL '14 days'",
            '30d': "INTERVAL '60 days'",
            '90d': "INTERVAL '180 days'",
            '1y': "INTERVAL '2 years'"
        };
        return intervals[periode] || "INTERVAL '60 days'";
    }
}

module.exports = new StatsBlogController();