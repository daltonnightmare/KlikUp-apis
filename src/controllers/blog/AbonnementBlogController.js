// src/controllers/blog/AbonnementBlogController.js
const db = require('../../configuration/database');
const { ValidationError } = require('../../utils/errors/AppError');

class AbonnementBlogController {
    /**
     * S'abonner à une catégorie, un auteur ou un tag
     * @route POST /api/v1/blog/abonnements
     */
    async subscribe(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { type_abonnement, reference_id } = req.body;

            if (!['CATEGORIE', 'AUTEUR', 'TAG'].includes(type_abonnement)) {
                throw new ValidationError('Type d\'abonnement invalide');
            }

            // Vérifier que la référence existe
            if (type_abonnement === 'AUTEUR') {
                const auteur = await client.query(
                    'SELECT id FROM COMPTES WHERE id = $1',
                    [reference_id]
                );
                if (auteur.rows.length === 0) {
                    throw new ValidationError('Auteur non trouvé');
                }
            }

            // Vérifier si déjà abonné
            const existing = await client.query(
                `SELECT id FROM ABONNEMENTS_BLOG 
                 WHERE compte_id = $1 AND type_abonnement = $2 AND reference_id = $3`,
                [req.user.id, type_abonnement, reference_id]
            );

            let result;
            let message;

            if (existing.rows.length > 0) {
                // Mettre à jour le statut
                result = await client.query(
                    `UPDATE ABONNEMENTS_BLOG 
                     SET actif = NOT actif,
                         date_abonnement = NOW()
                     WHERE id = $1
                     RETURNING *`,
                    [existing.rows[0].id]
                );
                message = result.rows[0].actif ? 'Abonnement réactivé' : 'Abonnement désactivé';
            } else {
                // Nouvel abonnement
                result = await client.query(
                    `INSERT INTO ABONNEMENTS_BLOG (compte_id, type_abonnement, reference_id, actif)
                     VALUES ($1, $2, $3, true)
                     RETURNING *`,
                    [req.user.id, type_abonnement, reference_id]
                );
                message = 'Abonnement créé avec succès';
            }

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les abonnements de l'utilisateur
     * @route GET /api/v1/blog/abonnements/mes-abonnements
     */
    async mesAbonnements(req, res, next) {
        try {
            const { type, actif = true } = req.query;

            let query = `
                SELECT a.*
                FROM ABONNEMENTS_BLOG a
                WHERE a.compte_id = $1
            `;
            const params = [req.user.id];

            if (type) {
                query += ` AND a.type_abonnement = $2`;
                params.push(type);
            }

            if (actif !== undefined) {
                query += ` AND a.actif = $${params.length + 1}`;
                params.push(actif === 'true');
            }

            query += ` ORDER BY a.date_abonnement DESC`;

            const result = await db.query(query, params);

            // Enrichir les données selon le type d'abonnement
            const enriched = await Promise.all(result.rows.map(async (abonnement) => {
                const enriched = { ...abonnement };
                
                if (abonnement.type_abonnement === 'AUTEUR') {
                    const auteur = await db.query(
                        'SELECT nom_utilisateur_compte, photo_profil_compte FROM COMPTES WHERE id = $1',
                        [abonnement.reference_id]
                    );
                    enriched.reference_nom = auteur.rows[0]?.nom_utilisateur_compte;
                    enriched.reference_photo = auteur.rows[0]?.photo_profil_compte;
                } else if (abonnement.type_abonnement === 'CATEGORIE') {
                    // Récupérer le libellé de la catégorie depuis l'ENUM
                    enriched.reference_nom = abonnement.reference_id;
                }
                
                return enriched;
            }));

            res.json({
                success: true,
                data: enriched
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Se désabonner
     * @route DELETE /api/v1/blog/abonnements/:id
     */
    async unsubscribe(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `UPDATE ABONNEMENTS_BLOG 
                 SET actif = false
                 WHERE id = $1 AND compte_id = $2
                 RETURNING *`,
                [id, req.user.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Abonnement non trouvé'
                });
            }

            res.json({
                success: true,
                message: 'Désabonnement effectué'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les abonnés d'un auteur/catégorie
     * @route GET /api/v1/blog/abonnements/abonnes
     */
    async getAbonnes(req, res, next) {
        try {
            const { type, reference_id, page = 1, limit = 50 } = req.query;

            const offset = (page - 1) * limit;

            const result = await db.query(
                `SELECT a.*,
                        c.nom_utilisateur_compte,
                        c.photo_profil_compte,
                        COUNT(*) OVER() as total_count
                 FROM ABONNEMENTS_BLOG a
                 JOIN COMPTES c ON c.id = a.compte_id
                 WHERE a.type_abonnement = $1 
                   AND a.reference_id = $2
                   AND a.actif = true
                 ORDER BY a.date_abonnement DESC
                 LIMIT $3 OFFSET $4`,
                [type, reference_id, parseInt(limit), offset]
            );

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
}

module.exports = new AbonnementBlogController();