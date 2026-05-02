// src/controllers/blog/ArticleController.js
const db = require('../../configuration/database');
const { ValidationError, NotFoundError, AuthorizationError, AuthenticationError } = require('../../utils/errors/AppError');
const NotificationService = require('../../services/notification/NotificationService');
const AuditService = require('../../services/audit/AuditService');
const CacheService = require('../../services/cache/CacheService');
const FileService = require('../../services/file/FileService');
const fs = require('fs').promises;
const path = require('path');

class ArticleController {

    // ========================================================================
    // MÉTHODES UTILITAIRES
    // ========================================================================

    async isValidFile(file) {
        if (!file) return false;
        if (file.buffer && file.buffer.length > 0) return true;
        if (file.path) {
            try { const stats = await fs.stat(file.path); return stats.size > 0; } 
            catch { return false; }
        }
        return false;
    }

    async cleanupTempFile(file) {
        if (file?.path) {
            try { await fs.unlink(file.path); } 
            catch (e) { console.debug('Cleanup temp:', file.path); }
        }
    }

    async cleanupFiles(filePaths) {
        if (!filePaths?.length) return;
        for (const fp of filePaths) {
            try { await FileService.deleteFile(fp); } 
            catch (e) { console.debug('Cleanup:', fp); }
        }
    }

    async handleArticleImages(req) {
        const results = { image_principale: null, image_secondaire: null, filesToCleanup: [] };
        try {
            const files = req.files || req.uploadedFiles || {};
            for (const [field, opts] of [['image_principale', { w: 1200, h: 800, q: 85, thumb: true }], ['image_secondaire', { w: 800, h: 600, q: 80, thumb: false }]]) {
                if (files[field]?.[0] && await this.isValidFile(files[field][0])) {
                    try {
                        const saved = await FileService.saveImage(files[field][0], 'articles', { maxWidth: opts.w, maxHeight: opts.h, quality: opts.q, generateThumbnail: opts.thumb, prefix: field === 'image_principale' ? 'main-' : 'sec-' });
                        if (saved?.url) { results[field] = saved.url; results.filesToCleanup.push(saved.filePath); }
                        await this.cleanupTempFile(files[field][0]);
                    } catch (e) { console.error(`Erreur ${field}:`, e.message); }
                }
            }
            if (!results.image_principale && req.body.image_principale) results.image_principale = req.body.image_principale;
            if (!results.image_secondaire && req.body.image_secondaire) results.image_secondaire = req.body.image_secondaire;
        } catch (e) { console.error('Erreur images:', e); }
        return results;
    }

    async handleGalleryImages(req) {
        const images = [];
        const files = req.files || req.uploadedFiles || {};
        const MAX = 20;
        try {
            if (files.gallery_images?.length) {
                for (const f of files.gallery_images) {
                    if (await this.isValidFile(f)) {
                        try {
                            const saved = await FileService.saveImage(f, 'articles/gallery', { maxWidth: 1200, maxHeight: 800, quality: 80, generateThumbnail: true, thumbnailSize: 300, prefix: 'gal-' });
                            if (saved?.url) images.push({ url: saved.url, thumb: saved.thumbnail?.url || saved.url, alt: f.originalname || 'Galerie', order: images.length });
                            await this.cleanupTempFile(f);
                        } catch (e) { console.error('Erreur galerie:', e.message); }
                    }
                }
            }
            let body = [];
            if (req.body.gallery_images) {
                if (typeof req.body.gallery_images === 'string') {
                    try { body = JSON.parse(req.body.gallery_images); if (!Array.isArray(body)) body = [req.body.gallery_images]; } 
                    catch { body = req.body.gallery_images.includes(',') ? req.body.gallery_images.split(',').map(s => s.trim()) : [req.body.gallery_images]; }
                } else if (Array.isArray(req.body.gallery_images)) body = req.body.gallery_images;
                for (const img of body) {
                    const u = typeof img === 'string' ? img : img?.url;
                    if (u && !images.some(g => g.url === u)) {
                        images.push(typeof img === 'string' ? { url: u, thumb: u, alt: 'Galerie', order: images.length } : { ...img, order: img.order || images.length });
                    }
                }
            }
            return images.slice(0, MAX);
        } catch (e) { console.error('Erreur galerie:', e); return images; }
    }

