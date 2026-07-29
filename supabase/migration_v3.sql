-- ============================================================
-- Migration v3 : plusieurs tournois possibles par jour (une case
-- par tournoi, code couleur journée/soirée) + demandes multiples
-- par jour pour un même joueur.
--
-- À exécuter UNIQUEMENT si vous avez déjà exécuté schema.sql (v1)
-- et migration_v2.sql sur votre projet Supabase.
--
-- ATTENTION : cette migration vide les tables "days" et "requests"
-- (les anciennes lignes "tournoi disponible" combinées ne sont plus
-- compatibles avec le nouveau format). Les jours "repos" / "tournoi
-- confirmé" ainsi que les demandes en cours devront être ressaisis.
-- ============================================================

-- 1. Nouvelle table : un tournoi = une ligne (plusieurs possibles
--    pour une même date)
create table if not exists public.day_tournaments (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  title text not null,
  location text,
  is_evening boolean not null default false,
  status text not null default 'active' check (status in ('active', 'confirmed', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date, title, location)
);

create index if not exists day_tournaments_date_idx on public.day_tournaments(date);

alter table public.day_tournaments enable row level security;

drop policy if exists "day_tournaments_select" on public.day_tournaments;
create policy "day_tournaments_select" on public.day_tournaments
  for select to authenticated
  using (public.is_approved() or public.is_admin());

drop policy if exists "day_tournaments_insert_admin" on public.day_tournaments;
create policy "day_tournaments_insert_admin" on public.day_tournaments
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "day_tournaments_update_admin" on public.day_tournaments;
create policy "day_tournaments_update_admin" on public.day_tournaments
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "day_tournaments_delete_admin" on public.day_tournaments;
create policy "day_tournaments_delete_admin" on public.day_tournaments
  for delete to authenticated
  using (public.is_admin());

-- 2. Nettoyage des anciennes données (format "un tournoi = un jour",
--    plus compatible)
delete from public.requests;
delete from public.days;

-- 3. La table requests référence désormais un tournoi précis, plus
--    seulement une date : un joueur peut donc demander plusieurs
--    tournois le même jour (lieux différents).
alter table public.requests drop constraint if exists requests_day_id_fkey;
alter table public.requests drop column if exists day_id;
alter table public.requests add column if not exists tournament_id uuid references public.day_tournaments(id) on delete cascade;
alter table public.requests alter column tournament_id set not null;
alter table public.requests drop constraint if exists requests_user_tournament_unique;
alter table public.requests add constraint requests_user_tournament_unique unique (user_id, tournament_id);

-- ============================================================
-- Rien d'autre à faire : la validation d'une demande gère elle-même
-- la cascade (le tournoi validé passe "confirmé", les autres tournois
-- de la même catégorie journée/soirée ce jour-là sont retirés du
-- calendrier, ceux de l'autre catégorie restent disponibles).
-- ============================================================
