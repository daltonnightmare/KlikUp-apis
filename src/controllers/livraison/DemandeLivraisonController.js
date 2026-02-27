// src/controllers/livraison/DemandeLivraisonController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');
const NotificationService = require('../../services/notification/NotificationService');
const GeoService = require('../../services/geo/GeoService');
const AuditService = require('../../services/audit/AuditService');

class DemandeLivraisonController {
    /**
     * Créer une nouvelle demande de livraison
     * @route POST /api/v1/livraison/demandes
     */
    async create(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const {
                details_livraison,
                commande_type,
                commande_id,
                adresse_depart_id,
                adresse_livraison_id,
                service_livraison_id,
                date_livraison_prevue
            } = req.body;

            // Validation
            if (!details_livraison || !adresse_livraison_id) {
                throw new ValidationError('Détails et adresse de livraison requis');
            }

            if (!['RESTAURANT_FAST_FOOD', 'BOUTIQUE', 'AUTRE'].includes(commande_type)) {
                throw new ValidationError('Type de commande invalide');
            }

            // Calculer la distance
            let distance = null;
            if (adresse_depart_id && adresse_livraison_id) {
                const adresses = await client.query(
                    `SELECT a1.coordonnees as depart, a2.coordonnees as arrivee
                     FROM ADRESSES a1, ADRESSES a2
                     WHERE a1.id = $1 AND a2.id = $2`,
                    [adresse_depart_id, adresse_livraison_id]
                );

                if (adresses.rows.length > 0) {
                    const { depart, arrivee } = adresses.rows[0];
                    distance = await GeoService.calculerDistance(depart, arrivee);
                }
            }

            // Calculer la commission
            let commission = 0;
            if (service_livraison_id && distance) {
                const service = await client.query(
                    'SELECT * FROM SERVICES_LIVRAISON WHERE id = $1',
                    [service_livraison_id]
                );
                
                if (service.rows.length > 0) {
                    const s = service.rows[0];
                    commission = s.prix_service;
                    if (s.prix_par_km && distance) {
                        commission += distance * s.prix_par_km;
                    }
                }
            }

            const result = await client.query(
                `INSERT INTO DEMANDES_LIVRAISON (
                    details_livraison,
                    commande_type,
                    commande_id,
                    adresse_depart_id,
                    adresse_livraison_id,
                    service_livraison_id,
                    date_livraison_prevue,
                    commission,
                    statut_livraison
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'EN_ATTENTE')
                RETURNING *`,
                [
                    JSON.stringify(details_livraison),
                    commande_type,
                    commande_id,
                    adresse_depart_id,
                    adresse_livraison_id,
                    service_livraison_id,
                    date_livraison_prevue,
                    commission
                ]
            );

            const demande = result.rows[0];

            // Rechercher automatiquement un livreur
            await this.chercherLivreurAutomatique(demande, client);

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: demande,
                message: 'Demande de livraison créée'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer toutes les demandes de livraison
     * @route GET /api/v1/livraison/demandes
     */
    async findAll(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                statut_livraison,
                livreur_affecte,
                commande_type,
                date_debut,
                date_fin,
                est_effectue
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT dl.*,
                       l.nom_livreur,
                       l.prenom_livreur,
                       l.photo_livreur,
                       l.numero_telephone_livreur,
                       COUNT(*) OVER() as total_count
                FROM DEMANDES_LIVRAISON dl
                LEFT JOIN LIVREURS l ON l.id = dl.livreur_affecte
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            if (statut_livraison) {
                query += ` AND dl.statut_livraison = $${paramIndex}`;
                params.push(statut_livraison);
                paramIndex++;
            }

            if (livreur_affecte) {
                query += ` AND dl.livreur_affecte = $${paramIndex}`;
                params.push(livreur_affecte);
                paramIndex++;
            }

            if (commande_type) {
                query += ` AND dl.commande_type = $${paramIndex}`;
                params.push(commande_type);
                paramIndex++;
            }

            if (est_effectue !== undefined) {
                query += ` AND dl.est_effectue = $${paramIndex}`;
                params.push(est_effectue === 'true');
                paramIndex++;
            }

            if (date_debut) {
                query += ` AND dl.date_creation >= $${paramIndex}`;
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                query += ` AND dl.date_creation <= $${paramIndex}`;
                params.push(date_fin);
                paramIndex++;
            }

            query += ` ORDER BY dl.date_creation DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
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
            next(error);
        }
    }

    /**
     * Récupérer une demande par son ID
     * @route GET /api/v1/livraison/demandes/:id
     */
    async findOne(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT dl.*,
                        l.nom_livreur,
                        l.prenom_livreur,
                        l.photo_livreur,
                        l.numero_telephone_livreur,
                        l.note_moyenne as livreur_note,
                        a_depart.*,
                        a_arrivee.*,
                        sl.nom_service as service_nom
                 FROM DEMANDES_LIVRAISON dl
                 LEFT JOIN LIVREURS l ON l.id = dl.livreur_affecte
                 LEFT JOIN ADRESSES a_depart ON a_depart.id = dl.adresse_depart_id
                 LEFT JOIN ADRESSES a_arrivee ON a_arrivee.id = dl.adresse_livraison_id
                 LEFT JOIN SERVICES_LIVRAISON sl ON sl.id = dl.service_livraison_id
                 WHERE dl.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Demande de livraison non trouvée');
            }

            // Récupérer les détails de la commande associée
            const demande = result.rows[0];
            if (demande.commande_type && demande.commande_id) {
                let commandeQuery;
                if (demande.commande_type === 'RESTAURANT_FAST_FOOD') {
                    commandeQuery = await db.query(
                        `SELECT c.*, e.nom_emplacement 
                         FROM COMMANDESEMPLACEMENTFASTFOOD c
                         LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD e ON e.id = c.id_restaurant_fast_food_emplacement
                         WHERE c.id = $1`,
                        [demande.commande_id]
                    );
                } else if (demande.commande_type === 'BOUTIQUE') {
                    commandeQuery = await db.query(
                        `SELECT c.*, b.nom_boutique 
                         FROM COMMANDESBOUTIQUES c
                         LEFT JOIN BOUTIQUES b ON b.id = c.id_boutique
                         WHERE c.id = $1`,
                        [demande.commande_id]
                    );
                }
                demande.commande_details = commandeQuery?.rows[0];
            }

            res.json({
                success: true,
                data: demande
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Assigner un livreur à une demande
     * @route PATCH /api/v1/livraison/demandes/:id/assigner
     */
    async assignerLivreur(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { livreur_id } = req.body;

            // Vérifier la demande
            const demande = await client.query(
                'SELECT * FROM DEMANDES_LIVRAISON WHERE id = $1 AND statut_livraison = $2',
                [id, 'EN_ATTENTE']
            );

            if (demande.rows.length === 0) {
                throw new NotFoundError('Demande non trouvée ou déjà assignée');
            }

            // Vérifier le livreur
            const livreur = await client.query(
                'SELECT * FROM LIVREURS WHERE id = $1 AND est_disponible = true AND est_actif = true',
                [livreur_id]
            );

            if (livreur.rows.length === 0) {
                throw new ValidationError('Livreur non disponible');
            }

            // Assigner
            await client.query(
                `UPDATE DEMANDES_LIVRAISON 
                 SET livreur_affecte = $1,
                     statut_livraison = 'EN_COURS',
                     date_mise_a_jour = NOW()
                 WHERE id = $2`,
                [livreur_id, id]
            );

            // Rendre le livreur indisponible
            await client.query(
                `UPDATE LIVREURS 
                 SET est_disponible = false,
                     date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [livreur_id]
            );

            // Notification au livreur
            await NotificationService.send({
                destinataire_id: livreur_id,
                type: 'NOUVELLE_LIVRAISON',
                titre: 'Nouvelle livraison assignée',
                corps: `Une nouvelle livraison vous a été assignée`,
                entite_source_type: 'DEMANDE_LIVRAISON',
                entite_source_id: parseInt(id)
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Livreur assigné avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour le statut d'une livraison
     * @route PATCH /api/v1/livraison/demandes/:id/statut
     */
    async updateStatut(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { statut, commentaire } = req.body;

            const demande = await client.query(
                'SELECT * FROM DEMANDES_LIVRAISON WHERE id = $1',
                [id]
            );

            if (demande.rows.length === 0) {
                throw new NotFoundError('Demande non trouvée');
            }

            const updateData = {
                statut_livraison: statut,
                date_mise_a_jour: new Date()
            };

            if (statut === 'LIVREE') {
                updateData.est_effectue = true;
                updateData.date_livraison_effective = new Date();
                
                // Rendre le livreur disponible
                if (demande.rows[0].livreur_affecte) {
                    await client.query(
                        `UPDATE LIVREURS 
                         SET est_disponible = true,
                             nombre_livraisons = nombre_livraisons + 1,
                             date_mise_a_jour = NOW()
                         WHERE id = $1`,
                        [demande.rows[0].livreur_affecte]
                    );
                }

                // Marquer la commande comme livrée
                await this.marquerCommandeLivree(demande.rows[0], client);
            }

            if (statut === 'ANNULEE' && demande.rows[0].livreur_affecte) {
                // Rendre le livreur disponible
                await client.query(
                    `UPDATE LIVREURS 
                     SET est_disponible = true,
                         date_mise_a_jour = NOW()
                     WHERE id = $1`,
                    [demande.rows[0].livreur_affecte]
                );
            }

            await client.query(
                `UPDATE DEMANDES_LIVRAISON 
                 SET statut_livraison = $1,
                     est_effectue = COALESCE($2, est_effectue),
                     date_livraison_effective = COALESCE($3, date_livraison_effective),
                     date_mise_a_jour = NOW()
                 WHERE id = $4`,
                [statut, updateData.est_effectue, updateData.date_livraison_effective, id]
            );

            // Notification
            if (demande.rows[0].commande_type && demande.rows[0].commande_id) {
                await this.notifierClient(demande.rows[0], statut, commentaire);
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                message: `Statut mis à jour : ${statut}`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Suivre une livraison en temps réel
     * @route GET /api/v1/livraison/demandes/:id/suivi
     */
    async getSuivi(req, res, next) {
        try {
            const { id } = req.params;

            const demande = await db.query(
                `SELECT dl.*,
                        l.localisation_actuelle,
                        l.nom_livreur,
                        l.prenom_livreur,
                        l.photo_livreur,
                        l.numero_telephone_livreur
                 FROM DEMANDES_LIVRAISON dl
                 LEFT JOIN LIVREURS l ON l.id = dl.livreur_affecte
                 WHERE dl.id = $1`,
                [id]
            );

            if (demande.rows.length === 0) {
                throw new NotFoundError('Demande non trouvée');
            }

            const suivi = demande.rows[0];

            // Convertir la localisation du livreur
            if (suivi.localisation_actuelle) {
                suivi.livreur_localisation = await GeoService.pointToJSON(suivi.localisation_actuelle);
                delete suivi.localisation_actuelle;
            }

            // Calculer le temps estimé restant
            if (suivi.statut_livraison === 'EN_COURS' && suivi.livreur_localisation && suivi.adresse_livraison_id) {
                const adresse = await db.query(
                    'SELECT coordonnees FROM ADRESSES WHERE id = $1',
                    [suivi.adresse_livraison_id]
                );

                if (adresse.rows.length > 0) {
                    const distance = await GeoService.calculerDistance(
                        suivi.livreur_localisation,
                        adresse.rows[0].coordonnees
                    );
                    
                    // Estimation : 30 km/h en moyenne
                    const tempsEstimeMinutes = Math.ceil((distance / 30) * 60);
                    suivi.temps_estime_restant = tempsEstimeMinutes;
                }
            }

            // Timeline des événements
            suivi.timeline = this.genererTimeline(suivi);

            res.json({
                success: true,
                data: suivi
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Annuler une demande de livraison
     * @route POST /api/v1/livraison/demandes/:id/annuler
     */
    async annuler(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { raison } = req.body;

            const demande = await client.query(
                'SELECT * FROM DEMANDES_LIVRAISON WHERE id = $1 AND statut_livraison NOT IN ($2, $3)',
                [id, 'LIVREE', 'ANNULEE']
            );

            if (demande.rows.length === 0) {
                throw new ValidationError('Impossible d\'annuler cette demande');
            }

            // Rendre le livreur disponible si assigné
            if (demande.rows[0].livreur_affecte) {
                await client.query(
                    `UPDATE LIVREURS 
                     SET est_disponible = true,
                         date_mise_a_jour = NOW()
                     WHERE id = $1`,
                    [demande.rows[0].livreur_affecte]
                );
            }

            await client.query(
                `UPDATE DEMANDES_LIVRAISON 
                 SET statut_livraison = 'ANNULEE',
                     est_effectue = false,
                     date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [id]
            );

            // Notification
            if (demande.rows[0].commande_type && demande.rows[0].commande_id) {
                await this.notifierAnnulation(demande.rows[0], raison);
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Livraison annulée'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Obtenir les statistiques des livraisons
     * @route GET /api/v1/livraison/demandes/stats/globales
     */
    async getStats(req, res, next) {
        try {
            const { periode = '30d' } = req.query;

            let interval;
            switch (periode) {
                case '24h': interval = "INTERVAL '24 hours'"; break;
                case '7d': interval = "INTERVAL '7 days'"; break;
                case '30d': interval = "INTERVAL '30 days'"; break;
                case '1y': interval = "INTERVAL '1 year'"; break;
                default: interval = "INTERVAL '30 days'";
            }

            const stats = await db.query(
                `SELECT 
                    COUNT(*) as total_demandes,
                    COUNT(*) FILTER (WHERE est_effectue = true) as livraisons_effectuees,
                    COUNT(*) FILTER (WHERE statut_livraison = 'EN_ATTENTE') as en_attente,
                    COUNT(*) FILTER (WHERE statut_livraison = 'EN_COURS') as en_cours,
                    ROUND(AVG(commission)::numeric, 2) as commission_moyenne,
                    SUM(commission) as revenu_total,
                    ROUND(AVG(EXTRACT(EPOCH FROM (date_livraison_effective - date_creation)) / 60)::numeric, 2) as temps_moyen_minutes
                 FROM DEMANDES_LIVRAISON
                 WHERE date_creation >= NOW() - ${interval}`
            );

            // Statistiques par type de commande
            const parType = await db.query(
                `SELECT 
                    commande_type,
                    COUNT(*) as nombre,
                    ROUND(AVG(commission)::numeric, 2) as commission_moyenne
                 FROM DEMANDES_LIVRAISON
                 WHERE date_creation >= NOW() - ${interval}
                 GROUP BY commande_type`
            );

            // Évolution quotidienne
            const evolution = await db.query(
                `SELECT 
                    DATE(date_creation) as date,
                    COUNT(*) as demandes,
                    COUNT(*) FILTER (WHERE est_effectue = true) as livraisons,
                    SUM(commission) as revenu
                 FROM DEMANDES_LIVRAISON
                 WHERE date_creation >= NOW() - ${interval}
                 GROUP BY DATE(date_creation)
                 ORDER BY date ASC`
            );

            res.json({
                success: true,
                data: {
                    global: stats.rows[0],
                    par_type: parType.rows,
                    evolution: evolution.rows,
                    periode
                }
            });

        } catch (error) {
            next(error);
        }
    }

    // ==================== Méthodes privées ====================

    /**
     * Rechercher automatiquement un livreur
     */
    async chercherLivreurAutomatique(demande, client) {
        try {
            // Récupérer l'adresse de livraison
            const adresse = await client.query(
                'SELECT coordonnees FROM ADRESSES WHERE id = $1',
                [demande.adresse_livraison_id]
            );

            if (adresse.rows.length === 0) return;

            const coord = adresse.rows[0].coordonnees;

            // Chercher les livreurs disponibles à proximité
            const livreurs = await client.query(
                `SELECT id, ST_Distance(
                    localisation_actuelle::geography,
                    $1::geography
                ) as distance
                 FROM LIVREURS
                 WHERE est_disponible = true
                   AND est_actif = true
                   AND ST_DWithin(
                       localisation_actuelle::geography,
                       $1::geography,
                       5000
                   )
                 ORDER BY distance ASC
                 LIMIT 5`,
                [coord]
            );

            if (livreurs.rows.length > 0) {
                // Notifier les livreurs proches
                for (const livreur of livreurs.rows) {
                    await NotificationService.send({
                        destinataire_id: livreur.id,
                        type: 'NOUVELLE_DEMANDE_PROXIMITE',
                        titre: 'Nouvelle demande de livraison',
                        corps: `Une demande de livraison est disponible à ${Math.round(livreur.distance)}m`,
                        entite_source_type: 'DEMANDE_LIVRAISON',
                        entite_source_id: demande.id
                    });
                }
            }
        } catch (error) {
            console.error('Erreur recherche automatique livreur:', error);
        }
    }

    /**
     * Marquer la commande associée comme livrée
     */
    async marquerCommandeLivree(demande, client) {
        try {
            if (demande.commande_type === 'RESTAURANT_FAST_FOOD' && demande.commande_id) {
                await client.query(
                    `UPDATE COMMANDESEMPLACEMENTFASTFOOD 
                     SET statut_commande = 'LIVREE',
                         date_mise_a_jour = NOW()
                     WHERE id = $1`,
                    [demande.commande_id]
                );
            } else if (demande.commande_type === 'BOUTIQUE' && demande.commande_id) {
                await client.query(
                    `UPDATE COMMANDESBOUTIQUES 
                     SET statut_commande = 'LIVREE',
                         date_mise_a_jour = NOW()
                     WHERE id = $1`,
                    [demande.commande_id]
                );
            }
        } catch (error) {
            console.error('Erreur mise à jour commande:', error);
        }
    }

    /**
     * Notifier le client du changement de statut
     */
    async notifierClient(demande, statut, commentaire) {
        try {
            // Récupérer l'ID du client selon le type de commande
            let compteId;
            if (demande.commande_type === 'RESTAURANT_FAST_FOOD') {
                const result = await db.query(
                    'SELECT compte_id FROM COMMANDESEMPLACEMENTFASTFOOD WHERE id = $1',
                    [demande.commande_id]
                );
                compteId = result.rows[0]?.compte_id;
            } else if (demande.commande_type === 'BOUTIQUE') {
                const result = await db.query(
                    'SELECT compte_id FROM COMMANDESBOUTIQUES WHERE id = $1',
                    [demande.commande_id]
                );
                compteId = result.rows[0]?.compte_id;
            }

            if (compteId) {
                const messages = {
                    'EN_COURS': 'Votre livreur est en route',
                    'LIVREE': 'Votre commande a été livrée',
                    'ANNULEE': `Votre livraison a été annulée${commentaire ? ` : ${commentaire}` : ''}`
                };

                await NotificationService.send({
                    destinataire_id: compteId,
                    type: 'STATUT_LIVRAISON',
                    titre: 'Mise à jour livraison',
                    corps: messages[statut] || `Statut mis à jour : ${statut}`,
                    entite_source_type: 'DEMANDE_LIVRAISON',
                    entite_source_id: demande.id
                });
            }
        } catch (error) {
            console.error('Erreur notification client:', error);
        }
    }

    /**
     * Notifier l'annulation
     */
    async notifierAnnulation(demande, raison) {
        await this.notifierClient(demande, 'ANNULEE', raison);
    }

    /**
     * Générer la timeline des événements
     */
    genererTimeline(demande) {
        const timeline = [
            {
                statut: 'CRÉÉE',
                date: demande.date_creation,
                description: 'Demande de livraison créée'
            }
        ];

        if (demande.livreur_affecte) {
            timeline.push({
                statut: 'ASSIGNÉE',
                date: demande.date_mise_a_jour,
                description: 'Livreur assigné'
            });
        }

        if (demande.date_livraison_effective) {
            timeline.push({
                statut: 'LIVRÉE',
                date: demande.date_livraison_effective,
                description: 'Livraison effectuée'
            });
        }

        if (demande.statut_livraison === 'ANNULEE') {
            timeline.push({
                statut: 'ANNULÉE',
                date: demande.date_mise_a_jour,
                description: 'Livraison annulée'
            });
        }

        return timeline.sort((a, b) => new Date(a.date) - new Date(b.date));
    }
}

module.exports = new DemandeLivraisonController();