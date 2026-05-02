// src/routes/v1/blog.routes.js
/**
 * Routes de gestion du blog
 * API pour la gestion complète des articles, commentaires, likes, partages, signalements et abonnements
 * Accès public pour la consultation, authentification requise pour les interactions
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

const ArticleController = require('../../controllers/blog/ArticleController');
const CommentaireController = require('../../controllers/blog/CommentaireController');
const LikeController = require('../../controllers/blog/LikeController');
const PartageController = require('../../controllers/blog/PartageController');
const AbonnementBlogController = require('../../controllers/blog/AbonnementBlogController');
const SignalementController = require('../../controllers/blog/SignalementController');
const StatsBlogController = require('../../controllers/blog/StatsBlogController');
const SondageController = require('../../controllers/blog/SondageController');
const QuizController = require('../../controllers/blog/QuizzController');
const FavoriController = require('../../controllers/blog/FavoriController');
const RecommendationController = require('../../controllers/blog/RecommendationController');
const BadgeController = require('../../controllers/blog/BadgeController');
// ==================== CONFIGURATION RATE LIMITING ====================

const commentLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 10, // 10 commentaires max par heure
    message: 'Trop de commentaires. Réessayez plus tard.',
    standardHeaders: true,
    legacyHeaders: false
});

const likeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 50, // 50 likes/dislikes max par heure
    message: 'Trop de likes. Réessayez plus tard.',
    standardHeaders: true,
    legacyHeaders: false
});

const shareLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 20, // 20 partages max par heure
    message: 'Trop de partages. Réessayez plus tard.',
    standardHeaders: true,
    legacyHeaders: false
});

// ==================== I. ARTICLES ====================

/**
 * POST /api/v1/blog/articles
 * Créer un nouvel article
 * Headers: Authorization: Bearer <token>
 * Body: {
 *   titre_article, contenu_article, categorie_principale,
 *   sous_titre?, extrait_contenu?, langue='fr',
 *   image_principale?, image_secondaire?, video_url?,
 *   gallery_images?, documents_joints?, meta_titre?, meta_description?,
 *   mots_cles?, categories_secondaires?, visibilite='PUBLIC',
 *   est_epingle=false, est_commentaire_actif=true, date_programmation?,
 *   co_auteurs?, plateforme_id?, compagnie_id?, emplacement_transport_id?,
 *   restaurant_id?, emplacement_restaurant_id?, boutique_id?,
 *   produit_boutique_id?, menu_id?, promo_id?, est_disponible_hors_ligne=false,
 *   droit_lecture_minimum_role?, mot_de_passe_protege?, redirection_url?
 * }
 * Files: image_principale?, image_secondaire? (multipart/form-data)
 * Auth: BLOGUEUR, ADMIN
 * Réponse: 201 { success, data, message }
 */
router.post('/articles',
    authMiddleware.authenticate,
    roleMiddleware.isBlogger(),
    uploadMiddleware.fields([
        { name: 'image_principale', maxCount: 1 },
        { name: 'image_secondaire', maxCount: 1 },
        { name: 'gallery_images', maxCount: 10 },
    ]),
    validationMiddleware.validate([
        body('titre_article').notEmpty().trim().isLength({ min: 5, max: 255 }),
        body('contenu_article').notEmpty().isLength({ min: 50 }),
        body('categorie_principale').notEmpty(),
        body('sous_titre').optional().trim().isLength({ max: 500 }),
        body('extrait_contenu').optional().trim().isLength({ max: 500 }),
        body('langue').optional().isIn(['fr', 'en']),
        body('video_url').optional().isURL(),
        body('gallery_images').optional().isArray(),
        body('documents_joints').optional().isArray(),
        body('meta_titre').optional().trim().isLength({ max: 70 }),
        body('meta_description').optional().trim().isLength({ max: 160 }),
        body('mots_cles').optional().isArray(),
        body('visibilite').optional().isIn(['PUBLIC', 'PRIVE', 'ABONNES', 'EQUIPE']),
        body('est_epingle').optional().isBoolean(),
        body('est_commentaire_actif').optional().isBoolean(),
        body('date_programmation').optional().isISO8601(),
        body('co_auteurs').optional().isArray(),
        body('co_auteurs.*').optional().isInt(),
        body('plateforme_id').optional().isInt(),
        body('compagnie_id').optional().isInt(),
        body('emplacement_transport_id').optional().isInt(),
        body('restaurant_id').optional().isInt(),
        body('emplacement_restaurant_id').optional().isInt(),
        body('boutique_id').optional().isInt(),
        body('produit_boutique_id').optional().isInt(),
        body('menu_id').optional().isInt(),
        body('promo_id').optional().isInt(),
        body('est_disponible_hors_ligne').optional().isBoolean(),
        body('droit_lecture_minimum_role').optional().isString(),
        body('mot_de_passe_protege').optional().trim(),
        body('redirection_url').optional().isURL()
    ]),
    ArticleController.create.bind(ArticleController)
);

