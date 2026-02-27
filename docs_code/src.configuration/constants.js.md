```markdown
# Module de Constantes - constants.js

## 📋 Vue d'ensemble

Ce module centralise toutes les constantes de l'application, y compris les énumérations (correspondant aux types PostgreSQL), les hiérarchies de rôles, les permissions, les statuts HTTP et les configurations globales. Il sert de source unique de vérité pour les valeurs constantes utilisées dans toute l'application.

## 🏗️ Architecture

### Classe `Constants`

La classe principale qui encapsule toutes les constantes de l'application.

#### Constructeur
```javascript
constructor()
```
Initialise toutes les constantes en appelant les méthodes d'initialisation :
1. `initEnums()` - Initialise toutes les énumérations
2. `initRoles()` - Initialise la hiérarchie des rôles
3. `initPermissions()` - Initialise les permissions par rôle
4. `initStatus()` - Initialise les statuts et codes HTTP
5. `initConfig()` - Initialise la configuration globale

## 📚 Énumérations (ENUMS)

### Rôles des comptes (`COMPTE_ROLE`)
```javascript
COMPTE_ROLE: [
    'ADMINISTRATEUR_PLATEFORME',    // Super admin
    'BLOGUEUR_PLATEFORME',           // Blogueur au niveau plateforme
    'STAFF_PLATEFORME',              // Staff plateforme
    'ADMINISTRATEUR_COMPAGNIE',      // Admin compagnie transport
    'STAFF_COMPAGNIE',                // Staff compagnie
    'BLOGUEUR_COMPAGNIE',             // Blogueur compagnie
    'ADMINISTRATEUR_EMBRANCHEMENT_COMPAGNIE', // Admin embranchement
    'STAFF_EMBRANCHEMENT_COMPAGNIE',  // Staff embranchement
    'BLOGUEUR_EMBRANCHEMENT_COMPAGNIE', // Blogueur embranchement
    'ADMINISTRATEUR_RESTAURANT_FAST_FOOD', // Admin restaurant
    'STAFF_RESTAURANT_FAST_FOOD',     // Staff restaurant
    'BLOGUEUR_RESTAURANT_FAST_FOOD',  // Blogueur restaurant
    'UTILISATEUR_PRIVE_SIMPLE',       // Utilisateur standard
    'UTILISATEUR_VENDEUR'              // Vendeur
]
```

### Statuts des comptes (`STATUT_COMPTE`)
```javascript
STATUT_COMPTE: [
    'EST_AUTHENTIFIE',    // Compte actif et authentifié
    'NON_AUTHENTIFIE',    // Compte créé mais non authentifié
    'SUSPENDU',            // Compte temporairement suspendu
    'BANNI'                // Compte définitivement banni
]
```

### Jours d'ouverture (`JOURS_OUVERTURE`)
```javascript
JOURS_OUVERTURE: [
    'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI',
    'SAMEDI', 'DIMANCHE',
    'TOUS_LES_JOURS',
    'LUNDI_VENDREDI',
    'LUNDI_SAMEDI',
    'LUNDI_DIMANCHE'
]
```

### Catégories de menus (`CATEGORIES_MENU`)
```javascript
CATEGORIES_MENU: [
    'PETIT_DEJEUNER', 'ENTREE', 'PLAT_PRINCIPAL', 'DESSERT', 'BOISSON',
    'MENU_ENFANT', 'MENU_PROMO', 'MENU_DU_JOUR', 'FORMULE_MIDI', 'FORMULE_SOIR',
    'ACCOMPAGNEMENT', 'SAUCE', 'SALADE', 'SOUPE', 'SANDWICH',
    'BURGER', 'PIZZA', 'KEBAB', 'TACOS', 'SUSHI',
    'WRAP', 'BOWL', 'PASTA', 'SALADE_COMPOSEE',
    'PLAT_AFRICAIN', 'PLAT_ASIATIQUE', 'PLAT_ITALIEN', 'PLAT_AMERICAIN'
]
```

### Catégories de produits (`CATEGORIES_PRODUITS`)
```javascript
CATEGORIES_PRODUITS: [
    'ALIMENTAIRE', 'BOISSON', 'HYGIENE', 'ELECTRONIQUE', 'VETEMENT',
    'ACCESSOIRE', 'MAISON', 'SPORT', 'BEAUTE', 'LIVRE', 'JOUET', 'AUTRE'
]
```

### Types de promotions (`TYPES_PROMO`)
```javascript
TYPES_PROMO: [
    'POURCENTAGE',        // Réduction en pourcentage
    'MONTANT_FIXE',        // Réduction montant fixe
    'DEUX_POUR_UN',        // 2 produits achetés = 1 offert
    'LIVRAISON_GRATUITE',  // Frais de livraison offerts
    'MENU_OFFERT',         // Menu offert
    'CODE_PROMO',          // Code promotionnel
    'FIDELITE'             // Réduction fidélité
]
```

### Types de service livraison (`TYPES_SERVICE_LIVRAISON`)
```javascript
TYPES_SERVICE_LIVRAISON: [
    'STANDARD',            // Livraison standard
    'EXPRESS',             // Livraison express
    'PROGRAMMEE',          // Livraison programmée
    'NUIT',                // Livraison de nuit
    'WEEKEND',             // Livraison weekend
    'INTERNATIONAL'        // Livraison internationale
]
```

### Types de connexion (`TYPES_CONNEXION`)
```javascript
TYPES_CONNEXION: [
    'CONNEXION',
    'DECONNEXION'
]
```

### Statuts de connexion (`STATUTS_CONNEXION`)
```javascript
STATUTS_CONNEXION: [
    'SUCCESS',             // Connexion réussie
    'FAILED',               // Échec connexion
    'BLOCKED'               // Connexion bloquée
]
```

### Types de services transport (`TYPES_SERVICES_TRANSPORT`)
```javascript
TYPES_SERVICES_TRANSPORT: [
    'ABONNEMENT_MENSUEL',
    'BIMENSUEL',
    'TRIMESTRIEL',
    'ANNUEL'
]
```

### Statuts article (`STATUT_ARTICLE`)
```javascript
STATUT_ARTICLE: [
    'BROUILLON',                // Article en cours de rédaction
    'EN_ATTENTE_VALIDATION',    // En attente de modération
    'PUBLIE',                    // Article publié
    'PROGRAMME',                 // Publication programmée
    'ARCHIVE',                   // Article archivé
    'SIGNALE',                   // Article signalé
    'SUPPRIME'                   // Article supprimé
]
```

### Catégories article (`CATEGORIES_ARTICLE`)
```javascript
CATEGORIES_ARTICLE: [
    'ACTUALITE', 'TUTORIEL', 'ASTUCE', 'GUIDE', 'AVIS',
    'TEST_PRODUIT', 'COMPARAISON', 'PROMOTION', 'EVENEMENT',
    'INTERVIEW', 'DOSSIER', 'OPINION', 'TENDANCE', 'VIE_LOCALE',
    'TRANSPORT', 'RESTAURATION', 'BOUTIQUE', 'COMMUNAUTE'
]
```

### Visibilité article (`VISIBILITE_ARTICLE`)
```javascript
VISIBILITE_ARTICLE: [
    'PUBLIC',               // Visible par tous
    'ABONNES',              // Réservé aux abonnés
    'PRIVE',                 // Privé (auteur seulement)
    'EQUIPE'                 // Visible par l'équipe
]
```

### Statuts commentaire (`STATUT_COMMENTAIRE`)
```javascript
STATUT_COMMENTAIRE: [
    'EN_ATTENTE',           // En attente de modération
    'APPROUVE',              // Approuvé
    'REJETE',                // Rejeté
    'SIGNALE',               // Signalé
    'SUPPRIME',              // Supprimé
    'MASQUE'                 // Masqué
]
```

### Types de conversation (`TYPE_CONVERSATION`)
```javascript
TYPE_CONVERSATION: [
    'DIRECT',                // Conversation directe 1-1
    'GROUPE',                // Groupe de discussion
    'SUPPORT',               // Conversation support
    'COMMANDE',              // Liée à une commande
    'LIVRAISON',             // Liée à une livraison
    'SERVICE_CLIENT',        // Service client
    'NOTIFICATION_ADMIN',    // Notification admin
    'ANNONCE_PLATEFORME',    // Annonce plateforme
    'SIGNALEMENT',           // Signalement
    'RECLAMATION'            // Réclamation
]
```

### Rôles dans une conversation (`ROLE_CONVERSATION`)
```javascript
ROLE_CONVERSATION: [
    'ADMIN',                 // Administrateur conversation
    'MODERATEUR',            // Modérateur
    'PARTICIPANT',           // Participant
    'OBSERVATEUR',           // Observateur (lecture seule)
    'INVITE'                 // Invité
]
```

### Statuts message (`STATUT_MESSAGE`)
```javascript
STATUT_MESSAGE: [
    'ENVOYE',                // Message envoyé
    'RECU',                  // Reçu par le serveur
    'LU',                    // Lu par le destinataire
    'MODIFIE',               // Modifié
    'SUPPRIME',              // Supprimé
    'SIGNALE'                // Signalé
]
```

### Types de pièce jointe (`TYPE_PIECE_JOINTE`)
```javascript
TYPE_PIECE_JOINTE: [
    'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT',
    'LOCALISATION', 'CONTACT'
]
```

### Statuts commande (`STATUT_COMMANDE`)
```javascript
STATUT_COMMANDE: [
    'EN_ATTENTE',            // En attente de confirmation
    'CONFIRMEE',             // Confirmée
    'EN_PREPARATION',        // En cours de préparation
    'PRETE',                  // Prête
    'EN_LIVRAISON',          // En cours de livraison
    'LIVREE',                 // Livrée
    'RECUPEREE',              // Récupérée sur place
    'ANNULEE',                // Annulée
    'REMBOURSEE'              // Remboursée
]
```

### Types d'entité de référence (`ENTITE_REFERENCE`)
```javascript
ENTITE_REFERENCE: [
    'PLATEFORME',
    'COMPAGNIE_TRANSPORT',
    'EMPLACEMENT_TRANSPORT',
    'RESTAURANT_FAST_FOOD',
    'EMPLACEMENT_RESTAURANT',
    'BOUTIQUE',
    'PRODUIT_BOUTIQUE',
    'MENU',
    'COMPTE',
    'LIVREUR',
    'SERVICE_TRANSPORT'
]
```

### Statuts avis (`STATUT_AVIS`)
```javascript
STATUT_AVIS: [
    'EN_ATTENTE',            // En attente modération
    'PUBLIE',                 // Publié
    'REJETE',                 // Rejeté
    'SIGNALE',                // Signalé
    'MASQUE'                  // Masqué
]
```

### Canaux de notification (`CANAL_NOTIFICATION`)
```javascript
CANAL_NOTIFICATION: [
    'IN_APP',                // Notification dans l'application
    'PUSH_MOBILE',           // Notification push mobile
    'EMAIL',                 // Email
    'SMS',                   // SMS
    'WHATSAPP'               // WhatsApp
]
```

### Priorités notification (`PRIORITE_NOTIFICATION`)
```javascript
PRIORITE_NOTIFICATION: [
    'BASSE',                 // Basse priorité
    'NORMALE',               // Priorité normale
    'HAUTE',                  // Haute priorité
    'CRITIQUE'                // Critique
]
```

### Types de document (`TYPE_DOCUMENT`)
```javascript
TYPE_DOCUMENT: [
    'CNI_RECTO', 'CNI_VERSO', 'PASSEPORT', 'PERMIS_CONDUIRE',
    'JUSTIFICATIF_DOMICILE', 'EXTRAIT_NAISSANCE', 'REGISTRE_COMMERCE',
    'ATTESTATION_FISCALE', 'CONTRAT', 'BON_COMMANDE', 'FACTURE',
    'RECU_PAIEMENT', 'PHOTO_LIVREUR', 'AUTRE'
]
```

### Statuts document (`STATUT_DOCUMENT`)
```javascript
STATUT_DOCUMENT: [
    'EN_ATTENTE_VALIDATION',  // En attente validation
    'VALIDE',                   // Document validé
    'REFUSE',                   // Document refusé
    'EXPIRE',                   // Document expiré
    'REMPLACE'                  // Document remplacé
]
```

### Statuts tâche (`STATUT_TACHE`)
```javascript
STATUT_TACHE: [
    'EN_ATTENTE',            // En attente d'exécution
    'EN_COURS',               // En cours d'exécution
    'COMPLETEE',               // Tâche complétée
    'ECHOUEE',                 // Échouée
    'ABANDONNEE'               // Abandonnée
]
```

### Types de mouvement points (`TYPE_MOUVEMENT_POINTS`)
```javascript
TYPE_MOUVEMENT_POINTS: [
    'GAIN_ACHAT',             // Gain sur achat
    'GAIN_PARRAINAGE',        // Gain parrainage
    'GAIN_BONUS',              // Bonus
    'UTILISATION',             // Utilisation de points
    'EXPIRATION',              // Points expirés
    'CORRECTION_MANUELLE',     // Correction manuelle
    'TRANSFERT'                // Transfert de points
]
```

## 👑 Hiérarchie des rôles (`ROLES_HIERARCHY`)

```javascript
ROLES_HIERARCHY = {
    'UTILISATEUR_PRIVE_SIMPLE': 1,
    'UTILISATEUR_VENDEUR': 2,
    'BLOGUEUR_COMPAGNIE': 3,
    'STAFF_COMPAGNIE': 4,
    'ADMINISTRATEUR_COMPAGNIE': 5,
    'BLOGUEUR_PLATEFORME': 6,
    'STAFF_PLATEFORME': 7,
    'ADMINISTRATEUR_PLATEFORME': 8
}
```

## 🔐 Permissions par rôle (`PERMISSIONS`)

```javascript
PERMISSIONS = {
    'UTILISATEUR_PRIVE_SIMPLE': [
        'profile:read',           // Lecture profil
        'profile:update',         // Mise à jour profil
        'commande:create',        // Création commande
        'commande:read',          // Lecture commandes
        'avis:create',            // Création avis
        'notification:read'       // Lecture notifications
    ],
    
    'UTILISATEUR_VENDEUR': [
        'profile:read',
        'profile:update',
        'produit:create',          // Création produit
        'produit:update',          // Mise à jour produit
        'produit:read',
        'commande:read',
        'commande:update',         // Mise à jour commande
        'stats:read'                // Lecture statistiques
    ],
    
    'BLOGUEUR_COMPAGNIE': [
        'article:create',
        'article:update',
        'article:read',
        'commentaire:moderate',    // Modération commentaires
        'stats:read'
    ],
    
    'STAFF_COMPAGNIE': [
        'compagnie:read',
        'compagnie:update',
        'employe:manage',           // Gestion employés
        'rapport:read',              // Lecture rapports
        'commande:manage'            // Gestion commandes
    ],
    
    'ADMINISTRATEUR_COMPAGNIE': [
        '*:compagnie'                // Toutes les actions sur sa compagnie
    ],
    
    'BLOGUEUR_PLATEFORME': [
        'article:create',
        'article:update',
        'article:publish',           // Publication articles
        'commentaire:moderate',
        'stats:global'                // Statistiques globales
    ],
    
    'STAFF_PLATEFORME': [
        'user:manage',                // Gestion utilisateurs
        'commande:manage',
        'rapport:read',
        'stats:global',
        'moderation:all'              // Modération complète
    ],
    
    'ADMINISTRATEUR_PLATEFORME': [
        '*'                            // Toutes les permissions
    ]
}
```

## 📊 Statuts et codes HTTP

### Status génériques (`STATUS`)
```javascript
STATUS = {
    SUCCESS: 'success',        // Opération réussie
    ERROR: 'error',            // Erreur
    WARNING: 'warning',        // Avertissement
    INFO: 'info'               // Information
}
```

### Codes HTTP (`HTTP_STATUS`)
```javascript
HTTP_STATUS = {
    // Succès (2xx)
    OK: 200,                    // Requête réussie
    CREATED: 201,               // Ressource créée
    ACCEPTED: 202,              // Requête acceptée
    NO_CONTENT: 204,            // Pas de contenu
    
    // Erreurs client (4xx)
    BAD_REQUEST: 400,           // Requête invalide
    UNAUTHORIZED: 401,          // Non authentifié
    FORBIDDEN: 403,             // Non autorisé
    NOT_FOUND: 404,             // Ressource non trouvée
    CONFLICT: 409,              // Conflit
    TOO_MANY_REQUESTS: 429,     // Trop de requêtes
    
    // Erreurs serveur (5xx)
    INTERNAL_SERVER_ERROR: 500,  // Erreur serveur
    SERVICE_UNAVAILABLE: 503      // Service indisponible
}
```

## ⚙️ Configuration globale (`CONFIG`)

### Pagination
```javascript
PAGINATION: {
    DEFAULT_PAGE: 1,            // Page par défaut
    DEFAULT_LIMIT: 20,          // Limite par défaut
    MAX_LIMIT: 100               // Limite maximale
}
```

### Upload de fichiers
```javascript
UPLOAD: {
    MAX_FILE_SIZE: 5 * 1024 * 1024,     // 5MB max pour fichiers
    MAX_IMAGE_SIZE: 2 * 1024 * 1024,    // 2MB max pour images
    ALLOWED_IMAGES: [
        'image/jpeg',
        'image/png', 
        'image/gif',
        'image/webp'
    ],
    ALLOWED_DOCUMENTS: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
}
```

### Cache
```javascript
CACHE: {
    TTL: {
        SHORT: 300,              // 5 minutes
        MEDIUM: 3600,            // 1 heure
        LONG: 86400              // 24 heures
    },
    KEYS: {
        STATS: 'stats:',         // Préfixe stats
        CATALOG: 'catalog:',     // Préfixe catalogue
        USER: 'user:',           // Préfixe utilisateur
        SESSION: 'session:'      // Préfixe session
    }
}
```

### Validation
```javascript
VALIDATION: {
    PASSWORD_MIN_LENGTH: 8,              // Longueur minimale mot de passe
    USERNAME_MIN_LENGTH: 3,              // Longueur minimale nom utilisateur
    USERNAME_MAX_LENGTH: 50,              // Longueur maximale nom utilisateur
    PHONE_REGEX: /^(\+226|0)[0-9]{8}$/,   // Format téléphone Burkina Faso
    EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/  // Format email
}
```

### Fidélité
```javascript
FIDELITE: {
    POINTS_PAR_TRANCHE: 1,                // Points par tranche
    MONTANT_TRANCHE: 1000,                 // Montant par tranche (FCFA)
    VALEUR_POINT: 5,                        // Valeur en FCFA d'un point
    PARRAINAGE: {
        POINTS_PARRAIN: 100,                 // Points pour le parrain
        POINTS_FILLEUL: 50,                   // Points pour le filleul
        BONUS_FCFA_PARRAIN: 1000,             // Bonus FCFA parrain
        BONUS_FCFA_FILLEUL: 500                // Bonus FCFA filleul
    }
}
```

### Sécurité
```javascript
SECURITY: {
    MAX_LOGIN_ATTEMPTS: 5,                  // Tentatives max connexion
    LOCKOUT_DURATION: 15 * 60 * 1000,        // Durée blocage (15 min)
    SESSION_DURATION: 24 * 60 * 60 * 1000,   // Durée session (24h)
    REFRESH_TOKEN_DURATION: 7 * 24 * 60 * 60 * 1000, // Durée refresh token (7 jours)
    OTP_LENGTH: 6,                            // Longueur code OTP
    OTP_DURATION: 10 * 60 * 1000              // Durée validité OTP (10 min)
}
```

### Notifications
```javascript
NOTIFICATION: {
    TYPES: {
        COMMANDE: 'commande',                  // Notification commande
        LIVRAISON: 'livraison',                 // Notification livraison
        PROMOTION: 'promotion',                  // Notification promotion
        SECURITE: 'securite',                    // Notification sécurité
        SYSTEME: 'systeme',                       // Notification système
        MESSAGE: 'message'                         // Notification message
    },
    PRIORITES: {
        BASSE: 'basse',                           // Priorité basse
        NORMALE: 'normale',                        // Priorité normale
        HAUTE: 'haute',                             // Priorité haute
        CRITIQUE: 'critique'                         // Priorité critique
    }
}
```

### Devise
```javascript
DEVISE: {
    CODE: 'XOF',            // Code ISO devise (Franc CFA)
    SYMBOLE: 'CFA',          // Symbole
    FORMAT: 'fr-FR'          // Format localisation
}
```

## 🚀 Utilisation

### Import du module

```javascript
// Dans n'importe quel fichier
const constants = require('./configuration/constants');
```

### Utilisation des énumérations

```javascript
// Vérifier un rôle
function checkRole(role) {
    return constants.ENUMS.COMPTE_ROLE.includes(role);
}

