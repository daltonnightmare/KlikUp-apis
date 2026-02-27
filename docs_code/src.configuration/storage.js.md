```markdown
# Module de Stockage - storage.js

## 📋 Vue d'ensemble

Ce module fournit un système de stockage de fichiers unifié supportant deux drivers : **local** (système de fichiers) et **S3** (AWS). Il offre une interface cohérente pour toutes les opérations de gestion de fichiers avec des fonctionnalités avancées comme le redimensionnement d'images, les URLs signées, et le nettoyage automatique.

## 🏗️ Architecture

### Classe `Storage`

La classe principale qui encapsule toute la logique de gestion des fichiers.

#### Constructeur
```javascript
constructor()
```
Initialise le gestionnaire de stockage avec :
- `driver` : Type de stockage ('local' ou 's3')
- `basePath` : Chemin de base pour le stockage local
- `s3Client` : Client AWS S3 (si driver s3)
- `initialized` : État d'initialisation

## 🔧 Fonctionnalités principales

### 1. Initialisation (`initialize()`)

Crée la structure de dossiers nécessaire pour le stockage local :

```
📁 uploads/
├── 📁 images/
├── 📁 documents/
├── 📁 avatars/
├── 📁 articles/
├── 📁 produits/
└── 📁 temp/
```

Pour S3, initialise le client AWS :

```javascript
this.s3Client = new S3Client({
    region: env.AWS_REGION,
    credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY
    }
});
```

### 2. Opérations principales

| Méthode | Description | Support Local | Support S3 |
|---------|-------------|---------------|------------|
| `save(file, options)` | Sauvegarde un fichier | ✅ | ✅ |
| `saveMany(files, options)` | Sauvegarde plusieurs fichiers | ✅ | ✅ |
| `read(filePath)` | Lit un fichier | ✅ | ✅ |
| `delete(filePath)` | Supprime un fichier | ✅ | ✅ |
| `deleteMany(filePaths)` | Supprime plusieurs fichiers | ✅ | ✅ |
| `exists(filePath)` | Vérifie l'existence | ✅ | ✅ |
| `getMetadata(filePath)` | Métadonnées du fichier | ✅ | ✅ |
| `list(directory, pattern)` | Liste les fichiers | ✅ | ✅ |
| `copy(source, dest)` | Copie un fichier | ✅ | ✅ |
| `move(source, dest)` | Déplace un fichier | ✅ | ✅ |

### 3. Traitement d'images

Le module utilise **sharp** pour le traitement d'images :

```javascript
async resizeImage(buffer, options, quality = 80) {
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
}
```

### 4. URLs signées (S3)

Pour les fichiers privés, génère des URLs temporaires :

```javascript
async getSignedUrl(filePath, expiresIn = 3600) {
    const command = new GetObjectCommand({
        Bucket: env.AWS_BUCKET,
        Key: filePath
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn });
}
```

### 5. Gestion des fichiers temporaires

```javascript
async cleanupTemp(maxAge = 24 * 60 * 60 * 1000) {
    const tempDir = path.join(this.basePath, 'temp');
    const files = await fs.readdir(tempDir);
    const now = Date.now();

    for (const file of files) {
        const filePath = path.join(tempDir, file);
        const stats = await fs.stat(filePath);
        const age = now - stats.mtimeMs;

        if (age > maxAge) {
            await fs.unlink(filePath);
        }
    }
}
```

## 📦 Installation et configuration

### Prérequis

```bash
# Pour le stockage local uniquement
npm install sharp

# Pour AWS S3
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### Configuration dans `.env`

```env
# Driver de stockage (local ou s3)
STORAGE_DRIVER=local

# Pour stockage local
UPLOAD_PATH=./uploads

# Pour AWS S3
AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AWS_REGION=eu-west-3
AWS_BUCKET=mon-bucket
```

## 🚀 Utilisation

### Initialisation

```javascript
// Dans app.js
const storage = require('./configuration/storage');

async function startServer() {
    await storage.initialize();
    // ... reste de l'initialisation
}
```

### Upload de fichiers (Express + Multer)

```javascript
// controllers/uploadController.js
const storage = require('../configuration/storage');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

class UploadController {
    // Upload simple
    async uploadFile(req, res) {
        try {
            const file = req.file;
            
            const result = await storage.save(file, {
                directory: 'documents',
                filename: `doc-${Date.now()}${path.extname(file.originalname)}`
            });

            res.json({
                success: true,
                file: result
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // Upload avec redimensionnement
    async uploadImage(req, res) {
        try {
            const file = req.file;
            
            const result = await storage.save(file, {
                directory: 'images',
                resize: {
                    width: 800,
                    height: 600,
                    fit: 'cover',
                    format: 'webp'
                },
                quality: 85
            });

            res.json({
                success: true,
                file: result
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // Upload multiple
    async uploadMultiple(req, res) {
        try {
            const files = req.files;
            
            const results = await storage.saveMany(files, {
                directory: 'documents'
            });

            res.json({
                success: true,
                files: results
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
}

// Routes
router.post('/upload', upload.single('file'), uploadController.uploadFile);
router.post('/upload-image', upload.single('image'), uploadController.uploadImage);
router.post('/upload-multiple', upload.array('files', 10), uploadController.uploadMultiple);
```

