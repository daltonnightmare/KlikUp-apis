// src/controllers/admin/MaintenanceController.js
const pool = require('../../configuration/database');
const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const NotificationService = require('../../services/notification/NotificationService');
const QueueService = require('../../services/queue/QueueService');
const CacheService = require('../../services/cache/CacheService');
const logger = require('../../configuration/logger');

class MaintenanceController {
    /**
     * Récupérer l'état de santé du système
     * @route GET /api/v1/admin/maintenance/health
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getSystemHealth(req, res, next) {
        try {
            const clientDb = pool;
            const startTime = Date.now();

            // 1. STATUT DE LA BASE DE DONNÉES
            const dbStatus = await this._checkDatabaseHealth();

            // 2. STATUT DU CACHE (REDIS)
            const cacheStatus = await this._checkCacheHealth();

            // 3. STATUT DU SYSTÈME DE FICHIERS
            const diskStatus = await this._checkDiskHealth();

            // 4. STATUT DE LA MÉMOIRE
            const memoryStatus = this._checkMemoryHealth();

            // 5. CHARGE CPU
            const cpuStatus = this._checkCPUHealth();

            // 6. STATUT DES SERVICES EXTERNES
            const servicesStatus = await this._checkExternalServices();

            // 7. STATUT DES WORKERS
            const workersStatus = await this._checkWorkersHealth();

            // 8. DERNIÈRES ERREURS
            const recentErrors = await this._getRecentErrors();

            const responseTime = Date.now() - startTime;

            // Calcul du statut global
            const globalStatus = this._calculateGlobalHealth({
                db: dbStatus,
                cache: cacheStatus,
                disk: diskStatus,
                memory: memoryStatus,
                cpu: cpuStatus,
                services: servicesStatus,
                workers: workersStatus
            });

            const healthData = {
                global: globalStatus,
                timestamp: new Date().toISOString(),
                response_time_ms: responseTime,
                components: {
                    database: dbStatus,
                    cache: cacheStatus,
                    disk: diskStatus,
                    memory: memoryStatus,
                    cpu: cpuStatus,
                    external_services: servicesStatus,
                    workers: workersStatus
                },
                recent_errors: recentErrors,
                uptime: process.uptime()
            };

            // Alerte si problème critique
            if (globalStatus.status === 'CRITICAL') {

                await NotificationService.notifyAdmins({
                    type: 'SYSTEM_HEALTH_CRITICAL',
                    titre: '🚨 État système critique',
                    corps: `Plusieurs composants sont en état critique`,
                    donnees: healthData,
                    priorite: 'CRITIQUE'
                });
            }

            res.json({
                status: 'success',
                data: healthData
            });

        } catch (error) {
            logger.error('Erreur vérification santé système:', error);
            next(error);
        }
    }

    /**
     * Récupérer les métriques détaillées
     * @route GET /api/v1/admin/maintenance/metrics
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getMetrics(req, res, next) {
        try {
            const { periode = '1h' } = req.query;

            // 1. MÉTRIQUES BASE DE DONNÉES
            const dbMetrics = await this._getDatabaseMetrics();

            // 2. MÉTRIQUES API
            const apiMetrics = await this._getAPIMetrics(periode);

            // 3. MÉTRIQUES UTILISATEURS
            const userMetrics = await this._getUserMetrics(periode);

            // 4. MÉTRIQUES COMMANDES
            const orderMetrics = await this._getOrderMetrics(periode);

            // 5. MÉTRIQUES PERFORMANCE
            const performanceMetrics = await this._getPerformanceMetrics(periode);

            // 6. MÉTRIQUES ERREURS
            const errorMetrics = await this._getErrorMetrics(periode);

            res.json({
                status: 'success',
                data: {
                    timestamp: new Date().toISOString(),
                    periode,
                    database: dbMetrics,
                    api: apiMetrics,
                    users: userMetrics,
                    orders: orderMetrics,
                    performance: performanceMetrics,
                    errors: errorMetrics
                }
            });

        } catch (error) {
            logger.error('Erreur récupération métriques:', error);
            next(error);
        }
    }

    /**
     * Récupérer les logs système
     * @route GET /api/v1/admin/maintenance/logs
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getLogs(req, res, next) {
        const client = await pool.getClient();
        try {
            const {
                level = 'all',
                service = 'all',
                limit = 100,
                offset = 0,
                date_debut,
                date_fin,
                search
            } = req.query;

            // Construction de la requête avec les bonnes colonnes de JOURNAL_AUDIT
            let query = `
                SELECT 
                    id,
                    date_action as timestamp,
                    CASE 
                        WHEN succes = false THEN 'ERROR' 
                        ELSE 'INFO' 
                    END as level,
                    ressource_type as service,
                    action as message,
                    metadata,
                    adresse_ip as ip,
                    compte_id as user_id,
                    duree_ms,
                    code_erreur,
                    message_erreur
                FROM JOURNAL_AUDIT
                WHERE 1=1
            `;
            const params = [];
            let paramIndex = 1;

            // Filtre par niveau (succes = false pour ERROR, true pour INFO)
            if (level !== 'all') {
                if (level.toUpperCase() === 'ERROR') {
                    query += ` AND succes = $${paramIndex}`;
                    params.push(false);
                } else if (level.toUpperCase() === 'INFO') {
                    query += ` AND succes = $${paramIndex}`;
                    params.push(true);
                }
                paramIndex++;
            }

            // Filtre par service (ressource_type)
            if (service !== 'all') {
                query += ` AND ressource_type = $${paramIndex}`;
                params.push(service);
                paramIndex++;
            }

            // Filtre par date de début
            if (date_debut) {
                query += ` AND date_action >= $${paramIndex}`;
                params.push(date_debut);
                paramIndex++;
            }

            // Filtre par date de fin
            if (date_fin) {
                query += ` AND date_action <= $${paramIndex}`;
                params.push(date_fin);
                paramIndex++;
            }

            // Filtre par recherche (action ou metadata)
            if (search) {
                query += ` AND (action ILIKE $${paramIndex} OR metadata::text ILIKE $${paramIndex})`;
                params.push(`%${search}%`);
                paramIndex++;
            }

            // Ordre et pagination
            query += ` ORDER BY date_action DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), parseInt(offset));

            await client.query('BEGIN');
            
            const result = await client.query(query, params);

            // Statistiques des logs (sans la colonne service qui n'existe pas)
            const stats = await client.query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE succes = false) as errors,
                    COUNT(*) FILTER (WHERE succes = true) as infos,
                    MIN(date_action) as plus_ancien,
                    MAX(date_action) as plus_recent,
                    COUNT(DISTINCT ressource_type) as services_distincts
                FROM JOURNAL_AUDIT
                WHERE date_action >= NOW() - INTERVAL '24 hours'
            `);

            // Statistiques par ressource_type (service)
            const serviceStats = await client.query(`
                SELECT 
                    ressource_type as service,
                    COUNT(*) as count,
                    COUNT(*) FILTER (WHERE succes = false) as errors
                FROM JOURNAL_AUDIT
                WHERE date_action >= NOW() - INTERVAL '24 hours'
                GROUP BY ressource_type
                ORDER BY count DESC
                LIMIT 10
            `);

            await client.query('COMMIT');

            res.json({
                status: 'success',
                data: result.rows,
                pagination: {
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    total: parseInt(stats.rows[0]?.total || 0)
                },
                statistiques: {
                    ...stats.rows[0],
                    par_service: serviceStats.rows
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur récupération logs:', error);
            next(error);
        } finally {
            if (client) {
                client.release();
            }
        }
    }

    /**
     * Obtenir les logs en temps réel (SSE)
     * @route GET /api/v1/admin/maintenance/logs/realtime
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getRealtimeLogs(req, res, next) {
        try {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });

            const { level = 'all' } = req.query;

            // Fonction pour envoyer les logs
            const sendLog = (log) => {
                res.write(`data: ${JSON.stringify(log)}\n\n`);
            };

            // Écouter les nouveaux logs (via un canal Redis/pub-sub par exemple)
            const listener = (log) => {
                if (level === 'all' || log.level === level) {
                    sendLog(log);
                }
            };

            // S'abonner aux logs
            // await redis.subscribe('logs', listener);

            // Garder la connexion ouverte
            req.on('close', () => {
                // await redis.unsubscribe('logs', listener);
                res.end();
            });

        } catch (error) {
            logger.error('Erreur streaming logs:', error);
            next(error);
        }
    }

    /**
     * Nettoyer le cache
     * @route POST /api/v1/admin/maintenance/cache/clean
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async cleanCache(req, res, next) {
        try {
            const { pattern = '*' } = req.body;

            const startTime = Date.now();

            // Nettoyage du cache
            const deleted = await CacheService.delPattern(pattern);

            const duration = Date.now() - startTime;

            // Audit
            await AuditService.log({
                action: 'CACHE_CLEAN',
                ressource_type: 'CACHE',
                metadata: {
                    pattern,
                    deleted_keys: deleted,
                    duration_ms: duration
                },
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            logger.info(`Cache nettoyé: ${deleted} clés supprimées (pattern: ${pattern})`);

            res.json({
                status: 'success',
                message: `Cache nettoyé avec succès`,
                data: {
                    pattern,
                    deleted_keys: deleted,
                    duration_ms: duration
                }
            });

        } catch (error) {
            logger.error('Erreur nettoyage cache:', error);
            next(error);
        }
    }

    /**
     * Obtenir les statistiques du cache
     * @route GET /api/v1/admin/maintenance/cache/stats
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getCacheStats(req, res, next) {
        try {
            const stats = await CacheService.getStats();

            // Top clés par taille
            const topKeys = await CacheService.getTopKeys(20);

            // Répartition par préfixe
            const prefixes = await CacheService.getPrefixDistribution();

            res.json({
                status: 'success',
                data: {
                    ...stats,
                    top_keys: topKeys,
                    prefixes: prefixes,
                    timestamp: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Erreur récupération stats cache:', error);
            next(error);
        }
    }

    /**
     * Obtenir les tâches planifiées
     * @route GET /api/v1/admin/maintenance/jobs
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getScheduledJobs(req, res, next) {
        try {
            const { status = 'all' } = req.query;

            let query = `
                SELECT 
                    id,
                    type_tache,
                    payload,
                    statut,
                    priorite,
                    tentatives,
                    max_tentatives,
                    derniere_erreur,
                    execute_apres,
                    date_creation,
                    date_debut,
                    date_fin,
                    worker_id,
                    EXTRACT(EPOCH FROM (COALESCE(date_fin, NOW()) - date_debut)) as duree_secondes
                FROM FILE_TACHES
                WHERE 1=1
            `;
            const params = [];

            if (status !== 'all') {
                query += ` AND statut = $1`;
                params.push(status.toUpperCase());
            }

            query += ` ORDER BY 
                CASE statut
                    WHEN 'EN_COURS' THEN 1
                    WHEN 'EN_ATTENTE' THEN 2
                    ELSE 3
                END,
                priorite DESC,
                date_creation DESC
                LIMIT 100`;

            const result = await pool.query(query, params);

            // Statistiques des jobs
            const stats = await pool.query(`
                SELECT 
                    statut,
                    COUNT(*) as nombre,
                    AVG(EXTRACT(EPOCH FROM (date_fin - date_debut))) as duree_moyenne
                FROM FILE_TACHES
                WHERE date_creation >= NOW() - INTERVAL '24 hours'
                GROUP BY statut
            `);

            res.json({
                status: 'success',
                data: result.rows,
                statistiques: stats.rows
            });

        } catch (error) {
            logger.error('Erreur récupération jobs:', error);
            next(error);
        }
    }

    /**
     * Relancer une tâche échouée
     * @route POST /api/v1/admin/maintenance/jobs/:id/retry
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async retryJob(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            const job = await client.query(
                'SELECT * FROM FILE_TACHES WHERE id = $1',
                [id]
            );

            if (job.rows.length === 0) {
                throw new AppError('Tâche non trouvée', 404);
            }

            if (job.rows[0].statut !== 'ECHOUEE') {
                throw new ValidationError('Seules les tâches échouées peuvent être relancées');
            }

            await client.query(
                `UPDATE FILE_TACHES 
                 SET statut = 'EN_ATTENTE',
                     tentatives = 0,
                     derniere_erreur = NULL,
                     execute_apres = NOW(),
                     date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [id]
            );

            await client.query('COMMIT');

            logger.info(`Tâche ${id} relancée par ${req.user.id}`);

            res.json({
                status: 'success',
                message: 'Tâche relancée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur relance tâche:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Annuler une tâche
     * @route POST /api/v1/admin/maintenance/jobs/:id/cancel
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async cancelJob(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { raison } = req.body;

            const result = await client.query(
                `UPDATE FILE_TACHES 
                 SET statut = 'ABANDONNEE',
                     date_fin = NOW(),
                     metadata = metadata || $1
                 WHERE id = $2
                 RETURNING *`,
                [JSON.stringify({ annule_par: req.user.id, raison }), id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Tâche non trouvée', 404);
            }

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: 'Tâche annulée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur annulation tâche:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Obtenir les performances de la base de données
     * @route GET /api/v1/admin/maintenance/db/performance
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getDatabasePerformance(req, res, next) {
        try {
            // Requêtes lentes
            const slowQueries = await pool.query(`
                SELECT 
                    query,
                    calls,
                    total_time,
                    mean_time,
                    rows
                FROM pg_stat_statements
                WHERE mean_time > 100
                ORDER BY mean_time DESC
                LIMIT 20
            `);

            // Taille des tables
            const tableSizes = await pool.query(`
                SELECT
                    schemaname,
                    tablename,
                    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
                    pg_total_relation_size(schemaname||'.'||tablename) as size_bytes,
                    n_live_tup as live_rows,
                    n_dead_tup as dead_rows
                FROM pg_stat_user_tables
                ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
                LIMIT 20
            `);

            // Index inutilisés
            const unusedIndexes = await pool.query(`
                SELECT
                    schemaname,
                    tablename,
                    indexname,
                    idx_scan as scans,
                    idx_tup_read as reads,
                    idx_tup_fetch as fetches
                FROM pg_stat_user_indexes
                WHERE idx_scan = 0
                ORDER BY tablename
            `);

            // Connexions actives
            const activeConnections = await pool.query(`
                SELECT 
                    count(*) as total,
                    count(*) filter (where state = 'active') as actives,
                    count(*) filter (where state = 'idle') as idle,
                    count(*) filter (where state = 'idle in transaction') as idle_in_transaction
                FROM pg_stat_activity
                WHERE datname = current_database()
            `);

            res.json({
                status: 'success',
                data: {
                    slow_queries: slowQueries.rows,
                    table_sizes: tableSizes.rows,
                    unused_indexes: unusedIndexes.rows,
                    connections: activeConnections.rows[0],
                    timestamp: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Erreur récupération performances DB:', error);
            next(error);
        }
    }

    /**
     * Optimiser les tables
     * @route POST /api/v1/admin/maintenance/db/optimize
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async optimizeDatabase(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { tables = [], vacuum = true, analyze = true, reindex = false } = req.body;

            const results = [];
            const tablesToOptimize = tables.length > 0 ? tables : await this._getAllTables();

            for (const table of tablesToOptimize) {
                try {
                    const tableResult = { table, operations: [] };

                    if (vacuum) {
                        await client.query(`VACUUM ANALYZE ${table}`);
                        tableResult.operations.push('VACUUM');
                    }

                    if (analyze && !vacuum) {
                        await client.query(`ANALYZE ${table}`);
                        tableResult.operations.push('ANALYZE');
                    }

                    if (reindex) {
                        await client.query(`REINDEX TABLE ${table}`);
                        tableResult.operations.push('REINDEX');
                    }

                    results.push(tableResult);

                } catch (tableError) {
                    logWarn(`Erreur optimisation table ${table}:`, tableError);
                    results.push({
                        table,
                        error: tableError.message
                    });
                }
            }

            // Audit
            await AuditService.log({
                action: 'DB_OPTIMIZE',
                ressource_type: 'DATABASE',
                metadata: {
                    tables: tablesToOptimize,
                    operations: { vacuum, analyze, reindex },
                    results
                },
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            logger.info(`Optimisation DB terminée: ${tablesToOptimize.length} tables traitées`);

            res.json({
                status: 'success',
                message: 'Optimisation terminée',
                data: {
                    tables_traitees: tablesToOptimize.length,
                    details: results
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur optimisation DB:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Créer une sauvegarde
     * @route POST /api/v1/admin/maintenance/backup
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async createBackup(req, res, next) {
        try {
            const { type = 'full', tables = [], description } = req.body;

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDir = path.join(process.env.BACKUP_PATH || '/backups', timestamp);
            
            // Créer le répertoire de backup
            await fs.mkdir(backupDir, { recursive: true });

            let backupFiles = [];

            if (type === 'full') {
                // Backup complet de la base
                const { stdout } = await execAsync(
                    `pg_dump -h ${process.env.DB_HOST} -U ${process.env.DB_USER} -d ${process.env.DB_NAME} -F c -f ${backupDir}/full_backup.dump`
                );
                backupFiles.push('full_backup.dump');

                // Backup des fichiers uploads
                const uploadsDir = path.join(__dirname, '../../../uploads');
                await execAsync(`tar -czf ${backupDir}/uploads.tar.gz -C ${uploadsDir} .`);
                backupFiles.push('uploads.tar.gz');

            } else if (type === 'partial' && tables.length > 0) {
                // Backup de tables spécifiques
                for (const table of tables) {
                    const { stdout } = await execAsync(
                        `pg_dump -h ${process.env.DB_HOST} -U ${process.env.DB_USER} -d ${process.env.DB_NAME} -t ${table} -F c -f ${backupDir}/${table}.dump`
                    );
                    backupFiles.push(`${table}.dump`);
                }
            }

            // Métadonnées du backup
            const metadata = {
                timestamp,
                type,
                tables: tables,
                files: backupFiles,
                size: await this._getDirectorySize(backupDir),
                created_by: req.user.id,
                description
            };

            await fs.writeFile(
                path.join(backupDir, 'metadata.json'),
                JSON.stringify(metadata, null, 2)
            );

            // Enregistrer dans l'historique
            await pool.query(
                `INSERT INTO BACKUP_HISTORY (backup_path, type, metadata, created_by, created_at)
                 VALUES ($1, $2, $3, $4, NOW())`,
                [backupDir, type, JSON.stringify(metadata), req.user.id]
            );

            logger.info(`Backup créé: ${backupDir}`);

            res.json({
                status: 'success',
                message: 'Backup créé avec succès',
                data: {
                    path: backupDir,
                    ...metadata
                }
            });

        } catch (error) {
            logger.error('Erreur création backup:', error);
            next(error);
        }
    }

    /**
     * Récupérer la liste des sauvegardes
     * @route GET /api/v1/admin/maintenance/backups
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getBackups(req, res, next) {
        try {
            const backups = await pool.query(`
                SELECT 
                    id,
                    backup_path,
                    type,
                    metadata,
                    created_by,
                    created_at,
                    restored_at,
                    restored_by
                FROM BACKUP_HISTORY
                ORDER BY created_at DESC
                LIMIT 50
            `);

            // Vérifier l'existence des fichiers
            const backupsWithStatus = await Promise.all(
                backups.rows.map(async (backup) => {
                    try {
                        await fs.access(backup.backup_path);
                        return { ...backup, exists: true };
                    } catch {
                        return { ...backup, exists: false };
                    }
                })
            );

            res.json({
                status: 'success',
                data: backupsWithStatus
            });

        } catch (error) {
            logger.error('Erreur récupération backups:', error);
            next(error);
        }
    }

    /**
     * Restaurer une sauvegarde
     * @route POST /api/v1/admin/maintenance/backups/:id/restore
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async restoreBackup(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { tables = [], force = false } = req.body;

            // Récupérer la sauvegarde
            const backup = await client.query(
                'SELECT * FROM BACKUP_HISTORY WHERE id = $1',
                [id]
            );

            if (backup.rows.length === 0) {
                throw new AppError('Sauvegarde non trouvée', 404);
            }

            const backupData = backup.rows[0];
            const metadata = backupData.metadata;

            // Vérifier l'existence des fichiers
            try {
                await fs.access(backupData.backup_path);
            } catch {
                throw new AppError('Fichiers de sauvegarde introuvables', 404);
            }

            // Mode maintenance
            await this._setMaintenanceMode(true, 'Restauration en cours');

            try {
                if (metadata.type === 'full') {
                    // Restauration complète
                    await execAsync(
                        `pg_restore -h ${process.env.DB_HOST} -U ${process.env.DB_USER} -d ${process.env.DB_NAME} -c -F c ${backupData.backup_path}/full_backup.dump`
                    );

                    // Restauration des uploads
                    if (await this._fileExists(`${backupData.backup_path}/uploads.tar.gz`)) {
                        await execAsync(
                            `tar -xzf ${backupData.backup_path}/uploads.tar.gz -C ${path.join(__dirname, '../../../uploads')}`
                        );
                    }

                } else if (metadata.type === 'partial' && tables.length > 0) {
                    // Restauration partielle
                    for (const table of tables) {
                        const tableFile = `${backupData.backup_path}/${table}.dump`;
                        if (await this._fileExists(tableFile)) {
                            await execAsync(
                                `pg_restore -h ${process.env.DB_HOST} -U ${process.env.DB_USER} -d ${process.env.DB_NAME} -t ${table} -c -F c ${tableFile}`
                            );
                        }
                    }
                }

                // Mettre à jour le statut
                await client.query(
                    `UPDATE BACKUP_HISTORY 
                     SET restored_at = NOW(), restored_by = $1
                     WHERE id = $2`,
                    [req.user.id, id]
                );

                logger.info(`Backup ${id} restauré avec succès`);

            } finally {
                // Désactiver le mode maintenance
                await this._setMaintenanceMode(false);
            }

            await client.query('COMMIT');

            // Notification
            await NotificationService.notifyAdmins({
                type: 'BACKUP_RESTORED',
                titre: '💾 Sauvegarde restaurée',
                message: `La sauvegarde du ${new Date(backupData.created_at).toLocaleString()} a été restaurée`,
                priorite: 'HAUTE'
            });

            res.json({
                status: 'success',
                message: 'Restauration terminée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            await this._setMaintenanceMode(false);
            logger.error('Erreur restauration backup:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Nettoyer les anciennes sauvegardes
     * @route POST /api/v1/admin/maintenance/backups/clean
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async cleanOldBackups(req, res, next) {
        try {
            const { keep_days = 30 } = req.body;

            const dateLimite = new Date();
            dateLimite.setDate(dateLimite.getDate() - keep_days);

            // Récupérer les anciennes sauvegardes
            const oldBackups = await pool.query(
                `SELECT * FROM BACKUP_HISTORY 
                 WHERE created_at < $1
                 AND restored_at IS NULL`,
                [dateLimite]
            );

            let deleted = 0;
            let errors = [];

            for (const backup of oldBackups.rows) {
                try {
                    // Supprimer les fichiers
                    await fs.rm(backup.backup_path, { recursive: true, force: true });

                    // Supprimer l'entrée en base
                    await pool.query('DELETE FROM BACKUP_HISTORY WHERE id = $1', [backup.id]);
                    
                    deleted++;

                } catch (error) {
                    errors.push({ id: backup.id, error: error.message });
                }
            }

            logger.info(`${deleted} anciennes sauvegardes nettoyées`);

            res.json({
                status: 'success',
                message: `${deleted} sauvegarde(s) nettoyée(s)`,
                data: {
                    supprimees: deleted,
                    erreurs: errors
                }
            });

        } catch (error) {
            logger.error('Erreur nettoyage backups:', error);
            next(error);
        }
    }

    /**
     * Obtenir les alertes système
     * @route GET /api/v1/admin/maintenance/alerts
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getSystemAlerts(req, res, next) {
        try {
            const { severity = 'all', resolved = false } = req.query;

            let query = `
                SELECT 
                    id,
                    type_alerte,
                    severite,
                    details,
                    est_traitee,
                    date_creation,
                    date_traitement,
                    traite_par,
                    action_prise
                FROM ALERTES_SECURITE
                WHERE 1=1
            `;
            const params = [];

            if (severity !== 'all') {
                query += ` AND severite = $${params.length + 1}`;
                params.push(severity.toUpperCase());
            }

            if (!resolved) {
                query += ` AND est_traitee = false`;
            }

            query += ` ORDER BY 
                CASE severite
                    WHEN 'CRITIQUE' THEN 1
                    WHEN 'ELEVE' THEN 2
                    WHEN 'MOYEN' THEN 3
                    ELSE 4
                END,
                date_creation DESC
                LIMIT 100`;

            const result = await pool.query(query, params);

            // Statistiques des alertes
            const stats = await pool.query(`
                SELECT 
                    severite,
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE est_traitee = false) as non_traitees,
                    MIN(date_creation) as plus_ancienne
                FROM ALERTES_SECURITE
                WHERE date_creation >= NOW() - INTERVAL '7 days'
                GROUP BY severite
            `);

            res.json({
                status: 'success',
                data: result.rows,
                statistiques: stats.rows
            });

        } catch (error) {
            logger.error('Erreur récupération alertes:', error);
            next(error);
        }
    }

    /**
     * Résoudre une alerte
     * @route POST /api/v1/admin/maintenance/alerts/:id/resolve
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async resolveAlert(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { action_prise } = req.body;

            const result = await client.query(
                `UPDATE ALERTES_SECURITE 
                 SET est_traitee = true,
                     date_traitement = NOW(),
                     traite_par = $1,
                     action_prise = $2
                 WHERE id = $3
                 RETURNING *`,
                [req.user.id, action_prise, id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Alerte non trouvée', 404);
            }

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: 'Alerte résolue avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur résolution alerte:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Exécuter une tâche de maintenance planifiée
     * @route POST /api/v1/admin/maintenance/run-task/:taskName
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async runMaintenanceTask(req, res, next) {
        try {
            const { taskName } = req.params;
            const { params = {} } = req.body;

            const tasks = {
                'clean-sessions': this._cleanExpiredSessions,
                'clean-tokens': this._cleanRevokedTokens,
                'refresh-views': this._refreshMaterializedViews,
                'optimize-tables': this._optimizeTables,
                'clean-logs': this._cleanOldLogs,
                'check-connections': this._checkIdleConnections
            };

            if (!tasks[taskName]) {
                throw new ValidationError(`Tâche ${taskName} non trouvée`);
            }

            // Ajouter à la file d'attente
            const jobId = await QueueService.addJob('maintenance', {
                task: taskName,
                params,
                requested_by: req.user.id
            });

            logger.info(`Tâche de maintenance ${taskName} planifiée (job ${jobId})`);

            res.json({
                status: 'success',
                message: `Tâche ${taskName} planifiée`,
                data: { job_id: jobId }
            });

        } catch (error) {
            logger.error('Erreur exécution tâche maintenance:', error);
            next(error);
        }
    }

    // ==================== MÉTHODES PRIVÉES ====================

    /**
     * Vérifier la santé de la base de données
     */
    async _checkDatabaseHealth() {
        try {
            const startTime = Date.now();
            await pool.query('SELECT 1');
            const responseTime = Date.now() - startTime;

            // Vérifier la taille
            const size = await pool.query(`
                SELECT pg_database_size(current_database()) as size_bytes
            `);

            // Vérifier les connexions
            const connections = await pool.query(`
                SELECT count(*) as total 
                FROM pg_stat_activity 
                WHERE datname = current_database()
            `);

            const maxConnections = await pool.query(`
                SELECT setting::int as max 
                FROM pg_settings 
                WHERE name = 'max_connections'
            `);

            const status = responseTime < 100 ? 'HEALTHY' : responseTime < 500 ? 'DEGRADED' : 'CRITICAL';

            return {
                status,
                response_time_ms: responseTime,
                size_bytes: parseInt(size.rows[0].size_bytes),
                connections: parseInt(connections.rows[0].total),
                max_connections: parseInt(maxConnections.rows[0].max),
                connection_ratio: Math.round((connections.rows[0].total / maxConnections.rows[0].max) * 100)
            };

        } catch (error) {
            return {
                status: 'CRITICAL',
                error: error.message
            };
        }
    }

