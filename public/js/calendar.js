// Logique du calendrier public (page index.html) : affichage du
// mois, statut de chaque jour (repos / confirmé), tournois disponibles
// (une case par tournoi) et envoi des demandes.

const MOIS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
const JOURS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

let currentUser = null;
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth(); // 0-11
let daysByDate = {};                // { 'YYYY-MM-DD': dayRow } (repos / confirmé, décidé par l'admin)
let tournamentsByDate = {};         // { 'YYYY-MM-DD': [tournamentRow, ...] }
let myRequestsByTournamentId = {};  // { tournament_id: requestRow } (dernière demande de l'utilisateur pour ce tournoi)

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

  const [{ data: days, error: daysError }, { data: tournaments, error: tError }] = await Promise.all([
    supabaseClient.from("days").select("*").gte("date", start).lte("date", end),
    supabaseClient
      .from("day_tournaments")
      .select("*")
      .gte("date", start)
      .lte("date", end)
      .neq("status", "removed")
      .order("is_evening", { ascending: true })
      .order("title", { ascending: true }),
  ]);

  if (daysError) console.error(daysError);
  if (tError) console.error(tError);

  daysByDate = {};
  (days || []).forEach((d) => { daysByDate[d.date] = d; });

  tournamentsByDate = {};
  (tournaments || []).forEach((t) => {
    if (!tournamentsByDate[t.date]) tournamentsByDate[t.date] = [];
    tournamentsByDate[t.date].push(t);
  });

  const tournamentIds = (tournaments || []).map((t) => t.id);
  myRequestsByTournamentId = {};
  if (tournamentIds.length > 0 && currentUser) {
    const { data: myRequests, error: reqError } = await supabaseClient
      .from("requests")
      .select("*")
      .eq("user_id", currentUser.id)
      .in("tournament_id", tournamentIds);
    if (!reqError) {
      (myRequests || []).forEach((r) => {
        // garde la plus récente si plusieurs demandes existent pour le même tournoi
        const existing = myRequestsByTournamentId[r.tournament_id];
        if (!existing || new Date(r.created_at) > new Date(existing.created_at)) {
          myRequestsByTournamentId[r.tournament_id] = r;
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
    } else {
      const list = tournamentsByDate[iso] || [];
      const officialList = list.filter((t) => t.type !== "friendly");
      officialList.forEach((t) => appendTournamentCard(cell, t, past));

      // Case "Match amical" : toujours affichée en dernier, tous les
      // jours (hors repos / tournoi confirmé). Si aucune ligne n'existe
      // encore en base pour cette date, on affiche une case "virtuelle"
      // (id vide) : la ligne réelle n'est créée qu'au moment où un
      // joueur clique sur "Demander à jouer" (fonction ensure_friendly_slot).
      const friendly = list.find((t) => t.type === "friendly") || {
        id: "",
        date: iso,
        title: "Match amical",
        location: null,
        is_evening: false,
        status: "active",
        type: "friendly",
      };
      appendTournamentCard(cell, friendly, past);
    }

    grid.appendChild(cell);
  });
}

function appendTournamentCard(cell, tournament, past) {
  const isFriendly = tournament.type === "friendly";
  const myReqForLockCheck = myRequestsByTournamentId[tournament.id];
  // "Bloqué" : une demande pending existe sur ce tournoi, faite par un
  // AUTRE utilisateur que la personne qui regarde le calendrier (si
  // c'est sa propre demande pending, on garde l'affichage habituel
  // "Demande envoyée" + bouton annuler, géré plus bas).
  const lockedByOther =
    tournament.status === "active" &&
    tournament.has_pending_request &&
    !(myReqForLockCheck && myReqForLockCheck.status === "pending");

  const card = document.createElement("div");
  card.className =
    "tournament-card" +
    (isFriendly ? " friendly" : tournament.is_evening ? " evening" : " day") +
    (tournament.status === "confirmed" ? " confirmed" : "") +
    (lockedByOther ? " locked" : "");

  const badge = document.createElement("span");
  badge.className =
    "badge " +
    (tournament.status === "confirmed"
      ? "confirmed"
      : lockedByOther
      ? "locked"
      : isFriendly
      ? "friendly"
      : tournament.is_evening
      ? "evening"
      : "available");
  badge.textContent =
    tournament.status === "confirmed"
      ? "Complet — indisponible"
      : lockedByOther
      ? "En attente de validation"
      : isFriendly
      ? "Match amical"
      : tournament.is_evening
      ? "Soirée"
      : "Tournoi possible";
  card.appendChild(badge);

  const name = document.createElement("div");
  name.className = "tournament-name";
  name.textContent = tournament.title;
  card.appendChild(name);

  if (tournament.location) {
    const loc = document.createElement("div");
    loc.className = "tournament-loc";
    loc.textContent = tournament.location;
    card.appendChild(loc);
  }

  if (!past) {
    if (tournament.status === "confirmed") {
      const myReq = myRequestsByTournamentId[tournament.id];
      if (myReq && myReq.status === "approved") {
        const s = document.createElement("span");
        s.className = "badge approved";
        s.textContent = "Votre demande validée";
        card.appendChild(s);
      }
    } else {
      const myReq = myRequestsByTournamentId[tournament.id];
      if (myReq && myReq.status === "pending") {
        const s = document.createElement("span");
        s.className = "badge pending";
        s.textContent = "Demande envoyée";
        card.appendChild(s);
        addCancelButton(card, tournament, myReq);
      } else if (myReq && myReq.status === "rejected") {
        const s = document.createElement("span");
        s.className = "badge rejected";
        s.textContent = "Refusée";
        card.appendChild(s);
        addRequestButton(card, tournament, "Redemander");
      } else if (myReq && myReq.status === "cancelled") {
        const s = document.createElement("span");
        s.className = "badge cancelled";
        s.textContent = "Demande annulée";
        card.appendChild(s);
        if (!lockedByOther) addRequestButton(card, tournament, "Redemander");
      } else if (lockedByOther) {
        // Un autre joueur a déjà une demande en attente sur ce tournoi :
        // pas de bouton, juste le badge orange "En attente de validation"
        // déjà ajouté plus haut.
      } else {
        addRequestButton(card, tournament, isFriendly ? "Proposer un match" : "Demander à jouer");
      }
    }
  }

  cell.appendChild(card);
}

function addRequestButton(card, tournament, label) {
  const btn = document.createElement("button");
  btn.className = "request-btn";
  btn.textContent = label;
  btn.addEventListener("click", () => openRequestModal(tournament));
  card.appendChild(btn);
}

function addCancelButton(card, tournament, request) {
  const btn = document.createElement("button");
  btn.className = "request-btn";
  btn.style.background = "#c0392b";
  btn.textContent = "Annuler ma demande";
  btn.addEventListener("click", () => openCancelModal(tournament, request));
  card.appendChild(btn);
}

function showGlobalMessage(text) {
  const el = document.getElementById("global-msg");
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(showGlobalMessage._timer);
  showGlobalMessage._timer = setTimeout(() => el.classList.add("hidden"), 5000);
}

// Échappe le HTML puis transforme tout lien http(s) trouvé dans le texte
// en lien cliquable. Permet d'afficher tel quel un lien copié depuis la
// fiche Ten'Up (ex: lien d'inscription, règlement PDF...) tout en évitant
// l'injection de HTML arbitraire dans la description.
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkifyDescription(text) {
  const escaped = escapeHtml(text);
  const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
  return escaped.replace(urlRegex, (url) => {
    // Ne garde pas la ponctuation de fin de phrase collée au lien (. , ) etc.)
    const trailingMatch = url.match(/[).,;:!?]+$/);
    const trailing = trailingMatch ? trailingMatch[0] : "";
    const cleanUrl = trailing ? url.slice(0, -trailing.length) : url;
    return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>${trailing}`;
  });
}

// --- Modal de demande ---
function openRequestModal(tournament) {
  const isFriendly = tournament.type === "friendly";
  const modal = document.getElementById("request-modal");

  // Nom du tournoi en gras (titre de la modal)
  document.getElementById("modal-day-name").textContent = tournament.title || (isFriendly ? "Match amical" : "Tournoi");

  // Date / lieu, juste en dessous
  const metaParts = [tournament.date];
  if (tournament.location) metaParts.push(tournament.location);
  document.getElementById("modal-tournament-meta").textContent = metaParts.join(" — ");

  // Description copiée telle quelle depuis la fiche du tournoi sur Ten'Up
  // (remplie par le scan automatique, ou à la main par l'admin)
  const descEl = document.getElementById("modal-tournament-description");
  if (tournament.description && tournament.description.trim()) {
    descEl.innerHTML = linkifyDescription(tournament.description.trim());
    descEl.classList.remove("hidden");
  } else {
    descEl.innerHTML = "";
    descEl.classList.add("hidden");
  }

  document.getElementById("modal-message").value = "";
  document.getElementById("modal-message-label").textContent = isFriendly
    ? "Description (obligatoire)"
    : "Message (optionnel)";
  modal.dataset.tournamentId = tournament.id || "";
  modal.dataset.date = tournament.date;
  modal.dataset.requireMessage = isFriendly ? "true" : "false";
  document.getElementById("modal-error").textContent = "";
  modal.classList.remove("hidden");
}

function closeRequestModal() {
  document.getElementById("request-modal").classList.add("hidden");
}

async function submitRequest() {
  const modal = document.getElementById("request-modal");
  let tournamentId = modal.dataset.tournamentId;
  const requireMessage = modal.dataset.requireMessage === "true";
  const message = document.getElementById("modal-message").value.trim();
  const errEl = document.getElementById("modal-error");
  errEl.textContent = "";

  if (requireMessage && !message) {
    errEl.textContent = "Merci de renseigner une description avant de confirmer votre demande.";
    return;
  }

  // Case "Match amical" pas encore créée en base pour cette date : on la
  // crée (ou récupère celle qui existe déjà) via la fonction dédiée.
  if (!tournamentId) {
    const { data: newId, error: rpcError } = await supabaseClient.rpc("ensure_friendly_slot", {
      p_date: modal.dataset.date,
    });
    if (rpcError) {
      errEl.textContent = rpcError.message;
      return;
    }
    tournamentId = newId;
  }

  // Vérification anti-course : un autre joueur a pu envoyer une demande
  // entre l'ouverture de la modale et ce clic. day_tournaments.status
  // (confirmé/annulé entre-temps) et has_pending_request (nouvelle
  // demande d'un autre joueur) sont donc revérifiés juste avant l'envoi.
  const { data: freshTournament, error: freshError } = await supabaseClient
    .from("day_tournaments")
    .select("status, has_pending_request")
    .eq("id", tournamentId)
    .single();

  if (freshError) {
    errEl.textContent = freshError.message;
    return;
  }
  if (freshTournament && freshTournament.status !== "active") {
    errEl.textContent = "Ce tournoi n'est plus disponible, quelqu'un vient de le prendre.";
    await loadMonth();
    return;
  }
  if (freshTournament && freshTournament.has_pending_request) {
    errEl.textContent = "Une demande est déjà en attente de validation sur ce tournoi. Réessayez plus tard si elle est refusée.";
    await loadMonth();
    return;
  }

  const { error } = await supabaseClient.from("requests").insert({
    tournament_id: tournamentId,
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
function openCancelModal(tournament, request) {
  document.getElementById("cancel-modal-text").textContent =
    `Voulez-vous vraiment annuler votre demande pour "${tournament.title || "ce tournoi"}" du ${tournament.date} ?`;
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