// Utiliser une énumération dans un modèle Sequelize
const User = sequelize.define('User', {
    role: {
        type: DataTypes.ENUM(constants.ENUMS.COMPTE_ROLE),
        defaultValue: 'UTILISATEUR_PRIVE_SIMPLE'
    },
    status: {
        type: DataTypes.ENUM(constants.ENUMS.STATUT_COMPTE),
        defaultValue: 'NON_AUTHENTIFIE'
    }
});
```

### Gestion des rôles et permissions

```javascript
// Vérifier le niveau d'un rôle
const userLevel = constants.getRoleLevel(user.role);
const adminLevel = constants.getRoleLevel('ADMINISTRATEUR_PLATEFORME');

if (userLevel >= adminLevel) {
    // L'utilisateur a un niveau supérieur ou égal
}

// Vérifier les permissions
function canUser(user, action) {
    return constants.hasPermission(user.role, action);
}

// Middleware d'autorisation
function authorize(requiredPermission) {
    return (req, res, next) => {
        if (!constants.hasPermission(req.user.role, requiredPermission)) {
            return res.status(constants.HTTP_STATUS.FORBIDDEN).json({
                status: constants.STATUS.ERROR,
                message: 'Permission insuffisante'
            });
        }
        next();
    };
}

// Utilisation
app.post('/articles', 
    authorize('article:create'), 
    articleController.create
);
```

### Validation des données

```javascript
// Valider une catégorie de menu
function validateMenuCategory(category) {
    if (!constants.isValidEnum('CATEGORIES_MENU', category)) {
        throw new Error(`Catégorie invalide: ${category}`);
    }
}

