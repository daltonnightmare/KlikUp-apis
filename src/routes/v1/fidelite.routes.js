// src/routes/v1/fidelite.routes.js
/**
 * Routes de gestion de la fidélité
 * API pour la gestion complète des programmes de fidélité, points et parrainage
 * Accès public pour certaines routes, authentification requise pour les actions
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

const ProgrammeFideliteController = require('../../controllers/fidelite/ProgrammeFideliteController');
const PointsFideliteController = require('../../controllers/fidelite/PointsFideliteController');
const ParrainageController = require('../../controllers/fidelite/ParrainageController');

// ==================== CONFIGURATION RATE LIMITING ====================

const pointsLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 20, // 20 opérations max par heure
    message: 'Trop d\'opérations sur les points. Réessayez plus tard.',
    standardHeaders: true,
    legacyHeaders: false
});

// ==================== I. PROGRAMMES DE FIDÉLITÉ ====================

/**
 * POST /api/v1/fidelite/programmes
 * Créer un nouveau programme de fidélité
 * Headers: Authorization: Bearer <token>
 * Body: {
 *   entite_type, entite_id, nom_programme, description?,
 *   points_par_tranche=1, montant_tranche=1000, valeur_point_fcfa=5,
 *   paliers=[], date_debut?, date_fin?
 * }
 * Auth: ADMIN
 * Réponse: 201 { success, data, message }
 */
router.post('/programmes',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        body('entite_type').isIn(['PLATEFORME', 'COMPAGNIE_TRANSPORT', 'RESTAURANT_FAST_FOOD', 'BOUTIQUE']),
        body('entite_id').isInt(),
        body('nom_programme').notEmpty().trim().isLength({ min: 3, max: 100 }),
        body('description').optional().trim(),
        body('points_par_tranche').optional().isInt({ min: 1 }),
        body('montant_tranche').optional().isInt({ min: 100 }),
        body('valeur_point_fcfa').optional().isInt({ min: 1 }),
        body('paliers').optional().isArray(),
        body('date_debut').optional().isISO8601(),
        body('date_fin').optional().isISO8601()
    ]),
    ProgrammeFideliteController.create.bind(ProgrammeFideliteController)
);

/**
 * GET /api/v1/fidelite/programmes
 * Récupérer tous les programmes de fidélité
 * Headers: Authorization: Bearer <token>
 * Query: page=1, limit=20, entite_type?, est_actif?, recherche?
 * Auth: ADMIN
 * Cache: 5 minutes
 * Réponse: { success, data, pagination }
 */
router.get('/programmes',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('entite_type').optional().isIn(['PLATEFORME', 'COMPAGNIE_TRANSPORT', 'RESTAURANT_FAST_FOOD', 'BOUTIQUE']),
        query('est_actif').optional().isBoolean(),
        query('recherche').optional().trim()
    ]),
    ProgrammeFideliteController.findAll.bind(ProgrammeFideliteController)
);

/**
 * GET /api/v1/fidelite/programmes/entite/:entite_type/:entite_id
 * Récupérer le programme d'une entité
 * Params: entite_type, entite_id
 * Auth: PUBLIC
 * Cache: 1 heure
 * Réponse: { success, data }
 */
router.get('/programmes/entite/:entite_type/:entite_id',
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        param('entite_type').isIn(['PLATEFORME', 'COMPAGNIE_TRANSPORT', 'RESTAURANT_FAST_FOOD', 'BOUTIQUE']),
        param('entite_id').isInt()
    ]),
    ProgrammeFideliteController.findByEntity.bind(ProgrammeFideliteController)
);

/**
 * GET /api/v1/fidelite/programmes/:id
 * Récupérer un programme par ID
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: ADMIN
 * Cache: 5 minutes
 * Réponse: { success, data: programme_avec_stats_top_membres_evolution }
 */
router.get('/programmes/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ProgrammeFideliteController.findOne.bind(ProgrammeFideliteController)
);

/**
 * PUT /api/v1/fidelite/programmes/:id
 * Mettre à jour un programme
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { nom_programme?, description?, points_par_tranche?, montant_tranche?,
 *         valeur_point_fcfa?, paliers?, date_debut?, date_fin?, est_actif? }
 * Auth: ADMIN
 * Réponse: { success, data, message }
 */
router.put('/programmes/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nom_programme').optional().trim().isLength({ min: 3, max: 100 }),
        body('description').optional().trim(),
        body('points_par_tranche').optional().isInt({ min: 1 }),
        body('montant_tranche').optional().isInt({ min: 100 }),
        body('valeur_point_fcfa').optional().isInt({ min: 1 }),
        body('paliers').optional().isArray(),
        body('date_debut').optional().isISO8601(),
        body('date_fin').optional().isISO8601(),
        body('est_actif').optional().isBoolean()
    ]),
    ProgrammeFideliteController.update.bind(ProgrammeFideliteController)
);

