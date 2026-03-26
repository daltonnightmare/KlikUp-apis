// src/routes/v1/public.routes.js
/**
 * Routes publiques de la plateforme
 * API pour le catalogue, la géolocalisation, les statistiques publiques et la santé
 * Accès public avec rate limiting pour certains endpoints
 */
const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const validationMiddleware = require('../middlewares/validation.middleware');
const rateLimiter = require('../middlewares/rateLimiter.middleware');
const cacheMiddleware = require('../middlewares/cache.middleware');

const CatalogueController = require('../../controllers/public/CatalogueController');
const GeoController = require('../../controllers/public/GeoController');
const StatsPubliquesController = require('../../controllers/public/StatsPubliquesController');
const HealthController = require('../../controllers/public/HealthController');
const catalogueRestaurants = require('../../controllers/public/CatalogueRestaurantController');
const catalogueBoutiques = require('../../controllers/public/CatalogueBoutiqueController');
const catalogueTransport = require('../../controllers/public/CatalogueTransportController');
const commandesPubliques = require('../../controllers/public/CommandesPubliqueController');
const avisPubliques = require('../../controllers/public/AvisPublique');

// ==================== I. SANTÉ ET MONITORING ====================
// Routes de health check (sans authentification, rate limiting léger)

/**
 * GET /api/v1/public/health
 * Health check basique de l'API
 * Rate limit: 100 requêtes/minute
 * Réponse: { status, timestamp, uptime, version, services }
 */
router.get('/health', 
    rateLimiter.publicLimiter,
    HealthController.health.bind(HealthController)
);

/**
 * GET /api/v1/public/health/detailed
 * Health check détaillé pour monitoring interne
 * Headers: x-monitoring-token requis
 * Rate limit: 60 requêtes/minute
 * Réponse: { status, database, system, ... }
 */
router.get('/health/detailed', 
    rateLimiter.strictLimiter,
    HealthController.detailed.bind(HealthController)
);

/**
 * GET /api/v1/public/ping
 * Ping simple pour load balancers
 * Rate limit: 1000 requêtes/minute
 * Réponse: "pong"
 */
router.get('/ping', 
    rateLimiter.publicLimiter,
    HealthController.ping.bind(HealthController)
);

// ==================== II. CATALOGUE ET RECHERCHE ====================
// Recherche unifiée dans tout le catalogue

/**
 * GET /api/v1/public/recherche
 * Recherche unifiée dans tout le catalogue
 * Query: 
 *   - q: terme de recherche (optionnel)
 *   - type: tout|restaurants|boutiques|produits|menus|transport
 *   - categorie: filtre par catégorie
 *   - localisation_lat, localisation_lng: position pour recherche géographique
 *   - rayon_km: rayon de recherche (défaut: 10)
 *   - note_min: note minimum
 *   - prix_min, prix_max: fourchette de prix
 *   - disponible: true|false
 *   - tri: pertinence|note|popularite|prix_asc|prix_desc
 *   - page, limit
 * Rate limit: 30 requêtes/minute
 * Cache: 5 minutes
 * Réponse: { success, data: { results, total, facets }, pagination }
 */
router.get('/recherche',
    rateLimiter.publicLimiter,
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('q').optional().trim(),
        query('type').optional().isIn(['tout', 'restaurants', 'boutiques', 'produits', 'menus', 'transport']),
        query('categorie').optional().trim(),
        query('localisation_lat').optional().isFloat({ min: -90, max: 90 }),
        query('localisation_lng').optional().isFloat({ min: -180, max: 180 }),
        query('rayon_km').optional().isFloat({ min: 0.1, max: 100 }),
        query('note_min').optional().isFloat({ min: 0, max: 5 }),
        query('prix_min').optional().isFloat({ min: 0 }),
        query('prix_max').optional().isFloat({ min: 0 }),
        query('disponible').optional().isBoolean(),
        query('tri').optional().isIn(['pertinence', 'note', 'popularite', 'prix_asc', 'prix_desc']),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 50 })
    ]),
    CatalogueController.search.bind(CatalogueController)
);

/**
 * GET /api/v1/public/suggestions
 * Suggestions de recherche en temps réel
 * Query: q (min 2 caractères), limit (défaut: 10)
 * Rate limit: 60 requêtes/minute
 * Cache: 1 minute
 * Réponse: { success, data: [{ type, label, id }] }
 */
router.get('/suggestions',
    rateLimiter.strictLimiter,
    cacheMiddleware.cache(60), // 1 minute
    validationMiddleware.validate([
        query('q').isLength({ min: 2 }).trim(),
        query('limit').optional().isInt({ min: 1, max: 20 })
    ]),
    CatalogueController.suggestions.bind(CatalogueController)
);

