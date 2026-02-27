// src/services/security/TokenService.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../../configuration/env');
const { AuthenticationError } = require('../../utils/errors/AppError');

class TokenService {
  constructor() {
    // Log de débogage pour vérifier la structure
    console.log('🔐 Environnement chargé:', {
      JWT_SECRET: env.JWT_SECRET ? '✅ présent' : '❌ manquant',
      JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET ? '✅ présent' : '❌ manquant',
      JWT_EXPIRES_IN: env.JWT_EXPIRES_IN,
      JWT_REFRESH_EXPIRES_IN: env.JWT_REFRESH_EXPIRES_IN,
      NODE_ENV: env.NODE_ENV
    });
  }

  // ─────────────────────────────────────────────
  // Génération
  // ─────────────────────────────────────────────

  /**
   * Génère un access token JWT
   * @param {Object} payload - données à encoder (id, role, etc.)
   */
  generateAccessToken(payload) {
    // Vérifier que le secret existe
    if (!env.JWT_SECRET) {
      throw new Error('JWT_SECRET non défini dans la configuration');
    }

    return jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN || '24h',
      issuer: 'KlikUp-api',
    });
  }

  /**
   * Génère un refresh token JWT
   */
  generateRefreshToken(payload) {
    // Vérifier que le refresh secret existe
    if (!env.JWT_REFRESH_SECRET) {
      throw new Error('JWT_REFRESH_SECRET non défini dans la configuration');
    }

    return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN || '7d',
      issuer: 'KlikUp-api',
    });
  }

  /**
   * Génère un code numérique à 6 chiffres (2FA, vérification email)
   */
  generateOtpCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Génère un token aléatoire sécurisé (ex: reset password)
   */
  generateSecureToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
  }

  /**
   * Hash d'un token pour stockage en base (SHA-256)
   */
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // ─────────────────────────────────────────────
  // Vérification
  // ─────────────────────────────────────────────

  /**
   * Vérifie et décode un access token
   * @returns {Object} payload décodé
   * @throws {AuthenticationError} si invalide ou expiré
   */
  verifyAccessToken(token) {
    try {
      return jwt.verify(token, env.JWT_SECRET, { issuer: 'KlikUp-api' });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new AuthenticationError('Token expiré, veuillez vous reconnecter');
      }
      if (err.name === 'JsonWebTokenError') {
        throw new AuthenticationError('Token invalide');
      }
      throw new AuthenticationError(`Erreur de vérification du token: ${err.message}`);
    }
  }

  /**
   * Vérifie et décode un refresh token
   */
  verifyRefreshToken(token) {
    try {
      return jwt.verify(token, env.JWT_REFRESH_SECRET, { issuer: 'KlikUp-api' });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new AuthenticationError('Refresh token expiré, veuillez vous reconnecter');
      }
      if (err.name === 'JsonWebTokenError') {
        throw new AuthenticationError('Refresh token invalide');
      }
      throw new AuthenticationError(`Erreur de vérification du refresh token: ${err.message}`);
    }
  }

  /**
   * Extrait le token depuis le header Authorization (Bearer <token>)
   */
  extractBearerToken(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('Token manquant dans le header Authorization');
    }
    return authHeader.split(' ')[1];
  }

  /**
   * Calcule la date d'expiration d'un OTP (défaut : 15 minutes)
   */
  getOtpExpiration(minutes = 15) {
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  /**
   * Rafraîchir un access token avec un refresh token valide
   */
  refreshAccessToken(refreshToken) {
    try {
      // Vérifier le refresh token
      const decoded = this.verifyRefreshToken(refreshToken);
      
      // Créer un nouveau payload (sans les champs sensibles)
      const payload = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role
      };
      
      // Générer un nouveau access token
      const newAccessToken = this.generateAccessToken(payload);
      
      return {
        accessToken: newAccessToken,
        expiresIn: env.JWT_EXPIRES_IN || '24h'
      };
    } catch (error) {
      throw new AuthenticationError('Impossible de rafraîchir le token: ' + error.message);
    }
  }
}

module.exports = new TokenService();