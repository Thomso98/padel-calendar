-- ============================================================
-- Migration v2 : validation des comptes par l'admin + annulation
-- des demandes par les joueurs.
--
-- À exécuter UNIQUEMENT si vous avez déjà exécuté schema.sql (v1)
-- sur votre projet Supabase. Si vous partez d'un projet neuf,
-- utilisez schema.sql directement (il contient déjà tout).
-- ============================================================

-- 1. Nouvelle colonne "approved" sur les profils
alter table public.profiles
  add column if not exists approved boolean not null default false;

-- 2. Nouveau statut "cancelled" pour les demandes
alter table public.requests
  drop constraint if exists requests_status_check;
alter table public.requests
  add constraint requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled'));

-- 3. Fonction is_approved()
create or replace function public.is_approved()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and approved = true
  );
$$;

-- 4. Remplace l'ancien trigger anti-auto-promotion (role uniquement) par
--    la version qui protège aussi "approved"
drop trigger if exists trg_prevent_role_change on public.profiles;
drop function if exists public.prevent_role_self_update();

create or replace function public.prevent_privileged_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    if new.role <> old.role then
      new.role := old.role;
    end if;
    if new.approved <> old.approved then
      new.approved := old.approved;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_privileged_self_update on public.profiles;
create trigger trg_prevent_privileged_self_update
before update on public.profiles
for each row execute procedure public.prevent_privileged_self_update();

-- 5. Nouvelle policy : l'admin peut modifier n'importe quel profil
--    (nécessaire pour valider les comptes)
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 6. days_select : il faut désormais être approuvé (ou admin) pour voir
--    le calendrier
drop policy if exists "days_select" on public.days;
create policy "days_select" on public.days
  for select to authenticated
  using (public.is_approved() or public.is_admin());

-- 7. requests_insert_own : il faut être approuvé pour envoyer une demande
drop policy if exists "requests_insert_own" on public.requests;
create policy "requests_insert_own" on public.requests
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved());

-- 8. Nouvelle policy : un utilisateur peut annuler sa propre demande
--    en attente (passage à "cancelled" uniquement)
drop policy if exists "requests_cancel_own" on public.requests;
create policy "requests_cancel_own" on public.requests
  for update to authenticated
  using (user_id = auth.uid() and status = 'pending')
  with check (user_id = auth.uid() and status = 'cancelled');

-- ============================================================
-- N'oubliez pas de vous approuver vous-même si ce n'est pas déjà fait :
-- update public.profiles set role = 'admin', approved = true
-- where email = 'VOTRE_EMAIL';
-- ============================================================
