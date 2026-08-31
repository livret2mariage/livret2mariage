const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { chromium } = require("playwright");
const { assembleLivret, formatChoisi } = require("../moteur/assembler");
const { completerPourImpressionLivret } = require("../moteur/pagination");
const { envoyerLivretParEmail, envoyerMessageContact } = require("./email");
const { creerSessionPaiement, verifierSignatureWebhook } = require("./paiement");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "../data");
const TEMPLATE_DIR = path.join(__dirname, "../template");
const FORMULAIRE_DIR = path.join(__dirname, "../formulaire");

const base = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "textes.json"), "utf8"));

// ------------------------------------------------------------------
// Petits utilitaires HTTP (à la place d'Express, pour n'avoir aucune
// dépendance npm à installer — seul Playwright est requis)
// ------------------------------------------------------------------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    const LIMIT = 2 * 1024 * 1024; // 2 Mo
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > LIMIT) {
        reject(new Error("Corps de requête trop volumineux."));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error("JSON invalide."));
      }
    });
    req.on("error", reject);
  });
}

/** Lit le corps BRUT d'une requête (sans le parser en JSON) — nécessaire pour
 * vérifier la signature des webhooks Stripe, qui porte sur les octets exacts
 * envoyés, avant toute transformation. */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Réponses du formulaire en attente de paiement, le temps que Stripe confirme
// la transaction (webhook). Stockage en mémoire simple : suffisant pour le
// délai de quelques secondes entre "créer la session" et "paiement confirmé".
// Purge automatique des entrées de plus de 24h à chaque nouvel ajout.
const reponsesEnAttente = new Map();
function purgerReponsesExpirees() {
  const limite = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, { creeLe }] of reponsesEnAttente) {
    if (creeLe < limite) reponsesEnAttente.delete(id);
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
};

/** Page HTML minimale de confirmation après paiement (succès ou annulation),
 * dans un style cohérent avec le formulaire. */