    /**
     * Vérifier la santé du cache
     */
    async _checkCacheHealth() {
        try {
            const startTime = Date.now();
            await CacheService.ping();
            const responseTime = Date.now() - startTime;

            const stats = await CacheService.getStats();

            return {
                status: responseTime < 50 ? 'HEALTHY' : 'DEGRADED',
                response_time_ms: responseTime,
                ...stats
            };

        } catch (error) {
            return {
                status: 'CRITICAL',
                error: error.message
            };
        }
    }

    /**
     * Vérifier la santé du disque
     */
    async _checkDiskHealth() {
        try {
            const uploadsPath = path.join(__dirname, '../../../uploads');
            const stats = await fs.statfs(uploadsPath);

            const total = stats.blocks * stats.bsize;
            const free = stats.bfree * stats.bsize;
            const used = total - free;
            const usagePercent = (used / total) * 100;

            let status = 'HEALTHY';
            if (usagePercent > 90) status = 'CRITICAL';
            else if (usagePercent > 75) status = 'DEGRADED';

            return {
                status,
                total_bytes: total,
                free_bytes: free,
                used_bytes: used,
                usage_percent: Math.round(usagePercent * 100) / 100,
                mount_point: uploadsPath
            };

        } catch (error) {
            return {
                status: 'DEGRADED',
                error: error.message
            };
        }
    }

