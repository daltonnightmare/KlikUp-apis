// src/routes/v1/boutique.routes.js
/**
 * Routes de gestion des boutiques
 * API pour la gestion complète des boutiques, catégories, produits et commandes
 * Accès public pour la consultation, authentification requise pour les actions
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

const BoutiqueController = require('../../controllers/boutique/BoutiqueController');
const CategorieBoutiqueController = require('../../controllers/boutique/CategorieBoutiqueController');
const ProduitBoutiqueController = require('../../controllers/boutique/ProduitBoutiqueController');
const CommandeBoutiqueController = require('../../controllers/boutique/CommandeBoutiqueController');

// ==================== CONFIGURATION RATE LIMITING ====================

const commandeCreationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 10, // 10 commandes max par heure
    message: 'Trop de commandes. Réessayez plus tard.',
    standardHeaders: true,
    legacyHeaders: false
});

const produitCreationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 50, // 50 produits max par heure
    message: 'Trop de créations de produits. Réessayez plus tard.',
    standardHeaders: true,
    legacyHeaders: false
});

// ==================== I. BOUTIQUES ====================

/**
 * POST /api/v1/boutiques
 * Créer une nouvelle boutique
 * Headers: Authorization: Bearer <token>
 * Body: {
 *   nom_boutique, description_boutique?, types_produits_vendu?,
 *   plateforme_id, pourcentage_commission_plateforme, configuration?
 * }
 * Files: logo?, favicon? (multipart/form-data)
 * Auth: ADMIN
 * Réponse: 201 { status, data }
 */
router.post('/',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    uploadMiddleware.fields([
        { name: 'logo', maxCount: 1 },
        { name: 'favicon', maxCount: 1 }
    ]),
    validationMiddleware.validate([
        body('nom_boutique').notEmpty().trim().isLength({ min: 3, max: 255 }),
        body('description_boutique').optional().trim(),
        body('types_produits_vendu').optional().isArray(),
        body('plateforme_id').isInt(),
        body('pourcentage_commission_plateforme').isFloat({ min: 0, max: 100 }),
        body('configuration').optional().isObject()
    ]),
    BoutiqueController.create.bind(BoutiqueController)
);

/**
 * GET /api/v1/boutiques
 * Récupérer toutes les boutiques avec filtres avancés
 * Query: page=1, limit=20, search?, est_actif?, plateforme_id?,
 *        avec_produits?, avec_avis?, proximite?, lat?, lng?,
 *        rayon_km=10, categorie_produit?, note_min?, tri
 * Auth: PUBLIC
 * Réponse: { status, data, pagination }
 */
router.get('/',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('search').optional().trim(),
        query('est_actif').optional().isBoolean(),
        query('plateforme_id').optional().isInt(),
        query('avec_produits').optional().isBoolean(),
        query('avec_avis').optional().isBoolean(),
        query('proximite').optional().isBoolean(),
        query('lat').optional().isFloat({ min: -90, max: 90 }),
        query('lng').optional().isFloat({ min: -180, max: 180 }),
        query('rayon_km').optional().isFloat({ min: 0.1, max: 50 }),
        query('categorie_produit').optional().trim(),
        query('note_min').optional().isFloat({ min: 0, max: 5 }),
        query('tri').optional().isIn(['nom_asc', 'nom_desc', 'date_creation_asc', 'date_creation_desc', 'note_moyenne_desc'])
    ]),
    BoutiqueController.findAll.bind(BoutiqueController)
);

/**
 * GET /api/v1/boutiques/:id
 * Récupérer une boutique par ID
 * Params: id
 * Query: inclure_produits?, inclure_avis?, inclure_horaires?
 * Auth: PUBLIC
 * Réponse: { status, data }
 */
router.get('/:id',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        param('id').isInt(),
        query('inclure_produits').optional().isBoolean(),
        query('inclure_avis').optional().isBoolean(),
        query('inclure_horaires').optional().isBoolean()
    ]),
    BoutiqueController.findById.bind(BoutiqueController)
);

