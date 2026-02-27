# =============================================================================
# ENVIRONNEMENT DE DÉVELOPPEMENT - .env.development
# =============================================================================
# Copiez ce fichier en .env.development, .env.production, .env.test selon besoin
# =============================================================================

# -----------------------------------------------------------------------------
# SERVEUR
# -----------------------------------------------------------------------------
NODE_ENV=development
PORT=3000
HOST=localhost
API_URL=http://localhost:3000
API_PREFIX=/api/v1
FRONTEND_URL=http://localhost:4200

# -----------------------------------------------------------------------------
# BASE DE DONNÉES POSTGRESQL
# -----------------------------------------------------------------------------
DB_HOST=localhost
DB_PORT=5432
DB_NAME=klikup_platforme_dev
DB_USER=postgres
DB_PASSWORD=postgres123
DB_SSL=false

# Pool de connexions
DB_POOL_MAX=20
DB_POOL_MIN=2
DB_IDLE_TIMEOUT=30000
DB_CONNECTION_TIMEOUT=2000
DB_STATEMENT_TIMEOUT=10000
DB_QUERY_TIMEOUT=10000

# -----------------------------------------------------------------------------
# REDIS (Cache & Files d'attente)
# -----------------------------------------------------------------------------
REDIS_URL=redis://localhost:6379
# REDIS_PASSWORD=redis_password_prod  # À décommenter en production
REDIS_PASSWORD=

# -----------------------------------------------------------------------------
# JWT & SÉCURITÉ
# -----------------------------------------------------------------------------
# Clés JWT (32 caractères minimum recommandé)
JWT_SECRET=klikup-dev-secret-key-2026-change-in-production-123456
JWT_REFRESH_SECRET=klikup-dev-refresh-secret-key-2026-change-in-production

# Durées des tokens
JWT_EXPIRES_IN=24h          # Format: 15m, 1h, 7d, 30d
JWT_REFRESH_EXPIRES_IN=7d

# Bcrypt
BCRYPT_ROUNDS=10

# CORS - Séparer par des virgules
CORS_WHITELIST=http://localhost:4200,http://localhost:3000

# Rate Limiting
RATE_LIMIT_WINDOW=900000     # 15 minutes en millisecondes
RATE_LIMIT_MAX=100           # Requêtes max par fenêtre

# 2FA
ENABLE_2FA=true

# -----------------------------------------------------------------------------
# EMAIL (SMTP)
# -----------------------------------------------------------------------------
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=votre.email@gmail.com
SMTP_PASSWORD=votre-mot-de-passe-app
SMTP_FROM=noreply@klikup.com
SMTP_SECURE=false           # true pour port 465

# -----------------------------------------------------------------------------
# SMS (TWILIO)
# -----------------------------------------------------------------------------
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+22670000000

# -----------------------------------------------------------------------------
# PAIEMENTS
# -----------------------------------------------------------------------------
# Orange Money
ORANGE_MONEY_API_KEY=om_dev_key_xxxxx
ORANGE_MONEY_SECRET=om_dev_secret_xxxxx
ORANGE_MONEY_MERCHANT_ID=OM_MERCHANT_001

# Moov Money
MOOV_MONEY_API_KEY=moov_dev_key_xxxxx
MOOV_MONEY_SECRET=moov_dev_secret_xxxxx
MOOV_MONEY_MERCHANT_ID=MOOV_MERCHANT_001

# -----------------------------------------------------------------------------
# STOCKAGE FICHIERS
# -----------------------------------------------------------------------------
STORAGE_DRIVER=local        # local ou s3
UPLOAD_PATH=./uploads
MAX_FILE_SIZE=5242880       # 5MB en bytes
MAX_IMAGE_SIZE=2097152      # 2MB en bytes

# AWS S3 (si STORAGE_DRIVER=s3)
AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXX
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AWS_REGION=eu-west-3        # Paris
AWS_BUCKET=klikup-uploads-dev

# -----------------------------------------------------------------------------
# LOGGING
# -----------------------------------------------------------------------------
LOG_LEVEL=debug             # debug, info, warn, error
LOG_FILE=./logs/app.log
LOG_MAX_SIZE=20m
LOG_MAX_FILES=14d

# -----------------------------------------------------------------------------
# CACHE
# -----------------------------------------------------------------------------
CACHE_TTL=3600              # 1 heure en secondes
CACHE_CHECK_PERIOD=600      # 10 minutes en secondes

# -----------------------------------------------------------------------------
# MONITORING & ADMIN
# -----------------------------------------------------------------------------
MONITORING_TOKEN=monitoring-secret-token-2026-dev
ADMIN_EMAIL=admin@klikup.com
ADMIN_PASSWORD=Admin123!@#

# -----------------------------------------------------------------------------
# FONCTIONNALITÉS
# -----------------------------------------------------------------------------
ENABLE_SIGNUP=true
MAINTENANCE_MODE=false

# -----------------------------------------------------------------------------
# GÉOLOCALISATION
# -----------------------------------------------------------------------------
GEOCODING_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
DEFAULT_LAT=12.3714         # Ouagadougou
DEFAULT_LNG=-1.5197
DEFAULT_COUNTRY=Burkina Faso
DEFAULT_CITY=Ouagadougou

# -----------------------------------------------------------------------------
# POINTS DE FIDÉLITÉ & PARRAINAGE
# -----------------------------------------------------------------------------
FIDELITE_POINTS_PAR_TRANCHE=1
FIDELITE_MONTANT_TRANCHE=1000
FIDELITE_VALEUR_POINT=5

PARRAINAGE_POINTS_PARRAIN=100
PARRAINAGE_POINTS_FILLEUL=50
PARRAINAGE_BONUS_FCFA_PARRAIN=1000
PARRAINAGE_BONUS_FCFA_FILLEUL=500
PARRAINAGE_EXPIRATION_DAYS=90

# -----------------------------------------------------------------------------
# NOTIFICATIONS
# -----------------------------------------------------------------------------
NOTIFICATION_INTERNAL_QUEUE=true
PUSH_NOTIFICATIONS_ENABLED=true
FIREBASE_SERVER_KEY=AAAAxxxxxxxxxx:xxxxxxxxxxxxxxxxxxxx

# -----------------------------------------------------------------------------
# API EXTERNES
# -----------------------------------------------------------------------------
GOOGLE_MAPS_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OPENWEATHER_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# -----------------------------------------------------------------------------
# SÉCURITÉ & AUDIT
# -----------------------------------------------------------------------------
SESSION_DURATION=86400000          # 24h en ms
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_DURATION=900000             # 15 minutes en ms
OTP_LENGTH=6
OTP_DURATION=600000                 # 10 minutes en ms

# -----------------------------------------------------------------------------
# PERFORMANCE
# -----------------------------------------------------------------------------
REQUEST_TIMEOUT=30000               # 30s
UPLOAD_TIMEOUT=60000                # 1 minute
QUERY_TIMEOUT=10000                 # 10s

# -----------------------------------------------------------------------------
# DEV ONLY - Comptes de test
# -----------------------------------------------------------------------------
TEST_USER_EMAIL=test@klikup.com
TEST_USER_PASSWORD=Test123!@#
TEST_ADMIN_EMAIL=admin@klikup.com
TEST_ADMIN_PASSWORD=Admin123!@#

# =============================================================================
# FIN DU FICHIER .env.development
# =============================================================================