// src/controllers/horaire/JourFerieController.js
const pool = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const CacheService = require('../../services/cache/CacheService');
const { logInfo, logError } = require('../../configuration/logger');

class JourFerieController {
    /**
     * Créer un jour férié
     * @route POST /api/v1/jours-feries
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async create(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const {
                pays = 'Burkina Faso',
                date_ferie,
                libelle,
                est_recurrent = true
            } = req.body;

            // Validations
            if (!date_ferie || !libelle) {
                throw new ValidationError('Date et libellé requis');
            }

            // Vérifier doublon
            const existing = await client.query(
                `SELECT id FROM JOURS_FERIES 
                 WHERE pays = $1 AND date_ferie = $2`,
                [pays, date_ferie]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError('Ce jour férié existe déjà');
            }

            const result = await client.query(
                `INSERT INTO JOURS_FERIES (pays, date_ferie, libelle, est_recurrent, date_creation)
                 VALUES ($1, $2, $3, $4, NOW())
                 RETURNING *`,
                [pays, date_ferie, libelle, est_recurrent]
            );

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`jours-feries:${pays}:*`);

            logInfo(`Jour férié créé: ${libelle} (${date_ferie})`);

            res.status(201).json({
                status: 'success',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur création jour férié:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer tous les jours fériés
     * @route GET /api/v1/jours-feries
     * @access PUBLIC
     */
    async findAll(req, res, next) {
        try {
            const {
                pays,
                annee,
                recurrent_only = false,
                include_passed = false
            } = req.query;

            let query = 'SELECT * FROM JOURS_FERIES WHERE 1=1';
            const params = [];
            let paramIndex = 1;

            if (pays) {
                query += ` AND pays = $${paramIndex}`;
                params.push(pays);
                paramIndex++;
            }

            if (annee) {
                query += ` AND EXTRACT(YEAR FROM date_ferie) = $${paramIndex}`;
                params.push(annee);
                paramIndex++;
            }

            if (recurrent_only === 'true') {
                query += ` AND est_recurrent = true`;
            }

            if (!include_passed) {
                query += ` AND date_ferie >= CURRENT_DATE`;
            }

            query += ` ORDER BY date_ferie`;

            const result = await pool.query(query, params);

            // Grouper par mois pour l'affichage
            const groupedByMonth = {};
            result.rows.forEach(jf => {
                const mois = new Date(jf.date_ferie).toLocaleString('fr-FR', { month: 'long' });
                if (!groupedByMonth[mois]) {
                    groupedByMonth[mois] = [];
                }
                groupedByMonth[mois].push(jf);
            });

            res.json({
                status: 'success',
                data: result.rows,
                grouped: groupedByMonth,
                total: result.rows.length
            });

        } catch (error) {
            logError('Erreur récupération jours fériés:', error);
            next(error);
        }
    }

