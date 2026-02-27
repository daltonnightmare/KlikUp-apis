// src/configuration/storage.js
const fs = require('fs').promises;
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const logger = require('./logger');
const env = require('./env');
const sharp = require('sharp');

class Storage {
    constructor() {
        this.driver = env.STORAGE_DRIVER || 'local';
        this.basePath = env.UPLOAD_PATH || path.join(process.cwd(), 'uploads');
        this.s3Client = null;
        this.initialized = false;
    }

    /**
     * Initialiser le stockage
     */
    async initialize() {
        try {
            // Créer les dossiers nécessaires
            await this.ensureDirectories();

            if (this.driver === 's3') {
                this.s3Client = new S3Client({
                    region: env.AWS_REGION,
                    credentials: {
                        accessKeyId: env.AWS_ACCESS_KEY_ID,
                        secretAccessKey: env.AWS_SECRET_ACCESS_KEY
                    }
                });
            }

            this.initialized = true;
            logger.info(`Stockage initialisé avec le driver: ${this.driver}`);
        } catch (error) {
            logger.error('Erreur initialisation stockage:', error);
            throw error;
        }
    }

    /**
     * Créer les dossiers nécessaires
     */
    async ensureDirectories() {
        if (this.driver !== 'local') return;

        const directories = [
            this.basePath,
            path.join(this.basePath, 'images'),
            path.join(this.basePath, 'documents'),
            path.join(this.basePath, 'avatars'),
            path.join(this.basePath, 'articles'),
            path.join(this.basePath, 'produits'),
            path.join(this.basePath, 'temp')
        ];

        for (const dir of directories) {
            try {
                await fs.access(dir);
            } catch {
                await fs.mkdir(dir, { recursive: true });
                logger.debug(`Dossier créé: ${dir}`);
            }
        }
    }

    /**
     * Sauvegarder un fichier
     */
    async save(file, options = {}) {
        const {
            directory = 'temp',
            filename = null,
            resize = null,
            quality = 80
        } = options;

        try {
            let buffer = file.buffer || await fs.readFile(file.path);
            let processedBuffer = buffer;

            // Redimensionner si demandé
            if (resize && file.mimetype?.startsWith('image/')) {
                processedBuffer = await this.resizeImage(buffer, resize, quality);
            }

            const finalFilename = filename || this.generateFilename(file);
            const relativePath = path.join(directory, finalFilename);
            const fullPath = path.join(this.basePath, relativePath);

            if (this.driver === 'local') {
                await fs.writeFile(fullPath, processedBuffer);
                
                return {
                    path: relativePath,
                    filename: finalFilename,
                    size: processedBuffer.length,
                    url: `/uploads/${relativePath}`,
                    driver: 'local'
                };
            } else {
                // Upload vers S3
                const key = relativePath.replace(/\\/g, '/');
                
                await this.s3Client.send(new PutObjectCommand({
                    Bucket: env.AWS_BUCKET,
                    Key: key,
                    Body: processedBuffer,
                    ContentType: file.mimetype,
                    ACL: 'public-read'
                }));

                return {
                    path: key,
                    filename: finalFilename,
                    size: processedBuffer.length,
                    url: `https://${env.AWS_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`,
                    driver: 's3'
                };
            }
        } catch (error) {
            logger.error('Erreur sauvegarde fichier:', error);
            throw error;
        }
    }

    /**
     * Sauvegarder plusieurs fichiers
     */
    async saveMany(files, options = {}) {
        const results = [];
        
        for (const file of files) {
            const result = await this.save(file, options);
            results.push(result);
        }

        return results;
    }