/**
 * GET /api/v1/blog/articles
 * Récupérer tous les articles avec filtres
 * Query: page=1, limit=20, categorie?, statut?, auteur_id?, recherche?,
 *        date_debut?, date_fin?, tags?, visibilite?, est_epingle?,
 *        tri=date_publication_desc, include_brouillons=false
 * Auth: PUBLIC (avec filtres selon droits)
 * Cache: 5 minutes
 * Réponse: { success, data, pagination }
 */
router.get('/articles',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 50 }),
        query('categorie').optional().trim(),
        query('statut').optional().isIn(['BROUILLON', 'PROGRAMME', 'PUBLIE', 'SIGNALE', 'MASQUE', 'SUPPRIME']),
        query('auteur_id').optional().isInt(),
        query('recherche').optional().trim().isLength({ min: 2 }),
        query('date_debut').optional().isISO8601(),
        query('date_fin').optional().isISO8601(),
        query('tags').optional().trim(),
        query('visibilite').optional().isIn(['PUBLIC', 'PRIVE', 'ABONNES', 'EQUIPE']),
        query('est_epingle').optional().isBoolean(),
        query('tri').optional().isIn([
            'date_publication_desc', 'date_publication_asc',
            'date_creation_desc', 'date_creation_asc',
            'titre_asc', 'titre_desc',
            'popularite_desc', 'notes_desc'
        ]),
        query('include_brouillons').optional().isBoolean()
    ]),
    ArticleController.findAll.bind(ArticleController)
);


/**
 * GET /api/v1/blog/articles/:identifier
 * Récupérer un article par ID ou slug
 * Params: identifier (ID ou slug)
 * Query: increment_view=true
 * Auth: PUBLIC (avec vérification des droits)
 * Cache: 10 minutes
 * Réponse: { success, data: article_avec_stats_commentaires_similaires }
 */
router.get('/articles/:identifier',
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        param('identifier').notEmpty(),
        query('increment_view').optional().isBoolean()
    ]),
    ArticleController.findOne.bind(ArticleController)
);

/**
 * PUT /api/v1/blog/articles/:id
 * Mettre à jour un article
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: (mêmes champs que création, tous optionnels)
 * Files: image_principale?, image_secondaire? (multipart/form-data)
 * Auth: Auteur, ADMIN
 * Réponse: { success, data, message }
 */
router.put('/articles/:id',
    authMiddleware.authenticate,
    uploadMiddleware.fields([
        { name: 'image_principale', maxCount: 1 },
        { name: 'image_secondaire', maxCount: 1 },
        { name: 'gallery_images', maxCount: 10 }
    ]),
    validationMiddleware.validate([
        param('id').isInt(),
        body('titre_article').optional().trim().isLength({ min: 5, max: 255 }),
        body('contenu_article').optional().isLength({ min: 50 }),
        body('categorie_principale').optional().notEmpty()
        // ... autres validations optionnelles
    ]),
    ArticleController.update.bind(ArticleController)
);

/**
 * POST /api/v1/blog/articles/:id/publish
 * Publier un article
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { date_publication? }
 * Auth: Auteur, ADMIN
 * Réponse: { success, data, message }
 */
router.post('/articles/:id/publish',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt(),
        body('date_publication').optional().isISO8601()
    ]),
    ArticleController.publish.bind(ArticleController)
);

/**
 * PATCH /api/v1/blog/articles/:id/archive
 * Archiver/Restaurer un article
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { archived: boolean }
 * Auth: ADMIN
 * Réponse: { success, data, message }
 */
router.patch('/articles/:id/archive',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('archived').isBoolean()
    ]),
    ArticleController.toggleArchive.bind(ArticleController)
);

/**
 * PATCH /api/v1/blog/articles/:id/pin
 * Épingler/Désépingler un article
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { pinned: boolean }
 * Auth: ADMIN
 * Réponse: { success, data, message }
 */
router.patch('/articles/:id/pin',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('pinned').isBoolean()
    ]),
    ArticleController.togglePin.bind(ArticleController)
);

/**
 * POST /api/v1/blog/articles/:id/validate
 * Valider un article (pour modération)
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { statut: 'PUBLIE'|'REJETE', commentaire? }
 * Auth: MODERATEUR, ADMIN
 * Réponse: { success, data, message }
 */
