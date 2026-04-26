// src/controllers/admin/RetentionController.js
const pool = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const NotificationService = require('../../services/notification/NotificationService');
const QueueService = require('../../services/queue/QueueService');
const { logInfo, logError, logWarn } = require('../../configuration/logger');

class RetentionController {
    /**
     * Récupérer toutes les politiques de rétention
     * @route GET /api/v1/admin/retention/policies
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getPolicies(req, res, next) {
        const client = await pool.getClient();
        try {
            const result = client.query(`
                SELECT 
                    id,
                    table_cible,
                    duree_retention_jours,
                    champ_date,
                    action_expiration,
                    derniere_execution,
                    est_active,
                    date_creation,
                    date_mise_a_jour,
                    (
                        SELECT COUNT(*) 
                        FROM information_schema.tables 
                        WHERE table_name = LOWER(table_cible)
                    ) as table_existe
                FROM POLITIQUES_RETENTION
                ORDER BY 
                    CASE 
                        WHEN est_active THEN 0 
                        ELSE 1 
                    END,
                    table_cible
            `);

            // Statistiques détaillées par table
            const stats = await this._getTablesStats();

            // Estimation des volumes à nettoyer
            const estimations = await this._getCleanupEstimations();

            res.json({
                status: 'success',
                data: {
                    politiques: result.rows,
                    statistiques: stats,
                    estimations: estimations,
                    total_politiques: result.rows.length,
                    actives: result.rows.filter(p => p.est_active).length
                }
            });

        } catch (error) {
            logError('Erreur récupération politiques:', error);
            next(error);
        }
    }

    /**
     * Récupérer une politique par ID
     * @route GET /api/v1/admin/retention/policies/:id
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getPolicyById(req, res, next) {
        const client = await pool.getClient();
        try {
            const { id } = req.params;

            const result = client.query(
                `SELECT 
                    p.*,
                    (
                        SELECT COUNT(*) 
                        FROM information_schema.columns 
                        WHERE table_name = LOWER(p.table_cible)
                        AND column_name = p.champ_date
                    ) as champ_valide,
                    (
                        SELECT json_agg(json_build_object(
                            'column_name', column_name,
                            'data_type', data_type
                        ))
                        FROM information_schema.columns 
                        WHERE table_name = LOWER(p.table_cible)
                    ) as colonnes_disponibles
                FROM POLITIQUES_RETENTION p
                WHERE p.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Politique non trouvée', 404);
            }

            // Historique des exécutions
            const historique = await pool.query(`
                SELECT 
                    date_action,
                    action_type,
                    utilisateur_id,
                    metadata->>'enregistrements_supprimes' as supprimes,
                    metadata->>'duree_execution' as duree
                FROM HISTORIQUE_ACTIONS
                WHERE table_concernee = 'POLITIQUES_RETENTION'
                AND entite_id = $1::text
                AND action_type = 'CLEANUP_EXECUTE'
                ORDER BY date_action DESC
                LIMIT 10
            `, [id]);

            res.json({
                status: 'success',
                data: {
                    ...result.rows[0],
                    historique_executions: historique.rows
                }
            });

        } catch (error) {
            logError('Erreur récupération politique:', error);
            next(error);
        }
    }

    /**
     * Créer une nouvelle politique de rétention
     * @route POST /api/v1/admin/retention/policies
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async createPolicy(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const {
                table_cible,
                duree_retention_jours,
                champ_date = 'date_creation',
                action_expiration = 'ANONYMISER'
            } = req.body;

            // 1. VALIDATIONS APPROFONDIES
            await this._validatePolicyData({
                table_cible,
                duree_retention_jours,
                champ_date,
                action_expiration
            }, client);

            // 2. VÉRIFICATION DE LA TABLE
            const tableInfo = await this._checkTableExists(client, table_cible);

            // 3. VÉRIFICATION DU CHAMP DATE
            await this._validateDateColumn(client, table_cible, champ_date);

            // 4. VÉRIFICATION DES POLITIQUES EXISTANTES
            const existing = await client.query(
                'SELECT id FROM POLITIQUES_RETENTION WHERE table_cible = $1',
                [table_cible.toUpperCase()]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError(`Une politique existe déjà pour la table ${table_cible}`);
            }

            // 5. CRÉATION DE LA POLITIQUE
            const result = await client.query(
                `INSERT INTO POLITIQUES_RETENTION 
                 (table_cible, duree_retention_jours, champ_date, action_expiration, est_active, date_creation)
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 RETURNING *`,
                [
                    table_cible.toUpperCase(),
                    duree_retention_jours,
                    champ_date,
                    action_expiration,
                    true
                ]
            );

            const nouvellePolitique = result.rows[0];

            // 6. ESTIMATION DU VOLUME CONCERNÉ
            const estimation = await this._estimateCleanupVolume(
                client,
                table_cible,
                champ_date,
                duree_retention_jours
            );

            // 7. AUDIT LOG
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'POLITIQUE_RETENTION',
                ressource_id: nouvellePolitique.id,
                donnees_apres: nouvellePolitique,
                metadata: { estimation },
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            logInfo(`Politique de rétention créée: ${table_cible} (${duree_retention_jours} jours)`);

            // 8. NOTIFICATION SI VOLUME IMPORTANT
            if (estimation.estimation > 10000) {
                await NotificationService.notifyAdmins({
                    type: 'RETENTION_POLICY_CREATED',
                    titre: '⚠️ Politique de rétention avec volume important',
                    message: `La table ${table_cible} pourrait concerner environ ${estimation.estimation} enregistrements`,
                    priorite: 'NORMALE',
                    donnees: { politique_id: nouvellePolitique.id, estimation }
                });
            }

            res.status(201).json({
                status: 'success',
                data: nouvellePolitique,
                estimation: estimation,
                message: 'Politique de rétention créée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur création politique:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour une politique
     * @route PUT /api/v1/admin/retention/policies/:id
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async updatePolicy(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const updates = req.body;

            // 1. RÉCUPÉRATION DE LA POLITIQUE
            const policy = await client.query(
                'SELECT * FROM POLITIQUES_RETENTION WHERE id = $1',
                [id]
            );

            if (policy.rows.length === 0) {
                throw new AppError('Politique non trouvée', 404);
            }

            const anciennePolitique = policy.rows[0];

            // 2. VALIDATION DES MISES À JOUR
            const setClauses = [];
            const values = [id];
            const allowedFields = ['duree_retention_jours', 'action_expiration', 'est_active'];

            for (const field of allowedFields) {
                if (updates[field] !== undefined) {
                    // Validations spécifiques
                    if (field === 'duree_retention_jours' && updates[field] < 1) {
                        throw new ValidationError('La durée doit être positive');
                    }
                    if (field === 'action_expiration' && !['SUPPRIMER', 'ANONYMISER', 'ARCHIVER'].includes(updates[field])) {
                        throw new ValidationError('Action d\'expiration invalide');
                    }

                    setClauses.push(`${field} = $${values.length + 1}`);
                    values.push(updates[field]);
                }
            }

            if (setClauses.length === 0) {
                throw new ValidationError('Aucune modification détectée');
            }

            setClauses.push('date_mise_a_jour = NOW()');

            // 3. EXÉCUTION DE LA MISE À JOUR
            const query = `
                UPDATE POLITIQUES_RETENTION 
                SET ${setClauses.join(', ')}, derniere_execution = NULL
                WHERE id = $1
                RETURNING *
            `;

            const result = await client.query(query, values);
            const politiqueMaj = result.rows[0];

            // 4. NOUVELLE ESTIMATION
            const estimation = await this._estimateCleanupVolume(
                client,
                anciennePolitique.table_cible,
                anciennePolitique.champ_date,
                updates.duree_retention_jours || anciennePolitique.duree_retention_jours
            );

            // 5. AUDIT
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'POLITIQUE_RETENTION',
                ressource_id: id,
                donnees_avant: anciennePolitique,
                donnees_apres: politiqueMaj,
                metadata: { estimation },
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            // 6. NOTIFICATION SI CHANGEMENT SIGNIFICATIF
            if (anciennePolitique.duree_retention_jours !== updates.duree_retention_jours) {
                await this._notifyPolicyChange(anciennePolitique, politiqueMaj, estimation);
            }

            res.json({
                status: 'success',
                data: politiqueMaj,
                estimation: estimation,
                message: 'Politique mise à jour avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur mise à jour politique:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer une politique
     * @route DELETE /api/v1/admin/retention/policies/:id
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async deletePolicy(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { force = false } = req.body;

            // Récupération de la politique
            const policy = await client.query(
                'SELECT * FROM POLITIQUES_RETENTION WHERE id = $1',
                [id]
            );

            if (policy.rows.length === 0) {
                throw new AppError('Politique non trouvée', 404);
            }

            const politique = policy.rows[0];

            // Vérification si la politique a déjà été exécutée
            if (politique.derniere_execution && !force) {
                throw new ValidationError(
                    'Cette politique a déjà été exécutée. Utilisez force=true pour la supprimer quand même'
                );
            }

            // Suppression
            await client.query('DELETE FROM POLITIQUES_RETENTION WHERE id = $1', [id]);

            // Audit
            await AuditService.log({
                action: 'DELETE',
                ressource_type: 'POLITIQUE_RETENTION',
                ressource_id: id,
                donnees_avant: politique,
                metadata: { force },
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            logInfo(`Politique de rétention supprimée: ${politique.table_cible}`);

            res.json({
                status: 'success',
                message: 'Politique supprimée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur suppression politique:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Activer/Désactiver une politique
     * @route PATCH /api/v1/admin/retention/policies/:id/toggle
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async togglePolicy(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { actif } = req.body;

            if (actif === undefined) {
                throw new ValidationError('Le statut (actif) est requis');
            }

            const result = await client.query(
                `UPDATE POLITIQUES_RETENTION 
                 SET est_active = $1, date_mise_a_jour = NOW()
                 WHERE id = $2
                 RETURNING *`,
                [actif, id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Politique non trouvée', 404);
            }

            await client.query('COMMIT');

            res.json({
                status: 'success',
                data: result.rows[0],
                message: `Politique ${actif ? 'activée' : 'désactivée'} avec succès`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur toggle politique:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Exécuter le nettoyage pour une table spécifique
     * @route POST /api/v1/admin/retention/clean/:table
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async cleanTable(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { table } = req.params;
            const { simulate = false, force = false } = req.query;

            // 1. RÉCUPÉRATION DE LA POLITIQUE
            const policy = await client.query(
                `SELECT * FROM POLITIQUES_RETENTION 
                 WHERE table_cible = $1 AND est_active = true`,
                [table.toUpperCase()]
            );

            if (policy.rows.length === 0) {
                throw new AppError('Politique non trouvée ou inactive', 404);
            }

            const politique = policy.rows[0];
            const dateLimite = new Date();
            dateLimite.setDate(dateLimite.getDate() - politique.duree_retention_jours);

            // 2. VÉRIFICATION DE LA DATE LIMITE
            if (dateLimite > new Date()) {
                throw new ValidationError('La date limite calculée est dans le futur');
            }

            // 3. COMPTAGE DES ENREGISTREMENTS CONCERNÉS
            const countResult = await client.query(
                `SELECT COUNT(*) as total 
                 FROM ${politique.table_cible.toLowerCase()} 
                 WHERE ${politique.champ_date} < $1`,
                [dateLimite]
            );
            
            const total = parseInt(countResult.rows[0].total);

            if (total === 0) {
                return res.json({
                    status: 'success',
                    message: 'Aucun enregistrement à nettoyer',
                    data: { table, supprimes: 0 }
                });
            }

            // 4. ALERTE SI VOLUME IMPORTANT
            if (total > 10000 && !force && !simulate) {
                throw new ValidationError(
                    `Opération massive (${total} enregistrements). Utilisez simulate=true pour estimer ou force=true pour forcer`
                );
            }

            let resultats = {
                table: politique.table_cible,
                date_limite: dateLimite,
                enregistrements_trouves: total,
                mode: simulate ? 'simulation' : 'execution'
            };

            if (simulate) {
                // Simulation uniquement
                const echantillon = await client.query(
                    `SELECT ${politique.champ_date} 
                     FROM ${politique.table_cible.toLowerCase()} 
                     WHERE ${politique.champ_date} < $1
                     ORDER BY ${politique.champ_date} DESC
                     LIMIT 10`,
                    [dateLimite]
                );

                resultats.echantillon = echantillon.rows;
                resultats.plus_ancien = echantillon.rows[echantillon.rows.length - 1];
                resultats.plus_recent = echantillon.rows[0];

            } else {
                // Exécution réelle
                const startTime = Date.now();
                let supprimes = 0;

                if (politique.action_expiration === 'SUPPRIMER') {
                    // Suppression physique
                    const deleteResult = await client.query(
                        `DELETE FROM ${politique.table_cible.toLowerCase()} 
                         WHERE ${politique.champ_date} < $1
                         RETURNING id`,
                        [dateLimite]
                    );
                    supprimes = deleteResult.rowCount;

                } else if (politique.action_expiration === 'ANONYMISER') {
                    // Anonymisation
                    supprimes = await this._anonymizeData(
                        client,
                        politique.table_cible,
                        politique.champ_date,
                        dateLimite
                    );

                } else if (politique.action_expiration === 'ARCHIVER') {
                    // Archivage (copie vers table d'archive puis suppression)
                    supprimes = await this._archiveData(
                        client,
                        politique.table_cible,
                        politique.champ_date,
                        dateLimite
                    );
                }

                const dureeExecution = Date.now() - startTime;

                // Mise à jour de la dernière exécution
                await client.query(
                    `UPDATE POLITIQUES_RETENTION 
                     SET derniere_execution = NOW()
                     WHERE id = $1`,
                    [politique.id]
                );

                resultats.enregistrements_supprimes = supprimes;
                resultats.duree_execution_ms = dureeExecution;

                // Audit
                await AuditService.log({
                    action: 'CLEANUP_EXECUTE',
                    ressource_type: 'POLITIQUE_RETENTION',
                    ressource_id: politique.id,
                    metadata: {
                        enregistrements_supprimes: supprimes,
                        duree_execution: dureeExecution,
                        date_limite: dateLimite
                    },
                    utilisateur_id: req.user.id,
                    adresse_ip: req.ip
                });

                logInfo(`Nettoyage ${politique.table_cible}: ${supprimes} enregistrements supprimés en ${dureeExecution}ms`);
            }

            await client.query('COMMIT');

            res.json({
                status: 'success',
                data: resultats,
                message: simulate 
                    ? 'Simulation terminée' 
                    : `Nettoyage terminé: ${resultats.enregistrements_supprimes} enregistrements traités`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur nettoyage table:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Exécuter le nettoyage pour toutes les tables
     * @route POST /api/v1/admin/retention/clean-all
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async cleanAll(req, res, next) {
        try {
            const { simulate = false } = req.query;
            const client = await pool.getClient();

            // Récupérer toutes les politiques actives
            const policies = await client.query(
                `SELECT * FROM POLITIQUES_RETENTION 
                 WHERE est_active = true
                 ORDER BY table_cible`
            );

            const results = [];
            const errors = [];

            for (const policy of policies.rows) {
                try {
                    // Appel à cleanTable pour chaque politique
                    const reqMock = {
                        params: { table: policy.table_cible },
                        query: { simulate }
                    };
                    const resMock = {
                        json: (data) => {
                            results.push({
                                table: policy.table_cible,
                                ...data.data
                            });
                        }
                    };

                    await this.cleanTable(reqMock, resMock, (err) => {
                        if (err) throw err;
                    });

                } catch (error) {
                    errors.push({
                        table: policy.table_cible,
                        error: error.message
                    });
                    logError(`Erreur nettoyage ${policy.table_cible}:`, error);
                }
            }

            // Rapport global
            const rapport = {
                total_politiques: policies.rows.length,
                succes: results.length,
                echecs: errors.length,
                details: results,
                erreurs: errors,
                simulate
            };

            // Notification si erreurs
            if (errors.length > 0) {
                await NotificationService.notifyAdmins({
                    type: 'CLEANUP_ERRORS',
                    titre: '⚠️ Erreurs lors du nettoyage',
                    message: `${errors.length} table(s) ont rencontré des erreurs`,
                    donnees: { erreurs: errors }
                });
            }

            res.json({
                status: 'success',
                data: rapport,
                message: simulate 
                    ? 'Simulation globale terminée' 
                    : `Nettoyage global terminé: ${results.length} succès, ${errors.length} échecs`
            });

        } catch (error) {
            logError('Erreur nettoyage global:', error);
            next(error);
        }
    }

    /**
     * Obtenir les statistiques de rétention
     * @route GET /api/v1/admin/retention/stats
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getRetentionStats(req, res, next) {
        try {
            const client = await pool.getClient();
            const stats = await client.query(`
                WITH politiques_stats AS (
                    SELECT 
                        p.table_cible,
                        p.duree_retention_jours,
                        p.action_expiration,
                        p.derniere_execution,
                        CASE 
                            WHEN EXISTS (
                                SELECT FROM information_schema.tables 
                                WHERE table_name = LOWER(p.table_cible)
                            ) THEN 'OK'
                            ELSE 'TABLE_MANQUANTE'
                        END as etat_table,
                        (
                            SELECT COUNT(*) 
                            FROM information_schema.columns 
                            WHERE table_name = LOWER(p.table_cible)
                            AND column_name = p.champ_date
                        ) > 0 as champ_date_valide
                    FROM POLITIQUES_RETENTION p
                ),
                volumes_estimés AS (
                    SELECT 
                        table_cible,
                        COUNT(*) as volume_total,
                        MIN(date_creation) as date_min,
                        MAX(date_creation) as date_max
                    FROM (
                        SELECT 'HISTORIQUE_CONNEXIONS' as table_cible, date_connexion as date_creation FROM HISTORIQUE_CONNEXIONS
                        UNION ALL
                        SELECT 'JOURNAL_AUDIT', date_action FROM JOURNAL_AUDIT
                        UNION ALL
                        SELECT 'SESSIONS', date_creation FROM SESSIONS
                        UNION ALL
                        SELECT 'TOKENS_REVOQUES', date_revocation FROM TOKENS_REVOQUES
                        UNION ALL
                        SELECT 'HISTORIQUE_ACTIONS', date_action FROM HISTORIQUE_ACTIONS
                        UNION ALL
                        SELECT 'HISTORIQUE_TRANSACTIONS', date_transaction FROM HISTORIQUE_TRANSACTIONS
                    ) as all_data
                    GROUP BY table_cible
                )
                SELECT 
                    ps.*,
                    COALESCE(v.volume_total, 0) as volume_total,
                    v.date_min as plus_ancien,
                    v.date_max as plus_recent,
                    CASE 
                        WHEN v.date_min IS NOT NULL THEN 
                            EXTRACT(DAY FROM (NOW() - v.date_min))::integer
                        ELSE 0
                    END as age_max_jours
                FROM politiques_stats ps
                LEFT JOIN volumes_estimés v ON v.table_cible = ps.table_cible
                ORDER BY ps.table_cible
            `);

            // Calcul des économies potentielles
            const economies = await this._calculateStorageSavings();

            // Alertes de conformité
            const alertes = await this._getComplianceAlerts();

            res.json({
                status: 'success',
                data: {
                    politiques: stats.rows,
                    economies_estimees: economies,
                    alertes_conformite: alertes,
                    resume: {
                        total_politiques: stats.rows.length,
                        tables_manquantes: stats.rows.filter(s => s.etat_table === 'TABLE_MANQUANTE').length,
                        champs_invalides: stats.rows.filter(s => !s.champ_date_valide).length,
                        volume_total: stats.rows.reduce((acc, s) => acc + parseInt(s.volume_total), 0)
                    }
                }
            });

        } catch (error) {
            logError('Erreur récupération stats rétention:', error);
            next(error);
        }
    }

    /**
     * Planifier un nettoyage automatique
     * @route POST /api/v1/admin/retention/schedule
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async scheduleCleanup(req, res, next) {
        try {
            const { frequence = 'daily', heure = '02:00', tables = [] } = req.body;

            // Validation de la configuration
            if (!['hourly', 'daily', 'weekly', 'monthly'].includes(frequence)) {
                throw new ValidationError('Fréquence invalide');
            }

            // Sauvegarder la configuration
            await pool.query(
                `INSERT INTO CONFIGURATIONS (entite_type, entite_id, cle, valeur_json, type_valeur, date_mise_a_jour)
                 VALUES ('PLATEFORME', 1, 'retention.schedule', $1, 'JSON', NOW())
                 ON CONFLICT (entite_type, entite_id, cle) 
                 DO UPDATE SET valeur_json = EXCLUDED.valeur_json, date_mise_a_jour = NOW()`,
                [JSON.stringify({ frequence, heure, tables })]
            );

            // Planifier le job (via votre système de queue)
            await QueueService.scheduleJob('retention-cleanup', {
                frequence,
                heure,
                tables: tables.length > 0 ? tables : 'all'
            });

            logInfo(`Nettoyage automatique planifié: ${frequence} à ${heure}`);

            res.json({
                status: 'success',
                message: `Nettoyage automatique planifié (${frequence})`,
                data: { frequence, heure, tables }
            });

        } catch (error) {
            logError('Erreur planification nettoyage:', error);
            next(error);
        }
    }

    /**
     * Obtenir l'historique des nettoyages
     * @route GET /api/v1/admin/retention/history
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getCleanupHistory(req, res, next) {
        try {
            const { 
                page = 1, 
                limit = 20, 
                table,
                date_debut,
                date_fin 
            } = req.query;

            const offset = (page - 1) * limit;
            const params = [];
            let paramIndex = 1;
            const conditions = ["action_type = 'CLEANUP_EXECUTE'"];

            if (table) {
                conditions.push(`metadata->>'table' = $${paramIndex}`);
                params.push(table);
                paramIndex++;
            }

            if (date_debut) {
                conditions.push(`date_action >= $${paramIndex}`);
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                conditions.push(`date_action <= $${paramIndex}`);
                params.push(date_fin);
                paramIndex++;
            }

            const query = `
                SELECT 
                    date_action,
                    utilisateur_id,
                    metadata->>'enregistrements_supprimes' as supprimes,
                    metadata->>'duree_execution' as duree,
                    metadata->>'table' as table_concernee,
                    metadata->>'mode' as mode_execution
                FROM HISTORIQUE_ACTIONS
                WHERE ${conditions.join(' AND ')}
                ORDER BY date_action DESC
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;

            params.push(parseInt(limit), offset);

            const result = await pool.query(query, params);

            // Statistiques globales
            const stats = await pool.query(`
                SELECT 
                    COUNT(*) as total_executions,
                    SUM((metadata->>'enregistrements_supprimes')::int) as total_supprimes,
                    AVG((metadata->>'duree_execution')::int) as duree_moyenne,
                    MAX(date_action) as derniere_execution
                FROM HISTORIQUE_ACTIONS
                WHERE action_type = 'CLEANUP_EXECUTE'
            `);

            res.json({
                status: 'success',
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(stats.rows[0].total_executions)
                },
                statistiques: stats.rows[0]
            });

        } catch (error) {
            logError('Erreur récupération historique:', error);
            next(error);
        }
    }

    // ==================== MÉTHODES PRIVÉES ====================

    /**
     * Valider les données d'une politique
     */
    async _validatePolicyData(data, client) {
        const { table_cible, duree_retention_jours, action_expiration } = data;

        if (!table_cible || table_cible.trim() === '') {
            throw new ValidationError('La table cible est requise');
        }

        if (!duree_retention_jours || duree_retention_jours < 1) {
            throw new ValidationError('La durée de rétention doit être positive (minimum 1 jour)');
        }

        if (duree_retention_jours > 3650) { // 10 ans max
            throw new ValidationError('La durée de rétention ne peut pas dépasser 10 ans (3650 jours)');
        }

        if (!['SUPPRIMER', 'ANONYMISER', 'ARCHIVER'].includes(action_expiration)) {
            throw new ValidationError("L'action d'expiration doit être SUPPRIMER, ANONYMISER ou ARCHIVER");
        }

        // Vérifier que la table n'est pas critique
        const tablesProtegees = ['COMPTES', 'PLATEFORME', 'CONFIGURATIONS'];
        if (tablesProtegees.includes(table_cible.toUpperCase())) {
            throw new ValidationError(`La table ${table_cible} est protégée et ne peut pas avoir de politique de rétention`);
        }
    }

