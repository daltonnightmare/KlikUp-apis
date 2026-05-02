// src/controllers/blog/SignalementController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError, AuthenticationError, AuthorizationError } = require('../../utils/errors/AppError');
const NotificationService = require('../../services/notification/NotificationService');
const CacheService = require('../../services/cache/CacheService');

class SignalementController {
    
    // ========================================================================
    // CONSTANTES
    // ========================================================================

    // ✅ Motifs de signalement prédéfinis
    static MOTIFS_ARTICLE = [
        'CONTENU_INAPPROPRIE', 'SPAM', 'HARCELEMENT', 'DESINFORMATION',
        'VIOLENCE', 'DISCOURS_HAINEUX', 'CONTENU_CHOQUANT', 'DROITS_AUTEUR',
        'INFORMATION_PERSONNELLE', 'ESCROQUERIE', 'CONTENU_TROMPEUR', 'AUTRE'
    ];

    static MOTIFS_COMMENTAIRE = [
        'SPAM', 'HARCELEMENT', 'LANGAGE_INAPPROPRIE', 'CONTENU_PUBLICITAIRE',
        'DESINFORMATION', 'ATTAQUE_PERSONNELLE', 'CONTENU_ILLICITE', 'AUTRE'
    ];

    static ACTIONS_MODERATION = [
        'MASQUER', 'SUPPRIMER', 'ARCHIVER', 'IGNORER', 'AVERTIR',
        'SUSPENDRE_AUTEUR', 'BANNIR_AUTEUR', 'RESTAURER'
    ];

    // ========================================================================
    // SIGNALER UN ARTICLE
    // ========================================================================

