// src/routes/v1/horaire.routes.js
/**
 * Routes de gestion des horaires
 * API pour la gestion complète des horaires d'ouverture, exceptions et jours fériés
 * Accès public pour la consultation, authentification requise pour les modifications
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

const HoraireController = require('../../controllers/horaire/HoraireController');
const HoraireExceptionController = require('../../controllers/horaire/HoraireExceptionController');
const JourFerieController = require('../../controllers/horaire/JourFerieController');

// ==================== CONFIGURATION RATE LIMITING ====================

const batchOperationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 10, // 10 opérations en lot max par heure
    message: 'Trop d\'opérations en lot. Réessayez plus tard.',
    standardHeaders: true,
    legacyHeaders: false
});

// ==================== I. HORAIRES RÉGULIERS ====================

/**
 * POST /api/v1/horaires
 * Créer ou mettre à jour les horaires d'une entité
 * Headers: Authorization: Bearer <token>
 * Body: {
 *   entite_type, entite_id,
 *   horaires: [
 *     { est_ouvert, heure_ouverture?, heure_fermeture?, heure_coupure_debut?, heure_coupure_fin? }
 *   ] (7 jours)
 * }
 * Auth: PRIVATE (propriétaire de l'entité)
 * Réponse: { status, data, message }
 */
router.post('/',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        body('entite_type').isIn([
            'PLATEFORME', 'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT',
            'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT', 'BOUTIQUE', 'LIVREUR'
        ]),
        body('entite_id').isInt(),
        body('horaires').isArray().withMessage('Les horaires doivent être un tableau de 7 jours'),
        body('horaires').custom(value => {
            if (!Array.isArray(value) || value.length !== 7) {
                throw new Error('Les horaires doivent contenir exactement 7 jours');
            }
            return true;
        }),
        body('horaires.*.est_ouvert').optional().isBoolean(),
        body('horaires.*.heure_ouverture').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        body('horaires.*.heure_fermeture').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        body('horaires.*.heure_coupure_debut').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        body('horaires.*.heure_coupure_fin').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    ]),
    HoraireController.createOrUpdate.bind(HoraireController)
);

/**
 * GET /api/v1/horaires/:entite_type/:entite_id
 * Récupérer les horaires d'une entité
 * Params: entite_type, entite_id
 * Auth: PUBLIC
 * Cache: 1 heure
 * Réponse: { status, data: horaires_par_jour }
 */
router.get('/:entite_type/:entite_id',
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        param('entite_type').isIn([
            'PLATEFORME', 'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT',
            'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT', 'BOUTIQUE', 'LIVREUR'
        ]),
        param('entite_id').isInt()
    ]),
    HoraireController.findByEntity.bind(HoraireController)
);

/**
 * GET /api/v1/horaires/est-ouvert
 * Vérifier si une entité est ouverte à un moment donné
 * Query: entite_type, entite_id, date_time? (défaut: maintenant)
 * Auth: PUBLIC
 * Cache: 5 minutes
 * Réponse: { status, data: { est_ouvert, date_time, entite, details } }
 */
router.get('/est-ouvert',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('entite_type').isIn([
            'PLATEFORME', 'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT',
            'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT', 'BOUTIQUE', 'LIVREUR'
        ]),
        query('entite_id').isInt(),
        query('date_time').optional().isISO8601()
    ]),
    HoraireController.estOuvert.bind(HoraireController)
);

/**
 * GET /api/v1/horaires/creneaux
 * Récupérer les créneaux disponibles pour une date
 * Query: entite_type, entite_id, date, duree_minutes=30
 * Auth: PUBLIC
 * Cache: 5 minutes
 * Réponse: { status, data: creneaux, meta }
 */
router.get('/creneaux',
    cacheMiddleware.cache(300), // 5 minutes
    validationMiddleware.validate([
        query('entite_type').isIn([
            'PLATEFORME', 'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT',
            'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT', 'BOUTIQUE', 'LIVREUR'
        ]),
        query('entite_id').isInt(),
        query('date').isISO8601(),
        query('duree_minutes').optional().isInt({ min: 15, max: 240 })
    ]),
    HoraireController.getCreneauxDisponibles.bind(HoraireController)
);

/**
 * POST /api/v1/horaires/copier
 * Copier les horaires d'une entité vers une autre
 * Headers: Authorization: Bearer <token>
 * Body: { source_type, source_id, destination_type, destination_id }
 * Auth: PRIVATE (propriétaire de la destination)
 * Réponse: { status, message }
 */