    /**
     * Vérifier l'existence d'une table
     */
    async _checkTableExists(client, tableName) {
        const result = await client.query(`
            SELECT 
                table_name,
                (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = $1) as nombre_colonnes
            FROM information_schema.tables 
            WHERE table_name = $1
        `, [tableName.toLowerCase()]);

        if (result.rows.length === 0) {
            throw new ValidationError(`La table ${tableName} n'existe pas`);
        }

        return result.rows[0];
    }

    /**
     * Valider l'existence d'une colonne de date
     */
    async _validateDateColumn(client, tableName, columnName) {
        const result = await client.query(`
            SELECT data_type 
            FROM information_schema.columns 
            WHERE table_name = $1 AND column_name = $2
        `, [tableName.toLowerCase(), columnName.toLowerCase()]);

        if (result.rows.length === 0) {
            throw new ValidationError(`La colonne ${columnName} n'existe pas dans la table ${tableName}`);
        }

        const type = result.rows[0].data_type.toLowerCase();
        if (!type.includes('date') && !type.includes('timestamp')) {
            throw new ValidationError(`La colonne ${columnName} doit être de type DATE ou TIMESTAMP (actuel: ${type})`);
        }
    }

    /**
     * Estimer le volume à nettoyer
     */
    async _estimateCleanupVolume(client, tableName, dateColumn, dureeJours) {
        try {
            const dateLimite = new Date();
            dateLimite.setDate(dateLimite.getDate() - dureeJours);

            const result = await client.query(
                `SELECT COUNT(*) as total 
                 FROM ${tableName.toLowerCase()} 
                 WHERE ${dateColumn} < $1`,
                [dateLimite]
            );

            return {
                estimation: parseInt(result.rows[0].total),
                date_limite: dateLimite,
                table: tableName
            };
        } catch (error) {
            logWarn(`Impossible d'estimer le volume pour ${tableName}:`, error);
            return { estimation: 0, error: error.message };
        }
    }

