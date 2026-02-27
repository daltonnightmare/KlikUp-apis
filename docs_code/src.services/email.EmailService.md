

---

# Documentation Complète du Service d'Email (`EmailService`)

## 1. Présentation Générale

Le `EmailService` est un module central de l'application backend chargé de gérer l'envoi de tous les emails transactionnels. Il agit comme une couche d'abstraction au-dessus de la bibliothèque `nodemailer`, simplifiant l'envoi d'emails, la gestion des templates HTML, et la planification des envois.

**Rôle principal :** Envoyer des emails de manière fiable et maintenable (bienvenue, réinitialisation de mot de passe, confirmations de commande, etc.).

## 2. Architecture et Conception

- **Pattern Singleton :** La classe est exportée en tant qu'instance unique (`module.exports = new EmailService();`). Cela garantit qu'une seule connexion SMTP est partagée dans toute l'application, optimisant les ressources.
- **Gestionnaire de Templates :** Le service charge des fichiers HTML depuis le dossier `templates/`, remplace les variables (ex: `{{prenom}}`) et les envoie. Cela sépare le contenu (le template) de la logique d'envoi.
- **Gestion des Erreurs Robuste :** Le service est conçu pour ne pas interrompre le flux de l'application, surtout en environnement de développement. Il utilise des mécanismes de "fallback" (solution de repli) pour simuler les envois ou utiliser des templates par défaut en cas de problème.
- **Intégration avec la File d'Attente :** Il peut interagir avec un modèle `FileTacheModel` pour planifier des envois d'emails différés (ex: rappels).

## 3. Guide pour les Novices (Débutants)

Cette section explique comment utiliser le service simplement, sans entrer dans les détails techniques.

### 3.1. Comment l'utiliser ?

Vous n'avez pas besoin de créer une instance du service. Il est déjà prêt à être utilisé partout dans l'application. Il suffit de l'importer là où vous en avez besoin.

```javascript
// Exemple dans un contrôleur ou un autre service
const emailService = require('./services/email/EmailService');

// ... plus tard dans votre code
await emailService.sendWelcomeEmail('client@email.com', 'Jean');
```

### 3.2. Les Méthodes Simplifiées

Le service propose des méthodes prêtes à l'emploi pour les cas les plus courants. C'est la façon la plus simple d'envoyer un email.

- **`sendWelcomeEmail(to, prenom, loginUrl)`** : Envoie un email de bienvenue.
    - `to` : L'adresse email du destinataire.
    - `prenom` : Le prénom du destinataire pour personnaliser l'email.
    - `loginUrl` : (Optionnel) Le lien vers la page de connexion.

- **`sendResetPasswordEmail(to, resetToken, prenom)`** : Envoie un email avec un lien pour réinitialiser le mot de passe.
    - `resetToken` : Le token unique et sécurisé pour la réinitialisation.

- **`sendVerificationEmail(to, code, prenom)`** : Envoie un email contenant un code de vérification (ex: pour confirmer une adresse email).

- **`sendNotificationEmail(to, prenom, titre, message, actionUrl)`** : Envoie une notification générique à un utilisateur.

- **`sendCommandeConfirmee(to, prenom, commandeRef, details, total)`** : Envoie une confirmation de commande.

- **`sendFacture(to, prenom, factureUrl, commandeRef, montant)`** : Envoie un email avec un lien vers une facture.

### 3.3. Exemple Concret

Imaginons que vous venez de créer un compte utilisateur. Voici comment envoyer l'email de bienvenue :

```javascript
// Supposons que vous ayez un objet 'utilisateur' avec son email et son prénom
const utilisateur = { email: 'marie.dupont@email.com', prenom: 'Marie' };

try {
  const resultat = await emailService.sendWelcomeEmail(
    utilisateur.email, 
    utilisateur.prenom
  );

  if (resultat.success) {
    console.log(`Email de bienvenue envoyé avec succès à ${utilisateur.email}`);
  } else {
    console.error("L'email n'a pas pu être envoyé.");
  }
} catch (error) {
  console.error("Une erreur inattendue est survenue :", error);
}
```

C'est tout ! Le service se charge du template, des variables et de la communication avec le serveur SMTP.

## 4. Guide pour les Professionnels (Développeurs)