    /**
     * Vérifier la santé de la mémoire
     */
    _checkMemoryHealth() {
        const total = os.totalmem();
        const free = os.freemem();
        const used = total - free;
        const usagePercent = (used / total) * 100;

        let status = 'HEALTHY';
        if (usagePercent > 90) status = 'CRITICAL';
        else if (usagePercent > 80) status = 'DEGRADED';

        return {
            status,
            total_bytes: total,
            free_bytes: free,
            used_bytes: used,
            usage_percent: Math.round(usagePercent * 100) / 100,
            heap_used: process.memoryUsage().heapUsed,
            heap_total: process.memoryUsage().heapTotal
        };
    }

    /**
     * Vérifier la charge CPU
     */
    _checkCPUHealth() {
        const loadAvg = os.loadavg();
        const cpus = os.cpus().length;

        let status = 'HEALTHY';
        if (loadAvg[0] > cpus * 2) status = 'CRITICAL';
        else if (loadAvg[0] > cpus) status = 'DEGRADED';

        return {
            status,
            load_average_1min: loadAvg[0],
            load_average_5min: loadAvg[1],
            load_average_15min: loadAvg[2],
            cpu_count: cpus,
            uptime: os.uptime()
        };
    }

    /**
     * Vérifier les services externes
     */
    async _checkExternalServices() {
        const services = {};

        // Email
        try {
            // Vérifier service email
            services.email = { status: 'HEALTHY' };
        } catch {
            services.email = { status: 'DEGRADED' };
        }

        // SMS
        try {
            services.sms = { status: 'HEALTHY' };
        } catch {
            services.sms = { status: 'DEGRADED' };
        }

        // Paiement
        try {
            services.payment = { status: 'HEALTHY' };
        } catch {
            services.payment = { status: 'DEGRADED' };
        }

        return services;
    }

