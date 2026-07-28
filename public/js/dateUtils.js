// Fonctions utilitaires de date, séparées pour rester testables
// sans navigateur (utilisées aussi bien par calendar.js que par
// des tests).

function toISODate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfMonth(year, monthIndex) {
  return new Date(year, monthIndex, 1);
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

// Lundi = 0 ... Dimanche = 6 (calendrier "à la française")
function mondayFirstIndex(jsDay) {
  return (jsDay + 6) % 7;
}

// Construit la grille du mois : tableau de { date: 'YYYY-MM-DD'|null }
// avec des cases vides en début de grille pour aligner sur lundi.
function buildMonthGrid(year, monthIndex) {
  const first = startOfMonth(year, monthIndex);
  const leading = mondayFirstIndex(first.getDay());
  const total = daysInMonth(year, monthIndex);

  const cells = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= total; d++) {
    cells.push(toISODate(new Date(year, monthIndex, d)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function isPastDate(isoDate) {
  const today = toISODate(new Date());
  return isoDate < today;
}

if (typeof module !== "undefined") {
  module.exports = { toISODate, startOfMonth, daysInMonth, mondayFirstIndex, buildMonthGrid, isPastDate };
}
