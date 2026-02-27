// src/routes/v1/notification.routes.js
/**
 * Routes de gestion des notifications
 * API pour la gestion complète des notifications, modèles, préférences et tokens push
 * Authentification requise pour la plupart des endpoints (sauf mention contraire)
 */
const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const validationMiddleware = require('../middlewares/validation.middleware');

const ModeleNotificationController = require('../../controllers/notification/ModeleNotificationController');
const NotificationController = require('../../controllers/notification/NotificationController');
const PreferenceNotificationController = require('../../controllers/notification/PreferenceNotificationController');
const PushTokenController = require('../../controllers/notification/PushTokenController');

// ==================== AUTHENTIFICATION GLOBALE ====================
// La plupart des routes nécessitent une authentification
// Les routes sans authentification seront spécifiées individuellement
router.use(authMiddleware.authenticate);

// ==================== I. NOTIFICATIONS UTILISATEUR ====================
// Gestion des notifications personnelles de l'utilisateur connecté

/**
 * GET /api/v1/notifications
 * Récupérer les notifications de l'utilisateur connecté
 * Query: page=1, limit=20, non_lues=false, type, priorite, canal, date_debut, date_fin
 * Auth: Bearer <token>
 * Réponse: { success, data: { notifications, stats }, pagination }
 */
router.get('/',
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('non_lues').optional().isBoolean(),
        query('type').optional().trim(),
        query('priorite').optional().isIn(['CRITIQUE', 'HAUTE', 'NORMALE', 'BASSE']),
        query('canal').optional().isIn(['IN_APP', 'PUSH_MOBILE', 'EMAIL', 'SMS', 'WHATSAPP']),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601()
    ]),
    NotificationController.getMesNotifications.bind(NotificationController)
);

/**
 * GET /api/v1/notifications/stats
 * Obtenir les statistiques des notifications
 * Query: periode=30d (24h, 7d, 30d, 1y)
 * Auth: Bearer <token>
 * Réponse: { success, data: { global, evolution, types, periode } }
 */
router.get('/stats',
    validationMiddleware.validate([
        query('periode').optional().isIn(['24h', '7d', '30d', '1y'])
    ]),
    NotificationController.getStats.bind(NotificationController)
);

/**
 * GET /api/v1/notifications/:id
 * Récupérer une notification spécifique et la marquer comme lue
 * Params: id (entier)
 * Auth: Bearer <token>
 * Réponse: { success, data: notification }
 */
router.get('/:id',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    NotificationController.getOne.bind(NotificationController)
);

/**
 * PATCH /api/v1/notifications/:id/lire
 * Marquer une notification comme lue
 * Params: id (entier)
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.patch('/:id/lire',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    NotificationController.markAsRead.bind(NotificationController)
);

/**
 * POST /api/v1/notifications/lire-toutes
 * Marquer toutes les notifications comme lues
 * Body: { type?, avant_date? }
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.post('/lire-toutes',
    validationMiddleware.validate([
        body('type').optional().trim(),
        body('avant_date').optional().isISO8601()
    ]),
    NotificationController.markAllAsRead.bind(NotificationController)
);

/**
 * PATCH /api/v1/notifications/:id/archiver
 * Archiver une notification
 * Params: id (entier)
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.patch('/:id/archiver',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    NotificationController.archive.bind(NotificationController)
);

/**
 * POST /api/v1/notifications/archiver-toutes
 * Archiver toutes les notifications
 * Body: { avant_date? }
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.post('/archiver-toutes',
    validationMiddleware.validate([
        body('avant_date').optional().isISO8601()
    ]),
    NotificationController.archiveAll.bind(NotificationController)
);

/**
 * DELETE /api/v1/notifications/:id
 * Supprimer une notification
 * Params: id (entier)
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.delete('/:id',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    NotificationController.delete.bind(NotificationController)
);

/**
 * DELETE /api/v1/notifications/nettoyer
 * Nettoyer les anciennes notifications (lues et archivées)
 * Query: avant_date (défaut: 30 jours)
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.delete('/nettoyer',
    validationMiddleware.validate([
        query('avant_date').optional().isISO8601()
    ]),
    NotificationController.cleanup.bind(NotificationController)
);

// ==================== II. ENVOI DE NOTIFICATIONS (ADMIN) ====================
// Routes réservées aux administrateurs pour l'envoi de notifications

/**
 * POST /api/v1/notifications/envoyer
 * Envoyer une notification à un utilisateur
 * Body: {
 *   destinataire_id, type, titre, corps, canal=IN_APP, priorite=NORMALE,
 *   action_type, action_id, action_url, image_url, entite_source_type,
 *   entite_source_id, date_envoi_prevu
 * }
 * Auth: Bearer <token> + ADMIN
 * Réponse: 201 { success, data: notification, message }
 */
