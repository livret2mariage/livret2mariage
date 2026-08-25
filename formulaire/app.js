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
      // On utilise une classe plutôt que style.display : le mode assistant
      // (une section à la fois) gère lui aussi la visibilité des .step, et
      // "hidden-devis" a la priorité (!important) sur l'étape active.
      section.classList.toggle("hidden-devis", estDevis);
      // Un champ "required" dans une section masquée reste malgré tout
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

  // "Un mot pour vos invités" : on masque juste ce bloc précis (le bouton
  // d'envoi, lui, reste toujours visible puisqu'il vit dans la même section).
  const motBlock = document.getElementById("motInvitesBlock");
  if (motBlock) motBlock.style.display = estDevis ? "none" : "";
  const lienNavMot = document.querySelector('nav a[data-section="mot"]');
  if (lienNavMot) lienNavMot.style.display = estDevis ? "none" : "";
  const itemProgresMot = document.querySelector('li[data-section="mot"]');
  if (itemProgresMot) itemProgresMot.style.display = estDevis ? "none" : "";

  // En mode devis, la dernière étape affichait un bloc "Un mot pour vos
  // invités" masqué (donc quasi vide) — on montre à la place un petit
  // récapitulatif des coordonnées avant l'envoi.
  const devisRecapBlock = document.getElementById("devisRecapBlock");
  if (devisRecapBlock) devisRecapBlock.style.display = estDevis ? "" : "none";
  if (estDevis) updateDevisRecap();

  // Le libellé de la dernière étape (pastille de nav + liste de progression)
  // doit refléter son contenu réel, qui change selon le mode.
  const navPillMot = document.getElementById("navPillMot");
  if (navPillMot) navPillMot.textContent = estDevis ? "Ma demande de tarif" : "Un mot pour vos invités";
  const progressItemMot = document.getElementById("progressItemMot");
  if (progressItemMot) progressItemMot.textContent = estDevis ? "Ma demande de tarif" : "Un mot pour vos invités";
  const submitNote = document.getElementById("submitNote");
  if (submitNote) {
    submitNote.textContent = estDevis
      ? "Votre demande sera transmise à notre équipe, qui vous recontactera sous 48h avec un devis adapté à votre mariage."
      : "Votre demande sera transmise à notre équipe d'édition, qui vous recontactera pour finaliser votre livret.";
  }

  const note = document.getElementById("typeDemandeNote");
  if (note) {
    note.textContent = estDevis
      ? "Avec un simple devis, seules vos informations de couple sont nécessaires — les autres sections deviennent facultatives."
      : "Vous allez pouvoir choisir vos lectures, prières, bénédictions et personnaliser votre livret en détail.";
  }

  // Badge de mode persistant (masqué sur l'étape 1 elle-même, voir wizardUpdateChrome).
  const modeBadgeLabel = document.getElementById("modeBadgeLabel");
  if (modeBadgeLabel) {
    modeBadgeLabel.textContent = estDevis ? "Mode : Demande de tarif" : "Mode : Composition du livret";
  }
}

// ---------- 0bis-bis. Récapitulatif affiché en dernière étape (mode devis) ----------
// Reprend les coordonnées déjà saisies dans "Le couple" pour que la dernière
// étape ne semble jamais vide avant l'envoi.
function updateDevisRecap() {
  const box = document.getElementById("devisRecap");
  if (!box) return;

  const champs = [
    ["Époux", capitaliseNom(document.getElementById("epoux")?.value.trim())],
    ["Épouse", capitaliseNom(document.getElementById("epouse")?.value.trim())],
    ["Date", formatDateFR(document.getElementById("date")?.value)],
    ["Heure", document.getElementById("heure")?.value],
    ["Lieu", document.getElementById("lieu")?.value.trim()],
    ["Email", document.getElementById("email")?.value.trim()],
    ["Téléphone", document.getElementById("telephone")?.value.trim()],
  ].filter(([, val]) => val);

  if (champs.length === 0) {
    box.innerHTML = `<p class="devis-recap-empty">Complétez vos informations à l'étape « Le couple » pour les retrouver ici avant l'envoi.</p>`;
    return;
  }

  box.innerHTML = champs
    .map(([label, val]) => `<div class="devis-recap-row"><span class="label">${label}</span><span class="value">${val}</span></div>`)
    .join("");
}

