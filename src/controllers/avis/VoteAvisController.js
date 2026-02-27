// src/controllers/avis/VoteAvisController.js
const pool = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const CacheService = require('../../services/cache/CacheService');
const { logInfo, logError } = require('../../configuration/logger');

class VoteAvisController {
    /**
     * Voter pour un avis (utile/pas utile)
     * @route POST /api/v1/avis/:id/voter
     * @access PRIVATE (utilisateur connecté)
     */
    async vote(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { est_utile } = req.body;
            const compte_id = req.user.id;

            // Validation
            if (est_utile === undefined) {
                throw new ValidationError('Le vote (est_utile) est requis');
            }

            if (typeof est_utile !== 'boolean') {
                throw new ValidationError('Le vote doit être un booléen (true/false)');
            }

            // Vérifier que l'avis existe
            const avis = await client.query(
                `SELECT 
                    a.*,
                    c.nom_utilisateur_compte as auteur_nom,
                    c.email as auteur_email
                FROM AVIS a
                LEFT JOIN COMPTES c ON c.id = a.auteur_id
                WHERE a.id = $1`,
                [id]
            );

            if (avis.rows.length === 0) {
                throw new AppError('Avis non trouvé', 404);
            }

            const avisData = avis.rows[0];

            // Empêcher de voter sur son propre avis
            if (avisData.auteur_id === compte_id) {
                throw new ValidationError('Vous ne pouvez pas voter sur votre propre avis');
            }

            // Vérifier que l'avis est publié
            if (avisData.statut !== 'PUBLIE') {
                throw new ValidationError('Vous ne pouvez voter que sur des avis publiés');
            }

            // Vérifier si l'utilisateur a déjà voté
            const voteExistant = await client.query(
                `SELECT * FROM VOTES_AVIS 
                 WHERE avis_id = $1 AND compte_id = $2`,
                [id, compte_id]
            );

            let result;
            let action;

            if (voteExistant.rows.length > 0) {
                const ancienVote = voteExistant.rows[0];

                if (ancienVote.est_utile === est_utile) {
                    // ANNULATION : l'utilisateur clique sur le même vote
                    await client.query(
                        'DELETE FROM VOTES_AVIS WHERE id = $1',
                        [ancienVote.id]
                    );

                    // Mettre à jour les compteurs
                    if (est_utile) {
                        await client.query(
                            `UPDATE AVIS 
                             SET nombre_utile = GREATEST(COALESCE(nombre_utile, 0) - 1, 0)
                             WHERE id = $1`,
                            [id]
                        );
                    } else {
                        await client.query(
                            `UPDATE AVIS 
                             SET nombre_inutile = GREATEST(COALESCE(nombre_inutile, 0) - 1, 0)
                             WHERE id = $1`,
                            [id]
                        );
                    }

                    action = 'removed';
                    result = { vote: null };

                    logInfo(`Vote annulé pour avis ${id} par utilisateur ${compte_id}`);

                } else {
                    // CHANGEMENT : l'utilisateur change son vote
                    await client.query(
                        `UPDATE VOTES_AVIS 
                         SET est_utile = $1, date_vote = NOW()
                         WHERE id = $2`,
                        [est_utile, ancienVote.id]
                    );

                    // Mettre à jour les compteurs
                    if (est_utile) {
                        await client.query(
                            `UPDATE AVIS 
                             SET nombre_utile = COALESCE(nombre_utile, 0) + 1,
                                 nombre_inutile = GREATEST(COALESCE(nombre_inutile, 0) - 1, 0)
                             WHERE id = $1`,
                            [id]
                        );
                    } else {
                        await client.query(
                            `UPDATE AVIS 
                             SET nombre_utile = GREATEST(COALESCE(nombre_utile, 0) - 1, 0),
                                 nombre_inutile = COALESCE(nombre_inutile, 0) + 1
                             WHERE id = $1`,
                            [id]
                        );
                    }

                    action = 'updated';
                    result = { vote: { est_utile } };

                    logInfo(`Vote changé pour avis ${id} par utilisateur ${compte_id}: ${est_utile ? 'utile' : 'inutile'}`);
                }
            } else {
                // NOUVEAU VOTE
                await client.query(
                    `INSERT INTO VOTES_AVIS (avis_id, compte_id, est_utile, date_vote)
                     VALUES ($1, $2, $3, NOW())`,
                    [id, compte_id, est_utile]
                );

                // Mettre à jour les compteurs
                if (est_utile) {
                    await client.query(
                        `UPDATE AVIS 
                         SET nombre_utile = COALESCE(nombre_utile, 0) + 1
                         WHERE id = $1`,
                        [id]
                    );
                } else {
                    await client.query(
                        `UPDATE AVIS 
                         SET nombre_inutile = COALESCE(nombre_inutile, 0) + 1
                         WHERE id = $1`,
                        [id]
                    );
                }

                action = 'added';
                result = { vote: { est_utile } };

                logInfo(`Nouveau vote pour avis ${id} par utilisateur ${compte_id}: ${est_utile ? 'utile' : 'inutile'}`);
            }

            // Récupérer les nouveaux compteurs
            const nouveauxCompteurs = await client.query(
                `SELECT nombre_utile, nombre_inutile 
                 FROM AVIS 
                 WHERE id = $1`,
                [id]
            );

            // Vérifier si l'avis atteint un seuil de votes utiles
            if (nouveauxCompteurs.rows[0].nombre_utile >= 10) {
                await this._checkAvisPopulaire(client, id, avisData);
            }

            // Audit log
            await AuditService.log({
                action: 'VOTE',
                ressource_type: 'AVIS',
                ressource_id: id,
                metadata: {
                    est_utile,
                    action,
                    ancien_vote: voteExistant.rows[0] || null
                },
                utilisateur_id: compte_id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            // Invalidation du cache
            await CacheService.delPattern(`avis:${avisData.entite_type}:${avisData.entite_id}:*`);
            await CacheService.del(`vote:${id}:${compte_id}`);

            res.json({
                status: 'success',
                data: {
                    avis_id: parseInt(id),
                    action,
                    vote: result.vote,
                    compteurs: nouveauxCompteurs.rows[0],
                    message: this._getVoteMessage(action, est_utile)
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur vote avis:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer le vote de l'utilisateur pour un avis
     * @route GET /api/v1/avis/:id/mon-vote
     * @access PRIVATE
     */
    async getMonVote(req, res, next) {
        try {
            const { id } = req.params;
            const compte_id = req.user.id;

            // Vérification cache
            const cacheKey = `vote:${id}:${compte_id}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    status: 'success',
                    data: cached,
                    from_cache: true
                });
            }

            const result = await pool.query(
                `SELECT est_utile, date_vote
                 FROM VOTES_AVIS
                 WHERE avis_id = $1 AND compte_id = $2`,
                [id, compte_id]
            );

            const vote = result.rows[0] || null;

            // Mise en cache (5 minutes)
            if (vote) {
                await CacheService.set(cacheKey, vote, 300);
            }

            res.json({
                status: 'success',
                data: vote
            });

        } catch (error) {
            logError('Erreur récupération vote utilisateur:', error);
            next(error);
        }
    }

    /**
     * Récupérer tous les votes d'un utilisateur
     * @route GET /api/v1/avis/mes-votes
     * @access PRIVATE
     */
    async getMesVotes(req, res, next) {
        try {
            const compte_id = req.user.id;
            const {
                page = 1,
                limit = 20,
                entite_type,
                tri = 'recent'
            } = req.query;

            const offset = (page - 1) * limit;
            const params = [compte_id];
            let paramIndex = 2;
            let conditions = ['v.compte_id = $1'];

            if (entite_type) {
                conditions.push(`a.entite_type = $${paramIndex}`);
                params.push(entite_type);
                paramIndex++;
            }

            // Construction de la requête
            let query = `
                SELECT 
                    v.*,
                    a.id as avis_id,
                    a.note_globale,
                    a.contenu,
                    a.titre,
                    a.entite_type,
                    a.entite_id,
                    a.date_creation as avis_date,
                    CASE a.entite_type
                        WHEN 'BOUTIQUE' THEN (SELECT nom_boutique FROM BOUTIQUES WHERE id = a.entite_id)
                        WHEN 'RESTAURANT_FAST_FOOD' THEN (SELECT nom_restaurant_fast_food FROM RESTAURANTSFASTFOOD WHERE id = a.entite_id)
                        WHEN 'PRODUIT_BOUTIQUE' THEN (SELECT nom_produit FROM PRODUITSBOUTIQUE WHERE id = a.entite_id)
                        WHEN 'COMPAGNIE_TRANSPORT' THEN (SELECT nom_compagnie FROM COMPAGNIESTRANSPORT WHERE id = a.entite_id)
                        ELSE 'Entité inconnue'
                    END as entite_nom,
                    c.nom_utilisateur_compte as auteur_nom
                FROM VOTES_AVIS v
                JOIN AVIS a ON a.id = v.avis_id
                LEFT JOIN COMPTES c ON c.id = a.auteur_id
                WHERE ${conditions.join(' AND ')}
            `;

            // Tri
            switch (tri) {
                case 'recent':
                    query += ' ORDER BY v.date_vote DESC';
                    break;
                case 'ancien':
                    query += ' ORDER BY v.date_vote ASC';
                    break;
                case 'utile':
                    query += ' ORDER BY v.est_utile DESC, v.date_vote DESC';
                    break;
                default:
                    query += ' ORDER BY v.date_vote DESC';
            }

            // Pagination
            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await pool.query(query, params);

            // Statistiques
            const stats = await pool.query(
                `SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE est_utile = true) as votes_utiles,
                    COUNT(*) FILTER (WHERE est_utile = false) as votes_inutiles,
                    COUNT(DISTINCT a.entite_type) as types_entites_votes
                FROM VOTES_AVIS v
                JOIN AVIS a ON a.id = v.avis_id
                WHERE v.compte_id = $1`,
                [compte_id]
            );

            res.json({
                status: 'success',
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(stats.rows[0].total),
                    pages: Math.ceil(parseInt(stats.rows[0].total) / limit)
                },
                statistiques: stats.rows[0]
            });

        } catch (error) {
            logError('Erreur récupération votes utilisateur:', error);
            next(error);
        }
    }

    /**
     * Récupérer tous les votes pour un avis
     * @route GET /api/v1/avis/:id/votes
     * @access PUBLIC
     */
    async getVotesForAvis(req, res, next) {
        try {
            const { id } = req.params;
            const {
                page = 1,
                limit = 20,
                type_vote // 'utile' ou 'inutile'
            } = req.query;

            const offset = (page - 1) * limit;
            const params = [id];
            let paramIndex = 2;
            let conditions = ['avis_id = $1'];

            if (type_vote === 'utile') {
                conditions.push(`est_utile = true`);
            } else if (type_vote === 'inutile') {
                conditions.push(`est_utile = false`);
            }

            const result = await pool.query(
                `SELECT 
                    v.*,
                    c.nom_utilisateur_compte as votant_nom,
                    c.photo_profil_compte as votant_photo,
                    c.niveau_fidelite as votant_niveau
                FROM VOTES_AVIS v
                LEFT JOIN COMPTES c ON c.id = v.compte_id
                WHERE ${conditions.join(' AND ')}
                ORDER BY v.date_vote DESC
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
                [id, parseInt(limit), offset]
            );

            // Total pour pagination
            let countQuery = 'SELECT COUNT(*) FROM VOTES_AVIS WHERE avis_id = $1';
            const countParams = [id];

            if (type_vote === 'utile') {
                countQuery += ' AND est_utile = true';
            } else if (type_vote === 'inutile') {
                countQuery += ' AND est_utile = false';
            }

            const total = await pool.query(countQuery, countParams);

            // Statistiques des votes
            const stats = await pool.query(
                `SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE est_utile = true) as utiles,
                    COUNT(*) FILTER (WHERE est_utile = false) as inutiles,
                    MIN(date_vote) as premier_vote,
                    MAX(date_vote) as dernier_vote
                FROM VOTES_AVIS
                WHERE avis_id = $1`,
                [id]
            );

            res.json({
                status: 'success',
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(total.rows[0].count),
                    pages: Math.ceil(parseInt(total.rows[0].count) / limit)
                },
                statistiques: stats.rows[0]
            });

        } catch (error) {
            logError('Erreur récupération votes:', error);
            next(error);
        }
    }

    /**
     * Récupérer les avis les plus votés
     * @route GET /api/v1/avis/top-votes
     * @access PUBLIC
     */
    async getTopVotedAvis(req, res, next) {
        try {
            const {
                periode = '30j',
                limit = 10,
                entite_type,
                min_votes = 5
            } = req.query;

            let interval;
            switch (periode) {
                case '7j':
                    interval = "INTERVAL '7 days'";
                    break;
                case '30j':
                    interval = "INTERVAL '30 days'";
                    break;
                case '90j':
                    interval = "INTERVAL '90 days'";
                    break;
                default:
                    interval = "INTERVAL '30 days'";
            }

            const params = [min_votes];
            let paramIndex = 2;
            let conditions = ['v.avis_id IS NOT NULL'];

            if (entite_type) {
                conditions.push(`a.entite_type = $${paramIndex}`);
                params.push(entite_type);
                paramIndex++;
            }

            const query = `
                SELECT 
                    a.id,
                    a.note_globale,
                    a.contenu,
                    a.titre,
                    a.entite_type,
                    a.entite_id,
                    a.date_creation,
                    c.nom_utilisateur_compte as auteur_nom,
                    c.photo_profil_compte as auteur_photo,
                    COUNT(v.id) as total_votes,
                    COUNT(v.id) FILTER (WHERE v.est_utile = true) as votes_utiles,
                    COUNT(v.id) FILTER (WHERE v.est_utile = false) as votes_inutiles,
                    ROUND(
                        (COUNT(v.id) FILTER (WHERE v.est_utile = true)::numeric / 
                         NULLIF(COUNT(v.id), 0) * 100
                    ), 2) as taux_utilite,
                    CASE a.entite_type
                        WHEN 'BOUTIQUE' THEN (SELECT nom_boutique FROM BOUTIQUES WHERE id = a.entite_id)
                        WHEN 'RESTAURANT_FAST_FOOD' THEN (SELECT nom_restaurant_fast_food FROM RESTAURANTSFASTFOOD WHERE id = a.entite_id)
                        ELSE 'Entité inconnue'
                    END as entite_nom
                FROM AVIS a
                LEFT JOIN VOTES_AVIS v ON v.avis_id = a.id AND v.date_vote >= NOW() - ${interval}
                LEFT JOIN COMPTES c ON c.id = a.auteur_id
                WHERE a.statut = 'PUBLIE'
                AND a.date_creation >= NOW() - ${interval}
                GROUP BY a.id, a.note_globale, a.contenu, a.titre, 
                         a.entite_type, a.entite_id, a.date_creation,
                         c.nom_utilisateur_compte, c.photo_profil_compte
                HAVING COUNT(v.id) >= $1
                ORDER BY votes_utiles DESC, total_votes DESC
                LIMIT $${paramIndex}
            `;

            params.push(parseInt(limit));

            const result = await pool.query(query, params);

            res.json({
                status: 'success',
                data: result.rows,
                meta: {
                    periode,
                    entite_type: entite_type || 'tous',
                    total: result.rows.length
                }
            });

        } catch (error) {
            logError('Erreur récupération top avis:', error);
            next(error);
        }
    }

    /**
     * Obtenir les statistiques globales des votes
     * @route GET /api/v1/avis/stats/votes
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getVotesStats(req, res, next) {
        try {
            const { periode = '30j' } = req.query;

            const interval = periode === '30j' ? '30 days' : '7 days';

            const stats = await pool.query(`
                WITH votes_par_jour AS (
                    SELECT 
                        DATE(date_vote) as date,
                        COUNT(*) as total_votes,
                        COUNT(*) FILTER (WHERE est_utile = true) as votes_utiles,
                        COUNT(*) FILTER (WHERE est_utile = false) as votes_inutiles
                    FROM VOTES_AVIS
                    WHERE date_vote >= NOW() - $1::interval
                    GROUP BY DATE(date_vote)
                ),
                stats_globales AS (
                    SELECT 
                        COUNT(*) as total_votes,
                        COUNT(DISTINCT compte_id) as votants_uniques,
                        COUNT(DISTINCT avis_id) as avis_votes,
                        ROUND(
                            (COUNT(*) FILTER (WHERE est_utile = true)::numeric / 
                             NULLIF(COUNT(*), 0) * 100
                        ), 2) as taux_utilite,
                        COUNT(*) FILTER (WHERE est_utile = true) as votes_utiles,
                        COUNT(*) FILTER (WHERE est_utile = false) as votes_inutiles,
                        AVG(EXTRACT(EPOCH FROM (date_vote - LAG(date_vote) OVER (ORDER BY date_vote))))/3600 as delai_moyen_entre_votes_heures
                    FROM VOTES_AVIS
                    WHERE date_vote >= NOW() - $1::interval
                ),
                repartition_par_entite AS (
                    SELECT 
                        a.entite_type,
                        COUNT(v.id) as votes,
                        COUNT(DISTINCT v.compte_id) as votants
                    FROM VOTES_AVIS v
                    JOIN AVIS a ON a.id = v.avis_id
                    WHERE v.date_vote >= NOW() - $1::interval
                    GROUP BY a.entite_type
                    ORDER BY votes DESC
                ),
                top_votants AS (
                    SELECT 
                        v.compte_id,
                        c.nom_utilisateur_compte,
                        COUNT(v.id) as total_votes,
                        COUNT(v.id) FILTER (WHERE v.est_utile = true) as votes_utiles
                    FROM VOTES_AVIS v
                    JOIN COMPTES c ON c.id = v.compte_id
                    WHERE v.date_vote >= NOW() - $1::interval
                    GROUP BY v.compte_id, c.nom_utilisateur_compte
                    ORDER BY total_votes DESC
                    LIMIT 5
                )
                SELECT 
                    jsonb_build_object(
                        'evolution', COALESCE(json_agg(vpj ORDER BY vpj.date), '[]'::json),
                        'global', (SELECT row_to_json(sg) FROM stats_globales sg),
                        'par_entite', COALESCE(json_agg(rpe), '[]'::json),
                        'top_votants', COALESCE(json_agg(tv), '[]'::json)
                    ) as stats
                FROM votes_par_jour vpj
                FULL JOIN repartition_par_entite rpe ON true
                FULL JOIN top_votants tv ON true
            `, [interval]);

            // Statistiques complémentaires
            const aujourdhui = await pool.query(`
                SELECT 
                    COUNT(*) as votes_aujourdhui,
                    COUNT(*) FILTER (WHERE est_utile = true) as utiles_aujourdhui
                FROM VOTES_AVIS
                WHERE DATE(date_vote) = CURRENT_DATE
            `);

            res.json({
                status: 'success',
                data: {
                    ...stats.rows[0]?.stats,
                    aujourdhui: aujourdhui.rows[0],
                    periode
                }
            });

        } catch (error) {
            logError('Erreur récupération stats votes:', error);
            next(error);
        }
    }

    /**
     * Exporter les votes (pour admin)
     * @route GET /api/v1/avis/votes/export
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async exportVotes(req, res, next) {
        try {
            const { format = 'csv', date_debut, date_fin } = req.query;

            let dateCondition = '';
            if (date_debut && date_fin) {
                dateCondition = `AND v.date_vote BETWEEN '${date_debut}' AND '${date_fin}'`;
            }

            const votes = await pool.query(`
                SELECT 
                    v.id,
                    v.est_utile,
                    v.date_vote,
                    a.id as avis_id,
                    a.note_globale,
                    a.contenu as avis_contenu,
                    c1.nom_utilisateur_compte as votant,
                    c2.nom_utilisateur_compte as auteur_avis,
                    a.entite_type,
                    a.entite_id
                FROM VOTES_AVIS v
                JOIN AVIS a ON a.id = v.avis_id
                JOIN COMPTES c1 ON c1.id = v.compte_id
                JOIN COMPTES c2 ON c2.id = a.auteur_id
                WHERE 1=1 ${dateCondition}
                ORDER BY v.date_vote DESC
            `);

            let exportedData;
            let contentType;
            let filename = `votes_export_${new Date().toISOString().split('T')[0]}`;

            if (format === 'csv') {
                const csvRows = [];
                // En-têtes
                csvRows.push(['ID', 'Date', 'Vote', 'Avis ID', 'Note', 'Votant', 'Auteur', 'Entité'].join(','));

                // Données
                for (const v of votes.rows) {
                    csvRows.push([
                        v.id,
                        v.date_vote,
                        v.est_utile ? 'UTILE' : 'INUTILE',
                        v.avis_id,
                        v.note_globale,
                        v.votant,
                        v.auteur_avis,
                        `${v.entite_type}:${v.entite_id}`
                    ].join(','));
                }

                exportedData = csvRows.join('\n');
                contentType = 'text/csv';
                filename += '.csv';
            }

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(exportedData);

        } catch (error) {
            logError('Erreur export votes:', error);
            next(error);
        }
    }

    // ==================== MÉTHODES PRIVÉES ====================

    /**
     * Vérifier si un avis devient populaire
     */
    async _checkAvisPopulaire(client, avisId, avisData) {
        // Vérifier si l'avis a déjà le badge "populaire"
        const dejaPopulaire = await client.query(
            `SELECT 1 FROM AVIS 
             WHERE id = $1 AND donnees_supplementaires @> '{"badge": "populaire"}'`,
            [avisId]
        );

        if (dejaPopulaire.rows.length === 0) {
            // Ajouter le badge "populaire"
            await client.query(
                `UPDATE AVIS 
                 SET donnees_supplementaires = donnees_supplementaires || '{"badge": "populaire", "date_populaire": $1}'::jsonb
                 WHERE id = $2`,
                [new Date().toISOString(), avisId]
            );

            // Notifier l'auteur
            if (avisData.auteur_id) {
                await NotificationService.notifyUser(avisData.auteur_id, {
                    type: 'AVIS_POPULAIRE',
                    titre: '⭐ Votre avis est populaire !',
                    message: 'Votre avis a reçu 10 votes utiles',
                    donnees: { avis_id: avisId }
                });
            }
        }
    }

    /**
     * Message personnalisé selon l'action
     */
    _getVoteMessage(action, estUtile) {
        const messages = {
            added: {
                true: 'Vote utile ajouté',
                false: 'Vote inutile ajouté'
            },
            updated: {
                true: 'Vote changé pour utile',
                false: 'Vote changé pour inutile'
            },
            removed: 'Vote retiré'
        };

        if (action === 'removed') {
            return messages.removed;
        }
        return messages[action][estUtile];
    }
}

module.exports = new VoteAvisController();