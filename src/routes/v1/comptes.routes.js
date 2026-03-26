// src/routes/v1/comptes.routes.js
/**
 * Routes de gestion des comptes utilisateurs
 * API pour la gestion complète des comptes, rôles, sessions et vérifications
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

const CompteController = require('../../controllers/comptes/CompteController');
const RoleController = require('../../controllers/comptes/RoleController');
const SessionController = require('../../controllers/comptes/SessionController');
const VerificationController = require('../../controllers/comptes/VerificationController');

// ==================== CONFIGURATION RATE LIMITING ====================

const verificationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 tentatives
    message: 'Trop de tentatives de vérification. Réessayez plus tard.',
    standardHeaders: true,
    legacyHeaders: false
});

// ==================== I. COMPTES ====================

/**
 * GET /api/v1/comptes
 * Récupérer tous les comptes avec pagination et filtres
 * Headers: Authorization: Bearer <token>
 * Query: page=1, limit=20, role?, statut?, recherche?, compagnie_id?,
 *        restaurant_id?, boutique_id?, tri=date_creation_desc
 * Auth: ADMIN
 * Réponse: { success, data, pagination }
 */
router.get('/',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    roleMiddleware.isPlatformAdmin(),
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('role').optional().isString(),
        query('statut').optional().isString(),
        query('recherche').optional().trim(),
        query('compagnie_id').optional().isInt(),
        query('restaurant_id').optional().isInt(),
        query('boutique_id').optional().isInt(),
        query('tri').optional().isIn(['date_creation_asc', 'date_creation_desc', 'nom_asc', 'nom_desc', 'derniere_connexion_desc'])
    ]),
    CompteController.getAll.bind(CompteController)
);

/**
 * GET /api/v1/comptes/stats
 * Récupérer les statistiques des comptes
 * Headers: Authorization: Bearer <token>
 * Auth: ADMIN
 * Cache: 10 minutes
 * Réponse: { success, data }
 */
router.get('/stats',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(600), // 10 minutes
    CompteController.getStats.bind(CompteController)
);

/**
 * GET /api/v1/comptes/recherche
 * Recherche avancée de comptes
 * Headers: Authorization: Bearer <token>
 * Query: q?, role?, statut?, localisation?, rayon_km?, page=1, limit=20
 * Auth: ADMIN
 * Réponse: { success, data, pagination }
 */
router.get('/recherche',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        query('q').optional().trim(),
        query('role').optional().isString(),
        query('statut').optional().isString(),
        query('localisation').optional().matches(/^-?\d+\.?\d*,-?\d+\.?\d*$/),
        query('rayon_km').optional().isFloat({ min: 0.1, max: 50 }),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 50 })
    ]),
    CompteController.search.bind(CompteController)
);

/**
 * GET /api/v1/comptes/:id
 * Récupérer un compte par ID
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: USER (propriétaire) ou ADMIN
 * Réponse: { success, data }
 */
router.get('/:id',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    CompteController.getById.bind(CompteController)
);

/**
 * PUT /api/v1/comptes/:id
 * Mettre à jour un compte
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: {
 *   nom_utilisateur_compte?, numero_de_telephone?, photo_profil_compte?,
 *   localisation_livraison?: { lat, lng },
 *   statut?, compte_role?, compagnie_id?, emplacement_id?,
 *   restaurant_id?, boutique_id? (admin seulement)
 * }
 * Auth: USER (propriétaire) ou ADMIN
 * Réponse: { success, message, data }
 */
router.put('/:id',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt(),
        body('nom_utilisateur_compte').optional().trim().isLength({ min: 3, max: 50 }),
        body('numero_de_telephone').optional().matches(/^[0-9+\-\s]+$/),
        body('photo_profil_compte').optional().isURL(),
        body('localisation_livraison.lat').optional().isFloat({ min: -90, max: 90 }),
        body('localisation_livraison.lng').optional().isFloat({ min: -180, max: 180 }),
        body('statut').optional().isIn(['NON_AUTHENTIFIE', 'EST_AUTHENTIFIE', 'SUSPENDU', 'BANNI']),
        body('compte_role').optional().isString(),
        body('compagnie_id').optional().isInt(),
        body('emplacement_id').optional().isInt(),
        body('restaurant_id').optional().isInt(),
        body('boutique_id').optional().isInt()
    ]),
    CompteController.update.bind(CompteController)
);

