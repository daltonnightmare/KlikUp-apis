-- =============================================================================
-- DONNÉES DE TEST POUR LA BASE DE DONNÉES MULTI-SERVICES
-- =============================================================================

-- Désactiver temporairement les contraintes de clés étrangères si nécessaire
-- (optionnel, mais peut aider pour l'ordre d'insertion)
-- SET session_replication_role = 'replica';

-- SECTION 2 : PLATEFORME
INSERT INTO PLATEFORME (nom_plateforme, description_plateforme, logo_plateforme, portefeuille_plateforme) 
VALUES ('Yam Transport & Services', 'Plateforme intégrée de transport, restauration et e-commerce', '/logos/yam-platform.png', 1500000.00);

-- Note: L'ID de la plateforme sera 1 car c'est la première insertion

-- SECTION 3 : COMPAGNIES DE TRANSPORT
-- Maintenant plateforme_id=1 existe
INSERT INTO COMPAGNIESTRANSPORT (nom_compagnie, description_compagnie, logo_compagnie, pourcentage_commission_plateforme, portefeuille_compagnie, plateforme_id) VALUES
('TCRB - Transport en Commun du Burkina', 'Première compagnie de transport public de Ouagadougou', '/logos/tcrb.png', 5.00, 350000.00, 1),
('SOTRACO - Société de Transport Collectif', 'Réseau de bus couvrant tout Ouagadougou', '/logos/sotraco.png', 5.00, 280000.00, 1),
('STK - Transport Express', 'Service de transport rapide et confortable', '/logos/stk.png', 4.50, 420000.00, 1);

-- SECTION 4 : EMPLACEMENTS TRANSPORT
-- Les compagnies 1,2,3 existent maintenant
INSERT INTO EMPLACEMENTSTRANSPORT (nom_emplacement, jours_ouverture_emplacement_transport, portefeuille_emplacement, compagnie_id) VALUES
('Gare de Ouaga 2000', 'LUNDI_DIMANCHE', 45000.00, 1),
('Gare du Centre-ville', 'LUNDI_SAMEDI', 38000.00, 1),
('Gare de Pissy', 'LUNDI_DIMANCHE', 52000.00, 2),
('Gare de Dassasgho', 'LUNDI_VENDREDI', 29000.00, 2),
('Gare de Zogona', 'LUNDI_SAMEDI', 41000.00, 3),
('Gare de Karpala', 'LUNDI_DIMANCHE', 33000.00, 3);

-- SECTION 8 : RESTAURANTS FAST FOOD
INSERT INTO RESTAURANTSFASTFOOD (nom_restaurant_fast_food, description_restaurant_fast_food, logo_restaurant, portefeuille_restaurant_fast_food, plateforme_id, pourcentage_commission_plateforme) VALUES
('Burkina Fast Food', 'Chaîne de restauration rapide moderne', '/logos/bff.png', 150000.00, 1, 8.00),
('Délices de Ouaga', 'Spécialités locales et sandwiches', '/logos/delices.png', 120000.00, 1, 8.00),
('Le Gourmet Express', 'Cuisine rapide de qualité', '/logos/gourmet.png', 180000.00, 1, 7.50);

-- SECTION 9 : EMPLACEMENTS RESTAURANT FAST FOOD
INSERT INTO EMPLACEMENTSRESTAURANTFASTFOOD (nom_emplacement, frais_livraison, portefeuille_emplacement, heure_ouverture, heure_fermeture, jours_ouverture_emplacement_restaurant, id_restaurant_fast_food) VALUES
('BFF Ouaga 2000', 1000.00, 45000.00, '08:00', '22:00', 'LUNDI_DIMANCHE', 1),
('BFF Centre-ville', 800.00, 52000.00, '08:30', '23:00', 'LUNDI_DIMANCHE', 1),
('BFF Pissy', 1200.00, 38000.00, '09:00', '21:00', 'LUNDI_SAMEDI', 1),
('Délices Zone 1', 1000.00, 42000.00, '09:00', '21:30', 'LUNDI_DIMANCHE', 2),
('Délices Koulouba', 800.00, 35000.00, '08:00', '20:00', 'LUNDI_VENDREDI', 2),
('Gourmet Express Dassasgho', 1000.00, 28000.00, '10:00', '22:00', 'LUNDI_DIMANCHE', 3);

-- SECTION 14 : BOUTIQUES
INSERT INTO BOUTIQUES (nom_boutique, description_boutique, logo_boutique, types_produits_vendu, plateforme_id, pourcentage_commission_plateforme, portefeuille_boutique) VALUES
('Boutique Artisanale de Ouaga', 'Produits artisanaux locaux', '/logos/artisanat.png', '["Artisanat", "Textile", "Décoration"]', 1, 10.00, 75000.00),
('Électronique Pro', 'Matériel électronique et accessoires', '/logos/electronique.png', '["Électronique", "Téléphonie", "Informatique"]', 1, 12.00, 120000.00),
('Mode et Beauté', 'Vêtements et cosmétiques', '/logos/mode.png', '["Vêtements", "Cosmétiques", "Accessoires"]', 1, 8.00, 85000.00);

