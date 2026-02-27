// src/routes/v1/admin.routes.js
/**
 * Routes d'administration de la plateforme
 * API pour la gestion complète de l'administration : configuration, dashboard, maintenance, modération et rétention
 * Accès réservé aux administrateurs (ADMINISTRATEUR_PLATEFORME) et modérateurs
 */
const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const validationMiddleware = require('../middlewares/validation.middleware');
const cacheMiddleware = require('../middlewares/cache.middleware');

const ConfigurationController = require('../../controllers/admin/ConfigurationController');
const DashboardController = require('../../controllers/admin/DashboardController');
const MaintenanceController = require('../../controllers/admin/MaintenanceController');
const ModerationController = require('../../controllers/admin/ModerationController');
const RetentionController = require('../../controllers/admin/RetentionController');

// ==================== AUTHENTIFICATION ET RÔLES ====================
// Toutes les routes d'administration nécessitent une authentification
// et le rôle ADMINISTRATEUR_PLATEFORME (sauf mention contraire)
router.use(authMiddleware.authenticate);
router.use(roleMiddleware.isAdmin());

// ==================== I. CONFIGURATION ====================
// Gestion des configurations système et paramètres

/**
 * GET /api/v1/admin/configurations
 * Récupérer toutes les configurations
 * Query: entite_type, entite_id, categorie
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, data, count }
 */
router.get('/configurations',
    validationMiddleware.validate([
        query('entite_type').optional().trim(),
        query('entite_id').optional().isInt(),
        query('categorie').optional().trim()
    ]),
    ConfigurationController.findAll.bind(ConfigurationController)
);

/**
 * GET /api/v1/admin/configurations/:cle
 * Récupérer une configuration par clé
 * Params: cle (string)
 * Query: entite_type=PLATEFORME, entite_id=1
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, data: { configuration_avec_valeur_parsee } }
 */
router.get('/configurations/:cle',
    validationMiddleware.validate([
        param('cle').notEmpty().trim(),
        query('entite_type').optional().trim(),
        query('entite_id').optional().isInt()
    ]),
    ConfigurationController.findByKey.bind(ConfigurationController)
);

/**
 * GET /api/v1/admin/configurations/system
 * Récupérer les configurations système
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, data: { nom_plateforme, version, environnement, maintenance_mode, fonctionnalites } }
 */
router.get('/configurations/system',
    ConfigurationController.getSystemConfig.bind(ConfigurationController)
);

/**
 * POST /api/v1/admin/configurations
 * Créer ou mettre à jour une configuration
 * Body: { 
 *   entite_type?, entite_id?, cle, valeur, 
 *   type_valeur? (TEXT, INTEGER, DECIMAL, BOOLEAN, JSON), 
 *   description?, est_public? 
 * }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, data, message }
 */
router.post('/configurations',
    validationMiddleware.validate([
        body('entite_type').optional().trim(),
        body('entite_id').optional().isInt(),
        body('cle').notEmpty().trim(),
        body('valeur').notEmpty(),
        body('type_valeur').optional().isIn(['TEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'JSON']),
        body('description').optional().trim(),
        body('est_public').optional().isBoolean()
    ]),
    ConfigurationController.createOrUpdate.bind(ConfigurationController)
);

/**
 * POST /api/v1/admin/configurations/batch
 * Récupérer plusieurs configurations par lot
 * Body: { cles: [string], entite_type?, entite_id? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, data: { cle: valeur, ... } }
 */
router.post('/configurations/batch',
    validationMiddleware.validate([
        body('cles').isArray().notEmpty(),
        body('cles.*').isString(),
        body('entite_type').optional().trim(),
        body('entite_id').optional().isInt()
    ]),
    ConfigurationController.getBatch.bind(ConfigurationController)
);

/**
 * POST /api/v1/admin/configurations/maintenance
 * Activer/désactiver le mode maintenance
 * Body: { enabled: boolean, message?: string }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, message, data: { enabled, message } }
 */
router.post('/configurations/maintenance',
    validationMiddleware.validate([
        body('enabled').isBoolean(),
        body('message').optional().trim()
    ]),
    ConfigurationController.toggleMaintenance.bind(ConfigurationController)
);

/**
 * DELETE /api/v1/admin/configurations/:id
 * Supprimer une configuration
 * Params: id (entier)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, message }
 */
router.delete('/configurations/:id',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ConfigurationController.delete.bind(ConfigurationController)
);

// ==================== II. DASHBOARD ====================
// Tableaux de bord et statistiques

/**
 * GET /api/v1/admin/dashboard/stats
 * Récupérer les statistiques globales de la plateforme
 * Query: periode=30j (24h, 7j, 30j, 90j, an, personnalise), date_debut?, date_fin?
 * Auth: Bearer <token> + ADMIN
 * Cache: 5 minutes
 * Réponse: { status, data: { comptes, commandes, boutiques, restaurants, transport, blog, financier, evolution, top_boutiques, alertes } }
 */
router.get('/dashboard/stats',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('periode').optional().isIn(['24h', '7j', '30j', '90j', 'an', 'personnalise']),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601()
    ]),
    DashboardController.getGlobalStats.bind(DashboardController)
);

