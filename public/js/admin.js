// Logique du tableau de bord admin (page admin.html).

let adminUser = null;
let isAdmin = false;

async function onAuthenticated(user) {
  adminUser = user;
  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !profile || profile.role !== "admin") {
    isAdmin = false;
    document.getElementById("app-section").classList.add("hidden");
    document.getElementById("not-admin").classList.remove("hidden");
    return;
  }

  isAdmin = true;
  document.getElementById("not-admin").classList.add("hidden");
  document.getElementById("app-section").classList.remove("hidden");
  await Promise.all([
    loadDays(),
    loadTournaments(),
    loadValidatedTournaments(),
    loadPendingRequests(),
    loadPendingAccounts(),
    loadAccounts(),
  ]);
}

// --- Validation des nouveaux comptes ---
async function loadPendingAccounts() {
  const { data: pending, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("approved", false)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  const container = document.getElementById("pending-accounts-list");
  container.innerHTML = "";

  if (!pending || pending.length === 0) {
    container.innerHTML = "<p>Aucun compte en attente.</p>";
    return;
  }

  pending.forEach((profile) => {
    const row = document.createElement("div");
    row.className = "card";
    row.style.marginBottom = "10px";

    const title = document.createElement("div");
    title.innerHTML = `<strong>${profile.full_name || "Sans nom"}</strong> — ${profile.email}`;
    row.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.style.marginTop = "10px";

    const approveBtn = document.createElement("button");
    approveBtn.className = "primary";
    approveBtn.textContent = "Valider le compte";
    approveBtn.addEventListener("click", () => approveAccount(profile.id));

    actions.appendChild(approveBtn);
    row.appendChild(actions);

    container.appendChild(row);
  });
}

async function approveAccount(profileId) {
  const { error } = await supabaseClient
    .from("profiles")
    .update({ approved: true })
    .eq("id", profileId);

  if (error) {
    alert(error.message);
    return;
  }

  await loadPendingAccounts();
}

// --- Gestion des comptes (blocage / déblocage, retraits tardifs) ---
async function loadAccounts() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("approved", true)
    .eq("role", "user")
    .order("full_name", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  const tbody = document.getElementById("accounts-table-body");
  tbody.innerHTML = "";

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">Aucun compte validé pour le moment.</td></tr>';
    return;
  }

  data.forEach((profile) => {
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.textContent = profile.full_name || "—";
    tr.appendChild(tdName);

    const tdEmail = document.createElement("td");
    tdEmail.textContent = profile.email || "—";
    tr.appendChild(tdEmail);

    const tdStatus = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge " + (profile.blocked ? "rejected" : "approved");
    badge.textContent = profile.blocked ? "Bloqué" : "Actif";
    tdStatus.appendChild(badge);
    if (profile.blocked && profile.blocked_reason) {
      const reason = document.createElement("div");
      reason.className = "msg";
      reason.textContent = profile.blocked_reason;
      tdStatus.appendChild(reason);
    }
    tr.appendChild(tdStatus);

    const tdWithdrawals = document.createElement("td");
    tdWithdrawals.style.display = "flex";
    tdWithdrawals.style.alignItems = "center";
    tdWithdrawals.style.gap = "6px";

    const minusBtn = document.createElement("button");
    minusBtn.className = "secondary";
    minusBtn.textContent = "-";
    minusBtn.style.padding = "4px 10px";
    minusBtn.addEventListener("click", () => adjustLateWithdrawals(profile, -1));

    const countSpan = document.createElement("span");
    countSpan.textContent = profile.late_withdrawals_count;
    countSpan.style.minWidth = "16px";
    countSpan.style.textAlign = "center";

    const plusBtn = document.createElement("button");
    plusBtn.className = "secondary";
    plusBtn.textContent = "+";
    plusBtn.style.padding = "4px 10px";
    plusBtn.addEventListener("click", () => adjustLateWithdrawals(profile, 1));

    tdWithdrawals.appendChild(minusBtn);
    tdWithdrawals.appendChild(countSpan);
    tdWithdrawals.appendChild(plusBtn);
    tr.appendChild(tdWithdrawals);

    const tdActions = document.createElement("td");
    const toggleBtn = document.createElement("button");
    if (profile.blocked) {
      toggleBtn.className = "primary";
      toggleBtn.textContent = "Débloquer";
      toggleBtn.addEventListener("click", () => unblockAccount(profile));
    } else {
      toggleBtn.className = "danger";
      toggleBtn.textContent = "Bloquer";
      toggleBtn.addEventListener("click", () => openBlockModal(profile));
    }
    tdActions.appendChild(toggleBtn);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });
}

