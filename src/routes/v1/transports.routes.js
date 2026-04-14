// src/routes/v1/transport.routes.js
/**
 * Routes de gestion du transport
 * API pour la gestion complète des compagnies, emplacements et tickets de transport
 * Authentification requise pour la plupart des endpoints (rôles spécifiques)
 */
const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const validationMiddleware = require('../middlewares/validation.middleware');
const cacheMiddleware = require('../middlewares/cache.middleware');

const CompagnieController = require('../../controllers/transport/CompagnieController');
const EmplacementController = require('../../controllers/transport/EmplacementController');
const TicketController = require('../../controllers/transport/TicketController');
const ServiceTransportController = require('../../controllers/transport/ServiceController');

// ==================== AUTHENTIFICATION GLOBALE ====================
// Toutes les routes de transport nécessitent une authentification
// Sauf les routes publiques spécifiées individuellement
router.use(authMiddleware.authenticate);

// ==================== I. COMPAGNIES DE TRANSPORT ====================
// Gestion CRUD des compagnies de transport

/**
 * GET /api/v1/transport/compagnies
 * Récupérer toutes les compagnies de transport
 * Query: page=1, limit=20, actif, recherche, avec_stats=false
 * Auth: Bearer <token>
 * Réponse: { success, data: [compagnies], pagination }
 */
router.get('/compagnies',
    /*roleMiddleware.isAdmin(),*/
    /*roleMiddleware.isAtLeast('UTILISATEUR_PRIVE_SIMPLE'),*/
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('actif').optional().isBoolean(),
        query('recherche').optional().trim().isLength({ min: 2 }),
        query('avec_stats').optional().isBoolean()
    ]),
    CompagnieController.getAll.bind(CompagnieController)
);

/**
 * GET /api/v1/transport/compagnies/proximite
 * Récupérer les compagnies à proximité d'un point
 * Query: lat, lng, rayon_km=5, limit=20
 * Auth: Bearer <token> (ou public via middleware spécifique)
 * Cache: 5 minutes
 * Réponse: { success, data: [compagnies_avec_emplacements], meta }
 */
router.get('/compagnies/proximite',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('lat').isFloat({ min: -90, max: 90 }),
        query('lng').isFloat({ min: -180, max: 180 }),
        query('rayon_km').optional().isFloat({ min: 0.1, max: 50 }),
        query('limit').optional().isInt({ min: 1, max: 50 })
    ]),
    CompagnieController.getNearby.bind(CompagnieController)
);

/**
 * GET /api/v1/transport/compagnies/:id
 * Récupérer une compagnie par ID
 * Params: id (entier)
 * Query: include_emplacements=true, include_tickets=true
 * Auth: Bearer <token>
 * Réponse: { success, data: compagnie }
 */
router.get('/compagnies/:id',
    validationMiddleware.validate([
        param('id').isInt(),
        query('include_emplacements').optional().isBoolean(),
        query('include_tickets').optional().isBoolean()
    ]),
    CompagnieController.getById.bind(CompagnieController)
);

/**
 * GET /api/v1/transport/compagnies/:id/stats
 * Récupérer les statistiques d'une compagnie
 * Params: id (entier)
 * Query: periode=30d (7d, 30d, 90d, 1y)
 * Auth: Bearer <token>
 * Cache: 10 minutes
 * Réponse: { success, data: { stats, periode } }
 */
router.get('/compagnies/:id/stats',
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        param('id').isInt(),
        query('periode').optional().isIn(['7d', '30d', '90d', '1y'])
    ]),
    CompagnieController.getStats.bind(CompagnieController)
);

/**
 * POST /api/v1/transport/compagnies
 * Créer une nouvelle compagnie de transport
 * Body: {
 *   nom_compagnie, description_compagnie, logo_compagnie,
 *   pourcentage_commission_plateforme, plateforme_id
 * }
 * Auth: Bearer <token> + ADMIN
 * Réponse: 201 { success, data: compagnie, message }
 */
router.post('/compagnies',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        body('nom_compagnie').notEmpty().trim().isLength({ min: 2, max: 255 }),
        body('description_compagnie').optional().trim(),
        body('logo_compagnie').optional().isURL(),
        body('pourcentage_commission_plateforme').optional().isFloat({ min: 0, max: 100 }),
        body('plateforme_id').optional().isInt()
    ]),
    CompagnieController.create.bind(CompagnieController)
);

