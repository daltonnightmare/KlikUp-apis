// src/routes/v1/historique.routes.js
/**
 * Routes de gestion de l'historique et de l'audit
 * API pour la consultation de l'historique des actions, transactions, journal d'audit et politiques de rétention
 * Accès restreint selon les rôles (principalement ADMIN)
 */
const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const rateLimit = require('express-rate-limit');

const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const validationMiddleware = require('../middlewares/validation.middleware');
const cacheMiddleware = require('../middlewares/cache.middleware');
const rateLimiter = require('../middlewares/rateLimiter.middleware');

const HistoriqueActionController = require('../../controllers/historique/HistoriqueActionController');
const HistoriqueTransactionController = require('../../controllers/historique/HistoriqueTransactionController');
const JournalAuditController = require('../../controllers/historique/JournalAuditController');
const PolitiqueRetentionController = require('../../controllers/historique/PolitiqueRetentionController');

// ==================== CONFIGURATION RATE LIMITING ====================

const exportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 5, // 5 exports max par heure
    message: 'Trop d\'exports. Réessayez plus tard.',
    standardHeaders: true,
    legacyHeaders: false
});

// ==================== I. HISTORIQUE DES ACTIONS ====================

/**
 * GET /api/v1/historique/actions
 * Récupérer l'historique des actions avec filtres
 * Headers: Authorization: Bearer <token>
 * Query: page=1, limit=50, action_type?, table_concernee?, utilisateur_id?,
 *        entite_id?, date_debut?, date_fin?, tri=date_desc
 * Auth: ADMIN
 * Cache: 2 minutes
 * Réponse: { success, data: { actions, agregation }, pagination }
 */
router.get('/actions',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 200 }),
        query('action_type').optional().trim(),
        query('table_concernee').optional().trim(),
        query('utilisateur_id').optional().isInt(),
        query('entite_id').optional().isInt(),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601(),
        query('tri').optional().isIn(['date_desc', 'date_asc', 'utilisateur', 'table'])
    ]),
    HistoriqueActionController.findAll.bind(HistoriqueActionController)
);

/**
 * GET /api/v1/historique/actions/stats
 * Statistiques globales de l'historique
 * Headers: Authorization: Bearer <token>
 * Query: periode=30d
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { success, data: { global, repartition_types, top_tables, activite_horaire, evolution } }
 */
router.get('/actions/stats',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('periode').optional().isIn(['24h', '7d', '30d', '1y'])
    ]),
    HistoriqueActionController.getStats.bind(HistoriqueActionController)
);

/**
 * GET /api/v1/historique/actions/:id
 * Récupérer les détails d'une action spécifique
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: ADMIN
 * Réponse: { success, data: action_avec_changements }
 */
router.get('/actions/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    HistoriqueActionController.findOne.bind(HistoriqueActionController)
);

/**
 * GET /api/v1/historique/entite/:table/:id
 * Récupérer l'historique d'une entité spécifique
 * Headers: Authorization: Bearer <token>
 * Params: table, id
 * Query: page=1, limit=50
 * Auth: ADMIN
 * Cache: 2 minutes
 * Réponse: { success, data: timeline, pagination }
 */
router.get('/entite/:table/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        param('table').notEmpty(),
        param('id').isInt(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 })
    ]),
    HistoriqueActionController.getEntityHistory.bind(HistoriqueActionController)
);

/**
 * GET /api/v1/historique/utilisateur/:userId
 * Récupérer l'historique d'un utilisateur
 * Headers: Authorization: Bearer <token>
 * Params: userId
 * Query: page=1, limit=50, date_debut?, date_fin?
 * Auth: ADMIN
 * Cache: 2 minutes
 * Réponse: { success, data: { actions, statistiques }, pagination }
 */
router.get('/utilisateur/:userId',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        param('userId').isInt(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601()
    ]),
    HistoriqueActionController.getUserHistory.bind(HistoriqueActionController)
);

/**
 * GET /api/v1/historique/export
 * Exporter l'historique en CSV/Excel
 * Headers: Authorization: Bearer <token>
 * Query: format=csv, date_debut?, date_fin?, action_type?, table_concernee?
 * Rate limit: 5 par heure
 * Auth: ADMIN
 * Réponse: Fichier exporté
 */