document.querySelectorAll(".form-col input, .form-col select").forEach((el) => {
  el.addEventListener("input", updateDevisRecap);
  el.addEventListener("change", updateDevisRecap);
});

document.querySelectorAll("#typeDemandeSwatches .choice-card").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#typeDemandeSwatches .choice-card").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    appliquerTypeDemande(btn.dataset.value);
    updateProgress();
  });
});

// Mode "devis" actif par défaut au chargement de la page.
appliquerTypeDemande("devis");

// ---------- 0ter. Mode assistant : une section à la fois, navigation
// Suivant / Précédent (+ pastilles cliquables dans la nav du haut). ----------
const WIZARD_STEPS = Array.from(document.querySelectorAll('#livretForm > section.step'));

function wizardVisibleSteps() {
  return WIZARD_STEPS.filter((s) => !s.classList.contains("hidden-devis"));
}

function wizardNextVisible(fromSection) {
  let el = fromSection.nextElementSibling;
  while (el) {
    if (el.matches("section.step") && !el.classList.contains("hidden-devis")) return el;
    el = el.nextElementSibling;
  }
  return null;
}

function wizardPrevVisible(fromSection) {
  let el = fromSection.previousElementSibling;
  while (el) {
    if (el.matches("section.step") && !el.classList.contains("hidden-devis")) return el;
    el = el.previousElementSibling;
  }
  return null;
}

// Valide les champs obligatoires de la section affichée avant de laisser
// passer au "Suivant" — la validation HTML5 native (bulle + focus) suffit,
// pas besoin de réinventer un système de messages d'erreur.
function wizardValidateSection(section) {
  const requiredEls = section.querySelectorAll("[required]");
  for (const el of requiredEls) {
    if (!el.checkValidity()) {
      el.reportValidity();
      return false;
    }
  }
  return true;
}

function wizardGoTo(targetSection) {
  if (!targetSection || targetSection.classList.contains("hidden-devis")) return;
  WIZARD_STEPS.forEach((s) => s.classList.remove("active"));
  targetSection.classList.add("active");
  wizardUpdateChrome(targetSection);
  // Remonte en haut du formulaire à chaque changement d'étape (utile en
  // particulier sur mobile, où la section précédente peut être plus longue
  // que la nouvelle).
  document.querySelector(".form-col")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function wizardUpdateChrome(activeSection) {
  const visible = wizardVisibleSteps();
  const index = visible.indexOf(activeSection);

  document.querySelectorAll(".section-nav a").forEach((a) => {
    const section = document.querySelector(`section[data-section="${a.dataset.section}"]`);
    const isHidden = !section || section.classList.contains("hidden-devis");
    a.style.display = isHidden ? "none" : "";
    a.classList.toggle("current", section === activeSection);
  });

  const counter = document.getElementById("stepCounter");
  if (counter && index >= 0) counter.textContent = `Étape ${index + 1} sur ${visible.length}`;

  const fill = document.getElementById("stepProgressBarFill");
  if (fill && visible.length > 0) fill.style.width = `${((index + 1) / visible.length) * 100}%`;

  // Le badge de mode est redondant sur l'étape "Type de demande" elle-même
  // (le choix y est déjà affiché en grand) — on ne l'affiche qu'ensuite.
  const modeBadge = document.getElementById("modeBadge");
  if (modeBadge) modeBadge.classList.toggle("show", activeSection?.dataset.section !== "type-demande");

  updateMobileStepBar(activeSection);
}

// ---------- Barre flottante Suivant / Précédent (mobile uniquement) ----------
// Reflète toujours l'étape active, pour ne pas avoir à scroller jusqu'en bas
// d'une longue section (Prières & bénédictions, Chants...) juste pour avancer.
function updateMobileStepBar(activeSection) {
  const prevBtn = document.getElementById("mobileStepPrev");
  const nextBtn = document.getElementById("mobileStepNext");
  if (!prevBtn || !nextBtn) return;

  prevBtn.classList.toggle("is-hidden", !wizardPrevVisible(activeSection));

  if (wizardNextVisible(activeSection)) {
    nextBtn.textContent = "Suivant →";
    nextBtn.dataset.mode = "next";
  } else {
    // Dernière étape visible : la barre flottante déclenche directement l'envoi.
    nextBtn.textContent = "Envoyer ma demande";
    nextBtn.dataset.mode = "submit";
  }
}

document.getElementById("mobileStepPrev")?.addEventListener("click", () => {
  const current = WIZARD_STEPS.find((s) => s.classList.contains("active"));
  wizardGoTo(wizardPrevVisible(current));
});

document.getElementById("mobileStepNext")?.addEventListener("click", () => {
  const current = WIZARD_STEPS.find((s) => s.classList.contains("active"));
  if (!wizardValidateSection(current)) return;
  if (document.getElementById("mobileStepNext").dataset.mode === "submit") {
    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true }));
  } else {
    wizardGoTo(wizardNextVisible(current));
  }
});

