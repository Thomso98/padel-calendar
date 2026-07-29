// Appelé directement par le tableau de bord admin (admin.js,
// fonction unblockAccount) juste après avoir débloqué un compte.
// Envoie un email au joueur pour l'informer qu'il peut de nouveau se
// connecter et accéder au calendrier.
//
// Contrairement à notify-admin.js / notify-user.js (déclenchés par un
// Database Webhook Supabase), cet endpoint est appelé directement
// depuis le navigateur de l'admin : il ne nécessite donc pas de
// vérification de secret de webhook, mais reste "best effort" (un
// échec d'envoi n'empêche jamais le déblocage lui-même, déjà effectué
// côté client avant cet appel).

const { sendEmail } = require("../lib/resend");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  try {
    const { email, full_name } = req.body || {};

    if (!email) {
      res.status(400).json({ error: "email manquant" });
      return;
    }

    const html = `
      <p>Bonjour ${full_name || ""},</p>
      <p>Votre compte a été débloqué : vous pouvez de nouveau vous connecter
      et accéder au calendrier des tournois.</p>
    `;

    await sendEmail({ to: email, subject: "Votre compte a été débloqué", html });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
