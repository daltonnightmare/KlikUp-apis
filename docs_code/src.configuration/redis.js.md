```markdown
# Module Redis Client - redis.js

## 📋 Vue d'ensemble

Ce module fournit un client Redis complet utilisant la bibliothèque **ioredis**. Il offre une interface unifiée pour toutes les opérations Redis avec gestion automatique des connexions, reconnexion, monitoring, et support des fonctionnalités avancées comme les verrous distribués, le pub/sub, et les pipelines.

## 🏗️ Architecture

### Classe `RedisClient`

La classe principale qui encapsule toute la logique de gestion Redis.

#### Constructeur
```javascript
constructor()
```
Initialise le client Redis avec :
- `client` : Client Redis principal
- `subscriber` : Client dédié aux subscriptions (connexion séparée)
- `connected` : État de la connexion
- `reconnecting` : État de reconnexion

## 🔧 Fonctionnalités principales

### 1. Configuration et initialisation

```javascript
const options = {
    retryStrategy: (times) => {
        if (times > 10) return null; // Arrêter après 10 tentatives
        return Math.min(times * 100, 3000); // Backoff exponentiel
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectTimeout: 10000,
    commandTimeout: 5000,
    keepAlive: 30000,
    db: 0
};
```

### 2. Gestion des connexions

| Événement | Description | Action |
|-----------|-------------|--------|
| `connect` | Connexion établie | Log info |
| `ready` | Prêt à recevoir commandes | Log info + `connected = true` |
| `error` | Erreur | Log error |
| `close` | Connexion fermée | Log warn + `connected = false` |
| `reconnecting` | Reconnexion en cours | Log info |
| `end` | Connexion terminée | Log warn |

### 3. Opérations de base

| Méthode | Description | Redis Command |
|---------|-------------|---------------|
| `get(key)` | Récupère une valeur | GET |
| `set(key, value, ttl)` | Stocke une valeur | SET / SETEX |
| `setnx(key, value, ttl)` | Set if not exists | SETNX + EXPIRE |
| `mget(keys)` | Récupère plusieurs valeurs | MGET |
| `mset(keyValuePairs, ttl)` | Stocke plusieurs valeurs | MSET |
| `del(...keys)` | Supprime des clés | DEL |
| `exists(key)` | Vérifie existence | EXISTS |
| `expire(key, seconds)` | Définit expiration | EXPIRE |
| `ttl(key)` | Temps restant | TTL |

### 4. Opérations sur les compteurs

| Méthode | Description | Redis Command |
|---------|-------------|---------------|
| `incr(key)` | Incrémente de 1 | INCR |
| `incrby(key, increment)` | Incrémente de N | INCRBY |
| `decr(key)` | Décrémente de 1 | DECR |
| `decrby(key, decrement)` | Décrémente de N | DECRBY |

### 5. Opérations sur les listes

| Méthode | Description | Redis Command |
|---------|-------------|---------------|
| `lpush(key, value)` | Ajoute à gauche | LPUSH |
| `rpush(key, value)` | Ajoute à droite | RPUSH |
| `lpop(key)` | Retire à gauche | LPOP |
| `rpop(key)` | Retire à droite | RPOP |
| `lrange(key, start, stop)` | Plage d'éléments | LRANGE |
| `llen(key)` | Longueur de liste | LLEN |

### 6. Opérations sur les ensembles

| Méthode | Description | Redis Command |
|---------|-------------|---------------|
| `sadd(key, member)` | Ajoute membre | SADD |
| `srem(key, member)` | Supprime membre | SREM |
| `sismember(key, member)` | Vérifie appartenance | SISMEMBER |
| `smembers(key)` | Tous les membres | SMEMBERS |
| `scard(key)` | Cardinalité | SCARD |

### 7. Opérations sur les ensembles triés

| Méthode | Description | Redis Command |
|---------|-------------|---------------|
| `zadd(key, score, member)` | Ajoute avec score | ZADD |
| `zrange(key, start, stop, withScores)` | Plage par index | ZRANGE |
| `zrangebyscore(key, min, max, withScores)` | Plage par score | ZRANGEBYSCORE |
| `zscore(key, member)` | Score d'un membre | ZSCORE |
| `zrem(key, member)` | Supprime membre | ZREM |
| `zremrangebyscore(key, min, max)` | Supprime par score | ZREMRANGEBYSCORE |
| `zcard(key)` | Cardinalité | ZCARD |

### 8. Pub/Sub

```javascript
// Publication
await redis.publish('channel', { event: 'user.created', userId: 123 });

// Abonnement
await redis.subscribe('channel', (message, channel) => {
    console.log(`Reçu sur ${channel}:`, message);
});

// Abonnement multiple
await redis.subscribeMany(['users', 'orders', 'notifications'], (message, channel) => {
    console.log(`[${channel}]`, message);
});
```

### 9. Verrous distribués

```javascript
// Acquérir un verrou
const lock = await redis.acquireLock('resource:123', 10); // TTL 10s

if (lock.success) {
    try {
        // Opération critique
        await processResource();
    } finally {
        // Libérer le verrou
        await lock.release();
    }
}
```

### 10. Pipelines et transactions

```javascript
// Pipeline (exécution atomique mais sans garantie)
const pipeline = redis.pipeline();
pipeline.set('key1', 'value1');
pipeline.set('key2', 'value2');
pipeline.incr('counter');
const results = await pipeline.exec();

// Transaction MULTI/EXEC
const multi = redis.multi();
multi.set('key1', 'value1');
multi.set('key2', 'value2');
const results = await multi.exec();

// Batch avec fallback
const commands = [
    ['set', 'user:1', JSON.stringify(user)],
    ['sadd', 'users:active', '1'],
    ['expire', 'user:1', 3600]
];
const results = await redis.batch(commands);
```

## 📦 Installation et configuration

### Prérequis
```bash
npm install ioredis
```

### Configuration dans `.env`

```env
# Redis
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=optional_password

# Optionnel
REDIS_DB=0
REDIS_CONNECT_TIMEOUT=10000
REDIS_COMMAND_TIMEOUT=5000
```

## 🚀 Utilisation

### Initialisation

```javascript
// Dans app.js
const redis = require('./configuration/redis');

async function startServer() {
    try {
        await redis.initialize();
        
        // Vérifier la connexion
        const health = await redis.healthCheck();
        console.log('Redis santé:', health);
        
        app.listen(3000);
    } catch (error) {
        console.error('Erreur démarrage:', error);
        process.exit(1);
    }
}

// Arrêt gracieux
process.on('SIGTERM', async () => {
    await redis.close();
    process.exit(0);
});
```

### Cache simple

```javascript
// services/cacheService.js
const redis = require('../configuration/redis');

class CacheService {
    async getUser(userId) {
        const cacheKey = `user:${userId}`;
        
        // Essayer le cache d'abord
        let user = await redis.get(cacheKey);
        if (user) {
            return user;
        }
        
        // Sinon, aller en DB
        user = await User.findByPk(userId);
        if (user) {
            // Mettre en cache pour 1 heure
            await redis.set(cacheKey, user, 3600);
        }
        
        return user;
    }

    async invalidateUser(userId) {
        await redis.del(`user:${userId}`);
    }

    async invalidatePattern(pattern) {
        await redis.delPattern(pattern);
    }
}
```

### Rate Limiting

```javascript
// middleware/rateLimit.js
const redis = require('../configuration/redis');

async function rateLimit(req, res, next) {
    const ip = req.ip;
    const key = `rate:${ip}`;
    const limit = 100; // 100 requêtes
    const window = 900; // 15 minutes

    const current = await redis.incr(key);
    
    if (current === 1) {
        await redis.expire(key, window);
    }

    if (current > limit) {
        return res.status(429).json({
            error: 'Trop de requêtes',
            retryAfter: await redis.ttl(key)
        });
    }

    // Ajouter les headers
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', limit - current);
    res.setHeader('X-RateLimit-Reset', await redis.ttl(key));

    next();
}
```

### Session Store

```javascript
// services/sessionService.js
const redis = require('../configuration/redis');

class SessionStore {
    async createSession(userId, data) {
        const sessionId = this.generateSessionId();
        const key = `session:${sessionId}`;
        
        await redis.set(key, {
            userId,
            ...data,
            createdAt: new Date(),
            lastAccess: new Date()
        }, 86400); // 24 heures

        return sessionId;
    }

    async getSession(sessionId) {
        const key = `session:${sessionId}`;
        const session = await redis.get(key);
        
        if (session) {
            // Mettre à jour le dernier accès
            session.lastAccess = new Date();
            await redis.set(key, session, 86400);
        }
        
        return session;
    }

    async destroySession(sessionId) {
        await redis.del(`session:${sessionId}`);
    }

    async cleanupExpired() {
        const keys = await redis.keys('session:*');
        let cleaned = 0;

        for (const key of keys) {
            const ttl = await redis.ttl(key);
            if (ttl < 0) {
                await redis.del(key);
                cleaned++;
            }
        }

        return cleaned;
    }
}
```

### Job Queue simple

```javascript
// services/jobQueue.js
const redis = require('../configuration/redis');

class JobQueue {
    constructor(queueName) {
        this.queueName = queueName;
    }

    async push(job) {
        const jobId = this.generateJobId();
        const jobData = {
            id: jobId,
            data: job,
            status: 'pending',
            createdAt: new Date()
        };

        // Stocker les détails du job
        await redis.set(`job:${jobId}`, jobData, 86400);
        
        // Ajouter à la file
        await redis.rpush(`queue:${this.queueName}`, jobId);

        return jobId;
    }

    async pop() {
        const jobId = await redis.lpop(`queue:${this.queueName}`);
        
        if (!jobId) return null;

        const job = await redis.get(`job:${jobId}`);
        
        if (job) {
            job.status = 'processing';
            await redis.set(`job:${jobId}`, job, 86400);
        }

        return job;
    }

    async complete(jobId, result) {
        const job = await redis.get(`job:${jobId}`);
        
        if (job) {
            job.status = 'completed';
            job.result = result;
            job.completedAt = new Date();
            await redis.set(`job:${jobId}`, job, 3600); // Garder 1h
        }
    }

    async fail(jobId, error) {
        const job = await redis.get(`job:${jobId}`);
        
        if (job) {
            job.status = 'failed';
            job.error = error.message;
            job.failedAt = new Date();
            await redis.set(`job:${jobId}`, job, 7200); // Garder 2h
        }
    }

    async size() {
        return await redis.llen(`queue:${this.queueName}`);
    }
}
```

### Leaderboard avec ensembles triés

```javascript
// services/leaderboard.js
const redis = require('../configuration/redis');

class Leaderboard {
    constructor(boardName) {
        this.boardName = `leaderboard:${boardName}`;
    }

    async addScore(userId, score) {
        await redis.zadd(this.boardName, score, userId);
    }

    async incrementScore(userId, increment) {
        const newScore = await redis.client.zincrby(this.boardName, increment, userId);
        return newScore;
    }

    async getTop(n = 10) {
        const results = await redis.zrange(this.boardName, 0, n - 1, true);
        
        return results.map(item => ({
            userId: item.member,
            score: item.score,
            rank: results.indexOf(item) + 1
        }));
    }

    async getRank(userId) {
        const rank = await redis.client.zrevrank(this.boardName, userId);
        return rank !== null ? rank + 1 : null;
    }

    async getUserScore(userId) {
        return await redis.zscore(this.boardName, userId);
    }

    async getAroundUser(userId, range = 5) {
        const rank = await this.getRank(userId);
        
        if (!rank) return [];

        const start = Math.max(0, rank - range - 1);
        const end = rank + range - 1;

        return await this.getRange(start, end);
    }

    async getRange(start, end) {
        const results = await redis.zrange(this.boardName, start, end, true);
        
        return results.map((item, index) => ({
            userId: item.member,
            score: item.score,
            rank: start + index + 1
        }));
    }

    async totalPlayers() {
        return await redis.zcard(this.boardName);
    }

    async reset() {
        await redis.del(this.boardName);
    }
}
```

### Compteurs temps réel

```javascript
// services/realtimeCounter.js
const redis = require('../configuration/redis');

class RealtimeCounter {
    constructor(prefix) {
        this.prefix = prefix;
    }

    async increment(metric, value = 1) {
        const key = `${this.prefix}:${metric}`;
        const now = Date.now();
        const minute = Math.floor(now / 60000); // Minute actuelle

        // Pipeline pour plusieurs opérations atomiques
        const pipeline = redis.pipeline();
        
        // Incrémenter le compteur total
        pipeline.incrby(key, value);
        
        // Incrémenter le compteur par minute
        pipeline.zincrby(`${key}:minutes`, value, minute);
        
        // Garder seulement les 60 dernières minutes
        pipeline.zremrangebyscore(`${key}:minutes`, 0, minute - 60);
        
        await pipeline.exec();

        return await redis.get(key);
    }

    async getTotal(metric) {
        return await redis.get(`${this.prefix}:${metric}`) || 0;
    }

    async getLastMinutes(metric, minutes = 60) {
        const key = `${this.prefix}:${metric}:minutes`;
        const now = Date.now();
        const currentMinute = Math.floor(now / 60000);
        const startMinute = currentMinute - minutes;

        const results = await redis.zrangebyscore(key, startMinute, currentMinute, true);
        
        return results.map(item => ({
            minute: new Date(item.member * 60000),
            count: item.score
        }));
    }

    async getAveragePerMinute(metric, minutes = 60) {
        const data = await this.getLastMinutes(metric, minutes);
        
        if (data.length === 0) return 0;
        
        const total = data.reduce((sum, item) => sum + item.count, 0);
        return total / data.length;
    }
}
```

### Cache avec invalidation par tags

```javascript
// services/taggedCache.js
const redis = require('../configuration/redis');

class TaggedCache {
    async set(key, value, tags = [], ttl = 3600) {
        // Stocker la valeur
        await redis.set(key, value, ttl);

        // Pour chaque tag, ajouter cette clé
        for (const tag of tags) {
            await redis.sadd(`tag:${tag}`, key);
        }

        // Stocker les tags associés à cette clé
        if (tags.length > 0) {
            await redis.set(`tags:${key}`, tags, ttl);
        }
    }

    async get(key) {
        return await redis.get(key);
    }

    async invalidateTag(tag) {
        // Récupérer toutes les clés associées à ce tag
        const keys = await redis.smembers(`tag:${tag}`);
        
        if (keys.length > 0) {
            // Supprimer toutes ces clés
            await redis.del(...keys);
            
            // Nettoyer les références
            await redis.del(`tag:${tag}`);
        }
    }

    async invalidateKeys(keys) {
        if (keys.length > 0) {
            await redis.del(...keys);
        }
    }

    async getKeysByTag(tag) {
        return await redis.smembers(`tag:${tag}`);
    }

    async getTagsForKey(key) {
        return await redis.get(`tags:${key}`);
    }
}
```

### File d'attente prioritaire

```javascript
// services/priorityQueue.js
const redis = require('../configuration/redis');

class PriorityQueue {
    constructor(name) {
        this.name = name;
        this.queueKey = `pq:${name}`;
        this.dataKey = `pq:${name}:data`;
    }

    async push(item, priority = 5) {
        const id = this.generateId();
        const score = this.calculateScore(priority);

        // Pipeline pour atomicité
        const pipeline = redis.pipeline();
        
        // Ajouter à l'ensemble trié avec le score
        pipeline.zadd(this.queueKey, score, id);
        
        // Stocker les données
        pipeline.hset(this.dataKey, id, JSON.stringify({
            id,
            data: item,
            priority,
            createdAt: Date.now()
        }));

        await pipeline.exec();

        return id;
    }

    async pop() {
        // Récupérer l'élément avec le plus petit score (priorité la plus haute)
        const results = await redis.zrange(this.queueKey, 0, 0);
        
        if (results.length === 0) return null;

        const id = results[0];

        // Pipeline pour atomicité
        const pipeline = redis.pipeline();
        
        // Récupérer les données
        pipeline.hget(this.dataKey, id);
        
        // Supprimer de l'ensemble trié
        pipeline.zrem(this.queueKey, id);
        
        // Supprimer les données
        pipeline.hdel(this.dataKey, id);

        const [dataResult] = await pipeline.exec();

        if (dataResult[1]) {
            return JSON.parse(dataResult[1]);
        }

        return null;
    }

    async peek() {
        const results = await redis.zrange(this.queueKey, 0, 0);
        
        if (results.length === 0) return null;

        const data = await redis.hget(this.dataKey, results[0]);
        return data ? JSON.parse(data) : null;
    }

    async size() {
        return await redis.zcard(this.queueKey);
    }

    async clear() {
        await redis.del(this.queueKey, this.dataKey);
    }

    calculateScore(priority) {
        // Plus le chiffre est petit, plus la priorité est haute
        // Ajouter timestamp pour FIFO à priorité égale
        const now = Date.now();
        return priority * 1e13 + now;
    }

    generateId() {
        return `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}
```

### Gestion de sessions avec Redis

```javascript
// middleware/session.js
const redis = require('../configuration/redis');

class SessionManager {
    constructor() {
        this.prefix = 'sess:';
        this.ttl = 86400; // 24 heures
    }

    async createSession(userId, userData) {
        const sessionId = this.generateSessionId();
        const session = {
            id: sessionId,
            userId,
            ...userData,
            createdAt: new Date(),
            lastAccess: new Date()
        };

        await redis.set(
            `${this.prefix}${sessionId}`,
            session,
            this.ttl
        );

        // Index par utilisateur pour retrouver les sessions
        await redis.sadd(`user_sessions:${userId}`, sessionId);

        return sessionId;
    }

    async getSession(sessionId) {
        const session = await redis.get(`${this.prefix}${sessionId}`);
        
        if (session) {
            // Rafraîchir le TTL
            session.lastAccess = new Date();
            await redis.set(
                `${this.prefix}${sessionId}`,
                session,
                this.ttl
            );
        }

        return session;
    }

    async destroySession(sessionId) {
        const session = await this.getSession(sessionId);
        
        if (session) {
            // Supprimer l'index
            await redis.srem(`user_sessions:${session.userId}`, sessionId);
            
            // Supprimer la session
            await redis.del(`${this.prefix}${sessionId}`);
        }
    }

    async destroyUserSessions(userId) {
        const sessionIds = await redis.smembers(`user_sessions:${userId}`);
        
        if (sessionIds.length > 0) {
            const pipeline = redis.pipeline();
            
            for (const sessionId of sessionIds) {
                pipeline.del(`${this.prefix}${sessionId}`);
            }
            
            pipeline.del(`user_sessions:${userId}`);
            
            await pipeline.exec();
        }
    }

    async getUserSessions(userId) {
        const sessionIds = await redis.smembers(`user_sessions:${userId}`);
        const sessions = [];

        for (const sessionId of sessionIds) {
            const session = await this.getSession(sessionId);
            if (session) sessions.push(session);
        }

        return sessions;
    }

    async cleanup() {
        const keys = await redis.keys(`${this.prefix}*`);
        let cleaned = 0;

        for (const key of keys) {
            const ttl = await redis.ttl(key);
            if (ttl < 0) {
                const sessionId = key.replace(this.prefix, '');
                const session = await this.getSession(sessionId);
                
                if (session) {
                    await redis.srem(`user_sessions:${session.userId}`, sessionId);
                }
                
                await redis.del(key);
                cleaned++;
            }
        }

        return cleaned;
    }

    generateSessionId() {
        return require('crypto').randomBytes(32).toString('hex');
    }
}
```

## 📊 Monitoring et administration

### Script de monitoring Redis

```javascript
// scripts/monitor-redis.js
const redis = require('../src/configuration/redis');

async function monitorRedis() {
    try {
        await redis.initialize();

        // Health check
        const health = await redis.healthCheck();
        console.log('📊 Santé Redis:', health);

        // Informations détaillées
        const info = await redis.info();
        console.log('\n🔧 Configuration:');
        console.log(`Version: ${info.server?.redis_version}`);
        console.log(`OS: ${info.server?.os}`);
        console.log(`Uptime: ${info.server?.uptime_in_seconds}s`);
        console.log(`Mode: ${info.server?.redis_mode}`);

        console.log('\n💾 Mémoire:');
        console.log(`Utilisée: ${info.memory?.used_memory_human}`);
        console.log(`RSS: ${info.memory?.used_memory_rss_human}`);
        console.log(`Fragmentation: ${info.memory?.mem_fragmentation_ratio}`);

        console.log('\n📦 Statistiques:');
        console.log(`Clés: ${await redis.dbsize()}`);
        console.log(`Connexions: ${info.clients?.connected_clients}`);
        console.log(`Commandes/s: ${info.stats?.instantaneous_ops_per_sec}`);

        // Statistiques par type
        const keys = await redis.keys('*');
        const stats = {};

        for (const key of keys) {
            const type = await redis.client.type(key);
            stats[type] = (stats[type] || 0) + 1;
        }

        console.log('\n📁 Types de clés:');
        Object.entries(stats).forEach(([type, count]) => {
            console.log(`  ${type}: ${count}`);
        });

        // Grosses clés
        console.log('\n🔑 Top 10 plus grosses clés:');
        const keySizes = [];

        for (const key of keys.slice(0, 100)) { // Limiter pour performance
            const size = await redis.client.memory('USAGE', key);
            keySizes.push({ key, size });
        }

        keySizes
            .sort((a, b) => b.size - a.size)
            .slice(0, 10)
            .forEach(({ key, size }) => {
                console.log(`  ${key}: ${(size / 1024).toFixed(2)} KB`);
            });

        await redis.close();

    } catch (error) {
        console.error('Erreur monitoring:', error);
    }
}

monitorRedis();
```

### Dashboard temps réel

```javascript
// services/redisDashboard.js
const redis = require('../configuration/redis');

class RedisDashboard {
    constructor(io) {
        this.io = io;
        this.interval = null;
    }

    start(interval = 5000) {
        this.interval = setInterval(async () => {
            try {
                const stats = await this.collectStats();
                this.io.emit('redis:stats', stats);
            } catch (error) {
                console.error('Erreur collecte stats:', error);
            }
        }, interval);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }

    async collectStats() {
        const info = await redis.info();
        const dbsize = await redis.dbsize();

        return {
            timestamp: Date.now(),
            connected: redis.isConnected(),
            dbsize,
            usedMemory: info.memory?.used_memory_human,
            connectedClients: info.clients?.connected_clients,
            opsPerSecond: info.stats?.instantaneous_ops_per_sec,
            hitRate: this.calculateHitRate(info),
            latency: await this.measureLatency()
        };
    }

    calculateHitRate(info) {
        const hits = parseInt(info.stats?.keyspace_hits) || 0;
        const misses = parseInt(info.stats?.keyspace_misses) || 0;
        const total = hits + misses;
        
        return total > 0 ? ((hits / total) * 100).toFixed(2) + '%' : '0%';
    }

    async measureLatency() {
        const start = Date.now();
        await redis.ping();
        return Date.now() - start;
    }

    async getSlowQueries(limit = 10) {
        const slowLogs = await redis.client.slowlog('GET', limit);
        
        return slowLogs.map(log => ({
            id: log[0],
            timestamp: new Date(log[1] * 1000),
            duration: log[2] / 1000, // en millisecondes
            command: log[3].join(' '),
            args: log[4],
            client: log[5]
        }));
    }
}
```

## 🧪 Tests

### Tests unitaires

```javascript
// tests/redis.test.js
const redis = require('../src/configuration/redis');

describe('Redis Client', () => {
    beforeAll(async () => {
        await redis.initialize();
    });

    afterAll(async () => {
        await redis.close();
    });

    beforeEach(async () => {
        await redis.flushdb();
    });

    test('should connect to Redis', () => {
        expect(redis.isConnected()).toBe(true);
    });

    test('should set and get string value', async () => {
        await redis.set('test', 'value');
        const result = await redis.get('test');
        expect(result).toBe('value');
    });

    test('should set and get object value', async () => {
        const obj = { name: 'John', age: 30 };
        await redis.set('user', obj);
        const result = await redis.get('user');
        expect(result).toEqual(obj);
    });

    test('should set with expiration', async () => {
        await redis.set('temp', 'value', 1);
        expect(await redis.get('temp')).toBe('value');
        
        await new Promise(resolve => setTimeout(resolve, 1100));
        
        expect(await redis.get('temp')).toBeNull();
    });

    test('should setnx only if not exists', async () => {
        const result1 = await redis.setnx('key', 'value1');
        expect(result1).toBe(true);
        
        const result2 = await redis.setnx('key', 'value2');
        expect(result2).toBe(false);
        
        expect(await redis.get('key')).toBe('value1');
    });

    test('should increment counter', async () => {
        await redis.set('counter', 5);
        
        const result1 = await redis.incr('counter');
        expect(result1).toBe(6);
        
        const result2 = await redis.incrby('counter', 3);
        expect(result2).toBe(9);
    });

    test('should delete keys', async () => {
        await redis.set('key1', 'value1');
        await redis.set('key2', 'value2');
        
        const deleted = await redis.del('key1', 'key2');
        expect(deleted).toBe(2);
        
        expect(await redis.get('key1')).toBeNull();
        expect(await redis.get('key2')).toBeNull();
    });

    test('should check existence', async () => {
        await redis.set('exists', 'value');
        
        expect(await redis.exists('exists')).toBe(true);
        expect(await redis.exists('nonexistent')).toBe(false);
    });

    test('should get ttl', async () => {
        await redis.set('temp', 'value', 60);
        
        const ttl = await redis.ttl('temp');
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(60);
    });

    test('should work with lists', async () => {
        await redis.rpush('list', 'a');
        await redis.rpush('list', 'b');
        await redis.lpush('list', 'c');
        
        expect(await redis.llen('list')).toBe(3);
        
        const range = await redis.lrange('list', 0, -1);
        expect(range).toEqual(['c', 'a', 'b']);
        
        expect(await redis.lpop('list')).toBe('c');
        expect(await redis.rpop('list')).toBe('b');
    });

    test('should work with sets', async () => {
        await redis.sadd('set', 'a');
        await redis.sadd('set', 'b');
        await redis.sadd('set', 'c');
        
        expect(await redis.scard('set')).toBe(3);
        expect(await redis.sismember('set', 'b')).toBe(true);
        
        const members = await redis.smembers('set');
        expect(members).toContain('a');
        expect(members).toContain('b');
        expect(members).toContain('c');
    });

    test('should work with sorted sets', async () => {
        await redis.zadd('leaderboard', 100, 'player1');
        await redis.zadd('leaderboard', 200, 'player2');
        await redis.zadd('leaderboard', 150, 'player3');
        
        expect(await redis.zcard('leaderboard')).toBe(3);
        
        const top = await redis.zrange('leaderboard', 0, 1, true);
        expect(top[0].member).toBe('player1');
        expect(top[0].score).toBe(100);
    });

    test('should publish and subscribe', (done) => {
        redis.subscribe('test-channel', (message) => {
            expect(message).toEqual({ test: 'data' });
            done();
        });

        setTimeout(() => {
            redis.publish('test-channel', { test: 'data' });
        }, 100);
    });

    test('should acquire and release lock', async () => {
        const lock = await redis.acquireLock('resource', 2);
        
        expect(lock.success).toBe(true);
        
        // Tentative d'acquisition du même lock devrait échouer
        const lock2 = await redis.acquireLock('resource', 2, 100, 2);
        expect(lock2.success).toBe(false);
        
        await lock.release();
        
        // Maintenant ça devrait fonctionner
        const lock3 = await redis.acquireLock('resource', 2);
        expect(lock3.success).toBe(true);
        await lock3.release();
    });

    test('should execute pipeline', async () => {
        const pipeline = redis.pipeline();
        pipeline.set('a', '1');
        pipeline.set('b', '2');
        pipeline.incr('a');
        
        const results = await pipeline.exec();
        
        expect(results[0][1]).toBe('OK');
        expect(results[1][1]).toBe('OK');
        
        expect(await redis.get('a')).toBe('2');
        expect(await redis.get('b')).toBe('2');
    });

    test('should handle batch commands', async () => {
        const commands = [
            ['set', 'x', '10'],
            ['incr', 'x'],
            ['get', 'x']
        ];
        
        const results = await redis.batch(commands);
        
        expect(results[2][1]).toBe('11');
    });

    test('should get health check', async () => {
        const health = await redis.healthCheck();
        
        expect(health.status).toBe('healthy');
        expect(health.latency).toBeDefined();
        expect(health.dbsize).toBeDefined();
        expect(health.info).toBeDefined();
    });

    test('should delete by pattern', async () => {
        await redis.set('user:1', 'data');
        await redis.set('user:2', 'data');
        await redis.set('post:1', 'data');
        
        const deleted = await redis.delPattern('user:*');
        
        expect(deleted).toBe(2);
        expect(await redis.exists('user:1')).toBe(false);
        expect(await redis.exists('post:1')).toBe(true);
    });

    test('should work with fallback', async () => {
        const result = await redis.withFallback(async () => {
            return await redis.get('key');
        }, 'fallback');
        
        expect(result).toBeNull(); // key n'existe pas
    });
});
```

### Tests d'intégration avec application

```javascript
// tests/integration/redis.integration.test.js
const redis = require('../../src/configuration/redis');
const app = require('../../src/app');
const request = require('supertest');

describe('Redis Integration', () => {
    beforeAll(async () => {
        await redis.initialize();
    });

    afterAll(async () => {
        await redis.close();
    });

    beforeEach(async () => {
        await redis.flushdb();
    });

    test('should cache API responses', async () => {
        // Premier appel - devrait aller en DB
        const response1 = await request(app)
            .get('/api/users/1')
            .expect(200);

        // Vérifier que la réponse est en cache
        const cached = await redis.get('api:/users/1');
        expect(cached).toBeDefined();

        // Deuxième appel - devrait venir du cache
        const response2 = await request(app)
            .get('/api/users/1')
            .expect(200);

        expect(response2.body).toEqual(response1.body);
    });

    test('should rate limit requests', async () => {
        const ip = '127.0.0.1';
        
        // Faire 101 requêtes (limite = 100)
        for (let i = 0; i < 100; i++) {
            await request(app)
                .get('/api/test')
                .set('X-Forwarded-For', ip);
        }

        // La 101ème devrait être bloquée
        await request(app)
            .get('/api/test')
            .set('X-Forwarded-For', ip)
            .expect(429);

        // Vérifier le compteur Redis
        const count = await redis.get(`rate:${ip}`);
        expect(parseInt(count)).toBe(100);
    });

    test('should manage sessions', async () => {
        const agent = request.agent(app);

        // Login
        await agent
            .post('/api/auth/login')
            .send({
                email: 'test@test.com',
                password: 'password'
            })
            .expect(200);

        // Vérifier la session Redis
        const keys = await redis.keys('sess:*');
        expect(keys.length).toBe(1);

        // Logout
        await agent
            .post('/api/auth/logout')
            .expect(200);

        // Session devrait être supprimée
        const afterKeys = await redis.keys('sess:*');
        expect(afterKeys.length).toBe(0);
    });

    test('should handle pub/sub for real-time features', (done) => {
        const socket = require('socket.io-client')('http://localhost:3000');

        socket.on('notification', (data) => {
            expect(data.message).toBe('Test notification');
            socket.disconnect();
            done();
        });

        // Simuler une notification via Redis
        setTimeout(async () => {
            await redis.publish('notifications', {
                userId: 1,
                message: 'Test notification'
            });
        }, 100);
    });
});
```

## 🔒 Bonnes pratiques

### 1. Gestion des connexions

```javascript
// Toujours vérifier la connexion avant utilisation
async function safeRedisOperation(operation) {
    if (!redis.isConnected()) {
        logger.warn('Redis non connecté');
        return null;
    }

    try {
        return await operation();
    } catch (error) {
        logger.error('Erreur Redis:', error);
        return null;
    }
}

// Utilisation
const user = await safeRedisOperation(() => redis.get(`user:${id}`));
```

### 2. Namespacing des clés

```javascript
// Conventions de nommage
const KEYS = {
    user: (id) => `user:${id}`,
    session: (id) => `session:${id}`,
    rateLimit: (ip) => `ratelimit:${ip}`,
    cache: (prefix, key) => `cache:${prefix}:${key}`,
    lock: (resource) => `lock:${resource}`,
    queue: (name) => `queue:${name}`,
    set: (name) => `set:${name}`,
    sortedSet: (name) => `zset:${name}`
};

// Utilisation
await redis.set(KEYS.user(123), userData);
await redis.del(KEYS.session(sessionId));
```

### 3. Gestion des erreurs

```javascript
// Pattern de retry pour les opérations critiques
async function withRetry(operation, maxRetries = 3) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            logger.warn(`Tentative ${i + 1} échouée:`, error);
            
            if (i < maxRetries - 1) {
                await new Promise(resolve => 
                    setTimeout(resolve, Math.pow(2, i) * 100)
                );
            }
        }
    }
    
    throw lastError;
}

// Utilisation
const value = await withRetry(() => redis.get('key'));
```

### 4. Pipeline pour performances

```javascript
// Regrouper les opérations
async function saveUserWithRelations(userId, userData, roles) {
    const pipeline = redis.pipeline();
    
    pipeline.set(`user:${userId}`, userData, 3600);
    
    for (const role of roles) {
        pipeline.sadd(`user:${userId}:roles`, role);
    }
    
    pipeline.sadd('users:all', userId);
    
    await pipeline.exec();
}
```

### 5. Cleanup et maintenance

```javascript
// Tâche de nettoyage périodique
setInterval(async () => {
    try {
        // Supprimer les clés expirées manuellement
        const keys = await redis.keys('temp:*');
        let cleaned = 0;
        
        for (const key of keys) {
            const ttl = await redis.ttl(key);
            if (ttl < 0) {
                await redis.del(key);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            logger.info(`Nettoyage Redis: ${cleaned} clés supprimées`);
        }
    } catch (error) {
        logger.error('Erreur nettoyage Redis:', error);
    }
}, 3600000); // Toutes les heures
```

## 📈 Performance et optimisation

### Benchmark

```javascript
// scripts/benchmark-redis.js
const redis = require('../src/configuration/redis');

async function benchmark() {
    await redis.initialize();

    const iterations = 10000;
    const start = Date.now();

    // Test SET
    console.time('SET');
    for (let i = 0; i < iterations; i++) {
        await redis.set(`bench:${i}`, `value${i}`);
    }
    console.timeEnd('SET');

    // Test GET
    console.time('GET');
    for (let i = 0; i < iterations; i++) {
        await redis.get(`bench:${i}`);
    }
    console.timeEnd('GET');

    // Test PIPELINE
    console.time('PIPELINE SET');
    const pipeline = redis.pipeline();
    for (let i = 0; i < iterations; i++) {
        pipeline.set(`bench:pipeline:${i}`, `value${i}`);
    }
    await pipeline.exec();
    console.timeEnd('PIPELINE SET');

    // Test MGET
    console.time('MGET');
    const keys = Array.from({ length: iterations }, (_, i) => `bench:${i}`);
    await redis.mget(keys);
    console.timeEnd('MGET');

    // Cleanup
    await redis.delPattern('bench:*');
    await redis.delPattern('bench:pipeline:*');

    await redis.close();
}

benchmark();
```

### Optimisation mémoire

```javascript
// Utiliser des structures de données adaptées
async function optimizeMemoryUsage() {
    // ❌ Mauvais: stocker des objets séparés
    for (const item of items) {
        await redis.set(`item:${item.id}`, item);
    }
    
    // ✅ Bon: utiliser des hash pour les objets liés
    const pipeline = redis.pipeline();
    for (const item of items) {
        pipeline.hset(`items:${item.category}`, item.id, JSON.stringify(item));
    }
    await pipeline.exec();
    
    // ✅ Utiliser des bitsets pour les flags
    // setbit users:active 1234 1
    // getbit users:active 1234
}

// Compresser les données
const zlib = require('zlib');

async function setCompressed(key, value, ttl) {
    const compressed = zlib.gzipSync(JSON.stringify(value));
    await redis.set(key, compressed.toString('base64'), ttl);
}

async function getCompressed(key) {
    const compressed = await redis.get(key);
    if (compressed) {
        const buffer = Buffer.from(compressed, 'base64');
        const decompressed = zlib.gunzipSync(buffer);
        return JSON.parse(decompressed);
    }
    return null;
}
```

## 🔄 Migration

### De redis à ioredis

```javascript
// Migration script
const oldRedis = require('redis');
const newRedis = require('./configuration/redis');

async function migrate() {
    const client = oldRedis.createClient();
    
    client.keys('*', async (err, keys) => {
        for (const key of keys) {
            client.get(key, async (err, value) => {
                const ttl = await new Promise((resolve) => {
                    client.ttl(key, (err, ttl) => resolve(ttl));
                });
                
                await newRedis.set(key, value, ttl > 0 ? ttl : null);
            });
        }
        
        client.quit();
        console.log('Migration terminée');
    });
}
```

## 📚 API Reference

### Propriétés

| Propriété | Type | Description |
|-----------|------|-------------|
| `client` | Redis | Client principal |
| `subscriber` | Redis | Client pour subscriptions |
| `connected` | boolean | État connexion |
| `reconnecting` | boolean | État reconnexion |

### Méthodes principales

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `initialize()` | - | Promise<void> | Initialise Redis |
| `close()` | - | Promise<boolean> | Ferme connexions |
| `isConnected()` | - | boolean | Vérifie connexion |
| `ping()` | - | Promise<boolean> | Test connexion |

### Opérations clé-valeur

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `get(key)` | `string` | Promise<any> | Récupère valeur |
| `set(key, value, ttl)` | `string, any, number` | Promise<boolean> | Stocke valeur |
| `setnx(key, value, ttl)` | `string, any, number` | Promise<boolean> | Set if not exists |
| `mget(keys)` | `string[]` | Promise<any[]> | Multi get |
| `mset(pairs, ttl)` | `object, number` | Promise<boolean> | Multi set |
| `del(...keys)` | `string[]` | Promise<number> | Supprime clés |
| `exists(key)` | `string` | Promise<boolean> | Vérifie existence |
| `expire(key, seconds)` | `string, number` | Promise<boolean> | Définit TTL |
| `ttl(key)` | `string` | Promise<number> | Temps restant |

### Compteurs

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `incr(key)` | `string` | Promise<number> | Incrémente de 1 |
| `incrby(key, inc)` | `string, number` | Promise<number> | Incrémente de N |
| `decr(key)` | `string` | Promise<number> | Décrémente de 1 |
| `decrby(key, dec)` | `string, number` | Promise<number> | Décrémente de N |

### Listes

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `lpush(key, value)` | `string, any` | Promise<number> | Push gauche |
| `rpush(key, value)` | `string, any` | Promise<number> | Push droit |
| `lpop(key)` | `string` | Promise<any> | Pop gauche |
| `rpop(key)` | `string` | Promise<any> | Pop droit |
| `lrange(key, start, stop)` | `string, number, number` | Promise<any[]> | Plage |
| `llen(key)` | `string` | Promise<number> | Longueur |

### Ensembles

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `sadd(key, member)` | `string, any` | Promise<number> | Ajoute membre |
| `srem(key, member)` | `string, any` | Promise<number> | Supprime membre |
| `sismember(key, member)` | `string, any` | Promise<boolean> | Vérifie membre |
| `smembers(key)` | `string` | Promise<any[]> | Tous membres |
| `scard(key)` | `string` | Promise<number> | Cardinalité |

### Ensembles triés

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `zadd(key, score, member)` | `string, number, any` | Promise<number> | Ajoute avec score |
| `zrange(key, start, stop, withScores)` | `string, number, number, boolean` | Promise<any[]> | Plage par index |
| `zrangebyscore(key, min, max, withScores)` | `string, number, number, boolean` | Promise<any[]> | Plage par score |
| `zscore(key, member)` | `string, any` | Promise<number> | Score membre |
| `zrem(key, member)` | `string, any` | Promise<number> | Supprime membre |
| `zcard(key)` | `string` | Promise<number> | Cardinalité |

### Pub/Sub

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `publish(channel, message)` | `string, any` | Promise<number> | Publie message |
| `subscribe(channel, callback)` | `string, function` | Promise<boolean> | S'abonne |
| `subscribeMany(channels, callback)` | `string[], function` | Promise<boolean> | Multi abonnement |
| `unsubscribe(channel)` | `string` | Promise<boolean> | Désabonne |

### Utilitaires

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `keys(pattern)` | `string` | Promise<string[]> | Cherche clés |
| `delPattern(pattern)` | `string` | Promise<number> | Supprime par pattern |
| `acquireLock(key, ttl, retryDelay, maxRetries)` | `string, number, number, number` | Promise<object> | Acquiert verrou |
| `pipeline()` | - | Pipeline | Crée pipeline |
| `multi()` | - | Multi | Crée transaction |
| `batch(commands)` | `array` | Promise<any[]> | Batch commands |
| `info(section)` | `string` | Promise<object> | Infos Redis |
| `dbsize()` | - | Promise<number> | Nombre clés |
| `healthCheck()` | - | Promise<object> | État de santé |

## 🆘 Dépannage

### Problèmes courants

1. **Connexion refusée**
```javascript
// Vérifier que Redis tourne
// redis-cli ping
// Devrait retourner PONG

// Vérifier la configuration
const config = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD
};
```

2. **Timeout des commandes**
```javascript
// Augmenter les timeouts
const options = {
    connectTimeout: 30000,  // 30 secondes
    commandTimeout: 10000,   // 10 secondes
    retryStrategy: (times) => Math.min(times * 100, 5000)
};
```

3. **Mémoire insuffisante**
```javascript
// Configurer maxmemory dans redis.conf
// maxmemory 2gb
// maxmemory-policy allkeys-lru

// Monitorer l'utilisation
const info = await redis.info();
console.log('Mémoire utilisée:', info.memory?.used_memory_human);
```

4. **Blocages (locks)**
```javascript
// Lister tous les locks
const locks = await redis.keys('lock:*');
console.log('Locks actifs:', locks);

// Forcer la libération d'un lock
await redis.del('lock:resource');
```

### Debugging

```javascript
// Activer le mode debug
process.env.DEBUG = 'ioredis:*';

// Logger toutes les commandes
redis.client.on('command', (command) => {
    console.log('Commande Redis:', command.name, command.args);
});

// Monitor Redis
redis.client.monitor((err, monitor) => {
    monitor.on('monitor', (time, args) => {
        console.log('Redis command:', args);
    });
});

// Inspecter une clé
const type = await redis.client.type('key');
const encoding = await redis.client.object('encoding', 'key');
const idletime = await redis.client.object('idletime', 'key');
console.log({ type, encoding, idletime });
```

## 🎯 Conclusion

Ce module Redis client offre une solution complète et robuste pour interagir avec Redis avec :

- ✅ **Support complet** des commandes Redis
- ✅ **Deux connexions** (client + subscriber)
- ✅ **Reconnexion automatique** avec backoff
- ✅ **Monitoring** et health check
- ✅ **Verrous distribués** sécurisés
- ✅ **Pipeline et transactions**
- ✅ **Pub/Sub** pour temps réel
- ✅ **Structures de données** avancées
- ✅ **Gestion d'erreurs** exhaustive
- ✅ **Documentation complète**

Il constitue le fondement de nombreuses fonctionnalités comme le cache, les sessions, les files d'attente et la communication en temps réel.
```