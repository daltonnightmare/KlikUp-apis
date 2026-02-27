// src/controllers/livraison/ServiceLivraisonController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');

class ServiceLivraisonController {
    /**
     * Créer un nouveau service de livraison
     * @route POST /api/v1/livraison/services
     */
    async create(req, res, next) {
        try {
            const {
                nom_service,
                type_service,
                description_service,
                prix_service,
                prix_par_km,
                distance_max_km,
                donnees_supplementaires,
                id_entreprise_livraison
            } = req.body;

            // Validation
            if (!nom_service || !type_service || !id_entreprise_livraison) {
                throw new ValidationError('Nom, type et ID entreprise requis');
            }

            if (!['STANDARD', 'EXPRESS', 'PROGRAMMEE', 'NUIT', 'WEEKEND', 'INTERNATIONAL'].includes(type_service)) {
                throw new ValidationError('Type de service invalide');
            }

            // Vérifier que l'entreprise existe
            const entreprise = await db.query(
                'SELECT id FROM ENTREPRISE_LIVRAISON WHERE id = $1 AND est_actif = true',
                [id_entreprise_livraison]
            );

            if (entreprise.rows.length === 0) {
                throw new NotFoundError('Entreprise de livraison non trouvée ou inactive');
            }

            const result = await db.query(
                `INSERT INTO SERVICES_LIVRAISON (
                    nom_service, type_service, description_service, prix_service,
                    prix_par_km, distance_max_km, donnees_supplementaires,
                    id_entreprise_livraison, est_actif
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
                RETURNING *`,
                [
                    nom_service, type_service, description_service, prix_service,
                    prix_par_km, distance_max_km, JSON.stringify(donnees_supplementaires || {}),
                    id_entreprise_livraison
                ]
            );

            // Journalisation
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'SERVICE_LIVRAISON',
                ressource_id: result.rows[0].id,
                utilisateur_id: req.user.id,
                donnees_apres: result.rows[0]
            });

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message: 'Service de livraison créé avec succès'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer tous les services de livraison
     * @route GET /api/v1/livraison/services
     */
    async findAll(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                type_service,
                id_entreprise_livraison,
                est_actif,
                prix_max
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT s.*,
                       e.nom_entreprise_livraison,
                       COUNT(*) OVER() as total_count
                FROM SERVICES_LIVRAISON s
                JOIN ENTREPRISE_LIVRAISON e ON e.id = s.id_entreprise_livraison
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            if (type_service) {
                query += ` AND s.type_service = $${paramIndex}`;
                params.push(type_service);
                paramIndex++;
            }

            if (id_entreprise_livraison) {
                query += ` AND s.id_entreprise_livraison = $${paramIndex}`;
                params.push(id_entreprise_livraison);
                paramIndex++;
            }

            if (est_actif !== undefined) {
                query += ` AND s.est_actif = $${paramIndex}`;
                params.push(est_actif === 'true');
                paramIndex++;
            }

            if (prix_max) {
                query += ` AND s.prix_service <= $${paramIndex}`;
                params.push(parseFloat(prix_max));
                paramIndex++;
            }

            query += ` ORDER BY s.prix_service ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
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
                    pages: Math.ceil(total / limit)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer un service par son ID
     * @route GET /api/v1/livraison/services/:id
     */
    async findOne(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT s.*,
                        e.nom_entreprise_livraison,
                        e.logo_entreprise_livraison,
                        COUNT(dl.id) as nombre_utilisations
                 FROM SERVICES_LIVRAISON s
                 JOIN ENTREPRISE_LIVRAISON e ON e.id = s.id_entreprise_livraison
                 LEFT JOIN DEMANDES_LIVRAISON dl ON dl.service_livraison_id = s.id
                 WHERE s.id = $1
                 GROUP BY s.id, e.nom_entreprise_livraison, e.logo_entreprise_livraison`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Service de livraison non trouvé');
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
     * Mettre à jour un service
     * @route PUT /api/v1/livraison/services/:id
     */
    async update(req, res, next) {
        try {
            const { id } = req.params;
            const updateData = { ...req.body };

            // Vérifier l'existence
            const service = await db.query(
                'SELECT * FROM SERVICES_LIVRAISON WHERE id = $1',
                [id]
            );

            if (service.rows.length === 0) {
                throw new NotFoundError('Service non trouvé');
            }

            // Construction de la requête UPDATE
            const setClauses = [];
            const values = [id];
            let valueIndex = 2;

            const allowedFields = [
                'nom_service', 'type_service', 'description_service',
                'prix_service', 'prix_par_km', 'distance_max_km',
                'donnees_supplementaires', 'est_actif'
            ];

            for (const field of allowedFields) {
                if (updateData[field] !== undefined) {
                    setClauses.push(`${field} = $${valueIndex}`);
                    
                    if (field === 'donnees_supplementaires') {
                        values.push(JSON.stringify(updateData[field]));
                    } else {
                        values.push(updateData[field]);
                    }
                    
                    valueIndex++;
                }
            }

            if (setClauses.length === 0) {
                throw new ValidationError('Aucune donnée à mettre à jour');
            }

            setClauses.push('date_mise_a_jour = NOW()');

            const updateQuery = `
                UPDATE SERVICES_LIVRAISON 
                SET ${setClauses.join(', ')}
                WHERE id = $1
                RETURNING *
            `;

            const result = await db.query(updateQuery, values);

            // Journalisation
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'SERVICE_LIVRAISON',
                ressource_id: id,
                utilisateur_id: req.user.id,
                donnees_avant: service.rows[0],
                donnees_apres: result.rows[0]
            });

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Service mis à jour avec succès'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Supprimer un service (soft delete)
     * @route DELETE /api/v1/livraison/services/:id
     */
    async delete(req, res, next) {
        try {
            const { id } = req.params;

            // Vérifier si le service est utilisé dans des demandes
            const utilisations = await db.query(
                'SELECT id FROM DEMANDES_LIVRAISON WHERE service_livraison_id = $1 LIMIT 1',
                [id]
            );

            if (utilisations.rows.length > 0) {
                // Soft delete seulement
                const result = await db.query(
                    `UPDATE SERVICES_LIVRAISON 
                     SET est_actif = false,
                         date_mise_a_jour = NOW()
                     WHERE id = $1
                     RETURNING *`,
                    [id]
                );

                return res.json({
                    success: true,
                    data: result.rows[0],
                    message: 'Service désactivé (utilisations existantes)'
                });
            }

            // Suppression physique si jamais utilisé
            const result = await db.query(
                'DELETE FROM SERVICES_LIVRAISON WHERE id = $1 RETURNING id',
                [id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Service non trouvé');
            }

            res.json({
                success: true,
                message: 'Service supprimé définitivement'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Calculer le prix d'une livraison
     * @route POST /api/v1/livraison/services/calculer-prix
     */
    async calculerPrix(req, res, next) {
        try {
            const {
                service_id,
                point_depart,
                point_arrivee,
                distance_km,
                poids_kg,
                urgent = false
            } = req.body;

            // Récupérer le service
            const service = await db.query(
                'SELECT * FROM SERVICES_LIVRAISON WHERE id = $1 AND est_actif = true',
                [service_id]
            );

            if (service.rows.length === 0) {
                throw new NotFoundError('Service non trouvé ou inactif');
            }

            const s = service.rows[0];
            let prixTotal = s.prix_service;

            // Calcul basé sur la distance
            if (distance_km && s.prix_par_km) {
                prixTotal += distance_km * s.prix_par_km;
            }

            // Vérifier la distance max
            if (s.distance_max_km && distance_km > s.distance_max_km) {
                throw new ValidationError(`Distance maximale dépassée (max: ${s.distance_max_km} km)`);
            }

            // Suppléments
            if (urgent && s.type_service !== 'EXPRESS') {
                prixTotal *= 1.3; // +30% pour urgence
            }

            if (poids_kg && poids_kg > 10) {
                prixTotal += (poids_kg - 10) * 100; // 100 FCFA par kg supplémentaire
            }

            res.json({
                success: true,
                data: {
                    service: s.nom_service,
                    prix_base: s.prix_service,
                    supplement_distance: distance_km && s.prix_par_km ? distance_km * s.prix_par_km : 0,
                    supplement_urgence: urgent && s.type_service !== 'EXPRESS' ? s.prix_service * 0.3 : 0,
                    supplement_poids: poids_kg && poids_kg > 10 ? (poids_kg - 10) * 100 : 0,
                    prix_total: Math.round(prixTotal * 100) / 100,
                    devise: 'XOF'
                }
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new ServiceLivraisonController();