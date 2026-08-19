const https = require("https");
const crypto = require("crypto");

const PRIX_CENTIMES = 2900; // 29,00 €

/**
 * Envoie une requête à l'API Stripe (format x-www-form-urlencoded, comme
 * l'exige leur API — même pour des paramètres imbriqués comme line_items).
 */
function requeteStripe(path, params, apiKey) {
  const corps = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.stripe.com",
        path,
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(corps),
        },
        timeout: 15000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
            else reject(new Error(json.error?.message || `Erreur Stripe (${res.statusCode})`));
          } catch (e) {
            reject(new Error("Réponse Stripe illisible : " + data.slice(0, 200)));
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Délai dépassé en contactant Stripe."));
    });
    req.on("error", reject);
    req.write(corps);
    req.end();
  });
}

/**
 * Crée une session de paiement Stripe Checkout pour un livret (29 €, paiement
 * unique). `reponseId` est une référence courte vers les réponses complètes du
 * couple, stockées côté serveur (voir server.js) — Stripe ne reçoit que cette
 * référence, jamais le contenu complet du formulaire.
 */
async function creerSessionPaiement({ reponseId, epoux, epouse, email, siteUrl }) {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    throw new Error("Paiement non configuré (STRIPE_SECRET_KEY manquante).");
  }

  const params = {
    mode: "payment",
    "success_url": `${siteUrl}/paiement/succes?session_id={CHECKOUT_SESSION_ID}`,
    "cancel_url": `${siteUrl}/paiement/annule`,
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(PRIX_CENTIMES),
    "line_items[0][price_data][product_data][name]": `Livret de mariage — ${epoux} & ${epouse}`,
    "line_items[0][quantity]": "1",
    "client_reference_id": reponseId,
    "metadata[reponseId]": reponseId,
  };
  if (email) params.customer_email = email;

  const session = await requeteStripe("/v1/checkout/sessions", params, apiKey);
  return session.url;
}

/**
 * Vérifie qu'un événement webhook provient bien de Stripe (signature HMAC),
 * en suivant leur algorithme officiel. `payload` doit être le corps BRUT de
 * la requête (avant tout JSON.parse), sinon la signature ne correspondra pas.
 */
function verifierSignatureWebhook(payload, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const parties = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.split("="))
  );
  const timestamp = parties.t;
  const signatureAttendue = parties.v1;
  if (!timestamp || !signatureAttendue) return false;

  const payloadSigne = `${timestamp}.${payload}`;
  const signatureCalculee = crypto
    .createHmac("sha256", secret)
    .update(payloadSigne, "utf8")
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureCalculee, "hex"),
      Buffer.from(signatureAttendue, "hex")
    );
  } catch (e) {
    return false; // longueurs différentes, etc.
  }
}

module.exports = { creerSessionPaiement, verifierSignatureWebhook, PRIX_CENTIMES };