document.querySelectorAll(".step-next").forEach((btn) => {
  btn.addEventListener("click", () => {
    const current = btn.closest("section.step");
    if (!wizardValidateSection(current)) return;
    wizardGoTo(wizardNextVisible(current));
  });
});

document.querySelectorAll(".step-prev").forEach((btn) => {
  btn.addEventListener("click", () => {
    const current = btn.closest("section.step");
    wizardGoTo(wizardPrevVisible(current));
  });
});

// Pastilles de la nav du haut : accès direct à n'importe quelle étape déjà
// atteignable (elle doit exister et ne pas être masquée par le mode devis).
document.querySelectorAll(".section-nav a").forEach((a) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    const target = document.querySelector(`section[data-section="${a.dataset.section}"]`);
    wizardGoTo(target);
  });
});

// Lien "Changer" du badge de mode : ramène directement à l'étape 1 pour
// basculer devis ↔ conception sans perdre les champs déjà remplis.
document.getElementById("modeBadgeChange")?.addEventListener("click", (e) => {
  e.preventDefault();
  wizardGoTo(document.querySelector('section[data-section="type-demande"]'));
});

// Si le passage en mode "devis rapide" masque l'étape actuellement affichée,
// on bascule automatiquement sur la première étape encore visible.
const wizardObserver = new MutationObserver(() => {
  const active = WIZARD_STEPS.find((s) => s.classList.contains("active"));
  if (!active || active.classList.contains("hidden-devis")) {
    wizardGoTo(wizardVisibleSteps()[0]);
  } else {
    wizardUpdateChrome(active);
  }
});
WIZARD_STEPS.forEach((s) => wizardObserver.observe(s, { attributes: true, attributeFilter: ["class"] }));

// Première étape affichée au chargement.
wizardGoTo(WIZARD_STEPS[0]);

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

// ---------- 3bis. Validation en direct (coche verte discrète) ----------
// Dès qu'un champ est rempli correctement, son libellé affiche une petite
// coche — sans attendre le clic sur "Suivant" pour le savoir.
function updateFieldValidity(el) {
  const field = el.closest(".field");
  if (!field) return;
  const valide = el.checkValidity() && !!el.value && el.value.trim() !== "";
  field.classList.toggle("is-valid", valide);
}

function refreshAllFieldValidity() {
  document.querySelectorAll(".field input, .field select, .field textarea").forEach(updateFieldValidity);
}

document.querySelectorAll(".field input, .field select, .field textarea").forEach((el) => {
  el.addEventListener("input", () => updateFieldValidity(el));
  el.addEventListener("change", () => updateFieldValidity(el));
});
refreshAllFieldValidity();

// ---------- 4. Construction du JSON de réponse + envoi ----------
const form = document.getElementById("livretForm");
const statusBanner = document.getElementById("statusBanner");

// ---------- 4bis. Sauvegarde automatique du brouillon (localStorage) ----------
// Si le couple ferme l'onglet ou remplit le formulaire sur plusieurs soirs,
// il retrouve ses réponses en revenant — sans compte ni connexion nécessaire.
const DRAFT_KEY = "livret2mariage_brouillon_v1";

