import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createMemoryCache } from "../src/cache.ts";
import { createWorker } from "../src/index.ts";
import { computeConstantProductDumpImpact } from "../src/scoring.ts";
import {
  isValidSolanaMint,
  isValidSolanaTxSignature,
  readBoundedText,
} from "../src/security.ts";
import {
  computeUsdcCreditDelta,
  SOLANA_X402_V1_NETWORK,
  SOLANA_X402_V2_NETWORK,
} from "../src/x402.ts";

const PAYOUT_WALLET = "9kE6pAKgW1M2J27JAX7bMkY2uGanjNGjxzrNpomA6bte";
const PAYAI_FACILITATOR = "https://facilitator.payai.network";
const PAYAI_FEE_PAYER = "CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const VALID_TX_SIG_1 =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const VALID_TX_SIG_2 =
  "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM7P5r2hJ3G9aG6K7yN1zQ8pX2cV5mB9dF4wH6jK8nL2pQ";
const VALID_TX_SIG_3 =
  "3nK8pQ2wR5tY7uM9oP1aS3dF5gH7jK9mN2bV4cX6zL8kJ1hG3fD5sA7pR9iU2yT4rE6wQ8aZ1xC3vB5nM7qW9eR";
const PAYER_PUBKEY = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

const BASE_ENV = {
  PAYOUT_SOLANA_WALLET: PAYOUT_WALLET,
  USDC_SOLANA_MINT: USDC_MINT,
  PRO_PRICE_MICRO_USDC: "5000",
  X402_FACILITATOR_URL: PAYAI_FACILITATOR,
  X402_FEE_PAYER: PAYAI_FEE_PAYER,
  SOLANA_RPC_URL: "https://rpc.mock.solana.test",
  FREE_RATE_LIMIT_PER_MINUTE: "5",
  SIGNAL_CACHE_TTL_SECONDS: "60",
  PUBLIC_BASE_URL: "",
  FARCASTER_HEADER: "",
  FARCASTER_PAYLOAD: "",
  FARCASTER_SIGNATURE: "",
};

function createTestCtx() {
  const pending = [];
  const ctx = {
    waitUntil(promise) {
      pending.push(Promise.resolve(promise));
    },
    passThroughOnException() {
      throw new Error("passThroughOnException must never be called");
    },
  };
  return {
    ctx,
    async flush() {
      await Promise.all(pending.splice(0, pending.length));
    },
  };
}

function makeMockDexBonk(nowMs) {
  return {
    schemaVersion: "1.0.0",
    pairs: [
      {
        chainId: "solana",
        dexId: "orca",
        pairAddress: "5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9",
        baseToken: { address: BONK_MINT, name: "Bonk", symbol: "BONK" },
        quoteToken: { address: SOL_MINT, name: "Wrapped SOL", symbol: "SOL" },
        priceNative: "0.00000003",
        priceUsd: "0.0000022",
        txns: {
          m5: { buys: 18, sells: 6 },
          h1: { buys: 210, sells: 90 },
          h6: { buys: 1200, sells: 700 },
          h24: { buys: 8500, sells: 5200 },
        },
        volume: { m5: 1200, h1: 24000, h6: 120000, h24: 540000 },
        priceChange: { m5: 0.4, h1: 1.9, h6: 3.8, h24: 6.2 },
        liquidity: { usd: 850000, base: 1000000000, quote: 2500 },
        fdv: 190000000,
        marketCap: 185000000,
        pairCreatedAt: nowMs - 1000 * 60 * 60 * 24 * 365,
      },
      {
        chainId: "solana",
        dexId: "raydium",
        pairAddress: "8QaXeHBrShJTdtN1rWHbp3pDTv2f3W1xL9p4G9kQ5t2A",
        baseToken: { address: BONK_MINT, name: "Bonk", symbol: "BONK" },
        quoteToken: { address: USDC_MINT, name: "USD Coin", symbol: "USDC" },
        priceNative: "0.0000022",
        priceUsd: "0.0000022",
        txns: {
          m5: { buys: 10, sells: 4 },
          h1: { buys: 110, sells: 55 },
          h6: { buys: 650, sells: 390 },
          h24: { buys: 4200, sells: 2900 },
        },
        volume: { m5: 600, h1: 14000, h6: 75000, h24: 320000 },
        priceChange: { m5: 0.3, h1: 1.7, h6: 3.4, h24: 5.9 },
        liquidity: { usd: 620000, base: 700000000, quote: 310000 },
        fdv: 190000000,
        marketCap: 185000000,
        pairCreatedAt: nowMs - 1000 * 60 * 60 * 24 * 360,
      },
      // Non-Solana pair should be ignored
      {
        chainId: "ethereum",
        dexId: "uniswap",
        pairAddress: "0xdeadbeef",
        baseToken: { address: BONK_MINT, name: "Wrapped Bonk", symbol: "BONK" },
        quoteToken: { address: "0x0", name: "ETH", symbol: "ETH" },
        liquidity: { usd: 99999999 },
      },
    ],
  };
}

function makeMockRugCheckFullBonk() {
  return {
    mint: BONK_MINT,
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    creator: null,
    creatorBalance: 0,
    mintAuthority: null,
    freezeAuthority: null,
    score: 101,
    score_normalised: 7,
    lpLockedPct: 38.5,
    rugged: false,
    totalMarketLiquidity: 1470000,
    totalStableLiquidity: 620000,
    totalLPProviders: 412,
    totalHolders: 845000,
    graphInsidersDetected: 0,
    insiderNetworks: [],
    lockers: { l1: {} },
    verification: { jup_verified: true, name: "Bonk", symbol: "BONK" },
    tokenMeta: { name: "Bonk", symbol: "BONK", mutable: true },
    risks: [
      {
        name: "Mutable metadata",
        value: "",
        description: "Token metadata can be changed by the owner",
        score: 100,
        level: "warn",
      },
    ],
    topHolders: [
      { address: "H1", owner: "O1", pct: 8.2, insider: false },
      { address: "H2", owner: "O2", pct: 5.1, insider: false },
      { address: "H3", owner: "O3", pct: 3.4, insider: false },
    ],
    markets: [
      {
        pubkey: "5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9",
        marketType: "orca",
        lp: { lpLockedPct: 45, lpLockedUSD: 382500 },
      },
    ],
  };
}

function makeSolanaTxRpcPayload({
  blockTime,
  err = null,
  preAmount = "1000000",
  postAmount = "1005000",
  owner = PAYOUT_WALLET,
  mint = USDC_MINT,
} = {}) {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: {
      slot: 312345678,
      blockTime,
      meta: {
        err,
        preTokenBalances:
          preAmount !== null
            ? [
                {
                  accountIndex: 2,
                  mint,
                  owner,
                  uiTokenAmount: { amount: preAmount, decimals: 6 },
                },
              ]
            : [],
        postTokenBalances:
          postAmount !== null
            ? [
                {
                  accountIndex: 2,
                  mint,
                  owner,
                  uiTokenAmount: { amount: postAmount, decimals: 6 },
                },
              ]
            : [],
      },
    },
  };
}

