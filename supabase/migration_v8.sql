-- ============================================================
-- Migration v8 : tournoi "bloqué" pendant qu'une demande est en cours
-- (chantier 4 du prompt "nouvelles fonctionnalités").
--
-- Un utilisateur non-admin n'a le droit de lire (RLS) que ses PROPRES
-- demandes dans "requests" (policy requests_select), donc impossible
-- pour lui de savoir côté client si UN AUTRE joueur a une demande
-- "pending" en cours sur un tournoi. On maintient donc un simple
-- indicateur booléen directement sur day_tournaments (table déjà
-- lisible par tout utilisateur approuvé), tenu à jour automatiquement
-- par un trigger à chaque changement dans "requests".
--
-- À exécuter UNIQUEMENT si vous avez déjà exécuté schema.sql (v1) et
-- les migrations précédentes (v2 à v7). Non destructive.
-- ============================================================

alter table public.day_tournaments add column if not exists has_pending_request boolean not null default false;

create or replace function public.sync_tournament_pending_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament_id uuid;
begin
  v_tournament_id := coalesce(new.tournament_id, old.tournament_id);

  update public.day_tournaments
    set has_pending_request = exists (
      select 1 from public.requests
      where tournament_id = v_tournament_id and status = 'pending'
    )
    where id = v_tournament_id;

  return null;
end;
$$;

drop trigger if exists trg_sync_tournament_pending_flag on public.requests;
create trigger trg_sync_tournament_pending_flag
after insert or update or delete on public.requests
for each row execute procedure public.sync_tournament_pending_flag();

-- Recalcule l'indicateur pour les demandes déjà existantes (ex: demandes
-- pending créées avant cette migration).
update public.day_tournaments t
  set has_pending_request = exists (
    select 1 from public.requests r
    where r.tournament_id = t.id and r.status = 'pending'
  );
