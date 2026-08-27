const encoder = new TextEncoder();

const PADDLE_ENVIRONMENTS = {
  sandbox: {
    apiBase: "https://sandbox-api.paddle.com",
    allowedPriceId: "pri_01kzpvxxkptgamwp74h1g2wbqv",
    apiKeySecretName: "PADDLE_API_KEY",
    webhookSecretName: "PADDLE_WEBHOOK_SECRET"
  },
  production: {
    apiBase: "https://api.paddle.com",
    allowedPriceId: "pri_01kzykvts8j9hz4bssgrfw6k0r",
    apiKeySecretName: "PADDLE_PROD_API_KEY",
    webhookSecretName: "PADDLE_PROD_WEBHOOK_SECRET"
  }
};

const INSTALLER_KEY = "SaveYourPubFiles-Setup-0.2.0.exe";
const DOWNLOAD_TTL_SECONDS = 7 * 24 * 60 * 60;
const SIGNATURE_TOLERANCE_SECONDS = 300;

function getPaddleConfig(env) {
  const paddleEnv = env.PADDLE_ENV ?? "sandbox";
  const environment = String(paddleEnv).trim().toLowerCase();
  const environmentConfig = PADDLE_ENVIRONMENTS[environment];

  if (!environmentConfig) {
    throw new Error(`Invalid PADDLE_ENV: ${paddleEnv}`);
  }

  return {
    environment,
    apiBase: environmentConfig.apiBase,
    allowedPriceId: environmentConfig.allowedPriceId,
    apiKey: env[environmentConfig.apiKeySecretName],
    webhookSecret: env[environmentConfig.webhookSecretName],
    apiKeySecretName: environmentConfig.apiKeySecretName,
    webhookSecretName: environmentConfig.webhookSecretName
  };
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;

  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}

function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;

  let diff = 0;

  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }

  return diff === 0;
}

function createDownloadToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function verifyPaddleSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;

  let timestamp = null;
  const signatures = [];

  for (const part of signatureHeader.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) continue;

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === "ts") timestamp = value;
    if (key === "h1") signatures.push(value);
  }

  if (!timestamp || signatures.length === 0) return false;

  const timestampNumber = Number(timestamp);

  if (!Number.isFinite(timestampNumber)) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);

  if (
    Math.abs(nowSeconds - timestampNumber) >
    SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const signedPayload = `${timestamp}:${rawBody}`;

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  const expectedBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(signedPayload)
  );

  const expected = new Uint8Array(expectedBuffer);

  for (const signature of signatures) {
    const actual = hexToBytes(signature);

    if (actual && constantTimeEqual(expected, actual)) {
      return true;
    }
  }

  return false;
}

async function handleWebhook(request, env) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        Allow: "POST",
      },
    });
  }

  let paddleConfig;

  try {
    paddleConfig = getPaddleConfig(env);
  } catch {
    return new Response("Invalid Paddle environment", {
      status: 500,
    });
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("Paddle-Signature");

  const signatureValid = await verifyPaddleSignature(
    rawBody,
    signatureHeader,
    paddleConfig.webhookSecret
  );

  if (!signatureValid) {
    return new Response("Invalid signature", {
      status: 401,
    });
  }

  let event;

  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", {
      status: 400,
    });
  }

  if (event.event_type !== "transaction.completed") {
    return new Response("Ignored", {
      status: 200,
    });
  }

  const transaction = event.data;

  if (!transaction?.id) {
    return new Response("Missing transaction id", {
      status: 400,
    });
  }

  const purchasedCorrectProduct =
    Array.isArray(transaction.items) &&
    transaction.items.some(
      (item) => item?.price?.id === paddleConfig.allowedPriceId
    );

  if (!purchasedCorrectProduct) {
    return new Response("Ignored: unrelated product", {
      status: 200,
    });
  }

  const purchaseKey = `transaction:${transaction.id}`;

  let existingPurchase = null;

  try {
    existingPurchase = await env.PURCHASES.get(
      purchaseKey,
      "json"
    );
  } catch {
    existingPurchase = null;
  }

  let downloadToken = existingPurchase?.downloadToken ?? null;
  let downloadExpiresAt =
    existingPurchase?.downloadExpiresAt ?? null;

  const expiryStillValid =
    downloadToken &&
    downloadExpiresAt &&
    Date.parse(downloadExpiresAt) > Date.now();

  if (!expiryStillValid) {
    downloadToken = createDownloadToken();
    downloadExpiresAt = new Date(
      Date.now() + DOWNLOAD_TTL_SECONDS * 1000
    ).toISOString();

    await env.PURCHASES.put(
      `download:${downloadToken}`,
      JSON.stringify({
        transactionId: transaction.id,
        installerKey: INSTALLER_KEY,
        expiresAt: downloadExpiresAt,
      }),
      {
        expirationTtl: DOWNLOAD_TTL_SECONDS,
      }
    );
  }

  const purchaseRecord = {
    transactionId: transaction.id,
    customerId: transaction.customer_id ?? null,
    status: transaction.status ?? null,
    currencyCode: transaction.currency_code ?? null,
    priceId: paddleConfig.allowedPriceId,
    completedAt:
      event.occurred_at ?? new Date().toISOString(),
    downloadToken,
    downloadExpiresAt,
  };

  await env.PURCHASES.put(
    purchaseKey,
    JSON.stringify(purchaseRecord)
  );

  return new Response("OK", {
    status: 200,
  });
}