router.post('/envoyer',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        body('destinataire_id').isInt(),
        body('titre').notEmpty().trim(),
        body('corps').notEmpty().trim(),
        body('type').optional().trim(),
        body('canal').optional().isIn(['IN_APP', 'PUSH_MOBILE', 'EMAIL', 'SMS', 'WHATSAPP']),
        body('priorite').optional().isIn(['CRITIQUE', 'HAUTE', 'NORMALE', 'BASSE']),
        body('action_type').optional().trim(),
        body('action_id').optional().isInt(),
        body('action_url').optional().isURL(),
        body('image_url').optional().isURL(),
        body('entite_source_type').optional().trim(),
        body('entite_source_id').optional().isInt(),
        body('date_envoi_prevu').optional().isISO8601()
    ]),
    NotificationController.send.bind(NotificationController)
);

/**
 * POST /api/v1/notifications/envoyer-multiple
 * Envoyer une notification à plusieurs destinataires
 * Body: {
 *   destinataires: [userId1, userId2, ...],
 *   type, titre, corps, canal=IN_APP, priorite=NORMALE,
 *   action_type, action_id, action_url
 * }
 * Auth: Bearer <token> + ADMIN
 * Réponse: 201 { success, data: { total, reussites, echecs, details }, message }
 */
router.post('/envoyer-multiple',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        body('destinataires').isArray().notEmpty(),
        body('destinataires.*').isInt(),
        body('titre').notEmpty().trim(),
        body('corps').notEmpty().trim(),
        body('type').optional().trim(),
        body('canal').optional().isIn(['IN_APP', 'PUSH_MOBILE', 'EMAIL', 'SMS', 'WHATSAPP']),
        body('priorite').optional().isIn(['CRITIQUE', 'HAUTE', 'NORMALE', 'BASSE']),
        body('action_type').optional().trim(),
        body('action_id').optional().isInt(),
        body('action_url').optional().isURL()
    ]),
    NotificationController.sendBulk.bind(NotificationController)
);

// ==================== III. MODÈLES DE NOTIFICATIONS ====================
// Gestion CRUD des modèles de notifications (administration)

/**
 * GET /api/v1/notifications/modeles
 * Récupérer tous les modèles de notification
 * Query: page=1, limit=50, est_actif, recherche
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: [modeles], pagination }
 */
router.get('/modeles',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 200 }),
        query('est_actif').optional().isBoolean(),
        query('recherche').optional().trim().isLength({ min: 2 })
    ]),
    ModeleNotificationController.findAll.bind(ModeleNotificationController)
);

/**
 * GET /api/v1/notifications/modeles/:code
 * Récupérer un modèle par son code
 * Params: code (string)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: modele }
 */
router.get('/modeles/:code',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('code').trim().notEmpty()
    ]),
    ModeleNotificationController.findOne.bind(ModeleNotificationController)
);

