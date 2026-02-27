const Constants = require('../../configuration/constants');
const { Database } = require('../../models');
const CacheService = require('../cache/CacheService');

class SearchService {
  constructor() {
    this.useElasticsearch = process.env.ELASTICSEARCH_URL ? true : false;
    if (this.useElasticsearch) {
      this.initElasticsearch();
    }
  }

  /**
   * Initialiser Elasticsearch
   */
  initElasticsearch() {
    const { Client } = require('@elastic/elasticsearch');
    this.esClient = new Client({
      node: process.env.ELASTICSEARCH_URL,
      auth: {
        username: process.env.ELASTICSEARCH_USER,
        password: process.env.ELASTICSEARCH_PASS
      }
    });
  }

  /**
   * Recherche unifiée
   */
  async search(query, options = {}) {
    const {
      types = ['restaurants', 'boutiques', 'produits', 'articles', 'compagnies'],
      limit = Constants.CONFIG.PAGINATION.DEFAULT_LIMIT,
      offset = 0,
      lat = null,
      lng = null,
      rayon = 5000,
      categorie = null,
      prix_min = null,
      prix_max = null,
      note_min = null,
      ouvert_maintenant = false
    } = options;

    const cacheKey = CacheService.generateKey(['search', query, JSON.stringify(options)]);
    const cached = await CacheService.get(cacheKey);
    
    if (cached) {
      return cached;
    }

    const results = await Promise.all(
      types.map(type => this.searchByType(type, query, {
        limit: Math.ceil(limit / types.length),
        offset: 0,
        lat,
        lng,
        rayon,
        categorie,
        prix_min,
        prix_max,
        note_min,
        ouvert_maintenant
      }))
    );

    // Fusionner et trier les résultats
    let allResults = results.flat();
    allResults.sort((a, b) => b.score - a.score);

    // Paginer
    const paginated = allResults.slice(offset, offset + limit);

    const response = {
      query,
      total: allResults.length,
      returned: paginated.length,
      offset,
      limit,
      results: paginated,
      facets: await this.getFacets(query, types)
    };

    // Mettre en cache (5 minutes)
    await CacheService.set(cacheKey, response, Constants.CONFIG.CACHE.TTL.SHORT);

    return response;
  }

  /**
   * Rechercher par type d'entité
   */
  async searchByType(type, query, options) {
    switch (type) {
      case 'restaurants':
        return this.searchRestaurants(query, options);
      case 'boutiques':
        return this.searchBoutiques(query, options);
      case 'produits':
        return this.searchProduits(query, options);
      case 'articles':
        return this.searchArticles(query, options);
      case 'compagnies':
        return this.searchCompagnies(query, options);
      default:
        return [];
    }
  }

