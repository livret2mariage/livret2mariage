const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

/**
 * Un livret imprimé "4 pages par feuille" (façonnage classique : feuilles A4
 * pliées en deux, imprimées recto-verso) exige que le nombre total de pages
 * soit un multiple de 4 — sinon l'imprimeur se retrouve avec des pages
 * manquantes, décalées ou mal positionnées au pliage. Ce façonnage ne
 * concerne que le format A5 (le livret imprimé sur des feuilles A4 pliées
 * en deux) : un livret généré directement en A4 n'est pas destiné à ce
 * pliage, donc pas besoin de compléter à un multiple de 4 dans ce cas — on
 * se contente d'ajouter le filigrane.
 *
 * Quand la complétion s'applique, les pages blanches sont insérées JUSTE
 * AVANT la toute dernière page (plutôt qu'après), pour que le livret se
 * termine toujours sur sa page de conclusion ("Merci à tous !" + filigrane)
 * plutôt que sur une série de pages vides qui donnent une impression
 * bizarre à la fin.
 *
 * @param {Buffer} pdfBytes - le PDF déjà généré (buffer)
 * @param {{ format?: "A4" | "A5" }} options - le format choisi (A5 par défaut)
 * @returns {Promise<{ bytes: Buffer, pagesAjoutees: number, pagesTotal: number }>}
 */
async function completerPourImpressionLivret(pdfBytes, { format = "A5" } = {}) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  let pagesAjoutees = 0;

  if (format === "A5") {
    const pageCount = pdfDoc.getPageCount();
    const reste = pageCount % 4;

    if (reste !== 0) {
      pagesAjoutees = 4 - reste;
      const derniere = pdfDoc.getPage(pageCount - 1);
      const { width, height } = derniere.getSize();
      // Insère chaque page blanche juste avant l'ancienne dernière page
      // (index pageCount - 1) : elles s'accumulent dans l'ordre juste devant
      // elle, qui reste ainsi la toute dernière page du document final.
      for (let i = 0; i < pagesAjoutees; i++) {
        pdfDoc.insertPage(pageCount - 1, [width, height]);
      }
    }
  }

  await ajouterFiligrane(pdfDoc);

  const bytes = await pdfDoc.save();
  return { bytes: Buffer.from(bytes), pagesAjoutees, pagesTotal: pdfDoc.getPageCount() };
}

/** Ajoute "Livret2Mariage" en petit, centré, en bas de la toute dernière page. */
async function ajouterFiligrane(pdfDoc) {
  const dernierePage = pdfDoc.getPage(pdfDoc.getPageCount() - 1);
  const { width } = dernierePage.getSize();
  const police = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const texte = "Livret2Mariage";
  const taille = 15;
  const largeurTexte = police.widthOfTextAtSize(texte, taille);
  dernierePage.drawText(texte, {
    x: (width - largeurTexte) / 2,
    y: 40, // ~14mm du bas
    size: taille,
    font: police,
    color: rgb(0.608, 0.608, 0.565), // équivalent à #9B9B90
  });
}

module.exports = { completerPourImpressionLivret };
