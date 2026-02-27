// src/controllers/public/HealthController.js
const database = require('../../configuration/database'); // ← Importer database, pas sequelize
const logger = require('../../configuration/logger');
const { version } = require('../../../package.json');

class HealthController {
  /**
   * Health check basique
   */
  async health(req, res) {
    try {
      const healthcheck = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version,
        environment: process.env.NODE_ENV || 'development',
        services: {
          database: 'pending',
          redis: 'pending'
        }
      };

      // ✅ CORRECTION: Utiliser database.query au lieu de sequelize.query
      try {
        await database.query('SELECT 1');
        healthcheck.services.database = 'healthy';
      } catch (error) {
        healthcheck.services.database = 'unhealthy';
        healthcheck.status = 'DEGRADED';
        logger.error('Database health check failed:', error);
      }

      // Vérification Redis
      try {
        const redis = require('../../configuration/redis');
        if (redis.isConnected && redis.isConnected()) {
          healthcheck.services.redis = 'healthy';
        } else {
          healthcheck.services.redis = 'unhealthy';
        }
      } catch (error) {
        healthcheck.services.redis = 'unhealthy';
      }

      res.status(healthcheck.status === 'OK' ? 200 : 503).json(healthcheck);
    } catch (error) {
      logger.error('Health check error:', error);
      res.status(500).json({
        status: 'ERROR',
        timestamp: new Date().toISOString(),
        error: error.message
      });
    }
  }

  /**
   * Health check détaillé pour monitoring
   */
  async detailed(req, res) {
    const isInternal = req.headers['x-monitoring-token'] === process.env.MONITORING_TOKEN;
    
    if (!isInternal) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    try {
      const startTime = Date.now();
      
      // ✅ CORRECTION: Utiliser database.query partout
      const dbTests = await this.runDatabaseTests();
      
      const systemStats = {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        loadavg: process.loadavg()
      };

      const responseTime = Date.now() - startTime;

      const detailedHealth = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime}ms`,
        version,
        environment: process.env.NODE_ENV,
        database: dbTests,
        system: systemStats,
        uptime: process.uptime()
      };

      const hasIssues = Object.values(dbTests).some(test => test.status !== 'OK');
      if (hasIssues) {
        detailedHealth.status = 'DEGRADED';
      }

      res.status(hasIssues ? 503 : 200).json(detailedHealth);
    } catch (error) {
      logger.error('Detailed health check error:', error);
      res.status(500).json({
        status: 'ERROR',
        timestamp: new Date().toISOString(),
        error: error.message
      });
    }
  }

  /**
   * Exécute les tests de base de données
   */
  async runDatabaseTests() {
    const tests = {
      connection: { status: 'PENDING' },
      postgis: { status: 'PENDING' },
      extensions: { status: 'PENDING' },
      performance: { status: 'PENDING' }
    };

    try {
      // ✅ CORRECTION: database.query retourne { rows, ... }
      const connResult = await database.query('SELECT 1 as test');
      tests.connection = {
        status: 'OK',
        details: 'Query successful',
        rows: connResult.rows
      };

      // Test PostGIS
      try {
        const postgisResult = await database.query(`
          SELECT postgis_version() as version, 
                 postgis_full_version() as full_version
        `);
        tests.postgis = {
          status: 'OK',
          version: postgisResult.rows[0]?.version || 'unknown',
          details: 'PostGIS is available'
        };
      } catch (error) {
        tests.postgis = {
          status: 'WARNING',
          details: 'PostGIS non installé',
          error: error.message
        };
      }

      // Vérification des extensions
      const extensions = await database.query(`
        SELECT extname, extversion 
        FROM pg_extension 
        WHERE extname IN ('uuid-ossp', 'pgcrypto', 'postgis')
      `);
      
      const extMap = {};
      extensions.rows.forEach(ext => {
        extMap[ext.extname] = ext.extversion;
      });

      const missingExts = ['uuid-ossp', 'pgcrypto', 'postgis']
        .filter(ext => !extMap[ext]);

      tests.extensions = {
        status: missingExts.length === 0 ? 'OK' : 'WARNING',
        installed: extMap,
        missing: missingExts
      };

      // Test performance
      const perfStart = Date.now();
      
      await database.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_name = 'plateforme'
        ) as plateforme_exists
      `);
      
      const perfTime = Date.now() - perfStart;
      tests.performance = {
        status: perfTime < 100 ? 'OK' : 'WARNING',
        responseTime: `${perfTime}ms`,
        threshold: '100ms'
      };

    } catch (error) {
      logger.error('Database tests failed:', error);
      tests.connection = {
        status: 'ERROR',
        error: error.message
      };
    }

    return tests;
  }

  /**
   * Ping simple (pour load balancers)
   */
  ping(req, res) {
    res.status(200).send('pong');
  }
}

module.exports = new HealthController();