/**
 * PUT /api/v1/boutiques/:id
 * Mettre à jour une boutique
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { nom_boutique?, description_boutique?, types_produits_vendu?,
 *         pourcentage_commission_plateforme?, est_actif?, configuration? }
 * Files: logo?, favicon? (multipart/form-data)
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE
 * Réponse: { status, data }
 */
router.put('/:id',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueOwner(),
    uploadMiddleware.fields([
        { name: 'logo', maxCount: 1 },
        { name: 'favicon', maxCount: 1 }
    ]),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nom_boutique').optional().trim().isLength({ min: 3, max: 255 }),
        body('description_boutique').optional().trim(),
        body('types_produits_vendu').optional().isArray(),
        body('pourcentage_commission_plateforme').optional().isFloat({ min: 0, max: 100 }),
        body('est_actif').optional().isBoolean(),
        body('configuration').optional().isObject()
    ]),
    BoutiqueController.update.bind(BoutiqueController)
);

/**
 * DELETE /api/v1/boutiques/:id
 * Supprimer une boutique (soft delete)
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { raison? }
 * Auth: ADMIN
 * Réponse: { status, message }
 */
router.delete('/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('raison').optional().trim()
    ]),
    BoutiqueController.delete.bind(BoutiqueController)
);

/**
 * GET /api/v1/boutiques/:id/stats
 * Récupérer les statistiques d'une boutique
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Query: periode=30j
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE
 * Cache: 10 minutes
 * Réponse: { status, data }
 */
router.get('/:id/stats',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueOwner(),
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        param('id').isInt(),
        query('periode').optional().isIn(['7j', '30j', '90j'])
    ]),
    BoutiqueController.getStats.bind(BoutiqueController)
);

// ==================== II. CATÉGORIES DE BOUTIQUES ====================

/**
 * POST /api/v1/boutiques/:boutiqueId/categories
 * Créer une nouvelle catégorie
 * Headers: Authorization: Bearer <token>
 * Params: boutiqueId
 * Body: { nom_categorie, description_categorie?, slug_categorie?, categorie_parente_id?, ordre_affichage=0 }
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE, STAFF_BOUTIQUE
 * Réponse: 201 { status, data }
 */
router.post('/:boutiqueId/categories',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueStaff(),
    validationMiddleware.validate([
        param('boutiqueId').isInt(),
        body('nom_categorie').notEmpty().trim().isLength({ min: 2, max: 100 }),
        body('description_categorie').optional().trim(),
        body('slug_categorie').optional().trim(),
        body('categorie_parente_id').optional().isInt(),
        body('ordre_affichage').optional().isInt({ min: 0 })
    ]),
    CategorieBoutiqueController.create.bind(CategorieBoutiqueController)
);

/**
 * GET /api/v1/boutiques/:boutiqueId/categories
 * Récupérer toutes les catégories d'une boutique
 * Params: boutiqueId
 * Query: inclure_produits?, inclure_sous_categories?
 * Auth: PUBLIC
 * Cache: 5 minutes
 * Réponse: { status, data: arbre_des_categories }
 */
router.get('/:boutiqueId/categories',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        param('boutiqueId').isInt(),
        query('inclure_produits').optional().isBoolean(),
        query('inclure_sous_categories').optional().isBoolean()
    ]),
    CategorieBoutiqueController.findAll.bind(CategorieBoutiqueController)
);

/**
 * PUT /api/v1/boutiques/categories/:id
 * Mettre à jour une catégorie
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { nom_categorie?, description_categorie?, slug_categorie?,
 *         categorie_parente_id?, ordre_affichage?, est_actif? }
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE, STAFF_BOUTIQUE
 * Réponse: { status, data }
 */
router.put('/categories/:id',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueStaff(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nom_categorie').optional().trim().isLength({ min: 2, max: 100 }),
        body('description_categorie').optional().trim(),
        body('slug_categorie').optional().trim(),
        body('categorie_parente_id').optional().isInt(),
        body('ordre_affichage').optional().isInt({ min: 0 }),
        body('est_actif').optional().isBoolean()
    ]),
    CategorieBoutiqueController.update.bind(CategorieBoutiqueController)
);

