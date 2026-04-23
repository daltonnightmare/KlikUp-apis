// src/routes/v1/comptes.routes.js
/**
 * Routes de gestion des comptes utilisateurs
 * API pour la gestion complète des comptes, rôles, sessions et vérifications
 * Accès restreint selon les rôles et permissions
 */
const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const rateLimit = require('express-rate-limit');

const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const validationMiddleware = require('../middlewares/validation.middleware');
const cacheMiddleware = require('../middlewares/cache.middleware');
const rateLimiter = require('../middlewares/rateLimiter.middleware');
const uploadMiddleware = require('../middlewares/upload.middleware');

const CompteController = require('../../controllers/comptes/CompteController');
const RoleController = require('../../controllers/comptes/RoleController');
const ProfilController = require('../../controllers/comptes/ProfilController');
const SessionController = require('../../controllers/comptes/SessionController');
const VerificationController = require('../../controllers/comptes/VerificationController');

// ==================== CONFIGURATION RATE LIMITING ====================

const verificationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 tentatives
    message: 'Trop de tentatives de vérification. Réessayez plus tard.',
    standardHeaders: true,
    legacyHeaders: false
});


// Profil de base
router.get('/profil', authMiddleware.authenticate, ProfilController.getMonProfil);
router.put('/profil', authMiddleware.authenticate, validationMiddleware.validate([
    body('nom_utilisateur_compte').optional().trim().isLength({ min: 3, max: 50 }),
    body('numero_de_telephone').optional().matches(/^[0-9+\-\s]+$/),
    body('email').optional().isEmail()
]), ProfilController.updateMonProfil);

// Photo
router.post('/profil/photo', authMiddleware.authenticate, uploadMiddleware.single('photo'), ProfilController.uploadPhoto);
router.delete('/profil/photo', authMiddleware.authenticate, ProfilController.deletePhoto);

// Sécurité
router.post('/profil/changer-mot-de-passe', authMiddleware.authenticate, validationMiddleware.validate([
    body('mot_de_passe_actuel').notEmpty(),
    body('nouveau_mot_de_passe').isLength({ min: 8 }),
    body('confirmation_mot_de_passe').notEmpty()
]), ProfilController.changePassword);

// Sessions
router.get('/profil/sessions', authMiddleware.authenticate, ProfilController.getSessionsActives);
router.delete('/profil/sessions/:sessionId', authMiddleware.authenticate, validationMiddleware.validate([param('sessionId').isInt()]), ProfilController.terminateSession);
router.post('/profil/sessions/terminer-autres', authMiddleware.authenticate, ProfilController.terminateOtherSessions);

// 2FA
router.post('/profil/2fa/activer', authMiddleware.authenticate, ProfilController.activer2FA);
router.post('/profil/2fa/valider', authMiddleware.authenticate, validationMiddleware.validate([body('token').isLength({ min: 6, max: 6 })]), ProfilController.valider2FA);
router.post('/profil/2fa/desactiver', authMiddleware.authenticate, validationMiddleware.validate([body('mot_de_passe').notEmpty()]), ProfilController.desactiver2FA);

// Statistiques
router.get('/profil/stats', authMiddleware.authenticate, ProfilController.getProfilStats);
router.get('/profil/historique-connexions', authMiddleware.authenticate, validationMiddleware.validate([
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 })
]), ProfilController.getHistoriqueConnexions);

// Suppression
router.delete('/profil', authMiddleware.authenticate, validationMiddleware.validate([body('mot_de_passe').notEmpty()]), ProfilController.deleteMonCompte);

// Vérifications
router.get('/profil/verifier-nom/:nom', authMiddleware.authenticate, validationMiddleware.validate([param('nom').isLength({ min: 3 })]), ProfilController.checkUsername);
router.get('/profil/verifier-email/:email', authMiddleware.authenticate, validationMiddleware.validate([param('email').isEmail()]), ProfilController.checkEmail);

module.exports = router;