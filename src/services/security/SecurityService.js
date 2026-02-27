const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const Constants = require('../../configuration/constants');
const {
  CompteModel,
  SessionModel,
  TokenRevogueModel,
  AlerteSecuriteModel,
  HistoriqueConnexionModel
} = require('../../models');
const AuditService = require('../audit/AuditService');
const CacheService = require('../cache/CacheService');
const NotificationService = require('../notification/NotificationService');

class SecurityService {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET;
    this.jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
    this.encryptionKey = process.env.ENCRYPTION_KEY;
    this.init();
  }

  /**
   * Initialiser le service
   */
  init() {
    if (!this.jwtSecret || !this.jwtRefreshSecret || !this.encryptionKey) {
      console.warn('Clés de sécurité manquantes dans les variables d\'environnement');
    }
  }

  /**
   * Hasher un mot de passe
   */
  async hashPassword(password) {
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  /**
   * Vérifier un mot de passe
   */
  async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  /**
   * Générer un token JWT
   */
  generateToken(payload, options = {}) {
    const {
      expiresIn = Constants.CONFIG.SECURITY.SESSION_DURATION / 1000 + 's',
      type = 'access'
    } = options;

    const secret = type === 'refresh' ? this.jwtRefreshSecret : this.jwtSecret;
    
    return jwt.sign(payload, secret, { expiresIn });
  }

  /**
   * Vérifier un token JWT
   */
  verifyToken(token, type = 'access') {
    try {
      const secret = type === 'refresh' ? this.jwtRefreshSecret : this.jwtSecret;
      return jwt.verify(token, secret);
    } catch (error) {
      return null;
    }
  }

  /**
   * Générer une paire de tokens
   */
  generateTokenPair(payload) {
    const accessToken = this.generateToken(payload, { type: 'access' });
    const refreshToken = this.generateToken(payload, { 
      type: 'refresh',
      expiresIn: Constants.CONFIG.SECURITY.REFRESH_TOKEN_DURATION / 1000 + 's'
    });

    return { accessToken, refreshToken };
  }

  /**
   * Rafraîchir un token
   */
  async refreshToken(refreshToken) {
    const decoded = this.verifyToken(refreshToken, 'refresh');
    
    if (!decoded) {
      throw new Error('Token de rafraîchissement invalide');
    }

    // Vérifier si le token est révoqué
    const isRevoked = await TokenRevogueModel.isRevoked(refreshToken);
    if (isRevoked) {
      throw new Error('Token de rafraîchissement révoqué');
    }

    // Générer une nouvelle paire
    const newPayload = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role
    };

    return this.generateTokenPair(newPayload);
  }

  /**
   * Révoquer un token
   */
  async revokeToken(token, compteId, motif = 'LOGOUT') {
    return TokenRevogueModel.revoke(token, compteId, motif);
  }

  /**
   * Générer un code OTP
   */
  generateOTP() {
    return crypto.randomInt(100000, 999999).toString();
  }

  /**
   * Générer un secret pour 2FA
   */
  generate2FASecret(email) {
    const secret = speakeasy.generateSecret({
      name: `Plateforme:${email}`
    });

    return {
      secret: secret.base32,
      otpauth_url: secret.otpauth_url
    };
  }

  /**
   * Vérifier un code 2FA
   */
  verify2FACode(secret, token) {
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 2
    });
  }

  /**
   * Générer un QR code pour 2FA
   */
  async generate2FAQRCode(otpauth_url) {
    return QRCode.toDataURL(otpauth_url);
  }

  /**
   * Chiffrer des données sensibles
   */
  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      Buffer.from(this.encryptionKey, 'hex'),
      iv
    );

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      encrypted,
      authTag: authTag.toString('hex')
    };
  }

  /**
   * Déchiffrer des données sensibles
   */
  decrypt(encryptedData) {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(this.encryptionKey, 'hex'),
      Buffer.from(encryptedData.iv, 'hex')
    );

    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Valider la force d'un mot de passe
   */
  validatePasswordStrength(password) {
    const checks = {
      length: password.length >= Constants.CONFIG.VALIDATION.PASSWORD_MIN_LENGTH,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)
    };

    const score = Object.values(checks).filter(Boolean).length;
    
    return {
      isValid: score >= 4, // Au moins 4 critères sur 5
      score,
      checks,
      message: this.getPasswordStrengthMessage(score)
    };
  }

  /**
   * Obtenir le message de force du mot de passe
   */
  getPasswordStrengthMessage(score) {
    const messages = {
      0: 'Très faible',
      1: 'Faible',
      2: 'Moyen',
      3: 'Bon',
      4: 'Fort',
      5: 'Très fort'
    };
    return messages[score] || 'Inconnu';
  }

  /**
   * Vérifier les tentatives de connexion
   */
  async checkLoginAttempts(email, ip) {
    const cacheKey = `login_attempts:${email}:${ip}`;
    const attempts = await CacheService.get(cacheKey) || 0;

    if (attempts >= Constants.CONFIG.SECURITY.MAX_LOGIN_ATTEMPTS) {
      return {
        blocked: true,
        remainingTime: Constants.CONFIG.SECURITY.LOCKOUT_DURATION / 1000 / 60,
        attempts
      };
    }

    return {
      blocked: false,
      remainingAttempts: Constants.CONFIG.SECURITY.MAX_LOGIN_ATTEMPTS - attempts,
      attempts
    };
  }

  /**
   * Enregistrer une tentative de connexion
   */
  async recordLoginAttempt(email, ip, success) {
    const cacheKey = `login_attempts:${email}:${ip}`;
    
    if (!success) {
      const attempts = await CacheService.increment(cacheKey);
      await CacheService.set(cacheKey, attempts, Constants.CONFIG.SECURITY.LOCKOUT_DURATION / 1000);
      
      // Détection de brute force
      if (attempts >= Constants.CONFIG.SECURITY.MAX_LOGIN_ATTEMPTS) {
        await this.detectBruteForce(email, ip, attempts);
      }
    } else {
      // Réinitialiser les tentatives en cas de succès
      await CacheService.del(cacheKey);
    }
  }

  /**
   * Détecter une attaque brute force
   */
  async detectBruteForce(email, ip, attempts) {
    const compte = await CompteModel.findByEmail(email);
    
    if (compte) {
      // Créer une alerte de sécurité
      await AlerteSecuriteModel.createAlerte(
        'BRUTE_FORCE',
        attempts >= 10 ? 'CRITIQUE' : 'ELEVE',
        { email, ip, tentatives: attempts },
        compte.id,
        ip
      );

      // Bloquer le compte après 10 tentatives
      if (attempts >= 10) {
        await CompteModel.suspend(compte.id, 'Trop de tentatives de connexion échouées', 24);
        
        // Notifier l'utilisateur
        await NotificationService.send({
          destinataire_id: compte.id,
          type: 'SECURITE',
          canal: 'EMAIL',
          titre: 'Compte verrouillé',
          corps: `Votre compte a été verrouillé après ${attempts} tentatives de connexion échouées.`,
          priorite: 'HAUTE'
        });
      }
    }
  }

  /**
   * Valider une adresse IP
   */
  validateIP(ip) {
    // Liste noire d'IP (à charger depuis la config)
    const blacklist = [];
    
    if (blacklist.includes(ip)) {
      return false;
    }

    return true;
  }

  /**
   * Valider un user agent
   */
  validateUserAgent(userAgent) {
    // Détection des bots malveillants
    const badBots = ['sqlmap', 'nikto', 'nmap', 'zgrab'];
    
    if (badBots.some(bot => userAgent.toLowerCase().includes(bot))) {
      return false;
    }

    return true;
  }

  /**
   * Générer un token CSRF
   */
  generateCSRFToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Valider un token CSRF
   */
  validateCSRFToken(token, sessionToken) {
    // Implémenter la validation CSRF
    return token === sessionToken;
  }

  /**
   * Nettoyer les entrées utilisateur (prévention XSS)
   */
  sanitizeInput(input) {
    if (typeof input === 'string') {
      return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
    }
    
    if (typeof input === 'object' && input !== null) {
      const sanitized = {};
      for (const [key, value] of Object.entries(input)) {
        sanitized[key] = this.sanitizeInput(value);
      }
      return sanitized;
    }
    
    return input;
  }

  /**
   * Vérifier les permissions
   */
  checkPermission(utilisateurRole, permission) {
    return Constants.hasPermission(utilisateurRole, permission);
  }

  /**
   * Vérifier l'accès à une ressource
   */
  async checkResourceAccess(utilisateurId, ressourceType, ressourceId, action) {
    const compte = await CompteModel.findById(utilisateurId);
    
    if (!compte) return false;

    // Admin peut tout faire
    if (compte.compte_role === 'ADMINISTRATEUR_PLATEFORME') {
      return true;
    }

    // Vérifier selon le type de ressource
    switch (ressourceType) {
      case 'COMMANDE':
        return this.checkCommandeAccess(utilisateurId, ressourceId, action);
      
      case 'PRODUIT':
        return this.checkProduitAccess(utilisateurId, ressourceId, action);
      
      case 'COMPTE':
        return utilisateurId === parseInt(ressourceId);
      
      default:
        return false;
    }
  }

  /**
   * Vérifier l'accès à une commande
   */
  async checkCommandeAccess(utilisateurId, commandeId, action) {
    const { CommandeEmplacementFastFoodModel, CommandeBoutiqueModel } = require('../../models');
    
    // Vérifier dans les commandes restaurant
    const commande = await CommandeEmplacementFastFoodModel.findById(commandeId);
    if (commande && commande.compte_id === utilisateurId) {
      return true;
    }

    // Vérifier dans les commandes boutique
    const commandeBoutique = await CommandeBoutiqueModel.findById(commandeId);
    if (commandeBoutique && commandeBoutique.compte_id === utilisateurId) {
      return true;
    }

    return false;
  }

  /**
   * Vérifier l'accès à un produit
   */
  async checkProduitAccess(utilisateurId, produitId, action) {
    const { ProduitBoutiqueModel, CompteModel } = require('../../models');
    
    const produit = await ProduitBoutiqueModel.findById(produitId);
    if (!produit) return false;

    const compte = await CompteModel.findById(utilisateurId);
    
    // Le vendeur propriétaire peut modifier
    if (compte.boutique_id === produit.id_boutique) {
      return true;
    }

    return false;
  }

  /**
   * Journaliser un événement de sécurité
   */
  async logSecurityEvent(type, severity, details, compteId = null, ip = null) {
    return AlerteSecuriteModel.createAlerte(type, severity, details, compteId, ip);
  }

  /**
   * Obtenir les alertes de sécurité
   */
  async getSecurityAlerts(compteId = null, options = {}) {
    if (compteId) {
      return AlerteSecuriteModel.getForCompte(compteId, options);
    }
    
    return AlerteSecuriteModel.getEnAttente(options.limit, options.offset);
  }

  /**
   * Traiter une alerte de sécurité
   */
  async processSecurityAlert(alerteId, moderateurId, action, commentaire) {
    return AlerteSecuriteModel.markAsResolved(alerteId, moderateurId, `${action}: ${commentaire}`);
  }

  /**
   * Vérifier la session d'un utilisateur
   */
  async checkUserSession(utilisateurId, sessionId) {
    const session = await SessionModel.findById(sessionId);
    
    if (!session || !session.est_active || session.compte_id !== utilisateurId) {
      return false;
    }

    if (session.date_expiration < new Date()) {
      return false;
    }

    return true;
  }

  /**
   * Nettoyer les sessions expirées
   */
  async cleanExpiredSessions() {
    return SessionModel.cleanExpired();
  }

  /**
   * Générer un rapport de sécurité
   */
  async generateSecurityReport(periode = '30 days') {
    const [
      connexions,
      alertes,
      tentativesEchouees,
      sessionsActives
    ] = await Promise.all([
      HistoriqueConnexionModel.getStats(periode),
      AlerteSecuriteModel.getUnresolvedBySeverity(),
      this.getFailedLoginStats(periode),
      this.getActiveSessionsStats()
    ]);

    return {
      generated_at: new Date().toISOString(),
      periode,
      resume: {
        total_connexions: connexions.total_connexions,
        taux_succes: connexions.total_connexions > 0 
          ? (connexions.succes / connexions.total_connexions * 100).toFixed(2)
          : 0,
        alertes_non_traitees: alertes.reduce((sum, a) => sum + a.count, 0),
        tentatives_echouees: tentativesEchouees.total,
        sessions_actives: sessionsActives.total
      },
      details: {
        connexions,
        alertes,
        tentatives_par_ip: tentativesEchouees.par_ip,
        sessions_par_utilisateur: sessionsActives.par_utilisateur
      },
      recommandations: await this.generateSecurityRecommendations(alertes, tentativesEchouees)
    };
  }

  /**
   * Obtenir les statistiques des tentatives échouées
   */
  async getFailedLoginStats(periode) {
    const { Database } = require('../../models');
    
    const result = await Database.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT adresse_ip) as ips_distinctes,
        COUNT(DISTINCT compte_id) as comptes_distincts,
        json_agg(json_build_object('ip', adresse_ip, 'count', count)) FILTER (WHERE count > 5) as ips_suspectes
      FROM (
        SELECT adresse_ip, compte_id, COUNT(*) as count
        FROM HISTORIQUE_CONNEXIONS
        WHERE statut_connexion = 'FAILED'
          AND date_connexion >= NOW() - $1::interval
        GROUP BY adresse_ip, compte_id
        HAVING COUNT(*) > 1
      ) as failed_attempts
    `, [periode]);

    return result.rows[0];
  }

  /**
   * Obtenir les statistiques des sessions actives
   */
  async getActiveSessionsStats() {
    const { Database } = require('../../models');
    
    const result = await Database.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT compte_id) as utilisateurs_actifs,
        json_agg(json_build_object('compte_id', compte_id, 'sessions', count)) as par_utilisateur
      FROM SESSIONS
      WHERE est_active = true AND date_expiration > NOW()
      GROUP BY compte_id
    `);

    return result.rows[0] || { total: 0, utilisateurs_actifs: 0, par_utilisateur: [] };
  }

  /**
   * Générer des recommandations de sécurité
   */
  async generateSecurityRecommendations(alertes, failedAttempts) {
    const recommendations = [];

    // Vérifier les alertes critiques
    const alertesCritiques = alertes.find(a => a.severite === 'CRITIQUE');
    if (alertesCritiques?.count > 0) {
      recommendations.push({
        type: 'critical',
        message: `${alertesCritiques.count} alertes critiques en attente. Intervention immédiate requise.`
      });
    }

    // Vérifier les tentatives échouées suspectes
    if (failedAttempts.ips_suspectes?.length > 0) {
      recommendations.push({
        type: 'warning',
        message: `${failedAttempts.ips_suspectes.length} IPs suspectes détectées. Envisager un blocage.`
      });
    }

    // Vérifier le taux d'échec global
    if (failedAttempts.total > 100) {
      recommendations.push({
        type: 'info',
        message: `Taux d'échec élevé (${failedAttempts.total} tentatives). Vérifier la configuration.`
      });
    }

    return recommendations;
  }
}

module.exports = new SecurityService();