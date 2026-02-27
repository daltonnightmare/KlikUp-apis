// src/routes/v1/adresse.routes.js
/**
 * Routes de gestion des adresses et de géolocalisation
 * API pour la gestion complète des adresses, géocodage, recherche de proximité et zones de livraison
 * Accès public pour certaines routes, authentification requise pour les opérations d'édition
 */
const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const validationMiddleware = require('../middlewares/validation.middleware');
const cacheMiddleware = require('../middlewares/cache.middleware');
const rateLimiter = require('../middlewares/rateLimiter.middleware');

const AdresseController = require('../../controllers/adresse/AdresseController');
const GeoController = require('../../controllers/adresse/GeoController');

// ==================== I. GESTION DES ADRESSES ====================
// Routes CRUD pour les adresses

/**
 * POST /api/v1/adresses
 * Créer une nouvelle adresse
 * Body: {
 *   libelle?, ligne_1, ligne_2?, quartier?, ville, code_postal?,
 *   commune?, province?, pays='Burkina Faso', coordonnees?,
 *   precision_gps?, est_principale=false, entite_type?, entite_id?,
 *   type_adresse='PRINCIPALE'
 * }
 * Auth: Bearer <token>
 * Réponse: 201 { status, data: adresse }
 */
router.post('/',
    authMiddleware.authenticate,
    rateLimiter.strictLimiter,
    validationMiddleware.validate([
        body('libelle').optional().trim(),
        body('ligne_1').notEmpty().trim().isLength({ min: 3 }),
        body('ligne_2').optional().trim(),
        body('quartier').optional().trim(),
        body('ville').notEmpty().trim().isLength({ min: 2 }),
        body('code_postal').optional().trim(),
        body('commune').optional().trim(),
        body('province').optional().trim(),
        body('pays').optional().trim().default('Burkina Faso'),
        body('coordonnees').optional().isArray().custom(value => {
            if (value && (value.length !== 2 || 
                value[0] < -180 || value[0] > 180 || 
                value[1] < -90 || value[1] > 90)) {
                throw new Error('Coordonnées invalides');
            }
            return true;
        }),
        body('precision_gps').optional().isFloat({ min: 0, max: 100 }),
        body('est_principale').optional().isBoolean(),
        body('entite_type').optional().isIn([
            'PLATEFORME', 'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT',
            'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT', 'BOUTIQUE',
            'PRODUIT_BOUTIQUE', 'COMPTE', 'LIVREUR'
        ]),
        body('entite_id').optional().isInt(),
        body('type_adresse').optional().isIn(['PRINCIPALE', 'FACTURATION', 'LIVRAISON', 'SECONDAIRE'])
    ]),
    AdresseController.create.bind(AdresseController)
);

/**
 * GET /api/v1/adresses/:id
 * Récupérer une adresse par ID
 * Params: id (entier)
 * Auth: Bearer <token> (optionnel selon param)
 * Cache: 1 heure
 * Réponse: { status, data: adresse_avec_entites_liees }
 */
router.get('/:id',
    authMiddleware.optionalAuthenticate,
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    AdresseController.findById.bind(AdresseController)
);

/**
 * GET /api/v1/adresses/entite/:type/:id
 * Récupérer les adresses d'une entité
 * Params: type, id
 * Query: type_adresse?, actif=true
 * Auth: PUBLIC
 * Cache: 5 minutes
 * Réponse: { status, data: [adresses], meta: { totale, principale } }
 */
router.get('/entite/:type/:id',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        param('type').isIn([
            'PLATEFORME', 'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT',
            'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT', 'BOUTIQUE',
            'PRODUIT_BOUTIQUE', 'COMPTE', 'LIVREUR'
        ]),
        param('id').isInt(),
        query('type_adresse').optional().isIn(['PRINCIPALE', 'FACTURATION', 'LIVRAISON', 'SECONDAIRE']),
        query('actif').optional().isBoolean()
    ]),
    AdresseController.findByEntity.bind(AdresseController)
);

/**
 * PUT /api/v1/adresses/:id
 * Mettre à jour une adresse
 * Params: id (entier)
 * Body: { libelle?, ligne_1?, ligne_2?, quartier?, ville?, code_postal?,
 *         commune?, province?, pays?, coordonnees?, precision_gps? }
 * Auth: Bearer <token> + PROPRIETAIRE ou ADMIN
 * Réponse: { status, data: adresse_maj }
 */