router.post('/articles/:id/validate',
    authMiddleware.authenticate,
    roleMiddleware.isModerator(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('statut').isIn(['PUBLIE', 'REJETE']),
        body('commentaire').optional().trim()
    ]),
    ArticleController.validate.bind(ArticleController)
);

/**
 * DELETE /api/v1/blog/articles/:id
 * Supprimer un article (soft delete)
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: ADMIN
 * Réponse: { success, message }
 */
router.delete('/articles/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    ArticleController.delete.bind(ArticleController)
);

















// ==================== II. COMMENTAIRES ====================

/**
 * POST /api/v1/blog/articles/:articleId/commentaires
 * Ajouter un commentaire à un article
 * Headers: Authorization: Bearer <token>
 * Params: articleId
 * Body: { contenu_commentaire, commentaire_parent_id?, est_anonyme=false, pseudo_anonyme?, note? }
 * Rate limit: 10 par heure
 * Auth: PRIVATE
 * Réponse: 201 { success, data, message }
 */
router.post('/articles/:articleId/commentaires',
    authMiddleware.authenticate,
    commentLimiter,
    validationMiddleware.validate([
        param('articleId').isInt(),
        body('contenu_commentaire').notEmpty().trim().isLength({ min: 2, max: 2000 }),
        body('commentaire_parent_id').optional().isInt(),
        body('est_anonyme').optional().isBoolean(),
        body('pseudo_anonyme').optional().trim().isLength({ max: 100 }),
        body('note').optional().isInt({ min: 1, max: 5 })
    ]),
    CommentaireController.create.bind(CommentaireController)
);

/**
 * GET /api/v1/blog/articles/:articleId/commentaires
 * Récupérer les commentaires d'un article
 * Params: articleId
 * Query: page=1, limit=50, tri=recent
 * Auth: PUBLIC
 * Réponse: { success, data, pagination }
 */
router.get('/articles/:articleId/commentaires',
    validationMiddleware.validate([
        param('articleId').isInt(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('tri').optional().isIn(['recent', 'populaire', 'note'])
    ]),
    CommentaireController.findByArticle.bind(CommentaireController)
);

/**
 * PUT /api/v1/blog/commentaires/:id
 * Mettre à jour un commentaire
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { contenu_commentaire }
 * Auth: Auteur, ADMIN
 * Réponse: { success, data, message }
 */
router.put('/commentaires/:id',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt(),
        body('contenu_commentaire').notEmpty().trim().isLength({ min: 2, max: 2000 })
    ]),
    CommentaireController.update.bind(CommentaireController)
);

/**
 * DELETE /api/v1/blog/commentaires/:id
 * Supprimer un commentaire
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: Auteur, ADMIN
 * Réponse: { success, message }
 */
router.delete('/commentaires/:id',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    CommentaireController.delete.bind(CommentaireController)
);

/**
 * PATCH /api/v1/blog/commentaires/:id/moderer
 * Modérer un commentaire
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { statut: 'APPROUVE'|'REJETE'|'MASQUE', motif? }
 * Auth: MODERATEUR, ADMIN
 * Réponse: { success, data, message }
 */
router.patch('/commentaires/:id/moderer',
    authMiddleware.authenticate,
    roleMiddleware.isModerator(),
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('statut').isIn(['APPROUVE', 'REJETE', 'MASQUE']),
        body('motif').optional().trim()
    ]),
    CommentaireController.moderer.bind(CommentaireController)
);




// Commentaires utilisateur
router.get('/commentaires/user',
    authMiddleware.authenticate,
    CommentaireController.getUserComments.bind(CommentaireController)
);

// Commentaires les plus likés
router.get('/articles/:articleId/commentaires/top',
    CommentaireController.getTopComments.bind(CommentaireController)
);

// Nouveaux commentaires depuis une date
router.get('/articles/:articleId/commentaires/nouveaux',
    CommentaireController.getNewCommentsCount.bind(CommentaireController)
);

// Épingler un commentaire
router.patch('/commentaires/:id/epingler',
    authMiddleware.authenticate,
    CommentaireController.togglePinComment.bind(CommentaireController)
);














// ==================== III. LIKES ====================

/**
 * POST /api/v1/blog/articles/:articleId/like
 * Liker/Disliker un article
 * Headers: Authorization: Bearer <token>
 * Params: articleId
 * Body: { type_like: 'LIKE'|'DISLIKE' }
 * Rate limit: 50 par heure
 * Auth: PRIVATE
 * Réponse: { success, data: { action, type_like, counts }, message }
 */
router.post('/articles/:articleId/like',
    authMiddleware.authenticate,
    likeLimiter,
    validationMiddleware.validate([
        param('articleId').isInt(),
        body('type_like').isIn(['LIKE', 'DISLIKE'])
    ]),
    LikeController.toggleArticleLike.bind(LikeController)
);

