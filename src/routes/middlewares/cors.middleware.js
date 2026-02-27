// src/routes/middlewares/cors.middleware.js
const cors = require('cors');

class CorsMiddleware {
    /**
     * Configuration CORS
     */
    get options() {
        const whitelist = this.getWhitelist();

        return {
            origin: (origin, callback) => {
                // Autoriser les requêtes sans origine (applications mobiles, Postman)
                if (!origin) {
                    return callback(null, true);
                }

                if (whitelist.length === 0 || whitelist.includes(origin)) {
                    callback(null, true);
                } else {
                    callback(new Error('Origine non autorisée par CORS'));
                }
            },
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            allowedHeaders: [
                'Content-Type',
                'Authorization',
                'X-Requested-With',
                'Accept',
                'Origin',
                'X-CSRF-Token'
            ],
            exposedHeaders: [
                'Content-Range',
                'X-Total-Count',
                'X-RateLimit-Limit',
                'X-RateLimit-Remaining',
                'X-RateLimit-Reset'
            ],
            credentials: true,
            maxAge: 86400, // 24 heures
            preflightContinue: false,
            optionsSuccessStatus: 204
        };
    }

    /**
     * Middleware CORS
     */
    cors() {
        return cors(this.options);
    }

    /**
     * Middleware pour les options préflight
     */
    preflight() {
        return cors(this.options);
    }

    /**
     * Obtenir la liste blanche des origines autorisées
     */
    getWhitelist() {
        const whitelistStr = process.env.CORS_WHITELIST || '';
        
        if (!whitelistStr) {
            return [];
        }

        return whitelistStr.split(',').map(origin => origin.trim());
    }

    /**
     * Vérifier si une origine est autorisée
     */
    isOriginAllowed(origin) {
        const whitelist = this.getWhitelist();
        
        if (whitelist.length === 0) {
            return true;
        }

        return whitelist.includes(origin);
    }
}

module.exports = new CorsMiddleware();