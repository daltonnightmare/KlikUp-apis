// src/controllers/admin/DashboardController.js
const pool = require('../../configuration/database');
const { AppError } = require('../../utils/errors/AppError');
const { ValidationError } = require('../../utils/errors/AppError');
const CacheService = require('../../services/cache/CacheService');
const ExportService = require('../../services/export/ExportService');
const { logInfo, logError } = require('../../configuration/logger');

class DashboardController {
    /**
     * Récupérer les statistiques globales de la plateforme
     * @route GET /api/v1/admin/dashboard/stats
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getGlobalStats(req, res, next) {
        try {
            const { periode = '30j', date_debut, date_fin } = req.query;

            // Vérification cache
            const cacheKey = `admin:dashboard:global:${periode}:${date_debut}:${date_fin}`;
            const cached = await CacheService.get(cacheKey);
            if (cached) {
                return res.json({
                    status: 'success',
                    data: cached,
                    from_cache: true
                });
            }

            let intervalle;
            let groupBy;

            switch (periode) {
                case '24h':
                    intervalle = "INTERVAL '24 hours'";
                    groupBy = "date_trunc('hour', date_creation)";
                    break;
                case '7j':
                    intervalle = "INTERVAL '7 days'";
                    groupBy = 'DATE(date_creation)';
                    break;
                case '30j':
                    intervalle = "INTERVAL '30 days'";
                    groupBy = 'DATE(date_creation)';
                    break;
                case '90j':
                    intervalle = "INTERVAL '90 days'";
                    groupBy = "date_trunc('week', date_creation)";
                    break;
                case 'an':
                    intervalle = "INTERVAL '1 year'";
                    groupBy = "date_trunc('month', date_creation)";
                    break;
                case 'personnalise':
                    if (!date_debut || !date_fin) {
                        throw new ValidationError('Dates requises pour la période personnalisée');
                    }
                    intervalle = null;
                    groupBy = 'DATE(date_creation)';
                    break;
                default:
                    intervalle = "INTERVAL '30 days'";
                    groupBy = 'DATE(date_creation)';
            }

            const dateCondition = periode === 'personnalise'
                ? `date_creation BETWEEN '${date_debut}' AND '${date_fin}'`
                : `date_creation >= NOW() - ${intervalle}`;

            // 1. STATISTIQUES COMPTES
            const statsComptes = await pool.query(`
                SELECT 
                    COUNT(*) as total_comptes,
                    COUNT(*) FILTER (WHERE date_creation >= NOW() - INTERVAL '7 days') as nouveaux_7j,
                    COUNT(*) FILTER (WHERE date_creation >= NOW() - INTERVAL '30 days') as nouveaux_30j,
                    COUNT(*) FILTER (WHERE statut = 'EST_AUTHENTIFIE') as comptes_actifs,
                    COUNT(*) FILTER (WHERE statut = 'SUSPENDU') as comptes_suspendus,
                    COUNT(*) FILTER (WHERE statut = 'BANNI') as comptes_bannis,
                    COUNT(*) FILTER (WHERE compte_role LIKE '%ADMINISTRATEUR%') as administrateurs,
                    COUNT(*) FILTER (WHERE compte_role LIKE '%BLOGUEUR%') as blogueurs,
                    COUNT(*) FILTER (WHERE compagnie_id IS NOT NULL) as comptes_compagnie,
                    COUNT(*) FILTER (WHERE restaurant_id IS NOT NULL) as comptes_restaurant,
                    COUNT(*) FILTER (WHERE boutique_id IS NOT NULL) as comptes_boutique
                FROM COMPTES
                WHERE est_supprime = false
            `);

            // 2. STATISTIQUES COMMANDES
            const statsCommandes = await pool.query(`
                SELECT 
                    COUNT(*) as total_commandes,
                    SUM(prix_total_commande) as chiffre_affaires_total,
                    AVG(prix_total_commande) as panier_moyen,
                    COUNT(*) FILTER (WHERE date_commande >= NOW() - INTERVAL '7 days') as commandes_7j,
                    SUM(prix_total_commande) FILTER (WHERE date_commande >= NOW() - INTERVAL '7 days') as ca_7j,
                    COUNT(*) FILTER (WHERE statut_commande = 'EN_ATTENTE') as commandes_attente,
                    COUNT(*) FILTER (WHERE statut_commande = 'LIVREE') as commandes_livrees,
                    COUNT(*) FILTER (WHERE statut_commande = 'ANNULEE') as commandes_annulees
                FROM COMMANDESBOUTIQUES
            `);

            // 3. STATISTIQUES BOUTIQUES
            const statsBoutiques = await pool.query(`
                SELECT 
                    COUNT(*) as total_boutiques,
                    COUNT(*) FILTER (WHERE est_actif = true) as boutiques_actives,
                    COUNT(*) FILTER (WHERE est_supprime = false AND date_creation >= NOW() - INTERVAL '30 days') as nouvelles_boutiques,
                    SUM(portefeuille_boutique) as portefeuille_total_boutiques
                FROM BOUTIQUES
                WHERE est_supprime = false
            `);

            // 4. STATISTIQUES RESTAURANTS
            const statsRestaurants = await pool.query(`
                SELECT 
                    COUNT(*) as total_restaurants,
                    COUNT(*) FILTER (WHERE est_actif = true) as restaurants_actifs,
                    SUM(portefeuille_restaurant_fast_food) as portefeuille_total_restaurants
                FROM RESTAURANTSFASTFOOD
                WHERE est_supprime = false
            `);

            // 5. STATISTIQUES TRANSPORT
            const statsTransport = await pool.query(`
                SELECT 
                    COUNT(*) as total_compagnies,
                    COUNT(*) as total_emplacements,
                    SUM(portefeuille_compagnie) as portefeuille_total_compagnies
                FROM COMPAGNIESTRANSPORT
                WHERE est_supprime = false
            `);

            // 6. STATISTIQUES BLOG
            const statsBlog = await pool.query(`
                SELECT 
                    COUNT(*) as total_articles,
                    COUNT(*) FILTER (WHERE statut = 'PUBLIE') as articles_publies,
                    COUNT(*) FILTER (WHERE statut = 'EN_ATTENTE_VALIDATION') as articles_validation,
                    COUNT(*) as total_commentaires,
                    COUNT(*) FILTER (WHERE statut = 'EN_ATTENTE') as commentaires_moderation
                FROM ARTICLES_BLOG_PLATEFORME
            `);

            // 7. STATISTIQUES FINANCIÈRES
            const statsFinancieres = await pool.query(`
                SELECT 
                    COALESCE(SUM(portefeuille_plateforme), 0) as portefeuille_plateforme,
                    COALESCE((
                        SELECT SUM(prix_total_commande) 
                        FROM COMMANDESBOUTIQUES 
                        WHERE date_commande >= NOW() - INTERVAL '30 days'
                    ), 0) as ca_mensuel,
                    COALESCE((
                        SELECT SUM(prix_total_commande) 
                        FROM COMMANDESEMPLACEMENTFASTFOOD 
                        WHERE date_commande >= NOW() - INTERVAL '30 days'
                    ), 0) as ca_restauration_mensuel,
                    COALESCE((
                        SELECT SUM(total_transaction) 
                        FROM ACHATSTICKETSPRIVE 
                        WHERE date_achat_prive >= NOW() - INTERVAL '30 days'
                    ), 0) as ca_transport_mensuel
                FROM PLATEFORME
                LIMIT 1
            `);

            // 8. ÉVOLUTION JOURNALIÈRE
            const evolution = await pool.query(`
                WITH dates AS (
                    SELECT generate_series(
                        CASE 
                            WHEN $1 = '24h' THEN NOW() - INTERVAL '24 hours'
                            WHEN $1 = '7j' THEN NOW() - INTERVAL '7 days'
                            ELSE NOW() - INTERVAL '30 days'
                        END,
                        NOW(),
                        CASE 
                            WHEN $1 = '24h' THEN '1 hour'::interval
                            ELSE '1 day'::interval
                        END
                    ) as date
                )
                SELECT 
                    dates.date,
                    COUNT(DISTINCT c.id) as nouvelles_inscriptions,
                    COUNT(DISTINCT cb.id) as nouvelles_commandes,
                    COALESCE(SUM(cb.prix_total_commande), 0) as chiffre_affaires
                FROM dates
                LEFT JOIN COMPTES c ON DATE(c.date_creation) = DATE(dates.date)
                LEFT JOIN COMMANDESBOUTIQUES cb ON DATE(cb.date_commande) = DATE(dates.date)
                GROUP BY dates.date
                ORDER BY dates.date DESC
            `, [periode]);

            // 9. TOP 10 DES MEILLEURES BOUTIQUES
            const topBoutiques = await pool.query(`
                SELECT 
                    b.id,
                    b.nom_boutique,
                    b.logo_boutique,
                    COUNT(cb.id) as total_commandes,
                    SUM(cb.prix_total_commande) as chiffre_affaires,
                    AVG(a.note_globale) as note_moyenne
                FROM BOUTIQUES b
                LEFT JOIN COMMANDESBOUTIQUES cb ON cb.id_boutique = b.id
                LEFT JOIN AVIS a ON a.entite_type = 'BOUTIQUE' AND a.entite_id = b.id AND a.statut = 'PUBLIE'
                WHERE b.est_actif = true AND b.est_supprime = false
                GROUP BY b.id, b.nom_boutique, b.logo_boutique
                ORDER BY chiffre_affaires DESC
                LIMIT 10
            `);

            // 10. ALERTES RÉCENTES
            const alertes = await pool.query(`
                SELECT 
                    id,
                    type_alerte,
                    severite,
                    details,
                    date_creation,
                    est_traitee
                FROM ALERTES_SECURITE
                WHERE est_traitee = false
                ORDER BY 
                    CASE severite
                        WHEN 'CRITIQUE' THEN 1
                        WHEN 'ELEVE' THEN 2
                        WHEN 'MOYEN' THEN 3
                        ELSE 4
                    END,
                    date_creation DESC
                LIMIT 10
            `);

            const dashboardData = {
                comptes: statsComptes.rows[0],
                commandes: statsCommandes.rows[0],
                boutiques: statsBoutiques.rows[0],
                restaurants: statsRestaurants.rows[0],
                transport: statsTransport.rows[0],
                blog: statsBlog.rows[0],
                financier: statsFinancieres.rows[0],
                evolution: evolution.rows,
                top_boutiques: topBoutiques.rows,
                alertes: alertes.rows,
                periode: periode === 'personnalise' ? { date_debut, date_fin } : periode
            };

            // Mise en cache (5 minutes)
            await CacheService.set(cacheKey, dashboardData, 300);

            res.json({
                status: 'success',
                data: dashboardData
            });

        } catch (error) {
            logError('Erreur récupération dashboard:', error);
            next(error);
        }
    }

    /**
     * Récupérer les KPIs en temps réel
     * @route GET /api/v1/admin/dashboard/realtime
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getRealtimeKPIs(req, res, next) {
        try {
            const result = await pool.query(`
                WITH stats_courantes AS (
                    SELECT 
                        (SELECT COUNT(*) FROM COMPTES WHERE date_creation >= NOW() - INTERVAL '1 hour') as inscriptions_heure,
                        (SELECT COUNT(*) FROM COMMANDESBOUTIQUES WHERE date_commande >= NOW() - INTERVAL '1 hour') as commandes_heure,
                        (SELECT COALESCE(SUM(prix_total_commande), 0) FROM COMMANDESBOUTIQUES WHERE date_commande >= NOW() - INTERVAL '1 hour') as ca_heure,
                        (SELECT COUNT(*) FROM SESSIONS WHERE date_derniere_activite >= NOW() - INTERVAL '15 minutes') as utilisateurs_connectes,
                        (SELECT COUNT(*) FROM DEMANDES_LIVRAISON WHERE statut_livraison = 'EN_COURS') as livraisons_en_cours,
                        (SELECT COUNT(*) FROM FILE_TACHES WHERE statut = 'EN_COURS') as taches_en_cours,
                        (SELECT COUNT(*) FROM ALERTES_SECURITE WHERE date_creation >= NOW() - INTERVAL '1 hour' AND est_traitee = false) as alertes_heure
                )
                SELECT * FROM stats_courantes
            `);

            res.json({
                status: 'success',
                data: result.rows[0]
            });

        } catch (error) {
            logError('Erreur récupération KPIs temps réel:', error);
            next(error);
        }
    }

    /**
     * Récupérer les graphiques d'évolution
     * @route GET /api/v1/admin/dashboard/charts
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async getCharts(req, res, next) {
        try {
            const { type = 'commandes', periode = '30j' } = req.query;

            let intervalle;
            let groupBy;

            switch (periode) {
                case '7j':
                    intervalle = "INTERVAL '7 days'";
                    groupBy = 'DATE';
                    break;
                case '30j':
                    intervalle = "INTERVAL '30 days'";
                    groupBy = 'DATE';
                    break;
                case '90j':
                    intervalle = "INTERVAL '90 days'";
                    groupBy = "TO_CHAR(date, 'YYYY-MM')";
                    break;
                default:
                    intervalle = "INTERVAL '30 days'";
                    groupBy = 'DATE';
            }

            let query;

            switch (type) {
                case 'commandes':
                    query = `
                        SELECT 
                            DATE(date_commande) as date,
                            COUNT(*) as nombre,
                            SUM(prix_total_commande) as montant
                        FROM COMMANDESBOUTIQUES
                        WHERE date_commande >= NOW() - ${intervalle}
                        GROUP BY DATE(date_commande)
                        ORDER BY date
                    `;
                    break;

                case 'inscriptions':
                    query = `
                        SELECT 
                            DATE(date_creation) as date,
                            COUNT(*) as nombre
                        FROM COMPTES
                        WHERE date_creation >= NOW() - ${intervalle}
                        GROUP BY DATE(date_creation)
                        ORDER BY date
                    `;
                    break;

                case 'revenus':
                    query = `
                        SELECT 
                            DATE(date_commande) as date,
                            SUM(prix_total_commande) as revenus_boutiques,
                            SUM(prix_total_commande) FILTER (WHERE pour_livrer = true) as revenus_livraison
                        FROM COMMANDESBOUTIQUES
                        WHERE date_commande >= NOW() - ${intervalle}
                        GROUP BY DATE(date_commande)
                        ORDER BY date
                    `;
                    break;

                case 'activite':
                    query = `
                        SELECT 
                            DATE(date_action) as date,
                            COUNT(*) as actions
                        FROM HISTORIQUE_ACTIONS
                        WHERE date_action >= NOW() - ${intervalle}
                        GROUP BY DATE(date_action)
                        ORDER BY date
                    `;
                    break;

                default:
                    throw new ValidationError('Type de graphique invalide');
            }

            const result = await pool.query(query);

            res.json({
                status: 'success',
                data: {
                    type,
                    periode,
                    data: result.rows
                }
            });

        } catch (error) {
            logError('Erreur récupération graphiques:', error);
            next(error);
        }
    }

    /**
     * Exporter un rapport
     * @route GET /api/v1/admin/dashboard/export
     * @access ADMINISTRATEUR_PLATEFORME
     */
    async exportReport(req, res, next) {
        try {
            const { type = 'complet', format = 'pdf', date_debut, date_fin } = req.query;

            // Récupération des données selon le type
            let data;
            let title;

            switch (type) {
                case 'complet':
                    data = await this._getCompleteReportData(date_debut, date_fin);
                    title = 'Rapport complet de la plateforme';
                    break;
                case 'financier':
                    data = await this._getFinancialReportData(date_debut, date_fin);
                    title = 'Rapport financier';
                    break;
                case 'activite':
                    data = await this._getActivityReportData(date_debut, date_fin);
                    title = "Rapport d'activité";
                    break;
                default:
                    throw new ValidationError('Type de rapport invalide');
            }

            // Génération du fichier selon le format
            let exportedData;
            let contentType;
            let filename = `rapport-${type}-${new Date().toISOString().split('T')[0]}`;

            switch (format) {
                case 'pdf':
                    exportedData = await ExportService.toPDF(data, {
                        title,
                        template: 'admin-report',
                        orientation: 'landscape'
                    });
                    contentType = 'application/pdf';
                    filename += '.pdf';
                    break;

                case 'excel':
                    exportedData = await ExportService.toExcel(data, {
                        sheetName: type,
                        columns: this._getExcelColumns(type)
                    });
                    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                    filename += '.xlsx';
                    break;

                case 'csv':
                    exportedData = await ExportService.toCSV(data, {
                        delimiter: ';',
                        encoding: 'utf8'
                    });
                    contentType = 'text/csv';
                    filename += '.csv';
                    break;

                default:
                    throw new ValidationError('Format invalide');
            }

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(exportedData);

        } catch (error) {
            logError('Erreur export rapport:', error);
            next(error);
        }
    }

