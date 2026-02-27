

---

# Documentation Complète du Service de Sécurité (`SecurityService`)

## 1. Présentation Générale

Le `SecurityService` est un module central et critique de l'application backend. Il agit comme un chef d'orchestre de la sécurité, centralisant toutes les fonctionnalités liées à l'authentification, l'autorisation, la protection des données et la détection d'intrusions.

**Rôle principal :** Protéger l'application et ses utilisateurs en fournissant des mécanismes robustes pour la gestion des mots de passe, des tokens, du chiffrement, de la validation des entrées, et de la surveillance des activités suspectes.

## 2. Architecture et Conception

- **Pattern Singleton :** La classe est exportée en tant qu'instance unique (`module.exports = new SecurityService();`). Cela garantit que les clés de sécurité et la logique de chiffrement sont partagées de manière cohérente dans toute l'application.
- **Couche de Sécurité Centralisée :** Toutes les opérations sensibles (hash, chiffrement, génération de token) passent par ce service, ce qui assure une implémentation uniforme et facilite la maintenance et les audits de sécurité.
- **Intégration avec d'Autres Services :** Il collabore étroitement avec les modèles de données (`CompteModel`, `SessionModel`, etc.), le `CacheService` (pour le rate-limiting), le `NotificationService` (pour alerter les utilisateurs) et l'`AuditService` (pour la traçabilité).
- **Détection d'Intrusion :** Il intègre une logique proactive pour détecter et répondre aux attaques par force brute, en bloquant temporairement les comptes et en générant des alertes de sécurité.

## 3. Guide pour les Novices (Débutants)

Cette section explique comment utiliser le service simplement, sans entrer dans les détails techniques.

### 3.1. Comment l'utiliser ?

Comme pour le service d'email, vous n'avez pas besoin de créer une instance. Il est déjà prêt à être utilisé partout dans l'application.

```javascript
// Exemple dans un contrôleur d'authentification
const securityService = require('./services/security/SecurityService');

// ... plus tard, pour hasher un mot de passe avant de le sauvegarder
const hashedPassword = await securityService.hashPassword(motDePasseEnClair);
```

### 3.2. Les Méthodes Simplifiées pour les Tâches Courantes

Voici les méthodes que vous utiliserez le plus souvent dans votre code métier.

#### Authentification et Gestion des Tokens

- **`hashPassword(password)`** : Transforme un mot de passe en clair en une chaîne hachée sécurisée. À utiliser **toujours** avant de sauvegarder un mot de passe en base de données.
- **`verifyPassword(password, hash)`** : Compare un mot de passe en clair fourni par l'utilisateur avec le hash stocké en base de données. Retourne `true` ou `false`.
- **`generateToken(payload)`** : Crée un token JWT (JSON Web Token) contenant les informations de l'utilisateur (ex: `{ id: 1, email: '...' }`). Ce token est utilisé pour authentifier les requêtes ultérieures.
- **`verifyToken(token)`** : Vérifie qu'un token JWT est valide et n'a pas expiré. Retourne les informations contenues dans le token (le `payload`) ou `null` si le token est invalide.
- **`generateTokenPair(payload)`** : Génère une paire de tokens : un token d'accès (court terme) et un token de rafraîchissement (long terme) pour une meilleure sécurité.

#### Validation et Sécurité des Données

- **`validatePasswordStrength(password)`** : Vérifie si un mot de passe est suffisamment fort (longueur, majuscules, minuscules, chiffres, caractères spéciaux). Retourne un objet avec un score et un message.
- **`sanitizeInput(input)`** : Nettoie une chaîne de caractères ou un objet pour prévenir les attaques XSS (Cross-Site Scripting). À utiliser **systématiquement** avant d'afficher des données fournies par l'utilisateur.
- **`checkPermission(utilisateurRole, permission)`** : Vérifie si un rôle utilisateur (ex: `CLIENT`, `VENDEUR`) possède une permission spécifique.

