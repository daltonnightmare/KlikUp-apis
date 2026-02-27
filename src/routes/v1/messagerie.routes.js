// src/routes/v1/messagerie.routes.js
/**
 * Routes de messagerie instantanée
 * API pour la gestion complète des conversations, messages, réactions, invitations et blocages
 * Authentification requise pour tous les endpoints
 */
const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const validationMiddleware = require('../middlewares/validation.middleware');
const uploadMiddleware = require('../middlewares/upload.middleware');
const cacheMiddleware = require('../middlewares/cache.middleware');
const rateLimiter = require('../middlewares/rateLimiter.middleware');

const ConversationController = require('../../controllers/messagerie/ConversationController');
const MessageController = require('../../controllers/messagerie/MessageController');
const ReactionController = require('../../controllers/messagerie/ReactionController');
const InvitationController = require('../../controllers/messagerie/InvitationController');
const BlocageController = require('../../controllers/messagerie/BlocageController');
const ModeleMessageController = require('../../controllers/messagerie/ModeleMessageController');

// ==================== AUTHENTIFICATION GLOBALE ====================
// Toutes les routes de messagerie nécessitent une authentification
router.use(authMiddleware.authenticate);

// ==================== I. CONVERSATIONS ====================

/**
 * GET /api/v1/messagerie/conversations
 * Récupérer les conversations de l'utilisateur
 * Query: page=1, limit=20, type_conversation?, est_archive=false, recherche?, non_lus?
 * Auth: Bearer <token>
 * Cache: 30 secondes
 * Réponse: { success, data: { conversations, stats }, pagination }
 */
router.get('/conversations',
    cacheMiddleware.cache(30), // 30 secondes
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('type_conversation').optional().isIn([
            'DIRECT', 'GROUPE', 'SUPPORT', 'COMMANDE', 'LIVRAISON',
            'SERVICE_CLIENT', 'NOTIFICATION_ADMIN', 'ANNONCE_PLATEFORME',
            'SIGNALEMENT', 'RECLAMATION'
        ]),
        query('est_archive').optional().isBoolean(),
        query('recherche').optional().trim(),
        query('non_lus').optional().isBoolean()
    ]),
    ConversationController.getMesConversations.bind(ConversationController)
);

/**
 * GET /api/v1/messagerie/conversations/recherche
 * Rechercher des conversations
 * Query: q?, type?, entite_type?, entite_id?, page=1, limit=20
 * Auth: Bearer <token>
 * Cache: 2 minutes
 * Réponse: { success, data, pagination }
 */
router.get('/conversations/recherche',
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        query('q').optional().trim(),
        query('type').optional().isIn([
            'DIRECT', 'GROUPE', 'SUPPORT', 'COMMANDE', 'LIVRAISON',
            'SERVICE_CLIENT', 'NOTIFICATION_ADMIN', 'ANNONCE_PLATEFORME'
        ]),
        query('entite_type').optional().isString(),
        query('entite_id').optional().isInt(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 })
    ]),
    ConversationController.search.bind(ConversationController)
);

/**
 * POST /api/v1/messagerie/conversations
 * Créer une nouvelle conversation
 * Body: {
 *   type_conversation='DIRECT', titre_conversation?, description_conversation?,
 *   est_prive=true, necessite_approbation=false, entite_type?, entite_id?,
 *   participants=[], metadata={}
 * }
 * Auth: Bearer <token>
 * Réponse: 201 { success, data, message }
 */
router.post('/conversations',
    validationMiddleware.validate([
        body('type_conversation').optional().isIn([
            'DIRECT', 'GROUPE', 'SUPPORT', 'COMMANDE', 'LIVRAISON',
            'SERVICE_CLIENT', 'NOTIFICATION_ADMIN', 'ANNONCE_PLATEFORME',
            'SIGNALEMENT', 'RECLAMATION'
        ]),
        body('titre_conversation').optional().trim().isLength({ max: 255 }),
        body('description_conversation').optional().trim(),
        body('est_prive').optional().isBoolean(),
        body('necessite_approbation').optional().isBoolean(),
        body('entite_type').optional().isString(),
        body('entite_id').optional().isInt(),
        body('participants').optional().isArray(),
        body('participants.*').isInt(),
        body('metadata').optional().isObject()
    ]),
    ConversationController.create.bind(ConversationController)
);