async function adjustLateWithdrawals(profile, delta) {
  const newCount = Math.max(0, (profile.late_withdrawals_count || 0) + delta);
  const { error } = await supabaseClient
    .from("profiles")
    .update({ late_withdrawals_count: newCount })
    .eq("id", profile.id);

  if (error) {
    alert(error.message);
    return;
  }

  await loadAccounts();
}

function openBlockModal(profile) {
  const modal = document.getElementById("block-account-modal");
  document.getElementById("block-account-modal-text").textContent =
    `Vous allez bloquer le compte de "${profile.full_name || profile.email}". Il ne pourra plus se connecter ni accéder au calendrier jusqu'à ce que vous le débloquiez.`;
  document.getElementById("block-account-comment").value = "";
  document.getElementById("block-account-modal-error").textContent = "";
  modal.dataset.profileId = profile.id;
  modal.classList.remove("hidden");
}

function closeBlockModal() {
  document.getElementById("block-account-modal").classList.add("hidden");
}

async function confirmBlockAccount() {
  const modal = document.getElementById("block-account-modal");
  const profileId = modal.dataset.profileId;
  const comment = document.getElementById("block-account-comment").value.trim() || null;
  const errEl = document.getElementById("block-account-modal-error");
  errEl.textContent = "";

  const { error } = await supabaseClient
    .from("profiles")
    .update({ blocked: true, blocked_reason: comment, blocked_at: new Date().toISOString() })
    .eq("id", profileId);

  if (error) {
    errEl.textContent = error.message;
    return;
  }

  closeBlockModal();
  await loadAccounts();
}

async function unblockAccount(profile) {
  if (!confirm(`Débloquer le compte de "${profile.full_name || profile.email}" ?`)) return;

  const { error } = await supabaseClient
    .from("profiles")
    .update({ blocked: false, blocked_reason: null, blocked_at: null })
    .eq("id", profile.id);

  if (error) {
    alert(error.message);
    return;
  }

  // Notifie le joueur par email que son compte est débloqué (best-effort :
  // un échec d'envoi ne doit pas bloquer le déblocage lui-même, déjà fait
  // ci-dessus).
  try {
    await fetch("/api/notify-unblock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: profile.email, full_name: profile.full_name }),
    });
  } catch (e) {
    console.warn("Email de déblocage non envoyé :", e);
  }

  await loadAccounts();
}

// --- Gestion des jours (repos / confirmé) ---
function toggleTournamentFields() {
  const type = document.getElementById("day-type").value;
  document.getElementById("tournament-fields").classList.toggle("hidden", type !== "confirmed");
}

async function handleDayFormSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById("day-form-msg");
  errEl.textContent = "";

  const date = document.getElementById("day-date").value;
  const day_type = document.getElementById("day-type").value;
  const tournament_name = document.getElementById("day-tournament-name").value.trim() || null;
  const tournament_location = document.getElementById("day-tournament-location").value.trim() || null;

  if (!date) {
    errEl.textContent = "Merci de choisir une date.";
    errEl.className = "msg error";
    return;
  }

  const payload = { date, day_type, tournament_name, tournament_location };

  // upsert sur la date (unique) : crée ou met à jour le jour
  const { error } = await supabaseClient
    .from("days")
    .upsert(payload, { onConflict: "date" });

  if (error) {
    errEl.textContent = error.message;
    errEl.className = "msg error";
    return;
  }

  errEl.textContent = "Jour enregistré.";
  errEl.className = "msg success";
  document.getElementById("day-form").reset();
  toggleTournamentFields();
  await loadDays();
}

