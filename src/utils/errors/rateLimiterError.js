// src/utils/errors.js

/**
 * Classe de base pour les erreurs personnalisées
 */
class AppError extends Error {
    constructor(message, statusCode, code = null) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode || 500;
        this.code = code || 'INTERNAL_ERROR';
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Erreur de validation (400)
 */
class ValidationError extends AppError {
    constructor(message, errors = null) {
        super(message || 'Erreur de validation', 400, 'VALIDATION_ERROR');
        this.errors = errors;
    }
}

/**
 * Erreur d'authentification (401)
 */
class AuthenticationError extends AppError {
    constructor(message = 'Non authentifié') {
        super(message, 401, 'AUTHENTICATION_ERROR');
    }
}

/**
 * Erreur de permission (403)
 */
class AuthorizationError extends AppError {
    constructor(message = 'Accès non autorisé') {
        super(message, 403, 'AUTHORIZATION_ERROR');
    }
}

/**
 * Ressource non trouvée (404)
 */
class NotFoundError extends AppError {
    constructor(resource = 'Ressource') {
        super(`${resource} non trouvé(e)`, 404, 'NOT_FOUND_ERROR');
    }
}

/**
 * Conflit (409)
 */
class ConflictError extends AppError {
    constructor(message = 'Conflit avec les données existantes') {
        super(message, 409, 'CONFLICT_ERROR');
    }
}

/**
 * Rate limit dépassé (429)
 */
class RateLimitError extends AppError {
    constructor(message = 'Trop de requêtes, veuillez réessayer plus tard') {
        super(message, 429, 'RATE_LIMIT_ERROR');
    }
}

/**
 * Erreur de base de données
 */
class DatabaseError extends AppError {
    constructor(message = 'Erreur de base de données', originalError = null) {
        super(message, 500, 'DATABASE_ERROR');
        this.originalError = originalError;
    }
}

/**
 * Erreur de service externe
 */
class ExternalServiceError extends AppError {
    constructor(service, message = 'Erreur de service externe') {
        super(message, 502, 'EXTERNAL_SERVICE_ERROR');
        this.service = service;
    }
}

/**
 * Erreur de fichier (upload, etc.)
 */
class FileError extends AppError {
    constructor(message = 'Erreur de traitement de fichier', code = 'FILE_ERROR') {
        super(message, 400, code);
    }
}

/**
 * Erreur métier (règles de gestion)
 */
class BusinessError extends AppError {
    constructor(message = 'Opération non autorisée par les règles de gestion') {
        super(message, 400, 'BUSINESS_ERROR');
    }
}

module.exports = {
    AppError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ConflictError,
    RateLimitError,
    DatabaseError,
    ExternalServiceError,
    FileError,
    BusinessError
};