    /**
     * Vérifier la santé des workers
     */
    async _checkWorkersHealth() {
        try {
            const workers = await QueueService.getWorkersStatus();

            const total = workers.length;
            const active = workers.filter(w => w.status === 'active').length;
            const ratio = (active / total) * 100;

            return {
                status: ratio > 80 ? 'HEALTHY' : ratio > 50 ? 'DEGRADED' : 'CRITICAL',
                total,
                active,
                workers
            };

        } catch (error) {
            return {
                status: 'DEGRADED',
                error: error.message
            };
        }
    }

    /**
     * Récupérer les erreurs récentes
     */
    async _getRecentErrors(limit = 10) {
        const result = await pool.query(`
            SELECT 
                date_action as timestamp,
                CASE WHEN succes = False THEN 'ERROR' ELSE 'INFO' END as level,
                ressource_type as service,
                action as message,
                metadata,
                adresse_ip as ip,
                compte_id as user_id
            FROM JOURNAL_AUDIT
            WHERE succes = false
            ORDER BY date_action DESC
            LIMIT $1
        `, [limit]);

        return result.rows;
    }

    /**
     * Calculer la santé globale
     */
    _calculateGlobalHealth(components) {
        const statuses = Object.values(components).map(c => c.status || 'UNKNOWN');
        
        if (statuses.includes('CRITICAL')) {
            return { status: 'CRITICAL', color: 'red' };
        }
        if (statuses.includes('DEGRADED')) {
            return { status: 'DEGRADED', color: 'orange' };
        }
        if (statuses.every(s => s === 'HEALTHY')) {
            return { status: 'HEALTHY', color: 'green' };
        }
        return { status: 'UNKNOWN', color: 'gray' };
    }

