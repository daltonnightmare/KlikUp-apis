// src/routes/v1/restauration.routes.js
/**
 * Routes de gestion de la restauration
 * API pour la gestion complète des restaurants, emplacements, menus, produits, commandes et promotions
 * Authentification requise pour la plupart des endpoints (rôles spécifiques)
 */
const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const validationMiddleware = require('../middlewares/validation.middleware');
const uploadMiddleware = require('../middlewares/upload.middleware');
const cacheMiddleware = require('../middlewares/cache.middleware');

const RestaurantController = require('../../controllers/restauration/RestaurantController');
const EmplacementRestaurantController = require('../../controllers/restauration/EmplacementRestaurantController');
const MenuController = require('../../controllers/restauration/MenuController');
const ProduitRestaurantController = require('../../controllers/restauration/ProduitRestaurantController');
const CommandeRestaurantController = require('../../controllers/restauration/CommandeRestaurantController');
const PromoController = require('../../controllers/restauration/PromoController');

// ==================== AUTHENTIFICATION GLOBALE ====================
// Toutes les routes de restauration nécessitent une authentification
// Sauf les routes publiques spécifiées individuellement
router.use(authMiddleware.authenticate);

// ==================== I. RESTAURANTS ====================
// Gestion CRUD des restaurants

/**
 * GET /api/v1/restauration/restaurants
 * Récupérer tous les restaurants
 * Query: page=1, limit=20, actif, recherche, avec_emplacements=false, tri=nom_asc|nom_desc|date_asc
 * Auth: Bearer <token>
 * Réponse: { success, data: [restaurants], pagination }
 */
router.get('/restaurants',
    /*roleMiddleware.isAdmin(),*/
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('actif').optional().isBoolean(),
        query('recherche').optional().trim().isLength({ min: 2 }),
        query('avec_emplacements').optional().isBoolean(),
        query('tri').optional().isIn(['nom_asc', 'nom_desc', 'date_asc'])
    ]),
    RestaurantController.getAll.bind(RestaurantController)
);

/**
 * GET /api/v1/restauration/restaurants/proximite
 * Récupérer les restaurants à proximité d'un point
 * Query: lat, lng, rayon_km=5, limit=20, ouvert_maintenant=false
 * Auth: Bearer <token> (ou public via middleware spécifique)
 * Cache: 5 minutes
 * Réponse: { success, data: [restaurants_avec_distance], meta }
 */
router.get('/restaurants/proximite',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('lat').isFloat({ min: -90, max: 90 }),
        query('lng').isFloat({ min: -180, max: 180 }),
        query('rayon_km').optional().isFloat({ min: 0.1, max: 50 }),
        query('limit').optional().isInt({ min: 1, max: 50 }),
        query('ouvert_maintenant').optional().isBoolean()
    ]),
    RestaurantController.getNearby.bind(RestaurantController)
);

/**
 * GET /api/v1/restauration/restaurants/:id
 * Récupérer un restaurant par ID avec ses emplacements
 * Params: id (entier)
 * Auth: Bearer <token>
 * Réponse: { success, data: restaurant_avec_emplacements_et_notes }
 */
router.get('/restaurants/:id',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    RestaurantController.getById.bind(RestaurantController)
);

/**
 * GET /api/v1/restauration/restaurants/:id/menu
 * Récupérer le menu complet d'un restaurant (tous emplacements confondus)
 * Params: id (entier)
 * Auth: Bearer <token> (ou public)
 * Cache: 2 minutes
 * Réponse: { success, data: { menus, produits, promos, restaurant_id } }
 */
router.get('/restaurants/:id/menu',
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    RestaurantController.getMenu.bind(RestaurantController)
);

/**
 * GET /api/v1/restauration/restaurants/:id/stats
 * Récupérer les statistiques d'un restaurant
 * Params: id (entier)
 * Query: periode=30j (7j, 30j, 90j)
 * Auth: Bearer <token> + ADMIN
 * Cache: 10 minutes
 * Réponse: { success, data: { global, commandes_par_statut, menus_populaires, evolution_quotidienne } }
 */
router.get('/restaurants/:id/stats',
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        param('id').isInt(),
        query('periode').optional().isIn(['7j', '30j', '90j'])
    ]),
    RestaurantController.getStats.bind(RestaurantController)
);


/**
 * PUT /api/v1/restauration/restaurants/:id
 * Mettre à jour un restaurant
 * Params: id (entier)
 * Body: { nom_restaurant_fast_food?, description_restaurant_fast_food?, logo_restaurant?, pourcentage_commission_plateforme?, est_actif? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: restaurant, message }
 */
router.put('/restaurants/:id',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nom_restaurant_fast_food').optional().trim().isLength({ min: 2, max: 255 }),
        body('description_restaurant_fast_food').optional().trim(),
        body('logo_restaurant').optional().isURL(),
        body('pourcentage_commission_plateforme').optional().isFloat({ min: 0, max: 100 }),
        body('est_actif').optional().isBoolean()
    ]),
    RestaurantController.update.bind(RestaurantController)
);

/**
 * POST /api/v1/restauration/restaurants/:id/logo
 * Uploader le logo d'un restaurant
 * Params: id (entier)
 * File: logo (image, multipart/form-data)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, message, data: fileResult }
 */
router.post('/restaurants/:id/logo',
    roleMiddleware.isAdmin(),
    uploadMiddleware.single('logo'),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    RestaurantController.uploadLogo.bind(RestaurantController)
);

/**
 * DELETE /api/v1/restauration/restaurants/:id
 * Supprimer un restaurant (soft delete)
 * Params: id (entier)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, message }
 */
router.delete('/restaurants/:id',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    RestaurantController.delete.bind(RestaurantController)
);

