// src/controllers/avis/AvisController.js
const pool = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const NotificationService = require('../../services/notification/NotificationService');
const CacheService = require('../../services/cache/CacheService');
const { logInfo, logError, logDebug } = require('../../configuration/logger');
const { ENTITE_REFERENCE, STATUT_AVIS } = require('../../utils/constants/enums');

class AvisController {
    /**
     * Créer un nouvel avis
     * @route POST /api/v1/avis
     * @access PRIVATE (utilisateur connecté)
     */
    async create(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const {
                entite_type,
                entite_id,
                note_globale,
                note_qualite,
                note_service,
                note_rapport_prix,
                note_ponctualite,
                titre,
                contenu,
                photos_avis,
                commande_type,
                commande_id
            } = req.body;

            const auteur_id = req.user.id;

            // 1. VALIDATIONS
            this._validateAvisData({
                entite_type,
                entite_id,
                note_globale,
                contenu
            });

            // 2. VÉRIFIER QUE L'ENTITÉ EXISTE
            await this._checkEntityExists(client, entite_type, entite_id);

            // 3. VÉRIFIER QUE L'UTILISATEUR N'A PAS DÉJÀ DONNÉ SON AVIS
            await this._checkDuplicateAvis(client, entite_type, entite_id, auteur_id, commande_id);

            // 4. VÉRIFIER QUE LA COMMANDE EST BIEN TERMINÉE (si commande_id fourni)
            if (commande_id) {
                await this._validateCommande(client, commande_type, commande_id, auteur_id);
            }

            // 5. CRÉATION DE L'AVIS
            const result = await client.query(
                `INSERT INTO AVIS (
                    entite_type, entite_id, auteur_id,
                    note_globale, note_qualite, note_service,
                    note_rapport_prix, note_ponctualite,
                    titre, contenu, photos_avis,
                    statut, est_achat_verifie,
                    date_creation, date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
                RETURNING *`,
                [
                    entite_type,
                    entite_id,
                    auteur_id,
                    note_globale,
                    note_qualite || null,
                    note_service || null,
                    note_rapport_prix || null,
                    note_ponctualite || null,
                    titre || null,
                    contenu || null,
                    JSON.stringify(photos_avis || []),
                    'EN_ATTENTE', // Statut par défaut, en attente de modération
                    !!commande_id // Vérifié si lié à une commande
                ]
            );

            const nouvelAvis = result.rows[0];

            // 6. METTRE À JOUR LA NOTE MOYENNE DE L'ENTITÉ (via vue matérialisée)
            await this._updateEntityAverageRating(client, entite_type, entite_id);

            // 7. NOTIFICATION AU PROPRIÉTAIRE DE L'ENTITÉ
            await this._notifyEntityOwner(client, entite_type, entite_id, nouvelAvis);

            // 8. AUDIT LOG
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'AVIS',
                ressource_id: nouvelAvis.id,
                donnees_apres: nouvelAvis,
                utilisateur_id: auteur_id,
                adresse_ip: req.ip,
                metadata: { entite_type, entite_id }
            });

            await client.query('COMMIT');

            // 9. INVALIDATION CACHE
            await CacheService.delPattern(`avis:${entite_type}:${entite_id}:*`);
            await CacheService.del(`notes:${entite_type}:${entite_id}`);

            logInfo(`Avis créé: ${nouvelAvis.id} pour ${entite_type}:${entite_id} par utilisateur ${auteur_id}`);

            res.status(201).json({
                status: 'success',
                data: nouvelAvis,
                message: 'Votre avis a été soumis et sera publié après modération'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur création avis:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les avis d'une entité
     * @route GET /api/v1/avis/entite/:type/:id
     * @access PUBLIC
     */
    async findByEntity(req, res, next) {
        try {
            const { type, id } = req.params;
            const {
                page = 1,
                limit = 10,
                note,
                avec_photo,
                tri = 'recent',
                inclure_reponses = false
            } = req.query;

            const offset = (page - 1) * limit;

            // Vérification cache
            const cacheKey = `avis:${type}:${id}:${page}:${limit}:${note}:${tri}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    status: 'success',
                    ...cached,
                    from_cache: true
                });
            }

            // Construction de la requête
            let query = `
                SELECT 
                    a.*,
                    c.nom_utilisateur_compte as auteur_nom,
                    c.photo_profil_compte as auteur_photo,
                    c.niveau_fidelite as auteur_niveau,
                    (
                        SELECT COUNT(*) FROM VOTES_AVIS 
                        WHERE avis_id = a.id AND est_utile = true
                    ) as votes_utiles,
                    (
                        SELECT COUNT(*) FROM VOTES_AVIS 
                        WHERE avis_id = a.id AND est_utile = false
                    ) as votes_inutiles
                FROM AVIS a
                LEFT JOIN COMPTES c ON c.id = a.auteur_id
                WHERE a.entite_type = $1 
                AND a.entite_id = $2
                AND a.statut = 'PUBLIE'
            `;

            const params = [type, id];
            let paramIndex = 3;

            if (note) {
                query += ` AND a.note_globale = $${paramIndex}`;
                params.push(parseInt(note));
                paramIndex++;
            }

            if (avec_photo === 'true') {
                query += ` AND a.photos_avis != '[]'::jsonb`;
            }

            // Tri
            switch (tri) {
                case 'recent':
                    query += ' ORDER BY a.date_creation DESC';
                    break;
                case 'ancien':
                    query += ' ORDER BY a.date_creation ASC';
                    break;
                case 'note_desc':
                    query += ' ORDER BY a.note_globale DESC, a.date_creation DESC';
                    break;
                case 'note_asc':
                    query += ' ORDER BY a.note_globale ASC, a.date_creation DESC';
                    break;
                case 'utile':
                    query += ' ORDER BY votes_utiles DESC, a.date_creation DESC';
                    break;
                default:
                    query += ' ORDER BY a.date_creation DESC';
            }

            // Pagination
            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(parseInt(limit), offset);

            const result = await pool.query(query, params);

            // Récupérer les statistiques globales
            const stats = await this._getAvisStats(type, id);

            // Si demandé, inclure les réponses des propriétaires
            if (inclure_reponses) {
                for (const avis of result.rows) {
                    if (avis.reponse_pro) {
                        const moderateur = await pool.query(
                            'SELECT nom_utilisateur_compte FROM COMPTES WHERE id = $1',
                            [avis.reponse_pro_par]
                        );
                        avis.reponse_pro = {
                            contenu: avis.reponse_pro,
                            date: avis.reponse_pro_date,
                            par: moderateur.rows[0]?.nom_utilisateur_compte
                        };
                    }
                }
            }

            const response = {
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: stats.total,
                    pages: Math.ceil(stats.total / limit)
                },
                statistiques: stats
            };

            // Mise en cache (5 minutes)
            await CacheService.set(cacheKey, response, 300);

            res.json({
                status: 'success',
                ...response
            });

        } catch (error) {
            logError('Erreur récupération avis:', error);
            next(error);
        }
    }

    /**
     * Récupérer un avis par ID
     * @route GET /api/v1/avis/:id
     * @access PUBLIC
     */
    async findById(req, res, next) {
        try {
            const { id } = req.params;

            const result = await pool.query(
                `SELECT 
                    a.*,
                    c.nom_utilisateur_compte as auteur_nom,
                    c.photo_profil_compte as auteur_photo,
                    c.email as auteur_email,
                    (
                        SELECT json_agg(json_build_object(
                            'compte_id', v.compte_id,
                            'est_utile', v.est_utile,
                            'date_vote', v.date_vote
                        ))
                        FROM VOTES_AVIS v
                        WHERE v.avis_id = a.id
                    ) as votes,
                    CASE 
                        WHEN a.reponse_pro_par IS NOT NULL THEN (
                            SELECT json_build_object(
                                'nom', mod.nom_utilisateur_compte,
                                'date', a.reponse_pro_date,
                                'contenu', a.reponse_pro
                            )
                            FROM COMPTES mod
                            WHERE mod.id = a.reponse_pro_par
                        )
                        ELSE NULL
                    END as reponse_proprietaire
                FROM AVIS a
                LEFT JOIN COMPTES c ON c.id = a.auteur_id
                WHERE a.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Avis non trouvé', 404);
            }

            const avis = result.rows[0];

            // Incrémenter le compteur de vues
            await pool.query(
                'UPDATE AVIS SET nombre_vues = COALESCE(nombre_vues, 0) + 1 WHERE id = $1',
                [id]
            );

            res.json({
                status: 'success',
                data: avis
            });

        } catch (error) {
            logError('Erreur récupération avis:', error);
            next(error);
        }
    }

    /**
     * Mettre à jour un avis
     * @route PUT /api/v1/avis/:id
     * @access PRIVATE (auteur seulement)
     */
    async update(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const updates = req.body;
            const auteur_id = req.user.id;

            // Vérifier que l'avis existe et appartient à l'utilisateur
            const avisExist = await client.query(
                'SELECT * FROM AVIS WHERE id = $1',
                [id]
            );

            if (avisExist.rows.length === 0) {
                throw new AppError('Avis non trouvé', 404);
            }

            const ancienAvis = avisExist.rows[0];

            if (ancienAvis.auteur_id !== auteur_id && req.user.compte_role !== 'ADMINISTRATEUR_PLATEFORME') {
                throw new AppError('Vous ne pouvez modifier que vos propres avis', 403);
            }

            // Vérifier que l'avis est modifiable (pas trop ancien, pas signalé)
            if (ancienAvis.statut === 'SIGNALE') {
                throw new ValidationError('Cet avis est signalé et ne peut pas être modifié');
            }

            const joursDepuisCreation = (Date.now() - new Date(ancienAvis.date_creation)) / (1000 * 60 * 60 * 24);
            if (joursDepuisCreation > 30 && req.user.compte_role !== 'ADMINISTRATEUR_PLATEFORME') {
                throw new ValidationError('Les avis de plus de 30 jours ne peuvent plus être modifiés');
            }

            // Champs modifiables
            const champsAutorises = [
                'note_globale', 'note_qualite', 'note_service',
                'note_rapport_prix', 'note_ponctualite',
                'titre', 'contenu', 'photos_avis'
            ];

            const setClauses = [];
            const values = [id];
            const modifications = {};

            for (const champ of champsAutorises) {
                if (updates[champ] !== undefined) {
                    setClauses.push(`${champ} = $${values.length + 1}`);
                    values.push(updates[champ]);
                    modifications[champ] = {
                        avant: ancienAvis[champ],
                        apres: updates[champ]
                    };
                }
            }

            if (setClauses.length === 0) {
                throw new ValidationError('Aucune modification détectée');
            }

            // Remettre en attente de modération
            setClauses.push('statut = $' + (values.length + 1));
            values.push('EN_ATTENTE');
            setClauses.push('date_mise_a_jour = NOW()');

            const query = `
                UPDATE AVIS 
                SET ${setClauses.join(', ')}
                WHERE id = $1
                RETURNING *
            `;

            const result = await client.query(query, values);
            const avisMaj = result.rows[0];

            // Mettre à jour la note moyenne
            await this._updateEntityAverageRating(client, ancienAvis.entite_type, ancienAvis.entite_id);

            // Audit
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'AVIS',
                ressource_id: id,
                donnees_avant: ancienAvis,
                donnees_apres: avisMaj,
                modifications,
                utilisateur_id: auteur_id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`avis:${ancienAvis.entite_type}:${ancienAvis.entite_id}:*`);
            await CacheService.del(`notes:${ancienAvis.entite_type}:${ancienAvis.entite_id}`);

            res.json({
                status: 'success',
                data: avisMaj,
                message: 'Avis mis à jour avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur mise à jour avis:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer un avis
     * @route DELETE /api/v1/avis/:id
     * @access PRIVATE (auteur) / ADMIN
     */
    async delete(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const auteur_id = req.user.id;

            const avis = await client.query(
                'SELECT * FROM AVIS WHERE id = $1',
                [id]
            );

            if (avis.rows.length === 0) {
                throw new AppError('Avis non trouvé', 404);
            }

            const avisData = avis.rows[0];

            if (avisData.auteur_id !== auteur_id && req.user.compte_role !== 'ADMINISTRATEUR_PLATEFORME') {
                throw new AppError('Vous ne pouvez supprimer que vos propres avis', 403);
            }

            // Soft delete
            await client.query(
                `UPDATE AVIS 
                 SET statut = 'SUPPRIME',
                     date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [id]
            );

            // Mettre à jour la note moyenne
            await this._updateEntityAverageRating(client, avisData.entite_type, avisData.entite_id);

            // Audit
            await AuditService.log({
                action: 'DELETE',
                ressource_type: 'AVIS',
                ressource_id: id,
                donnees_avant: avisData,
                utilisateur_id: auteur_id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`avis:${avisData.entite_type}:${avisData.entite_id}:*`);
            await CacheService.del(`notes:${avisData.entite_type}:${avisData.entite_id}`);

            res.json({
                status: 'success',
                message: 'Avis supprimé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur suppression avis:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Répondre à un avis (pour le propriétaire)
     * @route POST /api/v1/avis/:id/repondre
     * @access PRIVATE (propriétaire de l'entité)
     */
    async respondToAvis(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { reponse } = req.body;

            if (!reponse || reponse.length < 5) {
                throw new ValidationError('La réponse doit contenir au moins 5 caractères');
            }

            // Récupérer l'avis
            const avis = await client.query(
                'SELECT * FROM AVIS WHERE id = $1',
                [id]
            );

            if (avis.rows.length === 0) {
                throw new AppError('Avis non trouvé', 404);
            }

            const avisData = avis.rows[0];

            // Vérifier que l'utilisateur est bien le propriétaire de l'entité
            await this._checkIsEntityOwner(client, avisData.entite_type, avisData.entite_id, req.user.id);

            // Vérifier qu'il n'y a pas déjà une réponse
            if (avisData.reponse_pro) {
                throw new ValidationError('Une réponse existe déjà pour cet avis');
            }

            // Ajouter la réponse
            await client.query(
                `UPDATE AVIS 
                 SET reponse_pro = $1,
                     reponse_pro_date = NOW(),
                     reponse_pro_par = $2,
                     date_mise_a_jour = NOW()
                 WHERE id = $3`,
                [reponse, req.user.id, id]
            );

            // Notifier l'auteur de l'avis
            await NotificationService.notifyUser(avisData.auteur_id, {
                type: 'AVIS_REPONSE',
                titre: 'Réponse à votre avis',
                message: 'Le propriétaire a répondu à votre avis',
                donnees: {
                    avis_id: id,
                    entite_type: avisData.entite_type,
                    entite_id: avisData.entite_id
                }
            });

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`avis:${avisData.entite_type}:${avisData.entite_id}:*`);

            res.json({
                status: 'success',
                message: 'Réponse ajoutée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur réponse avis:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Signaler un avis
     * @route POST /api/v1/avis/:id/signaler
     * @access PRIVATE
     */
    async signaler(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { motif, description } = req.body;

            if (!motif) {
                throw new ValidationError('Le motif du signalement est requis');
            }

            // Vérifier que l'avis existe
            const avis = await client.query(
                'SELECT * FROM AVIS WHERE id = $1',
                [id]
            );

            if (avis.rows.length === 0) {
                throw new AppError('Avis non trouvé', 404);
            }

            const avisData = avis.rows[0];

            // Vérifier que l'utilisateur n'a pas déjà signalé cet avis
            const signalementExistant = await client.query(
                `SELECT id FROM SIGNALEMENTS_AVIS 
                 WHERE avis_id = $1 AND compte_id = $2`,
                [id, req.user.id]
            );

            if (signalementExistant.rows.length > 0) {
                throw new ValidationError('Vous avez déjà signalé cet avis');
            }

            // Créer le signalement
            await client.query(
                `INSERT INTO SIGNALEMENTS_AVIS 
                 (avis_id, compte_id, motif, description, date_signalement)
                 VALUES ($1, $2, $3, $4, NOW())`,
                [id, req.user.id, motif, description || null]
            );

            // Incrémenter le compteur de signalements
            await client.query(
                `UPDATE AVIS 
                 SET nombre_signalements = COALESCE(nombre_signalements, 0) + 1,
                     motif_signalements = motif_signalements || $1::jsonb,
                     statut = CASE 
                         WHEN nombre_signalements >= 4 THEN 'SIGNALE'
                         ELSE statut
                     END
                 WHERE id = $2`,
                [JSON.stringify([{ motif, date: new Date(), par: req.user.id }]), id]
            );

            await client.query('COMMIT');

            // Notifier les modérateurs si seuil atteint
            if (avisData.nombre_signalements >= 4) {
                await NotificationService.notifyAdmins({
                    type: 'AVIS_SIGNALE',
                    titre: '⚠️ Avis signalé multiple fois',
                    message: `Un avis a été signalé ${avisData.nombre_signalements + 1} fois`,
                    priorite: 'NORMALE',
                    donnees: { avis_id: id }
                });
            }

            res.json({
                status: 'success',
                message: 'Avis signalé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur signalement avis:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les avis de l'utilisateur connecté
     * @route GET /api/v1/mes-avis
     * @access PRIVATE
     */
    async getMesAvis(req, res, next) {
        try {
            const { id } = req.user;
            const {
                page = 1,
                limit = 10,
                statut,
                entite_type
            } = req.query;

            const offset = (page - 1) * limit;
            const params = [id];
            let paramIndex = 2;
            const conditions = ['a.auteur_id = $1'];

            if (statut) {
                conditions.push(`a.statut = $${paramIndex}`);
                params.push(statut);
                paramIndex++;
            }

            if (entite_type) {
                conditions.push(`a.entite_type = $${paramIndex}`);
                params.push(entite_type);
                paramIndex++;
            }

            const query = `
                SELECT 
                    a.*,
                    CASE a.entite_type
                        WHEN 'BOUTIQUE' THEN (SELECT nom_boutique FROM BOUTIQUES WHERE id = a.entite_id)
                        WHEN 'RESTAURANT_FAST_FOOD' THEN (SELECT nom_restaurant_fast_food FROM RESTAURANTSFASTFOOD WHERE id = a.entite_id)
                        WHEN 'PRODUIT_BOUTIQUE' THEN (SELECT nom_produit FROM PRODUITSBOUTIQUE WHERE id = a.entite_id)
                        ELSE 'Entité inconnue'
                    END as entite_nom,
                    (
                        SELECT COUNT(*) FROM VOTES_AVIS 
                        WHERE avis_id = a.id AND est_utile = true
                    ) as votes_utiles
                FROM AVIS a
                WHERE ${conditions.join(' AND ')}
                ORDER BY a.date_creation DESC
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;

            params.push(parseInt(limit), offset);

            const result = await pool.query(query, params);

            // Statistiques
            const stats = await pool.query(
                `SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE statut = 'PUBLIE') as publies,
                    COUNT(*) FILTER (WHERE statut = 'EN_ATTENTE') as en_attente,
                    AVG(note_globale) FILTER (WHERE statut = 'PUBLIE') as note_moyenne
                FROM AVIS
                WHERE auteur_id = $1`,
                [id]
            );

            res.json({
                status: 'success',
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(stats.rows[0].total)
                },
                statistiques: stats.rows[0]
            });

        } catch (error) {
            logError('Erreur récupération mes avis:', error);
            next(error);
        }
    }

    // ==================== MÉTHODES PRIVÉES ====================

    /**
     * Valider les données d'un avis
     */
    _validateAvisData(data) {
        const { entite_type, entite_id, note_globale, contenu } = data;

        if (!entite_type || !Object.values(ENTITE_REFERENCE).includes(entite_type)) {
            throw new ValidationError('Type d\'entité invalide');
        }

        if (!entite_id || entite_id <= 0) {
            throw new ValidationError('ID d\'entité invalide');
        }

        if (!note_globale || note_globale < 1 || note_globale > 5) {
            throw new ValidationError('La note globale doit être comprise entre 1 et 5');
        }

        if (contenu && contenu.length > 2000) {
            throw new ValidationError('Le contenu ne peut pas dépasser 2000 caractères');
        }

        if (contenu && contenu.length < 10) {
            throw new ValidationError('Le contenu doit contenir au moins 10 caractères');
        }
    }

    /**
     * Vérifier qu'une entité existe
     */
    async _checkEntityExists(client, entite_type, entite_id) {
        const tables = {
            'PLATEFORME': 'PLATEFORME',
            'COMPAGNIE_TRANSPORT': 'COMPAGNIESTRANSPORT',
            'EMPLACEMENT_TRANSPORT': 'EMPLACEMENTSTRANSPORT',
            'RESTAURANT_FAST_FOOD': 'RESTAURANTSFASTFOOD',
            'EMPLACEMENT_RESTAURANT': 'EMPLACEMENTSRESTAURANTFASTFOOD',
            'BOUTIQUE': 'BOUTIQUES',
            'PRODUIT_BOUTIQUE': 'PRODUITSBOUTIQUE',
            'MENU': 'MENURESTAURANTFASTFOOD',
            'COMPTE': 'COMPTES',
            'LIVREUR': 'LIVREURS',
            'SERVICE_TRANSPORT': 'SERVICES'
        };

        const table = tables[entite_type];
        if (!table) {
            throw new ValidationError(`Type d'entité ${entite_type} non supporté pour les avis`);
        }

        const result = await client.query(
            `SELECT id FROM ${table} WHERE id = $1`,
            [entite_id]
        );

        if (result.rows.length === 0) {
            throw new ValidationError(`${entite_type} avec ID ${entite_id} non trouvé`);
        }
    }

    /**
     * Vérifier les doublons d'avis
     */
    async _checkDuplicateAvis(client, entite_type, entite_id, auteur_id, commande_id) {
        let query = `
            SELECT id FROM AVIS 
            WHERE entite_type = $1 
            AND entite_id = $2 
            AND auteur_id = $3
            AND statut != 'SUPPRIME'
        `;
        const params = [entite_type, entite_id, auteur_id];

        if (commande_id) {
            query += ` AND commande_id = $4`;
            params.push(commande_id);
        }

        const result = await client.query(query, params);

        if (result.rows.length > 0) {
            throw new ValidationError('Vous avez déjà donné un avis pour cette entité');
        }
    }

    /**
     * Valider qu'une commande est terminée
     */
    async _validateCommande(client, commande_type, commande_id, auteur_id) {
        let table, dateField, statutField;

        if (commande_type === 'RESTAURANT_FAST_FOOD') {
            table = 'COMMANDESEMPLACEMENTFASTFOOD';
            dateField = 'date_commande';
            statutField = 'statut_commande';
        } else if (commande_type === 'BOUTIQUE') {
            table = 'COMMANDESBOUTIQUES';
            dateField = 'date_commande';
            statutField = 'statut_commande';
        } else {
            throw new ValidationError('Type de commande invalide');
        }

        const result = await client.query(
            `SELECT id, ${statutField}, ${dateField}
             FROM ${table}
             WHERE id = $1 AND compte_id = $2`,
            [commande_id, auteur_id]
        );

        if (result.rows.length === 0) {
            throw new ValidationError('Commande non trouvée ou ne vous appartient pas');
        }

        const commande = result.rows[0];

        if (!['LIVREE', 'RECUPEREE'].includes(commande[statutField])) {
            throw new ValidationError('Vous ne pouvez donner un avis que sur une commande terminée');
        }

        // Vérifier que la commande date de moins de 30 jours
        const joursDepuisCommande = (Date.now() - new Date(commande[dateField])) / (1000 * 60 * 60 * 24);
        if (joursDepuisCommande > 30) {
            throw new ValidationError('Les commandes de plus de 30 jours ne peuvent plus être évaluées');
        }
    }

    /**
     * Mettre à jour la note moyenne d'une entité
     */
    async _updateEntityAverageRating(client, entite_type, entite_id) {
        // Rafraîchir la vue matérialisée des notes moyennes
        await client.query(
            `REFRESH MATERIALIZED VIEW CONCURRENTLY VUE_NOTES_MOYENNES`
        );
    }

    /**
     * Notifier le propriétaire d'une entité
     */
    async _notifyEntityOwner(client, entite_type, entite_id, avis) {
        let ownerId = null;

        switch (entite_type) {
            case 'BOUTIQUE':
                const boutique = await client.query(
                    'SELECT proprietaire_id FROM BOUTIQUES WHERE id = $1',
                    [entite_id]
                );
                ownerId = boutique.rows[0]?.proprietaire_id;
                break;
            case 'RESTAURANT_FAST_FOOD':
                const restaurant = await client.query(
                    'SELECT proprietaire_id FROM RESTAURANTSFASTFOOD WHERE id = $1',
                    [entite_id]
                );
                ownerId = restaurant.rows[0]?.proprietaire_id;
                break;
        }

        if (ownerId) {
            await NotificationService.notifyUser(ownerId, {
                type: 'NOUVEL_AVIS',
                titre: 'Nouvel avis',
                message: `Un nouvel avis ${avis.note_globale}/5 a été publié`,
                donnees: {
                    avis_id: avis.id,
                    entite_type,
                    entite_id,
                    note: avis.note_globale
                }
            });
        }
    }

    /**
     * Vérifier que l'utilisateur est propriétaire de l'entité
     */
    async _checkIsEntityOwner(client, entite_type, entite_id, user_id) {
        let query;

        switch (entite_type) {
            case 'BOUTIQUE':
                query = 'SELECT id FROM BOUTIQUES WHERE id = $1 AND proprietaire_id = $2';
                break;
            case 'RESTAURANT_FAST_FOOD':
                query = 'SELECT id FROM RESTAURANTSFASTFOOD WHERE id = $1 AND proprietaire_id = $2';
                break;
            default:
                throw new ValidationError('Seuls les avis sur boutiques et restaurants peuvent recevoir une réponse');
        }

        const result = await client.query(query, [entite_id, user_id]);

        if (result.rows.length === 0) {
            throw new AppError('Vous n\'êtes pas autorisé à répondre à cet avis', 403);
        }
    }

    /**
     * Récupérer les statistiques d'avis pour une entité
     */
    async _getAvisStats(entite_type, entite_id) {
        const result = await pool.query(
            `SELECT 
                COUNT(*) as total,
                ROUND(AVG(note_globale)::NUMERIC, 2) as moyenne,
                COUNT(*) FILTER (WHERE note_globale = 5) as cinq_etoiles,
                COUNT(*) FILTER (WHERE note_globale = 4) as quatre_etoiles,
                COUNT(*) FILTER (WHERE note_globale = 3) as trois_etoiles,
                COUNT(*) FILTER (WHERE note_globale = 2) as deux_etoiles,
                COUNT(*) FILTER (WHERE note_globale = 1) as une_etoile,
                ROUND(AVG(note_qualite)::NUMERIC, 2) as qualite_moyenne,
                ROUND(AVG(note_service)::NUMERIC, 2) as service_moyen,
                ROUND(AVG(note_rapport_prix)::NUMERIC, 2) as rapport_prix_moyen,
                ROUND(AVG(note_ponctualite)::NUMERIC, 2) as ponctualite_moyenne,
                COUNT(*) FILTER (WHERE photos_avis != '[]'::jsonb) as avec_photos
            FROM AVIS
            WHERE entite_type = $1 
            AND entite_id = $2 
            AND statut = 'PUBLIE'`,
            [entite_type, entite_id]
        );

        return result.rows[0];
    }
}

module.exports = new AvisController();