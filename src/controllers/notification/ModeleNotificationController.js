// src/controllers/notification/ModeleNotificationController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');

class ModeleNotificationController {
    /**
     * Créer un nouveau modèle de notification
     * @route POST /api/v1/notifications/modeles
     */
    async create(req, res, next) {
        try {
            const {
                code,
                titre_template,
                corps_template,
                canal_defaut = 'IN_APP',
                priorite_defaut = 'NORMALE'
            } = req.body;

            // Validation
            if (!code || !titre_template || !corps_template) {
                throw new ValidationError('Code, titre et corps du template sont requis');
            }

            // Vérifier l'unicité du code
            const existing = await db.query(
                'SELECT id FROM MODELES_NOTIFICATIONS WHERE code = $1',
                [code]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError('Un modèle avec ce code existe déjà');
            }

            const result = await db.query(
                `INSERT INTO MODELES_NOTIFICATIONS (
                    code, titre_template, corps_template, canal_defaut, priorite_defaut, est_actif
                ) VALUES ($1, $2, $3, $4, $5, true)
                RETURNING *`,
                [code, titre_template, corps_template, canal_defaut, priorite_defaut]
            );

            // Journalisation
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'MODELE_NOTIFICATION',
                ressource_id: result.rows[0].id,
                utilisateur_id: req.user.id,
                donnees_apres: result.rows[0]
            });

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message: 'Modèle de notification créé avec succès'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer tous les modèles
     * @route GET /api/v1/notifications/modeles
     */
    async findAll(req, res, next) {
        try {
            const {
                page = 1,
                limit = 50,
                est_actif,
                recherche
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT m.*,
                       COUNT(*) OVER() as total_count
                FROM MODELES_NOTIFICATIONS m
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            if (est_actif !== undefined) {
                query += ` AND m.est_actif = $${paramIndex}`;
                params.push(est_actif === 'true');
                paramIndex++;
            }

            if (recherche) {
                query += ` AND (m.code ILIKE $${paramIndex} OR m.titre_template ILIKE $${paramIndex})`;
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            query += ` ORDER BY m.code ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
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
     * Récupérer un modèle par son code
     * @route GET /api/v1/notifications/modeles/:code
     */
    async findOne(req, res, next) {
        try {
            const { code } = req.params;

            const result = await db.query(
                'SELECT * FROM MODELES_NOTIFICATIONS WHERE code = $1',
                [code]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Modèle de notification non trouvé');
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
     * Mettre à jour un modèle
     * @route PUT /api/v1/notifications/modeles/:code
     */
    async update(req, res, next) {
        try {
            const { code } = req.params;
            const updateData = { ...req.body };

            // Vérifier l'existence
            const modele = await db.query(
                'SELECT * FROM MODELES_NOTIFICATIONS WHERE code = $1',
                [code]
            );

            if (modele.rows.length === 0) {
                throw new NotFoundError('Modèle non trouvé');
            }

            // Construction de la requête UPDATE
            const setClauses = [];
            const values = [code];
            let valueIndex = 2;

            const allowedFields = [
                'titre_template', 'corps_template', 'canal_defaut',
                'priorite_defaut', 'est_actif'
            ];

            for (const field of allowedFields) {
                if (updateData[field] !== undefined) {
                    setClauses.push(`${field} = $${valueIndex}`);
                    values.push(updateData[field]);
                    valueIndex++;
                }
            }

            if (setClauses.length === 0) {
                throw new ValidationError('Aucune donnée à mettre à jour');
            }

            const updateQuery = `
                UPDATE MODELES_NOTIFICATIONS 
                SET ${setClauses.join(', ')}
                WHERE code = $1
                RETURNING *
            `;

            const result = await db.query(updateQuery, values);

            // Journalisation
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'MODELE_NOTIFICATION',
                ressource_id: result.rows[0].id,
                utilisateur_id: req.user.id,
                donnees_avant: modele.rows[0],
                donnees_apres: result.rows[0]
            });

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Modèle mis à jour avec succès'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Supprimer un modèle
     * @route DELETE /api/v1/notifications/modeles/:code
     */
    async delete(req, res, next) {
        try {
            const { code } = req.params;

            // Vérifier si le modèle est utilisé
            const used = await db.query(
                'SELECT id FROM NOTIFICATIONS WHERE modele_id = (SELECT id FROM MODELES_NOTIFICATIONS WHERE code = $1) LIMIT 1',
                [code]
            );

            if (used.rows.length > 0) {
                // Soft delete seulement
                const result = await db.query(
                    `UPDATE MODELES_NOTIFICATIONS 
                     SET est_actif = false
                     WHERE code = $1
                     RETURNING id`,
                    [code]
                );

                return res.json({
                    success: true,
                    message: 'Modèle désactivé (utilisations existantes)'
                });
            }

            // Suppression physique si jamais utilisé
            const result = await db.query(
                'DELETE FROM MODELES_NOTIFICATIONS WHERE code = $1 RETURNING id',
                [code]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Modèle non trouvé');
            }

            res.json({
                success: true,
                message: 'Modèle supprimé définitivement'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Tester un modèle
     * @route POST /api/v1/notifications/modeles/:code/test
     */
    async test(req, res, next) {
        try {
            const { code } = req.params;
            const { variables } = req.body;

            const modele = await db.query(
                'SELECT * FROM MODELES_NOTIFICATIONS WHERE code = $1 AND est_actif = true',
                [code]
            );

            if (modele.rows.length === 0) {
                throw new NotFoundError('Modèle non trouvé ou inactif');
            }

            const m = modele.rows[0];

            // Remplacer les variables dans les templates
            let titre = m.titre_template;
            let corps = m.corps_template;

            if (variables) {
                for (const [key, value] of Object.entries(variables)) {
                    const regex = new RegExp(`{{${key}}}`, 'g');
                    titre = titre.replace(regex, value);
                    corps = corps.replace(regex, value);
                }
            }

            res.json({
                success: true,
                data: {
                    code: m.code,
                    titre,
                    corps,
                    canal_defaut: m.canal_defaut,
                    priorite_defaut: m.priorite_defaut
                }
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new ModeleNotificationController();