async function loadDays() {
  const { data, error } = await supabaseClient
    .from("days")
    .select("*")
    .order("date", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  const tbody = document.getElementById("days-table-body");
  tbody.innerHTML = "";

  (data || []).forEach((day) => {
    const tr = document.createElement("tr");

    const tdDate = document.createElement("td");
    tdDate.textContent = day.date;
    tr.appendChild(tdDate);

    const tdType = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge " + day.day_type;
    badge.textContent = { rest: "Repos", confirmed: "Confirmé", available: "Disponible" }[day.day_type] || day.day_type;
    tdType.appendChild(badge);
    tr.appendChild(tdType);

    const tdName = document.createElement("td");
    tdName.textContent = day.tournament_name || "—";
    tr.appendChild(tdName);

    const tdLoc = document.createElement("td");
    tdLoc.textContent = day.tournament_location || "—";
    tr.appendChild(tdLoc);

    const tdActions = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.textContent = "Supprimer";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`Supprimer le jour ${day.date} ?`)) return;
      await supabaseClient.from("days").delete().eq("id", day.id);
      await loadDays();
    });
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });
}

// --- Gestion des tournois disponibles (remplis automatiquement chaque
//     jour par la recherche Ten'Up, ou ajoutés manuellement ici) ---
async function handleTournamentFormSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById("tournament-form-msg");
  errEl.textContent = "";

  const date = document.getElementById("tournament-date").value;
  const title = document.getElementById("tournament-title").value.trim();
  const location = document.getElementById("tournament-location").value.trim() || null;
  const description = document.getElementById("tournament-description").value.trim() || null;
  const is_evening = document.getElementById("tournament-evening").checked;

  if (!date || !title) {
    errEl.textContent = "Merci de renseigner au moins la date et le nom du tournoi.";
    errEl.className = "msg error";
    return;
  }

  // Vérifie si ce tournoi existe déjà (même date/titre/lieu) AVANT
  // l'upsert : dans ce cas c'est une mise à jour, pas un nouveau
  // tournoi, et on ne prévient pas les joueurs par email (voir plus bas,
  // chantier 1.3 "Calendrier mis à jour").
  let existingQuery = supabaseClient
    .from("day_tournaments")
    .select("id")
    .eq("date", date)
    .eq("title", title);
  existingQuery = location ? existingQuery.eq("location", location) : existingQuery.is("location", null);
  const { data: existing } = await existingQuery.maybeSingle();

  const { error } = await supabaseClient
    .from("day_tournaments")
    .upsert({ date, title, location, description, is_evening }, { onConflict: "date,title,location" });

  if (error) {
    errEl.textContent = error.message;
    errEl.className = "msg error";
    return;
  }

  errEl.textContent = "Tournoi ajouté.";
  errEl.className = "msg success";
  document.getElementById("tournament-form").reset();
  await loadTournaments();

  // Nouveau tournoi (pas une simple mise à jour) : prévient tous les
  // comptes validés par email, best-effort (un échec d'envoi ne doit
  // jamais faire échouer l'ajout du tournoi, déjà effectué ci-dessus).
  if (!existing) {
    try {
      await fetch("/api/notify-tournaments-added", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournaments: [{ date, title, location, is_evening }] }),
      });
    } catch (e) {
      console.warn("Email de calendrier mis à jour non envoyé :", e);
    }
  }
}

async function loadTournaments() {
  // Uniquement les tournois "actifs" (proposés aux joueurs). Dès qu'un
  // tournoi est validé, il passe en statut "confirmed" et bascule dans
  // le tableau "Tournois validés" (loadValidatedTournaments) : les deux
  // tableaux sont donc mutuellement exclusifs.
  const { data, error } = await supabaseClient
    .from("day_tournaments")
    .select("*")
    .eq("status", "active")
    .order("date", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  const tbody = document.getElementById("tournaments-table-body");
  tbody.innerHTML = "";
  // Un nouveau rendu du tableau invalide les cases cochées précédemment :
  // on redémarre donc aussi la case "tout sélectionner" à zéro.
  const selectAll = document.getElementById("tournaments-select-all");
  if (selectAll) selectAll.checked = false;

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">Aucun tournoi disponible pour le moment.</td></tr>';
    return;
  }

  data.forEach((t) => {
    const tr = document.createElement("tr");

    const tdCheck = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "tournament-select-checkbox";
    checkbox.value = t.id;
    checkbox.style.width = "auto";
    tdCheck.appendChild(checkbox);
    tr.appendChild(tdCheck);

    const tdDate = document.createElement("td");
    tdDate.textContent = t.date;
    tr.appendChild(tdDate);

    const tdTitle = document.createElement("td");
    tdTitle.textContent = t.title;
    tr.appendChild(tdTitle);

    const tdLoc = document.createElement("td");
    tdLoc.textContent = t.location || "—";
    tr.appendChild(tdLoc);

    const tdEvening = document.createElement("td");
    tdEvening.textContent = t.type === "friendly" ? "Match amical" : t.is_evening ? "Soirée" : "Journée";
    tr.appendChild(tdEvening);

    const tdActions = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.textContent = "Supprimer";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`Supprimer "${t.title}" du ${t.date} ?`)) return;
      await supabaseClient.from("day_tournaments").delete().eq("id", t.id);
      await loadTournaments();
    });
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });
}