### Avatar utilisateur avec différentes tailles

```javascript
// services/avatarService.js
const storage = require('../configuration/storage');

class AvatarService {
    async uploadAvatar(userId, file) {
        // Sauvegarder l'original
        const original = await storage.save(file, {
            directory: `avatars/${userId}/original`,
            filename: `original${path.extname(file.originalname)}`
        });

        // Générer différentes tailles
        const sizes = [
            { width: 32, height: 32, name: 'small' },
            { width: 64, height: 64, name: 'medium' },
            { width: 128, height: 128, name: 'large' }
        ];

        const variations = [];

        for (const size of sizes) {
            const result = await storage.save(file, {
                directory: `avatars/${userId}/${size.name}`,
                filename: `avatar-${size.name}.webp`,
                resize: {
                    width: size.width,
                    height: size.height,
                    fit: 'cover',
                    format: 'webp'
                },
                quality: 90
            });

            variations.push({
                size: size.name,
                ...result
            });
        }

        return {
            userId,
            original,
            variations
        };
    }

    async deleteAvatar(userId) {
        // Supprimer tous les fichiers de l'utilisateur
        const files = await storage.list(`avatars/${userId}`);
        
        for (const file of files) {
            await storage.delete(file.path);
        }
    }

    getAvatarUrl(userId, size = 'medium') {
        return storage.getPublicUrl(`avatars/${userId}/${size}/avatar-${size}.webp`);
    }
}
```

### Gestion des images d'articles

```javascript
// services/articleImageService.js
const storage = require('../configuration/storage');

class ArticleImageService {
    async uploadArticleImages(articleId, files) {
        const results = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            
            // Image principale (première image)
            const isMain = i === 0;
            
            // Sauvegarder l'image
            const result = await storage.save(file, {
                directory: `articles/${articleId}`,
                filename: `${isMain ? 'main' : `image-${i}`}.webp`,
                resize: {
                    width: isMain ? 1200 : 800,
                    height: isMain ? 800 : 600,
                    fit: 'cover',
                    format: 'webp'
                },
                quality: 85
            });

            // Générer une miniature
            const thumbnail = await storage.save(file, {
                directory: `articles/${articleId}/thumbnails`,
                filename: `thumb-${i}.webp`,
                resize: {
                    width: 150,
                    height: 150,
                    fit: 'cover',
                    format: 'webp'
                },
                quality: 70
            });

            results.push({
                ...result,
                thumbnail: thumbnail.url,
                isMain
            });
        }

        return results;
    }

    async deleteArticleImages(articleId) {
        await storage.deleteMany([
            `articles/${articleId}`,
            `articles/${articleId}/thumbnails`
        ]);
    }

    async getArticleImages(articleId) {
        const images = await storage.list(`articles/${articleId}`);
        const thumbnails = await storage.list(`articles/${articleId}/thumbnails`);
        
        return {
            main: images.find(img => img.name.startsWith('main')),
            others: images.filter(img => !img.name.startsWith('main')),
            thumbnails
        };
    }
}
```

### Upload de documents avec validation

```javascript
// middleware/uploadValidation.js
const storage = require('../configuration/storage');

const ALLOWED_MIME_TYPES = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/gif': ['.gif'],
    'image/webp': ['.webp'],
    'application/pdf': ['.pdf'],
    'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'application/vnd.ms-excel': ['.xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
};

const MAX_SIZES = {
    'image': 5 * 1024 * 1024, // 5MB
    'document': 10 * 1024 * 1024, // 10MB
    'default': 2 * 1024 * 1024 // 2MB
};

function validateUpload(options = {}) {
    return (req, res, next) => {
        if (!req.file && !req.files) {
            return res.status(400).json({ error: 'Aucun fichier fourni' });
        }

        const files = req.files || [req.file];

        for (const file of files) {
            // Vérifier le type MIME
            if (!ALLOWED_MIME_TYPES[file.mimetype]) {
                return res.status(400).json({
                    error: `Type de fichier non autorisé: ${file.mimetype}`
                });
            }

            // Vérifier la taille
            const category = file.mimetype.startsWith('image/') ? 'image' : 'document';
            const maxSize = options.maxSize || MAX_SIZES[category] || MAX_SIZES.default;

            if (file.size > maxSize) {
                return res.status(400).json({
                    error: `Fichier trop volumineux. Maximum: ${maxSize / 1024 / 1024}MB`
                });
            }
        }

        next();
    };
}

// Utilisation
router.post('/upload/document',
    upload.single('document'),
    validateUpload({ maxSize: 20 * 1024 * 1024 }),
    uploadController.uploadFile
);
```

