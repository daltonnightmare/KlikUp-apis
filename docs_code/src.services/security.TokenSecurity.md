
---

# Documentation Complète du Service de Tokens (`TokenService`)

## 1. Présentation Générale

Le `TokenService` est un module spécialisé dans la gestion des tokens d'authentification et des codes de vérification. Il fait partie intégrante de la couche sécurité de l'application et se concentre exclusivement sur la création, la validation et la manipulation des différents types de tokens utilisés dans le système.

**Rôle principal :** Fournir une interface unifiée et sécurisée pour la génération et la vérification des access tokens JWT, refresh tokens, codes OTP et tokens aléatoires sécurisés.

## 2. Architecture et Conception

- **Pattern Singleton :** Comme les autres services, il est exporté en tant qu'instance unique (`module.exports = new TokenService();`), garantissant une configuration cohérente dans toute l'application.
- **Séparation des Responsabilités :** Ce service est plus spécialisé que le `SecurityService` général. Il se concentre uniquement sur les aspects liés aux tokens, ce qui respecte le principe de responsabilité unique (SOLID).
- **Gestion d'Erreurs Spécifique :** Il utilise une classe d'erreur personnalisée `AuthenticationError` pour des messages d'erreur clairs et une gestion appropriée dans les couches supérieures.
- **Configuration Centralisée :** Les clés secrètes et durées de validité sont chargées depuis un module de configuration (`env`), facilitant la gestion des environnements.

## 3. Guide pour les Novices (Débutants)

Cette section explique comment utiliser le service simplement, sans entrer dans les détails techniques.

### 3.1. Comment l'utiliser ?

Le service est déjà instancié et prêt à être utilisé partout dans l'application.

```javascript
// Exemple dans un contrôleur d'authentification
const tokenService = require('./src/services/security/TokenService');

// ... plus tard, après une authentification réussie
const accessToken = tokenService.generateAccessToken({ 
  id: utilisateur.id, 
  email: utilisateur.email,
  role: utilisateur.role 
});
```

### 3.2. Les Méthodes Simplifiées pour les Tâches Courantes

#### Génération de Tokens

- **`generateAccessToken(payload)`** : Crée un token JWT d'accès à courte durée de vie (généralement 24h). Le `payload` est un objet contenant les informations essentielles de l'utilisateur (id, email, rôle).
- **`generateRefreshToken(payload)`** : Crée un token JWT de rafraîchissement à longue durée de vie (généralement 7 jours). Utilisé pour obtenir de nouveaux access tokens sans reconnexion.
- **`generateOtpCode()`** : Génère un code numérique à 6 chiffres, parfait pour l'authentification à deux facteurs (2FA) ou la vérification d'email/téléphone.
- **`generateSecureToken(bytes = 32)`** : Génère une chaîne aléatoire sécurisée (hexadécimale). Idéal pour les liens de réinitialisation de mot de passe ou les jetons d'invitation.

#### Vérification et Utilisation des Tokens

- **`verifyAccessToken(token)`** : Vérifie qu'un access token est valide, non expiré et correctement signé. Retourne le `payload` décodé si tout est OK, ou lance une erreur `AuthenticationError` explicite.
- **`verifyRefreshToken(token)`** : Même chose pour un refresh token.
- **`extractBearerToken(authHeader)`** : Extrait le token depuis un header HTTP `Authorization` standard au format `Bearer <token>`.
- **`refreshAccessToken(refreshToken)`** : Prend un refresh token valide et génère un nouvel access token. Retourne un objet contenant le nouveau token et sa durée d'expiration.

#### Utilitaires

- **`hashToken(token)`** : Applique un hachage SHA-256 à un token. À utiliser avant de stocker un token (comme un refresh token) en base de données, pour ne jamais stocker le token en clair.
- **`getOtpExpiration(minutes = 15)`** : Calcule la date d'expiration d'un code OTP, par défaut 15 minutes dans le futur.

### 3.3. Exemple Concret : Cycle de Vie Complet des Tokens

