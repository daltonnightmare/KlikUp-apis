/**
 * Routes d'authentification et de gestion des comptes
 * API pour l'inscription, connexion, gestion des mots de passe et sessions
 * Accès public pour la plupart des routes (sauf changement de mot de passe)
 */
const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const rateLimit = require('express-rate-limit');

const authMiddleware = require('../middlewares/auth.middleware');
const validationMiddleware = require('../middlewares/validation.middleware');
const rateLimiter = require('../middlewares/rateLimiter.middleware');

const AuthController = require('../../controllers/auth/AuthController');
const PasswordController = require('../../controllers/auth/PasswordController');

// ==================== CONFIGURATION RATE LIMITING ====================
// Limiteurs spécifiques pour l'authentification (prévention brute force)

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.',
    standardHeaders: true,
    legacyHeaders: false,

});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 3, // 3 inscriptions max par IP
    message: 'Trop de tentatives d\'inscription depuis cette adresse IP.',
    standardHeaders: true,
    legacyHeaders: false
});

const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 3, // 3 demandes de reset max
    message: 'Trop de demandes de réinitialisation. Réessayez plus tard.',
    standardHeaders: true,
    legacyHeaders: false
});

const verifyCodeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 tentatives de vérification
    message: 'Trop de tentatives de vérification.',
    standardHeaders: true,
    legacyHeaders: false
});

// ==================== I. INSCRIPTION ET CRÉATION DE COMPTE ====================

/**
 * @swagger
 * tags:
 *   name: Authentification
 *   description: Gestion de l'authentification des utilisateurs
 */

/**
 * @swagger
 * /authentification/register:
 *   post:
 *     summary: Inscription d'un nouvel utilisateur
 *     description: Crée un nouveau compte utilisateur avec vérification par code
 *     tags: [Authentification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - mot_de_passe
 *               - nom_utilisateur
 *               - numero_de_telephone
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email de l'utilisateur
 *                 example: jean.dupont@email.com
 *               mot_de_passe:
 *                 type: string
 *                 format: password
 *                 description: Mot de passe (min 8 caractères, lettres et chiffres)
 *                 example: Password123!
 *               nom_utilisateur:
 *                 type: string
 *                 description: Nom d'utilisateur unique (lettres, chiffres, _)
 *                 example: jean_dupont
 *               numero_de_telephone:
 *                 type: string
 *                 description: Numéro de téléphone
 *                 example: "+22670123456"
 *               photo_profil:
 *                 type: string
 *                 format: uri
 *                 description: URL de la photo de profil
 *                 example: "https://example.com/photo.jpg"
 *               date_naissance:
 *                 type: string
 *                 format: date
 *                 description: Date de naissance
 *                 example: "1990-01-01"
 *               sexe:
 *                 type: string
 *                 enum: [M, F, AUTRE]
 *                 description: Sexe de l'utilisateur
 *                 example: M
 *               langue_preferee:
 *                 type: string
 *                 enum: [fr, en]
 *                 default: fr
 *                 description: Langue préférée
 *                 example: fr
 *     responses:
 *       201:
 *         description: Inscription réussie, code de vérification envoyé
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Inscription réussie. Code de vérification envoyé."
 *                 data:
 *                   type: object
 *                   properties:
 *                     utilisateur:
 *                       $ref: '#/components/schemas/Compte'
 *                     requires_verification:
 *                       type: boolean
 *                       example: true
 *       400:
 *         description: Données invalides
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Email ou nom d'utilisateur déjà utilisé
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Trop de tentatives d'inscription
 */