/**
 * DELETE /api/v1/boutiques/categories/:id
 * Supprimer une catégorie
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { transfert_produits_vers?, force=false }
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE
 * Réponse: { status, message }
 */
router.delete('/categories/:id',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueOwner(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('transfert_produits_vers').optional().isInt(),
        body('force').optional().isBoolean()
    ]),
    CategorieBoutiqueController.delete.bind(CategorieBoutiqueController)
);

/**
 * POST /api/v1/boutiques/:boutiqueId/categories/reorder
 * Réorganiser les catégories
 * Headers: Authorization: Bearer <token>
 * Params: boutiqueId
 * Body: { ordres: [{ id, ordre_affichage }] }
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE, STAFF_BOUTIQUE
 * Réponse: { status, message }
 */
router.post('/:boutiqueId/categories/reorder',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueStaff(),
    validationMiddleware.validate([
        param('boutiqueId').isInt(),
        body('ordres').isArray().notEmpty(),
        body('ordres.*.id').isInt(),
        body('ordres.*.ordre_affichage').isInt({ min: 0 })
    ]),
    CategorieBoutiqueController.reorder.bind(CategorieBoutiqueController)
);

// ==================== III. PRODUITS DE BOUTIQUES ====================

/**
 * POST /api/v1/boutiques/:boutiqueId/produits
 * Créer un nouveau produit
 * Headers: Authorization: Bearer <token>
 * Params: boutiqueId
 * Body: {
 *   nom_produit, slug_produit?, description_produit?,
 *   donnees_supplementaires?, prix_unitaire_produit, prix_promo?,
 *   quantite=-1, id_categorie, est_disponible=true, meta_data?
 * }
 * Files: image_principale?, images? (multipart/form-data, jusqu'à 10 images)
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE, STAFF_BOUTIQUE
 * Rate limit: 50 par heure
 * Réponse: 201 { status, data }
 */
router.post('/:boutiqueId/produits',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueStaff(),
    produitCreationLimiter,
    uploadMiddleware.fields([
        { name: 'image_principale', maxCount: 1 },
        { name: 'images', maxCount: 10 }
    ]),
    validationMiddleware.validate([
        param('boutiqueId').isInt(),
        body('nom_produit').notEmpty().trim().isLength({ min: 3, max: 255 }),
        body('slug_produit').optional().trim(),
        body('description_produit').optional().trim(),
        body('donnees_supplementaires').optional().isObject(),
        body('prix_unitaire_produit').isFloat({ min: 0.01 }),
        body('prix_promo').optional().isFloat({ min: 0.01 }),
        body('quantite').optional().isInt({ min: -1 }),
        body('id_categorie').isInt(),
        body('est_disponible').optional().isBoolean(),
        body('meta_data').optional().isObject()
    ]),
    ProduitBoutiqueController.create.bind(ProduitBoutiqueController)
);

/**
 * GET /api/v1/boutiques/:boutiqueId/produits
 * Récupérer tous les produits d'une boutique avec filtres
 * Params: boutiqueId
 * Query: page=1, limit=20, categorie_id?, search?, prix_min?, prix_max?,
 *        en_promo?, disponible?, tri, avec_stock?, avec_categorie?,
 *        tags?, fourchette_prix?, en_rupture?, nouveau_produit_jours=30
 * Auth: PUBLIC
 * Cache: 2 minutes
 * Réponse: { status, data, pagination, filters, summary }
 */
router.get('/:boutiqueId/produits',
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        param('boutiqueId').isInt(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('categorie_id').optional().isInt(),
        query('search').optional().trim(),
        query('prix_min').optional().isFloat({ min: 0 }),
        query('prix_max').optional().isFloat({ min: 0 }),
        query('en_promo').optional().isBoolean(),
        query('disponible').optional().isBoolean(),
        query('tri').optional().isIn(['prix_asc', 'prix_desc', 'nom_asc', 'nom_desc', 'date_creation_asc', 'date_creation_desc', 'popularite', 'notes']),
        query('avec_stock').optional().isBoolean(),
        query('avec_categorie').optional().isBoolean(),
        query('tags').optional().trim(),
        query('fourchette_prix').optional().isBoolean(),
        query('en_rupture').optional().isBoolean(),
        query('nouveau_produit_jours').optional().isInt({ min: 1, max: 365 })
    ]),
    ProduitBoutiqueController.findAll.bind(ProduitBoutiqueController)
);

