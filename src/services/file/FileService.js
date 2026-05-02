// src/services/file/FileService.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const mime = require('mime-types');
const sharp = require('sharp');
const Constants = require('../../configuration/constants');
const { DocumentModel } = require('../../models');

class FileService {
  constructor() {
    this.uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads');
    this.baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    this.ensureUploadDirs();
  }

  /**
   * S'assurer que les dossiers d'upload existent
   */
  async ensureUploadDirs() {
    const dirs = [
      this.uploadDir,
      path.join(this.uploadDir, 'images'),
      path.join(this.uploadDir, 'documents'),
      path.join(this.uploadDir, 'temp'),
      path.join(this.uploadDir, 'avatars'),
      path.join(this.uploadDir, 'menus'),
      path.join(this.uploadDir, 'produits'),
      path.join(this.uploadDir, 'articles'),
      path.join(this.uploadDir, 'articles', 'gallery')
    ];

    for (const dir of dirs) {
      try {
        await fs.access(dir);
      } catch {
        await fs.mkdir(dir, { recursive: true });
      }
    }
  }

  /**
   * Générer un nom de fichier unique
   */
  generateFileName(originalName, prefix = '') {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    const extension = path.extname(originalName);
    const basename = path.basename(originalName, extension)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .substring(0, 50);
    
    return `${prefix}${basename}-${timestamp}-${random}${extension}`;
  }

  /**
   * Extraire le buffer d'un fichier multer
   */
  async extractFileBuffer(file) {
    // Si le fichier a déjà un buffer (memoryStorage)
    if (file.buffer) {
      return {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      };
    }
    
    // Si le fichier a un chemin (diskStorage)
    if (file.path) {
      const buffer = await fs.readFile(file.path);
      // Supprimer le fichier temporaire après lecture
      try {
        await fs.unlink(file.path);
      } catch (e) {
        // Ignorer l'erreur de suppression
      }
      return {
        buffer: buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: buffer.length
      };
    }
    
    throw new Error('Format de fichier non supporté');
  }

  /**
   * Sauvegarder un fichier
   */
  async saveFile(file, subDir = 'temp', options = {}) {
    try {
      const { 
        prefix = '',
        maxSize = Constants.CONFIG.UPLOAD.MAX_FILE_SIZE,
        allowedTypes = null
      } = options;

      // Extraire le buffer du fichier multer
      const fileData = await this.extractFileBuffer(file);

      // Vérifier la taille
      if (fileData.size > maxSize) {
        throw new Error(`Fichier trop volumineux. Maximum: ${maxSize / 1024 / 1024}MB`);
      }

      // Vérifier le type MIME
      if (allowedTypes && !allowedTypes.includes(fileData.mimetype)) {
        throw new Error(`Type de fichier non autorisé: ${fileData.mimetype}`);
      }

      // Générer le nom du fichier
      const fileName = this.generateFileName(fileData.originalname, prefix);
      const filePath = path.join(this.uploadDir, subDir, fileName);
      const relativePath = path.join(subDir, fileName);

      // Sauvegarder le fichier
      await fs.writeFile(filePath, fileData.buffer);

      // Retourner les informations du fichier
      return {
        originalName: fileData.originalname,
        fileName: fileName,
        filePath: relativePath,
        size: fileData.size,
        mimeType: fileData.mimetype,
        url: `${this.baseUrl}/uploads/${relativePath.replace(/\\/g, '/')}`
      };
    } catch (error) {
      console.error('Erreur sauvegarde fichier:', error);
      throw error;
    }
  }

  /**
   * Sauvegarder une image (avec optimisation)
   */
  async saveImage(file, subDir = 'images', options = {}) {
    const {
      prefix = '',
      maxWidth = 1920,
      maxHeight = 1080,
      quality = 80,
      generateThumbnail = true,
      thumbnailSize = 300
    } = options;

    try {
      // Extraire le buffer du fichier multer
      const fileData = await this.extractFileBuffer(file);

      // Vérifier le type MIME
      const allowedImages = Constants.CONFIG.UPLOAD.ALLOWED_IMAGES || 
        ['image/jpeg', 'image/png', 'image/jpg', 'image/gif', 'image/webp'];
      
      if (!allowedImages.includes(fileData.mimetype)) {
        throw new Error(`Type d'image non autorisé: ${fileData.mimetype}`);
      }

      // Vérifier la taille
      const maxImageSize = Constants.CONFIG.UPLOAD.MAX_IMAGE_SIZE || 5 * 1024 * 1024;
      if (fileData.size > maxImageSize) {
        throw new Error(`Image trop volumineuse. Maximum: ${maxImageSize / 1024 / 1024}MB`);
      }

      // Générer le nom du fichier
      const fileName = this.generateFileName(fileData.originalname, prefix);
      const filePath = path.join(this.uploadDir, subDir, fileName);
      const relativePath = path.join(subDir, fileName);

      // Optimiser l'image
      let imageBuffer = fileData.buffer;
      
      try {
        const optimized = await sharp(imageBuffer)
          .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality, progressive: true })
          .toBuffer();
        imageBuffer = optimized;
      } catch (sharpError) {
        console.warn('Erreur sharp, sauvegarde originale:', sharpError.message);
        // Conserver l'image originale si sharp échoue
      }

      // Sauvegarder l'image
      await fs.writeFile(filePath, imageBuffer);

