// src/routes/middlewares/rateLimiter.middleware.js
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const { createClient } = require('redis');
const { RateLimitError } = require('../../utils/errors/rateLimiterError');
const logger = require('../../configuration/logger');

class RateLimiterMiddleware {
    constructor() {
        this.redisClient = null;
        this.connected = false;
        
        // Initialisation asynchrone (ne bloque pas)
        this.initialize().catch(err => {
            logger.error('Erreur initialisation rateLimiter:', err);
        });
    }

    /**
     * Initialiser la connexion Redis
     */
    async initialize() {
        try {
            this.redisClient = createClient({
                url: process.env.REDIS_URL || 'redis://localhost:6379',
                socket: {
                    reconnectStrategy: (retries) => {
                        if (retries > 10) {
                            logger.error('Tentatives de reconnexion Redis épuisées');
                            return new Error('Tentatives de reconnexion épuisées');
                        }
                        return Math.min(retries * 100, 3000);
                    }
                }
            });

            this.redisClient.on('error', (err) => {
                logger.error('Erreur Redis (rateLimiter):', err);
                this.connected = false;
            });

            this.redisClient.on('connect', () => {
                logger.info('Redis connecté (rateLimiter)');
                this.connected = true;
            });

            await this.redisClient.connect();
            
        } catch (error) {
            logger.error('Erreur initialisation Redis (rateLimiter):', error);
            this.connected = false;
        }
    }

    /**
     * Vérifier si Redis est connecté
     */
    isConnected() {
        return this.connected && this.redisClient?.isReady;
    }

    /**
     * Obtenir les options de store Redis
     */
    getStoreOptions(prefix) {
        if (!this.isConnected()) {
            logger.warn(`Redis non connecté, fallback mémoire pour ${prefix}`);
            return undefined;
        }

        return {
            sendCommand: (...args) => this.redisClient.sendCommand(args),
            prefix: `rl:${prefix}:`
        };
    }

    /**
     * Factory pour créer des limiteurs avec ou sans Redis
     */
    _createLimiter(options) {
        const { windowMs, max, message, prefix, keyGenerator, skipSuccessfulRequests, skip } = options;
        
        const store = this.getStoreOptions(prefix) 
            ? new RedisStore(this.getStoreOptions(prefix)) 
            : undefined;

        return rateLimit({
            store,
            windowMs,
            max,
            message,
            standardHeaders: true,
            legacyHeaders: false,
            keyGenerator,
            skipSuccessfulRequests,
            skip,
            handler: (req, res) => {
                throw new RateLimitError(message);
            }
        });
    }

    /**
     * Limiteur général pour l'API
     */
    get apiLimiter() {
        return this._createLimiter({
            windowMs: 15 * 60 * 1000,
            max: 100,
            message: 'Trop de requêtes, veuillez réessayer plus tard',
            prefix: 'api',
            skip: (req) => req.path.startsWith('/api/v1/admin') && req.user?.role === 'ADMINISTRATEUR_PLATEFORME'
        });
    }

    /**
     * Limiteur strict (celui qui pose problème)
     */
    get strictLimiter() {
        return this._createLimiter({
            windowMs: 15 * 60 * 1000,
            max: 10,
            message: 'Trop de requêtes. Réessayez plus tard.',
            prefix: 'strict'
        });
    }

    /**
     * Limiteur pour l'authentification
     */
    get authLimiter() {
        return this._createLimiter({
            windowMs: 60 * 60 * 1000,
            max: 5,
            message: 'Trop de tentatives de connexion, compte temporairement bloqué',
            prefix: 'auth',
            skipSuccessfulRequests: true,
            keyGenerator: (req) => req.body?.email || req.ip
        });
    }

    /**
     * Limiteur public
     */
    get publicLimiter() {
        return this._createLimiter({
            windowMs: 60 * 1000,
            max: 30,
            message: 'Trop de requêtes, veuillez ralentir',
            prefix: 'public'
        });
    }

    /**
     * Limiteur upload
     */
    get uploadLimiter() {
        return this._createLimiter({
            windowMs: 60 * 60 * 1000,
            max: 10,
            message: 'Limite d\'upload atteinte, réessayez plus tard',
            prefix: 'upload'
        });
    }

    /**
     * Limiteur recherche
     */
    get searchLimiter() {
        return this._createLimiter({
            windowMs: 60 * 1000,
            max: 20,
            message: 'Trop de recherches, veuillez ralentir',
            prefix: 'search'
        });
    }

    /**
     * Limiteur message
     */
    get messageLimiter() {
        return this._createLimiter({
            windowMs: 60 * 1000,
            max: 50,
            message: 'Limite de messages atteinte',
            prefix: 'message'
        });
    }

    /**
     * Middleware personnalisé pour limiter par utilisateur connecté
     */
    userLimiter(options = {}) {
        const {
            windowMs = 60 * 1000,
            max = 100,
            message = 'Limite de requêtes atteinte'
        } = options;

        return async (req, res, next) => {
            if (!req.user) {
                return next();
            }

            if (!this.isConnected()) {
                logger.warn('Redis non connecté, limitation utilisateur désactivée');
                return next();
            }

            const key = `user:${req.user.id}:${req.path}`;
            const now = Date.now();
            const windowStart = now - windowMs;

            try {
                await this.redisClient.zRemRangeByScore(key, 0, windowStart);
                const count = await this.redisClient.zCard(key);
                
                if (count >= max) {
                    throw new RateLimitError(message);
                }

                await this.redisClient.zAdd(key, { score: now, value: `${now}-${Math.random()}` });
                await this.redisClient.expire(key, Math.ceil(windowMs / 1000));

                next();
            } catch (error) {
                if (error instanceof RateLimitError) {
                    next(error);
                } else {
                    logger.error('Erreur userLimiter:', error);
                    next();
                }
            }
        };
    }

    /**
     * Fermer la connexion Redis
     */
    async close() {
        if (this.redisClient) {
            await this.redisClient.quit();
            logger.info('Connexion Redis (rateLimiter) fermée');
        }
    }
}

// Créer l'instance et l'exporter
const rateLimiterInstance = new RateLimiterMiddleware();

// Exporter directement l'instance
module.exports = rateLimiterInstance;