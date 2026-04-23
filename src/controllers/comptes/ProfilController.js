// src/controllers/comptes/ProfilController.js
const db = require('../../configuration/database');
const bcrypt = require('bcrypt');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { AppError, ValidationError, AuthorizationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const FileService = require('../../services/file/FileService');
const EmailService = require('../../services/email/EmailService');
const SmsService = require('../../services/sms/SmsService');
const { v4: uuidv4 } = require('uuid');

class ProfilController {
    
    // ==================== PROFIL DE BASE ====================

    /**
     * Récupérer le profil de l'utilisateur connecté
     * @route GET /api/v1/comptes/profil
     */
    async getMonProfil(req, res, next) {
        try {
            const userId = req.user.id;

            const result = await db.query(
                `SELECT 
                    c.id,
                    c.email,
                    c.nom_utilisateur_compte,
                    c.numero_de_telephone,
                    c.photo_profil_compte,
                    c.statut,
                    c.compte_role,
                    c.date_creation,
                    c.date_mise_a_jour,
                    c.date_derniere_connexion,
                    -- Récupérer les entités associées
                    (
                        SELECT COALESCE(json_agg(
                            json_build_object(
                                'id', cc.compagnie_id,
                                'nom', ct.nom_compagnie,
                                'role', cc.role_dans_compagnie,
                                'est_defaut', cc.est_defaut,
                                'matricule', cc.matricule,
                                'service', cc.service
                            )
                        ), '[]'::json)
                        FROM COMPTES_COMPAGNIES cc
                        LEFT JOIN COMPAGNIESTRANSPORT ct ON ct.id = cc.compagnie_id
                        WHERE cc.compte_id = c.id
                    ) as compagnies,
                    (
                        SELECT COALESCE(json_agg(
                            json_build_object(
                                'id', cr.restaurant_id,
                                'nom', rf.nom_restaurant_fast_food,
                                'role', cr.role_dans_resto,
                                'est_defaut', cr.est_defaut
                            )
                        ), '[]'::json)
                        FROM COMPTES_RESTAURANTS cr
                        LEFT JOIN RESTAURANTSFASTFOOD rf ON rf.id = cr.restaurant_id
                        WHERE cr.compte_id = c.id
                    ) as restaurants,
                    (
                        SELECT COALESCE(json_agg(
                            json_build_object(
                                'id', cb.boutique_id,
                                'nom', b.nom_boutique,
                                'role', cb.role_dans_boutique,
                                'est_defaut', cb.est_defaut
                            )
                        ), '[]'::json)
                        FROM COMPTES_BOUTIQUES cb
                        LEFT JOIN BOUTIQUES b ON b.id = cb.boutique_id
                        WHERE cb.compte_id = c.id
                    ) as boutiques
                FROM COMPTES c
                WHERE c.id = $1 AND c.est_supprime = false`,
                [userId]
            );

            if (result.rows.length === 0) {
                throw new AppError('Profil non trouvé', 404);
            }

            const profil = result.rows[0];
            
            // Ajouter les statistiques dans une seconde requête
            const stats = await db.query(
                `SELECT 
                    (SELECT COUNT(*) FROM CONVERSATIONS c2
                    JOIN PARTICIPANTS_CONVERSATION pc ON pc.conversation_id = c2.id
                    WHERE pc.compte_id = $1 AND pc.est_actif = true) as nombre_conversations,
                    (SELECT COUNT(*) FROM MESSAGES m
                    WHERE m.expediteur_id = $1 AND m.date_suppression IS NULL) as nombre_messages_envoyes,
                    (SELECT COUNT(*) FROM AVIS a
                    WHERE a.auteur_id = $1 AND a.statut = 'PUBLIE') as nombre_avis,
                    (SELECT COALESCE(SUM(points_actuels), 0)
                    FROM SOLDES_FIDELITE
                    WHERE compte_id = $1) as total_points_fidelite`,
                [userId]
            );
            
            profil.statistiques = stats.rows[0];

            // Déterminer l'entité principale
            if (profil.compagnies && profil.compagnies.length > 0) {
                const defaut = profil.compagnies.find(c => c.est_defaut) || profil.compagnies[0];
                profil.entite_principale = { type: 'COMPAGNIE', ...defaut };
            } else if (profil.restaurants && profil.restaurants.length > 0) {
                const defaut = profil.restaurants.find(r => r.est_defaut) || profil.restaurants[0];
                profil.entite_principale = { type: 'RESTAURANT', ...defaut };
            } else if (profil.boutiques && profil.boutiques.length > 0) {
                const defaut = profil.boutiques.find(b => b.est_defaut) || profil.boutiques[0];
                profil.entite_principale = { type: 'BOUTIQUE', ...defaut };
            }

            res.json({ success: true, data: profil });

        } catch (error) {
            console.error('Erreur getMonProfil:', error);
            next(error);
        }
    }

    /**
     * Mettre à jour le profil de l'utilisateur connecté
     * @route PUT /api/v1/comptes/profil
     */
    async updateMonProfil(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const userId = req.user.id;
            const { nom_utilisateur_compte, numero_de_telephone, email } = req.body;

            const currentResult = await client.query(
                `SELECT * FROM COMPTES WHERE id = $1`,
                [userId]
            );

            if (currentResult.rows.length === 0) {
                throw new AppError('Profil non trouvé', 404);
            }

            const currentUser = currentResult.rows[0];
            const updates = [];
            const params = [];
            let paramIndex = 1;

            // Vérifier et mettre à jour le nom d'utilisateur
            if (nom_utilisateur_compte && nom_utilisateur_compte !== currentUser.nom_utilisateur_compte) {
                const existing = await client.query(
                    `SELECT id FROM COMPTES WHERE nom_utilisateur_compte = $1 AND id != $2`,
                    [nom_utilisateur_compte, userId]
                );
                if (existing.rows.length > 0) {
                    throw new ValidationError('Ce nom d\'utilisateur est déjà pris');
                }
                updates.push(`nom_utilisateur_compte = $${paramIndex++}`);
                params.push(nom_utilisateur_compte);
            }

            // Vérifier et mettre à jour le téléphone
            if (numero_de_telephone && numero_de_telephone !== currentUser.numero_de_telephone) {
                const existing = await client.query(
                    `SELECT id FROM COMPTES WHERE numero_de_telephone = $1 AND id != $2`,
                    [numero_de_telephone, userId]
                );
                if (existing.rows.length > 0) {
                    throw new ValidationError('Ce numéro de téléphone est déjà utilisé');
                }
                updates.push(`numero_de_telephone = $${paramIndex++}`);
                params.push(numero_de_telephone);
                updates.push(`telephone_verifie = false`);
            }

            // Vérifier et mettre à jour l'email
            if (email && email !== currentUser.email) {
                const existing = await client.query(
                    `SELECT id FROM COMPTES WHERE email = $1 AND id != $2`,
                    [email, userId]
                );
                if (existing.rows.length > 0) {
                    throw new ValidationError('Cet email est déjà utilisé');
                }
                updates.push(`email = $${paramIndex++}`);
                params.push(email);
                updates.push(`email_verifie = false`);
            }

            if (updates.length === 0) {
                await client.query('COMMIT');
                return res.json({ success: true, message: 'Aucune modification effectuée', data: currentUser });
            }

            updates.push(`date_mise_a_jour = NOW()`);
            params.push(userId);

            const updateQuery = `
                UPDATE COMPTES 
                SET ${updates.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING id, email, nom_utilisateur_compte, numero_de_telephone,
                          photo_profil_compte, statut, compte_role, date_mise_a_jour
            `;

            const result = await client.query(updateQuery, params);

            await AuditService.log({
                action: 'UPDATE_PROFIL',
                ressource_type: 'COMPTES',
                ressource_id: userId,
                donnees_avant: currentUser,
                donnees_apres: result.rows[0],
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent')
            });

            await client.query('COMMIT');

            res.json({ success: true, message: 'Profil mis à jour avec succès', data: result.rows[0] });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Changer la photo de profil
     * @route POST /api/v1/comptes/profil/photo
     */
    async uploadPhoto(req, res, next) {
        try {
            const userId = req.user.id;

            if (!req.file) {
                throw new ValidationError('Aucun fichier fourni');
            }

            const fileResult = await FileService.saveImage(req.file, 'avatars', {
                prefix: `utilisateur_${userId}`,
                maxWidth: 500,
                maxHeight: 500,
                quality: 80,
                generateThumbnail: true,
                thumbnailSize: 150
            });

            await db.query(
                `UPDATE COMPTES SET photo_profil_compte = $1, date_mise_a_jour = NOW() WHERE id = $2`,
                [fileResult.url, userId]
            );

            res.json({ success: true, message: 'Photo de profil mise à jour', data: fileResult });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Supprimer la photo de profil
     * @route DELETE /api/v1/comptes/profil/photo
     */
    async deletePhoto(req, res, next) {
        try {
            const userId = req.user.id;

            await db.query(
                `UPDATE COMPTES SET photo_profil_compte = NULL, date_mise_a_jour = NOW() WHERE id = $1`,
                [userId]
            );

            res.json({ success: true, message: 'Photo de profil supprimée' });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Changer le mot de passe
     * @route POST /api/v1/comptes/profil/changer-mot-de-passe
     */
    async changePassword(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const userId = req.user.id;
            const { mot_de_passe_actuel, nouveau_mot_de_passe, confirmation_mot_de_passe } = req.body;

            if (!mot_de_passe_actuel || !nouveau_mot_de_passe) {
                throw new ValidationError('Mot de passe actuel et nouveau mot de passe requis');
            }

            if (nouveau_mot_de_passe !== confirmation_mot_de_passe) {
                throw new ValidationError('Les nouveaux mots de passe ne correspondent pas');
            }

            if (nouveau_mot_de_passe.length < 8) {
                throw new ValidationError('Le nouveau mot de passe doit contenir au moins 8 caractères');
            }

            const userResult = await client.query(
                `SELECT mot_de_passe_compte FROM COMPTES WHERE id = $1`,
                [userId]
            );

            if (userResult.rows.length === 0) {
                throw new AppError('Utilisateur non trouvé', 404);
            }

            const isValid = await bcrypt.compare(mot_de_passe_actuel, userResult.rows[0].mot_de_passe_compte);
            
            if (!isValid) {
                throw new ValidationError('Mot de passe actuel incorrect');
            }

            const hashedPassword = await bcrypt.hash(nouveau_mot_de_passe, 10);

            await client.query(
                `UPDATE COMPTES SET mot_de_passe_compte = $1, date_mise_a_jour = NOW() WHERE id = $2`,
                [hashedPassword, userId]
            );

            await AuditService.log({
                action: 'CHANGE_PASSWORD',
                ressource_type: 'COMPTES',
                ressource_id: userId,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent')
            });

            await client.query('COMMIT');

            res.json({ success: true, message: 'Mot de passe modifié avec succès' });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ==================== SESSIONS ====================

    /**
     * Récupérer les sessions actives
     * @route GET /api/v1/comptes/profil/sessions
     */
    async getSessionsActives(req, res, next) {
        try {
            const userId = req.user.id;

            const result = await db.query(
                `SELECT 
                    id, session_uuid, adresse_ip, user_agent, plateforme,
                    date_creation, date_expiration, date_derniere_activite,
                    CASE WHEN token_hash = $2 THEN true ELSE false END as session_courante
                FROM SESSIONS 
                WHERE compte_id = $1 AND est_active = true AND date_expiration > NOW()
                ORDER BY date_derniere_activite DESC`,
                [userId, req.tokenHash]
            );

            res.json({ success: true, data: result.rows, total: result.rows.length });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Terminer une session spécifique
     * @route DELETE /api/v1/comptes/profil/sessions/:sessionId
     */
    async terminateSession(req, res, next) {
        const client = await db.pool.connect();
        try {
            const { sessionId } = req.params;
            const userId = req.user.id;

            const sessionResult = await client.query(
                `SELECT * FROM SESSIONS WHERE id = $1 AND compte_id = $2`,
                [sessionId, userId]
            );

            if (sessionResult.rows.length === 0) {
                throw new AppError('Session non trouvée', 404);
            }

            const session = sessionResult.rows[0];

            if (session.token_hash === req.tokenHash) {
                throw new ValidationError('Impossible de terminer votre session courante');
            }

            await client.query(
                `UPDATE SESSIONS SET est_active = false, date_revocation = NOW(), motif_revocation = 'USER_TERMINATED'
                 WHERE id = $1`,
                [sessionId]
            );

            if (session.token_hash) {
                await client.query(
                    `INSERT INTO TOKENS_REVOQUES (token_hash, compte_id, motif, date_expiration)
                     VALUES ($1, $2, 'SESSION_TERMINATED', NOW() + INTERVAL '24 hours')
                     ON CONFLICT (token_hash) DO NOTHING`,
                    [session.token_hash, userId]
                );
            }

            res.json({ success: true, message: 'Session terminée avec succès' });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Terminer toutes les autres sessions
     * @route POST /api/v1/comptes/profil/sessions/terminer-autres
     */
    async terminateOtherSessions(req, res, next) {
        const client = await db.pool.connect();
        try {
            const userId = req.user.id;
            const currentTokenHash = req.tokenHash;

            const sessionsResult = await client.query(
                `SELECT id, token_hash FROM SESSIONS 
                 WHERE compte_id = $1 AND est_active = true AND token_hash != $2`,
                [userId, currentTokenHash]
            );

            await client.query(
                `UPDATE SESSIONS 
                 SET est_active = false, date_revocation = NOW(), motif_revocation = 'BULK_TERMINATE'
                 WHERE compte_id = $1 AND token_hash != $2`,
                [userId, currentTokenHash]
            );

            for (const session of sessionsResult.rows) {
                if (session.token_hash) {
                    await client.query(
                        `INSERT INTO TOKENS_REVOQUES (token_hash, compte_id, motif, date_expiration)
                         VALUES ($1, $2, 'BULK_TERMINATE', NOW() + INTERVAL '24 hours')
                         ON CONFLICT (token_hash) DO NOTHING`,
                        [session.token_hash, userId]
                    );
                }
            }

            res.json({ success: true, message: `${sessionsResult.rows.length} session(s) terminée(s)` });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    // ==================== 2FA ====================

    /**
     * Activer la 2FA
     * @route POST /api/v1/comptes/profil/2fa/activer
     */
    async activer2FA(req, res, next) {
        const client = await db.pool.connect();
        try {
            const userId = req.user.id;
            const userEmail = req.user.email;

            const secret = speakeasy.generateSecret({ name: `Plateforme:${userEmail}` });

            await client.query(
                `UPDATE COMPTES SET two_factor_temp_secret = $1, date_mise_a_jour = NOW() WHERE id = $2`,
                [secret.base32, userId]
            );

            const qrCode = await QRCode.toDataURL(secret.otpauth_url);

            await client.query('COMMIT');

            res.json({ success: true, data: { secret: secret.base32, qr_code: qrCode } });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Valider et activer la 2FA
     * @route POST /api/v1/comptes/profil/2fa/valider
     */
    async valider2FA(req, res, next) {
        const client = await db.pool.connect();
        try {
            const userId = req.user.id;
            const { token } = req.body;

            const result = await client.query(
                `SELECT two_factor_temp_secret FROM COMPTES WHERE id = $1`,
                [userId]
            );

            if (!result.rows[0]?.two_factor_temp_secret) {
                throw new AppError('Aucune activation 2FA en cours', 400);
            }

            const verified = speakeasy.totp.verify({
                secret: result.rows[0].two_factor_temp_secret,
                encoding: 'base32',
                token
            });

            if (!verified) {
                throw new ValidationError('Code invalide');
            }

            // Générer codes de secours
            const backupCodes = [];
            for (let i = 0; i < 8; i++) {
                backupCodes.push(Math.random().toString(36).substring(2, 10).toUpperCase());
            }

            await client.query(
                `UPDATE COMPTES 
                 SET two_factor_secret = two_factor_temp_secret,
                     two_factor_temp_secret = NULL,
                     two_factor_actif = true,
                     two_factor_backup_codes = $1,
                     date_mise_a_jour = NOW()
                 WHERE id = $2`,
                [JSON.stringify(backupCodes), userId]
            );

            await client.query('COMMIT');

            res.json({ success: true, message: '2FA activée avec succès', data: { backup_codes: backupCodes } });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Désactiver la 2FA
     * @route POST /api/v1/comptes/profil/2fa/desactiver
     */
    async desactiver2FA(req, res, next) {
        const client = await db.pool.connect();
        try {
            const userId = req.user.id;
            const { mot_de_passe } = req.body;

            const result = await client.query(
                `SELECT mot_de_passe_compte FROM COMPTES WHERE id = $1`,
                [userId]
            );

            const isValid = await bcrypt.compare(mot_de_passe, result.rows[0].mot_de_passe_compte);
            if (!isValid) {
                throw new ValidationError('Mot de passe incorrect');
            }

            await client.query(
                `UPDATE COMPTES 
                 SET two_factor_secret = NULL,
                     two_factor_temp_secret = NULL,
                     two_factor_actif = false,
                     two_factor_backup_codes = NULL,
                     date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [userId]
            );

            await client.query('COMMIT');

            res.json({ success: true, message: '2FA désactivée avec succès' });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ==================== STATISTIQUES ====================

    /**
     * Récupérer les statistiques du profil
     * @route GET /api/v1/comptes/profil/stats
     */
    async getProfilStats(req, res, next) {
        try {
            const userId = req.user.id;

            const stats = await db.query(
                `SELECT 
                    (SELECT COUNT(*) FROM CONVERSATIONS c
                     JOIN PARTICIPANTS_CONVERSATION pc ON pc.conversation_id = c.id
                     WHERE pc.compte_id = $1 AND pc.est_actif = true) as conversations_actives,
                    (SELECT COUNT(*) FROM MESSAGES m
                     WHERE m.expediteur_id = $1 AND m.date_suppression IS NULL) as messages_envoyes,
                    (SELECT COALESCE(SUM(pc.messages_non_lus), 0)
                     FROM PARTICIPANTS_CONVERSATION pc
                     WHERE pc.compte_id = $1 AND pc.est_actif = true) as messages_non_lus,
                    (SELECT COUNT(*) FROM ARTICLES_BLOG_PLATEFORME
                     WHERE auteur_id = $1 AND statut = 'PUBLIE') as articles_publies,
                    (SELECT COUNT(*) FROM COMMENTAIRES
                     WHERE auteur_id = $1 AND statut = 'APPROUVE') as commentaires_publies,
                    (SELECT COUNT(*) FROM AVIS
                     WHERE auteur_id = $1 AND statut = 'PUBLIE') as avis_publies,
                    (SELECT COALESCE(SUM(points_actuels), 0)
                     FROM SOLDES_FIDELITE WHERE compte_id = $1) as points_fidelite,
                    (SELECT COUNT(*) FROM PARRAINAGES
                     WHERE parrain_id = $1 AND statut = 'UTILISE') as filleuls_parraines`,
                [userId]
            );

            res.json({ success: true, data: stats.rows[0] });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer l'historique des connexions
     * @route GET /api/v1/comptes/profil/historique-connexions
     */
    async getHistoriqueConnexions(req, res, next) {
        try {
            const { page = 1, limit = 20, date_debut, date_fin } = req.query;
            const offset = (page - 1) * limit;
            const userId = req.user.id;

            let query = `
                SELECT id, type_connexion, adresse_ip, utilisateur_agent as user_agent,
                       pays, ville, statut_connexion, code_erreur, date_connexion,
                       date_deconnexion, duree_session
                FROM HISTORIQUE_CONNEXIONS
                WHERE compte_id = $1
            `;
            const params = [userId];
            let paramIndex = 2;

            if (date_debut) {
                query += ` AND date_connexion >= $${paramIndex++}`;
                params.push(date_debut);
            }
            if (date_fin) {
                query += ` AND date_connexion <= $${paramIndex++}`;
                params.push(date_fin);
            }

            query += ` ORDER BY date_connexion DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);

            const stats = await db.query(
                `SELECT COUNT(*) as total_connexions,
                        COUNT(*) FILTER (WHERE statut_connexion = 'SUCCESS') as connexions_reussies,
                        COUNT(*) FILTER (WHERE statut_connexion = 'FAILED') as connexions_echouees
                 FROM HISTORIQUE_CONNEXIONS WHERE compte_id = $1`,
                [userId]
            );

            res.json({
                success: true,
                data: { connexions: result.rows, stats: stats.rows[0] },
                pagination: { page: parseInt(page), limit: parseInt(limit), total: result.rows.length }
            });

        } catch (error) {
            next(error);
        }
    }

    // ==================== SUPPRESSION DE COMPTE ====================

    /**
     * Supprimer son compte (soft delete)
     * @route DELETE /api/v1/comptes/profil
     */
    async deleteMonCompte(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const userId = req.user.id;
            const { mot_de_passe, raison } = req.body;

            if (!mot_de_passe) {
                throw new ValidationError('Mot de passe requis pour confirmer la suppression');
            }

            const userResult = await client.query(
                `SELECT mot_de_passe_compte FROM COMPTES WHERE id = $1`,
                [userId]
            );

            const isValid = await bcrypt.compare(mot_de_passe, userResult.rows[0].mot_de_passe_compte);
            if (!isValid) {
                throw new ValidationError('Mot de passe incorrect');
            }

            await client.query(
                `UPDATE COMPTES 
                 SET est_supprime = true, date_suppression = NOW(), statut = 'SUSPENDU', date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [userId]
            );

            await client.query(
                `UPDATE SESSIONS 
                 SET est_active = false, date_revocation = NOW(), motif_revocation = 'ACCOUNT_DELETED'
                 WHERE compte_id = $1 AND est_active = true`,
                [userId]
            );

            await AuditService.log({
                action: 'DELETE_ACCOUNT',
                ressource_type: 'COMPTES',
                ressource_id: userId,
                metadata: { raison: raison || 'Non spécifiée' },
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            res.json({ success: true, message: 'Votre compte a été supprimé avec succès' });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ==================== VÉRIFICATIONS ====================

    /**
     * Vérifier la disponibilité d'un nom d'utilisateur
     * @route GET /api/v1/comptes/profil/verifier-nom/:nom
     */
    async checkUsername(req, res, next) {
        try {
            const { nom } = req.params;
            const userId = req.user.id;

            const result = await db.query(
                `SELECT id FROM COMPTES WHERE nom_utilisateur_compte = $1 AND id != $2 AND est_supprime = false`,
                [nom, userId]
            );

            res.json({ success: true, disponible: result.rows.length === 0 });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Vérifier la disponibilité d'un email
     * @route GET /api/v1/comptes/profil/verifier-email/:email
     */
    async checkEmail(req, res, next) {
        try {
            const { email } = req.params;
            const userId = req.user.id;

            const result = await db.query(
                `SELECT id FROM COMPTES WHERE email = $1 AND id != $2 AND est_supprime = false`,
                [email, userId]
            );

            res.json({ success: true, disponible: result.rows.length === 0 });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new ProfilController();