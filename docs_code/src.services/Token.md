# À quoi servent les tokens ?

Les tokens sont des éléments fondamentaux de la sécurité et du fonctionnement des applications modernes. Voici une explication complète de leur utilité, adaptée à tous les niveaux.

## 1. Introduction Simple (pour les novices)

Imaginez un token comme un **badge d'accès temporaire** ou un **ticket de cinéma**.

- Quand vous allez au cinéma, vous achetez un ticket. Ce ticket vous donne accès à la salle pour une séance spécifique, pendant une durée limitée.
- Vous n'avez pas besoin de montrer votre pièce d'identité à chaque fois que vous entrez dans la salle. Le ticket suffit.
- Une fois le film terminé, le ticket n'est plus valable.

Dans le monde numérique, un **token** fonctionne exactement de la même manière :
- Il prouve que vous êtes bien celui que vous prétendez être (authentification).
- Il vous donne accès à certaines fonctionnalités ou ressources (autorisation).
- Il a une durée de vie limitée pour des raisons de sécurité.

## 2. Les Différents Types de Tokens et Leurs Usages

### 2.1. Tokens d'Authentification (JWT - JSON Web Tokens)

Ce sont les plus courants. Ils permettent à un utilisateur de rester connecté sans envoyer son mot de passe à chaque requête.

**Fonctionnement :**
1. L'utilisateur se connecte avec son email/mot de passe.
2. Le serveur vérifie les identifiants et génère un token JWT.
3. Ce token est envoyé au client (navigateur, application mobile).
4. Pour chaque requête suivante, le client envoie ce token.
5. Le serveur vérifie le token et sait instantanément qui est l'utilisateur et ce qu'il a le droit de faire.

**Structure d'un JWT :**
Un JWT est composé de trois parties séparées par des points :
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIzLCJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJyb2xlIjoiQ0xJRU5UIiwiZXhwIjoxNjg1MTIzNDU2fQ.s9H5l4qX5kYnZx8c7v2bL9pKq3sT6nM1rW0yX4dFgE
```

1. **En-tête (Header)** : Type de token et algorithme de signature.
2. **Payload** : Les données (claims) comme l'ID utilisateur, l'email, le rôle, la date d'expiration.
3. **Signature** : Vérifie que le token n'a pas été modifié.

### 2.2. Tokens d'Accès (Access Tokens)

- **Durée de vie** : Courte (15 minutes à 24 heures).
- **Usage** : Inclus dans chaque requête API pour authentifier l'utilisateur.
- **Risque** : S'ils sont volés, l'attaquant peut agir comme l'utilisateur, mais seulement pour une durée limitée.

### 2.3. Tokens de Rafraîchissement (Refresh Tokens)

- **Durée de vie** : Longue (7 jours à plusieurs mois).
- **Usage** : Stocké de façon sécurisée (côté client), utilisé uniquement pour obtenir un nouveau token d'accès quand l'ancien expire.
- **Sécurité** : Souvent stocké en base de données (version hashée) et peut être révoqué individuellement.

### 2.4. Codes OTP (One-Time Password)

- **Durée de vie** : Très courte (5-15 minutes).
- **Usage** : Codes à usage unique envoyés par SMS ou email pour la double authentification (2FA) ou la vérification de numéro de téléphone.
- **Exemple** : "Votre code de vérification est : 123456"

### 2.5. Tokens de Réinitialisation de Mot de Passe

- **Durée de vie** : Courte (1-24 heures).
- **Usage** : Inclus dans un lien envoyé par email. Permet à l'utilisateur de changer son mot de passe sans être connecté.
- **Sécurité** : Généré aléatoirement, stocké en base (hashé), et invalidé après utilisation.

### 2.6. Tokens CSRF (Cross-Site Request Forgery)

- **Usage** : Protège contre les attaques où un site malveillant tente d'effectuer des actions au nom d'un utilisateur connecté.
- **Fonctionnement** : Un token unique est inclus dans chaque formulaire et vérifié par le serveur.

### 2.7. Tokens d'Invitation

- **Usage** : Permet à un nouvel utilisateur de rejoindre une équipe, un espace de travail, ou de bénéficier d'un accès spécial.
- **Exemple** : Lien d'invitation à une organisation sur Slack ou GitHub.

## 3. Pourquoi Utiliser des Tokens ?

### 3.1. Avantages par Rapport aux Sessions Traditionnelles

| Aspect | Sessions (cookies) | Tokens (JWT) |
|--------|-------------------|--------------|
| **Stockage** | Côté serveur (mémoire, base de données) | Côté client (stocké par l'application) |
| **Scalabilité** | Problématique (nécessite un stockage partagé) | Excellente (le serveur n'a pas besoin de stocker l'état) |
| **Apps mobiles** | Difficile à gérer | Naturellement adapté |
| **API / Microservices** | Complexe | Idéal (le token contient tout) |
| **Performance** | Requête base de données à chaque appel | Vérification locale (signature) |

### 3.2. Cas d'Usage Concrets

**Dans l'application ProjetBus/KlikUp :**

1. **Authentification utilisateur** :
   - Connexion → Génération d'un **access token** et d'un **refresh token**.
   - L'access token est inclus dans chaque requête API.
   - Quand il expire, le refresh token permet d'en obtenir un nouveau sans reconnexion.

2. **Vérification en deux étapes** :
   - Un **code OTP** est envoyé par SMS.
   - L'utilisateur saisit ce code pour confirmer son identité.

3. **Sécurité des comptes** :
   - Si un utilisateur change son mot de passe, tous ses **refresh tokens** sont révoqués, le forçant à se reconnecter sur tous ses appareils.

4. **Permissions** :
   - Le token contient le rôle de l'utilisateur (`CLIENT`, `VENDEUR`, `ADMIN`).
   - Le serveur peut vérifier instantanément si l'utilisateur a le droit d'effectuer une action.

## 4. Cycle de Vie d'un Token

```mermaid
graph TD
    A[Connexion] --> B[Génération token pair]
    B --> C[Access token court terme]
    B --> D[Refresh token long terme]
    
    C --> E[Requêtes API avec token]
    E --> F{Token valide ?}
    F -->|Oui| G[Accès autorisé]
    F -->|Non - Expiré| H[Utiliser refresh token]
    
    H --> I[Vérifier refresh token]
    I -->|Valide| J[Générer nouvelle paire]
    I -->|Invalide| K[Forcer reconnexion]
    
    J --> C
    J --> D
    
    L[Déconnexion] --> M[Revoguer refresh token]
    M --> N[Plus de rafraîchissement possible]
