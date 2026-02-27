```markdown
# Module de Gestion des Files d'Attente - queue.js

## 📋 Vue d'ensemble

Ce module fournit un système complet de gestion de files d'attente basé sur **Bull** (Redis). Il permet de traiter des tâches asynchrones de manière fiable avec persistance, retries, priorités, et monitoring. Idéal pour les emails, notifications, traitements d'images, exports, etc.

## 🏗️ Architecture

### Classe `QueueManager`

La classe principale qui encapsule toute la logique de gestion des files d'attente.

#### Constructeur
```javascript
constructor()
```
Initialise le gestionnaire avec :
- `queues` : Map des files d'attente Bull
- `workers` : Map des workers actifs
- `redisConfig` : Configuration Redis basée sur les variables d'environnement

## 🔧 Fonctionnalités principales

### 1. Configuration Redis

```javascript
this.redisConfig = {
    redis: {
        host: env.REDIS_URL ? new URL(env.REDIS_URL).hostname : 'localhost',
        port: env.REDIS_URL ? parseInt(new URL(env.REDIS_URL).port) || 6379 : 6379,
        password: env.REDIS_PASSWORD,
        maxRetriesPerRequest: null,  // Important pour Bull
        enableReadyCheck: false
    }
};
```

### 2. Files d'attente prédéfinies

| Nom | Description | Configuration |
|-----|-------------|---------------|
| **email** | Envoi d'emails | 3 tentatives, backoff exponentiel |
| **notification** | Notifications push | 3 tentatives, priorité 5 |
| **sms** | Envoi de SMS | 2 tentatives, timeout 10s |
| **export** | Exports de données | 1 tentative, timeout 5min |
| **image** | Traitement d'images | 2 tentatives, timeout 1min |
| **stats** | Calcul de statistiques | 2 tentatives, délai 5s |
| **cleanup** | Nettoyage quotidien | Cron: tous les jours à 2h |

### 3. Événements surveillés

Bull émet des événements que le manager écoute :

| Événement | Description | Action |
|-----------|-------------|--------|
| `error` | Erreur Redis/file | Log error |
| `waiting` | Job en attente | Log debug |
| `active` | Job en cours | Log debug |
| `completed` | Job terminé | Log debug + résultat |
| `failed` | Job échoué | Log error |
| `stalled` | Job bloqué | Log warn |

### 4. Opérations principales

| Méthode | Description |
|---------|-------------|
| `initialize()` | Initialise toutes les files |
| `createQueue(name, options)` | Crée une nouvelle file |
| `getQueue(name)` | Récupère une file |
| `add(name, data, options)` | Ajoute un job |
| `addBulk(name, jobs)` | Ajoute plusieurs jobs |
| `process(name, concurrency, processor)` | Traite une file |
| `close()` | Ferme toutes les files |

### 5. Gestion des jobs

| Méthode | Description |
|---------|-------------|
| `getJob(name, jobId)` | Récupère un job |
| `getFailedJobs(name)` | Jobs échoués |
| `getCompletedJobs(name)` | Jobs terminés |
| `retryJob(name, jobId)` | Relance un job |
| `retryAll(name)` | Relance tous les jobs échoués |
| `removeJob(name, jobId)` | Supprime un job |

### 6. Monitoring et contrôle

| Méthode | Description |
|---------|-------------|
| `getQueueStatus(name)` | Statut d'une file |
| `getAllStatus()` | Statuts de toutes les files |
| `getMetrics(name)` | Métriques détaillées |
| `pause(name)` | Met en pause |
| `resume(name)` | Reprend |
| `empty(name)` | Vide la file |
| `clean(name, grace)` | Nettoie les vieux jobs |
| `healthCheck()` | Vérification santé |

## 📦 Installation et configuration

### Prérequis
```bash
npm install bull
# Redis doit être installé et en cours d'exécution
```

### Configuration dans `.env`

```env
# Redis
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=optional_password

# Optionnel - Configuration spécifique Bull
BULL_PREFIX=bull
BULL_MAX_RETRIES=3
```

## 🚀 Utilisation

### Initialisation

```javascript
// Dans app.js ou server.js
const queueManager = require('./configuration/queue');

async function startServer() {
    try {
        // Initialiser les files d'attente
        queueManager.initialize();
        
        // Démarrer les workers
        setupWorkers();
        
        app.listen(3000);
    } catch (error) {
        logger.error('Erreur démarrage:', error);
    }
}

