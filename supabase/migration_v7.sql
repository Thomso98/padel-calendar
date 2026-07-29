-- ============================================================
-- Migration v7 : infos perso complémentaires + gestion des retraits
-- tardifs / blocage de compte (chantier 0 du prompt "nouvelles
-- fonctionnalités"). Prérequis pour : espace "Mon compte", onglet
-- "Mes tournois" avec retrait tardif, gestion admin des comptes.
--
-- À exécuter UNIQUEMENT si vous avez déjà exécuté schema.sql (v1) et
-- les migrations précédentes (v2 à v6) sur votre projet Supabase.
-- Non destructive (aucune donnée existante n'est supprimée).
-- ============================================================

-- -----------------------------------------------------------
-- profiles : infos perso complémentaires + gestion des retraits
-- tardifs / blocage de compte.
-- -----------------------------------------------------------
alter table public.profiles add column if not exists license_number text;
alter table public.profiles add column if not exists birth_date date;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists ranking text;
alter table public.profiles add column if not exists late_withdrawals_count int not null default 0;
alter table public.profiles add column if not exists blocked boolean not null default false;
alter table public.profiles add column if not exists blocked_reason text;
alter table public.profiles add column if not exists blocked_at timestamptz;

-- -----------------------------------------------------------
-- requests : distinguer une annulation normale d'un retrait tardif.
-- -----------------------------------------------------------
alter table public.requests add column if not exists late_withdrawal boolean not null default false;

-- -----------------------------------------------------------
-- Étend le trigger existant : le blocage de compte et le compteur de
-- retraits tardifs ne sont modifiables que par un admin (ou le backend
-- via service_role), jamais par l'utilisateur lui-même. Les autres
-- nouveaux champs (license_number, birth_date, avatar_url, ranking)
-- restent modifiables par l'utilisateur via la policy
-- profiles_update_own déjà en place (aucun changement nécessaire).
-- -----------------------------------------------------------
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
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------
-- Stockage : bucket pour les photos de profil (espace "Mon compte").
-- Convention de nommage des fichiers : "<user_id>/<nom_de_fichier>",
-- pour que les policies ci-dessous puissent vérifier que chacun ne
-- touche qu'à son propre dossier. Lecture publique (photos affichées
-- aux autres joueurs et à l'admin sur les demandes), écriture réservée
-- au propriétaire du dossier.
-- -----------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Row Level Security est déjà activé par défaut par Supabase sur
-- storage.objects (impossible à ré-activer via SQL Editor : la table
-- appartient à supabase_storage_admin, pas au rôle postgres).

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