### Export de données avec fichiers temporaires

```javascript
// services/exportService.js
const storage = require('../configuration/storage');
const ExcelJS = require('exceljs');

class ExportService {
    async exportToExcel(data, options = {}) {
        const {
            filename = `export-${Date.now()}.xlsx`,
            sheetName = 'Données'
        } = options;

        // Créer le workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(sheetName);

        // Ajouter les données
        if (data.length > 0) {
            worksheet.columns = Object.keys(data[0]).map(key => ({
                header: key,
                key
            }));
            worksheet.addRows(data);
        }

        // Générer le buffer
        const buffer = await workbook.xlsx.writeBuffer();

        // Sauvegarder dans temp
        const tempFile = {
            buffer,
            originalname: filename,
            mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        };

        const result = await storage.save(tempFile, {
            directory: 'temp/exports',
            filename
        });

        // Générer URL signée pour téléchargement
        const signedUrl = await storage.getSignedUrl(result.path, 3600); // 1 heure

        // Programmer le nettoyage
        setTimeout(async () => {
            await storage.delete(result.path);
        }, 3600000); // Supprimer après 1 heure

        return {
            ...result,
            signedUrl,
            expiresIn: 3600
        };
    }

    async exportToCSV(data, options = {}) {
        const {
            filename = `export-${Date.now()}.csv`
        } = options;

        // Convertir en CSV
        const headers = Object.keys(data[0] || {}).join(',');
        const rows = data.map(row => 
            Object.values(row).map(value => 
                typeof value === 'string' ? `"${value}"` : value
            ).join(',')
        );
        const csv = [headers, ...rows].join('\n');

        const tempFile = {
            buffer: Buffer.from(csv, 'utf-8'),
            originalname: filename,
            mimetype: 'text/csv'
        };

        const result = await storage.save(tempFile, {
            directory: 'temp/exports',
            filename
        });

        return result;
    }
}
```

### Service de galerie d'images

```javascript
// services/galleryService.js
const storage = require('../configuration/storage');

class GalleryService {
    constructor(galleryId) {
        this.galleryId = galleryId;
        this.basePath = `galleries/${galleryId}`;
    }

    async addImage(file, options = {}) {
        const {
            title = '',
            description = '',
            isCover = false
        } = options;

        // Générer différentes versions
        const versions = {};

        // Version originale
        const original = await storage.save(file, {
            directory: `${this.basePath}/original`,
            filename: `${Date.now()}-original${path.extname(file.originalname)}`
        });

        // Version grand format
        const large = await storage.save(file, {
            directory: `${this.basePath}/large`,
            filename: `${Date.now()}-large.webp`,
            resize: {
                width: 1920,
                height: 1080,
                fit: 'inside',
                format: 'webp'
            },
            quality: 85
        });

        // Version moyenne
        const medium = await storage.save(file, {
            directory: `${this.basePath}/medium`,
            filename: `${Date.now()}-medium.webp`,
            resize: {
                width: 800,
                height: 600,
                fit: 'cover',
                format: 'webp'
            },
            quality: 80
        });

        // Miniature
        const thumbnail = await storage.save(file, {
            directory: `${this.basePath}/thumbnails`,
            filename: `${Date.now()}-thumb.webp`,
            resize: {
                width: 200,
                height: 200,
                fit: 'cover',
                format: 'webp'
            },
            quality: 70
        });

        const imageData = {
            id: Date.now(),
            title,
            description,
            isCover,
            uploadedAt: new Date(),
            versions: {
                original: original.url,
                large: large.url,
                medium: medium.url,
                thumbnail: thumbnail.url
            },
            paths: {
                original: original.path,
                large: large.path,
                medium: medium.path,
                thumbnail: thumbnail.path
            }
        };

        // Sauvegarder les métadonnées
        await this.saveMetadata(imageData);

        return imageData;
    }

    async getImages() {
        const metadata = await this.loadMetadata();
        return metadata.images || [];
    }

    async getImage(imageId) {
        const metadata = await this.loadMetadata();
        return metadata.images?.find(img => img.id === parseInt(imageId));
    }

    async deleteImage(imageId) {
        const metadata = await this.loadMetadata();
        const image = metadata.images?.find(img => img.id === parseInt(imageId));

        if (image) {
            // Supprimer tous les fichiers
            for (const version of Object.values(image.paths)) {
                await storage.delete(version);
            }

            // Mettre à jour les métadonnées
            metadata.images = metadata.images.filter(img => img.id !== parseInt(imageId));
            await this.saveMetadata(metadata);

            return true;
        }

        return false;
    }

    async setCover(imageId) {
        const metadata = await this.loadMetadata();
        
        // Retirer le cover des autres images
        metadata.images.forEach(img => {
            img.isCover = img.id === parseInt(imageId);
        });

        await this.saveMetadata(metadata);
    }

    async saveMetadata(data) {
        const metadataFile = {
            buffer: Buffer.from(JSON.stringify(data, null, 2)),
            originalname: 'metadata.json',
            mimetype: 'application/json'
        };

        await storage.save(metadataFile, {
            directory: this.basePath,
            filename: 'metadata.json'
        });
    }

    async loadMetadata() {
        try {
            const metadataPath = `${this.basePath}/metadata.json`;
            if (await storage.exists(metadataPath)) {
                const buffer = await storage.read(metadataPath);
                return JSON.parse(buffer.toString());
            }
        } catch (error) {
            // Ignorer si le fichier n'existe pas
        }

        return { images: [] };
    }
}
```

