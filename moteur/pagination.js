const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

/**
 * Un livret imprimé "4 pages par feuille" (façonnage classique : feuilles A4
 * pliées en deux, imprimées recto-verso) exige que le nombre total de pages
 * soit un multiple de 4 — sinon l'imprimeur se retrouve avec des pages
 * manquantes, décalées ou mal positionnées au pliage.
 *
 * Cette fonction ajoute autant de pages blanches que nécessaire à la fin du
 * PDF pour atteindre le prochain multiple de 4, PUIS ajoute le filigrane
 * "Livret2Mariage" sur la toute dernière page du fichier final — qu'il
 * s'agisse d'une page de contenu ou d'une page blanche ajoutée. En faisant
 * ça après coup (plutôt que dans le template HTML), le filigrane est
 * toujours sur la vraie dernière page, à chaque génération, quel que soit
 * le nombre de pages ajoutées pour l'impression.
 *
 * @param {Buffer} pdfBytes - le PDF déjà généré (buffer)
 * @returns {Promise<{ bytes: Buffer, pagesAjoutees: number, pagesTotal: number }>}
 */
async function completerPourImpressionLivret(pdfBytes) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pageCount = pdfDoc.getPageCount();
  const reste = pageCount % 4;
  let pagesAjoutees = 0;

  if (reste !== 0) {
    pagesAjoutees = 4 - reste;
    const derniere = pdfDoc.getPage(pageCount - 1);
    const { width, height } = derniere.getSize();
    for (let i = 0; i < pagesAjoutees; i++) {
      pdfDoc.addPage([width, height]);
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