describe("Wrangler config, PayAI vars & Official MCP Registry server.json compliance", () => {
  it("parses wrangler.jsonc cleanly with PayAI facilitator, observability, nodejs_compat, and deposit-only wallet", () => {
    const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
    const config = JSON.parse(stripped);

    assert.equal(config.name, "upswing-solsignal");
    assert.equal(config.main, "src/index.ts");
    assert.match(config.compatibility_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(config.compatibility_flags.includes("nodejs_compat"));
    assert.equal(config.observability.enabled, true);
    assert.equal(config.observability.logs.enabled, true);
    assert.equal(config.observability.traces.enabled, true);
    assert.equal(config.vars.PAYOUT_SOLANA_WALLET, PAYOUT_WALLET);
    assert.equal(config.vars.USDC_SOLANA_MINT, USDC_MINT);
    assert.equal(config.vars.PRO_PRICE_MICRO_USDC, "5000");
    assert.equal(config.vars.X402_FACILITATOR_URL, PAYAI_FACILITATOR);
    assert.equal(config.vars.X402_FEE_PAYER, PAYAI_FEE_PAYER);

    const dts = readFileSync(
      new URL("../worker-configuration.d.ts", import.meta.url),
      "utf8"
    );
    for (const varKey of Object.keys(config.vars)) {
      assert.match(
        dts,
        new RegExp(`\\b${varKey}\\s*:\\s*string\\b`),
        `worker-configuration.d.ts missing Env var ${varKey}`
      );
    }
  });

  it("validates server.json strictly against Official MCP Registry 2025-12-11 schema", () => {
    const serverJson = JSON.parse(
      readFileSync(new URL("../server.json", import.meta.url), "utf8")
    );
    assert.equal(
      serverJson.$schema,
      "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json"
    );
    assert.match(serverJson.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    assert.ok(serverJson.description.length >= 1 && serverJson.description.length <= 100);
    assert.equal(serverJson.version, "2.0.0");
    assert.equal(
      serverJson.websiteUrl,
      "https://upswing-solsignal.upswing-labs.workers.dev"
    );
    assert.equal(serverJson.remotes.length, 1);
    assert.equal(serverJson.remotes[0].type, "streamable-http");
    assert.equal(
      serverJson.remotes[0].url,
      "https://upswing-solsignal.upswing-labs.workers.dev/mcp"
    );
    assert.deepEqual(
      serverJson._meta["io.modelcontextprotocol.registry/publisher-provided"].x402.networks,
      [SOLANA_X402_V1_NETWORK, SOLANA_X402_V2_NETWORK]
    );
    assert.equal(
      serverJson._meta["io.modelcontextprotocol.registry/publisher-provided"].x402.payTo,
      PAYOUT_WALLET
    );
  });
});

describe("Security & Base58 validation", () => {
  it("accepts valid Solana SPL mints and rejects SSRF / traversal / invalid Base58", () => {
    assert.equal(isValidSolanaMint(SOL_MINT), true);
    assert.equal(isValidSolanaMint(USDC_MINT), true);
    assert.equal(isValidSolanaMint(BONK_MINT), true);

    const invalidInputs = [
      "",
      "short",
      "../etc/passwd",
      `${BONK_MINT}/../../admin`,
      `${BONK_MINT}?foo=bar`,
      `${BONK_MINT}#frag`,
      "https://evil.example/token",
      "0".repeat(44),
      "O".repeat(44),
      "I".repeat(44),
      "l".repeat(44),
      "A".repeat(45),
      "A".repeat(31),
      `${BONK_MINT}%2Fevil`,
    ];
    for (const candidate of invalidInputs) {
      assert.equal(
        isValidSolanaMint(candidate),
        false,
        `Expected invalid mint to be rejected: ${candidate}`
      );
    }

    assert.equal(isValidSolanaTxSignature(VALID_TX_SIG_1), true);
    assert.equal(isValidSolanaTxSignature("not-a-valid-sig"), false);
  });

  it("enforces bounded streaming read cap to protect Worker memory", async () => {
    const bigChunk = new TextEncoder().encode("x".repeat(2048));
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bigChunk);
        controller.close();
      },
    });
    const res = await readBoundedText(stream, null, 1024);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.reason, "PAYLOAD_TOO_LARGE");
    }
  });

  it("rejects SSRF / invalid mints at HTTP endpoints with 400 and applies security headers", async () => {
    let fetchCalls = 0;
    const worker = createWorker({
      cache: createMemoryCache(),
      fetchFn: async () => {
        fetchCalls += 1;
        return new Response("{}");
      },
    });
    const { ctx } = createTestCtx();

    const freeBad = await worker.fetch(
      new Request("https://solsignal.example/api/v1/free/signal?mint=..%2F..%2Fsecret"),
      BASE_ENV,
      ctx
    );
    assert.equal(freeBad.status, 400);
    assert.equal(freeBad.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(freeBad.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(freeBad.headers.get("Access-Control-Allow-Origin"), "*");

    const proBad = await worker.fetch(
      new Request("https://solsignal.example/api/v1/pro/signal?mint=http://169.254.169.254"),
      BASE_ENV,
      ctx
    );
    assert.equal(proBad.status, 400);
    assert.equal(fetchCalls, 0, "Invalid mint must never trigger any outbound fetch");
  });
});