Cette section détaille le fonctionnement interne, la configuration avancée et les possibilités d'extension.

### 4.1. Configuration et Initialisation

Le service s'initialise automatiquement via le constructeur. Son comportement est contrôlé par des variables d'environnement.

- **Variables d'Environnement Clés :**
    - `NODE_ENV` : Si défini sur `'development'`, active le mode débogage et les mécanismes de fallback.
    - **Configuration SMTP :**
        - `SMTP_HOST` : Hôte du serveur SMTP.
        - `SMTP_PORT` : Port (généralement 587 pour TLS, 465 pour SSL).
        - `SMTP_SECURE` : `'true'` si le port 465 est utilisé (SSL), `'false'` sinon (TLS/STARTTLS).
        - `SMTP_USER` : Nom d'utilisateur pour l'authentification.
        - `SMTP_PASS` : Mot de passe.
    - **Configuration des Emails :**
        - `MAIL_FROM_NAME` : Le nom affiché comme expéditeur (ex: "Service Client").
        - `MAIL_FROM_ADDRESS` : L'adresse email de l'expéditeur (ex: "contact@monsite.com").
        - `FRONTEND_URL` : L'URL de base du frontend, utilisée pour construire les liens dans les emails.

- **Logique d'Initialisation (`initTransporter`) :**
    1.  Si en mode `development` **et** que les identifiants SMTP sont manquants, le service utilise `streamTransport`. Les emails ne sont pas réellement envoyés mais sont affichés dans la console, ce qui est idéal pour le développement local.
    2.  Sinon, il tente de configurer le transporteur avec les identifiants fournis.
    3.  Si les identifiants sont manquants en mode production, il revient également au `streamTransport` et émet un avertissement.

### 4.2. Fonctionnement Détaillé des Méthodes Clés

- **`loadTemplate(templateName)`** :
    - Lit de manière asynchrone (`fs.promises.readFile`) un fichier HTML depuis le répertoire `./templates/`.
    - Implémente un système de cache simple (`this.templates`) pour éviter de lire le disque à chaque envoi.
    - En cas d'échec (fichier non trouvé), il retourne un template minimaliste pour éviter de faire échouer l'envoi.

- **`renderTemplate(template, variables)`** :
    - Effectue une substitution de chaîne simple basée sur des expressions régulières. Il remplace toutes les occurrences de `{{nomDeLaVariable}}` par la valeur correspondante fournie dans l'objet `variables`.
    - *Note pour l'évolution :* Cette méthode pourrait être améliorée avec un moteur de template plus puissant (comme Handlebars) si les templates deviennent plus complexes (logique conditionnelle, boucles).

- **`sendEmail(to, subject, html, options)`** :
    - C'est le noyau de l'envoi. Il appelle `nodemailer.transporter.sendMail()`.
    - **Mode Développement :** Si `streamTransport` est utilisé, il affiche un récapitulatif détaillé de l'email dans la console. Si `nodemailer` fournit une URL de prévisualisation (pour les services comme Ethereal), il l'affiche également.
    - **Gestion d'Erreur :** Si l'envoi échoue en mode développement, il simule un succès (`simulated: true`) et log l'erreur, permettant au reste de l'application de continuer à fonctionner. En production, l'erreur est propagée pour être gérée par l'appelant.

- **`sendTemplateEmail(to, templateName, variables, options)`** :
    - Orchestre l'envoi avec template : charge le template, le "rend" avec les variables, et appelle `sendEmail`.
    - Si le chargement du template échoue, il entre dans une logique de fallback :
        1.  Il tente de construire un HTML simple à partir des variables.
        2.  En cas de nouvelle erreur, il utilise un fallback très basique avec un aperçu JSON des variables. Cela garantit que l'information cruciale est toujours transmise.

- **`scheduleEmail(to, subject, html, executeApres)`** :
    - Délègue la planification à un modèle `FileTacheModel` (présumément un système de queue de tâches).
    - Si le modèle n'est pas disponible, il envoie l'email immédiatement comme solution de repli. Cela découple le service de la file d'attente.

### 4.3. Extension et Personnalisation

#### Ajouter un Nouveau Type d'Email

