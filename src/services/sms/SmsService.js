const Constants = require('../../configuration/constants');
const { FileTacheModel } = require('../../models');

class SmsService {
  constructor() {
    this.provider = process.env.SMS_PROVIDER || 'mock';
    this.initProvider();
  }

  /**
   * Initialiser le fournisseur SMS
   */
  initProvider() {
    switch (this.provider) {
      case 'twilio':
        // this.client = require('twilio')(accountSid, authToken);
        break;
      case 'africastalking':
        // this.client = require('africastalking')(options);
        break;
      case 'mock':
      default:
        // Service mock pour développement
        this.client = {
          messages: {
            create: async (options) => {
              console.log('📱 [MOCK SMS]', options);
              return { sid: 'mock_' + Date.now(), status: 'sent' };
            }
          }
        };
    }
  }

  /**
   * Formater un numéro de téléphone
   */
  formatPhoneNumber(phone) {
    // Nettoyer le numéro
    let cleaned = phone.replace(/\D/g, '');
    
    // Format international pour le Burkina Faso
    if (cleaned.startsWith('0')) {
      cleaned = '226' + cleaned.substring(1);
    } else if (!cleaned.startsWith('226')) {
      cleaned = '226' + cleaned;
    }
    
    return '+' + cleaned;
  }

  /**
   * Envoyer un SMS
   */
  async sendSms(to, message, options = {}) {
    try {
      const formattedTo = this.formatPhoneNumber(to);
      
      const result = await this.client.messages.create({
        to: formattedTo,
        from: options.from || process.env.SMS_FROM,
        body: message,
        ...options
      });

      console.log(`SMS envoyé à ${formattedTo}: ${result.sid}`);
      
      return {
        success: true,
        provider: this.provider,
        messageId: result.sid,
        status: result.status
      };
    } catch (error) {
      console.error('Erreur envoi SMS:', error);
      throw new Error(`Échec envoi SMS: ${error.message}`);
    }
  }

  /**
   * Envoyer un code de vérification
   */
  async sendVerificationCode(to, code, prenom = '') {
    const message = `Bonjour ${prenom}, votre code de vérification est: ${code}. Il expirera dans 15 minutes.`;
    
    return this.sendSms(to, message, {
      type: 'verification'
    });
  }

  /**
   * Envoyer une notification de commande
   */
  async sendCommandeNotification(to, commandeRef, statut, prenom = '') {
    let message;
    
    switch (statut) {
      case 'CONFIRMEE':
        message = `Bonjour ${prenom}, votre commande ${commandeRef} a été confirmée. Nous vous tiendrons informé de son avancement.`;
        break;
      case 'EN_LIVRAISON':
        message = `Bonjour ${prenom}, votre commande ${commandeRef} est en cours de livraison.`;
        break;
      case 'LIVREE':
        message = `Bonjour ${prenom}, votre commande ${commandeRef} a été livrée. Bon appétit !`;
        break;
      default:
        message = `Bonjour ${prenom}, votre commande ${commandeRef} a changé de statut: ${statut}`;
    }
    
    return this.sendSms(to, message, {
      type: 'commande'
    });
  }

  /**
   * Envoyer une promotion
   */
  async sendPromotion(to, offre, codePromo = null) {
    let message = `Offre spéciale: ${offre}`;
    if (codePromo) {
      message += ` Utilisez le code: ${codePromo}`;
    }
    
    return this.sendSms(to, message, {
      type: 'promotion'
    });
  }

  /**
   * Envoyer une alerte de sécurité
   */
  async sendSecurityAlert(to, type, details) {
    let message;
    
    switch (type) {
      case 'NEW_DEVICE':
        message = `Alerte de sécurité: Nouvelle connexion détectée sur votre compte depuis ${details.appareil}. Si ce n'était pas vous, contactez-nous immédiatement.`;
        break;
      case 'PASSWORD_CHANGED':
        message = `Votre mot de passe a été modifié. Si vous n'êtes pas à l'origine de cette action, contactez-nous.`;
        break;
      case 'ACCOUNT_LOCKED':
        message = `Votre compte a été verrouillé après plusieurs tentatives de connexion échouées. Contactez le support.`;
        break;
      default:
        message = `Alerte de sécurité: ${details}`;
    }
    
    return this.sendSms(to, message, {
      type: 'securite',
      priority: 'high'
    });
  }

  /**
   * Planifier un SMS (via file d'attente)
   */
  async scheduleSms(to, message, executeApres = null, options = {}) {
    return FileTacheModel.ajouter(
      'ENVOI_SMS',
      {
        to,
        message,
        options
      },
      {
        priorite: 5,
        execute_apres: executeApres || new Date()
      }
    );
  }

  /**
   * Vérifier le statut d'un SMS
   */
  async checkStatus(messageId) {
    // Implémenter selon le fournisseur
    return { status: 'delivered' };
  }

  /**
   * Obtenir les statistiques d'envoi
   */
  async getStats(periode = '30 days') {
    // À implémenter selon le fournisseur
    return {
      total_sent: 0,
      delivered: 0,
      failed: 0,
      cost: 0
    };
  }
}

module.exports = new SmsService();