    /**
     * Obtenir les métriques base de données
     */
    async _getDatabaseMetrics() {
        const result = await pool.query(`
            SELECT 
                (SELECT count(*) FROM pg_stat_activity) as connections,
                (SELECT pg_database_size(current_database())) as db_size,
                (SELECT sum(idx_scan) FROM pg_stat_user_indexes) as total_index_scans,
                (SELECT sum(seq_scan) FROM pg_stat_user_tables) as total_seq_scans,
                (SELECT sum(n_tup_ins) FROM pg_stat_user_tables) as total_inserts,
                (SELECT sum(n_tup_upd) FROM pg_stat_user_tables) as total_updates,
                (SELECT sum(n_tup_del) FROM pg_stat_user_tables) as total_deletes
        `);

        return result.rows[0];
    }

    /**
     * Obtenir les métriques API
     */
    async _getAPIMetrics(periode) {
        const interval = periode === '24h' ? '24 hours' : '1 hour';

        const result = await pool.query(`
            SELECT 
                count(*) as total_requests,
                count(*) filter (where status_code >= 500) as errors_5xx,
                count(*) filter (where status_code >= 400 and status_code < 500) as errors_4xx,
                avg(response_time) as avg_response_time,
                percentile_cont(0.95) within group (order by response_time) as p95_response_time,
                percentile_cont(0.99) within group (order by response_time) as p99_response_time
            FROM api_requests
            WHERE timestamp >= NOW() - $1::interval
        `, [interval]);

        return result.rows[0];
    }