/**
 * PUT /api/v1/transport/compagnies/:id
 * Mettre à jour une compagnie
 * Params: id (entier)
 * Body: { nom_compagnie?, description_compagnie?, logo_compagnie?, pourcentage_commission_plateforme?, est_actif? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: compagnie, message }
 */
router.put('/compagnies/:id',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nom_compagnie').optional().trim().isLength({ min: 2, max: 255 }),
        body('description_compagnie').optional().trim(),
        body('logo_compagnie').optional().isURL(),
        body('pourcentage_commission_plateforme').optional().isFloat({ min: 0, max: 100 }),
        body('est_actif').optional().isBoolean()
    ]),
    CompagnieController.update.bind(CompagnieController)
);

/**
 * DELETE /api/v1/transport/compagnies/:id
 * Supprimer une compagnie (soft delete)
 * Params: id (entier)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, message }
 */
router.delete('/compagnies/:id',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    CompagnieController.delete.bind(CompagnieController)
);

// ==================== II. EMPLACEMENTS DE TRANSPORT ====================
// Gestion des emplacements (gares, arrêts, agences)

/**
 * GET /api/v1/transport/compagnies/:compagnieId/emplacements
 * Récupérer tous les emplacements d'une compagnie
 * Params: compagnieId (entier)
 * Query: page=1, limit=20, actif, avec_tickets=false, recherche
 * Auth: Bearer <token>
 * Réponse: { success, data: [emplacements], pagination }
 */
router.get('/compagnies/:compagnieId/emplacements',
    validationMiddleware.validate([
        param('compagnieId').isInt(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('actif').optional().isBoolean(),
        query('avec_tickets').optional().isBoolean(),
        query('recherche').optional().trim().isLength({ min: 2 })
    ]),
    EmplacementController.getAll.bind(EmplacementController)
);

/**
 * GET /api/v1/transport/emplacements/proximite
 * Récupérer les emplacements à proximité
 * Query: lat, lng, rayon_km=5, limit=20, avec_tickets=true
 * Auth: Bearer <token> (ou public via middleware spécifique)
 * Cache: 5 minutes
 * Réponse: { success, data: [emplacements_avec_distance], meta }
 */
router.get('/emplacements/proximite',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('lat').isFloat({ min: -90, max: 90 }),
        query('lng').isFloat({ min: -180, max: 180 }),
        query('rayon_km').optional().isFloat({ min: 0.1, max: 50 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('avec_tickets').optional().isBoolean()
    ]),
    EmplacementController.getNearby.bind(EmplacementController)
);

/**
 * GET /api/v1/transport/emplacements/:id
 * Récupérer un emplacement par ID
 * Params: id (entier)
 * Auth: Bearer <token>
 * Réponse: { success, data: emplacement_avec_tickets_et_services }
 */
router.get('/emplacements/:id',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    EmplacementController.getById.bind(EmplacementController)
);

/**
 * GET /api/v1/transport/emplacements/:id/disponibilite
 * Vérifier la disponibilité d'un emplacement
 * Params: id (entier)
 * Query: date (YYYY-MM-DD), type_ticket (optionnel)
 * Auth: Bearer <token>
 * Cache: 2 minutes
 * Réponse: { success, data: { est_ouvert, tickets_disponibles, horaires } }
 */
router.get('/emplacements/:id/disponibilite',
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        param('id').isInt(),
        query('date').optional().isISO8601(),
        query('type_ticket').optional().isIn(['journalier', 'hebdomadaire', 'mensuel'])
    ]),
    EmplacementController.checkDisponibilite.bind(EmplacementController)
);

/**
 * GET /api/v1/transport/emplacements/:id/stats
 * Récupérer les statistiques d'un emplacement
 * Params: id (entier)
 * Auth: Bearer <token>
 * Cache: 10 minutes
 * Réponse: { success, data: { stats } }
 */
router.get('/emplacements/:id/stats',
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    EmplacementController.getStats.bind(EmplacementController)
);

/**
 * POST /api/v1/transport/compagnies/:compagnieId/emplacements
 * Créer un nouvel emplacement pour une compagnie
 * Params: compagnieId (entier)
 * Body: {
 *   nom_emplacement, localisation: { lat, lng },
 *   jours_ouverture (LUNDI_VENDREDI|SAMEDI_DIMANCHE|TOUS_LES_JOURS),
 *   localisation_arret_bus?: { lat, lng }
 * }
 * Auth: Bearer <token> + ADMIN
 * Réponse: 201 { success, data: emplacement, message }
 */
