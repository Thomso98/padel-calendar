// Appelé directement par le tableau de bord admin (admin.js, fonction
// resolveRequest) juste après avoir validé la demande d'un joueur pour
// un tournoi. Envoie au joueur concerné un email de confirmation avec
// les détails du tournoi (chantier 1.1 "Confirmation de tournoi validé").
//
// Comme notify-unblock.js : appelé directement depuis le navigateur de
// l'admin (pas un Database Webhook), donc pas de vérification de secret
// de webhook. Reste "best effort" : un échec d'envoi ne doit jamais
// bloquer la validation de la demande elle-même, déjà effectuée côté
// client avant cet appel.

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
    const { email, full_name, tournament } = req.body || {};

    if (!email || !tournament || !tournament.title || !tournament.date) {
      res.status(400).json({ error: "email ou tournament manquant" });
      return;
    }

    const creneau = tournament.is_evening ? "Soirée" : "Journée";

    const html = `
      <p>Bonjour ${escapeHtml(full_name || "")},</p>
      <p>Votre demande a été validée pour le tournoi suivant :</p>
      <ul>
        <li><strong>${escapeHtml(tournament.title)}</strong></li>
        <li>Date : ${escapeHtml(tournament.date)}</li>
        ${tournament.location ? `<li>Lieu : ${escapeHtml(tournament.location)}</li>` : ""}
        <li>Créneau : ${creneau}</li>
      </ul>
      ${tournament.description ? `<p>${escapeHtml(tournament.description)}</p>` : ""}
      <p>Merci d'effectuer l'inscription au tournoi.</p>
    `;

    await sendEmail({ to: email, subject: `Tournoi validé : ${tournament.title}`, html });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
