// utils/errors.js

// Classe d'erreur personnalisée
class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

// Erreur 400 - Requête incorrecte
class BadRequestError extends AppError {
    constructor(message = 'Requête incorrecte') {
        super(message, 400);
    }
}

// Erreur 401 - Non authentifié
class UnauthorizedError extends AppError {
    constructor(message = 'Non authentifié') {
        super(message, 401);
    }
}

// Erreur 403 - Accès interdit
class ForbiddenError extends AppError {
    constructor(message = 'Accès interdit') {
        super(message, 403);
    }
}

// Erreur 404 - Non trouvé
class NotFoundError extends AppError {
    constructor(message = 'Ressource non trouvée') {
        super(message, 404);
    }
}

// Erreur 409 - Conflit
class ConflictError extends AppError {
    constructor(message = 'Conflit de données') {
        super(message, 409);
    }
}

// Erreur 422 - Entité non traitable
class ValidationError extends AppError {
    constructor(message = 'Erreur de validation') {
        super(message, 422);
    }
}

// Erreur 500 - Erreur serveur
class InternalServerError extends AppError {
    constructor(message = 'Erreur interne du serveur') {
        super(message, 500);
    }
}

// Erreur d'authentification spécifique
class AuthenticationError extends AppError {
    constructor(message = 'Erreur d\'authentification') {
        super(message, 401);
    }
}
//Authorization Error
class AuthorizationError extends AppError {
    constructor(message = 'Erreur d\'autorisation') {
        super(message, 403);
    };
}
// Gestionnaire d'erreurs asynchrone
const catchAsync = (fn) => {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
};

// Middleware de gestion des erreurs
const errorHandler = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    if (process.env.NODE_ENV === 'development') {
        res.status(err.statusCode).json({
            status: err.status,
            error: err,
            message: err.message,
            stack: err.stack
        });
    } else {
        // Production : ne pas envoyer les détails de l'erreur
        if (err.isOperational) {
            res.status(err.statusCode).json({
                status: err.status,
                message: err.message
            });
        } else {
            console.error('ERREUR 💥', err);
            res.status(500).json({
                status: 'error',
                message: 'Quelque chose a mal tourné'
            });
        }
    }
};

module.exports = {
    AppError,
    AuthenticationError,
    BadRequestError,
    UnauthorizedError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    ValidationError,
    InternalServerError,
    AuthorizationError,
    catchAsync,
    errorHandler
};