// Valider un statut de commande
function validateOrderStatus(status) {
    return constants.isValidEnum('STATUT_COMMANDE', status);
}
```

### Pagination

```javascript
// Contrôleur avec pagination
async function getUsers(req, res) {
    const page = parseInt(req.query.page) || constants.CONFIG.PAGINATION.DEFAULT_PAGE;
    const limit = Math.min(
        parseInt(req.query.limit) || constants.CONFIG.PAGINATION.DEFAULT_LIMIT,
        constants.CONFIG.PAGINATION.MAX_LIMIT
    );
    
    const users = await User.findAndCountAll({
        offset: (page - 1) * limit,
        limit: limit
    });
    
    res.json({
        data: users.rows,
        pagination: {
            page,
            limit,
            total: users.count,
            pages: Math.ceil(users.count / limit)
        }
    });
}
```

### Validation des fichiers uploadés

```javascript
// Middleware de validation fichier
function validateImage(req, res, next) {
    const file = req.file;
    
    if (!file) {
        return next();
    }
    
    // Vérifier taille
    if (file.size > constants.CONFIG.UPLOAD.MAX_IMAGE_SIZE) {
        return res.status(constants.HTTP_STATUS.BAD_REQUEST).json({
            status: constants.STATUS.ERROR,
            message: `Image trop grande. Maximum: ${constants.CONFIG.UPLOAD.MAX_IMAGE_SIZE / 1024 / 1024}MB`
        });
    }
    
    // Vérifier type MIME
    if (!constants.CONFIG.UPLOAD.ALLOWED_IMAGES.includes(file.mimetype)) {
        return res.status(constants.HTTP_STATUS.BAD_REQUEST).json({
            status: constants.STATUS.ERROR,
            message: 'Format d\'image non supporté'
        });
    }
    
    next();
}
```

### Calcul des points de fidélité

```javascript
// Service de fidélité
class FideliteService {
    calculatePoints(montant) {
        const { POINTS_PAR_TRANCHE, MONTANT_TRANCHE } = constants.CONFIG.FIDELITE;
        return Math.floor(montant / MONTANT_TRANCHE) * POINTS_PAR_TRANCHE;
    }
    
