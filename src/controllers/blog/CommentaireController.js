// src/controllers/blog/CommentaireController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError, AuthorizationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const NotificationService = require('../../services/notification/NotificationService');

class CommentaireController {
    /**
     * Ajouter un commentaire à un article
     * @route POST /api/v1/blog/articles/:articleId/commentaires
     */
    /*async create(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { articleId } = req.params;
            const {
                contenu_commentaire,
                commentaire_parent_id,
                est_anonyme = false,
                pseudo_anonyme,
                note
            } = req.body;

            // Validation
            if (!contenu_commentaire) {
                throw new ValidationError('Le contenu du commentaire est requis');
            }

            // Vérifier que l'article existe et accepte les commentaires
            const article = await client.query(
                `SELECT * FROM ARTICLES_BLOG_PLATEFORME 
                 WHERE id = $1 AND est_commentaire_actif = true`,
                [articleId]
            );

            if (article.rows.length === 0) {
                throw new NotFoundError('Article non trouvé ou commentaires désactivés');
            }

            // Vérifier le commentaire parent si spécifié
            if (commentaire_parent_id) {
                const parent = await client.query(
                    'SELECT id FROM COMMENTAIRES WHERE id = $1 AND article_id = $2',
                    [commentaire_parent_id, articleId]
                );
                if (parent.rows.length === 0) {
                    throw new ValidationError('Commentaire parent invalide');
                }
            }

            // Création du commentaire
            const result = await client.query(
                `INSERT INTO COMMENTAIRES (
                    contenu_commentaire, article_id, commentaire_parent_id,
                    auteur_id, est_anonyme, pseudo_anonyme, note, statut,
                    adresse_ip, user_agent
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, 
                    CASE WHEN $8 THEN 'EN_ATTENTE' ELSE 'APPROUVE' END,
                    $9, $10
                ) RETURNING *`,
                [
                    contenu_commentaire, articleId, commentaire_parent_id,
                    req.user.id, est_anonyme, pseudo_anonyme, note,
                    req.user.compte_role !== 'UTILISATEUR_PRIVE_SIMPLE', // Auto-approve pour certains rôles
                    req.ip,
                    req.headers['user-agent']
                ]
            );

            const commentaire = result.rows[0];

            // Mettre à jour le compteur de commentaires de l'article
            await client.query(
                'UPDATE ARTICLES_BLOG_PLATEFORME SET nombre_commentaires = nombre_commentaires + 1 WHERE id = $1',
                [articleId]
            );

            // Mettre à jour le compteur de réponses si c'est une réponse
            if (commentaire_parent_id) {
                await client.query(
                    'UPDATE COMMENTAIRES SET nombre_reponses = nombre_reponses + 1 WHERE id = $1',
                    [commentaire_parent_id]
                );
            }

            // Journalisation
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'COMMENTAIRE',
                ressource_id: commentaire.id,
                utilisateur_id: req.user.id,
                donnees_apres: commentaire
            });

            // Notification à l'auteur de l'article
            if (article.rows[0].auteur_id !== req.user.id) {
                await NotificationService.send({
                    destinataire_id: article.rows[0].auteur_id,
                    type: 'NOUVEAU_COMMENTAIRE',
                    titre: 'Nouveau commentaire sur votre article',
                    corps: `${est_anonyme ? 'Un utilisateur' : req.user.nom_utilisateur_compte} a commenté votre article`,
                    entite_source_type: 'COMMENTAIRE',
                    entite_source_id: commentaire.id
                });
            }

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: commentaire,
                message: 'Commentaire ajouté avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }*/
    /**
     * Ajouter un commentaire à un article
     * @route POST /api/v1/blog/articles/:articleId/commentaires
     */
    async create(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { articleId } = req.params;
            const {
                contenu_commentaire,
                commentaire_parent_id,
                est_anonyme = false,
                pseudo_anonyme,
                note
            } = req.body;

            // Validation
            if (!contenu_commentaire) {
                throw new ValidationError('Le contenu du commentaire est requis');
            }

            // Vérifier que l'article existe et accepte les commentaires
            const article = await client.query(
                `SELECT * FROM ARTICLES_BLOG_PLATEFORME 
                WHERE id = $1 AND est_commentaire_actif = true`,
                [articleId]
            );

            if (article.rows.length === 0) {
                throw new NotFoundError('Article non trouvé ou commentaires désactivés');
            }

            // Vérifier le commentaire parent si spécifié
            if (commentaire_parent_id) {
                const parent = await client.query(
                    'SELECT id FROM COMMENTAIRES WHERE id = $1 AND article_id = $2',
                    [commentaire_parent_id, articleId]
                );
                if (parent.rows.length === 0) {
                    throw new ValidationError('Commentaire parent invalide');
                }
            }

            // Déterminer le statut du commentaire
            // Les rôles suivants sont auto-approuvés
            const autoApproveRoles = [
                'ADMINISTRATEUR_PLATEFORME',
                'STAFF_PLATEFORME',
                'BLOGUEUR_PLATEFORME',
                'ADMINISTRATEUR_COMPAGNIE',
                'STAFF_COMPAGNIE'
            ];
            const statut = 'APPROUVE';

            // Création du commentaire
            const result = await client.query(
                `INSERT INTO COMMENTAIRES (
                    contenu_commentaire, article_id, commentaire_parent_id,
                    auteur_id, est_anonyme, pseudo_anonyme, note, statut,
                    adresse_ip, user_agent
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *`,
                [
                    contenu_commentaire, articleId, commentaire_parent_id,
                    req.user.id, est_anonyme, pseudo_anonyme, note,
                    statut,
                    req.ip,
                    req.headers['user-agent']
                ]
            );

            const commentaire = result.rows[0];

            // Mettre à jour le compteur de commentaires de l'article
            await client.query(
                'UPDATE ARTICLES_BLOG_PLATEFORME SET nombre_commentaires = nombre_commentaires + 1 WHERE id = $1',
                [articleId]
            );

            // Mettre à jour le compteur de réponses si c'est une réponse
            if (commentaire_parent_id) {
                await client.query(
                    'UPDATE COMMENTAIRES SET nombre_reponses = nombre_reponses + 1 WHERE id = $1',
                    [commentaire_parent_id]
                );
            }

            // Journalisation
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'COMMENTAIRE',
                ressource_id: commentaire.id,
                utilisateur_id: req.user.id,
                donnees_apres: commentaire
            });

            // Notification à l'auteur de l'article
            /*if (article.rows[0].auteur_id !== req.user.id) {
                await NotificationService.send({
                    destinataire_id: article.rows[0].auteur_id,
                    type: 'NOUVEAU_COMMENTAIRE',
                    titre: 'Nouveau commentaire sur votre article',
                    corps: `${est_anonyme ? 'Un utilisateur' : req.user.nom_utilisateur_compte} a commenté votre article`,
                    entite_source_type: 'COMMENTAIRE',
                    entite_source_id: commentaire.id
                });
            }*/

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: commentaire,
                message: 'Commentaire ajouté avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }
    /**
     * Mettre à jour un commentaire
     * @route PUT /api/v1/blog/commentaires/:id
     */
    async update(req, res, next) {
        try {
            const { id } = req.params;
            const { contenu_commentaire } = req.body;

            // Vérifier l'existence et les droits
            const commentaire = await db.query(
                'SELECT * FROM COMMENTAIRES WHERE id = $1',
                [id]
            );

            if (commentaire.rows.length === 0) {
                throw new NotFoundError('Commentaire non trouvé');
            }

            const existingComment = commentaire.rows[0];

            // Seul l'auteur ou un admin peut modifier
            if (existingComment.auteur_id !== req.user.id && 
                !['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role)) {
                throw new AuthorizationError('Vous n\'avez pas les droits pour modifier ce commentaire');
            }

            // Sauvegarder l'original pour l'historique
            const contenuOriginal = existingComment.contenu_commentaire;

            const result = await db.query(
                `UPDATE COMMENTAIRES 
                 SET contenu_commentaire = $1,
                     contenu_original = COALESCE(contenu_original, $2),
                     date_modification = NOW(),
                     statut = CASE WHEN statut = 'APPROUVE' THEN 'APPROUVE' ELSE 'EN_ATTENTE' END
                 WHERE id = $3
                 RETURNING *`,
                [contenu_commentaire, contenuOriginal, id]
            );

            // Journalisation
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'COMMENTAIRE',
                ressource_id: id,
                utilisateur_id: req.user.id,
                donnees_avant: existingComment,
                donnees_apres: result.rows[0]
            });

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Commentaire mis à jour'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Supprimer un commentaire (soft delete)
     * @route DELETE /api/v1/blog/commentaires/:id
     */
    async delete(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;

            const commentaire = await client.query(
                'SELECT * FROM COMMENTAIRES WHERE id = $1',
                [id]
            );

            if (commentaire.rows.length === 0) {
                throw new NotFoundError('Commentaire non trouvé');
            }

            const existingComment = commentaire.rows[0];

            // Vérifier les droits
            if (existingComment.auteur_id !== req.user.id && 
                !['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role)) {
                throw new AuthorizationError('Vous n\'avez pas les droits pour supprimer ce commentaire');
            }

            // Soft delete
            await client.query(
                `UPDATE COMMENTAIRES 
                 SET statut = 'SUPPRIME',
                     date_modification = NOW()
                 WHERE id = $1`,
                [id]
            );

            // Mettre à jour le compteur de l'article
            await client.query(
                'UPDATE ARTICLES_BLOG_PLATEFORME SET nombre_commentaires = nombre_commentaires - 1 WHERE id = $1',
                [existingComment.article_id]
            );

            // Si c'était une réponse, mettre à jour le compteur du parent
            if (existingComment.commentaire_parent_id) {
                await client.query(
                    'UPDATE COMMENTAIRES SET nombre_reponses = nombre_reponses - 1 WHERE id = $1',
                    [existingComment.commentaire_parent_id]
                );
            }

            // Journalisation
            await AuditService.log({
                action: 'DELETE',
                ressource_type: 'COMMENTAIRE',
                ressource_id: id,
                utilisateur_id: req.user.id,
                donnees_avant: existingComment
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Commentaire supprimé'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les commentaires d'un article
     * @route GET /api/v1/blog/articles/:articleId/commentaires
     */
    /*async findByArticle(req, res, next) {
        try {
            const { articleId } = req.params;
            const { page = 1, limit = 50, tri = 'recent' } = req.query;

            const offset = (page - 1) * limit;

            // Vérifier si l'utilisateur peut voir les commentaires en attente
            const canSeePending = req.user && 
                ['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role);

            let query = `
                SELECT c.*,
                       u.nom_utilisateur_compte as auteur_nom,
                       u.photo_profil_compte as auteur_photo,
                       COUNT(l.id) FILTER (WHERE l.type_like = 'LIKE') as nombre_likes,
                       COUNT(l.id) FILTER (WHERE l.type_like = 'DISLIKE') as nombre_dislikes,
                       CASE WHEN $2 THEN 
                           EXISTS(SELECT 1 FROM LIKES_COMMENTAIRES 
                                 WHERE commentaire_id = c.id AND compte_id = $3)
                       ELSE false END as user_liked,
                       COUNT(*) OVER() as total_count
                FROM COMMENTAIRES c
                LEFT JOIN COMPTES u ON u.id = c.auteur_id
                LEFT JOIN LIKES_COMMENTAIRES l ON l.commentaire_id = c.id
                WHERE c.article_id = $1
                  AND c.commentaire_parent_id IS NULL
            `;

            // Filtrer les statuts
            if (!canSeePending) {
                query += ` AND c.statut = 'APPROUVE'`;
            }

            // Tri
            if (tri === 'recent') {
                query += ` GROUP BY c.id, u.nom_utilisateur_compte, u.photo_profil_compte
                          ORDER BY c.date_creation DESC`;
            } else if (tri === 'populaire') {
                query += ` GROUP BY c.id, u.nom_utilisateur_compte, u.photo_profil_compte
                          ORDER BY (COUNT(l.id) FILTER (WHERE l.type_like = 'LIKE')) DESC, 
                                   c.date_creation DESC`;
            } else if (tri === 'note') {
                query += ` AND c.note IS NOT NULL
                          GROUP BY c.id, u.nom_utilisateur_compte, u.photo_profil_compte
                          ORDER BY c.note DESC, c.date_creation DESC`;
            }

            query += ` LIMIT $4 OFFSET $5`;

            const result = await db.query(query, [
                articleId, 
                !!req.user, 
                req.user?.id, 
                parseInt(limit), 
                offset
            ]);

            // Récupérer les réponses pour chaque commentaire
            for (const comment of result.rows) {
                const replies = await db.query(
                    `SELECT c.*,
                            u.nom_utilisateur_compte as auteur_nom,
                            u.photo_profil_compte as auteur_photo,
                            COUNT(l.id) FILTER (WHERE l.type_like = 'LIKE') as nombre_likes,
                            COUNT(l.id) FILTER (WHERE l.type_like = 'DISLIKE') as nombre_dislikes
                     FROM COMMENTAIRES c
                     LEFT JOIN COMPTES u ON u.id = c.auteur_id
                     LEFT JOIN LIKES_COMMENTAIRES l ON l.commentaire_id = c.id
                     WHERE c.commentaire_parent_id = $1
                       ${!canSeePending ? "AND c.statut = 'APPROUVE'" : ''}
                     GROUP BY c.id, u.nom_utilisateur_compte, u.photo_profil_compte
                     ORDER BY c.date_creation ASC`,
                    [comment.id]
                );
                comment.reponses = replies.rows;
            }

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
    }*/
    async findByArticle(req, res, next) {
        try {
            const { articleId } = req.params;
            const { page = 1, limit = 50, tri = 'recent' } = req.query;

            const offset = (page - 1) * limit;
            const canSeePending = req.user && 
                ['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role);

            // Récupérer les commentaires racines
            const rootCommentsQuery = `
                SELECT c.*,
                    u.nom_utilisateur_compte as auteur_nom,
                    u.photo_profil_compte as auteur_photo,
                    COUNT(l.id) FILTER (WHERE l.type_like = 'LIKE') as nombre_likes,
                    COUNT(l.id) FILTER (WHERE l.type_like = 'DISLIKE') as nombre_dislikes,
                    CASE WHEN $2 THEN 
                        EXISTS(SELECT 1 FROM LIKES_COMMENTAIRES 
                                WHERE commentaire_id = c.id AND compte_id = $3)
                    ELSE false END as user_liked,
                    COUNT(*) OVER() as total_count
                FROM COMMENTAIRES c
                LEFT JOIN COMPTES u ON u.id = c.auteur_id
                LEFT JOIN LIKES_COMMENTAIRES l ON l.commentaire_id = c.id
                WHERE c.article_id = $1
                AND c.commentaire_parent_id IS NULL
                ${!canSeePending ? "AND c.statut = 'APPROUVE'" : ''}
                GROUP BY c.id, u.nom_utilisateur_compte, u.photo_profil_compte
                ORDER BY c.date_creation DESC
                LIMIT $4 OFFSET $5
            `;

            const result = await db.query(rootCommentsQuery, [
                articleId, 
                !!req.user, 
                req.user?.id, 
                parseInt(limit), 
                offset
            ]);

            // Fonction récursive pour récupérer toutes les réponses
            const getRepliesRecursively = async (parentId) => {
                const replies = await db.query(
                    `SELECT c.*,
                            u.nom_utilisateur_compte as auteur_nom,
                            u.photo_profil_compte as auteur_photo,
                            COUNT(l.id) FILTER (WHERE l.type_like = 'LIKE') as nombre_likes,
                            COUNT(l.id) FILTER (WHERE l.type_like = 'DISLIKE') as nombre_dislikes,
                            CASE WHEN $2 THEN 
                                EXISTS(SELECT 1 FROM LIKES_COMMENTAIRES 
                                    WHERE commentaire_id = c.id AND compte_id = $3)
                            ELSE false END as user_liked
                    FROM COMMENTAIRES c
                    LEFT JOIN COMPTES u ON u.id = c.auteur_id
                    LEFT JOIN LIKES_COMMENTAIRES l ON l.commentaire_id = c.id
                    WHERE c.commentaire_parent_id = $1
                    ${!canSeePending ? "AND c.statut = 'APPROUVE'" : ''}
                    GROUP BY c.id, u.nom_utilisateur_compte, u.photo_profil_compte
                    ORDER BY c.date_creation ASC`,
                    [parentId, !!req.user, req.user?.id]
                );

                for (const reply of replies.rows) {
                    reply.reponses = await getRepliesRecursively(reply.id);
                }

                return replies.rows;
            };

            // Récupérer toutes les réponses récursivement
            for (const comment of result.rows) {
                comment.reponses = await getRepliesRecursively(comment.id);
            }

            const total = result.rows[0]?.total_count || 0;

            res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(total),
                    pages: Math.ceil(parseInt(total) / parseInt(limit))
                }
            });

        } catch (error) {
            console.error('Erreur dans findByArticle:', error);
            next(error);
        }
    }

    /**
     * Signaler un commentaire
     * @route POST /api/v1/blog/commentaires/:id/signaler
     */
    async signaler(req, res, next) {
        try {
            const { id } = req.params;
            const { motif, description } = req.body;

            // Vérifier que le commentaire existe
            const commentaire = await db.query(
                'SELECT id FROM COMMENTAIRES WHERE id = $1',
                [id]
            );

            if (commentaire.rows.length === 0) {
                throw new NotFoundError('Commentaire non trouvé');
            }

            // Vérifier si l'utilisateur a déjà signalé
            const existingSignal = await db.query(
                'SELECT id FROM SIGNALEMENTS_COMMENTAIRES WHERE commentaire_id = $1 AND compte_id = $2',
                [id, req.user.id]
            );

            if (existingSignal.rows.length > 0) {
                throw new ValidationError('Vous avez déjà signalé ce commentaire');
            }

            // Créer le signalement
            const result = await db.query(
                `INSERT INTO SIGNALEMENTS_COMMENTAIRES (
                    commentaire_id, compte_id, motif, description
                ) VALUES ($1, $2, $3, $4) RETURNING *`,
                [id, req.user.id, motif, description]
            );

            // Incrémenter le compteur de signalements du commentaire
            await db.query(
                'UPDATE COMMENTAIRES SET nombre_signalements = nombre_signalements + 1 WHERE id = $1',
                [id]
            );

            // Notification aux modérateurs si seuil atteint
            const signalCount = await db.query(
                'SELECT COUNT(*) FROM SIGNALEMENTS_COMMENTAIRES WHERE commentaire_id = $1',
                [id]
            );

            if (parseInt(signalCount.rows[0].count) >= 3) {
                await NotificationService.notifyModerators({
                    type: 'SIGNALEMENTS_MULTIPLES',
                    titre: 'Commentaire signalé plusieurs fois',
                    corps: `Un commentaire a reçu ${signalCount.rows[0].count} signalements`,
                    entite_source_type: 'COMMENTAIRE',
                    entite_source_id: id
                });
            }

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message: 'Commentaire signalé'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Modérer un commentaire (approuver/rejeter)
     * @route PATCH /api/v1/blog/commentaires/:id/moderer
     */
    async moderer(req, res, next) {
        try {
            const { id } = req.params;
            const { statut, motif } = req.body;

            if (!['APPROUVE', 'REJETE', 'MASQUE'].includes(statut)) {
                throw new ValidationError('Statut de modération invalide');
            }

            const commentaire = await db.query(
                'SELECT * FROM COMMENTAIRES WHERE id = $1',
                [id]
            );

            if (commentaire.rows.length === 0) {
                throw new NotFoundError('Commentaire non trouvé');
            }

            const result = await db.query(
                `UPDATE COMMENTAIRES 
                 SET statut = $1,
                     date_moderation = NOW(),
                     moderateur_id = $2
                 WHERE id = $3
                 RETURNING *`,
                [statut, req.user.id, id]
            );

            // Notification à l'auteur
            await NotificationService.send({
                destinataire_id: commentaire.rows[0].auteur_id,
                type: 'COMMENTAIRE_MODERE',
                titre: `Commentaire ${statut === 'APPROUVE' ? 'approuvé' : 'rejeté'}`,
                corps: `Votre commentaire a été ${statut === 'APPROUVE' ? 'approuvé' : 'rejeté'}${motif ? ` (${motif})` : ''}`,
                entite_source_type: 'COMMENTAIRE',
                entite_source_id: id
            });

            res.json({
                success: true,
                data: result.rows[0],
                message: `Commentaire ${statut === 'APPROUVE' ? 'approuvé' : statut === 'REJETE' ? 'rejeté' : 'masqué'}`
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les signalements en attente
     * @route GET /api/v1/blog/commentaires/signalements/en-attente
     */
    async getSignalementsEnAttente(req, res, next) {
        try {
            const { page = 1, limit = 50 } = req.query;
            const offset = (page - 1) * limit;

            const result = await db.query(
                `SELECT s.*,
                        c.contenu_commentaire,
                        c.auteur_id,
                        u.nom_utilisateur_compte as auteur_nom,
                        COUNT(*) OVER() as total_count
                 FROM SIGNALEMENTS_COMMENTAIRES s
                 JOIN COMMENTAIRES c ON c.id = s.commentaire_id
                 JOIN COMPTES u ON u.id = c.auteur_id
                 WHERE s.statut = 'EN_ATTENTE'
                 ORDER BY s.date_signalement ASC
                 LIMIT $1 OFFSET $2`,
                [parseInt(limit), offset]
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
     * Traiter un signalement
     * @route PATCH /api/v1/blog/commentaires/signalements/:id/traiter
     */
    async traiterSignalement(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { statut, action_entreprise } = req.body;

            const signalement = await client.query(
                'SELECT * FROM SIGNALEMENTS_COMMENTAIRES WHERE id = $1',
                [id]
            );

            if (signalement.rows.length === 0) {
                throw new NotFoundError('Signalement non trouvé');
            }

            // Mettre à jour le signalement
            await client.query(
                `UPDATE SIGNALEMENTS_COMMENTAIRES 
                 SET statut = $1,
                     traite_par = $2,
                     date_traitement = NOW(),
                     action_entreprise = $3
                 WHERE id = $4`,
                [statut, req.user.id, action_entreprise, id]
            );

            // Si le signalement est traité et que l'action est de masquer
            if (statut === 'TRAITE' && action_entreprise === 'MASQUER') {
                await client.query(
                    `UPDATE COMMENTAIRES 
                     SET statut = 'MASQUE'
                     WHERE id = $1`,
                    [signalement.rows[0].commentaire_id]
                );
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
}

module.exports = new CommentaireController();