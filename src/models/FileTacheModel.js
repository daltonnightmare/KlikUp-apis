// models/FileTacheModel.js

class FileTacheModel {
    constructor() {
        this.taches = [];
        this.workers = new Map(); // Pour suivre les workers actifs
    }

    /**
     * Créer une nouvelle tâche
     */
    async create(data) {
        const tache = {
            id: this.taches.length + 1,
            type_tache: data.type_tache,
            payload: data.payload || {},
            statut: 'EN_ATTENTE',
            priorite: data.priorite || 5,
            tentatives: 0,
            max_tentatives: data.max_tentatives || 3,
            derniere_erreur: null,
            execute_apres: data.execute_apres || new Date().toISOString(),
            date_creation: new Date().toISOString(),
            date_debut: null,
            date_fin: null,
            worker_id: null
        };
        
        this.taches.push(tache);
        return tache;
    }

    /**
     * Créer plusieurs tâches
     */
    async createMany(taches) {
        const created = [];
        for (const tache of taches) {
            created.push(await this.create(tache));
        }
        return created;
    }

    /**
     * Trouver par ID
     */
    async findById(id) {
        return this.taches.find(tache => tache.id === id) || null;
    }

    /**
     * Mettre à jour une tâche
     */
    async update(id, updates) {
        const index = this.taches.findIndex(tache => tache.id === id);
        if (index === -1) return null;

        this.taches[index] = {
            ...this.taches[index],
            ...updates
        };

        return this.taches[index];
    }

    /**
     * Récupérer la prochaine tâche à traiter
     */
    async getNext(workerId = null) {
        const maintenant = new Date();

        // Trouver la tâche avec la plus haute priorité qui est en attente
        const tache = this.taches.find(t => 
            t.statut === 'EN_ATTENTE' && 
            new Date(t.execute_apres) <= maintenant &&
            t.tentatives < t.max_tentatives
        );

        if (tache) {
            const worker = workerId || `worker_${Date.now()}`;
            
            await this.update(tache.id, {
                statut: 'EN_COURS',
                date_debut: new Date().toISOString(),
                tentatives: tache.tentatives + 1,
                worker_id: worker
            });

            // Enregistrer le worker
            this.workers.set(worker, {
                id: worker,
                tache_id: tache.id,
                date_debut: new Date().toISOString()
            });
        }

        return tache;
    }

    /**
     * Récupérer les tâches en attente avec priorité
     */
    async getPending(limit = 50) {
        const maintenant = new Date();

        return this.taches
            .filter(t => 
                (t.statut === 'EN_ATTENTE' || t.statut === 'ECHOUEE') &&
                new Date(t.execute_apres) <= maintenant &&
                t.tentatives < t.max_tentatives
            )
            .sort((a, b) => {
                // Trier par priorité (plus haute d'abord) puis par date
                if (a.priorite !== b.priorite) {
                    return b.priorite - a.priorite;
                }
                return new Date(a.execute_apres) - new Date(b.execute_apres);
            })
            .slice(0, limit);
    }

    /**
     * Marquer comme terminée
     */
    async complete(id, resultat = {}) {
        const tache = await this.update(id, {
            statut: 'COMPLETEE',
            date_fin: new Date().toISOString(),
            payload: {
                ...(await this.findById(id)).payload,
                resultat
            }
        });

        // Nettoyer le worker
        if (tache && tache.worker_id) {
            this.workers.delete(tache.worker_id);
        }

        return tache;
    }

    /**
     * Marquer comme erreur
     */
    async error(id, erreur) {
        const tache = await this.findById(id);
        
        if (tache.tentatives >= tache.max_tentatives) {
            return this.update(id, {
                statut: 'ABANDONNEE',
                date_fin: new Date().toISOString(),
                derniere_erreur: erreur.message || String(erreur)
            });
        } else {
            return this.update(id, {
                statut: 'ECHOUEE',
                derniere_erreur: erreur.message || String(erreur)
            });
        }
    }

