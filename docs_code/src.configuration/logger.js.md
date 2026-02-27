```markdown
# Module de Logger - logger.js

## 📋 Vue d'ensemble

Ce module fournit un système de logging complet pour l'application utilisant la bibliothèque **Winston**. Il offre une interface unifiée pour journaliser les événements, les erreurs, les requêtes HTTP, les actions utilisateur et les alertes de sécurité avec rotation automatique des fichiers.

## 🏗️ Architecture

### Classe `Logger`

La classe principale qui encapsule toute la logique de logging.

#### Constructeur
```javascript
constructor()
```
Initialise le logger en créant une instance Winston avec :
- `logger` : Instance Winston configurée
- Appel à `createLogger()` pour la configuration

## 🔧 Fonctionnalités principales

### 1. Configuration Winston (`createLogger()`)

#### Formats de log

```javascript
const { combine, timestamp, printf, colorize, json } = winston.format;

// Format personnalisé pour la console
const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level}] : ${message}`;
    
    if (Object.keys(metadata).length > 0) {
        msg += ` ${JSON.stringify(metadata)}`;
    }
    
    return msg;
});
```

#### Niveaux de log

```javascript
const nodeEnv = process.env.NODE_ENV || 'development';
const logLevel = nodeEnv === 'development' ? 'debug' : (process.env.LOG_LEVEL || 'info');

// Niveaux disponibles (par ordre de sévérité croissante) :
// error (0), warn (1), info (2), http (3), verbose (4), debug (5), silly (6)
```

#### Transports configurés

| Transport | Destination | Format | Niveau |
|-----------|-------------|--------|--------|
| Console | stdout | Colorisé, texte | configurable |
| Fichier journalier | `application-%DATE%.log` | JSON | configurable |
| Fichier erreurs | `error-%DATE%.log` | JSON | error |
| Exceptions | `exceptions.log` | JSON/texte | - |
| Rejets | `rejections.log` | JSON/texte | - |

### 2. Méthodes de logging principales

| Méthode | Niveau | Description |
|---------|--------|-------------|
| `info(message, metadata)` | info | Informations générales |
| `error(message, metadata)` | error | Erreurs |
| `warn(message, metadata)` | warn | Avertissements |
| `debug(message, metadata)` | debug | Débogage |
| `verbose(message, metadata)` | verbose | Détails supplémentaires |

### 3. Logging HTTP (`http(req, res, responseTime)`)

Journalise automatiquement les requêtes HTTP avec :
- Méthode (GET, POST, etc.)
- URL
- Code de statut
- Temps de réponse
- IP client
- User-Agent
- ID utilisateur (si authentifié)

**Gestion intelligente des statuts :**
- `5xx` → niveau `error`
- `4xx` → niveau `warn`
- Autres → niveau `info`

### 4. Logging contextuel

```javascript
// Créer un logger avec un contexte
const userLogger = logger.context('users');
const orderLogger = logger.context('orders');

userLogger.info('Utilisateur créé'); // [users] Utilisateur créé
orderLogger.error('Paiement échoué'); // [orders] Paiement échoué
```

### 5. Logging spécialisé

| Méthode | Description |
|---------|-------------|
| `userAction(userId, action, details)` | Actions utilisateur |
| `transaction(transactionData)` | Transactions |
| `security(alert, details)` | Alertes de sécurité |
| `performance(operation, duration, metadata)` | Métriques de performance |

## 📦 Installation et configuration

### Prérequis
```bash
npm install winston winston-daily-rotate-file
```

### Configuration dans `.env`

```env
# Logging
LOG_LEVEL=info                  # debug, info, warn, error
LOG_FILE=/var/log/myapp/app.log  # Chemin des logs (optionnel)
LOG_MAX_SIZE=20m                 # Taille maximale par fichier
LOG_MAX_FILES=14d                # Conservation des fichiers
```

## 🚀 Utilisation

### Initialisation

```javascript
// Dans app.js
const logger = require('./configuration/logger');

// Exemple d'utilisation de base
logger.info('Application démarrée', { 
    port: 3000,
    env: process.env.NODE_ENV 
});
```

### Middleware HTTP

