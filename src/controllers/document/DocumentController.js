// src/controllers/document/DocumentController.js
const pool = require('../../configuration/database');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const FileService = require('../../services/file/FileService');
const EncryptionService = require('../../services/security/SecurityService');
const AuditService = require('../../services/audit/AuditService');
const NotificationService = require('../../services/notification/NotificationService');
const CacheService = require('../../services/cache/CacheService');
const { logInfo, logError, logWarn } = require('../../configuration/logger');
const { TYPE_DOCUMENT, STATUT_DOCUMENT, ENTITE_REFERENCE } = require('../../utils/constants/enums');

class DocumentController {
    /**
     * Uploader un nouveau document
     * @route POST /api/v1/documents
     * @access PRIVATE
     */
    async upload(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const {
                type_document,
                entite_type,
                entite_id,
                numero_document,
                date_emission,
                date_expiration,
                autorite_emettrice,
                est_chiffre = true
            } = req.body;

            // 1. VALIDATIONS
            if (!type_document || !Object.values(TYPE_DOCUMENT).includes(type_document)) {
                throw new ValidationError('Type de document invalide');
            }

            if (!entite_type || !entite_id) {
                throw new ValidationError('Type et ID d\'entité requis');
            }

            if (!req.files || !req.files.document) {
                throw new ValidationError('Fichier document requis');
            }

            // 2. VÉRIFIER QUE L'ENTITÉ EXISTE
            await this._checkEntityExists(client, entite_type, entite_id);

            // 3. VÉRIFIER LES PERMISSIONS
            await this._checkUploadPermissions(req.user, entite_type, entite_id);

            // 4. TRAITER LE FICHIER
            const file = req.files.document;
            const fileExt = path.extname(file.name).toLowerCase();
            const allowedExtensions = this._getAllowedExtensions(type_document);

            if (!allowedExtensions.includes(fileExt)) {
                throw new ValidationError(`Format non autorisé pour ce type de document. Formats acceptés: ${allowedExtensions.join(', ')}`);
            }

            // 5. GÉNÉRER LE HASH DU FICHIER
            const fileHash = await this._generateFileHash(file.data);

            // 6. VÉRIFIER LES DOUBLONS
            const existingDoc = await client.query(
                `SELECT id FROM DOCUMENTS 
                 WHERE entite_type = $1 AND entite_id = $2 
                 AND type_document = $3 AND hash_fichier = $4`,
                [entite_type, entite_id, type_document, fileHash]
            );

            if (existingDoc.rows.length > 0) {
                throw new ValidationError('Ce document a déjà été uploadé');
            }

            // 7. UPLOADER LE FICHIER
            const uploadPath = await FileService.uploadFile(file, {
                path: `documents/${entite_type.toLowerCase()}/${entite_id}/${type_document.toLowerCase()}`,
                maxSize: this._getMaxSize(type_document),
                allowedTypes: this._getAllowedMimeTypes(type_document),
                encrypt: est_chiffre
            });

            // 8. CRÉER L'ENTRÉE EN BASE
            const result = await client.query(
                `INSERT INTO DOCUMENTS (
                    uuid_document,
                    type_document,
                    nom_fichier,
                    chemin_fichier,
                    mime_type,
                    taille_fichier,
                    entite_type,
                    entite_id,
                    numero_document,
                    date_emission,
                    date_expiration,
                    autorite_emettrice,
                    statut,
                    est_chiffre,
                    hash_fichier,
                    date_upload,
                    date_mise_a_jour
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
                RETURNING *`,
                [
                    crypto.randomUUID(),
                    type_document,
                    file.name,
                    uploadPath,
                    file.mimetype,
                    file.size,
                    entite_type,
                    entite_id,
                    numero_document || null,
                    date_emission || null,
                    date_expiration || null,
                    autorite_emettrice || null,
                    'EN_ATTENTE_VALIDATION',
                    est_chiffre,
                    fileHash
                ]
            );

            const document = result.rows[0];

            // 9. AUDIT LOG
            await AuditService.log({
                action: 'UPLOAD',
                ressource_type: 'DOCUMENT',
                ressource_id: document.id,
                donnees_apres: document,
                utilisateur_id: req.user.id,
                adresse_ip: req.ip,
                metadata: { type_document, entite_type, entite_id }
            });

            // 10. NOTIFIER LES ADMINS SI NÉCESSAIRE
            if (this._requiresValidation(type_document)) {
                await this._notifyAdminsForValidation(document);
            }

            await client.query('COMMIT');

            logInfo(`Document uploadé: ${document.id} - ${type_document} pour ${entite_type}:${entite_id}`);

            res.status(201).json({
                status: 'success',
                data: {
                    id: document.id,
                    uuid: document.uuid_document,
                    type_document: document.type_document,
                    nom_fichier: document.nom_fichier,
                    statut: document.statut,
                    date_upload: document.date_upload,
                    date_expiration: document.date_expiration
                },
                message: 'Document uploadé avec succès et en attente de validation'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur upload document:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer tous les documents d'une entité
     * @route GET /api/v1/documents/entite/:type/:id
     * @access PRIVATE
     */
    async findByEntity(req, res, next) {
        try {
            const { type, id } = req.params;
            const { statut, type_document, include_expired = false } = req.query;

            // Vérifier les permissions
            await this._checkViewPermissions(req.user, type, id);

            let query = `
                SELECT 
                    id,
                    uuid_document,
                    type_document,
                    nom_fichier,
                    mime_type,
                    taille_fichier,
                    numero_document,
                    date_emission,
                    date_expiration,
                    autorite_emettrice,
                    statut,
                    date_upload,
                    date_validation,
                    valide_par,
                    motif_refus,
                    CASE 
                        WHEN date_expiration IS NOT NULL 
                        THEN date_expiration < NOW()
                        ELSE false
                    END as est_expire
                FROM DOCUMENTS
                WHERE entite_type = $1 AND entite_id = $2
            `;
            const params = [type, id];
            let paramIndex = 3;

            if (statut) {
                query += ` AND statut = $${paramIndex}`;
                params.push(statut);
                paramIndex++;
            }

            if (type_document) {
                const types = type_document.split(',');
                query += ` AND type_document = ANY($${paramIndex}::text[])`;
                params.push(types);
                paramIndex++;
            }

            if (!include_expired) {
                query += ` AND (date_expiration IS NULL OR date_expiration >= NOW())`;
            }

            query += ` ORDER BY 
                CASE statut
                    WHEN 'EN_ATTENTE_VALIDATION' THEN 1
                    WHEN 'VALIDE' THEN 2
                    ELSE 3
                END,
                date_upload DESC`;

            const result = await pool.query(query, params);

            // Grouper par type de document
            const grouped = {};
            result.rows.forEach(doc => {
                if (!grouped[doc.type_document]) {
                    grouped[doc.type_document] = [];
                }
                grouped[doc.type_document].push(doc);
            });

            // Statistiques
            const stats = {
                total: result.rows.length,
                valides: result.rows.filter(d => d.statut === 'VALIDE').length,
                en_attente: result.rows.filter(d => d.statut === 'EN_ATTENTE_VALIDATION').length,
                expires: result.rows.filter(d => d.est_expire).length,
                par_type: Object.keys(grouped).map(type => ({
                    type,
                    count: grouped[type].length
                }))
            };

            res.json({
                status: 'success',
                data: grouped,
                statistiques: stats
            });

        } catch (error) {
            logError('Erreur récupération documents:', error);
            next(error);
        }
    }

    /**
     * Récupérer un document par ID
     * @route GET /api/v1/documents/:id
     * @access PRIVATE
     */
    async findById(req, res, next) {
        try {
            const { id } = req.params;

            const result = await pool.query(
                `SELECT 
                    d.*,
                    v.nom_utilisateur_compte as validateur_nom,
                    v.email as validateur_email
                FROM DOCUMENTS d
                LEFT JOIN COMPTES v ON v.id = d.valide_par
                WHERE d.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                throw new AppError('Document non trouvé', 404);
            }

            const document = result.rows[0];

            // Vérifier les permissions
            await this._checkViewPermissions(req.user, document.entite_type, document.entite_id);

            // Récupérer l'historique des validations
            const historique = await pool.query(
                `SELECT * FROM HISTORIQUE_VALIDATIONS_DOCUMENTS 
                 WHERE document_id = $1
                 ORDER BY date_action DESC`,
                [id]
            );

            document.historique_validations = historique.rows;

            res.json({
                status: 'success',
                data: document
            });

        } catch (error) {
            logError('Erreur récupération document:', error);
            next(error);
        }
    }

    /**
     * Télécharger un document
     * @route GET /api/v1/documents/:id/download
     * @access PRIVATE
     */
    async download(req, res, next) {
        try {
            const { id } = req.params;

            const document = await pool.query(
                'SELECT * FROM DOCUMENTS WHERE id = $1',
                [id]
            );

            if (document.rows.length === 0) {
                throw new AppError('Document non trouvé', 404);
            }

            const doc = document.rows[0];

            // Vérifier les permissions
            await this._checkViewPermissions(req.user, doc.entite_type, doc.entite_id);

            // Vérifier le statut
            if (doc.statut !== 'VALIDE' && req.user.compte_role !== 'ADMINISTRATEUR_PLATEFORME') {
                throw new AppError('Ce document n\'est pas encore validé', 403);
            }

            // Télécharger le fichier
            const fileStream = await FileService.downloadFile(doc.chemin_fichier, {
                decrypt: doc.est_chiffre
            });

            // Audit
            await AuditService.log({
                action: 'DOWNLOAD',
                ressource_type: 'DOCUMENT',
                ressource_id: id,
                utilisateur_id: req.user.id,
                adresse_ip: req.ip,
                metadata: { document_nom: doc.nom_fichier }
            });

            res.setHeader('Content-Type', doc.mime_type);
            res.setHeader('Content-Disposition', `attachment; filename="${doc.nom_fichier}"`);
            res.setHeader('Content-Length', doc.taille_fichier);

            fileStream.pipe(res);

        } catch (error) {
            logError('Erreur téléchargement document:', error);
            next(error);
        }
    }

    /**
     * Valider un document (admin)
     * @route POST /api/v1/documents/:id/valider
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async validate(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { commentaire } = req.body;

            const document = await client.query(
                'SELECT * FROM DOCUMENTS WHERE id = $1',
                [id]
            );

            if (document.rows.length === 0) {
                throw new AppError('Document non trouvé', 404);
            }

            const doc = document.rows[0];

            if (doc.statut !== 'EN_ATTENTE_VALIDATION') {
                throw new ValidationError('Ce document n\'est pas en attente de validation');
            }

            // Mettre à jour le statut
            await client.query(
                `UPDATE DOCUMENTS 
                 SET statut = 'VALIDE',
                     valide_par = $1,
                     date_validation = NOW(),
                     date_mise_a_jour = NOW()
                 WHERE id = $2`,
                [req.user.id, id]
            );

            // Historique
            await client.query(
                `INSERT INTO HISTORIQUE_VALIDATIONS_DOCUMENTS 
                 (document_id, ancien_statut, nouveau_statut, validateur_id, commentaire, date_action)
                 VALUES ($1, $2, $3, $4, $5, NOW())`,
                [id, doc.statut, 'VALIDE', req.user.id, commentaire]
            );

            // Notifier le propriétaire
            await this._notifyDocumentOwner(doc, 'VALIDE', commentaire);

            await client.query('COMMIT');

            logInfo(`Document ${id} validé par ${req.user.id}`);

            res.json({
                status: 'success',
                message: 'Document validé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur validation document:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Refuser un document (admin)
     * @route POST /api/v1/documents/:id/refuser
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async refuse(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { motif } = req.body;

            if (!motif) {
                throw new ValidationError('Un motif de refus est requis');
            }

            const document = await client.query(
                'SELECT * FROM DOCUMENTS WHERE id = $1',
                [id]
            );

            if (document.rows.length === 0) {
                throw new AppError('Document non trouvé', 404);
            }

            const doc = document.rows[0];

            await client.query(
                `UPDATE DOCUMENTS 
                 SET statut = 'REFUSE',
                     motif_refus = $1,
                     valide_par = $2,
                     date_validation = NOW(),
                     date_mise_a_jour = NOW()
                 WHERE id = $3`,
                [motif, req.user.id, id]
            );

            // Historique
            await client.query(
                `INSERT INTO HISTORIQUE_VALIDATIONS_DOCUMENTS 
                 (document_id, ancien_statut, nouveau_statut, validateur_id, commentaire, date_action)
                 VALUES ($1, $2, $3, $4, $5, NOW())`,
                [id, doc.statut, 'REFUSE', req.user.id, motif]
            );

            // Notifier le propriétaire
            await this._notifyDocumentOwner(doc, 'REFUSE', motif);

            await client.query('COMMIT');

            logInfo(`Document ${id} refusé par ${req.user.id}: ${motif}`);

            res.json({
                status: 'success',
                message: 'Document refusé'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur refus document:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Supprimer un document
     * @route DELETE /api/v1/documents/:id
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async delete(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;
            const { force = false } = req.body;

            const document = await client.query(
                'SELECT * FROM DOCUMENTS WHERE id = $1',
                [id]
            );

            if (document.rows.length === 0) {
                throw new AppError('Document non trouvé', 404);
            }

            const doc = document.rows[0];

            // Vérifier si le document est utilisé
            if (doc.statut === 'VALIDE' && !force) {
                throw new ValidationError(
                    'Ce document est validé et pourrait être utilisé. Utilisez force=true pour le supprimer quand même'
                );
            }

            // Supprimer le fichier physique
            try {
                await FileService.deleteFile(doc.chemin_fichier);
            } catch (fileError) {
                logWarn(`Fichier non trouvé: ${doc.chemin_fichier}`);
            }

            // Supprimer l'entrée en base
            await client.query('DELETE FROM DOCUMENTS WHERE id = $1', [id]);

            // Audit
            await AuditService.log({
                action: 'DELETE',
                ressource_type: 'DOCUMENT',
                ressource_id: id,
                donnees_avant: doc,
                utilisateur_id: req.user.id,
                adresse_ip: req.ip,
                metadata: { force }
            });

            await client.query('COMMIT');

            logInfo(`Document ${id} supprimé`);

            res.json({
                status: 'success',
                message: 'Document supprimé'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur suppression document:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Remplacer un document
     * @route POST /api/v1/documents/:id/remplacer
     * @access PRIVATE
     */
    async replace(req, res, next) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { id } = req.params;

            const ancienDocument = await client.query(
                'SELECT * FROM DOCUMENTS WHERE id = $1',
                [id]
            );

            if (ancienDocument.rows.length === 0) {
                throw new AppError('Document non trouvé', 404);
            }

            const ancien = ancienDocument.rows[0];

            // Marquer l'ancien comme remplacé
            await client.query(
                `UPDATE DOCUMENTS 
                 SET statut = 'REMPLACE',
                     date_mise_a_jour = NOW()
                 WHERE id = $1`,
                [id]
            );

            // Uploader le nouveau
            const nouveauDoc = await this._uploadNewVersion(req, ancien);

            // Lier les documents
            await client.query(
                `UPDATE DOCUMENTS 
                 SET document_remplacant_id = $1
                 WHERE id = $2`,
                [nouveauDoc.id, id]
            );

            await client.query('COMMIT');

            logInfo(`Document ${id} remplacé par ${nouveauDoc.id}`);

            res.json({
                status: 'success',
                data: nouveauDoc,
                message: 'Document remplacé avec succès'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logError('Erreur remplacement document:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    /**
     * Récupérer les documents en attente de validation (admin)
     * @route GET /api/v1/documents/en-attente
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getPendingDocuments(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                type_document,
                entite_type,
                days = 7
            } = req.query;

            const offset = (page - 1) * limit;
            const params = [];
            let paramIndex = 1;
            const conditions = ['statut = \'EN_ATTENTE_VALIDATION\''];

            if (type_document) {
                conditions.push(`type_document = $${paramIndex}`);
                params.push(type_document);
                paramIndex++;
            }

            if (entite_type) {
                conditions.push(`entite_type = $${paramIndex}`);
                params.push(entite_type);
                paramIndex++;
            }

            const query = `
                SELECT 
                    d.*,
                    EXTRACT(EPOCH FROM (NOW() - d.date_upload))/3600 as heures_attente,
                    CASE 
                        WHEN d.entite_type = 'COMPTE' THEN (SELECT email FROM COMPTES WHERE id = d.entite_id::int)
                        WHEN d.entite_type = 'BOUTIQUE' THEN (SELECT nom_boutique FROM BOUTIQUES WHERE id = d.entite_id::int)
                        ELSE NULL
                    END as entite_nom
                FROM DOCUMENTS d
                WHERE ${conditions.join(' AND ')}
                AND d.date_upload >= NOW() - $${paramIndex}::interval
                ORDER BY 
                    CASE 
                        WHEN EXTRACT(EPOCH FROM (NOW() - d.date_upload)) > 48*3600 THEN 1
                        ELSE 2
                    END,
                    d.date_upload ASC
                LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
            `;

            params.push(`${days} days`, parseInt(limit), offset);

            const result = await pool.query(query, params);

            // Statistiques
            const stats = await pool.query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE date_upload >= NOW() - INTERVAL '24 hours') as dernieres_24h,
                    AVG(EXTRACT(EPOCH FROM (NOW() - date_upload))/3600)::numeric(10,2) as attente_moyenne_heures
                FROM DOCUMENTS
                WHERE statut = 'EN_ATTENTE_VALIDATION'
            `);

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
            logError('Erreur récupération documents en attente:', error);
            next(error);
        }
    }

    /**
     * Récupérer les documents expirant bientôt
     * @route GET /api/v1/documents/expirant
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getExpiringDocuments(req, res, next) {
        try {
            const { days = 30 } = req.query;

            const result = await pool.query(`
                SELECT 
                    d.*,
                    (d.date_expiration - CURRENT_DATE) as jours_restants,
                    CASE 
                        WHEN d.entite_type = 'COMPTE' THEN (SELECT email FROM COMPTES WHERE id = d.entite_id::int)
                        WHEN d.entite_type = 'BOUTIQUE' THEN (SELECT nom_boutique || ' - ' || email_contact FROM BOUTIQUES WHERE id = d.entite_id::int)
                        ELSE NULL
                    END as contact
                FROM DOCUMENTS d
                WHERE d.statut = 'VALIDE'
                AND d.date_expiration IS NOT NULL
                AND d.date_expiration BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::interval
                ORDER BY d.date_expiration ASC`,
                [`${days} days`]
            );

            // Grouper par période
            const grouped = {
                imminent: result.rows.filter(d => d.jours_restants <= 7),
                bientot: result.rows.filter(d => d.jours_restants > 7 && d.jours_restants <= 15),
                dans_30j: result.rows.filter(d => d.jours_restants > 15)
            };

            res.json({
                status: 'success',
                data: grouped,
                total: result.rows.length
            });

        } catch (error) {
            logError('Erreur récupération documents expirant:', error);
            next(error);
        }
    }

    /**
     * Vérifier si une entité a tous ses documents requis
     * @route GET /api/v1/documents/verifier-completude/:entite_type/:entite_id
     * @access PRIVATE
     */
    async checkCompleteness(req, res, next) {
        try {
            const { entite_type, entite_id } = req.params;

            // Définir les documents requis selon le type d'entité
            const documentsRequis = this._getRequiredDocuments(entite_type);

            const documents = await pool.query(
                `SELECT type_document, statut, date_expiration
                 FROM DOCUMENTS
                 WHERE entite_type = $1 AND entite_id = $2
                 AND statut = 'VALIDE'`,
                [entite_type, entite_id]
            );

            const documentsValides = new Set(documents.rows.map(d => d.type_document));
            const documentsExpires = documents.rows.filter(d => 
                d.date_expiration && new Date(d.date_expiration) < new Date()
            );

            const manquants = documentsRequis.filter(doc => !documentsValides.has(doc));
            const expirés = documentsExpires.map(d => d.type_document);

            const completude = {
                complete: manquants.length === 0 && expirés.length === 0,
                total_requis: documentsRequis.length,
                total_valides: documentsValides.size,
                documents_manquants: manquants,
                documents_expires: expirés,
                pourcentage: Math.round((documentsValides.size / documentsRequis.length) * 100)
            };

            res.json({
                status: 'success',
                data: completude
            });

        } catch (error) {
            logError('Erreur vérification complétude:', error);
            next(error);
        }
    }

    /**
     * Obtenir les statistiques des documents
     * @route GET /api/v1/documents/stats
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getStats(req, res, next) {
        try {
            const stats = await pool.query(`
                WITH stats_globales AS (
                    SELECT 
                        COUNT(*) as total_documents,
                        COUNT(*) FILTER (WHERE statut = 'EN_ATTENTE_VALIDATION') as en_attente,
                        COUNT(*) FILTER (WHERE statut = 'VALIDE') as valides,
                        COUNT(*) FILTER (WHERE statut = 'REFUSE') as refuses,
                        COUNT(*) FILTER (WHERE statut = 'EXPIRE') as expires,
                        SUM(taille_fichier) as taille_totale_bytes,
                        AVG(taille_fichier) as taille_moyenne_bytes
                    FROM DOCUMENTS
                ),
                stats_par_type AS (
                    SELECT 
                        type_document,
                        COUNT(*) as total,
                        COUNT(*) FILTER (WHERE statut = 'EN_ATTENTE_VALIDATION') as en_attente,
                        COUNT(*) FILTER (WHERE statut = 'VALIDE') as valides
                    FROM DOCUMENTS
                    GROUP BY type_document
                ),
                stats_par_entite AS (
                    SELECT 
                        entite_type,
                        COUNT(*) as total,
                        COUNT(DISTINCT entite_id) as entites_concernees
                    FROM DOCUMENTS
                    GROUP BY entite_type
                ),
                evolution_par_jour AS (
                    SELECT 
                        DATE(date_upload) as date,
                        COUNT(*) as uploads
                    FROM DOCUMENTS
                    WHERE date_upload >= NOW() - INTERVAL '30 days'
                    GROUP BY DATE(date_upload)
                    ORDER BY date DESC
                )
                SELECT 
                    jsonb_build_object(
                        'global', row_to_json(sg),
                        'par_type', json_agg(st),
                        'par_entite', json_agg(se),
                        'evolution', json_agg(epj)
                    ) as stats
                FROM stats_globales sg
                CROSS JOIN stats_par_type st
                CROSS JOIN stats_par_entite se
                CROSS JOIN evolution_par_jour epj
                GROUP BY sg.total_documents, sg.en_attente, sg.valides, 
                         sg.refuses, sg.expires, sg.taille_totale_bytes, sg.taille_moyenne_bytes
            `);

            // Taille totale en unités lisibles
            const taille = stats.rows[0]?.stats?.global?.taille_totale_bytes || 0;
            const tailleFormatee = this._formatBytes(taille);

            res.json({
                status: 'success',
                data: {
                    ...stats.rows[0]?.stats,
                    taille_totale_formatee: tailleFormatee
                }
            });

        } catch (error) {
            logError('Erreur récupération stats documents:', error);
            next(error);
        }
    }

    // ==================== MÉTHODES PRIVÉES ====================

    /**
     * Vérifier qu'une entité existe
     */
    async _checkEntityExists(client, entite_type, entite_id) {
        const tables = {
            'PLATEFORME': 'PLATEFORME',
            'COMPTE': 'COMPTES',
            'BOUTIQUE': 'BOUTIQUES',
            'RESTAURANT_FAST_FOOD': 'RESTAURANTSFASTFOOD',
            'COMPAGNIE_TRANSPORT': 'COMPAGNIESTRANSPORT',
            'LIVREUR': 'LIVREURS'
        };

        const table = tables[entite_type];
        if (!table) {
            throw new ValidationError(`Type d'entité ${entite_type} non supporté`);
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
     * Vérifier les permissions d'upload
     */
    async _checkUploadPermissions(user, entite_type, entite_id) {
        // Admin peut tout faire
        if (user.compte_role === 'ADMINISTRATEUR_PLATEFORME') {
            return;
        }

        // Un utilisateur peut uploader ses propres documents
        if (entite_type === 'COMPTE' && parseInt(entite_id) === user.id) {
            return;
        }

        // Vérifier si l'utilisateur est propriétaire de l'entité
        let isOwner = false;

        if (entite_type === 'BOUTIQUE') {
            const boutique = await pool.query(
                'SELECT proprietaire_id FROM BOUTIQUES WHERE id = $1',
                [entite_id]
            );
            isOwner = boutique.rows[0]?.proprietaire_id === user.id;
        }

        if (!isOwner) {
            throw new AppError('Vous n\'êtes pas autorisé à uploader des documents pour cette entité', 403);
        }
    }

    /**
     * Vérifier les permissions de visualisation
     */
    async _checkViewPermissions(user, entite_type, entite_id) {
        // Admin peut tout voir
        if (user.compte_role === 'ADMINISTRATEUR_PLATEFORME') {
            return;
        }

        // Un utilisateur peut voir ses propres documents
        if (entite_type === 'COMPTE' && parseInt(entite_id) === user.id) {
            return;
        }

        // Vérifier si l'utilisateur est propriétaire
        let isOwner = false;

        if (entite_type === 'BOUTIQUE') {
            const boutique = await pool.query(
                'SELECT proprietaire_id FROM BOUTIQUES WHERE id = $1',
                [entite_id]
            );
            isOwner = boutique.rows[0]?.proprietaire_id === user.id;
        }

        if (!isOwner) {
            throw new AppError('Vous n\'êtes pas autorisé à voir ces documents', 403);
        }
    }

    /**
     * Obtenir les extensions autorisées par type de document
     */
    _getAllowedExtensions(type_document) {
        const extensions = {
            'CNI_RECTO': ['.jpg', '.jpeg', '.png', '.pdf'],
            'CNI_VERSO': ['.jpg', '.jpeg', '.png', '.pdf'],
            'PASSEPORT': ['.jpg', '.jpeg', '.png', '.pdf'],
            'PERMIS_CONDUIRE': ['.jpg', '.jpeg', '.png', '.pdf'],
            'JUSTIFICATIF_DOMICILE': ['.pdf', '.jpg', '.jpeg', '.png'],
            'EXTRAIT_NAISSANCE': ['.pdf'],
            'REGISTRE_COMMERCE': ['.pdf'],
            'ATTESTATION_FISCALE': ['.pdf'],
            'CONTRAT': ['.pdf', '.doc', '.docx'],
            'FACTURE': ['.pdf', '.jpg', '.jpeg', '.png'],
            'PHOTO_LIVREUR': ['.jpg', '.jpeg', '.png'],
            'AUTRE': ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx']
        };
        return extensions[type_document] || ['.pdf', '.jpg', '.jpeg', '.png'];
    }

    /**
     * Obtenir les types MIME autorisés
     */
    _getAllowedMimeTypes(type_document) {
        return [
            'image/jpeg',
            'image/png',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
    }

    /**
     * Obtenir la taille maximale par type
     */
    _getMaxSize(type_document) {
        const sizes = {
            'PHOTO_LIVREUR': 2 * 1024 * 1024, // 2MB
            'CNI_RECTO': 5 * 1024 * 1024, // 5MB
            'CNI_VERSO': 5 * 1024 * 1024,
            'PASSEPORT': 5 * 1024 * 1024,
            'CONTRAT': 10 * 1024 * 1024, // 10MB
            'AUTRE': 10 * 1024 * 1024
        };
        return sizes[type_document] || 5 * 1024 * 1024; // 5MB par défaut
    }

    /**
     * Vérifier si un document nécessite une validation
     */
    _requiresValidation(type_document) {
        const typesAValider = [
            'CNI_RECTO',
            'CNI_VERSO',
            'PASSEPORT',
            'PERMIS_CONDUIRE',
            'REGISTRE_COMMERCE',
            'ATTESTATION_FISCALE'
        ];
        return typesAValider.includes(type_document);
    }

    /**
     * Obtenir les documents requis par type d'entité
     */
    _getRequiredDocuments(entite_type) {
        const required = {
            'COMPTE': ['CNI_RECTO', 'CNI_VERSO'],
            'BOUTIQUE': ['REGISTRE_COMMERCE', 'ATTESTATION_FISCALE', 'CNI_RECTO'],
            'LIVREUR': ['CNI_RECTO', 'CNI_VERSO', 'PERMIS_CONDUIRE', 'PHOTO_LIVREUR'],
            'RESTAURANT_FAST_FOOD': ['REGISTRE_COMMERCE', 'ATTESTATION_FISCALE', 'CNI_RECTO']
        };
        return required[entite_type] || [];
    }

    /**
     * Générer le hash d'un fichier
     */
    async _generateFileHash(data) {
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    /**
     * Notifier les admins pour validation
     */
    async _notifyAdminsForValidation(document) {
        await NotificationService.notifyAdmins({
            type: 'DOCUMENT_EN_ATTENTE',
            titre: '📄 Document en attente de validation',
            message: `Un document ${document.type_document} nécessite une validation`,
            priorite: 'NORMALE',
            donnees: {
                document_id: document.id,
                type: document.type_document,
                entite_type: document.entite_type,
                entite_id: document.entite_id,
                date_upload: document.date_upload
            }
        });
    }

    /**
     * Notifier le propriétaire du document
     */
    async _notifyDocumentOwner(document, statut, commentaire) {
        let userId = null;

        if (document.entite_type === 'COMPTE') {
            userId = document.entite_id;
        } else if (document.entite_type === 'BOUTIQUE') {
            const boutique = await pool.query(
                'SELECT proprietaire_id FROM BOUTIQUES WHERE id = $1',
                [document.entite_id]
            );
            userId = boutique.rows[0]?.proprietaire_id;
        }

        if (userId) {
            const messages = {
                'VALIDE': {
                    titre: '✅ Document validé',
                    message: `Votre document ${document.type_document} a été validé`
                },
                'REFUSE': {
                    titre: '❌ Document refusé',
                    message: `Votre document ${document.type_document} a été refusé: ${commentaire}`
                }
            };

            await NotificationService.notifyUser(userId, {
                type: `DOCUMENT_${statut}`,
                titre: messages[statut].titre,
                message: messages[statut].message,
                donnees: { document_id: document.id, commentaire }
            });
        }
    }

    /**
     * Uploader une nouvelle version
     */
    async _uploadNewVersion(req, ancienDocument) {
        const file = req.files.document;
        const fileExt = path.extname(file.name).toLowerCase();
        const allowedExtensions = this._getAllowedExtensions(ancienDocument.type_document);

        if (!allowedExtensions.includes(fileExt)) {
            throw new ValidationError('Format non autorisé');
        }

        const uploadPath = await FileService.uploadFile(file, {
            path: `documents/${ancienDocument.entite_type.toLowerCase()}/${ancienDocument.entite_id}/${ancienDocument.type_document.toLowerCase()}/versions`,
            maxSize: this._getMaxSize(ancienDocument.type_document),
            encrypt: ancienDocument.est_chiffre
        });

        const result = await pool.query(
            `INSERT INTO DOCUMENTS (
                uuid_document,
                type_document,
                nom_fichier,
                chemin_fichier,
                mime_type,
                taille_fichier,
                entite_type,
                entite_id,
                numero_document,
                date_emission,
                date_expiration,
                autorite_emettrice,
                statut,
                est_chiffre,
                date_upload,
                document_remplace_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), $15)
            RETURNING *`,
            [
                crypto.randomUUID(),
                ancienDocument.type_document,
                file.name,
                uploadPath,
                file.mimetype,
                file.size,
                ancienDocument.entite_type,
                ancienDocument.entite_id,
                ancienDocument.numero_document,
                ancienDocument.date_emission,
                ancienDocument.date_expiration,
                ancienDocument.autorite_emettrice,
                'EN_ATTENTE_VALIDATION',
                ancienDocument.est_chiffre,
                ancienDocument.id
            ]
        );

        return result.rows[0];
    }

    /**
     * Formater la taille en unités lisibles
     */
    _formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
}

module.exports = new DocumentController();