function setupWorkers() {
    // Worker pour les emails
    queueManager.process('email', 5, async (job) => {
        const { to, subject, html } = job.data;
        await emailService.send(to, subject, html);
    });

    // Worker pour les notifications
    queueManager.process('notification', 10, async (job) => {
        const { userId, type, data } = job.data;
        await notificationService.send(userId, type, data);
    });

    // Worker pour le traitement d'images
    queueManager.process('image', 3, async (job) => {
        const { imagePath, operations } = job.data;
        await imageProcessor.process(imagePath, operations);
    });
}
```

### Ajout de jobs

```javascript
// Contrôleur d'inscription
async function registerUser(req, res) {
    try {
        const user = await User.create(req.body);
        
        // Ajouter des jobs asynchrones
        await queueManager.add('email', {
            to: user.email,
            subject: 'Bienvenue !',
            html: welcomeTemplate(user)
        }, {
            delay: 5000, // Envoyer après 5 secondes
            attempts: 3
        });

        await queueManager.add('notification', {
            userId: user.id,
            type: 'welcome',
            data: { name: user.name }
        });

        await queueManager.add('stats', {
            event: 'new_user',
            userId: user.id,
            timestamp: new Date()
        });

        res.status(201).json(user);
    } catch (error) {
        next(error);
    }
}

// Ajout avec priorité
await queueManager.add('email', emailData, {
    priority: 10  // Plus bas = plus prioritaire
});

// Ajout avec délai
await queueManager.add('notification', notificationData, {
    delay: 3600000  // Dans 1 heure
});

// Job répétitif (toutes les heures)
await queueManager.add('cleanup', {}, {
    repeat: {
        every: 3600000
    }
});

// Ajout en masse
await queueManager.addBulk('email', [
    { data: { to: 'user1@test.com', subject: 'Newsletter' } },
    { data: { to: 'user2@test.com', subject: 'Newsletter' } },
    { data: { to: 'user3@test.com', subject: 'Newsletter' } }
]);
```

### Exemples concrets

#### Service d'envoi d'emails

```javascript
// services/emailService.js
const queueManager = require('../configuration/queue');
const logger = require('./logger');

class EmailService {
    async sendWelcomeEmail(user) {
        return await queueManager.add('email', {
            type: 'welcome',
            to: user.email,
            subject: 'Bienvenue sur notre plateforme',
            html: this.getWelcomeTemplate(user),
            userId: user.id
        }, {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 2000
            }
        });
    }

    async sendPasswordReset(email, token) {
        return await queueManager.add('email', {
            type: 'password_reset',
            to: email,
            subject: 'Réinitialisation de mot de passe',
            html: this.getResetTemplate(token),
            priority: 1  // Haute priorité
        });
    }

    async sendNewsletter(subscribers, content) {
        // Diviser en lots pour éviter de surcharger
        const batches = this.chunkArray(subscribers, 100);
        
        for (const batch of batches) {
            await queueManager.addBulk('email', batch.map(sub => ({
                data: {
                    type: 'newsletter',
                    to: sub.email,
                    subject: content.subject,
                    html: content.html
                },
                opts: {
                    attempts: 2,
                    delay: 1000 // Espacer les lots
                }
            })));
        }
    }

    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
}
```

#### Traitement d'images

```javascript
// services/imageProcessor.js
const sharp = require('sharp');
const queueManager = require('../configuration/queue');
const path = require('path');

class ImageProcessor {
    constructor() {
        // Configurer le worker au démarrage
        queueManager.process('image', 2, this.processImage.bind(this));
    }

    async processImage(job) {
        const { imagePath, sizes, formats } = job.data;
        const results = [];

        for (const size of sizes) {
            for (const format of formats) {
                const outputPath = this.getOutputPath(imagePath, size, format);
                
                let pipeline = sharp(imagePath)
                    .resize(size.width, size.height, {
                        fit: 'cover',
                        position: 'center'
                    });

                if (format === 'webp') {
                    pipeline = pipeline.webp({ quality: 80 });
                } else if (format === 'jpeg') {
                    pipeline = pipeline.jpeg({ quality: 85 });
                }

                await pipeline.toFile(outputPath);
                
                results.push({
                    size,
                    format,
                    path: outputPath
                });

                // Mettre à jour la progression
                const progress = (results.length / (sizes.length * formats.length)) * 100;
                await job.progress(progress);
            }
        }

        return results;
    }

    getOutputPath(originalPath, size, format) {
        const parsed = path.parse(originalPath);
        return path.join(
            parsed.dir,
            `${parsed.name}-${size.width}x${size.height}.${format}`
        );
    }