      // Générer une vignette si demandé
      let thumbnail = null;
      if (generateThumbnail) {
        try {
          const thumbnailName = `thumb-${fileName}`;
          const thumbnailPath = path.join(this.uploadDir, subDir, thumbnailName);
          const thumbnailRelativePath = path.join(subDir, thumbnailName);

          const thumbBuffer = await sharp(fileData.buffer)
            .resize(thumbnailSize, thumbnailSize, { fit: 'cover' })
            .jpeg({ quality: 70 })
            .toBuffer();

          await fs.writeFile(thumbnailPath, thumbBuffer);

          thumbnail = {
            fileName: thumbnailName,
            filePath: thumbnailRelativePath,
            url: `${this.baseUrl}/uploads/${thumbnailRelativePath.replace(/\\/g, '/')}`
          };
        } catch (thumbError) {
          console.warn('Erreur génération vignette:', thumbError.message);
        }
      }

      // Obtenir les dimensions
      let width = null, height = null;
      try {
        const metadata = await sharp(fileData.buffer).metadata();
        width = metadata.width;
        height = metadata.height;
      } catch (metaError) {
        console.warn('Erreur lecture métadonnées:', metaError.message);
      }

      return {
        originalName: fileData.originalname,
        fileName: fileName,
        filePath: relativePath,
        size: imageBuffer.length,
        mimeType: fileData.mimetype,
        url: `${this.baseUrl}/uploads/${relativePath.replace(/\\/g, '/')}`,
        width: width,
        height: height,
        thumbnail: thumbnail
      };
    } catch (error) {
      console.error('Erreur sauvegarde image:', error);
      throw error;
    }
  }

  /**
   * Supprimer un fichier
   */
  async deleteFile(filePath) {
    try {
      const fullPath = path.join(this.uploadDir, filePath);
      await fs.unlink(fullPath);
      
      // Supprimer également la vignette si elle existe
      const dir = path.dirname(filePath);
      const basename = path.basename(filePath);
      const thumbPath = path.join(this.uploadDir, dir, `thumb-${basename}`);
      try {
        await fs.unlink(thumbPath);
      } catch (e) {
        // Ignorer si la vignette n'existe pas
      }
      
      return true;
    } catch (error) {
      console.error('Erreur suppression fichier:', error);
      return false;
    }
  }

  /**
   * Lire un fichier
   */
  async readFile(filePath) {
    try {
      const fullPath = path.join(this.uploadDir, filePath);
      return await fs.readFile(fullPath);
    } catch (error) {
      console.error('Erreur lecture fichier:', error);
      throw error;
    }
  }

  /**
   * Obtenir les informations d'un fichier
   */
  async getFileInfo(filePath) {
    try {
      const fullPath = path.join(this.uploadDir, filePath);
      const stats = await fs.stat(fullPath);
      
      return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        mimeType: mime.lookup(filePath) || 'application/octet-stream',
        url: `${this.baseUrl}/uploads/${filePath.replace(/\\/g, '/')}`
      };
    } catch (error) {
      console.error('Erreur info fichier:', error);
      return null;
    }
  }

  /**
   * Sauvegarder un document
   */
  async saveDocument(file, entiteType, entiteId, typeDocument, options = {}) {
    try {
      // Sauvegarder le fichier
      const fileInfo = await this.saveFile(file, 'documents', {
        prefix: `${entiteType.toLowerCase()}-`,
        maxSize: Constants.CONFIG.UPLOAD.MAX_FILE_SIZE,
        allowedTypes: Constants.CONFIG.UPLOAD.ALLOWED_DOCUMENTS
      });

      // Créer l'entrée dans la base de données
      const document = await DocumentModel.create({
        type_document: typeDocument,
        nom_fichier: fileInfo.originalName,
        chemin_fichier: fileInfo.filePath,
        mime_type: fileInfo.mimeType,
        taille_fichier: fileInfo.size,
        entite_type: entiteType,
        entite_id: entiteId,
        ...options
      });

      return {
        ...document,
        url: fileInfo.url
      };
    } catch (error) {
      console.error('Erreur sauvegarde document:', error);
      throw error;
    }
  }

  /**
   * Nettoyer les fichiers temporaires
   */
  async cleanTempFiles(maxAge = 24 * 60 * 60 * 1000) {
    const tempDir = path.join(this.uploadDir, 'temp');
    
    try {
      const files = await fs.readdir(tempDir);
      const now = Date.now();
      let deleted = 0;

      for (const file of files) {
        const filePath = path.join(tempDir, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtimeMs > maxAge) {
          await fs.unlink(filePath);
          deleted++;
        }
      }

      return { deleted };
    } catch (error) {
      console.error('Erreur nettoyage fichiers temp:', error);
      return { deleted: 0, error: error.message };
    }
  }

  /**
   * Calculer le hash d'un fichier
   */
  async calculateHash(fileBuffer, algorithm = 'sha256') {
    return crypto.createHash(algorithm).update(fileBuffer).digest('hex');
  }

  /**
   * Vérifier si deux fichiers sont identiques
   */
  async areFilesIdentical(file1Path, file2Path) {
    const [hash1, hash2] = await Promise.all([
      this.calculateHash(await this.readFile(file1Path)),
      this.calculateHash(await this.readFile(file2Path))
    ]);
    
    return hash1 === hash2;
  }
}

module.exports = new FileService();