### Migration entre drivers

```javascript
// scripts/migrate-storage.js
const storage = require('../src/configuration/storage');

class StorageMigration {
    constructor(sourceDriver, targetDriver) {
        this.sourceDriver = sourceDriver;
        this.targetDriver = targetDriver;
    }

    async migrate() {
        // Changer temporairement le driver source
        const originalDriver = storage.driver;
        
        try {
            // Migrer de local vers S3
            if (this.sourceDriver === 'local' && this.targetDriver === 's3') {
                await this.migrateLocalToS3();
            }
            // Migrer de S3 vers local
            else if (this.sourceDriver === 's3' && this.targetDriver === 'local') {
                await this.migrateS3ToLocal();
            }

            logger.info('Migration terminée avec succès');
        } catch (error) {
            logger.error('Erreur migration:', error);
        } finally {
            storage.driver = originalDriver;
        }
    }

    async migrateLocalToS3() {
        storage.driver = 'local';
        
        // Lister tous les fichiers
        const files = await storage.list('', /.*/);
        
        storage.driver = 's3';
        
        for (const file of files) {
            if (!file.isDirectory) {
                try {
                    // Lire depuis local
                    storage.driver = 'local';
                    const content = await storage.read(file.path);
                    
                    // Sauvegarder vers S3
                    storage.driver = 's3';
                    const tempFile = {
                        buffer: content,
                        originalname: file.name,
                        mimetype: storage.getMimeType(file.name)
                    };
                    
                    await storage.save(tempFile, {
                        directory: path.dirname(file.path),
                        filename: file.name
                    });

                    logger.info(`Migré: ${file.path}`);
                } catch (error) {
                    logger.error(`Erreur migration ${file.path}:`, error);
                }
            }
        }
    }

    async migrateS3ToLocal() {
        // Implémentation similaire mais inversée
    }
}

// Utilisation
const migration = new StorageMigration('local', 's3');
await migration.migrate();
```

## 📊 Monitoring et administration

### Dashboard de stockage

```javascript
// routes/admin/storage.js
const storage = require('../../configuration/storage');

router.get('/stats', async (req, res) => {
    try {
        const health = await storage.healthCheck();
        
        // Statistiques d'utilisation
        let totalSize = 0;
        let fileCount = 0;
        
        if (storage.driver === 'local') {
            const files = await storage.list('', /.*/);
            
            for (const file of files) {
                if (!file.isDirectory) {
                    totalSize += file.size || 0;
                    fileCount++;
                }
            }
        }

        res.json({
            health,
            usage: {
                fileCount,
                totalSize: formatBytes(totalSize),
                driver: storage.driver
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/cleanup-temp', async (req, res) => {
    try {
        const maxAge = req.body.maxAge || 24 * 60 * 60 * 1000;
        await storage.cleanupTemp(maxAge);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/files', async (req, res) => {
    try {
        const directory = req.query.directory || '';
        const pattern = req.query.pattern ? new RegExp(req.query.pattern) : null;
        
        const files = await storage.list(directory, pattern);
        res.json(files);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
```

## 🧪 Tests

### Tests unitaires

