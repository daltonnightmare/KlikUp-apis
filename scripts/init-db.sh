#!/bin/bash
set -e

# Attente que PostgreSQL soit prêt
until psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\q'; do
  >&2 echo "PostgreSQL n'est pas encore prêt - attente..."
  sleep 1
done

>&2 echo "PostgreSQL est prêt - initialisation des extensions..."

# Activation des extensions PostgreSQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "postgis";
    CREATE EXTENSION IF NOT EXISTS "postgis_topology";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    CREATE EXTENSION IF NOT EXISTS "btree_gin";
    CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
EOSQL

>&2 echo "Extensions créées avec succès"

# Vérification de l'installation de PostGIS
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT postgis_full_version();
EOSQL

>&2 echo "Initialisation terminée avec succès"