/**
 * POST /api/v1/comptes/:id/photo
 * Upload de photo de profil
 * Headers: Authorization: Bearer <token>
 * Params: id
 * File: photo (image, multipart/form-data)
 * Auth: USER (propriétaire) ou ADMIN
 * Réponse: { success, message, data }
 */
router.post('/:id/photo',
    authMiddleware.authenticate,
    uploadMiddleware.single('photo'),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    CompteController.uploadPhoto.bind(CompteController)
);

/**
 * DELETE /api/v1/comptes/:id
 * Supprimer un compte (soft delete)
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: USER (propriétaire) ou ADMIN
 * Réponse: { success, message }
 */
router.delete('/:id',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    CompteController.delete.bind(CompteController)
);

/**
 * POST /api/v1/comptes/:id/restaurer
 * Restaurer un compte supprimé
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: ADMIN
 * Réponse: { success, message }
 */
router.post('/:id/restaurer',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    CompteController.restore.bind(CompteController)
);

// ==================== II. RÔLES ====================

/**
 * GET /api/v1/roles
 * Récupérer tous les rôles disponibles
 * Headers: Authorization: Bearer <token>
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { status, data, total }
 */
router.get('/roles',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    RoleController.getAllRoles.bind(RoleController)
);

/**
 * GET /api/v1/roles/hierarchy
 * Récupérer la hiérarchie des rôles
 * Headers: Authorization: Bearer <token>
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { status, data }
 */
router.get('/roles/hierarchy',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    RoleController.getRoleHierarchy.bind(RoleController)
);

/**
 * GET /api/v1/roles/stats
 * Récupérer les statistiques des rôles
 * Headers: Authorization: Bearer <token>
 * Auth: ADMIN
 * Cache: 10 minutes
 * Réponse: { status, data }
 */
router.get('/roles/stats',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(600), // 10 minutes
    RoleController.getRolesStats.bind(RoleController)
);

/**
 * GET /api/v1/roles/check-availability
 * Vérifier la disponibilité d'un rôle pour une entité
 * Headers: Authorization: Bearer <token>
 * Query: role, entite_type, entite_id
 * Auth: ADMIN
 * Réponse: { status, data }
 */
router.get('/roles/check-availability',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        query('role').notEmpty(),
        query('entite_type').isIn(['BOUTIQUE', 'RESTAURANT', 'COMPAGNIE']),
        query('entite_id').isInt()
    ]),
    RoleController.checkRoleAvailability.bind(RoleController)
);

/**
 * GET /api/v1/roles/:role/permissions
 * Récupérer les permissions d'un rôle
 * Headers: Authorization: Bearer <token>
 * Params: role
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { status, data, meta }
 */
router.get('/roles/:role/permissions',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        param('role').notEmpty()
    ]),
    RoleController.getRolePermissions.bind(RoleController)
);

/**
 * PUT /api/v1/roles/:role/permissions
 * Mettre à jour les permissions d'un rôle
 * Headers: Authorization: Bearer <token>
 * Params: role
 * Body: { permission: boolean, ... }
 * Auth: ADMIN
 * Réponse: { status, message, data }
 */
router.put('/roles/:role/permissions',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('role').notEmpty()
    ]),
    RoleController.updateRolePermissions.bind(RoleController)
);

/**
 * GET /api/v1/roles/:role/utilisateurs
 * Récupérer les utilisateurs par rôle
 * Headers: Authorization: Bearer <token>
 * Params: role
 * Query: page=1, limit=20, statut?, recherche?, entite_id?
 * Auth: ADMIN
 * Réponse: { status, data, pagination, meta }
 */
router.get('/roles/:role/utilisateurs',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('role').notEmpty(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('statut').optional().isString(),
        query('recherche').optional().trim(),
        query('entite_id').optional().isInt()
    ]),
    RoleController.getUsersByRole.bind(RoleController)
);

/**
 * POST /api/v1/comptes/:userId/assign-role
 * Assigner un rôle à un utilisateur
 * Headers: Authorization: Bearer <token>
 * Params: userId
 * Body: { role, entite_id? }
 * Auth: ADMIN
 * Réponse: { status, data, message }
 */
