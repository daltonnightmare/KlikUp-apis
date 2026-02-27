// src/routes/middlewares/helmet.middleware.js
const helmet = require('helmet');

class HelmetMiddleware {
    /**
     * Configuration Helmet
     */
    get options() {
        return {
            // Content Security Policy
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
                    imgSrc: ["'self'", "data:", "https:"],
                    connectSrc: ["'self'", process.env.API_URL],
                    fontSrc: ["'self'", "https:", "data:"],
                    objectSrc: ["'none'"],
                    mediaSrc: ["'self'"],
                    frameSrc: ["'none'"],
                },
            },

            // Cross-Origin Embedder Policy
            crossOriginEmbedderPolicy: false,

            // Cross-Origin Opener Policy
            crossOriginOpenerPolicy: { policy: "same-origin" },

            // Cross-Origin Resource Policy
            crossOriginResourcePolicy: { policy: "same-site" },

            // DNS Prefetch Control
            dnsPrefetchControl: { allow: false },

            // Expect-CT
            expectCt: {
                maxAge: 86400,
                enforce: true,
                reportUri: process.env.EXPECT_CT_REPORT_URI
            },

            // Frameguard
            frameguard: { action: 'deny' },

            // Hide Powered-By
            hidePoweredBy: true,

            // HSTS
            hsts: {
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true
            },

            // IE No Open
            ieNoOpen: true,

            // No Sniff
            noSniff: true,

            // Origin-Agent-Cluster
            originAgentCluster: true,

            // Permissions Policy
            permissionsPolicy: {
                features: {
                    fullscreen: ["'self'"],
                    microphone: ["'none'"],
                    camera: ["'none'"],
                    geolocation: ["'self'"],
                    payment: ["'none'"],
                }
            },

            // Referrer Policy
            referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

            // XSS Filter
            xssFilter: true
        };
    }

    /**
     * Middleware Helmet complet
     */
    helmet() {
        return helmet(this.options);
    }

    /**
     * Configuration pour les environnements de développement
     */
    development() {
        return helmet({
            contentSecurityPolicy: false,
            crossOriginEmbedderPolicy: false,
        });
    }

    /**
     * Configuration minimale pour les APIs
     */
    minimal() {
        return helmet({
            contentSecurityPolicy: false,
            crossOriginEmbedderPolicy: false,
            crossOriginOpenerPolicy: false,
            frameguard: { action: 'deny' },
            hidePoweredBy: true,
            hsts: false,
            ieNoOpen: true,
            noSniff: true,
            referrerPolicy: { policy: 'no-referrer' },
            xssFilter: true
        });
    }
}

module.exports = new HelmetMiddleware();