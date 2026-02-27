CREATE TYPE compte_role AS ENUM(
    'ADMINISTRATEUR_PLATEFORME',
    'BLOGUEUR_PLATEFORME',
    'STAFF_PLATEFORME',
    'ADMINISTRATEUR_COMPAGNIE',
    'STAFF_COMPAGNIE',
    'BLOGUEUR COMPAGNIE',
    'ADMINISTRATEUR_EMBRANCHEMENT_COMPAGNIE',
    'STAFF_EMBRANCHEMENT_COMPAGNIE',
    'BLOGUEUR_EMBRANCHEMENT_COMPAGNIE',
    'ADMINISTRATEUR_RESTAURANT_FAST_FOOD',
    'STAFF_RESTAURANT_FAST_FOOD',
    'BLOGUEUR_RESTAURANT_FAST_FOOD',
    'UTILISATEUR_PRIVE_SIMPLE',
    'UTILISATEUR_VENDEUR',
);

/*RESTAURANT FAST FOOD EMPLACEMENT TRANSPORT*/
CREATE TYPE jours_ouverture as ENUM(
    'LUNDI',
    'MARDI',
    'MERCREDI',
    'JEUDI',
    'VENDREDI',
    'SAMEDI',
    'DIMANCHE',
    'TOUS_LES_JOURS',
    'LUNDI-VENDREDI',
    'LUNDI-SAMEDI',
    'LUNDI-DIMANCHE',
);

CREATE TYPE categories_menu as ENUM(
    'PETIT_DEJEUNER',
    'ENTREE',
    'PLAT_PRINCIPAL',
    'DESSERT',
    'BOISSON',
    'MENU_ENFANT',
    'MENU_PROMO',
    'MENU_DU_JOUR',
    'FORMULE_MIDI',
    'FORMULE_SOIR',
    'ACCOMPAGNEMENT',
    'SAUCE',
    'SALADE',
    'SOUPE',
    'SANDWICH',
    'BURGER',
    'PIZZA',
    'KEBAB',
    'TACOS',
    'SUSHI',
    'WRAP',
    'BOWL',
    'PASTA',
    'SALADE_COMPOSEE',
    'PLAT_AFRICAIN',
    'PLAT_ASIATIQUE',
    'PLAT_ITALIEN',
    'PLAT_AMERICAIN'
);

CREATE TYPE categories_produits as ENUM(

);
CREATE TYPE types_promo as ENUM(

);

CREATE TYPE types_connexions as ENUM(
    'CONNEXION',
    'DECONNECTION',
);

CREATE TYPE statuts_connexion as ENUM(
    'SUCCESS',
    'FAILED',
    'BLOCKED'
),

/* FIN */

CREATE TYPE statut_compte AS ENUM(
    'EST_AUTHENTIFIE',
    'NON_AUTHENTIFIE',
    'SUSPENDU',
    'BANNI'
);

CREATE TYPE types_services_transport AS ENUM(
    'ABONNEMENT_MENSUEL',
    'BIMENSUEL',
    'TRIMESTRIEL',
    'ANNUEL'
);

/*PLATFORME*/

CREATE TABLE PLATEFORME(
    id SERIAL PRIMARY KEY,
    nom_plateforme VARCHAR(255) NOT NULL,
    description_plateforme TEXT,
    logo_plateforme VARCHAR(255),
    favicon_plateforme VARCHAR(255),
    localisation_siege POINT,
    portefeuille_plateforme DECIMAL(15,2) DEFAULT 0.00,
    depenses_plateforme JSONB DEFAULT '[]'::jsonb,
    date_creation TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour TIMESTAMP DEFAULT NOW()
);

/*FIN */

/*COMPAGNIE TRANSPORT*/

CREATE TABLE COMPAGNIESTRANSPORT(
    id SERIAL PRIMARY KEY,
    nom_compagnie VARCHAR(255) NOT NULL,
    description_compagnie TEXT,
    logo_compagnie VARCHAR(255),
    pourcentage_commission_plateforme INTEGER NOT NULL CHECK (pourcentage_commission_plateforme BETWEEN 0 AND 100),
    portefeuille_compagnie DECIMAL(15,2) DEFAULT 0.00,
    date_creation TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour TIMESTAMP DEFAULT NOW(),
    plateforme_id INTEGER,

    CONSTRAINT fk_plateforme
        FOREIGN KEY (plateforme_id)
        REFERENCES PLATEFORME(id)
        ON DELETE SET NULL
);

CREATE TABLE EMPLACEMENTSTRANSPORT(
    id SERIAL PRIMARY KEY,
    nom_emplacement VARCHAR(255),
    localisation_emplacement POINT,
    jours_ouverture_emplacement_transport jours_ouverture DEFAULT 'LUNDI-VENDREDI'
    localisation_arret_bus POINT,
    date_creation TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour TIMESTAMP DEFAULT NOW(),
    portefeuille_emplacement DECIMAL(15,2) DEFAULT 0.00,
    compagnie_id INTEGER NOT NULL,

    CONSTRAINT fk_compagnie_emplacement
        FOREIGN KEY (compagnie_id)
        REFERENCES COMPAGNIESTRANSPORT(id)
        ON DELETE CASCADE
);

CREATE TABLE TICKETSTRANSPORT(
    id SERIAL PRIMARY KEY,
    nom_produit VARCHAR(255) NOT NULL,
    description_produit TEXT,
    prix_vente_produit DECIMAL(10,2) NOT NULL CHECK (prix_vente_produit >= 0),
    donnees_secondaires_produit JSONB DEFAULT '[]'::jsonb,
    quantite_stock INTEGER DEFAULT 0 NOT NULL CHECK (quantite_stock >= 0),
    quantite_vendu INTEGER DEFAULT 0 NOT NULL CHECK (quantite_vendu >= 0),
    emplacement_id INTEGER NOT NULL,
    compagnie_id INTEGER NOT NULL,
    journalier BOOLEAN DEFAULT false,
    hebdomadaire BOOLEAN DEFAULT false,
    mensuel BOOLEAN DEFAULT false,
    actif BOOLEAN DEFAULT false,
    date_creation TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT fk_emplacement_ticket
        FOREIGN KEY (emplacement_id)
        REFERENCES EMPLACEMENTSTRANSPORT(id)
        ON DELETE CASCADE,
        
    CONSTRAINT fk_compagnie_ticket
        FOREIGN KEY (compagnie_id)
        REFERENCES COMPAGNIESTRANSPORT(id)
        ON DELETE CASCADE
);

CREATE TABLE SERVICES(
    id SERIAL PRIMARY KEY,
    nom_service VARCHAR(255) NOT NULL,
    type_service types_services_transport NOT NULL,
    donnees_json_service JSONB DEFAULT '[]'::jsonb,
    prix_service DECIMAL(10,2) DEFAULT 0.00,
    date_creation TIMESTAMP DEFAULT NOW(),
    duree_validite_jours INTEGER,
    actif BOOLEAN DEFAULT true,
    compagnie_id INTEGER NOT NULL,
    emplacement_id INTEGER,

    CONSTRAINT fk_service_compagnie
        FOREIGN KEY (compagnie_id)
        REFERENCES COMPAGNIESTRANSPORT(id)
        ON DELETE CASCADE,
        
    CONSTRAINT fk_emplacement_service
        FOREIGN KEY (emplacement_id)
        REFERENCES EMPLACEMENTSTRANSPORT(id)
        ON DELETE SET NULL
);

/*FIN */

/*RESTAURANT FAST FOOD*/

CREATE TABLE RESTAURANTSFASTFOOD(
    id SERIAL PRIMARY KEY,
    nom_restaurant_fast_food VARCHAR(255) NOT NULL,
    description_restaurant_fast_food TEXT,
    portefeuille_restaurant_fast_food DECIMAL(15,3) DEFAULT 0.000,
    plateforme_id INTEGER NOT NULL,
    pourcentage_commission_plateforme DECIMAL NOT NULL CHECK (pourcentage_commission_plateforme BETWEEN 0 AND 100),

    date_de_creation TIMESTAMP DEFAULT NOW(),
    date_de_modification TIMESTAMP DEFAULT NOW()

    CONSTRAINT fk_plateforme_id_restaurant
        FOREIGN KEY (plateforme_id)
        REFERENCES  PLATEFORME(id)
        ON DELETE CASCADE
    
);