router.post('/compagnies/:compagnieId/emplacements',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('compagnieId').isInt(),
        body('nom_emplacement').notEmpty().trim(),
        body('localisation.lat').isFloat({ min: -90, max: 90 }),
        body('localisation.lng').isFloat({ min: -180, max: 180 }),
        body('jours_ouverture').optional().isIn(['LUNDI_VENDREDI', 'SAMEDI_DIMANCHE', 'TOUS_LES_JOURS']),
        body('localisation_arret_bus.lat').optional().isFloat({ min: -90, max: 90 }),
        body('localisation_arret_bus.lng').optional().isFloat({ min: -180, max: 180 })
    ]),
    EmplacementController.create.bind(EmplacementController)
);

/**
 * PUT /api/v1/transport/emplacements/:id
 * Mettre à jour un emplacement
 * Params: id (entier)
 * Body: { nom_emplacement?, localisation?, jours_ouverture?, localisation_arret_bus?, est_actif? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: emplacement, message }
 */
router.put('/emplacements/:id',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nom_emplacement').optional().trim(),
        body('localisation.lat').optional().isFloat({ min: -90, max: 90 }),
        body('localisation.lng').optional().isFloat({ min: -180, max: 180 }),
        body('jours_ouverture').optional().isIn(['LUNDI_VENDREDI', 'SAMEDI_DIMANCHE', 'TOUS_LES_JOURS']),
        body('localisation_arret_bus.lat').optional().isFloat({ min: -90, max: 90 }),
        body('localisation_arret_bus.lng').optional().isFloat({ min: -180, max: 180 }),
        body('est_actif').optional().isBoolean()
    ]),
    EmplacementController.update.bind(EmplacementController)
);

/**
 * DELETE /api/v1/transport/emplacements/:id
 * Désactiver un emplacement
 * Params: id (entier)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, message }
 */
router.delete('/emplacements/:id',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    EmplacementController.delete.bind(EmplacementController)
);

// ==================== III. TICKETS DE TRANSPORT ====================
// Gestion des tickets et billets de transport

/**
 * GET /api/v1/transport/tickets
 * Récupérer tous les tickets avec filtres
 * Query: 
 *   - page=1, limit=20
 *   - compagnie_id, emplacement_id
 *   - actif, type (journalier|hebdomadaire|mensuel)
 *   - prix_min, prix_max
 *   - recherche, tri (prix_asc|prix_desc|nom_asc|ventes_desc)
 * Auth: Bearer <token>
 * Réponse: { success, data: [tickets], pagination }
 */
router.get('/tickets',
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('compagnie_id').optional().isInt(),
        query('emplacement_id').optional().isInt(),
        query('actif').optional().isBoolean(),
        query('type').optional().isIn(['journalier', 'hebdomadaire', 'mensuel']),
        query('prix_min').optional().isFloat({ min: 0 }),
        query('prix_max').optional().isFloat({ min: 0 }),
        query('recherche').optional().trim().isLength({ min: 2 }),
        query('tri').optional().isIn(['prix_asc', 'prix_desc', 'nom_asc', 'ventes_desc', 'date_creation_desc', 'date_creation_asc'])
    ]),
    TicketController.getAll.bind(TicketController)
);

/**
 * GET /api/v1/transport/tickets/stats
 * Récupérer les statistiques des tickets
 * Query: compagnie_id?, emplacement_id?
 * Auth: Bearer <token> + ADMIN
 * Cache: 10 minutes
 * Réponse: { success, data: { total_tickets, stock_total, total_vendus, prix_moyen, ... } }
 */
router.get('/tickets/stats',
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        query('compagnie_id').optional().isInt(),
        query('emplacement_id').optional().isInt()
    ]),
    TicketController.getStats.bind(TicketController)
);

/**
 * GET /api/v1/transport/tickets/:id
 * Récupérer un ticket par ID
 * Params: id (entier)
 * Auth: Bearer <token>
 * Réponse: { success, data: ticket_avec_achats_recents }
 */
router.get('/tickets/:id',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    TicketController.getById.bind(TicketController)
);

/**
 * POST /api/v1/transport/emplacements/:emplacementId/tickets
 * Créer un nouveau ticket pour un emplacement
 * Params: emplacementId (entier)
 * Body: {
 *   nom_produit, description_produit, prix_vente_produit,
 *   donnees_secondaires_produit?, quantite_stock?,
 *   journalier, hebdomadaire, mensuel (exactement un true)
 * }
 * Auth: Bearer <token> + ADMIN
 * Réponse: 201 { success, data: ticket, message }
 */
