// src/routes/v1/avis.routes.js
/**
 * Routes de gestion des avis et évaluations
 * API pour la création, consultation, modération et votes sur les avis
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

const AvisController = require('../../controllers/avis/AvisController');
const VoteAvisController = require('../../controllers/avis/VoteAvisController');

// ==================== CONFIGURATION RATE LIMITING ====================
// Limiteurs spécifiques pour les avis

const avisCreationLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 heures
    max: 5, // 5 avis max par jour
    message: 'Vous avez atteint la limite de création d\'avis pour aujourd\'hui.',
    standardHeaders: true,
    legacyHeaders: false
});

const voteLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 20, // 20 votes max par heure
    message: 'Trop de votes effectués. Réessayez plus tard.',
    standardHeaders: true,
    legacyHeaders: false
});

// ==================== I. CRUD DES AVIS ====================

/**
 * POST /api/v1/avis
 * Créer un nouvel avis
 * Headers: Authorization: Bearer <token>
 * Body: {
 *   entite_type, entite_id, note_globale,
 *   note_qualite?, note_service?, note_rapport_prix?, note_ponctualite?,
 *   titre?, contenu?, photos_avis?, commande_type?, commande_id?
 * }
 * Rate limit: 5 par jour
 * Auth: PRIVATE (utilisateur connecté)
 * Réponse: 201 { status, data, message }
 */
router.post('/',
    authMiddleware.authenticate,
    avisCreationLimiter,
    uploadMiddleware.multiple('photos', 5), // Jusqu'à 5 photos
    validationMiddleware.validate([
        body('entite_type').isIn([
            'PLATEFORME', 'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT',
            'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT', 'BOUTIQUE',
            'PRODUIT_BOUTIQUE', 'MENU', 'COMPTE', 'LIVREUR', 'SERVICE_TRANSPORT'
        ]),
        body('entite_id').isInt({ min: 1 }),
        body('note_globale').isInt({ min: 1, max: 5 }),
        body('note_qualite').optional().isInt({ min: 1, max: 5 }),
        body('note_service').optional().isInt({ min: 1, max: 5 }),
        body('note_rapport_prix').optional().isInt({ min: 1, max: 5 }),
        body('note_ponctualite').optional().isInt({ min: 1, max: 5 }),
        body('titre').optional().trim().isLength({ max: 255 }),
        body('contenu').optional().trim().isLength({ min: 10, max: 2000 }),
        body('commande_type').optional().isIn(['RESTAURANT_FAST_FOOD', 'BOUTIQUE']),
        body('commande_id').optional().isInt(),
        body().custom(body => {
            if (body.commande_type && !body.commande_id) {
                throw new Error('commande_id requis avec commande_type');
            }
            return true;
        })
    ]),
    AvisController.create.bind(AvisController)
);

/**
 * GET /api/v1/avis/entite/:type/:id
 * Récupérer les avis d'une entité
 * Params: type, id
 * Query: page=1, limit=10, note?, avec_photo=false, tri=recent, inclure_reponses=false
 * Auth: PUBLIC
 * Cache: 5 minutes
 * Réponse: { status, data, pagination, statistiques }
 */
router.get('/entite/:type/:id',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        param('type').isIn([
            'PLATEFORME', 'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT',
            'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT', 'BOUTIQUE',
            'PRODUIT_BOUTIQUE', 'MENU', 'COMPTE', 'LIVREUR', 'SERVICE_TRANSPORT'
        ]),
        param('id').isInt({ min: 1 }),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 50 }),
        query('note').optional().isInt({ min: 1, max: 5 }),
        query('avec_photo').optional().isBoolean(),
        query('tri').optional().isIn(['recent', 'ancien', 'note_desc', 'note_asc', 'utile']),
        query('inclure_reponses').optional().isBoolean()
    ]),
    AvisController.findByEntity.bind(AvisController)
);

/**
 * GET /api/v1/avis/:id
 * Récupérer un avis par ID
 * Params: id
 * Auth: PUBLIC
 * Réponse: { status, data: avis_avec_votes_et_reponse }
 */
router.get('/:id',
    validationMiddleware.validate([
        param('id').isInt({ min: 1 })
    ]),
    AvisController.findById.bind(AvisController)
);

/**
 * PUT /api/v1/avis/:id
 * Mettre à jour un avis (auteur seulement)
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { note_globale?, note_qualite?, note_service?, note_rapport_prix?,
 *         note_ponctualite?, titre?, contenu?, photos_avis? }
 * Rate limit: 5 par jour
 * Auth: PRIVATE (auteur de l'avis)
 * Réponse: { status, data, message }
 */