-- SECTION 5 : COMPTES (utilisateurs)
-- Note: Les mots de passe sont hashés avec pgcrypto
INSERT INTO COMPTES (email, mot_de_passe_compte, nom_utilisateur_compte, numero_de_telephone, statut, compte_role) VALUES
('admin@yam.com', crypt('Admin123!', gen_salt('bf')), 'admin_plateforme', '+22670000001', 'EST_AUTHENTIFIE', 'ADMINISTRATEUR_PLATEFORME'),
('paul.kaboré@gmail.com', crypt('Pass123!', gen_salt('bf')), 'paul_kabore', '+22670123456', 'EST_AUTHENTIFIE', 'UTILISATEUR_PRIVE_SIMPLE'),
('marie.ouedraogo@yahoo.fr', crypt('Pass123!', gen_salt('bf')), 'marie_o', '+22671234567', 'EST_AUTHENTIFIE', 'UTILISATEUR_PRIVE_SIMPLE'),
('jean.traore@tcrb.bf', crypt('Pass123!', gen_salt('bf')), 'jean_traore', '+22672234567', 'EST_AUTHENTIFIE', 'STAFF_COMPAGNIE'),
('fatimata.sawadogo@tcrb.bf', crypt('Pass123!', gen_salt('bf')), 'fatimata_s', '+22673234567', 'EST_AUTHENTIFIE', 'ADMINISTRATEUR_COMPAGNIE'),
('michel.zongo@resto.bf', crypt('Pass123!', gen_salt('bf')), 'michel_z', '+22674234567', 'EST_AUTHENTIFIE', 'ADMINISTRATEUR_RESTAURANT_FAST_FOOD'),
('alice.konaté@gmail.com', crypt('Pass123!', gen_salt('bf')), 'alice_konate', '+22675234567', 'EST_AUTHENTIFIE', 'UTILISATEUR_PRIVE_SIMPLE'),
('brigitte.kam@yahoo.com', crypt('Pass123!', gen_salt('bf')), 'brigitte_kam', '+22676234567', 'EST_AUTHENTIFIE', 'UTILISATEUR_PRIVE_SIMPLE'),
('charles.bonkoungou@gmail.com', crypt('Pass123!', gen_salt('bf')), 'charles_b', '+22677234567', 'NON_AUTHENTIFIE', 'UTILISATEUR_PRIVE_SIMPLE'),
('djénéba.diallo@boutique.bf', crypt('Pass123!', gen_salt('bf')), 'djene_diallo', '+22678234567', 'EST_AUTHENTIFIE', 'UTILISATEUR_VENDEUR');

-- Mise à jour des relations compagnie/emplacement/restaurant/boutique
-- Maintenant tous les IDs référencés existent
UPDATE COMPTES SET compagnie_id = 1 WHERE id IN (4, 5);
UPDATE COMPTES SET compagnie_id = 2, emplacement_id = 3 WHERE id = 9;
UPDATE COMPTES SET restaurant_id = 1 WHERE id = 6;
UPDATE COMPTES SET boutique_id = 1 WHERE id = 10;

-- SECTION 6 : TICKETS TRANSPORT
INSERT INTO TICKETSTRANSPORT (nom_produit, description_produit, prix_vente_produit, quantite_stock, quantite_vendu, emplacement_id, compagnie_id, journalier) VALUES
('Ticket Journalier TCRB', 'Ticket valable pour une journée sur toutes les lignes TCRB', 500.00, 1000, 2345, 1, 1, true),
('Ticket Journalier TCRB', 'Ticket valable pour une journée sur toutes les lignes TCRB', 500.00, 800, 1567, 2, 1, true),
('Abonnement Hebdomadaire TCRB', 'Ticket valable pour une semaine', 2500.00, 500, 432, 1, 1, false),
('Ticket Journalier SOTRACO', 'Ticket valable pour une journée sur toutes les lignes SOTRACO', 450.00, 1200, 3456, 3, 2, true),
('Abonnement Mensuel SOTRACO', 'Abonnement valable pour un mois', 8000.00, 300, 234, 3, 2, false),
('Ticket Journalier STK', 'Ticket valable pour une journée sur les lignes STK', 600.00, 900, 1876, 5, 3, true),
('Abonnement Mensuel STK', 'Abonnement valable pour un mois', 9500.00, 200, 98, 5, 3, false),
('Ticket Aller-Retour STK', 'Ticket aller-retour valable pour la journée', 1000.00, 400, 567, 6, 3, true);

-- SECTION 7 : SERVICES TRANSPORT
INSERT INTO SERVICES (nom_service, type_service, donnees_json_service, prix_service, duree_validite_jours, compagnie_id, emplacement_id) VALUES
('Abonnement Étudiant TCRB', 'ABONNEMENT_MENSUEL', '{"reduction": 30, "conditions": "Carte étudiant requise"}', 5600.00, 30, 1, 1),
('Pass Senior TCRB', 'BIMENSUEL', '{"reduction": 40, "conditions": "60 ans et plus"}', 3000.00, 15, 1, 2),
('Abonnement Professionnel SOTRACO', 'TRIMESTRIEL', '{"trajets_illimités": true}', 21000.00, 90, 2, 3),
('Carte de Fidélité STK', 'ANNUEL', '{"points_par_trajet": 10}', 12000.00, 365, 3, 5);

-- SECTION 10 : MENUS RESTAURANT FAST FOOD
INSERT INTO MENURESTAURANTFASTFOOD (nom_menu, description_menu, photo_menu, composition_menu, disponible, prix_menu, temps_preparation_min, stock_disponible, id_restaurant_fast_food_emplacement, categorie_menu) VALUES
('Menu Poulet Braisé', 'Poulet braisé, frites, boisson', '/menus/poulet-braise.jpg', '["1/4 poulet", "Frites moyennes", "Boisson 33cl"]', true, 4500.00, 20, 50, 1, 'PLAT_PRINCIPAL'),
('Menu Poisson Braisé', 'Poisson capitaine, riz, sauce', '/menus/poisson-braise.jpg', '["Poisson capitaine", "Riz blanc", "Sauce spéciale"]', true, 5000.00, 25, 30, 1, 'PLAT_PRINCIPAL'),
('Burger Royal', 'Burger 200g, frites, boisson', '/menus/burger-royal.jpg', '["Burger 200g", "Frites", "Boisson 33cl"]', true, 3500.00, 15, 100, 2, 'BURGER'),
('Tacos Viande', 'Tacos garni viande, frites, sauce', '/menus/tacos-viande.jpg', '["Tacos viande", "Frites", "Sauce blanche"]', true, 3000.00, 12, 80, 2, 'TACOS'),
('Menu Riz Sauce', 'Riz avec sauce au choix', '/menus/riz-sauce.jpg', '["Riz", "Sauce arachide/aubergine", "Viande ou poisson"]', true, 2500.00, 10, 200, 3, 'PLAT_PRINCIPAL'),
('Petit Déjeuner', 'Café, lait, beignets', '/menus/petit-dejeuner.jpg', '["Café", "Lait concentré", "3 beignets"]', true, 1500.00, 5, 150, 3, 'PETIT_DEJEUNER'),
('Pizza Spéciale', 'Pizza garnie, boisson', '/menus/pizza.jpg', '["Pizza moyennne", "Boisson 33cl"]', true, 5500.00, 30, 25, 4, 'PIZZA'),
('Menu Enfant', 'Burger petit format, frites, jouet', '/menus/menu-enfant.jpg', '["Mini-burger", "Petites frites", "Jouet surprise"]', true, 2000.00, 10, 60, 4, 'MENU_ENFANT'),
('Salade César', 'Salade composée, poulet', '/menus/salade-cesar.jpg', '["Salade", "Poulet", "Parmesan"]', true, 2800.00, 10, 40, 5, 'SALADE'),
('Sandwich Thon', 'Sandwich thon-crudités', '/menus/sandwich-thon.jpg', '["Pain", "Thon", "Crudités"]', true, 1800.00, 8, 50, 5, 'SANDWICH');

