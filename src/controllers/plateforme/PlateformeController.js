// src/controllers/plateforme/PlateformeController.js
const database = require('../../configuration/database');
const { AppError, ValidationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const CacheService = require('../../services/cache/CacheService');
const FileService = require('../../services/file/FileService');
const { logInfo, logError } = require('../../configuration/logger');

class PlateformeController {
    /**
     * Récupérer les informations de la plateforme
     * @route GET /api/v1/plateforme
     * @access PUBLIC
     */
    async recupererPlateforme(req, res, next) {
        try {
            // Vérification cache
            const cacheKey = 'plateforme:infos';
            const cached = await CacheService.get(cacheKey);
            
            if (cached) {
                return res.json({
                    success: true,
                    data: cached,
                    from_cache: true
                });
            }

            const result = await database.query(`
                SELECT 
                    id,
                    nom_plateforme,
                    description_plateforme,
                    logo_plateforme,
                    favicon_plateforme,
                    ST_AsGeoJSON(localisation_siege) as localisation,
                    portefeuille_plateforme,
                    depenses_plateforme,
                    date_creation,
                    date_mise_a_jour
                FROM PLATEFORME
                WHERE id = 1
            `);

            if (result.rows.length === 0) {
                throw new AppError('Configuration plateforme non trouvée', 404);
            }

            let plateforme = result.rows[0];
            
            // Formater les données
            if (plateforme.localisation) {
                plateforme.localisation = JSON.parse(plateforme.localisation);
            }

            // Récupérer les statistiques globales
            const stats = await this._getGlobalStats();

            const data = {
                ...plateforme,
                statistiques: stats
            };

            // Mise en cache (1 heure)
            await CacheService.set(cacheKey, data, 3600);

            res.json({
                success: true,
                data
            });

        } catch (error) {
            logError('Erreur récupération plateforme:', error);
            next(error);
        }
    }

    /**
     * Mettre à jour les informations de la plateforme
     * @route PUT /api/v1/plateforme
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async mettreAJourPlateforme(req, res, next) {
        const client = await database.pool.connect();
        
        try {
            await client.query('BEGIN');

            const {
                nom_plateforme,
                description_plateforme,
                localisation_siege
            } = req.body;

            // Récupérer l'état actuel
            const currentResult = await client.query(`
                SELECT * FROM PLATEFORME WHERE id = 1
            `);

            if (currentResult.rows.length === 0) {
                throw new AppError('Configuration plateforme non trouvée', 404);
            }

            const current = currentResult.rows[0];

            // Gestion des fichiers uploadés
            let logoPath = current.logo_plateforme;
            let faviconPath = current.favicon_plateforme;

            if (req.files) {
                if (req.files.logo) {
                    logoPath = await FileService.uploadImage(req.files.logo, {
                        path: 'plateforme/logos',
                        maxSize: 2 * 1024 * 1024,
                        allowedTypes: ['image/jpeg', 'image/png', 'image/webp']
                    });
                    
                    // Supprimer l'ancien logo
                    if (current.logo_plateforme) {
                        await FileService.deleteFile(current.logo_plateforme);
                    }
                }

                if (req.files.favicon) {
                    faviconPath = await FileService.uploadImage(req.files.favicon, {
                        path: 'plateforme/favicons',
                        maxSize: 512 * 1024,
                        allowedTypes: ['image/x-icon', 'image/png']
                    });
                    
                    if (current.favicon_plateforme) {
                        await FileService.deleteFile(current.favicon_plateforme);
                    }
                }
            }

            // Construire la requête de mise à jour
            const updates = [];
            const values = [];
            let paramIndex = 1;

            if (nom_plateforme !== undefined) {
                updates.push(`nom_plateforme = $${paramIndex++}`);
                values.push(nom_plateforme);
            }

            if (description_plateforme !== undefined) {
                updates.push(`description_plateforme = $${paramIndex++}`);
                values.push(description_plateforme);
            }

            if (logoPath !== current.logo_plateforme) {
                updates.push(`logo_plateforme = $${paramIndex++}`);
                values.push(logoPath);
            }

            if (faviconPath !== current.favicon_plateforme) {
                updates.push(`favicon_plateforme = $${paramIndex++}`);
                values.push(faviconPath);
            }

            if (localisation_siege) {
                updates.push(`localisation_siege = ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)`);
                values.push(localisation_siege.lng, localisation_siege.lat);
                paramIndex += 2;
            }

            if (updates.length === 0) {
                return res.json({
                    success: true,
                    message: 'Aucune modification',
                    data: current
                });
            }

            updates.push(`date_mise_a_jour = NOW()`);
            values.push(1); // id = 1

            const updateQuery = `
                UPDATE PLATEFORME 
                SET ${updates.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING *
            `;

            const result = await client.query(updateQuery, values);
            const updated = result.rows[0];

            // Journaliser l'action
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'PLATEFORME',
                ressource_id: 1,
                donnees_avant: current,
                donnees_apres: updated,
                utilisateur_id: req.user.id,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent')
            });

            await client.query('COMMIT');

            // Invalidation du cache
            await CacheService.del('plateforme:infos');

            logInfo(`Plateforme mise à jour par utilisateur ${req.user.id}`);

            res.json({
                success: true,
                data: updated,
                message: 'Plateforme mise à jour avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur mise à jour plateforme:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les statistiques globales de la plateforme
     * @route GET /api/v1/plateforme/stats
     * @access PUBLIC
     */
    async getStats(req, res, next) {
        try {
            const stats = await this._getGlobalStats();

            res.json({
                success: true,
                data: stats
            });

        } catch (error) {
            logError('Erreur récupération statistiques:', error);
            next(error);
        }
    }

    /**
     * Récupérer l'historique des dépenses de la plateforme
     * @route GET /api/v1/plateforme/depenses
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getDepenses(req, res, next) {
        try {
            const {
                page = 1,
                limit = 50,
                date_debut,
                date_fin,
                type
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    d.*,
                    COUNT(*) OVER() as total_count
                FROM (
                    SELECT 
                        jsonb_array_elements(depenses_plateforme) as depense
                    FROM PLATEFORME
                    WHERE id = 1
                ) d
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            if (date_debut) {
                query += ` AND (d.depense->>'date')::timestamp >= $${paramIndex}`;
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                query += ` AND (d.depense->>'date')::timestamp <= $${paramIndex}`;
                params.push(date_fin);
                paramIndex++;
            }

            if (type) {
                query += ` AND d.depense->>'type' = $${paramIndex}`;
                params.push(type);
                paramIndex++;
            }

            query += ` ORDER BY (d.depense->>'date')::timestamp DESC
                       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await database.query(query, params);
            
            // Récupérer le total des dépenses
            const totalResult = await database.query(`
                SELECT 
                    SUM((depense->>'montant')::numeric) as total
                FROM (
                    SELECT jsonb_array_elements(depenses_plateforme) as depense
                    FROM PLATEFORME
                    WHERE id = 1
                ) d
            `);

            const total = result.rows[0]?.total_count || 0;

            // Formater les résultats
            const depenses = result.rows.map(row => ({
                ...row.depense,
                date: new Date(row.depense.date)
            }));

            res.json({
                success: true,
                data: depenses,
                total_depenses: parseFloat(totalResult.rows[0]?.total || 0),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            });

        } catch (error) {
            logError('Erreur récupération dépenses:', error);
            next(error);
        }
    }

    /**
     * Ajouter une dépense
     * @route POST /api/v1/plateforme/depenses
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async ajouterDepense(req, res, next) {
        const client = await database.pool.connect();
        
        try {
            await client.query('BEGIN');

            const {
                type,
                montant,
                description,
                reference_type,
                reference_id
            } = req.body;

            if (!type || !montant || montant <= 0) {
                throw new ValidationError('Type et montant valide requis');
            }

            const nouvelleDepense = {
                id: Date.now(),
                type,
                montant: parseFloat(montant),
                description,
                reference_type,
                reference_id,
                date: new Date().toISOString(),
                ajoute_par: req.user.id
            };

            await client.query(`
                UPDATE PLATEFORME 
                SET depenses_plateforme = depenses_plateforme || $1::jsonb,
                    portefeuille_plateforme = portefeuille_plateforme - $2,
                    date_mise_a_jour = NOW()
                WHERE id = 1
            `, [JSON.stringify([nouvelleDepense]), montant]);

            // Journaliser l'action
            await AuditService.log({
                action: 'ADD_DEPENSE',
                ressource_type: 'PLATEFORME',
                ressource_id: 1,
                metadata: { depense: nouvelleDepense },
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            // Invalidation du cache
            await CacheService.del('plateforme:infos');

            logInfo(`Dépense ajoutée: ${montant} FCFA - ${type} par ${req.user.id}`);

            res.status(201).json({
                success: true,
                data: nouvelleDepense,
                message: 'Dépense ajoutée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur ajout dépense:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer le portefeuille de la plateforme
     * @route GET /api/v1/plateforme/portefeuille
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getPortefeuille(req, res, next) {
        try {
            const result = await database.query(`
                SELECT 
                    portefeuille_plateforme as solde,
                    depenses_plateforme as depenses,
                    date_mise_a_jour as derniere_mise_a_jour
                FROM PLATEFORME
                WHERE id = 1
            `);

            if (result.rows.length === 0) {
                throw new AppError('Configuration plateforme non trouvée', 404);
            }

            // Calculer le total des dépenses
            const depenses = result.rows[0].depenses || [];
            const totalDepenses = depenses.reduce((sum, d) => sum + (d.montant || 0), 0);

            res.json({
                success: true,
                data: {
                    solde: parseFloat(result.rows[0].solde),
                    total_depenses: totalDepenses,
                    solde_net: parseFloat(result.rows[0].solde) - totalDepenses,
                    derniere_mise_a_jour: result.rows[0].derniere_mise_a_jour
                }
            });

        } catch (error) {
            logError('Erreur récupération portefeuille:', error);
            next(error);
        }
    }

    /**
     * Récupérer les entités de la plateforme
     * @route GET /api/v1/plateforme/entites
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getEntites(req, res, next) {
        try {
            const [
                compagnies,
                restaurants,
                boutiques,
                entreprisesLivraison
            ] = await Promise.all([
                database.query(`
                    SELECT id, nom_compagnie as nom, 'COMPAGNIE_TRANSPORT' as type,
                           est_actif, date_creation
                    FROM COMPAGNIESTRANSPORT
                    WHERE est_supprime = false
                    ORDER BY date_creation DESC
                `),
                database.query(`
                    SELECT id, nom_restaurant_fast_food as nom, 'RESTAURANT_FAST_FOOD' as type,
                           est_actif, date_creation
                    FROM RESTAURANTSFASTFOOD
                    WHERE est_supprime = false
                    ORDER BY date_creation DESC
                `),
                database.query(`
                    SELECT id, nom_boutique as nom, 'BOUTIQUE' as type,
                           est_actif, date_creation
                    FROM BOUTIQUES
                    WHERE est_supprime = false
                    ORDER BY date_creation DESC
                `),
                database.query(`
                    SELECT id, nom_entreprise_livraison as nom, 'ENTREPRISE_LIVRAISON' as type,
                           est_actif, date_creation
                    FROM ENTREPRISE_LIVRAISON
                    WHERE est_actif = true
                    ORDER BY date_creation DESC
                `)
            ]);

            const entites = [
                ...compagnies.rows,
                ...restaurants.rows,
                ...boutiques.rows,
                ...entreprisesLivraison.rows
            ];

            res.json({
                success: true,
                data: entites,
                total: entites.length,
                details: {
                    compagnies: compagnies.rows.length,
                    restaurants: restaurants.rows.length,
                    boutiques: boutiques.rows.length,
                    entreprises_livraison: entreprisesLivraison.rows.length
                }
            });

        } catch (error) {
            logError('Erreur récupération entités:', error);
            next(error);
        }
    }

    /**
     * Récupérer les utilisateurs de la plateforme (admin)
     * @route GET /api/v1/plateforme/utilisateurs
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getUtilisateurs(req, res, next) {
        try {
            const {
                page = 1,
                limit = 50,
                role,
                statut,
                recherche,
                tri = 'date_creation_desc'
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    c.id,
                    c.email,
                    c.nom_utilisateur_compte,
                    c.numero_de_telephone,
                    c.photo_profil_compte,
                    c.statut,
                    c.compte_role,
                    c.date_creation,
                    c.date_derniere_connexion,
                    COUNT(*) OVER() as total_count,
                    (
                        SELECT COUNT(*) FROM NOTIFICATIONS 
                        WHERE destinataire_id = c.id AND est_lue = false
                    ) as notifications_non_lues
                FROM COMPTES c
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            if (role) {
                query += ` AND c.compte_role = $${paramIndex}`;
                params.push(role);
                paramIndex++;
            }

            if (statut) {
                query += ` AND c.statut = $${paramIndex}`;
                params.push(statut);
                paramIndex++;
            }

            if (recherche) {
                query += ` AND (c.nom_utilisateur_compte ILIKE $${paramIndex} 
                            OR c.email ILIKE $${paramIndex}
                            OR c.numero_de_telephone ILIKE $${paramIndex})`;
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            // Tri
            switch (tri) {
                case 'date_creation_asc':
                    query += ` ORDER BY c.date_creation ASC`;
                    break;
                case 'nom_asc':
                    query += ` ORDER BY c.nom_utilisateur_compte ASC`;
                    break;
                case 'nom_desc':
                    query += ` ORDER BY c.nom_utilisateur_compte DESC`;
                    break;
                default:
                    query += ` ORDER BY c.date_creation DESC`;
            }

            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await database.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Statistiques des utilisateurs
            const stats = await database.query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE compte_role = 'UTILISATEUR_PRIVE_SIMPLE') as utilisateurs_simples,
                    COUNT(*) FILTER (WHERE compte_role = 'UTILISATEUR_VENDEUR') as vendeurs,
                    COUNT(*) FILTER (WHERE compte_role LIKE '%ADMIN%') as administrateurs,
                    COUNT(*) FILTER (WHERE statut = 'NON_AUTHENTIFIE') as non_verifies,
                    COUNT(*) FILTER (WHERE statut = 'SUSPENDU') as suspendus,
                    COUNT(*) FILTER (WHERE statut = 'BANNI') as bannis,
                    COUNT(*) FILTER (WHERE date_creation >= NOW() - INTERVAL '30 days') as nouveaux_30j
                FROM COMPTES
            `);

            res.json({
                success: true,
                data: result.rows,
                statistiques: stats.rows[0],
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            });

        } catch (error) {
            logError('Erreur récupération utilisateurs:', error);
            next(error);
        }
    }

    /**
     * Récupérer les logs d'activité de la plateforme
     * @route GET /api/v1/plateforme/logs
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getLogs(req, res, next) {
        try {
            const {
                page = 1,
                limit = 50,
                action_type,
                table_concernee,
                utilisateur_id,
                date_debut,
                date_fin
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    ha.*,
                    c.nom_utilisateur_compte as utilisateur_nom,
                    COUNT(*) OVER() as total_count
                FROM HISTORIQUE_ACTIONS ha
                LEFT JOIN COMPTES c ON c.id = ha.utilisateur_id
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            if (action_type) {
                query += ` AND ha.action_type = $${paramIndex}`;
                params.push(action_type);
                paramIndex++;
            }

            if (table_concernee) {
                query += ` AND ha.table_concernee = $${paramIndex}`;
                params.push(table_concernee);
                paramIndex++;
            }

            if (utilisateur_id) {
                query += ` AND ha.utilisateur_id = $${paramIndex}`;
                params.push(utilisateur_id);
                paramIndex++;
            }

            if (date_debut) {
                query += ` AND ha.date_action >= $${paramIndex}`;
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                query += ` AND ha.date_action <= $${paramIndex}`;
                params.push(date_fin);
                paramIndex++;
            }

            query += ` ORDER BY ha.date_action DESC
                       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await database.query(query, params);
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
            logError('Erreur récupération logs:', error);
            next(error);
        }
    }

    /**
     * Récupérer les transactions de la plateforme
     * @route GET /api/v1/plateforme/transactions
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getTransactions(req, res, next) {
        try {
            const {
                page = 1,
                limit = 50,
                type_transaction,
                statut,
                date_debut,
                date_fin,
                montant_min,
                montant_max
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    ht.*,
                    c_source.nom_utilisateur_compte as source_nom,
                    c_dest.nom_utilisateur_compte as destination_nom,
                    ct.nom_compagnie as compagnie_nom,
                    b.nom_boutique as boutique_nom,
                    COUNT(*) OVER() as total_count
                FROM HISTORIQUE_TRANSACTIONS ht
                LEFT JOIN COMPTES c_source ON c_source.id = ht.compte_source_id
                LEFT JOIN COMPTES c_dest ON c_dest.id = ht.compte_destination_id
                LEFT JOIN COMPAGNIESTRANSPORT ct ON ct.id = ht.compagnie_id
                LEFT JOIN BOUTIQUES b ON b.id = ht.boutique_id
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            if (type_transaction) {
                query += ` AND ht.type_transaction = $${paramIndex}`;
                params.push(type_transaction);
                paramIndex++;
            }

            if (statut) {
                query += ` AND ht.statut_transaction = $${paramIndex}`;
                params.push(statut);
                paramIndex++;
            }

            if (date_debut) {
                query += ` AND ht.date_transaction >= $${paramIndex}`;
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                query += ` AND ht.date_transaction <= $${paramIndex}`;
                params.push(date_fin);
                paramIndex++;
            }

            if (montant_min) {
                query += ` AND ht.montant >= $${paramIndex}`;
                params.push(parseFloat(montant_min));
                paramIndex++;
            }

            if (montant_max) {
                query += ` AND ht.montant <= $${paramIndex}`;
                params.push(parseFloat(montant_max));
                paramIndex++;
            }

            query += ` ORDER BY ht.date_transaction DESC
                       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await database.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Résumé des transactions
            const resume = await database.query(`
                SELECT 
                    SUM(montant) FILTER (WHERE type_transaction = 'COMMISSION') as total_commissions,
                    SUM(montant) FILTER (WHERE type_transaction = 'REMBOURSEMENT') as total_remboursements,
                    SUM(montant) FILTER (WHERE type_transaction = 'ACHAT') as total_achats,
                    SUM(montant) FILTER (WHERE statut_transaction = 'COMPLETEE') as total_completees,
                    SUM(montant) FILTER (WHERE statut_transaction = 'ECHOUEE') as total_echouees
                FROM HISTORIQUE_TRANSACTIONS
                WHERE date_transaction >= NOW() - INTERVAL '30 days'
            `);

            res.json({
                success: true,
                data: result.rows,
                resume: resume.rows[0],
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            });

        } catch (error) {
            logError('Erreur récupération transactions:', error);
            next(error);
        }
    }

    // ==================== MÉTHODES PRIVÉES ====================

    /**
     * Récupérer les statistiques globales de la plateforme
     */
    async _getGlobalStats() {
        const stats = await database.query(`
            WITH stats_utilisateurs AS (
                SELECT 
                    COUNT(*) as total_utilisateurs,
                    COUNT(*) FILTER (WHERE compte_role = 'UTILISATEUR_PRIVE_SIMPLE') as clients,
                    COUNT(*) FILTER (WHERE compte_role LIKE '%VENDEUR%' OR compte_role LIKE '%COMPAGNIE%') as vendeurs,
                    COUNT(*) FILTER (WHERE compte_role LIKE '%ADMIN%') as administrateurs,
                    COUNT(*) FILTER (WHERE statut = 'NON_AUTHENTIFIE') as non_verifies,
                    COUNT(*) FILTER (WHERE date_creation >= NOW() - INTERVAL '30 days') as nouveaux_30j
                FROM COMPTES
            ),
            stats_transactions AS (
                SELECT 
                    COALESCE(SUM(montant), 0) as total_commissions_30j
                FROM HISTORIQUE_TRANSACTIONS
                WHERE type_transaction = 'COMMISSION'
                  AND statut_transaction = 'COMPLETEE'
                  AND date_transaction >= NOW() - INTERVAL '30 days'
            ),
            stats_entites AS (
                SELECT 
                    (SELECT COUNT(*) FROM COMPAGNIESTRANSPORT WHERE est_supprime = false) as compagnies,
                    (SELECT COUNT(*) FROM RESTAURANTSFASTFOOD WHERE est_supprime = false) as restaurants,
                    (SELECT COUNT(*) FROM BOUTIQUES WHERE est_supprime = false) as boutiques,
                    (SELECT COUNT(*) FROM ENTREPRISE_LIVRAISON WHERE est_actif = true) as entreprises_livraison
            ),
            stats_commandes AS (
                SELECT 
                    COUNT(*) as total_commandes_30j,
                    COALESCE(SUM(prix_total_commande), 0) as chiffre_affaires_30j
                FROM COMMANDESBOUTIQUES
                WHERE date_commande >= NOW() - INTERVAL '30 days'
            )
            SELECT 
                row_to_json(su) as utilisateurs,
                row_to_json(st) as transactions,
                row_to_json(se) as entites,
                row_to_json(sc) as commandes,
                (SELECT portefeuille_plateforme FROM PLATEFORME WHERE id = 1) as portefeuille
            FROM stats_utilisateurs su
            CROSS JOIN stats_transactions st
            CROSS JOIN stats_entites se
            CROSS JOIN stats_commandes sc
        `);

        return stats.rows[0] || {
            utilisateurs: {},
            transactions: {},
            entites: {},
            commandes: {},
            portefeuille: 0
        };
    }
}

module.exports = new PlateformeController();