// Single source of truth for sheet sizes and pricing.
// variationId is the stable key used by both client and server — when switching to
// Square Catalog, replace these static IDs with real catalog variation IDs and the
// rest of the code stays identical.

export const CURRENCY = "USD";
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export const PRICES = [
  { variationId: "dtf-22x12",  label: "22 x 12",  widthIn: 22, lengthIn: 12,  priceCents: 599  },
  { variationId: "dtf-22x24",  label: "22 x 24",  widthIn: 22, lengthIn: 24,  priceCents: 1099 },
  { variationId: "dtf-22x36",  label: "22 x 36",  widthIn: 22, lengthIn: 36,  priceCents: 1599 },
  { variationId: "dtf-22x60",  label: "22 x 60",  widthIn: 22, lengthIn: 60,  priceCents: 2599 },
  { variationId: "dtf-22x120", label: "22 x 120", widthIn: 22, lengthIn: 120, priceCents: 4999 },
];

export function getPrice(variationId) {
  return PRICES.find((p) => p.variationId === variationId) || null;
}
