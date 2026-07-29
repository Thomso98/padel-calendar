// Appelé par un Database Webhook Supabase quand une nouvelle
// ligne est insérée dans "requests" (nouvelle demande d'un joueur).
// Envoie un email à l'administrateur (vous).

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
    if (!record) {
      res.status(400).send("Payload invalide");
      return;
    }

    const [tournament, profile] = await Promise.all([
      fetchFromSupabase(`day_tournaments?id=eq.${record.tournament_id}&select=*`),
      fetchFromSupabase(`profiles?id=eq.${record.user_id}&select=*`),
    ]);

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      res.status(200).json({ skipped: "ADMIN_EMAIL non configuré" });
      return;
    }

    const html = `
      <p><strong>${profile ? (profile.full_name || profile.email) : "Un utilisateur"}</strong>
      souhaite jouer le tournoi <strong>${tournament ? tournament.title : ""}</strong>
      ${tournament ? `(${tournament.date}${tournament.location ? " — " + tournament.location : ""}${tournament.is_evening ? " — soirée" : ""})` : ""}.</p>
      ${record.message ? `<p>Message : « ${record.message} »</p>` : ""}
      <p>Connectez-vous au tableau de bord admin pour valider ou refuser cette demande.</p>
    `;

    await sendEmail({
      to: adminEmail,
      subject: "Nouvelle demande de tournoi",
      html,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
