// src/routes/middlewares/compression.middleware.js
const compression = require('compression');

class CompressionMiddleware {
    /**
     * Configuration de la compression
     */
    get options() {
        return {
            // Niveau de compression (1-9)
            level: 6,
            
            // Seuil minimum de taille pour compresser (en bytes)
            threshold: 1024, // 1KB
            
            // Filtrer les types de contenu à compresser
            filter: (req, res) => {
                // Ne pas compresser si l'en-tête 'x-no-compression' est présent
                if (req.headers['x-no-compression']) {
                    return false;
                }

                // Utiliser le filtre par défaut
                return compression.filter(req, res);
            },

            // Fonction pour déterminer si la réponse doit être compressée
            shouldCompress: (req, res) => {
                // Compresser par défaut
                return true;
            }
        };
    }

    /**
     * Middleware de compression
     */
    compress() {
        return compression(this.options);
    }

    /**
     * Middleware pour désactiver la compression
     */
    noCompress() {
        return (req, res, next) => {
            req.headers['x-no-compression'] = 'true';
            next();
        };
    }

    /**
     * Vérifier si la réponse doit être compressée
     */
    shouldCompressResponse(req, res) {
        const contentType = res.getHeader('Content-Type');
        
        // Types MIME à compresser
        const compressibleTypes = [
            'text/',
            'application/json',
            'application/javascript',
            'application/xml',
            'application/rss+xml',
            'image/svg+xml'
        ];

        return compressibleTypes.some(type => contentType?.includes(type));
    }
}

module.exports = new CompressionMiddleware();