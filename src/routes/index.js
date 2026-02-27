// src/routes/index.js
// Point d'entrée centralisé : monte toutes les routes v1
const router = require('express').Router();
const authRoutes = require('./v1/authentification.routes');
const comptesRoutes = require('./v1/comptes.routes');
const transportRoutes    = require('./v1/transports.routes');
const restaurationRoutes = require('./v1/restaurants.routes');
const boutiqueRoutes     = require('./v1/boutiques.routes');
const livraisonRoutes    = require('./v1/livraison.routes');
const blogRoutes         = require('./v1/blog.routes');
const messagerieRoutes   = require('./v1/messagerie.routes');
const adresseRoutes      = require('./v1/adresse.routes');
const avisRoutes         = require('./v1/avis.routes');
const horaireRoutes      = require('./v1/horaire.routes');
const fideliteRoutes     = require('./v1/fidelite.routes');
const notificationRoutes = require('./v1/notification.routes');
const documentRoutes     = require('./v1/document.routes');
const historiqueRoutes   = require('./v1/historique.routes');
const adminRoutes        = require('./v1/administration.routes');
const publicRoutes       = require('./v1/public.routes');


router.use('/comptes',       comptesRoutes);
router.use('/transport',     transportRoutes);
router.use('/restauration',  restaurationRoutes);
router.use('/boutiques',     boutiqueRoutes);
router.use('/livraison',     livraisonRoutes);
router.use('/blog',          blogRoutes);
router.use('/messagerie',    messagerieRoutes);
router.use('/adresses',      adresseRoutes);
router.use('/avis',          avisRoutes);
router.use('/horaires',      horaireRoutes);
router.use('/fidelite',      fideliteRoutes);
router.use('/notifications', notificationRoutes);
router.use('/documents',     documentRoutes);
router.use('/historique',    historiqueRoutes);
router.use('/admin',         adminRoutes);
router.use('/authentification', authRoutes);
router.use('/public',publicRoutes);

module.exports = router;