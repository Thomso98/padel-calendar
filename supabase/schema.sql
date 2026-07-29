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
  -- Infos perso complémentaires (espace "Mon compte")
  first_name text,
  last_name text,
  license_number text,
  birth_date date,
  avatar_url text,
  -- Classement padel : jamais saisi à la main par le joueur (voir
  -- trigger prevent_privileged_self_update ci-dessous), alimenté
  -- automatiquement à partir de license_number par la tâche planifiée
  -- tenup-padel-ranking-lookup (recherche sur tenup.fft.fr/classement-padel).
  ranking text,
  -- Gestion des retraits tardifs / blocage de compte (géré uniquement par l'admin,
  -- voir le trigger prevent_privileged_self_update ci-dessous)
  late_withdrawals_count int not null default 0,
  blocked boolean not null default false,
  blocked_reason text,
  blocked_at timestamptz,
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
  if auth.role() <> 'service_role'
     and not public.is_admin()
     -- Échappatoire ciblée : uniquement posée en interne par la
     -- fonction withdraw_from_tournament (plus bas), pour la durée de
     -- sa propre transaction. Un client ne peut pas positionner ce
     -- paramètre lui-même (set_config n'est pas exposé via l'API REST).
     and coalesce(current_setting('app.bypass_privilege_check', true), 'false') <> 'true' then
    if new.role <> old.role then
      new.role := old.role;
    end if;
    if new.approved <> old.approved then
      new.approved := old.approved;
    end if;
    -- Le blocage de compte et le compteur de retraits tardifs ne sont
    -- modifiables que par un admin (ou le backend via service_role),
    -- jamais par l'utilisateur lui-même.
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
  description text,
  is_evening boolean not null default false,
  type text not null default 'official' check (type in ('official', 'friendly')),
  status text not null default 'active' check (status in ('active', 'confirmed', 'removed')),
  -- true dès qu'une demande "pending" existe sur ce tournoi, tenu à jour
  -- par le trigger sync_tournament_pending_flag ci-dessous. Permet à
  -- tout utilisateur approuvé de voir qu'un tournoi est "bloqué" par la
  -- demande d'un autre joueur, sans avoir accès en lecture aux demandes
  -- des autres (RLS requests_select restreint chacun à ses propres
  -- demandes).
  has_pending_request boolean not null default false,
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

-- Annule une demande déjà approuvée (onglet "Mes tournois"), pour
-- l'utilisateur courant uniquement. Un joueur n'a normalement pas le
-- droit de modifier day_tournaments (réservé à l'admin) ni ses propres
-- blocked/late_withdrawals_count (trigger prevent_privileged_self_update
-- ci-dessus) : cette fonction, étroitement scopée, fait exactement les
-- deux opérations nécessaires, rien de plus. Détermine elle-même côté
-- serveur (jamais confiance dans le client) si c'est un retrait tardif
-- (< 48h avant le début du tournoi, minuit faute d'heure précise en
-- base) et applique les conséquences (compteur, blocage au 3e) si besoin.
create function public.withdraw_from_tournament(p_request_id uuid, p_comment text default null)
returns table(is_late boolean, will_block boolean, new_late_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.requests%rowtype;
  v_tournament public.day_tournaments%rowtype;
  v_hours_until numeric;
  v_is_late boolean;
  v_new_count int;
  v_will_block boolean := false;
begin
  select * into v_request from public.requests
    where id = p_request_id and user_id = auth.uid() and status = 'approved'
    for update;

  if not found then
    raise exception 'Demande introuvable, ou déjà annulée/traitée';
  end if;

  select * into v_tournament from public.day_tournaments
    where id = v_request.tournament_id
    for update;

  if not found then
    raise exception 'Tournoi introuvable';
  end if;

  v_hours_until := extract(epoch from (v_tournament.date::timestamp - now())) / 3600;
  v_is_late := v_hours_until < 48;

  if v_is_late then
    select late_withdrawals_count + 1 into v_new_count
      from public.profiles where id = auth.uid();
    v_will_block := v_new_count >= 3;

    perform set_config('app.bypass_privilege_check', 'true', true);
    update public.profiles
      set late_withdrawals_count = v_new_count,
          blocked = case when v_will_block then true else blocked end,
          blocked_reason = case when v_will_block then coalesce(p_comment, '3e retrait tardif') else blocked_reason end,
          blocked_at = case when v_will_block then now() else blocked_at end
      where id = auth.uid();
  else
    select late_withdrawals_count into v_new_count
      from public.profiles where id = auth.uid();
  end if;

  update public.requests
    set status = 'cancelled',
        late_withdrawal = v_is_late,
        late_withdrawal_comment = p_comment
    where id = p_request_id;

  update public.day_tournaments
    set status = 'active'
    where id = v_request.tournament_id;

  return query select v_is_late, v_will_block, v_new_count;
end;
$$;

grant execute on function public.withdraw_from_tournament(uuid, text) to authenticated;

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
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'cancelled_by_admin')),
  -- true si l'annulation de cette demande (déjà approuvée) a eu lieu à moins
  -- de 48h du début du tournoi : compte comme un retrait tardif (voir
  -- profiles.late_withdrawals_count). Ne doit être posé qu'une seule fois
  -- par demande, pour ne jamais recompter deux fois le même retrait.
  late_withdrawal boolean not null default false,
  -- Raison facultative donnée par le joueur lors d'un retrait tardif
  -- (voir withdraw_from_tournament plus bas).
  late_withdrawal_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tournament_id)
);

-- Tient à jour day_tournaments.has_pending_request à chaque changement
-- dans "requests" (voir commentaire sur la colonne ci-dessus).
create function public.sync_tournament_pending_flag()
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

create trigger trg_sync_tournament_pending_flag
after insert or update or delete on public.requests
for each row execute procedure public.sync_tournament_pending_flag();

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
-- Stockage : bucket pour les photos de profil (espace "Mon compte").
-- Convention de nommage des fichiers : "<user_id>/<nom_de_fichier>",
-- pour que les policies ci-dessous puissent vérifier que chacun ne
-- touche qu'à son propre dossier. Lecture publique (photos affichées
-- aux autres joueurs et à l'admin sur les demandes), écriture réservée
-- au propriétaire du dossier.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Row Level Security est déjà activé par défaut par Supabase sur
-- storage.objects (impossible à ré-activer via SQL Editor : la table
-- appartient à supabase_storage_admin, pas au rôle postgres).

create policy "avatars_public_read" on storage.objects
  for select
  using (bucket_id = 'avatars');

create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- Dernière étape manuelle (à faire une fois, voir README) :
-- se déclarer soi-même administrateur ET approuvé :
--
-- update public.profiles set role = 'admin', approved = true
-- where email = 'VOTRE_EMAIL';
-- ============================================================
