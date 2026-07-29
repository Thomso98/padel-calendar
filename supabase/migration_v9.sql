-- ============================================================
-- Migration v9 : onglet "Mes tournois" côté joueur + retrait tardif
-- (chantier 2 du prompt "nouvelles fonctionnalités").
--
-- Un joueur qui annule un tournoi déjà validé doit pouvoir :
--  - remettre le tournoi "actif" dans day_tournaments (normalement
--    réservé à l'admin, policy day_tournaments_update_admin) ;
--  - dans le cas d'un retrait tardif, incrémenter SON PROPRE
--    late_withdrawals_count, et se bloquer lui-même au 3e retrait
--    (normalement interdit à un non-admin par le trigger
--    prevent_privileged_self_update, à raison).
--
-- On expose donc une fonction SECURITY DEFINER étroitement scopée
-- (withdraw_from_tournament) qui fait exactement ces deux opérations,
-- rien de plus : impossible pour un joueur d'appeler ça pour modifier
-- le compte ou le tournoi de quelqu'un d'autre, ou de remettre son
-- compteur à zéro. Un "bypass" ciblé (app.bypass_privilege_check) est
-- ajouté au trigger existant pour que cette fonction, et uniquement
-- elle, puisse toucher blocked/blocked_reason/blocked_at/
-- late_withdrawals_count.
--
-- À exécuter UNIQUEMENT si vous avez déjà exécuté schema.sql (v1) et
-- les migrations précédentes (v2 à v8). Non destructive.
-- ============================================================

alter table public.requests add column if not exists late_withdrawal_comment text;

-- Étend le trigger existant : autorise aussi le bypass posé par
-- withdraw_from_tournament (voir plus bas), en plus de service_role et
-- de l'admin.
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
  end if;
  return new;
end;
$$;

-- Annule une demande déjà approuvée (retrait d'un tournoi "Mes
-- tournois"), pour l'utilisateur courant uniquement. Détermine
-- elle-même (côté serveur, pas confiance dans le client) si c'est un
-- retrait tardif (< 48h avant le début du tournoi, minuit faute
-- d'heure précise en base) et applique les conséquences si besoin.
create or replace function public.withdraw_from_tournament(p_request_id uuid, p_comment text default null)
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
