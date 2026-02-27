// src/routes/middlewares/role.middleware.js
const { AuthorizationError } = require('../../utils/errors/AppError');
const { ROLES_HIERARCHY, PERMISSIONS } = require('../../utils/constants/roles');

class RoleMiddleware {
    /**
     * Vérifier que l'utilisateur a au moins un certain rôle
     */
    isAtLeast(minimumRole) {
        return (req, res, next) => {
            if (!req.user) {
                throw new AuthorizationError('Utilisateur non authentifié');
            }

            const userRole = req.user.compte_role;
            const userLevel = ROLES_HIERARCHY[userRole] || 0;
            const requiredLevel = ROLES_HIERARCHY[minimumRole] || 0;

            if (userLevel < requiredLevel) {
                throw new AuthorizationError(
                    `Rôle insuffisant. Requis: ${minimumRole}, Actuel: ${userRole}`
                );
            }

            next();
        };
    }

    /**
     * Vérifier que l'utilisateur est admin plateforme
     */
    isAdmin() {
        return (req, res, next) => {
            if (!req.user) {
                throw new AuthorizationError('Utilisateur non authentifié');
            }
            const userRole = req.user.compte_role;
            if (userRole !== 'ADMINISTRATEUR_PLATEFORME') {
                throw new AuthorizationError('Rôle ADMINISTRATEUR_PLATEFORME requis');
            }
            next();
        };
    }

    /**
     * Vérifier que l'utilisateur est blogueur
     */
    isBlogger() {
        return (req, res, next) => {
            if (!req.user) {
                throw new AuthorizationError('Utilisateur non authentifié');
            }
            const userRole = req.user.compte_role;
            const bloggerRoles = [
                'BLOGUEUR_PLATEFORME',
                'BLOGUEUR_COMPAGNIE',
                'BLOGUEUR_EMBRANCHEMENT_COMPAGNIE',
                'BLOGUEUR_RESTAURANT_FAST_FOOD',
                'BLOGUEUR_BOUTIQUE'
            ];
            if (!bloggerRoles.includes(userRole) && userRole !== 'ADMINISTRATEUR_PLATEFORME') {
                throw new AuthorizationError('Rôle blogueur requis');
            }
            next();
        };
    }

    /**
     * Vérifier que l'utilisateur est gérant (admin d'entité)
     */
    isGerant() {
        return (req, res, next) => {
            if (!req.user) {
                throw new AuthorizationError('Utilisateur non authentifié');
            }
            const userRole = req.user.compte_role;
            const gerantRoles = [
                'ADMINISTRATEUR_COMPAGNIE',
                'ADMINISTRATEUR_EMBRANCHEMENT_COMPAGNIE',
                'ADMINISTRATEUR_RESTAURANT_FAST_FOOD',
                'ADMINISTRATEUR_BOUTIQUE',
                'ADMINISTRATEUR_PLATEFORME'
            ];
            if (!gerantRoles.includes(userRole)) {
                throw new AuthorizationError('Rôle gérant requis');
            }
            next();
        };
    }

    /**
     * Vérifier que l'utilisateur est agent (staff)
     */
    isAgent() {
        return (req, res, next) => {
            if (!req.user) {
                throw new AuthorizationError('Utilisateur non authentifié');
            }
            const userRole = req.user.compte_role;
            const agentRoles = [
                'STAFF_PLATEFORME',
                'STAFF_COMPAGNIE',
                'STAFF_EMBRANCHEMENT_COMPAGNIE',
                'STAFF_RESTAURANT_FAST_FOOD',
                'STAFF_BOUTIQUE',
                'LIVREUR'
            ];
            if (!agentRoles.includes(userRole) && userRole !== 'ADMINISTRATEUR_PLATEFORME') {
                throw new AuthorizationError('Rôle agent requis');
            }
            next();
        };
    }

    /**
     * Vérifier que l'utilisateur est modérateur
     */
    isModerator() {
        return (req, res, next) => {
            if (!req.user) {
                throw new AuthorizationError('Utilisateur non authentifié');
            }
            const userRole = req.user.compte_role;
            const moderatorRoles = [
                'MODERATEUR',
                'STAFF_PLATEFORME',
                'ADMINISTRATEUR_PLATEFORME'
            ];
            if (!moderatorRoles.includes(userRole)) {
                throw new AuthorizationError('Rôle modérateur requis');
            }
            next();
        };
    }