    calculateValeurPoints(points) {
        return points * constants.CONFIG.FIDELITE.VALEUR_POINT;
    }
    
    async processParrainage(parrainId, filleulId) {
        const { PARRAINAGE } = constants.CONFIG.FIDELITE;
        
        await Promise.all([
            // Points pour le parrain
            this.addPoints(parrainId, PARRAINAGE.POINTS_PARRAIN),
            // Points pour le filleul
            this.addPoints(filleulId, PARRAINAGE.POINTS_FILLEUL),
            // Bonus FCFA parrain
            this.addBonus(parrainId, PARRAINAGE.BONUS_FCFA_PARRAIN),
            // Bonus FCFA filleul
            this.addBonus(filleulId, PARRAINAGE.BONUS_FCFA_FILLEUL)
        ]);
    }
}
```

### Gestion des notifications

```javascript
// Service de notification
class NotificationService {
    async sendOrderNotification(userId, orderData) {
        const notification = {
            type: constants.CONFIG.NOTIFICATION.TYPES.COMMANDE,
            priority: constants.CONFIG.NOTIFICATION.PRIORITES.HAUTE,
            channels: [
                constants.ENUMS.CANAL_NOTIFICATION.IN_APP,
                constants.ENUMS.CANAL_NOTIFICATION.PUSH_MOBILE
            ],
            data: orderData
        };
        
        await this.send(userId, notification);
    }
    