CREATE TABLE EMPLACEMENTSRESTAURANTFASTFOOD(
    id SERIAL PRIMARY KEY,
    nom_emplacement VARCHAR(255) NOT NULL,
    logo_restaurant VARCHAR(255),
    favicon_restaurant VARCHAR(255),
    localisation_restaurant POINT,
    adresse_complete TEXT,
    frais_livraison DECIMAL(10,2) DEFAULT 0.00,
    portefeuille_emplacement
    heure_ouverture TIME,
    heure_fermeture TIME,
    jours_ouverture_emplacement_restaurant jours_ouverture DEFAULT 'LUNDI-VENDREDI',
    id_restaurant_fast_food INTEGER NOT NULL,
    date_de_creation TIMESTAMP DEFAULT NOW,
    date_de_modification TIMESTAMP DEFAULT NOW

    CONSTRAINT fk_restaurant_compagnie
        FOREIGN KEY (id_restaurant_fast_food)
        REFERENCES RESTAURANTSFASTFOOD(id)
        ON DELETE CASCADE
);

-- Index pour la localisation
CREATE INDEX idx_emplacement_localisation ON EMPLACEMENTSRESTAURANTFASTFOOD USING GIST(localisation_restaurant);

CREATE TABLE MENURESTAURANTFASTFOOD(
    id SERIAL PRIMARY KEY,
    nom_menu VARCHAR(255) NOT NULL,
    description_menu TEXT,
    photo_menu VARCHAR(255),
    composition_menu JSONB DEFAULT '[]',
    disponible BOOLEAN DEFAULT FALSE,
    prix_menu DECIMAL(10,2),
    temps_preparation_min INTEGER,
    stock_disponible INTEGER DEFAULT -1,
    id_restaurant_fast_food_emplacement INTEGER NOT NULL,
    categorie_menu categories_menu ,
    date_creation TIMESTAMP DEFAULT NOW(),
    date_modification TIMESTAMP DEFAULT NOW(),
    est_journalier BOOLEAN DEFAULT TRUE,

    CONSTRAINT fk_restaurant_emplacement_id
        FOREIGN KEY (id_restaurant_fast_food_emplacement)
        REFERENCES EMPLACEMENTSRESTAURANTFASTFOOD(id)
        ON DELETE CASCADE
);
-- Index pour les recherches
CREATE INDEX idx_menu_emplacement ON MENURESTAURANTFASTFOOD(id_restaurant_fast_food_emplacement);
CREATE INDEX idx_menu_categorie ON MENURESTAURANTFASTFOOD(categorie_menu);



CREATE TABLE PRODUITSINDIVIDUELRESTAURANT(
    id SERIAL PRIMARY KEY,
    nom_produit VARCHAR(255),
    description_produit TEXT,
    photo_produit VARCHAR(255),
    donnees_produit JSONB DEFAULT '{}',
    stock_disponible INTEGER DEFAULT -1,/*-1 pour illimité */
    categorie_produit categories_produits,
    prix_produit DECIMAL(10,2)
    id_restaurant_fast_food_emplacement INTEGER NOT NULL,
    est_journalier DEFAULT TRUE,

    CONSTRAINT fk_restaurant_emplacement_id
        FOREIGN KEY (id_restaurant_fast_food_emplacement)
        REFERENCES EMPLACEMENTSRESTAURANTFASTFOOD(id)
        ON DELETE CASCADE
);

CREATE TABLE PROMOSRESTAURANTFASTFOOD(
    id SERIAL PRIMARY KEY,
    nom_promo VARCHAR(255),
    description_promo TEXT,
    code_promo VARCHAR(100),
    type_promo types_promo,
    id_restaurant_fast_food_emplacement INTEGER,
    pourcentage_reduction DECIMAL(5,2) NOT NULL CHECK (pourcentage_reduction BETWEEN 0 AND 100),
    montant_fixe_reduction DECIMAL(10,2),
    date_debut_promo TIMESTAMP NOT NULL,
    date_fin_promo TIMESTAMP NOT NULL,
    utilisation_max INTEGER DEFAULT -1,
    actif BOOLEAN DEFAULT TRUE,
    produit_affectes JSONB,
    date_creation TIMESTAMP DEFAULT NOW(),
    date_modification TIMESTAMP DEFAULT NOW(),

    CONSTRAINT fk_restaurant_emplacement_id
        FOREIGN KEY (id_restaurant_fast_food_emplacement)
        REFERENCES EMPLACEMENTSRESTAURANTFASTFOOD(id)
        ON DELETE CASCADE

     CONSTRAINT check_dates_promo CHECK (date_fin_promo > date_debut_promo)
);

CREATE TABLE PROMOSMENUS(
    promo_id INTEGER REFERENCES PROMOSRESTAURANTFASTFOOD(id) ON DELETE CASCADE,
    menu_id INTEGER REFERENCES MENURESTAURANTFASTFOOD(id) ON DELETE CASCADE,
    PRIMARY KEY (promo_id, menu_id)
);

CREATE TABLE PROMOSPRODUITS(
    promo_id INTEGER REFERENCES PROMOSRESTAURANTFASTFOOD(id) ON DELETE CASCADE,
    produit_id INTEGER REFERENCES PRODUITSINDIVIDUELRESTAURANT(id) ON DELETE CASCADE,
    PRIMARY KEY (promo_id, produit_id)
);

CREATE TABLE COMMANDESEMPLACEMENTFASTFOOD(
    id SERIAL PRIMARY KEY,
    id_restaurant_fast_food_emplacement INTEGER,
    donnees_commande JSONB DEFAULT '[]'
    date_commande TIMESTAMP DEFAULT NOW(),
    prix_total_commande DECIMAL(10,2),
    valide BOOLEAN DEFAULT FALSE, /*la commande à elle été effectué*/
    pour_livrer BOOLEAN DEFAULT FALSE,/* la commande est elle à livrer*/ 
    passer_recuperer BOOLEAN DEFAULT FALSE,/* l'utilisateur passera t_il chercher sa commande */
    paiement_direct BOOLEAN DEFAULT FALSE,/* le paiement se fera t'il sur la plateforme directement après avoir passé la commande */
    paiement_a_la_livraison BOOLEAN DEFAULT FALSE,/* le paiement se fera t'il à la livraison du produit sur la plateforme*/
    paiement_a_la_recuperation BOOLEAN DEFAULT FALSE,/*le paiement se fera t'il sur la plateforme lorsque l'utilisateur passera chercher sa commande */

    CONSTRAINT fk_commande_emplacement_rf
        FOREIGN KEY (id_restaurant_fast_food_emplacement)
        REFERENCES EMPLACEMENTSRESTAURANTFASTFOOD(id)
        ON DELETE CASCADE

);

/*FIN */

/*BOUTIQUES*/
CREATE TABLE BOUTIQUES(
    id SERIAL PRIMARY KEY,
    nom_boutique VARCHAR(100),
    description_boutique TEXT,
    logo_boutique VARCHAR(255),
    favicon_boutique VARCHAR(255),
    types_produits_vendu JSONB DEFAULT '[]',
    plateforme_id INTEGER NOT NULL,
    pourcentage_commission_plateforme INTEGER NOT NULL CHECK (pourcentage_commission_plateforme BETWEEN 0 AND 100),

    CONSTRAINT fk_plateforme_id_boutique
        FOREIGN KEY plateforme_id
        REFERENCES PLATEFORME(id)
        ON DELETE CASCADE
);

CREATE TABLE CATEGORIES_BOUTIQUE(
    id SERIAL PRIMARY KEY,
    nom_categorie VARCHAR(100) NOT NULL,
    description_categorie TEXT
);

CREATE TABLE PRODUITSBOUTIQUE(
    id SERIAL PRIMARY KEY,
    nom_produit VARCHAR(100) NOT NULL,
    image_produit VARCHAR(255),
    description_produit TEXT,
    donnees_supplementaire JSONB DEFAULT '[]',
    prix_unitaire_produit DECIMAL(10,2),
    quantite INTEGER DEFAULT -1,
    id_categorie INTEGER NOT NULL,
    

    CONSTRAINT fk_categorie_id_produit
        FOREIGN KEY (id_categorie)
        REFERENCES CATEGORIES_BOUTIQUE(id)
        ON DELETE CASCADE
);



