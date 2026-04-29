const db = require('../../configuration/database');
const { v4: uuidv4 } = require('uuid');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const FileService = require('../../services/file/FileService');
const AuditService = require('../../services/audit/AuditService');
const NotificationService = require('../../services/notification/NotificationService');
const { logger } = require('../../configuration/logger');



class CreationEntreprisePartenaire {
    /**
     * Créer un nouveau restaurant
     * POST /api/v1/admin/restaurants/create
     */
    async createRestaurant(req, res, next) {
        const client = await db.getClient();
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

            const pourcentageCommision = await client.query(
                `SELECT pourcentage_commission FROM PLATEFORMES WHERE id = $1`,
                [plateforme_id || 1]
            );

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
                    pourcentageCommision ? pourcentageCommision.rows[0].pourcentage_commission : 10,
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
            logger.error('Erreur création restaurant:', { error, body: req.body });
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Créer une nouvelle boutique
     * @route POST /api/v1/admin/boutiques/create
     * @access ADMINISTRATEUR_PLATEFORME, ADMINISTRATEUR_COMPAGNIE
     */
    async createBoutique(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            
            const {
                nom_boutique,
                description_boutique,
                types_produits_vendu,
                plateforme_id,
                pourcentage_commission_plateforme,
                configuration = {}
            } = req.body;

            // Vérification plateforme
            const plateformeCheck = await client.query(
                'SELECT id FROM PLATEFORME WHERE id = $1',
                [plateforme_id]
            );
            const commissionPlateforme = await client.query(
                'SELECT pourcentage_commission FROM PLATEFORME WHERE id = $1',
                [plateforme_id]
            );
            
            if (plateformeCheck.rows.length === 0) {
                throw new ValidationError('La plateforme spécifiée n\'existe pas');
            }

            // Validations
            if (!nom_boutique || nom_boutique.length < 3) {
                throw new ValidationError('Le nom de la boutique doit contenir au moins 3 caractères');
            }

            if (pourcentage_commission_plateforme < 0 || pourcentage_commission_plateforme > 100) {
                throw new ValidationError('Le pourcentage de commission doit être entre 0 et 100');
            }

            // Upload logo
            let logo_boutique = null;
            if (req.files?.logo) {
                logo_boutique = await FileService.uploadImage(req.files.logo, {
                    path: 'boutiques/logos',
                    maxSize: 2 * 1024 * 1024,
                    allowedTypes: ['image/jpeg', 'image/png', 'image/webp']
                });
            }

            // Upload favicon
            let favicon_boutique = null;
            if (req.files?.favicon) {
                favicon_boutique = await FileService.uploadImage(req.files.favicon, {
                    path: 'boutiques/favicons',
                    maxSize: 512 * 1024,
                    allowedTypes: ['image/x-icon', 'image/png']
                });
            }

            // Création boutique
            const result = await client.query(
                `INSERT INTO BOUTIQUES (
                    nom_boutique, description_boutique, logo_boutique, favicon_boutique,
                    types_produits_vendu, plateforme_id, pourcentage_commission_plateforme,
                    portefeuille_boutique, est_actif, date_creation, date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
                RETURNING *`,
                [
                    nom_boutique,
                    description_boutique || null,
                    logo_boutique,
                    favicon_boutique,
                    JSON.stringify(types_produits_vendu || []),
                    plateforme_id,
                    commissionPlateforme ? commissionPlateforme.rows[0].pourcentage_commission : 10,
                    0, true
                ]
            );

            const nouvelleBoutique = result.rows[0];

            // Sauvegarde configuration
            if (Object.keys(configuration).length > 0) {
                await this._saveConfiguration(client, nouvelleBoutique.id, configuration);
            }

            // Audit
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'BOUTIQUE',
                ressource_id: nouvelleBoutique.id,
                donnees_apres: nouvelleBoutique,
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            // Notification
            await NotificationService.notifyAdmins({
                type: 'NOUVELLE_BOUTIQUE',
                titre: 'Nouvelle boutique créée',
                message: `La boutique "${nom_boutique}" a été créée`,
                donnees: { boutique_id: nouvelleBoutique.id }
            });

            res.status(201).json({
                status: 'success',
                data: nouvelleBoutique
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur création boutique:', { error, body: req.body });
            next(error);
        } finally {
            client.release();
        }
    }


    /**
     * Créer une nouvelle compagnie
     * POST /api/v1/admin/transport/compagnies
     */
    async createCompagnieTransport(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            const {
                nom_compagnie,
                description_compagnie,
                logo_compagnie,
                pourcentage_commission_plateforme,
                plateforme_id
            } = req.body;

            // Vérifier si le nom existe déjà
            const existing = await client.query(
                `SELECT id FROM COMPAGNIESTRANSPORT WHERE nom_compagnie = $1`,
                [nom_compagnie]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError('Une compagnie avec ce nom existe déjà');
            }

            const result = await client.query(
                `INSERT INTO COMPAGNIESTRANSPORT (
                    nom_compagnie, description_compagnie, logo_compagnie,
                    pourcentage_commission_plateforme, plateforme_id,
                    date_creation, date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                RETURNING *`,
                [nom_compagnie, description_compagnie, logo_compagnie,
                    pourcentage_commission_plateforme, plateforme_id || 1]
            );

            const newCompagnie = result.rows[0];

            // Journaliser l'action
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'COMPAGNIESTRANSPORT',
                ressource_id: newCompagnie.id,
                donnees_apres: newCompagnie,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Compagnie créée avec succès',
                data: newCompagnie
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }


    /**
     * Créer une nouvelle entreprise de livraison
     * @route POST /api/v1/admin/livraison/entreprises
     */
    async createEntrepriseLivraison(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const {
                nom_entreprise_livraison,
                description_entreprise_livraison,
                localisation_entreprise,
                pourcentage_commission_plateforme,
                plateforme_id = 1
            } = req.body;

            // Validation
            if (!nom_entreprise_livraison) {
                throw new ValidationError('Le nom de l\'entreprise est requis');
            }

            // Gestion du logo uploadé
            let logoPath = null;
            let faviconPath = null;

            if (req.files) {
                if (req.files.logo) {
                    logoPath = await FileService.uploadImage(
                        req.files.logo,
                        'livraison/entreprises/logos'
                    );
                }
                if (req.files.favicon) {
                    faviconPath = await FileService.uploadImage(
                        req.files.favicon,
                        'livraison/entreprises/favicons'
                    );
                }
            }

            // Traitement de la localisation
            let localisationPoint = null;
            if (localisation_entreprise) {
                localisationPoint = await GeoService.createPoint(
                    localisation_entreprise.lat,
                    localisation_entreprise.lng
                );
            }

            const result = await client.query(
                `INSERT INTO ENTREPRISE_LIVRAISON (
                    nom_entreprise_livraison,
                    description_entreprise_livraison,
                    logo_entreprise_livraison,
                    favicon_entreprise_livraison,
                    localisation_entreprise,
                    pourcentage_commission_plateforme,
                    plateforme_id,
                    portefeuille_entreprise_livraison,
                    est_actif
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, true)
                RETURNING *`,
                [
                    nom_entreprise_livraison,
                    description_entreprise_livraison,
                    logoPath,
                    faviconPath,
                    localisationPoint,
                    pourcentage_commission_plateforme || 0,
                    plateforme_id
                ]
            );

            const entreprise = result.rows[0];

            // Journalisation
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'ENTREPRISE_LIVRAISON',
                ressource_id: entreprise.id,
                utilisateur_id: req.user.id,
                donnees_apres: entreprise
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: entreprise,
                message: 'Entreprise de livraison créée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }
    

}

module.exports = new CreationEntreprisePartenaire();