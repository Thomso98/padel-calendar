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
  await Promise.all([loadDays(), loadTournaments(), loadPendingRequests(), loadPendingAccounts()]);
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
  const is_evening = document.getElementById("tournament-evening").checked;

  if (!date || !title) {
    errEl.textContent = "Merci de renseigner au moins la date et le nom du tournoi.";
    errEl.className = "msg error";
    return;
  }

  const { error } = await supabaseClient
    .from("day_tournaments")
    .upsert({ date, title, location, is_evening }, { onConflict: "date,title,location" });

  if (error) {
    errEl.textContent = error.message;
    errEl.className = "msg error";
    return;
  }

  errEl.textContent = "Tournoi ajouté.";
  errEl.className = "msg success";
  document.getElementById("tournament-form").reset();
  await loadTournaments();
}

async function loadTournaments() {
  const { data, error } = await supabaseClient
    .from("day_tournaments")
    .select("*")
    .neq("status", "removed")
    .order("date", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  const tbody = document.getElementById("tournaments-table-body");
  tbody.innerHTML = "";

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">Aucun tournoi pour le moment.</td></tr>';
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
    tdEvening.textContent = t.is_evening ? "Soirée" : "Journée";
    tr.appendChild(tdEvening);

    const tdStatus = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge " + (t.status === "confirmed" ? "confirmed" : "available");
    badge.textContent = t.status === "confirmed" ? "Validé" : "Actif";
    tdStatus.appendChild(badge);
    tr.appendChild(tdStatus);

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

    const title = document.createElement("div");
    title.innerHTML = `<strong>${profile ? (profile.full_name || profile.email) : "Utilisateur"}</strong> souhaite jouer
      <strong>${tournament ? tournament.title : "un tournoi"}</strong>
      ${tournament ? `<span class="pill">${tournament.date}${tournament.location ? " — " + tournament.location : ""}${tournament.is_evening ? " (soirée)" : ""}</span>` : ""}`;
    row.appendChild(title);

    if (r.message) {
      const msg = document.createElement("div");
      msg.className = "msg";
      msg.textContent = `« ${r.message} »`;
      row.appendChild(msg);
    }

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.style.marginTop = "10px";

    const approveBtn = document.createElement("button");
    approveBtn.className = "primary";
    approveBtn.textContent = "Valider";
    approveBtn.addEventListener("click", () => resolveRequest(r, "approved", tournament));

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "danger";
    rejectBtn.textContent = "Refuser";
    rejectBtn.addEventListener("click", () => resolveRequest(r, "rejected", tournament));

    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    row.appendChild(actions);

    container.appendChild(row);
  });
}

async function resolveRequest(request, decision, tournament) {
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

    // 3. Les autres tournois de la même date ET de la même catégorie
    //    (journée / soirée) sont retirés du calendrier, et leurs
    //    éventuelles demandes en attente sont automatiquement refusées.
    //    Les tournois de l'autre catégorie (ex : soirée si celui validé
    //    est en journée) restent disponibles.
    const { data: siblings } = await supabaseClient
      .from("day_tournaments")
      .select("id")
      .eq("date", tournament.date)
      .eq("is_evening", tournament.is_evening)
      .eq("status", "active")
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
  }

  await Promise.all([loadDays(), loadTournaments(), loadPendingRequests()]);
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("day-type").addEventListener("change", toggleTournamentFields);
  document.getElementById("day-form").addEventListener("submit", handleDayFormSubmit);
  document.getElementById("tournament-form").addEventListener("submit", handleTournamentFormSubmit);
  toggleTournamentFields();
});