```javascript
// tests/storage.test.js
const storage = require('../src/configuration/storage');
const path = require('path');

describe('Storage', () => {
    beforeAll(async () => {
        await storage.initialize();
    });

    afterAll(async () => {
        // Nettoyer les fichiers de test
        await storage.delete('test.txt');
    });

    test('should save text file', async () => {
        const file = {
            originalname: 'test.txt',
            buffer: Buffer.from('Hello World'),
            mimetype: 'text/plain'
        };

        const result = await storage.save(file, {
            directory: 'test',
            filename: 'test.txt'
        });

        expect(result).toHaveProperty('path');
        expect(result).toHaveProperty('filename', 'test.txt');
        expect(result).toHaveProperty('size', 11);
        
        // Vérifier que le fichier existe
        const exists = await storage.exists(result.path);
        expect(exists).toBe(true);
    });

    test('should read file', async () => {
        const content = await storage.read('test/test.txt');
        expect(content.toString()).toBe('Hello World');
    });

    test('should delete file', async () => {
        const result = await storage.delete('test/test.txt');
        expect(result).toBe(true);
        
        const exists = await storage.exists('test/test.txt');
        expect(exists).toBe(false);
    });

    test('should get metadata', async () => {
        const file = {
            originalname: 'metadata.txt',
            buffer: Buffer.from('Test metadata'),
            mimetype: 'text/plain'
        };

        const saved = await storage.save(file, {
            directory: 'test',
            filename: 'metadata.txt'
        });

        const metadata = await storage.getMetadata(saved.path);
        
        expect(metadata).toHaveProperty('size');
        expect(metadata).toHaveProperty('created');
        expect(metadata).toHaveProperty('modified');
    });

    test('should list files', async () => {
        // Créer quelques fichiers
        const files = ['a.txt', 'b.txt', 'c.txt'];
        
        for (const f of files) {
            await storage.save({
                originalname: f,
                buffer: Buffer.from('test'),
                mimetype: 'text/plain'
            }, {
                directory: 'list-test',
                filename: f
            });
        }

        const listed = await storage.list('list-test');
        
        expect(listed.length).toBe(3);
        expect(listed.map(f => f.name)).toEqual(expect.arrayContaining(files));
    });

    test('should copy file', async () => {
        const source = await storage.save({
            originalname: 'source.txt',
            buffer: Buffer.from('Source content'),
            mimetype: 'text/plain'
        }, {
            directory: 'test',
            filename: 'source.txt'
        });

        const dest = await storage.copy(source.path, 'test/destination.txt');
        
        expect(dest.path).toBe('test/destination.txt');
        
        const content = await storage.read(dest.path);
        expect(content.toString()).toBe('Source content');
    });

    test('should move file', async () => {
        const source = await storage.save({
            originalname: 'move-source.txt',
            buffer: Buffer.from('Move content'),
            mimetype: 'text/plain'
        }, {
            directory: 'test',
            filename: 'move-source.txt'
        });

        const dest = await storage.move(source.path, 'test/move-dest.txt');
        
        expect(dest.path).toBe('test/move-dest.txt');
        
        // Source devrait avoir disparu
        const exists = await storage.exists(source.path);
        expect(exists).toBe(false);
        
        // Destination devrait exister
        const content = await storage.read(dest.path);
        expect(content.toString()).toBe('Move content');
    });

    test('should resize image', async () => {
        // Créer une image factice
        const sharp = require('sharp');
        const buffer = await sharp({
            create: {
                width: 1000,
                height: 1000,
                channels: 4,
                background: { r: 255, g: 0, b: 0, alpha: 1 }
            }
        })
        .png()
        .toBuffer();

        const resized = await storage.resizeImage(buffer, {
            width: 500,
            height: 300,
            fit: 'cover',
            format: 'jpeg'
        }, 80);

        const metadata = await sharp(resized).metadata();
        
        expect(metadata.width).toBe(500);
        expect(metadata.height).toBe(300);
        expect(metadata.format).toBe('jpeg');
    });

    test('should generate unique filename', () => {
        const file = {
            originalname: 'test.jpg'
        };

        const name1 = storage.generateFilename(file);
        const name2 = storage.generateFilename(file);

        expect(name1).not.toBe(name2);
        expect(name1).toMatch(/^\d+-[a-z0-9]+\.jpg$/);
    });

    test('should detect mime type', () => {
        expect(storage.getMimeType('test.jpg')).toBe('image/jpeg');
        expect(storage.getMimeType('test.pdf')).toBe('application/pdf');
        expect(storage.getMimeType('test.unknown')).toBe('application/octet-stream');
    });

    test('should perform health check', async () => {
        const health = await storage.healthCheck();
        
        expect(health.status).toBe('healthy');
        expect(health.driver).toBeDefined();
        expect(health.latency).toBeDefined();
        expect(health.writable).toBe(true);
    });

    test('should cleanup temp files', async () => {
        // Créer un vieux fichier temporaire
        const oldFile = await storage.save({
            originalname: 'old.txt',
            buffer: Buffer.from('old'),
            mimetype: 'text/plain'
        }, {
            directory: 'temp',
            filename: 'old.txt'
        });

        // Modifier sa date de modification
        const oldPath = path.join(storage.basePath, oldFile.path);
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        await fs.utimes(oldPath, oneWeekAgo, oneWeekAgo);

        // Nettoyer avec une courte période
        await storage.cleanupTemp(1000); // 1 seconde

        // Vérifier qu'il a été supprimé
        const exists = await storage.exists(oldFile.path);
        expect(exists).toBe(false);
    });
});
```

