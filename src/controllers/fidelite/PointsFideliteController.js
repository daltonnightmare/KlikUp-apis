// src/controllers/fidelite/PointsFideliteController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');
const NotificationService = require('../../services/notification/NotificationService');
const AuditService = require('../../services/audit/AuditService');

class PointsFideliteController {
    /**
     * Récupérer le solde de points de l'utilisateur connecté
     * @route GET /api/v1/fidelite/points/mon-solde
     */
    async getMonSolde(req, res, next) {
        try {
            const { programme_id } = req.query;

            let query = `
                SELECT 
                    sf.*,
                    p.nom_programme,
                    p.entite_type,
                    p.entite_id,
                    p.paliers,
                    p.valeur_point_fcfa,
                    CASE 
                        WHEN p.entite_type = 'PLATEFORME' THEN pl.nom_plateforme
                        WHEN p.entite_type = 'COMPAGNIE_TRANSPORT' THEN ct.nom_compagnie
                        WHEN p.entite_type = 'RESTAURANT_FAST_FOOD' THEN rf.nom_restaurant_fast_food
                        WHEN p.entite_type = 'BOUTIQUE' THEN b.nom_boutique
                    END as nom_entite
                FROM SOLDES_FIDELITE sf
                JOIN PROGRAMMES_FIDELITE p ON p.id = sf.programme_id
                LEFT JOIN PLATEFORME pl ON p.entite_type = 'PLATEFORME' AND pl.id = p.entite_id::integer
                LEFT JOIN COMPAGNIESTRANSPORT ct ON p.entite_type = 'COMPAGNIE_TRANSPORT' AND ct.id = p.entite_id::integer
                LEFT JOIN RESTAURANTSFASTFOOD rf ON p.entite_type = 'RESTAURANT_FAST_FOOD' AND rf.id = p.entite_id::integer
                LEFT JOIN BOUTIQUES b ON p.entite_type = 'BOUTIQUE' AND b.id = p.entite_id::integer
                WHERE sf.compte_id = $1
            `;

            const params = [req.user.id];

            if (programme_id) {
                query += ` AND sf.programme_id = $2`;
                params.push(programme_id);
            }

            query += ` ORDER BY sf.points_actuels DESC`;

            const result = await db.query(query, params);

            // Enrichir avec le niveau actuel basé sur les paliers
            const soldes = await Promise.all(result.rows.map(async (solde) => {
                const niveau = this.determineNiveau(solde.points_actuels, solde.paliers);
                const historique = await this.getRecentMouvements(solde.id, 5);
                const valeur_fcfa = solde.points_actuels * solde.valeur_point_fcfa;
                
                return {
                    ...solde,
                    niveau_actuel: niveau,
                    valeur_fcfa,
                    historique
                };
            }));

            res.json({
                success: true,
                data: soldes
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer l'historique des mouvements de points
     * @route GET /api/v1/fidelite/points/historique
     */
    async getHistorique(req, res, next) {
        try {
            const {
                programme_id,
                type_mouvement,
                page = 1,
                limit = 50,
                date_debut,
                date_fin
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    mp.*,
                    sf.programme_id,
                    p.nom_programme,
                    p.entite_type,
                    CASE 
                        WHEN mp.reference_type = 'COMMANDE' AND mp.reference_id IS NOT NULL THEN
                            (SELECT reference_commande FROM COMMANDESEMPLACEMENTFASTFOOD WHERE id = mp.reference_id::integer)
                        WHEN mp.reference_type = 'ACHAT' AND mp.reference_id IS NOT NULL THEN
                            (SELECT transaction_uuid::text FROM ACHATSTICKETSPRIVE WHERE id = mp.reference_id::integer)
                        ELSE NULL
                    END as reference_libelle,
                    COUNT(*) OVER() as total_count
                FROM MOUVEMENTS_POINTS mp
                JOIN SOLDES_FIDELITE sf ON sf.id = mp.solde_id
                JOIN PROGRAMMES_FIDELITE p ON p.id = sf.programme_id
                WHERE sf.compte_id = $1
            `;

            const params = [req.user.id];
            let paramIndex = 2;

            if (programme_id) {
                query += ` AND sf.programme_id = $${paramIndex}`;
                params.push(programme_id);
                paramIndex++;
            }

            if (type_mouvement) {
                query += ` AND mp.type_mouvement = $${paramIndex}`;
                params.push(type_mouvement);
                paramIndex++;
            }

            if (date_debut) {
                query += ` AND mp.date_mouvement >= $${paramIndex}`;
                params.push(date_debut);
                paramIndex++;
            }

            if (date_fin) {
                query += ` AND mp.date_mouvement <= $${paramIndex}`;
                params.push(date_fin);
                paramIndex++;
            }

            query += ` ORDER BY mp.date_mouvement DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(query, params);
            const total = result.rows[0]?.total_count || 0;

            // Calculer les totaux par type
            const totaux = await db.query(
                `SELECT 
                    SUM(CASE WHEN type_mouvement LIKE 'GAIN%' THEN points ELSE 0 END) as total_gagnes,
                    SUM(CASE WHEN type_mouvement = 'UTILISATION' THEN points ELSE 0 END) as total_utilises,
                    SUM(CASE WHEN type_mouvement = 'EXPIRATION' THEN points ELSE 0 END) as total_expires
                 FROM MOUVEMENTS_POINTS mp
                 JOIN SOLDES_FIDELITE sf ON sf.id = mp.solde_id
                 WHERE sf.compte_id = $1`,
                [req.user.id]
            );

            res.json({
                success: true,
                data: {
                    mouvements: result.rows,
                    totaux: totaux.rows[0] || {
                        total_gagnes: 0,
                        total_utilises: 0,
                        total_expires: 0
                    }
                },
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
     * Ajouter des points (gain)
     * @route POST /api/v1/fidelite/points/gagner
     */
    async gagnerPoints(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const {
                programme_id,
                points,
                type_mouvement,
                reference_type,
                reference_id,
                description
            } = req.body;

            // Validation
            if (!programme_id || !points || points <= 0) {
                throw new ValidationError('Programme ID et points positifs requis');
            }

            if (!['GAIN_ACHAT', 'GAIN_PARRAINAGE', 'GAIN_BONUS'].includes(type_mouvement)) {
                throw new ValidationError('Type de mouvement de gain invalide');
            }

            // Récupérer le solde de l'utilisateur pour ce programme
            let solde = await client.query(
                `SELECT sf.*, p.points_par_tranche, p.montant_tranche, p.valeur_point_fcfa, p.paliers
                 FROM SOLDES_FIDELITE sf
                 JOIN PROGRAMMES_FIDELITE p ON p.id = sf.programme_id
                 WHERE sf.compte_id = $1 AND sf.programme_id = $2`,
                [req.user.id, programme_id]
            );

            // Si pas de solde, en créer un
            if (solde.rows.length === 0) {
                const newSolde = await client.query(
                    `INSERT INTO SOLDES_FIDELITE (compte_id, programme_id, points_actuels, points_cumules)
                     VALUES ($1, $2, 0, 0)
                     RETURNING *`,
                    [req.user.id, programme_id]
                );
                
                solde = await client.query(
                    `SELECT sf.*, p.points_par_tranche, p.montant_tranche, p.valeur_point_fcfa, p.paliers
                     FROM SOLDES_FIDELITE sf
                     JOIN PROGRAMMES_FIDELITE p ON p.id = sf.programme_id
                     WHERE sf.id = $1`,
                    [newSolde.rows[0].id]
                );
            }

            const soldeData = solde.rows[0];
            const pointsAvant = soldeData.points_actuels;
            const pointsApres = pointsAvant + points;

            // Créer le mouvement
            const mouvement = await client.query(
                `INSERT INTO MOUVEMENTS_POINTS (
                    solde_id, type_mouvement, points, points_avant, points_apres,
                    reference_type, reference_id, description,
                    expire_le
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                    CASE WHEN $2 = 'GAIN_ACHAT' THEN NOW() + INTERVAL '1 year' ELSE NULL END
                ) RETURNING *`,
                [
                    soldeData.id, type_mouvement, points, pointsAvant, pointsApres,
                    reference_type, reference_id, description
                ]
            );

            // Mettre à jour le solde
            await client.query(
                `UPDATE SOLDES_FIDELITE 
                 SET points_actuels = $1,
                     points_cumules = points_cumules + $2,
                     date_derniere_activite = NOW()
                 WHERE id = $3`,
                [pointsApres, points, soldeData.id]
            );

            // Déterminer le nouveau niveau si des paliers existent
            if (soldeData.paliers && soldeData.paliers.length > 0) {
                const nouveauNiveau = this.determineNiveau(pointsApres, soldeData.paliers);
                if (nouveauNiveau !== soldeData.niveau_actuel) {
                    await client.query(
                        'UPDATE SOLDES_FIDELITE SET niveau_actuel = $1 WHERE id = $2',
                        [nouveauNiveau, soldeData.id]
                    );

                    // Notification de changement de niveau
                    await NotificationService.send({
                        destinataire_id: req.user.id,
                        type: 'CHANGEMENT_NIVEAU',
                        titre: 'Félicitations ! Vous avez changé de niveau',
                        corps: `Vous êtes maintenant au niveau ${nouveauNiveau} dans le programme de fidélité`,
                        entite_source_type: 'PROGRAMME_FIDELITE',
                        entite_source_id: programme_id
                    });
                }
            }

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: {
                    mouvement: mouvement.rows[0],
                    nouveau_solde: pointsApres,
                    points_gagnes: points
                },
                message: `${points} points ajoutés à votre solde`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Utiliser des points
     * @route POST /api/v1/fidelite/points/utiliser
     */
    async utiliserPoints(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const {
                programme_id,
                points,
                reference_type,
                reference_id,
                description
            } = req.body;

            // Validation
            if (!programme_id || !points || points <= 0) {
                throw new ValidationError('Programme ID et points positifs requis');
            }

            // Récupérer le solde
            const solde = await client.query(
                `SELECT sf.*, p.valeur_point_fcfa
                 FROM SOLDES_FIDELITE sf
                 JOIN PROGRAMMES_FIDELITE p ON p.id = sf.programme_id
                 WHERE sf.compte_id = $1 AND sf.programme_id = $2`,
                [req.user.id, programme_id]
            );

            if (solde.rows.length === 0) {
                throw new NotFoundError('Aucun solde de fidélité trouvé pour ce programme');
            }

            const soldeData = solde.rows[0];

            // Vérifier le solde suffisant
            if (soldeData.points_actuels < points) {
                throw new ValidationError(`Solde insuffisant. Vous avez ${soldeData.points_actuels} points`);
            }

            const pointsAvant = soldeData.points_actuels;
            const pointsApres = pointsAvant - points;

            // Créer le mouvement
            const mouvement = await client.query(
                `INSERT INTO MOUVEMENTS_POINTS (
                    solde_id, type_mouvement, points, points_avant, points_apres,
                    reference_type, reference_id, description
                ) VALUES ($1, 'UTILISATION', $2, $3, $4, $5, $6, $7)
                RETURNING *`,
                [
                    soldeData.id, -points, pointsAvant, pointsApres,
                    reference_type, reference_id, description
                ]
            );

            // Mettre à jour le solde
            await client.query(
                `UPDATE SOLDES_FIDELITE 
                 SET points_actuels = $1,
                     date_derniere_activite = NOW()
                 WHERE id = $2`,
                [pointsApres, soldeData.id]
            );

            // Calculer la valeur en FCFA
            const valeurFcfa = points * soldeData.valeur_point_fcfa;

            await client.query('COMMIT');

            res.json({
                success: true,
                data: {
                    mouvement: mouvement.rows[0],
                    nouveau_solde: pointsApres,
                    points_utilises: points,
                    valeur_fcfa: valeurFcfa
                },
                message: `${points} points utilisés (${valeurFcfa} FCFA)`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Convertir des points en réduction
     * @route POST /api/v1/fidelite/points/convertir
     */
    async convertirEnReduction(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const {
                programme_id,
                points,
                commande_type,
                commande_id
            } = req.body;

            // Récupérer le programme
            const programme = await client.query(
                'SELECT * FROM PROGRAMMES_FIDELITE WHERE id = $1 AND est_actif = true',
                [programme_id]
            );

            if (programme.rows.length === 0) {
                throw new NotFoundError('Programme de fidélité non trouvé ou inactif');
            }

            const programmeData = programme.rows[0];

            // Vérifier le solde
            const solde = await client.query(
                `SELECT * FROM SOLDES_FIDELITE 
                 WHERE compte_id = $1 AND programme_id = $2`,
                [req.user.id, programme_id]
            );

            if (solde.rows.length === 0 || solde.rows[0].points_actuels < points) {
                throw new ValidationError('Solde de points insuffisant');
            }

            const soldeData = solde.rows[0];

            // Calculer la valeur de la réduction
            const montantReduction = points * programmeData.valeur_point_fcfa;

            // Créer une entrée dans la table des promotions si nécessaire
            // ou appliquer directement à la commande

            // Utiliser les points
            const pointsAvant = soldeData.points_actuels;
            const pointsApres = pointsAvant - points;

            await client.query(
                `INSERT INTO MOUVEMENTS_POINTS (
                    solde_id, type_mouvement, points, points_avant, points_apres,
                    reference_type, reference_id, description
                ) VALUES ($1, 'UTILISATION', $2, $3, $4, $5, $6, $7)`,
                [
                    soldeData.id, -points, pointsAvant, pointsApres,
                    commande_type, commande_id,
                    `Conversion en réduction de ${montantReduction} FCFA`
                ]
            );

            await client.query(
                `UPDATE SOLDES_FIDELITE 
                 SET points_actuels = $1
                 WHERE id = $2`,
                [pointsApres, soldeData.id]
            );

            // Mettre à jour la commande avec la réduction
            if (commande_type === 'RESTAURANT_FAST_FOOD' && commande_id) {
                await client.query(
                    `UPDATE COMMANDESEMPLACEMENTFASTFOOD 
                     SET remise_appliquee = remise_appliquee + $1,
                         prix_total_commande = prix_total_commande - $1
                     WHERE id = $2`,
                    [montantReduction, commande_id]
                );
            } else if (commande_type === 'BOUTIQUE' && commande_id) {
                await client.query(
                    `UPDATE COMMANDESBOUTIQUES 
                     SET remise_appliquee = remise_appliquee + $1,
                         prix_total_commande = prix_total_commande - $1
                     WHERE id = $2`,
                    [montantReduction, commande_id]
                );
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                data: {
                    points_utilises: points,
                    montant_reduction: montantReduction,
                    nouveau_solde: pointsApres
                },
                message: `Conversion réussie : ${montantReduction} FCFA de réduction`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les avantages disponibles selon le niveau
     * @route GET /api/v1/fidelite/points/avantages
     */
    async getAvantages(req, res, next) {
        try {
            const { programme_id } = req.query;

            // Récupérer le solde de l'utilisateur avec les paliers
            const solde = await db.query(
                `SELECT sf.*, p.paliers, p.nom_programme
                 FROM SOLDES_FIDELITE sf
                 JOIN PROGRAMMES_FIDELITE p ON p.id = sf.programme_id
                 WHERE sf.compte_id = $1 AND sf.programme_id = $2`,
                [req.user.id, programme_id]
            );

            if (solde.rows.length === 0) {
                throw new NotFoundError('Aucun solde trouvé pour ce programme');
            }

            const soldeData = solde.rows[0];
            const paliers = soldeData.paliers || [];

            // Déterminer le niveau actuel
            const niveauActuel = this.determineNiveau(soldeData.points_actuels, paliers);

            // Récupérer les avantages du niveau actuel et du prochain niveau
            const avantagesActuels = paliers.find(p => p.niveau === niveauActuel)?.avantages || [];
            
            // Trouver le prochain niveau
            const prochainsPaliers = paliers
                .filter(p => p.seuil_points > soldeData.points_actuels)
                .sort((a, b) => a.seuil_points - b.seuil_points);
            
            const prochainPalier = prochainsPaliers[0];
            const pointsPourProchain = prochainPalier ? prochainPalier.seuil_points - soldeData.points_actuels : 0;

            // Récupérer les offres spéciales disponibles
            const offres = await db.query(
                `SELECT * FROM PROMOSRESTAURANTFASTFOOD 
                 WHERE actif = true 
                   AND date_debut_promo <= NOW() 
                   AND date_fin_promo >= NOW()
                   AND (produits_affectes->>'niveau_requis')::int <= $1
                 ORDER BY date_fin_promo ASC`,
                [soldeData.points_actuels]
            );

            res.json({
                success: true,
                data: {
                    programme: soldeData.nom_programme,
                    points_actuels: soldeData.points_actuels,
                    niveau_actuel: niveauActuel,
                    avantages_actuels: avantagesActuels,
                    prochain_niveau: prochainPalier ? {
                        niveau: prochainPalier.niveau,
                        seuil: prochainPalier.seuil_points,
                        points_manquants: pointsPourProchain,
                        avantages: prochainPalier.avantages
                    } : null,
                    offres_disponibles: offres.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Points en voie d'expiration
     * @route GET /api/v1/fidelite/points/expiration
     */
    async getPointsExpiration(req, res, next) {
        try {
            const result = await db.query(
                `SELECT 
                    mp.id,
                    mp.points,
                    mp.date_mouvement,
                    mp.expire_le,
                    p.nom_programme,
                    p.entite_type,
                    p.entite_id,
                    DATEDIFF(day, NOW(), mp.expire_le) as jours_restants
                 FROM MOUVEMENTS_POINTS mp
                 JOIN SOLDES_FIDELITE sf ON sf.id = mp.solde_id
                 JOIN PROGRAMMES_FIDELITE p ON p.id = sf.programme_id
                 WHERE sf.compte_id = $1
                   AND mp.expire_le IS NOT NULL
                   AND mp.expire_le > NOW()
                   AND mp.expire_le <= NOW() + INTERVAL '30 days'
                   AND NOT EXISTS (
                       SELECT 1 FROM MOUVEMENTS_POINTS mp2
                       WHERE mp2.reference_type = 'EXPIRATION'
                         AND mp2.reference_id::integer = mp.id
                   )
                 ORDER BY mp.expire_le ASC`,
                [req.user.id]
            );

            const totalPoints = result.rows.reduce((sum, row) => sum + row.points, 0);

            res.json({
                success: true,
                data: {
                    total_points_menaces: totalPoints,
                    points: result.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }

    // ==================== Méthodes privées ====================

    /**
     * Déterminer le niveau en fonction des points et des paliers
     */
    determineNiveau(points, paliers) {
        if (!paliers || paliers.length === 0) {
            return 'STANDARD';
        }

        // Trier les paliers par seuil croissant
        const paliersTries = [...paliers].sort((a, b) => a.seuil_points - b.seuil_points);
        
        let niveau = 'STANDARD';
        for (const palier of paliersTries) {
            if (points >= palier.seuil_points) {
                niveau = palier.niveau;
            } else {
                break;
            }
        }
        
        return niveau;
    }

    /**
     * Récupérer les mouvements récents d'un solde
     */
    async getRecentMouvements(soldeId, limit = 5) {
        const result = await db.query(
            `SELECT * FROM MOUVEMENTS_POINTS 
             WHERE solde_id = $1
             ORDER BY date_mouvement DESC
             LIMIT $2`,
            [soldeId, limit]
        );
        return result.rows;
    }
}

module.exports = new PointsFideliteController();