router.post('/register',
    registerLimiter,
    validationMiddleware.validate([
        body('email').isEmail().normalizeEmail(),
        body('mot_de_passe')
            .isLength({ min: 8 })
            .withMessage('Le mot de passe doit contenir au moins 8 caractères')
            .matches(/^(?=.*[A-Za-z])(?=.*\d)/)
            .withMessage('Le mot de passe doit contenir au moins une lettre et un chiffre'),
        body('nom_utilisateur')
            .notEmpty()
            .trim()
            .isLength({ min: 3, max: 50 })
            .withMessage('Le nom d\'utilisateur doit contenir entre 3 et 50 caractères')
            .matches(/^[a-zA-Z0-9_]+$/)
            .withMessage('Le nom d\'utilisateur ne peut contenir que des lettres, chiffres et underscores'),
        body('numero_de_telephone')
            .notEmpty()
            .matches(/^[0-9+\-\s]+$/)
            .withMessage('Format de téléphone invalide'),
        body('photo_profil').optional().isURL(),
        body('date_naissance').optional().isISO8601(),
        body('sexe').optional().isIn(['M', 'F', 'AUTRE']),
        body('langue_preferee').optional().isIn(['fr', 'en'])
    ]),
    AuthController.register.bind(AuthController)
);

/**
 * @swagger
 * /authentification/verify:
 *   post:
 *     summary: Vérifier le code d'inscription
 *     description: Valide le code à 6 chiffres envoyé par email/SMS
 *     tags: [Authentification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - code
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email de l'utilisateur
 *                 example: jean.dupont@email.com
 *               code:
 *                 type: string
 *                 description: Code de vérification à 6 chiffres
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Compte vérifié avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Compte vérifié avec succès"
 *       400:
 *         description: Code invalide
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Utilisateur non trouvé
 */
router.post('/verify',
    verifyCodeLimiter,
    validationMiddleware.validate([
        body('email').isEmail().normalizeEmail(),
        body('code')
            .notEmpty()
            .isLength({ min: 6, max: 6 })
            .isNumeric()
            .withMessage('Le code doit être composé de 6 chiffres')
    ]),
    AuthController.verifyCode.bind(AuthController)
);

/**
 * @swagger
 * /authentification/resend-code:
 *   post:
 *     summary: Renvoyer le code de vérification
 *     description: Renvoie un nouveau code de vérification par email ou SMS
 *     tags: [Authentification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email de l'utilisateur
 *                 example: jean.dupont@email.com
 *               telephone:
 *                 type: string
 *                 description: Numéro de téléphone
 *                 example: "+22670123456"
 *     responses:
 *       200:
 *         description: Code renvoyé avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Code de vérification renvoyé"
 *       400:
 *         description: Email ou téléphone requis
 *       404:
 *         description: Utilisateur non trouvé
 *       429:
 *         description: Trop de demandes
 */
router.post('/resend-code',
    passwordResetLimiter,
    validationMiddleware.validate([
        body('email').optional().isEmail().normalizeEmail(),
        body('telephone').optional().matches(/^[0-9+\-\s]+$/),
        body().custom((value, { req }) => {
            if (!req.body.email && !req.body.telephone) {
                throw new Error('Email ou téléphone requis');
            }
            return true;
        })
    ]),
    AuthController.resendVerificationCode.bind(AuthController)
);

// ==================== II. CONNEXION ET SESSIONS ====================

/**
 * @swagger
 * /authentification/login:
 *   post:
 *     summary: Connexion utilisateur
 *     description: Authentifie un utilisateur et retourne les tokens JWT
 *     tags: [Authentification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Connexion réussie
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       401:
 *         description: Email ou mot de passe incorrect
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Compte suspendu ou banni
 *       429:
 *         description: Trop de tentatives de connexion
 */
router.post('/login',
    loginLimiter,
    validationMiddleware.validate([
        body('email').isEmail().normalizeEmail(),
        body('mot_de_passe').notEmpty()
    ]),
    AuthController.login.bind(AuthController)
);

/**
 * @swagger
 * /authentification/refresh-token:
 *   post:
 *     summary: Rafraîchir le token d'accès
 *     description: Génère un nouveau token d'accès à partir du refresh token
 *     tags: [Authentification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refresh_token
 *             properties:
 *               refresh_token:
 *                 type: string
 *                 description: Refresh token JWT
 *                 example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *     responses:
 *       200:
 *         description: Nouveau token généré
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     access_token:
 *                       type: string
 *                       example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                     expires_in:
 *                       type: integer
 *                       description: Durée de validité en secondes
 *                       example: 3600
 *       401:
 *         description: Refresh token invalide ou expiré
 */
