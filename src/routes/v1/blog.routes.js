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
        { name: 'image_secondaire', maxCount: 1 }
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
 * GET /api/v1/blog/articles/populaires/top
 * Récupérer les articles populaires
 * Query: periode=7d, limit=10
 * Auth: PUBLIC
 * Cache: 1 heure
 * Réponse: { success, data, periode }
 */
router.get('/articles/populaires/top',
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('periode').optional().isIn(['24h', '7d', '30d']),
        query('limit').optional().isInt({ min: 1, max: 50 })
    ]),
    ArticleController.getPopularArticles.bind(ArticleController)
);

/**
 * GET /api/v1/blog/articles/categorie/:categorie
 * Récupérer les articles par catégorie
 * Params: categorie
 * Query: page=1, limit=20
 * Auth: PUBLIC
 * Réponse: { success, data, pagination }
 */
router.get('/articles/categorie/:categorie',
    validationMiddleware.validate([
        param('categorie').notEmpty(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 50 })
    ]),
    ArticleController.findByCategory.bind(ArticleController)
);

/**
 * GET /api/v1/blog/articles/auteur/:auteurId
 * Récupérer les articles par auteur
 * Params: auteurId
 * Query: page=1, limit=20
 * Auth: PUBLIC
 * Réponse: { success, data, pagination }
 */
router.get('/articles/auteur/:auteurId',
    validationMiddleware.validate([
        param('auteurId').isInt(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 50 })
    ]),
    ArticleController.findByAuthor.bind(ArticleController)
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
        { name: 'image_secondaire', maxCount: 1 }
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

/**
 * POST /api/v1/blog/articles/search
 * Recherche avancée d'articles
 * Body: { query?, categories?, tags?, date_debut?, date_fin?, auteur_id?, note_min?, tri='pertinence' }
 * Query: page=1, limit=20
 * Auth: PUBLIC
 * Réponse: { success, data, pagination }
 */
router.post('/articles/search',
    validationMiddleware.validate([
        body('query').optional().trim(),
        body('categories').optional().isArray(),
        body('tags').optional().isArray(),
        body('date_debut').optional().isISO8601(),
        body('date_fin').optional().isISO8601(),
        body('auteur_id').optional().isInt(),
        body('note_min').optional().isFloat({ min: 0, max: 5 }),
        body('tri').optional().isIn(['pertinence', 'date_desc', 'date_asc', 'popularite']),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 50 })
    ]),
    ArticleController.search.bind(ArticleController)
);

/**
 * GET /api/v1/blog/articles/:id/stats
 * Récupérer les statistiques d'un article
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Query: periode=30d
 * Auth: Auteur, ADMIN
 * Cache: 10 minutes
 * Réponse: { success, data }
 */
router.get('/articles/:id/stats',
    authMiddleware.authenticate,
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        param('id').isInt(),
        query('periode').optional().isIn(['24h', '7d', '30d', '1y'])
    ]),
    ArticleController.getStats.bind(ArticleController)
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
 * POST /api/v1/blog/commentaires/:id/signaler
 * Signaler un commentaire
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { motif, description? }
 * Auth: PRIVATE
 * Réponse: 201 { success, data, message }
 */
router.post('/commentaires/:id/signaler',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt(),
        body('motif').notEmpty().trim().isLength({ max: 255 }),
        body('description').optional().trim().isLength({ max: 1000 })
    ]),
    CommentaireController.signaler.bind(CommentaireController)
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
    validationMiddleware.validate([
        param('id').isInt(),
        body('statut').isIn(['APPROUVE', 'REJETE', 'MASQUE']),
        body('motif').optional().trim()
    ]),
    CommentaireController.moderer.bind(CommentaireController)
);

/**
 * GET /api/v1/blog/commentaires/signalements/en-attente
 * Récupérer les signalements en attente
 * Headers: Authorization: Bearer <token>
 * Query: page=1, limit=50
 * Auth: MODERATEUR, ADMIN
 * Réponse: { success, data, pagination }
 */
router.get('/commentaires/signalements/en-attente',
    authMiddleware.authenticate,
    roleMiddleware.isModerator(),
    validationMiddleware.validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 })
    ]),
    CommentaireController.getSignalementsEnAttente.bind(CommentaireController)
);

/**
 * PATCH /api/v1/blog/commentaires/signalements/:id/traiter
 * Traiter un signalement de commentaire
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { statut, action_entreprise? }
 * Auth: MODERATEUR, ADMIN
 * Réponse: { success, message }
 */
router.patch('/commentaires/signalements/:id/traiter',
    authMiddleware.authenticate,
    roleMiddleware.isModerator(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('statut').isIn(['TRAITE', 'REJETE']),
        body('action_entreprise').optional().trim()
    ]),
    CommentaireController.traiterSignalement.bind(CommentaireController)
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
        body('type_partage').isIn(['FACEBOOK', 'TWITTER', 'LINKEDIN', 'WHATSAPP', 'EMAIL', 'COPY_LINK'])
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

// ==================== V. ABONNEMENTS ====================

/**
 * POST /api/v1/blog/abonnements
 * S'abonner à une catégorie, un auteur ou un tag
 * Headers: Authorization: Bearer <token>
 * Body: { type_abonnement: 'CATEGORIE'|'AUTEUR'|'TAG', reference_id }
 * Auth: PRIVATE
 * Réponse: 201 { success, data, message }
 */
router.post('/abonnements',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        body('type_abonnement').isIn(['CATEGORIE', 'AUTEUR', 'TAG']),
        body('reference_id').notEmpty()
    ]),
    AbonnementBlogController.subscribe.bind(AbonnementBlogController)
);

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

module.exports = router;