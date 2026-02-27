const db = require('../../configuration/database');
const { AppError, ValidationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const FileService = require('../../services/file/FileService');

class ProduitRestaurantController {
    /**
     * Récupérer tous les produits d'un emplacement
     * GET /api/v1/restauration/emplacements/:emplacementId/produits
     */
    static async getAll(req, res, next) {
        try {
            const { emplacementId } = req.params;
            const {
                page = 1,
                limit = 20,
                categorie,
                disponible,
                prix_min,
                prix_max,
                recherche,
                tri = 'nom_asc'
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    p.id, 
                    p.nom_produit,
                    p.description_produit,
                    p.photo_produit,
                    p.donnees_produit,
                    p.prix_produit,
                    p.stock_disponible,
                    p.categorie_produit,
                    p.disponible,
                    p.est_journalier,
                    p.date_creation,
                    erf.nom_emplacement
                FROM PRODUITSINDIVIDUELRESTAURANT p
                JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = p.id_restaurant_fast_food_emplacement
                WHERE p.id_restaurant_fast_food_emplacement = $1
            `;

            const params = [emplacementId];
            let paramIndex = 2;

            if (categorie) {
                query += ` AND p.categorie_produit = $${paramIndex}`;
                params.push(categorie);
                paramIndex++;
            }

            if (disponible !== undefined) {
                query += ` AND p.disponible = $${paramIndex}`;
                params.push(disponible === 'true');
                paramIndex++;
            }

            if (prix_min) {
                query += ` AND p.prix_produit >= $${paramIndex}`;
                params.push(prix_min);
                paramIndex++;
            }

            if (prix_max) {
                query += ` AND p.prix_produit <= $${paramIndex}`;
                params.push(prix_max);
                paramIndex++;
            }

            if (recherche) {
                query += ` AND p.nom_produit ILIKE $${paramIndex}`;
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            switch (tri) {
                case 'prix_asc':
                    query += ` ORDER BY p.prix_produit ASC`;
                    break;
                case 'prix_desc':
                    query += ` ORDER BY p.prix_produit DESC`;
                    break;
                case 'nom_desc':
                    query += ` ORDER BY p.nom_produit DESC`;
                    break;
                default:
                    query += ` ORDER BY p.nom_produit ASC`;
            }

            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await db.query(query, params);

            const produits = result.rows.map(produit => ({
                ...produit,
                prix_produit: parseFloat(produit.prix_produit),
                donnees_produit: produit.donnees_produit || {}
            }));

            const countResult = await db.query(
                `SELECT COUNT(*) as total 
                 FROM PRODUITSINDIVIDUELRESTAURANT 
                 WHERE id_restaurant_fast_food_emplacement = $1`,
                [emplacementId]
            );

            res.json({
                success: true,
                data: produits,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(countResult.rows[0].total),
                    pages: Math.ceil(parseInt(countResult.rows[0].total) / limit)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer un produit par ID
     * GET /api/v1/restauration/produits/:id
     */
    static async getById(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT 
                    p.*,
                    erf.nom_emplacement,
                    erf.adresse_complete,
                    rf.nom_restaurant_fast_food,
                    rf.logo_restaurant,
                    (
                        SELECT json_agg(json_build_object(
                            'id', pr.id,
                            'nom', pr.nom_promo,
                            'type', pr.type_promo,
                            'reduction_pourcentage', pr.pourcentage_reduction,
                            'reduction_fixe', pr.montant_fixe_reduction,
                            'date_fin', pr.date_fin_promo
                        ))
                        FROM PROMOSPRODUITS pp
                        JOIN PROMOSRESTAURANTFASTFOOD pr ON pr.id = pp.promo_id
                        WHERE pp.produit_id = p.id
                          AND pr.actif = true
                          AND pr.date_debut_promo <= NOW()
                          AND pr.date_fin_promo >= NOW()
                    ) as promos_actives,
                    (
                        SELECT AVG(note_globale)::numeric(10,2)
                        FROM AVIS 
                        WHERE entite_type = 'PRODUIT_BOUTIQUE' 
                          AND entite_id = p.id 
                          AND statut = 'PUBLIE'
                    ) as note_moyenne
                FROM PRODUITSINDIVIDUELRESTAURANT p
                JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = p.id_restaurant_fast_food_emplacement
                JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
                WHERE p.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Produit non trouvé', 404);
            }

            const produit = result.rows[0];
            
            produit.prix_produit = parseFloat(produit.prix_produit);
            produit.donnees_produit = produit.donnees_produit || {};
            if (produit.note_moyenne) {
                produit.note_moyenne = parseFloat(produit.note_moyenne);
            }

            res.json({
                success: true,
                data: produit
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Créer un nouveau produit
     * POST /api/v1/restauration/emplacements/:emplacementId/produits
     */
    static async create(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { emplacementId } = req.params;
            const {
                nom_produit,
                description_produit,
                photo_produit,
                donnees_produit,
                prix_produit,
                stock_disponible,
                categorie_produit,
                est_journalier
            } = req.body;

            // Vérifier que l'emplacement existe
            const emplacementExists = await client.query(
                `SELECT id FROM EMPLACEMENTSRESTAURANTFASTFOOD WHERE id = $1`,
                [emplacementId]
            );

            if (emplacementExists.rows.length === 0) {
                throw new AppError('Emplacement non trouvé', 404);
            }

            // Vérifier si un produit avec le même nom existe déjà
            const existing = await client.query(
                `SELECT id FROM PRODUITSINDIVIDUELRESTAURANT 
                 WHERE id_restaurant_fast_food_emplacement = $1 AND nom_produit = $2`,
                [emplacementId, nom_produit]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError('Un produit avec ce nom existe déjà dans cet emplacement');
            }

            // Valider le prix
            if (prix_produit <= 0) {
                throw new ValidationError('Le prix doit être supérieur à 0');
            }

            const result = await client.query(
                `INSERT INTO PRODUITSINDIVIDUELRESTAURANT (
                    nom_produit,
                    description_produit,
                    photo_produit,
                    donnees_produit,
                    prix_produit,
                    stock_disponible,
                    categorie_produit,
                    est_journalier,
                    disponible,
                    id_restaurant_fast_food_emplacement,
                    date_creation,
                    date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, NOW(), NOW())
                RETURNING *`,
                [
                    nom_produit,
                    description_produit,
                    photo_produit,
                    JSON.stringify(donnees_produit || {}),
                    prix_produit,
                    stock_disponible || -1,
                    categorie_produit || 'ALIMENTAIRE',
                    est_journalier !== false,
                    emplacementId
                ]
            );

            const newProduit = result.rows[0];

            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'PRODUITSINDIVIDUELRESTAURANT',
                ressource_id: newProduit.id,
                donnees_apres: newProduit,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Produit créé avec succès',
                data: newProduit
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour un produit
     * PUT /api/v1/restauration/produits/:id
     */
    static async update(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const {
                nom_produit,
                description_produit,
                photo_produit,
                donnees_produit,
                prix_produit,
                stock_disponible,
                categorie_produit,
                est_journalier,
                disponible
            } = req.body;

            const currentResult = await client.query(
                `SELECT * FROM PRODUITSINDIVIDUELRESTAURANT WHERE id = $1`,
                [id]
            );

            if (currentResult.rows.length === 0) {
                throw new AppError('Produit non trouvé', 404);
            }

            const current = currentResult.rows[0];

            // Vérifier unicité du nom si modifié
            if (nom_produit && nom_produit !== current.nom_produit) {
                const existing = await client.query(
                    `SELECT id FROM PRODUITSINDIVIDUELRESTAURANT 
                     WHERE id_restaurant_fast_food_emplacement = $1 AND nom_produit = $2 AND id != $3`,
                    [current.id_restaurant_fast_food_emplacement, nom_produit, id]
                );
                if (existing.rows.length > 0) {
                    throw new ValidationError('Un produit avec ce nom existe déjà dans cet emplacement');
                }
            }

            // Valider le prix
            if (prix_produit && prix_produit <= 0) {
                throw new ValidationError('Le prix doit être supérieur à 0');
            }

            let updates = [];
            let params = [];
            let paramIndex = 1;

            if (nom_produit) {
                updates.push(`nom_produit = $${paramIndex++}`);
                params.push(nom_produit);
            }

            if (description_produit !== undefined) {
                updates.push(`description_produit = $${paramIndex++}`);
                params.push(description_produit);
            }

            if (photo_produit !== undefined) {
                updates.push(`photo_produit = $${paramIndex++}`);
                params.push(photo_produit);
            }

            if (donnees_produit) {
                updates.push(`donnees_produit = $${paramIndex++}`);
                params.push(JSON.stringify(donnees_produit));
            }

            if (prix_produit) {
                updates.push(`prix_produit = $${paramIndex++}`);
                params.push(prix_produit);
            }

            if (stock_disponible !== undefined) {
                updates.push(`stock_disponible = $${paramIndex++}`);
                params.push(stock_disponible);
            }

            if (categorie_produit) {
                updates.push(`categorie_produit = $${paramIndex++}`);
                params.push(categorie_produit);
            }

            if (est_journalier !== undefined) {
                updates.push(`est_journalier = $${paramIndex++}`);
                params.push(est_journalier);
            }

            if (disponible !== undefined) {
                updates.push(`disponible = $${paramIndex++}`);
                params.push(disponible);
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
                UPDATE PRODUITSINDIVIDUELRESTAURANT 
                SET ${updates.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING *
            `;

            const result = await client.query(updateQuery, params);

            const updated = result.rows[0];

            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'PRODUITSINDIVIDUELRESTAURANT',
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
                message: 'Produit mis à jour avec succès',
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
     * Upload de photo pour un produit
     * POST /api/v1/restauration/produits/:id/photo
     */
    static async uploadPhoto(req, res, next) {
        const client = await db.getConnection();
        try {
            const { id } = req.params;

            if (!req.file) {
                throw new ValidationError('Aucun fichier fourni');
            }

            const fileResult = await FileService.upload(req.file, {
                folder: 'produits-restaurant',
                entityId: id,
                resize: true,
                sizes: [
                    { width: 200, height: 200, suffix: 'small' },
                    { width: 400, height: 400, suffix: 'medium' },
                    { width: 800, height: 800, suffix: 'large' }
                ],
                formats: ['webp', 'jpg']
            });

            await client.query(
                `UPDATE PRODUITSINDIVIDUELRESTAURANT 
                 SET photo_produit = $1, date_mise_a_jour = NOW()
                 WHERE id = $2`,
                [fileResult.url, id]
            );

            res.json({
                success: true,
                message: 'Photo uploadée avec succès',
                data: fileResult
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour le stock d'un produit
     * PATCH /api/v1/restauration/produits/:id/stock
     */
    static async updateStock(req, res, next) {
        const client = await db.getConnection();
        try {
            const { id } = req.params;
            const { operation, quantite } = req.body;

            if (!['incrementer', 'decrementer', 'fixer'].includes(operation)) {
                throw new ValidationError('Opération invalide');
            }

            if (!quantite || quantite < 0) {
                throw new ValidationError('Quantité invalide');
            }

            let query;
            if (operation === 'incrementer') {
                query = `
                    UPDATE PRODUITSINDIVIDUELRESTAURANT 
                    SET stock_disponible = 
                        CASE 
                            WHEN stock_disponible = -1 THEN -1
                            ELSE stock_disponible + $1
                        END,
                        date_mise_a_jour = NOW()
                    WHERE id = $2
                    RETURNING *
                `;
            } else if (operation === 'decrementer') {
                query = `
                    UPDATE PRODUITSINDIVIDUELRESTAURANT 
                    SET stock_disponible = 
                        CASE 
                            WHEN stock_disponible = -1 THEN -1
                            ELSE GREATEST(0, stock_disponible - $1)
                        END,
                        date_mise_a_jour = NOW()
                    WHERE id = $2
                    RETURNING *
                `;
            } else {
                query = `
                    UPDATE PRODUITSINDIVIDUELRESTAURANT 
                    SET stock_disponible = $1,
                        date_mise_a_jour = NOW()
                    WHERE id = $2
                    RETURNING *
                `;
            }

            const result = await client.query(query, [quantite, id]);

            if (result.rows.length === 0) {
                throw new AppError('Produit non trouvé', 404);
            }

            const produit = result.rows[0];

            // Vérifier si le stock est épuisé et désactiver si nécessaire
            if (produit.stock_disponible === 0 && produit.disponible) {
                await client.query(
                    `UPDATE PRODUITSINDIVIDUELRESTAURANT 
                     SET disponible = false
                     WHERE id = $1`,
                    [id]
                );
                produit.disponible = false;
            }

            res.json({
                success: true,
                message: 'Stock mis à jour avec succès',
                data: {
                    id: produit.id,
                    stock_disponible: produit.stock_disponible,
                    disponible: produit.disponible
                }
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les produits par catégorie
     * GET /api/v1/restauration/emplacements/:emplacementId/produits/par-categorie
     */
    static async getByCategory(req, res, next) {
        try {
            const { emplacementId } = req.params;

            const result = await db.query(
                `SELECT 
                    p.categorie_produit,
                    json_agg(json_build_object(
                        'id', p.id,
                        'nom', p.nom_produit,
                        'description', p.description_produit,
                        'prix', p.prix_produit,
                        'photo', p.photo_produit,
                        'donnees', p.donnees_produit,
                        'disponible', p.disponible,
                        'stock', p.stock_disponible
                    ) ORDER BY p.prix_produit) as produits
                FROM PRODUITSINDIVIDUELRESTAURANT p
                WHERE p.id_restaurant_fast_food_emplacement = $1
                  AND p.disponible = true
                GROUP BY p.categorie_produit
                ORDER BY p.categorie_produit`,
                [emplacementId]
            );

            // Compter le total par catégorie
            const countResult = await db.query(
                `SELECT 
                    categorie_produit,
                    COUNT(*) as total
                FROM PRODUITSINDIVIDUELRESTAURANT
                WHERE id_restaurant_fast_food_emplacement = $1
                  AND disponible = true
                GROUP BY categorie_produit`,
                [emplacementId]
            );

            const categories = result.rows.map(row => ({
                categorie: row.categorie_produit,
                produits: row.produits,
                total: countResult.rows.find(c => c.categorie_produit === row.categorie_produit)?.total || 0
            }));

            res.json({
                success: true,
                data: categories
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Recherche de produits
     * GET /api/v1/restauration/produits/recherche
     */
    static async search(req, res, next) {
        try {
            const {
                q,
                categorie,
                prix_min,
                prix_max,
                disponible,
                emplacement_id,
                limit = 20
            } = req.query;

            let query = `
                SELECT 
                    p.id, 
                    p.nom_produit,
                    p.description_produit,
                    p.photo_produit,
                    p.prix_produit,
                    p.categorie_produit,
                    p.disponible,
                    p.donnees_produit,
                    erf.nom_emplacement,
                    rf.nom_restaurant_fast_food
                FROM PRODUITSINDIVIDUELRESTAURANT p
                JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = p.id_restaurant_fast_food_emplacement
                JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            if (q) {
                query += ` AND (p.nom_produit ILIKE $${paramIndex} OR p.description_produit ILIKE $${paramIndex})`;
                params.push(`%${q}%`);
                paramIndex++;
            }

            if (categorie) {
                query += ` AND p.categorie_produit = $${paramIndex}`;
                params.push(categorie);
                paramIndex++;
            }

            if (prix_min) {
                query += ` AND p.prix_produit >= $${paramIndex}`;
                params.push(prix_min);
                paramIndex++;
            }

            if (prix_max) {
                query += ` AND p.prix_produit <= $${paramIndex}`;
                params.push(prix_max);
                paramIndex++;
            }

            if (disponible !== undefined) {
                query += ` AND p.disponible = $${paramIndex}`;
                params.push(disponible === 'true');
                paramIndex++;
            }

            if (emplacement_id) {
                query += ` AND p.id_restaurant_fast_food_emplacement = $${paramIndex}`;
                params.push(emplacement_id);
                paramIndex++;
            }

            query += ` ORDER BY p.nom_produit LIMIT $${paramIndex}`;
            params.push(limit);

            const result = await db.query(query, params);

            const produits = result.rows.map(p => ({
                ...p,
                prix_produit: parseFloat(p.prix_produit),
                donnees_produit: p.donnees_produit || {}
            }));

            res.json({
                success: true,
                data: produits,
                count: produits.length
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les statistiques des produits
     * GET /api/v1/restauration/produits/stats
     */
    static async getStats(req, res, next) {
        try {
            const { emplacementId } = req.query;

            let query = `
                SELECT 
                    COUNT(*) as total_produits,
                    COUNT(*) FILTER (WHERE disponible = true) as produits_disponibles,
                    COUNT(*) FILTER (WHERE disponible = false) as produits_indisponibles,
                    AVG(prix_produit)::numeric(10,2) as prix_moyen,
                    MIN(prix_produit) as prix_min,
                    MAX(prix_produit) as prix_max,
                    COUNT(DISTINCT categorie_produit) as nombre_categories,
                    SUM(CASE WHEN stock_disponible = 0 THEN 1 ELSE 0 END) as produits_en_rupture,
                    SUM(CASE WHEN est_journalier THEN 1 ELSE 0 END) as produits_journaliers
            `;

            if (emplacementId) {
                query += ` FROM PRODUITSINDIVIDUELRESTAURANT 
                           WHERE id_restaurant_fast_food_emplacement = $1`;
            } else {
                query += ` FROM PRODUITSINDIVIDUELRESTAURANT`;
            }

            const result = emplacementId 
                ? await db.query(query, [emplacementId])
                : await db.query(query);

            // Statistiques par catégorie
            let categorieQuery = `
                SELECT 
                    categorie_produit,
                    COUNT(*) as total,
                    AVG(prix_produit)::numeric(10,2) as prix_moyen
                FROM PRODUITSINDIVIDUELRESTAURANT
            `;

            if (emplacementId) {
                categorieQuery += ` WHERE id_restaurant_fast_food_emplacement = $1`;
            }

            categorieQuery += ` GROUP BY categorie_produit ORDER BY categorie_produit`;

            const categoriesResult = emplacementId
                ? await db.query(categorieQuery, [emplacementId])
                : await db.query(categorieQuery);

            res.json({
                success: true,
                data: {
                    ...result.rows[0],
                    statistiques_par_categorie: categoriesResult.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Dupliquer un produit
     * POST /api/v1/restauration/produits/:id/dupliquer
     */
    static async duplicate(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { nouveau_nom } = req.body;

            // Récupérer le produit source
            const sourceResult = await client.query(
                `SELECT * FROM PRODUITSINDIVIDUELRESTAURANT WHERE id = $1`,
                [id]
            );

            if (sourceResult.rows.length === 0) {
                throw new AppError('Produit non trouvé', 404);
            }

            const source = sourceResult.rows[0];

            // Générer un nouveau nom si non fourni
            const nomDuplique = nouveau_nom || `${source.nom_produit} (copie)`;

            // Vérifier si le nom existe déjà
            const existing = await client.query(
                `SELECT id FROM PRODUITSINDIVIDUELRESTAURANT 
                 WHERE id_restaurant_fast_food_emplacement = $1 AND nom_produit = $2`,
                [source.id_restaurant_fast_food_emplacement, nomDuplique]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError('Un produit avec ce nom existe déjà');
            }

            // Créer la copie
            const result = await client.query(
                `INSERT INTO PRODUITSINDIVIDUELRESTAURANT (
                    nom_produit,
                    description_produit,
                    photo_produit,
                    donnees_produit,
                    prix_produit,
                    stock_disponible,
                    categorie_produit,
                    est_journalier,
                    disponible,
                    id_restaurant_fast_food_emplacement,
                    date_creation,
                    date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, NOW(), NOW())
                RETURNING *`,
                [
                    nomDuplique,
                    source.description_produit,
                    source.photo_produit,
                    source.donnees_produit,
                    source.prix_produit,
                    source.stock_disponible,
                    source.categorie_produit,
                    source.est_journalier,
                    source.id_restaurant_fast_food_emplacement
                ]
            );

            const newProduit = result.rows[0];

            await AuditService.log({
                action: 'DUPLICATE',
                ressource_type: 'PRODUITSINDIVIDUELRESTAURANT',
                ressource_id: newProduit.id,
                donnees_apres: newProduit,
                donnees_avant: { source_id: id },
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Produit dupliqué avec succès',
                data: {
                    nouveau_produit: newProduit,
                    source: {
                        id: source.id,
                        nom: source.nom_produit
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
     * Supprimer un produit
     * DELETE /api/v1/restauration/produits/:id
     */
    static async delete(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            // Vérifier si le produit est utilisé dans des commandes récentes
            const commandesResult = await client.query(
                `SELECT COUNT(*) as count 
                 FROM COMMANDESEMPLACEMENTFASTFOOD 
                 WHERE donnees_commande::text LIKE $1
                   AND date_commande >= NOW() - INTERVAL '30 days'`,
                [`%${id}%`]
            );

            if (parseInt(commandesResult.rows[0].count) > 0) {
                // Soft delete - juste désactiver
                await client.query(
                    `UPDATE PRODUITSINDIVIDUELRESTAURANT 
                     SET disponible = false, date_mise_a_jour = NOW()
                     WHERE id = $1`,
                    [id]
                );

                await client.query('COMMIT');

                return res.json({
                    success: true,
                    message: 'Produit désactivé avec succès (utilisé dans des commandes récentes)'
                });
            }

            // Supprimer la photo associée
            const produitResult = await client.query(
                `SELECT photo_produit FROM PRODUITSINDIVIDUELRESTAURANT WHERE id = $1`,
                [id]
            );

            if (produitResult.rows.length > 0 && produitResult.rows[0].photo_produit) {
                await FileService.delete(produitResult.rows[0].photo_produit).catch(console.error);
            }

            // Supprimer le produit
            const result = await client.query(
                `DELETE FROM PRODUITSINDIVIDUELRESTAURANT WHERE id = $1 RETURNING *`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Produit non trouvé', 404);
            }

            await AuditService.log({
                action: 'DELETE',
                ressource_type: 'PRODUITSINDIVIDUELRESTAURANT',
                ressource_id: id,
                donnees_avant: result.rows[0],
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Produit supprimé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mise à jour massive des prix
     * POST /api/v1/restauration/produits/mise-a-jour-massive
     */
    static async bulkUpdatePrices(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { emplacement_id, categorie, pourcentage_augmentation, montant_fixe } = req.body;

            if (!emplacement_id) {
                throw new ValidationError('ID de l\'emplacement requis');
            }

            if (!pourcentage_augmentation && !montant_fixe) {
                throw new ValidationError('Pourcentage ou montant fixe requis');
            }

            let query = `
                UPDATE PRODUITSINDIVIDUELRESTAURANT 
                SET prix_produit = 
            `;

            if (pourcentage_augmentation) {
                query += ` prix_produit * (1 + $1/100) `;
            } else {
                query += ` prix_produit + $1 `;
            }

            query += `, date_mise_a_jour = NOW()
                      WHERE id_restaurant_fast_food_emplacement = $2`;

            const params = [pourcentage_augmentation || montant_fixe, emplacement_id];

            if (categorie) {
                query += ` AND categorie_produit = $3`;
                params.push(categorie);
            }

            const result = await client.query(query, params);

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Prix mis à jour avec succès',
                data: {
                    produits_modifies: result.rowCount,
                    emplacement_id,
                    categorie: categorie || 'toutes'
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }
}

module.exports = ProduitRestaurantController;