router.post('/refresh-token',
    rateLimiter.strictLimiter,
    validationMiddleware.validate([
        body('refresh_token').notEmpty()
    ]),
    AuthController.refreshToken.bind(AuthController)
);

/**
 * @swagger
 * /authentification/logout:
 *   post:
 *     summary: Déconnexion
 *     description: Invalide la session courante de l'utilisateur
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Déconnexion réussie
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Déconnexion réussie"
 *       401:
 *         description: Non authentifié
 */
router.post('/logout',
    authMiddleware.authenticate,
    rateLimiter.strictLimiter,
    AuthController.logout.bind(AuthController)
);

/**
 * @swagger
 * /authentification/logout-all:
 *   post:
 *     summary: Déconnexion de toutes les sessions
 *     description: Invalide toutes les sessions actives de l'utilisateur
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Toutes les sessions ont été déconnectées
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Toutes les sessions ont été déconnectées"
 *       401:
 *         description: Non authentifié
 */
/* NonCréé - à implémenter dans AuthController.logoutAll
router.post('/logout-all',
    authMiddleware.authenticate,
    rateLimiter.strictLimiter,
    AuthController.logoutAll.bind(AuthController)
);*/

// ==================== III. GESTION DES MOTS DE PASSE ====================

/**
 * @swagger
 * /authentification/password/forgot:
 *   post:
 *     summary: Demande de réinitialisation de mot de passe
 *     description: Envoie un code de réinitialisation par email ou SMS
 *     tags: [Authentification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email de l'utilisateur
 *                 example: jean.dupont@email.com
 *               telephone:
 *                 type: string
 *                 description: Numéro de téléphone
 *                 example: "+22670123456"
 *     responses:
 *       200:
 *         description: Code de réinitialisation envoyé
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Code de réinitialisation envoyé"
 *                 data:
 *                   type: object
 *                   properties:
 *                     debug_token:
 *                       type: string
 *                       description: Token de débogage (uniquement en développement)
 *       400:
 *         description: Email ou téléphone requis
 *       404:
 *         description: Utilisateur non trouvé
 *       429:
 *         description: Trop de demandes
 */
router.post('/password/forgot',
    passwordResetLimiter,
    validationMiddleware.validate([
        body('email').optional().isEmail().normalizeEmail(),
        body('telephone').optional().matches(/^[0-9+\-\s]+$/),
        body().custom((value, { req }) => {
            if (!req.body.email && !req.body.telephone) {
                throw new Error('Email ou téléphone requis');
            }
            return true;
        })
    ]),
    PasswordController.forgotPassword.bind(PasswordController)
);

/**
 * @swagger
 * /authentification/password/verify-code:
 *   post:
 *     summary: Vérifier le code de réinitialisation
 *     description: Vérifie la validité du code de réinitialisation
 *     tags: [Authentification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email de l'utilisateur
 *                 example: jean.dupont@email.com
 *               telephone:
 *                 type: string
 *                 description: Numéro de téléphone
 *                 example: "+22670123456"
 *               code:
 *                 type: string
 *                 description: Code de réinitialisation à 6 chiffres
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Code valide
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Code valide"
 *                 data:
 *                   type: object
 *                   properties:
 *                     reset_allowed:
 *                       type: boolean
 *                       example: true
 *       400:
 *         description: Code invalide
 *       404:
 *         description: Utilisateur non trouvé
 */
router.post('/password/verify-code',
    verifyCodeLimiter,
    validationMiddleware.validate([
        body('email').optional().isEmail().normalizeEmail(),
        body('telephone').optional().matches(/^[0-9+\-\s]+$/),
        body('code')
            .notEmpty()
            .isLength({ min: 6, max: 6 })
            .isNumeric()
            .withMessage('Le code doit être composé de 6 chiffres'),
        body().custom((value, { req }) => {
            if (!req.body.email && !req.body.telephone) {
                throw new Error('Email ou téléphone requis');
            }
            return true;
        })
    ]),
    PasswordController.verifyResetCode.bind(PasswordController)
);