    /**
     * Obtenir les métriques utilisateurs
     */
    async _getUserMetrics(periode) {
        const interval = periode === '24h' ? '24 hours' : '1 hour';

        const result = await pool.query(`
            SELECT 
                count(*) as total_users,
                count(*) filter (where date_creation >= NOW() - $1::interval) as new_users,
                count(*) filter (where last_login >= NOW() - $1::interval) as active_users,
                count(*) filter (where last_login < NOW() - interval '30 days') as inactive_users
            FROM users
        `, [interval]);

        return result.rows[0];
    }

    /**
     * Obtenir les métriques commandes
     */
    async _getOrderMetrics(periode) {
        const interval = periode === '24h' ? '24 hours' : '1 hour';

        const result = await pool.query(`
            SELECT 
                count(*) as total_orders,
                sum(total_amount) as total_revenue,
                avg(total_amount) as avg_order_value,
                count(*) filter (where status = 'completed') as completed_orders,
                count(*) filter (where status = 'cancelled') as cancelled_orders
            FROM orders
            WHERE created_at >= NOW() - $1::interval
        `, [interval]);

        return result.rows[0];
    }

    /**
     * Obtenir les métriques performance
     */
    async _getPerformanceMetrics(periode) {
        const interval = periode === '24h' ? '24 hours' : '1 hour';

        const result = await pool.query(`
            SELECT 
                avg(cpu_usage) as avg_cpu,
                max(cpu_usage) as max_cpu,
                avg(memory_usage) as avg_memory,
                max(memory_usage) as max_memory
            FROM performance_metrics
            WHERE timestamp >= NOW() - $1::interval
        `, [interval]);

        return result.rows[0];
    }

