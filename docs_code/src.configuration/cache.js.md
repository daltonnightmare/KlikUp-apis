```markdown
# Module de Gestion de Cache - cache.js

## 📋 Vue d'ensemble

Ce module fournit un système de cache complet pour l'application utilisant `node-cache`. Il offre une interface unifiée pour le caching en mémoire avec des fonctionnalités avancées comme les namespaces, les statistiques, et un décorateur pour la mise en cache automatique des méthodes.

## 🏗️ Architecture

### Classe `CacheManager`

La classe principale qui encapsule toute la logique de gestion du cache.

#### Constructeur
```javascript
constructor()
```
Initialise le gestionnaire de cache avec :
- Une instance `localCache` (initialisée à `null`)
- Un objet `stats` pour suivre les performances :
  - `hits` : nombre d'accès réussis
  - `misses` : nombre d'échecs d'accès
  - `sets` : nombre d'écritures
  - `deletes` : nombre de suppressions

## 🔧 Fonctionnalités principales

### 1. Initialisation (`initialize()`)

Configure l'instance NodeCache avec les paramètres de l'environnement :

```javascript
this.localCache = new NodeCache({
    stdTTL: env.CACHE_TTL || 3600,        // Durée de vie par défaut (1 heure)
    checkperiod: env.CACHE_CHECK_PERIOD || 600, // Vérification des expirations (10 min)
    useClones: false,                      // Optimisation performance
    deleteOnExpire: true                    // Suppression automatique
});
```

### 2. Opérations de base

| Méthode | Description | Paramètres |
|---------|-------------|------------|
| `get(key)` | Récupère une valeur | `key`: string |
| `getMany(keys)` | Récupère plusieurs valeurs | `keys`: string[] |
| `set(key, value, ttl)` | Stocke une valeur | `key`, `value`, `ttl?`: number |
| `setMany(keyValuePairs, ttl)` | Stocke plusieurs valeurs | `{key, val}[]`, `ttl?` |
| `del(key)` | Supprime une clé | `key`: string |
| `delMany(keys)` | Supprime plusieurs clés | `keys`: string[] |
| `has(key)` | Vérifie l'existence | `key`: string |
| `keys()` | Liste toutes les clés | - |

### 3. Opérations avancées

#### Suppression par pattern (`delPattern(pattern)`)
```javascript
// Supprime toutes les sessions d'un utilisateur
cache.delPattern('user:123:*');
```

#### Compteurs atomiques
```javascript
// Incrémentation/Décrémentation sécurisée
cache.increment('visitor:count');  // +1
cache.increment('api:calls', 5);   // +5
cache.decrement('stock:item123');  // -1
```

#### Cache remember pattern (`remember(key, ttl, callback)`)
```javascript
// Évite la duplication de code pour le pattern get/set
const data = await cache.remember('users:list', 3600, async () => {
    return await User.findAll(); // Coûteux, mis en cache
});
```

### 4. Namespaces

Crée des sous-caches isolés avec préfixe automatique :

```javascript
// Cache pour les utilisateurs
const userCache = cache.namespace('users');

await userCache.set('123', { name: 'John' });
// Équivalent à: cache.set('users:123', { name: 'John' })

await userCache.get('123');
await userCache.del('123');
```

### 5. Décorateur de méthode (`wrap(ttl)`)

Cache automatiquement les résultats des méthodes :

```javascript
class UserService {
    @cache.wrap(3600)
    async getUserById(id) {
        // Cette méthode sera mise en cache automatiquement
        // La clé sera: UserService:getUserById:[id]
        return db.findUser(id);
    }
}
```

### 6. Statistiques et monitoring

```javascript
// Obtenir les statistiques détaillées
const stats = cache.getStats();
// {
//     hits: 150,
//     misses: 30,
//     sets: 45,
//     deletes: 12,
//     hitRate: '83.33%',
//     keys: 25,
//     memoryUsage: 1523872
// }
```

### 7. Health check

```javascript
// Vérifier l'état du cache
const health = cache.healthCheck();
// {
//     status: 'healthy',
//     stats: {...},
//     timestamp: '2024-01-01T00:00:00.000Z'
// }
```

## 📦 Installation et configuration

### Prérequis
```bash
npm install node-cache
```

### Structure des fichiers

```
📁 projet/
├── 📁 src/
│   └── 📁 configuration/
│       ├── cache.js
│       ├── env.js
│       └── logger.js
└── 📁 tests/
    └── cache.test.js