```

## 5. Bonnes Pratiques de Sécurité

### 5.1. Pour les Développeurs

- **Utilisez des secrets forts** : Les clés JWT doivent être longues, aléatoires et changées périodiquement.
- **Expiration courte** : Les access tokens doivent expirer rapidement (15-60 minutes).
- **Stockez les refresh tokens de façon sécurisée** : En base de données, hashés (SHA-256), jamais en clair.
- **Implémentez la révocation** : Possibilité de révoquer des tokens individuellement (ex: déconnexion, changement de mot de passe).
- **Rotation des refresh tokens** : Générer un nouveau refresh token à chaque utilisation, et révoquer l'ancien.

### 5.2. Pour les Utilisateurs

- Ne partagez jamais vos tokens (ils sont comme vos mots de passe).
- Déconnectez-vous des appareils que vous n'utilisez plus (cela révoque les tokens).
- Activez la double authentification quand c'est possible.

## 6. Exemples Concrets dans le Code

### 6.1. Génération de Tokens (TokenService)

```javascript
// Après une authentification réussie
const payload = { 
  id: utilisateur.id, 
  email: utilisateur.email,
  role: utilisateur.role 
};

// Générer la paire de tokens
const accessToken = tokenService.generateAccessToken(payload);
const refreshToken = tokenService.generateRefreshToken(payload);

// Stocker le refresh token (hashé) en base
const hashedToken = tokenService.hashToken(refreshToken);
await RefreshTokenModel.create({
  user_id: utilisateur.id,
  token_hash: hashedToken,
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 jours
});