/**
 * GET /api/v1/messagerie/conversations/:id
 * Récupérer les détails d'une conversation
 * Params: id
 * Auth: Bearer <token>
 * Cache: 1 minute
 * Réponse: { success, data: conversation_avec_participants }
 */
router.get('/conversations/:id',
    cacheMiddleware.cache(60), // 1 minute
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ConversationController.getOne.bind(ConversationController)
);

/**
 * PUT /api/v1/messagerie/conversations/:id
 * Mettre à jour une conversation
 * Params: id
 * Body: { titre_conversation?, description_conversation?, avatar_conversation?,
 *         est_prive?, necessite_approbation?, est_archive?, est_verrouille?,
 *         metadata?, tags? }
 * Auth: Bearer <token> (admin uniquement)
 * Réponse: { success, data, message }
 */
router.put('/conversations/:id',
    validationMiddleware.validate([
        param('id').isInt(),
        body('titre_conversation').optional().trim().isLength({ max: 255 }),
        body('description_conversation').optional().trim(),
        body('avatar_conversation').optional().isURL(),
        body('est_prive').optional().isBoolean(),
        body('necessite_approbation').optional().isBoolean(),
        body('est_archive').optional().isBoolean(),
        body('est_verrouille').optional().isBoolean(),
        body('metadata').optional().isObject(),
        body('tags').optional().isArray()
    ]),
    ConversationController.update.bind(ConversationController)
);

/**
 * PATCH /api/v1/messagerie/conversations/:id/archive
 * Archiver ou restaurer une conversation
 * Params: id
 * Body: { archived: boolean }
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.patch('/conversations/:id/archive',
    validationMiddleware.validate([
        param('id').isInt(),
        body('archived').isBoolean()
    ]),
    ConversationController.toggleArchive.bind(ConversationController)
);

/**
 * POST /api/v1/messagerie/conversations/:id/quitter
 * Quitter une conversation
 * Params: id
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.post('/conversations/:id/quitter',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ConversationController.quitter.bind(ConversationController)
);

// ==================== II. MESSAGES ====================

/**
 * GET /api/v1/messagerie/conversations/:conversationId/messages
 * Récupérer les messages d'une conversation
 * Params: conversationId
 * Query: before?, after?, limit=50, around?, type_message?, search?
 * Auth: Bearer <token>
 * Cache: 10 secondes
 * Réponse: { success, data: messages_groupes, has_more }
 */
router.get('/conversations/:conversationId/messages',
    cacheMiddleware.cache(10), // 10 secondes
    validationMiddleware.validate([
        param('conversationId').isInt(),
        query('limit').optional().isInt({ min: 1, max: 200 }),
        query('before').optional().isISO8601(),
        query('after').optional().isISO8601(),
        query('around').optional().isInt(),
        query('type_message').optional().isIn(['TEXTE', 'IMAGE', 'VIDEO', 'AUDIO', 'FICHIER', 'LOCALISATION']),
        query('search').optional().trim()
    ]),
    MessageController.getMessages.bind(MessageController)
);

/**
 * POST /api/v1/messagerie/conversations/:conversationId/messages
 * Envoyer un message avec pièces jointes optionnelles
 * Params: conversationId
 * Body: {
 *   contenu_message?, type_message='TEXTE', est_important=false,
 *   est_silencieux=false, message_parent_id?, reponse_a_id?,
 *   mentions_comptes=[], metadata={}
 * }
 * Files: files (multipart/form-data, jusqu'à 10 fichiers)
 * Auth: Bearer <token>
 * Réponse: 201 { success, data, message }
 */