/**
 * POST /api/v1/restauration/restaurants/:id/restaurer
 * Restaurer un restaurant supprimé
 * Params: id (entier)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: restaurant, message }
 */
router.post('/restaurants/:id/restaurer',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    RestaurantController.restore.bind(RestaurantController)
);

// ==================== II. EMPLACEMENTS DE RESTAURANTS ====================
// Gestion des emplacements (succursales) des restaurants

/**
 * GET /api/v1/restauration/restaurants/:restaurantId/emplacements
 * Récupérer tous les emplacements d'un restaurant
 * Params: restaurantId (entier)
 * Query: page=1, limit=20, actif, recherche, avec_menu=false
 * Auth: Bearer <token>
 * Réponse: { success, data: [emplacements], pagination }
 */
router.get('/restaurants/:restaurantId/emplacements',
    validationMiddleware.validate([
        param('restaurantId').isInt(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('actif').optional().isBoolean(),
        query('recherche').optional().trim().isLength({ min: 2 }),
        query('avec_menu').optional().isBoolean()
    ]),
    EmplacementRestaurantController.getAll.bind(EmplacementRestaurantController)
);

/**
 * GET /api/v1/restauration/emplacements/:id
 * Récupérer un emplacement par ID avec aperçu des menus/produits
 * Params: id (entier)
 * Auth: Bearer <token>
 * Réponse: { success, data: emplacement_avec_apercu_menus_produits }
 */
router.get('/emplacements/:id',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    EmplacementRestaurantController.getById.bind(EmplacementRestaurantController)
);

/**
 * GET /api/v1/restauration/emplacements/:id/menu
 * Récupérer le menu complet d'un emplacement (avec catégories)
 * Params: id (entier)
 * Auth: Bearer <token> (ou public)
 * Cache: 2 minutes
 * Réponse: { success, data: { menus, produits, promos, emplacement_id } }
 */
router.get('/emplacements/:id/menu',
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    EmplacementRestaurantController.getMenu.bind(EmplacementRestaurantController)
);

/**
 * GET /api/v1/restauration/emplacements/:id/disponibilite
 * Vérifier la disponibilité d'un emplacement
 * Params: id (entier)
 * Query: date (YYYY-MM-DD, optionnel)
 * Auth: Bearer <token> (ou public)
 * Cache: 1 minute
 * Réponse: { success, data: { est_ouvert, horaires, exceptions } }
 */
router.get('/emplacements/:id/disponibilite',
    cacheMiddleware.cache(60), // 1 minute
    validationMiddleware.validate([
        param('id').isInt(),
        query('date').optional().isISO8601()
    ]),
    EmplacementRestaurantController.checkDisponibilite.bind(EmplacementRestaurantController)
);

/**
 * GET /api/v1/restauration/emplacements/:id/commandes
 * Récupérer les commandes d'un emplacement
 * Params: id (entier)
 * Query: page=1, limit=20, statut, date_debut, date_fin
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Réponse: { success, data: [commandes], pagination }
 */
router.get('/emplacements/:id/commandes',
    roleMiddleware.isGerant(),
    validationMiddleware.validate([
        param('id').isInt(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('statut').optional().isIn(['EN_ATTENTE', 'CONFIRMEE', 'EN_PREPARATION', 'PRETE', 'EN_LIVRAISON', 'LIVREE', 'RECUPEREE', 'ANNULEE']),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601()
    ]),
    EmplacementRestaurantController.getCommandes.bind(EmplacementRestaurantController)
);

/**
 * GET /api/v1/restauration/emplacements/:id/stats
 * Récupérer les statistiques d'un emplacement
 * Params: id (entier)
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Cache: 10 minutes
 * Réponse: { success, data: { stats_emplacement } }
 */
router.get('/emplacements/:id/stats',
    roleMiddleware.isGerant(),
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    EmplacementRestaurantController.getStats.bind(EmplacementRestaurantController)
);

/**
 * POST /api/v1/restauration/restaurants/:restaurantId/emplacements
 * Créer un nouvel emplacement pour un restaurant
 * Params: restaurantId (entier)
 * Body: {
 *   nom_emplacement, logo_restaurant?, favicon_restaurant?,
 *   localisation: { lat, lng }, adresse_complete,
 *   frais_livraison?, heure_ouverture?, heure_fermeture?,
 *   jours_ouverture? (LUNDI_VENDREDI|SAMEDI_DIMANCHE|TOUS_LES_JOURS)
 * }
 * Auth: Bearer <token> + ADMIN
 * Réponse: 201 { success, data: emplacement, message }
 */
router.post('/restaurants/:restaurantId/emplacements',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('restaurantId').isInt(),
        body('nom_emplacement').notEmpty().trim(),
        body('logo_restaurant').optional().isURL(),
        body('favicon_restaurant').optional().isURL(),
        body('localisation.lat').isFloat({ min: -90, max: 90 }),
        body('localisation.lng').isFloat({ min: -180, max: 180 }),
        body('adresse_complete').notEmpty().trim(),
        body('frais_livraison').optional().isFloat({ min: 0 }),
        body('heure_ouverture').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        body('heure_fermeture').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        body('jours_ouverture').optional().isIn(['LUNDI_VENDREDI', 'SAMEDI_DIMANCHE', 'TOUS_LES_JOURS'])
    ]),
    EmplacementRestaurantController.create.bind(EmplacementRestaurantController)
);

/**
 * PUT /api/v1/restauration/emplacements/:id
 * Mettre à jour un emplacement
 * Params: id (entier)
 * Body: { nom_emplacement?, logo_restaurant?, favicon_restaurant?, localisation?, adresse_complete?, frais_livraison?, heure_ouverture?, heure_fermeture?, jours_ouverture?, est_actif? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: emplacement, message }
 */
