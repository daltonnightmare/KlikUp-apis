// src/controllers/blog/ArticleController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError, AuthorizationError } = require('../../utils/errors/AppError');
const { validateSlug, generateSlug } = require('../../utils/helpers/string.helper');
const NotificationService = require('../../services/notification/NotificationService');
const AuditService = require('../../services/audit/AuditService');
const CacheService = require('../../services/cache/CacheService');
const FileService = require('../../services/file/FileService');

class ArticleController {
    /**
     * Créer un nouvel article
     * @route POST /api/v1/blog/articles
     */
    async create(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const {
                titre_article,
                sous_titre,
                contenu_article,
                extrait_contenu,
                langue = 'fr',
                image_principale,
                image_secondaire,
                video_url,
                gallery_images,
                documents_joints,
                meta_titre,
                meta_description,
                mots_cles,
                categorie_principale,
                categories_secondaires,
                visibilite = 'PUBLIC',
                est_epingle = false,
                est_commentaire_actif = true,
                date_programmation,
                co_auteurs,
                plateforme_id,
                compagnie_id,
                emplacement_transport_id,
                restaurant_id,
                emplacement_restaurant_id,
                boutique_id,
                produit_boutique_id,
                menu_id,
                promo_id,
                est_disponible_hors_ligne = false,
                droit_lecture_minimum_role,
                mot_de_passe_protege,
                redirection_url
            } = req.body;

            // Validation des données
            if (!titre_article || !contenu_article || !categorie_principale) {
                throw new ValidationError('Titre, contenu et catégorie principale sont requis');
            }

            // Génération du slug
            const slug = generateSlug(titre_article);
            
            // Vérification unicité du slug
            const slugCheck = await client.query(
                'SELECT id FROM ARTICLES_BLOG_PLATEFORME WHERE slug = $1',
                [slug]
            );
            
            if (slugCheck.rows.length > 0) {
                throw new ValidationError('Un article avec ce titre existe déjà');
            }

            // Gestion des images uploadées
            let imagePrincipalePath = image_principale;
            let imageSecondairePath = image_secondaire;
            
            if (req.files) {
                if (req.files.image_principale) {
                    imagePrincipalePath = await FileService.uploadImage(
                        req.files.image_principale,
                        'blog/articles'
                    );
                }
                if (req.files.image_secondaire) {
                    imageSecondairePath = await FileService.uploadImage(
                        req.files.image_secondaire,
                        'blog/articles'
                    );
                }
            }

            // Insertion de l'article
            const result = await client.query(
                `INSERT INTO ARTICLES_BLOG_PLATEFORME (
                    titre_article, sous_titre, slug, contenu_article, extrait_contenu,
                    langue, image_principale, image_secondaire, video_url, gallery_images,
                    documents_joints, meta_titre, meta_description, mots_cles,
                    categorie_principale, categories_secondaires, statut, visibilite,
                    est_epingle, est_commentaire_actif, date_programmation, auteur_id,
                    co_auteurs, plateforme_id, compagnie_id, emplacement_transport_id,
                    restaurant_id, emplacement_restaurant_id, boutique_id,
                    produit_boutique_id, menu_id, promo_id, est_disponible_hors_ligne,
                    droit_lecture_minimum_role, mot_de_passe_protege, redirection_url
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                    CASE WHEN $17::timestamp IS NOT NULL THEN 'PROGRAMME' ELSE 'BROUILLON' END,
                    $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37
                ) RETURNING *`,
                [
                    titre_article, sous_titre, slug, contenu_article, extrait_contenu,
                    langue, imagePrincipalePath, imageSecondairePath, video_url,
                    JSON.stringify(gallery_images || []), JSON.stringify(documents_joints || []),
                    meta_titre, meta_description, mots_cles, categorie_principale,
                    categories_secondaires, date_programmation, visibilite,
                    est_epingle, est_commentaire_actif, date_programmation, req.user.id,
                    co_auteurs || [], plateforme_id, compagnie_id, emplacement_transport_id,
                    restaurant_id, emplacement_restaurant_id, boutique_id,
                    produit_boutique_id, menu_id, promo_id, est_disponible_hors_ligne,
                    droit_lecture_minimum_role, mot_de_passe_protege, redirection_url
                ]
            );

            const article = result.rows[0];

            // Journalisation
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'ARTICLE_BLOG',
                ressource_id: article.id,
                utilisateur_id: req.user.id,
                donnees_apres: article
            });

            // Invalidation du cache
            await CacheService.invalidatePattern('blog:articles:*');

            // Notification aux abonnés si programmé
            if (article.statut === 'PROGRAMME') {
                await this.notifySubscribers(article, client);
            }

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: article,
                message: 'Article créé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer tous les articles avec filtres
     * @route GET /api/v1/blog/articles
     */
    async findAll(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                categorie,
                statut,
                auteur_id,
                recherche,
                date_debut,
                date_fin,
                tags,
                visibilite,
                est_epingle,
                tri = 'date_publication_desc',
                include_brouillons = false
            } = req.query;

            const offset = (page - 1) * limit;
            
            // Construction de la requête
            let query = `
                SELECT a.*, 
                       c.nom_utilisateur_compte as auteur_nom,
                       c.photo_profil_compte as auteur_photo,
                       COUNT(*) OVER() as total_count
                FROM ARTICLES_BLOG_PLATEFORME a
                LEFT JOIN COMPTES c ON c.id = a.auteur_id
                WHERE 1=1
            `;
            
            const params = [];
            let paramIndex = 1;

            // Filtres de sécurité (ne pas montrer les brouillons des autres)
            if (!include_brouillons && req.user?.role !== 'ADMINISTRATEUR_PLATEFORME') {
                query += ` AND (a.statut != 'BROUILLON' OR a.auteur_id = $${paramIndex})`;
                params.push(req.user?.id || 0);
                paramIndex++;
            }

            // Filtres optionnels
            if (categorie) {
                query += ` AND a.categorie_principale = $${paramIndex}`;
                params.push(categorie);
                paramIndex++;
            }

            if (statut) {
                query += ` AND a.statut = $${paramIndex}`;
                params.push(statut);
                paramIndex++;
            }

            if (auteur_id) {
                query += ` AND a.auteur_id = $${paramIndex}`;
                params.push(auteur_id);
                paramIndex++;
            }

            if (est_epingle !== undefined) {
                query += ` AND a.est_epingle = $${paramIndex}`;
                params.push(est_epingle === 'true');
                paramIndex++;
            }

            if (visibilite) {
                query += ` AND a.visibilite = $${paramIndex}`;
                params.push(visibilite);
                paramIndex++;
            }

            if (recherche) {
                query += ` AND (a.titre_article ILIKE $${paramIndex} OR a.contenu_article ILIKE $${paramIndex})`;
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            if (date_debut) {
                query += ` AND a.date_creation >= $${paramIndex}`;
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                query += ` AND a.date_creation <= $${paramIndex}`;
                params.push(date_fin);
                paramIndex++;
            }

            if (tags) {
                const tagsArray = tags.split(',');
                query += ` AND a.mots_cles && $${paramIndex}::text[]`;
                params.push(tagsArray);
                paramIndex++;
            }

            // Tri
            const orderMap = {
                'date_publication_desc': 'a.date_publication DESC NULLS LAST',
                'date_publication_asc': 'a.date_publication ASC NULLS LAST',
                'date_creation_desc': 'a.date_creation DESC',
                'date_creation_asc': 'a.date_creation ASC',
                'titre_asc': 'a.titre_article ASC',
                'titre_desc': 'a.titre_article DESC',
                'popularite_desc': 'a.nombre_vues DESC, a.date_publication DESC',
                'notes_desc': '(SELECT AVG(note_globale) FROM AVIS WHERE entite_type = \'ARTICLE_BLOG\' AND entite_id = a.id) DESC'
            };

            query += ` ORDER BY ${orderMap[tri] || orderMap.date_publication_desc}`;
            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);

            // Enrichissement des données
            const articles = await Promise.all(result.rows.map(async (article) => {
                const enriched = { ...article };
                
                // Récupérer les stats supplémentaires
                const stats = await this.getArticleStats(article.id);
                enriched.stats = stats;
                
                // Vérifier si l'utilisateur connecté a liké
                if (req.user) {
                    const like = await db.query(
                        'SELECT type_like FROM LIKES_ARTICLES WHERE article_id = $1 AND compte_id = $2',
                        [article.id, req.user.id]
                    );
                    enriched.user_like = like.rows[0]?.type_like || null;
                }
                
                return enriched;
            }));

            const total = result.rows[0]?.total_count || 0;

            // Mise en cache
            await CacheService.set(
                `blog:articles:${page}:${limit}:${JSON.stringify(req.query)}`,
                { articles, total },
                300 // 5 minutes
            );

            res.json({
                success: true,
                data: articles,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer un article par son ID ou slug
     * @route GET /api/v1/blog/articles/:identifier
     */
    async findOne(req, res, next) {
        try {
            const { identifier } = req.params;
            const { increment_view = true } = req.query;

            // Vérification cache
            const cached = await CacheService.get(`blog:article:${identifier}`);
            if (cached) {
                return res.json({
                    success: true,
                    data: cached,
                    fromCache: true
                });
            }

            // Recherche par ID ou slug
            const isId = !isNaN(parseInt(identifier));
            const query = isId
                ? 'SELECT * FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1'
                : 'SELECT * FROM ARTICLES_BLOG_PLATEFORME WHERE slug = $1';

            const result = await db.query(query, [identifier]);

            if (result.rows.length === 0) {
                throw new NotFoundError('Article non trouvé');
            }

            const article = result.rows[0];

            // Vérification des droits d'accès
            await this.checkAccess(article, req.user);

            // Incrémenter le compteur de vues
            if (increment_view) {
                await db.query(
                    `UPDATE ARTICLES_BLOG_PLATEFORME 
                     SET nombre_vues = nombre_vues + 1,
                         nombre_vues_uniques = nombre_vues_uniques + 
                         CASE WHEN NOT EXISTS (
                             SELECT 1 FROM STATS_LECTURE_ARTICLES 
                             WHERE article_id = $1 AND compte_id = $2
                         ) THEN 1 ELSE 0 END
                     WHERE id = $1`,
                    [article.id, req.user?.id]
                );

                // Enregistrer la visite
                if (req.user) {
                    await db.query(
                        `INSERT INTO STATS_LECTURE_ARTICLES 
                         (article_id, compte_id, adresse_ip, user_agent, session_id)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [article.id, req.user.id, req.ip, req.headers['user-agent'], req.session?.id]
                    );
                }
            }

            // Récupérer les données enrichies
            const enriched = {
                ...article,
                stats: await this.getArticleStats(article.id),
                commentaires: await this.getArticleComments(article.id, req.user),
                articles_similaires: await this.getSimilarArticles(article, req.user)
            };

            // Mise en cache
            await CacheService.set(`blog:article:${identifier}`, enriched, 600); // 10 minutes

            res.json({
                success: true,
                data: enriched
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Mettre à jour un article
     * @route PUT /api/v1/blog/articles/:id
     */
    async update(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const updateData = { ...req.body };

            // Vérifier existence et droits
            const article = await client.query(
                'SELECT * FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                [id]
            );

            if (article.rows.length === 0) {
                throw new NotFoundError('Article non trouvé');
            }

            const existingArticle = article.rows[0];

            // Vérifier les droits de modification
            if (!this.canModify(existingArticle, req.user)) {
                throw new AuthorizationError('Vous n\'avez pas les droits pour modifier cet article');
            }

            // Si le titre change, régénérer le slug
            if (updateData.titre_article && updateData.titre_article !== existingArticle.titre_article) {
                updateData.slug = generateSlug(updateData.titre_article);
                
                // Vérifier unicité
                const slugCheck = await client.query(
                    'SELECT id FROM ARTICLES_BLOG_PLATEFORME WHERE slug = $1 AND id != $2',
                    [updateData.slug, id]
                );
                
                if (slugCheck.rows.length > 0) {
                    throw new ValidationError('Un article avec ce titre existe déjà');
                }
            }

            // Gestion des fichiers uploadés
            if (req.files) {
                if (req.files.image_principale) {
                    updateData.image_principale = await FileService.uploadImage(
                        req.files.image_principale,
                        'blog/articles'
                    );
                    // Supprimer l'ancienne image
                    if (existingArticle.image_principale) {
                        await FileService.delete(existingArticle.image_principale);
                    }
                }
                if (req.files.image_secondaire) {
                    updateData.image_secondaire = await FileService.uploadImage(
                        req.files.image_secondaire,
                        'blog/articles'
                    );
                    if (existingArticle.image_secondaire) {
                        await FileService.delete(existingArticle.image_secondaire);
                    }
                }
            }

            // Construction de la requête UPDATE dynamique
            const setClauses = [];
            const values = [id];
            let valueIndex = 2;

            const allowedFields = [
                'titre_article', 'sous_titre', 'slug', 'contenu_article', 'extrait_contenu',
                'langue', 'image_principale', 'image_secondaire', 'video_url', 'gallery_images',
                'documents_joints', 'meta_titre', 'meta_description', 'mots_cles',
                'categorie_principale', 'categories_secondaires', 'visibilite',
                'est_epingle', 'est_commentaire_actif', 'date_programmation',
                'co_auteurs', 'est_disponible_hors_ligne', 'droit_lecture_minimum_role',
                'mot_de_passe_protege', 'redirection_url', 'statut'
            ];

            for (const field of allowedFields) {
                if (updateData[field] !== undefined) {
                    setClauses.push(`${field} = $${valueIndex}`);
                    
                    // Traitement spécial pour les JSON
                    if (['gallery_images', 'documents_joints', 'co_auteurs', 'mots_cles'].includes(field)) {
                        values.push(JSON.stringify(updateData[field]));
                    } else {
                        values.push(updateData[field]);
                    }
                    
                    valueIndex++;
                }
            }

            setClauses.push('date_modification = NOW()');

            const updateQuery = `
                UPDATE ARTICLES_BLOG_PLATEFORME 
                SET ${setClauses.join(', ')}
                WHERE id = $1
                RETURNING *
            `;

            const result = await client.query(updateQuery, values);
            const updatedArticle = result.rows[0];

            // Journalisation
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'ARTICLE_BLOG',
                ressource_id: id,
                utilisateur_id: req.user.id,
                donnees_avant: existingArticle,
                donnees_apres: updatedArticle
            });

            // Invalidation du cache
            await CacheService.del(`blog:article:${id}`);
            await CacheService.del(`blog:article:${existingArticle.slug}`);
            await CacheService.invalidatePattern('blog:articles:*');

            await client.query('COMMIT');

            res.json({
                success: true,
                data: updatedArticle,
                message: 'Article mis à jour avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer un article (soft delete)
     * @route DELETE /api/v1/blog/articles/:id
     */
    async delete(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;

            // Vérifier existence et droits
            const article = await client.query(
                'SELECT * FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                [id]
            );

            if (article.rows.length === 0) {
                throw new NotFoundError('Article non trouvé');
            }

            const existingArticle = article.rows[0];

            if (!this.canDelete(existingArticle, req.user)) {
                throw new AuthorizationError('Vous n\'avez pas les droits pour supprimer cet article');
            }

            // Soft delete
            await client.query(
                `UPDATE ARTICLES_BLOG_PLATEFORME 
                 SET statut = 'SUPPRIME', 
                     date_archivage = NOW(),
                     est_archive = true
                 WHERE id = $1`,
                [id]
            );

            // Journalisation
            await AuditService.log({
                action: 'DELETE',
                ressource_type: 'ARTICLE_BLOG',
                ressource_id: id,
                utilisateur_id: req.user.id,
                donnees_avant: existingArticle
            });

            // Invalidation du cache
            await CacheService.del(`blog:article:${id}`);
            await CacheService.del(`blog:article:${existingArticle.slug}`);
            await CacheService.invalidatePattern('blog:articles:*');

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Article supprimé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Publier un article (changement de statut)
     * @route POST /api/v1/blog/articles/:id/publish
     */
    async publish(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { date_publication } = req.body;

            const article = await client.query(
                'SELECT * FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                [id]
            );

            if (article.rows.length === 0) {
                throw new NotFoundError('Article non trouvé');
            }

            const existingArticle = article.rows[0];

            if (!this.canModify(existingArticle, req.user)) {
                throw new AuthorizationError('Vous n\'avez pas les droits pour publier cet article');
            }

            const result = await client.query(
                `UPDATE ARTICLES_BLOG_PLATEFORME 
                 SET statut = 'PUBLIE',
                     date_publication = COALESCE($1, NOW())
                 WHERE id = $2
                 RETURNING *`,
                [date_publication || new Date(), id]
            );

            const publishedArticle = result.rows[0];

            // Notification aux abonnés
            await this.notifySubscribers(publishedArticle, client);

            // Journalisation
            await AuditService.log({
                action: 'PUBLISH',
                ressource_type: 'ARTICLE_BLOG',
                ressource_id: id,
                utilisateur_id: req.user.id,
                donnees_apres: publishedArticle
            });

            // Invalidation du cache
            await CacheService.invalidatePattern('blog:articles:*');

            await client.query('COMMIT');

            res.json({
                success: true,
                data: publishedArticle,
                message: 'Article publié avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Archiver/Restaurer un article
     * @route PATCH /api/v1/blog/articles/:id/archive
     */
    async toggleArchive(req, res, next) {
        try {
            const { id } = req.params;
            const { archived } = req.body;

            const article = await db.query(
                'SELECT * FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                [id]
            );

            if (article.rows.length === 0) {
                throw new NotFoundError('Article non trouvé');
            }

            if (!this.canModify(article.rows[0], req.user)) {
                throw new AuthorizationError('Vous n\'avez pas les droits pour archiver cet article');
            }

            const result = await db.query(
                `UPDATE ARTICLES_BLOG_PLATEFORME 
                 SET est_archive = $1,
                     date_archivage = CASE WHEN $1 THEN NOW() ELSE NULL END
                 WHERE id = $2
                 RETURNING *`,
                [archived, id]
            );

            // Invalidation du cache
            await CacheService.invalidatePattern('blog:articles:*');

            res.json({
                success: true,
                data: result.rows[0],
                message: archived ? 'Article archivé' : 'Article restauré'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Épingler/Désépingler un article
     * @route PATCH /api/v1/blog/articles/:id/pin
     */
    async togglePin(req, res, next) {
        try {
            const { id } = req.params;
            const { pinned } = req.body;

            const result = await db.query(
                `UPDATE ARTICLES_BLOG_PLATEFORME 
                 SET est_epingle = $1
                 WHERE id = $2
                 RETURNING *`,
                [pinned, id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Article non trouvé');
            }

            // Invalidation du cache
            await CacheService.invalidatePattern('blog:articles:*');

            res.json({
                success: true,
                data: result.rows[0],
                message: pinned ? 'Article épinglé' : 'Article désépinglé'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les articles par catégorie
     * @route GET /api/v1/blog/articles/categorie/:categorie
     */
    async findByCategory(req, res, next) {
        try {
            const { categorie } = req.params;
            const { page = 1, limit = 20 } = req.query;

            const offset = (page - 1) * limit;

            const result = await db.query(
                `SELECT a.*, c.nom_utilisateur_compte as auteur_nom,
                        COUNT(*) OVER() as total_count
                 FROM ARTICLES_BLOG_PLATEFORME a
                 LEFT JOIN COMPTES c ON c.id = a.auteur_id
                 WHERE a.categorie_principale = $1
                   AND a.statut = 'PUBLIE'
                   AND a.est_archive = false
                 ORDER BY a.date_publication DESC
                 LIMIT $2 OFFSET $3`,
                [categorie, parseInt(limit), offset]
            );

            const total = result.rows[0]?.total_count || 0;

            res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les articles par auteur
     * @route GET /api/v1/blog/articles/auteur/:auteurId
     */
    async findByAuthor(req, res, next) {
        try {
            const { auteurId } = req.params;
            const { page = 1, limit = 20 } = req.query;

            const offset = (page - 1) * limit;

            const result = await db.query(
                `SELECT a.*, c.nom_utilisateur_compte as auteur_nom,
                        COUNT(*) OVER() as total_count
                 FROM ARTICLES_BLOG_PLATEFORME a
                 LEFT JOIN COMPTES c ON c.id = a.auteur_id
                 WHERE a.auteur_id = $1
                   AND a.statut = 'PUBLIE'
                   AND a.est_archive = false
                 ORDER BY a.date_publication DESC
                 LIMIT $2 OFFSET $3`,
                [auteurId, parseInt(limit), offset]
            );

            const total = result.rows[0]?.total_count || 0;

            res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Recherche avancée d'articles
     * @route POST /api/v1/blog/articles/search
     */
    async search(req, res, next) {
        try {
            const {
                query,
                categories,
                tags,
                date_debut,
                date_fin,
                auteur_id,
                note_min,
                tri = 'pertinence'
            } = req.body;

            const { page = 1, limit = 20 } = req.query;
            const offset = (page - 1) * limit;

            let sqlQuery = `
                SELECT DISTINCT a.*, 
                       c.nom_utilisateur_compte as auteur_nom,
                       ts_rank(to_tsvector('french', a.titre_article || ' ' || a.contenu_article), plainto_tsquery('french', $1)) as rank,
                       COUNT(*) OVER() as total_count
                FROM ARTICLES_BLOG_PLATEFORME a
                LEFT JOIN COMPTES c ON c.id = a.auteur_id
                WHERE a.statut = 'PUBLIE'
                  AND a.est_archive = false
            `;

            const params = [query || ''];
            let paramIndex = 2;

            if (query) {
                sqlQuery += ` AND (to_tsvector('french', a.titre_article || ' ' || a.contenu_article) @@ plainto_tsquery('french', $1))`;
            }

            if (categories && categories.length > 0) {
                sqlQuery += ` AND a.categorie_principale = ANY($${paramIndex})`;
                params.push(categories);
                paramIndex++;
            }

            if (tags && tags.length > 0) {
                sqlQuery += ` AND a.mots_cles && $${paramIndex}`;
                params.push(tags);
                paramIndex++;
            }

            if (date_debut) {
                sqlQuery += ` AND a.date_publication >= $${paramIndex}`;
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                sqlQuery += ` AND a.date_publication <= $${paramIndex}`;
                params.push(date_fin);
                paramIndex++;
            }

            if (auteur_id) {
                sqlQuery += ` AND a.auteur_id = $${paramIndex}`;
                params.push(auteur_id);
                paramIndex++;
            }

            if (note_min) {
                sqlQuery += ` AND a.id IN (
                    SELECT entite_id FROM AVIS 
                    WHERE entite_type = 'ARTICLE_BLOG' 
                    GROUP BY entite_id 
                    HAVING AVG(note_globale) >= $${paramIndex}
                )`;
                params.push(note_min);
                paramIndex++;
            }

            // Tri
            if (tri === 'pertinence' && query) {
                sqlQuery += ' ORDER BY rank DESC';
            } else if (tri === 'date_desc') {
                sqlQuery += ' ORDER BY a.date_publication DESC';
            } else if (tri === 'date_asc') {
                sqlQuery += ' ORDER BY a.date_publication ASC';
            } else if (tri === 'popularite') {
                sqlQuery += ' ORDER BY a.nombre_vues DESC';
            }

            sqlQuery += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(sqlQuery, params);
            const total = result.rows[0]?.total_count || 0;

            res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les articles populaires
     * @route GET /api/v1/blog/articles/populaires/top
     */
    async getPopularArticles(req, res, next) {
        try {
            const { periode = '7d', limit = 10 } = req.query;

            let dateFilter;
            switch (periode) {
                case '24h':
                    dateFilter = "NOW() - INTERVAL '24 hours'";
                    break;
                case '7d':
                    dateFilter = "NOW() - INTERVAL '7 days'";
                    break;
                case '30d':
                    dateFilter = "NOW() - INTERVAL '30 days'";
                    break;
                default:
                    dateFilter = "NOW() - INTERVAL '7 days'";
            }

            const result = await db.query(
                `SELECT a.*, 
                        COUNT(DISTINCT l.id) as likes_periode,
                        COUNT(DISTINCT c.id) as commentaires_periode,
                        COUNT(DISTINCT v.id) as vues_periode
                 FROM ARTICLES_BLOG_PLATEFORME a
                 LEFT JOIN LIKES_ARTICLES l ON l.article_id = a.id 
                    AND l.date_like >= ${dateFilter}
                 LEFT JOIN COMMENTAIRES c ON c.article_id = a.id 
                    AND c.date_creation >= ${dateFilter}
                 LEFT JOIN STATS_LECTURE_ARTICLES v ON v.article_id = a.id 
                    AND v.date_lecture >= ${dateFilter}
                 WHERE a.statut = 'PUBLIE'
                   AND a.est_archive = false
                 GROUP BY a.id
                 ORDER BY (COALESCE(COUNT(l.id), 0) * 3 + 
                          COALESCE(COUNT(c.id), 0) * 2 + 
                          COALESCE(COUNT(v.id), 0)) DESC
                 LIMIT $1`,
                [parseInt(limit)]
            );

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
     * Récupérer les statistiques d'un article
     * @route GET /api/v1/blog/articles/:id/stats
     */
    async getStats(req, res, next) {
        try {
            const { id } = req.params;
            const { periode = '30d' } = req.query;

            const stats = await this.getArticleStats(id, periode);

            res.json({
                success: true,
                data: stats
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Valider un article (pour modération)
     * @route POST /api/v1/blog/articles/:id/validate
     */
    async validate(req, res, next) {
        try {
            const { id } = req.params;
            const { statut, commentaire } = req.body;

            if (!['PUBLIE', 'REJETE'].includes(statut)) {
                throw new ValidationError('Statut de validation invalide');
            }

            const result = await db.query(
                `UPDATE ARTICLES_BLOG_PLATEFORME 
                 SET statut = $1,
                     valide_par = $2,
                     date_validation = NOW(),
                     commentaire_validation = $3
                 WHERE id = $4
                 RETURNING *`,
                [statut, req.user.id, commentaire, id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Article non trouvé');
            }

            // Notification à l'auteur
            await NotificationService.send({
                destinataire_id: result.rows[0].auteur_id,
                type: 'ARTICLE_VALIDATION',
                titre: `Article ${statut === 'PUBLIE' ? 'approuvé' : 'rejeté'}`,
                corps: `Votre article "${result.rows[0].titre_article}" a été ${statut === 'PUBLIE' ? 'approuvé' : 'rejeté'}.${commentaire ? ` Motif: ${commentaire}` : ''}`,
                entite_source_type: 'ARTICLE_BLOG',
                entite_source_id: id
            });

            res.json({
                success: true,
                data: result.rows[0],
                message: `Article ${statut === 'PUBLIE' ? 'validé' : 'rejeté'}`
            });

        } catch (error) {
            next(error);
        }
    }

    // ==================== Méthodes privées ====================

    /**
     * Vérifier les droits d'accès à un article
     */
    async checkAccess(article, user) {
        // Article public
        if (article.visibilite === 'PUBLIC') {
            return true;
        }

        // Utilisateur non connecté mais article privé
        if (!user) {
            throw new AuthorizationError('Authentification requise pour accéder à cet article');
        }

        // Visibilité ABONNES
        if (article.visibilite === 'ABONNES') {
            // Vérifier si l'utilisateur est abonné
            const abonne = await db.query(
                'SELECT 1 FROM ABONNEMENTS_BLOG WHERE compte_id = $1 AND actif = true',
                [user.id]
            );
            if (abonne.rows.length === 0) {
                throw new AuthorizationError('Abonnement requis pour accéder à cet article');
            }
        }

        // Visibilité PRIVE (auteur, co-auteurs, admins)
        if (article.visibilite === 'PRIVE') {
            const isAuthor = article.auteur_id === user.id;
            const isCoAuthor = article.co_auteurs && article.co_auteurs.includes(user.id);
            const isAdmin = ['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(user.compte_role);
            
            if (!isAuthor && !isCoAuthor && !isAdmin) {
                throw new AuthorizationError('Vous n\'avez pas accès à cet article privé');
            }
        }

        // Visibilité EQUIPE
        if (article.visibilite === 'EQUIPE') {
            const isStaff = ['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME', 'BLOGUEUR_PLATEFORME'].includes(user.compte_role);
            if (!isStaff) {
                throw new AuthorizationError('Réservé à l\'équipe');
            }
        }

        // Vérification du rôle minimum requis
        if (article.droit_lecture_minimum_role) {
            const roleHierarchy = {
                'UTILISATEUR_PRIVE_SIMPLE': 1,
                'BLOGUEUR_COMPAGNIE': 2,
                'STAFF_COMPAGNIE': 3,
                'ADMINISTRATEUR_COMPAGNIE': 4,
                'BLOGUEUR_PLATEFORME': 5,
                'STAFF_PLATEFORME': 6,
                'ADMINISTRATEUR_PLATEFORME': 7
            };

            if (roleHierarchy[user.compte_role] < roleHierarchy[article.droit_lecture_minimum_role]) {
                throw new AuthorizationError('Rôle insuffisant pour accéder à cet article');
            }
        }

        return true;
    }

    /**
     * Vérifier si l'utilisateur peut modifier l'article
     */
    canModify(article, user) {
        if (!user) return false;

        // Administrateurs peuvent tout modifier
        if (['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(user.compte_role)) {
            return true;
        }

        // Auteur peut modifier ses brouillons
        if (article.auteur_id === user.id) {
            return true;
        }

        // Co-auteurs peuvent modifier
        if (article.co_auteurs && article.co_auteurs.includes(user.id)) {
            return true;
        }

        return false;
    }

    /**
     * Vérifier si l'utilisateur peut supprimer l'article
     */
    canDelete(article, user) {
        if (!user) return false;

        // Seuls les administrateurs peuvent supprimer
        return ['ADMINISTRATEUR_PLATEFORME'].includes(user.compte_role);
    }

    /**
     * Récupérer les statistiques d'un article
     */
    async getArticleStats(articleId, periode = '30d') {
        const stats = {};

        // Statistiques globales
        const globalStats = await db.query(
            `SELECT 
                nombre_vues,
                nombre_vues_uniques,
                nombre_likes,
                nombre_dislikes,
                nombre_partages,
                nombre_commentaires
             FROM ARTICLES_BLOG_PLATEFORME
             WHERE id = $1`,
            [articleId]
        );
        
        Object.assign(stats, globalStats.rows[0]);

        // Évolution des vues sur la période
        const evolution = await db.query(
            `SELECT 
                DATE(date_lecture) as date,
                COUNT(*) as vues,
                COUNT(DISTINCT compte_id) as vues_uniques
             FROM STATS_LECTURE_ARTICLES
             WHERE article_id = $1
               AND date_lecture >= NOW() - $2::interval
             GROUP BY DATE(date_lecture)
             ORDER BY date DESC`,
            [articleId, periode]
        );
        
        stats.evolution = evolution.rows;

        // Temps de lecture moyen
        const tempsLecture = await db.query(
            `SELECT 
                AVG(temps_lecture_secondes) as temps_moyen,
                AVG(pourcentage_lu) as pourcentage_moyen
             FROM STATS_LECTURE_ARTICLES
             WHERE article_id = $1
               AND temps_lecture_secondes IS NOT NULL`,
            [articleId]
        );
        
        stats.temps_lecture = tempsLecture.rows[0];

        // Sources de trafic
        const sources = await db.query(
            `SELECT 
                CASE 
                    WHEN user_agent LIKE '%Facebook%' THEN 'FACEBOOK'
                    WHEN user_agent LIKE '%Twitter%' THEN 'TWITTER'
                    WHEN user_agent LIKE '%WhatsApp%' THEN 'WHATSAPP'
                    ELSE 'DIRECT'
                END as source,
                COUNT(*) as nombre
             FROM STATS_LECTURE_ARTICLES
             WHERE article_id = $1
             GROUP BY source`,
            [articleId]
        );
        
        stats.sources = sources.rows;

        // Appareils utilisés
        const appareils = await db.query(
            `SELECT 
                CASE 
                    WHEN user_agent LIKE '%Mobile%' THEN 'MOBILE'
                    WHEN user_agent LIKE '%Tablet%' THEN 'TABLETTE'
                    ELSE 'DESKTOP'
                END as type,
                COUNT(*) as nombre
             FROM STATS_LECTURE_ARTICLES
             WHERE article_id = $1
             GROUP BY type`,
            [articleId]
        );
        
        stats.appareils = appareils.rows;

        return stats;
    }

    /**
     * Récupérer les commentaires d'un article
     */
    /*async getArticleComments(articleId, user) {
        try {
            // Récupérer les commentaires principaux (sans parent)
            const comments = await db.query(
                `SELECT 
                    c.id,
                    c.contenu_commentaire,
                    c.date_creation,
                    c.note,
                    c.nombre_likes,
                    c.nombre_reponses,
                    u.id as auteur_id,
                    u.nom_utilisateur_compte as auteur_nom,
                    u.photo_profil_compte as auteur_photo,
                    CASE WHEN $2::int IS NOT NULL THEN 
                        EXISTS(SELECT 1 FROM LIKES_COMMENTAIRES 
                            WHERE commentaire_id = c.id AND compte_id = $2)
                    ELSE false END as user_liked
                FROM COMMENTAIRES c
                LEFT JOIN COMPTES u ON u.id = c.auteur_id
                WHERE c.article_id = $1
                AND c.statut = 'APPROUVE'
                AND c.commentaire_parent_id IS NULL
                ORDER BY c.date_creation ASC
                LIMIT 50`,
                [articleId, user?.id || null]
            );

            // Récupérer les réponses pour chaque commentaire
            for (const comment of comments.rows) {
                const replies = await db.query(
                    `SELECT 
                        c.id,
                        c.contenu_commentaire,
                        c.date_creation,
                        u.id as auteur_id,
                        u.nom_utilisateur_compte as auteur_nom,
                        u.photo_profil_compte as auteur_photo
                    FROM COMMENTAIRES c
                    LEFT JOIN COMPTES u ON u.id = c.auteur_id
                    WHERE c.commentaire_parent_id = $1
                    AND c.statut = 'APPROUVE'
                    ORDER BY c.date_creation ASC`,
                    [comment.id]
                );
                comment.reponses = replies.rows;
                comment.nombre_reponses = replies.rows.length;
            }

            return comments.rows;
        } catch (error) {
            console.error('Erreur récupération commentaires:', error);
            return [];
        }
    }*/
    async getArticleComments(articleId, user) {
        try {
            // Requête récursive pour construire l'arbre directement en SQL
            const result = await db.query(
                `WITH RECURSIVE comment_tree AS (
                    -- Sélectionner les commentaires racines
                    SELECT 
                        c.id,
                        c.contenu_commentaire,
                        c.date_creation,
                        c.note,
                        c.nombre_likes,
                        c.nombre_reponses,
                        c.commentaire_parent_id,
                        u.id as auteur_id,
                        u.nom_utilisateur_compte as auteur_nom,
                        u.photo_profil_compte as auteur_photo,
                        0 as niveau,
                        ARRAY[c.id] as chemin,
                        CASE WHEN $2::int IS NOT NULL THEN 
                            EXISTS(SELECT 1 FROM LIKES_COMMENTAIRES 
                                WHERE commentaire_id = c.id AND compte_id = $2)
                        ELSE false END as user_liked
                    FROM COMMENTAIRES c
                    LEFT JOIN COMPTES u ON u.id = c.auteur_id
                    WHERE c.article_id = $1
                        AND c.statut = 'APPROUVE'
                        AND c.commentaire_parent_id IS NULL
                    
                    UNION ALL
                    
                    -- Sélectionner les enfants récursivement
                    SELECT 
                        c.id,
                        c.contenu_commentaire,
                        c.date_creation,
                        c.note,
                        c.nombre_likes,
                        c.nombre_reponses,
                        c.commentaire_parent_id,
                        u.id as auteur_id,
                        u.nom_utilisateur_compte as auteur_nom,
                        u.photo_profil_compte as auteur_photo,
                        ct.niveau + 1,
                        ct.chemin || c.id,
                        CASE WHEN $2::int IS NOT NULL THEN 
                            EXISTS(SELECT 1 FROM LIKES_COMMENTAIRES 
                                WHERE commentaire_id = c.id AND compte_id = $2)
                        ELSE false END as user_liked
                    FROM COMMENTAIRES c
                    LEFT JOIN COMPTES u ON u.id = c.auteur_id
                    INNER JOIN comment_tree ct ON ct.id = c.commentaire_parent_id
                    WHERE c.article_id = $1
                        AND c.statut = 'APPROUVE'
                )
                SELECT * FROM comment_tree
                ORDER BY chemin`,
                [articleId, user?.id || null]
            );

            if (result.rows.length === 0) {
                return [];
            }

            // Construire l'arbre à partir des résultats plats
            const commentMap = new Map();
            const rootComments = [];

            for (const comment of result.rows) {
                commentMap.set(comment.id, {
                    ...comment,
                    reponses: []
                });
            }

            for (const comment of result.rows) {
                const commentWithReplies = commentMap.get(comment.id);
                
                if (comment.commentaire_parent_id === null) {
                    rootComments.push(commentWithReplies);
                } else {
                    const parent = commentMap.get(comment.commentaire_parent_id);
                    if (parent) {
                        parent.reponses.push(commentWithReplies);
                    }
                }
            }

            return rootComments;

        } catch (error) {
            console.error('Erreur récupération commentaires:', error);
            return [];
        }
    }
    
    /**
     * Récupérer les articles similaires
     */
    async getSimilarArticles(article, user, limit = 5) {
        const result = await db.query(
            `SELECT a.*,
                    c.nom_utilisateur_compte as auteur_nom,
                    COUNT(DISTINCT l.id) as total_likes
             FROM ARTICLES_BLOG_PLATEFORME a
             LEFT JOIN COMPTES c ON c.id = a.auteur_id
             LEFT JOIN LIKES_ARTICLES l ON l.article_id = a.id
             WHERE a.id != $1
               AND a.statut = 'PUBLIE'
               AND a.est_archive = false
               AND (a.categorie_principale = $2 
                    OR a.mots_cles && $3
                    OR a.auteur_id = $4)
               AND (a.visibilite = 'PUBLIC' 
                    OR (a.visibilite = 'ABONNES' AND EXISTS(
                        SELECT 1 FROM ABONNEMENTS_BLOG 
                        WHERE compte_id = $5 AND actif = true
                    )))
             GROUP BY a.id, c.nom_utilisateur_compte
             ORDER BY 
                CASE WHEN a.categorie_principale = $2 THEN 3 ELSE 0 END +
                CASE WHEN a.mots_cles && $3 THEN 2 ELSE 0 END +
                CASE WHEN a.auteur_id = $4 THEN 1 ELSE 0 END DESC,
                a.date_publication DESC
             LIMIT $6`,
            [article.id, article.categorie_principale, article.mots_cles, article.auteur_id, user?.id, limit]
        );

        return result.rows;
    }

    /**
     * Notifier les abonnés d'un nouvel article
     */
    async notifySubscribers(article, client) {
        try {
            // Récupérer les abonnés à la catégorie
            const subscribers = await client.query(
                `SELECT DISTINCT compte_id 
                 FROM ABONNEMENTS_BLOG 
                 WHERE (type_abonnement = 'CATEGORIE' AND reference_id = $1)
                    OR (type_abonnement = 'AUTEUR' AND reference_id = $2)
                    OR (type_abonnement = 'TAG' AND reference_id = ANY($3))
                 AND actif = true`,
                [article.categorie_principale, article.auteur_id, article.mots_cles || []]
            );

            for (const sub of subscribers.rows) {
                await NotificationService.send({
                    destinataire_id: sub.compte_id,
                    type: 'NOUVEL_ARTICLE',
                    titre: `Nouvel article: ${article.titre_article}`,
                    corps: `Découvrez le nouvel article de ${article.auteur_nom}`,
                    entite_source_type: 'ARTICLE_BLOG',
                    entite_source_id: article.id,
                    action_url: `/blog/${article.slug}`
                });
            }
        } catch (error) {
            console.error('Erreur notification abonnés:', error);
            // Ne pas bloquer le processus principal
        }
    }
}

module.exports = new ArticleController();