router.post('/copier',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        body('source_type').isIn([
            'BOUTIQUE', 'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT',
            'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT'
        ]),
        body('source_id').isInt(),
        body('destination_type').isIn([
            'BOUTIQUE', 'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT',
            'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT'
        ]),
        body('destination_id').isInt()
    ]),
    HoraireController.copyHoraires.bind(HoraireController)
);

// ==================== II. EXCEPTIONS D'HORAIRES ====================

/**
 * POST /api/v1/horaires/exceptions
 * Créer une exception d'horaire
 * Headers: Authorization: Bearer <token>
 * Body: {
 *   entite_type, entite_id, date_exception, libelle,
 *   est_ouvert=false, heure_ouverture?, heure_fermeture?, motif?
 * }
 * Auth: PRIVATE (propriétaire de l'entité)
 * Réponse: 201 { status, data }
 */
router.post('/exceptions',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        body('entite_type').isIn([
            'BOUTIQUE', 'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT',
            'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT'
        ]),
        body('entite_id').isInt(),
        body('date_exception').isISO8601(),
        body('libelle').notEmpty().trim().isLength({ min: 3, max: 255 }),
        body('est_ouvert').optional().isBoolean(),
        body('heure_ouverture').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        body('heure_fermeture').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        body('motif').optional().trim().isLength({ max: 500 }),
        body().custom(body => {
            if (body.est_ouvert) {
                if (!body.heure_ouverture || !body.heure_fermeture) {
                    throw new Error('Heures requises si ouvert');
                }
                if (body.heure_fermeture <= body.heure_ouverture) {
                    throw new Error('Heure de fermeture doit être après ouverture');
                }
            }
            return true;
        })
    ]),
    HoraireExceptionController.create.bind(HoraireExceptionController)
);

/**
 * POST /api/v1/horaires/exceptions/batch
 * Créer des exceptions en lot (ex: fermeture annuelle)
 * Headers: Authorization: Bearer <token>
 * Body: { entite_type, entite_id, dates: [string], libelle, est_ouvert=false, motif? }
 * Rate limit: 10 par heure
 * Auth: PRIVATE (propriétaire de l'entité)
 * Réponse: { status, data: { created, failed, exceptions, errors } }
 */
router.post('/exceptions/batch',
    authMiddleware.authenticate,
    batchOperationLimiter,
    validationMiddleware.validate([
        body('entite_type').isIn([
            'BOUTIQUE', 'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT',
            'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT'
        ]),
        body('entite_id').isInt(),
        body('dates').isArray().notEmpty(),
        body('dates.*').isISO8601(),
        body('libelle').notEmpty().trim().isLength({ min: 3, max: 255 }),
        body('est_ouvert').optional().isBoolean(),
        body('motif').optional().trim().isLength({ max: 500 })
    ]),
    HoraireExceptionController.createBatch.bind(HoraireExceptionController)
);

/**
 * GET /api/v1/horaires/exceptions/:entite_type/:entite_id
 * Récupérer les exceptions d'une entité
 * Params: entite_type, entite_id
 * Query: from_date?, to_date?, include_passed=false
 * Auth: PUBLIC
 * Cache: 10 minutes
 * Réponse: { status, data: { a_venir, passees, total } }
 */
router.get('/exceptions/:entite_type/:entite_id',
    cacheMiddleware.cache(600), // 10 minutes
    validationMiddleware.validate([
        param('entite_type').isIn([
            'BOUTIQUE', 'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT',
            'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT'
        ]),
        param('entite_id').isInt(),
        query('from_date').optional().isISO8601(),
        query('to_date').optional().isISO8601(),
        query('include_passed').optional().isBoolean()
    ]),
    HoraireExceptionController.findByEntity.bind(HoraireExceptionController)
);

/**
 * PUT /api/v1/horaires/exceptions/:id
 * Mettre à jour une exception
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { libelle?, est_ouvert?, heure_ouverture?, heure_fermeture?, motif? }
 * Auth: PRIVATE (propriétaire de l'entité)
 * Réponse: { status, data }
 */