-- SECTION 11 : PRODUITS INDIVIDUELS RESTAURANT
INSERT INTO PRODUITSINDIVIDUELRESTAURANT (nom_produit, description_produit, prix_produit, stock_disponible, categorie_produit, id_restaurant_fast_food_emplacement, disponible) VALUES
('Brochette de Boeuf', 'Brochette de boeuf épicée', 800.00, 100, 'ALIMENTAIRE', 1, true),
('Frites Portion', 'Portion de frites', 500.00, 200, 'ALIMENTAIRE', 1, true),
('Coca-Cola 33cl', 'Boisson gazeuse', 400.00, 300, 'BOISSON', 2, true),
('Jus Bissap', 'Jus de bissap local', 300.00, 150, 'BOISSON', 2, true),
('Dégé', 'Boisson locale à base de mil', 250.00, 100, 'BOISSON', 3, true),
('Beignet', 'Beignet traditionnel', 100.00, 500, 'ALIMENTAIRE', 3, true);

-- SECTION 12 : PROMOS RESTAURANT FAST FOOD
INSERT INTO PROMOSRESTAURANTFASTFOOD (nom_promo, description_promo, code_promo, type_promo, id_restaurant_fast_food_emplacement, pourcentage_reduction, montant_fixe_reduction, date_debut_promo, date_fin_promo, utilisation_max) VALUES
('Midi Flash', 'Réduction sur les menus du midi', 'MIDI10', 'POURCENTAGE', 1, 10.00, NULL, NOW(), NOW() + INTERVAL '30 days', 500),
('2 menus achetés = 1 offert', 'Spécial groupes', '2POUR1', 'DEUX_POUR_UN', 2, NULL, NULL, NOW(), NOW() + INTERVAL '15 days', 200),
('Fidélité Nouvel An', 'Réduction pour les fidèles', 'NOUVELAN', 'POURCENTAGE', 3, 15.00, NULL, NOW(), '2025-01-15', 300),
('Livraison Offerte', 'Livraison gratuite pour toute commande', 'LIVRAISON', 'LIVRAISON_GRATUITE', 4, NULL, NULL, NOW(), NOW() + INTERVAL '7 days', 100);

INSERT INTO PROMOSMENUS (promo_id, menu_id) VALUES
(1, 1), (1, 2), (1, 3),
(2, 4), (2, 5),
(3, 6), (3, 7),
(4, 8), (4, 9), (4, 10);

-- SECTION 13 : COMMANDES RESTAURANT FAST FOOD
INSERT INTO COMMANDESEMPLACEMENTFASTFOOD (id_restaurant_fast_food_emplacement, compte_id, donnees_commande, prix_sous_total, frais_livraison_commande, remise_appliquee, prix_total_commande, statut_commande, pour_livrer, paiement_direct, date_commande) VALUES
(1, 2, '[{"nom": "Menu Poulet Braisé", "quantite": 2, "prix_unitaire": 4500}, {"nom": "Coca-Cola", "quantite": 2, "prix_unitaire": 400}]', 9800.00, 1000.00, 0.00, 10800.00, 'LIVREE', true, true, NOW() - INTERVAL '2 days'),
(2, 3, '[{"nom": "Burger Royal", "quantite": 1, "prix_unitaire": 3500}, {"nom": "Frites", "quantite": 1, "prix_unitaire": 500}]', 4000.00, 800.00, 0.00, 4800.00, 'PRETE', true, true, NOW() - INTERVAL '1 day'),
(3, 5, '[{"nom": "Menu Riz Sauce", "quantite": 3, "prix_unitaire": 2500}]', 7500.00, 0.00, 750.00, 6750.00, 'EN_PREPARATION', false, false, NOW() - INTERVAL '5 hours'),
(4, 7, '[{"nom": "Pizza Spéciale", "quantite": 1, "prix_unitaire": 5500}, {"nom": "Coca-Cola", "quantite": 2, "prix_unitaire": 400}]', 6300.00, 0.00, 630.00, 5670.00, 'CONFIRMEE', false, true, NOW() - INTERVAL '3 hours'),
(5, 8, '[{"nom": "Salade César", "quantite": 1, "prix_unitaire": 2800}]', 2800.00, 0.00, 280.00, 2520.00, 'EN_ATTENTE', false, false, NOW() - INTERVAL '1 hour');

-- CATÉGORIES BOUTIQUE
INSERT INTO CATEGORIES_BOUTIQUE (nom_categorie, description_categorie, slug_categorie, categorie_parente_id, boutique_id) VALUES
('Artisanat', 'Produits artisanaux', 'artisanat', NULL, 1),
('Textile', 'Tissus et vêtements traditionnels', 'textile', 1, 1),
('Décoration', 'Objets de décoration', 'decoration', 1, 1),
('Téléphonie', 'Téléphones et accessoires', 'telephonie', NULL, 2),
('Informatique', 'Ordinateurs et accessoires', 'informatique', NULL, 2),
('Vêtements', 'Vêtements modernes', 'vetements', NULL, 3),
('Cosmétiques', 'Produits de beauté', 'cosmetiques', 3, 3);