```

### Configuration dans `.env`

```env
# Cache
CACHE_TTL=3600        # Durée de vie par défaut en secondes
CACHE_CHECK_PERIOD=600 # Période de vérification des expirations
```

## 🚀 Utilisation

### Initialisation

```javascript
// Dans app.js ou server.js
const cache = require('./configuration/cache');

// Initialiser le cache au démarrage
cache.initialize();

// Vérifier la santé
const health = cache.healthCheck();
if (health.status !== 'healthy') {
    console.warn('Cache non disponible');
}
```

### Exemples d'utilisation

#### Cache de sessions utilisateur
```javascript
// middleware/session.js
const cache = require('../configuration/cache');
const sessionCache = cache.namespace('session');

async function getSession(sessionId) {
    return await sessionCache.remember(sessionId, 1800, async () => {
        // Simule la récupération depuis la DB
        return await Session.findByPk(sessionId);
    });
}

async function invalidateUserSessions(userId) {
    await cache.delPattern(`session:*:user:${userId}`);
}
```

#### Cache de requêtes API
```javascript
// services/apiCache.js
const cache = require('../configuration/cache');
const apiCache = cache.namespace('api');

async function getCachedResponse(endpoint, params) {
    const key = `${endpoint}:${JSON.stringify(params)}`;
    
    return await apiCache.remember(key, 300, async () => {
        const response = await axios.get(endpoint, { params });
        return response.data;
    });
}
```

#### Rate limiting avec compteurs
```javascript
// middleware/rateLimit.js
const cache = require('../configuration/cache');
const rateLimitCache = cache.namespace('rate-limit');

async function checkRateLimit(ip, limit = 100, window = 900) {
    const key = `ip:${ip}`;
    const current = await rateLimitCache.increment(key);
    
    if (current === 1) {
        // Première requête, définir l'expiration
        await cache.set(key, current, window);
    }
    
    return current <= limit;
}
```

#### Cache de configuration
```javascript
// services/configService.js
const cache = require('../configuration/cache');
const configCache = cache.namespace('config');

class ConfigService {
    async getConfig(key) {
        return await configCache.remember(key, 3600, async () => {
            return await Config.findByPk(key);
        });
    }
    
    async updateConfig(key, value) {
        await Config.update({ value }, { where: { key } });
        await configCache.del(key); // Invalider le cache
    }
}
```

#### File d'attente de tâches
```javascript
// services/queue.js
const cache = require('../configuration/cache');
const queueCache = cache.namespace('queue');

class TaskQueue {
    async push(task) {
        const queue = await this.getQueue();
        queue.push(task);
        await queueCache.set('tasks', queue);
    }
    
    async pop() {
        const queue = await this.getQueue();
        const task = queue.shift();
        await queueCache.set('tasks', queue);
        return task;
    }
    
    async getQueue() {
        return await queueCache.remember('tasks', 0, () => []);
        // TTL = 0 signifie pas d'expiration
    }
}
```

#### Cache avec invalidation par tags
```javascript
// implémentation de tags simple
class TaggedCache {
    constructor(cache) {
        this.cache = cache;
    }
    
    async set(key, value, tags, ttl) {
        await this.cache.set(key, value, ttl);
        
        for (const tag of tags) {
            const tagKeys = await this.cache.get(`tag:${tag}`) || [];
            tagKeys.push(key);
            await this.cache.set(`tag:${tag}`, [...new Set(tagKeys)], 0);
        }
    }
    
    async invalidateTag(tag) {
        const keys = await this.cache.get(`tag:${tag}`) || [];
        await this.cache.delMany(keys);
        await this.cache.del(`tag:${tag}`);
    }
}

// Utilisation
const taggedCache = new TaggedCache(cache);
await taggedCache.set('user:123', userData, ['users', 'admins']);
await taggedCache.invalidateTag('users'); // Invalide tous les caches users
```

## 📊 Gestion des événements

Le cache écoute et logue les événements :

```javascript
// Événements disponibles
this.localCache.on('expired', (key, value) => {
    logger.debug(`Cache expiré: ${key}`);
});

this.localCache.on('del', (key, value) => {
    logger.debug(`Cache supprimé: ${key}`);
});

this.localCache.on('flush', () => {
    logger.debug('Cache vidé');
});
```

## 🧪 Tests

### Tests unitaires

```javascript
// tests/cache.test.js
const cache = require('../src/configuration/cache');

