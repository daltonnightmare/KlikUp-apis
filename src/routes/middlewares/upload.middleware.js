// src/routes/middlewares/upload.middleware.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ValidationError } = require('../../utils/errors/AppError');
const { v4: uuidv4 } = require('uuid');

class UploadMiddleware {
    constructor() {
        // Configuration des dossiers d'upload
        this.uploadDirs = {
            images: 'uploads/images',
            documents: 'uploads/documents',
            avatars: 'uploads/avatars',
            articles: 'uploads/articles',
            produits: 'uploads/produits',
            temp: 'uploads/temp'
        };

        // Créer les dossiers s'ils n'existent pas
        this.createUploadDirs();
    }

    /**
     * Configuration du stockage
     */
    get storage() {
        return multer.diskStorage({
            destination: (req, file, cb) => {
                let uploadDir = this.uploadDirs.temp;
                
                // Déterminer le dossier selon le type de fichier
                if (file.mimetype.startsWith('image/')) {
                    uploadDir = this.uploadDirs.images;
                } else if (this.isDocument(file.mimetype)) {
                    uploadDir = this.uploadDirs.documents;
                }

                cb(null, uploadDir);
            },
            filename: (req, file, cb) => {
                const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
                cb(null, uniqueName);
            }
        });
    }

    /**
     * Filtre des fichiers
     */
    get fileFilter() {
        return (req, file, cb) => {
            // Images
            if (file.fieldname === 'image' || file.fieldname.includes('photo')) {
                if (!file.mimetype.startsWith('image/')) {
                    return cb(new ValidationError('Le fichier doit être une image'), false);
                }
            }
            
            // Documents
            if (file.fieldname === 'document') {
                if (!this.isDocument(file.mimetype)) {
                    return cb(new ValidationError('Type de document non supporté'), false);
                }
            }

            cb(null, true);
        };
    }

    /**
     * Upload simple (un seul fichier)
     */
    single(fieldName, options = {}) {
        const upload = multer({
            storage: this.storage,
            fileFilter: this.fileFilter,
            limits: {
                fileSize: options.maxSize || 5 * 1024 * 1024, // 5MB par défaut
                files: 1
            }
        }).single(fieldName);

        return (req, res, next) => {
            upload(req, res, (err) => {
                if (err instanceof multer.MulterError) {
                    if (err.code === 'LIMIT_FILE_SIZE') {
                        return next(new ValidationError(`Fichier trop volumineux (max: ${options.maxSize / 1024 / 1024}MB)`));
                    }
                    return next(new ValidationError(err.message));
                }
                if (err) return next(err);
                
                // Ajouter les informations du fichier à req.uploadedFile
                if (req.file) {
                    req.uploadedFile = {
                        path: req.file.path,
                        filename: req.file.filename,
                        originalname: req.file.originalname,
                        size: req.file.size,
                        mimetype: req.file.mimetype,
                        url: `/uploads/${req.file.filename}`
                    };
                }
                
                next();
            });
        };
    }

    /**
     * Upload multiple (plusieurs fichiers)
     */
    multiple(fieldName, maxCount = 5, options = {}) {
        const upload = multer({
            storage: this.storage,
            fileFilter: this.fileFilter,
            limits: {
                fileSize: options.maxSize || 5 * 1024 * 1024,
                files: maxCount
            }
        }).array(fieldName, maxCount);

        return (req, res, next) => {
            upload(req, res, (err) => {
                if (err instanceof multer.MulterError) {
                    if (err.code === 'LIMIT_FILE_SIZE') {
                        return next(new ValidationError(`Fichier trop volumineux (max: ${options.maxSize / 1024 / 1024}MB)`));
                    }
                    if (err.code === 'LIMIT_FILE_COUNT') {
                        return next(new ValidationError(`Trop de fichiers (max: ${maxCount})`));
                    }
                    return next(new ValidationError(err.message));
                }
                if (err) return next(err);
                
                // Ajouter les informations des fichiers
                if (req.files && req.files.length > 0) {
                    req.uploadedFiles = req.files.map(file => ({
                        path: file.path,
                        filename: file.filename,
                        originalname: file.originalname,
                        size: file.size,
                        mimetype: file.mimetype,
                        url: `/uploads/${file.filename}`
                    }));
                }
                
                next();
            });
        };
    }

    /**
     * Upload avec différents champs
     */
    fields(fieldConfig, options = {}) {
        const upload = multer({
            storage: this.storage,
            fileFilter: this.fileFilter,
            limits: {
                fileSize: options.maxSize || 5 * 1024 * 1024,
                files: options.maxFiles || 10
            }
        }).fields(fieldConfig);

        return (req, res, next) => {
            upload(req, res, (err) => {
                if (err instanceof multer.MulterError) {
                    return next(new ValidationError(err.message));
                }
                if (err) return next(err);
                
                // Organiser les fichiers par champ
                if (req.files) {
                    req.uploadedFiles = {};
                    for (const [field, files] of Object.entries(req.files)) {
                        req.uploadedFiles[field] = files.map(file => ({
                            path: file.path,
                            filename: file.filename,
                            originalname: file.originalname,
                            size: file.size,
                            mimetype: file.mimetype,
                            url: `/uploads/${file.filename}`
                        }));
                    }
                }
                
                next();
            });
        };
    }

    /**
     * Middleware pour les images (avec redimensionnement optionnel)
     */
    image(options = {}) {
        const {
            fieldName = 'image',
            maxSize = 5 * 1024 * 1024,
            dimensions = null,
            required = false
        } = options;

        const upload = this.single(fieldName, { maxSize });

        return async (req, res, next) => {
            // Vérifier si requis
            if (required && !req.files && !req.file) {
                return next(new ValidationError(`Image ${fieldName} requise`));
            }

            upload(req, res, async (err) => {
                if (err) return next(err);

                if (req.file && dimensions) {
                    try {
                        // Redimensionner l'image
                        const sharp = require('sharp');
                        const imagePath = req.file.path;
                        const image = sharp(imagePath);
                        
                        const metadata = await image.metadata();
                        
                        if (metadata.width > dimensions.width || metadata.height > dimensions.height) {
                            await image
                                .resize(dimensions.width, dimensions.height, {
                                    fit: 'inside',
                                    withoutEnlargement: true
                                })
                                .toFile(req.file.path.replace(/(\.[^.]+)$/, '_resized$1'));
                            
                            // Remplacer par l'image redimensionnée
                            req.file.path = req.file.path.replace(/(\.[^.]+)$/, '_resized$1');
                        }
                    } catch (error) {
                        console.error('Erreur redimensionnement image:', error);
                    }
                }

                next();
            });
        };
    }

    /**
     * Vérifier si le type MIME est un document
     */
    isDocument(mimetype) {
        const documentTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain'
        ];
        return documentTypes.includes(mimetype);
    }

    /**
     * Créer les dossiers d'upload
     */
    createUploadDirs() {
        Object.values(this.uploadDirs).forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    /**
     * Nettoyer les fichiers temporaires
     */
    async cleanupTempFiles() {
        const tempDir = this.uploadDirs.temp;
        const files = fs.readdirSync(tempDir);
        const now = Date.now();

        for (const file of files) {
            const filePath = path.join(tempDir, file);
            const stats = fs.statSync(filePath);
            const age = now - stats.mtimeMs;

            // Supprimer les fichiers plus vieux que 24h
            if (age > 24 * 60 * 60 * 1000) {
                fs.unlinkSync(filePath);
            }
        }
    }
}

module.exports = new UploadMiddleware();