async function handleDownload(request, env, token) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        Allow: "GET",
      },
    });
  }

  if (!token) {
    return new Response("Invalid download link", {
      status: 404,
    });
  }

  const tokenRecord = await env.PURCHASES.get(
    `download:${token}`,
    "json"
  );

  if (!tokenRecord) {
    return new Response("Download link is invalid or expired", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  if (
    !tokenRecord.expiresAt ||
    Date.parse(tokenRecord.expiresAt) <= Date.now()
  ) {
    return new Response("Download link has expired", {
      status: 410,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  const object = await env.DOWNLOADS.get(
    tokenRecord.installerKey
  );

  if (!object) {
    return new Response("Installer not found", {
      status: 404,
    });
  }

  const headers = new Headers();

  headers.set(
    "Content-Type",
    "application/octet-stream"
  );

  headers.set(
    "Content-Disposition",
    'attachment; filename="SaveYourPubFiles-Setup-0.2.0.exe"'
  );

  headers.set(
    "Cache-Control",
    "private, no-store"
  );

  if (object.httpEtag) {
    headers.set("ETag", object.httpEtag);
  }

  return new Response(object.body, {
    status: 200,
    headers,
  });
}


const CLAIM_ALLOWED_ORIGINS = new Set([
  "https://saveyourpubfiles.com",
  "https://www.saveyourpubfiles.com",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
]);

function claimHeaders(request) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  const origin = request.headers.get("Origin");

  if (origin && CLAIM_ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  return headers;
}

async function handleClaimDownload(request, env, url) {
  const headers = claimHeaders(request);
  const origin = request.headers.get("Origin");

  if (origin && !CLAIM_ALLOWED_ORIGINS.has(origin)) {
    return new Response(
      JSON.stringify({ error: "Origin not allowed" }),
      { status: 403, headers }
    );
  }

  if (request.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers }
    );
  }

  const transactionId = url.searchParams.get("transaction");

  if (!transactionId || !/^txn_[A-Za-z0-9]+$/.test(transactionId)) {
    return new Response(
      JSON.stringify({ error: "Invalid transaction id" }),
      { status: 400, headers }
    );
  }

  let paddleConfig;

  try {
    paddleConfig = getPaddleConfig(env);
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid Paddle environment" }),
      { status: 500, headers }
    );
  }

  const paddleResponse = await fetch(
    `${paddleConfig.apiBase}/transactions/${encodeURIComponent(transactionId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${paddleConfig.apiKey}`,
        "Content-Type": "application/json"
      }
    }
  );

  if (!paddleResponse.ok) {
    return new Response(
      JSON.stringify({
        error: "Unable to verify transaction",
        status: paddleResponse.status
      }),
      { status: 502, headers }
    );
  }

  const paddleResult = await paddleResponse.json();
  const transaction = paddleResult.data;

  if (!transaction || transaction.status !== "completed") {
    return new Response(
      JSON.stringify({ ready: false }),
      { status: 202, headers }
    );
  }

  const purchasedCorrectProduct =
    Array.isArray(transaction.items) &&
    transaction.items.some(
      (item) => item?.price?.id === paddleConfig.allowedPriceId
    );

  if (!purchasedCorrectProduct) {
    return new Response(
      JSON.stringify({ error: "Product not eligible" }),
      { status: 403, headers }
    );
  }

  let purchase = null;

  try {
    purchase = await env.PURCHASES.get(
      `transaction:${transactionId}`,
      "json"
    );
  } catch {
    purchase = null;
  }

  if (!purchase) {
    purchase = {
      transactionId,
      customerId: transaction.customer_id ?? null,
      status: transaction.status,
      currencyCode: transaction.currency_code ?? null,
      priceId: paddleConfig.allowedPriceId,
      completedAt: new Date().toISOString()
    };
  }

  let downloadToken = purchase.downloadToken ?? null;
  let downloadExpiresAt = purchase.downloadExpiresAt ?? null;

  const existingTokenValid =
    downloadToken &&
    downloadExpiresAt &&
    Date.parse(downloadExpiresAt) > Date.now();

  if (!existingTokenValid) {
    downloadToken = createDownloadToken();
    downloadExpiresAt = new Date(
      Date.now() + DOWNLOAD_TTL_SECONDS * 1000
    ).toISOString();

    await env.PURCHASES.put(
      `download:${downloadToken}`,
      JSON.stringify({
        transactionId,
        installerKey: INSTALLER_KEY,
        expiresAt: downloadExpiresAt
      }),
      {
        expirationTtl: DOWNLOAD_TTL_SECONDS
      }
    );

    purchase.downloadToken = downloadToken;
    purchase.downloadExpiresAt = downloadExpiresAt;

    await env.PURCHASES.put(
      `transaction:${transactionId}`,
      JSON.stringify(purchase)
    );
  }

  return new Response(
    JSON.stringify({
      ready: true,
      downloadUrl:
        `${url.origin}/download/${encodeURIComponent(downloadToken)}`,
      expiresAt: downloadExpiresAt
    }),
    { status: 200, headers }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/webhook") {
      return handleWebhook(request, env);
    }

    if (url.pathname === "/claim-download") {
      return handleClaimDownload(request, env, url);
    }

    if (url.pathname.startsWith("/download/")) {
      const token = url.pathname
        .slice("/download/".length)
        .trim();

      return handleDownload(request, env, token);
    }

    return new Response("Not found", {
      status: 404,
    });
  },
};

export {
  getPaddleConfig,
  PADDLE_ENVIRONMENTS,
  verifyPaddleSignature
};