CREATE TABLE COMMANDESBOUTIQUES(
    id SERIAL PRIMARY KEY,
    id_boutique INTEGER NOT NULL,
    donnees_commandes JSONB DEFAULT '[]',
    prix_total_commande DECIMAL(10,2),
    valide BOOLEAN DEFAULT FALSE, /*la commande à elle été effectué*/
    pour_livrer BOOLEAN DEFAULT FALSE,/* la commande est elle à livrer*/ 
    passer_recuperer BOOLEAN DEFAULT FALSE,/* l'utilisateur passera t_il chercher sa commande */
    paiement_direct BOOLEAN DEFAULT FALSE,/* le paiement se fera t'il sur la plateforme directement après avoir passé la commande */
    paiement_a_la_livraison BOOLEAN DEFAULT FALSE,/* le paiement se fera t'il à la livraison du produit sur la plateforme*/
    paiement_a_la_recuperation BOOLEAN DEFAULT FALSE,/*le paiement se fera t'il sur la plateforme lorsque l'utilisateur passera chercher sa commande */
);

/*FIN */



/*SERVICES LIVRAISON*/


CREATE TABLE ENTREPRISE_LIVRAISON(
    id SERIAL PRIMARY KEY,
    nom_entreprise_livraison VARCHAR(100),
    description_entreprise_livraison TEXT,
    logo_entreprise_livraison VARCHAR(255),
    favicon_entreprise_livraison VARCHAR(255),
    localisation_entreprise POINT,
    pourcentage_commission_plateforme DECIMAL,
    portefeuille_entreprise_livraison DECIMAL
);

CREATE TABLE SERVICES_LIVRAISON(
    id SERIAL PRIMARY KEY,
    nom_service VARCHAR(255),
    types_service J
    description_service TEXT,
    prix_service DECIMAL,
    est_actif BOOLEAN,
    donnees_supplementaires JSON,
    id_entreprise_livraison INTEGER NOT NULL,

    
);
CREATE TABLE DEMANDES_LIVRAISON(
    id SERIAL PRIMARY KEY,
    details_livraison JSONB,
    est_effectue BOOLEAN DEFAULT FALSE,
    livreur_affecte INTEGER NOT NULL,
    commission DECIMAL
    
);

CREATE TABLE LIVREURS(
    id SERIAL PRIMARY KEY,
    nom_livreur VARCHAR(255),
    prenom_livreur VARCHAR(255),
    photo_livreur VARCHAR(255),
    numero_telephone_livreur VARCHAR(20)
);
/*FIN*/

/*ALIMENTATIONS OR STORES */
CREATE TABLE STORE(

);
CREATE TABLE PRODUITS_STORE();
CREATE TABLE COMMANDES_STORE();

/*FIN */

/*EVENEMENTS */

/*FIN */

/*BLOG*/
-- Type pour le statut des articles
CREATE TYPE statut_article AS ENUM(
    'BROUILLON',
    'EN_ATTENTE_VALIDATION',
    'PUBLIE',
    'PROGRAMME',
    'ARCHIVE',
    'SIGNALE',
    'SUPPRIME'
);

-- Type pour les catégories d'articles
CREATE TYPE categories_article AS ENUM(
    'ACTUALITE',
    'TUTORIEL',
    'ASTUCE',
    'GUIDE',
    'AVIS',
    'TEST_PRODUIT',
    'COMPARAISON',
    'PROMOTION',
    'EVENEMENT',
    'INTERVIEW',
    'DOSSIER',
    'OPINION',
    'TENDANCE',
    'VIE_LOCALE',
    'TRANSPORT',
    'RESTAURATION',
    'BOUTIQUE',
    'COMMUNAUTE'
);

-- Type pour la visibilité
CREATE TYPE visibilite_article AS ENUM(
    'PUBLIC',
    'ABONNES',
    'PRIVE',
    'EQUIPE'
);


CREATE TABLE ARTICLES_BLOG_PLATEFORME(
    id SERIAL PRIMARY KEY,
    
    -- Contenu principal
    titre_article VARCHAR(255) NOT NULL,
    sous_titre VARCHAR(500),
    slug VARCHAR(300) UNIQUE NOT NULL,  -- Pour URL SEO-friendly
    contenu_article TEXT NOT NULL,
    extrait_contenu TEXT,  -- Résumé pour les listes/cartes
    langue VARCHAR(10) DEFAULT 'fr',
    
    -- Média
    image_principale VARCHAR(255),
    image_secondaire VARCHAR(255),
    video_url VARCHAR(500),
    gallery_images JSONB DEFAULT '[]',  -- Stockage des URLs d'images
    documents_joints JSONB DEFAULT '[]', -- Pour fichiers PDF, etc.
    
    -- Métadonnées
    meta_titre VARCHAR(255),
    meta_description TEXT,
    mots_cles TEXT[],  -- Tags pour SEO
    categorie_principale categories_article NOT NULL,
    categories_secondaires categories_article[],
    
    -- Statut et visibilité
    statut statut_article DEFAULT 'BROUILLON',
    visibilite visibilite_article DEFAULT 'PUBLIC',
    est_epingle BOOLEAN DEFAULT false,  -- Article en une
    est_archive BOOLEAN DEFAULT false,
    est_commentaire_actif BOOLEAN DEFAULT true,
    
    -- Dates
    date_creation TIMESTAMP DEFAULT NOW(),
    date_modification TIMESTAMP DEFAULT NOW(),
    date_publication TIMESTAMP,  -- Date de publication effective
    date_programmation TIMESTAMP, -- Date programmée (si PROGRAMME)
    date_archivage TIMESTAMP,
    
    -- Auteur et validation
    auteur_id INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE RESTRICT,
    co_auteurs INTEGER[] DEFAULT '{}', -- IDs des co-auteurs
    valide_par INTEGER REFERENCES COMPTES(id),
    date_validation TIMESTAMP,
    commentaire_validation TEXT,
    
    -- Statistiques
    nombre_vues INTEGER DEFAULT 0,
    nombre_vues_uniques INTEGER DEFAULT 0,  -- Basé sur IP/compte
    nombre_likes INTEGER DEFAULT 0,
    nombre_dislikes INTEGER DEFAULT 0,
    nombre_partages INTEGER DEFAULT 0,
    nombre_commentaires INTEGER DEFAULT 0,
    temps_lecture_minutes INTEGER,  -- Calculé automatiquement
    
    -- Références aux entités de la plateforme (optionnel)
    plateforme_id INTEGER REFERENCES PLATEFORME(id) ON DELETE SET NULL,
    compagnie_id INTEGER REFERENCES COMPAGNIESTRANSPORT(id) ON DELETE SET NULL,
    emplacement_transport_id INTEGER REFERENCES EMPLACEMENTSTRANSPORT(id) ON DELETE SET NULL,
    restaurant_id INTEGER REFERENCES RESTAURANTSFASTFOOD(id) ON DELETE SET NULL,
    emplacement_restaurant_id INTEGER REFERENCES EMPLACEMENTSRESTAURANTFASTFOOD(id) ON DELETE SET NULL,
    boutique_id INTEGER REFERENCES BOUTIQUES(id) ON DELETE SET NULL,
    produit_boutique_id INTEGER REFERENCES PRODUITSBOUTIQUE(id) ON DELETE SET NULL,
    menu_id INTEGER REFERENCES MENURESTAURANTFASTFOOD(id) ON DELETE SET NULL,
    promo_id INTEGER REFERENCES PROMOSRESTAURANTFASTFOOD(id) ON DELETE SET NULL,
    
    -- Paramètres avancés
    est_disponible_hors_ligne BOOLEAN DEFAULT false,  -- Pour app mobile
    droit_lecture_minimum_role compte_role,  -- Role minimum pour lire
    mot_de_passe_protege VARCHAR(255),  -- Si protégé par mot de passe
    redirection_url VARCHAR(500),  -- Si article de redirection
    
    -- Contraintes
    CONSTRAINT check_dates_publication CHECK (
        date_publication IS NULL OR 
        date_publication <= NOW()
    ),
    CONSTRAINT check_dates_programmation CHECK (
        statut != 'PROGRAMME' OR 
        (date_programmation IS NOT NULL AND date_programmation > NOW())
    )
);