router.put('/:id',
    authMiddleware.authenticate,
    avisCreationLimiter,
    uploadMiddleware.multiple('photos', 5),
    validationMiddleware.validate([
        param('id').isInt({ min: 1 }),
        body('note_globale').optional().isInt({ min: 1, max: 5 }),
        body('note_qualite').optional().isInt({ min: 1, max: 5 }),
        body('note_service').optional().isInt({ min: 1, max: 5 }),
        body('note_rapport_prix').optional().isInt({ min: 1, max: 5 }),
        body('note_ponctualite').optional().isInt({ min: 1, max: 5 }),
        body('titre').optional().trim().isLength({ max: 255 }),
        body('contenu').optional().trim().isLength({ min: 10, max: 2000 })
    ]),
    AvisController.update.bind(AvisController)
);

/**
 * DELETE /api/v1/avis/:id
 * Supprimer un avis (soft delete)
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: PRIVATE (auteur ou ADMIN)
 * Réponse: { status, message }
 */
router.delete('/:id',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt({ min: 1 })
    ]),
    AvisController.delete.bind(AvisController)
);

// ==================== II. VOTES SUR LES AVIS ====================

/**
 * POST /api/v1/avis/:id/voter
 * Voter pour un avis (utile/inutile)
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { est_utile: boolean }
 * Rate limit: 20 par heure
 * Auth: PRIVATE (utilisateur connecté)
 * Réponse: { status, data: { action, vote, compteurs }, message }
 */
router.post('/:id/voter',
    authMiddleware.authenticate,
    voteLimiter,
    validationMiddleware.validate([
        param('id').isInt({ min: 1 }),
        body('est_utile').isBoolean()
    ]),
    VoteAvisController.vote.bind(VoteAvisController)
);

/**
 * GET /api/v1/avis/:id/mon-vote
 * Récupérer le vote de l'utilisateur connecté pour un avis
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: PRIVATE
 * Cache: 5 minutes
 * Réponse: { status, data: { est_utile, date_vote } | null }
 */
router.get('/:id/mon-vote',
    authMiddleware.authenticate,
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        param('id').isInt({ min: 1 })
    ]),
    VoteAvisController.getMonVote.bind(VoteAvisController)
);

/**
 * GET /api/v1/avis/:id/votes
 * Récupérer tous les votes pour un avis
 * Params: id
 * Query: page=1, limit=20, type_vote? (utile/inutile)
 * Auth: PUBLIC
 * Réponse: { status, data, pagination, statistiques }
 */
router.get('/:id/votes',
    validationMiddleware.validate([
        param('id').isInt({ min: 1 }),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 50 }),
        query('type_vote').optional().isIn(['utile', 'inutile'])
    ]),
    VoteAvisController.getVotesForAvis.bind(VoteAvisController)
);

// ==================== III. AVIS DE L'UTILISATEUR CONNECTÉ ====================

/**
 * GET /api/v1/mes-avis
 * Récupérer les avis de l'utilisateur connecté
 * Headers: Authorization: Bearer <token>
 * Query: page=1, limit=10, statut?, entite_type?
 * Auth: PRIVATE
 * Réponse: { status, data, pagination, statistiques }
 */
router.get('/mes-avis',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 50 }),
        query('statut').optional().isIn(['EN_ATTENTE', 'PUBLIE', 'REJETE', 'SIGNALE', 'SUPPRIME']),
        query('entite_type').optional().isIn([
            'BOUTIQUE', 'RESTAURANT_FAST_FOOD', 'PRODUIT_BOUTIQUE',
            'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT', 'SERVICE_TRANSPORT'
        ])
    ]),
    AvisController.getMesAvis.bind(AvisController)
);

/**
 * GET /api/v1/mes-votes
 * Récupérer tous les votes de l'utilisateur connecté
 * Headers: Authorization: Bearer <token>
 * Query: page=1, limit=20, entite_type?, tri=recent
 * Auth: PRIVATE
 * Réponse: { status, data, pagination, statistiques }
 */
router.get('/mes-votes',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 50 }),
        query('entite_type').optional().isString(),
        query('tri').optional().isIn(['recent', 'ancien', 'utile'])
    ]),
    VoteAvisController.getMesVotes.bind(VoteAvisController)
);

// ==================== IV. INTERACTIONS AVEC LES AVIS ====================

/**
 * POST /api/v1/avis/:id/repondre
 * Répondre à un avis (propriétaire de l'entité)
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { reponse }
 * Auth: PRIVATE (propriétaire de l'entité)
 * Réponse: { status, message }
 */
router.post('/:id/repondre',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt({ min: 1 }),
        body('reponse').notEmpty().trim().isLength({ min: 5, max: 1000 })
    ]),
    AvisController.respondToAvis.bind(AvisController)
);

/**
 * POST /api/v1/avis/:id/signaler
 * Signaler un avis
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { motif, description? }
 * Rate limit: 5 par jour
 * Auth: PRIVATE (utilisateur connecté)
 * Réponse: { status, message }
 */
