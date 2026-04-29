// src/controllers/admin/UserManagementController.js
const db = require('../../configuration/database');
const bcrypt = require('bcrypt');
const { ValidationError, NotFoundError, AuthorizationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const NotificationService = require('../../services/notification/NotificationService');
const EmailService = require('../../services/email/EmailService');
const SmsService = require('../../services/sms/SmsService');
const CacheService = require('../../services/cache/CacheService');
const logger = require('../../configuration/logger');
class UserManagementController {
    
    // ==================== LISTE DES UTILISATEURS ====================

    /**
     * Récupérer tous les utilisateurs avec pagination et filtres
     * @route GET /api/v1/admin/users
     */
    async getAllUsers(req, res, next) {
        const client = await db.getClient();
        try {
            const {
                page = 1,
                limit = 20,
                search = '',
                role,
                statut,
                entite_type,
                entite_id,
                date_debut,
                date_fin,
                sort_by = 'date_creation',
                sort_order = 'DESC'
            } = req.query;

            const offset = (page - 1) * limit;
            const params = [];
            let paramIndex = 1;
            const conditions = ['c.est_supprime = false'];

            // Recherche textuelle
            if (search) {
                conditions.push(`(
                    c.nom_utilisateur_compte ILIKE $${paramIndex} OR
                    c.email ILIKE $${paramIndex} OR
                    c.numero_de_telephone ILIKE $${paramIndex}
                )`);
                params.push(`%${search}%`);
                paramIndex++;
            }

            // Filtre par rôle
            if (role) {
                conditions.push(`c.compte_role = $${paramIndex}`);
                params.push(role);
                paramIndex++;
            }

            // Filtre par statut
            if (statut) {
                conditions.push(`c.statut = $${paramIndex}`);
                params.push(statut);
                paramIndex++;
            }

            // Filtre par entité
            if (entite_type && entite_id) {
                switch (entite_type) {
                    case 'COMPAGNIE':
                        conditions.push(`EXISTS (
                            SELECT 1 FROM COMPTES_COMPAGNIES cc 
                            WHERE cc.compte_id = c.id AND cc.compagnie_id = $${paramIndex}
                        )`);
                        params.push(entite_id);
                        paramIndex++;
                        break;
                    case 'RESTAURANT':
                        conditions.push(`EXISTS (
                            SELECT 1 FROM COMPTES_RESTAURANTS cr 
                            WHERE cr.compte_id = c.id AND cr.restaurant_id = $${paramIndex}
                        )`);
                        params.push(entite_id);
                        paramIndex++;
                        break;
                    case 'BOUTIQUE':
                        conditions.push(`EXISTS (
                            SELECT 1 FROM COMPTES_BOUTIQUES cb 
                            WHERE cb.compte_id = c.id AND cb.boutique_id = $${paramIndex}
                        )`);
                        params.push(entite_id);
                        paramIndex++;
                        break;
                }
            }

            // Filtre par date
            if (date_debut) {
                conditions.push(`c.date_creation >= $${paramIndex}`);
                params.push(date_debut);
                paramIndex++;
            }
            if (date_fin) {
                conditions.push(`c.date_creation <= $${paramIndex}`);
                params.push(date_fin);
                paramIndex++;
            }

            // Colonnes de tri autorisées
            const sortableColumns = {
                'id': 'c.id',
                'nom_utilisateur_compte': 'c.nom_utilisateur_compte',
                'email': 'c.email',
                'compte_role': 'c.compte_role::text',
                'statut': 'c.statut::text',
                'date_creation': 'c.date_creation',
                'date_derniere_connexion': 'c.date_derniere_connexion'
            };
            const orderColumn = sortableColumns[sort_by] || 'c.date_creation';
            const orderDirection = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
            await client.query('BEGIN');
            // Requête principale
            const query = `
                SELECT 
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
                    c.date_verouillage,
                    c.tentatives_echec_connexion,
                    (
                        SELECT COUNT(*) FROM SESSIONS 
                        WHERE compte_id = c.id AND est_active = true
                    ) as sessions_actives,
                    COUNT(*) OVER() as total_count
                FROM COMPTES c
                WHERE ${conditions.join(' AND ')}
                ORDER BY ${orderColumn} ${orderDirection}
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;

            params.push(parseInt(limit), offset);
            const result = await client.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Statistiques globales
            const stats = await client.query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE statut = 'EST_AUTHENTIFIE') as actifs,
                    COUNT(*) FILTER (WHERE statut = 'NON_AUTHENTIFIE') as non_authentifies,
                    COUNT(*) FILTER (WHERE statut = 'SUSPENDU') as suspendus,
                    COUNT(*) FILTER (WHERE statut = 'BANNI') as bannis,
                    COUNT(*) FILTER (WHERE date_creation >= NOW() - INTERVAL '7 days') as nouveaux_7j,
                    COUNT(*) FILTER (WHERE date_creation >= NOW() - INTERVAL '30 days') as nouveaux_30j
                FROM COMPTES
                WHERE est_supprime = false
            `);

            // Répartition par rôle
            const rolesStats = await client.query(`
                SELECT compte_role::text as role, COUNT(*) as count
                FROM COMPTES
                WHERE est_supprime = false
                GROUP BY compte_role
                ORDER BY count DESC
            `);
            await client.query('COMMIT');
            res.json({
                success: true,
                data: result.rows,
                stats: {
                    ...stats.rows[0],
                    par_role: rolesStats.rows
                },
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(total),
                    pages: Math.ceil(parseInt(total) / parseInt(limit))
                }
            });

        } catch (error) {
            console.error('Erreur getAllUsers:', error);
            client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer un utilisateur par ID
     * @route GET /api/v1/admin/users/:id
     */
    async getUserById(req, res, next) {
        const client = await db.pool.connect();
        try {
            const { id } = req.params;

            const result = await client.query(`
                SELECT 
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
                    c.date_verouillage,
                    c.tentatives_echec_connexion,
                    -- Entités associées
                    (
                        SELECT json_agg(
                            json_build_object(
                                'id', cc.compagnie_id,
                                'nom', ct.nom_compagnie,
                                'role', cc.role_dans_compagnie,
                                'est_defaut', cc.est_defaut
                            )
                        )
                        FROM COMPTES_COMPAGNIES cc
                        LEFT JOIN COMPAGNIESTRANSPORT ct ON ct.id = cc.compagnie_id
                        WHERE cc.compte_id = c.id
                    ) as compagnies,
                    (
                        SELECT json_agg(
                            json_build_object(
                                'id', cr.restaurant_id,
                                'nom', rf.nom_restaurant_fast_food,
                                'role', cr.role_dans_resto,
                                'est_defaut', cr.est_defaut
                            )
                        )
                        FROM COMPTES_RESTAURANTS cr
                        LEFT JOIN RESTAURANTSFASTFOOD rf ON rf.id = cr.restaurant_id
                        WHERE cr.compte_id = c.id
                    ) as restaurants,
                    (
                        SELECT json_agg(
                            json_build_object(
                                'id', cb.boutique_id,
                                'nom', b.nom_boutique,
                                'role', cb.role_dans_boutique,
                                'est_defaut', cb.est_defaut
                            )
                        )
                        FROM COMPTES_BOUTIQUES cb
                        LEFT JOIN BOUTIQUES b ON b.id = cb.boutique_id
                        WHERE cb.compte_id = c.id
                    ) as boutiques,
                    -- Sessions actives
                    (
                        SELECT json_agg(
                            json_build_object(
                                'id', s.id,
                                'session_uuid', s.session_uuid,
                                'adresse_ip', s.adresse_ip,
                                'plateforme', s.plateforme,
                                'date_creation', s.date_creation,
                                'date_derniere_activite', s.date_derniere_activite
                            )
                        )
                        FROM SESSIONS s
                        WHERE s.compte_id = c.id AND s.est_active = true
                    ) as sessions_actives,
                    -- Dernière connexion
                    (
                        SELECT json_build_object(
                            'date', date_connexion,
                            'ip', adresse_ip,
                            'statut', statut_connexion
                        )
                        FROM HISTORIQUE_CONNEXIONS
                        WHERE compte_id = c.id
                        ORDER BY date_connexion DESC
                        LIMIT 1
                    ) as derniere_connexion
                FROM COMPTES c
                WHERE c.id = $1 AND c.est_supprime = false
            `, [id]);

            if (result.rows.length === 0) {
                throw new NotFoundError('Utilisateur non trouvé');
            }

            const user = result.rows[0];
            
            // Parser les JSON
            user.compagnies = user.compagnies || [];
            user.restaurants = user.restaurants || [];
            user.boutiques = user.boutiques || [];
            user.sessions_actives = user.sessions_actives || [];

            res.json({
                success: true,
                data: user
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    // ==================== CRÉATION ET MODIFICATION ====================

    /**
     * Créer un nouvel utilisateur
     * @route POST /api/v1/admin/users
     */
    async createUser(req, res, next) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const {
                email,
                nom_utilisateur_compte,
                numero_de_telephone,
                mot_de_passe,
                compte_role = 'UTILISATEUR_PRIVE_SIMPLE',
                statut = 'EST_AUTHENTIFIE',
                photo_profil_compte = null
            } = req.body;

            // Validations
            if (!nom_utilisateur_compte || !numero_de_telephone || !mot_de_passe) {
                throw new ValidationError('Nom d\'utilisateur, téléphone et mot de passe requis');
            }

            if (mot_de_passe.length < 8) {
                throw new ValidationError('Le mot de passe doit contenir au moins 8 caractères');
            }

            // Vérifier l'unicité
            const existing = await client.query(`
                SELECT id FROM COMPTES 
                WHERE nom_utilisateur_compte = $1 OR numero_de_telephone = $2 OR (email IS NOT NULL AND email = $3)
            `, [nom_utilisateur_compte, numero_de_telephone, email || null]);

            if (existing.rows.length > 0) {
                throw new ValidationError('Un utilisateur avec ces informations existe déjà');
            }

            // Hacher le mot de passe
            const hashedPassword = await bcrypt.hash(mot_de_passe, 10);

            // Créer l'utilisateur
            const fields = ['nom_utilisateur_compte', 'numero_de_telephone', 'mot_de_passe_compte', 'compte_role', 'statut'];
            const values = [nom_utilisateur_compte, numero_de_telephone, hashedPassword, compte_role, statut];

            if (email) {
                fields.push('email');
                values.push(email);
            }
            if (photo_profil_compte) {
                fields.push('photo_profil_compte');
                values.push(photo_profil_compte);
            }

            const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
            const insertQuery = `
                INSERT INTO COMPTES (${fields.join(', ')}, date_creation, date_mise_a_jour)
                VALUES (${placeholders}, NOW(), NOW())
                RETURNING id, nom_utilisateur_compte, email, numero_de_telephone, compte_role, statut
            `;

            const result = await client.query(insertQuery, values);
            const newUser = result.rows[0];

            await AuditService.log({
                action: 'ADMIN_CREATE_USER',
                ressource_type: 'COMPTES',
                ressource_id: newUser.id,
                donnees_apres: newUser,
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            // Envoyer notification
            if (email) {
                await EmailService.sendWelcomeEmail(email, nom_utilisateur_compte);
            }
            await SmsService.sendSms(numero_de_telephone, `Bienvenue sur la plateforme ! Votre compte a été créé. Identifiant: ${nom_utilisateur_compte}`);

            res.status(201).json({
                success: true,
                data: newUser,
                message: 'Utilisateur créé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour un utilisateur
     * @route PUT /api/v1/admin/users/:id
     */
    async updateUser(req, res, next) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const {
                nom_utilisateur_compte,
                email,
                numero_de_telephone,
                compte_role,
                statut,
                photo_profil_compte
            } = req.body;

            const currentUser = await client.query(
                'SELECT * FROM COMPTES WHERE id = $1 AND est_supprime = false',
                [id]
            );

            if (currentUser.rows.length === 0) {
                throw new NotFoundError('Utilisateur non trouvé');
            }

            const current = currentUser.rows[0];
            const updates = [];
            const params = [];
            let paramIndex = 1;

            if (nom_utilisateur_compte && nom_utilisateur_compte !== current.nom_utilisateur_compte) {
                const existing = await client.query(
                    'SELECT id FROM COMPTES WHERE nom_utilisateur_compte = $1 AND id != $2',
                    [nom_utilisateur_compte, id]
                );
                if (existing.rows.length > 0) {
                    throw new ValidationError('Ce nom d\'utilisateur est déjà pris');
                }
                updates.push(`nom_utilisateur_compte = $${paramIndex++}`);
                params.push(nom_utilisateur_compte);
            }

            if (email && email !== current.email) {
                const existing = await client.query(
                    'SELECT id FROM COMPTES WHERE email = $1 AND id != $2',
                    [email, id]
                );
                if (existing.rows.length > 0) {
                    throw new ValidationError('Cet email est déjà utilisé');
                }
                updates.push(`email = $${paramIndex++}`);
                params.push(email);
            }

            if (numero_de_telephone && numero_de_telephone !== current.numero_de_telephone) {
                const existing = await client.query(
                    'SELECT id FROM COMPTES WHERE numero_de_telephone = $1 AND id != $2',
                    [numero_de_telephone, id]
                );
                if (existing.rows.length > 0) {
                    throw new ValidationError('Ce numéro de téléphone est déjà utilisé');
                }
                updates.push(`numero_de_telephone = $${paramIndex++}`);
                params.push(numero_de_telephone);
            }

            if (compte_role && compte_role !== current.compte_role) {
                updates.push(`compte_role = $${paramIndex++}`);
                params.push(compte_role);
            }

            if (statut && statut !== current.statut) {
                updates.push(`statut = $${paramIndex++}`);
                params.push(statut);
            }

            if (photo_profil_compte !== undefined && photo_profil_compte !== current.photo_profil_compte) {
                updates.push(`photo_profil_compte = $${paramIndex++}`);
                params.push(photo_profil_compte);
            }

            if (updates.length === 0) {
                await client.query('COMMIT');
                return res.json({ success: true, message: 'Aucune modification', data: current });
            }

            updates.push(`date_mise_a_jour = NOW()`);
            params.push(id);

            const updateQuery = `
                UPDATE COMPTES 
                SET ${updates.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING id, email, nom_utilisateur_compte, numero_de_telephone, compte_role, statut
            `;

            const result = await client.query(updateQuery, params);

            await AuditService.log({
                action: 'ADMIN_UPDATE_USER',
                ressource_type: 'COMPTES',
                ressource_id: id,
                donnees_avant: current,
                donnees_apres: result.rows[0],
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Utilisateur mis à jour avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Changer le mot de passe d'un utilisateur
     * @route POST /api/v1/admin/users/:id/change-password
     */
    async changeUserPassword(req, res, next) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { nouveau_mot_de_passe } = req.body;

            if (!nouveau_mot_de_passe || nouveau_mot_de_passe.length < 8) {
                throw new ValidationError('Le mot de passe doit contenir au moins 8 caractères');
            }

            const user = await client.query(
                'SELECT id, nom_utilisateur_compte, numero_de_telephone FROM COMPTES WHERE id = $1 AND est_supprime = false',
                [id]
            );

            if (user.rows.length === 0) {
                throw new NotFoundError('Utilisateur non trouvé');
            }

            const hashedPassword = await bcrypt.hash(nouveau_mot_de_passe, 10);

            await client.query(
                `UPDATE COMPTES 
                 SET mot_de_passe_compte = $1, date_mise_a_jour = NOW()
                 WHERE id = $2`,
                [hashedPassword, id]
            );

            // Invalider toutes les sessions
            await client.query(
                `UPDATE SESSIONS 
                 SET est_active = false, date_revocation = NOW(), motif_revocation = 'PASSWORD_CHANGED_BY_ADMIN'
                 WHERE compte_id = $1 AND est_active = true`,
                [id]
            );

            await AuditService.log({
                action: 'ADMIN_CHANGE_PASSWORD',
                ressource_type: 'COMPTES',
                ressource_id: id,
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            // Notifier l'utilisateur
            await SmsService.sendSms(user.rows[0].numero_de_telephone, 
                'Votre mot de passe a été modifié par un administrateur.');

            res.json({
                success: true,
                message: 'Mot de passe modifié avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ==================== GESTION DES RÔLES ====================

    /**
     * Changer le rôle d'un utilisateur
     * @route POST /api/v1/admin/users/:id/change-role
     */
    async changeUserRole(req, res, next) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { nouveau_role } = req.body;

            const validRoles = [
                'ADMINISTRATEUR_PLATEFORME', 'BLOGUEUR_PLATEFORME', 'STAFF_PLATEFORME',
                'ADMINISTRATEUR_COMPAGNIE', 'STAFF_COMPAGNIE', 'BLOGUEUR_COMPAGNIE',
                'ADMINISTRATEUR_RESTAURANT_FAST_FOOD', 'STAFF_RESTAURANT_FAST_FOOD',
                'UTILISATEUR_PRIVE_SIMPLE', 'UTILISATEUR_VENDEUR'
            ];

            if (!validRoles.includes(nouveau_role)) {
                throw new ValidationError('Rôle invalide');
            }

            const user = await client.query(
                'SELECT id, compte_role FROM COMPTES WHERE id = $1 AND est_supprime = false',
                [id]
            );

            if (user.rows.length === 0) {
                throw new NotFoundError('Utilisateur non trouvé');
            }

            const ancien_role = user.rows[0].compte_role;

            await client.query(
                `UPDATE COMPTES 
                 SET compte_role = $1, date_mise_a_jour = NOW()
                 WHERE id = $2`,
                [nouveau_role, id]
            );

            await AuditService.log({
                action: 'CHANGE_USER_ROLE',
                ressource_type: 'COMPTES',
                ressource_id: id,
                metadata: { ancien_role, nouveau_role },
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: `Rôle changé de ${ancien_role} à ${nouveau_role}`,
                data: { ancien_role, nouveau_role }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ==================== SANCTIONS ====================

    /**
     * Suspendre un utilisateur
     * @route POST /api/v1/admin/users/:id/suspend
     */
    async suspendUser(req, res, next) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { raison, duree_jours = null } = req.body;

            const user = await client.query(
                'SELECT id, nom_utilisateur_compte, numero_de_telephone, email FROM COMPTES WHERE id = $1 AND est_supprime = false',
                [id]
            );

            if (user.rows.length === 0) {
                throw new NotFoundError('Utilisateur non trouvé');
            }

            const dateVerouillage = duree_jours ? new Date(Date.now() + duree_jours * 24 * 60 * 60 * 1000) : null;

            await client.query(
                `UPDATE COMPTES 
                 SET statut = 'SUSPENDU', 
                     date_verouillage = $1,
                     date_mise_a_jour = NOW()
                 WHERE id = $2`,
                [dateVerouillage, id]
            );

            // Invalider toutes les sessions
            await client.query(
                `UPDATE SESSIONS 
                 SET est_active = false, date_revocation = NOW(), motif_revocation = 'SUSPENDED'
                 WHERE compte_id = $1 AND est_active = true`,
                [id]
            );

            await AuditService.log({
                action: 'SUSPEND_USER',
                ressource_type: 'COMPTES',
                ressource_id: id,
                metadata: { raison, duree_jours },
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            const message = duree_jours 
                ? `Votre compte a été suspendu pour ${duree_jours} jours. Raison: ${raison || 'Non spécifiée'}`
                : `Votre compte a été suspendu. Raison: ${raison || 'Non spécifiée'}`;
            
            await SmsService.sendSms(user.rows[0].numero_de_telephone, message);

            res.json({
                success: true,
                message: 'Utilisateur suspendu avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Activer un utilisateur
     * @route POST /api/v1/admin/users/:id/activate
     */
    async activateUser(req, res, next) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            const user = await client.query(
                'SELECT id FROM COMPTES WHERE id = $1 AND est_supprime = false',
                [id]
            );

            if (user.rows.length === 0) {
                throw new NotFoundError('Utilisateur non trouvé');
            }

            await client.query(
                `UPDATE COMPTES 
                 SET statut = 'EST_AUTHENTIFIE', 
                     date_verouillage = NULL,
                     tentatives_echec_connexion = 0,
                     date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [id]
            );

            await AuditService.log({
                action: 'ACTIVATE_USER',
                ressource_type: 'COMPTES',
                ressource_id: id,
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Utilisateur activé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Bannir un utilisateur
     * @route POST /api/v1/admin/users/:id/ban
     */
    async banUser(req, res, next) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { raison } = req.body;

            const user = await client.query(
                'SELECT id, nom_utilisateur_compte, numero_de_telephone, email FROM COMPTES WHERE id = $1 AND est_supprime = false',
                [id]
            );

            if (user.rows.length === 0) {
                throw new NotFoundError('Utilisateur non trouvé');
            }

            await client.query(
                `UPDATE COMPTES 
                 SET statut = 'BANNI', 
                     date_verouillage = NULL,
                     date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [id]
            );

            // Invalider toutes les sessions
            await client.query(
                `UPDATE SESSIONS 
                 SET est_active = false, date_revocation = NOW(), motif_revocation = 'BANNED'
                 WHERE compte_id = $1 AND est_active = true`,
                [id]
            );

            await AuditService.log({
                action: 'BAN_USER',
                ressource_type: 'COMPTES',
                ressource_id: id,
                metadata: { raison },
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Utilisateur banni avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ==================== SUPPRESSION ====================

    /**
     * Supprimer un utilisateur (soft delete)
     * @route DELETE /api/v1/admin/users/:id
     */
    async deleteUser(req, res, next) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { raison } = req.body;

            const user = await client.query(
                'SELECT * FROM COMPTES WHERE id = $1',
                [id]
            );

            if (user.rows.length === 0) {
                throw new NotFoundError('Utilisateur non trouvé');
            }

            await client.query(
                `UPDATE COMPTES 
                 SET est_supprime = true, 
                     date_suppression = NOW(),
                     statut = 'SUSPENDU',
                     date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [id]
            );

            // Invalider toutes les sessions
            await client.query(
                `UPDATE SESSIONS 
                 SET est_active = false, date_revocation = NOW(), motif_revocation = 'ACCOUNT_DELETED_BY_ADMIN'
                 WHERE compte_id = $1 AND est_active = true`,
                [id]
            );

            await AuditService.log({
                action: 'ADMIN_DELETE_USER',
                ressource_type: 'COMPTES',
                ressource_id: id,
                donnees_avant: user.rows[0],
                metadata: { raison },
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Utilisateur supprimé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Restaurer un utilisateur supprimé
     * @route POST /api/v1/admin/users/:id/restore
     */
    async restoreUser(req, res, next) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            const user = await client.query(
                'SELECT * FROM COMPTES WHERE id = $1 AND est_supprime = true',
                [id]
            );

            if (user.rows.length === 0) {
                throw new NotFoundError('Utilisateur non trouvé ou non supprimé');
            }

            await client.query(
                `UPDATE COMPTES 
                 SET est_supprime = false, 
                     date_suppression = NULL,
                     statut = 'NON_AUTHENTIFIE',
                     date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [id]
            );

            await AuditService.log({
                action: 'ADMIN_RESTORE_USER',
                ressource_type: 'COMPTES',
                ressource_id: id,
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Utilisateur restauré avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    // ==================== STATISTIQUES ====================

    /**
     * Obtenir les statistiques détaillées des utilisateurs
     * @route GET /api/v1/admin/users/stats
     */
    async getUserStats(req, res, next) {
        const client = await db.pool.connect();
        try {
            // Statistiques globales
            const globalStats = await client.query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE date_creation >= NOW() - INTERVAL '24 hours') as dernieres_24h,
                    COUNT(*) FILTER (WHERE date_creation >= NOW() - INTERVAL '7 days') as dernieres_7j,
                    COUNT(*) FILTER (WHERE date_creation >= NOW() - INTERVAL '30 days') as dernieres_30j,
                    COUNT(*) FILTER (WHERE date_derniere_connexion >= NOW() - INTERVAL '24 hours') as connectes_24h,
                    COUNT(*) FILTER (WHERE date_derniere_connexion >= NOW() - INTERVAL '7 days') as actifs_7j,
                    COUNT(*) FILTER (WHERE date_derniere_connexion IS NULL) as jamais_connectes
                FROM COMPTES
                WHERE est_supprime = false
            `);

            // Évolution des inscriptions
            const evolution = await client.query(`
                SELECT 
                    DATE(date_creation) as date,
                    COUNT(*) as inscriptions
                FROM COMPTES
                WHERE date_creation >= NOW() - INTERVAL '30 days'
                GROUP BY DATE(date_creation)
                ORDER BY date ASC
            `);

            // Top users par activité
            const topActifs = await client.query(`
                SELECT 
                    c.id,
                    c.nom_utilisateur_compte,
                    c.email,
                    COUNT(DISTINCT m.id) as messages_envoyes,
                    COUNT(DISTINCT a.id) as avis_postes,
                    COUNT(DISTINCT co.id) as commandes_passees
                FROM COMPTES c
                LEFT JOIN MESSAGES m ON m.expediteur_id = c.id AND m.date_suppression IS NULL
                LEFT JOIN AVIS a ON a.auteur_id = c.id
                LEFT JOIN COMMANDESBOUTIQUES co ON co.compte_id = c.id
                WHERE c.est_supprime = false
                GROUP BY c.id, c.nom_utilisateur_compte, c.email
                ORDER BY messages_envoyes DESC
                LIMIT 10
            `);

            res.json({
                success: true,
                data: {
                    global: globalStats.rows[0],
                    evolution: evolution.rows,
                    top_actifs: topActifs.rows
                }
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }
}

module.exports = new UserManagementController();