// Valide d'un coup tous les tournois cochés dans "Tournois disponibles",
// même si aucun joueur n'a fait de demande pour eux : utile pour
// confirmer rapidement plusieurs tournois qu'on sait déjà se dérouler
// (ex: après un scan Ten'Up qui en a ajouté plusieurs d'un coup).
// Applique exactement la même logique que la validation classique d'une
// demande (resolveRequest) : le tournoi passe "confirmed", ses demandes
// pending éventuelles sont refusées, et les autres tournois OFFICIELS
// actifs du même jour/créneau sont retirés (jamais le "Match amical").
function openBulkValidateModal() {
  const msgEl = document.getElementById("bulk-validate-msg");
  msgEl.textContent = "";
  msgEl.className = "msg";

  const checkboxes = Array.from(document.querySelectorAll(".tournament-select-checkbox:checked"));
  if (checkboxes.length === 0) {
    msgEl.textContent = "Sélectionnez au moins un tournoi.";
    msgEl.className = "msg error";
    return;
  }

  // Modale maison plutôt que window.confirm() : plus cohérent avec le
  // reste de l'admin (mêmes modales que l'annulation de tournoi / le
  // blocage de compte), et plus fiable (un confirm() natif bloque le
  // fil d'exécution de la page entière).
  document.getElementById("bulk-validate-modal-text").textContent =
    `Valider ${checkboxes.length} tournoi(s) sélectionné(s) ? Ils ne seront plus disponibles aux demandes des joueurs.`;
  document.getElementById("bulk-validate-modal-error").textContent = "";
  document.getElementById("bulk-validate-modal").classList.remove("hidden");
}

function closeBulkValidateModal() {
  document.getElementById("bulk-validate-modal").classList.add("hidden");
}

async function confirmBulkValidateTournaments() {
  const modalErrEl = document.getElementById("bulk-validate-modal-error");
  modalErrEl.textContent = "";

  const msgEl = document.getElementById("bulk-validate-msg");
  msgEl.textContent = "";
  msgEl.className = "msg";

  const checkboxes = Array.from(document.querySelectorAll(".tournament-select-checkbox:checked"));
  if (checkboxes.length === 0) {
    closeBulkValidateModal();
    return;
  }

  const tournamentIds = checkboxes.map((cb) => cb.value);

  const { data: tournaments, error: fetchError } = await supabaseClient
    .from("day_tournaments")
    .select("*")
    .in("id", tournamentIds);

  if (fetchError) {
    modalErrEl.textContent = fetchError.message;
    return;
  }

  let validatedCount = 0;

  // Traités un par un, jamais en un seul appel groupé : chaque
  // validation applique sa propre cascade sur les tournois concurrents
  // du même jour/créneau, donc chaque étape doit voir l'état laissé par
  // la précédente (ex: si deux tournois sélectionnés sont malgré tout
  // sur le même jour/créneau, le second verra le premier déjà "confirmed"
  // et non plus "active", donc pas retiré à tort).
  for (const tournament of tournaments || []) {
    const { data: fresh } = await supabaseClient
      .from("day_tournaments")
      .select("status")
      .eq("id", tournament.id)
      .single();
    // Déjà validé ou retiré entre-temps (ex: coché deux fois, ou déjà
    // validé via une demande pendant ce même traitement) : on l'ignore.
    if (!fresh || fresh.status !== "active") continue;

    await supabaseClient.from("day_tournaments").update({ status: "confirmed" }).eq("id", tournament.id);

    await supabaseClient
      .from("requests")
      .update({ status: "rejected" })
      .eq("tournament_id", tournament.id)
      .eq("status", "pending");

    const { data: siblings } = await supabaseClient
      .from("day_tournaments")
      .select("id")
      .eq("date", tournament.date)
      .eq("is_evening", tournament.is_evening)
      .eq("status", "active")
      .eq("type", "official")
      .neq("id", tournament.id);

    const siblingIds = (siblings || []).map((s) => s.id);
    if (siblingIds.length > 0) {
      await supabaseClient
        .from("requests")
        .update({ status: "rejected" })
        .in("tournament_id", siblingIds)
        .eq("status", "pending");

      await supabaseClient
        .from("day_tournaments")
        .update({ status: "removed" })
        .in("id", siblingIds);
    }

    validatedCount += 1;
  }

  msgEl.textContent = `${validatedCount} tournoi(s) validé(s).`;
  msgEl.className = "msg success";
  closeBulkValidateModal();

  await Promise.all([loadTournaments(), loadValidatedTournaments(), loadPendingRequests()]);
}