/**
 * GET /api/v1/blog/articles/:articleId/likes
 * Récupérer les utilisateurs qui ont liké un article
 * Params: articleId
 * Query: type=LIKE, page=1, limit=50
 * Auth: PUBLIC
 * Réponse: { success, data, pagination }
 */
router.get('/articles/:articleId/likes',
    validationMiddleware.validate([
        param('articleId').isInt(),
        query('type').optional().isIn(['LIKE', 'DISLIKE']),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 })
    ]),
    LikeController.getArticleLikes.bind(LikeController)
);

/**
 * POST /api/v1/blog/commentaires/:commentaireId/like
 * Liker/Disliker un commentaire
 * Headers: Authorization: Bearer <token>
 * Params: commentaireId
 * Body: { type_like: 'LIKE'|'DISLIKE' }
 * Rate limit: 50 par heure
 * Auth: PRIVATE
 * Réponse: { success, data: { action, type_like, counts } }
 */
router.post('/commentaires/:commentaireId/like',
    authMiddleware.authenticate,
    likeLimiter,
    validationMiddleware.validate([
        param('commentaireId').isInt(),
        body('type_like').isIn(['LIKE', 'DISLIKE'])
    ]),
    LikeController.toggleCommentaireLike.bind(LikeController)
);


// ✅ Statut de like
router.get('/articles/:articleId/like-status',
    authMiddleware.authenticate,
    LikeController.getArticleLikeStatus.bind(LikeController)
);

router.get('/commentaires/:commentaireId/like-status',
    authMiddleware.authenticate,
    LikeController.getCommentaireLikeStatus.bind(LikeController)
);

// ✅ Batch status
router.post('/likes/batch-status',
    authMiddleware.authenticate,
    LikeController.getBatchArticleLikeStatus.bind(LikeController)
);

router.post('/likes/batch-comment-status',
    authMiddleware.authenticate,
    LikeController.getBatchCommentaireLikeStatus.bind(LikeController)
);

// ✅ Stats de likes
router.get('/articles/:articleId/likes/stats',
    LikeController.getArticleLikeStats.bind(LikeController)
);

// ✅ Likes utilisateur
router.get('/likes/user',
    authMiddleware.authenticate,
    LikeController.getUserLikes.bind(LikeController)
);












// ==================== IV. PARTAGES ====================

/**
 * POST /api/v1/blog/articles/:articleId/partager
 * Enregistrer un partage d'article
 * Headers: Authorization: Bearer <token> (optionnel)
 * Params: articleId
 * Body: { type_partage: 'FACEBOOK'|'TWITTER'|'LINKEDIN'|'WHATSAPP'|'EMAIL'|'COPY_LINK' }
 * Rate limit: 20 par heure
 * Auth: PUBLIC (mais enregistre l'utilisateur si connecté)
 * Réponse: 201 { success, message }
 */
router.post('/articles/:articleId/partager',
    authMiddleware.optionalAuthenticate,
    shareLimiter,
    validationMiddleware.validate([
        param('articleId').isInt(),
        body('type_partage').isIn(['FACEBOOK', 'TWITTER', 'LINKEDIN', 'WHATSAPP', 'EMAIL', 'COPY_LINK', 'NATIVE_SHARE'])
    ]),
    PartageController.share.bind(PartageController)
);

/**
 * GET /api/v1/blog/articles/:articleId/partages/stats
 * Récupérer les statistiques de partage d'un article
 * Params: articleId
 * Auth: PUBLIC
 * Réponse: { success, data: { total, details } }
 */
router.get('/articles/:articleId/partages/stats',
    validationMiddleware.validate([
        param('articleId').isInt()
    ]),
    PartageController.getShareStats.bind(PartageController)
);


// Enregistrer un partage
router.post('/articles/:articleId/partager',
    authMiddleware.optionalAuthenticate,
    validationMiddleware.validate([
        param('articleId').isInt(),
        body('type_partage').isIn([
            'FACEBOOK', 'TWITTER', 'LINKEDIN', 'WHATSAPP', 'TELEGRAM',
            'EMAIL', 'COPY_LINK', 'INSTAGRAM', 'TIKTOK', 'NATIVE_SHARE',
            'SMS', 'MESSENGER', 'SNAPCHAT', 'REDDIT', 'PINTEREST'
        ]),
        body('message_personnel').optional().isString().isLength({ max: 500 })
    ]),
    PartageController.share.bind(PartageController)
);

// Statistiques d'un article
router.get('/articles/:articleId/partages/stats',
    validationMiddleware.validate([
        param('articleId').isInt(),
        query('periode').optional().isIn(['24h', '7d', '30d'])
    ]),
    PartageController.getShareStats.bind(PartageController)
);