    /**
     * Vérifier que l'utilisateur est livreur
     */
    isLivreur() {
        return (req, res, next) => {
            if (!req.user) {
                throw new AuthorizationError('Utilisateur non authentifié');
            }
            const userRole = req.user.compte_role;
            if (userRole !== 'LIVREUR' && userRole !== 'ADMINISTRATEUR_PLATEFORME') {
                throw new AuthorizationError('Rôle livreur requis');
            }
            next();
        };
    }

    /**
     * Vérifier que l'utilisateur est vendeur
     */
    isVendeur() {
        return (req, res, next) => {
            if (!req.user) {
                throw new AuthorizationError('Utilisateur non authentifié');
            }
            const userRole = req.user.compte_role;
            if (userRole !== 'UTILISATEUR_VENDEUR' && userRole !== 'ADMINISTRATEUR_PLATEFORME') {
                throw new AuthorizationError('Rôle vendeur requis');
            }
            next();
        };
    }

    /**
     * Vérifier que l'utilisateur a exactement un rôle spécifique
     */
    isExactly(role) {
        return (req, res, next) => {
            if (!req.user) {
                throw new AuthorizationError('Utilisateur non authentifié');
            }

            if (req.user.compte_role !== role) {
                throw new AuthorizationError(`Rôle ${role} requis`);
            }

            next();
        };
    }

    /**
     * Vérifier que l'utilisateur a une permission spécifique
     */
    hasPermission(permission) {
        return (req, res, next) => {
            if (!req.user) {
                throw new AuthorizationError('Utilisateur non authentifié');
            }

            const userPermissions = PERMISSIONS[req.user.compte_role] || [];

            if (!userPermissions.includes(permission) && !userPermissions.includes('*')) {
                throw new AuthorizationError(`Permission ${permission} requise`);
            }

            next();
        };
    }

