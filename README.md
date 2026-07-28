# Calendrier de tournois padel

Site où vos abonnés/partenaires voient votre calendrier de tournois et peuvent
vous demander de jouer un tournoi disponible, que vous validez ou refusez.

Aucune compétence en programmation requise pour le déployer : suivez les
étapes ci-dessous dans l'ordre. Comptez 30-45 minutes la première fois.

## Comment ça marche

Pour chaque jour du calendrier, trois états possibles :

- **Repos** : vous vous êtes mis en repos, aucune action possible pour les visiteurs.
- **Tournoi confirmé** : vous jouez déjà ce tournoi, affiché à titre informatif.
- **Tournoi disponible** : un tournoi existe ce jour-là mais vous n'y êtes pas
  encore engagé. Les utilisateurs connectés peuvent alors envoyer une demande
  pour que vous y jouiez. Vous validez ou refusez depuis le tableau de bord admin.

Un utilisateur doit créer un compte (email + mot de passe) pour voir le
calendrier et faire une demande. **Chaque nouveau compte doit en plus être
validé par vous (l'admin) avant de pouvoir accéder au site** — tant qu'il
n'est pas validé, l'utilisateur reste bloqué sur un message "compte en
attente de validation".

Un joueur peut aussi annuler sa propre demande tant qu'elle est en attente :
bouton "Annuler ma demande" puis confirmation ("Voulez-vous vraiment
annuler ?"). Si confirmé, la demande passe en "annulée" et un message de
confirmation s'affiche ; si annulé, rien ne change.

## Architecture (pourquoi c'est simple à maintenir)

- **Aucune étape de build** : pages HTML/CSS/JS classiques, pas de React ni
  d'installation `npm` nécessaire pour faire tourner le site.
- **Supabase** : base de données + comptes utilisateurs (gratuit pour ce volume d'usage).
- **Vercel** : hébergement du site + 2 petites fonctions qui envoient les emails.
- **Resend** : envoi des emails de notification.

## Étape 1 — Créer le projet Supabase

1. Allez sur https://supabase.com, créez un compte, puis "New project".
2. Notez le mot de passe de base de données que vous choisissez (à garder de côté).
3. Une fois le projet créé, allez dans **SQL Editor** > **New query**, collez
   tout le contenu du fichier `supabase/schema.sql` de ce dossier, puis cliquez
   sur **Run**. Cela crée les tables et les règles de sécurité.

   *Si vous aviez déjà un projet Supabase créé avec une version précédente de
   ce site, n'exécutez pas `schema.sql` (les tables existent déjà) : exécutez
   plutôt `supabase/migration_v2.sql` à la place, qui ajoute la validation
   des comptes et l'annulation des demandes sans tout recréer.*
4. Allez dans **Project Settings > API**. Notez :
   - `Project URL` (ex: `https://abcdefgh.supabase.co`)
   - la clé `anon` `public`
   - la clé `service_role` (⚠️ à garder secrète, ne jamais la mettre dans le site public)

## Étape 2 — Configurer le site avec vos identifiants Supabase

Ouvrez le fichier `public/js/supabaseClient.js` et remplacez :

```js
const SUPABASE_URL = "https://VOTRE-PROJET.supabase.co";
const SUPABASE_ANON_KEY = "VOTRE-CLE-ANON-PUBLIC";
```

par votre `Project URL` et votre clé `anon public` notées à l'étape 1.

(La clé `anon` est faite pour être publique — elle ne donne accès qu'à ce que
les règles de sécurité de la base autorisent.)

## Étape 3 — Créer votre compte et devenir administrateur

1. Une fois le site déployé (étape 5), créez un compte via "Créer un compte"
   sur la page d'accueil, avec **votre** email.
2. Confirmez votre email (Supabase vous envoie automatiquement un email de confirmation).
3. Dans Supabase, allez dans **SQL Editor**, et exécutez (en remplaçant l'email) :

```sql
update public.profiles set role = 'admin', approved = true where email = 'votre-email@exemple.com';
```

   (le `approved = true` est nécessaire : par défaut, tout nouveau compte —
   y compris le vôtre au tout premier lancement — est bloqué en attente de
   validation ; c'est cette commande qui vous auto-valide en tant qu'admin.)

4. Reconnectez-vous : vous avez maintenant accès à `admin.html`, avec une
   section "Comptes en attente de validation" pour valider les inscriptions
   suivantes en un clic.

## Étape 4 — Créer un compte Resend (pour les emails)

1. Allez sur https://resend.com, créez un compte gratuit.
2. Dans **API Keys**, créez une clé et notez-la (`re_...`).
3. Par défaut, sans domaine vérifié, vous pouvez recevoir des emails sur
   **votre propre adresse** (celle du compte Resend) — suffisant pour être
   notifié des nouvelles demandes.
4. Pour que les joueurs reçoivent eux aussi un email (validation/refus), il
   faut vérifier un nom de domaine dans Resend (**Domains > Add domain**,
   quelques enregistrements DNS à ajouter chez votre registrar). C'est
   optionnel : sans ça, seul le tableau de bord admin fait foi, vous pouvez
   prévenir les joueurs manuellement.

## Étape 5 — Déployer sur Vercel

1. Allez sur https://vercel.com, créez un compte (vous pouvez vous connecter
   avec GitHub).
2. Le plus simple : créez un dépôt GitHub avec le contenu de ce dossier
   (`padel-calendar/`), puis sur Vercel choisissez **Add New > Project** et
   importez ce dépôt. Vercel détecte automatiquement le dossier `public/`
   et le dossier `api/`, aucune configuration de build n'est nécessaire.
3. Avant de déployer, allez dans **Environment Variables** et ajoutez :

   | Nom | Valeur |
   |---|---|
   | `SUPABASE_URL` | votre Project URL Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | votre clé service_role Supabase |
   | `RESEND_API_KEY` | votre clé Resend |
   | `RESEND_FROM` | `Calendrier Padel <onboarding@resend.dev>` (ou une adresse de votre domaine vérifié) |
   | `ADMIN_EMAIL` | votre email, pour recevoir les notifications de nouvelles demandes |
   | `WEBHOOK_SECRET` | une phrase secrète inventée par vous, ex: `padel-2026-xyz` |

4. Cliquez sur **Deploy**. Une fois terminé, vous obtenez une URL du type
   `https://padel-calendar.vercel.app`.

## Étape 6 — Brancher les notifications email (Database Webhooks)

Dans Supabase, allez dans **Database > Webhooks > Create a new hook**, et créez :

**Webhook 1 — nouvelle demande**
- Table : `requests`
- Events : `Insert`
- Type : `HTTP Request`
- URL : `https://VOTRE-SITE.vercel.app/api/notify-admin`
- HTTP Headers : ajoutez `x-webhook-secret` = la même valeur que `WEBHOOK_SECRET`

**Webhook 2 — validation / refus**
- Table : `requests`
- Events : `Update`
- Type : `HTTP Request`
- URL : `https://VOTRE-SITE.vercel.app/api/notify-user`
- HTTP Headers : ajoutez `x-webhook-secret` = la même valeur que `WEBHOOK_SECRET`

## Utilisation au quotidien

- Allez sur `https://VOTRE-SITE.vercel.app/admin.html` pour ajouter des jours
  (repos, tournoi confirmé, ou tournoi disponible pour demandes) et pour
  valider/refuser les demandes.
- Les utilisateurs vont sur `https://VOTRE-SITE.vercel.app/` pour voir le
  calendrier et faire leurs demandes.

## Limites connues de cette première version

- Un joueur ne peut annuler que ses demandes encore "en attente" (pas une
  demande déjà validée/refusée).
- Il n'y a pas encore de bouton "refuser un compte" côté admin (seulement
  "valider") : pour bloquer définitivement un compte indésirable, il faut
  passer par Supabase (dashboard Authentication, ou suppression du profil).
- Sans domaine vérifié sur Resend, les emails aux joueurs (validation/refus)
  ne partent pas — seul le tableau de bord admin reste toujours à jour.
- Pas de récupération de mot de passe personnalisée : Supabase gère ça par
  défaut via son propre email ("mot de passe oublié" peut être ajouté sur demande).

Pour toute modification (textes, couleurs, champs supplémentaires), les
fichiers à éditer sont dans `public/` (pages) et `public/js/` (comportement).