### Tests d'intégration avec Express

```javascript
// tests/integration/upload.integration.test.js
const request = require('supertest');
const app = require('../../src/app');
const storage = require('../../src/configuration/storage');
const path = require('path');

describe('Upload Integration', () => {
    beforeAll(async () => {
        await storage.initialize();
    });

    afterAll(async () => {
        // Nettoyer
        await storage.deleteMany(['test-upload.jpg', 'test-multiple-1.jpg', 'test-multiple-2.jpg']);
    });

    test('should upload single file', async () => {
        const response = await request(app)
            .post('/api/upload')
            .attach('file', Buffer.from('test image content'), 'test.jpg')
            .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.file).toHaveProperty('path');
        expect(response.body.file).toHaveProperty('url');
        
        // Vérifier que le fichier existe
        const exists = await storage.exists(response.body.file.path);
        expect(exists).toBe(true);
    });

    test('should upload multiple files', async () => {
        const response = await request(app)
            .post('/api/upload-multiple')
            .attach('files', Buffer.from('file1'), 'file1.txt')
            .attach('files', Buffer.from('file2'), 'file2.txt')
            .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.files).toHaveLength(2);
    });

    test('should reject invalid file type', async () => {
        await request(app)
            .post('/api/upload')
            .attach('file', Buffer.from('bad file'), 'bad.exe')
            .expect(400);
    });

    test('should reject file too large', async () => {
        const largeBuffer = Buffer.alloc(20 * 1024 * 1024); // 20MB
        
        await request(app)
            .post('/api/upload')
            .attach('file', largeBuffer, 'large.jpg')
            .expect(400);
    });

    test('should upload and process image', async () => {
        // Créer une vraie image avec sharp
        const sharp = require('sharp');
        const imageBuffer = await sharp({
            create: {
                width: 2000,
                height: 2000,
                channels: 3,
                background: { r: 255, g: 0, b: 0 }
            }
        })
        .jpeg()
        .toBuffer();

        const response = await request(app)
            .post('/api/upload-image')
            .attach('image', imageBuffer, 'test-image.jpg')
            .expect(200);

        expect(response.body.file).toHaveProperty('url');
        
        // Vérifier que l'image a été redimensionnée
        const processed = await storage.read(response.body.file.path);
        const metadata = await sharp(processed).metadata();
        
        expect(metadata.width).toBe(800); // Devrait être redimensionné à 800px
    });
});
```

## 🔒 Bonnes pratiques

### 1. Validation des fichiers

```javascript
// middleware/fileValidation.js
function validateFile(options = {}) {
    const {
        maxSize = 5 * 1024 * 1024,
        allowedTypes = ['image/jpeg', 'image/png', 'image/gif'],
        allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif']
    } = options;

    return (req, res, next) => {
        const file = req.file;

        if (!file) {
            return next();
        }

        // Vérifier la taille
        if (file.size > maxSize) {
            return res.status(400).json({
                error: `Fichier trop volumineux. Maximum: ${maxSize / 1024 / 1024}MB`
            });
        }

        // Vérifier le type MIME
        if (!allowedTypes.includes(file.mimetype)) {
            return res.status(400).json({
                error: 'Type de fichier non autorisé'
            });
        }

        // Vérifier l'extension
        const ext = path.extname(file.originalname).toLowerCase();
        if (!allowedExtensions.includes(ext)) {
            return res.status(400).json({
                error: 'Extension de fichier non autorisée'
            });
        }

        next();
    };
}
```

### 2. Nettoyage des noms de fichiers

```javascript
// utils/sanitizeFilename.js
function sanitizeFilename(filename) {
    // Remplacer les caractères spéciaux
    let sanitized = filename
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Supprimer les accents
        .replace(/[^a-zA-Z0-9.-]/g, '_') // Remplacer caractères spéciaux par _
        .replace(/_{2,}/g, '_') // Éviter multiples _
        .replace(/^_+|_+$/g, ''); // Supprimer _ au début/fin

    // Limiter la longueur
    const maxLength = 255;
    if (sanitized.length > maxLength) {
        const ext = path.extname(sanitized);
        const name = path.basename(sanitized, ext);
        sanitized = name.substring(0, maxLength - ext.length) + ext;
    }

    return sanitized;
}

// Utilisation
const safeFilename = sanitizeFilename(req.file.originalname);
```

### 3. Gestion des erreurs