// --- Gestion des tournois validés (une demande a été approuvée) ---
async function loadValidatedTournaments() {
  const { data, error } = await supabaseClient
    .from("day_tournaments")
    .select("*")
    .eq("status", "confirmed")
    .order("date", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  const tbody = document.getElementById("validated-tournaments-table-body");
  tbody.innerHTML = "";

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">Aucun tournoi validé pour le moment.</td></tr>';
    return;
  }

  data.forEach((t) => {
    const tr = document.createElement("tr");

    const tdDate = document.createElement("td");
    tdDate.textContent = t.date;
    tr.appendChild(tdDate);

    const tdTitle = document.createElement("td");
    tdTitle.textContent = t.title;
    tr.appendChild(tdTitle);

    const tdLoc = document.createElement("td");
    tdLoc.textContent = t.location || "—";
    tr.appendChild(tdLoc);

    const tdEvening = document.createElement("td");
    tdEvening.textContent = t.type === "friendly" ? "Match amical" : t.is_evening ? "Soirée" : "Journée";
    tr.appendChild(tdEvening);

    const tdActions = document.createElement("td");
    tdActions.className = "row-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "secondary";
    cancelBtn.textContent = "Annuler";
    cancelBtn.addEventListener("click", () => openAdminCancelModal(t));
    tdActions.appendChild(cancelBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.textContent = "Supprimer";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`Supprimer définitivement "${t.title}" du ${t.date} ? Cette action est irréversible.`)) return;
      await supabaseClient.from("day_tournaments").delete().eq("id", t.id);
      await loadValidatedTournaments();
    });
    tdActions.appendChild(delBtn);

    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });
}

// Ouvre la fenêtre de confirmation d'annulation (question 1 : remettre
// visible ou non ; question 2 : bouton "Confirmer l'annulation").
function openAdminCancelModal(tournament) {
  const modal = document.getElementById("admin-cancel-modal");
  document.getElementById("admin-cancel-modal-text").textContent =
    `Vous allez annuler la validation de "${tournament.title}" du ${tournament.date}${tournament.location ? " — " + tournament.location : ""}.`;
  document.getElementById("admin-cancel-visible-yes").checked = true;
  document.getElementById("admin-cancel-modal-error").textContent = "";
  modal.dataset.tournamentId = tournament.id;
  modal.classList.remove("hidden");
}

function closeAdminCancelModal() {
  document.getElementById("admin-cancel-modal").classList.add("hidden");
}

