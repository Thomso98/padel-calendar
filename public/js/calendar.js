// Logique du calendrier public (page index.html) : affichage du
// mois, statut de chaque jour (repos / confirmé), tournois disponibles
// (une case par tournoi) et envoi des demandes.

const MOIS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
const JOURS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

let currentUser = null;
let currentProfile = null;
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth(); // 0-11
let daysByDate = {};                // { 'YYYY-MM-DD': dayRow } (repos / confirmé, décidé par l'admin)
let tournamentsByDate = {};         // { 'YYYY-MM-DD': [tournamentRow, ...] }
let myRequestsByTournamentId = {};  // { tournament_id: requestRow } (dernière demande de l'utilisateur pour ce tournoi)

// --- Filtres de recherche (chantier 5) : lieu et créneau. Uniquement
// appliqués à l'affichage des tournois dans la grille du mois, jamais
// aux jours "repos" / "confirmé" (pas de liste de tournois à filtrer
// dans ce cas, voir renderCalendar).
let filterLocation = "";   // "" = tous les lieux, sinon une valeur exacte de day_tournaments.location
let filterTimeSlot = "";   // "" = tous les créneaux, "day" = journée, "evening" = soirée

async function onAuthenticated(user, profile) {
  currentUser = user;
  currentProfile = profile || null;
  await Promise.all([loadMonth(), loadLocationOptions()]);
}

function tournamentMatchesFilters(t) {
  if (filterLocation && (t.location || "") !== filterLocation) return false;
  if (filterTimeSlot === "day" && t.is_evening) return false;
  if (filterTimeSlot === "evening" && !t.is_evening) return false;
  return true;
}

