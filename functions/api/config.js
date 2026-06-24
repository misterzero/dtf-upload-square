// GET /api/config
// Returns the publishable Square identifiers plus the price table and limits,
// so the browser renders the same options the server enforces.

import { CURRENCY, MAX_UPLOAD_BYTES } from "../../lib/prices.js";
import { fetchPrices } from "../../lib/catalog.js";

export async function onRequestGet({ env }) {
  return Response.json({
    squareAppId: env.SQUARE_APP_ID,
    squareLocationId: env.SQUARE_LOCATION_ID,
    squareEnv: env.SQUARE_ENV || "sandbox",
    prices: await fetchPrices(env),
    currency: CURRENCY,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
  });
}
