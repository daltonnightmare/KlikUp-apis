// src/controllers/livraison/EntrepriseLivraisonController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const FileService = require('../../services/file/FileService');
const GeoService = require('../../services/geo/GeoService');

class EntrepriseLivraisonController {
    /**
     * Créer une nouvelle entreprise de livraison
     * @route POST /api/v1/livraison/entreprises
     */
    async create(req, res, next) {
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

    /**
     * Récupérer toutes les entreprises de livraison
     * @route GET /api/v1/livraison/entreprises
     */
    async findAll(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                est_actif,
                recherche,
                proximite_lat,
                proximite_lng,
                rayon_km = 10
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT e.*,
                       COUNT(DISTINCT sl.id) as nombre_services,
                       COUNT(DISTINCT l.id) as nombre_livreurs,
                       COALESCE(AVG(l.note_moyenne), 0) as note_moyenne_livreurs,
                       COUNT(*) OVER() as total_count
                FROM ENTREPRISE_LIVRAISON e
                LEFT JOIN SERVICES_LIVRAISON sl ON sl.id_entreprise_livraison = e.id AND sl.est_actif = true
                LEFT JOIN LIVREURS l ON l.id_entreprise_livraison = e.id AND l.est_actif = true
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            // Filtre par proximité géographique
            if (proximite_lat && proximite_lng) {
                query += ` AND ST_DWithin(
                    e.localisation_entreprise::geography,
                    ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)::geography,
                    $${paramIndex + 2}
                )`;
                params.push(parseFloat(proximite_lng), parseFloat(proximite_lat), parseFloat(rayon_km) * 1000);
                paramIndex += 3;
            }

            if (est_actif !== undefined) {
                query += ` AND e.est_actif = $${paramIndex}`;
                params.push(est_actif === 'true');
                paramIndex++;
            }

            if (recherche) {
                query += ` AND (e.nom_entreprise_livraison ILIKE $${paramIndex} OR e.description_entreprise_livraison ILIKE $${paramIndex})`;
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            query += ` GROUP BY e.id ORDER BY e.nom_entreprise_livraison ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Conversion des points géométriques en objets JSON
            const entreprises = await Promise.all(result.rows.map(async (row) => {
                const entreprise = { ...row };
                if (row.localisation_entreprise) {
                    entreprise.localisation = await GeoService.pointToJSON(row.localisation_entreprise);
                    delete entreprise.localisation_entreprise;
                }
                return entreprise;
            }));

            res.json({
                success: true,
                data: entreprises,
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
     * Récupérer une entreprise par son ID
     * @route GET /api/v1/livraison/entreprises/:id
     */
    async findOne(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT e.*,
                        COUNT(DISTINCT sl.id) as nombre_services,
                        COUNT(DISTINCT l.id) as nombre_livreurs,
                        COALESCE(AVG(l.note_moyenne), 0) as note_moyenne_livreurs,
                        SUM(l.nombre_livraisons) as total_livraisons
                 FROM ENTREPRISE_LIVRAISON e
                 LEFT JOIN SERVICES_LIVRAISON sl ON sl.id_entreprise_livraison = e.id AND sl.est_actif = true
                 LEFT JOIN LIVREURS l ON l.id_entreprise_livraison = e.id AND l.est_actif = true
                 WHERE e.id = $1
                 GROUP BY e.id`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Entreprise de livraison non trouvée');
            }

            const entreprise = result.rows[0];

            // Conversion de la localisation
            if (entreprise.localisation_entreprise) {
                entreprise.localisation = await GeoService.pointToJSON(entreprise.localisation_entreprise);
                delete entreprise.localisation_entreprise;
            }

            // Récupérer les services disponibles
            const services = await db.query(
                `SELECT * FROM SERVICES_LIVRAISON 
                 WHERE id_entreprise_livraison = $1 AND est_actif = true
                 ORDER BY prix_service ASC`,
                [id]
            );

            // Récupérer les livreurs actifs avec leur localisation actuelle
            const livreurs = await db.query(
                `SELECT l.*,
                        ST_AsGeoJSON(l.localisation_actuelle) as localisation
                 FROM LIVREURS l
                 WHERE l.id_entreprise_livraison = $1 AND l.est_actif = true
                 ORDER BY l.est_disponible DESC, l.note_moyenne DESC
                 LIMIT 20`,
                [id]
            );

            // Statistiques de livraison
            const stats = await db.query(
                `SELECT 
                    COUNT(*) as total_demandes,
                    COUNT(*) FILTER (WHERE est_effectue = true) as livraisons_effectuees,
                    ROUND(AVG(commission)::numeric, 2) as commission_moyenne,
                    SUM(commission) as revenu_total
                 FROM DEMANDES_LIVRAISON
                 WHERE id_entreprise_livraison = $1
                   AND date_creation >= NOW() - INTERVAL '30 days'`,
                [id]
            );

            entreprise.services = services.rows;
            entreprise.livreurs = livreurs.rows.map(l => ({
                ...l,
                localisation: l.localisation ? JSON.parse(l.localisation) : null
            }));
            entreprise.statistiques = stats.rows[0];

            res.json({
                success: true,
                data: entreprise
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Mettre à jour une entreprise
     * @route PUT /api/v1/livraison/entreprises/:id
     */
    async update(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const updateData = { ...req.body };

            // Vérifier l'existence
            const entreprise = await client.query(
                'SELECT * FROM ENTREPRISE_LIVRAISON WHERE id = $1',
                [id]
            );

            if (entreprise.rows.length === 0) {
                throw new NotFoundError('Entreprise de livraison non trouvée');
            }

            const existingEntreprise = entreprise.rows[0];

            // Gestion des nouveaux fichiers
            if (req.files) {
                if (req.files.logo) {
                    updateData.logo_entreprise_livraison = await FileService.uploadImage(
                        req.files.logo,
                        'livraison/entreprises/logos'
                    );
                    // Supprimer l'ancien logo
                    if (existingEntreprise.logo_entreprise_livraison) {
                        await FileService.delete(existingEntreprise.logo_entreprise_livraison);
                    }
                }
                if (req.files.favicon) {
                    updateData.favicon_entreprise_livraison = await FileService.uploadImage(
                        req.files.favicon,
                        'livraison/entreprises/favicons'
                    );
                    if (existingEntreprise.favicon_entreprise_livraison) {
                        await FileService.delete(existingEntreprise.favicon_entreprise_livraison);
                    }
                }
            }

            // Traitement de la localisation
            if (updateData.localisation_entreprise) {
                updateData.localisation_entreprise = await GeoService.createPoint(
                    updateData.localisation_entreprise.lat,
                    updateData.localisation_entreprise.lng
                );
            }

            // Construction de la requête UPDATE
            const setClauses = [];
            const values = [id];
            let valueIndex = 2;

            const allowedFields = [
                'nom_entreprise_livraison',
                'description_entreprise_livraison',
                'logo_entreprise_livraison',
                'favicon_entreprise_livraison',
                'localisation_entreprise',
                'pourcentage_commission_plateforme',
                'est_actif'
            ];

            for (const field of allowedFields) {
                if (updateData[field] !== undefined) {
                    setClauses.push(`${field} = $${valueIndex}`);
                    values.push(updateData[field]);
                    valueIndex++;
                }
            }

            if (setClauses.length === 0) {
                throw new ValidationError('Aucune donnée à mettre à jour');
            }

            setClauses.push('date_mise_a_jour = NOW()');

            const updateQuery = `
                UPDATE ENTREPRISE_LIVRAISON 
                SET ${setClauses.join(', ')}
                WHERE id = $1
                RETURNING *
            `;

            const result = await client.query(updateQuery, values);
            const updatedEntreprise = result.rows[0];

            // Journalisation
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'ENTREPRISE_LIVRAISON',
                ressource_id: id,
                utilisateur_id: req.user.id,
                donnees_avant: existingEntreprise,
                donnees_apres: updatedEntreprise
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                data: updatedEntreprise,
                message: 'Entreprise mise à jour avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Désactiver/Activer une entreprise
     * @route PATCH /api/v1/livraison/entreprises/:id/toggle
     */
    async toggleStatus(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { actif } = req.body;

            const result = await client.query(
                `UPDATE ENTREPRISE_LIVRAISON 
                 SET est_actif = $1,
                     date_mise_a_jour = NOW()
                 WHERE id = $2
                 RETURNING *`,
                [actif, id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Entreprise non trouvée');
            }

            // Si désactivation, désactiver aussi tous les livreurs
            if (!actif) {
                await client.query(
                    `UPDATE LIVREURS 
                     SET est_actif = false
                     WHERE id_entreprise_livraison = $1`,
                    [id]
                );
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                data: result.rows[0],
                message: actif ? 'Entreprise activée' : 'Entreprise désactivée'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Obtenir les statistiques d'une entreprise
     * @route GET /api/v1/livraison/entreprises/:id/stats
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
                    COUNT(DISTINCT dl.id) as total_demandes,
                    COUNT(DISTINCT dl.id) FILTER (WHERE dl.est_effectue = true) as livraisons_effectuees,
                    ROUND(AVG(dl.commission)::numeric, 2) as commission_moyenne,
                    SUM(dl.commission) as revenu_total,
                    COUNT(DISTINCT l.id) as livreurs_actifs,
                    AVG(l.note_moyenne) as note_moyenne_livreurs,
                    COUNT(DISTINCT dl.id) FILTER (WHERE dl.statut_livraison = 'EN_ATTENTE') as en_attente,
                    COUNT(DISTINCT dl.id) FILTER (WHERE dl.statut_livraison = 'EN_COURS') as en_cours
                 FROM ENTREPRISE_LIVRAISON e
                 LEFT JOIN LIVREURS l ON l.id_entreprise_livraison = e.id AND l.est_actif = true
                 LEFT JOIN DEMANDES_LIVRAISON dl ON dl.livreur_affecte = l.id 
                    AND dl.date_creation >= NOW() - ${interval}
                 WHERE e.id = $1
                 GROUP BY e.id`,
                [id]
            );

            // Évolution quotidienne
            const evolution = await db.query(
                `SELECT 
                    DATE(dl.date_creation) as date,
                    COUNT(*) as demandes,
                    COUNT(*) FILTER (WHERE dl.est_effectue = true) as livraisons,
                    SUM(dl.commission) as revenu
                 FROM DEMANDES_LIVRAISON dl
                 JOIN LIVREURS l ON l.id = dl.livreur_affecte
                 WHERE l.id_entreprise_livraison = $1
                   AND dl.date_creation >= NOW() - ${interval}
                 GROUP BY DATE(dl.date_creation)
                 ORDER BY date ASC`,
                [id]
            );

            res.json({
                success: true,
                data: {
                    global: stats.rows[0] || {
                        total_demandes: 0,
                        livraisons_effectuees: 0,
                        commission_moyenne: 0,
                        revenu_total: 0,
                        livreurs_actifs: 0,
                        note_moyenne_livreurs: 0,
                        en_attente: 0,
                        en_cours: 0
                    },
                    evolution: evolution.rows,
                    periode
                }
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new EntrepriseLivraisonController();