/**
 * GET /api/v1/produits/search
 * Recherche avancée de produits sur toutes les boutiques
 * Query: q?, categorie_id?, boutique_id?, prix_min?, prix_max?,
 *        en_promo?, en_stock?, tri=pertinence, page=1, limit=20,
 *        avec_boutique=true, geo_location?, rayon_km=10
 * Auth: PUBLIC
 * Cache: 2 minutes
 * Réponse: { status, data, pagination, meta }
 */
router.get('/produits/search',
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        query('q').optional().trim(),
        query('categorie_id').optional().isInt(),
        query('boutique_id').optional().isInt(),
        query('prix_min').optional().isFloat({ min: 0 }),
        query('prix_max').optional().isFloat({ min: 0 }),
        query('en_promo').optional().isBoolean(),
        query('en_stock').optional().isBoolean(),
        query('tri').optional().isIn(['pertinence', 'prix_asc', 'prix_desc', 'date_creation_desc']),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 50 }),
        query('avec_boutique').optional().isBoolean(),
        query('geo_location').optional().isObject(),
        query('geo_location.lat').optional().isFloat({ min: -90, max: 90 }),
        query('geo_location.lng').optional().isFloat({ min: -180, max: 180 }),
        query('rayon_km').optional().isFloat({ min: 0.1, max: 50 })
    ]),
    ProduitBoutiqueController.search.bind(ProduitBoutiqueController)
);

/**
 * GET /api/v1/produits/promos
 * Obtenir les produits en promotion
 * Query: boutique_id?, limit=20, page=1, tri=reduction_desc
 * Auth: PUBLIC
 * Cache: 5 minutes
 * Réponse: { status, data, pagination, stats }
 */
router.get('/produits/promos',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('boutique_id').optional().isInt(),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('page').optional().isInt({ min: 1 }),
        query('tri').optional().isIn(['reduction_desc', 'prix_asc', 'prix_desc'])
    ]),
    ProduitBoutiqueController.getPromotions.bind(ProduitBoutiqueController)
);

/**
 * GET /api/v1/produits/:identifier
 * Récupérer un produit par ID ou slug
 * Params: identifier (ID ou slug)
 * Query: inclure_avis?, inclure_similaires?, inclure_recommandations?
 * Auth: PUBLIC
 * Cache: 5 minutes
 * Réponse: { status, data: produit_avec_toutes_donnees }
 */
router.get('/produits/:identifier',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        param('identifier').notEmpty(),
        query('inclure_avis').optional().isBoolean(),
        query('inclure_similaires').optional().isBoolean(),
        query('inclure_recommandations').optional().isBoolean()
    ]),
    ProduitBoutiqueController.findById.bind(ProduitBoutiqueController)
);

/**
 * PUT /api/v1/produits/:id
 * Mettre à jour un produit
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: (mêmes champs que création, tous optionnels)
 * Files: image_principale?, nouvelles_images? (multipart/form-data)
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE, STAFF_BOUTIQUE
 * Réponse: { status, data, message }
 */
router.put('/produits/:id',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueStaff(),
    uploadMiddleware.fields([
        { name: 'image_principale', maxCount: 1 },
        { name: 'nouvelles_images', maxCount: 10 }
    ]),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nom_produit').optional().trim().isLength({ min: 3, max: 255 }),
        body('description_produit').optional().trim(),
        body('donnees_supplementaires').optional().isObject(),
        body('prix_unitaire_produit').optional().isFloat({ min: 0.01 }),
        body('prix_promo').optional().isFloat({ min: 0.01 }),
        body('quantite').optional().isInt({ min: -1 }),
        body('id_categorie').optional().isInt(),
        body('est_disponible').optional().isBoolean()
    ]),
    ProduitBoutiqueController.update.bind(ProduitBoutiqueController)
);