```javascript
// 1. À la connexion, générer la paire de tokens
const payload = { id: 123, email: 'user@example.com', role: 'CLIENT' };
const accessToken = tokenService.generateAccessToken(payload);
const refreshToken = tokenService.generateRefreshToken(payload);

// Stocker le refresh token en base (version hashée)
const hashedRefreshToken = tokenService.hashToken(refreshToken);
await RefreshTokenModel.create({ 
  user_id: 123, 
  token_hash: hashedRefreshToken, 
  expires_at: tokenService.getOtpExpiration(7 * 24 * 60) // 7 jours
});

// Envoyer les tokens au client
res.json({ accessToken, refreshToken });

// 2. Le client utilise l'access token pour les requêtes (dans le header)
// Authorization: Bearer <accessToken>

// 3. Dans un middleware d'authentification
const authHeader = req.headers.authorization;
try {
  const token = tokenService.extractBearerToken(authHeader);
  const userPayload = tokenService.verifyAccessToken(token);
  req.user = userPayload; // Stocker l'utilisateur dans la requête
  next();
} catch (error) {
  res.status(401).json({ message: error.message });
}

// 4. Quand l'access token expire, le client utilise le refresh token
app.post('/refresh-token', (req, res) => {
  const { refreshToken } = req.body;
  try {
    const newTokens = tokenService.refreshAccessToken(refreshToken);
    res.json(newTokens);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
});

// 5. Pour un reset de mot de passe
const resetToken = tokenService.generateSecureToken();
const hashedResetToken = tokenService.hashToken(resetToken);
// Stocker hashedResetToken en base avec une expiration
const expiresAt = tokenService.getOtpExpiration(60); // 1 heure

// Envoyer le lien au client (avec le token en clair)
// https://example.com/reset-password?token=abc123def456...
```

## 4. Guide pour les Professionnels (Développeurs)

Cette section détaille le fonctionnement interne, la configuration avancée et les possibilités d'extension.

### 4.1. Configuration et Dépendances

Le service s'appuie sur des variables d'environnement chargées via le module `env`.

