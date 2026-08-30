const https = require("https");

/**
 * Fonction bas niveau, commune à tous les envois d'email du service (livrets
 * ET formulaire de contact) : appelle l'API Resend avec un sujet, un corps
 * HTML et, éventuellement, une pièce jointe.
 *
 * Nécessite deux variables d'environnement pour fonctionner :
 *   RESEND_API_KEY    — la clé API de ton compte Resend
 *   RESEND_FROM_EMAIL — l'adresse d'expédition (doit être un domaine vérifié
 *                        sur Resend, ex. "Livret2Mariage <livret@tondomaine.fr>")
 *
 * Si l'une de ces variables manque, la fonction ne tente rien et renvoie
 * { envoye: false, raison: "non_configure" } — le reste du service continue
 * de fonctionner normalement.
 */
function envoyerEmailResend({ destinataire, sujet, corpsHtml, pieceJointe }) {
  const apiKey = process.env.RESEND_API_KEY;
  const expediteur = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !expediteur) {
    return Promise.resolve({ envoye: false, raison: "non_configure" });
  }
  if (!destinataire || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinataire)) {
    return Promise.resolve({ envoye: false, raison: "email_invalide" });
  }

  const payload = JSON.stringify({
    from: expediteur,
    to: [destinataire],
    subject: sujet,
    html: corpsHtml,
    ...(pieceJointe ? { attachments: [pieceJointe] } : {}),
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

/**
 * Envoie une notification par email au professionnel (toi), via l'API Resend
 * (https://resend.com — gratuit jusqu'à 100 emails/jour, sans carte bancaire).
 * Le livret n'est jamais envoyé automatiquement au client final : c'est toi
 * qui le reçois, le relis, le personnalises si besoin, puis le transmets.
 *
 * Le PDF n'est joint que si `pdfBuffer` est fourni (mode "conception
 * complète" du formulaire) — en mode "devis", aucun choix liturgique n'a
 * encore été fait, il n'y a donc rien à générer ni à joindre : seules les
 * coordonnées et les infos du mariage sont transmises.
 *
 * Nécessite en plus la variable d'environnement OWNER_EMAIL — ton adresse
 * email, où tous les livrets générés atterrissent (fixe, indépendante de ce
 * qui est tapé dans le formulaire).
 */
async function envoyerLivretParEmail({ destinataire, emailClientReference, telephoneClient, notesPersonnalisation, typeLivraison, typeDemande, couleur, couleurAutre, epoux, epouse, dateMariage, heureMariage, lieuMariage, pdfBuffer, nomFichier, formuleLabel, prixTotal, detailPrix }) {
  const libellesDemande = { devis: "Demande de devis", conception: "Conception complète (avec choix liturgiques détaillés)" };
  const sujet = `${typeDemande === "devis" ? "Nouveau devis" : "Nouvelle demande de conception"} — ${epoux} & ${epouse}`;
  const ligneTypeDemande = `<p><strong>Type de demande :</strong> ${libellesDemande[typeDemande] || "Non précisé"}</p>`;
  const ligneDate = dateMariage ? `<p><strong>Date du mariage :</strong> ${dateMariage}</p>` : "";
  const ligneHeure = heureMariage ? `<p><strong>Heure :</strong> ${heureMariage}</p>` : "";
  const ligneLieu = lieuMariage ? `<p><strong>Lieu :</strong> ${lieuMariage}</p>` : "";
  const ligneClient = emailClientReference
    ? `<p><strong>Email du client :</strong> ${emailClientReference}</p>`
    : `<p><em>Aucune adresse client renseignée dans le formulaire.</em></p>`;
  const ligneTelephone = telephoneClient
    ? `<p><strong>Téléphone du client :</strong> ${telephoneClient}</p>`
    : "";
  const libellesLivraison = { pdf: "PDF uniquement (impression par le client)", "pdf-impression": "PDF + impression (par vos soins)" };
  const ligneLivraison = typeLivraison
    ? `<p><strong>Type de livraison souhaité :</strong> ${libellesLivraison[typeLivraison] || "Non précisé"}</p>`
    : "";
  const libellesCouleur = { sauge: "Sauge", rose: "Rose poudré", bleu: "Bleu layette", or: "Doré champagne", bordeaux: "Bordeaux", terracotta: "Terracotta", lavande: "Lavande", emeraude: "Émeraude", gris: "Gris perle", noir: "Noir intense" };
  const ligneCouleur = couleur
    ? (couleur === "autre" && couleurAutre
        ? `<p><strong>Teinte souhaitée :</strong> Autre — « ${couleurAutre} »</p>`
        : `<p><strong>Teinte souhaitée :</strong> ${libellesCouleur[couleur] || "Non précisée"}</p>`)
    : "";
  const ligneNotes = notesPersonnalisation && notesPersonnalisation.trim()
    ? `<p><strong>Notes de personnalisation transmises par le client :</strong><br>${notesPersonnalisation.trim().replace(/\n/g, "<br>")}</p>`
    : "";
  const ligneFormule = formuleLabel ? `<p><strong>Formule choisie :</strong> ${formuleLabel}</p>` : "";
  const ligneTotal = typeof prixTotal === "number" ? `<p><strong>Total estimé :</strong> ${prixTotal} €</p>` : "";
  const ligneDetailPrix = detailPrix && detailPrix.length
    ? `<p><strong>Détail :</strong><br>${detailPrix.map((d) => `${d.label} — ${d.prix} €`).join("<br>")}</p>`
    : "";

  // Corps de l'email : trois variantes — devis (formule + prix + PDF de
  // devis joint), conception complète (aperçu du livret joint), et un
  // repli sans pièce jointe si jamais la génération PDF a échoué.
  const corpsHtml = typeDemande === "devis"
    ? `
    <p>Une nouvelle <strong>demande de devis</strong> pour <strong>${epoux} &amp; ${epouse}</strong> vient d'être reçue.</p>
    ${ligneTypeDemande}
    ${ligneFormule}
    ${ligneDate}${ligneHeure}${ligneLieu}
    ${ligneClient}
    ${ligneTelephone}
    ${ligneTotal}
    ${ligneDetailPrix}
    ${ligneNotes}
    <p>${pdfBuffer
      ? "Le devis détaillé est joint en PDF — vérifiez-le puis transmettez-le au couple pour validation. Le lien de paiement est à envoyer séparément une fois le devis validé."
      : "Le PDF du devis n'a malheureusement pas pu être généré automatiquement — vous pouvez recalculer le montant à partir du détail ci-dessus."}</p>
    <p><em>— Livret2Mariage</em></p>
  `
    : pdfBuffer
    ? `
    <p>Une nouvelle demande pour <strong>${epoux} &amp; ${epouse}</strong> vient d'être reçue. Un aperçu (non final) a été généré automatiquement à partir des choix du client.</p>
    ${ligneTypeDemande}
    ${ligneFormule}
    ${ligneDate}${ligneHeure}${ligneLieu}
    ${ligneClient}
    ${ligneTelephone}
    ${ligneLivraison}
    ${ligneCouleur}
    ${ligneTotal}
    ${ligneDetailPrix}
    ${ligneNotes}
    <p>Vous trouverez cet aperçu en pièce jointe (PDF), à personnaliser avant l'envoi final au client. N'oubliez pas de lui envoyer le lien de paiement une fois le montant confirmé.</p>
    <p><em>— Livret2Mariage</em></p>
  `
    : `
    <p>Une nouvelle <strong>demande de tarif</strong> pour <strong>${epoux} &amp; ${epouse}</strong> vient d'être reçue. Le couple n'a pas encore fait de choix liturgique — aucun aperçu n'a donc été généré.</p>
    ${ligneTypeDemande}
    ${ligneDate}${ligneHeure}${ligneLieu}
    ${ligneClient}
    ${ligneTelephone}
    ${ligneNotes}
    <p>Recontactez le couple pour lui proposer un tarif adapté à son mariage.</p>
    <p><em>— Livret2Mariage</em></p>
  `;

  return envoyerEmailResend({
    destinataire: process.env.OWNER_EMAIL,
    sujet,
    corpsHtml,
    pieceJointe: pdfBuffer ? { filename: `${nomFichier}.pdf`, content: pdfBuffer.toString("base64") } : null,
  });
}

/**
 * Envoie une notification par email au professionnel (toi) quand quelqu'un
 * laisse un message via la page "Contact" du site (formulaire simple : nom,
 * email, téléphone facultatif, message). Utilise la même API Resend que les
 * demandes de livret — mêmes variables d'environnement requises.
 */
async function envoyerMessageContact({ nom, email, telephone, message }) {
  const ligneTelephone = telephone ? `<p><strong>Téléphone :</strong> ${telephone}</p>` : "";
  const corpsHtml = `
    <p>Nouveau message reçu via la page Contact du site.</p>
    <p><strong>Nom :</strong> ${nom || "Non précisé"}</p>
    <p><strong>Email :</strong> ${email}</p>
    ${ligneTelephone}
    <p><strong>Message :</strong><br>${(message || "").replace(/\n/g, "<br>")}</p>
    <p><em>— Livret2Mariage</em></p>
  `;

  return envoyerEmailResend({
    destinataire: process.env.OWNER_EMAIL,
    sujet: `Nouveau message de contact — ${nom || email}`,
    corpsHtml,
  });
}

module.exports = { envoyerLivretParEmail, envoyerMessageContact };
