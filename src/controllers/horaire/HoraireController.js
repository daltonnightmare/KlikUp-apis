// src/controllers/horaire/HoraireController.js
const pool = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/ValidationError');
const AuditService = require('../../services/audit/AuditService');
const CacheService = require('../../services/cache/CacheService');
const { logInfo, logError, logDebug } = require('../../configuration/logger');
const { ENTITE_REFERENCE } = require('../../utils/constants/enums');

class HoraireController {
    /**
     * Créer ou mettre à jour les horaires d'une entité
     * @route POST /api/v1/horaires
     * @access PRIVATE (propriétaire de l'entité)
     */
    async createOrUpdate(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const {
                entite_type,
                entite_id,
                horaires // Tableau des 7 jours
            } = req.body;

            // 1. VALIDATIONS
            if (!entite_type || !entite_id) {
                throw new ValidationError('Type et ID d\'entité requis');
            }

            if (!horaires || !Array.isArray(horaires) || horaires.length !== 7) {
                throw new ValidationError('Les horaires doivent être un tableau de 7 jours');
            }

            // 2. VÉRIFIER QUE L'ENTITÉ EXISTE
            await this._checkEntityExists(client, entite_type, entite_id);

            // 3. VÉRIFIER LES PERMISSIONS
            await this._checkPermissions(req.user, entite_type, entite_id);

            // 4. TRAITER CHAQUE JOUR
            const results = [];
            const joursSemaine = ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI', 'DIMANCHE'];

            for (let i = 0; i < 7; i++) {
                const jourHoraire = horaires[i];
                const jourSemaine = i; // 0 = Lundi, 6 = Dimanche

                // Validation du format
                this._validateJourHoraire(jourHoraire, joursSemaine[i]);

                // Vérifier si un horaire existe déjà
                const existing = await client.query(
                    `SELECT id FROM HORAIRES 
                     WHERE entite_type = $1 AND entite_id = $2 AND jour_semaine = $3`,
                    [entite_type, entite_id, jourSemaine]
                );

                let result;

                if (existing.rows.length > 0) {
                    // Mise à jour
                    result = await client.query(
                        `UPDATE HORAIRES 
                         SET heure_ouverture = $1,
                             heure_fermeture = $2,
                             heure_coupure_debut = $3,
                             heure_coupure_fin = $4,
                             est_ouvert = $5,
                             date_creation = NOW()
                         WHERE id = $6
                         RETURNING *`,
                        [
                            jourHoraire.heure_ouverture || null,
                            jourHoraire.heure_fermeture || null,
                            jourHoraire.heure_coupure_debut || null,
                            jourHoraire.heure_coupure_fin || null,
                            jourHoraire.est_ouvert !== false,
                            existing.rows[0].id
                        ]
                    );
                } else {
                    // Création
                    result = await client.query(
                        `INSERT INTO HORAIRES (
                            entite_type, entite_id, jour_semaine,
                            heure_ouverture, heure_fermeture,
                            heure_coupure_debut, heure_coupure_fin,
                            est_ouvert, date_creation
                         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                         RETURNING *`,
                        [
                            entite_type,
                            entite_id,
                            jourSemaine,
                            jourHoraire.heure_ouverture || null,
                            jourHoraire.heure_fermeture || null,
                            jourHoraire.heure_coupure_debut || null,
                            jourHoraire.heure_coupure_fin || null,
                            jourHoraire.est_ouvert !== false
                        ]
                    );
                }

                results.push({
                    jour: joursSemaine[jourSemaine],
                    ...result.rows[0]
                });
            }

            // 5. AUDIT LOG
            await AuditService.log({
                action: 'UPDATE_HORAIRES',
                ressource_type: entite_type,
                ressource_id: entite_id,
                metadata: { horaires: results },
                utilisateur_id: req.user.id,
                adresse_ip: req.ip
            });

            await client.query('COMMIT');

            // 6. INVALIDATION CACHE
            await CacheService.delPattern(`horaires:${entite_type}:${entite_id}:*`);
            await CacheService.del(`est_ouvert:${entite_type}:${entite_id}`);

            logInfo(`Horaires mis à jour pour ${entite_type}:${entite_id}`);

            res.json({
                status: 'success',
                data: results,
                message: 'Horaires enregistrés avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur enregistrement horaires:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les horaires d'une entité
     * @route GET /api/v1/horaires/:entite_type/:entite_id
     * @access PUBLIC
     */
    async findByEntity(req, res, next) {
        try {
            const { entite_type, entite_id } = req.params;

            // Vérification cache
            const cacheKey = `horaires:${entite_type}:${entite_id}`;
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
                    jour_semaine,
                    heure_ouverture,
                    heure_fermeture,
                    heure_coupure_debut,
                    heure_coupure_fin,
                    est_ouvert
                FROM HORAIRES
                WHERE entite_type = $1 AND entite_id = $2
                ORDER BY jour_semaine`,
                [entite_type, entite_id]
            );

            // Formater les résultats
            const jours = ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI', 'DIMANCHE'];
            const horaires = jours.map((jour, index) => {
                const horaire = result.rows.find(h => h.jour_semaine === index);
                return {
                    jour,
                    jour_semaine: index,
                    heure_ouverture: horaire?.heure_ouverture || null,
                    heure_fermeture: horaire?.heure_fermeture || null,
                    heure_coupure_debut: horaire?.heure_coupure_debut || null,
                    heure_coupure_fin: horaire?.heure_coupure_fin || null,
                    est_ouvert: horaire?.est_ouvert ?? false
                };
            });

            // Mise en cache (1 heure)
            await CacheService.set(cacheKey, horaires, 3600);

            res.json({
                status: 'success',
                data: horaires
            });

        } catch (error) {
            logError('Erreur récupération horaires:', error);
            next(error);
        }
    }

    /**
     * Vérifier si une entité est ouverte à un moment donné
     * @route GET /api/v1/horaires/est-ouvert
     * @access PUBLIC
     */
    async estOuvert(req, res, next) {
        try {
            const {
                entite_type,
                entite_id,
                date_time = new Date().toISOString()
            } = req.query;

            if (!entite_type || !entite_id) {
                throw new ValidationError('Type et ID d\'entité requis');
            }

            const date = new Date(date_time);
            
            // Vérification cache (5 minutes)
            const cacheKey = `est_ouvert:${entite_type}:${entite_id}:${date.toISOString().split('T')[0]}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    status: 'success',
                    data: cached,
                    from_cache: true
                });
            }

            // Utiliser la fonction PostgreSQL
            const result = await pool.query(
                `SELECT fn_est_ouvert($1, $2, $3) as est_ouvert`,
                [entite_type, entite_id, date]
            );

            // Récupérer les détails pour le message
            const estOuvert = result.rows[0].est_ouvert;
            let details = null;

            if (!estOuvert) {
                // Chercher pourquoi c'est fermé
                const horaire = await pool.query(
                    `SELECT * FROM HORAIRES 
                     WHERE entite_type = $1 AND entite_id = $2 
                     AND jour_semaine = EXTRACT(DOW FROM $3)`,
                    [entite_type, entite_id, date]
                );

                const exception = await pool.query(
                    `SELECT * FROM HORAIRES_EXCEPTIONS 
                     WHERE entite_type = $1 AND entite_id = $2 
                     AND date_exception = $3::date`,
                    [entite_type, entite_id, date]
                );

                if (exception.rows.length > 0) {
                    details = {
                        raison: 'exception',
                        message: exception.rows[0].libelle || 'Fermeture exceptionnelle',
                        est_ouvert: exception.rows[0].est_ouvert
                    };
                } else if (horaire.rows.length > 0) {
                    if (!horaire.rows[0].est_ouvert) {
                        details = {
                            raison: 'fermeture_hebdo',
                            message: 'Fermé ce jour'
                        };
                    } else {
                        details = {
                            raison: 'horaire',
                            heure_ouverture: horaire.rows[0].heure_ouverture,
                            heure_fermeture: horaire.rows[0].heure_fermeture,
                            message: `Ouvert de ${horaire.rows[0].heure_ouverture} à ${horaire.rows[0].heure_fermeture}`
                        };
                    }
                } else {
                    details = {
                        raison: 'non_configuré',
                        message: 'Horaires non configurés'
                    };
                }
            }

            const response = {
                est_ouvert: estOuvert,
                date_time: date.toISOString(),
                entite: { type: entite_type, id: entite_id },
                details
            };

            // Mise en cache
            await CacheService.set(cacheKey, response, 300);

            res.json({
                status: 'success',
                data: response
            });

        } catch (error) {
            logError('Erreur vérification ouverture:', error);
            next(error);
        }
    }