router.post('/emplacements/:emplacementId/tickets',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('emplacementId').isInt(),
        body('nom_produit').notEmpty().trim(),
        body('description_produit').optional().trim(),
        body('prix_vente_produit').isFloat({ min: 0 }),
        body('donnees_secondaires_produit').optional().isObject(),
        body('quantite_stock').optional().isInt({ min: 0 }),
        body('journalier').isBoolean(),
        body('hebdomadaire').isBoolean(),
        body('mensuel').isBoolean()
    ]),
    TicketController.create.bind(TicketController)
);

/**
 * PUT /api/v1/transport/tickets/:id
 * Mettre à jour un ticket
 * Params: id (entier)
 * Body: { nom_produit?, description_produit?, prix_vente_produit?, donnees_secondaires_produit?, quantite_stock?, actif? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: ticket, message }
 */
router.put('/tickets/:id',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nom_produit').optional().trim(),
        body('description_produit').optional().trim(),
        body('prix_vente_produit').optional().isFloat({ min: 0 }),
        body('donnees_secondaires_produit').optional().isObject(),
        body('quantite_stock').optional().isInt({ min: 0 }),
        body('actif').optional().isBoolean()
    ]),
    TicketController.update.bind(TicketController)
);

/**
 * POST /api/v1/transport/tickets/:id/acheter
 * Acheter un ticket (pour utilisateur connecté)
 * Params: id (entier)
 * Body: { quantite=1, paiement_mode? }
 * Auth: Bearer <token>
 * Réponse: 201 { success, data: { achat, qr_code, ticket }, message }
 */
router.post('/tickets/:id/acheter',
    validationMiddleware.validate([
        param('id').isInt(),
        body('quantite').optional().isInt({ min: 1, max: 10 }),
        body('paiement_mode').optional().trim()
    ]),
    TicketController.acheter.bind(TicketController)
);

/**
 * POST /api/v1/transport/tickets/valider
 * Valider un ticket (scan QR code)
 * Body: { qr_data: string (JSON stringifié) }
 * Auth: Bearer <token> + ROLE_AGENT ou ADMIN
 * Réponse: { success, data: { nom_utilisateur, ticket, quantite, date_achat }, message }
 */
router.post('/tickets/valider',
    roleMiddleware.isAgent(),
    validationMiddleware.validate([
        body('qr_data').notEmpty()
    ]),
    TicketController.valider.bind(TicketController)
);

/**
 * DELETE /api/v1/transport/tickets/:id
 * Supprimer un ticket (soft delete si achats existants)
 * Params: id (entier)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, message }
 */
router.delete('/tickets/:id',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    TicketController.delete.bind(TicketController)
);


// ==================== IV. SERVICES DE TRANSPORT ====================
// Gestion des abonnements et services de transport

/**
 * GET /api/v1/transport/services
 * Récupérer tous les services de transport
 * Query: 
 *   - page=1, limit=20
 *   - actif, type_service (ABONNEMENT_MENSUEL|BIMENSUEL|TRIMESTRIEL|ANNUEL)
 *   - compagnie_id, emplacement_id
 *   - recherche
 * Auth: Bearer <token>
 * Cache: 5 minutes
 * Réponse: { success, data: [services], pagination }
 */
router.get('/services',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('actif').optional().isBoolean(),
        query('type_service').optional().isIn(['ABONNEMENT_MENSUEL', 'BIMENSUEL', 'TRIMESTRIEL', 'ANNUEL']),
        query('compagnie_id').optional().isInt(),
        query('emplacement_id').optional().isInt(),
        query('recherche').optional().trim().isLength({ min: 2 })
    ]),
    ServiceTransportController.getAll.bind(ServiceTransportController)
);

/**
 * GET /api/v1/transport/services/:id
 * Récupérer un service de transport par ID
 * Params: id (entier)
 * Auth: Bearer <token>
 * Réponse: { success, data: service_avec_stats }
 */
router.get('/services/:id',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ServiceTransportController.getById.bind(ServiceTransportController)
);

/**
 * GET /api/v1/transport/services/type/:type
 * Récupérer les services par type
 * Params: type (ABONNEMENT_MENSUEL|BIMENSUEL|TRIMESTRIEL|ANNUEL)
 * Query: actif=true
 * Auth: Bearer <token>
 * Cache: 5 minutes
 * Réponse: { success, data: [services], type, count }
 */