async function confirmAdminCancelTournament() {
  const modal = document.getElementById("admin-cancel-modal");
  const tournamentId = modal.dataset.tournamentId;
  const makeVisible = document.getElementById("admin-cancel-visible-yes").checked;
  const errEl = document.getElementById("admin-cancel-modal-error");
  errEl.textContent = "";

  // Récupère les infos du tournoi et les joueurs dont la demande était
  // approuvée AVANT de supprimer les demandes plus bas (chantier 1.2
  // "Annulation de tournoi") : une fois les lignes "requests" effacées,
  // cette information est perdue pour toujours.
  const [{ data: tournamentRow }, { data: approvedRequests }] = await Promise.all([
    supabaseClient.from("day_tournaments").select("*").eq("id", tournamentId).single(),
    supabaseClient.from("requests").select("user_id").eq("tournament_id", tournamentId).eq("status", "approved"),
  ]);

  let recipients = [];
  if (approvedRequests && approvedRequests.length > 0) {
    const userIds = approvedRequests.map((r) => r.user_id);
    const { data: profiles } = await supabaseClient
      .from("profiles")
      .select("email, full_name")
      .in("id", userIds);
    recipients = profiles || [];
  }

  // 1. Le tournoi redevient "actif" (visible dans "Tournois disponibles")
  //    ou passe en "removed" (masqué du calendrier et des deux tableaux).
  const { error: tError } = await supabaseClient
    .from("day_tournaments")
    .update({ status: makeVisible ? "active" : "removed" })
    .eq("id", tournamentId);

  if (tError) {
    errEl.textContent = tError.message;
    return;
  }

  // 2. On efface toutes les demandes liées à ce tournoi (validée comme
  //    refusées/en attente éventuelles) : le tournoi doit retrouver sa
  //    forme initiale, comme s'il n'avait jamais été demandé. Aucun badge
  //    ni message d'annulation ne doit rester visible pour les joueurs.
  await supabaseClient
    .from("requests")
    .delete()
    .eq("tournament_id", tournamentId);

  // 3. Email d'annulation aux joueurs dont la demande était approuvée,
  //    best-effort (un échec d'envoi ne doit jamais bloquer l'annulation
  //    elle-même, déjà effectuée ci-dessus).
  if (recipients.length > 0 && tournamentRow) {
    try {
      await fetch("/api/notify-tournament-cancelled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients,
          tournament: {
            title: tournamentRow.title,
            date: tournamentRow.date,
            location: tournamentRow.location,
          },
        }),
      });
    } catch (e) {
      console.warn("Email d'annulation non envoyé :", e);
    }
  }

  closeAdminCancelModal();
  await Promise.all([loadTournaments(), loadValidatedTournaments(), loadPendingRequests()]);
}

// --- Gestion des demandes en attente ---
async function loadPendingRequests() {
  const { data: requests, error } = await supabaseClient
    .from("requests")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  const container = document.getElementById("requests-list");
  container.innerHTML = "";

  if (!requests || requests.length === 0) {
    container.innerHTML = "<p>Aucune demande en attente.</p>";
    return;
  }

  const tournamentIds = [...new Set(requests.map((r) => r.tournament_id))];
  const userIds = [...new Set(requests.map((r) => r.user_id))];

  const [{ data: tournaments }, { data: profiles }] = await Promise.all([
    supabaseClient.from("day_tournaments").select("*").in("id", tournamentIds),
    supabaseClient.from("profiles").select("*").in("id", userIds),
  ]);

  const tournamentsById = Object.fromEntries((tournaments || []).map((t) => [t.id, t]));
  const profilesById = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

  requests.forEach((r) => {
    const tournament = tournamentsById[r.tournament_id];
    const profile = profilesById[r.user_id];

    const row = document.createElement("div");
    row.className = "card";
    row.style.marginBottom = "10px";
    row.style.display = "flex";
    row.style.gap = "12px";
    row.style.alignItems = "flex-start";

    const avatar = document.createElement("img");
    avatar.src = profile && profile.avatar_url ? profile.avatar_url : "https://api.dicebear.com/7.x/initials/svg?seed=" + encodeURIComponent(profile ? (profile.full_name || profile.email || "?") : "?");
    avatar.alt = "";
    avatar.style.width = "40px";
    avatar.style.height = "40px";
    avatar.style.borderRadius = "50%";
    avatar.style.objectFit = "cover";
    avatar.style.flexShrink = "0";
    row.appendChild(avatar);

    const content = document.createElement("div");
    content.style.flex = "1";

    const title = document.createElement("div");
    title.innerHTML = `<strong>${profile ? (profile.full_name || profile.email) : "Utilisateur"}</strong> souhaite jouer
      <strong>${tournament ? tournament.title : "un tournoi"}</strong>
      ${tournament ? `<span class="pill">${tournament.date}${tournament.location ? " — " + tournament.location : ""}${tournament.is_evening ? " (soirée)" : ""}</span>` : ""}`;
    content.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "msg";
    meta.textContent = `Demande envoyée le ${new Date(r.created_at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}`;
    content.appendChild(meta);

    if (r.message) {
      const msg = document.createElement("div");
      msg.className = "msg";
      msg.textContent = `« ${r.message} »`;
      content.appendChild(msg);
    }

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.style.marginTop = "10px";

    const approveBtn = document.createElement("button");
    approveBtn.className = "primary";
    approveBtn.textContent = "Valider";
    approveBtn.addEventListener("click", () => resolveRequest(r, "approved", tournament, profile));

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "danger";
    rejectBtn.textContent = "Refuser";
    rejectBtn.addEventListener("click", () => resolveRequest(r, "rejected", tournament, profile));

    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    content.appendChild(actions);

    row.appendChild(content);
    container.appendChild(row);
  });
}

