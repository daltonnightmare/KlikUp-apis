-- Extensions nécessaires
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- pour gen_random_uuid() et chiffrement

-- =============================================================================
-- SECTION 0 : FONCTION UTILITAIRE (doit exister avant tous les triggers)
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_update_date_mise_a_jour()
RETURNS TRIGGER AS $$
BEGIN
    NEW.date_mise_a_jour = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- SECTION 1 : TYPES ÉNUMÉRÉS
-- =============================================================================

CREATE TYPE compte_role AS ENUM(
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
    'UTILISATEUR_VENDEUR',
    'MULTI_FONCTION'
);

CREATE TYPE statut_compte AS ENUM(
    'EST_AUTHENTIFIE',
    'NON_AUTHENTIFIE',
    'SUSPENDU',
    'BANNI'
);

CREATE TYPE jours_ouverture AS ENUM(
    'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI',
    'SAMEDI', 'DIMANCHE',
    'TOUS_LES_JOURS',
    'LUNDI_VENDREDI',
    'LUNDI_SAMEDI',
    'LUNDI_DIMANCHE'
);

CREATE TYPE categories_menu AS ENUM(
    'PETIT_DEJEUNER', 'ENTREE', 'PLAT_PRINCIPAL', 'DESSERT', 'BOISSON',
    'MENU_ENFANT', 'MENU_PROMO', 'MENU_DU_JOUR', 'FORMULE_MIDI', 'FORMULE_SOIR',
    'ACCOMPAGNEMENT', 'SAUCE', 'SALADE', 'SOUPE', 'SANDWICH',
    'BURGER', 'PIZZA', 'KEBAB', 'TACOS', 'SUSHI',
    'WRAP', 'BOWL', 'PASTA', 'SALADE_COMPOSEE',
    'PLAT_AFRICAIN', 'PLAT_ASIATIQUE', 'PLAT_ITALIEN', 'PLAT_AMERICAIN'
);

CREATE TYPE categories_produits AS ENUM(
    'ALIMENTAIRE', 'BOISSON', 'HYGIENE', 'ELECTRONIQUE', 'VETEMENT',
    'ACCESSOIRE', 'MAISON', 'SPORT', 'BEAUTE', 'LIVRE', 'JOUET', 'AUTRE'
);

CREATE TYPE types_promo AS ENUM(
    'POURCENTAGE', 'MONTANT_FIXE', 'DEUX_POUR_UN',
    'LIVRAISON_GRATUITE', 'MENU_OFFERT', 'CODE_PROMO', 'FIDELITE'
);

CREATE TYPE types_service_livraison AS ENUM(
    'STANDARD', 'EXPRESS', 'PROGRAMMEE', 'NUIT', 'WEEKEND', 'INTERNATIONAL'
);

CREATE TYPE types_connexions AS ENUM(
    'CONNEXION', 'DECONNEXION'
);

CREATE TYPE statuts_connexion AS ENUM(
    'SUCCESS', 'FAILED', 'BLOCKED'
);

CREATE TYPE types_services_transport AS ENUM(
    'ABONNEMENT_MENSUEL', 'BIMENSUEL', 'TRIMESTRIEL', 'ANNUEL'
);

CREATE TYPE statut_article AS ENUM(
    'BROUILLON', 'EN_ATTENTE_VALIDATION', 'PUBLIE',
    'PROGRAMME', 'ARCHIVE', 'SIGNALE', 'SUPPRIME'
);

CREATE TYPE categories_article AS ENUM(
    'ACTUALITE', 'TUTORIEL', 'ASTUCE', 'GUIDE', 'AVIS',
    'TEST_PRODUIT', 'COMPARAISON', 'PROMOTION', 'EVENEMENT',
    'INTERVIEW', 'DOSSIER', 'OPINION', 'TENDANCE', 'VIE_LOCALE',
    'TRANSPORT', 'RESTAURATION', 'BOUTIQUE', 'COMMUNAUTE'
);

CREATE TYPE visibilite_article AS ENUM(
    'PUBLIC', 'ABONNES', 'PRIVE', 'EQUIPE'
);

CREATE TYPE statut_commentaire AS ENUM(
    'EN_ATTENTE', 'APPROUVE', 'REJETE', 'SIGNALE', 'SUPPRIME', 'MASQUE'
);

CREATE TYPE type_conversation AS ENUM(
    'DIRECT', 'GROUPE', 'SUPPORT', 'COMMANDE', 'LIVRAISON',
    'SERVICE_CLIENT', 'NOTIFICATION_ADMIN', 'ANNONCE_PLATEFORME',
    'SIGNALEMENT', 'RECLAMATION'
);

CREATE TYPE role_conversation AS ENUM(
    'ADMIN', 'MODERATEUR', 'PARTICIPANT', 'OBSERVATEUR', 'INVITE'
);

CREATE TYPE statut_message AS ENUM(
    'ENVOYE', 'RECU', 'LU', 'MODIFIE', 'SUPPRIME', 'SIGNALE'
);

CREATE TYPE type_piece_jointe AS ENUM(
    'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'LOCALISATION', 'CONTACT'
);

-- Statut de commande unifié pour fast-food ET boutiques
CREATE TYPE statut_commande AS ENUM(
    'EN_ATTENTE', 'CONFIRMEE', 'EN_PREPARATION', 'PRETE',
    'EN_LIVRAISON', 'LIVREE', 'RECUPEREE', 'ANNULEE', 'REMBOURSEE'
);

-- Type unifié pour les entités de référence (correction point 7)
CREATE TYPE entite_reference AS ENUM(
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
);

CREATE TYPE statut_avis AS ENUM(
    'EN_ATTENTE', 'PUBLIE', 'REJETE', 'SIGNALE', 'MASQUE'
);

CREATE TYPE canal_notification AS ENUM(
    'IN_APP', 'PUSH_MOBILE', 'EMAIL', 'SMS', 'WHATSAPP'
);

CREATE TYPE priorite_notification AS ENUM(
    'BASSE', 'NORMALE', 'HAUTE', 'CRITIQUE'
);

CREATE TYPE type_document AS ENUM(
    'CNI_RECTO', 'CNI_VERSO', 'PASSEPORT', 'PERMIS_CONDUIRE',
    'JUSTIFICATIF_DOMICILE', 'EXTRAIT_NAISSANCE', 'REGISTRE_COMMERCE',
    'ATTESTATION_FISCALE', 'CONTRAT', 'BON_COMMANDE', 'FACTURE',
    'RECU_PAIEMENT', 'PHOTO_LIVREUR', 'AUTRE'
);

CREATE TYPE statut_document AS ENUM(
    'EN_ATTENTE_VALIDATION', 'VALIDE', 'REFUSE', 'EXPIRE', 'REMPLACE'
);

CREATE TYPE statut_tache AS ENUM(
    'EN_ATTENTE', 'EN_COURS', 'COMPLETEE', 'ECHOUEE', 'ABANDONNEE'
);

CREATE TYPE type_mouvement_points AS ENUM(
    'GAIN_ACHAT', 'GAIN_PARRAINAGE', 'GAIN_BONUS',
    'UTILISATION', 'EXPIRATION', 'CORRECTION_MANUELLE', 'TRANSFERT'
);

-- =============================================================================
-- SECTION 2 : PLATEFORME
-- =============================================================================

