-- ============================================================
-- Schéma de base de données pour le calendrier de tournois padel
-- À exécuter dans Supabase : Dashboard > SQL Editor > New query
-- (installation complète sur un projet neuf)
-- ============================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------
-- Table des profils (1 ligne par utilisateur, liée à auth.users)
-- -----------------------------------------------------------
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  full_name text,
  phone text,
  role text not null default 'user' check (role in ('user', 'admin')),
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

-- Création automatique du profil à l'inscription (non approuvé par défaut)
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Fonction utilitaire : l'utilisateur courant est-il admin ?
create function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Fonction utilitaire : le compte de l'utilisateur courant est-il approuvé ?
create function public.is_approved()
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

-- Empêche un utilisateur non-admin de se donner lui-même le rôle admin
-- ou de s'auto-approuver. Un admin (ou la clé service_role) peut en
-- revanche changer ces champs sur n'importe quel profil (ex: valider
-- un compte).
create function public.prevent_privileged_self_update()
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

create trigger trg_prevent_privileged_self_update
before update on public.profiles
for each row execute procedure public.prevent_privileged_self_update();

-- -----------------------------------------------------------
-- Table des jours du calendrier (repos / tournoi confirmé — décidé
-- par l'admin uniquement). Une date sans ligne ici est "ouverte" :
-- les tournois disponibles (table day_tournaments ci-dessous)
-- s'affichent normalement.
-- -----------------------------------------------------------
create table public.days (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  day_type text not null check (day_type in ('rest', 'confirmed', 'available')),
  tournament_name text,
  tournament_location text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------
-- Table des tournois disponibles à une date donnée. Plusieurs
-- tournois peuvent exister pour la même date (clubs différents,
-- créneaux journée et soirée, etc). Remplie automatiquement par la
-- recherche Ten'Up, ou à la main depuis le tableau de bord admin.
-- -----------------------------------------------------------
create table public.day_tournaments (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  title text not null,
  location text,
  is_evening boolean not null default false,
  type text not null default 'official' check (type in ('official', 'friendly')),
  status text not null default 'active' check (status in ('active', 'confirmed', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date, title, location)
);

create index day_tournaments_date_idx on public.day_tournaments(date);

-- Fonction utilisée par le calendrier public : crée (ou récupère) la
-- case "Match amical" du jour pour une date donnée. N'importe quel
-- utilisateur approuvé peut l'appeler (contourne volontairement la
-- policy day_tournaments_insert_admin, réservée aux tournois officiels
-- remplis par Ten'Up / l'admin).
create function public.ensure_friendly_slot(p_date date)
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

-- -----------------------------------------------------------
-- Table des demandes des utilisateurs. Un joueur peut faire
-- plusieurs demandes pour la même date (tournois différents), mais
-- une seule demande par tournoi.
-- -----------------------------------------------------------
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.day_tournaments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tournament_id)
);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.profiles enable row level security;
alter table public.days enable row level security;
alter table public.day_tournaments enable row level security;
alter table public.requests enable row level security;

-- profiles : chacun voit son propre profil, l'admin voit tout
-- (nécessaire pour que l'admin voie les comptes en attente de validation)
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (auth.uid() = id or public.is_admin());

-- un utilisateur peut modifier son propre profil (nom, téléphone...)
-- mais le trigger ci-dessus empêche de changer role/approved lui-même
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- l'admin peut modifier n'importe quel profil (ex: valider un compte)
create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- days : tout utilisateur connecté ET approuvé peut voir le calendrier,
-- seul l'admin peut créer/modifier/supprimer des jours
create policy "days_select" on public.days
  for select to authenticated
  using (public.is_approved() or public.is_admin());

create policy "days_insert_admin" on public.days
  for insert to authenticated
  with check (public.is_admin());

create policy "days_update_admin" on public.days
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "days_delete_admin" on public.days
  for delete to authenticated
  using (public.is_admin());

-- day_tournaments : même logique que days
create policy "day_tournaments_select" on public.day_tournaments
  for select to authenticated
  using (public.is_approved() or public.is_admin());

create policy "day_tournaments_insert_admin" on public.day_tournaments
  for insert to authenticated
  with check (public.is_admin());

create policy "day_tournaments_update_admin" on public.day_tournaments
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "day_tournaments_delete_admin" on public.day_tournaments
  for delete to authenticated
  using (public.is_admin());

-- requests : un utilisateur approuvé voit/crée ses propres demandes,
-- l'admin voit et met à jour toutes les demandes
create policy "requests_select" on public.requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "requests_insert_own" on public.requests
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved());

-- l'admin valide/refuse les demandes (change le statut vers approved/rejected)
create policy "requests_update_admin" on public.requests
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- un utilisateur peut annuler sa propre demande, uniquement si elle est
-- encore "pending", et uniquement pour la faire passer à "cancelled"
create policy "requests_cancel_own" on public.requests
  for update to authenticated
  using (user_id = auth.uid() and status = 'pending')
  with check (user_id = auth.uid() and status = 'cancelled');

-- ============================================================
-- Dernière étape manuelle (à faire une fois, voir README) :
-- se déclarer soi-même administrateur ET approuvé :
--
-- update public.profiles set role = 'admin', approved = true
-- where email = 'VOTRE_EMAIL';
-- ============================================================