/**
 * POST /api/v1/notifications/modeles
 * Créer un nouveau modèle de notification
 * Body: { code, titre_template, corps_template, canal_defaut, priorite_defaut }
 * Auth: Bearer <token> + ADMIN
 * Réponse: 201 { success, data: modele, message }
 */
router.post('/modeles',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        body('code').notEmpty().trim().isLength({ min: 3, max: 100 }),
        body('titre_template').notEmpty().trim(),
        body('corps_template').notEmpty().trim(),
        body('canal_defaut').optional().isIn(['IN_APP', 'PUSH_MOBILE', 'EMAIL', 'SMS', 'WHATSAPP']),
        body('priorite_defaut').optional().isIn(['CRITIQUE', 'HAUTE', 'NORMALE', 'BASSE'])
    ]),
    ModeleNotificationController.create.bind(ModeleNotificationController)
);

/**
 * PUT /api/v1/notifications/modeles/:code
 * Mettre à jour un modèle existant
 * Params: code (string)
 * Body: { titre_template?, corps_template?, canal_defaut?, priorite_defaut?, est_actif? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: modele, message }
 */
router.put('/modeles/:code',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('code').trim().notEmpty(),
        body('titre_template').optional().trim(),
        body('corps_template').optional().trim(),
        body('canal_defaut').optional().isIn(['IN_APP', 'PUSH_MOBILE', 'EMAIL', 'SMS', 'WHATSAPP']),
        body('priorite_defaut').optional().isIn(['CRITIQUE', 'HAUTE', 'NORMALE', 'BASSE']),
        body('est_actif').optional().isBoolean()
    ]),
    ModeleNotificationController.update.bind(ModeleNotificationController)
);

/**
 * DELETE /api/v1/notifications/modeles/:code
 * Supprimer ou désactiver un modèle
 * Params: code (string)
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, message }
 */
router.delete('/modeles/:code',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('code').trim().notEmpty()
    ]),
    ModeleNotificationController.delete.bind(ModeleNotificationController)
);

/**
 * POST /api/v1/notifications/modeles/:code/test
 * Tester un modèle avec des variables
 * Params: code (string)
 * Body: { variables: { key: value, ... } }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data: { code, titre, corps, canal_defaut, priorite_defaut } }
 */
router.post('/modeles/:code/test',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('code').trim().notEmpty(),
        body('variables').optional().isObject()
    ]),
    ModeleNotificationController.test.bind(ModeleNotificationController)
);

// ==================== IV. PRÉFÉRENCES DE NOTIFICATIONS ====================
// Gestion des préférences utilisateur pour les notifications

/**
 * GET /api/v1/notifications/preferences
 * Récupérer les préférences de notification de l'utilisateur
 * Auth: Bearer <token>
 * Réponse: { success, data: { preferences, types_disponibles } }
 */
router.get('/preferences',
    PreferenceNotificationController.getMyPreferences.bind(PreferenceNotificationController)
);

/**
 * PUT /api/v1/notifications/preferences/:canal
 * Mettre à jour les préférences pour un canal spécifique
 * Params: canal (IN_APP, PUSH_MOBILE, EMAIL, SMS, WHATSAPP)
 * Body: { preferences: [{ type_evenement, est_active, heure_debut_silencieux, heure_fin_silencieux }] }
 * Auth: Bearer <token>
 * Réponse: { success, data: preferences, message }
 */
router.put('/preferences/:canal',
    validationMiddleware.validate([
        param('canal').isIn(['IN_APP', 'PUSH_MOBILE', 'EMAIL', 'SMS', 'WHATSAPP']),
        body('preferences').isArray().notEmpty()
    ]),
    PreferenceNotificationController.updateChannelPreferences.bind(PreferenceNotificationController)
);

/**
 * PATCH /api/v1/notifications/preferences/:canal/:type_evenement
 * Mettre à jour une préférence spécifique
 * Params: canal, type_evenement
 * Body: { est_active?, heure_debut_silencieux?, heure_fin_silencieux? }
 * Auth: Bearer <token>
 * Réponse: { success, data: preference, message }
 */
