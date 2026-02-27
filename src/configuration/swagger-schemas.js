/**
 * Schémas Swagger générés à partir de la structure PostgreSQL
 */

const schemas = {
    // Enums
    CompteRole: {
        type: 'string',
        enum: [
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
        ]
    },

    StatutCompte: {
        type: 'string',
        enum: ['EST_AUTHENTIFIE', 'NON_AUTHENTIFIE', 'SUSPENDU', 'BANNI']
    },

    JoursOuverture: {
        type: 'string',
        enum: [
            'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI',
            'SAMEDI', 'DIMANCHE', 'TOUS_LES_JOURS',
            'LUNDI_VENDREDI', 'LUNDI_SAMEDI', 'LUNDI_DIMANCHE'
        ]
    },

    CategoriesMenu: {
        type: 'string',
        enum: [
            'PETIT_DEJEUNER', 'ENTREE', 'PLAT_PRINCIPAL', 'DESSERT', 'BOISSON',
            'MENU_ENFANT', 'MENU_PROMO', 'MENU_DU_JOUR', 'FORMULE_MIDI', 'FORMULE_SOIR',
            'ACCOMPAGNEMENT', 'SAUCE', 'SALADE', 'SOUPE', 'SANDWICH',
            'BURGER', 'PIZZA', 'KEBAB', 'TACOS', 'SUSHI',
            'WRAP', 'BOWL', 'PASTA', 'SALADE_COMPOSEE',
            'PLAT_AFRICAIN', 'PLAT_ASIATIQUE', 'PLAT_ITALIEN', 'PLAT_AMERICAIN'
        ]
    },

    CategoriesProduits: {
        type: 'string',
        enum: [
            'ALIMENTAIRE', 'BOISSON', 'HYGIENE', 'ELECTRONIQUE', 'VETEMENT',
            'ACCESSOIRE', 'MAISON', 'SPORT', 'BEAUTE', 'LIVRE', 'JOUET', 'AUTRE'
        ]
    },

    TypesPromo: {
        type: 'string',
        enum: [
            'POURCENTAGE', 'MONTANT_FIXE', 'DEUX_POUR_UN',
            'LIVRAISON_GRATUITE', 'MENU_OFFERT', 'CODE_PROMO', 'FIDELITE'
        ]
    },

    StatutCommande: {
        type: 'string',
        enum: [
            'EN_ATTENTE', 'CONFIRMEE', 'EN_PREPARATION', 'PRETE',
            'EN_LIVRAISON', 'LIVREE', 'RECUPEREE', 'ANNULEE', 'REMBOURSEE'
        ]
    },

    EntiteReference: {
        type: 'string',
        enum: [
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
    },

    TypeConversation: {
        type: 'string',
        enum: [
            'DIRECT', 'GROUPE', 'SUPPORT', 'COMMANDE', 'LIVRAISON',
            'SERVICE_CLIENT', 'NOTIFICATION_ADMIN', 'ANNONCE_PLATEFORME',
            'SIGNALEMENT', 'RECLAMATION'
        ]
    },

    RoleConversation: {
        type: 'string',
        enum: ['ADMIN', 'MODERATEUR', 'PARTICIPANT', 'OBSERVATEUR', 'INVITE']
    },

    StatutMessage: {
        type: 'string',
        enum: ['ENVOYE', 'RECU', 'LU', 'MODIFIE', 'SUPPRIME', 'SIGNALE']
    },

    // Objets principaux
    Plateforme: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            nom_plateforme: { type: 'string', example: 'KlikUp' },
            description_plateforme: { type: 'string', example: 'Plateforme multi-services' },
            logo_plateforme: { type: 'string', example: '/uploads/logo.png' },
            portefeuille_plateforme: { type: 'number', format: 'float', example: 1000000 },
            date_creation: { type: 'string', format: 'date-time' }
        }
    },

    CompagnieTransport: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            nom_compagnie: { type: 'string', example: 'Transport Express' },
            description_compagnie: { type: 'string', example: 'Compagnie de transport urbain' },
            logo_compagnie: { type: 'string', example: '/uploads/compagnies/logo.png' },
            pourcentage_commission_plateforme: { type: 'number', example: 10.5 },
            portefeuille_compagnie: { type: 'number', example: 500000 },
            est_actif: { type: 'boolean', example: true }
        }
    },

    EmplacementTransport: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            nom_emplacement: { type: 'string', example: 'Gare Routière' },
            localisation_emplacement: {
                type: 'object',
                properties: {
                    type: { type: 'string', example: 'Point' },
                    coordinates: { type: 'array', items: { type: 'number' }, example: [-1.516, 12.371] }
                }
            },
            jours_ouverture: { $ref: '#/components/schemas/JoursOuverture' },
            est_actif: { type: 'boolean', example: true }
        }
    },

    Compte: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            email: { type: 'string', format: 'email', example: 'user@example.com' },
            nom_utilisateur_compte: { type: 'string', example: 'jean_dupont' },
            numero_de_telephone: { type: 'string', example: '+22670123456' },
            photo_profil_compte: { type: 'string', example: '/uploads/avatars/user1.jpg' },
            statut: { $ref: '#/components/schemas/StatutCompte' },
            compte_role: { $ref: '#/components/schemas/CompteRole' },
            date_creation: { type: 'string', format: 'date-time' }
        }
    },

    TicketTransport: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            nom_produit: { type: 'string', example: 'Ticket Journalier' },
            description_produit: { type: 'string', example: 'Ticket valable 24h' },
            prix_vente_produit: { type: 'number', example: 1500 },
            quantite_stock: { type: 'integer', example: 100 },
            quantite_vendu: { type: 'integer', example: 45 },
            journalier: { type: 'boolean', example: true },
            hebdomadaire: { type: 'boolean', example: false },
            mensuel: { type: 'boolean', example: false },
            actif: { type: 'boolean', example: true }
        }
    },

    RestaurantFastFood: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            nom_restaurant_fast_food: { type: 'string', example: 'Burger House' },
            description_restaurant_fast_food: { type: 'string', example: 'Restaurant de burgers' },
            logo_restaurant: { type: 'string', example: '/uploads/restaurants/logo.png' },
            pourcentage_commission_plateforme: { type: 'number', example: 15 },
            portefeuille_restaurant_fast_food: { type: 'number', example: 250000 },
            est_actif: { type: 'boolean', example: true }
        }
    },

    EmplacementRestaurant: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            nom_emplacement: { type: 'string', example: 'Burger House Centre' },
            localisation_restaurant: {
                type: 'object',
                properties: {
                    type: { type: 'string', example: 'Point' },
                    coordinates: { type: 'array', items: { type: 'number' }, example: [-1.516, 12.371] }
                }
            },
            adresse_complete: { type: 'string', example: '123 Avenue Kwamé Nkrumah' },
            frais_livraison: { type: 'number', example: 500 },
            heure_ouverture: { type: 'string', format: 'time', example: '08:00' },
            heure_fermeture: { type: 'string', format: 'time', example: '22:00' },
            jours_ouverture: { $ref: '#/components/schemas/JoursOuverture' }
        }
    },

    MenuRestaurant: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            nom_menu: { type: 'string', example: 'Menu Royal' },
            description_menu: { type: 'string', example: 'Burger, frites, boisson' },
            photo_menu: { type: 'string', example: '/uploads/menus/menu1.jpg' },
            prix_menu: { type: 'number', example: 3500 },
            temps_preparation_min: { type: 'integer', example: 15 },
            stock_disponible: { type: 'integer', example: 50 },
            categorie_menu: { $ref: '#/components/schemas/CategoriesMenu' },
            disponible: { type: 'boolean', example: true }
        }
    },

    ProduitIndividuelRestaurant: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            nom_produit: { type: 'string', example: 'Double Burger' },
            description_produit: { type: 'string', example: 'Burger avec deux steaks' },
            photo_produit: { type: 'string', example: '/uploads/produits/burger.jpg' },
            prix_produit: { type: 'number', example: 2500 },
            stock_disponible: { type: 'integer', example: 100 },
            categorie_produit: { $ref: '#/components/schemas/CategoriesProduits' },
            disponible: { type: 'boolean', example: true }
        }
    },

    Promo: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            nom_promo: { type: 'string', example: 'Promo Rentrée' },
            code_promo: { type: 'string', example: 'RENTREE2026' },
            type_promo: { $ref: '#/components/schemas/TypesPromo' },
            pourcentage_reduction: { type: 'number', example: 20 },
            montant_fixe_reduction: { type: 'number', example: 1000 },
            date_debut: { type: 'string', format: 'date-time' },
            date_fin: { type: 'string', format: 'date-time' },
            utilisation_max: { type: 'integer', example: 100 },
            utilisation_count: { type: 'integer', example: 45 },
            actif: { type: 'boolean', example: true }
        }
    },

    CommandeRestaurant: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            reference_commande: { type: 'string', example: 'CMD-RFF-20260226-000001' },
            donnees_commande: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        menu_id: { type: 'integer' },
                        produit_id: { type: 'integer' },
                        quantite: { type: 'integer' },
                        prix_unitaire: { type: 'number' }
                    }
                }
            },
            prix_sous_total: { type: 'number', example: 6000 },
            frais_livraison_commande: { type: 'number', example: 500 },
            remise_appliquee: { type: 'number', example: 500 },
            prix_total_commande: { type: 'number', example: 6000 },
            statut_commande: { $ref: '#/components/schemas/StatutCommande' },
            pour_livrer: { type: 'boolean', example: true },
            date_commande: { type: 'string', format: 'date-time' }
        }
    },

    Boutique: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            nom_boutique: { type: 'string', example: 'Super Marché' },
            description_boutique: { type: 'string', example: 'Boutique en ligne' },
            logo_boutique: { type: 'string', example: '/uploads/boutiques/logo.png' },
            types_produits_vendu: {
                type: 'array',
                items: { $ref: '#/components/schemas/CategoriesProduits' }
            },
            pourcentage_commission_plateforme: { type: 'number', example: 12 },
            portefeuille_boutique: { type: 'number', example: 150000 },
            est_actif: { type: 'boolean', example: true }
        }
    },

    CategorieBoutique: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            nom_categorie: { type: 'string', example: 'Électronique' },
            description_categorie: { type: 'string', example: 'Produits électroniques' },
            slug_categorie: { type: 'string', example: 'electronique' },
            ordre_affichage: { type: 'integer', example: 1 },
            est_actif: { type: 'boolean', example: true }
        }
    },

    ProduitBoutique: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            nom_produit: { type: 'string', example: 'Smartphone XYZ' },
            slug_produit: { type: 'string', example: 'smartphone-xyz' },
            image_produit: { type: 'string', example: '/uploads/produits/phone.jpg' },
            images_produit: {
                type: 'array',
                items: { type: 'string' }
            },
            description_produit: { type: 'string', example: 'Dernier modèle' },
            prix_unitaire_produit: { type: 'number', example: 150000 },
            prix_promo: { type: 'number', example: 135000 },
            quantite: { type: 'integer', example: 50 },
            est_disponible: { type: 'boolean', example: true }
        }
    },

    CommandeBoutique: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            reference_commande: { type: 'string', example: 'CMD-BTQ-20260226-000001' },
            donnees_commandes: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        produit_id: { type: 'integer' },
                        quantite: { type: 'integer' },
                        prix_unitaire: { type: 'number' }
                    }
                }
            },
            prix_sous_total: { type: 'number', example: 150000 },
            frais_livraison_commande: { type: 'number', example: 1000 },
            remise_appliquee: { type: 'number', example: 15000 },
            prix_total_commande: { type: 'number', example: 136000 },
            statut_commande: { $ref: '#/components/schemas/StatutCommande' },
            pour_livrer: { type: 'boolean', example: true },
            date_commande: { type: 'string', format: 'date-time' }
        }
    },

    Livreur: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            nom_livreur: { type: 'string', example: 'Traoré' },
            prenom_livreur: { type: 'string', example: 'Moussa' },
            photo_livreur: { type: 'string', example: '/uploads/livreurs/photo.jpg' },
            numero_telephone_livreur: { type: 'string', example: '+22671234567' },
            est_disponible: { type: 'boolean', example: true },
            note_moyenne: { type: 'number', example: 4.5 },
            nombre_livraisons: { type: 'integer', example: 150 }
        }
    },

    DemandeLivraison: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            details_livraison: {
                type: 'object',
                properties: {
                    adresse_depart: { type: 'string' },
                    adresse_arrivee: { type: 'string' },
                    instructions: { type: 'string' }
                }
            },
            est_effectue: { type: 'boolean', example: false },
            commission: { type: 'number', example: 500 },
            statut_livraison: { $ref: '#/components/schemas/StatutCommande' },
            date_livraison_prevue: { type: 'string', format: 'date-time' }
        }
    },

    ArticleBlog: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            titre_article: { type: 'string', example: 'Les meilleurs restaurants' },
            slug: { type: 'string', example: 'meilleurs-restaurants-2026' },
            contenu_article: { type: 'string', example: 'Contenu de l article...' },
            extrait_contenu: { type: 'string', example: 'Découvrez notre sélection...' },
            image_principale: { type: 'string', example: '/uploads/articles/main.jpg' },
            categorie_principale: {
                type: 'string',
                enum: ['ACTUALITE', 'TUTORIEL', 'GUIDE', 'AVIS', 'PROMOTION']
            },
            statut: {
                type: 'string',
                enum: ['BROUILLON', 'EN_ATTENTE_VALIDATION', 'PUBLIE', 'ARCHIVE']
            },
            nombre_vues: { type: 'integer', example: 1250 },
            nombre_likes: { type: 'integer', example: 45 },
            nombre_commentaires: { type: 'integer', example: 12 },
            date_publication: { type: 'string', format: 'date-time' }
        }
    },

    Commentaire: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            contenu_commentaire: { type: 'string', example: 'Excellent article !' },
            statut: {
                type: 'string',
                enum: ['EN_ATTENTE', 'APPROUVE', 'REJETE', 'SIGNALE']
            },
            est_anonyme: { type: 'boolean', example: false },
            note: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
            nombre_likes: { type: 'integer', example: 5 },
            date_creation: { type: 'string', format: 'date-time' }
        }
    },

    Conversation: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            uuid_conversation: { type: 'string', format: 'uuid' },
            type_conversation: { $ref: '#/components/schemas/TypeConversation' },
            titre_conversation: { type: 'string', example: 'Support Client' },
            est_prive: { type: 'boolean', example: true },
            nombre_participants: { type: 'integer', example: 2 },
            nombre_messages: { type: 'integer', example: 45 },
            date_dernier_message: { type: 'string', format: 'date-time' }
        }
    },

    Message: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            uuid_message: { type: 'string', format: 'uuid' },
            contenu_message: { type: 'string', example: 'Bonjour, comment puis-je vous aider ?' },
            type_message: {
                type: 'string',
                enum: ['TEXTE', 'IMAGE', 'VIDEO', 'AUDIO', 'FICHIER', 'SYSTEME']
            },
            statut: { $ref: '#/components/schemas/StatutMessage' },
            est_important: { type: 'boolean', example: false },
            date_envoi: { type: 'string', format: 'date-time' }
        }
    },

    PieceJointe: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            uuid_fichier: { type: 'string', format: 'uuid' },
            nom_fichier: { type: 'string', example: 'document.pdf' },
            type_fichier: {
                type: 'string',
                enum: ['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'LOCALISATION']
            },
            taille_fichier: { type: 'integer', example: 1048576 },
            url_telechargement: { type: 'string', example: '/uploads/messages/doc.pdf' }
        }
    },

    Avis: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            entite_type: { $ref: '#/components/schemas/EntiteReference' },
            entite_id: { type: 'integer', example: 1 },
            note_globale: { type: 'integer', minimum: 1, maximum: 5, example: 4 },
            note_qualite: { type: 'integer', minimum: 1, maximum: 5, example: 4 },
            note_service: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
            titre: { type: 'string', example: 'Très satisfait' },
            contenu: { type: 'string', example: 'Service rapide et efficace' },
            photos_avis: { type: 'array', items: { type: 'string' } },
            statut: {
                type: 'string',
                enum: ['EN_ATTENTE', 'PUBLIE', 'REJETE', 'SIGNALE', 'MASQUE']
            },
            est_achat_verifie: { type: 'boolean', example: true },
            nombre_utile: { type: 'integer', example: 5 },
            date_creation: { type: 'string', format: 'date-time' }
        }
    },

    Document: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            uuid_document: { type: 'string', format: 'uuid' },
            type_document: {
                type: 'string',
                enum: ['CNI_RECTO', 'CNI_VERSO', 'PASSEPORT', 'PERMIS_CONDUIRE', 'JUSTIFICATIF_DOMICILE', 'FACTURE']
            },
            nom_fichier: { type: 'string', example: 'cni_recto.jpg' },
            chemin_fichier: { type: 'string', example: '/uploads/documents/cni.jpg' },
            entite_type: { $ref: '#/components/schemas/EntiteReference' },
            entite_id: { type: 'integer', example: 1 },
            numero_document: { type: 'string', example: 'B12345678' },
            date_expiration: { type: 'string', format: 'date', example: '2030-12-31' },
            statut: {
                type: 'string',
                enum: ['EN_ATTENTE_VALIDATION', 'VALIDE', 'REFUSE', 'EXPIRE']
            }
        }
    },

    Notification: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            uuid_notification: { type: 'string', format: 'uuid' },
            titre: { type: 'string', example: 'Commande confirmée' },
            corps: { type: 'string', example: 'Votre commande #123 a été confirmée' },
            action_url: { type: 'string', example: '/commandes/123' },
            canal: {
                type: 'string',
                enum: ['IN_APP', 'PUSH_MOBILE', 'EMAIL', 'SMS', 'WHATSAPP']
            },
            priorite: {
                type: 'string',
                enum: ['BASSE', 'NORMALE', 'HAUTE', 'CRITIQUE']
            },
            est_lue: { type: 'boolean', example: false },
            date_creation: { type: 'string', format: 'date-time' }
        }
    },

    ProgrammeFidelite: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            entite_type: { $ref: '#/components/schemas/EntiteReference' },
            entite_id: { type: 'integer', example: 1 },
            nom_programme: { type: 'string', example: 'Fidélité Plus' },
            points_par_tranche: { type: 'integer', example: 1 },
            montant_tranche: { type: 'number', example: 1000 },
            valeur_point_fcfa: { type: 'number', example: 5 },
            est_actif: { type: 'boolean', example: true }
        }
    },

    SoldeFidelite: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            points_actuels: { type: 'integer', example: 150 },
            points_cumules: { type: 'integer', example: 1250 },
            niveau_actuel: { type: 'string', example: 'GOLD' }
        }
    },

    // Requêtes et réponses
    LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
            email: { type: 'string', format: 'email', example: 'user@example.com' },
            password: { type: 'string', format: 'password', example: 'Password123!' }
        }
    },

    LoginResponse: {
        type: 'object',
        properties: {
            success: { type: 'boolean', example: true },
            data: {
                type: 'object',
                properties: {
                    accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
                    refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
                    user: { $ref: '#/components/schemas/Compte' }
                }
            }
        }
    },

    RegisterRequest: {
        type: 'object',
        required: ['email', 'password', 'nom_utilisateur_compte', 'numero_de_telephone'],
        properties: {
            email: { type: 'string', format: 'email', example: 'newuser@example.com' },
            password: { type: 'string', format: 'password', example: 'Password123!' },
            nom_utilisateur_compte: { type: 'string', example: 'jean_dupont' },
            numero_de_telephone: { type: 'string', example: '+22670123456' },
            prenom: { type: 'string', example: 'Jean' },
            nom: { type: 'string', example: 'Dupont' }
        }
    },

    Error: {
        type: 'object',
        properties: {
            success: { type: 'boolean', example: false },
            error: {
                type: 'object',
                properties: {
                    code: { type: 'string', example: 'NOT_FOUND' },
                    message: { type: 'string', example: 'Ressource non trouvée' }
                }
            },
            timestamp: { type: 'string', format: 'date-time' }
        }
    },

    Pagination: {
        type: 'object',
        properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 100 },
            pages: { type: 'integer', example: 5 }
        }
    },

    ApiResponse: {
        type: 'object',
        properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' },
            pagination: { $ref: '#/components/schemas/Pagination' },
            message: { type: 'string', example: 'Opération réussie' }
        }
    },

    GeoPoint: {
        type: 'object',
        properties: {
            type: { type: 'string', enum: ['Point'], example: 'Point' },
            coordinates: {
                type: 'array',
                items: { type: 'number' },
                minItems: 2,
                maxItems: 2,
                example: [-1.516, 12.371]
            }
        }
    },

    Horaire: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            jour_semaine: { type: 'integer', minimum: 0, maximum: 6, example: 1 },
            heure_ouverture: { type: 'string', format: 'time', example: '08:00' },
            heure_fermeture: { type: 'string', format: 'time', example: '22:00' },
            heure_coupure_debut: { type: 'string', format: 'time', example: '12:00' },
            heure_coupure_fin: { type: 'string', format: 'time', example: '14:00' },
            est_ouvert: { type: 'boolean', example: true }
        }
    },

    JourFerie: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            pays: { type: 'string', example: 'Burkina Faso' },
            date_ferie: { type: 'string', format: 'date', example: '2026-12-25' },
            libelle: { type: 'string', example: 'Noël' },
            est_recurrent: { type: 'boolean', example: true }
        }
    },

    Parrainage: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            code_parrainage: { type: 'string', example: 'ABCD1234' },
            points_parrain: { type: 'integer', example: 100 },
            points_filleul: { type: 'integer', example: 50 },
            statut: {
                type: 'string',
                enum: ['EN_ATTENTE', 'UTILISE', 'CONVERTI', 'EXPIRE']
            },
            date_creation: { type: 'string', format: 'date-time' },
            date_expiration: { type: 'string', format: 'date-time' }
        }
    },

    Configuration: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            entite_type: { $ref: '#/components/schemas/EntiteReference' },
            entite_id: { type: 'integer', example: 1 },
            cle: { type: 'string', example: 'TAUX_TVA' },
            valeur: { type: 'string', example: '18.5' },
            type_valeur: {
                type: 'string',
                enum: ['TEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'JSON', 'DATE']
            },
            est_public: { type: 'boolean', example: true }
        }
    },

    Session: {
        type: 'object',
        properties: {
            id: { type: 'integer', example: 1 },
            session_uuid: { type: 'string', format: 'uuid' },
            adresse_ip: { type: 'string', example: '192.168.1.1' },
            user_agent: { type: 'string', example: 'Mozilla/5.0...' },
            appareil: { type: 'string', example: 'iPhone 15' },
            plateforme: {
                type: 'string',
                enum: ['WEB', 'IOS', 'ANDROID', 'API']
            },
            est_active: { type: 'boolean', example: true },
            date_creation: { type: 'string', format: 'date-time' },
            date_expiration: { type: 'string', format: 'date-time' },
            date_derniere_activite: { type: 'string', format: 'date-time' }
        }
    },

    StatistiquesDashboard: {
        type: 'object',
        properties: {
            commandes: {
                type: 'object',
                properties: {
                    total_jour: { type: 'integer', example: 45 },
                    total_semaine: { type: 'integer', example: 312 },
                    total_mois: { type: 'integer', example: 1250 },
                    chiffre_affaires_jour: { type: 'number', example: 450000 },
                    chiffre_affaires_mois: { type: 'number', example: 12500000 }
                }
            },
            utilisateurs: {
                type: 'object',
                properties: {
                    total: { type: 'integer', example: 15000 },
                    nouveaux_ajourdhui: { type: 'integer', example: 25 },
                    actifs_ce_mois: { type: 'integer', example: 8500 }
                }
            },
            avis: {
                type: 'object',
                properties: {
                    total: { type: 'integer', example: 3420 },
                    note_moyenne: { type: 'number', example: 4.2 },
                    en_attente_moderation: { type: 'integer', example: 15 }
                }
            }
        }
    }
};

module.exports = schemas;