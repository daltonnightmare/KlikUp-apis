// src/controllers/blog/SignalementController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');
const NotificationService = require('../../services/notification/NotificationService');

class SignalementController {
    /**
     * Signaler un article
     * @route POST /api/v1/blog/articles/:articleId/signaler
     */
    async signalerArticle(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { articleId } = req.params;
            const { motif, description } = req.body;

            // Vérifier que l'article existe
            const article = await client.query(
                'SELECT id FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                [articleId]
            );

            if (article.rows.length === 0) {
                throw new NotFoundError('Article non trouvé');
            }

            // Vérifier si déjà signalé par cet utilisateur
            const existing = await client.query(
                'SELECT id FROM SIGNALEMENTS_ARTICLES WHERE article_id = $1 AND compte_id = $2',
                [articleId, req.user.id]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError('Vous avez déjà signalé cet article');
            }

            // Créer le signalement
            const result = await client.query(
                `INSERT INTO SIGNALEMENTS_ARTICLES (article_id, compte_id, motif, description)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [articleId, req.user.id, motif, description]
            );

            // Mettre à jour le compteur de signalements de l'article
            await client.query(
                "UPDATE ARTICLES_BLOG_PLATEFORME SET statut = CASE WHEN statut = 'PUBLIE' THEN 'SIGNALE' ELSE statut END WHERE id = $1",
                [articleId]
            );

            // Vérifier le nombre total de signalements
            const signalCount = await client.query(
                'SELECT COUNT(*) FROM SIGNALEMENTS_ARTICLES WHERE article_id = $1',
                [articleId]
            );

            if (parseInt(signalCount.rows[0].count) >= 3) {
                await NotificationService.notifyModerators({
                    type: 'SIGNALEMENTS_MULTIPLES',
                    titre: 'Article signalé plusieurs fois',
                    corps: `L'article #${articleId} a reçu ${signalCount.rows[0].count} signalements`,
                    entite_source_type: 'ARTICLE_BLOG',
                    entite_source_id: articleId
                });
            }

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message: 'Signalement envoyé'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Traiter un signalement d'article
     * @route PATCH /api/v1/blog/signalements/articles/:id/traiter
     */
    async traiterSignalementArticle(req, res, next) {
        const client = await db.getClient();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { statut, action_entreprise } = req.body;

            const signalement = await client.query(
                'SELECT * FROM SIGNALEMENTS_ARTICLES WHERE id = $1',
                [id]
            );

            if (signalement.rows.length === 0) {
                throw new NotFoundError('Signalement non trouvé');
            }

            await client.query(
                `UPDATE SIGNALEMENTS_ARTICLES 
                 SET statut = $1,
                     traite_par = $2,
                     date_traitement = NOW(),
                     action_entreprise = $3
                 WHERE id = $4`,
                [statut, req.user.id, action_entreprise, id]
            );

            // Si action de modération sur l'article
            if (action_entreprise) {
                const [action, ...details] = action_entreprise.split(':');
                
                if (action === 'MASQUER') {
                    await client.query(
                        `UPDATE ARTICLES_BLOG_PLATEFORME 
                         SET statut = 'MASQUE'
                         WHERE id = $1`,
                        [signalement.rows[0].article_id]
                    );
                } else if (action === 'ARCHIVER') {
                    await client.query(
                        `UPDATE ARTICLES_BLOG_PLATEFORME 
                         SET est_archive = true,
                             date_archivage = NOW()
                         WHERE id = $1`,
                        [signalement.rows[0].article_id]
                    );
                }
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Signalement traité'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les signalements en attente
     * @route GET /api/v1/blog/signalements/en-attente
     */
    async getSignalementsEnAttente(req, res, next) {
        try {
            const { type = 'tous', page = 1, limit = 50 } = req.query;
            const offset = (page - 1) * limit;

            let articles = { rows: [] };
            let commentaires = { rows: [] };
            let total = 0;

            if (type === 'tous' || type === 'articles') {
                articles = await db.query(
                    `SELECT s.*,
                            a.titre_article,
                            a.slug,
                            c.nom_utilisateur_compte as auteur_nom,
                            'ARTICLE' as type_signalement,
                            COUNT(*) OVER() as total_count
                     FROM SIGNALEMENTS_ARTICLES s
                     JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = s.article_id
                     JOIN COMPTES c ON c.id = a.auteur_id
                     WHERE s.statut = 'EN_ATTENTE'
                     ORDER BY s.date_signalement ASC
                     LIMIT $1 OFFSET $2`,
                    [parseInt(limit), offset]
                );
                total += articles.rows[0]?.total_count || 0;
            }

            if (type === 'tous' || type === 'commentaires') {
                commentaires = await db.query(
                    `SELECT s.*,
                            cm.contenu_commentaire,
                            a.titre_article,
                            c.nom_utilisateur_compte as auteur_nom,
                            'COMMENTAIRE' as type_signalement,
                            COUNT(*) OVER() as total_count
                     FROM SIGNALEMENTS_COMMENTAIRES s
                     JOIN COMMENTAIRES cm ON cm.id = s.commentaire_id
                     JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = cm.article_id
                     JOIN COMPTES c ON c.id = cm.auteur_id
                     WHERE s.statut = 'EN_ATTENTE'
                     ORDER BY s.date_signalement ASC
                     LIMIT $1 OFFSET $2`,
                    [parseInt(limit), offset]
                );
                total += commentaires.rows[0]?.total_count || 0;
            }

            const allSignalements = [...articles.rows, ...commentaires.rows];

            res.json({
                success: true,
                data: allSignalements,
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


module.exports = new SignalementController();