/**
 * PATCH /api/v1/fidelite/programmes/:id/toggle
 * Activer/Désactiver un programme
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { actif }
 * Auth: ADMIN
 * Réponse: { success, data, message }
 */
router.patch('/programmes/:id/toggle',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('actif').isBoolean()
    ]),
    ProgrammeFideliteController.toggleStatus.bind(ProgrammeFideliteController)
);

/**
 * DELETE /api/v1/fidelite/programmes/:id
 * Supprimer un programme (soft delete)
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: ADMIN
 * Réponse: { success, message }
 */
router.delete('/programmes/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ProgrammeFideliteController.delete.bind(ProgrammeFideliteController)
);

// ==================== II. POINTS DE FIDÉLITÉ ====================

/**
 * GET /api/v1/fidelite/points/mon-solde
 * Récupérer le solde de points de l'utilisateur connecté
 * Headers: Authorization: Bearer <token>
 * Query: programme_id?
 * Auth: PRIVATE
 * Cache: 2 minutes
 * Réponse: { success, data: soldes_avec_niveau_valeur_historique }
 */
router.get('/points/mon-solde',
    authMiddleware.authenticate,
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        query('programme_id').optional().isInt()
    ]),
    PointsFideliteController.getMonSolde.bind(PointsFideliteController)
);

/**
 * GET /api/v1/fidelite/points/historique
 * Récupérer l'historique des mouvements de points
 * Headers: Authorization: Bearer <token>
 * Query: programme_id?, type_mouvement?, page=1, limit=50, date_debut?, date_fin?
 * Auth: PRIVATE
 * Cache: 2 minutes
 * Réponse: { success, data: { mouvements, totaux }, pagination }
 */
router.get('/points/historique',
    authMiddleware.authenticate,
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        query('programme_id').optional().isInt(),
        query('type_mouvement').optional().isIn(['GAIN_ACHAT', 'GAIN_PARRAINAGE', 'GAIN_BONUS', 'UTILISATION', 'EXPIRATION']),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601()
    ]),
    PointsFideliteController.getHistorique.bind(PointsFideliteController)
);

/**
 * GET /api/v1/fidelite/points/avantages
 * Récupérer les avantages disponibles selon le niveau
 * Headers: Authorization: Bearer <token>
 * Query: programme_id
 * Auth: PRIVATE
 * Cache: 10 minutes
 * Réponse: { success, data: { programme, points_actuels, niveau_actuel, avantages, prochain_niveau, offres } }
 */
router.get('/points/avantages',
    authMiddleware.authenticate,
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        query('programme_id').isInt()
    ]),
    PointsFideliteController.getAvantages.bind(PointsFideliteController)
);

/**
 * GET /api/v1/fidelite/points/expiration
 * Points en voie d'expiration
 * Headers: Authorization: Bearer <token>
 * Auth: PRIVATE
 * Cache: 1 heure
 * Réponse: { success, data: { total_points_menaces, points } }
 */
router.get('/points/expiration',
    authMiddleware.authenticate,
    cacheMiddleware.cache(3600), // 1 heure
    PointsFideliteController.getPointsExpiration.bind(PointsFideliteController)
);

/**
 * POST /api/v1/fidelite/points/gagner
 * Ajouter des points (gain)
 * Headers: Authorization: Bearer <token>
 * Body: { programme_id, points, type_mouvement, reference_type?, reference_id?, description? }
 * Rate limit: 20 par heure
 * Auth: PRIVATE
 * Réponse: 201 { success, data: { mouvement, nouveau_solde, points_gagnes }, message }
 */
router.post('/points/gagner',
    authMiddleware.authenticate,
    pointsLimiter,
    validationMiddleware.validate([
        body('programme_id').isInt(),
        body('points').isInt({ min: 1 }),
        body('type_mouvement').isIn(['GAIN_ACHAT', 'GAIN_PARRAINAGE', 'GAIN_BONUS']),
        body('reference_type').optional().isIn(['COMMANDE_RESTAURANT', 'COMMANDE_BOUTIQUE', 'ACHAT_TICKET', 'PARRAINAGE']),
        body('reference_id').optional().isInt(),
        body('description').optional().trim()
    ]),
    PointsFideliteController.gagnerPoints.bind(PointsFideliteController)
);

/**
 * POST /api/v1/fidelite/points/utiliser
 * Utiliser des points
 * Headers: Authorization: Bearer <token>
 * Body: { programme_id, points, reference_type?, reference_id?, description? }
 * Rate limit: 20 par heure
 * Auth: PRIVATE
 * Réponse: { success, data: { mouvement, nouveau_solde, points_utilises, valeur_fcfa }, message }
 */
router.post('/points/utiliser',
    authMiddleware.authenticate,
    pointsLimiter,
    validationMiddleware.validate([
        body('programme_id').isInt(),
        body('points').isInt({ min: 1 }),
        body('reference_type').optional().isIn(['COMMANDE_RESTAURANT', 'COMMANDE_BOUTIQUE', 'ACHAT_TICKET']),
        body('reference_id').optional().isInt(),
        body('description').optional().trim()
    ]),
    PointsFideliteController.utiliserPoints.bind(PointsFideliteController)
);

