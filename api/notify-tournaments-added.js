// Envoie un seul email récapitulatif à tous les comptes approuvés
// (profiles.approved = true) quand un ou plusieurs NOUVEAUX tournois
// viennent d'être ajoutés à day_tournaments (chantier 1.3 "Calendrier
// mis à jour"). Appelable depuis deux endroits :
//   - le tableau de bord admin (admin.js, handleTournamentFormSubmit),
//     pour un ajout manuel ;
//   - la tâche planifiée de scan Ten'Up (tous les 4 jours), à la fin
//     du scan, si au moins un tournoi a été inséré.
//
// Contrairement à notify-tournament-approved.js / notify-tournament-
// cancelled.js (où l'appelant a déjà les destinataires sous la main via
// une session admin authentifiée), la tâche planifiée n'a pas de
// session utilisateur : cet endpoint interroge donc lui-même Supabase
// avec la clé service_role pour obtenir la liste des comptes à
// prévenir, ce qui le rend appelable depuis n'importe quel contexte.
//
// Un email par destinataire (pas de "to" groupé ni de "cc") pour ne
// jamais exposer l'adresse d'un joueur aux autres.

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
    const { tournaments } = req.body || {};

    if (!Array.isArray(tournaments) || tournaments.length === 0) {
      res.status(400).json({ error: "tournaments manquant ou vide" });
      return;
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const profilesRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?approved=eq.true&select=email,full_name`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );

    if (!profilesRes.ok) {
      const text = await profilesRes.text();
      throw new Error(`Supabase error ${profilesRes.status}: ${text}`);
    }

    const profiles = await profilesRes.json();
    const recipients = (profiles || []).filter((p) => p.email);

    if (recipients.length === 0) {
      res.status(200).json({ ok: true, sent: 0 });
      return;
    }

    const itemsHtml = tournaments
      .map((t) => {
        const creneau = t.is_evening ? "soirée" : "journée";
        return `<li><strong>${escapeHtml(t.title || "Tournoi")}</strong> — ${escapeHtml(t.date || "")}${
          t.location ? " — " + escapeHtml(t.location) : ""
        } (${creneau})</li>`;
      })
      .join("");

    const html = `
      <p>Bonjour,</p>
      <p>De nouveaux tournois viennent d'être ajoutés au calendrier :</p>
      <ul>${itemsHtml}</ul>
      <p>Connectez-vous au calendrier pour faire votre demande.</p>
    `;

    let sent = 0;
    for (const p of recipients) {
      try {
        await sendEmail({
          to: p.email,
          subject: "Calendrier mis à jour : nouveaux tournois disponibles",
          html,
        });
        sent += 1;
      } catch (e) {
        console.error(`Échec envoi email calendrier mis à jour à ${p.email}:`, e);
      }
    }

    res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