-- PRODUITS BOUTIQUE
INSERT INTO PRODUITSBOUTIQUE (nom_produit, slug_produit, description_produit, prix_unitaire_produit, quantite, id_categorie, id_boutique, est_disponible) VALUES
('Statue Bronze', 'statue-bronze', 'Statue en bronze traditionnelle', 15000.00, 20, 1, 1, true),
('Pagne Faso Dan Fani', 'pagine-faso-dan-fani', 'Pagne traditionnel tissé à la main', 25000.00, 50, 2, 1, true),
('Sac en cuir', 'sac-cuir', 'Sac en cuir artisanal', 35000.00, 15, 3, 1, true),
('iPhone 13', 'iphone-13', 'Smartphone Apple iPhone 13', 450000.00, 5, 4, 2, true),
('Samsung Galaxy S23', 'samsung-s23', 'Smartphone Samsung', 400000.00, 8, 4, 2, true),
('Ordinateur HP', 'hp-pavilion', 'Ordinateur portable HP Pavilion', 350000.00, 3, 5, 2, true),
('Robe Africaine', 'robe-africaine', 'Robe moderne en tissu africain', 18000.00, 25, 6, 3, true),
('Huile de Karité', 'huile-karite', 'Huile de karité pure', 3500.00, 100, 7, 3, true),
('Savon Noir', 'savon-noir', 'Savon noir traditionnel', 2000.00, 200, 7, 3, true);

-- COMMANDES BOUTIQUES
INSERT INTO COMMANDESBOUTIQUES (id_boutique, compte_id, donnees_commandes, prix_sous_total, frais_livraison_commande, remise_appliquee, prix_total_commande, statut_commande, pour_livrer, paiement_direct, date_commande) VALUES
(1, 2, '[{"nom": "Statue Bronze", "quantite": 1, "prix_unitaire": 15000}, {"nom": "Sac en cuir", "quantite": 1, "prix_unitaire": 35000}]', 50000.00, 2000.00, 0.00, 52000.00, 'LIVREE', true, true, NOW() - INTERVAL '5 days'),
(2, 3, '[{"nom": "iPhone 13", "quantite": 1, "prix_unitaire": 450000}]', 450000.00, 0.00, 0.00, 450000.00, 'RECUPEREE', false, true, NOW() - INTERVAL '2 days'),
(3, 7, '[{"nom": "Robe Africaine", "quantite": 2, "prix_unitaire": 18000}, {"nom": "Huile de Karité", "quantite": 3, "prix_unitaire": 3500}]', 46500.00, 1500.00, 0.00, 48000.00, 'EN_LIVRAISON', true, false, NOW() - INTERVAL '1 day');

-- SECTION 15 : SERVICES LIVRAISON
INSERT INTO ENTREPRISE_LIVRAISON (nom_entreprise_livraison, description_entreprise_livraison, logo_entreprise_livraison, pourcentage_commission_plateforme, portefeuille_entreprise_livraison, plateforme_id) VALUES
('Yam Express', 'Service de livraison rapide partenaire', '/logos/yam-express.png', 3.00, 45000.00, 1),
('Ouaga Livraison', 'Livraison dans tout Ouagadougou', '/logos/ouaga-livraison.png', 2.50, 38000.00, 1);

INSERT INTO SERVICES_LIVRAISON (nom_service, type_service, description_service, prix_service, prix_par_km, distance_max_km, id_entreprise_livraison) VALUES
('Livraison Standard', 'STANDARD', 'Livraison en 24h', 1000.00, 100.00, 20.00, 1),
('Livraison Express', 'EXPRESS', 'Livraison en 2h', 2500.00, 200.00, 15.00, 1),
('Livraison Programmée', 'PROGRAMMEE', 'Livraison à date choisie', 1500.00, 150.00, 25.00, 2),
('Livraison Week-end', 'WEEKEND', 'Livraison samedi/dimanche', 2000.00, 150.00, 20.00, 2);

INSERT INTO LIVREURS (nom_livreur, prenom_livreur, numero_telephone_livreur, id_entreprise_livraison, est_disponible, note_moyenne, nombre_livraisons) VALUES
('Ouédraogo', 'Adama', '+22670123451', 1, true, 4.5, 150),
('Traoré', 'Moussa', '+22670123452', 1, true, 4.8, 200),
('Sawadogo', 'Bakary', '+22670123453', 1, false, 4.2, 80),
('Zongo', 'Issa', '+22670123454', 2, true, 4.9, 320),
('Kaboré', 'Souleymane', '+22670123455', 2, true, 4.6, 180);

-- SECTION 16 : ACHATS TICKETS ET SERVICES
INSERT INTO ACHATSTICKETSPRIVE (compte_id, ticket_id, quantite, prix_achat_unitaire_ticket, total_transaction, date_achat_prive, est_actif) VALUES
(2, 1, 5, 500.00, 2500.00, NOW() - INTERVAL '10 days', true),
(2, 3, 1, 2500.00, 2500.00, NOW() - INTERVAL '8 days', true),
(3, 4, 10, 450.00, 4500.00, NOW() - INTERVAL '5 days', true),
(7, 6, 20, 600.00, 12000.00, NOW() - INTERVAL '3 days', true),
(8, 2, 5, 500.00, 2500.00, NOW() - INTERVAL '2 days', true);

INSERT INTO ACHATSSERVICESPRIVE (service_id, compte_id, prix_achat_service, date_achat_service, est_actif) VALUES
(1, 2, 5600.00, NOW() - INTERVAL '15 days', true),
(3, 3, 21000.00, NOW() - INTERVAL '30 days', true),
(2, 7, 3000.00, NOW() - INTERVAL '10 days', true);

-- SECTION 17 : DEMANDES DE SERVICE
INSERT INTO DEMANDESERVICE (compte_id, service_id, compagnie_id, prix_total, statut_demande, est_valide_par_emplacement, est_valide_par_compagnie, date_demande) VALUES
(9, 2, 2, 3000.00, 'APPROUVEE', true, true, NOW() - INTERVAL '20 days'),
(4, 1, 1, 5600.00, 'APPROUVEE', true, true, NOW() - INTERVAL '45 days'),
(8, 3, 2, 21000.00, 'EN_ATTENTE', false, false, NOW() - INTERVAL '5 days');

