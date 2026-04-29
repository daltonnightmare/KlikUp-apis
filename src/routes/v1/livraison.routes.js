// src/routes/v1/livraison.routes.js
/**
 * Routes de gestion des livraisons
 * API pour la gestion complète des demandes de livraison, entreprises, livreurs et services
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
const uploadMiddleware = require('../middlewares/upload.middleware');

const DemandeLivraisonController = require('../../controllers/livraison/DemandeLivraisonController');
const EntrepriseLivraisonController = require('../../controllers/livraison/EntrepriseLivraisonController');
const LivreurController = require('../../controllers/livraison/LivreurController');
const ServiceLivraisonController = require('../../controllers/livraison/ServiceLivraisonController');

// ==================== CONFIGURATION RATE LIMITING ====================

const localisationLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 mises à jour max par minute
    message: 'Trop de mises à jour de localisation. Réessayez plus tard.',
    standardHeaders: true,
    legacyHeaders: false
});

// ==================== I. DEMANDES DE LIVRAISON ====================

/**
 * POST /api/v1/livraison/demandes
 * Créer une nouvelle demande de livraison
 * Headers: Authorization: Bearer <token>
 * Body: {
 *   details_livraison, commande_type, commande_id?,
 *   adresse_depart_id?, adresse_livraison_id, service_livraison_id?,
 *   date_livraison_prevue?
 * }
 * Auth: PRIVATE
 * Réponse: 201 { success, data, message }
 */
router.post('/demandes',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        body('details_livraison').isObject(),
        body('commande_type').isIn(['RESTAURANT_FAST_FOOD', 'BOUTIQUE', 'AUTRE']),
        body('commande_id').optional().isInt(),
        body('adresse_depart_id').optional().isInt(),
        body('adresse_livraison_id').isInt(),
        body('service_livraison_id').optional().isInt(),
        body('date_livraison_prevue').optional().isISO8601(),
        body().custom(body => {
            if (body.commande_type !== 'AUTRE' && !body.commande_id) {
                throw new Error('ID de commande requis pour ce type');
            }
            return true;
        })
    ]),
    DemandeLivraisonController.create.bind(DemandeLivraisonController)
);

/**
 * GET /api/v1/livraison/demandes
 * Récupérer toutes les demandes de livraison
 * Headers: Authorization: Bearer <token>
 * Query: page=1, limit=20, statut_livraison?, livreur_affecte?,
 *        commande_type?, date_debut?, date_fin?, est_effectue?
 * Auth: ADMIN
 * Cache: 2 minutes
 * Réponse: { success, data, pagination }
 */
router.get('/demandes',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('statut_livraison').optional().isIn(['EN_ATTENTE', 'EN_COURS', 'LIVREE', 'ANNULEE']),
        query('livreur_affecte').optional().isInt(),
        query('commande_type').optional().isIn(['RESTAURANT_FAST_FOOD', 'BOUTIQUE', 'AUTRE']),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601(),
        query('est_effectue').optional().isBoolean()
    ]),
    DemandeLivraisonController.findAll.bind(DemandeLivraisonController)
);

/**
 * GET /api/v1/livraison/demandes/stats/globales
 * Obtenir les statistiques des livraisons
 * Headers: Authorization: Bearer <token>
 * Query: periode=30d
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { success, data: { global, par_type, evolution, periode } }
 */
router.get('/demandes/stats/globales',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('periode').optional().isIn(['24h', '7d', '30d', '1y'])
    ]),
    DemandeLivraisonController.getStats.bind(DemandeLivraisonController)
);

/**
 * GET /api/v1/livraison/demandes/:id
 * Récupérer une demande par son ID
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: ADMIN ou livreur concerné
 * Réponse: { success, data: demande_avec_details }
 */
router.get('/demandes/:id',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    DemandeLivraisonController.findOne.bind(DemandeLivraisonController)
);

