// Appelé directement par le tableau de bord admin (admin.js, fonction
// confirmAdminCancelTournament) juste avant de supprimer les demandes
// liées au tournoi annulé (l'implémentation actuelle efface ces lignes
// pour que le tournoi retrouve sa forme initiale, voir migration_v7+ /
// admin.js). Envoie un email à chaque joueur dont la demande était
// approuvée pour ce tournoi (chantier 1.2 "Annulation de tournoi").
//
// Appelé directement depuis le navigateur de l'admin (pas un Database
// Webhook) : pas de vérification de secret de webhook. Reste
// "best effort" : un échec d'envoi ne doit jamais bloquer l'annulation
// elle-même, déjà effectuée côté client avant cet appel.

const { sendEmail } = require("../lib/resend");

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  try {
    const { recipients, tournament } = req.body || {};

    if (!Array.isArray(recipients) || recipients.length === 0 || !tournament || !tournament.title) {
      res.status(400).json({ error: "recipients ou tournament manquant" });
      return;
    }

    const html = `
      <p>Bonjour,</p>
      <p>Le tournoi <strong>${escapeHtml(tournament.title)}</strong> du ${escapeHtml(tournament.date || "")}${
      tournament.location ? " — " + escapeHtml(tournament.location) : ""
    } a été annulé par l'organisateur.</p>
      <p>Nous sommes désolés pour la gêne occasionnée.</p>
    `;

    let sent = 0;
    for (const r of recipients) {
      if (!r || !r.email) continue;
      try {
        await sendEmail({ to: r.email, subject: `Tournoi annulé : ${tournament.title}`, html });
        sent += 1;
      } catch (e) {
        console.error(`Échec envoi email annulation à ${r.email}:`, e);
      }
    }

    res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