router.put('/exceptions/:id',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt(),
        body('libelle').optional().trim().isLength({ min: 3, max: 255 }),
        body('est_ouvert').optional().isBoolean(),
        body('heure_ouverture').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        body('heure_fermeture').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        body('motif').optional().trim().isLength({ max: 500 })
    ]),
    HoraireExceptionController.update.bind(HoraireExceptionController)
);

/**
 * DELETE /api/v1/horaires/exceptions/:id
 * Supprimer une exception
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: PRIVATE (propriétaire de l'entité)
 * Réponse: { status, message }
 */
router.delete('/exceptions/:id',
    authMiddleware.authenticate,
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    HoraireExceptionController.delete.bind(HoraireExceptionController)
);

// ==================== III. JOURS FÉRIÉS ====================

/**
 * POST /api/v1/jours-feries
 * Créer un jour férié
 * Headers: Authorization: Bearer <token>
 * Body: { pays='Burkina Faso', date_ferie, libelle, est_recurrent=true }
 * Auth: ADMIN
 * Réponse: 201 { status, data }
 */
router.post('/jours-feries',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        body('pays').optional().trim(),
        body('date_ferie').isISO8601(),
        body('libelle').notEmpty().trim().isLength({ min: 3, max: 255 }),
        body('est_recurrent').optional().isBoolean()
    ]),
    JourFerieController.create.bind(JourFerieController)
);

/**
 * POST /api/v1/jours-feries/import
 * Importer les jours fériés d'une année
 * Headers: Authorization: Bearer <token>
 * Body: { annee, pays='Burkina Faso' }
 * Auth: ADMIN
 * Réponse: { status, data: { imported, total, jours } }
 */
router.post('/jours-feries/import',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    batchOperationLimiter,
    validationMiddleware.validate([
        body('annee').isInt({ min: 2000, max: 2100 }),
        body('pays').optional().trim()
    ]),
    JourFerieController.importYear.bind(JourFerieController)
);

/**
 * GET /api/v1/jours-feries
 * Récupérer tous les jours fériés
 * Query: pays?, annee?, recurrent_only=false, include_passed=false
 * Auth: PUBLIC
 * Cache: 1 jour
 * Réponse: { status, data, grouped, total }
 */
router.get('/jours-feries',
    cacheMiddleware.cache(86400), // 24 heures
    validationMiddleware.validate([
        query('pays').optional().trim(),
        query('annee').optional().isInt({ min: 2000, max: 2100 }),
        query('recurrent_only').optional().isBoolean(),
        query('include_passed').optional().isBoolean()
    ]),
    JourFerieController.findAll.bind(JourFerieController)
);

/**
 * GET /api/v1/jours-feries/est-ferie
 * Vérifier si une date est fériée
 * Query: date, pays='Burkina Faso'
 * Auth: PUBLIC
 * Cache: 1 heure
 * Réponse: { status, data: { date, est_ferie, jour_ferie } }
 */
router.get('/jours-feries/est-ferie',
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('date').isISO8601(),
        query('pays').optional().trim()
    ]),
    JourFerieController.estFerie.bind(JourFerieController)
);

/**
 * PUT /api/v1/jours-feries/:id
 * Mettre à jour un jour férié
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Body: { libelle?, est_recurrent? }
 * Auth: ADMIN
 * Réponse: { status, data }
 */
router.put('/jours-feries/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt(),
        body('libelle').optional().trim().isLength({ min: 3, max: 255 }),
        body('est_recurrent').optional().isBoolean()
    ]),
    JourFerieController.update.bind(JourFerieController)
);

/**
 * DELETE /api/v1/jours-feries/:id
 * Supprimer un jour férié
 * Headers: Authorization: Bearer <token>
 * Params: id
 * Auth: ADMIN
 * Réponse: { status, message }
 */
router.delete('/jours-feries/:id',
    authMiddleware.authenticate,
    roleMiddleware.isAdmin(),
    validationMiddleware.validate([
        param('id').isInt()
    ]),
    JourFerieController.delete.bind(JourFerieController)
);

// ==================== IV. UTILITAIRES POUR LES HORAIRES ====================

/**
 * GET /api/v1/horaires/prochains-jours-ouvres
 * Récupérer les prochains jours ouvrés pour une entité
 * Query: entite_type, entite_id, nombre_jours=5, date_depart? (défaut: aujourd'hui)
 * Auth: PUBLIC
 * Cache: 1 heure
 * Réponse: { status, data: [{ date, est_ouvert, horaire }] }
 */