/**
 * GET /api/v1/livraison/demandes/:id/suivi
 * Suivre une livraison en temps réel
 * Params: id
 * Query: token_suivi? (optionnel pour accès public)
 * Auth: PUBLIC (avec token) ou PRIVATE
 * Cache: 30 secondes
 * Réponse: { success, data: suivi_avec_timeline_et_position }
 */
router.get('/demandes/:id/suivi',
    authMiddleware.optionalAuthenticate,
    cacheMiddleware.cache(30), // 30 secondes
    validationMiddleware.validate([
        param('id').isInt(),
        query('token_suivi').optional().trim()
    ]),
    DemandeLivraisonController.getSuivi.bind(DemandeLivraisonController)
);

/**
 * PATCH /api/v1/livraison/demandes/:id/assigner
 * Assigner un livreur à une demande
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { livreur_id }
 * Auth: ADMIN
 * Réponse: { success, message }
 */
router.patch('/demandes/:id/assigner',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('livreur_id').isInt()
    ]),
    DemandeLivraisonController.assignerLivreur.bind(DemandeLivraisonController)
);

/**
 * PATCH /api/v1/livraison/demandes/:id/statut
 * Mettre à jour le statut d'une livraison
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { statut, commentaire? }
 * Auth: ADMIN ou livreur concerné
 * Réponse: { success, message }
 */
router.patch('/demandes/:id/statut',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt(),
        body('statut').isIn(['EN_COURS', 'LIVREE', 'ANNULEE']),
        body('commentaire').optional().trim()
    ]),
    DemandeLivraisonController.updateStatut.bind(DemandeLivraisonController)
);
// NOUVELLES ROUTES - Pour les utilisateurs normaux
router.get('/mes-demandes', authMiddleware.authenticate, DemandeLivraisonController.findMyLivraisons);
router.get('/mes-demandes/:id', authMiddleware.authenticate, DemandeLivraisonController.findMyLivraisonById);

/**
 * POST /api/v1/livraison/demandes/:id/annuler
 * Annuler une demande de livraison
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { raison? }
 * Auth: ADMIN ou client concerné
 * Réponse: { success, message }
 */
router.post('/demandes/:id/annuler',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt(),
        body('raison').optional().trim()
    ]),
    DemandeLivraisonController.annuler.bind(DemandeLivraisonController)
);

// ==================== II. ENTREPRISES DE LIVRAISON ====================


/**
 * GET /api/v1/livraison/entreprises
 * Récupérer toutes les entreprises de livraison
 * Query: page=1, limit=20, est_actif?, recherche?,
 *        proximite_lat?, proximite_lng?, rayon_km=10
 * Auth: PUBLIC
 * Cache: 10 minutes
 * Réponse: { success, data, pagination }
 */
router.get('/entreprises',
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('est_actif').optional().isBoolean(),
        query('recherche').optional().trim(),
        query('proximite_lat').optional().isFloat({ min: -90, max: 90 }),
        query('proximite_lng').optional().isFloat({ min: -180, max: 180 }),
        query('rayon_km').optional().isFloat({ min: 0.1, max: 50 })
    ]),
    EntrepriseLivraisonController.findAll.bind(EntrepriseLivraisonController)
);

/**
 * GET /api/v1/livraison/entreprises/:id
 * Récupérer une entreprise par son ID
 * Params: id
 * Auth: PUBLIC
 * Cache: 10 minutes
 * Réponse: { success, data: entreprise_avec_services_livreurs_stats }
 */
router.get('/entreprises/:id',
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    EntrepriseLivraisonController.findOne.bind(EntrepriseLivraisonController)
);

/**
 * PUT /api/v1/livraison/entreprises/:id
 * Mettre à jour une entreprise
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { nom_entreprise_livraison?, description_entreprise_livraison?,
 *         localisation_entreprise?, pourcentage_commission_plateforme?, est_actif? }
 * Files: logo?, favicon? (multipart/form-data)
 * Auth: ADMIN
 * Réponse: { success, data, message }
 */