    async generateUniqueSlug(client, title) {
        let base = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 100) || 'article';
        let slug = base, i = 1;
        while (i <= 100) {
            const { rows } = await client.query('SELECT id FROM ARTICLES_BLOG_PLATEFORME WHERE slug = $1', [slug]);
            if (!rows.length) return slug;
            slug = `${base}-${i++}`;
        }
        return `${base}-${Date.now()}`;
    }

    async invalidateArticleCache(id, slug) {
        try {
            if (CacheService) {
                await CacheService.del(`blog:article:${id}`);
                if (slug) await CacheService.del(`blog:article:${slug}`);
                await (CacheService.invalidatePattern || CacheService.delPattern)?.('blog:articles:*');
            }
        } catch (e) { console.error('Cache invalidation:', e); }
    }

    parseMotsCles(input) {
        if (!input) return [];
        if (Array.isArray(input)) return input;
        if (typeof input === 'string') {
            try { const p = JSON.parse(input); return Array.isArray(p) ? p : [input]; } 
            catch { return input.split(',').map(s => s.trim()).filter(Boolean); }
        }
        return [];
    }

    estimerTempsLecture(contenu) {
        const mots = (contenu || '').split(/\s+/).length;
        const minutes = Math.ceil(mots / 200); // 200 mots/min
        return minutes <= 1 ? '1 min' : `${minutes} min`;
    }

    // ========================================================================
    // CRUD PRINCIPAL
    // ========================================================================

    async create(req, res, next) {
        const client = await db.getClient();
        let uploadedFiles = [];
        try {
            await client.query('BEGIN');
            
            const images = await this.handleArticleImages(req);
            uploadedFiles.push(...images.filesToCleanup);
            const gallery = await this.handleGalleryImages(req);
            
            const {
                titre_article, sous_titre, contenu_article, extrait_contenu,
                langue = 'fr', video_url, documents_joints = [],
                meta_titre, meta_description, mots_cles,
                categorie_principale, categories_secondaires,
                visibilite = 'PUBLIC', est_epingle = false,
                est_commentaire_actif = true, date_programmation,
                co_auteurs = [], plateforme_id, compagnie_id,
                emplacement_transport_id, restaurant_id,
                emplacement_restaurant_id, boutique_id,
                produit_boutique_id, menu_id, promo_id,
                est_disponible_hors_ligne = false,
                droit_lecture_minimum_role, mot_de_passe_protege,
                redirection_url, niveau_difficulte = 'DEBUTANT',
                duree_estimee, audio_url, infographie_url,
                embed_code, mise_en_page = 'STANDARD',
                couleur_theme, contient_quiz = false,
                contient_sondage = false, est_evenement = false,
                date_evenement, lieu_evenement
            } = req.body;

            // Validation
            const errors = [];
            if (!titre_article?.trim() || titre_article.trim().length < 5) errors.push('Titre: min 5 caractères');
            if (!contenu_article?.trim() || contenu_article.trim().length < 50) errors.push('Contenu: min 50 caractères');
            if (!categorie_principale) errors.push('Catégorie principale requise');
            if (errors.length) throw new ValidationError('Données invalides', errors);

            const slug = await this.generateUniqueSlug(client, titre_article);
            const motsClesArray = this.parseMotsCles(mots_cles);
            const duree = duree_estimee || this.estimerTempsLecture(contenu_article);
            const statut = date_programmation ? 'PROGRAMME' : 'BROUILLON';

            const result = await client.query(
                `INSERT INTO ARTICLES_BLOG_PLATEFORME (
                    titre_article, sous_titre, slug, contenu_article, extrait_contenu,
                    langue, image_principale, image_secondaire, video_url, gallery_images,
                    documents_joints, meta_titre, meta_description, mots_cles,
                    categorie_principale, categories_secondaires, statut, visibilite,
                    est_epingle, est_commentaire_actif, date_programmation, auteur_id,
                    co_auteurs, plateforme_id, compagnie_id, emplacement_transport_id,
                    restaurant_id, emplacement_restaurant_id, boutique_id,
                    produit_boutique_id, menu_id, promo_id, est_disponible_hors_ligne,
                    droit_lecture_minimum_role, mot_de_passe_protege, redirection_url
                ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14::text[],
                    $15,$16::categories_article[],$17,$18,$19,$20,$21,$22,$23::integer[],
                    $24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36
                ) RETURNING *`,
                [
                    titre_article.trim(), sous_titre || null, slug, contenu_article.trim(),
                    extrait_contenu || null, langue, images.image_principale, images.image_secondaire,
                    video_url || null, JSON.stringify(gallery), JSON.stringify(Array.isArray(documents_joints) ? documents_joints : []),
                    meta_titre || null, meta_description || null, motsClesArray,
                    categorie_principale, categories_secondaires || null, statut, visibilite,
                    est_epingle, est_commentaire_actif, date_programmation || null, req.user.id,
                    Array.isArray(co_auteurs) ? co_auteurs : [], plateforme_id || null,
                    compagnie_id || null, emplacement_transport_id || null, restaurant_id || null,
                    emplacement_restaurant_id || null, boutique_id || null, produit_boutique_id || null,
                    menu_id || null, promo_id || null, est_disponible_hors_ligne,
                    droit_lecture_minimum_role || null, mot_de_passe_protege || null, redirection_url || null
                ]
            );

            const article = result.rows[0];

            // ✅ Enregistrer les articles liés si fournis
            if (req.body.articles_lies?.length) {
                await this.saveRelatedArticles(client, article.id, req.body.articles_lies);
            }

            await AuditService.log({ action: 'CREATE', ressource_type: 'ARTICLE_BLOG', ressource_id: article.id, utilisateur_id: req.user.id, donnees_apres: article }).catch(() => {});
            await client.query('COMMIT');
            await this.invalidateArticleCache(article.id, article.slug);

            res.status(201).json({ success: true, data: article, message: 'Article créé avec succès' });
        } catch (error) {
            await client.query('ROLLBACK');
            await this.cleanupFiles(uploadedFiles);
            next(error);
        } finally { client.release(); }
    }

    async update(req, res, next) {
        const client = await db.getClient();
        let newFiles = [], oldPaths = [];
        try {
            await client.query('BEGIN');
            const { id } = req.params;
            const existing = await client.query('SELECT * FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1', [id]);
            if (!existing.rows.length) throw new NotFoundError('Article non trouvé');
            const article = existing.rows[0];
            if (!this.canModify(article, req.user)) throw new AuthorizationError('Droits insuffisants');

            // Sauvegarder anciens chemins
            if (article.image_principale) oldPaths.push(article.image_principale);
            if (article.image_secondaire) oldPaths.push(article.image_secondaire);
            if (article.gallery_images?.length) {
                for (const img of article.gallery_images) {
                    if (img.url?.startsWith('/uploads/')) oldPaths.push(img.url);
                    if (img.thumb?.startsWith('/uploads/')) oldPaths.push(img.thumb);
                }
            }

            const updateData = { ...req.body };
            if (updateData.titre_article && updateData.titre_article !== article.titre_article) {
                updateData.slug = await this.generateUniqueSlug(client, updateData.titre_article);
            }

            const images = await this.handleArticleImages(req);
            newFiles.push(...images.filesToCleanup);
            if (images.image_principale) updateData.image_principale = images.image_principale;
            if (images.image_secondaire) updateData.image_secondaire = images.image_secondaire;

            if (req.files?.gallery_images || req.uploadedFiles?.gallery_images || updateData.gallery_images) {
                const gallery = await this.handleGalleryImages(req);
                updateData.gallery_images = gallery;
                for (const img of gallery) {
                    if (img.url?.startsWith('/uploads/')) newFiles.push(img.url.replace('/uploads/', ''));
                }
            }

            if (updateData.mots_cles) updateData.mots_cles = this.parseMotsCles(updateData.mots_cles);

            // Construction UPDATE dynamique
            const setClauses = [], values = [id];
            let vi = 2;
            const allowedFields = [
                'titre_article', 'sous_titre', 'slug', 'contenu_article', 'extrait_contenu',
                'langue', 'image_principale', 'image_secondaire', 'video_url', 'gallery_images',
                'documents_joints', 'meta_titre', 'meta_description', 'mots_cles',
                'categorie_principale', 'categories_secondaires', 'visibilite',
                'est_epingle', 'est_commentaire_actif', 'date_programmation',
                'co_auteurs', 'est_disponible_hors_ligne', 'droit_lecture_minimum_role',
                'mot_de_passe_protege', 'redirection_url', 'statut'
            ];

            for (const field of allowedFields) {
                if (updateData[field] !== undefined) {
                    setClauses.push(`${field} = $${vi}`);
                    if (['gallery_images', 'documents_joints'].includes(field)) {
                        values.push(JSON.stringify(Array.isArray(updateData[field]) ? updateData[field] : []));
                    } else if (field === 'mots_cles') {
                        values.push(Array.isArray(updateData[field]) ? updateData[field] : []);
                    } else if (['co_auteurs', 'categories_secondaires'].includes(field)) {
                        values.push(updateData[field] || (field === 'co_auteurs' ? [] : null));
                    } else {
                        values.push(updateData[field]);
                    }
                    vi++;
                }
            }
            setClauses.push('date_modification = NOW()');

            const result = await client.query(`UPDATE ARTICLES_BLOG_PLATEFORME SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`, values);
            const updated = result.rows[0];

            // Mettre à jour les articles liés
            if (req.body.articles_lies !== undefined) {
                await client.query('DELETE FROM ARTICLES_LIES WHERE article_id = $1', [id]);
                if (req.body.articles_lies?.length) {
                    await this.saveRelatedArticles(client, id, req.body.articles_lies);
                }
            }

            await AuditService.log({ action: 'UPDATE', ressource_type: 'ARTICLE_BLOG', ressource_id: id, utilisateur_id: req.user.id, donnees_avant: article, donnees_apres: updated }).catch(() => {});
            await client.query('COMMIT');

            // Nettoyage anciennes images
            const newUrls = new Set([updated.image_principale, updated.image_secondaire]);
            if (updated.gallery_images?.length) {
                for (const img of updated.gallery_images) { if (img.url) newUrls.add(img.url); if (img.thumb) newUrls.add(img.thumb); }
            }
            for (const old of oldPaths) {
                if (!newUrls.has(old) && old.startsWith('/uploads/')) {
                    FileService.deleteFile(old.replace('/uploads/', '')).catch(() => {});
                }
            }

            await this.invalidateArticleCache(id, article.slug);
            res.json({ success: true, data: updated, message: 'Article mis à jour' });
        } catch (error) {
            await client.query('ROLLBACK');
            await this.cleanupFiles(newFiles);
            next(error);
        } finally { client.release(); }
    }

    async delete(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            const { id } = req.params;
            const { rows } = await client.query('SELECT * FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1', [id]);
            if (!rows.length) throw new NotFoundError('Article non trouvé');
            if (!this.canDelete(rows[0], req.user)) throw new AuthorizationError('Droits insuffisants');

            await client.query(`UPDATE ARTICLES_BLOG_PLATEFORME SET statut = 'SUPPRIME', date_archivage = NOW(), est_archive = true WHERE id = $1`, [id]);
            await AuditService.log({ action: 'DELETE', ressource_type: 'ARTICLE_BLOG', ressource_id: id, utilisateur_id: req.user.id, donnees_avant: rows[0] }).catch(() => {});
            await client.query('COMMIT');
            await this.invalidateArticleCache(id, rows[0].slug);
            res.json({ success: true, message: 'Article supprimé' });
        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally { client.release(); }
    }

    async publish(req, res, next) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            const { id } = req.params;
            const { rows } = await client.query('SELECT * FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1', [id]);
            if (!rows.length) throw new NotFoundError('Article non trouvé');
            if (!this.canModify(rows[0], req.user)) throw new AuthorizationError('Droits insuffisants');
            if (rows[0].statut === 'SUPPRIME') throw new ValidationError('Article supprimé');

            const result = await client.query(
                `UPDATE ARTICLES_BLOG_PLATEFORME SET statut = 'PUBLIE', date_publication = COALESCE($1, NOW()), date_programmation = NULL WHERE id = $2 RETURNING *`,
                [req.body.date_publication || new Date(), id]
            );

            this.notifySubscribers(result.rows[0], client).catch(() => {});
            await AuditService.log({ action: 'PUBLISH', ressource_type: 'ARTICLE_BLOG', ressource_id: id, utilisateur_id: req.user.id, donnees_apres: result.rows[0] }).catch(() => {});
            await client.query('COMMIT');
            await this.invalidateArticleCache(id, rows[0].slug);
            res.json({ success: true, data: result.rows[0], message: 'Article publié' });
        } catch (error) {
            await client.query('ROLLBACK');
            next(error);
        } finally { client.release(); }
    }

    async toggleArchive(req, res, next) {
        try {
            const { id } = req.params;
            const { archived } = req.body;
            const { rows } = await db.query('SELECT * FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1', [id]);
            if (!rows.length) throw new NotFoundError('Article non trouvé');
            if (!this.canModify(rows[0], req.user)) throw new AuthorizationError('Droits insuffisants');
            const result = await db.query(
                `UPDATE ARTICLES_BLOG_PLATEFORME SET est_archive = $1, date_archivage = CASE WHEN $1 THEN NOW() ELSE NULL END WHERE id = $2 RETURNING *`,
                [archived, id]
            );
            await this.invalidateArticleCache(id, rows[0].slug);
            res.json({ success: true, data: result.rows[0], message: archived ? 'Archivé' : 'Restauré' });
        } catch (error) { next(error); }
    }

    async togglePin(req, res, next) {
        try {
            const { id } = req.params;
            const result = await db.query(`UPDATE ARTICLES_BLOG_PLATEFORME SET est_epingle = $1 WHERE id = $2 RETURNING *`, [req.body.pinned, id]);
            if (!result.rows.length) throw new NotFoundError('Article non trouvé');
            await this.invalidateArticleCache(id, result.rows[0].slug);
            res.json({ success: true, data: result.rows[0], message: req.body.pinned ? 'Épinglé' : 'Désépinglé' });
        } catch (error) { next(error); }
    }

    async validate(req, res, next) {
        try {
            const { id } = req.params;
            const { statut, commentaire } = req.body;
            if (!['PUBLIE', 'REJETE'].includes(statut)) throw new ValidationError('Statut invalide');
            const result = await db.query(
                `UPDATE ARTICLES_BLOG_PLATEFORME SET statut = $1, valide_par = $2, date_validation = NOW(), commentaire_validation = $3 WHERE id = $4 RETURNING *`,
                [statut, req.user.id, commentaire, id]
            );
            if (!result.rows.length) throw new NotFoundError('Article non trouvé');
            NotificationService.send({
                destinataire_id: result.rows[0].auteur_id, type: 'ARTICLE_VALIDATION',
                titre: `Article ${statut === 'PUBLIE' ? 'approuvé' : 'rejeté'}`,
                corps: `Votre article "${result.rows[0].titre_article}" a été ${statut === 'PUBLIE' ? 'approuvé' : 'rejeté'}.${commentaire ? ` Motif: ${commentaire}` : ''}`,
                entite_source_type: 'ARTICLE_BLOG', entite_source_id: id
            }).catch(() => {});
            await this.invalidateArticleCache(id, result.rows[0].slug);
            res.json({ success: true, data: result.rows[0], message: `Article ${statut === 'PUBLIE' ? 'validé' : 'rejeté'}` });
        } catch (error) { next(error); }
    }

    // ========================================================================
    // LECTURE & RECHERCHE
    // ========================================================================

    async findAll(req, res, next) {
        try {
            const { page = 1, limit = 20, categorie, statut, auteur_id, recherche, date_debut, date_fin, tags, visibilite, est_epingle, tri = 'date_publication_desc', include_brouillons = false } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);
            let q = `SELECT a.*, c.nom_utilisateur_compte as auteur_nom, c.photo_profil_compte as auteur_photo, COUNT(*) OVER() as total_count FROM ARTICLES_BLOG_PLATEFORME a LEFT JOIN COMPTES c ON c.id = a.auteur_id WHERE 1=1`;
            const params = []; let pi = 1;

            if (!include_brouillons || req.user?.compte_role !== 'ADMINISTRATEUR_PLATEFORME') {
                q += ` AND (a.statut != 'BROUILLON' OR a.auteur_id = $${pi})`; params.push(req.user?.id || 0); pi++;
            }
            if (categorie) { q += ` AND a.categorie_principale = $${pi}`; params.push(categorie); pi++; }
            if (statut) { q += ` AND a.statut = $${pi}`; params.push(statut); pi++; }
            if (auteur_id) { q += ` AND a.auteur_id = $${pi}`; params.push(parseInt(auteur_id)); pi++; }
            if (est_epingle !== undefined) { q += ` AND a.est_epingle = $${pi}`; params.push(est_epingle === 'true'); pi++; }
            if (visibilite) { q += ` AND a.visibilite = $${pi}`; params.push(visibilite); pi++; }
            if (recherche) { q += ` AND (a.titre_article ILIKE $${pi} OR a.contenu_article ILIKE $${pi})`; params.push(`%${recherche}%`); pi++; }
            if (date_debut) { q += ` AND a.date_creation >= $${pi}`; params.push(date_debut); pi++; }
            if (date_fin) { q += ` AND a.date_creation <= $${pi}`; params.push(date_fin); pi++; }
            if (tags) { params.push(Array.isArray(tags) ? tags : tags.split(',')); q += ` AND a.mots_cles && $${pi}::text[]`; pi++; }

            const orderMap = {
                'date_publication_desc': 'a.date_publication DESC NULLS LAST', 'date_publication_asc': 'a.date_publication ASC NULLS LAST',
                'date_creation_desc': 'a.date_creation DESC', 'date_creation_asc': 'a.date_creation ASC',
                'titre_asc': 'a.titre_article ASC', 'titre_desc': 'a.titre_article DESC',
                'popularite_desc': 'a.nombre_vues DESC, a.date_publication DESC',
                'interaction_desc': '(a.nombre_vues * 1 + a.nombre_likes * 3 + a.nombre_commentaires * 5 + a.nombre_partages * 10 + COALESCE(a.nombre_favoris, 0) * 8) DESC'
            };
            q += ` ORDER BY ${orderMap[tri] || orderMap.date_publication_desc} LIMIT $${pi} OFFSET $${pi + 1}`;
            params.push(parseInt(limit), offset);

            const result = await db.query(q, params);
            const total = result.rows[0]?.total_count || 0;
            const enriched = await Promise.all(result.rows.map(async (a) => {
                const e = { ...a };
                if (req.user) {
                    try {
                        const like = await db.query('SELECT type_like FROM LIKES_ARTICLES WHERE article_id = $1 AND compte_id = $2', [a.id, req.user.id]);
                        e.user_like = like.rows[0]?.type_like || null;
                    } catch {}
                    try {
                        const fav = await db.query('SELECT id FROM FAVORIS_ARTICLES WHERE article_id = $1 AND compte_id = $2', [a.id, req.user.id]);
                        e.is_favorite = fav.rows.length > 0;
                    } catch {}
                }
                return e;
            }));

            res.json({ success: true, data: enriched, pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(total), pages: Math.ceil(parseInt(total) / parseInt(limit)) } });
        } catch (error) { next(error); }
    }

    async findOne(req, res, next) {
        try {
            const { identifier } = req.params;
            const cached = await CacheService.get(`blog:article:${identifier}`);
            if (cached && req.query.skip_cache !== 'true') return res.json({ success: true, data: cached, fromCache: true });

            const isId = !isNaN(parseInt(identifier));
            const { rows } = await db.query(`SELECT * FROM ARTICLES_BLOG_PLATEFORME WHERE ${isId ? 'id = $1' : 'slug = $1'}`, [identifier]);
            if (!rows.length) throw new NotFoundError('Article non trouvé');

            const article = rows[0];
            await this.checkAccess(article, req.user);

            if (req.query.increment_view !== 'false' && article.statut === 'PUBLIE') {
                try {
                    await db.query(`UPDATE ARTICLES_BLOG_PLATEFORME SET nombre_vues = nombre_vues + 1, nombre_vues_uniques = nombre_vues_uniques + CASE WHEN NOT EXISTS (SELECT 1 FROM STATS_LECTURE_ARTICLES WHERE article_id = $1 AND compte_id = $2) THEN 1 ELSE 0 END WHERE id = $1`, [article.id, req.user?.id]);
                    if (req.user) await db.query(`INSERT INTO ANALYTIQUES_LECTURE (article_id, compte_id, adresse_ip, user_agent, session_id, appareil_type, navigateur) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`, [article.id, req.user.id, req.ip, req.headers['user-agent'], req.session?.id, req.device?.type || 'DESKTOP', req.headers['user-agent']]);
                } catch {}
            }

            const [stats, comments, similar, related, quiz, sondages, favori] = await Promise.allSettled([
                this.getArticleStats(article.id),
                this.getArticleComments(article.id, req.user),
                this.getSimilarArticles(article, req.user),
                this.getRelatedArticles(article.id),
                this.getArticleQuiz(article.id),
                this.getArticleSondages(article.id),
                req.user ? db.query('SELECT id FROM FAVORIS_ARTICLES WHERE article_id = $1 AND compte_id = $2', [article.id, req.user.id]) : Promise.resolve({ rows: [] })
            ]);

            const enriched = {
                ...article,
                stats: stats.value || {},
                commentaires: comments.value || [],
                articles_similaires: similar.value || [],
                articles_lies: related.value || [],
                quiz: quiz.value || [],
                sondages: sondages.value || [],
                is_favorite: favori.value?.rows?.length > 0,
                user_like: req.user ? (await db.query('SELECT type_like FROM LIKES_ARTICLES WHERE article_id = $1 AND compte_id = $2', [article.id, req.user.id]).catch(() => ({ rows: [] }))).rows[0]?.type_like || null : null
            };

            await CacheService.set(`blog:article:${identifier}`, enriched, 600);
            res.json({ success: true, data: enriched });
        } catch (error) { next(error); }
    }

    // ========================================================================
    // NOUVELLES FONCTIONNALITÉS INTERACTIVES
    // ========================================================================

    /**
     * Ajouter/Retirer un article des favoris
     * @route POST /api/v1/blog/articles/:id/favori
     */
    async toggleFavori(req, res, next) {
        try {
            const { id } = req.params;
            const article = await db.query('SELECT id FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1', [id]);
            if (!article.rows.length) throw new NotFoundError('Article non trouvé');

            const existing = await db.query('SELECT id FROM FAVORIS_ARTICLES WHERE article_id = $1 AND compte_id = $2', [id, req.user.id]);
            
            if (existing.rows.length) {
                await db.query('DELETE FROM FAVORIS_ARTICLES WHERE id = $1', [existing.rows[0].id]);
                await db.query('UPDATE ARTICLES_BLOG_PLATEFORME SET nombre_favoris = GREATEST(0, nombre_favoris - 1) WHERE id = $1', [id]);
                res.json({ success: true, data: { is_favorite: false }, message: 'Retiré des favoris' });
            } else {
                await db.query('INSERT INTO FAVORIS_ARTICLES (article_id, compte_id) VALUES ($1, $2)', [id, req.user.id]);
                await db.query('UPDATE ARTICLES_BLOG_PLATEFORME SET nombre_favoris = nombre_favoris + 1 WHERE id = $1', [id]);
                res.json({ success: true, data: { is_favorite: true }, message: 'Ajouté aux favoris' });
            }
            await this.invalidateArticleCache(id, null);
        } catch (error) { next(error); }
    }

    /**
     * Enregistrer la progression de lecture
     * @route POST /api/v1/blog/articles/:id/progression
     */
    async saveProgression(req, res, next) {
        try {
            const { id } = req.params;
            const { pourcentage, temps_passe, scroll_position } = req.body;

            await db.query(
                `INSERT INTO ANALYTIQUES_LECTURE (article_id, compte_id, pourcentage_lu, temps_passe_secondes, scroll_max_pixels, est_termine) 
                 VALUES ($1, $2, $3, $4, $5, $6) 
                 ON CONFLICT (article_id, compte_id, session_id) DO UPDATE SET 
                    pourcentage_lu = GREATEST(analytiques_lecture.pourcentage_lu, $3),
                    temps_passe_secondes = analytiques_lecture.temps_passe_secondes + $4,
                    scroll_max_pixels = GREATEST(analytiques_lecture.scroll_max_pixels, $5),
                    est_termine = analytiques_lecture.est_termine OR $6`,
                [id, req.user?.id || null, pourcentage || 0, temps_passe || 0, scroll_position || 0, pourcentage >= 90]
            );

            res.json({ success: true, message: 'Progression enregistrée' });
        } catch (error) { next(error); }
    }

    /**
     * Récupérer les articles liés
     * @route GET /api/v1/blog/articles/:id/lies
     */
    async getRelatedArticles(articleId) {
        try {
            const { rows } = await db.query(
                `SELECT al.*, a.titre_article, a.slug, a.image_principale, a.extrait_contenu, a.date_publication
                 FROM ARTICLES_LIES al
                 JOIN ARTICLES_BLOG_PLATEFORME a ON a.id = al.article_lie_id
                 WHERE al.article_id = $1 AND a.statut = 'PUBLIE' AND a.est_archive = FALSE
                 ORDER BY al.pertinence DESC`,
                [articleId]
            );
            return rows;
        } catch { return []; }
    }

    /**
     * Récupérer les quiz d'un article
     */
    async getArticleQuiz(articleId) {
        try {
            const { rows } = await db.query(
                `SELECT q.*, COALESCE(json_agg(json_build_object('id', oq.id, 'texte', oq.texte_option, 'ordre', oq.ordre)) FILTER (WHERE oq.id IS NOT NULL), '[]') as options
                 FROM QUIZ_ARTICLES q
                 LEFT JOIN OPTIONS_QUIZ oq ON oq.quiz_id = q.id
                 WHERE q.article_id = $1
                 GROUP BY q.id
                 ORDER BY q.ordre`,
                [articleId]
            );
            return rows;
        } catch { return []; }
    }

    /**
     * Récupérer les sondages d'un article
     */
    async getArticleSondages(articleId) {
        try {
            const { rows } = await db.query(
                `SELECT s.*, COALESCE(json_agg(json_build_object('id', os.id, 'texte', os.texte_option, 'votes', os.nombre_votes, 'couleur', os.couleur)) FILTER (WHERE os.id IS NOT NULL), '[]') as options
                 FROM SONDAGES_ARTICLES s
                 LEFT JOIN OPTIONS_SONDAGE os ON os.sondage_id = s.id
                 WHERE s.article_id = $1 AND s.est_actif = TRUE
                 GROUP BY s.id
                 ORDER BY s.ordre`,
                [articleId]
            );
            return rows;
        } catch { return []; }
    }

    /**
     * Sauvegarder les articles liés
     */
    async saveRelatedArticles(client, articleId, relatedArticles) {
        for (const rel of relatedArticles) {
            await client.query(
                `INSERT INTO ARTICLES_LIES (article_id, article_lie_id, type_relation, pertinence, description_lien, est_manuel)
                 VALUES ($1, $2, $3, $4, $5, TRUE)
                 ON CONFLICT (article_id, article_lie_id) DO UPDATE SET type_relation = $3, pertinence = $4, description_lien = $5`,
                [articleId, rel.article_lie_id || rel.id, rel.type_relation || 'RELIE', rel.pertinence || 100, rel.description_lien || null]
            );
        }
    }

    // ========================================================================
    // MÉTHODES PRIVÉES EXISTANTES
    // ========================================================================

    async checkAccess(article, user) {
        if (article.visibilite === 'PUBLIC') return true;
        if (!user) throw new AuthorizationError('Authentification requise');
        if (article.visibilite === 'ABONNES') {
            const { rows } = await db.query('SELECT 1 FROM ABONNEMENTS_BLOG WHERE compte_id = $1 AND actif = true', [user.id]);
            if (!rows.length) throw new AuthorizationError('Abonnement requis');
        }
        if (article.visibilite === 'PRIVE') {
            const ok = article.auteur_id === user.id || article.co_auteurs?.includes(user.id) || ['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(user.compte_role);
            if (!ok) throw new AuthorizationError('Article privé');
        }
        if (article.visibilite === 'EQUIPE') {
            if (!['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME', 'BLOGUEUR_PLATEFORME'].includes(user.compte_role)) throw new AuthorizationError('Équipe uniquement');
        }
        if (article.droit_lecture_minimum_role) {
            const hierarchy = { 'UTILISATEUR_PRIVE_SIMPLE': 1, 'BLOGUEUR_COMPAGNIE': 2, 'STAFF_COMPAGNIE': 3, 'ADMINISTRATEUR_COMPAGNIE': 4, 'BLOGUEUR_PLATEFORME': 5, 'STAFF_PLATEFORME': 6, 'ADMINISTRATEUR_PLATEFORME': 7 };
            if ((hierarchy[user.compte_role] || 0) < (hierarchy[article.droit_lecture_minimum_role] || 0)) throw new AuthorizationError('Rôle insuffisant');
        }
        return true;
    }

    canModify(article, user) {
        if (!user) return false;
        if (['ADMINISTRATEUR_PLATEFORME', 'STAFF_PLATEFORME'].includes(user.compte_role)) return true;
        return article.auteur_id === user.id || article.co_auteurs?.includes(user.id);
    }

    canDelete(article, user) {
        return user && ['ADMINISTRATEUR_PLATEFORME'].includes(user.compte_role);
    }

    async getArticleStats(id, periode = '30d') {
        const stats = {};
        try {
            const g = await db.query('SELECT nombre_vues, nombre_vues_uniques, nombre_likes, nombre_dislikes, nombre_partages, nombre_commentaires, COALESCE(nombre_favoris, 0) as nombre_favoris FROM ARTICLES_BLOG_PLATEFORME WHERE id = $1', [id]);
            if (g.rows[0]) Object.assign(stats, g.rows[0]);
            const t = await db.query('SELECT AVG(temps_lecture_secondes) as temps_moyen, AVG(pourcentage_lu) as pourcentage_moyen, COUNT(*) as total_lectures FROM ANALYTIQUES_LECTURE WHERE article_id = $1', [id]);
            stats.temps_lecture = t.rows[0] || {};
            const e = await db.query(`SELECT DATE(date_debut) as date, COUNT(*) as vues FROM ANALYTIQUES_LECTURE WHERE article_id = $1 AND date_debut >= NOW() - $2::interval GROUP BY DATE(date_debut) ORDER BY date DESC`, [id, periode]);
            stats.evolution = e.rows;
        } catch (e) { console.error('Stats error:', e); }
        return stats;
    }

    async getArticleComments(articleId, user) {
        try {
            const { rows } = await db.query(
                `WITH RECURSIVE ct AS (
                    SELECT c.*, u.nom_utilisateur_compte as auteur_nom, u.photo_profil_compte as auteur_photo, 0 as niveau, ARRAY[c.id] as chemin,
                           CASE WHEN $2::int IS NOT NULL THEN EXISTS(SELECT 1 FROM LIKES_COMMENTAIRES WHERE commentaire_id = c.id AND compte_id = $2) ELSE false END as user_liked
                    FROM COMMENTAIRES c LEFT JOIN COMPTES u ON u.id = c.auteur_id
                    WHERE c.article_id = $1 AND c.statut = 'APPROUVE' AND c.commentaire_parent_id IS NULL
                    UNION ALL
                    SELECT c.*, u.nom_utilisateur_compte, u.photo_profil_compte, ct.niveau + 1, ct.chemin || c.id,
                           CASE WHEN $2::int IS NOT NULL THEN EXISTS(SELECT 1 FROM LIKES_COMMENTAIRES WHERE commentaire_id = c.id AND compte_id = $2) ELSE false END
                    FROM COMMENTAIRES c LEFT JOIN COMPTES u ON u.id = c.auteur_id INNER JOIN ct ON ct.id = c.commentaire_parent_id
                    WHERE c.statut = 'APPROUVE'
                ) SELECT * FROM ct ORDER BY chemin`,
                [articleId, user?.id || null]
            );
            if (!rows.length) return [];
            const map = new Map(), roots = [];
            for (const c of rows) map.set(c.id, { ...c, reponses: [] });
            for (const c of rows) {
                const node = map.get(c.id);
                if (!c.commentaire_parent_id) roots.push(node);
                else map.get(c.commentaire_parent_id)?.reponses.push(node);
            }
            return roots;
        } catch { return []; }
    }

    async getSimilarArticles(article, user, limit = 5) {
        try {
            const { rows } = await db.query(
                `SELECT a.*, c.nom_utilisateur_compte as auteur_nom, COUNT(DISTINCT l.id) as total_likes
                 FROM ARTICLES_BLOG_PLATEFORME a LEFT JOIN COMPTES c ON c.id = a.auteur_id LEFT JOIN LIKES_ARTICLES l ON l.article_id = a.id
                 WHERE a.id != $1 AND a.statut = 'PUBLIE' AND a.est_archive = false
                   AND (a.categorie_principale = $2 OR a.mots_cles && $3 OR a.auteur_id = $4)
                 GROUP BY a.id, c.nom_utilisateur_compte
                 ORDER BY (CASE WHEN a.categorie_principale = $2 THEN 3 ELSE 0 END + CASE WHEN a.mots_cles && $3 THEN 2 ELSE 0 END + CASE WHEN a.auteur_id = $4 THEN 1 ELSE 0 END) DESC, a.date_publication DESC NULLS LAST
                 LIMIT $5`,
                [article.id, article.categorie_principale, article.mots_cles || [], article.auteur_id, limit]
            );
            return rows;
        } catch { return []; }
    }

    async notifySubscribers(article, client) {
        try {
            const { rows } = await client.query(
                `SELECT DISTINCT compte_id FROM ABONNEMENTS_BLOG WHERE (type_abonnement = 'CATEGORIE' AND reference_id = $1) OR (type_abonnement = 'AUTEUR' AND reference_id = $2) OR (type_abonnement = 'TAG' AND reference_id = ANY($3)) AND actif = true`,
                [article.categorie_principale, article.auteur_id, article.mots_cles || []]
            );
            for (const sub of rows) {
                NotificationService.send({
                    destinataire_id: sub.compte_id, type: 'NOUVEL_ARTICLE',
                    titre: `Nouvel article: ${article.titre_article}`,
                    corps: 'Découvrez le nouvel article',
                    entite_source_type: 'ARTICLE_BLOG', entite_source_id: article.id,
                    action_url: `/blog/${article.slug}`
                }).catch(() => {});
            }
        } catch (e) { console.error('Notify error:', e); }
    }
}

module.exports = new ArticleController();