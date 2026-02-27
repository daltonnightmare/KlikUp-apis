// src/app.js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
// Swagger
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./configuration/swagger.js');

// Imports
const env = require('./configuration/env');
const logger = require('./configuration/logger');
const database = require('./configuration/database');
const redis = require('./configuration/redis');
const cache = require('./configuration/cache');
const queue = require('./configuration/queue');
const storage = require('./configuration/storage');
const routesV1 = require("./routes/index.js");
const errorHandler = require('./routes/middlewares/errorHandler.middleware'); // ← AJOUTÉ

class App {
    constructor() {
        this.app = express();
        this.port = env.PORT || 3000;
    }

    /**
     * Configurer les middlewares Express
     */
    config() {
        // Middlewares de base
        this.app.use(cors());
        this.app.use(helmet());
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
        
        // Logging des requêtes HTTP avec Morgan
        this.app.use(morgan('combined', {
            stream: {
                write: (message) => {
                    // Nettoyer le message et logger
                    const cleanMessage = message.trim();
                    if (cleanMessage) logger.http(cleanMessage);
                }
            }
        }));
        
        // Servir les fichiers statiques (CORRECTION: express.static au lieu de express.storage)
        this.app.use('/uploads', express.static(env.UPLOAD_PATH));
    }

    /**
     * Initialiser tous les services
     */
    async initializeServices() {
        logger.info('🚀 Démarrage de l\'application...');
        logger.info(`📊 Environnement: ${env.NODE_ENV}`);

        try {
            // 1. Base de données
            logger.info('📦 Connexion à la base de données...');
            await database.initialize();
            logger.info('✅ Base de données connectée');

            // 2. Redis (optionnel)
            if (env.REDIS_URL) {
                logger.info('🔴 Connexion à Redis...');
                await redis.initialize();
                logger.info('✅ Redis connecté');

                // Initialiser rateLimiter avec Redis
                const rateLimiter = require('./routes/middlewares/rateLimiter.middleware');
                await rateLimiter.initialize();
                logger.info('✅ RateLimiter initialisé avec Redis');
            } else {
                logger.warn('⚠️ Redis non configuré');
            }

            // 3. Cache local
            logger.info('💾 Initialisation du cache...');
            cache.initialize();
            logger.info('✅ Cache prêt');

            // 4. Stockage de fichiers
            logger.info('📁 Initialisation du stockage...');
            await storage.initialize();
            logger.info('✅ Stockage prêt');

            // 5. Files d'attente
            logger.info('⏳ Initialisation des queues...');
            queue.initialize();
            logger.info('✅ Queues prêtes');

            logger.info('🎉 Tous les services sont initialisés avec succès');
            
            return true;
        } catch (error) {
            logger.error('❌ Erreur lors de l\'initialisation des services:', error);
            throw error;
        }
    }

    /**
     * Configurer les routes
     */
    routes() {
        // Route de santé (doit être AVANT /api/v1 pour être accessible sans préfixe)
        this.app.get("/health", (req, res) => {
            res.status(200).json({
                status: 'OK',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                services: {
                    database: database.isConnected ? database.isConnected() : 'unknown',
                    redis: redis.isConnected ? redis.isConnected() : 'not_configured',
                    cache: 'healthy'
                }
            });
        });

        // Route ping
        this.app.get("/ping", (req, res) => {
            res.status(200).send('pong');
        });

        // Routes API versionnées
        this.app.use("/api/v1", routesV1);

        // Documentation Swagger
        this.app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
            explorer: true,
            customSiteTitle: 'Documentation API KlikUp',
            customCss: '.swagger-ui .topbar { background-color: #4CAF50; }',
            customfavIcon: 'https://klikup.com/favicon.ico',
            customJs: null,
            swaggerOptions: {
                persistAuthorization: true,
                displayRequestDuration: true,
                filter: true,
                showExtensions: true,
                tryItOutEnabled: true
            }
        }));

        // Route 404 (doit être APRÈS toutes les routes valides)
        this.app.use(errorHandler.notFound.bind(errorHandler));

        // Gestionnaire d'erreurs global (doit être le DERNIER middleware)
        this.app.use(errorHandler.handle.bind(errorHandler));

        
    }

    /**
     * Démarrer le serveur
     */
    async start() {
        try {
            // Initialiser les services d'abord
            await this.initializeServices();

            // Configurer les middlewares
            this.config();

            // Configurer les routes
            this.routes();

            // Démarrer le serveur
            this.server = this.app.listen(this.port, () => {
                logger.info(`🌍 Serveur démarré sur le port ${this.port}`);
                logger.info(`🔗 URL: http://localhost:${this.port}`);
                logger.info(`📚 Routes disponibles:`);
                logger.info(`   - GET  /health`);
                logger.info(`   - GET  /ping`);
                logger.info(`   - GET  /api/v1/public/health`);
                logger.info(`   - GET  /api-docs`);
            });

            // Gestion des signaux d'arrêt
            this.setupGracefulShutdown();

        } catch (error) {
            logger.error('❌ Échec du démarrage de l\'application:', error);
            process.exit(1);
        }
    }

    /**
     * Configurer l'arrêt gracieux
     */
    setupGracefulShutdown() {
        const gracefulShutdown = async (signal) => {
            logger.info(`🛑 Signal ${signal} reçu, arrêt gracieux...`);

            // Arrêter d'accepter de nouvelles requêtes
            if (this.server) {
                this.server.close(async () => {
                    logger.info('✅ Serveur HTTP fermé');

                    try {
                        // Fermer rateLimiter si initialisé
                        try {
                            const rateLimiter = require('./routes/middlewares/rateLimiter.middleware');
                            if (rateLimiter.close) {
                                await rateLimiter.close();
                                logger.info('✅ RateLimiter fermé');
                            }
                        } catch (e) {
                            // Ignorer si rateLimiter n'est pas disponible
                        }

                        // Fermer les connexions dans l'ordre inverse
                        await queue.close();
                        logger.info('✅ Queue fermée');

                        if (redis.isConnected && redis.isConnected()) {
                            await redis.close();
                            logger.info('✅ Redis fermé');
                        }

                        await database.close();
                        logger.info('✅ Base de données fermée');

                        logger.info('👋 Arrêt terminé');
                        process.exit(0);
                    } catch (error) {
                        logger.error('❌ Erreur lors de l\'arrêt:', error);
                        process.exit(1);
                    }
                });

                // Forcer l'arrêt après 10 secondes
                setTimeout(() => {
                    logger.error('❌ Arrêt forcé après timeout');
                    process.exit(1);
                }, 10000);
            }
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('uncaughtException', (error) => {
            logger.error('❌ Exception non capturée:', error);
            gracefulShutdown('uncaughtException');
        });
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('❌ Rejet non géré:', { reason, promise });
        });
    }

    /**
     * Obtenir l'instance Express
     */
    getApp() {
        return this.app;
    }
}

// Créer et démarrer l'application
const app = new App();
app.start().catch(error => {
    console.error('Erreur fatale:', error);
    process.exit(1);
});

module.exports = app.getApp();