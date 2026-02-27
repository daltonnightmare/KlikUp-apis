// src/controllers/boutique/CategorieBoutiqueController.js
const pool = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const { logError } = require('../../configuration/logger');

class CategorieBoutiqueController {
    /**
     * Créer une nouvelle catégorie
     */
    async create(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const { boutiqueId } = req.params;
            const {
                nom_categorie,
                description_categorie,
                slug_categorie,
                categorie_parente_id,
                ordre_affichage = 0
            } = req.body;

            // Validations
            if (!nom_categorie || nom_categorie.length < 2) {
                throw new ValidationError('Le nom doit contenir au moins 2 caractères');
            }

            // Vérification catégorie parente
            if (categorie_parente_id) {
                const parentCheck = await client.query(
                    'SELECT id FROM CATEGORIES_BOUTIQUE WHERE id = $1 AND boutique_id = $2',
                    [categorie_parente_id, boutiqueId]
                );
                if (parentCheck.rows.length === 0) {
                    throw new ValidationError('Catégorie parente invalide');
                }
            }

            // Génération slug
            const finalSlug = await this._generateSlug(client, slug_categorie || nom_categorie);

            const result = await client.query(
                `INSERT INTO CATEGORIES_BOUTIQUE (
                    nom_categorie, description_categorie, slug_categorie,
                    categorie_parente_id, boutique_id, ordre_affichage, est_actif, date_creation
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                RETURNING *`,
                [
                    nom_categorie,
                    description_categorie || null,
                    finalSlug,
                    categorie_parente_id || null,
                    boutiqueId,
                    ordre_affichage,
                    true
                ]
            );

            await client.query('COMMIT');

            res.status(201).json({
                status: 'success',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur création catégorie:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer toutes les catégories d'une boutique
     */
    async findAll(req, res, next) {
        try {
            const { boutiqueId } = req.params;
            const { inclure_produits, inclure_sous_categories } = req.query;

            const categories = await pool.query(
                `SELECT 
                    cb.*,
                    COUNT(pb.id) FILTER (WHERE pb.est_disponible = true) as nombre_produits
                FROM CATEGORIES_BOUTIQUE cb
                LEFT JOIN PRODUITSBOUTIQUE pb ON pb.id_categorie = cb.id
                WHERE cb.boutique_id = $1 AND cb.est_actif = true
                GROUP BY cb.id
                ORDER BY cb.ordre_affichage, cb.nom_categorie`,
                [boutiqueId]
            );

            let result = await this._buildCategorieTree(categories.rows, inclure_produits === 'true');

            res.json({
                status: 'success',
                data: result
            });

        } catch (error) {
            logError('Erreur récupération catégories:', error);
            next(error);
        }
    }

    /**
     * Mettre à jour une catégorie
     */
    async update(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const updates = req.body;

            const categorie = await this._checkAndGetCategorie(client, id);

            const { query, values } = await this._buildUpdateQuery(updates, categorie);
            
            const result = await client.query(query, values);

            await client.query('COMMIT');

            res.json({
                status: 'success',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur mise à jour catégorie:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer une catégorie
     */
    async delete(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { transfert_produits_vers, force = false } = req.body;

            const categorie = await this._checkAndGetCategorie(client, id);

            // Gestion des produits
            const produitsCount = await client.query(
                'SELECT COUNT(*) FROM PRODUITSBOUTIQUE WHERE id_categorie = $1',
                [id]
            );

            if (parseInt(produitsCount.rows[0].count) > 0) {
                if (transfert_produits_vers) {
                    await client.query(
                        `UPDATE PRODUITSBOUTIQUE SET id_categorie = $1 
                         WHERE id_categorie = $2`,
                        [transfert_produits_vers, id]
                    );
                } else if (!force) {
                    throw new ValidationError('Cette catégorie contient des produits');
                }
            }

            // Suppression
            await client.query('DELETE FROM CATEGORIES_BOUTIQUE WHERE id = $1', [id]);

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: 'Catégorie supprimée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur suppression catégorie:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Réorganiser les catégories
     */
    async reorder(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const { boutiqueId } = req.params;
            const { ordres } = req.body;

            if (!Array.isArray(ordres)) {
                throw new ValidationError('Le format est invalide');
            }

            for (const item of ordres) {
                await client.query(
                    `UPDATE CATEGORIES_BOUTIQUE 
                     SET ordre_affichage = $1
                     WHERE id = $2 AND boutique_id = $3`,
                    [item.ordre_affichage, item.id, boutiqueId]
                );
            }

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: 'Ordre mis à jour'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur réorganisation:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    // Méthodes privées
    async _generateSlug(client, base) {
        const slug = base.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        
        let finalSlug = slug;
        let counter = 1;
        
        while (true) {
            const exists = await client.query(
                'SELECT id FROM CATEGORIES_BOUTIQUE WHERE slug_categorie = $1',
                [finalSlug]
            );
            if (exists.rows.length === 0) break;
            finalSlug = `${slug}-${counter}`;
            counter++;
        }
        
        return finalSlug;
    }

    async _buildCategorieTree(categories, inclureProduits) {
        const map = {};
        const roots = [];

        categories.forEach(cat => {
            map[cat.id] = { ...cat, sous_categories: [] };
        });

        categories.forEach(cat => {
            if (cat.categorie_parente_id && map[cat.categorie_parente_id]) {
                map[cat.categorie_parente_id].sous_categories.push(map[cat.id]);
            } else {
                roots.push(map[cat.id]);
            }
        });

        if (inclureProduits) {
            await this._ajouterProduitsAuxCategories(roots);
        }

        return roots;
    }

    async _ajouterProduitsAuxCategories(categories) {
        for (const cat of categories) {
            const produits = await pool.query(
                `SELECT id, nom_produit, image_produit, prix_unitaire_produit, 
                        prix_promo, quantite
                 FROM PRODUITSBOUTIQUE
                 WHERE id_categorie = $1 AND est_disponible = true
                 ORDER BY date_creation DESC
                 LIMIT 10`,
                [cat.id]
            );
            cat.produits = produits.rows;

            if (cat.sous_categories?.length) {
                await this._ajouterProduitsAuxCategories(cat.sous_categories);
            }
        }
    }

    async _checkAndGetCategorie(client, id) {
        const result = await client.query(
            'SELECT * FROM CATEGORIES_BOUTIQUE WHERE id = $1',
            [id]
        );
        if (result.rows.length === 0) {
            throw new AppError('Catégorie non trouvée', 404);
        }
        return result.rows[0];
    }

    async _buildUpdateQuery(updates, categorie) {
        const setClauses = [];
        const values = [categorie.id];
        const champsAutorises = [
            'nom_categorie', 'description_categorie', 'slug_categorie',
            'categorie_parente_id', 'ordre_affichage', 'est_actif'
        ];

        for (const champ of champsAutorises) {
            if (updates[champ] !== undefined) {
                setClauses.push(`${champ} = $${values.length + 1}`);
                values.push(updates[champ]);
            }
        }

        return {
            query: `UPDATE CATEGORIES_BOUTIQUE 
                    SET ${setClauses.join(', ')}
                    WHERE id = $1
                    RETURNING *`,
            values
        };
    }
}

module.exports = new CategorieBoutiqueController();