// POST /api/create-payment
// Body: { token, cartItems:[{variationId,qty,description,objectKey}], customer:{name,email}, turnstileToken }
// 1. Verifies every uploaded file landed in R2
// 2. Creates a Square Order with one line item per cart entry (price from server, never client)
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

async function makeDownloadUrl(env, key) {
  return presign({
    method: "GET",
    host: `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    bucket: env.R2_BUCKET,
    key,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    expires: 7 * 24 * 60 * 60,
  });
}

async function sendEmails(env, { enrichedItems, amount, customer, receiptUrl, orderId }) {
  if (!env.RESEND_API_KEY) return;

  const from = env.FROM_EMAIL || "noreply@rioscreations.com";
  const replyTo = env.OWNER_EMAIL || undefined;
  const emails = [];

  if (env.OWNER_EMAIL) {
    const itemLines = enrichedItems.map((item) => [
      `  ${item.label} ×${item.qty} — ${fmt(item.priceCents * item.qty)}`,
      item.description ? `  "${item.description}"` : null,
      `  File: ${item.objectKey.split("/").pop()}`,
      `  ↓ ${item.downloadUrl}`,
    ].filter(Boolean).join("\n")).join("\n\n");

    emails.push({
      from,
      to: env.OWNER_EMAIL,
      subject: `New DTF order — ${fmt(amount)} (${enrichedItems.length} transfer${enrichedItems.length > 1 ? "s" : ""})`,
      text: [
        "New order received.",
        "",
        itemLines,
        "",
        `Total:    ${fmt(amount)}`,
        `Customer: ${customer?.name || "—"}`,
        `Email:    ${customer?.email || "—"}`,
        `Order ID: ${orderId || "—"}`,
        receiptUrl ? `Receipt:  ${receiptUrl}` : null,
        "",
        "Download links expire in 7 days.",
      ].filter(Boolean).join("\n"),
    });
  }

  if (customer?.email) {
    const itemLines = enrichedItems.map((item) => [
      `  ${item.label} ×${item.qty} — ${fmt(item.priceCents * item.qty)}`,
      item.description ? `  ${item.description}` : null,
    ].filter(Boolean).join("\n")).join("\n\n");

    emails.push({
      from,
      ...(replyTo ? { reply_to: replyTo } : {}),
      to: customer.email,
      subject: `Your DTF order is confirmed — ${fmt(amount)}`,
      text: [
        `Hi ${customer.name || "there"},`,
        "",
        "Your order is confirmed:",
        "",
        itemLines,
        "",
        `Total charged: ${fmt(amount)}`,
        "",
        "We'll print these and let you know when they're ready.",
        "",
        receiptUrl ? `View your receipt: ${receiptUrl}` : null,
        "",
        "— Rio's Custom Creations",
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

  const { token, cartItems, customer, turnstileToken } = body || {};

  if (!token) return bad("Missing payment token.");
  if (!Array.isArray(cartItems) || cartItems.length === 0) return bad("Cart is empty.");

  if (env.TURNSTILE_SECRET_KEY) {
    const tv = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: turnstileToken }),
    });
    const td = await tv.json();
    if (!td.success) return bad("Security check failed. Please refresh and try again.", 403);
  }

  // Validate every cart item against the server-side price table.
  const enrichedItems = [];
  for (const item of cartItems) {
    const price = getPrice(item.variationId);
    if (!price) return bad("Unknown sheet size in cart.");
    if (!item.objectKey) return bad("Missing file for one of your transfers.");
    const qty = Math.max(1, Math.min(99, parseInt(item.qty, 10) || 1));
    enrichedItems.push({
      ...price,
      qty,
      description: item.description?.trim() || null,
      objectKey: item.objectKey,
    });
  }

  // Confirm every file actually made it to R2 before taking money.
  if (env.BUCKET) {
    for (const item of enrichedItems) {
      const obj = await env.BUCKET.head(item.objectKey);
      if (!obj) return bad("We couldn't find one of your uploaded files. Please re-upload and try again.");
    }
  }

  const amount = enrichedItems.reduce((sum, i) => sum + i.priceCents * i.qty, 0);
  const base =
    (env.SQUARE_ENV || "sandbox") === "production"
      ? "https://connect.squareup.com"
      : "https://connect.squareupsandbox.com";

  const headers = {
    Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
    "Square-Version": SQUARE_VERSION,
  };

  // Step 1: Create the order with one line item per transfer.
  const orderResp = await fetch(`${base}/v2/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      order: {
        location_id: env.SQUARE_LOCATION_ID,
        line_items: enrichedItems.map((item) => ({
          name: item.label,
          quantity: String(item.qty),
          base_price_money: { amount: item.priceCents, currency: CURRENCY },
          note: [item.description, `File: ${item.objectKey}`]
            .filter(Boolean).join(" | ").slice(0, 500),
        })),
      },
    }),
  });

  const orderData = await orderResp.json();
  if (!orderResp.ok) {
    const msg = orderData?.errors?.[0]?.detail || "Could not create the order.";
    return bad(msg, 402);
  }
  const orderId = orderData.order?.id;

  // Step 2: Charge the card, linking it to the order.
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
  const enrichedWithLinks = await Promise.all(
    enrichedItems.map(async (item) => ({
      ...item,
      downloadUrl: await makeDownloadUrl(env, item.objectKey),
    }))
  );

  // Step 4: Email notifications — waitUntil keeps the function alive after the response is sent.
  waitUntil(
    sendEmails(env, { enrichedItems: enrichedWithLinks, amount, customer, receiptUrl, orderId }).catch(() => {})
  );

  return Response.json({
    ok: true,
    paymentId: payData.payment?.id,
    receiptUrl,
  });
}
