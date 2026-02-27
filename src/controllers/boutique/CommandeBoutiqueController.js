// src/controllers/boutique/CommandeBoutiqueController.js
const pool = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const PaymentService = require('../../services/payment/PaymentService');
const NotificationService = require('../../services/notification/NotificationService'); 
const AuditService = require('../../services/audit/AuditService');
const GeoService = require('../../services/geo/GeoService');
const CacheService = require('../../services/cache/CacheService');
const EmailService = require('../../services/email/EmailService');
const ExportService = require('../../services/export/ExportService');
const { logInfo, logError, logDebug } = require('../../configuration/logger');
const { STATUT_COMMANDE, MODE_PAIEMENT } = require('../../utils/constants/enums');

class CommandeBoutiqueController {
    /**
     * Créer une nouvelle commande
     * @route POST /api/v1/boutiques/:boutiqueId/commandes
     * @access PUBLIC (avec ou sans authentification)
     */
    async create(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const { boutiqueId } = req.params;
            const {
                produits,
                pour_livrer = false,
                passer_recuperer = false,
                mode_paiement,
                adresse_livraison_id,
                notes_commande,
                promo_code,
                informations_client,
                date_souhaitee,
                heure_souhaitee,
                contact_telephone,
                contact_email,
                livraison_express = false
            } = req.body;

            const compte_id = req.user?.id;

            // 1. VALIDATIONS INITIALES
            this._validateCommandeInput({
                produits,
                pour_livrer,
                passer_recuperer,
                mode_paiement
            });

            // 2. VÉRIFICATION BOUTIQUE
            const boutique = await this._checkBoutiqueDisponible(client, boutiqueId);

            // 3. VÉRIFICATION HORAIRES D'OUVERTURE
            await this._checkHorairesOuverture(client, boutiqueId, date_souhaitee, heure_souhaitee);

            // 4. VALIDATION ET CALCUL DES PRODUITS
            const { produitsDetails, prix_sous_total, poids_total } = 
                await this._validateAndCalculateProducts(client, produits, boutiqueId);

            // 5. VALIDATION ET APPLICATION PROMO CODE
            let remise_appliquee = 0;
            let promo_id = null;
            let promo_details = null;

            if (promo_code) {
                const promo = await this._validateAndApplyPromo(
                    client, 
                    promo_code, 
                    boutiqueId, 
                    prix_sous_total,
                    produitsDetails
                );
                remise_appliquee = promo.montant_remise;
                promo_id = promo.id;
                promo_details = promo.details;
            }

            // 6. CALCUL FRAIS DE LIVRAISON
            let frais_livraison_commande = 0;
            let distance_livraison = null;
            let adresse_livraison = null;

            if (pour_livrer) {
                const livraison = await this._calculerFraisLivraison(
                    client,
                    boutiqueId,
                    adresse_livraison_id,
                    {
                        poids_total,
                        livraison_express,
                        montant_commande: prix_sous_total - remise_appliquee
                    }
                );
                frais_livraison_commande = livraison.frais;
                distance_livraison = livraison.distance;
                adresse_livraison = livraison.adresse;
            }

            // 7. CALCUL TOTAL
            const prix_total_commande = prix_sous_total + frais_livraison_commande - remise_appliquee;

            // 8. GÉNÉRATION RÉFÉRENCE UNIQUE
            const reference = await this._generateReferenceCommande(client, boutiqueId);

            // 9. CRÉATION DE LA COMMANDE
            const commandeData = {
                reference,
                produits: produitsDetails,
                client: informations_client || {},
                notes: notes_commande,
                date_souhaitee,
                heure_souhaitee,
                contact: {
                    telephone: contact_telephone,
                    email: contact_email
                },
                livraison: pour_livrer ? {
                    adresse: adresse_livraison,
                    distance: distance_livraison,
                    express: livraison_express
                } : null,
                promo: promo_details,
                ip_creation: req.ip,
                user_agent: req.get('User-Agent')
            };

            const result = await client.query(
                `INSERT INTO COMMANDESBOUTIQUES (
                    reference_commande,
                    id_boutique,
                    compte_id,
                    donnees_commandes,
                    prix_sous_total,
                    frais_livraison_commande,
                    remise_appliquee,
                    prix_total_commande,
                    statut_commande,
                    pour_livrer,
                    passer_recuperer,
                    mode_paiement,
                    notes_commande,
                    adresse_livraison_id,
                    date_souhaitee_livraison,
                    contact_telephone,
                    contact_email,
                    donnees_supplementaires,
                    date_commande,
                    date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW())
                RETURNING *`,
                [
                    reference,
                    boutiqueId,
                    compte_id || null,
                    JSON.stringify(commandeData),
                    prix_sous_total,
                    frais_livraison_commande,
                    remise_appliquee,
                    prix_total_commande,
                    'EN_ATTENTE',
                    pour_livrer,
                    passer_recuperer,
                    mode_paiement,
                    notes_commande || null,
                    adresse_livraison_id || null,
                    date_souhaitee || null,
                    contact_telephone || null,
                    contact_email || null,
                    JSON.stringify({ created_from: 'web', ip: req.ip })
                ]
            );

            const commande = result.rows[0];

            // 10. MISE À JOUR DES STOCKS
            await this._updateStocks(client, produitsDetails);

            // 11. CRÉATION DU PAIEMENT SI NÉCESSAIRE
            let paiement = null;
            if (mode_paiement === 'DIRECT') {
                paiement = await this._initierPaiement(commande, {
                    telephone: contact_telephone || informations_client?.telephone,
                    email: contact_email || informations_client?.email
                });

                await client.query(
                    `UPDATE COMMANDESBOUTIQUES 
                     SET donnees_supplementaires = donnees_supplementaires || $1
                     WHERE id = $2`,
                    [JSON.stringify({ paiement }), commande.id]
                );
            }

            // 12. CRÉATION DEMANDE LIVRAISON SI NÉCESSAIRE
            if (pour_livrer) {
                await this._creerDemandeLivraison(client, commande, {
                    adresse: adresse_livraison,
                    distance: distance_livraison,
                    express: livraison_express
                });
            }

            // 13. NOTIFICATIONS
            await this._envoyerNotificationsCommande(commande, boutique, produitsDetails);

            await client.query('COMMIT');

            // 14. INVALIDATION CACHE
            await CacheService.delPattern(`boutique:${boutiqueId}:commandes*`);
            if (compte_id) {
                await CacheService.delPattern(`user:${compte_id}:commandes*`);
            }

            logInfo(`Commande créée: ${reference} - Total: ${prix_total_commande} FCFA`);

            // 15. RÉPONSE
            res.status(201).json({
                status: 'success',
                data: {
                    ...commande,
                    paiement: paiement ? {
                        reference: paiement.reference,
                        url_paiement: paiement.url,
                        montant: paiement.montant
                    } : undefined
                },
                message: 'Commande créée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur création commande:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer toutes les commandes d'une boutique
     * @route GET /api/v1/boutiques/:boutiqueId/commandes
     * @access ADMINISTRATEUR_PLATEFORME, PROPRIETAIRE_BOUTIQUE
     */
    async findAll(req, res, next) {
        try {
            const { boutiqueId } = req.params;
            const {
                page = 1,
                limit = 20,
                statut,
                date_debut,
                date_fin,
                client_id,
                recherche,
                mode_paiement,
                montant_min,
                montant_max,
                avec_livraison,
                tri = 'date_desc',
                export: exportFormat
            } = req.query;

            const offset = (page - 1) * limit;
            const params = [boutiqueId];
            let paramIndex = 2;
            const conditions = ['id_boutique = $1'];

            // Construction dynamique des filtres
            if (statut) {
                const statuts = statut.split(',');
                conditions.push(`statut_commande = ANY($${paramIndex}::text[])`);
                params.push(statuts);
                paramIndex++;
            }

            if (date_debut) {
                conditions.push(`date_commande >= $${paramIndex}`);
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                conditions.push(`date_commande <= $${paramIndex}`);
                params.push(date_fin);
                paramIndex++;
            }

            if (client_id) {
                conditions.push(`compte_id = $${paramIndex}`);
                params.push(client_id);
                paramIndex++;
            }

            if (recherche) {
                conditions.push(`(
                    reference_commande ILIKE $${paramIndex} OR
                    contact_telephone ILIKE $${paramIndex} OR
                    contact_email ILIKE $${paramIndex} OR
                    donnees_commandes->>'notes' ILIKE $${paramIndex}
                )`);
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            if (mode_paiement) {
                conditions.push(`mode_paiement = $${paramIndex}`);
                params.push(mode_paiement);
                paramIndex++;
            }

            if (montant_min) {
                conditions.push(`prix_total_commande >= $${paramIndex}`);
                params.push(parseFloat(montant_min));
                paramIndex++;
            }

            if (montant_max) {
                conditions.push(`prix_total_commande <= $${paramIndex}`);
                params.push(parseFloat(montant_max));
                paramIndex++;
            }

            if (avec_livraison !== undefined) {
                conditions.push(`pour_livrer = $${paramIndex}`);
                params.push(avec_livraison === 'true');
                paramIndex++;
            }

            // Construction requête principale
            const query = `
                SELECT 
                    c.*,
                    acc.nom_utilisateur_compte as client_nom,
                    acc.photo_profil_compte as client_photo,
                    acc.email as client_email,
                    acc.numero_de_telephone as client_telephone,
                    a.ligne_1 as adresse_ligne1,
                    a.ville as adresse_ville
                FROM COMMANDESBOUTIQUES c
                LEFT JOIN COMPTES acc ON acc.id = c.compte_id
                LEFT JOIN ADRESSES a ON a.id = c.adresse_livraison_id
                WHERE ${conditions.join(' AND ')}
                ${this._buildOrderBy(tri)}
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;

            params.push(parseInt(limit), offset);

            const result = await pool.query(query, params);

            // Comptage total
            const countQuery = `
                SELECT COUNT(*) 
                FROM COMMANDESBOUTIQUES c
                WHERE ${conditions.join(' AND ')}
            `;
            const countResult = await pool.query(countQuery, params.slice(0, -2));
            const total = parseInt(countResult.rows[0].count);

            // Statistiques pour la période
            const stats = await this._getCommandesStats(boutiqueId, date_debut, date_fin);

            // Export si demandé
            if (exportFormat) {
                return this._exportCommandes(result.rows, exportFormat, res);
            }

            res.json({
                status: 'success',
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit),
                    has_next: offset + limit < total,
                    has_prev: page > 1
                },
                statistiques: stats
            });

        } catch (error) {
            logError('Erreur récupération commandes:', error);
            next(error);
        }
    }

    /**
     * Récupérer les commandes de l'utilisateur connecté
     * @route GET /api/v1/mes-commandes
     * @access PRIVATE
     */
    async findMesCommandes(req, res, next) {
        try {
            const {
                page = 1,
                limit = 10,
                statut,
                boutique_id,
                date_debut,
                date_fin
            } = req.query;

            const offset = (page - 1) * limit;
            const params = [req.user.id];
            let paramIndex = 2;
            const conditions = ['compte_id = $1'];

            if (statut) {
                const statuts = statut.split(',');
                conditions.push(`statut_commande = ANY($${paramIndex}::text[])`);
                params.push(statuts);
                paramIndex++;
            }

            if (boutique_id) {
                conditions.push(`id_boutique = $${paramIndex}`);
                params.push(boutique_id);
                paramIndex++;
            }

            if (date_debut) {
                conditions.push(`date_commande >= $${paramIndex}`);
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                conditions.push(`date_commande <= $${paramIndex}`);
                params.push(date_fin);
                paramIndex++;
            }

            const query = `
                SELECT 
                    c.*,
                    b.nom_boutique,
                    b.logo_boutique,
                    COUNT(*) OVER() as total_count
                FROM COMMANDESBOUTIQUES c
                JOIN BOUTIQUES b ON b.id = c.id_boutique
                WHERE ${conditions.join(' AND ')}
                ORDER BY c.date_commande DESC
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;

            params.push(parseInt(limit), offset);

            const result = await pool.query(query, params);

            const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

            // Statistiques personnelles
            const stats = await pool.query(
                `SELECT 
                    COUNT(*) as total,
                    SUM(prix_total_commande) as total_depense,
                    AVG(prix_total_commande) as panier_moyen,
                    COUNT(*) FILTER (WHERE statut_commande = 'LIVREE') as commandes_livrees
                FROM COMMANDESBOUTIQUES
                WHERE compte_id = $1`,
                [req.user.id]
            );

            res.json({
                status: 'success',
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                },
                statistiques: stats.rows[0]
            });

        } catch (error) {
            logError('Erreur récupération commandes utilisateur:', error);
            next(error);
        }
    }

    /**
     * Récupérer une commande par ID ou référence
     * @route GET /api/v1/commandes/:identifier
     * @access PUBLIC (avec vérification)
     */
    async findById(req, res, next) {
        try {
            const { identifier } = req.params;
            const { inclure_details = true } = req.query;

            // Vérification cache
            const cacheKey = `commande:${identifier}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    status: 'success',
                    data: cached,
                    from_cache: true
                });
            }

            // Recherche commande
            const query = `
                SELECT 
                    c.*,
                    b.nom_boutique,
                    b.logo_boutique,
                    b.telephone_contact as boutique_telephone,
                    b.email_contact as boutique_email,
                    acc.nom_utilisateur_compte as client_nom,
                    acc.email as client_email,
                    acc.numero_de_telephone as client_telephone,
                    acc.photo_profil_compte as client_photo,
                    a.*
                FROM COMMANDESBOUTIQUES c
                LEFT JOIN BOUTIQUES b ON b.id = c.id_boutique
                LEFT JOIN COMPTES acc ON acc.id = c.compte_id
                LEFT JOIN ADRESSES a ON a.id = c.adresse_livraison_id
                WHERE ${isNaN(identifier) ? 'c.reference_commande' : 'c.id'} = $1
            `;

            const result = await pool.query(query, [identifier]);

            if (result.rows.length === 0) {
                throw new AppError('Commande non trouvée', 404);
            }

            const commande = result.rows[0];

            // Vérification permission
            if (req.user && 
                req.user.role !== 'ADMINISTRATEUR_PLATEFORME' && 
                commande.compte_id && 
                commande.compte_id !== req.user.id) {
                
                // Vérifier si c'est le propriétaire de la boutique
                const isBoutiqueOwner = await pool.query(
                    'SELECT 1 FROM BOUTIQUES WHERE id = $1 AND proprietaire_id = $2',
                    [commande.id_boutique, req.user.id]
                );
                
                if (isBoutiqueOwner.rows.length === 0) {
                    throw new AppError('Accès non autorisé', 403);
                }
            }

            // Enrichissement des données
            if (inclure_details) {
                await this._enrichirCommande(commande);
            }

            // Récupération historique
            const historique = await pool.query(
                `SELECT * FROM HISTORIQUE_ACTIONS
                WHERE table_concernee = 'COMMANDESBOUTIQUES'
                AND entite_id = $1
                ORDER BY date_action DESC`,
                [commande.id]
            );
            commande.historique = historique.rows;

            // Récupération suivi livraison si applicable
            if (commande.pour_livrer) {
                const livraison = await pool.query(
                    `SELECT * FROM DEMANDES_LIVRAISON
                    WHERE commande_type = 'BOUTIQUE' AND commande_id = $1`,
                    [commande.id]
                );
                commande.suivi_livraison = livraison.rows[0] || null;
            }

            // Mise en cache
            await CacheService.set(cacheKey, commande, 300); // 5 minutes

            res.json({
                status: 'success',
                data: commande
            });

        } catch (error) {
            logError('Erreur récupération commande:', error);
            next(error);
        }
    }

    /**
     * Mettre à jour le statut d'une commande
     * @route PATCH /api/v1/commandes/:id/statut
     * @access ADMINISTRATEUR_PLATEFORME, PROPRIETAIRE_BOUTIQUE
     */
    async updateStatut(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { statut, motif, notify_client = true } = req.body;

            // Récupération commande
            const commandeQuery = await client.query(
                'SELECT * FROM COMMANDESBOUTIQUES WHERE id = $1',
                [id]
            );

            if (commandeQuery.rows.length === 0) {
                throw new AppError('Commande non trouvée', 404);
            }

            const commande = commandeQuery.rows[0];
            const ancienStatut = commande.statut_commande;

            // Validation transition
            await this._validerTransitionStatut(ancienStatut, statut, commande);

            // Mise à jour statut
            const result = await client.query(
                `UPDATE COMMANDESBOUTIQUES 
                SET statut_commande = $1,
                    date_mise_a_jour = NOW()
                WHERE id = $2
                RETURNING *`,
                [statut, id]
            );

            const commandeMaj = result.rows[0];

            // Actions spécifiques selon nouveau statut
            await this._executerActionsStatut(client, commande, ancienStatut, statut, motif);

            // Historique
            await client.query(
                `INSERT INTO HISTORIQUE_ACTIONS (
                    action_type, table_concernee, entite_id,
                    donnees_avant, donnees_apres, utilisateur_id,
                    date_action, metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
                [
                    'STATUT_UPDATE',
                    'COMMANDESBOUTIQUES',
                    id,
                    JSON.stringify({ statut: ancienStatut }),
                    JSON.stringify({ statut, motif }),
                    req.user?.id,
                    JSON.stringify({ motif })
                ]
            );

            await client.query('COMMIT');

            // Notifications
            if (notify_client && commande.compte_id) {
                await this._notifierChangementStatut(commandeMaj, ancienStatut, statut, motif);
            }

            // Invalidation cache
            await CacheService.del(`commande:${commande.reference_commande}`);
            await CacheService.del(`commande:${commande.id}`);

            logInfo(`Commande ${commande.reference_commande}: ${ancienStatut} -> ${statut}`);

            res.json({
                status: 'success',
                data: commandeMaj,
                message: `Statut mis à jour: ${statut}`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur mise à jour statut:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Annuler une commande
     * @route POST /api/v1/commandes/:id/annuler
     * @access PUBLIC (client) / PRIVATE (admin)
     */
    async annuler(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { motif, remboursement = false } = req.body;

            // Récupération commande
            const commandeQuery = await client.query(
                'SELECT * FROM COMMANDESBOUTIQUES WHERE id = $1',
                [id]
            );

            if (commandeQuery.rows.length === 0) {
                throw new AppError('Commande non trouvée', 404);
            }

            const commande = commandeQuery.rows[0];

            // Vérification possibilité d'annulation
            await this._verifierAnnulationPossible(commande, req.user);

            // Annulation
            await client.query(
                `UPDATE COMMANDESBOUTIQUES 
                SET statut_commande = 'ANNULEE',
                    date_mise_a_jour = NOW(),
                    donnees_supplementaires = donnees_supplementaires || $1
                WHERE id = $2`,
                [
                    JSON.stringify({ 
                        annulation: {
                            date: new Date(),
                            motif,
                            par: req.user?.id || 'client',
                            remboursement
                        }
                    }),
                    id
                ]
            );

            // Restauration des stocks si nécessaire
            if (commande.statut_commande !== 'LIVREE' && commande.statut_commande !== 'RECUPEREE') {
                await this._restaurerStocks(client, commande);
            }

            // Remboursement si demandé
            if (remboursement) {
                await this._initierRemboursement(client, commande, motif);
            }

            await client.query('COMMIT');

            // Notification
            await NotificationService.notifyUser(commande.compte_id, {
                type: 'COMMANDE_ANNULEE',
                titre: 'Commande annulée',
                message: `Votre commande ${commande.reference_commande} a été annulée`,
                donnees: { commande_id: id, motif, remboursement }
            });

            res.json({
                status: 'success',
                message: 'Commande annulée avec succès',
                data: { remboursement }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur annulation commande:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Valider le paiement d'une commande
     * @route POST /api/v1/commandes/:id/valider-paiement
     * @access ADMINISTRATEUR_PLATEFORME, PROPRIETAIRE_BOUTIQUE
     */
    async validerPaiement(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { reference_paiement, mode_paiement } = req.body;

            const commande = await client.query(
                'SELECT * FROM COMMANDESBOUTIQUES WHERE id = $1',
                [id]
            );

            if (commande.rows.length === 0) {
                throw new AppError('Commande non trouvée', 404);
            }

            // Mise à jour paiement
            await client.query(
                `UPDATE COMMANDESBOUTIQUES 
                SET statut_commande = 'CONFIRMEE',
                    mode_paiement = COALESCE($1, mode_paiement),
                    donnees_supplementaires = donnees_supplementaires || $2,
                    date_mise_a_jour = NOW()
                WHERE id = $3`,
                [
                    mode_paiement,
                    JSON.stringify({ 
                        paiement_valide: {
                            date: new Date(),
                            reference: reference_paiement,
                            valide_par: req.user?.id
                        }
                    }),
                    id
                ]
            );

            // Création dans historique transactions
            await client.query(
                `INSERT INTO HISTORIQUE_TRANSACTIONS (
                    type_transaction, montant, statut_transaction,
                    commande_boutique_id, reference_externe,
                    date_transaction
                ) VALUES ($1, $2, $3, $4, $5, NOW())`,
                [
                    'VENTE',
                    commande.rows[0].prix_total_commande,
                    'COMPLETEE',
                    id,
                    reference_paiement
                ]
            );

            await client.query('COMMIT');

            // Notification
            await NotificationService.notifyUser(commande.rows[0].compte_id, {
                type: 'PAIEMENT_VALIDE',
                titre: 'Paiement confirmé',
                message: `Le paiement de votre commande ${commande.rows[0].reference_commande} a été validé`,
                donnees: { commande_id: id }
            });

            res.json({
                status: 'success',
                message: 'Paiement validé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur validation paiement:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Marquer une commande comme prête
     * @route POST /api/v1/commandes/:id/prete
     * @access PROPRIETAIRE_BOUTIQUE, STAFF_BOUTIQUE
     */
    async marquerPrete(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { temps_preparation, notes } = req.body;

            const commande = await client.query(
                'SELECT * FROM COMMANDESBOUTIQUES WHERE id = $1',
                [id]
            );

            if (commande.rows.length === 0) {
                throw new AppError('Commande non trouvée', 404);
            }

            await client.query(
                `UPDATE COMMANDESBOUTIQUES 
                SET statut_commande = 'PRETE',
                    date_prete = NOW(),
                    donnees_supplementaires = donnees_supplementaires || $1,
                    date_mise_a_jour = NOW()
                WHERE id = $2`,
                [
                    JSON.stringify({ 
                        preparation: {
                            duree: temps_preparation,
                            termine_par: req.user?.id,
                            notes
                        }
                    }),
                    id
                ]
            );

            await client.query('COMMIT');

            // Notification client
            if (commande.rows[0].compte_id) {
                await NotificationService.notifyUser(commande.rows[0].compte_id, {
                    type: 'COMMANDE_PRETE',
                    titre: 'Commande prête',
                    message: `Votre commande ${commande.rows[0].reference_commande} est prête`,
                    donnees: { 
                        commande_id: id,
                        mode_recuperation: commande.rows[0].passer_recuperer ? 'a_emporter' : 'livraison'
                    }
                });
            }

            res.json({
                status: 'success',
                message: 'Commande marquée comme prête'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur marquage commande prête:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Confirmer la livraison/récupération d'une commande
     * @route POST /api/v1/commandes/:id/terminer
     * @access PROPRIETAIRE_BOUTIQUE, LIVREUR, CLIENT
     */
    async terminer(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { code_retrait, satisfaction } = req.body;

            const commande = await client.query(
                'SELECT * FROM COMMANDESBOUTIQUES WHERE id = $1',
                [id]
            );

            if (commande.rows.length === 0) {
                throw new AppError('Commande non trouvée', 404);
            }

            const commandeData = commande.rows[0];

            // Vérification code retrait si nécessaire
            if (commandeData.passer_recuperer && commandeData.code_retrait) {
                if (code_retrait !== commandeData.code_retrait) {
                    throw new ValidationError('Code de retrait invalide');
                }
            }

            const nouveauStatut = commandeData.pour_livrer ? 'LIVREE' : 'RECUPEREE';

            await client.query(
                `UPDATE COMMANDESBOUTIQUES 
                SET statut_commande = $1,
                    date_livraison = NOW(),
                    date_mise_a_jour = NOW(),
                    donnees_supplementaires = donnees_supplementaires || $2
                WHERE id = $3`,
                [
                    nouveauStatut,
                    JSON.stringify({ 
                        terminee: {
                            date: new Date(),
                            satisfaction,
                            par: req.user?.id || 'client'
                        }
                    }),
                    id
                ]
            );

            // Mise à jour demande livraison
            if (commandeData.pour_livrer) {
                await client.query(
                    `UPDATE DEMANDES_LIVRAISON 
                    SET statut_livraison = 'LIVREE',
                        date_livraison_effective = NOW()
                    WHERE commande_type = 'BOUTIQUE' AND commande_id = $1`,
                    [id]
                );
            }

            await client.query('COMMIT');

            // Demander un avis
            if (commandeData.compte_id) {
                await this._demanderAvis(commandeData);
            }

            res.json({
                status: 'success',
                message: `Commande ${nouveauStatut.toLowerCase()} avec succès`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur terminaison commande:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Obtenir les statistiques des commandes
     * @route GET /api/v1/boutiques/:boutiqueId/commandes/stats
     * @access ADMINISTRATEUR_PLATEFORME, PROPRIETAIRE_BOUTIQUE
     */
    async getStats(req, res, next) {
        try {
            const { boutiqueId } = req.params;
            const { periode = '30j', date_debut, date_fin } = req.query;

            let intervalle;
            let groupBy;

            switch (periode) {
                case '7j':
                    intervalle = "INTERVAL '7 days'";
                    groupBy = 'DATE(date_commande)';
                    break;
                case '30j':
                    intervalle = "INTERVAL '30 days'";
                    groupBy = 'DATE(date_commande)';
                    break;
                case '90j':
                    intervalle = "INTERVAL '90 days'";
                    groupBy = 'DATE(date_commande)';
                    break;
                case 'an':
                    intervalle = "INTERVAL '1 year'";
                    groupBy = "TO_CHAR(date_commande, 'YYYY-MM')";
                    break;
                case 'personnalise':
                    if (!date_debut || !date_fin) {
                        throw new ValidationError('Dates requises');
                    }
                    intervalle = null;
                    groupBy = 'DATE(date_commande)';
                    break;
                default:
                    intervalle = "INTERVAL '30 days'";
                    groupBy = 'DATE(date_commande)';
            }

            const dateCondition = periode === 'personnalise'
                ? `date_commande BETWEEN '${date_debut}' AND '${date_fin}'`
                : `date_commande >= NOW() - ${intervalle}`;

            // Statistiques générales
            const stats = await pool.query(`
                WITH stats_globales AS (
                    SELECT 
                        COUNT(*) as total_commandes,
                        COUNT(DISTINCT compte_id) as clients_uniques,
                        SUM(prix_total_commande) as chiffre_affaires,
                        AVG(prix_total_commande) as panier_moyen,
                        SUM(prix_sous_total) as ca_ht,
                        SUM(frais_livraison_commande) as total_frais_livraison,
                        SUM(remise_appliquee) as total_remises,
                        AVG(EXTRACT(EPOCH FROM (date_livraison - date_commande))/3600)::numeric(10,2) as delai_moyen_livraison_heures
                    FROM COMMANDESBOUTIQUES
                    WHERE id_boutique = $1
                    AND ${dateCondition}
                ),
                stats_par_statut AS (
                    SELECT 
                        statut_commande,
                        COUNT(*) as nombre,
                        SUM(prix_total_commande) as montant
                    FROM COMMANDESBOUTIQUES
                    WHERE id_boutique = $1
                    AND ${dateCondition}
                    GROUP BY statut_commande
                ),
                        SELECT 
                        ${groupBy} as periode,
                        COUNT(*) as commandes,
                        SUM(prix_total_commande) as ca
                    FROM COMMANDESBOUTIQUES
                    WHERE id_boutique = $1
                    AND ${dateCondition}
                    GROUP BY periode
                    ORDER BY periode DESC
                )
                SELECT 
                    jsonb_build_object(
                        'global', row_to_json(sg),
                        'par_statut', json_agg(ss),
                        'evolution', json_agg(se ORDER BY se.periode)
                    ) as stats
                FROM stats_globales sg
                CROSS JOIN stats_par_statut ss
                CROSS JOIN stats_evolution se
                GROUP BY sg.total_commandes, sg.clients_uniques, sg.chiffre_affaires, 
                         sg.panier_moyen, sg.ca_ht, sg.total_frais_livraison,
                         sg.total_remises, sg.delai_moyen_livraison_heures
            `, [boutiqueId]);

            // Top produits
            const topProduits = await pool.query(`
                SELECT 
                    (item->>'produit_id')::int as produit_id,
                    (item->>'nom_produit')::text as nom_produit,
                    COUNT(*) as nombre_commandes,
                    SUM((item->>'quantite')::int) as quantite_vendue,
                    SUM((item->>'prix_unitaire')::numeric * (item->>'quantite')::int) as chiffre_affaires
                FROM COMMANDESBOUTIQUES c
                CROSS JOIN LATERAL jsonb_array_elements(c.donnees_commandes->'produits') as item
                WHERE c.id_boutique = $1
                AND ${dateCondition}
                GROUP BY produit_id, nom_produit
                ORDER BY quantite_vendue DESC
                LIMIT 10
            `, [boutiqueId]);

            // Heures de pointe
            const heuresPointe = await pool.query(`
                SELECT 
                    EXTRACT(HOUR FROM date_commande) as heure,
                    COUNT(*) as commandes
                FROM COMMANDESBOUTIQUES
                WHERE id_boutique = $1
                AND ${dateCondition}
                GROUP BY heure
                ORDER BY heure
            `, [boutiqueId]);

            res.json({
                status: 'success',
                data: {
                    ...stats.rows[0]?.stats,
                    top_produits: topProduits.rows,
                    heures_pointe: heuresPointe.rows,
                    periode: periode === 'personnalise' ? { date_debut, date_fin } : periode
                }
            });

        } catch (error) {
            logError('Erreur récupération statistiques:', error);
            next(error);
        }
    }

    /**
     * Suivre une commande en temps réel
     * @route GET /api/v1/commandes/:reference/suivi
     * @access PUBLIC (avec code de suivi)
     */
    async suiviCommande(req, res, next) {
        try {
            const { reference } = req.params;
            const { code_suivi, telephone } = req.query;

            const commande = await pool.query(
                `SELECT 
                    c.*,
                    b.nom_boutique,
                    b.logo_boutique,
                    b.telephone_contact,
                    a.ligne_1,
                    a.ville,
                    a.code_postal
                FROM COMMANDESBOUTIQUES c
                LEFT JOIN BOUTIQUES b ON b.id = c.id_boutique
                LEFT JOIN ADRESSES a ON a.id = c.adresse_livraison_id
                WHERE c.reference_commande = $1`,
                [reference]
            );

            if (commande.rows.length === 0) {
                throw new AppError('Commande non trouvée', 404);
            }

            const cmd = commande.rows[0];

            // Vérification accès (soit code suivi valide, soit téléphone correspondant)
            const accesAutorise = 
                (code_suivi && cmd.donnees_supplementaires?.code_suivi === code_suivi) ||
                (telephone && cmd.contact_telephone === telephone) ||
                (req.user && (req.user.id === cmd.compte_id || req.user.role === 'ADMINISTRATEUR_PLATEFORME'));

            if (!accesAutorise) {
                throw new AppError('Accès non autorisé', 403);
            }

            // Récupération étapes de suivi
            const etapes = [
                { statut: 'EN_ATTENTE', label: 'Commande reçue', date: cmd.date_commande, completed: true },
                { statut: 'CONFIRMEE', label: 'Commande confirmée', date: cmd.date_confirmation, completed: cmd.statut_commande !== 'EN_ATTENTE' },
                { statut: 'EN_PREPARATION', label: 'En préparation', date: cmd.date_preparation, completed: ['EN_PREPARATION', 'PRETE', 'EN_LIVRAISON', 'LIVREE'].includes(cmd.statut_commande) },
                { statut: cmd.passer_recuperer ? 'PRETE' : 'EN_LIVRAISON', 
                  label: cmd.passer_recuperer ? 'Prête à être récupérée' : 'En livraison',
                  date: cmd.date_prete || cmd.date_depart_livraison,
                  completed: ['PRETE', 'EN_LIVRAISON', 'LIVREE', 'RECUPEREE'].includes(cmd.statut_commande) },
                { statut: cmd.passer_recuperer ? 'RECUPEREE' : 'LIVREE',
                  label: cmd.passer_recuperer ? 'Récupérée' : 'Livrée',
                  date: cmd.date_livraison,
                  completed: ['LIVREE', 'RECUPEREE'].includes(cmd.statut_commande) }
            ];

            // Position livreur si en cours de livraison
            let position_livreur = null;
            if (cmd.statut_commande === 'EN_LIVRAISON') {
                const livraison = await pool.query(
                    `SELECT l.localisation_actuelle 
                     FROM DEMANDES_LIVRAISON dl
                     JOIN LIVREURS l ON l.id = dl.livreur_affecte
                     WHERE dl.commande_type = 'BOUTIQUE' 
                     AND dl.commande_id = $1
                     AND dl.statut_livraison = 'EN_LIVRAISON'`,
                    [cmd.id]
                );
                if (livraison.rows[0]?.localisation_actuelle) {
                    position_livreur = livraison.rows[0].localisation_actuelle;
                }
            }

            res.json({
                status: 'success',
                data: {
                    reference: cmd.reference_commande,
                    statut_actuel: cmd.statut_commande,
                    date_commande: cmd.date_commande,
                    date_prevue: cmd.date_souhaitee_livraison,
                    montant: cmd.prix_total_commande,
                    boutique: {
                        nom: cmd.nom_boutique,
                        logo: cmd.logo_boutique,
                        telephone: cmd.telephone_contact
                    },
                    etapes,
                    position_livreur,
                    mode_recuperation: cmd.pour_livrer ? 'livraison' : 'a_emporter',
                    adresse: cmd.pour_livrer ? {
                        ligne: cmd.ligne_1,
                        ville: cmd.ville,
                        code_postal: cmd.code_postal
                    } : null
                }
            });

        } catch (error) {
            logError('Erreur suivi commande:', error);
            next(error);
        }
    }

    /**
     * Générer un code de retrait pour une commande
     * @route POST /api/v1/commandes/:id/generer-code-retrait
     * @access PROPRIETAIRE_BOUTIQUE
     */
    async genererCodeRetrait(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;

            const commande = await client.query(
                'SELECT * FROM COMMANDESBOUTIQUES WHERE id = $1 AND passer_recuperer = true',
                [id]
            );

            if (commande.rows.length === 0) {
                throw new AppError('Commande non trouvée ou non éligible', 404);
            }

            // Génération code à 6 chiffres
            const codeRetrait = Math.floor(100000 + Math.random() * 900000).toString();

            await client.query(
                `UPDATE COMMANDESBOUTIQUES 
                SET donnees_supplementaires = donnees_supplementaires || $1,
                    date_mise_a_jour = NOW()
                WHERE id = $2`,
                [JSON.stringify({ code_retrait: codeRetrait }), id]
            );

            await client.query('COMMIT');

            // Envoi du code par SMS si numéro disponible
            if (commande.rows[0].contact_telephone) {
                await this._envoyerCodeRetraitSMS(commande.rows[0], codeRetrait);
            }

            res.json({
                status: 'success',
                data: { code_retrait: codeRetrait },
                message: 'Code de retrait généré avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur génération code retrait:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    // ==================== MÉTHODES PRIVÉES ====================

    /**
     * Valider les entrées de la commande
     */
    _validateCommandeInput(data) {
        const { produits, pour_livrer, passer_recuperer, mode_paiement } = data;

        if (!produits || !Array.isArray(produits) || produits.length === 0) {
            throw new ValidationError('La commande doit contenir au moins un produit');
        }

        if (!pour_livrer && !passer_recuperer) {
            throw new ValidationError('Veuillez spécifier un mode de livraison ou de récupération');
        }

        if (pour_livrer && passer_recuperer) {
            throw new ValidationError('Veuillez choisir UN seul mode : livraison OU récupération');
        }

        if (!mode_paiement || !['DIRECT', 'LIVRAISON', 'RECUPERATION'].includes(mode_paiement)) {
            throw new ValidationError('Mode de paiement invalide');
        }

        if (pour_livrer && !data.adresse_livraison_id && !data.informations_client?.adresse) {
            throw new ValidationError('Adresse de livraison requise');
        }
    }

    /**
     * Vérifier disponibilité boutique
     */
    async _checkBoutiqueDisponible(client, boutiqueId) {
        const result = await client.query(
            `SELECT * FROM BOUTIQUES 
             WHERE id = $1 AND est_actif = true AND est_supprime = false`,
            [boutiqueId]
        );

        if (result.rows.length === 0) {
            throw new AppError('Boutique non disponible', 404);
        }

        return result.rows[0];
    }

    /**
     * Vérifier horaires d'ouverture
     */
    async _checkHorairesOuverture(client, boutiqueId, dateSouhaitee, heureSouhaitee) {
        if (!dateSouhaitee) return;

        const date = new Date(dateSouhaitee);
        const jour = date.getDay(); // 0 = Dimanche, 1 = Lundi, etc.
        const heure = heureSouhaitee || date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

        // Vérifier dans HORAIRES
        const horaire = await client.query(
            `SELECT * FROM HORAIRES
             WHERE entite_type = 'BOUTIQUE' 
             AND entite_id = $1 
             AND jour_semaine = $2
             AND est_ouvert = true`,
            [boutiqueId, jour]
        );

        if (horaire.rows.length === 0) {
            throw new ValidationError('La boutique est fermée ce jour');
        }

        // Vérifier heure d'ouverture
        const heureNum = parseInt(heure.replace(':', ''));
        const ouverture = parseInt(horaire.rows[0].heure_ouverture.replace(':', ''));
        const fermeture = parseInt(horaire.rows[0].heure_fermeture.replace(':', ''));

        if (heureNum < ouverture || heureNum > fermeture) {
            throw new ValidationError(`La boutique est ouverte de ${horaire.rows[0].heure_ouverture} à ${horaire.rows[0].heure_fermeture}`);
        }

        // Vérifier exceptions
        const exception = await client.query(
            `SELECT * FROM HORAIRES_EXCEPTIONS
             WHERE entite_type = 'BOUTIQUE' 
             AND entite_id = $1 
             AND date_exception = $2`,
            [boutiqueId, dateSouhaitee]
        );

        if (exception.rows.length > 0 && !exception.rows[0].est_ouvert) {
            throw new ValidationError('La boutique est exceptionnellement fermée ce jour');
        }
    }

    /**
     * Valider et calculer les produits
     */
    async _validateAndCalculateProducts(client, produits, boutiqueId) {
        const produitsDetails = [];
        let prix_sous_total = 0;
        let poids_total = 0;

        for (const item of produits) {
            const produit = await client.query(
                `SELECT 
                    id, nom_produit, prix_unitaire_produit, prix_promo, 
                    quantite, poids, est_disponible
                 FROM PRODUITSBOUTIQUE 
                 WHERE id = $1 AND id_boutique = $2`,
                [item.produit_id, boutiqueId]
            );

            if (produit.rows.length === 0) {
                throw new ValidationError(`Produit ID ${item.produit_id} non trouvé`);
            }

            const p = produit.rows[0];

            if (!p.est_disponible) {
                throw new ValidationError(`Le produit ${p.nom_produit} n'est pas disponible`);
            }

            const quantite = item.quantite || 1;

            if (quantite <= 0) {
                throw new ValidationError(`Quantité invalide pour ${p.nom_produit}`);
            }

            if (p.quantite !== -1 && p.quantite < quantite) {
                throw new ValidationError(`Stock insuffisant pour ${p.nom_produit} (disponible: ${p.quantite})`);
            }

            const prixUnitaire = p.prix_promo || p.prix_unitaire_produit;
            prix_sous_total += prixUnitaire * quantite;
            poids_total += (p.poids || 0) * quantite;

            produitsDetails.push({
                produit_id: p.id,
                nom_produit: p.nom_produit,
                quantite,
                prix_unitaire: prixUnitaire,
                prix_original: p.prix_unitaire_produit,
                en_promo: !!p.prix_promo,
                poids_unitaire: p.poids
            });
        }

        return { produitsDetails, prix_sous_total, poids_total };
    }

    /**
     * Valider et appliquer un code promo
     */
    async _validateAndApplyPromo(client, codePromo, boutiqueId, montantTotal, produits) {
        // Récupérer promo
        const promo = await client.query(
            `SELECT * FROM PROMOSRESTAURANTFASTFOOD 
             WHERE code_promo = $1 
             AND actif = true 
             AND date_debut_promo <= NOW() 
             AND date_fin_promo >= NOW()
             AND (utilisation_max = -1 OR utilisation_count < utilisation_max)`,
            [codePromo]
        );

        if (promo.rows.length === 0) {
            throw new ValidationError('Code promo invalide ou expiré');
        }

        const promoData = promo.rows[0];

        // Vérifier conditions
        if (promoData.conditions?.montant_minimum && montantTotal < promoData.conditions.montant_minimum) {
            throw new ValidationError(`Montant minimum de ${promoData.conditions.montant_minimum} FCFA requis`);
        }

        // Vérifier produits concernés
        if (promoData.produits_affectes && promoData.produits_affectes.length > 0) {
            const produitsEligibles = produits.filter(p => 
                promoData.produits_affectes.includes(p.produit_id)
            );
            if (produitsEligibles.length === 0) {
                throw new ValidationError('Aucun produit éligible à cette promotion');
            }
        }

        // Calculer remise
        let montant_remise = 0;
        let details = {};

        switch (promoData.type_promo) {
            case 'POURCENTAGE':
                montant_remise = montantTotal * (promoData.pourcentage_reduction / 100);
                details = { type: 'pourcentage', valeur: promoData.pourcentage_reduction };
                break;
            case 'MONTANT_FIXE':
                montant_remise = Math.min(promoData.montant_fixe_reduction, montantTotal);
                details = { type: 'montant_fixe', valeur: promoData.montant_fixe_reduction };
                break;
            case 'LIVRAISON_GRATUITE':
                // La remise sera appliquée sur les frais de livraison plus tard
                montant_remise = 0;
                details = { type: 'livraison_gratuite' };
                break;
        }

        // Incrémenter compteur d'utilisation
        await client.query(
            `UPDATE PROMOSRESTAURANTFASTFOOD 
             SET utilisation_count = utilisation_count + 1
             WHERE id = $1`,
            [promoData.id]
        );

        return {
            id: promoData.id,
            montant_remise,
            details,
            code: codePromo
        };
    }

    /**
     * Calculer les frais de livraison
     */
    async _calculerFraisLivraison(client, boutiqueId, adresseId, options) {
        const { poids_total, livraison_express, montant_commande } = options;

        // Récupérer adresse boutique
        const boutiqueAdresse = await client.query(
            `SELECT a.coordonnees 
             FROM ADRESSES_ENTITES ae
             JOIN ADRESSES a ON a.id = ae.adresse_id
             WHERE ae.entite_type = 'BOUTIQUE' 
             AND ae.entite_id = $1 
             AND ae.type_adresse = 'PRINCIPALE'`,
            [boutiqueId]
        );

        if (boutiqueAdresse.rows.length === 0) {
            throw new ValidationError('Adresse de boutique non configurée');
        }

        // Récupérer adresse livraison
        const adresseLivraison = await client.query(
            'SELECT * FROM ADRESSES WHERE id = $1',
            [adresseId]
        );

        if (adresseLivraison.rows.length === 0) {
            throw new ValidationError('Adresse de livraison non trouvée');
        }

        // Calculer distance
        const distance = await GeoService.calculerDistance(
            boutiqueAdresse.rows[0].coordonnees,
            adresseLivraison.rows[0].coordonnees
        );

        // Récupérer tarifs livraison
        const tarifs = await client.query(
            `SELECT * FROM SERVICES_LIVRAISON 
             WHERE est_actif = true 
             ORDER BY prix_service ASC
             LIMIT 1`
        );

        let frais = 0;

        if (tarifs.rows.length > 0) {
            const tarif = tarifs.rows[0];
            
            if (tarif.prix_par_km) {
                frais = distance * tarif.prix_par_km;
            } else {
                frais = tarif.prix_service;
            }

            // Majoration express
            if (livraison_express) {
                frais *= 1.5;
            }

            // Seuil de livraison gratuite
            const seuilGratuit = await this._getSeuilLivraisonGratuite(client, boutiqueId);
            if (seuilGratuit && montant_commande >= seuilGratuit) {
                frais = 0;
            }
        }

        return {
            frais: Math.round(frais),
            distance: Math.round(distance * 100) / 100,
            adresse: adresseLivraison.rows[0]
        };
    }

    /**
     * Générer une référence de commande unique
     */
    async _generateReferenceCommande(client, boutiqueId) {
        const prefix = 'CMD';
        const boutique = await client.query(
            'SELECT id FROM BOUTIQUES WHERE id = $1',
            [boutiqueId]
        );
        
        const date = new Date();
        const annee = date.getFullYear().toString().slice(-2);
        const mois = (date.getMonth() + 1).toString().padStart(2, '0');
        const jour = date.getDate().toString().padStart(2, '0');

        let reference;
        let exists = true;
        let attempts = 0;

        while (exists && attempts < 10) {
            const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
            reference = `${prefix}-${boutiqueId}-${annee}${mois}${jour}-${random}`;

            const check = await client.query(
                'SELECT id FROM COMMANDESBOUTIQUES WHERE reference_commande = $1',
                [reference]
            );
            exists = check.rows.length > 0;
            attempts++;
        }

        if (exists) {
            reference = `${prefix}-${boutiqueId}-${Date.now()}`;
        }

        return reference;
    }

    /**
     * Mettre à jour les stocks
     */
    async _updateStocks(client, produits) {
        for (const item of produits) {
            if (item.quantite) {
                await client.query(
                    `UPDATE PRODUITSBOUTIQUE 
                     SET quantite = CASE 
                         WHEN quantite = -1 THEN -1
                         ELSE quantite - $1
                     END,
                     date_mise_a_jour = NOW()
                     WHERE id = $2`,
                    [item.quantite, item.produit_id]
                );
            }
        }
    }

    /**
     * Restaurer les stocks (en cas d'annulation)
     */
    async _restaurerStocks(client, commande) {
        const produits = commande.donnees_commandes.produits || [];
        for (const item of produits) {
            await client.query(
                `UPDATE PRODUITSBOUTIQUE 
                 SET quantite = CASE 
                     WHEN quantite = -1 THEN -1
                     ELSE quantite + $1
                 END,
                 date_mise_a_jour = NOW()
                 WHERE id = $2`,
                [item.quantite, item.produit_id]
            );
        }
    }

    /**
     * Initialiser un paiement
     */
    async _initierPaiement(commande, contact) {
        try {
            const paiement = await PaymentService.initierPaiement({
                montant: commande.prix_total_commande,
                reference: commande.reference_commande,
                description: `Paiement commande ${commande.reference_commande}`,
                client_nom: contact.nom || contact.telephone,
                client_telephone: contact.telephone,
                client_email: contact.email,
                redirect_url: `${process.env.FRONTEND_URL}/commandes/${commande.reference_commande}/confirmation`,
                cancel_url: `${process.env.FRONTEND_URL}/commandes/${commande.reference_commande}/annulation`,
                metadata: {
                    commande_id: commande.id,
                    boutique_id: commande.id_boutique
                }
            });

            return paiement;
        } catch (error) {
            logError('Erreur initialisation paiement:', error);
            return null;
        }
    }

    /**
     * Créer une demande de livraison
     */
    async _creerDemandeLivraison(client, commande, livraison) {
        await client.query(
            `INSERT INTO DEMANDES_LIVRAISON (
                details_livraison,
                commande_type,
                commande_id,
                statut_livraison,
                date_creation,
                date_livraison_prevue
            ) VALUES ($1, $2, $3, $4, NOW(), $5)`,
            [
                JSON.stringify({
                    adresse: livraison.adresse,
                    distance: livraison.distance,
                    express: livraison.express,
                    instructions: commande.notes_commande,
                    contact: {
                        telephone: commande.contact_telephone,
                        nom: commande.donnees_commandes?.client?.nom
                    }
                }),
                'BOUTIQUE',
                commande.id,
                'EN_ATTENTE',
                commande.date_souhaitee_livraison
            ]
        );
    }

    /**
     * Envoyer les notifications de commande
     */
    async _envoyerNotificationsCommande(commande, boutique, produits) {
        // Notification à la boutique
        await NotificationService.notifyBoutiqueStaff(commande.id_boutique, {
            type: 'NOUVELLE_COMMANDE',
            titre: '🆕 Nouvelle commande',
            message: `Commande ${commande.reference_commande} - ${commande.prix_total_commande} FCFA`,
            priorite: 'HAUTE',
            donnees: {
                commande_id: commande.id,
                reference: commande.reference_commande,
                montant: commande.prix_total_commande,
                produits: produits.length,
                mode: commande.pour_livrer ? 'Livraison' : 'À emporter'
            },
            actions: [
                { label: 'Voir', url: `/admin/commandes/${commande.id}` },
                { label: 'Confirmer', action: 'CONFIRMER_COMMANDE' }
            ]
        });

        // Notification au client si connecté
        if (commande.compte_id) {
            await NotificationService.notifyUser(commande.compte_id, {
                type: 'COMMANDE_CREEE',
                titre: '✅ Commande enregistrée',
                message: `Votre commande ${commande.reference_commande} a été enregistrée`,
                donnees: {
                    commande_id: commande.id,
                    reference: commande.reference_commande,
                    montant: commande.prix_total_commande
                }
            });
        }

        // Email de confirmation
        if (commande.contact_email) {
            await EmailService.sendTemplate('commande-confirmation', commande.contact_email, {
                reference: commande.reference_commande,
                date: new Date().toLocaleString('fr-FR'),
                boutique: boutique.nom_boutique,
                produits: produits,
                sous_total: commande.prix_sous_total,
                frais_livraison: commande.frais_livraison_commande,
                remise: commande.remise_appliquee,
                total: commande.prix_total_commande,
                mode_paiement: commande.mode_paiement,
                mode_recuperation: commande.pour_livrer ? 'Livraison' : 'À emporter',
                lien_suivi: `${process.env.FRONTEND_URL}/commandes/suivi/${commande.reference_commande}`
            });
        }

        // SMS de confirmation (si numéro fourni)
        if (commande.contact_telephone) {
            // Intégration service SMS
        }
    }

    /**
     * Valider la transition de statut
     */
    async _validerTransitionStatut(ancien, nouveau, commande) {
        const transitionsValides = {
            'EN_ATTENTE': ['CONFIRMEE', 'ANNULEE'],
            'CONFIRMEE': ['EN_PREPARATION', 'ANNULEE'],
            'EN_PREPARATION': ['PRETE', 'ANNULEE'],
            'PRETE': commande.pour_livrer ? ['EN_LIVRAISON'] : ['RECUPEREE'],
            'EN_LIVRAISON': ['LIVREE', 'ANNULEE'],
            'LIVREE': [],
            'RECUPEREE': [],
            'ANNULEE': [],
            'REMBOURSEE': []
        };

        if (!transitionsValides[ancien]?.includes(nouveau)) {
            throw new ValidationError(`Transition de ${ancien} vers ${nouveau} non autorisée`);
        }

        // Vérifications spécifiques
        if (nouveau === 'EN_LIVRAISON' && !commande.pour_livrer) {
            throw new ValidationError('Impossible de mettre en livraison une commande à emporter');
        }

        if (nouveau === 'RECUPEREE' && commande.pour_livrer) {
            throw new ValidationError('Impossible de marquer comme récupérée une commande à livrer');
        }
    }

    /**
     * Exécuter les actions spécifiques à un statut
     */
    async _executerActionsStatut(client, commande, ancienStatut, nouveauStatut, motif) {
        const updates = {};
        const dateField = {
            'CONFIRMEE': 'date_confirmation',
            'EN_PREPARATION': 'date_preparation',
            'PRETE': 'date_prete',
            'EN_LIVRAISON': 'date_depart_livraison',
            'LIVREE': 'date_livraison',
            'RECUPEREE': 'date_livraison'
        }[nouveauStatut];

        if (dateField) {
            updates[dateField] = new Date();
        }

        if (nouveauStatut === 'CONFIRMEE') {
            // Envoyer email de confirmation
            if (commande.contact_email) {
                await EmailService.sendTemplate('commande-confirmee', commande.contact_email, {
                    reference: commande.reference_commande
                });
            }
        }

        if (nouveauStatut === 'PRETE' && commande.passer_recuperer) {
            // Générer code de retrait
            const codeRetrait = Math.floor(100000 + Math.random() * 900000).toString();
            updates.code_retrait = codeRetrait;
            
            // Envoyer code par SMS
            if (commande.contact_telephone) {
                // Envoi SMS avec code
            }
        }

        if (nouveauStatut === 'EN_LIVRAISON') {
            // Notifier livreur
            await client.query(
                `UPDATE DEMANDES_LIVRAISON 
                 SET statut_livraison = 'EN_COURS',
                     date_depart = NOW()
                 WHERE commande_type = 'BOUTIQUE' AND commande_id = $1`,
                [commande.id]
            );
        }

        if (Object.keys(updates).length > 0) {
            const setClauses = Object.keys(updates)
                .map((key, i) => `${key} = $${i + 2}`)
                .join(', ');
            
            await client.query(
                `UPDATE COMMANDESBOUTIQUES 
                 SET ${setClauses}
                 WHERE id = $1`,
                [commande.id, ...Object.values(updates)]
            );
        }
    }

    /**
     * Notifier le client d'un changement de statut
     */
    async _notifierChangementStatut(commande, ancienStatut, nouveauStatut, motif) {
        const messages = {
            'CONFIRMEE': 'Votre commande a été confirmée et sera bientôt préparée',
            'EN_PREPARATION': 'Votre commande est en cours de préparation',
            'PRETE': 'Votre commande est prête',
            'EN_LIVRAISON': 'Votre commande est en cours de livraison',
            'LIVREE': 'Votre commande a été livrée',
            'RECUPEREE': 'Votre commande a été récupérée',
            'ANNULEE': motif || 'Votre commande a été annulée'
        };

        await NotificationService.notifyUser(commande.compte_id, {
            type: 'STATUT_COMMANDE',
            titre: `📦 Commande ${nouveauStatut}`,
            message: messages[nouveauStatut] || `Statut mis à jour: ${nouveauStatut}`,
            donnees: {
                commande_id: commande.id,
                reference: commande.reference_commande,
                ancien_statut: ancienStatut,
                nouveau_statut: nouveauStatut,
                motif
            }
        });

        if (commande.contact_email) {
            await EmailService.sendTemplate('statut-commande', commande.contact_email, {
                reference: commande.reference_commande,
                ancien_statut: this._formatStatut(ancienStatut),
                nouveau_statut: this._formatStatut(nouveauStatut),
                motif,
                lien_suivi: `${process.env.FRONTEND_URL}/commandes/suivi/${commande.reference_commande}`
            });
        }
    }

    /**
     * Vérifier si l'annulation est possible
     */
    async _verifierAnnulationPossible(commande, user) {
        const statutsAnnulables = ['EN_ATTENTE', 'CONFIRMEE'];
        
        if (!statutsAnnulables.includes(commande.statut_commande)) {
            throw new ValidationError(`Impossible d'annuler une commande avec le statut ${commande.statut_commande}`);
        }

        // Si c'est un client qui annule, vérifier que c'est sa commande
        if (user && user.role === 'UTILISATEUR_PRIVE_SIMPLE' && commande.compte_id !== user.id) {
            throw new AppError('Vous ne pouvez annuler que vos propres commandes', 403);
        }
    }

    /**
     * Initier un remboursement
     */
    async _initierRemboursement(client, commande, motif) {
        // Logique de remboursement selon le mode de paiement
        await client.query(
            `UPDATE COMMANDESBOUTIQUES 
             SET statut_commande = 'REMBOURSEE',
                 date_mise_a_jour = NOW()
             WHERE id = $1`,
            [commande.id]
        );

        await client.query(
            `INSERT INTO HISTORIQUE_TRANSACTIONS (
                type_transaction, montant, statut_transaction,
                commande_boutique_id, description, date_transaction
            ) VALUES ($1, $2, $3, $4, $5, NOW())`,
            [
                'REMBOURSEMENT',
                commande.prix_total_commande,
                'COMPLETEE',
                commande.id,
                `Remboursement commande ${commande.reference_commande} - Motif: ${motif}`
            ]
        );
    }

    /**
     * Enrichir une commande avec des données supplémentaires
     */
    async _enrichirCommande(commande) {
        // Ajouter détails produits
        if (commande.donnees_commandes?.produits) {
            const produitsIds = commande.donnees_commandes.produits.map(p => p.produit_id);
            if (produitsIds.length > 0) {
                const produits = await pool.query(
                    `SELECT id, nom_produit, image_produit 
                     FROM PRODUITSBOUTIQUE 
                     WHERE id = ANY($1::int[])`,
                    [produitsIds]
                );
                
                const produitsMap = {};
                produits.rows.forEach(p => produitsMap[p.id] = p);
                
                commande.donnees_commandes.produits = commande.donnees_commandes.produits.map(p => ({
                    ...p,
                    image: produitsMap[p.produit_id]?.image_produit
                }));
            }
        }

        // Ajouter délai estimé
        if (commande.date_souhaitee_livraison) {
            const maintenant = new Date();
            const delai = new Date(commande.date_souhaitee_livraison) - maintenant;
            commande.delai_estime = Math.max(0, Math.ceil(delai / (1000 * 60 * 60)));
        }
    }

    /**
     * Obtenir les statistiques des commandes
     */
    async _getCommandesStats(boutiqueId, dateDebut, dateFin) {
        let dateCondition = '';
        if (dateDebut && dateFin) {
            dateCondition = `AND date_commande BETWEEN '${dateDebut}' AND '${dateFin}'`;
        }

        const result = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN statut_commande = 'EN_ATTENTE' THEN 1 ELSE 0 END) as en_attente,
                SUM(CASE WHEN statut_commande = 'CONFIRMEE' THEN 1 ELSE 0 END) as confirmees,
                SUM(CASE WHEN statut_commande = 'EN_PREPARATION' THEN 1 ELSE 0 END) as en_preparation,
                SUM(CASE WHEN statut_commande = 'PRETE' THEN 1 ELSE 0 END) as pretes,
                SUM(CASE WHEN statut_commande = 'EN_LIVRAISON' THEN 1 ELSE 0 END) as en_livraison,
                SUM(CASE WHEN statut_commande = 'LIVREE' THEN 1 ELSE 0 END) as livrees,
                SUM(CASE WHEN statut_commande = 'RECUPEREE' THEN 1 ELSE 0 END) as recuperees,
                SUM(CASE WHEN statut_commande IN ('ANNULEE', 'REMBOURSEE') THEN 1 ELSE 0 END) as annulees,
                SUM(prix_total_commande) as chiffre_affaires,
                AVG(prix_total_commande) as panier_moyen,
                SUM(prix_total_commande) FILTER (WHERE mode_paiement = 'DIRECT') as ca_paiement_direct,
                SUM(prix_total_commande) FILTER (WHERE pour_livrer = true) as ca_livraison
            FROM COMMANDESBOUTIQUES
            WHERE id_boutique = $1
            ${dateCondition}
        `, [boutiqueId]);

        return result.rows[0];
    }

    /**
     * Demander un avis après commande
     */
    async _demanderAvis(commande) {
        // Planifier une notification pour demander un avis (J+1)
        setTimeout(async () => {
            try {
                await NotificationService.notifyUser(commande.compte_id, {
                    type: 'DEMANDE_AVIS',
                    titre: '⭐ Donnez votre avis',
                    message: `Comment s'est passée votre commande ${commande.reference_commande} ?`,
                    donnees: {
                        commande_id: commande.id,
                        boutique_id: commande.id_boutique,
                        produits: commande.donnees_commandes?.produits?.map(p => p.produit_id)
                    },
                    actions: [
                        { label: 'Noter', url: `/commandes/${commande.id}/avis` }
                    ]
                });
            } catch (error) {
                logError('Erreur envoi demande avis:', error);
            }
        }, 24 * 60 * 60 * 1000); // 24h après
    }

    /**
     * Obtenir le seuil de livraison gratuite
     */
    async _getSeuilLivraisonGratuite(client, boutiqueId) {
        const config = await client.query(
            `SELECT valeur::numeric as seuil
             FROM CONFIGURATIONS
             WHERE entite_type = 'BOUTIQUE' 
             AND entite_id = $1 
             AND cle = 'seuil_livraison_gratuite'`,
            [boutiqueId]
        );
        return config.rows[0]?.seuil || null;
    }

    /**
     * Formater un statut pour affichage
     */
    _formatStatut(statut) {
        const formats = {
            'EN_ATTENTE': 'En attente',
            'CONFIRMEE': 'Confirmée',
            'EN_PREPARATION': 'En préparation',
            'PRETE': 'Prête',
            'EN_LIVRAISON': 'En livraison',
            'LIVREE': 'Livrée',
            'RECUPEREE': 'Récupérée',
            'ANNULEE': 'Annulée',
            'REMBOURSEE': 'Remboursée'
        };
        return formats[statut] || statut;
    }

    /**
     * Construire la clause ORDER BY
     */
    _buildOrderBy(tri) {
        const orders = {
            'date_asc': 'ORDER BY date_commande ASC',
            'date_desc': 'ORDER BY date_commande DESC',
            'montant_asc': 'ORDER BY prix_total_commande ASC',
            'montant_desc': 'ORDER BY prix_total_commande DESC',
            'client_asc': 'ORDER BY acc.nom_utilisateur_compte ASC NULLS LAST',
            'client_desc': 'ORDER BY acc.nom_utilisateur_compte DESC NULLS LAST'
        };
        return orders[tri] || orders.date_desc;
    }

    /**
     * Exporter les commandes
     */
    async _exportCommandes(commandes, format, res) {
        let exportedData;

        switch (format) {
            case 'csv':
                exportedData = await ExportService.toCSV(commandes, {
                    fields: ['reference_commande', 'date_commande', 'statut_commande', 
                            'prix_total_commande', 'client_nom', 'client_telephone']
                });
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename=commandes.csv');
                break;

            case 'excel':
                exportedData = await ExportService.toExcel(commandes, {
                    sheetName: 'Commandes',
                    columns: [
                        { header: 'Référence', key: 'reference_commande' },
                        { header: 'Date', key: 'date_commande' },
                        { header: 'Statut', key: 'statut_commande' },
                        { header: 'Montant', key: 'prix_total_commande' },
                        { header: 'Client', key: 'client_nom' }
                    ]
                });
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', 'attachment; filename=commandes.xlsx');
                break;

            case 'pdf':
                exportedData = await ExportService.toPDF(commandes, {
                    title: 'Liste des commandes',
                    template: 'commandes'
                });
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'attachment; filename=commandes.pdf');
                break;

            default:
                throw new ValidationError('Format d\'export non supporté');
        }

        res.send(exportedData);
    }
}

module.exports = new CommandeBoutiqueController();