describe('CacheManager', () => {
    beforeEach(() => {
        cache.initialize();
        cache.flush();
    });

    afterAll(() => {
        cache.close();
    });

    test('set and get value', () => {
        cache.set('test', 'value');
        expect(cache.get('test')).toBe('value');
    });

    test('get non-existent key', () => {
        expect(cache.get('nonexistent')).toBeUndefined();
    });

    test('delete key', () => {
        cache.set('test', 'value');
        cache.del('test');
        expect(cache.has('test')).toBe(false);
    });

    test('multiple set and get', () => {
        cache.setMany([
            { key: 'key1', val: 'value1' },
            { key: 'key2', val: 'value2' }
        ]);
        
        const values = cache.getMany(['key1', 'key2', 'key3']);
        expect(values.key1).toBe('value1');
        expect(values.key2).toBe('value2');
        expect(values.key3).toBeUndefined();
    });

    test('increment counter', () => {
        expect(cache.increment('counter')).toBe(1);
        expect(cache.increment('counter', 5)).toBe(6);
        expect(cache.get('counter')).toBe(6);
    });

    test('decrement counter', () => {
        cache.set('counter', 10);
        expect(cache.decrement('counter', 3)).toBe(7);
        expect(cache.decrement('counter')).toBe(6);
    });

    test('remember pattern', async () => {
        const mockCallback = jest.fn().mockResolvedValue('cached value');
        
        // Premier appel - exécute le callback
        const result1 = await cache.remember('test', 10, mockCallback);
        expect(result1).toBe('cached value');
        expect(mockCallback).toHaveBeenCalledTimes(1);
        
        // Deuxième appel - utilise le cache
        const result2 = await cache.remember('test', 10, mockCallback);
        expect(result2).toBe('cached value');
        expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    test('delete by pattern', () => {
        cache.set('user:1:name', 'John');
        cache.set('user:1:email', 'john@test.com');
        cache.set('user:2:name', 'Jane');
        
        cache.delPattern('user:1:*');
        
        expect(cache.has('user:1:name')).toBe(false);
        expect(cache.has('user:1:email')).toBe(false);
        expect(cache.has('user:2:name')).toBe(true);
    });

    test('namespace isolation', () => {
        const userCache = cache.namespace('users');
        const postCache = cache.namespace('posts');
        
        userCache.set('1', 'John');
        postCache.set('1', 'Post content');
        
        expect(userCache.get('1')).toBe('John');
        expect(postCache.get('1')).toBe('Post content');
        expect(cache.get('users:1')).toBe('John');
    });

    test('ttl expiration', (done) => {
        cache.set('temp', 'value', 1); // 1 seconde
        
        setTimeout(() => {
            expect(cache.get('temp')).toBeUndefined();
            done();
        }, 1100);
    });

    test('statistics', () => {
        cache.set('key1', 'value1');
        cache.get('key1'); // hit
        cache.get('key2'); // miss
        
        const stats = cache.getStats();
        expect(stats.hits).toBe(1);
        expect(stats.misses).toBe(1);
        expect(stats.sets).toBe(1);
        expect(stats.hitRate).toBe('50.00%');
    });

    test('health check', () => {
        const health = cache.healthCheck();
        expect(health.status).toBe('healthy');
        expect(health.stats).toBeDefined();
        expect(health.timestamp).toBeDefined();
    });
});
```

### Tests d'intégration

```javascript
// tests/integration/cache.integration.test.js
const cache = require('../../src/configuration/cache');
const database = require('../../src/config/database');

describe('Cache Integration', () => {
    beforeAll(() => {
        cache.initialize();
    });

    afterAll(() => {
        cache.close();
        database.close();
    });

    test('database query caching', async () => {
        // Premier appel - va en DB
        const result1 = await cache.remember('db:users', 60, async () => {
            return await database('users').select('*');
        });
        
        // Deuxième appel - vient du cache
        const result2 = await cache.remember('db:users', 60, async () => {
            return await database('users').select('*');
        });
        
        expect(result1).toEqual(result2);
    });

    test('cache invalidation on data change', async () => {
        const userId = 123;
        const cacheKey = `user:${userId}`;
        
        // Mettre en cache
        await cache.remember(cacheKey, 3600, async () => {
            return await database('users').where('id', userId).first();
        });
        
        // Modifier en DB
        await database('users').where('id', userId).update({ name: 'Updated' });
        
        // Invalider cache
        await cache.del(cacheKey);
        
        // Re-cache avec nouvelle valeur
        const updatedUser = await cache.remember(cacheKey, 3600, async () => {
            return await database('users').where('id', userId).first();
        });
        
        expect(updatedUser.name).toBe('Updated');
    });
});
```

## 🔒 Bonnes pratiques

### Stratégies de cache

1. **Cache-Aside (Lazy Loading)**
```javascript
async function getUser(id) {
    let user = await cache.get(`user:${id}`);
    if (!user) {
        user = await db.findUser(id);
        await cache.set(`user:${id}`, user, 3600);
    }
    return user;
}
```

2. **Write-Through**
```javascript
async function updateUser(id, data) {
    // Mettre à jour DB
    const user = await db.updateUser(id, data);
    // Mettre à jour cache
    await cache.set(`user:${id}`, user, 3600);
    return user;
}
```

3. **Write-Behind**
```javascript
async function updateUserAsync(id, data) {
    // Mettre à jour cache immédiatement
    await cache.set(`user:${id}`, data, 3600);
    // Programmer mise à jour DB
    queue.add(async () => {
        await db.updateUser(id, data);
    });
}
```

### Stratégies d'invalidation

```javascript
// 1. Invalidation par temps (TTL)
cache.set('key', 'value', 3600); // Expire dans 1 heure

// 2. Invalidation manuelle
await cache.del('key');
await cache.delPattern('users:*');

// 3. Invalidation par version
const VERSION = 2;
await cache.set(`data:v${VERSION}`, value);

// 4. Invalidation par dépendances
await cache.set('post:123', post, 0); // Pas de TTL
// Invalider quand un commentaire est ajouté
await cache.del('post:123');
```

### Gestion des clés

```javascript
// Conventions de nommage
const keys = {
    user: (id) => `user:${id}`,
    userSession: (userId, sessionId) => `user:${userId}:session:${sessionId}`,
    userPosts: (userId) => `user:${userId}:posts`,
    post: (id) => `post:${id}`,
    config: (key) => `config:${key}`
};

// Utilisation
await cache.set(keys.user(123), userData);
await cache.delPattern(keys.userPosts(123));
```

### Monitoring des performances

```javascript
// middleware/cacheMonitor.js
function cacheMonitor(req, res, next) {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const stats = cache.getStats();
        
        logger.info({
            path: req.path,
            duration,
            cacheHitRate: stats.hitRate,
            cacheKeys: stats.keys
        });
    });
    
    next();
}
```

## 🚨 Gestion des erreurs

```javascript
try {
    await cache.set('key', value);
} catch (error) {
    logger.error('Erreur cache:', error);
    // Fallback - continuer sans cache
}

