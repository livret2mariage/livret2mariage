const { PDFDocument } = require("pdf-lib");

/**
 * Un livret imprimé "4 pages par feuille" (façonnage classique : feuilles A4
 * pliées en deux, imprimées recto-verso) exige que le nombre total de pages
 * soit un multiple de 4 — sinon l'imprimeur se retrouve avec des pages
 * manquantes, décalées ou mal positionnées au pliage.
 *
 * Cette fonction ajoute autant de pages blanches que nécessaire à la fin du
 * PDF pour atteindre le prochain multiple de 4. Si le compte est déjà bon,
 * le PDF est renvoyé inchangé.
 *
 * @param {Buffer} pdfBytes - le PDF déjà généré (buffer)
 * @returns {Promise<{ bytes: Buffer, pagesAjoutees: number, pagesTotal: number }>}
 */
async function completerPourImpressionLivret(pdfBytes) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pageCount = pdfDoc.getPageCount();
  const reste = pageCount % 4;

  if (reste === 0) {
    return { bytes: Buffer.from(pdfBytes), pagesAjoutees: 0, pagesTotal: pageCount };
  }

  const pagesAjoutees = 4 - reste;
  const derniere = pdfDoc.getPage(pageCount - 1);
  const { width, height } = derniere.getSize();

  for (let i = 0; i < pagesAjoutees; i++) {
    pdfDoc.addPage([width, height]);
  }

  const bytes = await pdfDoc.save();
  return { bytes: Buffer.from(bytes), pagesAjoutees, pagesTotal: pageCount + pagesAjoutees };
}

module.exports = { completerPourImpressionLivret };