    /**
     * Mettre à jour un jour férié
     * @route PUT /api/v1/jours-feries/:id
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async update(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const updates = req.body;

            const jourFerie = await client.query(
                'SELECT * FROM JOURS_FERIES WHERE id = $1',
                [id]
            );

            if (jourFerie.rows.length === 0) {
                throw new AppError('Jour férié non trouvé', 404);
            }

            const champsAutorises = ['libelle', 'est_recurrent'];
            const setClauses = [];
            const values = [id];

            for (const champ of champsAutorises) {
                if (updates[champ] !== undefined) {
                    setClauses.push(`${champ} = $${values.length + 1}`);
                    values.push(updates[champ]);
                }
            }

            if (setClauses.length === 0) {
                throw new ValidationError('Aucune modification');
            }

            const query = `
                UPDATE JOURS_FERIES 
                SET ${setClauses.join(', ')}
                WHERE id = $1
                RETURNING *
            `;

            const result = await client.query(query, values);

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`jours-feries:*`);

            res.json({
                status: 'success',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur mise à jour jour férié:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer un jour férié
     * @route DELETE /api/v1/jours-feries/:id
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async delete(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            const result = await client.query(
                'DELETE FROM JOURS_FERIES WHERE id = $1 RETURNING *',
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Jour férié non trouvé', 404);
            }

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`jours-feries:*`);

            res.json({
                status: 'success',
                message: 'Jour férié supprimé'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur suppression jour férié:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Importer les jours fériés d'une année
     * @route POST /api/v1/jours-feries/import
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async importYear(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { annee, pays = 'Burkina Faso' } = req.body;

            if (!annee) {
                throw new ValidationError('Année requise');
            }

            // Calculer les jours fériés fixes
            const joursFixes = this._getJoursFeriesFixes(annee, pays);
            
            // Calculer les jours fériés mobiles (Pâques, etc.)
            const joursMobiles = await this._getJoursFeriesMobiles(annee, pays);

            const tousJours = [...joursFixes, ...joursMobiles];
            const results = [];

            for (const jf of tousJours) {
                // Vérifier si existe déjà
                const existing = await client.query(
                    `SELECT id FROM JOURS_FERIES 
                     WHERE pays = $1 AND date_ferie = $2`,
                    [pays, jf.date]
                );

                if (existing.rows.length === 0) {
                    const result = await client.query(
                        `INSERT INTO JOURS_FERIES (pays, date_ferie, libelle, est_recurrent, date_creation)
                         VALUES ($1, $2, $3, $4, NOW())
                         RETURNING *`,
                        [pays, jf.date, jf.libelle, true]
                    );
                    results.push(result.rows[0]);
                }
            }

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`jours-feries:${pays}:*`);

            logInfo(`${results.length} jours fériés importés pour ${annee}`);

            res.json({
                status: 'success',
                data: {
                    imported: results.length,
                    total: tousJours.length,
                    jours: results
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur import jours fériés:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Vérifier si une date est fériée
     * @route GET /api/v1/jours-feries/est-ferie
     * @access PUBLIC
     */
    async estFerie(req, res, next) {
        try {
            const { date, pays = 'Burkina Faso' } = req.query;

            if (!date) {
                throw new ValidationError('Date requise');
            }

            const result = await pool.query(
                `SELECT * FROM JOURS_FERIES 
                 WHERE pays = $1 
                 AND (date_ferie = $2 OR (est_recurrent = true AND 
                      EXTRACT(MONTH FROM date_ferie) = EXTRACT(MONTH FROM $2::date) AND
                      EXTRACT(DAY FROM date_ferie) = EXTRACT(DAY FROM $2::date)))`,
                [pays, date]
            );

            res.json({
                status: 'success',
                data: {
                    date,
                    est_ferie: result.rows.length > 0,
                    jour_ferie: result.rows[0] || null
                }
            });

        } catch (error) {
            logError('Erreur vérification jour férié:', error);
            next(error);
        }
    }

    // ==================== MÉTHODES PRIVÉES ====================

    /**
     * Obtenir les jours fériés fixes
     */
    _getJoursFeriesFixes(annee, pays) {
        const jours = [];

        if (pays === 'Burkina Faso') {
            // Jours fériés fixes au Burkina Faso
            jours.push(
                { date: `${annee}-01-01`, libelle: "Jour de l'an" },
                { date: `${annee-annee}-03-08`, libelle: "Journée internationale des femmes" },
                { date: `${annee}-05-01`, libelle: "Fête du travail" },
                { date: `${annee}-08-05`, libelle: "Fête de l'indépendance" },
                { date: `${annee}-08-15`, libelle: "Assomption" },
                { date: `${annee}-11-01`, libelle: "Toussaint" },
                { date: `${annee}-12-11`, libelle: "Fête nationale" },
                { date: `${annee}-12-25`, libelle: "Noël" }
            );
        }

        return jours;
    }

    /**
     * Obtenir les jours fériés mobiles (calculés)
     */
    async _getJoursFeriesMobiles(annee, pays) {
        const jours = [];

        // Calcul de Pâques (algorithme de Gauss)
        const datePaques = this._calculerPaques(annee);
        
        if (datePaques) {
            jours.push(
                { date: this._formatDate(datePaques), libelle: "Pâques" },
                { date: this._formatDate(this._ajouterJours(datePaques, 1)), libelle: "Lundi de Pâques" },
                { date: this._formatDate(this._ajouterJours(datePaques, 39)), libelle: "Ascension" },
                { date: this._formatDate(this._ajouterJours(datePaques, 50)), libelle: "Pentecôte" },
                { date: this._formatDate(this._ajouterJours(datePaques, 51)), libelle: "Lundi de Pentecôte" }
            );
        }

        // Fin du Ramadan (à calculer selon calendrier lunaire)
        // À implémenter avec une API externe ou une table de correspondance

        // Tabaski (à calculer)
        // À implémenter

        return jours;
    }

    /**
     * Calculer la date de Pâques (algorithme de Gauss)
     */
    _calculerPaques(annee) {
        const a = annee % 19;
        const b = Math.floor(annee / 100);
        const c = annee % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const mois = Math.floor((h + l - 7 * m + 114) / 31);
        const jour = ((h + l - 7 * m + 114) % 31) + 1;

        return new Date(annee, mois - 1, jour);
    }

    /**
     * Ajouter des jours à une date
     */
    _ajouterJours(date, jours) {
        const newDate = new Date(date);
        newDate.setDate(newDate.getDate() + jours);
        return newDate;
    }

    /**
     * Formater une date en YYYY-MM-DD
     */
    _formatDate(date) {
        return date.toISOString().split('T')[0];
    }
}

module.exports = new JourFerieController();