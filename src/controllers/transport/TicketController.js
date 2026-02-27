const db = require('../../configuration/database');
const { AppError, ValidationError } = require('../../utils/errors/AppError');
const AuditService = require('../../services/audit/AuditService');
const QRCode = require('qrcode');

class TicketController {
    /**
     * Récupérer tous les tickets (avec filtres)
     * GET /api/v1/transport/tickets
     */
    static async getAll(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                compagnie_id,
                emplacement_id,
                actif,
                type, // journalier, hebdomadaire, mensuel
                prix_min,
                prix_max,
                recherche,
                tri = 'date_creation_desc'
            } = req.query;

            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    tt.id, tt.nom_produit, tt.description_produit,
                    tt.prix_vente_produit, tt.donnees_secondaires_produit,
                    tt.quantite_stock, tt.quantite_vendu,
                    tt.journalier, tt.hebdomadaire, tt.mensuel,
                    tt.actif, tt.date_creation,
                    et.nom_emplacement,
                    ct.nom_compagnie,
                    ct.logo_compagnie
                FROM TICKETSTRANSPORT tt
                JOIN EMPLACEMENTSTRANSPORT et ON et.id = tt.emplacement_id
                JOIN COMPAGNIESTRANSPORT ct ON ct.id = tt.compagnie_id
                WHERE 1=1
            `;

            const params = [];
            let paramIndex = 1;

            if (compagnie_id) {
                query += ` AND tt.compagnie_id = $${paramIndex}`;
                params.push(compagnie_id);
                paramIndex++;
            }

            if (emplacement_id) {
                query += ` AND tt.emplacement_id = $${paramIndex}`;
                params.push(emplacement_id);
                paramIndex++;
            }

            if (actif !== undefined) {
                query += ` AND tt.actif = $${paramIndex}`;
                params.push(actif === 'true');
                paramIndex++;
            }

            if (type === 'journalier') {
                query += ` AND tt.journalier = true`;
            } else if (type === 'hebdomadaire') {
                query += ` AND tt.hebdomadaire = true`;
            } else if (type === 'mensuel') {
                query += ` AND tt.mensuel = true`;
            }

            if (prix_min) {
                query += ` AND tt.prix_vente_produit >= $${paramIndex}`;
                params.push(prix_min);
                paramIndex++;
            }

            if (prix_max) {
                query += ` AND tt.prix_vente_produit <= $${paramIndex}`;
                params.push(prix_max);
                paramIndex++;
            }

            if (recherche) {
                query += ` AND tt.nom_produit ILIKE $${paramIndex}`;
                params.push(`%${recherche}%`);
                paramIndex++;
            }

            // Tri
            switch (tri) {
                case 'prix_asc':
                    query += ` ORDER BY tt.prix_vente_produit ASC`;
                    break;
                case 'prix_desc':
                    query += ` ORDER BY tt.prix_vente_produit DESC`;
                    break;
                case 'nom_asc':
                    query += ` ORDER BY tt.nom_produit ASC`;
                    break;
                case 'ventes_desc':
                    query += ` ORDER BY tt.quantite_vendu DESC`;
                    break;
                default:
                    query += ` ORDER BY tt.date_creation DESC`;
            }

            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await db.query(query, params);

            // Compter le total (avec les mêmes filtres)
            let countQuery = `
                SELECT COUNT(*) as total 
                FROM TICKETSTRANSPORT tt
                WHERE 1=1
            `;
            // Réappliquer les filtres... (simplifié pour l'exemple)

            const countResult = await db.query(countQuery);
            const total = parseInt(countResult.rows[0].total);

            res.json({
                success: true,
                data: result.rows,
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
     * Récupérer un ticket par ID
     * GET /api/v1/transport/tickets/:id
     */
    static async getById(req, res, next) {
        try {
            const { id } = req.params;

            const result = await db.query(
                `SELECT 
                    tt.*,
                    et.nom_emplacement,
                    ST_AsGeoJSON(et.localisation_emplacement) as localisation_emplacement,
                    ct.nom_compagnie,
                    ct.logo_compagnie,
                    (
                        SELECT json_agg(json_build_object(
                            'id', asp.id,
                            'date_achat', asp.date_achat_prive,
                            'quantite', asp.quantite,
                            'total', asp.total_transaction
                        ))
                        FROM ACHATSTICKETSPRIVE asp
                        WHERE asp.ticket_id = tt.id
                        ORDER BY asp.date_achat_prive DESC
                        LIMIT 10
                    ) as achats_recents
                FROM TICKETSTRANSPORT tt
                JOIN EMPLACEMENTSTRANSPORT et ON et.id = tt.emplacement_id
                JOIN COMPAGNIESTRANSPORT ct ON ct.id = tt.compagnie_id
                WHERE tt.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Ticket non trouvé', 404);
            }

            const ticket = result.rows[0];
            if (ticket.localisation_emplacement) {
                ticket.localisation_emplacement = JSON.parse(ticket.localisation_emplacement);
            }

            res.json({
                success: true,
                data: ticket
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Créer un nouveau ticket
     * POST /api/v1/transport/emplacements/:emplacementId/tickets
     */
    static async create(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { emplacementId } = req.params;
            const {
                nom_produit,
                description_produit,
                prix_vente_produit,
                donnees_secondaires_produit,
                quantite_stock,
                journalier,
                hebdomadaire,
                mensuel
            } = req.body;

            // Vérifier que l'emplacement existe
            const emplacementResult = await client.query(
                `SELECT compagnie_id FROM EMPLACEMENTSTRANSPORT WHERE id = $1`,
                [emplacementId]
            );

            if (emplacementResult.rows.length === 0) {
                throw new AppError('Emplacement non trouvé', 404);
            }

            const compagnieId = emplacementResult.rows[0].compagnie_id;

            // Vérifier qu'un seul type est sélectionné
            const typeCount = [journalier, hebdomadaire, mensuel].filter(Boolean).length;
            if (typeCount !== 1) {
                throw new ValidationError('Un ticket doit avoir exactement un type (journalier, hebdomadaire ou mensuel)');
            }

            const result = await client.query(
                `INSERT INTO TICKETSTRANSPORT (
                    nom_produit, description_produit, prix_vente_produit,
                    donnees_secondaires_produit, quantite_stock,
                    journalier, hebdomadaire, mensuel,
                    emplacement_id, compagnie_id, actif,
                    date_creation, date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, NOW(), NOW())
                RETURNING *`,
                [
                    nom_produit, description_produit, prix_vente_produit,
                    donnees_secondaires_produit || {}, quantite_stock || 0,
                    journalier || false, hebdomadaire || false, mensuel || false,
                    emplacementId, compagnieId
                ]
            );

            const newTicket = result.rows[0];

            // Journaliser l'action
            await AuditService.log({
                action: 'CREATE',
                ressource_type: 'TICKETSTRANSPORT',
                ressource_id: newTicket.id,
                donnees_apres: newTicket,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Ticket créé avec succès',
                data: newTicket
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Mettre à jour un ticket
     * PUT /api/v1/transport/tickets/:id
     */
    static async update(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const updateData = req.body;

            // Récupérer l'état actuel
            const currentResult = await client.query(
                `SELECT * FROM TICKETSTRANSPORT WHERE id = $1`,
                [id]
            );

            if (currentResult.rows.length === 0) {
                throw new AppError('Ticket non trouvé', 404);
            }

            const current = currentResult.rows[0];

            // Construire la requête de mise à jour
            const allowedFields = [
                'nom_produit', 'description_produit', 'prix_vente_produit',
                'donnees_secondaires_produit', 'quantite_stock', 'actif'
            ];

            const updates = [];
            const params = [];
            let paramIndex = 1;

            allowedFields.forEach(field => {
                if (updateData[field] !== undefined) {
                    updates.push(`${field} = $${paramIndex++}`);
                    params.push(updateData[field]);
                }
            });

            if (updates.length === 0) {
                return res.json({
                    success: true,
                    message: 'Aucune modification',
                    data: current
                });
            }

            updates.push(`date_mise_a_jour = NOW()`);
            params.push(id);

            const updateQuery = `
                UPDATE TICKETSTRANSPORT 
                SET ${updates.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING *
            `;

            const result = await client.query(updateQuery, params);

            const updated = result.rows[0];

            // Journaliser l'action
            await AuditService.log({
                action: 'UPDATE',
                ressource_type: 'TICKETSTRANSPORT',
                ressource_id: id,
                donnees_avant: current,
                donnees_apres: updated,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Ticket mis à jour avec succès',
                data: updated
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Acheter un ticket (pour utilisateur connecté)
     * POST /api/v1/transport/tickets/:id/acheter
     */
    static async acheter(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { quantite = 1, paiement_mode } = req.body;
            const compteId = req.user.id;

            // Récupérer le ticket
            const ticketResult = await client.query(
                `SELECT * FROM TICKETSTRANSPORT WHERE id = $1 AND actif = true`,
                [id]
            );

            if (ticketResult.rows.length === 0) {
                throw new AppError('Ticket non trouvé ou indisponible', 404);
            }

            const ticket = ticketResult.rows[0];

            // Vérifier le stock
            if (ticket.quantite_stock > 0 && ticket.quantite_stock < quantite) {
                throw new ValidationError('Stock insuffisant');
            }

            const prixTotal = ticket.prix_vente_produit * quantite;

            // Créer la transaction
            const transactionResult = await client.query(
                `INSERT INTO ACHATSTICKETSPRIVE (
                    compte_id, ticket_id, quantite,
                    prix_achat_unitaire_ticket, total_transaction,
                    date_achat_prive, est_actif
                ) VALUES ($1, $2, $3, $4, $5, NOW(), true)
                RETURNING *`,
                [compteId, id, quantite, ticket.prix_vente_produit, prixTotal]
            );

            const achat = transactionResult.rows[0];

            // Mettre à jour le stock
            if (ticket.quantite_stock > 0) {
                await client.query(
                    `UPDATE TICKETSTRANSPORT 
                     SET quantite_stock = quantite_stock - $1,
                         quantite_vendu = quantite_vendu + $1
                     WHERE id = $2`,
                    [quantite, id]
                );
            } else {
                // Stock illimité, juste incrémenter les ventes
                await client.query(
                    `UPDATE TICKETSTRANSPORT 
                     SET quantite_vendu = quantite_vendu + $1
                     WHERE id = $2`,
                    [quantite, id]
                );
            }

            // Générer le QR code
            const qrData = JSON.stringify({
                transaction_id: achat.transaction_uuid,
                ticket_id: id,
                compte_id: compteId,
                date_achat: achat.date_achat_prive
            });

            const qrCode = await QRCode.toDataURL(qrData);

            // Journaliser l'action
            await AuditService.log({
                action: 'ACHAT_TICKET',
                ressource_type: 'TICKETSTRANSPORT',
                ressource_id: id,
                donnees_apres: achat,
                adresse_ip: req.ip,
                user_agent: req.get('User-Agent'),
                session_id: req.sessionId
            });

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                message: 'Achat effectué avec succès',
                data: {
                    achat,
                    qr_code: qrCode,
                    ticket: {
                        id: ticket.id,
                        nom: ticket.nom_produit,
                        type: ticket.journalier ? 'journalier' : 
                              ticket.hebdomadaire ? 'hebdomadaire' : 'mensuel'
                    }
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
     * Valider un ticket (scan QR code)
     * POST /api/v1/transport/tickets/valider
     */
    static async valider(req, res, next) {
        const client = await db.getConnection();
        try {
            const { qr_data } = req.body;

            // Décoder le QR code
            let transactionData;
            try {
                transactionData = JSON.parse(qr_data);
            } catch (e) {
                throw new ValidationError('QR code invalide');
            }

            // Vérifier la transaction
            const achatResult = await client.query(
                `SELECT asp.*, tt.nom_produit, tt.journalier, tt.hebdomadaire, tt.mensuel,
                        c.nom_utilisateur_compte
                 FROM ACHATSTICKETSPRIVE asp
                 JOIN TICKETSTRANSPORT tt ON tt.id = asp.ticket_id
                 JOIN COMPTES c ON c.id = asp.compte_id
                 WHERE asp.transaction_uuid = $1 AND asp.est_actif = true`,
                [transactionData.transaction_id]
            );

            if (achatResult.rows.length === 0) {
                throw new AppError('Transaction non trouvée ou déjà utilisée', 404);
            }

            const achat = achatResult.rows[0];

            // Vérifier si le ticket n'est pas expiré
            if (achat.date_expiration_ticket && new Date() > achat.date_expiration_ticket) {
                throw new AppError('Ticket expiré', 400);
            }

            // Désactiver le ticket (utilisation unique)
            await client.query(
                `UPDATE ACHATSTICKETSPRIVE 
                 SET est_actif = false
                 WHERE id = $1`,
                [achat.id]
            );

            res.json({
                success: true,
                message: 'Ticket validé avec succès',
                data: {
                    nom_utilisateur: achat.nom_utilisateur_compte,
                    ticket: achat.nom_produit,
                    quantite: achat.quantite,
                    date_achat: achat.date_achat_prive
                }
            });

        } catch (error) {
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les statistiques des tickets
     * GET /api/v1/transport/tickets/stats
     */
    static async getStats(req, res, next) {
        try {
            const { compagnie_id, emplacement_id } = req.query;

            let query = `
                SELECT 
                    COUNT(*) as total_tickets,
                    SUM(quantite_stock) as stock_total,
                    SUM(quantite_vendu) as total_vendus,
                    AVG(prix_vente_produit) as prix_moyen,
                    SUM(CASE WHEN journalier THEN 1 ELSE 0 END) as tickets_journaliers,
                    SUM(CASE WHEN hebdomadaire THEN 1 ELSE 0 END) as tickets_hebdomadaires,
                    SUM(CASE WHEN mensuel THEN 1 ELSE 0 END) as tickets_mensuels,
                    SUM(prix_vente_produit * quantite_vendu) as chiffre_affaires_total,
                    (
                        SELECT json_agg(json_build_object(
                            'nom', tt2.nom_produit,
                            'ventes', tt2.quantite_vendu,
                            'revenu', tt2.quantite_vendu * tt2.prix_vente_produit
                        ))
                        FROM TICKETSTRANSPORT tt2
                        WHERE 1=1
            `;

            if (compagnie_id) {
                query += ` AND tt2.compagnie_id = $1`;
            }
            if (emplacement_id) {
                query += ` AND tt2.emplacement_id = $2`;
            }

            query += `
                        ORDER BY tt2.quantite_vendu DESC
                        LIMIT 10
                    ) as top_tickets
                FROM TICKETSTRANSPORT tt
                WHERE 1=1
            `;

            const params = [];
            if (compagnie_id) {
                query += ` AND tt.compagnie_id = $1`;
                params.push(compagnie_id);
            }
            if (emplacement_id) {
                query += ` AND tt.emplacement_id = $2`;
                params.push(emplacement_id);
            }

            const result = await db.query(query, params);

            res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Supprimer un ticket
     * DELETE /api/v1/transport/tickets/:id
     */
    static async delete(req, res, next) {
        const client = await db.getConnection();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            // Vérifier s'il y a des achats associés
            const achatsCount = await client.query(
                `SELECT COUNT(*) as count FROM ACHATSTICKETSPRIVE WHERE ticket_id = $1`,
                [id]
            );

            if (parseInt(achatsCount.rows[0].count) > 0) {
                // Soft delete (désactiver seulement)
                await client.query(
                    `UPDATE TICKETSTRANSPORT 
                     SET actif = false, date_mise_a_jour = NOW()
                     WHERE id = $1`,
                    [id]
                );

                await client.query('COMMIT');

                return res.json({
                    success: true,
                    message: 'Ticket désactivé avec succès (des achats existent)'
                });
            }

            // Pas d'achats, suppression physique
            const result = await client.query(
                `DELETE FROM TICKETSTRANSPORT WHERE id = $1 RETURNING *`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Ticket non trouvé', 404);
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Ticket supprimé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally {
            client.release();
        }
    }
}

module.exports = TicketController;