/**
 * POST /api/v1/fidelite/points/convertir
 * Convertir des points en réduction
 * Headers: Authorization: Bearer <token>
 * Body: { programme_id, points, commande_type, commande_id }
 * Rate limit: 10 par heure
 * Auth: PRIVATE
 * Réponse: { success, data: { points_utilises, montant_reduction, nouveau_solde }, message }
 */
router.post('/points/convertir',
    authMiddleware.authenticate,
    pointsLimiter,
    validationMiddleware.validate([
        body('programme_id').isInt(),
        body('points').isInt({ min: 1 }),
        body('commande_type').isIn(['RESTAURANT_FAST_FOOD', 'BOUTIQUE']),
        body('commande_id').isInt()
    ]),
    PointsFideliteController.convertirEnReduction.bind(PointsFideliteController)
);

// ==================== III. PARRAINAGE ====================

/**
 * POST /api/v1/fidelite/parrainage/generer-code
 * Générer un code de parrainage
 * Headers: Authorization: Bearer <token>
 * Body: { programme_id? }
 * Auth: PRIVATE
 * Réponse: { success, data: { code_parrainage, existant } }
 */
router.post('/parrainage/generer-code',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        body('programme_id').optional().isInt()
    ]),
    ParrainageController.genererCode.bind(ParrainageController)
);

/**
 * POST /api/v1/fidelite/parrainage/utiliser
 * Utiliser un code de parrainage (inscription filleul)
 * Headers: Authorization: Bearer <token>
 * Body: { code_parrainage }
 * Auth: PRIVATE
 * Réponse: { success, message, data: { points_gagnes, bonus_fcfa } }
 */
router.post('/parrainage/utiliser',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        body('code_parrainage').notEmpty().trim()
    ]),
    ParrainageController.utiliserCode.bind(ParrainageController)
);

/**
 * GET /api/v1/fidelite/parrainage/mes-filleuls
 * Récupérer mes filleuls
 * Headers: Authorization: Bearer <token>
 * Query: page=1, limit=20
 * Auth: PRIVATE
 * Cache: 5 minutes
 * Réponse: { success, data: { filleuls, stats }, pagination }
 */
router.get('/parrainage/mes-filleuls',
    authMiddleware.authenticate,
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 })
    ]),
    ParrainageController.getMesFilleuls.bind(ParrainageController)
);

/**
 * GET /api/v1/fidelite/parrainage/lien
 * Récupérer le lien de parrainage
 * Headers: Authorization: Bearer <token>
 * Auth: PRIVATE
 * Cache: 10 minutes
 * Réponse: { success, data: { code, lien } }
 */
router.get('/parrainage/lien',
    authMiddleware.authenticate,
    cacheMiddleware.cache(600), // 10 minutes
    ParrainageController.getLienParrainage.bind(ParrainageController)
);

/**
 * GET /api/v1/fidelite/parrainage/stats
 * Récupérer les statistiques de parrainage
 * Headers: Authorization: Bearer <token>
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { success, data: { global, top_parrains } }
 */
router.get('/parrainage/stats',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    ParrainageController.getStats.bind(ParrainageController)
);

/**
 * GET /api/v1/fidelite/parrainage/:id
 * Récupérer les détails d'un parrainage
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: ADMIN ou parrain concerné
 * Réponse: { success, data }
 */
router.get('/parrainage/:id',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ParrainageController.getOne.bind(ParrainageController)
);

// ==================== IV. STATISTIQUES GLOBALES ====================

/**
 * GET /api/v1/fidelite/stats/globales
 * Récupérer les statistiques globales de fidélité
 * Headers: Authorization: Bearer <token>
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { success, data }
 */
router.get('/stats/globales',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    async (req, res, next) => {
        try {
            const [programmesStats, pointsStats, parrainageStats] = await Promise.all([
                db.query(`SELECT 
                    COUNT(*) as total_programmes,
                    COUNT(*) FILTER (WHERE est_actif = true) as programmes_actifs,
                    COUNT(DISTINCT entite_type) as types_entites
                FROM PROGRAMMES_FIDELITE`),
                
                db.query(`SELECT 
                    COUNT(DISTINCT compte_id) as total_membres,
                    SUM(points_actuels) as total_points_actifs,
                    SUM(points_cumules) as total_points_cumules
                FROM SOLDES_FIDELITE`),
                
                db.query(`SELECT 
                    COUNT(*) as total_parrainages,
                    COUNT(*) FILTER (WHERE est_converti = true) as conversions,
                    COUNT(DISTINCT parrain_id) as total_parrains
                FROM PARRAINAGES`)
            ]);

            res.json({
                success: true,
                data: {
                    programmes: programmesStats.rows[0],
                    points: pointsStats.rows[0],
                    parrainage: parrainageStats.rows[0]
                }
            });
        } catch (error) {
            next(error);
        }
    }
);

module.exports = router;