    async sendSecurityAlert(userId, alertData) {
        const notification = {
            type: constants.CONFIG.NOTIFICATION.TYPES.SECURITE,
            priority: constants.CONFIG.NOTIFICATION.PRIORITES.CRITIQUE,
            channels: [
                constants.ENUMS.CANAL_NOTIFICATION.EMAIL,
                constants.ENUMS.CANAL_NOTIFICATION.SMS
            ],
            data: alertData
        };
        
        await this.send(userId, notification);
    }
}
```

### Sécurité et authentification

```javascript
// Middleware de rate limiting
const loginAttempts = new Map();

function checkLoginAttempts(req, res, next) {
    const ip = req.ip;
    const attempts = loginAttempts.get(ip) || { count: 0, lastAttempt: null };
    
    if (attempts.count >= constants.CONFIG.SECURITY.MAX_LOGIN_ATTEMPTS) {
        const timeSinceLast = Date.now() - attempts.lastAttempt;
        
        if (timeSinceLast < constants.CONFIG.SECURITY.LOCKOUT_DURATION) {
            return res.status(constants.HTTP_STATUS.TOO_MANY_REQUESTS).json({
                status: constants.STATUS.ERROR,
                message: 'Trop de tentatives. Réessayez plus tard.'
            });
        } else {
            // Réinitialiser après la durée de blocage
            loginAttempts.set(ip, { count: 0, lastAttempt: null });
        }
    }
    
    next();
}

