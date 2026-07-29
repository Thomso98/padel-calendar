-- ============================================================
-- Migration v4 : case "Match amical" (mauve), disponible tous les
-- jours, avec description obligatoire à la demande.
--
-- À exécuter UNIQUEMENT si vous avez déjà exécuté schema.sql (v1) et
-- migration_v3.sql sur votre projet Supabase. Non destructive (aucune
-- donnée existante n'est supprimée).
-- ============================================================

-- 1. Nouvelle colonne : distingue les tournois officiels (remplis par
--    Ten'Up / l'admin) des matchs amicaux (créés à la demande d'un
--    joueur, une seule case par jour).
alter table public.day_tournaments
  add column if not exists type text not null default 'official' check (type in ('official', 'friendly'));

-- 2. Fonction appelée par le calendrier public pour créer (ou
--    récupérer) la case "Match amical" du jour, la première fois
--    qu'un joueur clique sur "Demander à jouer" pour cette date.
--    Contourne volontairement la policy "day_tournaments_insert_admin"
--    (réservée aux tournois officiels) via security definer.
create or replace function public.ensure_friendly_slot(p_date date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'not authorized';
  end if;

  select id into v_id from public.day_tournaments
    where date = p_date and type = 'friendly'
    limit 1;

  if v_id is null then
    insert into public.day_tournaments (date, title, location, is_evening, type, status)
    values (p_date, 'Match amical', '', false, 'friendly', 'active')
    on conflict (date, title, location) do update set updated_at = now()
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.ensure_friendly_slot(date) to authenticated;

-- ============================================================
-- Rien d'autre à faire : la case "Match amical" s'affiche
-- automatiquement tous les jours côté calendrier public (calendar.js),
-- et la cascade d'annulation des tournois officiels (admin.js) ignore
-- désormais explicitement les lignes type='friendly'.
-- ============================================================
