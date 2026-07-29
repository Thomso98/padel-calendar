-- ============================================================
-- Migration v6 : annulation d'un tournoi déjà validé, côté admin.
--
-- À exécuter UNIQUEMENT si vous avez déjà exécuté schema.sql (v1) et
-- les migrations précédentes sur votre projet Supabase.
-- Non destructive (aucune donnée existante n'est supprimée).
--
-- Ajoute une valeur "cancelled_by_admin" au statut des demandes
-- (requests.status). Utilisée quand l'admin annule un tournoi qu'il
-- avait déjà validé : la demande initialement approuvée passe dans cet
-- état plutôt que "rejected", pour que le joueur comprenne que ce
-- n'est pas lui qui a été refusé, mais que le tournoi a été annulé
-- après coup par l'organisateur.
-- ============================================================

alter table public.requests drop constraint if exists requests_status_check;
alter table public.requests add constraint requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled', 'cancelled_by_admin'));

-- ============================================================
-- Rien d'autre à faire : la fonctionnalité "Tournois validés" côté
-- admin (annuler / supprimer un tournoi déjà validé) réutilise les
-- statuts déjà existants de day_tournaments (active / confirmed /
-- removed), aucune nouvelle colonne n'est nécessaire.
-- ============================================================
