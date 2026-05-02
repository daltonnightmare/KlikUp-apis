// src/controllers/blog/SondageController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError, AuthorizationError, AuthenticationError } = require('../../utils/errors/AppError');
const CacheService = require('../../services/cache/CacheService');
const NotificationService = require('../../services/notification/NotificationService');

class SondageController {

    // ========================================================================
    // CRUD SONDAGE
    // ========================================================================

    /**
     * Créer un sondage pour un article
     * @route POST /api/v1/blog/articles/:articleId/sondages
     */
    async create(req, res, next) {
        const client = await db.getClient();
        
        try {
            await client.query('BEGIN');
            
            const { articleId } = req.params;
            const {
                question,
                description,
                type_sondage = 'UNIQUE',
                date_fin,
                options = [],  // [{ texte_option, couleur, image_url, ordre }]
                ordre = 0
            } = req.body;

            // Validation
            if (!question || question.trim().length < 10) {
                throw new ValidationError('La question doit contenir au moins 10 caractères');
            }

            if (!['UNIQUE', 'MULTIPLE', 'CLASSEMENT', 'NOTE'].includes(type_sondage)) {
                throw new ValidationError('Type de sondage invalide. Types valides: UNIQUE, MULTIPLE, CLASSEMENT, NOTE');
            }

            if (!options || !Array.isArray(options) || options.length < 2) {
                throw new ValidationError('Au moins 2 options sont requises');
            }

            if (options.length > 10) {
                throw new ValidationError('Maximum 10 options autorisées');
            }

            // Pour le type NOTE, les options doivent être des notes (1-5 ou 1-10)
            if (type_sondage === 'NOTE') {
                // On peut générer automatiquement les options de 1 à 5
                if (options.length === 0) {
                    for (let i = 1; i <= 5; i++) {
                        options.push({
                            texte_option: `${i} étoile${i > 1 ? 's' : ''}`,
                            couleur: this.getCouleurNote(i),
                            ordre: i - 1
                        });
                    }
                }
            }

            // Vérifier que l'article existe
            const article = await client.query(
                'SELECT id, auteur_id FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                [articleId]
            );

            if (article.rows.length === 0) {
                throw new NotFoundError('Article non trouvé');
            }

            // Vérifier les droits
            if (article.rows[0].auteur_id !== req.user.id && 
                !['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role)) {
                throw new AuthorizationError('Vous n\'avez pas les droits pour créer un sondage');
            }

            // Date de fin par défaut : 7 jours
            const dateFinEffective = date_fin || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

            // Créer le sondage
            const sondageResult = await client.query(
                `INSERT INTO SONDAGES_ARTICLES (article_id, question, description, type_sondage, date_fin, ordre, est_actif)
                 VALUES ($1, $2, $3, $4, $5, $6, TRUE)
                 RETURNING *`,
                [articleId, question.trim(), description || null, type_sondage, dateFinEffective, ordre]
            );

            const sondage = sondageResult.rows[0];

            // Créer les options
            const createdOptions = [];
            for (const option of options) {
                const optResult = await client.query(
                    `INSERT INTO OPTIONS_SONDAGE (sondage_id, texte_option, couleur, image_url, ordre)
                     VALUES ($1, $2, $3, $4, $5)
                     RETURNING *`,
                    [
                        sondage.id, 
                        option.texte_option, 
                        option.couleur || this.getCouleurAleatoire(),
                        option.image_url || null,
                        option.ordre || createdOptions.length
                    ]
                );
                createdOptions.push(optResult.rows[0]);
            }

            // Mettre à jour l'article
            await client.query(
                'UPDATE ARTICLES_BLOG_PLATEFORME SET contient_sondage = TRUE WHERE id = $1',
                [articleId]
            );

            await client.query('COMMIT');

            // Invalider le cache
            CacheService.del(`blog:article:${articleId}`).catch(() => {});
            CacheService.invalidatePattern('blog:articles:*').catch(() => {});

            res.status(201).json({
                success: true,
                data: { ...sondage, options: createdOptions },
                message: 'Sondage créé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour un sondage
     * @route PUT /api/v1/blog/sondages/:id
     */
    async update(req, res, next) {
        const client = await db.getClient();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const updateData = req.body;

            // Vérifier l'existence et les droits
            const sondageQuery = await client.query(
                `SELECT s.*, a.auteur_id 
                 FROM SONDAGES_ARTICLES s 
                 JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = s.article_id 
                 WHERE s.id = $1`,
                [id]
            );

            if (sondageQuery.rows.length === 0) {
                throw new NotFoundError('Sondage non trouvé');
            }

            const sondage = sondageQuery.rows[0];

            // Vérifier les droits
            if (sondage.auteur_id !== req.user.id && 
                !['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role)) {
                throw new AuthorizationError('Droits insuffisants');
            }

            // Vérifier si le sondage a des votes
            const votesCount = await client.query(
                'SELECT COUNT(*) as count FROM VOTES_SONDAGE WHERE sondage_id = $1',
                [id]
            );

            if (parseInt(votesCount.rows[0].count) > 0 && updateData.options) {
                throw new ValidationError('Impossible de modifier les options d\'un sondage qui a déjà des votes');
            }

            // Mettre à jour les champs de base
            const allowedFields = ['question', 'description', 'date_fin', 'est_actif', 'ordre'];
            const setClauses = [];
            const values = [id];
            let vi = 2;

            for (const field of allowedFields) {
                if (updateData[field] !== undefined) {
                    setClauses.push(`${field} = $${vi}`);
                    values.push(updateData[field]);
                    vi++;
                }
            }

            if (setClauses.length > 0) {
                await client.query(
                    `UPDATE SONDAGES_ARTICLES SET ${setClauses.join(', ')} WHERE id = $1`,
                    values
                );
            }

            // Mettre à jour les options si aucune réponse
            if (updateData.options && parseInt(votesCount.rows[0].count) === 0) {
                await client.query('DELETE FROM OPTIONS_SONDAGE WHERE sondage_id = $1', [id]);
                
                for (const option of updateData.options) {
                    await client.query(
                        `INSERT INTO OPTIONS_SONDAGE (sondage_id, texte_option, couleur, image_url, ordre)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [id, option.texte_option, option.couleur || this.getCouleurAleatoire(), option.image_url || null, option.ordre || 0]
                    );
                }
            }

            // Récupérer le sondage mis à jour
            const updated = await this.getSondageWithOptions(client, id);

            await client.query('COMMIT');

            // Invalider les caches
            CacheService.del(`blog:article:${sondage.article_id}`).catch(() => {});
            CacheService.del(`sondage:${id}`).catch(() => {});
            CacheService.invalidatePattern('blog:sondages:*').catch(() => {});

            res.json({
                success: true,
                data: updated,
                message: 'Sondage mis à jour avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer un sondage
     * @route DELETE /api/v1/blog/sondages/:id
     */
    async delete(req, res, next) {
        const client = await db.getClient();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;

            const sondage = await client.query(
                `SELECT s.*, a.auteur_id 
                 FROM SONDAGES_ARTICLES s 
                 JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = s.article_id 
                 WHERE s.id = $1`,
                [id]
            );

            if (sondage.rows.length === 0) {
                throw new NotFoundError('Sondage non trouvé');
            }

            if (sondage.rows[0].auteur_id !== req.user.id && 
                !['ADMINISTRATEUR_PLATEFORME'].includes(req.user.compte_role)) {
                throw new AuthorizationError('Droits insuffisants');
            }

            const articleId = sondage.rows[0].article_id;

            // Supprimer le sondage (les options et votes seront supprimés en cascade)
            await client.query('DELETE FROM SONDAGES_ARTICLES WHERE id = $1', [id]);

            // Vérifier s'il reste des sondages pour cet article
            const remaining = await client.query(
                'SELECT COUNT(*) as count FROM SONDAGES_ARTICLES WHERE article_id = $1',
                [articleId]
            );

            if (parseInt(remaining.rows[0].count) === 0) {
                await client.query(
                    'UPDATE ARTICLES_BLOG_PLATEFORME SET contient_sondage = FALSE WHERE id = $1',
                    [articleId]
                );
            }

            await client.query('COMMIT');

            CacheService.del(`blog:article:${articleId}`).catch(() => {});
            CacheService.del(`sondage:${id}`).catch(() => {});
            CacheService.invalidatePattern('blog:sondages:*').catch(() => {});

            res.json({
                success: true,
                message: 'Sondage supprimé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ========================================================================
    // VOTER
    // ========================================================================

    /**
     * Voter dans un sondage
     * @route POST /api/v1/blog/sondages/:id/voter
     */
    async voter(req, res, next) {
        const client = await db.getClient();
        
        try {
            if (!req.user || !req.user.id) {
                throw new AuthenticationError('Authentification requise pour voter');
            }

            await client.query('BEGIN');
            
            const { id } = req.params;
            const { option_ids } = req.body;  // Tableau d'IDs pour les sondages multiples

            // Vérifier que le sondage existe et est actif
            const sondage = await client.query(
                `SELECT s.*, COUNT(v.id) as votes_existants
                 FROM SONDAGES_ARTICLES s
                 LEFT JOIN VOTES_SONDAGE v ON v.sondage_id = s.id AND v.compte_id = $2
                 WHERE s.id = $1
                 GROUP BY s.id`,
                [id, req.user.id]
            );

            if (sondage.rows.length === 0) {
                throw new NotFoundError('Sondage non trouvé');
            }

            const sondageData = sondage.rows[0];

            // Vérifier que le sondage est actif
            if (!sondageData.est_actif) {
                throw new ValidationError('Ce sondage est fermé');
            }

            // Vérifier la date de fin
            if (sondageData.date_fin && new Date(sondageData.date_fin) < new Date()) {
                throw new ValidationError('Ce sondage est terminé');
            }

            // Validation selon le type de sondage
            const options = Array.isArray(option_ids) ? option_ids : [option_ids];

            if (sondageData.type_sondage === 'UNIQUE') {
                if (options.length !== 1) {
                    throw new ValidationError('Vous devez sélectionner exactement une option pour ce sondage');
                }
                // Vérifier si l'utilisateur a déjà voté
                if (parseInt(sondageData.votes_existants) > 0) {
                    throw new ValidationError('Vous avez déjà voté pour ce sondage');
                }
            } else if (sondageData.type_sondage === 'MULTIPLE') {
                if (options.length < 1) {
                    throw new ValidationError('Sélectionnez au moins une option');
                }
                // Vérifier les doublons
                const existingVotes = await client.query(
                    'SELECT option_id FROM VOTES_SONDAGE WHERE sondage_id = $1 AND compte_id = $2',
                    [id, req.user.id]
                );
                const existingOptionIds = existingVotes.rows.map(r => r.option_id);
                
                // Filtrer les options déjà votées
                const newOptions = options.filter(oid => !existingOptionIds.includes(oid));
                if (newOptions.length === 0) {
                    throw new ValidationError('Vous avez déjà voté pour ces options');
                }
            } else if (sondageData.type_sondage === 'CLASSEMENT') {
                if (options.length < 2) {
                    throw new ValidationError('Classez au moins 2 options');
                }
            }

            // Vérifier que les options appartiennent au sondage
            const optionsCheck = await client.query(
                `SELECT id FROM OPTIONS_SONDAGE WHERE sondage_id = $1 AND id = ANY($2::int[])`,
                [id, options]
            );

            if (optionsCheck.rows.length !== options.length) {
                throw new ValidationError('Une ou plusieurs options sont invalides');
            }

            // Enregistrer les votes
            const votesEnregistres = [];
            for (const optionId of options) {
                const voteResult = await client.query(
                    `INSERT INTO VOTES_SONDAGE (sondage_id, option_id, compte_id)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (sondage_id, option_id, compte_id) DO NOTHING
                     RETURNING *`,
                    [id, optionId, req.user.id]
                );
                if (voteResult.rows.length > 0) {
                    votesEnregistres.push(voteResult.rows[0]);
                }
            }

            await client.query('COMMIT');

            // Récupérer les résultats mis à jour
            const resultats = await this.getResultatsSondage(id, req.user.id);

            // Invalider le cache
            CacheService.del(`sondage:${id}:resultats`).catch(() => {});
            CacheService.del(`blog:article:${sondageData.article_id}`).catch(() => {});

            // Notification à l'auteur du sondage (optionnel)
            const article = await db.query(
                'SELECT auteur_id FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                [sondageData.article_id]
            );

            if (article.rows[0]?.auteur_id !== req.user.id && sondageData.nombre_votes % 10 === 0) {
                setImmediate(() => {
                    NotificationService.send({
                        destinataire_id: article.rows[0].auteur_id,
                        type: 'SONDAGE_MILESTONE',
                        titre: '🎯 Votre sondage gagne en popularité !',
                        corps: `Votre sondage "${sondageData.question.substring(0, 50)}..." a atteint ${sondageData.nombre_votes + votesEnregistres.length} votes !`,
                        entite_source_type: 'SONDAGE',
                        entite_source_id: id
                    }).catch(() => {});
                });
            }

            res.json({
                success: true,
                data: {
                    votes: votesEnregistres,
                    resultats: resultats
                },
                message: 'Vote enregistré avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Annuler son vote
     * @route DELETE /api/v1/blog/sondages/:id/voter
     */
    async annulerVote(req, res, next) {
        const client = await db.getClient();
        
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            await client.query('BEGIN');
            
            const { id } = req.params;
            const { option_id } = req.body;  // Optionnel, si non fourni, annule tous les votes

            if (option_id) {
                // Annuler un vote spécifique
                await client.query(
                    'DELETE FROM VOTES_SONDAGE WHERE sondage_id = $1 AND compte_id = $2 AND option_id = $3',
                    [id, req.user.id, option_id]
                );
            } else {
                // Annuler tous les votes de l'utilisateur pour ce sondage
                await client.query(
                    'DELETE FROM VOTES_SONDAGE WHERE sondage_id = $1 AND compte_id = $2',
                    [id, req.user.id]
                );
            }

            await client.query('COMMIT');

            // Récupérer les résultats mis à jour
            const resultats = await this.getResultatsSondage(id, req.user.id);

            CacheService.del(`sondage:${id}:resultats`).catch(() => {});

            res.json({
                success: true,
                data: { resultats },
                message: 'Vote annulé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ========================================================================
    // RÉCUPÉRATION DES SONDAGES ET RÉSULTATS
    // ========================================================================

    /**
     * Récupérer les sondages d'un article
     * @route GET /api/v1/blog/articles/:articleId/sondages
     */
    async getByArticle(req, res, next) {
        try {
            const { articleId } = req.params;

            const cacheKey = `blog:article:${articleId}:sondages`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({ success: true, data: cached, fromCache: true });
            }

            const result = await db.query(
                `SELECT s.*,
                        COALESCE(json_agg(json_build_object(
                            'id', os.id, 'texte_option', os.texte_option, 
                            'couleur', os.couleur, 'image_url', os.image_url,
                            'nombre_votes', os.nombre_votes, 'ordre', os.ordre
                        ) ORDER BY os.ordre) FILTER (WHERE os.id IS NOT NULL), '[]') as options,
                        s.nombre_votes as total_votes,
                        CASE WHEN $2::int IS NOT NULL THEN
                            EXISTS(SELECT 1 FROM VOTES_SONDAGE WHERE sondage_id = s.id AND compte_id = $2)
                        ELSE FALSE END as a_vote,
                        CASE WHEN s.date_fin IS NOT NULL AND s.date_fin < NOW() THEN TRUE ELSE FALSE END as est_termine
                 FROM SONDAGES_ARTICLES s
                 LEFT JOIN OPTIONS_SONDAGE os ON os.sondage_id = s.id
                 WHERE s.article_id = $1 AND s.est_actif = TRUE
                 GROUP BY s.id
                 ORDER BY s.ordre`,
                [articleId, req.user?.id || null]
            );

            // Si l'utilisateur est connecté, ajouter ses votes
            if (req.user && result.rows.length > 0) {
                const sondageIds = result.rows.map(s => s.id);
                const votes = await db.query(
                    `SELECT sondage_id, option_id 
                     FROM VOTES_SONDAGE 
                     WHERE sondage_id = ANY($1::int[]) AND compte_id = $2`,
                    [sondageIds, req.user.id]
                );

                const votesMap = new Map();
                for (const vote of votes.rows) {
                    if (!votesMap.has(vote.sondage_id)) {
                        votesMap.set(vote.sondage_id, []);
                    }
                    votesMap.get(vote.sondage_id).push(vote.option_id);
                }

                for (const sondage of result.rows) {
                    sondage.user_votes = votesMap.get(sondage.id) || [];
                    sondage.a_vote = sondage.user_votes.length > 0;
                }
            }

            // Calculer les pourcentages
            for (const sondage of result.rows) {
                const totalVotes = sondage.options.reduce((sum, opt) => sum + parseInt(opt.nombre_votes), 0);
                for (const option of sondage.options) {
                    option.pourcentage = totalVotes > 0 
                        ? Math.round((parseInt(option.nombre_votes) / totalVotes) * 1000) / 10 
                        : 0;
                }
            }

            CacheService.set(cacheKey, result.rows, 60).catch(() => {}); // Cache 1 minute

            res.json({
                success: true,
                data: result.rows
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les résultats détaillés d'un sondage
     * @route GET /api/v1/blog/sondages/:id/resultats
     */
    async getResultats(req, res, next) {
        try {
            const { id } = req.params;

            const cacheKey = `sondage:${id}:resultats`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({ success: true, data: cached, fromCache: true });
            }

            const resultats = await this.getResultatsSondage(id, req.user?.id);

            CacheService.set(cacheKey, resultats, 60).catch(() => {});

            res.json({
                success: true,
                data: resultats
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les sondages tendances
     * @route GET /api/v1/blog/sondages/tendances
     */
    async getTendances(req, res, next) {
        try {
            const { limit = 10 } = req.query;

            const result = await db.query(
                `SELECT s.*,
                        a.titre_article,
                        a.slug as article_slug,
                        COUNT(v.id) as total_votes,
                        (SELECT COUNT(*) FROM COMMENTAIRES WHERE article_id = a.id) as commentaires
                 FROM SONDAGES_ARTICLES s
                 JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = s.article_id
                 LEFT JOIN VOTES_SONDAGE v ON v.sondage_id = s.id
                 WHERE s.est_actif = TRUE 
                   AND (s.date_fin IS NULL OR s.date_fin > NOW())
                   AND a.statut = 'PUBLIE'
                 GROUP BY s.id, a.id
                 ORDER BY total_votes DESC, s.date_debut DESC
                 LIMIT $1`,
                [parseInt(limit)]
            );

            res.json({
                success: true,
                data: result.rows
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer l'historique des votes d'un utilisateur
     * @route GET /api/v1/blog/sondages/mes-votes
     */
    async getMesVotes(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const { page = 1, limit = 20 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            const result = await db.query(
                `SELECT 
                    v.*,
                    s.question as sondage_question,
                    s.type_sondage,
                    os.texte_option as option_choisie,
                    os.couleur as option_couleur,
                    a.titre_article,
                    a.slug as article_slug,
                    COUNT(*) OVER() as total_count
                 FROM VOTES_SONDAGE v
                 JOIN SONDAGES_ARTICLES s ON s.id = v.sondage_id
                 JOIN OPTIONS_SONDAGE os ON os.id = v.option_id
                 JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = s.article_id
                 WHERE v.compte_id = $1
                 ORDER BY v.date_vote DESC
                 LIMIT $2 OFFSET $3`,
                [req.user.id, parseInt(limit), offset]
            );

            const total = result.rows[0]?.total_count || 0;

            res.json({
                success: true,
                data: result.rows,
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

    // ========================================================================
    // MÉTHODES PRIVÉES
    // ========================================================================

    /**
     * Récupère un sondage avec ses options
     */
    async getSondageWithOptions(client, id) {
        const result = await client.query(
            `SELECT s.*,
                    COALESCE(json_agg(json_build_object(
                        'id', os.id, 'texte_option', os.texte_option, 
                        'couleur', os.couleur, 'image_url', os.image_url,
                        'nombre_votes', os.nombre_votes, 'ordre', os.ordre
                    ) ORDER BY os.ordre) FILTER (WHERE os.id IS NOT NULL), '[]') as options
             FROM SONDAGES_ARTICLES s
             LEFT JOIN OPTIONS_SONDAGE os ON os.sondage_id = s.id
             WHERE s.id = $1
             GROUP BY s.id`,
            [id]
        );
        return result.rows[0] || null;
    }

    /**
     * Récupère les résultats détaillés d'un sondage
     */
    async getResultatsSondage(sondageId, userId) {
        // Récupérer le sondage avec les votes
        const sondageResult = await db.query(
            `SELECT s.*,
                    COALESCE(json_agg(json_build_object(
                        'id', os.id, 'texte_option', os.texte_option, 
                        'couleur', os.couleur, 'image_url', os.image_url,
                        'nombre_votes', os.nombre_votes, 'ordre', os.ordre,
                        'pourcentage', CASE 
                            WHEN (SELECT COUNT(*) FROM VOTES_SONDAGE WHERE sondage_id = $1) > 0 
                            THEN ROUND((os.nombre_votes::decimal / (SELECT COUNT(*) FROM VOTES_SONDAGE WHERE sondage_id = $1)) * 100, 1)
                            ELSE 0 
                        END
                    ) ORDER BY os.ordre) FILTER (WHERE os.id IS NOT NULL), '[]') as options,
                    (SELECT COUNT(*) FROM VOTES_SONDAGE WHERE sondage_id = $1) as total_votes
             FROM SONDAGES_ARTICLES s
             LEFT JOIN OPTIONS_SONDAGE os ON os.sondage_id = s.id
             WHERE s.id = $1
             GROUP BY s.id`,
            [sondageId]
        );

        if (sondageResult.rows.length === 0) {
            throw new NotFoundError('Sondage non trouvé');
        }

        const resultats = sondageResult.rows[0];

        // Ajouter les votes de l'utilisateur si connecté
        if (userId) {
            const userVotes = await db.query(
                `SELECT option_id FROM VOTES_SONDAGE WHERE sondage_id = $1 AND compte_id = $2`,
                [sondageId, userId]
            );
            resultats.user_votes = userVotes.rows.map(r => r.option_id);
            resultats.a_vote = resultats.user_votes.length > 0;
        }

        // Calculer l'option gagnante
        if (resultats.options && resultats.options.length > 0) {
            let maxVotes = 0;
            for (const option of resultats.options) {
                if (parseInt(option.nombre_votes) > maxVotes) {
                    maxVotes = parseInt(option.nombre_votes);
                    resultats.option_gagnante = option;
                }
            }
        }

        return resultats;
    }

    /**
     * Génère une couleur aléatoire pour les options
     */
    getCouleurAleatoire() {
        const couleurs = [
            '#4F46E5', '#7C3AED', '#EC4899', '#EF4444', '#F59E0B',
            '#10B981', '#06B6D4', '#3B82F6', '#8B5CF6', '#F97316'
        ];
        return couleurs[Math.floor(Math.random() * couleurs.length)];
    }

    /**
     * Retourne une couleur selon la note
     */
    getCouleurNote(note) {
        const couleurs = {
            1: '#EF4444', // Rouge
            2: '#F59E0B', // Orange
            3: '#FACC15', // Jaune
            4: '#10B981', // Vert
            5: '#4F46E5'  // Indigo
        };
        return couleurs[note] || '#6B7280';
    }
}

module.exports = new SondageController();