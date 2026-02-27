// src/controllers/historique/HistoriqueActionController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

class HistoriqueActionController {
    /**
     * Récupérer l'historique des actions avec filtres
     * @route GET /api/v1/historique/actions
     */
    async findAll(req, res, next) {
        try {
            const {
                page = 1,
                limit = 50,
                action_type,
                table_concernee,
                utilisateur_id,
                entite_id,
                date_debut,
                date_fin,
                tri = 'date_desc'
            } = req.query;

            const offset = (page - 1) * limit;

            // Construction de la requête avec partitionnement
            let query = `
                SELECT ha.*,
                       c.nom_utilisateur_compte as utilisateur_nom,
                       c.photo_profil_compte as utilisateur_photo,
                       COUNT(*) OVER() as total_count
                FROM HISTORIQUE_ACTIONS ha
                LEFT JOIN COMPTES c ON c.id = ha.utilisateur_id
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            // Filtres temporels pour optimiser le partitionnement
            if (date_debut) {
                query += ` AND ha.date_action >= $${paramIndex}`;
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                query += ` AND ha.date_action <= $${paramIndex}`;
                params.push(date_fin);
                paramIndex++;
            }

            // Si pas de dates spécifiées, dernier mois par défaut
            if (!date_debut && !date_fin) {
                query += ` AND ha.date_action >= NOW() - INTERVAL '30 days'`;
            }

            if (action_type) {
                query += ` AND ha.action_type = $${paramIndex}`;
                params.push(action_type);
                paramIndex++;
            }

            if (table_concernee) {
                query += ` AND ha.table_concernee = $${paramIndex}`;
                params.push(table_concernee);
                paramIndex++;
            }

            if (utilisateur_id) {
                query += ` AND ha.utilisateur_id = $${paramIndex}`;
                params.push(utilisateur_id);
                paramIndex++;
            }

            if (entite_id) {
                query += ` AND ha.entite_id = $${paramIndex}`;
                params.push(entite_id);
                paramIndex++;
            }

            // Tri
            const orderMap = {
                'date_desc': 'ha.date_action DESC',
                'date_asc': 'ha.date_action ASC',
                'utilisateur': 'ha.utilisateur_id NULLS LAST, ha.date_action DESC',
                'table': 'ha.table_concernee, ha.date_action DESC'
            };

            query += ` ORDER BY ${orderMap[tri] || orderMap.date_desc}`;
            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Agrégation par type d'action
            const agregation = await db.query(
                `SELECT 
                    action_type,
                    COUNT(*) as nombre,
                    MIN(date_action) as premier,
                    MAX(date_action) as dernier
                 FROM HISTORIQUE_ACTIONS
                 WHERE date_action >= NOW() - INTERVAL '30 days'
                 GROUP BY action_type
                 ORDER BY nombre DESC`
            );

            res.json({
                success: true,
                data: {
                    actions: result.rows,
                    agregation: agregation.rows
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
     * Récupérer les détails d'une action spécifique
     * @route GET /api/v1/historique/actions/:id
     */
    async findOne(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT ha.*,
                        c.nom_utilisateur_compte as utilisateur_nom,
                        c.photo_profil_compte as utilisateur_photo,
                        c.email as utilisateur_email
                 FROM HISTORIQUE_ACTIONS ha
                 LEFT JOIN COMPTES c ON c.id = ha.utilisateur_id
                 WHERE ha.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Action non trouvée dans l\'historique');
            }

            // Si c'est un UPDATE, comparer les données avant/après
            const action = result.rows[0];
            if (action.action_type === 'UPDATE' && action.donnees_avant && action.donnees_apres) {
                action.changements = this.comparerChangements(
                    action.donnees_avant,
                    action.donnees_apres
                );
            }

            res.json({
                success: true,
                data: action
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer l'historique d'une entité spécifique
     * @route GET /api/v1/historique/entite/:table/:id
     */
    async getEntityHistory(req, res, next) {
        try {
            const { table, id } = req.params;
            const { page = 1, limit = 50 } = req.query;

            const offset = (page - 1) * limit;

            const result = await db.query(
                `SELECT ha.*,
                        c.nom_utilisateur_compte as utilisateur_nom,
                        c.photo_profil_compte as utilisateur_photo,
                        COUNT(*) OVER() as total_count
                 FROM HISTORIQUE_ACTIONS ha
                 LEFT JOIN COMPTES c ON c.id = ha.utilisateur_id
                 WHERE ha.table_concernee = $1 AND ha.entite_id = $2
                 ORDER BY ha.date_action DESC
                 LIMIT $3 OFFSET $4`,
                [table, id, parseInt(limit), offset]
            );

            // Timeline des changements
            const timeline = result.rows.map((action, index, array) => {
                const previous = array[index + 1];
                if (previous && action.action_type === 'UPDATE') {
                    action.delta = this.calculerDelta(previous.donnees_apres, action.donnees_apres);
                }
                return action;
            });

            const total = result.rows[0]?.total_count || 0;

            res.json({
                success: true,
                data: timeline,
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
     * Récupérer l'historique d'un utilisateur
     * @route GET /api/v1/historique/utilisateur/:userId
     */
    async getUserHistory(req, res, next) {
        try {
            const { userId } = req.params;
            const { page = 1, limit = 50, date_debut, date_fin } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT ha.*,
                        COUNT(*) OVER() as total_count
                 FROM HISTORIQUE_ACTIONS ha
                 WHERE ha.utilisateur_id = $1
            `;

            const params = [userId];
            let paramIndex = 2;

            if (date_debut) {
                query += ` AND ha.date_action >= $${paramIndex}`;
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                query += ` AND ha.date_action <= $${paramIndex}`;
                params.push(date_fin);
                paramIndex++;
            }

            query += ` ORDER BY ha.date_action DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Statistiques par type d'action
            const stats = await db.query(
                `SELECT 
                    action_type,
                    COUNT(*) as nombre,
                    COUNT(DISTINCT table_concernee) as tables_distinctes
                 FROM HISTORIQUE_ACTIONS
                 WHERE utilisateur_id = $1
                 GROUP BY action_type`,
                [userId]
            );

            res.json({
                success: true,
                data: {
                    actions: result.rows,
                    statistiques: stats.rows
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
     * Statistiques globales de l'historique
     * @route GET /api/v1/historique/stats
     */
    async getStats(req, res, next) {
        try {
            const { periode = '30d' } = req.query;

            let interval;
            switch (periode) {
                case '24h': interval = "INTERVAL '24 hours'"; break;
                case '7d': interval = "INTERVAL '7 days'"; break;
                case '30d': interval = "INTERVAL '30 days'"; break;
                case '1y': interval = "INTERVAL '1 year'"; break;
                default: interval = "INTERVAL '30 days'";
            }

            const stats = await db.query(
                `SELECT 
                    COUNT(*) as total_actions,
                    COUNT(DISTINCT utilisateur_id) as utilisateurs_actifs,
                    COUNT(DISTINCT table_concernee) as tables_modifiees,
                    AVG(EXTRACT(EPOCH FROM (NOW() - date_action)) / 3600)::int as age_moyen_heures,
                    MIN(date_action) as plus_ancienne_action,
                    MAX(date_action) as plus_recente_action
                 FROM HISTORIQUE_ACTIONS
                 WHERE date_action >= NOW() - ${interval}`
            );

            // Répartition par type d'action
            const parType = await db.query(
                `SELECT 
                    action_type,
                    COUNT(*) as nombre,
                    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as pourcentage
                 FROM HISTORIQUE_ACTIONS
                 WHERE date_action >= NOW() - ${interval}
                 GROUP BY action_type
                 ORDER BY nombre DESC`
            );

            // Répartition par table
            const parTable = await db.query(
                `SELECT 
                    table_concernee,
                    COUNT(*) as nombre,
                    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as pourcentage
                 FROM HISTORIQUE_ACTIONS
                 WHERE date_action >= NOW() - ${interval}
                 GROUP BY table_concernee
                 ORDER BY nombre DESC
                 LIMIT 10`
            );

            // Activité horaire
            const activiteHoraire = await db.query(
                `SELECT 
                    EXTRACT(HOUR FROM date_action) as heure,
                    COUNT(*) as nombre
                 FROM HISTORIQUE_ACTIONS
                 WHERE date_action >= NOW() - ${interval}
                 GROUP BY EXTRACT(HOUR FROM date_action)
                 ORDER BY heure`
            );

            // Évolution quotidienne
            const evolution = await db.query(
                `SELECT 
                    DATE(date_action) as date,
                    COUNT(*) as nombre,
                    COUNT(DISTINCT utilisateur_id) as utilisateurs
                 FROM HISTORIQUE_ACTIONS
                 WHERE date_action >= NOW() - ${interval}
                 GROUP BY DATE(date_action)
                 ORDER BY date ASC`
            );

            res.json({
                success: true,
                data: {
                    global: stats.rows[0],
                    repartition_types: parType.rows,
                    top_tables: parTable.rows,
                    activite_horaire: activiteHoraire.rows,
                    evolution: evolution.rows,
                    periode
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Exporter l'historique en CSV/Excel
     * @route GET /api/v1/historique/export
     */
    async export(req, res, next) {
        try {
            const {
                format = 'csv',
                date_debut,
                date_fin,
                action_type,
                table_concernee
            } = req.query;

            // Construire la requête pour récupérer les données
            let query = `
                SELECT 
                    ha.id,
                    ha.date_action,
                    ha.action_type,
                    ha.table_concernee,
                    ha.entite_id,
                    COALESCE(c.nom_utilisateur_compte, 'Système') as utilisateur,
                    ha.ip_adresse,
                    ha.donnees_avant,
                    ha.donnees_apres
                FROM HISTORIQUE_ACTIONS ha
                LEFT JOIN COMPTES c ON c.id = ha.utilisateur_id
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            if (date_debut) {
                query += ` AND ha.date_action >= $${paramIndex}`;
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                query += ` AND ha.date_action <= $${paramIndex}`;
                params.push(date_fin);
                paramIndex++;
            }

            if (action_type) {
                query += ` AND ha.action_type = $${paramIndex}`;
                params.push(action_type);
                paramIndex++;
            }

            if (table_concernee) {
                query += ` AND ha.table_concernee = $${paramIndex}`;
                params.push(table_concernee);
                paramIndex++;
            }

            query += ` ORDER BY ha.date_action DESC LIMIT 10000`; // Limite de sécurité

            const result = await db.query(query, params);

            if (format === 'excel') {
                await this.exportToExcel(result.rows, res);
            } else {
                await this.exportToCSV(result.rows, res);
            }

        } catch (error) {
            next(error);
        }
    }

