

---

# Documentation Complète du Service SMS (`SmsService`)

## 1. Présentation Générale

Le `SmsService` est un module backend responsable de l'envoi de messages SMS transactionnels et promotionnels. Il agit comme une couche d'abstraction au-dessus de différents fournisseurs de services SMS (Twilio, Africa's Talking, etc.), permettant à l'application de communiquer avec les utilisateurs via leur téléphone mobile de manière fiable et flexible.

**Rôle principal :** Envoyer des notifications SMS pour les codes de vérification, les mises à jour de commandes, les alertes de sécurité et les promotions, avec une architecture adaptable à différents fournisseurs.

## 2. Architecture et Conception

- **Pattern Singleton :** La classe est exportée en tant qu'instance unique (`module.exports = new SmsService();`), garantissant une configuration partagée dans toute l'application.
- **Abstraction du Fournisseur :** Le service utilise un pattern "strategy" via la variable `SMS_PROVIDER` pour basculer entre différents fournisseurs sans modifier le code métier.
- **Mode Mock pour le Développement :** Un fournisseur `mock` est disponible pour le développement local, simulant l'envoi de SMS sans coût réel.
- **Formatage Automatique des Numéros :** Le service inclut une logique de normalisation des numéros de téléphone au format international.
- **Intégration avec File d'Attente :** Possibilité de planifier des envois SMS différés via le `FileTacheModel`.

## 3. Guide pour les Novices (Débutants)

Cette section explique comment utiliser le service simplement, sans entrer dans les détails techniques.

### 3.1. Comment l'utiliser ?

Le service est déjà instancié et prêt à être utilisé partout dans l'application.

```javascript
// Exemple dans un contrôleur ou un autre service
const smsService = require('./services/communication/SmsService');

// ... plus tard, envoyer un code de vérification
await smsService.sendVerificationCode('+22670123456', '123456', 'Jean');
```

### 3.2. Les Méthodes Simplifiées pour les Tâches Courantes

Le service propose plusieurs méthodes prêtes à l'emploi pour les cas d'usage les plus fréquents.

- **`sendVerificationCode(to, code, prenom)`** : Envoie un code de vérification à 6 chiffres (2FA, validation de numéro).
- **`sendCommandeNotification(to, commandeRef, statut, prenom)`** : Notifie l'utilisateur du changement de statut de sa commande (confirmée, en livraison, livrée).
- **`sendPromotion(to, offre, codePromo)`** : Envoie une offre promotionnelle, avec ou sans code promo.
- **`sendSecurityAlert(to, type, details)`** : Alerte l'utilisateur en cas d'événement de sécurité (nouvel appareil, changement de mot de passe, compte verrouillé).

### 3.3. Méthode Générique

Pour des besoins spécifiques non couverts par les méthodes dédiées, vous pouvez utiliser la méthode générique :

- **`sendSms(to, message, options)`** : Envoie un message SMS personnalisé. Les `options` peuvent inclure `from` pour spécifier un expéditeur personnalisé.

### 3.4. Exemple Concret

Imaginons qu'un utilisateur vient de s'inscrire et doit confirmer son numéro de téléphone :

```javascript
// Générer un code de vérification
const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

// Envoyer le code par SMS
try {
  const resultat = await smsService.sendVerificationCode(
    utilisateur.telephone,
    verificationCode,
    utilisateur.prenom
  );

  if (resultat.success) {
    console.log(`Code de vérification envoyé à ${utilisateur.telephone}`);
    // Stocker le code en base avec une expiration (par exemple 15 minutes)
    await UtilisateurModel.update(utilisateur.id, {
      code_verification: verificationCode,
      code_expiration: new Date(Date.now() + 15 * 60 * 1000)
    });
  }
} catch (error) {
  console.error("Erreur lors de l'envoi du SMS:", error);
  // Gérer l'erreur (proposer un autre moyen, réessayer plus tard, etc.)
}
```

**Pour une notification de commande :**

```javascript
// Après confirmation d'une commande
await smsService.sendCommandeNotification(
  '70123456', // Le service formatte automatiquement
  'CMD-2024-00123',
  'CONFIRMEE',
  'Marie'
);
// Résultat : "Bonjour Marie, votre commande CMD-2024-00123 a été confirmée..."
```

## 4. Guide pour les Professionnels (Développeurs)

Cette section détaille le fonctionnement interne, la configuration avancée et les possibilités d'extension.

### 4.1. Configuration et Dépendances

Le service est configurable via des variables d'environnement.

- **Variables d'Environnement Clés :**
  - `SMS_PROVIDER` : Le fournisseur SMS à utiliser (`twilio`, `africastalking`, ou `mock` pour le développement). Défaut : `mock`.
  - `SMS_FROM` : Le numéro d'expéditeur par défaut (doit être approuvé par le fournisseur).

- **Configuration Spécifique par Fournisseur (à décommenter dans le code) :**
  - Pour **Twilio** : `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`.
  - Pour **Africa's Talking** : `AT_API_KEY`, `AT_USERNAME`.

### 4.2. Fonctionnement Interne des Mécanismes Clés

#### Initialisation du Fournisseur (`initProvider`)

Cette méthode utilise un `switch` sur `this.provider` pour instancier le client approprié. Actuellement, seuls `mock` est pleinement implémenté, mais la structure est prête pour Twilio et Africa's Talking.

**Pour activer Twilio :**
```javascript
case 'twilio':
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  this.client = require('twilio')(accountSid, authToken);
  break;
```

**Pour activer Africa's Talking :**
```javascript
case 'africastalking':
  const options = {
    apiKey: process.env.AT_API_KEY,
    username: process.env.AT_USERNAME
  };
  this.client = require('africastalking')(options);
  break;
```

#### Formatage des Numéros de Téléphone (`formatPhoneNumber`)

La méthode implémente une logique de normalisation spécifique au Burkina Faso (indicatif +226) :

1. **Nettoyage** : Supprime tous les caractères non numériques (`\D`).
2. **Traitement** :
   - Si le numéro commence par `0` (format local), il remplace le `0` par `226`.
   - Si le numéro ne commence pas par `226`, il ajoute `226` au début.
3. **Format international** : Ajoute le `+` devant le numéro.

**Exemples :**
- `70123456` → `+22670123456`
- `070123456` → `+22670123456`
- `+22670123456` → `+22670123456` (inchangé)

#### Mode Mock pour le Développement

Lorsque `SMS_PROVIDER` est `mock` (ou absent), le service utilise un client factice qui :
- Logge le message dans la console.
- Retourne un objet de réponse simulé avec un `sid` basé sur le timestamp.
- Permet aux développeurs de tester l'intégration sans consommer de crédits SMS réels.

```javascript
// Exemple de sortie console :
📱 [MOCK SMS] {
  to: '+22670123456',
  from: undefined,
  body: 'Bonjour Jean, votre code de vérification est: 123456...'
}
```

#### Gestion des Erreurs

La méthode `sendSms` capture les erreurs du fournisseur, les logge avec `console.error`, et lance une nouvelle erreur avec un message formaté. En production, il serait judicieux d'ajouter une logique de réessai (retry) et une intégration avec un système de surveillance.

### 4.3. Extension et Personnalisation

#### Ajouter un Nouveau Fournisseur SMS

Pour intégrer un nouveau fournisseur (ex: Vonage, Sendinblue, Orange SMS) :

1. **Ajouter la dépendance** : `npm install nom-du-package`.
2. **Modifier `initProvider`** :

```javascript
case 'vonage':
  const { Vonage } = require('@vonage/server-sdk');
  this.client = new Vonage({
    apiKey: process.env.VONAGE_API_KEY,
    apiSecret: process.env.VONAGE_API_SECRET
  });
  break;
```

3. **Adapter la méthode `sendSms`** (car l'API peut différer). Il faudra probablement créer une méthode d'adaptation.

#### Ajouter une Nouvelle Méthode de Notification

Si vous devez envoyer un nouveau type de SMS (ex: rappel de rendez-vous), créez une méthode dédiée :

```javascript
async sendRappelRendezVous(to, prenom, dateRdv, heureRdv, service) {
  const message = `Bonjour ${prenom}, rappel de votre rendez-vous pour ${service} le ${dateRdv} à ${heureRdv}. Merci de confirmer votre présence.`;
  
  return this.sendSms(to, message, {
    type: 'rappel',
    priority: 'medium'
  });
}
```

#### Améliorer la Gestion des Échecs

Ajoutez une logique de réessai avec backoff exponentiel :

```javascript
async sendSmsWithRetry(to, message, options = {}, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await this.sendSms(to, message, options);
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      console.log(`Tentative ${attempt} échouée, nouvelle tentative dans ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

#### Validation des Numéros de Téléphone

Ajoutez une validation plus robuste avec une bibliothèque comme `libphonenumber-js` :

```javascript
// Installation : npm install libphonenumber-js
const { parsePhoneNumberFromString } = require('libphonenumber-js');

formatPhoneNumber(phone) {
  const phoneNumber = parsePhoneNumberFromString(phone, 'BF');
  if (!phoneNumber || !phoneNumber.isValid()) {
    throw new Error(`Numéro de téléphone invalide: ${phone}`);
  }
  return phoneNumber.format('E.164'); // Format +22670123456
}
```

### 4.4. Tests et Validation

#### Tests Unitaires

```javascript
// tests/unit/smsService.test.js
const smsService = require('../../src/services/communication/SmsService');

describe('SmsService', () => {
  describe('formatPhoneNumber', () => {
    it('should format local numbers correctly', () => {
      expect(smsService.formatPhoneNumber('70123456')).toBe('+22670123456');
      expect(smsService.formatPhoneNumber('070123456')).toBe('+22670123456');
    });

    it('should handle international format', () => {
      expect(smsService.formatPhoneNumber('+22670123456')).toBe('+22670123456');
    });

    it('should clean special characters', () => {
      expect(smsService.formatPhoneNumber('70 12 34 56')).toBe('+22670123456');
      expect(smsService.formatPhoneNumber('70-12-34-56')).toBe('+22670123456');
    });
  });

  describe('sendVerificationCode', () => {
    it('should send a verification code', async () => {
      const result = await smsService.sendVerificationCode(
        '+22670123456',
        '123456',
        'Jean'
      );
      
      expect(result.success).toBe(true);
      expect(result.provider).toBe('mock');
      expect(result.messageId).toContain('mock_');
    });
  });

  describe('sendCommandeNotification', () => {
    it('should send confirmation message', async () => {
      const result = await smsService.sendCommandeNotification(
        '+22670123456',
        'CMD-001',
        'CONFIRMEE',
        'Marie'
      );
      
      expect(result.success).toBe(true);
    });
  });
});
```

#### Tests d'Intégration (avec un vrai fournisseur en mode test)

Pour Twilio, par exemple, vous pouvez utiliser des numéros de test et des credentials de test fournis par la plateforme.

### 4.5. Considérations Opérationnelles

#### Coûts et Quotas

- **Surveillance des coûts** : Implémentez un système de comptage des SMS envoyés par utilisateur/période pour éviter les abus.
- **Gestion des quotas** : La méthode `scheduleSms` permet de répartir les envois dans le temps pour respecter les limites des fournisseurs.

#### Conformité Légale

- **Consentement** : Assurez-vous d'avoir le consentement explicite des utilisateurs avant d'envoyer des SMS promotionnels.
- **Mention de désabonnement** : Pour les SMS marketing, incluez une mention comme "Stop SMS" ou un lien de désabonnement.
- **RGPD** : Les numéros de téléphone sont des données personnelles - assurez une conservation et un traitement conformes.

#### Surveillance et Alertes

Implémentez une surveillance du taux d'échec :

```javascript
async sendSms(to, message, options = {}) {
  try {
    // ... envoi
  } catch (error) {
    // Incrémenter un compteur d'échec dans Redis/Prometheus
    await CacheService.increment('sms:failure:count');
    
    const failureRate = await this.calculateFailureRate();
    if (failureRate > 0.1) { // 10% d'échec
      await NotificationService.sendAlert({
        type: 'SMS_PROVIDER_ISSUE',
        message: `Taux d'échec SMS élevé: ${failureRate * 100}%`
      });
    }
    
    throw error;
  }
}
```

#### Support Multi-Langue

Pour une application internationale, adaptez les messages selon la langue de l'utilisateur :

```javascript
async sendVerificationCode(to, code, prenom, langue = 'fr') {
  const messages = {
    fr: `Bonjour ${prenom}, votre code de vérification est: ${code}.`,
    en: `Hello ${prenom}, your verification code is: ${code}.`,
    // etc.
  };
  
  const message = messages[langue] || messages.fr;
  return this.sendSms(to, message, { type: 'verification' });
}
```

### 4.6. Intégration avec la File d'Attente

La méthode `scheduleSms` utilise `FileTacheModel.ajouter` pour planifier un envoi différé. C'est utile pour :

- Les rappels (ex: 24h avant un rendez-vous)
- Les campagnes promotionnelles programmées
- La gestion des pics de charge

```javascript
// Planifier un rappel pour demain
const demain = new Date();
demain.setDate(demain.getDate() + 1);
demain.setHours(9, 0, 0, 0); // 9h du matin

await smsService.scheduleSms(
  '70123456',
  'Noubliez pas votre rendez-vous demain !',
  demain
);
```

---