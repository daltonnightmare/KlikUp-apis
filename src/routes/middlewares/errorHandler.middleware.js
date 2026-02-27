// src/routes/middlewares/errorHandler.middleware.js
const { ValidationError, AuthenticationError, AuthorizationError, NotFoundError, RateLimitError } = require('../../utils/errors/rateLimiterError');
const logger = require('../../configuration/logger');

class ErrorHandlerMiddleware {
    /**
     * Gestionnaire d'erreurs principal
     */
    handle(err, req, res, next) {
        // Journaliser l'erreur
        this.logError(err, req);

        // Déterminer le type d'erreur et construire la réponse
        const errorResponse = this.buildErrorResponse(err);

        // Envoyer la réponse
        res.status(errorResponse.status).json({
            success: false,
            error: {
                code: errorResponse.code,
                message: errorResponse.message,
                details: errorResponse.details
            },
            timestamp: new Date().toISOString(),
            path: req.path
        });
    }

    /**
     * Gestionnaire pour les routes non trouvées
     */
    notFound(req, res, next) {
        res.status(404).json({
            success: false,
            error: {
                code: 'NOT_FOUND',
                message: `Route ${req.method} ${req.path} non trouvée`
            },
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Construire la réponse d'erreur appropriée
     */
    buildErrorResponse(err) {
        // Erreurs de validation
        if (err instanceof ValidationError) {
            return {
                status: 400,
                code: 'VALIDATION_ERROR',
                message: err.message,
                details: err.details
            };
        }

        // Erreurs d'authentification
        if (err instanceof AuthenticationError) {
            return {
                status: 401,
                code: 'AUTHENTICATION_ERROR',
                message: err.message
            };
        }

        // Erreurs d'autorisation
        if (err instanceof AuthorizationError) {
            return {
                status: 403,
                code: 'AUTHORIZATION_ERROR',
                message: err.message
            };
        }

        // Erreurs de ressource non trouvée
        if (err instanceof NotFoundError) {
            return {
                status: 404,
                code: 'NOT_FOUND',
                message: err.message
            };
        }

        // Erreurs de rate limiting
        if (err instanceof RateLimitError) {
            return {
                status: 429,
                code: 'RATE_LIMIT_EXCEEDED',
                message: err.message
            };
        }

        // Erreurs de base de données
        if (err.code && err.code.startsWith('22')) {
            return {
                status: 400,
                code: 'DATA_ERROR',
                message: 'Erreur de données',
                details: err.message
            };
        }

        if (err.code === '23505') { // Duplicate key
            return {
                status: 409,
                code: 'DUPLICATE_ENTRY',
                message: 'Cette entrée existe déjà'
            };
        }

        if (err.code === '23503') { // Foreign key violation
            return {
                status: 409,
                code: 'REFERENCE_ERROR',
                message: 'Cette opération est référencée par d\'autres données'
            };
        }

        // Erreurs par défaut (serveur)
        return {
            status: 500,
            code: 'INTERNAL_SERVER_ERROR',
            message: process.env.NODE_ENV === 'production' 
                ? 'Une erreur interne est survenue'
                : err.message
        };
    }

    /**
     * Journaliser l'erreur
     */
    logError(err, req) {
        const errorLog = {
            timestamp: new Date().toISOString(),
            error: {
                name: err.name,
                message: err.message,
                stack: err.stack,
                code: err.code
            },
            request: {
                method: req.method,
                path: req.path,
                query: req.query,
                body: req.body,
                ip: req.ip,
                user: req.user?.id
            }
        };

        if (err.status >= 500) {
            logger.error('Erreur serveur:', errorLog);
        } else if (err.status >= 400) {
            logger.warn('Erreur client:', errorLog);
        } else {
            logger.info('Erreur:', errorLog);
        }
    }

    /**
     * Middleware pour gérer les erreurs asynchrones
     */
    wrapAsync(fn) {
        return (req, res, next) => {
            fn(req, res, next).catch(next);
        };
    }
}

module.exports = new ErrorHandlerMiddleware();