-- SECTION 18 : BLOG
INSERT INTO ARTICLES_BLOG_PLATEFORME (titre_article, sous_titre, slug, contenu_article, extrait_contenu, image_principale, categorie_principale, statut, visibilite, est_epingle, date_publication, auteur_id, plateforme_id, nombre_vues, nombre_likes, temps_lecture_minutes) VALUES
('Guide complet des transports à Ouagadougou', 'Comment se déplacer facilement dans la capitale', 'guide-transports-ouaga', '<p>Découvrez tous les moyens de transport disponibles...</p>', 'Un guide pratique pour naviguer dans la ville', '/images/guide-transport.jpg', 'GUIDE', 'PUBLIE', 'PUBLIC', true, NOW() - INTERVAL '10 days', 1, 1, 1250, 85, 8),
('Top 5 des meilleurs restaurants fast-food', 'Où manger rapidement et bien à Ouaga', 'top-5-fastfood-ouaga', '<p>Notre sélection des meilleurs endroits...</p>', 'Les adresses incontournables', '/images/top-fastfood.jpg', 'TEST_PRODUIT', 'PUBLIE', 'PUBLIC', false, NOW() - INTERVAL '5 days', 2, 1, 850, 42, 5),
('Nouveauté : Service de livraison étendu', 'Yam Express couvre désormais tous les quartiers', 'livraison-etendue', '<p>Nous sommes heureux d annoncer...</p>', 'Plus de zones desservies', '/images/livraison.jpg', 'ACTUALITE', 'PUBLIE', 'PUBLIC', false, NOW() - INTERVAL '2 days', 1, 1, 320, 18, 3),
('Comment utiliser les tickets électroniques', 'Tutoriel pour les nouveaux utilisateurs', 'tutoriel-tickets', '<p>Suivez ce guide pas à pas...</p>', 'Devenez expert en tickets', '/images/tutoriel.jpg', 'TUTORIEL', 'PROGRAMME', 'PUBLIC', false, NOW() + INTERVAL '2 days', 3, 1, 0, 0, 6);

-- COMMENTAIRES
INSERT INTO COMMENTAIRES (contenu_commentaire, article_id, auteur_id, statut, note, date_creation, nombre_likes) VALUES
('Excellent article, très utile !', 1, 3, 'APPROUVE', 5, NOW() - INTERVAL '9 days', 12),
('Merci pour ces informations', 1, 4, 'APPROUVE', 4, NOW() - INTERVAL '8 days', 5),
('Je ne suis pas d accord avec le classement', 2, 7, 'APPROUVE', 3, NOW() - INTERVAL '4 days', 2),
('Superbe découverte, le restaurant à essayer !', 2, 8, 'APPROUVE', 5, NOW() - INTERVAL '3 days', 8),
('Quand est-ce que le service arrive à Pissy ?', 3, 9, 'EN_ATTENTE', NULL, NOW() - INTERVAL '1 day', 0);

-- LIKES ARTICLES
INSERT INTO LIKES_ARTICLES (article_id, compte_id, type_like) VALUES
(1, 2, 'LIKE'), (1, 3, 'LIKE'), (1, 4, 'LIKE'), (1, 5, 'LIKE'), (1, 7, 'LIKE'),
(2, 2, 'LIKE'), (2, 3, 'LIKE'), (2, 8, 'LIKE'), (2, 9, 'DISLIKE'),
(3, 5, 'LIKE'), (3, 7, 'LIKE');

-- SECTION 19 : MESSAGERIE
INSERT INTO CONVERSATIONS (type_conversation, titre_conversation, est_prive, cree_par, nombre_participants) VALUES
('DIRECT', NULL, true, 1, 2),
('DIRECT', NULL, true, 2, 2),
('GROUPE', 'Équipe TCRB', false, 5, 3),
('SUPPORT', 'Support Client', true, 1, 2),
('COMMANDE', 'Commande BFF #1', true, 2, 2);

INSERT INTO PARTICIPANTS_CONVERSATION (conversation_id, compte_id, role_participant, est_actif) VALUES
(1, 1, 'PARTICIPANT', true), (1, 2, 'PARTICIPANT', true),
(2, 2, 'PARTICIPANT', true), (2, 3, 'PARTICIPANT', true),
(3, 5, 'ADMIN', true), (3, 4, 'PARTICIPANT', true), (3, 9, 'PARTICIPANT', true),
(4, 1, 'PARTICIPANT', true), (4, 7, 'PARTICIPANT', true),
(5, 2, 'PARTICIPANT', true), (5, 6, 'PARTICIPANT', true);

INSERT INTO MESSAGES (conversation_id, expediteur_id, contenu_message, type_message, date_envoi) VALUES
(1, 1, 'Bonjour, comment puis-je vous aider ?', 'TEXTE', NOW() - INTERVAL '2 days'),
(1, 2, 'Bonjour, j''ai un problème avec mon compte', 'TEXTE', NOW() - INTERVAL '2 days'),
(1, 1, 'Je vous écoute', 'TEXTE', NOW() - INTERVAL '2 days'),
(1, 2, 'Je n''arrive pas à acheter des tickets', 'TEXTE', NOW() - INTERVAL '2 days'),
(1, 1, 'Avez-vous essayé de vider le cache ?', 'TEXTE', NOW() - INTERVAL '2 days'),
(2, 2, 'Salut, ça va ?', 'TEXTE', NOW() - INTERVAL '1 day'),
(2, 3, 'Oui et toi ?', 'TEXTE', NOW() - INTERVAL '1 day'),
(3, 5, 'Réunion demain à 10h', 'TEXTE', NOW() - INTERVAL '12 hours'),
(3, 4, 'OK pour moi', 'TEXTE', NOW() - INTERVAL '11 hours'),
(3, 9, 'Je serai présent', 'TEXTE', NOW() - INTERVAL '11 hours'),
(4, 7, 'Ma commande est en retard', 'TEXTE', NOW() - INTERVAL '3 hours'),
(4, 1, 'Je vérifie immédiatement', 'TEXTE', NOW() - INTERVAL '3 hours'),
(5, 2, 'Ma commande est-elle prête ?', 'TEXTE', NOW() - INTERVAL '2 hours'),
(5, 6, 'Oui, vous pouvez passer', 'TEXTE', NOW() - INTERVAL '2 hours');

