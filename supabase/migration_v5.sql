-- ============================================================
-- Migration v5 : description du tournoi dans la fenêtre de demande.
--
-- À exécuter UNIQUEMENT si vous avez déjà exécuté schema.sql (v1) et
-- migration_v3.sql / migration_v4.sql sur votre projet Supabase.
-- Non destructive (aucune donnée existante n'est supprimée).
-- ============================================================

-- Nouvelle colonne : texte libre copié depuis la fiche du tournoi sur
-- Ten'Up (ou saisi à la main par l'admin), affiché en entier dans la
-- fenêtre de demande du joueur, sous le nom du tournoi.
alter table public.day_tournaments
  add column if not exists description text;

-- ============================================================
-- Rien d'autre à faire : le scan Ten'Up récurrent renseigne cette
-- colonne automatiquement (voir la tâche planifiée), et l'admin peut
-- aussi la renseigner à la main depuis le formulaire "Tournois
-- disponibles". Un tournoi déjà en base sans description sera
-- automatiquement complété au prochain scan qui le retrouve (upsert
-- sur date+titre+lieu).
-- ============================================================