-- Index pour optimiser les recherches
CREATE INDEX idx_blog_titre ON BLOG_PLATEFORME(titre_article);
CREATE INDEX idx_blog_slug ON BLOG_PLATEFORME(slug);
CREATE INDEX idx_blog_categorie ON BLOG_PLATEFORME(categorie_principale);
CREATE INDEX idx_blog_statut ON BLOG_PLATEFORME(statut);
CREATE INDEX idx_blog_date_publication ON BLOG_PLATEFORME(date_publication);
CREATE INDEX idx_blog_auteur ON BLOG_PLATEFORME(auteur_id);
CREATE INDEX idx_blog_epingle ON BLOG_PLATEFORME(est_epingle) WHERE est_epingle = true;
CREATE INDEX idx_blog_tags ON BLOG_PLATEFORME USING GIN(mots_cles);

-- Type pour le statut des commentaires
CREATE TYPE statut_commentaire AS ENUM(
    'EN_ATTENTE',
    'APPROUVE',
    'REJETE',
    'SIGNALE',
    'SUPPRIME',
    'MASQUE'
);

CREATE TABLE COMMENTAIRES(
    id SERIAL PRIMARY KEY,
    
    -- Contenu
    contenu_commentaire TEXT NOT NULL,
    contenu_original TEXT,  -- Sauvegarde avant modération
    langue VARCHAR(10) DEFAULT 'fr',
    
    -- Références
    article_id INTEGER NOT NULL REFERENCES BLOG_PLATEFORME(id) ON DELETE CASCADE,
    commentaire_parent_id INTEGER REFERENCES COMMENTAIRES(id) ON DELETE CASCADE,
    auteur_id INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    
    -- Statut et modération
    statut statut_commentaire DEFAULT 'EN_ATTENTE',
    est_anonyme BOOLEAN DEFAULT false,  -- Si l'utilisateur veut rester anonyme
    pseudo_anonyme VARCHAR(100),  -- Si anonyme, pseudo choisi
    note INTEGER CHECK (note BETWEEN 1 AND 5),  -- Notation sur 5
    
    -- Dates
    date_creation TIMESTAMP DEFAULT NOW(),
    date_modification TIMESTAMP DEFAULT NOW(),
    date_moderation TIMESTAMP,
    moderateur_id INTEGER REFERENCES COMPTES(id),
    
    -- Signalements
    nombre_signalements INTEGER DEFAULT 0,
    motif_signalements JSONB DEFAULT '[]',  -- Liste des motifs
    details_signalement TEXT,
    
    -- Statistiques
    nombre_likes INTEGER DEFAULT 0,
    nombre_dislikes INTEGER DEFAULT 0,
    nombre_reponses INTEGER DEFAULT 0,
    
    -- Informations techniques
    adresse_ip INET,
    user_agent TEXT,
    
    -- Références optionnelles (pour commentaires liés à des entités spécifiques)
    compagnie_id INTEGER REFERENCES COMPAGNIESTRANSPORT(id) ON DELETE SET NULL,
    restaurant_id INTEGER REFERENCES RESTAURANTSFASTFOOD(id) ON DELETE SET NULL,
    boutique_id INTEGER REFERENCES BOUTIQUES(id) ON DELETE SET NULL,
    
    -- Contraintes
    CONSTRAINT check_pseudo_anonyme CHECK (
        (est_anonyme = false) OR 
        (est_anonyme = true AND pseudo_anonyme IS NOT NULL)
    )
);

-- Index pour optimiser
CREATE INDEX idx_commentaires_article ON COMMENTAIRES(article_id);
CREATE INDEX idx_commentaires_parent ON COMMENTAIRES(commentaire_parent_id);
CREATE INDEX idx_commentaires_auteur ON COMMENTAIRES(auteur_id);
CREATE INDEX idx_commentaires_statut ON COMMENTAIRES(statut);
CREATE INDEX idx_commentaires_date ON COMMENTAIRES(date_creation);
CREATE INDEX idx_commentaires_signalements ON COMMENTAIRES(nombre_signalements) WHERE nombre_signalements > 0;

-- Table pour les likes sur les articles
CREATE TABLE LIKES_ARTICLES(
    id SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES BLOG_PLATEFORME(id) ON DELETE CASCADE,
    compte_id INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    type_like VARCHAR(10) CHECK (type_like IN ('LIKE', 'DISLIKE')),
    date_like TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT unique_like_article_compte UNIQUE (article_id, compte_id)
);

-- Table pour les likes sur les commentaires
CREATE TABLE LIKES_COMMENTAIRES(
    id SERIAL PRIMARY KEY,
    commentaire_id INTEGER NOT NULL REFERENCES COMMENTAIRES(id) ON DELETE CASCADE,
    compte_id INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    type_like VARCHAR(10) CHECK (type_like IN ('LIKE', 'DISLIKE')),
    date_like TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT unique_like_commentaire_compte UNIQUE (commentaire_id, compte_id)
);

-- Table pour les signalements d'articles
CREATE TABLE SIGNALEMENTS_ARTICLES(
    id SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES BLOG_PLATEFORME(id) ON DELETE CASCADE,
    compte_id INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    motif VARCHAR(255) NOT NULL,
    description TEXT,
    statut VARCHAR(50) DEFAULT 'EN_ATTENTE',
    traite_par INTEGER REFERENCES COMPTES(id),
    date_signalement TIMESTAMP DEFAULT NOW(),
    date_traitement TIMESTAMP,
    action_entreprise TEXT,
    
    CONSTRAINT unique_signalement_article_compte UNIQUE (article_id, compte_id)
);

-- Table pour les signalements de commentaires
CREATE TABLE SIGNALEMENTS_COMMENTAIRES(
    id SERIAL PRIMARY KEY,
    commentaire_id INTEGER NOT NULL REFERENCES COMMENTAIRES(id) ON DELETE CASCADE,
    compte_id INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    motif VARCHAR(255) NOT NULL,
    description TEXT,
    statut VARCHAR(50) DEFAULT 'EN_ATTENTE',
    traite_par INTEGER REFERENCES COMPTES(id),
    date_signalement TIMESTAMP DEFAULT NOW(),
    date_traitement TIMESTAMP,
    action_entreprise TEXT,
    
    CONSTRAINT unique_signalement_commentaire_compte UNIQUE (commentaire_id, compte_id)
);

-- Table pour les partages d'articles
CREATE TABLE PARTAGES_ARTICLES(
    id SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES BLOG_PLATEFORME(id) ON DELETE CASCADE,
    compte_id INTEGER REFERENCES COMPTES(id) ON DELETE SET NULL,
    type_partage VARCHAR(50) NOT NULL, -- 'FACEBOOK', 'TWITTER', 'WHATSAPP', 'EMAIL', 'COPY_LINK'
    date_partage TIMESTAMP DEFAULT NOW(),
    adresse_ip INET
);

-- Table pour les favoris/sauvegardes d'articles
CREATE TABLE FAVORIS_ARTICLES(
    id SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES BLOG_PLATEFORME(id) ON DELETE CASCADE,
    compte_id INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    date_ajout TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT unique_favori_article_compte UNIQUE (article_id, compte_id)
);

-- Table pour les abonnements aux catégories/auteurs
CREATE TABLE ABONNEMENTS_BLOG(
    id SERIAL PRIMARY KEY,
    compte_id INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    type_abonnement VARCHAR(50) NOT NULL, -- 'CATEGORIE', 'AUTEUR', 'TAG'
    reference_id INTEGER NOT NULL, -- ID de la catégorie/auteur/tag
    date_abonnement TIMESTAMP DEFAULT NOW(),
    actif BOOLEAN DEFAULT true,
    
    CONSTRAINT unique_abonnement_compte UNIQUE (compte_id, type_abonnement, reference_id)
);