// Envoyer au client
res.json({ accessToken, refreshToken });
```

### 6.2. Vérification de Token (Middleware)

```javascript
const authenticate = async (req, res, next) => {
  try {
    // Extraire le token du header Authorization
    const authHeader = req.headers.authorization;
    const token = tokenService.extractBearerToken(authHeader);
    
    // Vérifier le token
    const userPayload = tokenService.verifyAccessToken(token);
    
    // Ajouter l'utilisateur à la requête
    req.user = userPayload;
    
    next();
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};
```

### 6.3. Code OTP pour 2FA

```javascript
// Générer et envoyer un code
const otpCode = securityService.generateOTP(); // "123456"
await smsService.sendVerificationCode(telephone, otpCode, prenom);

// Stocker le code avec expiration
await CacheService.set(
  `otp:${telephone}`,
  otpCode,
  15 * 60 // 15 minutes en secondes
);

// Vérifier le code saisi par l'utilisateur
const storedCode = await CacheService.get(`otp:${telephone}`);
if (storedCode === codeSaisi) {
  // Code valide
  await CacheService.del(`otp:${telephone}`);
} else {
  // Code invalide
}
```

## 7. Résumé

| Type de Token | Durée de vie | Usage principal | Stockage |
|--------------|--------------|-----------------|----------|
| **Access Token** | Courte (15min-24h) | Authentifier les requêtes API | Côté client (mémoire) |
| **Refresh Token** | Longue (7-30 jours) | Obtenir de nouveaux access tokens | Base de données (hashé) |
| **Code OTP** | Très courte (5-15min) | Double authentification, vérification | Cache (Redis) |
| **Reset Token** | Courte (1-24h) | Réinitialisation de mot de passe | Base de données (hashé) |
| **CSRF Token** | Session | Protéger contre les attaques CSRF | Session ou formulaire |

Les tokens sont essentiels car ils permettent une **authentification sans état (stateless)** , ce qui rend les applications plus **scalables**, plus **sécurisées** et mieux adaptées aux architectures modernes (API, microservices, applications mobiles).



# Clarification : Le rôle du token d'accès (Access Token) vs Token de rafraîchissement (Refresh Token)

Je vois une confusion courante que beaucoup de développeurs ont au début. Laissez-moi clarifier comment cela fonctionne réellement.

## La Vérité : Ce n'est PAS le Refresh Token qui est utilisé pour les requêtes !

**Quand vous faites une requête, c'est l'ACCESS TOKEN qui est décomposé et lu, PAS le refresh token.**

## Schéma du Flux Correct

```
                    REQUÊTE API
                         │
                         ▼
    ┌────────────────────────────────────┐
    │ Header Authorization:               │
    │ Bearer eyJhbGciOiJIUzI1NiIs...     │ ← ACCESS TOKEN
    └────────────────────────────────────┘
                         │
                         ▼
    ┌────────────────────────────────────┐
    │ 1. Token extrait                    │
    │ 2. Vérification signature           │
    │ 3. Décomposition du payload         │
    │ 4. Lecture des infos (id, rôle...)  │
    │ 5. Validation (expiration, etc.)    │
    └────────────────────────────────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Requête autorisée│
                └─────────────────┘
```

## 1. Explication Simple avec une Analogie

Imaginez que vous allez dans un club :

- **Carte d'identité (Access Token)** : Vous la montrez à l'entrée à chaque fois que vous voulez entrer. Le videur la regarde, lit votre nom, vérifie votre âge, et vous laisse passer. Elle expire à la fin de la soirée.

- **Abonnement annuel (Refresh Token)** : Vous le gardez chez vous, dans un coffre. Quand votre carte d'identité expire, vous retournez chez vous, prenez votre abonnement, et allez au guichet pour obtenir une nouvelle carte d'identité.

**Vous ne montrez jamais votre abonnement au videur à l'entrée !**

## 2. Exemple Concret de Requête

### Étape 1 : Connexion (une seule fois)
```javascript
// Après connexion, le serveur renvoie DEUX tokens
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIzLCJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJyb2xlIjoiQ0xJRU5UIiwiZXhwIjoxNjg1MTIzNDU2fQ.s9H5l4qX5kYnZx8c7v2bL9pKq3sT6nM1rW0yX4dFgE",
  
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIzLCJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJyb2xlIjoiQ0xJRU5UIiwiZXhwIjoxNjg1NzI4MjU2fQ.XyZ7mP9qL4kR2tN8vB3cF6gH1jK5nM0rW3yX7dFgE"
}
```

### Étape 2 : Requête normale (avec ACCESS TOKEN)
```javascript
// Le client fait une requête pour obtenir ses commandes
fetch('https://api.klikup.com/commandes', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIzLCJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJyb2xlIjoiQ0xJRU5UIiwiZXhwIjoxNjg1MTIzNDU2fQ.s9H5l4qX5kYnZx8c7v2bL9pKq3sT6nM1rW0yX4dFgE'
    // ↑↑↑ C'est l'ACCESS TOKEN ici ↑↑↑
  }
});
```

### Étape 3 : Côté serveur - Décodage du token
```javascript
// Le middleware d'authentification reçoit la requête
const token = req.headers.authorization.split(' ')[1]; // Récupère l'ACCESS TOKEN

// Le serveur vérifie et décode le token
try {
  // Décodage : le token est décomposé
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  // decoded = {
  //   id: 123,
  //   email: "user@example.com",
  //   role: "CLIENT",
  //   exp: 1685123456,
  //   iat: 1685037056
  // }
  
  // Le serveur peut maintenant lire les informations
  console.log(`Utilisateur ${decoded.email} (rôle: ${decoded.role}) fait une requête`);
  
  // Attacher l'utilisateur à la requête pour les prochaines étapes
  req.user = decoded;
  
  next(); // Continuer vers le contrôleur
} catch (error) {
  res.status(401).json({ message: 'Token invalide' });
}
```

## 3. Quand le Refresh Token intervient-il ?

Le refresh token n'est utilisé que dans un seul cas : **quand l'access token a expiré**.

```javascript
// Scénario : L'access token a expiré (après 24h par exemple)