router.put('/entreprises/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    uploadMiddleware.fields([
        { name: 'logo', maxCount: 1 },
        { name: 'favicon', maxCount: 1 }
    ]),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nom_entreprise_livraison').optional().trim(),
        body('description_entreprise_livraison').optional().trim(),
        body('localisation_entreprise.lat').optional().isFloat({ min: -90, max: 90 }),
        body('localisation_entreprise.lng').optional().isFloat({ min: -180, max: 180 }),
        body('pourcentage_commission_plateforme').optional().isFloat({ min: 0, max: 100 }),
        body('est_actif').optional().isBoolean()
    ]),
    EntrepriseLivraisonController.update.bind(EntrepriseLivraisonController)
);

/**
 * PATCH /api/v1/livraison/entreprises/:id/toggle
 * Désactiver/Activer une entreprise
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { actif }
 * Auth: ADMIN
 * Réponse: { success, data, message }
 */
router.patch('/entreprises/:id/toggle',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('actif').isBoolean()
    ]),
    EntrepriseLivraisonController.toggleStatus.bind(EntrepriseLivraisonController)
);

/**
 * GET /api/v1/livraison/entreprises/:id/stats
 * Obtenir les statistiques d'une entreprise
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Query: periode=30d
 * Auth: ADMIN
 * Cache: 10 minutes
 * Réponse: { success, data: { global, evolution, periode } }
 */
router.get('/entreprises/:id/stats',
    authMiddleware.authenticate,
    /*roleMiddleware.isAdmin(),*/
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        param('id').isInt(),
        query('periode').optional().isIn(['24h', '7d', '30d', '1y'])
    ]),
    EntrepriseLivraisonController.getStats.bind(EntrepriseLivraisonController)
);

// ==================== III. LIVREURS ====================

/**
 * POST /api/v1/livraison/livreurs
 * Créer un nouveau livreur
 * Headers: Authorization: Bearer <token>
 * Body: { nom_livreur, prenom_livreur, numero_telephone_livreur, id_entreprise_livraison }
 * Files: photo? (multipart/form-data)
 * Auth: ADMIN
 * Réponse: 201 { success, data, message }
 */
router.post('/livreurs',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    uploadMiddleware.single('photo'),
    validationMiddleware.validate([
        body('nom_livreur').notEmpty().trim(),
        body('prenom_livreur').notEmpty().trim(),
        body('numero_telephone_livreur').matches(/^[0-9+\-\s]+$/),
        body('id_entreprise_livraison').isInt()
    ]),
    LivreurController.create.bind(LivreurController)
);

/**
 * GET /api/v1/livraison/livreurs
 * Récupérer tous les livreurs
 * Query: page=1, limit=20, id_entreprise_livraison?, est_disponible?,
 *        est_actif?, note_min?, proximite_lat?, proximite_lng?, rayon_km=5
 * Auth: PUBLIC
 * Cache: 2 minutes
 * Réponse: { success, data, pagination }
 */
router.get('/livreurs',
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('id_entreprise_livraison').optional().isInt(),
        query('est_disponible').optional().isBoolean(),
        query('est_actif').optional().isBoolean(),
        query('note_min').optional().isFloat({ min: 0, max: 5 }),
        query('proximite_lat').optional().isFloat({ min: -90, max: 90 }),
        query('proximite_lng').optional().isFloat({ min: -180, max: 180 }),
        query('rayon_km').optional().isFloat({ min: 0.1, max: 50 })
    ]),
    LivreurController.findAll.bind(LivreurController)
);

/**
 * GET /api/v1/livraison/livreurs/disponibles/proches
 * Obtenir les livreurs disponibles à proximité
 * Query: lat, lng, rayon_km=5, type_vehicule?, limit=10
 * Auth: PUBLIC
 * Cache: 30 secondes
 * Réponse: { success, data, count }
 */
router.get('/livreurs/disponibles/proches',
    cacheMiddleware.cache(30), // 30 secondes
    validationMiddleware.validate([
        query('lat').isFloat({ min: -90, max: 90 }),
        query('lng').isFloat({ min: -180, max: 180 }),
        query('rayon_km').optional().isFloat({ min: 0.1, max: 50 }),
        query('type_vehicule').optional().trim(),
        query('limit').optional().isInt({ min: 1, max: 50 })
    ]),
    LivreurController.getDisponiblesProches.bind(LivreurController)
);

