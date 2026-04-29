// src/controllers/admin/ModerationController.js
const pool = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const NotificationService = require('../../services/notification/NotificationService');
const AuditService = require('../../services/audit/AuditService');
const logger = require('../../configuration/logger');

class ModerationController {
    /**
     * Récupérer tous les contenus à modérer
     * @route GET /api/v1/admin/moderation/queue
     * @access ADMINISTRATEUR_PLATEFORME, MODERATEUR
     */
    async getModerationQueue(req, res, next) {
        try {
            const {
                type = 'all',
                page = 1,
                limit = 20,
                statut = 'EN_ATTENTE',
                priorite
            } = req.query;

            const offset = (page - 1) * limit;
            const results = {};

            // 1. ARTICLES EN ATTENTE
            if (type === 'all' || type === 'articles') {
                const articles = await pool.query(`
                    SELECT 
                        a.id,
                        a.titre_article,
                        a.slug,
                        a.categorie_principale,
                        a.date_creation,
                        a.date_modification,
                        c.nom_utilisateur_compte as auteur_nom,
                        c.email as auteur_email,
                        'ARTICLE' as type_contenu,
                        CASE 
                            WHEN a.date_creation < NOW() - INTERVAL '7 days' THEN 'BASSE'
                            WHEN a.date_creation < NOW() - INTERVAL '2 days' THEN 'NORMALE'
                            ELSE 'HAUTE'
                        END as priorite
                    FROM ARTICLES_BLOG_PLATEFORME a
                    JOIN COMPTES c ON c.id = a.auteur_id
                    WHERE a.statut = 'EN_ATTENTE_VALIDATION'
                    ORDER BY 
                        CASE 
                            WHEN a.date_creation < NOW() - INTERVAL '7 days' THEN 3
                            WHEN a.date_creation < NOW() - INTERVAL '2 days' THEN 2
                            ELSE 1
                        END,
                        a.date_creation ASC
                    LIMIT $1 OFFSET $2
                `, [limit, offset]);

                results.articles = articles.rows;
            }

            // 2. COMMENTAIRES EN ATTENTE
            if (type === 'all' || type === 'commentaires') {
                const commentaires = await pool.query(`
                    SELECT 
                        com.id,
                        com.contenu_commentaire,
                        com.date_creation,
                        a.titre_article as article_titre,
                        c.nom_utilisateur_compte as auteur_nom,
                        c.email as auteur_email,
                        'COMMENTAIRE' as type_contenu,
                        com.nombre_signalements,
                        CASE 
                            WHEN com.nombre_signalements >= 5 THEN 'CRITIQUE'
                            WHEN com.nombre_signalements >= 3 THEN 'HAUTE'
                            ELSE 'NORMALE'
                        END as priorite
                    FROM COMMENTAIRES com
                    JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = com.article_id
                    JOIN COMPTES c ON c.id = com.auteur_id
                    WHERE com.statut = 'EN_ATTENTE'
                       OR com.nombre_signalements > 0
                    ORDER BY 
                        com.nombre_signalements DESC,
                        com.date_creation ASC
                    LIMIT $1 OFFSET $2
                `, [limit, offset]);

                results.commentaires = commentaires.rows;
            }

            // 3. AVIS EN ATTENTE
            if (type === 'all' || type === 'avis') {
                const avis = await pool.query(`
                    SELECT 
                        a.id,
                        a.note_globale,
                        a.contenu,
                        a.entite_type,
                        a.entite_id,
                        a.date_creation,
                        c.nom_utilisateur_compte as auteur_nom,
                        'AVIS' as type_contenu,
                        CASE 
                            WHEN a.note_globale = 1 THEN 'HAUTE'
                            ELSE 'NORMALE'
                        END as priorite
                    FROM AVIS a
                    JOIN COMPTES c ON c.id = a.auteur_id
                    WHERE a.statut = 'EN_ATTENTE'
                    ORDER BY 
                        CASE WHEN a.note_globale = 1 THEN 1 ELSE 2 END,
                        a.date_creation ASC
                    LIMIT $1 OFFSET $2
                `, [limit, offset]);

                results.avis = avis.rows;
            }

            // 4. SIGNALEMENTS
            if (type === 'all' || type === 'signalements') {
                const signalements = await pool.query(`
                    SELECT 
                        sa.id,
                        sa.article_id,
                        sa.motif,
                        sa.description,
                        sa.date_signalement,
                        c.nom_utilisateur_compte as signaler_par,
                        a.titre_article as contenu_titre,
                        'SIGNALEMENT_ARTICLE' as type_contenu,
                        'HAUTE' as priorite
                    FROM SIGNALEMENTS_ARTICLES sa
                    JOIN COMPTES c ON c.id = sa.compte_id
                    JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = sa.article_id
                    WHERE sa.statut = 'EN_ATTENTE'
                    
                    UNION ALL
                    
                    SELECT 
                        sc.id,
                        sc.commentaire_id,
                        sc.motif,
                        sc.description,
                        sc.date_signalement,
                        c.nom_utilisateur_compte,
                        com.contenu_commentaire,
                        'SIGNALEMENT_COMMENTAIRE',
                        'HAUTE'
                    FROM SIGNALEMENTS_COMMENTAIRES sc
                    JOIN COMPTES c ON c.id = sc.compte_id
                    JOIN COMMENTAIRES com ON com.id = sc.commentaire_id
                    WHERE sc.statut = 'EN_ATTENTE'
                    
                    ORDER BY date_signalement ASC
                    LIMIT $1 OFFSET $2
                `, [limit, offset]);

                results.signalements = signalements.rows;
            }

            // Statistiques globales
            const stats = await pool.query(`
                SELECT 
                    (SELECT COUNT(*) FROM ARTICLES_BLOG_PLATEFORME WHERE statut = 'EN_ATTENTE_VALIDATION') as articles_attente,
                    (SELECT COUNT(*) FROM COMMENTAIRES WHERE statut = 'EN_ATTENTE') as commentaires_attente,
                    (SELECT COUNT(*) FROM AVIS WHERE statut = 'EN_ATTENTE') as avis_attente,
                    (SELECT COUNT(*) FROM SIGNALEMENTS_ARTICLES WHERE statut = 'EN_ATTENTE') as signalements_articles,
                    (SELECT COUNT(*) FROM SIGNALEMENTS_COMMENTAIRES WHERE statut = 'EN_ATTENTE') as signalements_commentaires
            `);

            res.json({
                status: 'success',
                data: results,
                statistiques: stats.rows[0],
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit)
                }
            });

        } catch (error) {
            logger.error('Erreur récupération file modération:', error);
            next(error);
        }
    }

    /**
     * Modérer un article
     * @route POST /api/v1/admin/moderation/articles/:id
     * @access ADMINISTRATEUR_PLATEFORME, MODERATEUR
     */
    async modererArticle(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { action, commentaire } = req.body;

            if (!['PUBLIE', 'REJETE', 'MASQUE'].includes(action)) {
                throw new ValidationError('Action invalide');
            }

            // Récupération article
            const article = await client.query(
                `SELECT a.*, c.email as auteur_email, c.id as auteur_id
                 FROM ARTICLES_BLOG_PLATEFORME a
                 JOIN COMPTES c ON c.id = a.auteur_id
                 WHERE a.id = $1`,
                [id]
            );

            if (article.rows.length === 0) {
                throw new AppError('Article non trouvé', 404);
            }

            // Mise à jour statut
            await client.query(
                `UPDATE ARTICLES_BLOG_PLATEFORME 
                 SET statut = $1,
                     date_modification = NOW(),
                     valide_par = $2,
                     date_validation = NOW(),
                     commentaire_validation = $3
                 WHERE id = $4`,
                [action, req.user.id, commentaire, id]
            );

            // Notification à l'auteur
            await NotificationService.notifyUser(article.rows[0].auteur_id, {
                type: 'ARTICLE_MODERE',
                titre: action === 'PUBLIE' ? 'Article publié' : 'Article non publié',
                message: action === 'PUBLIE' 
                    ? 'Votre article a été publié'
                    : `Votre article n'a pas été publié : ${commentaire || 'Non conforme'}`,
                donnees: { article_id: id, action, commentaire }
            });

            await client.query('COMMIT');

            logger.info(`Article ${id} modéré: ${action} par ${req.user.id}`);

            res.json({
                status: 'success',
                message: `Article ${action === 'PUBLIE' ? 'publié' : 'rejeté'} avec succès`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur modération article:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Modérer un commentaire
     * @route POST /api/v1/admin/moderation/commentaires/:id
     * @access ADMINISTRATEUR_PLATEFORME, MODERATEUR
     */
    async modererCommentaire(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { action, commentaire } = req.body;

            if (!['APPROUVE', 'REJETE', 'SUPPRIME', 'MASQUE'].includes(action)) {
                throw new ValidationError('Action invalide');
            }

            const comment = await client.query(
                `SELECT c.*, c.auteur_id
                 FROM COMMENTAIRES c
                 WHERE c.id = $1`,
                [id]
            );

            if (comment.rows.length === 0) {
                throw new AppError('Commentaire non trouvé', 404);
            }

            await client.query(
                `UPDATE COMMENTAIRES 
                 SET statut = $1,
                     date_moderation = NOW(),
                     moderateur_id = $2,
                     motif_signalements = $3
                 WHERE id = $4`,
                [action, req.user.id, JSON.stringify({ commentaire_validation: commentaire }), id]
            );

            // Notification à l'auteur
            if (comment.rows[0].auteur_id) {
                await NotificationService.send(comment.rows[0].auteur_id, {
                    type: 'COMMENTAIRE_MODERE',
                    titre: 'Commentaire modéré',
                    message: commentaire || 'Votre commentaire a été modéré',
                    donnees: { commentaire_id: id, action }
                });
            }

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: 'Commentaire modéré avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur modération commentaire:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Modérer un avis
     * @route POST /api/v1/admin/moderation/avis/:id
     * @access ADMINISTRATEUR_PLATEFORME, MODERATEUR
     */
    async modererAvis(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { action, commentaire } = req.body;

            if (!['PUBLIE', 'REJETE', 'MASQUE'].includes(action)) {
                throw new ValidationError('Action invalide');
            }

            const avis = await client.query(
                `SELECT a.*, a.auteur_id
                 FROM AVIS a
                 WHERE a.id = $1`,
                [id]
            );

            if (avis.rows.length === 0) {
                throw new AppError('Avis non trouvé', 404);
            }

            await client.query(
                `UPDATE AVIS 
                 SET statut = $1,
                     date_moderation = NOW(),
                     moderateur_id = $2,
                     motif_rejet = $3
                 WHERE id = $4`,
                [action, req.user.id, commentaire, id]
            );

            // Notification à l'auteur
            if (avis.rows[0].auteur_id) {
                await NotificationService.notifyUser(avis.rows[0].auteur_id, {
                    type: 'AVIS_MODERE',
                    titre: action === 'PUBLIE' ? 'Avis publié' : 'Avis non publié',
                    message: action === 'PUBLIE' 
                        ? 'Votre avis a été publié'
                        : `Votre avis n'a pas été publié : ${commentaire || 'Non conforme'}`,
                    donnees: { avis_id: id, action }
                });
            }

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: `Avis ${action === 'PUBLIE' ? 'publié' : 'rejeté'} avec succès`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur modération avis:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Traiter un signalement
     * @route POST /api/v1/admin/moderation/signalements/:type/:id
     * @access ADMINISTRATEUR_PLATEFORME, MODERATEUR
     */
    async traiterSignalement(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { type, id } = req.params;
            const { action, commentaire } = req.body;

            if (!['TRAITE', 'REJETE'].includes(action)) {
                throw new ValidationError('Action invalide');
            }

            let signalementQuery;
            let tableName;
            let contentId;

            if (type === 'article') {
                tableName = 'SIGNALEMENTS_ARTICLES';
                signalementQuery = await client.query(
                    `SELECT * FROM ${tableName} WHERE id = $1`,
                    [id]
                );
            } else if (type === 'commentaire') {
                tableName = 'SIGNALEMENTS_COMMENTAIRES';
                signalementQuery = await client.query(
                    `SELECT * FROM ${tableName} WHERE id = $1`,
                    [id]
                );
            } else {
                throw new ValidationError('Type de signalement invalide');
            }

            if (signalementQuery.rows.length === 0) {
                throw new AppError('Signalement non trouvé', 404);
            }

            const signalement = signalementQuery.rows[0];

            // Mise à jour statut
            await client.query(
                `UPDATE ${tableName} 
                 SET statut = $1,
                     date_traitement = NOW(),
                     traite_par = $2,
                     action_entreprise = $3
                 WHERE id = $4`,
                [action === 'TRAITE' ? 'TRAITE' : 'REJETE', req.user.id, commentaire, id]
            );

            // Si action = TRAITE, on peut aussi modérer le contenu signalé
            if (action === 'TRAITE' && commentaire?.includes('MASQUER')) {
                if (type === 'article') {
                    await client.query(
                        `UPDATE ARTICLES_BLOG_PLATEFORME 
                         SET statut = 'SIGNALE'
                         WHERE id = $1`,
                        [signalement.article_id]
                    );
                } else {
                    await client.query(
                        `UPDATE COMMENTAIRES 
                         SET statut = 'MASQUE'
                         WHERE id = $1`,
                        [signalement.commentaire_id]
                    );
                }
            }

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: `Signalement ${action === 'TRAITE' ? 'traité' : 'rejeté'} avec succès`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur traitement signalement:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les statistiques de modération
     * @route GET /api/v1/admin/moderation/stats
     * @access ADMINISTRATEUR_PLATEFORME, MODERATEUR
     */
    async getModerationStats(req, res, next) {
        try {
            const { periode = '30j' } = req.query;

            const intervalle = periode === '30j' ? '30 days' : '7 days';

            const result = await pool.query(`
                WITH stats_globales AS (
                    SELECT 
                        (SELECT COUNT(*) FROM ARTICLES_BLOG_PLATEFORME WHERE statut = 'EN_ATTENTE_VALIDATION') as articles_attente,
                        (SELECT COUNT(*) FROM COMMENTAIRES WHERE statut = 'EN_ATTENTE') as commentaires_attente,
                        (SELECT COUNT(*) FROM AVIS WHERE statut = 'EN_ATTENTE') as avis_attente,
                        (SELECT COUNT(*) FROM SIGNALEMENTS_ARTICLES WHERE statut = 'EN_ATTENTE') as signalements_articles,
                        (SELECT COUNT(*) FROM SIGNALEMENTS_COMMENTAIRES WHERE statut = 'EN_ATTENTE') as signalements_commentaires
                ),
                stats_moderation AS (
                    SELECT 
                        COUNT(*) as total_modere,
                        COUNT(*) FILTER (WHERE action_type = 'MODERATION_ARTICLE') as articles_moderes,
                        COUNT(*) FILTER (WHERE action_type = 'MODERATION_COMMENTAIRE') as commentaires_moderes,
                        COUNT(*) FILTER (WHERE action_type = 'MODERATION_AVIS') as avis_moderes,
                        COUNT(DISTINCT utilisateur_id) as moderateurs_actifs
                    FROM HISTORIQUE_ACTIONS
                    WHERE action_type LIKE 'MODERATION%'
                    AND date_action >= NOW() - $1::interval
                )
                SELECT * FROM stats_globales, stats_moderation
            `, [intervalle]);

            // Temps moyen de modération
            const tempsMoyen = await pool.query(`
                SELECT AVG(EXTRACT(EPOCH FROM (date_moderation - date_creation))/3600)::numeric(10,2) as heures_moyennes
                FROM COMMENTAIRES
                WHERE date_moderation IS NOT NULL
                AND date_creation >= NOW() - INTERVAL '30 days'
            `);

            res.json({
                status: 'success',
                data: {
                    ...result.rows[0],
                    temps_moyen_moderation: tempsMoyen.rows[0]?.heures_moyennes || 0
                }
            });

        } catch (error) {
            logger.error('Erreur récupération stats modération:', error);
            next(error);
        }
    }
}

module.exports = new ModerationController();