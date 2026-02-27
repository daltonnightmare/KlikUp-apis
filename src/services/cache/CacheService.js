const redis = require('redis');
const Constants = require('../../configuration/constants');

class CacheService {
  constructor() {
    this.client = null;
    this.defaultTTL = Constants.CONFIG.CACHE.TTL.MEDIUM;
    this.initRedis();
  }

  /**
   * Initialiser la connexion Redis
   */
  initRedis() {
    if (process.env.REDIS_URL) {
      this.client = redis.createClient({
        url: process.env.REDIS_URL,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.error('Trop de tentatives de reconnexion Redis');
              return new Error('Trop de tentatives');
            }
            return Math.min(retries * 100, 3000);
          }
        }
      });

      this.client.on('error', (err) => {
        console.error('Erreur Redis:', err);
      });

      this.client.on('connect', () => {
        console.log('Connecté à Redis');
      });

      this.client.connect().catch(console.error);
    } else {
      console.warn('Redis non configuré, utilisation du cache mémoire');
      this.memoryCache = new Map();
    }
  }

  /**
   * Générer une clé de cache
   */
  generateKey(parts) {
    return parts.join(':');
  }

  /**
   * Récupérer une valeur du cache
   */
  async get(key) {
    try {
      if (this.client?.isReady) {
        const value = await this.client.get(key);
        return value ? JSON.parse(value) : null;
      } else if (this.memoryCache) {
        const item = this.memoryCache.get(key);
        if (item && item.expiry > Date.now()) {
          return item.value;
        }
        this.memoryCache.delete(key);
        return null;
      }
      return null;
    } catch (error) {
      console.error('Erreur lecture cache:', error);
      return null;
    }
  }

  /**
   * Enregistrer une valeur dans le cache
   */
  async set(key, value, ttl = this.defaultTTL) {
    try {
      const serialized = JSON.stringify(value);
      
      if (this.client?.isReady) {
        if (ttl) {
          await this.client.setEx(key, ttl, serialized);
        } else {
          await this.client.set(key, serialized);
        }
      } else if (this.memoryCache) {
        this.memoryCache.set(key, {
          value,
          expiry: ttl ? Date.now() + (ttl * 1000) : Infinity
        });
      }
      
      return true;
    } catch (error) {
      console.error('Erreur écriture cache:', error);
      return false;
    }
  }

  /**
   * Supprimer une clé du cache
   */
  async del(key) {
    try {
      if (this.client?.isReady) {
        await this.client.del(key);
      } else if (this.memoryCache) {
        this.memoryCache.delete(key);
      }
      return true;
    } catch (error) {
      console.error('Erreur suppression cache:', error);
      return false;
    }
  }

  /**
   * Supprimer des clés par pattern
   */
  async delPattern(pattern) {
    try {
      if (this.client?.isReady) {
        const keys = await this.client.keys(pattern);
        if (keys.length > 0) {
          await this.client.del(keys);
        }
        return keys.length;
      } else if (this.memoryCache) {
        let count = 0;
        const patternRegex = new RegExp(pattern.replace('*', '.*'));
        
        for (const key of this.memoryCache.keys()) {
          if (patternRegex.test(key)) {
            this.memoryCache.delete(key);
            count++;
          }
        }
        return count;
      }
      return 0;
    } catch (error) {
      console.error('Erreur suppression pattern cache:', error);
      return 0;
    }
  }

  /**
   * Vérifier si une clé existe
   */
  async exists(key) {
    try {
      if (this.client?.isReady) {
        return await this.client.exists(key) > 0;
      } else if (this.memoryCache) {
        const item = this.memoryCache.get(key);
        return !!(item && item.expiry > Date.now());
      }
      return false;
    } catch (error) {
      console.error('Erreur vérification existence:', error);
      return false;
    }
  }

  /**
   * Récupérer ou calculer une valeur
   */
  async remember(key, ttl, callback) {
    const cached = await this.get(key);
    
    if (cached !== null) {
      return cached;
    }

    const value = await callback();
    await this.set(key, value, ttl);
    return value;
  }

  /**
   * Incrémenter un compteur
   */
  async increment(key, amount = 1) {
    try {
      if (this.client?.isReady) {
        return await this.client.incrBy(key, amount);
      } else if (this.memoryCache) {
        const current = this.memoryCache.get(key)?.value || 0;
        const newValue = current + amount;
        this.memoryCache.set(key, {
          value: newValue,
          expiry: Infinity
        });
        return newValue;
      }
      return null;
    } catch (error) {
      console.error('Erreur incrémentation:', error);
      return null;
    }
  }

  /**
   * Récupérer plusieurs clés
   */
  async getMany(keys) {
    try {
      if (this.client?.isReady) {
        const values = await this.client.mGet(keys);
        return values.map(v => v ? JSON.parse(v) : null);
      } else if (this.memoryCache) {
        return keys.map(key => {
          const item = this.memoryCache.get(key);
          return (item && item.expiry > Date.now()) ? item.value : null;
        });
      }
      return keys.map(() => null);
    } catch (error) {
      console.error('Erreur lecture multiple:', error);
      return keys.map(() => null);
    }
  }

  /**
   * Enregistrer plusieurs valeurs
   */
  async setMany(entries, ttl = this.defaultTTL) {
    try {
      if (this.client?.isReady) {
        const pipeline = this.client.multi();
        
        for (const [key, value] of entries) {
          const serialized = JSON.stringify(value);
          if (ttl) {
            pipeline.setEx(key, ttl, serialized);
          } else {
            pipeline.set(key, serialized);
          }
        }
        
        await pipeline.exec();
      } else if (this.memoryCache) {
        for (const [key, value] of entries) {
          this.memoryCache.set(key, {
            value,
            expiry: ttl ? Date.now() + (ttl * 1000) : Infinity
          });
        }
      }
      
      return true;
    } catch (error) {
      console.error('Erreur écriture multiple:', error);
      return false;
    }
  }

  /**
   * Vider tout le cache
   */
  async flush() {
    try {
      if (this.client?.isReady) {
        await this.client.flushAll();
      } else if (this.memoryCache) {
        this.memoryCache.clear();
      }
      return true;
    } catch (error) {
      console.error('Erreur vidage cache:', error);
      return false;
    }
  }

  /**
   * Obtenir les statistiques du cache
   */
  async getStats() {
    try {
      if (this.client?.isReady) {
        const info = await this.client.info();
        // Parser les stats Redis
        return { type: 'redis', info };
      } else if (this.memoryCache) {
        return {
          type: 'memory',
          size: this.memoryCache.size,
          keys: Array.from(this.memoryCache.keys())
        };
      }
      return { type: 'none' };
    } catch (error) {
      console.error('Erreur stats cache:', error);
      return null;
    }
  }
}

module.exports = new CacheService();