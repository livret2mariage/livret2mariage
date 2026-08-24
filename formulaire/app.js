// Données des choix (labels + aperçus courts), embarquées dans la page — voir data/choix-formulaire.json
const CHOIX = JSON.parse(document.getElementById("choix-data").textContent);

// ---------- 0. Normalisation d'aperçu (même logique que moteur/utils.js normaliseNPoints,
// simplifiée côté client) : convertit "N. et N." et les balises {EPOUX}/{EPOUSE} en
// vrais prénoms pour que l'aperçu du formulaire ne montre jamais de jeton brut.
// Normalise la casse d'un nom : toujours "Première lettre en majuscule, reste
// en minuscule" — même logique que moteur/utils.js capitaliseNom(), pour que
// l'aperçu affiché au couple corresponde déjà au rendu final du PDF.
function capitaliseNom(nom) {
  if (!nom) return nom;
  const trimmed = nom.trim();
  if (!trimmed) return trimmed;
  const minuscule = trimmed.toLowerCase();
  return minuscule.charAt(0).toUpperCase() + minuscule.slice(1);
}

function apercuAvecPrenoms(texte) {
  if (!texte) return texte;
  const epoux = capitaliseNom(document.getElementById("epoux")?.value.trim()) || "l'époux";
  const epouse = capitaliseNom(document.getElementById("epouse")?.value.trim()) || "l'épouse";
  let t = texte;
  t = t.replace(/N\.\s*-?\s*\(\s*l['’]épouse\s*\)\s*-?/gi, epouse);
  t = t.replace(/N\.\s*-?\s*\(\s*l['’]époux\s*\)\s*-?/gi, epoux);
  t = t.replace(/N\.\s*et\s*N\./gi, `${epoux} et ${epouse}`);
  t = t.replace(/N,\s*et\s*N\./gi, `${epoux} et ${epouse}`);
  let toggle = true;
  t = t.replace(/N\./g, () => {
    const val = toggle ? epoux : epouse;
    toggle = !toggle;
    return val;
  });
  t = t.replace(/\{EPOUX\}/g, epoux).replace(/\{EPOUSE\}/g, epouse);
  return t;
}

// ---------- 0bis. Type de demande (devis rapide ou conception complète) ----------
// En mode "devis", seule la section "Le couple" (qui contient déjà les infos
// de contact + la personnalisation) reste nécessaire — les 4 sections
// liturgiques intermédiaires sont masquées, ce qui exempte automatiquement
// leurs champs "required" de la validation du navigateur (un champ caché
// n'est jamais bloquant pour l'envoi du formulaire).
const SECTIONS_LITURGIQUES = ["parole", "liturgie", "prieres", "chants"];

function appliquerTypeDemande(type) {
  const estDevis = type === "devis";
  SECTIONS_LITURGIQUES.forEach((nom) => {
    const section = document.querySelector(`section[data-section="${nom}"]`);
    const lienNav = document.querySelector(`nav a[data-section="${nom}"]`);
    const itemProgres = document.querySelector(`li[data-section="${nom}"]`);
    if (section) {
      section.style.display = estDevis ? "none" : "";
      // Un champ "required" dans une section display:none reste malgré tout
      // bloquant pour la validation HTML5 dans certains navigateurs : on
      // retire/remet l'attribut explicitement plutôt que de compter sur le
      // simple masquage visuel.
      // Un champ "required" dans une section display:none reste malgré tout
      // bloquant pour la validation HTML5 dans certains navigateurs : on
      // retire/remet l'attribut explicitement plutôt que de compter sur le
      // simple masquage visuel. On parcourt tous les champs (pas seulement
      // ceux actuellement [required]) pour pouvoir restaurer l'attribut une
      // fois qu'il a été retiré une première fois.
      section.querySelectorAll("select, input, textarea").forEach((champ) => {
        if (estDevis) {
          if (champ.hasAttribute("required")) {
            champ.dataset.requiredOriginel = "1";
            champ.removeAttribute("required");
          }
        } else if (champ.dataset.requiredOriginel) {
          champ.setAttribute("required", "");
        }
      });
    }
    if (lienNav) lienNav.style.display = estDevis ? "none" : "";
    if (itemProgres) itemProgres.style.display = estDevis ? "none" : "";
  });
  const note = document.getElementById("typeDemandeNote");
  if (note) {
    note.textContent = estDevis
      ? "Avec un simple devis, seules vos informations de couple sont nécessaires — les autres sections deviennent facultatives."
      : "Vous allez pouvoir choisir vos lectures, prières, bénédictions et personnaliser votre livret en détail.";
  }
}

document.querySelectorAll("#typeDemandeSwatches .format-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#typeDemandeSwatches .format-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    appliquerTypeDemande(btn.dataset.value);
    updateProgress();
  });
});

// Mode "devis" actif par défaut au chargement de la page.
appliquerTypeDemande("devis");

// ---------- 1. Remplissage des menus déroulants ----------

// Construit le contenu HTML de l'aperçu : résumé + lien avec le mariage (quand
// disponible, pour les lectures/psaumes/évangiles), avec le texte intégral
// replié derrière un lien — sinon un simple extrait comme pour les autres choix.
function rendreApercu(chosen) {
  const badge = chosen.recommande ? `<span class="badge-recommande">Recommandé</span> ` : "";
  const ref = chosen.ref ? `<span class="ref">${chosen.ref}</span>` : "";

  if (chosen.resume) {
    const texteResume = apercuAvecPrenoms(chosen.resume.texte);
    const lienMariage = apercuAvecPrenoms(chosen.resume.lien);
    const texteComplet = (chosen.texteComplet || [])
      .map((ligne) => `<p>${apercuAvecPrenoms(ligne)}</p>`)
      .join("");
    return `
      ${ref}${badge}
      <p class="resume-texte">${texteResume}</p>
      <p class="resume-lien"><span class="resume-lien-label">Lien avec le mariage</span> ${lienMariage}</p>
      <details class="texte-integral">
        <summary>Lire le texte intégral</summary>
        <div class="texte-integral-contenu">${texteComplet}</div>
      </details>
    `;
  }

  if (chosen.analyseUsage) {
    const analyse = apercuAvecPrenoms(chosen.analyseUsage.analyse);
    const usage = apercuAvecPrenoms(chosen.analyseUsage.usage);
    const texteComplet = (chosen.texteComplet || [])
      .map((ligne) => `<p>${apercuAvecPrenoms(ligne)}</p>`)
      .join("");
    return `
      ${badge}
      <p class="resume-lien"><span class="resume-lien-label">Analyse liturgique</span> ${analyse}</p>
      <p class="resume-lien"><span class="resume-lien-label">Utilisation</span> ${usage}</p>
      <details class="texte-integral">
        <summary>Lire le texte intégral</summary>
        <div class="texte-integral-contenu">${texteComplet}</div>
      </details>
    `;
  }

  return `${ref}${badge}${apercuAvecPrenoms(chosen.apercu) || ""}`;
}

document.querySelectorAll("select[data-cat]").forEach((select) => {
  const cat = select.dataset.cat;
  const options = CHOIX[cat] || [];
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "— Choisir —";
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  // Le choix recommandé est mis en avant visuellement : placé en tête de liste
  // (pas besoin de faire défiler pour le trouver), avec une étoile et en gras,
  // du texte simple restant possible avec les <option> HTML natives.
  const optionsTriees = [...options].sort((a, b) => (b.recommande ? 1 : 0) - (a.recommande ? 1 : 0));
  optionsTriees.forEach((opt) => {
    const el = document.createElement("option");
    el.value = opt.id;
    if (opt.recommande) {
      el.textContent = `★ ${opt.label} — recommandé`;
      el.style.fontWeight = "700";
      el.style.color = "#52604A";
    } else {
      el.textContent = opt.label;
    }
    select.appendChild(el);
  });

  // Le champ démarre volontairement vide (rien de pré-sélectionné) : même si
  // un choix est recommandé, le couple doit le choisir lui-même en connaissance
  // de cause plutôt que de valider sans s'en rendre compte un choix déjà fait
  // à sa place — surtout pour des textes aussi personnels que ceux-ci.
  const key = select.dataset.choice;
  const apercuEl = document.querySelector(`[data-apercu="${key}"]`);

  select.addEventListener("change", () => {
    const chosen = options.find((o) => o.id === select.value);
    if (chosen && apercuEl) {
      apercuEl.innerHTML = rendreApercu(chosen);
      apercuEl.classList.add("show");
    } else if (apercuEl) {
      apercuEl.classList.remove("show");
    }
    updateProgress();
  });
});

// ---------- 2. Prévisualisation live de la couverture ----------
const prevEpoux = document.getElementById("prevEpoux");
const prevEpouse = document.getElementById("prevEpouse");
const prevInfos = document.getElementById("prevInfos");

function formatDateFR(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function updatePreview() {
  const epoux = capitaliseNom(document.getElementById("epoux").value.trim());
  const epouse = capitaliseNom(document.getElementById("epouse").value.trim());
  const date = document.getElementById("date").value;
  const heure = document.getElementById("heure").value;
  const lieu = document.getElementById("lieu").value.trim();

  prevEpoux.textContent = epoux || "Vos prénoms";
  prevEpouse.textContent = epouse || "ici";

  const monogram = document.getElementById("prevMonogram");
  const initEpoux = epoux ? epoux.trim()[0].toUpperCase() : "K";
  const initEpouse = epouse ? epouse.trim()[0].toUpperCase() : "A";
  monogram.textContent = `${initEpoux}&${initEpouse}`;

  const lignes = [];
  if (date) lignes.push(`Mariage célébré le ${formatDateFR(date)}`);
  if (lieu) lignes.push(`À ${lieu.toUpperCase()}`);
  if (heure) lignes.push(`À ${heure}`);
  prevInfos.innerHTML = lignes.length ? lignes.join("<br>") : "La date, l'heure et le lieu<br>apparaîtront ici";
}

["epoux", "epouse", "date", "heure", "lieu"].forEach((id) => {
  document.getElementById(id).addEventListener("input", () => {
    updatePreview();
    updateProgress();
    if (id === "epoux" || id === "epouse") refreshAllApercus();
  });
});

// Recalcule tous les aperçus déjà affichés avec les prénoms à jour
// (utile si le couple choisit ses textes avant d'avoir saisi ses prénoms).
function refreshAllApercus() {
  document.querySelectorAll("select[data-cat]").forEach((select) => {
    if (!select.value) return;
    const cat = select.dataset.cat;
    const key = select.dataset.choice;
    const options = CHOIX[cat] || [];
    const chosen = options.find((o) => o.id === select.value);
    const apercuEl = document.querySelector(`[data-apercu="${key}"]`);
    if (chosen && apercuEl) {
      apercuEl.innerHTML = rendreApercu(chosen);
    }
  });
}

// ---------- 2bis. Onglets de prévisualisation (couverture / page intérieure) ----------
const previewCaption = document.getElementById("previewCaption");
document.querySelectorAll(".preview-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".preview-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-cover").classList.toggle("active", tab.dataset.tab === "cover");
    document.getElementById("tab-inner").classList.toggle("active", tab.dataset.tab === "inner");
    previewCaption.textContent =
      tab.dataset.tab === "cover"
        ? "Aperçu indicatif de la couverture — la version finale sera personnalisée avant envoi."
        : "Aperçu indicatif d'une page intérieure — la mise en page finale peut différer.";
  });
});

// Titre de section affiché au-dessus de chaque texte, selon la catégorie choisie
const SECTION_LABELS = {
  lecture: "Dieu nous parle",
  psaume: "Dieu nous parle",
  evangile: "Dieu nous parle",
  dialogueInitial: "La liturgie du mariage",
  consentements: "La liturgie du mariage",
  benedictionAlliances: "La liturgie du mariage",
  benedictionNuptiale: "La liturgie du mariage",
  priereEpoux: "Action de grâce et prière",
  priereUniverselle: "Action de grâce et prière",
  benedictionFinale: "Envoi et conclusion",
};

// Titres tels qu'ils apparaissent réellement dans le PDF final (voir
// moteur/assembler.js) — utilisés dans l'aperçu "page intérieure" à la place
// du nom technique de la formule choisie (ex. "PU2", "formule 3"), pour que
// l'aperçu corresponde exactement à ce qui sera imprimé.
const TITRES_PDF = {
  lecture: "Première lecture",
  psaume: "Le Psaume",
  evangile: "Évangile",
  dialogueInitial: "Dialogue initial",
  consentements: "Échange des consentements",
  benedictionAlliances: "Bénédiction et remise des alliances",
  benedictionNuptiale: "Bénédiction nuptiale",
  priereEpoux: "Prière des époux",
  priereUniverselle: "Prière universelle",
  benedictionFinale: "Bénédiction finale",
};

function renderInnerPreview(choice) {
  const container = document.getElementById("innerPreviewContent");
  if (!choice) {
    container.innerHTML = '<p class="page-mock-placeholder">Choisissez une lecture, un psaume ou une prière pour voir à quoi ressemblera cette page du livret.</p>';
    return;
  }
  container.innerHTML = `
    <div class="pm-eyebrow">${choice.section}</div>
    <div class="pm-title">${choice.label}</div>
    ${choice.ref ? `<div class="pm-ref">${choice.ref}</div>` : ""}
    ${choice.lecteur ? `<div class="pm-lecteur">(Lu par : ${choice.lecteur})</div>` : ""}
    <div class="pm-body">${choice.apercu || ""}</div>
    <div class="pm-fade">— extrait, le texte complet figure dans le livret —</div>
  `;
}

// ---------- 2ter. Suivi du dernier choix liturgique fait, pour la page intérieure ----------
document.querySelectorAll("select[data-cat]").forEach((select) => {
  select.addEventListener("change", () => {
    const cat = select.dataset.cat;
    const key = select.dataset.choice;
    const options = CHOIX[cat] || [];
    const chosen = options.find((o) => o.id === select.value);
    if (!chosen) return;
    const lecteurInput = document.querySelector(`[data-lecteur="${key}"]`);
    renderInnerPreview({
      section: SECTION_LABELS[key] || "",
      label: TITRES_PDF[key] || chosen.label,
      ref: chosen.ref,
      apercu: apercuAvecPrenoms(chosen.apercu),
      lecteur: lecteurInput ? lecteurInput.value.trim() : "",
    });
    // Bascule automatiquement sur l'onglet "page intérieure" pour montrer le résultat
    document.querySelector('.preview-tab[data-tab="inner"]').click();
  });
});

// ---------- 2quater. Personnalisation de la couverture (couleur) ----------
const coverMock = document.getElementById("tab-cover");

document.querySelectorAll("#formatSwatches .format-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#formatSwatches .format-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

document.querySelectorAll("#couleurSwatches .swatch-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#couleurSwatches .swatch-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    coverMock.className = coverMock.className.replace(/tint-\S+/, "").trim();
    if (btn.dataset.value !== "autre") {
      coverMock.classList.add(`tint-${btn.dataset.value}`);
      coverMock.style.removeProperty("--accent");
    } else {
      const valeurLibre = document.getElementById("couleurAutre").value.trim();
      if (valeurLibre) coverMock.style.setProperty("--accent", valeurLibre);
    }
  });
});

