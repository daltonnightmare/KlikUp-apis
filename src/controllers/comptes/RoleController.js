// src/controllers/comptes/RoleController.js
const pool = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const CacheService = require('../../services/cache/CacheService');
const { logInfo, logError } = require('../../configuration/logger');
const { COMPTE_ROLE } = require('../../utils/constants/enums');

class RoleController {
    /**
     * Récupérer tous les rôles disponibles
     * @route GET /api/v1/roles
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getAllRoles(req, res, next) {
        try {
            // Récupérer tous les rôles depuis l'ENUM PostgreSQL
            const result = await pool.query(`
                SELECT unnest(enum_range(NULL::compte_role)) as role
            `);

            const roles = result.rows.map(r => r.role);

            // Récupérer les statistiques par rôle
            const stats = await pool.query(`
                SELECT 
                    compte_role,
                    COUNT(*) as nombre,
                    COUNT(*) FILTER (WHERE statut = 'EST_AUTHENTIFIE') as actifs,
                    COUNT(*) FILTER (WHERE date_creation >= NOW() - INTERVAL '7 days') as nouveaux_7j
                FROM COMPTES
                WHERE est_supprime = false
                GROUP BY compte_role
                ORDER BY compte_role
            `);

            // Description des rôles
            const rolesWithDescription = roles.map(role => ({
                nom: role,
                description: this._getRoleDescription(role),
                permissions: this._getRolePermissions(role),
                niveau: this._getRoleLevel(role),
                statistiques: stats.rows.find(s => s.compte_role === role) || {
                    nombre: 0,
                    actifs: 0,
                    nouveaux_7j: 0
                }
            }));

            res.json({
                status: 'success',
                data: rolesWithDescription,
                total: roles.length
            });

        } catch (error) {
            logError('Erreur récupération rôles:', error);
            next(error);
        }
    }

    /**
     * Récupérer les utilisateurs par rôle
     * @route GET /api/v1/roles/:role/utilisateurs
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getUsersByRole(req, res, next) {
        try {
            const { role } = req.params;
            const {
                page = 1,
                limit = 20,
                statut,
                recherche,
                entite_id
            } = req.query;

            // Vérifier que le rôle existe
            if (!Object.values(COMPTE_ROLE).includes(role)) {
                throw new ValidationError(`Rôle ${role} invalide`);
            }

            const offset = (page - 1) * limit;
            const params = [role];
            let paramIndex = 2;
            const conditions = ['compte_role = $1', 'est_supprime = false'];

            if (statut) {
                conditions.push(`statut = $${paramIndex}`);
                params.push(statut);
                paramIndex++;
            }

            if (recherche) {
                conditions.push(`(
                    nom_utilisateur_compte ILIKE $${paramIndex} OR
                    email ILIKE $${paramIndex} OR
                    numero_de_telephone ILIKE $${paramIndex}
                )`);
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            // Filtre par entité spécifique selon le rôle
            if (entite_id) {
                if (role.includes('COMPAGNIE')) {
                    conditions.push(`compagnie_id = $${paramIndex}`);
                } else if (role.includes('RESTAURANT')) {
                    conditions.push(`restaurant_id = $${paramIndex}`);
                } else if (role.includes('BOUTIQUE')) {
                    conditions.push(`boutique_id = $${paramIndex}`);
                } else {
                    throw new ValidationError('Ce rôle n\'est pas lié à une entité spécifique');
                }
                params.push(entite_id);
                paramIndex++;
            }
 
            const query = `
                SELECT 
                    id,
                    email,
                    nom_utilisateur_compte,
                    numero_de_telephone,
                    photo_profil_compte,
                    statut,
                    compagnie_id,
                    emplacement_id,
                    restaurant_id,
                    boutique_id,
                    date_creation,
                    date_derniere_connexion
                FROM COMPTES
                WHERE ${conditions.join(' AND ')}
                ORDER BY date_creation DESC
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;

            params.push(parseInt(limit), offset);

            const result = await pool.query(query, params);

            // Comptage total
            const countQuery = `
                SELECT COUNT(*) 
                FROM COMPTES
                WHERE ${conditions.join(' AND ')}
            `;
            const countResult = await pool.query(countQuery, params.slice(0, -2));
            const total = parseInt(countResult.rows[0].count);

            res.json({
                status: 'success',
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                },
                meta: {
                    role,
                    description: this._getRoleDescription(role),
                    niveau: this._getRoleLevel(role)
                }
            });

        } catch (error) {
            logError('Erreur récupération utilisateurs par rôle:', error);
            next(error);
        }
    }

    /**
     * Assigner un rôle à un utilisateur
     * @route POST /api/v1/comptes/:userId/assign-role
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async assignRole(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { userId } = req.params;
            const { role, entite_id } = req.body;

            // Vérifier que l'utilisateur existe
            const user = await client.query(
                'SELECT * FROM COMPTES WHERE id = $1 AND est_supprime = false',
                [userId]
            );

            if (user.rows.length === 0) {
                throw new AppError('Utilisateur non trouvé', 404);
            }

            const ancienRole = user.rows[0].compte_role;

            // Valider le rôle
            if (!Object.values(COMPTE_ROLE).includes(role)) {
                throw new ValidationError(`Rôle ${role} invalide`);
            }

            // Vérifier la compatibilité du rôle avec l'entité
            await this._validateRoleEntity(role, entite_id, client);

            // Préparer les champs à mettre à jour selon le rôle
            const updates = {
                compte_role: role,
                date_mise_a_jour: 'NOW()'
            };

            // Réinitialiser les IDs d'entité selon le nouveau rôle
            if (role.includes('COMPAGNIE')) {
                updates.compagnie_id = entite_id || null;
                updates.restaurant_id = null;
                updates.boutique_id = null;
            } else if (role.includes('RESTAURANT')) {
                updates.restaurant_id = entite_id || null;
                updates.compagnie_id = null;
                updates.boutique_id = null;
            } else if (role.includes('BOUTIQUE')) {
                updates.boutique_id = entite_id || null;
                updates.compagnie_id = null;
                updates.restaurant_id = null;
            } else {
                // Rôle plateforme ou utilisateur simple
                updates.compagnie_id = null;
                updates.restaurant_id = null;
                updates.boutique_id = null;
            }

            // Construire la requête de mise à jour
            const setClauses = Object.keys(updates)
                .map((key, index) => `${key} = $${index + 2}`)
                .join(', ');

            const values = [userId, ...Object.values(updates).filter(v => v !== 'NOW()')];

            const query = `
                UPDATE COMPTES 
                SET ${setClauses}, date_mise_a_jour = NOW()
                WHERE id = $1
                RETURNING id, email, nom_utilisateur_compte, compte_role, compagnie_id, restaurant_id, boutique_id
            `;

            const result = await client.query(query, values);
            const userMaj = result.rows[0];

            // Audit
            await AuditService.log({
                action: 'ASSIGN_ROLE',
                ressource_type: 'COMPTE',
                ressource_id: userId,
                donnees_avant: { role: ancienRole },
                donnees_apres: { role, entite_id },
                utilisateur_id: req.user.id,
                adresse_ip: req.ip,
                metadata: { ancien_role: ancienRole, nouveau_role: role }
            });

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.del(`compte:${userId}`);
            await CacheService.delPattern(`roles:${role}:*`);

            logInfo(`Rôle ${role} assigné à l'utilisateur ${userId} par ${req.user.id}`);

            res.json({
                status: 'success',
                data: userMaj,
                message: `Rôle ${role} assigné avec succès`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur assignation rôle:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Retirer un rôle (remettre utilisateur simple)
     * @route POST /api/v1/comptes/:userId/remove-role
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async removeRole(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { userId } = req.params;

            const user = await client.query(
                'SELECT * FROM COMPTES WHERE id = $1 AND est_supprime = false',
                [userId]
            );

            if (user.rows.length === 0) {
                throw new AppError('Utilisateur non trouvé', 404);
            }

            const ancienRole = user.rows[0].compte_role;

            // Mettre en utilisateur simple
            await client.query(
                `UPDATE COMPTES 
                 SET compte_role = 'UTILISATEUR_PRIVE_SIMPLE',
                     compagnie_id = NULL,
                     restaurant_id = NULL,
                     boutique_id = NULL,
                     date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [userId]
            );

            // Audit
            await AuditService.log({
                action: 'REMOVE_ROLE',
                ressource_type: 'COMPTE',
                ressource_id: userId,
                donnees_avant: { role: ancienRole },
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.del(`compte:${userId}`);

            logInfo(`Rôle retiré de l'utilisateur ${userId} par ${req.user.id}`);

            res.json({
                status: 'success',
                message: 'Rôle retiré avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur retrait rôle:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les permissions d'un rôle
     * @route GET /api/v1/roles/:role/permissions
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getRolePermissions(req, res, next) {
        try {
            const { role } = req.params;

            if (!Object.values(COMPTE_ROLE).includes(role)) {
                throw new ValidationError(`Rôle ${role} invalide`);
            }

            const permissions = this._getRolePermissions(role);

            // Récupérer les permissions personnalisées depuis la config
            const customPermissions = await pool.query(
                `SELECT valeur_json FROM CONFIGURATIONS 
                 WHERE entite_type = 'ROLE' AND cle = $1`,
                [`permissions.${role}`]
            );

            const allPermissions = {
                ...permissions,
                ...(customPermissions.rows[0]?.valeur_json || {})
            };

            res.json({
                status: 'success',
                data: allPermissions,
                meta: {
                    role,
                    description: this._getRoleDescription(role),
                    niveau: this._getRoleLevel(role)
                }
            });

        } catch (error) {
            logError('Erreur récupération permissions:', error);
            next(error);
        }
    }

    /**
     * Mettre à jour les permissions d'un rôle
     * @route PUT /api/v1/roles/:role/permissions
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async updateRolePermissions(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { role } = req.params;
            const permissions = req.body;

            if (!Object.values(COMPTE_ROLE).includes(role)) {
                throw new ValidationError(`Rôle ${role} invalide`);
            }

            // Sauvegarder dans les configurations
            await client.query(
                `INSERT INTO CONFIGURATIONS (entite_type, cle, valeur_json, type_valeur, date_mise_a_jour)
                 VALUES ('ROLE', $1, $2, 'JSON', NOW())
                 ON CONFLICT (entite_type, cle) 
                 DO UPDATE SET valeur_json = EXCLUDED.valeur_json, date_mise_a_jour = NOW()`,
                [`permissions.${role}`, JSON.stringify(permissions)]
            );

            // Audit
            await AuditService.log({
                action: 'UPDATE_PERMISSIONS',
                ressource_type: 'ROLE',
                ressource_id: role,
                donnees_apres: permissions,
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`role_permissions:${role}`);

            logInfo(`Permissions du rôle ${role} mises à jour par ${req.user.id}`);

            res.json({
                status: 'success',
                message: 'Permissions mises à jour avec succès',
                data: permissions
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur mise à jour permissions:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Vérifier si un utilisateur a une permission
     * @route GET /api/v1/comptes/:userId/check-permission/:permission
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async checkPermission(req, res, next) {
        try {
            const { userId, permission } = req.params;

            const user = await pool.query(
                'SELECT compte_role FROM COMPTES WHERE id = $1 AND est_supprime = false',
                [userId]
            );

            if (user.rows.length === 0) {
                throw new AppError('Utilisateur non trouvé', 404);
            }

            const role = user.rows[0].compte_role;
            const permissions = this._getRolePermissions(role);

            // Vérifier la permission
            const hasPermission = this._hasPermission(permissions, permission);

            res.json({
                status: 'success',
                data: {
                    user_id: userId,
                    role,
                    permission,
                    has_permission: hasPermission
                }
            });

        } catch (error) {
            logError('Erreur vérification permission:', error);
            next(error);
        }
    }

    /**
     * Récupérer la hiérarchie des rôles
     * @route GET /api/v1/roles/hierarchy
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getRoleHierarchy(req, res, next) {
        try {
            const hierarchy = {
                PLATEFORME: {
                    niveau: 100,
                    roles: [
                        'ADMINISTRATEUR_PLATEFORME',
                        'BLOGUEUR_PLATEFORME',
                        'STAFF_PLATEFORME'
                    ]
                },
                COMPAGNIE: {
                    niveau: 80,
                    roles: [
                        'ADMINISTRATEUR_COMPAGNIE',
                        'ADMINISTRATEUR_EMBRANCHEMENT_COMPAGNIE',
                        'STAFF_COMPAGNIE',
                        'STAFF_EMBRANCHEMENT_COMPAGNIE',
                        'BLOGUEUR_COMPAGNIE',
                        'BLOGUEUR_EMBRANCHEMENT_COMPAGNIE'
                    ]
                },
                RESTAURANT: {
                    niveau: 60,
                    roles: [
                        'ADMINISTRATEUR_RESTAURANT_FAST_FOOD',
                        'STAFF_RESTAURANT_FAST_FOOD',
                        'BLOGUEUR_RESTAURANT_FAST_FOOD'
                    ]
                },
                BOUTIQUE: {
                    niveau: 60,
                    roles: [
                        'ADMINISTRATEUR_BOUTIQUE',
                        'STAFF_BOUTIQUE',
                        'BLOGUEUR_BOUTIQUE'
                    ]
                },
                UTILISATEUR: {
                    niveau: 40,
                    roles: [
                        'UTILISATEUR_VENDEUR',
                        'UTILISATEUR_PRIVE_SIMPLE'
                    ]
                }
            };

            // Compter les utilisateurs par catégorie
            for (const [categorie, data] of Object.entries(hierarchy)) {
                const stats = await pool.query(
                    `SELECT COUNT(*) as total 
                     FROM COMPTES 
                     WHERE compte_role = ANY($1::text[])
                     AND est_supprime = false`,
                    [data.roles]
                );
                data.total_utilisateurs = parseInt(stats.rows[0].total);
            }

            res.json({
                status: 'success',
                data: hierarchy
            });

        } catch (error) {
            logError('Erreur récupération hiérarchie:', error);
            next(error);
        }
    }

    /**
     * Obtenir les statistiques des rôles
     * @route GET /api/v1/roles/stats
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getRolesStats(req, res, next) {
        try {
            const stats = await pool.query(`
                WITH role_stats AS (
                    SELECT 
                        compte_role,
                        COUNT(*) as total,
                        COUNT(*) FILTER (WHERE statut = 'EST_AUTHENTIFIE') as actifs,
                        COUNT(*) FILTER (WHERE date_creation >= NOW() - INTERVAL '7 days') as nouveaux_7j,
                        COUNT(*) FILTER (WHERE date_creation >= NOW() - INTERVAL '30 days') as nouveaux_30j,
                        COUNT(*) FILTER (WHERE compagnie_id IS NOT NULL) as lies_compagnie,
                        COUNT(*) FILTER (WHERE restaurant_id IS NOT NULL) as lies_restaurant,
                        COUNT(*) FILTER (WHERE boutique_id IS NOT NULL) as lies_boutique
                    FROM COMPTES
                    WHERE est_supprime = false
                    GROUP BY compte_role
                ),
                evolution_par_role AS (
                    SELECT 
                        compte_role,
                        DATE(date_creation) as date,
                        COUNT(*) as inscriptions
                    FROM COMPTES
                    WHERE date_creation >= NOW() - INTERVAL '30 days'
                    GROUP BY compte_role, DATE(date_creation)
                )
                SELECT 
                    jsonb_build_object(
                        'roles', json_agg(rs),
                        'evolution', json_agg(epr)
                    ) as stats
                FROM role_stats rs
                LEFT JOIN evolution_par_role epr ON epr.compte_role = rs.compte_role
                GROUP BY rs.compte_role, rs.total, rs.actifs, rs.nouveaux_7j, 
                         rs.nouveaux_30j, rs.lies_compagnie, rs.lies_restaurant, rs.lies_boutique
            `);

            // Statistiques globales
            const global = await pool.query(`
                SELECT 
                    COUNT(*) as total_utilisateurs,
                    COUNT(DISTINCT compte_role) as total_roles,
                    COUNT(*) FILTER (WHERE compagnie_id IS NOT NULL) as utilisateurs_compagnie,
                    COUNT(*) FILTER (WHERE restaurant_id IS NOT NULL) as utilisateurs_restaurant,
                    COUNT(*) FILTER (WHERE boutique_id IS NOT NULL) as utilisateurs_boutique
                FROM COMPTES
                WHERE est_supprime = false
            `);

            res.json({
                status: 'success',
                data: {
                    roles: stats.rows[0]?.stats || [],
                    global: global.rows[0]
                }
            });

        } catch (error) {
            logError('Erreur récupération stats rôles:', error);
            next(error);
        }
    }

    /**
     * Vérifier la disponibilité d'un rôle pour une entité
     * @route GET /api/v1/roles/check-availability
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async checkRoleAvailability(req, res, next) {
        try {
            const { role, entite_type, entite_id } = req.query;

            if (!role || !entite_type || !entite_id) {
                throw new ValidationError('Paramètres manquants');
            }

            let disponible = true;
            let message = 'Rôle disponible';
            let max = null;

            // Vérifier les limites selon le type d'entité
            if (entite_type === 'BOUTIQUE') {
                const stats = await pool.query(
                    `SELECT 
                        COUNT(*) as total,
                        COUNT(*) FILTER (WHERE compte_role LIKE '%ADMINISTRATEUR%') as admins
                     FROM COMPTES
                     WHERE boutique_id = $1 AND est_supprime = false`,
                    [entite_id]
                );

                if (role.includes('ADMINISTRATEUR') && stats.rows[0].admins >= 1) {
                    disponible = false;
                    message = 'Une boutique ne peut avoir qu\'un seul administrateur';
                    max = 1;
                }
            } else if (entite_type === 'RESTAURANT') {
                // Logique similaire pour les restaurants
                const stats = await pool.query(
                    `SELECT COUNT(*) as total
                     FROM COMPTES
                     WHERE restaurant_id = $1 
                     AND compte_role LIKE '%ADMINISTRATEUR%'
                     AND est_supprime = false`,
                    [entite_id]
                );

                if (role.includes('ADMINISTRATEUR') && stats.rows[0].total >= 1) {
                    disponible = false;
                    message = 'Un restaurant ne peut avoir qu\'un seul administrateur';
                    max = 1;
                }
            }

            res.json({
                status: 'success',
                data: {
                    role,
                    entite_type,
                    entite_id,
                    disponible,
                    message,
                    max
                }
            });

        } catch (error) {
            logError('Erreur vérification disponibilité rôle:', error);
            next(error);
        }
    }

    // ==================== MÉTHODES PRIVÉES ====================

    /**
     * Obtenir la description d'un rôle
     */
    _getRoleDescription(role) {
        const descriptions = {
            'ADMINISTRATEUR_PLATEFORME': 'Accès complet à toutes les fonctionnalités de la plateforme',
            'BLOGUEUR_PLATEFORME': 'Peut créer et gérer des articles de blog pour toute la plateforme',
            'STAFF_PLATEFORME': 'Accès limité pour la modération et le support',
            
            'ADMINISTRATEUR_COMPAGNIE': 'Gère une compagnie de transport',
            'STAFF_COMPAGNIE': 'Employé d\'une compagnie de transport',
            'BLOGUEUR_COMPAGNIE': 'Gère le blog d\'une compagnie de transport',
            
            'ADMINISTRATEUR_EMBRANCHEMENT_COMPAGNIE': 'Gère un emplacement spécifique d\'une compagnie',
            'STAFF_EMBRANCHEMENT_COMPAGNIE': 'Employé d\'un emplacement de transport',
            'BLOGUEUR_EMBRANCHEMENT_COMPAGNIE': 'Gère le blog d\'un emplacement',
            
            'ADMINISTRATEUR_RESTAURANT_FAST_FOOD': 'Gère un restaurant fast-food',
            'STAFF_RESTAURANT_FAST_FOOD': 'Employé d\'un restaurant',
            'BLOGUEUR_RESTAURANT_FAST_FOOD': 'Gère le blog d\'un restaurant',
            
            'UTILISATEUR_PRIVE_SIMPLE': 'Utilisateur standard avec accès de base',
            'UTILISATEUR_VENDEUR': 'Peut vendre des produits sur la plateforme'
        };
        return descriptions[role] || 'Description non disponible';
    }