router.put('/emplacements/:id',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nom_emplacement').optional().trim(),
        body('logo_restaurant').optional(),
        body('favicon_restaurant').optional(),
        body('localisation.lat').optional().isFloat({ min: -90, max: 90 }),
        body('localisation.lng').optional().isFloat({ min: -180, max: 180 }),
        body('adresse_complete').optional().trim(),
        body('frais_livraison').optional().isFloat({ min: 0 }),
        body('heure_ouverture').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        body('heure_fermeture').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        body('jours_ouverture').optional().isIn(['LUNDI_VENDREDI', 'SAMEDI_DIMANCHE', 'TOUS_LES_JOURS']),
        body('est_actif').optional().isBoolean()
    ]),
    EmplacementRestaurantController.update.bind(EmplacementRestaurantController)
);

/**
 * POST /api/v1/restauration/emplacements/:id/logo
 * Uploader le logo d'un emplacement
 * Params: id (entier)
 * File: logo (image, multipart/form-data)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, message, data: fileResult }
 */
router.post('/emplacements/:id/logo',
    roleMiddleware.isAdmin(),
    uploadMiddleware.single('logo'),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    EmplacementRestaurantController.uploadLogo.bind(EmplacementRestaurantController)
);

/**
 * DELETE /api/v1/restauration/emplacements/:id
 * Désactiver un emplacement (soft delete)
 * Params: id (entier)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, message }
 */
router.delete('/emplacements/:id',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    EmplacementRestaurantController.delete.bind(EmplacementRestaurantController)
);

/**
 * POST /api/v1/restauration/emplacements/:id/reactiver
 * Réactiver un emplacement désactivé
 * Params: id (entier)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: emplacement, message }
 */
router.post('/emplacements/:id/reactiver',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    EmplacementRestaurantController.reactivate.bind(EmplacementRestaurantController)
);

// ==================== III. MENUS ====================
// Gestion des menus des restaurants

/**
 * GET /api/v1/restauration/emplacements/:emplacementId/menus
 * Récupérer tous les menus d'un emplacement
 * Params: emplacementId (entier)
 * Query: page=1, limit=20, categorie, disponible, prix_min, prix_max, recherche, tri=nom_asc|prix_asc|prix_desc|nom_desc
 * Auth: Bearer <token>
 * Réponse: { success, data: [menus], pagination }
 */
router.get('/emplacements/:emplacementId/menus',
    validationMiddleware.validate([
        param('emplacementId').isInt(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('categorie').optional().trim(),
        query('disponible').optional().isBoolean(),
        query('prix_min').optional().isFloat({ min: 0 }),
        query('prix_max').optional().isFloat({ min: 0 }),
        query('recherche').optional().trim().isLength({ min: 2 }),
        query('tri').optional().isIn(['nom_asc', 'nom_desc', 'prix_asc', 'prix_desc'])
    ]),
    MenuController.getAll.bind(MenuController)
);

/**
 * GET /api/v1/restauration/emplacements/:emplacementId/menus/par-categorie
 * Récupérer les menus groupés par catégorie
 * Params: emplacementId (entier)
 * Auth: Bearer <token> (ou public)
 * Cache: 2 minutes
 * Réponse: { success, data: [{ categorie, menus, total }] }
 */
router.get('/emplacements/:emplacementId/menus/par-categorie',
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        param('emplacementId').isInt()
    ]),
    MenuController.getByCategory.bind(MenuController)
);

router.get('/menus/all',cacheMiddleware.cache(120), MenuController.getAllMenus.bind(MenuController));
router.get('/menus/by-restaurant',cacheMiddleware.cache(120), MenuController.getMenusByRestaurant.bind(MenuController));

/**
 * GET /api/v1/restauration/menus/:id
 * Récupérer un menu par ID avec promos actives
 * Params: id (entier)
 * Auth: Bearer <token>
 * Réponse: { success, data: menu_avec_promos_et_notes }
 */
router.get('/menus/:id',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    MenuController.getById.bind(MenuController)
);

/**
 * POST /api/v1/restauration/emplacements/:emplacementId/menus
 * Créer un nouveau menu
 * Params: emplacementId (entier)
 * Body: {
 *   nom_menu, description_menu?, photo_menu?, photos_menu?,
 *   composition_menu?, prix_menu, temps_preparation_min?,
 *   stock_disponible?, categorie_menu, est_journalier?
 * }
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Réponse: 201 { success, data: menu, message }
 */
router.post('/emplacements/:emplacementId/menus',
    roleMiddleware.isGerant(),
    validationMiddleware.validate([
        param('emplacementId').isInt(),
        body('nom_menu').notEmpty().trim(),
        body('description_menu').optional().trim(),
        body('photo_menu').optional().isURL(),
        body('photos_menu').optional().isArray(),
        body('composition_menu').optional().isArray(),
        body('prix_menu').isFloat({ min: 0 }),
        body('temps_preparation_min').optional().isInt({ min: 1 }),
        body('stock_disponible').optional().isInt({ min: -1 }),
        body('categorie_menu').notEmpty(),
        body('est_journalier').optional().isBoolean()
    ]),
    MenuController.create.bind(MenuController)
);

/**
 * PUT /api/v1/restauration/menus/:id
 * Mettre à jour un menu
 * Params: id (entier)
 * Body: { nom_menu?, description_menu?, photo_menu?, photos_menu?, composition_menu?, prix_menu?, temps_preparation_min?, stock_disponible?, categorie_menu?, est_journalier?, disponible? }
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Réponse: { success, data: menu, message }
 */