-- SECTION 20 : HISTORIQUES & TRANSACTIONS
INSERT INTO HISTORIQUE_TRANSACTIONS (type_transaction, montant, statut_transaction, compte_source_id, commande_rff_id, commande_boutique_id, description, date_transaction) VALUES
('ACHAT', 10800.00, 'COMPLETEE', 2, 1, NULL, 'Paiement commande BFF', NOW() - INTERVAL '2 days'),
('ACHAT', 4800.00, 'COMPLETEE', 3, 2, NULL, 'Paiement commande Delices', NOW() - INTERVAL '1 day'),
('ACHAT', 52000.00, 'COMPLETEE', 2, NULL, 1, 'Paiement boutique artisanat', NOW() - INTERVAL '5 days'),
('ACHAT', 450000.00, 'COMPLETEE', 3, NULL, 2, 'Achat iPhone', NOW() - INTERVAL '2 days'),
('COMMISSION', 864.00, 'COMPLETEE', NULL, 1, NULL, 'Commission plateforme', NOW() - INTERVAL '2 days');

INSERT INTO HISTORIQUE_CONNEXIONS (compte_id, type_connexion, adresse_ip, statut_connexion, date_connexion) VALUES
(1, 'CONNEXION', '192.168.1.1', 'SUCCESS', NOW() - INTERVAL '2 hours'),
(2, 'CONNEXION', '192.168.1.2', 'SUCCESS', NOW() - INTERVAL '5 hours'),
(3, 'CONNEXION', '192.168.1.3', 'SUCCESS', NOW() - INTERVAL '1 day'),
(4, 'CONNEXION', '192.168.1.4', 'SUCCESS', NOW() - INTERVAL '3 hours'),
(5, 'CONNEXION', '192.168.1.5', 'SUCCESS', NOW() - INTERVAL '2 days'),
(9, 'CONNEXION', '192.168.1.9', 'FAILED', NOW() - INTERVAL '30 minutes');

-- SECTION 21 : ADRESSES
INSERT INTO ADRESSES (libelle, ligne_1, quartier, ville, coordonnees) VALUES
('Domicile Paul', 'Av. Charles de Gaulle', 'Ouaga 2000', 'Ouagadougou', ST_SetSRID(ST_MakePoint(-1.533, 12.358), 4326)),
('Domicile Marie', 'Rue 12.34', 'Zone du Bois', 'Ouagadougou', ST_SetSRID(ST_MakePoint(-1.523, 12.371), 4326)),
('Bureau Jean', 'Immeuble TCRB', 'Centre-ville', 'Ouagadougou', ST_SetSRID(ST_MakePoint(-1.517, 12.365), 4326)),
('BFF Ouaga 2000', 'Route de l''aéroport', 'Ouaga 2000', 'Ouagadougou', ST_SetSRID(ST_MakePoint(-1.542, 12.348), 4326)),
('Boutique Artisanale', 'Marché central', 'Centre-ville', 'Ouagadougou', ST_SetSRID(ST_MakePoint(-1.514, 12.371), 4326));

INSERT INTO ADRESSES_ENTITES (adresse_id, entite_type, entite_id, type_adresse) VALUES
(1, 'COMPTE', 2, 'PRINCIPALE'),
(2, 'COMPTE', 3, 'PRINCIPALE'),
(3, 'COMPTE', 4, 'PRINCIPALE'),
(4, 'EMPLACEMENT_RESTAURANT', 1, 'PRINCIPALE'),
(5, 'BOUTIQUE', 1, 'PRINCIPALE');

-- Mise à jour des adresses de livraison dans les commandes
UPDATE COMMANDESEMPLACEMENTFASTFOOD SET adresse_livraison_id = 1 WHERE id = 1;
UPDATE COMMANDESEMPLACEMENTFASTFOOD SET adresse_livraison_id = 2 WHERE id = 2;
UPDATE COMMANDESBOUTIQUES SET adresse_livraison_id = 1 WHERE id = 1;
UPDATE COMMANDESBOUTIQUES SET adresse_livraison_id = 2 WHERE id = 3;

-- SECTION 22 : SYSTÈME DE NOTATION / AVIS
INSERT INTO AVIS (entite_type, entite_id, auteur_id, note_globale, note_qualite, note_service, note_rapport_prix, titre, contenu, statut, est_achat_verifie, date_creation) VALUES
('RESTAURANT_FAST_FOOD', 1, 2, 4, 5, 4, 4, 'Très bon restaurant', 'Service rapide et plats délicieux', 'PUBLIE', true, NOW() - INTERVAL '5 days'),
('EMPLACEMENT_RESTAURANT', 1, 3, 5, 5, 5, 5, 'Excellent !', 'Le meilleur fast-food de Ouaga', 'PUBLIE', true, NOW() - INTERVAL '3 days'),
('BOUTIQUE', 1, 2, 5, 5, 4, 5, 'Artisanat de qualité', 'Très beaux produits', 'PUBLIE', true, NOW() - INTERVAL '10 days'),
('PRODUIT_BOUTIQUE', 3, 7, 4, 4, 5, 4, 'Très beau sac', 'Cuir de bonne qualité', 'PUBLIE', true, NOW() - INTERVAL '4 days'),
('COMPAGNIE_TRANSPORT', 1, 8, 3, 4, 3, 3, 'Correct', 'Service correct mais bus souvent en retard', 'PUBLIE', false, NOW() - INTERVAL '2 days');

INSERT INTO VOTES_AVIS (avis_id, compte_id, est_utile, date_vote) VALUES
(1, 3, true, NOW() - INTERVAL '4 days'),
(1, 5, true, NOW() - INTERVAL '4 days'),
(2, 7, true, NOW() - INTERVAL '2 days'),
(3, 8, true, NOW() - INTERVAL '9 days'),
(4, 2, false, NOW() - INTERVAL '3 days');

