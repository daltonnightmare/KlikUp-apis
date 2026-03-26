// src/controllers/boutique/ProduitBoutiqueController.js
const db = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const FileService = require('../../services/file/FileService');
const AuditService = require('../../services/audit/AuditService');
const NotificationService = require('../../services/notification/NotificationService');
const CacheService = require('../../services/cache/CacheService');
const { logInfo, logError, logDebug } = require('../../configuration/logger');

class ProduitBoutiqueController {
    /**
     * Créer un nouveau produit
     * @route POST /api/v1/boutiques/:boutiqueId/produits
     * @access ADMINISTRATEUR_PLATEFORME, PROPRIETAIRE_BOUTIQUE, STAFF_BOUTIQUE
     */
    async create(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            
            const { boutiqueId } = req.params;
            const {
                nom_produit,
                slug_produit,
                description_produit,
                donnees_supplementaires,
                prix_unitaire_produit,
                prix_promo,
                quantite = -1,
                id_categorie,
                est_disponible = true,
                meta_data = {}
            } = req.body;

            // 1. VALIDATIONS AVANCÉES
            await this._validateProductData({
                nom_produit,
                prix_unitaire_produit,
                prix_promo,
                quantite,
                boutiqueId,
                id_categorie
            }, client);

            // 2. VÉRIFICATION BOUTIQUE
            const boutique = await this._checkBoutiqueExists(client, boutiqueId);

            // 3. GÉNÉRATION SLUG UNIQUE
            const finalSlug = await this._generateUniqueSlug(client, slug_produit || nom_produit, boutiqueId);

            // 4. GESTION DES IMAGES
            const { image_principale, images_gallery } = await this._handleImageUploads(req.files, boutiqueId);

            // 5. PRÉPARATION DONNÉES SUPPLÉMENTAIRES
            const donneesSuppl = {
                ...donnees_supplementaires,
                meta: meta_data,
                created_from_ip: req.ip,
                created_by: req.user?.id
            };

            // 6. CRÉATION DU PRODUIT
            const result = await client.query(
                `INSERT INTO PRODUITSBOUTIQUE (
                    nom_produit,
                    slug_produit,
                    image_produit,
                    images_produit,
                    description_produit,
                    donnees_supplementaires,
                    prix_unitaire_produit,
                    prix_promo,
                    quantite,
                    id_categorie,
                    id_boutique,
                    est_disponible,
                    date_creation,
                    date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
                RETURNING *`,
                [
                    nom_produit,
                    finalSlug,
                    image_principale,
                    JSON.stringify(images_gallery),
                    description_produit || null,
                    JSON.stringify(donneesSuppl),
                    prix_unitaire_produit,
                    prix_promo || null,
                    quantite,
                    id_categorie,
                    boutiqueId,
                    est_disponible
                ]
            );

            const nouveauProduit = result.rows[0];

            // 7. MISE À JOUR DU COMPTEUR DE PRODUITS DANS LA CATÉGORIE
            await this._updateCategoryProductCount(client, id_categorie);

            // 8. INVALIDATION DU CACHE
            await this._invalidateProductCache(boutiqueId, id_categorie);

            // 9. AUDIT LOG
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'PRODUIT_BOUTIQUE',
                ressource_id: nouveauProduit.id,
                donnees_apres: nouveauProduit,
                utilisateur_id: req.user?.id,
                adresse_ip: req.ip,
                metadata: { boutique_id: boutiqueId }
            });

            // 10. NOTIFICATION AU PROPRIÉTAIRE (optionnel)
            if (boutique.notify_on_new_product) {
                await NotificationService.notifyBoutiqueStaff(boutiqueId, {
                    type: 'NOUVEAU_PRODUIT',
                    titre: 'Nouveau produit ajouté',
                    message: `${nom_produit} a été ajouté au catalogue`,
                    donnees: { produit_id: nouveauProduit.id }
                });
            }

            await client.query('COMMIT');

            logInfo(`Produit créé: ${nouveauProduit.id} - ${nom_produit} pour boutique ${boutiqueId}`);

            res.status(201).json({
                status: 'success',
                data: nouveauProduit
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur création produit:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer tous les produits d'une boutique avec filtres avancés
     * @route GET /api/v1/boutiques/:boutiqueId/produits
     * @access PUBLIC
     */
    async findAll(req, res, next) {
        const client = await db.getClient();
        try {
            const { boutiqueId } = req.params;
            const {
                page = 1,
                limit = 20,
                categorie_id,
                search,
                prix_min,
                prix_max,
                en_promo,
                disponible,
                tri = 'date_creation_desc',
                avec_stock,
                avec_categorie,
                tags,
                fourchette_prix,
                en_rupture,
                nouveau_produit_jours = 30
            } = req.query;

            const offset = (page - 1) * limit;
            const params = [boutiqueId];
            let paramIndex = 2;
            const conditions = ['p.id_boutique = $1'];

            // 1. CONSTRUCTION DYNAMIQUE DES FILTRES
            if (categorie_id) {
                conditions.push(`p.id_categorie = $${paramIndex}`);
                params.push(categorie_id);
                paramIndex++;
            }

            if (search) {
                conditions.push(`(
                    p.nom_produit ILIKE $${paramIndex} 
                    OR p.description_produit ILIKE $${paramIndex}
                    OR p.slug_produit ILIKE $${paramIndex}
                )`);
                params.push(`%${search}%`);
                paramIndex++;
            }

            if (prix_min) {
                conditions.push(`p.prix_unitaire_produit >= $${paramIndex}`);
                params.push(parseFloat(prix_min));
                paramIndex++;
            }

            if (prix_max) {
                conditions.push(`p.prix_unitaire_produit <= $${paramIndex}`);
                params.push(parseFloat(prix_max));
                paramIndex++;
            }

            if (en_promo === 'true') {
                conditions.push(`p.prix_promo IS NOT NULL AND p.prix_promo < p.prix_unitaire_produit`);
            }

            if (disponible !== undefined) {
                conditions.push(`p.est_disponible = $${paramIndex}`);
                params.push(disponible === 'true');
                paramIndex++;
            }

            if (en_rupture === 'true') {
                conditions.push(`p.quantite = 0`);
            }

            if (tags) {
                const tagsArray = tags.split(',');
                conditions.push(`p.donnees_supplementaires->'tags' ?| $${paramIndex}`);
                params.push(tagsArray);
                paramIndex++;
            }

            if (nouveau_produit_jours) {
                conditions.push(`p.date_creation >= NOW() - INTERVAL '${nouveau_produit_jours} days'`);
            }

            // 2. CONSTRUCTION DE LA REQUÊTE AVEC CHAMPS DYNAMIQUES
            let selectFields = `
                p.*,
                c.nom_categorie,
                c.slug_categorie as categorie_slug
            `;

            if (avec_stock === 'true') {
                selectFields += `,
                    CASE 
                        WHEN p.quantite = -1 THEN 'illimité'
                        WHEN p.quantite = 0 THEN 'rupture'
                        WHEN p.quantite <= 5 THEN 'stock_faible'
                        ELSE 'disponible'
                    END as statut_stock,
                    p.quantite as stock_actuel`;
            }

            // 3. REQUÊTE PRINCIPALE
            const query = `
                SELECT ${selectFields}
                FROM PRODUITSBOUTIQUE p
                LEFT JOIN CATEGORIES_BOUTIQUE c ON c.id = p.id_categorie
                WHERE ${conditions.join(' AND ')}
                ${this._buildOrderBy(tri)}
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;

            params.push(parseInt(limit), offset);

            const result = await client.query(query, params);

            // 4. COMPTAGE TOTAL
            let countQuery = `
                SELECT COUNT(*) 
                FROM PRODUITSBOUTIQUE p
                WHERE ${conditions.join(' AND ')}
            `;
            const countResult = await client.query(countQuery, params.slice(0, -2));
            const total = parseInt(countResult.rows[0].count);

            // 5. AGRÉGATION DES FILTRES POUR RÉPONSE
            const filters = await this._getAvailableFilters(client, boutiqueId);

            // 6. ENRICHISSEMENT DES PRODUITS (optionnel)
            let produits = result.rows;
            if (fourchette_prix) {
                produits = this._addPriceRanges(produits);
            }

            res.json({
                status: 'success',
                data: produits,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit),
                    has_next: offset + limit < total,
                    has_prev: page > 1
                },
                filters: filters,
                summary: produits.length > 0 ? {
                    total_produits: total,
                    produits_disponibles: produits.filter(p => p.est_disponible).length,
                    prix_min: Math.min(...produits.map(p => p.prix_unitaire_produit)),
                    prix_max: Math.max(...produits.map(p => p.prix_unitaire_produit))
                } : {
                    total_produits: 0,
                    produits_disponibles: 0,
                    prix_min: 0,
                    prix_max: 0
                }
            });

        } catch (error) {
            logError('Erreur récupération produits:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer un produit par son ID ou slug avec toutes ses données
     * @route GET /api/v1/produits/:identifier
     * @access PUBLIC
     */
    async findById(req, res, next) {
        const client = await db.getClient();
        try {
            const { identifier } = req.params;
            const { inclure_avis, inclure_similaires, inclure_recommandations } = req.query;

            // 1. TENTATIVE DE RÉCUPÉRATION DU CACHE
            const cacheKey = `produit:${identifier}:${inclure_avis}:${inclure_similaires}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                logDebug(`Cache hit pour produit ${identifier}`);
                return res.json({
                    status: 'success',
                    data: cached,
                    from_cache: true
                });
            }

            // 2. RECHERCHE DU PRODUIT
            const query = isNaN(identifier)
                ? 'SELECT * FROM PRODUITSBOUTIQUE WHERE slug_produit = $1'
                : 'SELECT * FROM PRODUITSBOUTIQUE WHERE id = $1';

            const result = await client.query(query, [identifier]);

            if (result.rows.length === 0) {
                throw new AppError('Produit non trouvé', 404);
            }

            const produit = result.rows[0];

            // 3. CHARGEMENT PARALLÈLE DES DONNÉES ASSOCIÉES
            const [
                categorie,
                boutique,
                avis,
                statistiquesAvis,
                produitsSimilaires,
                recommandations,
                questionsReponses
            ] = await Promise.all([
                this._getCategorie(client, produit.id_categorie),
                this._getBoutique(client, produit.id_boutique),
                inclure_avis === 'true' ? this._getAvisProduit(client, produit.id) : [],
                inclure_avis === 'true' ? this._getStatsAvis(client, produit.id) : null,
                inclure_similaires === 'true' ? this._getProduitsSimilaires(client, produit) : [],
                inclure_recommandations === 'true' ? this._getRecommandations(client, produit) : [],
                this._getQuestionsReponses(client, produit.id)
            ]);

            // 4. ENRICHISSEMENT DES DONNÉES
            const produitEnrichi = {
                ...produit,
                images_produit: produit.images_produit || [],
                donnees_supplementaires: produit.donnees_supplementaires || {},
                categorie: categorie,
                boutique: {
                    id: boutique.id,
                    nom: boutique.nom_boutique,
                    logo: boutique.logo_boutique,
                    est_actif: boutique.est_actif
                },
                avis: avis,
                statistiques_avis: statistiquesAvis,
                produits_similaires: produitsSimilaires,
                recommandations: recommandations,
                questions_reponses: questionsReponses,
                meta: {
                    prix_avec_promo: produit.prix_promo || produit.prix_unitaire_produit,
                    economie: produit.prix_promo ? produit.prix_unitaire_produit - produit.prix_promo : 0,
                    pourcentage_reduction: produit.prix_promo 
                        ? Math.round((1 - produit.prix_promo / produit.prix_unitaire_produit) * 100) 
                        : 0,
                    stock_status: this._getStockStatus(produit.quantite),
                    est_nouveau: this._isNewProduct(produit.date_creation)
                }
            };

            // 5. MISE EN CACHE
            await CacheService.set(cacheKey, produitEnrichi, 300); // 5 minutes

            // 6. INCRÉMENTATION COMPTEUR VUES (asynchrone - ne pas attendre)
            this._incrementViewCount(produit.id).catch(err => 
                logError('Erreur incrémentation vues:', err)
            );

            res.json({
                status: 'success',
                data: produitEnrichi
            });

        } catch (error) {
            logError('Erreur récupération produit:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour un produit
     * @route PUT /api/v1/produits/:id
     * @access ADMINISTRATEUR_PLATEFORME, PROPRIETAIRE_BOUTIQUE, STAFF_BOUTIQUE
     */
    async update(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const updates = req.body;

            // 1. VÉRIFICATION PRODUIT
            const ancienProduit = await this._checkProductExists(client, id);

            // 2. VALIDATIONS SPÉCIFIQUES
            await this._validateProductUpdate(updates, ancienProduit, client);

            // 3. PRÉPARATION DE LA MISE À JOUR
            const { setClauses, values } = await this._buildProductUpdateQuery(
                updates, 
                req.files, 
                ancienProduit,
                client
            );

            if (setClauses.length === 0) {
                throw new ValidationError('Aucune donnée à mettre à jour');
            }

            setClauses.push('date_mise_a_jour = NOW()');

            // 4. EXÉCUTION MISE À JOUR
            const query = `
                UPDATE PRODUITSBOUTIQUE 
                SET ${setClauses.join(', ')}
                WHERE id = $1
                RETURNING *
            `;

            const result = await client.query(query, [id, ...values]);
            const produitMaj = result.rows[0];

            // 5. GESTION DES CHANGEMENTS DE CATÉGORIE
            if (updates.id_categorie && updates.id_categorie !== ancienProduit.id_categorie) {
                await this._updateCategoryProductCount(client, ancienProduit.id_categorie);
                await this._updateCategoryProductCount(client, updates.id_categorie);
            }

            // 6. HISTORIQUE DES MODIFICATIONS
            await this._saveProductHistory(client, ancienProduit, produitMaj, req.user?.id);

            // 7. INVALIDATION DU CACHE
            await this._invalidateProductCache(ancienProduit.id_boutique, ancienProduit.id_categorie);
            await CacheService.del(`produit:${id}:*`);

            // 8. AUDIT LOG
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'PRODUIT_BOUTIQUE',
                ressource_id: id,
                donnees_avant: ancienProduit,
                donnees_apres: produitMaj,
                utilisateur_id: req.user?.id,
                adresse_ip: req.ip,
                champs_modifies: Object.keys(updates)
            });

            // 9. NOTIFICATION SI CHANGEMENT IMPORTANT
            if (updates.prix_unitaire_produit && updates.prix_unitaire_produit !== ancienProduit.prix_unitaire_produit) {
                await this._notifyPriceChange(ancienProduit, produitMaj);
            }

            await client.query('COMMIT');

            logInfo(`Produit mis à jour: ${id} par utilisateur ${req.user?.id}`);

            res.json({
                status: 'success',
                data: produitMaj,
                message: 'Produit mis à jour avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur mise à jour produit:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour le stock d'un produit
     * @route PATCH /api/v1/produits/:id/stock
     * @access ADMINISTRATEUR_PLATEFORME, PROPRIETAIRE_BOUTIQUE, STAFF_BOUTIQUE
     */
    async updateStock(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { quantite, operation = 'set', motif, seuil_alerte = 5 } = req.body;

            if (quantite === undefined) {
                throw new ValidationError('La quantité est requise');
            }

            // 1. RÉCUPÉRATION PRODUIT
            const produit = await client.query(
                'SELECT * FROM PRODUITSBOUTIQUE WHERE id = $1',
                [id]
            );

            if (produit.rows.length === 0) {
                throw new AppError('Produit non trouvé', 404);
            }

            const ancienProduit = produit.rows[0];
            let nouvelleQuantite;

            // 2. CALCUL DE LA NOUVELLE QUANTITÉ
            switch (operation) {
                case 'add':
                    nouvelleQuantite = ancienProduit.quantite === -1 ? -1 : ancienProduit.quantite + quantite;
                    break;
                case 'subtract':
                    nouvelleQuantite = ancienProduit.quantite === -1 ? -1 : Math.max(ancienProduit.quantite - quantite, -1);
                    break;
                case 'set':
                default:
                    nouvelleQuantite = quantite;
            }

            // 3. MISE À JOUR
            const result = await client.query(
                `UPDATE PRODUITSBOUTIQUE 
                SET quantite = $1, 
                    date_mise_a_jour = NOW()
                WHERE id = $2
                RETURNING *`,
                [nouvelleQuantite, id]
            );

            const produitMaj = result.rows[0];

            // 4. CRÉATION D'UNE ENTRÉE D'HISTORIQUE DE STOCK
            await client.query(
                `INSERT INTO HISTORIQUE_ACTIONS (
                    action_type, table_concernee, entite_id,
                    donnees_avant, donnees_apres, utilisateur_id,
                    date_action, metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
                [
                    'STOCK_UPDATE',
                    'PRODUITSBOUTIQUE',
                    id,
                    JSON.stringify({ quantite: ancienProduit.quantite }),
                    JSON.stringify({ quantite: nouvelleQuantite, operation, motif }),
                    req.user?.id,
                    JSON.stringify({ seuil_alerte, operation, motif })
                ]
            );

            // 5. VÉRIFICATION DES SEUILS ET ALERTES
            if (nouvelleQuantite !== -1 && nouvelleQuantite <= seuil_alerte) {
                await NotificationService.notifyBoutiqueStaff(ancienProduit.id_boutique, {
                    type: 'STOCK_FAIBLE',
                    titre: 'Stock faible',
                    message: `Le produit ${ancienProduit.nom_produit} n\'a plus que ${nouvelleQuantite} unités en stock`,
                    priorite: 'HAUTE',
                    donnees: {
                        produit_id: id,
                        stock_actuel: nouvelleQuantite,
                        seuil: seuil_alerte
                    }
                });
            }

            // 6. DÉSACTIVATION AUTOMATIQUE SI RUPTURE
            if (nouvelleQuantite === 0 && ancienProduit.est_disponible) {
                await client.query(
                    `UPDATE PRODUITSBOUTIQUE 
                    SET est_disponible = false
                    WHERE id = $1`,
                    [id]
                );
                produitMaj.est_disponible = false;
            }

            await client.query('COMMIT');

            // 7. INVALIDATION CACHE
            await CacheService.delPattern(`produit:${id}:*`);

            res.json({
                status: 'success',
                data: {
                    id: produitMaj.id,
                    nom: produitMaj.nom_produit,
                    quantite_avant: ancienProduit.quantite,
                    quantite_apres: nouvelleQuantite,
                    operation,
                    est_disponible: produitMaj.est_disponible,
                    seuil_atteint: nouvelleQuantite !== -1 && nouvelleQuantite <= seuil_alerte
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur mise à jour stock:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Recherche avancée de produits sur toutes les boutiques
     * @route GET /api/v1/produits/search
     * @access PUBLIC
     */
    async search(req, res, next) {
        const client = await db.getClient();
        try {
            const {
                q,
                categorie_id,
                boutique_id,
                prix_min,
                prix_max,
                en_promo,
                en_stock,
                tri = 'pertinence',
                page = 1,
                limit = 20,
                avec_boutique = true,
                geo_location,
                rayon_km = 10
            } = req.query;

            const offset = (page - 1) * limit;
            const params = [];
            let paramIndex = 1;
            const conditions = ['p.est_disponible = true'];
            let fullTextSearch = '';

            // 1. RECHERCHE PLEIN TEXTE
            if (q) {
                fullTextSearch = `
                    , ts_rank(to_tsvector('french', 
                        coalesce(p.nom_produit,'') || ' ' || 
                        coalesce(p.description_produit,'')
                    ), plainto_tsquery('french', $${paramIndex})) as rank
                `;
                conditions.push(`
                    to_tsvector('french', 
                        coalesce(p.nom_produit,'') || ' ' || 
                        coalesce(p.description_produit,'')
                    ) @@ plainto_tsquery('french', $${paramIndex})
                `);
                params.push(q);
                paramIndex++;
            }

            // 2. FILTRES
            if (categorie_id) {
                conditions.push(`p.id_categorie = $${paramIndex}`);
                params.push(categorie_id);
                paramIndex++;
            }

            if (boutique_id) {
                conditions.push(`p.id_boutique = $${paramIndex}`);
                params.push(boutique_id);
                paramIndex++;
            }

            if (prix_min) {
                conditions.push(`p.prix_unitaire_produit >= $${paramIndex}`);
                params.push(parseFloat(prix_min));
                paramIndex++;
            }

            if (prix_max) {
                conditions.push(`p.prix_unitaire_produit <= $${paramIndex}`);
                params.push(parseFloat(prix_max));
                paramIndex++;
            }

            if (en_promo === 'true') {
                conditions.push(`p.prix_promo IS NOT NULL`);
            }

            if (en_stock === 'true') {
                conditions.push(`(p.quantite = -1 OR p.quantite > 0)`);
            }

            // 3. RECHERCHE GÉOGRAPHIQUE
            let geoJoin = '';
            if (geo_location && geo_location.lat && geo_location.lng) {
                geoJoin = `
                    JOIN ADRESSES_ENTITES ae ON ae.entite_type = 'BOUTIQUE' AND ae.entite_id = p.id_boutique
                    JOIN ADRESSES a ON a.id = ae.adresse_id
                `;
                conditions.push(`
                    ST_DWithin(
                        a.coordonnees::geography,
                        ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)::geography,
                        $${paramIndex + 2} * 1000
                    )
                `);
                params.push(parseFloat(geo_location.lng), parseFloat(geo_location.lat), parseFloat(rayon_km));
                paramIndex += 3;
            }

            // 4. CONSTRUCTION REQUÊTE
            const query = `
                SELECT 
                    p.*,
                    ${avec_boutique ? 'b.nom_boutique, b.logo_boutique,' : ''}
                    c.nom_categorie,
                    c.slug_categorie
                    ${fullTextSearch}
                FROM PRODUITSBOUTIQUE p
                LEFT JOIN CATEGORIES_BOUTIQUE c ON c.id = p.id_categorie
                ${avec_boutique ? 'LEFT JOIN BOUTIQUES b ON b.id = p.id_boutique' : ''}
                ${geoJoin}
                WHERE ${conditions.join(' AND ')}
                ${this._buildSearchOrderBy(tri, q)}
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;

            params.push(parseInt(limit), offset);

            const result = await client.query(query, params);

            // 5. COMPTAGE
            let countQuery = `
                SELECT COUNT(DISTINCT p.id)
                FROM PRODUITSBOUTIQUE p
                ${geoJoin}
                WHERE ${conditions.join(' AND ')}
            `;
            const countResult = await client.query(countQuery, params.slice(0, -2));
            const total = parseInt(countResult.rows[0].count);

            // 6. AGRÉGATION DES RÉSULTATS PAR BOUTIQUE (optionnel)
            let produits = result.rows;
            if (req.query.group_by_boutique === 'true') {
                produits = this._groupByBoutique(produits);
            }

            // 7. SUGGESTIONS DE RECHERCHE
            let suggestions = [];
            if (q && produits.length === 0) {
                suggestions = await this._getSearchSuggestions(client, q);
            }

            res.json({
                status: 'success',
                data: produits,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                },
                meta: {
                    query: q,
                    filters: {
                        categorie_id,
                        boutique_id,
                        prix_min,
                        prix_max,
                        en_promo: en_promo === 'true',
                        en_stock: en_stock === 'true'
                    },
                    suggestions: suggestions.length > 0 ? suggestions : undefined,
                    temps_execution: Date.now() - req.startTime
                }
            });

        } catch (error) {
            logError('Erreur recherche produits:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Obtenir les produits en promotion
     * @route GET /api/v1/produits/promos
     * @access PUBLIC
     */
    async getPromotions(req, res, next) {
        const client = await db.getClient();
        try {
            const {
                boutique_id,
                limit = 20,
                page = 1,
                tri = 'reduction_desc'
            } = req.query;

            const offset = (page - 1) * limit;
            const params = [];
            let paramIndex = 1;
            const conditions = [
                'p.prix_promo IS NOT NULL',
                'p.prix_promo < p.prix_unitaire_produit',
                'p.est_disponible = true'
            ];

            if (boutique_id) {
                conditions.push(`p.id_boutique = $${paramIndex}`);
                params.push(boutique_id);
                paramIndex++;
            }

            const query = `
                SELECT 
                    p.*,
                    b.nom_boutique,
                    b.logo_boutique,
                    ((p.prix_unitaire_produit - p.prix_promo) / p.prix_unitaire_produit * 100) as pourcentage_reduction,
                    (p.prix_unitaire_produit - p.prix_promo) as montant_economie
                FROM PRODUITSBOUTIQUE p
                JOIN BOUTIQUES b ON b.id = p.id_boutique
                WHERE ${conditions.join(' AND ')}
                ORDER BY 
                    CASE 
                        WHEN '${tri}' = 'reduction_desc' THEN ((p.prix_unitaire_produit - p.prix_promo) / p.prix_unitaire_produit)
                        WHEN '${tri}' = 'prix_asc' THEN p.prix_promo
                        WHEN '${tri}' = 'prix_desc' THEN p.prix_promo DESC
                        ELSE p.date_creation DESC
                    END
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;

            params.push(parseInt(limit), offset);

            const result = await client.query(query, params);

            // Statistiques des promotions
            const statsQuery = `
                SELECT 
                    COUNT(*) as total_promos,
                    ROUND(AVG(((p.prix_unitaire_produit - p.prix_promo) / p.prix_unitaire_produit * 100))::NUMERIC, 2) as reduction_moyenne,
                    MIN(p.prix_promo) as prix_min,
                    MAX(p.prix_promo) as prix_max
                FROM PRODUITSBOUTIQUE p
                WHERE ${conditions.join(' AND ')}
            `;
            const statsResult = await client.query(statsQuery, params.slice(0, -2));
            const total = parseInt(statsResult.rows[0].total_promos);

            res.json({
                status: 'success',
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: total,
                    pages: Math.ceil(total / limit)
                },
                stats: statsResult.rows[0]
            });

        } catch (error) {
            logError('Erreur récupération promotions:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer une image d'un produit
     * @route DELETE /api/v1/produits/:id/images/:imageIndex
     * @access ADMINISTRATEUR_PLATEFORME, PROPRIETAIRE_BOUTIQUE
     */
    async deleteImage(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            
            const { id, imageIndex } = req.params;
            const index = parseInt(imageIndex);

            // Récupération produit
            const produit = await client.query(
                'SELECT image_produit, images_produit FROM PRODUITSBOUTIQUE WHERE id = $1',
                [id]
            );

            if (produit.rows.length === 0) {
                throw new AppError('Produit non trouvé', 404);
            }

            const images = produit.rows[0].images_produit || [];
            
            if (index < 0 || index >= images.length) {
                throw new ValidationError('Index d\'image invalide');
            }

            const imageUrl = images[index];

            // Suppression physique
            await FileService.deleteFile(imageUrl);

            // Mise à jour liste
            images.splice(index, 1);

            await client.query(
                `UPDATE PRODUITSBOUTIQUE 
                SET images_produit = $1, date_mise_a_jour = NOW()
                WHERE id = $2`,
                [JSON.stringify(images), id]
            );

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`produit:${id}:*`);

            res.json({
                status: 'success',
                message: 'Image supprimée avec succès',
                data: {
                    images_restantes: images.length,
                    images: images
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur suppression image:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Dupliquer un produit
     * @route POST /api/v1/produits/:id/duplicate
     * @access ADMINISTRATEUR_PLATEFORME, PROPRIETAIRE_BOUTIQUE
     */
    async duplicate(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { nouveau_nom, nouveau_prix } = req.body;

            // Récupération produit original
            const original = await client.query(
                'SELECT * FROM PRODUITSBOUTIQUE WHERE id = $1',
                [id]
            );

            if (original.rows.length === 0) {
                throw new AppError('Produit non trouvé', 404);
            }

            const produitOriginal = original.rows[0];

            // Génération nouveau slug
            const nouveauSlug = await this._generateUniqueSlug(
                client, 
                nouveau_nom || `${produitOriginal.nom_produit} (copie)`,
                produitOriginal.id_boutique
            );

            // Duplication des images
            const nouvellesImages = [];
            for (const img of (produitOriginal.images_produit || [])) {
                const newPath = await FileService.duplicateFile(img, {
                    path: `boutiques/${produitOriginal.id_boutique}/produits/duplicates`
                });
                nouvellesImages.push(newPath);
            }

            // Création du produit dupliqué
            const result = await client.query(
                `INSERT INTO PRODUITSBOUTIQUE (
                    nom_produit, slug_produit, image_produit, images_produit,
                    description_produit, donnees_supplementaires,
                    prix_unitaire_produit, prix_promo, quantite,
                    id_categorie, id_boutique, est_disponible,
                    date_creation, date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
                RETURNING *`,
                [
                    nouveau_nom || `${produitOriginal.nom_produit} (copie)`,
                    nouveauSlug,
                    nouvellesImages[0] || null,
                    JSON.stringify(nouvellesImages),
                    produitOriginal.description_produit,
                    produitOriginal.donnees_supplementaires,
                    nouveau_prix || produitOriginal.prix_unitaire_produit,
                    produitOriginal.prix_promo,
                    produitOriginal.quantite,
                    produitOriginal.id_categorie,
                    produitOriginal.id_boutique,
                    true
                ]
            );

            const nouveauProduit = result.rows[0];

            await client.query('COMMIT');

            res.status(201).json({
                status: 'success',
                message: 'Produit dupliqué avec succès',
                data: nouveauProduit
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur duplication produit:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer un produit (soft delete)
     * @route DELETE /api/v1/produits/:id
     * @access ADMINISTRATEUR_PLATEFORME, PROPRIETAIRE_BOUTIQUE
     */
    async delete(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { force = false, motif } = req.body;

            // Vérification produit
            const produit = await client.query(
                'SELECT * FROM PRODUITSBOUTIQUE WHERE id = $1',
                [id]
            );

            if (produit.rows.length === 0) {
                throw new AppError('Produit non trouvé', 404);
            }

            const produitData = produit.rows[0];

            // Vérification des commandes en cours
            const commandesEnCours = await client.query(
                `SELECT COUNT(*) FROM COMMANDESBOUTIQUES 
                WHERE donnees_commandes @> $1::jsonb
                AND statut_commande NOT IN ('LIVREE', 'RECUPEREE', 'ANNULEE', 'REMBOURSEE')`,
                [JSON.stringify([{ produit_id: id }])]
            );

            if (parseInt(commandesEnCours.rows[0].count) > 0 && !force) {
                throw new ValidationError(
                    'Ce produit est dans des commandes en cours. Utilisez force=true pour forcer la suppression'
                );
            }

            // Soft delete ou suppression physique
            if (force) {
                // Suppression physique des images
                if (produitData.image_produit) {
                    await FileService.deleteFile(produitData.image_produit);
                }
                for (const img of (produitData.images_produit || [])) {
                    await FileService.deleteFile(img);
                }

                // Suppression en base
                await client.query('DELETE FROM PRODUITSBOUTIQUE WHERE id = $1', [id]);
            } else {
                // Soft delete
                await client.query(
                    `UPDATE PRODUITSBOUTIQUE 
                    SET est_disponible = false,
                        donnees_supplementaires = donnees_supplementaires || $1,
                        date_mise_a_jour = NOW()
                    WHERE id = $2`,
                    [JSON.stringify({ deleted_at: new Date(), deleted_by: req.user?.id, motif }), id]
                );
            }

            // Mise à jour compteur catégorie
            await this._updateCategoryProductCount(client, produitData.id_categorie);

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`produit:${id}:*`);
            await CacheService.delPattern(`boutique:${produitData.id_boutique}:produits*`);

            res.json({
                status: 'success',
                message: force ? 'Produit supprimé définitivement' : 'Produit désactivé avec succès',
                data: { id, soft_delete: !force }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur suppression produit:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    // ==================== MÉTHODES PRIVÉES ====================

    /**
     * Valider les données d'un produit
     */
    async _validateProductData(data, client) {
        const { nom_produit, prix_unitaire_produit, prix_promo, quantite, boutiqueId, id_categorie } = data;

        if (!nom_produit || nom_produit.length < 3) {
            throw new ValidationError('Le nom du produit doit contenir au moins 3 caractères');
        }

        if (nom_produit.length > 255) {
            throw new ValidationError('Le nom du produit ne peut pas dépasser 255 caractères');
        }

        if (!prix_unitaire_produit || prix_unitaire_produit <= 0) {
            throw new ValidationError('Le prix unitaire doit être supérieur à 0');
        }

        if (prix_unitaire_produit > 9999999.99) {
            throw new ValidationError('Le prix unitaire est trop élevé');
        }

        if (prix_promo) {
            if (prix_promo <= 0) {
                throw new ValidationError('Le prix promo doit être supérieur à 0');
            }
            if (prix_promo >= prix_unitaire_produit) {
                throw new ValidationError('Le prix promo doit être inférieur au prix unitaire');
            }
        }

        if (quantite !== -1 && quantite < 0) {
            throw new ValidationError('La quantité doit être -1 (illimité) ou supérieure ou égale à 0');
        }

        // Vérification catégorie
        const categorie = await client.query(
            'SELECT id FROM CATEGORIES_BOUTIQUE WHERE id = $1 AND boutique_id = $2',
            [id_categorie, boutiqueId]
        );

        if (categorie.rows.length === 0) {
            throw new ValidationError('La catégorie spécifiée n\'existe pas dans cette boutique');
        }

        // Vérification unicité du nom dans la boutique
        const existingProduct = await client.query(
            'SELECT id FROM PRODUITSBOUTIQUE WHERE nom_produit = $1 AND id_boutique = $2',
            [nom_produit, boutiqueId]
        );

        if (existingProduct.rows.length > 0) {
            throw new ValidationError('Un produit avec ce nom existe déjà dans cette boutique');
        }
    }

    /**
     * Générer un slug unique
     */
    async _generateUniqueSlug(client, base, boutiqueId) {
        const baseSlug = base
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 100);

        let slug = baseSlug;
        let counter = 1;

        while (true) {
            const exists = await client.query(
                'SELECT id FROM PRODUITSBOUTIQUE WHERE slug_produit = $1',
                [slug]
            );

            if (exists.rows.length === 0) break;

            slug = `${baseSlug}-${counter}`;
            counter++;

            if (counter > 100) {
                slug = `${baseSlug}-${Date.now()}`;
                break;
            }
        }

        return slug;
    }

    /**
     * Gérer l'upload des images
     */
    async _handleImageUploads(files, boutiqueId) {
        const result = {
            image_principale: null,
            images_gallery: []
        };

        // Image principale
        if (files?.image_principale) {
            result.image_principale = await FileService.uploadImage(files.image_principale, {
                path: `boutiques/${boutiqueId}/produits`,
                maxSize: 5 * 1024 * 1024,
                allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
                generateThumbnail: true,
                thumbnailSizes: [
                    { width: 100, height: 100, suffix: 'thumb' },
                    { width: 300, height: 300, suffix: 'medium' },
                    { width: 800, height: 800, suffix: 'large' }
                ]
            });
        }

        // Images galerie
        if (files?.images) {
            const imagesArray = Array.isArray(files.images) ? files.images : [files.images];

            for (const file of imagesArray) {
                if (result.images_gallery.length >= 10) {
                    logInfo('Limite de 10 images atteinte pour la galerie');
                    break;
                }

                const uploaded = await FileService.uploadImage(file, {
                    path: `boutiques/${boutiqueId}/produits/gallery`,
                    maxSize: 5 * 1024 * 1024,
                    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
                    generateThumbnail: true,
                    thumbnailSizes: [
                        { width: 150, height: 150, suffix: 'thumb' },
                        { width: 400, height: 400, suffix: 'medium' }
                    ]
                });

                result.images_gallery.push(uploaded);
            }
        }

        return result;
    }

    /**
     * Vérifier l'existence d'une boutique
     */
    async _checkBoutiqueExists(client, boutiqueId) {
        const result = await client.query(
            'SELECT * FROM BOUTIQUES WHERE id = $1 AND est_supprime = false',
            [boutiqueId]
        );

        if (result.rows.length === 0) {
            throw new AppError('Boutique non trouvée', 404);
        }

        return result.rows[0];
    }

    /**
     * Vérifier l'existence d'un produit
     */
    async _checkProductExists(client, productId) {
        const result = await client.query(
            'SELECT * FROM PRODUITSBOUTIQUE WHERE id = $1',
            [productId]
        );

        if (result.rows.length === 0) {
            throw new AppError('Produit non trouvé', 404);
        }

        return result.rows[0];
    }

    /**
     * Valider les mises à jour produit
     */
    async _validateProductUpdate(updates, ancienProduit, client) {
        if (updates.prix_unitaire_produit && updates.prix_unitaire_produit <= 0) {
            throw new ValidationError('Le prix unitaire doit être supérieur à 0');
        }

        if (updates.prix_promo !== undefined) {
            const prixUnitaire = updates.prix_unitaire_produit || ancienProduit.prix_unitaire_produit;
            if (updates.prix_promo && updates.prix_promo >= prixUnitaire) {
                throw new ValidationError('Le prix promo doit être inférieur au prix unitaire');
            }
        }

        if (updates.id_categorie && updates.id_categorie !== ancienProduit.id_categorie) {
            const categorieCheck = await client.query(
                'SELECT id FROM CATEGORIES_BOUTIQUE WHERE id = $1 AND boutique_id = $2',
                [updates.id_categorie, ancienProduit.id_boutique]
            );

            if (categorieCheck.rows.length === 0) {
                throw new ValidationError('La nouvelle catégorie n\'existe pas');
            }
        }

        if (updates.nom_produit && updates.nom_produit !== ancienProduit.nom_produit) {
            const existing = await client.query(
                'SELECT id FROM PRODUITSBOUTIQUE WHERE nom_produit = $1 AND id_boutique = $2 AND id != $3',
                [updates.nom_produit, ancienProduit.id_boutique, ancienProduit.id]
            );

            if (existing.rows.length > 0) {
                throw new ValidationError('Un autre produit avec ce nom existe déjà');
            }
        }
    }

    /**
     * Construire la requête de mise à jour produit
     */
    async _buildProductUpdateQuery(updates, files, ancienProduit, client) {
        const setClauses = [];
        const values = [];
        const champsAutorises = [
            'nom_produit',
            'description_produit',
            'donnees_supplementaires',
            'prix_unitaire_produit',
            'prix_promo',
            'quantite',
            'id_categorie',
            'est_disponible'
        ];

        for (const champ of champsAutorises) {
            if (updates[champ] !== undefined) {
                setClauses.push(`${champ} = $${values.length + 1}`);
                
                if (champ === 'donnees_supplementaires') {
                    const merged = {
                        ...(ancienProduit.donnees_supplementaires || {}),
                        ...updates[champ],
                        updated_at: new Date().toISOString(),
                        updated_by: updates.updated_by
                    };
                    values.push(JSON.stringify(merged));
                } else {
                    values.push(updates[champ]);
                }
            }
        }

        // Gestion du slug si nom changé
        if (updates.nom_produit && updates.nom_produit !== ancienProduit.nom_produit) {
            const newSlug = await this._generateUniqueSlug(
                client, 
                updates.nom_produit, 
                ancienProduit.id_boutique
            );
            setClauses.push(`slug_produit = $${values.length + 1}`);
            values.push(newSlug);
        }

        // Gestion nouvelle image principale
        if (files?.image_principale) {
            const nouvelleImage = await FileService.uploadImage(files.image_principale, {
                path: `boutiques/${ancienProduit.id_boutique}/produits`,
                maxSize: 5 * 1024 * 1024,
                generateThumbnail: true
            });

            if (ancienProduit.image_produit) {
                await FileService.deleteFile(ancienProduit.image_produit);
            }

            setClauses.push(`image_produit = $${values.length + 1}`);
            values.push(nouvelleImage);
        }

        // Gestion nouvelles images galerie
        if (files?.nouvelles_images) {
            const imagesActuelles = ancienProduit.images_produit || [];
            const newImages = Array.isArray(files.nouvelles_images) 
                ? files.nouvelles_images 
                : [files.nouvelles_images];

            for (const file of newImages) {
                if (imagesActuelles.length >= 10) {
                    logInfo('Limite de 10 images atteinte pour la galerie');
                    break;
                }

                const uploaded = await FileService.uploadImage(file, {
                    path: `boutiques/${ancienProduit.id_boutique}/produits/gallery`,
                    maxSize: 5 * 1024 * 1024,
                    generateThumbnail: true
                });

                imagesActuelles.push(uploaded);
            }

            setClauses.push(`images_produit = $${values.length + 1}`);
            values.push(JSON.stringify(imagesActuelles));
        }

        return { setClauses, values };
    }

    /**
     * Sauvegarder l'historique des modifications
     */
    async _saveProductHistory(client, ancien, nouveau, userId) {
        const changes = {};
        
        for (const key in nouveau) {
            if (JSON.stringify(ancien[key]) !== JSON.stringify(nouveau[key])) {
                changes[key] = {
                    avant: ancien[key],
                    apres: nouveau[key]
                };
            }
        }

        if (Object.keys(changes).length > 0) {
            await client.query(
                `INSERT INTO HISTORIQUE_ACTIONS (
                    action_type, table_concernee, entite_id,
                    donnees_avant, donnees_apres, utilisateur_id,
                    date_action, metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
                [
                    'PRODUCT_UPDATE',
                    'PRODUITSBOUTIQUE',
                    ancien.id,
                    JSON.stringify(changes),
                    JSON.stringify({ new: nouveau, changes }),
                    userId,
                    JSON.stringify({ champs_modifies: Object.keys(changes) })
                ]
            );
        }
    }

    /**
     * Notifier les abonnés d'un changement de prix
     */
    async _notifyPriceChange(ancien, nouveau) {
        const favoris = await db.query(
            `SELECT compte_id FROM FAVORIS_PRODUITS 
             WHERE produit_id = $1 AND notifications_actives = true`,
            [nouveau.id]
        );

        for (const fav of favoris.rows) {
            await NotificationService.notifyUser(fav.compte_id, {
                type: 'PRIX_MODIFIE',
                titre: 'Changement de prix',
                message: `Le prix de ${nouveau.nom_produit} a changé`,
                donnees: {
                    produit_id: nouveau.id,
                    ancien_prix: ancien.prix_unitaire_produit,
                    nouveau_prix: nouveau.prix_unitaire_produit,
                    prix_promo: nouveau.prix_promo
                }
            });
        }
    }

    /**
     * Mettre à jour le compteur de produits dans une catégorie
     */
    async _updateCategoryProductCount(client, categorieId) {
        await client.query(
            `UPDATE CATEGORIES_BOUTIQUE 
             SET nombre_produits = (
                 SELECT COUNT(*) FROM PRODUITSBOUTIQUE 
                 WHERE id_categorie = $1 AND est_disponible = true
             )
             WHERE id = $1`,
            [categorieId]
        );
    }

    /**
     * Invalider le cache lié aux produits
     */
    async _invalidateProductCache(boutiqueId, categorieId) {
        const patterns = [
            `boutique:${boutiqueId}:produits*`,
            `boutique:${boutiqueId}:categorie:${categorieId}:produits*`
        ];

        if (categorieId) {
            patterns.push(`categorie:${categorieId}:produits*`);
        }

        await Promise.all(patterns.map(pattern => CacheService.delPattern(pattern)));
    }

    /**
     * Récupérer une catégorie
     */
    async _getCategorie(client, categorieId) {
        const result = await client.query(
            'SELECT id, nom_categorie, slug_categorie, description_categorie FROM CATEGORIES_BOUTIQUE WHERE id = $1',
            [categorieId]
        );
        return result.rows[0] || null;
    }

    /**
     * Récupérer une boutique
     */
    async _getBoutique(client, boutiqueId) {
        const result = await client.query(
            'SELECT id, nom_boutique, logo_boutique, est_actif FROM BOUTIQUES WHERE id = $1',
            [boutiqueId]
        );
        return result.rows[0] || null;
    }

    /**
     * Récupérer les avis d'un produit
     */
    async _getAvisProduit(client, produitId, limit = 10) {
        const result = await client.query(
            `SELECT 
                a.*,
                c.nom_utilisateur_compte,
                c.photo_profil_compte,
                c.niveau_fidelite
            FROM AVIS a
            LEFT JOIN COMPTES c ON c.id = a.auteur_id
            WHERE a.entite_type = 'PRODUIT_BOUTIQUE' 
            AND a.entite_id = $1 
            AND a.statut = 'PUBLIE'
            ORDER BY a.date_creation DESC
            LIMIT $2`,
            [produitId, limit]
        );
        return result.rows;
    }

    /**
     * Récupérer les statistiques d'avis
     */
    async _getStatsAvis(client, produitId) {
        const result = await client.query(
            `SELECT 
                COUNT(*) as total,
                ROUND(AVG(note_globale)::NUMERIC, 2) as moyenne,
                COUNT(*) FILTER (WHERE note_globale = 5) as cinq_etoiles,
                COUNT(*) FILTER (WHERE note_globale = 4) as quatre_etoiles,
                COUNT(*) FILTER (WHERE note_globale = 3) as trois_etoiles,
                COUNT(*) FILTER (WHERE note_globale = 2) as deux_etoiles,
                COUNT(*) FILTER (WHERE note_globale = 1) as une_etoile,
                ROUND(AVG(CASE WHEN note_qualite IS NOT NULL THEN note_qualite END)::NUMERIC, 2) as qualite_moyenne,
                ROUND(AVG(CASE WHEN note_rapport_prix IS NOT NULL THEN note_rapport_prix END)::NUMERIC, 2) as rapport_prix_moyen
            FROM AVIS
            WHERE entite_type = 'PRODUIT_BOUTIQUE' 
            AND entite_id = $1 
            AND statut = 'PUBLIE'`,
            [produitId]
        );
        return result.rows[0];
    }

    /**
     * Récupérer les produits similaires
     */
    async _getProduitsSimilaires(client, produit, limit = 6) {
        const result = await client.query(
            `SELECT 
                id, nom_produit, slug_produit, image_produit,
                prix_unitaire_produit, prix_promo,
                ((prix_unitaire_produit - COALESCE(prix_promo, prix_unitaire_produit)) / prix_unitaire_produit * 100) as reduction
            FROM PRODUITSBOUTIQUE
            WHERE id_categorie = $1 
            AND id != $2
            AND est_disponible = true
            ORDER BY date_creation DESC
            LIMIT $3`,
            [produit.id_categorie, produit.id, limit]
        );
        return result.rows;
    }

    /**
     * Récupérer les recommandations personnalisées
     */
    async _getRecommandations(client, produit, limit = 4) {
        const result = await client.query(
            `WITH achats_combines AS (
                SELECT 
                    jsonb_array_elements(donnees_commandes)->>'produit_id' as produit_achete,
                    COUNT(*) as frequence
                FROM COMMANDESBOUTIQUES
                WHERE donnees_commandes @> $1::jsonb
                AND id_boutique = $2
                GROUP BY produit_achete
                ORDER BY frequence DESC
                LIMIT $3
            )
            SELECT 
                p.id, p.nom_produit, p.image_produit,
                p.prix_unitaire_produit, p.prix_promo
            FROM achats_combines ac
            JOIN PRODUITSBOUTIQUE p ON p.id = ac.produit_achete::int
            WHERE p.id != $4 AND p.est_disponible = true`,
            [
                JSON.stringify([{ produit_id: produit.id }]),
                produit.id_boutique,
                limit,
                produit.id
            ]
        );
        return result.rows;
    }

    /**
     * Récupérer les questions/réponses sur le produit
     */
    async _getQuestionsReponses(client, produitId, limit = 5) {
        // Table à créer si nécessaire
        return [];
    }

    /**
     * Incrémenter le compteur de vues
     */
    async _incrementViewCount(produitId) {
        await db.query(
            `UPDATE PRODUITSBOUTIQUE 
             SET nombre_vues = COALESCE(nombre_vues, 0) + 1
             WHERE id = $1`,
            [produitId]
        );
    }

    /**
     * Obtenir le statut du stock
     */
    _getStockStatus(quantite) {
        if (quantite === -1) return 'illimité';
        if (quantite === 0) return 'rupture';
        if (quantite <= 5) return 'stock_faible';
        return 'disponible';
    }

    /**
     * Vérifier si le produit est nouveau
     */
    _isNewProduct(dateCreation, jours = 30) {
        const diff = (new Date() - new Date(dateCreation)) / (1000 * 60 * 60 * 24);
        return diff <= jours;
    }

    /**
     * Construire la clause ORDER BY
     */
    _buildOrderBy(tri) {
        const orders = {
            'prix_asc': 'ORDER BY p.prix_unitaire_produit ASC',
            'prix_desc': 'ORDER BY p.prix_unitaire_produit DESC',
            'nom_asc': 'ORDER BY p.nom_produit ASC',
            'nom_desc': 'ORDER BY p.nom_produit DESC',
            'date_creation_asc': 'ORDER BY p.date_creation ASC',
            'date_creation_desc': 'ORDER BY p.date_creation DESC',
            'popularite': 'ORDER BY p.nombre_vues DESC NULLS LAST',
            'notes': 'ORDER BY p.note_moyenne DESC NULLS LAST'
        };
        return orders[tri] || orders.date_creation_desc;
    }

    /**
     * Construire la clause ORDER BY pour la recherche
     */
    _buildSearchOrderBy(tri, hasQuery) {
        if (hasQuery && tri === 'pertinence') {
            return 'ORDER BY rank DESC, p.date_creation DESC';
        }
        return this._buildOrderBy(tri);
    }

    /**
     * Ajouter des fourchettes de prix aux produits
     */
    _addPriceRanges(produits) {
        return produits.map(p => ({
            ...p,
            fourchette_prix: this._getPriceRange(p.prix_unitaire_produit)
        }));
    }

    /**
     * Obtenir la fourchette de prix
     */
    _getPriceRange(prix) {
        if (prix < 1000) return 'moins_de_1000';
        if (prix < 5000) return '1000_5000';
        if (prix < 10000) return '5000_10000';
        if (prix < 25000) return '10000_25000';
        if (prix < 50000) return '25000_50000';
        return 'plus_de_50000';
    }

    /**
     * Grouper les produits par boutique
     */
    _groupByBoutique(produits) {
        const grouped = {};
        produits.forEach(p => {
            if (!grouped[p.id_boutique]) {
                grouped[p.id_boutique] = {
                    boutique_id: p.id_boutique,
                    boutique_nom: p.nom_boutique,
                    boutique_logo: p.logo_boutique,
                    produits: []
                };
            }
            grouped[p.id_boutique].produits.push(p);
        });
        return Object.values(grouped);
    }

    /**
     * Récupérer les filtres disponibles
     */
    async _getAvailableFilters(client, boutiqueId) {
        const [categories, prixExtremes] = await Promise.all([
            client.query(
                `SELECT DISTINCT 
                    c.id, c.nom_categorie, 
                    COUNT(p.id) as nombre_produits
                FROM CATEGORIES_BOUTIQUE c
                LEFT JOIN PRODUITSBOUTIQUE p ON p.id_categorie = c.id
                WHERE c.boutique_id = $1 AND c.est_actif = true
                GROUP BY c.id, c.nom_categorie`,
                [boutiqueId]
            ),
            client.query(
                `SELECT 
                    MIN(prix_unitaire_produit) as prix_min,
                    MAX(prix_unitaire_produit) as prix_max
                FROM PRODUITSBOUTIQUE
                WHERE id_boutique = $1`,
                [boutiqueId]
            )
        ]);

        return {
            categories: categories.rows,
            prix: {
                min: prixExtremes.rows[0]?.prix_min || 0,
                max: prixExtremes.rows[0]?.prix_max || 0
            },
            en_promo: true,
            en_stock: true
        };
    }

    /**
     * Obtenir des suggestions de recherche
     */
    async _getSearchSuggestions(client, query) {
        const result = await client.query(
            `SELECT nom_produit, slug_produit
             FROM PRODUITSBOUTIQUE
             WHERE nom_produit ILIKE $1
             ORDER BY nombre_vues DESC
             LIMIT 5`,
            [`%${query}%`]
        );
        return result.rows;
    }
}

module.exports = new ProduitBoutiqueController();