-- Table pour les notifications des articles
CREATE TABLE NOTIFICATIONS_BLOG(
    id SERIAL PRIMARY KEY,
    compte_id INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    type_notification VARCHAR(50) NOT NULL, -- 'NOUVEL_ARTICLE', 'NOUVEAU_COMMENTAIRE', 'REPONSE', 'SIGNALEMENT_TRAITE'
    article_id INTEGER REFERENCES BLOG_PLATEFORME(id) ON DELETE CASCADE,
    commentaire_id INTEGER REFERENCES COMMENTAIRES(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    est_lue BOOLEAN DEFAULT false,
    date_creation TIMESTAMP DEFAULT NOW(),
    date_lecture TIMESTAMP
);

-- Table pour les statistiques de lecture
CREATE TABLE STATS_LECTURE_ARTICLES(
    id SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES BLOG_PLATEFORME(id) ON DELETE CASCADE,
    compte_id INTEGER REFERENCES COMPTES(id) ON DELETE SET NULL,
    adresse_ip INET,
    user_agent TEXT,
    temps_lecture_secondes INTEGER,  -- Temps passé sur l'article
    pourcentage_lu DECIMAL(5,2),  -- Estimation du % de l'article lu
    date_lecture TIMESTAMP DEFAULT NOW(),
    session_id VARCHAR(255)  -- Pour regrouper les lectures d'une même session
);
/*FIN */


/*IMMOBILIER*/
/*FIN */

/*MESSAGERIE*/
-- Types pour la messagerie
CREATE TYPE type_conversation AS ENUM(
    'DIRECT',                    -- Conversation entre 2 utilisateurs
    'GROUPE',                    -- Groupe de discussion
    'SUPPORT',                   -- Conversation avec le support
    'COMMANDE',                  -- Liée à une commande
    'LIVRAISON',                 -- Liée à une livraison
    'SERVICE_CLIENT',            -- Service client d'une compagnie
    'NOTIFICATION_ADMIN',        -- Notifications administratives
    'ANNONCE_PLATEFORME',        -- Annonces de la plateforme
    'SIGNALEMENT',               -- Conversation sur un signalement
    'RECLAMATION'                -- Conversation sur une réclamation
);

CREATE TYPE role_conversation AS ENUM(
    'ADMIN',                     -- Administrateur de la conversation
    'MODERATEUR',                -- Modérateur
    'PARTICIPANT',               -- Participant standard
    'OBSERVATEUR',               -- Peut lire mais pas écrire
    'INVITE'                     -- Invité temporaire
);

CREATE TYPE statut_message AS ENUM(
    'ENVOYE',
    'RECU',
    'LU',
    'MODIFIE',
    'SUPPRIME',
    'SIGNALE'
);

CREATE TYPE type_piece_jointe AS ENUM(
    'IMAGE',
    'VIDEO',
    'AUDIO',
    'DOCUMENT',
    'LOCALISATION',
    'CONTACT'
);

CREATE TABLE CONVERSATIONS(
    id SERIAL PRIMARY KEY,
    
    -- Identification
    uuid_conversation UUID DEFAULT gen_random_uuid(),
    type_conversation type_conversation NOT NULL DEFAULT 'DIRECT',
    
    -- Informations générales
    titre_conversation VARCHAR(255),
    description_conversation TEXT,
    avatar_conversation VARCHAR(255),
    
    -- Configuration
    est_prive BOOLEAN DEFAULT true,           -- Conversation privée ou publique
    necessite_approbation BOOLEAN DEFAULT false, -- Approbation requise pour rejoindre
    est_archive BOOLEAN DEFAULT false,
    est_verrouille BOOLEAN DEFAULT false,     -- Plus de messages autorisés
    
    -- Références aux entités (polymorphisme)
    entite_type VARCHAR(50),  -- 'COMMANDE', 'LIVRAISON', 'RECLAMATION', etc.
    entite_id INTEGER,
    
    -- Métadonnées
    metadata JSONB DEFAULT '{}',
    tags TEXT[],
    
    -- Statistiques
    nombre_participants INTEGER DEFAULT 0,
    nombre_messages INTEGER DEFAULT 0,
    dernier_message_id INTEGER,
    date_dernier_message TIMESTAMP,
    
    -- Dates
    date_creation TIMESTAMP DEFAULT NOW(),
    date_modification TIMESTAMP DEFAULT NOW(),
    date_archivage TIMESTAMP,
    date_fermeture TIMESTAMP,
    
    -- Créateur
    cree_par INTEGER REFERENCES COMPTES(id) ON DELETE SET NULL,
    
    -- Index pour recherche
    CONSTRAINT unique_conversation_uuid UNIQUE (uuid_conversation)
);

CREATE INDEX idx_conversations_type ON CONVERSATIONS(type_conversation);
CREATE INDEX idx_conversations_entite ON CONVERSATIONS(entite_type, entite_id);
CREATE INDEX idx_conversations_date_dernier ON CONVERSATIONS(date_dernier_message DESC);
CREATE INDEX idx_conversations_tags ON CONVERSATIONS USING GIN(tags);

CREATE TABLE PARTICIPANTS_CONVERSATION(
    id SERIAL PRIMARY KEY,
    
    -- Références
    conversation_id INTEGER NOT NULL REFERENCES CONVERSATIONS(id) ON DELETE CASCADE,
    compte_id INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    
    -- Rôle et permissions
    role_participant role_conversation DEFAULT 'PARTICIPANT',
    permissions JSONB DEFAULT '{"peut_ecrire": true, "peut_inviter": false, "peut_supprimer": false}',
    
    -- État
    est_actif BOOLEAN DEFAULT true,
    est_bloque BOOLEAN DEFAULT false,
    est_administrateur BOOLEAN DEFAULT false,
    est_en_vedette BOOLEAN DEFAULT false,  -- Participant épinglé
    
    -- Personnalisation
    surnom_dans_conversation VARCHAR(100),  -- Surnom spécifique à cette conversation
    couleur_affichage VARCHAR(7),  -- Code hexadécimal
    
    -- Statistiques personnelles
    dernier_message_lu_id INTEGER,
    date_derniere_lecture TIMESTAMP,
    messages_non_lus INTEGER DEFAULT 0,
    date_dernier_message_envoye TIMESTAMP,
    
    -- Dates
    date_ajout TIMESTAMP DEFAULT NOW(),
    date_sortie TIMESTAMP,
    date_derniere_activite TIMESTAMP,
    date_blocage TIMESTAMP,
    bloque_par INTEGER REFERENCES COMPTES(id),
    
    -- Notification
    notifications_actives BOOLEAN DEFAULT true,
    mode_notification VARCHAR(20) DEFAULT 'TOUS' CHECK (mode_notification IN ('TOUS', 'MENTIONS', 'AUCUN')),
    
    -- Contrainte d'unicité
    CONSTRAINT unique_participant_conversation UNIQUE (conversation_id, compte_id),
    CONSTRAINT check_dates_sortie CHECK (date_sortie IS NULL OR date_sortie >= date_ajout)
);

CREATE INDEX idx_participants_conversation ON PARTICIPANTS_CONVERSATION(conversation_id);
CREATE INDEX idx_participants_compte ON PARTICIPANTS_CONVERSATION(compte_id);
CREATE INDEX idx_participants_actif ON PARTICIPANTS_CONVERSATION(est_actif) WHERE est_actif = true;

CREATE TABLE MESSAGES(
    id SERIAL PRIMARY KEY,
    
    -- Références
    uuid_message UUID DEFAULT gen_random_uuid(),
    conversation_id INTEGER NOT NULL REFERENCES CONVERSATIONS(id) ON DELETE CASCADE,
    expediteur_id INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    message_parent_id INTEGER REFERENCES MESSAGES(id) ON DELETE SET NULL,  -- Pour les réponses
    
    -- Contenu
    contenu_message TEXT,
    contenu_formatte TEXT,  -- Version HTML/Markdown
    type_Message VARCHAR(20) DEFAULT 'TEXTE' CHECK (type_message IN ('TEXTE', 'IMAGE', 'VIDEO', 'AUDIO', 'FICHIER', 'SYSTEME', 'LOCALISATION')),
    
    -- État
    statut statut_message DEFAULT 'ENVOYE',
    est_important BOOLEAN DEFAULT false,      -- Message épinglé
    est_silencieux BOOLEAN DEFAULT false,     -- Ne pas notifier
    est_systeme BOOLEAN DEFAULT false,        -- Message généré par le système
    
    -- Références
    reponse_a_id INTEGER REFERENCES MESSAGES(id) ON DELETE SET NULL,  -- Message auquel on répond
    mentions_comptes INTEGER[] DEFAULT '{}',   -- IDs des comptes mentionnés (@username)
    
    -- Métadonnées
    metadata JSONB DEFAULT '{}',
    adresse_ip INET,
    user_agent TEXT,
    
    -- Dates
    date_envoi TIMESTAMP DEFAULT NOW(),
    date_modification TIMESTAMP,
    date_suppression TIMESTAMP,
    date_lecture TIMESTAMP,
    
    -- Pour les messages modifiés
    historique_modifications JSONB DEFAULT '[]',  -- Sauvegarde des versions précédentes
    
    -- Supprimé par
    supprime_par INTEGER REFERENCES COMPTES(id),
    motif_suppression VARCHAR(255),
    
    -- Contraintes
    CONSTRAINT check_contenu_requis CHECK (
        (type_message = 'TEXTE' AND contenu_message IS NOT NULL) OR
        (type_message != 'TEXTE' AND metadata IS NOT NULL)
    )
);

-- Index pour performance
CREATE INDEX idx_messages_conversation ON MESSAGES(conversation_id, date_envoi DESC);
CREATE INDEX idx_messages_expediteur ON MESSAGES(expediteur_id);
CREATE INDEX idx_messages_statut ON MESSAGES(statut);
CREATE INDEX idx_messages_date ON MESSAGES(date_envoi);
CREATE INDEX idx_messages_uuid ON MESSAGES(uuid_message);
CREATE INDEX idx_messages_mentions ON MESSAGES USING GIN(mentions_comptes);

CREATE TABLE PIECES_JOINTES(
    id SERIAL PRIMARY KEY,
    
    -- Référence
    message_id INTEGER NOT NULL REFERENCES MESSAGES(id) ON DELETE CASCADE,
    
    -- Fichier
    uuid_fichier UUID DEFAULT gen_random_uuid(),
    nom_fichier VARCHAR(255) NOT NULL,
    type_fichier type_piece_jointe NOT NULL,
    mime_type VARCHAR(100),
    taille_fichier INTEGER,  -- en octets
    chemin_fichier VARCHAR(500),
    url_telechargement VARCHAR(500),
    
    -- Média
    largeur_image INTEGER,  -- Pour les images
    hauteur_image INTEGER,
    duree_media INTEGER,    -- Pour vidéos/audio (en secondes)
    thumbnail_url VARCHAR(500),  -- Miniature pour vidéos
    
    -- Métadonnées
    metadata JSONB DEFAULT '{}',
    
    -- Sécurité
    est_public BOOLEAN DEFAULT false,
    mot_de_passe_protege BOOLEAN DEFAULT false,
    date_expiration TIMESTAMP,
    
    -- Statistiques
    nombre_telechargements INTEGER DEFAULT 0,
    
    -- Dates
    date_upload TIMESTAMP DEFAULT NOW(),
    
    -- Contrainte
    CONSTRAINT unique_uuid_fichier UNIQUE (uuid_fichier)
);

CREATE INDEX idx_pieces_jointes_message ON PIECES_JOINTES(message_id);
CREATE INDEX idx_pieces_jointes_type ON PIECES_JOINTES(type_fichier);


CREATE TABLE REACTIONS_MESSAGES(
    id SERIAL PRIMARY KEY,
    
    -- Références
    message_id INTEGER NOT NULL REFERENCES MESSAGES(id) ON DELETE CASCADE,
    compte_id INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    
    -- Réaction
    emoji VARCHAR(50) NOT NULL,  -- Stocker l'emoji (👍, ❤️, 😂, etc.)
    
    -- Dates
    date_reaction TIMESTAMP DEFAULT NOW(),
    
    -- Contrainte d'unicité (une seule réaction par utilisateur par message)
    CONSTRAINT unique_reaction_message_compte UNIQUE (message_id, compte_id)
);

CREATE INDEX idx_reactions_message ON REACTIONS_MESSAGES(message_id);


CREATE TABLE LECTURES_MESSAGES(
    id SERIAL PRIMARY KEY,
    
    -- Références
    message_id INTEGER NOT NULL REFERENCES MESSAGES(id) ON DELETE CASCADE,
    compte_id INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    
    -- Information de lecture
    date_lecture TIMESTAMP DEFAULT NOW(),
    adresse_ip INET,
    
    -- Contrainte d'unicité
    CONSTRAINT unique_lecture_message_compte UNIQUE (message_id, compte_id)
);

CREATE INDEX idx_lectures_message ON LECTURES_MESSAGES(message_id);
CREATE INDEX idx_lectures_compte ON LECTURES_MESSAGES(compte_id);


CREATE TABLE INVITATIONS_CONVERSATION(
    id SERIAL PRIMARY KEY,
    
    -- Références
    conversation_id INTEGER NOT NULL REFERENCES CONVERSATIONS(id) ON DELETE CASCADE,
    invite_par INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    email_invite VARCHAR(255),  -- Si invitation par email
    compte_id INTEGER REFERENCES COMPTES(id) ON DELETE CASCADE,  -- Si utilisateur existant
    
    -- Token d'invitation
    token_invitation VARCHAR(255) UNIQUE NOT NULL,
    
    -- Rôle proposé
    role_propose role_conversation DEFAULT 'PARTICIPANT',
    
    -- Message d'invitation
    message_personnalise TEXT,
    
    -- Statut
    statut VARCHAR(50) DEFAULT 'EN_ATTENTE' CHECK (statut IN ('EN_ATTENTE', 'ACCEPTEE', 'REFUSEE', 'EXPIREE')),
    
    -- Dates
    date_envoi TIMESTAMP DEFAULT NOW(),
    date_reponse TIMESTAMP,
    date_expiration TIMESTAMP DEFAULT (NOW() + INTERVAL '7 days'),
    
    -- Contrainte
    CONSTRAINT check_destinataire CHECK (
        (email_invite IS NOT NULL AND compte_id IS NULL) OR
        (email_invite IS NULL AND compte_id IS NOT NULL)
    )
);

CREATE INDEX idx_invitations_token ON INVITATIONS_CONVERSATION(token_invitation);
CREATE INDEX idx_invitations_conversation ON INVITATIONS_CONVERSATION(conversation_id);


CREATE TABLE BLOCAGES_UTILISATEURS(
    id SERIAL PRIMARY KEY,
    
    -- Qui bloque qui
    compte_bloqueur INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    compte_bloque INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    
    -- Portée du blocage
    type_blocage VARCHAR(50) DEFAULT 'MESSAGERIE' CHECK (type_blocage IN ('MESSAGERIE', 'CONVERSATION', 'GLOBAL')),
    conversation_id INTEGER REFERENCES CONVERSATIONS(id) ON DELETE CASCADE,  -- Si blocage spécifique à une conversation
    
    -- Raison
    motif VARCHAR(255),
    est_temporaire BOOLEAN DEFAULT false,
    date_fin_blocage TIMESTAMP,
    
    -- Dates
    date_blocage TIMESTAMP DEFAULT NOW(),
    date_deblocage TIMESTAMP,
    
    -- Contrainte d'unicité
    CONSTRAINT unique_blocage UNIQUE (compte_bloqueur, compte_bloque, conversation_id),
    CONSTRAINT check_pas_soi_meme CHECK (compte_bloqueur != compte_bloque)
);

CREATE INDEX idx_blocages_comptes ON BLOCAGES_UTILISATEURS(compte_bloqueur, compte_bloque);


CREATE TABLE MODELES_MESSAGES(
    id SERIAL PRIMARY KEY,
    
    -- Propriétaire
    compte_id INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    
    -- Contenu
    titre VARCHAR(255) NOT NULL,
    contenu_message TEXT NOT NULL,
    
    -- Catégorisation
    categorie VARCHAR(100),
    tags TEXT[],
    
    -- Raccourci
    raccourci VARCHAR(50),  -- Ex: "/bonjour" pour insérer rapidement
    
    -- Statistiques
    nombre_utilisations INTEGER DEFAULT 0,
    
    -- Dates
    date_creation TIMESTAMP DEFAULT NOW(),
    date_modification TIMESTAMP DEFAULT NOW(),
    dernier_usage TIMESTAMP,
    
    -- Partage
    est_partage_public BOOLEAN DEFAULT false,
    
    -- Contrainte
    CONSTRAINT unique_raccourci_compte UNIQUE (compte_id, raccourci) 
    WHERE raccourci IS NOT NULL
);

CREATE INDEX idx_modeles_compte ON MODELES_MESSAGES(compte_id);


-- Vue pour obtenir les conversations avec dernier message
CREATE VIEW VUE_CONVERSATIONS_RECENTES AS
SELECT 
    c.id,
    c.uuid_conversation,
    c.titre_conversation,
    c.type_conversation,
    c.est_prive,
    c.nombre_participants,
    c.nombre_messages,
    (
        SELECT row_to_json(m)
        FROM (
            SELECT m.id, m.contenu_message, m.date_envoi, 
                   exp.nom_utilisateur_compte as expediteur_nom,
                   exp.photo_profil_compte as expediteur_photo
            FROM MESSAGES m
            JOIN COMPTES exp ON exp.id = m.expediteur_id
            WHERE m.conversation_id = c.id
            ORDER BY m.date_envoi DESC
            LIMIT 1
        ) m
    ) as dernier_message,
    (
        SELECT json_agg(p)
        FROM (
            SELECT pc.compte_id, cmp.nom_utilisateur_compte, cmp.photo_profil_compte,
                   pc.role_participant, pc.messages_non_lus
            FROM PARTICIPANTS_CONVERSATION pc
            JOIN COMPTES cmp ON cmp.id = pc.compte_id
            WHERE pc.conversation_id = c.id AND pc.est_actif = true
        ) p
    ) as participants
FROM CONVERSATIONS c
WHERE c.est_archive = false;


-- Fonction pour mettre à jour les statistiques de conversation
CREATE OR REPLACE FUNCTION update_conversation_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE CONVERSATIONS 
        SET nombre_messages = nombre_messages + 1,
            dernier_message_id = NEW.id,
            date_dernier_message = NEW.date_envoi
        WHERE id = NEW.conversation_id;
        
        -- Mettre à jour le dernier message lu pour l'expéditeur
        UPDATE PARTICIPANTS_CONVERSATION 
        SET dernier_message_lu_id = NEW.id,
            date_derniere_lecture = NEW.date_envoi
        WHERE conversation_id = NEW.conversation_id 
          AND compte_id = NEW.expediteur_id;
        
        -- Incrémenter les messages non lus pour les autres participants
        UPDATE PARTICIPANTS_CONVERSATION 
        SET messages_non_lus = messages_non_lus + 1
        WHERE conversation_id = NEW.conversation_id 
          AND compte_id != NEW.expediteur_id
          AND notifications_actives = true;
          
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE CONVERSATIONS 
        SET nombre_messages = nombre_messages - 1
        WHERE id = OLD.conversation_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_message_stats
    AFTER INSERT OR DELETE ON MESSAGES
    FOR EACH ROW
    EXECUTE FUNCTION update_conversation_stats();

-- Fonction pour marquer les messages comme lus
CREATE OR REPLACE FUNCTION marquer_messages_comme_lus(
    p_conversation_id INTEGER,
    p_compte_id INTEGER
) RETURNS VOID AS $$
BEGIN
    -- Mettre à jour le statut des messages
    UPDATE MESSAGES 
    SET statut = 'LU'
    WHERE conversation_id = p_conversation_id 
      AND expediteur_id != p_compte_id
      AND statut != 'LU';
    
    -- Mettre à jour le compteur de non-lus
    UPDATE PARTICIPANTS_CONVERSATION 
    SET messages_non_lus = 0,
        dernier_message_lu_id = (
            SELECT id FROM MESSAGES 
            WHERE conversation_id = p_conversation_id 
            ORDER BY date_envoi DESC LIMIT 1
        ),
        date_derniere_lecture = NOW()
    WHERE conversation_id = p_conversation_id 
      AND compte_id = p_compte_id;
END;
$$ LANGUAGE plpgsql;
/*FIN */

/*NOTIFICATION*/
/*FIN*/


CREATE TABLE COMPTES(
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    mot_de_passe_compte VARCHAR(255) NOT NULL,
    nom_utilisateur_compte VARCHAR(255) UNIQUE NOT NULL,
    numero_de_telephone VARCHAR(20) UNIQUE NOT NULL,
    cni_photo VARCHAR(255),
    photo_profil_compte VARCHAR(255),
    localisation_livraison POINT,
    statut statut_compte DEFAULT 'NON_AUTHENTIFIE',
    code_authentification VARCHAR(6),
    compte_role compte_role DEFAULT 'UTILISATEUR_PRIVE_SIMPLE',
    compagnie_id INTEGER,
    emplacement_id INTEGER,
    date_creation TIMESTAMP DEFAULT NOW(),
    date_derniere_connexion TIMESTAMP,
    date_verouillage TIMESTAMP,
    tentatives_echec_connexion INTEGER DEFAULT 0,

    CONSTRAINT fk_compagnie_compte
        FOREIGN KEY (compagnie_id)
        REFERENCES COMPAGNIESTRANSPORT(id)
        ON DELETE SET NULL,
        
    CONSTRAINT fk_emplacement_compte
        FOREIGN KEY (emplacement_id)
        REFERENCES EMPLACEMENTSTRANSPORT(id)
        ON DELETE SET NULL
);

CREATE TABLE ACHATSTICKETSPRIVE(
    id SERIAL PRIMARY KEY,
    compte_id INTEGER NOT NULL,
    ticket_id INTEGER NOT NULL,
    quantite INTEGER NOT NULL DEFAULT 1 CHECK (quantite > 0),
    prix_achat_unitaire_ticket DECIMAL(10,2) NOT NULL,
    total_transaction DECIMAL(10,2) NOT NULL,
    transaction_uuid UUID DEFAULT gen_random_uuid(),
    date_achat_prive TIMESTAMP DEFAULT NOW(),
    date_expiration_ticket TIMESTAMP,
    est_actif BOOLEAN DEFAULT true,
    info_acheteur JSONB,
    
    CONSTRAINT fk_compte_utilisateur_prive
        FOREIGN KEY (compte_id)
        REFERENCES COMPTES(id)
        ON DELETE CASCADE,
        
    CONSTRAINT fk_ticket_achats_prive
        FOREIGN KEY (ticket_id)
        REFERENCES TICKETSTRANSPORT(id)
        ON DELETE RESTRICT
);

CREATE TABLE ACHATSSERVICESPRIVE(
    id SERIAL PRIMARY KEY,
    service_id INTEGER NOT NULL,
    compte_id INTEGER NOT NULL,
    transaction_uuid UUID DEFAULT gen_random_uuid(),
    prix_achat_service DECIMAL(10,2) NOT NULL,
    date_achat_service TIMESTAMP DEFAULT NOW(),
    date_expiration TIMESTAMP,
    est_actif BOOLEAN DEFAULT true,
    info_acheteur JSONB,
    
    CONSTRAINT fk_service_achat_prive
        FOREIGN KEY (service_id)
        REFERENCES SERVICES(id)
        ON DELETE RESTRICT,
        
    CONSTRAINT fk_compte_utilisateur_prive
        FOREIGN KEY (compte_id)
        REFERENCES COMPTES(id)
        ON DELETE CASCADE
);

CREATE TABLE ACHATSTICKETSPUBLIQUES(
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL,
    quantite INTEGER NOT NULL DEFAULT 1 CHECK (quantite > 0),
    prix_unitaire DECIMAL(10,2) NOT NULL,
    prix_total_achat DECIMAL(10,2) NOT NULL,
    transaction_uuid UUID DEFAULT gen_random_uuid(),
    date_achat TIMESTAMP DEFAULT NOW(),
    date_expiration TIMESTAMP,
    est_actif BOOLEAN DEFAULT true,
    info_acheteur JSONB NOT NULL,
    
    CONSTRAINT fk_ticket_achats_publique
        FOREIGN KEY (ticket_id)
        REFERENCES TICKETSTRANSPORT(id)
        ON DELETE RESTRICT
);

CREATE TABLE DEMANDESERVICE(
    id SERIAL PRIMARY KEY,
    compte_id INTEGER,
    service_id INTEGER NOT NULL,
    compagnie_id INTEGER NOT NULL,
    cni_photo VARCHAR(255),
    document_verification VARCHAR(255),
    prix_total DECIMAL(10,2) NOT NULL,
    statut_demande VARCHAR(50) DEFAULT 'EN_ATTENTE',
    est_valide_par_emplacement BOOLEAN DEFAULT false,
    est_valide_par_compagnie BOOLEAN DEFAULT false,
    date_demande TIMESTAMP DEFAULT NOW(),
    date_validation TIMESTAMP,
    valide_par INTEGER,
    commentaires TEXT,

    CONSTRAINT fk_compte_demande_service
        FOREIGN KEY (compte_id)
        REFERENCES COMPTES(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_service_demande_service
        FOREIGN KEY (service_id)
        REFERENCES SERVICES(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_compagnie_demande_service
        FOREIGN KEY (compagnie_id)
        REFERENCES COMPAGNIESTRANSPORT(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_valide_par_compte
        FOREIGN KEY (valide_par)
        REFERENCES COMPTES(id)
        ON DELETE SET NULL
);


CREATE TABLE HISTORIQUE_ACTIONS (
    id SERIAL PRIMARY KEY,
    action_type VARCHAR(50) NOT NULL,
    table_concernee VARCHAR(50) NOT NULL,
    entite_id INTEGER NOT NULL,
    donnees_avant JSONB,
    donnees_apres JSONB,
    utilisateur_id INTEGER,
    ip_adresse INET,
    user_agent TEXT,
    date_action TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT fk_utilisateur_historique
        FOREIGN KEY (utilisateur_id)
        REFERENCES COMPTES(id)
        ON DELETE SET NULL
);




CREATE TABLE HISTORIQUE_TRANSACTIONS (
    id SERIAL PRIMARY KEY,
    type_transaction VARCHAR(50) NOT NULL, -- 'ACHAT', 'VENTE', 'REMBOURSEMENT', 'COMMISSION', 'TRANSFERT'
    montant DECIMAL(15,2) NOT NULL,
    devise VARCHAR(3) DEFAULT 'EUR',
    statut_transaction VARCHAR(50) DEFAULT 'COMPLETEE', -- 'EN_ATTENTE', 'COMPLETEE', 'ECHOUEE', 'ANNULEE'
    compte_source_id INTEGER,
    compte_destination_id INTEGER,
    compagnie_id INTEGER,
    emplacement_id INTEGER,
    plateforme_id INTEGER,
    ticket_id INTEGER,
    service_id INTEGER,
    transaction_uuid UUID DEFAULT gen_random_uuid(),
    reference_externe VARCHAR(255),
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    date_transaction TIMESTAMP DEFAULT NOW(),
    date_validation TIMESTAMP,
    
    CONSTRAINT fk_compte_source
        FOREIGN KEY (compte_source_id)
        REFERENCES COMPTES(id)
        ON DELETE SET NULL,
        
    CONSTRAINT fk_compte_destination
        FOREIGN KEY (compte_destination_id)
        REFERENCES COMPTES(id)
        ON DELETE SET NULL,
        
    CONSTRAINT fk_compagnie_transaction
        FOREIGN KEY (compagnie_id)
        REFERENCES COMPAGNIESTRANSPORT(id)
        ON DELETE SET NULL,
        
    CONSTRAINT fk_emplacement_transaction
        FOREIGN KEY (emplacement_id)
        REFERENCES EMPLACEMENTSTRANSPORT(id)
        ON DELETE SET NULL,
        
    CONSTRAINT fk_plateforme_transaction
        FOREIGN KEY (plateforme_id)
        REFERENCES PLATEFORME(id)
        ON DELETE SET NULL,
        
    CONSTRAINT fk_ticket_transaction
        FOREIGN KEY (ticket_id)
        REFERENCES TICKETSTRANSPORT(id)
        ON DELETE SET NULL,
        
    CONSTRAINT fk_service_transaction
        FOREIGN KEY (service_id)
        REFERENCES SERVICES(id)
        ON DELETE SET NULL
);

CREATE TABLE HISTORIQUE_CONNEXIONS(
    id SERIAL PRIMARY KEY,
    compte_id INTEGER NOT NULL,
    type_connexion types_connexions,
    adresse_ip INET NOT NULL,  -- Type spécifique pour IP
    utilisateur_agent TEXT,  -- Navigateur/device info
    pays VARCHAR(100),  -- Détection géo
    ville VARCHAR(100),
    statut_connexion statuts_connexion,
    code_erreur VARCHAR(50),  -- Pour échecs d'authentification
    date_connexion TIMESTAMP DEFAULT NOW() NOT NULL,
    date_deconnexion TIMESTAMP,  -- Pour suivre la durée
    duree_session INTERVAL GENERATED ALWAYS AS (date_deconnexion - date_connexion) STORED,
    
    CONSTRAINT fk_compte_connexion
        FOREIGN KEY (compte_id)
        REFERENCES COMPTES(id)  -- À créer ou adapter
        ON DELETE CASCADE,
    
    CONSTRAINT check_dates_connexion 
        CHECK (date_deconnexion IS NULL OR date_deconnexion >= date_connexion)
);

-- Index pour performances

-- Création des index pour optimiser les performances
CREATE INDEX idx_comptes_email ON COMPTES(email);
CREATE INDEX idx_comptes_nom_utilisateur ON COMPTES(nom_utilisateur_compte);
CREATE INDEX idx_comptes_telephone ON COMPTES(numero_de_telephone);
CREATE INDEX idx_tickets_compagnie ON TICKETSTRANSPORT(compagnie_id);
CREATE INDEX idx_tickets_emplacement ON TICKETSTRANSPORT(emplacement_id);
CREATE INDEX idx_tickets_actif ON TICKETSTRANSPORT(actif);
CREATE INDEX idx_achats_prives_compte ON ACHATSTICKETSPRIVE(compte_id);
CREATE INDEX idx_achats_prives_ticket ON ACHATSTICKETSPRIVE(ticket_id);
CREATE INDEX idx_achats_publics_ticket ON ACHATSTICKETSPUBLIQUES(ticket_id);
CREATE INDEX idx_achats_prives_transaction ON ACHATSTICKETSPRIVE(transaction_uuid);
CREATE INDEX idx_achats_services_transaction ON ACHATSSERVICESPRIVE(transaction_uuid);
CREATE INDEX idx_achats_publics_transaction ON ACHATSTICKETSPUBLIQUES(transaction_uuid);
CREATE INDEX idx_demande_service_statut ON DEMANDESERVICE(statut_demande);
CREATE INDEX idx_demande_service_compte ON DEMANDESERVICE(compte_id);
CREATE INDEX idx_demande_service_compagnie ON DEMANDESERVICE(compagnie_id);
CREATE INDEX idx_historique_action_type ON HISTORIQUE_ACTIONS(action_type);
CREATE INDEX idx_historique_table ON HISTORIQUE_ACTIONS(table_concernee);
CREATE INDEX idx_historique_date ON HISTORIQUE_ACTIONS(date_action);
CREATE INDEX idx_historique_utilisateur ON HISTORIQUE_ACTIONS(utilisateur_id);
CREATE INDEX idx_transactions_type ON HISTORIQUE_TRANSACTIONS(type_transaction);
CREATE INDEX idx_transactions_date ON HISTORIQUE_TRANSACTIONS(date_transaction);
CREATE INDEX idx_transactions_uuid ON HISTORIQUE_TRANSACTIONS(transaction_uuid);
CREATE INDEX idx_transactions_statut ON HISTORIQUE_TRANSACTIONS(statut_transaction);
CREATE INDEX idx_hist_connexion_compte ON HISTORIQUE_CONNEXIONS(compte_id);
CREATE INDEX idx_hist_connexion_date ON HISTORIQUE_CONNEXIONS(date_connexion);
CREATE INDEX idx_hist_connexion_ip ON HISTORIQUE_CONNEXIONS(adresse_ip);