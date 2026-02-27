// src/configuration/queue.js
const Bull = require('bull');
const logger = require('./logger');
const env = require('./env');

class QueueManager {
    constructor() {
        this.queues = new Map();
        this.workers = new Map();
        this.redisConfig = {
            redis: {
                host: env.REDIS_URL ? new URL(env.REDIS_URL).hostname : 'localhost',
                port: env.REDIS_URL ? parseInt(new URL(env.REDIS_URL).port) || 6379 : 6379,
                password: env.REDIS_PASSWORD,
                maxRetriesPerRequest: null,
                enableReadyCheck: false
            }
        };
    }

    /**
     * Initialiser toutes les files d'attente
     */
    initialize() {
        this.createQueue('email', {
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000
                },
                removeOnComplete: 100,
                removeOnFail: 200
            }
        });

        this.createQueue('notification', {
            defaultJobOptions: {
                attempts: 3,
                backoff: 5000,
                priority: 5
            }
        });

        this.createQueue('sms', {
            defaultJobOptions: {
                attempts: 2,
                timeout: 10000
            }
        });

        this.createQueue('export', {
            defaultJobOptions: {
                attempts: 1,
                timeout: 300000 // 5 minutes
            }
        });

        this.createQueue('image', {
            defaultJobOptions: {
                attempts: 2,
                timeout: 60000 // 1 minute
            }
        });

        this.createQueue('stats', {
            defaultJobOptions: {
                attempts: 2,
                priority: 3,
                delay: 5000
            }
        });

        this.createQueue('cleanup', {
            defaultJobOptions: {
                attempts: 1,
                repeat: {
                    cron: '0 2 * * *' // Tous les jours à 2h
                }
            }
        });

        logger.info('Files d\'attente initialisées');
    }

    /**
     * Créer une nouvelle file d'attente
     */
    createQueue(name, options = {}) {
        const queue = new Bull(name, this.redisConfig, options);
        
        // Écouter les événements
        queue.on('error', (error) => {
            logger.error(`Erreur file ${name}:`, error);
        });

        queue.on('waiting', (jobId) => {
            logger.debug(`Job ${jobId} en attente dans ${name}`);
        });

        queue.on('active', (job) => {
            logger.debug(`Job ${job.id} actif dans ${name}`);
        });

        queue.on('completed', (job, result) => {
            logger.debug(`Job ${job.id} terminé dans ${name}`, { result });
        });

        queue.on('failed', (job, error) => {
            logger.error(`Job ${job.id} échoué dans ${name}:`, error);
        });

        queue.on('stalled', (job) => {
            logger.warn(`Job ${job.id} bloqué dans ${name}`);
        });

        this.queues.set(name, queue);
        return queue;
    }

    /**
     * Obtenir une file d'attente
     */
    getQueue(name) {
        const queue = this.queues.get(name);
        if (!queue) {
            throw new Error(`File d'attente ${name} non trouvée`);
        }
        return queue;
    }

    /**
     * Ajouter un job à une file
     */
    async add(name, data, options = {}) {
        try {
            const queue = this.getQueue(name);
            const job = await queue.add(data, options);
            logger.debug(`Job ${job.id} ajouté à ${name}`);
            return job;
        } catch (error) {
            logger.error(`Erreur ajout job à ${name}:`, error);
            throw error;
        }
    }

    /**
     * Ajouter plusieurs jobs
     */
    async addBulk(name, jobs) {
        try {
            const queue = this.getQueue(name);
            const results = await queue.addBulk(jobs);
            logger.debug(`${results.length} jobs ajoutés à ${name}`);
            return results;
        } catch (error) {
            logger.error(`Erreur ajout bulk à ${name}:`, error);
            throw error;
        }
    }

    /**
     * Traiter une file d'attente
     */
    process(name, concurrency, processor) {
        const queue = this.getQueue(name);
        queue.process(concurrency, processor);
        this.workers.set(name, { concurrency, processor });
        logger.info(`Worker ${name} démarré avec ${concurrency} processus`);
    }

    /**
     * Obtenir le statut d'une file
     */
    async getQueueStatus(name) {
        const queue = this.getQueue(name);
        
        const [waiting, active, completed, failed, delayed] = await Promise.all([
            queue.getWaitingCount(),
            queue.getActiveCount(),
            queue.getCompletedCount(),
            queue.getFailedCount(),
            queue.getDelayedCount()
        ]);

        return {
            name,
            counts: {
                waiting,
                active,
                completed,
                failed,
                delayed,
                total: waiting + active + completed + failed + delayed
            },
            isPaused: await queue.isPaused()
        };
    }

    /**
     * Obtenir les statuts de toutes les files
     */
    async getAllStatus() {
        const status = {};
        
        for (const [name, queue] of this.queues) {
            status[name] = await this.getQueueStatus(name);
        }

        return status;
    }

    /**
     * Obtenir un job par son ID
     */
    async getJob(name, jobId) {
        const queue = this.getQueue(name);
        return await queue.getJob(jobId);
    }

    /**
     * Récupérer les jobs échoués
     */
    async getFailedJobs(name, start = 0, end = -1) {
        const queue = this.getQueue(name);
        return await queue.getFailed(start, end);
    }

    /**
     * Récupérer les jobs terminés
     */
    async getCompletedJobs(name, start = 0, end = -1) {
        const queue = this.getQueue(name);
        return await queue.getCompleted(start, end);
    }

    /**
     * Réessayer un job échoué
     */
    async retryJob(name, jobId) {
        const queue = this.getQueue(name);
        const job = await queue.getJob(jobId);
        
        if (job) {
            await job.retry();
            logger.info(`Job ${jobId} relancé dans ${name}`);
            return true;
        }

        return false;
    }

    /**
     * Réessayer tous les jobs échoués
     */
    async retryAll(name) {
        const queue = this.getQueue(name);
        const failed = await queue.getFailed();
        
        for (const job of failed) {
            await job.retry();
        }

        logger.info(`${failed.length} jobs relancés dans ${name}`);
        return failed.length;
    }

    /**
     * Supprimer un job
     */
    async removeJob(name, jobId) {
        const queue = this.getQueue(name);
        const job = await queue.getJob(jobId);
        
        if (job) {
            await job.remove();
            logger.info(`Job ${jobId} supprimé de ${name}`);
            return true;
        }

        return false;
    }

    /**
     * Nettoyer les vieux jobs
     */
    async clean(name, grace = 24 * 3600) { // 24h par défaut
        const queue = this.getQueue(name);
        
        const [completed, failed, delayed] = await Promise.all([
            queue.clean(grace * 1000, 'completed'),
            queue.clean(grace * 1000, 'failed'),
            queue.clean(grace * 1000, 'delayed')
        ]);

        logger.info(`Nettoyage ${name}: ${completed.length} completed, ${failed.length} failed, ${delayed.length} delayed`);
        
        return {
            completed: completed.length,
            failed: failed.length,
            delayed: delayed.length
        };
    }

    /**
     * Nettoyer toutes les files
     */
    async cleanAll(grace = 24 * 3600) {
        const results = {};
        
        for (const name of this.queues.keys()) {
            results[name] = await this.clean(name, grace);
        }

        return results;
    }

    /**
     * Mettre en pause une file
     */
    async pause(name) {
        const queue = this.getQueue(name);
        await queue.pause();
        logger.info(`File ${name} mise en pause`);
    }

    /**
     * Reprendre une file
     */
    async resume(name) {
        const queue = this.getQueue(name);
        await queue.resume();
        logger.info(`File ${name} reprise`);
    }

    /**
     * Vider une file
     */
    async empty(name) {
        const queue = this.getQueue(name);
        await queue.empty();
        logger.info(`File ${name} vidée`);
    }

    /**
     * Obtenir les métriques d'une file
     */
    async getMetrics(name) {
        const queue = this.getQueue(name);
        
        const metrics = await queue.getMetrics();
        
        return {
            name,
            metrics: {
                completed: metrics.completed,
                failed: metrics.failed,
                processed: metrics.processed,
                workers: Object.keys(metrics.workers || {}).length,
                jobsPerMinute: metrics.count
            }
        };
    }

    /**
     * Obtenir les métriques de toutes les files
     */
    async getAllMetrics() {
        const metrics = {};
        
        for (const name of this.queues.keys()) {
            metrics[name] = await this.getMetrics(name);
        }

        return metrics;
    }

    /**
     * Fermer toutes les files
     */
    async close() {
        for (const [name, queue] of this.queues) {
            await queue.close();
            logger.info(`File ${name} fermée`);
        }

        this.queues.clear();
        this.workers.clear();
    }

    /**
     * Obtenir la configuration Redis
     */
    getRedisConfig() {
        return this.redisConfig;
    }

    /**
     * Vérifier la santé des files
     */
    async healthCheck() {
        const status = {};
        let allHealthy = true;

        for (const [name, queue] of this.queues) {
            try {
                const client = await queue.client;
                await client.ping();
                
                const queueStatus = await this.getQueueStatus(name);
                
                status[name] = {
                    status: 'healthy',
                    ...queueStatus
                };
            } catch (error) {
                allHealthy = false;
                status[name] = {
                    status: 'unhealthy',
                    error: error.message
                };
            }
        }

        return {
            status: allHealthy ? 'healthy' : 'degraded',
            queues: status,
            timestamp: new Date().toISOString()
        };
    }
}

// Exporter une instance unique
module.exports = new QueueManager();