router.get('/export',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    exportLimiter,
    validationMiddleware.validate([
        query('format').optional().isIn(['csv', 'excel']),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601(),
        query('action_type').optional().trim(),
        query('table_concernee').optional().trim()
    ]),
    HistoriqueActionController.export.bind(HistoriqueActionController)
);

/**
 * DELETE /api/v1/historique/nettoyer
 * Nettoyer l'historique selon les politiques de rétention
 * Headers: Authorization: Bearer <token>
 * Auth: ADMIN
 * Réponse: { success, message, data }
 */
router.delete('/nettoyer',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    HistoriqueActionController.nettoyer.bind(HistoriqueActionController)
);

// ==================== II. HISTORIQUE DES TRANSACTIONS ====================

/**
 * GET /api/v1/historique/transactions
 * Récupérer l'historique des transactions
 * Headers: Authorization: Bearer <token>
 * Query: page=1, limit=50, type_transaction?, statut_transaction?,
 *        compte_source_id?, compte_destination_id?, date_debut?, date_fin?,
 *        montant_min?, montant_max?, tri=date_desc
 * Auth: ADMIN
 * Cache: 2 minutes
 * Réponse: { success, data: { transactions, agregation }, pagination }
 */
router.get('/transactions',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 200 }),
        query('type_transaction').optional().trim(),
        query('statut_transaction').optional().trim(),
        query('compte_source_id').optional().isInt(),
        query('compte_destination_id').optional().isInt(),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601(),
        query('montant_min').optional().isFloat({ min: 0 }),
        query('montant_max').optional().isFloat({ min: 0 }),
        query('tri').optional().isIn(['date_desc', 'date_asc', 'montant_desc', 'montant_asc', 'statut'])
    ]),
    HistoriqueTransactionController.findAll.bind(HistoriqueTransactionController)
);

/**
 * GET /api/v1/historique/transactions/stats
 * Statistiques des transactions
 * Headers: Authorization: Bearer <token>
 * Query: periode=30d, group_by=jour
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { success, data: { globaux, evolution, par_type, par_statut, top_sources, top_destinations } }
 */
router.get('/transactions/stats',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('periode').optional().isIn(['24h', '7d', '30d', '1y']),
        query('group_by').optional().isIn(['heure', 'jour', 'semaine', 'mois'])
    ]),
    HistoriqueTransactionController.getStats.bind(HistoriqueTransactionController)
);

/**
 * GET /api/v1/historique/transactions/compte/:compteId
 * Récupérer les transactions d'un compte spécifique
 * Headers: Authorization: Bearer <token>
 * Params: compteId
 * Query: page=1, limit=50, type_transaction?, statut_transaction?,
 *        date_debut?, date_fin?, sens=tous
 * Auth: ADMIN
 * Cache: 2 minutes
 * Réponse: { success, data: { transactions, totaux }, pagination }
 */
router.get('/transactions/compte/:compteId',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        param('compteId').isInt(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('type_transaction').optional().trim(),
        query('statut_transaction').optional().trim(),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601(),
        query('sens').optional().isIn(['tous', 'entrant', 'sortant'])
    ]),
    HistoriqueTransactionController.findByCompte.bind(HistoriqueTransactionController)
);

/**
 * GET /api/v1/historique/transactions/entite/:type/:id
 * Récupérer le journal des transactions par entité
 * Headers: Authorization: Bearer <token>
 * Params: type, id
 * Query: page=1, limit=50
 * Auth: ADMIN
 * Cache: 2 minutes
 * Réponse: { success, data, pagination }
 */
router.get('/transactions/entite/:type/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        param('type').isIn(['compagnie', 'restaurant', 'boutique', 'plateforme']),
        param('id').isInt(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 })
    ]),
    HistoriqueTransactionController.findByEntity.bind(HistoriqueTransactionController)
);

/**
 * GET /api/v1/historique/transactions/uuid/:uuid
 * Récupérer une transaction par son UUID
 * Headers: Authorization: Bearer <token>
 * Params: uuid
 * Auth: ADMIN
 * Réponse: { success, data: transaction_avec_details }
 */
router.get('/transactions/uuid/:uuid',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('uuid').isUUID()
    ]),
    HistoriqueTransactionController.findByUUID.bind(HistoriqueTransactionController)
);