function collecterBrouillon() {
  const brouillon = { champs: {}, choix: {}, lecteurs: {}, groupes: {} };

  form.querySelectorAll("[name]").forEach((el) => {
    if (el.name) brouillon.champs[el.name] = el.value;
  });
  form.querySelectorAll("select[data-choice]").forEach((el) => {
    brouillon.choix[el.dataset.choice] = el.value;
  });
  form.querySelectorAll("[data-lecteur]").forEach((el) => {
    brouillon.lecteurs[el.dataset.lecteur] = el.value;
  });
  // Groupes de boutons (type de demande, format, teinte, livraison...) :
  // chacun porte un data-name sur son conteneur et un data-value sur le
  // bouton actif — on ne retient que le choix sélectionné.
  form.querySelectorAll("[data-name]").forEach((groupe) => {
    const actif = groupe.querySelector(".active");
    if (actif?.dataset.value) brouillon.groupes[groupe.dataset.name] = actif.dataset.value;
  });

  return brouillon;
}

function sauvegarderBrouillon() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(collecterBrouillon()));
  } catch (e) {
    // Stockage indisponible (navigation privée, quota dépassé...) : on continue
    // sans bloquer le remplissage, la sauvegarde est un confort, pas un prérequis.
  }
}

function effacerBrouillon() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch (e) {
    /* rien à faire */
  }
}

function restaurerBrouillon() {
  let brouillon;
  try {
    const brut = localStorage.getItem(DRAFT_KEY);
    if (!brut) return false;
    brouillon = JSON.parse(brut);
  } catch (e) {
    return false;
  }
  if (!brouillon) return false;

  Object.entries(brouillon.champs || {}).forEach(([nom, val]) => {
    const el = form.querySelector(`[name="${nom}"]`);
    if (el && val) el.value = val;
  });
  Object.entries(brouillon.lecteurs || {}).forEach(([cle, val]) => {
    const el = form.querySelector(`[data-lecteur="${cle}"]`);
    if (el && val) el.value = val;
  });
  Object.entries(brouillon.choix || {}).forEach(([cle, val]) => {
    const el = form.querySelector(`select[data-choice="${cle}"]`);
    if (el && val) {
      el.value = val;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  // On simule un clic sur le bouton déjà actif dans le brouillon plutôt que de
  // recopier la classe "active" à la main : ça réutilise directement toute la
  // logique déjà branchée sur ces boutons (masquage des sections en mode
  // devis, aperçu couverture, etc.) sans la dupliquer ici.
  Object.entries(brouillon.groupes || {}).forEach(([nom, val]) => {
    const groupe = form.querySelector(`[data-name="${nom}"]`);
    const bouton = groupe?.querySelector(`[data-value="${val}"]`);
    if (bouton) bouton.click();
  });

  return true;
}

// Sauvegarde à chaque frappe/changement, légèrement différée pour ne pas
// écrire dans localStorage à chaque caractère tapé.
let brouillonTimeout = null;
function planifierSauvegardeBrouillon() {
  clearTimeout(brouillonTimeout);
  brouillonTimeout = setTimeout(sauvegarderBrouillon, 400);
}
form.addEventListener("input", planifierSauvegardeBrouillon);
form.addEventListener("change", planifierSauvegardeBrouillon);
form.querySelectorAll("[data-name] button").forEach((btn) => {
  btn.addEventListener("click", planifierSauvegardeBrouillon);
});

// Restauration silencieuse au chargement (pas de bandeau intrusif — comme le
// ferait un traitement de texte classique en rouvrant un fichier).
if (restaurerBrouillon()) {
  updatePreview();
  updateProgress();
  updateDevisRecap();
  refreshAllApercus();
  refreshAllFieldValidity();
}

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
    typeDemande: document.querySelector("#typeDemandeSwatches .choice-card.active")?.dataset.value || "devis",
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
    // qui personnalise le livret avant de le transmettre elle-même. Le
    // message final diffère selon le mode : une simple demande de tarif
    // n'a pas encore de "livret à finaliser" à ce stade.
    const messageSuite = reponse.typeDemande === "devis"
      ? "Nous vous recontacterons sous 48h avec un devis adapté à votre mariage."
      : "Nous vous recontacterons prochainement pour finaliser votre livret.";
    statusBanner.innerHTML =
      `Merci ${reponse.epoux || ""} &amp; ${reponse.epouse || ""} ! Votre demande a bien été transmise à notre équipe. ` +
      messageSuite;
    statusBanner.classList.add("show");
    // La demande est partie avec succès : plus besoin du brouillon local.
    effacerBrouillon();
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