#### Double Authentification (2FA)

- **`generate2FASecret(email)`** : Crée un secret unique pour un utilisateur, nécessaire pour configurer une application d'authentification comme Google Authenticator.
- **`generate2FAQRCode(otpauth_url)`** : Génère un QR code à partir de l'URL fournie par `generate2FASecret`. L'utilisateur scanne ce QR code avec son application.
- **`verify2FACode(secret, token)`** : Vérifie le code à 6 chiffres fourni par l'utilisateur via son application d'authentification.

### 3.3. Exemple Concret : Inscription et Connexion

**Lors de l'inscription d'un nouvel utilisateur :**
```javascript
// 1. Nettoyer les entrées (prévention XSS)
const emailPropre = securityService.sanitizeInput(req.body.email);
const nomPropre = securityService.sanitizeInput(req.body.nom);

// 2. Valider la force du mot de passe
const validation = securityService.validatePasswordStrength(req.body.password);
if (!validation.isValid) {
  return res.status(400).json({ message: "Mot de passe trop faible." });
}

// 3. Hasher le mot de passe et le sauvegarder
const hashedPassword = await securityService.hashPassword(req.body.password);
// ... sauvegarder l'utilisateur avec hashedPassword en base de données
```

**Lors de la connexion :**
```javascript
// 1. Vérifier les tentatives de connexion pour cette IP (rate-limiting)
const attemptCheck = await securityService.checkLoginAttempts(req.body.email, req.ip);
if (attemptCheck.blocked) {
  return res.status(429).json({ message: "Trop de tentatives, réessayez plus tard." });
}

// 2. Récupérer l'utilisateur et vérifier son mot de passe
const utilisateur = await CompteModel.findByEmail(req.body.email);
const passwordValid = await securityService.verifyPassword(req.body.password, utilisateur.mot_de_passe);

if (!passwordValid) {
  // 3. Enregistrer l'échec
  await securityService.recordLoginAttempt(req.body.email, req.ip, false);
  return res.status(401).json({ message: "Identifiants invalides." });
}

// 4. Succès : générer les tokens et enregistrer la tentative réussie
const tokens = securityService.generateTokenPair({ id: utilisateur.id, email: utilisateur.email });
await securityService.recordLoginAttempt(req.body.email, req.ip, true);

// 5. (Optionnel) Vérifier le 2FA si activé
if (utilisateur.is2FAEnabled) {
  const codeValide = securityService.verify2FACode(utilisateur.secret2FA, req.body.code2FA);
  if (!codeValide) return res.status(401).json({ message: "Code 2FA invalide." });
}

res.json({ ...tokens, user: utilisateur });
```

## 4. Guide pour les Professionnels (Développeurs)

Cette section détaille le fonctionnement interne, la configuration avancée et les possibilités d'extension.

### 4.1. Configuration et Dépendances

Le service s'appuie sur des variables d'environnement critiques et plusieurs bibliothèques spécialisées.

- **Variables d'Environnement Obligatoires :**
    - `JWT_SECRET` : Clé secrète pour signer les tokens d'accès JWT.
    - `JWT_REFRESH_SECRET` : Clé secrète pour signer les tokens de rafraîchissement. Doit être différente de `JWT_SECRET`.
    - `ENCRYPTION_KEY` : Clé de chiffrement AES-256 (32 bytes) pour les données sensibles.

- **Dépendances Principales :**
    - `bcrypt` : Algorithme de hashage de mots de passe réputé et sécurisé.
    - `jsonwebtoken` : Implémentation des JSON Web Tokens (RFC 7519).
    - `speakeasy` / `qrcode` : Pour la gestion de l'authentification à deux facteurs (TOTP/HOTP).
    - `crypto` : Module natif de Node.js pour les opérations cryptographiques (chiffrement, génération de nombres aléatoires).

### 4.2. Fonctionnement Interne des Mécanismes Clés

#### Gestion des Tokens et Sessions