// Cache avec fallback
async function getWithFallback(key, ttl, dbCallback) {
    try {
        return await cache.remember(key, ttl, dbCallback);
    } catch (cacheError) {
        logger.warn('Cache indisponible, fallback DB:', cacheError);
        return await dbCallback();
    }
}
```

## 📈 Performance et optimisation

### Benchmark
```javascript
// scripts/benchmark-cache.js
const cache = require('../src/configuration/cache');
cache.initialize();

const iterations = 10000;

console.time('set');
for (let i = 0; i < iterations; i++) {
    cache.set(`key${i}`, `value${i}`);
}
console.timeEnd('set');

console.time('get');
for (let i = 0; i < iterations; i++) {
    cache.get(`key${i}`);
}
console.timeEnd('get');

console.log(cache.getStats());
```

### Optimisations

1. **Éviter les clones** : `useClones: false` pour les performances
2. **TTL appropriés** : Durées adaptées à la volatilité des données
3. **Namespaces** : Organisation logique des clés
4. **Compression** : Pour les grandes valeurs

```javascript
// Compression de grandes valeurs
const zlib = require('zlib');

async function setCompressed(key, value, ttl) {
    const compressed = zlib.gzipSync(JSON.stringify(value));
    await cache.set(key, compressed, ttl);
}

async function getCompressed(key) {
    const compressed = await cache.get(key);
    if (compressed) {
        const decompressed = zlib.gunzipSync(compressed);
        return JSON.parse(decompressed);
    }
    return null;
}
```

## 🔄 Migration et compatibilité

### Version 1.x vers 2.x

```javascript
// Ancienne version (1.x)
const oldCache = require('./cache-old');
oldCache.put('key', 'value', 3600);
oldCache.get('key');

