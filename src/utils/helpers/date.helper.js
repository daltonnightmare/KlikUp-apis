// src/utils/helpers/date.helper.js
// Fonctions utilitaires pour la gestion des dates

/**
 * Formate une date en string locale (Burkina Faso)
 */
const formaterDate = (date, locale = 'fr-BF') => {
  if (!date) return null;
  return new Date(date).toLocaleDateString(locale, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
};

/**
 * Formate une date avec l'heure
 */
const formaterDateHeure = (date, locale = 'fr-BF') => {
  if (!date) return null;
  return new Date(date).toLocaleString(locale, {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

/**
 * Calcule le nombre de jours entre deux dates
 */
const joursEntre = (dateDebut, dateFin) => {
  const d1 = new Date(dateDebut);
  const d2 = new Date(dateFin);
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
};

/**
 * Vérifie si une date est expirée
 */
const estExpire = (date) => {
  if (!date) return false;
  return new Date(date) < new Date();
};

/**
 * Ajoute des minutes à la date actuelle
 */
const ajouterMinutes = (minutes) => {
  const date = new Date();
  date.setMinutes(date.getMinutes() + minutes);
  return date;
};

/**
 * Ajoute des jours à la date actuelle
 */
const ajouterJours = (jours) => {
  const date = new Date();
  date.setDate(date.getDate() + jours);
  return date;
};

/**
 * Retourne le début de la journée
 */
const debutJour = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Retourne la fin de la journée
 */
const finJour = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

/**
 * Retourne le début du mois
 */
const debutMois = (date = new Date()) => {
  return new Date(date.getFullYear(), date.getMonth(), 1);
};

/**
 * Retourne la fin du mois
 */
const finMois = (date = new Date()) => {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
};

/**
 * Retourne le début de l'année
 */
const debutAnnee = (date = new Date()) => {
  return new Date(date.getFullYear(), 0, 1);
};

/**
 * Durée lisible (ex: "2h 30min")
 */
const dureeListible = (secondes) => {
  if (!secondes) return '0min';
  const h   = Math.floor(secondes / 3600);
  const min = Math.floor((secondes % 3600) / 60);
  const s   = secondes % 60;
  if (h > 0) return `${h}h ${min > 0 ? min + 'min' : ''}`.trim();
  if (min > 0) return `${min}min ${s > 0 ? s + 's' : ''}`.trim();
  return `${s}s`;
};

module.exports = {
  formaterDate,
  formaterDateHeure,
  joursEntre,
  estExpire,
  ajouterMinutes,
  ajouterJours,
  debutJour,
  finJour,
  debutMois,
  finMois,
  debutAnnee,
  dureeListible,
};