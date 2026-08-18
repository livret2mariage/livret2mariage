// Petites fonctions utilitaires partagées par le moteur d'assemblage.

/** Échappe le HTML pour éviter toute injection depuis les données du formulaire. */
function esc(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Le fichier de référence liturgique utilise la convention standard "N."
 * pour désigner indifféremment l'un ou l'autre époux (parfois avec des
 * précisions explicites comme "N. - (l'épouse) -"). Cette fonction convertit
 * ces "N." en jetons {EPOUX}/{EPOUSE} avant le remplacement final, afin que
 * les vrais prénoms du couple apparaissent partout dans le livret.
 */
function normaliseNPoints(texte) {
  let t = texte;
  // Cas explicites : "N. - (l'épouse) -" / "N. - (l'époux) -" (tirets variables, espaces variables)
  t = t.replace(/N\.\s*-?\s*\(\s*l['’]épouse\s*\)\s*-?/gi, "{EPOUSE}");
  t = t.replace(/N\.\s*-?\s*\(\s*l['’]époux\s*\)\s*-?/gi, "{EPOUX}");
  // Cas le plus fréquent : "N. et N." -> époux puis épouse, dans cet ordre
  t = t.replace(/N\.\s*et\s*N\./gi, "{EPOUX} et {EPOUSE}");
  // "N, et N." (variante avec virgule, coquille du document source)
  t = t.replace(/N,\s*et\s*N\./gi, "{EPOUX} et {EPOUSE}");
  // Occurrences isolées restantes : on alterne époux puis épouse à chaque "N."
  let toggle = true;
  t = t.replace(/N\./g, () => {
    const jeton = toggle ? "{EPOUX}" : "{EPOUSE}";
    toggle = !toggle;
    return jeton;
  });
  return t;
}

/**
 * Remplace les jetons {EPOUX} / {EPOUSE} (et les "N." du texte source, via
 * normaliseNPoints) par les vrais prénoms, mis en gras comme dans le modèle.
 */
function remplacePrenoms(texte, epoux, epouse) {
  const normalise = normaliseNPoints(texte);
  return esc(normalise)
    .replace(/\{EPOUX\}/g, `<strong>${esc(epoux)}</strong>`)
    .replace(/\{EPOUSE\}/g, `<strong>${esc(epouse)}</strong>`);
}

/** Transforme un tableau de lignes de texte en paragraphes HTML, avec substitution des prénoms. */
function paragraphes(lignes, epoux, epouse, className = "") {
  if (!lignes) return "";
  const cls = className ? ` class="${className}"` : "";
  return lignes
    .map((ligne) => `<p${cls}>${remplacePrenoms(ligne, epoux, epouse)}</p>`)
    .join("\n");
}

/**
 * Transforme des paroles collées par le couple (avec sauts de ligne libres)
 * en HTML : une ligne vide sépare les couplets, un simple retour à la ligne
 * reste à l'intérieur du même couplet.
 */
function formatParoles(paroles) {
  if (!paroles || !paroles.trim()) return "";
  const couplets = paroles.trim().split(/\n\s*\n/);
  return couplets
    .map((c) => `<p>${esc(c).split("\n").join("<br>")}</p>`)
    .join("\n");
}

/** Affiche une ligne de chant (titre) avec, si fournies, ses paroles repliables visuellement en dessous.
 * Si aucun titre n'est renseigné, la ligne est simplement omise (rien à afficher). */
function chantHtml(label, titre, paroles) {
  if (!titre || !titre.trim()) return "";
  const ligneTitre = `<p class="chant"><strong>${label} :</strong> ${esc(titre)}</p>`;
  const bloc = formatParoles(paroles);
  return bloc ? `${ligneTitre}<div class="chant-paroles">${bloc}</div>` : ligneTitre;
}

/**
 * Normalise la casse d'un nom : toujours "Première lettre en majuscule, reste
 * en minuscule", quelle que soit la façon dont il a été saisi (MAJUSCULES,
 * minuscules, CaSsE aléatoire). S'applique aux prénoms des époux et aux noms
 * des lecteurs, pour garantir un rendu cohérent dans le livret final.
 */
function capitaliseNom(nom) {
  if (!nom) return nom;
  const trimmed = nom.trim();
  if (!trimmed) return trimmed;
  const minuscule = trimmed.toLowerCase();
  return minuscule.charAt(0).toUpperCase() + minuscule.slice(1);
}

/**
 * Affiche les lignes d'un psaume regroupées par versets de deux lignes (les
 * demi-vers vont ensemble, séparés par un simple retour à la ligne), avec un
 * espacement plus net entre deux versets qu'à l'intérieur d'un même verset —
 * pour retrouver la structure poétique plutôt qu'une suite de lignes isolées.
 * S'il reste une ligne seule en fin de psaume, elle forme son propre verset.
 */
function versetsPsaume(lignes, epoux, epouse, className = "") {
  if (!lignes) return "";
  const cls = className ? ` class="${className}"` : "";
  const versets = [];
  for (let i = 0; i < lignes.length; i += 2) {
    versets.push(lignes.slice(i, i + 2));
  }
  return versets
    .map(
      (verset) =>
        `<p${cls}>${verset.map((ligne) => remplacePrenoms(ligne, epoux, epouse)).join("<br>")}</p>`
    )
    .join("\n");
}

module.exports = { esc, remplacePrenoms, paragraphes, versetsPsaume, normaliseNPoints, formatParoles, chantHtml, capitaliseNom };
