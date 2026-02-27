# Dockerfile
FROM node:18-alpine AS builder

# Installation des dépendances système nécessaires pour PostGIS
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    postgresql-client \
    git

WORKDIR /app

# Copie des fichiers de dépendances
COPY package*.json ./
COPY package-lock.json ./

# Installation des dépendances
RUN npm ci --only=production

# Stage de développement
FROM node:18-alpine AS development

WORKDIR /app

# Installation des outils de développement
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    postgresql-client \
    redis \
    curl \
    bash

# Copie depuis l'étape builder
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Exposition du port
EXPOSE 3000

# Commande de démarrage en développement
CMD ["npm", "run", "dev"]