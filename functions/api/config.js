// GET /api/config
// Returns the publishable Square identifiers (safe to expose) plus the price
// table and limits, so the browser renders the same options the server enforces.

import { PRICES, CURRENCY, MAX_UPLOAD_BYTES } from "../../lib/prices.js";

export function onRequestGet({ env }) {
  return Response.json({
    squareAppId: env.SQUARE_APP_ID,
    squareLocationId: env.SQUARE_LOCATION_ID,
    squareEnv: env.SQUARE_ENV || "sandbox", // "sandbox" | "production"
    prices: PRICES,
    currency: CURRENCY,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    maxGangsheetsPerOrder: Math.max(1, parseInt(env.MAX_GANGSHEETS_PER_ORDER, 10) || 5),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
  });
}