/**
 * GET /api/v1/livraison/livreurs/:id
 * Récupérer un livreur par son ID
 * Params: id
 * Auth: PUBLIC
 * Cache: 5 minutes
 * Réponse: { success, data: livreur_avec_performances_et_historique }
 */
router.get('/livreurs/:id',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    LivreurController.findOne.bind(LivreurController)
);

/**
 * GET /api/v1/livraison/livreurs/:id/stats
 * Obtenir les statistiques d'un livreur
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Query: periode=30d
 * Auth: ADMIN ou livreur concerné
 * Cache: 10 minutes
 * Réponse: { success, data: { global, evolution, periode } }
 */
router.get('/livreurs/:id/stats',
    authMiddleware.authenticate,
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        param('id').isInt(),
        query('periode').optional().isIn(['24h', '7d', '30d', '1y'])
    ]),
    LivreurController.getStats.bind(LivreurController)
);

/**
 * PUT /api/v1/livraison/livreurs/:id
 * Mettre à jour un livreur
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { nom_livreur?, prenom_livreur?, numero_telephone_livreur?,
 *         id_entreprise_livraison?, est_disponible?, est_actif?, note_moyenne? }
 * Files: photo? (multipart/form-data)
 * Auth: ADMIN
 * Réponse: { success, data, message }
 */
router.put('/livreurs/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    uploadMiddleware.single('photo'),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nom_livreur').optional().trim(),
        body('prenom_livreur').optional().trim(),
        body('numero_telephone_livreur').optional().matches(/^[0-9+\-\s]+$/),
        body('id_entreprise_livraison').optional().isInt(),
        body('est_disponible').optional().isBoolean(),
        body('est_actif').optional().isBoolean(),
        body('note_moyenne').optional().isFloat({ min: 0, max: 5 })
    ]),
    LivreurController.update.bind(LivreurController)
);

/**
 * PATCH /api/v1/livraison/livreurs/:id/localisation
 * Mettre à jour la localisation d'un livreur
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { lat, lng }
 * Rate limit: 60 par minute
 * Auth: LIVREUR (propriétaire)
 * Réponse: { success, message }
 */
router.patch('/livreurs/:id/localisation',
    authMiddleware.authenticate,
    localisationLimiter,
    validationMiddleware.validate([
        param('id').isInt(),
        body('lat').isFloat({ min: -90, max: 90 }),
        body('lng').isFloat({ min: -180, max: 180 })
    ]),
    LivreurController.updateLocalisation.bind(LivreurController)
);

/**
 * PATCH /api/v1/livraison/livreurs/:id/disponibilite
 * Changer le statut de disponibilité
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { disponible }
 * Auth: LIVREUR (propriétaire)
 * Réponse: { success, data, message }
 */
router.patch('/livreurs/:id/disponibilite',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt(),
        body('disponible').isBoolean()
    ]),
    LivreurController.toggleDisponibilite.bind(LivreurController)
);

// ==================== IV. SERVICES DE LIVRAISON ====================

/**
 * POST /api/v1/livraison/services
 * Créer un nouveau service de livraison
 * Headers: Authorization: Bearer <token>
 * Body: {
 *   nom_service, type_service, description_service?,
 *   prix_service, prix_par_km?, distance_max_km?,
 *   donnees_supplementaires?, id_entreprise_livraison
 * }
 * Auth: ADMIN
 * Réponse: 201 { success, data, message }
 */
router.post('/services',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        body('nom_service').notEmpty().trim(),
        body('type_service').isIn(['STANDARD', 'EXPRESS', 'PROGRAMMEE', 'NUIT', 'WEEKEND', 'INTERNATIONAL']),
        body('description_service').optional().trim(),
        body('prix_service').isFloat({ min: 0 }),
        body('prix_par_km').optional().isFloat({ min: 0 }),
        body('distance_max_km').optional().isFloat({ min: 0 }),
        body('donnees_supplementaires').optional().isObject(),
        body('id_entreprise_livraison').isInt()
    ]),
    ServiceLivraisonController.create.bind(ServiceLivraisonController)
);