/**
 * POST /api/v1/historique/transactions
 * Créer une nouvelle transaction (utilisation interne)
 * Headers: Authorization: Bearer <token>
 * Body: {
 *   type_transaction, montant, devise='XOF', compte_source_id?, compte_destination_id?,
 *   compagnie_id?, emplacement_id?, restaurant_id?, boutique_id?, plateforme_id?,
 *   commande_rff_id?, commande_boutique_id?, description?, metadata?
 * }
 * Auth: ADMIN
 * Réponse: 201 { success, data, message }
 */
router.post('/transactions',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        body('type_transaction').notEmpty(),
        body('montant').isFloat({ min: 0.01 }),
        body('devise').optional().isIn(['XOF', 'XAF', 'EUR', 'USD']),
        body('compte_source_id').optional().isInt(),
        body('compte_destination_id').optional().isInt(),
        body('compagnie_id').optional().isInt(),
        body('emplacement_id').optional().isInt(),
        body('restaurant_id').optional().isInt(),
        body('boutique_id').optional().isInt(),
        body('plateforme_id').optional().isInt(),
        body('commande_rff_id').optional().isInt(),
        body('commande_boutique_id').optional().isInt(),
        body('description').optional().trim(),
        body('metadata').optional().isObject(),
        body().custom(body => {
            if (!body.compte_source_id && !body.compte_destination_id && 
                !body.compagnie_id && !body.restaurant_id && !body.boutique_id && !body.plateforme_id) {
                throw new Error('Au moins une entité source/destination requise');
            }
            return true;
        })
    ]),
    HistoriqueTransactionController.create.bind(HistoriqueTransactionController)
);

/**
 * PATCH /api/v1/historique/transactions/:id/statut
 * Mettre à jour le statut d'une transaction
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { statut_transaction, description? }
 * Auth: ADMIN
 * Réponse: { success, data, message }
 */
router.patch('/transactions/:id/statut',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('statut_transaction').isIn(['EN_ATTENTE', 'COMPLETEE', 'ECHOUEE', 'ANNULEE']),
        body('description').optional().trim()
    ]),
    HistoriqueTransactionController.updateStatut.bind(HistoriqueTransactionController)
);

// ==================== III. JOURNAL D'AUDIT ====================

/**
 * GET /api/v1/historique/audit
 * Récupérer les entrées du journal d'audit
 * Headers: Authorization: Bearer <token>
 * Query: page=1, limit=50, action?, ressource_type?, compte_id?,
 *        succes?, date_debut?, date_fin?, severite?, tri=date_desc
 * Auth: ADMIN
 * Cache: 2 minutes
 * Réponse: { success, data: { entrees, statistiques }, pagination }
 */
router.get('/audit',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 200 }),
        query('action').optional().trim(),
        query('ressource_type').optional().trim(),
        query('compte_id').optional().isInt(),
        query('succes').optional().isBoolean(),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601(),
        query('severite').optional().trim(),
        query('tri').optional().isIn(['date_desc', 'date_asc', 'duree_desc', 'duree_asc'])
    ]),
    JournalAuditController.findAll.bind(JournalAuditController)
);

/**
 * GET /api/v1/historique/audit/erreurs
 * Récupérer les erreurs fréquentes
 * Headers: Authorization: Bearer <token>
 * Query: periode=7d, limit=20
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { success, data: { erreurs, evolution, periode } }
 */
router.get('/audit/erreurs',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('periode').optional().isIn(['24h', '7d', '30d']),
        query('limit').optional().isInt({ min: 5, max: 50 })
    ]),
    JournalAuditController.getErreurs.bind(JournalAuditController)
);

/**
 * GET /api/v1/historique/audit/activite-utilisateurs
 * Récupérer l'activité par utilisateur
 * Headers: Authorization: Bearer <token>
 * Query: periode=7d, limit=20
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { success, data }
 */
router.get('/audit/activite-utilisateurs',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('periode').optional().isIn(['24h', '7d', '30d']),
        query('limit').optional().isInt({ min: 5, max: 50 })
    ]),
    JournalAuditController.getActiviteUtilisateurs.bind(JournalAuditController)
);

/**
 * GET /api/v1/historique/audit/acces-sensibles
 * Récupérer les accès sensibles
 * Headers: Authorization: Bearer <token>
 * Query: periode=7d
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { success, data: { acces, statistiques } }
 */