// Statistiques globales
router.get('/partages/stats/globales',
    validationMiddleware.validate([
        query('periode').optional().isIn(['24h', '7d', '30d'])
    ]),
    PartageController.getGlobalStats.bind(PartageController)
);

// Historique utilisateur
router.get('/partages/historique',
    authMiddleware.authenticate,
    PartageController.getMyShareHistory.bind(PartageController)
);

// Batch check
router.post('/partages/check-batch',
    validationMiddleware.validate([
        body('article_ids').isArray({ min: 1, max: 100 })
    ]),
    PartageController.checkBatchPartages.bind(PartageController)
);

// Top articles partagés
router.get('/partages/top',
    validationMiddleware.validate([
        query('periode').optional().isIn(['24h', '7d', '30d']),
        query('limit').optional().isInt({ min: 1, max: 50 }),
        query('categorie').optional().isString()
    ]),
    PartageController.getTopSharedArticles.bind(PartageController)
);













// ==================== V. ABONNEMENTS ====================



/**
 * GET /api/v1/blog/abonnements/mes-abonnements
 * Récupérer les abonnements de l'utilisateur
 * Headers: Authorization: Bearer <token>
 * Query: type?, actif=true
 * Auth: PRIVATE
 * Réponse: { success, data }
 */
router.get('/abonnements/mes-abonnements',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        query('type').optional().isIn(['CATEGORIE', 'AUTEUR', 'TAG']),
        query('actif').optional().isBoolean()
    ]),
    AbonnementBlogController.mesAbonnements.bind(AbonnementBlogController)
);

/**
 * GET /api/v1/blog/abonnements/abonnes
 * Récupérer les abonnés d'un auteur/catégorie
 * Query: type, reference_id, page=1, limit=50
 * Auth: PUBLIC
 * Réponse: { success, data, pagination }
 */
router.get('/abonnements/abonnes',
    validationMiddleware.validate([
        query('type').isIn(['CATEGORIE', 'AUTEUR', 'TAG']),
        query('reference_id').notEmpty(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 })
    ]),
    AbonnementBlogController.getAbonnes.bind(AbonnementBlogController)
);

/**
 * DELETE /api/v1/blog/abonnements/:id
 * Se désabonner
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: PRIVATE
 * Réponse: { success, message }
 */
router.delete('/abonnements/:id',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    AbonnementBlogController.unsubscribe.bind(AbonnementBlogController)
);


// Suppression définitive
router.delete('/abonnements/:id/permanent',
    authMiddleware.authenticate,
    AbonnementBlogController.deletePermanent.bind(AbonnementBlogController)
);

// Statistiques
router.get('/abonnements/stats',
    authMiddleware.authenticate,
    AbonnementBlogController.getAbonnementStats.bind(AbonnementBlogController)
);

// Vérification statut
router.get('/abonnements/check',
    authMiddleware.authenticate,
    AbonnementBlogController.checkSubscription.bind(AbonnementBlogController)
);















// ==================== VI. SIGNALEMENTS ====================

/**
 * POST /api/v1/blog/articles/:articleId/signaler
 * Signaler un article
 * Headers: Authorization: Bearer <token>
 * Params: articleId
 * Body: { motif, description? }
 * Auth: PRIVATE
 * Réponse: 201 { success, data, message }
 */
router.post('/articles/:articleId/signaler',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('articleId').isInt(),
        body('motif').notEmpty().trim().isLength({ max: 255 }),
        body('description').optional().trim().isLength({ max: 1000 })
    ]),
    SignalementController.signalerArticle.bind(SignalementController)
);

/**
 * GET /api/v1/blog/signalements/en-attente
 * Récupérer les signalements en attente
 * Headers: Authorization: Bearer <token>
 * Query: type=tous, page=1, limit=50
 * Auth: MODERATEUR, ADMIN
 * Réponse: { success, data, pagination }
 */
router.get('/signalements/en-attente',
    authMiddleware.authenticate,
    roleMiddleware.isModerator(),
    validationMiddleware.validate([
        query('type').optional().isIn(['tous', 'articles', 'commentaires']),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 })
    ]),
    SignalementController.getSignalementsEnAttente.bind(SignalementController)
);

/**
 * PATCH /api/v1/blog/signalements/articles/:id/traiter
 * Traiter un signalement d'article
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { statut, action_entreprise? }
 * Auth: MODERATEUR, ADMIN
 * Réponse: { success, message }
 */
router.patch('/signalements/articles/:id/traiter',
    authMiddleware.authenticate,
    roleMiddleware.isModerator(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('statut').isIn(['TRAITE', 'REJETE']),
        body('action_entreprise').optional().trim()
    ]),
    SignalementController.traiterSignalementArticle.bind(SignalementController)
);

