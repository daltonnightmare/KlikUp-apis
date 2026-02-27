// services/email/EmailService.js
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
const Constants = require('../../configuration/constants');
const { FileTacheModel } = require('../../models');

class EmailService {
  constructor() {
    this.transporter = null;
    this.templates = {};
    this.isDev = process.env.NODE_ENV === 'development';
    this.initTransporter();
  }

  /**
   * Initialiser le transporteur d'emails
   */
  initTransporter() {
    // En développement, utiliser un transporteur de test ou simulé si pas de credentials
    if (this.isDev && (!process.env.SMTP_HOST || !process.env.SMTP_USER)) {
      console.log('📧 Mode développement: utilisation du transporteur de test (stream)');
      
      // Utiliser streamTransport en développement pour éviter les erreurs de credentials
      this.transporter = nodemailer.createTransport({
        streamTransport: true,
        newline: 'unix'
      });
      
      console.log('📧 Transporteur de test initialisé - les emails seront affichés dans la console');
      return;
    }

    // Configuration normale pour production
    const config = {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    };

    // Vérifier si les credentials sont présents
    if (!config.auth.user || !config.auth.pass) {
      console.warn('⚠️ Credentials SMTP manquants, utilisation du mode stream');
      this.transporter = nodemailer.createTransport({
        streamTransport: true,
        newline: 'unix'
      });
    } else {
      this.transporter = nodemailer.createTransport(config);
    }
  }

  /**
   * Charger un template email
   */
  async loadTemplate(templateName) {
    if (this.templates[templateName]) {
      return this.templates[templateName];
    }

    try {
      const templatePath = path.join(__dirname, 'templates', `${templateName}.html`);
      const template = await fs.readFile(templatePath, 'utf-8');
      this.templates[templateName] = template;
      return template;
    } catch (error) {
      console.error(`❌ Erreur chargement template ${templateName}:`, error.message);
      
      // Retourner un template par défaut en cas d'erreur
      return `<html><body><h1>{{titre}}</h1><p>{{message}}</p></body></html>`;
    }
  }

