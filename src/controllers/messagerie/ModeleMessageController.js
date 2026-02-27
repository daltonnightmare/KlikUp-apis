// src/controllers/messagerie/ModeleMessageController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');

class ModeleMessageController {
    /**
     * Créer un modèle de message
     * @route POST /api/v1/messagerie/modeles
     */
    async create(req, res, next) {
        try {
            const {
                titre,
                contenu_message,
                categorie,
                tags,
                raccourci
            } = req.body;

            if (!titre || !contenu_message) {
                throw new ValidationError('Titre et contenu requis');
            }

            // Vérifier l'unicité du raccourci si fourni
            if (raccourci) {
                const existing = await db.query(
                    'SELECT id FROM MODELES_MESSAGES WHERE compte_id = $1 AND raccourci = $2',
                    [req.user.id, raccourci]
                );

                if (existing.rows.length > 0) {
                    throw new ValidationError('Ce raccourci est déjà utilisé');
                }
            }

            const result = await db.query(
                `INSERT INTO MODELES_MESSAGES (
                    compte_id, titre, contenu_message, categorie, tags, raccourci
                ) VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *`,
                [req.user.id, titre, contenu_message, categorie, tags || [], raccourci]
            );

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message: 'Modèle créé'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les modèles de l'utilisateur
     * @route GET /api/v1/messagerie/modeles
     */
    async getMyModels(req, res, next) {
        try {
            const {
                categorie,
                search,
                page = 1,
                limit = 50
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT m.*,
                       COUNT(*) OVER() as total_count
                FROM MODELES_MESSAGES m
                WHERE m.compte_id = $1
            `;

            const params = [req.user.id];
            let paramIndex = 2;

            if (categorie) {
                query += ` AND m.categorie = $${paramIndex}`;
                params.push(categorie);
                paramIndex++;
            }

            if (search) {
                query += ` AND (m.titre ILIKE $${paramIndex} OR m.contenu_message ILIKE $${paramIndex})`;
                params.push(`%${search}%`);
                paramIndex++;
            }

            query += ` ORDER BY m.nombre_utilisations DESC, m.date_creation DESC
                       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Grouper par catégorie
            const categories = await db.query(
                `SELECT categorie, COUNT(*) as nombre
                 FROM MODELES_MESSAGES
                 WHERE compte_id = $1
                 GROUP BY categorie
                 ORDER BY nombre DESC`,
                [req.user.id]
            );

            res.json({
                success: true,
                data: {
                    modeles: result.rows,
                    categories: categories.rows
                },
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
     * Récupérer un modèle spécifique
     * @route GET /api/v1/messagerie/modeles/:id
     */
    async getOne(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                'SELECT * FROM MODELES_MESSAGES WHERE id = $1 AND compte_id = $2',
                [id, req.user.id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Modèle non trouvé');
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
     * @route PUT /api/v1/messagerie/modeles/:id
     */
    async update(req, res, next) {
        try {
            const { id } = req.params;
            const updateData = { ...req.body };

            const setClauses = [];
            const values = [id, req.user.id];
            let valueIndex = 3;

            const allowedFields = ['titre', 'contenu_message', 'categorie', 'tags', 'raccourci'];

            for (const field of allowedFields) {
                if (updateData[field] !== undefined) {
                    setClauses.push(`${field} = $${valueIndex}`);
                    
                    if (field === 'tags') {
                        values.push(updateData[field] || []);
                    } else {
                        values.push(updateData[field]);
                    }
                    
                    valueIndex++;
                }
            }

            if (setClauses.length === 0) {
                throw new ValidationError('Aucune donnée à mettre à jour');
            }

            setClauses.push('date_modification = NOW()');

            const updateQuery = `
                UPDATE MODELES_MESSAGES 
                SET ${setClauses.join(', ')}
                WHERE id = $1 AND compte_id = $2
                RETURNING *
            `;

            const result = await db.query(updateQuery, values);

            if (result.rows.length === 0) {
                throw new NotFoundError('Modèle non trouvé');
            }

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Modèle mis à jour'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Supprimer un modèle
     * @route DELETE /api/v1/messagerie/modeles/:id
     */
    async delete(req, res, next) {
        try {
            const result = await db.query(
                'DELETE FROM MODELES_MESSAGES WHERE id = $1 AND compte_id = $2 RETURNING id',
                [req.params.id, req.user.id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Modèle non trouvé');
            }

            res.json({
                success: true,
                message: 'Modèle supprimé'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Incrémenter le compteur d'utilisation
     * @route POST /api/v1/messagerie/modeles/:id/utiliser
     */
    async use(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `UPDATE MODELES_MESSAGES 
                 SET nombre_utilisations = nombre_utilisations + 1,
                     dernier_usage = NOW()
                 WHERE id = $1 AND compte_id = $2
                 RETURNING contenu_message, titre`,
                [id, req.user.id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Modèle non trouvé');
            }

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Modèle utilisé'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Dupliquer un modèle
     * @route POST /api/v1/messagerie/modeles/:id/dupliquer
     */
    async duplicate(req, res, next) {
        try {
            const { id } = req.params;

            const original = await db.query(
                'SELECT * FROM MODELES_MESSAGES WHERE id = $1 AND compte_id = $2',
                [id, req.user.id]
            );

            if (original.rows.length === 0) {
                throw new NotFoundError('Modèle original non trouvé');
            }

            const o = original.rows[0];

            const result = await db.query(
                `INSERT INTO MODELES_MESSAGES (
                    compte_id, titre, contenu_message, categorie, tags
                ) VALUES ($1, CONCAT($2, ' (copie)'), $3, $4, $5)
                RETURNING *`,
                [req.user.id, o.titre, o.contenu_message, o.categorie, o.tags]
            );

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message: 'Modèle dupliqué'
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new ModeleMessageController();