-- SECTION 23 : HORAIRES
INSERT INTO HORAIRES (entite_type, entite_id, jour_semaine, heure_ouverture, heure_fermeture, est_ouvert) VALUES
('EMPLACEMENT_RESTAURANT', 1, 0, '08:00', '22:00', true),
('EMPLACEMENT_RESTAURANT', 1, 1, '08:00', '22:00', true),
('EMPLACEMENT_RESTAURANT', 1, 2, '08:00', '22:00', true),
('EMPLACEMENT_RESTAURANT', 1, 3, '08:00', '22:00', true),
('EMPLACEMENT_RESTAURANT', 1, 4, '08:00', '22:00', true),
('EMPLACEMENT_RESTAURANT', 1, 5, '08:00', '23:00', true),
('EMPLACEMENT_RESTAURANT', 1, 6, '09:00', '23:00', true),
('EMPLACEMENT_TRANSPORT', 1, 0, '05:30', '22:00', true),
('EMPLACEMENT_TRANSPORT', 1, 1, '05:00', '23:00', true),
('EMPLACEMENT_TRANSPORT', 1, 2, '05:00', '23:00', true),
('EMPLACEMENT_TRANSPORT', 1, 3, '05:00', '23:00', true),
('EMPLACEMENT_TRANSPORT', 1, 4, '05:00', '23:00', true),
('EMPLACEMENT_TRANSPORT', 1, 5, '05:00', '23:00', true),
('EMPLACEMENT_TRANSPORT', 1, 6, '05:30', '22:00', true);

INSERT INTO HORAIRES_EXCEPTIONS (entite_type, entite_id, date_exception, libelle, est_ouvert, heure_ouverture, heure_fermeture, motif) VALUES
('EMPLACEMENT_RESTAURANT', 1, '2024-12-25', 'Noël', false, NULL, NULL, 'Fermeture exceptionnelle'),
('EMPLACEMENT_RESTAURANT', 1, '2025-01-01', 'Nouvel An', false, NULL, NULL, 'Fermeture exceptionnelle');

INSERT INTO JOURS_FERIES (date_ferie, libelle, est_recurrent) VALUES
('2024-01-01', 'Nouvel An', true),
('2024-03-08', 'Journée Internationale de la Femme', true),
('2024-05-01', 'Fête du Travail', true),
('2024-08-15', 'Assomption', true),
('2024-12-25', 'Noël', true);

-- SECTION 24 : PARRAINAGE / FIDÉLITÉ
INSERT INTO PROGRAMMES_FIDELITE (entite_type, entite_id, nom_programme, description, points_par_tranche, montant_tranche, valeur_point_fcfa, est_actif) VALUES
('PLATEFORME', 1, 'Fidélité Yam', 'Programme de fidélité global', 1, 1000, 5.00, true),
('RESTAURANT_FAST_FOOD', 1, 'BFF Rewards', 'Points sur chaque achat BFF', 1, 500, 2.50, true),
('BOUTIQUE', 1, 'Club Artisanat', 'Fidélité boutique artisanale', 1, 2000, 10.00, true);

INSERT INTO SOLDES_FIDELITE (compte_id, programme_id, points_actuels, points_cumules, niveau_actuel, date_derniere_activite) VALUES
(2, 1, 150, 450, 'ARGENT', NOW() - INTERVAL '2 days'),
(2, 2, 75, 200, 'BRONZE', NOW() - INTERVAL '2 days'),
(3, 1, 80, 350, 'BRONZE', NOW() - INTERVAL '3 days'),
(3, 3, 45, 120, 'BRONZE', NOW() - INTERVAL '5 days'),
(7, 1, 200, 600, 'ARGENT', NOW() - INTERVAL '1 day'),
(7, 2, 95, 250, 'BRONZE', NOW() - INTERVAL '1 day');

INSERT INTO MOUVEMENTS_POINTS (solde_id, type_mouvement, points, points_avant, points_apres, reference_type, description, date_mouvement) VALUES
(1, 'GAIN_ACHAT', 50, 100, 150, 'COMMANDE_RFF', 'Achat BFF', NOW() - INTERVAL '2 days'),
(2, 'GAIN_ACHAT', 25, 50, 75, 'COMMANDE_RFF', 'Achat BFF', NOW() - INTERVAL '2 days'),
(3, 'GAIN_ACHAT', 30, 50, 80, 'COMMANDE_BTQ', 'Achat boutique', NOW() - INTERVAL '3 days'),
(4, 'GAIN_PARRAINAGE', 100, 100, 200, 'PARRAINAGE', 'Parrainage réussi', NOW() - INTERVAL '10 days'),
(5, 'UTILISATION', -50, 250, 200, 'REDUCTION', 'Utilisation points', NOW() - INTERVAL '1 day');

INSERT INTO PARRAINAGES (parrain_id, filleul_id, code_parrainage, points_parrain, points_filleul, bonus_fcfa_parrain, statut, date_creation) VALUES
(2, 7, 'PAUL2024', 100, 50, 500.00, 'CONVERTI', NOW() - INTERVAL '15 days'),
(2, 8, 'PAUL2025', 0, 0, 0, 'EN_ATTENTE', NOW() - INTERVAL '5 days'),
(3, 9, 'MARIE2024', 100, 50, 500.00, 'CONVERTI', NOW() - INTERVAL '20 days');

-- SECTION 25 : NOTIFICATIONS
INSERT INTO MODELES_NOTIFICATIONS (code, titre_template, corps_template, canal_defaut, priorite_defaut) VALUES
('COMMANDE_CONFIRMEE', 'Commande confirmée', 'Votre commande #{reference} a été confirmée', 'IN_APP', 'NORMALE'),
('COMMANDE_LIVREE', 'Commande livrée', 'Votre commande #{reference} a été livrée', 'PUSH_MOBILE', 'HAUTE'),
('PROMO_NEW', 'Nouvelle promotion', 'Profitez de #{nom_promo} chez #{restaurant}', 'EMAIL', 'BASSE'),
('MESSAGE_RECU', 'Nouveau message', 'Vous avez reçu un message de #{expediteur}', 'IN_APP', 'NORMALE');

INSERT INTO NOTIFICATIONS (destinataire_id, modele_id, titre, corps, action_type, action_id, canal, est_lue, date_creation) VALUES
(2, 1, 'Commande confirmée', 'Votre commande #CMD-RFF-20241215-000001 a été confirmée', 'COMMANDE_RFF', 1, 'IN_APP', true, NOW() - INTERVAL '2 days'),
(2, 2, 'Commande livrée', 'Votre commande #CMD-RFF-20241215-000001 a été livrée', 'COMMANDE_RFF', 1, 'PUSH_MOBILE', true, NOW() - INTERVAL '2 days'),
(3, 1, 'Commande confirmée', 'Votre commande #CMD-RFF-20241216-000002 a été confirmée', 'COMMANDE_RFF', 2, 'IN_APP', true, NOW() - INTERVAL '1 day'),
(2, 3, 'Nouvelle promotion', 'Profitez de Midi Flash chez BFF Ouaga 2000', 'PROMO', 1, 'EMAIL', false, NOW() - INTERVAL '12 hours'),
(7, 4, 'Nouveau message', 'Vous avez reçu un message de admin_plateforme', 'MESSAGE', 4, 'IN_APP', false, NOW() - INTERVAL '3 hours');

