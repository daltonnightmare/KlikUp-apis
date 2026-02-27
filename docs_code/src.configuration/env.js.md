La documentation complète au format Markdown pour le fichier `env.js` :

```markdown
# Module de Configuration d'Environnement - env.js

## 📋 Vue d'ensemble

Ce module gère la configuration de l'application basée sur les variables d'environnement. Il charge, valide et fournit un accès centralisé à toutes les configurations nécessaires au fonctionnement de l'application.

## 🏗️ Architecture

### Classe `Environment`

La classe principale qui encapsule toute la logique de gestion de l'environnement.

#### Constructeur
```javascript
constructor()
```
Initialise l'environnement en :
1. Chargeant le fichier `.env` approprié
2. Validant les variables d'environnement
3. Définissant les valeurs par défaut

## 🔧 Fonctionnalités principales

### 1. Chargement des fichiers d'environnement (`loadEnvFile()`)

Le système charge automatiquement le fichier `.env` correspondant à l'environnement actuel :

- **Développement** : `.env.development`
- **Production** : `.env.production`
- **Test** : `.env.test`

**Comportement :**
- Si le fichier spécifique n'existe pas, il tente de charger `.env` par défaut
- Si aucun fichier n'est trouvé, il utilise les variables système

### 2. Validation des variables (`validateEnv()`)

Utilise la bibliothèque **Joi** pour valider toutes les variables d'environnement.

#### Catégories de variables validées :

| Catégorie | Variables | Description |
|-----------|-----------|-------------|
| **Serveur** | `NODE_ENV`, `PORT`, `HOST`, `API_URL`, `FRONTEND_URL` | Configuration de base du serveur |
| **Base de données** | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Connexion PostgreSQL |
| **Redis** | `REDIS_URL`, `REDIS_PASSWORD` | Cache et sessions |
| **JWT** | `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN` | Authentification |
| **Services externes** | `SMTP_*`, `TWILIO_*` | Email et SMS |
| **Paiement** | `ORANGE_MONEY_*`, `MOOV_MONEY_*` | Services de paiement mobile |
| **Stockage** | `STORAGE_DRIVER`, `AWS_*` | Gestion des fichiers |
| **Sécurité** | `CORS_WHITELIST`, `RATE_LIMIT_*`, `BCRYPT_ROUNDS` | Paramètres de sécurité |
| **Logging** | `LOG_LEVEL`, `LOG_FILE` | Configuration des logs |
| **Cache** | `CACHE_TTL`, `CACHE_CHECK_PERIOD` | Paramètres de cache |
| **Features** | `ENABLE_2FA`, `ENABLE_SIGNUP`, `MAINTENANCE_MODE` | Fonctionnalités activées |

### 3. Valeurs par défaut (`setDefaults()`)

Définit des valeurs par défaut intelligentes :

- **URLs** : Construction automatique de l'URL API
- **Secrets** : Génération de secrets de développement si nécessaire
- **Timeouts** : `REQUEST_TIMEOUT` (30s), `UPLOAD_TIMEOUT` (60s)
- **Paths** : `UPLOAD_PATH`, `TEMP_PATH`

### 4. Méthodes utilitaires

| Méthode | Description |
|---------|-------------|
| `isProduction()` | Vérifie si l'environnement est la production |
| `isDevelopment()` | Vérifie si l'environnement est le développement |
| `isTest()` | Vérifie si l'environnement est le test |
| `isMaintenanceMode()` | Vérifie si le mode maintenance est activé |
| `getConfig()` | Retourne un objet de configuration simplifié |

## 📦 Installation et configuration

### Prérequis
```bash
npm install dotenv joi
```

### Structure des fichiers d'environnement

```
📁 projet/
├── 📁 src/
│   └── 📁 configuration/
│       └── env.js
├── .env.development
├── .env.production
├── .env.test
└── .env.example
```

### Exemple de fichier `.env.development`

```env
# Serveur
NODE_ENV=development
PORT=3000
HOST=localhost
API_URL=http://localhost:3000
FRONTEND_URL=http://localhost:4200

# Base de données
DB_NAME=klikup_dev
DB_USER=postgres
DB_PASSWORD=postgres
DB_HOST=localhost
DB_PORT=5432

# Redis
REDIS_URL=redis://localhost:6379