    /**
     * Lire un fichier
     */
    async read(filePath) {
        try {
            if (this.driver === 'local') {
                const fullPath = path.join(this.basePath, filePath);
                return await fs.readFile(fullPath);
            } else {
                const command = new GetObjectCommand({
                    Bucket: env.AWS_BUCKET,
                    Key: filePath
                });

                const response = await this.s3Client.send(command);
                return response.Body;
            }
        } catch (error) {
            logger.error(`Erreur lecture fichier ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Supprimer un fichier
     */
    async delete(filePath) {
        try {
            if (this.driver === 'local') {
                const fullPath = path.join(this.basePath, filePath);
                await fs.unlink(fullPath);
            } else {
                await this.s3Client.send(new DeleteObjectCommand({
                    Bucket: env.AWS_BUCKET,
                    Key: filePath
                }));
            }

            logger.debug(`Fichier supprimé: ${filePath}`);
            return true;
        } catch (error) {
            logger.error(`Erreur suppression fichier ${filePath}:`, error);
            return false;
        }
    }

    /**
     * Supprimer plusieurs fichiers
     */
    async deleteMany(filePaths) {
        const results = [];
        
        for (const filePath of filePaths) {
            const result = await this.delete(filePath);
            results.push({ filePath, success: result });
        }

        return results;
    }

    /**
     * Obtenir une URL signée pour un fichier privé
     */
    async getSignedUrl(filePath, expiresIn = 3600) {
        if (this.driver !== 's3') {
            return `/uploads/${filePath}`;
        }

        try {
            const command = new GetObjectCommand({
                Bucket: env.AWS_BUCKET,
                Key: filePath
            });

            return await getSignedUrl(this.s3Client, command, { expiresIn });
        } catch (error) {
            logger.error(`Erreur génération URL signée ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Vérifier si un fichier existe
     */
    async exists(filePath) {
        try {
            if (this.driver === 'local') {
                const fullPath = path.join(this.basePath, filePath);
                await fs.access(fullPath);
                return true;
            } else {
                // Pour S3, on peut faire un head object
                return true; // Simplifié
            }
        } catch {
            return false;
        }
    }

    /**
     * Obtenir les métadonnées d'un fichier
     */
    async getMetadata(filePath) {
        try {
            if (this.driver === 'local') {
                const fullPath = path.join(this.basePath, filePath);
                const stats = await fs.stat(fullPath);
                
                return {
                    size: stats.size,
                    created: stats.birthtime,
                    modified: stats.mtime,
                    isFile: stats.isFile(),
                    isDirectory: stats.isDirectory()
                };
            } else {
                // Pour S3
                return {
                    size: 0,
                    created: new Date(),
                    modified: new Date()
                };
            }
        } catch (error) {
            logger.error(`Erreur métadonnées ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Lister les fichiers d'un dossier
     */
    async list(directory = '', pattern = null) {
        try {
            if (this.driver === 'local') {
                const fullPath = path.join(this.basePath, directory);
                const files = await fs.readdir(fullPath);
                
                const results = [];
                for (const file of files) {
                    if (!pattern || file.match(pattern)) {
                        const filePath = path.join(directory, file);
                        const metadata = await this.getMetadata(filePath);
                        results.push({
                            name: file,
                            path: filePath,
                            ...metadata
                        });
                    }
                }
                
                return results;
            } else {
                // Pour S3, implémentation simplifiée
                return [];
            }
        } catch (error) {
            logger.error(`Erreur listage dossier ${directory}:`, error);
            return [];
        }
    }

    /**
     * Copier un fichier
     */
    async copy(sourcePath, destPath) {
        try {
            const content = await this.read(sourcePath);
            const tempFile = {
                buffer: content,
                mimetype: this.getMimeType(sourcePath)
            };
            
            return await this.save(tempFile, {
                filename: path.basename(destPath),
                directory: path.dirname(destPath)
            });
        } catch (error) {
            logger.error(`Erreur copie fichier ${sourcePath}:`, error);
            throw error;
        }
    }

    /**
     * Déplacer un fichier
     */
    async move(sourcePath, destPath) {
        try {
            const result = await this.copy(sourcePath, destPath);
            await this.delete(sourcePath);
            return result;
        } catch (error) {
            logger.error(`Erreur déplacement fichier ${sourcePath}:`, error);
            throw error;
        }
    }

    /**
     * Redimensionner une image
     */
    async resizeImage(buffer, options, quality = 80) {
        try {
            const {
                width = null,
                height = null,
                fit = 'cover',
                format = null
            } = options;

            let pipeline = sharp(buffer);

            if (width || height) {
                pipeline = pipeline.resize(width, height, {
                    fit,
                    withoutEnlargement: true
                });
            }

            if (format) {
                pipeline = pipeline.toFormat(format, { quality });
            }

            return await pipeline.toBuffer();
        } catch (error) {
            logger.error('Erreur redimensionnement image:', error);
            return buffer;
        }
    }

    /**
     * Générer un nom de fichier unique
     */
    generateFilename(file) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 15);
        const extension = path.extname(file.originalname || file.name || 'file');
        
        return `${timestamp}-${random}${extension}`;
    }

    /**
     * Obtenir le type MIME à partir de l'extension
     */
    getMimeType(filename) {
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xls': 'application/vnd.ms-excel',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.txt': 'text/plain'
        };

        return mimeTypes[ext] || 'application/octet-stream';
    }

    /**
     * Nettoyer les fichiers temporaires
     */
    async cleanupTemp(maxAge = 24 * 60 * 60 * 1000) { // 24h par défaut
        try {
            const tempDir = path.join(this.basePath, 'temp');
            const files = await fs.readdir(tempDir);
            const now = Date.now();

            for (const file of files) {
                const filePath = path.join(tempDir, file);
                const stats = await fs.stat(filePath);
                const age = now - stats.mtimeMs;

                if (age > maxAge) {
                    await fs.unlink(filePath);
                    logger.debug(`Fichier temporaire supprimé: ${file}`);
                }
            }

            logger.info('Nettoyage des fichiers temporaires terminé');
        } catch (error) {
            logger.error('Erreur nettoyage fichiers temporaires:', error);
        }
    }

    /**
     * Obtenir l'URL publique d'un fichier
     */
    getPublicUrl(filePath) {
        if (this.driver === 'local') {
            return `/uploads/${filePath}`;
        } else {
            return `https://${env.AWS_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${filePath}`;
        }
    }

    /**
     * Vérifier la santé du stockage
     */
    async healthCheck() {
        try {
            const testFile = {
                originalname: 'test.txt',
                buffer: Buffer.from('test')
            };

            const start = Date.now();
            const result = await this.save(testFile, { directory: 'temp' });
            const latency = Date.now() - start;

            await this.delete(result.path);

            return {
                status: 'healthy',
                driver: this.driver,
                latency: `${latency}ms`,
                writable: true,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                driver: this.driver,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}

module.exports = new Storage();