router.put('/:id',
    authMiddleware.authenticate,
    rateLimiter.strictLimiter,
    validationMiddleware.validate([
        param('id').isInt(),
        body('libelle').optional().trim(),
        body('ligne_1').optional().trim().isLength({ min: 3 }),
        body('ligne_2').optional().trim(),
        body('quartier').optional().trim(),
        body('ville').optional().trim().isLength({ min: 2 }),
        body('code_postal').optional().trim(),
        body('commune').optional().trim(),
        body('province').optional().trim(),
        body('pays').optional().trim(),
        body('coordonnees').optional().isArray().custom(value => {
            if (value && (value.length !== 2 || 
                value[0] < -180 || value[0] > 180 || 
                value[1] < -90 || value[1] > 90)) {
                throw new Error('Coordonnées invalides');
            }
            return true;
        }),
        body('precision_gps').optional().isFloat({ min: 0, max: 100 })
    ]),
    AdresseController.update.bind(AdresseController)
);

/**
 * DELETE /api/v1/adresses/:id
 * Supprimer une adresse (soft delete)
 * Params: id (entier)
 * Auth: Bearer <token> + ADMIN ou PROPRIETAIRE
 * Réponse: { status, message }
 */
router.delete('/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdminOrOwner(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    AdresseController.delete.bind(AdresseController)
);

/**
 * POST /api/v1/adresses/:id/lier
 * Lier une adresse à une entité
 * Params: id (entier)
 * Body: { entite_type, entite_id, type_adresse='SECONDAIRE', est_principale=false }
 * Auth: Bearer <token>
 * Réponse: { status, data, message }
 */
router.post('/:id/lier',
    authMiddleware.authenticate,
    rateLimiter.strictLimiter,
    validationMiddleware.validate([
        param('id').isInt(),
        body('entite_type').isIn([
            'PLATEFORME', 'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT',
            'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT', 'BOUTIQUE',
            'PRODUIT_BOUTIQUE', 'COMPTE', 'LIVREUR'
        ]),
        body('entite_id').isInt(),
        body('type_adresse').optional().isIn(['PRINCIPALE', 'FACTURATION', 'LIVRAISON', 'SECONDAIRE']),
        body('est_principale').optional().isBoolean()
    ]),
    AdresseController.linkToEntity.bind(AdresseController)
);

/**
 * DELETE /api/v1/adresses/:id/delier/:entite_type/:entite_id
 * Délier une adresse d'une entité
 * Params: id, entite_type, entite_id
 * Auth: Bearer <token>
 * Réponse: { status, message }
 */
router.delete('/:id/delier/:entite_type/:entite_id',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt(),
        param('entite_type').isIn([
            'PLATEFORME', 'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT',
            'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT', 'BOUTIQUE',
            'PRODUIT_BOUTIQUE', 'COMPTE', 'LIVREUR'
        ]),
        param('entite_id').isInt()
    ]),
    AdresseController.unlinkFromEntity.bind(AdresseController)
);

/**
 * POST /api/v1/adresses/:id/principale
 * Définir une adresse comme principale pour une entité
 * Params: id (entier)
 * Body: { entite_type, entite_id }
 * Auth: Bearer <token>
 * Réponse: { status, message }
 */
router.post('/:id/principale',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt(),
        body('entite_type').isIn([
            'PLATEFORME', 'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT',
            'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT', 'BOUTIQUE',
            'PRODUIT_BOUTIQUE', 'COMPTE', 'LIVREUR'
        ]),
        body('entite_id').isInt()
    ]),
    AdresseController.setAsPrincipal.bind(AdresseController)
);

/**
 * POST /api/v1/adresses/:id/valider
 * Valider une adresse (géocodage)
 * Params: id (entier)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { status, message, data: { coordonnees } }
 */
router.post('/:id/valider',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    AdresseController.validate.bind(AdresseController)
);

/**
 * GET /api/v1/adresses/search
 * Rechercher des adresses
 * Query: q?, ville?, quartier?, code_postal?, pays='Burkina Faso', limit=20, page=1
 * Auth: PUBLIC
 * Réponse: { status, data, pagination }
 */
router.get('/search',
    rateLimiter.publicLimiter,
    validationMiddleware.validate([
        query('q').optional().trim().isLength({ min: 2 }),
        query('ville').optional().trim(),
        query('quartier').optional().trim(),
        query('code_postal').optional().trim(),
        query('pays').optional().trim(),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('page').optional().isInt({ min: 1 })
    ]),
    AdresseController.search.bind(AdresseController)
);

// ==================== II. GÉOLOCALISATION ====================
// Routes de géolocalisation et recherche de proximité

/**
 * GET /api/v1/geo/proximite
 * Rechercher des entités à proximité
 * Query: type (boutiques, restaurants, livreurs), lat, lng, rayon_km=5, limit=20, page=1, filters?
 * Auth: PUBLIC
 * Cache: 2 minutes
 * Réponse: { status, data, pagination, meta }
 */
