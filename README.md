# Rio's Custom Creations — DTF gang sheet upload & pay

A single-page, zero-build upload-and-pay flow for selling DTF transfer prints.
Customers configure one or more transfers (size, quantity, optional description),
upload each finished PNG **straight to Cloudflare R2**, add it to a cart, and pay
once for the whole order through **Square** — the Pay button stays locked until
the cart has at least one item, so you never get an order without artwork.

```
index.html                  the customer page (static)
functions/api/config.js      GET  — sends Square IDs + price table to the browser
functions/api/upload-url.js  POST — returns a presigned R2 PUT URL
functions/api/create-payment.js POST — verifies the upload, recomputes price, charges Square
lib/prices.js                your sizes + prices (edit this)
lib/sigv4.js                 presigner (no dependencies)
```

There is **no build step** — Cloudflare Pages serves `index.html` and runs the
files in `functions/` automatically.

---

## 1. Cloudflare R2

1. Create an R2 bucket, e.g. `rio-gangsheets`.
2. **R2 → Manage API Tokens** → create an **Account API token** with
   *Object Read & Write* on that bucket. Note the **Access Key ID** and
   **Secret Access Key**. Your **Account ID** is on the R2 overview page.
3. Add a **CORS policy** to the bucket (Settings → CORS) so the browser can PUT
   to it. Replace the origin with your real domain:

   ```json
   [
     {
       "AllowedOrigins": ["https://order.riocustomcreations.com"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   (Add `http://localhost:8788` while testing locally.)

## 2. Square

1. At **developer.squareup.com**, open your application. Grab the
   **Application ID** and a **Location ID** (Sandbox set first, Production later).
2. Get an **Access Token** (Sandbox token for testing; Production token for go-live).
3. Test with [Square's sandbox test cards](https://developer.squareup.com/docs/devtools/sandbox/payments)
   (e.g. `4111 1111 1111 1111`, any future expiry, any CVV/ZIP).

## 3. Deploy on Cloudflare Pages

1. Push this folder to a Git repo and connect it in **Pages**, or run
   `npx wrangler pages deploy .` from the project root.
2. **Build command:** none. **Build output directory:** `/` (the root).
3. **Settings → Functions → R2 bucket bindings:** bind your bucket to the
   variable name **`BUCKET`** (used to confirm the file landed before charging).
4. **Settings → Environment variables** — add these (mark the tokens/secrets as
   *encrypted*):

   | Variable | Value |
   |---|---|
   | `R2_ACCOUNT_ID` | your Cloudflare account ID |
   | `R2_BUCKET` | `rio-gangsheets` |
   | `R2_ACCESS_KEY_ID` | R2 token access key |
   | `R2_SECRET_ACCESS_KEY` | R2 token secret |
   | `SQUARE_APP_ID` | Square application ID |
   | `SQUARE_LOCATION_ID` | Square location ID |
   | `SQUARE_ACCESS_TOKEN` | Square access token |
   | `SQUARE_ENV` | `sandbox` or `production` |
   | `SQUARE_CATALOG_CATEGORY_ID` | ID of the Square catalog category containing DTF gang sheet items |
   | `RESEND_API_KEY` | Resend API key (from resend.com) |
   | `FROM_EMAIL` | Sender address (must be verified in Resend) |
   | `OWNER_EMAIL` | Mario's email — gets a new-order alert on every sale |
   | `TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key (public) |
   | `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key (encrypted) |

5. Add your custom domain (e.g. `order.riocustomcreations.com`) and update the
   R2 CORS origin to match.

## 4. Put it on the Square site

The page lives on its own subdomain. On the Square Online site, link to it from a
button/menu item, or embed it in an iframe via Square's embed-code block
(paid Online plans). The subdomain keeps payments and R2 fully under your control.

---

## Editing prices

Everything pricing lives in `lib/prices.js`. Both the browser and the server read
from it, so the displayed price and the charged price can never drift apart, and a
customer can't change the amount from the browser. Edit `label` / `priceCents` /
`lengthIn` and redeploy.

## Where the files go

Uploads land in R2 under `gangsheets/YYYY/MM/<uuid>__<filename>.png`. Each cart
item becomes its own Square order line item, with the file key (and optional
description) written into that line item's **note**, so each line in your Square
dashboard tells you which file to print. Mario's owner-notification email also
includes a presigned download link per file (expires after 7 days). To pull files
directly, use the R2 dashboard, `rclone`, or the Wrangler CLI
(`npx wrangler r2 object get ...`). R2's free tier covers this comfortably and has
**no egress fees**, so downloading originals is free. Delete files after printing
to keep storage near zero.

## Local development

Copy `.dev.vars.example` to `.dev.vars` and fill in your real sandbox credentials, then:

```
npx wrangler pages dev .
```

Open `http://localhost:8788`. The page hits live R2 (for uploads) and Square Sandbox (for payments).
Test cards: `4111 1111 1111 1111`, any future expiry, any CVV/ZIP.

The R2 BUCKET binding (used to verify uploads before charging) isn't available in local dev, so
the pre-charge file-check is skipped locally. Everything else behaves the same as production.

## Notes

- Confirm `SQUARE_VERSION` in `create-payment.js` against Square's changelog and bump it.
- The page accepts PNG up to the limit in `lib/prices.js` (`MAX_UPLOAD_BYTES`, default 500 MB).
- Resend requires the `FROM_EMAIL` domain to be verified in your Resend account. If `RESEND_API_KEY`
  is absent, emails are silently skipped and the order still completes.
- Turnstile keys come from dash.cloudflare.com → Turnstile → Add widget. Use the test keys in
  `.dev.vars.example` locally (always pass, no account needed). If `TURNSTILE_SECRET_KEY` is absent,
  the server-side check is skipped — set both keys together.
- Each sale creates a Square Order with one line item per cart transfer before charging, so
  Mario's dashboard shows size, quantity, description, and the R2 file key per transaction.
- `SQUARE_CATALOG_CATEGORY_ID` is reserved for a future switch to Square Catalog-driven pricing;
  it isn't read by any code yet — `lib/prices.js` is still the static source of truth.