/**
 * GET /api/v1/admin/dashboard/realtime
 * Récupérer les KPIs en temps réel
 * Auth: Bearer <token> + ADMIN
 * Cache: 30 secondes
 * Réponse: { status, data: { inscriptions_heure, commandes_heure, ca_heure, utilisateurs_connectes, livraisons_en_cours, taches_en_cours, alertes_heure } }
 */
router.get('/dashboard/realtime',
    cacheMiddleware.cache(30), // 30 secondes
    DashboardController.getRealtimeKPIs.bind(DashboardController)
);

/**
 * GET /api/v1/admin/dashboard/charts
 * Récupérer les graphiques d'évolution
 * Query: type=commandes (commandes, inscriptions, revenus, activite), periode=30j
 * Auth: Bearer <token> + ADMIN
 * Cache: 10 minutes
 * Réponse: { status, data: { type, periode, data } }
 */
router.get('/dashboard/charts',
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        query('type').optional().isIn(['commandes', 'inscriptions', 'revenus', 'activite']),
        query('periode').optional().isIn(['7j', '30j', '90j'])
    ]),
    DashboardController.getCharts.bind(DashboardController)
);

/**
 * GET /api/v1/admin/dashboard/export
 * Exporter un rapport
 * Query: type=complet (complet, financier, activite), format=pdf (pdf, excel, csv), date_debut?, date_fin?
 * Auth: Bearer <token> + ADMIN
 * Réponse: Fichier exporté (PDF, Excel ou CSV)
 */
router.get('/dashboard/export',
    validationMiddleware.validate([
        query('type').optional().isIn(['complet', 'financier', 'activite']),
        query('format').optional().isIn(['pdf', 'excel', 'csv']),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601()
    ]),
    DashboardController.exportReport.bind(DashboardController)
);

// ==================== III. MAINTENANCE ====================
// Santé du système, logs, cache, jobs, base de données, backups, alertes

/**
 * GET /api/v1/admin/maintenance/health
 * Récupérer l'état de santé du système
 * Auth: Bearer <token> + ADMIN
 * Cache: 1 minute
 * Réponse: { status, data: { global, components, recent_errors, uptime } }
 */
router.get('/maintenance/health',
    cacheMiddleware.cache(60), // 1 minute
    MaintenanceController.getSystemHealth.bind(MaintenanceController)
);

/**
 * GET /api/v1/admin/maintenance/metrics
 * Récupérer les métriques détaillées
 * Query: periode=1h
 * Auth: Bearer <token> + ADMIN
 * Cache: 30 secondes
 * Réponse: { status, data: { database, api, users, orders, performance, errors } }
 */
router.get('/maintenance/metrics',
    cacheMiddleware.cache(30), // 30 secondes
    validationMiddleware.validate([
        query('periode').optional().isIn(['1h', '24h', '7d'])
    ]),
    MaintenanceController.getMetrics.bind(MaintenanceController)
);

/**
 * GET /api/v1/admin/maintenance/logs
 * Récupérer les logs système
 * Query: level=all, service=api, limit=100, offset=0, date_debut?, date_fin?, search?
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, data, pagination, statistiques }
 */