router.put('/menus/:id',
    roleMiddleware.isGerant(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nom_menu').optional().trim(),
        body('description_menu').optional().trim(),
        body('photo_menu').optional().isURL(),
        body('photos_menu').optional().isArray(),
        body('composition_menu').optional().isArray(),
        body('prix_menu').optional().isFloat({ min: 0 }),
        body('temps_preparation_min').optional().isInt({ min: 1 }),
        body('stock_disponible').optional().isInt({ min: -1 }),
        body('categorie_menu').optional(),
        body('est_journalier').optional().isBoolean(),
        body('disponible').optional().isBoolean()
    ]),
    MenuController.update.bind(MenuController)
);

/**
 * POST /api/v1/restauration/menus/:id/photo
 * Uploader une photo pour un menu
 * Params: id (entier)
 * File: photo (image, multipart/form-data)
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Réponse: { success, message, data: { fileResult, toutes_photos } }
 */
router.post('/menus/:id/photo',
    roleMiddleware.isGerant(),
    uploadMiddleware.single('photo'),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    MenuController.uploadPhoto.bind(MenuController)
);

/**
 * DELETE /api/v1/restauration/menus/:id/photo
 * Supprimer une photo d'un menu
 * Params: id (entier)
 * Body: { photo_url }
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Réponse: { success, message, data: { photos_restantes, photo_principale } }
 */
router.delete('/menus/:id/photo',
    roleMiddleware.isGerant(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('photo_url').isURL()
    ]),
    MenuController.deletePhoto.bind(MenuController)
);

/**
 * PATCH /api/v1/restauration/menus/:id/stock
 * Mettre à jour le stock d'un menu
 * Params: id (entier)
 * Body: { operation: 'incrementer'|'decrementer'|'fixer', quantite }
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Réponse: { success, data: { stock_disponible, disponible } }
 */
router.patch('/menus/:id/stock',
    roleMiddleware.isGerant(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('operation').isIn(['incrementer', 'decrementer', 'fixer']),
        body('quantite').isInt({ min: 0 })
    ]),
    MenuController.updateStock.bind(MenuController)
);

/**
 * POST /api/v1/restauration/menus/:id/dupliquer
 * Dupliquer un menu
 * Params: id (entier)
 * Body: { nouveau_nom? }
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Réponse: 201 { success, data: { nouveau_menu, source }, message }
 */
router.post('/menus/:id/dupliquer',
    roleMiddleware.isGerant(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nouveau_nom').optional().trim()
    ]),
    MenuController.duplicate.bind(MenuController)
);

/**
 * GET /api/v1/restauration/menus/stats
 * Récupérer les statistiques des menus
 * Query: emplacementId?
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Cache: 10 minutes
 * Réponse: { success, data: { total_menus, prix_moyen, ... } }
 */
router.get('/menus/stats',
    roleMiddleware.isGerant(),
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        query('emplacementId').optional().isInt()
    ]),
    MenuController.getStats.bind(MenuController)
);

/**
 * GET /api/v1/restauration/menus/recherche
 * Rechercher des menus
 * Query: q, categorie?, prix_max?, disponible?, emplacement_id?, limit=20
 * Auth: Bearer <token> (ou public)
 * Cache: 2 minutes
 * Réponse: { success, data: [menus], count }
 */
router.get('/menus/recherche',
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        query('q').optional().trim().isLength({ min: 2 }),
        query('categorie').optional().trim(),
        query('prix_max').optional().isFloat({ min: 0 }),
        query('disponible').optional().isBoolean(),
        query('emplacement_id').optional().isInt(),
        query('limit').optional().isInt({ min: 1, max: 50 })
    ]),
    MenuController.search.bind(MenuController)
);

/**
 * DELETE /api/v1/restauration/menus/:id
 * Supprimer un menu (soft delete si utilisé dans commandes)
 * Params: id (entier)
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Réponse: { success, message }
 */
router.delete('/menus/:id',
    roleMiddleware.isGerant(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    MenuController.delete.bind(MenuController)
);

// ==================== IV. PRODUITS DE RESTAURANTS ====================
// Gestion des produits individuels des restaurants

/**
 * GET /api/v1/restauration/emplacements/:emplacementId/produits
 * Récupérer tous les produits d'un emplacement
 * Params: emplacementId (entier)
 * Query: page=1, limit=20, categorie, disponible, prix_min, prix_max, recherche, tri=nom_asc|prix_asc|prix_desc|nom_desc
 * Auth: Bearer <token>
 * Réponse: { success, data: [produits], pagination }
 */
router.get('/emplacements/:emplacementId/produits',
    validationMiddleware.validate([
        param('emplacementId').isInt(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('categorie').optional().trim(),
        query('disponible').optional().isBoolean(),
        query('prix_min').optional().isFloat({ min: 0 }),
        query('prix_max').optional().isFloat({ min: 0 }),
        query('recherche').optional().trim().isLength({ min: 2 }),
        query('tri').optional().isIn(['nom_asc', 'nom_desc', 'prix_asc', 'prix_desc'])
    ]),
    ProduitRestaurantController.getAll.bind(ProduitRestaurantController)
);

router.get('/produits/all', ProduitRestaurantController.getAllProduits.bind(ProduitRestaurantController));
router.get('/produits/by-restaurant', ProduitRestaurantController.getProduitsByRestaurant.bind(ProduitRestaurantController));
router.get('/produits/by-category', ProduitRestaurantController.getProduitsByCategory.bind(ProduitRestaurantController));
router.get('/produits/global-stats', ProduitRestaurantController.getGlobalStats.bind(ProduitRestaurantController));
router.get('/produits/en-promo', ProduitRestaurantController.getProduitsEnPromo.bind(ProduitRestaurantController));

/**
 * GET /api/v1/restauration/emplacements/:emplacementId/produits/par-categorie
 * Récupérer les produits groupés par catégorie
 * Params: emplacementId (entier)
 * Auth: Bearer <token> (ou public)
 * Cache: 2 minutes
 * Réponse: { success, data: [{ categorie, produits, total }] }
 */
router.get('/emplacements/:emplacementId/produits/par-categorie',
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        param('emplacementId').isInt()
    ]),
    ProduitRestaurantController.getByCategory.bind(ProduitRestaurantController)
);

