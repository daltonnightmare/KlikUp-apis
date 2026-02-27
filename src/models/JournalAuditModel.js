// models/JournalAuditModel.js

class JournalAuditModel {
    constructor() {
        // Simulation de la base de données en mémoire
        this.journal = [];
    }

    /**
     * Créer une entrée de journal d'audit
     */
    async create(data) {
        const entry = {
            id: this.journal.length + 1,
            session_id: data.session_id || null,
            compte_id: data.compte_id || null,
            role_au_moment: data.role_au_moment || null,
            adresse_ip: data.adresse_ip || '0.0.0.0',
            user_agent: data.user_agent || null,
            action: data.action,
            ressource_type: data.ressource_type,
            ressource_id: data.ressource_id ? String(data.ressource_id) : null,
            donnees_avant: data.donnees_avant || null,
            donnees_apres: data.donnees_apres || null,
            champs_modifies: data.champs_modifies || [],
            raison: data.raison || null,
            metadata: data.metadata || {},
            succes: data.succes !== undefined ? data.succes : true,
            code_erreur: data.code_erreur || null,
            message_erreur: data.message_erreur || null,
            duree_ms: data.duree_ms || null,
            date_action: new Date().toISOString()
        };
        
        this.journal.push(entry);
        return entry;
    }

    /**
     * Créer plusieurs entrées de journal (pour le batch processing)
     */
    async createMany(dataArray) {
        const created = [];
        for (const data of dataArray) {
            const entry = await this.create(data);
            created.push(entry);
        }
        return created;
    }

    /**
     * Trouver les entrées par ressource
     */
    async findByRessource(ressourceType, ressourceId, options = {}) {
        const { limit = 100, offset = 0, startDate, endDate } = options;
        
        let results = this.journal.filter(entry => 
            entry.ressource_type === ressourceType && 
            entry.ressource_id === String(ressourceId)
        );

        // Filtre par date
        if (startDate) {
            results = results.filter(entry => new Date(entry.date_action) >= new Date(startDate));
        }
        if (endDate) {
            results = results.filter(entry => new Date(entry.date_action) <= new Date(endDate));
        }

        // Tri par date décroissante
        results.sort((a, b) => new Date(b.date_action) - new Date(a.date_action));

        return {
            data: results.slice(offset, offset + limit),
            total: results.length,
            offset,
            limit
        };
    }

    /**
     * Trouver les entrées par utilisateur
     */
    async findByUtilisateur(compteId, options = {}) {
        const { limit = 100, offset = 0, startDate, endDate } = options;
        
        let results = this.journal.filter(entry => entry.compte_id === compteId);

        // Filtre par date
        if (startDate) {
            results = results.filter(entry => new Date(entry.date_action) >= new Date(startDate));
        }
        if (endDate) {
            results = results.filter(entry => new Date(entry.date_action) <= new Date(endDate));
        }

        // Tri par date décroissante
        results.sort((a, b) => new Date(b.date_action) - new Date(a.date_action));

        return {
            data: results.slice(offset, offset + limit),
            total: results.length,
            offset,
            limit
        };
    }

    /**
     * Trouver les entrées par période
     */
    async findByDateRange(dateDebut, dateFin) {
        const debut = new Date(dateDebut);
        const fin = new Date(dateFin);

        return this.journal.filter(entry => {
            const date = new Date(entry.date_action);
            return date >= debut && date <= fin;
        }).sort((a, b) => new Date(b.date_action) - new Date(a.date_action));
    }

    /**
     * Obtenir les actions suspectes
     */
    async getActionsSuspectes(periode = '24 hours') {
        const dateSeuil = new Date();
        const [valeur, unite] = periode.split(' ');
        
        if (unite.includes('hour')) {
            dateSeuil.setHours(dateSeuil.getHours() - parseInt(valeur));
        } else if (unite.includes('day')) {
            dateSeuil.setDate(dateSeuil.getDate() - parseInt(valeur));
        } else if (unite.includes('week')) {
            dateSeuil.setDate(dateSeuil.getDate() - (parseInt(valeur) * 7));
        }

        const logsRecents = this.journal.filter(entry => 
            new Date(entry.date_action) >= dateSeuil
        );

        // Détecter les actions suspectes
        const suspectes = logsRecents.filter(entry => {
            return (
                entry.succes === false || // Échecs
                entry.action.includes('FAILED') || // Actions échouées
                entry.code_erreur !== null || // Avec code d'erreur
                this.compterEchecsRecents(entry.compte_id) > 5 // Trop d'échecs
            );
        });

        return suspectes;
    }

    /**
     * Compter les échecs récents pour un utilisateur
     */
    compterEchecsRecents(compteId) {
        if (!compteId) return 0;
        
        const uneHeure = new Date();
        uneHeure.setHours(uneHeure.getHours() - 1);

        return this.journal.filter(entry => 
            entry.compte_id === compteId &&
            entry.succes === false &&
            new Date(entry.date_action) >= uneHeure
        ).length;
    }

    /**
     * Obtenir les statistiques d'audit
     */
    async getStats(periode = '7 days') {
        const dateSeuil = new Date();
        const [valeur, unite] = periode.split(' ');
        
        if (unite.includes('day')) {
            dateSeuil.setDate(dateSeuil.getDate() - parseInt(valeur));
        } else if (unite.includes('week')) {
            dateSeuil.setDate(dateSeuil.getDate() - (parseInt(valeur) * 7));
        } else if (unite.includes('month')) {
            dateSeuil.setMonth(dateSeuil.getMonth() - parseInt(valeur));
        }

        const logsPeriode = this.journal.filter(entry => 
            new Date(entry.date_action) >= dateSeuil
        );

        // Grouper par action
        const statsMap = new Map();
        
        logsPeriode.forEach(entry => {
            if (!statsMap.has(entry.action)) {
                statsMap.set(entry.action, {
                    action: entry.action,
                    nombre_actions: 0,
                    echecs: 0,
                    succes: 0
                });
            }
            
            const stat = statsMap.get(entry.action);
            stat.nombre_actions++;
            if (entry.succes) {
                stat.succes++;
            } else {
                stat.echecs++;
            }
        });

        return Array.from(statsMap.values());
    }

    /**
     * Archiver les anciens logs (simulé)
     */
    async archiverAnciennes(jours = 365) {
        const dateSeuil = new Date();
        dateSeuil.setDate(dateSeuil.getDate() - jours);

        const anciens = this.journal.filter(entry => 
            new Date(entry.date_action) < dateSeuil
        );

        // Simuler l'archivage en supprimant les anciens logs
        this.journal = this.journal.filter(entry => 
            new Date(entry.date_action) >= dateSeuil
        );

        return { archives: anciens.length };
    }
}

module.exports = new JournalAuditModel();