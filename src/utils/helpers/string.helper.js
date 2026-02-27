// src/utils/helpers/string.helper.js
// Utilitaires pour les chaînes de caractères

/**
 * Génère un slug à partir d'une chaîne
 * Ex: "Mon Super Article" → "mon-super-article"
 */
const genererSlug = (texte) => {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // Supprime les accents
    .replace(/[^a-z0-9\s-]/g, '')      // Garde lettres, chiffres, espaces, tirets
    .trim()
    .replace(/\s+/g, '-')              // Remplace espaces par tirets
    .replace(/-+/g, '-');              // Supprime tirets multiples
};

/**
 * Génère un slug unique en ajoutant un suffixe aléatoire
 */
const genererSlugUnique = (texte, suffixeLong = 6) => {
  const slug  = genererSlug(texte);
  const rand  = Math.random().toString(36).substring(2, 2 + suffixeLong);
  return `${slug}-${rand}`;
};

/**
 * Tronque un texte avec ellipsis
 */
const tronquer = (texte, longueur = 100, ellipsis = '...') => {
  if (!texte || texte.length <= longueur) return texte;
  return texte.substring(0, longueur - ellipsis.length) + ellipsis;
};

/**
 * Capitalise la première lettre
 */
const capitaliser = (texte) => {
  if (!texte) return '';
  return texte.charAt(0).toUpperCase() + texte.slice(1).toLowerCase();
};

/**
 * Masque un email pour l'affichage (ex: te***@gmail.com)
 */
const masquerEmail = (email) => {
  if (!email) return '';
  const [local, domaine] = email.split('@');
  const visible = local.slice(0, 2);
  return `${visible}***@${domaine}`;
};

/**
 * Masque un numéro de téléphone (ex: +226 ** ** ** 12)
 */
const masquerTelephone = (tel) => {
  if (!tel) return '';
  const str = tel.replace(/\s/g, '');
  return str.slice(0, -4).replace(/./g, '*') + str.slice(-4);
};

/**
 * Nettoie une chaîne (trim + espaces multiples)
 */
const nettoyer = (texte) => {
  if (!texte) return '';
  return texte.trim().replace(/\s+/g, ' ');
};

/**
 * Génère un code alphanumérique aléatoire
 * Ex: genererCode(6) → "A3F9K2"
 */
const genererCode = (longueur = 6) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: longueur }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
};

/**
 * Génère un code numérique (OTP)
 */
const genererOTP = (longueur = 6) => {
  return String(Math.floor(Math.random() * Math.pow(10, longueur))).padStart(longueur, '0');
};

/**
 * Vérifie si une chaîne est un UUID valide
 */
const estUUID = (str) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

/**
 * Compte les mots d'un texte (pour temps de lecture)
 */
const compterMots = (texte) => {
  if (!texte) return 0;
  return texte.trim().split(/\s+/).filter(Boolean).length;
};

/**
 * Calcule le temps de lecture estimé en minutes (250 mots/min)
 */
const tempsLectureMinutes = (texte, motsPar = 250) => {
  const mots = compterMots(texte);
  return Math.max(1, Math.ceil(mots / motsPar));
};

module.exports = {
  genererSlug,
  genererSlugUnique,
  tronquer,
  capitaliser,
  masquerEmail,
  masquerTelephone,
  nettoyer,
  genererCode,
  genererOTP,
  estUUID,
  compterMots,
  tempsLectureMinutes,
};