async function resolveRequest(request, decision, tournament, profile) {
  // 1. Met à jour la demande choisie
  const { error } = await supabaseClient
    .from("requests")
    .update({ status: decision })
    .eq("id", request.id);

  if (error) {
    alert(error.message);
    return;
  }

  if (decision === "approved" && tournament) {
    // 2. Ce tournoi devient "confirmé"
    await supabaseClient
      .from("day_tournaments")
      .update({ status: "confirmed" })
      .eq("id", tournament.id);

    // 3. Les autres tournois OFFICIELS de la même date ET de la même
    //    catégorie (journée / soirée) sont retirés du calendrier, et
    //    leurs éventuelles demandes en attente sont automatiquement
    //    refusées. Les tournois de l'autre catégorie (ex : soirée si
    //    celui validé est en journée) restent disponibles, et la case
    //    "Match amical" (type friendly) n'est JAMAIS touchée par cette
    //    cascade, quel que soit son créneau.
    const { data: siblings } = await supabaseClient
      .from("day_tournaments")
      .select("id")
      .eq("date", tournament.date)
      .eq("is_evening", tournament.is_evening)
      .eq("status", "active")
      .eq("type", "official")
      .neq("id", tournament.id);

    const siblingIds = (siblings || []).map((s) => s.id);
    if (siblingIds.length > 0) {
      await supabaseClient
        .from("requests")
        .update({ status: "rejected" })
        .in("tournament_id", siblingIds)
        .eq("status", "pending");

      await supabaseClient
        .from("day_tournaments")
        .update({ status: "removed" })
        .in("id", siblingIds);
    }

    // 4. Email de confirmation au joueur, best-effort (un échec d'envoi
    //    ne doit jamais bloquer la validation elle-même, déjà effectuée
    //    ci-dessus). Chantier 1.1 "Confirmation de tournoi validé".
    if (profile && profile.email) {
      try {
        await fetch("/api/notify-tournament-approved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: profile.email,
            full_name: profile.full_name,
            tournament: {
              title: tournament.title,
              date: tournament.date,
              location: tournament.location,
              is_evening: tournament.is_evening,
              description: tournament.description,
            },
          }),
        });
      } catch (e) {
        console.warn("Email de confirmation non envoyé :", e);
      }
    }
  }

  await Promise.all([loadDays(), loadTournaments(), loadValidatedTournaments(), loadPendingRequests()]);
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("day-type").addEventListener("change", toggleTournamentFields);
  document.getElementById("day-form").addEventListener("submit", handleDayFormSubmit);
  document.getElementById("tournament-form").addEventListener("submit", handleTournamentFormSubmit);
  document.getElementById("admin-cancel-modal-back").addEventListener("click", closeAdminCancelModal);
  document.getElementById("admin-cancel-modal-confirm").addEventListener("click", confirmAdminCancelTournament);
  document.getElementById("block-account-modal-back").addEventListener("click", closeBlockModal);
  document.getElementById("block-account-modal-confirm").addEventListener("click", confirmBlockAccount);
  document.getElementById("tournaments-select-all").addEventListener("change", (e) => {
    document.querySelectorAll(".tournament-select-checkbox").forEach((cb) => {
      cb.checked = e.target.checked;
    });
  });
  document.getElementById("bulk-validate-btn").addEventListener("click", openBulkValidateModal);
  document.getElementById("bulk-validate-modal-back").addEventListener("click", closeBulkValidateModal);
  document.getElementById("bulk-validate-modal-confirm").addEventListener("click", confirmBulkValidateTournaments);
  toggleTournamentFields();
});