router.patch('/preferences/:canal/:type_evenement',
    validationMiddleware.validate([
        param('canal').isIn(['IN_APP', 'PUSH_MOBILE', 'EMAIL', 'SMS', 'WHATSAPP']),
        param('type_evenement').trim().notEmpty(),
        body('est_active').optional().isBoolean(),
        body('heure_debut_silencieux').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        body('heure_fin_silencieux').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    ]),
    PreferenceNotificationController.updateOne.bind(PreferenceNotificationController)
);

/**
 * PATCH /api/v1/notifications/preferences/:canal/silencieux
 * Activer/Désactiver les heures silencieuses pour un canal
 * Params: canal
 * Body: { actif, heure_debut?, heure_fin? }
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.patch('/preferences/:canal/silencieux',
    validationMiddleware.validate([
        param('canal').isIn(['IN_APP', 'PUSH_MOBILE', 'EMAIL', 'SMS', 'WHATSAPP']),
        body('actif').isBoolean(),
        body('heure_debut').if(body('actif').equals('true')).matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        body('heure_fin').if(body('actif').equals('true')).matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    ]),
    PreferenceNotificationController.setQuietHours.bind(PreferenceNotificationController)
);

/**
 * POST /api/v1/notifications/preferences/reinitialiser
 * Réinitialiser les préférences par défaut
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.post('/preferences/reinitialiser',
    PreferenceNotificationController.resetToDefault.bind(PreferenceNotificationController)
);

// ==================== V. TOKENS PUSH ====================
// Gestion des tokens pour notifications push mobile/web

/**
 * POST /api/v1/notifications/tokens-push
 * Enregistrer un token push
 * Body: { token, plateforme: IOS|ANDROID|WEB }
 * Auth: Bearer <token>
 * Réponse: 201 { success, data: token, message }
 */
router.post('/tokens-push',
    validationMiddleware.validate([
        body('token').notEmpty().trim(),
        body('plateforme').isIn(['IOS', 'ANDROID', 'WEB'])
    ]),
    PushTokenController.registerToken.bind(PushTokenController)
);

/**
 * GET /api/v1/notifications/tokens-push
 * Récupérer les tokens actifs de l'utilisateur
 * Auth: Bearer <token>
 * Réponse: { success, data: [tokens] }
 */
router.get('/tokens-push',
    PushTokenController.getMyTokens.bind(PushTokenController)
);

/**
 * DELETE /api/v1/notifications/tokens-push/:token
 * Désenregistrer un token push
 * Params: token (string)
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.delete('/tokens-push/:token',
    validationMiddleware.validate([
        param('token').notEmpty()
    ]),
    PushTokenController.unregisterToken.bind(PushTokenController)
);

/**
 * POST /api/v1/notifications/tokens-push/:token/utilisation
 * Mettre à jour la date de dernière utilisation d'un token
 * Params: token (string)
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.post('/tokens-push/:token/utilisation',
    validationMiddleware.validate([
        param('token').notEmpty()
    ]),
    PushTokenController.updateLastUsed.bind(PushTokenController)
);

/**
 * DELETE /api/v1/notifications/tokens-push/nettoyer
 * Nettoyer les tokens expirés/inactifs de l'utilisateur
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.delete('/tokens-push/nettoyer',
    PushTokenController.cleanupTokens.bind(PushTokenController)
);

/**
 * POST /api/v1/notifications/tokens-push/test
 * Tester l'envoi d'une notification push (debug)
 * Body: { token, titre?, corps? }
 * Auth: Bearer <token> + ADMIN
 * Réponse: { success, data, message }
 */
router.post('/tokens-push/test',
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        body('token').notEmpty(),
        body('titre').optional().trim(),
        body('corps').optional().trim()
    ]),
    PushTokenController.testPush.bind(PushTokenController)
);

module.exports = router;