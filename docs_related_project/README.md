# Documentation de la Base de Données - Plateforme Multiservices

## Vue d'ensemble

Cette base de données PostgreSQL est conçue pour une plateforme multiservices intégrant :
- La gestion de compagnies de transport (tickets, abonnements)
- La restauration rapide (menus, commandes)
- Le e-commerce (boutiques, produits)
- Un système de blog et de messagerie
- La fidélisation et le parrainage
- La livraison
- Un système complet de comptes et de rôles

## Extensions PostgreSQL utilisées

- **uuid-ossp** : Génération d'UUID
- **postgis** : Support des données géospatiales (points, localisations)
- **pgcrypto** : Fonctions de chiffrement et génération d'UUID

---

## SECTION 0 : Fonctions utilitaires

### `fn_update_date_mise_a_jour()`
**Objectif** : Met à jour automatiquement le champ `date_mise_a_jour` lors de toute modification d'un enregistrement.

**Fonctionnement** : Trigger exécuté avant chaque UPDATE sur les tables principales.

---

## SECTION 1 : Types énumérés (ENUM)

Les types énumérés assurent l'intégrité des données en limitant les valeurs possibles.

### `compte_role` - Rôles des utilisateurs
Hiérarchie complète des permissions :
- **Administrateurs** : Accès total à leur niveau
- **Staff** : Gestion opérationnelle
- **Blogueurs** : Création de contenu
- **Utilisateurs** : Clients simples ou vendeurs

**Organisation** : Plateforme > Compagnie > Emplacement > Restaurant > Boutique

### `statut_compte` - Statuts de compte
- `EST_AUTHENTIFIE` / `NON_AUTHENTIFIE` : Statut de connexion
- `SUSPENDU` / `BANNI` : Sanctions

### `jours_ouverture` - Jours d'ouverture
Gère les plages horaires des établissements (emplacements, restaurants).

### `categories_menu` - Catégories de menus
Catégorisation complète des plats (petit-déjeuner, entrées, plats, desserts, types de cuisine).

### `categories_produits` - Catégories de produits
Pour les boutiques et produits individuels.

### `types_promo` - Types de promotions
- Pourcentage, montant fixe, 2 pour 1, livraison gratuite, etc.

### `types_service_livraison` - Types de livraison
Standard, express, programmée, nuit, weekend, international.

### `types_connexions` & `statuts_connexion`
Traçage des tentatives de connexion.

### `statut_article` - Cycle de vie des articles
Brouillon → En attente → Publié → Archivé

### `type_conversation` - Types de conversations
Messagerie directe, groupes, support, commandes, etc.

### `entite_reference` - **Type unifié essentiel**
Identifie tous les types d'entités de la plateforme :
`PLATEFORME`, `COMPAGNIE_TRANSPORT`, `RESTAURANT_FAST_FOOD`, `BOUTIQUE`, `COMPTE`, etc.

**Implication** : Permet de créer des tables génériques (ADRESSES, AVIS, NOTIFICATIONS) qui peuvent référencer n'importe quelle entité.

---

## SECTION 2 : PLATEFORME

### Table `PLATEFORME`
**Objectif** : Configuration centrale de la plateforme.

| Champ | Description |
|-------|-------------|
| `nom_plateforme` | Nom officiel |
| `localisation_siege` | Point géographique (PostGIS) |
| `portefeuille_plateforme` | Solde financier global |
| `depenses_plateforme` | JSONB flexible des dépenses |

**Implication** : Une seule ligne (ou très peu) contenant les paramètres globaux.

---

## SECTION 3-4 : Transport

### `COMPAGNIESTRANSPORT`
**Objectif** : Sociétés de transport partenaires.

- `pourcentage_commission_plateforme` : Commission prélevée
- `portefeuille_compagnie` : Solde de la compagnie
- Soft delete avec `est_supprime` et `date_suppression`

### `EMPLACEMENTSTRANSPORT`
**Objectif** : Points de vente/arrêts physiques.

- `localisation_emplacement` : Position GPS
- `localisation_arret_bus` : Point d'arrêt spécifique
- Lié à une compagnie via `compagnie_id`

---

## SECTION 5 : COMPTES

### Table `COMPTES` (Centrale)
**Objectif** : Tous les utilisateurs de la plateforme.

**Champs critiques** :
- `email`, `numero_de_telephone` : Identifiants uniques
- `mot_de_passe_compte` : Hash du mot de passe
- `code_authentification` : Pour 2FA
- `tentatives_echec_connexion` : Sécurité