router.post('/conversations/:conversationId/messages',
    uploadMiddleware.multiple('files', 10),
    validationMiddleware.validate([
        param('conversationId').isInt(),
        body('contenu_message').optional().trim(),
        body('type_message').optional().isIn(['TEXTE', 'IMAGE', 'VIDEO', 'AUDIO', 'FICHIER', 'LOCALISATION']),
        body('est_important').optional().isBoolean(),
        body('est_silencieux').optional().isBoolean(),
        body('message_parent_id').optional().isInt(),
        body('reponse_a_id').optional().isInt(),
        body('mentions_comptes').optional().isArray(),
        body('mentions_comptes.*').isInt(),
        body('metadata').optional().isObject(),
        body().custom(body => {
            if (!body.contenu_message && !req.files?.length) {
                throw new Error('Message vide (contenu ou pièces jointes requis)');
            }
            return true;
        })
    ]),
    MessageController.send.bind(MessageController)
);

/**
 * POST /api/v1/messagerie/conversations/:conversationId/lire
 * Marquer tous les messages comme lus
 * Params: conversationId
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.post('/conversations/:conversationId/lire',
    validationMiddleware.validate([
        param('conversationId').isInt()
    ]),
    MessageController.markAsRead.bind(MessageController)
);

/**
 * PUT /api/v1/messagerie/messages/:id
 * Modifier le contenu d'un message
 * Params: id
 * Body: { contenu_message }
 * Auth: Bearer <token> (auteur uniquement)
 * Réponse: { success, message }
 */
router.put('/messages/:id',
    validationMiddleware.validate([
        param('id').isInt(),
        body('contenu_message').notEmpty().trim()
    ]),
    MessageController.update.bind(MessageController)
);

/**
 * DELETE /api/v1/messagerie/messages/:id
 * Supprimer un message (soft delete)
 * Params: id
 * Body: { motif? }
 * Auth: Bearer <token> (auteur ou admin)
 * Réponse: { success, message }
 */
router.delete('/messages/:id',
    validationMiddleware.validate([
        param('id').isInt(),
        body('motif').optional().trim()
    ]),
    MessageController.delete.bind(MessageController)
);

/**
 * GET /api/v1/messagerie/recherche
 * Rechercher des messages dans toutes les conversations
 * Query: q?, conversation_id?, expediteur_id?, date_debut?, date_fin?,
 *        page=1, limit=50
 * Auth: Bearer <token>
 * Cache: 2 minutes
 * Réponse: { success, data, pagination }
 */
router.get('/recherche',
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        query('q').optional().trim(),
        query('conversation_id').optional().isInt(),
        query('expediteur_id').optional().isInt(),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 })
    ]),
    MessageController.searchMessages.bind(MessageController)
);

// ==================== III. RÉACTIONS ====================

/**
 * POST /api/v1/messagerie/messages/:messageId/reactions
 * Ajouter ou retirer une réaction emoji à un message
 * Params: messageId
 * Body: { emoji }
 * Auth: Bearer <token>
 * Réponse: { success, data: { action, reactions } }
 */
router.post('/messages/:messageId/reactions',
    validationMiddleware.validate([
        param('messageId').isInt(),
        body('emoji').notEmpty().trim()
    ]),
    ReactionController.addOrUpdate.bind(ReactionController)
);

/**
 * GET /api/v1/messagerie/messages/:messageId/reactions
 * Récupérer toutes les réactions sur un message
 * Params: messageId
 * Auth: Bearer <token>
 * Cache: 1 minute
 * Réponse: { success, data: { reactions, my_reactions } }
 */
router.get('/messages/:messageId/reactions',
    cacheMiddleware.cache(60), // 1 minute
    validationMiddleware.validate([
        param('messageId').isInt()
    ]),
    ReactionController.getReactions.bind(ReactionController)
);