    /**
     * Nettoyer l'historique selon les politiques de rétention
     * @route DELETE /api/v1/historique/nettoyer
     */
    async nettoyer(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');

            // Récupérer les politiques de rétention actives
            const politiques = await client.query(
                `SELECT * FROM POLITIQUES_RETENTION 
                 WHERE table_cible = 'HISTORIQUE_ACTIONS' AND est_active = true`
            );

            if (politiques.rows.length === 0) {
                throw new ValidationError('Aucune politique de rétention configurée');
            }

            const politique = politiques.rows[0];
            const dateLimite = new Date();
            dateLimite.setDate(dateLimite.getDate() - politique.duree_retention_jours);

            let deletedCount = 0;

            if (politique.action_expiration === 'SUPPRIMER') {
                const result = await client.query(
                    `DELETE FROM HISTORIQUE_ACTIONS 
                     WHERE date_action < $1
                     RETURNING id`,
                    [dateLimite]
                );
                deletedCount = result.rowCount;
            } else if (politique.action_expiration === 'ARCHIVER') {
                // Créer une table d'archive ou exporter
                await client.query(
                    `INSERT INTO HISTORIQUE_ACTIONS_ARCHIVE 
                     SELECT * FROM HISTORIQUE_ACTIONS 
                     WHERE date_action < $1`,
                    [dateLimite]
                );
                
                const result = await client.query(
                    `DELETE FROM HISTORIQUE_ACTIONS 
                     WHERE date_action < $1
                     RETURNING id`,
                    [dateLimite]
                );
                deletedCount = result.rowCount;
            }

            // Mettre à jour la dernière exécution
            await client.query(
                `UPDATE POLITIQUES_RETENTION 
                 SET derniere_execution = NOW()
                 WHERE id = $1`,
                [politique.id]
            );

            await client.query('COMMIT');

            res.json({
                success: true,
                message: `Nettoyage effectué : ${deletedCount} entrées ${politique.action_expiration === 'SUPPRIMER' ? 'supprimées' : 'archivées'}`,
                data: {
                    deleted_count: deletedCount,
                    date_limite: dateLimite,
                    politique_appliquee: politique
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ==================== Méthodes privées ====================

    /**
     * Comparer deux états pour lister les changements
     */
    comparerChangements(avant, apres) {
        const changements = [];
        
        for (const [key, valeurApres] of Object.entries(apres)) {
            const valeurAvant = avant[key];
            
            if (JSON.stringify(valeurAvant) !== JSON.stringify(valeurApres)) {
                changements.push({
                    champ: key,
                    avant: valeurAvant,
                    apres: valeurApres,
                    type: this.determinerTypeChangement(valeurAvant, valeurApres)
                });
            }
        }
        
        return changements;
    }

    /**
     * Déterminer le type de changement
     */
    determinerTypeChangement(avant, apres) {
        if (avant === null || avant === undefined) return 'AJOUT';
        if (apres === null || apres === undefined) return 'SUPPRESSION';
        if (typeof avant === 'number' && typeof apres === 'number') {
            const diff = apres - avant;
            if (diff > 0) return 'AUGMENTATION';
            if (diff < 0) return 'DIMINUTION';
        }
        return 'MODIFICATION';
    }

    /**
     * Calculer le delta entre deux états
     */
    calculerDelta(avant, apres) {
        if (!avant || !apres) return null;
        
        const delta = {};
        for (const [key, value] of Object.entries(apres)) {
            if (JSON.stringify(avant[key]) !== JSON.stringify(value)) {
                delta[key] = {
                    de: avant[key],
                    vers: value
                };
            }
        }
        return delta;
    }

    /**
     * Exporter en CSV
     */
    async exportToCSV(data, res) {
        const csv = [];
        
        // En-têtes
        csv.push('ID,Date,Action,Table,Entité,Utilisateur,IP,Données');
        
        // Données
        for (const row of data) {
            const ligne = [
                row.id,
                row.date_action,
                row.action_type,
                row.table_concernee,
                row.entite_id,
                `"${row.utilisateur}"`,
                row.ip_adresse,
                `"${JSON.stringify({ avant: row.donnees_avant, apres: row.donnees_apres })}"`
            ];
            csv.push(ligne.join(','));
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=historique_actions.csv');
        res.send(csv.join('\n'));
    }

    /**
     * Exporter en Excel
     */
    async exportToExcel(data, res) {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Historique Actions');

        // Colonnes
        worksheet.columns = [
            { header: 'ID', key: 'id', width: 10 },
            { header: 'Date', key: 'date_action', width: 20 },
            { header: 'Action', key: 'action_type', width: 15 },
            { header: 'Table', key: 'table_concernee', width: 20 },
            { header: 'Entité ID', key: 'entite_id', width: 10 },
            { header: 'Utilisateur', key: 'utilisateur', width: 30 },
            { header: 'IP', key: 'ip_adresse', width: 15 }
        ];

        // Style de l'en-tête
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        // Ajouter les données
        worksheet.addRows(data.map(row => ({
            id: row.id,
            date_action: new Date(row.date_action).toLocaleString(),
            action_type: row.action_type,
            table_concernee: row.table_concernee,
            entite_id: row.entite_id,
            utilisateur: row.utilisateur,
            ip_adresse: row.ip_adresse
        })));

        // Ajouter une feuille pour les détails JSON
        const detailsSheet = workbook.addWorksheet('Détails JSON');
        detailsSheet.columns = [
            { header: 'ID Action', key: 'id', width: 10 },
            { header: 'Données Avant', key: 'avant', width: 50 },
            { header: 'Données Après', key: 'apres', width: 50 }
        ];

        detailsSheet.getRow(1).font = { bold: true };

        detailsSheet.addRows(data
            .filter(row => row.donnees_avant || row.donnees_apres)
            .map(row => ({
                id: row.id,
                avant: JSON.stringify(row.donnees_avant, null, 2),
                apres: JSON.stringify(row.donnees_apres, null, 2)
            }))
        );

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=historique_actions.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    }
}

module.exports = new HistoriqueActionController();