router.get('/maintenance/logs',
    validationMiddleware.validate([
        query('level').optional().isIn(['all', 'ERROR', 'WARN', 'INFO', 'DEBUG']),
        query('service').optional().trim(),
        query('limit').optional().isInt({ min: 1, max: 1000 }),
        query('offset').optional().isInt({ min: 0 }),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601(),
        query('search').optional().trim()
    ]),
    MaintenanceController.getLogs.bind(MaintenanceController)
);

/**
 * GET /api/v1/admin/maintenance/logs/realtime
 * Obtenir les logs en temps réel (Server-Sent Events)
 * Query: level=all
 * Auth: Bearer <token> + ADMIN
 * Réponse: Stream SSE des logs en temps réel
 */
router.get('/maintenance/logs/realtime',
    validationMiddleware.validate([
        query('level').optional().isIn(['all', 'ERROR', 'WARN', 'INFO', 'DEBUG'])
    ]),
    MaintenanceController.getRealtimeLogs.bind(MaintenanceController)
);

/**
 * POST /api/v1/admin/maintenance/cache/clean
 * Nettoyer le cache
 * Body: { pattern? } (défaut: '*')
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, message, data: { pattern, deleted_keys, duration_ms } }
 */
router.post('/maintenance/cache/clean',
    validationMiddleware.validate([
        body('pattern').optional().trim()
    ]),
    MaintenanceController.cleanCache.bind(MaintenanceController)
);

/**
 * GET /api/v1/admin/maintenance/cache/stats
 * Obtenir les statistiques du cache
 * Auth: Bearer <token> + ADMIN
 * Cache: 1 minute
 * Réponse: { status, data: { keys, hit_rate, memory_usage, top_keys, prefixes } }
 */
router.get('/maintenance/cache/stats',
    cacheMiddleware.cache(60), // 1 minute
    MaintenanceController.getCacheStats.bind(MaintenanceController)
);

/**
 * GET /api/v1/admin/maintenance/jobs
 * Obtenir les tâches planifiées
 * Query: status=all
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, data, statistiques }
 */
router.get('/maintenance/jobs',
    validationMiddleware.validate([
        query('status').optional().isIn(['all', 'EN_ATTENTE', 'EN_COURS', 'TERMINEE', 'ECHOUEE', 'ABANDONNEE'])
    ]),
    MaintenanceController.getScheduledJobs.bind(MaintenanceController)
);

/**
 * POST /api/v1/admin/maintenance/jobs/:id/retry
 * Relancer une tâche échouée
 * Params: id (entier)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, message }
 */
router.post('/maintenance/jobs/:id/retry',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    MaintenanceController.retryJob.bind(MaintenanceController)
);

/**
 * POST /api/v1/admin/maintenance/jobs/:id/cancel
 * Annuler une tâche
 * Params: id (entier)
 * Body: { raison? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, message }
 */
router.post('/maintenance/jobs/:id/cancel',
    validationMiddleware.validate([
        param('id').isInt(),
        body('raison').optional().trim()
    ]),
    MaintenanceController.cancelJob.bind(MaintenanceController)
);

/**
 * GET /api/v1/admin/maintenance/db/performance
 * Obtenir les performances de la base de données
 * Auth: Bearer <token> + ADMIN
 * Cache: 5 minutes
 * Réponse: { status, data: { slow_queries, table_sizes, unused_indexes, connections } }
 */
router.get('/maintenance/db/performance',
    cacheMiddleware.cache(300), // 5 minutes
    MaintenanceController.getDatabasePerformance.bind(MaintenanceController)
);

/**
 * POST /api/v1/admin/maintenance/db/optimize
 * Optimiser les tables
 * Body: { tables?, vacuum=true, analyze=true, reindex=false }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, message, data: { tables_traitees, details } }
 */
router.post('/maintenance/db/optimize',
    validationMiddleware.validate([
        body('tables').optional().isArray(),
        body('tables.*').isString(),
        body('vacuum').optional().isBoolean(),
        body('analyze').optional().isBoolean(),
        body('reindex').optional().isBoolean()
    ]),
    MaintenanceController.optimizeDatabase.bind(MaintenanceController)
);