describe("Web UI, Health, SVG assets, CORS, and Farcaster Mini-App", () => {
  it("renders dark-mode UI with nonce CSP, Farcaster fc:miniapp meta tag, and no CORS leak", async () => {
    const worker = createWorker({ cache: createMemoryCache() });
    const { ctx } = createTestCtx();

    const homeRes = await worker.fetch(
      new Request("https://solsignal.example/"),
      BASE_ENV,
      ctx
    );
    assert.equal(homeRes.status, 200);
    assert.match(homeRes.headers.get("Content-Type") ?? "", /text\/html/);
    assert.equal(homeRes.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(homeRes.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(homeRes.headers.get("Access-Control-Allow-Origin"), null);

    const csp = homeRes.headers.get("Content-Security-Policy") ?? "";
    assert.match(csp, /script-src 'nonce-[A-Za-z0-9+/=]+'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);

    const html = await homeRes.text();
    assert.match(html, /Upswing SolSignal/);
    assert.match(html, /v2\.0\.0/);
    assert.match(html, /AMM Dump Stress-Test/);
    assert.match(html, /href="\/docs\/scoring"/);
    assert.match(html, /name="fc:miniapp"/);
    assert.match(html, new RegExp(PAYOUT_WALLET));

    const iconRes = await worker.fetch(
      new Request("https://solsignal.example/icon.svg"),
      BASE_ENV,
      ctx
    );
    assert.equal(iconRes.status, 200);
    assert.match(iconRes.headers.get("Content-Type") ?? "", /image\/svg\+xml/);

    const ogRes = await worker.fetch(
      new Request("https://solsignal.example/og.svg"),
      BASE_ENV,
      ctx
    );
    assert.equal(ogRes.status, 200);
    assert.match(await ogRes.text(), /Upswing SolSignal/);
  });

  it("returns clean /health with PayAI network IDs and scoped CORS preflight for v1+v2 headers", async () => {
    const worker = createWorker({ cache: createMemoryCache() });
    const { ctx } = createTestCtx();

    const healthRes = await worker.fetch(
      new Request("https://solsignal.example/health"),
      BASE_ENV,
      ctx
    );
    assert.equal(healthRes.status, 200);
    const body = await healthRes.json();
    assert.equal(body.status, "ok");
    assert.equal(body.version, "2.0.0");
    assert.equal(body.docs.scoring, "https://solsignal.example/docs/scoring");
    assert.equal(body.rails.x402.payTo, PAYOUT_WALLET);
    assert.equal(body.rails.x402.facilitator, PAYAI_FACILITATOR);
    assert.equal(body.rails.x402.networks.v1, SOLANA_X402_V1_NETWORK);
    assert.equal(body.rails.x402.networks.v2, SOLANA_X402_V2_NETWORK);
    assert.equal(body.rails.x402.feePayer, PAYAI_FEE_PAYER);
    assert.equal(body.rails.x402.bazaarDiscoverable, true);

    const preflight = await worker.fetch(
      new Request("https://solsignal.example/api/v1/pro/signal", {
        method: "OPTIONS",
      }),
      BASE_ENV,
      ctx
    );
    assert.equal(preflight.status, 204);
    assert.match(
      preflight.headers.get("Access-Control-Allow-Headers") ?? "",
      /PAYMENT-SIGNATURE/
    );
    assert.match(
      preflight.headers.get("Access-Control-Expose-Headers") ?? "",
      /PAYMENT-REQUIRED/
    );
  });

  it("serves /.well-known/farcaster.json with owner placeholder and env override support", async () => {
    const worker = createWorker({ cache: createMemoryCache() });
    const { ctx } = createTestCtx();

    const defaultRes = await worker.fetch(
      new Request("https://solsignal.example/.well-known/farcaster.json"),
      BASE_ENV,
      ctx
    );
    assert.equal(defaultRes.status, 200);
    assert.equal(defaultRes.headers.get("Access-Control-Allow-Origin"), "*");
    const manifest = await defaultRes.json();
    assert.match(manifest.accountAssociation.header, /OWNER_ACTION_REQUIRED/);
    assert.equal(manifest.frame.homeUrl, "https://solsignal.example");
    assert.equal(manifest.miniapp.iconUrl, "https://solsignal.example/icon.svg");
    assert.equal(manifest.miniapp.imageUrl, "https://solsignal.example/og.svg");

    const signedRes = await worker.fetch(
      new Request("https://solsignal.example/.well-known/farcaster.json"),
      {
        ...BASE_ENV,
        FARCASTER_HEADER: "signed-header-b64",
        FARCASTER_PAYLOAD: "signed-payload-b64",
        FARCASTER_SIGNATURE: "signed-sig-b64",
      },
      ctx
    );
    const signedManifest = await signedRes.json();
    assert.equal(signedManifest.accountAssociation.header, "signed-header-b64");
    assert.equal(signedManifest.accountAssociation.payload, "signed-payload-b64");
    assert.equal(signedManifest.accountAssociation.signature, "signed-sig-b64");
  });
});

describe("Free Signal API: aggregation, caching, rate limiting, and fallback", () => {
  it("aggregates DexScreener + RugCheck, caches for 60s, and enforces IP rate limit", async () => {
    const nowMs = Date.parse("2026-11-23T08:00:00Z");
    let upstreamCalls = 0;
    const worker = createWorker({
      now: () => nowMs,
      cache: createMemoryCache({ now: () => nowMs }),
      fetchFn: async (input) => {
        upstreamCalls += 1;
        const url = String(input);
        if (url.includes("api.dexscreener.com")) {
          return Response.json(makeMockDexBonk(nowMs));
        }
        if (url.includes("api.rugcheck.xyz")) {
          return Response.json({
            tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            risks: [
              { name: "Mutable metadata", level: "warn", score: 100, description: "Mutable" },
            ],
            score: 101,
            score_normalised: 7,
            lpLockedPct: 38.5,
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const env = { ...BASE_ENV, FREE_RATE_LIMIT_PER_MINUTE: "2" };
    const { ctx, flush } = createTestCtx();

    const res1 = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/free/signal?mint=${BONK_MINT}`, {
        headers: { "CF-Connecting-IP": "203.0.113.10" },
      }),
      env,
      ctx
    );
    await flush();
    assert.equal(res1.status, 200);
    assert.equal(res1.headers.get("X-Cache"), "MISS");
    assert.equal(res1.headers.get("X-RateLimit-Remaining"), "1");
    const data1 = await res1.json();
    assert.equal(data1.tier, "free");
    assert.equal(data1.token.symbol, "BONK");
    assert.equal(data1.market.liquidityUsd, 1470000);
    assert.equal(data1.market.poolCount, 2);
    assert.equal(data1.safety.verdict, "LOW_RISK");
    assert.ok(data1.safety.rugRiskScore >= 0 && data1.safety.rugRiskScore <= 24);
    assert.equal(upstreamCalls, 2);

    const res2 = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/free/signal?mint=${BONK_MINT}`, {
        headers: { "CF-Connecting-IP": "203.0.113.10" },
      }),
      env,
      ctx
    );
    assert.equal(res2.status, 200);
    assert.equal(res2.headers.get("X-Cache"), "HIT");
    assert.equal(res2.headers.get("X-RateLimit-Remaining"), "0");
    assert.equal(upstreamCalls, 2);

    const res3 = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/free/signal?mint=${BONK_MINT}`, {
        headers: { "CF-Connecting-IP": "203.0.113.10" },
      }),
      env,
      ctx
    );
    assert.equal(res3.status, 429);
    assert.ok(Number(res3.headers.get("Retry-After")) >= 1);

    const resOtherIp = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/free/signal?mint=${BONK_MINT}`, {
        headers: { "CF-Connecting-IP": "198.51.100.42" },
      }),
      env,
      ctx
    );
    assert.equal(resOtherIp.status, 200);
    assert.equal(resOtherIp.headers.get("X-Cache"), "HIT");
  });

  it("gracefully degrades when RugCheck fails and flags honeypot/scam tokens accurately", async () => {
    const nowMs = Date.parse("2026-11-23T08:00:00Z");
    const worker = createWorker({
      now: () => nowMs,
      cache: createMemoryCache({ now: () => nowMs }),
      fetchFn: async (input) => {
        const url = String(input);
        if (url.includes("api.dexscreener.com")) {
          return Response.json({
            pairs: [
              {
                chainId: "solana",
                dexId: "raydium",
                pairAddress: "ScamPair11111111111111111111111111111111111",
                baseToken: { address: BONK_MINT, name: "RugCoin", symbol: "RUG" },
                quoteToken: { address: SOL_MINT, name: "SOL", symbol: "SOL" },
                priceUsd: "0.0001",
                liquidity: { usd: 420 },
                volume: { h24: 18000 },
                fdv: 5000000,
                pairCreatedAt: nowMs - 1000 * 60 * 60 * 2,
              },
            ],
          });
        }
        return new Response("Upstream Timeout", { status: 504 });
      },
    });
    const { ctx, flush } = createTestCtx();

    const res = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/free/signal?mint=${BONK_MINT}`),
      BASE_ENV,
      ctx
    );
    await flush();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.degraded, true);
    assert.equal(body.sources.dexscreener.ok, true);
    assert.equal(body.sources.rugcheck.ok, false);
    assert.ok(body.safety.rugRiskScore >= 75);
    assert.ok(
      body.safety.verdict === "HIGH_RISK" || body.safety.verdict === "HONEYPOT_ALERT"
    );
    assert.ok(
      body.safety.riskFlags.some((f) => f.code === "CRITICAL_MICRO_LIQUIDITY")
    );
    assert.ok(
      body.safety.riskFlags.some((f) => f.code === "UPSTREAM_RUGCHECK_DEGRADED")
    );
  });
});

describe("PayAI x402 v1/v2 Challenge, Bazaar Discovery, Facilitator Settlement & Solana RPC Fallback", () => {
  it("emits PayAI-compliant v1 body + v2 PAYMENT-REQUIRED header + outputSchema + extensions.bazaar (with and without ?mint=)", async () => {
    const worker = createWorker({ cache: createMemoryCache() });
    const { ctx } = createTestCtx();

    // 1. Standard request with ?mint=
    const res = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/pro/signal?mint=${BONK_MINT}`),
      BASE_ENV,
      ctx
    );
    assert.equal(res.status, 402);
    assert.match(res.headers.get("WWW-Authenticate") ?? "", /x402/);

    // Verify v1 JSON body
    const body = await res.json();
    assert.equal(body.x402Version, 1);
    assert.equal(body.accepts.length, 1);
    assert.equal(body.accepts[0].scheme, "exact");
    assert.equal(body.accepts[0].network, SOLANA_X402_V1_NETWORK);
    assert.notEqual(body.accepts[0].network, "solana-mainnet");
    assert.equal(body.accepts[0].maxAmountRequired, "5000");
    assert.equal(body.accepts[0].asset, USDC_MINT);
    assert.equal(body.accepts[0].payTo, PAYOUT_WALLET);
    assert.equal(body.accepts[0].extra.feePayer, PAYAI_FEE_PAYER);
    assert.equal(body.accepts[0].extra.facilitator, PAYAI_FACILITATOR);
    assert.equal(body.accepts[0].outputSchema.input.type, "http");
    assert.equal(body.accepts[0].outputSchema.input.method, "GET");
    assert.equal(body.accepts[0].outputSchema.input.discoverable, true);
    assert.equal(body.accepts[0].outputSchema.input.queryParams.mint.required, true);
    assert.equal(body.extensions.bazaar.discoverable, true);
    assert.ok(body.extensions.bazaar.info.tags.includes("solana"));
    assert.equal(body.extensions.bazaar.info.input.queryParams.mint, BONK_MINT);
    assert.equal(body.extensions.bazaar.info.output.type, "json");

    // Verify v2 PAYMENT-REQUIRED header (CAIP-2)
    const prHeader = res.headers.get("PAYMENT-REQUIRED");
    assert.ok(prHeader, "PAYMENT-REQUIRED v2 header must be present on 402");
    const v2 = JSON.parse(Buffer.from(prHeader, "base64").toString("utf8"));
    assert.equal(v2.x402Version, 2);
    assert.equal(v2.accepts[0].network, SOLANA_X402_V2_NETWORK);
    assert.equal(v2.accepts[0].amount, "5000");
    assert.equal(v2.accepts[0].payTo, PAYOUT_WALLET);
    assert.equal(v2.accepts[0].asset, USDC_MINT);
    assert.equal(v2.accepts[0].extra.feePayer, PAYAI_FEE_PAYER);
    assert.equal(v2.extensions.bazaar.discoverable, true);
    assert.equal(v2.resource.serviceName, "Upswing SolSignal");

    // 2. Discovery crawler probe WITHOUT ?mint= returns 402 manifest (not 400!)
    const probeRes = await worker.fetch(
      new Request("https://solsignal.example/api/v1/pro/signal"),
      BASE_ENV,
      ctx
    );
    assert.equal(probeRes.status, 402);
    const probeBody = await probeRes.json();
    assert.equal(probeBody.accepts[0].resource, "https://solsignal.example/api/v1/pro/signal");
    assert.equal(probeBody.extensions.bazaar.discoverable, true);

    // 3. Paid header WITHOUT ?mint= returns 400 MISSING_MINT without billing
    const paidNoMint = await worker.fetch(
      new Request("https://solsignal.example/api/v1/pro/signal", {
        headers: { "X-PAYMENT-TX": VALID_TX_SIG_1 },
      }),
      BASE_ENV,
      ctx
    );
    assert.equal(paidNoMint.status, 400);
  });

  it("verifies and settles x402 v1 (X-PAYMENT) & v2 (PAYMENT-SIGNATURE) via PayAI Facilitator, prevents replays, and skips /settle on upstream 502", async () => {
    const nowMs = Date.parse("2026-11-23T12:00:00Z");
    const calls = [];
    let simulateUpstreamDown = false;
    let simulateVerifyReject = false;

    const worker = createWorker({
      now: () => nowMs,
      cache: createMemoryCache({ now: () => nowMs }),
      fetchFn: async (input, init) => {
        const url = String(input);
        calls.push(url);

        if (url === `${PAYAI_FACILITATOR}/verify`) {
          const reqBody = JSON.parse(String(init?.body ?? "{}"));
          assert.equal(reqBody.paymentRequirements.payTo, PAYOUT_WALLET);
          assert.equal(reqBody.paymentRequirements.asset, USDC_MINT);
          assert.equal(reqBody.paymentRequirements.extra.feePayer, PAYAI_FEE_PAYER);
          if (reqBody.x402Version === 1) {
            assert.equal(reqBody.paymentRequirements.network, SOLANA_X402_V1_NETWORK);
            assert.equal(reqBody.paymentRequirements.maxAmountRequired, "5000");
          } else {
            assert.equal(reqBody.paymentRequirements.network, SOLANA_X402_V2_NETWORK);
            assert.equal(reqBody.paymentRequirements.amount, "5000");
          }
          if (simulateVerifyReject) {
            return Response.json({
              isValid: false,
              invalidReason: "insufficient_funds",
              payer: PAYER_PUBKEY,
            });
          }
          return Response.json({ isValid: true, payer: PAYER_PUBKEY });
        }

        if (url === `${PAYAI_FACILITATOR}/settle`) {
          const reqBody = JSON.parse(String(init?.body ?? "{}"));
          return Response.json({
            success: true,
            transaction: reqBody.x402Version === 2 ? VALID_TX_SIG_2 : VALID_TX_SIG_1,
            network: reqBody.paymentRequirements.network,
            payer: PAYER_PUBKEY,
          });
        }

        if (simulateUpstreamDown) {
          return new Response("Down", { status: 503 });
        }
        if (url.includes("api.dexscreener.com")) {
          return Response.json(makeMockDexBonk(nowMs));
        }
        if (url.includes("api.rugcheck.xyz") && url.endsWith("/report")) {
          return Response.json(makeMockRugCheckFullBonk());
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const { ctx, flush } = createTestCtx();

    // 1. Legacy invalid network "solana-mainnet" is rejected with 402
    const legacyBadHeader = Buffer.from(
      JSON.stringify({
        x402Version: 1,
        scheme: "exact",
        network: "solana-mainnet",
        payload: { transaction: "AQIDBA==" },
      })
    ).toString("base64");
    const legacyRes = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/pro/signal?mint=${BONK_MINT}`, {
        headers: { "X-PAYMENT": legacyBadHeader },
      }),
      BASE_ENV,
      ctx
    );
    assert.equal(legacyRes.status, 402);
    assert.match((await legacyRes.json()).error, /Unsupported x402 network/);
    assert.equal(calls.length, 0);

    // 2. Valid PayAI x402 v1 flow (`X-PAYMENT` with `network: "solana"` and `payload.transaction`)
    const v1PaymentHeader = Buffer.from(
      JSON.stringify({
        x402Version: 1,
        scheme: "exact",
        network: SOLANA_X402_V1_NETWORK,
        payload: { transaction: "SIGNED_V1_SOLANA_TX_BASE64_PAYLOAD_ALPHA" },
      })
    ).toString("base64");
    const v1Res = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/pro/signal?mint=${BONK_MINT}`, {
        headers: { "X-PAYMENT": v1PaymentHeader },
      }),
      BASE_ENV,
      ctx
    );
    await flush();
    assert.equal(v1Res.status, 200);
    assert.ok(v1Res.headers.get("X-PAYMENT-RESPONSE"));
    assert.ok(v1Res.headers.get("PAYMENT-RESPONSE"));
    const v1Report = await v1Res.json();
    assert.equal(v1Report.payment.settlementMethod, "payai-facilitator");
    assert.equal(v1Report.payment.network, SOLANA_X402_V1_NETWORK);
    assert.equal(v1Report.payment.x402Version, 1);
    assert.equal(v1Report.payment.txSignature, VALID_TX_SIG_1);
    assert.equal(v1Report.payment.payer, PAYER_PUBKEY);

    // Verify order: /verify called BEFORE /settle
    const verifyIdx = calls.indexOf(`${PAYAI_FACILITATOR}/verify`);
    const settleIdx = calls.indexOf(`${PAYAI_FACILITATOR}/settle`);
    assert.ok(verifyIdx >= 0 && settleIdx > verifyIdx);

    // 3. Replaying same signed X-PAYMENT blob is blocked BEFORE hitting PayAI /verify
    const callsBeforeReplay = calls.length;
    const replayPayloadRes = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/pro/signal?mint=${BONK_MINT}`, {
        headers: { "X-PAYMENT": v1PaymentHeader },
      }),
      BASE_ENV,
      ctx
    );
    assert.equal(replayPayloadRes.status, 402);
    assert.match((await replayPayloadRes.json()).error, /replay/i);
    assert.equal(calls.length, callsBeforeReplay);

    // 4. Cross-rail replay: trying to reuse settled txSignature via X-PAYMENT-TX is ALSO blocked!
    const crossRailReplay = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/pro/signal?mint=${BONK_MINT}`, {
        headers: { "X-PAYMENT-TX": VALID_TX_SIG_1 },
      }),
      BASE_ENV,
      ctx
    );
    assert.equal(crossRailReplay.status, 402);
    assert.match((await crossRailReplay.json()).error, /replay/i);

    // 5. Valid PayAI x402 v2 flow (`PAYMENT-SIGNATURE` with CAIP-2 `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`)
    const v2PaymentHeader = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepted: {
          scheme: "exact",
          network: SOLANA_X402_V2_NETWORK,
          asset: USDC_MINT,
          amount: "5000",
          payTo: PAYOUT_WALLET,
        },
        payload: { transaction: "SIGNED_V2_SOLANA_TX_BASE64_PAYLOAD_BETA" },
      })
    ).toString("base64");
    const v2Res = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/pro/signal?mint=${BONK_MINT}`, {
        headers: { "PAYMENT-SIGNATURE": v2PaymentHeader },
      }),
      BASE_ENV,
      ctx
    );
    assert.equal(v2Res.status, 200);
    assert.equal(v2Res.headers.get("X-Cache"), "HIT");
    const v2Report = await v2Res.json();
    assert.equal(v2Report.payment.settlementMethod, "payai-facilitator");
    assert.equal(v2Report.payment.network, SOLANA_X402_V2_NETWORK);
    assert.equal(v2Report.payment.x402Version, 2);
    assert.equal(v2Report.payment.txSignature, VALID_TX_SIG_2);

    // 6. PayAI /verify rejection returns 402 and never calls /settle
    simulateVerifyReject = true;
    const settleCountBefore = calls.filter((u) => u.endsWith("/settle")).length;
    const rejectHeader = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepted: { scheme: "exact", network: SOLANA_X402_V2_NETWORK },
        payload: { transaction: "SIGNED_V2_REJECTED_PAYLOAD_GAMMA" },
      })
    ).toString("base64");
    const rejectedRes = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/pro/signal?mint=${SOL_MINT}`, {
        headers: { "PAYMENT-SIGNATURE": rejectHeader },
      }),
      BASE_ENV,
      ctx
    );
    assert.equal(rejectedRes.status, 402);
    assert.match((await rejectedRes.json()).error, /insufficient_funds/);
    assert.equal(
      calls.filter((u) => u.endsWith("/settle")).length,
      settleCountBefore
    );

    // 7. Upstream outage after /verify succeeds returns 502 and NEVER calls /settle
    simulateVerifyReject = false;
    simulateUpstreamDown = true;
    const outageHeader = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepted: { scheme: "exact", network: SOLANA_X402_V2_NETWORK },
        payload: { transaction: "SIGNED_V2_OUTAGE_SAFE_PAYLOAD_DELTA" },
      })
    ).toString("base64");
    const outageRes = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/pro/signal?mint=${SOL_MINT}`, {
        headers: { "PAYMENT-SIGNATURE": outageHeader },
      }),
      BASE_ENV,
      ctx
    );
    assert.equal(outageRes.status, 502);
    assert.equal(
      calls.filter((u) => u.endsWith("/settle")).length,
      settleCountBefore,
      "Must never settle payment when all upstreams fail with 502"
    );
  });

  it("computes exact BigInt USDC credit delta and verifies direct Solana RPC fallback (X-PAYMENT-TX) with replay protection", async () => {
    const deltaNewAta = computeUsdcCreditDelta(
      [],
      [
        {
          accountIndex: 4,
          mint: USDC_MINT,
          owner: PAYOUT_WALLET,
          uiTokenAmount: { amount: "5000", decimals: 6 },
        },
      ],
      PAYOUT_WALLET,
      USDC_MINT
    );
    assert.equal(deltaNewAta, 5000n);

    const nowMs = Date.parse("2026-11-23T08:00:00Z");
    const nowSec = Math.floor(nowMs / 1000);
    let rpcCalls = 0;

    const worker = createWorker({
      now: () => nowMs,
      cache: createMemoryCache({ now: () => nowMs }),
      fetchFn: async (input, init) => {
        const url = String(input);
        if (url === BASE_ENV.SOLANA_RPC_URL) {
          rpcCalls += 1;
          const body = JSON.parse(String(init?.body ?? "{}"));
          const sig = body.params?.[0];
          if (sig === VALID_TX_SIG_1 || sig === VALID_TX_SIG_2) {
            return Response.json(
              makeSolanaTxRpcPayload({
                blockTime: nowSec - 30,
                preAmount: "200000",
                postAmount: "205000",
              })
            );
          }
          if (sig === VALID_TX_SIG_3) {
            return Response.json(
              makeSolanaTxRpcPayload({
                blockTime: nowSec - 20,
                preAmount: "200000",
                postAmount: "204999",
              })
            );
          }
          return Response.json({ jsonrpc: "2.0", id: 1, result: null });
        }
        if (url.includes("api.dexscreener.com")) {
          return Response.json(makeMockDexBonk(nowMs));
        }
        if (url.includes("api.rugcheck.xyz") && url.endsWith("/report")) {
          return Response.json(makeMockRugCheckFullBonk());
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const { ctx, flush } = createTestCtx();

    const proRes1 = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/pro/signal?mint=${BONK_MINT}`, {
        headers: { "X-PAYMENT-TX": VALID_TX_SIG_1 },
      }),
      BASE_ENV,
      ctx
    );
    await flush();
    assert.equal(proRes1.status, 200);
    assert.ok(proRes1.headers.get("X-PAYMENT-RESPONSE"));
    assert.ok(proRes1.headers.get("PAYMENT-RESPONSE"));
    const report = await proRes1.json();
    assert.equal(report.tier, "pro");
    assert.equal(report.verdict, "LOW_RISK");
    assert.equal(report.payment.settlementMethod, "solana-rpc-postTokenBalances");
    assert.equal(report.payment.network, SOLANA_X402_V1_NETWORK);
    assert.equal(report.payment.amountMicroUsdc, "5000");
    assert.equal(report.holderConcentration.top1Pct, 8.2);
    assert.equal(report.orderFlowMicrostructure.momentumAlignment, "BULLISH_ALIGNED");
    assert.equal(rpcCalls, 1);

    // Replay blocked before RPC
    const replayRes = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/pro/signal?mint=${BONK_MINT}`, {
        headers: { "X-PAYMENT-TX": VALID_TX_SIG_1 },
      }),
      BASE_ENV,
      ctx
    );
    assert.equal(replayRes.status, 402);
    assert.match((await replayRes.json()).error, /replay/i);
    assert.equal(rpcCalls, 1);

    // JSON X-PAYMENT carrying confirmed payload.signature fallback
    const xPaymentSigFallback = Buffer.from(
      JSON.stringify({
        x402Version: 1,
        scheme: "exact",
        network: SOLANA_X402_V1_NETWORK,
        payload: { signature: VALID_TX_SIG_2 },
      })
    ).toString("base64");
    const proRes2 = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/pro/signal?mint=${BONK_MINT}`, {
        headers: { "X-PAYMENT": xPaymentSigFallback },
      }),
      BASE_ENV,
      ctx
    );
    assert.equal(proRes2.status, 200);
    assert.equal(proRes2.headers.get("X-Cache"), "HIT");

    // Underpaid transaction (4999 < 5000) rejected with 402
    const underpaidRes = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/pro/signal?mint=${BONK_MINT}`, {
        headers: { "X-PAYMENT-TX": VALID_TX_SIG_3 },
      }),
      BASE_ENV,
      ctx
    );
    assert.equal(underpaidRes.status, 402);
    assert.match((await underpaidRes.json()).error, /4999/);
  });

  it("rejects failed on-chain tx, stale tx, and wrong recipient; detects wash-volume anomaly", async () => {
    const nowMs = Date.parse("2026-11-23T08:00:00Z");
    const nowSec = Math.floor(nowMs / 1000);
    let rpcMode = "failed";

    const worker = createWorker({
      now: () => nowMs,
      cache: createMemoryCache({ now: () => nowMs }),
      fetchFn: async (input) => {
        const url = String(input);
        if (url === BASE_ENV.SOLANA_RPC_URL) {
          if (rpcMode === "failed") {
            return Response.json(
              makeSolanaTxRpcPayload({
                blockTime: nowSec - 10,
                err: { InstructionError: [0, "Custom"] },
              })
            );
          }
          if (rpcMode === "stale") {
            return Response.json(
              makeSolanaTxRpcPayload({ blockTime: nowSec - 90000 })
            );
          }
          if (rpcMode === "wrong_owner") {
            return Response.json(
              makeSolanaTxRpcPayload({
                blockTime: nowSec - 10,
                owner: "11111111111111111111111111111111",
              })
            );
          }
          return Response.json(makeSolanaTxRpcPayload({ blockTime: nowSec - 10 }));
        }
        if (url.includes("api.dexscreener.com")) {
          return Response.json({
            pairs: [
              {
                chainId: "solana",
                dexId: "raydium",
                pairAddress: "WashPool11111111111111111111111111111111111",
                baseToken: { address: BONK_MINT, name: "WashToken", symbol: "WASH" },
                quoteToken: { address: SOL_MINT, name: "SOL", symbol: "SOL" },
                priceUsd: "0.01",
                liquidity: { usd: 15000 },
                volume: { m5: 15000, h1: 80000, h6: 300000, h24: 900000 },
                txns: {
                  m5: { buys: 500, sells: 500 },
                  h1: { buys: 3000, sells: 2990 },
                  h6: { buys: 20000, sells: 20100 },
                  h24: { buys: 150000, sells: 150500 },
                },
                priceChange: { m5: 0.1, h1: -0.2, h6: 0.3, h24: 1.1 },
                fdv: 1200000,
              },
            ],
          });
        }
        if (url.endsWith("/report")) {
          return new Response("Too large", { status: 503 });
        }
        if (url.endsWith("/report/summary")) {
          return Response.json({
            tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            risks: [{ name: "High holder concentration", level: "danger", score: 500 }],
            score: 500,
            score_normalised: 65,
            lpLockedPct: 5,
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const { ctx, flush } = createTestCtx();

    for (const mode of ["failed", "stale", "wrong_owner"]) {
      rpcMode = mode;
      const bad = await worker.fetch(
        new Request(`https://solsignal.example/api/v1/pro/signal?mint=${BONK_MINT}`, {
          headers: { "X-PAYMENT-TX": VALID_TX_SIG_1 },
        }),
        BASE_ENV,
        ctx
      );
      assert.equal(bad.status, 402, `Expected mode=${mode} to be rejected with 402`);
    }

    rpcMode = "ok";
    const okRes = await worker.fetch(
      new Request(`https://solsignal.example/api/v1/pro/signal?mint=${BONK_MINT}`, {
        headers: { "X-PAYMENT-TX": VALID_TX_SIG_1 },
      }),
      BASE_ENV,
      ctx
    );
    await flush();
    assert.equal(okRes.status, 200);
    const report = await okRes.json();
    assert.equal(report.rugcheckBreakdown.dataMode, "summary_fallback");
    assert.equal(report.washVolumeAnomaly.level, "EXTREME");
    assert.ok(report.washVolumeAnomaly.score >= 70);
    assert.equal(report.verdict, "HONEYPOT_ALERT");
  });
});