router.post('/comptes/:userId/assign-role',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('userId').isInt(),
        body('role').notEmpty(),
        body('entite_id').optional().isInt()
    ]),
    RoleController.assignRole.bind(RoleController)
);

/**
 * POST /api/v1/comptes/:userId/remove-role
 * Retirer un rôle (remettre utilisateur simple)
 * Headers: Authorization: Bearer <token>
 * Params: userId
 * Auth: ADMIN
 * Réponse: { status, message }
 */
router.post('/comptes/:userId/remove-role',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('userId').isInt()
    ]),
    RoleController.removeRole.bind(RoleController)
);

/**
 * GET /api/v1/comptes/:userId/check-permission/:permission
 * Vérifier si un utilisateur a une permission
 * Headers: Authorization: Bearer <token>
 * Params: userId, permission
 * Auth: ADMIN
 * Réponse: { status, data }
 */
router.get('/comptes/:userId/check-permission/:permission',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('userId').isInt(),
        param('permission').notEmpty()
    ]),
    RoleController.checkPermission.bind(RoleController)
);

// ==================== III. SESSIONS ====================

/**
 * GET /api/v1/comptes/:id/sessions
 * Récupérer les sessions actives d'un utilisateur
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: USER (propriétaire) ou ADMIN
 * Réponse: { success, data }
 */
router.get('/comptes/:id/sessions',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    SessionController.getUserSessions.bind(SessionController)
);

/**
 * DELETE /api/v1/sessions/:sessionId
 * Terminer une session spécifique
 * Headers: Authorization: Bearer <token>
 * Params: sessionId
 * Auth: USER (propriétaire) ou ADMIN
 * Réponse: { success, message }
 */
router.delete('/sessions/:sessionId',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('sessionId').isInt()
    ]),
    SessionController.terminateSession.bind(SessionController)
);

/**
 * DELETE /api/v1/sessions/autres
 * Terminer toutes les sessions sauf la courante
 * Headers: Authorization: Bearer <token>
 * Auth: PRIVATE
 * Réponse: { success, message }
 */
router.delete('/sessions/autres',
    authMiddleware.authenticate,
    SessionController.terminateOtherSessions.bind(SessionController)
);

// ==================== IV. VÉRIFICATIONS ====================

/**
 * POST /api/v1/verifier-code
 * Vérifier le code d'authentification
 * Body: { email, code }
 * Rate limit: 5 par 15 minutes
 * Auth: PUBLIC
 * Réponse: { status, message }
 */
router.post('/verifier-code',
    verificationLimiter,
    validationMiddleware.validate([
        body('email').isEmail().normalizeEmail(),
        body('code').isLength({ min: 6, max: 6 }).isNumeric()
    ]),
    VerificationController.verifierCode.bind(VerificationController)
);

/**
 * POST /api/v1/renvoyer-code
 * Renvoyer un code de vérification
 * Body: { email }
 * Rate limit: 3 par heure
 * Auth: PUBLIC
 * Réponse: { status, message }
 */
router.post('/renvoyer-code',
    rateLimit({
        windowMs: 60 * 60 * 1000, // 1 heure
        max: 3,
        message: 'Trop de demandes de code. Réessayez plus tard.'
    }),
    validationMiddleware.validate([
        body('email').isEmail().normalizeEmail()
    ]),
    VerificationController.renvoyerCode.bind(VerificationController)
);

/**
 * GET /api/v1/verifier-email/:token
 * Vérifier l'email avec token
 * Params: token
 * Auth: PUBLIC
 * Réponse: { status, message }
 */
router.get('/verifier-email/:token',
    validationMiddleware.validate([
        param('token').notEmpty()
    ]),
    VerificationController.verifierEmail.bind(VerificationController)
);

/**
 * POST /api/v1/verifier-telephone
 * Vérifier le numéro de téléphone
 * Headers: Authorization: Bearer <token>
 * Body: { code }
 * Auth: PRIVATE
 * Réponse: { status, message }
 */
router.post('/verifier-telephone',
    authMiddleware.authenticate,
    verificationLimiter,
    validationMiddleware.validate([
        body('code').isLength({ min: 6, max: 6 }).isNumeric()
    ]),
    VerificationController.verifierTelephone.bind(VerificationController)
);

// ==================== V. AUTHENTIFICATION À DEUX FACTEURS (2FA) ====================