1.  **Créer le Template HTML :** Ajoutez un fichier `nouveau-template.html` dans le dossier `services/email/templates/`. Utilisez des variables comme `{{prenom}}`, `{{lien}}`, etc.
2.  **Ajouter une Méthode dans la Classe (Optionnel mais recommandé) :** Créez une méthode dédiée pour garder le code propre et lisible.

```javascript
async sendNouveauTypeEmail(to, prenom, quelqueChose) {
  const variables = {
    prenom: prenom,
    quelqueChose: quelqueChose,
    year: new Date().getFullYear()
  };
  // Vous pouvez spécifier un sujet ici, qui écrasera le sujet par défaut
  const options = { subject: 'Sujet personnalisé pour cet email' }; 
  return this.sendTemplateEmail(to, 'nouveau-template', variables, options);
}
```

3.  **Mettre à Jour `getDefaultSubject` (Optionnel) :** Ajoutez une entrée dans l'objet `subjects` pour définir un sujet par défaut si vous ne le passez pas via les `options`.

#### Amélioration du "Rendering" des Templates

Si les besoins en templates deviennent complexes (boucles `each`, conditions `if`), il est conseillé de remplacer la méthode `renderTemplate` par un moteur reconnu :

```javascript
// Installation : npm install handlebars
const Handlebars = require('handlebars');

// Dans la méthode renderTemplate
renderTemplate(template, variables) {
  const compiledTemplate = Handlebars.compile(template);
  return compiledTemplate(variables);
}
```

Cela nécessitera d'adapter la syntaxe des templates de `{{variable}}` à `{{variable}}` (inchangé) et d'utiliser `{{#each tableau}} ... {{/each}}` pour les itérations.

### 4.4. Tests et Validation

- **`verifyConnection()`** : Utilisez cette méthode pour tester la connectivité SMTP, par exemple dans un script d'administration ou lors du démarrage de l'application.
- **Tests Unitaires :**
    - **Mocker `nodemailer` :** Lors des tests, il est impératif de "mocker" (simuler) le module `nodemailer` pour éviter de véritables envois.
    - **Tester la Logique de Fallback :** Écrivez des tests qui simulent l'absence de fichiers de template ou une défaillance du transporteur pour vérifier que les mécanismes de repli fonctionnent comme prévu.
    - **Tester le Rendu :** Vérifiez que la méthode `renderTemplate` remplace correctement les variables.

Exemple de structure de test avec Jest :

```javascript
jest.mock('nodemailer');
const nodemailer = require('nodemailer');
const EmailService = require('./services/email/EmailService');

test('sendWelcomeEmail should call sendMail with correct args', async () => {
  const sendMailMock = jest.fn().mockResolvedValue({ messageId: '123' });
  nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock });

  await EmailService.sendWelcomeEmail('test@test.com', 'Jean');

  expect(sendMailMock).toHaveBeenCalledTimes(1);
  expect(sendMailMock.mock.calls[0][0].to).toBe('test@test.com');
  expect(sendMailMock.mock.calls[0][0].html).toContain('Jean'); // Vérifie que le prénom est bien dans le HTML
});
```

### 4.5. Considérations de Sécurité

- **Variables d'Environnement :** Toutes les informations sensibles (identifiants SMTP) sont stockées dans des variables d'environnement, et non en dur dans le code. C'est une excellente pratique.
- **Tokens Sécurisés :** Les méthodes comme `sendResetPasswordEmail` acceptent un `resetToken`. La génération de ce token (son caractère aléatoire et sa durée de validité) est une responsabilité cruciale en dehors de ce service, mais le service d'email est le vecteur de transmission.
- **Validation des Entrées :** Le service ne valide pas le format des adresses email (c'est fait en amont) et ne "sanitize" pas le contenu HTML. Si les variables injectées dans les templates proviennent d'une saisie utilisateur, elles doivent être échappées en amont pour prévenir les injections HTML.

### 4.6. Dépendances

- **`nodemailer`** : Le cœur de l'envoi d'emails. Version la plus récente recommandée.
- **`fs` / `path`** : Modules natifs de Node.js pour la gestion des fichiers.
- **`../../configuration/constants`** : Module interne pour les constantes de l'application (ex: symbole de la devise).
- **`../../models`** : Module interne pour les modèles de données, dont `FileTacheModel`.

---