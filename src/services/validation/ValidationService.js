const Joi = require('joi');
const Constants = require('../../configuration/constants');

class ValidationService {
  constructor() {
    this.schemas = {
      // Auth
      auth: this.initAuthSchemas(),
      
      // Comptes
      comptes: this.initComptesSchemas(),
      
      // Transport
      transport: this.initTransportSchemas(),
      
      // Restauration
      restauration: this.initRestaurationSchemas(),
      
      // Boutique
      boutique: this.initBoutiqueSchemas(),
      
      // Livraison
      livraison: this.initLivraisonSchemas(),
      
      // Blog
      blog: this.initBlogSchemas(),
      
      // Messagerie
      messagerie: this.initMessagerieSchemas(),
      
      // Adresse
      adresse: this.initAdresseSchemas(),
      
      // Avis
      avis: this.initAvisSchemas(),
      
      // Horaire
      horaire: this.initHoraireSchemas(),
      
      // Fidélité
      fidelite: this.initFideliteSchemas(),
      
      // Notification
      notification: this.initNotificationSchemas(),
      
      // Document
      document: this.initDocumentSchemas(),
      
      // Admin
      admin: this.initAdminSchemas(),
      
      // Public
      public: this.initPublicSchemas()
    };
  }

  /**
   * Valider des données contre un schéma
   */
  validate(data, schema, options = {}) {
    const { abortEarly = false, stripUnknown = true } = options;
    
    const { error, value } = schema.validate(data, {
      abortEarly,
      stripUnknown,
      errors: {
        wrap: { label: false }
      }
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      throw {
        name: 'ValidationError',
        message: 'Erreur de validation',
        errors
      };
    }

    return value;
  }

  /**
   * Valider un ID
   */
  validateId(id) {
    const schema = Joi.number().integer().positive().required();
    return this.validate({ id }, Joi.object({ id: schema })).id;
  }

  /**
   * Valider un UUID
   */
  validateUUID(uuid) {
    const schema = Joi.string().uuid().required();
    return this.validate({ uuid }, Joi.object({ uuid: schema })).uuid;
  }

  /**
   * Valider un email
   */
  validateEmail(email) {
    const schema = Joi.string().email().required();
    return this.validate({ email }, Joi.object({ email: schema })).email;
  }

  /**
   * Valider un téléphone
   */
  validatePhone(phone) {
    const schema = Joi.string().pattern(Constants.CONFIG.VALIDATION.PHONE_REGEX).required();
    return this.validate({ phone }, Joi.object({ phone: schema })).phone;
  }

  /**
   * Valider une date
   */
  validateDate(date, options = {}) {
    const { min, max, required = true } = options;
    
    let schema = Joi.date();
    
    if (required) schema = schema.required();
    if (min) schema = schema.min(min);
    if (max) schema = schema.max(max);
    
    return this.validate({ date }, Joi.object({ date: schema })).date;
  }

  /**
   * Valider un boolean
   */
  validateBoolean(value, field = 'value') {
    const schema = Joi.boolean().required();
    return this.validate({ [field]: value }, Joi.object({ [field]: schema }))[field];
  }

  /**
   * Valider une énumération
   */
  validateEnum(value, enumName, field = 'value') {
    const validValues = Constants.ENUMS[enumName];
    if (!validValues) {
      throw new Error(`Énumération ${enumName} non trouvée`);
    }

    const schema = Joi.string().valid(...validValues).required();
    return this.validate({ [field]: value }, Joi.object({ [field]: schema }))[field];
  }

  /**
   * Valider une page et une limite
   */
  validatePagination(page, limit) {
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(Constants.CONFIG.PAGINATION.DEFAULT_PAGE),
      limit: Joi.number().integer().min(1).max(Constants.CONFIG.PAGINATION.MAX_LIMIT)
        .default(Constants.CONFIG.PAGINATION.DEFAULT_LIMIT)
    });

