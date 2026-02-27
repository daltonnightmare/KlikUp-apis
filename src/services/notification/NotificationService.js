const Constants = require('../../configuration/constants');
const {
  NotificationModel,
  ModeleNotificationModel,
  PreferenceNotificationModel,
  TokenPushModel,
  FileTacheModel
} = require('../../models');
const EmailService = require('../email/EmailService');
const SmsService = require('../sms/SmsService');
const PushService = require('../push/PushService');

class NotificationService {
  constructor() {
    this.channels = {
      IN_APP: this.sendInApp.bind(this),
      EMAIL: this.sendEmail.bind(this),
      SMS: this.sendSms.bind(this),
      PUSH_MOBILE: this.sendPush.bind(this),
      WHATSAPP: this.sendWhatsApp.bind(this)
    };
  }

  /**
   * Envoyer une notification
   */
  async send(notification, options = {}) {
    try {
      const {
        destinataire_id,
        type,
        canal = 'IN_APP',
        priorite = 'NORMALE',
        template_code = null,
        variables = {},
        data = {},
        schedule = null
      } = notification;

      // Vérifier les préférences de l'utilisateur
      const preference = await PreferenceNotificationModel.accepteNotification(
        destinataire_id,
        canal,
        type
      );

      if (!preference.accepte) {
        return {
          success: false,
          reason: 'notification_desactivee',
          canal,
          destinataire_id
        };
      }

      // Vérifier la période silencieuse
      if (preference.en_periode_silencieuse && priorite !== 'CRITIQUE') {
        return {
          success: false,
          reason: 'periode_silencieuse',
          canal,
          destinataire_id
        };
      }

      // Générer la notification à partir d'un template si fourni
      let notificationData = notification;
      if (template_code) {
        const modele = await ModeleNotificationModel.findByCode(template_code);
        if (!modele) {
          throw new Error(`Template non trouvé: ${template_code}`);
        }

        const generated = await ModeleNotificationModel.genererNotification(
          template_code,
          destinataire_id,
          variables,
          canal
        );
        notificationData = { ...generated, ...notification };
      }

      // Planifier si demandé
      if (schedule) {
        return this.schedule(notificationData, schedule);
      }

      // Envoyer via le canal approprié
      const sendFunction = this.channels[canal];
      if (!sendFunction) {
        throw new Error(`Canal de notification non supporté: ${canal}`);
      }

      const result = await sendFunction(notificationData, options);

      // Enregistrer en base pour les notifications in-app
      if (canal === 'IN_APP' || options.persist) {
        await NotificationModel.create({
          destinataire_id,
          modele_id: notificationData.modele_id,
          titre: notificationData.titre,
          corps: notificationData.corps,
          canal,
          priorite,
          action_type: notificationData.action_type,
          action_id: notificationData.action_id,
          action_url: notificationData.action_url,
          image_url: notificationData.image_url,
          entite_source_type: notificationData.entite_source_type,
          entite_source_id: notificationData.entite_source_id,
          date_expiration: notificationData.date_expiration
        });
      }

      return {
        success: true,
        canal,
        destinataire_id,
        result
      };
    } catch (error) {
      console.error('Erreur envoi notification:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Envoyer une notification à plusieurs destinataires
   */
  async sendBulk(notifications) {
    const results = await Promise.all(
      notifications.map(n => this.send(n))
    );

    return {
      success: true,
      total: notifications.length,
      success_count: results.filter(r => r.success).length,
      failed_count: results.filter(r => !r.success).length,
      results
    };
  }

  /**
   * Envoyer une notification in-app
   */
  async sendInApp(notification, options = {}) {
    // Les notifications in-app sont simplement enregistrées en base
    // Elles seront récupérées par le client
    return {
      channel: 'IN_APP',
      notification_id: notification.id,
      delivered: true
    };
  }

  /**
   * Envoyer un email
   */
  async sendEmail(notification, options = {}) {
    const destinataire = await this.getDestinataireInfo(notification.destinataire_id);
    
    if (!destinataire || !destinataire.email) {
      throw new Error('Destinataire sans email');
    }

    return EmailService.sendEmail(
      destinataire.email,
      notification.titre,
      notification.corps,
      {
        ...options,
        type: notification.type
      }
    );
  }

  /**
   * Envoyer un SMS
   */
  async sendSms(notification, options = {}) {
    const destinataire = await this.getDestinataireInfo(notification.destinataire_id);
    
    if (!destinataire || !destinataire.numero_de_telephone) {
      throw new Error('Destinataire sans téléphone');
    }

    return SmsService.sendSms(
      destinataire.numero_de_telephone,
      notification.corps,
      {
        ...options,
        type: notification.type
      }
    );
  }

  /**
   * Envoyer une notification push
   */
  async sendPush(notification, options = {}) {
    return PushService.sendToUser(
      notification.destinataire_id,
      notification,
      options.data
    );
  }

  /**
   * Envoyer un WhatsApp (à implémenter)
   */
  async sendWhatsApp(notification, options = {}) {
    // Implémenter l'envoi WhatsApp
    throw new Error('WhatsApp non implémenté');
  }

  /**
   * Planifier une notification
   */
  async schedule(notification, date) {
    return FileTacheModel.ajouter(
      'ENVOI_NOTIFICATION',
      notification,
      {
        priorite: 5,
        execute_apres: date
      }
    );
  }

  /**
   * Récupérer les informations d'un destinataire
   */
  async getDestinataireInfo(destinataireId) {
    const { CompteModel } = require('../../models');
    return CompteModel.findById(destinataireId);
  }

  /**
   * Marquer une notification comme lue
   */
  async markAsRead(notificationId, destinataireId) {
    return NotificationModel.marquerLue(notificationId);
  }

  /**
   * Marquer toutes les notifications comme lues
   */
  async markAllAsRead(destinataireId) {
    return NotificationModel.marquerToutesLues(destinataireId);
  }

  /**
   * Récupérer les notifications non lues
   */
  async getUnread(destinataireId, limit = 50) {
    return NotificationModel.findByDestinataire(destinataireId, {
      non_lues_seulement: true,
      limit
    });
  }

  /**
   * Récupérer l'historique des notifications
   */
  async getHistory(destinataireId, options = {}) {
    return NotificationModel.findByDestinataire(destinataireId, options);
  }

  /**
   * Compter les notifications non lues
   */
  async countUnread(destinataireId) {
    return NotificationModel.countNonLues(destinataireId);
  }

  /**
   * Nettoyer les anciennes notifications
   */
  async cleanOldNotifications(jours = 30) {
    return NotificationModel.nettoyerAnciennes(jours);
  }
}

module.exports = new NotificationService();