    /**
     * Obtenir le niveau hiérarchique d'un rôle
     */
    _getRoleLevel(role) {
        const levels = {
            'ADMINISTRATEUR_PLATEFORME': 100,
            'BLOGUEUR_PLATEFORME': 90,
            'STAFF_PLATEFORME': 85,
            
            'ADMINISTRATEUR_COMPAGNIE': 80,
            'ADMINISTRATEUR_EMBRANCHEMENT_COMPAGNIE': 75,
            'STAFF_COMPAGNIE': 70,
            'STAFF_EMBRANCHEMENT_COMPAGNIE': 65,
            'BLOGUEUR_COMPAGNIE': 60,
            'BLOGUEUR_EMBRANCHEMENT_COMPAGNIE': 55,
            
            'ADMINISTRATEUR_RESTAURANT_FAST_FOOD': 80,
            'STAFF_RESTAURANT_FAST_FOOD': 70,
            'BLOGUEUR_RESTAURANT_FAST_FOOD': 60,
            
            'UTILISATEUR_VENDEUR': 50,
            'UTILISATEUR_PRIVE_SIMPLE': 40
        };
        return levels[role] || 0;
    }

    /**
     * Obtenir les permissions d'un rôle
     */
    _getRolePermissions(role) {
        // Permissions de base communes à tous
        const basePermissions = {
            'profile:read': true,
            'profile:update': true,
            'notifications:read': true
        };

        const rolePermissions = {
            'ADMINISTRATEUR_PLATEFORME': {
                ...basePermissions,
                'users:manage': true,
                'roles:assign': true,
                'boutiques:manage': true,
                'restaurants:manage': true,
                'transport:manage': true,
                'blog:manage': true,
                'moderation:all': true,
                'config:all': true,
                'system:maintenance': true
            },

            'BLOGUEUR_PLATEFORME': {
                ...basePermissions,
                'blog:create': true,
                'blog:edit': true,
                'blog:publish': true,
                'blog:delete': true
            },

            'STAFF_PLATEFORME': {
                ...basePermissions,
                'moderation:content': true,
                'support:respond': true
            },

            'ADMINISTRATEUR_COMPAGNIE': {
                ...basePermissions,
                'compagnie:manage': true,
                'tickets:manage': true,
                'services:manage': true,
                'staff:manage': true,
                'stats:view': true
            },

            'UTILISATEUR_PRIVE_SIMPLE': {
                ...basePermissions,
                'commandes:create': true,
                'commandes:view': true,
                'avis:create': true,
                'favoris:manage': true
            },

            'UTILISATEUR_VENDEUR': {
                ...basePermissions,
                'produits:manage': true,
                'commandes:view_sales': true,
                'stats:sales': true
            }
        };

        return rolePermissions[role] || basePermissions;
    }