document.getElementById("couleurAutre").addEventListener("input", () => {
  const btnActif = document.querySelector("#couleurSwatches .swatch-btn.active");
  if (btnActif?.dataset.value === "autre") {
    const valeur = document.getElementById("couleurAutre").value.trim();
    if (valeur) coverMock.style.setProperty("--accent", valeur);
  }
});

document.querySelectorAll("#livraisonSwatches .format-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#livraisonSwatches .format-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

function getPersonnalisation() {
  const couleur = document.querySelector("#couleurSwatches .swatch-btn.active")?.dataset.value || "sauge";
  return {
    couleur,
    couleurAutre: couleur === "autre" ? document.getElementById("couleurAutre").value.trim() : undefined,
    // Une seule police élégante pour ce modèle — la couverture est de toute
    // façon personnalisée à la main ensuite.
    police: "parisienne",
  };
}

// ---------- 3. Suivi de progression par section ----------
function sectionIsComplete(name) {
  const section = document.querySelector(`section[data-section="${name}"]`);
  if (!section) return false;
  const required = section.querySelectorAll("[required]");
  if (required.length > 0) {
    return Array.from(required).every((el) => el.value && el.value.trim() !== "");
  }
  // Section sans champ obligatoire (ex. "Les chants") : on la considère
  // complète seulement si le couple a effectivement rempli au moins un champ.
  const optional = section.querySelectorAll("input, select");
  return Array.from(optional).some((el) => el.value && el.value.trim() !== "");
}

function updateProgress() {
  ["couple", "parole", "liturgie", "prieres", "chants", "mot"].forEach((name) => {
    const complete = sectionIsComplete(name);
    const navLink = document.querySelector(`.section-nav a[data-section="${name}"]`);
    const progressItem = document.querySelector(`.progress-list li[data-section="${name}"]`);
    if (navLink) navLink.classList.toggle("done", complete);
    if (progressItem) progressItem.classList.toggle("done", complete);
  });
}
document.querySelectorAll(".form-col input, .form-col select").forEach((el) => {
  el.addEventListener("input", updateProgress);
  el.addEventListener("change", updateProgress);
});

// ---------- 4. Construction du JSON de réponse + envoi ----------
const form = document.getElementById("livretForm");
const statusBanner = document.getElementById("statusBanner");

function buildReponse() {
  const val = (sel) => document.querySelector(sel)?.value?.trim() || "";
  const choiceVal = (key) => document.querySelector(`[data-choice="${key}"]`)?.value || "";
  const lecteurVal = (key) => capitaliseNom(document.querySelector(`[data-lecteur="${key}"]`)?.value?.trim()) || undefined;

  return {
    epoux: capitaliseNom(val("#epoux")),
    epouse: capitaliseNom(val("#epouse")),
    format: document.querySelector("#formatSwatches .format-btn.active")?.dataset.value || "A5",
    date: formatDateFR(val("#date")),
    heure: val("#heure"),
    lieu: val("#lieu"),
    email: val("#email"),
    telephone: val("#telephone"),
    choix: {
      lecture: { id: choiceVal("lecture"), lecteur: lecteurVal("lecture") },
      psaume: { id: choiceVal("psaume"), lecteur: lecteurVal("psaume") },
      evangile: { id: choiceVal("evangile") },
      dialogueInitial: { id: choiceVal("dialogueInitial") },
      consentements: { id: choiceVal("consentements") },
      benedictionAlliances: { id: choiceVal("benedictionAlliances") },
      benedictionNuptiale: { id: choiceVal("benedictionNuptiale") },
      priereEpoux: { id: choiceVal("priereEpoux") },
      priereUniverselle: { id: choiceVal("priereUniverselle"), lecteur: lecteurVal("priereUniverselle") },
      benedictionFinale: { id: choiceVal("benedictionFinale") },
    },
    chants: {
      entree: val('[name="chant_entree"]'),
      entreeParoles: val('[name="chant_entreeParoles"]'),
      acclamation: val('[name="chant_acclamation"]'),
      acclamationParoles: val('[name="chant_acclamationParoles"]'),
      espritSaint: val('[name="chant_espritSaint"]'),
      espritSaintParoles: val('[name="chant_espritSaintParoles"]'),
      louange: val('[name="chant_louange"]'),
      louangeParoles: val('[name="chant_louangeParoles"]'),
      priereUniverselle: val('[name="chant_priereUniverselle"]'),
      priereUniverselleParoles: val('[name="chant_priereUniverselleParoles"]'),
      marie: val('[name="chant_marie"]'),
      marieParoles: val('[name="chant_marieParoles"]'),
      signatureRegistres: val('[name="chant_signatureRegistres"]'),
      signatureRegistresParoles: val('[name="chant_signatureRegistresParoles"]'),
      sortie: val('[name="chant_sortie"]'),
      sortieParoles: val('[name="chant_sortieParoles"]'),
    },
    motsRemerciements: val('[name="motsRemerciements"]') || undefined,
    notesPersonnalisation: val("#notesPersonnalisation") || undefined,
    typeLivraison: document.querySelector("#livraisonSwatches .format-btn.active")?.dataset.value || "pdf",
    typeDemande: document.querySelector("#typeDemandeSwatches .format-btn.active")?.dataset.value || "devis",
    personnalisation: getPersonnalisation(),
  };
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const reponse = buildReponse();
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = "Envoi de votre demande…";

  try {
    const res = await fetch("/api/livrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reponse),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const detailsTexte = Array.isArray(err.details) ? err.details.join(" ") : err.details;
      throw new Error(detailsTexte || err.erreur || "Le serveur n'a pas pu transmettre votre demande.");
    }

    // Pas de PDF renvoyé au demandeur : la demande part à l'équipe d'édition,
    // qui personnalise le livret avant de le transmettre elle-même.
    statusBanner.innerHTML =
      `Merci ${reponse.epoux || ""} &amp; ${reponse.epouse || ""} ! Votre demande a bien été transmise à notre équipe d'édition. ` +
      `Nous vous recontacterons prochainement pour finaliser votre livret.`;
    statusBanner.classList.add("show");
  } catch (err) {
    // Repli : si l'API n'est pas disponible (ex. fichier ouvert directement sans
    // serveur), on permet quand même de récupérer les réponses au format JSON.
    const blob = new Blob([JSON.stringify(reponse, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    statusBanner.innerHTML =
      `Je n'ai pas pu contacter le serveur de génération (${err.message}). ` +
      `<a href="${url}" download="reponses-${(reponse.epoux || "couple").toLowerCase()}.json">Télécharger vos réponses (JSON)</a> ` +
      `en attendant — vous pourrez les renvoyer une fois le serveur démarré.`;
    statusBanner.classList.add("show");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
    statusBanner.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});

updatePreview();
updateProgress();
