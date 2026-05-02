// src/controllers/blog/CommentaireController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError, AuthorizationError, AuthenticationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const NotificationService = require('../../services/notification/NotificationService');
const CacheService = require('../../services/cache/CacheService');

class CommentaireController {
    
    // ========================================================================
    // CRÉER UN COMMENTAIRE
    // ========================================================================

    async create(req, res, next) {
        const client = await db.getClient();
        
        try {
            if (!req.user || !req.user.id) {
                throw new AuthenticationError('Authentification requise');
            }

            await client.query('BEGIN');
            
            const { articleId } = req.params;
            const {
                contenu_commentaire,
                commentaire_parent_id,
                est_anonyme = false,
                pseudo_anonyme,
                note
            } = req.body;

            // Validation stricte
            if (!contenu_commentaire || contenu_commentaire.trim().length < 2) {
                throw new ValidationError('Le commentaire doit contenir au moins 2 caractères');
            }
            if (contenu_commentaire.trim().length > 2000) {
                throw new ValidationError('Le commentaire ne doit pas dépasser 2000 caractères');
            }
            if (note !== undefined && (note < 1 || note > 5)) {
                throw new ValidationError('La note doit être entre 1 et 5');
            }
            if (est_anonyme && !pseudo_anonyme) {
                throw new ValidationError('Un pseudo est requis pour un commentaire anonyme');
            }

            // Anti-spam : max 10 commentaires/heure
            const recentComments = await client.query(
                `SELECT COUNT(*) as count FROM COMMENTAIRES 
                 WHERE auteur_id = $1 AND date_creation > NOW() - INTERVAL '1 hour'`,
                [req.user.id]
            );
            if (parseInt(recentComments.rows[0].count) >= 10) {
                throw new ValidationError('Limite de commentaires atteinte. Réessayez plus tard.');
            }

            // Vérifier l'article
            const article = await client.query(
                `SELECT id, auteur_id, titre_article, slug, est_commentaire_actif, statut
                 FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1 AND statut = 'PUBLIE'`,
                [articleId]
            );
            if (article.rows.length === 0) throw new NotFoundError('Article non trouvé');
            if (!article.rows[0].est_commentaire_actif) throw new ValidationError('Commentaires désactivés');

            // Vérifier le parent et la profondeur
            if (commentaire_parent_id) {
                const parent = await client.query(
                    `SELECT id FROM COMMENTAIRES WHERE id = $1 AND article_id = $2 AND statut = 'APPROUVE'`,
                    [commentaire_parent_id, articleId]
                );
                if (parent.rows.length === 0) throw new ValidationError('Commentaire parent invalide');
                
                const niveau = await this.getNiveauImbrication(client, commentaire_parent_id);
                if (niveau >= 3) throw new ValidationError('Profondeur maximum atteinte (3 niveaux)');
            }

            // Auto-approbation pour rôles de confiance
            const autoApproveRoles = [
                'ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME', 'BLOGUEUR_PLATEFORME',
                'ADMINISTRATEUR_COMPAGNIE', 'STAFF_COMPAGNIE'
            ];
            const statut = autoApproveRoles.includes(req.user.compte_role) ? 'APPROUVE' : 'EN_ATTENTE';

            // Créer le commentaire
            const result = await client.query(
                `INSERT INTO COMMENTAIRES (
                    contenu_commentaire, contenu_original, article_id, commentaire_parent_id,
                    auteur_id, est_anonyme, pseudo_anonyme, note, statut,
                    adresse_ip, user_agent, compagnie_id, restaurant_id, boutique_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                RETURNING *`,
                [
                    contenu_commentaire.trim(), contenu_commentaire.trim(),
                    articleId, commentaire_parent_id || null, req.user.id,
                    est_anonyme, est_anonyme ? pseudo_anonyme : null,
                    note || null, statut, req.ip, req.headers['user-agent'],
                    req.user.compagnie_id || null, req.user.restaurant_id || null,
                    req.user.boutique_id || null
                ]
            );

            const commentaire = result.rows[0];

            // Mettre à jour les compteurs si approuvé
            if (statut === 'APPROUVE') {
                await this.updateCounters(client, articleId, commentaire_parent_id, 1);
            }

            // Journaliser
            AuditService.log({
                action: 'CREATE', ressource_type: 'COMMENTAIRE',
                ressource_id: commentaire.id, utilisateur_id: req.user.id,
                donnees_apres: commentaire
            }).catch(() => {});

            // Notifications (hors transaction)
            setImmediate(() => {
                // Notifier l'auteur de l'article
                if (article.rows[0].auteur_id !== req.user.id) {
                    this.notifyCommentCreated(article.rows[0], commentaire, req.user, est_anonyme);
                }
                // Notifier toutes les personnes mentionnées avec @
                this.notifyMentions(contenu_commentaire, articleId, req.user);
            });

            // Notifier l'auteur du commentaire parent
            if (commentaire_parent_id) {
                const parentAuteur = await client.query(
                    'SELECT auteur_id FROM COMMENTAIRES WHERE id = $1',
                    [commentaire_parent_id]
                );
                if (parentAuteur.rows.length > 0 && parentAuteur.rows[0].auteur_id !== req.user.id) {
                    setImmediate(() => {
                        NotificationService.send({
                            destinataire_id: parentAuteur.rows[0].auteur_id,
                            type: 'REPONSE_COMMENTAIRE',
                            titre: '💬 Nouvelle réponse à votre commentaire',
                            corps: `${est_anonyme ? pseudo_anonyme : req.user.nom_utilisateur_compte} a répondu à votre commentaire`,
                            entite_source_type: 'COMMENTAIRE',
                            entite_source_id: commentaire.id
                        }).catch(() => {});
                    });
                }
            }

            // ✅ Vérifier les badges après un commentaire
            setImmediate(() => {
                this.verifierBadgesCommentaire(req.user.id, client).catch(() => {});
            });

            await client.query('COMMIT');

            // Invalider le cache
            CacheService.invalidatePattern(`blog:article:${articleId}:comments:*`).catch(() => {});

            res.status(201).json({
                success: true,
                data: commentaire,
                message: statut === 'APPROUVE' ? 'Commentaire ajouté' : 'Commentaire soumis pour validation'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ========================================================================
    // METTRE À JOUR
    // ========================================================================

    async update(req, res, next) {
        const client = await db.getClient();
        
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { contenu_commentaire } = req.body;

            if (!contenu_commentaire || contenu_commentaire.trim().length < 2) {
                throw new ValidationError('Minimum 2 caractères');
            }
            if (contenu_commentaire.trim().length > 2000) {
                throw new ValidationError('Maximum 2000 caractères');
            }

            const commentaire = await client.query(
                'SELECT * FROM COMMENTAIRES WHERE id = $1 FOR UPDATE', [id]
            );
            if (!commentaire.rows.length) throw new NotFoundError('Commentaire non trouvé');

            const existing = commentaire.rows[0];

            // Vérifier les droits
            const isAdmin = ['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role);
            if (existing.auteur_id !== req.user.id && !isAdmin) {
                throw new AuthorizationError('Droits insuffisants');
            }

            // Fenêtre de modification : 30 minutes (sauf admin)
            if (!isAdmin) {
                const minutes = (Date.now() - new Date(existing.date_creation).getTime()) / 60000;
                if (minutes > 30) throw new ValidationError('Délai de modification dépassé (30 min)');
            }

            // Historique des modifications
            const historique = existing.historique_modifications || [];
            historique.push({
                contenu: existing.contenu_commentaire,
                date: new Date().toISOString(),
                modifie_par: req.user.id
            });

            const result = await client.query(
                `UPDATE COMMENTAIRES 
                 SET contenu_commentaire = $1,
                     contenu_original = COALESCE(contenu_original, $2),
                     date_modification = NOW(),
                     historique_modifications = $3::jsonb,
                     statut = CASE WHEN statut = 'APPROUVE' THEN 'APPROUVE' ELSE 'EN_ATTENTE' END
                 WHERE id = $4 RETURNING *`,
                [contenu_commentaire.trim(), existing.contenu_commentaire, JSON.stringify(historique), id]
            );

            AuditService.log({
                action: 'UPDATE', ressource_type: 'COMMENTAIRE', ressource_id: id,
                utilisateur_id: req.user.id, donnees_avant: existing, donnees_apres: result.rows[0]
            }).catch(() => {});

            await client.query('COMMIT');
            CacheService.invalidatePattern(`blog:article:${existing.article_id}:comments:*`).catch(() => {});

            res.json({ success: true, data: result.rows[0], message: 'Commentaire mis à jour' });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ========================================================================
    // SUPPRIMER
    // ========================================================================

    async delete(req, res, next) {
        const client = await db.getClient();
        
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');
            await client.query('BEGIN');
            
            const { id } = req.params;
            const commentaire = await client.query(
                'SELECT * FROM COMMENTAIRES WHERE id = $1 FOR UPDATE', [id]
            );
            if (!commentaire.rows.length) throw new NotFoundError('Commentaire non trouvé');

            const existing = commentaire.rows[0];
            const isAdmin = ['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role);
            
            if (existing.auteur_id !== req.user.id && !isAdmin) {
                throw new AuthorizationError('Droits insuffisants');
            }

            // Soft delete
            await client.query(
                `UPDATE COMMENTAIRES SET statut = 'SUPPRIME', date_suppression = NOW(),
                 supprime_par = $2, motif_suppression = $3 WHERE id = $1`,
                [id, req.user.id, isAdmin ? 'Suppression par modération' : 'Suppression par auteur']
            );

            // Mettre à jour les compteurs
            await this.updateCounters(client, existing.article_id, existing.commentaire_parent_id, -1);

            AuditService.log({
                action: 'DELETE', ressource_type: 'COMMENTAIRE', ressource_id: id,
                utilisateur_id: req.user.id, donnees_avant: existing
            }).catch(() => {});

            await client.query('COMMIT');
            CacheService.invalidatePattern(`blog:article:${existing.article_id}:comments:*`).catch(() => {});

            res.json({ success: true, message: 'Commentaire supprimé' });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ========================================================================
    // RÉCUPÉRER LES COMMENTAIRES (CTE récursive)
    // ========================================================================

    async findByArticle(req, res, next) {
        try {
            const { articleId } = req.params;
            const { page = 1, limit = 50, tri = 'recent' } = req.query;

            const cacheKey = `blog:article:${articleId}:comments:${page}:${limit}:${tri}`;
            const cached = await CacheService.get(cacheKey);
            if (cached && req.query.skip_cache !== 'true') {
                return res.json({ success: true, ...cached, fromCache: true });
            }

            const canSeePending = req.user && 
                ['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role);

            const query = `
                WITH RECURSIVE commentaires_tree AS (
                    SELECT c.*, u.nom_utilisateur_compte as auteur_nom, u.photo_profil_compte as auteur_photo,
                           0 as niveau, ARRAY[c.id] as chemin, c.date_creation as tri_date
                    FROM COMMENTAIRES c LEFT JOIN COMPTES u ON u.id = c.auteur_id
                    WHERE c.article_id = $1 AND c.commentaire_parent_id IS NULL
                      ${!canSeePending ? "AND c.statut = 'APPROUVE'" : ''}
                    UNION ALL
                    SELECT c.*, u.nom_utilisateur_compte, u.photo_profil_compte,
                           ct.niveau + 1, ct.chemin || c.id, ct.tri_date
                    FROM COMMENTAIRES c LEFT JOIN COMPTES u ON u.id = c.auteur_id
                    INNER JOIN commentaires_tree ct ON ct.id = c.commentaire_parent_id
                    WHERE ${!canSeePending ? "c.statut = 'APPROUVE'" : 'TRUE'} AND ct.niveau < 3
                )
                SELECT *, COUNT(*) OVER() as total_count
                FROM commentaires_tree
                ORDER BY CASE WHEN $4 = 'recent' THEN tri_date END DESC,
                         CASE WHEN $4 = 'ancien' THEN tri_date END ASC,
                         CASE WHEN $4 = 'populaire' THEN nombre_likes END DESC,
                         chemin
                LIMIT $2 OFFSET $3
            `;

            const result = await db.query(query, [
                articleId, parseInt(limit), (parseInt(page) - 1) * parseInt(limit), tri
            ]);

            // Reconstruire l'arbre
            const commentMap = new Map();
            const rootComments = [];
            for (const row of result.rows) commentMap.set(row.id, { ...row, reponses: [] });
            for (const row of result.rows) {
                const comment = commentMap.get(row.id);
                if (!row.commentaire_parent_id) rootComments.push(comment);
                else commentMap.get(row.commentaire_parent_id)?.reponses.push(comment);
            }

            // Enrichir avec les likes utilisateur
            if (req.user && result.rows.length > 0) {
                const allIds = result.rows.map(r => r.id);
                const likes = await db.query(
                    `SELECT commentaire_id, type_like FROM LIKES_COMMENTAIRES 
                     WHERE commentaire_id = ANY($1) AND compte_id = $2`,
                    [allIds, req.user.id]
                );
                const likeMap = new Map(likes.rows.map(l => [l.commentaire_id, l.type_like]));
                for (const row of result.rows) {
                    const comment = commentMap.get(row.id);
                    if (comment) {
                        comment.user_liked = likeMap.has(row.id);
                        comment.user_like_type = likeMap.get(row.id) || null;
                    }
                }
            }

            const total = result.rows[0]?.total_count || 0;
            const responseData = {
                success: true, data: rootComments,
                pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(total), pages: Math.ceil(parseInt(total) / Math.max(1, parseInt(limit))) }
            };

            CacheService.set(cacheKey, responseData, 120).catch(() => {});
            res.json(responseData);

        } catch (error) {
            next(error);
        }
    }

    // ========================================================================
    // MODÉRER
    // ========================================================================

    async moderer(req, res, next) {
        const client = await db.getClient();
        
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');
            if (!['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role)) {
                throw new AuthorizationError('Droits insuffisants');
            }
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { statut, motif } = req.body;
            if (!['APPROUVE', 'REJETE', 'MASQUE'].includes(statut)) throw new ValidationError('Statut invalide');

            const commentaire = await client.query(
                'SELECT * FROM COMMENTAIRES WHERE id = $1 FOR UPDATE', [id]
            );
            if (!commentaire.rows.length) throw new NotFoundError('Commentaire non trouvé');

            const oldComment = commentaire.rows[0];
            const result = await client.query(
                `UPDATE COMMENTAIRES SET statut = $1, date_moderation = NOW(), moderateur_id = $2 WHERE id = $3 RETURNING *`,
                [statut, req.user.id, id]
            );

            // Mettre à jour les compteurs
            if (oldComment.statut === 'EN_ATTENTE' && statut === 'APPROUVE') {
                await this.updateCounters(client, oldComment.article_id, oldComment.commentaire_parent_id, 1);
            } else if (oldComment.statut === 'APPROUVE' && statut !== 'APPROUVE') {
                await this.updateCounters(client, oldComment.article_id, oldComment.commentaire_parent_id, -1);
            }

            await client.query('COMMIT');

            // Notifier l'auteur
            setImmediate(() => {
                NotificationService.send({
                    destinataire_id: oldComment.auteur_id,
                    type: 'COMMENTAIRE_MODERE',
                    titre: `Commentaire ${statut === 'APPROUVE' ? 'approuvé' : statut === 'REJETE' ? 'rejeté' : 'masqué'}`,
                    corps: `Votre commentaire a été ${statut === 'APPROUVE' ? 'approuvé' : statut === 'REJETE' ? 'rejeté' : 'masqué'}${motif ? ` - ${motif}` : ''}`,
                    entite_source_type: 'COMMENTAIRE', entite_source_id: id
                }).catch(() => {});
            });

            CacheService.invalidatePattern(`blog:article:${oldComment.article_id}:comments:*`).catch(() => {});
            res.json({ success: true, data: result.rows[0], message: `Commentaire ${statut === 'APPROUVE' ? 'approuvé' : statut === 'REJETE' ? 'rejeté' : 'masqué'}` });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ========================================================================
    // NOUVEAUX ENDPOINTS
    // ========================================================================

    /**
     * Récupérer les commentaires d'un utilisateur
     * @route GET /api/v1/blog/commentaires/user
     */
    async getUserComments(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');
            const { page = 1, limit = 20, statut } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            let query = `SELECT c.*, a.titre_article, a.slug as article_slug, COUNT(*) OVER() as total_count
                         FROM COMMENTAIRES c JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = c.article_id
                         WHERE c.auteur_id = $1`;
            const params = [req.user.id];
            let pi = 2;

            if (statut) { query += ` AND c.statut = $${pi}`; params.push(statut); pi++; }
            else { query += ` AND c.statut != 'SUPPRIME'`; }

            query += ` ORDER BY c.date_creation DESC LIMIT $${pi} OFFSET $${pi + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            res.json({
                success: true, data: result.rows,
                pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(total), pages: Math.ceil(parseInt(total) / Math.max(1, parseInt(limit))) }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les commentaires les plus likés d'un article
     * @route GET /api/v1/blog/articles/:articleId/commentaires/top
     */
    async getTopComments(req, res, next) {
        try {
            const { articleId } = req.params;
            const { limit = 5 } = req.query;

            const result = await db.query(
                `SELECT c.*, u.nom_utilisateur_compte as auteur_nom, u.photo_profil_compte as auteur_photo,
                        c.nombre_likes, c.nombre_reponses
                 FROM COMMENTAIRES c LEFT JOIN COMPTES u ON u.id = c.auteur_id
                 WHERE c.article_id = $1 AND c.statut = 'APPROUVE' AND c.commentaire_parent_id IS NULL
                 ORDER BY c.nombre_likes DESC, c.date_creation DESC
                 LIMIT $2`,
                [articleId, parseInt(limit)]
            );

            res.json({ success: true, data: result.rows });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer le nombre de commentaires non lus (depuis dernière visite)
     * @route GET /api/v1/blog/articles/:articleId/commentaires/nouveaux
     */
    async getNewCommentsCount(req, res, next) {
        try {
            const { articleId } = req.params;
            const { depuis } = req.query;

            const dateSince = depuis || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

            const result = await db.query(
                `SELECT COUNT(*) as nouveaux_commentaires
                 FROM COMMENTAIRES
                 WHERE article_id = $1 AND statut = 'APPROUVE' AND date_creation > $2`,
                [articleId, dateSince]
            );

            res.json({ success: true, data: result.rows[0] });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Épingler un commentaire
     * @route PATCH /api/v1/blog/commentaires/:id/epingler
     */
    async togglePinComment(req, res, next) {
        try {
            const { id } = req.params;
            const { est_epingle } = req.body;

            const commentaire = await db.query('SELECT * FROM COMMENTAIRES WHERE id = $1', [id]);
            if (!commentaire.rows.length) throw new NotFoundError('Commentaire non trouvé');

            // Vérifier que l'utilisateur est l'auteur de l'article
            const article = await db.query(
                'SELECT auteur_id FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                [commentaire.rows[0].article_id]
            );

            const isAdmin = ['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role);
            if (article.rows[0].auteur_id !== req.user.id && !isAdmin) {
                throw new AuthorizationError('Seul l\'auteur de l\'article peut épingler un commentaire');
            }

            const result = await db.query(
                `UPDATE COMMENTAIRES SET est_epingle = $1 WHERE id = $2 RETURNING *`,
                [est_epingle, id]
            );

            CacheService.invalidatePattern(`blog:article:${commentaire.rows[0].article_id}:comments:*`).catch(() => {});

            res.json({
                success: true,
                data: result.rows[0],
                message: est_epingle ? 'Commentaire épinglé' : 'Commentaire désépinglé'
            });
        } catch (error) {
            next(error);
        }
    }

    // ========================================================================
    // MÉTHODES PRIVÉES
    // ========================================================================

    async getNiveauImbrication(client, commentaireId) {
        const result = await client.query(
            `WITH RECURSIVE parents AS (
                SELECT id, commentaire_parent_id, 0 as niveau FROM COMMENTAIRES WHERE id = $1
                UNION ALL
                SELECT c.id, c.commentaire_parent_id, p.niveau + 1
                FROM COMMENTAIRES c INNER JOIN parents p ON p.commentaire_parent_id = c.id WHERE p.niveau < 5
            ) SELECT MAX(niveau) as max_niveau FROM parents`,
            [commentaireId]
        );
        return parseInt(result.rows[0]?.max_niveau || 0);
    }

    async updateCounters(client, articleId, parentId, delta) {
        await client.query(
            'UPDATE ARTICLES_BLOG_PLATEFORME SET nombre_commentaires = GREATEST(0, nombre_commentaires + $1) WHERE id = $2',
            [delta, articleId]
        );
        if (parentId) {
            await client.query(
                'UPDATE COMMENTAIRES SET nombre_reponses = GREATEST(0, nombre_reponses + $1) WHERE id = $2',
                [delta, parentId]
            );
        }
    }

    async notifyCommentCreated(article, commentaire, user, estAnonyme) {
        try {
            await NotificationService.send({
                destinataire_id: article.auteur_id,
                type: 'NOUVEAU_COMMENTAIRE',
                titre: '💬 Nouveau commentaire',
                corps: `${estAnonyme ? 'Un utilisateur' : user.nom_utilisateur_compte} a commenté "${article.titre_article}"`,
                entite_source_type: 'COMMENTAIRE',
                entite_source_id: commentaire.id,
                action_url: `/blog/${article.slug || article.id}#comment-${commentaire.id}`
            });
        } catch (error) {
            console.error('Erreur notification:', error);
        }
    }

    /**
     * ✅ NOUVEAU : Notifier les utilisateurs mentionnés avec @username
     */
    async notifyMentions(contenu, articleId, auteur) {
        try {
            const mentions = contenu.match(/@(\w+)/g);
            if (!mentions) return;

            const usernames = [...new Set(mentions.map(m => m.substring(1)))];
            if (usernames.length === 0) return;

            const users = await db.query(
                `SELECT id, nom_utilisateur_compte FROM COMPTES 
                 WHERE nom_utilisateur_compte = ANY($1) AND id != $2 AND est_supprime = FALSE
                 LIMIT 5`,
                [usernames, auteur.id]
            );

            for (const user of users.rows) {
                NotificationService.send({
                    destinataire_id: user.id,
                    type: 'MENTION_COMMENTAIRE',
                    titre: '📢 Vous avez été mentionné',
                    corps: `${auteur.nom_utilisateur_compte} vous a mentionné dans un commentaire`,
                    entite_source_type: 'COMMENTAIRE',
                    entite_source_id: articleId,
                    action_url: `/blog/article/${articleId}`
                }).catch(() => {});
            }
        } catch (error) {
            console.error('Erreur mentions:', error);
        }
    }

    /**
     * ✅ NOUVEAU : Vérifier les badges après un commentaire
     */
    async verifierBadgesCommentaire(userId, client) {
        try {
            const count = await client.query(
                'SELECT COUNT(*) as count FROM COMMENTAIRES WHERE auteur_id = $1 AND statut = \'APPROUVE\'',
                [userId]
            );

            const total = parseInt(count.rows[0].count);

            // Badge : Premier commentaire
            if (total === 1) {
                await client.query(
                    `INSERT INTO BADGES_UTILISATEUR (compte_id, badge_id)
                     SELECT $1, id FROM BADGES_LECTURE WHERE nom_badge = 'Commentateur'
                     ON CONFLICT DO NOTHING`,
                    [userId]
                );
            }

            // Badge : 50 commentaires
            if (total === 50) {
                const badge = await client.query(
                    `SELECT id FROM BADGES_LECTURE WHERE nom_badge = 'Super commentateur'`
                );
                if (badge.rows.length > 0) {
                    await client.query(
                        `INSERT INTO BADGES_UTILISATEUR (compte_id, badge_id)
                         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                        [userId, badge.rows[0].id]
                    );
                }
            }
        } catch (error) {
            console.error('Erreur badges commentaire:', error);
        }
    }
}

module.exports = new CommentaireController();