/**
 * @swagger
 * /authentification/password/reset:
 *   post:
 *     summary: Réinitialiser le mot de passe
 *     description: Définit un nouveau mot de passe avec un token ou code valide
 *     tags: [Authentification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nouveau_mot_de_passe
 *             properties:
 *               token:
 *                 type: string
 *                 description: Token de réinitialisation
 *                 example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *               code:
 *                 type: string
 *                 description: Code de réinitialisation à 6 chiffres
 *                 example: "123456"
 *               nouveau_mot_de_passe:
 *                 type: string
 *                 format: password
 *                 description: Nouveau mot de passe
 *                 example: "NewPassword123!"
 *     responses:
 *       200:
 *         description: Mot de passe réinitialisé avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Mot de passe réinitialisé avec succès"
 *       400:
 *         description: Token/code invalide ou mot de passe non conforme
 *       401:
 *         description: Token expiré
 */
router.post('/password/reset',
    passwordResetLimiter,
    validationMiddleware.validate([
        body('token').optional().trim(),
        body('code').optional().isLength({ min: 6, max: 6 }).isNumeric(),
        body('nouveau_mot_de_passe')
            .notEmpty()
            .isLength({ min: 8 })
            .withMessage('Le mot de passe doit contenir au moins 8 caractères')
            .matches(/^(?=.*[A-Za-z])(?=.*\d)/)
            .withMessage('Le mot de passe doit contenir au moins une lettre et un chiffre'),
        body().custom((value, { req }) => {
            if (!req.body.token && !req.body.code) {
                throw new Error('Token ou code requis');
            }
            return true;
        })
    ]),
    PasswordController.resetPassword.bind(PasswordController)
);

/**
 * @swagger
 * /authentification/password/change:
 *   post:
 *     summary: Changer le mot de passe
 *     description: Permet à un utilisateur connecté de changer son mot de passe
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ancien_mot_de_passe
 *               - nouveau_mot_de_passe
 *             properties:
 *               ancien_mot_de_passe:
 *                 type: string
 *                 format: password
 *                 description: Mot de passe actuel
 *                 example: "OldPassword123!"
 *               nouveau_mot_de_passe:
 *                 type: string
 *                 format: password
 *                 description: Nouveau mot de passe
 *                 example: "NewPassword123!"
 *               deconnecter_autres:
 *                 type: boolean
 *                 description: Déconnecter les autres sessions
 *                 default: false
 *                 example: true
 *     responses:
 *       200:
 *         description: Mot de passe changé avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Mot de passe modifié avec succès"
 *       400:
 *         description: Ancien mot de passe incorrect ou nouveau non conforme
 *       401:
 *         description: Non authentifié
 */
router.post('/password/change',
    authMiddleware.authenticate,
    rateLimiter.strictLimiter,
    validationMiddleware.validate([
        body('ancien_mot_de_passe').notEmpty(),
        body('nouveau_mot_de_passe')
            .notEmpty()
            .isLength({ min: 8 })
            .withMessage('Le mot de passe doit contenir au moins 8 caractères')
            .matches(/^(?=.*[A-Za-z])(?=.*\d)/)
            .withMessage('Le mot de passe doit contenir au moins une lettre et un chiffre'),
        body('deconnecter_autres').optional().isBoolean(),
        body().custom((value, { req }) => {
            if (req.body.ancien_mot_de_passe === req.body.nouveau_mot_de_passe) {
                throw new Error('Le nouveau mot de passe doit être différent de l\'ancien');
            }
            return true;
        })
    ]),
    PasswordController.changePassword.bind(PasswordController)
);

// ==================== IV. GESTION DES SESSIONS ====================

/**
 * @swagger
 * /authentification/sessions:
 *   get:
 *     summary: Liste des sessions actives
 *     description: Récupère toutes les sessions actives de l'utilisateur
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des sessions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Session'
 *       401:
 *         description: Non authentifié
 */
