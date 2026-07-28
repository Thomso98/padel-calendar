// Logique du calendrier public (page index.html) : affichage du
// mois, statut de chaque jour, et envoi des demandes.

const MOIS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
const JOURS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

let currentUser = null;
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth(); // 0-11
let daysByDate = {};       // { 'YYYY-MM-DD': dayRow }
let myRequestsByDayId = {}; // { day_id: requestRow } (dernière demande de l'utilisateur pour ce jour)

async function onAuthenticated(user) {
  currentUser = user;
  await loadMonth();
}

function monthRangeISO(year, monthIndex) {
  const start = toISODate(new Date(year, monthIndex, 1));
  const end = toISODate(new Date(year, monthIndex + 1, 0));
  return { start, end };
}

async function loadMonth() {
  const { start, end } = monthRangeISO(viewYear, viewMonth);

  const { data: days, error: daysError } = await supabaseClient
    .from("days")
    .select("*")
    .gte("date", start)
    .lte("date", end);

  if (daysError) {
    console.error(daysError);
    return;
  }

  daysByDate = {};
  (days || []).forEach((d) => { daysByDate[d.date] = d; });

  const dayIds = (days || []).map((d) => d.id);
  myRequestsByDayId = {};
  if (dayIds.length > 0 && currentUser) {
    const { data: myRequests, error: reqError } = await supabaseClient
      .from("requests")
      .select("*")
      .eq("user_id", currentUser.id)
      .in("day_id", dayIds);
    if (!reqError) {
      (myRequests || []).forEach((r) => {
        // garde la plus récente si plusieurs demandes existent pour le même jour
        const existing = myRequestsByDayId[r.day_id];
        if (!existing || new Date(r.created_at) > new Date(existing.created_at)) {
          myRequestsByDayId[r.day_id] = r;
        }
      });
    }
  }

  renderCalendar();
}

function renderCalendar() {
  document.getElementById("cal-title").textContent = `${MOIS_FR[viewMonth]} ${viewYear}`;

  const grid = document.getElementById("cal-grid");
  grid.innerHTML = "";

  JOURS_FR.forEach((j) => {
    const dow = document.createElement("div");
    dow.className = "cal-dow";
    dow.textContent = j;
    grid.appendChild(dow);
  });

  const cells = buildMonthGrid(viewYear, viewMonth);

  cells.forEach((iso) => {
    const cell = document.createElement("div");
    if (!iso) {
      cell.className = "cal-day empty";
      grid.appendChild(cell);
      return;
    }

    const day = daysByDate[iso];
    const past = isPastDate(iso);
    const dayType = day ? day.day_type : null;

    cell.className = "cal-day" + (dayType ? ` ${dayType}` : "") + (past ? " past" : "");

    const num = document.createElement("div");
    num.className = "num";
    num.textContent = String(parseInt(iso.split("-")[2], 10));
    cell.appendChild(num);

    if (dayType === "rest") {
      const badge = document.createElement("span");
      badge.className = "badge rest";
      badge.textContent = "Repos";
      cell.appendChild(badge);
    } else if (dayType === "confirmed") {
      const badge = document.createElement("span");
      badge.className = "badge confirmed";
      badge.textContent = "Tournoi confirmé";
      cell.appendChild(badge);
      appendTournamentInfo(cell, day);
      const myApprovedReq = myRequestsByDayId[day.id];
      if (myApprovedReq && myApprovedReq.status === "approved") {
        const s = document.createElement("span");
        s.className = "badge approved";
        s.textContent = "Votre demande validée";
        cell.appendChild(s);
      }
    } else if (dayType === "available") {
      const badge = document.createElement("span");
      badge.className = "badge available";
      badge.textContent = "Tournoi possible";
      cell.appendChild(badge);
      appendTournamentInfo(cell, day);

      const myReq = myRequestsByDayId[day.id];
      if (!past) {
        if (myReq && myReq.status === "pending") {
          const s = document.createElement("span");
          s.className = "badge pending";
          s.textContent = "Demande envoyée";
          cell.appendChild(s);
          addCancelButton(cell, day, myReq);
        } else if (myReq && myReq.status === "rejected") {
          const s = document.createElement("span");
          s.className = "badge rejected";
          s.textContent = "Refusée";
          cell.appendChild(s);
          addRequestButton(cell, day, "Redemander");
        } else if (myReq && myReq.status === "cancelled") {
          const s = document.createElement("span");
          s.className = "badge cancelled";
          s.textContent = "Demande annulée";
          cell.appendChild(s);
          addRequestButton(cell, day, "Redemander");
        } else {
          addRequestButton(cell, day, "Demander à jouer");
        }
      }
    }

    grid.appendChild(cell);
  });
}