```javascript
// middleware/httpLogger.js
const logger = require('../configuration/logger');

function httpLogger(req, res, next) {
    const start = Date.now();
    
    res.on('finish', () => {
        const responseTime = Date.now() - start;
        logger.http(req, res, responseTime);
    });
    
    next();
}

// Utilisation dans Express
app.use(httpLogger);
```

### Logging d'erreurs

```javascript
// Gestionnaire d'erreurs global
app.use((err, req, res, next) => {
    logger.error('Erreur non gérée', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        userId: req.user?.id
    });
    
    res.status(500).json({ error: 'Erreur interne' });
});
```

### Logging d'actions utilisateur

```javascript
// controllers/userController.js
const logger = require('../configuration/logger');

async function updateProfile(req, res) {
    try {
        const user = await User.findById(req.params.id);
        
        // Log avant modification
        logger.userAction(req.user.id, 'profile_update_attempt', {
            targetUserId: req.params.id,
            changes: req.body
        });
        
        // Effectuer la mise à jour
        await user.update(req.body);
        
        // Log après succès
        logger.userAction(req.user.id, 'profile_update_success', {
            targetUserId: req.params.id
        });
        
        res.json({ success: true });
    } catch (error) {
        logger.error('Échec mise à jour profil', {
            userId: req.user.id,
            error: error.message
        });
        throw error;
    }
}
```

### Logging de transactions

```javascript
// services/paymentService.js
const logger = require('../configuration/logger');

async function processPayment(orderId, amount, method) {
    const transactionId = generateTransactionId();
    
    logger.transaction({
        transactionId,
        orderId,
        amount,
        method,
        status: 'initiated'
    });
    
    try {
        const result = await paymentGateway.charge(amount, method);
        
        logger.transaction({
            transactionId,
            orderId,
            amount,
            method,
            status: 'completed',
            gatewayResponse: result
        });
        
        return result;
    } catch (error) {
        logger.transaction({
            transactionId,
            orderId,
            amount,
            method,
            status: 'failed',
            error: error.message
        });
        
        throw error;
    }
}
```

### Logging de sécurité

```javascript
// middleware/auth.js
const logger = require('../configuration/logger');

async function login(req, res, next) {
    const { email, password } = req.body;
    const ip = req.ip;
    
    try {
        const user = await User.findByEmail(email);
        
        if (!user || !await user.verifyPassword(password)) {
            logger.security('Échec de connexion', {
                email,
                ip,
                userAgent: req.get('user-agent'),
                reason: 'Identifiants invalides'
            });
            
            return res.status(401).json({ error: 'Identifiants invalides' });
        }
        
        if (user.isLocked()) {
            logger.security('Tentative de connexion sur compte verrouillé', {
                userId: user.id,
                email,
                ip
            });
            
            return res.status(403).json({ error: 'Compte verrouillé' });
        }
        
        // Log connexion réussie
        logger.security('Connexion réussie', {
            userId: user.id,
            email,
            ip
        });
        
        req.user = user;
        next();
    } catch (error) {
        next(error);
    }
}
```

### Monitoring de performance

```javascript
// middleware/performanceMonitor.js
const logger = require('../configuration/logger');

function monitorPerformance() {
    return (req, res, next) => {
        const start = process.hrtime();
        
        res.on('finish', () => {
            const [seconds, nanoseconds] = process.hrtime(start);
            const duration = seconds * 1000 + nanoseconds / 1000000;
            
            // Log automatique via httpLogger
            // Log supplémentaire pour les requêtes lentes
            if (duration > 1000) {
                logger.performance('requête lente', duration, {
                    url: req.url,
                    method: req.method,
                    status: res.statusCode
                });
            }
        });
        
        next();
    };
}

// Utilisation dans les services
class UserService {
    async getUsers() {
        const start = Date.now();
        
        try {
            const users = await User.findAll();
            const duration = Date.now() - start;
            
            logger.performance('getUsers', duration, { count: users.length });
            
            return users;
        } catch (error) {
            const duration = Date.now() - start;
            logger.performance('getUsers (failed)', duration, { error: error.message });
            throw error;
        }
    }
}
```

### Logging avec contexte

