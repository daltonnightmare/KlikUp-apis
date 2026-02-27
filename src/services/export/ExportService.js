const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs').promises;
const path = require('path');
const Constants = require('../../configuration/constants');
const { FileTacheModel } = require('../../models');

class ExportService {
  constructor() {
    this.exportDir = path.join(__dirname, '../../../exports');
    this.ensureExportDir();
  }

  /**
   * S'assurer que le dossier d'export existe
   */
  async ensureExportDir() {
    try {
      await fs.access(this.exportDir);
    } catch {
      await fs.mkdir(this.exportDir, { recursive: true });
    }
  }

  /**
   * Exporter des données en Excel
   */
  async toExcel(data, options = {}) {
    const {
      filename = `export-${Date.now()}.xlsx`,
      sheetName = 'Export',
      columns = null,
      title = null,
      subtitle = null
    } = options;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetName);

    // Ajouter un titre
    if (title) {
      worksheet.mergeCells('A1', `${String.fromCharCode(64 + (columns?.length || data[0]?.length || 1))}1`);
      const titleRow = worksheet.getRow(1);
      titleRow.getCell(1).value = title;
      titleRow.getCell(1).font = { size: 16, bold: true };
      titleRow.height = 30;
    }

    // Ajouter un sous-titre
    if (subtitle) {
      const subtitleRow = worksheet.getRow(2);
      subtitleRow.getCell(1).value = subtitle;
      subtitleRow.getCell(1).font = { size: 12, italic: true };
    }

    // Définir les colonnes
    if (columns) {
      worksheet.columns = columns.map(col => ({
        header: col.header,
        key: col.key,
        width: col.width || 20,
        style: col.style
      }));
    } else if (data.length > 0 && typeof data[0] === 'object') {
      worksheet.columns = Object.keys(data[0]).map(key => ({
        header: key,
        key,
        width: 20
      }));
    }

    // Ajouter les données
    const startRow = title ? 3 : (subtitle ? 2 : 1);
    worksheet.addRows(data, startRow);