    // ==================== MÉTHODES PRIVÉES ====================

    async _getCompleteReportData(date_debut, date_fin) {
        const dateCondition = date_debut && date_fin
            ? `BETWEEN '${date_debut}' AND '${date_fin}'`
            : ">= NOW() - INTERVAL '30 days'";

        const [comptes, commandes, financier, activite] = await Promise.all([
            pool.query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE date_creation ${dateCondition}) as periode,
                    AVG(EXTRACT(DAY FROM (NOW() - date_creation))) as age_moyen
                FROM COMPTES
                WHERE est_supprime = false
            `),
            pool.query(`
                SELECT 
                    COUNT(*) as total,
                    SUM(prix_total_commande) as ca_total,
                    AVG(prix_total_commande) as panier_moyen,
                    COUNT(*) FILTER (WHERE date_commande ${dateCondition}) as commandes_periode,
                    SUM(prix_total_commande) FILTER (WHERE date_commande ${dateCondition}) as ca_periode
                FROM COMMANDESBOUTIQUES
            `),
            pool.query(`
                SELECT 
                    (SELECT portefeuille_plateforme FROM PLATEFORME LIMIT 1) as solde_plateforme,
                    (SELECT COALESCE(SUM(portefeuille_boutique), 0) FROM BOUTIQUES) as total_boutiques,
                    (SELECT COALESCE(SUM(portefeuille_compagnie), 0) FROM COMPAGNIESTRANSPORT) as total_compagnies
            `),
            pool.query(`
                SELECT 
                    COUNT(*) as total_actions,
                    COUNT(DISTINCT utilisateur_id) as utilisateurs_actifs
                FROM HISTORIQUE_ACTIONS
                WHERE date_action ${dateCondition}
            `)
        ]);

        return {
            periode: { date_debut, date_fin },
            comptes: comptes.rows[0],
            commandes: commandes.rows[0],
            financier: financier.rows[0],
            activite: activite.rows[0],
            date_generation: new Date().toISOString()
        };
    }

    async _getFinancialReportData(date_debut, date_fin) {
        const dateCondition = date_debut && date_fin
            ? `BETWEEN '${date_debut}' AND '${date_fin}'`
            : ">= NOW() - INTERVAL '30 days'";

        const result = await pool.query(`
            WITH transactions AS (
                SELECT 
                    'COMMANDES_BOUTIQUES' as source,
                    date_commande as date,
                    prix_total_commande as montant,
                    statut_commande as statut
                FROM COMMANDESBOUTIQUES
                WHERE date_commande ${dateCondition}
                UNION ALL
                SELECT 
                    'COMMANDES_RESTAURANTS',
                    date_commande,
                    prix_total_commande,
                    statut_commande
                FROM COMMANDESEMPLACEMENTFASTFOOD
                WHERE date_commande ${dateCondition}
                UNION ALL
                SELECT 
                    'ACHATS_TICKETS',
                    date_achat_prive,
                    total_transaction,
                    'COMPLETEE'
                FROM ACHATSTICKETSPRIVE
                WHERE date_achat_prive ${dateCondition}
            )
            SELECT 
                source,
                COUNT(*) as nombre,
                SUM(montant) as total,
                AVG(montant) as moyenne,
                SUM(montant) FILTER (WHERE statut = 'ANNULEE') as annule
            FROM transactions
            GROUP BY source
        `);

        return result.rows;
    }

    async _getActivityReportData(date_debut, date_fin) {
        const dateCondition = date_debut && date_fin
            ? `BETWEEN '${date_debut}' AND '${date_fin}'`
            : ">= NOW() - INTERVAL '30 days'";

        const result = await pool.query(`
            SELECT 
                DATE(date_action) as date,
                action_type,
                COUNT(*) as nombre
            FROM HISTORIQUE_ACTIONS
            WHERE date_action ${dateCondition}
            GROUP BY DATE(date_action), action_type
            ORDER BY date DESC, nombre DESC
        `);

        return result.rows;
    }

    _getExcelColumns(type) {
        const columns = {
            complet: [
                { header: 'Indicateur', key: 'indicateur' },
                { header: 'Valeur', key: 'valeur' },
                { header: 'Période', key: 'periode' }
            ],
            financier: [
                { header: 'Source', key: 'source' },
                { header: 'Nombre', key: 'nombre' },
                { header: 'Total', key: 'total' },
                { header: 'Moyenne', key: 'moyenne' }
            ],
            activite: [
                { header: 'Date', key: 'date' },
                { header: 'Type', key: 'action_type' },
                { header: 'Nombre', key: 'nombre' }
            ]
        };
        return columns[type] || columns.complet;
    }
}

module.exports = new DashboardController();