-- Heritage Splitter — Données de démo
-- Usage: sqlite3 backend/heritage.db < scripts/seed.sql

-- ============================================================
-- UTILISATEURS (3 bots avec de vraies adresses MetaMask)
-- ============================================================
INSERT OR IGNORE INTO users (id, wallet_address, display_name, role, bio, avatar_url, is_bot, created_at)
VALUES
  ('u-producer-01', '0x2D641F4Aa137787e3BD34B132bb21E54c437eF6F', 'Pierre Durand',       'producer', 'Producteur d''art contemporain, spécialisé dans les éditions limitées.', '', 1, datetime('now')),
  ('u-artist-01',   '0x1BbC56f627b1e759AFc79eEC651a840fF8D09621', 'Marie Lefèvre',       'artist',   'Artiste plasticienne, travaille le numérique et la photographie.', '', 1, datetime('now')),
  ('u-gallery-01',  '0x1c3cA0b7d45A4DcfE0E25F83b7731f523F564C38', 'Galerie Rive Gauche', 'gallery',  'Galerie d''art contemporain, Paris 6e.', '', 1, datetime('now'));

-- ============================================================
-- PROJET 1 : Lumières de Paris (approuvé, complet)
-- Créateur: Pierre (producer)
-- Participants: Marie (artiste), Galerie (galerie), Pierre (droit de suite)
-- ============================================================
INSERT OR IGNORE INTO projects (id, name, description, status, creator_id, royalty_bps, created_at)
VALUES
  ('p-demo-01', 'Lumières de Paris',
   'Collection de 10 photographies d''art capturant Paris de nuit. Édition limitée avec certificat d''authenticité phygital.',
   'approved', 'u-producer-01', 1000, datetime('now', '-10 days'));

INSERT OR IGNORE INTO allocations (id, project_id, role, label, total_bps, max_slots, distribution_mode, sort_order, receives_primary)
VALUES
  ('a-01-artists',  'p-demo-01', 'artist',        'Artistes',       6500, 2, 'equal', 0, 0),
  ('a-01-gallery',  'p-demo-01', 'gallery',       'Galerie',        2000, 1, 'equal', 1, 1),
  ('a-01-producer', 'p-demo-01', 'droit_de_suite','Droit de suite', 1500, 1, 'equal', 2, 0);

INSERT OR IGNORE INTO participants (id, project_id, user_id, wallet_address, role, shares_bps, status, allocation_id, invited_at, accepted_at)
VALUES
  ('pt-01', 'p-demo-01', 'u-artist-01',   '0x1BbC56f627b1e759AFc79eEC651a840fF8D09621', 'artist',        6500, 'accepted', 'a-01-artists',  datetime('now', '-10 days'), datetime('now', '-9 days')),
  ('pt-03', 'p-demo-01', 'u-gallery-01',  '0x1c3cA0b7d45A4DcfE0E25F83b7731f523F564C38', 'gallery',       2000, 'accepted', 'a-01-gallery',  datetime('now', '-10 days'), datetime('now', '-8 days')),
  ('pt-04', 'p-demo-01', 'u-producer-01', '0x2D641F4Aa137787e3BD34B132bb21E54c437eF6F', 'droit_de_suite', 1500, 'accepted', 'a-01-producer', datetime('now', '-10 days'), datetime('now', '-10 days'));

-- ============================================================
-- PROJET 2 : Regards Croisés (brouillon, 4 places artistes ouvertes)
-- Créateur: Galerie Rive Gauche
-- Participants: Marie (1 artiste sur 5)
-- ============================================================
INSERT OR IGNORE INTO projects (id, name, description, status, creator_id, royalty_bps, created_at)
VALUES
  ('p-demo-03', 'Regards Croisés',
   'Exposition collective mêlant peinture, photo et vidéo autour du thème de l''identité urbaine. 5 artistes, une galerie, une vision.',
   'draft', 'u-gallery-01', 1200, datetime('now', '-3 days'));

INSERT OR IGNORE INTO allocations (id, project_id, role, label, total_bps, max_slots, distribution_mode, sort_order, receives_primary)
VALUES
  ('a-03-artists',  'p-demo-03', 'artist',   'Artistes exposés',      7000, 5, 'equal', 0, 0),
  ('a-03-gallery',  'p-demo-03', 'gallery',  'Galerie organisatrice', 3000, 1, 'equal', 1, 1);

