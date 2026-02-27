// src/controllers/fidelite/ParrainageController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError } = require('../../utils/errors/AppError');
const NotificationService = require('../../services/notification/NotificationService');
const AuditService = require('../../services/audit/AuditService');
const { v4: uuidv4 } = require('uuid');

class ParrainageController {
    /**
     * Générer un code de parrainage
     * @route POST /api/v1/fidelite/parrainage/generer-code
     */
    async genererCode(req, res, next) {
        try {
            const { programme_id } = req.body;

            // Vérifier si l'utilisateur a déjà un code actif
            const existing = await db.query(
                `SELECT * FROM PARRAINAGES 
                 WHERE parrain_id = $1 
                   AND statut IN ('EN_ATTENTE', 'UTILISE')
                   AND date_expiration > NOW()`,
                [req.user.id]
            );

            if (existing.rows.length > 0) {
                return res.json({
                    success: true,
                    data: {
                        code_parrainage: existing.rows[0].code_parrainage,
                        existant: true
                    }
                });
            }

            // Générer un nouveau code (le trigger s'en chargera)
            const result = await db.query(
                `INSERT INTO PARRAINAGES (parrain_id, points_parrain, points_filleul, bonus_fcfa_parrain, bonus_fcfa_filleul)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING code_parrainage`,
                [req.user.id, 100, 50, 1000, 500] // Valeurs par défaut configurables
            );

            res.status(201).json({
                success: true,
                data: {
                    code_parrainage: result.rows[0].code_parrainage,
                    existant: false
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Utiliser un code de parrainage (inscription filleul)
     * @route POST /api/v1/fidelite/parrainage/utiliser
     */
    async utiliserCode(req, res, next) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { code_parrainage } = req.body;

            // Vérifier que le code existe et est valide
            const parrainage = await client.query(
                `SELECT * FROM PARRAINAGES 
                 WHERE code_parrainage = $1 
                   AND statut = 'EN_ATTENTE'
                   AND date_expiration > NOW()
                   AND parrain_id != $2`,
                [code_parrainage, req.user.id]
            );

            if (parrainage.rows.length === 0) {
                throw new ValidationError('Code de parrainage invalide ou expiré');
            }

            const parrainageData = parrainage.rows[0];

            // Vérifier que l'utilisateur n'a pas déjà été parrainé
            const dejaFilleul = await client.query(
                'SELECT id FROM PARRAINAGES WHERE filleul_id = $1',
                [req.user.id]
            );

            if (dejaFilleul.rows.length > 0) {
                throw new ValidationError('Vous avez déjà été parrainé');
            }

            // Mettre à jour le parrainage
            await client.query(
                `UPDATE PARRAINAGES 
                 SET filleul_id = $1,
                     statut = 'UTILISE',
                     date_conversion = NOW(),
                     est_converti = true
                 WHERE id = $2`,
                [req.user.id, parrainageData.id]
            );

            // Créer le programme de fidélité par défaut si nécessaire
            // et attribuer les points

            // Points pour le parrain
            if (parrainageData.points_parrain > 0) {
                await this.attribuerPointsParrainage(
                    parrainageData.parrain_id,
                    parrainageData.points_parrain,
                    'GAIN_PARRAINAGE',
                    parrainageData.id
                );
            }

            // Points pour le filleul
            if (parrainageData.points_filleul > 0) {
                await this.attribuerPointsParrainage(
                    req.user.id,
                    parrainageData.points_filleul,
                    'GAIN_PARRAINAGE',
                    parrainageData.id
                );
            }

            // Bonus FCFA pour le parrain
            if (parrainageData.bonus_fcfa_parrain > 0) {
                await this.crediterBonusFcfa(
                    parrainageData.parrain_id,
                    parrainageData.bonus_fcfa_parrain,
                    `Bonus parrainage - filleul ${req.user.nom_utilisateur_compte}`
                );
            }

            // Bonus FCFA pour le filleul
            if (parrainageData.bonus_fcfa_filleul > 0) {
                await this.crediterBonusFcfa(
                    req.user.id,
                    parrainageData.bonus_fcfa_filleul,
                    'Bonus bienvenue parrainage'
                );
            }

            // Notification au parrain
            await NotificationService.send({
                destinataire_id: parrainageData.parrain_id,
                type: 'PARRAINAGE_REUSSI',
                titre: 'Nouveau filleul !',
                corps: `${req.user.nom_utilisateur_compte} a utilisé votre code de parrainage. Vous avez gagné ${parrainageData.points_parrain} points et ${parrainageData.bonus_fcfa_parrain} FCFA !`,
                entite_source_type: 'PARRAINAGE',
                entite_source_id: parrainageData.id
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Code de parrainage utilisé avec succès',
                data: {
                    points_gagnes: parrainageData.points_filleul,
                    bonus_fcfa: parrainageData.bonus_fcfa_filleul
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
     * Récupérer mes filleuls
     * @route GET /api/v1/fidelite/parrainage/mes-filleuls
     */
    async getMesFilleuls(req, res, next) {
        try {
            const { page = 1, limit = 20 } = req.query;
            const offset = (page - 1) * limit;

            const result = await db.query(
                `SELECT 
                    p.*,
                    c.nom_utilisateur_compte as filleul_nom,
                    c.photo_profil_compte as filleul_photo,
                    c.date_creation as filleul_date_inscription,
                    COUNT(*) OVER() as total_count
                 FROM PARRAINAGES p
                 LEFT JOIN COMPTES c ON c.id = p.filleul_id
                 WHERE p.parrain_id = $1
                 ORDER BY p.date_creation DESC
                 LIMIT $2 OFFSET $3`,
                [req.user.id, parseInt(limit), offset]
            );

            // Statistiques
            const stats = await db.query(
                `SELECT 
                    COUNT(*) as total_parrainages,
                    COUNT(*) FILTER (WHERE est_converti = true) as conversions,
                    COUNT(*) FILTER (WHERE date_creation >= NOW() - INTERVAL '30 days') as nouveau_30j,
                    SUM(points_parrain) as total_points_gagnes,
                    SUM(bonus_fcfa_parrain) as total_bonus_fcfa
                 FROM PARRAINAGES
                 WHERE parrain_id = $1`,
                [req.user.id]
            );

            const total = result.rows[0]?.total_count || 0;

            res.json({
                success: true,
                data: {
                    filleuls: result.rows,
                    stats: stats.rows[0] || {
                        total_parrainages: 0,
                        conversions: 0,
                        nouveau_30j: 0,
                        total_points_gagnes: 0,
                        total_bonus_fcfa: 0
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
     * Récupérer les statistiques de parrainage
     * @route GET /api/v1/fidelite/parrainage/stats
     */
    async getStats(req, res, next) {
        try {
            const stats = await db.query(
                `SELECT 
                    COUNT(DISTINCT parrain_id) as nombre_parrains,
                    COUNT(*) as total_parrainages,
                    AVG(CASE WHEN est_converti THEN 1 ELSE 0 END) * 100 as taux_conversion,
                    SUM(points_parrain) as total_points_distribues,
                    SUM(bonus_fcfa_parrain) as total_bonus_distribues,
                    AVG(EXTRACT(EPOCH FROM (date_conversion - date_creation)) / 86400) as delai_moyen_conversion_jours
                 FROM PARRAINAGES
                 WHERE date_creation >= NOW() - INTERVAL '30 days'`,
                []
            );

            // Top parrains
            const topParrains = await db.query(
                `SELECT 
                    p.parrain_id,
                    c.nom_utilisateur_compte,
                    c.photo_profil_compte,
                    COUNT(*) as nombre_filleuls,
                    SUM(p.points_parrain) as points_gagnes
                 FROM PARRAINAGES p
                 JOIN COMPTES c ON c.id = p.parrain_id
                 WHERE p.est_converti = true
                 GROUP BY p.parrain_id, c.nom_utilisateur_compte, c.photo_profil_compte
                 ORDER BY nombre_filleuls DESC
                 LIMIT 10`,
                []
            );

            res.json({
                success: true,
                data: {
                    global: stats.rows[0],
                    top_parrains: topParrains.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer les détails d'un parrainage
     * @route GET /api/v1/fidelite/parrainage/:id
     */
    async getOne(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT 
                    p.*,
                    parrain.nom_utilisateur_compte as parrain_nom,
                    parrain.photo_profil_compte as parrain_photo,
                    filleul.nom_utilisateur_compte as filleul_nom,
                    filleul.photo_profil_compte as filleul_photo,
                    filleul.date_creation as filleul_date_inscription,
                    (SELECT COUNT(*) FROM PARRAINAGES WHERE parrain_id = p.parrain_id) as total_parrainages_parrain
                 FROM PARRAINAGES p
                 JOIN COMPTES parrain ON parrain.id = p.parrain_id
                 LEFT JOIN COMPTES filleul ON filleul.id = p.filleul_id
                 WHERE p.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new NotFoundError('Parrainage non trouvé');
            }

            res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Récupérer le lien de parrainage
     * @route GET /api/v1/fidelite/parrainage/lien
     */
    async getLienParrainage(req, res, next) {
        try {
            const parrainage = await db.query(
                `SELECT code_parrainage FROM PARRAINAGES 
                 WHERE parrain_id = $1 
                   AND statut IN ('EN_ATTENTE', 'UTILISE')
                   AND date_expiration > NOW()
                 ORDER BY date_creation DESC
                 LIMIT 1`,
                [req.user.id]
            );

            if (parrainage.rows.length === 0) {
                // Générer un nouveau code
                const nouveau = await db.query(
                    `INSERT INTO PARRAINAGES (parrain_id, points_parrain, points_filleul)
                     VALUES ($1, 100, 50)
                     RETURNING code_parrainage`,
                    [req.user.id]
                );
                
                return res.json({
                    success: true,
                    data: {
                        code: nouveau.rows[0].code_parrainage,
                        lien: `${process.env.FRONTEND_URL}/inscription?ref=${nouveau.rows[0].code_parrainage}`
                    }
                });
            }

            res.json({
                success: true,
                data: {
                    code: parrainage.rows[0].code_parrainage,
                    lien: `${process.env.FRONTEND_URL}/inscription?ref=${parrainage.rows[0].code_parrainage}`
                }
            });

        } catch (error) {
            next(error);
        }
    }

    // ==================== Méthodes privées ====================

    /**
     * Attribuer des points de parrainage
     */
    async attribuerPointsParrainage(compteId, points, typeMouvement, parrainageId) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');

            // Trouver ou créer le programme de fidélité par défaut
            let programme = await client.query(
                `SELECT id FROM PROGRAMMES_FIDELITE 
                 WHERE entite_type = 'PLATEFORME' AND est_actif = true
                 LIMIT 1`
            );

            if (programme.rows.length === 0) {
                // Créer un programme par défaut si aucun n'existe
                programme = await client.query(
                    `INSERT INTO PROGRAMMES_FIDELITE 
                     (entite_type, entite_id, nom_programme, points_par_tranche, montant_tranche, valeur_point_fcfa)
                     VALUES ('PLATEFORME', 1, 'Programme de fidélité plateforme', 1, 1000, 5)
                     RETURNING id`
                );
            }

            const programmeId = programme.rows[0].id;

            // Récupérer ou créer le solde
            let solde = await client.query(
                'SELECT id FROM SOLDES_FIDELITE WHERE compte_id = $1 AND programme_id = $2',
                [compteId, programmeId]
            );

            if (solde.rows.length === 0) {
                solde = await client.query(
                    `INSERT INTO SOLDES_FIDELITE (compte_id, programme_id)
                     VALUES ($1, $2)
                     RETURNING id`,
                    [compteId, programmeId]
                );
            }

            const soldeId = solde.rows[0].id;

            // Récupérer le solde actuel
            const soldeActuel = await client.query(
                'SELECT points_actuels FROM SOLDES_FIDELITE WHERE id = $1',
                [soldeId]
            );

            const pointsAvant = soldeActuel.rows[0].points_actuels;
            const pointsApres = pointsAvant + points;

            // Créer le mouvement
            await client.query(
                `INSERT INTO MOUVEMENTS_POINTS (
                    solde_id, type_mouvement, points, points_avant, points_apres,
                    reference_type, reference_id, description
                ) VALUES ($1, $2, $3, $4, $5, 'PARRAINAGE', $6, 'Points gagnés via parrainage')`,
                [soldeId, typeMouvement, points, pointsAvant, pointsApres, parrainageId]
            );

            // Mettre à jour le solde
            await client.query(
                `UPDATE SOLDES_FIDELITE 
                 SET points_actuels = $1,
                     points_cumules = points_cumules + $2,
                     date_derniere_activite = NOW()
                 WHERE id = $3`,
                [pointsApres, points, soldeId]
            );

            await client.query('COMMIT');

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Créditer un bonus en FCFA
     */
    async crediterBonusFcfa(compteId, montant, description) {
        // Implémentation selon votre système de portefeuille
        // À adapter selon la structure de votre base de données
        console.log(`Bonus FCFA de ${montant} crédité à l'utilisateur ${compteId}: ${description}`);
    }
}

module.exports = new ParrainageController();