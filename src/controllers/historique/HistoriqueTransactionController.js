// src/controllers/historique/HistoriqueTransactionController.js
const db = require('../../configuration/database');
const { ValidationError } = require('../../utils/errors/AppError');

class HistoriqueTransactionController {
    /**
     * Récupérer l'historique des transactions
     * @route GET /api/v1/historique/transactions
     */
    async findAll(req, res, next) {
        try {
            const {
                page = 1,
                limit = 50,
                type_transaction,
                statut_transaction,
                compte_source_id,
                compte_destination_id,
                date_debut,
                date_fin,
                montant_min,
                montant_max,
                tri = 'date_desc'
            } = req.query;

            const offset = (page - 1) * limit;

            // Construction de la requête avec partitionnement
            let query = `
                SELECT ht.*,
                       cs.nom_utilisateur_compte as source_nom,
                       cd.nom_utilisateur_compte as destination_nom,
                       COUNT(*) OVER() as total_count
                FROM HISTORIQUE_TRANSACTIONS ht
                LEFT JOIN COMPTES cs ON cs.id = ht.compte_source_id
                LEFT JOIN COMPTES cd ON cd.id = ht.compte_destination_id
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            // Filtres temporels (optimisation partitionnement)
            if (date_debut) {
                query += ` AND ht.date_transaction >= $${paramIndex}`;
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                query += ` AND ht.date_transaction <= $${paramIndex}`;
                params.push(date_fin);
                paramIndex++;
            }

            // Par défaut, 30 derniers jours
            if (!date_debut && !date_fin) {
                query += ` AND ht.date_transaction >= NOW() - INTERVAL '30 days'`;
            }

            if (type_transaction) {
                query += ` AND ht.type_transaction = $${paramIndex}`;
                params.push(type_transaction);
                paramIndex++;
            }

            if (statut_transaction) {
                query += ` AND ht.statut_transaction = $${paramIndex}`;
                params.push(statut_transaction);
                paramIndex++;
            }

            if (compte_source_id) {
                query += ` AND ht.compte_source_id = $${paramIndex}`;
                params.push(compte_source_id);
                paramIndex++;
            }

            if (compte_destination_id) {
                query += ` AND ht.compte_destination_id = $${paramIndex}`;
                params.push(compte_destination_id);
                paramIndex++;
            }

            if (montant_min) {
                query += ` AND ht.montant >= $${paramIndex}`;
                params.push(montant_min);
                paramIndex++;
            }

            if (montant_max) {
                query += ` AND ht.montant <= $${paramIndex}`;
                params.push(montant_max);
                paramIndex++;
            }

            // Tri
            const orderMap = {
                'date_desc': 'ht.date_transaction DESC',
                'date_asc': 'ht.date_transaction ASC',
                'montant_desc': 'ht.montant DESC',
                'montant_asc': 'ht.montant ASC',
                'statut': 'ht.statut_transaction, ht.date_transaction DESC'
            };

            query += ` ORDER BY ${orderMap[tri] || orderMap.date_desc}`;
            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Agrégations financières
            const agregation = await db.query(
                `SELECT 
                    SUM(CASE WHEN statut_transaction = 'COMPLETEE' THEN montant ELSE 0 END) as total_complete,
                    SUM(CASE WHEN statut_transaction = 'EN_ATTENTE' THEN montant ELSE 0 END) as total_en_attente,
                    AVG(CASE WHEN statut_transaction = 'COMPLETEE' THEN montant ELSE NULL END) as montant_moyen,
                    COUNT(DISTINCT compte_source_id) as sources_distinctes,
                    COUNT(DISTINCT compte_destination_id) as destinations_distinctes
                 FROM HISTORIQUE_TRANSACTIONS
                 WHERE date_transaction >= NOW() - INTERVAL '30 days'`
            );

            res.json({
                success: true,
                data: {
                    transactions: result.rows,
                    agregation: agregation.rows[0]
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
     * Récupérer les transactions d'un compte spécifique
     * @route GET /api/v1/historique/transactions/compte/:compteId
     */
    async findByCompte(req, res, next) {
        try {
            const { compteId } = req.params;
            const {
                page = 1,
                limit = 50,
                type_transaction,
                statut_transaction,
                date_debut,
                date_fin,
                sens = 'tous' // 'entrant', 'sortant', 'tous'
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT ht.*,
                       CASE 
                           WHEN ht.compte_source_id = $1 THEN 'SORTANT'
                           WHEN ht.compte_destination_id = $1 THEN 'ENTRANT'
                       END as sens,
                       COUNT(*) OVER() as total_count
                FROM HISTORIQUE_TRANSACTIONS ht
                WHERE 1=1
            `;

            const params = [compteId];
            let paramIndex = 2;

            if (sens === 'entrant') {
                query += ` AND ht.compte_destination_id = $1`;
            } else if (sens === 'sortant') {
                query += ` AND ht.compte_source_id = $1`;
            } else {
                query += ` AND (ht.compte_source_id = $1 OR ht.compte_destination_id = $1)`;
            }

            if (type_transaction) {
                query += ` AND ht.type_transaction = $${paramIndex}`;
                params.push(type_transaction);
                paramIndex++;
            }

            if (statut_transaction) {
                query += ` AND ht.statut_transaction = $${paramIndex}`;
                params.push(statut_transaction);
                paramIndex++;
            }

            if (date_debut) {
                query += ` AND ht.date_transaction >= $${paramIndex}`;
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                query += ` AND ht.date_transaction <= $${paramIndex}`;
                params.push(date_fin);
                paramIndex++;
            }

            query += ` ORDER BY ht.date_transaction DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Calculer les totaux
            const totaux = await db.query(
                `SELECT 
                    SUM(CASE WHEN compte_destination_id = $1 AND statut_transaction = 'COMPLETEE' THEN montant ELSE 0 END) as total_recu,
                    SUM(CASE WHEN compte_source_id = $1 AND statut_transaction = 'COMPLETEE' THEN montant ELSE 0 END) as total_envoye,
                    COUNT(CASE WHEN compte_destination_id = $1 THEN 1 END) as nombre_recu,
                    COUNT(CASE WHEN compte_source_id = $1 THEN 1 END) as nombre_envoye
                 FROM HISTORIQUE_TRANSACTIONS
                 WHERE (compte_source_id = $1 OR compte_destination_id = $1)
                   AND date_transaction >= NOW() - INTERVAL '30 days'`,
                [compteId]
            );

            res.json({
                success: true,
                data: {
                    transactions: result.rows,
                    totaux: totaux.rows[0]
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
     * Récupérer une transaction par son UUID
     * @route GET /api/v1/historique/transactions/uuid/:uuid
     */
    async findByUUID(req, res, next) {
        try {
            const { uuid } = req.params;

            const result = await db.query(
                `SELECT ht.*,
                       cs.nom_utilisateur_compte as source_nom,
                       cs.email as source_email,
                       cd.nom_utilisateur_compte as destination_nom,
                       cd.email as destination_email,
                       CASE 
                           WHEN ht.commande_rff_id IS NOT NULL THEN 
                               (SELECT reference_commande FROM COMMANDESEMPLACEMENTFASTFOOD WHERE id = ht.commande_rff_id)
                           WHEN ht.commande_boutique_id IS NOT NULL THEN 
                               (SELECT reference_commande FROM COMMANDESBOUTIQUES WHERE id = ht.commande_boutique_id)
                           ELSE NULL
                       END as reference_commande
                FROM HISTORIQUE_TRANSACTIONS ht
                LEFT JOIN COMPTES cs ON cs.id = ht.compte_source_id
                LEFT JOIN COMPTES cd ON cd.id = ht.compte_destination_id
                WHERE ht.transaction_uuid = $1`,
                [uuid]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Transaction non trouvée'
                });
            }

            res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Statistiques des transactions
     * @route GET /api/v1/historique/transactions/stats
     */
    async getStats(req, res, next) {
        try {
            const { periode = '30d', group_by = 'jour' } = req.query;

            let interval;
            switch (periode) {
                case '24h': interval = "INTERVAL '24 hours'"; break;
                case '7d': interval = "INTERVAL '7 days'"; break;
                case '30d': interval = "INTERVAL '30 days'"; break;
                case '1y': interval = "INTERVAL '1 year'"; break;
                default: interval = "INTERVAL '30 days'";
            }

            let groupFormat;
            if (group_by === 'heure') {
                groupFormat = "DATE_TRUNC('hour', date_transaction)";
            } else if (group_by === 'jour') {
                groupFormat = "DATE(date_transaction)";
            } else if (group_by === 'semaine') {
                groupFormat = "DATE_TRUNC('week', date_transaction)";
            } else if (group_by === 'mois') {
                groupFormat = "DATE_TRUNC('month', date_transaction)";
            }

            // Évolution des transactions
            const evolution = await db.query(
                `SELECT 
                    ${groupFormat} as periode,
                    COUNT(*) as nombre_transactions,
                    SUM(montant) as volume_total,
                    AVG(montant) as montant_moyen,
                    COUNT(DISTINCT compte_source_id) as sources_uniques,
                    COUNT(DISTINCT compte_destination_id) as destinations_uniques
                 FROM HISTORIQUE_TRANSACTIONS
                 WHERE date_transaction >= NOW() - ${interval}
                 GROUP BY periode
                 ORDER BY periode ASC`
            );

            // Répartition par type
            const parType = await db.query(
                `SELECT 
                    type_transaction,
                    COUNT(*) as nombre,
                    SUM(montant) as volume,
                    ROUND(AVG(montant)::numeric, 2) as montant_moyen
                 FROM HISTORIQUE_TRANSACTIONS
                 WHERE date_transaction >= NOW() - ${interval}
                 GROUP BY type_transaction
                 ORDER BY volume DESC`
            );

            // Répartition par statut
            const parStatut = await db.query(
                `SELECT 
                    statut_transaction,
                    COUNT(*) as nombre,
                    SUM(montant) as volume
                 FROM HISTORIQUE_TRANSACTIONS
                 WHERE date_transaction >= NOW() - ${interval}
                 GROUP BY statut_transaction`
            );

            // Top sources
            const topSources = await db.query(
                `SELECT 
                    ht.compte_source_id,
                    c.nom_utilisateur_compte,
                    COUNT(*) as transactions,
                    SUM(ht.montant) as total_envoye
                 FROM HISTORIQUE_TRANSACTIONS ht
                 JOIN COMPTES c ON c.id = ht.compte_source_id
                 WHERE ht.date_transaction >= NOW() - ${interval}
                 GROUP BY ht.compte_source_id, c.nom_utilisateur_compte
                 ORDER BY total_envoye DESC
                 LIMIT 10`
            );

            // Top destinations
            const topDestinations = await db.query(
                `SELECT 
                    ht.compte_destination_id,
                    c.nom_utilisateur_compte,
                    COUNT(*) as transactions,
                    SUM(ht.montant) as total_recu
                 FROM HISTORIQUE_TRANSACTIONS ht
                 JOIN COMPTES c ON c.id = ht.compte_destination_id
                 WHERE ht.date_transaction >= NOW() - ${interval}
                 GROUP BY ht.compte_destination_id, c.nom_utilisateur_compte
                 ORDER BY total_recu DESC
                 LIMIT 10`
            );

            // Indicateurs globaux
            const globaux = await db.query(
                `SELECT 
                    COUNT(*) as total_transactions,
                    SUM(montant) as volume_total,
                    AVG(montant) as montant_moyen,
                    MAX(montant) as montant_max,
                    MIN(montant) as montant_min,
                    COUNT(DISTINCT compte_source_id) as comptes_source,
                    COUNT(DISTINCT compte_destination_id) as comptes_destination
                 FROM HISTORIQUE_TRANSACTIONS
                 WHERE date_transaction >= NOW() - ${interval}`
            );

            res.json({
                success: true,
                data: {
                    globaux: globaux.rows[0],
                    evolution: evolution.rows,
                    par_type: parType.rows,
                    par_statut: parStatut.rows,
                    top_sources: topSources.rows,
                    top_destinations: topDestinations.rows,
                    periode
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Créer une nouvelle transaction (utilisation interne)
     * @route POST /api/v1/historique/transactions (admin seulement)
     */
    async create(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const {
                type_transaction,
                montant,
                devise = 'XOF',
                compte_source_id,
                compte_destination_id,
                compagnie_id,
                emplacement_id,
                restaurant_id,
                boutique_id,
                plateforme_id,
                commande_rff_id,
                commande_boutique_id,
                description,
                metadata = {}
            } = req.body;

            // Validation
            if (!type_transaction || !montant || montant <= 0) {
                throw new ValidationError('Type et montant valide requis');
            }

            // Générer un UUID unique
            const transaction_uuid = require('crypto').randomBytes(16).toString('hex');

            const result = await client.query(
                `INSERT INTO HISTORIQUE_TRANSACTIONS (
                    type_transaction, montant, devise, transaction_uuid,
                    compte_source_id, compte_destination_id, compagnie_id,
                    emplacement_id, restaurant_id, boutique_id, plateforme_id,
                    commande_rff_id, commande_boutique_id, description, metadata,
                    statut_transaction, date_validation
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'COMPLETEE', NOW())
                RETURNING *`,
                [
                    type_transaction, montant, devise, transaction_uuid,
                    compte_source_id, compte_destination_id, compagnie_id,
                    emplacement_id, restaurant_id, boutique_id, plateforme_id,
                    commande_rff_id, commande_boutique_id, description, JSON.stringify(metadata)
                ]
            );

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message: 'Transaction enregistrée'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour le statut d'une transaction
     * @route PATCH /api/v1/historique/transactions/:id/statut
     */
    async updateStatut(req, res, next) {
        try {
            const { id } = req.params;
            const { statut_transaction, description } = req.body;

            const result = await db.query(
                `UPDATE HISTORIQUE_TRANSACTIONS 
                 SET statut_transaction = $1,
                     description = COALESCE(description || E'\n' || $2, description, $2),
                     date_validation = CASE WHEN $1 = 'COMPLETEE' THEN NOW() ELSE date_validation END
                 WHERE id = $3
                 RETURNING *`,
                [statut_transaction, description, id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Transaction non trouvée'
                });
            }

            res.json({
                success: true,
                data: result.rows[0],
                message: `Statut mis à jour : ${statut_transaction}`
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer le journal des transactions par entité
     * @route GET /api/v1/historique/transactions/entite/:type/:id
     */
    async findByEntity(req, res, next) {
        try {
            const { type, id } = req.params;
            const { page = 1, limit = 50 } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT ht.*,
                       cs.nom_utilisateur_compte as source_nom,
                       cd.nom_utilisateur_compte as destination_nom,
                       COUNT(*) OVER() as total_count
                FROM HISTORIQUE_TRANSACTIONS ht
                LEFT JOIN COMPTES cs ON cs.id = ht.compte_source_id
                LEFT JOIN COMPTES cd ON cd.id = ht.compte_destination_id
                WHERE 
            `;

            switch (type) {
                case 'compagnie':
                    query += ` ht.compagnie_id = $1`;
                    break;
                case 'restaurant':
                    query += ` ht.restaurant_id = $1`;
                    break;
                case 'boutique':
                    query += ` ht.boutique_id = $1`;
                    break;
                case 'plateforme':
                    query += ` ht.plateforme_id = $1`;
                    break;
                default:
                    throw new ValidationError('Type d\'entité invalide');
            }

            query += ` ORDER BY ht.date_transaction DESC LIMIT $2 OFFSET $3`;

            const result = await db.query(query, [id, parseInt(limit), offset]);
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
}

module.exports = new HistoriqueTransactionController();