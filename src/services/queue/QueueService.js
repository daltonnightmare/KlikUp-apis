const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const { FileTacheModel } = require('../../models');
const EmailService = require('../email/EmailService');
const SmsService = require('../sms/SmsService');
const PushService = require('../push/PushService');
const NotificationService = require('../notification/NotificationService');

class QueueService {
  constructor() {
    this.connection = null;
    this.queues = new Map();
    this.workers = new Map();
    this.initRedis();
  }

  /**
   * Initialiser la connexion Redis
   */
  initRedis() {
    if (process.env.REDIS_URL) {
      this.connection = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: null
      });
    }
  }

  /**
   * Obtenir ou créer une queue
   */
  getQueue(name) {
    if (!this.queues.has(name)) {
      const queue = new Queue(name, {
        connection: this.connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000
          },
          removeOnComplete: 100,
          removeOnFail: 500
        }
      });
      
      this.queues.set(name, queue);
    }
    
    return this.queues.get(name);
  }

  /**
   * Ajouter un job à la queue
   */
  async add(name, data, options = {}) {
    const queue = this.getQueue(name);
    
    const job = await queue.add(name, data, {
      attempts: options.attempts || 3,
      delay: options.delay || 0,
      priority: options.priority || 0,
      ...options
    });

    return job;
  }

  /**
   * Ajouter un job avec planification
   */
  async schedule(name, data, date) {
    return this.add(name, data, {
      delay: Math.max(0, date.getTime() - Date.now())
    });
  }

  /**
   * Ajouter un job récurrent
   */
  async addRepeatable(name, data, pattern) {
    const queue = this.getQueue(name);
    
    const job = await queue.add(name, data, {
      repeat: {
        pattern
      }
    });

    return job;
  }

  /**
   * Initialiser tous les workers
   */
  initWorkers() {
    this.initEmailWorker();
    this.initSmsWorker();
    this.initPushWorker();
    this.initNotificationWorker();
    this.initDatabaseWorker();
  }

  /**
   * Worker pour les emails
   */
  initEmailWorker() {
    const worker = new Worker('email', async job => {
      const { to, subject, html, options } = job.data;
      
      try {
        const result = await EmailService.sendEmail(to, subject, html, options);
        return result;
      } catch (error) {
        console.error('Erreur worker email:', error);
        throw error;
      }
    }, { connection: this.connection });

    worker.on('completed', job => {
      console.log(`Email job ${job.id} complété`);
    });

    worker.on('failed', (job, err) => {
      console.error(`Email job ${job.id} échoué:`, err);
    });

    this.workers.set('email', worker);
  }

  /**
   * Worker pour les SMS
   */
  initSmsWorker() {
    const worker = new Worker('sms', async job => {
      const { to, message, options } = job.data;
      
      try {
        const result = await SmsService.sendSms(to, message, options);
        return result;
      } catch (error) {
        console.error('Erreur worker sms:', error);
        throw error;
      }
    }, { connection: this.connection });

    worker.on('completed', job => {
      console.log(`SMS job ${job.id} complété`);
    });

    worker.on('failed', (job, err) => {
      console.error(`SMS job ${job.id} échoué:`, err);
    });

    this.workers.set('sms', worker);
  }

  /**
   * Worker pour les notifications push
   */
  initPushWorker() {
    const worker = new Worker('push', async job => {
      const { compteId, notification, data } = job.data;
      
      try {
        const result = await PushService.sendToUser(compteId, notification, data);
        return result;
      } catch (error) {
        console.error('Erreur worker push:', error);
        throw error;
      }
    }, { connection: this.connection });

    worker.on('completed', job => {
      console.log(`Push job ${job.id} complété`);
    });

    worker.on('failed', (job, err) => {
      console.error(`Push job ${job.id} échoué:`, err);
    });

    this.workers.set('push', worker);
  }

  /**
   * Worker pour les notifications
   */
  initNotificationWorker() {
    const worker = new Worker('notification', async job => {
      const notification = job.data;
      
      try {
        const result = await NotificationService.send(notification);
        return result;
      } catch (error) {
        console.error('Erreur worker notification:', error);
        throw error;
      }
    }, { connection: this.connection });

    worker.on('completed', job => {
      console.log(`Notification job ${job.id} complété`);
    });

    worker.on('failed', (job, err) => {
      console.error(`Notification job ${job.id} échoué:`, err);
    });

    this.workers.set('notification', worker);
  }

  /**
   * Worker pour les tâches base de données
   */
  initDatabaseWorker() {
    const worker = new Worker('database', async job => {
      const { type, data } = job.data;
      
      switch (type) {
        case 'REFRESH_MATERIALIZED_VIEW':
          await this.refreshMaterializedView(data.viewName);
          break;
          
        case 'CLEAN_EXPIRED_SESSIONS':
          const { SessionModel } = require('../../models');
          await SessionModel.cleanExpired();
          break;
          
        case 'PROCESS_EXPIRED_DOCUMENTS':
          const { DocumentModel } = require('../../models');
          await DocumentModel.traiterExpirations();
          break;
          
        case 'PROCESS_EXPIRED_POINTS':
          const { SoldeFideliteModel } = require('../../models');
          await SoldeFideliteModel.traiterExpirations();
          break;
          
        default:
          console.warn(`Type de tâche inconnu: ${type}`);
      }
      
      return { processed: true, type };
    }, { connection: this.connection });

    worker.on('completed', job => {
      console.log(`Database job ${job.id} complété`);
    });

    worker.on('failed', (job, err) => {
      console.error(`Database job ${job.id} échoué:`, err);
    });

    this.workers.set('database', worker);
  }

  /**
   * Rafraîchir une vue matérialisée
   */
  async refreshMaterializedView(viewName) {
    const { Database } = require('../../models');
    await Database.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName}`);
  }

  /**
   * Obtenir le statut d'un job
   */
  async getJobStatus(queueName, jobId) {
    const queue = this.getQueue(queueName);
    const job = await queue.getJob(jobId);
    
    if (!job) return null;
    
    const state = await job.getState();
    
    return {
      id: job.id,
      name: job.name,
      data: job.data,
      state,
      progress: job.progress,
      attempts: job.attemptsMade,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason,
      stacktrace: job.stacktrace
    };
  }

  /**
   * Obtenir les jobs d'une queue
   */
  async getJobs(queueName, states = ['active', 'waiting', 'completed', 'failed']) {
    const queue = this.getQueue(queueName);
    const jobs = await queue.getJobs(states);
    
    return Promise.all(
      jobs.map(async job => ({
        ...job,
        state: await job.getState()
      }))
    );
  }

  /**
   * Supprimer un job
   */
  async removeJob(queueName, jobId) {
    const queue = this.getQueue(queueName);
    const job = await queue.getJob(jobId);
    
    if (job) {
      await job.remove();
      return true;
    }
    
    return false;
  }

  /**
   * Vider une queue
   */
  async cleanQueue(queueName) {
    const queue = this.getQueue(queueName);
    await queue.drain();
    return true;
  }

  /**
   * Obtenir les statistiques d'une queue
   */
  async getQueueStats(queueName) {
    const queue = this.getQueue(queueName);
    
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount()
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed
    };
  }

  /**
   * Fermer toutes les connexions
   */
  async close() {
    for (const worker of this.workers.values()) {
      await worker.close();
    }
    
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    
    if (this.connection) {
      await this.connection.quit();
    }
  }
}

module.exports = new QueueService();