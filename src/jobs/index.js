// src/jobs/index.js
// Initialisation de tous les jobs planifiés (CRON)
// Nécessite : npm install node-cron

const logger = require('../configuration/logger');

// Lazy require pour ne charger node-cron que si disponible
let cron;
try {
  cron = require('node-cron');
} catch (e) {
  logger.warn('node-cron non installé — jobs désactivés. Installez avec: npm install node-cron');
  module.exports = { demarrer: () => {} };
  return;
}

const { query } = require('../configuration/database');

/**
 * Démarre tous les jobs planifiés
 */
const demarrer = () => {
  logger.info('🕐 Démarrage des jobs CRON...');

  // ─── 1. Nettoyage des sessions expirées ───────────────
  // Toutes les 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    try {
      const result = await query(
        `UPDATE SESSIONS SET est_active=FALSE, motif_revocation='EXPIRATION', date_revocation=NOW()
         WHERE date_expiration < NOW() AND est_active=TRUE`
      );
      if (result.rowCount > 0) logger.info(`Sessions nettoyées: ${result.rowCount}`);
    } catch (err) {
      logger.error('Erreur job nettoyage-sessions', { error: err.message });
    }
  });

  // ─── 2. Tokens révoqués expirés ──────────────────────
  // Chaque nuit à 2h
  cron.schedule('0 2 * * *', async () => {
    try {
      const result = await query(`DELETE FROM TOKENS_REVOQUES WHERE date_expiration < NOW()`);
      logger.info(`Tokens révoqués supprimés: ${result.rowCount}`);
    } catch (err) {
      logger.error('Erreur job tokens-revoques', { error: err.message });
    }
  });

  // ─── 3. Expiration des codes OTP ─────────────────────
  // Toutes les 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      await query(
        `UPDATE COMPTES
         SET code_authentification=NULL, code_authentification_expiration=NULL
         WHERE code_authentification IS NOT NULL AND code_authentification_expiration < NOW()`
      );
    } catch (err) {
      logger.error('Erreur job expiration-otp', { error: err.message });
    }
  });

  // ─── 4. Documents expirés ────────────────────────────
  // Chaque jour à 3h
  cron.schedule('0 3 * * *', async () => {
    try {
      const result = await query(
        `UPDATE DOCUMENTS SET statut='EXPIRE'
         WHERE statut='VALIDE' AND date_expiration < CURRENT_DATE`
      );
      logger.info(`Documents expirés: ${result.rowCount}`);
    } catch (err) {
      logger.error('Erreur job expiration-documents', { error: err.message });
    }
  });

  // ─── 5. Expiration des promotions ────────────────────
  // Chaque heure
  cron.schedule('0 * * * *', async () => {
    try {
      const result = await query(
        `UPDATE PROMOSRESTAURANTFASTFOOD SET actif=FALSE
         WHERE actif=TRUE AND date_fin_promo < NOW()`
      );
      if (result.rowCount > 0) logger.info(`Promos désactivées: ${result.rowCount}`);
    } catch (err) {
      logger.error('Erreur job expiration-promos', { error: err.message });
    }
  });

  // ─── 6. Rafraîchissement vue notes moyennes ──────────
  // Chaque heure à :05
  cron.schedule('5 * * * *', async () => {
    try {
      await query(`REFRESH MATERIALIZED VIEW CONCURRENTLY VUE_NOTES_MOYENNES`);
      logger.debug('VUE_NOTES_MOYENNES rafraîchie');
    } catch (err) {
      logger.error('Erreur job refresh-vue-notes', { error: err.message });
    }
  });

  // ─── 7. Nettoyage stats lecture (> 180 jours) ────────
  // Chaque dimanche à 4h
  cron.schedule('0 4 * * 0', async () => {
    try {
      const result = await query(
        `DELETE FROM STATS_LECTURE_ARTICLES WHERE date_lecture < NOW() - INTERVAL '180 days'`
      );
      logger.info(`Stats lecture supprimées: ${result.rowCount}`);
    } catch (err) {
      logger.error('Erreur job nettoyage-stats-lecture', { error: err.message });
    }
  });

  // ─── 8. Expiration des parrainages ───────────────────
  // Chaque jour à 1h
  cron.schedule('0 1 * * *', async () => {
    try {
      const result = await query(
        `UPDATE PARRAINAGES SET statut='EXPIRE'
         WHERE statut='EN_ATTENTE' AND date_expiration < NOW()`
      );
      if (result.rowCount > 0) logger.info(`Parrainages expirés: ${result.rowCount}`);
    } catch (err) {
      logger.error('Erreur job expiration-parrainages', { error: err.message });
    }
  });

  // ─── 9. Nettoyage historique connexions (> 365 jours) ─
  // Le 1er de chaque mois à 5h
  cron.schedule('0 5 1 * *', async () => {
    try {
      const result = await query(
        `DELETE FROM HISTORIQUE_CONNEXIONS WHERE date_connexion < NOW() - INTERVAL '365 days'`
      );
      logger.info(`Historique connexions supprimé: ${result.rowCount}`);
    } catch (err) {
      logger.error('Erreur job nettoyage-historique', { error: err.message });
    }
  });

  // ─── 10. Alertes de sécurité: déverrouillage auto ────
  // Toutes les heures
  cron.schedule('0 * * * *', async () => {
    try {
      // Déverrouiller les comptes suspendus depuis plus de 24h (si non banni)
      const result = await query(
        `UPDATE COMPTES
         SET statut='EST_AUTHENTIFIE', date_verouillage=NULL, tentatives_echec_connexion=0
         WHERE statut='SUSPENDU'
           AND date_verouillage < NOW() - INTERVAL '24 hours'`
      );
      if (result.rowCount > 0) logger.info(`Comptes déverrouillés automatiquement: ${result.rowCount}`);
    } catch (err) {
      logger.error('Erreur job deverrouillage-auto', { error: err.message });
    }
  });

  // ─── 11. Notifications expirées ──────────────────────
  // Chaque nuit à 2h30
  cron.schedule('30 2 * * *', async () => {
    try {
      const result = await query(
        `UPDATE NOTIFICATIONS SET est_archivee=TRUE
         WHERE date_expiration < NOW() AND est_archivee=FALSE`
      );
      if (result.rowCount > 0) logger.info(`Notifications archivées: ${result.rowCount}`);
    } catch (err) {
      logger.error('Erreur job archivage-notifications', { error: err.message });
    }
  });

  // ─── 12. File de tâches — Nettoyage ─────────────────
  // Chaque jour à 6h
  cron.schedule('0 6 * * *', async () => {
    try {
      const result = await query(
        `DELETE FROM FILE_TACHES
         WHERE statut IN ('COMPLETEE','ABANDONNEE') AND date_creation < NOW() - INTERVAL '30 days'`
      );
      logger.info(`Tâches terminées supprimées: ${result.rowCount}`);
    } catch (err) {
      logger.error('Erreur job nettoyage-taches', { error: err.message });
    }
  });

  logger.info('✅ Tous les jobs CRON démarrés');
};

module.exports = { demarrer };