    /**
     * Récupérer les créneaux disponibles pour une date
     * @route GET /api/v1/horaires/creneaux
     * @access PUBLIC
     */
    async getCreneauxDisponibles(req, res, next) {
        try {
            const {
                entite_type,
                entite_id,
                date,
                duree_minutes = 30
            } = req.query;

            if (!entite_type || !entite_id || !date) {
                throw new ValidationError('Paramètres requis: entite_type, entite_id, date');
            }

            const dateObj = new Date(date);
            const jourSemaine = dateObj.getDay(); // 0 = Dimanche, 1 = Lundi

            // Vérifier si ouvert ce jour
            const estOuvert = await pool.query(
                `SELECT fn_est_ouvert($1, $2, $3) as est_ouvert`,
                [entite_type, entite_id, dateObj]
            );

            if (!estOuvert.rows[0].est_ouvert) {
                return res.json({
                    status: 'success',
                    data: [],
                    message: 'Fermé ce jour'
                });
            }

            // Récupérer les horaires
            const horaires = await pool.query(
                `SELECT * FROM HORAIRES 
                 WHERE entite_type = $1 AND entite_id = $2 AND jour_semaine = $3`,
                [entite_type, entite_id, jourSemaine]
            );

            if (horaires.rows.length === 0) {
                return res.json({
                    status: 'success',
                    data: []
                });
            }

            const horaire = horaires.rows[0];

            // Générer les créneaux
            const creneaux = [];
            const ouverture = this._timeToMinutes(horaire.heure_ouverture);
            const fermeture = this._timeToMinutes(horaire.heure_fermeture);
            const coupureDebut = horaire.heure_coupure_debut ? this._timeToMinutes(horaire.heure_coupure_debut) : null;
            const coupureFin = horaire.heure_coupure_fin ? this._timeToMinutes(horaire.heure_coupure_fin) : null;

            for (let minutes = ouverture; minutes + duree_minutes <= fermeture; minutes += 30) {
                // Vérifier si dans la pause
                if (coupureDebut && coupureFin) {
                    if (minutes >= coupureDebut && minutes < coupureFin) {
                        continue;
                    }
                }

                const heure = Math.floor(minutes / 60);
                const minute = minutes % 60;
                const heureFin = Math.floor((minutes + duree_minutes) / 60);
                const minuteFin = (minutes + duree_minutes) % 60;

                creneaux.push({
                    debut: `${heure.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
                    fin: `${heureFin.toString().padStart(2, '0')}:${minuteFin.toString().padStart(2, '0')}`,
                    disponible: true // À vérifier avec les réservations existantes
                });
            }

            res.json({
                status: 'success',
                data: creneaux,
                meta: {
                    date,
                    duree_minutes,
                    total_creneaux: creneaux.length
                }
            });

        } catch (error) {
            logError('Erreur récupération créneaux:', error);
            next(error);
        }
    }

    /**
     * Copier les horaires d'une entité vers une autre
     * @route POST /api/v1/horaires/copier
     * @access PRIVATE
     */
    async copyHoraires(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const {
                source_type,
                source_id,
                destination_type,
                destination_id
            } = req.body;

            // Vérifier les permissions
            await this._checkPermissions(req.user, destination_type, destination_id);

            // Récupérer les horaires source
            const sourceHoraires = await client.query(
                `SELECT * FROM HORAIRES 
                 WHERE entite_type = $1 AND entite_id = $2`,
                [source_type, source_id]
            );

            if (sourceHoraires.rows.length === 0) {
                throw new AppError('Aucun horaire trouvé pour la source', 404);
            }

            // Supprimer les anciens horaires de la destination
            await client.query(
                `DELETE FROM HORAIRES 
                 WHERE entite_type = $1 AND entite_id = $2`,
                [destination_type, destination_id]
            );

            // Copier les nouveaux
            for (const h of sourceHoraires.rows) {
                await client.query(
                    `INSERT INTO HORAIRES (
                        entite_type, entite_id, jour_semaine,
                        heure_ouverture, heure_fermeture,
                        heure_coupure_debut, heure_coupure_fin,
                        est_ouvert, date_creation
                     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
                    [
                        destination_type,
                        destination_id,
                        h.jour_semaine,
                        h.heure_ouverture,
                        h.heure_fermeture,
                        h.heure_coupure_debut,
                        h.heure_coupure_fin,
                        h.est_ouvert
                    ]
                );
            }

            await client.query('COMMIT');

            // Invalidation cache
            await CacheService.delPattern(`horaires:${destination_type}:${destination_id}:*`);

            res.json({
                status: 'success',
                message: 'Horaires copiés avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur copie horaires:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    // ==================== MÉTHODES PRIVÉES ====================

    /**
     * Valider les horaires d'un jour
     */
    _validateJourHoraire(horaire, nomJour) {
        if (!horaire.est_ouvert) {
            return;
        }

        if (!horaire.heure_ouverture || !horaire.heure_fermeture) {
            throw new ValidationError(`Pour ${nomJour}, les heures d'ouverture et fermeture sont requises si ouvert`);
        }

        const ouverture = this._timeToMinutes(horaire.heure_ouverture);
        const fermeture = this._timeToMinutes(horaire.heure_fermeture);

        if (fermeture <= ouverture) {
            throw new ValidationError(`Pour ${nomJour}, l'heure de fermeture doit être après l'heure d'ouverture`);
        }

        if (horaire.heure_coupure_debut && horaire.heure_coupure_fin) {
            const coupureDebut = this._timeToMinutes(horaire.heure_coupure_debut);
            const coupureFin = this._timeToMinutes(horaire.heure_coupure_fin);

            if (coupureFin <= coupureDebut) {
                throw new ValidationError(`Pour ${nomJour}, la fin de la pause doit être après le début`);
            }

            if (coupureDebut <= ouverture || coupureFin >= fermeture) {
                throw new ValidationError(`Pour ${nomJour}, la pause doit être dans les horaires d'ouverture`);
            }
        }
    }

    /**
     * Convertir une heure HH:MM en minutes
     */
    _timeToMinutes(time) {
        if (!time) return 0;
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
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
            'LIVREUR': 'LIVREURS'
        };

        const table = tables[entite_type];
        if (!table) {
            throw new ValidationError(`Type d'entité ${entite_type} non supporté pour les horaires`);
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
     * Vérifier les permissions
     */
    async _checkPermissions(user, entite_type, entite_id) {
        // Admin plateforme peut tout faire
        if (user.compte_role === 'ADMINISTRATEUR_PLATEFORME') {
            return;
        }

        let isOwner = false;

        switch (entite_type) {
            case 'BOUTIQUE':
                const boutique = await pool.query(
                    'SELECT proprietaire_id FROM BOUTIQUES WHERE id = $1',
                    [entite_id]
                );
                isOwner = boutique.rows[0]?.proprietaire_id === user.id;
                break;

            case 'RESTAURANT_FAST_FOOD':
                const resto = await pool.query(
                    'SELECT proprietaire_id FROM RESTAURANTSFASTFOOD WHERE id = $1',
                    [entite_id]
                );
                isOwner = resto.rows[0]?.proprietaire_id === user.id;
                break;

            case 'COMPAGNIE_TRANSPORT':
                // Vérifier si l'utilisateur est admin de la compagnie
                const compte = await pool.query(
                    'SELECT compagnie_id FROM COMPTES WHERE id = $1',
                    [user.id]
                );
                isOwner = compte.rows[0]?.compagnie_id === parseInt(entite_id);
                break;
        }

        if (!isOwner) {
            throw new AppError('Vous n\'êtes pas autorisé à modifier ces horaires', 403);
        }
    }
}

module.exports = new HoraireController();