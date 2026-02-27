const { TokenPushModel, PreferenceNotificationModel } = require('../../models');

class PushService {
  constructor() {
    this.providers = {
      fcm: null, // Firebase Cloud Messaging
      apns: null // Apple Push Notification Service
    };
    this.initProviders();
  }

  /**
   * Initialiser les fournisseurs de push
   */
  initProviders() {
    if (process.env.FCM_SERVER_KEY) {
      // this.providers.fcm = require('fcm-node').initialize(process.env.FCM_SERVER_KEY);
    }
    
    // Initialiser APNS si nécessaire
  }

  /**
   * Envoyer une notification push à un token
   */
  async sendToToken(token, notification, data = {}) {
    try {
      const payload = {
        to: token.token,
        notification: {
          title: notification.titre,
          body: notification.corps,
          sound: 'default',
          badge: 1,
          click_action: notification.action_url ? 'OPEN_URL' : undefined,
          ...notification.options
        },
        data: {
          type: notification.type || 'default',
          action: notification.action_type,
          action_id: notification.action_id,
          url: notification.action_url,
          ...data
        }
      };

      // Choisir le provider selon la plateforme
      let provider;
      if (token.plateforme === 'IOS') {
        provider = this.providers.apns;
        payload.apns = {
          headers: {
            'apns-priority': '10'
          },
          payload: {
            aps: {
              alert: notification.corps,
              sound: 'default',
              badge: 1
            }
          }
        };
      } else {
        provider = this.providers.fcm;
      }

      if (!provider) {
        console.warn('Provider push non configuré pour', token.plateforme);
        return null;
      }

      // Envoyer la notification
      const result = await provider.send(payload);
      
      // Mettre à jour la date de dernière utilisation
      await TokenPushModel.updateLastUsed(token.token);

      return {
        success: true,
        messageId: result.message_id,
        token: token.token
      };
    } catch (error) {
      console.error('Erreur envoi push:', error);
      
      // Si token invalide, le désactiver
      if (error.code === 'messaging/invalid-registration-token' ||
          error.code === 'messaging/registration-token-not-registered') {
        await TokenPushModel.unregister(token.token);
      }
      
      return {
        success: false,
        error: error.message,
        token: token.token
      };
    }
  }