```javascript
// utils/storageErrors.js
class StorageError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'StorageError';
        this.code = code;
        this.details = details;
    }
}

class FileNotFoundError extends StorageError {
    constructor(path) {
        super(`Fichier non trouvé: ${path}`, 'FILE_NOT_FOUND', { path });
    }
}

class FileTooLargeError extends StorageError {
    constructor(size, maxSize) {
        super(`Fichier trop volumineux: ${size} > ${maxSize}`, 'FILE_TOO_LARGE', { size, maxSize });
    }
}

class InvalidFileTypeError extends StorageError {
    constructor(mimeType) {
        super(`Type de fichier invalide: ${mimeType}`, 'INVALID_FILE_TYPE', { mimeType });
    }
}

// Utilisation
async function safeSave(file, options) {
    try {
        return await storage.save(file, options);
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new FileNotFoundError(options.directory);
        }
        throw error;
    }
}
```

### 4. Rate limiting pour uploads

```javascript
// middleware/uploadRateLimit.js
const rateLimit = require('express-rate-limit');

const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 10, // 10 uploads par heure
    message: 'Trop d\'uploads. Réessayez plus tard.',
    keyGenerator: (req) => req.user?.id || req.ip
});

// Limite de taille par utilisateur
const userUploads = new Map();

async function checkUserQuota(req, res, next) {
    const userId = req.user?.id;
    if (!userId) return next();

    const total = userUploads.get(userId) || 0;
    const quota = 100 * 1024 * 1024; // 100MB

    if (total + req.file.size > quota) {
        return res.status(429).json({
            error: 'Quota de stockage dépassé'
        });
    }

    // Mettre à jour le quota
    userUploads.set(userId, total + req.file.size);

    // Nettoyer à la fin de la requête
    res.on('finish', () => {
        if (res.statusCode >= 400) {
            // En cas d'erreur, rembourser le quota
            userUploads.set(userId, total);
        }
    });

    next();
}

// Utilisation
router.post('/upload',
    uploadLimiter,
    checkUserQuota,
    upload.single('file'),
    uploadController.uploadFile
);
```

## 📈 Performance et optimisation

### Cache des fichiers fréquents

```javascript
// services/fileCache.js
const NodeCache = require('node-cache');
const fileCache = new NodeCache({ stdTTL: 3600 });

async function getCachedFile(filePath) {
    let content = fileCache.get(filePath);
    
    if (!content) {
        content = await storage.read(filePath);
        fileCache.set(filePath, content);
    }
    
    return content;
}

// Utilisation pour les images fréquentes
router.get('/images/:filename', async (req, res) => {
    const content = await getCachedFile(`images/${req.params.filename}`);
    res.contentType(storage.getMimeType(req.params.filename));
    res.send(content);
});
```

### Compression des images à la volée

```javascript
// middleware/imageOptimizer.js
const sharp = require('sharp');

async function optimizeImage(req, res, next) {
    const filePath = req.params[0];
    const { w, h, q = 80, format = 'webp' } = req.query;

    if (!w && !h) {
        return next();
    }

    try {
        const content = await storage.read(filePath);
        
        let pipeline = sharp(content);
        
        if (w || h) {
            pipeline = pipeline.resize(
                w ? parseInt(w) : null,
                h ? parseInt(h) : null,
                { fit: 'cover', withoutEnlargement: true }
            );
        }
        
        pipeline = pipeline.toFormat(format, { quality: parseInt(q) });
        
        const optimized = await pipeline.toBuffer();
        
        res.contentType(`image/${format}`);
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.send(optimized);
    } catch (error) {
        next(error);
    }
}

// Route optimisée
router.get('/uploads/*', optimizeImage);
```

### Upload par chunk pour gros fichiers

```javascript
// controllers/chunkUploadController.js
const fs = require('fs');
const path = require('path');

class ChunkUploadController {
    constructor() {
        this.chunksDir = path.join(process.cwd(), 'temp', 'chunks');
    }

    async uploadChunk(req, res) {
        const {
            fileId,
            chunkIndex,
            totalChunks,
            filename
        } = req.body;

        const chunk = req.file;
        const chunkDir = path.join(this.chunksDir, fileId);
        
        // Créer le dossier pour les chunks
        await fs.promises.mkdir(chunkDir, { recursive: true });
        
        // Sauvegarder le chunk
        const chunkPath = path.join(chunkDir, `${chunkIndex}`);
        await fs.promises.writeFile(chunkPath, chunk.buffer);

        res.json({
            received: parseInt(chunkIndex),
            uploaded: true
        });
    }

    async completeUpload(req, res) {
        const {
            fileId,
            totalChunks,
            filename,
            mimetype
        } = req.body;

        const chunkDir = path.join(this.chunksDir, fileId);
        
        // Rassembler tous les chunks
        const chunks = [];
        for (let i = 0; i < totalChunks; i++) {
            const chunkPath = path.join(chunkDir, i.toString());
            const chunk = await fs.promises.readFile(chunkPath);
            chunks.push(chunk);
        }

        // Fusionner les chunks
        const completeBuffer = Buffer.concat(chunks);
        
        // Sauvegarder le fichier final
        const file = {
            buffer: completeBuffer,
            originalname: filename,
            mimetype
        };

        const result = await storage.save(file);

        // Nettoyer les chunks
        await fs.promises.rm(chunkDir, { recursive: true, force: true });

        res.json(result);
    }
}
```