**Relations** :
- `compagnie_id` : Si l'utilisateur gère une compagnie
- `restaurant_id` : Si l'utilisateur gère un restaurant
- `boutique_id` : Si l'utilisateur est vendeur

**Implication** : Un utilisateur peut être rattaché à plusieurs entités (compagnie, restaurant, boutique) selon son rôle.

---

## SECTION 6-7 : Tickets et Services Transport

### `TICKETSTRANSPORT`
**Objectif** : Billets de transport vendus.

- `journalier`/`hebdomadaire`/`mensuel` : Type de ticket (un seul possible)
- `quantite_stock` / `quantite_vendu` : Gestion de stock
- `donnees_secondaires_produit` : JSONB pour flexibilité

### `SERVICES`
**Objectif** : Abonnements (mensuel, trimestriel, etc.).

- `duree_validite_jours` : Durée de validité
- `donnees_json_service` : Configuration flexible

---

## SECTION 8-12 : Restauration Fast-Food

### `RESTAURANTSFASTFOOD`
**Objectif** : Chaînes de restaurants.

### `EMPLACEMENTSRESTAURANTFASTFOOD`
**Objectif** : Points de vente individuels.

- `localisation_restaurant` : Position GPS
- `frais_livraison` : Par emplacement
- `heure_ouverture`/`fermeture` : Horaires

### `MENURESTAURANTFASTFOOD` & `PRODUITSINDIVIDUELRESTAURANT`
**Objectif** : Offre du restaurant.

- `stock_disponible = -1` : Illimité
- `composition_menu` : JSONB listant les composants
- `photos_menu` : Galerie d'images

### `PROMOSRESTAURANTFASTFOOD`
**Objectif** : Promotions et codes promo.

- `utilisation_max`/`utilisation_count` : Limites d'utilisation
- `produits_affectes` : JSONB des produits concernés
- Tables de liaison `PROMOSMENUS` et `PROMOSPRODUITS`

---

## SECTION 13 : Commandes Restaurant

### `COMMANDESEMPLACEMENTFASTFOOD`
**Objectif** : Commandes passées dans les restaurants.

**Caractéristiques** :
- `reference_commande` : Génération automatique formatée
- `donnees_commande` : JSONB détaillant la commande
- Contraintes sur les modes de livraison et paiement
- Calcul automatique du total

**Implication** : Traçabilité complète avec statuts unifiés.

---

## SECTION 14 : Boutiques

### `BOUTIQUES`
**Objectif** : Vendeurs sur la plateforme.

### `CATEGORIES_BOUTIQUE`
**Objectif** : Arborescence des catégories (auto-référencement).

### `PRODUITSBOUTIQUE`
**Objectif** : Produits en vente.

- `slug_produit` : URL-friendly
- `prix_promo` : Prix promotionnel optionnel
- `images_produit` : Galerie JSONB

### `COMMANDESBOUTIQUES`
Même structure que les commandes restaurant pour uniformité.

---

## SECTION 15 : Livraison

### `ENTREPRISE_LIVRAISON`
**Objectif** : Prestataires de livraison.

### `LIVREURS`
**Objectif** : Livreurs individuels.

- `localisation_actuelle` : Position en temps réel (PostGIS)
- `est_disponible` : Disponibilité
- `note_moyenne` : Évaluation

### `DEMANDES_LIVRAISON`
**Objectif** : Demandes de livraison.

- Polymorphisme via `commande_type` et `commande_id`
- Peut référencer une commande restaurant OU boutique

---

## SECTION 16 : Achats

### `ACHATSTICKETSPRIVE` / `ACHATSTICKETSPUBLIQUES`
**Objectif** : Achats de tickets (comptes enregistrés vs public).

- `transaction_uuid` : Identifiant unique de transaction
- `info_acheteur` : JSONB (nom, email pour le public)

### `ACHATSSERVICESPRIVE`
**Objectif** : Achats d'abonnements.

---

## SECTION 18 : Blog

### `ARTICLES_BLOG_PLATEFORME`
**Objectif** : Articles de contenu.

**Champs riches** :
- `contenu_article` : Texte principal
- `mots_cles` : Tags (tableau PostgreSQL)
- `gallery_images`, `documents_joints` : JSONB
- `statut` : Cycle de vie complet
- `visibilite` : Public/Abonnés/Privé

