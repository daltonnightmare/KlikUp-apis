// src/controllers/blog/RecommendationController.js
const db = require('../../configuration/database');
const { ValidationError, AuthenticationError } = require('../../utils/errors/AppError');
const CacheService = require('../../services/cache/CacheService');

class RecommendationController {

    // ========================================================================
    // RECOMMANDATIONS PERSONNALISÉES
    // ========================================================================

    /**
     * Récupérer les recommandations personnalisées pour l'utilisateur
     * @route GET /api/v1/blog/recommandations
     */
    async getRecommandations(req, res, next) {
        try {
            const { limit = 10, page = 1, categorie, exclude_ids } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            const cacheKey = `recommandations:user:${req.user?.id || 'anonymous'}:${page}:${limit}:${categorie || 'all'}`;
            const cached = await CacheService.get(cacheKey);
            if (cached && req.query.skip_cache !== 'true') {
                return res.json({ success: true, data: cached, fromCache: true });
            }

            let articles;

            if (req.user) {
                // ✅ Recommandations personnalisées basées sur l'historique
                articles = await this.getPersonalizedRecommendations(req.user.id, parseInt(limit), offset, categorie, exclude_ids);
            } else {
                // ✅ Recommandations populaires pour les non-connectés
                articles = await this.getPopularRecommendations(parseInt(limit), offset, categorie);
            }

            // Enrichir avec le statut utilisateur
            if (req.user && articles.length > 0) {
                await this.enrichWithUserData(articles, req.user.id);
            }

            const total = articles[0]?.total_count || 0;
            const responseData = {
                success: true,
                data: articles,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(total),
                    pages: Math.ceil(parseInt(total) / Math.max(1, parseInt(limit)))
                }
            };

            CacheService.set(cacheKey, responseData, 300).catch(() => {}); // 5 minutes

            res.json(responseData);

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les articles similaires à un article donné
     * @route GET /api/v1/blog/articles/:articleId/similaires
     */
    async getSimilarArticles(req, res, next) {
        try {
            const { articleId } = req.params;
            const { limit = 5 } = req.query;

            const cacheKey = `similar:article:${articleId}:${limit}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({ success: true, data: cached, fromCache: true });
            }

            // Récupérer l'article source
            const source = await db.query(
                `SELECT id, categorie_principale, mots_cles, auteur_id, titre_article
                 FROM ARTICLES_BLOG_PLATEFORME 
                 WHERE id = $1 AND statut = 'PUBLIE'`,
                [articleId]
            );

            if (source.rows.length === 0) {
                return res.json({ success: true, data: [], message: 'Article source non trouvé' });
            }

            const sourceArticle = source.rows[0];

            // Recherche par similarité de contenu
            const result = await db.query(
                `SELECT 
                    a.*,
                    c.nom_utilisateur_compte as auteur_nom,
                    c.photo_profil_compte as auteur_photo,
                    ts_rank(
                        to_tsvector('french', COALESCE(a.titre_article, '') || ' ' || COALESCE(a.contenu_article, '')),
                        plainto_tsquery('french', $2)
                    ) as score_pertinence,
                    (
                        CASE WHEN a.categorie_principale = $3 THEN 30 ELSE 0 END +
                        CASE WHEN a.mots_cles && $4::text[] THEN 20 ELSE 0 END +
                        CASE WHEN a.auteur_id = $5 THEN 15 ELSE 0 END
                    ) as score_affinites
                 FROM ARTICLES_BLOG_PLATEFORME a
                 LEFT JOIN COMPTES c ON c.id = a.auteur_id
                 WHERE a.id != $1
                   AND a.statut = 'PUBLIE'
                   AND a.est_archive = FALSE
                   AND (
                       a.categorie_principale = $3
                       OR a.mots_cles && $4::text[]
                       OR a.auteur_id = $5
                       OR to_tsvector('french', COALESCE(a.titre_article, '') || ' ' || COALESCE(a.contenu_article, '')) 
                          @@ plainto_tsquery('french', $2)
                   )
                 ORDER BY (score_pertinence * 0.4 + score_affinites * 0.6) DESC, a.date_publication DESC
                 LIMIT $6`,
                [
                    articleId,
                    this.buildSearchQuery(sourceArticle.titre_article, sourceArticle.mots_cles),
                    sourceArticle.categorie_principale,
                    sourceArticle.mots_cles || [],
                    sourceArticle.auteur_id,
                    parseInt(limit)
                ]
            );

            CacheService.set(cacheKey, result.rows, 600).catch(() => {}); // 10 minutes

            res.json({
                success: true,
                data: result.rows
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les articles tendances
     * @route GET /api/v1/blog/recommandations/tendances
     */
    async getTendances(req, res, next) {
        try {
            const { periode = '24h', limit = 10, categorie } = req.query;

            const cacheKey = `tendances:${periode}:${limit}:${categorie || 'all'}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({ success: true, data: cached, fromCache: true });
            }

            let dateFilter;
            switch (periode) {
                case '1h': dateFilter = "NOW() - INTERVAL '1 hour'"; break;
                case '6h': dateFilter = "NOW() - INTERVAL '6 hours'"; break;
                case '24h': dateFilter = "NOW() - INTERVAL '24 hours'"; break;
                case '7d': dateFilter = "NOW() - INTERVAL '7 days'"; break;
                case '30d': dateFilter = "NOW() - INTERVAL '30 days'"; break;
                default: dateFilter = "NOW() - INTERVAL '24 hours'";
            }

            let query = `
                WITH article_scores AS (
                    SELECT 
                        a.id,
                        a.titre_article,
                        a.slug,
                        a.image_principale,
                        a.extrait_contenu,
                        a.categorie_principale,
                        a.date_publication,
                        a.nombre_vues,
                        a.nombre_likes,
                        a.nombre_commentaires,
                        a.nombre_partages,
                        a.nombre_favoris,
                        c.nom_utilisateur_compte as auteur_nom,
                        c.photo_profil_compte as auteur_photo,
                        COALESCE(
                            (SELECT COUNT(*) FROM STATS_LECTURE_ARTICLES 
                             WHERE article_id = a.id AND date_lecture >= ${dateFilter}), 0
                        ) as vues_recentes,
                        COALESCE(
                            (SELECT COUNT(*) FROM LIKES_ARTICLES 
                             WHERE article_id = a.id AND date_like >= ${dateFilter}), 0
                        ) as likes_recents,
                        COALESCE(
                            (SELECT COUNT(*) FROM COMMENTAIRES 
                             WHERE article_id = a.id AND date_creation >= ${dateFilter}), 0
                        ) as commentaires_recents,
                        COALESCE(
                            (SELECT COUNT(*) FROM PARTAGES_ARTICLES 
                             WHERE article_id = a.id AND date_partage >= ${dateFilter}), 0
                        ) as partages_recents,
                        COALESCE(
                            (SELECT COUNT(*) FROM FAVORIS_ARTICLES 
                             WHERE article_id = a.id AND date_ajout >= ${dateFilter}), 0
                        ) as favoris_recents
                    FROM ARTICLES_BLOG_PLATEFORME a
                    LEFT JOIN COMPTES c ON c.id = a.auteur_id
                    WHERE a.statut = 'PUBLIE' 
                      AND a.est_archive = FALSE
                      AND a.date_publication >= ${dateFilter}
            `;

            const params = [];
            let paramIndex = 1;

            if (categorie) {
                query += ` AND a.categorie_principale = $${paramIndex}`;
                params.push(categorie);
                paramIndex++;
            }

            query += `
                )
                SELECT *,
                    (vues_recentes * 1 + 
                     likes_recents * 3 + 
                     commentaires_recents * 5 + 
                     partages_recents * 8 + 
                     favoris_recents * 10) as score_tendance
                FROM article_scores
                ORDER BY score_tendance DESC, date_publication DESC
                LIMIT $${paramIndex}
            `;
            params.push(parseInt(limit));

            const result = await db.query(query, params);

            CacheService.set(cacheKey, result.rows, 120).catch(() => {}); // 2 minutes

            res.json({
                success: true,
                data: result.rows,
                periode
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les articles par catégorie avec tri intelligent
     * @route GET /api/v1/blog/recommandations/decouvrir
     */
    async getDecouvrir(req, res, next) {
        try {
            const { limit = 15, page = 1, exclure_vus = true } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            let articles;
            const excludeIds = [];

            if (req.user && exclure_vus === 'true') {
                // Exclure les articles déjà lus
                const vus = await db.query(
                    `SELECT DISTINCT article_id FROM ANALYTIQUES_LECTURE 
                     WHERE compte_id = $1 AND pourcentage_lu >= 50`,
                    [req.user.id]
                );
                excludeIds.push(...vus.rows.map(r => r.article_id));
            }

            articles = await db.query(
                `SELECT 
                    a.*,
                    c.nom_utilisateur_compte as auteur_nom,
                    c.photo_profil_compte as auteur_photo,
                    (
                        SELECT ROUND(AVG(note_globale)::numeric, 1) 
                        FROM AVIS 
                        WHERE entite_type = 'ARTICLE_BLOG' AND entite_id = a.id AND statut = 'PUBLIE'
                    ) as note_moyenne,
                    COUNT(*) OVER() as total_count
                 FROM ARTICLES_BLOG_PLATEFORME a
                 LEFT JOIN COMPTES c ON c.id = a.auteur_id
                 WHERE a.statut = 'PUBLIE'
                   AND a.est_archive = FALSE
                   ${excludeIds.length > 0 ? 'AND a.id != ALL($1::int[])' : ''}
                 ORDER BY 
                    RANDOM() * 
                    (1 + COALESCE(a.nombre_likes, 0) * 0.01 + COALESCE(a.nombre_vues, 0) * 0.001) DESC
                 LIMIT $${excludeIds.length > 0 ? 2 : 1} OFFSET $${excludeIds.length > 0 ? 3 : 2}`,
                excludeIds.length > 0 
                    ? [excludeIds, parseInt(limit), offset] 
                    : [parseInt(limit), offset]
            );

            const total = articles.rows[0]?.total_count || 0;

            // Enrichir avec les données utilisateur
            if (req.user && articles.rows.length > 0) {
                await this.enrichWithUserData(articles.rows, req.user.id);
            }

            res.json({
                success: true,
                data: articles.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(total),
                    pages: Math.ceil(parseInt(total) / Math.max(1, parseInt(limit)))
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les articles d'un auteur spécifique + similaires
     * @route GET /api/v1/blog/recommandations/auteur/:auteurId
     */
    async getByAuthor(req, res, next) {
        try {
            const { auteurId } = req.params;
            const { limit = 10 } = req.query;

            const result = await db.query(
                `SELECT 
                    a.*,
                    c.nom_utilisateur_compte as auteur_nom,
                    c.photo_profil_compte as auteur_photo,
                    COUNT(DISTINCT l.id) as total_likes,
                    COUNT(DISTINCT com.id) as total_commentaires
                 FROM ARTICLES_BLOG_PLATEFORME a
                 LEFT JOIN COMPTES c ON c.id = a.auteur_id
                 LEFT JOIN LIKES_ARTICLES l ON l.article_id = a.id
                 LEFT JOIN COMMENTAIRES com ON com.article_id = a.id AND com.statut = 'APPROUVE'
                 WHERE a.auteur_id = $1
                   AND a.statut = 'PUBLIE'
                   AND a.est_archive = FALSE
                 GROUP BY a.id, c.nom_utilisateur_compte, c.photo_profil_compte
                 ORDER BY a.date_publication DESC
                 LIMIT $2`,
                [auteurId, parseInt(limit)]
            );

            // Si peu d'articles, suggérer des articles similaires
            if (result.rows.length < 5) {
                const authorCategories = [...new Set(result.rows.map(a => a.categorie_principale))];
                const supplements = await db.query(
                    `SELECT a.*, c.nom_utilisateur_compte as auteur_nom
                     FROM ARTICLES_BLOG_PLATEFORME a
                     LEFT JOIN COMPTES c ON c.id = a.auteur_id
                     WHERE a.auteur_id != $1
                       AND a.statut = 'PUBLIE'
                       AND a.est_archive = FALSE
                       AND a.categorie_principale = ANY($2)
                     ORDER BY a.nombre_vues DESC
                     LIMIT $3`,
                    [auteurId, authorCategories, 5 - result.rows.length]
                );
                result.rows.push(...supplements.rows.map(a => ({ ...a, est_suggestion: true })));
            }

            res.json({
                success: true,
                data: result.rows
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Mettre à jour les préférences de recommandation
     * @route PUT /api/v1/blog/recommandations/preferences
     */
    async updatePreferences(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const {
                categories_preferees = [],
                categories_exclues = [],
                auteurs_preferes = [],
                auteurs_exclues = [],
                tags_preferes = [],
                frequence_minimale = 'HEBDOMADAIRE'
            } = req.body;

            // Sauvegarder les préférences
            await db.query(
                `INSERT INTO PREFERENCES_RECOMMANDATION 
                    (compte_id, categories_preferees, categories_exclues, 
                     auteurs_preferes, auteurs_exclues, tags_preferes, frequence_minimale)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (compte_id) DO UPDATE SET
                    categories_preferees = $2,
                    categories_exclues = $3,
                    auteurs_preferes = $4,
                    auteurs_exclues = $5,
                    tags_preferes = $6,
                    frequence_minimale = $7,
                    date_mise_a_jour = NOW()`,
                [
                    req.user.id,
                    categories_preferees,
                    categories_exclues,
                    auteurs_preferes,
                    auteurs_exclues,
                    tags_preferes,
                    frequence_minimale
                ]
            );

            // Invalider le cache
            CacheService.del(`recommandations:preferences:${req.user.id}`).catch(() => {});
            CacheService.invalidatePattern(`recommandations:user:${req.user.id}:*`).catch(() => {});

            res.json({
                success: true,
                message: 'Préférences mises à jour'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les préférences de recommandation
     * @route GET /api/v1/blog/recommandations/preferences
     */
    async getPreferences(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const result = await db.query(
                'SELECT * FROM PREFERENCES_RECOMMANDATION WHERE compte_id = $1',
                [req.user.id]
            );

            res.json({
                success: true,
                data: result.rows[0] || {
                    categories_preferees: [],
                    categories_exclues: [],
                    auteurs_preferes: [],
                    auteurs_exclues: [],
                    tags_preferes: []
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer le feed personnalisé (version avancée)
     * @route GET /api/v1/blog/feed
     */
    async getFeed(req, res, next) {
        try {
            const { limit = 20, page = 1 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            if (!req.user) {
                // Pour les non-connectés : articles récents + populaires
                const result = await db.query(
                    `SELECT a.*, c.nom_utilisateur_compte as auteur_nom,
                            c.photo_profil_compte as auteur_photo,
                            'recent' as source_recommandation,
                            COUNT(*) OVER() as total_count
                     FROM ARTICLES_BLOG_PLATEFORME a
                     LEFT JOIN COMPTES c ON c.id = a.auteur_id
                     WHERE a.statut = 'PUBLIE' AND a.est_archive = FALSE
                     ORDER BY a.date_publication DESC
                     LIMIT $1 OFFSET $2`,
                    [parseInt(limit), offset]
                );

                const total = result.rows[0]?.total_count || 0;
                return res.json({
                    success: true,
                    data: result.rows,
                    pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(total), pages: Math.ceil(parseInt(total) / parseInt(limit)) }
                });
            }

            // Pour les connectés : mix personnalisé
            const preferences = await db.query(
                'SELECT * FROM PREFERENCES_RECOMMANDATION WHERE compte_id = $1',
                [req.user.id]
            );

            const prefs = preferences.rows[0] || {};
            const categoriesPreferees = prefs.categories_preferees || [];
            const auteursPreferes = prefs.auteurs_preferes || [];
            const tagsPreferes = prefs.tags_preferes || [];
            const categoriesExclues = prefs.categories_exclues || [];

            // Construire le feed mixte
            let query = `
                SELECT * FROM (
                    -- Articles des catégories préférées
                    SELECT a.*, c.nom_utilisateur_compte as auteur_nom, c.photo_profil_compte as auteur_photo,
                           'categorie_preferee' as source_recommandation, 3 as priorite
                    FROM ARTICLES_BLOG_PLATEFORME a
                    LEFT JOIN COMPTES c ON c.id = a.auteur_id
                    WHERE a.statut = 'PUBLIE' AND a.est_archive = FALSE
            `;

            const params = [];
            let pi = 1;

            if (categoriesPreferees.length > 0) {
                query += ` AND a.categorie_principale = ANY($${pi}::categories_article[])`;
                params.push(categoriesPreferees);
                pi++;
            }

            if (categoriesExclues.length > 0) {
                query += ` AND a.categorie_principale != ALL($${pi}::categories_article[])`;
                params.push(categoriesExclues);
                pi++;
            }

            query += `
                    UNION ALL
                    -- Articles des auteurs préférés
                    SELECT a.*, c.nom_utilisateur_compte, c.photo_profil_compte,
                           'auteur_prefere', 2
                    FROM ARTICLES_BLOG_PLATEFORME a
                    LEFT JOIN COMPTES c ON c.id = a.auteur_id
                    WHERE a.statut = 'PUBLIE' AND a.est_archive = FALSE
            `;

            if (auteursPreferes.length > 0) {
                query += ` AND a.auteur_id = ANY($${pi}::int[])`;
                params.push(auteursPreferes);
                pi++;
            } else {
                query += ` AND FALSE`; // Pas d'auteurs préférés = pas de résultats ici
            }

            query += `
                    UNION ALL
                    -- Articles populaires récents
                    SELECT a.*, c.nom_utilisateur_compte, c.photo_profil_compte,
                           'populaire', 1
                    FROM ARTICLES_BLOG_PLATEFORME a
                    LEFT JOIN COMPTES c ON c.id = a.auteur_id
                    WHERE a.statut = 'PUBLIE' AND a.est_archive = FALSE
                      AND a.date_publication > NOW() - INTERVAL '7 days'
                ) AS feed
                ORDER BY priorite DESC, date_publication DESC
                LIMIT $${pi} OFFSET $${pi + 1}
            `;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);

            // Enrichir avec le statut utilisateur
            await this.enrichWithUserData(result.rows, req.user.id);

            res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: result.rows.length,
                    pages: Math.ceil(result.rows.length / parseInt(limit))
                }
            });

        } catch (error) {
            next(error);
        }
    }

    // ========================================================================
    // MÉTHODES PRIVÉES
    // ========================================================================

    /**
     * Génère des recommandations personnalisées basées sur l'historique
     */
    async getPersonalizedRecommendations(userId, limit, offset, categorie, excludeIds) {
        const excludeList = excludeIds ? excludeIds.split(',').map(Number) : [];

        // Récupérer les préférences utilisateur
        const preferences = await db.query(
            'SELECT * FROM PREFERENCES_RECOMMANDATION WHERE compte_id = $1',
            [userId]
        );

        // Récupérer l'historique de lecture
        const historiques = await db.query(
            `SELECT DISTINCT a.categorie_principale, a.auteur_id
             FROM ANALYTIQUES_LECTURE al
             JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = al.article_id
             WHERE al.compte_id = $1 AND al.pourcentage_lu >= 50
             LIMIT 50`,
            [userId]
        );

        // Catégories et auteurs préférés
        const categoriesLues = [...new Set(historiques.rows.map(r => r.categorie_principale))];
        const auteursLus = [...new Set(historiques.rows.map(r => r.auteur_id))];

        let query = `
            SELECT 
                a.*,
                c.nom_utilisateur_compte as auteur_nom,
                c.photo_profil_compte as auteur_photo,
                (
                    CASE 
                        WHEN a.categorie_principale = ANY($2::categories_article[]) THEN 50 
                        ELSE 0 
                    END +
                    CASE 
                        WHEN a.auteur_id = ANY($3::int[]) THEN 30 
                        ELSE 0 
                    END +
                    COALESCE(a.nombre_vues, 0) * 0.01 +
                    COALESCE(a.nombre_likes, 0) * 0.1 +
                    COALESCE(a.nombre_favoris, 0) * 0.5
                ) as score_recommandation,
                COUNT(*) OVER() as total_count
            FROM ARTICLES_BLOG_PLATEFORME a
            LEFT JOIN COMPTES c ON c.id = a.auteur_id
            WHERE a.statut = 'PUBLIE'
              AND a.est_archive = FALSE
              AND a.id NOT IN (
                  SELECT article_id FROM ANALYTIQUES_LECTURE 
                  WHERE compte_id = $1 AND pourcentage_lu >= 80
              )
        `;

        const params = [userId, categoriesLues, auteursLus];
        let paramIndex = 4;

        // Exclure certains IDs
        if (excludeList.length > 0) {
            query += ` AND a.id != ALL($${paramIndex}::int[])`;
            params.push(excludeList);
            paramIndex++;
        }

        // Filtrer par catégorie
        if (categorie) {
            query += ` AND a.categorie_principale = $${paramIndex}`;
            params.push(categorie);
            paramIndex++;
        }

        // Exclure les catégories non désirées
        if (preferences.rows[0]?.categories_exclues?.length > 0) {
            query += ` AND a.categorie_principale != ALL($${paramIndex}::categories_article[])`;
            params.push(preferences.rows[0].categories_exclues);
            paramIndex++;
        }

        query += `
            ORDER BY score_recommandation DESC, a.date_publication DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        params.push(limit, offset);

        const result = await db.query(query, params);
        return result.rows;
    }

    /**
     * Génère des recommandations populaires (pour non-connectés)
     */
    async getPopularRecommendations(limit, offset, categorie) {
        let query = `
            SELECT 
                a.*,
                c.nom_utilisateur_compte as auteur_nom,
                c.photo_profil_compte as auteur_photo,
                (a.nombre_vues * 0.01 + a.nombre_likes * 0.3 + a.nombre_favoris * 0.5) as score_popularite,
                COUNT(*) OVER() as total_count
            FROM ARTICLES_BLOG_PLATEFORME a
            LEFT JOIN COMPTES c ON c.id = a.auteur_id
            WHERE a.statut = 'PUBLIE'
              AND a.est_archive = FALSE
        `;

        const params = [];
        let paramIndex = 1;

        if (categorie) {
            query += ` AND a.categorie_principale = $${paramIndex}`;
            params.push(categorie);
            paramIndex++;
        }

        query += `
            ORDER BY score_popularite DESC, a.date_publication DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        params.push(limit, offset);

        const result = await db.query(query, params);
        return result.rows;
    }

    /**
     * Enrichit les articles avec les données utilisateur (likes, favoris, progression)
     */
    async enrichWithUserData(articles, userId) {
        if (!articles.length) return;

        const articleIds = articles.map(a => a.id);

        // Récupérer les likes
        const likes = await db.query(
            `SELECT article_id, type_like FROM LIKES_ARTICLES 
             WHERE article_id = ANY($1::int[]) AND compte_id = $2`,
            [articleIds, userId]
        );
        const likesMap = new Map();
        for (const l of likes.rows) likesMap.set(l.article_id, l.type_like);

        // Récupérer les favoris
        const favoris = await db.query(
            `SELECT article_id FROM FAVORIS_ARTICLES 
             WHERE article_id = ANY($1::int[]) AND compte_id = $2`,
            [articleIds, userId]
        );
        const favorisSet = new Set(favoris.rows.map(f => f.article_id));

        // Récupérer la progression
        const progression = await db.query(
            `SELECT article_id, pourcentage_lu, est_termine FROM ANALYTIQUES_LECTURE 
             WHERE article_id = ANY($1::int[]) AND compte_id = $2`,
            [articleIds, userId]
        );
        const progressionMap = new Map();
        for (const p of progression.rows) progressionMap.set(p.article_id, p);

        // Appliquer aux articles
        for (const article of articles) {
            article.user_like = likesMap.get(article.id) || null;
            article.is_favorite = favorisSet.has(article.id);
            article.progression = progressionMap.get(article.id)?.pourcentage_lu || 0;
            article.est_termine = progressionMap.get(article.id)?.est_termine || false;
        }
    }

    /**
     * Construit une requête de recherche à partir d'un titre et de mots-clés
     */
    buildSearchQuery(titre, motsCles) {
        const termes = [];
        if (titre) {
            termes.push(...titre.split(/\s+/).filter(w => w.length > 2).slice(0, 5));
        }
        if (motsCles?.length) {
            termes.push(...motsCles.slice(0, 3));
        }
        return termes.join(' | ');
    }
}

module.exports = new RecommendationController();