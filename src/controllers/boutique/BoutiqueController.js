// src/controllers/boutique/BoutiqueController.js
const db = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const GeoService = require('../../services/geo/GeoService');
const FileService = require('../../services/file/FileService');
const AuditService = require('../../services/audit/AuditService');
const NotificationService = require('../../services/notification/NotificationService');
const { logInfo, logError } = require('../../configuration/logger');

class BoutiqueController {

    /**
     * Récupérer toutes les boutiques avec filtres avancés
     * @route GET /api/v1/boutiques
     * @access PUBLIC
     */
    async findAll(req, res, next) {
        const client = await db.getClient();
        try {
            const {
                page = 1,
                limit = 20,
                search,
                est_actif,
                plateforme_id,
                avec_produits,
                avec_avis,
                proximite,
                lat,
                lng,
                rayon_km = 10,
                categorie_produit,
                note_min,
                tri = 'date_creation_desc'
            } = req.query;

            const offset = (page - 1) * limit;
            const params = [];
            let paramIndex = 1;
            let whereConditions = ['b.est_supprime = false'];

            // Construction dynamique de la requête
            let selectFields = `
                b.*,
                p.nom_plateforme
            `;

            if (avec_produits === 'true') {
                selectFields += `,
                    (SELECT COUNT(*) FROM PRODUITSBOUTIQUE pb 
                     WHERE pb.id_boutique = b.id AND pb.est_disponible = true) as nombre_produits`;
            }

            if (avec_avis === 'true') {
                selectFields += `,
                    (SELECT COUNT(*) FROM AVIS a 
                     WHERE a.entite_type = 'BOUTIQUE' 
                     AND a.entite_id = b.id 
                     AND a.statut = 'PUBLIE') as nombre_avis,
                    (SELECT ROUND(AVG(note_globale)::NUMERIC, 2) FROM AVIS a 
                     WHERE a.entite_type = 'BOUTIQUE' 
                     AND a.entite_id = b.id 
                     AND a.statut = 'PUBLIE') as note_moyenne`;
            }

            // Filtres
            if (est_actif !== undefined) {
                whereConditions.push(`b.est_actif = $${paramIndex}`);
                params.push(est_actif === 'true');
                paramIndex++;
            }

            if (plateforme_id) {
                whereConditions.push(`b.plateforme_id = $${paramIndex}`);
                params.push(plateforme_id);
                paramIndex++;
            }

            if (search) {
                whereConditions.push(`(b.nom_boutique ILIKE $${paramIndex} 
                                   OR b.description_boutique ILIKE $${paramIndex})`);
                params.push(`%${search}%`);
                paramIndex++;
            }

            if (categorie_produit) {
                whereConditions.push(`b.types_produits_vendu @> $${paramIndex}::jsonb`);
                params.push(JSON.stringify([categorie_produit]));
                paramIndex++;
            }

            // Filtre par note minimum
            if (note_min) {
                whereConditions.push(`EXISTS (
                    SELECT 1 FROM AVIS a 
                    WHERE a.entite_type = 'BOUTIQUE' 
                    AND a.entite_id = b.id 
                    AND a.statut = 'PUBLIE'
                    GROUP BY a.entite_id
                    HAVING AVG(a.note_globale) >= $${paramIndex}
                )`);
                params.push(parseFloat(note_min));
                paramIndex++;
            }

            // Filtre géographique
            if (proximite === 'true' && lat && lng) {
                whereConditions.push(`EXISTS (
                    SELECT 1 FROM ADRESSES_ENTITES ae
                    JOIN ADRESSES a ON a.id = ae.adresse_id
                    WHERE ae.entite_type = 'BOUTIQUE'
                    AND ae.entite_id = b.id
                    AND ST_DWithin(
                        a.coordonnees::geography,
                        ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)::geography,
                        $${paramIndex + 2} * 1000
                    )
                )`);
                params.push(parseFloat(lng), parseFloat(lat), parseFloat(rayon_km));
                paramIndex += 3;
            }

            // Construction requête finale
            const query = `
                SELECT ${selectFields}
                FROM BOUTIQUES b
                LEFT JOIN PLATEFORME p ON p.id = b.plateforme_id
                WHERE ${whereConditions.join(' AND ')}
                ${this._buildOrderBy(tri)}
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;

            params.push(parseInt(limit), offset);

            const result = await client.query(query, params);

            // Comptage total
            const countResult = await client.query(
                `SELECT COUNT(*) FROM BOUTIQUES b 
                 WHERE ${whereConditions.join(' AND ')}`,
                params.slice(0, -2)
            );

            res.json({
                status: 'success',
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(countResult.rows[0].count),
                    pages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
                }
            });

        } catch (error) {
            logError('Erreur récupération boutiques:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer une boutique par son ID
     * @route GET /api/v1/boutiques/:id
     * @access PUBLIC
     */
    async findById(req, res, next) {
        const client = await db.getClient();
        try {
            const { id } = req.params;
            const { inclure_produits, inclure_avis, inclure_horaires } = req.query;

            // Récupération boutique
            const boutiqueQuery = await client.query(
                `SELECT 
                    b.*,
                    p.nom_plateforme,
                    p.logo_plateforme
                FROM BOUTIQUES b
                LEFT JOIN PLATEFORME p ON p.id = b.plateforme_id
                WHERE b.id = $1 AND b.est_supprime = false`,
                [id]
            );

            if (boutiqueQuery.rows.length === 0) {
                throw new AppError('Boutique non trouvée', 404);
            }

            const boutique = boutiqueQuery.rows[0];
            const result = { ...boutique };

            // Chargement optionnel des données avec le même client
            await Promise.all([
                inclure_produits === 'true' && this._chargerProduits(client, result, id),
                inclure_avis === 'true' && this._chargerAvis(client, result, id),
                inclure_horaires === 'true' && this._chargerHoraires(client, result, id),
                this._chargerAdresses(client, result, id)
            ]);

            res.json({
                status: 'success',
                data: result
            });

        } catch (error) {
            logError('Erreur récupération boutique:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour une boutique
     * @route PUT /api/v1/boutiques/:id
     */
    async update(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const updates = req.body;

            // Vérification existence
            const boutiqueCheck = await client.query(
                'SELECT * FROM BOUTIQUES WHERE id = $1 AND est_supprime = false',
                [id]
            );

            if (boutiqueCheck.rows.length === 0) {
                throw new AppError('Boutique non trouvée', 404);
            }

            const ancienneBoutique = boutiqueCheck.rows[0];

            // Construction de la mise à jour
            const { setClauses, values } = await this._buildUpdateQuery(updates, req.files, ancienneBoutique);
            
            if (setClauses.length === 0) {
                throw new ValidationError('Aucune donnée à mettre à jour');
            }

            setClauses.push('date_mise_a_jour = NOW()');

            const query = `
                UPDATE BOUTIQUES 
                SET ${setClauses.join(', ')}
                WHERE id = $1
                RETURNING *
            `;

            const result = await client.query(query, [id, ...values]);
            const boutiqueMaj = result.rows[0];

            // Mise à jour configuration
            if (updates.configuration) {
                await this._saveConfiguration(client, id, updates.configuration);
            }

            // Audit
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'BOUTIQUE',
                ressource_id: id,
                donnees_avant: ancienneBoutique,
                donnees_apres: boutiqueMaj,
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            res.json({
                status: 'success',
                data: boutiqueMaj
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur mise à jour boutique:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer (soft delete) une boutique
     * @route DELETE /api/v1/boutiques/:id
     */
    async delete(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { raison } = req.body;

            // Vérification commandes en cours
            const commandesEnCours = await client.query(
                `SELECT COUNT(*) FROM COMMANDESBOUTIQUES 
                WHERE id_boutique = $1 
                AND statut_commande NOT IN ('LIVREE', 'RECUPEREE', 'ANNULEE', 'REMBOURSEE')`,
                [id]
            );

            if (parseInt(commandesEnCours.rows[0].count) > 0) {
                throw new ValidationError('Impossible de supprimer : des commandes sont en cours');
            }

            // Soft delete
            await client.query(
                `UPDATE BOUTIQUES 
                SET est_supprime = true, 
                    date_suppression = NOW(),
                    est_actif = false,
                    date_mise_a_jour = NOW()
                WHERE id = $1`,
                [id]
            );

            // Désactiver les produits
            await client.query(
                `UPDATE PRODUITSBOUTIQUE 
                SET est_disponible = false, date_mise_a_jour = NOW()
                WHERE id_boutique = $1`,
                [id]
            );

            await client.query('COMMIT');

            res.json({
                status: 'success',
                message: 'Boutique supprimée avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur suppression boutique:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les statistiques d'une boutique
     * @route GET /api/v1/boutiques/:id/stats
     */
    async getStats(req, res, next) {
        const client = await db.getClient();
        try {
            const { id } = req.params;
            const { periode = '30j' } = req.query;

            const stats = await client.query(`
                WITH stats_commandes AS (
                    SELECT 
                        COUNT(*) as total_commandes,
                        COUNT(DISTINCT compte_id) as clients_uniques,
                        SUM(prix_total_commande) as chiffre_affaires,
                        AVG(prix_total_commande) as panier_moyen,
                        COUNT(*) FILTER (WHERE statut_commande = 'LIVREE') as commandes_livrees,
                        COUNT(*) FILTER (WHERE statut_commande = 'ANNULEE') as commandes_annulees
                    FROM COMMANDESBOUTIQUES
                    WHERE id_boutique = $1
                    AND date_commande >= NOW() - $2::interval
                ),
                top_produits AS (
                    SELECT 
                        p.id,
                        p.nom_produit,
                        COUNT(*) as nombre_commandes,
                        SUM((c.donnees_commandes->>'quantite')::int) as quantite_vendue
                    FROM PRODUITSBOUTIQUE p
                    JOIN COMMANDESBOUTIQUES c ON true
                    CROSS JOIN LATERAL jsonb_array_elements(c.donnees_commandes) as item
                    WHERE c.id_boutique = $1
                    AND (item->>'produit_id')::int = p.id
                    AND c.date_commande >= NOW() - $2::interval
                    GROUP BY p.id, p.nom_produit
                    ORDER BY quantite_vendue DESC
                    LIMIT 5
                )
                SELECT 
                    jsonb_build_object(
                        'commandes', row_to_json(sc),
                        'top_produits', json_agg(tp)
                    ) as stats
                FROM stats_commandes sc
                CROSS JOIN top_produits tp
                GROUP BY sc.total_commandes, sc.clients_uniques, sc.chiffre_affaires, 
                         sc.panier_moyen, sc.commandes_livrees, sc.commandes_annulees
            `, [id, periode === '30j' ? '30 days' : '7 days']);

            res.json({
                status: 'success',
                data: stats.rows[0]?.stats || {
                    commandes: {},
                    top_produits: []
                }
            });

        } catch (error) {
            logError('Erreur récupération statistiques:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    // Méthodes privées utilitaires
    _buildOrderBy(tri) {
        const orders = {
            'nom_asc': 'ORDER BY b.nom_boutique ASC',
            'nom_desc': 'ORDER BY b.nom_boutique DESC',
            'date_creation_asc': 'ORDER BY b.date_creation ASC',
            'date_creation_desc': 'ORDER BY b.date_creation DESC',
            'note_moyenne_desc': 'ORDER BY note_moyenne DESC NULLS LAST'
        };
        return orders[tri] || orders.date_creation_desc;
    }

    async _chargerProduits(client, result, boutiqueId) {
        const produits = await client.query(
            `SELECT id, nom_produit, image_produit, prix_unitaire_produit, 
                    prix_promo, quantite, est_disponible
             FROM PRODUITSBOUTIQUE
             WHERE id_boutique = $1 AND est_disponible = true
             ORDER BY date_creation DESC
             LIMIT 10`,
            [boutiqueId]
        );
        result.produits = produits.rows;
    }

    async _chargerAvis(client, result, boutiqueId) {
        const [avis, stats] = await Promise.all([
            client.query(
                `SELECT a.*, c.nom_utilisateur_compte, c.photo_profil_compte
                 FROM AVIS a
                 LEFT JOIN COMPTES c ON c.id = a.auteur_id
                 WHERE a.entite_type = 'BOUTIQUE' 
                 AND a.entite_id = $1 
                 AND a.statut = 'PUBLIE'
                 ORDER BY a.date_creation DESC
                 LIMIT 5`,
                [boutiqueId]
            ),
            client.query(
                `SELECT COUNT(*) as total,
                        ROUND(AVG(note_globale)::NUMERIC, 2) as moyenne
                 FROM AVIS
                 WHERE entite_type = 'BOUTIQUE' 
                 AND entite_id = $1 
                 AND statut = 'PUBLIE'`,
                [boutiqueId]
            )
        ]);

        result.avis = avis.rows;
        result.statistiques_avis = stats.rows[0];
    }

    async _chargerHoraires(client, result, boutiqueId) {
        const [horaires, exceptions] = await Promise.all([
            client.query(
                `SELECT * FROM HORAIRES
                 WHERE entite_type = 'BOUTIQUE' AND entite_id = $1
                 ORDER BY jour_semaine`,
                [boutiqueId]
            ),
            client.query(
                `SELECT * FROM HORAIRES_EXCEPTIONS
                 WHERE entite_type = 'BOUTIQUE' AND entite_id = $1
                 AND date_exception >= CURRENT_DATE
                 ORDER BY date_exception`,
                [boutiqueId]
            )
        ]);

        result.horaires = horaires.rows;
        result.exceptions_horaires = exceptions.rows;
    }

    async _chargerAdresses(client, result, boutiqueId) {
        const adresses = await client.query(
            `SELECT a.*, ae.type_adresse
             FROM ADRESSES a
             JOIN ADRESSES_ENTITES ae ON ae.adresse_id = a.id
             WHERE ae.entite_type = 'BOUTIQUE' 
             AND ae.entite_id = $1
             AND ae.est_actif = true`,
            [boutiqueId]
        );
        result.adresses = adresses.rows;
    }

    async _buildUpdateQuery(updates, files, ancienneBoutique) {
        const setClauses = [];
        const values = [];
        const champsAutorises = [
            'nom_boutique',
            'description_boutique',
            'types_produits_vendu',
            'pourcentage_commission_plateforme',
            'est_actif'
        ];

        for (const champ of champsAutorises) {
            if (updates[champ] !== undefined) {
                setClauses.push(`${champ} = $${values.length + 1}`);
                values.push(updates[champ]);
            }
        }

        // Gestion des fichiers
        if (files?.logo) {
            const nouveauLogo = await FileService.uploadImage(files.logo, {
                path: 'boutiques/logos',
                maxSize: 2 * 1024 * 1024
            });
            
            if (ancienneBoutique.logo_boutique) {
                await FileService.deleteFile(ancienneBoutique.logo_boutique);
            }
            
            setClauses.push(`logo_boutique = $${values.length + 1}`);
            values.push(nouveauLogo);
        }

        if (files?.favicon) {
            const nouveauFavicon = await FileService.uploadImage(files.favicon, {
                path: 'boutiques/favicons',
                maxSize: 512 * 1024
            });
            
            if (ancienneBoutique.favicon_boutique) {
                await FileService.deleteFile(ancienneBoutique.favicon_boutique);
            }
            
            setClauses.push(`favicon_boutique = $${values.length + 1}`);
            values.push(nouveauFavicon);
        }

        return { setClauses, values };
    }

    async _saveConfiguration(client, boutiqueId, configuration) {
        for (const [cle, valeur] of Object.entries(configuration)) {
            const { type_valeur, valeur_text, valeur_json } = this._parseConfigValue(valeur);
            
            await client.query(
                `INSERT INTO CONFIGURATIONS (
                    entite_type, entite_id, cle, valeur, valeur_json, type_valeur, date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
                ON CONFLICT (entite_type, entite_id, cle) 
                WHERE entite_id IS NOT NULL
                DO UPDATE SET 
                    valeur = EXCLUDED.valeur,
                    valeur_json = EXCLUDED.valeur_json,
                    type_valeur = EXCLUDED.type_valeur,
                    date_mise_a_jour = NOW()`,
                ['BOUTIQUE', boutiqueId, cle, valeur_text, valeur_json, type_valeur]
            );
        }
    }

    _parseConfigValue(valeur) {
        if (typeof valeur === 'object' && valeur !== null) {
            return {
                type_valeur: 'JSON',
                valeur_text: null,
                valeur_json: JSON.stringify(valeur)
            };
        }
        if (typeof valeur === 'boolean') {
            return {
                type_valeur: 'BOOLEAN',
                valeur_text: valeur ? 'true' : 'false',
                valeur_json: null
            };
        }
        if (typeof valeur === 'number') {
            return {
                type_valeur: Number.isInteger(valeur) ? 'INTEGER' : 'DECIMAL',
                valeur_text: valeur.toString(),
                valeur_json: null
            };
        }
        return {
            type_valeur: 'TEXT',
            valeur_text: valeur?.toString() || '',
            valeur_json: null
        };
    }
}

module.exports = new BoutiqueController();