// Signalement commentaire
router.post('/commentaires/:commentaireId/signaler',
    authMiddleware.authenticate,
    SignalementController.signalerCommentaire.bind(SignalementController)
);

// Traitement signalement commentaire
router.patch('/signalements/commentaires/:id/traiter',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    SignalementController.traiterSignalementCommentaire.bind(SignalementController)
);

// Historique utilisateur
router.get('/signalements/user',
    authMiddleware.authenticate,
    SignalementController.getUserSignalements.bind(SignalementController)
);
// Traitement par lot
router.post('/signalements/traiter-batch',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        body('signalement_ids').isArray({ min: 1, max: 50 }),
        body('action_entreprise').optional().isString(),
        body('statut').optional().isIn(['TRAITE', 'REJETE'])
    ]),
    SignalementController.traiterBatch.bind(SignalementController)
);

// Statistiques
router.get('/signalements/stats',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        query('periode').optional().isIn(['24h', '7d', '30d'])
    ]),
    SignalementController.getSignalementStats.bind(SignalementController)
);















// ==================== VII. STATISTIQUES DU BLOG ====================

/**
 * GET /api/v1/blog/stats/globales
 * Récupérer les statistiques globales du blog
 * Query: periode=30d
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { success, data }
 */
router.get('/stats/globales',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('periode').optional().isIn(['24h', '7d', '30d', '1y'])
    ]),
    StatsBlogController.getGlobalStats.bind(StatsBlogController)
);

/**
 * GET /api/v1/blog/stats/categories
 * Récupérer les statistiques par catégorie
 * Query: periode=30d
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { success, data }
 */
router.get('/stats/categories',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('periode').optional().isIn(['7d', '30d'])
    ]),
    StatsBlogController.getCategoryStats.bind(StatsBlogController)
);

/**
 * GET /api/v1/blog/stats/lecture
 * Récupérer les statistiques de lecture
 * Query: periode=30d, article_id?
 * Auth: ADMIN
 * Cache: 1 heure
 * Réponse: { success, data }
 */
router.get('/stats/lecture',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('periode').optional().isIn(['7d', '30d']),
        query('article_id').optional().isInt()
    ]),
    StatsBlogController.getReadingStats.bind(StatsBlogController)
);


// Dashboard auteur
router.get('/stats/dashboard',
    authMiddleware.authenticate,
    StatsBlogController.getDashboardAuteur.bind(StatsBlogController)
);

// Stats engagement
router.get('/stats/engagement',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    StatsBlogController.getEngagementStats.bind(StatsBlogController)
);

// Stats quiz
router.get('/stats/quiz',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    StatsBlogController.getQuizStats.bind(StatsBlogController)
);

// Stats badges
router.get('/stats/badges',
    StatsBlogController.getBadgeStats.bind(StatsBlogController)
);













// ==================== VIII. SONDAGES ET QUIZZ ====================


// Créer un sondage
router.post('/articles/:articleId/sondages',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('articleId').isInt(),
        body('question').notEmpty().isLength({ min: 10, max: 500 }),
        body('type_sondage').isIn(['UNIQUE', 'MULTIPLE', 'CLASSEMENT', 'NOTE']),
        body('options').isArray({ min: 2, max: 10 })
    ]),
    SondageController.create.bind(SondageController)
);

// Mettre à jour un sondage
router.put('/sondages/:id',
    authMiddleware.authenticate,
    validationMiddleware.validate([param('id').isInt()]),
    SondageController.update.bind(SondageController)
);

// Supprimer un sondage
router.delete('/sondages/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    SondageController.delete.bind(SondageController)
);

// Voter
router.post('/sondages/:id/voter',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt(),
        body('option_ids').notEmpty()
    ]),
    SondageController.voter.bind(SondageController)
);

// Annuler son vote
router.delete('/sondages/:id/voter',
    authMiddleware.authenticate,
    SondageController.annulerVote.bind(SondageController)
);

// Récupérer les sondages d'un article
router.get('/articles/:articleId/sondages',
    authMiddleware.optionalAuthenticate,
    SondageController.getByArticle.bind(SondageController)
);

// Résultats détaillés
router.get('/sondages/:id/resultats',
    authMiddleware.optionalAuthenticate,
    SondageController.getResultats.bind(SondageController)
);

// Sondages tendances
router.get('/sondages/tendances',
    SondageController.getTendances.bind(SondageController)
);

// Historique des votes utilisateur
router.get('/sondages/mes-votes',
    authMiddleware.authenticate,
    SondageController.getMesVotes.bind(SondageController)
);

