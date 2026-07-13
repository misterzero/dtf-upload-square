// Fetches DTF Print sizes/prices live from the Square Catalog item identified by
// env.SQUARE_CATALOG_ITEM_ID, so Square is the single source of truth for pricing.
// Variation names in Square must be "<width>x<length>", e.g. "22x12".

const SQUARE_VERSION = "2025-06-18";

export async function fetchPrices(env) {
  const base =
    (env.SQUARE_ENV || "sandbox") === "production"
      ? "https://connect.squareup.com"
      : "https://connect.squareupsandbox.com";

  const resp = await fetch(`${base}/v2/catalog/object/${env.SQUARE_CATALOG_ITEM_ID}`, {
    headers: {
      Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      "Square-Version": SQUARE_VERSION,
    },
  });
  if (!resp.ok) throw new Error("Could not load catalog prices from Square.");
  const data = await resp.json();

  return data.object.item_data.variations.map((v) => {
    const name = v.item_variation_data.name;
    const dims = name.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/i);
    return {
      variationId: v.id,
      label: dims ? `${dims[1]} x ${dims[2]}` : name,
      widthIn: dims ? Number(dims[1]) : 0,
      lengthIn: dims ? Number(dims[2]) : 0,
      priceCents: v.item_variation_data.price_money.amount,
    };
  });
}
