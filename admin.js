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
  await Promise.all([loadDays(), loadPendingRequests(), loadPendingAccounts()]);
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

// --- Gestion des jours ---
function toggleTournamentFields() {
  const type = document.getElementById("day-type").value;
  const show = type === "confirmed" || type === "available";
  document.getElementById("tournament-fields").classList.toggle("hidden", !show);
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
    badge.textContent = { rest: "Repos", confirmed: "Confirmé", available: "Disponible" }[day.day_type];
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

  const dayIds = [...new Set(requests.map((r) => r.day_id))];
  const userIds = [...new Set(requests.map((r) => r.user_id))];

  const [{ data: days }, { data: profiles }] = await Promise.all([
    supabaseClient.from("days").select("*").in("id", dayIds),
    supabaseClient.from("profiles").select("*").in("id", userIds),
  ]);

  const daysById = Object.fromEntries((days || []).map((d) => [d.id, d]));
  const profilesById = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

  requests.forEach((r) => {
    const day = daysById[r.day_id];
    const profile = profilesById[r.user_id];

    const row = document.createElement("div");
    row.className = "card";
    row.style.marginBottom = "10px";

    const title = document.createElement("div");
    title.innerHTML = `<strong>${profile ? (profile.full_name || profile.email) : "Utilisateur"}</strong> souhaite jouer
      <strong>${day ? (day.tournament_name || day.date) : "un tournoi"}</strong>
      ${day ? `<span class="pill">${day.date}</span>` : ""}`;
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
    approveBtn.addEventListener("click", () => resolveRequest(r, "approved"));

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "danger";
    rejectBtn.textContent = "Refuser";
    rejectBtn.addEventListener("click", () => resolveRequest(r, "rejected"));

    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    row.appendChild(actions);

    container.appendChild(row);
  });
}

async function resolveRequest(request, decision) {
  // 1. Met à jour la demande choisie
  const { error } = await supabaseClient
    .from("requests")
    .update({ status: decision })
    .eq("id", request.id);

  if (error) {
    alert(error.message);
    return;
  }

  if (decision === "approved") {
    // 2. Le jour devient "confirmé"
    await supabaseClient
      .from("days")
      .update({ day_type: "confirmed" })
      .eq("id", request.day_id);

    // 3. Les autres demandes en attente pour ce même jour sont refusées
    await supabaseClient
      .from("requests")
      .update({ status: "rejected" })
      .eq("day_id", request.day_id)
      .eq("status", "pending")
      .neq("id", request.id);
  }

  await Promise.all([loadDays(), loadPendingRequests()]);
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("day-type").addEventListener("change", toggleTournamentFields);
  document.getElementById("day-form").addEventListener("submit", handleDayFormSubmit);
  toggleTournamentFields();
});