    /**
     * Trouver les tâches par statut
     */
    async findByStatus(statut, options = {}) {
        const { limit = 50, offset = 0 } = options;
        
        const results = this.taches
            .filter(tache => tache.statut === statut)
            .sort((a, b) => {
                if (a.priorite !== b.priorite) {
                    return b.priorite - a.priorite;
                }
                return new Date(b.date_creation) - new Date(a.date_creation);
            });

        return {
            data: results.slice(offset, offset + limit),
            total: results.length,
            offset,
            limit
        };
    }

    /**
     * Trouver par type
     */
    async findByType(typeTache, options = {}) {
        const { limit = 50, offset = 0, statut } = options;
        
        let results = this.taches.filter(t => t.type_tache === typeTache);
        
        if (statut) {
            results = results.filter(t => t.statut === statut);
        }

        results.sort((a, b) => new Date(b.date_creation) - new Date(a.date_creation));

        return {
            data: results.slice(offset, offset + limit),
            total: results.length,
            offset,
            limit
        };
    }

    /**
     * Obtenir les statistiques
     */
    async getStats() {
        const stats = {
            total: this.taches.length,
            par_statut: {},
            par_type: {},
            temps_moyen_execution: 0,
            workers_actifs: this.workers.size
        };

        // Compter par statut
        this.taches.forEach(tache => {
            stats.par_statut[tache.statut] = (stats.par_statut[tache.statut] || 0) + 1;
            stats.par_type[tache.type_tache] = (stats.par_type[tache.type_tache] || 0) + 1;
        });

        // Calculer le temps moyen d'exécution
        const terminees = this.taches.filter(t => 
            t.statut === 'COMPLETEE' && t.date_debut && t.date_fin
        );

        if (terminees.length > 0) {
            const totalTemps = terminees.reduce((sum, t) => {
                const debut = new Date(t.date_debut);
                const fin = new Date(t.date_fin);
                return sum + (fin - debut);
            }, 0);
            stats.temps_moyen_execution = totalTemps / terminees.length;
        }

        return stats;
    }

    /**
     * Relancer les tâches échouées
     */
    async retryFailed(maxTentatives = 3) {
        const echecs = this.taches.filter(t => 
            t.statut === 'ECHOUEE' && t.tentatives < maxTentatives
        );

        for (const tache of echecs) {
            await this.update(tache.id, {
                statut: 'EN_ATTENTE',
                execute_apres: new Date(Date.now() + 60000).toISOString() // +1 minute
            });
        }

        return { relancees: echecs.length };
    }

    /**
     * Nettoyer les anciennes tâches
     */
    async cleanup(daysToKeep = 30) {
        const dateSeuil = new Date();
        dateSeuil.setDate(dateSeuil.getDate() - daysToKeep);

        const avant = this.taches.length;
        this.taches = this.taches.filter(tache => 
            new Date(tache.date_creation) >= dateSeuil || 
            tache.statut === 'EN_ATTENTE' || 
            tache.statut === 'EN_COURS'
        );

        return { supprimees: avant - this.taches.length };
    }

    /**
     * Obtenir les workers actifs
     */
    getActiveWorkers() {
        return Array.from(this.workers.values());
    }

    /**
     * Nettoyer les workers orphelins
     */
    cleanupOrphanWorkers(timeoutMs = 300000) { // 5 minutes par défaut
        const maintenant = new Date();
        const orphelins = [];

        for (const [workerId, worker] of this.workers.entries()) {
            const dateDebut = new Date(worker.date_debut);
            if (maintenant - dateDebut > timeoutMs) {
                orphelins.push(workerId);
                this.workers.delete(workerId);
                
                // Remettre la tâche en attente
                const tache = this.taches.find(t => t.id === worker.tache_id);
                if (tache && tache.statut === 'EN_COURS') {
                    this.update(tache.id, {
                        statut: 'EN_ATTENTE',
                        worker_id: null,
                        date_debut: null
                    });
                }
            }
        }

        return { nettoyes: orphelins.length };
    }
}

module.exports = new FileTacheModel();