- **Variables d'Environnement Critiques :**
    - `JWT_SECRET` : Clé secrète pour signer les access tokens. **Doit être longue, aléatoire et gardée secrète.**
    - `JWT_REFRESH_SECRET` : Clé secrète pour signer les refresh tokens. **Doit être différente de `JWT_SECRET`.** En cas de compromission de l'une, l'autre reste valide.
    - `JWT_EXPIRES_IN` : Durée de validité des access tokens (format [zeit/ms](https://github.com/vercel/ms), ex: '15m', '24h', '7d').
    - `JWT_REFRESH_EXPIRES_IN` : Durée de validité des refresh tokens.
    - `NODE_ENV` : Utilisé pour le débogage.

- **Dépendances Principales :**
    - `jsonwebtoken` : Bibliothèque standard pour la création et la vérification des JWT.
    - `crypto` : Module natif de Node.js pour les opérations cryptographiques sécurisées.

- **Log de Débogage :** Le constructeur affiche un résumé de la configuration chargée, ce qui est extrêmement utile pour diagnostiquer les problèmes de déploiement.

### 4.2. Fonctionnement Interne des Mécanismes Clés

#### Génération des JWT (`generateAccessToken`, `generateRefreshToken`)

Les deux méthodes sont symétriques mais utilisent des secrets différents. Les options standard sont appliquées :
- **`expiresIn`** : Définit la durée de vie du token.
- **`issuer: 'KlikUp-api'`** : Identifie l'émetteur du token. Cette information est vérifiée lors du décodage, ajoutant une couche de sécurité supplémentaire contre l'utilisation de tokens émis par d'autres services.

#### Vérification Robuste (`verifyAccessToken`, `verifyRefreshToken`)

La gestion d'erreurs est fine et informative :
- **`TokenExpiredError`** : Capture spécifiquement les tokens expirés et lance une `AuthenticationError` avec un message clair.
- **`JsonWebTokenError`** : Capture les tokens malformés, signés avec le mauvais secret, ou ayant un issuer incorrect.
- **Toute autre erreur** est enveloppée dans une `AuthenticationError` générique.

Cette granularité permet aux couches supérieures (middlewares, contrôleurs) de réagir différemment selon le type d'erreur (ex: proposer un refresh token uniquement en cas d'expiration).

#### Refresh Token avec Rotation (`refreshAccessToken`)

La méthode `refreshAccessToken` implémente le pattern de **refresh token rotation** :
1.  Elle vérifie d'abord le refresh token fourni.
2.  Elle extrait les informations essentielles de l'utilisateur depuis le payload décodé.
3.  Elle génère un **nouvel** access token avec ces informations.
4.  Elle retourne le nouveau token et sa durée d'expiration.

**Note importante :** Cette méthode ne révoque pas l'ancien refresh token. Dans une implémentation plus sécurisée, après avoir utilisé un refresh token pour obtenir un nouvel access token, l'ancien refresh token devrait être révoqué et un nouveau refresh token devrait également être généré et renvoyé. C'est ce qu'on appelle la "rotation complète des refresh tokens".

#### Stockage Sécurisé des Tokens (`hashToken`)

La méthode `hashToken(token)` applique un hachage SHA-256. C'est une **pratique de sécurité essentielle** pour tous les tokens qui doivent être stockés en base de données (refresh tokens, tokens de réinitialisation). Cela signifie que même si la base de données est compromise, l'attaquant n'aura accès qu'à des hashs, pas aux tokens eux-mêmes, empêchant ainsi leur utilisation.

#### Génération de Nombres Aléatoires Sécurisés

- **`generateSecureToken`** utilise `crypto.randomBytes()`, qui est un générateur de nombres aléatoires cryptographiquement sécurisé (CSPRNG). Il est adapté à la génération de secrets.
- **`generateOtpCode`** utilise `Math.random()`, ce qui est acceptable pour des OTP à courte durée de vie, mais pour une sécurité maximale, on pourrait utiliser `crypto.randomInt(100000, 999999).toString()`.

### 4.3. Extension et Personnalisation

#### Ajouter un Nouveau Type de Token

Si vous avez besoin d'un token spécifique (ex: token d'invitation à une équipe), vous pouvez ajouter une méthode dédiée :

```javascript
/**
 * Génère un token d'invitation pour une équipe
 */
generateTeamInviteToken(teamId, inviterId, email) {
  const payload = {
    teamId,
    inviterId,
    email,
    type: 'team_invite'
  };
  
  return this.generateSecureToken(); // Ou un JWT si vous avez besoin d'expiration
}
```

#### Implémentation Complète de la Rotation des Refresh Tokens

Pour améliorer la sécurité, modifiez la méthode `refreshAccessToken` :

```javascript
async refreshAccessToken(refreshToken) {
  try {
    // 1. Vérifier le refresh token
    const decoded = this.verifyRefreshToken(refreshToken);
    
    // 2. Vérifier en base que ce refresh token existe et n'est pas révoqué
    const storedToken = await RefreshTokenModel.findOne({ 
      where: { 
        user_id: decoded.id, 
        token_hash: this.hashToken(refreshToken),
        is_revoked: false 
      } 
    });
    
    if (!storedToken) {
      throw new AuthenticationError('Refresh token introuvable ou révoqué');
    }
    
    // 3. Révoquer l'ancien refresh token
    await storedToken.update({ is_revoked: true });
    
    // 4. Créer un nouveau payload
    const payload = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role
    };
    
    // 5. Générer une NOUVELLE paire de tokens
    const newAccessToken = this.generateAccessToken(payload);
    const newRefreshToken = this.generateRefreshToken(payload);
    
    // 6. Stocker le nouveau refresh token (hashé) en base
    const hashedNewRefreshToken = this.hashToken(newRefreshToken);
    const expiresAt = this.getOtpExpiration(7 * 24 * 60);
    await RefreshTokenModel.create({
      user_id: decoded.id,
      token_hash: hashedNewRefreshToken,
      expires_at: expiresAt
    });
    
    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: env.JWT_EXPIRES_IN || '24h'
    };
  } catch (error) {
    throw new AuthenticationError('Impossible de rafraîchir le token: ' + error.message);
  }
}
```