/**
 * GET /api/v1/restauration/produits/:id
 * Récupérer un produit par ID avec promos actives
 * Params: id (entier)
 * Auth: Bearer <token>
 * Réponse: { success, data: produit_avec_promos_et_notes }
 */
router.get('/produits/:id',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ProduitRestaurantController.getById.bind(ProduitRestaurantController)
);

/**
 * POST /api/v1/restauration/emplacements/:emplacementId/produits
 * Créer un nouveau produit
 * Params: emplacementId (entier)
 * Body: {
 *   nom_produit, description_produit?, photo_produit?, donnees_produit?,
 *   prix_produit, stock_disponible?, categorie_produit?, est_journalier?
 * }
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Réponse: 201 { success, data: produit, message }
 */
router.post('/emplacements/:emplacementId/produits',
    roleMiddleware.isGerant(),
    validationMiddleware.validate([
        param('emplacementId').isInt(),
        body('nom_produit').notEmpty().trim(),
        body('description_produit').optional().trim(),
        body('photo_produit').optional().isURL(),
        body('donnees_produit').optional().isObject(),
        body('prix_produit').isFloat({ min: 0 }),
        body('stock_disponible').optional().isInt({ min: -1 }),
        body('categorie_produit').optional(),
        body('est_journalier').optional().isBoolean()
    ]),
    ProduitRestaurantController.create.bind(ProduitRestaurantController)
);

/**
 * PUT /api/v1/restauration/produits/:id
 * Mettre à jour un produit
 * Params: id (entier)
 * Body: { nom_produit?, description_produit?, photo_produit?, donnees_produit?, prix_produit?, stock_disponible?, categorie_produit?, est_journalier?, disponible? }
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Réponse: { success, data: produit, message }
 */
router.put('/produits/:id',
    roleMiddleware.isGerant(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nom_produit').optional().trim(),
        body('description_produit').optional().trim(),
        body('photo_produit').optional().isURL(),
        body('donnees_produit').optional().isObject(),
        body('prix_produit').optional().isFloat({ min: 0 }),
        body('stock_disponible').optional().isInt({ min: -1 }),
        body('categorie_produit').optional(),
        body('est_journalier').optional().isBoolean(),
        body('disponible').optional().isBoolean()
    ]),
    ProduitRestaurantController.update.bind(ProduitRestaurantController)
);

/**
 * POST /api/v1/restauration/produits/:id/photo
 * Uploader une photo pour un produit
 * Params: id (entier)
 * File: photo (image, multipart/form-data)
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Réponse: { success, message, data: fileResult }
 */
router.post('/produits/:id/photo',
    roleMiddleware.isGerant(),
    uploadMiddleware.single('photo'),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ProduitRestaurantController.uploadPhoto.bind(ProduitRestaurantController)
);

/**
 * PATCH /api/v1/restauration/produits/:id/stock
 * Mettre à jour le stock d'un produit
 * Params: id (entier)
 * Body: { operation: 'incrementer'|'decrementer'|'fixer', quantite }
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Réponse: { success, data: { stock_disponible, disponible } }
 */
router.patch('/produits/:id/stock',
    roleMiddleware.isGerant(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('operation').isIn(['incrementer', 'decrementer', 'fixer']),
        body('quantite').isInt({ min: 0 })
    ]),
    ProduitRestaurantController.updateStock.bind(ProduitRestaurantController)
);

/**
 * POST /api/v1/restauration/produits/:id/dupliquer
 * Dupliquer un produit
 * Params: id (entier)
 * Body: { nouveau_nom? }
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Réponse: 201 { success, data: { nouveau_produit, source }, message }
 */
router.post('/produits/:id/dupliquer',
    roleMiddleware.isGerant(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nouveau_nom').optional().trim()
    ]),
    ProduitRestaurantController.duplicate.bind(ProduitRestaurantController)
);

/**
 * GET /api/v1/restauration/produits/recherche
 * Rechercher des produits
 * Query: q, categorie?, prix_min?, prix_max?, disponible?, emplacement_id?, limit=20
 * Auth: Bearer <token> (ou public)
 * Cache: 2 minutes
 * Réponse: { success, data: [produits], count }
 */
router.get('/produits/recherche',
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        query('q').optional().trim().isLength({ min: 2 }),
        query('categorie').optional().trim(),
        query('prix_min').optional().isFloat({ min: 0 }),
        query('prix_max').optional().isFloat({ min: 0 }),
        query('disponible').optional().isBoolean(),
        query('emplacement_id').optional().isInt(),
        query('limit').optional().isInt({ min: 1, max: 50 })
    ]),
    ProduitRestaurantController.search.bind(ProduitRestaurantController)
);

/**
 * GET /api/v1/restauration/produits/stats
 * Récupérer les statistiques des produits
 * Query: emplacementId?
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Cache: 10 minutes
 * Réponse: { success, data: { total_produits, prix_moyen, ... } }
 */
router.get('/produits/stats',
    roleMiddleware.isGerant(),
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        query('emplacementId').optional().isInt()
    ]),
    ProduitRestaurantController.getStats.bind(ProduitRestaurantController)
);

