import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const workerSource = readFileSync(
  new URL("../src/worker.js", import.meta.url),
  "utf8"
);
const workerModule = await import(
  `data:text/javascript;base64,${Buffer.from(workerSource).toString("base64")}`
);

const {
  default: worker,
  getPaddleConfig,
  verifyPaddleSignature
} = workerModule;

function makeSignature(rawBody, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}:${rawBody}`)
    .digest("hex");

  return `ts=${timestamp};h1=${digest}`;
}

function makeEnv(overrides = {}) {
  const store = new Map();

  return {
    PADDLE_API_KEY: "sandbox-api-key",
    PADDLE_WEBHOOK_SECRET: "sandbox-webhook-secret",
    PADDLE_PROD_API_KEY: "production-api-key",
    PADDLE_PROD_WEBHOOK_SECRET: "production-webhook-secret",
    PURCHASES: {
      async get(key) {
        return store.has(key) ? store.get(key) : null;
      },
      async put(key, value) {
        store.set(key, JSON.parse(value));
      }
    },
    DOWNLOADS: {
      async get() {
        return null;
      }
    },
    _store: store,
    ...overrides
  };
}

test("missing PADDLE_ENV defaults to sandbox", () => {
  const config = getPaddleConfig(makeEnv());

  assert.equal(config.environment, "sandbox");
  assert.equal(config.apiBase, "https://sandbox-api.paddle.com");
  assert.equal(config.allowedPriceId, "pri_01kzpvxxkptgamwp74h1g2wbqv");
  assert.equal(config.apiKey, "sandbox-api-key");
  assert.equal(config.webhookSecret, "sandbox-webhook-secret");
});

test("PADDLE_ENV=sandbox selects sandbox endpoint, price, and secrets", () => {
  const config = getPaddleConfig(makeEnv({ PADDLE_ENV: "sandbox" }));

  assert.equal(config.environment, "sandbox");
  assert.equal(config.apiBase, "https://sandbox-api.paddle.com");
  assert.equal(config.allowedPriceId, "pri_01kzpvxxkptgamwp74h1g2wbqv");
  assert.equal(config.apiKeySecretName, "PADDLE_API_KEY");
  assert.equal(config.webhookSecretName, "PADDLE_WEBHOOK_SECRET");
});

test("PADDLE_ENV=production selects production endpoint, price, and secrets", () => {
  const config = getPaddleConfig(makeEnv({ PADDLE_ENV: "production" }));

  assert.equal(config.environment, "production");
  assert.equal(config.apiBase, "https://api.paddle.com");
  assert.equal(config.allowedPriceId, "pri_01kzykvts8j9hz4bssgrfw6k0r");
  assert.equal(config.apiKey, "production-api-key");
  assert.equal(config.webhookSecret, "production-webhook-secret");
  assert.equal(config.apiKeySecretName, "PADDLE_PROD_API_KEY");
  assert.equal(config.webhookSecretName, "PADDLE_PROD_WEBHOOK_SECRET");
});

test("invalid PADDLE_ENV fails closed", () => {
  assert.throws(
    () => getPaddleConfig(makeEnv({ PADDLE_ENV: "live" })),
    /Invalid PADDLE_ENV/
  );
});

test("/claim-download rejects completed transactions with the wrong price ID", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  let authorization;

  globalThis.fetch = async (url, options) => {
    requestedUrl = String(url);
    authorization = options.headers.Authorization;

    return new Response(
      JSON.stringify({
        data: {
          id: "txn_wrongprice",
          status: "completed",
          items: [{ price: { id: "pri_wrong" } }]
        }
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/claim-download?transaction=txn_wrongprice"),
      makeEnv()
    );

    assert.equal(response.status, 403);
    assert.equal(
      requestedUrl,
      "https://sandbox-api.paddle.com/transactions/txn_wrongprice"
    );
    assert.equal(authorization, "Bearer sandbox-api-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("/claim-download uses production API settings when PADDLE_ENV=production", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  let authorization;

  globalThis.fetch = async (url, options) => {
    requestedUrl = String(url);
    authorization = options.headers.Authorization;

    return new Response(
      JSON.stringify({
        data: {
          id: "txn_prodwrong",
          status: "completed",
          items: [{ price: { id: "pri_wrong" } }]
        }
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/claim-download?transaction=txn_prodwrong"),
      makeEnv({ PADDLE_ENV: "production" })
    );

    assert.equal(response.status, 403);
    assert.equal(
      requestedUrl,
      "https://api.paddle.com/transactions/txn_prodwrong"
    );
    assert.equal(authorization, "Bearer production-api-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invalid PADDLE_ENV fails closed through Worker routes", async () => {
  const claimResponse = await worker.fetch(
    new Request("https://worker.test/claim-download?transaction=txn_badenv"),
    makeEnv({ PADDLE_ENV: "live" })
  );

  assert.equal(claimResponse.status, 500);

  const webhookResponse = await worker.fetch(
    new Request("https://worker.test/webhook", {
      method: "POST",
      body: "{}"
    }),
    makeEnv({ PADDLE_ENV: "live" })
  );

  assert.equal(webhookResponse.status, 500);
});

test("webhook signature uses the selected environment secret", async () => {
  const body = JSON.stringify({
    event_type: "transaction.completed",
    occurred_at: "2026-08-27T00:00:00Z",
    data: {
      id: "txn_prod",
      status: "completed",
      currency_code: "USD",
      items: [
        {
          price: {
            id: "pri_01kzykvts8j9hz4bssgrfw6k0r"
          }
        }
      ]
    }
  });

  assert.equal(
    await verifyPaddleSignature(
      body,
      makeSignature(body, "production-webhook-secret"),
      "production-webhook-secret"
    ),
    true
  );

  const accepted = await worker.fetch(
    new Request("https://worker.test/webhook", {
      method: "POST",
      body,
      headers: {
        "Paddle-Signature": makeSignature(body, "production-webhook-secret")
      }
    }),
    makeEnv({ PADDLE_ENV: "production" })
  );

  assert.equal(accepted.status, 200);

  const rejected = await worker.fetch(
    new Request("https://worker.test/webhook", {
      method: "POST",
      body,
      headers: {
        "Paddle-Signature": makeSignature(body, "sandbox-webhook-secret")
      }
    }),
    makeEnv({ PADDLE_ENV: "production" })
  );

  assert.equal(rejected.status, 401);
});
