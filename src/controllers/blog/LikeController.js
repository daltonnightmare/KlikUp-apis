// src/controllers/blog/LikeController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError, AuthenticationError } = require('../../utils/errors/AppError');
const NotificationService = require('../../services/notification/NotificationService');
const CacheService = require('../../services/cache/CacheService');

class LikeController {
    
    // ========================================================================
    // LIKER/DISLIKER UN ARTICLE
    // ========================================================================

    /**
     * Liker/Disliker un article (version sécurisée)
     * @route POST /api/v1/blog/articles/:articleId/like
     */
    async toggleArticleLike(req, res, next) {
        const client = await db.getClient();
        
        try {
            // ✅ 1. Vérifier l'authentification
            if (!req.user || !req.user.id) {
                throw new AuthenticationError('Authentification requise');
            }

            await client.query('BEGIN');
            
            const { articleId } = req.params;
            const { type_like } = req.body;

            // ✅ 2. Validation stricte
            if (!['LIKE', 'DISLIKE'].includes(type_like)) {
                throw new ValidationError('Type de like invalide. Utilisez LIKE ou DISLIKE');
            }

            // ✅ 3. Vérifier que l'article existe et récupérer l'auteur
            const article = await client.query(
                `SELECT id, auteur_id, titre_article, statut, est_commentaire_actif 
                 FROM ARTICLES_BLOG_PLATEFORME 
                 WHERE id = $1 AND statut != 'SUPPRIME'`,
                [articleId]
            );

            if (article.rows.length === 0) {
                throw new NotFoundError('Article non trouvé');
            }

            // ✅ 4. Vérifier le like existant avec FOR UPDATE pour éviter les race conditions
            const existingLike = await client.query(
                `SELECT id, type_like 
                 FROM LIKES_ARTICLES 
                 WHERE article_id = $1 AND compte_id = $2 
                 FOR UPDATE`,
                [articleId, req.user.id]
            );

            let action;
            let oldType = null;

            if (existingLike.rows.length > 0) {
                const currentLike = existingLike.rows[0];
                oldType = currentLike.type_like;
                
                if (currentLike.type_like === type_like) {
                    // ✅ Cas 1 : Même type → Supprimer le like (toggle off)
                    await client.query(
                        'DELETE FROM LIKES_ARTICLES WHERE id = $1',
                        [currentLike.id]
                    );
                    action = 'removed';
                } else {
                    // ✅ Cas 2 : Type différent → Changer le like
                    await client.query(
                        `UPDATE LIKES_ARTICLES 
                         SET type_like = $1, date_like = NOW()
                         WHERE id = $2`,
                        [type_like, currentLike.id]
                    );
                    action = 'changed';
                }
            } else {
                // ✅ Cas 3 : Pas de like → Ajouter
                await client.query(
                    `INSERT INTO LIKES_ARTICLES (article_id, compte_id, type_like)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (article_id, compte_id) DO UPDATE 
                     SET type_like = $3, date_like = NOW()`,
                    [articleId, req.user.id, type_like]
                );
                action = 'added';
            }

            // ✅ 5. Mettre à jour les compteurs de manière SAFE
            if (action === 'added') {
                await this.incrementCounter(client, 'ARTICLES_BLOG_PLATEFORME', articleId, type_like, 1);
            } else if (action === 'removed') {
                await this.incrementCounter(client, 'ARTICLES_BLOG_PLATEFORME', articleId, oldType, -1);
            } else if (action === 'changed') {
                await this.incrementCounter(client, 'ARTICLES_BLOG_PLATEFORME', articleId, oldType, -1);
                await this.incrementCounter(client, 'ARTICLES_BLOG_PLATEFORME', articleId, type_like, 1);
            }

            // ✅ 6. Récupérer les compteurs mis à jour
            const updatedArticle = await client.query(
                `SELECT nombre_likes, nombre_dislikes 
                 FROM ARTICLES_BLOG_PLATEFORME 
                 WHERE id = $1`,
                [articleId]
            );

            // ✅ 7. Notification asynchrone (hors transaction)
            if (action === 'added' && type_like === 'LIKE' && article.rows[0].auteur_id !== req.user.id) {
                setImmediate(() => {
                    NotificationService.send({
                        destinataire_id: article.rows[0].auteur_id,
                        type: 'LIKE_ARTICLE',
                        titre: 'Nouveau like sur votre article',
                        corps: `${req.user.nom_utilisateur_compte || 'Quelqu\'un'} a aimé votre article "${article.rows[0].titre_article}"`,
                        entite_source_type: 'ARTICLE_BLOG',
                        entite_source_id: articleId
                    }).catch(err => console.debug('Erreur notification like:', err));
                });
            }

            await client.query('COMMIT');

            // ✅ 8. Invalider le cache
            CacheService.invalidatePattern('blog:articles:*').catch(() => {});

            // ✅ 9. Réponse enrichie avec le statut de like
            res.json({
                success: true,
                data: {
                    action,
                    type_like: action !== 'removed' ? type_like : null,
                    // ✅ INFORMATIONS SUR LE STATUT DE LIKE
                    user_has_liked: action !== 'removed',
                    user_like_type: action !== 'removed' ? type_like : null,
                    is_liked: action !== 'removed' && type_like === 'LIKE',
                    is_disliked: action !== 'removed' && type_like === 'DISLIKE',
                    // Compteurs
                    counts: {
                        likes: parseInt(updatedArticle.rows[0].nombre_likes),
                        dislikes: parseInt(updatedArticle.rows[0].nombre_dislikes)
                    }
                },
                message: this.getLikeMessage(action, type_like)
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ========================================================================
    // LIKER/DISLIKER UN COMMENTAIRE
    // ========================================================================

    /**
     * Liker/Disliker un commentaire (version sécurisée)
     * @route POST /api/v1/blog/commentaires/:commentaireId/like
     */
    async toggleCommentaireLike(req, res, next) {
        const client = await db.getClient();
        
        try {
            if (!req.user || !req.user.id) {
                throw new AuthenticationError('Authentification requise');
            }

            await client.query('BEGIN');
            
            const { commentaireId } = req.params;
            const { type_like } = req.body;

            if (!['LIKE', 'DISLIKE'].includes(type_like)) {
                throw new ValidationError('Type de like invalide');
            }

            // ✅ Vérifier que le commentaire existe
            const commentaire = await client.query(
                `SELECT id, auteur_id, contenu_commentaire, statut 
                 FROM COMMENTAIRES 
                 WHERE id = $1 AND statut = 'APPROUVE'`,
                [commentaireId]
            );

            if (commentaire.rows.length === 0) {
                throw new NotFoundError('Commentaire non trouvé');
            }

            // ✅ Vérifier le like existant avec FOR UPDATE
            const existingLike = await client.query(
                `SELECT id, type_like 
                 FROM LIKES_COMMENTAIRES 
                 WHERE commentaire_id = $1 AND compte_id = $2 
                 FOR UPDATE`,
                [commentaireId, req.user.id]
            );

            let action;
            let oldType = null;

            if (existingLike.rows.length > 0) {
                const currentLike = existingLike.rows[0];
                oldType = currentLike.type_like;
                
                if (currentLike.type_like === type_like) {
                    await client.query(
                        'DELETE FROM LIKES_COMMENTAIRES WHERE id = $1',
                        [currentLike.id]
                    );
                    action = 'removed';
                } else {
                    await client.query(
                        `UPDATE LIKES_COMMENTAIRES 
                         SET type_like = $1, date_like = NOW()
                         WHERE id = $2`,
                        [type_like, currentLike.id]
                    );
                    action = 'changed';
                }
            } else {
                await client.query(
                    `INSERT INTO LIKES_COMMENTAIRES (commentaire_id, compte_id, type_like)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (commentaire_id, compte_id) DO UPDATE 
                     SET type_like = $3, date_like = NOW()`,
                    [commentaireId, req.user.id, type_like]
                );
                action = 'added';
            }

            // ✅ Récupérer les compteurs
            const likeCountResult = await client.query(
                `SELECT 
                    COUNT(*) FILTER (WHERE type_like = 'LIKE') as likes,
                    COUNT(*) FILTER (WHERE type_like = 'DISLIKE') as dislikes
                 FROM LIKES_COMMENTAIRES
                 WHERE commentaire_id = $1`,
                [commentaireId]
            );

            // ✅ Mettre à jour les compteurs dans la table COMMENTAIRES
            await client.query(
                `UPDATE COMMENTAIRES 
                 SET nombre_likes = $1,
                     nombre_dislikes = $2
                 WHERE id = $3`,
                [
                    parseInt(likeCountResult.rows[0].likes),
                    parseInt(likeCountResult.rows[0].dislikes),
                    commentaireId
                ]
            );

            // ✅ Notification pour like de commentaire
            if (action === 'added' && type_like === 'LIKE' && commentaire.rows[0].auteur_id !== req.user.id) {
                setImmediate(() => {
                    NotificationService.send({
                        destinataire_id: commentaire.rows[0].auteur_id,
                        type: 'LIKE_COMMENTAIRE',
                        titre: 'Nouveau like sur votre commentaire',
                        corps: `${req.user.nom_utilisateur_compte || 'Quelqu\'un'} a aimé votre commentaire`,
                        entite_source_type: 'COMMENTAIRE',
                        entite_source_id: commentaireId
                    }).catch(err => console.debug('Erreur notification like commentaire:', err));
                });
            }

            await client.query('COMMIT');

            // ✅ Réponse enrichie avec le statut de like
            res.json({
                success: true,
                data: {
                    action,
                    type_like: action !== 'removed' ? type_like : null,
                    // ✅ INFORMATIONS SUR LE STATUT DE LIKE
                    user_has_liked: action !== 'removed',
                    user_like_type: action !== 'removed' ? type_like : null,
                    is_liked: action !== 'removed' && type_like === 'LIKE',
                    is_disliked: action !== 'removed' && type_like === 'DISLIKE',
                    // Compteurs
                    counts: {
                        likes: parseInt(likeCountResult.rows[0].likes),
                        dislikes: parseInt(likeCountResult.rows[0].dislikes)
                    }
                },
                message: this.getLikeMessage(action, type_like)
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ========================================================================
    // VÉRIFIER LE STATUT DE LIKE
    // ========================================================================

    /**
     * Vérifier si l'utilisateur a liké un article
     * @route GET /api/v1/blog/articles/:articleId/like-status
     */
    async getArticleLikeStatus(req, res, next) {
        try {
            const { articleId } = req.params;
            
            // Si l'utilisateur n'est pas connecté
            if (!req.user || !req.user.id) {
                return res.json({
                    success: true,
                    data: {
                        is_liked: false,
                        is_disliked: false,
                        user_has_liked: false,
                        like_type: null,
                        message: 'Utilisateur non connecté'
                    }
                });
            }

            // ✅ Vérifier que l'article existe
            const articleExists = await db.query(
                'SELECT id FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1 AND statut != \'SUPPRIME\'',
                [articleId]
            );

            if (articleExists.rows.length === 0) {
                throw new NotFoundError('Article non trouvé');
            }

            // ✅ Récupérer le like de l'utilisateur
            const likeResult = await db.query(
                `SELECT 
                    l.id,
                    l.type_like,
                    l.date_like,
                    a.nombre_likes,
                    a.nombre_dislikes
                 FROM LIKES_ARTICLES l
                 RIGHT JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = l.article_id
                 WHERE l.article_id = $1 AND l.compte_id = $2
                 UNION ALL
                 SELECT 
                    NULL as id,
                    NULL as type_like,
                    NULL as date_like,
                    a.nombre_likes,
                    a.nombre_dislikes
                 FROM ARTICLES_BLOG_PLATEFORME a
                 WHERE a.id = $1
                 AND NOT EXISTS (
                     SELECT 1 FROM LIKES_ARTICLES 
                     WHERE article_id = $1 AND compte_id = $2
                 )`,
                [articleId, req.user.id]
            );

            const likeData = likeResult.rows[0];
            const hasLiked = likeData && likeData.type_like !== null;

            res.json({
                success: true,
                data: {
                    // ✅ Statut détaillé du like
                    is_liked: hasLiked && likeData.type_like === 'LIKE',
                    is_disliked: hasLiked && likeData.type_like === 'DISLIKE',
                    user_has_liked: hasLiked,
                    like_type: likeData?.type_like || null,
                    like_id: likeData?.id || null,
                    like_date: likeData?.date_like || null,
                    // Compteurs globaux
                    counts: {
                        likes: likeData ? parseInt(likeData.nombre_likes) : 0,
                        dislikes: likeData ? parseInt(likeData.nombre_dislikes) : 0
                    }
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Vérifier si l'utilisateur a liké un commentaire
     * @route GET /api/v1/blog/commentaires/:commentaireId/like-status
     */
    async getCommentaireLikeStatus(req, res, next) {
        try {
            const { commentaireId } = req.params;
            
            // Si l'utilisateur n'est pas connecté
            if (!req.user || !req.user.id) {
                return res.json({
                    success: true,
                    data: {
                        is_liked: false,
                        is_disliked: false,
                        user_has_liked: false,
                        like_type: null,
                        message: 'Utilisateur non connecté'
                    }
                });
            }

            // ✅ Vérifier que le commentaire existe
            const commentaireExists = await db.query(
                'SELECT id FROM COMMENTAIRES WHERE id = $1 AND statut = \'APPROUVE\'',
                [commentaireId]
            );

            if (commentaireExists.rows.length === 0) {
                throw new NotFoundError('Commentaire non trouvé');
            }

            // ✅ Récupérer le like de l'utilisateur
            const likeResult = await db.query(
                `SELECT 
                    l.id,
                    l.type_like,
                    l.date_like,
                    c.nombre_likes,
                    c.nombre_dislikes
                 FROM COMMENTAIRES c
                 LEFT JOIN LIKES_COMMENTAIRES l ON l.commentaire_id = c.id AND l.compte_id = $2
                 WHERE c.id = $1`,
                [commentaireId, req.user.id]
            );

            const likeData = likeResult.rows[0];
            const hasLiked = likeData && likeData.type_like !== null;

            res.json({
                success: true,
                data: {
                    // ✅ Statut détaillé du like
                    is_liked: hasLiked && likeData.type_like === 'LIKE',
                    is_disliked: hasLiked && likeData.type_like === 'DISLIKE',
                    user_has_liked: hasLiked,
                    like_type: likeData?.type_like || null,
                    like_id: likeData?.id || null,
                    like_date: likeData?.date_like || null,
                    // Compteurs globaux
                    counts: {
                        likes: likeData ? parseInt(likeData.nombre_likes) : 0,
                        dislikes: likeData ? parseInt(likeData.nombre_dislikes) : 0
                    }
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Vérifier le statut de like pour plusieurs articles à la fois (batch)
     * @route POST /api/v1/blog/likes/batch-status
     * Body: { article_ids: [1, 2, 3] }
     */
    async getBatchArticleLikeStatus(req, res, next) {
        try {
            const { article_ids } = req.body;

            if (!article_ids || !Array.isArray(article_ids) || article_ids.length === 0) {
                throw new ValidationError('Liste d\'IDs d\'articles requise');
            }

            if (article_ids.length > 100) {
                throw new ValidationError('Maximum 100 articles par requête');
            }

            // Si l'utilisateur n'est pas connecté
            if (!req.user || !req.user.id) {
                const emptyStatus = article_ids.reduce((acc, id) => {
                    acc[id] = {
                        is_liked: false,
                        is_disliked: false,
                        like_type: null
                    };
                    return acc;
                }, {});

                return res.json({
                    success: true,
                    data: emptyStatus
                });
            }

            // ✅ Récupérer tous les likes en une seule requête
            const likesResult = await db.query(
                `SELECT 
                    l.article_id,
                    l.type_like,
                    l.date_like
                 FROM LIKES_ARTICLES l
                 WHERE l.article_id = ANY($1::int[]) 
                   AND l.compte_id = $2`,
                [article_ids, req.user.id]
            );

            // ✅ Construire la map de statut
            const statusMap = {};
            for (const id of article_ids) {
                statusMap[id] = {
                    is_liked: false,
                    is_disliked: false,
                    like_type: null,
                    like_date: null
                };
            }

            for (const like of likesResult.rows) {
                statusMap[like.article_id] = {
                    is_liked: like.type_like === 'LIKE',
                    is_disliked: like.type_like === 'DISLIKE',
                    like_type: like.type_like,
                    like_date: like.date_like
                };
            }

            res.json({
                success: true,
                data: statusMap
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Vérifier le statut de like pour plusieurs commentaires à la fois (batch)
     * @route POST /api/v1/blog/likes/batch-comment-status
     * Body: { commentaire_ids: [1, 2, 3] }
     */
    async getBatchCommentaireLikeStatus(req, res, next) {
        try {
            const { commentaire_ids } = req.body;

            if (!commentaire_ids || !Array.isArray(commentaire_ids) || commentaire_ids.length === 0) {
                throw new ValidationError('Liste d\'IDs de commentaires requise');
            }

            if (commentaire_ids.length > 100) {
                throw new ValidationError('Maximum 100 commentaires par requête');
            }

            // Si l'utilisateur n'est pas connecté
            if (!req.user || !req.user.id) {
                const emptyStatus = commentaire_ids.reduce((acc, id) => {
                    acc[id] = {
                        is_liked: false,
                        is_disliked: false,
                        like_type: null
                    };
                    return acc;
                }, {});

                return res.json({
                    success: true,
                    data: emptyStatus
                });
            }

            // ✅ Récupérer tous les likes en une seule requête
            const likesResult = await db.query(
                `SELECT 
                    l.commentaire_id,
                    l.type_like,
                    l.date_like
                 FROM LIKES_COMMENTAIRES l
                 WHERE l.commentaire_id = ANY($1::int[]) 
                   AND l.compte_id = $2`,
                [commentaire_ids, req.user.id]
            );

            // ✅ Construire la map de statut
            const statusMap = {};
            for (const id of commentaire_ids) {
                statusMap[id] = {
                    is_liked: false,
                    is_disliked: false,
                    like_type: null,
                    like_date: null
                };
            }

            for (const like of likesResult.rows) {
                statusMap[like.commentaire_id] = {
                    is_liked: like.type_like === 'LIKE',
                    is_disliked: like.type_like === 'DISLIKE',
                    like_type: like.type_like,
                    like_date: like.date_like
                };
            }

            res.json({
                success: true,
                data: statusMap
            });

        } catch (error) {
            next(error);
        }
    }

    // ========================================================================
    // LISTES DE LIKES
    // ========================================================================

    /**
     * Récupérer les utilisateurs qui ont liké un article
     * @route GET /api/v1/blog/articles/:articleId/likes
     */
    async getArticleLikes(req, res, next) {
        try {
            const { articleId } = req.params;
            const { type = 'LIKE', page = 1, limit = 50 } = req.query;

            const offset = (parseInt(page) - 1) * parseInt(limit);

            const result = await db.query(
                `SELECT 
                    l.id,
                    l.type_like,
                    l.date_like,
                    c.id as compte_id,
                    c.nom_utilisateur_compte,
                    c.photo_profil_compte,
                    COUNT(*) OVER() as total_count
                 FROM LIKES_ARTICLES l
                 JOIN COMPTES c ON c.id = l.compte_id
                 WHERE l.article_id = $1 AND l.type_like = $2
                 ORDER BY l.date_like DESC
                 LIMIT $3 OFFSET $4`,
                [articleId, type, parseInt(limit), offset]
            );

            const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

            res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / Math.max(1, parseInt(limit)))
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les likes d'un utilisateur
     * @route GET /api/v1/blog/likes/user
     */
    async getUserLikes(req, res, next) {
        try {
            const { page = 1, limit = 20, type } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            let query = `
                SELECT 
                    l.*,
                    a.titre_article,
                    a.slug as article_slug,
                    a.image_principale as article_image,
                    COUNT(*) OVER() as total_count
                 FROM LIKES_ARTICLES l
                 JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = l.article_id
                 WHERE l.compte_id = $1 AND a.statut = 'PUBLIE'
            `;
            
            const params = [req.user.id];
            let paramIndex = 2;

            if (type && ['LIKE', 'DISLIKE'].includes(type)) {
                query += ` AND l.type_like = $${paramIndex}`;
                params.push(type);
                paramIndex++;
            }

            query += ` ORDER BY l.date_like DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

            res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / Math.max(1, parseInt(limit)))
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les statistiques de likes d'un article
     * @route GET /api/v1/blog/articles/:articleId/likes/stats
     */
    async getArticleLikeStats(req, res, next) {
        try {
            const { articleId } = req.params;

            const stats = await db.query(
                `SELECT 
                    nombre_likes,
                    nombre_dislikes,
                    ROUND(
                        CASE 
                            WHEN (nombre_likes + nombre_dislikes) > 0 
                            THEN (nombre_likes::decimal / (nombre_likes + nombre_dislikes) * 100)
                            ELSE 0 
                        END, 1
                    ) as pourcentage_likes,
                    ROUND(
                        CASE 
                            WHEN (nombre_likes + nombre_dislikes) > 0 
                            THEN (nombre_dislikes::decimal / (nombre_likes + nombre_dislikes) * 100)
                            ELSE 0 
                        END, 1
                    ) as pourcentage_dislikes
                 FROM ARTICLES_BLOG_PLATEFORME
                 WHERE id = $1`,
                [articleId]
            );

            if (stats.rows.length === 0) {
                throw new NotFoundError('Article non trouvé');
            }

            res.json({
                success: true,
                data: stats.rows[0]
            });

        } catch (error) {
            next(error);
        }
    }

    // ========================================================================
    // MÉTHODES PRIVÉES
    // ========================================================================

    /**
     * Incrémente ou décrémente un compteur de likes/dislikes de manière SAFE
     */
    async incrementCounter(client, table, id, type, delta) {
        const column = type === 'LIKE' ? 'nombre_likes' : 'nombre_dislikes';
        
        const allowedColumns = ['nombre_likes', 'nombre_dislikes'];
        if (!allowedColumns.includes(column)) {
            throw new Error(`Colonne invalide: ${column}`);
        }

        await client.query(
            `UPDATE ${table} 
             SET ${column} = GREATEST(0, ${column} + $1)
             WHERE id = $2`,
            [delta, id]
        );
    }

    /**
     * Retourne un message approprié selon l'action
     */
    getLikeMessage(action, type) {
        const typeLabel = type === 'LIKE' ? 'like' : 'dislike';
        
        switch (action) {
            case 'added':
                return `${typeLabel === 'like' ? 'Like' : 'Dislike'} ajouté`;
            case 'removed':
                return `${typeLabel === 'like' ? 'Like' : 'Dislike'} retiré`;
            case 'changed':
                return `Changement en ${typeLabel}`;
            default:
                return 'Action effectuée';
        }
    }
}

module.exports = new LikeController();