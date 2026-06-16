// Minimal AWS Signature V4 *presigner* for Cloudflare R2's S3-compatible API.
// Uses only Web Crypto (available in Workers / Pages Functions) — no npm deps,
// so the whole project deploys with zero build step.
//
// Produces a presigned URL the browser can PUT a file to directly, which means
// large gang-sheet files never pass through a Function (no request-size limit).

const enc = new TextEncoder();

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256hex(str) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(str)));
}

async function hmac(key, str) {
  const k = await crypto.subtle.importKey(
    "raw",
    key instanceof Uint8Array ? key : enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(str)));
}

// RFC3986 encoding (encodeURIComponent leaves a few chars AWS wants encoded).
function uriEncode(str, encodeSlash = true) {
  let out = encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
  if (!encodeSlash) out = out.replace(/%2F/g, "/");
  return out;
}

/**
 * Build a presigned URL.
 * @param {object} o
 * @param {string} o.method        e.g. "PUT"
 * @param {string} o.host          e.g. "<accountid>.r2.cloudflarestorage.com"
 * @param {string} o.key           object key (may contain "/")
 * @param {string} o.bucket        R2 bucket name
 * @param {string} o.accessKeyId
 * @param {string} o.secretAccessKey
 * @param {number} [o.expires]     seconds (default 600)
 * @param {string} [o.region]      "auto" for R2
 * @returns {Promise<string>}
 */
export async function presign({
  method,
  host,
  key,
  bucket,
  accessKeyId,
  secretAccessKey,
  expires = 600,
  region = "auto",
}) {
  const service = "s3";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;

  const canonicalUri = "/" + uriEncode(bucket, false) + "/" + uriEncode(key, false);

  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(params[k])}`)
    .join("&");

  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmac("AWS4" + secretAccessKey, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
