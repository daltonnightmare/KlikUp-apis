const Constants = require('../../configuration/constants');
const { JournalAuditModel, HistoriqueActionModel, FileTacheModel } = require('../../models/index');

class AuditService {
  constructor() {
    this.batchSize = 100;
    this.batchTimeout = 5000; // 5 secondes
    this.pendingLogs = [];
    this.initBatchProcessor();
  }

  /**
   * Initialiser le traitement par lots
   */
  initBatchProcessor() {
    setInterval(() => {
      if (this.pendingLogs.length > 0) {
        this.flushBatch();
      }
    }, this.batchTimeout);
  }

  /**
   * Enregistrer un événement d'audit
   */
  async log(action, ressourceType, ressourceId, data = {}, options = {}) {
    const {
      utilisateurId = null,
      sessionId = null,
      role = null,
      ip = null,
      userAgent = null,
      succes = true,
      codeErreur = null,
      messageErreur = null,
      dureeMs = null,
      raison = null,
      metadata = {}
    } = options;

    const logEntry = {
      session_id: sessionId,
      compte_id: utilisateurId,
      role_au_moment: role,
      adresse_ip: ip || this.getClientIp(),
      user_agent: userAgent,
      action,
      ressource_type: ressourceType,
      ressource_id: String(ressourceId),
      donnees_avant: data.avant || null,
      donnees_apres: data.apres || null,
      champs_modifies: data.champsModifies || null,
      raison,
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString()
      },
      succes,
      code_erreur: codeErreur,
      message_erreur: messageErreur,
      duree_ms: dureeMs
    };

    // Ajouter à la file d'attente
    this.pendingLogs.push(logEntry);

    // Si on atteint la taille du lot, envoyer immédiatement
    if (this.pendingLogs.length >= this.batchSize) {
      await this.flushBatch();
    }