```javascript
// Exemple d'utilisation avancée du contexte
const requestLogger = logger.context(`req-${requestId}`);

requestLogger.info('Début du traitement');
// ... traitement
requestLogger.debug('Données reçues', { body: req.body });
// ... plus de traitement
requestLogger.info('Fin du traitement');

// Création de loggers spécialisés
const dbLogger = logger.context('database');
const apiLogger = logger.context('api');
const authLogger = logger.context('auth');

dbLogger.info('Connexion établie', { host: process.env.DB_HOST });
apiLogger.warn('Rate limit atteint', { ip: clientIp });
authLogger.debug('Vérification token', { userId: token.sub });
```

### Formatage des logs

```javascript
// Différents formats selon l'environnement

// Développement : logs colorisés et lisibles
// [2024-01-15T10:30:45.123Z] [info] : Application démarrée {"port":3000}

// Production : logs JSON pour ELK Stack
// {"level":"info","message":"Application démarrée","timestamp":"2024-01-15T10:30:45.123Z","port":3000}
```

## 📊 Exemples de logs

### Log console (développement)
```
2024-01-15T10:30:45.123Z [info] : Application démarrée {"port":3000,"env":"development"}
2024-01-15T10:30:46.456Z [debug] : Connexion DB établie {"host":"localhost"}
2024-01-15T10:30:47.789Z [info] : GET /api/users - 200 - 45ms {"ip":"127.0.0.1","userAgent":"Mozilla/5.0"}
2024-01-15T10:30:48.012Z [warn] : GET /api/admin - 403 - 12ms {"ip":"127.0.0.1","userId":123}
2024-01-15T10:30:49.345Z [error] : Erreur DB {"error":"Connection timeout","query":"SELECT * FROM users"}
```

### Log fichier (production)
```json
{"level":"info","message":"Application démarrée","timestamp":"2024-01-15T10:30:45.123Z","port":3000,"env":"production"}
{"level":"info","message":"GET /api/users - 200 - 45ms","timestamp":"2024-01-15T10:30:47.789Z","method":"GET","url":"/api/users","status":200,"responseTime":45,"ip":"127.0.0.1"}
{"level":"warn","message":"GET /api/admin - 403 - 12ms","timestamp":"2024-01-15T10:30:48.012Z","method":"GET","url":"/api/admin","status":403,"responseTime":12,"ip":"127.0.0.1","userId":123}
{"level":"error","message":"Erreur DB","timestamp":"2024-01-15T10:30:49.345Z","error":"Connection timeout","query":"SELECT * FROM users"}
```

### Log d'actions utilisateur
```json
{
  "level": "info",
  "message": "Action utilisateur: profile_update_success",
  "timestamp": "2024-01-15T10:30:50.123Z",
  "userId": 123,
  "action": "profile_update_success",
  "targetUserId": 456,
  "changes": ["name", "email"]
}
```

### Log de sécurité
```json
{
  "level": "warn",
  "message": "Alerte sécurité: Échec de connexion",
  "timestamp": "2024-01-15T10:30:51.456Z",
  "type": "security",
  "alert": "Échec de connexion",
  "email": "test@example.com",
  "ip": "192.168.1.100",
  "reason": "Identifiants invalides"
}
```

## 🧪 Tests

### Tests unitaires

