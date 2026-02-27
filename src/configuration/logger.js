// src/configuration/logger.js
const winston = require('winston');
const path = require('path');
const DailyRotateFile = require('winston-daily-rotate-file');

class Logger {
    constructor() {
        this.logger = this.createLogger();
    }

    /**
     * Créer le logger Winston
     */
    createLogger() {
        const { combine, timestamp, printf, colorize, json } = winston.format;

        // Format personnalisé pour la console
        const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
            let msg = `${timestamp} [${level}] : ${message}`;
            
            if (Object.keys(metadata).length > 0) {
                msg += ` ${JSON.stringify(metadata)}`;
            }
            
            return msg;
        });

        // Déterminer le niveau de log depuis process.env directement
        const nodeEnv = process.env.NODE_ENV || 'development';
        const logLevel = nodeEnv === 'development' ? 'debug' : (process.env.LOG_LEVEL || 'info');

        // Configuration des transports
        const transports = [];

        // Console toujours active
        transports.push(new winston.transports.Console({
            format: combine(
                colorize(),
                timestamp(),
                consoleFormat
            ),
            level: logLevel  // CORRIGÉ: utiliser logLevel au lieu de env.isDevelopment()
        }));

        // Fichier de log journalier
        if (process.env.LOG_FILE) {
            const logDir = path.dirname(process.env.LOG_FILE);
            
            transports.push(new DailyRotateFile({
                filename: path.join(logDir, 'application-%DATE%.log'),
                datePattern: 'YYYY-MM-DD',
                maxSize: process.env.LOG_MAX_SIZE || '20m',
                maxFiles: process.env.LOG_MAX_FILES || '14d',
                format: combine(
                    timestamp(),
                    json()
                ),
                level: logLevel  // CORRIGÉ: utiliser logLevel
            }));

            // Fichier séparé pour les erreurs
            transports.push(new DailyRotateFile({
                filename: path.join(logDir, 'error-%DATE%.log'),
                datePattern: 'YYYY-MM-DD',
                maxSize: process.env.LOG_MAX_SIZE || '20m',
                maxFiles: '30d',
                format: combine(
                    timestamp(),
                    json()
                ),
                level: 'error'
            }));
        }

        // Gestionnaires d'exceptions
        const exceptionHandlers = [
            new winston.transports.Console({
                format: combine(
                    colorize(),
                    timestamp(),
                    consoleFormat
                )
            })
        ];

        // Ajouter le fichier pour les exceptions si LOG_FILE est défini
        if (process.env.LOG_FILE) {
            const logDir = path.dirname(process.env.LOG_FILE);
            exceptionHandlers.push(
                new winston.transports.File({ 
                    filename: path.join(logDir, 'exceptions.log') 
                })
            );
        }

        // Gestionnaires de rejet
        const rejectionHandlers = [
            new winston.transports.Console({
                format: combine(
                    colorize(),
                    timestamp(),
                    consoleFormat
                )
            })
        ];

        // Ajouter le fichier pour les rejets si LOG_FILE est défini
        if (process.env.LOG_FILE) {
            const logDir = path.dirname(process.env.LOG_FILE);
            rejectionHandlers.push(
                new winston.transports.File({ 
                    filename: path.join(logDir, 'rejections.log') 
                })
            );
        }

        return winston.createLogger({
            level: logLevel,
            format: combine(
                timestamp(),
                json()
            ),
            transports,
            exceptionHandlers,
            rejectionHandlers
        });
    }

    createRequestLogger(req, res, next) {
        // Générer ou récupérer ID de corrélation
        req.correlationId = req.headers['x-correlation-id'] || req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        res.setHeader('x-correlation-id', req.correlationId);
        
        // Logger contextuel pour cette requête
        req.log = this.context(`[${req.correlationId}]`);
        
        // Log de début de requête
        req.log.info(`${req.method} ${req.url} - Début`);
        
        next();
    }

    /**
     * TODO: Améliorer le logging structuré
     */

    logWithCorrelation(level, message, metadata = {}, correlationId = null) {
        const enrichedMetadata = {
            ...metadata,
            correlationId: correlationId || metadata.correlationId,
            service: 'klikup-api',
            environment: process.env.NODE_ENV,
            hostname: require('os').hostname(),
            pid: process.pid
        };
        this.logger[level](message, enrichedMetadata);
    }

    /**
     * Log niveau info
     */
    info(message, metadata = {}) {
        this.logger.info(message, metadata);
    }

    /**
     * Log niveau error
     */
    error(message, metadata = {}) {
        this.logger.error(message, metadata);
    }

    /**
     * Log niveau warn
     */
    warn(message, metadata = {}) {
        this.logger.warn(message, metadata);
    }

    /**
     * Log niveau debug
     */
    debug(message, metadata = {}) {
        this.logger.debug(message, metadata);
    }

    /**
     * Log niveau verbose
     */
    verbose(message, metadata = {}) {
        this.logger.verbose(message, metadata);
    }

    // src/configuration/logger.js - Remplacer la méthode http

    /**
     * Log une requête HTTP - VERSION ROBUSTE
     */
    http(req, res, responseTime) {
        try {
            // ✅ Vérifications de sécurité
            if (!req || !res) {
                this.debug('Tentative de log HTTP avec req/res manquants');
                return;
            }

            const method = req.method || 'UNKNOWN';
            const url = req.url || req.originalUrl || 'UNKNOWN';
            const statusCode = res.statusCode || res.status || 200;
            
            const message = `${method} ${url} - ${statusCode} - ${responseTime || 0}ms`;
            
            const metadata = {
                method,
                url,
                status: statusCode,
                responseTime: responseTime || 0,
                ip: req.ip || req.connection?.remoteAddress || 'unknown',
                userAgent: req.get ? req.get('user-agent') : 'unknown',
                userId: req.user?.id
            };

            if (statusCode >= 500) {
                this.error(message, metadata);
            } else if (statusCode >= 400) {
                this.warn(message, metadata);
            } else {
                this.info(message, metadata);
            }
        } catch (error) {
            // Ne pas planter à cause d'une erreur de log
            this.debug('Erreur dans http logger:', { error: error.message });
        }
    }

    /**
     * Log une action utilisateur
     */
    userAction(userId, action, details = {}) {
        this.info(`Action utilisateur: ${action}`, {
            userId,
            action,
            ...details,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Log une transaction
     */
    transaction(transactionData) {
        this.info('Transaction', {
            type: 'transaction',
            ...transactionData,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Log une alerte de sécurité
     */
    security(alert, details = {}) {
        this.warn(`Alerte sécurité: ${alert}`, {
            type: 'security',
            alert,
            ...details,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Log une performance
     */
    performance(operation, duration, metadata = {}) {
        if (duration > 1000) {
            this.warn(`Performance lente: ${operation}`, {
                type: 'performance',
                operation,
                duration,
                ...metadata
            });
        } else {
            this.debug(`Performance: ${operation}`, {
                type: 'performance',
                operation,
                duration,
                ...metadata
            });
        }
    }

    /**
     * Créer un logger contextuel
     */
    context(contextName) {
        return {
            info: (message, metadata = {}) => this.info(`[${contextName}] ${message}`, metadata),
            error: (message, metadata = {}) => this.error(`[${contextName}] ${message}`, metadata),
            warn: (message, metadata = {}) => this.warn(`[${contextName}] ${message}`, metadata),
            debug: (message, metadata = {}) => this.debug(`[${contextName}] ${message}`, metadata)
        };
    }

    /**
     * Obtenir le logger Winston sous-jacent
     */
    getWinstonLogger() {
        return this.logger;
    }

    /**
     * Nettoyer les anciens logs
     */
    async cleanup() {
        // Implémentation si nécessaire
    }
}

module.exports = new Logger();