    async queueImageProcessing(imagePath, options = {}) {
        const defaultOptions = {
            sizes: [
                { width: 200, height: 200 },
                { width: 600, height: 600 },
                { width: 1200, height: 1200 }
            ],
            formats: ['jpeg', 'webp'],
            priority: 5
        };

        const jobOptions = { ...defaultOptions, ...options };

        return await queueManager.add('image', {
            imagePath,
            ...jobOptions
        }, {
            priority: jobOptions.priority,
            timeout: 300000 // 5 minutes max
        });
    }
}
```

#### Export de données

```javascript
// services/exportService.js
const queueManager = require('../configuration/queue');
const ExcelJS = require('exceljs');
const fs = require('fs');

class ExportService {
    constructor() {
        queueManager.process('export', 1, this.processExport.bind(this));
    }

    async queueExport(userId, type, filters) {
        const exportId = `export_${Date.now()}_${userId}`;
        
        await queueManager.add('export', {
            exportId,
            userId,
            type,
            filters,
            requestedAt: new Date()
        }, {
            jobId: exportId,  // ID unique pour éviter les doublons
            attempts: 2
        });

        return exportId;
    }

    async processExport(job) {
        const { exportId, userId, type, filters } = job.data;
        
        // Mettre à jour la progression
        await job.progress(10);

        // Récupérer les données
        let data;
        let workbook = new ExcelJS.Workbook();
        let worksheet = workbook.addWorksheet('Export');

        if (type === 'users') {
            data = await this.getUsersData(filters);
        } else if (type === 'orders') {
            data = await this.getOrdersData(filters);
        }

        await job.progress(50);

        // Générer l'Excel
        worksheet.columns = data.columns;
        worksheet.addRows(data.rows);

        // Sauvegarder
        const filePath = `/tmp/exports/${exportId}.xlsx`;
        await workbook.xlsx.writeFile(filePath);

        await job.progress(90);

        // Uploader vers S3 ou stockage permanent
        const url = await this.uploadToStorage(filePath, `${exportId}.xlsx`);

        // Nettoyer le fichier temporaire
        fs.unlinkSync(filePath);

        await job.progress(100);

        // Notifier l'utilisateur
        await queueManager.add('notification', {
            userId,
            type: 'export_completed',
            data: {
                exportId,
                url,
                type
            }
        });

        return { exportId, url };
    }
}
```

#### Notifications en masse

```javascript
// services/bulkNotificationService.js
const queueManager = require('../configuration/queue');