router.post('/:id/signaler',
    authMiddleware.authenticate,
    rateLimit({
        windowMs: 24 * 60 * 60 * 1000, // 24 heures
        max: 5,
        message: 'Trop de signalements effectués aujourd\'hui.'
    }),
    validationMiddleware.validate([
        param('id').isInt({ min: 1 }),
        body('motif').notEmpty().trim().isLength({ min: 3, max: 255 }),
        body('description').optional().trim().isLength({ max: 1000 })
    ]),
    AvisController.signaler.bind(AvisController)
);

// ==================== V. STATISTIQUES ET TOP AVIS ====================

/**
 * GET /api/v1/avis/top-votes
 * Récupérer les avis les plus votés
 * Query: periode=30j, limit=10, entite_type?, min_votes=5
 * Auth: PUBLIC
 * Cache: 1 heure
 * Réponse: { status, data, meta }
 */
router.get('/top-votes',
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('periode').optional().isIn(['7j', '30j', '90j']),
        query('limit').optional().isInt({ min: 1, max: 50 }),
        query('entite_type').optional().isString(),
        query('min_votes').optional().isInt({ min: 1 })
    ]),
    VoteAvisController.getTopVotedAvis.bind(VoteAvisController)
);

/**
 * GET /api/v1/avis/stats/votes
 * Obtenir les statistiques globales des votes
 * Query: periode=30j
 * Headers: Authorization: Bearer <token>
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { status, data: { evolution, global, par_entite, top_votants, aujourdhui } }
 */
router.get('/stats/votes',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('periode').optional().isIn(['7j', '30j'])
    ]),
    VoteAvisController.getVotesStats.bind(VoteAvisController)
);

// ==================== VI. MODÉRATION DES AVIS ====================

/**
 * GET /api/v1/avis/moderations
 * Récupérer tous les avis à modérer
 * Headers: Authorization: Bearer <token>
 * Query: page=1, limit=20, statut=EN_ATTENTE
 * Auth: ADMIN ou MODERATEUR
 * Réponse: { status, data, pagination }
 */
/*
router.get('/moderations',
    authMiddleware.authenticate,
    roleMiddleware.isModerator(),
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 50 }),
        query('statut').optional().isIn(['EN_ATTENTE', 'PUBLIE', 'REJETE', 'SIGNALE'])
    ]),
    AvisController.getModerateQueue.bind(AvisController)
);*/

/**
 * POST /api/v1/avis/moderations/:id
 * Modérer un avis
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { action, commentaire? } (action: 'PUBLIE', 'REJETE', 'MASQUE')
 * Auth: ADMIN ou MODERATEUR
 * Réponse: { status, message }
 */
/*
router.post('/moderations/:id',
    authMiddleware.authenticate,
    roleMiddleware.isModerator(),
    validationMiddleware.validate([
        param('id').isInt({ min: 1 }),
        body('action').isIn(['PUBLIE', 'REJETE', 'MASQUE']),
        body('commentaire').optional().trim().isLength({ max: 500 })
    ]),
    AvisController.moderer.bind(AvisController)
);*/

// ==================== VII. EXPORT ET ANALYSE ====================

/**
 * GET /api/v1/avis/votes/export
 * Exporter les votes (pour admin)
 * Headers: Authorization: Bearer <token>
 * Query: format=csv, date_debut?, date_fin?
 * Auth: ADMIN
 * Réponse: Fichier CSV exporté
 */
router.get('/votes/export',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        query('format').optional().isIn(['csv']),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601()
    ]),
    VoteAvisController.exportVotes.bind(VoteAvisController)
);

/**
 * GET /api/v1/avis/export
 * Exporter les avis (pour admin)
 * Headers: Authorization: Bearer <token>
 * Query: format=csv, entite_type?, date_debut?, date_fin?
 * Auth: ADMIN
 * Réponse: Fichier CSV exporté
 */
/*
router.get('/export',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        query('format').optional().isIn(['csv']),
        query('entite_type').optional().isString(),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601()
    ]),
    AvisController.exportAvis.bind(AvisController)
);*/

// ==================== VIII. ANALYSE DE SENTIMENT (OPTIONNEL) ====================

/**
 * POST /api/v1/avis/analyser
 * Analyser le sentiment d'un texte (pour aide à la rédaction)
 * Headers: Authorization: Bearer <token>
 * Body: { texte }
 * Rate limit: 10 par heure
 * Auth: PRIVATE
 * Réponse: { status, data: { sentiment, score, suggestions } }
 */
/*
router.post('/analyser',
    authMiddleware.authenticate,
    rateLimit({
        windowMs: 60 * 60 * 1000, // 1 heure
        max: 10,
        message: 'Trop de demandes d\'analyse.'
    }),
    validationMiddleware.validate([
        body('texte').notEmpty().trim().isLength({ min: 10, max: 2000 })
    ]),
    AvisController.analyzeSentiment.bind(AvisController)
);
*/
module.exports = router;