/**
 * POST /api/v1/admin/maintenance/backup
 * Créer une sauvegarde
 * Body: { type='full', tables?, description? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, message, data: { path, type, tables, files, size, description } }
 */
router.post('/maintenance/backup',
    validationMiddleware.validate([
        body('type').optional().isIn(['full', 'partial']),
        body('tables').optional().isArray(),
        body('tables.*').isString(),
        body('description').optional().trim()
    ]),
    MaintenanceController.createBackup.bind(MaintenanceController)
);

/**
 * GET /api/v1/admin/maintenance/backups
 * Récupérer la liste des sauvegardes
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, data: [{ backup }] }
 */
router.get('/maintenance/backups',
    MaintenanceController.getBackups.bind(MaintenanceController)
);

/**
 * POST /api/v1/admin/maintenance/backups/:id/restore
 * Restaurer une sauvegarde
 * Params: id (entier)
 * Body: { tables?, force? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, message }
 */
router.post('/maintenance/backups/:id/restore',
    validationMiddleware.validate([
        param('id').isInt(),
        body('tables').optional().isArray(),
        body('tables.*').isString(),
        body('force').optional().isBoolean()
    ]),
    MaintenanceController.restoreBackup.bind(MaintenanceController)
);

/**
 * POST /api/v1/admin/maintenance/backups/clean
 * Nettoyer les anciennes sauvegardes
 * Body: { keep_days=30 }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, message, data: { supprimees, erreurs } }
 */
router.post('/maintenance/backups/clean',
    validationMiddleware.validate([
        body('keep_days').optional().isInt({ min: 1, max: 365 })
    ]),
    MaintenanceController.cleanOldBackups.bind(MaintenanceController)
);

/**
 * GET /api/v1/admin/maintenance/alerts
 * Obtenir les alertes système
 * Query: severity=all, resolved=false
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, data, statistiques }
 */
router.get('/maintenance/alerts',
    validationMiddleware.validate([
        query('severity').optional().isIn(['all', 'CRITIQUE', 'ELEVE', 'MOYEN', 'BASSE']),
        query('resolved').optional().isBoolean()
    ]),
    MaintenanceController.getSystemAlerts.bind(MaintenanceController)
);

/**
 * POST /api/v1/admin/maintenance/alerts/:id/resolve
 * Résoudre une alerte
 * Params: id (entier)
 * Body: { action_prise? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, message }
 */
router.post('/maintenance/alerts/:id/resolve',
    validationMiddleware.validate([
        param('id').isInt(),
        body('action_prise').optional().trim()
    ]),
    MaintenanceController.resolveAlert.bind(MaintenanceController)
);

/**
 * POST /api/v1/admin/maintenance/run-task/:taskName
 * Exécuter une tâche de maintenance planifiée
 * Params: taskName (clean-sessions, clean-tokens, refresh-views, optimize-tables, clean-logs, check-connections)
 * Body: { params? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, message, data: { job_id } }
 */
router.post('/maintenance/run-task/:taskName',
    validationMiddleware.validate([
        param('taskName').isIn([
            'clean-sessions', 'clean-tokens', 'refresh-views', 
            'optimize-tables', 'clean-logs', 'check-connections'
        ]),
        body('params').optional().isObject()
    ]),
    MaintenanceController.runMaintenanceTask.bind(MaintenanceController)
);

// ==================== IV. MODÉRATION ====================
// Gestion de la modération des contenus

/**
 * GET /api/v1/admin/moderation/queue
 * Récupérer tous les contenus à modérer
 * Query: type=all, page=1, limit=20, statut=EN_ATTENTE, priorite
 * Auth: Bearer <token> + ADMIN ou MODERATEUR
 * Réponse: { status, data, statistiques, pagination }
 */
router.get('/moderation/queue',
    roleMiddleware.isModerator(),
    validationMiddleware.validate([
        query('type').optional().isIn(['all', 'articles', 'commentaires', 'avis', 'signalements']),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('statut').optional().isIn(['EN_ATTENTE', 'TRAITE']),
        query('priorite').optional().isIn(['CRITIQUE', 'HAUTE', 'NORMALE', 'BASSE'])
    ]),
    ModerationController.getModerationQueue.bind(ModerationController)
);