describe("MCP Server: /.well-known/mcp.json & POST /mcp JSON-RPC 2.0", () => {
  it("lists tools, executes scan_solana_token, gates deep_solana_signal with PayAI x402, and unlocks when paid", async () => {
    const nowMs = Date.parse("2026-11-23T08:00:00Z");
    const nowSec = Math.floor(nowMs / 1000);
    const worker = createWorker({
      now: () => nowMs,
      cache: createMemoryCache({ now: () => nowMs }),
      fetchFn: async (input) => {
        const url = String(input);
        if (url === BASE_ENV.SOLANA_RPC_URL) {
          return Response.json(makeSolanaTxRpcPayload({ blockTime: nowSec - 15 }));
        }
        if (url.includes("api.dexscreener.com")) {
          return Response.json(makeMockDexBonk(nowMs));
        }
        if (url.includes("api.rugcheck.xyz")) {
          return Response.json(makeMockRugCheckFullBonk());
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const { ctx, flush } = createTestCtx();

    const discRes = await worker.fetch(
      new Request("https://solsignal.example/.well-known/mcp.json"),
      BASE_ENV,
      ctx
    );
    assert.equal(discRes.status, 200);
    const manifest = await discRes.json();
    assert.equal(manifest.version, "2.0.0");
    assert.equal(manifest.scoringRubricUrl, "https://solsignal.example/docs/scoring");
    assert.equal(manifest.transport.endpoint, "https://solsignal.example/mcp");
    assert.equal(manifest.pricing.paidTools.deep_solana_signal.facilitator, PAYAI_FACILITATOR);
    assert.equal(manifest.pricing.paidTools.deep_solana_signal.networks.v1, SOLANA_X402_V1_NETWORK);
    assert.equal(manifest.pricing.paidTools.deep_solana_signal.networks.v2, SOLANA_X402_V2_NETWORK);

    const listRes = await worker.fetch(
      new Request("https://solsignal.example/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      BASE_ENV,
      ctx
    );
    const listJson = await listRes.json();
    assert.deepEqual(
      listJson.result.tools.map((t) => t.name),
      ["scan_solana_token", "deep_solana_signal"]
    );
    assert.match(listJson.result.tools[1].description, /AMM Liquidity Dump Stress-Test/i);

    const freeCall = await worker.fetch(
      new Request("https://solsignal.example/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "scan_solana_token", arguments: { mint: BONK_MINT } },
        }),
      }),
      BASE_ENV,
      ctx
    );
    await flush();
    const freeJson = await freeCall.json();
    assert.equal(freeJson.result.structuredContent.tier, "free");

    const unpaidPro = await worker.fetch(
      new Request("https://solsignal.example/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "deep_solana_signal", arguments: { mint: BONK_MINT } },
        }),
      }),
      BASE_ENV,
      ctx
    );
    const unpaidJson = await unpaidPro.json();
    assert.equal(unpaidJson.result.isError, true);
    assert.equal(unpaidJson.result.structuredContent.accepts[0].network, SOLANA_X402_V1_NETWORK);
    assert.equal(unpaidJson.result.structuredContent.extensions.bazaar.discoverable, true);

    const paidPro = await worker.fetch(
      new Request("https://solsignal.example/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "deep_solana_signal",
            arguments: { mint: BONK_MINT, paymentTx: VALID_TX_SIG_1 },
          },
        }),
      }),
      BASE_ENV,
      ctx
    );
    await flush();
    assert.ok(paidPro.headers.get("X-PAYMENT-RESPONSE"));
    assert.ok(paidPro.headers.get("PAYMENT-RESPONSE"));
    const paidJson = await paidPro.json();
    assert.equal(paidJson.result.structuredContent.tier, "pro");
    assert.equal(paidJson.result.structuredContent.payment.txSignature, VALID_TX_SIG_1);

    const invalidCall = await worker.fetch(
      new Request("https://solsignal.example/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "scan_solana_token", arguments: { mint: "../bad" } },
        }),
      }),
      BASE_ENV,
      ctx
    );
    assert.equal((await invalidCall.json()).error.code, -32602);
  });
});

