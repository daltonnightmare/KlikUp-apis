// src/controllers/blog/LikeController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');
const NotificationService = require('../../services/notification/NotificationService');

class LikeController {
    /**
     * Liker/Disliker un article
     * @route POST /api/v1/blog/articles/:articleId/like
     */
    async toggleArticleLike(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { articleId } = req.params;
            const { type_like } = req.body; // 'LIKE' ou 'DISLIKE'

            if (!['LIKE', 'DISLIKE'].includes(type_like)) {
                throw new ValidationError('Type de like invalide');
            }

            // Vérifier que l'article existe
            const article = await client.query(
                'SELECT * FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                [articleId]
            );

            if (article.rows.length === 0) {
                throw new NotFoundError('Article non trouvé');
            }

            // Vérifier si l'utilisateur a déjà liké
            const existingLike = await client.query(
                'SELECT * FROM LIKES_ARTICLES WHERE article_id = $1 AND compte_id = $2',
                [articleId, req.user.id]
            );

            let result;
            let action;

            if (existingLike.rows.length > 0) {
                const currentLike = existingLike.rows[0];
                
                if (currentLike.type_like === type_like) {
                    // Supprimer le like (toggle off)
                    await client.query(
                        'DELETE FROM LIKES_ARTICLES WHERE id = $1',
                        [currentLike.id]
                    );
                    
                    // Mettre à jour les compteurs
                    await client.query(
                        `UPDATE ARTICLES_BLOG_PLATEFORME 
                         SET nombre_${type_like === 'LIKE' ? 'likes' : 'dislikes'} = 
                             nombre_${type_like === 'LIKE' ? 'likes' : 'dislikes'} - 1
                         WHERE id = $1`,
                        [articleId]
                    );
                    
                    action = 'removed';
                } else {
                    // Changer le type de like
                    await client.query(
                        `UPDATE LIKES_ARTICLES 
                         SET type_like = $1, date_like = NOW()
                         WHERE id = $2`,
                        [type_like, currentLike.id]
                    );
                    
                    // Mettre à jour les compteurs
                    await client.query(
                        `UPDATE ARTICLES_BLOG_PLATEFORME 
                         SET nombre_${type_like === 'LIKE' ? 'likes' : 'dislikes'} = 
                             nombre_${type_like === 'LIKE' ? 'likes' : 'dislikes'} + 1,
                             nombre_${type_like === 'LIKE' ? 'dislikes' : 'likes'} = 
                             nombre_${type_like === 'LIKE' ? 'dislikes' : 'likes'} - 1
                         WHERE id = $1`,
                        [articleId]
                    );
                    
                    action = 'changed';
                }
            } else {
                // Ajouter un nouveau like
                await client.query(
                    `INSERT INTO LIKES_ARTICLES (article_id, compte_id, type_like)
                     VALUES ($1, $2, $3)`,
                    [articleId, req.user.id, type_like]
                );
                
                // Mettre à jour le compteur
                await client.query(
                    `UPDATE ARTICLES_BLOG_PLATEFORME 
                     SET nombre_${type_like === 'LIKE' ? 'likes' : 'dislikes'} = 
                         nombre_${type_like === 'LIKE' ? 'likes' : 'dislikes'} + 1
                     WHERE id = $1`,
                    [articleId]
                );
                
                action = 'added';
                
                // Notification à l'auteur (seulement pour les likes, pas pour les dislikes)
                /*if (type_like === 'LIKE' && article.rows[0].auteur_id !== req.user.id) {
                    await NotificationService.send({
                        destinataire_id: article.rows[0].auteur_id,
                        type: 'LIKE_ARTICLE',
                        titre: 'Nouveau like sur votre article',
                        corps: `${req.user.nom_utilisateur_compte} a aimé votre article`,
                        entite_source_type: 'ARTICLE_BLOG',
                        entite_source_id: articleId
                    });
                }*/
            }

            // Récupérer les compteurs mis à jour
            const updatedArticle = await client.query(
                'SELECT nombre_likes, nombre_dislikes FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                [articleId]
            );

            await client.query('COMMIT');

            res.json({
                success: true,
                data: {
                    action,
                    type_like: action !== 'removed' ? type_like : null,
                    counts: updatedArticle.rows[0]
                },
                message: action === 'added' ? 'Like ajouté' : 
                        action === 'removed' ? 'Like retiré' : 'Like modifié'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Liker/Disliker un commentaire
     * @route POST /api/v1/blog/commentaires/:commentaireId/like
     */
    async toggleCommentaireLike(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { commentaireId } = req.params;
            const { type_like } = req.body;

            if (!['LIKE', 'DISLIKE'].includes(type_like)) {
                throw new ValidationError('Type de like invalide');
            }

            // Vérifier que le commentaire existe
            const commentaire = await client.query(
                'SELECT * FROM COMMENTAIRES WHERE id = $1',
                [commentaireId]
            );

            if (commentaire.rows.length === 0) {
                throw new NotFoundError('Commentaire non trouvé');
            }

            // Vérifier si l'utilisateur a déjà liké
            const existingLike = await client.query(
                'SELECT * FROM LIKES_COMMENTAIRES WHERE commentaire_id = $1 AND compte_id = $2',
                [commentaireId, req.user.id]
            );

            let result;
            let action;

            if (existingLike.rows.length > 0) {
                const currentLike = existingLike.rows[0];
                
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
                     VALUES ($1, $2, $3)`,
                    [commentaireId, req.user.id, type_like]
                );
                action = 'added';
            }

            // Récupérer les compteurs mis à jour
            const counts = await client.query(
                `SELECT 
                    COUNT(*) FILTER (WHERE type_like = 'LIKE') as likes,
                    COUNT(*) FILTER (WHERE type_like = 'DISLIKE') as dislikes
                 FROM LIKES_COMMENTAIRES
                 WHERE commentaire_id = $1`,
                [commentaireId]
            );

            await client.query('COMMIT');

            res.json({
                success: true,
                data: {
                    action,
                    type_like: action !== 'removed' ? type_like : null,
                    counts: counts.rows[0]
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les utilisateurs qui ont liké un article
     * @route GET /api/v1/blog/articles/:articleId/likes
     */
    async getArticleLikes(req, res, next) {
        try {
            const { articleId } = req.params;
            const { type = 'LIKE', page = 1, limit = 50 } = req.query;

            const offset = (page - 1) * limit;

            const result = await db.query(
                `SELECT l.*,
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
}

module.exports = new LikeController();