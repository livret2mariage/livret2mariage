const { esc, remplacePrenoms, paragraphes, versetsPsaume, chantHtml, capitaliseNom } = require("./utils");

/**
 * Retrouve un texte par catégorie + id. Si aucun id n'est fourni par le couple
 * (champ facultatif ou non encore choisi), on retombe automatiquement sur le
 * texte marqué "recommande: true" dans la base — le choix le plus apprécié —
 * plutôt que de faire échouer la génération.
 */
function trouve(base, categorie, id) {
  const liste = base[categorie] || [];
  if (id) {
    const item = liste.find((t) => t.id === id);
    if (item) return item;
    throw new Error(
      `Texte introuvable : catégorie "${categorie}", id "${id}". Vérifie data/textes.json.`
    );
  }
  const recommande = liste.find((t) => t.recommande);
  if (recommande) return recommande;
  throw new Error(`Aucun choix fourni pour "${categorie}" et aucun texte recommandé en base.`);
}

function assembleLivret(reponse, base) {
  const { date, heure, lieu, motsRemerciements } = reponse;
  const epoux = capitaliseNom(reponse.epoux);
  const epouse = capitaliseNom(reponse.epouse);
  const choix = reponse.choix || {};
  const chants = reponse.chants || {};

  // Format du livret : A5 (recommandé, le plus courant pour un livret de messe)
  // ou A4. Les dimensions de page sont injectées dans un <style> qui surcharge
  // le template par défaut (conçu pour A5).
  const FORMATS = {
    A5: { size: "A5", hauteurPage: 210, margeHaut: 15, margeBas: 18 },
    A4: { size: "A4", hauteurPage: 297, margeHaut: 15, margeBas: 18 },
  };
  const format = FORMATS[reponse.format] ? reponse.format : "A5";
  const { size, hauteurPage, margeHaut, margeBas } = FORMATS[format];
  // L'A4 étant nettement plus grand que l'A5, les mêmes tailles de police
  // (en points, valeurs absolues) y paraissent trop petites proportionnellement
  // à la page. On agrandit tout le contenu (texte ET espacements) d'un facteur
  // qui suit le rapport de taille entre les deux formats, pour que le rendu
  // garde des proportions similaires quel que soit le format choisi.
  const echelle = format === "A4" ? 1.4 : 1;
  const hauteurContenu = hauteurPage - margeHaut - margeBas;

  const salutation = trouve(base, "salutations", choix.salutation?.id);
  const accueil = trouve(base, "motsAccueil", choix.motAccueil?.id);
  const ouverture = trouve(base, "prieresOuverture", choix.priereOuverture?.id);
  const lecture = trouve(base, "lectures", choix.lecture?.id);
  const psaume = trouve(base, "psaumes", choix.psaume?.id);
  const evangile = trouve(base, "evangiles", choix.evangile?.id);
  const dialogue = trouve(base, "dialoguesInitiaux", choix.dialogueInitial?.id);
  const invitation = trouve(base, "invitationsConsentement", choix.invitationConsentement?.id);
  const consentement = trouve(base, "consentements", choix.consentements?.id);
  const reception = trouve(base, "receptionsConsentement", choix.receptionConsentement?.id);
  const benAlliances = trouve(base, "benedictionsAlliances", choix.benedictionAlliances?.id);
  const benNuptiale = trouve(base, "benedictionsNuptiales", choix.benedictionNuptiale?.id);
  const priereEpoux = trouve(base, "prieresEpoux", choix.priereEpoux?.id);
  const priereUniv = trouve(base, "prieresUniverselles", choix.priereUniverselle?.id);
  const benFinale = trouve(base, "benedictionsFinales", choix.benedictionFinale?.id);
  const remise = base.remiseAlliances;
  const notrePere = base.notrePere;

  const lecteurTag = (nom) => (nom ? `<p class="lecteur">(Lu par : ${esc(capitaliseNom(nom))})</p>` : "");

  // Personnalisation de la couverture (choisie dans le formulaire) : présentation
  // (classique / encadre / monogramme), teinte, police d'écriture des prénoms.
  // Valeurs par défaut si absentes (ex. génération via un JSON simple sans passer
  // par le formulaire).
  const perso = reponse.personnalisation || {};
  const presentation = ["classique", "encadre", "monogramme"].includes(perso.presentation) ? perso.presentation : "classique";
  const couleur = ["sauge", "rose", "bleu", "or"].includes(perso.couleur) ? perso.couleur : "sauge";
  const policeChoisie = ["parisienne", "alexbrush", "greatvibes"].includes(perso.police) ? perso.police : "parisienne";
  const initEpoux = epoux ? epoux.trim()[0].toUpperCase() : "";
  const initEpouse = epouse ? epouse.trim()[0].toUpperCase() : "";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Livret de mariage — ${esc(epoux)} & ${esc(epouse)}</title>
<link rel="stylesheet" href="style.css">
<link href="https://fonts.googleapis.com/css2?family=Parisienne&family=Alex+Brush&family=Great+Vibes&display=swap" rel="stylesheet">
<style>
  @page { size: ${size}; margin: ${margeHaut}mm 14mm ${margeBas}mm 14mm; }
  :root { --page-content-height: ${hauteurContenu}mm; }
  body { zoom: ${echelle}; }
</style>
</head>
<body>

<!-- ===================== COUVERTURE ===================== -->
<section class="page couverture tint-${couleur} font-${policeChoisie} layout-${presentation}">
  <div class="frame-inset"></div>
  <div class="contenu-couverture">
    <div class="monogramme-cover">${esc(initEpoux)}&amp;${esc(initEpouse)}</div>
    <h1 class="sous-titre">Célébration du mariage de</h1>
    <h1 class="prenom">${esc(epoux)}</h1>
    <h1 class="esperluette">&amp;</h1>
    <h1 class="prenom">${esc(epouse)}</h1>
    <div class="rule-cover"></div>
    <div class="infos-pratiques">
      <p>Mariage célébré le ${esc(date)}</p>
      <p>À ${esc(lieu).toUpperCase()}</p>
      <p>À ${esc(heure).toUpperCase()}</p>
    </div>
  </div>
</section>

<!-- ===================== PAGE BLANCHE (verso de couverture) ===================== -->
<!-- Convention d'édition classique : le contenu commence toujours sur une
     page de droite (recto), jamais juste après la couverture — comme au dos
     d'une couverture de livre. -->
<section class="page"></section>

<!-- ===================== DIEU NOUS ACCUEILLE ===================== -->
<section class="page">
  <h2 class="titre-partie">Dieu nous accueille</h2>
  ${chantHtml("Chant d'entrée", chants.entree, chants.entreeParoles)}

  <h3 class="titre-section">Salutation</h3>
  <p class="rubrique"><em>Le prêtre ou le diacre fait alors le signe de la croix et salue l'assemblée :</em></p>
  ${paragraphes(salutation.texte, epoux, epouse, "texte-liturgique")}
  <p class="reponse">R/. ${esc(salutation.reponse)}</p>
  <p class="rubrique"><em>Puis il s'adresse aux futurs époux et à l'assemblée pour les préparer à la célébration du mariage :</em></p>
  <p class="texte-liturgique">« ${remplacePrenoms(accueil.texte[0], epoux, epouse)} »</p>

  <h3 class="titre-section">Prière d'ouverture</h3>
  ${paragraphes(ouverture.texte, epoux, epouse, "texte-liturgique")}
</section>

<!-- ===================== DIEU NOUS PARLE ===================== -->
<section class="page">
  <h2 class="titre-partie">Dieu nous parle</h2>

  <h3 class="titre-section">Première lecture</h3>
  ${lecteurTag(choix.lecture?.lecteur)}
  <p class="reference">${esc(lecture.reference)}</p>
  ${paragraphes(lecture.texte, epoux, epouse, "texte-liturgique")}
  <p class="texte-liturgique">Parole du Seigneur.</p>
</section>

<section class="page">
  <h3 class="titre-section">Le Psaume</h3>
  ${lecteurTag(choix.psaume?.lecteur)}
  <p class="reference">${esc(psaume.reference)}</p>
  <p class="reference-titre">${esc(psaume.titre)}</p>
  ${psaume.refrains.map((r, i) => `${i > 0 ? '<p class="refrain-alt">ou</p>' : ""}<p class="refrain">${esc(r)}</p>`).join("\n")}
  ${versetsPsaume(psaume.texte, epoux, epouse, "texte-liturgique verset-psaume")}
</section>

<section class="page">
  ${chantHtml("Acclamation de l'Évangile", chants.acclamation || "Alléluia", chants.acclamationParoles)}
  <h3 class="titre-section">Évangile</h3>
  <p class="reference">${esc(evangile.reference)}</p>
  ${paragraphes(evangile.texte, epoux, epouse, "texte-liturgique")}

  <h3 class="titre-section">Homélie</h3>
</section>

<!-- ===================== LITURGIE DU MARIAGE ===================== -->
<section class="page">
  <h2 class="titre-partie">Liturgie du mariage</h2>
  <p class="rubrique"><em>Avant d'entrer dans la liturgie du mariage, nous invoquons l'Esprit Saint pour qu'Il éclaire et guide les époux.</em></p>
  ${chantHtml("Chant à l'Esprit Saint", chants.espritSaint, chants.espritSaintParoles)}

  <div class="bloc-liturgique">
    <h3 class="titre-section">Dialogue initial</h3>
    ${paragraphes(dialogue.texte, epoux, epouse, "texte-liturgique")}
  </div>

  <div class="bloc-liturgique">
    <h3 class="titre-section">Échange des consentements</h3>
    <p class="rubrique"><em>Invitation à échanger les consentements :</em></p>
    ${paragraphes(invitation.texte, epoux, epouse, "texte-liturgique")}
    ${paragraphes(consentement.texte, epoux, epouse, "texte-liturgique")}
    ${paragraphes(reception.texte, epoux, epouse, "reception")}
  </div>

  <div class="bloc-liturgique">
    <h3 class="titre-section">Bénédiction et remise des alliances</h3>
    <p class="texte-liturgique"><strong>Bénédiction des alliances :</strong></p>
    ${paragraphes(benAlliances.texte, epoux, epouse, "texte-liturgique")}
    <p class="texte-liturgique"><strong>Remise des alliances :</strong></p>
    ${paragraphes(remise.texte, epoux, epouse, "texte-liturgique")}
  </div>

  <div class="bloc-liturgique">
    <h3 class="titre-section">Bénédiction nuptiale</h3>
    <p class="rubrique"><em>Le prêtre invoque la bénédiction de Dieu sur les époux afin que leur amour soit fortifié et sanctifié.</em></p>
    ${paragraphes(benNuptiale.texte, epoux, epouse, "texte-liturgique")}
  </div>
</section>

<!-- ===================== ACTION DE GRÂCE ET PRIÈRE ===================== -->
<section class="page">
  <h2 class="titre-partie">Action de grâce et prière</h2>
  ${chantHtml("Chant de louange", chants.louange, chants.louangeParoles)}

  <div class="bloc-liturgique">
    <h3 class="titre-section">Prière des époux</h3>
    ${paragraphes(priereEpoux.texte, epoux, epouse, "texte-liturgique")}
  </div>

  <div class="bloc-liturgique">
    <h3 class="titre-section">Prière universelle</h3>
    ${lecteurTag(choix.priereUniverselle?.lecteur)}
    ${chantHtml("Chant", chants.priereUniverselle, chants.priereUniverselleParoles)}
    ${paragraphes(priereUniv.texte, epoux, epouse, "texte-liturgique")}
  </div>

  <div class="bloc-liturgique">
    <h3 class="titre-section">Notre Père</h3>
    ${paragraphes(notrePere.texte, epoux, epouse, "texte-liturgique")}
  </div>
</section>

<!-- ===================== ENVOI ET CONCLUSION ===================== -->
<section class="page">
  <h2 class="titre-partie">Envoi et conclusion</h2>
  ${chantHtml("Chant à Marie", chants.marie, chants.marieParoles)}

  <h3 class="titre-section">Bénédiction finale</h3>
  ${paragraphes(benFinale.texte, epoux, epouse, "texte-liturgique")}

  ${chantHtml("Chant pour la signature des registres", chants.signatureRegistres, chants.signatureRegistresParoles)}
  ${chantHtml("Chant de sortie", chants.sortie, chants.sortieParoles)}
</section>

<!-- ===================== DERNIÈRE PAGE / REMERCIEMENTS ===================== -->
<section class="page couverture derniere-page tint-${couleur}">
  ${motsRemerciements ? `<p class="remerciements-finaux">${esc(motsRemerciements)}</p>` : ""}
</section>

</body>
</html>`;
}

/** Format de page ("A5" ou "A4") choisi pour ces réponses — A5 par défaut. */
function formatChoisi(reponse) {
  return reponse.format === "A4" ? "A4" : "A5";
}

module.exports = { assembleLivret, formatChoisi };