    /**
     * Anonymiser des données
     */
    async _anonymizeData(client, tableName, dateColumn, dateLimite) {
        let count = 0;

        switch (tableName.toUpperCase()) {
            case 'HISTORIQUE_CONNEXIONS':
                const result1 = await client.query(
                    `UPDATE HISTORIQUE_CONNEXIONS 
                     SET adresse_ip = '0.0.0.0',
                         utilisateur_agent = 'ANONYMISED',
                         pays = NULL,
                         ville = NULL
                     WHERE ${dateColumn} < $1
                     RETURNING id`,
                    [dateLimite]
                );
                count = result1.rowCount;
                break;

            case 'HISTORIQUE_ACTIONS':
                const result2 = await client.query(
                    `UPDATE HISTORIQUE_ACTIONS 
                     SET utilisateur_id = NULL,
                         ip_adresse = '0.0.0.0',
                         user_agent = 'ANONYMISED'
                     WHERE ${dateColumn} < $1
                     RETURNING id`,
                    [dateLimite]
                );
                count = result2.rowCount;
                break;

            case 'SESSIONS':
                const result3 = await client.query(
                    `UPDATE SESSIONS 
                     SET token_hash = 'ANONYMISED',
                         refresh_token_hash = NULL,
                         adresse_ip = '0.0.0.0',
                         user_agent = 'ANONYMISED'
                     WHERE ${dateColumn} < $1
                     RETURNING id`,
                    [dateLimite]
                );
                count = result3.rowCount;
                break;

            default:
                // Anonymisation générique (à adapter selon les tables)
                count = 0;
        }

        return count;
    }

