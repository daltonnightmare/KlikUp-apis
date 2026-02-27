// src/routes/v1/documents.routes.js
/**
 * Routes de gestion des documents
 * API pour l'upload, le téléchargement, la validation et la gestion des documents
 * Accès restreint selon les rôles et permissions
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

const DocumentController = require('../../controllers/document/DocumentController');

// ==================== CONFIGURATION RATE LIMITING ====================

const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 10, // 10 uploads max par heure
    message: 'Trop d\'uploads. Réessayez plus tard.',
    standardHeaders: true,
    legacyHeaders: false
});

// ==================== I. UPLOAD ET GESTION DES DOCUMENTS ====================

/**
 * POST /api/v1/documents
 * Uploader un nouveau document
 * Headers: Authorization: Bearer <token>
 * Body: {
 *   type_document, entite_type, entite_id,
 *   numero_document?, date_emission?, date_expiration?,
 *   autorite_emettrice?, est_chiffre=true
 * }
 * File: document (multipart/form-data)
 * Rate limit: 10 par heure
 * Auth: PRIVATE
 * Réponse: 201 { status, data, message }
 */
router.post('/',
    authMiddleware.authenticate,
    uploadLimiter,
    uploadMiddleware.single('document'),
    validationMiddleware.validate([
        body('type_document').isIn([
            'CNI_RECTO', 'CNI_VERSO', 'PASSEPORT', 'PERMIS_CONDUIRE',
            'JUSTIFICATIF_DOMICILE', 'EXTRAIT_NAISSANCE', 'REGISTRE_COMMERCE',
            'ATTESTATION_FISCALE', 'CONTRAT', 'FACTURE', 'PHOTO_LIVREUR', 'AUTRE'
        ]),
        body('entite_type').isIn([
            'PLATEFORME', 'COMPTE', 'BOUTIQUE', 'RESTAURANT_FAST_FOOD',
            'COMPAGNIE_TRANSPORT', 'LIVREUR'
        ]),
        body('entite_id').isInt({ min: 1 }),
        body('numero_document').optional().trim(),
        body('date_emission').optional().isISO8601(),
        body('date_expiration').optional().isISO8601(),
        body('autorite_emettrice').optional().trim(),
        body('est_chiffre').optional().isBoolean(),
        body().custom(body => {
            if (body.date_emission && body.date_expiration) {
                if (new Date(body.date_expiration) <= new Date(body.date_emission)) {
                    throw new Error('La date d\'expiration doit être postérieure à la date d\'émission');
                }
            }
            return true;
        })
    ]),
    DocumentController.upload.bind(DocumentController)
);

/**
 * GET /api/v1/documents/entite/:type/:id
 * Récupérer tous les documents d'une entité
 * Headers: Authorization: Bearer <token>
 * Params: type, id
 * Query: statut?, type_document?, include_expired=false
 * Auth: PRIVATE (propriétaire ou admin)
 * Cache: 5 minutes
 * Réponse: { status, data: grouped_by_type, statistiques }
 */
router.get('/entite/:type/:id',
    authMiddleware.authenticate,
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        param('type').isIn([
            'PLATEFORME', 'COMPTE', 'BOUTIQUE', 'RESTAURANT_FAST_FOOD',
            'COMPAGNIE_TRANSPORT', 'LIVREUR'
        ]),
        param('id').isInt({ min: 1 }),
        query('statut').optional().isIn(['EN_ATTENTE_VALIDATION', 'VALIDE', 'REFUSE', 'EXPIRE', 'REMPLACE']),
        query('type_document').optional().isString(),
        query('include_expired').optional().isBoolean()
    ]),
    DocumentController.findByEntity.bind(DocumentController)
);

/**
 * GET /api/v1/documents/verifier-completude/:entite_type/:entite_id
 * Vérifier si une entité a tous ses documents requis
 * Headers: Authorization: Bearer <token>
 * Params: entite_type, entite_id
 * Auth: PRIVATE (propriétaire ou admin)
 * Cache: 10 minutes
 * Réponse: { status, data: { complete, total_requis, total_valides, pourcentage, ... } }
 */
router.get('/verifier-completude/:entite_type/:entite_id',
    authMiddleware.authenticate,
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        param('entite_type').isIn(['COMPTE', 'BOUTIQUE', 'LIVREUR', 'RESTAURANT_FAST_FOOD']),
        param('entite_id').isInt({ min: 1 })
    ]),
    DocumentController.checkCompleteness.bind(DocumentController)
);