/**
 * POST /api/v1/2fa/activer
 * Activer la 2FA (génération secret)
 * Headers: Authorization: Bearer <token>
 * Auth: PRIVATE
 * Réponse: { status, data: { secret, qr_code } }
 */
router.post('/2fa/activer',
    authMiddleware.authenticate,
    VerificationController.activer2FA.bind(VerificationController)
);

/**
 * POST /api/v1/2fa/valider
 * Valider et activer la 2FA
 * Headers: Authorization: Bearer <token>
 * Body: { token }
 * Auth: PRIVATE
 * Réponse: { status, message, data: { backup_codes } }
 */
router.post('/2fa/valider',
    authMiddleware.authenticate,
    verificationLimiter,
    validationMiddleware.validate([
        body('token').isLength({ min: 6, max: 6 }).isNumeric()
    ]),
    VerificationController.valider2FA.bind(VerificationController)
);

/**
 * POST /api/v1/2fa/desactiver
 * Désactiver la 2FA
 * Headers: Authorization: Bearer <token>
 * Body: { mot_de_passe }
 * Auth: PRIVATE
 * Réponse: { status, message }
 */
router.post('/2fa/desactiver',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        body('mot_de_passe').notEmpty()
    ]),
    VerificationController.desactiver2FA.bind(VerificationController)
);

/**
 * POST /api/v1/2fa/verifier
 * Vérifier 2FA pendant login
 * Body: { userId, token?, backupCode? }
 * Auth: PUBLIC
 * Réponse: { status, verified, backup_used?, remaining_codes? }
 */
router.post('/2fa/verifier',
    verificationLimiter,
    validationMiddleware.validate([
        body('userId').isInt(),
        body('token').optional().isLength({ min: 6, max: 6 }).isNumeric(),
        body('backupCode').optional().isLength({ min: 8, max: 8 }),
        body().custom(body => {
            if (!body.token && !body.backupCode) {
                throw new Error('Token ou code de secours requis');
            }
            return true;
        })
    ]),
    VerificationController.verifier2FA.bind(VerificationController)
);

// ==================== VI. COMPTE PERSONNEL (UTILISATEUR CONNECTÉ) ====================

/**
 * GET /api/v1/mon-compte
 * Récupérer les informations du compte connecté
 * Headers: Authorization: Bearer <token>
 * Auth: PRIVATE
 * Réponse: { success, data }
 */
/*
router.get('/mon-compte',
    authMiddleware.authenticate,
    CompteController.getMonCompte.bind(CompteController)
);
*/
/**
 * PUT /api/v1/mon-compte
 * Mettre à jour son propre compte
 * Headers: Authorization: Bearer <token>
 * Body: { nom_utilisateur?, numero_de_telephone?, photo_profil?, localisation_livraison? }
 * Auth: PRIVATE
 * Réponse: { success, message, data }
 */
/*
router.put('/mon-compte',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        body('nom_utilisateur').optional().trim().isLength({ min: 3, max: 50 }),
        body('numero_de_telephone').optional().matches(/^[0-9+\-\s]+$/),
        body('photo_profil').optional().isURL(),
        body('localisation_livraison.lat').optional().isFloat({ min: -90, max: 90 }),
        body('localisation_livraison.lng').optional().isFloat({ min: -180, max: 180 })
    ]),
    CompteController.updateMonCompte.bind(CompteController)
);
*/
/**
 * POST /api/v1/mon-compte/photo
 * Uploader sa photo de profil
 * Headers: Authorization: Bearer <token>
 * File: photo (image, multipart/form-data)
 * Auth: PRIVATE
 * Réponse: { success, message, data }
 */
/*
router.post('/mon-compte/photo',
    authMiddleware.authenticate,
    uploadMiddleware.single('photo'),
    CompteController.uploadMaPhoto.bind(CompteController)
);*/

/**
 * DELETE /api/v1/mon-compte
 * Supprimer son propre compte
 * Headers: Authorization: Bearer <token>
 * Body: { mot_de_passe, raison? }
 * Auth: PRIVATE
 * Réponse: { success, message }
 */
/*
router.delete('/mon-compte',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        body('mot_de_passe').notEmpty(),
        body('raison').optional().trim().isLength({ max: 500 })
    ]),
    CompteController.deleteMonCompte.bind(CompteController)
);
*/
module.exports = router;