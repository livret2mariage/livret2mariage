const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { chromium } = require("playwright");
const { assembleLivret, formatChoisi } = require("../moteur/assembler");
const { completerPourImpressionLivret } = require("../moteur/pagination");
const { envoyerLivretParEmail } = require("./email");

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

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

function serveStatic(req, res) {
  let reqPath = req.url === "/" ? "/index.html" : req.url;
  reqPath = reqPath.split("?")[0];
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

  ["epoux", "epouse", "date", "heure", "lieu"].forEach((champ) => {
    if (!r[champ] || typeof r[champ] !== "string" || !r[champ].trim()) {
      erreurs.push(`Le champ "${champ}" est requis.`);
    }
  });

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
// POST /api/livrets — assemble le livret et renvoie le PDF généré
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
    const { bytes: pdfBuffer } = await completerPourImpressionLivret(pdfBufferBrut);

    const nomFichier = `livret_${reponse.epoux}_${reponse.epouse}`
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_]/g, "");

    // Envoi automatique par email si une adresse a été fournie et que le
    // service est configuré (variables d'environnement RESEND_API_KEY et
    // RESEND_FROM_EMAIL) — best-effort : un échec d'envoi n'empêche jamais
    // le téléchargement direct du PDF de fonctionner.
    const resultatEmail = await envoyerLivretParEmail({
      destinataire: reponse.email,
      epoux: reponse.epoux,
      epouse: reponse.epouse,
      pdfBuffer,
      nomFichier,
    });

    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nomFichier}.pdf"`,
      "Content-Length": pdfBuffer.length,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "X-Email-Envoye, X-Email-Raison",
      "X-Email-Envoye": String(resultatEmail.envoye),
      "X-Email-Raison": resultatEmail.raison || "",
    });
    res.end(pdfBuffer);
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    console.error("Erreur de génération du livret :", err);
    sendJson(res, 500, { erreur: "Échec de la génération du livret", details: err.message });
  }
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

  const url = req.url.split("?")[0];

  if (req.method === "POST" && url === "/api/livrets") {
    return handleGenerateLivret(req, res);
  }
  if (req.method === "GET" && url === "/api/textes/choix") {
    return handleChoix(req, res);
  }
  if (req.method === "GET" && url === "/api/health") {
    return sendJson(res, 200, { status: "ok" });
  }
  if (req.method === "GET") {
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
