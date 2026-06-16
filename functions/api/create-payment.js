// POST /api/create-payment
// Body: { token, sizeKey, quantity, customer:{name,email}, objectKeys:string[], turnstileToken }
// 1. Verifies all uploads landed in R2
// 2. Creates a Square Order with proper line items
// 3. Charges the card against that order
// 4. Sends notification emails via Resend with presigned download links (fire-and-forget)

import { getPrice, CURRENCY } from "../../lib/prices.js";
import { presign } from "../../lib/sigv4.js";

// Confirm/raise against Square's changelog: https://developer.squareup.com/docs/changelog/connect
const SQUARE_VERSION = "2025-06-18";

function bad(message, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function fmt(cents) {
  return "$" + (cents / 100).toFixed(2);
}

async function downloadUrl(env, key) {
  return presign({
    method: "GET",
    host: `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    bucket: env.R2_BUCKET,
    key,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    expires: 7 * 24 * 60 * 60, // 7 days
  });
}

async function sendEmails(env, { price, qty, amount, customer, keys, downloadLinks, receiptUrl, orderId }) {
  if (!env.RESEND_API_KEY) return;

  const from = env.FROM_EMAIL || "noreply@rioscreations.com";
  const replyTo = env.OWNER_EMAIL || undefined;
  const emails = [];

  if (env.OWNER_EMAIL) {
    const fileLines = downloadLinks
      .map(({ key, url }) => `  ${key.split("/").pop()}\n  ${url}`)
      .join("\n\n");

    emails.push({
      from,
      to: env.OWNER_EMAIL,
      subject: `New DTF order: ${price.label} ×${qty} — ${fmt(amount)}`,
      text: [
        `New order received.`,
        ``,
        `Size:     ${price.label}`,
        `Qty:      ${qty}`,
        `Total:    ${fmt(amount)}`,
        `Customer: ${customer?.name || "—"}`,
        `Email:    ${customer?.email || "—"}`,
        `Order ID: ${orderId || "—"}`,
        receiptUrl ? `Receipt:  ${receiptUrl}` : null,
        ``,
        `File${keys.length > 1 ? "s" : ""} (links expire in 7 days):`,
        fileLines,
      ].filter(Boolean).join("\n"),
    });
  }

  if (customer?.email) {
    emails.push({
      from,
      ...(replyTo ? { reply_to: replyTo } : {}),
      to: customer.email,
      subject: `Your DTF order is confirmed — ${price.label} ×${qty}`,
      text: [
        `Hi ${customer.name || "there"},`,
        ``,
        `We've got your order and payment for ${qty}× ${price.label} DTF gang sheet${qty > 1 ? "s" : ""}.`,
        `Total charged: ${fmt(amount)}`,
        ``,
        `We'll print it and let you know when it's ready.`,
        ``,
        receiptUrl ? `View your receipt: ${receiptUrl}` : null,
        ``,
        `— Rio's Custom Creations`,
      ].filter(Boolean).join("\n"),
    });
  }

  await Promise.all(
    emails.map((payload) =>
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })
    )
  );
}

export async function onRequestPost({ request, env, waitUntil }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request.");
  }

  const { token, sizeKey, quantity, customer, objectKeys, turnstileToken } = body || {};
  const qty = Math.max(1, Math.min(99, parseInt(quantity, 10) || 1));
  const keys = Array.isArray(objectKeys) && objectKeys.length > 0 ? objectKeys : [];

  if (!token) return bad("Missing payment token.");
  if (!keys.length) return bad("Missing uploaded file reference.");

  if (env.TURNSTILE_SECRET_KEY) {
    const tv = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: turnstileToken }),
    });
    const td = await tv.json();
    if (!td.success) return bad("Security check failed. Please refresh and try again.", 403);
  }

  const price = getPrice(sizeKey);
  if (!price) return bad("Unknown sheet size.");

  // Confirm every file actually made it to R2 before taking money.
  if (env.BUCKET) {
    for (const key of keys) {
      const obj = await env.BUCKET.head(key);
      if (!obj) return bad(`We couldn't find one of your uploaded files. Please re-upload and try again.`);
    }
  }

  const amount = price.priceCents * qty;
  const base =
    (env.SQUARE_ENV || "sandbox") === "production"
      ? "https://connect.squareup.com"
      : "https://connect.squareupsandbox.com";

  const headers = {
    Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
    "Square-Version": SQUARE_VERSION,
  };

  // Step 1: Create the order so it appears as a proper line-item sale in Square.
  const orderResp = await fetch(`${base}/v2/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      order: {
        location_id: env.SQUARE_LOCATION_ID,
        line_items: [
          {
            name: `DTF Gang Sheet ${price.label}`,
            quantity: String(qty),
            base_price_money: { amount: price.priceCents, currency: CURRENCY },
            note: `File${keys.length > 1 ? "s" : ""}: ${keys.join(", ")}`.slice(0, 500),
          },
        ],
      },
    }),
  });

  const orderData = await orderResp.json();
  if (!orderResp.ok) {
    const msg = orderData?.errors?.[0]?.detail || "Could not create the order.";
    return bad(msg, 402);
  }
  const orderId = orderData.order?.id;

  // Step 2: Charge the card, linking it to the order we just created.
  const payResp = await fetch(`${base}/v2/payments`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      source_id: token,
      location_id: env.SQUARE_LOCATION_ID,
      order_id: orderId,
      amount_money: { amount, currency: CURRENCY },
      buyer_email_address: customer?.email || undefined,
    }),
  });

  const payData = await payResp.json();
  if (!payResp.ok) {
    const msg = payData?.errors?.[0]?.detail || "Payment was declined.";
    return bad(msg, 402);
  }

  const receiptUrl = payData.payment?.receipt_url || null;

  // Step 3: Generate presigned 7-day download links for Mario's email.
  const downloadLinks = await Promise.all(
    keys.map(async (key) => ({ key, url: await downloadUrl(env, key) }))
  );
  // Step 4: Email notifications — waitUntil keeps the function alive after the response is sent.
  waitUntil(sendEmails(env, { price, qty, amount, customer, keys, downloadLinks, receiptUrl, orderId }).catch(() => {}));

  return Response.json({
    ok: true,
    paymentId: payData.payment?.id,
    receiptUrl,
  });
}
