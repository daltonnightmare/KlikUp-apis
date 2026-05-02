// src/controllers/blog/FavoriController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError, AuthenticationError } = require('../../utils/errors/AppError');
const CacheService = require('../../services/cache/CacheService');
const NotificationService = require('../../services/notification/NotificationService');

class FavoriController {

    // ========================================================================
    // FAVORIS
    // ========================================================================

    /**
     * Ajouter/Retirer un article des favoris
     * @route POST /api/v1/blog/articles/:articleId/favori
     */
    async toggleFavori(req, res, next) {
        const client = await db.getClient();
        
        try {
            if (!req.user || !req.user.id) {
                throw new AuthenticationError('Authentification requise');
            }

            await client.query('BEGIN');
            
            const { articleId } = req.params;
            const { collection_id } = req.body; // Optionnel : ID de la collection

            // Vérifier que l'article existe
            const article = await client.query(
                `SELECT id, titre_article, auteur_id, nombre_favoris 
                 FROM ARTICLES_BLOG_PLATEFORME 
                 WHERE id = $1 AND statut = 'PUBLIE'`,
                [articleId]
            );

            if (article.rows.length === 0) {
                throw new NotFoundError('Article non trouvé ou non publié');
            }

            // Vérifier si déjà en favoris
            const existing = await client.query(
                'SELECT id FROM FAVORIS_ARTICLES WHERE article_id = $1 AND compte_id = $2',
                [articleId, req.user.id]
            );

            let action;
            let favori;

            if (existing.rows.length > 0) {
                // Retirer des favoris
                await client.query(
                    'DELETE FROM FAVORIS_ARTICLES WHERE id = $1',
                    [existing.rows[0].id]
                );
                
                // Mettre à jour le compteur
                await client.query(
                    `UPDATE ARTICLES_BLOG_PLATEFORME 
                     SET nombre_favoris = GREATEST(0, nombre_favoris - 1) 
                     WHERE id = $1`,
                    [articleId]
                );
                
                action = 'removed';
            } else {
                // Ajouter aux favoris
                const result = await client.query(
                    `INSERT INTO FAVORIS_ARTICLES (article_id, compte_id)
                     VALUES ($1, $2)
                     ON CONFLICT (article_id, compte_id) DO NOTHING
                     RETURNING *`,
                    [articleId, req.user.id]
                );
                
                if (result.rows.length > 0) {
                    // Mettre à jour le compteur
                    await client.query(
                        `UPDATE ARTICLES_BLOG_PLATEFORME 
                         SET nombre_favoris = nombre_favoris + 1 
                         WHERE id = $1`,
                        [articleId]
                    );
                    
                    favori = result.rows[0];
                    action = 'added';

                    // Ajouter à une collection si spécifiée
                    if (collection_id) {
                        await client.query(
                            `INSERT INTO COLLECTION_ARTICLES (collection_id, article_id)
                             VALUES ($1, $2)
                             ON CONFLICT DO NOTHING`,
                            [collection_id, articleId]
                        );
                    }

                    // Notification à l'auteur (pour les jalons)
                    const updatedArticle = await client.query(
                        'SELECT nombre_favoris FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                        [articleId]
                    );
                    
                    const favorisCount = parseInt(updatedArticle.rows[0].nombre_favoris);
                    const jalons = [10, 50, 100, 500, 1000];
                    
                    if (jalons.includes(favorisCount) && article.rows[0].auteur_id !== req.user.id) {
                        setImmediate(() => {
                            NotificationService.send({
                                destinataire_id: article.rows[0].auteur_id,
                                type: 'FAVORI_MILESTONE',
                                titre: '⭐ Article populaire !',
                                corps: `Votre article "${article.rows[0].titre_article}" a été ajouté aux favoris ${favorisCount} fois !`,
                                entite_source_type: 'ARTICLE_BLOG',
                                entite_source_id: articleId,
                                priorite: 'NORMALE'
                            }).catch(() => {});
                        });
                    }
                }
            }

            await client.query('COMMIT');

            // Récupérer le statut final
            const countResult = await client.query(
                'SELECT nombre_favoris FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                [articleId]
            );

            // Invalider le cache
            CacheService.del(`blog:article:${articleId}`).catch(() => {});
            CacheService.del(`user:${req.user.id}:favoris`).catch(() => {});

            res.json({
                success: true,
                data: {
                    action,
                    is_favorite: action === 'added',
                    favoris_count: parseInt(countResult.rows[0].nombre_favoris)
                },
                message: action === 'added' 
                    ? 'Article ajouté aux favoris ⭐' 
                    : 'Article retiré des favoris'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les favoris de l'utilisateur
     * @route GET /api/v1/blog/favoris
     */
    async getMesFavoris(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const { 
                page = 1, 
                limit = 20, 
                collection_id,
                tri = 'date_ajout',
                categorie
            } = req.query;

            const offset = (parseInt(page) - 1) * parseInt(limit);

            const cacheKey = `user:${req.user.id}:favoris:${page}:${limit}:${tri}:${categorie || 'all'}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({ success: true, ...cached, fromCache: true });
            }

            let query = `
                SELECT 
                    fa.id as favori_id,
                    fa.date_ajout,
                    a.*,
                    c.nom_utilisateur_compte as auteur_nom,
                    c.photo_profil_compte as auteur_photo,
                    COUNT(*) OVER() as total_count
                FROM FAVORIS_ARTICLES fa
                JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = fa.article_id
                LEFT JOIN COMPTES c ON c.id = a.auteur_id
                WHERE fa.compte_id = $1
                  AND a.statut = 'PUBLIE'
                  AND a.est_archive = FALSE
            `;
            
            const params = [req.user.id];
            let paramIndex = 2;

            // Filtrer par collection
            if (collection_id) {
                query += ` AND fa.id IN (
                    SELECT 1 FROM COLLECTION_ARTICLES 
                    WHERE collection_id = $${paramIndex} AND article_id = fa.article_id
                )`;
                params.push(parseInt(collection_id));
                paramIndex++;
            }

            // Filtrer par catégorie
            if (categorie) {
                query += ` AND a.categorie_principale = $${paramIndex}`;
                params.push(categorie);
                paramIndex++;
            }

            // Tri
            const orderMap = {
                'date_ajout': 'fa.date_ajout DESC',
                'date_publication': 'a.date_publication DESC NULLS LAST',
                'titre': 'a.titre_article ASC',
                'lecture': 'a.nombre_vues DESC'
            };

            query += ` ORDER BY ${orderMap[tri] || orderMap.date_ajout}`;
            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Récupérer les notes de lecture pour ces articles
            const articleIds = result.rows.map(r => r.id);
            let notes = {};
            if (articleIds.length > 0) {
                const notesResult = await db.query(
                    `SELECT article_id, contenu_note, pourcentage_article, date_creation
                     FROM NOTES_LECTURE 
                     WHERE article_id = ANY($1::int[]) AND compte_id = $2 AND est_privee = FALSE
                     ORDER BY date_creation DESC`,
                    [articleIds, req.user.id]
                );
                
                for (const note of notesResult.rows) {
                    if (!notes[note.article_id]) {
                        notes[note.article_id] = [];
                    }
                    notes[note.article_id].push(note);
                }
            }

            // Ajouter les notes et signets aux articles
            const enriched = result.rows.map(article => ({
                ...article,
                mes_notes: notes[article.id] || [],
                est_en_favoris: true
            }));

            const response = {
                success: true,
                data: enriched,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(total),
                    pages: Math.ceil(parseInt(total) / Math.max(1, parseInt(limit)))
                }
            };

            CacheService.set(cacheKey, response, 120).catch(() => {});

            res.json(response);

        } catch (error) {
            next(error);
        }
    }

    /**
     * Vérifier si un article est en favoris
     * @route GET /api/v1/blog/articles/:articleId/favori/check
     */
    async checkFavori(req, res, next) {
        try {
            const { articleId } = req.params;

            if (!req.user) {
                return res.json({
                    success: true,
                    data: { is_favorite: false }
                });
            }

            const result = await db.query(
                'SELECT id, date_ajout FROM FAVORIS_ARTICLES WHERE article_id = $1 AND compte_id = $2',
                [articleId, req.user.id]
            );

            res.json({
                success: true,
                data: {
                    is_favorite: result.rows.length > 0,
                    favori_id: result.rows[0]?.id || null,
                    date_ajout: result.rows[0]?.date_ajout || null
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Vérifier le statut favori pour plusieurs articles (batch)
     * @route POST /api/v1/blog/favoris/check-batch
     */
    async checkBatchFavoris(req, res, next) {
        try {
            const { article_ids } = req.body;

            if (!article_ids || !Array.isArray(article_ids)) {
                throw new ValidationError('Liste d\'IDs d\'articles requise');
            }

            if (article_ids.length > 100) {
                throw new ValidationError('Maximum 100 articles par requête');
            }

            const statusMap = {};
            
            // Initialiser tout à false
            for (const id of article_ids) {
                statusMap[id] = {
                    is_favorite: false,
                    favori_id: null,
                    date_ajout: null
                };
            }

            if (req.user) {
                const result = await db.query(
                    `SELECT article_id, id as favori_id, date_ajout 
                     FROM FAVORIS_ARTICLES 
                     WHERE article_id = ANY($1::int[]) AND compte_id = $2`,
                    [article_ids, req.user.id]
                );

                for (const row of result.rows) {
                    statusMap[row.article_id] = {
                        is_favorite: true,
                        favori_id: row.favori_id,
                        date_ajout: row.date_ajout
                    };
                }
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
     * Récupérer les statistiques des favoris
     * @route GET /api/v1/blog/favoris/stats
     */
    async getFavorisStats(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const stats = await db.query(
                `SELECT 
                    COUNT(*) as total_favoris,
                    COUNT(*) FILTER (WHERE a.categorie_principale = 'TUTORIEL') as tutoriels,
                    COUNT(*) FILTER (WHERE a.categorie_principale = 'ACTUALITE') as actualites,
                    COUNT(*) FILTER (WHERE a.categorie_principale = 'GUIDE') as guides,
                    COUNT(*) FILTER (WHERE fa.date_ajout > NOW() - INTERVAL '7 days') as cette_semaine,
                    COUNT(*) FILTER (WHERE fa.date_ajout > NOW() - INTERVAL '30 days') as ce_mois,
                    COUNT(DISTINCT a.auteur_id) as auteurs_uniques
                 FROM FAVORIS_ARTICLES fa
                 JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = fa.article_id
                 WHERE fa.compte_id = $1`,
                [req.user.id]
            );

            // Catégories les plus sauvegardées
            const topCategories = await db.query(
                `SELECT 
                    a.categorie_principale,
                    COUNT(*) as nombre
                 FROM FAVORIS_ARTICLES fa
                 JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = fa.article_id
                 WHERE fa.compte_id = $1
                 GROUP BY a.categorie_principale
                 ORDER BY nombre DESC
                 LIMIT 5`,
                [req.user.id]
            );

            res.json({
                success: true,
                data: {
                    ...stats.rows[0],
                    top_categories: topCategories.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }

    // ========================================================================
    // SIGNETS / PROGRESSION DE LECTURE
    // ========================================================================

    /**
     * Sauvegarder/Récupérer un signet de lecture
     * @route POST /api/v1/blog/articles/:articleId/signets
     */
    async saveSignet(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const { articleId } = req.params;
            const { position_texte, pourcentage, titre_signet, note_signet } = req.body;

            // Vérifier que l'article existe
            const article = await db.query(
                'SELECT id FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                [articleId]
            );

            if (article.rows.length === 0) {
                throw new NotFoundError('Article non trouvé');
            }

            // Upsert le signet
            const result = await db.query(
                `INSERT INTO SIGNETS_LECTURE (article_id, compte_id, position_texte, pourcentage, titre_signet, note_signet)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (article_id, compte_id) DO UPDATE SET
                    position_texte = $3,
                    pourcentage = $4,
                    titre_signet = $5,
                    note_signet = $6,
                    date_creation = NOW()
                 RETURNING *`,
                [articleId, req.user.id, position_texte || null, pourcentage || 0, titre_signet || null, note_signet || null]
            );

            // Invalider le cache
            CacheService.del(`user:${req.user.id}:signets`).catch(() => {});

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Signet sauvegardé avec succès'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer le signet d'un article
     * @route GET /api/v1/blog/articles/:articleId/signets
     */
    async getSignet(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const { articleId } = req.params;

            const result = await db.query(
                `SELECT * FROM SIGNETS_LECTURE 
                 WHERE article_id = $1 AND compte_id = $2`,
                [articleId, req.user.id]
            );

            res.json({
                success: true,
                data: result.rows[0] || null,
                has_signet: result.rows.length > 0
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer tous les signets de l'utilisateur
     * @route GET /api/v1/blog/signets
     */
    async getAllSignets(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const { page = 1, limit = 30 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            const result = await db.query(
                `SELECT 
                    sl.*,
                    a.titre_article,
                    a.slug,
                    a.image_principale,
                    a.categorie_principale,
                    c.nom_utilisateur_compte as auteur_nom,
                    COUNT(*) OVER() as total_count
                 FROM SIGNETS_LECTURE sl
                 JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = sl.article_id
                 LEFT JOIN COMPTES c ON c.id = a.auteur_id
                 WHERE sl.compte_id = $1
                   AND a.statut = 'PUBLIE'
                 ORDER BY sl.date_creation DESC
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

    /**
     * Supprimer un signet
     * @route DELETE /api/v1/blog/articles/:articleId/signets
     */
    async deleteSignet(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const { articleId } = req.params;

            await db.query(
                'DELETE FROM SIGNETS_LECTURE WHERE article_id = $1 AND compte_id = $2',
                [articleId, req.user.id]
            );

            CacheService.del(`user:${req.user.id}:signets`).catch(() => {});

            res.json({
                success: true,
                message: 'Signet supprimé avec succès'
            });

        } catch (error) {
            next(error);
        }
    }

    // ========================================================================
    // NOTES DE LECTURE
    // ========================================================================

    /**
     * Ajouter une note de lecture
     * @route POST /api/v1/blog/articles/:articleId/notes
     */
    async addNote(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const { articleId } = req.params;
            const { 
                contenu_note, 
                position_texte, 
                pourcentage_article, 
                est_privee = true,
                couleur_surlignage 
            } = req.body;

            // Validation
            if (!contenu_note || contenu_note.trim().length < 1) {
                throw new ValidationError('Le contenu de la note est requis');
            }

            if (contenu_note.length > 5000) {
                throw new ValidationError('La note ne doit pas dépasser 5000 caractères');
            }

            // Vérifier que l'article existe
            const article = await db.query(
                'SELECT id FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1',
                [articleId]
            );

            if (article.rows.length === 0) {
                throw new NotFoundError('Article non trouvé');
            }

            const result = await db.query(
                `INSERT INTO NOTES_LECTURE 
                    (article_id, compte_id, contenu_note, position_texte, pourcentage_article, est_privee, couleur_surlignage)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`,
                [
                    articleId, 
                    req.user.id, 
                    contenu_note.trim(), 
                    position_texte || null, 
                    pourcentage_article || null, 
                    est_privee, 
                    couleur_surlignage || null
                ]
            );

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message: 'Note ajoutée avec succès'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les notes de lecture d'un article
     * @route GET /api/v1/blog/articles/:articleId/notes
     */
    async getNotes(req, res, next) {
        try {
            const { articleId } = req.params;
            const { page = 1, limit = 50 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            let query = `
                SELECT 
                    nl.*,
                    c.nom_utilisateur_compte as auteur_nom,
                    c.photo_profil_compte as auteur_photo,
                    COUNT(*) OVER() as total_count
                FROM NOTES_LECTURE nl
                LEFT JOIN COMPTES c ON c.id = nl.compte_id
                WHERE nl.article_id = $1
            `;
            
            const params = [articleId];
            let paramIndex = 2;

            // Si non connecté, montrer uniquement les notes publiques
            if (!req.user || req.user.id !== articleId) {
                query += ` AND (nl.est_privee = FALSE`;
                if (req.user) {
                    query += ` OR nl.compte_id = $${paramIndex}`;
                    params.push(req.user.id);
                    paramIndex++;
                }
                query += `)`;
            } else {
                // L'utilisateur voit toutes ses notes
                query += ` AND nl.compte_id = $${paramIndex}`;
                params.push(req.user.id);
                paramIndex++;
            }

            query += ` ORDER BY nl.position_texte NULLS LAST, nl.date_creation DESC`;
            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
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

    /**
     * Mettre à jour une note
     * @route PUT /api/v1/blog/notes/:id
     */
    async updateNote(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const { id } = req.params;
            const { contenu_note, est_privee, couleur_surlignage } = req.body;

            const note = await db.query(
                'SELECT * FROM NOTES_LECTURE WHERE id = $1 AND compte_id = $2',
                [id, req.user.id]
            );

            if (note.rows.length === 0) {
                throw new NotFoundError('Note non trouvée');
            }

            const result = await db.query(
                `UPDATE NOTES_LECTURE 
                 SET contenu_note = COALESCE($1, contenu_note),
                     est_privee = COALESCE($2, est_privee),
                     couleur_surlignage = COALESCE($3, couleur_surlignage),
                     date_modification = NOW()
                 WHERE id = $4
                 RETURNING *`,
                [contenu_note, est_privee, couleur_surlignage, id]
            );

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Note mise à jour'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Supprimer une note
     * @route DELETE /api/v1/blog/notes/:id
     */
    async deleteNote(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const { id } = req.params;

            const result = await db.query(
                'DELETE FROM NOTES_LECTURE WHERE id = $1 AND compte_id = $2 RETURNING *',
                [id, req.user.id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Note non trouvée');
            }

            res.json({
                success: true,
                message: 'Note supprimée'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer toutes les notes de l'utilisateur
     * @route GET /api/v1/blog/notes
     */
    async getAllNotes(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const { page = 1, limit = 30 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            const result = await db.query(
                `SELECT 
                    nl.*,
                    a.titre_article,
                    a.slug,
                    a.image_principale,
                    COUNT(*) OVER() as total_count
                 FROM NOTES_LECTURE nl
                 JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = nl.article_id
                 WHERE nl.compte_id = $1
                   AND a.statut = 'PUBLIE'
                 ORDER BY nl.date_modification DESC NULLS LAST, nl.date_creation DESC
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
    // PROGRESSION DE LECTURE
    // ========================================================================

    /**
     * Sauvegarder la progression de lecture
     * @route POST /api/v1/blog/articles/:articleId/progression
     */
    async saveProgression(req, res, next) {
        try {
            const { articleId } = req.params;
            const { 
                pourcentage, 
                temps_passe_secondes, 
                scroll_position,
                sections_lues = []
            } = req.body;

            if (!req.user) {
                // Pour les utilisateurs non connectés, on ne sauvegarde pas
                return res.json({ success: true, message: 'Non connecté, progression non sauvegardée' });
            }

            await db.query(
                `INSERT INTO ANALYTIQUES_LECTURE 
                    (article_id, compte_id, pourcentage_lu, temps_passe_secondes, scroll_max_pixels, sections_lues, est_termine, date_debut, date_fin)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), CASE WHEN $7 THEN NOW() ELSE NULL END)
                 ON CONFLICT (article_id, compte_id, session_id) DO UPDATE SET
                    pourcentage_lu = GREATEST(analytiques_lecture.pourcentage_lu, $3),
                    temps_passe_secondes = analytiques_lecture.temps_passe_secondes + $4,
                    scroll_max_pixels = GREATEST(analytiques_lecture.scroll_max_pixels, $5),
                    sections_lues = ARRAY(SELECT DISTINCT unnest(analytiques_lecture.sections_lues || $6::integer[])),
                    est_termine = analytiques_lecture.est_termine OR $7,
                    date_fin = CASE WHEN $7 THEN NOW() ELSE analytiques_lecture.date_fin END`,
                [
                    articleId,
                    req.user.id,
                    pourcentage || 0,
                    temps_passe_secondes || 0,
                    scroll_position || 0,
                    sections_lues,
                    pourcentage >= 90
                ]
            );

            // Mettre à jour le taux de complétion moyen de l'article
            if (pourcentage >= 90) {
                await db.query(
                    `UPDATE ARTICLES_BLOG_PLATEFORME 
                     SET taux_completion = (
                         SELECT ROUND(AVG(pourcentage_lu), 1) 
                         FROM ANALYTIQUES_LECTURE 
                         WHERE article_id = $1 AND pourcentage_lu > 0
                     )
                     WHERE id = $1`,
                    [articleId]
                );
            }

            res.json({
                success: true,
                message: 'Progression enregistrée'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer la progression de lecture d'un article
     * @route GET /api/v1/blog/articles/:articleId/progression
     */
    async getProgression(req, res, next) {
        try {
            const { articleId } = req.params;

            if (!req.user) {
                return res.json({
                    success: true,
                    data: { pourcentage: 0, temps_passe: 0 }
                });
            }

            const result = await db.query(
                `SELECT 
                    pourcentage_lu,
                    temps_passe_secondes,
                    scroll_max_pixels,
                    sections_lues,
                    est_termine,
                    date_debut,
                    date_fin
                 FROM ANALYTIQUES_LECTURE
                 WHERE article_id = $1 AND compte_id = $2
                 ORDER BY date_debut DESC
                 LIMIT 1`,
                [articleId, req.user.id]
            );

            res.json({
                success: true,
                data: result.rows[0] || {
                    pourcentage: 0,
                    temps_passe: 0,
                    est_termine: false
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer l'historique de lecture
     * @route GET /api/v1/blog/lecture/historique
     */
    async getHistoriqueLecture(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const { page = 1, limit = 30 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            const result = await db.query(
                `SELECT 
                    al.*,
                    a.titre_article,
                    a.slug,
                    a.image_principale,
                    a.categorie_principale,
                    a.temps_lecture_minutes,
                    c.nom_utilisateur_compte as auteur_nom,
                    COUNT(*) OVER() as total_count
                 FROM ANALYTIQUES_LECTURE al
                 JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = al.article_id
                 LEFT JOIN COMPTES c ON c.id = a.auteur_id
                 WHERE al.compte_id = $1
                   AND a.statut = 'PUBLIE'
                 ORDER BY al.date_debut DESC
                 LIMIT $2 OFFSET $3`,
                [req.user.id, parseInt(limit), offset]
            );

            const total = result.rows[0]?.total_count || 0;

            // Statistiques de lecture
            const stats = await db.query(
                `SELECT 
                    COUNT(*) as articles_lus,
                    COALESCE(SUM(temps_passe_secondes), 0) as temps_total_secondes,
                    ROUND(AVG(pourcentage_lu), 1) as pourcentage_moyen,
                    COUNT(*) FILTER (WHERE est_termine = TRUE) as articles_termines,
                    COUNT(DISTINCT article_id) as articles_uniques
                 FROM ANALYTIQUES_LECTURE
                 WHERE compte_id = $1`,
                [req.user.id]
            );

            res.json({
                success: true,
                data: {
                    historique: result.rows,
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
}

module.exports = new FavoriController();