**Relations polymorphes** :
- Peut être lié à : compagnie, emplacement, restaurant, boutique, produit, menu, promo

**Implication** : Système de contenu ultra-flexible pouvant référencer n'importe quelle entité.

### `COMMENTAIRES`
**Objectif** : Commentaires sur les articles.

- Auto-référencement (`commentaire_parent_id`) pour les réponses
- `est_anonyme` / `pseudo_anonyme` : Option d'anonymat
- Modération complète

### Tables de social : `LIKES_ARTICLES`, `PARTAGES_ARTICLES`, `FAVORIS_ARTICLES`, etc.
**Objectif** : Engagement des utilisateurs.

### `STATS_LECTURE_ARTICLES`
**Objectif** : Analytics détaillée.

- `temps_lecture_secondes`
- `pourcentage_lu`
- IP, user-agent pour traçage

---

## SECTION 19 : Messagerie

### `CONVERSATIONS`
**Objectif** : Conversations entre utilisateurs.

- `type_conversation` : Direct, groupe, support, etc.
- `entite_type`/`entite_id` : Polymorphisme (conversation liée à une commande, un service...)
- `metadata` : JSONB flexible

### `PARTICIPANTS_CONVERSATION`
**Objectif** : Participants et leurs permissions.

- `role_participant` : Admin, modérateur, etc.
- `permissions` : JSONB (peut_ecrire, peut_inviter...)
- `messages_non_lus` : Compteur
- `mode_notification` : TOUS, MENTIONS, AUCUN

### `MESSAGES`
**Objectif** : Messages individuels.

- `type_message` : Texte, image, vidéo, système...
- `mentions_comptes` : Tableau d'IDs
- `historique_modifications` : JSONB traçant les éditions
- Soft delete (`date_suppression`, `supprime_par`)

### `PIECES_JOINTES`
**Objectif** : Fichiers attachés.

- Métadonnées riches (dimensions images, durée vidéo)
- Sécurité (`mot_de_passe_protege`, `date_expiration`)

### Fonction `update_conversation_stats()`
**Objectif** : Met à jour automatiquement les compteurs de conversation (messages, dernier message, non lus).

---

## SECTION 21 : Adresses centralisées

### `ADRESSES`
**Objectif** : Stockage unique des adresses.

- `coordonnees` : Point PostGIS
- Indexation spatiale pour recherches géographiques

### `ADRESSES_ENTITES`
**Objectif** : Liaison polymorphique entre adresses et entités.

- `entite_type`/`entite_id` : Référence à n'importe quelle entité
- `type_adresse` : Principale, livraison, facturation

**Implication** : Une adresse peut servir pour plusieurs entités.

---

## SECTION 22 : Avis et notations

### `AVIS`
**Objectif** : Évaluations des entités.

- Polymorphisme complet (`entite_type`/`entite_id`)
- Notation multidimensionnelle : globale, qualité, service, rapport qualité/prix, ponctualité
- `est_achat_verifie` : Avis vérifié
- `reponse_pro` : Réponse du professionnel

### `VUE_NOTES_MOYENNES` (Materialized View)
**Objectif** : Agrégation des notes par entité.

- Rafraîchie automatiquement via `FILE_TACHES` après modification
- Dashboard et affichage public

---

## SECTION 23 : Horaires flexibles

### `HORAIRES`
**Objectif** : Horaires d'ouverture par jour.

- Gestion des coupures (`heure_coupure_debut`/`fin`)
- Contrainte de cohérence

### `HORAIRES_EXCEPTIONS`
**Objectif** : Jours exceptionnels (fermeture, ouverture spéciale).

### `JOURS_FERIES`
**Objectif** : Jours fériés (récurrents ou non).

### Fonction `fn_est_ouvert()`
**Objectif** : Détermine si une entité est ouverte à un instant T.

- Vérifie d'abord les exceptions
- Puis les horaires standards
- Prend en compte les coupures

---

## SECTION 24 : Fidélité et parrainage

### `PROGRAMMES_FIDELITE`
**Objectif** : Programmes par entité.

- `points_par_tranche` / `montant_tranche` : Taux de conversion
- `valeur_point_fcfa` : Valeur monétaire
- `paliers` : JSONB des niveaux

### `SOLDES_FIDELITE`
**Objectif** : Solde de points par compte/programme.

### `MOUVEMENTS_POINTS`
**Objectif** : Historique des mouvements.

- Traçage complet avec soldes avant/après
- `reference_type`/`reference_id` : Lien vers la source

