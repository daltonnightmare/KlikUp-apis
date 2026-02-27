// src/configuration/cache.js
const NodeCache = require('node-cache');
const logger = require('./logger');
const env = require('./env');

class CacheManager {
    constructor() {
        this.localCache = null;
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0
        };
    }

    /**
     * Initialiser le cache
     */
    initialize() {
        this.localCache = new NodeCache({
            stdTTL: env.CACHE_TTL || 3600,
            checkperiod: env.CACHE_CHECK_PERIOD || 600,
            useClones: false,
            deleteOnExpire: true
        });

        // Écouter les événements
        this.localCache.on('expired', (key, value) => {
            logger.debug(`Cache expiré: ${key}`);
        });

        this.localCache.on('del', (key, value) => {
            logger.debug(`Cache supprimé: ${key}`);
        });

        this.localCache.on('flush', () => {
            logger.debug('Cache vidé');
        });

        logger.info('Cache initialisé');
    }

    /**
     * Obtenir une valeur du cache
     */
    get(key) {
        const value = this.localCache.get(key);
        
        if (value !== undefined) {
            this.stats.hits++;
            logger.debug(`Cache HIT: ${key}`);
        } else {
            this.stats.misses++;
            logger.debug(`Cache MISS: ${key}`);
        }

        return value;
    }

    /**
     * Obtenir plusieurs valeurs
     */
    getMany(keys) {
        const values = this.localCache.mget(keys);
        
        for (const key of keys) {
            if (values[key] !== undefined) {
                this.stats.hits++;
            } else {
                this.stats.misses++;
            }
        }

        return values;
    }

    /**
     * Définir une valeur dans le cache
     */
    set(key, value, ttl = null) {
        const success = this.localCache.set(key, value, ttl || env.CACHE_TTL);
        
        if (success) {
            this.stats.sets++;
            logger.debug(`Cache SET: ${key}`);
        }

        return success;
    }

    /**
     * Définir plusieurs valeurs
     */
    setMany(keyValuePairs, ttl = null) {
        const success = this.localCache.mset(
            keyValuePairs.map(({ key, val }) => ({
                key,
                val,
                ttl: ttl || env.CACHE_TTL
            }))
        );

        if (success) {
            this.stats.sets += keyValuePairs.length;
            logger.debug(`Cache MSET: ${keyValuePairs.length} clés`);
        }

        return success;
    }

    /**
     * Supprimer une clé
     */
    del(key) {
        const deleted = this.localCache.del(key);
        
        if (deleted > 0) {
            this.stats.deletes += deleted;
            logger.debug(`Cache DEL: ${key}`);
        }

        return deleted;
    }

    /**
     * Supprimer plusieurs clés
     */
    delMany(keys) {
        const deleted = this.localCache.del(keys);
        
        if (deleted > 0) {
            this.stats.deletes += deleted;
            logger.debug(`Cache DEL many: ${deleted} clés`);
        }

        return deleted;
    }

    /**
     * Supprimer des clés par pattern
     */
    delPattern(pattern) {
        const keys = this.localCache.keys();
        const regex = new RegExp(pattern.replace('*', '.*'));
        const matchingKeys = keys.filter(key => regex.test(key));
        
        if (matchingKeys.length > 0) {
            const deleted = this.localCache.del(matchingKeys);
            this.stats.deletes += deleted;
            logger.debug(`Cache DEL pattern "${pattern}": ${deleted} clés`);
            return deleted;
        }

        return 0;
    }

    /**
     * Vérifier si une clé existe
     */
    has(key) {
        return this.localCache.has(key);
    }

    /**
     * Obtenir toutes les clés
     */
    keys() {
        return this.localCache.keys();
    }

    /**
     * Obtenir les statistiques du cache
     */
    getStats() {
        const total = this.stats.hits + this.stats.misses;
        
        return {
            ...this.stats,
            hitRate: total > 0 ? (this.stats.hits / total * 100).toFixed(2) + '%' : '0%',
            keys: this.localCache.keys().length,
            memoryUsage: process.memoryUsage().heapUsed
        };
    }

    /**
     * Incrémenter un compteur
     */
    increment(key, value = 1) {
        let current = this.get(key) || 0;
        current += value;
        this.set(key, current);
        return current;
    }

    /**
     * Décrémenter un compteur
     */
    decrement(key, value = 1) {
        let current = this.get(key) || 0;
        current = Math.max(0, current - value);
        this.set(key, current);
        return current;
    }

    /**
     * Obtenir ou définir avec une fonction
     */
    async remember(key, ttl, callback) {
        let value = this.get(key);
        
        if (value !== undefined) {
            return value;
        }

        value = await callback();
        this.set(key, value, ttl);
        
        return value;
    }

    /**
     * Vider tout le cache
     */
    flush() {
        this.localCache.flushAll();
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0
        };
        logger.info('Cache vidé');
    }

    /**
     * Nettoyer les entrées expirées
     */
    prune() {
        const expired = this.localCache.prune();
        logger.debug(`${expired} entrées expirées nettoyées`);
        return expired;
    }

    /**
     * Obtenir le TTL d'une clé
     */
    getTtl(key) {
        return this.localCache.getTtl(key);
    }

    /**
     * Fermer le cache
     */
    close() {
        this.localCache.close();
        logger.info('Cache fermé');
    }

    /**
     * Créer un cache nommé (namespace)
     */
    namespace(namespace) {
        return {
            get: (key) => this.get(`${namespace}:${key}`),
            set: (key, value, ttl) => this.set(`${namespace}:${key}`, value, ttl),
            del: (key) => this.del(`${namespace}:${key}`),
            delPattern: (pattern) => this.delPattern(`${namespace}:${pattern}`),
            has: (key) => this.has(`${namespace}:${key}`),
            increment: (key, value) => this.increment(`${namespace}:${key}`, value),
            decrement: (key, value) => this.decrement(`${namespace}:${key}`, value),
            remember: (key, ttl, callback) => this.remember(`${namespace}:${key}`, ttl, callback)
        };
    }

    /**
     * Wrapper pour les fonctions avec cache
     */
    wrap(ttl) {
        return (target, propertyKey, descriptor) => {
            const originalMethod = descriptor.value;

            descriptor.value = async (...args) => {
                const cacheKey = `${target.constructor.name}:${propertyKey}:${JSON.stringify(args)}`;
                
                return this.remember(cacheKey, ttl, () => originalMethod.apply(this, args));
            };

            return descriptor;
        };
    }

    /**
     * Vérifier la santé du cache
     */
    healthCheck() {
        try {
            const testKey = 'health:test';
            this.set(testKey, 'ok', 10);
            const value = this.get(testKey);
            this.del(testKey);

            const stats = this.getStats();

            return {
                status: value === 'ok' ? 'healthy' : 'unhealthy',
                stats,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * TODO: Ajouter méthode de monitoring avancé
     */
    async getMetrics() {
        const keys = this.keys();
        const keyTypes = {};
        for (const key of keys.slice(0, 100)) { // Limiter pour performance
            const type = typeof this.get(key);
            keyTypes[type] = (keyTypes[type] || 0) + 1;
        }
        return {
            ...this.getStats(),
            keyCount: keys.length,
            keyTypes,
            memoryUsage: process.memoryUsage().heapUsed,
            uptime: process.uptime()
        };
    }

    /**
     * TODO: Ajouter cache warming
     */

    async warmup(keys, fetchFunction) {
        const promises = keys.map(async key => {
            if (!this.has(key)) {
                const value = await fetchFunction(key);
                this.set(key, value);
            }
        });
        await Promise.all(promises);
        logger.info(`Cache warmup: ${keys.length} clés chargées`);
    }
}

// Exporter une instance unique
module.exports = new CacheManager();