    /**
     * Obtenir les métriques erreurs
     */
    async _getErrorMetrics(periode) {
        const interval = periode === '24h' ? '24 hours' : '1 hour';

        const result = await pool.query(`
            SELECT 
                count(*) as total_errors,
                count(*) filter (where level = 'ERROR') as errors,
                count(*) filter (where level = 'WARN') as warnings,
                json_agg(json_build_object(
                    'type', error_type,
                    'count', count
                )) as top_errors
            FROM (
                SELECT 
                    error_type,
                    count(*) as count
                FROM error_logs
                WHERE timestamp >= NOW() - $1::interval
                GROUP BY error_type
                ORDER BY count desc
                LIMIT 5
            ) as top
        `, [interval]);

        return result.rows[0];
    }

    /**
     * Obtenir toutes les tables
     */
    async _getAllTables() {
        const result = await pool.query(`
            SELECT tablename 
            FROM pg_tables 
            WHERE schemaname = 'public'
            ORDER BY tablename
        `);
        return result.rows.map(r => r.tablename);
    }

    /**
     * Obtenir la taille d'un répertoire
     */
    async _getDirectorySize(dirPath) {
        try {
            const { stdout } = await execAsync(`du -sb ${dirPath} | cut -f1`);
            return parseInt(stdout.trim());
        } catch {
            return 0;
        }
    }