router.get('/services/type/:type',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        param('type').isIn(['ABONNEMENT_MENSUEL', 'BIMENSUEL', 'TRIMESTRIEL', 'ANNUEL']),
        query('actif').optional().isBoolean()
    ]),
    ServiceTransportController.getByType.bind(ServiceTransportController)
);

/**
 * GET /api/v1/transport/emplacements/:emplacementId/services
 * Récupérer les services disponibles pour un emplacement
 * Params: emplacementId (entier)
 * Query: actif=true
 * Auth: Bearer <token>
 * Cache: 5 minutes
 * Réponse: { success, data: [services], count }
 */
router.get('/emplacements/:emplacementId/services',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        param('emplacementId').isInt(),
        query('actif').optional().isBoolean()
    ]),
    ServiceTransportController.getServicesByEmplacement.bind(ServiceTransportController)
);

/**
 * GET /api/v1/transport/services/stats/globales
 * Récupérer les statistiques des services
 * Auth: Bearer <token> + ADMIN
 * Cache: 10 minutes
 * Réponse: { success, data: { global, par_type, top_services } }
 */
router.get('/services/stats/globales',
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(600), // 10 minutes
    ServiceTransportController.getStats.bind(ServiceTransportController)
);

/**
 * POST /api/v1/transport/services
 * Créer un nouveau service de transport
 * Body: {
 *   nom_service, type_service, prix_service,
 *   donnees_json_service?, duree_validite_jours?,
 *   compagnie_id, emplacement_id?
 * }
 * Auth: Bearer <token> + ADMIN
 * Réponse: 201 { success, data: service, message }
 */
router.post('/services',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        body('nom_service').notEmpty().trim().isLength({ min: 2, max: 255 }),
        body('type_service').isIn(['ABONNEMENT_MENSUEL', 'BIMENSUEL', 'TRIMESTRIEL', 'ANNUEL']),
        body('prix_service').isFloat({ min: 0 }),
        body('donnees_json_service').optional().isObject(),
        body('duree_validite_jours').optional().isInt({ min: 1 }),
        body('compagnie_id').isInt(),
        body('emplacement_id').optional().isInt()
    ]),
    ServiceTransportController.create.bind(ServiceTransportController)
);

/**
 * PUT /api/v1/transport/services/:id
 * Mettre à jour un service de transport
 * Params: id (entier)
 * Body: { nom_service?, type_service?, prix_service?, donnees_json_service?, duree_validite_jours?, actif?, compagnie_id?, emplacement_id? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: service, message }
 */
router.put('/services/:id',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('nom_service').optional().trim().isLength({ min: 2, max: 255 }),
        body('type_service').optional().isIn(['ABONNEMENT_MENSUEL', 'BIMENSUEL', 'TRIMESTRIEL', 'ANNUEL']),
        body('prix_service').optional().isFloat({ min: 0 }),
        body('donnees_json_service').optional().isObject(),
        body('duree_validite_jours').optional().isInt({ min: 1 }),
        body('actif').optional().isBoolean(),
        body('compagnie_id').optional().isInt(),
        body('emplacement_id').optional().isInt({ allowNull: true })
    ]),
    ServiceTransportController.update.bind(ServiceTransportController)
);

/**
 * DELETE /api/v1/transport/services/:id
 * Supprimer un service de transport (soft delete si achats existent)
 * Params: id (entier)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, message }
 */
router.delete('/services/:id',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ServiceTransportController.delete.bind(ServiceTransportController)
);

// ==================== V. ACHATS DE SERVICES ====================

/**
 * POST /api/v1/transport/services/:id/acheter
 * Acheter un service de transport
 * Params: id (entier)
 * Body: { info_acheteur? }
 * Auth: Bearer <token>
 * Réponse: 201 { success, data: { achat, service }, message }
 */
router.post('/services/:id/acheter',
    validationMiddleware.validate([
        param('id').isInt(),
        body('info_acheteur').optional().isObject()
    ]),
    ServiceTransportController.acheter.bind(ServiceTransportController)
);

/**
 * GET /api/v1/transport/mes-achats
 * Récupérer les achats de services de l'utilisateur connecté
 * Query: page=1, limit=20, est_actif
 * Auth: Bearer <token>
 * Réponse: { success, data: [achats], pagination }
 */
router.get('/mes-achats',
    ServiceTransportController.getMesAchats.bind(ServiceTransportController)
);

module.exports = router;