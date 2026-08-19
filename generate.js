const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { assembleLivret, formatChoisi } = require("./moteur/assembler");
const { completerPourImpressionLivret } = require("./moteur/pagination");

async function main() {
  const reponsePath = process.argv[2] || "data/reponse-couple-exemple.json";
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, "data/textes.json"), "utf8"));
  const reponse = JSON.parse(fs.readFileSync(path.join(__dirname, reponsePath), "utf8"));

  console.log(`Assemblage du livret pour ${reponse.epoux} & ${reponse.epouse}...`);
  const html = assembleLivret(reponse, base);

  // On écrit le HTML assemblé dans le dossier template (à côté de style.css et border.png)
  // pour que les chemins relatifs (image, css) fonctionnent tels quels.
  const htmlPath = path.join(__dirname, "template", "_livret_genere.html");
  fs.writeFileSync(htmlPath, html, "utf8");

  const nomFichier = `livret_${reponse.epoux}_${reponse.epouse}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  const outputPath = path.join(__dirname, "output", `${nomFichier}.pdf`);

  console.log("Génération du PDF...");
  const browser = await chromium.launch();
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
  await page.pdf({
    path: outputPath,
    format: formatChoisi(reponse),
    printBackground: true,
    margin: { top: "0", bottom: "0", left: "0", right: "0" }, // marges déjà gérées dans @page (CSS)
  });
  await browser.close();

  // Complète avec des pages blanches si besoin, pour que le livret soit prêt
  // à être imprimé "4 pages par feuille" (façonnage classique en livret).
  const fs2 = require("fs");
  const format = formatChoisi(reponse);
  const pdfBytes = fs2.readFileSync(outputPath);
  const { bytes, pagesAjoutees, pagesTotal } = await completerPourImpressionLivret(pdfBytes, { format });
  // On réécrit toujours le fichier : que des pages aient été ajoutées ou non,
  // le filigrane a de toute façon été dessiné sur la dernière page.
  fs2.writeFileSync(outputPath, bytes);
  if (pagesAjoutees > 0) {
    console.log(
      `${pagesAjoutees} page(s) blanche(s) ajoutée(s) pour l'impression en livret (total : ${pagesTotal} pages, multiple de 4).`
    );
  } else if (format === "A5") {
    console.log(`Le livret compte déjà ${pagesTotal} pages, un multiple de 4 — prêt pour l'impression en livret.`);
  } else {
    console.log(`Livret généré en format ${format} (${pagesTotal} pages) — pas de complétion à un multiple de 4 pour ce format.`);
  }

  console.log(`Livret généré : ${outputPath}`);
}

main().catch((err) => {
  console.error("Erreur lors de la génération :", err.message);
  process.exit(1);
});