/**
 * PATCH /api/v1/produits/:id/stock
 * Mettre à jour le stock d'un produit
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { quantite, operation='set', motif?, seuil_alerte=5 }
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE, STAFF_BOUTIQUE
 * Réponse: { status, data }
 */
router.patch('/produits/:id/stock',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueStaff(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('quantite').isInt({ min: -1 }),
        body('operation').optional().isIn(['set', 'add', 'subtract']),
        body('motif').optional().trim(),
        body('seuil_alerte').optional().isInt({ min: 1, max: 100 })
    ]),
    ProduitBoutiqueController.updateStock.bind(ProduitBoutiqueController)
);

/**
 * POST /api/v1/produits/:id/duplicate
 * Dupliquer un produit
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { nouveau_nom?, nouveau_prix? }
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE
 * Réponse: 201 { status, message, data }
 */
router.post('/produits/:id/duplicate',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueOwner(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nouveau_nom').optional().trim(),
        body('nouveau_prix').optional().isFloat({ min: 0.01 })
    ]),
    ProduitBoutiqueController.duplicate.bind(ProduitBoutiqueController)
);

/**
 * DELETE /api/v1/produits/:id/images/:imageIndex
 * Supprimer une image d'un produit
 * Headers: Authorization: Bearer <token>
 * Params: id, imageIndex
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE
 * Réponse: { status, message, data }
 */
router.delete('/produits/:id/images/:imageIndex',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueOwner(),
    validationMiddleware.validate([
        param('id').isInt(),
        param('imageIndex').isInt({ min: 0 })
    ]),
    ProduitBoutiqueController.deleteImage.bind(ProduitBoutiqueController)
);

/**
 * DELETE /api/v1/produits/:id
 * Supprimer un produit (soft delete)
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { force=false, motif? }
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE
 * Réponse: { status, message, data }
 */
router.delete('/produits/:id',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueOwner(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('force').optional().isBoolean(),
        body('motif').optional().trim()
    ]),
    ProduitBoutiqueController.delete.bind(ProduitBoutiqueController)
);

// ==================== IV. COMMANDES DE BOUTIQUES ====================

/**
 * POST /api/v1/boutiques/:boutiqueId/commandes
 * Créer une nouvelle commande
 * Headers: Authorization: Bearer <token> (optionnel)
 * Params: boutiqueId
 * Body: {
 *   produits: [{ produit_id, quantite }],
 *   pour_livrer=false, passer_recuperer=false, mode_paiement,
 *   adresse_livraison_id?, notes_commande?, promo_code?,
 *   informations_client?, date_souhaitee?, heure_souhaitee?,
 *   contact_telephone?, contact_email?, livraison_express=false
 * }
 * Rate limit: 10 par heure
 * Auth: PUBLIC (avec ou sans authentification)
 * Réponse: 201 { status, data, message }
 */
router.post('/:boutiqueId/commandes',
    authMiddleware.optionalAuthenticate,
    commandeCreationLimiter,
    validationMiddleware.validate([
        param('boutiqueId').isInt(),
        body('produits').isArray().notEmpty(),
        body('produits.*.produit_id').isInt(),
        body('produits.*.quantite').isInt({ min: 1 }),
        body('pour_livrer').optional().isBoolean(),
        body('passer_recuperer').optional().isBoolean(),
        body('mode_paiement').isIn(['DIRECT', 'LIVRAISON', 'RECUPERATION']),
        body('adresse_livraison_id').optional().isInt(),
        body('notes_commande').optional().trim(),
        body('promo_code').optional().trim(),
        body('informations_client').optional().isObject(),
        body('date_souhaitee').optional().isISO8601(),
        body('heure_souhaitee').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        body('contact_telephone').optional().matches(/^[0-9+\-\s]+$/),
        body('contact_email').optional().isEmail(),
        body('livraison_express').optional().isBoolean(),
        body().custom(body => {
            if (body.pour_livrer && !body.adresse_livraison_id && !body.informations_client?.adresse) {
                throw new Error('Adresse de livraison requise');
            }
            if (!body.pour_livrer && !body.passer_recuperer) {
                throw new Error('Veuillez spécifier un mode de livraison ou de récupération');
            }
            return true;
        })
    ]),
    CommandeBoutiqueController.create.bind(CommandeBoutiqueController)
);

