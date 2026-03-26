// src/controllers/public/CommandesPubliquesController.js
const db = require('../../configuration/database');
const { ValidationError } = require('../../utils/errors/AppError');
const EmailService = require('../../services/email/EmailService');
const SmsService = require('../../services/sms/SmsService');
const { v4: uuidv4 } = require('uuid');

class CommandesPubliquesController {
    /**
     * Créer une commande restaurant (sans compte)
     * @route POST /api/v1/public/commandes/restaurant
     */
    async createCommandeRestaurant(req, res, next) {
        const client = await db.getClient();
        
        try {
            await client.query('BEGIN');

            const {
                emplacement_id,
                items, // [{ menu_id, quantite, prix_unitaire }]
                nom_client,
                email_client,
                telephone_client,
                mode_livraison, // 'livraison' ou 'recuperation'
                adresse_livraison,
                notes
            } = req.body;

            // Validation
            if (!emplacement_id || !items || items.length === 0) {
                throw new ValidationError('Données de commande invalides');
            }

            if (mode_livraison === 'livraison' && !adresse_livraison) {
                throw new ValidationError('Adresse de livraison requise');
            }

            // Calculer les totaux
            const sous_total = items.reduce((sum, item) => 
                sum + (item.prix_unitaire * item.quantite), 0
            );

            // Récupérer les frais de livraison de l'emplacement
            let frais_livraison = 0;
            if (mode_livraison === 'livraison') {
                const emplacement = await client.query(
                    `SELECT frais_livraison FROM EMPLACEMENTSRESTAURANTFASTFOOD WHERE id = $1`,
                    [emplacement_id]
                );
                frais_livraison = parseFloat(emplacement.rows[0]?.frais_livraison || 0);
            }

            const total = sous_total + frais_livraison;

            // Créer ou récupérer l'adresse de livraison
            let adresse_livraison_id = null;
            if (mode_livraison === 'livraison' && adresse_livraison) {
                const adresseResult = await client.query(`
                    INSERT INTO ADRESSES (ligne_1, ville, pays)
                    VALUES ($1, $2, 'Burkina Faso')
                    RETURNING id
                `, [adresse_livraison.ligne_1, adresse_livraison.ville || 'Ouagadougou']);
                adresse_livraison_id = adresseResult.rows[0].id;
            }

            // Créer la commande
            const commandeResult = await client.query(`
                INSERT INTO COMMANDESEMPLACEMENTFASTFOOD (
                    id_restaurant_fast_food_emplacement,
                    donnees_commande,
                    prix_sous_total,
                    frais_livraison_commande,
                    prix_total_commande,
                    pour_livrer,
                    passer_recuperer,
                    paiement_direct,
                    notes_commande,
                    adresse_livraison_id
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
                ) RETURNING id, reference_commande
            `, [
                emplacement_id,
                JSON.stringify(items),
                sous_total,
                frais_livraison,
                total,
                mode_livraison === 'livraison',
                mode_livraison === 'recuperation',
                true, // paiement direct en ligne
                notes,
                adresse_livraison_id
            ]);

            const commande = commandeResult.rows[0];

            // Sauvegarder les infos client dans une table temporaire ou une file d'attente
            // (Optionnel) Envoyer les confirmations
            await this.sendCommandeConfirmations({
                ...commande,
                nom_client,
                email_client,
                telephone_client,
                items,
                total,
                mode_livraison
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: {
                    commande_id: commande.id,
                    reference: commande.reference_commande,
                    total,
                    message: 'Commande créée avec succès'
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
     * Créer une commande boutique (sans compte)
     * @route POST /api/v1/public/commandes/boutique
     */
    async createCommandeBoutique(req, res, next) {
        const client = await db.getClient();
        
        try {
            await client.query('BEGIN');

            const {
                boutique_id,
                items, // [{ produit_id, quantite, prix_unitaire }]
                nom_client,
                email_client,
                telephone_client,
                adresse_livraison,
                notes
            } = req.body;

            // Validation
            if (!boutique_id || !items || items.length === 0) {
                throw new ValidationError('Données de commande invalides');
            }

            if (!adresse_livraison) {
                throw new ValidationError('Adresse de livraison requise');
            }

            // Calculer les totaux
            const sous_total = items.reduce((sum, item) => 
                sum + (item.prix_unitaire * item.quantite), 0
            );

            // Frais de livraison (à calculer selon la distance, etc.)
            const frais_livraison = 2000; // À rendre dynamique
            const total = sous_total + frais_livraison;

            // Créer l'adresse de livraison
            const adresseResult = await client.query(`
                INSERT INTO ADRESSES (ligne_1, ville, pays)
                VALUES ($1, $2, 'Burkina Faso')
                RETURNING id
            `, [adresse_livraison.ligne_1, adresse_livraison.ville || 'Ouagadougou']);

            // Créer la commande
            const commandeResult = await client.query(`
                INSERT INTO COMMANDESBOUTIQUES (
                    id_boutique,
                    donnees_commandes,
                    prix_sous_total,
                    frais_livraison_commande,
                    prix_total_commande,
                    pour_livrer,
                    paiement_direct,
                    notes_commande,
                    adresse_livraison_id
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9
                ) RETURNING id, reference_commande
            `, [
                boutique_id,
                JSON.stringify(items),
                sous_total,
                frais_livraison,
                total,
                true, // pour livrer
                true, // paiement direct
                notes,
                adresseResult.rows[0].id
            ]);

            const commande = commandeResult.rows[0];

            // (Optionnel) Envoyer les confirmations
            await this.sendCommandeConfirmations({
                ...commande,
                nom_client,
                email_client,
                telephone_client,
                items,
                total,
                type: 'boutique'
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: {
                    commande_id: commande.id,
                    reference: commande.reference_commande,
                    total,
                    message: 'Commande créée avec succès'
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
     * Suivre une commande par référence
     * @route GET /api/v1/public/commandes/suivi/:reference
     */
    async suivreCommande(req, res, next) {
        try {
            const { reference } = req.params;

            // Chercher dans les commandes restaurant
            let commande = await db.query(`
                SELECT 
                    'restaurant' as type,
                    c.reference_commande as reference,
                    c.statut_commande as statut,
                    c.date_commande,
                    c.prix_total_commande as total,
                    c.pour_livrer,
                    c.passer_recuperer,
                    e.nom_emplacement,
                    r.nom_restaurant_fast_food as nom_etablissement,
                    c.donnees_commande as items
                FROM COMMANDESEMPLACEMENTFASTFOOD c
                JOIN EMPLACEMENTSRESTAURANTFASTFOOD e ON e.id = c.id_restaurant_fast_food_emplacement
                JOIN RESTAURANTSFASTFOOD r ON r.id = e.id_restaurant_fast_food
                WHERE c.reference_commande = $1
            `, [reference]);

            // Si pas trouvé, chercher dans les commandes boutique
            if (commande.rows.length === 0) {
                commande = await db.query(`
                    SELECT 
                        'boutique' as type,
                        c.reference_commande as reference,
                        c.statut_commande as statut,
                        c.date_commande,
                        c.prix_total_commande as total,
                        true as pour_livrer,
                        false as passer_recuperer,
                        NULL as nom_emplacement,
                        b.nom_boutique as nom_etablissement,
                        c.donnees_commandes as items
                    FROM COMMANDESBOUTIQUES c
                    JOIN BOUTIQUES b ON b.id = c.id_boutique
                    WHERE c.reference_commande = $1
                `, [reference]);
            }

            if (commande.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Commande non trouvée'
                });
            }

            res.json({
                success: true,
                data: commande.rows[0]
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Annuler une commande (dans un délai)
     * @route POST /api/v1/public/commandes/:reference/annuler
     */
    async annulerCommande(req, res, next) {
        try {
            const { reference } = req.params;
            const { raison } = req.body;

            // Chercher et annuler la commande
            const result = await db.query(`
                UPDATE COMMANDESEMPLACEMENTFASTFOOD
                SET statut_commande = 'ANNULEE',
                    notes_commande = CONCAT(notes_commande, E'\nAnnulation: ', $2)
                WHERE reference_commande = $1 
                  AND statut_commande IN ('EN_ATTENTE', 'CONFIRMEE')
                RETURNING id, reference_commande
            `, [reference, raison || 'Annulation client']);

            if (result.rows.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Impossible d\'annuler cette commande (délai dépassé ou déjà traitée)'
                });
            }

            res.json({
                success: true,
                message: 'Commande annulée avec succès'
            });

        } catch (error) {
            next(error);
        }
    }

    // Méthodes privées
    async sendCommandeConfirmations(commande) {
        try {
            // Envoyer email si fourni
            if (commande.email_client) {
                await EmailService.send({
                    to: commande.email_client,
                    template: 'confirmation_commande',
                    data: commande
                });
            }

            // Envoyer SMS si fourni
            if (commande.telephone_client) {
                await SmsService.send({
                    to: commande.telephone_client,
                    message: `Votre commande ${commande.reference} a été enregistrée. Total: ${commande.total} FCFA. Suivez-la sur notre site.`
                });
            }
        } catch (error) {
            console.error('Erreur envoi confirmations:', error);
        }
    }
}

module.exports = new CommandesPubliquesController();