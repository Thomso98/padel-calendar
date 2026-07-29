-- ============================================================
-- Migration v10 : Nom / Prénom séparés + classement padel non
-- modifiable par le joueur (chantier "Mon compte", suite).
--
-- - first_name / last_name : nouveaux champs séparés, en plus de
--   full_name (conservé pour ne pas casser les affichages existants :
--   listes admin, avatars par défaut, emails). full_name est recalculé
--   côté client (account.js) à chaque sauvegarde de Nom/Prénom.
-- - ranking (classement padel) : ne doit plus jamais être modifiable
--   par le joueur lui-même, même via un appel direct à l'API (pas
--   seulement caché côté UI). Il sera alimenté automatiquement par une
--   tâche planifiée qui consulte tenup.fft.fr/classement-padel à partir
--   du numéro de licence (license_number), au même titre que le scan
--   des tournois Ten'Up existant.
--
-- À exécuter UNIQUEMENT si vous avez déjà exécuté schema.sql (v1) et
-- les migrations précédentes (v2 à v9). Non destructif.
-- ============================================================

alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;

-- Étend le trigger existant : verrouille aussi "ranking" contre toute
-- auto-modification par un joueur (en plus de role/approved/blocked/
-- blocked_reason/blocked_at/late_withdrawals_count déjà verrouillés).
-- Seul un admin (ou service_role, ou le bypass ciblé de
-- withdraw_from_tournament) peut le faire.
create or replace function public.prevent_privileged_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role'
     and not public.is_admin()
     and coalesce(current_setting('app.bypass_privilege_check', true), 'false') <> 'true' then
    if new.role <> old.role then
      new.role := old.role;
    end if;
    if new.approved <> old.approved then
      new.approved := old.approved;
    end if;
    if new.blocked is distinct from old.blocked then
      new.blocked := old.blocked;
    end if;
    if new.blocked_reason is distinct from old.blocked_reason then
      new.blocked_reason := old.blocked_reason;
    end if;
    if new.blocked_at is distinct from old.blocked_at then
      new.blocked_at := old.blocked_at;
    end if;
    if new.late_withdrawals_count is distinct from old.late_withdrawals_count then
      new.late_withdrawals_count := old.late_withdrawals_count;
    end if;
    -- Classement padel : jamais saisi à la main par le joueur, toujours
    -- calculé automatiquement à partir de sa licence (voir tâche
    -- planifiée tenup-padel-ranking-lookup).
    if new.ranking is distinct from old.ranking then
      new.ranking := old.ranking;
    end if;
  end if;
  return new;
end;
$$;