```javascript
// tests/logger.test.js
const logger = require('../src/configuration/logger');

describe('Logger', () => {
    beforeEach(() => {
        jest.spyOn(logger.logger, 'info').mockImplementation();
        jest.spyOn(logger.logger, 'error').mockImplementation();
        jest.spyOn(logger.logger, 'warn').mockImplementation();
        jest.spyOn(logger.logger, 'debug').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('info should call winston.info', () => {
        logger.info('Test message', { key: 'value' });
        expect(logger.logger.info).toHaveBeenCalledWith('Test message', { key: 'value' });
    });

    test('error should call winston.error', () => {
        logger.error('Error message', { code: 500 });
        expect(logger.logger.error).toHaveBeenCalledWith('Error message', { code: 500 });
    });

    test('warn should call winston.warn', () => {
        logger.warn('Warning message');
        expect(logger.logger.warn).toHaveBeenCalledWith('Warning message', {});
    });

    test('debug should call winston.debug', () => {
        logger.debug('Debug message');
        expect(logger.logger.debug).toHaveBeenCalledWith('Debug message', {});
    });

    test('http should log based on status code', () => {
        const req = { 
            method: 'GET', 
            url: '/test',
            ip: '127.0.0.1',
            get: jest.fn().mockReturnValue('test-agent')
        };
        
        // Test 200 (info)
        const res200 = { statusCode: 200 };
        logger.http(req, res200, 100);
        expect(logger.logger.info).toHaveBeenCalled();

        // Test 404 (warn)
        const res404 = { statusCode: 404 };
        logger.http(req, res404, 100);
        expect(logger.logger.warn).toHaveBeenCalled();

        // Test 500 (error)
        const res500 = { statusCode: 500 };
        logger.http(req, res500, 100);
        expect(logger.logger.error).toHaveBeenCalled();
    });

    test('http should handle missing req/res gracefully', () => {
        expect(() => logger.http(null, null)).not.toThrow();
        expect(() => logger.http({}, null)).not.toThrow();
    });

    test('userAction should log with correct format', () => {
        logger.userAction(123, 'login', { ip: '127.0.0.1' });
        
        expect(logger.logger.info).toHaveBeenCalledWith(
            'Action utilisateur: login',
            expect.objectContaining({
                userId: 123,
                action: 'login',
                ip: '127.0.0.1'
            })
        );
    });

    test('security should log as warning', () => {
        logger.security('Tentative brute force', { ip: '127.0.0.1' });
        
        expect(logger.logger.warn).toHaveBeenCalledWith(
            'Alerte sécurité: Tentative brute force',
            expect.objectContaining({
                type: 'security',
                alert: 'Tentative brute force',
                ip: '127.0.0.1'
            })
        );
    });

    test('performance should log slow operations as warning', () => {
        // Opération rapide (< 1000ms)
        logger.performance('test', 500);
        expect(logger.logger.debug).toHaveBeenCalled();

        // Opération lente (> 1000ms)
        logger.performance('test', 1500);
        expect(logger.logger.warn).toHaveBeenCalled();
    });

    test('context should prefix messages', () => {
        const contextLogger = logger.context('test');
        
        contextLogger.info('message');
        expect(logger.logger.info).toHaveBeenCalledWith(
            '[test] message',
            {}
        );
    });
});
```

### Tests d'intégration

```javascript
// tests/integration/logger.integration.test.js
const logger = require('../../src/configuration/logger');
const fs = require('fs');
const path = require('path');

describe('Logger Integration', () => {
    const logDir = path.join(__dirname, '../../logs');
    const logFile = path.join(logDir, 'test-application.log');

    beforeAll(() => {
        // Configurer un fichier de log pour les tests
        process.env.LOG_FILE = logFile;
        process.env.NODE_ENV = 'test';
        
        // Réinitialiser le logger avec la nouvelle config
        jest.isolateModules(() => {
            const Logger = require('../../src/configuration/logger');
        });
    });

    afterAll(() => {
        // Nettoyer les fichiers de test
        if (fs.existsSync(logDir)) {
            fs.rmSync(logDir, { recursive: true, force: true });
        }
    });

    test('should write logs to file', (done) => {
        logger.info('Test log to file');
        
        // Attendre un peu pour l'écriture asynchrone
        setTimeout(() => {
            const logContent = fs.readFileSync(logFile, 'utf8');
            expect(logContent).toContain('Test log to file');
            done();
        }, 100);
    });

    test('should create daily rotate files', async () => {
        const today = new Date().toISOString().split('T')[0];
        const expectedFile = path.join(logDir, `application-${today}.log`);
        
        logger.info('Test rotation');
        
        // Attendre l'écriture
        await new Promise(resolve => setTimeout(resolve, 100));
        
        expect(fs.existsSync(expectedFile)).toBe(true);
    });
});
```

## 🔒 Bonnes pratiques

### 1. Ne jamais logger d'informations sensibles

```javascript
// ❌ À éviter
logger.info('Connexion utilisateur', {
    password: userPassword,
    token: jwtToken,
    creditCard: '4111-1111-1111-1111'
});

// ✅ À utiliser
logger.info('Connexion utilisateur', {
    userId: user.id,
    email: user.email,
    ip: req.ip
});
```

### 2. Structure cohérente des métadonnées