class BulkNotificationService {
    async sendPromotionToAllUsers(promotion) {
        // Récupérer tous les utilisateurs (par lots)
        let offset = 0;
        const batchSize = 1000;
        let totalSent = 0;

        while (true) {
            const users = await User.find({
                limit: batchSize,
                offset,
                where: { notificationsEnabled: true }
            });

            if (users.length === 0) break;

            // Créer les jobs pour ce lot
            const jobs = users.map(user => ({
                data: {
                    userId: user.id,
                    promotion: promotion.id,
                    channel: user.preferredChannel
                },
                opts: {
                    attempts: 3,
                    priority: user.isVip ? 1 : 5
                }
            }));

            await queueManager.addBulk('notification', jobs);
            
            totalSent += users.length;
            offset += batchSize;

            // Petite pause pour ne pas surcharger
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        logger.info(`${totalSent} notifications promotionnelles ajoutées`);
    }
}
```

#### Cleanup automatisé

```javascript
// jobs/cleanupJobs.js
const queueManager = require('../configuration/queue');
const { Op } = require('sequelize');

// Worker de nettoyage
queueManager.process('cleanup', 1, async (job) => {
    logger.info('Début du nettoyage quotidien');

    // Nettoyer les vieux logs
    const oldLogs = await Log.destroy({
        where: {
            createdAt: {
                [Op.lt]: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // 90 jours
            }
        }
    });
    logger.info(`${oldLogs} vieux logs supprimés`);

    // Nettoyer les sessions expirées
    const expiredSessions = await Session.destroy({
        where: {
            expiresAt: {
                [Op.lt]: new Date()
            }
        }
    });
    logger.info(`${expiredSessions} sessions expirées supprimées`);

    // Nettoyer les fichiers temporaires
    const tempFiles = await this.cleanTempFiles();
    logger.info(`${tempFiles} fichiers temporaires supprimés`);

    // Nettoyer les vieux jobs des files
    const cleanResults = await queueManager.cleanAll(7 * 24 * 3600); // 7 jours
    
    logger.info('Nettoyage des files terminé', cleanResults);

    return {
        logs: oldLogs,
        sessions: expiredSessions,
        tempFiles,
        queues: cleanResults
    };
});
```

## 📊 Monitoring et administration

### Interface d'administration

```javascript
// routes/admin/queues.js
const express = require('express');
const router = express.Router();
const queueManager = require('../../configuration/queue');
const { authorize } = require('../../middleware/auth');

router.get('/queues/status', authorize('admin'), async (req, res) => {
    const status = await queueManager.getAllStatus();
    res.json(status);
});

router.get('/queues/:name/jobs/failed', authorize('admin'), async (req, res) => {
    const jobs = await queueManager.getFailedJobs(req.params.name);
    res.json(jobs);
});

router.post('/queues/:name/retry-all', authorize('admin'), async (req, res) => {
    const count = await queueManager.retryAll(req.params.name);
    res.json({ message: `${count} jobs relancés` });
});

router.post('/queues/:name/pause', authorize('admin'), async (req, res) => {
    await queueManager.pause(req.params.name);
    res.json({ message: 'File mise en pause' });
});

router.post('/queues/:name/resume', authorize('admin'), async (req, res) => {
    await queueManager.resume(req.params.name);
    res.json({ message: 'File reprise' });
});

router.delete('/queues/:name/jobs/:jobId', authorize('admin'), async (req, res) => {
    const deleted = await queueManager.removeJob(req.params.name, req.params.jobId);
    res.json({ deleted });
});

router.post('/queues/:name/clean', authorize('admin'), async (req, res) => {
    const grace = req.body.grace || 24 * 3600;
    const result = await queueManager.clean(req.params.name, grace);
    res.json(result);
});

module.exports = router;
```

### Dashboard avec métriques

```javascript
// services/queueDashboard.js
const queueManager = require('../configuration/queue');

class QueueDashboard {
    async getDashboardData() {
        const [status, metrics, health] = await Promise.all([
            queueManager.getAllStatus(),
            queueManager.getAllMetrics(),
            queueManager.healthCheck()
        ]);

        // Calculer les totaux
        let totalJobs = 0;
        let totalFailed = 0;
        
        Object.values(status).forEach(q => {
            totalJobs += q.counts.total;
            totalFailed += q.counts.failed;
        });

        return {
            health,
            summary: {
                totalQueues: Object.keys(status).length,
                totalJobs,
                totalFailed,
                failureRate: totalJobs ? ((totalFailed / totalJobs) * 100).toFixed(2) + '%' : '0%',
                timestamp: new Date()
            },
            queues: status,
            metrics
        };
    }