#### Amélioration de la Sécurité des OTP

Pour renforcer la génération des OTP :

```javascript
generateOtpCode() {
  // Utiliser crypto.randomInt pour un meilleur caractère aléatoire
  return crypto.randomInt(100000, 999999).toString();
}
```

### 4.4. Tests et Validation

#### Tests Unitaires Essentiels

```javascript
// tests/unit/tokenService.test.js
const jwt = require('jsonwebtoken');
const tokenService = require('../../src/services/security/TokenService');
const { AuthenticationError } = require('../../src/utils/errors/AppError');

describe('TokenService', () => {
  const mockPayload = { id: 1, email: 'test@test.com', role: 'USER' };
  
  describe('generateAccessToken', () => {
    it('should generate a valid JWT', () => {
      const token = tokenService.generateAccessToken(mockPayload);
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      expect(decoded.id).toBe(mockPayload.id);
      expect(decoded.email).toBe(mockPayload.email);
      expect(decoded.iss).toBe('KlikUp-api');
    });
  });

  describe('verifyAccessToken', () => {
    it('should throw AuthenticationError for expired token', () => {
      const expiredToken = jwt.sign(mockPayload, process.env.JWT_SECRET, { expiresIn: '0s' });
      expect(() => tokenService.verifyAccessToken(expiredToken))
        .toThrow(AuthenticationError);
    });

    it('should throw AuthenticationError for invalid signature', () => {
      const invalidToken = jwt.sign(mockPayload, 'wrong-secret');
      expect(() => tokenService.verifyAccessToken(invalidToken))
        .toThrow(AuthenticationError);
    });
  });

  describe('hashToken', () => {
    it('should produce a consistent SHA-256 hash', () => {
      const token = 'test-token';
      const hash1 = tokenService.hashToken(token);
      const hash2 = tokenService.hashToken(token);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 fait 64 caractères hex
    });
  });

  describe('refreshAccessToken', () => {
    it('should generate a new access token from valid refresh token', () => {
      const refreshToken = tokenService.generateRefreshToken(mockPayload);
      const result = tokenService.refreshAccessToken(refreshToken);
      
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('expiresIn');
      
      // Vérifier que le nouveau token est valide
      const decoded = tokenService.verifyAccessToken(result.accessToken);
      expect(decoded.id).toBe(mockPayload.id);
    });
  });
});
```

### 4.5. Considérations de Sécurité Avancées

#### Rotation des Secrets JWT

Pour permettre une rotation des secrets sans interruption de service, on pourrait modifier la vérification pour accepter plusieurs secrets :

```javascript
verifyAccessToken(token) {
  const secrets = [env.JWT_SECRET, env.JWT_SECRET_OLD].filter(Boolean);
  
  for (const secret of secrets) {
    try {
      return jwt.verify(token, secret, { issuer: 'KlikUp-api' });
    } catch (err) {
      // Ignorer et essayer le secret suivant
    }
  }
  
  // Si aucun secret n'a fonctionné
  throw new AuthenticationError('Token invalide');
}
```

#### Protection contre les Attaques par Rejeu

Pour les tokens sensibles (comme les reset password), incluez toujours un identifiant unique (nonce) ou un timestamp que vous vérifiez en base de données.

#### Politique d'Expiration

- **Access tokens** : Durée courte (15 minutes à 24 heures) pour limiter l'impact en cas de vol.
- **Refresh tokens** : Durée plus longue (7 à 30 jours) mais avec révocation possible.
- **Reset password tokens** : Durée très courte (1 heure maximum).

#### Stockage Côté Client

Ce service ne gère pas le stockage, mais il est crucial de documenter que :
- Les access tokens doivent être stockés en mémoire (pas dans localStorage ou sessionStorage si possible).
- Les refresh tokens doivent être stockés dans des cookies httpOnly et secure pour les applications web.

---