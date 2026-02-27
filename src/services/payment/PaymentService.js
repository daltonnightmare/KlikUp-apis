const Constants = require('../../configuration/constants');
const { HistoriqueTransactionModel, FileTacheModel } = require('../../models');

class PaymentService {
  constructor() {
    this.providers = {
      ORANGE_MONEY: null,
      MOOV_MONEY: null,
      CARTE_BANCAIRE: null
    };
    this.initProviders();
  }

  /**
   * Initialiser les fournisseurs de paiement
   */
  initProviders() {
    if (process.env.ORANGE_MONEY_API_KEY) {
      // this.providers.ORANGE_MONEY = new OrangeMoneyService();
    }
    if (process.env.MOOV_MONEY_API_KEY) {
      // this.providers.MOOV_MONEY = new MoovMoneyService();
    }
    if (process.env.STRIPE_API_KEY) {
      // this.providers.CARTE_BANCAIRE = new CarteBancaireService();
    }
  }

  /**
   * Initialiser un paiement
   */
  async initializePayment(options) {
    const {
      montant,
      devise = Constants.CONFIG.DEVISE.CODE,
      methode,
      description,
      metadata = {},
      returnUrl,
      cancelUrl,
      notificationUrl
    } = options;

    // Valider le montant
    if (montant <= 0) {
      throw new Error('Le montant doit être supérieur à 0');
    }

    // Valider la méthode de paiement
    if (!this.providers[methode] && methode !== 'ESPECES') {
      throw new Error(`Méthode de paiement non supportée: ${methode}`);
    }

    // Pour les paiements en espèces
    if (methode === 'ESPECES') {
      return {
        success: true,
        methode: 'ESPECES',
        montant,
        devise,
        reference: `ESP-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        statut: 'EN_ATTENTE'
      };
    }

    // Utiliser le fournisseur approprié
    const provider = this.providers[methode];
    
    try {
      const result = await provider.initializePayment({
        montant,
        devise,
        description,
        metadata,
        returnUrl,
        cancelUrl,
        notificationUrl
      });

      // Enregistrer la transaction
      const transaction = await HistoriqueTransactionModel.log({
        type_transaction: 'ACHAT',
        montant,
        devise,
        statut_transaction: 'EN_ATTENTE',
        metadata: {
          ...metadata,
          provider: methode,
          provider_reference: result.reference
        },
        description
      });

      return {
        success: true,
        ...result,
        transaction_id: transaction.id,
        transaction_uuid: transaction.transaction_uuid
      };
    } catch (error) {
      console.error('Erreur initialisation paiement:', error);
      
      // Enregistrer l'échec
      await HistoriqueTransactionModel.log({
        type_transaction: 'ACHAT',
        montant,
        devise,
        statut_transaction: 'ECHOUEE',
        metadata: {
          error: error.message,
          provider: methode
        },
        description: `Échec: ${description}`
      });

      throw new Error(`Échec initialisation paiement: ${error.message}`);
    }
  }

  /**
   * Confirmer un paiement
   */
  async confirmPayment(provider, providerReference, data = {}) {
    try {
      let result;

      if (provider === 'ESPECES') {
        result = {
          success: true,
          statut: 'COMPLETEE',
          provider_reference: providerReference
        };
      } else {
        const paymentProvider = this.providers[provider];
        if (!paymentProvider) {
          throw new Error(`Fournisseur non trouvé: ${provider}`);
        }

        result = await paymentProvider.confirmPayment(providerReference, data);
      }

      if (result.success) {
        // Mettre à jour la transaction
        const transaction = await HistoriqueTransactionModel.findByReferenceExterne(providerReference);
        
        if (transaction) {
          await HistoriqueTransactionModel.updateStatut(transaction.id, 'COMPLETEE');
        }

        return {
          success: true,
          transaction
        };
      }

      return result;
    } catch (error) {
      console.error('Erreur confirmation paiement:', error);
      throw error;
    }
  }

  /**
   * Annuler un paiement
   */
  async cancelPayment(provider, providerReference) {
    try {
      if (provider === 'ESPECES') {
        const transaction = await HistoriqueTransactionModel.findByReferenceExterne(providerReference);
        
        if (transaction) {
          await HistoriqueTransactionModel.updateStatut(transaction.id, 'ANNULEE');
        }

        return { success: true };
      }

      const paymentProvider = this.providers[provider];
      if (!paymentProvider) {
        throw new Error(`Fournisseur non trouvé: ${provider}`);
      }

      return await paymentProvider.cancelPayment(providerReference);
    } catch (error) {
      console.error('Erreur annulation paiement:', error);
      throw error;
    }
  }

  /**
   * Rembourser un paiement
   */
  async refundPayment(provider, providerReference, montant = null) {
    try {
      if (provider === 'ESPECES') {
        const transaction = await HistoriqueTransactionModel.findByReferenceExterne(providerReference);
        
        if (transaction) {
          await HistoriqueTransactionModel.log({
            type_transaction: 'REMBOURSEMENT',
            montant: montant || transaction.montant,
            devise: transaction.devise,
            statut_transaction: 'COMPLETEE',
            metadata: {
              original_transaction: transaction.id,
              provider: 'ESPECES'
            },
            description: 'Remboursement en espèces'
          });

          await HistoriqueTransactionModel.updateStatut(transaction.id, 'REMBOURSEE');
        }

        return { success: true };
      }

      const paymentProvider = this.providers[provider];
      if (!paymentProvider) {
        throw new Error(`Fournisseur non trouvé: ${provider}`);
      }

      return await paymentProvider.refundPayment(providerReference, montant);
    } catch (error) {
      console.error('Erreur remboursement:', error);
      throw error;
    }
  }

  /**
   * Vérifier le statut d'un paiement
   */
  async checkStatus(provider, providerReference) {
    try {
      if (provider === 'ESPECES') {
        const transaction = await HistoriqueTransactionModel.findByReferenceExterne(providerReference);
        
        return {
          statut: transaction?.statut_transaction || 'INCONNU',
          montant: transaction?.montant,
          devise: transaction?.devise,
          date: transaction?.date_transaction
        };
      }

      const paymentProvider = this.providers[provider];
      if (!paymentProvider) {
        throw new Error(`Fournisseur non trouvé: ${provider}`);
      }

      return await paymentProvider.checkStatus(providerReference);
    } catch (error) {
      console.error('Erreur vérification statut:', error);
      throw error;
    }
  }

  /**
   * Obtenir les méthodes de paiement disponibles
   */
  getAvailablePaymentMethods() {
    const methods = [];
    
    if (this.providers.ORANGE_MONEY) {
      methods.push({
        code: 'ORANGE_MONEY',
        nom: 'Orange Money',
        logo: '/images/payments/orange-money.png',
        frais: 0,
        delai: 'immédiat'
      });
    }

    if (this.providers.MOOV_MONEY) {
      methods.push({
        code: 'MOOV_MONEY',
        nom: 'Moov Money',
        logo: '/images/payments/moov-money.png',
        frais: 0,
        delai: 'immédiat'
      });
    }

    if (this.providers.CARTE_BANCAIRE) {
      methods.push({
        code: 'CARTE_BANCAIRE',
        nom: 'Carte Bancaire (Visa/Mastercard)',
        logo: '/images/payments/cb.png',
        frais: 1.8,
        delai: 'immédiat'
      });
    }

    // Toujours disponible
    methods.push({
      code: 'ESPECES',
      nom: 'Espèces à la livraison',
      logo: '/images/payments/cash.png',
      frais: 0,
      delai: 'à la livraison'
    });

    return methods;
  }

  /**
   * Traiter un webhook de paiement
   */
  async handleWebhook(provider, payload, signature) {
    try {
      const paymentProvider = this.providers[provider];
      if (!paymentProvider) {
        throw new Error(`Fournisseur non trouvé: ${provider}`);
      }

      // Vérifier la signature
      const isValid = await paymentProvider.verifyWebhookSignature(payload, signature);
      
      if (!isValid) {
        throw new Error('Signature webhook invalide');
      }

      // Traiter le webhook
      const result = await paymentProvider.handleWebhook(payload);

      // Mettre à jour la transaction
      if (result.reference) {
        const transaction = await HistoriqueTransactionModel.findByReferenceExterne(result.reference);
        
        if (transaction) {
          await HistoriqueTransactionModel.updateStatut(
            transaction.id,
            result.statut === 'SUCCESS' ? 'COMPLETEE' : 'ECHOUEE'
          );
        }
      }

      return { received: true };
    } catch (error) {
      console.error('Erreur traitement webhook:', error);
      throw error;
    }
  }
}

module.exports = new PaymentService();