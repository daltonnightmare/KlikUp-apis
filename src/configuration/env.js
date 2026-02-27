// src/configuration/env.js
const dotenv = require('dotenv');
const path = require('path');
const Joi = require('joi');
const logger = require('./logger');

class Environment {
    constructor() {
        this.loadEnvFile();
        this.validateEnv();
        this.setDefaults();
    }

    /**
     * Charger le fichier .env approprié
     */
    loadEnvFile() {
        const nodeEnv = process.env.NODE_ENV || 'development';
        const envPath = path.resolve(process.cwd(), `.env.${nodeEnv}`);

        try {
            const result = dotenv.config({ path: envPath });
            
            if (result.error) {
                // Fallback sur .env par défaut
                dotenv.config();
            }

            logger.info(`Environnement chargé: ${nodeEnv}`);
        } catch (error) {
            logger.warn('Aucun fichier .env trouvé, utilisation des variables système');
        }
    }

    /**
     * Valider les variables d'environnement
     */
    validateEnv() {
        const schema = Joi.object({
            // Serveur
            NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
            PORT: Joi.number().default(3000),
            HOST: Joi.string().default('localhost'),
            API_URL: Joi.string().uri().default('http://localhost:3000'),
            FRONTEND_URL: Joi.string().uri().default('http://localhost:4200'),

            // Base de données
            DB_HOST: Joi.string().default('localhost'),
            DB_PORT: Joi.number().default(5432),
            DB_NAME: Joi.string().required(),
            DB_USER: Joi.string().required(),
            DB_PASSWORD: Joi.string().required(),
            DB_SSL: Joi.boolean().default(false),
            DB_POOL_MAX: Joi.number().default(20),
            DB_POOL_MIN: Joi.number().default(2),

            // Redis
            REDIS_URL: Joi.string().uri().default('redis://localhost:6379'),
            REDIS_PASSWORD: Joi.string().optional(),

            // JWT
            JWT_SECRET: Joi.string().min(32).required(),
            JWT_REFRESH_SECRET: Joi.string().min(32).required(),
            JWT_EXPIRES_IN: Joi.string().default('24h'),
            JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

            // Services externes
            SMTP_HOST: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required() }),
            SMTP_PORT: Joi.number().default(587),
            SMTP_USER: Joi.string(),
            SMTP_PASSWORD: Joi.string(),
            SMTP_FROM: Joi.string().email().default('noreply@monprojet.com'),

            // SMS (Twilio)
            TWILIO_ACCOUNT_SID: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required() }),
            TWILIO_AUTH_TOKEN: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required() }),
            TWILIO_PHONE_NUMBER: Joi.string(),

            // Paiement (Orange Money, Moov, etc.)
            ORANGE_MONEY_API_KEY: Joi.string(),
            ORANGE_MONEY_SECRET: Joi.string(),
            MOOV_MONEY_API_KEY: Joi.string(),
            MOOV_MONEY_SECRET: Joi.string(),

            // Stockage fichiers
            STORAGE_DRIVER: Joi.string().valid('local', 's3').default('local'),
            AWS_ACCESS_KEY_ID: Joi.string().when('STORAGE_DRIVER', { is: 's3', then: Joi.required() }),
            AWS_SECRET_ACCESS_KEY: Joi.string().when('STORAGE_DRIVER', { is: 's3', then: Joi.required() }),
            AWS_REGION: Joi.string().when('STORAGE_DRIVER', { is: 's3', then: Joi.required() }),
            AWS_BUCKET: Joi.string().when('STORAGE_DRIVER', { is: 's3', then: Joi.required() }),

            // Sécurité
            CORS_WHITELIST: Joi.string().optional(),
            RATE_LIMIT_WINDOW: Joi.number().default(900000), // 15 minutes
            RATE_LIMIT_MAX: Joi.number().default(100),
            BCRYPT_ROUNDS: Joi.number().default(10),

            // Logging
            LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
            LOG_FILE: Joi.string().optional(),

            // Cache
            CACHE_TTL: Joi.number().default(3600), // 1 heure
            CACHE_CHECK_PERIOD: Joi.number().default(600), // 10 minutes

            // Features
            ENABLE_2FA: Joi.boolean().default(true),
            ENABLE_SIGNUP: Joi.boolean().default(true),
            MAINTENANCE_MODE: Joi.boolean().default(false)
        });

        const { error, value } = schema.validate(process.env, {
            allowUnknown: true,
            stripUnknown: true
        });

        if (error) {
            logger.error('Erreur de validation des variables d\'environnement:', error.message);
            throw new Error(`Configuration invalide: ${error.message}`);
        }

        Object.assign(this, value);
    }

    validateEnvironment() {
        const errors = [];

        if (this.isProduction()) {
            // Vérifications strictes en production
            if (!this.JWT_SECRET || this.JWT_SECRET.length < 32) {
                errors.push('JWT_SECRET doit être défini et avoir au moins 32 caractères en production');
            }
            if (!this.DB_PASSWORD) {
                errors.push('DB_PASSWORD requis en production');
            }
            if (this.NODE_ENV === 'production' && this.DB_SSL === false) {
                logger.warn('SSL non activé pour PostgreSQL en production - risque de sécurité');
            }
            // Vérifier que les secrets ne sont pas les valeurs par défaut
            if (this.JWT_SECRET?.includes('dev-secret')) {
                errors.push('JWT_SECRET utilise la valeur par défaut de développement en production');
            }
        }

        if (this.isDevelopment()) {
            // Recommandations pour le développement
            logger.info('Mode développement - certaines vérifications sont assouplies');
        }

        if (errors.length > 0) {
            logger.error('Erreurs de configuration environnement:', errors);
            throw new Error(`Configuration invalide: ${errors.join(', ')}`);
        }
    }

    /**
     * Définir les valeurs par défaut
     */
    setDefaults() {
        // URLs
        this.API_URL = process.env.API_URL || `http://${this.HOST}:${this.PORT}`;
        
        // Secrets (générer si non définis en dev)
        if (this.NODE_ENV === 'development') {
            if (!process.env.JWT_SECRET) {
                this.JWT_SECRET = 'KlikUp-dev-secret-key-change-in-production';
                this.JWT_REFRESH_SECRET = 'KlikUp-dev-refresh-secret-key-change-in-production';
            }
        }

        // Timeouts
        this.REQUEST_TIMEOUT = 30000; // 30 secondes
        this.UPLOAD_TIMEOUT = 60000; // 1 minute

        // Paths
        this.UPLOAD_PATH = path.join(process.cwd(), 'uploads');
        this.TEMP_PATH = path.join(process.cwd(), 'temp');
    }

    /**
     * Vérifier si on est en production
     */
    isProduction() {
        return this.NODE_ENV === 'production';
    }

    /**
     * Vérifier si on est en développement
     */
    isDevelopment() {
        return this.NODE_ENV === 'development';
    }

    /**
     * Vérifier si on est en test
     */
    isTest() {
        return this.NODE_ENV === 'test';
    }

    /**
     * Mode maintenance
     */
    isMaintenanceMode() {
        return this.MAINTENANCE_MODE === true;
    }

    /**
     * Obtenir la configuration complète
     */
    getConfig() {
        return {
            env: this.NODE_ENV,
            server: {
                port: this.PORT,
                host: this.HOST,
                url: this.API_URL
            },
            database: {
                host: this.DB_HOST,
                port: this.DB_PORT,
                name: this.DB_NAME,
                ssl: this.DB_SSL
            },
            redis: {
                url: this.REDIS_URL
            },
            jwt: {
                expiresIn: this.JWT_EXPIRES_IN,
                refreshExpiresIn: this.JWT_REFRESH_EXPIRES_IN
            }
        };
    }
}

module.exports = new Environment();