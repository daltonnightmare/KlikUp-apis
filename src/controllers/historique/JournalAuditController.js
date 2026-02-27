// src/controllers/historique/JournalAuditController.js
const db = require('../../configuration/database');
const { ValidationError } = require('../../utils/errors/AppError');

class JournalAuditController {
    /**
     * Récupérer les entrées du journal d'audit
     * @route GET /api/v1/historique/audit
     */
    async findAll(req, res, next) {
        try {
            const {
                page = 1,
                limit = 50,
                action,
                ressource_type,
                compte_id,
                succes,
                date_debut,
                date_fin,
                severite,
                tri = 'date_desc'
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT ja.*,
                       c.nom_utilisateur_compte,
                       c.email,
                       COUNT(*) OVER() as total_count
                FROM JOURNAL_AUDIT ja
                LEFT JOIN COMPTES c ON c.id = ja.compte_id
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            // Filtres temporels (optimisation partitionnement)
            if (date_debut) {
                query += ` AND ja.date_action >= $${paramIndex}`;
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                query += ` AND ja.date_action <= $${paramIndex}`;
                params.push(date_fin);
                paramIndex++;
            }

            if (!date_debut && !date_fin) {
                query += ` AND ja.date_action >= NOW() - INTERVAL '7 days'`;
            }

            if (action) {
                query += ` AND ja.action = $${paramIndex}`;
                params.push(action);
                paramIndex++;
            }

            if (ressource_type) {
                query += ` AND ja.ressource_type = $${paramIndex}`;
                params.push(ressource_type);
                paramIndex++;
            }

            if (compte_id) {
                query += ` AND ja.compte_id = $${paramIndex}`;
                params.push(compte_id);
                paramIndex++;
            }

            if (succes !== undefined) {
                query += ` AND ja.succes = $${paramIndex}`;
                params.push(succes === 'true');
                paramIndex++;
            }

            if (severite) {
                // Filtre basé sur le code_erreur ou metadata
                query += ` AND (ja.code_erreur = $${paramIndex} OR ja.metadata->>'severite' = $${paramIndex})`;
                params.push(severite);
                paramIndex++;
            }

            // Tri
            const orderMap = {
                'date_desc': 'ja.date_action DESC',
                'date_asc': 'ja.date_action ASC',
                'duree_desc': 'ja.duree_ms DESC NULLS LAST',
                'duree_asc': 'ja.duree_ms ASC NULLS LAST'
            };

            query += ` ORDER BY ${orderMap[tri] || orderMap.date_desc}`;
            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Statistiques d'audit
            const stats = await db.query(
                `SELECT 
                    COUNT(*) as total_entrees,
                    COUNT(*) FILTER (WHERE succes = false) as erreurs,
                    COUNT(DISTINCT compte_id) as utilisateurs_distincts,
                    COUNT(DISTINCT ressource_type) as ressources_distinctes,
                    AVG(duree_ms) FILTER (WHERE duree_ms IS NOT NULL) as duree_moyenne_ms,
                    MAX(duree_ms) as duree_max_ms
                 FROM JOURNAL_AUDIT
                 WHERE date_action >= NOW() - INTERVAL '7 days'`
            );

            res.json({
                success: true,
                data: {
                    entrees: result.rows,
                    statistiques: stats.rows[0]
                },
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
     * Récupérer les détails d'une entrée d'audit
     * @route GET /api/v1/historique/audit/:id
     */
    async findOne(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT ja.*,
                       c.nom_utilisateur_compte,
                       c.email,
                       c.photo_profil_compte
                FROM JOURNAL_AUDIT ja
                LEFT JOIN COMPTES c ON c.id = ja.compte_id
                WHERE ja.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Entrée d\'audit non trouvée'
                });
            }

            // Analyser les changements si UPDATE
            const entree = result.rows[0];
            if (entree.action === 'UPDATE' && entree.donnees_avant && entree.donnees_apres) {
                entree.changements = this.analyserChangements(
                    entree.donnees_avant,
                    entree.donnees_apres,
                    entree.champs_modifies
                );
            }

            res.json({
                success: true,
                data: entree
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les erreurs fréquentes
     * @route GET /api/v1/historique/audit/erreurs
     */
    async getErreurs(req, res, next) {
        try {
            const { periode = '7d', limit = 20 } = req.query;

            let interval;
            switch (periode) {
                case '24h': interval = "INTERVAL '24 hours'"; break;
                case '7d': interval = "INTERVAL '7 days'"; break;
                case '30d': interval = "INTERVAL '30 days'"; break;
                default: interval = "INTERVAL '7 days'";
            }

            const erreurs = await db.query(
                `SELECT 
                    code_erreur,
                    COUNT(*) as occurrences,
                    COUNT(DISTINCT compte_id) as utilisateurs_concernes,
                    MIN(date_action) as premiere_erreur,
                    MAX(date_action) as derniere_erreur,
                    mode() WITHIN GROUP (ORDER BY message_erreur) as message_type
                 FROM JOURNAL_AUDIT
                 WHERE succes = false
                   AND date_action >= NOW() - ${interval}
                 GROUP BY code_erreur
                 ORDER BY occurrences DESC
                 LIMIT $1`,
                [parseInt(limit)]
            );

            // Évolution des erreurs dans le temps
            const evolution = await db.query(
                `SELECT 
                    DATE(date_action) as date,
                    COUNT(*) as nombre_erreurs,
                    COUNT(DISTINCT code_erreur) as types_erreurs
                 FROM JOURNAL_AUDIT
                 WHERE succes = false
                   AND date_action >= NOW() - ${interval}
                 GROUP BY DATE(date_action)
                 ORDER BY date ASC`
            );

            res.json({
                success: true,
                data: {
                    erreurs: erreurs.rows,
                    evolution: evolution.rows,
                    periode
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer l'activité par utilisateur
     * @route GET /api/v1/historique/audit/activite-utilisateurs
     */
    async getActiviteUtilisateurs(req, res, next) {
        try {
            const { periode = '7d', limit = 20 } = req.query;

            let interval;
            switch (periode) {
                case '24h': interval = "INTERVAL '24 hours'"; break;
                case '7d': interval = "INTERVAL '7 days'"; break;
                case '30d': interval = "INTERVAL '30 days'"; break;
                default: interval = "INTERVAL '7 days'";
            }

            const activite = await db.query(
                `SELECT 
                    ja.compte_id,
                    c.nom_utilisateur_compte,
                    c.email,
                    COUNT(*) as total_actions,
                    COUNT(*) FILTER (WHERE ja.succes = false) as erreurs,
                    COUNT(DISTINCT ja.ressource_type) as ressources_accedees,
                    MIN(ja.date_action) as premiere_action,
                    MAX(ja.date_action) as derniere_action,
                    ROUND(AVG(ja.duree_ms)::numeric, 2) as duree_moyenne_ms
                 FROM JOURNAL_AUDIT ja
                 LEFT JOIN COMPTES c ON c.id = ja.compte_id
                 WHERE ja.date_action >= NOW() - ${interval}
                   AND ja.compte_id IS NOT NULL
                 GROUP BY ja.compte_id, c.nom_utilisateur_compte, c.email
                 ORDER BY total_actions DESC
                 LIMIT $1`,
                [parseInt(limit)]
            );

            res.json({
                success: true,
                data: activite.rows
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les accès sensibles
     * @route GET /api/v1/historique/audit/acces-sensibles
     */
    async getAccesSensibles(req, res, next) {
        try {
            const { periode = '7d' } = req.query;

            let interval;
            switch (periode) {
                case '24h': interval = "INTERVAL '24 hours'"; break;
                case '7d': interval = "INTERVAL '7 days'"; break;
                case '30d': interval = "INTERVAL '30 days'"; break;
                default: interval = "INTERVAL '7 days'";
            }

            // Ressources considérées comme sensibles
            const ressourcesSensibles = [
                'COMPTES', 'DOCUMENTS', 'CONFIGURATIONS', 
                'TOKENS', 'SESSIONS', 'PORTEFEUILLES'
            ];

            const acces = await db.query(
                `SELECT 
                    ja.*,
                    c.nom_utilisateur_compte,
                    c.email,
                    c.compte_role
                 FROM JOURNAL_AUDIT ja
                 LEFT JOIN COMPTES c ON c.id = ja.compte_id
                 WHERE ja.ressource_type = ANY($1::text[])
                   AND ja.date_action >= NOW() - ${interval}
                 ORDER BY ja.date_action DESC
                 LIMIT 100`,
                [ressourcesSensibles]
            );

            // Statistiques par ressource
            const stats = await db.query(
                `SELECT 
                    ressource_type,
                    COUNT(*) as nombre_acces,
                    COUNT(DISTINCT compte_id) as utilisateurs_distincts
                 FROM JOURNAL_AUDIT
                 WHERE ressource_type = ANY($1::text[])
                   AND date_action >= NOW() - ${interval}
                 GROUP BY ressource_type
                 ORDER BY nombre_acces DESC`,
                [ressourcesSensibles]
            );

            res.json({
                success: true,
                data: {
                    acces: acces.rows,
                    statistiques: stats.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Analyser les performances (temps de réponse)
     * @route GET /api/v1/historique/audit/performances
     */
    async getPerformances(req, res, next) {
        try {
            const { periode = '7d', ressource_type } = req.query;

            let interval;
            switch (periode) {
                case '24h': interval = "INTERVAL '24 hours'"; break;
                case '7d': interval = "INTERVAL '7 days'"; break;
                case '30d': interval = "INTERVAL '30 days'"; break;
                default: interval = "INTERVAL '7 days'";
            }

            let query = `
                SELECT 
                    ressource_type,
                    action,
                    COUNT(*) as nombre_appels,
                    ROUND(AVG(duree_ms)::numeric, 2) as duree_moyenne,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duree_ms) as mediane,
                    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duree_ms) as p95,
                    MAX(duree_ms) as duree_max,
                    MIN(duree_ms) as duree_min
                FROM JOURNAL_AUDIT
                WHERE date_action >= NOW() - ${interval}
                  AND duree_ms IS NOT NULL
            `;

            const params = [];

            if (ressource_type) {
                query += ` AND ressource_type = $1`;
                params.push(ressource_type);
            }

            query += ` GROUP BY ressource_type, action
                       ORDER BY duree_moyenne DESC`;

            const result = await db.query(query, params);

            // Distribution des temps de réponse
            const distribution = await db.query(
                `SELECT 
                    CASE 
                        WHEN duree_ms < 100 THEN '< 100ms'
                        WHEN duree_ms < 300 THEN '100-300ms'
                        WHEN duree_ms < 500 THEN '300-500ms'
                        WHEN duree_ms < 1000 THEN '500ms-1s'
                        WHEN duree_ms < 3000 THEN '1-3s'
                        ELSE '> 3s'
                    END as intervalle,
                    COUNT(*) as nombre
                 FROM JOURNAL_AUDIT
                 WHERE date_action >= NOW() - ${interval}
                   AND duree_ms IS NOT NULL
                 GROUP BY intervalle
                 ORDER BY 
                    CASE intervalle
                        WHEN '< 100ms' THEN 1
                        WHEN '100-300ms' THEN 2
                        WHEN '300-500ms' THEN 3
                        WHEN '500ms-1s' THEN 4
                        WHEN '1-3s' THEN 5
                        ELSE 6
                    END`
            );

            res.json({
                success: true,
                data: {
                    performances: result.rows,
                    distribution: distribution.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }

    // ==================== Méthodes privées ====================

    /**
     * Analyser les changements entre deux états
     */
    analyserChangements(avant, apres, champsModifies) {
        if (!avant || !apres) return [];

        const changements = [];

        for (const champ of champsModifies || []) {
            const valeurAvant = avant[champ];
            const valeurApres = apres[champ];

            // Déterminer le type de changement
            let typeChangement = 'modification';
            if (valeurAvant === null || valeurAvant === undefined) typeChangement = 'création';
            if (valeurApres === null || valeurApres === undefined) typeChangement = 'suppression';

            // Pour les nombres, calculer la différence
            let difference = null;
            if (typeof valeurAvant === 'number' && typeof valeurApres === 'number') {
                difference = valeurApres - valeurAvant;
            }

            changements.push({
                champ,
                avant: valeurAvant,
                apres: valeurApres,
                type: typeChangement,
                difference
            });
        }

        return changements;
    }
}

module.exports = new JournalAuditController();