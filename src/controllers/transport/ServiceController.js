// src/controllers/transport/ServiceTransportController.js
const db = require('../../configuration/database');
const { AppError, ValidationError, NotFoundError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');

class ServiceTransportController {
    /**
     * Récupérer tous les services de transport
     * @route GET /api/v1/transport/services
     */
    static async getAll(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                actif,
                type_service,
                compagnie_id,
                emplacement_id,
                search
            } = req.query;

            const offset = (parseInt(page) - 1) * parseInt(limit);

            let query = `
                SELECT 
                    s.id,
                    s.nom_service,
                    s.type_service,
                    s.donnees_json_service,
                    s.prix_service,
                    s.duree_validite_jours,
                    s.actif,
                    s.date_creation,
                    s.date_mise_a_jour,
                    c.id as compagnie_id,
                    c.nom_compagnie,
                    c.logo_compagnie,
                    e.id as emplacement_id,
                    e.nom_emplacement,
                    COUNT(*) OVER() as total_count
                FROM SERVICES s
                JOIN COMPAGNIESTRANSPORT c ON c.id = s.compagnie_id
                LEFT JOIN EMPLACEMENTSTRANSPORT e ON e.id = s.emplacement_id
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            if (actif !== undefined) {
                query += ` AND s.actif = $${paramIndex}`;
                params.push(actif === 'true');
                paramIndex++;
            }

            if (type_service) {
                query += ` AND s.type_service = $${paramIndex}`;
                params.push(type_service);
                paramIndex++;
            }

            if (compagnie_id) {
                query += ` AND s.compagnie_id = $${paramIndex}`;
                params.push(parseInt(compagnie_id));
                paramIndex++;
            }

            if (emplacement_id) {
                query += ` AND s.emplacement_id = $${paramIndex}`;
                params.push(parseInt(emplacement_id));
                paramIndex++;
            }

            if (search) {
                query += ` AND s.nom_service ILIKE $${paramIndex}`;
                params.push(`%${search}%`);
                paramIndex++;
            }

            query += ` ORDER BY s.nom_service ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / parseInt(limit))
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer un service par son ID
     * @route GET /api/v1/transport/services/:id
     */
    static async getById(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT 
                    s.*,
                    c.id as compagnie_id,
                    c.nom_compagnie,
                    c.logo_compagnie,
                    e.id as emplacement_id,
                    e.nom_emplacement,
                    (
                        SELECT COUNT(*) 
                        FROM ACHATSSERVICESPRIVE asp 
                        WHERE asp.service_id = s.id
                    ) as nombre_acheteurs,
                    (
                        SELECT COUNT(*) 
                        FROM DEMANDESERVICE ds 
                        WHERE ds.service_id = s.id
                    ) as nombre_demandes
                FROM SERVICES s
                JOIN COMPAGNIESTRANSPORT c ON c.id = s.compagnie_id
                LEFT JOIN EMPLACEMENTSTRANSPORT e ON e.id = s.emplacement_id
                WHERE s.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Service de transport non trouvé');
            }

            res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Créer un nouveau service de transport
     * @route POST /api/v1/transport/services
     */
    static async create(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            const {
                nom_service,
                type_service,
                donnees_json_service,
                prix_service,
                duree_validite_jours,
                compagnie_id,
                emplacement_id
            } = req.body;

            // Validation
            if (!nom_service) {
                throw new ValidationError('Le nom du service est requis');
            }
            if (!type_service) {
                throw new ValidationError('Le type de service est requis');
            }
            if (!compagnie_id) {
                throw new ValidationError('La compagnie est requise');
            }
            if (prix_service === undefined || prix_service < 0) {
                throw new ValidationError('Le prix du service est requis et doit être positif');
            }

            // Vérifier que la compagnie existe
            const compagnieCheck = await client.query(
                `SELECT id FROM COMPAGNIESTRANSPORT WHERE id = $1 AND est_actif = true`,
                [compagnie_id]
            );
            if (compagnieCheck.rows.length === 0) {
                throw new ValidationError('Compagnie non trouvée ou inactive');
            }

            // Vérifier l'emplacement si fourni
            if (emplacement_id) {
                const emplacementCheck = await client.query(
                    `SELECT id FROM EMPLACEMENTSTRANSPORT WHERE id = $1 AND est_actif = true`,
                    [emplacement_id]
                );
                if (emplacementCheck.rows.length === 0) {
                    throw new ValidationError('Emplacement non trouvé ou inactif');
                }
            }

            const result = await client.query(
                `INSERT INTO SERVICES (
                    nom_service,
                    type_service,
                    donnees_json_service,
                    prix_service,
                    duree_validite_jours,
                    actif,
                    compagnie_id,
                    emplacement_id
                ) VALUES ($1, $2, $3, $4, $5, true, $6, $7)
                RETURNING *`,
                [
                    nom_service,
                    type_service,
                    donnees_json_service || '{}',
                    prix_service,
                    duree_validite_jours,
                    compagnie_id,
                    emplacement_id || null
                ]
            );

            const newService = result.rows[0];

            // Journaliser l'action
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'SERVICES',
                ressource_id: newService.id,
                donnees_apres: newService,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Service de transport créé avec succès',
                data: newService
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour un service de transport
     * @route PUT /api/v1/transport/services/:id
     */
    static async update(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const {
                nom_service,
                type_service,
                donnees_json_service,
                prix_service,
                duree_validite_jours,
                actif,
                compagnie_id,
                emplacement_id
            } = req.body;

            // Récupérer l'état actuel
            const currentResult = await client.query(
                `SELECT * FROM SERVICES WHERE id = $1`,
                [id]
            );

            if (currentResult.rows.length === 0) {
                throw new NotFoundError('Service de transport non trouvé');
            }

            const current = currentResult.rows[0];

            // Vérifier la compagnie si modifiée
            if (compagnie_id && compagnie_id !== current.compagnie_id) {
                const compagnieCheck = await client.query(
                    `SELECT id FROM COMPAGNIESTRANSPORT WHERE id = $1 AND est_actif = true`,
                    [compagnie_id]
                );
                if (compagnieCheck.rows.length === 0) {
                    throw new ValidationError('Compagnie non trouvée ou inactive');
                }
            }

            // Vérifier l'emplacement si modifié
            if (emplacement_id !== undefined && emplacement_id !== current.emplacement_id) {
                if (emplacement_id) {
                    const emplacementCheck = await client.query(
                        `SELECT id FROM EMPLACEMENTSTRANSPORT WHERE id = $1 AND est_actif = true`,
                        [emplacement_id]
                    );
                    if (emplacementCheck.rows.length === 0) {
                        throw new ValidationError('Emplacement non trouvé ou inactif');
                    }
                }
            }

            // Construire la requête de mise à jour
            const updates = [];
            const params = [];
            let paramIndex = 1;

            if (nom_service !== undefined) {
                updates.push(`nom_service = $${paramIndex++}`);
                params.push(nom_service);
            }
            if (type_service !== undefined) {
                updates.push(`type_service = $${paramIndex++}`);
                params.push(type_service);
            }
            if (donnees_json_service !== undefined) {
                updates.push(`donnees_json_service = $${paramIndex++}`);
                params.push(donnees_json_service);
            }
            if (prix_service !== undefined) {
                updates.push(`prix_service = $${paramIndex++}`);
                params.push(prix_service);
            }
            if (duree_validite_jours !== undefined) {
                updates.push(`duree_validite_jours = $${paramIndex++}`);
                params.push(duree_validite_jours);
            }
            if (actif !== undefined) {
                updates.push(`actif = $${paramIndex++}`);
                params.push(actif);
            }
            if (compagnie_id !== undefined) {
                updates.push(`compagnie_id = $${paramIndex++}`);
                params.push(compagnie_id);
            }
            if (emplacement_id !== undefined) {
                updates.push(`emplacement_id = $${paramIndex++}`);
                params.push(emplacement_id);
            }

            if (updates.length === 0) {
                return res.json({
                    success: true,
                    message: 'Aucune modification',
                    data: current
                });
            }

            updates.push(`date_mise_a_jour = NOW()`);
            params.push(id);

            const updateQuery = `
                UPDATE SERVICES 
                SET ${updates.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING *
            `;

            const result = await client.query(updateQuery, params);
            const updated = result.rows[0];

            // Journaliser l'action
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'SERVICES',
                ressource_id: id,
                donnees_avant: current,
                donnees_apres: updated,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Service de transport mis à jour avec succès',
                data: updated
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer (désactiver) un service de transport
     * @route DELETE /api/v1/transport/services/:id
     */
    static async delete(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            // Vérifier les dépendances
            const dependencies = await client.query(
                `SELECT 
                    (SELECT COUNT(*) FROM ACHATSSERVICESPRIVE WHERE service_id = $1) as achats,
                    (SELECT COUNT(*) FROM DEMANDESERVICE WHERE service_id = $1) as demandes`,
                [id]
            );

            const deps = dependencies.rows[0];

            if (parseInt(deps.achats) > 0 || parseInt(deps.demandes) > 0) {
                // Soft delete : désactiver seulement
                await client.query(
                    `UPDATE SERVICES 
                     SET actif = false, date_mise_a_jour = NOW()
                     WHERE id = $1`,
                    [id]
                );
                
                await client.query('COMMIT');
                
                return res.json({
                    success: true,
                    message: 'Service désactivé avec succès (des achats existent)'
                });
            }

            // Récupérer l'état actuel
            const currentResult = await client.query(
                `SELECT * FROM SERVICES WHERE id = $1`,
                [id]
            );

            if (currentResult.rows.length === 0) {
                throw new NotFoundError('Service de transport non trouvé');
            }

            // Suppression physique
            await client.query(`DELETE FROM SERVICES WHERE id = $1`, [id]);

            // Journaliser l'action
            await AuditService.log({
                action: 'DELETE',
                ressource_type: 'SERVICES',
                ressource_id: id,
                donnees_avant: currentResult.rows[0],
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Service de transport supprimé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les services disponibles pour un emplacement
     * @route GET /api/v1/transport/emplacements/:emplacementId/services
     */
    static async getServicesByEmplacement(req, res, next) {
        try {
            const { emplacementId } = req.params;
            const { actif = 'true' } = req.query;

            const result = await db.query(
                `SELECT 
                    s.id,
                    s.nom_service,
                    s.type_service,
                    s.donnees_json_service,
                    s.prix_service,
                    s.duree_validite_jours,
                    s.actif,
                    c.nom_compagnie,
                    c.logo_compagnie
                FROM SERVICES s
                JOIN COMPAGNIESTRANSPORT c ON c.id = s.compagnie_id
                WHERE s.emplacement_id = $1
                  AND s.actif = $2
                ORDER BY s.prix_service ASC`,
                [emplacementId, actif === 'true']
            );

            res.json({
                success: true,
                data: result.rows,
                count: result.rows.length
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les services par type
     * @route GET /api/v1/transport/services/type/:type
     */
    static async getByType(req, res, next) {
        try {
            const { type } = req.params;
            const { actif = 'true' } = req.query;

            const validTypes = ['ABONNEMENT_MENSUEL', 'BIMENSUEL', 'TRIMESTRIEL', 'ANNUEL'];
            if (!validTypes.includes(type)) {
                throw new ValidationError(`Type invalide. Types valides: ${validTypes.join(', ')}`);
            }

            const result = await db.query(
                `SELECT 
                    s.*,
                    c.nom_compagnie,
                    c.logo_compagnie,
                    e.nom_emplacement
                FROM SERVICES s
                JOIN COMPAGNIESTRANSPORT c ON c.id = s.compagnie_id
                LEFT JOIN EMPLACEMENTSTRANSPORT e ON e.id = s.emplacement_id
                WHERE s.type_service = $1
                  AND s.actif = $2
                ORDER BY s.prix_service ASC`,
                [type, actif === 'true']
            );

            res.json({
                success: true,
                data: result.rows,
                type,
                count: result.rows.length
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Statistiques des services
     * @route GET /api/v1/transport/services/stats/globales
     */
    static async getStats(req, res, next) {
        try {
            const stats = await db.query(
                `SELECT 
                    COUNT(*) as total_services,
                    COUNT(*) FILTER (WHERE actif = true) as services_actifs,
                    COUNT(*) FILTER (WHERE actif = false) as services_inactifs,
                    COUNT(DISTINCT type_service) as types_disponibles,
                    ROUND(AVG(prix_service)::numeric, 2) as prix_moyen,
                    MIN(prix_service) as prix_min,
                    MAX(prix_service) as prix_max,
                    json_agg(DISTINCT type_service) as liste_types
                FROM SERVICES`
            );

            // Statistiques par type
            const parType = await db.query(
                `SELECT 
                    type_service,
                    COUNT(*) as nombre,
                    ROUND(AVG(prix_service)::numeric, 2) as prix_moyen,
                    MIN(prix_service) as prix_min,
                    MAX(prix_service) as prix_max
                FROM SERVICES
                GROUP BY type_service
                ORDER BY type_service`
            );

            // Top services les plus achetés
            const topServices = await db.query(
                `SELECT 
                    s.id,
                    s.nom_service,
                    s.type_service,
                    s.prix_service,
                    COUNT(asp.id) as nombre_achats
                FROM SERVICES s
                LEFT JOIN ACHATSSERVICESPRIVE asp ON asp.service_id = s.id
                GROUP BY s.id, s.nom_service, s.type_service, s.prix_service
                ORDER BY nombre_achats DESC
                LIMIT 10`
            );

            res.json({
                success: true,
                data: {
                    global: stats.rows[0],
                    par_type: parType.rows,
                    top_services: topServices.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Acheter un service de transport
     * @route POST /api/v1/transport/services/:id/acheter
     */
    static async acheter(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const userId = req.user?.id;
            const { info_acheteur } = req.body;

            if (!userId) {
                throw new ValidationError('Utilisateur non authentifié');
            }

            // Récupérer le service
            const serviceResult = await client.query(
                `SELECT * FROM SERVICES WHERE id = $1 AND actif = true`,
                [id]
            );

            if (serviceResult.rows.length === 0) {
                throw new NotFoundError('Service non trouvé ou indisponible');
            }

            const service = serviceResult.rows[0];

            // Calculer la date d'expiration
            let dateExpiration = null;
            if (service.duree_validite_jours) {
                dateExpiration = new Date();
                dateExpiration.setDate(dateExpiration.getDate() + service.duree_validite_jours);
            }

            // Enregistrer l'achat
            const result = await client.query(
                `INSERT INTO ACHATSSERVICESPRIVE (
                    service_id,
                    compte_id,
                    prix_achat_service,
                    date_expiration,
                    est_actif,
                    info_acheteur
                ) VALUES ($1, $2, $3, $4, true, $5)
                RETURNING *`,
                [id, userId, service.prix_service, dateExpiration, info_acheteur || '{}']
            );

            // Créer une entrée dans les transactions
            await client.query(
                `INSERT INTO HISTORIQUE_TRANSACTIONS (
                    type_transaction,
                    montant,
                    statut_transaction,
                    compte_source_id,
                    service_id,
                    description,
                    date_transaction
                ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                ['ACHAT', service.prix_service, 'COMPLETEE', userId, id, `Achat service: ${service.nom_service}`]
            );

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Service acheté avec succès',
                data: {
                    achat: result.rows[0],
                    service: {
                        id: service.id,
                        nom: service.nom_service,
                        type: service.type_service,
                        prix: service.prix_service,
                        validite_jours: service.duree_validite_jours,
                        date_expiration: dateExpiration
                    }
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
     * Récupérer les achats de l'utilisateur
     * @route GET /api/v1/transport/services/mes-achats
     */
    static async getMesAchats(req, res, next) {
        try {
            const userId = req.user?.id;

            if (!userId) {
                throw new ValidationError('Utilisateur non authentifié');
            }

            const { page = 1, limit = 20, est_actif } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            let query = `
                SELECT 
                    asp.id,
                    asp.prix_achat_service,
                    asp.date_achat_service,
                    asp.date_expiration,
                    asp.est_actif,
                    asp.info_acheteur,
                    s.id as service_id,
                    s.nom_service,
                    s.type_service,
                    s.duree_validite_jours,
                    c.nom_compagnie,
                    c.logo_compagnie,
                    COUNT(*) OVER() as total_count
                FROM ACHATSSERVICESPRIVE asp
                JOIN SERVICES s ON s.id = asp.service_id
                JOIN COMPAGNIESTRANSPORT c ON c.id = s.compagnie_id
                WHERE asp.compte_id = $1
            `;

            const params = [userId];
            let paramIndex = 2;

            if (est_actif !== undefined) {
                query += ` AND asp.est_actif = $${paramIndex}`;
                params.push(est_actif === 'true');
                paramIndex++;
            }

            query += ` ORDER BY asp.date_achat_service DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Vérifier et mettre à jour les expirations
            const now = new Date();
            for (const achat of result.rows) {
                if (achat.est_actif && achat.date_expiration && new Date(achat.date_expiration) < now) {
                    await db.query(
                        `UPDATE ACHATSSERVICESPRIVE SET est_actif = false WHERE id = $1`,
                        [achat.id]
                    );
                    achat.est_actif = false;
                }
            }

            res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / parseInt(limit))
                }
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new ServiceTransportController();