/* NonCréé - à implémenter dans AuthController.getSessions
router.get('/sessions',
    authMiddleware.authenticate,
    rateLimiter.publicLimiter,
    AuthController.getSessions.bind(AuthController)
);*/

/**
 * @swagger
 * /authentification/sessions/{sessionId}:
 *   delete:
 *     summary: Révoquer une session
 *     description: Invalide une session spécifique
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID de la session à révoquer
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     responses:
 *       200:
 *         description: Session révoquée
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Session révoquée avec succès"
 *       401:
 *         description: Non authentifié
 *       404:
 *         description: Session non trouvée
 */
/* NonCréé - à implémenter dans AuthController.revokeSession
router.delete('/sessions/:sessionId',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('sessionId').isUUID()
    ]),
    AuthController.revokeSession.bind(AuthController)
);
*/

// ==================== V. VÉRIFICATION ET SÉCURITÉ ====================

/**
 * @swagger
 * /authentification/verify-2fa:
 *   post:
 *     summary: Vérification 2FA
 *     description: Vérifie le code 2FA pour les actions sensibles
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *               - action
 *             properties:
 *               code:
 *                 type: string
 *                 description: Code 2FA à 6 chiffres
 *                 example: "123456"
 *               action:
 *                 type: string
 *                 enum: [login, payment, settings]
 *                 description: Action à vérifier
 *                 example: "payment"
 *     responses:
 *       200:
 *         description: Code vérifié
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     verified:
 *                       type: boolean
 *                       example: true
 *                     token:
 *                       type: string
 *                       description: Token temporaire pour l'action
 *       400:
 *         description: Code invalide
 *       401:
 *         description: Non authentifié
 */
/*
router.post('/verify-2fa',
    authMiddleware.authenticatePartial,
    verifyCodeLimiter,
    validationMiddleware.validate([
        body('code').notEmpty().isLength({ min: 6, max: 6 }).isNumeric(),
        body('action').isIn(['login', 'payment', 'settings'])
    ]),
    AuthController.verifyTwoFactor.bind(AuthController)
);*/

/**
 * @swagger
 * /authentification/enable-2fa:
 *   post:
 *     summary: Activer la 2FA
 *     description: Active l'authentification à deux facteurs
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [TOTP, SMS, EMAIL]
 *                 default: TOTP
 *                 description: Type de 2FA
 *                 example: TOTP
 *     responses:
 *       200:
 *         description: 2FA activée
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     secret:
 *                       type: string
 *                       description: Secret TOTP
 *                       example: "JBSWY3DPEHPK3PXP"
 *                     qr_code:
 *                       type: string
 *                       description: QR code en base64
 *       400:
 *         description: Déjà activé
 */
/* NonCréé - à implémenter dans AuthController.enableTwoFactor
router.post('/enable-2fa',
    authMiddleware.authenticate,
    rateLimiter.strictLimiter,
    validationMiddleware.validate([
        body('type').optional().isIn(['TOTP', 'SMS', 'EMAIL']).default('TOTP')
    ]),
    AuthController.enableTwoFactor.bind(AuthController)
);*/

/**
 * @swagger
 * /authentification/disable-2fa:
 *   post:
 *     summary: Désactiver la 2FA
 *     description: Désactive l'authentification à deux facteurs
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *             properties:
 *               code:
 *                 type: string
 *                 description: Code de vérification 2FA
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: 2FA désactivée
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "2FA désactivée avec succès"
 *       400:
 *         description: Code invalide
 */
/*
router.post('/disable-2fa',
    authMiddleware.authenticate,
    verifyCodeLimiter,
    validationMiddleware.validate([
        body('code').notEmpty().isLength({ min: 6, max: 6 }).isNumeric()
    ]),
    AuthController.disableTwoFactor.bind(AuthController)
);
*/

// ==================== VI. PROFIL UTILISATEUR ====================

/**
 * @swagger
 * /authentification/profile:
 *   get:
 *     summary: Profil utilisateur
 *     description: Récupère le profil de l'utilisateur connecté
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profil récupéré
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     utilisateur:
 *                       $ref: '#/components/schemas/Compte'
 *       401:
 *         description: Non authentifié
 */