    async getQueueChartData(name, days = 7) {
        const queue = queueManager.getQueue(name);
        const end = Date.now();
        const start = end - (days * 24 * 60 * 60 * 1000);
        
        const metrics = await queue.getMetrics(start, end);
        
        return {
            labels: metrics.map(m => new Date(m.timestamp).toLocaleDateString()),
            completed: metrics.map(m => m.completed),
            failed: metrics.map(m => m.failed),
            waiting: metrics.map(m => m.waiting)
        };
    }
}
```

### Script de monitoring

```javascript
// scripts/monitor-queues.js
const queueManager = require('../src/configuration/queue');

async function monitorQueues() {
    try {
        // Vérifier la santé
        const health = await queueManager.healthCheck();
        console.log('Santé des files:', health);

        if (health.status === 'degraded') {
            console.warn('⚠️ Certaines files sont dégradées');
        }

        // Obtenir les statuts
        const status = await queueManager.getAllStatus();
        
        console.log('\n📊 Statuts des files:');
        for (const [name, data] of Object.entries(status)) {
            console.log(`\n${name}:`);
            console.log(`  En attente: ${data.counts.waiting}`);
            console.log(`  Actifs: ${data.counts.active}`);
            console.log(`  Terminés: ${data.counts.completed}`);
            console.log(`  Échoués: ${data.counts.failed}`);
            console.log(`  Total: ${data.counts.total}`);
            console.log(`  En pause: ${data.isPaused ? 'Oui' : 'Non'}`);
        }

        // Vérifier les jobs échoués
        console.log('\n❌ Jobs échoués récents:');
        for (const name of Object.keys(status)) {
            const failed = await queueManager.getFailedJobs(name, 0, 5);
            if (failed.length > 0) {
                console.log(`\n${name} (${failed.length}):`);
                failed.forEach(job => {
                    console.log(`  - Job ${job.id}: ${job.failedReason}`);
                });
            }
        }

    } catch (error) {
        console.error('Erreur monitoring:', error);
    }
}

monitorQueues();
```

## 🧪 Tests

### Tests unitaires

```javascript
// tests/queue.test.js
const queueManager = require('../src/configuration/queue');
const Bull = require('bull');

// Mock Bull
jest.mock('bull', () => {
    const mQueue = {
        process: jest.fn(),
        add: jest.fn(),
        addBulk: jest.fn(),
        getWaitingCount: jest.fn(),
        getActiveCount: jest.fn(),
        getCompletedCount: jest.fn(),
        getFailedCount: jest.fn(),
        getDelayedCount: jest.fn(),
        isPaused: jest.fn(),
        pause: jest.fn(),
        resume: jest.fn(),
        empty: jest.fn(),
        close: jest.fn(),
        on: jest.fn(),
        getJob: jest.fn(),
        getFailed: jest.fn(),
        getCompleted: jest.fn(),
        clean: jest.fn()
    };
    return jest.fn(() => mQueue);
});

describe('QueueManager', () => {
    beforeEach(() => {
        queueManager.queues.clear();
        queueManager.workers.clear();
        jest.clearAllMocks();
    });

    test('should initialize default queues', () => {
        queueManager.initialize();
        
        expect(queueManager.queues.size).toBe(7); // email, notification, sms, export, image, stats, cleanup
        expect(queueManager.queues.has('email')).toBe(true);
        expect(queueManager.queues.has('notification')).toBe(true);
    });

    test('should create custom queue', () => {
        const queue = queueManager.createQueue('test', {
            defaultJobOptions: {
                attempts: 2
            }
        });
        
        expect(queueManager.queues.get('test')).toBe(queue);
        expect(Bull).toHaveBeenCalledWith('test', expect.any(Object), expect.any(Object));
    });

    test('should add job to queue', async () => {
        queueManager.initialize();
        const mockQueue = queueManager.queues.get('email');
        mockQueue.add.mockResolvedValue({ id: 123 });

        const job = await queueManager.add('email', { to: 'test@test.com' }, { priority: 1 });

        expect(mockQueue.add).toHaveBeenCalledWith(
            { to: 'test@test.com' },
            { priority: 1 }
        );
        expect(job.id).toBe(123);
    });

    test('should add bulk jobs', async () => {
        queueManager.initialize();
        const mockQueue = queueManager.queues.get('email');
        mockQueue.addBulk.mockResolvedValue([{ id: 1 }, { id: 2 }]);

        const jobs = await queueManager.addBulk('email', [
            { data: { to: 'a@test.com' } },
            { data: { to: 'b@test.com' } }
        ]);

        expect(mockQueue.addBulk).toHaveBeenCalled();
        expect(jobs.length).toBe(2);
    });

    test('should throw error for unknown queue', async () => {
        await expect(queueManager.add('unknown', {}))
            .rejects
            .toThrow('File d\'attente unknown non trouvée');
    });

    test('should get queue status', async () => {
        queueManager.initialize();
        const mockQueue = queueManager.queues.get('email');
        
        mockQueue.getWaitingCount.mockResolvedValue(5);
        mockQueue.getActiveCount.mockResolvedValue(2);
        mockQueue.getCompletedCount.mockResolvedValue(100);
        mockQueue.getFailedCount.mockResolvedValue(3);
        mockQueue.getDelayedCount.mockResolvedValue(1);
        mockQueue.isPaused.mockResolvedValue(false);

        const status = await queueManager.getQueueStatus('email');

        expect(status).toEqual({
            name: 'email',
            counts: {
                waiting: 5,
                active: 2,
                completed: 100,
                failed: 3,
                delayed: 1,
                total: 111
            },
            isPaused: false
        });
    });

    test('should retry failed job', async () => {
        queueManager.initialize();
        const mockQueue = queueManager.queues.get('email');
        const mockJob = { retry: jest.fn().mockResolvedValue(true) };
        mockQueue.getJob.mockResolvedValue(mockJob);

        const result = await queueManager.retryJob('email', '123');

        expect(result).toBe(true);
        expect(mockJob.retry).toHaveBeenCalled();
    });

    test('should retry all failed jobs', async () => {
        queueManager.initialize();
        const mockQueue = queueManager.queues.get('email');
        const mockJobs = [
            { retry: jest.fn() },
            { retry: jest.fn() }
        ];
        mockQueue.getFailed.mockResolvedValue(mockJobs);

        const count = await queueManager.retryAll('email');

        expect(count).toBe(2);
        expect(mockJobs[0].retry).toHaveBeenCalled();
        expect(mockJobs[1].retry).toHaveBeenCalled();
    });

    test('should clean old jobs', async () => {
        queueManager.initialize();
        const mockQueue = queueManager.queues.get('email');
        
        mockQueue.clean.mockImplementation((grace, type) => {
            if (type === 'completed') return ['job1', 'job2'];
            if (type === 'failed') return ['job3'];
            if (type === 'delayed') return [];
        });

        const result = await queueManager.clean('email', 3600);

        expect(result).toEqual({
            completed: 2,
            failed: 1,
            delayed: 0
        });
    });

    test('should pause and resume queue', async () => {
        queueManager.initialize();
        const mockQueue = queueManager.queues.get('email');

        await queueManager.pause('email');
        expect(mockQueue.pause).toHaveBeenCalled();

        await queueManager.resume('email');
        expect(mockQueue.resume).toHaveBeenCalled();
    });

    test('should perform health check', async () => {
        queueManager.initialize();
        const mockQueue = queueManager.queues.get('email');
        mockQueue.client = { ping: jest.fn().mockResolvedValue('PONG') };

        const health = await queueManager.healthCheck();

        expect(health.status).toBe('healthy');
        expect(health.queues.email.status).toBe('healthy');
    });

    test('should close all queues', async () => {
        queueManager.initialize();
        const mockQueue = queueManager.queues.get('email');

        await queueManager.close();

        expect(mockQueue.close).toHaveBeenCalled();
        expect(queueManager.queues.size).toBe(0);
    });
});
```

### Tests d'intégration avec Redis

```javascript
// tests/integration/queue.integration.test.js
const queueManager = require('../../src/configuration/queue');
const Redis = require('ioredis');

describe('Queue Integration', () => {
    let redis;
    let testQueue;

    beforeAll(async () => {
        // Connexion à Redis
        redis = new Redis(queueManager.getRedisConfig().redis);
        
        // Initialiser les files
        queueManager.initialize();
    });

    afterAll(async () => {
        // Nettoyer
        await queueManager.close();
        await redis.quit();
    });

    beforeEach(async () => {
        // Vider Redis avant chaque test
        await redis.flushall();
    });

    test('should process a job', (done) => {
        queueManager.process('test', 1, async (job) => {
            expect(job.data.message).toBe('Hello');
            done();
            return { result: 'ok' };
        });

        queueManager.add('test', { message: 'Hello' });
    });

    test('should retry failed jobs', async () => {
        let attempts = 0;

        queueManager.process('retry-test', 1, async (job) => {
            attempts++;
            if (attempts < 3) {
                throw new Error('Temporary error');
            }
            return { success: true };
        });

        const job = await queueManager.add('retry-test', { test: true }, {
            attempts: 3,
            backoff: 1000
        });

        // Attendre que le job soit terminé
        await new Promise(resolve => setTimeout(resolve, 5000));

        const finalJob = await queueManager.getJob('retry-test', job.id);
        expect(finalJob.finishedOn).toBeDefined();
        expect(attempts).toBe(3);
    });

    test('should respect job priorities', async () => {
        const processed = [];

        queueManager.process('priority-test', 1, async (job) => {
            processed.push(job.data.value);
            return { processed: job.data.value };
        });

        // Ajouter des jobs avec différentes priorités
        await queueManager.add('priority-test', { value: 3 }, { priority: 3 });
        await queueManager.add('priority-test', { value: 1 }, { priority: 1 });
        await queueManager.add('priority-test', { value: 2 }, { priority: 2 });

        // Attendre le traitement
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Les jobs avec priorité 1 doivent être traités en premier
        expect(processed).toEqual([1, 2, 3]);
    });

    test('should handle delayed jobs', async () => {
        const start = Date.now();
        let processedAt;

        queueManager.process('delay-test', 1, async (job) => {
            processedAt = Date.now();
            return { processed: true };
        });

        await queueManager.add('delay-test', { test: true }, { delay: 2000 });

        // Attendre le traitement
        await new Promise(resolve => setTimeout(resolve, 3000));

        expect(processedAt - start).toBeGreaterThanOrEqual(2000);
    });
});
```

## 🔒 Bonnes pratiques

### 1. Gestion des erreurs

```javascript
// Toujours catcher les erreurs dans les workers
queueManager.process('email', 5, async (job) => {
    try {
        await emailService.send(job.data);
        logger.info(`Email envoyé: ${job.id}`);
    } catch (error) {
        logger.error(`Échec envoi email ${job.id}:`, error);
        
        // Déterminer si on doit réessayer
        if (error.code === 'RATE_LIMIT') {
            // Réessayer plus tard
            throw new Error('Rate limit atteint');
        } else if (error.code === 'INVALID_EMAIL') {
            // Ne pas réessayer
            await job.discard();
            logger.warn(`Email invalide: ${job.data.to}`);
        } else {
            // Réessayer avec backoff
            throw error;
        }
    }
});
```

### 2. Configuration des tentatives

```javascript
// Backoff exponentiel
const job = await queueManager.add('email', data, {
    attempts: 5,
    backoff: {
        type: 'exponential',
        delay: 2000
    }
});

// Backoff linéaire
const job = await queueManager.add('sms', data, {
    attempts: 3,
    backoff: 5000  // 5s, 10s, 15s
});

// Backoff personnalisé
const job = await queueManager.add('export', data, {
    attempts: 3,
    backoff: (attempts) => {
        return Math.min(attempts * 10000, 60000);
    }
});
```

### 3. Monitoring des jobs lents

```javascript
queueManager.process('image', 2, async (job) => {
    const start = Date.now();
    
    try {
        const result = await processImage(job.data);
        const duration = Date.now() - start;
        
        if (duration > 30000) { // Plus de 30 secondes
            logger.warn(`Traitement image lent: ${duration}ms`, {
                jobId: job.id,
                image: job.data.imagePath
            });
        }
        
        return result;
    } catch (error) {
        const duration = Date.now() - start;
        logger.error(`Traitement image échoué après ${duration}ms:`, error);
        throw error;
    }
});
```

### 4. Gestion des jobs bloqués

```javascript
// Vérifier et relancer les jobs bloqués périodiquement
setInterval(async () => {
    const status = await queueManager.getAllStatus();
    
    for (const [name, data] of Object.entries(status)) {
        if (data.counts.active === 0 && data.counts.waiting > 0) {
            logger.warn(`File ${name} bloquée: ${data.counts.waiting} en attente`);
            
            // Forcer le traitement
            const queue = queueManager.getQueue(name);
            await queue.resume();
        }
    }
}, 60000); // Toutes les minutes
```

### 5. Rate limiting

```javascript
// Implémenter du rate limiting dans les workers
class RateLimitedWorker {
    constructor(queueName, rateLimit) {
        this.rateLimit = rateLimit; // jobs par seconde
        this.tokens = rateLimit;
        this.lastRefill = Date.now();
        
        queueManager.process(queueName, 1, this.process.bind(this));
    }

