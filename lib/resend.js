// Petit utilitaire pour envoyer un email via l'API Resend
// (https://resend.com), sans dépendance externe (fetch natif Node 18+).

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "Calendrier Padel <onboarding@resend.dev>";

  if (!apiKey) {
    // Pas de clé configurée : on n'envoie rien, mais on ne fait pas
    // échouer l'appelant (les notifications email sont optionnelles).
    console.warn("RESEND_API_KEY non configurée, email non envoyé:", subject);
    return { skipped: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend error ${res.status}: ${text}`);
  }

  return res.json();
}

async function fetchFromSupabase(path) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  const rows = await res.json();
  return rows[0] || null;
}

function checkWebhookSecret(req) {
  const expected = process.env.WEBHOOK_SECRET;
  if (!expected) return true; // pas de secret configuré : on laisse passer (à éviter en prod)
  return req.headers["x-webhook-secret"] === expected;
}

module.exports = { sendEmail, fetchFromSupabase, checkWebhookSecret };
