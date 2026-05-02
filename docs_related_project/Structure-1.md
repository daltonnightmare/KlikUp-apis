# File Tree: apis

**Generated:** 2/23/2026, 5:54:48 PM
**Root Path:** `c:\Users\ASUS\Desktop\Willy\ProjetBus\apis`

```
├── 📁 docs_code
│   ├── 📁 scr.routes
│   │   ├── 📁 middlewares
│   │   └── 📁 v1
│   ├── 📁 src.configuration
│   │   ├── 📝 cache.js.md
│   │   ├── 📝 constants.js.md
│   │   ├── 📝 database.js.md
│   │   ├── 📝 env.js.md
│   │   ├── 📝 logger.js.md
│   │   ├── 📝 queue.js.md
│   │   ├── 📝 redis.js.md
│   │   └── 📝 storage.js.md
│   ├── 📁 src.controllers
│   ├── 📁 src.jobs
│   ├── 📁 src.models
│   └── 📁 src.services
├── 📁 docs_related_project
│   ├── 📝 README.md
│   ├── 📄 bd_app.sql
│   ├── 📄 cpy.js
│   ├── 📝 cpy.md
│   ├── 📄 deepseek.sql
│   ├── 📄 fileTree.txt
│   └── 📄 mock_data.sql
├── 📁 redis
│   ├── 📄 monitor_redis.ps1
│   ├── 📄 start_redis.ps1
│   └── 📄 stop_redis.ps1
├── 📁 scripts
│   ├── 📄 backup.sh
│   ├── 📄 deploy.sh
│   ├── 📄 init-db.sh
│   ├── 📄 seed-db.sh
│   └── 📄 validate_env.js
├── 📁 src
│   ├── 📁 configuration
│   │   ├── 📄 cache.js
│   │   ├── 📄 constants.js
│   │   ├── 📄 database.js
│   │   ├── 📄 env.js
│   │   ├── 📄 logger.js
│   │   ├── 📄 queue.js
│   │   ├── 📄 redis.js
│   │   └── 📄 storage.js
│   ├── 📁 controllers
│   │   ├── 📁 admin
│   │   │   ├── 📄 ConfigurationController.js
│   │   │   ├── 📄 DashboardController.js
│   │   │   ├── 📄 MaintenanceController.js
│   │   │   ├── 📄 ModerationController.js
│   │   │   └── 📄 RetentionController.js
│   │   ├── 📁 adresse
│   │   │   ├── 📄 AdresseController.js
│   │   │   └── 📄 GeoController.js
│   │   ├── 📁 auth
│   │   │   ├── 📄 AuthController.js
│   │   │   └── 📄 PasswordController.js
│   │   ├── 📁 avis
│   │   │   ├── 📄 AvisController.js
│   │   │   └── 📄 VoteAvisController.js
│   │   ├── 📁 blog
│   │   │   ├── 📄 AbonnementBlogController.js
│   │   │   ├── 📄 ArticleController.js
│   │   │   ├── 📄 CommentaireController.js
│   │   │   ├── 📄 LikeController.js
│   │   │   ├── 📄 PartageController.js
│   │   │   ├── 📄 SignalementController.js
│   │   │   └── 📄 StatsBlogController.js
│   │   ├── 📁 boutique
│   │   │   ├── 📄 BoutiqueController.js
│   │   │   ├── 📄 CategorieBoutiqueController.js
│   │   │   ├── 📄 CommandeBoutiqueController.js
│   │   │   └── 📄 ProduitBoutiqueController.js
│   │   ├── 📁 comptes
│   │   │   ├── 📄 CompteController.js
│   │   │   ├── 📄 RoleController.js
│   │   │   ├── 📄 SessionController.js
│   │   │   └── 📄 VerificationController.js
│   │   ├── 📁 document
│   │   │   └── 📄 DocumentController.js
│   │   ├── 📁 fidelite
│   │   │   ├── 📄 ParrainageController.js
│   │   │   ├── 📄 PointsFideliteController.js
│   │   │   └── 📄 ProgrammeFideliteController.js
│   │   ├── 📁 historique
│   │   │   ├── 📄 HistoriqueActionController.js
│   │   │   ├── 📄 HistoriqueTransactionController.js
│   │   │   ├── 📄 JournalAuditController.js
│   │   │   └── 📄 PolitiqueRetentionController.js
│   │   ├── 📁 horaire
│   │   │   ├── 📄 HoraireController.js
│   │   │   ├── 📄 HoraireExceptionController.js
│   │   │   └── 📄 JourFerieController.js
│   │   ├── 📁 livraison
│   │   │   ├── 📄 DemandeLivraisonController.js
│   │   │   ├── 📄 EntrepriseLivraisonController.js
│   │   │   ├── 📄 LivreurController.js
│   │   │   └── 📄 ServiceLivraisonController.js
│   │   ├── 📁 messagerie
│   │   │   ├── 📄 BlocageController.js
│   │   │   ├── 📄 ConversationController.js
│   │   │   ├── 📄 InvitationController.js
│   │   │   ├── 📄 MessageController.js
│   │   │   ├── 📄 ModeleMessageController.js
│   │   │   └── 📄 ReactionController.js
│   │   ├── 📁 notification
│   │   │   ├── 📄 ModeleNotificationController.js
│   │   │   ├── 📄 NotificationController.js
│   │   │   ├── 📄 PreferenceNotificationController.js
│   │   │   └── 📄 PushTokenController.js
│   │   ├── 📁 public
│   │   │   ├── 📄 CatalogueController.js
│   │   │   ├── 📄 GeoController.js
│   │   │   ├── 📄 HealthController.js
│   │   │   └── 📄 StatsPubliquesController.js
│   │   ├── 📁 restauration
│   │   │   ├── 📄 CommandeRestaurantController.js
│   │   │   ├── 📄 EmplacementRestaurantController.js
│   │   │   ├── 📄 MenuController.js
│   │   │   ├── 📄 ProduitRestaurantController.js
│   │   │   ├── 📄 PromoController.js
│   │   │   └── 📄 RestaurantController.js
│   │   ├── 📁 transport
│   │   │   ├── 📄 CompagnieController.js
│   │   │   ├── 📄 EmplacementController.js
│   │   │   └── 📄 TicketController.js
│   │   └── 📄 index.js
│   ├── 📁 docs
│   │   ├── 📁 guides
│   │   ├── 📁 postman
│   │   │   └── ⚙️ collection.json
│   │   └── ⚙️ openapi.yaml
│   ├── 📁 jobs
│   │   ├── 📄 alertes-securite.job.js
│   │   ├── 📄 expiration-documents.job.js
│   │   ├── 📄 index.js
│   │   ├── 📄 nettoyage-historique.job.js
│   │   ├── 📄 nettoyage-sessions.job.js
│   │   └── 📄 refresh-materialized-views.job.js
│   ├── 📁 models
│   │   ├── 📁 adresse
│   │   │   ├── 📄 Adresse.model.js
│   │   │   └── 📄 AdresseEntite.model.js
│   │   ├── 📁 avis
│   │   │   ├── 📄 Avis.model.js
│   │   │   └── 📄 VoteAvis.model.js
│   │   ├── 📁 blog
│   │   │   ├── 📄 AbonnementBlog.model.js
│   │   │   ├── 📄 ArticleBlog.model.js
│   │   │   ├── 📄 Commentaire.model.js
│   │   │   ├── 📄 FavoriArticle.model.js
│   │   │   ├── 📄 LikeArticle.model.js
│   │   │   ├── 📄 LikeCommentaire.js
│   │   │   ├── 📄 NotificationBlog.model.js
│   │   │   ├── 📄 PartageArticle.model.js
│   │   │   ├── 📄 SignalementArticle.model.js
│   │   │   ├── 📄 SignalementCommentaire.model.js
│   │   │   └── 📄 StatsLectureArticle.js
│   │   ├── 📁 boutique
│   │   │   ├── 📄 Boutique.model.js
│   │   │   ├── 📄 CategorieBoutique.model.js
│   │   │   ├── 📄 CommandeBoutique.model.js
│   │   │   └── 📄 ProduitBoutique.model.js
│   │   ├── 📁 comptes
│   │   │   ├── 📄 AlerteSecurite.model.js
│   │   │   ├── 📄 Compte.model.js
│   │   │   ├── 📄 Session.model.js
│   │   │   └── 📄 TokenRevoque.model.js
│   │   ├── 📁 document
│   │   │   ├── 📄 Document.model.js
│   │   │   └── 📄 HistoriqueValidationDocument.model.js
│   │   ├── 📁 fidelite
│   │   │   ├── 📄 MouvementPoint.model.js
│   │   │   ├── 📄 Parrainage.model.js
│   │   │   ├── 📄 ProgrammeFidelite.model.js
│   │   │   └── 📄 SoldeFidelite.model.js
│   │   ├── 📁 historique
│   │   │   ├── 📄 HistoriqueAction.model.js
│   │   │   ├── 📄 HistoriqueConnexion.model.js
│   │   │   ├── 📄 HistoriqueTransaction.model.js
│   │   │   └── 📄 JournalAudit.model.js
│   │   ├── 📁 horaire
│   │   │   ├── 📄 Horaire.model.js
│   │   │   ├── 📄 HoraireException.model.js
│   │   │   └── 📄 JourFerie.model.js
│   │   ├── 📁 livraison
│   │   │   ├── 📄 DemandeLivraison.model.js
│   │   │   ├── 📄 EntrepriseLivraison.model.js
│   │   │   ├── 📄 Livreur.model.js
│   │   │   └── 📄 ServiceLivraison.model.js
│   │   ├── 📁 messagerie
│   │   │   ├── 📄 BlocageUtilisateur.model.js
│   │   │   ├── 📄 Conversation.model.js
│   │   │   ├── 📄 InvitationConversation.model.js
│   │   │   ├── 📄 LectureMessage.model.js
│   │   │   ├── 📄 Message.model.js
│   │   │   ├── 📄 ModeleMessage.model.js
│   │   │   ├── 📄 ParticipantConversation.model.js
│   │   │   ├── 📄 PieceJointe.model.js
│   │   │   └── 📄 ReactionMessage.model.js
│   │   ├── 📁 notification
│   │   │   ├── 📄 ModeleNotification.model.js
│   │   │   ├── 📄 Notification.model.js
│   │   │   ├── 📄 PreferenceNotification.model.js
│   │   │   └── 📄 TokenPush.model.js
│   │   ├── 📁 plateforme
│   │   │   ├── 📄 Configuration.model.js
│   │   │   └── 📄 Plateforme.model.js
│   │   ├── 📁 restauration
│   │   │   ├── 📄 CommandeEmplacementFastFood.model.js
│   │   │   ├── 📄 EmplacementRestaurant.model.js
│   │   │   ├── 📄 MenuRestaurant.model.js
│   │   │   ├── 📄 ProduitIndividuelRestaurant.model.js
│   │   │   ├── 📄 PromoRestaurant.model.js
│   │   │   └── 📄 RestaurantFastFood.model.js
│   │   ├── 📁 tache
│   │   │   └── 📄 FileTache.model.js
│   │   ├── 📁 transport
│   │   │   ├── 📄 AchatServicePrive.model.js
│   │   │   ├── 📄 AchatTicketPrive.model.js
│   │   │   ├── 📄 AchatTicketPublic.model.js
│   │   │   ├── 📄 CompagnieTransport.model.js
│   │   │   ├── 📄 DemandeService.model.js
│   │   │   ├── 📄 EmplacementTransport.model.js
│   │   │   ├── 📄 ServiceTransport.model.js
│   │   │   └── 📄 TicketTransport.model.js
│   │   └── 📄 index.js
│   ├── 📁 routes
│   │   ├── 📁 middlewares
│   │   │   ├── 📄 audit.middleware.js
│   │   │   ├── 📄 auth.middleware.js
│   │   │   ├── 📄 compression.middleware.js
│   │   │   ├── 📄 cors.middleware.js
│   │   │   ├── 📄 errorHandler.middleware.js
│   │   │   ├── 📄 helmet.middleware.js
│   │   │   ├── 📄 rateLimiter.middleware.js
│   │   │   ├── 📄 role.middleware.js
│   │   │   ├── 📄 upload.middleware.js
│   │   │   └── 📄 validation.middleware.js
│   │   ├── 📁 v1
│   │   │   ├── 📄 adresse.routes.js
│   │   │   ├── 📄 blog.routes.js
│   │   │   ├── 📄 document.routes.js
│   │   │   ├── 📄 fidelite.routes.js
│   │   │   ├── 📄 historique.routes.js
│   │   │   ├── 📄 horaire.routes.js
│   │   │   ├── 📄 livraison.routes.js
│   │   │   ├── 📄 messagerie.routes.js
│   │   │   ├── 📄 notification.routes.js
│   │   │   └── 📄 public.routes.js
│   │   └── 📄 index.js
│   ├── 📁 services
│   │   ├── 📁 audit
│   │   │   └── 📄 AuditService.js
│   │   ├── 📁 email
│   │   │   └── 📄 EmailService.js
│   │   ├── 📁 export
│   │   │   └── 📄 ExportService.js
│   │   ├── 📁 file
│   │   │   └── 📄 FileService.js
│   │   ├── 📁 geo
│   │   │   └── 📄 GeoService.js
│   │   ├── 📁 notification
│   │   │   └── 📄 NotificationService.js
│   │   ├── 📁 payment
│   │   │   └── 📄 PaymentService.js
│   │   ├── 📁 push
│   │   │   └── 📄 PushService.js
│   │   ├── 📁 queue
│   │   │   └── 📄 QueueService.js
│   │   ├── 📁 search
│   │   │   └── 📄 SearchService.js
│   │   ├── 📁 security
│   │   │   ├── 📄 SecurityService.js
│   │   │   └── 📄 TokenService.js
│   │   ├── 📁 sms
│   │   │   └── 📄 SmsService.js
│   │   ├── 📁 validation
│   │   │   ├── 📁 schemas
│   │   │   └── 📄 ValidationService.js
│   │   └── 📄 index.js
│   ├── 📁 utils
│   │   ├── 📁 constants
│   │   │   ├── 📄 enums.js
│   │   │   ├── 📄 errorsCode.js
│   │   │   ├── 📄 permissions.js
│   │   │   └── 📄 roles.js
│   │   ├── 📁 database
│   │   │   ├── 📁 migrations
│   │   │   ├── 📁 queries
│   │   │   └── 📁 seeds
│   │   ├── 📁 errors
│   │   │   └── 📄 rateLimiterError.js
│   │   └── 📁 helpers
│   │       ├── 📄 date.helper.js
│   │       ├── 📄 number.helper.js
│   │       └── 📄 string.helper.js
│   └── 📄 app.js
├── 📁 tests
│   ├── 📁 e2e
│   │   └── 📄 api.test.js
│   ├── 📁 fixtures
│   │   └── 📄 data.sql
│   ├── 📁 integration
│   │   ├── 📄 auth.test.js
│   │   └── 📄 commandes.test.js
│   └── 📁 unit
│       ├── 📁 controllers
│       ├── 📁 services
│       └── 📁 utils
├── 📁 uploads
│   ├── 📁 articles
│   ├── 📁 avatars
│   ├── 📁 documents
│   ├── 📁 images
│   └── 📁 produits
├── ⚙️ .dockerfile
├── ⚙️ .gitignore
├── 📝 README.md
├── ⚙️ docker-compose.yaml
├── ⚙️ package-lock.json
└── ⚙️ package.json
```

