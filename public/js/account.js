// Espace "Mon compte" (index.html, onglet "Mon compte") : consultation
// et mise à jour des infos personnelles du joueur connecté (nom, licence,
// date de naissance, classement, photo de profil). L'email n'est jamais
// modifiable ici : il est lié à l'authentification Supabase (auth.users)
// et un changement nécessiterait une revalidation par email, non gérée
// dans cette première version. Le compteur de retraits tardifs est en
// lecture seule : seul l'admin (ou withdraw_from_tournament côté serveur)
// peut le faire évoluer, voir le trigger prevent_privileged_self_update.

function defaultAvatarUrl(profile, user) {
  const seed = (profile && profile.full_name) || (user && user.email) || "?";
  return "https://api.dicebear.com/7.x/initials/svg?seed=" + encodeURIComponent(seed);
}

// Découpage de secours pour les comptes créés avant l'ajout des champs
// first_name/last_name (l'inscription ne demandait qu'un seul champ
// "Nom", stocké dans full_name) : sert uniquement à pré-remplir Nom /
// Prénom une première fois, tant que l'utilisateur n'a pas encore
// enregistré les deux champs séparément.
function splitFullName(fullName) {
  const trimmed = (fullName || "").trim();
  if (!trimmed) return { first: "", last: "" };
  const parts = trimmed.split(/\s+/);
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function fillAccountForm(profile, user) {
  document.getElementById("account-email").value = (user && user.email) || "";

  if (profile.first_name || profile.last_name) {
    document.getElementById("account-first-name").value = profile.first_name || "";
    document.getElementById("account-last-name").value = profile.last_name || "";
  } else {
    const guess = splitFullName(profile.full_name);
    document.getElementById("account-first-name").value = guess.first;
    document.getElementById("account-last-name").value = guess.last;
  }

  document.getElementById("account-license").value = profile.license_number || "";
  document.getElementById("account-birth-date").value = profile.birth_date || "";
  document.getElementById("account-ranking").value = profile.ranking || "";
  // Affiche le nombre de retraits tardifs ENCORE disponibles (et non le
  // nombre déjà utilisé) : plus parlant pour l'utilisateur, qui voit
  // directement sa marge restante avant blocage du compte. Le
  // fonctionnement complet est expliqué dans la note en bas de page
  // (voir index.html).
  const remaining = Math.max(0, 3 - (profile.late_withdrawals_count || 0));
  document.getElementById("account-late-withdrawals").value = `${remaining} restant(s) sur 3`;
  document.getElementById("account-avatar-preview").src =
    profile.avatar_url || defaultAvatarUrl(profile, user);
}

function loadAccountView() {
  if (!currentProfile || !currentUser) return;
  document.getElementById("account-msg").textContent = "";
  document.getElementById("account-msg").className = "msg";
  document.getElementById("account-avatar-msg").textContent = "";
  document.getElementById("account-avatar-msg").className = "msg";
  fillAccountForm(currentProfile, currentUser);
}

async function handleAccountSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById("account-msg");
  errEl.textContent = "";
  errEl.className = "msg";

  const firstName = document.getElementById("account-first-name").value.trim();
  const lastName = document.getElementById("account-last-name").value.trim();

  // Seuls les champs personnels sont envoyés : role/approved/blocked/
  // late_withdrawals_count etc. ne sont de toute façon pas dans ce
  // formulaire, et seraient de toute manière rejetés par le trigger
  // prevent_privileged_self_update si on tentait de les modifier ici.
  // "ranking" (classement padel) est volontairement absent : il n'est
  // jamais modifiable par le joueur (verrouillé aussi côté base par ce
  // même trigger), seulement calculé automatiquement à partir de la
  // licence par la tâche planifiée tenup-padel-ranking-lookup.
  const updates = {
    first_name: firstName || null,
    last_name: lastName || null,
    // full_name recalculé à partir de Nom/Prénom : conservé en base
    // pour ne pas casser les affichages qui l'utilisent encore
    // (listes admin, avatar par défaut, emails).
    full_name: [firstName, lastName].filter(Boolean).join(" ") || null,
    license_number: document.getElementById("account-license").value.trim() || null,
    birth_date: document.getElementById("account-birth-date").value || null,
  };

  const { data, error } = await supabaseClient
    .from("profiles")
    .update(updates)
    .eq("id", currentUser.id)
    .select()
    .single();

  if (error) {
    errEl.textContent = error.message;
    errEl.className = "msg error";
    return;
  }

  currentProfile = data;
  errEl.textContent = "Informations enregistrées.";
  errEl.className = "msg success";
}

async function handleAvatarChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const msgEl = document.getElementById("account-avatar-msg");
  msgEl.textContent = "Envoi en cours...";
  msgEl.className = "msg";

  // Un seul fichier par utilisateur (toujours le même chemin, écrasé à
  // chaque nouvel envoi via upsert), dans son propre dossier
  // "<user_id>/avatar" : c'est cette convention que vérifient les
  // policies de stockage (storage.foldername(name))[1] = auth.uid()).
  const path = `${currentUser.id}/avatar`;

  const { error: uploadError } = await supabaseClient.storage
    .from("avatars")
    .upload(path, file, {
      upsert: true,
      cacheControl: "3600",
      contentType: file.type || "image/jpeg",
    });

  if (uploadError) {
    msgEl.textContent = uploadError.message;
    msgEl.className = "msg error";
    return;
  }

  const { data: publicUrlData } = supabaseClient.storage.from("avatars").getPublicUrl(path);
  // Paramètre anti-cache : le chemin de fichier ne change jamais d'un
  // upload à l'autre, sans ça le navigateur (et les autres joueurs qui
  // ont déjà vu l'ancienne photo) continuerait d'afficher l'ancienne image.
  const publicUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

  const { data: updatedProfile, error: updateError } = await supabaseClient
    .from("profiles")
    .update({ avatar_url: publicUrl })
    .eq("id", currentUser.id)
    .select()
    .single();

  if (updateError) {
    msgEl.textContent = updateError.message;
    msgEl.className = "msg error";
    return;
  }

  currentProfile = updatedProfile;
  document.getElementById("account-avatar-preview").src = publicUrl;
  msgEl.textContent = "Photo mise à jour.";
  msgEl.className = "msg success";
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("form-account").addEventListener("submit", handleAccountSubmit);
  document.getElementById("account-avatar-input").addEventListener("change", handleAvatarChange);
});