### `PARRAINAGES`
**Objectif** : Programme de parrainage.

- `code_parrainage` : Génération automatique
- Points et bonus monétaires
- Statuts et expiration

---

## SECTION 25 : Notifications unifiées

### `MODELES_NOTIFICATIONS`
**Objectif** : Templates de notifications.

- `titre_template` / `corps_template` : Avec variables
- Canal et priorité par défaut

### `NOTIFICATIONS`
**Objectif** : Notifications envoyées.

- Polymorphisme source (`entite_source_type`/`id`)
- Action associée (type, ID, URL)
- Canaux multiples (in-app, push, email, SMS)
- Expiration automatique

### `PREFERENCES_NOTIFICATIONS`
**Objectif** : Préférences utilisateur par canal et type d'événement.

- Plages silencieuses configurables

---

## SECTION 26 : Documents

### `DOCUMENTS`
**Objectif** : Gestion des documents (CNI, justificatifs, contrats).

- Polymorphisme complet
- `statut` : Cycle de validation
- `est_chiffre` : Indique si le fichier est chiffré
- `hash_fichier` : Intégrité

### `HISTORIQUE_VALIDATIONS_DOCUMENTS`
**Objectif** : Traçage des validations/refus.

---

## SECTION 27 : Configurations et cache

### `CONFIGURATIONS`
**Objectif** : Paramètres configurables par entité.

- Double indexation : avec ou sans entité_id (paramètres globaux vs spécifiques)
- `type_valeur` : Validation du type

### `CACHE_STATISTIQUES`
**Objectif** : Cache pour les statistiques pré-calculées.

- Par période (jour, semaine, mois, année)
- Flag `est_valide` pour invalidation

---

## SECTION 28 : Sécurité et audit

### `JOURNAL_AUDIT` (partitionné)
**Objectif** : Journal immuable de toutes les actions importantes.

- Partitionnement par date pour performance
- Triggers interdisant UPDATE/DELETE
- Traçage des avant/après

### `SESSIONS`
**Objectif** : Gestion des sessions utilisateur.

- Double token (accès + refresh)
- Expiration automatique
- Traçage appareil

### `ALERTES_SECURITE`
**Objectif** : Alertes automatiques.

- Détection brute force (trigger)
- Niveaux de sévérité
- Traitement manuel

### `POLITIQUES_RETENTION`
**Objectif** : RGPD et nettoyage automatique.

- Durée de rétention par table
- Action : SUPPRIMER, ANONYMISER, ARCHIVER

---

## SECTION 29 : Vues utiles

### `VUE_CONVERSATIONS_RECENTES`
Affiche les conversations avec dernier message et participants.

### `VUE_COMPAGNIES_STATS`
Statistiques agrégées des compagnies de transport.

### `VUE_DOCUMENTS_A_VALIDER` / `VUE_DOCUMENTS_EXPIRANT`
Workflow documentaire.

### `VUE_COMMANDES_FASTFOOD_ACTIVES`
Suivi en temps réel des commandes en cours.

### `VUE_PORTEFEUILLES_CONSOLIDES`
Solde de toutes les entités financières.

### `VUE_ALERTES_SECURITE_EN_COURS`
Dashboard sécurité.

---

## SECTION 30 : Index composites

Optimisations pour les requêtes fréquentes :
- Menus disponibles par emplacement
- Tickets actifs par compagnie
- Notifications non lues récentes
- Articles publiés par catégorie

---

## Architecture générale

### Points forts
1. **Polymorphisme généralisé** via `entite_reference` : Une seule table pour gérer les relations avec n'importe quelle entité
2. **Utilisation intensive de JSONB** : Flexibilité sans multiplier les tables
3. **PostGIS** : Géolocalisation de toutes les entités
4. **Sécurité multicouche** : Audit, sessions, alertes, chiffrement
5. **Performance** : Partitionnement, vues matérialisées, index composites
6. **Traçabilité complète** : Historique de toutes les actions

### Flux principaux
- **E-commerce** : Compte → Commande → Paiement → Livraison → Avis
- **Transport** : Achat ticket → Utilisation service → Points fidélité
- **Contenu** : Article → Commentaire → Engagement → Notifications
- **Communication** : Conversation → Messages → Notifications

Cette base de données est conçue pour être robuste, évolutive et capable de gérer un écosystème complexe tout en maintenant l'intégrité et la traçabilité des données.