function appendTournamentInfo(cell, day) {
  if (day.tournament_name) {
    const name = document.createElement("div");
    name.className = "tournament-name";
    name.textContent = day.tournament_name;
    cell.appendChild(name);
  }
  if (day.tournament_location) {
    const loc = document.createElement("div");
    loc.className = "tournament-loc";
    loc.textContent = day.tournament_location;
    cell.appendChild(loc);
  }
}

function addRequestButton(cell, day, label) {
  const btn = document.createElement("button");
  btn.className = "request-btn";
  btn.textContent = label;
  btn.addEventListener("click", () => openRequestModal(day));
  cell.appendChild(btn);
}

function addCancelButton(cell, day, request) {
  const btn = document.createElement("button");
  btn.className = "request-btn";
  btn.style.background = "#c0392b";
  btn.textContent = "Annuler ma demande";
  btn.addEventListener("click", () => openCancelModal(day, request));
  cell.appendChild(btn);
}

function showGlobalMessage(text) {
  const el = document.getElementById("global-msg");
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(showGlobalMessage._timer);
  showGlobalMessage._timer = setTimeout(() => el.classList.add("hidden"), 5000);
}

// --- Modal de demande ---
function openRequestModal(day) {
  document.getElementById("modal-day-name").textContent =
    (day.tournament_name || "Tournoi") + " — " + day.date;
  document.getElementById("modal-message").value = "";
  document.getElementById("request-modal").dataset.dayId = day.id;
  document.getElementById("modal-error").textContent = "";
  document.getElementById("request-modal").classList.remove("hidden");
}

function closeRequestModal() {
  document.getElementById("request-modal").classList.add("hidden");
}

async function submitRequest() {
  const dayId = document.getElementById("request-modal").dataset.dayId;
  const message = document.getElementById("modal-message").value.trim();
  const errEl = document.getElementById("modal-error");
  errEl.textContent = "";

  const { error } = await supabaseClient.from("requests").insert({
    day_id: dayId,
    user_id: currentUser.id,
    message: message || null,
  });

  if (error) {
    errEl.textContent = error.message;
    return;
  }

  closeRequestModal();
  await loadMonth();
}

// --- Modal d'annulation (étape 2 : confirmation) ---
function openCancelModal(day, request) {
  document.getElementById("cancel-modal-text").textContent =
    `Voulez-vous vraiment annuler votre demande pour "${day.tournament_name || "ce tournoi"}" du ${day.date} ?`;
  document.getElementById("cancel-modal-error").textContent = "";
  document.getElementById("cancel-modal").dataset.requestId = request.id;
  document.getElementById("cancel-modal").classList.remove("hidden");
}

function closeCancelModal() {
  document.getElementById("cancel-modal").classList.add("hidden");
}

async function confirmCancelRequest() {
  const requestId = document.getElementById("cancel-modal").dataset.requestId;
  const errEl = document.getElementById("cancel-modal-error");
  errEl.textContent = "";

  const { error } = await supabaseClient
    .from("requests")
    .update({ status: "cancelled" })
    .eq("id", requestId);

  if (error) {
    errEl.textContent = error.message;
    return;
  }

  closeCancelModal();
  showGlobalMessage("Demande annulée.");
  await loadMonth();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("prev-month").addEventListener("click", () => {
    viewMonth -= 1;
    if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
    loadMonth();
  });
  document.getElementById("next-month").addEventListener("click", () => {
    viewMonth += 1;
    if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
    loadMonth();
  });
  document.getElementById("modal-cancel").addEventListener("click", closeRequestModal);
  document.getElementById("modal-submit").addEventListener("click", submitRequest);
  document.getElementById("cancel-modal-no").addEventListener("click", closeCancelModal);
  document.getElementById("cancel-modal-yes").addEventListener("click", confirmCancelRequest);
});