```javascript
// Définir des conventions pour l'équipe
const logConventions = {
    users: {
        action: 'user_action',
        metadata: ['userId', 'targetUserId', 'action']
    },
    orders: {
        action: 'order_action',
        metadata: ['orderId', 'amount', 'status']
    },
    errors: {
        action: 'error',
        metadata: ['code', 'stack', 'context']
    }
};

// Utilisation cohérente
logger.userAction(userId, 'login', { 
    timestamp: new Date(),
    ip: req.ip 
});
```

### 3. Niveaux de log appropriés

```javascript
// ERROR - Erreurs nécessitant une intervention
logger.error('Échec connexion DB', { error: err.message });

// WARN - Situations anormales mais non critiques
logger.warn('Rate limit approchant', { current: 95, limit: 100 });

// INFO - Événements normaux importants
logger.info('Utilisateur inscrit', { userId: newUser.id });

// DEBUG - Détails pour le développement
logger.debug('Requête API', { 
    url: req.url, 
    params: req.params,
    query: req.query 
});
```

### 4. Correlation IDs

```javascript
// middleware/correlationId.js
const { v4: uuidv4 } = require('uuid');

function correlationId(req, res, next) {
    req.correlationId = req.headers['x-correlation-id'] || uuidv4();
    res.setHeader('x-correlation-id', req.correlationId);
    
    // Créer un logger contextuel pour cette requête
    req.log = logger.context(`req-${req.correlationId}`);
    
    next();
}

// Utilisation
app.use(correlationId);

app.get('/api/users', (req, res) => {
    req.log.info('Récupération des utilisateurs');
    // Tous les logs de cette requête auront le même correlationId
});
```

### 5. Logging structuré pour ELK Stack

```javascript
// Format standardisé pour Elasticsearch
const structuredLog = {
    '@timestamp': new Date().toISOString(),
    level: 'info',
    logger: 'myapp',
    application: process.env.APP_NAME,
    environment: process.env.NODE_ENV,
    version: process.env.APP_VERSION,
    host: os.hostname(),
    ...metadata
};

logger.info(message, structuredLog);
```

## 📈 Monitoring avec les logs

### Script d'analyse des logs

```javascript
// scripts/analyze-logs.js
const fs = require('fs');
const readline = require('readline');

async function analyzeLogs(logFile) {
    const fileStream = fs.createReadStream(logFile);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let stats = {
        total: 0,
        info: 0,
        warn: 0,
        error: 0,
        debug: 0,
        errors: [],
        slowQueries: [],
        securityAlerts: []
    };

    for await (const line of rl) {
        try {
            const log = JSON.parse(line);
            stats.total++;
            stats[log.level] = (stats[log.level] || 0) + 1;

            // Collecter les erreurs
            if (log.level === 'error') {
                stats.errors.push({
                    message: log.message,
                    timestamp: log.timestamp,
                    error: log.error
                });
            }

            // Collecter les requêtes lentes
            if (log.message && log.message.includes('Requête lente')) {
                stats.slowQueries.push(log);
            }

            // Collecter les alertes sécurité
            if (log.type === 'security') {
                stats.securityAlerts.push(log);
            }
        } catch (e) {
            // Ignorer les lignes non-JSON
        }
    }

    return stats;
}

// Analyse des dernières 24h
analyzeLogs('/var/log/myapp/application-2024-01-15.log')
    .then(stats => {
        console.log('📊 Statistiques des logs:');
        console.log(`Total: ${stats.total}`);
        console.log(`Info: ${stats.info}`);
        console.log(`Warn: ${stats.warn}`);
        console.log(`Error: ${stats.error}`);
        console.log(`Debug: ${stats.debug}`);
        console.log(`\n❌ Erreurs (${stats.errors.length}):`);
        stats.errors.slice(0, 5).forEach(e => console.log(`- ${e.message}`));
        console.log(`\n🐢 Requêtes lentes: ${stats.slowQueries.length}`);
        console.log(`\n🔐 Alertes sécurité: ${stats.securityAlerts.length}`);
    });
```

## 🔄 Migration

### De console.log à winston

```javascript
// Avant
console.log('User created:', user);
console.error('Error:', err);

// Après
logger.info('User created', { userId: user.id });
logger.error('Error:', { error: err.message, stack: err.stack });
```

### Script de migration automatique