/**
 * DELETE /api/v1/messagerie/messages/:messageId/reactions/:emoji
 * Supprimer une réaction spécifique
 * Params: messageId, emoji
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.delete('/messages/:messageId/reactions/:emoji',
    validationMiddleware.validate([
        param('messageId').isInt(),
        param('emoji').notEmpty()
    ]),
    ReactionController.remove.bind(ReactionController)
);

// ==================== IV. INVITATIONS ====================

/**
 * GET /api/v1/messagerie/invitations/en-attente
 * Récupérer les invitations en attente
 * Auth: Bearer <token>
 * Cache: 2 minutes
 * Réponse: { success, data }
 */
router.get('/invitations/en-attente',
    cacheMiddleware.cache(120), // 2 minutes
    InvitationController.getPendingInvitations.bind(InvitationController)
);

/**
 * POST /api/v1/messagerie/conversations/:conversationId/invitations
 * Inviter des utilisateurs à une conversation
 * Params: conversationId
 * Body: { invitations: [{ email?, compte_id?, role_propose?, message? }] }
 * Auth: Bearer <token>
 * Réponse: 201 { success, data, message }
 */
router.post('/conversations/:conversationId/invitations',
    validationMiddleware.validate([
        param('conversationId').isInt(),
        body('invitations').isArray().notEmpty(),
        body('invitations.*.email').optional().isEmail(),
        body('invitations.*.compte_id').optional().isInt(),
        body('invitations.*.role_propose').optional().isIn(['PARTICIPANT', 'MODERATEUR', 'ADMIN']),
        body('invitations.*.message').optional().trim(),
        body().custom(body => {
            for (const inv of body.invitations) {
                if (!inv.email && !inv.compte_id) {
                    throw new Error('Email ou compte_id requis pour chaque invitation');
                }
            }
            return true;
        })
    ]),
    InvitationController.invite.bind(InvitationController)
);

/**
 * POST /api/v1/messagerie/invitations/:token/accepter
 * Accepter une invitation par token
 * Params: token (UUID)
 * Auth: Bearer <token>
 * Réponse: { success, message, data: { conversation_id } }
 */
router.post('/invitations/:token/accepter',
    validationMiddleware.validate([
        param('token').isUUID()
    ]),
    InvitationController.accept.bind(InvitationController)
);

/**
 * POST /api/v1/messagerie/invitations/:token/refuser
 * Refuser une invitation par token
 * Params: token (UUID)
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.post('/invitations/:token/refuser',
    validationMiddleware.validate([
        param('token').isUUID()
    ]),
    InvitationController.decline.bind(InvitationController)
);

/**
 * DELETE /api/v1/messagerie/invitations/:id
 * Annuler une invitation envoyée
 * Params: id
 * Auth: Bearer <token> (inviteur uniquement)
 * Réponse: { success, message }
 */
router.delete('/invitations/:id',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    InvitationController.cancel.bind(InvitationController)
);

// ==================== V. BLOCAGES ====================

/**
 * GET /api/v1/messagerie/blocages
 * Récupérer la liste des comptes bloqués
 * Query: page=1, limit=20, type_blocage?
 * Auth: Bearer <token>
 * Cache: 5 minutes
 * Réponse: { success, data, stats, pagination }
 */
router.get('/blocages',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('type_blocage').optional().isIn(['MESSAGERIE', 'CONVERSATION', 'GLOBAL'])
    ]),
    BlocageController.getMyBlocks.bind(BlocageController)
);

/**
 * GET /api/v1/messagerie/blocages/check/:userId
 * Vérifier si un utilisateur est bloqué
 * Params: userId
 * Auth: Bearer <token>
 * Cache: 2 minutes
 * Réponse: { success, data: { blocked_by_me, blocked_me, can_message } }
 */
router.get('/blocages/check/:userId',
    cacheMiddleware.cache(120), // 2 minutes
    validationMiddleware.validate([
        param('userId').isInt()
    ]),
    BlocageController.checkBlockStatus.bind(BlocageController)
);

