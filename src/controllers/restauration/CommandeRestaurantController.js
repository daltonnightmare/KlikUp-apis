const db = require('../../configuration/database');
const { AppError, ValidationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const NotificationService = require('../../services/notification/NotificationService');
const { ENUM_STATUT_COMMANDE } = require('../../utils/constants/enums');

class CommandeRestaurantController {
    /**
     * Récupérer toutes les commandes d'un emplacement
     * GET /api/v1/restauration/emplacements/:emplacementId/commandes
     */
    static async getAll(req, res, next) {
        try {
            const { emplacementId } = req.params;
            const {
                page = 1,
                limit = 20,
                statut,
                date_debut,
                date_fin,
                client_id,
                avec_details = false,
                tri = 'date_desc'
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    c.id, 
                    c.reference_commande,
                    c.prix_sous_total,
                    c.frais_livraison_commande,
                    c.remise_appliquee,
                    c.prix_total_commande,
                    c.statut_commande,
                    c.pour_livrer,
                    c.passer_recuperer,
                    c.paiement_direct,
                    c.paiement_a_la_livraison,
                    c.paiement_a_la_recuperation,
                    c.notes_commande,
                    c.date_commande,
                    comp.nom_utilisateur_compte as client_nom,
                    comp.photo_profil_compte as client_photo,
                    comp.numero_de_telephone as client_telephone
            `;

            if (avec_details === 'true') {
                query += `,
                    c.donnees_commande,
                    p.nom_promo as promo_utilisee
                `;
            }

            query += `
                FROM COMMANDESEMPLACEMENTFASTFOOD c
                LEFT JOIN COMPTES comp ON comp.id = c.compte_id
                LEFT JOIN PROMOSRESTAURANTFASTFOOD p ON p.id = c.promo_id
                WHERE c.id_restaurant_fast_food_emplacement = $1
            `;

            const params = [emplacementId];
            let paramIndex = 2;

            if (statut) {
                query += ` AND c.statut_commande = $${paramIndex}`;
                params.push(statut);
                paramIndex++;
            }

            if (client_id) {
                query += ` AND c.compte_id = $${paramIndex}`;
                params.push(client_id);
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

            switch (tri) {
                case 'date_asc':
                    query += ` ORDER BY c.date_commande ASC`;
                    break;
                case 'montant_desc':
                    query += ` ORDER BY c.prix_total_commande DESC`;
                    break;
                case 'montant_asc':
                    query += ` ORDER BY c.prix_total_commande ASC`;
                    break;
                default:
                    query += ` ORDER BY c.date_commande DESC`;
            }

            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await db.query(query, params);

            const commandes = result.rows.map(cmd => ({
                ...cmd,
                prix_sous_total: parseFloat(cmd.prix_sous_total),
                frais_livraison_commande: parseFloat(cmd.frais_livraison_commande),
                remise_appliquee: parseFloat(cmd.remise_appliquee),
                prix_total_commande: parseFloat(cmd.prix_total_commande),
                donnees_commande: cmd.donnees_commande || []
            }));

            // Compter le total
            let countQuery = `
                SELECT COUNT(*) as total 
                FROM COMMANDESEMPLACEMENTFASTFOOD 
                WHERE id_restaurant_fast_food_emplacement = $1
            `;
            const countParams = [emplacementId];
            
            if (statut) {
                countQuery += ` AND statut_commande = $2`;
                countParams.push(statut);
            }

            const countResult = await db.query(countQuery, countParams);

            // Statistiques rapides
            const statsQuery = `
                SELECT 
                    COUNT(*) FILTER (WHERE statut_commande = 'EN_ATTENTE') as en_attente,
                    COUNT(*) FILTER (WHERE statut_commande = 'EN_PREPARATION') as en_preparation,
                    COUNT(*) FILTER (WHERE statut_commande = 'PRETE') as prete,
                    COUNT(*) FILTER (WHERE statut_commande = 'EN_LIVRAISON') as en_livraison,
                    COALESCE(SUM(prix_total_commande) FILTER (WHERE date_commande >= CURRENT_DATE), 0) as ca_aujourdhui
                FROM COMMANDESEMPLACEMENTFASTFOOD
                WHERE id_restaurant_fast_food_emplacement = $1
            `;

            const statsResult = await db.query(statsQuery, [emplacementId]);

            res.json({
                success: true,
                data: commandes,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(countResult.rows[0].total),
                    pages: Math.ceil(parseInt(countResult.rows[0].total) / limit)
                },
                stats: statsResult.rows[0]
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer une commande par ID
     * GET /api/v1/restauration/commandes/:id
     */
    static async getById(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT 
                    c.*,
                    comp.nom_utilisateur_compte as client_nom,
                    comp.email as client_email,
                    comp.numero_de_telephone as client_telephone,
                    comp.photo_profil_compte as client_photo,
                    p.nom_promo as promo_nom,
                    p.code_promo as promo_code,
                    erf.nom_emplacement,
                    erf.adresse_complete,
                    erf.frais_livraison as frais_livraison_standard,
                    ad.ligne_1 as adresse_ligne1,
                    ad.ligne_2 as adresse_ligne2,
                    ad.ville as adresse_ville,
                    ad.code_postal as adresse_code_postal,
                    ST_AsGeoJSON(ad.coordonnees) as adresse_coordonnees,
                    (
                        SELECT json_agg(json_build_object(
                            'id', dl.id,
                            'statut', dl.statut_livraison,
                            'livreur_nom', l.nom_livreur,
                            'livreur_prenom', l.prenom_livreur,
                            'livreur_telephone', l.numero_telephone_livreur,
                            'date_livraison_prevue', dl.date_livraison_prevue,
                            'date_livraison_effective', dl.date_livraison_effective
                        ))
                        FROM DEMANDES_LIVRAISON dl
                        LEFT JOIN LIVREURS l ON l.id = dl.livreur_affecte
                        WHERE dl.commande_type = 'RESTAURANT_FAST_FOOD' 
                          AND dl.commande_id = c.id
                    ) as livraison
                FROM COMMANDESEMPLACEMENTFASTFOOD c
                LEFT JOIN COMPTES comp ON comp.id = c.compte_id
                LEFT JOIN PROMOSRESTAURANTFASTFOOD p ON p.id = c.promo_id
                LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = c.id_restaurant_fast_food_emplacement
                LEFT JOIN ADRESSES ad ON ad.id = c.adresse_livraison_id
                WHERE c.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Commande non trouvée', 404);
            }

            const commande = result.rows[0];
            
            // Formater les données
            commande.prix_sous_total = parseFloat(commande.prix_sous_total);
            commande.frais_livraison_commande = parseFloat(commande.frais_livraison_commande);
            commande.remise_appliquee = parseFloat(commande.remise_appliquee);
            commande.prix_total_commande = parseFloat(commande.prix_total_commande);
            commande.donnees_commande = commande.donnees_commande || [];
            
            if (commande.adresse_coordonnees) {
                commande.adresse_coordonnees = JSON.parse(commande.adresse_coordonnees);
            }

            // Calculer le temps d'attente
            if (commande.statut_commande !== 'LIVREE' && commande.statut_commande !== 'RECUPEREE' && commande.statut_commande !== 'ANNULEE') {
                commande.temps_attente_minutes = Math.floor((new Date() - new Date(commande.date_commande)) / (1000 * 60));
            }

            res.json({
                success: true,
                data: commande
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Créer une nouvelle commande
     * POST /api/v1/restauration/emplacements/:emplacementId/commandes
     */
    static async create(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { emplacementId } = req.params;
            const compteId = req.user.id;
            
            const {
                donnees_commande,
                pour_livrer,
                passer_recuperer,
                paiement_direct,
                paiement_a_la_livraison,
                paiement_a_la_recuperation,
                notes_commande,
                adresse_livraison_id,
                code_promo
            } = req.body;

            // Vérifier que l'emplacement existe et est ouvert
            const emplacementResult = await client.query(
                `SELECT * FROM EMPLACEMENTSRESTAURANTFASTFOOD 
                 WHERE id = $1 AND est_actif = true`,
                [emplacementId]
            );

            if (emplacementResult.rows.length === 0) {
                throw new AppError('Emplacement non trouvé ou fermé', 404);
            }

            const emplacement = emplacementResult.rows[0];

            // Vérifier les horaires d'ouverture
            const estOuvert = await client.query(
                `SELECT fn_est_ouvert('EMPLACEMENT_RESTAURANT'::entite_reference, $1, NOW()) as est_ouvert`,
                [emplacementId]
            );

            if (!estOuvert.rows[0].est_ouvert) {
                throw new ValidationError('L\'établissement est actuellement fermé');
            }

            // Valider les articles de la commande
            if (!donnees_commande || !Array.isArray(donnees_commande) || donnees_commande.length === 0) {
                throw new ValidationError('La commande doit contenir au moins un article');
            }

            // Calculer les totaux
            let prixSousTotal = 0;
            let articlesValides = [];

            for (const article of donnees_commande) {
                if (article.type === 'menu') {
                    const menuResult = await client.query(
                        `SELECT * FROM MENURESTAURANTFASTFOOD 
                         WHERE id = $1 AND id_restaurant_fast_food_emplacement = $2 AND disponible = true`,
                        [article.id, emplacementId]
                    );

                    if (menuResult.rows.length === 0) {
                        throw new ValidationError(`Menu ${article.id} non disponible`);
                    }

                    const menu = menuResult.rows[0];
                    
                    // Vérifier le stock
                    if (menu.stock_disponible > 0 && menu.stock_disponible < article.quantite) {
                        throw new ValidationError(`Stock insuffisant pour le menu ${menu.nom_menu}`);
                    }

                    prixSousTotal += menu.prix_menu * article.quantite;
                    articlesValides.push({
                        ...article,
                        nom: menu.nom_menu,
                        prix_unitaire: menu.prix_menu
                    });

                } else if (article.type === 'produit') {
                    const produitResult = await client.query(
                        `SELECT * FROM PRODUITSINDIVIDUELRESTAURANT 
                         WHERE id = $1 AND id_restaurant_fast_food_emplacement = $2 AND disponible = true`,
                        [article.id, emplacementId]
                    );

                    if (produitResult.rows.length === 0) {
                        throw new ValidationError(`Produit ${article.id} non disponible`);
                    }

                    const produit = produitResult.rows[0];

                    // Vérifier le stock
                    if (produit.stock_disponible > 0 && produit.stock_disponible < article.quantite) {
                        throw new ValidationError(`Stock insuffisant pour le produit ${produit.nom_produit}`);
                    }

                    prixSousTotal += produit.prix_produit * article.quantite;
                    articlesValides.push({
                        ...article,
                        nom: produit.nom_produit,
                        prix_unitaire: produit.prix_produit
                    });
                }
            }

            // Appliquer le code promo si fourni
            let remiseAppliquee = 0;
            let promoId = null;

            if (code_promo) {
                const promoResult = await client.query(
                    `SELECT * FROM PROMOSRESTAURANTFASTFOOD 
                     WHERE code_promo = $1 
                       AND id_restaurant_fast_food_emplacement = $2 
                       AND actif = true
                       AND date_debut_promo <= NOW()
                       AND date_fin_promo >= NOW()
                       AND (utilisation_max = -1 OR utilisation_count < utilisation_max)`,
                    [code_promo, emplacementId]
                );

                if (promoResult.rows.length > 0) {
                    const promo = promoResult.rows[0];
                    
                    switch (promo.type_promo) {
                        case 'POURCENTAGE':
                            remiseAppliquee = prixSousTotal * (promo.pourcentage_reduction / 100);
                            break;
                        case 'MONTANT_FIXE':
                            remiseAppliquee = Math.min(promo.montant_fixe_reduction, prixSousTotal);
                            break;
                        case 'LIVRAISON_GRATUITE':
                            // La livraison sera gratuite
                            break;
                    }

                    promoId = promo.id;

                    // Incrémenter le compteur d'utilisation
                    await client.query(
                        `UPDATE PROMOSRESTAURANTFASTFOOD 
                         SET utilisation_count = utilisation_count + 1
                         WHERE id = $1`,
                        [promo.id]
                    );
                }
            }

            // Calculer les frais de livraison
            const fraisLivraison = pour_livrer ? emplacement.frais_livraison : 0;

            // Appliquer la livraison gratuite si applicable
            const livraisonGratuite = code_promo && (await client.query(
                `SELECT type_promo FROM PROMOSRESTAURANTFASTFOOD 
                 WHERE id = $1 AND type_promo = 'LIVRAISON_GRATUITE'`,
                [promoId]
            )).rows.length > 0;

            const fraisLivraisonReels = livraisonGratuite ? 0 : fraisLivraison;

            // Calculer le total final
            const prixTotal = prixSousTotal + fraisLivraisonReels - remiseAppliquee;

            // Créer la commande
            const commandeResult = await client.query(
                `INSERT INTO COMMANDESEMPLACEMENTFASTFOOD (
                    reference_commande,
                    id_restaurant_fast_food_emplacement,
                    compte_id,
                    donnees_commande,
                    prix_sous_total,
                    frais_livraison_commande,
                    remise_appliquee,
                    prix_total_commande,
                    promo_id,
                    statut_commande,
                    pour_livrer,
                    passer_recuperer,
                    paiement_direct,
                    paiement_a_la_livraison,
                    paiement_a_la_recuperation,
                    notes_commande,
                    adresse_livraison_id,
                    date_commande,
                    date_mise_a_jour
                ) VALUES (
                    DEFAULT, $1, $2, $3, $4, $5, $6, $7, $8, 'EN_ATTENTE',
                    $9, $10, $11, $12, $13, $14, $15, NOW(), NOW()
                ) RETURNING *`,
                [
                    emplacementId,
                    compteId,
                    JSON.stringify(articlesValides),
                    prixSousTotal,
                    fraisLivraisonReels,
                    remiseAppliquee,
                    prixTotal,
                    promoId,
                    pour_livrer || false,
                    passer_recuperer || false,
                    paiement_direct || false,
                    paiement_a_la_livraison || false,
                    paiement_a_la_recuperation || false,
                    notes_commande,
                    adresse_livraison_id
                ]
            );

            const commande = commandeResult.rows[0];

            // Mettre à jour les stocks
            for (const article of articlesValides) {
                if (article.type === 'menu') {
                    await client.query(
                        `UPDATE MENURESTAURANTFASTFOOD 
                         SET stock_disponible = 
                             CASE 
                                 WHEN stock_disponible > 0 THEN stock_disponible - $1
                                 ELSE stock_disponible
                             END
                         WHERE id = $2`,
                        [article.quantite, article.id]
                    );
                } else if (article.type === 'produit') {
                    await client.query(
                        `UPDATE PRODUITSINDIVIDUELRESTAURANT 
                         SET stock_disponible = 
                             CASE 
                                 WHEN stock_disponible > 0 THEN stock_disponible - $1
                                 ELSE stock_disponible
                             END
                         WHERE id = $2`,
                        [article.quantite, article.id]
                    );
                }
            }

            // Créer une demande de livraison si nécessaire
            if (pour_livrer) {
                await client.query(
                    `INSERT INTO DEMANDES_LIVRAISON (
                        details_livraison,
                        commande_type,
                        commande_id,
                        statut_livraison,
                        date_creation
                    ) VALUES ($1, 'RESTAURANT_FAST_FOOD', $2, 'EN_ATTENTE', NOW())`,
                    [JSON.stringify({
                        adresse_id: adresse_livraison_id,
                        notes: notes_commande,
                        montant: prixTotal
                    }), commande.id]
                );
            }

            // Notifier le restaurant
            await NotificationService.sendToEmplacement(emplacementId, {
                type: 'NOUVELLE_COMMANDE',
                titre: 'Nouvelle commande reçue',
                message: `Commande #${commande.reference_commande} - ${prixTotal} FCFA`,
                data: { commande_id: commande.id }
            });

            // Notifier le client
            await NotificationService.sendToUser(compteId, {
                type: 'COMMANDE_CONFIRMEE',
                titre: 'Commande confirmée',
                message: `Votre commande #${commande.reference_commande} a été enregistrée`,
                data: { commande_id: commande.id }
            });

            await AuditService.log({
                action: 'CREATE_COMMANDE',
                ressource_type: 'COMMANDESEMPLACEMENTFASTFOOD',
                ressource_id: commande.id,
                donnees_apres: commande,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Commande créée avec succès',
                data: {
                    commande: {
                        id: commande.id,
                        reference: commande.reference_commande,
                        total: parseFloat(commande.prix_total_commande),
                        statut: commande.statut_commande,
                        date: commande.date_commande
                    },
                    recapitulatif: {
                        sous_total: prixSousTotal,
                        frais_livraison: fraisLivraisonReels,
                        remise: remiseAppliquee,
                        total: prixTotal
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
     * Mettre à jour le statut d'une commande
     * PATCH /api/v1/restauration/commandes/:id/statut
     */
    static async updateStatut(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { statut, motif } = req.body;

            if (!statut) {
                throw new ValidationError('Statut requis');
            }

            // Récupérer la commande
            const commandeResult = await client.query(
                `SELECT c.*, erf.id_restaurant_fast_food, comp.email, comp.numero_de_telephone
                 FROM COMMANDESEMPLACEMENTFASTFOOD c
                 JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = c.id_restaurant_fast_food_emplacement
                 LEFT JOIN COMPTES comp ON comp.id = c.compte_id
                 WHERE c.id = $1`,
                [id]
            );

            if (commandeResult.rows.length === 0) {
                throw new AppError('Commande non trouvée', 404);
            }

            const commande = commandeResult.rows[0];
            const ancienStatut = commande.statut_commande;

            // Valider la transition de statut
            const transitionsValides = {
                'EN_ATTENTE': ['CONFIRMEE', 'ANNULEE'],
                'CONFIRMEE': ['EN_PREPARATION', 'ANNULEE'],
                'EN_PREPARATION': ['PRETE', 'ANNULEE'],
                'PRETE': ['EN_LIVRAISON', 'RECUPEREE', 'ANNULEE'],
                'EN_LIVRAISON': ['LIVREE', 'ANNULEE'],
                'LIVREE': [],
                'RECUPEREE': [],
                'ANNULEE': [],
                'REMBOURSEE': []
            };

            if (!transitionsValides[ancienStatut]?.includes(statut)) {
                throw new ValidationError(`Transition de ${ancienStatut} vers ${statut} non autorisée`);
            }

            // Mettre à jour le statut
            await client.query(
                `UPDATE COMMANDESEMPLACEMENTFASTFOOD 
                 SET statut_commande = $1, date_mise_a_jour = NOW()
                 WHERE id = $2`,
                [statut, id]
            );

            // Actions spéciales selon le nouveau statut
            if (statut === 'ANNULEE' || statut === 'REMBOURSEE') {
                // Restaurer les stocks
                for (const article of commande.donnees_commande) {
                    if (article.type === 'menu') {
                        await client.query(
                            `UPDATE MENURESTAURANTFASTFOOD 
                             SET stock_disponible = stock_disponible + $1
                             WHERE id = $2`,
                            [article.quantite, article.id]
                        );
                    } else if (article.type === 'produit') {
                        await client.query(
                            `UPDATE PRODUITSINDIVIDUELRESTAURANT 
                             SET stock_disponible = stock_disponible + $1
                             WHERE id = $2`,
                            [article.quantite, article.id]
                        );
                    }
                }
            }

            // Notifier le client
            if (commande.compte_id) {
                let message = '';
                switch (statut) {
                    case 'CONFIRMEE':
                        message = 'Votre commande a été confirmée';
                        break;
                    case 'EN_PREPARATION':
                        message = 'Votre commande est en cours de préparation';
                        break;
                    case 'PRETE':
                        message = 'Votre commande est prête';
                        break;
                    case 'EN_LIVRAISON':
                        message = 'Votre commande est en cours de livraison';
                        break;
                    case 'LIVREE':
                        message = 'Votre commande a été livrée';
                        break;
                    case 'RECUPEREE':
                        message = 'Votre commande a été récupérée';
                        break;
                    case 'ANNULEE':
                        message = motif || 'Votre commande a été annulée';
                        break;
                }

                await NotificationService.sendToUser(commande.compte_id, {
                    type: 'STATUT_COMMANDE',
                    titre: `Statut de commande mis à jour`,
                    message: `${message} - #${commande.reference_commande}`,
                    data: { commande_id: id, statut }
                });
            }

            await AuditService.log({
                action: 'UPDATE_STATUT_COMMANDE',
                ressource_type: 'COMMANDESEMPLACEMENTFASTFOOD',
                ressource_id: id,
                donnees_avant: { statut: ancienStatut },
                donnees_apres: { statut },
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Statut mis à jour avec succès',
                data: {
                    id,
                    ancien_statut: ancienStatut,
                    nouveau_statut: statut
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
     * Récupérer les commandes d'un client
     * GET /api/v1/restauration/clients/:clientId/commandes
     */
    static async getByClient(req, res, next) {
        try {
            const { clientId } = req.params;
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
                    c.date_commande,
                    erf.nom_emplacement,
                    rf.nom_restaurant_fast_food,
                    rf.logo_restaurant,
                    c.donnees_commande
                FROM COMMANDESEMPLACEMENTFASTFOOD c
                JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = c.id_restaurant_fast_food_emplacement
                JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
                WHERE c.compte_id = $1
            `;

            const params = [clientId];
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

            const commandes = result.rows.map(cmd => ({
                ...cmd,
                prix_total_commande: parseFloat(cmd.prix_total_commande),
                donnees_commande: cmd.donnees_commande || []
            }));

            // Compter le total
            let countQuery = `
                SELECT COUNT(*) as total 
                FROM COMMANDESEMPLACEMENTFASTFOOD 
                WHERE compte_id = $1
            `;
            const countParams = [clientId];
            
            if (statut) {
                countQuery += ` AND statut_commande = $2`;
                countParams.push(statut);
            }

            const countResult = await db.query(countQuery, countParams);

            res.json({
                success: true,
                data: commandes,
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
     * Récupérer le tableau de bord des commandes
     * GET /api/v1/restauration/commandes/dashboard
     */
    static async getDashboard(req, res, next) {
        try {
            const { emplacement_id, restaurant_id } = req.query;

            let condition = '';
            const params = [];

            if (emplacement_id) {
                condition = 'WHERE c.id_restaurant_fast_food_emplacement = $1';
                params.push(emplacement_id);
            } else if (restaurant_id) {
                condition = `
                    WHERE erf.id_restaurant_fast_food = $1
                `;
                params.push(restaurant_id);
            }

            const result = await db.query(
                `WITH stats_globales AS (
                    SELECT 
                        COUNT(*) as total_commandes,
                        COUNT(*) FILTER (WHERE c.date_commande >= CURRENT_DATE) as commandes_aujourdhui,
                        COUNT(*) FILTER (WHERE c.statut_commande = 'EN_ATTENTE') as en_attente,
                        COUNT(*) FILTER (WHERE c.statut_commande = 'EN_PREPARATION') as en_preparation,
                        COUNT(*) FILTER (WHERE c.statut_commande = 'PRETE') as prete,
                        COUNT(*) FILTER (WHERE c.statut_commande = 'EN_LIVRAISON') as en_livraison,
                        COALESCE(SUM(c.prix_total_commande), 0) as ca_total,
                        COALESCE(SUM(c.prix_total_commande) FILTER (WHERE c.date_commande >= CURRENT_DATE), 0) as ca_aujourdhui,
                        AVG(c.prix_total_commande) as panier_moyen
                    FROM COMMANDESEMPLACEMENTFASTFOOD c
                    LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = c.id_restaurant_fast_food_emplacement
                    ${condition}
                ),
                commandes_par_heure AS (
                    SELECT 
                        EXTRACT(HOUR FROM c.date_commande) as heure,
                        COUNT(*) as nombre_commandes
                    FROM COMMANDESEMPLACEMENTFASTFOOD c
                    LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = c.id_restaurant_fast_food_emplacement
                    WHERE c.date_commande >= CURRENT_DATE
                      ${condition ? `AND ${condition.replace('WHERE', '')}` : ''}
                    GROUP BY EXTRACT(HOUR FROM c.date_commande)
                    ORDER BY heure
                ),
                top_articles AS (
                    SELECT 
                        (jsonb_array_elements(c.donnees_commande)->>'nom') as nom_article,
                        SUM((jsonb_array_elements(c.donnees_commande)->>'quantite')::int) as quantite_totale
                    FROM COMMANDESEMPLACEMENTFASTFOOD c
                    LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = c.id_restaurant_fast_food_emplacement
                    WHERE c.date_commande >= NOW() - INTERVAL '30 days'
                      ${condition ? `AND ${condition.replace('WHERE', '')}` : ''}
                    GROUP BY nom_article
                    ORDER BY quantite_totale DESC
                    LIMIT 10
                )
                SELECT 
                    (SELECT row_to_json(stats_globales) FROM stats_globales) as global,
                    (SELECT json_agg(commandes_par_heure) FROM commandes_par_heure) as repartition_horaire,
                    (SELECT json_agg(top_articles) FROM top_articles) as articles_populaires
                `,
                params
            );

            res.json({
                success: true,
                data: {
                    ...result.rows[0].global,
                    repartition_horaire: result.rows[0].repartition_horaire || [],
                    articles_populaires: result.rows[0].articles_populaires || []
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Annuler une commande
     * POST /api/v1/restauration/commandes/:id/annuler
     */
    static async cancel(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { motif } = req.body;

            // Récupérer la commande
            const commandeResult = await client.query(
                `SELECT * FROM COMMANDESEMPLACEMENTFASTFOOD WHERE id = $1`,
                [id]
            );

            if (commandeResult.rows.length === 0) {
                throw new AppError('Commande non trouvée', 404);
            }

            const commande = commandeResult.rows[0];

            // Vérifier si la commande peut être annulée
            if (!['EN_ATTENTE', 'CONFIRMEE'].includes(commande.statut_commande)) {
                throw new ValidationError('Cette commande ne peut plus être annulée');
            }

            // Vérifier que c'est le bon utilisateur ou un admin
            if (commande.compte_id !== req.user.id && !req.user.roles.includes('ADMINISTRATEUR_PLATEFORME')) {
                throw new AppError('Non autorisé', 403);
            }

            // Mettre à jour le statut
            await client.query(
                `UPDATE COMMANDESEMPLACEMENTFASTFOOD 
                 SET statut_commande = 'ANNULEE', 
                     notes_commande = COALESCE(notes_commande, '') || '\nAnnulation: ' || COALESCE($1, 'Annulation client'),
                     date_mise_a_jour = NOW()
                 WHERE id = $2`,
                [motif, id]
            );

            // Restaurer les stocks
            for (const article of commande.donnees_commande) {
                if (article.type === 'menu') {
                    await client.query(
                        `UPDATE MENURESTAURANTFASTFOOD 
                         SET stock_disponible = stock_disponible + $1
                         WHERE id = $2`,
                        [article.quantite, article.id]
                    );
                } else if (article.type === 'produit') {
                    await client.query(
                        `UPDATE PRODUITSINDIVIDUELRESTAURANT 
                         SET stock_disponible = stock_disponible + $1
                         WHERE id = $2`,
                        [article.quantite, article.id]
                    );
                }
            }

            // Notifier le restaurant
            await NotificationService.sendToEmplacement(commande.id_restaurant_fast_food_emplacement, {
                type: 'COMMANDE_ANNULEE',
                titre: 'Commande annulée',
                message: `Commande #${commande.reference_commande} annulée`,
                data: { commande_id: id, motif }
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Commande annulée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer le ticket de caisse
     * GET /api/v1/restauration/commandes/:id/ticket
     */
    static async getTicket(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT 
                    c.reference_commande,
                    c.date_commande,
                    c.donnees_commande,
                    c.prix_sous_total,
                    c.frais_livraison_commande,
                    c.remise_appliquee,
                    c.prix_total_commande,
                    c.pour_livrer,
                    c.passer_recuperer,
                    c.statut_commande,
                    comp.nom_utilisateur_compte as client_nom,
                    erf.nom_emplacement,
                    erf.adresse_complete,
                    rf.nom_restaurant_fast_food
                FROM COMMANDESEMPLACEMENTFASTFOOD c
                JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = c.id_restaurant_fast_food_emplacement
                JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
                LEFT JOIN COMPTES comp ON comp.id = c.compte_id
                WHERE c.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Commande non trouvée', 404);
            }

            const ticket = result.rows[0];

            // Formater pour le ticket
            const ticketData = {
                entete: {
                    restaurant: ticket.nom_restaurant_fast_food,
                    emplacement: ticket.nom_emplacement,
                    adresse: ticket.adresse_complete,
                    date: new Date(ticket.date_commande).toLocaleString('fr-FR'),
                    reference: ticket.reference_commande,
                    client: ticket.client_nom || 'Client anonyme'
                },
                articles: ticket.donnees_commande.map(article => ({
                    nom: article.nom,
                    quantite: article.quantite,
                    prix_unitaire: article.prix_unitaire,
                    total: article.prix_unitaire * article.quantite
                })),
                totaux: {
                    sous_total: parseFloat(ticket.prix_sous_total),
                    frais_livraison: parseFloat(ticket.frais_livraison_commande),
                    remise: parseFloat(ticket.remise_appliquee),
                    total: parseFloat(ticket.prix_total_commande)
                },
                mode: ticket.pour_livrer ? 'Livraison' : 'À emporter',
                statut: ticket.statut_commande
            };

            res.json({
                success: true,
                data: ticketData
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Estimer le temps de préparation
     * GET /api/v1/restauration/commandes/:id/temps-estime
     */
    static async getTempsEstime(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT 
                    c.donnees_commande,
                    c.date_commande,
                    c.statut_commande,
                    AVG(m.temps_preparation_min) as temps_moyen_menus,
                    AVG(p.temps_preparation_min) as temps_moyen_produits
                FROM COMMANDESEMPLACEMENTFASTFOOD c
                LEFT JOIN MENURESTAURANTFASTFOOD m ON m.id = ANY(
                    ARRAY(
                        SELECT (jsonb_array_elements(c.donnees_commande)->>'id')::int
                        WHERE jsonb_array_elements(c.donnees_commande)->>'type' = 'menu'
                    )
                )
                LEFT JOIN PRODUITSINDIVIDUELRESTAURANT p ON p.id = ANY(
                    ARRAY(
                        SELECT (jsonb_array_elements(c.donnees_commande)->>'id')::int
                        WHERE jsonb_array_elements(c.donnees_commande)->>'type' = 'produit'
                    )
                )
                WHERE c.id = $1
                GROUP BY c.id`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Commande non trouvée', 404);
            }

            const commande = result.rows[0];
            
            // Calculer le temps estimé
            let tempsEstime = 0;
            if (commande.temps_moyen_menus) tempsEstime += parseInt(commande.temps_moyen_menus);
            if (commande.temps_moyen_produits) tempsEstime += parseInt(commande.temps_moyen_produits);
            
            tempsEstime = Math.max(tempsEstime, 15); // Minimum 15 minutes

            // Calculer le temps déjà écoulé
            const tempsEcoule = Math.floor((new Date() - new Date(commande.date_commande)) / (1000 * 60));
            const tempsRestant = Math.max(tempsEstime - tempsEcoule, 0);

            res.json({
                success: true,
                data: {
                    temps_estime_total: tempsEstime,
                    temps_ecoule: tempsEcoule,
                    temps_restant_estime: tempsRestant,
                    date_estimee_fin: new Date(new Date(commande.date_commande).getTime() + tempsEstime * 60000),
                    statut: commande.statut_commande
                }
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = CommandeRestaurantController;