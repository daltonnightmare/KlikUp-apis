# File Tree: apis

**Generated:** 2/26/2026, 6:32:09 PM
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
│       ├── 📝 Token.md
│       ├── 📝 email.EmailService.md
│       ├── 📝 security.SecurityService.md
│       ├── 📝 security.TokenSecurity.md
│       └── 📝 sms.smsService.md
├── 📁 docs_related_project
│   ├── 📝 README.md
│   ├── 📝 Structure-1.md
│   ├── 📄 bd_app.sql
│   ├── 📄 cpy.js
│   ├── 📝 cpy.md
│   ├── 📄 deepseek.sql
│   ├── 📄 fileTree.txt
│   └── 📄 mock_data.sql
├── 📁 exports
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
│   │   ├── 📄 storage.js
│   │   └── 📄 swagger.js
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
│   │   ├── 📄 FileTacheModel.js
│   │   ├── 📄 HistoriqueActionModel.js
│   │   ├── 📄 JournalAuditModel.js
│   │   └── 📄 index.js
│   ├── 📁 routes
│   │   ├── 📁 middlewares
│   │   │   ├── 📄 audit.middleware.js
│   │   │   ├── 📄 auth.middleware.js
│   │   │   ├── 📄 cache.middleware.js
│   │   │   ├── 📄 compression.middleware.js
│   │   │   ├── 📄 cors.middleware.js
│   │   │   ├── 📄 errorHandler.middleware.js
│   │   │   ├── 📄 helmet.middleware.js
│   │   │   ├── 📄 rateLimiter.middleware.js
│   │   │   ├── 📄 role.middleware.js
│   │   │   ├── 📄 upload.middleware.js
│   │   │   └── 📄 validation.middleware.js
│   │   ├── 📁 v1
│   │   │   ├── 📄 administration.routes.js
│   │   │   ├── 📄 adresse.routes.js
│   │   │   ├── 📄 authentification.routes.js
│   │   │   ├── 📄 avis.routes.js
│   │   │   ├── 📄 blog.routes.js
│   │   │   ├── 📄 boutiques.routes.js
│   │   │   ├── 📄 comptes.routes.js
│   │   │   ├── 📄 document.routes.js
│   │   │   ├── 📄 fidelite.routes.js
│   │   │   ├── 📄 historique.routes.js
│   │   │   ├── 📄 horaire.routes.js
│   │   │   ├── 📄 livraison.routes.js
│   │   │   ├── 📄 messagerie.routes.js
│   │   │   ├── 📄 notification.routes.js
│   │   │   ├── 📄 public.routes.js
│   │   │   ├── 📄 restaurants.routes.js
│   │   │   └── 📄 transports.routes.js
│   │   └── 📄 index.js
│   ├── 📁 services
│   │   ├── 📁 audit
│   │   │   └── 📄 AuditService.js
│   │   ├── 📁 email
│   │   │   ├── 📁 templates
│   │   │   │   ├── 🌐 commande-confirmee.html
│   │   │   │   ├── 🌐 facture.html
│   │   │   │   ├── 🌐 notification.html
│   │   │   │   ├── 🌐 reset_password.html
│   │   │   │   ├── 🌐 verify_email.html
│   │   │   │   └── 🌐 welcome.html
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
│   │   │   ├── 📄 AppError.js
│   │   │   ├── 📄 AuthControllerError.js
│   │   │   ├── 📄 ValidationError.js
│   │   │   ├── 📄 errors.js
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
│       │   └── 📄 test-token.js
│       └── 📁 utils
├── 📁 uploads
│   ├── 📁 articles
│   ├── 📁 avatars
│   ├── 📁 documents
│   ├── 📁 images
│   ├── 📁 menus
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