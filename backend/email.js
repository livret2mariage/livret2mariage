const https = require("https");

/**
 * Envoie le PDF du livret par email au couple, via l'API Resend
 * (https://resend.com — gratuit jusqu'à 100 emails/jour, sans carte bancaire).
 *
 * Nécessite deux variables d'environnement pour fonctionner :
 *   RESEND_API_KEY   — la clé API de ton compte Resend
 *   RESEND_FROM_EMAIL — l'adresse d'expédition (doit être un domaine vérifié
 *                        sur Resend, ex. "Livret2Mariage <livret@tondomaine.fr>")
 *
 * Si l'une de ces deux variables manque, la fonction ne tente rien et renvoie
 * { envoye: false, raison: "non_configure" } — le reste du service continue
 * de fonctionner normalement (le PDF reste téléchargeable).
 */
async function envoyerLivretParEmail({ destinataire, epoux, epouse, pdfBuffer, nomFichier }) {
  const apiKey = process.env.RESEND_API_KEY;
  const expediteur = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !expediteur) {
    return { envoye: false, raison: "non_configure" };
  }
  if (!destinataire || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinataire)) {
    return { envoye: false, raison: "email_invalide" };
  }

  const sujet = `Votre livret de mariage — ${epoux} & ${epouse}`;
  const corpsHtml = `
    <p>Bonjour ${epoux} et ${epouse},</p>
    <p>Voici votre livret de mariage, prêt à imprimer, généré automatiquement à partir de vos choix.</p>
    <p>Vous le trouverez en pièce jointe de cet email, au format PDF.</p>
    <p>Nous vous souhaitons une très belle célébration !</p>
    <p><em>— Livret2Mariage</em></p>
  `;

  const payload = JSON.stringify({
    from: expediteur,
    to: [destinataire],
    subject: sujet,
    html: corpsHtml,
    attachments: [
      {
        filename: `${nomFichier}.pdf`,
        content: pdfBuffer.toString("base64"),
      },
    ],
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.resend.com",
        path: "/emails",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 15000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ envoye: true });
          } else {
            console.error("Échec de l'envoi Resend :", res.statusCode, data);
            resolve({ envoye: false, raison: "erreur_api", details: data });
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ envoye: false, raison: "delai_depasse" });
    });
    req.on("error", (err) => {
      console.error("Erreur réseau lors de l'envoi de l'email :", err.message);
      resolve({ envoye: false, raison: "erreur_reseau", details: err.message });
    });
    req.write(payload);
    req.end();
  });
}

module.exports = { envoyerLivretParEmail };