---
*Generated by FileTree Pro Extension*




src/
├── controllers/blog/
│   ├── ArticleController.js        (Refondu - CRUD + Interactions)
│   ├── CommentaireController.js    (Refondu - Discussions)
│   ├── LikeController.js           (Refondu - Likes/Dislikes)
│   ├── PartageController.js        (Refondu - Analytics sociaux)
│   ├── SignalementController.js    (Refondu - Modération)
│   ├── AbonnementBlogController.js (Refondu - Abonnements)
│   ├── QuizController.js           (NOUVEAU - Quiz interactifs)
│   ├── SondageController.js        (NOUVEAU - Sondages)
│   ├── FavoriController.js         (NOUVEAU - Favoris/Sauvegarde)
│   ├── BadgeController.js          (NOUVEAU - Gamification)
│   ├── RecommendationController.js  (NOUVEAU - Recommandations IA)
│   └── StatsBlogController.js      (Refondu - Analytics)
├── routes/v1/
│   ├── blog.routes.js              (Refondu - Routes unifiées)
│   ├── quiz.routes.js              (NOUVEAU)
│   ├── sondage.routes.js           (NOUVEAU)
│   └── recommandation.routes.js    (NOUVEAU)
└── services/blog/
    ├── ArticleService.js           (NOUVEAU - Logique métier)
    ├── InteractionService.js       (NOUVEAU - Gestion interactions)
    ├── RecommendationService.js    (NOUVEAU - Moteur recommandation)
    └── AnalyticsService.js         (NOUVEAU - Analytics avancés)