/**
 * GET /api/v1/admin/moderation/stats
 * Récupérer les statistiques de modération
 * Query: periode=30j
 * Auth: Bearer <token> + ADMIN ou MODERATEUR
 * Cache: 10 minutes
 * Réponse: { status, data: { articles_attente, commentaires_attente, avis_attente, signalements, temps_moyen_moderation } }
 */
router.get('/moderation/stats',
    roleMiddleware.isModerator(),
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        query('periode').optional().isIn(['7j', '30j'])
    ]),
    ModerationController.getModerationStats.bind(ModerationController)
);

/**
 * POST /api/v1/admin/moderation/articles/:id
 * Modérer un article
 * Params: id (entier)
 * Body: { action: PUBLIE|REJETE|MASQUE, commentaire? }
 * Auth: Bearer <token> + ADMIN ou MODERATEUR
 * Réponse: { status, message }
 */
router.post('/moderation/articles/:id',
    roleMiddleware.isModerator(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('action').isIn(['PUBLIE', 'REJETE', 'MASQUE']),
        body('commentaire').optional().trim()
    ]),
    ModerationController.modererArticle.bind(ModerationController)
);

/**
 * POST /api/v1/admin/moderation/commentaires/:id
 * Modérer un commentaire
 * Params: id (entier)
 * Body: { action: APPROUVE|REJETE|SUPPRIME|MASQUE, commentaire? }
 * Auth: Bearer <token> + ADMIN ou MODERATEUR
 * Réponse: { status, message }
 */
router.post('/moderation/commentaires/:id',
    roleMiddleware.isModerator(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('action').isIn(['APPROUVE', 'REJETE', 'SUPPRIME', 'MASQUE']),
        body('commentaire').optional().trim()
    ]),
    ModerationController.modererCommentaire.bind(ModerationController)
);

/**
 * POST /api/v1/admin/moderation/avis/:id
 * Modérer un avis
 * Params: id (entier)
 * Body: { action: PUBLIE|REJETE|MASQUE, commentaire? }
 * Auth: Bearer <token> + ADMIN ou MODERATEUR
 * Réponse: { status, message }
 */
router.post('/moderation/avis/:id',
    roleMiddleware.isModerator(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('action').isIn(['PUBLIE', 'REJETE', 'MASQUE']),
        body('commentaire').optional().trim()
    ]),
    ModerationController.modererAvis.bind(ModerationController)
);

/**
 * POST /api/v1/admin/moderation/signalements/:type/:id
 * Traiter un signalement
 * Params: type (article|commentaire), id (entier)
 * Body: { action: TRAITE|REJETE, commentaire? }
 * Auth: Bearer <token> + ADMIN ou MODERATEUR
 * Réponse: { status, message }
 */
router.post('/moderation/signalements/:type/:id',
    roleMiddleware.isModerator(),
    validationMiddleware.validate([
        param('type').isIn(['article', 'commentaire']),
        param('id').isInt(),
        body('action').isIn(['TRAITE', 'REJETE']),
        body('commentaire').optional().trim()
    ]),
    ModerationController.traiterSignalement.bind(ModerationController)
);

// ==================== V. RÉTENTION DES DONNÉES ====================
// Gestion des politiques de rétention et nettoyage

/**
 * GET /api/v1/admin/retention/policies
 * Récupérer toutes les politiques de rétention
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, data: { politiques, statistiques, estimations, total_politiques, actives } }
 */
router.get('/retention/policies',
    RetentionController.getPolicies.bind(RetentionController)
);

/**
 * GET /api/v1/admin/retention/policies/:id
 * Récupérer une politique par ID
 * Params: id (entier)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, data: { politique, historique_executions } }
 */
router.get('/retention/policies/:id',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    RetentionController.getPolicyById.bind(RetentionController)
);

/**
 * POST /api/v1/admin/retention/policies
 * Créer une nouvelle politique de rétention
 * Body: { 
 *   table_cible, duree_retention_jours, 
 *   champ_date? (défaut: date_creation), 
 *   action_expiration? (SUPPRIMER|ANONYMISER|ARCHIVER, défaut: ANONYMISER)
 * }
 * Auth: Bearer <token> + ADMIN
 * Réponse: 201 { status, data, estimation, message }
 */