## 📚 API Reference

### Propriétés

| Propriété | Type | Description |
|-----------|------|-------------|
| `driver` | string | Driver actif ('local' ou 's3') |
| `basePath` | string | Chemin de base (local) |
| `s3Client` | S3Client | Client AWS S3 |
| `initialized` | boolean | État d'initialisation |

### Méthodes principales

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `initialize()` | - | Promise<void> | Initialise le stockage |
| `save(file, options)` | `File, object` | Promise<object> | Sauvegarde fichier |
| `saveMany(files, options)` | `File[], object` | Promise<object[]> | Sauvegarde multiple |
| `read(filePath)` | `string` | Promise<Buffer> | Lit fichier |
| `delete(filePath)` | `string` | Promise<boolean> | Supprime fichier |
| `deleteMany(filePaths)` | `string[]` | Promise<object[]> | Supprime multiple |
| `exists(filePath)` | `string` | Promise<boolean> | Vérifie existence |
| `getMetadata(filePath)` | `string` | Promise<object> | Métadonnées |
| `list(directory, pattern)` | `string, RegExp` | Promise<object[]> | Liste fichiers |
| `copy(source, dest)` | `string, string` | Promise<object> | Copie fichier |
| `move(source, dest)` | `string, string` | Promise<object> | Déplace fichier |

### Méthodes d'image

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `resizeImage(buffer, options, quality)` | `Buffer, object, number` | Promise<Buffer> | Redimensionne image |
| `getPublicUrl(filePath)` | `string` | string | URL publique |
| `getSignedUrl(filePath, expiresIn)` | `string, number` | Promise<string> | URL signée (S3) |

### Utilitaires

| Méthode | Paramètres | Retour | Description |
|---------|------------|--------|-------------|
| `generateFilename(file)` | `File` | string | Nom unique |
| `getMimeType(filename)` | `string` | string | Type MIME |
| `cleanupTemp(maxAge)` | `number` | Promise<void> | Nettoie temp |
| `healthCheck()` | - | Promise<object> | État de santé |

## 🆘 Dépannage

### Problèmes courants

1. **Permission denied (stockage local)**
```javascript
// Vérifier les permissions
const fs = require('fs');
try {
    fs.accessSync('/path/to/uploads', fs.constants.W_OK);
    console.log('Dossier accessible en écriture');
} catch (err) {
    console.error('Pas de permission d\'écriture');
    // Solution: chmod -R 755 uploads/
}
```

2. **Fichier trop volumineux pour S3**
```javascript
// Utiliser le multipart upload pour les gros fichiers
const { Upload } = require('@aws-sdk/lib-storage');

const upload = new Upload({
    client: s3Client,
    params: {
        Bucket: env.AWS_BUCKET,
        Key: key,
        Body: stream,
        ContentType: mimetype
    }
});

await upload.done();
```

3. **Images corrompues après traitement**
```javascript
// Vérifier l'intégrité de l'image
try {
    const metadata = await sharp(buffer).metadata();
    console.log('Image valide:', metadata);
} catch (error) {
    console.error('Image corrompue:', error);
    // Retourner l'original sans traitement
}
```

### Debugging

```javascript
// Logger les opérations de stockage
const originalSave = storage.save;
storage.save = async function(...args) {
    console.log('Sauvegarde:', args[1]?.filename);
    const start = Date.now();
    const result = await originalSave.apply(this, args);
    console.log(`Sauvegarde terminée en ${Date.now() - start}ms`);
    return result;
};
```

## 🎯 Conclusion

Ce module de stockage offre une solution complète et flexible pour la gestion des fichiers avec :

- ✅ **Support multi-driver** (local et S3)
- ✅ **Traitement d'images** intégré (sharp)
- ✅ **Interface unifiée** pour toutes les opérations
- ✅ **URLs signées** pour fichiers privés
- ✅ **Nettoyage automatique** des fichiers temporaires
- ✅ **Validation** et sécurité
- ✅ **Performance** avec cache et optimisation
- ✅ **Monitoring** et health check
- ✅ **Tests exhaustifs**
- ✅ **Documentation complète**

Il constitue une solution robuste pour tous les besoins de stockage de fichiers dans l'application.
```