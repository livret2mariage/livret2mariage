# Livret2Mariage — Service de génération de livret de mariage

## Structure
- `data/textes.json` — base complète : 17 lectures, 7 psaumes, 10 évangiles, 2 dialogues
  initiaux, 4 formules de consentements, 4 bénédictions des alliances, 6 bénédictions
  nuptiales, 3 prières des époux, 5 prières universelles, 6 bénédictions finales,
  + éléments fixes (salutation, prière d'ouverture, invitation aux consentements,
  réception, remise des alliances, Notre Père).
- `moteur/assembler.js` + `moteur/utils.js` — assemblent le HTML du livret à partir
  des réponses du couple + de la base de textes.
- `template/style.css` + `template/border.png` — mise en page du PDF final (bordure
  florale, pagination adaptative).
- `generate.js` — génère un PDF en local depuis un fichier JSON de réponses
  (`node generate.js data/reponse-couple-exemple.json`), utile pour tester le moteur
  seul sans lancer le serveur.
- `formulaire/` — le formulaire web (voir plus bas).
- `backend/` — l'API qui relie le formulaire au moteur de génération (voir plus bas).

## Ajouter un nouveau texte au choix
Ouvrir `data/textes.json`, ajouter une entrée dans le tableau de la bonne catégorie
avec un `id` unique. Le formulaire et l'API le proposeront automatiquement — rien
d'autre à modifier.

## Backend (backend/)
API en Node.js natif (aucune dépendance à installer à part Playwright — pas besoin
d'Express) :
- `GET /` et fichiers statiques → sert le formulaire (`formulaire/index.html`, `app.js`,
  `border.png`) : le backend et le formulaire peuvent être déployés comme un seul service.
- `GET /api/textes/choix` → les listes déroulantes du formulaire, générées à la volée
  depuis `data/textes.json`.
- `POST /api/livrets` → reçoit les réponses du couple (JSON), les valide, assemble le
  livret, complète avec des pages blanches si besoin (impression en livret 4 pages/feuille),
  renvoie le PDF en téléchargement, et l'envoie aussi par email si configuré (voir plus bas).
- `GET /api/health` → vérification simple que le serveur tourne.

### Envoi automatique par email (backend/email.js)
Utilise l'API de [Resend](https://resend.com) (gratuit jusqu'à 100 emails/jour, sans carte
bancaire). Pour l'activer, définir deux variables d'environnement avant de lancer le
serveur :
```
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_FROM_EMAIL="Livret2Mariage <livret@tondomaine.fr>"
```
1. Créer un compte gratuit sur [resend.com](https://resend.com).
2. Vérifier un domaine dans Resend (ou utiliser leur domaine de test `onboarding@resend.dev`
   pour les premiers essais, avant d'avoir son propre domaine).
3. Récupérer une clé API dans le tableau de bord Resend → la mettre dans `RESEND_API_KEY`.
4. Renseigner l'adresse d'expédition vérifiée dans `RESEND_FROM_EMAIL`.

Sans ces deux variables, le service fonctionne normalement mais n'envoie pas d'email — le
PDF reste téléchargeable directement depuis le formulaire (comportement de repli
automatique, rien à changer dans le code).

### Lancer en local
```
cd backend
npm install
RESEND_API_KEY=... RESEND_FROM_EMAIL=... node server.js   # ou sans ces variables, sans l'envoi email
```
Puis ouvrir http://localhost:3000 — le formulaire est servi directement, et "Envoyer mes
choix" appelle l'API, télécharge le PDF généré, et l'envoie par email si configuré.

### Déployer gratuitement
Render (render.com, plan gratuit) convient bien : c'est un vrai serveur Node qui reste
allumé (contrairement aux fonctions serverless de Vercel, mal adaptées à Playwright à
cause de sa taille). Étapes :
1. Pousser ce dossier sur un dépôt Git (GitHub/GitLab).
2. Sur Render : "New Web Service" → connecter le dépôt → Root Directory: `backend`.
3. Build Command: `npm install` — Start Command: `node server.js`.
4. Dans l'onglet "Environment" de Render, ajouter `RESEND_API_KEY` et `RESEND_FROM_EMAIL`
   pour activer l'envoi automatique par email.
5. Le plan gratuit se met en veille après inactivité (redémarre en ~30s à la première
   requête) : très bien adapté à un usage ponctuel comme des demandes de livrets.

## Formulaire (formulaire/)
- `formulaire/index.html` + `formulaire/app.js` + `formulaire/border.png` — formulaire
  complet : sections dans l'ordre liturgique, menus déroulants avec aperçu du texte,
  prévisualisation live de la couverture (personnalisable : présentation, teinte,
  police), suivi de progression.
- À la soumission, le formulaire appelle `POST /api/livrets` et déclenche le
  téléchargement du PDF généré. Si le backend n'est pas joignable (ex. fichier ouvert
  directement sans serveur), il propose en repli de télécharger les réponses en JSON.
- Un fichier autonome (`formulaire_livret_mariage.html`, avec `app.js` intégré) permet
  de tester le formulaire seul, sans backend — utile pour l'aperçu de couverture, mais
  la génération de PDF nécessite que le backend tourne.

## Prochaine étape
Envoi automatique du PDF généré par email au couple (Resend ou Brevo, comptes
gratuits) — actuellement le PDF est téléchargé par le navigateur, l'envoi par email
n'est pas encore branché.