router.post('/retention/policies',
    validationMiddleware.validate([
        body('table_cible').notEmpty().trim(),
        body('duree_retention_jours').isInt({ min: 1, max: 3650 }),
        body('champ_date').optional().trim(),
        body('action_expiration').optional().isIn(['SUPPRIMER', 'ANONYMISER', 'ARCHIVER'])
    ]),
    RetentionController.createPolicy.bind(RetentionController)
);

/**
 * PUT /api/v1/admin/retention/policies/:id
 * Mettre à jour une politique
 * Params: id (entier)
 * Body: { duree_retention_jours?, action_expiration?, est_active? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, data, estimation, message }
 */
router.put('/retention/policies/:id',
    validationMiddleware.validate([
        param('id').isInt(),
        body('duree_retention_jours').optional().isInt({ min: 1, max: 3650 }),
        body('action_expiration').optional().isIn(['SUPPRIMER', 'ANONYMISER', 'ARCHIVER']),
        body('est_active').optional().isBoolean()
    ]),
    RetentionController.updatePolicy.bind(RetentionController)
);

/**
 * PATCH /api/v1/admin/retention/policies/:id/toggle
 * Activer/Désactiver une politique
 * Params: id (entier)
 * Body: { actif: boolean }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, data, message }
 */
router.patch('/retention/policies/:id/toggle',
    validationMiddleware.validate([
        param('id').isInt(),
        body('actif').isBoolean()
    ]),
    RetentionController.togglePolicy.bind(RetentionController)
);

/**
 * DELETE /api/v1/admin/retention/policies/:id
 * Supprimer une politique
 * Params: id (entier)
 * Body: { force? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, message }
 */
router.delete('/retention/policies/:id',
    validationMiddleware.validate([
        param('id').isInt(),
        body('force').optional().isBoolean()
    ]),
    RetentionController.deletePolicy.bind(RetentionController)
);

/**
 * POST /api/v1/admin/retention/clean/:table
 * Exécuter le nettoyage pour une table spécifique
 * Params: table (string)
 * Query: simulate=false, force=false
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, data, message }
 */
router.post('/retention/clean/:table',
    validationMiddleware.validate([
        param('table').notEmpty().trim(),
        query('simulate').optional().isBoolean(),
        query('force').optional().isBoolean()
    ]),
    RetentionController.cleanTable.bind(RetentionController)
);

/**
 * POST /api/v1/admin/retention/clean-all
 * Exécuter le nettoyage pour toutes les tables
 * Query: simulate=false
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, data: { total_politiques, succes, echecs, details, erreurs }, message }
 */
router.post('/retention/clean-all',
    validationMiddleware.validate([
        query('simulate').optional().isBoolean()
    ]),
    RetentionController.cleanAll.bind(RetentionController)
);

/**
 * GET /api/v1/admin/retention/stats
 * Obtenir les statistiques de rétention
 * Auth: Bearer <token> + ADMIN
 * Cache: 30 minutes
 * Réponse: { status, data: { politiques, economies_estimees, alertes_conformite, resume } }
 */
router.get('/retention/stats',
    cacheMiddleware.cache(1800), // 30 minutes
    RetentionController.getRetentionStats.bind(RetentionController)
);

/**
 * POST /api/v1/admin/retention/schedule
 * Planifier un nettoyage automatique
 * Body: { frequence: hourly|daily|weekly|monthly, heure: '02:00', tables? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, message, data: { frequence, heure, tables } }
 */
router.post('/retention/schedule',
    validationMiddleware.validate([
        body('frequence').isIn(['hourly', 'daily', 'weekly', 'monthly']),
        body('heure').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        body('tables').optional().isArray()
    ]),
    RetentionController.scheduleCleanup.bind(RetentionController)
);

/**
 * GET /api/v1/admin/retention/history
 * Obtenir l'historique des nettoyages
 * Query: page=1, limit=20, table?, date_debut?, date_fin?
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, data, pagination, statistiques }
 */
router.get('/retention/history',
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('table').optional().trim(),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601()
    ]),
    RetentionController.getCleanupHistory.bind(RetentionController)
);

module.exports = router;