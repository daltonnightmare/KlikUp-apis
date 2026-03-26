// src/controllers/public/AvisPubliquesController.js
const db = require('../../configuration/database');
const { ValidationError } = require('../../utils/errors/AppError');

class AvisPubliquesController {
    /**
     * Lister les avis publics
     * @route GET /api/v1/public/avis
     */
    async listAvis(req, res, next) {
        try {
            const {
                entite_type,
                entite_id,
                page = 1,
                limit = 20,
                note_min,
                tri = 'recent'
            } = req.query;

            if (!entite_type || !entite_id) {
                throw new ValidationError('Type et ID d\'entité requis');
            }

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    a.id,
                    a.note_globale,
                    a.titre,
                    a.contenu,
                    a.date_creation,
                    c.nom_utilisateur_compte as auteur,
                    c.photo_profil_compte as auteur_photo,
                    a.nombre_utile,
                    a.nombre_inutile
                FROM AVIS a
                JOIN COMPTES c ON c.id = a.auteur_id
                WHERE a.entite_type = $1 
                  AND a.entite_id = $2 
                  AND a.statut = 'PUBLIE'
            `;

            const params = [entite_type, entite_id];
            let paramIndex = 3;

            if (note_min) {
                query += ` AND a.note_globale >= $${paramIndex}`;
                params.push(parseInt(note_min));
                paramIndex++;
            }

            switch (tri) {
                case 'note_desc':
                    query += ` ORDER BY a.note_globale DESC`;
                    break;
                case 'note_asc':
                    query += ` ORDER BY a.note_globale ASC`;
                    break;
                case 'utile':
                    query += ` ORDER BY a.nombre_utile DESC`;
                    break;
                default:
                    query += ` ORDER BY a.date_creation DESC`;
            }

            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);

            // Statistiques globales
            const stats = await db.query(`
                SELECT 
                    COUNT(*) as total,
                    ROUND(AVG(note_globale)::numeric, 2) as moyenne,
                    COUNT(*) FILTER (WHERE note_globale = 5) as cinq_etoiles,
                    COUNT(*) FILTER (WHERE note_globale = 4) as quatre_etoiles,
                    COUNT(*) FILTER (WHERE note_globale = 3) as trois_etoiles,
                    COUNT(*) FILTER (WHERE note_globale <= 2) as avis_negatifs
                FROM AVIS
                WHERE entite_type = $1 AND entite_id = $2 AND statut = 'PUBLIE'
            `, [entite_type, entite_id]);

            res.json({
                success: true,
                data: {
                    avis: result.rows,
                    stats: stats.rows[0],
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total: parseInt(stats.rows[0].total),
                        pages: Math.ceil(stats.rows[0].total / limit)
                    }
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Vérifier si un avis peut être laissé
     * @route GET /api/v1/public/avis/verifier
     */
    async checkCanLeaveAvis(req, res, next) {
        try {
            const { commande_reference, email } = req.query;

            if (!commande_reference || !email) {
                throw new ValidationError('Référence de commande et email requis');
            }

            // Vérifier dans les commandes restaurant
            let commande = await db.query(`
                SELECT 
                    id,
                    'RESTAURANT_FAST_FOOD' as entite_type,
                    id_restaurant_fast_food_emplacement as entite_id,
                    reference_commande
                FROM COMMANDESEMPLACEMENTFASTFOOD
                WHERE reference_commande = $1 
                  AND statut_commande IN ('LIVREE', 'RECUPEREE')
                LIMIT 1
            `, [commande_reference]);

            if (commande.rows.length === 0) {
                commande = await db.query(`
                    SELECT 
                        id,
                        'BOUTIQUE' as entite_type,
                        id_boutique as entite_id,
                        reference_commande
                    FROM COMMANDESBOUTIQUES
                    WHERE reference_commande = $1 
                      AND statut_commande = 'LIVREE'
                    LIMIT 1
                `, [commande_reference]);
            }

            if (commande.rows.length === 0) {
                return res.json({
                    success: true,
                    data: {
                        peut_laisser_avis: false,
                        raison: 'Commande non trouvée ou non terminée'
                    }
                });
            }

            // Vérifier si un avis existe déjà
            const avisExistant = await db.query(`
                SELECT id FROM AVIS
                WHERE commande_type = $1 AND commande_id = $2
            `, [
                commande.rows[0].entite_type === 'RESTAURANT_FAST_FOOD' ? 'RESTAURANT_FAST_FOOD' : 'BOUTIQUE',
                commande.rows[0].id
            ]);

            res.json({
                success: true,
                data: {
                    peut_laisser_avis: avisExistant.rows.length === 0,
                    commande: commande.rows[0],
                    raison: avisExistant.rows.length > 0 ? 'Un avis a déjà été laissé pour cette commande' : null
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Déposer un avis (nécessite une commande validée)
     * @route POST /api/v1/public/avis
     */
    async createAvis(req, res, next) {
        const client = await db.getClient();
        
        try {
            await client.query('BEGIN');

            const {
                commande_reference,
                email,
                entite_type,
                entite_id,
                note_globale,
                titre,
                contenu
            } = req.body;

            // Validation
            if (!commande_reference || !email) {
                throw new ValidationError('Référence de commande et email requis');
            }

            if (!note_globale || note_globale < 1 || note_globale > 5) {
                throw new ValidationError('Note invalide (1-5)');
            }

            // Vérifier la commande
            let commande;
            if (entite_type === 'RESTAURANT_FAST_FOOD') {
                const result = await client.query(`
                    SELECT id FROM COMMANDESEMPLACEMENTFASTFOOD
                    WHERE reference_commande = $1 
                      AND statut_commande IN ('LIVREE', 'RECUPEREE')
                `, [commande_reference]);
                commande = result.rows[0];
            } else {
                const result = await client.query(`
                    SELECT id FROM COMMANDESBOUTIQUES
                    WHERE reference_commande = $1 AND statut_commande = 'LIVREE'
                `, [commande_reference]);
                commande = result.rows[0];
            }

            if (!commande) {
                throw new ValidationError('Commande non trouvée ou non terminée');
            }

            // Vérifier si un avis existe déjà
            const avisExistant = await client.query(`
                SELECT id FROM AVIS
                WHERE commande_type = $1 AND commande_id = $2
            `, [entite_type, commande.id]);

            if (avisExistant.rows.length > 0) {
                throw new ValidationError('Un avis a déjà été déposé pour cette commande');
            }

            // Créer l'avis
            const result = await client.query(`
                INSERT INTO AVIS (
                    entite_type,
                    entite_id,
                    auteur_id,
                    note_globale,
                    titre,
                    contenu,
                    commande_type,
                    commande_id,
                    est_achat_verifie,
                    statut
                ) VALUES (
                    $1, $2, 
                    (SELECT id FROM COMPTES WHERE email = $3 LIMIT 1),
                    $4, $5, $6, $7, $8, true, 'EN_ATTENTE'
                ) RETURNING id
            `, [
                entite_type,
                entite_id,
                email,
                note_globale,
                titre,
                contenu,
                entite_type,
                commande.id
            ]);

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Avis déposé avec succès. Il sera publié après modération.',
                data: { avis_id: result.rows[0].id }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }
}

module.exports = new AvisPubliquesController();