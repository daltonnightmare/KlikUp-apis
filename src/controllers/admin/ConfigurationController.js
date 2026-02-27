// src/controllers/admin/ConfigurationController.js
const pool = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const CacheService = require('../../services/cache/CacheService');
const AuditService = require('../../services/audit/AuditService');
const { logInfo, logError } = require('../../configuration/logger');

class ConfigurationController {
    /**
     * Récupérer toutes les configurations
     * @route GET /api/v1/admin/configurations
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async findAll(req, res, next) {
        try {
            const { entite_type, entite_id, categorie } = req.query;

            let query = `
                SELECT 
                    id,
                    entite_type,
                    entite_id,
                    cle,
                    valeur,
                    valeur_json,
                    type_valeur,
                    description,
                    est_public,
                    date_creation,
                    date_mise_a_jour
                FROM CONFIGURATIONS
                WHERE 1=1
            `;
            const params = [];

            if (entite_type) {
                query += ` AND entite_type = $${params.length + 1}`;
                params.push(entite_type);
            }

            if (entite_id) {
                query += ` AND entite_id = $${params.length + 1}`;
                params.push(entite_id);
            }

            if (categorie) {
                query += ` AND cle LIKE $${params.length + 1}`;
                params.push(`${categorie}%`);
            }

            query += ' ORDER BY entite_type, entite_id, cle';

            const result = await pool.query(query, params);

            // Organisation par catégorie
            const organized = {};
            result.rows.forEach(config => {
                const cat = config.cle.split('.')[0];
                if (!organized[cat]) {
                    organized[cat] = [];
                }
                organized[cat].push(config);
            });

            res.json({
                status: 'success',
                data: organized,
                count: result.rows.length
            });

        } catch (error) {
            logError('Erreur récupération configurations:', error);
            next(error);
        }
    }

    /**
     * Récupérer une configuration par clé
     * @route GET /api/v1/admin/configurations/:cle
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async findByKey(req, res, next) {
        try {
            const { cle } = req.params;
            const { entite_type = 'PLATEFORME', entite_id = 1 } = req.query;

            const result = await pool.query(
                `SELECT * FROM CONFIGURATIONS 
                 WHERE entite_type = $1 
                 AND (entite_id = $2 OR entite_id IS NULL)
                 AND cle = $3`,
                [entite_type, entite_id, cle]
            );

            if (result.rows.length === 0) {
                throw new AppError('Configuration non trouvée', 404);
            }

            const config = result.rows[0];
            let valeur = config.valeur;

            // Conversion selon le type
            if (config.type_valeur === 'JSON' && config.valeur_json) {
                valeur = config.valeur_json;
            } else if (config.type_valeur === 'INTEGER') {
                valeur = parseInt(config.valeur);
            } else if (config.type_valeur === 'DECIMAL') {
                valeur = parseFloat(config.valeur);
            } else if (config.type_valeur === 'BOOLEAN') {
                valeur = config.valeur === 'true';
            }

            res.json({
                status: 'success',
                data: {
                    ...config,
                    valeur_parsee: valeur
                }
            });

        } catch (error) {
            logError('Erreur récupération configuration:', error);
            next(error);
        }
    }

    /**
     * Créer ou mettre à jour une configuration
     * @route POST /api/v1/admin/configurations
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async createOrUpdate(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const {
                entite_type = 'PLATEFORME',
                entite_id = 1,
                cle,
                valeur,
                type_valeur = 'TEXT',
                description,
                est_public = false
            } = req.body;

            // Validation
            if (!cle) {
                throw new ValidationError('La clé est requise');
            }

            // Préparation de la valeur
            let valeur_text = null;
            let valeur_json = null;

            if (type_valeur === 'JSON') {
                valeur_json = JSON.stringify(valeur);
            } else {
                valeur_text = String(valeur);
            }

            // Vérification existence
            const existing = await client.query(
                `SELECT id FROM CONFIGURATIONS 
                 WHERE entite_type = $1 AND entite_id = $2 AND cle = $3`,
                [entite_type, entite_id, cle]
            );

            let result;

            if (existing.rows.length > 0) {
                // Mise à jour
                result = await client.query(
                    `UPDATE CONFIGURATIONS 
                     SET valeur = $1,
                         valeur_json = $2,
                         type_valeur = $3,
                         description = COALESCE($4, description),
                         est_public = $5,
                         date_mise_a_jour = NOW()
                     WHERE entite_type = $6 AND entite_id = $7 AND cle = $8
                     RETURNING *`,
                    [valeur_text, valeur_json, type_valeur, description, est_public, 
                     entite_type, entite_id, cle]
                );
            } else {
                // Création
                result = await client.query(
                    `INSERT INTO CONFIGURATIONS 
                     (entite_type, entite_id, cle, valeur, valeur_json, type_valeur, description, est_public, date_creation, date_mise_a_jour)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
                     RETURNING *`,
                    [entite_type, entite_id, cle, valeur_text, valeur_json, type_valeur, description, est_public]
                );
            }

            // Audit
            await AuditService.log({
                action: existing.rows.length > 0 ? 'UPDATE' : 'CREATE',
                ressource_type: 'CONFIGURATION',
                ressource_id: result.rows[0].id,
                donnees_apres: result.rows[0],
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            // Invalidation cache
            await CacheService.delPattern(`config:${entite_type}:${entite_id}:*`);

            await client.query('COMMIT');

            res.json({
                status: 'success',
                data: result.rows[0],
                message: existing.rows.length > 0 ? 'Configuration mise à jour' : 'Configuration créée'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur création/mise à jour configuration:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer une configuration
     * @route DELETE /api/v1/admin/configurations/:id
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async delete(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            const config = await client.query(
                'SELECT * FROM CONFIGURATIONS WHERE id = $1',
                [id]
            );

            if (config.rows.length === 0) {
                throw new AppError('Configuration non trouvée', 404);
            }

            await client.query('DELETE FROM CONFIGURATIONS WHERE id = $1', [id]);

            // Audit
            await AuditService.log({
                action: 'DELETE',
                ressource_type: 'CONFIGURATION',
                ressource_id: id,
                donnees_avant: config.rows[0],
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: 'Configuration supprimée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur suppression configuration:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les configurations par lot
     * @route POST /api/v1/admin/configurations/batch
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getBatch(req, res, next) {
        try {
            const { cles, entite_type = 'PLATEFORME', entite_id = 1 } = req.body;

            if (!cles || !Array.isArray(cles)) {
                throw new ValidationError('Liste de clés requise');
            }

            const result = await pool.query(
                `SELECT cle, valeur, valeur_json, type_valeur
                 FROM CONFIGURATIONS
                 WHERE entite_type = $1 
                 AND (entite_id = $2 OR entite_id IS NULL)
                 AND cle = ANY($3::text[])`,
                [entite_type, entite_id, cles]
            );

            const configs = {};
            result.rows.forEach(row => {
                if (row.type_valeur === 'JSON' && row.valeur_json) {
                    configs[row.cle] = row.valeur_json;
                } else if (row.type_valeur === 'INTEGER') {
                    configs[row.cle] = parseInt(row.valeur);
                } else if (row.type_valeur === 'DECIMAL') {
                    configs[row.cle] = parseFloat(row.valeur);
                } else if (row.type_valeur === 'BOOLEAN') {
                    configs[row.cle] = row.valeur === 'true';
                } else {
                    configs[row.cle] = row.valeur;
                }
            });

            res.json({
                status: 'success',
                data: configs
            });

        } catch (error) {
            logError('Erreur récupération batch configurations:', error);
            next(error);
        }
    }

    /**
     * Récupérer les configurations système
     * @route GET /api/v1/admin/configurations/system
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getSystemConfig(req, res, next) {
        try {
            const result = await pool.query(`
                SELECT 
                    (SELECT valeur FROM CONFIGURATIONS WHERE cle = 'system.name' AND entite_type = 'PLATEFORME') as nom_plateforme,
                    (SELECT valeur FROM CONFIGURATIONS WHERE cle = 'system.version' AND entite_type = 'PLATEFORME') as version,
                    (SELECT valeur FROM CONFIGURATIONS WHERE cle = 'system.environment' AND entite_type = 'PLATEFORME') as environnement,
                    (SELECT valeur FROM CONFIGURATIONS WHERE cle = 'system.maintenance_mode' AND entite_type = 'PLATEFORME') as maintenance_mode,
                    (SELECT valeur_json FROM CONFIGURATIONS WHERE cle = 'system.features' AND entite_type = 'PLATEFORME') as fonctionnalites
            `);

            res.json({
                status: 'success',
                data: result.rows[0] || {}
            });

        } catch (error) {
            logError('Erreur récupération config système:', error);
            next(error);
        }
    }

    /**
     * Mettre à jour le mode maintenance
     * @route POST /api/v1/admin/configurations/maintenance
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async toggleMaintenance(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { enabled, message } = req.body;

            await client.query(
                `INSERT INTO CONFIGURATIONS (entite_type, entite_id, cle, valeur, type_valeur, date_mise_a_jour)
                 VALUES ('PLATEFORME', 1, 'system.maintenance_mode', $1, 'BOOLEAN', NOW())
                 ON CONFLICT (entite_type, entite_id, cle) 
                 DO UPDATE SET valeur = EXCLUDED.valeur, date_mise_a_jour = NOW()`,
                [enabled ? 'true' : 'false']
            );

            if (message) {
                await client.query(
                    `INSERT INTO CONFIGURATIONS (entite_type, entite_id, cle, valeur, type_valeur, date_mise_a_jour)
                     VALUES ('PLATEFORME', 1, 'system.maintenance_message', $1, 'TEXT', NOW())
                     ON CONFLICT (entite_type, entite_id, cle) 
                     DO UPDATE SET valeur = EXCLUDED.valeur, date_mise_a_jour = NOW()`,
                    [message]
                );
            }

            // Notification à tous les admins
            await NotificationService.notifyAdmins({
                type: 'MAINTENANCE_MODE',
                titre: enabled ? 'Mode maintenance activé' : 'Mode maintenance désactivé',
                message: enabled ? 'La plateforme est en maintenance' : 'La plateforme est de nouveau disponible',
                priorite: 'HAUTE'
            });

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: `Mode maintenance ${enabled ? 'activé' : 'désactivé'}`,
                data: { enabled, message }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur toggle maintenance:', error);
            next(error);
        } finally {
            client.release();
        }
    }
}

module.exports = new ConfigurationController();