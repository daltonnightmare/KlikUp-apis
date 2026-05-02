// src/controllers/blog/QuizController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError, AuthorizationError, AuthenticationError } = require('../../utils/errors/AppError');
const CacheService = require('../../services/cache/CacheService');
const NotificationService = require('../../services/notification/NotificationService');

class QuizController {

    // ========================================================================
    // CRUD QUIZ
    // ========================================================================

    /**
     * Créer un quiz pour un article
     * @route POST /api/v1/blog/articles/:articleId/quiz
     */
    async create(req, res, next) {
        const client = await db.getClient();
        
        try {
            await client.query('BEGIN');
            
            const { articleId } = req.params;
            const {
                question,
                explication,
                type_quiz = 'QCM',
                points = 1,
                temps_limite_secondes,
                ordre = 0,
                options = []  // [{ texte_option, est_correcte, feedback, ordre }]
            } = req.body;

            // Validation
            if (!question || question.trim().length < 10) {
                throw new ValidationError('La question doit contenir au moins 10 caractères');
            }

            if (!['QCM', 'VRAI_FAUX', 'REPONSE_COURTE'].includes(type_quiz)) {
                throw new ValidationError('Type de quiz invalide');
            }

            if (points < 1) {
                throw new ValidationError('Le nombre de points doit être positif');
            }

            // Vérifier que l'article existe et que l'utilisateur a les droits
            const article = await client.query(
                'SELECT id, auteur_id FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                [articleId]
            );

            if (article.rows.length === 0) {
                throw new NotFoundError('Article non trouvé');
            }

            // Vérifier les droits (auteur ou admin)
            if (article.rows[0].auteur_id !== req.user.id && 
                !['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role)) {
                throw new AuthorizationError('Vous n\'avez pas les droits pour ajouter un quiz');
            }

            // Pour VRAI_FAUX, créer automatiquement les options
            let quizOptions = options;
            if (type_quiz === 'VRAI_FAUX') {
                quizOptions = [
                    { texte_option: 'Vrai', est_correcte: options[0]?.est_correcte || false, ordre: 0 },
                    { texte_option: 'Faux', est_correcte: !options[0]?.est_correcte, ordre: 1 }
                ];
            }

            // Validation des options pour QCM
            if (type_quiz === 'QCM') {
                if (!quizOptions || quizOptions.length < 2) {
                    throw new ValidationError('Au moins 2 options sont requises pour un QCM');
                }
                const correctOptions = quizOptions.filter(o => o.est_correcte);
                if (correctOptions.length === 0) {
                    throw new ValidationError('Au moins une option doit être correcte');
                }
            }

            // Créer le quiz
            const quizResult = await client.query(
                `INSERT INTO QUIZ_ARTICLES (article_id, question, explication, type_quiz, points, temps_limite_secondes, ordre)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`,
                [articleId, question.trim(), explication || null, type_quiz, points, temps_limite_secondes || null, ordre]
            );

            const quiz = quizResult.rows[0];

            // Créer les options
            const createdOptions = [];
            for (const option of quizOptions) {
                const optResult = await client.query(
                    `INSERT INTO OPTIONS_QUIZ (quiz_id, texte_option, est_correcte, feedback, ordre)
                     VALUES ($1, $2, $3, $4, $5)
                     RETURNING *`,
                    [quiz.id, option.texte_option, option.est_correcte || false, option.feedback || null, option.ordre || 0]
                );
                createdOptions.push(optResult.rows[0]);
            }

            // Mettre à jour l'article pour indiquer qu'il contient un quiz
            await client.query(
                'UPDATE ARTICLES_BLOG_PLATEFORME SET contient_quiz = TRUE WHERE id = $1',
                [articleId]
            );

            await client.query('COMMIT');

            // Invalider le cache
            CacheService.del(`blog:article:${articleId}`).catch(() => {});
            CacheService.invalidatePattern('blog:articles:*').catch(() => {});

            res.status(201).json({
                success: true,
                data: { ...quiz, options: createdOptions },
                message: 'Quiz créé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour un quiz
     * @route PUT /api/v1/blog/quiz/:id
     */
    async update(req, res, next) {
        const client = await db.getClient();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const updateData = req.body;

            // Vérifier l'existence du quiz
            const quizQuery = await client.query(
                `SELECT q.*, a.auteur_id 
                 FROM QUIZ_ARTICLES q 
                 JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = q.article_id 
                 WHERE q.id = $1`,
                [id]
            );

            if (quizQuery.rows.length === 0) {
                throw new NotFoundError('Quiz non trouvé');
            }

            const quiz = quizQuery.rows[0];

            // Vérifier les droits
            if (quiz.auteur_id !== req.user.id && 
                !['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role)) {
                throw new AuthorizationError('Vous n\'avez pas les droits pour modifier ce quiz');
            }

            // Mettre à jour le quiz
            const setClauses = [];
            const values = [id];
            let vi = 2;

            const allowedFields = ['question', 'explication', 'type_quiz', 'points', 'temps_limite_secondes', 'ordre'];
            
            for (const field of allowedFields) {
                if (updateData[field] !== undefined) {
                    setClauses.push(`${field} = $${vi}`);
                    values.push(updateData[field]);
                    vi++;
                }
            }

            if (setClauses.length > 0) {
                await client.query(
                    `UPDATE QUIZ_ARTICLES SET ${setClauses.join(', ')} WHERE id = $1`,
                    values
                );
            }

            // Mettre à jour les options si fournies
            if (updateData.options && Array.isArray(updateData.options)) {
                // Supprimer les anciennes options
                await client.query('DELETE FROM OPTIONS_QUIZ WHERE quiz_id = $1', [id]);
                
                // Créer les nouvelles options
                for (const option of updateData.options) {
                    await client.query(
                        `INSERT INTO OPTIONS_QUIZ (quiz_id, texte_option, est_correcte, feedback, ordre)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [id, option.texte_option, option.est_correcte || false, option.feedback || null, option.ordre || 0]
                    );
                }
            }

            // Récupérer le quiz mis à jour
            const updatedQuiz = await client.query(
                `SELECT q.*, COALESCE(json_agg(json_build_object(
                    'id', oq.id, 'texte_option', oq.texte_option, 
                    'est_correcte', oq.est_correcte, 'feedback', oq.feedback, 'ordre', oq.ordre
                ) ORDER BY oq.ordre) FILTER (WHERE oq.id IS NOT NULL), '[]') as options
                 FROM QUIZ_ARTICLES q
                 LEFT JOIN OPTIONS_QUIZ oq ON oq.quiz_id = q.id
                 WHERE q.id = $1
                 GROUP BY q.id`,
                [id]
            );

            await client.query('COMMIT');

            // Invalider le cache
            CacheService.del(`blog:article:${quiz.article_id}`).catch(() => {});
            CacheService.del(`quiz:${id}`).catch(() => {});

            res.json({
                success: true,
                data: updatedQuiz.rows[0],
                message: 'Quiz mis à jour avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer un quiz
     * @route DELETE /api/v1/blog/quiz/:id
     */
    async delete(req, res, next) {
        const client = await db.getClient();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;

            const quiz = await client.query(
                `SELECT q.*, a.auteur_id 
                 FROM QUIZ_ARTICLES q 
                 JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = q.article_id 
                 WHERE q.id = $1`,
                [id]
            );

            if (quiz.rows.length === 0) {
                throw new NotFoundError('Quiz non trouvé');
            }

            // Vérifier les droits
            if (quiz.rows[0].auteur_id !== req.user.id && 
                !['ADMINISTRATEUR_PLATEFORME'].includes(req.user.compte_role)) {
                throw new AuthorizationError('Droits insuffisants');
            }

            const articleId = quiz.rows[0].article_id;

            // Supprimer le quiz (les options seront supprimées en cascade)
            await client.query('DELETE FROM QUIZ_ARTICLES WHERE id = $1', [id]);

            // Vérifier s'il reste des quiz pour cet article
            const remainingQuizzes = await client.query(
                'SELECT COUNT(*) as count FROM QUIZ_ARTICLES WHERE article_id = $1',
                [articleId]
            );

            if (parseInt(remainingQuizzes.rows[0].count) === 0) {
                await client.query(
                    'UPDATE ARTICLES_BLOG_PLATEFORME SET contient_quiz = FALSE WHERE id = $1',
                    [articleId]
                );
            }

            await client.query('COMMIT');

            // Invalider le cache
            CacheService.del(`blog:article:${articleId}`).catch(() => {});
            CacheService.del(`quiz:${id}`).catch(() => {});

            res.json({
                success: true,
                message: 'Quiz supprimé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ========================================================================
    // RÉPONDRE AUX QUIZ
    // ========================================================================

    /**
     * Soumettre une réponse à un quiz
     * @route POST /api/v1/blog/quiz/:id/repondre
     */
    async repondre(req, res, next) {
        const client = await db.getClient();
        
        try {
            if (!req.user || !req.user.id) {
                throw new AuthenticationError('Authentification requise');
            }

            await client.query('BEGIN');
            
            const { id } = req.params;
            const { option_id, reponse_texte, temps_reponse_secondes } = req.body;

            // Vérifier que le quiz existe
            const quiz = await client.query(
                `SELECT q.*, COUNT(rq.id) as tentatives_precedentes
                 FROM QUIZ_ARTICLES q
                 LEFT JOIN REPONSES_QUIZ rq ON rq.quiz_id = q.id AND rq.compte_id = $2
                 WHERE q.id = $1
                 GROUP BY q.id`,
                [id, req.user.id]
            );

            if (quiz.rows.length === 0) {
                throw new NotFoundError('Quiz non trouvé');
            }

            const quizData = quiz.rows[0];

            // Vérifier si l'utilisateur a déjà répondu (selon le type)
            if (quizData.type_quiz === 'QCM' || quizData.type_quiz === 'VRAI_FAUX') {
                if (parseInt(quizData.tentatives_precedentes) > 0) {
                    throw new ValidationError('Vous avez déjà répondu à ce quiz');
                }
            }

            // Déterminer si la réponse est correcte
            let est_correcte = false;
            let points_obtenus = 0;
            let feedback = '';
            let reponseCorrecte = '';

            if (quizData.type_quiz === 'QCM' || quizData.type_quiz === 'VRAI_FAUX') {
                // Vérifier l'option choisie
                const option = await client.query(
                    'SELECT * FROM OPTIONS_QUIZ WHERE id = $1 AND quiz_id = $2',
                    [option_id, id]
                );

                if (option.rows.length === 0) {
                    throw new ValidationError('Option invalide');
                }

                est_correcte = option.rows[0].est_correcte;
                feedback = option.rows[0].feedback || '';

                // Récupérer la réponse correcte
                const correctOption = await client.query(
                    'SELECT texte_option FROM OPTIONS_QUIZ WHERE quiz_id = $1 AND est_correcte = TRUE LIMIT 1',
                    [id]
                );
                reponseCorrecte = correctOption.rows[0]?.texte_option || '';

            } else if (quizData.type_quiz === 'REPONSE_COURTE') {
                // Pour les réponses courtes, on pourrait utiliser une comparaison plus avancée (IA, similarité, etc.)
                const options = await client.query(
                    'SELECT texte_option FROM OPTIONS_QUIZ WHERE quiz_id = $1',
                    [id]
                );
                
                // Comparaison simple (case insensitive)
                const reponsesAcceptees = options.rows.map(o => o.texte_option.toLowerCase());
                est_correcte = reponsesAcceptees.includes((reponse_texte || '').toLowerCase().trim());
                reponseCorrecte = options.rows[0]?.texte_option || '';
            }

            // Calculer les points
            if (est_correcte) {
                // Bonus de rapidité (optionnel)
                let bonusRapidite = 1;
                if (quizData.temps_limite_secondes && temps_reponse_secondes) {
                    bonusRapidite = Math.max(0.5, 1 - (temps_reponse_secondes / quizData.temps_limite_secondes) * 0.5);
                }
                points_obtenus = Math.round(quizData.points * bonusRapidite * 10) / 10;
            }

            // Enregistrer la réponse
            const reponseResult = await client.query(
                `INSERT INTO REPONSES_QUIZ (quiz_id, compte_id, option_id, reponse_texte, est_correcte, points_obtenus, temps_reponse_secondes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (quiz_id, compte_id) DO UPDATE SET
                    option_id = $3, reponse_texte = $4, est_correcte = $5, 
                    points_obtenus = $6, temps_reponse_secondes = $7, date_reponse = NOW()
                 RETURNING *`,
                [id, req.user.id, option_id || null, reponse_texte || null, est_correcte, points_obtenus, temps_reponse_secondes || null]
            );

            await client.query('COMMIT');

            // Invalider le cache
            CacheService.del(`quiz:${id}:scores`).catch(() => {});
            CacheService.del(`user:${req.user.id}:quiz:scores`).catch(() => {});

            res.json({
                success: true,
                data: {
                    reponse: reponseResult.rows[0],
                    est_correcte,
                    points_obtenus,
                    feedback,
                    reponse_correcte: est_correcte ? null : reponseCorrecte,
                    explication: quizData.explication,
                    message: est_correcte ? '✅ Bonne réponse !' : '❌ Mauvaise réponse'
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ========================================================================
    // RÉCUPÉRATION DES SCORES & STATISTIQUES
    // ========================================================================

    /**
     * Récupérer les quiz d'un article (pour l'affichage)
     * @route GET /api/v1/blog/articles/:articleId/quiz
     */
    async getByArticle(req, res, next) {
        try {
            const { articleId } = req.params;

            const cacheKey = `blog:article:${articleId}:quiz`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({ success: true, data: cached, fromCache: true });
            }

            const result = await db.query(
                `SELECT q.*, 
                        COALESCE(json_agg(json_build_object(
                            'id', oq.id, 'texte_option', oq.texte_option, 
                            'est_correcte', oq.est_correcte, 'feedback', oq.feedback, 'ordre', oq.ordre
                        ) ORDER BY oq.ordre) FILTER (WHERE oq.id IS NOT NULL), '[]') as options,
                        (SELECT COUNT(*) FROM REPONSES_QUIZ WHERE quiz_id = q.id) as nombre_reponses,
                        (SELECT COUNT(*) FROM REPONSES_QUIZ WHERE quiz_id = q.id AND est_correcte = TRUE) as nombre_bonnes_reponses
                 FROM QUIZ_ARTICLES q
                 LEFT JOIN OPTIONS_QUIZ oq ON oq.quiz_id = q.id
                 WHERE q.article_id = $1
                 GROUP BY q.id
                 ORDER BY q.ordre`,
                [articleId]
            );

            // Si l'utilisateur est connecté, ajouter ses réponses
            if (req.user) {
                for (const quiz of result.rows) {
                    const reponse = await db.query(
                        `SELECT rq.*, oq.texte_option as option_choisie
                         FROM REPONSES_QUIZ rq
                         LEFT JOIN OPTIONS_QUIZ oq ON oq.id = rq.option_id
                         WHERE rq.quiz_id = $1 AND rq.compte_id = $2`,
                        [quiz.id, req.user.id]
                    );
                    quiz.user_reponse = reponse.rows[0] || null;
                    quiz.a_repondu = reponse.rows.length > 0;
                }
            }

            // Mettre en cache pour 5 minutes
            CacheService.set(cacheKey, result.rows, 300).catch(() => {});

            res.json({
                success: true,
                data: result.rows
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer le tableau des scores pour un article
     * @route GET /api/v1/blog/articles/:articleId/quiz/scores
     */
    async getScoresByArticle(req, res, next) {
        try {
            const { articleId } = req.params;
            const { page = 1, limit = 50 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            const result = await db.query(
                `SELECT 
                    su.compte_id,
                    c.nom_utilisateur_compte,
                    c.photo_profil_compte,
                    su.score_total,
                    su.score_maximum,
                    su.pourcentage,
                    su.temps_total_secondes,
                    su.date_completion,
                    RANK() OVER (ORDER BY su.pourcentage DESC, su.temps_total_secondes ASC) as classement,
                    COUNT(*) OVER() as total_count
                 FROM SCORES_UTILISATEUR su
                 JOIN COMPTES c ON c.id = su.compte_id
                 WHERE su.article_id = $1
                 ORDER BY su.pourcentage DESC, su.temps_total_secondes ASC
                 LIMIT $2 OFFSET $3`,
                [articleId, parseInt(limit), offset]
            );

            const total = result.rows[0]?.total_count || 0;

            // Récupérer le classement de l'utilisateur connecté
            let userScore = null;
            if (req.user) {
                const scoreResult = await db.query(
                    `SELECT su.*, 
                            (SELECT COUNT(*) + 1 FROM SCORES_UTILISATEUR WHERE article_id = $1 AND pourcentage > su.pourcentage) as classement
                     FROM SCORES_UTILISATEUR su
                     WHERE su.article_id = $1 AND su.compte_id = $2`,
                    [articleId, req.user.id]
                );
                userScore = scoreResult.rows[0] || null;
            }

            res.json({
                success: true,
                data: {
                    scores: result.rows,
                    user_score: userScore
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
     * Récupérer les scores de quiz de l'utilisateur
     * @route GET /api/v1/blog/quiz/mes-scores
     */
    async getMyScores(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const { page = 1, limit = 20 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            const result = await db.query(
                `SELECT 
                    su.*,
                    a.titre_article,
                    a.slug,
                    a.image_principale as article_image,
                    COUNT(*) OVER() as total_count
                 FROM SCORES_UTILISATEUR su
                 JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = su.article_id
                 WHERE su.compte_id = $1
                 ORDER BY su.date_completion DESC
                 LIMIT $2 OFFSET $3`,
                [req.user.id, parseInt(limit), offset]
            );

            const total = result.rows[0]?.total_count || 0;

            // Statistiques globales
            const stats = await db.query(
                `SELECT 
                    COUNT(*) as total_quiz_completes,
                    COALESCE(SUM(score_total), 0) as total_points,
                    ROUND(AVG(pourcentage), 1) as pourcentage_moyen,
                    COALESCE(SUM(temps_total_secondes), 0) as temps_total_secondes,
                    COUNT(*) FILTER (WHERE pourcentage = 100) as quiz_parfaits
                 FROM SCORES_UTILISATEUR
                 WHERE compte_id = $1`,
                [req.user.id]
            );

            res.json({
                success: true,
                data: {
                    scores: result.rows,
                    stats: stats.rows[0]
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
     * Récupérer les statistiques d'un quiz
     * @route GET /api/v1/blog/quiz/:id/stats
     */
    async getQuizStats(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT 
                    q.*,
                    COUNT(rq.id) as total_reponses,
                    COUNT(rq.id) FILTER (WHERE rq.est_correcte = TRUE) as bonnes_reponses,
                    COUNT(rq.id) FILTER (WHERE rq.est_correcte = FALSE) as mauvaises_reponses,
                    ROUND(AVG(rq.points_obtenus)::numeric, 1) as points_moyens,
                    ROUND(AVG(rq.temps_reponse_secondes)::numeric, 1) as temps_moyen_secondes,
                    ROUND(
                        (COUNT(rq.id) FILTER (WHERE rq.est_correcte = TRUE)::decimal / 
                         NULLIF(COUNT(rq.id), 0) * 100), 1
                    ) as taux_reussite,
                    json_agg(json_build_object(
                        'option_id', oq.id,
                        'texte', oq.texte_option,
                        'choix', oq_stats.choix,
                        'pourcentage', ROUND(
                            (oq_stats.choix::decimal / NULLIF(COUNT(rq.id), 0) * 100), 1
                        )
                    ) ORDER BY oq.ordre) as repartition_reponses
                 FROM QUIZ_ARTICLES q
                 LEFT JOIN REPONSES_QUIZ rq ON rq.quiz_id = q.id
                 LEFT JOIN OPTIONS_QUIZ oq ON oq.quiz_id = q.id
                 LEFT JOIN LATERAL (
                     SELECT COUNT(*) as choix 
                     FROM REPONSES_QUIZ 
                     WHERE quiz_id = q.id AND option_id = oq.id
                 ) oq_stats ON TRUE
                 WHERE q.id = $1
                 GROUP BY q.id`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Quiz non trouvé');
            }

            res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            next(error);
        }
    }

    // ========================================================================
    // BADGES LIÉS AUX QUIZ
    // ========================================================================

    /**
     * Vérifier et attribuer les badges de quiz
     * @route POST /api/v1/blog/quiz/verifier-badges
     */
    async verifierBadges(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const badgesAttribues = [];

            // Badge : Expert en quiz (5 quiz avec 100%)
            const quizParfaits = await db.query(
                `SELECT COUNT(*) as count FROM SCORES_UTILISATEUR 
                 WHERE compte_id = $1 AND pourcentage = 100`,
                [req.user.id]
            );

            if (parseInt(quizParfaits.rows[0].count) >= 5) {
                const badge = await db.query(
                    `INSERT INTO BADGES_UTILISATEUR (compte_id, badge_id)
                     SELECT $1, id FROM BADGES_LECTURE WHERE nom_badge = 'Expert en quiz'
                     ON CONFLICT DO NOTHING
                     RETURNING *`,
                    [req.user.id]
                );
                if (badge.rows.length > 0) {
                    badgesAttribues.push({ nom: 'Expert en quiz', description: 'Avoir obtenu 100% à 5 quiz' });
                }
            }

            // Badge : Speed runner (10 réponses en moins de 10 secondes)
            const reponsesRapides = await db.query(
                `SELECT COUNT(*) as count FROM REPONSES_QUIZ 
                 WHERE compte_id = $1 AND est_correcte = TRUE AND temps_reponse_secondes < 10`,
                [req.user.id]
            );

            if (parseInt(reponsesRapides.rows[0].count) >= 10) {
                const badge = await db.query(
                    `INSERT INTO BADGES_UTILISATEUR (compte_id, badge_id)
                     SELECT $1, id FROM BADGES_LECTURE WHERE nom_badge = 'Speed runner'
                     ON CONFLICT DO NOTHING
                     RETURNING *`,
                    [req.user.id]
                );
                if (badge.rows.length > 0) {
                    badgesAttribues.push({ nom: 'Speed runner', description: 'Répondre à 10 quiz en moins de 10 secondes' });
                }
            }

            res.json({
                success: true,
                data: {
                    badges_attribues: badgesAttribues,
                    total_badges: badgesAttribues.length
                },
                message: badgesAttribues.length > 0 
                    ? `${badgesAttribues.length} badge(s) attribué(s) !` 
                    : 'Aucun nouveau badge'
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new QuizController();