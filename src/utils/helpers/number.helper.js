// src/utils/helpers/number.helper.js
// Utilitaires pour les nombres et montants

/**
 * Formate un montant en FCFA
 */
const formaterMontant = (montant, devise = 'FCFA') => {
  if (montant === null || montant === undefined) return '0 ' + devise;
  return new Intl.NumberFormat('fr-BF', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(montant)) + ' ' + devise;
};

/**
 * Arrondit à 2 décimales
 */
const arrondir = (nombre) => Math.round((nombre + Number.EPSILON) * 100) / 100;

/**
 * Calcule un pourcentage
 */
const calculerPourcentage = (valeur, total) => {
  if (!total) return 0;
  return arrondir((valeur / total) * 100);
};

/**
 * Calcule le montant d'une réduction
 */
const calculerReduction = (prix, typePromo, valeur) => {
  switch (typePromo) {
    case 'POURCENTAGE':
      return arrondir(prix * (valeur / 100));
    case 'MONTANT_FIXE':
      return Math.min(valeur, prix);
    default:
      return 0;
  }
};

/**
 * Génère un nombre entier aléatoire entre min et max
 */
const nombreAleatoire = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Formate un nombre avec des espaces (ex: 1 000 000)
 */
const formaterNombre = (nombre) => {
  if (!nombre && nombre !== 0) return '0';
  return new Intl.NumberFormat('fr-BF').format(nombre);
};

module.exports = {
  formaterMontant,
  arrondir,
  calculerPourcentage,
  calculerReduction,
  nombreAleatoire,
  formaterNombre,
};