    /**
     * Vérifier la compatibilité rôle/entité
     */
    async _validateRoleEntity(role, entiteId, client) {
        if (role.includes('COMPAGNIE') && !entiteId) {
            throw new ValidationError('Un rôle compagnie nécessite une compagnie_id');
        }

        if (role.includes('RESTAURANT') && !entiteId) {
            throw new ValidationError('Un rôle restaurant nécessite un restaurant_id');
        }

        if (role.includes('BOUTIQUE') && !entiteId) {
            throw new ValidationError('Un rôle boutique nécessite une boutique_id');
        }

        // Vérifier que l'entité existe
        if (entiteId) {
            let table;
            if (role.includes('COMPAGNIE')) table = 'COMPAGNIESTRANSPORT';
            else if (role.includes('RESTAURANT')) table = 'RESTAURANTSFASTFOOD';
            else if (role.includes('BOUTIQUE')) table = 'BOUTIQUES';

            if (table) {
                const entity = await client.query(
                    `SELECT id FROM ${table} WHERE id = $1`,
                    [entiteId]
                );
                if (entity.rows.length === 0) {
                    throw new ValidationError(`Entité ${table} avec ID ${entiteId} non trouvée`);
                }
            }
        }
    }

    /**
     * Vérifier si une permission est accordée
     */
    _hasPermission(permissions, permissionPath) {
        const parts = permissionPath.split(':');
        let current = permissions;

        for (const part of parts) {
            if (current[part] === undefined) {
                return false;
            }
            current = current[part];
        }

        return current === true;
    }
}

module.exports = new RoleController();