    return { logged: true };
  }

  /**
   * Vider le lot en cours
   */
  async flushBatch() {
    if (this.pendingLogs.length === 0) return;

    const logs = [...this.pendingLogs];
    this.pendingLogs = [];

    try {
      await JournalAuditModel.createMany(logs);
    } catch (error) {
      console.error('Erreur enregistrement lot audit:', error);
      
      // Réessayer un par un en cas d'erreur
      for (const log of logs) {
        try {
          await JournalAuditModel.create(log);
        } catch (e) {
          console.error('Erreur enregistrement audit:', e);
        }
      }
    }
  }

  /**
   * Obtenir l'IP du client
   */
  getClientIp() {
    // À implémenter avec la requête réelle
    return '0.0.0.0';
  }

  /**
   * Enregistrer une action utilisateur
   */
  async logUserAction(utilisateurId, action, details = {}, options = {}) {
    return this.log(
      action,
      'COMPTE',
      utilisateurId,
      { apres: details },
      { utilisateurId, ...options }
    );
  }

  /**
   * Enregistrer une action sur une commande
   */
  async logCommandeAction(commandeId, action, ancienStatut, nouveauStatut, utilisateurId, options = {}) {
    return this.log(
      action,
      'COMMANDE',
      commandeId,
      {
        avant: { statut: ancienStatut },
        apres: { statut: nouveauStatut },
        champsModifies: ['statut']
      },
      { utilisateurId, ...options }
    );
  }

  /**
   * Enregistrer une action sur un paiement
   */
  async logPaiementAction(paiementId, action, montant, statut, utilisateurId, options = {}) {
    return this.log(
      action,
      'PAIEMENT',
      paiementId,
      { apres: { montant, statut } },
      { utilisateurId, ...options }
    );
  }

  /**
   * Enregistrer une tentative de connexion
   */
  async logLoginAttempt(utilisateurId, succes, ip, options = {}) {
    return this.log(
      succes ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED',
      'AUTH',
      utilisateurId,
      {},
      {
        utilisateurId,
        ip,
        succes,
        codeErreur: options.codeErreur,
        messageErreur: options.messageErreur
      }
    );
  }

  /**
   * Enregistrer une modification de données sensibles
   */
  async logSensitiveDataChange(ressourceType, ressourceId, champ, ancienneValeur, nouvelleValeur, utilisateurId, options = {}) {
    return this.log(
      'SENSITIVE_DATA_CHANGE',
      ressourceType,
      ressourceId,
      {
        avant: { [champ]: this.masquerDonneeSensible(ancienneValeur) },
        apres: { [champ]: this.masquerDonneeSensible(nouvelleValeur) },
        champsModifies: [champ]
      },
      { utilisateurId, ...options }
    );
  }

  /**
   * Masquer une donnée sensible
   */
  masquerDonneeSensible(valeur) {
    if (!valeur) return null;
    
    const str = String(valeur);
    if (str.length <= 4) return '****';
    
    return str.substring(0, 2) + '****' + str.substring(str.length - 2);
  }

  /**
   * Récupérer l'historique d'une ressource
   */
  async getRessourceHistory(ressourceType, ressourceId, options = {}) {
    return JournalAuditModel.findByRessource(ressourceType, ressourceId, options);
  }

  /**
   * Récupérer l'historique d'un utilisateur
   */
  async getUserHistory(utilisateurId, options = {}) {
    return JournalAuditModel.findByUtilisateur(utilisateurId, options);
  }

  /**
   * Récupérer les actions suspectes
   */
  async getSuspiciousActions(periode = '24 hours') {
    return JournalAuditModel.getActionsSuspectes(periode);
  }

  /**
   * Obtenir les statistiques d'audit
   */
  async getStats(periode = '7 days') {
    return JournalAuditModel.getStats(periode);
  }

  /**
   * Exporter l'audit pour une période
   */
  async exportAudit(dateDebut, dateFin, format = 'json') {
    const logs = await JournalAuditModel.findByDateRange(dateDebut, dateFin);
    
    switch (format) {
      case 'json':
        return { data: logs, count: logs.length };
      
      case 'csv':
        const csv = this.convertToCSV(logs);
        return { csv, count: logs.length };
      
      case 'excel':
        // Utiliser ExportService pour générer Excel
        const { ExportService } = require('../export/ExportService');
        return ExportService.toExcel(logs, {
          filename: `audit-${Date.now()}.xlsx`,
          title: 'Journal d\'audit',
          subtitle: `Du ${dateDebut} au ${dateFin}`
        });
      
      default:
        throw new Error(`Format non supporté: ${format}`);
    }
  }

  /**
   * Convertir en CSV
   */
  convertToCSV(logs) {
    if (logs.length === 0) return '';

    const headers = Object.keys(logs[0]).filter(key => 
      !['donnees_avant', 'donnees_apres', 'metadata'].includes(key)
    );
    
    let csv = headers.join(',') + '\n';
    
    logs.forEach(log => {
      const row = headers.map(header => {
        const value = log[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') return JSON.stringify(value).replace(/,/g, ';');
        return String(value).replace(/,/g, ' ');
      });
      csv += row.join(',') + '\n';
    });

    return csv;
  }

  /**
   * Archiver les anciens logs
   */
  async archiveOldLogs(jours = 365) {
    return JournalAuditModel.archiverAnciennes(jours);
  }

  /**
   * Créer un rapport d'audit
   */
  async generateAuditReport(periode = '30 days') {
    const stats = await this.getStats(periode);
    const suspicious = await this.getSuspiciousActions(periode);
    
    return {
      generated_at: new Date().toISOString(),
      periode,
      resume: {
        total_actions: stats.reduce((sum, s) => sum + s.nombre_actions, 0),
        actions_par_type: stats,
        actions_suspectes: suspicious.length
      },
      actions_suspectes: suspicious,
      recommandations: this.generateRecommendations(stats, suspicious)
    };
  }

  /**
   * Générer des recommandations basées sur l'audit
   */
  generateRecommendations(stats, suspicious) {
    const recommendations = [];

    // Vérifier le taux d'échec élevé
    const totalActions = stats.reduce((sum, s) => sum + s.nombre_actions, 0);
    const totalEchecs = stats.reduce((sum, s) => sum + s.echecs, 0);
    const tauxEchec = totalActions > 0 ? (totalEchecs / totalActions) * 100 : 0;

    if (tauxEchec > 10) {
      recommendations.push({
        type: 'warning',
        message: `Taux d'échec élevé (${tauxEchec.toFixed(2)}%). Vérifier les erreurs système.`
      });
    }

    // Vérifier les actions suspectes
    if (suspicious.length > 5) {
      recommendations.push({
        type: 'critical',
        message: `${suspicious.length} actions suspectes détectées. Renforcer la sécurité.`
      });
    }

    return recommendations;
  }
}

module.exports = new AuditService();