```markdown
# Module de Base de Données - database.js

## 📋 Vue d'ensemble

Ce module gère la connexion à la base de données PostgreSQL en utilisant la bibliothèque `pg` (node-postgres). Il fournit une interface complète pour les opérations de base de données avec un pool de connexions optimisé, des transactions, du streaming, et des outils de monitoring.
 
## 🏗️ Architecture

### Classe `Database`

La classe principale qui encapsule toute la logique de gestion de la base de données.

#### Constructeur
```javascript
constructor()
```
Initialise le gestionnaire de base de données avec :
- `pool` : Instance du pool de connexions PostgreSQL (initialisée à `null`)
- `connected` : État de la connexion (initialisé à `false`)

## 🔧 Fonctionnalités principales

### 1. Initialisation (`initialize()`)

Configure le pool de connexions PostgreSQL avec les paramètres de l'environnement :

```javascript
this.pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'mon_projet',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    
    // Configuration du pool
    max: parseInt(process.env.DB_POOL_MAX) || 20,        // Maximum de connexions
    min: parseInt(process.env.DB_POOL_MIN) || 2,         // Minimum de connexions
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000, // Timeout inactivité
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000, // Timeout connexion
    
    // Validation des connexions
    statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT) || 10000,
    query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT) || 10000
});
```

### 2. Événements du pool

Le pool écoute plusieurs événements pour le monitoring :

| Événement | Description |
|-----------|-------------|
| `connect` | Nouvelle connexion établie |
| `error` | Erreur inattendue du pool |
| `remove` | Connexion retirée du pool |

### 3. Opérations principales

| Méthode | Description | Paramètres |
|---------|-------------|------------|
| `query(text, params)` | Exécute une requête SQL | `text`: string, `params`: array |
| `transaction(callback)` | Exécute dans une transaction | `callback`: function |
| `getClient()` | Obtient un client du pool | - |
| `close()` | Ferme toutes les connexions | - |
| `isConnected()` | Vérifie l'état de connexion | - |

### 4. Opérations avancées

#### Query avec monitoring des performances
```javascript
async query(text, params = []) {
    const start = Date.now();
    
    try {
        const result = await this.pool.query(text, params);
        
        // Log des requêtes lentes (> 100ms)
        const duration = Date.now() - start;
        if (duration > 100) {
            logger.warn(`Requête lente (${duration}ms): ${text.substring(0, 200)}...`);
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
```

#### Transactions
```javascript
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
```

#### Streaming de données
```javascript
async queryStream(text, params = [], rowHandler) {
    const client = await this.pool.connect();
    
    try {
        const query = client.query(new Query(text, params));
        
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
```

### 5. Monitoring et statistiques

#### Statistiques du pool
```javascript
getPoolStats() {
    return {
        totalCount: this.pool.totalCount,    // Connexions totales
        idleCount: this.pool.idleCount,      // Connexions inactives
        waitingCount: this.pool.waitingCount, // Requêtes en attente
        connected: this.connected
    };
}
```

#### Health check
```javascript
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
```

### 6. Utilitaires

#### Vérifier l'existence d'une table
```javascript
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
```

#### Obtenir la taille d'une table
```javascript
async getTableSize(tableName) {
    const result = await this.query(
        `SELECT pg_size_pretty(pg_total_relation_size($1)) as size`,
        [tableName]
    );
    return result.rows[0].size;
}
```

## 📦 Installation et configuration

### Prérequis
```bash
npm install pg
```

### Configuration dans `.env`

```env
# Configuration PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mon_projet
DB_USER=postgres
DB_PASSWORD=votre_mot_de_passe
DB_SSL=false

# Configuration du pool
DB_POOL_MAX=20
DB_POOL_MIN=2
DB_IDLE_TIMEOUT=30000
DB_CONNECTION_TIMEOUT=2000
DB_STATEMENT_TIMEOUT=10000
DB_QUERY_TIMEOUT=10000
```

## 🚀 Utilisation

### Initialisation

```javascript
// Dans app.js ou server.js
const database = require('./configuration/database');

async function startServer() {
    try {
        // Initialiser la connexion à la base de données
        await database.initialize();
        
        // Démarrer le serveur
        app.listen(3000, () => {
            console.log('Serveur démarré sur le port 3000');
        });
    } catch (error) {
        console.error('Erreur au démarrage:', error);
        process.exit(1);
    }
}

// Gestion de l'arrêt gracieux
process.on('SIGTERM', async () => {
    await database.close();
    process.exit(0);
});
```

### Requêtes simples

```javascript
// Récupérer tous les utilisateurs
async function getUsers() {
    const result = await database.query('SELECT * FROM users');
    return result.rows;
}

// Récupérer un utilisateur par ID
async function getUserById(id) {
    const result = await database.query(
        'SELECT * FROM users WHERE id = $1',
        [id]
    );
    return result.rows[0];
}

// Insérer un utilisateur
async function createUser(userData) {
    const { name, email } = userData;
    const result = await database.query(
        'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
        [name, email]
    );
    return result.rows[0];
}

// Mettre à jour un utilisateur
async function updateUser(id, updates) {
    const { name, email } = updates;
    const result = await database.query(
        'UPDATE users SET name = $1, email = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
        [name, email, id]
    );
    return result.rows[0];
}

// Supprimer un utilisateur
async function deleteUser(id) {
    await database.query('DELETE FROM users WHERE id = $1', [id]);
    return { success: true };
}
```

### Transactions

```javascript
// Créer une commande avec mise à jour du stock
async function createOrder(orderData) {
    return await database.transaction(async (client) => {
        // Insérer la commande
        const orderResult = await client.query(
            'INSERT INTO orders (user_id, total) VALUES ($1, $2) RETURNING id',
            [orderData.userId, orderData.total]
        );
        const orderId = orderResult.rows[0].id;

        // Insérer les articles de la commande
        for (const item of orderData.items) {
            await client.query(
                'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
                [orderId, item.productId, item.quantity, item.price]
            );

            // Mettre à jour le stock
            await client.query(
                'UPDATE products SET stock = stock - $1 WHERE id = $2',
                [item.quantity, item.productId]
            );
        }

        return orderId;
    });
}
```

### Streaming de données

```javascript
// Exporter tous les utilisateurs en CSV
async function exportUsersToCSV(res) {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
    
    let isFirstRow = true;
    
    await database.queryStream(
        'SELECT id, name, email, created_at FROM users',
        [],
        (row) => {
            if (isFirstRow) {
                res.write(Object.keys(row).join(',') + '\n');
                isFirstRow = false;
            }
            res.write(Object.values(row).join(',') + '\n');
        }
    );
    
    res.end();
}
```

### Requêtes parallèles

```javascript
// Récupérer plusieurs données en parallèle
async function getDashboardData(userId) {
    const queries = [
        { text: 'SELECT COUNT(*) FROM orders WHERE user_id = $1', params: [userId] },
        { text: 'SELECT SUM(total) FROM orders WHERE user_id = $1', params: [userId] },
        { text: 'SELECT * FROM recent_activities WHERE user_id = $1 LIMIT 10', params: [userId] }
    ];
    
    const results = await database.parallel(queries);
    
    return {
        orderCount: results[0].rows[0].count,
        totalSpent: results[1].rows[0].sum || 0,
        recentActivities: results[2].rows
    };
}
```

### Repository Pattern

```javascript
// repositories/userRepository.js
const database = require('../configuration/database');

class UserRepository {
    async findById(id) {
        const result = await database.query(
            'SELECT * FROM users WHERE id = $1',
            [id]
        );
        return result.rows[0];
    }

    async findByEmail(email) {
        const result = await database.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );
        return result.rows[0];
    }

    async findAll(filters = {}) {
        let query = 'SELECT * FROM users WHERE 1=1';
        const params = [];
        let paramIndex = 1;

        if (filters.role) {
            query += ` AND role = $${paramIndex}`;
            params.push(filters.role);
            paramIndex++;
        }

        if (filters.status) {
            query += ` AND status = $${paramIndex}`;
            params.push(filters.status);
            paramIndex++;
        }

        if (filters.search) {
            query += ` AND (name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`;
            params.push(`%${filters.search}%`);
            paramIndex++;
        }

        // Pagination
        const limit = filters.limit || 20;
        const offset = ((filters.page || 1) - 1) * limit;
        
        query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await database.query(query, params);
        return result.rows;
    }

    async create(userData) {
        const { name, email, password, role } = userData;
        const result = await database.query(
            `INSERT INTO users (name, email, password, role) 
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [name, email, password, role]
        );
        return result.rows[0];
    }

    async update(id, userData) {
        const updates = [];
        const params = [];
        let paramIndex = 1;

        for (const [key, value] of Object.entries(userData)) {
            if (value !== undefined) {
                updates.push(`${key} = $${paramIndex}`);
                params.push(value);
                paramIndex++;
            }
        }

        if (updates.length === 0) return null;

        updates.push('updated_at = NOW()');
        params.push(id);

        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
        
        const result = await database.query(query, params);
        return result.rows[0];
    }

    async delete(id) {
        await database.query('DELETE FROM users WHERE id = $1', [id]);
    }

    async count(filters = {}) {
        let query = 'SELECT COUNT(*) FROM users WHERE 1=1';
        const params = [];
        let paramIndex = 1;

        if (filters.role) {
            query += ` AND role = $${paramIndex}`;
            params.push(filters.role);
            paramIndex++;
        }

        const result = await database.query(query, params);
        return parseInt(result.rows[0].count);
    }
}

module.exports = new UserRepository();
```

### Middleware de connexion

```javascript
// middleware/database.js
const database = require('../configuration/database');

// Middleware pour attacher la connexion à la requête
async function attachDatabase(req, res, next) {
    req.db = database;
    next();
}

// Middleware de transaction automatique
async function withTransaction(req, res, next) {
    const client = await database.getClient();
    
    try {
        await client.query('BEGIN');
        req.dbClient = client;
        
        // Attacher la transaction à la réponse pour le rollback en cas d'erreur
        res.on('finish', async () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                await client.query('COMMIT');
            } else {
                await client.query('ROLLBACK');
            }
            client.release();
        });
        
        next();
    } catch (error) {
        client.release();
        next(error);
    }
}
```

## 📊 Monitoring et administration

### Script de monitoring

```javascript
// scripts/monitor-db.js
const database = require('../src/configuration/database');

async function monitorDatabase() {
    try {
        await database.initialize();
        
        // Health check
        const health = await database.healthCheck();
        console.log('Santé de la DB:', health);
        
        // Statistiques du pool
        const stats = database.getPoolStats();
        console.log('Statistiques pool:', stats);
        
        // Taille des tables principales
        const tables = ['users', 'orders', 'products'];
        for (const table of tables) {
            const exists = await database.tableExists(table);
            if (exists) {
                const size = await database.getTableSize(table);
                console.log(`Taille de ${table}:`, size);
            }
        }
        
        await database.close();
    } catch (error) {
        console.error('Erreur de monitoring:', error);
    }
}

monitorDatabase();
```

### Script de backup

```javascript
// scripts/backup.js
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs');
const path = require('path');

async function backupDatabase() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(__dirname, `../backups/backup-${timestamp}.sql`);
    
    // S'assurer que le dossier backups existe
    if (!fs.existsSync(path.dirname(backupFile))) {
        fs.mkdirSync(path.dirname(backupFile), { recursive: true });
    }
    
    const command = `PGPASSWORD=${process.env.DB_PASSWORD} pg_dump -h ${process.env.DB_HOST} -p ${process.env.DB_PORT} -U ${process.env.DB_USER} -d ${process.env.DB_NAME} -F c -f ${backupFile}`;
    
    try {
        await execPromise(command);
        console.log(`✅ Backup créé: ${backupFile}`);
        
        // Compresser le backup
        await execPromise(`gzip ${backupFile}`);
        console.log(`✅ Backup compressé: ${backupFile}.gz`);
        
        return `${backupFile}.gz`;
    } catch (error) {
        console.error('❌ Erreur backup:', error);
        throw error;
    }
}

backupDatabase();
```

## 🧪 Tests

### Tests unitaires

```javascript
// tests/database.test.js
const database = require('../src/configuration/database');

describe('Database', () => {
    beforeAll(async () => {
        await database.initialize();
    });

    afterAll(async () => {
        await database.close();
    });

    test('should connect to database', () => {
        expect(database.isConnected()).toBe(true);
    });

    test('should execute query', async () => {
        const result = await database.query('SELECT 1+1 as sum');
        expect(result.rows[0].sum).toBe(2);
    });

    test('should handle parameters', async () => {
        const result = await database.query(
            'SELECT $1::text as name, $2::int as age',
            ['John', 30]
        );
        expect(result.rows[0]).toEqual({ name: 'John', age: 30 });
    });

    test('should handle errors gracefully', async () => {
        await expect(database.query('INVALID SQL')).rejects.toThrow();
    });

    test('should execute transaction', async () => {
        const result = await database.transaction(async (client) => {
            await client.query('CREATE TEMP TABLE test (id int)');
            await client.query('INSERT INTO test VALUES (1)');
            const res = await client.query('SELECT * FROM test');
            return res.rows;
        });

        expect(result).toEqual([{ id: 1 }]);
    });

    test('should rollback on error', async () => {
        let error;
        
        try {
            await database.transaction(async (client) => {
                await client.query('CREATE TEMP TABLE test_rollback (id int)');
                await client.query('INSERT INTO test_rollback VALUES (1)');
                throw new Error('Test rollback');
            });
        } catch (e) {
            error = e;
        }

        expect(error).toBeDefined();
        expect(error.message).toBe('Test rollback');
    });

    test('should get pool stats', () => {
        const stats = database.getPoolStats();
        expect(stats).toHaveProperty('totalCount');
        expect(stats).toHaveProperty('idleCount');
        expect(stats).toHaveProperty('waitingCount');
        expect(stats.connected).toBe(true);
    });

    test('should check table existence', async () => {
        const exists = await database.tableExists('users');
        expect(typeof exists).toBe('boolean');
    });

    test('should get table size', async () => {
        if (await database.tableExists('users')) {
            const size = await database.getTableSize('users');
            expect(typeof size).toBe('string');
        }
    });

    test('should perform health check', async () => {
        const health = await database.healthCheck();
        expect(health.status).toBe('healthy');
        expect(health.latency).toBeDefined();
        expect(health.pool).toBeDefined();
    });
});
```

### Tests d'intégration

```javascript
// tests/integration/database.integration.test.js
const database = require('../../src/configuration/database');

describe('Database Integration', () => {
    let testUserId;

    beforeAll(async () => {
        await database.initialize();
        
        // Créer table de test si elle n'existe pas
        await database.query(`
            CREATE TABLE IF NOT EXISTS test_users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100),
                email VARCHAR(100) UNIQUE,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
    });

    afterAll(async () => {
        // Nettoyer
        await database.query('DROP TABLE IF EXISTS test_users');
        await database.close();
    });

    beforeEach(async () => {
        // Nettoyer avant chaque test
        await database.query('DELETE FROM test_users');
    });

    test('CRUD operations', async () => {
        // Create
        const createResult = await database.query(
            'INSERT INTO test_users (name, email) VALUES ($1, $2) RETURNING *',
            ['John Doe', 'john@test.com']
        );
        const user = createResult.rows[0];
        expect(user.name).toBe('John Doe');
        testUserId = user.id;

        // Read
        const readResult = await database.query(
            'SELECT * FROM test_users WHERE id = $1',
            [testUserId]
        );
        expect(readResult.rows[0].email).toBe('john@test.com');

        // Update
        const updateResult = await database.query(
            'UPDATE test_users SET name = $1 WHERE id = $2 RETURNING *',
            ['Jane Doe', testUserId]
        );
        expect(updateResult.rows[0].name).toBe('Jane Doe');

        // Delete
        await database.query('DELETE FROM test_users WHERE id = $1', [testUserId]);
        const checkResult = await database.query(
            'SELECT * FROM test_users WHERE id = $1',
            [testUserId]
        );
        expect(checkResult.rows.length).toBe(0);
    });

    test('parallel queries', async () => {
        // Insérer des données de test
        await database.query(
            'INSERT INTO test_users (name, email) VALUES ($1, $2), ($3, $4)',
            ['User1', 'user1@test.com', 'User2', 'user2@test.com']
        );

        const queries = [
            { text: 'SELECT COUNT(*) FROM test_users' },
            { text: 'SELECT * FROM test_users WHERE name = $1', params: ['User1'] }
        ];

        const results = await database.parallel(queries);
        
        expect(results[0].rows[0].count).toBe('2');
        expect(results[1].rows[0].name).toBe('User1');
    });

    test('stream query', async () => {
        // Insérer des données de test
        for (let i = 1; i <= 10; i++) {
            await database.query(
                'INSERT INTO test_users (name, email) VALUES ($1, $2)',
                [`User${i}`, `user${i}@test.com`]
            );
        }

        let rowCount = 0;
        await database.queryStream(
            'SELECT * FROM test_users ORDER BY id',
            [],
            () => {
                rowCount++;
            }
        );

        expect(rowCount).toBe(10);
    });
});
```

## 🔒 Bonnes pratiques

### 1. Gestion des connexions

```javascript
// Toujours libérer les clients
const client = await database.getClient();
try {
    // Utiliser le client
} finally {
    client.release(); // Important !
}

// Utiliser les transactions avec auto-release
await database.transaction(async (client) => {
    // Le client est automatiquement libéré
});
```

### 2. Prévention des injections SQL

```javascript
// ❌ À éviter
const query = `SELECT * FROM users WHERE name = '${userInput}'`;

// ✅ À utiliser
const result = await database.query(
    'SELECT * FROM users WHERE name = $1',
    [userInput]
);
```

### 3. Pagination efficace

```javascript
async function paginate(table, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    
    // Requête optimisée avec count séparé pour les grands datasets
    const [dataResult, countResult] = await database.parallel([
        { 
            text: `SELECT * FROM ${table} ORDER BY id LIMIT $1 OFFSET $2`,
            params: [limit, offset]
        },
        { 
            text: `SELECT COUNT(*) FROM ${table}`
        }
    ]);

    return {
        data: dataResult.rows,
        pagination: {
            page,
            limit,
            total: parseInt(countResult.rows[0].count),
            pages: Math.ceil(countResult.rows[0].count / limit)
        }
    };
}
```

### 4. Indexation

```javascript
// Vérifier et créer les index manquants
async function ensureIndexes() {
    const indexes = [
        {
            name: 'idx_users_email',
            table: 'users',
            column: 'email'
        },
        {
            name: 'idx_orders_user_id',
            table: 'orders',
            column: 'user_id'
        },
        {
            name: 'idx_orders_created_at',
            table: 'orders',
            column: 'created_at'
        }
    ];

    for (const idx of indexes) {
        const exists = await database.query(`
            SELECT 1 FROM pg_indexes 
            WHERE tablename = $1 AND indexname = $2
        `, [idx.table, idx.name]);

        if (exists.rows.length === 0) {
            await database.query(
                `CREATE INDEX ${idx.name} ON ${idx.table} (${idx.column})`
            );
            logger.info(`Index créé: ${idx.name}`);
        }
    }
}
```

### 5. Validation des données

```javascript
// middleware/validateQuery.js
function validateQueryParams(schema) {
    return (req, res, next) => {
        const { error } = schema.validate(req.query);
        
        if (error) {
            return res.status(400).json({
                error: 'Paramètres de requête invalides',
                details: error.details
            });
        }
        
        next();
    };
}

// Utilisation
const userQuerySchema = Joi.object({
    page: Joi.number().min(1).default(1),
    limit: Joi.number().min(1).max(100).default(20),
    sort: Joi.string().valid('name', 'email', 'created_at'),
    order: Joi.string().valid('ASC', 'DESC').default('ASC')
});

app.get('/users', 
    validateQueryParams(userQuerySchema),
    async (req, res) => {
        const { page, limit, sort, order } = req.query;
        // Construire la requête SQL sécurisée
    }
);
```

## 📈 Performance et optimisation

### Analyse des requêtes lentes

```javascript
// Activer le logging des requêtes lentes
async function analyzeSlowQueries() {
    const result = await database.query(`
        SELECT 
            query,
            calls,
            total_time / calls as avg_time,
            rows / calls as avg_rows
        FROM pg_stat_statements
        WHERE total_time / calls > 100
        ORDER BY avg_time DESC
        LIMIT 10
    `);
    
    return result.rows;
}
```

### Vérification des locks

```javascript
async function checkLocks() {
    const result = await database.query(`
        SELECT 
            pid,
            usename,
            application_name,
            client_addr,
            state,
            query,
            wait_event_type,
            wait_event,
            age(now(), query_start) as query_duration
        FROM pg_stat_activity
        WHERE state = 'active' 
        AND wait_event_type IS NOT NULL
        ORDER BY query_duration DESC
    `);
    
    return result.rows;
}
```

### Taille des tables et index

```javascript
async function getDatabaseSize() {
    const result = await database.query(`
        SELECT
            relname as table_name,
            pg_size_pretty(pg_total_relation_size(relid)) as total_size,
            pg_size_pretty(pg_relation_size(relid)) as table_size,
            pg_size_pretty(pg_indexes_size(relid)) as index_size,
            n_live_tup as rows_estimate
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
    `);
    
    return result.rows;
}
```

## 🔄 Migration et versioning

### Script de migration

```javascript
// migrations/001_create_users.js
module.exports = {
    up: async (database) => {
        await database.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'user',
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);

        await database.query(`
            CREATE INDEX idx_users_email ON users(email);
            CREATE INDEX idx_users_role ON users(role);
        `);
    },

    down: async (database) => {
        await database.query('DROP TABLE IF EXISTS users');
    }
};
```

### Gestionnaire de migrations

```javascript
// scripts/migrate.js
const database = require('../src/configuration/database');
const fs = require('fs');
const path = require('path');

class MigrationManager {
    constructor() {
        this.migrationsTable = 'migrations';
    }

    async init() {
        await database.initialize();
        
        // Créer la table des migrations si elle n'existe pas
        await database.query(`
            CREATE TABLE IF NOT EXISTS ${this.migrationsTable} (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) UNIQUE NOT NULL,
                executed_at TIMESTAMP DEFAULT NOW()
            )
        `);
    }

    async getExecutedMigrations() {
        const result = await database.query(
            `SELECT name FROM ${this.migrationsTable} ORDER BY id`
        );
        return result.rows.map(r => r.name);
    }

    async migrate(direction = 'up') {
        await this.init();
        
        const executed = await this.getExecutedMigrations();
        const migrationsDir = path.join(__dirname, '../migrations');
        const migrationFiles = fs.readdirSync(migrationsDir).sort();
        
        for (const file of migrationFiles) {
            const migrationName = file.replace('.js', '');
            
            if (direction === 'up' && !executed.includes(migrationName)) {
                console.log(`Exécution migration: ${migrationName}`);
                
                const migration = require(path.join(migrationsDir, file));
                await migration.up(database);
                
                await database.query(
                    `INSERT INTO ${this.migrationsTable} (name) VALUES ($1)`,
                    [migrationName]
                );
                
                console.log(`✅ Migration ${migrationName} exécutée`);
            }
            
            if (direction === 'down' && executed.includes(migrationName)) {
                console.log(`Annulation migration: ${migrationName}`);
                
                const migration = require(path.join(migrationsDir, file));
                await migration.down(database);
                
                await database.query(
                    `DELETE FROM ${this.migrationsTable} WHERE name = $1`,
                    [migrationName]
                );
                
                console.log(`✅ Migration ${migrationName} annulée`);
            }
        }
        
        await database.close();
    }
}

// Usage: node migrate.js up
const manager = new MigrationManager();
manager.migrate(process.argv[2] || 'up');
```

## 🚨 Gestion des erreurs

### Types d'erreurs courantes

```javascript
// Gestionnaire d'erreurs spécifiques à PostgreSQL
function handleDatabaseError(error) {
    // Erreurs de connexion
    if (error.code === 'ECONNREFUSED') {
        return {
            status: 503,
            message: 'Base de données indisponible',
            retry: true
        };
    }
    
    // Violation de contrainte unique
    if (error.code === '23505') {
        const match = error.detail.match(/Key \((.*)\)=\((.*)\)/);
        return {
            status: 409,
            message: `La valeur ${match[2]} pour ${match[1]} existe déjà`,
            field: match[1]
        };
    }
    
    // Violation de clé étrangère
    if (error.code === '23503') {
        return {
            status: 400,
            message: 'Référence à une ressource inexistante'
        };
    }
    
    // Valeur NULL non autorisée
    if (error.code === '23502') {
        return {
            status: 400,
            message: `Le champ ${error.column} est requis`
        };
    }
    
    // Timeout
    if (error.code === '57014') {
        return {
            status: 504,
            message: 'La requête a pris trop de temps'
        };
    }
    
    // Erreur par défaut
    return {
        status: 500,
        message: 'Erreur interne de la base de données'
    };
}

// Middleware de gestion d'erreurs
function databaseErrorHandler(err, req, res, next) {
    if (err.code && err.code.startsWith('23')) {
        const handled = handleDatabaseError(err);
        return res.status(handled.status).json({
            error: handled.message,
            field: handled.field
        });
    }
    next(err);
}
```

## 📚 API Reference

### Propriétés

| Propriété | Type | Description |
|-----------|------|-------------|
| `pool` | Pool | Instance du pool PostgreSQL |
| `connected` | boolean | État de la connexion |

### Méthodes principales

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `initialize()` | - | Promise<void> | Initialise la connexion |
| `query(text, params)` | `string, any[]` | Promise<QueryResult> | Exécute une requête |
| `transaction(callback)` | `Function` | Promise<any> | Exécute en transaction |
| `getClient()` | - | Promise<Client> | Obtient un client |
| `close()` | - | Promise<void> | Ferme les connexions |
| `isConnected()` | - | boolean | Vérifie la connexion |

### Méthodes avancées

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `queryStream(text, params, rowHandler)` | `string, any[], Function` | Promise<void> | Streaming de résultats |
| `parallel(queries)` | `Array<{text, params}>` | Promise<QueryResult[]> | Requêtes parallèles |
| `tableExists(tableName)` | `string` | Promise<boolean> | Vérifie existence table |
| `getTableSize(tableName)` | `string` | Promise<string> | Taille d'une table |
| `getPoolStats()` | - | Object | Statistiques du pool |
| `healthCheck()` | - | Object | État de santé |

## 🆘 Dépannage

### Problèmes courants

1. **Connexion refusée**
```javascript
// Erreur: ECONNREFUSED
// Vérifier:
// - PostgreSQL est-il en cours d'exécution ?
// - Les identifiants sont-ils corrects ?
// - Le port est-il accessible ?
```

2. **Timeout de connexion**
```javascript
// Augmenter le timeout de connexion
connectionTimeoutMillis: 10000 // 10 secondes au lieu de 2
```

3. **Trop de connexions**
```javascript
// Vérifier le nombre de connexions
SELECT count(*) FROM pg_stat_activity;

// Ajuster max_connections dans postgresql.conf
// Ou réduire DB_POOL_MAX
```

4. **Requêtes lentes**
```javascript
// Analyser avec EXPLAIN
const result = await database.query(
    'EXPLAIN ANALYZE ' + query,
    params
);
console.log(result.rows);
```

### Commandes utiles

```bash
# Se connecter à PostgreSQL
psql -h localhost -U postgres -d mon_projet

# Lister les bases de données
\l

# Lister les connexions actives
SELECT * FROM pg_stat_activity;

# Terminer une connexion bloquée
SELECT pg_terminate_backend(pid);

# Voir la taille des bases
SELECT pg_database_size('mon_projet')/1024/1024 as size_mb;
```

## 🎯 Conclusion

Ce module de base de données offre une solution complète pour interagir avec PostgreSQL avec :

- ✅ **Pool de connexions** optimisé
- ✅ **Transactions** ACID
- ✅ **Streaming** pour gros volumes
- ✅ **Monitoring** et statistiques
- ✅ **Health check** intégré
- ✅ **Gestion d'erreurs** avancée
- ✅ **Requêtes parallèles**
- ✅ **Support des migrations**
- ✅ **Documentation exhaustive**

Il constitue une fondation solide pour toute application nécessitant une interaction robuste avec PostgreSQL.
```