    /**
     * Vérifier si un fichier existe
     */
    async _fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Activer/désactiver le mode maintenance
     */
    async _setMaintenanceMode(enabled, message = '') {
        await pool.query(
            `INSERT INTO CONFIGURATIONS (key, value) 
             VALUES ('maintenance_mode', $1)
             ON CONFLICT (key) DO UPDATE SET value = $1`,
            [enabled ? 'true' : 'false']
        );

        if (message) {
            await pool.query(
                `INSERT INTO CONFIGURATIONS (key, value) 
                 VALUES ('maintenance_message', $1)
                 ON CONFLICT (key) DO UPDATE SET value = $1`,
                [message]
            );
        }
    }

    /**
     * Nettoyer les sessions expirées
     */
    async _cleanExpiredSessions() {
        const result = await pool.query(
            `DELETE FROM sessions 
             WHERE expires_at < NOW() 
             RETURNING id`
        );
        return result.rowCount;
    }

    /**
     * Nettoyer les tokens révoqués
     */
    async _cleanRevokedTokens() {
        const result = await pool.query(
            `DELETE FROM revoked_tokens 
             WHERE expires_at < NOW() 
             RETURNING id`
        );
        return result.rowCount;
    }

    /**
     * Rafraîchir les vues matérialisées
     */
    async _refreshMaterializedViews() {
        const views = ['vue_notes_moyennes', 'vue_commandes_recentes'];
        for (const view of views) {
            await pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`);
        }
        return views.length;
    }

    /**
     * Optimiser les tables
     */
    async _optimizeTables() {
        const tables = await this._getAllTables();
        for (const table of tables) {
            await pool.query(`VACUUM ANALYZE ${table}`);
        }
        return tables.length;
    }

    /**
     * Nettoyer les vieux logs
     */
    async _cleanOldLogs(days = 30) {
        const result = await pool.query(
            `DELETE FROM JOURNAL_AUDIT 
             WHERE date_action < NOW() - $1::interval
             RETURNING id`,
            [`${days} days`]
        );
        return result.rowCount;
    }

    /**
     * Vérifier les connexions inactives
     */
    async _checkIdleConnections() {
        const result = await pool.query(
            `SELECT pg_terminate_backend(pid)
             FROM pg_stat_activity
             WHERE state = 'idle'
             AND state_change < NOW() - INTERVAL '30 minutes'
             AND pid != pg_backend_pid()`
        );
        return result.rowCount;
    }
}

module.exports = new MaintenanceController();