    /**
     * Vérifier que l'utilisateur est le propriétaire de la ressource ou admin
     */
    isOwnerOrAdmin(getResourceUserId) {
        return async (req, res, next) => {
            try {
                if (!req.user) {
                    throw new AuthorizationError('Utilisateur non authentifié');
                }

                // Les admins peuvent tout faire
                if (['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role)) {
                    return next();
                }

                const resourceUserId = await getResourceUserId(req);
                
                if (resourceUserId !== req.user.id) {
                    throw new AuthorizationError('Vous n\'êtes pas le propriétaire de cette ressource');
                }

                next();
            } catch (error) {
                next(error);
            }
        };
    }

    /**
     * Vérifier que l'utilisateur a accès à une entité spécifique
     */
    hasAccessToEntity(entityType) {
        return async (req, res, next) => {
            try {
                if (!req.user) {
                    throw new AuthorizationError('Utilisateur non authentifié');
                }

                const entityId = req.params.id;

                switch (entityType) {
                    case 'compagnie':
                        if (req.user.compagnie_id !== parseInt(entityId) && 
                            !['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role)) {
                            throw new AuthorizationError('Accès non autorisé à cette compagnie');
                        }
                        break;

                    case 'restaurant':
                        if (req.user.restaurant_id !== parseInt(entityId) &&
                            !['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role)) {
                            throw new AuthorizationError('Accès non autorisé à ce restaurant');
                        }
                        break;

                    case 'boutique':
                        if (req.user.boutique_id !== parseInt(entityId) &&
                            !['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(req.user.compte_role)) {
                            throw new AuthorizationError('Accès non autorisé à cette boutique');
                        }
                        break;

                    default:
                        throw new AuthorizationError('Type d\'entité non supporté');
                }

                next();
            } catch (error) {
                next(error);
            }
        };
    }

    /**
     * Middleware combiné pour plusieurs rôles
     */
    anyOf(roles) {
        return (req, res, next) => {
            if (!req.user) {
                throw new AuthorizationError('Utilisateur non authentifié');
            }

            if (!roles.includes(req.user.compte_role)) {
                throw new AuthorizationError(`Rôles autorisés: ${roles.join(', ')}`);
            }

            next();
        };
    }

    /**
     * Vérifier que l'utilisateur est un administrateur de la plateforme
     */
    isPlatformAdmin() {
        return this.isAtLeast('ADMINISTRATEUR_PLATEFORME');
    }

    /**
     * Vérifier que l'utilisateur est un staff (plateforme ou compagnie)
     */
    isStaff() {
        return (req, res, next) => {
            if (!req.user) {
                throw new AuthorizationError('Utilisateur non authentifié');
            }

            const staffRoles = [
                'ADMINISTRATEUR_PLATEFORME',
                'STAFF_PLATEFORME',
                'ADMINISTRATEUR_COMPAGNIE',
                'STAFF_COMPAGNIE',
                'ADMINISTRATEUR_EMBRANCHEMENT_COMPAGNIE',
                'STAFF_EMBRANCHEMENT_COMPAGNIE',
                'ADMINISTRATEUR_RESTAURANT_FAST_FOOD',
                'STAFF_RESTAURANT_FAST_FOOD',
                'ADMINISTRATEUR_BOUTIQUE',
                'STAFF_BOUTIQUE'
            ];

            if (!staffRoles.includes(req.user.compte_role)) {
                throw new AuthorizationError('Accès réservé au staff');
            }

            next();
        };
    }

    /**
     * Vérifier que l'utilisateur est propriétaire de la boutique
     */
    isBoutiqueOwner() {
        return async (req, res, next) => {
            try {
                if (!req.user) {
                    throw new AuthorizationError('Utilisateur non authentifié');
                }

                // Admin peut tout faire
                if (req.user.compte_role === 'ADMINISTRATEUR_PLATEFORME') {
                    return next();
                }

                const boutiqueId = req.params.boutiqueId || req.params.id;
                
                const db = require('../../configuration/database');
                const result = await db.query(
                    'SELECT proprietaire_id FROM BOUTIQUES WHERE id = $1',
                    [boutiqueId]
                );

                if (result.rows.length === 0) {
                    throw new AuthorizationError('Boutique non trouvée');
                }

                if (result.rows[0].proprietaire_id !== req.user.id) {
                    throw new AuthorizationError('Vous n\'êtes pas propriétaire de cette boutique');
                }

                next();
            } catch (error) {
                next(error);
            }
        };
    }

    /**
     * Vérifier que l'utilisateur est staff de boutique
     */
    isBoutiqueStaff() {
        return async (req, res, next) => {
            try {
                if (!req.user) {
                    throw new AuthorizationError('Utilisateur non authentifié');
                }

                // Admin peut tout faire
                if (req.user.compte_role === 'ADMINISTRATEUR_PLATEFORME') {
                    return next();
                }

                // Vérifier si l'utilisateur a un rôle de staff boutique
                const staffRoles = [
                    'ADMINISTRATEUR_BOUTIQUE',
                    'STAFF_BOUTIQUE'
                ];

                if (!staffRoles.includes(req.user.compte_role)) {
                    throw new AuthorizationError('Accès réservé au personnel de boutique');
                }

                // Si on a un ID de boutique dans les params, vérifier que l'utilisateur y est associé
                const boutiqueId = req.params.boutiqueId || req.params.id;
                
                if (boutiqueId) {
                    const db = require('../../configuration/database');
                    const result = await db.query(
                        'SELECT id FROM BOUTIQUES WHERE id = $1 AND (proprietaire_id = $2 OR id IN (SELECT boutique_id FROM COMPTES WHERE id = $2 AND boutique_id IS NOT NULL))',
                        [boutiqueId, req.user.id]
                    );

                    if (result.rows.length === 0) {
                        throw new AuthorizationError('Vous n\'êtes pas autorisé à accéder à cette boutique');
                    }
                }

                next();
            } catch (error) {
                next(error);
            }
        };
    }
    /*
    * Vérifier que l'utilisateur est admin ou propriétaire de la ressource
    */
    isAdminOrOwner() {
        return async (req, res, next) => {
            try {
                if (!req.user) {
                    throw new AuthorizationError('Utilisateur non authentifié');
                }

                // Admin peut tout faire
                if (req.user.compte_role === 'ADMINISTRATEUR_PLATEFORME') {
                    return next();
                }

                // Récupérer l'ID de la ressource (à adapter selon le contexte)
                const resourceUserId = req.params.userId || req.params.id;
                
                if (!resourceUserId) {
                    throw new AuthorizationError('ID de ressource non trouvé');
                }

                // Vérifier si l'utilisateur est le propriétaire
                if (parseInt(resourceUserId) !== req.user.id) {
                    throw new AuthorizationError('Vous n\'êtes pas autorisé à accéder à cette ressource');
                }

                next();
            } catch (error) {
                next(error);
            }
        };
    }
}

module.exports = new RoleMiddleware();