/**
 * GET /api/v1/public/filtres
 * Obtenir les filtres disponibles pour la recherche
 * Rate limit: 60 requêtes/minute
 * Cache: 1 heure
 * Réponse: { success, data: { categories_restaurant, categories_produits, villes, notes, fourchettes_prix } }
 */
router.get('/filtres',
    rateLimiter.publicLimiter,
    cacheMiddleware.cache(3600), // 1 heure
    CatalogueController.getFilters.bind(CatalogueController)
);

// ==================== III. GÉOLOCALISATION ====================
// Services géographiques et recherche de proximité

/**
 * GET /api/v1/public/geo/proximite
 * Rechercher des entités à proximité d'un point
 * Query: 
 *   - lat, lng: coordonnées du centre
 *   - type: tout|restaurants|boutiques|transport (défaut: tout)
 *   - rayon_km: rayon de recherche (défaut: 5)
 *   - limit: nombre max de résultats (défaut: 50)
 *   - categories: filtre par catégories (optionnel)
 * Rate limit: 60 requêtes/minute
 * Cache: 5 minutes
 * Réponse: { success, data: { restaurants?, transport? }, centre }
 */
router.get('/geo/proximite',
    rateLimiter.strictLimiter,
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('lat').isFloat({ min: -90, max: 90 }),
        query('lng').isFloat({ min: -180, max: 180 }),
        query('type').optional().isIn(['tout', 'restaurants', 'boutiques', 'transport']),
        query('rayon_km').optional().isFloat({ min: 0.1, max: 50 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('categories').optional().trim()
    ]),
    GeoController.findNearby.bind(GeoController)
);

/**
 * GET /api/v1/public/geo/details/:type/:id
 * Obtenir les détails d'une localisation (restaurant, transport)
 * Params: type (restaurant|transport), id
 * Rate limit: 120 requêtes/minute
 * Cache: 10 minutes
 * Réponse: { success, data: location_details }
 */
router.get('/geo/details/:type/:id',
    rateLimiter.publicLimiter,
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        param('type').isIn(['restaurant', 'transport']),
        param('id').isInt()
    ]),
    GeoController.getLocationDetails.bind(GeoController)
);

/**
 * GET /api/v1/public/geo/itineraire
 * Calculer un itinéraire entre deux points
 * Query: from_lat, from_lng, to_lat, to_lng, mode (driving|walking|bicycling)
 * Rate limit: 30 requêtes/minute
 * Cache: 1 minute
 * Réponse: { success, data: { distance_km, temps_estime_minutes, mode, traffic, from, to } }
 */
router.get('/geo/itineraire',
    rateLimiter.strictLimiter,
    cacheMiddleware.cache(60), // 1 minute
    validationMiddleware.validate([
        query('from_lat').isFloat(),
        query('from_lng').isFloat(),
        query('to_lat').isFloat(),
        query('to_lng').isFloat(),
        query('mode').optional().isIn(['driving', 'walking', 'bicycling'])
    ]),
    GeoController.getItinerary.bind(GeoController)
);

/**
 * GET /api/v1/public/geo/trafic
 * Obtenir les informations de trafic autour d'un point
 * Query: lat, lng, rayon_km (défaut: 2)
 * Rate limit: 60 requêtes/minute
 * Cache: 2 minutes
 * Réponse: { success, data: { niveau, incidents, vitesse_moyenne, timestamp } }
 */
router.get('/geo/trafic',
    rateLimiter.strictLimiter,
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        query('lat').isFloat(),
        query('lng').isFloat(),
        query('rayon_km').optional().isFloat({ min: 0.1, max: 10 })
    ]),
    GeoController.getTraffic.bind(GeoController)
);

/**
 * GET /api/v1/public/geo/adresses
 * Autocomplétion d'adresses
 * Query: q (min 3 caractères), limit (défaut: 10)
 * Rate limit: 60 requêtes/minute
 * Cache: 5 minutes
 * Réponse: { success, data: [{ id, label, ligne_1, ligne_2, quartier, ville, geojson }] }
 */
router.get('/geo/adresses',
    rateLimiter.strictLimiter,
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('q').isLength({ min: 3 }).trim(),
        query('limit').optional().isInt({ min: 1, max: 20 })
    ]),
    GeoController.autocompleteAddress.bind(GeoController)
);

/**
 * GET /api/v1/public/geo/villes-populaires
 * Obtenir les villes les plus actives sur la plateforme
 * Rate limit: 120 requêtes/minute
 * Cache: 1 heure
 * Réponse: { success, data: [{ ville, pays, nombre_adresses, nombre_restaurants }] }
 */
