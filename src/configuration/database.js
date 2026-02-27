// src/configuration/database.js
const { Pool } = require('pg');
const logger = require('./logger');

class Database {
    constructor() {
        this.pool = null;
        this.connected = false;
    }

    /**
     * Initialiser la connexion à la base de données
     */
    async initialize() {
        try {
            this.pool = new Pool({
                host: process.env.DB_HOST || 'localhost',
                port: process.env.DB_PORT || 5432,
                database: process.env.DB_NAME || 'mon_projet',
                user: process.env.DB_USER || 'postgres',
                password: process.env.DB_PASSWORD,
                ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
                
                // Configuration du pool
                max: parseInt(process.env.DB_POOL_MAX) || 20,
                min: parseInt(process.env.DB_POOL_MIN) || 2,
                idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
                connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000,
                
                // Validation des connexions
                statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT) || 10000,
                query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT) || 10000
            });

            // Écouter les événements du pool
            this.pool.on('connect', (client) => {
                logger.debug('Nouvelle connexion PostgreSQL établie');
            });

            this.pool.on('error', (err, client) => {
                logger.error('Erreur inattendue du pool PostgreSQL:', err);
                this.connected = false;
            });

            this.pool.on('remove', (client) => {
                logger.debug('Connexion PostgreSQL retirée du pool');
            });

            // Tester la connexion
            await this.testConnection();

            this.connected = true;
            logger.info('Connexion à la base de données établie avec succès');

        } catch (error) {
            logger.error('Erreur lors de l\'initialisation de la base de données:', error);
            throw error;
        }
    }

    /**
     * Tester la connexion
     */
    async testConnection() {
        const client = await this.pool.connect();
        try {
            await client.query('SELECT NOW()');
            logger.info('Test de connexion PostgreSQL réussi');
        } finally {
            client.release();
        }
    }

    /**
     * Exécuter une requête SQL
     */
    async query(text, params = []) {
        const start = Date.now();
        
        try {
            const result = await this.pool.query(text, params);
            
            // Log des requêtes lentes (> 100ms)
            const duration = Date.now() - start;
            if (duration > 100) {

                const querySample = text.substring(0, 200);
                const paramsSample = params.length ? JSON.stringify(params).substring(0, 100) : '[]';

                logger.warn(`Requête lente (${duration}ms):`, {
                    query: querySample,
                    params: paramsSample,
                    rows: result.rowCount,
                    duration
                });

                if (global.metrics) {
                    global.metrics.histogram('db_query_duration', duration, {
                        table: this.extractTableName(text)
                    });
                }
            }

            return result;
        } catch (error) {
            logger.error(`Erreur SQL: ${error.message}`, {
                query: text.substring(0, 200),
                params: params
            });
            throw error;
        }
    }

    /**
     * TODO: Ajouter pool monitoring
     */

    async monitorPool() {
        setInterval(() => {
            const stats = this.getPoolStats();
            if (stats.waitingCount > 5) {
                logger.warn('Pool PostgreSQL congestionné', stats);
            }
            if (stats.idleCount < 2) {
                logger.info('Pool PostgreSQL proche de saturation', stats);
            }
        }, 60000); // Toutes les minutes
    }

    /**
     * Exécuter une requête avec transaction
     */
    async transaction(callback) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const result = await callback(client);
            
            await client.query('COMMIT');
            
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Obtenir un client du pool
     */
    async getClient() {
        return await this.pool.connect();
    }

    /**
     * Fermer toutes les connexions
     */
    async close() {
        try {
            await this.pool.end();
            this.connected = false;
            logger.info('Connexions à la base de données fermées');
        } catch (error) {
            logger.error('Erreur lors de la fermeture des connexions:', error);
            throw error;
        }
    }

    /**
     * Vérifier l'état de la connexion
     */
    isConnected() {
        return this.connected;
    }

    /**
     * Obtenir les statistiques du pool
     */
    getPoolStats() {
        return {
            totalCount: this.pool.totalCount,
            idleCount: this.pool.idleCount,
            waitingCount: this.pool.waitingCount,
            connected: this.connected
        };
    }

    /**
     * Exécuter une requête avec streaming
     */
    async queryStream(text, params = [], rowHandler) {
        const client = await this.pool.connect();
        
        try {
            const query = client.query(new (require('pg')).Query(text, params));
            
            query.on('row', (row) => {
                rowHandler(row);
            });

            return new Promise((resolve, reject) => {
                query.on('end', resolve);
                query.on('error', reject);
            });
        } finally {
            client.release();
        }
    }

    /**
     * Exécuter plusieurs requêtes en parallèle
     */
    async parallel(queries) {
        return await Promise.all(
            queries.map(({ text, params }) => this.query(text, params))
        );
    }

    /**
     * Vérifier si une table existe
     */
    async tableExists(tableName) {
        const result = await this.query(
            `SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = $1
            )`,
            [tableName]
        );
        return result.rows[0].exists;
    }

    /**
     * Obtenir la taille d'une table
     */
    async getTableSize(tableName) {
        const result = await this.query(
            `SELECT pg_size_pretty(pg_total_relation_size($1)) as size`,
            [tableName]
        );
        return result.rows[0].size;
    }

    /**
     * Sauvegarder l'état de la base de données
     */
    async healthCheck() {
        try {
            const start = Date.now();
            await this.query('SELECT 1');
            const latency = Date.now() - start;

            const stats = this.getPoolStats();

            return {
                status: 'healthy',
                connected: this.connected,
                latency: `${latency}ms`,
                pool: stats,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}

// Exporter une instance unique
module.exports = new Database(); 