function servePageConfirmation(res, { titre, message }) {
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${titre} — Livret2Mariage</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;1,400&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
  body{font-family:'Inter',sans-serif;background:#FBF8F2;color:#2E3328;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center;}
  .carte{max-width:440px;}
  h1{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:500;font-size:32px;margin-bottom:14px;}
  p{font-size:15px;line-height:1.6;color:#5B6455;}
  a{display:inline-block;margin-top:22px;color:#52604A;font-weight:600;text-decoration:none;border-bottom:1px solid #52604A;}
</style>
</head>
<body>
  <div class="carte">
    <h1>${titre}</h1>
    <p>${message}</p>
    <a href="/">Retour à l'accueil</a>
  </div>
</body>
</html>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/** Sert un fichier HTML statique du dossier formulaire/ par un chemin propre
 * (ex. /contact au lieu de /contact.html). */
function serveFichierFormulaire(res, nomFichier) {
  fs.readFile(path.join(FORMULAIRE_DIR, nomFichier), (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end("Introuvable");
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(content);
  });
}

function serveStatic(req, res) {
  let reqPath = req.url.split("?")[0];
  if (reqPath === "/") reqPath = "/index.html";
  const filePath = path.join(FORMULAIRE_DIR, reqPath);

  // Empêche de sortir du dossier formulaire/ (sécurité basique)
  if (!filePath.startsWith(FORMULAIRE_DIR)) {
    res.writeHead(403);
    return res.end("Interdit");
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Introuvable");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  });
}

// ------------------------------------------------------------------
// Validation minimale des réponses reçues du formulaire
// ------------------------------------------------------------------
function validateReponse(r) {
  const erreurs = [];
  if (!r || typeof r !== "object") return ["Corps de requête invalide."];

  ["epoux", "epouse", "date", "heure", "lieu", "email", "telephone"].forEach((champ) => {
    if (!r[champ] || typeof r[champ] !== "string" || !r[champ].trim()) {
      erreurs.push(`Le champ "${champ}" est requis.`);
    }
  });
  if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) {
    erreurs.push('Le champ "email" doit être une adresse valide.');
  }

  // Les choix liturgiques sont désormais facultatifs : tout champ non renseigné
  // retombe automatiquement sur le texte marqué "recommandé" dans data/textes.json.
  if (r.choix !== undefined && typeof r.choix !== "object") {
    erreurs.push('Le champ "choix", s\'il est fourni, doit être un objet.');
  }
  if (r.chants !== undefined && typeof r.chants !== "object") {
    erreurs.push('Le champ "chants", s\'il est fourni, doit être un objet.');
  }

  return erreurs;
}

// ------------------------------------------------------------------
// POST /api/contact — message simple envoyé depuis la page "Contact"
// (nom, email, téléphone facultatif, message) — transmis par email au
// professionnel via la même API Resend que les demandes de livret.
// ------------------------------------------------------------------
function validateContact(r) {
  const erreurs = [];
  if (!r || typeof r !== "object") return ["Corps de requête invalide."];

  if (!r.email || typeof r.email !== "string" || !r.email.trim()) {
    erreurs.push('Le champ "email" est requis.');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) {
    erreurs.push('Le champ "email" doit être une adresse valide.');
  }
  if (!r.message || typeof r.message !== "string" || !r.message.trim()) {
    erreurs.push('Le champ "message" est requis.');
  }

  return erreurs;
}

async function handleContact(req, res) {
  let reponse;
  try {
    reponse = await readJsonBody(req);
  } catch (e) {
    return sendJson(res, 400, { erreur: e.message });
  }

  const erreurs = validateContact(reponse);
  if (erreurs.length > 0) {
    return sendJson(res, 400, { erreur: "Message incomplet", details: erreurs });
  }

  try {
    const resultat = await envoyerMessageContact({
      nom: reponse.nom,
      email: reponse.email,
      telephone: reponse.telephone,
      message: reponse.message,
    });
    sendJson(res, 200, { succes: true, emailEnvoye: resultat.envoye, emailRaison: resultat.raison || null });
  } catch (err) {
    console.error("Erreur d'envoi du message de contact :", err);
    sendJson(res, 500, { erreur: "Échec de l'envoi du message", details: err.message });
  }
}

// ------------------------------------------------------------------
// GET /api/textes/choix — listes déroulantes générées depuis textes.json
// ------------------------------------------------------------------
function handleChoix(req, res) {
  const short = (s, n = 90) => (s && s.length > n ? s.slice(0, n).trim() + "…" : s);
  const withRec = (arr, mapFn) => arr.map((x) => ({ ...mapFn(x), recommande: !!x.recommande }));
  // Seules les catégories que le couple choisit réellement sont exposées ici.
  // Salutation, mot d'accueil, prière d'ouverture, invitation et réception des
  // consentements restent fixes (le moteur utilise directement le texte recommandé).
  const out = {
    lectures: withRec(base.lectures, (x) => ({ id: x.id, label: x.titreCourt, ref: x.reference, apercu: short(x.texte[0]), resume: x.resume, texteComplet: x.texte })),
    psaumes: withRec(base.psaumes, (x) => ({ id: x.id, label: x.titre, ref: x.reference, apercu: short(x.refrains[0]), resume: x.resume, texteComplet: [...x.refrains, ...x.texte] })),
    evangiles: withRec(base.evangiles, (x) => ({ id: x.id, label: x.titreCourt, ref: x.reference, apercu: short(x.texte[0]), resume: x.resume, texteComplet: x.texte })),
    dialoguesInitiaux: withRec(base.dialoguesInitiaux, (x) => ({ id: x.id, label: x.titre, apercu: short(x.texte[0]), analyseUsage: x.analyseUsage, texteComplet: x.texte })),
    consentements: withRec(base.consentements, (x) => ({ id: x.id, label: x.titre, apercu: short(x.texte[0]), analyseUsage: x.analyseUsage, texteComplet: x.texte })),
    benedictionsAlliances: withRec(base.benedictionsAlliances, (x) => ({ id: x.id, label: x.titre, apercu: short(x.texte[0]), analyseUsage: x.analyseUsage, texteComplet: x.texte })),
    benedictionsNuptiales: withRec(base.benedictionsNuptiales, (x) => ({ id: x.id, label: x.titre, apercu: short(x.texte[0]), analyseUsage: x.analyseUsage, texteComplet: x.texte })),
    prieresEpoux: withRec(base.prieresEpoux, (x) => ({ id: x.id, label: x.titre, apercu: short(x.texte[0]), analyseUsage: x.analyseUsage, texteComplet: x.texte })),
    prieresUniverselles: withRec(base.prieresUniverselles, (x) => ({ id: x.id, label: x.titre, apercu: short(x.texte[0]), analyseUsage: x.analyseUsage, texteComplet: x.texte })),
    benedictionsFinales: withRec(base.benedictionsFinales, (x) => ({ id: x.id, label: x.titre, apercu: short(x.texte[0]), analyseUsage: x.analyseUsage, texteComplet: x.texte })),
  };
  sendJson(res, 200, out);
}

// ------------------------------------------------------------------
// Tarification du devis (mode "devis" uniquement) — mêmes montants que la
// page /tarif et que l'étape "Formule" du formulaire. Recalculé ici à
// partir des seuls identifiants reçus (jamais du total envoyé par le
// navigateur), pour ne jamais faire confiance à un prix côté client.
// ------------------------------------------------------------------
const FORMULES_PRIX = {
  essentielle: { label: "Essentielle", prix: 39, supplementA4: 0 },
  confort: { label: "Confort", prix: 79, supplementA4: 5 },
  prestige: { label: "Prestige", prix: 169, supplementA4: 10 },
};

const OPTIONS_PRIX = {
  marquePage: {
    label: "Marque-page thématique",
    tiers: { aucun: null, unite: { label: "à l'unité", prix: 1.5 }, lot10: { label: "lot de 10", prix: 12 }, lot20: { label: "lot de 20", prix: 20 } },
  },
  feuilleChant: {
    label: "Feuille de chant A4 recto-verso",
    tiers: { aucun: null, lot20: { label: "lot de 20", prix: 12 }, lot50: { label: "lot de 50", prix: 25 }, lot100: { label: "lot de 100", prix: 40 } },
  },
  ruban: {
    label: "Ruban décoratif collé",
    tiers: { aucun: null, unite: { label: "à l'unité", prix: 1 }, lot10: { label: "lot de 10", prix: 8 }, lot20: { label: "lot de 20", prix: 14 } },
  },
  // Prix dépendant de la formule (Confort / Prestige) — non proposé pour Essentielle.
  livretsSupplementaires: {
    label: "Livrets supplémentaires",
    tiersParFormule: {
      confort: { aucun: null, plus5: { label: "+5 livrets", prix: 15 }, plus10: { label: "+10 livrets", prix: 25 }, plus20: { label: "+20 livrets", prix: 45 } },
      prestige: { aucun: null, plus5: { label: "+5 livrets", prix: 22 }, plus10: { label: "+10 livrets", prix: 40 }, plus20: { label: "+20 livrets", prix: 70 } },
    },
  },
  // Livraison des livrets imprimés — concerne Confort et Prestige (pas
  // Essentielle, sans impression physique). "Récupération sur place" est
  // gratuite dans les deux cas ; Colissimo est un supplément pour Confort,
  // déjà inclus (0 €) pour Prestige.
  colissimo: {
    label: "Livraison des livrets",
    tiersParFormule: {
      confort: { surplace: { label: "récupération sur place", prix: 0 }, colissimo: { label: "Colissimo suivi", prix: 9 } },
      prestige: { surplace: { label: "récupération sur place", prix: 0 }, colissimo: { label: "Colissimo suivi — déjà inclus", prix: 0 } },
    },
  },
};

function calculerPrixDevis(reponse) {
  const formuleId = FORMULES_PRIX[reponse.formule] ? reponse.formule : "essentielle";
  const formuleInfo = FORMULES_PRIX[formuleId];
  const detail = [{ label: formuleInfo.label, prix: formuleInfo.prix }];
  let total = formuleInfo.prix;

  if (reponse.format === "A4" && formuleInfo.supplementA4 > 0) {
    total += formuleInfo.supplementA4;
    detail.push({ label: "Format A4", prix: formuleInfo.supplementA4 });
  }

  const opts = reponse.optionsDevis || {};

  // Les options d'impression n'ont pas de sens pour Essentielle (100%
  // numérique) — ignorées ici même si le client en envoie une malgré tout.
  if (formuleId !== "essentielle") {
    ["marquePage", "feuilleChant", "ruban"].forEach((cle) => {
      const tier = OPTIONS_PRIX[cle].tiers[opts[cle]];
      if (tier) {
        total += tier.prix;
        detail.push({ label: `${OPTIONS_PRIX[cle].label} (${tier.label})`, prix: tier.prix });
      }
    });
  }

  if (formuleId !== "essentielle") {
    const table = OPTIONS_PRIX.livretsSupplementaires.tiersParFormule[formuleId];
    const tier = table?.[opts.livretsSupplementaires];
    if (tier) {
      total += tier.prix;
      detail.push({ label: `${OPTIONS_PRIX.livretsSupplementaires.label} (${tier.label})`, prix: tier.prix });
    }
  }

  // Livraison des livrets : toujours indiquée dans le détail (même à 0 €)
  // pour que le choix du couple (récupération ou envoi) soit visible sur le
  // devis, pas seulement son impact sur le prix.
  if (formuleId !== "essentielle") {
    const tableLivraison = OPTIONS_PRIX.colissimo.tiersParFormule[formuleId];
    const tierLivraison = tableLivraison?.[opts.colissimo] || tableLivraison?.surplace;
    if (tierLivraison) {
      total += tierLivraison.prix;
      detail.push({ label: `${OPTIONS_PRIX.colissimo.label} — ${tierLivraison.label}`, prix: tierLivraison.prix });
    }
  }

  return { total, detail, formuleLabel: formuleInfo.label };
}

/** Document PDF simple (une page) présentant le devis — distinct du livret
 * de cérémonie complet, qui n'a pas lieu d'être avant validation. Rendu via
 * le même Playwright déjà utilisé pour le livret, mais avec un template
 * autonome (pas de dépendance à assembler.js/style.css). */
function genererDevisHTML(reponse, { total, detail, formuleLabel }) {
  const dateGeneration = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const lignesDetail = detail
    .map((d) => `<tr><td>${d.label}</td><td>${d.prix} €</td></tr>`)
    .join("");
  const ligneNotes = reponse.notesPersonnalisation && reponse.notesPersonnalisation.trim()
    ? `<div class="bloc"><h2>Notes du couple</h2><p class="notes">${reponse.notesPersonnalisation.trim().replace(/\n/g, "<br>")}</p></div>`
    : "";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,400&family=Inter:wght@400;500;600;700&display=swap');
  *{box-sizing:border-box;}
  body{font-family:'Inter',sans-serif; color:#2E3328; margin:0; padding:52px 58px;}
  .entete{display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #C9A227; padding-bottom:18px; margin-bottom:30px;}
  .marque{font-family:'Cormorant Garamond',serif; font-style:italic; font-weight:600; font-size:26px; color:#52604A;}
  .sous-marque{font-size:11.5px; color:#5B6455; margin-top:4px;}
  .devis-titre{text-align:right;}
  .devis-titre h1{font-family:'Cormorant Garamond',serif; font-size:30px; font-style:italic; margin:0; color:#2E3328;}
  .devis-titre p{font-size:12px; color:#5B6455; margin:4px 0 0;}
  .bloc{margin-bottom:26px;}
  .bloc h2{font-family:'Cormorant Garamond',serif; font-size:16px; font-style:italic; color:#52604A; border-bottom:1px solid #E4DED0; padding-bottom:6px; margin:0 0 10px;}
  .ligne{display:flex; justify-content:space-between; font-size:13.5px; padding:3px 0;}
  .ligne span:first-child{color:#5B6455;}
  table.detail{width:100%; border-collapse:collapse; margin-top:4px;}
  table.detail td{padding:9px 0; border-bottom:1px solid #E4DED0; font-size:13.5px;}
  table.detail td:last-child{text-align:right; font-weight:600; color:#C9A227; white-space:nowrap;}
  .total-row td{font-family:'Cormorant Garamond',serif; font-size:21px; font-weight:600; color:#2E3328; border-bottom:none; padding-top:16px;}
  .total-row td:last-child{color:#C9A227;}
  .notes{font-size:13px; line-height:1.6;}
  .pied{margin-top:44px; font-size:11px; color:#5B6455; text-align:center;}
</style>
</head>
<body>
  <div class="entete">
    <div>
      <div class="marque">Livret2Mariage</div>
      <div class="sous-marque">Devis généré le ${dateGeneration}</div>
    </div>
    <div class="devis-titre">
      <h1>Devis</h1>
      <p>${reponse.epoux || ""} &amp; ${reponse.epouse || ""}</p>
    </div>
  </div>

  <div class="bloc">
    <h2>Informations du mariage</h2>
    <div class="ligne"><span>Date</span><span>${reponse.date || "—"}</span></div>
    <div class="ligne"><span>Heure</span><span>${reponse.heure || "—"}</span></div>
    <div class="ligne"><span>Lieu</span><span>${reponse.lieu || "—"}</span></div>
    <div class="ligne"><span>Email</span><span>${reponse.email || "—"}</span></div>
    <div class="ligne"><span>Téléphone</span><span>${reponse.telephone || "—"}</span></div>
  </div>

  <div class="bloc">
    <h2>Détail du devis — formule ${formuleLabel}</h2>
    <table class="detail">
      ${lignesDetail}
      <tr class="total-row"><td>Total estimé</td><td>${total} €</td></tr>
    </table>
  </div>

  ${ligneNotes}

  <div class="pied">Ce devis est indicatif et sera confirmé directement avec le couple avant tout paiement.</div>
</body>
</html>`;
}

// ------------------------------------------------------------------
// POST /api/livrets — assemble le livret et renvoie le PDF généré
// ------------------------------------------------------------------
/**
 * Génère le PDF (livret complet ou devis, selon le mode) et l'envoie par
 * email. Fonction centrale, appelée uniquement après confirmation réelle du
 * paiement (webhook Stripe) — c'est la seule façon dont un livret est
 * produit et envoyé dans le service. Retourne le buffer du PDF (utile pour
 * du débogage local) et le résultat de l'envoi d'email.
 *
 * Mode "devis" : un PDF de devis (une page, prix détaillé) est généré à
 * partir de la formule et des options choisies, puis joint à l'email —
 * distinct du livret de cérémonie complet, qui n'a pas lieu d'être avant
 * validation du devis par le couple.
 */
async function genererEtEnvoyerLivret(reponse) {
  if (reponse.typeDemande === "devis") {
    const { total, detail, formuleLabel } = calculerPrixDevis(reponse);

    let browser;
    let pdfBuffer = null;
    try {
      const html = genererDevisHTML(reponse, { total, detail, formuleLabel });
      browser = await chromium.launch();
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle" });
      await Promise.race([
        page.evaluate(() => document.fonts.ready),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      pdfBuffer = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
    } catch (err) {
      // On ne bloque jamais l'envoi de la demande pour un souci de génération
      // PDF : au pire, l'email part sans pièce jointe (email.js gère les deux
      // cas), et tu peux recalculer le devis à la main à partir des infos
      // transmises dans le corps du message.
      console.error("Erreur lors de la génération du PDF de devis :", err.message);
      pdfBuffer = null;
    } finally {
      if (browser) await browser.close();
    }

    const nomFichier = `devis_${reponse.epoux}_${reponse.epouse}`
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_]/g, "");

    const resultatEmail = await envoyerLivretParEmail({
      destinataire: process.env.OWNER_EMAIL,
      emailClientReference: reponse.email,
      telephoneClient: reponse.telephone,
      notesPersonnalisation: reponse.notesPersonnalisation,
      typeDemande: reponse.typeDemande,
      epoux: reponse.epoux,
      epouse: reponse.epouse,
      dateMariage: reponse.date,
      heureMariage: reponse.heure,
      lieuMariage: reponse.lieu,
      formuleLabel,
      prixTotal: total,
      detailPrix: detail,
      pdfBuffer,
      nomFichier,
    });
    return { pdfBuffer, nomFichier, resultatEmail };
  }

  let browser;
  let tmpDir;
  try {
    const html = assembleLivret(reponse, base);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "livret-"));
    fs.copyFileSync(path.join(TEMPLATE_DIR, "style.css"), path.join(tmpDir, "style.css"));
    fs.copyFileSync(path.join(TEMPLATE_DIR, "border.png"), path.join(tmpDir, "border.png"));
    const htmlPath = path.join(tmpDir, "livret.html");
    fs.writeFileSync(htmlPath, html, "utf8");

    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto("file://" + htmlPath);
    // Attend que les polices (Google Fonts) soient bien chargées avant de générer
    // le PDF — sinon Playwright peut imprimer avec une police de secours si le
    // téléchargement des polices n'est pas encore terminé au moment du rendu.
    // Limité à 5s pour ne jamais bloquer indéfiniment en cas de souci réseau.
    await Promise.race([
      page.evaluate(() => document.fonts.ready),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    const pdfBufferBrut = await page.pdf({
      format: formatChoisi(reponse),
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    await browser.close();
    browser = null;
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // Complète avec des pages blanches si besoin, pour que le livret soit
    // prêt à être imprimé "4 pages par feuille" (façonnage classique en livret).
    const { bytes: pdfBuffer } = await completerPourImpressionLivret(pdfBufferBrut, { format: formatChoisi(reponse) });

    const nomFichier = `livret_${reponse.epoux}_${reponse.epouse}`
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_]/g, "");

    // La formule est désormais choisie dès le départ, dans les deux modes —
    // on inclut donc son prix ici aussi, pour que tu saches ce qu'il faut
    // facturer avant d'envoyer le lien de paiement.
    const { total, detail, formuleLabel } = calculerPrixDevis(reponse);

    const resultatEmail = await envoyerLivretParEmail({
      // Le livret part toujours vers l'adresse du professionnel (toi), jamais
      // directement au client — c'est toi qui reçois, ajustes si besoin, puis
      // transmets. L'adresse cliente éventuellement saisie dans le formulaire
      // sert uniquement de référence dans l'email (voir email.js).
      destinataire: process.env.OWNER_EMAIL,
      emailClientReference: reponse.email,
      telephoneClient: reponse.telephone,
      notesPersonnalisation: reponse.notesPersonnalisation,
      typeLivraison: reponse.typeLivraison,
      typeDemande: reponse.typeDemande,
      couleur: reponse.personnalisation?.couleur,
      couleurAutre: reponse.personnalisation?.couleurAutre,
      epoux: reponse.epoux,
      epouse: reponse.epouse,
      dateMariage: reponse.date,
      heureMariage: reponse.heure,
      lieuMariage: reponse.lieu,
      formuleLabel,
      prixTotal: total,
      detailPrix: detail,
      pdfBuffer,
      nomFichier,
    });

    return { pdfBuffer, nomFichier, resultatEmail };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }
}

// ------------------------------------------------------------------
// POST /api/livrets — route de test/debug UNIQUEMENT (usage interne).
// Depuis la mise en place du paiement, ce n'est plus cette route que le
// formulaire appelle : la génération + l'envoi ne se déclenchent désormais
// que via la confirmation de paiement Stripe (voir handleWebhookStripe).
// Conservée pour pouvoir tester le moteur sans repasser par un paiement réel.
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// POST /api/livrets — reçoit la demande du client, génère le livret et
// l'envoie par email au professionnel (jamais directement au client, qui ne
// reçoit qu'une confirmation JSON — pas de PDF téléchargé côté client).
// ------------------------------------------------------------------
async function handleGenerateLivret(req, res) {
  let reponse;
  try {
    reponse = await readJsonBody(req);
  } catch (e) {
    return sendJson(res, 400, { erreur: e.message });
  }

  const erreurs = validateReponse(reponse);
  if (erreurs.length > 0) {
    return sendJson(res, 400, { erreur: "Réponses incomplètes", details: erreurs });
  }

  try {
    const { resultatEmail } = await genererEtEnvoyerLivret(reponse);
    sendJson(res, 200, {
      succes: true,
      emailEnvoye: resultatEmail.envoye,
      emailRaison: resultatEmail.raison || null,
    });
  } catch (err) {
    console.error("Erreur de génération du livret :", err);
    sendJson(res, 500, { erreur: "Échec de la génération du livret", details: err.message });
  }
}

// ------------------------------------------------------------------
// POST /api/paiement/creer-session — stocke les réponses du couple en
// attente, crée une session de paiement Stripe (29 €), renvoie l'URL de
// paiement vers laquelle rediriger le navigateur.
// ------------------------------------------------------------------
async function handleCreerSessionPaiement(req, res) {
  let reponse;
  try {
    reponse = await readJsonBody(req);
  } catch (e) {
    return sendJson(res, 400, { erreur: e.message });
  }

  const erreurs = validateReponse(reponse);
  if (erreurs.length > 0) {
    return sendJson(res, 400, { erreur: "Réponses incomplètes", details: erreurs });
  }
  if (!reponse.email) {
    return sendJson(res, 400, { erreur: "Une adresse email est requise pour recevoir le livret." });
  }

  purgerReponsesExpirees();
  const reponseId = crypto.randomBytes(12).toString("hex");
  reponsesEnAttente.set(reponseId, { reponse, creeLe: Date.now() });

  try {
    const siteUrl = `https://${req.headers.host}`;
    const url = await creerSessionPaiement({
      reponseId,
      epoux: reponse.epoux,
      epouse: reponse.epouse,
      email: reponse.email,
      siteUrl,
    });
    sendJson(res, 200, { url });
  } catch (err) {
    reponsesEnAttente.delete(reponseId);
    console.error("Erreur de création de la session de paiement :", err);
    sendJson(res, 500, { erreur: "Impossible de démarrer le paiement", details: err.message });
  }
}

// ------------------------------------------------------------------
// POST /api/paiement/webhook — appelée par Stripe pour confirmer un paiement.
// C'est le SEUL déclencheur de la génération + de l'envoi du livret.
// ------------------------------------------------------------------
async function handleWebhookStripe(req, res) {
  const corpsBrut = await readRawBody(req);
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret || !verifierSignatureWebhook(corpsBrut, req.headers["stripe-signature"], secret)) {
    console.error("Webhook Stripe : signature invalide ou secret non configuré.");
    res.writeHead(400);
    return res.end("Signature invalide");
  }

  let event;
  try {
    event = JSON.parse(corpsBrut);
  } catch (e) {
    res.writeHead(400);
    return res.end("JSON invalide");
  }

  if (event.type === "checkout.session.completed") {
    const reponseId = event.data.object.client_reference_id;
    const entree = reponsesEnAttente.get(reponseId);
    if (!entree) {
      console.error("Webhook Stripe : réponses introuvables pour", reponseId);
    } else {
      reponsesEnAttente.delete(reponseId);
      // Ne bloque pas la réponse au webhook (Stripe attend une réponse rapide) :
      // la génération + l'envoi se poursuivent en arrière-plan.
      genererEtEnvoyerLivret(entree.reponse).catch((err) => {
        console.error("Erreur de génération après paiement confirmé :", err);
      });
    }
  }

  res.writeHead(200);
  res.end("ok");
}

// ------------------------------------------------------------------
// Protection par mot de passe simple (authentification HTTP basique) : ce
// n'est plus un outil grand public, mais un outil de travail pour toi seul.
// Si SITE_PASSWORD n'est pas défini, le service reste ouvert sans mot de
// passe (utile pour les tests locaux sans configuration supplémentaire).
// ------------------------------------------------------------------
function verifierMotDePasse(req) {
  const motDePasseAttendu = process.env.SITE_PASSWORD;
  if (!motDePasseAttendu) return true; // aucune protection configurée

  const enTete = req.headers["authorization"] || "";
  if (!enTete.startsWith("Basic ")) return false;

  const decode = Buffer.from(enTete.slice(6), "base64").toString("utf8");
  const motDePasseFourni = decode.split(":")[1] || "";

  const a = Buffer.from(motDePasseFourni);
  const b = Buffer.from(motDePasseAttendu);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ------------------------------------------------------------------
// Routeur principal
// ------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  // Pré-vol CORS
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  // Demande d'authentification avant tout accès (formulaire, API, pages) si
  // un mot de passe est configuré sur le serveur.
  if (!verifierMotDePasse(req)) {
    res.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="Livret2Mariage"',
      "Content-Type": "text/plain; charset=utf-8",
    });
    return res.end("Authentification requise.");
  }

  const url = req.url.split("?")[0];

  if (req.method === "POST" && url === "/api/livrets") {
    return handleGenerateLivret(req, res);
  }
  if (req.method === "POST" && url === "/api/paiement/creer-session") {
    return handleCreerSessionPaiement(req, res);
  }
  if (req.method === "POST" && url === "/api/paiement/webhook") {
    return handleWebhookStripe(req, res);
  }
  if (req.method === "POST" && url === "/api/contact") {
    return handleContact(req, res);
  }
  if ((req.method === "GET" || req.method === "HEAD") && url === "/paiement/succes") {
    return servePageConfirmation(res, {
      titre: "Merci !",
      message: "Votre paiement a bien été reçu. Votre livret est en cours de génération et vous sera envoyé par email dans quelques instants.",
    });
  }
  if ((req.method === "GET" || req.method === "HEAD") && url === "/paiement/annule") {
    return servePageConfirmation(res, {
      titre: "Paiement annulé",
      message: "Aucun montant n'a été débité. Vous pouvez reprendre votre formulaire et réessayer quand vous le souhaitez.",
    });
  }
  if ((req.method === "GET" || req.method === "HEAD") && (url === "/contact" || url === "/contact.html")) {
    return serveFichierFormulaire(res, "contact.html");
  }
  if ((req.method === "GET" || req.method === "HEAD") && (url === "/tuto" || url === "/tuto.html")) {
    return serveFichierFormulaire(res, "tuto.html");
  }
  if ((req.method === "GET" || req.method === "HEAD") && (url === "/tarif" || url === "/tarif.html")) {
    return serveFichierFormulaire(res, "tarif.html");
  }
  if ((req.method === "GET" || req.method === "HEAD") && url === "/api/textes/choix") {
    return handleChoix(req, res);
  }
  // GET et HEAD tous les deux acceptés : les outils de surveillance (comme
  // UptimeRobot) envoient souvent des requêtes HEAD plutôt que GET pour
  // vérifier qu'un site répond, sans avoir besoin du contenu.
  if ((req.method === "GET" || req.method === "HEAD") && url === "/api/health") {
    return sendJson(res, 200, { status: "ok" });
  }
  if ((req.method === "GET" || req.method === "HEAD")) {
    return serveStatic(req, res);
  }

  res.writeHead(404);
  res.end("Introuvable");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur du livret de mariage démarré sur http://localhost:${PORT}`);
});

module.exports = server;