-- SECTION 26 : GESTION DES DOCUMENTS
INSERT INTO DOCUMENTS (type_document, nom_fichier, chemin_fichier, mime_type, taille_fichier, entite_type, entite_id, statut) VALUES
('CNI_RECTO', 'cni_paul_recto.jpg', '/documents/cni/paul_kabore_recto.jpg', 'image/jpeg', 245760, 'COMPTE', 2, 'VALIDE'),
('CNI_VERSO', 'cni_paul_verso.jpg', '/documents/cni/paul_kabore_verso.jpg', 'image/jpeg', 235520, 'COMPTE', 2, 'VALIDE'),
('PASSEPORT', 'passeport_marie.pdf', '/documents/passeport/marie_o.pdf', 'application/pdf', 1048576, 'COMPTE', 3, 'EN_ATTENTE_VALIDATION'),
('REGISTRE_COMMERCE', 'rc_bff.pdf', '/documents/rc/restaurant_bff.pdf', 'application/pdf', 2097152, 'RESTAURANT_FAST_FOOD', 1, 'VALIDE'),
('ATTESTATION_FISCALE', 'attestation_boutique.pdf', '/documents/fiscal/boutique_artisanat.pdf', 'application/pdf', 1572864, 'BOUTIQUE', 1, 'EN_ATTENTE_VALIDATION');

-- SECTION 27 : CONFIGURATIONS
INSERT INTO CONFIGURATIONS (entite_type, entite_id, cle, valeur, type_valeur, description, est_public) VALUES
('PLATEFORME', 1, 'frais_livraison_base', '1000', 'INTEGER', 'Frais de livraison de base', true),
('PLATEFORME', 1, 'devise', 'XOF', 'TEXT', 'Devise utilisée', true),
('PLATEFORME', 1, 'taux_tva', '18.0', 'DECIMAL', 'Taux de TVA applicable', false),
('RESTAURANT_FAST_FOOD', 1, 'temps_preparation_max', '45', 'INTEGER', 'Temps max préparation (minutes)', false),
('COMPAGNIE_TRANSPORT', 1, 'tarif_nuit', '600', 'INTEGER', 'Tarif majoré nuit', true);

-- SECTION 28 : SÉCURITÉ ET AUDIT
INSERT INTO SESSIONS (compte_id, token_hash, refresh_token_hash, adresse_ip, user_agent, est_active, date_creation, date_expiration) VALUES
(1, encode(sha256('token1'::bytea), 'hex'), encode(sha256('refresh1'::bytea), 'hex'), '192.168.1.1', 'Mozilla/5.0', true, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '23 hours'),
(2, encode(sha256('token2'::bytea), 'hex'), encode(sha256('refresh2'::bytea), 'hex'), '192.168.1.2', 'Mozilla/5.0', true, NOW() - INTERVAL '5 hours', NOW() + INTERVAL '19 hours'),
(3, encode(sha256('token3'::bytea), 'hex'), encode(sha256('refresh3'::bytea), 'hex'), '192.168.1.3', 'iPhone Safari', true, NOW() - INTERVAL '1 day', NOW() + INTERVAL '23 hours'),
(9, encode(sha256('token9'::bytea), 'hex'), encode(sha256('refresh9'::bytea), 'hex'), '192.168.1.9', 'Mozilla/5.0', false, NOW() - INTERVAL '30 minutes', NOW() + INTERVAL '23 hours 30 minutes');

INSERT INTO ALERTES_SECURITE (type_alerte, severite, compte_id, adresse_ip, details, est_traitee) VALUES
('TENTATIVES_MULTIPLES', 'MOYEN', 9, '192.168.1.9', '{"tentatives": 3, "fenetre": "5 minutes"}', false),
('CONNEXION_NOUVELLE_IP', 'FAIBLE', 2, '192.168.1.100', '{"ip_habituelle": "192.168.1.2"}', true),
('BRUTE_FORCE', 'ELEVE', NULL, '192.168.2.50', '{"tentatives": 15, "cibles": ["admin@yam.com", "paul.kaboré@gmail.com"]}', false);

-- =============================================================================
-- RAFFRAÎCHISSEMENT DES VUES MATÉRIALISÉES
-- =============================================================================

REFRESH MATERIALIZED VIEW VUE_NOTES_MOYENNES;

-- =============================================================================
-- VÉRIFICATION DE L'INTÉGRITÉ DES DONNÉES
-- =============================================================================

-- Vérification des comptes et leurs rôles
SELECT id, nom_utilisateur_compte, compte_role, compagnie_id, restaurant_id, boutique_id
FROM COMPTES
ORDER BY id;

-- Vérification des commandes et leurs statuts
SELECT 'RESTAURANT' as type, reference_commande, statut_commande, prix_total_commande
FROM COMMANDESEMPLACEMENTFASTFOOD
UNION ALL
SELECT 'BOUTIQUE' as type, reference_commande, statut_commande, prix_total_commande
FROM COMMANDESBOUTIQUES
ORDER BY type, reference_commande;

-- Vérification des portefeuilles
SELECT * FROM VUE_PORTEFEUILLES_CONSOLIDES
ORDER BY entite_type, solde DESC;

-- Vérification des notes moyennes
SELECT * FROM VUE_NOTES_MOYENNES
ORDER BY note_moyenne DESC;

-- Vérification des articles publiés
SELECT titre_article, categorie_principale, statut, nombre_vues, nombre_likes
FROM ARTICLES_BLOG_PLATEFORME
WHERE statut = 'PUBLIE'
ORDER BY date_publication DESC;

-- Réactiver les contraintes si elles ont été désactivées
-- SET session_replication_role = 'origin';