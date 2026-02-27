// src/controllers/blog/PartageController.js
const db = require('../../configuration/database');
const { NotFoundError } = require('../../utils/errors/AppError');

class PartageController {
    /**
     * Enregistrer un partage d'article
     * @route POST /api/v1/blog/articles/:articleId/partager
     */
    async share(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { articleId } = req.params;
            const { type_partage } = req.body;

            // Vérifier que l'article existe
            const article = await client.query(
                'SELECT id FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                [articleId]
            );

            if (article.rows.length === 0) {
                throw new NotFoundError('Article non trouvé');
            }

            // Enregistrer le partage
            await client.query(
                `INSERT INTO PARTAGES_ARTICLES (article_id, compte_id, type_partage, adresse_ip)
                 VALUES ($1, $2, $3, $4)`,
                [articleId, req.user?.id, type_partage, req.ip]
            );

            // Incrémenter le compteur de partages
            await client.query(
                'UPDATE ARTICLES_BLOG_PLATEFORME SET nombre_partages = nombre_partages + 1 WHERE id = $1',
                [articleId]
            );

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Partage enregistré'
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

            const result = await db.query(
                `SELECT 
                    type_partage,
                    COUNT(*) as nombre,
                    COUNT(DISTINCT compte_id) as utilisateurs_uniques
                 FROM PARTAGES_ARTICLES
                 WHERE article_id = $1
                 GROUP BY type_partage
                 ORDER BY nombre DESC`,
                [articleId]
            );

            const total = await db.query(
                'SELECT nombre_partages FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                [articleId]
            );

            res.json({
                success: true,
                data: {
                    total: total.rows[0]?.nombre_partages || 0,
                    details: result.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new PartageController();