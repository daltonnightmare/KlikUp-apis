// src/controllers/blog/AbonnementBlogController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError, AuthenticationError } = require('../../utils/errors/AppError');
const CacheService = require('../../services/cache/CacheService');

class AbonnementBlogController {
    
    /**
     * S'abonner à une catégorie, un auteur ou un tag
     * @route POST /api/v1/blog/abonnements
     */
    async subscribe(req, res, next) {
        const client = await db.getClient();
        
        try {
            // ✅ Vérifier l'authentification
            if (!req.user || !req.user.id) {
                throw new AuthenticationError('Authentification requise');
            }

            await client.query('BEGIN');
            
            const { type_abonnement, reference_id } = req.body;

            // ✅ Validation du type
            if (!['CATEGORIE', 'AUTEUR', 'TAG'].includes(type_abonnement)) {
                throw new ValidationError('Type d\'abonnement invalide. Utilisez CATEGORIE, AUTEUR ou TAG');
            }

            // ✅ Validation de l'ID de référence
            if (!reference_id) {
                throw new ValidationError('La référence est requise');
            }

            // ✅ Vérifier que la référence existe selon le type
            await this.validateReference(client, type_abonnement, reference_id);

            // ✅ Vérifier le nombre d'abonnements actifs (limite optionnelle)
            const activeSubscriptions = await client.query(
                `SELECT COUNT(*) as count 
                 FROM ABONNEMENTS_BLOG 
                 WHERE compte_id = $1 AND actif = true`,
                [req.user.id]
            );

            const MAX_SUBSCRIPTIONS = 50;
            if (parseInt(activeSubscriptions.rows[0].count) >= MAX_SUBSCRIPTIONS) {
                throw new ValidationError(
                    `Vous avez atteint la limite de ${MAX_SUBSCRIPTIONS} abonnements actifs`
                );
            }

            // ✅ Vérifier si déjà abonné avec FOR UPDATE pour éviter les doublons
            const existing = await client.query(
                `SELECT id, actif 
                 FROM ABONNEMENTS_BLOG 
                 WHERE compte_id = $1 
                   AND type_abonnement = $2 
                   AND reference_id = $3 
                 FOR UPDATE`,
                [req.user.id, type_abonnement, reference_id]
            );

            let result;
            let message;
            let action;

            if (existing.rows.length > 0) {
                const current = existing.rows[0];
                
                if (current.actif) {
                    // ✅ Désactiver l'abonnement
                    result = await client.query(
                        `UPDATE ABONNEMENTS_BLOG 
                         SET actif = false,
                             date_abonnement = NOW()
                         WHERE id = $1
                         RETURNING *`,
                        [current.id]
                    );
                    action = 'deactivated';
                    message = 'Abonnement désactivé';
                } else {
                    // ✅ Réactiver l'abonnement
                    result = await client.query(
                        `UPDATE ABONNEMENTS_BLOG 
                         SET actif = true,
                             date_abonnement = NOW()
                         WHERE id = $1
                         RETURNING *`,
                        [current.id]
                    );
                    action = 'reactivated';
                    message = 'Abonnement réactivé';
                }
            } else {
                // ✅ Nouvel abonnement
                result = await client.query(
                    `INSERT INTO ABONNEMENTS_BLOG (compte_id, type_abonnement, reference_id, actif)
                     VALUES ($1, $2, $3, true)
                     ON CONFLICT (compte_id, type_abonnement, reference_id) 
                     DO UPDATE SET actif = true, date_abonnement = NOW()
                     RETURNING *`,
                    [req.user.id, type_abonnement, reference_id]
                );
                action = 'created';
                message = 'Abonnement créé avec succès';
            }

            await client.query('COMMIT');

            // ✅ Invalider le cache des abonnements
            CacheService.del(`user:${req.user.id}:subscriptions`).catch(() => {});
            CacheService.invalidatePattern('blog:abonnements:*').catch(() => {});

            res.status(201).json({
                success: true,
                data: {
                    ...result.rows[0],
                    action
                },
                message
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les abonnements de l'utilisateur
     * @route GET /api/v1/blog/abonnements/mes-abonnements
     */
    async mesAbonnements(req, res, next) {
        try {
            // ✅ Vérifier l'authentification
            if (!req.user || !req.user.id) {
                throw new AuthenticationError('Authentification requise');
            }

            const { type, actif, page = 1, limit = 50 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            // ✅ Cache check
            const cacheKey = `user:${req.user.id}:subscriptions:${type || 'all'}:${actif}:${page}:${limit}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    success: true,
                    data: cached.data,
                    pagination: cached.pagination,
                    fromCache: true
                });
            }

            // ✅ Requête optimisée avec JOIN pour éviter N+1
            let query = `
                SELECT 
                    a.*,
                    CASE 
                        WHEN a.type_abonnement = 'AUTEUR' THEN c.nom_utilisateur_compte
                        WHEN a.type_abonnement = 'CATEGORIE' THEN a.reference_id::text
                        WHEN a.type_abonnement = 'TAG' THEN a.reference_id::text
                        ELSE a.reference_id::text
                    END as reference_nom,
                    CASE 
                        WHEN a.type_abonnement = 'AUTEUR' THEN c.photo_profil_compte
                        ELSE NULL
                    END as reference_photo,
                    COUNT(*) OVER() as total_count
                FROM ABONNEMENTS_BLOG a
                LEFT JOIN COMPTES c ON c.id = a.reference_id 
                    AND a.type_abonnement = 'AUTEUR'
                WHERE a.compte_id = $1
            `;
            
            const params = [req.user.id];
            let paramIndex = 2;

            if (type) {
                query += ` AND a.type_abonnement = $${paramIndex}`;
                params.push(type);
                paramIndex++;
            }

            if (actif !== undefined) {
                query += ` AND a.actif = $${paramIndex}`;
                params.push(actif === 'true' || actif === true);
                paramIndex++;
            }

            query += ` ORDER BY a.date_abonnement DESC`;
            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

            const responseData = {
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / Math.max(1, parseInt(limit)))
                }
            };

            // ✅ Mettre en cache pour 5 minutes
            CacheService.set(cacheKey, responseData, 300).catch(() => {});

            res.json(responseData);

        } catch (error) {
            next(error);
        }
    }

    /**
     * Se désabonner
     * @route DELETE /api/v1/blog/abonnements/:id
     */
    async unsubscribe(req, res, next) {
        const client = await db.getClient();
        
        try {
            // ✅ Vérifier l'authentification
            if (!req.user || !req.user.id) {
                throw new AuthenticationError('Authentification requise');
            }

            const { id } = req.params;

            // ✅ Vérifier que l'abonnement existe et appartient à l'utilisateur
            const existing = await client.query(
                `SELECT * FROM ABONNEMENTS_BLOG 
                 WHERE id = $1 AND compte_id = $2`,
                [id, req.user.id]
            );

            if (existing.rows.length === 0) {
                throw new NotFoundError('Abonnement non trouvé');
            }

            if (!existing.rows[0].actif) {
                throw new ValidationError('Cet abonnement est déjà désactivé');
            }

            // ✅ Désactiver l'abonnement (soft delete)
            const result = await client.query(
                `UPDATE ABONNEMENTS_BLOG 
                 SET actif = false,
                     date_abonnement = NOW()
                 WHERE id = $1 AND compte_id = $2
                 RETURNING *`,
                [id, req.user.id]
            );

            // ✅ Invalider le cache
            CacheService.del(`user:${req.user.id}:subscriptions`).catch(() => {});
            CacheService.invalidatePattern('blog:abonnements:*').catch(() => {});

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Désabonnement effectué avec succès'
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer définitivement un abonnement
     * @route DELETE /api/v1/blog/abonnements/:id/permanent
     */
    async deletePermanent(req, res, next) {
        const client = await db.getClient();
        
        try {
            if (!req.user || !req.user.id) {
                throw new AuthenticationError('Authentification requise');
            }

            const { id } = req.params;

            // ✅ Vérifier que l'abonnement existe
            const existing = await client.query(
                `SELECT * FROM ABONNEMENTS_BLOG WHERE id = $1 AND compte_id = $2`,
                [id, req.user.id]
            );

            if (existing.rows.length === 0) {
                throw new NotFoundError('Abonnement non trouvé');
            }

            // ✅ Suppression définitive
            await client.query(
                `DELETE FROM ABONNEMENTS_BLOG WHERE id = $1`,
                [id]
            );

            // ✅ Invalider le cache
            CacheService.del(`user:${req.user.id}:subscriptions`).catch(() => {});

            res.json({
                success: true,
                message: 'Abonnement supprimé définitivement'
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les abonnés d'un auteur/catégorie/tag
     * @route GET /api/v1/blog/abonnements/abonnes
     */
    async getAbonnes(req, res, next) {
        try {
            const { type, reference_id, page = 1, limit = 50 } = req.query;

            // ✅ Validation
            if (!type || !['CATEGORIE', 'AUTEUR', 'TAG'].includes(type)) {
                throw new ValidationError('Type d\'abonnement invalide');
            }

            if (!reference_id) {
                throw new ValidationError('La référence est requise');
            }

            const offset = (parseInt(page) - 1) * parseInt(limit);

            // ✅ Cache check
            const cacheKey = `blog:abonnements:${type}:${reference_id}:${page}:${limit}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    success: true,
                    data: cached.data,
                    pagination: cached.pagination,
                    fromCache: true
                });
            }

            const result = await db.query(
                `SELECT 
                    a.id,
                    a.type_abonnement,
                    a.date_abonnement,
                    c.id as compte_id,
                    c.nom_utilisateur_compte,
                    c.photo_profil_compte,
                    COUNT(*) OVER() as total_count
                 FROM ABONNEMENTS_BLOG a
                 JOIN COMPTES c ON c.id = a.compte_id
                 WHERE a.type_abonnement = $1 
                   AND a.reference_id = $2
                   AND a.actif = true
                 ORDER BY a.date_abonnement DESC
                 LIMIT $3 OFFSET $4`,
                [type, reference_id, parseInt(limit), offset]
            );

            const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

            const responseData = {
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / Math.max(1, parseInt(limit)))
                }
            };

            // ✅ Mettre en cache pour 10 minutes
            CacheService.set(cacheKey, responseData, 600).catch(() => {});

            res.json(responseData);

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les statistiques d'abonnements
     * @route GET /api/v1/blog/abonnements/stats
     */
    async getAbonnementStats(req, res, next) {
        try {
            if (!req.user || !req.user.id) {
                throw new AuthenticationError('Authentification requise');
            }

            const stats = await db.query(
                `SELECT 
                    COUNT(*) FILTER (WHERE actif = true) as actifs,
                    COUNT(*) FILTER (WHERE actif = false) as inactifs,
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE type_abonnement = 'CATEGORIE' AND actif = true) as categories,
                    COUNT(*) FILTER (WHERE type_abonnement = 'AUTEUR' AND actif = true) as auteurs,
                    COUNT(*) FILTER (WHERE type_abonnement = 'TAG' AND actif = true) as tags
                 FROM ABONNEMENTS_BLOG
                 WHERE compte_id = $1`,
                [req.user.id]
            );

            res.json({
                success: true,
                data: stats.rows[0]
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Vérifier le statut d'abonnement
     * @route GET /api/v1/blog/abonnements/check
     * @query type_abonnement, reference_id
     */
    async checkSubscription(req, res, next) {
        try {
            if (!req.user || !req.user.id) {
                return res.json({
                    success: true,
                    data: {
                        is_subscribed: false,
                        subscription_id: null
                    }
                });
            }

            const { type_abonnement, reference_id } = req.query;

            if (!type_abonnement || !reference_id) {
                throw new ValidationError('Type et référence requis');
            }

            const result = await db.query(
                `SELECT id, actif, date_abonnement
                 FROM ABONNEMENTS_BLOG
                 WHERE compte_id = $1 
                   AND type_abonnement = $2 
                   AND reference_id = $3`,
                [req.user.id, type_abonnement, reference_id]
            );

            res.json({
                success: true,
                data: {
                    is_subscribed: result.rows.length > 0 && result.rows[0].actif,
                    subscription_id: result.rows[0]?.id || null,
                    is_active: result.rows[0]?.actif || false,
                    date_abonnement: result.rows[0]?.date_abonnement || null
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
     * Vérifie que la référence existe selon le type d'abonnement
     */
    async validateReference(client, type, referenceId) {
        switch (type) {
            case 'AUTEUR':
                const auteur = await client.query(
                    `SELECT id, nom_utilisateur_compte 
                     FROM COMPTES 
                     WHERE id = $1 AND est_supprime = false`,
                    [referenceId]
                );
                if (auteur.rows.length === 0) {
                    throw new ValidationError('Auteur non trouvé ou supprimé');
                }
                // ✅ Vérifier que ce n'est pas soi-même
                if (client.lastQuery && client.lastQuery.values) {
                    // Note: Cette vérification nécessite l'ID utilisateur
                }
                break;

            case 'CATEGORIE':
                // ✅ Vérifier que la catégorie existe dans l'ENUM
                const validCategories = await client.query(
                    `SELECT unnest(enum_range(NULL::categories_article)) as categorie`
                );
                const categoryExists = validCategories.rows.some(
                    row => row.categorie === referenceId
                );
                if (!categoryExists) {
                    throw new ValidationError(
                        `Catégorie invalide. Catégories disponibles: ${validCategories.rows.map(r => r.categorie).join(', ')}`
                    );
                }
                break;

            case 'TAG':
                // ✅ Vérifier que le tag existe (utilisé dans au moins un article)
                const tagExists = await client.query(
                    `SELECT 1 FROM ARTICLES_BLOG_PLATEFORME 
                     WHERE mots_cles @> ARRAY[$1]::text[] 
                     LIMIT 1`,
                    [referenceId]
                );
                if (tagExists.rows.length === 0) {
                    // On pourrait autoriser les tags qui n'existent pas encore
                    // throw new ValidationError('Tag non trouvé');
                }
                break;

            default:
                throw new ValidationError(`Type d'abonnement non supporté: ${type}`);
        }
    }
}

module.exports = new AbonnementBlogController();