// Nouvelle version (2.x)
const cache = require('./cache');
cache.set('key', 'value', 3600);
cache.get('key');
```

### Script de migration
```javascript
// scripts/migrate-cache.js
const cache = require('../src/configuration/cache');
const oldCache = require('./cache-old');

async function migrateKeys(pattern) {
    const oldKeys = oldCache.keys(pattern);
    
    for (const key of oldKeys) {
        const value = oldCache.get(key);
        const ttl = oldCache.getTtl(key);
        await cache.set(key, value, ttl);
    }
    
    console.log(`Migré ${oldKeys.length} clés`);
}
```

## 🆘 Dépannage

### Problèmes courants

1. **Cache non initialisé**
```javascript
// Erreur: Cannot read property 'get' of null
// Solution: Appeler cache.initialize() au démarrage
cache.initialize();
```

2. **Mémoire excessive**
```javascript
// Vérifier l'utilisation mémoire
const stats = cache.getStats();
if (stats.memoryUsage > 100 * 1024 * 1024) { // 100MB
    cache.prune(); // Nettoyer les expirés
}
```

3. **Données périmées**
```javascript
// Vérifier si une clé a expiré
const ttl = cache.getTtl('key');
if (ttl && ttl < Date.now()) {
    console.log('Clé expirée');
}
```

### Debugging

```javascript
// Activer le debug temporairement
const originalDebug = logger.debug;
logger.debug = console.log;

// Tracer les opérations
cache.set('test', 'value');
cache.get('test');

// Restaurer
logger.debug = originalDebug;
```

## 📚 API Reference Complète

### Propriétés

| Propriété | Type | Description |
|-----------|------|-------------|
| `localCache` | NodeCache | Instance NodeCache sous-jacente |
| `stats` | Object | Statistiques d'utilisation |

### Méthodes principales

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `initialize()` | - | void | Initialise le cache |
| `get(key)` | `key: string` | any | Récupère une valeur |
| `getMany(keys)` | `keys: string[]` | Object | Récupère plusieurs valeurs |
| `set(key, value, ttl)` | `key, value, ttl?` | boolean | Stocke une valeur |
| `setMany(pairs, ttl)` | `{key,val}[], ttl?` | boolean | Stocke plusieurs valeurs |
| `del(key)` | `key: string` | number | Supprime une clé |
| `delMany(keys)` | `keys: string[]` | number | Supprime plusieurs clés |
| `delPattern(pattern)` | `pattern: string` | number | Supprime par pattern |
| `has(key)` | `key: string` | boolean | Vérifie existence |
| `keys()` | - | string[] | Liste les clés |

### Méthodes avancées

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `increment(key, value)` | `key, value=1` | number | Incrémente un compteur |
| `decrement(key, value)` | `key, value=1` | number | Décrémente un compteur |
| `remember(key, ttl, callback)` | `key, ttl, callback` | any | Get or set pattern |
| `namespace(prefix)` | `prefix: string` | Object | Cache avec préfixe |
| `wrap(ttl)` | `ttl: number` | Decorator | Décorateur de méthode |
| `getStats()` | - | Object | Statistiques détaillées |
| `healthCheck()` | - | Object | Vérification santé |
| `flush()` | - | void | Vide tout le cache |
| `prune()` | - | number | Nettoie expirés |
| `getTtl(key)` | `key: string` | number | TTL restant |
| `close()` | - | void | Ferme le cache |

### Namespace API

```javascript
const ns = cache.namespace('prefix');
ns.get(key)
ns.set(key, value, ttl)
ns.del(key)
ns.delPattern(pattern)
ns.has(key)
ns.increment(key, value)
ns.decrement(key, value)
ns.remember(key, ttl, callback)
```

## 🎯 Conclusion

Ce module de cache offre une solution complète et performante pour le caching en mémoire avec :

- ✅ **Interface unifiée** et facile à utiliser
- ✅ **Namespaces** pour l'isolation des données
- ✅ **Statistiques détaillées** pour le monitoring
- ✅ **Pattern remember** pour éviter la duplication
- ✅ **Décorateur** pour le caching automatique
- ✅ **Compteurs atomiques** pour le rate limiting
- ✅ **Suppression par pattern** pour l'invalidation
- ✅ **Health check** pour le monitoring
- ✅ **Tests complets** et documentation

Il constitue une solution idéale pour améliorer les performances de l'application en réduisant les accès à la base de données et aux services externes.
```

Cette documentation complète couvre tous les aspects du module de cache, de son architecture à son utilisation avancée, en passant par les tests, les bonnes pratiques et le dépannage.