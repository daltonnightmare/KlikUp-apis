// src/controllers/horaire/HoraireExceptionController.js
const pool = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/ValidationError');
const AuditService = require('../../services/audit/AuditService');
const NotificationService = require('../../services/notification/NotificationService');
const CacheService = require('../../services/cache/CacheService');
const { logInfo, logError } = require('../../configuration/logger');

class HoraireExceptionController {
    /**
     * Créer une exception d'horaire
     * @route POST /api/v1/horaires/exceptions
     * @access PRIVATE
     */
    async create(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const {
                entite_type,
                entite_id,
                date_exception,
                libelle,
                est_ouvert = false,
                heure_ouverture,
                heure_fermeture,
                motif
            } = req.body;

            // Validations
            if (!entite_type || !entite_id || !date_exception) {
                throw new ValidationError('Type, ID et date requis');
            }

            if (!libelle) {
                throw new ValidationError('Un libellé est requis');
            }

            const date = new Date(date_exception);
            if (date < new Date().setHours(0, 0, 0, 0)) {
                throw new ValidationError('La date exceptionnelle ne peut pas être dans le passé');
            }

            if (est_ouvert) {
                if (!heure_ouverture || !heure_fermeture) {
                    throw new ValidationError('Heures requises si ouvert');
                }
                if (heure_fermeture <= heure_ouverture) {
                    throw new ValidationError('Heure de fermeture doit être après ouverture');
                }
            }

            // Vérifier l'entité
            await this._checkEntityExists(client, entite_type, entite_id);

            // Vérifier les permissions
            await this._checkPermissions(req.user, entite_type, entite_id);

            // Vérifier les doublons
            const existing = await client.query(
                `SELECT id FROM HORAIRES_EXCEPTIONS 
                 WHERE entite_type = $1 AND entite_id = $2 AND date_exception = $3`,
                [entite_type, entite_id, date_exception]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError('Une exception existe déjà pour cette date');
            }

            // Création
            const result = await client.query(
                `INSERT INTO HORAIRES_EXCEPTIONS (
                    entite_type, entite_id, date_exception, libelle,
                    est_ouvert, heure_ouverture, heure_fermeture, motif,
                    date_creation
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                 RETURNING *`,
                [
                    entite_type,
                    entite_id,
                    date_exception,
                    libelle,
                    est_ouvert,
                    heure_ouverture || null,
                    heure_fermeture || null,
                    motif || null
                ]
            );

            // Audit
            await AuditService.log({
                action: 'CREATE_EXCEPTION',
                ressource_type: entite_type,
                ressource_id: entite_id,
                metadata: { exception: result.rows[0] },
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`horaires:${entite_type}:${entite_id}:*`);

            logInfo(`Exception créée pour ${entite_type}:${entite_id} le ${date_exception}`);

            res.status(201).json({
                status: 'success',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur création exception:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les exceptions d'une entité
     * @route GET /api/v1/horaires/exceptions/:entite_type/:entite_id
     * @access PUBLIC
     */
    async findByEntity(req, res, next) {
        try {
            const { entite_type, entite_id } = req.params;
            const { from_date, to_date, include_passed = false } = req.query;

            let query = `
                SELECT * FROM HORAIRES_EXCEPTIONS
                WHERE entite_type = $1 AND entite_id = $2
            `;
            const params = [entite_type, entite_id];
            let paramIndex = 3;

            if (from_date) {
                query += ` AND date_exception >= $${paramIndex}`;
                params.push(from_date);
                paramIndex++;
            }

            if (to_date) {
                query += ` AND date_exception <= $${paramIndex}`;
                params.push(to_date);
                paramIndex++;
            }

            if (!include_passed) {
                query += ` AND date_exception >= CURRENT_DATE`;
            }

            query += ` ORDER BY date_exception`;

            const result = await pool.query(query, params);

            // Séparer les passées et futures
            const maintenant = new Date();
            const aVenir = result.rows.filter(e => new Date(e.date_exception) >= maintenant);
            const passees = result.rows.filter(e => new Date(e.date_exception) < maintenant);

            res.json({
                status: 'success',
                data: {
                    a_venir: aVenir,
                    passees: passees,
                    total: result.rows.length
                }
            });

        } catch (error) {
            logError('Erreur récupération exceptions:', error);
            next(error);
        }
    }

    /**
     * Mettre à jour une exception
     * @route PUT /api/v1/horaires/exceptions/:id
     * @access PRIVATE
     */
    async update(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const updates = req.body;

            // Récupérer l'exception
            const exception = await client.query(
                'SELECT * FROM HORAIRES_EXCEPTIONS WHERE id = $1',
                [id]
            );

            if (exception.rows.length === 0) {
                throw new AppError('Exception non trouvée', 404);
            }

            const exceptionData = exception.rows[0];

            // Vérifier permissions
            await this._checkPermissions(req.user, exceptionData.entite_type, exceptionData.entite_id);

            // Champs modifiables
            const champsAutorises = ['libelle', 'est_ouvert', 'heure_ouverture', 'heure_fermeture', 'motif'];
            const setClauses = [];
            const values = [id];
            const modifications = {};

            for (const champ of champsAutorises) {
                if (updates[champ] !== undefined) {
                    setClauses.push(`${champ} = $${values.length + 1}`);
                    values.push(updates[champ]);
                    modifications[champ] = {
                        avant: exceptionData[champ],
                        apres: updates[champ]
                    };
                }
            }

            if (setClauses.length === 0) {
                throw new ValidationError('Aucune modification');
            }

            const query = `
                UPDATE HORAIRES_EXCEPTIONS 
                SET ${setClauses.join(', ')}
                WHERE id = $1
                RETURNING *
            `;

            const result = await client.query(query, values);

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`horaires:${exceptionData.entite_type}:${exceptionData.entite_id}:*`);

            res.json({
                status: 'success',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur mise à jour exception:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer une exception
     * @route DELETE /api/v1/horaires/exceptions/:id
     * @access PRIVATE
     */
    async delete(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            // Récupérer l'exception
            const exception = await client.query(
                'SELECT * FROM HORAIRES_EXCEPTIONS WHERE id = $1',
                [id]
            );

            if (exception.rows.length === 0) {
                throw new AppError('Exception non trouvée', 404);
            }

            const exceptionData = exception.rows[0];

            // Vérifier permissions
            await this._checkPermissions(req.user, exceptionData.entite_type, exceptionData.entite_id);

            // Supprimer
            await client.query('DELETE FROM HORAIRES_EXCEPTIONS WHERE id = $1', [id]);

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`horaires:${exceptionData.entite_type}:${exceptionData.entite_id}:*`);

            res.json({
                status: 'success',
                message: 'Exception supprimée'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur suppression exception:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Créer des exceptions en lot (ex: fermeture annuelle)
     * @route POST /api/v1/horaires/exceptions/batch
     * @access PRIVATE
     */
    async createBatch(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const {
                entite_type,
                entite_id,
                dates, // Tableau de dates
                libelle,
                est_ouvert = false,
                motif
            } = req.body;

            if (!dates || !Array.isArray(dates) || dates.length === 0) {
                throw new ValidationError('Tableau de dates requis');
            }

            // Vérifier permissions
            await this._checkPermissions(req.user, entite_type, entite_id);

            const results = [];
            const errors = [];

            for (const date of dates) {
                try {
                    // Vérifier si existe déjà
                    const existing = await client.query(
                        `SELECT id FROM HORAIRES_EXCEPTIONS 
                         WHERE entite_type = $1 AND entite_id = $2 AND date_exception = $3`,
                        [entite_type, entite_id, date]
                    );

                    if (existing.rows.length > 0) {
                        errors.push({ date, error: 'Exception existe déjà' });
                        continue;
                    }

                    const result = await client.query(
                        `INSERT INTO HORAIRES_EXCEPTIONS (
                            entite_type, entite_id, date_exception, libelle,
                            est_ouvert, motif, date_creation
                         ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
                         RETURNING *`,
                        [entite_type, entite_id, date, libelle, est_ouvert, motif]
                    );

                    results.push(result.rows[0]);

                } catch (error) {
                    errors.push({ date, error: error.message });
                }
            }

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`horaires:${entite_type}:${entite_id}:*`);

            res.json({
                status: 'success',
                data: {
                    created: results.length,
                    failed: errors.length,
                    exceptions: results,
                    errors
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur création lot exceptions:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    // Méthodes privées
    async _checkEntityExists(client, entite_type, entite_id) {
        const tables = {
            'BOUTIQUE': 'BOUTIQUES',
            'RESTAURANT_FAST_FOOD': 'RESTAURANTSFASTFOOD',
            'EMPLACEMENT_RESTAURANT': 'EMPLACEMENTSRESTAURANTFASTFOOD',
            'COMPAGNIE_TRANSPORT': 'COMPAGNIESTRANSPORT',
            'EMPLACEMENT_TRANSPORT': 'EMPLACEMENTSTRANSPORT'
        };

        const table = tables[entite_type];
        if (!table) return;

        const result = await client.query(
            `SELECT id FROM ${table} WHERE id = $1`,
            [entite_id]
        );

        if (result.rows.length === 0) {
            throw new ValidationError(`${entite_type} avec ID ${entite_id} non trouvé`);
        }
    }

    async _checkPermissions(user, entite_type, entite_id) {
        if (user.compte_role === 'ADMINISTRATEUR_PLATEFORME') return;

        let isOwner = false;

        if (entite_type === 'BOUTIQUE') {
            const boutique = await pool.query(
                'SELECT proprietaire_id FROM BOUTIQUES WHERE id = $1',
                [entite_id]
            );
            isOwner = boutique.rows[0]?.proprietaire_id === user.id;
        }

        if (!isOwner) {
            throw new AppError('Permissions insuffisantes', 403);
        }
    }
}

module.exports = new HoraireExceptionController();