router.get('/prochains-jours-ouvres',
    cacheMiddleware.cache(3600), // 1 heure
    validationMiddleware.validate([
        query('entite_type').isIn([
            'BOUTIQUE', 'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT',
            'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT'
        ]),
        query('entite_id').isInt(),
        query('nombre_jours').optional().isInt({ min: 1, max: 30 }),
        query('date_depart').optional().isISO8601()
    ]),
    async (req, res, next) => {
        try {
            const { entite_type, entite_id, nombre_jours = 5, date_depart } = req.query;
            const dateDepart = date_depart ? new Date(date_depart) : new Date();
            const resultats = [];

            for (let i = 0; i < nombre_jours; i++) {
                const date = new Date(dateDepart);
                date.setDate(dateDepart.getDate() + i);
                
                const estOuvert = await pool.query(
                    `SELECT fn_est_ouvert($1, $2, $3) as est_ouvert`,
                    [entite_type, entite_id, date]
                );

                // Récupérer les horaires du jour
                const jourSemaine = date.getDay();
                const horaire = await pool.query(
                    `SELECT * FROM HORAIRES 
                     WHERE entite_type = $1 AND entite_id = $2 AND jour_semaine = $3`,
                    [entite_type, entite_id, jourSemaine]
                );

                resultats.push({
                    date: date.toISOString().split('T')[0],
                    est_ouvert: estOuvert.rows[0].est_ouvert,
                    horaire: horaire.rows[0] || null
                });
            }

            res.json({
                status: 'success',
                data: resultats
            });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * GET /api/v1/horaires/calendrier/:annee/:mois
 * Récupérer le calendrier complet d'un mois pour une entité
 * Params: annee, mois
 * Query: entite_type, entite_id
 * Auth: PUBLIC
 * Cache: 1 jour
 * Réponse: { status, data: { jours, jours_feries, exceptions } }
 */
router.get('/calendrier/:annee/:mois',
    cacheMiddleware.cache(86400), // 24 heures
    validationMiddleware.validate([
        param('annee').isInt({ min: 2000, max: 2100 }),
        param('mois').isInt({ min: 1, max: 12 }),
        query('entite_type').isIn([
            'BOUTIQUE', 'RESTAURANT_FAST_FOOD', 'EMPLACEMENT_RESTAURANT',
            'COMPAGNIE_TRANSPORT', 'EMPLACEMENT_TRANSPORT'
        ]),
        query('entite_id').isInt()
    ]),
    async (req, res, next) => {
        try {
            const { annee, mois } = req.params;
            const { entite_type, entite_id } = req.query;
            
            const premierJour = new Date(annee, mois - 1, 1);
            const dernierJour = new Date(annee, mois, 0);
            
            const jours = [];
            
            for (let d = 1; d <= dernierJour.getDate(); d++) {
                const date = new Date(annee, mois - 1, d);
                
                const [estOuvert, joursFeries, exceptions] = await Promise.all([
                    pool.query(
                        `SELECT fn_est_ouvert($1, $2, $3) as est_ouvert`,
                        [entite_type, entite_id, date]
                    ),
                    pool.query(
                        `SELECT * FROM JOURS_FERIES 
                         WHERE (date_ferie = $1::date OR (est_recurrent = true AND 
                               EXTRACT(MONTH FROM date_ferie) = $2 AND
                               EXTRACT(DAY FROM date_ferie) = $3))`,
                        [date, mois, d]
                    ),
                    pool.query(
                        `SELECT * FROM HORAIRES_EXCEPTIONS 
                         WHERE entite_type = $1 AND entite_id = $2 AND date_exception = $3::date`,
                        [entite_type, entite_id, date]
                    )
                ]);
                
                jours.push({
                    date: date.toISOString().split('T')[0],
                    est_ouvert: estOuvert.rows[0].est_ouvert,
                    jour_ferie: joursFeries.rows[0] || null,
                    exception: exceptions.rows[0] || null
                });
            }
            
            res.json({
                status: 'success',
                data: {
                    mois,
                    annee,
                    jours,
                    total_jours: jours.length,
                    jours_ouvres: jours.filter(j => j.est_ouvert).length,
                    jours_feries: jours.filter(j => j.jour_ferie).length,
                    exceptions: jours.filter(j => j.exception).length
                }
            });
        } catch (error) {
            next(error);
        }
    }
);

module.exports = router;