/**
 * POST /api/v1/restauration/produits/mise-a-jour-massive
 * Mise à jour massive des prix
 * Body: { emplacement_id, categorie?, pourcentage_augmentation?, montant_fixe? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: { produits_modifies, emplacement_id, categorie } }
 */
router.post('/produits/mise-a-jour-massive',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        body('emplacement_id').isInt(),
        body('categorie').optional().trim(),
        body('pourcentage_augmentation').optional().isFloat({ min: -100, max: 1000 }),
        body('montant_fixe').optional().isFloat({ min: -10000, max: 10000 }),
        body().custom(body => {
            if (!body.pourcentage_augmentation && !body.montant_fixe) {
                throw new Error('Pourcentage ou montant fixe requis');
            }
            return true;
        })
    ]),
    ProduitRestaurantController.bulkUpdatePrices.bind(ProduitRestaurantController)
);

/**
 * DELETE /api/v1/restauration/produits/:id
 * Supprimer un produit (soft delete si utilisé dans commandes)
 * Params: id (entier)
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Réponse: { success, message }
 */
router.delete('/produits/:id',
    roleMiddleware.isGerant(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ProduitRestaurantController.delete.bind(ProduitRestaurantController)
);

// ==================== V. COMMANDES RESTAURANTS ====================
// Gestion des commandes de restaurants

/**
 * GET /api/v1/restauration/emplacements/:emplacementId/commandes
 * Récupérer toutes les commandes d'un emplacement
 * Params: emplacementId (entier)
 * Query: page=1, limit=20, statut, date_debut, date_fin, client_id, avec_details=false, tri=date_desc
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Réponse: { success, data: [commandes], pagination, stats }
 */
router.get('/emplacements/:emplacementId/commandes',
    roleMiddleware.isGerant(),
    validationMiddleware.validate([
        param('emplacementId').isInt(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('statut').optional().isIn(['EN_ATTENTE', 'CONFIRMEE', 'EN_PREPARATION', 'PRETE', 'EN_LIVRAISON', 'LIVREE', 'RECUPEREE', 'ANNULEE']),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601(),
        query('client_id').optional().isInt(),
        query('avec_details').optional().isBoolean(),
        query('tri').optional().isIn(['date_desc', 'date_asc', 'montant_desc', 'montant_asc'])
    ]),
    CommandeRestaurantController.getAll.bind(CommandeRestaurantController)
);

/**
 * GET /api/v1/restauration/clients/:clientId/commandes
 * Récupérer les commandes d'un client spécifique
 * Params: clientId (entier)
 * Query: page=1, limit=20, statut, date_debut, date_fin
 * Auth: Bearer <token> (le client lui-même ou admin)
 * Réponse: { success, data: [commandes], pagination }
 */
router.get('/clients/:clientId/commandes',
    validationMiddleware.validate([
        param('clientId').isInt(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('statut').optional().isIn(['EN_ATTENTE', 'CONFIRMEE', 'EN_PREPARATION', 'PRETE', 'EN_LIVRAISON', 'LIVREE', 'RECUPEREE', 'ANNULEE']),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601()
    ]),
    CommandeRestaurantController.getByClient.bind(CommandeRestaurantController)
);

/**
 * GET /api/v1/restauration/commandes/:id
 * Récupérer une commande par ID avec détails
 * Params: id (entier)
 * Auth: Bearer <token> (client propriétaire, gérant ou admin)
 * Réponse: { success, data: commande_avec_details }
 */
router.get('/commandes/:id',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    CommandeRestaurantController.getById.bind(CommandeRestaurantController)
);

/**
 * GET /api/v1/restauration/commandes/:id/ticket
 * Récupérer le ticket de caisse d'une commande
 * Params: id (entier)
 * Auth: Bearer <token> (client propriétaire, gérant ou admin)
 * Réponse: { success, data: ticket_data }
 */
router.get('/commandes/:id/ticket',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    CommandeRestaurantController.getTicket.bind(CommandeRestaurantController)
);

/**
 * GET /api/v1/restauration/commandes/:id/temps-estime
 * Estimer le temps de préparation restant
 * Params: id (entier)
 * Auth: Bearer <token> (client propriétaire, gérant ou admin)
 * Cache: 30 secondes
 * Réponse: { success, data: { temps_estime_total, temps_ecoule, temps_restant_estime, date_estimee_fin } }
 */
router.get('/commandes/:id/temps-estime',
    cacheMiddleware.cache(30), // 30 secondes
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    CommandeRestaurantController.getTempsEstime.bind(CommandeRestaurantController)
);

/**
 * GET /api/v1/restauration/commandes/dashboard
 * Récupérer le tableau de bord des commandes
 * Query: emplacement_id? ou restaurant_id?
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Cache: 2 minutes
 * Réponse: { success, data: { stats_globales, repartition_horaire, articles_populaires } }
 */
router.get('/commandes/dashboard',
    roleMiddleware.isGerant(),
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        query('emplacement_id').optional().isInt(),
        query('restaurant_id').optional().isInt()
    ]),
    CommandeRestaurantController.getDashboard.bind(CommandeRestaurantController)
);

/**
 * POST /api/v1/restauration/emplacements/:emplacementId/commandes
 * Créer une nouvelle commande
 * Params: emplacementId (entier)
 * Body: {
 *   donnees_commande: [{ type: 'menu'|'produit', id, quantite, ... }],
 *   pour_livrer?, passer_recuperer?,
 *   paiement_direct?, paiement_a_la_livraison?, paiement_a_la_recuperation?,
 *   notes_commande?, adresse_livraison_id?, code_promo?
 * }
 * Auth: Bearer <token> (client)
 * Réponse: 201 { success, data: { commande, recapitulatif }, message }
 */
router.post('/emplacements/:emplacementId/commandes',
    validationMiddleware.validate([
        param('emplacementId').isInt(),
        body('donnees_commande').isArray().notEmpty(),
        body('pour_livrer').optional().isBoolean(),
        body('passer_recuperer').optional().isBoolean(),
        body('paiement_direct').optional().isBoolean(),
        body('paiement_a_la_livraison').optional().isBoolean(),
        body('paiement_a_la_recuperation').optional().isBoolean(),
        body('notes_commande').optional().trim(),
        body('adresse_livraison_id').optional().isInt(),
        body('code_promo').optional().trim(),
        body().custom(body => {
            // Vérifier qu'au moins un mode de paiement est sélectionné
            const paiements = [body.paiement_direct, body.paiement_a_la_livraison, body.paiement_a_la_recuperation];
            if (!paiements.includes(true)) {
                throw new Error('Au moins un mode de paiement doit être sélectionné');
            }
            // Vérifier qu'au moins un mode de retrait est sélectionné
            if (!body.pour_livrer && !body.passer_recuperer) {
                throw new Error('Au moins un mode de retrait (livraison ou récupération) doit être sélectionné');
            }
            return true;
        })
    ]),
    CommandeRestaurantController.create.bind(CommandeRestaurantController)
);

/**
 * PATCH /api/v1/restauration/commandes/:id/statut
 * Mettre à jour le statut d'une commande
 * Params: id (entier)
 * Body: { statut, motif? (pour annulation) }
 * Auth: Bearer <token> + ROLE_GERANT ou ADMIN
 * Réponse: { success, data: { ancien_statut, nouveau_statut }, message }
 */
router.patch('/commandes/:id/statut',
    roleMiddleware.isGerant(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('statut').isIn(['CONFIRMEE', 'EN_PREPARATION', 'PRETE', 'EN_LIVRAISON', 'LIVREE', 'RECUPEREE', 'ANNULEE']),
        body('motif').optional().trim()
    ]),
    CommandeRestaurantController.updateStatut.bind(CommandeRestaurantController)
);

