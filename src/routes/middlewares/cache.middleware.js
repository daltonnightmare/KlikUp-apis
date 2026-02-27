// src/routes/middlewares/cache.middleware.js
const CacheService = require('../../services/cache/CacheService');
const logger = require('../../configuration/logger');

class CacheMiddleware {
    /**
     * Middleware de mise en cache
     * @param {number} duration - Durée de cache en secondes
     */
    cache(duration) {
        return async (req, res, next) => {
            // Ne pas mettre en cache si l'utilisateur est connecté
            if (req.user) {
                return next();
            }

            // Ne pas mettre en cache pour les requêtes avec paramètres spécifiques
            if (req.query.noCache === 'true') {
                return next();
            }

            const key = this.generateCacheKey(req);

            try {
                const cachedData = await CacheService.get(key);
                
                if (cachedData) {
                    logger.debug(`Cache hit for ${key}`);
                    return res.json({
                        ...cachedData,
                        fromCache: true,
                        cachedAt: new Date().toISOString()
                    });
                }

                // Stocker la méthode res.json originale
                const originalJson = res.json;

                // Surcharger res.json pour mettre en cache la réponse
                res.json = function(data) {
                    // Restaurer la méthode originale
                    res.json = originalJson;

                    // Mettre en cache (ne pas bloquer)
                    CacheService.set(key, data, duration).catch(err => {
                        logger.error('Erreur lors de la mise en cache:', err);
                    });

                    // Envoyer la réponse
                    return originalJson.call(this, data);
                };

                next();
            } catch (error) {
                logger.error('Erreur dans le middleware de cache:', error);
                next();
            }
        };
    }

    /**
     * Générer une clé de cache à partir de la requête
     */
    generateCacheKey(req) {
        const parts = [
            req.method,
            req.originalUrl || req.url,
            JSON.stringify(req.query),
            req.user ? `user:${req.user.id}` : 'anonymous'
        ];

        // Ajouter les headers pertinents
        const headers = ['accept-language', 'accept-encoding'];
        headers.forEach(header => {
            if (req.headers[header]) {
                parts.push(`${header}:${req.headers[header]}`);
            }
        });

        return parts.join('|');
    }

    /**
     * Middleware pour invalider le cache
     */
    invalidate(patterns) {
        return async (req, res, next) => {
            // Stocker la méthode originale
            const originalJson = res.json;

            res.json = async function(data) {
                // Restaurer la méthode originale
                res.json = originalJson;

                // Invalider le cache après l'envoi de la réponse
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        for (const pattern of patterns) {
                            const cachePattern = typeof pattern === 'function' 
                                ? pattern(req) 
                                : pattern;
                            
                            if (cachePattern) {
                                await CacheService.delPattern(cachePattern);
                                logger.debug(`Cache invalidated for pattern: ${cachePattern}`);
                            }
                        }
                    } catch (error) {
                        logger.error('Erreur lors de l\'invalidation du cache:', error);
                    }
                }

                return originalJson.call(this, data);
            };

            next();
        };
    }

    /**
     * Middleware pour le cache des ressources statiques
     */
    staticCache(duration) {
        return (req, res, next) => {
            res.set('Cache-Control', `public, max-age=${duration}`);
            next();
        };
    }

    /**
     * Middleware pour éviter la mise en cache
     */
    noCache() {
        return (req, res, next) => {
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            res.set('Pragma', 'no-cache');
            res.set('Expires', '0');
            next();
        };
    }
}

module.exports = new CacheMiddleware();