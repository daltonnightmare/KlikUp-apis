// src/controllers/adresse/AdresseController.js
const pool = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const GeoService = require('../../services/geo/GeoService');
const AuditService = require('../../services/audit/AuditService');
const CacheService = require('../../services/cache/CacheService');
const { logInfo, logError, logDebug } = require('../../configuration/logger');

class AdresseController {
    /**
     * Créer une nouvelle adresse
     * @route POST /api/v1/adresses
     * @access PRIVATE
     */
    async create(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const {
                libelle,
                ligne_1,
                ligne_2,
                quartier,
                ville,
                code_postal,
                commune,
                province,
                pays = 'Burkina Faso',
                coordonnees,
                precision_gps,
                est_principale = false,
                entite_type,
                entite_id,
                type_adresse = 'PRINCIPALE'
            } = req.body;

            // 1. VALIDATIONS
            this._validateAdresseData({
                ligne_1, ville, pays, coordonnees
            });

            // 2. GÉOCODAGE SI NÉCESSAIRE
            let geom = coordonnees;
            if (!coordonnees && ligne_1 && ville) {
                try {
                    const adresseComplete = `${ligne_1}, ${ville}, ${pays}`;
                    geom = await GeoService.geocode(adresseComplete);
                    logDebug(`Adresse géocodée: ${adresseComplete} -> ${JSON.stringify(geom)}`);
                } catch (geoError) {
                    logWarn('Échec du géocodage:', geoError);
                    // On continue sans coordonnées
                }
            }

            // 3. CRÉATION DE L'ADRESSE
            const result = await client.query(
                `INSERT INTO ADRESSES (
                    libelle, ligne_1, ligne_2, quartier, ville, code_postal,
                    commune, province, pays, coordonnees, precision_gps,
                    est_verifiee, date_creation, date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
                RETURNING *`,
                [
                    libelle || null,
                    ligne_1,
                    ligne_2 || null,
                    quartier || null,
                    ville,
                    code_postal || null,
                    commune || null,
                    province || null,
                    pays,
                    geom || null,
                    precision_gps || null,
                    !!geom // est_verifiee si on a des coordonnées
                ]
            );

            const adresse = result.rows[0];

            // 4. LIER L'ADRESSE À UNE ENTITÉ SI SPÉCIFIÉ
            if (entite_type && entite_id) {
                await this._linkAdresseToEntity(client, adresse.id, {
                    entite_type,
                    entite_id,
                    type_adresse,
                    est_principale
                });
            }

            // 5. SI C'EST L'ADRESSE PRINCIPALE, METTRE À JOUR LES AUTRES
            if (est_principale && entite_type && entite_id) {
                await this._setAsPrincipal(client, entite_type, entite_id, adresse.id, type_adresse);
            }

            // 6. AUDIT LOG
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'ADRESSE',
                ressource_id: adresse.id,
                donnees_apres: adresse,
                metadata: { entite_type, entite_id, type_adresse },
                utilisateur_id: req.user?.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            // 7. INVALIDATION CACHE
            if (entite_type && entite_id) {
                await CacheService.delPattern(`adresses:${entite_type}:${entite_id}:*`);
            }

            logInfo(`Adresse créée: ${adresse.id} - ${ligne_1}, ${ville}`);

            res.status(201).json({
                status: 'success',
                data: adresse
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur création adresse:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer une adresse par ID
     * @route GET /api/v1/adresses/:id
     * @access PRIVATE
     */
    async findById(req, res, next) {
        try {
            const { id } = req.params;

            // Vérification cache
            const cacheKey = `adresse:${id}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    status: 'success',
                    data: cached,
                    from_cache: true
                });
            }

            const result = await pool.query(
                `SELECT 
                    a.*,
                    ST_AsGeoJSON(a.coordonnees) as coordonnees_geojson,
                    ST_X(a.coordonnees) as longitude,
                    ST_Y(a.coordonnees) as latitude,
                    (
                        SELECT json_agg(json_build_object(
                            'entite_type', ae.entite_type,
                            'entite_id', ae.entite_id,
                            'type_adresse', ae.type_adresse,
                            'est_actif', ae.est_actif
                        ))
                        FROM ADRESSES_ENTITES ae
                        WHERE ae.adresse_id = a.id
                    ) as entites_liees
                FROM ADRESSES a
                WHERE a.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Adresse non trouvée', 404);
            }

            const adresse = result.rows[0];

            // Mise en cache (1 heure)
            await CacheService.set(cacheKey, adresse, 3600);

            res.json({
                status: 'success',
                data: adresse
            });

        } catch (error) {
            logError('Erreur récupération adresse:', error);
            next(error);
        }
    }

    /**
     * Récupérer les adresses d'une entité
     * @route GET /api/v1/adresses/entite/:type/:id
     * @access PUBLIC
     */
    async findByEntity(req, res, next) {
        try {
            const { type, id } = req.params;
            const { type_adresse, actif = true } = req.query;

            // Vérification cache
            const cacheKey = `adresses:${type}:${id}:${type_adresse || 'all'}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    status: 'success',
                    data: cached,
                    from_cache: true
                });
            }

            let query = `
                SELECT 
                    a.*,
                    ae.type_adresse,
                    ae.est_actif,
                    ae.date_ajout,
                    ST_AsGeoJSON(a.coordonnees) as coordonnees_geojson,
                    ST_X(a.coordonnees) as longitude,
                    ST_Y(a.coordonnees) as latitude
                FROM ADRESSES a
                JOIN ADRESSES_ENTITES ae ON ae.adresse_id = a.id
                WHERE ae.entite_type = $1 
                AND ae.entite_id = $2
            `;
            const params = [type, id];

            if (type_adresse) {
                query += ` AND ae.type_adresse = $3`;
                params.push(type_adresse);
            }

            if (actif === 'true') {
                query += ` AND ae.est_actif = true`;
            }

            query += ` ORDER BY 
                CASE ae.type_adresse
                    WHEN 'PRINCIPALE' THEN 1
                    WHEN 'FACTURATION' THEN 2
                    WHEN 'LIVRAISON' THEN 3
                    ELSE 4
                END,
                ae.date_ajout DESC`;

            const result = await pool.query(query, params);

            // Trouver l'adresse principale
            const principale = result.rows.find(a => a.type_adresse === 'PRINCIPALE');

            // Mise en cache (5 minutes)
            await CacheService.set(cacheKey, {
                adresses: result.rows,
                principale
            }, 300);

            res.json({
                status: 'success',
                data: result.rows,
                meta: {
                    totale: result.rows.length,
                    principale: principale || null
                }
            });

        } catch (error) {
            logError('Erreur récupération adresses entité:', error);
            next(error);
        }
    }

    /**
     * Mettre à jour une adresse
     * @route PUT /api/v1/adresses/:id
     * @access PRIVATE
     */
    async update(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const updates = req.body;

            // Récupération de l'adresse existante
            const adresseExistante = await client.query(
                'SELECT * FROM ADRESSES WHERE id = $1',
                [id]
            );

            if (adresseExistante.rows.length === 0) {
                throw new AppError('Adresse non trouvée', 404);
            }

            const ancienneAdresse = adresseExistante.rows[0];

            // Validation des champs modifiés
            const champsAutorises = [
                'libelle', 'ligne_1', 'ligne_2', 'quartier', 'ville',
                'code_postal', 'commune', 'province', 'pays',
                'coordonnees', 'precision_gps'
            ];

            const setClauses = [];
            const values = [id];
            const modifications = {};

            for (const champ of champsAutorises) {
                if (updates[champ] !== undefined) {
                    // Validation spécifique
                    if (champ === 'ligne_1' && (!updates[champ] || updates[champ].length < 3)) {
                        throw new ValidationError('La ligne 1 doit contenir au moins 3 caractères');
                    }

                    setClauses.push(`${champ} = $${values.length + 1}`);
                    values.push(updates[champ]);
                    modifications[champ] = {
                        avant: ancienneAdresse[champ],
                        apres: updates[champ]
                    };
                }
            }

            // Si les coordonnées ont été modifiées, mettre à jour le statut de vérification
            if (updates.coordonnees) {
                setClauses.push(`est_verifiee = true`);
            }

            if (setClauses.length === 0) {
                throw new ValidationError('Aucune modification détectée');
            }

            setClauses.push('date_mise_a_jour = NOW()');

            const query = `
                UPDATE ADRESSES 
                SET ${setClauses.join(', ')}
                WHERE id = $1
                RETURNING *
            `;

            const result = await client.query(query, values);
            const adresseMaj = result.rows[0];

            // Audit
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'ADRESSE',
                ressource_id: id,
                donnees_avant: ancienneAdresse,
                donnees_apres: adresseMaj,
                modifications,
                utilisateur_id: req.user?.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.del(`adresse:${id}`);
            await CacheService.delPattern(`adresses:*`);

            logInfo(`Adresse mise à jour: ${id}`);

            res.json({
                status: 'success',
                data: adresseMaj
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur mise à jour adresse:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer une adresse (soft delete)
     * @route DELETE /api/v1/adresses/:id
     * @access ADMINISTRATEUR_PLATEFORME, PROPRIETAIRE
     */
    async delete(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            // Vérifier si l'adresse est utilisée
            const utilisations = await client.query(
                `SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE commande_id IS NOT NULL) as commandes
                FROM (
                    SELECT id as commande_id FROM COMMANDESBOUTIQUES WHERE adresse_livraison_id = $1
                    UNION ALL
                    SELECT id FROM COMMANDESEMPLACEMENTFASTFOOD WHERE adresse_livraison_id = $1
                ) as utilisations`,
                [id]
            );

            if (parseInt(utilisations.rows[0].commandes) > 0) {
                throw new ValidationError('Cette adresse est utilisée par des commandes et ne peut pas être supprimée');
            }

            // Supprimer les liens
            await client.query(
                'DELETE FROM ADRESSES_ENTITES WHERE adresse_id = $1',
                [id]
            );

            // Supprimer l'adresse
            await client.query('DELETE FROM ADRESSES WHERE id = $1', [id]);

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.del(`adresse:${id}`);
            await CacheService.delPattern(`adresses:*`);

            logInfo(`Adresse supprimée: ${id}`);

            res.json({
                status: 'success',
                message: 'Adresse supprimée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur suppression adresse:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Lier une adresse à une entité
     * @route POST /api/v1/adresses/:id
     * @access PRIVATE
     */
    async linkToEntity(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const {
                entite_type,
                entite_id,
                type_adresse = 'SECONDAIRE',
                est_principale = false
            } = req.body;

            // Vérifier que l'adresse existe
            const adresse = await client.query(
                'SELECT id FROM ADRESSES WHERE id = $1',
                [id]
            );

            if (adresse.rows.length === 0) {
                throw new AppError('Adresse non trouvée', 404);
            }

            // Vérifier que l'entité existe
            await this._checkEntityExists(client, entite_type, entite_id);

            // Vérifier si le lien existe déjà
            const lienExistant = await client.query(
                `SELECT id FROM ADRESSES_ENTITES 
                 WHERE adresse_id = $1 AND entite_type = $2 AND entite_id = $3`,
                [id, entite_type, entite_id]
            );

            if (lienExistant.rows.length > 0) {
                throw new ValidationError('Cette adresse est déjà liée à cette entité');
            }

            // Créer le lien
            const result = await client.query(
                `INSERT INTO ADRESSES_ENTITES 
                 (adresse_id, entite_type, entite_id, type_adresse, est_actif, date_ajout)
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 RETURNING *`,
                [id, entite_type, entite_id, type_adresse, true]
            );

            // Si c'est l'adresse principale, mettre à jour les autres
            if (est_principale) {
                await this._setAsPrincipal(client, entite_type, entite_id, id, type_adresse);
            }

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`adresses:${entite_type}:${entite_id}:*`);

            res.json({
                status: 'success',
                data: result.rows[0],
                message: 'Adresse liée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur liaison adresse:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Délier une adresse d'une entité
     * @route DELETE /api/v1/adresses/:id/delier/:entite_type/:entite_id
     * @access PRIVATE
     */
    async unlinkFromEntity(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id, entite_type, entite_id } = req.params;

            // Vérifier que c'est pas l'adresse principale
            const lien = await client.query(
                `SELECT type_adresse FROM ADRESSES_ENTITES 
                 WHERE adresse_id = $1 AND entite_type = $2 AND entite_id = $3`,
                [id, entite_type, entite_id]
            );

            if (lien.rows.length === 0) {
                throw new AppError('Lien non trouvé', 404);
            }

            if (lien.rows[0].type_adresse === 'PRINCIPALE') {
                throw new ValidationError('Impossible de supprimer l\'adresse principale');
            }

            await client.query(
                `DELETE FROM ADRESSES_ENTITES 
                 WHERE adresse_id = $1 AND entite_type = $2 AND entite_id = $3`,
                [id, entite_type, entite_id]
            );

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`adresses:${entite_type}:${entite_id}:*`);

            res.json({
                status: 'success',
                message: 'Adresse déliée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur déliaison adresse:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Définir une adresse comme principale
     * @route POST /api/v1/adresses/:id/principale
     * @access PRIVATE
     */
    async setAsPrincipal(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { entite_type, entite_id } = req.body;

            await this._setAsPrincipal(client, entite_type, entite_id, id);

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`adresses:${entite_type}:${entite_id}:*`);

            res.json({
                status: 'success',
                message: 'Adresse principale définie avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur définition adresse principale:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Valider une adresse (géocodage)
     * @route POST /api/v1/adresses/:id/valider
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async validate(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            const adresse = await client.query(
                'SELECT * FROM ADRESSES WHERE id = $1',
                [id]
            );

            if (adresse.rows.length === 0) {
                throw new AppError('Adresse non trouvée', 404);
            }

            const adr = adresse.rows[0];

            // Re-géocoder
            const adresseComplete = `${adr.ligne_1}, ${adr.ville}, ${adr.pays}`;
            const coordonnees = await GeoService.geocode(adresseComplete);

            await client.query(
                `UPDATE ADRESSES 
                 SET coordonnees = $1,
                     est_verifiee = true,
                     date_mise_a_jour = NOW()
                 WHERE id = $2`,
                [coordonnees, id]
            );

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.del(`adresse:${id}`);

            res.json({
                status: 'success',
                message: 'Adresse validée avec succès',
                data: { coordonnees }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur validation adresse:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Rechercher des adresses
     * @route GET /api/v1/adresses/search
     * @access PUBLIC
     */
    async search(req, res, next) {
        try {
            const {
                q,
                ville,
                quartier,
                code_postal,
                pays = 'Burkina Faso',
                limit = 20,
                page = 1
            } = req.query;

            const offset = (page - 1) * limit;
            const params = [];
            let paramIndex = 1;
            const conditions = [];

            if (q) {
                conditions.push(`(
                    ligne_1 ILIKE $${paramIndex} OR
                    ligne_2 ILIKE $${paramIndex} OR
                    quartier ILIKE $${paramIndex} OR
                    ville ILIKE $${paramIndex}
                )`);
                params.push(`%${q}%`);
                paramIndex++;
            }

            if (ville) {
                conditions.push(`ville ILIKE $${paramIndex}`);
                params.push(`%${ville}%`);
                paramIndex++;
            }

            if (quartier) {
                conditions.push(`quartier ILIKE $${paramIndex}`);
                params.push(`%${quartier}%`);
                paramIndex++;
            }

            if (code_postal) {
                conditions.push(`code_postal = $${paramIndex}`);
                params.push(code_postal);
                paramIndex++;
            }

            if (pays) {
                conditions.push(`pays = $${paramIndex}`);
                params.push(pays);
                paramIndex++;
            }

            const whereClause = conditions.length > 0 
                ? 'WHERE ' + conditions.join(' AND ')
                : '';

            const query = `
                SELECT 
                    id,
                    libelle,
                    ligne_1,
                    ligne_2,
                    quartier,
                    ville,
                    code_postal,
                    pays,
                    ST_AsGeoJSON(coordonnees) as coordonnees,
                    est_verifiee,
                    date_creation
                FROM ADRESSES
                ${whereClause}
                ORDER BY 
                    CASE WHEN est_verifiee THEN 0 ELSE 1 END,
                    date_creation DESC
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;

            params.push(parseInt(limit), offset);

            const result = await pool.query(query, params);

            // Comptage
            let countQuery = `SELECT COUNT(*) FROM ADRESSES ${whereClause}`;
            const countResult = await pool.query(countQuery, params.slice(0, -2));
            const total = parseInt(countResult.rows[0].count);

            res.json({
                status: 'success',
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            });

        } catch (error) {
            logError('Erreur recherche adresses:', error);
            next(error);
        }
    }

    // ==================== MÉTHODES PRIVÉES ====================

    /**
     * Valider les données d'une adresse
     */
    _validateAdresseData(data) {
        const { ligne_1, ville, pays, coordonnees } = data;

        if (!ligne_1 || ligne_1.length < 3) {
            throw new ValidationError('La ligne 1 doit contenir au moins 3 caractères');
        }

        if (!ville || ville.length < 2) {
            throw new ValidationError('La ville doit contenir au moins 2 caractères');
        }

        if (!pays) {
            throw new ValidationError('Le pays est requis');
        }

        if (coordonnees) {
            if (!Array.isArray(coordonnees) || coordonnees.length !== 2) {
                throw new ValidationError('Les coordonnées doivent être un tableau [longitude, latitude]');
            }
            if (coordonnees[0] < -180 || coordonnees[0] > 180 || 
                coordonnees[1] < -90 || coordonnees[1] > 90) {
                throw new ValidationError('Coordonnées invalides');
            }
        }
    }

    /**
     * Lier une adresse à une entité
     */
    async _linkAdresseToEntity(client, adresseId, data) {
        const { entite_type, entite_id, type_adresse, est_principale } = data;

        await client.query(
            `INSERT INTO ADRESSES_ENTITES 
             (adresse_id, entite_type, entite_id, type_adresse, est_actif, date_ajout)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [adresseId, entite_type, entite_id, type_adresse, true]
        );

        if (est_principale) {
            await this._setAsPrincipal(client, entite_type, entite_id, adresseId, type_adresse);
        }
    }

    /**
     * Définir une adresse comme principale
     */
    async _setAsPrincipal(client, entite_type, entite_id, adresseId, typeAdresse = 'PRINCIPALE') {
        // Retirer le statut principal des autres adresses
        await client.query(
            `UPDATE ADRESSES_ENTITES 
             SET type_adresse = 'SECONDAIRE'
             WHERE entite_type = $1 
             AND entite_id = $2 
             AND type_adresse = 'PRINCIPALE'`,
            [entite_type, entite_id]
        );

        // Définir la nouvelle adresse principale
        await client.query(
            `UPDATE ADRESSES_ENTITES 
             SET type_adresse = 'PRINCIPALE'
             WHERE adresse_id = $1 
             AND entite_type = $2 
             AND entite_id = $3`,
            [adresseId, entite_type, entite_id]
        );
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
            'COMPTE': 'COMPTES',
            'LIVREUR': 'LIVREURS'
        };

        const table = tables[entite_type];
        if (!table) {
            throw new ValidationError(`Type d'entité invalide: ${entite_type}`);
        }

        const result = await client.query(
            `SELECT id FROM ${table} WHERE id = $1`,
            [entite_id]
        );

        if (result.rows.length === 0) {
            throw new ValidationError(`${entite_type} avec ID ${entite_id} non trouvé`);
        }
    }
}

module.exports = new AdresseController();