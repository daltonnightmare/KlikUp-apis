const db = require('../../configuration/database');
const { AppError, ValidationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const FileService = require('../../services/file/FileService');

class MenuController {

    /**
     * Récupérer tous les menus de tous les restaurants
     * GET /api/v1/restauration/menus/all
     */
    static async getAllMenus(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                categorie,
                disponible,
                prix_min,
                prix_max,
                recherche,
                restaurant_id,
                emplacement_id,
                tri = 'nom_asc',
                avec_promos = false
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    m.id, 
                    m.nom_menu,
                    m.description_menu,
                    m.photo_menu,
                    m.photos_menu,
                    m.composition_menu,
                    m.prix_menu,
                    m.temps_preparation_min,
                    m.stock_disponible,
                    m.categorie_menu,
                    m.disponible,
                    m.est_journalier,
                    m.date_creation,
                    erf.id as emplacement_id,
                    erf.nom_emplacement,
                    erf.adresse_complete,
                    erf.frais_livraison,
                    rf.id as restaurant_id,
                    rf.nom_restaurant_fast_food,
                    rf.logo_restaurant
            `;

            // Ajouter les promos si demandé
            if (avec_promos === 'true') {
                query += `,
                    (
                        SELECT json_agg(json_build_object(
                            'id', pr.id,
                            'nom', pr.nom_promo,
                            'type', pr.type_promo,
                            'reduction_pourcentage', pr.pourcentage_reduction,
                            'reduction_fixe', pr.montant_fixe_reduction,
                            'date_fin', pr.date_fin_promo
                        ))
                        FROM PROMOSMENUS pm
                        JOIN PROMOSRESTAURANTFASTFOOD pr ON pr.id = pm.promo_id
                        WHERE pm.menu_id = m.id
                        AND pr.actif = true
                        AND pr.date_debut_promo <= NOW()
                        AND pr.date_fin_promo >= NOW()
                    ) as promos_actives
                `;
            }

            query += `
                FROM MENURESTAURANTFASTFOOD m
                JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = m.id_restaurant_fast_food_emplacement
                JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
                WHERE rf.est_supprime = false
            `;

            const params = [];
            let paramIndex = 1;

            // Filtres optionnels
            if (categorie) {
                query += ` AND m.categorie_menu = $${paramIndex}`;
                params.push(categorie);
                paramIndex++;
            }

            if (disponible !== undefined) {
                query += ` AND m.disponible = $${paramIndex}`;
                params.push(disponible === 'true');
                paramIndex++;
            }

            if (prix_min) {
                query += ` AND m.prix_menu >= $${paramIndex}`;
                params.push(parseFloat(prix_min));
                paramIndex++;
            }

            if (prix_max) {
                query += ` AND m.prix_menu <= $${paramIndex}`;
                params.push(parseFloat(prix_max));
                paramIndex++;
            }

            if (recherche) {
                query += ` AND (m.nom_menu ILIKE $${paramIndex} OR m.description_menu ILIKE $${paramIndex})`;
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            if (restaurant_id) {
                query += ` AND rf.id = $${paramIndex}`;
                params.push(parseInt(restaurant_id));
                paramIndex++;
            }

            if (emplacement_id) {
                query += ` AND erf.id = $${paramIndex}`;
                params.push(parseInt(emplacement_id));
                paramIndex++;
            }

            // Tri
            switch (tri) {
                case 'prix_asc':
                    query += ` ORDER BY m.prix_menu ASC`;
                    break;
                case 'prix_desc':
                    query += ` ORDER BY m.prix_menu DESC`;
                    break;
                case 'nom_desc':
                    query += ` ORDER BY m.nom_menu DESC`;
                    break;
                case 'restaurant_asc':
                    query += ` ORDER BY rf.nom_restaurant_fast_food ASC, m.nom_menu ASC`;
                    break;
                case 'recent_desc':
                    query += ` ORDER BY m.date_creation DESC`;
                    break;
                default:
                    query += ` ORDER BY rf.nom_restaurant_fast_food ASC, m.nom_menu ASC`;
            }

            // Pagination
            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            // Exécuter la requête principale
            const result = await db.query(query, params);

            // Traiter les résultats
            const menus = result.rows.map(menu => {
                const processed = {
                    ...menu,
                    prix_menu: parseFloat(menu.prix_menu),
                    photos_menu: menu.photos_menu || [],
                    composition_menu: menu.composition_menu || []
                };

                // Parser les promos si présentes
                if (menu.promos_actives && typeof menu.promos_actives === 'string') {
                    try {
                        processed.promos_actives = JSON.parse(menu.promos_actives);
                    } catch (e) {
                        processed.promos_actives = [];
                    }
                }

                // Calculer le prix avec promo si applicable
                if (processed.promos_actives && processed.promos_actives.length > 0) {
                    const promo = processed.promos_actives[0];
                    if (promo.type_promo === 'POURCENTAGE' && promo.reduction_pourcentage) {
                        processed.prix_avec_promo = processed.prix_menu * (1 - promo.reduction_pourcentage / 100);
                    } else if (promo.type_promo === 'MONTANT_FIXE' && promo.reduction_fixe) {
                        processed.prix_avec_promo = Math.max(0, processed.prix_menu - promo.reduction_fixe);
                    }
                }

                return processed;
            });

            // Compter le total pour la pagination
            let countQuery = `
                SELECT COUNT(*) as total 
                FROM MENURESTAURANTFASTFOOD m
                JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = m.id_restaurant_fast_food_emplacement
                JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
                WHERE rf.est_supprime = false
            `;

            // Réappliquer les mêmes filtres pour le count
            const countParams = [];
            let countParamIndex = 1;

            if (categorie) {
                countQuery += ` AND m.categorie_menu = $${countParamIndex}`;
                countParams.push(categorie);
                countParamIndex++;
            }

            if (disponible !== undefined) {
                countQuery += ` AND m.disponible = $${countParamIndex}`;
                countParams.push(disponible === 'true');
                countParamIndex++;
            }

            if (prix_min) {
                countQuery += ` AND m.prix_menu >= $${countParamIndex}`;
                countParams.push(parseFloat(prix_min));
                countParamIndex++;
            }

            if (prix_max) {
                countQuery += ` AND m.prix_menu <= $${countParamIndex}`;
                countParams.push(parseFloat(prix_max));
                countParamIndex++;
            }

            if (recherche) {
                countQuery += ` AND (m.nom_menu ILIKE $${countParamIndex} OR m.description_menu ILIKE $${countParamIndex})`;
                countParams.push(`%${recherche}%`);
                countParamIndex++;
            }

            if (restaurant_id) {
                countQuery += ` AND rf.id = $${countParamIndex}`;
                countParams.push(parseInt(restaurant_id));
                countParamIndex++;
            }

            if (emplacement_id) {
                countQuery += ` AND erf.id = $${countParamIndex}`;
                countParams.push(parseInt(emplacement_id));
                countParamIndex++;
            }

            const countResult = await db.query(countQuery, countParams);

            res.json({
                success: true,
                data: menus,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(countResult.rows[0].total),
                    pages: Math.ceil(parseInt(countResult.rows[0].total) / limit)
                },
                filters: {
                    appliques: {
                        categorie: categorie || null,
                        disponible: disponible || null,
                        prix_min: prix_min || null,
                        prix_max: prix_max || null,
                        recherche: recherche || null,
                        restaurant_id: restaurant_id || null,
                        emplacement_id: emplacement_id || null
                    }
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les menus groupés par restaurant
     * GET /api/v1/restauration/menus/by-restaurant
     */
    static async getMenusByRestaurant(req, res, next) {
        try {
            const {
                limit_par_restaurant = 10,
                categorie,
                disponible = 'true'
            } = req.query;

            const query = `
                SELECT 
                    rf.id as restaurant_id,
                    rf.nom_restaurant_fast_food,
                    rf.logo_restaurant,
                    (
                        SELECT json_agg(json_build_object(
                            'id', m.id,
                            'nom', m.nom_menu,
                            'description', m.description_menu,
                            'photo', m.photo_menu,
                            'prix', m.prix_menu,
                            'categorie', m.categorie_menu,
                            'temps_preparation', m.temps_preparation_min,
                            'emplacement_id', erf.id,
                            'emplacement_nom', erf.nom_emplacement
                        ) ORDER BY m.prix_menu)
                        FROM (
                            SELECT DISTINCT m.*, erf.nom_emplacement
                            FROM MENURESTAURANTFASTFOOD m
                            JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = m.id_restaurant_fast_food_emplacement
                            WHERE erf.id_restaurant_fast_food = rf.id
                            AND m.disponible = CASE WHEN $1 = 'true' THEN true ELSE m.disponible END
                            AND ($2 IS NULL OR m.categorie_menu = $2)
                            ORDER BY m.prix_menu
                            LIMIT $3
                        ) m
                    ) as menus
                FROM RESTAURANTSFASTFOOD rf
                WHERE rf.est_actif = true AND rf.est_supprime = false
                ORDER BY rf.nom_restaurant_fast_food
            `;

            const result = await db.query(query, [
                disponible,
                categorie || null,
                parseInt(limit_par_restaurant)
            ]);

            // Filtrer les restaurants qui ont des menus
            const restaurantsAvecMenus = result.rows
                .filter(r => r.menus && r.menus.length > 0)
                .map(r => ({
                    ...r,
                    menus: r.menus.map(m => ({
                        ...m,
                        prix: parseFloat(m.prix)
                    }))
                }));

            res.json({
                success: true,
                data: restaurantsAvecMenus,
                total_restaurants: restaurantsAvecMenus.length
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer tous les menus d'un emplacement
     * GET /api/v1/restauration/emplacements/:emplacementId/menus
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
                    m.id, 
                    m.nom_menu,
                    m.description_menu,
                    m.photo_menu,
                    m.photos_menu,
                    m.composition_menu,
                    m.prix_menu,
                    m.temps_preparation_min,
                    m.stock_disponible,
                    m.categorie_menu,
                    m.disponible,
                    m.est_journalier,
                    m.date_creation,
                    erf.nom_emplacement
                FROM MENURESTAURANTFASTFOOD m
                JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = m.id_restaurant_fast_food_emplacement
                WHERE m.id_restaurant_fast_food_emplacement = $1
            `;

            const params = [emplacementId];
            let paramIndex = 2;

            if (categorie) {
                query += ` AND m.categorie_menu = $${paramIndex}`;
                params.push(categorie);
                paramIndex++;
            }

            if (disponible !== undefined) {
                query += ` AND m.disponible = $${paramIndex}`;
                params.push(disponible === 'true');
                paramIndex++;
            }

            if (prix_min) {
                query += ` AND m.prix_menu >= $${paramIndex}`;
                params.push(prix_min);
                paramIndex++;
            }

            if (prix_max) {
                query += ` AND m.prix_menu <= $${paramIndex}`;
                params.push(prix_max);
                paramIndex++;
            }

            if (recherche) {
                query += ` AND m.nom_menu ILIKE $${paramIndex}`;
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            switch (tri) {
                case 'prix_asc':
                    query += ` ORDER BY m.prix_menu ASC`;
                    break;
                case 'prix_desc':
                    query += ` ORDER BY m.prix_menu DESC`;
                    break;
                case 'nom_desc':
                    query += ` ORDER BY m.nom_menu DESC`;
                    break;
                default:
                    query += ` ORDER BY m.nom_menu ASC`;
            }

            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await db.query(query, params);

            const menus = result.rows.map(menu => ({
                ...menu,
                prix_menu: parseFloat(menu.prix_menu),
                photos_menu: menu.photos_menu || [],
                composition_menu: menu.composition_menu || []
            }));

            const countResult = await db.query(
                `SELECT COUNT(*) as total 
                 FROM MENURESTAURANTFASTFOOD 
                 WHERE id_restaurant_fast_food_emplacement = $1`,
                [emplacementId]
            );

            res.json({
                success: true,
                data: menus,
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
     * Récupérer un menu par ID
     * GET /api/v1/restauration/menus/:id
     */
    static async getById(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT 
                    m.*,
                    erf.nom_emplacement,
                    erf.adresse_complete,
                    erf.frais_livraison,
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
                        FROM PROMOSMENUS pm
                        JOIN PROMOSRESTAURANTFASTFOOD pr ON pr.id = pm.promo_id
                        WHERE pm.menu_id = m.id
                          AND pr.actif = true
                          AND pr.date_debut_promo <= NOW()
                          AND pr.date_fin_promo >= NOW()
                    ) as promos_actives,
                    (
                        SELECT AVG(note_globale)::numeric(10,2)
                        FROM AVIS 
                        WHERE entite_type = 'MENU' 
                          AND entite_id = m.id 
                          AND statut = 'PUBLIE'
                    ) as note_moyenne
                FROM MENURESTAURANTFASTFOOD m
                JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = m.id_restaurant_fast_food_emplacement
                JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
                WHERE m.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Menu non trouvé', 404);
            }

            const menu = result.rows[0];
            
            // Parser les JSON
            menu.photos_menu = menu.photos_menu || [];
            menu.composition_menu = menu.composition_menu || [];
            menu.prix_menu = parseFloat(menu.prix_menu);
            if (menu.note_moyenne) {
                menu.note_moyenne = parseFloat(menu.note_moyenne);
            }

            res.json({
                success: true,
                data: menu
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Créer un nouveau menu
     * POST /api/v1/restauration/emplacements/:emplacementId/menus
     */
    static async create(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { emplacementId } = req.params;
            const {
                nom_menu,
                description_menu,
                photo_menu,
                photos_menu,
                composition_menu,
                prix_menu,
                temps_preparation_min,
                stock_disponible,
                categorie_menu,
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

            // Vérifier si un menu avec le même nom existe déjà dans cet emplacement
            const existing = await client.query(
                `SELECT id FROM MENURESTAURANTFASTFOOD 
                 WHERE id_restaurant_fast_food_emplacement = $1 AND nom_menu = $2`,
                [emplacementId, nom_menu]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError('Un menu avec ce nom existe déjà dans cet emplacement');
            }

            // Valider le prix
            if (prix_menu <= 0) {
                throw new ValidationError('Le prix doit être supérieur à 0');
            }

            // Valider le temps de préparation
            if (temps_preparation_min && temps_preparation_min <= 0) {
                throw new ValidationError('Le temps de préparation doit être supérieur à 0');
            }

            const result = await client.query(
                `INSERT INTO MENURESTAURANTFASTFOOD (
                    nom_menu,
                    description_menu,
                    photo_menu,
                    photos_menu,
                    composition_menu,
                    prix_menu,
                    temps_preparation_min,
                    stock_disponible,
                    categorie_menu,
                    est_journalier,
                    disponible,
                    id_restaurant_fast_food_emplacement,
                    date_creation,
                    date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, NOW(), NOW())
                RETURNING *`,
                [
                    nom_menu,
                    description_menu,
                    photo_menu,
                    JSON.stringify(photos_menu || []),
                    JSON.stringify(composition_menu || []),
                    prix_menu,
                    temps_preparation_min || 15,
                    stock_disponible || -1,
                    categorie_menu,
                    est_journalier !== false,
                    emplacementId
                ]
            );

            const newMenu = result.rows[0];

            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'MENURESTAURANTFASTFOOD',
                ressource_id: newMenu.id,
                donnees_apres: newMenu,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Menu créé avec succès',
                data: newMenu
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour un menu
     * PUT /api/v1/restauration/menus/:id
     */
    static async update(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const {
                nom_menu,
                description_menu,
                photo_menu,
                photos_menu,
                composition_menu,
                prix_menu,
                temps_preparation_min,
                stock_disponible,
                categorie_menu,
                est_journalier,
                disponible
            } = req.body;

            const currentResult = await client.query(
                `SELECT * FROM MENURESTAURANTFASTFOOD WHERE id = $1`,
                [id]
            );

            if (currentResult.rows.length === 0) {
                throw new AppError('Menu non trouvé', 404);
            }

            const current = currentResult.rows[0];

            // Vérifier unicité du nom si modifié
            if (nom_menu && nom_menu !== current.nom_menu) {
                const existing = await client.query(
                    `SELECT id FROM MENURESTAURANTFASTFOOD 
                     WHERE id_restaurant_fast_food_emplacement = $1 AND nom_menu = $2 AND id != $3`,
                    [current.id_restaurant_fast_food_emplacement, nom_menu, id]
                );
                if (existing.rows.length > 0) {
                    throw new ValidationError('Un menu avec ce nom existe déjà dans cet emplacement');
                }
            }

            // Valider le prix
            if (prix_menu && prix_menu <= 0) {
                throw new ValidationError('Le prix doit être supérieur à 0');
            }

            let updates = [];
            let params = [];
            let paramIndex = 1;

            if (nom_menu) {
                updates.push(`nom_menu = $${paramIndex++}`);
                params.push(nom_menu);
            }

            if (description_menu !== undefined) {
                updates.push(`description_menu = $${paramIndex++}`);
                params.push(description_menu);
            }

            if (photo_menu !== undefined) {
                updates.push(`photo_menu = $${paramIndex++}`);
                params.push(photo_menu);
            }

            if (photos_menu) {
                updates.push(`photos_menu = $${paramIndex++}`);
                params.push(JSON.stringify(photos_menu));
            }

            if (composition_menu) {
                updates.push(`composition_menu = $${paramIndex++}`);
                params.push(JSON.stringify(composition_menu));
            }

            if (prix_menu) {
                updates.push(`prix_menu = $${paramIndex++}`);
                params.push(prix_menu);
            }

            if (temps_preparation_min) {
                updates.push(`temps_preparation_min = $${paramIndex++}`);
                params.push(temps_preparation_min);
            }

            if (stock_disponible !== undefined) {
                updates.push(`stock_disponible = $${paramIndex++}`);
                params.push(stock_disponible);
            }

            if (categorie_menu) {
                updates.push(`categorie_menu = $${paramIndex++}`);
                params.push(categorie_menu);
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
                UPDATE MENURESTAURANTFASTFOOD 
                SET ${updates.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING *
            `;

            const result = await client.query(updateQuery, params);

            const updated = result.rows[0];

            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'MENURESTAURANTFASTFOOD',
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
                message: 'Menu mis à jour avec succès',
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
     * Upload de photo pour un menu
     * POST /api/v1/restauration/menus/:id/photo
     */
    static async uploadPhoto(req, res, next) {
        const client = await db.getConnection();
        try {
            const { id } = req.params;

            if (!req.file) {
                throw new ValidationError('Aucun fichier fourni');
            }

            const fileResult = await FileService.upload(req.file, {
                folder: 'menus',
                entityId: id,
                resize: true,
                sizes: [
                    { width: 300, height: 300, suffix: 'small' },
                    { width: 600, height: 600, suffix: 'medium' },
                    { width: 1200, height: 800, suffix: 'large' }
                ],
                formats: ['webp', 'jpg']
            });

            // Récupérer les photos existantes
            const current = await client.query(
                `SELECT photos_menu FROM MENURESTAURANTFASTFOOD WHERE id = $1`,
                [id]
            );

            let photos = current.rows[0]?.photos_menu || [];
            if (typeof photos === 'string') {
                photos = JSON.parse(photos);
            }
            
            // Ajouter la nouvelle photo
            photos.push(fileResult.url);

            await client.query(
                `UPDATE MENURESTAURANTFASTFOOD 
                 SET photo_menu = COALESCE(photo_menu, $1),
                     photos_menu = $2,
                     date_mise_a_jour = NOW()
                 WHERE id = $3`,
                [fileResult.url, JSON.stringify(photos), id]
            );

            res.json({
                success: true,
                message: 'Photo uploadée avec succès',
                data: {
                    ...fileResult,
                    toutes_photos: photos
                }
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer une photo d'un menu
     * DELETE /api/v1/restauration/menus/:id/photo
     */
    static async deletePhoto(req, res, next) {
        const client = await db.getConnection();
        try {
            const { id } = req.params;
            const { photo_url } = req.body;

            if (!photo_url) {
                throw new ValidationError('URL de la photo requis');
            }

            const current = await client.query(
                `SELECT photos_menu, photo_menu FROM MENURESTAURANTFASTFOOD WHERE id = $1`,
                [id]
            );

            if (current.rows.length === 0) {
                throw new AppError('Menu non trouvé', 404);
            }

            let photos = current.rows[0].photos_menu || [];
            if (typeof photos === 'string') {
                photos = JSON.parse(photos);
            }

            // Filtrer pour enlever la photo
            photos = photos.filter(p => p !== photo_url);

            // Si c'était la photo principale, la remplacer
            let newPhotoPrincipale = current.rows[0].photo_menu;
            if (newPhotoPrincipale === photo_url) {
                newPhotoPrincipale = photos.length > 0 ? photos[0] : null;
            }

            await client.query(
                `UPDATE MENURESTAURANTFASTFOOD 
                 SET photos_menu = $1,
                     photo_menu = $2,
                     date_mise_a_jour = NOW()
                 WHERE id = $3`,
                [JSON.stringify(photos), newPhotoPrincipale, id]
            );

            // Supprimer le fichier physiquement
            await FileService.delete(photo_url);

            res.json({
                success: true,
                message: 'Photo supprimée avec succès',
                data: {
                    photos_restantes: photos,
                    photo_principale: newPhotoPrincipale
                }
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour le stock d'un menu
     * PATCH /api/v1/restauration/menus/:id/stock
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
                    UPDATE MENURESTAURANTFASTFOOD 
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
                    UPDATE MENURESTAURANTFASTFOOD 
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
                    UPDATE MENURESTAURANTFASTFOOD 
                    SET stock_disponible = $1,
                        date_mise_a_jour = NOW()
                    WHERE id = $2
                    RETURNING *
                `;
            }

            const result = await client.query(query, [quantite, id]);

            if (result.rows.length === 0) {
                throw new AppError('Menu non trouvé', 404);
            }

            const menu = result.rows[0];

            // Vérifier si le stock est épuisé et désactiver si nécessaire
            if (menu.stock_disponible === 0 && menu.disponible) {
                await client.query(
                    `UPDATE MENURESTAURANTFASTFOOD 
                     SET disponible = false
                     WHERE id = $1`,
                    [id]
                );
                menu.disponible = false;
            }

            res.json({
                success: true,
                message: 'Stock mis à jour avec succès',
                data: {
                    id: menu.id,
                    stock_disponible: menu.stock_disponible,
                    disponible: menu.disponible
                }
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les menus par catégorie
     * GET /api/v1/restauration/emplacements/:emplacementId/menus/par-categorie
     */
    static async getByCategory(req, res, next) {
        try {
            const { emplacementId } = req.params;

            const result = await db.query(
                `SELECT 
                    m.categorie_menu,
                    json_agg(json_build_object(
                        'id', m.id,
                        'nom', m.nom_menu,
                        'description', m.description_menu,
                        'prix', m.prix_menu,
                        'photo', m.photo_menu,
                        'temps_preparation', m.temps_preparation_min,
                        'disponible', m.disponible,
                        'stock', m.stock_disponible
                    ) ORDER BY m.prix_menu) as menus
                FROM MENURESTAURANTFASTFOOD m
                WHERE m.id_restaurant_fast_food_emplacement = $1
                  AND m.disponible = true
                GROUP BY m.categorie_menu
                ORDER BY m.categorie_menu`,
                [emplacementId]
            );

            // Compter le total par catégorie
            const countResult = await db.query(
                `SELECT 
                    categorie_menu,
                    COUNT(*) as total
                FROM MENURESTAURANTFASTFOOD
                WHERE id_restaurant_fast_food_emplacement = $1
                  AND disponible = true
                GROUP BY categorie_menu`,
                [emplacementId]
            );

            const categories = result.rows.map(row => ({
                categorie: row.categorie_menu,
                menus: row.menus,
                total: countResult.rows.find(c => c.categorie_menu === row.categorie_menu)?.total || 0
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
     * Récupérer les statistiques des menus
     * GET /api/v1/restauration/menus/stats
     */
    static async getStats(req, res, next) {
        try {
            const { emplacementId } = req.query;

            let query = `
                SELECT 
                    COUNT(*) as total_menus,
                    COUNT(*) FILTER (WHERE disponible = true) as menus_disponibles,
                    COUNT(*) FILTER (WHERE disponible = false) as menus_indisponibles,
                    AVG(prix_menu)::numeric(10,2) as prix_moyen,
                    MIN(prix_menu) as prix_min,
                    MAX(prix_menu) as prix_max,
                    COUNT(DISTINCT categorie_menu) as nombre_categories,
                    SUM(CASE WHEN stock_disponible = 0 THEN 1 ELSE 0 END) as menus_en_rupture,
                    SUM(CASE WHEN est_journalier THEN 1 ELSE 0 END) as menus_journaliers
            `;

            if (emplacementId) {
                query += ` FROM MENURESTAURANTFASTFOOD 
                           WHERE id_restaurant_fast_food_emplacement = $1`;
            } else {
                query += ` FROM MENURESTAURANTFASTFOOD`;
            }

            const result = emplacementId 
                ? await db.query(query, [emplacementId])
                : await db.query(query);

            // Statistiques par catégorie
            let categorieQuery = `
                SELECT 
                    categorie_menu,
                    COUNT(*) as total,
                    AVG(prix_menu)::numeric(10,2) as prix_moyen
                FROM MENURESTAURANTFASTFOOD
            `;

            if (emplacementId) {
                categorieQuery += ` WHERE id_restaurant_fast_food_emplacement = $1`;
            }

            categorieQuery += ` GROUP BY categorie_menu ORDER BY categorie_menu`;

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
     * Dupliquer un menu
     * POST /api/v1/restauration/menus/:id/dupliquer
     */
    static async duplicate(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { nouveau_nom } = req.body;

            // Récupérer le menu source
            const sourceResult = await client.query(
                `SELECT * FROM MENURESTAURANTFASTFOOD WHERE id = $1`,
                [id]
            );

            if (sourceResult.rows.length === 0) {
                throw new AppError('Menu non trouvé', 404);
            }

            const source = sourceResult.rows[0];

            // Générer un nouveau nom si non fourni
            const nomDuplique = nouveau_nom || `${source.nom_menu} (copie)`;

            // Vérifier si le nom existe déjà
            const existing = await client.query(
                `SELECT id FROM MENURESTAURANTFASTFOOD 
                 WHERE id_restaurant_fast_food_emplacement = $1 AND nom_menu = $2`,
                [source.id_restaurant_fast_food_emplacement, nomDuplique]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError('Un menu avec ce nom existe déjà');
            }

            // Créer la copie
            const result = await client.query(
                `INSERT INTO MENURESTAURANTFASTFOOD (
                    nom_menu,
                    description_menu,
                    photo_menu,
                    photos_menu,
                    composition_menu,
                    prix_menu,
                    temps_preparation_min,
                    stock_disponible,
                    categorie_menu,
                    est_journalier,
                    disponible,
                    id_restaurant_fast_food_emplacement,
                    date_creation,
                    date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
                RETURNING *`,
                [
                    nomDuplique,
                    source.description_menu,
                    source.photo_menu,
                    source.photos_menu,
                    source.composition_menu,
                    source.prix_menu,
                    source.temps_preparation_min,
                    source.stock_disponible,
                    source.categorie_menu,
                    source.est_journalier,
                    false, // Par défaut indisponible
                    source.id_restaurant_fast_food_emplacement
                ]
            );

            const newMenu = result.rows[0];

            await AuditService.log({
                action: 'DUPLICATE',
                ressource_type: 'MENURESTAURANTFASTFOOD',
                ressource_id: newMenu.id,
                donnees_apres: newMenu,
                donnees_avant: { source_id: id },
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Menu dupliqué avec succès',
                data: {
                    nouveau_menu: newMenu,
                    source: {
                        id: source.id,
                        nom: source.nom_menu
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
     * Supprimer un menu
     * DELETE /api/v1/restauration/menus/:id
     */
    static async delete(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            // Vérifier si le menu est utilisé dans des commandes récentes
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
                    `UPDATE MENURESTAURANTFASTFOOD 
                     SET disponible = false, date_mise_a_jour = NOW()
                     WHERE id = $1`,
                    [id]
                );

                await client.query('COMMIT');

                return res.json({
                    success: true,
                    message: 'Menu désactivé avec succès (utilisé dans des commandes récentes)'
                });
            }

            // Supprimer les photos associées
            const menuResult = await client.query(
                `SELECT photos_menu FROM MENURESTAURANTFASTFOOD WHERE id = $1`,
                [id]
            );

            if (menuResult.rows.length > 0) {
                const photos = menuResult.rows[0].photos_menu || [];
                if (typeof photos === 'string') {
                    JSON.parse(photos).forEach(photoUrl => {
                        FileService.delete(photoUrl).catch(console.error);
                    });
                } else if (Array.isArray(photos)) {
                    photos.forEach(photoUrl => {
                        FileService.delete(photoUrl).catch(console.error);
                    });
                }
            }

            // Supprimer le menu
            const result = await client.query(
                `DELETE FROM MENURESTAURANTFASTFOOD WHERE id = $1 RETURNING *`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Menu non trouvé', 404);
            }

            await AuditService.log({
                action: 'DELETE',
                ressource_type: 'MENURESTAURANTFASTFOOD',
                ressource_id: id,
                donnees_avant: result.rows[0],
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Menu supprimé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Recherche de menus
     * GET /api/v1/restauration/menus/recherche
     */
    static async search(req, res, next) {
        try {
            const {
                q,
                categorie,
                prix_max,
                disponible,
                emplacement_id,
                limit = 20
            } = req.query;

            let query = `
                SELECT 
                    m.id, 
                    m.nom_menu,
                    m.description_menu,
                    m.photo_menu,
                    m.prix_menu,
                    m.categorie_menu,
                    m.disponible,
                    m.temps_preparation_min,
                    erf.nom_emplacement,
                    rf.nom_restaurant_fast_food
                FROM MENURESTAURANTFASTFOOD m
                JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = m.id_restaurant_fast_food_emplacement
                JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            if (q) {
                query += ` AND (m.nom_menu ILIKE $${paramIndex} OR m.description_menu ILIKE $${paramIndex})`;
                params.push(`%${q}%`);
                paramIndex++;
            }

            if (categorie) {
                query += ` AND m.categorie_menu = $${paramIndex}`;
                params.push(categorie);
                paramIndex++;
            }

            if (prix_max) {
                query += ` AND m.prix_menu <= $${paramIndex}`;
                params.push(prix_max);
                paramIndex++;
            }

            if (disponible !== undefined) {
                query += ` AND m.disponible = $${paramIndex}`;
                params.push(disponible === 'true');
                paramIndex++;
            }

            if (emplacement_id) {
                query += ` AND m.id_restaurant_fast_food_emplacement = $${paramIndex}`;
                params.push(emplacement_id);
                paramIndex++;
            }

            query += ` ORDER BY m.nom_menu LIMIT $${paramIndex}`;
            params.push(limit);

            const result = await db.query(query, params);

            res.json({
                success: true,
                data: result.rows,
                count: result.rows.length
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = MenuController;