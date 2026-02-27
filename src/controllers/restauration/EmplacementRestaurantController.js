const db = require('../../configuration/database');
const { AppError, ValidationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const FileService = require('../../services/file/FileService');
const GeoService = require('../../services/geo/GeoService');

class EmplacementRestaurantController {
    /**
     * Récupérer tous les emplacements d'un restaurant
     * GET /api/v1/restauration/restaurants/:restaurantId/emplacements
     */
    static async getAll(req, res, next) {
        try {
            const { restaurantId } = req.params;
            const {
                page = 1,
                limit = 20,
                actif,
                recherche,
                avec_menu = false
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    erf.id, 
                    erf.nom_emplacement,
                    erf.logo_restaurant,
                    erf.favicon_restaurant,
                    ST_AsGeoJSON(erf.localisation_restaurant) as localisation,
                    erf.adresse_complete,
                    erf.frais_livraison,
                    erf.portefeuille_emplacement,
                    erf.heure_ouverture,
                    erf.heure_fermeture,
                    erf.jours_ouverture_emplacement_restaurant,
                    erf.est_actif,
                    erf.date_creation,
                    rf.nom_restaurant_fast_food
            `;

            if (avec_menu === 'true') {
                query += `,
                    (
                        SELECT COUNT(*) FROM MENURESTAURANTFASTFOOD m 
                        WHERE m.id_restaurant_fast_food_emplacement = erf.id 
                          AND m.disponible = true
                    ) as nombre_menus,
                    (
                        SELECT COUNT(*) FROM PRODUITSINDIVIDUELRESTAURANT p 
                        WHERE p.id_restaurant_fast_food_emplacement = erf.id 
                          AND p.disponible = true
                    ) as nombre_produits
                `;
            }

            query += `
                FROM EMPLACEMENTSRESTAURANTFASTFOOD erf
                JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
                WHERE erf.id_restaurant_fast_food = $1
            `;

            const params = [restaurantId];
            let paramIndex = 2;

            if (actif !== undefined) {
                query += ` AND erf.est_actif = $${paramIndex}`;
                params.push(actif === 'true');
                paramIndex++;
            }

            if (recherche) {
                query += ` AND erf.nom_emplacement ILIKE $${paramIndex}`;
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            query += ` ORDER BY erf.nom_emplacement ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await db.query(query, params);

            const emplacements = result.rows.map(emp => ({
                ...emp,
                localisation: emp.localisation ? JSON.parse(emp.localisation) : null,
                frais_livraison: parseFloat(emp.frais_livraison),
                portefeuille_emplacement: parseFloat(emp.portefeuille_emplacement)
            }));

            const countResult = await db.query(
                `SELECT COUNT(*) as total 
                 FROM EMPLACEMENTSRESTAURANTFASTFOOD 
                 WHERE id_restaurant_fast_food = $1`,
                [restaurantId]
            );

            res.json({
                success: true,
                data: emplacements,
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
     * Récupérer un emplacement par ID
     * GET /api/v1/restauration/emplacements/:id
     */
    static async getById(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT 
                    erf.*,
                    ST_AsGeoJSON(erf.localisation_restaurant) as localisation,
                    rf.nom_restaurant_fast_food,
                    rf.logo_restaurant as logo_restaurant_principal,
                    (
                        SELECT json_agg(json_build_object(
                            'id', m.id,
                            'nom', m.nom_menu,
                            'description', m.description_menu,
                            'prix', m.prix_menu,
                            'photo', m.photo_menu,
                            'categorie', m.categorie_menu,
                            'disponible', m.disponible,
                            'temps_preparation', m.temps_preparation_min
                        ) ORDER BY m.nom_menu)
                        FROM MENURESTAURANTFASTFOOD m
                        WHERE m.id_restaurant_fast_food_emplacement = erf.id
                        LIMIT 10
                    ) as apercu_menus,
                    (
                        SELECT json_agg(json_build_object(
                            'id', p.id,
                            'nom', p.nom_produit,
                            'prix', p.prix_produit,
                            'photo', p.photo_produit,
                            'categorie', p.categorie_produit
                        ) ORDER BY p.nom_produit)
                        FROM PRODUITSINDIVIDUELRESTAURANT p
                        WHERE p.id_restaurant_fast_food_emplacement = erf.id
                        LIMIT 10
                    ) as apercu_produits,
                    (
                        SELECT 
                            AVG(note_globale) as note_moyenne,
                            COUNT(*) as nombre_avis
                        FROM AVIS 
                        WHERE entite_type = 'EMPLACEMENT_RESTAURANT' 
                          AND entite_id = erf.id 
                          AND statut = 'PUBLIE'
                    ) as notes
                FROM EMPLACEMENTSRESTAURANTFASTFOOD erf
                JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
                WHERE erf.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Emplacement non trouvé', 404);
            }

            const emplacement = result.rows[0];
            
            if (emplacement.localisation) {
                emplacement.localisation = JSON.parse(emplacement.localisation);
            }

            // Formater les horaires
            if (emplacement.heure_ouverture) {
                emplacement.heure_ouverture = emplacement.heure_ouverture.substring(0, 5);
            }
            if (emplacement.heure_fermeture) {
                emplacement.heure_fermeture = emplacement.heure_fermeture.substring(0, 5);
            }

            res.json({
                success: true,
                data: emplacement
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Créer un nouvel emplacement
     * POST /api/v1/restauration/restaurants/:restaurantId/emplacements
     */
    static async create(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { restaurantId } = req.params;
            const {
                nom_emplacement,
                logo_restaurant,
                favicon_restaurant,
                localisation,
                adresse_complete,
                frais_livraison,
                heure_ouverture,
                heure_fermeture,
                jours_ouverture
            } = req.body;

            // Vérifier que le restaurant existe
            const restaurantExists = await client.query(
                `SELECT id FROM RESTAURANTSFASTFOOD WHERE id = $1`,
                [restaurantId]
            );

            if (restaurantExists.rows.length === 0) {
                throw new AppError('Restaurant non trouvé', 404);
            }

            // Vérifier les horaires
            if (heure_ouverture && heure_fermeture && heure_fermeture <= heure_ouverture) {
                throw new ValidationError('L\'heure de fermeture doit être après l\'heure d\'ouverture');
            }

            const result = await client.query(
                `INSERT INTO EMPLACEMENTSRESTAURANTFASTFOOD (
                    nom_emplacement,
                    logo_restaurant,
                    favicon_restaurant,
                    localisation_restaurant,
                    adresse_complete,
                    frais_livraison,
                    heure_ouverture,
                    heure_fermeture,
                    jours_ouverture_emplacement_restaurant,
                    id_restaurant_fast_food,
                    date_creation,
                    date_mise_a_jour
                ) VALUES (
                    $1, $2, $3, 
                    ST_SetSRID(ST_MakePoint($4, $5), 4326),
                    $6, $7, $8, $9, $10, $11, NOW(), NOW()
                )
                RETURNING *`,
                [
                    nom_emplacement,
                    logo_restaurant,
                    favicon_restaurant,
                    localisation.lng,
                    localisation.lat,
                    adresse_complete,
                    frais_livraison || 0,
                    heure_ouverture,
                    heure_fermeture,
                    jours_ouverture || 'LUNDI_VENDREDI',
                    restaurantId
                ]
            );

            const newEmplacement = result.rows[0];

            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'EMPLACEMENTSRESTAURANTFASTFOOD',
                ressource_id: newEmplacement.id,
                donnees_apres: newEmplacement,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Emplacement créé avec succès',
                data: newEmplacement
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour un emplacement
     * PUT /api/v1/restauration/emplacements/:id
     */
    static async update(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const {
                nom_emplacement,
                logo_restaurant,
                favicon_restaurant,
                localisation,
                adresse_complete,
                frais_livraison,
                heure_ouverture,
                heure_fermeture,
                jours_ouverture,
                est_actif
            } = req.body;

            const currentResult = await client.query(
                `SELECT * FROM EMPLACEMENTSRESTAURANTFASTFOOD WHERE id = $1`,
                [id]
            );

            if (currentResult.rows.length === 0) {
                throw new AppError('Emplacement non trouvé', 404);
            }

            const current = currentResult.rows[0];

            // Vérifier les horaires
            if (heure_ouverture && heure_fermeture && heure_fermeture <= heure_ouverture) {
                throw new ValidationError('L\'heure de fermeture doit être après l\'heure d\'ouverture');
            }

            let updates = [];
            let params = [];
            let paramIndex = 1;

            if (nom_emplacement) {
                updates.push(`nom_emplacement = $${paramIndex++}`);
                params.push(nom_emplacement);
            }

            if (logo_restaurant !== undefined) {
                updates.push(`logo_restaurant = $${paramIndex++}`);
                params.push(logo_restaurant);
            }

            if (favicon_restaurant !== undefined) {
                updates.push(`favicon_restaurant = $${paramIndex++}`);
                params.push(favicon_restaurant);
            }

            if (localisation) {
                updates.push(`localisation_restaurant = ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)`);
                params.push(localisation.lng, localisation.lat);
                paramIndex += 2;
            }

            if (adresse_complete) {
                updates.push(`adresse_complete = $${paramIndex++}`);
                params.push(adresse_complete);
            }

            if (frais_livraison !== undefined) {
                updates.push(`frais_livraison = $${paramIndex++}`);
                params.push(frais_livraison);
            }

            if (heure_ouverture !== undefined) {
                updates.push(`heure_ouverture = $${paramIndex++}`);
                params.push(heure_ouverture);
            }

            if (heure_fermeture !== undefined) {
                updates.push(`heure_fermeture = $${paramIndex++}`);
                params.push(heure_fermeture);
            }

            if (jours_ouverture) {
                updates.push(`jours_ouverture_emplacement_restaurant = $${paramIndex++}`);
                params.push(jours_ouverture);
            }

            if (est_actif !== undefined) {
                updates.push(`est_actif = $${paramIndex++}`);
                params.push(est_actif);
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
                UPDATE EMPLACEMENTSRESTAURANTFASTFOOD 
                SET ${updates.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING *
            `;

            const result = await client.query(updateQuery, params);

            const updated = result.rows[0];

            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'EMPLACEMENTSRESTAURANTFASTFOOD',
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
                message: 'Emplacement mis à jour avec succès',
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
     * Upload du logo de l'emplacement
     * POST /api/v1/restauration/emplacements/:id/logo
     */
    static async uploadLogo(req, res, next) {
        const client = await db.getConnection();
        try {
            const { id } = req.params;

            if (!req.file) {
                throw new ValidationError('Aucun fichier fourni');
            }

            const fileResult = await FileService.upload(req.file, {
                folder: 'emplacements-restaurants',
                entityId: id,
                resize: true,
                sizes: [
                    { width: 200, height: 200, suffix: 'small' },
                    { width: 400, height: 400, suffix: 'medium' },
                    { width: 800, height: 800, suffix: 'large' }
                ]
            });

            await client.query(
                `UPDATE EMPLACEMENTSRESTAURANTFASTFOOD 
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
     * Récupérer le menu complet de l'emplacement
     * GET /api/v1/restauration/emplacements/:id/menu
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
                            'stock', m.stock_disponible
                        ) ORDER BY m.prix_menu) as menus
                    FROM MENURESTAURANTFASTFOOD m
                    WHERE m.id_restaurant_fast_food_emplacement = $1 
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
                            'disponible', p.disponible
                        ) ORDER BY p.prix_produit) as produits
                    FROM PRODUITSINDIVIDUELRESTAURANT p
                    WHERE p.id_restaurant_fast_food_emplacement = $1 
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
                            ELSE -1 END
                    )) as promos
                    FROM PROMOSRESTAURANTFASTFOOD pr
                    WHERE pr.id_restaurant_fast_food_emplacement = $1
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
                    emplacement_id: id
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Vérifier la disponibilité de l'emplacement
     * GET /api/v1/restauration/emplacements/:id/disponibilite
     */
    static async checkDisponibilite(req, res, next) {
        try {
            const { id } = req.params;
            const { date } = req.query;

            const checkDate = date ? new Date(date) : new Date();

            const estOuvert = await db.query(
                `SELECT fn_est_ouvert('EMPLACEMENT_RESTAURANT'::entite_reference, $1, $2) as est_ouvert`,
                [id, checkDate]
            );

            // Récupérer les horaires détaillés
            const horairesResult = await db.query(
                `SELECT 
                    jour_semaine,
                    heure_ouverture,
                    heure_fermeture,
                    heure_coupure_debut,
                    heure_coupure_fin,
                    est_ouvert
                FROM HORAIRES
                WHERE entite_type = 'EMPLACEMENT_RESTAURANT' 
                  AND entite_id = $1
                ORDER BY jour_semaine`,
                [id]
            );

            // Récupérer les exceptions
            const exceptionsResult = await db.query(
                `SELECT 
                    date_exception,
                    libelle,
                    est_ouvert,
                    heure_ouverture,
                    heure_fermeture
                FROM HORAIRES_EXCEPTIONS
                WHERE entite_type = 'EMPLACEMENT_RESTAURANT' 
                  AND entite_id = $1
                  AND date_exception >= CURRENT_DATE
                ORDER BY date_exception
                LIMIT 10`,
                [id]
            );

            res.json({
                success: true,
                data: {
                    emplacement_id: id,
                    date: checkDate,
                    est_ouvert: estOuvert.rows[0].est_ouvert,
                    horaires: horairesResult.rows,
                    exceptions: exceptionsResult.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les statistiques de l'emplacement
     * GET /api/v1/restauration/emplacements/:id/stats
     */
    static async getStats(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT 
                    erf.id,
                    erf.nom_emplacement,
                    erf.portefeuille_emplacement,
                    COUNT(DISTINCT m.id) as total_menus,
                    COUNT(DISTINCT p.id) as total_produits,
                    COUNT(DISTINCT c.id) as total_commandes,
                    COALESCE(SUM(c.prix_total_commande), 0) as chiffre_affaires_total,
                    AVG(c.prix_total_commande) as panier_moyen,
                    (
                        SELECT COUNT(*) 
                        FROM COMMANDESEMPLACEMENTFASTFOOD c2
                        WHERE c2.id_restaurant_fast_food_emplacement = erf.id
                          AND c2.statut_commande = 'EN_ATTENTE'
                    ) as commandes_en_attente,
                    (
                        SELECT COUNT(*) 
                        FROM COMMANDESEMPLACEMENTFASTFOOD c3
                        WHERE c3.id_restaurant_fast_food_emplacement = erf.id
                          AND c3.date_commande >= NOW() - INTERVAL '24 hours'
                    ) as commandes_24h,
                    (
                        SELECT json_agg(json_build_object(
                            'nom', m2.nom_menu,
                            'ventes', COUNT(c4.id)
                        ))
                        FROM MENURESTAURANTFASTFOOD m2
                        LEFT JOIN COMMANDESEMPLACEMENTFASTFOOD c4 
                            ON c4.id_restaurant_fast_food_emplacement = erf.id
                        WHERE m2.id_restaurant_fast_food_emplacement = erf.id
                        GROUP BY m2.id, m2.nom_menu
                        ORDER BY COUNT(c4.id) DESC
                        LIMIT 5
                    ) as menus_populaires
                FROM EMPLACEMENTSRESTAURANTFASTFOOD erf
                LEFT JOIN MENURESTAURANTFASTFOOD m ON m.id_restaurant_fast_food_emplacement = erf.id
                LEFT JOIN PRODUITSINDIVIDUELRESTAURANT p ON p.id_restaurant_fast_food_emplacement = erf.id
                LEFT JOIN COMMANDESEMPLACEMENTFASTFOOD c ON c.id_restaurant_fast_food_emplacement = erf.id
                WHERE erf.id = $1
                GROUP BY erf.id`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Emplacement non trouvé', 404);
            }

            res.json({
                success: true,
                data: {
                    ...result.rows[0],
                    portefeuille_emplacement: parseFloat(result.rows[0].portefeuille_emplacement),
                    chiffre_affaires_total: parseFloat(result.rows[0].chiffre_affaires_total),
                    panier_moyen: parseFloat(result.rows[0].panier_moyen)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les commandes de l'emplacement
     * GET /api/v1/restauration/emplacements/:id/commandes
     */
    static async getCommandes(req, res, next) {
        try {
            const { id } = req.params;
            const {
                page = 1,
                limit = 20,
                statut,
                date_debut,
                date_fin
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    c.id,
                    c.reference_commande,
                    c.prix_total_commande,
                    c.statut_commande,
                    c.pour_livrer,
                    c.passer_recuperer,
                    c.paiement_direct,
                    c.paiement_a_la_livraison,
                    c.notes_commande,
                    c.date_commande,
                    comp.nom_utilisateur_compte as client_nom,
                    comp.photo_profil_compte as client_photo,
                    ad.ligne_1 as adresse_livraison,
                    ad.ville as ville_livraison
                FROM COMMANDESEMPLACEMENTFASTFOOD c
                LEFT JOIN COMPTES comp ON comp.id = c.compte_id
                LEFT JOIN ADRESSES ad ON ad.id = c.adresse_livraison_id
                WHERE c.id_restaurant_fast_food_emplacement = $1
            `;

            const params = [id];
            let paramIndex = 2;

            if (statut) {
                query += ` AND c.statut_commande = $${paramIndex}`;
                params.push(statut);
                paramIndex++;
            }

            if (date_debut) {
                query += ` AND c.date_commande >= $${paramIndex}`;
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                query += ` AND c.date_commande <= $${paramIndex}`;
                params.push(date_fin);
                paramIndex++;
            }

            query += ` ORDER BY c.date_commande DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await db.query(query, params);

            // Compter le total
            let countQuery = `
                SELECT COUNT(*) as total 
                FROM COMMANDESEMPLACEMENTFASTFOOD 
                WHERE id_restaurant_fast_food_emplacement = $1
            `;
            const countParams = [id];
            
            if (statut) {
                countQuery += ` AND statut_commande = $2`;
                countParams.push(statut);
            }

            const countResult = await db.query(countQuery, countParams);

            res.json({
                success: true,
                data: result.rows,
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
     * Désactiver un emplacement
     * DELETE /api/v1/restauration/emplacements/:id
     */
    static async delete(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            // Vérifier les dépendances
            const dependencies = await client.query(
                `SELECT 
                    (SELECT COUNT(*) FROM MENURESTAURANTFASTFOOD WHERE id_restaurant_fast_food_emplacement = $1) as menus,
                    (SELECT COUNT(*) FROM PRODUITSINDIVIDUELRESTAURANT WHERE id_restaurant_fast_food_emplacement = $1) as produits,
                    (SELECT COUNT(*) FROM COMMANDESEMPLACEMENTFASTFOOD WHERE id_restaurant_fast_food_emplacement = $1 AND statut_commande NOT IN ('LIVREE', 'RECUPEREE', 'ANNULEE')) as commandes_actives,
                    (SELECT COUNT(*) FROM COMPTES WHERE emplacement_id = $1) as comptes`,
                [id]
            );

            const deps = dependencies.rows[0];
            if (deps.commandes_actives > 0) {
                throw new AppError(
                    'Impossible de désactiver : des commandes sont en cours',
                    409
                );
            }

            const currentResult = await client.query(
                `SELECT * FROM EMPLACEMENTSRESTAURANTFASTFOOD WHERE id = $1`,
                [id]
            );

            if (currentResult.rows.length === 0) {
                throw new AppError('Emplacement non trouvé', 404);
            }

            // Soft delete - désactiver seulement
            await client.query(
                `UPDATE EMPLACEMENTSRESTAURANTFASTFOOD 
                 SET est_actif = false, date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [id]
            );

            // Désactiver aussi les menus et produits
            if (deps.menus > 0) {
                await client.query(
                    `UPDATE MENURESTAURANTFASTFOOD 
                     SET disponible = false
                     WHERE id_restaurant_fast_food_emplacement = $1`,
                    [id]
                );
            }

            if (deps.produits > 0) {
                await client.query(
                    `UPDATE PRODUITSINDIVIDUELRESTAURANT 
                     SET disponible = false
                     WHERE id_restaurant_fast_food_emplacement = $1`,
                    [id]
                );
            }

            await AuditService.log({
                action: 'DELETE',
                ressource_type: 'EMPLACEMENTSRESTAURANTFASTFOOD',
                ressource_id: id,
                donnees_avant: currentResult.rows[0],
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Emplacement désactivé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Réactiver un emplacement
     * POST /api/v1/restauration/emplacements/:id/reactiver
     */
    static async reactivate(req, res, next) {
        const client = await db.getConnection();
        try {
            const { id } = req.params;

            const result = await client.query(
                `UPDATE EMPLACEMENTSRESTAURANTFASTFOOD 
                 SET est_actif = true, date_mise_a_jour = NOW()
                 WHERE id = $1 AND est_actif = false
                 RETURNING *`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Emplacement non trouvé ou déjà actif', 404);
            }

            res.json({
                success: true,
                message: 'Emplacement réactivé avec succès',
                data: result.rows[0]
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }
}

module.exports = EmplacementRestaurantController;