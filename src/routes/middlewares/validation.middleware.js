// src/routes/middlewares/validation.middleware.js
const { validationResult, validate } = require('express-validator');
const { ValidationError } = require('../../utils/errors/AppError');
const { uuidValidate } = require('uuid');

class ValidationMiddleware {
    /**
     * Valider les résultats de express-validator
     */
    validate(validations) {
        return async (req, res, next) => {
            // Exécuter toutes les validations
            for (const validation of validations) {
                const result = await validation.run(req);
                if (result.errors.length) break;
            }

            const errors = validationResult(req);
            if (errors.isEmpty()) {
                return next();
            }

            const formattedErrors = errors.array().map(err => ({
                field: err.param,
                message: err.msg,
                value: err.value
            }));

            throw new ValidationError('Données invalides', formattedErrors);
        };
    }

    /**
     * Valider un UUID
     */
    validateUUID(field) {
        return (req, res, next) => {
            const value = req.params[field] || req.body[field];
            
            if (value && !uuidValidate(value)) {
                throw new ValidationError(`Format UUID invalide pour ${field}`);
            }
            
            next();
        };
    }

    /**
     * Valider un ID numérique
     */
    validateId(field) {
        return (req, res, next) => {
            const value = req.params[field] || req.body[field];
            
            if (value && (!Number.isInteger(parseInt(value)) || parseInt(value) <= 0)) {
                throw new ValidationError(`ID invalide pour ${field}`);
            }
            
            next();
        };
    }

    /**
     * Valider une date
     */
    validateDate(field, options = {}) {
        return (req, res, next) => {
            const value = req.body[field];
            
            if (!value) {
                if (options.required) {
                    throw new ValidationError(`Le champ ${field} est requis`);
                }
                return next();
            }

            const date = new Date(value);
            if (isNaN(date.getTime())) {
                throw new ValidationError(`Format de date invalide pour ${field}`);
            }

            if (options.min && date < new Date(options.min)) {
                throw new ValidationError(`${field} doit être après ${options.min}`);
            }

            if (options.max && date > new Date(options.max)) {
                throw new ValidationError(`${field} doit être avant ${options.max}`);
            }

            if (options.future && date < new Date()) {
                throw new ValidationError(`${field} doit être dans le futur`);
            }

            if (options.past && date > new Date()) {
                throw new ValidationError(`${field} doit être dans le passé`);
            }

            // Remplacer par l'objet Date valide
            req.body[field] = date;
            
            next();
        };
    }

    /**
     * Valider un email
     */
    validateEmail(field = 'email') {
        return (req, res, next) => {
            const email = req.body[field];
            
            if (!email) {
                throw new ValidationError(`Email requis`);
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                throw new ValidationError('Format d\'email invalide');
            }

            next();
        };
    }

    /**
     * Valider un numéro de téléphone
     */
    validatePhone(field = 'telephone') {
        return (req, res, next) => {
            const phone = req.body[field];
            
            if (!phone) {
                return next();
            }

            // Format: +226XXXXXXXXX ou 0XXXXXXXXX
            const phoneRegex = /^(\+226|0)[0-9]{8}$/;
            if (!phoneRegex.test(phone.replace(/\s/g, ''))) {
                throw new ValidationError('Format de téléphone invalide (ex: +226XXXXXXXX ou 0XXXXXXXX)');
            }

            next();
        };
    }

    /**
     * Valider un mot de passe fort
     */
    validatePassword(field = 'mot_de_passe') {
        return (req, res, next) => {
            const password = req.body[field];
            
            if (!password) {
                throw new ValidationError('Mot de passe requis');
            }

            if (password.length < 8) {
                throw new ValidationError('Le mot de passe doit contenir au moins 8 caractères');
            }

            if (!/[A-Z]/.test(password)) {
                throw new ValidationError('Le mot de passe doit contenir au moins une majuscule');
            }

            if (!/[a-z]/.test(password)) {
                throw new ValidationError('Le mot de passe doit contenir au moins une minuscule');
            }

            if (!/[0-9]/.test(password)) {
                throw new ValidationError('Le mot de passe doit contenir au moins un chiffre');
            }

            if (!/[^A-Za-z0-9]/.test(password)) {
                throw new ValidationError('Le mot de passe doit contenir au moins un caractère spécial');
            }

            next();
        };
    }

    /**
     * Valider que deux champs correspondent
     */
    validateMatch(field1, field2, message) {
        return (req, res, next) => {
            if (req.body[field1] !== req.body[field2]) {
                throw new ValidationError(message || `${field1} et ${field2} ne correspondent pas`);
            }
            next();
        };
    }

    /**
     * Valider une énumération
     */
    validateEnum(field, enumValues) {
        return (req, res, next) => {
            const value = req.body[field];
            
            if (value && !enumValues.includes(value)) {
                throw new ValidationError(
                    `${field} doit être une de ces valeurs: ${enumValues.join(', ')}`
                );
            }
            
            next();
        };
    }

    /**
     * Valider une longitude/latitude
     */
    validateCoordinates() {
        return (req, res, next) => {
            const { lat, lng, latitude, longitude } = req.body;

            const checkLat = (val) => {
                if (val === undefined) return true;
                const num = parseFloat(val);
                return !isNaN(num) && num >= -90 && num <= 90;
            };

            const checkLng = (val) => {
                if (val === undefined) return true;
                const num = parseFloat(val);
                return !isNaN(num) && num >= -180 && num <= 180;
            };

            if (!checkLat(lat) || !checkLat(latitude)) {
                throw new ValidationError('Latitude invalide (doit être entre -90 et 90)');
            }

            if (!checkLng(lng) || !checkLng(longitude)) {
                throw new ValidationError('Longitude invalide (doit être entre -180 et 180)');
            }

            next();
        };
    }

    /**
     * Valider un intervalle de prix
     */
    validatePriceRange() {
        return (req, res, next) => {
            const { prix_min, prix_max } = req.body;

            if (prix_min !== undefined && prix_max !== undefined) {
                if (parseFloat(prix_min) > parseFloat(prix_max)) {
                    throw new ValidationError('Le prix minimum ne peut pas être supérieur au prix maximum');
                }
            }

            next();
        };
    }

    /**
     * Valider une requête paginée
     */
    validatePagination() {
        return (req, res, next) => {
            const { page, limit } = req.query;

            if (page && (isNaN(parseInt(page)) || parseInt(page) < 1)) {
                throw new ValidationError('Le paramètre page doit être un nombre positif');
            }

            if (limit && (isNaN(parseInt(limit)) || parseInt(limit) < 1 || parseInt(limit) > 100)) {
                throw new ValidationError('Le paramètre limit doit être entre 1 et 100');
            }

            next();
        };
    }
}

module.exports = new ValidationMiddleware();