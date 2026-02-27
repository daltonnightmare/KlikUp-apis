// src/controllers/historique/PolitiqueRetentionController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');

class PolitiqueRetentionController {
    /**
     * Récupérer toutes les politiques de rétention
     * @route GET /api/v1/historique/politiques-retention
     */
    async findAll(req, res, next) {
        try {
            const { est_active } = req.query;

            let query = 'SELECT * FROM POLITIQUES_RETENTION WHERE 1=1';
            const params = [];

            if (est_active !== undefined) {
                query += ' AND est_active = $1';
                params.push(est_active === 'true');
            }

            query += ' ORDER BY table_cible';

            const result = await db.query(query, params);

            res.json({
                success: true,
                data: result.rows
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer une politique par sa table cible
     * @route GET /api/v1/historique/politiques-retention/:table
     */
    async findOne(req, res, next) {
        try {
            const { table } = req.params;

            const result = await db.query(
                'SELECT * FROM POLITIQUES_RETENTION WHERE table_cible = $1',
                [table]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Politique de rétention non trouvée pour cette table');
            }

            // Statistiques d'application
            const stats = await db.query(
                `SELECT 
                    COUNT(*) as total_entrees,
                    MIN(${result.rows[0].champ_date}) as plus_ancienne,
                    MAX(${result.rows[0].champ_date}) as plus_recente,
                    COUNT(*) FILTER (WHERE ${result.rows[0].champ_date} < NOW() - INTERVAL '1 day' * $1) as a_supprimer
                 FROM ${table}`,
                [result.rows[0].duree_retention_jours]
            );

            const politique = result.rows[0];
            politique.statistiques = stats.rows[0];

            res.json({
                success: true,
                data: politique
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Créer une nouvelle politique de rétention
     * @route POST /api/v1/historique/politiques-retention
     */
    async create(req, res, next) {
        try {
            const {
                table_cible,
                duree_retention_jours,
                champ_date = 'date_creation',
                action_expiration = 'ANONYMISER'
            } = req.body;

            // Validation
            if (!table_cible || !duree_retention_jours) {
                throw new ValidationError('Table cible et durée de retention requises');
            }

            // Vérifier si la table existe
            const tableExists = await db.query(
                `SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = $1
                )`,
                [table_cible.toLowerCase()]
            );

            if (!tableExists.rows[0].exists) {
                throw new ValidationError(`La table ${table_cible} n'existe pas`);
            }

            // Vérifier si une politique existe déjà
            const existing = await db.query(
                'SELECT id FROM POLITIQUES_RETENTION WHERE table_cible = $1',
                [table_cible]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError('Une politique existe déjà pour cette table');
            }

            const result = await db.query(
                `INSERT INTO POLITIQUES_RETENTION 
                 (table_cible, duree_retention_jours, champ_date, action_expiration, est_active)
                 VALUES ($1, $2, $3, $4, true)
                 RETURNING *`,
                [table_cible, duree_retention_jours, champ_date, action_expiration]
            );

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message: 'Politique de rétention créée'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Mettre à jour une politique
     * @route PUT /api/v1/historique/politiques-retention/:id
     */
    async update(req, res, next) {
        try {
            const { id } = req.params;
            const updateData = { ...req.body };

            const politique = await db.query(
                'SELECT * FROM POLITIQUES_RETENTION WHERE id = $1',
                [id]
            );

            if (politique.rows.length === 0) {
                throw new NotFoundError('Politique non trouvée');
            }

            const setClauses = [];
            const values = [id];
            let valueIndex = 2;

            const allowedFields = ['duree_retention_jours', 'champ_date', 'action_expiration', 'est_active'];

            for (const field of allowedFields) {
                if (updateData[field] !== undefined) {
                    setClauses.push(`${field} = $${valueIndex}`);
                    values.push(updateData[field]);
                    valueIndex++;
                }
            }

            if (setClauses.length === 0) {
                throw new ValidationError('Aucune donnée à mettre à jour');
            }

            const updateQuery = `
                UPDATE POLITIQUES_RETENTION 
                SET ${setClauses.join(', ')}
                WHERE id = $1
                RETURNING *
            `;

            const result = await db.query(updateQuery, values);

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Politique mise à jour'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Supprimer une politique
     * @route DELETE /api/v1/historique/politiques-retention/:id
     */
    async delete(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                'DELETE FROM POLITIQUES_RETENTION WHERE id = $1 RETURNING id',
                [id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Politique non trouvée');
            }

            res.json({
                success: true,
                message: 'Politique supprimée'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Exécuter le nettoyage pour une politique spécifique
     * @route POST /api/v1/historique/politiques-retention/:id/executer
     */
    async executerNettoyage(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;

            const politique = await client.query(
                'SELECT * FROM POLITIQUES_RETENTION WHERE id = $1 AND est_active = true',
                [id]
            );

            if (politique.rows.length === 0) {
                throw new NotFoundError('Politique active non trouvée');
            }

            const p = politique.rows[0];
            const dateLimite = new Date();
            dateLimite.setDate(dateLimite.getDate() - p.duree_retention_jours);

            let result;

            switch (p.action_expiration) {
                case 'SUPPRIMER':
                    result = await client.query(
                        `DELETE FROM ${p.table_cible} 
                         WHERE ${p.champ_date} < $1
                         RETURNING id`,
                        [dateLimite]
                    );
                    break;

                case 'ANONYMISER':
                    // Logique d'anonymisation spécifique à chaque table
                    result = await this.anonymiserDonnees(client, p.table_cible, p.champ_date, dateLimite);
                    break;

                case 'ARCHIVER':
                    // Créer table d'archive si nécessaire
                    await client.query(
                        `CREATE TABLE IF NOT EXISTS ${p.table_cible}_archive 
                         (LIKE ${p.table_cible} INCLUDING ALL)`
                    );
                    
                    await client.query(
                        `INSERT INTO ${p.table_cible}_archive 
                         SELECT * FROM ${p.table_cible} 
                         WHERE ${p.champ_date} < $1`,
                        [dateLimite]
                    );
                    
                    result = await client.query(
                        `DELETE FROM ${p.table_cible} 
                         WHERE ${p.champ_date} < $1
                         RETURNING id`,
                        [dateLimite]
                    );
                    break;
            }

            // Mettre à jour la dernière exécution
            await client.query(
                `UPDATE POLITIQUES_RETENTION 
                 SET derniere_execution = NOW()
                 WHERE id = $1`,
                [p.id]
            );

            await client.query('COMMIT');

            res.json({
                success: true,
                message: `Nettoyage effectué pour ${p.table_cible}`,
                data: {
                    table: p.table_cible,
                    date_limite: dateLimite,
                    elements_traites: result?.rowCount || 0,
                    action: p.action_expiration
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Obtenir des recommandations de rétention
     * @route GET /api/v1/historique/politiques-retention/recommandations
     */
    async getRecommandations(req, res, next) {
        try {
            // Analyser les tables avec des données temporelles
            const tables = await db.query(
                `SELECT 
                    table_name,
                    (
                        SELECT COUNT(*) 
                        FROM information_schema.columns 
                        WHERE table_name = t.table_name 
                        AND data_type IN ('timestamp', 'date')
                    ) as colonnes_temporelles
                 FROM information_schema.tables t
                 WHERE table_schema = 'public'
                   AND table_type = 'BASE TABLE'
                   AND table_name NOT LIKE '%archive%'
                   AND table_name NOT LIKE '%audit%'
                 ORDER BY table_name`
            );

            const recommandations = [];

            for (const table of tables.rows) {
                if (table.colonnes_temporelles === 0) continue;

                // Vérifier si une politique existe déjà
                const existing = await db.query(
                    'SELECT id FROM POLITIQUES_RETENTION WHERE table_cible = $1',
                    [table.table_name]
                );

                if (existing.rows.length > 0) continue;

                // Estimer la taille et proposer une durée
                const stats = await db.query(
                    `SELECT 
                        COUNT(*) as total_lignes,
                        MIN(COALESCE(date_creation, NOW())) as plus_ancien
                     FROM ${table.table_name}`
                );

                if (stats.rows[0].total_lignes > 10000) {
                    recommandations.push({
                        table_cible: table.table_name,
                        duree_recommandee: 365, // 1 an
                        action_recommandee: 'ARCHIVER',
                        justification: `Table volumineuse (${stats.rows[0].total_lignes} lignes)`,
                        priorite: 'HAUTE'
                    });
                } else if (table.table_name.includes('LOG') || table.table_name.includes('HISTORIQUE')) {
                    recommandations.push({
                        table_cible: table.table_name,
                        duree_recommandee: 90, // 3 mois
                        action_recommandee: 'SUPPRIMER',
                        justification: 'Données de log temporaires',
                        priorite: 'MOYENNE'
                    });
                }
            }

            res.json({
                success: true,
                data: recommandations
            });

        } catch (error) {
            next(error);
        }
    }

    // ==================== Méthodes privées ====================

    /**
     * Anonymiser les données d'une table
     */
    async anonymiserDonnees(client, table, champDate, dateLimite) {
        // Logique d'anonymisation spécifique à chaque table
        switch (table) {
            case 'COMPTES':
                return await client.query(
                    `UPDATE COMPTES 
                     SET email = CONCAT('anonyme_', id, '@anonyme.com'),
                         nom_utilisateur_compte = CONCAT('utilisateur_', id),
                         numero_de_telephone = NULL,
                         cni_photo = NULL,
                         photo_profil_compte = NULL,
                         est_supprime = true,
                         date_suppression = NOW()
                     WHERE ${champDate} < $1
                     RETURNING id`,
                    [dateLimite]
                );

            case 'HISTORIQUE_CONNEXIONS':
                return await client.query(
                    `UPDATE HISTORIQUE_CONNEXIONS 
                     SET adresse_ip = '0.0.0.0',
                         utilisateur_agent = NULL
                     WHERE ${champDate} < $1
                     RETURNING id`,
                    [dateLimite]
                );

            case 'MESSAGES':
                return await client.query(
                    `UPDATE MESSAGES 
                     SET contenu_message = '[Message anonymisé]',
                         contenu_formatte = NULL,
                         mentions_comptes = '{}',
                         metadata = '{"anonymise": true}'
                     WHERE ${champDate} < $1
                     RETURNING id`,
                    [dateLimite]
                );

            default:
                return { rowCount: 0 };
        }
    }
}

module.exports = new PolitiqueRetentionController();