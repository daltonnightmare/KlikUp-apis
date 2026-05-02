// src/controllers/blog/PartageController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');
const CacheService = require('../../services/cache/CacheService');
const NotificationService = require('../../services/notification/NotificationService');

class PartageController {

    /**
     * Enregistrer un partage d'article
     * @route POST /api/v1/blog/articles/:articleId/partager
     */
    async share(req, res, next) {
        const client = await db.getClient();
        
        try {
            await client.query('BEGIN');
            
            const { articleId } = req.params;
            const { 
                type_partage, 
                message_personnel,
                destinataires_count = 1  // Nombre de personnes avec qui on partage
            } = req.body;

            // ✅ Validation du type de partage
            const typesValides = [
                'FACEBOOK', 'TWITTER', 'LINKEDIN', 'WHATSAPP', 'TELEGRAM',
                'EMAIL', 'COPY_LINK', 'INSTAGRAM', 'TIKTOK', 'NATIVE_SHARE',
                'SMS', 'MESSENGER', 'SNAPCHAT', 'REDDIT', 'PINTEREST'
            ];

            if (!typesValides.includes(type_partage)) {
                throw new ValidationError(`Type de partage invalide. Types acceptés: ${typesValides.join(', ')}`);
            }

            // ✅ Vérifier que l'article existe et est publié
            const article = await client.query(
                `SELECT id, titre_article, auteur_id, slug, nombre_partages
                 FROM ARTICLES_BLOG_PLATEFORME 
                 WHERE id = $1 AND statut = 'PUBLIE'`,
                [articleId]
            );

            if (article.rows.length === 0) {
                throw new NotFoundError('Article non trouvé ou non publié');
            }

            const articleData = article.rows[0];

            // ✅ Vérifier la limite anti-spam (max 50 partages/heure par utilisateur)
            if (req.user) {
                const recentShares = await client.query(
                    `SELECT COUNT(*) as count FROM PARTAGES_ARTICLES 
                     WHERE compte_id = $1 AND date_partage > NOW() - INTERVAL '1 hour'`,
                    [req.user.id]
                );

                if (parseInt(recentShares.rows[0].count) >= 50) {
                    throw new ValidationError('Limite de partages atteinte. Réessayez plus tard.');
                }
            }

            // ✅ Enregistrer le partage avec données enrichies
            const result = await client.query(
                `INSERT INTO PARTAGES_ARTICLES (
                    article_id, compte_id, type_partage, adresse_ip, 
                    message_personnel, user_agent, referer, session_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *`,
                [
                    articleId,
                    req.user?.id || null,
                    type_partage,
                    req.ip,
                    message_personnel || null,
                    req.headers['user-agent'] || null,
                    req.headers['referer'] || null,
                    req.session?.id || null
                ]
            );

            // ✅ Incrémenter le compteur de partages
            await client.query(
                `UPDATE ARTICLES_BLOG_PLATEFORME 
                 SET nombre_partages = nombre_partages + 1 
                 WHERE id = $1`,
                [articleId]
            );

            // ✅ Notifier l'auteur pour les jalons de partages
            const newCount = parseInt(articleData.nombre_partages) + 1;
            const jalons = [10, 50, 100, 500, 1000, 5000, 10000];
            
            if (jalons.includes(newCount) && articleData.auteur_id !== req.user?.id) {
                setImmediate(() => {
                    NotificationService.send({
                        destinataire_id: articleData.auteur_id,
                        type: 'PARTAGE_MILESTONE',
                        titre: '🚀 Article viral !',
                        corps: `Votre article "${articleData.titre_article}" a été partagé ${newCount} fois !`,
                        entite_source_type: 'ARTICLE_BLOG',
                        entite_source_id: articleId,
                        priorite: 'HAUTE'
                    }).catch(() => {});
                });
            }

            // ✅ Vérifier les badges de partage
            if (req.user) {
                setImmediate(() => {
                    this.verifierBadgesPartage(req.user.id, client).catch(() => {});
                });
            }

            await client.query('COMMIT');

            // ✅ Générer les URLs de partage
            const articleUrl = `${process.env.BASE_URL || 'https://votreplateforme.com'}/blog/${articleData.slug || articleId}`;
            const shareUrls = this.generateShareUrls(type_partage, articleUrl, articleData.titre_article, message_personnel);

            // ✅ Invalider le cache
            CacheService.invalidatePattern(`blog:article:${articleId}:*`).catch(() => {});
            CacheService.del(`blog:article:${articleId}:partages:stats`).catch(() => {});

            res.status(201).json({
                success: true,
                data: {
                    partage: result.rows[0],
                    article_url: articleUrl,
                    share_urls: shareUrls,
                    nombre_partages: newCount
                },
                message: 'Partage enregistré avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les statistiques de partage d'un article
     * @route GET /api/v1/blog/articles/:articleId/partages/stats
     */
    async getShareStats(req, res, next) {
        try {
            const { articleId } = req.params;
            const { periode } = req.query;

            const cacheKey = `blog:article:${articleId}:partages:stats:${periode || 'all'}`;
            const cached = await CacheService.get(cacheKey);
            if (cached && req.query.skip_cache !== 'true') {
                return res.json({ success: true, data: cached, fromCache: true });
            }

            let dateFilter = '';
            if (periode === '24h') dateFilter = "AND p.date_partage > NOW() - INTERVAL '24 hours'";
            else if (periode === '7d') dateFilter = "AND p.date_partage > NOW() - INTERVAL '7 days'";
            else if (periode === '30d') dateFilter = "AND p.date_partage > NOW() - INTERVAL '30 days'";

            // ✅ Statistiques par plateforme
            const statsByPlatform = await db.query(
                `SELECT 
                    p.type_partage,
                    COUNT(*) as nombre,
                    COUNT(DISTINCT p.compte_id) as utilisateurs_uniques,
                    COUNT(*) FILTER (WHERE p.compte_id IS NOT NULL) as connectes,
                    COUNT(*) FILTER (WHERE p.compte_id IS NULL) as anonymes
                 FROM PARTAGES_ARTICLES p
                 WHERE p.article_id = $1 ${dateFilter}
                 GROUP BY p.type_partage
                 ORDER BY nombre DESC`,
                [articleId]
            );

            // ✅ Statistiques temporelles (évolution par jour)
            const statsByTime = await db.query(
                `SELECT 
                    DATE(p.date_partage) as date,
                    COUNT(*) as nombre,
                    COUNT(DISTINCT p.compte_id) as utilisateurs_uniques
                 FROM PARTAGES_ARTICLES p
                 WHERE p.article_id = $1 ${dateFilter}
                 GROUP BY DATE(p.date_partage)
                 ORDER BY date DESC
                 LIMIT 30`,
                [articleId]
            );

            // ✅ Top partageurs
            const topSharers = await db.query(
                `SELECT 
                    p.compte_id,
                    c.nom_utilisateur_compte,
                    c.photo_profil_compte,
                    COUNT(*) as nombre_partages,
                    COUNT(DISTINCT p.type_partage) as plateformes_utilisees
                 FROM PARTAGES_ARTICLES p
                 LEFT JOIN COMPTES c ON c.id = p.compte_id
                 WHERE p.article_id = $1 AND p.compte_id IS NOT NULL ${dateFilter}
                 GROUP BY p.compte_id, c.nom_utilisateur_compte, c.photo_profil_compte
                 ORDER BY nombre_partages DESC
                 LIMIT 10`,
                [articleId]
            );

            // ✅ Données démographiques (pays/villes si IP géolocalisée)
            const geoStats = await db.query(
                `SELECT 
                    COALESCE(ip_data.pays, 'Inconnu') as pays,
                    COUNT(*) as nombre
                 FROM PARTAGES_ARTICLES p
                 LEFT JOIN LATERAL (
                     SELECT pays FROM GEO_IP WHERE ip_range >>= p.adresse_ip LIMIT 1
                 ) ip_data ON TRUE
                 WHERE p.article_id = $1 ${dateFilter}
                 GROUP BY ip_data.pays
                 ORDER BY nombre DESC
                 LIMIT 10`,
                [articleId]
            );

            // ✅ Appareils utilisés pour partager
            const deviceStats = await db.query(
                `SELECT 
                    CASE 
                        WHEN p.user_agent ILIKE '%Mobile%' OR p.user_agent ILIKE '%Android%' OR p.user_agent ILIKE '%iPhone%' THEN 'MOBILE'
                        WHEN p.user_agent ILIKE '%Tablet%' OR p.user_agent ILIKE '%iPad%' THEN 'TABLETTE'
                        ELSE 'DESKTOP'
                    END as appareil,
                    COUNT(*) as nombre
                 FROM PARTAGES_ARTICLES p
                 WHERE p.article_id = $1 ${dateFilter}
                 GROUP BY appareil
                 ORDER BY nombre DESC`,
                [articleId]
            );

            // ✅ Total
            const totalResult = await db.query(
                `SELECT 
                    COUNT(*) as total_partages,
                    COUNT(DISTINCT compte_id) as total_partageurs,
                    COUNT(DISTINCT type_partage) as plateformes_differentes
                 FROM PARTAGES_ARTICLES 
                 WHERE article_id = $1 ${dateFilter}`,
                [articleId]
            );

            const responseData = {
                success: true,
                data: {
                    total: {
                        partages: parseInt(totalResult.rows[0]?.total_partages || 0),
                        partageurs_uniques: parseInt(totalResult.rows[0]?.total_partageurs || 0),
                        plateformes: parseInt(totalResult.rows[0]?.plateformes_differentes || 0)
                    },
                    par_plateforme: statsByPlatform.rows,
                    evolution: statsByTime.rows,
                    top_partageurs: topSharers.rows,
                    geographie: geoStats.rows,
                    appareils: deviceStats.rows
                }
            };

            CacheService.set(cacheKey, responseData, 300).catch(() => {});
            res.json(responseData);

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les statistiques globales de partage
     * @route GET /api/v1/blog/partages/stats/globales
     */
    async getGlobalStats(req, res, next) {
        try {
            const { periode = '30d' } = req.query;

            const cacheKey = `blog:partages:global:${periode}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) return res.json({ success: true, data: cached, fromCache: true });

            let dateFilter = '';
            if (periode === '24h') dateFilter = "WHERE date_partage > NOW() - INTERVAL '24 hours'";
            else if (periode === '7d') dateFilter = "WHERE date_partage > NOW() - INTERVAL '7 days'";
            else if (periode === '30d') dateFilter = "WHERE date_partage > NOW() - INTERVAL '30 days'";

            // Plateformes les plus utilisées
            const platforms = await db.query(
                `SELECT type_partage, COUNT(*) as nombre, 
                        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pourcentage
                 FROM PARTAGES_ARTICLES ${dateFilter}
                 GROUP BY type_partage ORDER BY nombre DESC`
            );

            // Articles les plus partagés
            const topArticles = await db.query(
                `SELECT a.id, a.titre_article, a.slug, COUNT(p.id) as nombre_partages
                 FROM PARTAGES_ARTICLES p
                 JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = p.article_id
                 ${dateFilter.replace('WHERE', 'AND')}
                 GROUP BY a.id, a.titre_article, a.slug
                 ORDER BY nombre_partages DESC LIMIT 10`
            );

            // Heures de pointe
            const peakHours = await db.query(
                `SELECT EXTRACT(HOUR FROM date_partage) as heure, COUNT(*) as nombre
                 FROM PARTAGES_ARTICLES ${dateFilter}
                 GROUP BY EXTRACT(HOUR FROM date_partage)
                 ORDER BY nombre DESC LIMIT 5`
            );

            const responseData = {
                success: true,
                data: {
                    plateformes: platforms.rows,
                    articles_top: topArticles.rows,
                    heures_pointe: peakHours.rows
                }
            };

            CacheService.set(cacheKey, responseData, 600).catch(() => {});
            res.json(responseData);

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer l'historique des partages d'un utilisateur
     * @route GET /api/v1/blog/partages/historique
     */
    async getMyShareHistory(req, res, next) {
        try {
            if (!req.user) {
                return res.json({ success: true, data: [], message: 'Non connecté' });
            }

            const { page = 1, limit = 20 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            const result = await db.query(
                `SELECT p.*, a.titre_article, a.slug, a.image_principale,
                        COUNT(*) OVER() as total_count
                 FROM PARTAGES_ARTICLES p
                 JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = p.article_id
                 WHERE p.compte_id = $1
                 ORDER BY p.date_partage DESC
                 LIMIT $2 OFFSET $3`,
                [req.user.id, parseInt(limit), offset]
            );

            const total = result.rows[0]?.total_count || 0;

            // Statistiques personnelles
            const myStats = await db.query(
                `SELECT 
                    COUNT(*) as total_partages,
                    COUNT(DISTINCT type_partage) as plateformes_utilisees,
                    COUNT(DISTINCT article_id) as articles_partages,
                    COUNT(*) FILTER (WHERE date_partage > NOW() - INTERVAL '30 days') as partages_mois
                 FROM PARTAGES_ARTICLES
                 WHERE compte_id = $1`,
                [req.user.id]
            );

            res.json({
                success: true,
                data: {
                    historique: result.rows,
                    stats: myStats.rows[0]
                },
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
     * Vérifier le statut de partage pour plusieurs articles
     * @route POST /api/v1/blog/partages/check-batch
     */
    async checkBatchPartages(req, res, next) {
        try {
            const { article_ids } = req.body;
            if (!article_ids || !Array.isArray(article_ids)) {
                throw new ValidationError('Liste d\'IDs requise');
            }
            if (article_ids.length > 100) throw new ValidationError('Max 100 articles');

            const result = await db.query(
                `SELECT article_id, COUNT(*) as total_partages
                 FROM PARTAGES_ARTICLES
                 WHERE article_id = ANY($1::int[])
                 GROUP BY article_id`,
                [article_ids]
            );

            const statusMap = {};
            for (const id of article_ids) {
                statusMap[id] = { total_partages: 0 };
            }
            for (const row of result.rows) {
                statusMap[row.article_id] = { total_partages: parseInt(row.total_partages) };
            }

            res.json({ success: true, data: statusMap });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les articles les plus partagés
     * @route GET /api/v1/blog/partages/top
     */
    async getTopSharedArticles(req, res, next) {
        try {
            const { periode = '7d', limit = 10, categorie } = req.query;

            const cacheKey = `blog:partages:top:${periode}:${limit}:${categorie || 'all'}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) return res.json({ success: true, data: cached, fromCache: true });

            let dateFilter = "p.date_partage > NOW() - INTERVAL '7 days'";
            if (periode === '24h') dateFilter = "p.date_partage > NOW() - INTERVAL '24 hours'";
            else if (periode === '30d') dateFilter = "p.date_partage > NOW() - INTERVAL '30 days'";

            let query = `
                SELECT a.*, c.nom_utilisateur_compte as auteur_nom,
                       COUNT(p.id) as nombre_partages,
                       COUNT(DISTINCT p.type_partage) as plateformes_differentes
                FROM PARTAGES_ARTICLES p
                JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = p.article_id
                LEFT JOIN COMPTES c ON c.id = a.auteur_id
                WHERE ${dateFilter} AND a.statut = 'PUBLIE' AND a.est_archive = FALSE
            `;

            const params = [];
            let pi = 1;

            if (categorie) {
                query += ` AND a.categorie_principale = $${pi}`;
                params.push(categorie);
                pi++;
            }

            query += ` GROUP BY a.id, c.nom_utilisateur_compte ORDER BY nombre_partages DESC LIMIT $${pi}`;
            params.push(parseInt(limit));

            const result = await db.query(query, params);
            CacheService.set(cacheKey, result.rows, 300).catch(() => {});

            res.json({ success: true, data: result.rows, periode });

        } catch (error) {
            next(error);
        }
    }

    // ========================================================================
    // MÉTHODES PRIVÉES
    // ========================================================================

    /**
     * Génère les URLs de partage pour différentes plateformes
     */
    generateShareUrls(platform, url, title, message) {
        const encodedUrl = encodeURIComponent(url);
        const encodedTitle = encodeURIComponent(title || '');
        const encodedMessage = encodeURIComponent(message || title || '');
        const baseUrl = process.env.BASE_URL || 'https://votreplateforme.com';
        const hashtags = encodeURIComponent('blog,article,plateforme');

        const urls = {
            FACEBOOK: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedMessage}`,
            TWITTER: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedMessage}&hashtags=${hashtags}`,
            LINKEDIN: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
            WHATSAPP: `https://wa.me/?text=${encodedMessage}%20${encodedUrl}`,
            TELEGRAM: `https://t.me/share/url?url=${encodedUrl}&text=${encodedMessage}`,
            EMAIL: `mailto:?subject=${encodedTitle}&body=${encodedMessage}%0A%0A${encodedUrl}`,
            REDDIT: `https://reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}`,
            PINTEREST: `https://pinterest.com/pin/create/button/?url=${encodedUrl}&description=${encodedMessage}`,
            COPY_LINK: url,
            NATIVE_SHARE: url
        };

        return {
            [platform]: urls[platform] || url,
            all_urls: urls
        };
    }

    /**
     * Vérifie et attribue les badges de partage
     */
    async verifierBadgesPartage(userId, client) {
        try {
            const count = await client.query(
                'SELECT COUNT(*) as count FROM PARTAGES_ARTICLES WHERE compte_id = $1',
                [userId]
            );
            const total = parseInt(count.rows[0].count);

            // Badge : Premier partage
            if (total === 1) {
                await client.query(
                    `INSERT INTO BADGES_UTILISATEUR (compte_id, badge_id)
                     SELECT $1, id FROM BADGES_LECTURE WHERE nom_badge = 'Partageur'
                     ON CONFLICT DO NOTHING`,
                    [userId]
                );
            }

            // Badge : 100 partages
            if (total === 100) {
                const badge = await client.query(
                    `SELECT id FROM BADGES_LECTURE WHERE nom_badge = 'Super partageur'`
                );
                if (badge.rows.length > 0) {
                    await client.query(
                        `INSERT INTO BADGES_UTILISATEUR (compte_id, badge_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                        [userId, badge.rows[0].id]
                    );
                }
            }
        } catch (error) {
            console.error('Erreur badges partage:', error);
        }
    }
}

module.exports = new PartageController();