/*
router.get('/profile',
    authMiddleware.authenticate,
    rateLimiter.publicLimiter,
    AuthController.getProfile.bind(AuthController)
);*/

/**
 * @swagger
 * /authentification/profile:
 *   put:
 *     summary: Mettre à jour le profil
 *     description: Met à jour les informations du profil utilisateur
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nom_utilisateur:
 *                 type: string
 *                 description: Nom d'utilisateur
 *                 example: jean_dupont_new
 *               photo_profil:
 *                 type: string
 *                 format: uri
 *                 description: URL de la photo
 *                 example: "https://example.com/new-photo.jpg"
 *               date_naissance:
 *                 type: string
 *                 format: date
 *                 description: Date de naissance
 *                 example: "1990-01-01"
 *               sexe:
 *                 type: string
 *                 enum: [M, F, AUTRE]
 *                 description: Sexe
 *               langue_preferee:
 *                 type: string
 *                 enum: [fr, en]
 *                 description: Langue préférée
 *     responses:
 *       200:
 *         description: Profil mis à jour
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     utilisateur:
 *                       $ref: '#/components/schemas/Compte'
 *       400:
 *         description: Données invalides
 *       401:
 *         description: Non authentifié
 */
/*
router.put('/profile',
    authMiddleware.authenticate,
    rateLimiter.strictLimiter,
    validationMiddleware.validate([
        body('nom_utilisateur').optional().trim().isLength({ min: 3, max: 50 }),
        body('photo_profil').optional().isURL(),
        body('date_naissance').optional().isISO8601(),
        body('sexe').optional().isIn(['M', 'F', 'AUTRE']),
        body('langue_preferee').optional().isIn(['fr', 'en'])
    ]),
    AuthController.updateProfile.bind(AuthController)
);
*/

/**
 * @swagger
 * /authentification/change-email:
 *   post:
 *     summary: Demander le changement d'email
 *     description: Envoie un code de vérification pour le nouvel email
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nouvel_email
 *               - mot_de_passe
 *             properties:
 *               nouvel_email:
 *                 type: string
 *                 format: email
 *                 description: Nouvel email
 *                 example: nouveau@email.com
 *               mot_de_passe:
 *                 type: string
 *                 format: password
 *                 description: Mot de passe actuel
 *                 example: "Password123!"
 *     responses:
 *       200:
 *         description: Code envoyé
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Code de vérification envoyé"
 *       401:
 *         description: Mot de passe incorrect
 *       429:
 *         description: Trop de demandes
 */
/*
router.post('/change-email',
    authMiddleware.authenticate,
    rateLimit({
        windowMs: 24 * 60 * 60 * 1000, // 24 heures
        max: 3,
        message: 'Trop de demandes de changement d\'email. Réessayez dans 24 heures.'
    }),
    validationMiddleware.validate([
        body('nouvel_email').isEmail().normalizeEmail(),
        body('mot_de_passe').notEmpty()
    ]),
    AuthController.requestEmailChange.bind(AuthController)
);*/

/**
 * @swagger
 * /authentification/change-phone:
 *   post:
 *     summary: Demander le changement de téléphone
 *     description: Envoie un code de vérification pour le nouveau numéro
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nouveau_telephone
 *               - mot_de_passe
 *             properties:
 *               nouveau_telephone:
 *                 type: string
 *                 description: Nouveau numéro de téléphone
 *                 example: "+22671234567"
 *               mot_de_passe:
 *                 type: string
 *                 format: password
 *                 description: Mot de passe actuel
 *                 example: "Password123!"
 *     responses:
 *       200:
 *         description: Code envoyé
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Code de vérification envoyé"
 *       401:
 *         description: Mot de passe incorrect
 *       429:
 *         description: Trop de demandes
 */