/**
 * GET /api/v1/documents/:id
 * Récupérer un document par ID
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: PRIVATE (propriétaire ou admin)
 * Réponse: { status, data: document_avec_historique }
 */
router.get('/:id',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt({ min: 1 })
    ]),
    DocumentController.findById.bind(DocumentController)
);

/**
 * GET /api/v1/documents/:id/download
 * Télécharger un document
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: PRIVATE (propriétaire ou admin)
 * Réponse: Fichier (download)
 */
router.get('/:id/download',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt({ min: 1 })
    ]),
    DocumentController.download.bind(DocumentController)
);

/**
 * POST /api/v1/documents/:id/remplacer
 * Remplacer un document par une nouvelle version
 * Headers: Authorization: Bearer <token>
 * Params: id
 * File: document (multipart/form-data)
 * Auth: PRIVATE (propriétaire ou admin)
 * Réponse: { status, data, message }
 */
router.post('/:id/remplacer',
    authMiddleware.authenticate,
    uploadLimiter,
    uploadMiddleware.single('document'),
    validationMiddleware.validate([
        param('id').isInt({ min: 1 })
    ]),
    DocumentController.replace.bind(DocumentController)
);

// ==================== II. VALIDATION DES DOCUMENTS (ADMIN) ====================

/**
 * GET /api/v1/documents/en-attente
 * Récupérer les documents en attente de validation
 * Headers: Authorization: Bearer <token>
 * Query: page=1, limit=20, type_document?, entite_type?, days=7
 * Auth: ADMIN
 * Cache: 2 minutes
 * Réponse: { status, data, pagination, statistiques }
 */
router.get('/en-attente',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('type_document').optional().isString(),
        query('entite_type').optional().isIn([
            'COMPTE', 'BOUTIQUE', 'RESTAURANT_FAST_FOOD', 'COMPAGNIE_TRANSPORT', 'LIVREUR'
        ]),
        query('days').optional().isInt({ min: 1, max: 30 })
    ]),
    DocumentController.getPendingDocuments.bind(DocumentController)
);

/**
 * GET /api/v1/documents/expirant
 * Récupérer les documents expirant bientôt
 * Headers: Authorization: Bearer <token>
 * Query: days=30
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { status, data: { imminent, bientot, dans_30j }, total }
 */
router.get('/expirant',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('days').optional().isInt({ min: 1, max: 365 })
    ]),
    DocumentController.getExpiringDocuments.bind(DocumentController)
);

/**
 * GET /api/v1/documents/stats
 * Obtenir les statistiques des documents
 * Headers: Authorization: Bearer <token>
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { status, data: { global, par_type, par_entite, evolution, taille_totale_formatee } }
 */
router.get('/stats',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    DocumentController.getStats.bind(DocumentController)
);

/**
 * POST /api/v1/documents/:id/valider
 * Valider un document
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { commentaire? }
 * Auth: ADMIN
 * Réponse: { status, message }
 */
router.post('/:id/valider',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt({ min: 1 }),
        body('commentaire').optional().trim().isLength({ max: 500 })
    ]),
    DocumentController.validate.bind(DocumentController)
);

/**
 * POST /api/v1/documents/:id/refuser
 * Refuser un document
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { motif }
 * Auth: ADMIN
 * Réponse: { status, message }
 */
router.post('/:id/refuser',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt({ min: 1 }),
        body('motif').notEmpty().trim().isLength({ min: 5, max: 1000 })
    ]),
    DocumentController.refuse.bind(DocumentController)
);

/**
 * DELETE /api/v1/documents/:id
 * Supprimer un document
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { force=false }
 * Auth: ADMIN
 * Réponse: { status, message }
 */
router.delete('/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt({ min: 1 }),
        body('force').optional().isBoolean()
    ]),
    DocumentController.delete.bind(DocumentController)
);

// ==================== III. DOCUMENTS PAR TYPE D'ENTITÉ (RACCOURCIS) ====================

/**
 * GET /api/v1/documents/mes-documents
 * Récupérer les documents de l'utilisateur connecté
 * Headers: Authorization: Bearer <token>
 * Query: statut?, type_document?, include_expired=false
 * Auth: PRIVATE
 * Cache: 5 minutes
 * Réponse: { status, data, statistiques }
 */