INSERT OR IGNORE INTO participants (id, project_id, user_id, wallet_address, role, shares_bps, status, allocation_id, invited_at, accepted_at)
VALUES
  ('pt-10', 'p-demo-03', 'u-artist-01', '0x1BbC56f627b1e759AFc79eEC651a840fF8D09621', 'artist', 7000, 'accepted', 'a-03-artists', datetime('now', '-3 days'), datetime('now', '-2 days'));

-- ============================================================
-- PROJET 3 : Fragments d'Ailleurs (brouillon, places ouvertes)
-- Créateur: Pierre (producer)
-- Participants: Marie (artiste), Galerie (galerie)
-- ============================================================
INSERT OR IGNORE INTO projects (id, name, description, status, creator_id, royalty_bps, created_at)
VALUES
  ('p-demo-05', 'Fragments d''Ailleurs',
   'Série limitée de 20 oeuvres numériques inspirées de voyages. Chaque NFT inclut un tirage physique signé. Dernière place artiste disponible !',
   'draft', 'u-producer-01', 1000, datetime('now', '-7 days'));

INSERT OR IGNORE INTO allocations (id, project_id, role, label, total_bps, max_slots, distribution_mode, sort_order, receives_primary)
VALUES
  ('a-05-artists',  'p-demo-05', 'artist',  'Artistes voyageurs', 5000, 3, 'equal', 0, 0),
  ('a-05-gallery',  'p-demo-05', 'gallery', 'Galerie',            3000, 1, 'equal', 1, 1),
  ('a-05-producer', 'p-demo-05', 'producer','Production',          2000, 1, 'equal', 2, 0);

INSERT OR IGNORE INTO participants (id, project_id, user_id, wallet_address, role, shares_bps, status, allocation_id, invited_at, accepted_at)
VALUES
  ('pt-21', 'p-demo-05', 'u-artist-01',  '0x1BbC56f627b1e759AFc79eEC651a840fF8D09621', 'artist',  2500, 'accepted', 'a-05-artists', datetime('now', '-6 days'), datetime('now', '-5 days')),
  ('pt-22', 'p-demo-05', 'u-gallery-01', '0x1c3cA0b7d45A4DcfE0E25F83b7731f523F564C38', 'gallery', 3000, 'accepted', 'a-05-gallery', datetime('now', '-7 days'), datetime('now', '-6 days'));

-- ============================================================
-- PROJET 4 : Néon Baroque (déployé — inscriptions fermées)
-- Créateur: Marie (artiste)
-- Participants: Galerie, Pierre (producer)
-- ============================================================
INSERT OR IGNORE INTO projects (id, name, description, status, creator_id, royalty_bps, contract_nft_address, contract_splitter_address, created_at)
VALUES
  ('p-demo-06', 'Néon Baroque',
   'Collection de 5 oeuvres grand format mêlant néons et dorures. Déjà déployée sur la blockchain Avalanche.',
   'deployed', 'u-artist-01', 1500,
   '0x1234567890abcdef1234567890abcdef12345678',
   '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
   datetime('now', '-30 days'));

INSERT OR IGNORE INTO allocations (id, project_id, role, label, total_bps, max_slots, distribution_mode, sort_order, receives_primary)
VALUES
  ('a-06-artists',  'p-demo-06', 'artist',   'Artiste principale',  5000, 1, 'equal', 0, 0),
  ('a-06-gallery',  'p-demo-06', 'gallery',  'Galerie',             3000, 1, 'equal', 1, 1),
  ('a-06-producer', 'p-demo-06', 'producer', 'Production',          2000, 1, 'equal', 2, 0);

INSERT OR IGNORE INTO participants (id, project_id, user_id, wallet_address, role, shares_bps, status, allocation_id, invited_at, accepted_at)
VALUES
  ('pt-30', 'p-demo-06', 'u-gallery-01',  '0x1c3cA0b7d45A4DcfE0E25F83b7731f523F564C38', 'gallery',  3000, 'accepted', 'a-06-gallery',  datetime('now', '-30 days'), datetime('now', '-29 days')),
  ('pt-31', 'p-demo-06', 'u-producer-01', '0x2D641F4Aa137787e3BD34B132bb21E54c437eF6F', 'producer', 2000, 'accepted', 'a-06-producer', datetime('now', '-30 days'), datetime('now', '-29 days'));
