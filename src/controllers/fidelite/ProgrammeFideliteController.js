// src/controllers/fidelite/ProgrammeFideliteController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError, AuthorizationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const CacheService = require('../../services/cache/CacheService');

class ProgrammeFideliteController {
    /**
     * Créer un nouveau programme de fidélité
     * @route POST /api/v1/fidelite/programmes
     */
    async create(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const {
                entite_type,
                entite_id,
                nom_programme,
                description,
                points_par_tranche = 1,
                montant_tranche = 1000,
                valeur_point_fcfa = 5,
                paliers = [],
                date_debut,
                date_fin
            } = req.body;

            // Validation
            if (!entite_type || !entite_id || !nom_programme) {
                throw new ValidationError('Type d\'entité, ID et nom du programme sont requis');
            }

            if (!['PLATEFORME', 'COMPAGNIE_TRANSPORT', 'RESTAURANT_FAST_FOOD', 'BOUTIQUE'].includes(entite_type)) {
                throw new ValidationError('Type d\'entité invalide pour un programme de fidélité');
            }

            // Vérifier si l'entité existe
            await this.checkEntityExists(entite_type, entite_id);

            // Vérifier si un programme existe déjà pour cette entité
            const existing = await client.query(
                'SELECT id FROM PROGRAMMES_FIDELITE WHERE entite_type = $1 AND entite_id = $2',
                [entite_type, entite_id]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError('Un programme de fidélité existe déjà pour cette entité');
            }

            // Validation des paliers
            if (paliers.length > 0) {
                this.validatePaliers(paliers);
            }

            const result = await client.query(
                `INSERT INTO PROGRAMMES_FIDELITE (
                    entite_type, entite_id, nom_programme, description,
                    points_par_tranche, montant_tranche, valeur_point_fcfa,
                    paliers, date_debut, date_fin, est_actif
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
                RETURNING *`,
                [
                    entite_type, entite_id, nom_programme, description,
                    points_par_tranche, montant_tranche, valeur_point_fcfa,
                    JSON.stringify(paliers), date_debut, date_fin
                ]
            );

            const programme = result.rows[0];

            // Journalisation
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'PROGRAMME_FIDELITE',
                ressource_id: programme.id,
                utilisateur_id: req.user.id,
                donnees_apres: programme
            });

            // Invalidation du cache
            await CacheService.invalidatePattern(`fidelite:programme:${entite_type}:${entite_id}`);

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: programme,
                message: 'Programme de fidélité créé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer tous les programmes de fidélité
     * @route GET /api/v1/fidelite/programmes
     */
    async findAll(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                entite_type,
                est_actif,
                recherche
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT p.*,
                       CASE 
                           WHEN p.entite_type = 'PLATEFORME' THEN pl.nom_plateforme
                           WHEN p.entite_type = 'COMPAGNIE_TRANSPORT' THEN ct.nom_compagnie
                           WHEN p.entite_type = 'RESTAURANT_FAST_FOOD' THEN rf.nom_restaurant_fast_food
                           WHEN p.entite_type = 'BOUTIQUE' THEN b.nom_boutique
                       END as nom_entite,
                       COUNT(*) OVER() as total_count
                FROM PROGRAMMES_FIDELITE p
                LEFT JOIN PLATEFORME pl ON p.entite_type = 'PLATEFORME' AND pl.id = p.entite_id::integer
                LEFT JOIN COMPAGNIESTRANSPORT ct ON p.entite_type = 'COMPAGNIE_TRANSPORT' AND ct.id = p.entite_id::integer
                LEFT JOIN RESTAURANTSFASTFOOD rf ON p.entite_type = 'RESTAURANT_FAST_FOOD' AND rf.id = p.entite_id::integer
                LEFT JOIN BOUTIQUES b ON p.entite_type = 'BOUTIQUE' AND b.id = p.entite_id::integer
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            if (entite_type) {
                query += ` AND p.entite_type = $${paramIndex}`;
                params.push(entite_type);
                paramIndex++;
            }

            if (est_actif !== undefined) {
                query += ` AND p.est_actif = $${paramIndex}`;
                params.push(est_actif === 'true');
                paramIndex++;
            }

            if (recherche) {
                query += ` AND (p.nom_programme ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`;
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            query += ` ORDER BY p.date_creation DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Enrichir avec des statistiques
            const programmes = await Promise.all(result.rows.map(async (programme) => {
                const stats = await this.getProgrammeStats(programme.id);
                return { ...programme, stats };
            }));

            res.json({
                success: true,
                data: programmes,
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
     * Récupérer un programme par son ID
     * @route GET /api/v1/fidelite/programmes/:id
     */
    async findOne(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT p.*,
                        CASE 
                            WHEN p.entite_type = 'PLATEFORME' THEN pl.nom_plateforme
                            WHEN p.entite_type = 'COMPAGNIE_TRANSPORT' THEN ct.nom_compagnie
                            WHEN p.entite_type = 'RESTAURANT_FAST_FOOD' THEN rf.nom_restaurant_fast_food
                            WHEN p.entite_type = 'BOUTIQUE' THEN b.nom_boutique
                        END as nom_entite
                 FROM PROGRAMMES_FIDELITE p
                 LEFT JOIN PLATEFORME pl ON p.entite_type = 'PLATEFORME' AND pl.id = p.entite_id::integer
                 LEFT JOIN COMPAGNIESTRANSPORT ct ON p.entite_type = 'COMPAGNIE_TRANSPORT' AND ct.id = p.entite_id::integer
                 LEFT JOIN RESTAURANTSFASTFOOD rf ON p.entite_type = 'RESTAURANT_FAST_FOOD' AND rf.id = p.entite_id::integer
                 LEFT JOIN BOUTIQUES b ON p.entite_type = 'BOUTIQUE' AND b.id = p.entite_id::integer
                 WHERE p.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Programme de fidélité non trouvé');
            }

            const programme = result.rows[0];

            // Statistiques détaillées
            programme.stats = await this.getProgrammeStats(programme.id);
            
            // Top membres
            programme.top_membres = await this.getTopMembres(programme.id, 10);
            
            // Évolution des inscriptions
            programme.evolution = await this.getProgrammeEvolution(programme.id);

            res.json({
                success: true,
                data: programme
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Mettre à jour un programme
     * @route PUT /api/v1/fidelite/programmes/:id
     */
    async update(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const updateData = { ...req.body };

            // Vérifier l'existence
            const programme = await client.query(
                'SELECT * FROM PROGRAMMES_FIDELITE WHERE id = $1',
                [id]
            );

            if (programme.rows.length === 0) {
                throw new NotFoundError('Programme de fidélité non trouvé');
            }

            const existingProgramme = programme.rows[0];

            // Validation des paliers si fournis
            if (updateData.paliers) {
                this.validatePaliers(updateData.paliers);
            }

            // Construction de la requête UPDATE
            const setClauses = [];
            const values = [id];
            let valueIndex = 2;

            const allowedFields = [
                'nom_programme', 'description', 'points_par_tranche',
                'montant_tranche', 'valeur_point_fcfa', 'paliers',
                'date_debut', 'date_fin', 'est_actif'
            ];

            for (const field of allowedFields) {
                if (updateData[field] !== undefined) {
                    setClauses.push(`${field} = $${valueIndex}`);
                    
                    if (field === 'paliers') {
                        values.push(JSON.stringify(updateData[field]));
                    } else {
                        values.push(updateData[field]);
                    }
                    
                    valueIndex++;
                }
            }

            setClauses.push('date_mise_a_jour = NOW()');

            const updateQuery = `
                UPDATE PROGRAMMES_FIDELITE 
                SET ${setClauses.join(', ')}
                WHERE id = $1
                RETURNING *
            `;

            const result = await client.query(updateQuery, values);
            const updatedProgramme = result.rows[0];

            // Journalisation
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'PROGRAMME_FIDELITE',
                ressource_id: id,
                utilisateur_id: req.user.id,
                donnees_avant: existingProgramme,
                donnees_apres: updatedProgramme
            });

            // Invalidation du cache
            await CacheService.invalidatePattern(`fidelite:programme:*`);
            await CacheService.invalidatePattern(`fidelite:stats:${id}`);

            await client.query('COMMIT');

            res.json({
                success: true,
                data: updatedProgramme,
                message: 'Programme mis à jour avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer un programme (soft delete)
     * @route DELETE /api/v1/fidelite/programmes/:id
     */
    async delete(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;

            const programme = await client.query(
                'SELECT * FROM PROGRAMMES_FIDELITE WHERE id = $1',
                [id]
            );

            if (programme.rows.length === 0) {
                throw new NotFoundError('Programme de fidélité non trouvé');
            }

            // Vérifier s'il y a des soldes actifs
            const soldesActifs = await client.query(
                'SELECT COUNT(*) FROM SOLDES_FIDELITE WHERE programme_id = $1 AND points_actuels > 0',
                [id]
            );

            if (parseInt(soldesActifs.rows[0].count) > 0) {
                throw new ValidationError('Impossible de supprimer un programme avec des soldes actifs');
            }

            // Soft delete (désactivation)
            await client.query(
                'UPDATE PROGRAMMES_FIDELITE SET est_actif = false WHERE id = $1',
                [id]
            );

            // Journalisation
            await AuditService.log({
                action: 'DELETE',
                ressource_type: 'PROGRAMME_FIDELITE',
                ressource_id: id,
                utilisateur_id: req.user.id,
                donnees_avant: programme.rows[0]
            });

            // Invalidation du cache
            await CacheService.invalidatePattern(`fidelite:programme:*`);

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Programme désactivé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer le programme d'une entité
     * @route GET /api/v1/fidelite/programmes/entite/:entite_type/:entite_id
     */
    async findByEntity(req, res, next) {
        try {
            const { entite_type, entite_id } = req.params;

            // Vérification cache
            const cached = await CacheService.get(`fidelite:programme:${entite_type}:${entite_id}`);
            if (cached) {
                return res.json({
                    success: true,
                    data: cached,
                    fromCache: true
                });
            }

            const result = await db.query(
                `SELECT p.*,
                        CASE 
                            WHEN p.entite_type = 'PLATEFORME' THEN pl.nom_plateforme
                            WHEN p.entite_type = 'COMPAGNIE_TRANSPORT' THEN ct.nom_compagnie
                            WHEN p.entite_type = 'RESTAURANT_FAST_FOOD' THEN rf.nom_restaurant_fast_food
                            WHEN p.entite_type = 'BOUTIQUE' THEN b.nom_boutique
                        END as nom_entite
                 FROM PROGRAMMES_FIDELITE p
                 LEFT JOIN PLATEFORME pl ON p.entite_type = 'PLATEFORME' AND pl.id = p.entite_id::integer
                 LEFT JOIN COMPAGNIESTRANSPORT ct ON p.entite_type = 'COMPAGNIE_TRANSPORT' AND ct.id = p.entite_id::integer
                 LEFT JOIN RESTAURANTSFASTFOOD rf ON p.entite_type = 'RESTAURANT_FAST_FOOD' AND rf.id = p.entite_id::integer
                 LEFT JOIN BOUTIQUES b ON p.entite_type = 'BOUTIQUE' AND b.id = p.entite_id::integer
                 WHERE p.entite_type = $1 AND p.entite_id = $2 AND p.est_actif = true`,
                [entite_type, entite_id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Aucun programme de fidélité actif pour cette entité');
            }

            const programme = result.rows[0];

            // Mise en cache
            await CacheService.set(`fidelite:programme:${entite_type}:${entite_id}`, programme, 3600); // 1 heure

            res.json({
                success: true,
                data: programme
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Activer/Désactiver un programme
     * @route PATCH /api/v1/fidelite/programmes/:id/toggle
     */
    async toggleStatus(req, res, next) {
        try {
            const { id } = req.params;
            const { actif } = req.body;

            const result = await db.query(
                `UPDATE PROGRAMMES_FIDELITE 
                 SET est_actif = $1,
                     date_mise_a_jour = NOW()
                 WHERE id = $2
                 RETURNING *`,
                [actif, id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Programme non trouvé');
            }

            // Invalidation du cache
            await CacheService.invalidatePattern(`fidelite:programme:*`);

            res.json({
                success: true,
                data: result.rows[0],
                message: actif ? 'Programme activé' : 'Programme désactivé'
            });

        } catch (error) {
            next(error);
        }
    }

    // ==================== Méthodes privées ====================

    /**
     * Vérifier l'existence d'une entité
     */
    async checkEntityExists(entite_type, entite_id) {
        let query;
        switch (entite_type) {
            case 'PLATEFORME':
                query = 'SELECT id FROM PLATEFORME WHERE id = $1';
                break;
            case 'COMPAGNIE_TRANSPORT':
                query = 'SELECT id FROM COMPAGNIESTRANSPORT WHERE id = $1 AND est_supprime = false';
                break;
            case 'RESTAURANT_FAST_FOOD':
                query = 'SELECT id FROM RESTAURANTSFASTFOOD WHERE id = $1 AND est_supprime = false';
                break;
            case 'BOUTIQUE':
                query = 'SELECT id FROM BOUTIQUES WHERE id = $1 AND est_supprime = false';
                break;
            default:
                throw new ValidationError('Type d\'entité non supporté');
        }

        const result = await db.query(query, [entite_id]);
        if (result.rows.length === 0) {
            throw new NotFoundError(`Entité ${entite_type} avec ID ${entite_id} non trouvée`);
        }
    }

    /**
     * Valider la structure des paliers
     */
    validatePaliers(paliers) {
        const niveaux = new Set();
        
        for (const palier of paliers) {
            if (!palier.niveau || !palier.seuil_points || !palier.avantages) {
                throw new ValidationError('Chaque palier doit avoir un niveau, un seuil_points et des avantages');
            }

            if (niveaux.has(palier.niveau)) {
                throw new ValidationError(`Niveau de palier dupliqué: ${palier.niveau}`);
            }
            niveaux.add(palier.niveau);

            if (palier.seuil_points <= 0) {
                throw new ValidationError('Le seuil de points doit être positif');
            }

            if (!Array.isArray(palier.avantages)) {
                throw new ValidationError('Les avantages doivent être un tableau');
            }
        }

        // Vérifier que les seuils sont croissants
        const seuils = paliers.map(p => p.seuil_points);
        const seuilsTries = [...seuils].sort((a, b) => a - b);
        if (JSON.stringify(seuils) !== JSON.stringify(seuilsTries)) {
            throw new ValidationError('Les seuils des paliers doivent être croissants');
        }
    }

    /**
     * Récupérer les statistiques d'un programme
     */
    async getProgrammeStats(programmeId) {
        const stats = await db.query(
            `SELECT 
                COUNT(DISTINCT sf.compte_id) as total_membres,
                COUNT(DISTINCT CASE WHEN sf.points_actuels > 0 THEN sf.compte_id END) as membres_actifs,
                SUM(sf.points_actuels) as total_points_actifs,
                SUM(sf.points_cumules) as total_points_cumules,
                SUM(sf.points_expires) as total_points_expires,
                ROUND(AVG(sf.points_actuels)::numeric, 2) as moyenne_points_par_membre,
                COUNT(DISTINCT mp.id) as total_mouvements,
                SUM(CASE WHEN mp.type_mouvement LIKE 'GAIN%' THEN mp.points ELSE 0 END) as points_gagnes,
                SUM(CASE WHEN mp.type_mouvement = 'UTILISATION' THEN mp.points ELSE 0 END) as points_utilises
             FROM PROGRAMMES_FIDELITE p
             LEFT JOIN SOLDES_FIDELITE sf ON sf.programme_id = p.id
             LEFT JOIN MOUVEMENTS_POINTS mp ON mp.solde_id = sf.id
             WHERE p.id = $1
             GROUP BY p.id`,
            [programmeId]
        );

        return stats.rows[0] || {
            total_membres: 0,
            membres_actifs: 0,
            total_points_actifs: 0,
            total_points_cumules: 0,
            total_points_expires: 0,
            moyenne_points_par_membre: 0,
            total_mouvements: 0,
            points_gagnes: 0,
            points_utilises: 0
        };
    }

    /**
     * Récupérer le top des membres d'un programme
     */
    async getTopMembres(programmeId, limit = 10) {
        const result = await db.query(
            `SELECT 
                sf.compte_id,
                c.nom_utilisateur_compte,
                c.photo_profil_compte,
                sf.points_actuels,
                sf.points_cumules,
                sf.niveau_actuel,
                sf.date_derniere_activite
             FROM SOLDES_FIDELITE sf
             JOIN COMPTES c ON c.id = sf.compte_id
             WHERE sf.programme_id = $1
             ORDER BY sf.points_actuels DESC
             LIMIT $2`,
            [programmeId, limit]
        );

        return result.rows;
    }

    /**
     * Récupérer l'évolution des inscriptions au programme
     */
    async getProgrammeEvolution(programmeId, periode = '30d') {
        const result = await db.query(
            `SELECT 
                DATE(sf.date_creation) as date,
                COUNT(*) as nouveaux_membres,
                SUM(sf.points_actuels) as points_accumules
             FROM SOLDES_FIDELITE sf
             WHERE sf.programme_id = $1
               AND sf.date_creation >= NOW() - $2::interval
             GROUP BY DATE(sf.date_creation)
             ORDER BY date ASC`,
            [programmeId, periode]
        );

        return result.rows;
    }
}

module.exports = new ProgrammeFideliteController();