/**
 * Configuration Swagger pour la documentation API
 */
const swaggerJsdoc = require('swagger-jsdoc');
const schemas = require('./swagger-schemas');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API KlikUp',
      version: '1.0.0',
      description: 'API de la MultiPlateforme de commande de repas et produits divers, avec gestion des comptes, commandes, paiements, et administration',
      contact: {
        name: 'Support KlikUp',
        email: 'support@klikup.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000/api/v1',
        description: 'Serveur de développement'
      },
      {
        url: 'https://api.klikup.com/v1',
        description: 'Serveur de production'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Entrez votre token JWT (sans le préfixe Bearer)'
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'Clé API pour les services externes'
        }
      },
      schemas: schemas,
      responses: {
        UnauthorizedError: {
          description: "Token manquant ou invalide",
          content: {
            "application/json": {
              schema: { $ref: '#/components/schemas/Error' }
            }
          }
        },
        NotFoundError: {
          description: "Ressource non trouvée",
          content: {
            "application/json": {
              schema: { $ref: '#/components/schemas/Error' }
            }
          }
        },
        ValidationError: {
          description: "Données de requête invalides",
          content: {
            "application/json": {
              schema: { $ref: '#/components/schemas/Error' }
            }
          }
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ],
    tags: [
      {
        name: 'Authentification',
        description: 'Opérations d\'authentification'
      },
      {
        name: 'Comptes',
        description: 'Gestion des comptes utilisateurs'
      },
      {
        name: 'Plateforme',
        description: 'Configuration et administration de la plateforme'
      },
      {
        name: 'Compagnies Transport',
        description: 'Gestion des compagnies de transport'
      },
      {
        name: 'Tickets Transport',
        description: 'Gestion des tickets de transport'
      },
      {
        name: 'Services Transport',
        description: 'Gestion des services de transport (abonnements)'
      },
      {
        name: 'Restaurants',
        description: 'Gestion des restaurants fast-food'
      },
      {
        name: 'Menus',
        description: 'Gestion des menus restaurants'
      },
      {
        name: 'Commandes Restaurant',
        description: 'Gestion des commandes restaurants'
      },
      {
        name: 'Boutiques',
        description: 'Gestion des boutiques en ligne'
      },
      {
        name: 'Produits Boutique',
        description: 'Gestion des produits en boutique'
      },
      {
        name: 'Commandes Boutique',
        description: 'Gestion des commandes boutique'
      },
      {
        name: 'Livraison',
        description: 'Gestion des livraisons et livreurs'
      },
      {
        name: 'Blog',
        description: 'Articles, commentaires et interactions'
      },
      {
        name: 'Messagerie',
        description: 'Messagerie interne et conversations'
      },
      {
        name: 'Avis',
        description: 'Système de notation et avis'
      },
      {
        name: 'Fidélité',
        description: 'Programme de fidélité et parrainage'
      },
      {
        name: 'Documents',
        description: 'Gestion des documents'
      },
      {
        name: 'Notifications',
        description: 'Gestion des notifications'
      },
      {
        name: 'Adresses',
        description: 'Gestion des adresses et géolocalisation'
      },
      {
        name: 'Horaires',
        description: 'Gestion des horaires d\'ouverture'
      },
      {
        name: 'Promotions',
        description: 'Gestion des promotions et codes promo'
      },
      {
        name: 'Historique',
        description: 'Historique des actions et transactions'
      },
      {
        name: 'Statistiques',
        description: 'Statistiques et rapports'
      },
      {
        name: 'Configuration',
        description: 'Paramètres et configuration système'
      },
      {
        name: 'Sécurité',
        description: 'Sessions, audit et sécurité'
      },
      {
        name: 'Public',
        description: 'Endpoints publics'
      }
    ]
  },
  apis: [
    './src/routes/v1/*.js',
    './src/controllers/**/*.js',
    './src/models/*.js'
  ]
};

const specs = swaggerJsdoc(options);
console.log(`📚 ${Object.keys(specs.paths || {}).length} routes documentées`);
console.log(`📊 ${Object.keys(specs.components.schemas || {}).length} schémas générés`);

module.exports = specs;