/**
 * POST /api/v1/restauration/commandes/:id/annuler
 * Annuler une commande (par le client)
 * Params: id (entier)
 * Body: { motif? }
 * Auth: Bearer <token> (client propriétaire)
 * Réponse: { success, message }
 */
router.post('/commandes/:id/annuler',
    validationMiddleware.validate([
        param('id').isInt(),
        body('motif').optional().trim()
    ]),
    CommandeRestaurantController.cancel.bind(CommandeRestaurantController)
);

// ==================== VI. PROMOTIONS ====================
// Gestion des codes promo et réductions

/**
 * GET /api/v1/restauration/promos
 * Récupérer toutes les promotions
 * Query: page=1, limit=20, actif, type_promo, restaurant_id, emplacement_id, recherche, tri
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: [promos], pagination }
 */
router.get('/promos',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('actif').optional().isBoolean(),
        query('type_promo').optional().isIn(['POURCENTAGE', 'MONTANT_FIXE', 'LIVRAISON_GRATUITE', 'DEUX_POUR_UN']),
        query('restaurant_id').optional().isInt(),
        query('emplacement_id').optional().isInt(),
        query('recherche').optional().trim().isLength({ min: 2 }),
        query('tri').optional().isIn(['date_creation_desc', 'date_debut_asc', 'date_fin_asc', 'utilisation_desc'])
    ]),
    PromoController.getAll.bind(PromoController)
);

// Routes pour toutes les promotions
router.get('/promos/all', cacheMiddleware.cache(300), PromoController.getAllPromos.bind(PromoController));
router.get('/promos/by-restaurant', cacheMiddleware.cache(300),PromoController.getPromosByRestaurant.bind(PromoController));
router.get('/promos/by-type', cacheMiddleware.cache(300),PromoController.getPromosByType.bind(PromoController));
router.get('/promos/expirant-bientot', cacheMiddleware.cache(300),PromoController.getExpiringSoon.bind(PromoController));

/**
 * GET /api/v1/restauration/promos/actives
 * Récupérer les promotions actives du moment
 * Query: emplacement_id?, restaurant_id?, limit=10
 * Auth: Bearer <token> (ou public)
 * Cache: 5 minutes
 * Réponse: { success, data: [promos_avec_jours_restants] }
 */
router.get('/promos/actives',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('emplacement_id').optional().isInt(),
        query('restaurant_id').optional().isInt(),
        query('limit').optional().isInt({ min: 1, max: 50 })
    ]),
    PromoController.getActivePromos.bind(PromoController)
);

/**
 * GET /api/v1/restauration/promos/:id
 * Récupérer une promotion par ID avec associations
 * Params: id (entier)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: promo_avec_menus_et_produits_associes }
 */
router.get('/promos/:id',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    PromoController.getById.bind(PromoController)
);

/**
 * GET /api/v1/restauration/promos/stats
 * Récupérer les statistiques des promotions
 * Query: emplacement_id?, restaurant_id?
 * Auth: Bearer <token> + ADMIN
 * Cache: 10 minutes
 * Réponse: { success, data: { stats_globales, statistiques_par_type } }
 */
router.get('/promos/stats',
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        query('emplacement_id').optional().isInt(),
        query('restaurant_id').optional().isInt()
    ]),
    PromoController.getStats.bind(PromoController)
);

/**
 * POST /api/v1/restauration/emplacements/:emplacementId/promos
 * Créer une nouvelle promotion
 * Params: emplacementId (entier)
 * Body: {
 *   nom_promo, description_promo?, code_promo?, type_promo,
 *   pourcentage_reduction? (si type POURCENTAGE),
 *   montant_fixe_reduction? (si type MONTANT_FIXE),
 *   date_debut_promo, date_fin_promo,
 *   utilisation_max?, produits_affectes?
 * }
 * Auth: Bearer <token> + ADMIN
 * Réponse: 201 { success, data: promo, message }
 */
