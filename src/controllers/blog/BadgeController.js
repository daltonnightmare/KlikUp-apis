// src/controllers/blog/BadgeController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError, AuthenticationError } = require('../../utils/errors/AppError');
const CacheService = require('../../services/cache/CacheService');
const NotificationService = require('../../services/notification/NotificationService');

class BadgeController {

    // ========================================================================
    // ADMINISTRATION DES BADGES
    // ========================================================================

    /**
     * Créer un nouveau badge
     * @route POST /api/v1/blog/badges
     */
    async create(req, res, next) {
        try {
            const {
                nom_badge,
                description_badge,
                icone_badge,
                condition_sql,
                points_requis = 0,
                categorie_badge = 'LECTURE',
                badge_parent_id,
                ordre = 0,
                est_secret = false,
                est_limite = false,
                date_expiration
            } = req.body;

            // Validation
            if (!nom_badge || nom_badge.trim().length < 3) {
                throw new ValidationError('Le nom du badge doit contenir au moins 3 caractères');
            }

            if (!description_badge) {
                throw new ValidationError('La description du badge est requise');
            }

            if (!['LECTURE', 'INTERACTION', 'QUIZ', 'SOCIAL', 'FIDELITE', 'SPECIAL', 'EVENEMENT'].includes(categorie_badge)) {
                throw new ValidationError('Catégorie de badge invalide');
            }

            // Vérifier l'unicité du nom
            const existing = await db.query(
                'SELECT id FROM BADGES_LECTURE WHERE nom_badge = $1',
                [nom_badge.trim()]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError('Un badge avec ce nom existe déjà');
            }

            const result = await db.query(
                `INSERT INTO BADGES_LECTURE (nom_badge, description_badge, icone_badge, condition_sql, points_requis, categorie_badge, badge_parent_id, ordre, est_secret, est_limite, date_expiration)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 RETURNING *`,
                [
                    nom_badge.trim(), description_badge.trim(), icone_badge || null,
                    condition_sql || null, points_requis, categorie_badge,
                    badge_parent_id || null, ordre, est_secret, est_limite, date_expiration || null
                ]
            );

            // Invalider le cache
            CacheService.invalidatePattern('badges:*').catch(() => {});

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message: 'Badge créé avec succès 🏆'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Mettre à jour un badge
     * @route PUT /api/v1/blog/badges/:id
     */
    async update(req, res, next) {
        try {
            const { id } = req.params;
            const updateData = req.body;

            const existing = await db.query('SELECT * FROM BADGES_LECTURE WHERE id = $1', [id]);
            if (existing.rows.length === 0) {
                throw new NotFoundError('Badge non trouvé');
            }

            const allowedFields = [
                'nom_badge', 'description_badge', 'icone_badge', 'condition_sql',
                'points_requis', 'categorie_badge', 'badge_parent_id', 'ordre',
                'est_secret', 'est_limite', 'date_expiration', 'est_actif'
            ];

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
                await db.query(
                    `UPDATE BADGES_LECTURE SET ${setClauses.join(', ')} WHERE id = $1`,
                    values
                );
            }

            const result = await db.query('SELECT * FROM BADGES_LECTURE WHERE id = $1', [id]);
            CacheService.invalidatePattern('badges:*').catch(() => {});

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Badge mis à jour'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Supprimer un badge
     * @route DELETE /api/v1/blog/badges/:id
     */
    async delete(req, res, next) {
        try {
            const { id } = req.params;

            const existing = await db.query('SELECT * FROM BADGES_LECTURE WHERE id = $1', [id]);
            if (existing.rows.length === 0) {
                throw new NotFoundError('Badge non trouvé');
            }

            await db.query('DELETE FROM BADGES_LECTURE WHERE id = $1', [id]);
            CacheService.invalidatePattern('badges:*').catch(() => {});

            res.json({
                success: true,
                message: 'Badge supprimé'
            });

        } catch (error) {
            next(error);
        }
    }

    // ========================================================================
    // BADGES UTILISATEUR
    // ========================================================================

    /**
     * Récupérer tous les badges disponibles
     * @route GET /api/v1/blog/badges
     */
    async getAllBadges(req, res, next) {
        try {
            const { categorie, page = 1, limit = 50 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            const cacheKey = `badges:${categorie || 'all'}:${page}:${limit}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({ success: true, data: cached, fromCache: true });
            }

            let query = `
                SELECT b.*,
                       COUNT(bu.id) as nombre_attributions,
                       COUNT(*) OVER() as total_count
                FROM BADGES_LECTURE b
                LEFT JOIN BADGES_UTILISATEUR bu ON bu.badge_id = b.id
                WHERE b.est_actif = TRUE
            `;

            const params = [];
            let paramIndex = 1;

            if (categorie) {
                query += ` AND b.categorie_badge = $${paramIndex}`;
                params.push(categorie);
                paramIndex++;
            }

            // Ne pas montrer les badges secrets dans la liste générale
            if (!req.user || !['ADMINISTRATEUR_PLATEFORME'].includes(req.user.compte_role)) {
                query += ` AND b.est_secret = FALSE`;
            }

            query += ` GROUP BY b.id ORDER BY b.categorie_badge, b.ordre, b.points_requis`;
            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);

            // Si l'utilisateur est connecté, ajouter ses badges
            if (req.user && result.rows.length > 0) {
                const badgeIds = result.rows.map(b => b.id);
                const userBadges = await db.query(
                    `SELECT badge_id, date_obtention, progression 
                     FROM BADGES_UTILISATEUR 
                     WHERE compte_id = $1 AND badge_id = ANY($2::int[])`,
                    [req.user.id, badgeIds]
                );

                const userBadgeMap = new Map();
                for (const ub of userBadges.rows) {
                    userBadgeMap.set(ub.badge_id, ub);
                }

                for (const badge of result.rows) {
                    const userBadge = userBadgeMap.get(badge.id);
                    badge.est_debloque = !!userBadge;
                    badge.date_deblocage = userBadge?.date_obtention || null;
                    badge.progression = userBadge?.progression || this.calculerProgression(badge, req.user.id);
                }
            }

            const total = result.rows[0]?.total_count || 0;

            const responseData = {
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(total),
                    pages: Math.ceil(parseInt(total) / Math.max(1, parseInt(limit)))
                }
            };

            CacheService.set(cacheKey, responseData, 300).catch(() => {});

            res.json(responseData);

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les badges de l'utilisateur connecté
     * @route GET /api/v1/blog/badges/mes-badges
     */
    async getMyBadges(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const cacheKey = `user:${req.user.id}:badges`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({ success: true, data: cached, fromCache: true });
            }

            // Récupérer les badges obtenus
            const badgesObtenus = await db.query(
                `SELECT b.*, bu.date_obtention, bu.progression
                 FROM BADGES_UTILISATEUR bu
                 JOIN BADGES_LECTURE b ON b.id = bu.badge_id
                 WHERE bu.compte_id = $1
                 ORDER BY bu.date_obtention DESC`,
                [req.user.id]
            );

            // Récupérer les badges en cours de progression
            const badgesEnCours = await db.query(
                `SELECT b.*
                 FROM BADGES_LECTURE b
                 WHERE b.est_actif = TRUE
                   AND b.est_secret = FALSE
                   AND b.id NOT IN (
                       SELECT badge_id FROM BADGES_UTILISATEUR WHERE compte_id = $1
                   )
                 ORDER BY b.categorie_badge, b.ordre
                 LIMIT 20`,
                [req.user.id]
            );

            // Calculer la progression pour les badges en cours
            for (const badge of badgesEnCours.rows) {
                badge.progression = await this.calculerProgressionAsync(badge, req.user.id);
            }

            // Statistiques
            const stats = await db.query(
                `SELECT 
                    COUNT(*) as total_badges,
                    SUM(b.points_requis) as total_points,
                    COUNT(*) FILTER (WHERE b.categorie_badge = 'LECTURE') as badges_lecture,
                    COUNT(*) FILTER (WHERE b.categorie_badge = 'INTERACTION') as badges_interaction,
                    COUNT(*) FILTER (WHERE b.categorie_badge = 'QUIZ') as badges_quiz,
                    COUNT(*) FILTER (WHERE b.categorie_badge = 'SOCIAL') as badges_social
                 FROM BADGES_UTILISATEUR bu
                 JOIN BADGES_LECTURE b ON b.id = bu.badge_id
                 WHERE bu.compte_id = $1`,
                [req.user.id]
            );

            // Prochain badge
            const prochainBadge = await db.query(
                `SELECT b.* FROM BADGES_LECTURE b
                 WHERE b.est_actif = TRUE
                   AND b.id NOT IN (SELECT badge_id FROM BADGES_UTILISATEUR WHERE compte_id = $1)
                 ORDER BY b.points_requis ASC
                 LIMIT 1`,
                [req.user.id]
            );

            const responseData = {
                success: true,
                data: {
                    badges_obtenus: badgesObtenus.rows,
                    badges_en_cours: badgesEnCours.rows,
                    prochain_badge: prochainBadge.rows[0] || null,
                    stats: stats.rows[0]
                }
            };

            CacheService.set(cacheKey, responseData, 120).catch(() => {});

            res.json(responseData);

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer le classement des utilisateurs par badges
     * @route GET /api/v1/blog/badges/classement
     */
    async getClassement(req, res, next) {
        try {
            const { page = 1, limit = 50, categorie } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            const cacheKey = `badges:classement:${categorie || 'global'}:${page}:${limit}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({ success: true, data: cached, fromCache: true });
            }

            let query = `
                SELECT 
                    c.id as compte_id,
                    c.nom_utilisateur_compte,
                    c.photo_profil_compte,
                    COUNT(bu.id) as nombre_badges,
                    COALESCE(SUM(b.points_requis), 0) as total_points,
                    RANK() OVER (ORDER BY COUNT(bu.id) DESC, COALESCE(SUM(b.points_requis), 0) DESC) as classement,
                    COUNT(*) OVER() as total_participants
                FROM COMPTES c
                LEFT JOIN BADGES_UTILISATEUR bu ON bu.compte_id = c.id
                LEFT JOIN BADGES_LECTURE b ON b.id = bu.badge_id
                WHERE c.est_supprime = FALSE
            `;

            const params = [];
            let paramIndex = 1;

            if (categorie) {
                query += ` AND b.categorie_badge = $${paramIndex}`;
                params.push(categorie);
                paramIndex++;
            }

            query += `
                GROUP BY c.id, c.nom_utilisateur_compte, c.photo_profil_compte
                HAVING COUNT(bu.id) > 0
                ORDER BY nombre_badges DESC, total_points DESC
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);

            // Récupérer le classement de l'utilisateur connecté
            let userRank = null;
            if (req.user) {
                const rankResult = await db.query(
                    `SELECT classement, nombre_badges, total_points FROM (
                        SELECT 
                            c.id,
                            COUNT(bu.id) as nombre_badges,
                            COALESCE(SUM(b.points_requis), 0) as total_points,
                            RANK() OVER (ORDER BY COUNT(bu.id) DESC, COALESCE(SUM(b.points_requis), 0) DESC) as classement
                        FROM COMPTES c
                        LEFT JOIN BADGES_UTILISATEUR bu ON bu.compte_id = c.id
                        LEFT JOIN BADGES_LECTURE b ON b.id = bu.badge_id
                        WHERE c.est_supprime = FALSE
                        GROUP BY c.id
                    ) rankings WHERE id = $1`,
                    [req.user.id]
                );
                userRank = rankResult.rows[0] || null;
            }

            const total = result.rows[0]?.total_participants || 0;

            const responseData = {
                success: true,
                data: {
                    classement: result.rows,
                    mon_classement: userRank
                },
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(total),
                    pages: Math.ceil(parseInt(total) / Math.max(1, parseInt(limit)))
                }
            };

            CacheService.set(cacheKey, responseData, 600).catch(() => {});

            res.json(responseData);

        } catch (error) {
            next(error);
        }
    }

    /**
     * Vérifier et attribuer automatiquement les badges
     * @route POST /api/v1/blog/badges/verifier
     */
    async verifierBadges(req, res, next) {
        const client = await db.getClient();
        
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const badgesAttribues = [];
            const badgesProgresses = [];

            // Récupérer tous les badges non obtenus
            const badges = await client.query(
                `SELECT b.* FROM BADGES_LECTURE b
                 WHERE b.est_actif = TRUE
                   AND b.id NOT IN (
                       SELECT badge_id FROM BADGES_UTILISATEUR WHERE compte_id = $1
                   )
                 ORDER BY b.points_requis ASC`,
                [req.user.id]
            );

            for (const badge of badges.rows) {
                let estDebloque = false;

                switch (badge.nom_badge) {
                    case 'Premier article lu':
                        const articlesLus = await client.query(
                            'SELECT COUNT(*) FROM ANALYTIQUES_LECTURE WHERE compte_id = $1 AND pourcentage_lu >= 80',
                            [req.user.id]
                        );
                        estDebloque = parseInt(articlesLus.rows[0].count) >= 1;
                        break;

                    case 'Lecteur assidu':
                        const assidu = await client.query(
                            'SELECT COUNT(DISTINCT article_id) FROM ANALYTIQUES_LECTURE WHERE compte_id = $1 AND pourcentage_lu >= 80',
                            [req.user.id]
                        );
                        estDebloque = parseInt(assidu.rows[0].count) >= 10;
                        break;

                    case 'Dévoreur de contenu':
                        const devoreur = await client.query(
                            'SELECT COUNT(DISTINCT article_id) FROM ANALYTIQUES_LECTURE WHERE compte_id = $1',
                            [req.user.id]
                        );
                        estDebloque = parseInt(devoreur.rows[0].count) >= 50;
                        break;

                    case 'Commentateur':
                        const commentateur = await client.query(
                            'SELECT COUNT(*) FROM COMMENTAIRES WHERE auteur_id = $1 AND statut = \'APPROUVE\'',
                            [req.user.id]
                        );
                        estDebloque = parseInt(commentateur.rows[0].count) >= 5;
                        break;

                    case 'Critique':
                        const critique = await client.query(
                            'SELECT COUNT(*) FROM AVIS WHERE auteur_id = $1 AND statut = \'PUBLIE\'',
                            [req.user.id]
                        );
                        estDebloque = parseInt(critique.rows[0].count) >= 10;
                        break;

                    case 'Partageur':
                        const partageur = await client.query(
                            'SELECT COUNT(*) FROM PARTAGES_ARTICLES WHERE compte_id = $1',
                            [req.user.id]
                        );
                        estDebloque = parseInt(partageur.rows[0].count) >= 20;
                        break;

                    case 'Expert en quiz':
                        const expert = await client.query(
                            `SELECT COUNT(*) FROM SCORES_UTILISATEUR 
                             WHERE compte_id = $1 AND pourcentage = 100`,
                            [req.user.id]
                        );
                        estDebloque = parseInt(expert.rows[0].count) >= 5;
                        break;

                    case 'Collectionneur':
                        const collectionneur = await client.query(
                            'SELECT COUNT(*) FROM FAVORIS_ARTICLES WHERE compte_id = $1',
                            [req.user.id]
                        );
                        estDebloque = parseInt(collectionneur.rows[0].count) >= 30;
                        break;

                    case 'Polyglotte':
                        const polyglotte = await client.query(
                            `SELECT COUNT(DISTINCT langue) FROM ARTICLES_BLOG_PLATEFORME a
                             JOIN ANALYTIQUES_LECTURE al ON al.article_id = a.id
                             WHERE al.compte_id = $1`,
                            [req.user.id]
                        );
                        estDebloque = parseInt(polyglotte.rows[0].count) >= 2;
                        break;

                    default:
                        // Pour les badges personnalisés avec condition_sql
                        if (badge.condition_sql) {
                            try {
                                const result = await client.query(
                                    badge.condition_sql.replace('$compte_id', '$1'),
                                    [req.user.id]
                                );
                                estDebloque = result.rows[0]?.count > 0 || result.rows[0]?.result === true;
                            } catch (sqlError) {
                                console.error(`Erreur condition badge ${badge.nom_badge}:`, sqlError);
                            }
                        }
                        break;
                }

                if (estDebloque) {
                    await client.query(
                        `INSERT INTO BADGES_UTILISATEUR (compte_id, badge_id)
                         VALUES ($1, $2)
                         ON CONFLICT DO NOTHING`,
                        [req.user.id, badge.id]
                    );
                    badgesAttribues.push(badge);

                    // Notification
                    setImmediate(() => {
                        NotificationService.send({
                            destinataire_id: req.user.id,
                            type: 'BADGE_OBTENU',
                            titre: '🏆 Nouveau badge !',
                            corps: `Vous avez débloqué le badge "${badge.nom_badge}" : ${badge.description_badge}`,
                            entite_source_type: 'BADGE',
                            entite_source_id: badge.id,
                            priorite: 'HAUTE'
                        }).catch(() => {});
                    });
                } else {
                    badgesProgresses.push(badge);
                }
            }

            // Invalider le cache
            CacheService.del(`user:${req.user.id}:badges`).catch(() => {});
            CacheService.invalidatePattern('badges:classement:*').catch(() => {});

            res.json({
                success: true,
                data: {
                    badges_attribues: badgesAttribues,
                    badges_en_progression: badgesProgresses,
                    nombre_attribues: badgesAttribues.length
                },
                message: badgesAttribues.length > 0 
                    ? `🎉 ${badgesAttribues.length} nouveau(x) badge(s) !` 
                    : 'Aucun nouveau badge'
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les statistiques globales des badges
     * @route GET /api/v1/blog/badges/stats
     */
    async getStats(req, res, next) {
        try {
            const cacheKey = 'badges:stats:global';
            const cached = await CacheService.get(cacheKey);
            if (cached) return res.json({ success: true, data: cached, fromCache: true });

            const stats = await db.query(
                `SELECT 
                    COUNT(DISTINCT b.id) as total_badges,
                    COUNT(DISTINCT bu.compte_id) as utilisateurs_avec_badges,
                    COUNT(bu.id) as total_attributions,
                    b.categorie_badge,
                    COUNT(bu.id) as attributions
                 FROM BADGES_LECTURE b
                 LEFT JOIN BADGES_UTILISATEUR bu ON bu.badge_id = b.id
                 WHERE b.est_actif = TRUE
                 GROUP BY b.categorie_badge
                 ORDER BY attributions DESC`
            );

            // Badges les plus rares
            const rares = await db.query(
                `SELECT b.*, COUNT(bu.id) as nombre_attributions
                 FROM BADGES_LECTURE b
                 LEFT JOIN BADGES_UTILISATEUR bu ON bu.badge_id = b.id
                 WHERE b.est_actif = TRUE
                 GROUP BY b.id
                 HAVING COUNT(bu.id) > 0
                 ORDER BY nombre_attributions ASC
                 LIMIT 10`
            );

            const responseData = {
                success: true,
                data: {
                    stats: stats.rows,
                    badges_rares: rares.rows
                }
            };

            CacheService.set(cacheKey, responseData, 600).catch(() => {});
            res.json(responseData);

        } catch (error) {
            next(error);
        }
    }

    /**
     * Partager un badge sur les réseaux sociaux
     * @route POST /api/v1/blog/badges/:id/partager
     */
    async partagerBadge(req, res, next) {
        try {
            if (!req.user) throw new AuthenticationError('Authentification requise');

            const { id } = req.params;
            const { plateforme } = req.body;

            // Vérifier que l'utilisateur possède ce badge
            const badge = await db.query(
                `SELECT b.*, bu.date_obtention
                 FROM BADGES_UTILISATEUR bu
                 JOIN BADGES_LECTURE b ON b.id = bu.badge_id
                 WHERE bu.badge_id = $1 AND bu.compte_id = $2`,
                [id, req.user.id]
            );

            if (badge.rows.length === 0) {
                throw new NotFoundError('Badge non obtenu');
            }

            // Générer le texte de partage
            const textePartage = `🏆 Je viens de débloquer le badge "${badge.rows[0].nom_badge}" sur la plateforme ! ${badge.rows[0].description_badge}`;

            const urlsPartage = {
                TWITTER: `https://twitter.com/intent/tweet?text=${encodeURIComponent(textePartage)}`,
                FACEBOOK: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(process.env.BASE_URL)}&quote=${encodeURIComponent(textePartage)}`,
                LINKEDIN: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(process.env.BASE_URL)}`,
                WHATSAPP: `https://wa.me/?text=${encodeURIComponent(textePartage)}`
            };

            res.json({
                success: true,
                data: {
                    texte_partage: textePartage,
                    url_partage: urlsPartage[plateforme] || urlsPartage.TWITTER
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
     * Calcule la progression d'un badge pour un utilisateur
     */
    calculerProgression(badge, userId) {
        // Progression estimée basée sur le type de badge
        const progressions = {
            'Lecteur assidu': async () => {
                const result = await db.query(
                    'SELECT COUNT(DISTINCT article_id) FROM ANALYTIQUES_LECTURE WHERE compte_id = $1 AND pourcentage_lu >= 80',
                    [userId]
                );
                return Math.min(100, (parseInt(result.rows[0].count) / 10) * 100);
            },
            'Commentateur': async () => {
                const result = await db.query(
                    'SELECT COUNT(*) FROM COMMENTAIRES WHERE auteur_id = $1 AND statut = \'APPROUVE\'',
                    [userId]
                );
                return Math.min(100, (parseInt(result.rows[0].count) / 5) * 100);
            }
        };

        return 0; // Par défaut
    }

    async calculerProgressionAsync(badge, userId) {
        try {
            switch (badge.nom_badge) {
                case 'Lecteur assidu':
                    const lecteur = await db.query(
                        'SELECT COUNT(DISTINCT article_id) FROM ANALYTIQUES_LECTURE WHERE compte_id = $1 AND pourcentage_lu >= 80',
                        [userId]
                    );
                    return Math.round(Math.min(100, (parseInt(lecteur.rows[0].count) / 10) * 100));

                case 'Dévoreur de contenu':
                    const devoreur = await db.query(
                        'SELECT COUNT(DISTINCT article_id) FROM ANALYTIQUES_LECTURE WHERE compte_id = $1',
                        [userId]
                    );
                    return Math.round(Math.min(100, (parseInt(devoreur.rows[0].count) / 50) * 100));

                case 'Commentateur':
                    const commentateur = await db.query(
                        'SELECT COUNT(*) FROM COMMENTAIRES WHERE auteur_id = $1 AND statut = \'APPROUVE\'',
                        [userId]
                    );
                    return Math.round(Math.min(100, (parseInt(commentateur.rows[0].count) / 5) * 100));

                case 'Partageur':
                    const partageur = await db.query(
                        'SELECT COUNT(*) FROM PARTAGES_ARTICLES WHERE compte_id = $1',
                        [userId]
                    );
                    return Math.round(Math.min(100, (parseInt(partageur.rows[0].count) / 20) * 100));

                case 'Collectionneur':
                    const collectionneur = await db.query(
                        'SELECT COUNT(*) FROM FAVORIS_ARTICLES WHERE compte_id = $1',
                        [userId]
                    );
                    return Math.round(Math.min(100, (parseInt(collectionneur.rows[0].count) / 30) * 100));

                case 'Expert en quiz':
                    const expert = await db.query(
                        'SELECT COUNT(*) FROM SCORES_UTILISATEUR WHERE compte_id = $1 AND pourcentage = 100',
                        [userId]
                    );
                    return Math.round(Math.min(100, (parseInt(expert.rows[0].count) / 5) * 100));

                default:
                    return 0;
            }
        } catch (error) {
            return 0;
        }
    }
}

module.exports = new BadgeController();