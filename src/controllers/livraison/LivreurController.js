// src/controllers/livraison/LivreurController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const GeoService = require('../../services/geo/GeoService');
const NotificationService = require('../../services/notification/NotificationService');
const FileService = require('../../services/file/FileService');

class LivreurController {
    /**
     * Créer un nouveau livreur
     * @route POST /api/v1/livraison/livreurs
     */
    async create(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const {
                nom_livreur,
                prenom_livreur,
                numero_telephone_livreur,
                id_entreprise_livraison
            } = req.body;

            // Validation
            if (!nom_livreur || !prenom_livreur || !numero_telephone_livreur) {
                throw new ValidationError('Nom, prénom et téléphone requis');
            }

            // Vérifier si le téléphone existe déjà
            const existing = await client.query(
                'SELECT id FROM LIVREURS WHERE numero_telephone_livreur = $1',
                [numero_telephone_livreur]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError('Ce numéro de téléphone est déjà utilisé');
            }

            // Gestion de la photo
            let photoPath = null;
            if (req.files && req.files.photo) {
                photoPath = await FileService.uploadImage(
                    req.files.photo,
                    'livraison/livreurs'
                );
            }

            const result = await client.query(
                `INSERT INTO LIVREURS (
                    nom_livreur, prenom_livreur, photo_livreur,
                    numero_telephone_livreur, id_entreprise_livraison,
                    est_disponible, est_actif, nombre_livraisons
                ) VALUES ($1, $2, $3, $4, $5, true, true, 0)
                RETURNING *`,
                [
                    nom_livreur, prenom_livreur, photoPath,
                    numero_telephone_livreur, id_entreprise_livraison
                ]
            );

            const livreur = result.rows[0];

            // Journalisation
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'LIVREUR',
                ressource_id: livreur.id,
                utilisateur_id: req.user.id,
                donnees_apres: livreur
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: livreur,
                message: 'Livreur créé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer tous les livreurs
     * @route GET /api/v1/livraison/livreurs
     */
    async findAll(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                id_entreprise_livraison,
                est_disponible,
                est_actif,
                note_min,
                proximite_lat,
                proximite_lng,
                rayon_km = 5
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT l.*,
                       e.nom_entreprise_livraison,
                       COUNT(dl.id) as livraisons_30j,
                       COUNT(*) OVER() as total_count
                FROM LIVREURS l
                LEFT JOIN ENTREPRISE_LIVRAISON e ON e.id = l.id_entreprise_livraison
                LEFT JOIN DEMANDES_LIVRAISON dl ON dl.livreur_affecte = l.id 
                    AND dl.date_creation >= NOW() - INTERVAL '30 days'
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            // Filtre par proximité géographique
            if (proximite_lat && proximite_lng) {
                query += ` AND l.localisation_actuelle IS NOT NULL
                           AND ST_DWithin(
                               l.localisation_actuelle::geography,
                               ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)::geography,
                               $${paramIndex + 2}
                           )`;
                params.push(parseFloat(proximite_lng), parseFloat(proximite_lat), parseFloat(rayon_km) * 1000);
                paramIndex += 3;
            }

            if (id_entreprise_livraison) {
                query += ` AND l.id_entreprise_livraison = $${paramIndex}`;
                params.push(id_entreprise_livraison);
                paramIndex++;
            }

            if (est_disponible !== undefined) {
                query += ` AND l.est_disponible = $${paramIndex}`;
                params.push(est_disponible === 'true');
                paramIndex++;
            }

            if (est_actif !== undefined) {
                query += ` AND l.est_actif = $${paramIndex}`;
                params.push(est_actif === 'true');
                paramIndex++;
            }

            if (note_min) {
                query += ` AND l.note_moyenne >= $${paramIndex}`;
                params.push(parseFloat(note_min));
                paramIndex++;
            }

            query += ` GROUP BY l.id, e.nom_entreprise_livraison
                       ORDER BY l.est_disponible DESC, l.note_moyenne DESC NULLS LAST
                       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Conversion des localisations
            const livreurs = await Promise.all(result.rows.map(async (row) => {
                const livreur = { ...row };
                if (row.localisation_actuelle) {
                    livreur.localisation = await GeoService.pointToJSON(row.localisation_actuelle);
                    delete livreur.localisation_actuelle;
                }
                return livreur;
            }));

            res.json({
                success: true,
                data: livreurs,
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
     * Récupérer un livreur par son ID
     * @route GET /api/v1/livraison/livreurs/:id
     */
    async findOne(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT l.*,
                        e.nom_entreprise_livraison,
                        e.logo_entreprise_livraison,
                        COUNT(dl.id) as total_livraisons,
                        AVG(dl.commission) as commission_moyenne
                 FROM LIVREURS l
                 LEFT JOIN ENTREPRISE_LIVRAISON e ON e.id = l.id_entreprise_livraison
                 LEFT JOIN DEMANDES_LIVRAISON dl ON dl.livreur_affecte = l.id
                 WHERE l.id = $1
                 GROUP BY l.id, e.nom_entreprise_livraison, e.logo_entreprise_livraison`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Livreur non trouvé');
            }

            const livreur = result.rows[0];

            // Conversion de la localisation
            if (livreur.localisation_actuelle) {
                livreur.localisation = await GeoService.pointToJSON(livreur.localisation_actuelle);
                delete livreur.localisation_actuelle;
            }

            // Historique des livraisons récentes
            const livraisons = await db.query(
                `SELECT dl.*,
                        CASE 
                            WHEN dl.commande_type = 'RESTAURANT_FAST_FOOD' THEN 
                                (SELECT reference_commande FROM COMMANDESEMPLACEMENTFASTFOOD WHERE id = dl.commande_id::integer)
                            WHEN dl.commande_type = 'BOUTIQUE' THEN 
                                (SELECT reference_commande FROM COMMANDESBOUTIQUES WHERE id = dl.commande_id::integer)
                            ELSE 'N/A'
                        END as reference
                 FROM DEMANDES_LIVRAISON dl
                 WHERE dl.livreur_affecte = $1
                 ORDER BY dl.date_creation DESC
                 LIMIT 20`,
                [id]
            );

            // Évaluation des performances
            const performances = await db.query(
                `SELECT 
                    AVG(EXTRACT(EPOCH FROM (dl.date_livraison_effective - dl.date_creation)) / 60) as temps_moyen_minutes,
                    COUNT(*) FILTER (WHERE dl.statut_livraison = 'LIVREE') as livraisons_reussies,
                    COUNT(*) FILTER (WHERE dl.statut_livraison = 'ANNULEE') as livraisons_annulees,
                    SUM(dl.commission) as revenu_total
                 FROM DEMANDES_LIVRAISON dl
                 WHERE dl.livreur_affecte = $1
                   AND dl.date_creation >= NOW() - INTERVAL '30 days'`,
                [id]
            );

            livreur.livraisons_recentes = livraisons.rows;
            livreur.performances = performances.rows[0];

            res.json({
                success: true,
                data: livreur
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Mettre à jour un livreur
     * @route PUT /api/v1/livraison/livreurs/:id
     */
    async update(req, res, next) {
        try {
            const { id } = req.params;
            const updateData = { ...req.body };

            // Vérifier l'existence
            const livreur = await db.query(
                'SELECT * FROM LIVREURS WHERE id = $1',
                [id]
            );

            if (livreur.rows.length === 0) {
                throw new NotFoundError('Livreur non trouvé');
            }

            // Gestion de la nouvelle photo
            if (req.files && req.files.photo) {
                updateData.photo_livreur = await FileService.uploadImage(
                    req.files.photo,
                    'livraison/livreurs'
                );
                // Supprimer l'ancienne photo
                if (livreur.rows[0].photo_livreur) {
                    await FileService.delete(livreur.rows[0].photo_livreur);
                }
            }

            // Construction de la requête UPDATE
            const setClauses = [];
            const values = [id];
            let valueIndex = 2;

            const allowedFields = [
                'nom_livreur', 'prenom_livreur', 'photo_livreur',
                'numero_telephone_livreur', 'id_entreprise_livraison',
                'est_disponible', 'est_actif', 'note_moyenne'
            ];

            for (const field of allowedFields) {
                if (updateData[field] !== undefined) {
                    setClauses.push(`${field} = $${valueIndex}`);
                    values.push(updateData[field]);
                    valueIndex++;
                }
            }

            setClauses.push('date_mise_a_jour = NOW()');

            const updateQuery = `
                UPDATE LIVREURS 
                SET ${setClauses.join(', ')}
                WHERE id = $1
                RETURNING *
            `;

            const result = await db.query(updateQuery, values);

            // Journalisation
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'LIVREUR',
                ressource_id: id,
                utilisateur_id: req.user.id,
                donnees_avant: livreur.rows[0],
                donnees_apres: result.rows[0]
            });

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Livreur mis à jour avec succès'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Mettre à jour la localisation d'un livreur
     * @route PATCH /api/v1/livraison/livreurs/:id/localisation
     */
    async updateLocalisation(req, res, next) {
        try {
            const { id } = req.params;
            const { lat, lng } = req.body;

            if (!lat || !lng) {
                throw new ValidationError('Latitude et longitude requises');
            }

            const point = await GeoService.createPoint(lng, lat);

            const result = await db.query(
                `UPDATE LIVREURS 
                 SET localisation_actuelle = $1,
                     date_mise_a_jour = NOW()
                 WHERE id = $2
                 RETURNING id, est_disponible`,
                [point, id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Livreur non trouvé');
            }

            // Notifier les demandes en cours
            await this.notifierProximite(id, lat, lng);

            res.json({
                success: true,
                message: 'Localisation mise à jour'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Changer le statut de disponibilité
     * @route PATCH /api/v1/livraison/livreurs/:id/disponibilite
     */
    async toggleDisponibilite(req, res, next) {
        try {
            const { id } = req.params;
            const { disponible } = req.body;

            const result = await db.query(
                `UPDATE LIVREURS 
                 SET est_disponible = $1,
                     date_mise_a_jour = NOW()
                 WHERE id = $2
                 RETURNING *`,
                [disponible, id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Livreur non trouvé');
            }

            res.json({
                success: true,
                data: result.rows[0],
                message: disponible ? 'Livreur disponible' : 'Livreur indisponible'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Obtenir les livreurs disponibles à proximité
     * @route GET /api/v1/livraison/livreurs/disponibles/proches
     */
    async getDisponiblesProches(req, res, next) {
        try {
            const {
                lat,
                lng,
                rayon_km = 5,
                type_vehicule,
                limit = 10
            } = req.query;

            if (!lat || !lng) {
                throw new ValidationError('Position requise');
            }

            const query = `
                SELECT l.*,
                       e.nom_entreprise_livraison,
                       ST_Distance(
                           l.localisation_actuelle::geography,
                           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                       ) as distance_meters
                FROM LIVREURS l
                JOIN ENTREPRISE_LIVRAISON e ON e.id = l.id_entreprise_livraison
                WHERE l.est_disponible = true
                  AND l.est_actif = true
                  AND l.localisation_actuelle IS NOT NULL
                  AND ST_DWithin(
                      l.localisation_actuelle::geography,
                      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                      $3
                  )
                ORDER BY distance_meters ASC
                LIMIT $4
            `;

            const result = await db.query(query, [
                parseFloat(lng),
                parseFloat(lat),
                parseFloat(rayon_km) * 1000,
                parseInt(limit)
            ]);

            const livreurs = await Promise.all(result.rows.map(async (row) => {
                const livreur = { ...row };
                livreur.distance_km = Math.round(row.distance_meters / 10) / 100;
                if (row.localisation_actuelle) {
                    livreur.localisation = await GeoService.pointToJSON(row.localisation_actuelle);
                    delete livreur.localisation_actuelle;
                }
                delete livreur.distance_meters;
                return livreur;
            }));

            res.json({
                success: true,
                data: livreurs,
                count: livreurs.length
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Obtenir les statistiques d'un livreur
     * @route GET /api/v1/livraison/livreurs/:id/stats
     */
    async getStats(req, res, next) {
        try {
            const { id } = req.params;
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
                    COUNT(*) as total_livraisons,
                    COUNT(*) FILTER (WHERE statut_livraison = 'LIVREE') as livraisons_reussies,
                    COUNT(*) FILTER (WHERE statut_livraison = 'ANNULEE') as annulations,
                    ROUND(AVG(EXTRACT(EPOCH FROM (date_livraison_effective - date_creation)) / 60)::numeric, 2) as temps_moyen_minutes,
                    SUM(commission) as revenu_total,
                    ROUND(AVG(commission)::numeric, 2) as commission_moyenne
                 FROM DEMANDES_LIVRAISON
                 WHERE livreur_affecte = $1
                   AND date_creation >= NOW() - ${interval}`,
                [id]
            );

            // Évolution quotidienne
            const evolution = await db.query(
                `SELECT 
                    DATE(date_creation) as date,
                    COUNT(*) as livraisons,
                    SUM(commission) as revenu
                 FROM DEMANDES_LIVRAISON
                 WHERE livreur_affecte = $1
                   AND date_creation >= NOW() - ${interval}
                 GROUP BY DATE(date_creation)
                 ORDER BY date ASC`,
                [id]
            );

            res.json({
                success: true,
                data: {
                    global: stats.rows[0],
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
     * Notifier les demandes en cours de la proximité d'un livreur
     */
    async notifierProximite(livreurId, lat, lng) {
        try {
            // Récupérer les demandes en attente à proximité
            const demandes = await db.query(
                `SELECT dl.id, dl.commande_id, dl.commande_type
                 FROM DEMANDES_LIVRAISON dl
                 JOIN ADRESSES a ON a.id = dl.adresse_livraison_id
                 WHERE dl.statut_livraison = 'EN_ATTENTE'
                   AND ST_DWithin(
                       a.coordonnees::geography,
                       ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                       2000
                   )`,
                [lng, lat]
            );

            // Notifier pour chaque demande
            for (const demande of demandes.rows) {
                await NotificationService.sendToAdmins({
                    type: 'LIVREUR_PROXIMITE',
                    titre: 'Livreur disponible à proximité',
                    corps: `Un livreur est disponible pour la demande #${demande.id}`,
                    metadata: {
                        livreur_id: livreurId,
                        demande_id: demande.id
                    }
                });
            }
        } catch (error) {
            console.error('Erreur notification proximité:', error);
        }
    }
}

module.exports = new LivreurController();