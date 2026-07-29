// Appelé par un Database Webhook Supabase quand une ligne de
// "requests" est mise à jour (validation / refus par l'admin, ou
// refus automatique suite à un conflit d'horaire avec un autre
// tournoi validé le même jour).
// Envoie un email au joueur qui avait fait la demande.

const { sendEmail, fetchFromSupabase, checkWebhookSecret } = require("../lib/resend");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  if (!checkWebhookSecret(req)) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const payload = req.body || {};
    const record = payload.record;
    const oldRecord = payload.old_record;

    if (!record || !oldRecord || record.status === oldRecord.status) {
      // Rien à notifier (pas un changement de statut)
      res.status(200).json({ skipped: true });
      return;
    }

    if (record.status !== "approved" && record.status !== "rejected") {
      res.status(200).json({ skipped: true });
      return;
    }

    const [tournament, profile] = await Promise.all([
      fetchFromSupabase(`day_tournaments?id=eq.${record.tournament_id}&select=*`),
      fetchFromSupabase(`profiles?id=eq.${record.user_id}&select=*`),
    ]);

    if (!profile || !profile.email) {
      res.status(200).json({ skipped: "Profil ou email introuvable" });
      return;
    }

    const approved = record.status === "approved";
    const subject = approved ? "Votre demande a été validée" : "Votre demande a été refusée";
    const html = `
      <p>Bonjour ${profile.full_name || ""},</p>
      <p>Votre demande pour le tournoi <strong>${tournament ? tournament.title : ""}</strong>
      ${tournament ? `(${tournament.date}${tournament.location ? " — " + tournament.location : ""})` : ""} a été
      <strong>${approved ? "validée ✅" : "refusée"}</strong>.</p>
    `;

    await sendEmail({ to: profile.email, subject, html });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
