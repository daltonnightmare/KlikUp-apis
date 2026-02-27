// models/HistoriqueActionModel.js

class HistoriqueActionModel {
    constructor() {
        this.historique = [];
    }

    /**
     * Créer une entrée d'historique
     */
    async create(data) {
        const entry = {
            id: this.historique.length + 1,
            action_type: data.action_type,
            table_concernee: data.table_concernee,
            entite_id: data.entite_id,
            donnees_avant: data.donnees_avant || null,
            donnees_apres: data.donnees_apres || null,
            utilisateur_id: data.utilisateur_id || null,
            ip_adresse: data.ip_adresse || null,
            user_agent: data.user_agent || null,
            date_action: new Date().toISOString()
        };
        
        this.historique.push(entry);
        return entry;
    }

    /**
     * Créer plusieurs entrées
     */
    async createMany(dataArray) {
        const created = [];
        for (const data of dataArray) {
            created.push(await this.create(data));
        }
        return created;
    }

    /**
     * Trouver par utilisateur
     */
    async findByUtilisateur(utilisateurId, options = {}) {
        const { limit = 100, offset = 0 } = options;
        
        const results = this.historique
            .filter(entry => entry.utilisateur_id === utilisateurId)
            .sort((a, b) => new Date(b.date_action) - new Date(a.date_action));

        return {
            data: results.slice(offset, offset + limit),
            total: results.length,
            offset,
            limit
        };
    }

    /**
     * Trouver par action
     */
    async findByAction(actionType, options = {}) {
        const { limit = 100, offset = 0 } = options;
        
        const results = this.historique
            .filter(entry => entry.action_type === actionType)
            .sort((a, b) => new Date(b.date_action) - new Date(a.date_action));

        return {
            data: results.slice(offset, offset + limit),
            total: results.length,
            offset,
            limit
        };
    }

    /**
     * Trouver par table concernée
     */
    async findByTable(tableConcernee, entiteId, options = {}) {
        const { limit = 100, offset = 0 } = options;
        
        const results = this.historique
            .filter(entry => entry.table_concernee === tableConcernee && entry.entite_id === entiteId)
            .sort((a, b) => new Date(b.date_action) - new Date(a.date_action));

        return {
            data: results.slice(offset, offset + limit),
            total: results.length,
            offset,
            limit
        };
    }

    /**
     * Obtenir les actions récentes
     */
    async getRecent(limit = 50) {
        return this.historique
            .sort((a, b) => new Date(b.date_action) - new Date(a.date_action))
            .slice(0, limit);
    }

    /**
     * Compter les actions par type
     */
    async countByPeriod(dateDebut, dateFin) {
        const debut = new Date(dateDebut);
        const fin = new Date(dateFin);

        const comptage = {};
        
        this.historique.forEach(entry => {
            const date = new Date(entry.date_action);
            if (date >= debut && date <= fin) {
                const key = entry.action_type;
                comptage[key] = (comptage[key] || 0) + 1;
            }
        });

        return comptage;
    }

    /**
     * Nettoyer l'ancien historique (simule la politique de rétention)
     */
    async cleanup(jours = 365) {
        const dateSeuil = new Date();
        dateSeuil.setDate(dateSeuil.getDate() - jours);

        const avant = this.historique.length;
        this.historique = this.historique.filter(entry => 
            new Date(entry.date_action) >= dateSeuil
        );

        return { supprimees: avant - this.historique.length };
    }
}

module.exports = new HistoriqueActionModel();