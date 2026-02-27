// src/routes/middlewares/audit.middleware.js
const db = require('../../configuration/database');
const { v4: uuidv4 } = require('uuid');

class AuditMiddleware {
    /**
     * Journaliser les actions importantes
     */
    log(action, options = {}) {
        return async (req, res, next) => {
            const startTime = Date.now();
            const sessionId = req.session?.id || uuidv4();

            // Intercepter la réponse pour capturer le résultat
            const originalJson = res.json;
            const originalSend = res.send;
            let responseBody;

            res.json = function(data) {
                responseBody = data;
                originalJson.call(this, data);
            };

            res.send = function(data) {
                responseBody = data;
                originalSend.call(this, data);
            };

            res.on('finish', async () => {
                const duration = Date.now() - startTime;

                try {
                    // Déterminer le type de ressource
                    let resourceType = options.resourceType || this.getResourceType(req.path);
                    let resourceId = options.resourceId || this.getResourceId(req);

                    // Données avant/après pour les modifications
                    let donneesAvant = null;
                    let donneesApres = null;

                    if (req.method === 'PUT' || req.method === 'PATCH') {
                        donneesAvant = req.existingData || null;
                        donneesApres = req.body;
                    } else if (req.method === 'POST') {
                        donneesApres = req.body;
                    } else if (req.method === 'DELETE') {
                        donneesAvant = req.existingData || null;
                    }

                    // Journaliser dans JOURNAL_AUDIT
                    await db.query(
                        `INSERT INTO JOURNAL_AUDIT (
                            session_id, compte_id, role_au_moment, adresse_ip,
                            user_agent, action, ressource_type, ressource_id,
                            donnees_avant, donnees_apres, succes, code_erreur,
                            message_erreur, duree_ms
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                        [
                            sessionId,
                            req.user?.id,
                            req.user?.compte_role,
                            req.ip || req.connection.remoteAddress,
                            req.headers['user-agent'],
                            action || `${req.method} ${req.path}`,
                            resourceType,
                            resourceId,
                            donneesAvant ? JSON.stringify(donneesAvant) : null,
                            donneesApres ? JSON.stringify(donneesApres) : null,
                            res.statusCode < 400,
                            res.statusCode >= 400 ? res.statusCode.toString() : null,
                            responseBody?.message || null,
                            duration
                        ]
                    );

                    // Si c'est une erreur critique, créer une alerte de sécurité
                    if (res.statusCode >= 500) {
                        await this.createSecurityAlert(req, res, responseBody);
                    }

                } catch (error) {
                    console.error('Erreur journalisation audit:', error);
                }
            });

            next();
        };
    }

    /**
     * Journaliser les connexions
     */
    logConnection(type = 'CONNEXION') {
        return async (req, res, next) => {
            const startTime = Date.now();

            res.on('finish', async () => {
                try {
                    const statut = res.statusCode < 400 ? 'SUCCESS' : 'FAILED';

                    await db.query(
                        `INSERT INTO HISTORIQUE_CONNEXIONS (
                            compte_id, type_connexion, adresse_ip, utilisateur_agent,
                            statut_connexion, code_erreur
                        ) VALUES ($1, $2, $3, $4, $5, $6)`,
                        [
                            req.user?.id,
                            type,
                            req.ip,
                            req.headers['user-agent'],
                            statut,
                            res.statusCode >= 400 ? res.statusCode.toString() : null
                        ]
                    );

                    // Mettre à jour la dernière connexion du compte
                    if (req.user?.id && statut === 'SUCCESS') {
                        await db.query(
                            `UPDATE COMPTES 
                             SET date_derniere_connexion = NOW(),
                                 tentatives_echec_connexion = 0
                             WHERE id = $1`,
                            [req.user.id]
                        );
                    }

                } catch (error) {
                    console.error('Erreur journalisation connexion:', error);
                }
            });

            next();
        };
    }

    /**
     * Middleware pour capturer les données avant modification
     */
    captureBefore(getData) {
        return async (req, res, next) => {
            try {
                req.existingData = await getData(req);
                next();
            } catch (error) {
                next(error);
            }
        };
    }

    /**
     * Créer une alerte de sécurité
     */
    async createSecurityAlert(req, res, responseBody) {
        try {
            await db.query(
                `INSERT INTO ALERTES_SECURITE (
                    type_alerte, severite, compte_id, adresse_ip, details
                ) VALUES ($1, $2, $3, $4, $5)`,
                [
                    'ERREUR_SERVEUR',
                    'MOYEN',
                    req.user?.id,
                    req.ip,
                    JSON.stringify({
                        path: req.path,
                        method: req.method,
                        status: res.statusCode,
                        message: responseBody?.message,
                        timestamp: new Date().toISOString()
                    })
                ]
            );
        } catch (error) {
            console.error('Erreur création alerte sécurité:', error);
        }
    }

    /**
     * Déterminer le type de ressource à partir du chemin
     */
    getResourceType(path) {
        const segments = path.split('/');
        
        // Format: /api/v1/[resource]/...
        if (segments.length >= 3) {
            const resource = segments[3];
            
            const resourceMap = {
                'articles': 'ARTICLE_BLOG',
                'commentaires': 'COMMENTAIRE',
                'comptes': 'COMPTE',
                'commandes': 'COMMANDE',
                'produits': 'PRODUIT',
                'restaurants': 'RESTAURANT',
                'boutiques': 'BOUTIQUE',
                'livreurs': 'LIVREUR',
                'entreprises': 'ENTREPRISE',
                'conversations': 'CONVERSATION',
                'messages': 'MESSAGE'
            };

            return resourceMap[resource] || resource.toUpperCase();
        }

        return 'AUTRE';
    }

    /**
     * Extraire l'ID de ressource de la requête
     */
    getResourceId(req) {
        // Chercher dans les paramètres
        for (const [key, value] of Object.entries(req.params)) {
            if (key.includes('id') && !isNaN(parseInt(value))) {
                return value;
            }
        }

        // Chercher dans le body
        if (req.body.id) {
            return req.body.id;
        }

        return null;
    }
}

module.exports = new AuditMiddleware();