router.get('/geo/villes-populaires',
    rateLimiter.publicLimiter,
    cacheMiddleware.cache(3600), // 1 heure
    GeoController.getPopularCities.bind(GeoController)
);

// ==================== IV. STATISTIQUES PUBLIQUES ====================
// Statistiques et tendances de la plateforme

/**
 * GET /api/v1/public/stats/globales
 * Obtenir les statistiques générales de la plateforme
 * Rate limit: 60 requêtes/minute
 * Cache: 1 heure
 * Réponse: { success, data: { restaurants, boutiques, transport, utilisateurs, commandes, avis, top_villes } }
 */
router.get('/stats/globales',
    rateLimiter.publicLimiter,
    cacheMiddleware.cache(3600), // 1 heure
    StatsPubliquesController.getGlobalStats.bind(StatsPubliquesController)
);

/**
 * GET /api/v1/public/stats/tendances
 * Obtenir les tendances actuelles (produits populaires, catégories tendances)
 * Rate limit: 60 requêtes/minute
 * Cache: 30 minutes
 * Réponse: { success, data: { produits_populaires, menus_populaires, categories_tendances, periode } }
 */
router.get('/stats/tendances',
    rateLimiter.publicLimiter,
    cacheMiddleware.cache(1800), // 30 minutes
    StatsPubliquesController.getTrends.bind(StatsPubliquesController)
);

/**
 * GET /api/v1/public/stats/classement
 * Obtenir le classement des entités
 * Query: 
 *   - type: restaurants|boutiques|produits|auteurs (défaut: restaurants)
 *   - periode: 7d|30d|90d (défaut: 30d)
 *   - limit: nombre de résultats (défaut: 20)
 * Rate limit: 60 requêtes/minute
 * Cache: 1 heure
 * Réponse: { success, data: [ranking_items], type, periode }
 */
router.get('/stats/classement',
    rateLimiter.publicLimiter,
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('type').optional().isIn(['restaurants', 'boutiques', 'produits', 'auteurs']),
        query('periode').optional().isIn(['7d', '30d', '90d']),
        query('limit').optional().isInt({ min: 1, max: 50 })
    ]),
    StatsPubliquesController.getRankings.bind(StatsPubliquesController)
);

/**
 * GET /api/v1/public/stats/evolution
 * Obtenir l'évolution temporelle des métriques
 * Query: 
 *   - type: commandes|utilisateurs|avis (défaut: commandes)
 *   - periode: 7d|30d|90d|1y (défaut: 30d)
 * Rate limit: 60 requêtes/minute
 * Cache: 10 minutes
 * Réponse: { success, data: [{ periode, value, ... }], type, periode }
 */
router.get('/stats/evolution',
    rateLimiter.publicLimiter,
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        query('type').optional().isIn(['commandes', 'utilisateurs', 'avis']),
        query('periode').optional().isIn(['7d', '30d', '90d', '1y'])
    ]),
    StatsPubliquesController.getEvolution.bind(StatsPubliquesController)
);

// Routes Restaurants
router.get('/restaurants', catalogueRestaurants.listRestaurants);
router.get('/restaurants/:id', catalogueRestaurants.getRestaurantDetails);
router.get('/emplacements/:id/menus', catalogueRestaurants.getMenusByEmplacement);
router.get('/menus/:id', catalogueRestaurants.getMenuDetails);

// Routes Boutiques
router.get('/boutiques', catalogueBoutiques.listBoutiques);
router.get('/boutiques/:id', catalogueBoutiques.getBoutiqueDetails);
router.get('/boutiques/:id/produits', catalogueBoutiques.getProduitsByBoutique);
router.get('/produits/:id', catalogueBoutiques.getProduitDetails);

// Routes Transport
router.get('/transport/compagnies', catalogueTransport.listCompagnies);
router.get('/transport/compagnies/:id', catalogueTransport.getCompagnieDetails);
router.get('/transport/emplacements/:id/tickets', catalogueTransport.getTicketsByEmplacement);
router.get('/transport/tickets/:id', catalogueTransport.getTicketDetails);
router.get('/transport/itineraires', catalogueTransport.searchItineraires);

// Routes Commandes (sans compte)
router.post('/commandes/restaurant', commandesPubliques.createCommandeRestaurant);
router.post('/commandes/boutique', commandesPubliques.createCommandeBoutique);
router.get('/commandes/suivi/:reference', commandesPubliques.suivreCommande);
router.post('/commandes/:reference/annuler', commandesPubliques.annulerCommande);

// Routes Avis
router.get('/avis', avisPubliques.listAvis);
router.get('/avis/verifier', avisPubliques.checkCanLeaveAvis);
router.post('/avis', avisPubliques.createAvis);


module.exports = router;