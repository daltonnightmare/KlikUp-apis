// src/services/notification/NotificationService.js
const Constants = require('../../configuration/constants');
const db = require('../../configuration/database');
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
        type = 'GENERAL',
        canal = 'IN_APP',
        priorite = 'NORMALE',
        titre,
        corps,
        template_code = null,
        variables = {},
        data = {},
        schedule = null,
        action_type,
        action_id,
        action_url,
        image_url,
        entite_source_type,
        entite_source_id,
        date_expiration,
        metadata = {}
      } = notification;

      // Vérifier que le destinataire existe
      const destinataire = await db.query(
        `SELECT id FROM COMPTES WHERE id = $1 AND est_supprime = false`,
        [destinataire_id]
      );
      
      if (destinataire.rows.length === 0) {
        return {
          success: false,
          reason: 'destinataire_non_trouve',
          canal,
          destinataire_id
        };
      }

      // Vérifier les préférences de l'utilisateur
      let preference = { accepte: true, en_periode_silencieuse: false };
      try {
        const prefResult = await db.query(
          `SELECT est_active FROM PREFERENCES_NOTIFICATIONS 
           WHERE compte_id = $1 AND canal = $2 AND type_evenement = $3
           LIMIT 1`,
          [destinataire_id, canal, type]
        );
        if (prefResult.rows.length > 0) {
          preference.accepte = prefResult.rows[0].est_active;
        }
      } catch (error) {
        // Si la table n'existe pas, on continue
        console.log('Préférences non disponibles');
      }

      if (!preference.accepte) {
        return {
          success: false,
          reason: 'notification_desactivee',
          canal,
          destinataire_id
        };
      }

      // Générer la notification à partir d'un template si fourni
      let notificationData = { ...notification, titre, corps };
      if (template_code) {
        try {
          const modele = await ModeleNotificationModel.findByCode(template_code);
          if (modele) {
            notificationData = { ...modele, ...notification };
          }
        } catch (error) {
          console.log(`Template non trouvé: ${template_code}`);
        }
      }

      // Planifier si demandé
      if (schedule) {
        return this.schedule(notificationData, schedule);
      }

      // Envoyer via le canal approprié
      const sendFunction = this.channels[canal];
      if (!sendFunction) {
        return {
          success: false,
          reason: `canal_non_supporte: ${canal}`,
          canal,
          destinataire_id
        };
      }

      const result = await sendFunction(notificationData, options);

      // Enregistrer en base pour les notifications in-app
      if (canal === 'IN_APP' || options.persist) {
        try {
          const insertResult = await db.query(
            `INSERT INTO NOTIFICATIONS (
              uuid_notification, destinataire_id, titre, corps,
              canal, priorite, action_type, action_id, action_url,
              image_url, entite_source_type, entite_source_id,
              date_expiration, date_creation
            ) VALUES (
              gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
            ) RETURNING id`,
            [
              destinataire_id,
              notificationData.titre,
              notificationData.corps,
              canal,
              priorite,
              action_type,
              action_id,
              action_url,
              image_url,
              entite_source_type,
              entite_source_id,
              date_expiration || null
            ]
          );
          notificationData.id = insertResult.rows[0].id;
        } catch (dbError) {
          console.error('Erreur insertion notification:', dbError);
        }
      }

      return {
        success: true,
        canal,
        destinataire_id,
        notification_id: notificationData.id,
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
      success_count: results.filter(r => r && r.success).length,
      failed_count: results.filter(r => r && !r.success).length,
      results
    };
  }

  /**
   * Notifier tous les administrateurs (version corrigée)
   */
  async notifyAdmins(options = {}) {
    const {
      type = 'GENERAL',
      titre,
      corps,
      priorite = 'NORMALE',
      donnees = {},
      action_url = null
    } = options;

    try {
      // Récupérer tous les administrateurs
      const admins = await db.query(
        `SELECT id FROM COMPTES 
         WHERE compte_role = 'ADMINISTRATEUR_PLATEFORME' 
         AND est_supprime = false`
      );

      if (admins.rows.length === 0) {
        return {
          success: false,
          reason: 'aucun_administrateur_trouve'
        };
      }

      const notifications = admins.rows.map(admin => ({
        destinataire_id: admin.id,
        type,
        canal: 'IN_APP',
        titre,
        corps,
        priorite,
        action_url,
        metadata: donnees
      }));

      const result = await this.sendBulk(notifications);

      return {
        success: true,
        total_admins: admins.rows.length,
        ...result
      };
    } catch (error) {
      console.error('Erreur notifyAdmins:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Envoyer une notification in-app
   */
  async sendInApp(notification, options = {}) {
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
      return { success: false, reason: 'destinataire_sans_email' };
    }

    try {
      await EmailService.sendEmail(
        destinataire.email,
        notification.titre,
        notification.corps,
        options
      );
      return { success: true, channel: 'EMAIL' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Envoyer un SMS
   */
  async sendSms(notification, options = {}) {
    const destinataire = await this.getDestinataireInfo(notification.destinataire_id);
    
    if (!destinataire || !destinataire.numero_de_telephone) {
      return { success: false, reason: 'destinataire_sans_telephone' };
    }

    try {
      await SmsService.sendSms(
        destinataire.numero_de_telephone,
        notification.corps,
        options
      );
      return { success: true, channel: 'SMS' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Envoyer une notification push
   */
  async sendPush(notification, options = {}) {
    try {
      const result = await PushService.sendToUser(
        notification.destinataire_id,
        notification,
        options.data
      );
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Envoyer un WhatsApp (à implémenter)
   */
  async sendWhatsApp(notification, options = {}) {
    return { success: false, reason: 'whatsapp_non_implemente' };
  }

  /**
   * Planifier une notification
   */
  async schedule(notification, date) {
    try {
      await db.query(
        `INSERT INTO FILE_TACHES (type_tache, payload, execute_apres, date_creation)
         VALUES ('ENVOI_NOTIFICATION', $1, $2, NOW())`,
        [JSON.stringify(notification), date]
      );
      return { success: true, scheduled: true, date };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Récupérer les informations d'un destinataire
   */
  async getDestinataireInfo(destinataireId) {
    try {
      const result = await db.query(
        `SELECT id, email, numero_de_telephone, nom_utilisateur_compte 
         FROM COMPTES WHERE id = $1`,
        [destinataireId]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Erreur getDestinataireInfo:', error);
      return null;
    }
  }

  /**
   * Marquer une notification comme lue
   */
  async markAsRead(notificationId, destinataireId) {
    try {
      await db.query(
        `UPDATE NOTIFICATIONS 
         SET est_lue = true, date_lecture = NOW()
         WHERE id = $1 AND destinataire_id = $2`,
        [notificationId, destinataireId]
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Marquer toutes les notifications comme lues
   */
  async markAllAsRead(destinataireId) {
    try {
      await db.query(
        `UPDATE NOTIFICATIONS 
         SET est_lue = true, date_lecture = NOW()
         WHERE destinataire_id = $1 AND est_lue = false`,
        [destinataireId]
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Récupérer les notifications non lues
   */
  async getUnread(destinataireId, limit = 50) {
    try {
      const result = await db.query(
        `SELECT id, uuid_notification, titre, corps, action_type, action_url,
                image_url, priorite, date_creation
         FROM NOTIFICATIONS
         WHERE destinataire_id = $1 AND est_lue = false AND est_archivee = false
         ORDER BY date_creation DESC
         LIMIT $2`,
        [destinataireId, limit]
      );
      return result.rows;
    } catch (error) {
      console.error('Erreur getUnread:', error);
      return [];
    }
  }

  /**
   * Récupérer l'historique des notifications
   */
  async getHistory(destinataireId, options = {}) {
    const { limit = 50, offset = 0 } = options;
    try {
      const result = await db.query(
        `SELECT id, uuid_notification, titre, corps, action_type, action_url,
                image_url, priorite, canal, est_lue, date_creation
         FROM NOTIFICATIONS
         WHERE destinataire_id = $1 AND est_archivee = false
         ORDER BY date_creation DESC
         LIMIT $2 OFFSET $3`,
        [destinataireId, limit, offset]
      );
      return result.rows;
    } catch (error) {
      console.error('Erreur getHistory:', error);
      return [];
    }
  }

  /**
   * Compter les notifications non lues
   */
  async countUnread(destinataireId) {
    try {
      const result = await db.query(
        `SELECT COUNT(*) as count
         FROM NOTIFICATIONS
         WHERE destinataire_id = $1 AND est_lue = false AND est_archivee = false`,
        [destinataireId]
      );
      return parseInt(result.rows[0].count);
    } catch (error) {
      console.error('Erreur countUnread:', error);
      return 0;
    }
  }

  /**
   * Nettoyer les anciennes notifications
   */
  async cleanOldNotifications(jours = 30) {
    try {
      const result = await db.query(
        `DELETE FROM NOTIFICATIONS 
         WHERE date_creation < NOW() - INTERVAL '1 day' * $1
         AND est_lue = true
         RETURNING id`,
        [jours]
      );
      return result.rowCount;
    } catch (error) {
      console.error('Erreur cleanOldNotifications:', error);
      return 0;
    }
  }
}

module.exports = new NotificationService();