    async signalerArticle(req, res, next) {
        const client = await db.getClient();
        
        try {
            if (!req.user || !req.user.id) {
                throw new AuthenticationError('Authentification requise');
            }

            await client.query('BEGIN');
            
            const { articleId } = req.params;
            const { motif, description, categorie_motif } = req.body;

            // ✅ Validation
            if (!motif || motif.trim().length < 5) {
                throw new ValidationError('Le motif doit contenir au moins 5 caractères');
            }
            if (motif.trim().length > 255) {
                throw new ValidationError('Le motif ne doit pas dépasser 255 caractères');
            }
            if (description && description.length > 1000) {
                throw new ValidationError('La description ne doit pas dépasser 1000 caractères');
            }

            // ✅ Vérifier l'article
            const article = await client.query(
                `SELECT id, auteur_id, titre_article, statut 
                 FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1 AND statut != 'SUPPRIME'`,
                [articleId]
            );
            if (article.rows.length === 0) throw new NotFoundError('Article non trouvé');
            if (article.rows[0].auteur_id === req.user.id) {
                throw new ValidationError('Vous ne pouvez pas signaler votre propre article');
            }

            // ✅ Vérifier si déjà signalé
            const existing = await client.query(
                `SELECT id, statut FROM SIGNALEMENTS_ARTICLES 
                 WHERE article_id = $1 AND compte_id = $2 FOR UPDATE`,
                [articleId, req.user.id]
            );
            if (existing.rows.length > 0 && ['EN_ATTENTE', 'EN_COURS'].includes(existing.rows[0].statut)) {
                throw new ValidationError('Vous avez déjà un signalement en cours pour cet article');
            }

            // ✅ Anti-spam : max 5 signalements/heure
            const recentReports = await client.query(
                `SELECT COUNT(*) as count FROM SIGNALEMENTS_ARTICLES 
                 WHERE compte_id = $1 AND date_signalement > NOW() - INTERVAL '1 hour'`,
                [req.user.id]
            );
            if (parseInt(recentReports.rows[0].count) >= 5) {
                throw new ValidationError('Limite de signalements atteinte. Réessayez plus tard.');
            }

            // ✅ Créer le signalement
            const result = await client.query(
                `INSERT INTO SIGNALEMENTS_ARTICLES (article_id, compte_id, motif, description, statut)
                 VALUES ($1, $2, $3, $4, 'EN_ATTENTE') RETURNING *`,
                [articleId, req.user.id, motif.trim(), description?.trim() || null]
            );

            // ✅ Mettre à jour le statut de l'article si PUBLIE
            if (article.rows[0].statut === 'PUBLIE') {
                await client.query(
                    `UPDATE ARTICLES_BLOG_PLATEFORME SET statut = 'SIGNALE' 
                     WHERE id = $1 AND statut = 'PUBLIE'`,
                    [articleId]
                );
            }

            // ✅ Vérifier le nombre de signalements
            const signalCount = await client.query(
                `SELECT COUNT(*) as total,
                        COUNT(*) FILTER (WHERE statut IN ('EN_ATTENTE', 'EN_COURS')) as en_attente
                 FROM SIGNALEMENTS_ARTICLES WHERE article_id = $1`,
                [articleId]
            );

            const totalSignals = parseInt(signalCount.rows[0].total);
            const pendingSignals = parseInt(signalCount.rows[0].en_attente);

            // ✅ Actions automatiques selon le nombre de signalements
            await this.handleAutoModeration(client, 'ARTICLE', articleId, pendingSignals);

            // ✅ Notifier les modérateurs si seuil atteint
            if (pendingSignals >= 3) {
                setImmediate(() => {
                    this.notifyModerators('ARTICLE', articleId, article.rows[0].titre_article, totalSignals, pendingSignals);
                });
            }

            await client.query('COMMIT');
            CacheService.invalidatePattern('blog:signalements:*').catch(() => {});
            CacheService.del(`blog:article:${articleId}`).catch(() => {});

            res.status(201).json({
                success: true,
                data: { ...result.rows[0], nombre_signalements_total: totalSignals },
                message: 'Signalement envoyé avec succès. Nous l\'examinerons dans les plus brefs délais.'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ========================================================================
    // SIGNALER UN COMMENTAIRE
    // ========================================================================

    async signalerCommentaire(req, res, next) {
        const client = await db.getClient();
        
        try {
            if (!req.user || !req.user.id) throw new AuthenticationError('Authentification requise');
            await client.query('BEGIN');
            
            const { commentaireId } = req.params;
            const { motif, description } = req.body;

            if (!motif || motif.trim().length < 5) {
                throw new ValidationError('Le motif doit contenir au moins 5 caractères');
            }

            // Vérifier le commentaire
            const commentaire = await client.query(
                `SELECT id, auteur_id, contenu_commentaire, statut 
                 FROM COMMENTAIRES WHERE id = $1 AND statut != 'SUPPRIME'`,
                [commentaireId]
            );
            if (commentaire.rows.length === 0) throw new NotFoundError('Commentaire non trouvé');
            if (commentaire.rows[0].auteur_id === req.user.id) {
                throw new ValidationError('Vous ne pouvez pas signaler votre propre commentaire');
            }

            // Vérifier doublon
            const existing = await client.query(
                `SELECT id FROM SIGNALEMENTS_COMMENTAIRES 
                 WHERE commentaire_id = $1 AND compte_id = $2`,
                [commentaireId, req.user.id]
            );
            if (existing.rows.length > 0) throw new ValidationError('Vous avez déjà signalé ce commentaire');

            // Anti-spam
            const recent = await client.query(
                `SELECT COUNT(*) as count FROM SIGNALEMENTS_COMMENTAIRES 
                 WHERE compte_id = $1 AND date_signalement > NOW() - INTERVAL '1 hour'`,
                [req.user.id]
            );
            if (parseInt(recent.rows[0].count) >= 5) throw new ValidationError('Limite de signalements atteinte');

            // Créer le signalement
            const result = await client.query(
                `INSERT INTO SIGNALEMENTS_COMMENTAIRES (commentaire_id, compte_id, motif, description)
                 VALUES ($1, $2, $3, $4) RETURNING *`,
                [commentaireId, req.user.id, motif.trim(), description?.trim() || null]
            );

            // Mettre à jour le commentaire
            await client.query(
                `UPDATE COMMENTAIRES 
                 SET statut = CASE WHEN statut = 'APPROUVE' THEN 'SIGNALE' ELSE statut END,
                     nombre_signalements = nombre_signalements + 1
                 WHERE id = $1`,
                [commentaireId]
            );

            // Vérifier le nombre de signalements
            const signalCount = await client.query(
                `SELECT nombre_signalements FROM COMMENTAIRES WHERE id = $1`,
                [commentaireId]
            );
            const count = parseInt(signalCount.rows[0].nombre_signalements);

            // Actions automatiques
            if (count >= 5) {
                await client.query(`UPDATE COMMENTAIRES SET statut = 'MASQUE' WHERE id = $1`, [commentaireId]);
            } else if (count >= 3) {
                setImmediate(() => {
                    this.notifyModerators('COMMENTAIRE', commentaireId, 'Commentaire', 0, count);
                });
            }

            await client.query('COMMIT');
            CacheService.invalidatePattern('blog:signalements:*').catch(() => {});

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message: 'Signalement envoyé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ========================================================================
    // TRAITER LES SIGNALEMENTS
    // ========================================================================

    async traiterSignalementArticle(req, res, next) {
        const client = await db.getClient();
        
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');
            if (!['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role)) {
                throw new AuthorizationError('Droits insuffisants');
            }
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { statut, action_entreprise, commentaire, notifier_auteur = true } = req.body;

            if (!['TRAITE', 'REJETE', 'EN_COURS'].includes(statut)) {
                throw new ValidationError('Statut invalide');
            }

            const signalement = await client.query(
                `SELECT * FROM SIGNALEMENTS_ARTICLES WHERE id = $1 FOR UPDATE`, [id]
            );
            if (signalement.rows.length === 0) throw new NotFoundError('Signalement non trouvé');

            const signalData = signalement.rows[0];

            // Mettre à jour le signalement
            await client.query(
                `UPDATE SIGNALEMENTS_ARTICLES 
                 SET statut = $1, traite_par = $2, date_traitement = NOW(), action_entreprise = $3
                 WHERE id = $4`,
                [statut, req.user.id, action_entreprise || commentaire, id]
            );

            // Appliquer l'action de modération
            if (statut === 'TRAITE' && action_entreprise) {
                await this.applyModerationAction(client, 'ARTICLE', signalData.article_id, action_entreprise);
            }

            // ✅ Traiter automatiquement tous les signalements similaires
            if (statut === 'TRAITE') {
                await client.query(
                    `UPDATE SIGNALEMENTS_ARTICLES 
                     SET statut = 'TRAITE', traite_par = $1, date_traitement = NOW()
                     WHERE article_id = $2 AND statut IN ('EN_ATTENTE', 'EN_COURS') AND id != $3`,
                    [req.user.id, signalData.article_id, id]
                );
            }

            // Restaurer le statut de l'article si plus de signalements
            const pending = await client.query(
                `SELECT COUNT(*) as count FROM SIGNALEMENTS_ARTICLES 
                 WHERE article_id = $1 AND statut IN ('EN_ATTENTE', 'EN_COURS')`,
                [signalData.article_id]
            );
            if (parseInt(pending.rows[0].count) === 0) {
                await client.query(
                    `UPDATE ARTICLES_BLOG_PLATEFORME SET statut = 'PUBLIE' 
                     WHERE id = $1 AND statut = 'SIGNALE'`,
                    [signalData.article_id]
                );
            }

            // Notifier le signaleur
            if (notifier_auteur) {
                const signaleur = await client.query(
                    'SELECT auteur_id FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                    [signalData.article_id]
                );
                if (signaleur.rows.length > 0) {
                    setImmediate(() => {
                        NotificationService.send({
                            destinataire_id: signalData.compte_id,
                            type: 'SIGNALEMENT_TRAITE',
                            titre: '📋 Votre signalement a été traité',
                            corps: `Votre signalement concernant l'article #${signalData.article_id} a été examiné. Action: ${action_entreprise || 'Examiné'}.${commentaire ? ` Note: ${commentaire}` : ''}`,
                            entite_source_type: 'SIGNALEMENT',
                            entite_source_id: id
                        }).catch(() => {});
                    });
                }
            }

            await client.query('COMMIT');
            CacheService.invalidatePattern('blog:signalements:*').catch(() => {});
            CacheService.invalidatePattern('blog:articles:*').catch(() => {});

            res.json({ success: true, message: 'Signalement traité avec succès' });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    async traiterSignalementCommentaire(req, res, next) {
        const client = await db.getClient();
        
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');
            if (!['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role)) {
                throw new AuthorizationError('Droits insuffisants');
            }
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { statut, action_entreprise } = req.body;
            if (!['TRAITE', 'REJETE'].includes(statut)) throw new ValidationError('Statut invalide');

            const signalement = await client.query(
                `SELECT * FROM SIGNALEMENTS_COMMENTAIRES WHERE id = $1 FOR UPDATE`, [id]
            );
            if (signalement.rows.length === 0) throw new NotFoundError('Signalement non trouvé');

            await client.query(
                `UPDATE SIGNALEMENTS_COMMENTAIRES 
                 SET statut = $1, traite_par = $2, date_traitement = NOW(), action_entreprise = $3
                 WHERE id = $4`,
                [statut, req.user.id, action_entreprise, id]
            );

            if (statut === 'TRAITE' && action_entreprise) {
                await this.applyModerationAction(client, 'COMMENTAIRE', signalement.rows[0].commentaire_id, action_entreprise);
            }

            await client.query('COMMIT');
            CacheService.invalidatePattern('blog:signalements:*').catch(() => {});

            res.json({ success: true, message: 'Signalement traité' });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * ✅ NOUVEAU : Traiter plusieurs signalements en lot (batch)
     * @route POST /api/v1/blog/signalements/traiter-batch
     */
    async traiterBatch(req, res, next) {
        const client = await db.getClient();
        
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');
            if (!['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role)) {
                throw new AuthorizationError('Droits insuffisants');
            }

            const { signalement_ids, action_entreprise, statut = 'TRAITE' } = req.body;

            if (!signalement_ids || !Array.isArray(signalement_ids) || signalement_ids.length === 0) {
                throw new ValidationError('Liste d\'IDs de signalements requise');
            }
            if (signalement_ids.length > 50) throw new ValidationError('Max 50 signalements par lot');

            await client.query('BEGIN');

            let traites = 0;
            for (const sid of signalement_ids) {
                await client.query(
                    `UPDATE SIGNALEMENTS_ARTICLES 
                     SET statut = $1, traite_par = $2, date_traitement = NOW(), action_entreprise = $3
                     WHERE id = $4 AND statut IN ('EN_ATTENTE', 'EN_COURS')`,
                    [statut, req.user.id, action_entreprise, sid]
                );
                traites++;

                // Appliquer l'action si nécessaire
                if (action_entreprise) {
                    const signal = await client.query(
                        'SELECT article_id FROM SIGNALEMENTS_ARTICLES WHERE id = $1', [sid]
                    );
                    if (signal.rows.length > 0) {
                        await this.applyModerationAction(client, 'ARTICLE', signal.rows[0].article_id, action_entreprise);
                    }
                }
            }

            await client.query('COMMIT');
            CacheService.invalidatePattern('blog:signalements:*').catch(() => {});

            res.json({
                success: true,
                data: { traites, total: signalement_ids.length },
                message: `${traites} signalement(s) traité(s)`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ========================================================================
    // RÉCUPÉRER LES SIGNALEMENTS
    // ========================================================================

    async getSignalementsEnAttente(req, res, next) {
        try {
            const { type = 'tous', page = 1, limit = 50, tri = 'date', severite } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            const cacheKey = `signalements:${type}:${page}:${limit}:${tri}`;
            const cached = await CacheService.get(cacheKey);
            if (cached && req.query.skip_cache !== 'true') {
                return res.json({ success: true, ...cached, fromCache: true });
            }

            let allSignalements = [];

            if (type === 'tous' || type === 'articles') {
                const articles = await db.query(
                    `SELECT s.id, s.motif, s.description, s.statut, s.date_signalement,
                            s.article_id as entite_id, a.titre_article as entite_titre, a.slug as entite_slug,
                            signaleur.nom_utilisateur_compte as signaleur_nom,
                            auteur.nom_utilisateur_compte as auteur_nom,
                            'ARTICLE' as type_signalement,
                            (SELECT COUNT(*) FROM SIGNALEMENTS_ARTICLES WHERE article_id = s.article_id AND statut IN ('EN_ATTENTE', 'EN_COURS')) as nombre_signalements,
                            ROUND(EXTRACT(EPOCH FROM (NOW() - s.date_signalement)) / 3600, 1) as heures_attente
                     FROM SIGNALEMENTS_ARTICLES s
                     JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = s.article_id
                     JOIN COMPTES signaleur ON signaleur.id = s.compte_id
                     JOIN COMPTES auteur ON auteur.id = a.auteur_id
                     WHERE s.statut IN ('EN_ATTENTE', 'EN_COURS')`,
                    []
                );
                allSignalements.push(...articles.rows);
            }

            if (type === 'tous' || type === 'commentaires') {
                const commentaires = await db.query(
                    `SELECT s.id, s.motif, s.description, s.statut, s.date_signalement,
                            s.commentaire_id as entite_id, cm.contenu_commentaire as entite_titre, a.slug as entite_slug,
                            signaleur.nom_utilisateur_compte as signaleur_nom,
                            auteur.nom_utilisateur_compte as auteur_nom,
                            'COMMENTAIRE' as type_signalement, cm.nombre_signalements,
                            ROUND(EXTRACT(EPOCH FROM (NOW() - s.date_signalement)) / 3600, 1) as heures_attente
                     FROM SIGNALEMENTS_COMMENTAIRES s
                     JOIN COMMENTAIRES cm ON cm.id = s.commentaire_id
                     JOIN COMPTES signaleur ON signaleur.id = s.compte_id
                     JOIN COMPTES auteur ON auteur.id = cm.auteur_id
                     JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = cm.article_id
                     WHERE s.statut IN ('EN_ATTENTE', 'EN_COURS')`,
                    []
                );
                allSignalements.push(...commentaires.rows);
            }

            // ✅ Filtrer par sévérité
            if (severite === 'critique') {
                allSignalements = allSignalements.filter(s => s.nombre_signalements >= 5);
            } else if (severite === 'eleve') {
                allSignalements = allSignalements.filter(s => s.nombre_signalements >= 3);
            } else if (severite === 'urgent') {
                allSignalements = allSignalements.filter(s => s.heures_attente > 24);
            }

            // Trier
            const sortFns = {
                'date': (a, b) => new Date(b.date_signalement) - new Date(a.date_signalement),
                'priorite': (a, b) => b.nombre_signalements - a.nombre_signalements,
                'urgence': (a, b) => b.heures_attente - a.heures_attente
            };
            allSignalements.sort(sortFns[tri] || sortFns.date);

            const total = allSignalements.length;
            const paginated = allSignalements.slice(offset, offset + parseInt(limit));

            const responseData = {
                success: true,
                data: paginated,
                stats: {
                    total_signalements: total,
                    articles: allSignalements.filter(s => s.type_signalement === 'ARTICLE').length,
                    commentaires: allSignalements.filter(s => s.type_signalement === 'COMMENTAIRE').length,
                    critiques: allSignalements.filter(s => s.nombre_signalements >= 5).length,
                    urgents: allSignalements.filter(s => s.heures_attente > 24).length
                },
                pagination: {
                    page: parseInt(page), limit: parseInt(limit), total,
                    pages: Math.ceil(total / Math.max(1, parseInt(limit)))
                }
            };

            CacheService.set(cacheKey, responseData, 60).catch(() => {});
            res.json(responseData);

        } catch (error) {
            next(error);
        }
    }

    /**
     * ✅ NOUVEAU : Statistiques des signalements
     * @route GET /api/v1/blog/signalements/stats
     */
    async getSignalementStats(req, res, next) {
        try {
            const { periode = '30d' } = req.query;
            let dateFilter = "date_signalement > NOW() - INTERVAL '30 days'";
            if (periode === '7d') dateFilter = "date_signalement > NOW() - INTERVAL '7 days'";
            else if (periode === '24h') dateFilter = "date_signalement > NOW() - INTERVAL '24 hours'";

            const stats = await db.query(`
                SELECT 
                    'ARTICLES' as type,
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE statut = 'EN_ATTENTE') as en_attente,
                    COUNT(*) FILTER (WHERE statut = 'TRAITE') as traites,
                    ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(date_traitement, NOW()) - date_signalement)) / 3600), 1) as delai_moyen_heures
                FROM SIGNALEMENTS_ARTICLES WHERE ${dateFilter}
                UNION ALL
                SELECT 
                    'COMMENTAIRES', COUNT(*),
                    COUNT(*) FILTER (WHERE statut = 'EN_ATTENTE'),
                    COUNT(*) FILTER (WHERE statut = 'TRAITE'),
                    ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(date_traitement, NOW()) - date_signalement)) / 3600), 1)
                FROM SIGNALEMENTS_COMMENTAIRES WHERE ${dateFilter}
            `);

            // Motifs les plus fréquents
            const topMotifs = await db.query(`
                SELECT motif, COUNT(*) as nombre FROM (
                    SELECT motif FROM SIGNALEMENTS_ARTICLES WHERE ${dateFilter}
                    UNION ALL
                    SELECT motif FROM SIGNALEMENTS_COMMENTAIRES WHERE ${dateFilter}
                ) all_signals
                GROUP BY motif ORDER BY nombre DESC LIMIT 10
            `);

            res.json({
                success: true,
                data: {
                    stats: stats.rows,
                    top_motifs: topMotifs.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }

    async getUserSignalements(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');
            const { page = 1, limit = 20 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            const articleSignals = await db.query(
                `SELECT s.*, a.titre_article, 'ARTICLE' as type
                 FROM SIGNALEMENTS_ARTICLES s JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = s.article_id
                 WHERE s.compte_id = $1 ORDER BY s.date_signalement DESC`,
                [req.user.id]
            );

            const commentSignals = await db.query(
                `SELECT s.*, cm.contenu_commentaire, 'COMMENTAIRE' as type
                 FROM SIGNALEMENTS_COMMENTAIRES s JOIN COMMENTAIRES cm ON cm.id = s.commentaire_id
                 WHERE s.compte_id = $1 ORDER BY s.date_signalement DESC`,
                [req.user.id]
            );

            const all = [...articleSignals.rows, ...commentSignals.rows]
                .sort((a, b) => new Date(b.date_signalement) - new Date(a.date_signalement));

            const total = all.length;
            const paginated = all.slice(offset, offset + parseInt(limit));

            res.json({
                success: true, data: paginated,
                pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / Math.max(1, parseInt(limit))) }
            });
        } catch (error) {
            next(error);
        }
    }

    // ========================================================================
    // MÉTHODES PRIVÉES
    // ========================================================================

    /**
     * Gère la modération automatique selon le nombre de signalements
     */
    async handleAutoModeration(client, type, entiteId, signalCount) {
        if (signalCount >= 10) {
            // Masquage automatique
            const table = type === 'ARTICLE' ? 'ARTICLES_BLOG_PLATEFORME' : 'COMMENTAIRES';
            await client.query(
                `UPDATE ${table} SET statut = 'MASQUE' WHERE id = $1`,
                [entiteId]
            );
        }
    }

    /**
     * Notifie tous les modérateurs
     */
    async notifyModerators(type, entiteId, titre, total, pending) {
        try {
            const moderators = await db.query(
                `SELECT id FROM COMPTES WHERE compte_role IN ('ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME') AND est_supprime = FALSE`
            );

            for (const mod of moderators.rows) {
                await NotificationService.send({
                    destinataire_id: mod.id,
                    type: 'SIGNALEMENTS_MULTIPLES',
                    titre: `⚠️ ${type} signalé plusieurs fois`,
                    corps: `"${titre?.substring(0, 80)}" a reçu ${total} signalements (${pending} en attente)`,
                    entite_source_type: type === 'ARTICLE' ? 'ARTICLE_BLOG' : 'COMMENTAIRE',
                    entite_source_id: entiteId,
                    priorite: pending >= 5 ? 'CRITIQUE' : 'HAUTE'
                });
            }
        } catch (error) {
            console.error('Erreur notification modérateurs:', error);
        }
    }

    /**
     * Applique une action de modération
     */
    async applyModerationAction(client, type, entiteId, action) {
        const [actionName, ...params] = action.split(':');

        switch (actionName) {
            case 'MASQUER':
                if (type === 'ARTICLE') {
                    await client.query(`UPDATE ARTICLES_BLOG_PLATEFORME SET statut = 'MASQUE' WHERE id = $1`, [entiteId]);
                } else {
                    await client.query(`UPDATE COMMENTAIRES SET statut = 'MASQUE' WHERE id = $1`, [entiteId]);
                }
                break;

            case 'SUPPRIMER':
                if (type === 'ARTICLE') {
                    await client.query(`UPDATE ARTICLES_BLOG_PLATEFORME SET statut = 'SUPPRIME', est_archive = TRUE, date_archivage = NOW() WHERE id = $1`, [entiteId]);
                } else {
                    await client.query(`UPDATE COMMENTAIRES SET statut = 'SUPPRIME' WHERE id = $1`, [entiteId]);
                }
                break;

            case 'ARCHIVER':
                if (type === 'ARTICLE') {
                    await client.query(`UPDATE ARTICLES_BLOG_PLATEFORME SET est_archive = TRUE, date_archivage = NOW() WHERE id = $1`, [entiteId]);
                }
                break;

            case 'AVERTIR':
                const auteurQuery = type === 'ARTICLE'
                    ? 'SELECT auteur_id FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1'
                    : 'SELECT auteur_id FROM COMMENTAIRES WHERE id = $1';
                const auteur = await client.query(auteurQuery, [entiteId]);
                if (auteur.rows.length > 0) {
                    setImmediate(() => {
                        NotificationService.send({
                            destinataire_id: auteur.rows[0].auteur_id,
                            type: 'AVERTISSEMENT_CONTENU',
                            titre: '⚠️ Avertissement',
                            corps: params[0] || 'Votre contenu a été signalé. Veuillez respecter les règles.',
                            entite_source_type: type === 'ARTICLE' ? 'ARTICLE_BLOG' : 'COMMENTAIRE',
                            entite_source_id: entiteId,
                            priorite: 'HAUTE'
                        }).catch(() => {});
                    });
                }
                break;

            case 'RESTAURER':
                if (type === 'ARTICLE') {
                    await client.query(`UPDATE ARTICLES_BLOG_PLATEFORME SET statut = 'PUBLIE' WHERE id = $1`, [entiteId]);
                } else {
                    await client.query(`UPDATE COMMENTAIRES SET statut = 'APPROUVE' WHERE id = $1`, [entiteId]);
                }
                break;

            case 'IGNORER':
            default:
                break;
        }
    }
}

module.exports = new SignalementController();