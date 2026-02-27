// src/configuration/constants.js
class Constants {
    constructor() {
        this.initEnums();
        this.initRoles();
        this.initPermissions();
        this.initStatus();
        this.initConfig();
    }

    /**
     * Initialiser les énumérations correspondant aux types PostgreSQL
     */
    initEnums() {
        this.ENUMS = {
            // Rôles des comptes
            COMPTE_ROLE: [
                'ADMINISTRATEUR_PLATEFORME',
                'BLOGUEUR_PLATEFORME',
                'STAFF_PLATEFORME',
                'ADMINISTRATEUR_COMPAGNIE',
                'STAFF_COMPAGNIE',
                'BLOGUEUR_COMPAGNIE',
                'ADMINISTRATEUR_EMBRANCHEMENT_COMPAGNIE',
                'STAFF_EMBRANCHEMENT_COMPAGNIE',
                'BLOGUEUR_EMBRANCHEMENT_COMPAGNIE',
                'ADMINISTRATEUR_RESTAURANT_FAST_FOOD',
                'STAFF_RESTAURANT_FAST_FOOD',
                'BLOGUEUR_RESTAURANT_FAST_FOOD',
                'UTILISATEUR_PRIVE_SIMPLE',
                'UTILISATEUR_VENDEUR'
            ],

            // Statuts des comptes
            STATUT_COMPTE: [
                'EST_AUTHENTIFIE',
                'NON_AUTHENTIFIE',
                'SUSPENDU',
                'BANNI'
            ],

            // Jours d'ouverture
            JOURS_OUVERTURE: [
                'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI',
                'SAMEDI', 'DIMANCHE',
                'TOUS_LES_JOURS',
                'LUNDI_VENDREDI',
                'LUNDI_SAMEDI',
                'LUNDI_DIMANCHE'
            ],

            // Catégories de menus
            CATEGORIES_MENU: [
                'PETIT_DEJEUNER', 'ENTREE', 'PLAT_PRINCIPAL', 'DESSERT', 'BOISSON',
                'MENU_ENFANT', 'MENU_PROMO', 'MENU_DU_JOUR', 'FORMULE_MIDI', 'FORMULE_SOIR',
                'ACCOMPAGNEMENT', 'SAUCE', 'SALADE', 'SOUPE', 'SANDWICH',
                'BURGER', 'PIZZA', 'KEBAB', 'TACOS', 'SUSHI',
                'WRAP', 'BOWL', 'PASTA', 'SALADE_COMPOSEE',
                'PLAT_AFRICAIN', 'PLAT_ASIATIQUE', 'PLAT_ITALIEN', 'PLAT_AMERICAIN'
            ],

            // Catégories de produits
            CATEGORIES_PRODUITS: [
                'ALIMENTAIRE', 'BOISSON', 'HYGIENE', 'ELECTRONIQUE', 'VETEMENT',
                'ACCESSOIRE', 'MAISON', 'SPORT', 'BEAUTE', 'LIVRE', 'JOUET', 'AUTRE'
            ],

            // Types de promotions
            TYPES_PROMO: [
                'POURCENTAGE', 'MONTANT_FIXE', 'DEUX_POUR_UN',
                'LIVRAISON_GRATUITE', 'MENU_OFFERT', 'CODE_PROMO', 'FIDELITE'
            ],

            // Types de service livraison
            TYPES_SERVICE_LIVRAISON: [
                'STANDARD', 'EXPRESS', 'PROGRAMMEE', 'NUIT', 'WEEKEND', 'INTERNATIONAL'
            ],

            // Types de connexion
            TYPES_CONNEXION: [
                'CONNEXION', 'DECONNEXION'
            ],

            // Statuts de connexion
            STATUTS_CONNEXION: [
                'SUCCESS', 'FAILED', 'BLOCKED'
            ],

            // Types de services transport
            TYPES_SERVICES_TRANSPORT: [
                'ABONNEMENT_MENSUEL', 'BIMENSUEL', 'TRIMESTRIEL', 'ANNUEL'
            ],

            // Statuts article
            STATUT_ARTICLE: [
                'BROUILLON', 'EN_ATTENTE_VALIDATION', 'PUBLIE',
                'PROGRAMME', 'ARCHIVE', 'SIGNALE', 'SUPPRIME'
            ],

            // Catégories article
            CATEGORIES_ARTICLE: [
                'ACTUALITE', 'TUTORIEL', 'ASTUCE', 'GUIDE', 'AVIS',
                'TEST_PRODUIT', 'COMPARAISON', 'PROMOTION', 'EVENEMENT',
                'INTERVIEW', 'DOSSIER', 'OPINION', 'TENDANCE', 'VIE_LOCALE',
                'TRANSPORT', 'RESTAURATION', 'BOUTIQUE', 'COMMUNAUTE'
            ],

            // Visibilité article
            VISIBILITE_ARTICLE: [
                'PUBLIC', 'ABONNES', 'PRIVE', 'EQUIPE'
            ],

            // Statuts commentaire
            STATUT_COMMENTAIRE: [
                'EN_ATTENTE', 'APPROUVE', 'REJETE', 'SIGNALE', 'SUPPRIME', 'MASQUE'
            ],

            // Types de conversation
            TYPE_CONVERSATION: [
                'DIRECT', 'GROUPE', 'SUPPORT', 'COMMANDE', 'LIVRAISON',
                'SERVICE_CLIENT', 'NOTIFICATION_ADMIN', 'ANNONCE_PLATEFORME',
                'SIGNALEMENT', 'RECLAMATION'
            ],

            // Rôles dans une conversation
            ROLE_CONVERSATION: [
                'ADMIN', 'MODERATEUR', 'PARTICIPANT', 'OBSERVATEUR', 'INVITE'
            ],

            // Statuts message
            STATUT_MESSAGE: [
                'ENVOYE', 'RECU', 'LU', 'MODIFIE', 'SUPPRIME', 'SIGNALE'
            ],

            // Types de pièce jointe
            TYPE_PIECE_JOINTE: [
                'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'LOCALISATION', 'CONTACT'
            ],

            // Statuts commande
            STATUT_COMMANDE: [
                'EN_ATTENTE', 'CONFIRMEE', 'EN_PREPARATION', 'PRETE',
                'EN_LIVRAISON', 'LIVREE', 'RECUPEREE', 'ANNULEE', 'REMBOURSEE'
            ],

            // Types d'entité de référence
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
            ],

            // Statuts avis
            STATUT_AVIS: [
                'EN_ATTENTE', 'PUBLIE', 'REJETE', 'SIGNALE', 'MASQUE'
            ],

            // Canaux de notification
            CANAL_NOTIFICATION: [
                'IN_APP', 'PUSH_MOBILE', 'EMAIL', 'SMS', 'WHATSAPP'
            ],

            // Priorités notification
            PRIORITE_NOTIFICATION: [
                'BASSE', 'NORMALE', 'HAUTE', 'CRITIQUE'
            ],

            // Types de document
            TYPE_DOCUMENT: [
                'CNI_RECTO', 'CNI_VERSO', 'PASSEPORT', 'PERMIS_CONDUIRE',
                'JUSTIFICATIF_DOMICILE', 'EXTRAIT_NAISSANCE', 'REGISTRE_COMMERCE',
                'ATTESTATION_FISCALE', 'CONTRAT', 'BON_COMMANDE', 'FACTURE',
                'RECU_PAIEMENT', 'PHOTO_LIVREUR', 'AUTRE'
            ],

            // Statuts document
            STATUT_DOCUMENT: [
                'EN_ATTENTE_VALIDATION', 'VALIDE', 'REFUSE', 'EXPIRE', 'REMPLACE'
            ],

            // Statuts tâche
            STATUT_TACHE: [
                'EN_ATTENTE', 'EN_COURS', 'COMPLETEE', 'ECHOUEE', 'ABANDONNEE'
            ],

            // Types de mouvement points
            TYPE_MOUVEMENT_POINTS: [
                'GAIN_ACHAT', 'GAIN_PARRAINAGE', 'GAIN_BONUS',
                'UTILISATION', 'EXPIRATION', 'CORRECTION_MANUELLE', 'TRANSFERT'
            ]
        };
    }

    /**
     * Initialiser la hiérarchie des rôles
     */
    initRoles() {
        this.ROLES_HIERARCHY = {
            'UTILISATEUR_PRIVE_SIMPLE': 1,
            'UTILISATEUR_VENDEUR': 2,
            'BLOGUEUR_COMPAGNIE': 3,
            'STAFF_COMPAGNIE': 4,
            'ADMINISTRATEUR_COMPAGNIE': 5,
            'BLOGUEUR_PLATEFORME': 6,
            'STAFF_PLATEFORME': 7,
            'ADMINISTRATEUR_PLATEFORME': 8
        };
    }

    /**
     * Initialiser les permissions par rôle
     */
    initPermissions() {
        this.PERMISSIONS = {
            'UTILISATEUR_PRIVE_SIMPLE': [
                'profile:read',
                'profile:update',
                'commande:create',
                'commande:read',
                'avis:create',
                'notification:read'
            ],
            'UTILISATEUR_VENDEUR': [
                'profile:read',
                'profile:update',
                'produit:create',
                'produit:update',
                'produit:read',
                'commande:read',
                'commande:update',
                'stats:read'
            ],
            'BLOGUEUR_COMPAGNIE': [
                'article:create',
                'article:update',
                'article:read',
                'commentaire:moderate',
                'stats:read'
            ],
            'STAFF_COMPAGNIE': [
                'compagnie:read',
                'compagnie:update',
                'employe:manage',
                'rapport:read',
                'commande:manage'
            ],
            'ADMINISTRATEUR_COMPAGNIE': [
                '*:compagnie' // Toutes les actions sur sa compagnie
            ],
            'BLOGUEUR_PLATEFORME': [
                'article:create',
                'article:update',
                'article:publish',
                'commentaire:moderate',
                'stats:global'
            ],
            'STAFF_PLATEFORME': [
                'user:manage',
                'commande:manage',
                'rapport:read',
                'stats:global',
                'moderation:all'
            ],
            'ADMINISTRATEUR_PLATEFORME': [
                '*' // Toutes les permissions
            ]
        };
    }

    /**
     * Initialiser les statuts
     */
    initStatus() {
        this.STATUS = {
            SUCCESS: 'success',
            ERROR: 'error',
            WARNING: 'warning',
            INFO: 'info'
        };

        this.HTTP_STATUS = {
            OK: 200,
            CREATED: 201,
            ACCEPTED: 202,
            NO_CONTENT: 204,
            BAD_REQUEST: 400,
            UNAUTHORIZED: 401,
            FORBIDDEN: 403,
            NOT_FOUND: 404,
            CONFLICT: 409,
            TOO_MANY_REQUESTS: 429,
            INTERNAL_SERVER_ERROR: 500,
            SERVICE_UNAVAILABLE: 503
        };
    }

    /**
     * Initialiser la configuration
     */
    initConfig() {
        this.CONFIG = {
            // Pagination
            PAGINATION: {
                DEFAULT_PAGE: 1,
                DEFAULT_LIMIT: 20,
                MAX_LIMIT: 100
            },

            // Upload
            UPLOAD: {
                MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
                MAX_IMAGE_SIZE: 2 * 1024 * 1024, // 2MB
                ALLOWED_IMAGES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
                ALLOWED_DOCUMENTS: [
                    'application/pdf',
                    'application/msword',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/vnd.ms-excel',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                ]
            },

            // Cache
            CACHE: {
                TTL: {
                    SHORT: 300, // 5 minutes
                    MEDIUM: 3600, // 1 heure
                    LONG: 86400 // 24 heures
                },
                KEYS: {
                    STATS: 'stats:',
                    CATALOG: 'catalog:',
                    USER: 'user:',
                    SESSION: 'session:'
                }
            },

            // Validation
            VALIDATION: {
                PASSWORD_MIN_LENGTH: 8,
                USERNAME_MIN_LENGTH: 3,
                USERNAME_MAX_LENGTH: 50,
                PHONE_REGEX: /^(\+226|0)[0-9]{8}$/,
                EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
            },

            // Points de fidélité
            FIDELITE: {
                POINTS_PAR_TRANCHE: 1,
                MONTANT_TRANCHE: 1000,
                VALEUR_POINT: 5,
                PARRAINAGE: {
                    POINTS_PARRAIN: 100,
                    POINTS_FILLEUL: 50,
                    BONUS_FCFA_PARRAIN: 1000,
                    BONUS_FCFA_FILLEUL: 500
                }
            },

            // Sécurité
            SECURITY: {
                MAX_LOGIN_ATTEMPTS: 5,
                LOCKOUT_DURATION: 15 * 60 * 1000, // 15 minutes
                SESSION_DURATION: 24 * 60 * 60 * 1000, // 24 heures
                REFRESH_TOKEN_DURATION: 7 * 24 * 60 * 60 * 1000, // 7 jours
                OTP_LENGTH: 6,
                OTP_DURATION: 10 * 60 * 1000 // 10 minutes
            },

            // Notifications
            NOTIFICATION: {
                TYPES: {
                    COMMANDE: 'commande',
                    LIVRAISON: 'livraison',
                    PROMOTION: 'promotion',
                    SECURITE: 'securite',
                    SYSTEME: 'systeme',
                    MESSAGE: 'message'
                },
                PRIORITES: {
                    BASSE: 'basse',
                    NORMALE: 'normale',
                    HAUTE: 'haute',
                    CRITIQUE: 'critique'
                }
            },

            // Devise
            DEVISE: {
                CODE: 'XOF',
                SYMBOLE: 'CFA',
                FORMAT: 'fr-FR'
            }
        };
    }

    /**
     * Obtenir toutes les constantes
     */
    getAll() {
        return {
            ENUMS: this.ENUMS,
            ROLES_HIERARCHY: this.ROLES_HIERARCHY,
            PERMISSIONS: this.PERMISSIONS,
            STATUS: this.STATUS,
            HTTP_STATUS: this.HTTP_STATUS,
            CONFIG: this.CONFIG
        };
    }

    /**
     * Vérifier si une valeur est dans une énumération
     */
    isValidEnum(enumName, value) {
        return this.ENUMS[enumName]?.includes(value) || false;
    }

    /**
     * Obtenir le niveau d'un rôle
     */
    getRoleLevel(role) {
        return this.ROLES_HIERARCHY[role] || 0;
    }

    /**
     * Vérifier si un rôle a une permission
     */
    hasPermission(role, permission) {
        const permissions = this.PERMISSIONS[role] || [];
        return permissions.includes('*') || permissions.includes(permission);
    }
}

module.exports = new Constants();