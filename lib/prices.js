// Single source of truth for sheet sizes and pricing.
// Both /api/config (sends these to the browser to render options + show prices)
// and /api/create-payment (recomputes the charge from these, ignoring the client)
// import this file, so a customer can never change the price from the browser.
//
// Edit these to match Rio's real pricing. priceCents is per sheet, in US cents.

export const CURRENCY = "USD";

// Largest single upload you'll accept, in bytes. 500 MB is generous for a
// 22"-wide sheet; raise/lower as needed.
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export const PRICES = [
  { key: "22x12", label: '22" × 12"', widthIn: 22, lengthIn: 12, priceCents: 599 },
  { key: "22x24", label: '22" × 24"', widthIn: 22, lengthIn: 24, priceCents: 1099 },
  { key: "22x36", label: '22" × 36"', widthIn: 22, lengthIn: 36, priceCents: 1599 },
  { key: "22x60", label: '22" × 60"', widthIn: 22, lengthIn: 60, priceCents: 2599 },
  { key: "22x120", label: '22" × 120"', widthIn: 22, lengthIn: 120, priceCents: 4999 },
];

export function getPrice(key) {
  return PRICES.find((p) => p.key === key) || null;
}