router.get('/audit/acces-sensibles',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('periode').optional().isIn(['24h', '7d', '30d'])
    ]),
    JournalAuditController.getAccesSensibles.bind(JournalAuditController)
);

/**
 * GET /api/v1/historique/audit/performances
 * Analyser les performances (temps de réponse)
 * Headers: Authorization: Bearer <token>
 * Query: periode=7d, ressource_type?
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { success, data: { performances, distribution } }
 */
router.get('/audit/performances',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('periode').optional().isIn(['24h', '7d', '30d']),
        query('ressource_type').optional().trim()
    ]),
    JournalAuditController.getPerformances.bind(JournalAuditController)
);

/**
 * GET /api/v1/historique/audit/:id
 * Récupérer les détails d'une entrée d'audit
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: ADMIN
 * Réponse: { success, data: entree_avec_changements }
 */
router.get('/audit/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    JournalAuditController.findOne.bind(JournalAuditController)
);

// ==================== IV. POLITIQUES DE RÉTENTION ====================

/**
 * GET /api/v1/historique/politiques-retention
 * Récupérer toutes les politiques de rétention
 * Headers: Authorization: Bearer <token>
 * Query: est_active?
 * Auth: ADMIN
 * Cache: 10 minutes
 * Réponse: { success, data }
 */
router.get('/politiques-retention',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        query('est_active').optional().isBoolean()
    ]),
    PolitiqueRetentionController.findAll.bind(PolitiqueRetentionController)
);

/**
 * GET /api/v1/historique/politiques-retention/recommandations
 * Obtenir des recommandations de rétention
 * Headers: Authorization: Bearer <token>
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { success, data: recommandations }
 */
router.get('/politiques-retention/recommandations',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    PolitiqueRetentionController.getRecommandations.bind(PolitiqueRetentionController)
);

/**
 * GET /api/v1/historique/politiques-retention/:table
 * Récupérer une politique par sa table cible
 * Headers: Authorization: Bearer <token>
 * Params: table
 * Auth: ADMIN
 * Cache: 10 minutes
 * Réponse: { success, data: politique_avec_statistiques }
 */
router.get('/politiques-retention/:table',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        param('table').notEmpty()
    ]),
    PolitiqueRetentionController.findOne.bind(PolitiqueRetentionController)
);

/**
 * POST /api/v1/historique/politiques-retention
 * Créer une nouvelle politique de rétention
 * Headers: Authorization: Bearer <token>
 * Body: { table_cible, duree_retention_jours, champ_date?, action_expiration? }
 * Auth: ADMIN
 * Réponse: 201 { success, data, message }
 */
router.post('/politiques-retention',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        body('table_cible').notEmpty().trim(),
        body('duree_retention_jours').isInt({ min: 1, max: 3650 }),
        body('champ_date').optional().trim(),
        body('action_expiration').optional().isIn(['SUPPRIMER', 'ANONYMISER', 'ARCHIVER'])
    ]),
    PolitiqueRetentionController.create.bind(PolitiqueRetentionController)
);

/**
 * PUT /api/v1/historique/politiques-retention/:id
 * Mettre à jour une politique
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { duree_retention_jours?, champ_date?, action_expiration?, est_active? }
 * Auth: ADMIN
 * Réponse: { success, data, message }
 */
router.put('/politiques-retention/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('duree_retention_jours').optional().isInt({ min: 1, max: 3650 }),
        body('champ_date').optional().trim(),
        body('action_expiration').optional().isIn(['SUPPRIMER', 'ANONYMISER', 'ARCHIVER']),
        body('est_active').optional().isBoolean()
    ]),
    PolitiqueRetentionController.update.bind(PolitiqueRetentionController)
);

/**
 * POST /api/v1/historique/politiques-retention/:id/executer
 * Exécuter le nettoyage pour une politique spécifique
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: ADMIN
 * Réponse: { success, message, data }
 */
router.post('/politiques-retention/:id/executer',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    PolitiqueRetentionController.executerNettoyage.bind(PolitiqueRetentionController)
);

/**
 * DELETE /api/v1/historique/politiques-retention/:id
 * Supprimer une politique
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: ADMIN
 * Réponse: { success, message }
 */
router.delete('/politiques-retention/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    PolitiqueRetentionController.delete.bind(PolitiqueRetentionController)
);

module.exports = router;