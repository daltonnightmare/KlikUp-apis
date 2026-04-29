// src/controllers/admin/DemandeCreationController.js
const pool = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const NotificationService = require('../../services/notification/NotificationService');
const AuditService = require('../../services/audit/AuditService');
const FileService = require('../../services/file/FileService');
const logger = require('../../configuration/logger');

class DemandeCreationController {
    /**
     * Récupérer toutes les demandes de création
     * @route GET /api/v1/admin/demandes
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getAllDemandes(req, res, next) {
        try {
            const {
                type_demande,
                statut,
                priorite,
                page = 1,
                limit = 20,
                date_debut,
                date_fin,
                demandeur_id
            } = req.query;

            const offset = (page - 1) * limit;
            const conditions = [];
            const params = [];

            // Construction des filtres
            if (type_demande) {
                params.push(type_demande);
                conditions.push(`d.type_demande = $${params.length}`);
            }

            if (statut) {
                params.push(statut);
                conditions.push(`d.statut = $${params.length}`);
            }

            if (priorite) {
                params.push(priorite);
                conditions.push(`d.priorite = $${params.length}`);
            }

            if (demandeur_id) {
                params.push(demandeur_id);
                conditions.push(`d.demandeur_id = $${params.length}`);
            }

            if (date_debut) {
                params.push(date_debut);
                conditions.push(`d.date_creation >= $${params.length}`);
            }

            if (date_fin) {
                params.push(date_fin);
                conditions.push(`d.date_creation <= $${params.length}`);
            }

            const whereClause = conditions.length > 0 
                ? `WHERE ${conditions.join(' AND ')}` 
                : '';

            // Récupération des demandes
            const result = await pool.query(`
                SELECT 
                    d.*,
                    c.nom_utilisateur_compte as demandeur_nom,
                    c.email as demandeur_email,
                    c.numero_de_telephone as demandeur_telephone,
                    c.photo_profil_compte as demandeur_photo,
                    CASE 
                        WHEN d.statut = 'SOUMISE' THEN 
                            EXTRACT(EPOCH FROM (NOW() - d.date_soumission)) / 3600
                        ELSE 0
                    END as heures_attente
                FROM DEMANDES_CREATION d
                JOIN COMPTES c ON c.id = d.demandeur_id
                ${whereClause}
                ORDER BY 
                    CASE d.priorite
                        WHEN 'URGENTE' THEN 1
                        WHEN 'HAUTE' THEN 2
                        WHEN 'NORMALE' THEN 3
                        ELSE 4
                    END,
                    d.date_creation ASC
                LIMIT $${params.length + 1} OFFSET $${params.length + 2}
            `, [...params, limit, offset]);

            // Comptage total
            const countResult = await pool.query(`
                SELECT COUNT(*) as total
                FROM DEMANDES_CREATION d
                ${whereClause}
            `, params);

            // Statistiques par statut
            const statsResult = await pool.query(`
                SELECT 
                    statut,
                    COUNT(*) as count
                FROM DEMANDES_CREATION
                GROUP BY statut
            `);

            const stats = {};
            statsResult.rows.forEach(row => {
                stats[row.statut] = parseInt(row.count);
            });

            res.json({
                status: 'success',
                data: result.rows,
                statistiques: {
                    total: parseInt(countResult.rows[0].total),
                    ...stats
                },
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total_pages: Math.ceil(parseInt(countResult.rows[0].total) / limit)
                }
            });

        } catch (error) {
            logger.error('Erreur récupération demandes:', error);
            next(error);
        }
    }

    /**
     * Récupérer une demande par son ID
     * @route GET /api/v1/admin/demandes/:id
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getDemandeById(req, res, next) {
        try {
            const { id } = req.params;

            const result = await pool.query(`
                SELECT 
                    d.*,
                    c.nom_utilisateur_compte as demandeur_nom,
                    c.email as demandeur_email,
                    c.numero_de_telephone as demandeur_telephone,
                    c.photo_profil_compte as demandeur_photo,
                    v.nom_utilisateur_compte as validateur_nom,
                    v.email as validateur_email
                FROM DEMANDES_CREATION d
                JOIN COMPTES c ON c.id = d.demandeur_id
                LEFT JOIN COMPTES v ON v.id = d.valide_par
                WHERE d.id = $1
            `, [id]);

            if (result.rows.length === 0) {
                throw new AppError('Demande non trouvée', 404);
            }

            const demande = result.rows[0];

            // Récupération des pièces jointes
            const piecesResult = await pool.query(`
                SELECT * FROM DEMANDES_PIECES
                WHERE demande_id = $1
                ORDER BY date_upload DESC
            `, [id]);

            // Récupération de l'historique
            const historiqueResult = await pool.query(`
                SELECT 
                    dh.*,
                    u.nom_utilisateur_compte as utilisateur_nom
                FROM DEMANDES_HISTORIQUE dh
                LEFT JOIN COMPTES u ON u.id = dh.utilisateur_id
                WHERE dh.demande_id = $1
                ORDER BY dh.date_action DESC
            `, [id]);

            // Récupération de l'adresse si existe
            let adresse = null;
            if (demande.adresse_id) {
                const adresseResult = await pool.query(`
                    SELECT * FROM ADRESSES WHERE id = $1
                `, [demande.adresse_id]);
                adresse = adresseResult.rows[0];
            }

            res.json({
                status: 'success',
                data: {
                    ...demande,
                    pieces_jointes: piecesResult.rows,
                    historique: historiqueResult.rows,
                    adresse
                }
            });

        } catch (error) {
            logger.error('Erreur récupération demande:', error);
            next(error);
        }
    }

    /**
     * Créer une nouvelle demande (brouillon)
     * @route POST /api/v1/admin/demandes
     * @access Tous utilisateurs authentifiés
     */
    async createDemande(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const {
                type_demande,
                nom_entite,
                description_entite,
                logo_provisoire,
                // Restaurant
                heures_ouverture,
                heures_fermeture,
                jours_ouverture,
                frais_livraison_proposes,
                temps_preparation_moyen,
                type_cuisine,
                // Boutique
                types_produits_proposes,
                politique_retour,
                delai_livraison_moyen,
                // Général
                adresse_texte,
                coordonnees_gps,
                pourcentage_commission_souhaite
            } = req.body;

            // Validation du type
            if (!['RESTAURANT_FAST_FOOD', 'BOUTIQUE', 'COMPAGNIE_TRANSPORT'].includes(type_demande)) {
                throw new ValidationError('Type de demande invalide');
            }

            // Vérification des doublons actifs
            const existing = await client.query(`
                SELECT id FROM DEMANDES_CREATION
                WHERE demandeur_id = $1 
                AND nom_entite = $2
                AND statut NOT IN ('REJETEE', 'ANNULEE', 'COMPLETEE')
            `, [req.user.id, nom_entite]);

            if (existing.rows.length > 0) {
                throw new ValidationError('Une demande active existe déjà pour cette entité');
            }

            // Création de la demande
            const result = await client.query(`
                INSERT INTO DEMANDES_CREATION (
                    type_demande,
                    demandeur_id,
                    nom_entite,
                    description_entite,
                    logo_provisoire,
                    heures_ouverture,
                    heures_fermeture,
                    jours_ouverture,
                    frais_livraison_proposes,
                    temps_preparation_moyen,
                    type_cuisine,
                    types_produits_proposes,
                    politique_retour,
                    delai_livraison_moyen,
                    adresse_texte,
                    coordonnees_gps,
                    pourcentage_commission_souhaite,
                    statut,
                    ip_creation,
                    user_agent
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'BROUILLON', $18, $19)
                RETURNING *
            `, [
                type_demande,
                req.user.id,
                nom_entite,
                description_entite,
                logo_provisoire,
                heures_ouverture,
                heures_fermeture,
                jours_ouverture || 'LUNDI_VENDREDI',
                frais_livraison_proposes,
                temps_preparation_moyen,
                type_cuisine,
                types_produits_proposes || '[]',
                politique_retour,
                delai_livraison_moyen,
                adresse_texte,
                coordonnees_gps,
                pourcentage_commission_souhaite,
                req.ip,
                req.headers['user-agent']
            ]);

            // Ajout à l'historique
            await client.query(`
                INSERT INTO DEMANDES_HISTORIQUE (
                    demande_id, action_type, utilisateur_id, message
                ) VALUES ($1, $2, $3, $4)
            `, [result.rows[0].id, 'CREATION', req.user.id, 'Demande créée en brouillon']);

            await client.query('COMMIT');

            logger.info(`Demande créée: ${result.rows[0].id} par ${req.user.id}`);

            res.status(201).json({
                status: 'success',
                message: 'Demande créée avec succès',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur création demande:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour une demande (uniquement en brouillon)
     * @route PUT /api/v1/admin/demandes/:id
     * @access Propriétaire ou ADMIN
     */
    async updateDemande(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const updates = req.body;

            // Vérification existence et statut
            const demande = await client.query(`
                SELECT * FROM DEMANDES_CREATION WHERE id = $1
            `, [id]);

            if (demande.rows.length === 0) {
                throw new AppError('Demande non trouvée', 404);
            }

            const demandeData = demande.rows[0];

            // Vérification des droits
            if (demandeData.demandeur_id !== req.user.id && 
                req.user.role !== 'ADMINISTRATEUR_PLATEFORME') {
                throw new AppError('Non autorisé', 403);
            }

            // Vérification que le statut permet la modification
            if (demandeData.statut !== 'BROUILLON' && demandeData.statut !== 'COMPLEMENT_INFO') {
                throw new ValidationError('Impossible de modifier une demande soumise ou en validation');
            }

            // Construction dynamique de la mise à jour
            const allowedFields = [
                'nom_entite', 'description_entite', 'logo_provisoire',
                'heures_ouverture', 'heures_fermeture', 'jours_ouverture',
                'frais_livraison_proposes', 'temps_preparation_moyen', 'type_cuisine',
                'types_produits_proposes', 'politique_retour', 'delai_livraison_moyen',
                'adresse_texte', 'coordonnees_gps', 'pourcentage_commission_souhaite'
            ];

            const setClauses = [];
            const values = [];
            let paramCount = 1;

            for (const field of allowedFields) {
                if (updates[field] !== undefined) {
                    setClauses.push(`${field} = $${paramCount}`);
                    values.push(updates[field]);
                    paramCount++;
                }
            }

            if (setClauses.length === 0) {
                throw new ValidationError('Aucune donnée à mettre à jour');
            }

            values.push(id);
            const query = `
                UPDATE DEMANDES_CREATION 
                SET ${setClauses.join(', ')}, date_derniere_modification = NOW()
                WHERE id = $${paramCount}
                RETURNING *
            `;

            const result = await client.query(query, values);

            // Historique
            await client.query(`
                INSERT INTO DEMANDES_HISTORIQUE (
                    demande_id, action_type, utilisateur_id, message
                ) VALUES ($1, $2, $3, $4)
            `, [id, 'MODIFICATION', req.user.id, 'Demande mise à jour']);

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: 'Demande mise à jour avec succès',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur mise à jour demande:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Soumettre une demande pour validation
     * @route POST /api/v1/admin/demandes/:id/soumettre
     * @access Propriétaire
     */
    async soumettreDemande(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            // Vérification existence
            const demande = await client.query(`
                SELECT * FROM DEMANDES_CREATION WHERE id = $1
            `, [id]);

            if (demande.rows.length === 0) {
                throw new AppError('Demande non trouvée', 404);
            }

            const demandeData = demande.rows[0];

            // Vérification droits
            if (demandeData.demandeur_id !== req.user.id) {
                throw new AppError('Non autorisé', 403);
            }

            // Vérification statut
            if (demandeData.statut !== 'BROUILLON' && demandeData.statut !== 'COMPLEMENT_INFO') {
                throw new ValidationError(`Impossible de soumettre une demande en statut ${demandeData.statut}`);
            }

            // Validation des champs obligatoires
            const requiredFields = ['nom_entite', 'adresse_texte'];
            for (const field of requiredFields) {
                if (!demandeData[field]) {
                    throw new ValidationError(`Le champ ${field} est obligatoire`);
                }
            }

            // Vérification des pièces jointes minimales
            const piecesCount = await client.query(`
                SELECT COUNT(*) as count FROM DEMANDES_PIECES WHERE demande_id = $1
            `, [id]);

            if (parseInt(piecesCount.rows[0].count) === 0) {
                throw new ValidationError('Veuillez ajouter au moins une pièce justificative');
            }

            // Mise à jour du statut
            const result = await client.query(`
                UPDATE DEMANDES_CREATION 
                SET statut = 'SOUMISE',
                    date_soumission = NOW(),
                    date_derniere_modification = NOW()
                WHERE id = $1
                RETURNING *
            `, [id]);

            // Historique
            await client.query(`
                INSERT INTO DEMANDES_HISTORIQUE (
                    demande_id, action_type, utilisateur_id, message,
                    ancien_statut, nouveau_statut
                ) VALUES ($1, $2, $3, $4, $5, $6)
            `, [id, 'SOUMISSION', req.user.id, 'Demande soumise pour validation', 
                demandeData.statut, 'SOUMISE']);

            // Notification aux admins
            const admins = await client.query(`
                SELECT id FROM COMPTES 
                WHERE compte_role = 'ADMINISTRATEUR_PLATEFORME'
            `);

            for (const admin of admins.rows) {
                await NotificationService.notifyUser(admin.id, {
                    type: 'NOUVELLE_DEMANDE',
                    titre: 'Nouvelle demande de création',
                    message: `${req.user.nom_utilisateur_compte} a soumis une demande pour "${demandeData.nom_entite}"`,
                    donnees: { demande_id: id, type: demandeData.type_demande }
                });
            }

            await client.query('COMMIT');

            logger.info(`Demande ${id} soumise par ${req.user.id}`);

            res.json({
                status: 'success',
                message: 'Demande soumise avec succès',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur soumission demande:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Valider une demande (Approbation)
     * @route POST /api/v1/admin/demandes/:id/valider
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async validerDemande(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { commentaire } = req.body;

            // Vérification existence
            const demande = await client.query(`
                SELECT * FROM DEMANDES_CREATION WHERE id = $1
            `, [id]);

            if (demande.rows.length === 0) {
                throw new AppError('Demande non trouvée', 404);
            }

            const demandeData = demande.rows[0];

            // Vérification statut
            if (demandeData.statut !== 'SOUMISE' && demandeData.statut !== 'EN_VALIDATION') {
                throw new ValidationError(`Impossible de valider une demande en statut ${demandeData.statut}`);
            }

            // Mise à jour
            const result = await client.query(`
                UPDATE DEMANDES_CREATION 
                SET statut = 'APPROUVEE',
                    valide_par = $2,
                    date_validation = NOW(),
                    commentaire_validation = $3,
                    date_derniere_modification = NOW()
                WHERE id = $1
                RETURNING *
            `, [id, req.user.id, commentaire]);

            // Historique
            await client.query(`
                INSERT INTO DEMANDES_HISTORIQUE (
                    demande_id, action_type, utilisateur_id, message,
                    ancien_statut, nouveau_statut, metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [id, 'VALIDATION', req.user.id, commentaire || 'Demande approuvée',
                demandeData.statut, 'APPROUVEE', JSON.stringify({ commentaire })]);

            // Audit
            await AuditService.log({
                action: 'VALIDER_DEMANDE',
                ressource_type: 'DEMANDE_CREATION',
                ressource_id: id,
                utilisateur_id: req.user.id,
                donnees_apres: result.rows[0]
            });

            // Notification au demandeur
            await NotificationService.notifyUser(demandeData.demandeur_id, {
                type: 'DEMANDE_APPROUVEE',
                titre: 'Votre demande a été approuvée',
                message: `Votre demande pour "${demandeData.nom_entite}" a été approuvée. La création sera effectuée prochainement.`,
                donnees: { demande_id: id, type: demandeData.type_demande }
            });

            await client.query('COMMIT');

            logger.info(`Demande ${id} approuvée par ${req.user.id}`);

            res.json({
                status: 'success',
                message: 'Demande approuvée avec succès',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur validation demande:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Rejeter une demande
     * @route POST /api/v1/admin/demandes/:id/rejeter
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async rejeterDemande(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { motif } = req.body;

            if (!motif) {
                throw new ValidationError('Le motif du rejet est obligatoire');
            }

            const demande = await client.query(`
                SELECT * FROM DEMANDES_CREATION WHERE id = $1
            `, [id]);

            if (demande.rows.length === 0) {
                throw new AppError('Demande non trouvée', 404);
            }

            const demandeData = demande.rows[0];

            const result = await client.query(`
                UPDATE DEMANDES_CREATION 
                SET statut = 'REJETEE',
                    valide_par = $2,
                    date_validation = NOW(),
                    motif_rejet = $3,
                    date_derniere_modification = NOW()
                WHERE id = $1
                RETURNING *
            `, [id, req.user.id, motif]);

            // Historique
            await client.query(`
                INSERT INTO DEMANDES_HISTORIQUE (
                    demande_id, action_type, utilisateur_id, message,
                    ancien_statut, nouveau_statut, metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [id, 'REJET', req.user.id, motif,
                demandeData.statut, 'REJETEE', JSON.stringify({ motif })]);

            // Notification
            await NotificationService.notifyUser(demandeData.demandeur_id, {
                type: 'DEMANDE_REJETEE',
                titre: 'Votre demande a été rejetée',
                message: `Votre demande pour "${demandeData.nom_entite}" a été rejetée. Motif : ${motif}`,
                donnees: { demande_id: id, motif }
            });

            await client.query('COMMIT');

            logger.info(`Demande ${id} rejetée par ${req.user.id}`);

            res.json({
                status: 'success',
                message: 'Demande rejetée',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur rejet demande:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Demander des informations complémentaires
     * @route POST /api/v1/admin/demandes/:id/complement
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async demanderComplement(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { message } = req.body;

            if (!message) {
                throw new ValidationError('Le message est obligatoire');
            }

            const demande = await client.query(`
                SELECT * FROM DEMANDES_CREATION WHERE id = $1
            `, [id]);

            if (demande.rows.length === 0) {
                throw new AppError('Demande non trouvée', 404);
            }

            const demandeData = demande.rows[0];

            const result = await client.query(`
                UPDATE DEMANDES_CREATION 
                SET statut = 'COMPLEMENT_INFO',
                    demande_complement_envoyee = TRUE,
                    demande_complement_message = $2,
                    date_demande_complement = NOW(),
                    date_derniere_modification = NOW()
                WHERE id = $1
                RETURNING *
            `, [id, message]);

            // Historique
            await client.query(`
                INSERT INTO DEMANDES_HISTORIQUE (
                    demande_id, action_type, utilisateur_id, message,
                    ancien_statut, nouveau_statut
                ) VALUES ($1, $2, $3, $4, $5, $6)
            `, [id, 'COMPLEMENT_DEMANDE', req.user.id, message,
                demandeData.statut, 'COMPLEMENT_INFO']);

            // Notification
            await NotificationService.notifyUser(demandeData.demandeur_id, {
                type: 'DEMANDE_COMPLEMENT',
                titre: 'Informations complémentaires requises',
                message: `Des informations supplémentaires sont nécessaires pour votre demande : ${message}`,
                donnees: { demande_id: id, message }
            });

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: 'Demande de complément envoyée',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur demande complément:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Répondre à une demande de complément
     * @route POST /api/v1/admin/demandes/:id/complement/repondre
     * @access Propriétaire
     */
    async repondreComplement(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { reponse } = req.body;

            if (!reponse) {
                throw new ValidationError('La réponse est obligatoire');
            }

            const demande = await client.query(`
                SELECT * FROM DEMANDES_CREATION WHERE id = $1
            `, [id]);

            if (demande.rows.length === 0) {
                throw new AppError('Demande non trouvée', 404);
            }

            const demandeData = demande.rows[0];

            if (demandeData.demandeur_id !== req.user.id) {
                throw new AppError('Non autorisé', 403);
            }

            if (demandeData.statut !== 'COMPLEMENT_INFO') {
                throw new ValidationError('Cette demande n\'attend pas de complément');
            }

            const result = await client.query(`
                UPDATE DEMANDES_CREATION 
                SET statut = 'EN_VALIDATION',
                    reponse_complement = $2,
                    date_reponse_complement = NOW(),
                    date_derniere_modification = NOW()
                WHERE id = $1
                RETURNING *
            `, [id, reponse]);

            // Historique
            await client.query(`
                INSERT INTO DEMANDES_HISTORIQUE (
                    demande_id, action_type, utilisateur_id, message,
                    ancien_statut, nouveau_statut
                ) VALUES ($1, $2, $3, $4, $5, $6)
            `, [id, 'COMPLEMENT_REPONSE', req.user.id, reponse,
                demandeData.statut, 'EN_VALIDATION']);

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: 'Réponse envoyée avec succès',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur réponse complément:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Annuler une demande
     * @route POST /api/v1/admin/demandes/:id/annuler
     * @access Propriétaire ou ADMIN
     */
    async annulerDemande(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { raison } = req.body;

            const demande = await client.query(`
                SELECT * FROM DEMANDES_CREATION WHERE id = $1
            `, [id]);

            if (demande.rows.length === 0) {
                throw new AppError('Demande non trouvée', 404);
            }

            const demandeData = demande.rows[0];

            // Vérification droits
            if (demandeData.demandeur_id !== req.user.id && 
                req.user.role !== 'ADMINISTRATEUR_PLATEFORME') {
                throw new AppError('Non autorisé', 403);
            }

            if (demandeData.statut === 'COMPLETEE') {
                throw new ValidationError('Impossible d\'annuler une demande complétée');
            }

            const result = await client.query(`
                UPDATE DEMANDES_CREATION 
                SET statut = 'ANNULEE',
                    date_derniere_modification = NOW()
                WHERE id = $1
                RETURNING *
            `, [id]);

            await client.query(`
                INSERT INTO DEMANDES_HISTORIQUE (
                    demande_id, action_type, utilisateur_id, message,
                    ancien_statut, nouveau_statut
                ) VALUES ($1, $2, $3, $4, $5, $6)
            `, [id, 'ANNULATION', req.user.id, raison || 'Demande annulée',
                demandeData.statut, 'ANNULEE']);

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: 'Demande annulée avec succès',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur annulation demande:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Upload d'une pièce jointe avec UploadMiddleware
     * @route POST /api/v1/admin/demandes/:id/pieces
     * @access Propriétaire ou ADMIN
     */
    async uploadPiece(req, res, next) {
        const client = await pool.getClient();
        let uploadedFilePath = null;
        
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { type_piece = 'AUTRE' } = req.body;

            // Vérifier que le fichier a bien été uploadé via le middleware
            if (!req.uploadedFile) {
                throw new ValidationError('Fichier requis');
            }

            // Vérification existence demande
            const demande = await client.query(`
                SELECT * FROM DEMANDES_CREATION WHERE id = $1
            `, [id]);

            if (demande.rows.length === 0) {
                throw new AppError('Demande non trouvée', 404);
            }

            const demandeData = demande.rows[0];

            // Vérification des droits
            if (demandeData.demandeur_id !== req.user.id && 
                req.user.role !== 'ADMINISTRATEUR_PLATEFORME') {
                throw new AppError('Non autorisé', 403);
            }

            // Vérification que la demande est modifiable
            if (!['BROUILLON', 'COMPLEMENT_INFO'].includes(demandeData.statut)) {
                throw new ValidationError('Impossible d\'ajouter une pièce à une demande déjà soumise');
            }

            uploadedFilePath = req.uploadedFile.path;

            // Enregistrement en base
            const result = await client.query(`
                INSERT INTO DEMANDES_PIECES (
                    demande_id, type_piece, nom_fichier, chemin_fichier,
                    mime_type, taille_fichier
                ) VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `, [id, type_piece, req.uploadedFile.originalname, req.uploadedFile.path, 
                req.uploadedFile.mimetype, req.uploadedFile.size]);

            // Historique
            await client.query(`
                INSERT INTO DEMANDES_HISTORIQUE (
                    demande_id, action_type, utilisateur_id, message, metadata
                ) VALUES ($1, $2, $3, $4, $5)
            `, [id, 'PIECE_AJOUTEE', req.user.id, `Pièce jointe ajoutée: ${type_piece}`,
                JSON.stringify({ fichier: req.uploadedFile.filename, type: type_piece })]);

            await client.query('COMMIT');

            logger.info(`Pièce jointe ajoutée à la demande ${id} par ${req.user.id}`);

            res.status(201).json({
                status: 'success',
                message: 'Pièce jointe ajoutée avec succès',
                data: {
                    id: result.rows[0].id,
                    type_piece: result.rows[0].type_piece,
                    nom_fichier: result.rows[0].nom_fichier,
                    taille_fichier: result.rows[0].taille_fichier,
                    mime_type: result.rows[0].mime_type,
                    url: req.uploadedFile.url,
                    date_upload: result.rows[0].date_upload
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            
            // Nettoyer le fichier uploadé en cas d'erreur
            if (uploadedFilePath) {
                try {
                    const fs = require('fs').promises;
                    await fs.unlink(uploadedFilePath);
                } catch (e) {
                    logger.error('Erreur nettoyage fichier:', e);
                }
            }
            
            logger.error('Erreur upload pièce:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer une pièce jointe
     * @route DELETE /api/v1/admin/demandes/:id/pieces/:pieceId
     * @access Propriétaire ou ADMIN
     */
    async deletePiece(req, res, next) {
        const client = await pool.getClient();
        try {
            await client.query('BEGIN');

            const { id, pieceId } = req.params;

            const piece = await client.query(`
                SELECT dp.*, d.demandeur_id, d.statut
                FROM DEMANDES_PIECES dp
                JOIN DEMANDES_CREATION d ON d.id = dp.demande_id
                WHERE dp.id = $1 AND dp.demande_id = $2
            `, [pieceId, id]);

            if (piece.rows.length === 0) {
                throw new AppError('Pièce jointe non trouvée', 404);
            }

            const pieceData = piece.rows[0];

            // Vérification droits
            if (pieceData.demandeur_id !== req.user.id && 
                req.user.role !== 'ADMINISTRATEUR_PLATEFORME') {
                throw new AppError('Non autorisé', 403);
            }

            // Vérification que la demande est modifiable
            if (!['BROUILLON', 'COMPLEMENT_INFO'].includes(pieceData.statut)) {
                throw new ValidationError('Impossible de supprimer une pièce d\'une demande déjà soumise');
            }

            // Supprimer le fichier physique
            const fs = require('fs').promises;
            try {
                await fs.unlink(pieceData.chemin_fichier);
            } catch (e) {
                logger.warn(`Fichier non trouvé: ${pieceData.chemin_fichier}`);
            }

            // Supprimer l'entrée en base
            await client.query(`
                DELETE FROM DEMANDES_PIECES WHERE id = $1
            `, [pieceId]);

            // Historique
            await client.query(`
                INSERT INTO DEMANDES_HISTORIQUE (
                    demande_id, action_type, utilisateur_id, message, metadata
                ) VALUES ($1, $2, $3, $4, $5)
            `, [id, 'PIECE_SUPPRIMEE', req.user.id, `Pièce jointe supprimée: ${pieceData.type_piece}`,
                JSON.stringify({ type: pieceData.type_piece, nom: pieceData.nom_fichier })]);

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: 'Pièce jointe supprimée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erreur suppression pièce:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer l'historique d'une demande
     * @route GET /api/v1/admin/demandes/:id/historique
     * @access ADMIN ou propriétaire
     */
    async getHistorique(req, res, next) {
        try {
            const { id } = req.params;

            const result = await pool.query(`
                SELECT 
                    dh.*,
                    u.nom_utilisateur_compte as utilisateur_nom,
                    u.email as utilisateur_email,
                    u.photo_profil_compte as utilisateur_photo
                FROM DEMANDES_HISTORIQUE dh
                LEFT JOIN COMPTES u ON u.id = dh.utilisateur_id
                WHERE dh.demande_id = $1
                ORDER BY dh.date_action DESC
            `, [id]);

            res.json({
                status: 'success',
                data: result.rows
            });

        } catch (error) {
            logger.error('Erreur récupération historique:', error);
            next(error);
        }
    }

    /**
     * Télécharger une pièce jointe
     * @route GET /api/v1/admin/demandes/:id/pieces/:pieceId/download
     * @access ADMIN ou propriétaire
     */
    async downloadPiece(req, res, next) {
        try {
            const { id, pieceId } = req.params;
            const fs = require('fs');

            // Vérification des droits d'accès
            const piece = await pool.query(`
                SELECT dp.*, d.demandeur_id
                FROM DEMANDES_PIECES dp
                JOIN DEMANDES_CREATION d ON d.id = dp.demande_id
                WHERE dp.id = $1 AND dp.demande_id = $2
            `, [pieceId, id]);

            if (piece.rows.length === 0) {
                throw new AppError('Pièce jointe non trouvée', 404);
            }

            const pieceData = piece.rows[0];

            // Vérification droits
            if (pieceData.demandeur_id !== req.user.id && 
                req.user.role !== 'ADMINISTRATEUR_PLATEFORME') {
                throw new AppError('Non autorisé', 403);
            }

            // Vérifier que le fichier existe
            if (!fs.existsSync(pieceData.chemin_fichier)) {
                throw new AppError('Fichier non trouvé sur le serveur', 404);
            }

            // Envoi du fichier
            res.setHeader('Content-Type', pieceData.mime_type);
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(pieceData.nom_fichier)}"`);
            res.setHeader('Content-Length', pieceData.taille_fichier);
            
            const stream = fs.createReadStream(pieceData.chemin_fichier);
            stream.pipe(res);

        } catch (error) {
            logger.error('Erreur téléchargement pièce:', error);
            next(error);
        }
    }

    /**
     * Statistiques des demandes
     * @route GET /api/v1/admin/demandes/stats
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getDemandeStats(req, res, next) {
        try {
            const { periode = '30j' } = req.query;
            const intervalle = periode === '30j' ? '30 days' : '7 days';

            const result = await pool.query(`
                WITH stats_globales AS (
                    SELECT 
                        COUNT(*) as total_demandes,
                        COUNT(*) FILTER (WHERE statut = 'SOUMISE') as en_attente,
                        COUNT(*) FILTER (WHERE statut = 'EN_VALIDATION') as en_validation,
                        COUNT(*) FILTER (WHERE statut = 'APPROUVEE') as approuvees,
                        COUNT(*) FILTER (WHERE statut = 'COMPLETEE') as completées,
                        COUNT(*) FILTER (WHERE statut = 'REJETEE') as rejetees,
                        COUNT(*) FILTER (WHERE statut = 'ANNULEE') as annulees,
                        COUNT(*) FILTER (WHERE statut = 'COMPLEMENT_INFO') as complement_info,
                        COUNT(*) FILTER (WHERE type_demande = 'RESTAURANT_FAST_FOOD') as demandes_restaurants,
                        COUNT(*) FILTER (WHERE type_demande = 'BOUTIQUE') as demandes_boutiques,
                        COUNT(*) FILTER (WHERE type_demande = 'COMPAGNIE_TRANSPORT') as demandes_transport,
                        ROUND(AVG(EXTRACT(EPOCH FROM (date_validation - date_soumission)) / 86400)::numeric, 1) as delai_moyen_jours
                    FROM DEMANDES_CREATION
                    WHERE date_creation >= NOW() - $1::interval
                ),
                tendances AS (
                    SELECT 
                        DATE_TRUNC('day', date_creation) as jour,
                        COUNT(*) as nombre
                    FROM DEMANDES_CREATION
                    WHERE date_creation >= NOW() - INTERVAL '30 days'
                    GROUP BY DATE_TRUNC('day', date_creation)
                    ORDER BY jour DESC
                    LIMIT 30
                )
                SELECT * FROM stats_globales, (SELECT json_agg(tendances) as tendances FROM tendances) as t
            `, [intervalle]);

            res.json({
                status: 'success',
                data: result.rows[0]
            });

        } catch (error) {
            logger.error('Erreur récupération stats demandes:', error);
            next(error);
        }
    }
}

module.exports = new DemandeCreationController();