describe("Constant-Product AMM Dump Stress-Test Engine & /docs/scoring Rubric (v2.0.0)", () => {
  it("computes exact x*y=k AMM dump impact with R=Q_risk -> 75.0% drop and zero-division safety", () => {
    // Canonical sanity identity: R = Q_risk => (R / (R + R))^2 = 0.25 => priceDropPct = 75.0%
    const equalDump = computeConstantProductDumpImpact(100_000, 100_000);
    assert.equal(equalDump.priceAfterRatio, 0.25);
    assert.equal(equalDump.priceDropPct, 75);

    // Zero liquidity with positive sell => 100% wipeout, never NaN or Infinity
    const zeroLiq = computeConstantProductDumpImpact(0, 5_000);
    assert.equal(zeroLiq.priceAfterRatio, 0);
    assert.equal(zeroLiq.priceDropPct, 100);
    assert.ok(Number.isFinite(zeroLiq.priceDropPct));

    // Zero dump on zero or positive liquidity => 0% drop, ratio 1
    assert.deepEqual(computeConstantProductDumpImpact(0, 0), {
      reserveUsd: 0,
      dumpUsd: 0,
      priceAfterRatio: 1,
      priceDropPct: 0,
    });
    assert.deepEqual(computeConstantProductDumpImpact(250_000, 0), {
      reserveUsd: 250_000,
      dumpUsd: 0,
      priceAfterRatio: 1,
      priceDropPct: 0,
    });

    // Small dump into deep pool: R = $500k, D = $5k => (500/505)^2 = 0.9803 => 1.97% drop
    const smallDump = computeConstantProductDumpImpact(500_000, 5_000);
    assert.equal(smallDump.priceAfterRatio, 0.9803);
    assert.equal(smallDump.priceDropPct, 1.97);

    // Whale dump into thin pool: R = $5k, D = $100k => (5/105)^2 = 0.0023 => 99.77% drop
    const whaleDump = computeConstantProductDumpImpact(5_000, 100_000);
    assert.equal(whaleDump.priceAfterRatio, 0.0023);
    assert.equal(whaleDump.priceDropPct, 99.77);

    // Non-finite, negative, and extreme IEEE-754 inputs remain finite & bounded [0, 100]
    const nanSafe = computeConstantProductDumpImpact(Number.NaN, 5_000);
    assert.equal(nanSafe.priceDropPct, 100);
    const negReserve = computeConstantProductDumpImpact(-500, 5_000);
    assert.equal(negReserve.priceDropPct, 100);
    const negDump = computeConstantProductDumpImpact(100_000, -1_000);
    assert.equal(negDump.priceDropPct, 0);
    const overflowSafe = computeConstantProductDumpImpact(1e308, 1e308);
    assert.equal(overflowSafe.priceAfterRatio, 0.25);
    assert.equal(overflowSafe.priceDropPct, 75);
  });

  it("embeds deterministic AMM dump stress-test in Free & Pro signals across deep, whale-concentrated, zero-liquidity, and degraded upstream scenarios", async () => {
    const nowMs = Date.parse("2026-11-23T14:00:00Z");
    const nowSec = Math.floor(nowMs / 1000);

    // Scenario A: Deep pool (BONK mock: total liq $1.47M => R_usd = $735k)
    const workerDeep = createWorker({
      now: () => nowMs,
      cache: createMemoryCache({ now: () => nowMs }),
      fetchFn: async (input) => {
        const url = String(input);
        if (url === BASE_ENV.SOLANA_RPC_URL) {
          return Response.json(makeSolanaTxRpcPayload({ blockTime: nowSec - 10 }));
        }
        if (url.includes("api.dexscreener.com")) {
          return Response.json(makeMockDexBonk(nowMs));
        }
        if (url.includes("api.rugcheck.xyz")) {
          return Response.json(makeMockRugCheckFullBonk());
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const ctxDeep = createTestCtx();

    const freeRes = await workerDeep.fetch(
      new Request(`https://solsignal.example/api/v1/free/signal?mint=${BONK_MINT}`),
      BASE_ENV,
      ctxDeep.ctx
    );
    await ctxDeep.flush();
    assert.equal(freeRes.status, 200);
    const freeReport = await freeRes.json();
    assert.equal(freeReport.schemaVersion, "2.0");
    assert.equal(freeReport.ammDumpStress.effectiveReserveUsd, 735000);
    assert.equal(freeReport.ammDumpStress.sell5kImpactPct, 1.35);
    assert.equal(freeReport.ammDumpStress.sell25kImpactPct, 6.47);
    assert.equal(freeReport.ammDumpStress.sell100kImpactPct, 22.52);
    assert.equal(freeReport.ammDumpStress.top10HoldersDumpImpactPct, null);
    assert.equal(freeReport.ammDumpStress.dataQuality, "DEGRADED_NO_HOLDER_DATA");
    assert.equal(freeReport.ammDumpStress.clusterConcentrationRisk, "LOW");
    assert.match(freeReport.ammDumpStress.headline, /LOW AMM dump stress/);

    const proRes = await workerDeep.fetch(
      new Request(`https://solsignal.example/api/v1/pro/signal?mint=${BONK_MINT}`, {
        headers: { "X-PAYMENT-TX": VALID_TX_SIG_1 },
      }),
      BASE_ENV,
      ctxDeep.ctx
    );
    await ctxDeep.flush();
    assert.equal(proRes.status, 200);
    const proReport = await proRes.json();
    assert.equal(proReport.schemaVersion, "2.0");
    assert.equal(proReport.ammDumpStressTest.dataQuality, "FULL");
    assert.equal(proReport.ammDumpStressTest.reserveSource, "dexscreener_aggregate_half_tvl");
    assert.equal(proReport.ammDumpStressTest.effectiveReserveUsd, 735000);
    assert.equal(proReport.ammDumpStressTest.tiers.sell5k.priceDropPct, 1.35);
    assert.equal(proReport.ammDumpStressTest.tiers.sell25k.priceDropPct, 6.47);
    assert.equal(proReport.ammDumpStressTest.tiers.sell100k.priceDropPct, 22.52);
    assert.ok(
      proReport.ammDumpStressTest.top10HoldersDumpImpactPct >= 0 &&
        proReport.ammDumpStressTest.top10HoldersDumpImpactPct <= 100
    );
    assert.equal(proReport.ammDumpStressTest.clusterConcentrationRisk, "LOW");
    assert.match(proReport.ammDumpStressTest.explanation, /Top-10 holders/);

    // Scenario B: Whale-concentrated thin pool (liq $80k => R=$40k, mcap $500k, top10=62% => D=$310k => 98.69% drop)
    const workerWhale = createWorker({
      now: () => nowMs,
      cache: createMemoryCache({ now: () => nowMs }),
      fetchFn: async (input) => {
        const url = String(input);
        if (url === BASE_ENV.SOLANA_RPC_URL) {
          return Response.json(makeSolanaTxRpcPayload({ blockTime: nowSec - 10 }));
        }
        if (url.includes("api.dexscreener.com")) {
          return Response.json({
            pairs: [
              {
                chainId: "solana",
                dexId: "raydium",
                pairAddress: "WhalePool111111111111111111111111111111111",
                baseToken: { address: BONK_MINT, name: "WhaleToken", symbol: "WHL" },
                quoteToken: { address: SOL_MINT, name: "SOL", symbol: "SOL" },
                priceUsd: "0.05",
                liquidity: { usd: 80000 },
                volume: { h24: 45000 },
                marketCap: 500000,
                fdv: 500000,
              },
            ],
          });
        }
        if (url.endsWith("/report")) {
          return Response.json({
            score: 400,
            score_normalised: 45,
            lpLockedPct: 10,
            graphInsidersDetected: 6,
            topHolders: [
              { address: "W1", owner: "OW1", pct: 32, insider: true },
              { address: "W2", owner: "OW2", pct: 18, insider: true },
              { address: "W3", owner: "OW3", pct: 12, insider: false },
            ],
            risks: [],
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const ctxWhale = createTestCtx();
    const whaleRes = await workerWhale.fetch(
      new Request(`https://solsignal.example/api/v1/pro/signal?mint=${BONK_MINT}`, {
        headers: { "X-PAYMENT-TX": VALID_TX_SIG_2 },
      }),
      BASE_ENV,
      ctxWhale.ctx
    );
    await ctxWhale.flush();
    assert.equal(whaleRes.status, 200);
    const whaleReport = await whaleRes.json();
    assert.equal(whaleReport.ammDumpStressTest.effectiveReserveUsd, 40000);
    assert.equal(whaleReport.ammDumpStressTest.top10HoldersPct, 62);
    assert.equal(whaleReport.ammDumpStressTest.top10HoldersDumpUsd, 310000);
    assert.equal(whaleReport.ammDumpStressTest.top10HoldersDumpImpactPct, 98.69);
    assert.equal(whaleReport.ammDumpStressTest.clusterConcentrationRisk, "CRITICAL");
    assert.ok(
      whaleReport.riskFlags.some((f) => f.code === "AMM_DUMP_STRESS_CRITICAL")
    );

    // Scenario C: Confirmed zero-liquidity pool (0 pools on DexScreener)
    const workerZero = createWorker({
      now: () => nowMs,
      cache: createMemoryCache({ now: () => nowMs }),
      fetchFn: async (input) => {
        const url = String(input);
        if (url === BASE_ENV.SOLANA_RPC_URL) {
          return Response.json(makeSolanaTxRpcPayload({ blockTime: nowSec - 10 }));
        }
        if (url.includes("api.dexscreener.com")) {
          return Response.json({ pairs: [] });
        }
        if (url.endsWith("/report")) {
          return Response.json({
            score: 600,
            score_normalised: 70,
            lpLockedPct: 0,
            topHolders: [{ address: "Z1", owner: "OZ1", pct: 40, insider: false }],
            risks: [],
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const ctxZero = createTestCtx();
    const zeroRes = await workerZero.fetch(
      new Request(`https://solsignal.example/api/v1/pro/signal?mint=${BONK_MINT}`, {
        headers: { "X-PAYMENT-TX": VALID_TX_SIG_3 },
      }),
      BASE_ENV,
      ctxZero.ctx
    );
    await ctxZero.flush();
    assert.equal(zeroRes.status, 200);
    const zeroReport = await zeroRes.json();
    assert.equal(zeroReport.ammDumpStressTest.reserveSource, "confirmed_zero_liquidity");
    assert.equal(zeroReport.ammDumpStressTest.dataQuality, "DEGRADED_NO_LIQUIDITY");
    assert.equal(zeroReport.ammDumpStressTest.effectiveReserveUsd, 0);
    assert.equal(zeroReport.ammDumpStressTest.tiers.sell5k.priceDropPct, 100);
    assert.equal(zeroReport.ammDumpStressTest.tiers.sell25k.priceDropPct, 100);
    assert.equal(zeroReport.ammDumpStressTest.tiers.sell100k.priceDropPct, 100);
    assert.equal(zeroReport.ammDumpStressTest.top10HoldersDumpImpactPct, 100);
    assert.equal(zeroReport.ammDumpStressTest.clusterConcentrationRisk, "CRITICAL");

    // Scenario D: Degraded DexScreener outage with RugCheck pool-depth proxy fallback,
    // AND Free endpoint when DexScreener is down (UNAVAILABLE liquidity)
    const workerDegraded = createWorker({
      now: () => nowMs,
      cache: createMemoryCache({ now: () => nowMs }),
      fetchFn: async (input) => {
        const url = String(input);
        if (url === BASE_ENV.SOLANA_RPC_URL) {
          return Response.json(makeSolanaTxRpcPayload({ blockTime: nowSec - 10 }));
        }
        if (url.includes("api.dexscreener.com")) {
          return new Response("Gateway Timeout", { status: 504 });
        }
        if (url.endsWith("/report/summary")) {
          return Response.json({
            score: 120,
            score_normalised: 15,
            lpLockedPct: 50,
            risks: [],
          });
        }
        if (url.endsWith("/report")) {
          return Response.json({
            score: 120,
            score_normalised: 15,
            lpLockedPct: 50,
            totalMarketLiquidity: 200000,
            topHolders: [
              { address: "D1", owner: "OD1", pct: 25, insider: false },
              { address: "D2", owner: "OD2", pct: 25, insider: false },
            ],
            risks: [],
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const ctxDeg = createTestCtx();

    const degFreeRes = await workerDegraded.fetch(
      new Request(`https://solsignal.example/api/v1/free/signal?mint=${BONK_MINT}`),
      BASE_ENV,
      ctxDeg.ctx
    );
    await ctxDeg.flush();
    assert.equal(degFreeRes.status, 200);
    const degFree = await degFreeRes.json();
    assert.equal(degFree.degraded, true);
    assert.equal(degFree.ammDumpStress.dataQuality, "UNAVAILABLE");
    assert.equal(degFree.ammDumpStress.sell5kImpactPct, null);
    assert.equal(degFree.ammDumpStress.sell25kImpactPct, null);
    assert.equal(degFree.ammDumpStress.sell100kImpactPct, null);
    assert.equal(degFree.ammDumpStress.clusterConcentrationRisk, "HIGH");

    const degProRes = await workerDegraded.fetch(
      new Request(`https://solsignal.example/api/v1/pro/signal?mint=${BONK_MINT}`, {
        headers: { "X-PAYMENT-TX": VALID_TX_SIG_1 },
      }),
      BASE_ENV,
      ctxDeg.ctx
    );
    await ctxDeg.flush();
    assert.equal(degProRes.status, 200);
    const degPro = await degProRes.json();
    // RugCheck fallback liquidity = $200k => R = $100k; top10 = 50% of $200k proxy = $100k => R=D => 75.0%!
    assert.equal(
      degPro.ammDumpStressTest.reserveSource,
      "rugcheck_total_liquidity_fallback"
    );
    assert.equal(degPro.ammDumpStressTest.dataQuality, "PARTIAL_POOL_PROXY");
    assert.equal(degPro.ammDumpStressTest.effectiveReserveUsd, 100000);
    assert.equal(degPro.ammDumpStressTest.top10HoldersDumpUsd, 100000);
    assert.equal(degPro.ammDumpStressTest.top10HoldersDumpImpactPct, 75);
    assert.equal(degPro.ammDumpStressTest.tiers.sell100k.priceDropPct, 75);
  });

  it("serves GET /docs/scoring as transparent JSON and Markdown rubric matching docs/scoring.md", async () => {
    const worker = createWorker({ cache: createMemoryCache() });
    const { ctx } = createTestCtx();

    const jsonRes = await worker.fetch(
      new Request("https://solsignal.example/docs/scoring"),
      BASE_ENV,
      ctx
    );
    assert.equal(jsonRes.status, 200);
    assert.match(jsonRes.headers.get("Content-Type") ?? "", /application\/json/);
    assert.equal(jsonRes.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(jsonRes.headers.get("X-Content-Type-Options"), "nosniff");
    const rubric = await jsonRes.json();
    assert.equal(rubric.version, "2.0.0");
    assert.equal(rubric.schemaVersion, "2.0");
    assert.equal(rubric.ammDumpStressTest.workedReferenceCase.priceDropPct, 75);
    assert.deepEqual(rubric.ammDumpStressTest.fixedStressTiersUsd, [5000, 25000, 100000]);
    assert.match(rubric.ammDumpStressTest.formula.priceRatio, /\(R \/ \(R \+ Q_risk\)\)\^2/);
    assert.ok(rubric.rugRiskScoreRubric.verdictThresholds.length === 4);

    const mdRes = await worker.fetch(
      new Request("https://solsignal.example/docs/scoring?format=md"),
      BASE_ENV,
      ctx
    );
    assert.equal(mdRes.status, 200);
    assert.match(mdRes.headers.get("Content-Type") ?? "", /text\/markdown/);
    const mdText = await mdRes.text();
    assert.match(mdText, /P_after \/ P_before = \(R \/ \(R \+ Q_risk\)\)\^2/);
    assert.match(mdText, /75\.0%/);

    const acceptMdRes = await worker.fetch(
      new Request("https://solsignal.example/docs/scoring", {
        headers: { Accept: "text/markdown" },
      }),
      BASE_ENV,
      ctx
    );
    assert.equal(acceptMdRes.status, 200);
    assert.match(acceptMdRes.headers.get("Content-Type") ?? "", /text\/markdown/);

    const postBad = await worker.fetch(
      new Request("https://solsignal.example/docs/scoring", { method: "POST" }),
      BASE_ENV,
      ctx
    );
    assert.equal(postBad.status, 405);

    const docsFile = readFileSync(
      new URL("../docs/scoring.md", import.meta.url),
      "utf8"
    );
    assert.match(docsFile, /Upswing SolSignal v2\.0\.0/);
    assert.match(docsFile, /75\.0\\%|75\.0%/);
  });
});

describe("x402scan OpenAPI 3.1.0 Discovery, /.well-known/x402 & POST /api/v1/pro/signal", () => {
  it("serves GET /openapi.json (OpenAPI 3.1.0) with x-guidance, x-payment-info, CORS *, and 300s cache", async () => {
    const worker = createWorker({ cache: createMemoryCache() });
    const { ctx } = createTestCtx();

    const res = await worker.fetch(
      new Request("https://upswing-solsignal.upswing-labs.workers.dev/openapi.json"),
      BASE_ENV,
      ctx
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(res.headers.get("Cache-Control"), "public, max-age=300");
    assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");

    const doc = await res.json();
    assert.equal(doc.openapi, "3.1.0");
    assert.equal(doc.info.title, "Upswing SolSignal");
    assert.equal(doc.info.version, "2.0.0");
    assert.ok(typeof doc.info["x-guidance"] === "string" && doc.info["x-guidance"].length > 40);
    assert.deepEqual(doc.servers, [
      { url: "https://upswing-solsignal.upswing-labs.workers.dev" },
    ]);

    const proPost = doc.paths["/api/v1/pro/signal"].post;
    const proGet = doc.paths["/api/v1/pro/signal"].get;
    assert.equal(proPost["x-payment-info"].price.mode, "fixed");
    assert.equal(proPost["x-payment-info"].price.currency, "USD");
    assert.equal(proPost["x-payment-info"].price.amount, "0.005000");
    assert.deepEqual(proPost["x-payment-info"].protocols, [{ x402: {} }]);
    assert.equal(proPost.requestBody.required, true);
    assert.deepEqual(
      proPost.requestBody.content["application/json"].schema.required,
      ["mint"]
    );
    assert.equal(
      proPost.requestBody.content["application/json"].schema.properties.mint.minLength,
      32
    );
    assert.equal(
      proPost.requestBody.content["application/json"].schema.properties.mint.maxLength,
      44
    );
    assert.ok(proPost.responses["200"].content["application/json"].schema.properties.ammDumpStressTest);
    assert.equal(proPost.responses["402"].description, "Payment Required");

    assert.deepEqual(proGet["x-payment-info"], proPost["x-payment-info"]);
    assert.equal(proGet.parameters[0].name, "mint");
    assert.equal(proGet.parameters[0].in, "query");
    assert.equal(proGet.parameters[0].required, true);
    assert.equal(proGet.responses["402"].description, "Payment Required");

    const freeGet = doc.paths["/api/v1/free/signal"].get;
    assert.equal(freeGet.parameters[0].name, "mint");
    assert.ok(freeGet.responses["200"].content["application/json"].schema);
  });

  it("serves GET /.well-known/x402 and GET /.well-known/x402.json with universal discovery fields", async () => {
    const worker = createWorker({ cache: createMemoryCache() });
    const { ctx } = createTestCtx();

    for (const path of ["/.well-known/x402", "/.well-known/x402.json"]) {
      const res = await worker.fetch(
        new Request(`https://upswing-solsignal.upswing-labs.workers.dev${path}`),
        BASE_ENV,
        ctx
      );
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
      assert.equal(res.headers.get("Cache-Control"), "public, max-age=300");
      const manifest = await res.json();
      assert.equal(manifest.version, 1);
      assert.equal(manifest.x402Version, 2);
      assert.equal(
        manifest.openapi,
        "https://upswing-solsignal.upswing-labs.workers.dev/openapi.json"
      );
      assert.deepEqual(manifest.resources, [
        "https://upswing-solsignal.upswing-labs.workers.dev/api/v1/pro/signal",
      ]);
      assert.equal(manifest.payTo, PAYOUT_WALLET);
      assert.deepEqual(manifest.networks, [
        SOLANA_X402_V1_NETWORK,
        SOLANA_X402_V2_NETWORK,
      ]);
    }
  });

  it("returns HTTP 402 on unauthenticated POST /api/v1/pro/signal probes BEFORE body validation, validates mint before settling on paid POST, and settles cleanly", async () => {
    const nowMs = Date.parse("2026-11-23T22:55:00Z");
    const nowSec = Math.floor(nowMs / 1000);
    let outboundCalls = 0;

    const worker = createWorker({
      now: () => nowMs,
      cache: createMemoryCache({ now: () => nowMs }),
      fetchFn: async (input, init) => {
        outboundCalls += 1;
        const url = String(input);
        if (url === `${PAYAI_FACILITATOR}/verify`) {
          const reqBody = JSON.parse(String(init?.body ?? "{}"));
          assert.equal(reqBody.x402Version, 2);
          assert.equal(reqBody.paymentRequirements.network, SOLANA_X402_V2_NETWORK);
          return Response.json({ isValid: true, payer: PAYER_PUBKEY });
        }
        if (url === `${PAYAI_FACILITATOR}/settle`) {
          return Response.json({
            success: true,
            transaction: VALID_TX_SIG_1,
            network: SOLANA_X402_V2_NETWORK,
            payer: PAYER_PUBKEY,
          });
        }
        if (url === BASE_ENV.SOLANA_RPC_URL) {
          return Response.json(makeSolanaTxRpcPayload({ blockTime: nowSec - 10 }));
        }
        if (url.includes("api.dexscreener.com")) {
          return Response.json(makeMockDexBonk(nowMs));
        }
        if (url.includes("api.rugcheck.xyz")) {
          return Response.json(makeMockRugCheckFullBonk());
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const { ctx, flush } = createTestCtx();

    // 1. Unauthenticated POST with NO body -> MUST return 402 (never 400!)
    const probeEmpty = await worker.fetch(
      new Request("https://solsignal.example/api/v1/pro/signal", {
        method: "POST",
      }),
      BASE_ENV,
      ctx
    );
    assert.equal(probeEmpty.status, 402);
    assert.ok(probeEmpty.headers.get("PAYMENT-REQUIRED"));
    const probeBody = await probeEmpty.json();
    assert.equal(probeBody.accepts[0].outputSchema.input.method, "POST");
    assert.equal(probeBody.accepts[0].outputSchema.input.bodyType, "json");
    assert.equal(probeBody.extensions.bazaar.info.input.method, "POST");
    assert.equal(outboundCalls, 0);

    // 2. Unauthenticated POST with malformed JSON body -> STILL 402 BEFORE validation!
    const probeGarbage = await worker.fetch(
      new Request("https://solsignal.example/api/v1/pro/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
      BASE_ENV,
      ctx
    );
    assert.equal(probeGarbage.status, 402);
    assert.equal(outboundCalls, 0);

    // 3. Paid POST with invalid/SSRF mint -> 400 INVALID_MINT with ZERO facilitator/RPC calls!
    const v2PaymentHeader = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepted: {
          scheme: "exact",
          network: SOLANA_X402_V2_NETWORK,
          asset: USDC_MINT,
          amount: "5000",
          payTo: PAYOUT_WALLET,
        },
        payload: { transaction: "SIGNED_POST_V2_TX_PAYLOAD_001" },
      })
    ).toString("base64");

    const paidBadMint = await worker.fetch(
      new Request("https://solsignal.example/api/v1/pro/signal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-SIGNATURE": v2PaymentHeader,
        },
        body: JSON.stringify({ mint: "../etc/passwd" }),
      }),
      BASE_ENV,
      ctx
    );
    assert.equal(paidBadMint.status, 400);
    assert.equal(outboundCalls, 0, "Invalid mint on paid POST must never bill or call upstreams");

    // 4. Paid POST with empty {} body -> 400 MISSING_MINT with ZERO outbound calls!
    const paidMissingMint = await worker.fetch(
      new Request("https://solsignal.example/api/v1/pro/signal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-SIGNATURE": v2PaymentHeader,
        },
        body: JSON.stringify({}),
      }),
      BASE_ENV,
      ctx
    );
    assert.equal(paidMissingMint.status, 400);
    assert.equal(outboundCalls, 0);

    // 5. Paid POST via PayAI v2 PAYMENT-SIGNATURE + valid { mint } -> 200 OK full Pro report!
    const paidOk = await worker.fetch(
      new Request("https://solsignal.example/api/v1/pro/signal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-SIGNATURE": v2PaymentHeader,
        },
        body: JSON.stringify({ mint: BONK_MINT }),
      }),
      BASE_ENV,
      ctx
    );
    await flush();
    assert.equal(paidOk.status, 200);
    assert.ok(paidOk.headers.get("X-PAYMENT-RESPONSE"));
    assert.ok(paidOk.headers.get("PAYMENT-RESPONSE"));
    const paidReport = await paidOk.json();
    assert.equal(paidReport.tier, "pro");
    assert.equal(paidReport.mint, BONK_MINT);
    assert.equal(paidReport.payment.settlementMethod, "payai-facilitator");
    assert.equal(paidReport.payment.network, SOLANA_X402_V2_NETWORK);

    // 6. Paid POST via direct X-PAYMENT-TX fallback + valid { mint } -> 200 OK!
    const paidRpcPost = await worker.fetch(
      new Request("https://solsignal.example/api/v1/pro/signal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PAYMENT-TX": VALID_TX_SIG_2,
        },
        body: JSON.stringify({ mint: BONK_MINT }),
      }),
      BASE_ENV,
      ctx
    );
    await flush();
    assert.equal(paidRpcPost.status, 200);
    const rpcReport = await paidRpcPost.json();
    assert.equal(rpcReport.payment.settlementMethod, "solana-rpc-postTokenBalances");
    assert.equal(rpcReport.payment.txSignature, VALID_TX_SIG_2);
  });
});

describe("Live read-only smoke test against real SOL, USDC, and BONK mints", () => {
  it("fetches live DexScreener + RugCheck signals cleanly for SOL, USDC, and BONK", async () => {
    const worker = createWorker({
      cache: createMemoryCache(),
      upstreamTimeoutMs: 4000,
    });
    const { ctx, flush } = createTestCtx();

    const targets = [
      { label: "SOL", mint: SOL_MINT },
      { label: "USDC", mint: USDC_MINT },
      { label: "BONK", mint: BONK_MINT },
    ];

    for (const target of targets) {
      const res = await worker.fetch(
        new Request(
          `https://solsignal.example/api/v1/free/signal?mint=${target.mint}`,
          { headers: { "CF-Connecting-IP": "192.0.2.99" } }
        ),
        BASE_ENV,
        ctx
      );
      await flush();
      assert.equal(
        res.status,
        200,
        `Expected 200 OK for live smoke test of ${target.label}`
      );
      const report = await res.json();
      assert.equal(report.mint, target.mint);
      assert.equal(report.tier, "free");
      assert.ok(report.sources.dexscreener.ok || report.sources.rugcheck.ok);
      assert.ok(
        report.market.liquidityUsd > 100_000,
        `Expected deep liquidity for ${target.label}, got ${report.market.liquidityUsd}`
      );
      assert.equal(
        report.safety.verdict,
        "LOW_RISK",
        `Expected ${target.label} to be LOW_RISK, got ${report.safety.verdict} (score=${report.safety.rugRiskScore})`
      );
      console.log(
        `[LIVE SMOKE] ${target.label} (${report.token.symbol ?? "?"}) | score=${report.safety.rugRiskScore}/100 (${report.safety.verdict}) | liq=$${Math.round(report.market.liquidityUsd).toLocaleString("en-US")} | vol24h=$${Math.round(report.market.volume24hUsd).toLocaleString("en-US")} | pools=${report.market.poolCount} | dex=${report.sources.dexscreener.latencyMs}ms | rc=${report.sources.rugcheck.latencyMs}ms`
      );
    }
  });
});