  /**
   * Envoyer une notification à un utilisateur
   */
  async sendToUser(compteId, notification, data = {}) {
    try {
      // Récupérer les tokens actifs de l'utilisateur
      const tokens = await TokenPushModel.findByCompte(compteId);
      
      if (tokens.length === 0) {
        console.log(`Aucun token push pour l'utilisateur ${compteId}`);
        return { success: true, sent: 0, total: 0 };
      }

      // Vérifier les préférences de notification
      const preferences = await PreferenceNotificationModel.findByCompteAndCanal(compteId, 'PUSH_MOBILE');
      const preferencesMap = {};
      preferences.forEach(p => {
        preferencesMap[p.type_evenement] = p;
      });

      // Filtrer selon les préférences
      if (notification.type && preferencesMap[notification.type]?.est_active === false) {
        console.log(`Notifications push désactivées pour ${notification.type}`);
        return { success: true, sent: 0, total: 0, skipped: 'disabled' };
      }

      // Envoyer à tous les tokens
      const results = await Promise.all(
        tokens.map(token => this.sendToToken(token, notification, data))
      );

      const sent = results.filter(r => r && r.success).length;
      const failed = results.filter(r => r && !r.success).length;

      return {
        success: true,
        sent,
        failed,
        total: tokens.length,
        details: results
      };
    } catch (error) {
      console.error('Erreur envoi push utilisateur:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Envoyer une notification à plusieurs utilisateurs
   */
  async sendToUsers(compteIds, notification, data = {}) {
    const results = await Promise.all(
      compteIds.map(compteId => this.sendToUser(compteId, notification, data))
    );

    return {
      success: true,
      total_users: compteIds.length,
      results
    };
  }

  /**
   * Envoyer une notification de type commande
   */
  async sendCommandeNotification(compteId, commande, type) {
    let titre, corps, actionUrl;
    
    switch (type) {
      case 'confirmee':
        titre = 'Commande confirmée';
        corps = `Votre commande ${commande.reference_commande} a été confirmée.`;
        actionUrl = `/commandes/${commande.id}`;
        break;
      case 'prete':
        titre = 'Commande prête';
        corps = `Votre commande ${commande.reference_commande} est prête !`;
        actionUrl = `/commandes/${commande.id}`;
        break;
      case 'livree':
        titre = 'Commande livrée';
        corps = `Votre commande ${commande.reference_commande} a été livrée. Bon appétit !`;
        actionUrl = `/commandes/${commande.id}`;
        break;
      default:
        titre = 'Mise à jour commande';
        corps = `Votre commande ${commande.reference_commande} a changé de statut.`;
        actionUrl = `/commandes/${commande.id}`;
    }

    return this.sendToUser(compteId, {
      titre,
      corps,
      type: 'commande',
      action_type: 'commande',
      action_id: commande.id,
      action_url: actionUrl
    });
  }

  /**
   * Envoyer une notification de message
   */
  async sendMessageNotification(compteId, message, conversation, expediteur) {
    return this.sendToUser(compteId, {
      titre: `Nouveau message de ${expediteur.nom_utilisateur_compte}`,
      corps: message.contenu_message.substring(0, 100),
      type: 'message',
      action_type: 'conversation',
      action_id: conversation.id,
      action_url: `/messages/${conversation.id}`,
      options: {
        tag: 'message',
        channelId: 'messages'
      }
    }, {
      conversation_id: conversation.id,
      expediteur_id: expediteur.id,
      message_id: message.id
    });
  }

  /**
   * Envoyer une notification de promotion
   */
  async sendPromotionNotification(compteId, promotion, offre) {
    return this.sendToUser(compteId, {
      titre: 'Offre spéciale !',
      corps: promotion.description_promo || 'Découvrez notre nouvelle offre',
      type: 'promotion',
      action_type: 'promotion',
      action_id: promotion.id,
      action_url: `/promotions/${promotion.id}`,
      options: {
        tag: 'promotion',
        channelId: 'promotions'
      }
    }, {
      promotion_id: promotion.id,
      code: promotion.code_promo
    });
  }

  /**
   * Envoyer une notification de rappel
   */
  async sendRappelNotification(compteId, type, data) {
    let titre, corps;
    
    switch (type) {
      case 'panier_abandonne':
        titre = 'Vous avez oublié votre panier ?';
        corps = 'Votre panier vous attend toujours. Finalisez votre commande maintenant !';
        break;
      case 'rendez_vous':
        titre = 'Rappel de rendez-vous';
        corps = `Vous avez un rendez-vous ${data.date}.`;
        break;
      default:
        titre = 'Rappel';
        corps = 'Nouveau rappel de notre part';
    }

    return this.sendToUser(compteId, {
      titre,
      corps,
      type: 'rappel',
      action_type: type,
      action_url: data.action_url,
      options: {
        tag: 'rappel',
        channelId: 'rappels'
      }
    }, data);
  }

  /**
   * Envoyer une notification de sécurité
   */
  async sendSecurityNotification(compteId, type, details) {
    let titre, corps;
    
    switch (type) {
      case 'new_device':
        titre = 'Nouvelle connexion détectée';
        corps = `Connexion depuis ${details.appareil} à ${details.heure}. Si ce n'était pas vous, sécurisez votre compte.`;
        break;
      case 'password_changed':
        titre = 'Mot de passe modifié';
        corps = 'Votre mot de passe a été modifié avec succès.';
        break;
      default:
        titre = 'Alerte sécurité';
        corps = 'Une activité inhabituelle a été détectée sur votre compte.';
    }

    return this.sendToUser(compteId, {
      titre,
      corps,
      type: 'securite',
      priority: 'HAUTE',
      options: {
        tag: 'securite',
        channelId: 'securite',
        importance: 'high'
      }
    }, details);
  }

  /**
   * Envoyer une notification broadcast à tous les utilisateurs
   */
  async broadcast(notification, filtre = null) {
    // Récupérer tous les tokens actifs (avec filtre optionnel)
    let query = 'SELECT DISTINCT compte_id FROM TOKENS_PUSH WHERE est_actif = true';
    const values = [];
    
    if (filtre) {
      // Appliquer les filtres (ex: plateforme, rôle, etc.)
    }

    const result = await TokenPushModel.db.query(query, values);
    const compteIds = result.rows.map(r => r.compte_id);

    return this.sendToUsers(compteIds, notification);
  }
}

module.exports = new PushService();