- **`generateTokenPair(payload)`** : Cette méthode illustre une bonne pratique de sécurité. Elle génère deux tokens :
    - **Access Token** : Courte durée de vie (définie par `Constants.CONFIG.SECURITY.SESSION_DURATION`). Utilisé pour chaque requête API.
    - **Refresh Token** : Longue durée de vie (définie par `Constants.CONFIG.SECURITY.REFRESH_TOKEN_DURATION`). Utilisé uniquement pour obtenir une nouvelle paire de tokens sans que l'utilisateur ait à se réauthentifier.
- **Révocation (`revokeToken`, `TokenRevogueModel`)** : Le service permet de révoquer des tokens (typiquement lors d'une déconnexion). Cela nécessite une table en base de données (`TOKENS_REVOQUES`) pour stocker les tokens jusqu'à leur expiration naturelle.

#### Détection et Prévention des Intrusions

- **Rate-Limiting avec Cache (`checkLoginAttempts`, `recordLoginAttempt`)** :
    1.  À chaque échec de connexion, le compteur pour le couple (email, IP) est incrémenté dans le cache (Redis, via `CacheService`) avec un TTL (Time-To-Live) correspondant à la fenêtre de verrouillage.
    2.  Si le seuil (`MAX_LOGIN_ATTEMPTS`) est atteint, le service indique que l'utilisateur est bloqué.
    3.  En cas de succès, le compteur est réinitialisé.
- **Détection de Force Brute (`detectBruteForce`)** :
    - Si le nombre de tentatives dépasse un second seuil (ex: 10), une alerte de sécurité de niveau `ELEVE` ou `CRITIQUE` est créée via `AlerteSecuriteModel`.
    - Le compte utilisateur peut être automatiquement suspendu (`CompteModel.suspend`) pour une durée déterminée.
    - Une notification est envoyée à l'utilisateur pour l'informer de la tentative d'intrusion.

#### Chiffrement des Données Sensibles

Les méthodes `encrypt` et `decrypt` utilisent l'algorithme **AES-256-GCM**.
- **Pourquoi AES-256-GCM ?** C'est un chiffrement authentifié, ce qui signifie qu'en plus de garantir la confidentialité des données (les rendre illisibles), il garantit également leur intégrité (elles n'ont pas été modifiées). Le tag d'authentification (`authTag`) est utilisé pour cette vérification.
- **Processus :** La méthode `encrypt` génère un vecteur d'initialisation (`iv`) aléatoire pour chaque opération, ce qui est crucial pour la sécurité du chiffrement. Elle retourne un objet contenant l'`iv`, les données chiffrées (`encrypted`) et le `authTag`. Tous ces éléments doivent être stockés ensemble pour pouvoir déchiffrer plus tard.

#### Contrôle d'Accès Basé sur les Ressources

- **`checkResourceAccess`** : Cette méthode implémente un contrôle d'accès plus fin que les simples rôles (RBAC). Elle vérifie si un utilisateur a le droit d'effectuer une action (`action`) sur une ressource spécifique (`ressourceType`, `ressourceId`).
    - **Exemple :** Un utilisateur (ID 123) peut-il modifier la commande (ID 456) ?
    - La méthode délègue ensuite à des vérifications spécifiques (`checkCommandeAccess`) qui consultent la base de données pour voir si l'utilisateur est bien le propriétaire de la commande. C'est un exemple d'implémentation de **PBAC (Policy-Based Access Control)** ou **ReBAC (Resource-Based Access Control)**.

### 4.3. Extension et Personnalisation

#### Ajouter une Nouvelle Vérification de Permission

Si vous introduisez une nouvelle action dans l'application (ex: `EXPORTER_RAPPORT_VENTES`), vous devez :

1.  **Définir la permission** dans le module `Constants` (ex: `Constants.PERMISSIONS.EXPORTER_RAPPORT_VENTES`).
2.  **Associer cette permission aux rôles** dans la configuration des rôles (toujours dans `Constants`).
3.  **Utiliser la méthode `checkPermission`** dans votre contrôleur ou service :

```javascript
if (!securityService.checkPermission(req.user.role, 'EXPORTER_RAPPORT_VENTES')) {
  return res.status(403).json({ message: 'Accès refusé.' });
}
// ... logique d'export
```

#### Ajouter une Nouvelle Règle de Contrôle d'Accès aux Ressources

Pour gérer l'accès à un nouveau type de ressource (ex: `ARTICLE_BLOG`) :

1.  **Ajouter un `case`** dans le `switch` de la méthode `checkResourceAccess`.
2.  **Créer une méthode dédiée** (ex: `checkArticleAccess(utilisateurId, articleId, action)`).
3.  **Dans cette méthode**, implémentez la logique métier. Par exemple, un auteur peut modifier son article, mais un modérateur peut le masquer.

```javascript
case 'ARTICLE_BLOG':
  return this.checkArticleAccess(utilisateurId, ressourceId, action);
```

#### Amélioration de la Politique de Mots de Passe

La méthode `validatePasswordStrength` utilise des critères simples. Vous pouvez la complexifier en :
- **Ajoutant une vérification contre une liste de mots de passe courants** (rockyou.txt).
- **Vérifiant que le mot de passe ne contient pas des parties de l'email ou du nom de l'utilisateur** (en passant ces informations en paramètre).
- **Utilisant une bibliothèque comme `zxcvbn`** pour une évaluation plus sophistiquée basée sur l'estimation de l'entropie.

### 4.4. Tests et Validation

#### Tests Unitaires

- **Mocker les dépendances externes :** `bcrypt`, `jsonwebtoken`, `speakeasy`, et surtout les modèles (`CompteModel`, `CacheService`) doivent être mockés pour isoler les tests du service.
- **Tester la logique métier :**
    - Vérifier que `hashPassword` appelle bien `bcrypt.hash`.
    - Vérifier que `validatePasswordStrength` retourne le bon score pour différents mots de passe.
    - Vérifier que `recordLoginAttempt` incrémente bien le cache en cas d'échec et le supprime en cas de succès.
- **Tester la détection d'intrusion :** Simuler une série d'échecs et vérifier que `checkLoginAttempts` finit par bloquer et que `detectBruteForce` est appelée.

#### Tests d'Intrusion

- **Injection XSS :** Tester la méthode `sanitizeInput` avec des chaînes contenant `<script>alert('XSS')</script>` et vérifier qu'elles sont correctement encodées.
- **Force Brute :** Utiliser un outil comme `hydra` ou `burp suite` pour tenter de forcer l'authentification et vérifier que le blocage et les alertes fonctionnent.
- **Falsification de Token JWT :** Tenter de modifier un token JWT et vérifier que `verifyToken` retourne `null`.

### 4.5. Considérations de Sécurité Avancées

- **Rotation des Clés :** Les clés (`JWT_SECRET`, `ENCRYPTION_KEY`) doivent être changées périodiquement. Le service devrait idéalement supporter une rotation sans interruption de service (ex: en ayant une clé actuelle et une clé précédente pour la validation).
- **Audit et Traçabilité :** Le service utilise `AlerteSecuriteModel` et `HistoriqueConnexionModel`. C'est essentiel pour la conformité (ex: RGPD, PCI-DSS) et pour les enquêtes post-incident.
- **Protection CSRF :** La méthode `generateCSRFToken` et `validateCSRFToken` sont présentes mais l'implémentation de la validation est laissée vide. Pour une API REST avec authentification par token (JWT), la protection CSRF est moins critique si les tokens ne sont pas stockés dans des cookies. Si des cookies sont utilisés, une implémentation robuste du CSRF est impérative (double soumission de cookie ou SameSite=Strict).
- **Journalisation Sécurisée :** Les événements de sécurité (`logSecurityEvent`) ne doivent jamais contenir d'informations sensibles en clair (mots de passe, tokens).

---