// Créer un quiz
router.post('/articles/:articleId/quiz',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('articleId').isInt(),
        body('question').notEmpty().isLength({ min: 10, max: 500 }),
        body('type_quiz').isIn(['QCM', 'VRAI_FAUX', 'REPONSE_COURTE']),
        body('options').isArray({ min: 2 }).optional()
    ]),
    QuizController.create.bind(QuizController)
);

// Mettre à jour un quiz
router.put('/quiz/:id',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    QuizController.update.bind(QuizController)
);

// Supprimer un quiz
router.delete('/quiz/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    QuizController.delete.bind(QuizController)
);

// Répondre à un quiz
router.post('/quiz/:id/repondre',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt(),
        body('option_id').optional().isInt(),
        body('reponse_texte').optional().isString(),
        body('temps_reponse_secondes').optional().isInt({ min: 0 })
    ]),
    QuizController.repondre.bind(QuizController)
);

// Récupérer les quiz d'un article
router.get('/articles/:articleId/quiz',
    authMiddleware.optionalAuthenticate,
    QuizController.getByArticle.bind(QuizController)
);

// Scores d'un article
router.get('/articles/:articleId/quiz/scores',
    authMiddleware.optionalAuthenticate,
    QuizController.getScoresByArticle.bind(QuizController)
);

// Mes scores
router.get('/quiz/mes-scores',
    authMiddleware.authenticate,
    QuizController.getMyScores.bind(QuizController)
);

// Statistiques d'un quiz
router.get('/quiz/:id/stats',
    QuizController.getQuizStats.bind(QuizController)
);

// Vérifier les badges
router.post('/quiz/verifier-badges',
    authMiddleware.authenticate,
    QuizController.verifierBadges.bind(QuizController)
);















// ==================== FAVORIS ====================

// Ajouter/Retirer des favoris
router.post('/articles/:articleId/favori',
    authMiddleware.authenticate,
    validationMiddleware.validate([param('articleId').isInt()]),
    FavoriController.toggleFavori.bind(FavoriController)
);

// Récupérer mes favoris
router.get('/favoris',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 50 }),
        query('tri').optional().isIn(['date_ajout', 'date_publication', 'titre', 'lecture']),
        query('collection_id').optional().isInt(),
        query('categorie').optional().isString()
    ]),
    FavoriController.getMesFavoris.bind(FavoriController)
);

// Vérifier si un article est en favoris
router.get('/articles/:articleId/favori/check',
    authMiddleware.optionalAuthenticate,
    FavoriController.checkFavori.bind(FavoriController)
);

// Vérifier le statut favori pour plusieurs articles
router.post('/favoris/check-batch',
    authMiddleware.optionalAuthenticate,
    validationMiddleware.validate([
        body('article_ids').isArray({ min: 1, max: 100 })
    ]),
    FavoriController.checkBatchFavoris.bind(FavoriController)
);

// Statistiques des favoris
router.get('/favoris/stats',
    authMiddleware.authenticate,
    FavoriController.getFavorisStats.bind(FavoriController)
);





















// ==================== SIGNETS ====================

// Sauvegarder un signet
router.post('/articles/:articleId/signets',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('articleId').isInt(),
        body('pourcentage').optional().isFloat({ min: 0, max: 100 }),
        body('titre_signet').optional().isString().isLength({ max: 255 }),
        body('note_signet').optional().isString().isLength({ max: 500 })
    ]),
    FavoriController.saveSignet.bind(FavoriController)
);

// Récupérer le signet d'un article
router.get('/articles/:articleId/signets',
    authMiddleware.authenticate,
    FavoriController.getSignet.bind(FavoriController)
);

// Récupérer tous les signets
router.get('/signets',
    authMiddleware.authenticate,
    FavoriController.getAllSignets.bind(FavoriController)
);

// Supprimer un signet
router.delete('/articles/:articleId/signets',
    authMiddleware.authenticate,
    FavoriController.deleteSignet.bind(FavoriController)
);

// ==================== NOTES DE LECTURE ====================

// Ajouter une note
router.post('/articles/:articleId/notes',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('articleId').isInt(),
        body('contenu_note').notEmpty().isLength({ min: 1, max: 5000 }),
        body('est_privee').optional().isBoolean(),
        body('couleur_surlignage').optional().isString().isLength({ max: 7 })
    ]),
    FavoriController.addNote.bind(FavoriController)
);

// Récupérer les notes d'un article
router.get('/articles/:articleId/notes',
    authMiddleware.optionalAuthenticate,
    FavoriController.getNotes.bind(FavoriController)
);

// Mettre à jour une note
router.put('/notes/:id',
    authMiddleware.authenticate,
    FavoriController.updateNote.bind(FavoriController)
);

