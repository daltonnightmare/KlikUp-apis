const db = require('../../configuration/database');
const { AppError, ValidationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const { ENUM_TYPES_PROMO } = require('../../utils/constants/enums');

class PromoController {


    /**
     * Récupérer toutes les promotions (version enrichie)
     * GET /api/v1/restauration/promos/all
     */
    static async getAllPromos(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                actif,
                type_promo,
                restaurant_id,
                emplacement_id,
                recherche,
                statut_temporel, // 'en_cours', 'a_venir', 'expiree'
                tri = 'date_creation_desc',
                avec_produits_menus = false
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    pr.id, 
                    pr.nom_promo,
                    pr.description_promo,
                    pr.code_promo,
                    pr.type_promo,
                    pr.pourcentage_reduction,
                    pr.montant_fixe_reduction,
                    pr.date_debut_promo,
                    pr.date_fin_promo,
                    pr.utilisation_max,
                    pr.utilisation_count,
                    pr.actif,
                    pr.produits_affectes,
                    pr.date_creation,
                    pr.date_mise_a_jour,
                    pr.id_restaurant_fast_food_emplacement,
                    erf.id as emplacement_id,
                    erf.nom_emplacement,
                    erf.adresse_complete,
                    erf.frais_livraison,
                    rf.id as restaurant_id,
                    rf.nom_restaurant_fast_food,
                    rf.logo_restaurant
            `;

            // Ajouter les produits et menus associés si demandé
            if (avec_produits_menus === 'true') {
                query += `,
                    (
                        SELECT json_agg(json_build_object(
                            'id', m.id,
                            'nom', m.nom_menu,
                            'prix', m.prix_menu,
                            'photo', m.photo_menu,
                            'categorie', m.categorie_menu,
                            'disponible', m.disponible
                        ))
                        FROM PROMOSMENUS pm
                        JOIN MENURESTAURANTFASTFOOD m ON m.id = pm.menu_id
                        WHERE pm.promo_id = pr.id
                    ) as menus_associes,
                    (
                        SELECT json_agg(json_build_object(
                            'id', p.id,
                            'nom', p.nom_produit,
                            'prix', p.prix_produit,
                            'photo', p.photo_produit,
                            'categorie', p.categorie_produit,
                            'disponible', p.disponible
                        ))
                        FROM PROMOSPRODUITS pp
                        JOIN PRODUITSINDIVIDUELRESTAURANT p ON p.id = pp.produit_id
                        WHERE pp.promo_id = pr.id
                    ) as produits_associes
                `;
            }

            query += `
                FROM PROMOSRESTAURANTFASTFOOD pr
                LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = pr.id_restaurant_fast_food_emplacement
                LEFT JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
                WHERE rf.est_supprime = false
            `;

            const params = [];
            let paramIndex = 1;

            // Filtres optionnels
            if (actif !== undefined) {
                query += ` AND pr.actif = $${paramIndex}`;
                params.push(actif === 'true');
                paramIndex++;
            }

            if (type_promo) {
                query += ` AND pr.type_promo = $${paramIndex}`;
                params.push(type_promo);
                paramIndex++;
            }

            if (restaurant_id) {
                query += ` AND rf.id = $${paramIndex}`;
                params.push(parseInt(restaurant_id));
                paramIndex++;
            }

            if (emplacement_id) {
                query += ` AND pr.id_restaurant_fast_food_emplacement = $${paramIndex}`;
                params.push(parseInt(emplacement_id));
                paramIndex++;
            }

            if (recherche) {
                query += ` AND (pr.nom_promo ILIKE $${paramIndex} OR pr.code_promo ILIKE $${paramIndex} OR pr.description_promo ILIKE $${paramIndex})`;
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            // Filtre temporel
            const maintenant = new Date().toISOString();
            if (statut_temporel) {
                switch (statut_temporel) {
                    case 'en_cours':
                        query += ` AND pr.date_debut_promo <= $${paramIndex}::timestamp AND pr.date_fin_promo >= $${paramIndex}::timestamp`;
                        params.push(maintenant);
                        paramIndex++;
                        break;
                    case 'a_venir':
                        query += ` AND pr.date_debut_promo > $${paramIndex}::timestamp`;
                        params.push(maintenant);
                        paramIndex++;
                        break;
                    case 'expiree':
                        query += ` AND pr.date_fin_promo < $${paramIndex}::timestamp`;
                        params.push(maintenant);
                        paramIndex++;
                        break;
                }
            }

            // Tri
            switch (tri) {
                case 'date_debut_asc':
                    query += ` ORDER BY pr.date_debut_promo ASC`;
                    break;
                case 'date_debut_desc':
                    query += ` ORDER BY pr.date_debut_promo DESC`;
                    break;
                case 'date_fin_asc':
                    query += ` ORDER BY pr.date_fin_promo ASC`;
                    break;
                case 'date_fin_desc':
                    query += ` ORDER BY pr.date_fin_promo DESC`;
                    break;
                case 'utilisation_desc':
                    query += ` ORDER BY pr.utilisation_count DESC`;
                    break;
                case 'utilisation_asc':
                    query += ` ORDER BY pr.utilisation_count ASC`;
                    break;
                case 'reduction_desc':
                    query += ` ORDER BY COALESCE(pr.pourcentage_reduction, pr.montant_fixe_reduction) DESC NULLS LAST`;
                    break;
                case 'restaurant_asc':
                    query += ` ORDER BY rf.nom_restaurant_fast_food ASC, pr.date_debut_promo DESC`;
                    break;
                case 'nom_asc':
                    query += ` ORDER BY pr.nom_promo ASC`;
                    break;
                default:
                    query += ` ORDER BY pr.date_creation DESC`;
            }

            // Pagination
            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);

            // Traiter les résultats
            const maintenantDate = new Date();
            const promos = result.rows.map(promo => {
                const dateDebut = new Date(promo.date_debut_promo);
                const dateFin = new Date(promo.date_fin_promo);
                
                // Calculer le statut détaillé
                const estEnCours = promo.actif && dateDebut <= maintenantDate && dateFin >= maintenantDate;
                const estAVenir = promo.actif && dateDebut > maintenantDate;
                const estExpiree = dateFin < maintenantDate;
                const utilisationsRestantes = promo.utilisation_max === -1 ? 'Illimité' : promo.utilisation_max - promo.utilisation_count;
                
                const processed = {
                    ...promo,
                    pourcentage_reduction: promo.pourcentage_reduction ? parseFloat(promo.pourcentage_reduction) : null,
                    montant_fixe_reduction: promo.montant_fixe_reduction ? parseFloat(promo.montant_fixe_reduction) : null,
                    produits_affectes: promo.produits_affectes || [],
                    statut: {
                        actif: promo.actif,
                        en_cours: estEnCours,
                        a_venir: estAVenir,
                        expiree: estExpiree,
                        utilisations_restantes: utilisationsRestantes,
                        jours_restants: estEnCours ? Math.ceil((dateFin - maintenantDate) / (1000 * 60 * 60 * 24)) : 0,
                        jours_avant_debut: estAVenir ? Math.ceil((dateDebut - maintenantDate) / (1000 * 60 * 60 * 24)) : 0
                    }
                };

                // Parser les menus et produits associés
                if (promo.menus_associes && typeof promo.menus_associes === 'string') {
                    try {
                        processed.menus_associes = JSON.parse(promo.menus_associes);
                    } catch (e) {
                        processed.menus_associes = [];
                    }
                }

                if (promo.produits_associes && typeof promo.produits_associes === 'string') {
                    try {
                        processed.produits_associes = JSON.parse(promo.produits_associes);
                    } catch (e) {
                        processed.produits_associes = [];
                    }
                }

                return processed;
            });

            // Compter le total pour la pagination
            let countQuery = `
                SELECT COUNT(*) as total 
                FROM PROMOSRESTAURANTFASTFOOD pr
                LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = pr.id_restaurant_fast_food_emplacement
                LEFT JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
                WHERE rf.est_supprime = false
            `;

            const countParams = [];
            let countParamIndex = 1;

            // Réappliquer les mêmes filtres pour le count
            if (actif !== undefined) {
                countQuery += ` AND pr.actif = $${countParamIndex}`;
                countParams.push(actif === 'true');
                countParamIndex++;
            }

            if (type_promo) {
                countQuery += ` AND pr.type_promo = $${countParamIndex}`;
                countParams.push(type_promo);
                countParamIndex++;
            }

            if (restaurant_id) {
                countQuery += ` AND rf.id = $${countParamIndex}`;
                countParams.push(parseInt(restaurant_id));
                countParamIndex++;
            }

            if (emplacement_id) {
                countQuery += ` AND pr.id_restaurant_fast_food_emplacement = $${countParamIndex}`;
                countParams.push(parseInt(emplacement_id));
                countParamIndex++;
            }

            if (recherche) {
                countQuery += ` AND (pr.nom_promo ILIKE $${countParamIndex} OR pr.code_promo ILIKE $${countParamIndex})`;
                countParams.push(`%${recherche}%`);
                countParamIndex++;
            }

            if (statut_temporel) {
                const maintenant = new Date().toISOString();
                switch (statut_temporel) {
                    case 'en_cours':
                        countQuery += ` AND pr.date_debut_promo <= $${countParamIndex}::timestamp AND pr.date_fin_promo >= $${countParamIndex}::timestamp`;
                        countParams.push(maintenant);
                        countParamIndex++;
                        break;
                    case 'a_venir':
                        countQuery += ` AND pr.date_debut_promo > $${countParamIndex}::timestamp`;
                        countParams.push(maintenant);
                        countParamIndex++;
                        break;
                    case 'expiree':
                        countQuery += ` AND pr.date_fin_promo < $${countParamIndex}::timestamp`;
                        countParams.push(maintenant);
                        countParamIndex++;
                        break;
                }
            }

            const countResult = await db.query(countQuery, countParams);

            res.json({
                success: true,
                data: promos,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(countResult.rows[0].total),
                    pages: Math.ceil(parseInt(countResult.rows[0].total) / limit)
                },
                filters: {
                    appliques: {
                        actif: actif || null,
                        type_promo: type_promo || null,
                        restaurant_id: restaurant_id || null,
                        emplacement_id: emplacement_id || null,
                        recherche: recherche || null,
                        statut_temporel: statut_temporel || null
                    },
                    disponibles: {
                        types_promo: ENUM_TYPES_PROMO
                    }
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les promotions groupées par restaurant
     * GET /api/v1/restauration/promos/by-restaurant
     */
    static async getPromosByRestaurant(req, res, next) {
        try {
            const {
                actif = 'true',
                type_promo,
                limit_par_restaurant = 5
            } = req.query;

            const maintenant = new Date().toISOString();

            const query = `
                SELECT 
                    rf.id as restaurant_id,
                    rf.nom_restaurant_fast_food,
                    rf.logo_restaurant,
                    rf.description_restaurant_fast_food,
                    (
                        SELECT COUNT(*) 
                        FROM PROMOSRESTAURANTFASTFOOD pr2
                        LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf2 ON erf2.id = pr2.id_restaurant_fast_food_emplacement
                        WHERE erf2.id_restaurant_fast_food = rf.id
                        AND pr2.actif = CASE WHEN $1 = 'true' THEN true ELSE pr2.actif END
                        AND ($2 IS NULL OR pr2.type_promo = $2)
                    ) as total_promos,
                    (
                        SELECT json_agg(
                            json_build_object(
                                'id', pr.id,
                                'nom', pr.nom_promo,
                                'description', pr.description_promo,
                                'code', pr.code_promo,
                                'type', pr.type_promo,
                                'reduction_pourcentage', pr.pourcentage_reduction,
                                'reduction_fixe', pr.montant_fixe_reduction,
                                'date_debut', pr.date_debut_promo,
                                'date_fin', pr.date_fin_promo,
                                'est_en_cours', (pr.date_debut_promo <= $3::timestamp AND pr.date_fin_promo >= $3::timestamp),
                                'jours_restants', EXTRACT(DAY FROM (pr.date_fin_promo - $3::timestamp)),
                                'emplacement_id', erf.id,
                                'emplacement_nom', erf.nom_emplacement
                            ) ORDER BY pr.date_debut_promo DESC
                        )
                        FROM (
                            SELECT DISTINCT pr.*
                            FROM PROMOSRESTAURANTFASTFOOD pr
                            JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = pr.id_restaurant_fast_food_emplacement
                            WHERE erf.id_restaurant_fast_food = rf.id
                            AND pr.actif = CASE WHEN $1 = 'true' THEN true ELSE pr.actif END
                            AND ($2 IS NULL OR pr.type_promo = $2)
                            ORDER BY pr.date_debut_promo DESC
                            LIMIT $4
                        ) pr
                        LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = pr.id_restaurant_fast_food_emplacement
                    ) as promos
                FROM RESTAURANTSFASTFOOD rf
                WHERE rf.est_actif = true AND rf.est_supprime = false
                ORDER BY rf.nom_restaurant_fast_food
            `;

            const result = await db.query(query, [
                actif,
                type_promo || null,
                maintenant,
                parseInt(limit_par_restaurant)
            ]);

            // Filtrer les restaurants qui ont des promotions
            const restaurantsAvecPromos = result.rows
                .filter(r => r.promos && r.promos.length > 0)
                .map(r => ({
                    ...r,
                    promos: r.promos.map(p => ({
                        ...p,
                        reduction_pourcentage: p.reduction_pourcentage ? parseFloat(p.reduction_pourcentage) : null,
                        reduction_fixe: p.reduction_fixe ? parseFloat(p.reduction_fixe) : null
                    }))
                }));

            res.json({
                success: true,
                data: restaurantsAvecPromos,
                total_restaurants: restaurantsAvecPromos.length,
                total_promos: restaurantsAvecPromos.reduce((acc, r) => acc + r.promos.length, 0)
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les promotions par type
     * GET /api/v1/restauration/promos/by-type
     */
    static async getPromosByType(req, res, next) {
        try {
            const { actif = 'true' } = req.query;

            const maintenant = new Date().toISOString();

            const query = `
                SELECT 
                    pr.type_promo,
                    COUNT(*) as total,
                    json_agg(
                        json_build_object(
                            'id', pr.id,
                            'nom', pr.nom_promo,
                            'code', pr.code_promo,
                            'reduction_pourcentage', pr.pourcentage_reduction,
                            'reduction_fixe', pr.montant_fixe_reduction,
                            'date_fin', pr.date_fin_promo,
                            'restaurant_id', rf.id,
                            'restaurant_nom', rf.nom_restaurant_fast_food,
                            'emplacement_nom', erf.nom_emplacement,
                            'est_en_cours', (pr.date_debut_promo <= $2::timestamp AND pr.date_fin_promo >= $2::timestamp)
                        ) ORDER BY pr.date_fin_promo ASC
                    ) as promos
                FROM PROMOSRESTAURANTFASTFOOD pr
                JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = pr.id_restaurant_fast_food_emplacement
                JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
                WHERE pr.actif = CASE WHEN $1 = 'true' THEN true ELSE pr.actif END
                GROUP BY pr.type_promo
                ORDER BY pr.type_promo
            `;

            const result = await db.query(query, [actif, maintenant]);

            const types = result.rows.map(row => ({
                type: row.type_promo,
                total: parseInt(row.total),
                promos: row.promos.map(p => ({
                    ...p,
                    reduction_pourcentage: p.reduction_pourcentage ? parseFloat(p.reduction_pourcentage) : null,
                    reduction_fixe: p.reduction_fixe ? parseFloat(p.reduction_fixe) : null
                }))
            }));

            res.json({
                success: true,
                data: types,
                total_types: types.length
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les promotions expirant bientôt
     * GET /api/v1/restauration/promos/expirant-bientot
     */
    static async getExpiringSoon(req, res, next) {
        try {
            const { jours = 7, limit = 10 } = req.query;

            const maintenant = new Date();
            const dateLimite = new Date();
            dateLimite.setDate(dateLimite.getDate() + parseInt(jours));

            const query = `
                SELECT 
                    pr.id, 
                    pr.nom_promo,
                    pr.code_promo,
                    pr.type_promo,
                    pr.pourcentage_reduction,
                    pr.montant_fixe_reduction,
                    pr.date_fin_promo,
                    pr.utilisation_count,
                    pr.utilisation_max,
                    rf.id as restaurant_id,
                    rf.nom_restaurant_fast_food,
                    erf.nom_emplacement,
                    EXTRACT(DAY FROM (pr.date_fin_promo - NOW())) as jours_restants
                FROM PROMOSRESTAURANTFASTFOOD pr
                JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = pr.id_restaurant_fast_food_emplacement
                JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
                WHERE pr.actif = true
                AND pr.date_fin_promo BETWEEN NOW() AND $1::timestamp
                AND (pr.utilisation_max = -1 OR pr.utilisation_count < pr.utilisation_max)
                ORDER BY pr.date_fin_promo ASC
                LIMIT $2
            `;

            const result = await db.query(query, [dateLimite.toISOString(), parseInt(limit)]);

            const promos = result.rows.map(promo => ({
                ...promo,
                pourcentage_reduction: promo.pourcentage_reduction ? parseFloat(promo.pourcentage_reduction) : null,
                montant_fixe_reduction: promo.montant_fixe_reduction ? parseFloat(promo.montant_fixe_reduction) : null,
                jours_restants: parseInt(promo.jours_restants),
                utilisations_restantes: promo.utilisation_max === -1 ? 'Illimité' : promo.utilisation_max - promo.utilisation_count
            }));

            res.json({
                success: true,
                data: promos,
                count: promos.length
            });

        } catch (error) {
            next(error);
        }
    }


    /**
     * Récupérer toutes les promotions
     * GET /api/v1/restauration/promos
     */
    static async getAll(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                actif,
                type_promo,
                restaurant_id,
                emplacement_id,
                recherche,
                tri = 'date_creation_desc'
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    pr.id, 
                    pr.nom_promo,
                    pr.description_promo,
                    pr.code_promo,
                    pr.type_promo,
                    pr.pourcentage_reduction,
                    pr.montant_fixe_reduction,
                    pr.date_debut_promo,
                    pr.date_fin_promo,
                    pr.utilisation_max,
                    pr.utilisation_count,
                    pr.actif,
                    pr.produits_affectes,
                    pr.date_creation,
                    erf.nom_emplacement,
                    rf.nom_restaurant_fast_food
                FROM PROMOSRESTAURANTFASTFOOD pr
                LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = pr.id_restaurant_fast_food_emplacement
                LEFT JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            if (actif !== undefined) {
                query += ` AND pr.actif = $${paramIndex}`;
                params.push(actif === 'true');
                paramIndex++;
            }

            if (type_promo) {
                query += ` AND pr.type_promo = $${paramIndex}`;
                params.push(type_promo);
                paramIndex++;
            }

            if (restaurant_id) {
                query += ` AND erf.id_restaurant_fast_food = $${paramIndex}`;
                params.push(restaurant_id);
                paramIndex++;
            }

            if (emplacement_id) {
                query += ` AND pr.id_restaurant_fast_food_emplacement = $${paramIndex}`;
                params.push(emplacement_id);
                paramIndex++;
            }

            if (recherche) {
                query += ` AND (pr.nom_promo ILIKE $${paramIndex} OR pr.code_promo ILIKE $${paramIndex})`;
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            switch (tri) {
                case 'date_debut_asc':
                    query += ` ORDER BY pr.date_debut_promo ASC`;
                    break;
                case 'date_fin_asc':
                    query += ` ORDER BY pr.date_fin_promo ASC`;
                    break;
                case 'utilisation_desc':
                    query += ` ORDER BY pr.utilisation_count DESC`;
                    break;
                default:
                    query += ` ORDER BY pr.date_creation DESC`;
            }

            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await db.query(query, params);

            const promos = result.rows.map(promo => ({
                ...promo,
                pourcentage_reduction: promo.pourcentage_reduction ? parseFloat(promo.pourcentage_reduction) : null,
                montant_fixe_reduction: promo.montant_fixe_reduction ? parseFloat(promo.montant_fixe_reduction) : null,
                produits_affectes: promo.produits_affectes || [],
                est_active: promo.actif && 
                           new Date(promo.date_debut_promo) <= new Date() && 
                           new Date(promo.date_fin_promo) >= new Date() &&
                           (promo.utilisation_max === -1 || promo.utilisation_count < promo.utilisation_max)
            }));

            // Compter le total
            let countQuery = `SELECT COUNT(*) as total FROM PROMOSRESTAURANTFASTFOOD WHERE 1=1`;
            const countResult = await db.query(countQuery);

            res.json({
                success: true,
                data: promos,
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
     * Récupérer une promotion par ID
     * GET /api/v1/restauration/promos/:id
     */
    static async getById(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT 
                    pr.*,
                    erf.nom_emplacement,
                    erf.adresse_complete,
                    rf.nom_restaurant_fast_food,
                    rf.logo_restaurant,
                    (
                        SELECT json_agg(json_build_object(
                            'id', m.id,
                            'nom', m.nom_menu,
                            'prix', m.prix_menu,
                            'photo', m.photo_menu
                        ))
                        FROM PROMOSMENUS pm
                        JOIN MENURESTAURANTFASTFOOD m ON m.id = pm.menu_id
                        WHERE pm.promo_id = pr.id
                    ) as menus_associes,
                    (
                        SELECT json_agg(json_build_object(
                            'id', p.id,
                            'nom', p.nom_produit,
                            'prix', p.prix_produit,
                            'photo', p.photo_produit
                        ))
                        FROM PROMOSPRODUITS pp
                        JOIN PRODUITSINDIVIDUELRESTAURANT p ON p.id = pp.produit_id
                        WHERE pp.promo_id = pr.id
                    ) as produits_associes
                FROM PROMOSRESTAURANTFASTFOOD pr
                LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = pr.id_restaurant_fast_food_emplacement
                LEFT JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
                WHERE pr.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Promotion non trouvée', 404);
            }

            const promo = result.rows[0];
            
            // Calculer le statut actuel
            const maintenant = new Date();
            promo.est_active = promo.actif && 
                              new Date(promo.date_debut_promo) <= maintenant && 
                              new Date(promo.date_fin_promo) >= maintenant &&
                              (promo.utilisation_max === -1 || promo.utilisation_count < promo.utilisation_max);
            
            promo.jours_restants = Math.ceil((new Date(promo.date_fin_promo) - maintenant) / (1000 * 60 * 60 * 24));
            
            if (promo.pourcentage_reduction) {
                promo.pourcentage_reduction = parseFloat(promo.pourcentage_reduction);
            }
            if (promo.montant_fixe_reduction) {
                promo.montant_fixe_reduction = parseFloat(promo.montant_fixe_reduction);
            }

            res.json({
                success: true,
                data: promo
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Créer une nouvelle promotion
     * POST /api/v1/restauration/emplacements/:emplacementId/promos
     */
    static async create(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { emplacementId } = req.params;
            const {
                nom_promo,
                description_promo,
                code_promo,
                type_promo,
                pourcentage_reduction,
                montant_fixe_reduction,
                date_debut_promo,
                date_fin_promo,
                utilisation_max,
                produits_affectes
            } = req.body;

            // Vérifier que l'emplacement existe
            const emplacementExists = await client.query(
                `SELECT id FROM EMPLACEMENTSRESTAURANTFASTFOOD WHERE id = $1`,
                [emplacementId]
            );

            if (emplacementExists.rows.length === 0) {
                throw new AppError('Emplacement non trouvé', 404);
            }

            // Valider les dates
            if (new Date(date_fin_promo) <= new Date(date_debut_promo)) {
                throw new ValidationError('La date de fin doit être après la date de début');
            }

            // Valider le type de réduction
            if (type_promo === 'POURCENTAGE' && (!pourcentage_reduction || pourcentage_reduction <= 0 || pourcentage_reduction > 100)) {
                throw new ValidationError('Pourcentage de réduction invalide (doit être entre 1 et 100)');
            }

            if (type_promo === 'MONTANT_FIXE' && (!montant_fixe_reduction || montant_fixe_reduction <= 0)) {
                throw new ValidationError('Montant de réduction invalide');
            }

            // Vérifier si le code promo est unique (si fourni)
            if (code_promo) {
                const existingCode = await client.query(
                    `SELECT id FROM PROMOSRESTAURANTFASTFOOD WHERE code_promo = $1`,
                    [code_promo]
                );
                if (existingCode.rows.length > 0) {
                    throw new ValidationError('Ce code promo existe déjà');
                }
            }

            const result = await client.query(
                `INSERT INTO PROMOSRESTAURANTFASTFOOD (
                    nom_promo,
                    description_promo,
                    code_promo,
                    type_promo,
                    pourcentage_reduction,
                    montant_fixe_reduction,
                    date_debut_promo,
                    date_fin_promo,
                    utilisation_max,
                    utilisation_count,
                    produits_affectes,
                    id_restaurant_fast_food_emplacement,
                    actif,
                    date_creation,
                    date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $11, true, NOW(), NOW())
                RETURNING *`,
                [
                    nom_promo,
                    description_promo,
                    code_promo,
                    type_promo,
                    pourcentage_reduction,
                    montant_fixe_reduction,
                    date_debut_promo,
                    date_fin_promo,
                    utilisation_max || -1,
                    JSON.stringify(produits_affectes || []),
                    emplacementId
                ]
            );

            const newPromo = result.rows[0];

            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'PROMOSRESTAURANTFASTFOOD',
                ressource_id: newPromo.id,
                donnees_apres: newPromo,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Promotion créée avec succès',
                data: newPromo
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour une promotion
     * PUT /api/v1/restauration/promos/:id
     */
    static async update(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const {
                nom_promo,
                description_promo,
                code_promo,
                type_promo,
                pourcentage_reduction,
                montant_fixe_reduction,
                date_debut_promo,
                date_fin_promo,
                utilisation_max,
                produits_affectes,
                actif
            } = req.body;

            const currentResult = await client.query(
                `SELECT * FROM PROMOSRESTAURANTFASTFOOD WHERE id = $1`,
                [id]
            );

            if (currentResult.rows.length === 0) {
                throw new AppError('Promotion non trouvée', 404);
            }

            const current = currentResult.rows[0];

            // Valider les dates si fournies
            if (date_debut_promo && date_fin_promo) {
                if (new Date(date_fin_promo) <= new Date(date_debut_promo)) {
                    throw new ValidationError('La date de fin doit être après la date de début');
                }
            }

            // Valider le type de réduction si modifié
            if (type_promo) {
                if (type_promo === 'POURCENTAGE' && (!pourcentage_reduction || pourcentage_reduction <= 0 || pourcentage_reduction > 100)) {
                    throw new ValidationError('Pourcentage de réduction invalide');
                }
                if (type_promo === 'MONTANT_FIXE' && (!montant_fixe_reduction || montant_fixe_reduction <= 0)) {
                    throw new ValidationError('Montant de réduction invalide');
                }
            }

            // Vérifier l'unicité du code promo si modifié
            if (code_promo && code_promo !== current.code_promo) {
                const existingCode = await client.query(
                    `SELECT id FROM PROMOSRESTAURANTFASTFOOD WHERE code_promo = $1 AND id != $2`,
                    [code_promo, id]
                );
                if (existingCode.rows.length > 0) {
                    throw new ValidationError('Ce code promo existe déjà');
                }
            }

            let updates = [];
            let params = [];
            let paramIndex = 1;

            if (nom_promo) {
                updates.push(`nom_promo = $${paramIndex++}`);
                params.push(nom_promo);
            }

            if (description_promo !== undefined) {
                updates.push(`description_promo = $${paramIndex++}`);
                params.push(description_promo);
            }

            if (code_promo !== undefined) {
                updates.push(`code_promo = $${paramIndex++}`);
                params.push(code_promo);
            }

            if (type_promo) {
                updates.push(`type_promo = $${paramIndex++}`);
                params.push(type_promo);
            }

            if (pourcentage_reduction !== undefined) {
                updates.push(`pourcentage_reduction = $${paramIndex++}`);
                params.push(pourcentage_reduction);
            }

            if (montant_fixe_reduction !== undefined) {
                updates.push(`montant_fixe_reduction = $${paramIndex++}`);
                params.push(montant_fixe_reduction);
            }

            if (date_debut_promo) {
                updates.push(`date_debut_promo = $${paramIndex++}`);
                params.push(date_debut_promo);
            }

            if (date_fin_promo) {
                updates.push(`date_fin_promo = $${paramIndex++}`);
                params.push(date_fin_promo);
            }

            if (utilisation_max !== undefined) {
                updates.push(`utilisation_max = $${paramIndex++}`);
                params.push(utilisation_max);
            }

            if (produits_affectes) {
                updates.push(`produits_affectes = $${paramIndex++}`);
                params.push(JSON.stringify(produits_affectes));
            }

            if (actif !== undefined) {
                updates.push(`actif = $${paramIndex++}`);
                params.push(actif);
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
                UPDATE PROMOSRESTAURANTFASTFOOD 
                SET ${updates.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING *
            `;

            const result = await client.query(updateQuery, params);

            const updated = result.rows[0];

            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'PROMOSRESTAURANTFASTFOOD',
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
                message: 'Promotion mise à jour avec succès',
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
     * Associer des menus à une promotion
     * POST /api/v1/restauration/promos/:id/menus
     */
    static async addMenus(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { menu_ids } = req.body;

            if (!menu_ids || !Array.isArray(menu_ids) || menu_ids.length === 0) {
                throw new ValidationError('Liste des menus requise');
            }

            // Vérifier que la promotion existe
            const promoExists = await client.query(
                `SELECT id FROM PROMOSRESTAURANTFASTFOOD WHERE id = $1`,
                [id]
            );

            if (promoExists.rows.length === 0) {
                throw new AppError('Promotion non trouvée', 404);
            }

            // Insérer les associations
            for (const menuId of menu_ids) {
                await client.query(
                    `INSERT INTO PROMOSMENUS (promo_id, menu_id)
                     VALUES ($1, $2)
                     ON CONFLICT (promo_id, menu_id) DO NOTHING`,
                    [id, menuId]
                );
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                message: `${menu_ids.length} menu(s) associé(s) avec succès`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Associer des produits à une promotion
     * POST /api/v1/restauration/promos/:id/produits
     */
    static async addProduits(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { produit_ids } = req.body;

            if (!produit_ids || !Array.isArray(produit_ids) || produit_ids.length === 0) {
                throw new ValidationError('Liste des produits requise');
            }

            // Vérifier que la promotion existe
            const promoExists = await client.query(
                `SELECT id FROM PROMOSRESTAURANTFASTFOOD WHERE id = $1`,
                [id]
            );

            if (promoExists.rows.length === 0) {
                throw new AppError('Promotion non trouvée', 404);
            }

            // Insérer les associations
            for (const produitId of produit_ids) {
                await client.query(
                    `INSERT INTO PROMOSPRODUITS (promo_id, produit_id)
                     VALUES ($1, $2)
                     ON CONFLICT (promo_id, produit_id) DO NOTHING`,
                    [id, produitId]
                );
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                message: `${produit_ids.length} produit(s) associé(s) avec succès`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Retirer des menus d'une promotion
     * DELETE /api/v1/restauration/promos/:id/menus
     */
    static async removeMenus(req, res, next) {
        const client = await db.getConnection();
        try {
            const { id } = req.params;
            const { menu_ids } = req.body;

            if (!menu_ids || !Array.isArray(menu_ids) || menu_ids.length === 0) {
                throw new ValidationError('Liste des menus requise');
            }

            const result = await client.query(
                `DELETE FROM PROMOSMENUS 
                 WHERE promo_id = $1 AND menu_id = ANY($2::int[])
                 RETURNING menu_id`,
                [id, menu_ids]
            );

            res.json({
                success: true,
                message: `${result.rowCount} menu(s) retiré(s) avec succès`
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Retirer des produits d'une promotion
     * DELETE /api/v1/restauration/promos/:id/produits
     */
    static async removeProduits(req, res, next) {
        const client = await db.getConnection();
        try {
            const { id } = req.params;
            const { produit_ids } = req.body;

            if (!produit_ids || !Array.isArray(produit_ids) || produit_ids.length === 0) {
                throw new ValidationError('Liste des produits requise');
            }

            const result = await client.query(
                `DELETE FROM PROMOSPRODUITS 
                 WHERE promo_id = $1 AND produit_id = ANY($2::int[])
                 RETURNING produit_id`,
                [id, produit_ids]
            );

            res.json({
                success: true,
                message: `${result.rowCount} produit(s) retiré(s) avec succès`
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Valider et utiliser un code promo
     * POST /api/v1/restauration/promos/valider
     */
    static async validateAndUse(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { code_promo, montant_commande, produits_ids } = req.body;

            if (!code_promo) {
                throw new ValidationError('Code promo requis');
            }

            // Récupérer la promotion
            const promoResult = await client.query(
                `SELECT * FROM PROMOSRESTAURANTFASTFOOD 
                 WHERE code_promo = $1 AND actif = true`,
                [code_promo]
            );

            if (promoResult.rows.length === 0) {
                throw new AppError('Code promo invalide', 404);
            }

            const promo = promoResult.rows[0];
            const maintenant = new Date();

            // Vérifier les dates
            if (maintenant < new Date(promo.date_debut_promo)) {
                throw new AppError('Cette promotion n\'est pas encore active', 400);
            }

            if (maintenant > new Date(promo.date_fin_promo)) {
                throw new AppError('Cette promotion a expiré', 400);
            }

            // Vérifier le nombre d'utilisations
            if (promo.utilisation_max !== -1 && promo.utilisation_count >= promo.utilisation_max) {
                throw new AppError('Cette promotion a atteint sa limite d\'utilisation', 400);
            }

            // Vérifier si les produits sont éligibles
            if (promo.produits_affectes && promo.produits_affectes.length > 0 && produits_ids) {
                const produitsEligibles = promo.produits_affectes.filter(id => produits_ids.includes(id));
                if (produitsEligibles.length === 0) {
                    throw new AppError('Aucun produit éligible à cette promotion dans votre commande', 400);
                }
            }

            // Calculer la réduction
            let montantReduction = 0;
            let nouveauMontant = montant_commande;

            switch (promo.type_promo) {
                case 'POURCENTAGE':
                    montantReduction = montant_commande * (promo.pourcentage_reduction / 100);
                    nouveauMontant = montant_commande - montantReduction;
                    break;
                case 'MONTANT_FIXE':
                    montantReduction = Math.min(promo.montant_fixe_reduction, montant_commande);
                    nouveauMontant = montant_commande - montantReduction;
                    break;
                case 'LIVRAISON_GRATUITE':
                    montantReduction = 0; // La livraison sera gérée séparément
                    nouveauMontant = montant_commande;
                    break;
                case 'DEUX_POUR_UN':
                    // Logique spéciale à implémenter
                    break;
            }

            // Incrémenter le compteur d'utilisations
            await client.query(
                `UPDATE PROMOSRESTAURANTFASTFOOD 
                 SET utilisation_count = utilisation_count + 1
                 WHERE id = $1`,
                [promo.id]
            );

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Code promo valide',
                data: {
                    promo: {
                        id: promo.id,
                        nom: promo.nom_promo,
                        type: promo.type_promo,
                        code: promo.code_promo
                    },
                    calcul: {
                        montant_initial: montant_commande,
                        montant_reduction: montantReduction,
                        nouveau_montant: nouveauMontant,
                        livraison_gratuite: promo.type_promo === 'LIVRAISON_GRATUITE'
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
     * Récupérer les promotions actives
     * GET /api/v1/restauration/promos/actives
     */
    static async getActivePromos(req, res, next) {
        try {
            const { emplacement_id, restaurant_id, limit = 10 } = req.query;

            let query = `
                SELECT 
                    pr.id, 
                    pr.nom_promo,
                    pr.description_promo,
                    pr.code_promo,
                    pr.type_promo,
                    pr.pourcentage_reduction,
                    pr.montant_fixe_reduction,
                    pr.date_fin_promo,
                    pr.produits_affectes,
                    erf.nom_emplacement,
                    rf.nom_restaurant_fast_food
                FROM PROMOSRESTAURANTFASTFOOD pr
                JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = pr.id_restaurant_fast_food_emplacement
                JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
                WHERE pr.actif = true
                  AND pr.date_debut_promo <= NOW()
                  AND pr.date_fin_promo >= NOW()
                  AND (pr.utilisation_max = -1 OR pr.utilisation_count < pr.utilisation_max)
            `;

            const params = [];
            let paramIndex = 1;

            if (emplacement_id) {
                query += ` AND pr.id_restaurant_fast_food_emplacement = $${paramIndex}`;
                params.push(emplacement_id);
                paramIndex++;
            }

            if (restaurant_id) {
                query += ` AND erf.id_restaurant_fast_food = $${paramIndex}`;
                params.push(restaurant_id);
                paramIndex++;
            }

            query += ` ORDER BY pr.date_fin_promo ASC LIMIT $${paramIndex}`;
            params.push(limit);

            const result = await db.query(query, params);

            const promos = result.rows.map(promo => ({
                ...promo,
                jours_restants: Math.ceil((new Date(promo.date_fin_promo) - new Date()) / (1000 * 60 * 60 * 24)),
                pourcentage_reduction: promo.pourcentage_reduction ? parseFloat(promo.pourcentage_reduction) : null,
                montant_fixe_reduction: promo.montant_fixe_reduction ? parseFloat(promo.montant_fixe_reduction) : null
            }));

            res.json({
                success: true,
                data: promos
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les statistiques des promotions
     * GET /api/v1/restauration/promos/stats
     */
    static async getStats(req, res, next) {
        try {
            const { emplacement_id, restaurant_id } = req.query;

            let query = `
                SELECT 
                    COUNT(*) as total_promos,
                    COUNT(*) FILTER (WHERE actif = true) as promos_actives,
                    COUNT(*) FILTER (WHERE actif = false) as promos_inactives,
                    COUNT(*) FILTER (
                        WHERE actif = true 
                          AND date_debut_promo <= NOW() 
                          AND date_fin_promo >= NOW()
                    ) as promos_en_cours,
                    COUNT(*) FILTER (
                        WHERE date_fin_promo < NOW()
                    ) as promos_expirees,
                    COUNT(*) FILTER (
                        WHERE date_debut_promo > NOW()
                    ) as promos_a_venir,
                    AVG(utilisation_count)::numeric(10,2) as utilisation_moyenne,
                    SUM(utilisation_count) as total_utilisations,
                    COUNT(DISTINCT type_promo) as types_promos
                FROM PROMOSRESTAURANTFASTFOOD pr
                LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = pr.id_restaurant_fast_food_emplacement
                WHERE 1=1
            `;

            const params = [];

            if (emplacement_id) {
                query += ` AND pr.id_restaurant_fast_food_emplacement = $1`;
                params.push(emplacement_id);
            }

            if (restaurant_id) {
                query += ` AND erf.id_restaurant_fast_food = $2`;
                params.push(restaurant_id);
            }

            const result = await db.query(query, params);

            // Statistiques par type
            let typeQuery = `
                SELECT 
                    type_promo,
                    COUNT(*) as total,
                    AVG(utilisation_count)::numeric(10,2) as utilisation_moyenne
                FROM PROMOSRESTAURANTFASTFOOD pr
                LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = pr.id_restaurant_fast_food_emplacement
                WHERE 1=1
            `;

            if (emplacement_id) {
                typeQuery += ` AND pr.id_restaurant_fast_food_emplacement = $1`;
            }

            if (restaurant_id) {
                typeQuery += ` AND erf.id_restaurant_fast_food = $2`;
            }

            typeQuery += ` GROUP BY type_promo`;

            const typeResult = await db.query(typeQuery, params);

            res.json({
                success: true,
                data: {
                    ...result.rows[0],
                    statistiques_par_type: typeResult.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Désactiver une promotion
     * PATCH /api/v1/restauration/promos/:id/desactiver
     */
    static async deactivate(req, res, next) {
        const client = await db.getConnection();
        try {
            const { id } = req.params;

            const result = await client.query(
                `UPDATE PROMOSRESTAURANTFASTFOOD 
                 SET actif = false, date_mise_a_jour = NOW()
                 WHERE id = $1 AND actif = true
                 RETURNING *`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Promotion non trouvée ou déjà inactive', 404);
            }

            await AuditService.log({
                action: 'DEACTIVATE',
                ressource_type: 'PROMOSRESTAURANTFASTFOOD',
                ressource_id: id,
                donnees_apres: result.rows[0],
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            res.json({
                success: true,
                message: 'Promotion désactivée avec succès',
                data: result.rows[0]
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Activer une promotion
     * PATCH /api/v1/restauration/promos/:id/activer
     */
    static async activate(req, res, next) {
        const client = await db.getConnection();
        try {
            const { id } = req.params;

            const result = await client.query(
                `UPDATE PROMOSRESTAURANTFASTFOOD 
                 SET actif = true, date_mise_a_jour = NOW()
                 WHERE id = $1 AND actif = false
                 RETURNING *`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Promotion non trouvée ou déjà active', 404);
            }

            res.json({
                success: true,
                message: 'Promotion activée avec succès',
                data: result.rows[0]
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer une promotion
     * DELETE /api/v1/restauration/promos/:id
     */
    static async delete(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            // Supprimer les associations
            await client.query(`DELETE FROM PROMOSMENUS WHERE promo_id = $1`, [id]);
            await client.query(`DELETE FROM PROMOSPRODUITS WHERE promo_id = $1`, [id]);

            // Supprimer la promotion
            const result = await client.query(
                `DELETE FROM PROMOSRESTAURANTFASTFOOD WHERE id = $1 RETURNING *`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Promotion non trouvée', 404);
            }

            await AuditService.log({
                action: 'DELETE',
                ressource_type: 'PROMOSRESTAURANTFASTFOOD',
                ressource_id: id,
                donnees_avant: result.rows[0],
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Promotion supprimée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Dupliquer une promotion
     * POST /api/v1/restauration/promos/:id/dupliquer
     */
    static async duplicate(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { nouveau_nom, nouvelles_dates } = req.body;

            // Récupérer la promotion source
            const sourceResult = await client.query(
                `SELECT * FROM PROMOSRESTAURANTFASTFOOD WHERE id = $1`,
                [id]
            );

            if (sourceResult.rows.length === 0) {
                throw new AppError('Promotion non trouvée', 404);
            }

            const source = sourceResult.rows[0];

            // Calculer les nouvelles dates
            let dateDebut = source.date_debut_promo;
            let dateFin = source.date_fin_promo;

            if (nouvelles_dates) {
                const duree = new Date(source.date_fin_promo) - new Date(source.date_debut_promo);
                dateDebut = nouvelles_dates.debut || new Date();
                dateFin = nouvelles_dates.fin || new Date(new Date(dateDebut).getTime() + duree);
            }

            // Générer un nouveau code promo
            const nouveauCode = source.code_promo ? `${source.code_promo}_COPY_${Date.now()}` : null;

            // Créer la copie
            const result = await client.query(
                `INSERT INTO PROMOSRESTAURANTFASTFOOD (
                    nom_promo,
                    description_promo,
                    code_promo,
                    type_promo,
                    pourcentage_reduction,
                    montant_fixe_reduction,
                    date_debut_promo,
                    date_fin_promo,
                    utilisation_max,
                    utilisation_count,
                    produits_affectes,
                    id_restaurant_fast_food_emplacement,
                    actif,
                    date_creation,
                    date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $11, false, NOW(), NOW())
                RETURNING *`,
                [
                    nouveau_nom || `Copie de ${source.nom_promo}`,
                    source.description_promo,
                    nouveauCode,
                    source.type_promo,
                    source.pourcentage_reduction,
                    source.montant_fixe_reduction,
                    dateDebut,
                    dateFin,
                    source.utilisation_max,
                    source.produits_affectes,
                    source.id_restaurant_fast_food_emplacement
                ]
            );

            const newPromo = result.rows[0];

            // Dupliquer les associations de menus
            const menusResult = await client.query(
                `SELECT menu_id FROM PROMOSMENUS WHERE promo_id = $1`,
                [id]
            );

            for (const row of menusResult.rows) {
                await client.query(
                    `INSERT INTO PROMOSMENUS (promo_id, menu_id) VALUES ($1, $2)`,
                    [newPromo.id, row.menu_id]
                );
            }

            // Dupliquer les associations de produits
            const produitsResult = await client.query(
                `SELECT produit_id FROM PROMOSPRODUITS WHERE promo_id = $1`,
                [id]
            );

            for (const row of produitsResult.rows) {
                await client.query(
                    `INSERT INTO PROMOSPRODUITS (promo_id, produit_id) VALUES ($1, $2)`,
                    [newPromo.id, row.produit_id]
                );
            }

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Promotion dupliquée avec succès',
                data: {
                    nouvelle_promo: newPromo,
                    source: {
                        id: source.id,
                        nom: source.nom_promo
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
}

module.exports = PromoController;