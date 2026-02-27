// src/controllers/notification/PreferenceNotificationController.js
const db = require('../../configuration/database');
const { ValidationError } = require('../../utils/errors/AppError');

class PreferenceNotificationController {
    /**
     * Récupérer les préférences de notification de l'utilisateur
     * @route GET /api/v1/notifications/preferences
     */
    async getMyPreferences(req, res, next) {
        try {
            const result = await db.query(
                `SELECT * FROM PREFERENCES_NOTIFICATIONS 
                 WHERE compte_id = $1
                 ORDER BY canal, type_evenement`,
                [req.user.id]
            );

            // Organiser par canal
            const preferences = {
                IN_APP: [],
                PUSH_MOBILE: [],
                EMAIL: [],
                SMS: [],
                WHATSAPP: []
            };

            for (const pref of result.rows) {
                preferences[pref.canal].push({
                    type_evenement: pref.type_evenement,
                    est_active: pref.est_active,
                    heure_debut_silencieux: pref.heure_debut_silencieux,
                    heure_fin_silencieux: pref.heure_fin_silencieux
                });
            }

            // Récupérer les types d'événements disponibles
            const typesEvenements = await db.query(
                `SELECT DISTINCT action_type 
                 FROM NOTIFICATIONS 
                 WHERE action_type IS NOT NULL
                 LIMIT 50`
            );

            res.json({
                success: true,
                data: {
                    preferences,
                    types_disponibles: typesEvenements.rows.map(r => r.action_type)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Mettre à jour les préférences pour un canal spécifique
     * @route PUT /api/v1/notifications/preferences/:canal
     */
    async updateChannelPreferences(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { canal } = req.params;
            const { preferences } = req.body; // [{ type_evenement, est_active, heure_debut_silencieux, heure_fin_silencieux }]

            if (!['IN_APP', 'PUSH_MOBILE', 'EMAIL', 'SMS', 'WHATSAPP'].includes(canal)) {
                throw new ValidationError('Canal invalide');
            }

            // Désactiver toutes les préférences existantes pour ce canal
            await client.query(
                `UPDATE PREFERENCES_NOTIFICATIONS 
                 SET est_active = false
                 WHERE compte_id = $1 AND canal = $2`,
                [req.user.id, canal]
            );

            // Mettre à jour ou insérer les nouvelles préférences
            for (const pref of preferences) {
                await client.query(
                    `INSERT INTO PREFERENCES_NOTIFICATIONS 
                     (compte_id, canal, type_evenement, est_active, heure_debut_silencieux, heure_fin_silencieux)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (compte_id, canal, type_evenement) 
                     DO UPDATE SET 
                        est_active = EXCLUDED.est_active,
                        heure_debut_silencieux = EXCLUDED.heure_debut_silencieux,
                        heure_fin_silencieux = EXCLUDED.heure_fin_silencieux`,
                    [
                        req.user.id, canal, pref.type_evenement, pref.est_active,
                        pref.heure_debut_silencieux, pref.heure_fin_silencieux
                    ]
                );
            }

            await client.query('COMMIT');

            // Récupérer les préférences mises à jour
            const updated = await db.query(
                'SELECT * FROM PREFERENCES_NOTIFICATIONS WHERE compte_id = $1 AND canal = $2',
                [req.user.id, canal]
            );

            res.json({
                success: true,
                data: updated.rows,
                message: `Préférences pour ${canal} mises à jour`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour une préférence spécifique
     * @route PATCH /api/v1/notifications/preferences/:canal/:type_evenement
     */
    async updateOne(req, res, next) {
        try {
            const { canal, type_evenement } = req.params;
            const { est_active, heure_debut_silencieux, heure_fin_silencieux } = req.body;

            const result = await db.query(
                `INSERT INTO PREFERENCES_NOTIFICATIONS 
                 (compte_id, canal, type_evenement, est_active, heure_debut_silencieux, heure_fin_silencieux)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (compte_id, canal, type_evenement) 
                 DO UPDATE SET 
                    est_active = EXCLUDED.est_active,
                    heure_debut_silencieux = EXCLUDED.heure_debut_silencieux,
                    heure_fin_silencieux = EXCLUDED.heure_fin_silencieux
                 RETURNING *`,
                [
                    req.user.id, canal, type_evenement, est_active,
                    heure_debut_silencieux, heure_fin_silencieux
                ]
            );

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Préférence mise à jour'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Activer/Désactiver les heures silencieuses pour un canal
     * @route PATCH /api/v1/notifications/preferences/:canal/silencieux
     */
    async setQuietHours(req, res, next) {
        try {
            const { canal } = req.params;
            const { actif, heure_debut, heure_fin } = req.body;

            if (actif && (!heure_debut || !heure_fin)) {
                throw new ValidationError('Heures de début et fin requises');
            }

            await db.query(
                `UPDATE PREFERENCES_NOTIFICATIONS 
                 SET heure_debut_silencieux = $1,
                     heure_fin_silencieux = $2
                 WHERE compte_id = $3 AND canal = $4`,
                [actif ? heure_debut : null, actif ? heure_fin : null, req.user.id, canal]
            );

            res.json({
                success: true,
                message: actif ? 'Heures silencieuses activées' : 'Heures silencieuses désactivées'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Réinitialiser les préférences par défaut
     * @route POST /api/v1/notifications/preferences/reinitialiser
     */
    async resetToDefault(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');

            // Supprimer toutes les préférences existantes
            await client.query(
                'DELETE FROM PREFERENCES_NOTIFICATIONS WHERE compte_id = $1',
                [req.user.id]
            );

            // Insérer les préférences par défaut
            const canaux = ['IN_APP', 'PUSH_MOBILE', 'EMAIL', 'SMS', 'WHATSAPP'];
            const typesParDefaut = ['COMMANDE', 'LIVRAISON', 'PROMOTION', 'SECURITE', 'SYSTEME'];

            for (const canal of canaux) {
                for (const type of typesParDefaut) {
                    await client.query(
                        `INSERT INTO PREFERENCES_NOTIFICATIONS 
                         (compte_id, canal, type_evenement, est_active)
                         VALUES ($1, $2, $3, true)`,
                        [req.user.id, canal, type]
                    );
                }
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Préférences réinitialisées aux valeurs par défaut'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }
}

module.exports = new PreferenceNotificationController();