/**
 * GET /api/v1/boutiques/:boutiqueId/commandes
 * Récupérer toutes les commandes d'une boutique
 * Headers: Authorization: Bearer <token>
 * Params: boutiqueId
 * Query: page=1, limit=20, statut?, date_debut?, date_fin?,
 *        client_id?, recherche?, mode_paiement?, montant_min?,
 *        montant_max?, avec_livraison?, tri, export?
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE, STAFF_BOUTIQUE
 * Réponse: { status, data, pagination, statistiques }
 */
router.get('/:boutiqueId/commandes',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueStaff(),
    validationMiddleware.validate([
        param('boutiqueId').isInt(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('statut').optional().isIn(['EN_ATTENTE', 'CONFIRMEE', 'EN_PREPARATION', 'PRETE', 'EN_LIVRAISON', 'LIVREE', 'RECUPEREE', 'ANNULEE', 'REMBOURSEE']),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601(),
        query('client_id').optional().isInt(),
        query('recherche').optional().trim(),
        query('mode_paiement').optional().isIn(['DIRECT', 'LIVRAISON', 'RECUPERATION']),
        query('montant_min').optional().isFloat({ min: 0 }),
        query('montant_max').optional().isFloat({ min: 0 }),
        query('avec_livraison').optional().isBoolean(),
        query('tri').optional().isIn(['date_asc', 'date_desc', 'montant_asc', 'montant_desc', 'client_asc', 'client_desc']),
        query('export').optional().isIn(['csv', 'excel', 'pdf'])
    ]),
    CommandeBoutiqueController.findAll.bind(CommandeBoutiqueController)
);

/**
 * GET /api/v1/boutiques/:boutiqueId/commandes/stats
 * Obtenir les statistiques des commandes
 * Headers: Authorization: Bearer <token>
 * Params: boutiqueId
 * Query: periode=30j, date_debut?, date_fin?
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE, STAFF_BOUTIQUE
 * Cache: 10 minutes
 * Réponse: { status, data }
 */
router.get('/:boutiqueId/commandes/stats',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueStaff(),
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        param('boutiqueId').isInt(),
        query('periode').optional().isIn(['7j', '30j', '90j', 'an', 'personnalise']),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601()
    ]),
    CommandeBoutiqueController.getStats.bind(CommandeBoutiqueController)
);

/**
 * GET /api/v1/mes-commandes
 * Récupérer les commandes de l'utilisateur connecté
 * Headers: Authorization: Bearer <token>
 * Query: page=1, limit=10, statut?, boutique_id?, date_debut?, date_fin?
 * Auth: PRIVATE
 * Réponse: { status, data, pagination, statistiques }
 */
router.get('/mes-commandes',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 50 }),
        query('statut').optional().isIn(['EN_ATTENTE', 'CONFIRMEE', 'EN_PREPARATION', 'PRETE', 'EN_LIVRAISON', 'LIVREE', 'RECUPEREE', 'ANNULEE', 'REMBOURSEE']),
        query('boutique_id').optional().isInt(),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601()
    ]),
    CommandeBoutiqueController.findMesCommandes.bind(CommandeBoutiqueController)
);

/**
 * GET /api/v1/commandes/:identifier
 * Récupérer une commande par ID ou référence
 * Params: identifier (ID ou référence)
 * Query: inclure_details=true
 * Auth: PUBLIC (avec vérification d'accès)
 * Cache: 5 minutes
 * Réponse: { status, data: commande_avec_historique_et_suivi }
 */
router.get('/commandes/:identifier',
    authMiddleware.optionalAuthenticate,
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        param('identifier').notEmpty(),
        query('inclure_details').optional().isBoolean()
    ]),
    CommandeBoutiqueController.findById.bind(CommandeBoutiqueController)
);

/**
 * PATCH /api/v1/commandes/:id/statut
 * Mettre à jour le statut d'une commande
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { statut, motif?, notify_client=true }
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE, STAFF_BOUTIQUE
 * Réponse: { status, data, message }
 */