  /**
   * Rechercher des restaurants
   */
  async searchRestaurants(query, options) {
    const {
      limit = 20,
      offset = 0,
      lat,
      lng,
      rayon = 5000,
      categorie,
      note_min,
      ouvert_maintenant
    } = options;

    let sql = `
      SELECT 
        rf.id,
        rf.nom_restaurant_fast_food as nom,
        rf.logo_restaurant as logo,
        rf.description_restaurant_fast_food as description,
        'RESTAURANT' as type,
        COUNT(DISTINCT erf.id) as nombre_emplacements,
        AVG(a.note_globale) as note_moyenne,
        ts_rank(to_tsvector('french', rf.nom_restaurant_fast_food || ' ' || COALESCE(rf.description_restaurant_fast_food, '')), 
                plainto_tsquery('french', $1)) as rank
    `;

    if (lat && lng) {
      sql += `,
        MIN(ST_Distance(
          erf.localisation_restaurant::geography,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
        )) as distance
      `;
    }

    sql += `
      FROM RESTAURANTSFASTFOOD rf
      LEFT JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id_restaurant_fast_food = rf.id
      LEFT JOIN AVIS a ON a.entite_type = 'RESTAURANT_FAST_FOOD' AND a.entite_id = rf.id AND a.statut = 'PUBLIE'
      WHERE rf.est_actif = true
        AND (to_tsvector('french', rf.nom_restaurant_fast_food || ' ' || COALESCE(rf.description_restaurant_fast_food, '')) @@ plainto_tsquery('french', $1)
             OR $1 = '')
    `;

    const params = [query];

    if (lat && lng) {
      sql += ` AND EXISTS (
        SELECT 1 FROM EMPLACEMENTSRESTAURANTFASTFOOD erf2
        WHERE erf2.id_restaurant_fast_food = rf.id
          AND ST_DWithin(
            erf2.localisation_restaurant::geography,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
            ${rayon}
          )
      )`;
    }

    if (categorie) {
      sql += ` AND rf.id IN (
        SELECT DISTINCT id_restaurant_fast_food 
        FROM EMPLACEMENTSRESTAURANTFASTFOOD erf3
        JOIN MENURESTAURANTFASTFOOD mrf ON mrf.id_restaurant_fast_food_emplacement = erf3.id
        WHERE mrf.categorie_menu = $${params.length + 1}
      )`;
      params.push(categorie);
    }

    if (note_min) {
      sql += ` AND rf.id IN (
        SELECT entite_id 
        FROM AVIS 
        WHERE entite_type = 'RESTAURANT_FAST_FOOD' 
        GROUP BY entite_id 
        HAVING AVG(note_globale) >= $${params.length + 1}
      )`;
      params.push(note_min);
    }

    if (ouvert_maintenant) {
      sql += ` AND EXISTS (
        SELECT 1 FROM EMPLACEMENTSRESTAURANTFASTFOOD erf4
        WHERE erf4.id_restaurant_fast_food = rf.id
          AND fn_est_ouvert('EMPLACEMENT_RESTAURANT', erf4.id, NOW()) = true
      )`;
    }

    sql += ` GROUP BY rf.id, rf.nom_restaurant_fast_food, rf.logo_restaurant, rf.description_restaurant_fast_food
             ORDER BY rank DESC, note_moyenne DESC NULLS LAST
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    
    params.push(limit, offset);

    const result = await Database.query(sql, params);
    
    return result.rows.map(r => ({
      ...r,
      score: r.rank,
      url: `/restaurants/${r.id}`
    }));
  }

  /**
   * Rechercher des boutiques
   */
  async searchBoutiques(query, options) {
    const {
      limit = 20,
      offset = 0,
      lat,
      lng,
      rayon = 5000,
      categorie,
      note_min
    } = options;

    let sql = `
      SELECT 
        b.id,
        b.nom_boutique as nom,
        b.logo_boutique as logo,
        b.description_boutique as description,
        'BOUTIQUE' as type,
        COUNT(DISTINCT pb.id) as nombre_produits,
        AVG(a.note_globale) as note_moyenne,
        ts_rank(to_tsvector('french', b.nom_boutique || ' ' || COALESCE(b.description_boutique, '')), 
                plainto_tsquery('french', $1)) as rank
      FROM BOUTIQUES b
      LEFT JOIN PRODUITSBOUTIQUE pb ON pb.id_boutique = b.id
      LEFT JOIN AVIS a ON a.entite_type = 'BOUTIQUE' AND a.entite_id = b.id AND a.statut = 'PUBLIE'
      WHERE b.est_actif = true
        AND (to_tsvector('french', b.nom_boutique || ' ' || COALESCE(b.description_boutique, '')) @@ plainto_tsquery('french', $1)
             OR $1 = '')
    `;

    const params = [query];

    if (categorie) {
      sql += ` AND b.id IN (
        SELECT DISTINCT id_boutique 
        FROM PRODUITSBOUTIQUE 
        WHERE id_categorie IN (
          SELECT id FROM CATEGORIES_BOUTIQUE 
          WHERE nom_categorie ILIKE $${params.length + 1}
        )
      )`;
      params.push(`%${categorie}%`);
    }

    if (note_min) {
      sql += ` AND b.id IN (
        SELECT entite_id 
        FROM AVIS 
        WHERE entite_type = 'BOUTIQUE' 
        GROUP BY entite_id 
        HAVING AVG(note_globale) >= $${params.length + 1}
      )`;
      params.push(note_min);
    }

    sql += ` GROUP BY b.id, b.nom_boutique, b.logo_boutique, b.description_boutique
             ORDER BY rank DESC, note_moyenne DESC NULLS LAST
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    
    params.push(limit, offset);

    const result = await Database.query(sql, params);
    
    return result.rows.map(r => ({
      ...r,
      score: r.rank,
      url: `/boutiques/${r.id}`
    }));
  }