router.get('/mes-documents',
    authMiddleware.authenticate,
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('statut').optional().isIn(['EN_ATTENTE_VALIDATION', 'VALIDE', 'REFUSE', 'EXPIRE']),
        query('type_document').optional().isString(),
        query('include_expired').optional().isBoolean()
    ]),
    async (req, res, next) => {
        // Rediriger vers findByEntity avec l'entité = compte et id = req.user.id
        req.params.type = 'COMPTE';
        req.params.id = req.user.id;
        return DocumentController.findByEntity(req, res, next);
    }
);

/**
 * GET /api/v1/documents/boutique/:boutiqueId
 * Récupérer les documents d'une boutique
 * Headers: Authorization: Bearer <token>
 * Params: boutiqueId
 * Query: statut?, type_document?, include_expired=false
 * Auth: PRIVATE (propriétaire ou admin)
 * Cache: 5 minutes
 * Réponse: { status, data, statistiques }
 */
router.get('/boutique/:boutiqueId',
    authMiddleware.authenticate,
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        param('boutiqueId').isInt({ min: 1 }),
        query('statut').optional().isIn(['EN_ATTENTE_VALIDATION', 'VALIDE', 'REFUSE', 'EXPIRE']),
        query('type_document').optional().isString(),
        query('include_expired').optional().isBoolean()
    ]),
    async (req, res, next) => {
        req.params.type = 'BOUTIQUE';
        req.params.id = req.params.boutiqueId;
        return DocumentController.findByEntity(req, res, next);
    }
);

/**
 * GET /api/v1/documents/livreur/:livreurId
 * Récupérer les documents d'un livreur
 * Headers: Authorization: Bearer <token>
 * Params: livreurId
 * Query: statut?, type_document?, include_expired=false
 * Auth: PRIVATE (propriétaire ou admin)
 * Cache: 5 minutes
 * Réponse: { status, data, statistiques }
 */
router.get('/livreur/:livreurId',
    authMiddleware.authenticate,
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        param('livreurId').isInt({ min: 1 }),
        query('statut').optional().isIn(['EN_ATTENTE_VALIDATION', 'VALIDE', 'REFUSE', 'EXPIRE']),
        query('type_document').optional().isString(),
        query('include_expired').optional().isBoolean()
    ]),
    async (req, res, next) => {
        req.params.type = 'LIVREUR';
        req.params.id = req.params.livreurId;
        return DocumentController.findByEntity(req, res, next);
    }
);

/**
 * GET /api/v1/documents/restaurant/:restaurantId
 * Récupérer les documents d'un restaurant
 * Headers: Authorization: Bearer <token>
 * Params: restaurantId
 * Query: statut?, type_document?, include_expired=false
 * Auth: PRIVATE (propriétaire ou admin)
 * Cache: 5 minutes
 * Réponse: { status, data, statistiques }
 */
router.get('/restaurant/:restaurantId',
    authMiddleware.authenticate,
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        param('restaurantId').isInt({ min: 1 }),
        query('statut').optional().isIn(['EN_ATTENTE_VALIDATION', 'VALIDE', 'REFUSE', 'EXPIRE']),
        query('type_document').optional().isString(),
        query('include_expired').optional().isBoolean()
    ]),
    async (req, res, next) => {
        req.params.type = 'RESTAURANT_FAST_FOOD';
        req.params.id = req.params.restaurantId;
        return DocumentController.findByEntity(req, res, next);
    }
);

/**
 * GET /api/v1/documents/compagnie/:compagnieId
 * Récupérer les documents d'une compagnie de transport
 * Headers: Authorization: Bearer <token>
 * Params: compagnieId
 * Query: statut?, type_document?, include_expired=false
 * Auth: PRIVATE (propriétaire ou admin)
 * Cache: 5 minutes
 * Réponse: { status, data, statistiques }
 */
router.get('/compagnie/:compagnieId',
    authMiddleware.authenticate,
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        param('compagnieId').isInt({ min: 1 }),
        query('statut').optional().isIn(['EN_ATTENTE_VALIDATION', 'VALIDE', 'REFUSE', 'EXPIRE']),
        query('type_document').optional().isString(),
        query('include_expired').optional().isBoolean()
    ]),
    async (req, res, next) => {
        req.params.type = 'COMPAGNIE_TRANSPORT';
        req.params.id = req.params.compagnieId;
        return DocumentController.findByEntity(req, res, next);
    }
);

module.exports = router;