CREATE TABLE PLATEFORME (
    id                      SERIAL PRIMARY KEY,
    nom_plateforme          VARCHAR(255) NOT NULL,
    description_plateforme  TEXT,
    logo_plateforme         VARCHAR(500),
    favicon_plateforme      VARCHAR(500),
    localisation_siege      geometry(Point, 4326),  -- Changé de POINT à geometry (point 2)
    portefeuille_plateforme DECIMAL(15,2) DEFAULT 0.00 CHECK (portefeuille_plateforme >= 0),
    depenses_plateforme     JSONB DEFAULT '[]'::jsonb,
    date_creation           TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour        TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_plateforme_maj
    BEFORE UPDATE ON PLATEFORME
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

-- =============================================================================
-- SECTION 3 : COMPAGNIES DE TRANSPORT
-- =============================================================================

CREATE TABLE COMPAGNIESTRANSPORT (
    id                                  SERIAL PRIMARY KEY,
    nom_compagnie                       VARCHAR(255) NOT NULL,
    description_compagnie               TEXT,
    logo_compagnie                      VARCHAR(500),
    pourcentage_commission_plateforme   DECIMAL(5,2) NOT NULL
                                        CHECK (pourcentage_commission_plateforme BETWEEN 0 AND 100),
    portefeuille_compagnie              DECIMAL(15,2) DEFAULT 0.00 CHECK (portefeuille_compagnie >= 0),
    date_creation                       TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour                    TIMESTAMP DEFAULT NOW(),
    plateforme_id                       INTEGER REFERENCES PLATEFORME(id) ON DELETE SET NULL,
    est_actif                           BOOLEAN DEFAULT TRUE,
    est_supprime                        BOOLEAN DEFAULT FALSE,
    date_suppression                    TIMESTAMP
);

CREATE INDEX idx_compagnies_plateforme ON COMPAGNIESTRANSPORT(plateforme_id);
CREATE INDEX idx_compagnies_actif      ON COMPAGNIESTRANSPORT(est_actif) WHERE est_actif = TRUE;

CREATE TRIGGER trg_compagnies_maj
    BEFORE UPDATE ON COMPAGNIESTRANSPORT
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

-- =============================================================================
-- SECTION 4 : EMPLACEMENTS TRANSPORT
-- =============================================================================

CREATE TABLE EMPLACEMENTSTRANSPORT (
    id                                      SERIAL PRIMARY KEY,
    nom_emplacement                         VARCHAR(255) NOT NULL,
    localisation_emplacement                geometry(Point, 4326),  -- Changé de POINT
    jours_ouverture_emplacement_transport   jours_ouverture DEFAULT 'LUNDI_VENDREDI',
    localisation_arret_bus                  geometry(Point, 4326),  -- Changé de POINT
    date_creation                           TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour                        TIMESTAMP DEFAULT NOW(),
    portefeuille_emplacement                DECIMAL(15,2) DEFAULT 0.00 CHECK (portefeuille_emplacement >= 0),
    compagnie_id                            INTEGER NOT NULL
                                            REFERENCES COMPAGNIESTRANSPORT(id) ON DELETE CASCADE,
    est_actif                               BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_emplacements_transport_compagnie ON EMPLACEMENTSTRANSPORT(compagnie_id);
CREATE INDEX idx_emplacements_transport_actif     ON EMPLACEMENTSTRANSPORT(est_actif) WHERE est_actif = TRUE;
CREATE INDEX idx_emplacements_transport_localisation ON EMPLACEMENTSTRANSPORT USING GIST(localisation_emplacement);

CREATE TRIGGER trg_emplacements_transport_maj
    BEFORE UPDATE ON EMPLACEMENTSTRANSPORT
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

-- =============================================================================
-- SECTION 5 : COMPTES
-- Ajout des FK manquantes pour restaurants et boutiques (correction point 1)
-- =============================================================================
--ERREUR au niveau de comptes
CREATE TABLE COMPTES (
    id                                  SERIAL PRIMARY KEY,
    email                               VARCHAR(255) UNIQUE,
    mot_de_passe_compte                 VARCHAR(255) NOT NULL,
    nom_utilisateur_compte              VARCHAR(100) UNIQUE NOT NULL,
    numero_de_telephone                 VARCHAR(20) UNIQUE,
    photo_profil_compte                 VARCHAR(500),
    statut                              statut_compte DEFAULT 'NON_AUTHENTIFIE',
    code_authentification               VARCHAR(6),
    code_authentification_expiration    TIMESTAMP,
    compte_role                         compte_role DEFAULT 'UTILISATEUR_PRIVE_SIMPLE',
    compagnie_id                        INTEGER,
    emplacement_id                      INTEGER,
    -- Nouvelles colonnes pour restaurants et boutiques (correction point 1)
    restaurant_id                       INTEGER,
    boutique_id                         INTEGER,
    date_creation                       TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour                    TIMESTAMP DEFAULT NOW(),
    date_derniere_connexion             TIMESTAMP,
    date_verouillage                    TIMESTAMP,
    tentatives_echec_connexion          INTEGER DEFAULT 0,
    est_supprime                        BOOLEAN DEFAULT FALSE,
    date_suppression                    TIMESTAMP
);

-- Ajout des contraintes FK
ALTER TABLE COMPTES
    ADD CONSTRAINT fk_compagnie_compte
        FOREIGN KEY (compagnie_id)
        REFERENCES COMPAGNIESTRANSPORT(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_emplacement_compte
        FOREIGN KEY (emplacement_id)
        REFERENCES EMPLACEMENTSTRANSPORT(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_restaurant_compte
        FOREIGN KEY (restaurant_id)
        REFERENCES RESTAURANTSFASTFOOD(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_boutique_compte
        FOREIGN KEY (boutique_id)
        REFERENCES BOUTIQUES(id) ON DELETE SET NULL;

CREATE INDEX idx_comptes_email           ON COMPTES(email);
CREATE INDEX idx_comptes_nom_utilisateur ON COMPTES(nom_utilisateur_compte);
CREATE INDEX idx_comptes_telephone       ON COMPTES(numero_de_telephone);
CREATE INDEX idx_comptes_role            ON COMPTES(compte_role);
CREATE INDEX idx_comptes_actif           ON COMPTES(est_supprime) WHERE est_supprime = FALSE;
CREATE INDEX idx_comptes_compagnie       ON COMPTES(compagnie_id) WHERE compagnie_id IS NOT NULL;
CREATE INDEX idx_comptes_restaurant      ON COMPTES(restaurant_id) WHERE restaurant_id IS NOT NULL;
CREATE INDEX idx_comptes_boutique        ON COMPTES(boutique_id) WHERE boutique_id IS NOT NULL;

CREATE TRIGGER trg_comptes_maj
    BEFORE UPDATE ON COMPTES
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

CREATE TABLE COMPTES_RESTAURANTS (
    compte_id       INTEGER REFERENCES COMPTES(id) ON DELETE CASCADE,
    restaurant_id   INTEGER REFERENCES RESTAURANTSFASTFOOD(id) ON DELETE CASCADE,
    role_dans_resto compte_role,  -- 'ADMINISTRATEUR_RESTAURANT', 'STAFF_RESTAURANT', etc.
    est_defaut      BOOLEAN DEFAULT FALSE,
    date_affectation TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (compte_id, restaurant_id)
);

CREATE TABLE COMPTES_BOUTIQUES (
    compte_id       INTEGER REFERENCES COMPTES(id) ON DELETE CASCADE,
    boutique_id     INTEGER REFERENCES BOUTIQUES(id) ON DELETE CASCADE,
    role_dans_boutique compte_role,  -- 'ADMINISTRATEUR_BOUTIQUE', 'VENDEUR', etc.
    est_defaut      BOOLEAN DEFAULT FALSE,
    date_affectation TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (compte_id, boutique_id)
);

-- Un seul restaurant par défaut par utilisateur
CREATE UNIQUE INDEX idx_un_restaurant_defaut_par_compte
ON COMPTES_RESTAURANTS (compte_id)
WHERE est_defaut = true;

-- Un seule boutique par défaut par utilisateur
CREATE UNIQUE INDEX idx_un_boutique_defaut_par_compte
ON COMPTES_BOUTIQUES (compte_id)
WHERE est_defaut = true;

-- Trigger pour restaurants
CREATE OR REPLACE FUNCTION fn_gerer_defaut_restaurant()
RETURNS TRIGGER AS $$
BEGIN
    -- Si on insère/met à jour avec est_defaut = true
    IF NEW.est_defaut = true THEN
        -- Enlever le défaut des autres restaurants du même compte
        UPDATE COMPTES_RESTAURANTS
        SET est_defaut = false
        WHERE compte_id = NEW.compte_id
          AND restaurant_id != NEW.restaurant_id
          AND est_defaut = true;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_restaurant_defaut
    BEFORE INSERT OR UPDATE ON COMPTES_RESTAURANTS
    FOR EACH ROW EXECUTE FUNCTION fn_gerer_defaut_restaurant();

-- Même chose pour boutiques
CREATE OR REPLACE FUNCTION fn_gerer_defaut_boutique()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.est_defaut = true THEN
        UPDATE COMPTES_BOUTIQUES
        SET est_defaut = false
        WHERE compte_id = NEW.compte_id
          AND boutique_id != NEW.boutique_id
          AND est_defaut = true;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_boutique_defaut
    BEFORE INSERT OR UPDATE ON COMPTES_BOUTIQUES
    FOR EACH ROW EXECUTE FUNCTION fn_gerer_defaut_boutique();


-- Index pour recherches fréquentes
CREATE INDEX idx_comptes_restaurants_compte ON COMPTES_RESTAURANTS(compte_id);
CREATE INDEX idx_comptes_restaurants_resto ON COMPTES_RESTAURANTS(restaurant_id);
CREATE INDEX idx_comptes_restaurants_role ON COMPTES_RESTAURANTS(role_dans_resto);

CREATE INDEX idx_comptes_boutiques_compte ON COMPTES_BOUTIQUES(compte_id);
CREATE INDEX idx_comptes_boutiques_boutique ON COMPTES_BOUTIQUES(boutique_id);
CREATE INDEX idx_comptes_boutiques_role ON COMPTES_BOUTIQUES(role_dans_boutique);


-- Migrer les restaurants existants
INSERT INTO COMPTES_RESTAURANTS (compte_id, restaurant_id, role_dans_resto, est_defaut)
SELECT id, restaurant_id, compte_role, true
FROM COMPTES 
WHERE restaurant_id IS NOT NULL;

-- Migrer les boutiques existantes
INSERT INTO COMPTES_BOUTIQUES (compte_id, boutique_id, role_dans_boutique, est_defaut)
SELECT id, boutique_id, compte_role, true
FROM COMPTES 
WHERE boutique_id IS NOT NULL;

-- Optionnel : Supprimer les anciennes colonnes
ALTER TABLE COMPTES DROP COLUMN restaurant_id;
ALTER TABLE COMPTES DROP COLUMN boutique_id;

CREATE TABLE COMPTES_COMPAGNIES (
	id SERIAL PRIMARY KEY,
    compte_id       INTEGER REFERENCES COMPTES(id) ON DELETE CASCADE,
    compagnie_id    INTEGER REFERENCES COMPAGNIESTRANSPORT(id) ON DELETE CASCADE,
	emplacement_compagnie_id INTEGER REFERENCES EMPLACEMENTSTRANSPORT(id) ON DELETE SET NULL,
    role_dans_compagnie compte_role,
    est_defaut      BOOLEAN DEFAULT FALSE,
    date_affectation TIMESTAMP DEFAULT NOW(),
    matricule       VARCHAR(50),        -- Optionnel
    service         VARCHAR(100),       -- Optionnel

	UNIQUE(compte_id, compagnie_id)
);

-- Index pour défaut
CREATE UNIQUE INDEX idx_un_compagnie_defaut_par_compte
ON COMPTES_COMPAGNIES (compte_id)
WHERE est_defaut = true;

-- Index pour recherches
CREATE INDEX idx_comptes_compagnies_compagnie ON COMPTES_COMPAGNIES(compagnie_id);
CREATE INDEX idx_comptes_compagnies_emplacement ON COMPTES_COMPAGNIES(emplacement_compagnie_id) 
    WHERE emplacement_compagnie_id IS NOT NULL;
-- =============================================================================
-- SECTION 6 : TICKETS TRANSPORT
-- =============================================================================

CREATE TABLE TICKETSTRANSPORT (
    id                          SERIAL PRIMARY KEY,
    nom_produit                 VARCHAR(255) NOT NULL,
    description_produit         TEXT,
    prix_vente_produit          DECIMAL(10,2) NOT NULL CHECK (prix_vente_produit >= 0),
    donnees_secondaires_produit JSONB DEFAULT '{}'::jsonb,
    quantite_stock              INTEGER DEFAULT 0 NOT NULL CHECK (quantite_stock >= 0),
    quantite_vendu              INTEGER DEFAULT 0 NOT NULL CHECK (quantite_vendu >= 0),
    emplacement_id              INTEGER NOT NULL
                                REFERENCES EMPLACEMENTSTRANSPORT(id) ON DELETE CASCADE,
    compagnie_id                INTEGER NOT NULL
                                REFERENCES COMPAGNIESTRANSPORT(id) ON DELETE CASCADE,
    journalier                  BOOLEAN DEFAULT FALSE,
    hebdomadaire                BOOLEAN DEFAULT FALSE,
    mensuel                     BOOLEAN DEFAULT FALSE,
    actif                       BOOLEAN DEFAULT TRUE,
    date_creation               TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour            TIMESTAMP DEFAULT NOW(),

    CONSTRAINT check_un_seul_type_ticket
        CHECK ((journalier::int + hebdomadaire::int + mensuel::int) <= 1)
);

CREATE INDEX idx_tickets_compagnie   ON TICKETSTRANSPORT(compagnie_id);
CREATE INDEX idx_tickets_emplacement ON TICKETSTRANSPORT(emplacement_id);
CREATE INDEX idx_tickets_actif       ON TICKETSTRANSPORT(actif) WHERE actif = TRUE;

CREATE TRIGGER trg_tickets_maj
    BEFORE UPDATE ON TICKETSTRANSPORT
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

-- =============================================================================
-- SECTION 7 : SERVICES TRANSPORT
-- =============================================================================

CREATE TABLE SERVICES (
    id                   SERIAL PRIMARY KEY,
    nom_service          VARCHAR(255) NOT NULL,
    type_service         types_services_transport NOT NULL,
    donnees_json_service JSONB DEFAULT '{}'::jsonb,
    prix_service         DECIMAL(10,2) DEFAULT 0.00 CHECK (prix_service >= 0),
    date_creation        TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour     TIMESTAMP DEFAULT NOW(),
    duree_validite_jours INTEGER CHECK (duree_validite_jours > 0),
    actif                BOOLEAN DEFAULT TRUE,
    compagnie_id         INTEGER NOT NULL
                         REFERENCES COMPAGNIESTRANSPORT(id) ON DELETE CASCADE,
    emplacement_id       INTEGER
                         REFERENCES EMPLACEMENTSTRANSPORT(id) ON DELETE SET NULL
);

CREATE INDEX idx_services_compagnie   ON SERVICES(compagnie_id);
CREATE INDEX idx_services_emplacement ON SERVICES(emplacement_id);

CREATE TRIGGER trg_services_maj
    BEFORE UPDATE ON SERVICES
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

-- =============================================================================
-- SECTION 8 : RESTAURANTS FAST FOOD
-- =============================================================================

CREATE TABLE RESTAURANTSFASTFOOD (
    id                                  SERIAL PRIMARY KEY,
    nom_restaurant_fast_food            VARCHAR(255) NOT NULL,
    description_restaurant_fast_food    TEXT,
    logo_restaurant                     VARCHAR(500),
    portefeuille_restaurant_fast_food   DECIMAL(15,2) DEFAULT 0.00 CHECK (portefeuille_restaurant_fast_food >= 0),
    plateforme_id                       INTEGER NOT NULL
                                        REFERENCES PLATEFORME(id) ON DELETE CASCADE,
    pourcentage_commission_plateforme   DECIMAL(5,2) NOT NULL
                                        CHECK (pourcentage_commission_plateforme BETWEEN 0 AND 100),
    est_actif                           BOOLEAN DEFAULT TRUE,
    est_supprime                        BOOLEAN DEFAULT FALSE,
    date_suppression                    TIMESTAMP,
    date_creation                       TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour                    TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_restaurants_maj
    BEFORE UPDATE ON RESTAURANTSFASTFOOD
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

-- =============================================================================
-- SECTION 9 : EMPLACEMENTS RESTAURANT FAST FOOD
-- =============================================================================

CREATE TABLE EMPLACEMENTSRESTAURANTFASTFOOD (
    id                                      SERIAL PRIMARY KEY,
    nom_emplacement                         VARCHAR(255) NOT NULL,
    logo_restaurant                         VARCHAR(500),
    favicon_restaurant                      VARCHAR(500),
    localisation_restaurant                 geometry(Point, 4326),  -- Changé de POINT
    adresse_complete                        TEXT,
    frais_livraison                         DECIMAL(10,2) DEFAULT 0.00 CHECK (frais_livraison >= 0),
    portefeuille_emplacement                DECIMAL(15,2) DEFAULT 0.00 CHECK (portefeuille_emplacement >= 0),
    heure_ouverture                         TIME,
    heure_fermeture                         TIME,
    jours_ouverture_emplacement_restaurant  jours_ouverture DEFAULT 'LUNDI_VENDREDI',
    id_restaurant_fast_food                 INTEGER NOT NULL
                                            REFERENCES RESTAURANTSFASTFOOD(id) ON DELETE CASCADE,
    est_actif                               BOOLEAN DEFAULT TRUE,
    date_creation                           TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour                        TIMESTAMP DEFAULT NOW(),

    CONSTRAINT check_horaires
        CHECK (heure_fermeture IS NULL OR heure_ouverture IS NULL OR heure_fermeture > heure_ouverture)
);

CREATE INDEX idx_emplacement_rff_localisation
    ON EMPLACEMENTSRESTAURANTFASTFOOD USING GIST(localisation_restaurant);
CREATE INDEX idx_emplacement_rff_restaurant
    ON EMPLACEMENTSRESTAURANTFASTFOOD(id_restaurant_fast_food);
CREATE INDEX idx_emplacement_rff_actif
    ON EMPLACEMENTSRESTAURANTFASTFOOD(est_actif) WHERE est_actif = TRUE;

CREATE TRIGGER trg_emplacements_rff_maj
    BEFORE UPDATE ON EMPLACEMENTSRESTAURANTFASTFOOD
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

-- =============================================================================
-- SECTION 10 : MENUS RESTAURANT FAST FOOD
-- =============================================================================

CREATE TABLE MENURESTAURANTFASTFOOD (
    id                                  SERIAL PRIMARY KEY,
    nom_menu                            VARCHAR(255) NOT NULL,
    description_menu                    TEXT,
    photo_menu                          VARCHAR(500),
    photos_menu                         JSONB DEFAULT '[]',
    composition_menu                    JSONB DEFAULT '[]',
    disponible                          BOOLEAN DEFAULT FALSE,
    prix_menu                           DECIMAL(10,2) NOT NULL CHECK (prix_menu >= 0),
    temps_preparation_min               INTEGER CHECK (temps_preparation_min > 0),
    stock_disponible                    INTEGER DEFAULT -1,
    id_restaurant_fast_food_emplacement INTEGER NOT NULL
                                        REFERENCES EMPLACEMENTSRESTAURANTFASTFOOD(id) ON DELETE CASCADE,
    categorie_menu                      categories_menu,
    est_journalier                      BOOLEAN DEFAULT TRUE,
    date_creation                       TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour                    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_menu_emplacement ON MENURESTAURANTFASTFOOD(id_restaurant_fast_food_emplacement);
CREATE INDEX idx_menu_categorie   ON MENURESTAURANTFASTFOOD(categorie_menu);
CREATE INDEX idx_menu_disponible  ON MENURESTAURANTFASTFOOD(disponible) WHERE disponible = TRUE;

CREATE TRIGGER trg_menus_maj
    BEFORE UPDATE ON MENURESTAURANTFASTFOOD
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

-- =============================================================================
-- SECTION 11 : PRODUITS INDIVIDUELS RESTAURANT
-- =============================================================================

CREATE TABLE PRODUITSINDIVIDUELRESTAURANT (
    id                                  SERIAL PRIMARY KEY,
    nom_produit                         VARCHAR(255) NOT NULL,
    description_produit                 TEXT,
    photo_produit                       VARCHAR(500),
    donnees_produit                     JSONB DEFAULT '{}',
    stock_disponible                    INTEGER DEFAULT -1,
    categorie_produit                   categories_produits,
    prix_produit                        DECIMAL(10,2) NOT NULL CHECK (prix_produit >= 0),
    id_restaurant_fast_food_emplacement INTEGER NOT NULL
                                        REFERENCES EMPLACEMENTSRESTAURANTFASTFOOD(id) ON DELETE CASCADE,
    est_journalier                      BOOLEAN DEFAULT TRUE,
    disponible                          BOOLEAN DEFAULT TRUE,
    date_creation                       TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour                    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_produits_rff_emplacement ON PRODUITSINDIVIDUELRESTAURANT(id_restaurant_fast_food_emplacement);
CREATE INDEX idx_produits_rff_disponible  ON PRODUITSINDIVIDUELRESTAURANT(disponible) WHERE disponible = TRUE;

CREATE TRIGGER trg_produits_restaurant_maj
    BEFORE UPDATE ON PRODUITSINDIVIDUELRESTAURANT
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

-- =============================================================================
-- SECTION 12 : PROMOS RESTAURANT FAST FOOD
-- =============================================================================

CREATE TABLE PROMOSRESTAURANTFASTFOOD (
    id                                  SERIAL PRIMARY KEY,
    nom_promo                           VARCHAR(255) NOT NULL,
    description_promo                   TEXT,
    code_promo                          VARCHAR(100) UNIQUE,
    type_promo                          types_promo NOT NULL,
    id_restaurant_fast_food_emplacement INTEGER
                                        REFERENCES EMPLACEMENTSRESTAURANTFASTFOOD(id) ON DELETE CASCADE,
    pourcentage_reduction               DECIMAL(5,2) CHECK (pourcentage_reduction BETWEEN 0 AND 100),
    montant_fixe_reduction              DECIMAL(10,2) CHECK (montant_fixe_reduction >= 0),
    date_debut_promo                    TIMESTAMP NOT NULL,
    date_fin_promo                      TIMESTAMP NOT NULL,
    utilisation_max                     INTEGER DEFAULT -1,
    utilisation_count                   INTEGER DEFAULT 0 CHECK (utilisation_count >= 0),
    actif                               BOOLEAN DEFAULT TRUE,
    produits_affectes                   JSONB DEFAULT '[]',
    date_creation                       TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour                    TIMESTAMP DEFAULT NOW(),

    CONSTRAINT check_dates_promo CHECK (date_fin_promo > date_debut_promo),
    CONSTRAINT check_reduction CHECK (
        type_promo IN ('LIVRAISON_GRATUITE', 'DEUX_POUR_UN', 'MENU_OFFERT')
        OR pourcentage_reduction IS NOT NULL
        OR montant_fixe_reduction IS NOT NULL
    )
);

CREATE INDEX idx_promos_emplacement ON PROMOSRESTAURANTFASTFOOD(id_restaurant_fast_food_emplacement);
CREATE INDEX idx_promos_actif       ON PROMOSRESTAURANTFASTFOOD(actif, date_fin_promo)
    WHERE actif = TRUE;
CREATE INDEX idx_promos_code        ON PROMOSRESTAURANTFASTFOOD(code_promo)
    WHERE code_promo IS NOT NULL;

CREATE TRIGGER trg_promos_maj
    BEFORE UPDATE ON PROMOSRESTAURANTFASTFOOD
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

CREATE TABLE PROMOSMENUS (
    promo_id  INTEGER NOT NULL REFERENCES PROMOSRESTAURANTFASTFOOD(id) ON DELETE CASCADE,
    menu_id   INTEGER NOT NULL REFERENCES MENURESTAURANTFASTFOOD(id) ON DELETE CASCADE,
    PRIMARY KEY (promo_id, menu_id)
);

CREATE TABLE PROMOSPRODUITS (
    promo_id   INTEGER NOT NULL REFERENCES PROMOSRESTAURANTFASTFOOD(id) ON DELETE CASCADE,
    produit_id INTEGER NOT NULL REFERENCES PRODUITSINDIVIDUELRESTAURANT(id) ON DELETE CASCADE,
    PRIMARY KEY (promo_id, produit_id)
);

-- =============================================================================
-- SECTION 13 : COMMANDES RESTAURANT FAST FOOD
-- =============================================================================

CREATE SEQUENCE commandes_rff_seq;

CREATE TABLE COMMANDESEMPLACEMENTFASTFOOD (
    id                                  SERIAL PRIMARY KEY,
    reference_commande                  VARCHAR(60) UNIQUE NOT NULL
                                        DEFAULT (
                                            'CMD-RFF-'
                                            || TO_CHAR(NOW(), 'YYYYMMDD')
                                            || '-'
                                            || LPAD(NEXTVAL('commandes_rff_seq')::TEXT, 6, '0')
                                        ),
    id_restaurant_fast_food_emplacement INTEGER
                                        REFERENCES EMPLACEMENTSRESTAURANTFASTFOOD(id) ON DELETE SET NULL,
    compte_id                           INTEGER
                                        REFERENCES COMPTES(id) ON DELETE SET NULL,
    donnees_commande                    JSONB DEFAULT '[]',
    prix_sous_total                     DECIMAL(10,2) NOT NULL CHECK (prix_sous_total >= 0),
    frais_livraison_commande            DECIMAL(10,2) DEFAULT 0.00 CHECK (frais_livraison_commande >= 0),
    remise_appliquee                    DECIMAL(10,2) DEFAULT 0.00 CHECK (remise_appliquee >= 0),
    prix_total_commande                 DECIMAL(10,2) NOT NULL CHECK (prix_total_commande >= 0),
    promo_id                            INTEGER REFERENCES PROMOSRESTAURANTFASTFOOD(id) ON DELETE SET NULL,
    statut_commande                     statut_commande DEFAULT 'EN_ATTENTE',
    pour_livrer                         BOOLEAN DEFAULT FALSE,
    passer_recuperer                    BOOLEAN DEFAULT FALSE,
    paiement_direct                     BOOLEAN DEFAULT FALSE,
    paiement_a_la_livraison             BOOLEAN DEFAULT FALSE,
    paiement_a_la_recuperation          BOOLEAN DEFAULT FALSE,
    notes_commande                      TEXT,
    adresse_livraison_id                INTEGER,
    date_commande                       TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour                    TIMESTAMP DEFAULT NOW(),

    CONSTRAINT check_mode_livraison CHECK (
        (pour_livrer::int + passer_recuperer::int) <= 1
    ),
    CONSTRAINT check_mode_paiement CHECK (
        (paiement_direct::int + paiement_a_la_livraison::int + paiement_a_la_recuperation::int) = 1
    ),
    CONSTRAINT check_total_coherent CHECK (
        ROUND(prix_total_commande, 2) =
        ROUND(prix_sous_total + frais_livraison_commande - remise_appliquee, 2)
    )
);

CREATE INDEX idx_commandes_rff_emplacement ON COMMANDESEMPLACEMENTFASTFOOD(id_restaurant_fast_food_emplacement);
CREATE INDEX idx_commandes_rff_compte      ON COMMANDESEMPLACEMENTFASTFOOD(compte_id);
CREATE INDEX idx_commandes_rff_statut      ON COMMANDESEMPLACEMENTFASTFOOD(statut_commande);
CREATE INDEX idx_commandes_rff_date        ON COMMANDESEMPLACEMENTFASTFOOD(date_commande DESC);
CREATE INDEX idx_commandes_rff_dashboard
    ON COMMANDESEMPLACEMENTFASTFOOD(id_restaurant_fast_food_emplacement, statut_commande, date_commande DESC)
    WHERE statut_commande NOT IN ('ANNULEE', 'REMBOURSEE');

CREATE TRIGGER trg_commandes_rff_maj
    BEFORE UPDATE ON COMMANDESEMPLACEMENTFASTFOOD
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

-- =============================================================================
-- SECTION 14 : BOUTIQUES
-- =============================================================================

CREATE TABLE BOUTIQUES (
    id                                  SERIAL PRIMARY KEY,
    nom_boutique                        VARCHAR(255) NOT NULL,
    description_boutique                TEXT,
    logo_boutique                       VARCHAR(500),
    favicon_boutique                    VARCHAR(500),
    types_produits_vendu                JSONB DEFAULT '[]',
    plateforme_id                       INTEGER NOT NULL
                                        REFERENCES PLATEFORME(id) ON DELETE CASCADE,
    pourcentage_commission_plateforme   DECIMAL(5,2) NOT NULL
                                        CHECK (pourcentage_commission_plateforme BETWEEN 0 AND 100),
    portefeuille_boutique               DECIMAL(15,2) DEFAULT 0.00 CHECK (portefeuille_boutique >= 0),
    est_actif                           BOOLEAN DEFAULT TRUE,
    est_supprime                        BOOLEAN DEFAULT FALSE,
    date_suppression                    TIMESTAMP,
    date_creation                       TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour                    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_boutiques_plateforme ON BOUTIQUES(plateforme_id);
CREATE INDEX idx_boutiques_actif      ON BOUTIQUES(est_actif) WHERE est_actif = TRUE;

CREATE TRIGGER trg_boutiques_maj
    BEFORE UPDATE ON BOUTIQUES
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

CREATE TABLE CATEGORIES_BOUTIQUE (
    id                    SERIAL PRIMARY KEY,
    nom_categorie         VARCHAR(100) NOT NULL,
    description_categorie TEXT,
    slug_categorie        VARCHAR(120) UNIQUE,
    categorie_parente_id  INTEGER REFERENCES CATEGORIES_BOUTIQUE(id) ON DELETE SET NULL,
    boutique_id           INTEGER REFERENCES BOUTIQUES(id) ON DELETE CASCADE,
    ordre_affichage       INTEGER DEFAULT 0,
    est_actif             BOOLEAN DEFAULT TRUE,
    date_creation         TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_categories_boutique_parente ON CATEGORIES_BOUTIQUE(categorie_parente_id);
CREATE INDEX idx_categories_boutique_id      ON CATEGORIES_BOUTIQUE(boutique_id);

CREATE TABLE PRODUITSBOUTIQUE (
    id                      SERIAL PRIMARY KEY,
    nom_produit             VARCHAR(255) NOT NULL,
    slug_produit            VARCHAR(300) UNIQUE,
    image_produit           VARCHAR(500),
    images_produit          JSONB DEFAULT '[]',
    description_produit     TEXT,
    donnees_supplementaires JSONB DEFAULT '{}',
    prix_unitaire_produit   DECIMAL(10,2) NOT NULL CHECK (prix_unitaire_produit >= 0),
    prix_promo              DECIMAL(10,2) CHECK (prix_promo >= 0),
    quantite                INTEGER DEFAULT -1,
    id_categorie            INTEGER NOT NULL
                            REFERENCES CATEGORIES_BOUTIQUE(id) ON DELETE RESTRICT,
    id_boutique             INTEGER NOT NULL
                            REFERENCES BOUTIQUES(id) ON DELETE CASCADE,
    est_disponible          BOOLEAN DEFAULT TRUE,
    date_creation           TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_produits_boutique_boutique  ON PRODUITSBOUTIQUE(id_boutique);
CREATE INDEX idx_produits_boutique_categorie ON PRODUITSBOUTIQUE(id_categorie);
CREATE INDEX idx_produits_boutique_dispo     ON PRODUITSBOUTIQUE(est_disponible) WHERE est_disponible = TRUE;

CREATE TRIGGER trg_produits_boutique_maj
    BEFORE UPDATE ON PRODUITSBOUTIQUE
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

CREATE SEQUENCE commandes_boutiques_seq;

CREATE TABLE COMMANDESBOUTIQUES (
    id                          SERIAL PRIMARY KEY,
    reference_commande          VARCHAR(60) UNIQUE NOT NULL
                                DEFAULT (
                                    'CMD-BTQ-'
                                    || TO_CHAR(NOW(), 'YYYYMMDD')
                                    || '-'
                                    || LPAD(NEXTVAL('commandes_boutiques_seq')::TEXT, 6, '0')
                                ),
    id_boutique                 INTEGER NOT NULL
                                REFERENCES BOUTIQUES(id) ON DELETE CASCADE,
    compte_id                   INTEGER REFERENCES COMPTES(id) ON DELETE SET NULL,
    donnees_commandes           JSONB DEFAULT '[]',
    prix_sous_total             DECIMAL(10,2) NOT NULL CHECK (prix_sous_total >= 0),
    frais_livraison_commande    DECIMAL(10,2) DEFAULT 0.00 CHECK (frais_livraison_commande >= 0),
    remise_appliquee            DECIMAL(10,2) DEFAULT 0.00 CHECK (remise_appliquee >= 0),
    prix_total_commande         DECIMAL(10,2) NOT NULL CHECK (prix_total_commande >= 0),
    statut_commande             statut_commande DEFAULT 'EN_ATTENTE',
    pour_livrer                 BOOLEAN DEFAULT FALSE,
    passer_recuperer            BOOLEAN DEFAULT FALSE,
    paiement_direct             BOOLEAN DEFAULT FALSE,
    paiement_a_la_livraison     BOOLEAN DEFAULT FALSE,
    paiement_a_la_recuperation  BOOLEAN DEFAULT FALSE,
    notes_commande              TEXT,
    adresse_livraison_id        INTEGER,
    date_commande               TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour            TIMESTAMP DEFAULT NOW(),

    CONSTRAINT check_mode_livraison_boutique CHECK (
        (pour_livrer::int + passer_recuperer::int) <= 1
    ),
    CONSTRAINT check_mode_paiement_boutique CHECK (
        (paiement_direct::int + paiement_a_la_livraison::int + paiement_a_la_recuperation::int) = 1
    ),
    CONSTRAINT check_total_coherent_boutique CHECK (
        ROUND(prix_total_commande, 2) =
        ROUND(prix_sous_total + frais_livraison_commande - remise_appliquee, 2)
    )
);

CREATE INDEX idx_commandes_boutique_boutique ON COMMANDESBOUTIQUES(id_boutique);
CREATE INDEX idx_commandes_boutique_compte   ON COMMANDESBOUTIQUES(compte_id);
CREATE INDEX idx_commandes_boutique_statut   ON COMMANDESBOUTIQUES(statut_commande);
CREATE INDEX idx_commandes_boutique_date     ON COMMANDESBOUTIQUES(date_commande DESC);

CREATE TRIGGER trg_commandes_boutiques_maj
    BEFORE UPDATE ON COMMANDESBOUTIQUES
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

-- =============================================================================
-- SECTION 15 : SERVICES LIVRAISON
-- =============================================================================

CREATE TABLE ENTREPRISE_LIVRAISON (
    id                                  SERIAL PRIMARY KEY,
    nom_entreprise_livraison            VARCHAR(255) NOT NULL,
    description_entreprise_livraison    TEXT,
    logo_entreprise_livraison           VARCHAR(500),
    favicon_entreprise_livraison        VARCHAR(500),
    localisation_entreprise             geometry(Point, 4326),  -- Changé de POINT
    pourcentage_commission_plateforme   DECIMAL(5,2)
                                        CHECK (pourcentage_commission_plateforme BETWEEN 0 AND 100),
    portefeuille_entreprise_livraison   DECIMAL(15,2) DEFAULT 0.00 CHECK (portefeuille_entreprise_livraison >= 0),
    plateforme_id                       INTEGER REFERENCES PLATEFORME(id) ON DELETE SET NULL,
    est_actif                           BOOLEAN DEFAULT TRUE,
    date_creation                       TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour                    TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_entreprise_livraison_maj
    BEFORE UPDATE ON ENTREPRISE_LIVRAISON
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

CREATE TABLE SERVICES_LIVRAISON (
    id                      SERIAL PRIMARY KEY,
    nom_service             VARCHAR(255) NOT NULL,
    type_service            types_service_livraison NOT NULL,
    description_service     TEXT,
    prix_service            DECIMAL(10,2) NOT NULL CHECK (prix_service >= 0),
    prix_par_km             DECIMAL(10,2) CHECK (prix_par_km >= 0),
    distance_max_km         DECIMAL(8,2),
    est_actif               BOOLEAN DEFAULT TRUE,
    donnees_supplementaires JSONB DEFAULT '{}',
    id_entreprise_livraison INTEGER NOT NULL
                            REFERENCES ENTREPRISE_LIVRAISON(id) ON DELETE CASCADE,
    date_creation           TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour        TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER trg_services_livraison_maj
    BEFORE UPDATE ON SERVICES_LIVRAISON
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

CREATE TABLE LIVREURS (
    id                       SERIAL PRIMARY KEY,
    nom_livreur              VARCHAR(255) NOT NULL,
    prenom_livreur           VARCHAR(255) NOT NULL,
    photo_livreur            VARCHAR(500),
    numero_telephone_livreur VARCHAR(20) UNIQUE NOT NULL,
    id_entreprise_livraison  INTEGER REFERENCES ENTREPRISE_LIVRAISON(id) ON DELETE SET NULL,
    est_disponible           BOOLEAN DEFAULT TRUE,
    localisation_actuelle    geometry(Point, 4326),  -- Changé de POINT
    note_moyenne             DECIMAL(3,2) CHECK (note_moyenne BETWEEN 0 AND 5),
    nombre_livraisons        INTEGER DEFAULT 0,
    est_actif                BOOLEAN DEFAULT TRUE,
    date_creation            TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour         TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_livreurs_entreprise   ON LIVREURS(id_entreprise_livraison);
CREATE INDEX idx_livreurs_disponible   ON LIVREURS(est_disponible) WHERE est_disponible = TRUE;
CREATE INDEX idx_livreurs_localisation ON LIVREURS USING GIST(localisation_actuelle);

CREATE TRIGGER trg_livreurs_maj
    BEFORE UPDATE ON LIVREURS
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

CREATE TABLE DEMANDES_LIVRAISON (
    id                       SERIAL PRIMARY KEY,
    details_livraison        JSONB NOT NULL,
    est_effectue             BOOLEAN DEFAULT FALSE,
    livreur_affecte          INTEGER REFERENCES LIVREURS(id) ON DELETE SET NULL,
    commission               DECIMAL(10,2) CHECK (commission >= 0),
    commande_type            VARCHAR(50)
                             CHECK (commande_type IS NULL OR
                                    commande_type IN ('RESTAURANT_FAST_FOOD', 'BOUTIQUE', 'AUTRE')),
    commande_id              INTEGER,
    statut_livraison         statut_commande DEFAULT 'EN_ATTENTE',
    date_creation            TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour         TIMESTAMP DEFAULT NOW(),
    date_livraison_prevue    TIMESTAMP,
    date_livraison_effective TIMESTAMP,

    CONSTRAINT check_dates_livraison
        CHECK (date_livraison_effective IS NULL OR
               date_livraison_effective >= date_creation)
);

CREATE INDEX idx_demandes_livraison_livreur ON DEMANDES_LIVRAISON(livreur_affecte);
CREATE INDEX idx_demandes_livraison_statut  ON DEMANDES_LIVRAISON(statut_livraison);

CREATE TRIGGER trg_demandes_livraison_maj
    BEFORE UPDATE ON DEMANDES_LIVRAISON
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

-- =============================================================================
-- SECTION 16 : ACHATS TICKETS ET SERVICES
-- =============================================================================

CREATE TABLE ACHATSTICKETSPRIVE (
    id                         SERIAL PRIMARY KEY,
    compte_id                  INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    ticket_id                  INTEGER NOT NULL REFERENCES TICKETSTRANSPORT(id) ON DELETE RESTRICT,
    quantite                   INTEGER NOT NULL DEFAULT 1 CHECK (quantite > 0),
    prix_achat_unitaire_ticket DECIMAL(10,2) NOT NULL CHECK (prix_achat_unitaire_ticket >= 0),
    total_transaction          DECIMAL(10,2) NOT NULL,
    transaction_uuid           UUID DEFAULT gen_random_uuid() UNIQUE,
    date_achat_prive           TIMESTAMP DEFAULT NOW(),
    date_expiration_ticket     TIMESTAMP,
    est_actif                  BOOLEAN DEFAULT TRUE,
    info_acheteur              JSONB,

    CONSTRAINT check_total_coherent
        CHECK (ROUND(total_transaction, 2) = ROUND(prix_achat_unitaire_ticket * quantite, 2))
);

CREATE INDEX idx_achats_prives_compte      ON ACHATSTICKETSPRIVE(compte_id);
CREATE INDEX idx_achats_prives_ticket      ON ACHATSTICKETSPRIVE(ticket_id);
CREATE INDEX idx_achats_prives_transaction ON ACHATSTICKETSPRIVE(transaction_uuid);
CREATE INDEX idx_achats_prives_actif       ON ACHATSTICKETSPRIVE(est_actif) WHERE est_actif = TRUE;

CREATE TABLE ACHATSSERVICESPRIVE (
    id                   SERIAL PRIMARY KEY,
    service_id           INTEGER NOT NULL REFERENCES SERVICES(id) ON DELETE RESTRICT,
    compte_id            INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    transaction_uuid     UUID DEFAULT gen_random_uuid() UNIQUE,
    prix_achat_service   DECIMAL(10,2) NOT NULL CHECK (prix_achat_service >= 0),
    date_achat_service   TIMESTAMP DEFAULT NOW(),
    date_expiration      TIMESTAMP,
    est_actif            BOOLEAN DEFAULT TRUE,
    info_acheteur        JSONB
);

CREATE INDEX idx_achats_services_compte      ON ACHATSSERVICESPRIVE(compte_id);
CREATE INDEX idx_achats_services_transaction ON ACHATSSERVICESPRIVE(transaction_uuid);

CREATE TABLE ACHATSTICKETSPUBLIQUES (
    id               SERIAL PRIMARY KEY,
    ticket_id        INTEGER NOT NULL REFERENCES TICKETSTRANSPORT(id) ON DELETE RESTRICT,
    quantite         INTEGER NOT NULL DEFAULT 1 CHECK (quantite > 0),
    prix_unitaire    DECIMAL(10,2) NOT NULL CHECK (prix_unitaire >= 0),
    prix_total_achat DECIMAL(10,2) NOT NULL,
    transaction_uuid UUID DEFAULT gen_random_uuid() UNIQUE,
    date_achat       TIMESTAMP DEFAULT NOW(),
    date_expiration  TIMESTAMP,
    est_actif        BOOLEAN DEFAULT TRUE,
    info_acheteur    JSONB NOT NULL,

    CONSTRAINT check_total_publique
        CHECK (ROUND(prix_total_achat, 2) = ROUND(prix_unitaire * quantite, 2))
);

CREATE INDEX idx_achats_publics_ticket      ON ACHATSTICKETSPUBLIQUES(ticket_id);
CREATE INDEX idx_achats_publics_transaction ON ACHATSTICKETSPUBLIQUES(transaction_uuid);

-- =============================================================================
-- SECTION 17 : DEMANDES DE SERVICE
-- =============================================================================

CREATE TABLE DEMANDESERVICE (
    id                         SERIAL PRIMARY KEY,
    compte_id                  INTEGER REFERENCES COMPTES(id) ON DELETE SET NULL,
    service_id                 INTEGER NOT NULL REFERENCES SERVICES(id) ON DELETE RESTRICT,
    compagnie_id               INTEGER NOT NULL REFERENCES COMPAGNIESTRANSPORT(id) ON DELETE CASCADE,
    cni_photo                  VARCHAR(500),
    document_verification      VARCHAR(500),
    prix_total                 DECIMAL(10,2) NOT NULL CHECK (prix_total >= 0),
    statut_demande             VARCHAR(50) DEFAULT 'EN_ATTENTE'
                               CHECK (statut_demande IN ('EN_ATTENTE','APPROUVEE','REJETEE','ANNULEE')),
    est_valide_par_emplacement BOOLEAN DEFAULT FALSE,
    est_valide_par_compagnie   BOOLEAN DEFAULT FALSE,
    date_demande               TIMESTAMP DEFAULT NOW(),
    date_validation            TIMESTAMP,
    valide_par                 INTEGER REFERENCES COMPTES(id) ON DELETE SET NULL,
    commentaires               TEXT
);

CREATE INDEX idx_demande_service_statut    ON DEMANDESERVICE(statut_demande);
CREATE INDEX idx_demande_service_compte    ON DEMANDESERVICE(compte_id);
CREATE INDEX idx_demande_service_compagnie ON DEMANDESERVICE(compagnie_id);

-- =============================================================================
-- SECTION 18 : BLOG
-- =============================================================================

CREATE TABLE ARTICLES_BLOG_PLATEFORME (
    id                          SERIAL PRIMARY KEY,
    titre_article               VARCHAR(255) NOT NULL,
    sous_titre                  VARCHAR(500),
    slug                        VARCHAR(300) UNIQUE NOT NULL,
    contenu_article             TEXT NOT NULL,
    extrait_contenu             TEXT,
    langue                      VARCHAR(10) DEFAULT 'fr',
    image_principale            VARCHAR(500),
    image_secondaire            VARCHAR(500),
    video_url                   VARCHAR(500),
    gallery_images              JSONB DEFAULT '[]',
    documents_joints            JSONB DEFAULT '[]',
    meta_titre                  VARCHAR(255),
    meta_description            TEXT,
    mots_cles                   TEXT[],
    categorie_principale        categories_article NOT NULL,
    categories_secondaires      categories_article[],
    statut                      statut_article DEFAULT 'BROUILLON',
    visibilite                  visibilite_article DEFAULT 'PUBLIC',
    est_epingle                 BOOLEAN DEFAULT FALSE,
    est_archive                 BOOLEAN DEFAULT FALSE,
    est_commentaire_actif       BOOLEAN DEFAULT TRUE,
    date_creation               TIMESTAMP DEFAULT NOW(),
    date_modification           TIMESTAMP DEFAULT NOW(),
    date_publication            TIMESTAMP,
    date_programmation          TIMESTAMP,
    date_archivage              TIMESTAMP,
    auteur_id                   INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE RESTRICT,
    co_auteurs                  INTEGER[] DEFAULT '{}',
    valide_par                  INTEGER REFERENCES COMPTES(id),
    date_validation             TIMESTAMP,
    commentaire_validation      TEXT,
    nombre_vues                 INTEGER DEFAULT 0 CHECK (nombre_vues >= 0),
    nombre_vues_uniques         INTEGER DEFAULT 0 CHECK (nombre_vues_uniques >= 0),
    nombre_likes                INTEGER DEFAULT 0 CHECK (nombre_likes >= 0),
    nombre_dislikes             INTEGER DEFAULT 0 CHECK (nombre_dislikes >= 0),
    nombre_partages             INTEGER DEFAULT 0 CHECK (nombre_partages >= 0),
    nombre_commentaires         INTEGER DEFAULT 0 CHECK (nombre_commentaires >= 0),
    temps_lecture_minutes       INTEGER CHECK (temps_lecture_minutes > 0),
    plateforme_id               INTEGER REFERENCES PLATEFORME(id) ON DELETE SET NULL,
    compagnie_id                INTEGER REFERENCES COMPAGNIESTRANSPORT(id) ON DELETE SET NULL,
    emplacement_transport_id    INTEGER REFERENCES EMPLACEMENTSTRANSPORT(id) ON DELETE SET NULL,
    restaurant_id               INTEGER REFERENCES RESTAURANTSFASTFOOD(id) ON DELETE SET NULL,
    emplacement_restaurant_id   INTEGER REFERENCES EMPLACEMENTSRESTAURANTFASTFOOD(id) ON DELETE SET NULL,
    boutique_id                 INTEGER REFERENCES BOUTIQUES(id) ON DELETE SET NULL,
    produit_boutique_id         INTEGER REFERENCES PRODUITSBOUTIQUE(id) ON DELETE SET NULL,
    menu_id                     INTEGER REFERENCES MENURESTAURANTFASTFOOD(id) ON DELETE SET NULL,
    promo_id                    INTEGER REFERENCES PROMOSRESTAURANTFASTFOOD(id) ON DELETE SET NULL,
    est_disponible_hors_ligne   BOOLEAN DEFAULT FALSE,
    droit_lecture_minimum_role  compte_role,
    mot_de_passe_protege        VARCHAR(255),
    redirection_url             VARCHAR(500)
);

CREATE INDEX idx_blog_slug             ON ARTICLES_BLOG_PLATEFORME(slug);
CREATE INDEX idx_blog_categorie        ON ARTICLES_BLOG_PLATEFORME(categorie_principale);
CREATE INDEX idx_blog_statut           ON ARTICLES_BLOG_PLATEFORME(statut);
CREATE INDEX idx_blog_date_publication ON ARTICLES_BLOG_PLATEFORME(date_publication DESC);
CREATE INDEX idx_blog_auteur           ON ARTICLES_BLOG_PLATEFORME(auteur_id);
CREATE INDEX idx_blog_epingle          ON ARTICLES_BLOG_PLATEFORME(est_epingle) WHERE est_epingle = TRUE;
CREATE INDEX idx_blog_tags             ON ARTICLES_BLOG_PLATEFORME USING GIN(mots_cles);
CREATE INDEX idx_blog_publie           ON ARTICLES_BLOG_PLATEFORME(date_publication DESC)
    WHERE statut = 'PUBLIE';

CREATE OR REPLACE FUNCTION fn_valider_programmation_article()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.statut = 'PROGRAMME' THEN
        IF NEW.date_programmation IS NULL THEN
            RAISE EXCEPTION 'Un article PROGRAMME doit avoir une date_programmation';
        END IF;
        IF NEW.date_programmation <= NOW() THEN
            RAISE EXCEPTION 'La date de programmation doit être dans le futur';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_valider_programmation
    BEFORE INSERT OR UPDATE ON ARTICLES_BLOG_PLATEFORME
    FOR EACH ROW EXECUTE FUNCTION fn_valider_programmation_article();

CREATE TRIGGER trg_articles_blog_maj
    BEFORE UPDATE ON ARTICLES_BLOG_PLATEFORME
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

CREATE TABLE COMMENTAIRES (
    id                    SERIAL PRIMARY KEY,
    contenu_commentaire   TEXT NOT NULL,
    contenu_original      TEXT,
    langue                VARCHAR(10) DEFAULT 'fr',
    article_id            INTEGER NOT NULL REFERENCES ARTICLES_BLOG_PLATEFORME(id) ON DELETE CASCADE,
    commentaire_parent_id INTEGER REFERENCES COMMENTAIRES(id) ON DELETE CASCADE,
    auteur_id             INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    statut                statut_commentaire DEFAULT 'EN_ATTENTE',
    est_anonyme           BOOLEAN DEFAULT FALSE,
    pseudo_anonyme        VARCHAR(100),
    note                  INTEGER CHECK (note BETWEEN 1 AND 5),
    date_creation         TIMESTAMP DEFAULT NOW(),
    date_modification     TIMESTAMP DEFAULT NOW(),
    date_moderation       TIMESTAMP,
    moderateur_id         INTEGER REFERENCES COMPTES(id),
    nombre_signalements   INTEGER DEFAULT 0 CHECK (nombre_signalements >= 0),
    motif_signalements    JSONB DEFAULT '[]',
    nombre_likes          INTEGER DEFAULT 0 CHECK (nombre_likes >= 0),
    nombre_dislikes       INTEGER DEFAULT 0 CHECK (nombre_dislikes >= 0),
    nombre_reponses       INTEGER DEFAULT 0 CHECK (nombre_reponses >= 0),
    adresse_ip            INET,
    user_agent            TEXT,
    compagnie_id          INTEGER REFERENCES COMPAGNIESTRANSPORT(id) ON DELETE SET NULL,
    restaurant_id         INTEGER REFERENCES RESTAURANTSFASTFOOD(id) ON DELETE SET NULL,
    boutique_id           INTEGER REFERENCES BOUTIQUES(id) ON DELETE SET NULL,

    CONSTRAINT check_pseudo_anonyme CHECK (
        est_anonyme = FALSE OR pseudo_anonyme IS NOT NULL
    )
);

CREATE INDEX idx_commentaires_article      ON COMMENTAIRES(article_id);
CREATE INDEX idx_commentaires_parent       ON COMMENTAIRES(commentaire_parent_id);
CREATE INDEX idx_commentaires_auteur       ON COMMENTAIRES(auteur_id);
CREATE INDEX idx_commentaires_statut       ON COMMENTAIRES(statut);
CREATE INDEX idx_commentaires_date         ON COMMENTAIRES(date_creation DESC);
CREATE INDEX idx_commentaires_signalements ON COMMENTAIRES(nombre_signalements)
    WHERE nombre_signalements > 0;

CREATE TABLE LIKES_ARTICLES (
    id         SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES ARTICLES_BLOG_PLATEFORME(id) ON DELETE CASCADE,
    compte_id  INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    type_like  VARCHAR(10) NOT NULL CHECK (type_like IN ('LIKE', 'DISLIKE')),
    date_like  TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_like_article_compte UNIQUE (article_id, compte_id)
);

CREATE TABLE LIKES_COMMENTAIRES (
    id             SERIAL PRIMARY KEY,
    commentaire_id INTEGER NOT NULL REFERENCES COMMENTAIRES(id) ON DELETE CASCADE,
    compte_id      INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    type_like      VARCHAR(10) NOT NULL CHECK (type_like IN ('LIKE', 'DISLIKE')),
    date_like      TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_like_commentaire_compte UNIQUE (commentaire_id, compte_id)
);

CREATE TABLE SIGNALEMENTS_ARTICLES (
    id                SERIAL PRIMARY KEY,
    article_id        INTEGER NOT NULL REFERENCES ARTICLES_BLOG_PLATEFORME(id) ON DELETE CASCADE,
    compte_id         INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    motif             VARCHAR(255) NOT NULL,
    description       TEXT,
    statut            VARCHAR(50) DEFAULT 'EN_ATTENTE'
                      CHECK (statut IN ('EN_ATTENTE','EN_COURS','TRAITE','REJETE')),
    traite_par        INTEGER REFERENCES COMPTES(id),
    date_signalement  TIMESTAMP DEFAULT NOW(),
    date_traitement   TIMESTAMP,
    action_entreprise TEXT,
    CONSTRAINT unique_signalement_article_compte UNIQUE (article_id, compte_id)
);

CREATE TABLE SIGNALEMENTS_COMMENTAIRES (
    id               SERIAL PRIMARY KEY,
    commentaire_id   INTEGER NOT NULL REFERENCES COMMENTAIRES(id) ON DELETE CASCADE,
    compte_id        INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    motif            VARCHAR(255) NOT NULL,
    description      TEXT,
    statut           VARCHAR(50) DEFAULT 'EN_ATTENTE'
                     CHECK (statut IN ('EN_ATTENTE','EN_COURS','TRAITE','REJETE')),
    traite_par       INTEGER REFERENCES COMPTES(id),
    date_signalement TIMESTAMP DEFAULT NOW(),
    date_traitement  TIMESTAMP,
    action_entreprise TEXT,
    CONSTRAINT unique_signalement_commentaire_compte UNIQUE (commentaire_id, compte_id)
);

CREATE TABLE PARTAGES_ARTICLES (
    id           SERIAL PRIMARY KEY,
    article_id   INTEGER NOT NULL REFERENCES ARTICLES_BLOG_PLATEFORME(id) ON DELETE CASCADE,
    compte_id    INTEGER REFERENCES COMPTES(id) ON DELETE SET NULL,
    type_partage VARCHAR(50) NOT NULL
                 CHECK (type_partage IN ('FACEBOOK','TWITTER','WHATSAPP','EMAIL',
                                         'COPY_LINK','INSTAGRAM','LINKEDIN','TIKTOK')),
    date_partage TIMESTAMP DEFAULT NOW(),
    adresse_ip   INET
);

CREATE TABLE FAVORIS_ARTICLES (
    id         SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES ARTICLES_BLOG_PLATEFORME(id) ON DELETE CASCADE,
    compte_id  INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    date_ajout TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_favori_article_compte UNIQUE (article_id, compte_id)
);

CREATE TABLE ABONNEMENTS_BLOG (
    id              SERIAL PRIMARY KEY,
    compte_id       INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    type_abonnement VARCHAR(50) NOT NULL
                    CHECK (type_abonnement IN ('CATEGORIE','AUTEUR','TAG')),
    reference_id    INTEGER NOT NULL,
    date_abonnement TIMESTAMP DEFAULT NOW(),
    actif           BOOLEAN DEFAULT TRUE,
    CONSTRAINT unique_abonnement_compte UNIQUE (compte_id, type_abonnement, reference_id)
);

CREATE TABLE NOTIFICATIONS_BLOG (
    id                SERIAL PRIMARY KEY,
    compte_id         INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    type_notification VARCHAR(50) NOT NULL,
    article_id        INTEGER REFERENCES ARTICLES_BLOG_PLATEFORME(id) ON DELETE CASCADE,
    commentaire_id    INTEGER REFERENCES COMMENTAIRES(id) ON DELETE CASCADE,
    message           TEXT NOT NULL,
    est_lue           BOOLEAN DEFAULT FALSE,
    date_creation     TIMESTAMP DEFAULT NOW(),
    date_lecture      TIMESTAMP
);

CREATE INDEX idx_notif_blog_compte    ON NOTIFICATIONS_BLOG(compte_id);
CREATE INDEX idx_notif_blog_non_lues  ON NOTIFICATIONS_BLOG(compte_id, est_lue)
    WHERE est_lue = FALSE;

CREATE TABLE STATS_LECTURE_ARTICLES (
    id                     SERIAL PRIMARY KEY,
    article_id             INTEGER NOT NULL REFERENCES ARTICLES_BLOG_PLATEFORME(id) ON DELETE CASCADE,
    compte_id              INTEGER REFERENCES COMPTES(id) ON DELETE SET NULL,
    adresse_ip             INET,
    user_agent             TEXT,
    temps_lecture_secondes INTEGER CHECK (temps_lecture_secondes >= 0),
    pourcentage_lu         DECIMAL(5,2) CHECK (pourcentage_lu BETWEEN 0 AND 100),
    date_lecture           TIMESTAMP DEFAULT NOW(),
    session_id             VARCHAR(255)
);

CREATE INDEX idx_stats_lecture_article ON STATS_LECTURE_ARTICLES(article_id);
CREATE INDEX idx_stats_lecture_date    ON STATS_LECTURE_ARTICLES(date_lecture DESC);

-- =============================================================================
-- SECTION 19 : MESSAGERIE
-- =============================================================================

CREATE TABLE CONVERSATIONS (
    id                       SERIAL PRIMARY KEY,
    uuid_conversation        UUID DEFAULT gen_random_uuid() UNIQUE,
    type_conversation        type_conversation NOT NULL DEFAULT 'DIRECT',
    titre_conversation       VARCHAR(255),
    description_conversation TEXT,
    avatar_conversation      VARCHAR(500),
    est_prive                BOOLEAN DEFAULT TRUE,
    necessite_approbation    BOOLEAN DEFAULT FALSE,
    est_archive              BOOLEAN DEFAULT FALSE,
    est_verrouille           BOOLEAN DEFAULT FALSE,
    entite_type              entite_reference,  -- Changé pour utiliser le type unifié
    entite_id                INTEGER,
    metadata                 JSONB DEFAULT '{}',
    tags                     TEXT[],
    nombre_participants      INTEGER DEFAULT 0 CHECK (nombre_participants >= 0),
    nombre_messages          INTEGER DEFAULT 0 CHECK (nombre_messages >= 0),
    dernier_message_id       INTEGER,
    date_dernier_message     TIMESTAMP,
    date_creation            TIMESTAMP DEFAULT NOW(),
    date_modification        TIMESTAMP DEFAULT NOW(),
    date_archivage           TIMESTAMP,
    date_fermeture           TIMESTAMP,
    cree_par                 INTEGER REFERENCES COMPTES(id) ON DELETE SET NULL
);

CREATE INDEX idx_conversations_type         ON CONVERSATIONS(type_conversation);
CREATE INDEX idx_conversations_entite       ON CONVERSATIONS(entite_type, entite_id);
CREATE INDEX idx_conversations_date_dernier ON CONVERSATIONS(date_dernier_message DESC);
CREATE INDEX idx_conversations_tags         ON CONVERSATIONS USING GIN(tags);

CREATE TRIGGER trg_conversations_maj
    BEFORE UPDATE ON CONVERSATIONS
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

CREATE TABLE PARTICIPANTS_CONVERSATION (
    id                          SERIAL PRIMARY KEY,
    conversation_id             INTEGER NOT NULL REFERENCES CONVERSATIONS(id) ON DELETE CASCADE,
    compte_id                   INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    role_participant             role_conversation DEFAULT 'PARTICIPANT',
    permissions                 JSONB DEFAULT '{"peut_ecrire": true, "peut_inviter": false, "peut_supprimer": false}',
    est_actif                   BOOLEAN DEFAULT TRUE,
    est_bloque                  BOOLEAN DEFAULT FALSE,
    est_administrateur          BOOLEAN DEFAULT FALSE,
    est_en_vedette              BOOLEAN DEFAULT FALSE,
    surnom_dans_conversation    VARCHAR(100),
    couleur_affichage           VARCHAR(7),
    dernier_message_lu_id       INTEGER,
    date_derniere_lecture       TIMESTAMP,
    messages_non_lus            INTEGER DEFAULT 0 CHECK (messages_non_lus >= 0),
    date_dernier_message_envoye TIMESTAMP,
    date_ajout                  TIMESTAMP DEFAULT NOW(),
    date_sortie                 TIMESTAMP,
    date_derniere_activite      TIMESTAMP,
    date_blocage                TIMESTAMP,
    bloque_par                  INTEGER REFERENCES COMPTES(id),
    notifications_actives       BOOLEAN DEFAULT TRUE,
    mode_notification           VARCHAR(20) DEFAULT 'TOUS'
                                CHECK (mode_notification IN ('TOUS','MENTIONS','AUCUN')),

    CONSTRAINT unique_participant_conversation UNIQUE (conversation_id, compte_id),
    CONSTRAINT check_dates_sortie CHECK (date_sortie IS NULL OR date_sortie >= date_ajout)
);

CREATE INDEX idx_participants_conversation ON PARTICIPANTS_CONVERSATION(conversation_id);
CREATE INDEX idx_participants_compte       ON PARTICIPANTS_CONVERSATION(compte_id);
CREATE INDEX idx_participants_actif        ON PARTICIPANTS_CONVERSATION(est_actif)
    WHERE est_actif = TRUE;

CREATE TABLE MESSAGES (
    id                       SERIAL PRIMARY KEY,
    uuid_message             UUID DEFAULT gen_random_uuid() UNIQUE,
    conversation_id          INTEGER NOT NULL REFERENCES CONVERSATIONS(id) ON DELETE CASCADE,
    expediteur_id            INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    message_parent_id        INTEGER REFERENCES MESSAGES(id) ON DELETE SET NULL,
    contenu_message          TEXT,
    contenu_formatte         TEXT,
    type_message             VARCHAR(20) DEFAULT 'TEXTE'
                             CHECK (type_message IN
                                   ('TEXTE','IMAGE','VIDEO','AUDIO','FICHIER','SYSTEME','LOCALISATION')),
    statut                   statut_message DEFAULT 'ENVOYE',
    est_important            BOOLEAN DEFAULT FALSE,
    est_silencieux           BOOLEAN DEFAULT FALSE,
    est_systeme              BOOLEAN DEFAULT FALSE,
    reponse_a_id             INTEGER REFERENCES MESSAGES(id) ON DELETE SET NULL,
    mentions_comptes         INTEGER[] DEFAULT '{}',
    metadata                 JSONB DEFAULT '{}',
    adresse_ip               INET,
    user_agent               TEXT,
    date_envoi               TIMESTAMP DEFAULT NOW(),
    date_modification        TIMESTAMP,
    date_suppression         TIMESTAMP,
    date_lecture             TIMESTAMP,
    historique_modifications JSONB DEFAULT '[]',
    supprime_par             INTEGER REFERENCES COMPTES(id),
    motif_suppression        VARCHAR(255),

    CONSTRAINT check_contenu_requis CHECK (
        (type_message = 'TEXTE' AND contenu_message IS NOT NULL AND contenu_message <> '')
        OR (type_message = 'SYSTEME')
        OR (type_message != 'TEXTE' AND metadata IS NOT NULL)
    )
);

CREATE INDEX idx_messages_conversation ON MESSAGES(conversation_id, date_envoi DESC);
CREATE INDEX idx_messages_expediteur   ON MESSAGES(expediteur_id);
CREATE INDEX idx_messages_statut       ON MESSAGES(statut);
CREATE INDEX idx_messages_date         ON MESSAGES(date_envoi DESC);
CREATE INDEX idx_messages_uuid         ON MESSAGES(uuid_message);
CREATE INDEX idx_messages_mentions     ON MESSAGES USING GIN(mentions_comptes);
CREATE INDEX idx_messages_non_suppr    ON MESSAGES(conversation_id)
    WHERE date_suppression IS NULL;

CREATE TABLE PIECES_JOINTES (
    id                     SERIAL PRIMARY KEY,
    message_id             INTEGER NOT NULL REFERENCES MESSAGES(id) ON DELETE CASCADE,
    uuid_fichier           UUID DEFAULT gen_random_uuid() UNIQUE,
    nom_fichier            VARCHAR(255) NOT NULL,
    type_fichier           type_piece_jointe NOT NULL,
    mime_type              VARCHAR(100),
    taille_fichier         BIGINT CHECK (taille_fichier > 0),
    chemin_fichier         VARCHAR(500),
    url_telechargement     VARCHAR(500),
    largeur_image          INTEGER,
    hauteur_image          INTEGER,
    duree_media            INTEGER,
    thumbnail_url          VARCHAR(500),
    metadata               JSONB DEFAULT '{}',
    est_public             BOOLEAN DEFAULT FALSE,
    mot_de_passe_protege   BOOLEAN DEFAULT FALSE,
    date_expiration        TIMESTAMP,
    nombre_telechargements INTEGER DEFAULT 0 CHECK (nombre_telechargements >= 0),
    date_upload            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_pieces_jointes_message ON PIECES_JOINTES(message_id);
CREATE INDEX idx_pieces_jointes_type    ON PIECES_JOINTES(type_fichier);

CREATE TABLE REACTIONS_MESSAGES (
    id            SERIAL PRIMARY KEY,
    message_id    INTEGER NOT NULL REFERENCES MESSAGES(id) ON DELETE CASCADE,
    compte_id     INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    emoji         VARCHAR(50) NOT NULL,
    date_reaction TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_reaction_message_compte_emoji UNIQUE (message_id, compte_id, emoji)
);

CREATE INDEX idx_reactions_message ON REACTIONS_MESSAGES(message_id);
CREATE INDEX idx_reactions_compte  ON REACTIONS_MESSAGES(compte_id);

CREATE TABLE LECTURES_MESSAGES (
    id           SERIAL PRIMARY KEY,
    message_id   INTEGER NOT NULL REFERENCES MESSAGES(id) ON DELETE CASCADE,
    compte_id    INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    date_lecture TIMESTAMP DEFAULT NOW(),
    adresse_ip   INET,
    CONSTRAINT unique_lecture_message_compte UNIQUE (message_id, compte_id)
);

CREATE INDEX idx_lectures_message ON LECTURES_MESSAGES(message_id);
CREATE INDEX idx_lectures_compte  ON LECTURES_MESSAGES(compte_id);

CREATE TABLE INVITATIONS_CONVERSATION (
    id                   SERIAL PRIMARY KEY,
    conversation_id      INTEGER NOT NULL REFERENCES CONVERSATIONS(id) ON DELETE CASCADE,
    invite_par           INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    email_invite         VARCHAR(255),
    compte_id            INTEGER REFERENCES COMPTES(id) ON DELETE CASCADE,
    token_invitation     VARCHAR(255) UNIQUE NOT NULL,
    role_propose         role_conversation DEFAULT 'PARTICIPANT',
    message_personnalise TEXT,
    statut               VARCHAR(50) DEFAULT 'EN_ATTENTE'
                         CHECK (statut IN ('EN_ATTENTE','ACCEPTEE','REFUSEE','EXPIREE')),
    date_envoi           TIMESTAMP DEFAULT NOW(),
    date_reponse         TIMESTAMP,
    date_expiration      TIMESTAMP DEFAULT (NOW() + INTERVAL '7 days'),

    CONSTRAINT check_destinataire CHECK (
        (email_invite IS NOT NULL AND compte_id IS NULL) OR
        (email_invite IS NULL AND compte_id IS NOT NULL)
    )
);

CREATE INDEX idx_invitations_token        ON INVITATIONS_CONVERSATION(token_invitation);
CREATE INDEX idx_invitations_conversation ON INVITATIONS_CONVERSATION(conversation_id);

CREATE TABLE BLOCAGES_UTILISATEURS (
    id               SERIAL PRIMARY KEY,
    compte_bloqueur  INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    compte_bloque    INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    type_blocage     VARCHAR(50) DEFAULT 'MESSAGERIE'
                     CHECK (type_blocage IN ('MESSAGERIE','CONVERSATION','GLOBAL')),
    conversation_id  INTEGER REFERENCES CONVERSATIONS(id) ON DELETE CASCADE,
    motif            VARCHAR(255),
    est_temporaire   BOOLEAN DEFAULT FALSE,
    date_fin_blocage TIMESTAMP,
    date_blocage     TIMESTAMP DEFAULT NOW(),
    date_deblocage   TIMESTAMP,

    CONSTRAINT check_pas_soi_meme CHECK (compte_bloqueur != compte_bloque),
    CONSTRAINT check_blocage_temporaire CHECK (
        est_temporaire = FALSE OR date_fin_blocage IS NOT NULL
    )
);

CREATE UNIQUE INDEX idx_blocage_global
    ON BLOCAGES_UTILISATEURS(compte_bloqueur, compte_bloque)
    WHERE conversation_id IS NULL;

CREATE UNIQUE INDEX idx_blocage_conversation
    ON BLOCAGES_UTILISATEURS(compte_bloqueur, compte_bloque, conversation_id)
    WHERE conversation_id IS NOT NULL;

CREATE INDEX idx_blocages_comptes ON BLOCAGES_UTILISATEURS(compte_bloqueur, compte_bloque);

CREATE TABLE MODELES_MESSAGES (
    id                  SERIAL PRIMARY KEY,
    compte_id           INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    titre               VARCHAR(255) NOT NULL,
    contenu_message     TEXT NOT NULL,
    categorie           VARCHAR(100),
    tags                TEXT[],
    raccourci           VARCHAR(50),
    nombre_utilisations INTEGER DEFAULT 0 CHECK (nombre_utilisations >= 0),
    date_creation       TIMESTAMP DEFAULT NOW(),
    date_modification   TIMESTAMP DEFAULT NOW(),
    dernier_usage       TIMESTAMP,
    est_partage_public  BOOLEAN DEFAULT FALSE,
    CONSTRAINT unique_raccourci_compte UNIQUE (compte_id, raccourci)
);

CREATE INDEX idx_modeles_compte ON MODELES_MESSAGES(compte_id);

CREATE OR REPLACE FUNCTION update_conversation_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE CONVERSATIONS
        SET nombre_messages      = nombre_messages + 1,
            dernier_message_id   = NEW.id,
            date_dernier_message = NEW.date_envoi
        WHERE id = NEW.conversation_id;

        UPDATE PARTICIPANTS_CONVERSATION
        SET dernier_message_lu_id = NEW.id,
            date_derniere_lecture = NEW.date_envoi,
            date_dernier_message_envoye = NEW.date_envoi
        WHERE conversation_id = NEW.conversation_id
          AND compte_id = NEW.expediteur_id;

        UPDATE PARTICIPANTS_CONVERSATION
        SET messages_non_lus = messages_non_lus + 1
        WHERE conversation_id = NEW.conversation_id
          AND compte_id != NEW.expediteur_id
          AND est_actif = TRUE
          AND notifications_actives = TRUE;

    ELSIF TG_OP = 'DELETE' THEN
        UPDATE CONVERSATIONS
        SET nombre_messages = GREATEST(nombre_messages - 1, 0)
        WHERE id = OLD.conversation_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_message_stats
    AFTER INSERT OR DELETE ON MESSAGES
    FOR EACH ROW EXECUTE FUNCTION update_conversation_stats();

CREATE OR REPLACE FUNCTION marquer_messages_comme_lus(
    p_conversation_id INTEGER,
    p_compte_id       INTEGER
) RETURNS VOID AS $$
BEGIN
    UPDATE MESSAGES
    SET statut = 'LU'
    WHERE conversation_id = p_conversation_id
      AND expediteur_id != p_compte_id
      AND statut NOT IN ('LU', 'SUPPRIME')
      AND date_suppression IS NULL;

    UPDATE PARTICIPANTS_CONVERSATION
    SET messages_non_lus      = 0,
        dernier_message_lu_id = (
            SELECT id FROM MESSAGES
            WHERE conversation_id = p_conversation_id
              AND date_suppression IS NULL
            ORDER BY date_envoi DESC
            LIMIT 1
        ),
        date_derniere_lecture = NOW()
    WHERE conversation_id = p_conversation_id
      AND compte_id = p_compte_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- SECTION 20 : HISTORIQUES & TRANSACTIONS
-- =============================================================================

CREATE TABLE FILE_TACHES (
    id              SERIAL PRIMARY KEY,
    type_tache      VARCHAR(80) NOT NULL,
    payload         JSONB NOT NULL,
    statut          statut_tache DEFAULT 'EN_ATTENTE',
    priorite        SMALLINT DEFAULT 5 CHECK (priorite BETWEEN 1 AND 10),
    tentatives      SMALLINT DEFAULT 0 CHECK (tentatives >= 0),
    max_tentatives  SMALLINT DEFAULT 3,
    derniere_erreur TEXT,
    execute_apres   TIMESTAMP DEFAULT NOW(),
    date_creation   TIMESTAMP DEFAULT NOW(),
    date_debut      TIMESTAMP,
    date_fin        TIMESTAMP,
    worker_id       VARCHAR(100)
);

CREATE INDEX idx_file_taches_pending ON FILE_TACHES(statut, priorite DESC, execute_apres)
    WHERE statut IN ('EN_ATTENTE','ECHOUEE') AND tentatives < max_tentatives;

CREATE TABLE HISTORIQUE_ACTIONS (
    id              SERIAL,
    action_type     VARCHAR(50) NOT NULL,
    table_concernee VARCHAR(80) NOT NULL,
    entite_id       INTEGER NOT NULL,
    donnees_avant   JSONB,
    donnees_apres   JSONB,
    utilisateur_id  INTEGER,
    ip_adresse      INET,
    user_agent      TEXT,
    date_action     TIMESTAMP DEFAULT NOW() NOT NULL
) PARTITION BY RANGE (date_action);

CREATE TABLE HISTORIQUE_ACTIONS_2025
    PARTITION OF HISTORIQUE_ACTIONS
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

CREATE TABLE HISTORIQUE_ACTIONS_2026
    PARTITION OF HISTORIQUE_ACTIONS
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

CREATE TABLE HISTORIQUE_ACTIONS_2027
    PARTITION OF HISTORIQUE_ACTIONS
    FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

CREATE TABLE HISTORIQUE_ACTIONS_DEFAULT
    PARTITION OF HISTORIQUE_ACTIONS DEFAULT;

CREATE INDEX idx_historique_action_type ON HISTORIQUE_ACTIONS(action_type);
CREATE INDEX idx_historique_table       ON HISTORIQUE_ACTIONS(table_concernee);
CREATE INDEX idx_historique_date        ON HISTORIQUE_ACTIONS(date_action DESC);
CREATE INDEX idx_historique_utilisateur ON HISTORIQUE_ACTIONS(utilisateur_id);

CREATE TABLE HISTORIQUE_TRANSACTIONS (
    id                    SERIAL,
    type_transaction      VARCHAR(50) NOT NULL
                          CHECK (type_transaction IN
                                ('ACHAT','VENTE','REMBOURSEMENT','COMMISSION','TRANSFERT')),
    montant               DECIMAL(15,2) NOT NULL CHECK (montant > 0),
    devise                VARCHAR(3) DEFAULT 'XOF',
    statut_transaction    VARCHAR(50) DEFAULT 'EN_ATTENTE'
                          CHECK (statut_transaction IN
                                ('EN_ATTENTE','COMPLETEE','ECHOUEE','ANNULEE')),
    compte_source_id      INTEGER,
    compte_destination_id INTEGER,
    compagnie_id          INTEGER,
    emplacement_id        INTEGER,
    restaurant_id         INTEGER,
    boutique_id           INTEGER,
    plateforme_id         INTEGER,
    ticket_id             INTEGER,
    service_id            INTEGER,
    commande_rff_id       INTEGER,
    commande_boutique_id  INTEGER,
    transaction_uuid      UUID DEFAULT gen_random_uuid(),
    reference_externe     VARCHAR(255),
    description           TEXT,
    metadata              JSONB DEFAULT '{}'::jsonb,
    date_transaction      TIMESTAMP DEFAULT NOW() NOT NULL,
    date_validation       TIMESTAMP
) PARTITION BY RANGE (date_transaction);

CREATE TABLE HISTORIQUE_TRANSACTIONS_2025_01
    PARTITION OF HISTORIQUE_TRANSACTIONS
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE HISTORIQUE_TRANSACTIONS_2025_02
    PARTITION OF HISTORIQUE_TRANSACTIONS
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

CREATE TABLE HISTORIQUE_TRANSACTIONS_2026_01
    PARTITION OF HISTORIQUE_TRANSACTIONS
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE HISTORIQUE_TRANSACTIONS_2026_02
    PARTITION OF HISTORIQUE_TRANSACTIONS
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE HISTORIQUE_TRANSACTIONS_DEFAULT
    PARTITION OF HISTORIQUE_TRANSACTIONS DEFAULT;

CREATE INDEX idx_transactions_type    ON HISTORIQUE_TRANSACTIONS(type_transaction);
CREATE INDEX idx_transactions_date    ON HISTORIQUE_TRANSACTIONS(date_transaction DESC);
CREATE INDEX idx_transactions_uuid    ON HISTORIQUE_TRANSACTIONS(transaction_uuid);
CREATE INDEX idx_transactions_statut  ON HISTORIQUE_TRANSACTIONS(statut_transaction);
CREATE INDEX idx_transactions_compte  ON HISTORIQUE_TRANSACTIONS(compte_source_id);

CREATE TABLE HISTORIQUE_CONNEXIONS (
    id                 SERIAL PRIMARY KEY,
    compte_id          INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    type_connexion     types_connexions,
    adresse_ip         INET NOT NULL,
    utilisateur_agent  TEXT,
    pays               VARCHAR(100),
    ville              VARCHAR(100),
    statut_connexion   statuts_connexion,
    code_erreur        VARCHAR(50),
    date_connexion     TIMESTAMP DEFAULT NOW() NOT NULL,
    date_deconnexion   TIMESTAMP,
    duree_session      INTERVAL GENERATED ALWAYS AS
                       (date_deconnexion - date_connexion) STORED,

    CONSTRAINT check_dates_connexion
        CHECK (date_deconnexion IS NULL OR date_deconnexion >= date_connexion)
);

CREATE INDEX idx_hist_connexion_compte ON HISTORIQUE_CONNEXIONS(compte_id);
CREATE INDEX idx_hist_connexion_date   ON HISTORIQUE_CONNEXIONS(date_connexion DESC);
CREATE INDEX idx_hist_connexion_ip     ON HISTORIQUE_CONNEXIONS(adresse_ip);
CREATE INDEX idx_hist_connexion_statut ON HISTORIQUE_CONNEXIONS(statut_connexion);

-- =============================================================================
-- SECTION 21 : MODULE ADRESSES CENTRALISÉES
-- =============================================================================

CREATE TABLE ADRESSES (
    id               SERIAL PRIMARY KEY,
    libelle          VARCHAR(100),
    ligne_1          VARCHAR(255) NOT NULL,
    ligne_2          VARCHAR(255),
    quartier         VARCHAR(100),
    ville            VARCHAR(100) NOT NULL,
    code_postal      VARCHAR(20),
    commune          VARCHAR(100),
    province         VARCHAR(100),
    pays             VARCHAR(100) NOT NULL DEFAULT 'Burkina Faso',
    coordonnees      geometry(Point, 4326),  -- Changé de POINT
    precision_gps    DECIMAL(8,5),
    est_verifiee     BOOLEAN DEFAULT FALSE,
    date_creation    TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_adresses_ville   ON ADRESSES(ville);
CREATE INDEX idx_adresses_pays    ON ADRESSES(pays);
CREATE INDEX idx_adresses_coords  ON ADRESSES USING GIST(coordonnees);

CREATE TRIGGER trg_adresses_maj
    BEFORE UPDATE ON ADRESSES
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

CREATE TABLE ADRESSES_ENTITES (
    id           SERIAL PRIMARY KEY,
    adresse_id   INTEGER NOT NULL REFERENCES ADRESSES(id) ON DELETE CASCADE,
    entite_type  entite_reference NOT NULL,  -- Changé pour utiliser le type unifié
    entite_id    INTEGER NOT NULL,
    type_adresse VARCHAR(50) DEFAULT 'PRINCIPALE'
                 CHECK (type_adresse IN ('PRINCIPALE','LIVRAISON','FACTURATION','SECONDAIRE')),
    est_actif    BOOLEAN DEFAULT TRUE,
    date_ajout   TIMESTAMP DEFAULT NOW(),

    CONSTRAINT unique_adresse_entite_type UNIQUE (entite_type, entite_id, type_adresse)
);

CREATE INDEX idx_adresses_entites_lookup ON ADRESSES_ENTITES(entite_type, entite_id);

ALTER TABLE COMMANDESEMPLACEMENTFASTFOOD
    ADD CONSTRAINT fk_adresse_livraison_rff
        FOREIGN KEY (adresse_livraison_id)
        REFERENCES ADRESSES(id) ON DELETE SET NULL;

ALTER TABLE COMMANDESBOUTIQUES
    ADD CONSTRAINT fk_adresse_livraison_boutique
        FOREIGN KEY (adresse_livraison_id)
        REFERENCES ADRESSES(id) ON DELETE SET NULL;

-- =============================================================================
-- SECTION 22 : SYSTÈME DE NOTATION / AVIS
-- =============================================================================

CREATE TABLE AVIS (
    id                SERIAL PRIMARY KEY,
    entite_type       entite_reference NOT NULL,  -- Changé pour utiliser le type unifié
    entite_id         INTEGER NOT NULL,
    auteur_id         INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    note_globale      SMALLINT NOT NULL CHECK (note_globale BETWEEN 1 AND 5),
    note_qualite      SMALLINT CHECK (note_qualite BETWEEN 1 AND 5),
    note_service      SMALLINT CHECK (note_service BETWEEN 1 AND 5),
    note_rapport_prix SMALLINT CHECK (note_rapport_prix BETWEEN 1 AND 5),
    note_ponctualite  SMALLINT CHECK (note_ponctualite BETWEEN 1 AND 5),
    titre             VARCHAR(150),
    contenu           TEXT,
    photos_avis       JSONB DEFAULT '[]',
    statut            statut_avis DEFAULT 'EN_ATTENTE',
    transaction_uuid  UUID,
    commande_type     VARCHAR(50)
                      CHECK (commande_type IS NULL OR
                             commande_type IN ('RESTAURANT_FAST_FOOD','BOUTIQUE','TRANSPORT')),
    commande_id       INTEGER,
    est_achat_verifie BOOLEAN DEFAULT FALSE,
    reponse_pro       TEXT,
    reponse_pro_date  TIMESTAMP,
    reponse_pro_par   INTEGER REFERENCES COMPTES(id) ON DELETE SET NULL,
    moderateur_id     INTEGER REFERENCES COMPTES(id) ON DELETE SET NULL,
    date_moderation   TIMESTAMP,
    motif_rejet       TEXT,
    nombre_utile      INTEGER DEFAULT 0 CHECK (nombre_utile >= 0),
    nombre_inutile    INTEGER DEFAULT 0 CHECK (nombre_inutile >= 0),
    date_creation     TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour  TIMESTAMP DEFAULT NOW(),

    CONSTRAINT unique_avis_par_commande
        UNIQUE NULLS NOT DISTINCT (entite_type, entite_id, auteur_id, commande_id)
);

CREATE INDEX idx_avis_entite    ON AVIS(entite_type, entite_id);
CREATE INDEX idx_avis_auteur    ON AVIS(auteur_id);
CREATE INDEX idx_avis_note      ON AVIS(note_globale);
CREATE INDEX idx_avis_statut    ON AVIS(statut);
CREATE INDEX idx_avis_verifie   ON AVIS(est_achat_verifie) WHERE est_achat_verifie = TRUE;
CREATE INDEX idx_avis_recents   ON AVIS(entite_type, entite_id, date_creation DESC)
    WHERE statut = 'PUBLIE';

CREATE TRIGGER trg_avis_maj
    BEFORE UPDATE ON AVIS
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

CREATE TABLE VOTES_AVIS (
    id        SERIAL PRIMARY KEY,
    avis_id   INTEGER NOT NULL REFERENCES AVIS(id) ON DELETE CASCADE,
    compte_id INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    est_utile BOOLEAN NOT NULL,
    date_vote TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_vote_avis_compte UNIQUE (avis_id, compte_id)
);

CREATE MATERIALIZED VIEW VUE_NOTES_MOYENNES AS
SELECT
    entite_type,
    entite_id,
    COUNT(*)                                        AS nombre_avis,
    ROUND(AVG(note_globale)::NUMERIC, 2)            AS note_moyenne,
    ROUND(AVG(note_qualite)::NUMERIC, 2)            AS qualite_moyenne,
    ROUND(AVG(note_service)::NUMERIC, 2)            AS service_moyen,
    ROUND(AVG(note_rapport_prix)::NUMERIC, 2)       AS rapport_prix_moyen,
    ROUND(AVG(note_ponctualite)::NUMERIC, 2)        AS ponctualite_moyenne,
    COUNT(*) FILTER (WHERE note_globale = 5)        AS avis_5_etoiles,
    COUNT(*) FILTER (WHERE note_globale = 4)        AS avis_4_etoiles,
    COUNT(*) FILTER (WHERE note_globale = 3)        AS avis_3_etoiles,
    COUNT(*) FILTER (WHERE note_globale <= 2)       AS avis_negatifs
FROM AVIS
WHERE statut = 'PUBLIE'
GROUP BY entite_type, entite_id
WITH DATA;

CREATE UNIQUE INDEX idx_notes_moyennes_entite ON VUE_NOTES_MOYENNES(entite_type, entite_id);

CREATE OR REPLACE FUNCTION fn_invalider_notes_moyennes()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO FILE_TACHES (type_tache, payload, priorite)
    VALUES (
        'REFRESH_VUE_NOTES_MOYENNES',
        jsonb_build_object(
            'entite_type', COALESCE(NEW.entite_type, OLD.entite_type),
            'entite_id',   COALESCE(NEW.entite_id,   OLD.entite_id)
        ),
        4
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invalider_notes
    AFTER INSERT OR UPDATE OR DELETE ON AVIS
    FOR EACH ROW EXECUTE FUNCTION fn_invalider_notes_moyennes();

-- =============================================================================
-- SECTION 23 : GESTION DES HORAIRES FLEXIBLE
-- =============================================================================

CREATE TABLE HORAIRES (
    id                  SERIAL PRIMARY KEY,
    entite_type         entite_reference NOT NULL,  -- Changé pour utiliser le type unifié
    entite_id           INTEGER NOT NULL,
    jour_semaine        SMALLINT NOT NULL CHECK (jour_semaine BETWEEN 0 AND 6),
    heure_ouverture     TIME,
    heure_fermeture     TIME,
    heure_coupure_debut TIME,
    heure_coupure_fin   TIME,
    est_ouvert          BOOLEAN DEFAULT TRUE,
    date_creation       TIMESTAMP DEFAULT NOW(),

    CONSTRAINT unique_horaire_entite_jour UNIQUE (entite_type, entite_id, jour_semaine),
    CONSTRAINT check_horaires_coherents CHECK (
        est_ouvert = FALSE OR
        (heure_ouverture IS NOT NULL AND heure_fermeture IS NOT NULL AND heure_fermeture > heure_ouverture)
    ),
    CONSTRAINT check_coupure_coherente CHECK (
        heure_coupure_debut IS NULL OR (
            heure_ouverture IS NOT NULL AND
            heure_coupure_debut > heure_ouverture AND
            heure_coupure_fin > heure_coupure_debut AND
            heure_coupure_fin < heure_fermeture
        )
    )
);

CREATE INDEX idx_horaires_entite ON HORAIRES(entite_type, entite_id);

CREATE TABLE HORAIRES_EXCEPTIONS (
    id              SERIAL PRIMARY KEY,
    entite_type     entite_reference NOT NULL,  -- Changé pour utiliser le type unifié
    entite_id       INTEGER NOT NULL,
    date_exception  DATE NOT NULL,
    libelle         VARCHAR(150),
    est_ouvert      BOOLEAN DEFAULT FALSE,
    heure_ouverture TIME,
    heure_fermeture TIME,
    motif           TEXT,
    date_creation   TIMESTAMP DEFAULT NOW(),

    CONSTRAINT unique_exception_entite_date UNIQUE (entite_type, entite_id, date_exception),
    CONSTRAINT check_exception_horaires CHECK (
        est_ouvert = FALSE OR
        (heure_ouverture IS NOT NULL AND heure_fermeture IS NOT NULL AND
         heure_fermeture > heure_ouverture)
    )
);

CREATE INDEX idx_horaires_exceptions_date   ON HORAIRES_EXCEPTIONS(date_exception);
CREATE INDEX idx_horaires_exceptions_entite ON HORAIRES_EXCEPTIONS(entite_type, entite_id);

CREATE TABLE JOURS_FERIES (
    id            SERIAL PRIMARY KEY,
    pays          VARCHAR(100) DEFAULT 'Burkina Faso',
    date_ferie    DATE NOT NULL,
    libelle       VARCHAR(150) NOT NULL,
    est_recurrent BOOLEAN DEFAULT TRUE,
    CONSTRAINT unique_ferie_pays_date UNIQUE (pays, date_ferie)
);

CREATE OR REPLACE FUNCTION fn_est_ouvert(
    p_entite_type entite_reference,
    p_entite_id   INTEGER,
    p_datetime    TIMESTAMP DEFAULT NOW()
) RETURNS BOOLEAN AS $$
DECLARE
    v_jour      SMALLINT;
    v_heure     TIME;
    v_exception RECORD;
    v_horaire   RECORD;
BEGIN
    v_jour  := ((EXTRACT(DOW FROM p_datetime)::INTEGER + 6) % 7)::SMALLINT;
    v_heure := p_datetime::TIME;

    SELECT * INTO v_exception
    FROM HORAIRES_EXCEPTIONS
    WHERE entite_type   = p_entite_type
      AND entite_id     = p_entite_id
      AND date_exception = p_datetime::DATE;

    IF FOUND THEN
        IF NOT v_exception.est_ouvert THEN RETURN FALSE; END IF;
        IF v_exception.heure_ouverture IS NULL THEN RETURN TRUE; END IF;
        RETURN v_heure BETWEEN v_exception.heure_ouverture AND v_exception.heure_fermeture;
    END IF;

    SELECT * INTO v_horaire
    FROM HORAIRES
    WHERE entite_type  = p_entite_type
      AND entite_id    = p_entite_id
      AND jour_semaine = v_jour;

    IF NOT FOUND OR NOT v_horaire.est_ouvert THEN RETURN FALSE; END IF;
    IF v_horaire.heure_ouverture IS NULL THEN RETURN TRUE; END IF;

    RETURN v_heure BETWEEN v_horaire.heure_ouverture AND v_horaire.heure_fermeture
        AND (v_horaire.heure_coupure_debut IS NULL OR
             NOT (v_heure BETWEEN v_horaire.heure_coupure_debut AND v_horaire.heure_coupure_fin));
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================================
-- SECTION 24 : PARRAINAGE / FIDÉLITÉ
-- =============================================================================

CREATE TABLE PROGRAMMES_FIDELITE (
    id                   SERIAL PRIMARY KEY,
    entite_type          entite_reference NOT NULL,  -- Changé pour utiliser le type unifié
    entite_id            INTEGER NOT NULL,
    nom_programme        VARCHAR(150) NOT NULL,
    description          TEXT,
    points_par_tranche   INTEGER DEFAULT 1 CHECK (points_par_tranche > 0),
    montant_tranche      DECIMAL(10,2) DEFAULT 1000 CHECK (montant_tranche > 0),
    valeur_point_fcfa    DECIMAL(8,2) DEFAULT 5.00 CHECK (valeur_point_fcfa > 0),
    paliers              JSONB DEFAULT '[]',
    est_actif            BOOLEAN DEFAULT TRUE,
    date_debut           DATE,
    date_fin             DATE,
    date_creation        TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour     TIMESTAMP DEFAULT NOW(),

    CONSTRAINT unique_programme_entite UNIQUE (entite_type, entite_id),
    CONSTRAINT check_dates_programme CHECK (
        date_fin IS NULL OR date_debut IS NULL OR date_fin >= date_debut
    )
);

CREATE TABLE SOLDES_FIDELITE (
    id                     SERIAL PRIMARY KEY,
    compte_id              INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    programme_id           INTEGER NOT NULL REFERENCES PROGRAMMES_FIDELITE(id) ON DELETE CASCADE,
    points_actuels         INTEGER DEFAULT 0 CHECK (points_actuels >= 0),
    points_cumules         INTEGER DEFAULT 0 CHECK (points_cumules >= 0),
    points_expires         INTEGER DEFAULT 0 CHECK (points_expires >= 0),
    niveau_actuel          VARCHAR(50) DEFAULT 'STANDARD',
    date_derniere_activite TIMESTAMP DEFAULT NOW(),
    date_creation          TIMESTAMP DEFAULT NOW(),

    CONSTRAINT unique_solde_compte_programme UNIQUE (compte_id, programme_id)
);

CREATE INDEX idx_soldes_fidelite_compte    ON SOLDES_FIDELITE(compte_id);
CREATE INDEX idx_soldes_fidelite_programme ON SOLDES_FIDELITE(programme_id);

CREATE TABLE MOUVEMENTS_POINTS (
    id             SERIAL PRIMARY KEY,
    solde_id       INTEGER NOT NULL REFERENCES SOLDES_FIDELITE(id) ON DELETE CASCADE,
    type_mouvement type_mouvement_points NOT NULL,
    points         INTEGER NOT NULL,
    points_avant   INTEGER NOT NULL,
    points_apres   INTEGER NOT NULL CHECK (points_apres >= 0),
    reference_type VARCHAR(50),
    reference_id   INTEGER,
    description    TEXT,
    expire_le      TIMESTAMP,
    date_mouvement TIMESTAMP DEFAULT NOW(),

    CONSTRAINT check_coherence_points CHECK (points_apres = points_avant + points)
);

CREATE INDEX idx_mouvements_points_solde ON MOUVEMENTS_POINTS(solde_id);
CREATE INDEX idx_mouvements_points_date  ON MOUVEMENTS_POINTS(date_mouvement DESC);

CREATE TABLE PARRAINAGES (
    id                   SERIAL PRIMARY KEY,
    parrain_id           INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    filleul_id           INTEGER REFERENCES COMPTES(id) ON DELETE SET NULL,
    code_parrainage      VARCHAR(20) UNIQUE NOT NULL,
    points_parrain       INTEGER DEFAULT 0 CHECK (points_parrain >= 0),
    points_filleul       INTEGER DEFAULT 0 CHECK (points_filleul >= 0),
    bonus_fcfa_parrain   DECIMAL(10,2) DEFAULT 0 CHECK (bonus_fcfa_parrain >= 0),
    bonus_fcfa_filleul   DECIMAL(10,2) DEFAULT 0 CHECK (bonus_fcfa_filleul >= 0),
    statut               VARCHAR(30) DEFAULT 'EN_ATTENTE'
                         CHECK (statut IN ('EN_ATTENTE','UTILISE','CONVERTI','EXPIRE')),
    condition_conversion VARCHAR(100),
    est_converti         BOOLEAN DEFAULT FALSE,
    date_conversion      TIMESTAMP,
    date_creation        TIMESTAMP DEFAULT NOW(),
    date_expiration      TIMESTAMP DEFAULT (NOW() + INTERVAL '90 days'),

    CONSTRAINT check_pas_autoparrainage CHECK (parrain_id != filleul_id),
    CONSTRAINT check_conversion CHECK (
        est_converti = FALSE OR (est_converti = TRUE AND date_conversion IS NOT NULL)
    )
);

CREATE INDEX idx_parrainages_parrain ON PARRAINAGES(parrain_id);
CREATE INDEX idx_parrainages_code    ON PARRAINAGES(code_parrainage);
CREATE INDEX idx_parrainages_statut  ON PARRAINAGES(statut);

CREATE OR REPLACE FUNCTION fn_generer_code_parrainage()
RETURNS TRIGGER AS $$
DECLARE
    v_code VARCHAR(20);
    v_iter INTEGER := 0;
BEGIN
    IF NEW.code_parrainage IS NULL THEN
        LOOP
            v_iter := v_iter + 1;
            IF v_iter > 100 THEN
                RAISE EXCEPTION 'Impossible de générer un code de parrainage unique';
            END IF;
            v_code := UPPER(SUBSTRING(encode(gen_random_bytes(6), 'hex') FROM 1 FOR 8));
            EXIT WHEN NOT EXISTS (SELECT 1 FROM PARRAINAGES WHERE code_parrainage = v_code);
        END LOOP;
        NEW.code_parrainage := v_code;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_code_parrainage
    BEFORE INSERT ON PARRAINAGES
    FOR EACH ROW EXECUTE FUNCTION fn_generer_code_parrainage();

-- =============================================================================
-- SECTION 25 : NOTIFICATIONS UNIFIÉES
-- =============================================================================

CREATE TABLE MODELES_NOTIFICATIONS (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(80) UNIQUE NOT NULL,
    titre_template  VARCHAR(255) NOT NULL,
    corps_template  TEXT NOT NULL,
    canal_defaut    canal_notification DEFAULT 'IN_APP',
    priorite_defaut priorite_notification DEFAULT 'NORMALE',
    est_actif       BOOLEAN DEFAULT TRUE,
    date_creation   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE NOTIFICATIONS (
    id                  SERIAL PRIMARY KEY,
    uuid_notification   UUID DEFAULT gen_random_uuid() UNIQUE,
    destinataire_id     INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    modele_id           INTEGER REFERENCES MODELES_NOTIFICATIONS(id) ON DELETE SET NULL,
    titre               VARCHAR(255) NOT NULL,
    corps               TEXT NOT NULL,
    action_type         VARCHAR(50),
    action_id           INTEGER,
    action_url          VARCHAR(500),
    image_url           VARCHAR(500),
    canal               canal_notification DEFAULT 'IN_APP',
    priorite            priorite_notification DEFAULT 'NORMALE',
    est_lue             BOOLEAN DEFAULT FALSE,
    est_archivee        BOOLEAN DEFAULT FALSE,
    date_lecture        TIMESTAMP,
    entite_source_type  entite_reference,  -- Changé pour utiliser le type unifié
    entite_source_id    INTEGER,
    date_envoi_prevu    TIMESTAMP DEFAULT NOW(),
    date_envoi_effectif TIMESTAMP,
    date_creation       TIMESTAMP DEFAULT NOW(),
    date_expiration     TIMESTAMP DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX idx_notifications_destinataire ON NOTIFICATIONS(destinataire_id);
CREATE INDEX idx_notifications_non_lues     ON NOTIFICATIONS(destinataire_id, est_lue)
    WHERE est_lue = FALSE;
CREATE INDEX idx_notifications_date         ON NOTIFICATIONS(date_creation DESC);
CREATE INDEX idx_notifications_canal        ON NOTIFICATIONS(canal);
CREATE INDEX idx_notifications_source       ON NOTIFICATIONS(entite_source_type, entite_source_id);

CREATE TABLE PREFERENCES_NOTIFICATIONS (
    id                     SERIAL PRIMARY KEY,
    compte_id              INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    canal                  canal_notification NOT NULL,
    type_evenement         VARCHAR(80) NOT NULL,
    est_active             BOOLEAN DEFAULT TRUE,
    heure_debut_silencieux TIME DEFAULT '22:00',
    heure_fin_silencieux   TIME DEFAULT '07:00',

    CONSTRAINT unique_preference_compte_canal_type UNIQUE (compte_id, canal, type_evenement)
);

CREATE TABLE TOKENS_PUSH (
    id                        SERIAL PRIMARY KEY,
    compte_id                 INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    token                     TEXT NOT NULL UNIQUE,
    plateforme                VARCHAR(20) CHECK (plateforme IN ('IOS','ANDROID','WEB')),
    est_actif                 BOOLEAN DEFAULT TRUE,
    date_enregistrement       TIMESTAMP DEFAULT NOW(),
    date_derniere_utilisation TIMESTAMP
);

CREATE INDEX idx_tokens_push_compte ON TOKENS_PUSH(compte_id) WHERE est_actif = TRUE;

-- =============================================================================
-- SECTION 26 : GESTION DES DOCUMENTS
-- =============================================================================

CREATE TABLE DOCUMENTS (
    id                SERIAL PRIMARY KEY,
    uuid_document     UUID DEFAULT gen_random_uuid() UNIQUE,
    type_document     type_document NOT NULL,
    nom_fichier       VARCHAR(255) NOT NULL,
    chemin_fichier    VARCHAR(500) NOT NULL,
    mime_type         VARCHAR(100),
    taille_fichier    BIGINT CHECK (taille_fichier > 0),
    entite_type       entite_reference NOT NULL,  -- Changé pour utiliser le type unifié
    entite_id         INTEGER NOT NULL,
    numero_document   VARCHAR(100),
    date_emission     DATE,
    date_expiration   DATE,
    autorite_emettrice VARCHAR(150),
    statut            statut_document DEFAULT 'EN_ATTENTE_VALIDATION',
    valide_par        INTEGER REFERENCES COMPTES(id) ON DELETE SET NULL,
    date_validation   TIMESTAMP,
    motif_refus       TEXT,
    est_chiffre       BOOLEAN DEFAULT FALSE,
    hash_fichier      VARCHAR(64),
    date_upload       TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour  TIMESTAMP DEFAULT NOW(),

    CONSTRAINT check_expiration_coherente CHECK (
        date_expiration IS NULL OR date_emission IS NULL OR date_expiration > date_emission
    )
);

CREATE INDEX idx_documents_entite     ON DOCUMENTS(entite_type, entite_id);
CREATE INDEX idx_documents_type       ON DOCUMENTS(type_document);
CREATE INDEX idx_documents_statut     ON DOCUMENTS(statut);
CREATE INDEX idx_documents_expiration ON DOCUMENTS(date_expiration)
    WHERE date_expiration IS NOT NULL;

CREATE TRIGGER trg_documents_maj
    BEFORE UPDATE ON DOCUMENTS
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

CREATE TABLE HISTORIQUE_VALIDATIONS_DOCUMENTS (
    id             SERIAL PRIMARY KEY,
    document_id    INTEGER NOT NULL REFERENCES DOCUMENTS(id) ON DELETE CASCADE,
    ancien_statut  statut_document,
    nouveau_statut statut_document NOT NULL,
    validateur_id  INTEGER REFERENCES COMPTES(id) ON DELETE SET NULL,
    commentaire    TEXT,
    date_action    TIMESTAMP DEFAULT NOW()
);

-- =============================================================================
-- SECTION 27 : CONFIGURATIONS & CACHE
-- =============================================================================

CREATE TABLE CONFIGURATIONS (
    id               SERIAL PRIMARY KEY,
    entite_type      entite_reference NOT NULL DEFAULT 'PLATEFORME',  -- Changé pour utiliser le type unifié
    entite_id        INTEGER,
    cle              VARCHAR(100) NOT NULL,
    valeur           TEXT,
    valeur_json      JSONB,
    type_valeur      VARCHAR(20) DEFAULT 'TEXT'
                     CHECK (type_valeur IN ('TEXT','INTEGER','DECIMAL','BOOLEAN','JSON','DATE')),
    description      TEXT,
    est_public       BOOLEAN DEFAULT FALSE,
    date_creation    TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_config_unique_avec_entite
    ON CONFIGURATIONS(entite_type, entite_id, cle)
    WHERE entite_id IS NOT NULL;

CREATE UNIQUE INDEX idx_config_unique_sans_entite
    ON CONFIGURATIONS(entite_type, cle)
    WHERE entite_id IS NULL;

CREATE INDEX idx_configurations_lookup ON CONFIGURATIONS(entite_type, entite_id, cle);

CREATE TRIGGER trg_configurations_maj
    BEFORE UPDATE ON CONFIGURATIONS
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();

CREATE TABLE CACHE_STATISTIQUES (
    id           SERIAL PRIMARY KEY,
    entite_type  entite_reference NOT NULL,  -- Changé pour utiliser le type unifié
    entite_id    INTEGER NOT NULL,
    periode      VARCHAR(20) NOT NULL
                 CHECK (periode IN ('JOUR','SEMAINE','MOIS','ANNEE')),
    date_periode DATE NOT NULL,
    statistiques JSONB NOT NULL DEFAULT '{}',
    date_calcul  TIMESTAMP DEFAULT NOW(),
    est_valide   BOOLEAN DEFAULT TRUE,

    CONSTRAINT unique_cache_stats UNIQUE (entite_type, entite_id, periode, date_periode)
);

CREATE INDEX idx_cache_stats_lookup ON CACHE_STATISTIQUES(entite_type, entite_id, periode, date_periode DESC);

-- =============================================================================
-- SECTION 28 : SÉCURITÉ ET AUDIT
-- =============================================================================

CREATE TABLE JOURNAL_AUDIT (
    id              BIGSERIAL,
    session_id      UUID,
    compte_id       INTEGER,
    role_au_moment  compte_role,
    adresse_ip      INET NOT NULL DEFAULT '0.0.0.0'::INET,
    user_agent      TEXT,
    action          VARCHAR(80) NOT NULL,
    ressource_type  VARCHAR(60) NOT NULL,
    ressource_id    TEXT,
    donnees_avant   JSONB,
    donnees_apres   JSONB,
    champs_modifies TEXT[],
    raison          TEXT,
    metadata        JSONB DEFAULT '{}',
    succes          BOOLEAN NOT NULL DEFAULT TRUE,
    code_erreur     VARCHAR(50),
    message_erreur  TEXT,
    duree_ms        INTEGER,
    date_action     TIMESTAMP DEFAULT NOW() NOT NULL
) PARTITION BY RANGE (date_action);

CREATE TABLE JOURNAL_AUDIT_2025 PARTITION OF JOURNAL_AUDIT
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE JOURNAL_AUDIT_2026 PARTITION OF JOURNAL_AUDIT
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE JOURNAL_AUDIT_2027 PARTITION OF JOURNAL_AUDIT
    FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');
CREATE TABLE JOURNAL_AUDIT_DEFAULT PARTITION OF JOURNAL_AUDIT DEFAULT;

CREATE INDEX idx_audit_compte    ON JOURNAL_AUDIT(compte_id, date_action DESC);
CREATE INDEX idx_audit_ressource ON JOURNAL_AUDIT(ressource_type, ressource_id);
CREATE INDEX idx_audit_action    ON JOURNAL_AUDIT(action);
CREATE INDEX idx_audit_date      ON JOURNAL_AUDIT(date_action DESC);
CREATE INDEX idx_audit_ip        ON JOURNAL_AUDIT(adresse_ip);

CREATE OR REPLACE FUNCTION fn_audit_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Le journal d audit est immuable. Opération % interdite.', TG_OP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_update
    BEFORE UPDATE ON JOURNAL_AUDIT
    FOR EACH ROW EXECUTE FUNCTION fn_audit_immutable();

CREATE TRIGGER trg_audit_no_delete
    BEFORE DELETE ON JOURNAL_AUDIT
    FOR EACH ROW EXECUTE FUNCTION fn_audit_immutable();

CREATE TABLE SESSIONS (
    id                       SERIAL PRIMARY KEY,
    session_uuid             UUID DEFAULT gen_random_uuid() UNIQUE,
    compte_id                INTEGER NOT NULL REFERENCES COMPTES(id) ON DELETE CASCADE,
    token_hash               VARCHAR(64) NOT NULL UNIQUE,
    refresh_token_hash       VARCHAR(64),
    adresse_ip               INET NOT NULL,
    user_agent               TEXT,
    appareil                 VARCHAR(100),
    plateforme               VARCHAR(20) CHECK (plateforme IN ('WEB','IOS','ANDROID','API')),
    est_active               BOOLEAN DEFAULT TRUE,
    date_creation            TIMESTAMP DEFAULT NOW(),
    date_expiration          TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    date_refresh_expiration  TIMESTAMP DEFAULT (NOW() + INTERVAL '30 days'),
    date_derniere_activite   TIMESTAMP DEFAULT NOW(),
    date_revocation          TIMESTAMP,
    motif_revocation         VARCHAR(100),

    CONSTRAINT check_dates_session CHECK (date_expiration > date_creation)
);

CREATE INDEX idx_sessions_compte     ON SESSIONS(compte_id) WHERE est_active = TRUE;
CREATE INDEX idx_sessions_token      ON SESSIONS(token_hash);
CREATE INDEX idx_sessions_expiration ON SESSIONS(date_expiration) WHERE est_active = TRUE;

CREATE OR REPLACE FUNCTION fn_nettoyer_sessions()
RETURNS VOID AS $$
BEGIN
    UPDATE SESSIONS
    SET est_active       = FALSE,
        motif_revocation = 'EXPIRATION',
        date_revocation  = NOW()
    WHERE date_expiration < NOW()
      AND est_active = TRUE;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE TOKENS_REVOQUES (
    id              SERIAL PRIMARY KEY,
    token_hash      VARCHAR(64) NOT NULL UNIQUE,
    compte_id       INTEGER REFERENCES COMPTES(id) ON DELETE CASCADE,
    motif           VARCHAR(100),
    date_revocation TIMESTAMP DEFAULT NOW(),
    date_expiration TIMESTAMP NOT NULL
);

CREATE INDEX idx_tokens_revoques_hash       ON TOKENS_REVOQUES(token_hash);
CREATE INDEX idx_tokens_revoques_expiration ON TOKENS_REVOQUES(date_expiration);

CREATE TABLE ALERTES_SECURITE (
    id              SERIAL PRIMARY KEY,
    type_alerte     VARCHAR(80) NOT NULL,
    severite        VARCHAR(20) DEFAULT 'MOYEN'
                    CHECK (severite IN ('FAIBLE','MOYEN','ELEVE','CRITIQUE')),
    compte_id       INTEGER REFERENCES COMPTES(id) ON DELETE SET NULL,
    adresse_ip      INET,
    details         JSONB DEFAULT '{}',
    est_traitee     BOOLEAN DEFAULT FALSE,
    traite_par      INTEGER REFERENCES COMPTES(id) ON DELETE SET NULL,
    date_traitement TIMESTAMP,
    action_prise    TEXT,
    date_creation   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_alertes_non_traitees ON ALERTES_SECURITE(est_traitee, severite, date_creation)
    WHERE est_traitee = FALSE;

CREATE OR REPLACE FUNCTION fn_detecter_brute_force()
RETURNS TRIGGER AS $$
DECLARE
    v_tentatives INTEGER;
BEGIN
    IF NEW.statut_connexion = 'FAILED' THEN
        SELECT COUNT(*) INTO v_tentatives
        FROM HISTORIQUE_CONNEXIONS
        WHERE compte_id       = NEW.compte_id
          AND statut_connexion = 'FAILED'
          AND date_connexion   > NOW() - INTERVAL '15 minutes';

        IF v_tentatives >= 5 THEN
            INSERT INTO ALERTES_SECURITE (type_alerte, severite, compte_id, adresse_ip, details)
            VALUES (
                'BRUTE_FORCE',
                CASE WHEN v_tentatives >= 10 THEN 'CRITIQUE' ELSE 'ELEVE' END,
                NEW.compte_id,
                NEW.adresse_ip,
                jsonb_build_object('tentatives', v_tentatives, 'fenetre_minutes', 15)
            );

            IF v_tentatives >= 10 THEN
                UPDATE COMPTES
                SET statut            = 'SUSPENDU',
                    date_verouillage  = NOW()
                WHERE id = NEW.compte_id
                  AND statut NOT IN ('BANNI', 'SUSPENDU');
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_detecter_brute_force
    AFTER INSERT ON HISTORIQUE_CONNEXIONS
    FOR EACH ROW EXECUTE FUNCTION fn_detecter_brute_force();

CREATE OR REPLACE FUNCTION fn_audit_generique()
RETURNS TRIGGER AS $$
DECLARE
    v_ip INET;
BEGIN
    BEGIN
        v_ip := inet_client_addr();
    EXCEPTION WHEN OTHERS THEN
        v_ip := '0.0.0.0'::INET;
    END;

    INSERT INTO JOURNAL_AUDIT (
        action, ressource_type, ressource_id,
        donnees_avant, donnees_apres, champs_modifies,
        adresse_ip, date_action
    ) VALUES (
        TG_OP,
        TG_TABLE_NAME,
        CASE TG_OP WHEN 'DELETE' THEN OLD.id::TEXT ELSE NEW.id::TEXT END,
        CASE TG_OP WHEN 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
        CASE TG_OP WHEN 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
        CASE TG_OP WHEN 'UPDATE' THEN
            ARRAY(
                SELECT key FROM jsonb_each(to_jsonb(NEW))
                WHERE to_jsonb(NEW)->key IS DISTINCT FROM to_jsonb(OLD)->key
            )
        ELSE NULL END,
        v_ip,
        NOW()
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER audit_comptes
    AFTER INSERT OR UPDATE OR DELETE ON COMPTES
    FOR EACH ROW EXECUTE FUNCTION fn_audit_generique();

CREATE TRIGGER audit_avis
    AFTER INSERT OR UPDATE OR DELETE ON AVIS
    FOR EACH ROW EXECUTE FUNCTION fn_audit_generique();

CREATE TRIGGER audit_sessions
    AFTER INSERT OR UPDATE OR DELETE ON SESSIONS
    FOR EACH ROW EXECUTE FUNCTION fn_audit_generique();

CREATE TABLE POLITIQUES_RETENTION (
    id                    SERIAL PRIMARY KEY,
    table_cible           VARCHAR(80) NOT NULL UNIQUE,
    duree_retention_jours INTEGER NOT NULL CHECK (duree_retention_jours > 0),
    champ_date            VARCHAR(80) NOT NULL DEFAULT 'date_creation',
    action_expiration     VARCHAR(30) DEFAULT 'ANONYMISER'
                          CHECK (action_expiration IN ('SUPPRIMER','ANONYMISER','ARCHIVER')),
    derniere_execution    TIMESTAMP,
    est_active            BOOLEAN DEFAULT TRUE
);

INSERT INTO POLITIQUES_RETENTION (table_cible, duree_retention_jours, champ_date, action_expiration) VALUES
    ('HISTORIQUE_CONNEXIONS',       365,  'date_connexion', 'SUPPRIMER'),
    ('STATS_LECTURE_ARTICLES',      180,  'date_lecture',   'SUPPRIMER'),
    ('JOURNAL_AUDIT',               2555, 'date_action',    'ARCHIVER'),
    ('SESSIONS',                    90,   'date_creation',  'SUPPRIMER'),
    ('TOKENS_REVOQUES',             90,   'date_expiration','SUPPRIMER'),
    ('FILE_TACHES',                 30,   'date_creation',  'SUPPRIMER');

-- =============================================================================
-- SECTION 29 : VUES UTILES
-- =============================================================================

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
            SELECT m2.id, m2.contenu_message, m2.date_envoi,
                   exp.nom_utilisateur_compte AS expediteur_nom,
                   exp.photo_profil_compte    AS expediteur_photo
            FROM MESSAGES m2
            JOIN COMPTES exp ON exp.id = m2.expediteur_id
            WHERE m2.conversation_id = c.id
              AND m2.date_suppression IS NULL
            ORDER BY m2.date_envoi DESC
            LIMIT 1
        ) m
    ) AS dernier_message,
    (
        SELECT json_agg(p ORDER BY p.role_participant)
        FROM (
            SELECT pc.compte_id,
                   cmp.nom_utilisateur_compte,
                   cmp.photo_profil_compte,
                   pc.role_participant,
                   pc.messages_non_lus
            FROM PARTICIPANTS_CONVERSATION pc
            JOIN COMPTES cmp ON cmp.id = pc.compte_id
            WHERE pc.conversation_id = c.id AND pc.est_actif = TRUE
        ) p
    ) AS participants
FROM CONVERSATIONS c
WHERE c.est_archive = FALSE;

CREATE VIEW VUE_COMPAGNIES_STATS AS
SELECT
    ct.id,
    ct.nom_compagnie,
    COUNT(DISTINCT et.id)  AS nombre_emplacements,
    COUNT(DISTINCT tt.id)  AS nombre_tickets,
    COALESCE(SUM(tt.quantite_vendu), 0) AS total_tickets_vendus,
    ct.portefeuille_compagnie,
    ct.est_actif
FROM COMPAGNIESTRANSPORT ct
LEFT JOIN EMPLACEMENTSTRANSPORT et ON et.compagnie_id = ct.id
LEFT JOIN TICKETSTRANSPORT tt ON tt.compagnie_id = ct.id
WHERE ct.est_actif = TRUE
  AND ct.est_supprime = FALSE
GROUP BY ct.id, ct.nom_compagnie, ct.portefeuille_compagnie, ct.est_actif;

CREATE VIEW VUE_DOCUMENTS_A_VALIDER AS
SELECT
    d.id,
    d.uuid_document,
    d.type_document,
    d.entite_type,
    d.entite_id,
    d.date_upload,
    ROUND(EXTRACT(EPOCH FROM (NOW() - d.date_upload)) / 3600, 1) AS heures_attente,
    c.nom_utilisateur_compte AS uploade_par
FROM DOCUMENTS d
LEFT JOIN COMPTES c ON c.id = d.entite_id AND d.entite_type = 'COMPTE'::entite_reference
WHERE d.statut = 'EN_ATTENTE_VALIDATION'
ORDER BY d.date_upload ASC;

CREATE VIEW VUE_DOCUMENTS_EXPIRANT AS
SELECT
    d.*,
    (d.date_expiration - CURRENT_DATE) AS jours_restants
FROM DOCUMENTS d
WHERE d.statut = 'VALIDE'
  AND d.date_expiration IS NOT NULL
  AND d.date_expiration BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
ORDER BY d.date_expiration ASC;

CREATE VIEW VUE_COMMANDES_FASTFOOD_ACTIVES AS
SELECT
    cmd.id,
    cmd.reference_commande,
    erf.nom_emplacement AS emplacement,
    cmd.statut_commande,
    cmd.prix_total_commande,
    cmd.pour_livrer,
    cmd.passer_recuperer,
    cmd.date_commande,
    ROUND(EXTRACT(EPOCH FROM (NOW() - cmd.date_commande)) / 60, 0) AS minutes_ecoulees,
    c.nom_utilisateur_compte AS client
FROM COMMANDESEMPLACEMENTFASTFOOD cmd
LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = cmd.id_restaurant_fast_food_emplacement
LEFT JOIN COMPTES c ON c.id = cmd.compte_id
WHERE cmd.statut_commande NOT IN ('ANNULEE', 'REMBOURSEE', 'LIVREE', 'RECUPEREE')
ORDER BY cmd.date_commande ASC;

CREATE VIEW VUE_PORTEFEUILLES_CONSOLIDES AS
SELECT
    'PLATEFORME'::entite_reference AS entite_type,
    p.id AS entite_id,
    p.nom_plateforme AS nom,
    p.portefeuille_plateforme AS solde
FROM PLATEFORME p
UNION ALL
SELECT 'COMPAGNIE_TRANSPORT'::entite_reference, ct.id, ct.nom_compagnie, ct.portefeuille_compagnie
FROM COMPAGNIESTRANSPORT ct WHERE ct.est_actif = TRUE
UNION ALL
SELECT 'EMPLACEMENT_TRANSPORT'::entite_reference, et.id, et.nom_emplacement, et.portefeuille_emplacement
FROM EMPLACEMENTSTRANSPORT et WHERE et.est_actif = TRUE
UNION ALL
SELECT 'RESTAURANT_FAST_FOOD'::entite_reference, rf.id, rf.nom_restaurant_fast_food, rf.portefeuille_restaurant_fast_food
FROM RESTAURANTSFASTFOOD rf WHERE rf.est_actif = TRUE
UNION ALL
SELECT 'BOUTIQUE'::entite_reference, b.id, b.nom_boutique, b.portefeuille_boutique
FROM BOUTIQUES b WHERE b.est_actif = TRUE;

CREATE VIEW VUE_ALERTES_SECURITE_EN_COURS AS
SELECT
    a.id,
    a.type_alerte,
    a.severite,
    a.adresse_ip,
    a.details,
    a.date_creation,
    ROUND(EXTRACT(EPOCH FROM (NOW() - a.date_creation)) / 3600, 1) AS heures_attente,
    c.nom_utilisateur_compte AS compte_concerne
FROM ALERTES_SECURITE a
LEFT JOIN COMPTES c ON c.id = a.compte_id
WHERE a.est_traitee = FALSE
ORDER BY
    CASE a.severite
        WHEN 'CRITIQUE' THEN 1
        WHEN 'ELEVE'    THEN 2
        WHEN 'MOYEN'    THEN 3
        ELSE 4
    END,
    a.date_creation ASC;

-- =============================================================================
-- SECTION 30 : INDEX COMPOSITES SUPPLÉMENTAIRES (performances)
-- =============================================================================

CREATE INDEX idx_menus_disponibles
    ON MENURESTAURANTFASTFOOD(id_restaurant_fast_food_emplacement, categorie_menu, prix_menu)
    WHERE disponible = TRUE;

CREATE INDEX idx_tickets_actifs_compagnie
    ON TICKETSTRANSPORT(compagnie_id, actif, prix_vente_produit)
    WHERE actif = TRUE;

CREATE INDEX idx_notifications_non_lues_recentes
    ON NOTIFICATIONS(destinataire_id, date_creation DESC)
    WHERE est_lue = FALSE AND est_archivee = FALSE;

CREATE INDEX idx_articles_publies_recents
    ON ARTICLES_BLOG_PLATEFORME(categorie_principale, date_publication DESC)
    WHERE statut = 'PUBLIE' AND est_archive = FALSE;



-- Recréation de la table LIVREURS avec liaison à COMPTES
DROP TABLE IF EXISTS LIVREURS CASCADE;

CREATE TABLE LIVREURS (
    id                       SERIAL PRIMARY KEY,
    -- Liaison 1:1 avec COMPTES (obligatoire et unique)
    compte_id                INTEGER UNIQUE NOT NULL
                             REFERENCES COMPTES(id) ON DELETE CASCADE,
    
    -- Informations professionnelles uniquement
    id_entreprise_livraison  INTEGER REFERENCES ENTREPRISE_LIVRAISON(id) ON DELETE SET NULL,
    est_disponible           BOOLEAN DEFAULT TRUE,
    localisation_actuelle    geometry(Point, 4326),
    note_moyenne             DECIMAL(3,2) CHECK (note_moyenne BETWEEN 0 AND 5),
    nombre_livraisons        INTEGER DEFAULT 0,
    est_actif                BOOLEAN DEFAULT TRUE,
    
    -- Nouvelles colonnes utiles pour les livreurs
    type_vehicule            VARCHAR(30) CHECK (type_vehicule IN ('MOTO', 'VELO', 'VOITURE', 'SCOOTER', 'PIED')),
    plaque_immatriculation   VARCHAR(20),
    zone_travail_principale  geometry(Polygon, 4326),  -- Zone de prédilection (pour algo d'affectation)
    rayon_action_km          INTEGER DEFAULT 10 CHECK (rayon_action_km > 0),
    preference_horaire       JSONB DEFAULT '{"nuit": false, "weekend": true, "longue_distance": false}',
    
    -- Validation du statut
    date_creation            TIMESTAMP DEFAULT NOW(),
    date_mise_a_jour         TIMESTAMP DEFAULT NOW(),

    -- Contrainte : si actif, doit avoir une entreprise (sauf indépendants)
    CONSTRAINT check_livreur_coherent CHECK (
        (est_actif = FALSE) OR 
        (id_entreprise_livraison IS NOT NULL) OR 
        (type_vehicule = 'PIED')  -- Les livreurs à pied peuvent être indépendants
    )
);

-- Index optimisés
CREATE INDEX idx_livreurs_compte ON LIVREURS(compte_id);
CREATE INDEX idx_livreurs_entreprise ON LIVREURS(id_entreprise_livraison) WHERE est_actif = TRUE;
CREATE INDEX idx_livreurs_disponible ON LIVREURS(est_disponible) WHERE est_disponible = TRUE;
CREATE INDEX idx_livreurs_localisation ON LIVREURS USING GIST(localisation_actuelle) WHERE est_disponible = TRUE;
CREATE INDEX idx_livreurs_zone ON LIVREURS USING GIST(zone_travail_principale);

-- Trigger pour mise à jour automatique
CREATE TRIGGER trg_livreurs_maj
    BEFORE UPDATE ON LIVREURS
    FOR EACH ROW EXECUTE FUNCTION fn_update_date_mise_a_jour();


ALTER TABLE COMPTES 
ADD COLUMN IF NOT EXISTS two_factor_secret VARCHAR(255),
ADD COLUMN IF NOT EXISTS two_factor_temp_secret VARCHAR(255),
ADD COLUMN IF NOT EXISTS two_factor_actif BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS two_factor_backup_codes JSONB DEFAULT '[]'::jsonb;