/*
router.post('/change-phone',
    authMiddleware.authenticate,
    rateLimit({
        windowMs: 24 * 60 * 60 * 1000, // 24 heures
        max: 3,
        message: 'Trop de demandes de changement de téléphone. Réessayez dans 24 heures.'
    }),
    validationMiddleware.validate([
        body('nouveau_telephone').matches(/^[0-9+\-\s]+$/),
        body('mot_de_passe').notEmpty()
    ]),
    AuthController.requestPhoneChange.bind(AuthController)
);*/

/**
 * @swagger
 * /authentification/profile:
 *   delete:
 *     summary: Supprimer le compte
 *     description: Supprime le compte utilisateur (soft delete)
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mot_de_passe
 *             properties:
 *               mot_de_passe:
 *                 type: string
 *                 format: password
 *                 description: Mot de passe de confirmation
 *                 example: "Password123!"
 *               raison:
 *                 type: string
 *                 description: Raison de la suppression
 *                 maxLength: 500
 *                 example: "Je n'utilise plus le service"
 *     responses:
 *       200:
 *         description: Compte supprimé
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Compte supprimé avec succès"
 *       401:
 *         description: Mot de passe incorrect
 *       429:
 *         description: Trop de tentatives
 */
/*
router.delete('/profile',
    authMiddleware.authenticate,
    rateLimit({
        windowMs: 60 * 60 * 1000, // 1 heure
        max: 1,
        message: 'Trop de tentatives de suppression. Réessayez dans 1 heure.'
    }),
    validationMiddleware.validate([
        body('mot_de_passe').notEmpty(),
        body('raison').optional().trim().isLength({ max: 500 })
    ]),
    AuthController.deleteAccount.bind(AuthController)
);*/

// ==================== VII. FOURNISSEURS OAUTH ====================

/**
 * @swagger
 * /authentification/oauth/{provider}:
 *   get:
 *     summary: Redirection OAuth
 *     description: Redirige vers le fournisseur OAuth pour authentification
 *     tags: [Authentification]
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [google, facebook, apple]
 *         description: Fournisseur OAuth
 *         example: google
 *     responses:
 *       302:
 *         description: Redirection vers le fournisseur
 *       400:
 *         description: Provider non supporté
 */
/*
router.get('/oauth/:provider',
    validationMiddleware.validate([
        param('provider').isIn(['google', 'facebook', 'apple'])
    ]),
    AuthController.oauthRedirect.bind(AuthController)
);*/

/**
 * @swagger
 * /authentification/oauth/{provider}/callback:
 *   get:
 *     summary: Callback OAuth
 *     description: Endpoint de callback pour OAuth
 *     tags: [Authentification]
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [google, facebook, apple]
 *         description: Fournisseur OAuth
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Code d'autorisation
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: État de la session
 *     responses:
 *       200:
 *         description: Authentification réussie
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       400:
 *         description: Code invalide
 */
/*
router.get('/oauth/:provider/callback',
    validationMiddleware.validate([
        param('provider').isIn(['google', 'facebook', 'apple']),
        query('code').notEmpty(),
        query('state').optional()
    ]),
    AuthController.oauthCallback.bind(AuthController)
);
*/

/**
 * @swagger
 * /authentification/oauth/{provider}/token:
 *   post:
 *     summary: Échange de token OAuth (mobile)
 *     description: Échange un code contre un token (pour applications mobiles)
 *     tags: [Authentification]
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [google, facebook, apple]
 *         description: Fournisseur OAuth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *               - redirect_uri
 *             properties:
 *               code:
 *                 type: string
 *                 description: Code d'autorisation
 *                 example: "4/0AY0e-g7..."
 *               redirect_uri:
 *                 type: string
 *                 format: uri
 *                 description: URI de redirection
 *                 example: "com.klikup.app:/oauth2redirect"
 *     responses:
 *       200:
 *         description: Token généré
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       400:
 *         description: Code invalide
 */
/*
router.post('/oauth/:provider/token',
    validationMiddleware.validate([
        param('provider').isIn(['google', 'facebook', 'apple']),
        body('code').notEmpty(),
        body('redirect_uri').isURL()
    ]),
    AuthController.oauthExchangeToken.bind(AuthController)
);*/

module.exports = router;