    // Styliser l'en-tête
    if (columns) {
      const headerRow = worksheet.getRow(startRow - 1);
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };
    }

    // Ajuster automatiquement les largeurs
    worksheet.columns.forEach(column => {
      if (!column.width) {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, cell => {
          maxLength = Math.max(maxLength, cell.value ? cell.value.toString().length : 0);
        });
        column.width = Math.min(maxLength + 2, 50);
      }
    });

    // Sauvegarder le fichier
    const filePath = path.join(this.exportDir, filename);
    await workbook.xlsx.writeFile(filePath);

    return {
      filename,
      path: filePath,
      url: `/exports/${filename}`,
      size: (await fs.stat(filePath)).size
    };
  }

  /**
   * Exporter des données en CSV
   */
  async toCSV(data, options = {}) {
    const {
      filename = `export-${Date.now()}.csv`,
      delimiter = ',',
      headers = true
    } = options;

    let csv = '';

    // Ajouter les en-têtes
    if (headers && data.length > 0) {
      csv += Object.keys(data[0]).join(delimiter) + '\n';
    }

    // Ajouter les données
    data.forEach(row => {
      const values = Object.values(row).map(value => {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' && value.includes(delimiter)) {
          return `"${value}"`;
        }
        return value;
      });
      csv += values.join(delimiter) + '\n';
    });

    // Sauvegarder le fichier
    const filePath = path.join(this.exportDir, filename);
    await fs.writeFile(filePath, csv, 'utf-8');

    return {
      filename,
      path: filePath,
      url: `/exports/${filename}`,
      size: (await fs.stat(filePath)).size
    };
  }

  /**
   * Exporter des données en PDF
   */
  async toPDF(data, options = {}) {
    const {
      filename = `export-${Date.now()}.pdf`,
      title = 'Export de données',
      subtitle = null,
      columns = null,
      landscape = false
    } = options;

    return new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          layout: landscape ? 'landscape' : 'portrait',
          margin: 50
        });

        const filePath = path.join(this.exportDir, filename);
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        // Titre
        doc.fontSize(20).text(title, { align: 'center' });
        doc.moveDown();

        // Sous-titre
        if (subtitle) {
          doc.fontSize(12).text(subtitle, { align: 'center' });
          doc.moveDown();
        }

        // Date d'export
        doc.fontSize(10).text(`Exporté le: ${new Date().toLocaleDateString('fr-FR')}`, { align: 'right' });
        doc.moveDown(2);

        // Tableau
        const tableTop = doc.y;
        const itemPerPage = landscape ? 25 : 15;
        
        // Définir les colonnes
        let headers;
        let colWidths;
        
        if (columns) {
          headers = columns.map(c => c.header);
          colWidths = columns.map(c => c.width || 100);
        } else if (data.length > 0) {
          headers = Object.keys(data[0]);
          colWidths = headers.map(() => 80);
        }

        if (headers) {
          // Dessiner l'en-tête
          let x = 50;
          doc.fontSize(10).font('Helvetica-Bold');
          
          headers.forEach((header, i) => {
            doc.text(header, x, tableTop, {
              width: colWidths[i],
              align: 'left'
            });
            x += colWidths[i] + 10;
          });

          // Ligne sous l'en-tête
          doc.moveTo(50, tableTop + 15)
             .lineTo(550, tableTop + 15)
             .stroke();

          // Ajouter les données
          doc.font('Helvetica');
          let y = tableTop + 25;
          
          data.forEach((row, rowIndex) => {
            if (rowIndex > 0 && rowIndex % itemPerPage === 0) {
              doc.addPage();
              y = 50;
            }

            x = 50;
            headers.forEach((header, i) => {
              const value = row[header] || '';
              doc.text(String(value), x, y, {
                width: colWidths[i],
                align: 'left'
              });
              x += colWidths[i] + 10;
            });

            y += 20;
          });
        }

        doc.end();

        stream.on('finish', async () => {
          resolve({
            filename,
            path: filePath,
            url: `/exports/${filename}`,
            size: (await fs.stat(filePath)).size
          });
        });

        stream.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Exporter des commandes
   */
  async exportCommandes(commandes, format = 'excel', options = {}) {
    const data = commandes.map(c => ({
      'Référence': c.reference_commande,
      'Date': new Date(c.date_commande).toLocaleDateString('fr-FR'),
      'Client': c.nom_utilisateur_compte || 'Anonyme',
      'Montant': `${c.prix_total_commande} ${Constants.CONFIG.DEVISE.SYMBOLE}`,
      'Statut': c.statut_commande,
      'Mode': c.pour_livrer ? 'Livraison' : 'Sur place',
      'Paiement': c.paiement_direct ? 'En ligne' : (c.paiement_a_la_livraison ? 'À la livraison' : 'Sur place')
    }));

    const filename = `commandes-${Date.now()}.${format === 'excel' ? 'xlsx' : (format === 'csv' ? 'csv' : 'pdf')}`;

    switch (format) {
      case 'excel':
        return this.toExcel(data, {
          filename,
          title: 'Export des commandes',
          subtitle: `Du ${new Date().toLocaleDateString('fr-FR')}`,
          columns: [
            { header: 'Référence', key: 'Référence', width: 20 },
            { header: 'Date', key: 'Date', width: 15 },
            { header: 'Client', key: 'Client', width: 25 },
            { header: 'Montant', key: 'Montant', width: 15 },
            { header: 'Statut', key: 'Statut', width: 15 },
            { header: 'Mode', key: 'Mode', width: 15 },
            { header: 'Paiement', key: 'Paiement', width: 15 }
          ]
        });

      case 'csv':
        return this.toCSV(data, { filename });

      case 'pdf':
        return this.toPDF(data, {
          filename,
          title: 'Export des commandes',
          subtitle: `Du ${new Date().toLocaleDateString('fr-FR')}`,
          columns: [
            { header: 'Référence', width: 80 },
            { header: 'Date', width: 70 },
            { header: 'Client', width: 100 },
            { header: 'Montant', width: 60 },
            { header: 'Statut', width: 70 }
          ]
        });

      default:
        throw new Error(`Format non supporté: ${format}`);
    }
  }

  /**
   * Exporter des produits
   */
  async exportProduits(produits, format = 'excel', options = {}) {
    const data = produits.map(p => ({
      'Nom': p.nom_produit,
      'Catégorie': p.categorie || p.nom_categorie,
      'Boutique': p.nom_boutique,
      'Prix': `${p.prix_unitaire_produit} ${Constants.CONFIG.DEVISE.SYMBOLE}`,
      'Stock': p.quantite === -1 ? 'Illimité' : p.quantite,
      'Statut': p.est_disponible ? 'Disponible' : 'Indisponible'
    }));

    const filename = `produits-${Date.now()}.${format === 'excel' ? 'xlsx' : (format === 'csv' ? 'csv' : 'pdf')}`;

    return this.toExcel(data, {
      filename,
      title: 'Export des produits',
      columns: [
        { header: 'Nom', key: 'Nom', width: 30 },
        { header: 'Catégorie', key: 'Catégorie', width: 20 },
        { header: 'Boutique', key: 'Boutique', width: 25 },
        { header: 'Prix', key: 'Prix', width: 15 },
        { header: 'Stock', key: 'Stock', width: 15 },
        { header: 'Statut', key: 'Statut', width: 15 }
      ]
    });
  }

  /**
   * Exporter des statistiques
   */
  async exportStats(stats, type, periode, format = 'excel') {
    const data = this.formatStatsForExport(stats, type);
    const filename = `stats-${type}-${Date.now()}.${format === 'excel' ? 'xlsx' : 'csv'}`;

    return this.toExcel(data, {
      filename,
      title: `Statistiques ${type}`,
      subtitle: `Période: ${periode}`
    });
  }

  /**
   * Formater les statistiques pour l'export
   */
  formatStatsForExport(stats, type) {
    switch (type) {
      case 'commandes':
        return stats.map(s => ({
          'Date': s.periode,
          'Nombre': s.nombre_commandes,
          'Montant': s.montant_total,
          'Panier moyen': s.panier_moyen
        }));

      case 'ventes':
        return stats.map(s => ({
          'Produit': s.nom_produit,
          'Quantité': s.quantite_vendue,
          'Montant': s.montant_total,
          'Boutique': s.nom_boutique
        }));

      case 'clients':
        return stats.map(s => ({
          'Client': s.nom_utilisateur_compte,
          'Email': s.email,
          'Commandes': s.nombre_commandes,
          'Dépenses': s.montant_total,
          'Dernière commande': s.derniere_commande
        }));

      default:
        return [];
    }
  }

  /**
   * Planifier un export
   */
  async scheduleExport(type, params, format, date) {
    return FileTacheModel.ajouter(
      'EXPORT_DONNEES',
      {
        type,
        params,
        format
      },
      {
        priorite: 3,
        execute_apres: date
      }
    );
  }

  /**
   * Nettoyer les anciens exports
   */
  async cleanOldExports(jours = 7) {
    try {
      const files = await fs.readdir(this.exportDir);
      const now = Date.now();
      let deleted = 0;

      for (const file of files) {
        const filePath = path.join(this.exportDir, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtimeMs > jours * 24 * 60 * 60 * 1000) {
          await fs.unlink(filePath);
          deleted++;
        }
      }

      return { deleted };
    } catch (error) {
      console.error('Erreur nettoyage exports:', error);
      return { deleted: 0, error: error.message };
    }
  }
}

module.exports = new ExportService();