// Génération OTP
function generateOTP() {
    const length = constants.CONFIG.SECURITY.OTP_LENGTH;
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
```

## 🧪 Tests

### Tests unitaires

```javascript
// tests/constants.test.js
const constants = require('../src/configuration/constants');

describe('Constants', () => {
    test('ENUMS should be defined', () => {
        expect(constants.ENUMS).toBeDefined();
        expect(constants.ENUMS.COMPTE_ROLE).toBeInstanceOf(Array);
        expect(constants.ENUMS.COMPTE_ROLE.length).toBeGreaterThan(0);
    });

    test('isValidEnum should validate correctly', () => {
        expect(constants.isValidEnum('COMPTE_ROLE', 'ADMINISTRATEUR_PLATEFORME')).toBe(true);
        expect(constants.isValidEnum('COMPTE_ROLE', 'INVALID_ROLE')).toBe(false);
    });

    test('ROLES_HIERARCHY should have correct levels', () => {
        expect(constants.getRoleLevel('UTILISATEUR_PRIVE_SIMPLE')).toBe(1);
        expect(constants.getRoleLevel('ADMINISTRATEUR_PLATEFORME')).toBe(8);
        expect(constants.getRoleLevel('INVALID_ROLE')).toBe(0);
    });

    test('PERMISSIONS should be correctly assigned', () => {
        expect(constants.hasPermission('UTILISATEUR_PRIVE_SIMPLE', 'profile:read')).toBe(true);
        expect(constants.hasPermission('UTILISATEUR_PRIVE_SIMPLE', 'article:create')).toBe(false);
        expect(constants.hasPermission('ADMINISTRATEUR_PLATEFORME', 'any:permission')).toBe(true);
    });

    test('HTTP_STATUS should have standard codes', () => {
        expect(constants.HTTP_STATUS.OK).toBe(200);
        expect(constants.HTTP_STATUS.NOT_FOUND).toBe(404);
        expect(constants.HTTP_STATUS.INTERNAL_SERVER_ERROR).toBe(500);
    });

    test('CONFIG should have all sections', () => {
        expect(constants.CONFIG.PAGINATION).toBeDefined();
        expect(constants.CONFIG.UPLOAD).toBeDefined();
        expect(constants.CONFIG.CACHE).toBeDefined();
        expect(constants.CONFIG.VALIDATION).toBeDefined();
        expect(constants.CONFIG.FIDELITE).toBeDefined();
        expect(constants.CONFIG.SECURITY).toBeDefined();
        expect(constants.CONFIG.DEVISE).toBeDefined();
    });

    test('getAll should return complete object', () => {
        const all = constants.getAll();
        expect(all).toHaveProperty('ENUMS');
        expect(all).toHaveProperty('ROLES_HIERARCHY');
        expect(all).toHaveProperty('PERMISSIONS');
        expect(all).toHaveProperty('STATUS');
        expect(all).toHaveProperty('HTTP_STATUS');
        expect(all).toHaveProperty('CONFIG');
    });
});
```

## 🔒 Bonnes pratiques

### Utilisation dans les modèles Sequelize

```javascript
// models/User.js
const constants = require('../configuration/constants');

module.exports = (sequelize, DataTypes) => {
    const User = sequelize.define('User', {
        email: {
            type: DataTypes.STRING,
            validate: {
                is: constants.CONFIG.VALIDATION.EMAIL_REGEX
            }
        },
        phone: {
            type: DataTypes.STRING,
            validate: {
                is: constants.CONFIG.VALIDATION.PHONE_REGEX
            }
        },
        role: {
            type: DataTypes.ENUM(constants.ENUMS.COMPTE_ROLE),
            defaultValue: 'UTILISATEUR_PRIVE_SIMPLE'
        },
        status: {
            type: DataTypes.ENUM(constants.ENUMS.STATUT_COMPTE),
            defaultValue: 'NON_AUTHENTIFIE'
        }
    });

    User.prototype.hasPermission = function(permission) {
        return constants.hasPermission(this.role, permission);
    };

    return User;
};
```

### Validation des données entrantes

```javascript
// middleware/validation.js
const constants = require('../configuration/constants');
const Joi = require('joi');

function validateOrder(req, res, next) {
    const schema = Joi.object({
        status: Joi.string().valid(...constants.ENUMS.STATUT_COMMANDE),
        items: Joi.array().items(
            Joi.object({
                category: Joi.string().valid(...constants.ENUMS.CATEGORIES_MENU)
            })
        )
    });

    const { error } = schema.validate(req.body);
    
    if (error) {
        return res.status(constants.HTTP_STATUS.BAD_REQUEST).json({
            status: constants.STATUS.ERROR,
            message: error.message
        });
    }
    
    next();
}
```

### Gestion des réponses API

```javascript
// utils/response.js
const constants = require('../configuration/constants');

class ApiResponse {
    static success(data, message = 'Opération réussie') {
        return {
            status: constants.STATUS.SUCCESS,
            message,
            data
        };
    }

    static error(message, code = constants.HTTP_STATUS.BAD_REQUEST) {
        return {
            status: constants.STATUS.ERROR,
            message,
            code
        };
    }

    static notFound(resource = 'Ressource') {
        return this.error(
            `${resource} non trouvée`,
            constants.HTTP_STATUS.NOT_FOUND
        );
    }

    static unauthorized(message = 'Non authentifié') {
        return this.error(message, constants.HTTP_STATUS.UNAUTHORIZED);
    }

    static forbidden(message = 'Accès interdit') {
        return this.error(message, constants.HTTP_STATUS.FORBIDDEN);
    }
}
```

### Internationalisation

```javascript
// i18n/fr.js
const constants = require('../configuration/constants');

const translations = {
    roles: {
        [constants.ENUMS.COMPTE_ROLE[0]]: 'Administrateur Plateforme',
        [constants.ENUMS.COMPTE_ROLE[1]]: 'Blogueur Plateforme',
        [constants.ENUMS.COMPTE_ROLE[2]]: 'Staff Plateforme',
        // ...
    },
    status: {
        [constants.ENUMS.STATUT_COMMANDE[0]]: 'En attente',
        [constants.ENUMS.STATUT_COMMANDE[1]]: 'Confirmée',
        [constants.ENUMS.STATUT_COMMANDE[2]]: 'En préparation',
        // ...
    }
};

function translateRole(role) {
    return translations.roles[role] || role;
}
```

## 📈 Maintenance et évolution

### Ajout d'une nouvelle énumération

```javascript
// Dans initEnums()
initEnums() {
    this.ENUMS = {
        // ... énumérations existantes
        
        // Nouvelle énumération
        TYPE_ABONNEMENT: [
            'GRATUIT',
            'BASIC',
            'PREMIUM',
            'ENTREPRISE'
        ]
    };
}
```

### Ajout d'un nouveau rôle

```javascript
// Mettre à jour les trois sections
initEnums() {
    this.ENUMS.COMPTE_ROLE.push('NOUVEAU_ROLE');
}

initRoles() {
    this.ROLES_HIERARCHY['NOUVEAU_ROLE'] = 9;
}

initPermissions() {
    this.PERMISSIONS['NOUVEAU_ROLE'] = [
        'permission1',
        'permission2'
    ];
}
```

## 🆘 Dépannage

### Problèmes courants

1. **Énumération non trouvée**
```javascript
// Erreur: Cannot read property 'includes' of undefined
// Solution: Vérifier le nom de l'énumération
if (constants.ENUMS.hasOwnProperty('COMPTE_ROLE')) {
    // Utiliser
}
```

2. **Permission non reconnue**
```javascript
// Vérifier les permissions disponibles
function debugPermissions(role) {
    console.log(`Permissions pour ${role}:`, constants.PERMISSIONS[role]);
    console.log(`Niveau:`, constants.getRoleLevel(role));
}
```

3. **Valeur par défaut manquante**
```javascript
// Toujours utiliser les constantes pour les valeurs par défaut
const role = user.role || 'UTILISATEUR_PRIVE_SIMPLE';
// ✅ Bon
const role = user.role || constants.ENUMS.COMPTE_ROLE[13]; // UTILISATEUR_PRIVE_SIMPLE
// ❌ Risqué (si l'ordre change)
```

## 📚 API Reference

### Propriétés

| Propriété | Type | Description |
|-----------|------|-------------|
| `ENUMS` | Object | Toutes les énumérations |
| `ROLES_HIERARCHY` | Object | Hiérarchie des rôles |
| `PERMISSIONS` | Object | Permissions par rôle |
| `STATUS` | Object | Statuts génériques |
| `HTTP_STATUS` | Object | Codes HTTP |
| `CONFIG` | Object | Configuration globale |

### Méthodes

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `getAll()` | - | Object | Toutes les constantes |
| `isValidEnum(enumName, value)` | `string, any` | boolean | Valide une énumération |
| `getRoleLevel(role)` | `string` | number | Niveau hiérarchique |
| `hasPermission(role, permission)` | `string, string` | boolean | Vérifie permission |

## 🎯 Conclusion

Ce module de constantes offre une source unique de vérité pour toute l'application avec :

- ✅ **Énumérations complètes** correspondant aux types PostgreSQL
- ✅ **Hiérarchie des rôles** claire et extensible
- ✅ **Permissions granulaires** par rôle
- ✅ **Codes HTTP** standardisés
- ✅ **Configuration centralisée** (pagination, upload, sécurité, etc.)
- ✅ **Validation** des valeurs d'énumération
- ✅ **Vérification des permissions** simple et efficace
- ✅ **Documentation exhaustive**

Il garantit la cohérence des données à travers toute l'application et facilite la maintenance à long terme.
```