    async process(job) {
        // Rate limiting avec token bucket
        await this.acquireToken();
        return this.doWork(job);
    }

    async acquireToken() {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        
        // Recharger les tokens
        this.tokens = Math.min(
            this.rateLimit,
            this.tokens + elapsed * (this.rateLimit / 1000)
        );
        this.lastRefill = now;

        if (this.tokens < 1) {
            // Attendre jusqu'au prochain token
            const waitTime = (1 / (this.rateLimit / 1000));
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return this.acquireToken();
        }

        this.tokens--;
    }
}
```

## 📈 Performance et scaling

### Configuration du worker

```javascript
// Utiliser différents niveaux de concurrence selon la charge
queueManager.process('email', 10, emailWorker);  // 10 jobs en parallèle
queueManager.process('image', 2, imageWorker);   // 2 jobs en parallèle
queueManager.process('export', 1, exportWorker); // 1 job à la fois
```

### Clustering

```javascript
// cluster.js - Utiliser tous les CPUs
const cluster = require('cluster');
const os = require('os');
const queueManager = require('./configuration/queue');

if (cluster.isMaster) {
    const numWorkers = os.cpus().length;
    
    for (let i = 0; i < numWorkers; i++) {
        cluster.fork();
    }
    
    cluster.on('exit', (worker) => {
        console.log(`Worker ${worker.process.pid} mort, relance...`);
        cluster.fork();
    });
} else {
    queueManager.initialize();
    
    queueManager.process('email', 2, emailWorker);
    queueManager.process('notification', 5, notificationWorker);
    
    console.log(`Worker ${process.pid} démarré`);
}
```

### Métriques de performance

```javascript
// Collecter des métriques détaillées
async function getDetailedMetrics() {
    const metrics = await queueManager.getAllMetrics();
    
    return Object.entries(metrics).map(([name, data]) => ({
        queue: name,
        jobsPerMinute: data.metrics.jobsPerMinute,
        avgProcessingTime: data.metrics.avgProcessingTime,
        successRate: data.metrics.completed / data.metrics.processed * 100,
        workerCount: data.metrics.workers,
        ...data
    }));
}
```

## 🔄 Migration et compatibilité

### De Kue à Bull

```javascript
// Migration script
async function migrateFromKue() {
    const kue = require('kue');
    const queue = kue.createQueue();
    
    // Récupérer les jobs de Kue
    const jobs = await new Promise((resolve) => {
        queue.inactive((err, ids) => {
            resolve(ids);
        });
    });

    // Les migrer vers Bull
    for (const jobId of jobs) {
        queue.get(jobId, async (err, job) => {
            if (job) {
                await queueManager.add(job.type, job.data, {
                    attempts: job._max_attempts,
                    delay: job._delay
                });
                job.remove();
            }
        });
    }
}
```

## 📚 API Reference

### Propriétés

| Propriété | Type | Description |
|-----------|------|-------------|
| `queues` | Map | Map des files Bull |
| `workers` | Map | Map des workers actifs |
| `redisConfig` | Object | Configuration Redis |

### Méthodes principales

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `initialize()` | - | void | Initialise les files |
| `createQueue(name, options)` | `string, object` | Queue | Crée une file |
| `getQueue(name)` | `string` | Queue | Récupère une file |
| `add(name, data, options)` | `string, object, object` | Promise<Job> | Ajoute un job |
| `addBulk(name, jobs)` | `string, array` | Promise<Job[]> | Ajoute plusieurs jobs |
| `process(name, concurrency, processor)` | `string, number, function` | void | Traite une file |
| `close()` | - | Promise<void> | Ferme les files |

### Méthodes de monitoring

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `getQueueStatus(name)` | `string` | Promise<object> | Statut d'une file |
| `getAllStatus()` | - | Promise<object> | Statuts de toutes les files |
| `getMetrics(name)` | `string` | Promise<object> | Métriques détaillées |
| `healthCheck()` | - | Promise<object> | Vérification santé |

### Méthodes de gestion des jobs

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `getJob(name, jobId)` | `string, string` | Promise<Job> | Récupère un job |
| `getFailedJobs(name, start, end)` | `string, number, number` | Promise<Job[]> | Jobs échoués |
| `retryJob(name, jobId)` | `string, string` | Promise<boolean> | Relance un job |
| `retryAll(name)` | `string` | Promise<number> | Relance tous les jobs |
| `removeJob(name, jobId)` | `string, string` | Promise<boolean> | Supprime un job |
| `clean(name, grace)` | `string, number` | Promise<object> | Nettoie les vieux jobs |

### Méthodes de contrôle

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `pause(name)` | `string` | Promise<void> | Met en pause |
| `resume(name)` | `string` | Promise<void> | Reprend |
| `empty(name)` | `string` | Promise<void> | Vide la file |

## 🆘 Dépannage

### Problèmes courants

1. **Redis non accessible**
```javascript
// Vérifier la connexion Redis
const redis = new Redis(queueManager.getRedisConfig().redis);
redis.ping((err, result) => {
    if (err) console.error('Redis indisponible:', err);
    else console.log('Redis OK:', result);
});
```

2. **Jobs bloqués**
```javascript
// Forcer le traitement des jobs bloqués
const queue = queueManager.getQueue('email');
await queue.resume();
await queue.clean(0, 'active'); // Nettoyer les jobs actifs bloqués
```

3. **Trop de jobs en attente**
```javascript
// Augmenter la concurrence
queueManager.process('email', 20, emailWorker); // Passer de 5 à 20

// Ou ajouter plus de workers (clustering)
```

4. **Mémoire Redis saturée**
```javascript
// Nettoyer les vieux jobs plus agressivement
await queueManager.cleanAll(12 * 3600); // 12 heures au lieu de 24
```

### Debugging

```javascript
// Activer les logs détaillés de Bull
process.env.DEBUG = 'bull:*';

// Voir les événements en temps réel
queueManager.getQueue('email').on('active', (job) => {
    console.log(`Job ${job.id} actif`);
});

// Inspecter un job spécifique
const job = await queueManager.getJob('email', '123');
console.log({
    id: job.id,
    data: job.data,
    attempts: job.attemptsMade,
    timestamp: job.timestamp,
    failedReason: job.failedReason,
    stacktrace: job.stacktrace
});
```

## 🎯 Conclusion

Ce module de files d'attente offre une solution robuste et scalable pour le traitement asynchrone avec :

- ✅ **Multiples files** spécialisées
- ✅ **Redis** pour persistance et fiabilité
- ✅ **Tentatives automatiques** avec backoff
- ✅ **Priorités** et délais
- ✅ **Jobs répétitifs** (cron)
- ✅ **Monitoring** complet
- ✅ **Clustering** supporté
- ✅ **Gestion d'erreurs** avancée
- ✅ **Documentation exhaustive**

Il permet de décharger les tâches longues ou asynchrones du cycle requête-réponse, améliorant ainsi les performances et la scalabilité de l'application.
```