router.post('/emplacements/:emplacementId/promos',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('emplacementId').isInt(),
        body('nom_promo').notEmpty().trim(),
        body('description_promo').optional().trim(),
        body('code_promo').optional().trim(),
        body('type_promo').isIn(['POURCENTAGE', 'MONTANT_FIXE', 'LIVRAISON_GRATUITE', 'DEUX_POUR_UN']),
        body('pourcentage_reduction').if(body('type_promo').equals('POURCENTAGE')).isFloat({ min: 1, max: 100 }),
        body('montant_fixe_reduction').if(body('type_promo').equals('MONTANT_FIXE')).isFloat({ min: 0 }),
        body('date_debut_promo').isISO8601(),
        body('date_fin_promo').isISO8601(),
        body('utilisation_max').optional().isInt({ min: -1 }),
        body('produits_affectes').optional().isArray()
    ]),
    PromoController.create.bind(PromoController)
);

/**
 * PUT /api/v1/restauration/promos/:id
 * Mettre à jour une promotion
 * Params: id (entier)
 * Body: { nom_promo?, description_promo?, code_promo?, type_promo?, pourcentage_reduction?, montant_fixe_reduction?, date_debut_promo?, date_fin_promo?, utilisation_max?, produits_affectes?, actif? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: promo, message }
 */
router.put('/promos/:id',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nom_promo').optional().trim(),
        body('description_promo').optional().trim(),
        body('code_promo').optional().trim(),
        body('type_promo').optional().isIn(['POURCENTAGE', 'MONTANT_FIXE', 'LIVRAISON_GRATUITE', 'DEUX_POUR_UN']),
        body('pourcentage_reduction').optional().isFloat({ min: 1, max: 100 }),
        body('montant_fixe_reduction').optional().isFloat({ min: 0 }),
        body('date_debut_promo').optional().isISO8601(),
        body('date_fin_promo').optional().isISO8601(),
        body('utilisation_max').optional().isInt({ min: -1 }),
        body('produits_affectes').optional().isArray(),
        body('actif').optional().isBoolean()
    ]),
    PromoController.update.bind(PromoController)
);

/**
 * POST /api/v1/restauration/promos/:id/menus
 * Associer des menus à une promotion
 * Params: id (entier)
 * Body: { menu_ids: [int] }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, message }
 */
router.post('/promos/:id/menus',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('menu_ids').isArray().notEmpty()
    ]),
    PromoController.addMenus.bind(PromoController)
);

/**
 * POST /api/v1/restauration/promos/:id/produits
 * Associer des produits à une promotion
 * Params: id (entier)
 * Body: { produit_ids: [int] }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, message }
 */
router.post('/promos/:id/produits',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('produit_ids').isArray().notEmpty()
    ]),
    PromoController.addProduits.bind(PromoController)
);

/**
 * DELETE /api/v1/restauration/promos/:id/menus
 * Retirer des menus d'une promotion
 * Params: id (entier)
 * Body: { menu_ids: [int] }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, message }
 */
router.delete('/promos/:id/menus',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('menu_ids').isArray().notEmpty()
    ]),
    PromoController.removeMenus.bind(PromoController)
);

/**
 * DELETE /api/v1/restauration/promos/:id/produits
 * Retirer des produits d'une promotion
 * Params: id (entier)
 * Body: { produit_ids: [int] }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, message }
 */
router.delete('/promos/:id/produits',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('produit_ids').isArray().notEmpty()
    ]),
    PromoController.removeProduits.bind(PromoController)
);

/**
 * POST /api/v1/restauration/promos/valider
 * Valider et utiliser un code promo
 * Body: { code_promo, montant_commande, produits_ids? }
 * Auth: Bearer <token> (client)
 * Réponse: { success, data: { promo, calcul }, message }
 */
router.post('/promos/valider',
    validationMiddleware.validate([
        body('code_promo').notEmpty().trim(),
        body('montant_commande').isFloat({ min: 0 }),
        body('produits_ids').optional().isArray()
    ]),
    PromoController.validateAndUse.bind(PromoController)
);

/**
 * PATCH /api/v1/restauration/promos/:id/desactiver
 * Désactiver une promotion
 * Params: id (entier)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: promo, message }
 */
router.patch('/promos/:id/desactiver',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    PromoController.deactivate.bind(PromoController)
);

/**
 * PATCH /api/v1/restauration/promos/:id/activer
 * Activer une promotion
 * Params: id (entier)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: promo, message }
 */
router.patch('/promos/:id/activer',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    PromoController.activate.bind(PromoController)
);

/**
 * POST /api/v1/restauration/promos/:id/dupliquer
 * Dupliquer une promotion
 * Params: id (entier)
 * Body: { nouveau_nom?, nouvelles_dates?: { debut, fin } }
 * Auth: Bearer <token> + ADMIN
 * Réponse: 201 { success, data: { nouvelle_promo, source }, message }
 */
router.post('/promos/:id/dupliquer',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nouveau_nom').optional().trim(),
        body('nouvelles_dates.debut').optional().isISO8601(),
        body('nouvelles_dates.fin').optional().isISO8601()
    ]),
    PromoController.duplicate.bind(PromoController)
);

/**
 * DELETE /api/v1/restauration/promos/:id
 * Supprimer une promotion
 * Params: id (entier)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, message }
 */
router.delete('/promos/:id',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    PromoController.delete.bind(PromoController)
);

module.exports = router;