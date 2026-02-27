// src/configuration/redis.js
const Redis = require('ioredis');
const logger = require('./logger');
const env = require('./env');

class RedisClient {
    constructor() {
        this.client = null;
        this.subscriber = null;
        this.connected = false;
        this.reconnecting = false;
        this.circuitBreaker = null;
    }

    /**
     * Initialiser la connexion Redis
     */
    async initialize() {
        try {
            const options = {
                retryStrategy: (times) => {
                    if (times > 10) {
                        logger.error('Tentatives de reconnexion Redis épuisées');
                        return null; // Arrêter de réessayer
                    }
                    const delay = Math.min(times * 100, 3000);
                    logger.debug(`Tentative de reconnexion Redis dans ${delay}ms (tentative ${times})`);
                    return delay;
                },
                maxRetriesPerRequest: 3,
                enableReadyCheck: true,
                lazyConnect: false,
                connectTimeout: 10000,
                disconnectTimeout: 5000,
                commandTimeout: 5000,
                keepAlive: 30000,
                family: 4,
                db: 0
            };

            // Ajouter le mot de passe si fourni
            if (env.REDIS_PASSWORD) {
                options.password = env.REDIS_PASSWORD;
            }

            // Parser l'URL Redis
            if (env.REDIS_URL) {
                const url = new URL(env.REDIS_URL);
                options.host = url.hostname;
                options.port = parseInt(url.port) || 6379;
                if (url.password) {
                    options.password = url.password;
                }
                if (url.pathname && url.pathname.length > 1) {
                    options.db = parseInt(url.pathname.slice(1)) || 0;
                }
            }

            logger.info('Tentative de connexion à Redis...', {
                host: options.host || 'localhost',
                port: options.port || 6379,
                db: options.db
            });

            // Client principal
            this.client = new Redis(options);

            // Client pour les subscriptions (connexion séparée)
            this.subscriber = new Redis(options);

            // Écouter les événements du client principal
            this.client.on('connect', () => {
                logger.info('Connexion Redis établie');
                this.reconnecting = false;
            });

            this.client.on('ready', () => {
                logger.info('Redis prêt à recevoir des commandes');
                this.connected = true;
            });

            this.client.on('error', (error) => {
                logger.error('Erreur Redis:', error);
                this.connected = false;
            });

            this.client.on('close', () => {
                logger.warn('Connexion Redis fermée');
                this.connected = false;
            });

            this.client.on('reconnecting', (delay) => {
                this.reconnecting = true;
                logger.info(`Reconnexion Redis dans ${delay}ms...`);
            });

            this.client.on('end', () => {
                logger.warn('Connexion Redis terminée');
                this.connected = false;
                this.reconnecting = false;
            });

            // Écouter les événements du subscriber
            this.subscriber.on('error', (error) => {
                logger.error('Erreur Redis subscriber:', error);
            });

            this.circuitBreaker = {
                open: false,
                failures: 0,
                threshold: 5,
                lastFailure: null,
                timeout: 30000, // 30 secondes
                check: () => {
                    if (this.circuitBreaker.open) {
                        const timeSinceLastFailure = Date.now() - this.circuitBreaker.lastFailure;
                        if (timeSinceLastFailure > this.circuitBreaker.timeout) {
                            this.circuitBreaker.open = false;
                            this.circuitBreaker.failures = 0;
                            logger.info('Circuit breaker Redis réinitialisé');
                        } else {
                            throw new Error('Circuit breaker Redis ouvert');
                        }
                    }
                },
                recordSuccess: () => {
                    this.circuitBreaker.failures = 0;
                },
                recordFailure: () => {
                    this.circuitBreaker.failures++;
                    this.circuitBreaker.lastFailure = Date.now();
                    if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
                        this.circuitBreaker.open = true;
                        logger.error('Circuit breaker Redis ouvert après échecs répétés');
                    }
                }
            };

            // Tester la connexion
            await this.ping();

            logger.info('Redis initialisé avec succès');

        } catch (error) {
            logger.error('Erreur lors de l\'initialisation de Redis:', error);
            throw error;
        }
    }

    /**
     * Tester la connexion Redis
     */
    async ping() {
        try {
            const result = await this.client.ping();
            logger.debug(`Redis PING: ${result}`);
            return result === 'PONG';
        } catch (error) {
            logger.error('Erreur Redis PING:', error);
            return false;
        }
    }

    /**
     * Obtenir une valeur
     */
    async get(key) {
        try {
            const value = await this.client.get(key);
            if (value && (value.startsWith('{') || value.startsWith('['))) {
                try {
                    return JSON.parse(value);
                } catch {
                    return value;
                }
            }
            return value;
        } catch (error) {
            logger.error(`Erreur Redis GET ${key}:`, error);
            return null;
        }
    }

    /**
     * Définir une valeur
     */
    async set(key, value, ttl = null) {
        try {
            const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
            
            if (ttl) {
                await this.client.setex(key, ttl, stringValue);
                logger.debug(`Redis SETEX ${key} (TTL: ${ttl}s)`);
            } else {
                await this.client.set(key, stringValue);
                logger.debug(`Redis SET ${key}`);
            }
            
            return true;
        } catch (error) {
            logger.error(`Erreur Redis SET ${key}:`, error);
            return false;
        }
    }

    /**
     * Définir une valeur avec expiration (alias pour set avec ttl)
     */
    async setex(key, ttl, value) {
        return this.set(key, value, ttl);
    }

    /**
     * Définir une valeur seulement si elle n'existe pas
     */
    async setnx(key, value, ttl = null) {
        try {
            const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
            const result = await this.client.setnx(key, stringValue);
            
            if (result === 1 && ttl) {
                await this.client.expire(key, ttl);
            }
            
            return result === 1;
        } catch (error) {
            logger.error(`Erreur Redis SETNX ${key}:`, error);
            return false;
        }
    }

    /**
     * Obtenir plusieurs valeurs
     */
    async mget(keys) {
        try {
            if (!Array.isArray(keys) || keys.length === 0) {
                return [];
            }

            const values = await this.client.mget(...keys);
            
            return values.map(value => {
                if (value && (value.startsWith('{') || value.startsWith('['))) {
                    try {
                        return JSON.parse(value);
                    } catch {
                        return value;
                    }
                }
                return value;
            });
        } catch (error) {
            logger.error('Erreur Redis MGET:', error);
            return [];
        }
    }

    /**
     * Définir plusieurs valeurs
     */
    async mset(keyValuePairs, ttl = null) {
        try {
            const args = [];
            for (const [key, value] of Object.entries(keyValuePairs)) {
                args.push(key);
                args.push(typeof value === 'object' ? JSON.stringify(value) : String(value));
            }

            await this.client.mset(...args);

            if (ttl) {
                const pipeline = this.client.pipeline();
                for (const key of Object.keys(keyValuePairs)) {
                    pipeline.expire(key, ttl);
                }
                await pipeline.exec();
            }

            logger.debug(`Redis MSET ${Object.keys(keyValuePairs).length} clés`);
            return true;
        } catch (error) {
            logger.error('Erreur Redis MSET:', error);
            return false;
        }
    }

    /**
     * Supprimer une ou plusieurs clés
     */
    async del(...keys) {
        try {
            if (keys.length === 0) return 0;
            
            const result = await this.client.del(...keys);
            logger.debug(`Redis DEL ${keys.length} clés: ${result} supprimées`);
            return result;
        } catch (error) {
            logger.error('Erreur Redis DEL:', error);
            return 0;
        }
    }

    /**
     * Supprimer des clés par pattern
     */
    async delPattern(pattern) {
        try {
            const keys = await this.keys(pattern);
            if (keys.length > 0) {
                const deleted = await this.del(...keys);
                logger.debug(`Redis DEL pattern "${pattern}": ${deleted} clés supprimées`);
                return deleted;
            }
            return 0;
        } catch (error) {
            logger.error(`Erreur Redis DEL pattern ${pattern}:`, error);
            return 0;
        }
    }

    /**
     * Vérifier si une clé existe
     */
    async exists(key) {
        try {
            const result = await this.client.exists(key);
            return result === 1;
        } catch (error) {
            logger.error(`Erreur Redis EXISTS ${key}:`, error);
            return false;
        }
    }

    /**
     * Vérifier plusieurs clés
     */
    async existsMany(...keys) {
        try {
            if (keys.length === 0) return 0;
            return await this.client.exists(...keys);
        } catch (error) {
            logger.error('Erreur Redis EXISTS many:', error);
            return 0;
        }
    }

    /**
     * Définir un temps d'expiration
     */
    async expire(key, seconds) {
        try {
            const result = await this.client.expire(key, seconds);
            logger.debug(`Redis EXPIRE ${key}: ${seconds}s`);
            return result === 1;
        } catch (error) {
            logger.error(`Erreur Redis EXPIRE ${key}:`, error);
            return false;
        }
    }

    /**
     * Obtenir le temps restant avant expiration
     */
    async ttl(key) {
        try {
            return await this.client.ttl(key);
        } catch (error) {
            logger.error(`Erreur Redis TTL ${key}:`, error);
            return -2;
        }
    }

    /**
     * Incrémenter un compteur
     */
    async incr(key) {
        try {
            const result = await this.client.incr(key);
            logger.debug(`Redis INCR ${key}: ${result}`);
            return result;
        } catch (error) {
            logger.error(`Erreur Redis INCR ${key}:`, error);
            return null;
        }
    }

    /**
     * Incrémenter un compteur d'une valeur spécifique
     */
    async incrby(key, increment) {
        try {
            const result = await this.client.incrby(key, increment);
            logger.debug(`Redis INCRBY ${key}: +${increment} = ${result}`);
            return result;
        } catch (error) {
            logger.error(`Erreur Redis INCRBY ${key}:`, error);
            return null;
        }
    }

    /**
     * Décrémenter un compteur
     */
    async decr(key) {
        try {
            const result = await this.client.decr(key);
            logger.debug(`Redis DECR ${key}: ${result}`);
            return result;
        } catch (error) {
            logger.error(`Erreur Redis DECR ${key}:`, error);
            return null;
        }
    }

    /**
     * Décrémenter un compteur d'une valeur spécifique
     */
    async decrby(key, decrement) {
        try {
            const result = await this.client.decrby(key, decrement);
            logger.debug(`Redis DECRBY ${key}: -${decrement} = ${result}`);
            return result;
        } catch (error) {
            logger.error(`Erreur Redis DECRBY ${key}:`, error);
            return null;
        }
    }

    /**
     * Ajouter à une liste (à gauche)
     */
    async lpush(key, value) {
        try {
            const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
            const result = await this.client.lpush(key, stringValue);
            logger.debug(`Redis LPUSH ${key}: ${result} éléments`);
            return result;
        } catch (error) {
            logger.error(`Erreur Redis LPUSH ${key}:`, error);
            return null;
        }
    }

    /**
     * Ajouter à une liste (à droite)
     */
    async rpush(key, value) {
        try {
            const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
            const result = await this.client.rpush(key, stringValue);
            logger.debug(`Redis RPUSH ${key}: ${result} éléments`);
            return result;
        } catch (error) {
            logger.error(`Erreur Redis RPUSH ${key}:`, error);
            return null;
        }
    }

    /**
     * Retirer et obtenir le premier élément d'une liste
     */
    async lpop(key) {
        try {
            const value = await this.client.lpop(key);
            if (value) {
                try {
                    return JSON.parse(value);
                } catch {
                    return value;
                }
            }
            return null;
        } catch (error) {
            logger.error(`Erreur Redis LPOP ${key}:`, error);
            return null;
        }
    }

    /**
     * Retirer et obtenir le dernier élément d'une liste
     */
    async rpop(key) {
        try {
            const value = await this.client.rpop(key);
            if (value) {
                try {
                    return JSON.parse(value);
                } catch {
                    return value;
                }
            }
            return null;
        } catch (error) {
            logger.error(`Erreur Redis RPOP ${key}:`, error);
            return null;
        }
    }

    /**
     * Obtenir une plage d'une liste
     */
    async lrange(key, start, stop) {
        try {
            const values = await this.client.lrange(key, start, stop);
            return values.map(v => {
                try {
                    return JSON.parse(v);
                } catch {
                    return v;
                }
            });
        } catch (error) {
            logger.error(`Erreur Redis LRANGE ${key}:`, error);
            return [];
        }
    }

    /**
     * Obtenir la longueur d'une liste
     */
    async llen(key) {
        try {
            return await this.client.llen(key);
        } catch (error) {
            logger.error(`Erreur Redis LLEN ${key}:`, error);
            return 0;
        }
    }

    /**
     * Ajouter à un ensemble
     */
    async sadd(key, member) {
        try {
            const stringMember = typeof member === 'object' ? JSON.stringify(member) : String(member);
            const result = await this.client.sadd(key, stringMember);
            logger.debug(`Redis SADD ${key}: ${result} ajouté`);
            return result;
        } catch (error) {
            logger.error(`Erreur Redis SADD ${key}:`, error);
            return 0;
        }
    }

    /**
     * Supprimer d'un ensemble
     */
    async srem(key, member) {
        try {
            const stringMember = typeof member === 'object' ? JSON.stringify(member) : String(member);
            const result = await this.client.srem(key, stringMember);
            logger.debug(`Redis SREM ${key}: ${result} supprimé`);
            return result;
        } catch (error) {
            logger.error(`Erreur Redis SREM ${key}:`, error);
            return 0;
        }
    }

    /**
     * Vérifier l'appartenance à un ensemble
     */
    async sismember(key, member) {
        try {
            const stringMember = typeof member === 'object' ? JSON.stringify(member) : String(member);
            const result = await this.client.sismember(key, stringMember);
            return result === 1;
        } catch (error) {
            logger.error(`Erreur Redis SISMEMBER ${key}:`, error);
            return false;
        }
    }

    /**
     * Obtenir tous les membres d'un ensemble
     */
    async smembers(key) {
        try {
            const members = await this.client.smembers(key);
            return members.map(m => {
                try {
                    return JSON.parse(m);
                } catch {
                    return m;
                }
            });
        } catch (error) {
            logger.error(`Erreur Redis SMEMBERS ${key}:`, error);
            return [];
        }
    }

    /**
     * Obtenir la cardinalité d'un ensemble
     */
    async scard(key) {
        try {
            return await this.client.scard(key);
        } catch (error) {
            logger.error(`Erreur Redis SCARD ${key}:`, error);
            return 0;
        }
    }

    /**
     * Ajouter à un ensemble trié
     */
    async zadd(key, score, member) {
        try {
            const stringMember = typeof member === 'object' ? JSON.stringify(member) : String(member);
            const result = await this.client.zadd(key, score, stringMember);
            logger.debug(`Redis ZADD ${key}: ${result}`);
            return result;
        } catch (error) {
            logger.error(`Erreur Redis ZADD ${key}:`, error);
            return null;
        }
    }

    /**
     * Récupérer une plage d'un ensemble trié
     */
    async zrange(key, start, stop, withScores = false) {
        try {
            let result;
            if (withScores) {
                result = await this.client.zrange(key, start, stop, 'WITHSCORES');
                // Formater le résultat en paires [membre, score]
                const formatted = [];
                for (let i = 0; i < result.length; i += 2) {
                    formatted.push({
                        member: result[i],
                        score: parseFloat(result[i + 1])
                    });
                }
                return formatted;
            } else {
                result = await this.client.zrange(key, start, stop);
                return result;
            }
        } catch (error) {
            logger.error(`Erreur Redis ZRANGE ${key}:`, error);
            return [];
        }
    }

    /**
     * Récupérer une plage d'un ensemble trié par score
     */
    async zrangebyscore(key, min, max, withScores = false) {
        try {
            let result;
            if (withScores) {
                result = await this.client.zrangebyscore(key, min, max, 'WITHSCORES');
                const formatted = [];
                for (let i = 0; i < result.length; i += 2) {
                    formatted.push({
                        member: result[i],
                        score: parseFloat(result[i + 1])
                    });
                }
                return formatted;
            } else {
                return await this.client.zrangebyscore(key, min, max);
            }
        } catch (error) {
            logger.error(`Erreur Redis ZRANGEBYSCORE ${key}:`, error);
            return [];
        }
    }

    /**
     * Obtenir le score d'un membre
     */
    async zscore(key, member) {
        try {
            const stringMember = typeof member === 'object' ? JSON.stringify(member) : String(member);
            const score = await this.client.zscore(key, stringMember);
            return score ? parseFloat(score) : null;
        } catch (error) {
            logger.error(`Erreur Redis ZSCORE ${key}:`, error);
            return null;
        }
    }

    /**
     * Supprimer d'un ensemble trié
     */
    async zrem(key, member) {
        try {
            const stringMember = typeof member === 'object' ? JSON.stringify(member) : String(member);
            const result = await this.client.zrem(key, stringMember);
            return result;
        } catch (error) {
            logger.error(`Erreur Redis ZREM ${key}:`, error);
            return 0;
        }
    }

    /**
     * Supprimer d'un ensemble trié par score
     */
    async zremrangebyscore(key, min, max) {
        try {
            const result = await this.client.zremrangebyscore(key, min, max);
            logger.debug(`Redis ZREMRANGEBYSCORE ${key}: ${result} supprimés`);
            return result;
        } catch (error) {
            logger.error(`Erreur Redis ZREMRANGEBYSCORE ${key}:`, error);
            return 0;
        }
    }

    /**
     * Obtenir la cardinalité d'un ensemble trié
     */
    async zcard(key) {
        try {
            return await this.client.zcard(key);
        } catch (error) {
            logger.error(`Erreur Redis ZCARD ${key}:`, error);
            return 0;
        }
    }

    /**
     * Publier un message sur un canal
     */
    async publish(channel, message) {
        try {
            const stringMessage = typeof message === 'object' ? JSON.stringify(message) : String(message);
            const result = await this.client.publish(channel, stringMessage);
            logger.debug(`Redis PUBLISH ${channel}: ${result} abonnés`);
            return result;
        } catch (error) {
            logger.error(`Erreur Redis PUBLISH ${channel}:`, error);
            return null;
        }
    }

    /**
     * S'abonner à un canal
     */
    async subscribe(channel, callback) {
        try {
            await this.subscriber.subscribe(channel);
            
            this.subscriber.on('message', (ch, message) => {
                if (ch === channel) {
                    try {
                        const parsed = JSON.parse(message);
                        callback(parsed, ch);
                    } catch {
                        callback(message, ch);
                    }
                }
            });
            
            logger.info(`Abonné au canal Redis: ${channel}`);
            return true;
        } catch (error) {
            logger.error(`Erreur Redis SUBSCRIBE ${channel}:`, error);
            return false;
        }
    }

    /**
     * S'abonner à plusieurs canaux
     */
    async subscribeMany(channels, callback) {
        try {
            await this.subscriber.subscribe(...channels);
            
            this.subscriber.on('message', (ch, message) => {
                if (channels.includes(ch)) {
                    try {
                        const parsed = JSON.parse(message);
                        callback(parsed, ch);
                    } catch {
                        callback(message, ch);
                    }
                }
            });
            
            logger.info(`Abonné aux canaux Redis: ${channels.join(', ')}`);
            return true;
        } catch (error) {
            logger.error('Erreur Redis SUBSCRIBE many:', error);
            return false;
        }
    }

    /**
     * Se désabonner d'un canal
     */
    async unsubscribe(channel) {
        try {
            await this.subscriber.unsubscribe(channel);
            logger.info(`Désabonné du canal Redis: ${channel}`);
            return true;
        } catch (error) {
            logger.error(`Erreur Redis UNSUBSCRIBE ${channel}:`, error);
            return false;
        }
    }

    /**
     * Obtenir toutes les clés correspondant à un pattern
     */
    async keys(pattern) {
        try {
            return await this.client.keys(pattern);
        } catch (error) {
            logger.error(`Erreur Redis KEYS ${pattern}:`, error);
            return [];
        }
    }

    /**
     * Obtenir un client Redis brut (pour usages avancés)
     */
    getClient() {
        return this.client;
    }

    /**
     * Obtenir le client subscriber
     */
    getSubscriber() {
        return this.subscriber;
    }

    /**
     * Créer un pipeline
     */
    pipeline() {
        return this.client.pipeline();
    }

    /**
     * Créer une transaction (MULTI)
     */
    multi() {
        return this.client.multi();
    }

    /**
     * Exécuter des commandes en batch avec pipeline
     */
    async batch(commands) {
        const pipeline = this.client.pipeline();
        
        for (const [command, ...args] of commands) {
            if (typeof this.client[command] === 'function') {
                pipeline[command](...args);
            }
        }

        return await pipeline.exec();
    }

    /**
     * Acquérir un verrou (lock) avec Redis
     */
    async acquireLock(lockKey, ttl = 10, retryDelay = 100, maxRetries = 10) {
        let retries = 0;
        const lockValue = Date.now().toString();

        while (retries < maxRetries) {
            try {
                const result = await this.client.set(
                    `lock:${lockKey}`,
                    lockValue,
                    'NX',
                    'EX',
                    ttl
                );

                if (result === 'OK') {
                    logger.debug(`Lock acquis: ${lockKey}`);
                    return {
                        success: true,
                        value: lockValue,
                        release: async () => await this.releaseLock(lockKey, lockValue)
                    };
                }

                retries++;
                if (retries < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
            } catch (error) {
                logger.error(`Erreur acquisition lock ${lockKey}:`, error);
                return { success: false, error: error.message };
            }
        }

        logger.warn(`Lock non acquis après ${maxRetries} tentatives: ${lockKey}`);
        return { success: false, error: 'Timeout' };
    }

    /**
     * Relâcher un verrou (uniquement si on le possède)
     */
    async releaseLock(lockKey, lockValue) {
        try {
            // Utiliser un script Lua pour garantir que seul le propriétaire peut libérer
            const script = `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                else
                    return 0
                end
            `;

            const result = await this.client.eval(script, 1, `lock:${lockKey}`, lockValue);
            
            if (result === 1) {
                logger.debug(`Lock libéré: ${lockKey}`);
                return true;
            } else {
                logger.warn(`Tentative de libération d'un lock non possédé: ${lockKey}`);
                return false;
            }
        } catch (error) {
            logger.error(`Erreur libération lock ${lockKey}:`, error);
            return false;
        }
    }

    /**
     * Vider la base de données courante
     */
    async flushdb() {
        try {
            await this.client.flushdb();
            logger.info('Base Redis vidée (flushdb)');
            return true;
        } catch (error) {
            logger.error('Erreur Redis FLUSHDB:', error);
            return false;
        }
    }

    /**
     * Vider toutes les bases
     */
    async flushall() {
        try {
            await this.client.flushall();
            logger.info('Toutes les bases Redis vidées (flushall)');
            return true;
        } catch (error) {
            logger.error('Erreur Redis FLUSHALL:', error);
            return false;
        }
    }

    /**
     * Obtenir les informations Redis
     */
    async info(section = null) {
        try {
            const info = await this.client.info(section);
            return this.parseInfo(info);
        } catch (error) {
            logger.error('Erreur Redis INFO:', error);
            return null;
        }
    }

    /**
     * Parser les informations Redis
     */
    parseInfo(info) {
        const lines = info.split('\r\n');
        const parsed = {};
        let currentSection = 'default';

        for (const line of lines) {
            if (line.startsWith('#')) {
                currentSection = line.slice(2).toLowerCase().replace(/\s+/g, '_');
                parsed[currentSection] = {};
            } else if (line.includes(':')) {
                const [key, value] = line.split(':');
                if (key && value) {
                    if (currentSection === 'default') {
                        parsed[key] = value;
                    } else {
                        parsed[currentSection][key] = value;
                    }
                }
            }
        }

        return parsed;
    }

    /**
     * Obtenir la taille de la base de données
     */
    async dbsize() {
        try {
            return await this.client.dbsize();
        } catch (error) {
            logger.error('Erreur Redis DBSIZE:', error);
            return 0;
        }
    }

    /**
     * Sérialiser et sauvegarder
     */
    async save() {
        try {
            return await this.client.save();
        } catch (error) {
            logger.error('Erreur Redis SAVE:', error);
            return false;
        }
    }

    /**
     * Sérialiser en arrière-plan
     */
    async bgsave() {
        try {
            return await this.client.bgsave();
        } catch (error) {
            logger.error('Erreur Redis BGSAVE:', error);
            return false;
        }
    }

    /**
     * Obtenir la configuration Redis
     */
    async configGet(pattern) {
        try {
            return await this.client.config('GET', pattern);
        } catch (error) {
            logger.error('Erreur Redis CONFIG GET:', error);
            return null;
        }
    }

    /**
     * Vérifier l'état de la connexion
     */
    isConnected() {
        return this.connected && this.client && this.client.status === 'ready';
    }

    /**
     * Vérifier si Redis est en cours de reconnexion
     */
    isReconnecting() {
        return this.reconnecting;
    }

    /**
     * Obtenir le statut de la connexion
     */
    getStatus() {
        return {
            connected: this.isConnected(),
            reconnecting: this.reconnecting,
            clientStatus: this.client ? this.client.status : 'none',
            subscriberStatus: this.subscriber ? this.subscriber.status : 'none'
        };
    }

    /**
     * Fermer les connexions
     */
    async close() {
        try {
            if (this.subscriber) {
                await this.subscriber.quit();
                logger.info('Connexion subscriber Redis fermée');
            }
            
            if (this.client) {
                await this.client.quit();
                logger.info('Connexion principale Redis fermée');
            }
            
            this.connected = false;
            this.reconnecting = false;
            
            return true;
        } catch (error) {
            logger.error('Erreur lors de la fermeture de Redis:', error);
            
            // Forcer la fermeture en cas d'erreur
            if (this.subscriber) this.subscriber.disconnect();
            if (this.client) this.client.disconnect();
            
            return false;
        }
    }

    /**
     * Vérifier la santé de Redis
     */
    async healthCheck() {
        try {
            this.circuitBreaker.check();
            const start = Date.now();
            await this.ping();
            const latency = Date.now() - start;

            const info = await this.info();

            const usedMemory = parseInt(info?.memory?.used_memory || '0');
            const maxMemory = parseInt(info?.memory?.maxmemory || '0');
            const memoryUsagePercent = maxMemory > 0 ? (usedMemory / maxMemory) * 100 : 0;

            const dbsize = await this.dbsize();
            const status = this.getStatus();
            const clients = parseInt(info?.clients?.connected_clients || '0');

            const statusRedis = {
                status: this.isConnected() ? 'healthy' : 'unhealthy',
                connected: this.isConnected(),
                latency: `${latency}ms`,
                dbsize,
                circuitBreaker: {
                    open: this.circuitBreaker.open,
                    failures: this.circuitBreaker.failures
                },
                memory:{
                    used: usedMemory,
                    max: maxMemory,
                    percent: memoryUsagePercent.toFixed(2) + '%'
                },

                clients,

                info: info ? {
                    version: info.server?.redis_version,
                    usedMemory: info.memory?.used_memory_human,
                    connectedClients: info.clients?.connected_clients,
                    uptime: info.server?.uptime_in_seconds,
                    os: info.server?.os
                } : null,
                connection: status,
                timestamp: new Date().toISOString()
            };
            
            //Alertes
            if (memoryUsagePercent > 80) {
                logger.warn('Redis - utilisation mémoire élevée', { percent: memoryUsagePercent });
            }
            if (clients > 1000) {
                logger.warn('Redis - nombre de connexions élevé', { clients });
            }

            return statusRedis;

        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Wrapper pour les opérations avec fallback
     */
    async withFallback(operation, fallbackValue = null) {
        if (!this.isConnected()) {
            logger.warn('Redis non connecté, utilisation du fallback');
            return fallbackValue;
        }

        try {
            return await operation();
        } catch (error) {
            logger.error('Erreur opération Redis:', error);
            return fallbackValue;
        }
    }
}

// Exporter une instance unique
module.exports = new RedisClient();