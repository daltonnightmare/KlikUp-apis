# 📚 Documentation API — mon-projet-api

API REST complète pour une plateforme multi-services (Transport, Restauration, Boutique, Blog, Messagerie) développée avec **Node.js**, **Express** et **PostgreSQL**.

---

## 🚀 Démarrage rapide

```bash
# 1. Installer les dépendances
npm install

# 2. Configurer l'environnement
cp .env.example .env
# Éditer .env avec vos paramètres

# 3. Initialiser la base de données PostgreSQL
psql -U postgres -f scripts/init-db.sh

# 4. Démarrer en développement
npm run dev

# 5. Démarrer en production
npm start
```

---

## 📁 Structure du projet

```
src/
├── app.js                    # Point d'entrée Express
├── configuration/            # Config DB, env, logger, constantes
├── controllers/              # Logique métier par domaine
├── routes/v1/                # Routes API versionnées
├── routes/middlewares/       # Auth, validation, upload, audit
├── services/                 # Services réutilisables (email, cache, notifications)
├── utils/                    # Helpers, constantes, classes d'erreurs
├── jobs/                     # Jobs CRON planifiés
└── docs/                     # Documentation OpenAPI
```

---

## 🔐 Authentification

Toutes les routes protégées nécessitent un JWT dans le header :
```
Authorization: Bearer <access_token>
```

### Endpoints Auth

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/v1/auth/register` | Inscription |
| POST | `/api/v1/auth/login` | Connexion → retourne access_token + refresh_token |
| POST | `/api/v1/auth/refresh` | Rafraîchir l'access token |
| POST | `/api/v1/auth/logout` | Déconnexion |
| POST | `/api/v1/auth/verify-email` | Vérifier l'email avec OTP |
| POST | `/api/v1/auth/forgot-password` | Demander une réinitialisation |
| POST | `/api/v1/auth/reset-password` | Réinitialiser le mot de passe |

**Exemple d'inscription :**
```json
POST /api/v1/auth/register
{
  "email": "user@example.com",
  "mot_de_passe_compte": "MotDePasse123!",
  "nom_utilisateur_compte": "john_doe",
  "numero_de_telephone": "+22670000000"
}
```

**Réponse :**
```json
{
  "success": true,
  "data": {
    "compte": { "id": 1, "email": "user@example.com", ... },
    "accessToken": "eyJhbGci...",
    "refreshToken": "eyJhbGci..."
  }
}
```

---

## 👤 Comptes

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/comptes/profil` | ✅ | Mon profil |
| PUT | `/comptes/profil` | ✅ | Modifier profil |
| PUT | `/comptes/changer-mot-de-passe` | ✅ | Changer mdp |
| GET | `/comptes` | Admin | Liste tous les comptes |
| GET | `/comptes/:id` | Admin | Détail d'un compte |
| GET | `/comptes/sessions` | ✅ | Mes sessions actives |
| DELETE | `/comptes/sessions/:id` | ✅ | Révoquer une session |

---

## 🚌 Transport

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/transport/compagnies` | - | Liste compagnies |
| POST | `/transport/compagnies` | Admin | Créer compagnie |
| GET | `/transport/compagnies/:id/emplacements` | - | Emplacements d'une compagnie |
| GET | `/transport/tickets` | - | Tickets disponibles |
| POST | `/transport/achats/prive` | ✅ | Acheter ticket (compte) |
| POST | `/transport/achats/public` | - | Acheter ticket (sans compte) |
| GET | `/transport/services` | - | Services (abonnements) |
| POST | `/transport/services/:id/demande` | ✅ | Demander un service |

---

## 🍔 Restauration

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/restauration/restaurants` | - | Liste restaurants |
| GET | `/restauration/restaurants/:id` | - | Détail restaurant |
| GET | `/restauration/emplacements/:id/menus` | - | Menus d'un emplacement |
| GET | `/restauration/emplacements/:id/produits` | - | Produits individuels |
| GET | `/restauration/emplacements/:id/promos` | - | Promos actives |
| POST | `/restauration/commandes` | - | Passer une commande |
| GET | `/restauration/commandes/:id` | ✅ | Suivi commande |
| PATCH | `/restauration/commandes/:id/statut` | Admin | Changer statut |

**Exemple de commande :**
```json
POST /api/v1/restauration/commandes
{
  "id_restaurant_fast_food_emplacement": 1,
  "donnees_commande": [
    { "type": "menu", "id": 5, "quantite": 2, "prix_unitaire": 3500 },
    { "type": "produit", "id": 12, "quantite": 1, "prix_unitaire": 500 }
  ],
  "prix_sous_total": 7500,
  "prix_total_commande": 7500,
  "pour_livrer": false,
  "passer_recuperer": true,
  "paiement_direct": false,
  "paiement_a_la_recuperation": true
}
```

---

## 🛍️ Boutiques

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/boutiques` | - | Liste boutiques |
| GET | `/boutiques/:id/produits` | - | Produits d'une boutique |
| GET | `/boutiques/:id/categories` | - | Catégories |
| POST | `/boutiques/commandes` | ✅ | Passer commande boutique |
| GET | `/boutiques/commandes/:id` | ✅ | Suivi commande boutique |

---

## 🚚 Livraison

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/livraison/entreprises` | - | Entreprises de livraison |
| GET | `/livraison/services` | - | Services disponibles |
| GET | `/livraison/services/calculer-prix` | - | Calculer prix livraison |
| GET | `/livraison/livreurs/proches` | - | Livreurs proches (GPS) |
| POST | `/livraison/demandes` | ✅ | Créer demande livraison |
| PATCH | `/livraison/demandes/:id/affecter` | Admin | Affecter un livreur |
| PATCH | `/livraison/livreurs/:id/localisation` | ✅ | MAJ position livreur |