  /**
   * Remplacer les variables dans un template
   */
  renderTemplate(template, variables) {
    let rendered = template;
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      rendered = rendered.replace(regex, value || '');
    }
    return rendered;
  }

  /**
   * Envoyer un email
   */
  async sendEmail(to, subject, html, options = {}) {
    try {
      // Vérifier si le transporteur est initialisé
      if (!this.transporter) {
        console.warn('⚠️ Transporteur non initialisé, réinitialisation...');
        this.initTransporter();
      }

      const from = options.from || 
        `"${process.env.MAIL_FROM_NAME || 'ProjetBus'}" <${process.env.MAIL_FROM_ADDRESS || 'noreply@projetbus.com'}>`;

      const mailOptions = {
        from,
        to,
        subject,
        html,
        ...options
      };

      const info = await this.transporter.sendMail(mailOptions);
      
      // Si c'est un streamTransport, le message est disponible dans info.message
      if (this.isDev && info.message) {
        console.log('\n📧 [EMAIL SIMULÉ]');
        console.log(`  À: ${to}`);
        console.log(`  Sujet: ${subject}`);
        console.log(`  Contenu: ${html.substring(0, 200)}...`);
        console.log(`  ID: ${info.messageId || 'simulated'}\n`);
      } else {
        console.log(`📧 Email envoyé à ${to}: ${info.messageId}`);
      }
      
      // Si c'est un email de test, afficher l'URL de prévisualisation
      if (info.messageId && nodemailer.getTestMessageUrl) {
        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) {
          console.log(`📧 URL de prévisualisation: ${previewUrl}`);
        }
      }
      
      return {
        success: true,
        messageId: info.messageId,
        preview: nodemailer.getTestMessageUrl ? nodemailer.getTestMessageUrl(info) : null
      };
      
    } catch (error) {
      console.error('❌ Erreur envoi email:', error.message);
      
      // En développement, ne pas bloquer le processus
      if (this.isDev) {
        console.log('📧 [FALLBACK] Simulation d\'envoi d\'email:');
        console.log(`  À: ${to}`);
        console.log(`  Sujet: ${subject}`);
        console.log(`  Contenu: ${html.substring(0, 200)}...`);
        
        return {
          success: true,
          simulated: true,
          messageId: `simulated_${Date.now()}`
        };
      }
      
      throw new Error(`Échec envoi email: ${error.message}`);
    }
  }

  /**
   * Envoyer un email avec template
   */
  async sendTemplateEmail(to, templateName, variables, options = {}) {
    try {
      const template = await this.loadTemplate(templateName);
      
      let html;
      let subject = options.subject || this.getDefaultSubject(templateName);
      
      if (template) {
        html = this.renderTemplate(template, variables);
      } else {
        // Template par défaut si le fichier n'existe pas
        html = `
          <h1>${subject}</h1>
          <p>Bonjour ${variables.prenom || ''},</p>
          ${Object.entries(variables).map(([key, value]) => 
            `<p><strong>${key}:</strong> ${value}</p>`
          ).join('')}
          <p>À bientôt sur ProjetBus !</p>
        `;
      }

      return this.sendEmail(to, subject, html, options);
      
    } catch (error) {
      console.error(`❌ Erreur envoi template ${templateName}:`, error.message);
      
      // Fallback: envoyer sans template
      const fallbackHtml = `
        <h1>${this.getDefaultSubject(templateName)}</h1>
        <p>Bonjour ${variables.prenom || ''},</p>
        <pre>${JSON.stringify(variables, null, 2)}</pre>
      `;
      
      return this.sendEmail(to, this.getDefaultSubject(templateName), fallbackHtml, options);
    }
  }

  /**
   * Obtenir le sujet par défaut d'un template
   */
  getDefaultSubject(templateName) {
    const subjects = {
      'welcome': 'Bienvenue sur ProjetBus',
      'reset-password': 'Réinitialisation de votre mot de passe',
      'verify-email': 'Vérification de votre adresse email',
      'verify-phone': 'Code de vérification',
      'commande-confirmee': 'Confirmation de votre commande',
      'commande-livree': 'Votre commande a été livrée',
      'notification': 'Nouvelle notification',
      'promotion': 'Offre spéciale pour vous',
      'rappel-panier': 'Vous avez oublié quelque chose ?',
      'facture': 'Votre facture'
    };
    return subjects[templateName] || 'Notification de KlikUp';
  }

  /**
   * Envoyer un email de bienvenue (version simplifiée)
   */
  async sendWelcomeEmail(to, prenom, loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`) {
    const variables = {
      prenom: prenom || 'utilisateur',
      loginUrl,
      year: new Date().getFullYear()
    };
    
    return this.sendTemplateEmail(to, 'welcome', variables);
  }

  /**
   * Envoyer un email de réinitialisation de mot de passe
   */
  async sendResetPasswordEmail(to, resetToken, prenom) {
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
    
    const variables = {
      prenom: prenom || 'utilisateur',
      resetUrl,
      expiresIn: '1 heure',
      year: new Date().getFullYear()
    };
    
    return this.sendTemplateEmail(to, 'reset-password', variables);
  }

  /**
   * Envoyer un email de vérification
   */
  async sendVerificationEmail(to, code, prenom) {
    const variables = {
      prenom: prenom || 'utilisateur',
      code,
      expiresIn: '15 minutes',
      year: new Date().getFullYear()
    };
    
    return this.sendTemplateEmail(to, 'verify-email', variables);
  }

  /**
   * Envoyer une notification
   */
  async sendNotificationEmail(to, prenom, titre, message, actionUrl = null) {
    const variables = {
      prenom: prenom || 'utilisateur',
      titre,
      message,
      actionUrl,
      year: new Date().getFullYear()
    };
    
    return this.sendTemplateEmail(to, 'notification', variables);
  }

  /**
   * Envoyer une confirmation de commande
   */
  async sendCommandeConfirmee(to, prenom, commandeRef, details, total) {
    const variables = {
      prenom: prenom || 'utilisateur',
      commandeRef,
      date: new Date().toLocaleDateString('fr-FR'),
      details: typeof details === 'string' ? details : JSON.stringify(details, null, 2),
      total: `${total} ${Constants.CONFIG?.DEVISE?.SYMBOLE || 'FCFA'}`,
      year: new Date().getFullYear()
    };
    
    return this.sendTemplateEmail(to, 'commande-confirmee', variables);
  }

  /**
   * Envoyer une facture
   */
  async sendFacture(to, prenom, factureUrl, commandeRef, montant) {
    const variables = {
      prenom: prenom || 'utilisateur',
      factureUrl,
      commandeRef,
      montant: `${montant} ${Constants.CONFIG?.DEVISE?.SYMBOLE || 'FCFA'}`,
      year: new Date().getFullYear()
    };
    
    return this.sendTemplateEmail(to, 'facture', variables);
  }

  /**
   * Planifier un email (via file d'attente)
   */
  async scheduleEmail(to, subject, html, executeApres = null) {
    if (!FileTacheModel || typeof FileTacheModel.ajouter !== 'function') {
      console.warn('⚠️ FileTacheModel non disponible, envoi immédiat');
      return this.sendEmail(to, subject, html);
    }
    
    return FileTacheModel.ajouter(
      'ENVOI_EMAIL',
      {
        to,
        subject,
        html,
        options: {}
      },
      {
        priorite: 5,
        execute_apres: executeApres || new Date()
      }
    );
  }

  /**
   * Vérifier la configuration SMTP
   */
  async verifyConnection() {
    try {
      if (!this.transporter) {
        return { success: false, message: 'Transporteur non initialisé' };
      }
      
      await this.transporter.verify();
      return { success: true, message: 'Connexion SMTP établie' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}

module.exports = new EmailService();