// Alimente le menu déroulant "Lieu" avec les valeurs distinctes déjà
// utilisées dans day_tournaments (tous les tournois, pas seulement ceux
// du mois affiché), pour que le filtre reste utilisable même en
// changeant de mois.
async function loadLocationOptions() {
  const { data, error } = await supabaseClient
    .from("day_tournaments")
    .select("location")
    .not("location", "is", null)
    .neq("location", "");

  if (error) {
    console.error(error);
    return;
  }

  const unique = [...new Set((data || []).map((r) => r.location).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );

  const select = document.getElementById("filter-location");
  if (!select) return;
  const previousValue = select.value;
  select.innerHTML = '<option value="">Tous les lieux</option>';
  unique.forEach((loc) => {
    const opt = document.createElement("option");
    opt.value = loc;
    opt.textContent = loc;
    select.appendChild(opt);
  });
  if (unique.includes(previousValue)) select.value = previousValue;
}

// --- Onglets "Calendrier" / "Mes tournois" ---
function switchAppTab(tab) {
  document.getElementById("tab-calendar").classList.toggle("active", tab === "calendar");
  document.getElementById("tab-my-tournaments").classList.toggle("active", tab === "my-tournaments");
  document.getElementById("tab-account").classList.toggle("active", tab === "account");
  document.getElementById("calendar-view").classList.toggle("hidden", tab !== "calendar");
  document.getElementById("my-tournaments-view").classList.toggle("hidden", tab !== "my-tournaments");
  document.getElementById("account-view").classList.toggle("hidden", tab !== "account");
  if (tab === "my-tournaments") loadMyTournaments();
  if (tab === "account" && typeof loadAccountView === "function") loadAccountView();
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
      // Filtres de recherche (lieu / créneau) : ne s'appliquent qu'à
      // l'affichage des tournois ici, jamais aux jours "repos" /
      // "confirmé" ci-dessus (branches séparées, non concernées).
      const officialList = list.filter((t) => t.type !== "friendly" && tournamentMatchesFilters(t));
      officialList.forEach((t) => appendTournamentCard(cell, t, past));

      // Case "Match amical" : toujours affichée en dernier, tous les
      // jours (hors repos / tournoi confirmé), sauf si elle ne
      // correspond pas aux filtres actifs. Si aucune ligne n'existe
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
      if (tournamentMatchesFilters(friendly)) {
        appendTournamentCard(cell, friendly, past);
      }
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

// --- Onglet "Mes tournois" ---
async function loadMyTournaments() {
  if (!currentUser) return;

  const { data, error } = await supabaseClient
    .from("requests")
    .select("*, tournament:day_tournaments(*)")
    .eq("user_id", currentUser.id)
    .eq("status", "approved");

  if (error) {
    console.error(error);
    return;
  }

  const today = toISODate(new Date());
  const upcoming = [];
  const played = [];

  (data || []).forEach((r) => {
    if (!r.tournament) return; // tournoi supprimé entre-temps
    if (r.tournament.date >= today) upcoming.push(r);
    else played.push(r);
  });

  upcoming.sort((a, b) => a.tournament.date.localeCompare(b.tournament.date));
  played.sort((a, b) => b.tournament.date.localeCompare(a.tournament.date));

  renderMyTournamentsList("my-tournaments-upcoming", upcoming, true);
  renderMyTournamentsList("my-tournaments-played", played, false);
}

function renderMyTournamentsList(containerId, requests, showCancelButton) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  if (requests.length === 0) {
    container.innerHTML = "<p class=\"msg\">Aucun tournoi pour le moment.</p>";
    return;
  }

  requests.forEach((r) => {
    const t = r.tournament;
    const row = document.createElement("div");
    row.className = "card";
    row.style.marginBottom = "10px";

    const title = document.createElement("div");
    title.innerHTML = `<strong>${t.title}</strong>
      <span class="pill">${t.date}${t.location ? " — " + t.location : ""}${t.is_evening ? " (soirée)" : ""}</span>`;
    row.appendChild(title);

    if (showCancelButton) {
      const actions = document.createElement("div");
      actions.className = "row-actions";
      actions.style.marginTop = "10px";

      const btn = document.createElement("button");
      btn.className = "danger";
      btn.textContent = "Annuler ce tournoi";
      btn.addEventListener("click", () => openWithdrawModal(r, t));

      actions.appendChild(btn);
      row.appendChild(actions);
    }

    container.appendChild(row);
  });
}

// --- Modal d'annulation d'un tournoi validé (avec logique de retrait
// tardif). Le calcul de "retard" affiché ici est indicatif pour choisir
// le bon texte d'avertissement ; la fonction SQL withdraw_from_tournament
// revérifie tout côté serveur avant d'appliquer quoi que ce soit.
function openWithdrawModal(request, tournament) {
  const modal = document.getElementById("withdraw-modal");
  const tournamentStart = new Date(tournament.date + "T00:00:00");
  const hoursUntil = (tournamentStart - new Date()) / 3600000;
  const isLate = hoursUntil < 48;
  const currentCount = (currentProfile && currentProfile.late_withdrawals_count) || 0;
  const wouldBeCount = currentCount + 1;

  const commentWrap = document.getElementById("withdraw-modal-comment-wrap");
  document.getElementById("withdraw-modal-comment").value = "";
  document.getElementById("withdraw-modal-error").textContent = "";

  if (!isLate) {
    document.getElementById("withdraw-modal-title").textContent = "Annuler ce tournoi ?";
    document.getElementById("withdraw-modal-text").textContent =
      `Vous avez encore plus de 48h avant le début de "${tournament.title}" (${tournament.date}) : cette annulation n'aura aucune conséquence.`;
    commentWrap.classList.add("hidden");
    document.getElementById("withdraw-modal-confirm").textContent = "Confirmer l'annulation";
  } else if (wouldBeCount < 3) {
    document.getElementById("withdraw-modal-title").textContent = "Attention : retrait tardif";
    document.getElementById("withdraw-modal-text").textContent =
      `Il reste moins de 48h avant le début de "${tournament.title}" (${tournament.date}). Annuler maintenant compte comme un retrait tardif (${wouldBeCount}/3). Vous pouvez indiquer une raison ci-dessous.`;
    commentWrap.classList.remove("hidden");
    document.getElementById("withdraw-modal-confirm").textContent = "Confirmer le retrait tardif";
  } else {
    document.getElementById("withdraw-modal-title").textContent = "Attention : ce retrait bloquera votre compte";
    document.getElementById("withdraw-modal-text").textContent =
      `Il reste moins de 48h avant le début de "${tournament.title}" (${tournament.date}). Ce sera votre 3e retrait tardif : si vous confirmez, votre compte sera bloqué pour une durée indéterminée, jusqu'à ce qu'un administrateur le débloque. Vous pouvez indiquer une raison ci-dessous.`;
    commentWrap.classList.remove("hidden");
    document.getElementById("withdraw-modal-confirm").textContent = "Confirmer et bloquer mon compte";
  }

  modal.dataset.requestId = request.id;
  modal.classList.remove("hidden");
}

function closeWithdrawModal() {
  document.getElementById("withdraw-modal").classList.add("hidden");
}

async function confirmWithdraw() {
  const modal = document.getElementById("withdraw-modal");
  const requestId = modal.dataset.requestId;
  const comment = document.getElementById("withdraw-modal-comment").value.trim() || null;
  const errEl = document.getElementById("withdraw-modal-error");
  errEl.textContent = "";

  const { data, error } = await supabaseClient.rpc("withdraw_from_tournament", {
    p_request_id: requestId,
    p_comment: comment,
  });

  if (error) {
    errEl.textContent = error.message;
    return;
  }

  const result = Array.isArray(data) ? data[0] : data;

  closeWithdrawModal();

  if (result && result.will_block) {
    // 3e retrait tardif : le compte vient d'être bloqué côté serveur.
    // Déconnexion immédiate, comme demandé.
    await supabaseClient.auth.signOut();
    return;
  }

  showGlobalMessage("Tournoi annulé.");
  await loadMyTournaments();
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
  document.getElementById("tab-calendar").addEventListener("click", () => switchAppTab("calendar"));
  document.getElementById("tab-my-tournaments").addEventListener("click", () => switchAppTab("my-tournaments"));
  document.getElementById("tab-account").addEventListener("click", () => switchAppTab("account"));
  document.getElementById("filter-location").addEventListener("change", (e) => {
    filterLocation = e.target.value;
    renderCalendar();
  });
  document.getElementById("filter-time").addEventListener("change", (e) => {
    filterTimeSlot = e.target.value;
    renderCalendar();
  });
  document.getElementById("withdraw-modal-back").addEventListener("click", closeWithdrawModal);
  document.getElementById("withdraw-modal-confirm").addEventListener("click", confirmWithdraw);
});
