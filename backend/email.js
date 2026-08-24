const https = require("https");

/**
 * Envoie le PDF du livret par email au professionnel (toi), via l'API Resend
 * (https://resend.com — gratuit jusqu'à 100 emails/jour, sans carte bancaire).
 * Le livret n'est jamais envoyé automatiquement au client final : c'est toi
 * qui le reçois, le relis, le personnalises si besoin, puis le transmets.
 *
 * Nécessite trois variables d'environnement pour fonctionner :
 *   RESEND_API_KEY   — la clé API de ton compte Resend
 *   RESEND_FROM_EMAIL — l'adresse d'expédition (doit être un domaine vérifié
 *                        sur Resend, ex. "Livret2Mariage <livret@tondomaine.fr>")
 *   OWNER_EMAIL       — ton adresse email, où tous les livrets générés
 *                        atterrissent (fixe, indépendante de ce qui est tapé
 *                        dans le formulaire)
 *
 * Si l'une de ces variables manque, la fonction ne tente rien et renvoie
 * { envoye: false, raison: "non_configure" } — le reste du service continue
 * de fonctionner normalement (le PDF reste téléchargeable).
 */
async function envoyerLivretParEmail({ destinataire, emailClientReference, notesPersonnalisation, epoux, epouse, pdfBuffer, nomFichier }) {
  const apiKey = process.env.RESEND_API_KEY;
  const expediteur = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !expediteur) {
    return { envoye: false, raison: "non_configure" };
  }
  if (!destinataire || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinataire)) {
    return { envoye: false, raison: "email_invalide" };
  }

  const sujet = `Livret généré — ${epoux} & ${epouse}`;
  const ligneClient = emailClientReference
    ? `<p><strong>Email du client (indiqué dans le formulaire) :</strong> ${emailClientReference}</p>`
    : `<p><em>Aucune adresse client renseignée dans le formulaire.</em></p>`;
  const ligneNotes = notesPersonnalisation && notesPersonnalisation.trim()
    ? `<p><strong>Notes de personnalisation transmises par le client :</strong><br>${notesPersonnalisation.trim().replace(/\n/g, "<br>")}</p>`
    : "";
  const corpsHtml = `
    <p>Le livret pour <strong>${epoux} &amp; ${epouse}</strong> vient d'être généré.</p>
    ${ligneClient}
    ${ligneNotes}
    <p>Vous le trouverez en pièce jointe, au format PDF, prêt à être relu et transmis au couple.</p>
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
