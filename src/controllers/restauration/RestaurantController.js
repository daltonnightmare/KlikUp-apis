const db = require('../../configuration/database');
const { AppError, ValidationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const FileService = require('../../services/file/FileService');

class RestaurantController {
    /**
     * Récupérer tous les restaurants
     * GET /api/v1/restauration/restaurants
     */
    static async getAll(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                actif,
                recherche,
                avec_emplacements = false,
                tri = 'nom_asc'
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    rf.id, 
                    rf.nom_restaurant_fast_food,
                    rf.description_restaurant_fast_food,
                    rf.logo_restaurant,
                    rf.portefeuille_restaurant_fast_food,
                    rf.pourcentage_commission_plateforme,
                    rf.est_actif, 
                    rf.date_creation,
                    p.nom_plateforme
            `;

            if (avec_emplacements === 'true') {
                query += `,
                    (
                        SELECT json_agg(json_build_object(
                            'id', erf.id,
                            'nom', erf.nom_emplacement,
                            'adresse', erf.adresse_complete,
                            'localisation', ST_AsGeoJSON(erf.localisation_restaurant),
                            'est_actif', erf.est_actif
                        ))
                        FROM EMPLACEMENTSRESTAURANTFASTFOOD erf
                        WHERE erf.id_restaurant_fast_food = rf.id
                        LIMIT 5
                    ) as emplacements
                `;
            }

            query += `
                FROM RESTAURANTSFASTFOOD rf
                LEFT JOIN PLATEFORME p ON p.id = rf.plateforme_id
                WHERE rf.est_supprime = false
            `;

            const params = [];
            let paramIndex = 1;

            if (actif !== undefined) {
                query += ` AND rf.est_actif = $${paramIndex}`;
                params.push(actif === 'true');
                paramIndex++;
            }

            if (recherche) {
                query += ` AND rf.nom_restaurant_fast_food ILIKE $${paramIndex}`;
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            switch (tri) {
                case 'nom_asc':
                    query += ` ORDER BY rf.nom_restaurant_fast_food ASC`;
                    break;
                case 'nom_desc':
                    query += ` ORDER BY rf.nom_restaurant_fast_food DESC`;
                    break;
                case 'date_asc':
                    query += ` ORDER BY rf.date_creation ASC`;
                    break;
                default:
                    query += ` ORDER BY rf.date_creation DESC`;
            }

            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await db.query(query, params);

            const restaurants = result.rows.map(resto => ({
                ...resto,
                portefeuille_restaurant_fast_food: parseFloat(resto.portefeuille_restaurant_fast_food),
                pourcentage_commission_plateforme: parseFloat(resto.pourcentage_commission_plateforme),
                emplacements: resto.emplacements ? resto.emplacements.map(emp => ({
                    ...emp,
                    localisation: emp.localisation ? JSON.parse(emp.localisation) : null
                })) : null
            }));

            const countResult = await db.query(
                `SELECT COUNT(*) as total FROM RESTAURANTSFASTFOOD WHERE est_supprime = false`
            );

            res.json({
                success: true,
                data: restaurants,
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
     * Récupérer un restaurant par ID
     * GET /api/v1/restauration/restaurants/:id
     */
    static async getById(req, res, next) {
    try {
        const { id } = req.params;

        // Récupérer le restaurant principal
        const restaurantResult = await db.query(
            `SELECT rf.*, p.nom_plateforme 
             FROM RESTAURANTSFASTFOOD rf
             LEFT JOIN PLATEFORME p ON p.id = rf.plateforme_id
             WHERE rf.id = $1 AND rf.est_supprime = false`,
            [id]
        );

        if (restaurantResult.rows.length === 0) {
            throw new AppError('Restaurant non trouvé', 404);
        }

        const restaurant = restaurantResult.rows[0];

        // Récupérer les emplacements séparément
        const emplacementsResult = await db.query(
            `SELECT 
                erf.id,
                erf.nom_emplacement as nom,
                erf.logo_restaurant as logo,
                erf.adresse_complete as adresse,
                ST_AsGeoJSON(erf.localisation_restaurant) as localisation_geojson,
                erf.frais_livraison,
                erf.heure_ouverture,
                erf.heure_fermeture,
                erf.jours_ouverture_emplacement_restaurant as jours_ouverture,
                erf.portefeuille_emplacement as portefeuille,
                erf.est_actif,
                (
                    SELECT COUNT(*) 
                    FROM MENURESTAURANTFASTFOOD m 
                    WHERE m.id_restaurant_fast_food_emplacement = erf.id 
                    AND m.disponible = true
                ) as nombre_menus
            FROM EMPLACEMENTSRESTAURANTFASTFOOD erf
            WHERE erf.id_restaurant_fast_food = $1
            ORDER BY erf.nom_emplacement ASC`,
            [id]
        );

        // Récupérer les notes
        const notesResult = await db.query(
            `SELECT 
                COALESCE(AVG(note_globale), 0) as note_moyenne,
                COUNT(*) as nombre_avis
            FROM AVIS 
            WHERE entite_type = 'RESTAURANT_FAST_FOOD' 
              AND entite_id = $1 
              AND statut = 'PUBLIE'`,
            [id]
        );

        // Traiter les emplacements
        restaurant.emplacements = emplacementsResult.rows.map(emp => {
            // Créer un nouvel objet sans la propriété localisation_geojson
            const { localisation_geojson, ...empData } = emp;
            
            // Ajouter la localisation parsée si elle existe
            if (localisation_geojson) {
                try {
                    empData.localisation = JSON.parse(localisation_geojson);
                } catch (e) {
                    console.error('Erreur parsing localisation:', e);
                    empData.localisation = null;
                }
            } else {
                empData.localisation = null;
            }
            
            return empData;
        });

        // Ajouter les notes
        restaurant.notes = {
            note_moyenne: parseFloat(notesResult.rows[0].note_moyenne) || 0,
            nombre_avis: parseInt(notesResult.rows[0].nombre_avis) || 0
        };

        res.json({
            success: true,
            data: restaurant
        });

    } catch (error) {
        next(error);
    }
    }
    /**
     * Créer un nouveau restaurant
     * POST /api/v1/restauration/restaurants
     */
    static async create(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const {
                nom_restaurant_fast_food,
                description_restaurant_fast_food,
                logo_restaurant,
                pourcentage_commission_plateforme,
                plateforme_id
            } = req.body;

            const existing = await client.query(
                `SELECT id FROM RESTAURANTSFASTFOOD WHERE nom_restaurant_fast_food = $1`,
                [nom_restaurant_fast_food]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError('Un restaurant avec ce nom existe déjà');
            }

            const result = await client.query(
                `INSERT INTO RESTAURANTSFASTFOOD (
                    nom_restaurant_fast_food, 
                    description_restaurant_fast_food,
                    logo_restaurant, 
                    pourcentage_commission_plateforme,
                    plateforme_id, 
                    date_creation, 
                    date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                RETURNING *`,
                [
                    nom_restaurant_fast_food,
                    description_restaurant_fast_food,
                    logo_restaurant,
                    pourcentage_commission_plateforme || 10,
                    plateforme_id || 1
                ]
            );

            const newRestaurant = result.rows[0];

            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'RESTAURANTSFASTFOOD',
                ressource_id: newRestaurant.id,
                donnees_apres: newRestaurant,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Restaurant créé avec succès',
                data: newRestaurant
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour un restaurant
     * PUT /api/v1/restauration/restaurants/:id
     */
    static async update(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const {
                nom_restaurant_fast_food,
                description_restaurant_fast_food,
                logo_restaurant,
                pourcentage_commission_plateforme,
                est_actif
            } = req.body;

            const currentResult = await client.query(
                `SELECT * FROM RESTAURANTSFASTFOOD WHERE id = $1`,
                [id]
            );

            if (currentResult.rows.length === 0) {
                throw new AppError('Restaurant non trouvé', 404);
            }

            const current = currentResult.rows[0];

            if (nom_restaurant_fast_food && nom_restaurant_fast_food !== current.nom_restaurant_fast_food) {
                const existing = await client.query(
                    `SELECT id FROM RESTAURANTSFASTFOOD 
                     WHERE nom_restaurant_fast_food = $1 AND id != $2`,
                    [nom_restaurant_fast_food, id]
                );
                if (existing.rows.length > 0) {
                    throw new ValidationError('Un restaurant avec ce nom existe déjà');
                }
            }

            const result = await client.query(
                `UPDATE RESTAURANTSFASTFOOD 
                 SET nom_restaurant_fast_food = COALESCE($1, nom_restaurant_fast_food),
                     description_restaurant_fast_food = COALESCE($2, description_restaurant_fast_food),
                     logo_restaurant = COALESCE($3, logo_restaurant),
                     pourcentage_commission_plateforme = COALESCE($4, pourcentage_commission_plateforme),
                     est_actif = COALESCE($5, est_actif),
                     date_mise_a_jour = NOW()
                 WHERE id = $6
                 RETURNING *`,
                [
                    nom_restaurant_fast_food,
                    description_restaurant_fast_food,
                    logo_restaurant,
                    pourcentage_commission_plateforme,
                    est_actif,
                    id
                ]
            );

            const updated = result.rows[0];

            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'RESTAURANTSFASTFOOD',
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
                message: 'Restaurant mis à jour avec succès',
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
     * Récupérer le menu complet d'un restaurant
     * GET /api/v1/restauration/restaurants/:id/menu
     */
    static async getMenu(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `WITH menus_par_categorie AS (
                    SELECT 
                        m.categorie_menu,
                        json_agg(json_build_object(
                            'id', m.id,
                            'nom', m.nom_menu,
                            'description', m.description_menu,
                            'prix', m.prix_menu,
                            'photo', m.photo_menu,
                            'photos', m.photos_menu,
                            'composition', m.composition_menu,
                            'temps_preparation', m.temps_preparation_min,
                            'disponible', m.disponible,
                            'stock', m.stock_disponible,
                            'emplacement', json_build_object(
                                'id', erf.id,
                                'nom', erf.nom_emplacement,
                                'adresse', erf.adresse_complete
                            )
                        ) ORDER BY m.nom_menu) as menus
                    FROM MENURESTAURANTFASTFOOD m
                    JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf 
                        ON erf.id = m.id_restaurant_fast_food_emplacement
                    WHERE erf.id_restaurant_fast_food = $1 
                      AND m.disponible = true
                    GROUP BY m.categorie_menu
                ),
                produits_par_categorie AS (
                    SELECT 
                        p.categorie_produit,
                        json_agg(json_build_object(
                            'id', p.id,
                            'nom', p.nom_produit,
                            'description', p.description_produit,
                            'prix', p.prix_produit,
                            'photo', p.photo_produit,
                            'donnees', p.donnees_produit,
                            'stock', p.stock_disponible,
                            'disponible', p.disponible,
                            'emplacement', json_build_object(
                                'id', erf2.id,
                                'nom', erf2.nom_emplacement
                            )
                        ) ORDER BY p.nom_produit) as produits
                    FROM PRODUITSINDIVIDUELRESTAURANT p
                    JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf2 
                        ON erf2.id = p.id_restaurant_fast_food_emplacement
                    WHERE erf2.id_restaurant_fast_food = $1 
                      AND p.disponible = true
                    GROUP BY p.categorie_produit
                ),
                promos_actives AS (
                    SELECT json_agg(json_build_object(
                        'id', pr.id,
                        'nom', pr.nom_promo,
                        'description', pr.description_promo,
                        'code', pr.code_promo,
                        'type', pr.type_promo,
                        'reduction_pourcentage', pr.pourcentage_reduction,
                        'reduction_fixe', pr.montant_fixe_reduction,
                        'date_fin', pr.date_fin_promo,
                        'utilisation_restante', 
                            CASE WHEN pr.utilisation_max > 0 
                            THEN pr.utilisation_max - pr.utilisation_count
                            ELSE -1 END,
                        'produits_affectes', pr.produits_affectes
                    )) as promos
                    FROM PROMOSRESTAURANTFASTFOOD pr
                    JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf3 
                        ON erf3.id = pr.id_restaurant_fast_food_emplacement
                    WHERE erf3.id_restaurant_fast_food = $1
                      AND pr.actif = true
                      AND pr.date_debut_promo <= NOW()
                      AND pr.date_fin_promo >= NOW()
                      AND (pr.utilisation_max = -1 OR pr.utilisation_count < pr.utilisation_max)
                )
                SELECT 
                    COALESCE((SELECT json_agg(menus_par_categorie) FROM menus_par_categorie), '[]'::json) as menus,
                    COALESCE((SELECT json_agg(produits_par_categorie) FROM produits_par_categorie), '[]'::json) as produits,
                    COALESCE((SELECT promos FROM promos_actives), '[]'::json) as promos`,
                [id]
            );

            const menu = result.rows[0];

            res.json({
                success: true,
                data: {
                    menus: menu.menus,
                    produits: menu.produits,
                    promos: menu.promos,
                    restaurant_id: id
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les statistiques d'un restaurant
     * GET /api/v1/restauration/restaurants/:id/stats
     */
    static async getStats(req, res, next) {
        try {
            const { id } = req.params;
            const { periode = '30j' } = req.query;

            let interval = "30 days";
            if (periode === '7j') interval = "7 days";
            if (periode === '90j') interval = "90 days";

            const result = await db.query(
                `WITH stats_globales AS (
                    SELECT 
                        rf.id,
                        rf.nom_restaurant_fast_food,
                        rf.portefeuille_restaurant_fast_food,
                        COUNT(DISTINCT erf.id) as total_emplacements,
                        COUNT(DISTINCT m.id) as total_menus,
                        COUNT(DISTINCT pir.id) as total_produits,
                        COALESCE(SUM(c.prix_total_commande), 0) as chiffre_affaires_total,
                        COUNT(DISTINCT c.id) as total_commandes
                    FROM RESTAURANTSFASTFOOD rf
                    LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id_restaurant_fast_food = rf.id
                    LEFT JOIN MENURESTAURANTFASTFOOD m ON m.id_restaurant_fast_food_emplacement = erf.id
                    LEFT JOIN PRODUITSINDIVIDUELRESTAURANT pir ON pir.id_restaurant_fast_food_emplacement = erf.id
                    LEFT JOIN COMMANDESEMPLACEMENTFASTFOOD c ON c.id_restaurant_fast_food_emplacement = erf.id
                    WHERE rf.id = $1
                    GROUP BY rf.id
                ),
                commandes_recents AS (
                    SELECT 
                        c.statut_commande,
                        COUNT(*) as nombre,
                        COALESCE(SUM(c.prix_total_commande), 0) as montant
                    FROM COMMANDESEMPLACEMENTFASTFOOD c
                    JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = c.id_restaurant_fast_food_emplacement
                    WHERE erf.id_restaurant_fast_food = $1
                      AND c.date_commande >= NOW() - $2::interval
                    GROUP BY c.statut_commande
                ),
                top_menus AS (
                    SELECT 
                        m.nom_menu,
                        COUNT(c.id) as nombre_commandes,
                        SUM((c.donnees_commande->>'quantite')::int) as quantite_totale
                    FROM MENURESTAURANTFASTFOOD m
                    JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = m.id_restaurant_fast_food_emplacement
                    LEFT JOIN COMMANDESEMPLACEMENTFASTFOOD c ON c.id_restaurant_fast_food_emplacement = erf.id
                    WHERE erf.id_restaurant_fast_food = $1
                      AND c.date_commande >= NOW() - $2::interval
                    GROUP BY m.id, m.nom_menu
                    ORDER BY quantite_totale DESC NULLS LAST
                    LIMIT 5
                ),
                stats_quotidiennes AS (
                    SELECT 
                        DATE(c.date_commande) as date,
                        COUNT(*) as nombre_commandes,
                        COALESCE(SUM(c.prix_total_commande), 0) as chiffre_affaires
                    FROM COMMANDESEMPLACEMENTFASTFOOD c
                    JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = c.id_restaurant_fast_food_emplacement
                    WHERE erf.id_restaurant_fast_food = $1
                      AND c.date_commande >= NOW() - $2::interval
                    GROUP BY DATE(c.date_commande)
                    ORDER BY date DESC
                )
                SELECT 
                    (SELECT row_to_json(stats_globales) FROM stats_globales) as global,
                    (SELECT json_agg(commandes_recents) FROM commandes_recents) as commandes_par_statut,
                    (SELECT json_agg(top_menus) FROM top_menus) as menus_populaires,
                    (SELECT json_agg(stats_quotidiennes) FROM stats_quotidiennes) as evolution_quotidienne`,
                [id, interval]
            );

            if (result.rows.length === 0 || !result.rows[0].global) {
                throw new AppError('Restaurant non trouvé', 404);
            }

            res.json({
                success: true,
                data: {
                    ...result.rows[0].global,
                    commandes_par_statut: result.rows[0].commandes_par_statut || [],
                    menus_populaires: result.rows[0].menus_populaires || [],
                    evolution_quotidienne: result.rows[0].evolution_quotidienne || [],
                    periode
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Upload du logo du restaurant
     * POST /api/v1/restauration/restaurants/:id/logo
     */
    static async uploadLogo(req, res, next) {
        const client = await db.getConnection();
        try {
            const { id } = req.params;

            if (!req.file) {
                throw new ValidationError('Aucun fichier fourni');
            }

            const fileResult = await FileService.upload(req.file, {
                folder: 'restaurants',
                entityId: id,
                resize: true,
                sizes: [
                    { width: 200, height: 200, suffix: 'small' },
                    { width: 400, height: 400, suffix: 'medium' },
                    { width: 800, height: 800, suffix: 'large' }
                ],
                formats: ['webp', 'jpg'],
                quality: 80
            });

            await client.query(
                `UPDATE RESTAURANTSFASTFOOD 
                 SET logo_restaurant = $1, date_mise_a_jour = NOW()
                 WHERE id = $2`,
                [fileResult.url, id]
            );

            res.json({
                success: true,
                message: 'Logo uploadé avec succès',
                data: fileResult
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer un restaurant (soft delete)
     * DELETE /api/v1/restauration/restaurants/:id
     */
    static async delete(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            const dependencies = await client.query(
                `SELECT 
                    (SELECT COUNT(*) FROM EMPLACEMENTSRESTAURANTFASTFOOD WHERE id_restaurant_fast_food = $1) as emplacements,
                    (SELECT COUNT(*) FROM COMPTES WHERE restaurant_id = $1) as comptes`,
                [id]
            );

            const deps = dependencies.rows[0];
            if (deps.emplacements > 0 || deps.comptes > 0) {
                throw new AppError(
                    'Impossible de supprimer : le restaurant a des dépendances actives',
                    409
                );
            }

            const currentResult = await client.query(
                `SELECT * FROM RESTAURANTSFASTFOOD WHERE id = $1`,
                [id]
            );

            if (currentResult.rows.length === 0) {
                throw new AppError('Restaurant non trouvé', 404);
            }

            await client.query(
                `UPDATE RESTAURANTSFASTFOOD 
                 SET est_supprime = true, 
                     date_suppression = NOW(),
                     est_actif = false
                 WHERE id = $1`,
                [id]
            );

            await AuditService.log({
                action: 'DELETE',
                ressource_type: 'RESTAURANTSFASTFOOD',
                ressource_id: id,
                donnees_avant: currentResult.rows[0],
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Restaurant supprimé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Restaurer un restaurant supprimé
     * POST /api/v1/restauration/restaurants/:id/restaurer
     */
    static async restore(req, res, next) {
        const client = await db.getConnection();
        try {
            const { id } = req.params;

            const result = await client.query(
                `UPDATE RESTAURANTSFASTFOOD 
                 SET est_supprime = false, 
                     date_suppression = NULL,
                     est_actif = true,
                     date_mise_a_jour = NOW()
                 WHERE id = $1 AND est_supprime = true
                 RETURNING *`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Restaurant non trouvé ou non supprimé', 404);
            }

            res.json({
                success: true,
                message: 'Restaurant restauré avec succès',
                data: result.rows[0]
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les restaurants à proximité
     * GET /api/v1/restauration/restaurants/proximite
     */
    static async getNearby(req, res, next) {
        try {
            const { 
                lat, 
                lng, 
                rayon_km = 5, 
                limit = 20,
                ouvert_maintenant = false 
            } = req.query;

            if (!lat || !lng) {
                throw new ValidationError('Latitude et longitude requises');
            }

            let query = `
                SELECT DISTINCT
                    rf.id, 
                    rf.nom_restaurant_fast_food,
                    rf.logo_restaurant,
                    erf.nom_emplacement,
                    erf.adresse_complete,
                    erf.frais_livraison,
                    erf.heure_ouverture,
                    erf.heure_fermeture,
                    ST_Distance(
                        erf.localisation_restaurant::geography,
                        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                    ) as distance,
                    ST_AsGeoJSON(erf.localisation_restaurant) as localisation,
                    (
                        SELECT AVG(note_globale)::numeric(10,2)
                        FROM AVIS 
                        WHERE entite_type = 'EMPLACEMENT_RESTAURANT' 
                          AND entite_id = erf.id 
                          AND statut = 'PUBLIE'
                    ) as note_moyenne,
                    (
                        SELECT COUNT(*)
                        FROM MENURESTAURANTFASTFOOD m
                        WHERE m.id_restaurant_fast_food_emplacement = erf.id 
                          AND m.disponible = true
                    ) as nombre_menus
                FROM RESTAURANTSFASTFOOD rf
                JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id_restaurant_fast_food = rf.id
                WHERE rf.est_actif = true
                  AND erf.est_actif = true
                  AND ST_DWithin(
                      erf.localisation_restaurant::geography,
                      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                      $3 * 1000
                  )
            `;

            if (ouvert_maintenant === 'true') {
                const jourActuel = new Date().getDay(); // 0-6
                const heureActuelle = new Date().toLocaleTimeString('fr-FR', { hour12: false });
                
                query += ` AND erf.heure_ouverture <= $4::time 
                           AND erf.heure_fermeture >= $4::time`;
            }

            query += ` ORDER BY distance ASC LIMIT $4`;

            const params = ouvert_maintenant === 'true' 
                ? [lng, lat, rayon_km, heureActuelle, limit]
                : [lng, lat, rayon_km, limit];

            const result = await db.query(query, params);

            const restaurants = result.rows.map(r => ({
                ...r,
                distance: Math.round(r.distance),
                localisation: r.localisation ? JSON.parse(r.localisation) : null,
                frais_livraison: parseFloat(r.frais_livraison),
                note_moyenne: r.note_moyenne ? parseFloat(r.note_moyenne) : null
            }));

            res.json({
                success: true,
                data: restaurants,
                meta: {
                    centre: { lat: parseFloat(lat), lng: parseFloat(lng) },
                    rayon_km: parseFloat(rayon_km),
                    total: restaurants.length
                }
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = RestaurantController;