  /**
   * Rechercher des produits
   */
  async searchProduits(query, options) {
    const {
      limit = 20,
      offset = 0,
      prix_min,
      prix_max,
      categorie,
      note_min,
      en_promo = false,
      en_stock = false
    } = options;

    let sql = `
      SELECT 
        pb.id,
        pb.nom_produit as nom,
        pb.image_produit as image,
        pb.description_produit as description,
        pb.prix_unitaire_produit as prix,
        pb.prix_promo,
        'PRODUIT' as type,
        cb.nom_categorie,
        b.nom_boutique,
        b.id as boutique_id,
        AVG(a.note_globale) as note_moyenne,
        ts_rank(to_tsvector('french', pb.nom_produit || ' ' || COALESCE(pb.description_produit, '')), 
                plainto_tsquery('french', $1)) as rank
      FROM PRODUITSBOUTIQUE pb
      JOIN CATEGORIES_BOUTIQUE cb ON cb.id = pb.id_categorie
      JOIN BOUTIQUES b ON b.id = pb.id_boutique
      LEFT JOIN AVIS a ON a.entite_type = 'PRODUIT_BOUTIQUE' AND a.entite_id = pb.id AND a.statut = 'PUBLIE'
      WHERE pb.est_disponible = true
        AND (to_tsvector('french', pb.nom_produit || ' ' || COALESCE(pb.description_produit, '')) @@ plainto_tsquery('french', $1)
             OR $1 = '')
    `;

    const params = [query];

    if (prix_min !== null) {
      sql += ` AND pb.prix_unitaire_produit >= $${params.length + 1}`;
      params.push(prix_min);
    }

    if (prix_max !== null) {
      sql += ` AND pb.prix_unitaire_produit <= $${params.length + 1}`;
      params.push(prix_max);
    }

    if (categorie) {
      sql += ` AND cb.nom_categorie ILIKE $${params.length + 1}`;
      params.push(`%${categorie}%`);
    }

    if (note_min) {
      sql += ` AND pb.id IN (
        SELECT entite_id 
        FROM AVIS 
        WHERE entite_type = 'PRODUIT_BOUTIQUE' 
        GROUP BY entite_id 
        HAVING AVG(note_globale) >= $${params.length + 1}
      )`;
      params.push(note_min);
    }

    if (en_promo) {
      sql += ` AND pb.prix_promo IS NOT NULL`;
    }

    if (en_stock) {
      sql += ` AND (pb.quantite = -1 OR pb.quantite > 0)`;
    }

    sql += ` GROUP BY pb.id, pb.nom_produit, pb.image_produit, pb.description_produit,
                      pb.prix_unitaire_produit, pb.prix_promo, cb.nom_categorie,
                      b.nom_boutique, b.id
             ORDER BY rank DESC, note_moyenne DESC NULLS LAST
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    
    params.push(limit, offset);

    const result = await Database.query(sql, params);
    
    return result.rows.map(r => ({
      ...r,
      score: r.rank,
      url: `/produits/${r.id}`,
      prix_effectif: r.prix_promo || r.prix
    }));
  }

  /**
   * Rechercher des articles de blog
   */
  async searchArticles(query, options) {
    const {
      limit = 20,
      offset = 0,
      categorie,
      auteur_id,
      date_debut,
      date_fin
    } = options;

    let sql = `
      SELECT 
        a.id,
        a.titre_article as titre,
        a.slug,
        a.extrait_contenu as extrait,
        a.image_principale as image,
        a.categorie_principale as categorie,
        a.date_publication,
        u.nom_utilisateur_compte as auteur_nom,
        u.photo_profil_compte as auteur_photo,
        a.nombre_vues,
        a.nombre_likes,
        ts_rank(to_tsvector('french', a.titre_article || ' ' || COALESCE(a.contenu_article, '')), 
                plainto_tsquery('french', $1)) as rank
      FROM ARTICLES_BLOG_PLATEFORME a
      JOIN COMPTES u ON u.id = a.auteur_id
      WHERE a.statut = 'PUBLIE'
        AND a.est_archive = false
        AND (to_tsvector('french', a.titre_article || ' ' || COALESCE(a.contenu_article, '')) @@ plainto_tsquery('french', $1)
             OR $1 = '')
    `;

    const params = [query];

    if (categorie) {
      sql += ` AND a.categorie_principale = $${params.length + 1}`;
      params.push(categorie);
    }

    if (auteur_id) {
      sql += ` AND a.auteur_id = $${params.length + 1}`;
      params.push(auteur_id);
    }

    if (date_debut) {
      sql += ` AND a.date_publication >= $${params.length + 1}`;
      params.push(date_debut);
    }

    if (date_fin) {
      sql += ` AND a.date_publication <= $${params.length + 1}`;
      params.push(date_fin);
    }

    sql += ` ORDER BY rank DESC, a.date_publication DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    
    params.push(limit, offset);

    const result = await Database.query(sql, params);
    
    return result.rows.map(r => ({
      ...r,
      type: 'ARTICLE',
      score: r.rank,
      url: `/blog/${r.slug}`
    }));
  }