    return this.validate({ page, limit }, schema);
  }

  /**
   * Initialiser les schémas d'authentification
   */
  initAuthSchemas() {
    return {
      /**
       * Schéma d'inscription
       */
      register: Joi.object({
        email: Joi.string().email().required(),
        mot_de_passe_compte: Joi.string()
          .min(Constants.CONFIG.VALIDATION.PASSWORD_MIN_LENGTH)
          .required(),
        nom_utilisateur_compte: Joi.string()
          .min(Constants.CONFIG.VALIDATION.USERNAME_MIN_LENGTH)
          .max(Constants.CONFIG.VALIDATION.USERNAME_MAX_LENGTH)
          .pattern(/^[a-zA-Z0-9_]+$/)
          .required(),
        numero_de_telephone: Joi.string()
          .pattern(Constants.CONFIG.VALIDATION.PHONE_REGEX)
          .required(),
        compte_role: Joi.string()
          .valid(...Constants.ENUMS.COMPTE_ROLE)
          .default('UTILISATEUR_PRIVE_SIMPLE'),
        code_parrainage: Joi.string().optional()
      }),

      /**
       * Schéma de connexion
       */
      login: Joi.object({
        email: Joi.string().email(),
        numero_de_telephone: Joi.string().pattern(Constants.CONFIG.VALIDATION.PHONE_REGEX),
        mot_de_passe_compte: Joi.string().required(),
        remember_me: Joi.boolean().default(false)
      }).xor('email', 'numero_de_telephone'),

      /**
       * Schéma de rafraîchissement de token
       */
      refreshToken: Joi.object({
        refresh_token: Joi.string().required()
      }),

      /**
       * Schéma de vérification d'email
       */
      verifyEmail: Joi.object({
        email: Joi.string().email().required(),
        code: Joi.string().length(6).pattern(/^[0-9]+$/).required()
      }),

      /**
       * Schéma de réinitialisation de mot de passe
       */
      resetPassword: Joi.object({
        token: Joi.string().required(),
        nouveau_mot_de_passe: Joi.string()
          .min(Constants.CONFIG.VALIDATION.PASSWORD_MIN_LENGTH)
          .required()
      }),

      /**
       * Schéma de changement de mot de passe
       */
      changePassword: Joi.object({
        ancien_mot_de_passe: Joi.string().required(),
        nouveau_mot_de_passe: Joi.string()
          .min(Constants.CONFIG.VALIDATION.PASSWORD_MIN_LENGTH)
          .required()
          .invalid(Joi.ref('ancien_mot_de_passe'))
      })
    };
  }

  /**
   * Initialiser les schémas des comptes
   */
  initComptesSchemas() {
    return {
      /**
       * Schéma de mise à jour de profil
       */
      updateProfile: Joi.object({
        nom_utilisateur_compte: Joi.string()
          .min(Constants.CONFIG.VALIDATION.USERNAME_MIN_LENGTH)
          .max(Constants.CONFIG.VALIDATION.USERNAME_MAX_LENGTH)
          .pattern(/^[a-zA-Z0-9_]+$/),
        email: Joi.string().email(),
        numero_de_telephone: Joi.string().pattern(Constants.CONFIG.VALIDATION.PHONE_REGEX),
        localisation_livraison: Joi.object({
          lat: Joi.number().min(-90).max(90).required(),
          lng: Joi.number().min(-180).max(180).required()
        }),
        photo_profil_compte: Joi.string().optional()
      }),

      /**
       * Schéma de changement de rôle
       */
      changeRole: Joi.object({
        role: Joi.string().valid(...Constants.ENUMS.COMPTE_ROLE).required()
      }),

      /**
       * Schéma de changement de statut
       */
      changeStatus: Joi.object({
        statut: Joi.string().valid(...Constants.ENUMS.STATUT_COMPTE).required(),
        raison: Joi.string().when('statut', {
          is: Joi.string().valid('SUSPENDU', 'BANNI'),
          then: Joi.string().required(),
          otherwise: Joi.string().optional()
        })
      }),

      /**
       * Schéma de recherche de comptes
       */
      searchComptes: Joi.object({
        page: Joi.number().integer().min(1),
        limit: Joi.number().integer().min(1).max(Constants.CONFIG.PAGINATION.MAX_LIMIT),
        role: Joi.string().valid(...Constants.ENUMS.COMPTE_ROLE),
        statut: Joi.string().valid(...Constants.ENUMS.STATUT_COMPTE),
        recherche: Joi.string().max(100),
        date_debut: Joi.date(),
        date_fin: Joi.date(),
        compagnie_id: Joi.number().integer().positive(),
        restaurant_id: Joi.number().integer().positive(),
        boutique_id: Joi.number().integer().positive()
      })
    };
  }

  /**
   * Initialiser les schémas de transport
   */
  initTransportSchemas() {
    return {
      /**
       * Schéma de création de compagnie
       */
      createCompagnie: Joi.object({
        nom_compagnie: Joi.string().required(),
        description_compagnie: Joi.string().optional(),
        logo_compagnie: Joi.string().optional(),
        pourcentage_commission_plateforme: Joi.number().min(0).max(100).required(),
        plateforme_id: Joi.number().integer().positive().required()
      }),

      /**
       * Schéma de création d'emplacement
       */
      createEmplacement: Joi.object({
        nom_emplacement: Joi.string().required(),
        localisation_emplacement: Joi.object({
          lat: Joi.number().min(-90).max(90).required(),
          lng: Joi.number().min(-180).max(180).required()
        }).optional(),
        jours_ouverture_emplacement_transport: Joi.string()
          .valid(...Constants.ENUMS.JOURS_OUVERTURE)
          .default('LUNDI_VENDREDI'),
        localisation_arret_bus: Joi.object({
          lat: Joi.number().min(-90).max(90).required(),
          lng: Joi.number().min(-180).max(180).required()
        }).optional(),
        compagnie_id: Joi.number().integer().positive().required()
      }),

      /**
       * Schéma de création de ticket
       */
      createTicket: Joi.object({
        nom_produit: Joi.string().required(),
        description_produit: Joi.string().optional(),
        prix_vente_produit: Joi.number().min(0).required(),
        donnees_secondaires_produit: Joi.object().optional(),
        quantite_stock: Joi.number().integer().min(0).default(0),
        emplacement_id: Joi.number().integer().positive().required(),
        compagnie_id: Joi.number().integer().positive().required(),
        journalier: Joi.boolean().default(false),
        hebdomadaire: Joi.boolean().default(false),
        mensuel: Joi.boolean().default(false)
      }).custom((value, helpers) => {
        const types = [value.journalier, value.hebdomadaire, value.mensuel].filter(Boolean).length;
        if (types > 1) {
          return helpers.error('Un seul type de ticket peut être sélectionné');
        }
        return value;
      }),

      /**
       * Schéma de création de service
       */
      createService: Joi.object({
        nom_service: Joi.string().required(),
        type_service: Joi.string().valid(...Constants.ENUMS.TYPES_SERVICES_TRANSPORT).required(),
        donnees_json_service: Joi.object().optional(),
        prix_service: Joi.number().min(0).default(0),
        duree_validite_jours: Joi.number().integer().positive().optional(),
        compagnie_id: Joi.number().integer().positive().required(),
        emplacement_id: Joi.number().integer().positive().optional()
      }),

      /**
       * Schéma d'achat de ticket
       */
      achatTicket: Joi.object({
        ticket_id: Joi.number().integer().positive().required(),
        quantite: Joi.number().integer().min(1).required(),
        info_acheteur: Joi.object({
          email: Joi.string().email().required(),
          nom: Joi.string().required(),
          telephone: Joi.string().pattern(Constants.CONFIG.VALIDATION.PHONE_REGEX).optional()
        }).when('$public', {
          is: true,
          then: Joi.required(),
          otherwise: Joi.optional()
        })
      }),

      /**
       * Schéma de demande de service
       */
      demandeService: Joi.object({
        service_id: Joi.number().integer().positive().required(),
        cni_photo: Joi.string().optional(),
        document_verification: Joi.string().optional(),
        commentaires: Joi.string().optional()
      })
    };
  }

  /**
   * Initialiser les schémas de restauration
   */
  initRestaurationSchemas() {
    return {
      /**
       * Schéma de création de restaurant
       */
      createRestaurant: Joi.object({
        nom_restaurant_fast_food: Joi.string().required(),
        description_restaurant_fast_food: Joi.string().optional(),
        logo_restaurant: Joi.string().optional(),
        plateforme_id: Joi.number().integer().positive().required(),
        pourcentage_commission_plateforme: Joi.number().min(0).max(100).required()
      }),

      /**
       * Schéma de création d'emplacement restaurant
       */
      createEmplacementRestaurant: Joi.object({
        nom_emplacement: Joi.string().required(),
        logo_restaurant: Joi.string().optional(),
        favicon_restaurant: Joi.string().optional(),
        localisation_restaurant: Joi.object({
          lat: Joi.number().min(-90).max(90).required(),
          lng: Joi.number().min(-180).max(180).required()
        }).optional(),
        adresse_complete: Joi.string().optional(),
        frais_livraison: Joi.number().min(0).default(0),
        heure_ouverture: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
        heure_fermeture: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
        jours_ouverture_emplacement_restaurant: Joi.string()
          .valid(...Constants.ENUMS.JOURS_OUVERTURE)
          .default('LUNDI_VENDREDI'),
        id_restaurant_fast_food: Joi.number().integer().positive().required()
      }).custom((value, helpers) => {
        if (value.heure_ouverture && value.heure_fermeture) {
          if (value.heure_fermeture <= value.heure_ouverture) {
            return helpers.error('L\'heure de fermeture doit être postérieure à l\'heure d\'ouverture');
          }
        }
        return value;
      }),

      /**
       * Schéma de création de menu
       */
      createMenu: Joi.object({
        nom_menu: Joi.string().required(),
        description_menu: Joi.string().optional(),
        photo_menu: Joi.string().optional(),
        photos_menu: Joi.array().items(Joi.string()).optional(),
        composition_menu: Joi.array().items(Joi.object()).optional(),
        prix_menu: Joi.number().min(0).required(),
        temps_preparation_min: Joi.number().integer().positive().optional(),
        stock_disponible: Joi.number().integer().min(-1).default(-1),
        id_restaurant_fast_food_emplacement: Joi.number().integer().positive().required(),
        categorie_menu: Joi.string().valid(...Constants.ENUMS.CATEGORIES_MENU).required(),
        est_journalier: Joi.boolean().default(true)
      }),

      /**
       * Schéma de création de produit individuel
       */
      createProduitRestaurant: Joi.object({
        nom_produit: Joi.string().required(),
        description_produit: Joi.string().optional(),
        photo_produit: Joi.string().optional(),
        donnees_produit: Joi.object().optional(),
        stock_disponible: Joi.number().integer().min(-1).default(-1),
        categorie_produit: Joi.string().valid(...Constants.ENUMS.CATEGORIES_PRODUITS).required(),
        prix_produit: Joi.number().min(0).required(),
        id_restaurant_fast_food_emplacement: Joi.number().integer().positive().required(),
        est_journalier: Joi.boolean().default(true)
      }),

      /**
       * Schéma de création de promotion
       */
      createPromo: Joi.object({
        nom_promo: Joi.string().required(),
        description_promo: Joi.string().optional(),
        code_promo: Joi.string().optional(),
        type_promo: Joi.string().valid(...Constants.ENUMS.TYPES_PROMO).required(),
        id_restaurant_fast_food_emplacement: Joi.number().integer().positive().optional(),
        pourcentage_reduction: Joi.number().min(0).max(100).when('type_promo', {
          is: 'POURCENTAGE',
          then: Joi.required(),
          otherwise: Joi.optional()
        }),
        montant_fixe_reduction: Joi.number().min(0).when('type_promo', {
          is: 'MONTANT_FIXE',
          then: Joi.required(),
          otherwise: Joi.optional()
        }),
        date_debut_promo: Joi.date().required(),
        date_fin_promo: Joi.date().greater(Joi.ref('date_debut_promo')).required(),
        utilisation_max: Joi.number().integer().min(-1).default(-1),
        produits_affectes: Joi.array().items(Joi.number().integer()).optional(),
        menus_affectes: Joi.array().items(Joi.number().integer()).optional()
      }),

      /**
       * Schéma de création de commande
       */
      createCommandeRestaurant: Joi.object({
        id_restaurant_fast_food_emplacement: Joi.number().integer().positive().required(),
        donnees_commande: Joi.array().items(Joi.object({
          id: Joi.number().integer().positive().required(),
          type: Joi.string().valid('menu', 'produit').required(),
          nom: Joi.string().required(),
          quantite: Joi.number().integer().min(1).required(),
          prix_unitaire: Joi.number().min(0).required()
        })).min(1).required(),
        pour_livrer: Joi.boolean().default(false),
        passer_recuperer: Joi.boolean().default(false),
        paiement_direct: Joi.boolean().default(false),
        paiement_a_la_livraison: Joi.boolean().default(false),
        paiement_a_la_recuperation: Joi.boolean().default(false),
        adresse_livraison_id: Joi.number().integer().positive().when('pour_livrer', {
          is: true,
          then: Joi.required(),
          otherwise: Joi.optional()
        }),
        notes_commande: Joi.string().optional(),
        code_promo: Joi.string().optional()
      }).custom((value, helpers) => {
        // Vérifier qu'un seul mode de livraison est sélectionné
        if (value.pour_livrer && value.passer_recuperer) {
          return helpers.error('Une commande ne peut pas être à la fois à livrer et à récupérer');
        }

        // Vérifier qu'un seul mode de paiement est sélectionné
        const modesPaiement = [
          value.paiement_direct,
          value.paiement_a_la_livraison,
          value.paiement_a_la_recuperation
        ].filter(Boolean).length;

        if (modesPaiement !== 1) {
          return helpers.error('Un seul mode de paiement doit être sélectionné');
        }

        return value;
      }),

      /**
       * Schéma de mise à jour de statut de commande
       */
      updateCommandeStatut: Joi.object({
        statut: Joi.string().valid(...Constants.ENUMS.STATUT_COMMANDE).required(),
        raison: Joi.string().when('statut', {
          is: Joi.string().valid('ANNULEE', 'REMBOURSEE'),
          then: Joi.required(),
          otherwise: Joi.optional()
        })
      })
    };
  }

  /**
   * Initialiser les schémas de boutique
   */
  initBoutiqueSchemas() {
    return {
      /**
       * Schéma de création de boutique
       */
      createBoutique: Joi.object({
        nom_boutique: Joi.string().required(),
        description_boutique: Joi.string().optional(),
        logo_boutique: Joi.string().optional(),
        favicon_boutique: Joi.string().optional(),
        types_produits_vendu: Joi.array().items(Joi.string()).optional(),
        plateforme_id: Joi.number().integer().positive().required(),
        pourcentage_commission_plateforme: Joi.number().min(0).max(100).required()
      }),

      /**
       * Schéma de création de catégorie
       */
      createCategorieBoutique: Joi.object({
        nom_categorie: Joi.string().required(),
        description_categorie: Joi.string().optional(),
        slug_categorie: Joi.string().optional(),
        categorie_parente_id: Joi.number().integer().positive().optional(),
        boutique_id: Joi.number().integer().positive().required(),
        ordre_affichage: Joi.number().integer().min(0).default(0)
      }),

      /**
       * Schéma de création de produit
       */
      createProduitBoutique: Joi.object({
        nom_produit: Joi.string().required(),
        slug_produit: Joi.string().optional(),
        image_produit: Joi.string().optional(),
        images_produit: Joi.array().items(Joi.string()).optional(),
        description_produit: Joi.string().optional(),
        donnees_supplementaires: Joi.object().optional(),
        prix_unitaire_produit: Joi.number().min(0).required(),
        prix_promo: Joi.number().min(0).optional(),
        quantite: Joi.number().integer().min(-1).default(-1),
        id_categorie: Joi.number().integer().positive().required(),
        id_boutique: Joi.number().integer().positive().required()
      }).custom((value, helpers) => {
        if (value.prix_promo && value.prix_promo >= value.prix_unitaire_produit) {
          return helpers.error('Le prix promo doit être inférieur au prix normal');
        }
        return value;
      }),

      /**
       * Schéma de création de commande boutique
       */
      createCommandeBoutique: Joi.object({
        id_boutique: Joi.number().integer().positive().required(),
        donnees_commandes: Joi.array().items(Joi.object({
          produit_id: Joi.number().integer().positive().required(),
          nom_produit: Joi.string().required(),
          quantite: Joi.number().integer().min(1).required(),
          prix_unitaire: Joi.number().min(0).required()
        })).min(1).required(),
        pour_livrer: Joi.boolean().default(false),
        passer_recuperer: Joi.boolean().default(false),
        paiement_direct: Joi.boolean().default(false),
        paiement_a_la_livraison: Joi.boolean().default(false),
        paiement_a_la_recuperation: Joi.boolean().default(false),
        adresse_livraison_id: Joi.number().integer().positive().when('pour_livrer', {
          is: true,
          then: Joi.required(),
          otherwise: Joi.optional()
        }),
        notes_commande: Joi.string().optional()
      }).custom((value, helpers) => {
        if (value.pour_livrer && value.passer_recuperer) {
          return helpers.error('Une commande ne peut pas être à la fois à livrer et à récupérer');
        }

        const modesPaiement = [
          value.paiement_direct,
          value.paiement_a_la_livraison,
          value.paiement_a_la_recuperation
        ].filter(Boolean).length;

        if (modesPaiement !== 1) {
          return helpers.error('Un seul mode de paiement doit être sélectionné');
        }

        return value;
      })
    };
  }

  /**
   * Initialiser les schémas de livraison
   */
  initLivraisonSchemas() {
    return {
      /**
       * Schéma de création d'entreprise de livraison
       */
      createEntrepriseLivraison: Joi.object({
        nom_entreprise_livraison: Joi.string().required(),
        description_entreprise_livraison: Joi.string().optional(),
        logo_entreprise_livraison: Joi.string().optional(),
        favicon_entreprise_livraison: Joi.string().optional(),
        localisation_entreprise: Joi.object({
          lat: Joi.number().min(-90).max(90).required(),
          lng: Joi.number().min(-180).max(180).required()
        }).optional(),
        pourcentage_commission_plateforme: Joi.number().min(0).max(100).optional(),
        plateforme_id: Joi.number().integer().positive().optional()
      }),

      /**
       * Schéma de création de service de livraison
       */
      createServiceLivraison: Joi.object({
        nom_service: Joi.string().required(),
        type_service: Joi.string().valid(...Constants.ENUMS.TYPES_SERVICE_LIVRAISON).required(),
        description_service: Joi.string().optional(),
        prix_service: Joi.number().min(0).required(),
        prix_par_km: Joi.number().min(0).optional(),
        distance_max_km: Joi.number().min(0).optional(),
        donnees_supplementaires: Joi.object().optional(),
        id_entreprise_livraison: Joi.number().integer().positive().required()
      }),

      /**
       * Schéma de création de livreur
       */
      createLivreur: Joi.object({
        nom_livreur: Joi.string().required(),
        prenom_livreur: Joi.string().required(),
        photo_livreur: Joi.string().optional(),
        numero_telephone_livreur: Joi.string()
          .pattern(Constants.CONFIG.VALIDATION.PHONE_REGEX)
          .required(),
        id_entreprise_livraison: Joi.number().integer().positive().optional(),
        localisation_actuelle: Joi.object({
          lat: Joi.number().min(-90).max(90).required(),
          lng: Joi.number().min(-180).max(180).required()
        }).optional()
      }),

      /**
       * Schéma de demande de livraison
       */
      createDemandeLivraison: Joi.object({
        details_livraison: Joi.object({
          adresse_depart: Joi.object({
            adresse_id: Joi.number().integer().positive(),
            lat: Joi.number().min(-90).max(90),
            lng: Joi.number().min(-180).max(180),
            libelle: Joi.string()
          }).required(),
          adresse_arrivee: Joi.object({
            adresse_id: Joi.number().integer().positive(),
            lat: Joi.number().min(-90).max(90),
            lng: Joi.number().min(-180).max(180),
            libelle: Joi.string()
          }).required(),
          instructions: Joi.string().optional(),
          poids_kg: Joi.number().min(0).optional(),
          volume_m3: Joi.number().min(0).optional(),
          fragile: Joi.boolean().default(false)
        }).required(),
        commande_type: Joi.string().valid('RESTAURANT_FAST_FOOD', 'BOUTIQUE', 'AUTRE').optional(),
        commande_id: Joi.number().integer().positive().optional(),
        date_livraison_prevue: Joi.date().min('now').optional()
      }),

      /**
       * Schéma d'assignation de livreur
       */
      assignerLivreur: Joi.object({
        livreur_id: Joi.number().integer().positive().required()
      }),

      /**
       * Schéma de mise à jour de localisation
       */
      updateLocalisation: Joi.object({
        lat: Joi.number().min(-90).max(90).required(),
        lng: Joi.number().min(-180).max(180).required()
      })
    };
  }

  /**
   * Initialiser les schémas de blog
   */
  initBlogSchemas() {
    return {
      /**
       * Schéma de création d'article
       */
      createArticle: Joi.object({
        titre_article: Joi.string().required(),
        sous_titre: Joi.string().optional(),
        slug: Joi.string().optional(),
        contenu_article: Joi.string().required(),
        extrait_contenu: Joi.string().optional(),
        langue: Joi.string().default('fr'),
        image_principale: Joi.string().optional(),
        image_secondaire: Joi.string().optional(),
        video_url: Joi.string().uri().optional(),
        gallery_images: Joi.array().items(Joi.string()).optional(),
        documents_joints: Joi.array().items(Joi.object()).optional(),
        meta_titre: Joi.string().optional(),
        meta_description: Joi.string().optional(),
        mots_cles: Joi.array().items(Joi.string()).optional(),
        categorie_principale: Joi.string().valid(...Constants.ENUMS.CATEGORIES_ARTICLE).required(),
        categories_secondaires: Joi.array().items(
          Joi.string().valid(...Constants.ENUMS.CATEGORIES_ARTICLE)
        ).optional(),
        visibilite: Joi.string().valid(...Constants.ENUMS.VISIBILITE_ARTICLE).default('PUBLIC'),
        est_commentaire_actif: Joi.boolean().default(true),
        date_programmation: Joi.date().min('now').optional(),
        droit_lecture_minimum_role: Joi.string().valid(...Constants.ENUMS.COMPTE_ROLE).optional(),
        mot_de_passe_protege: Joi.string().optional(),
        redirection_url: Joi.string().uri().optional()
      }),

      /**
       * Schéma de création de commentaire
       */
      createCommentaire: Joi.object({
        contenu_commentaire: Joi.string().required(),
        langue: Joi.string().default('fr'),
        article_id: Joi.number().integer().positive().required(),
        commentaire_parent_id: Joi.number().integer().positive().optional(),
        est_anonyme: Joi.boolean().default(false),
        pseudo_anonyme: Joi.string().when('est_anonyme', {
          is: true,
          then: Joi.string().required(),
          otherwise: Joi.optional()
        }),
        note: Joi.number().integer().min(1).max(5).optional()
      }),

      /**
       * Schéma de signalement
       */
      signalement: Joi.object({
        motif: Joi.string().required(),
        description: Joi.string().optional()
      }),

      /**
       * Schéma d'abonnement
       */
      abonnement: Joi.object({
        type_abonnement: Joi.string().valid('CATEGORIE', 'AUTEUR', 'TAG').required(),
        reference_id: Joi.alternatives().conditional('type_abonnement', {
          switch: [
            { is: 'CATEGORIE', then: Joi.string().valid(...Constants.ENUMS.CATEGORIES_ARTICLE) },
            { is: 'AUTEUR', then: Joi.number().integer().positive() },
            { is: 'TAG', then: Joi.string() }
          ]
        }).required()
      })
    };
  }

  /**
   * Initialiser les schémas de messagerie
   */
  initMessagerieSchemas() {
    return {
      /**
       * Schéma de création de conversation
       */
      createConversation: Joi.object({
        type_conversation: Joi.string().valid(...Constants.ENUMS.TYPE_CONVERSATION).required(),
        titre_conversation: Joi.string().optional(),
        description_conversation: Joi.string().optional(),
        avatar_conversation: Joi.string().optional(),
        est_prive: Joi.boolean().default(true),
        necessite_approbation: Joi.boolean().default(false),
        entite_type: Joi.string().valid(...Constants.ENUMS.ENTITE_REFERENCE).optional(),
        entite_id: Joi.number().integer().positive().optional(),
        metadata: Joi.object().optional(),
        tags: Joi.array().items(Joi.string()).optional(),
        participants: Joi.array().items(Joi.object({
          compte_id: Joi.number().integer().positive().required(),
          role: Joi.string().valid(...Constants.ENUMS.ROLE_CONVERSATION).default('PARTICIPANT'),
          est_administrateur: Joi.boolean().default(false)
        })).min(1).required()
      }),

      /**
       * Schéma d'envoi de message
       */
      sendMessage: Joi.object({
        contenu_message: Joi.string().when('type_message', {
          is: 'TEXTE',
          then: Joi.required(),
          otherwise: Joi.optional()
        }),
        type_message: Joi.string().valid('TEXTE', 'IMAGE', 'VIDEO', 'AUDIO', 'FICHIER', 'SYSTEME', 'LOCALISATION')
          .default('TEXTE'),
        message_parent_id: Joi.number().integer().positive().optional(),
        est_important: Joi.boolean().default(false),
        est_silencieux: Joi.boolean().default(false),
        reponse_a_id: Joi.number().integer().positive().optional(),
        mentions_comptes: Joi.array().items(Joi.number().integer().positive()).optional(),
        metadata: Joi.object().optional()
      }),

      /**
       * Schéma d'ajout de participant
       */
      addParticipant: Joi.object({
        compte_id: Joi.number().integer().positive().required(),
        role: Joi.string().valid(...Constants.ENUMS.ROLE_CONVERSATION).default('PARTICIPANT'),
        permissions: Joi.object({
          peut_ecrire: Joi.boolean().default(true),
          peut_inviter: Joi.boolean().default(false),
          peut_supprimer: Joi.boolean().default(false)
        }).default(),
        est_administrateur: Joi.boolean().default(false),
        surnom: Joi.string().optional()
      }),

      /**
       * Schéma d'invitation
       */
      createInvitation: Joi.object({
        email_invite: Joi.string().email(),
        compte_id: Joi.number().integer().positive(),
        role_propose: Joi.string().valid(...Constants.ENUMS.ROLE_CONVERSATION).default('PARTICIPANT'),
        message_personnalise: Joi.string().optional()
      }).xor('email_invite', 'compte_id'),

      /**
       * Schéma de blocage
       */
      blockUser: Joi.object({
        compte_bloque: Joi.number().integer().positive().required(),
        type_blocage: Joi.string().valid('MESSAGERIE', 'CONVERSATION', 'GLOBAL').default('MESSAGERIE'),
        conversation_id: Joi.number().integer().positive().optional(),
        motif: Joi.string().optional(),
        est_temporaire: Joi.boolean().default(false),
        duree_heures: Joi.number().integer().positive().when('est_temporaire', {
          is: true,
          then: Joi.required(),
          otherwise: Joi.optional()
        })
      })
    };
  }

  /**
   * Initialiser les schémas d'adresse
   */
  initAdresseSchemas() {
    return {
      /**
       * Schéma de création d'adresse
       */
      createAdresse: Joi.object({
        libelle: Joi.string().optional(),
        ligne_1: Joi.string().required(),
        ligne_2: Joi.string().optional(),
        quartier: Joi.string().optional(),
        ville: Joi.string().required(),
        code_postal: Joi.string().optional(),
        commune: Joi.string().optional(),
        province: Joi.string().optional(),
        pays: Joi.string().default('Burkina Faso'),
        coordonnees: Joi.object({
          lat: Joi.number().min(-90).max(90).required(),
          lng: Joi.number().min(-180).max(180).required()
        }).optional(),
        precision_gps: Joi.number().optional()
      }),

      /**
       * Schéma d'association d'adresse
       */
      associerAdresse: Joi.object({
        adresse_id: Joi.number().integer().positive().required(),
        entite_type: Joi.string().valid(...Constants.ENUMS.ENTITE_REFERENCE).required(),
        entite_id: Joi.number().integer().positive().required(),
        type_adresse: Joi.string().valid('PRINCIPALE', 'LIVRAISON', 'FACTURATION', 'SECONDAIRE')
          .default('PRINCIPALE')
      })
    };
  }

  /**
   * Initialiser les schémas d'avis
   */
  initAvisSchemas() {
    return {
      /**
       * Schéma de création d'avis
       */
      createAvis: Joi.object({
        entite_type: Joi.string().valid(...Constants.ENUMS.ENTITE_REFERENCE).required(),
        entite_id: Joi.number().integer().positive().required(),
        note_globale: Joi.number().integer().min(1).max(5),
        note_qualite: Joi.number().integer().min(1).max(5).optional(),
        note_service: Joi.number().integer().min(1).max(5).optional(),
        note_rapport_prix: Joi.number().integer().min(1).max(5).optional(),
        note_ponctualite: Joi.number().integer().min(1).max(5).optional(),
        titre: Joi.string().max(150).optional(),
        contenu: Joi.string().optional(),
        photos_avis: Joi.array().items(Joi.string()).optional(),
        commande_type: Joi.string().valid('RESTAURANT_FAST_FOOD', 'BOUTIQUE', 'TRANSPORT').optional(),
        commande_id: Joi.number().integer().positive().optional()
      }).custom((value, helpers) => {
        if (!value.note_globale) {
          const notes = [
            value.note_qualite,
            value.note_service,
            value.note_rapport_prix,
            value.note_ponctualite
          ].filter(n => n != null);
          
          if (notes.length === 0) {
            return helpers.error('Au moins une note est requise');
          }
        }
        return value;
      }),

      /**
       * Schéma de réponse professionnelle
       */
      reponsePro: Joi.object({
        reponse: Joi.string().required()
      }),

      /**
       * Schéma de modération
       */
      moderationAvis: Joi.object({
        statut: Joi.string().valid('PUBLIE', 'REJETE', 'MASQUE').required(),
        motif: Joi.string().when('statut', {
          is: Joi.string().valid('REJETE', 'MASQUE'),
          then: Joi.required(),
          otherwise: Joi.optional()
        })
      }),

      /**
       * Schéma de vote
       */
      voteAvis: Joi.object({
        est_utile: Joi.boolean().required()
      })
    };
  }

  /**
   * Initialiser les schémas d'horaire
   */
  initHoraireSchemas() {
    return {
      /**
       * Schéma de définition des horaires
       */
      setHoraires: Joi.object({
        horaires: Joi.array().items(Joi.object({
          jour_semaine: Joi.number().integer().min(0).max(6).required(),
          heure_ouverture: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
          heure_fermeture: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
          heure_coupure_debut: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
          heure_coupure_fin: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
          est_ouvert: Joi.boolean().default(true)
        })).min(1).required()
      }),

      /**
       * Schéma d'exception d'horaire
       */
      exceptionHoraire: Joi.object({
        date_exception: Joi.date().required(),
        libelle: Joi.string().required(),
        est_ouvert: Joi.boolean().default(false),
        heure_ouverture: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).when('est_ouvert', {
          is: true,
          then: Joi.required(),
          otherwise: Joi.optional()
        }),
        heure_fermeture: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).when('est_ouvert', {
          is: true,
          then: Joi.required(),
          otherwise: Joi.optional()
        }),
        motif: Joi.string().optional()
      }),

      /**
       * Schéma de jour férié
       */
      jourFerie: Joi.object({
        pays: Joi.string().default('Burkina Faso'),
        date_ferie: Joi.date().required(),
        libelle: Joi.string().required(),
        est_recurrent: Joi.boolean().default(true)
      })
    };
  }

  /**
   * Initialiser les schémas de fidélité
   */
  initFideliteSchemas() {
    return {
      /**
       * Schéma de création de programme
       */
      createProgramme: Joi.object({
        entite_type: Joi.string().valid(...Constants.ENUMS.ENTITE_REFERENCE).required(),
        entite_id: Joi.number().integer().positive().required(),
        nom_programme: Joi.string().required(),
        description: Joi.string().optional(),
        points_par_tranche: Joi.number().integer().positive().default(1),
        montant_tranche: Joi.number().positive().default(1000),
        valeur_point_fcfa: Joi.number().positive().default(5),
        paliers: Joi.array().items(Joi.object({
          nom: Joi.string().required(),
          points: Joi.number().integer().positive().required(),
          avantages: Joi.array().items(Joi.string()).optional()
        })).optional(),
        date_debut: Joi.date().optional(),
        date_fin: Joi.date().greater(Joi.ref('date_debut')).optional()
      }),

      /**
       * Schéma d'utilisation de points
       */
      utiliserPoints: Joi.object({
        points: Joi.number().integer().positive().required(),
        reference_type: Joi.string().optional(),
        reference_id: Joi.number().integer().positive().optional(),
        description: Joi.string().optional()
      }),

      /**
       * Schéma de code de parrainage
       */
      codeParrainage: Joi.object({
        code: Joi.string().optional()
      })
    };
  }

  /**
   * Initialiser les schémas de notification
   */
  initNotificationSchemas() {
    return {
      /**
       * Schéma d'envoi de notification
       */
      sendNotification: Joi.object({
        destinataire_id: Joi.number().integer().positive().required(),
        type: Joi.string().required(),
        canal: Joi.string().valid(...Constants.ENUMS.CANAL_NOTIFICATION).default('IN_APP'),
        priorite: Joi.string().valid(...Constants.ENUMS.PRIORITE_NOTIFICATION).default('NORMALE'),
        titre: Joi.string().required(),
        corps: Joi.string().required(),
        action_type: Joi.string().optional(),
        action_id: Joi.number().integer().positive().optional(),
        action_url: Joi.string().uri().optional(),
        image_url: Joi.string().uri().optional(),
        entite_source_type: Joi.string().valid(...Constants.ENUMS.ENTITE_REFERENCE).optional(),
        entite_source_id: Joi.number().integer().positive().optional(),
        date_expiration: Joi.date().optional(),
        schedule: Joi.date().optional()
      }),

      /**
       * Schéma de préférence de notification
       */
      setPreference: Joi.object({
        canal: Joi.string().valid(...Constants.ENUMS.CANAL_NOTIFICATION).required(),
        type_evenement: Joi.string().required(),
        est_active: Joi.boolean().default(true),
        heure_debut_silencieux: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
        heure_fin_silencieux: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional()
      }),

      /**
       * Schéma d'enregistrement de token push
       */
      registerPushToken: Joi.object({
        token: Joi.string().required(),
        plateforme: Joi.string().valid('IOS', 'ANDROID', 'WEB').required()
      })
    };
  }

  /**
   * Initialiser les schémas de document
   */
  initDocumentSchemas() {
    return {
      /**
       * Schéma de création de document
       */
      createDocument: Joi.object({
        type_document: Joi.string().valid(...Constants.ENUMS.TYPE_DOCUMENT).required(),
        nom_fichier: Joi.string().required(),
        entite_type: Joi.string().valid(...Constants.ENUMS.ENTITE_REFERENCE).required(),
        entite_id: Joi.number().integer().positive().required(),
        numero_document: Joi.string().optional(),
        date_emission: Joi.date().optional(),
        date_expiration: Joi.date().optional(),
        autorite_emettrice: Joi.string().optional()
      }),

      /**
       * Schéma de validation de document
       */
      validerDocument: Joi.object({
        statut: Joi.string().valid('VALIDE', 'REFUSE').required(),
        commentaire: Joi.string().when('statut', {
          is: 'REFUSE',
          then: Joi.required(),
          otherwise: Joi.optional()
        })
      })
    };
  }

  /**
   * Initialiser les schémas d'administration
   */
  initAdminSchemas() {
    return {
      /**
       * Schéma de configuration
       */
      setConfig: Joi.object({
        cle: Joi.string().required(),
        valeur: Joi.any().required(),
        entite_type: Joi.string().valid(...Constants.ENUMS.ENTITE_REFERENCE).default('PLATEFORME'),
        entite_id: Joi.number().integer().positive().optional(),
        type_valeur: Joi.string().valid('TEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'JSON', 'DATE')
          .optional(),
        description: Joi.string().optional(),
        est_public: Joi.boolean().default(false)
      }),

      /**
       * Schéma de maintenance
       */
      maintenance: Joi.object({
        action: Joi.string().valid(
          'CLEAN_SESSIONS',
          'CLEAN_CACHE',
          'REFRESH_VIEWS',
          'PROCESS_EXPIRED',
          'BACKUP_DB'
        ).required(),
        options: Joi.object().optional()
      }),

      /**
       * Schéma de politique de rétention
       */
      setRetentionPolicy: Joi.object({
        table_cible: Joi.string().required(),
        duree_retention_jours: Joi.number().integer().positive().required(),
        champ_date: Joi.string().default('date_creation'),
        action_expiration: Joi.string().valid('SUPPRIMER', 'ANONYMISER', 'ARCHIVER').default('ANONYMISER')
      })
    };
  }

  /**
   * Initialiser les schémas publics
   */
  initPublicSchemas() {
    return {
      /**
       * Schéma de recherche
       */
      search: Joi.object({
        q: Joi.string().required(),
        type: Joi.array().items(
          Joi.string().valid('restaurants', 'boutiques', 'produits', 'articles', 'compagnies')
        ).optional(),
        page: Joi.number().integer().min(1).default(1),
        limit: Joi.number().integer().min(1).max(Constants.CONFIG.PAGINATION.MAX_LIMIT)
          .default(Constants.CONFIG.PAGINATION.DEFAULT_LIMIT),
        lat: Joi.number().min(-90).max(90).optional(),
        lng: Joi.number().min(-180).max(180).optional(),
        rayon: Joi.number().min(0).default(5000),
        categorie: Joi.string().optional(),
        prix_min: Joi.number().min(0).optional(),
        prix_max: Joi.number().min(0).optional(),
        note_min: Joi.number().min(1).max(5).optional(),
        ouvert_maintenant: Joi.boolean().optional()
      }),

      /**
       * Schéma de géolocalisation
       */
      geoloc: Joi.object({
        lat: Joi.number().min(-90).max(90).required(),
        lng: Joi.number().min(-180).max(180).required(),
        rayon: Joi.number().min(0).default(5000),
        type: Joi.string().valid('restaurants', 'boutiques', 'emplacements').required()
      }),

      /**
       * Schéma de contact
       */
      contact: Joi.object({
        nom: Joi.string().required(),
        email: Joi.string().email().required(),
        telephone: Joi.string().pattern(Constants.CONFIG.VALIDATION.PHONE_REGEX).optional(),
        sujet: Joi.string().required(),
        message: Joi.string().required()
      })
    };
  }
}

module.exports = new ValidationService();