```javascript
// scripts/migrate-to-winston.js
const fs = require('fs');
const path = require('path');

function migrateFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Remplacer console.log
    content = content.replace(
        /console\.log\((.*?)\)/g, 
        'logger.info($1)'
    );
    
    // Remplacer console.error
    content = content.replace(
        /console\.error\((.*?)\)/g, 
        'logger.error($1)'
    );
    
    // Remplacer console.warn
    content = content.replace(
        /console\.warn\((.*?)\)/g, 
        'logger.warn($1)'
    );
    
    // Ajouter l'import si nécessaire
    if (content.includes('logger.') && !content.includes('require(\'./logger\')')) {
        content = `const logger = require('./configuration/logger');\n${content}`;
    }
    
    fs.writeFileSync(filePath, content);
    console.log(`✅ Migré: ${filePath}`);
}

// Migrer tous les fichiers .js d'un dossier
function migrateDirectory(dir) {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            migrateDirectory(filePath);
        } else if (file.endsWith('.js')) {
            migrateFile(filePath);
        }
    });
}

migrateDirectory('./src');
```

## 📚 API Reference

### Propriétés

| Propriété | Type | Description |
|-----------|------|-------------|
| `logger` | winston.Logger | Instance Winston sous-jacente |

### Méthodes principales

| Méthode | Paramètres | Description |
|---------|------------|-------------|
| `info(message, metadata)` | `string, object` | Log niveau info |
| `error(message, metadata)` | `string, object` | Log niveau error |
| `warn(message, metadata)` | `string, object` | Log niveau warn |
| `debug(message, metadata)` | `string, object` | Log niveau debug |
| `verbose(message, metadata)` | `string, object` | Log niveau verbose |

### Méthodes spécialisées

| Méthode | Paramètres | Description |
|---------|------------|-------------|
| `http(req, res, responseTime)` | `Request, Response, number` | Log requête HTTP |
| `userAction(userId, action, details)` | `number, string, object` | Log action utilisateur |
| `transaction(transactionData)` | `object` | Log transaction |
| `security(alert, details)` | `string, object` | Log alerte sécurité |
| `performance(operation, duration, metadata)` | `string, number, object` | Log performance |
| `context(contextName)` | `string` | Crée logger contextuel |
| `getWinstonLogger()` | - | Récupère instance Winston |

## 🆘 Dépannage

### Problèmes courants

1. **Les logs n'apparaissent pas en console**
```javascript
// Vérifier le niveau de log
console.log('Niveau actuel:', logger.logger.level);

// Forcer le niveau debug
logger.logger.level = 'debug';
```

2. **Fichiers de log non créés**
```javascript
// Vérifier les permissions du dossier
const logDir = path.dirname(process.env.LOG_FILE);
fs.access(logDir, fs.constants.W_OK, (err) => {
    if (err) console.error('Pas de permission d\'écriture');
});
```

3. **Trop de logs en production**
```javascript
// Ajuster le niveau
process.env.LOG_LEVEL = 'warn'; // Ne log que warn et error
```

4. **Format JSON invalide**
```javascript
// Vérifier que les métadonnées sont sérialisables
logger.info('test', { 
    date: new Date(), // OK - sera converti en string
    circular: obj // ❌ Objet circulaire - erreur
});
```

### Debugging

```javascript
// Activer le mode debug temporaire
const originalLevel = logger.logger.level;
logger.logger.level = 'debug';

// Faire vos opérations
logger.debug('Message de debug');

// Restaurer
logger.logger.level = originalLevel;

// Ou utiliser un fichier de debug séparé
const debugLogger = winston.createLogger({
    level: 'debug',
    transports: [
        new winston.transports.File({ filename: 'debug.log' })
    ]
});
```

## 🎯 Conclusion

Ce module de logger offre une solution complète pour le logging avec :

- ✅ **Multiples transports** (console, fichiers, rotation)
- ✅ **Niveaux de log** configurables
- ✅ **Formatage flexible** (texte, JSON)
- ✅ **Logging HTTP** automatique
- ✅ **Contextualisation** des logs
- ✅ **Métriques de performance**
- ✅ **Alertes de sécurité**
- ✅ **Gestion des exceptions** non capturées
- ✅ **Rotation automatique** des fichiers
- ✅ **Documentation exhaustive**

Il constitue un outil essentiel pour le debugging, le monitoring et la sécurité de l'application.
```