  /**
   * Rechercher des compagnies de transport
   */
  async searchCompagnies(query, options) {
    const {
      limit = 20,
      offset = 0,
      note_min
    } = options;

    let sql = `
      SELECT 
        ct.id,
        ct.nom_compagnie as nom,
        ct.logo_compagnie as logo,
        ct.description_compagnie as description,
        'COMPAGNIE' as type,
        COUNT(DISTINCT et.id) as nombre_emplacements,
        AVG(a.note_globale) as note_moyenne,
        ts_rank(to_tsvector('french', ct.nom_compagnie || ' ' || COALESCE(ct.description_compagnie, '')), 
                plainto_tsquery('french', $1)) as rank
      FROM COMPAGNIESTRANSPORT ct
      LEFT JOIN EMPLACEMENTSTRANSPORT et ON et.compagnie_id = ct.id
      LEFT JOIN AVIS a ON a.entite_type = 'COMPAGNIE_TRANSPORT' AND a.entite_id = ct.id AND a.statut = 'PUBLIE'
      WHERE ct.est_actif = true
        AND (to_tsvector('french', ct.nom_compagnie || ' ' || COALESCE(ct.description_compagnie, '')) @@ plainto_tsquery('french', $1)
             OR $1 = '')
    `;

    const params = [query];

    if (note_min) {
      sql += ` AND ct.id IN (
        SELECT entite_id 
        FROM AVIS 
        WHERE entite_type = 'COMPAGNIE_TRANSPORT' 
        GROUP BY entite_id 
        HAVING AVG(note_globale) >= $${params.length + 1}
      )`;
      params.push(note_min);
    }

    sql += ` GROUP BY ct.id, ct.nom_compagnie, ct.logo_compagnie, ct.description_compagnie
             ORDER BY rank DESC, note_moyenne DESC NULLS LAST
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    
    params.push(limit, offset);

    const result = await Database.query(sql, params);
    
    return result.rows.map(r => ({
      ...r,
      score: r.rank,
      url: `/transport/compagnies/${r.id}`
    }));
  }

  /**
   * Obtenir les facettes de recherche
   */
  async getFacets(query, types) {
    const facets = {};

    if (types.includes('restaurants')) {
      facets.categories_restaurant = await this.getCategoryFacets('restaurant', query);
    }

    if (types.includes('boutiques')) {
      facets.categories_boutique = await this.getCategoryFacets('boutique', query);
    }

    if (types.includes('produits')) {
      facets.prix_ranges = await this.getPriceFacets(query);
    }

    if (types.includes('articles')) {
      facets.categories_article = await this.getArticleCategoryFacets(query);
    }

    return facets;
  }

  /**
   * Obtenir les facettes de catégories
   */
  async getCategoryFacets(type, query) {
    let sql;
    
    if (type === 'restaurant') {
      sql = `
        SELECT 
          mrf.categorie_menu as categorie,
          COUNT(DISTINCT mrf.id) as count
        FROM MENURESTAURANTFASTFOOD mrf
        JOIN EMPLACEMENTSRESTAURANTFASTFOOD erf ON erf.id = mrf.id_restaurant_fast_food_emplacement
        JOIN RESTAURANTSFASTFOOD rf ON rf.id = erf.id_restaurant_fast_food
        WHERE rf.est_actif = true
          AND mrf.disponible = true
          AND (to_tsvector('french', rf.nom_restaurant_fast_food) @@ plainto_tsquery('french', $1)
               OR $1 = '')
        GROUP BY mrf.categorie_menu
        ORDER BY count DESC
      `;
    } else if (type === 'boutique') {
      sql = `
        SELECT 
          cb.nom_categorie as categorie,
          COUNT(DISTINCT pb.id) as count
        FROM PRODUITSBOUTIQUE pb
        JOIN CATEGORIES_BOUTIQUE cb ON cb.id = pb.id_categorie
        JOIN BOUTIQUES b ON b.id = pb.id_boutique
        WHERE b.est_actif = true
          AND pb.est_disponible = true
          AND (to_tsvector('french', b.nom_boutique) @@ plainto_tsquery('french', $1)
               OR $1 = '')
        GROUP BY cb.nom_categorie
        ORDER BY count DESC
      `;
    }

    const result = await Database.query(sql, [query]);
    return result.rows;
  }

  /**
   * Obtenir les facettes de prix
   */
  async getPriceFacets(query) {
    const ranges = [
      { min: 0, max: 1000, label: 'Moins de 1000 FCFA' },
      { min: 1000, max: 5000, label: '1000 - 5000 FCFA' },
      { min: 5000, max: 10000, label: '5000 - 10000 FCFA' },
      { min: 10000, max: 50000, label: '10000 - 50000 FCFA' },
      { min: 50000, max: null, label: 'Plus de 50000 FCFA' }
    ];

    const sql = `
      SELECT 
        CASE 
          WHEN prix_unitaire_produit < 1000 THEN 'Moins de 1000 FCFA'
          WHEN prix_unitaire_produit BETWEEN 1000 AND 5000 THEN '1000 - 5000 FCFA'
          WHEN prix_unitaire_produit BETWEEN 5000 AND 10000 THEN '5000 - 10000 FCFA'
          WHEN prix_unitaire_produit BETWEEN 10000 AND 50000 THEN '10000 - 50000 FCFA'
          ELSE 'Plus de 50000 FCFA'
        END as range,
        COUNT(*) as count
      FROM PRODUITSBOUTIQUE pb
      JOIN BOUTIQUES b ON b.id = pb.id_boutique
      WHERE b.est_actif = true
        AND pb.est_disponible = true
        AND (to_tsvector('french', pb.nom_produit) @@ plainto_tsquery('french', $1)
             OR $1 = '')
      GROUP BY range
      ORDER BY 
        CASE range
          WHEN 'Moins de 1000 FCFA' THEN 1
          WHEN '1000 - 5000 FCFA' THEN 2
          WHEN '5000 - 10000 FCFA' THEN 3
          WHEN '10000 - 50000 FCFA' THEN 4
          ELSE 5
        END
    `;

    const result = await Database.query(sql, [query]);
    return result.rows;
  }

  /**
   * Obtenir les facettes de catégories d'articles
   */
  async getArticleCategoryFacets(query) {
    const sql = `
      SELECT 
        categorie_principale as categorie,
        COUNT(*) as count
      FROM ARTICLES_BLOG_PLATEFORME
      WHERE statut = 'PUBLIE'
        AND est_archive = false
        AND (to_tsvector('french', titre_article || ' ' || COALESCE(contenu_article, '')) @@ plainto_tsquery('french', $1)
             OR $1 = '')
      GROUP BY categorie_principale
      ORDER BY count DESC
    `;

    const result = await Database.query(sql, [query]);
    return result.rows;
  }

  /**
   * Suggestions de recherche
   */
  async suggest(query, limit = 5) {
    const cacheKey = CacheService.generateKey(['suggest', query]);
    const cached = await CacheService.get(cacheKey);
    
    if (cached) {
      return cached;
    }

    const sql = `
      (SELECT nom_restaurant_fast_food as text, 'RESTAURANT' as type, 1 as priority
       FROM RESTAURANTSFASTFOOD
       WHERE est_actif = true AND nom_restaurant_fast_food ILIKE $1
       LIMIT $2)
      
      UNION ALL
      
      (SELECT nom_boutique as text, 'BOUTIQUE' as type, 1 as priority
       FROM BOUTIQUES
       WHERE est_actif = true AND nom_boutique ILIKE $1
       LIMIT $2)
      
      UNION ALL
      
      (SELECT nom_produit as text, 'PRODUIT' as type, 2 as priority
       FROM PRODUITSBOUTIQUE
       WHERE est_disponible = true AND nom_produit ILIKE $1
       LIMIT $2)
      
      UNION ALL
      
      (SELECT titre_article as text, 'ARTICLE' as type, 2 as priority
       FROM ARTICLES_BLOG_PLATEFORME
       WHERE statut = 'PUBLIE' AND titre_article ILIKE $1
       LIMIT $2)
      
      ORDER BY priority, text
      LIMIT $2
    `;

    const result = await Database.query(sql, [`%${query}%`, limit]);
    
    await CacheService.set(cacheKey, result.rows, Constants.CONFIG.CACHE.TTL.SHORT);
    
    return result.rows;
  }

  /**
   * Recherche avancée avec Elasticsearch (si configuré)
   */
  async searchElasticsearch(query, options) {
    if (!this.useElasticsearch) {
      return this.search(query, options);
    }

    // Implémentation Elasticsearch
    // À compléter selon les besoins
  }
}

module.exports = new SearchService();