router.get('/geo/proximite',
    rateLimiter.publicLimiter,
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        query('type').isIn(['boutiques', 'restaurants', 'livreurs']),
        query('lat').isFloat({ min: -90, max: 90 }),
        query('lng').isFloat({ min: -180, max: 180 }),
        query('rayon_km').optional().isFloat({ min: 0.1, max: 50 }),
        query('limit').optional().isInt({ min: 1, max: 50 }),
        query('page').optional().isInt({ min: 1 }),
        query('filters').optional().isObject()
    ]),
    GeoController.findNearby.bind(GeoController)
);

/**
 * GET /api/v1/geo/itinerary
 * Calculer l'itinéraire entre deux points
 * Query: start_lat, start_lng, end_lat, end_lng, mode='driving' (driving, walking, bicycling)
 * Auth: Bearer <token>
 * Cache: 1 heure
 * Réponse: { status, data: { distance, duree, étapes } }
 */
router.get('/geo/itinerary',
    authMiddleware.authenticate,
    rateLimiter.strictLimiter,
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('start_lat').isFloat({ min: -90, max: 90 }),
        query('start_lng').isFloat({ min: -180, max: 180 }),
        query('end_lat').isFloat({ min: -90, max: 90 }),
        query('end_lng').isFloat({ min: -180, max: 180 }),
        query('mode').optional().isIn(['driving', 'walking', 'bicycling'])
    ]),
    GeoController.getItinerary.bind(GeoController)
);

/**
 * GET /api/v1/geo/autocomplete
 * Autocomplétion d'adresses
 * Query: q (min 3 caractères), limit=10
 * Auth: PUBLIC
 * Cache: 1 heure
 * Réponse: { status, data: [suggestions], meta }
 */
router.get('/geo/autocomplete',
    rateLimiter.publicLimiter,
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('q').isLength({ min: 3 }).trim(),
        query('limit').optional().isInt({ min: 1, max: 20 })
    ]),
    GeoController.autocomplete.bind(GeoController)
);

/**
 * GET /api/v1/geo/geocode
 * Géocoder une adresse (adresse -> coordonnées)
 * Query: adresse
 * Auth: PUBLIC
 * Cache: 1 heure
 * Réponse: { status, data: { adresse, lng, lat } }
 */
router.get('/geo/geocode',
    rateLimiter.publicLimiter,
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('adresse').notEmpty().trim()
    ]),
    GeoController.geocode.bind(GeoController)
);

/**
 * GET /api/v1/geo/reverse
 * Géocoder inverse (coordonnées -> adresse)
 * Query: lat, lng
 * Auth: PUBLIC
 * Cache: 1 heure
 * Réponse: { status, data: adresse }
 */
router.get('/geo/reverse',
    rateLimiter.publicLimiter,
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('lat').isFloat({ min: -90, max: 90 }),
        query('lng').isFloat({ min: -180, max: 180 })
    ]),
    GeoController.reverseGeocode.bind(GeoController)
);

/**
 * GET /api/v1/geo/delivery-zone/:boutiqueId
 * Obtenir la zone de livraison d'une boutique
 * Params: boutiqueId (entier)
 * Query: lat?, lng? (pour vérifier si un point est dans la zone)
 * Auth: PUBLIC
 * Cache: 1 heure
 * Réponse: { status, data: { boutique, centre, rayon_km, zone, est_dans_zone? } }
 */
router.get('/geo/delivery-zone/:boutiqueId',
    rateLimiter.publicLimiter,
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        param('boutiqueId').isInt(),
        query('lat').optional().isFloat({ min: -90, max: 90 }),
        query('lng').optional().isFloat({ min: -180, max: 180 })
    ]),
    GeoController.getDeliveryZone.bind(GeoController)
);

/**
 * POST /api/v1/geo/check-delivery
 * Vérifier si une adresse est dans la zone de livraison d'une boutique
 * Body: { adresse_id? ou (lat et lng)?, boutique_id }
 * Auth: PUBLIC
 * Réponse: { status, data: { est_dans_zone, distance_km, rayon_km, frais_livraison? } }
 */
router.post('/geo/check-delivery',
    rateLimiter.publicLimiter,
    validationMiddleware.validate([
        body('boutique_id').isInt(),
        body('adresse_id').optional().isInt(),
        body('lat').optional().isFloat({ min: -90, max: 90 }),
        body('lng').optional().isFloat({ min: -180, max: 180 }),
        body().custom((body, { req }) => {
            if (!body.adresse_id && (!body.lat || !body.lng)) {
                throw new Error('Soit adresse_id, soit (lat et lng) doit être fourni');
            }
            return true;
        })
    ]),
    GeoController.checkDelivery.bind(GeoController)
);

/**
 * GET /api/v1/geo/stats
 * Obtenir les statistiques géographiques
 * Auth: Bearer <token> + ADMIN
 * Cache: 1 heure
 * Réponse: { status, data: { global, top_villes, evolution } }
 */
router.get('/geo/stats',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    GeoController.getGeoStats.bind(GeoController)
);

module.exports = router;