// 1. Le client tente une requête avec l'ancien access token
fetch('https://api.klikup.com/commandes', {
  headers: { 'Authorization': 'Bearer ancien_token_expire' }
});

// 2. Le serveur répond avec une erreur 401
// Status: 401 Unauthorized
// { "message": "Token expiré, veuillez vous reconnecter" }

// 3. Le client utilise le REFRESH TOKEN pour obtenir un nouvel access token
fetch('https://api.klikup.com/auth/refresh', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIzLCJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJyb2xlIjoiQ0xJRU5UIiwiZXhwIjoxNjg1NzI4MjU2fQ.XyZ7mP9qL4kR2tN8vB3cF6gH1jK5nM0rW3yX7dFgE'
  })
});

// 4. Le serveur vérifie le refresh token et renvoie une nouvelle paire
{
  "accessToken": "nouveau_token_eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "nouveau_refresh_eyJhbGciOiJIUzI1NiIs..."
}

// 5. Le client peut maintenant réessayer sa requête avec le nouveau token
```

## 4. Visualisation des Données dans les Tokens

### Access Token (utilisé pour les requêtes)
```javascript
// Après décodage, on voit :
{
  "id": 123,                 // ← Utilisé pour identifier l'utilisateur
  "email": "user@example.com", // ← Utilisé pour afficher des infos
  "role": "CLIENT",           // ← Utilisé pour les permissions
  "exp": 1685123456,          // ← Date d'expiration
  "iat": 1685037056            // ← Date d'émission
}
```

### Refresh Token (gardé pour le rafraîchissement)
```javascript
{
  "id": 123,                 // ← Contient aussi l'ID (pour savoir qui demande un nouveau token)
  "exp": 1685728256,          // ← Expiration plus lointaine (7 jours)
  "iat": 1685037056,
  "tokenType": "refresh"      // ← Parfois pour distinguer le type
}
```

## 5. Pourquoi cette séparation ?

### Access Token (court terme)
- **Validé à chaque requête**
- Contient toutes les infos nécessaires
- S'il est volé, l'attaquant ne peut l'utiliser que peu de temps
- Pas de vérification en base de données (plus rapide)

### Refresh Token (long terme)
- **Utilisé RAREMENT** (quand l'access token expire)
- Vérification en base de données possible (révocation)
- S'il est volé, l'utilisateur peut le révoquer
- Stocké plus sécurisé (httpOnly cookie)

## 6. Dans votre code : La bonne pratique

```javascript
// TokenService.js - Vérification des tokens
class TokenService {
  // Pour les REQUÊTES NORMALES - on utilise l'access token
  verifyAccessToken(token) {
    try {
      // DÉCOMPOSITION ET LECTURE ici
      return jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      throw new AuthenticationError('Token invalide ou expiré');
    }
  }
  
  // Pour le RAFRAÎCHISSEMENT - on utilise le refresh token
  verifyRefreshToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
      throw new AuthenticationError('Refresh token invalide');
    }
  }
  
  // Méthode pour obtenir un nouvel access token
  refreshAccessToken(refreshToken) {
    // 1. Vérifier le refresh token
    const decoded = this.verifyRefreshToken(refreshToken);
    
    // 2. Vérifier en base qu'il n'est pas révoqué
    // ... (vérification avec la BD)
    
    // 3. Générer un NOUVEL access token
    const newAccessToken = this.generateAccessToken({
      id: decoded.id,
      email: decoded.email,
      role: decoded.role
    });
    
    return newAccessToken;
  }
}
```

## Résumé

| Token | Quand l'utilise-t-on ? | Que contient-il ? | Où est-il stocké ? |
|-------|------------------------|-------------------|---------------------|
| **Access Token** | **À CHAQUE REQUÊTE API** | ID, email, rôle, permissions | Mémoire du client (variable JS) |
| **Refresh Token** | UNIQUEMENT pour obtenir un nouvel access token | ID utilisateur, date d'expiration | Cookie httpOnly ou stockage sécurisé |

**Donc pour répondre directement à votre question :**
> "Quand je fais une requête, le token est décomposé et je lis les informations depuis le refresh token ?"

**NON. Quand vous faites une requête, c'est l'ACCESS TOKEN qui est décomposé et lu. Le refresh token reste "dormant" jusqu'à ce que l'access token expire.**