router.patch('/commandes/:id/statut',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueStaff(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('statut').isIn(['CONFIRMEE', 'EN_PREPARATION', 'PRETE', 'EN_LIVRAISON', 'LIVREE', 'RECUPEREE', 'ANNULEE', 'REMBOURSEE']),
        body('motif').optional().trim(),
        body('notify_client').optional().isBoolean()
    ]),
    CommandeBoutiqueController.updateStatut.bind(CommandeBoutiqueController)
);

/**
 * POST /api/v1/commandes/:id/annuler
 * Annuler une commande
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { motif?, remboursement=false }
 * Auth: CLIENT, ADMIN, PROPRIETAIRE_BOUTIQUE
 * Réponse: { status, message, data }
 */
router.post('/commandes/:id/annuler',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt(),
        body('motif').optional().trim(),
        body('remboursement').optional().isBoolean()
    ]),
    CommandeBoutiqueController.annuler.bind(CommandeBoutiqueController)
);

/**
 * POST /api/v1/commandes/:id/valider-paiement
 * Valider le paiement d'une commande
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { reference_paiement?, mode_paiement? }
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE, STAFF_BOUTIQUE
 * Réponse: { status, message }
 */
router.post('/commandes/:id/valider-paiement',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueStaff(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('reference_paiement').optional().trim(),
        body('mode_paiement').optional().isIn(['DIRECT', 'LIVRAISON', 'RECUPERATION'])
    ]),
    CommandeBoutiqueController.validerPaiement.bind(CommandeBoutiqueController)
);

/**
 * POST /api/v1/commandes/:id/prete
 * Marquer une commande comme prête
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { temps_preparation?, notes? }
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE, STAFF_BOUTIQUE
 * Réponse: { status, message }
 */
router.post('/commandes/:id/prete',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueStaff(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('temps_preparation').optional().isInt({ min: 0 }),
        body('notes').optional().trim()
    ]),
    CommandeBoutiqueController.marquerPrete.bind(CommandeBoutiqueController)
);

/**
 * POST /api/v1/commandes/:id/terminer
 * Confirmer la livraison/récupération d'une commande
 * Headers: Authorization: Bearer <token> (optionnel pour le client)
 * Params: id
 * Body: { code_retrait?, satisfaction? }
 * Auth: CLIENT, LIVREUR, STAFF_BOUTIQUE
 * Réponse: { status, message }
 */
router.post('/commandes/:id/terminer',
    authMiddleware.optionalAuthenticate,
    validationMiddleware.validate([
        param('id').isInt(),
        body('code_retrait').optional().isLength({ min: 6, max: 6 }).isNumeric(),
        body('satisfaction').optional().isInt({ min: 1, max: 5 })
    ]),
    CommandeBoutiqueController.terminer.bind(CommandeBoutiqueController)
);

/**
 * POST /api/v1/commandes/:id/generer-code-retrait
 * Générer un code de retrait pour une commande
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: ADMIN, PROPRIETAIRE_BOUTIQUE, STAFF_BOUTIQUE
 * Réponse: { status, data: { code_retrait }, message }
 */
router.post('/commandes/:id/generer-code-retrait',
    authMiddleware.authenticate,
    roleMiddleware.isBoutiqueStaff(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    CommandeBoutiqueController.genererCodeRetrait.bind(CommandeBoutiqueController)
);

/**
 * GET /api/v1/commandes/:reference/suivi
 * Suivre une commande en temps réel
 * Params: reference
 * Query: code_suivi?, telephone?
 * Auth: PUBLIC (avec code de suivi ou téléphone)
 * Réponse: { status, data: { etapes, position_livreur, ... } }
 */
router.get('/commandes/:reference/suivi',
    validationMiddleware.validate([
        param('reference').notEmpty(),
        query('code_suivi').optional().trim(),
        query('telephone').optional().matches(/^[0-9+\-\s]+$/)
    ]),
    CommandeBoutiqueController.suiviCommande.bind(CommandeBoutiqueController)
);

module.exports = router;