# JWT (pour développement seulement)
JWT_SECRET=dev-secret-key-32-chars-minimum-required
JWT_REFRESH_SECRET=dev-refresh-secret-32-chars-minimum

# Logging
LOG_LEVEL=debug
```

## 🚀 Utilisation

### Import du module

```javascript
// Dans n'importe quel fichier de l'application
const env = require('./configuration/env');

// Accès direct aux propriétés
console.log(env.PORT); // 3000
console.log(env.DB_NAME); // klikup_dev

// Utilisation des méthodes
if (env.isProduction()) {
    console.log('Mode production activé');
}

// Récupération de la configuration simplifiée
const config = env.getConfig();
```

### Exemples d'utilisation par module

#### Configuration de la base de données
```javascript
const knex = require('knex')({
    client: 'pg',
    connection: {
        host: env.DB_HOST,
        port: env.DB_PORT,
        database: env.DB_NAME,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        ssl: env.DB_SSL
    },
    pool: {
        min: env.DB_POOL_MIN,
        max: env.DB_POOL_MAX
    }
});
```

#### Configuration JWT
```javascript
const jwtConfig = {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
    refreshSecret: env.JWT_REFRESH_SECRET,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN
};
```

#### Configuration CORS
```javascript
const corsWhitelist = env.CORS_WHITELIST ? env.CORS_WHITELIST.split(',') : [];
```

## 🔒 Sécurité

### Bonnes pratiques

1. **Ne jamais committer les fichiers `.env`** contenant des secrets réels
2. **Toujours fournir un `.env.example`** avec des valeurs fictives
3. **En production**, utiliser des variables d'environnement système plutôt que des fichiers
4. **Changer les secrets par défaut** en production

### Validation stricte

- `JWT_SECRET` et `JWT_REFRESH_SECRET` doivent faire **minimum 32 caractères**
- En production, `SMTP_HOST` et `TWILIO_*` sont **requis**
- Les URLs doivent être **valides** (format URI)

## 📊 Gestion des erreurs

Le module utilise le logger pour tracer toutes les opérations :

```javascript
// Succès
logger.info('Environnement chargé: production');

// Avertissement
logger.warn('Aucun fichier .env trouvé, utilisation des variables système');

// Erreur
logger.error('Erreur de validation des variables d\'environnement:', error.message);
throw new Error(`Configuration invalide: ${error.message}`);
```

## 🧪 Tests

Pour les tests unitaires :

```javascript
// test/env.test.js
const env = require('../src/configuration/env');

describe('Environment Configuration', () => {
    it('should load development environment', () => {
        expect(env.isDevelopment()).toBe(true);
        expect(env.PORT).toBeDefined();
    });

    it('should have required database config', () => {
        expect(env.DB_NAME).toBeDefined();
        expect(env.DB_USER).toBeDefined();
    });
});
```

## 🔄 Migration et compatibilité

### Depuis une version antérieure
```javascript
// Ancienne façon (à éviter)
const dbHost = process.env.DB_HOST || 'localhost';

// Nouvelle façon (recommandée)
const dbHost = env.DB_HOST;
```

## 📝 Notes importantes

- Le module exporte une **instance unique** (singleton) de la classe `Environment`
- Toutes les variables sont **validées au démarrage** de l'application
- Les valeurs par défaut sont **intelligentes** et s'adaptent à l'environnement
- Le mode maintenance peut être activé via `MAINTENANCE_MODE=true`

## 🆘 Dépannage

### Problèmes courants

1. **"Configuration invalide"**
   - Vérifier que tous les champs requis sont présents
   - Vérifier le format des URLs et des emails

2. **Variables non chargées**
   - Vérifier le chemin du fichier `.env`
   - Vérifier que `NODE_ENV` est correctement défini

3. **Secrets par défaut en production**
   - S'assurer que `JWT_SECRET` est défini dans les variables système
   - Ne pas utiliser les secrets de développement en production

### Commandes utiles

```bash
# Démarrer en développement
NODE_ENV=development node app.js

# Démarrer en production
NODE_ENV=production node app.js

# Exécuter les tests
NODE_ENV=test npm test
```
```

Cette documentation complète couvre tous les aspects du module de configuration, de son architecture à son utilisation pratique, en passant par les bonnes pratiques de sécurité et le dépannage.