---

## 📝 Blog

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/blog/articles` | - | Liste articles publiés |
| GET | `/blog/articles/:slug` | - | Lire un article |
| POST | `/blog/articles` | Blogueur | Créer article |
| PUT | `/blog/articles/:id` | Auteur | Modifier article |
| GET | `/blog/articles/:id/commentaires` | - | Commentaires |
| POST | `/blog/articles/:id/commentaires` | ✅ | Commenter |
| POST | `/blog/articles/:id/like` | ✅ | Liker |
| POST | `/blog/articles/:id/favoris` | ✅ | Ajouter aux favoris |
| POST | `/blog/articles/:id/vues` | - | Enregistrer lecture |
| POST | `/blog/articles/:id/partager` | - | Enregistrer partage |

---

## 💬 Messagerie

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/messagerie/conversations` | ✅ | Mes conversations |
| POST | `/messagerie/conversations` | ✅ | Créer conversation |
| GET | `/messagerie/conversations/:id/messages` | ✅ | Messages (paginés) |
| POST | `/messagerie/conversations/:id/messages` | ✅ | Envoyer message |
| PUT | `/messagerie/messages/:id` | ✅ | Modifier message |
| DELETE | `/messagerie/messages/:id` | ✅ | Supprimer message |
| POST | `/messagerie/messages/:id/reactions` | ✅ | Réagir (emoji) |
| POST | `/messagerie/conversations/:id/invitations` | ✅ | Inviter |
| POST | `/messagerie/blocages` | ✅ | Bloquer utilisateur |

---

## ⭐ Avis

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/avis?entite_type=RESTAURANT_FAST_FOOD&entite_id=1` | - | Avis d'une entité |
| POST | `/avis` | ✅ | Laisser un avis |
| POST | `/avis/:id/voter` | ✅ | Voter (utile/pas utile) |

---

## 🕐 Horaires

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/horaires/:entite_type/:entite_id` | - | Horaires de la semaine |
| GET | `/horaires/:entite_type/:entite_id/est-ouvert` | - | Ouvert maintenant ? |
| PUT | `/horaires/:entite_type/:entite_id` | ✅ | Définir horaires |
| POST | `/horaires/:entite_type/:entite_id/exceptions` | ✅ | Fermeture exceptionnelle |

---

## 🎁 Fidélité & Parrainage

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/fidelite/programmes` | - | Programmes disponibles |
| GET | `/fidelite/solde/:compte_id` | ✅ | Mes points |
| POST | `/fidelite/points/crediter` | Admin | Créditer points |
| GET | `/fidelite/parrainage/mon-code` | ✅ | Mon code parrainage |
| POST | `/fidelite/parrainage/utiliser` | ✅ | Utiliser un code |

---

## 🔔 Notifications

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/notifications` | ✅ | Mes notifications |
| PATCH | `/notifications/:id/lire` | ✅ | Marquer lue |
| PATCH | `/notifications/tout-lire` | ✅ | Tout marquer lu |
| GET | `/notifications/preferences` | ✅ | Préférences canal |
| PUT | `/notifications/preferences` | ✅ | Modifier préférences |
| POST | `/notifications/push-tokens` | ✅ | Enregistrer token push |

---

## 📄 Documents (KYC)

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | `/documents` | ✅ | Uploader document |
| GET | `/documents/a-valider` | Admin | Queue validation |
| PATCH | `/documents/:id/valider` | Admin | Valider/Refuser |

---

## 🛡️ Administration

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/admin/dashboard` | Admin | Stats globales |
| GET | `/admin/moderation/signalements/articles` | Admin | Signalements articles |
| PATCH | `/admin/moderation/alertes/:id/traiter` | Admin | Traiter alerte sécu |
| PATCH | `/admin/moderation/comptes/:id/suspendre` | Admin | Suspendre compte |
| PUT | `/admin/configurations` | Admin | Modifier config |
| GET | `/historique/audit` | Admin | Journal d'audit |

---

## 🌍 API Publique (sans auth)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/public/recherche?q=burger` | Recherche globale |
| GET | `/public/restaurants` | Restaurants |
| GET | `/public/boutiques` | Boutiques |
| GET | `/public/articles` | Articles de blog |
| GET | `/public/geo/restaurants-proches?longitude=&latitude=` | GPS |
| GET | `/public/stats` | Statistiques plateforme |

---

## 📊 Format des réponses

**Succès :**
```json
{
  "success": true,
  "data": { ... },
  "total": 100,
  "page": 1,
  "pages": 5
}
```

**Erreur :**
```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Description de l'erreur",
  "details": { ... }
}
```

---

## 🔒 Rôles disponibles

| Rôle | Accès |
|------|-------|
| `ADMINISTRATEUR_PLATEFORME` | Tout |
| `STAFF_PLATEFORME` | Modération, config |
| `ADMINISTRATEUR_COMPAGNIE` | Gestion compagnie transport |
| `ADMINISTRATEUR_RESTAURANT_FAST_FOOD` | Gestion restaurant |
| `UTILISATEUR_PRIVE_SIMPLE` | Commandes, blog, messagerie |
| `UTILISATEUR_VENDEUR` | Boutique vendeur |

---

## ⚙️ Variables d'environnement importantes

```env
NODE_ENV=production
PORT=3000
DB_HOST=localhost
DB_NAME=mon_projet_db
DB_USER=postgres
DB_PASSWORD=***
JWT_SECRET=*** (min. 64 caractères)
REDIS_HOST=localhost
SMTP_HOST=smtp.