/**
 * GET /api/v1/livraison/services
 * Récupérer tous les services de livraison
 * Query: page=1, limit=20, type_service?, id_entreprise_livraison?, est_actif?, prix_max?
 * Auth: PUBLIC
 * Cache: 10 minutes
 * Réponse: { success, data, pagination }
 */
router.get('/services',
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('type_service').optional().isIn(['STANDARD', 'EXPRESS', 'PROGRAMMEE', 'NUIT', 'WEEKEND', 'INTERNATIONAL']),
        query('id_entreprise_livraison').optional().isInt(),
        query('est_actif').optional().isBoolean(),
        query('prix_max').optional().isFloat({ min: 0 })
    ]),
    ServiceLivraisonController.findAll.bind(ServiceLivraisonController)
);

/**
 * GET /api/v1/livraison/services/:id
 * Récupérer un service par son ID
 * Params: id
 * Auth: PUBLIC
 * Cache: 10 minutes
 * Réponse: { success, data: service_avec_statistiques }
 */
router.get('/services/:id',
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ServiceLivraisonController.findOne.bind(ServiceLivraisonController)
);

/**
 * POST /api/v1/livraison/services/calculer-prix
 * Calculer le prix d'une livraison
 * Body: {
 *   service_id, point_depart?, point_arrivee?, distance_km?,
 *   poids_kg?, urgent=false
 * }
 * Auth: PUBLIC
 * Réponse: { success, data: { service, prix_base, supplements, prix_total } }
 */
router.post('/services/calculer-prix',
    validationMiddleware.validate([
        body('service_id').isInt(),
        body('point_depart.lat').optional().isFloat({ min: -90, max: 90 }),
        body('point_depart.lng').optional().isFloat({ min: -180, max: 180 }),
        body('point_arrivee.lat').optional().isFloat({ min: -90, max: 90 }),
        body('point_arrivee.lng').optional().isFloat({ min: -180, max: 180 }),
        body('distance_km').optional().isFloat({ min: 0 }),
        body('poids_kg').optional().isFloat({ min: 0 }),
        body('urgent').optional().isBoolean(),
        body().custom(body => {
            if (!body.distance_km && (!body.point_depart || !body.point_arrivee)) {
                throw new Error('Distance ou points de départ/arrivée requis');
            }
            return true;
        })
    ]),
    ServiceLivraisonController.calculerPrix.bind(ServiceLivraisonController)
);

/**
 * PUT /api/v1/livraison/services/:id
 * Mettre à jour un service
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { nom_service?, type_service?, description_service?,
 *         prix_service?, prix_par_km?, distance_max_km?,
 *         donnees_supplementaires?, est_actif? }
 * Auth: ADMIN
 * Réponse: { success, data, message }
 */
router.put('/services/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nom_service').optional().trim(),
        body('type_service').optional().isIn(['STANDARD', 'EXPRESS', 'PROGRAMMEE', 'NUIT', 'WEEKEND', 'INTERNATIONAL']),
        body('description_service').optional().trim(),
        body('prix_service').optional().isFloat({ min: 0 }),
        body('prix_par_km').optional().isFloat({ min: 0 }),
        body('distance_max_km').optional().isFloat({ min: 0 }),
        body('donnees_supplementaires').optional().isObject(),
        body('est_actif').optional().isBoolean()
    ]),
    ServiceLivraisonController.update.bind(ServiceLivraisonController)
);

/**
 * DELETE /api/v1/livraison/services/:id
 * Supprimer un service (soft delete si utilisé)
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: ADMIN
 * Réponse: { success, message, data? }
 */
router.delete('/services/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ServiceLivraisonController.delete.bind(ServiceLivraisonController)
);

module.exports = router;