    /**
     * Archiver des données
     */
    async _archiveData(client, tableName, dateColumn, dateLimite) {
        // Créer une table d'archive si elle n'existe pas
        const archiveTable = `${tableName.toLowerCase()}_archive`;
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS ${archiveTable} (
                LIKE ${tableName.toLowerCase()} INCLUDING ALL,
                archive_date TIMESTAMP DEFAULT NOW()
            )
        `);

        // Copier les données
        const copyResult = await client.query(
            `INSERT INTO ${archiveTable} 
             SELECT *, NOW() as archive_date 
             FROM ${tableName.toLowerCase()} 
             WHERE ${dateColumn} < $1
             RETURNING id`,
            [dateLimite]
        );

        // Supprimer les données originales
        if (copyResult.rowCount > 0) {
            await client.query(
                `DELETE FROM ${tableName.toLowerCase()} 
                 WHERE ${dateColumn} < $1`,
                [dateLimite]
            );
        }

        return copyResult.rowCount;
    }

    /**
     * Obtenir les statistiques des tables
     */
    async _getTablesStats() {
        const tables = [
            'HISTORIQUE_CONNEXIONS',
            'JOURNAL_AUDIT',
            'SESSIONS',
            'TOKENS_REVOQUES',
            'HISTORIQUE_ACTIONS',
            'HISTORIQUE_TRANSACTIONS'
        ];

        const stats = [];

        for (const table of tables) {
            try {
                const result = await pool.query(`
                    SELECT 
                        COUNT(*) as total,
                        MIN(date_creation) as min_date,
                        MAX(date_creation) as max_date,
                        COUNT(*) FILTER (WHERE date_creation < NOW() - INTERVAL '1 year') as plus_1_an,
                        COUNT(*) FILTER (WHERE date_creation < NOW() - INTERVAL '2 years') as plus_2_ans,
                        COUNT(*) FILTER (WHERE date_creation < NOW() - INTERVAL '3 years') as plus_3_ans
                    FROM ${table.toLowerCase()}
                `);

                stats.push({
                    table,
                    ...result.rows[0]
                });
            } catch (error) {
                logWarn(`Impossible de récupérer les stats pour ${table}:`, error);
            }
        }

        return stats;
    }

    /**
     * Obtenir les estimations de nettoyage
     */
    async _getCleanupEstimations() {
        const policies = await pool.query(
            'SELECT * FROM POLITIQUES_RETENTION WHERE est_active = true'
        );

        const estimations = [];

        for (const policy of policies.rows) {
            try {
                const dateLimite = new Date();
                dateLimite.setDate(dateLimite.getDate() - policy.duree_retention_jours);

                const result = await pool.query(
                    `SELECT COUNT(*) as total 
                     FROM ${policy.table_cible.toLowerCase()} 
                     WHERE ${policy.champ_date} < $1`,
                    [dateLimite]
                );

                estimations.push({
                    table: policy.table_cible,
                    duree_retention: policy.duree_retention_jours,
                    enregistrements_a_traiter: parseInt(result.rows[0].total),
                    date_limite: dateLimite
                });
            } catch (error) {
                logWarn(`Erreur estimation pour ${policy.table_cible}:`, error);
            }
        }

        return estimations;
    }

    /**
     * Calculer les économies de stockage potentielles
     */
    async _calculateStorageSavings() {
        // Estimation basée sur la taille moyenne des enregistrements
        const taillesMoyennes = {
            'HISTORIQUE_CONNEXIONS': 500, // bytes
            'JOURNAL_AUDIT': 2000,
            'SESSIONS': 1000,
            'TOKENS_REVOQUES': 200,
            'HISTORIQUE_ACTIONS': 1500,
            'HISTORIQUE_TRANSACTIONS': 800
        };

        const estimations = await this._getCleanupEstimations();
        let totalEconomieBytes = 0;

        for (const est of estimations) {
            const taille = taillesMoyennes[est.table] || 500;
            totalEconomieBytes += est.enregistrements_a_traiter * taille;
        }

        // Conversion en unités lisibles
        const totalEconomieKB = totalEconomieBytes / 1024;
        const totalEconomieMB = totalEconomieKB / 1024;
        const totalEconomieGB = totalEconomieMB / 1024;

        return {
            bytes: totalEconomieBytes,
            kilo_bytes: Math.round(totalEconomieKB * 100) / 100,
            mega_bytes: Math.round(totalEconomieMB * 100) / 100,
            giga_bytes: Math.round(totalEconomieGB * 100) / 100,
            details: estimations.map(e => ({
                table: e.table,
                enregistrements: e.enregistrements_a_traiter,
                economie_mo: Math.round((e.enregistrements_a_traiter * (taillesMoyennes[e.table] || 500)) / (1024 * 1024) * 100) / 100
            }))
        };
    }

    /**
     * Obtenir les alertes de conformité
     */
    async _getComplianceAlerts() {
        const alertes = [];

        // Vérifier les politiques manquantes pour les tables critiques
        const tablesCritiques = [
            'HISTORIQUE_CONNEXIONS',
            'JOURNAL_AUDIT',
            'SESSIONS',
            'TOKENS_REVOQUES'
        ];

        for (const table of tablesCritiques) {
            const policy = await pool.query(
                'SELECT id FROM POLITIQUES_RETENTION WHERE table_cible = $1',
                [table]
            );

            if (policy.rows.length === 0) {
                alertes.push({
                    type: 'POLICY_MISSING',
                    severite: 'HAUTE',
                    table,
                    message: `Aucune politique de rétention pour la table ${table}`
                });
            }
        }

        // Vérifier les politiques inactives
        const inactives = await pool.query(
            'SELECT table_cible FROM POLITIQUES_RETENTION WHERE est_active = false'
        );

        for (const row of inactives.rows) {
            alertes.push({
                type: 'POLICY_INACTIVE',
                severite: 'MOYENNE',
                table: row.table_cible,
                message: `La politique pour ${row.table_cible} est inactive`
            });
        }

        // Vérifier les dernières exécutions
        const nonExecutees = await pool.query(`
            SELECT table_cible 
            FROM POLITIQUES_RETENTION 
            WHERE est_active = true 
            AND (derniere_execution IS NULL OR derniere_execution < NOW() - INTERVAL '7 days')
        `);

        for (const row of nonExecutees.rows) {
            alertes.push({
                type: 'NOT_EXECUTED',
                severite: 'BASSE',
                table: row.table_cible,
                message: `La politique pour ${row.table_cible} n'a pas été exécutée depuis plus de 7 jours`
            });
        }

        return alertes;
    }

    /**
     * Notifier un changement de politique
     */
    async _notifyPolicyChange(ancienne, nouvelle, estimation) {
        const message = `
            Politique de rétention modifiée pour ${nouvelle.table_cible}:
            - Ancienne durée: ${ancienne.duree_retention_jours} jours
            - Nouvelle durée: ${nouvelle.duree_retention_jours} jours
            - Action: ${nouvelle.action_expiration}
            - Impact estimé: ${estimation.estimation} enregistrements
        `;

        await NotificationService.notifyAdmins({
            type: 'RETENTION_POLICY_UPDATED',
            titre: '🔄 Politique de rétention modifiée',
            message,
            priorite: 'NORMALE',
            donnees: {
                ancienne,
                nouvelle,
                estimation
            }
        });
    }
}

module.exports = new RetentionController();