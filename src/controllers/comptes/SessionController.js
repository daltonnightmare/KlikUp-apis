const db = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');

class SessionController {
    /**
     * Récupérer les sessions actives de l'utilisateur
     * GET /api/v1/comptes/:id/sessions
     */
    static async getUserSessions(req, res, next) {
        try {
            const { id } = req.params;

            // Vérifier les permissions
            if (req.user.id !== parseInt(id) && !req.user.roles.includes('ADMINISTRATEUR_PLATEFORME')) {
                throw new AppError('Non autorisé', 403);
            }

            const result = await db.query(
                `SELECT 
                    id, session_uuid, adresse_ip, user_agent, plateforme,
                    date_creation, date_expiration, date_derniere_activite,
                    CASE WHEN token_hash = $2 THEN true ELSE false END as session_courante
                FROM SESSIONS 
                WHERE compte_id = $1 AND est_active = true
                ORDER BY date_derniere_activite DESC`,
                [id, req.tokenHash]
            );

            res.json({
                success: true,
                data: result.rows
            });
 
        } catch (error) {
            next(error);
        }
    }

    /**
     * Terminer une session spécifique
     * DELETE /api/v1/sessions/:sessionId
     */
    static async terminateSession(req, res, next) {
        const client = await db.getConnection();
        try {
            const { sessionId } = req.params;

            // Récupérer la session
            const sessionResult = await client.query(
                `SELECT s.*, c.nom_utilisateur_compte 
                 FROM SESSIONS s
                 JOIN COMPTES c ON c.id = s.compte_id
                 WHERE s.id = $1`,
                [sessionId]
            );

            if (sessionResult.rows.length === 0) {
                throw new AppError('Session non trouvée', 404);
            }

            const session = sessionResult.rows[0];

            // Vérifier les permissions
            const isAdmin = req.user.roles.includes('ADMINISTRATEUR_PLATEFORME');
            if (session.compte_id !== req.user.id && !isAdmin) {
                throw new AppError('Non autorisé', 403);
            }

            // Empêcher de terminer sa propre session courante (utiliser logout à la place)
            if (session.token_hash === req.tokenHash) {
                throw new AppError('Impossible de terminer votre session courante. Utilisez /logout', 400);
            }

            await client.query(
                `UPDATE SESSIONS 
                 SET est_active = false, date_revocation = NOW(), motif_revocation = 'TERMINATED_BY_USER'
                 WHERE id = $1`,
                [sessionId]
            );

            // Ajouter le token à la liste noire
            if (session.token_hash) {
                await client.query(
                    `INSERT INTO TOKENS_REVOQUES (token_hash, compte_id, motif, date_expiration)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (token_hash) DO NOTHING`,
                    [session.token_hash, session.compte_id, 'SESSION_TERMINATED', 
                     new Date(Date.now() + 24 * 60 * 60 * 1000)]
                );
            }

            // Journaliser l'action
            await AuditService.log({
                action: 'TERMINATE_SESSION',
                ressource_type: 'SESSIONS',
                ressource_id: sessionId,
                donnees_avant: session,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            res.json({
                success: true,
                message: 'Session terminée avec succès'
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Terminer toutes les sessions sauf la courante
     * DELETE /api/v1/sessions/autres
     */
    static async terminateOtherSessions(req, res, next) {
        const client = await db.getConnection();
        try {
            // Récupérer toutes les autres sessions
            const sessionsResult = await client.query(
                `SELECT id, token_hash FROM SESSIONS 
                 WHERE compte_id = $1 
                   AND est_active = true 
                   AND token_hash != $2`,
                [req.user.id, req.tokenHash]
            );

            if (sessionsResult.rows.length === 0) {
                return res.json({
                    success: true,
                    message: 'Aucune autre session active'
                });
            }

            // Désactiver toutes les autres sessions
            await client.query(
                `UPDATE SESSIONS 
                 SET est_active = false, date_revocation = NOW(), motif_revocation = 'BULK_TERMINATE'
                 WHERE compte_id = $1 AND token_hash != $2`,
                [req.user.id, req.tokenHash]
            );

            // Ajouter tous les tokens à la liste noire
            for (const session of sessionsResult.rows) {
                if (session.token_hash) {
                    await client.query(
                        `INSERT INTO TOKENS_REVOQUES (token_hash, compte_id, motif, date_expiration)
                         VALUES ($1, $2, $3, $4)
                         ON CONFLICT (token_hash) DO NOTHING`,
                        [session.token_hash, req.user.id, 'BULK_TERMINATE',
                         new Date(Date.now() + 24 * 60 * 60 * 1000)]
                    );
                }
            }

            // Journaliser l'action
            await AuditService.log({
                action: 'TERMINATE_ALL_SESSIONS',
                ressource_type: 'COMPTES',
                ressource_id: req.user.id,
                donnees_apres: { sessions_terminees: sessionsResult.rows.length },
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            res.json({
                success: true,
                message: `${sessionsResult.rows.length} session(s) terminée(s) avec succès`
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }
}

module.exports = SessionController;