/**
 * POST /api/v1/messagerie/blocages
 * Bloquer un utilisateur
 * Body: { compte_bloque, type_blocage='MESSAGERIE', conversation_id?, raison? }
 * Auth: Bearer <token>
 * Réponse: 201 { success, data, message }
 */
router.post('/blocages',
    validationMiddleware.validate([
        body('compte_bloque').isInt(),
        body('type_blocage').optional().isIn(['MESSAGERIE', 'CONVERSATION', 'GLOBAL']),
        body('conversation_id').optional().isInt(),
        body('raison').optional().trim()
    ]),
    BlocageController.block.bind(BlocageController)
);

/**
 * DELETE /api/v1/messagerie/blocages/:id
 * Débloquer un utilisateur
 * Params: id
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.delete('/blocages/:id',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    BlocageController.unblock.bind(BlocageController)
);

// ==================== VI. MODÈLES DE MESSAGES ====================

/**
 * GET /api/v1/messagerie/modeles
 * Récupérer les modèles de message de l'utilisateur
 * Query: categorie?, search?, page=1, limit=50
 * Auth: Bearer <token>
 * Cache: 5 minutes
 * Réponse: { success, data: { modeles, categories }, pagination }
 */
router.get('/modeles',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('categorie').optional().trim(),
        query('search').optional().trim(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 200 })
    ]),
    ModeleMessageController.getMyModels.bind(ModeleMessageController)
);

/**
 * POST /api/v1/messagerie/modeles
 * Créer un modèle de message
 * Body: { titre, contenu_message, categorie?, tags?, raccourci? }
 * Auth: Bearer <token>
 * Réponse: 201 { success, data, message }
 */
router.post('/modeles',
    validationMiddleware.validate([
        body('titre').notEmpty().trim(),
        body('contenu_message').notEmpty().trim(),
        body('categorie').optional().trim(),
        body('tags').optional().isArray(),
        body('raccourci').optional().trim().isLength({ min: 1, max: 50 })
    ]),
    ModeleMessageController.create.bind(ModeleMessageController)
);

/**
 * GET /api/v1/messagerie/modeles/:id
 * Récupérer un modèle spécifique
 * Params: id
 * Auth: Bearer <token>
 * Cache: 5 minutes
 * Réponse: { success, data }
 */
router.get('/modeles/:id',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ModeleMessageController.getOne.bind(ModeleMessageController)
);

/**
 * PUT /api/v1/messagerie/modeles/:id
 * Mettre à jour un modèle
 * Params: id
 * Body: { titre?, contenu_message?, categorie?, tags?, raccourci? }
 * Auth: Bearer <token>
 * Réponse: { success, data, message }
 */
router.put('/modeles/:id',
    validationMiddleware.validate([
        param('id').isInt(),
        body('titre').optional().trim(),
        body('contenu_message').optional().trim(),
        body('categorie').optional().trim(),
        body('tags').optional().isArray(),
        body('raccourci').optional().trim().isLength({ max: 50 })
    ]),
    ModeleMessageController.update.bind(ModeleMessageController)
);

/**
 * DELETE /api/v1/messagerie/modeles/:id
 * Supprimer un modèle
 * Params: id
 * Auth: Bearer <token>
 * Réponse: { success, message }
 */
router.delete('/modeles/:id',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ModeleMessageController.delete.bind(ModeleMessageController)
);

/**
 * POST /api/v1/messagerie/modeles/:id/utiliser
 * Utiliser un modèle et incrémenter le compteur
 * Params: id
 * Auth: Bearer <token>
 * Réponse: { success, data: { contenu_message, titre }, message }
 */
router.post('/modeles/:id/utiliser',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ModeleMessageController.use.bind(ModeleMessageController)
);

/**
 * POST /api/v1/messagerie/modeles/:id/dupliquer
 * Dupliquer un modèle existant
 * Params: id
 * Auth: Bearer <token>
 * Réponse: 201 { success, data, message }
 */
router.post('/modeles/:id/dupliquer',
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ModeleMessageController.duplicate.bind(ModeleMessageController)
);

module.exports = router;