// Supprimer une note
router.delete('/notes/:id',
    authMiddleware.authenticate,
    FavoriController.deleteNote.bind(FavoriController)
);

// Récupérer toutes mes notes
router.get('/notes',
    authMiddleware.authenticate,
    FavoriController.getAllNotes.bind(FavoriController)
);
















// ==================== PROGRESSION ====================

// Sauvegarder la progression
router.post('/articles/:articleId/progression',
    authMiddleware.optionalAuthenticate,
    validationMiddleware.validate([
        param('articleId').isInt(),
        body('pourcentage').optional().isFloat({ min: 0, max: 100 }),
        body('temps_passe_secondes').optional().isInt({ min: 0 }),
        body('scroll_position').optional().isInt({ min: 0 })
    ]),
    FavoriController.saveProgression.bind(FavoriController)
);

// Récupérer la progression
router.get('/articles/:articleId/progression',
    authMiddleware.optionalAuthenticate,
    FavoriController.getProgression.bind(FavoriController)
);

// Historique de lecture
router.get('/lecture/historique',
    authMiddleware.authenticate,
    FavoriController.getHistoriqueLecture.bind(FavoriController)
);



// Recommandations personnalisées
router.get('/recommandations',
    authMiddleware.optionalAuthenticate,
    RecommendationController.getRecommandations.bind(RecommendationController)
);

// Articles similaires
router.get('/articles/:articleId/similaires',
    RecommendationController.getSimilarArticles.bind(RecommendationController)
);

// Tendances
router.get('/recommandations/tendances',
    RecommendationController.getTendances.bind(RecommendationController)
);

// Découvrir
router.get('/recommandations/decouvrir',
    authMiddleware.optionalAuthenticate,
    RecommendationController.getDecouvrir.bind(RecommendationController)
);

// Par auteur
router.get('/recommandations/auteur/:auteurId',
    RecommendationController.getByAuthor.bind(RecommendationController)
);

// Feed personnalisé
router.get('/feed',
    authMiddleware.optionalAuthenticate,
    RecommendationController.getFeed.bind(RecommendationController)
);

// Préférences
router.get('/recommandations/preferences',
    authMiddleware.authenticate,
    RecommendationController.getPreferences.bind(RecommendationController)
);

router.put('/recommandations/preferences',
    authMiddleware.authenticate,
    RecommendationController.updatePreferences.bind(RecommendationController)
);

















// ==================== BADGES ====================

// Admin - CRUD badges
router.post('/badges',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    BadgeController.create.bind(BadgeController)
);

router.put('/badges/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    BadgeController.update.bind(BadgeController)
);

router.delete('/badges/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    BadgeController.delete.bind(BadgeController)
);

// Tous les badges disponibles
router.get('/badges',
    authMiddleware.optionalAuthenticate,
    BadgeController.getAllBadges.bind(BadgeController)
);

// Mes badges
router.get('/badges/mes-badges',
    authMiddleware.authenticate,
    BadgeController.getMyBadges.bind(BadgeController)
);

// Classement
router.get('/badges/classement',
    authMiddleware.optionalAuthenticate,
    BadgeController.getClassement.bind(BadgeController)
);

// Vérifier les badges
router.post('/badges/verifier',
    authMiddleware.authenticate,
    BadgeController.verifierBadges.bind(BadgeController)
);

// Stats globales
router.get('/badges/stats',
    BadgeController.getStats.bind(BadgeController)
);

// Partager un badge
router.post('/badges/:id/partager',
    authMiddleware.authenticate,
    BadgeController.partagerBadge.bind(BadgeController)
);

//===================BADGE========================

// Admin - CRUD badges
router.post('/badges',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    BadgeController.create.bind(BadgeController)
);

router.put('/badges/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    BadgeController.update.bind(BadgeController)
);

router.delete('/badges/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    BadgeController.delete.bind(BadgeController)
);

// Tous les badges disponibles
router.get('/badges',
    authMiddleware.optionalAuthenticate,
    BadgeController.getAllBadges.bind(BadgeController)
);

// Mes badges
router.get('/badges/mes-badges',
    authMiddleware.authenticate,
    BadgeController.getMyBadges.bind(BadgeController)
);

// Classement
router.get('/badges/classement',
    authMiddleware.optionalAuthenticate,
    BadgeController.getClassement.bind(BadgeController)
);

// Vérifier les badges
router.post('/badges/verifier',
    authMiddleware.authenticate,
    BadgeController.verifierBadges.bind(BadgeController)
);

// Stats globales
router.get('/badges/stats',
    BadgeController.getStats.bind(BadgeController)
);

// Partager un badge
router.post('/badges/:id/partager',
    authMiddleware.authenticate,
    BadgeController.partagerBadge.bind(BadgeController)
);

module.exports = router;