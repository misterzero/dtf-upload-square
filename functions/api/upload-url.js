// POST /api/upload-url
// Body: { filename, contentType, size }
// Returns: { url, key }  — a presigned R2 PUT URL the browser uploads to directly.

import { presign } from "../../lib/sigv4.js";
import { MAX_UPLOAD_BYTES } from "../../lib/prices.js";

function bad(message, status = 400) {
  return Response.json({ error: message }, { status });
}

function safeName(name) {
  return (name || "upload.png")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-80);
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request.");
  }

  const { filename, contentType, size } = body || {};

  if (typeof contentType === "string" && contentType && contentType !== "image/png") {
    return bad("Only PNG files are accepted.");
  }
  if (typeof size === "number" && size > MAX_UPLOAD_BYTES) {
    return bad("File is larger than the maximum allowed size.");
  }

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const id = crypto.randomUUID();
  const key = `gangsheets/${yyyy}/${mm}/${id}__${safeName(filename)}`;

  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  const url = await presign({
    method: "PUT",
    host,
    bucket: env.R2_BUCKET,
    key,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    expires: 600,
  });

  return Response.json({ url, key });
}
