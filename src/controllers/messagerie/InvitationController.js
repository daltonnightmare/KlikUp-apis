// src/controllers/messagerie/InvitationController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');
const NotificationService = require('../../services/notification/NotificationService');
const { v4: uuidv4 } = require('uuid');

class InvitationController {
    /**
     * Inviter des participants à une conversation
     * @route POST /api/v1/messagerie/conversations/:conversationId/invitations
     */
    async invite(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { conversationId } = req.params;
            const { invitations } = req.body; // [{ email, compte_id, role_propose, message }]

            // Vérifier que l'utilisateur peut inviter
            const participant = await client.query(
                `SELECT * FROM PARTICIPANTS_CONVERSATION 
                 WHERE conversation_id = $1 AND compte_id = $2`,
                [conversationId, req.user.id]
            );

            if (participant.rows.length === 0) {
                throw new AuthorizationError('Vous n\'êtes pas dans cette conversation');
            }

            const permissions = participant.rows[0].permissions || {};
            if (!permissions.peut_inviter && !participant.rows[0].est_administrateur) {
                throw new AuthorizationError('Vous n\'avez pas la permission d\'inviter');
            }

            const results = [];

            for (const invite of invitations) {
                // Générer un token unique
                const token = uuidv4();

                const result = await client.query(
                    `INSERT INTO INVITATIONS_CONVERSATION (
                        conversation_id, invite_par, email_invite, compte_id,
                        token_invitation, role_propose, message_personnalise
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    RETURNING *`,
                    [
                        conversationId, req.user.id, invite.email, invite.compte_id,
                        token, invite.role_propose || 'PARTICIPANT', invite.message
                    ]
                );

                results.push(result.rows[0]);

                // Envoyer la notification
                if (invite.compte_id) {
                    await NotificationService.send({
                        destinataire_id: invite.compte_id,
                        type: 'INVITATION_CONVERSATION',
                        titre: 'Invitation à une conversation',
                        corps: `${req.user.nom_utilisateur_compte} vous a invité à rejoindre une conversation`,
                        entite_source_type: 'INVITATION',
                        entite_source_id: result.rows[0].id,
                        action_url: `/messagerie/invitation/${token}`
                    });
                } else if (invite.email) {
                    // Envoyer un email
                    await this.sendInvitationEmail(invite.email, token, invite.message);
                }
            }

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: results,
                message: `${results.length} invitation(s) envoyée(s)`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Accepter une invitation
     * @route POST /api/v1/messagerie/invitations/:token/accepter
     */
    async accept(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { token } = req.params;

            const invitation = await client.query(
                `SELECT * FROM INVITATIONS_CONVERSATION 
                 WHERE token_invitation = $1 
                   AND statut = 'EN_ATTENTE'
                   AND date_expiration > NOW()`,
                [token]
            );

            if (invitation.rows.length === 0) {
                throw new NotFoundError('Invitation invalide ou expirée');
            }

            const inv = invitation.rows[0];

            // Vérifier que l'invitation correspond à l'utilisateur
            if (inv.compte_id && inv.compte_id !== req.user.id) {
                throw new AuthorizationError('Cette invitation n\'est pas pour vous');
            }

            if (inv.email && inv.email !== req.user.email) {
                throw new AuthorizationError('Cette invitation n\'est pas pour vous');
            }

            // Ajouter le participant
            await client.query(
                `INSERT INTO PARTICIPANTS_CONVERSATION (
                    conversation_id, compte_id, role_participant,
                    est_actif, notifications_actives
                ) VALUES ($1, $2, $3, true, true)`,
                [inv.conversation_id, req.user.id, inv.role_propose]
            );

            // Mettre à jour l'invitation
            await client.query(
                `UPDATE INVITATIONS_CONVERSATION 
                 SET statut = 'ACCEPTEE',
                     date_reponse = NOW(),
                     compte_id = $1
                 WHERE id = $2`,
                [req.user.id, inv.id]
            );

            // Mettre à jour le compteur de participants
            await client.query(
                `UPDATE CONVERSATIONS 
                 SET nombre_participants = nombre_participants + 1
                 WHERE id = $1`,
                [inv.conversation_id]
            );

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Invitation acceptée',
                data: {
                    conversation_id: inv.conversation_id
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Refuser une invitation
     * @route POST /api/v1/messagerie/invitations/:token/refuser
     */
    async decline(req, res, next) {
        try {
            const { token } = req.params;

            const result = await db.query(
                `UPDATE INVITATIONS_CONVERSATION 
                 SET statut = 'REFUSEE',
                     date_reponse = NOW()
                 WHERE token_invitation = $1 
                   AND statut = 'EN_ATTENTE'
                   AND date_expiration > NOW()
                 RETURNING id`,
                [token]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Invitation non trouvée');
            }

            res.json({
                success: true,
                message: 'Invitation refusée'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les invitations en attente
     * @route GET /api/v1/messagerie/invitations/en-attente
     */
    async getPendingInvitations(req, res, next) {
        try {
            const result = await db.query(
                `SELECT i.*,
                        c.titre_conversation,
                        c.type_conversation,
                        inv.nom_utilisateur_compte as inviteur_nom
                 FROM INVITATIONS_CONVERSATION i
                 JOIN CONVERSATIONS c ON c.id = i.conversation_id
                 JOIN COMPTES inv ON inv.id = i.invite_par
                 WHERE (i.compte_id = $1 OR i.email = $2)
                   AND i.statut = 'EN_ATTENTE'
                   AND i.date_expiration > NOW()
                 ORDER BY i.date_envoi DESC`,
                [req.user.id, req.user.email]
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
     * Annuler une invitation
     * @route DELETE /api/v1/messagerie/invitations/:id
     */
    async cancel(req, res, next) {
        try {
            const { id } = req.params;

            // Vérifier que l'utilisateur est l'inviteur
            const result = await db.query(
                `UPDATE INVITATIONS_CONVERSATION 
                 SET statut = 'EXPIREE'
                 WHERE id = $1 AND invite_par = $2 AND statut = 'EN_ATTENTE'
                 RETURNING id`,
                [id, req.user.id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Invitation non trouvée ou déjà traitée');
            }

            res.json({
                success: true,
                message: 'Invitation annulée'
            });

        } catch (error) {
            next(error);
        }
    }

    // ==================== Méthodes privées ====================

    /**
     * Envoyer une invitation par email
     */
    async sendInvitationEmail(email, token, message) {
        // Implémentation selon votre service d'email
        console.log(`Email d'invitation envoyé à ${email} avec token ${token}`);
    }
}

module.exports = new InvitationController();