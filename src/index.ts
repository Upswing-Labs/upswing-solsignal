// Upswing SolSignal — Cloudflare Worker Entrypoint
// Dual-Rail Solana Token Safety & Microstructure Signal API (PayAI x402 USDC + MCP + Farcaster Mini-App)

import {
  checkFreeRateLimit,
  createMemoryCache,
  getCachedJson,
  putCachedJson,
  resolveEdgeCache,
} from "./cache.ts";
import {
  buildFarcasterManifest,
  renderIconSvg,
  renderOgSvg,
} from "./farcaster.ts";
import { buildMcpDiscoveryManifest, handleMcpPost } from "./mcp.ts";
import {
  buildOpenApiDocument,
  buildWellKnownX402Manifest,
} from "./openapi.ts";
import { buildFreeSignal, buildProSignal } from "./scoring.ts";
import {
  buildScoringRubricJson,
  renderScoringRubricMarkdown,
} from "./scoring_docs.ts";
import {
  applySecurityHeaders,
  buildCorsHeaders,
  extractClientIp,
  generateCspNonce,
  isCorsEnabledPath,
  isValidSolanaMint,
  jsonResponse,
  readBoundedRequestJson,
  resolvePublicOrigin,
} from "./security.ts";
import { renderHomeHtml } from "./ui.ts";
import {
  gatherFreeUpstream,
  gatherProUpstream,
  type ProUpstreamBundle,
} from "./upstream.ts";
import {
  buildX402Challenge,
  buildX402ChallengeResponse,
  buildX402ChallengeV2,
  extractPaymentProof,
  hasAnyPaymentHeader,
  resolveX402Config,
  settleWithPayAIFacilitator,
  SOLANA_X402_V1_NETWORK,
  SOLANA_X402_V2_NETWORK,
  verifySolanaUsdcPayment,
  verifyWithPayAIFacilitator,
} from "./x402.ts";
import type {
  CacheLike,
  FreeSignalReport,
  ProPaymentReceipt,
  ProSignalReport,
  WorkerRuntimeDeps,
  X402ChallengePayload,
  X402ChallengePayloadV2,
  X402HttpMethod,
} from "./types.ts";

const DEFAULT_UPSTREAM_TIMEOUT_MS = 4000;
const DEFAULT_MAX_PAYMENT_AGE_SECONDS = 86400;
const DEFAULT_RATE_LIMIT_PER_MIN = 15;
const DEFAULT_CACHE_TTL_SECONDS = 60;
const MAX_PRO_POST_BODY_BYTES = 16 * 1024; // 16 KiB

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createWorker(deps: WorkerRuntimeDeps = {}): ExportedHandler<Env> {
  const now = deps.now ?? (() => Date.now());
  const upstreamTimeoutMs = deps.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;
  const maxPaymentAgeSeconds =
    deps.maxPaymentAgeSeconds ?? DEFAULT_MAX_PAYMENT_AGE_SECONDS;

  // Lazy non-CF fallback cache created only if global `caches.default` is absent (e.g. local Node tests).
  let fallbackMemoryCache: CacheLike | undefined;
  const getCache = (): CacheLike =>
    resolveEdgeCache(deps.cache, () => {
      if (!fallbackMemoryCache) {
        fallbackMemoryCache = createMemoryCache({ now });
      }
      return fallbackMemoryCache;
    });

  const getFetch = () =>
    deps.fetchFn ??
    ((input: string | URL | Request, init?: RequestInit) => fetch(input, init));

  async function runFreeSignalPipeline(params: {
    mint: string;
    clientIp: string;
    origin: string;
    env: Env;
    ctx: ExecutionContext;
  }): Promise<
    | {
        ok: true;
        report: FreeSignalReport;
        cacheHit: boolean;
        rateLimitHeaders: Record<string, string>;
      }
    | {
        ok: false;
        status: number;
        error: string;
        headers?: Record<string, string>;
      }
  > {
    const cache = getCache();
    const limitPerMinute = parsePositiveInt(
      params.env.FREE_RATE_LIMIT_PER_MINUTE,
      DEFAULT_RATE_LIMIT_PER_MIN
    );
    const cacheTtlSeconds = parsePositiveInt(
      params.env.SIGNAL_CACHE_TTL_SECONDS,
      DEFAULT_CACHE_TTL_SECONDS
    );
    const x402 = resolveX402Config(params.env);

    const rl = await checkFreeRateLimit(cache, params.clientIp, limitPerMinute, now());
    const rateLimitHeaders: Record<string, string> = {
      "X-RateLimit-Limit": String(rl.limit),
      "X-RateLimit-Remaining": String(rl.remaining),
      "X-RateLimit-Reset": String(rl.resetEpochSeconds),
    };

    if (!rl.allowed) {
      return {
        ok: false,
        status: 429,
        error: `Free preview rate limit exceeded (${rl.limit} requests/minute per IP). Retry after ${rl.retryAfterSeconds}s or use the x402 Pro endpoint.`,
        headers: {
          ...rateLimitHeaders,
          "Retry-After": String(rl.retryAfterSeconds),
        },
      };
    }

    const cacheKeyUrl = `https://cache.solsignal.internal/v2/free/${encodeURIComponent(params.mint)}`;
    const cached = await getCachedJson<FreeSignalReport>(cache, cacheKeyUrl);
    if (cached) {
      return {
        ok: true,
        report: cached,
        cacheHit: true,
        rateLimitHeaders,
      };
    }

    const upstream = await gatherFreeUpstream(
      params.mint,
      getFetch(),
      upstreamTimeoutMs,
      now
    );

    if (!upstream.sources.dexscreener.ok && !upstream.sources.rugcheck.ok) {
      return {
        ok: false,
        status: 502,
        error: "All upstream Solana intelligence providers failed or timed out",
        headers: rateLimitHeaders,
      };
    }

    const report = buildFreeSignal({
      mint: params.mint,
      dex: upstream.dex,
      rcSummary: upstream.rugcheck,
      sources: upstream.sources,
      origin: params.origin,
      priceMicroUsdc: x402.maxAmountRequired,
      nowMs: now(),
    });

    const effectiveTtl = report.degraded
      ? Math.min(15, cacheTtlSeconds)
      : cacheTtlSeconds;
    params.ctx.waitUntil(
      putCachedJson(cache, cacheKeyUrl, report, effectiveTtl).catch((err) => {
        console.error(
          JSON.stringify({
            message: "free cache write failed",
            error: err instanceof Error ? err.message : String(err),
          })
        );
      })
    );

    return {
      ok: true,
      report,
      cacheHit: false,
      rateLimitHeaders,
    };
  }

  async function loadProUpstream(params: {
    mint: string;
    env: Env;
    ctx: ExecutionContext;
  }): Promise<
    | { ok: true; upstream: ProUpstreamBundle; cacheHit: boolean }
    | { ok: false; status: number; error: string }
  > {
    const cache = getCache();
    const cacheTtlSeconds = parsePositiveInt(
      params.env.SIGNAL_CACHE_TTL_SECONDS,
      DEFAULT_CACHE_TTL_SECONDS
    );
    const upstreamCacheKey = `https://cache.solsignal.internal/v1/pro-upstream/${encodeURIComponent(params.mint)}`;

    const cached = await getCachedJson<ProUpstreamBundle>(cache, upstreamCacheKey);
    if (cached) {
      return { ok: true, upstream: cached, cacheHit: true };
    }

    const upstream = await gatherProUpstream(
      params.mint,
      getFetch(),
      upstreamTimeoutMs,
      now
    );

    if (!upstream.sources.dexscreener.ok && !upstream.sources.rugcheck.ok) {
      return {
        ok: false,
        status: 502,
        error: "All upstream Solana intelligence providers failed or timed out",
      };
    }

    const degraded =
      !upstream.sources.dexscreener.ok ||
      !upstream.sources.rugcheck.ok ||
      upstream.rugcheckMode === "summary_fallback";
    const effectiveTtl = degraded ? Math.min(15, cacheTtlSeconds) : cacheTtlSeconds;

    params.ctx.waitUntil(
      putCachedJson(cache, upstreamCacheKey, upstream, effectiveTtl).catch((err) => {
        console.error(
          JSON.stringify({
            message: "pro upstream cache write failed",
            error: err instanceof Error ? err.message : String(err),
          })
        );
      })
    );

    return { ok: true, upstream, cacheHit: false };
  }

  async function runProSignalPipeline(params: {
    request: Request;
    mint: string;
    origin: string;
    env: Env;
    ctx: ExecutionContext;
    explicitPaymentTx?: string;
    httpMethod?: X402HttpMethod;
  }): Promise<
    | {
        ok: true;
        report: ProSignalReport;
        cacheHit: boolean;
        paymentResponseHeader: string;
      }
    | {
        ok: false;
        kind: "payment_required";
        challenge: X402ChallengePayload;
        challengeV2: X402ChallengePayloadV2;
      }
    | {
        ok: false;
        kind: "error";
        status: number;
        error: string;
      }
  > {
    const cache = getCache();
    const x402 = resolveX402Config(params.env);
    const httpMethod: X402HttpMethod = params.httpMethod ?? "GET";
    const resourceUrl =
      httpMethod === "POST"
        ? `${params.origin}/api/v1/pro/signal`
        : `${params.origin}/api/v1/pro/signal?mint=${encodeURIComponent(params.mint)}`;

    const rejectWithChallenge = (errorMessage: string) => ({
      ok: false as const,
      kind: "payment_required" as const,
      challenge: buildX402Challenge(
        resourceUrl,
        params.origin,
        x402,
        errorMessage,
        httpMethod
      ),
      challengeV2: buildX402ChallengeV2(
        resourceUrl,
        params.origin,
        x402,
        errorMessage,
        httpMethod
      ),
    });

    const proof = extractPaymentProof(params.request, params.explicitPaymentTx);
    if (proof.kind === "missing") {
      return rejectWithChallenge("X-PAYMENT header is required");
    }

    if (proof.kind === "malformed") {
      return rejectWithChallenge(proof.error);
    }

    let receipt: ProPaymentReceipt;
    let paymentResponseHeader: string;
    let upstream: ProUpstreamBundle;
    let cacheHit: boolean;

    if (proof.kind === "facilitator") {
      // Rail A (Primary): PayAI x402 Facilitator flow -> /verify -> fulfill -> /settle
      const verified = await verifyWithPayAIFacilitator({
        x402Version: proof.x402Version,
        network: proof.network,
        paymentPayload: proof.paymentPayload,
        signedTransactionBlob: proof.signedTransactionBlob,
        resourceUrl,
        config: x402,
        fetchFn: getFetch(),
        cache,
        now,
        timeoutMs: upstreamTimeoutMs,
      });

      if (!verified.ok) {
        return rejectWithChallenge(verified.message);
      }

      // Fetch upstream BEFORE settling so callers are never billed on a 502 outage.
      const loaded = await loadProUpstream({
        mint: params.mint,
        env: params.env,
        ctx: params.ctx,
      });
      if (!loaded.ok) {
        return {
          ok: false,
          kind: "error",
          status: loaded.status,
          error: loaded.error,
        };
      }

      const settled = await settleWithPayAIFacilitator({
        x402Version: proof.x402Version,
        network: proof.network,
        paymentPayload: proof.paymentPayload,
        paymentRequirements: verified.paymentRequirements,
        payloadHash: verified.payloadHash,
        verifiedPayer: verified.payer,
        config: x402,
        fetchFn: getFetch(),
        cache,
        now,
        timeoutMs: upstreamTimeoutMs,
      });

      if (!settled.ok) {
        return rejectWithChallenge(settled.message);
      }

      receipt = settled.receipt;
      paymentResponseHeader = settled.paymentResponseHeader;
      upstream = loaded.upstream;
      cacheHit = loaded.cacheHit;
    } else {
      // Rail B (Fallback): Direct on-chain Solana RPC postTokenBalances check for X-PAYMENT-TX
      const verification = await verifySolanaUsdcPayment({
        txSignature: proof.txSignature,
        x402Version: proof.x402Version,
        network: proof.network,
        config: x402,
        fetchFn: getFetch(),
        cache,
        now,
        timeoutMs: upstreamTimeoutMs,
        maxPaymentAgeSeconds,
      });

      if (!verification.ok) {
        return rejectWithChallenge(verification.message);
      }

      const loaded = await loadProUpstream({
        mint: params.mint,
        env: params.env,
        ctx: params.ctx,
      });
      if (!loaded.ok) {
        return {
          ok: false,
          kind: "error",
          status: loaded.status,
          error: loaded.error,
        };
      }

      receipt = verification.receipt;
      paymentResponseHeader = verification.paymentResponseHeader;
      upstream = loaded.upstream;
      cacheHit = loaded.cacheHit;
    }

    const report = buildProSignal({
      mint: params.mint,
      dex: upstream.dex,
      rcFull: upstream.rugcheckFull,
      rcSummary: upstream.rugcheckSummary,
      rugcheckMode: upstream.rugcheckMode,
      sources: upstream.sources,
      nowMs: now(),
      payment: receipt,
    });

    return {
      ok: true,
      report,
      cacheHit,
      paymentResponseHeader,
    };
  }

  return {
    async fetch(
      request: Request,
      env: Env,
      ctx: ExecutionContext
    ): Promise<Response> {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const method = request.method.toUpperCase();
      const origin = resolvePublicOrigin(request, env.PUBLIC_BASE_URL);

      try {
        // Preflight CORS on API / well-known / MCP / health routes
        if (method === "OPTIONS") {
          if (isCorsEnabledPath(pathname)) {
            const headers = new Headers(buildCorsHeaders());
            applySecurityHeaders(headers, { contentType: "json", cors: true });
            return new Response(null, { status: 204, headers });
          }
          return jsonResponse({ error: "Method not allowed" }, { status: 405 });
        }

        // 1. Web UI & Farcaster Mini-App Home
        if (pathname === "/" || pathname === "/index.html") {
          if (method !== "GET" && method !== "HEAD") {
            return jsonResponse({ error: "Method not allowed" }, { status: 405 });
          }
          const nonce = generateCspNonce();
          const html = renderHomeHtml(origin, env, nonce);
          const headers = new Headers({
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          });
          applySecurityHeaders(headers, {
            contentType: "html",
            cspNonce: nonce,
            cors: false,
          });
          return new Response(method === "HEAD" ? null : html, {
            status: 200,
            headers,
          });
        }

        // 2. Zero-cost Inline SVG Assets for Farcaster Mini-App & OG Cards
        if (pathname === "/icon.svg" || pathname === "/og.svg") {
          if (method !== "GET" && method !== "HEAD") {
            return jsonResponse({ error: "Method not allowed" }, { status: 405 });
          }
          const svg = pathname === "/icon.svg" ? renderIconSvg() : renderOgSvg();
          const headers = new Headers({
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
          });
          applySecurityHeaders(headers, { contentType: "svg", cors: false });
          return new Response(method === "HEAD" ? null : svg, {
            status: 200,
            headers,
          });
        }

        // 3. Health Check (zero secrets exposed)
        if (pathname === "/health") {
          if (method !== "GET" && method !== "HEAD") {
            return jsonResponse(
              { error: "Method not allowed" },
              { status: 405, cors: true }
            );
          }
          const x402 = resolveX402Config(env);
          return jsonResponse(
            {
              status: "ok",
              service: "upswing-solsignal",
              version: "2.0.0",
              timestamp: new Date(now()).toISOString(),
              docs: {
                openapi: `${origin}/openapi.json`,
                scoring: `${origin}/docs/scoring`,
                scoringMarkdown: `${origin}/docs/scoring?format=md`,
              },
              rails: {
                x402: {
                  versions: [1, 2],
                  discovery: `${origin}/.well-known/x402`,
                  openapi: `${origin}/openapi.json`,
                  facilitator: x402.facilitatorUrl,
                  networks: {
                    v1: SOLANA_X402_V1_NETWORK,
                    v2: SOLANA_X402_V2_NETWORK,
                  },
                  feePayer: x402.feePayer,
                  asset: x402.asset,
                  priceMicroUsdc: x402.maxAmountRequired,
                  payTo: x402.payTo,
                  bazaarDiscoverable: true,
                },
                mcp: `${origin}/mcp`,
                farcasterManifest: `${origin}/.well-known/farcaster.json`,
              },
            },
            { status: 200, cors: true, headers: { "Cache-Control": "no-store" } }
          );
        }

        // 3b. Transparent Scoring Rubric & AMM Dump Stress-Test Docs
        if (pathname === "/docs/scoring") {
          if (method !== "GET" && method !== "HEAD") {
            return jsonResponse(
              { error: "Method not allowed" },
              { status: 405, cors: true }
            );
          }
          const formatParam = (url.searchParams.get("format") ?? "").trim().toLowerCase();
          const acceptHeader = (request.headers.get("Accept") ?? "").toLowerCase();
          const wantsMarkdown =
            formatParam === "md" ||
            formatParam === "markdown" ||
            (formatParam === "" &&
              acceptHeader.includes("text/markdown") &&
              !acceptHeader.includes("application/json"));

          if (wantsMarkdown) {
            const md = renderScoringRubricMarkdown(origin);
            const headers = new Headers({
              "Content-Type": "text/markdown; charset=utf-8",
              "Cache-Control": "public, max-age=300",
            });
            applySecurityHeaders(headers, { contentType: "json", cors: true });
            return new Response(method === "HEAD" ? null : md, {
              status: 200,
              headers,
            });
          }

          const rubric = buildScoringRubricJson(origin);
          if (method === "HEAD") {
            const headers = new Headers({
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "public, max-age=300",
            });
            applySecurityHeaders(headers, { contentType: "json", cors: true });
            return new Response(null, { status: 200, headers });
          }

          return jsonResponse(rubric, {
            status: 200,
            cors: true,
            headers: { "Cache-Control": "public, max-age=300" },
          });
        }

        // 3c. OpenAPI 3.1.0 Discovery Document (x402scan / Bazaar / agents)
        if (pathname === "/openapi.json") {
          if (method !== "GET" && method !== "HEAD") {
            return jsonResponse(
              { error: "Method not allowed" },
              { status: 405, cors: true }
            );
          }
          if (method === "HEAD") {
            const headers = new Headers({
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "public, max-age=300",
            });
            applySecurityHeaders(headers, { contentType: "json", cors: true });
            return new Response(null, { status: 200, headers });
          }
          return jsonResponse(buildOpenApiDocument(origin, env), {
            status: 200,
            cors: true,
            headers: { "Cache-Control": "public, max-age=300" },
          });
        }

        // 3d. Universal x402 Well-Known Discovery Manifest
        if (
          pathname === "/.well-known/x402" ||
          pathname === "/.well-known/x402.json"
        ) {
          if (method !== "GET" && method !== "HEAD") {
            return jsonResponse(
              { error: "Method not allowed" },
              { status: 405, cors: true }
            );
          }
          if (method === "HEAD") {
            const headers = new Headers({
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "public, max-age=300",
            });
            applySecurityHeaders(headers, { contentType: "json", cors: true });
            return new Response(null, { status: 200, headers });
          }
          return jsonResponse(buildWellKnownX402Manifest(origin, env), {
            status: 200,
            cors: true,
            headers: { "Cache-Control": "public, max-age=300" },
          });
        }

        // 4. Farcaster Mini-App Discovery Manifest
        if (pathname === "/.well-known/farcaster.json") {
          if (method !== "GET" && method !== "HEAD") {
            return jsonResponse(
              { error: "Method not allowed" },
              { status: 405, cors: true }
            );
          }
          return jsonResponse(buildFarcasterManifest(origin, env), {
            status: 200,
            cors: true,
            headers: { "Cache-Control": "public, max-age=300" },
          });
        }

        // 5. MCP Discovery Manifest
        if (pathname === "/.well-known/mcp.json") {
          if (method !== "GET" && method !== "HEAD") {
            return jsonResponse(
              { error: "Method not allowed" },
              { status: 405, cors: true }
            );
          }
          return jsonResponse(buildMcpDiscoveryManifest(origin, env), {
            status: 200,
            cors: true,
            headers: { "Cache-Control": "public, max-age=300" },
          });
        }

        // 6. MCP JSON-RPC 2.0 Endpoint
        if (pathname === "/mcp") {
          if (method !== "POST") {
            return jsonResponse(
              {
                error: "Method not allowed: send JSON-RPC 2.0 POST requests to /mcp",
                discovery: `${origin}/.well-known/mcp.json`,
              },
              { status: 405, cors: true }
            );
          }

          const clientIp = extractClientIp(request);
          return await handleMcpPost(request, origin, env, {
            executeFreeScan: async (mint: string) => {
              const res = await runFreeSignalPipeline({
                mint,
                clientIp,
                origin,
                env,
                ctx,
              });
              if (!res.ok) {
                return { ok: false, status: res.status, error: res.error };
              }
              return { ok: true, report: res.report, cacheHit: res.cacheHit };
            },
            executeProScan: async (mint: string, explicitPaymentTx?: string) => {
              const res = await runProSignalPipeline({
                request,
                mint,
                origin,
                env,
                ctx,
                explicitPaymentTx,
              });
              if (!res.ok) {
                return res;
              }
              return {
                ok: true,
                report: res.report,
                paymentResponseHeader: res.paymentResponseHeader,
              };
            },
          });
        }

        // 7. Free Rate-Limited Token Signal API
        if (pathname === "/api/v1/free/signal") {
          if (method !== "GET") {
            return jsonResponse(
              { error: "Method not allowed" },
              { status: 405, cors: true }
            );
          }

          const mint = url.searchParams.get("mint")?.trim() ?? "";
          if (!isValidSolanaMint(mint)) {
            return jsonResponse(
              {
                error:
                  "Invalid 'mint' query parameter: must be a strict Base58 Solana SPL mint address (32-44 chars)",
                code: "INVALID_MINT",
              },
              { status: 400, cors: true, headers: { "Cache-Control": "no-store" } }
            );
          }

          const outcome = await runFreeSignalPipeline({
            mint,
            clientIp: extractClientIp(request),
            origin,
            env,
            ctx,
          });

          if (!outcome.ok) {
            return jsonResponse(
              { error: outcome.error },
              {
                status: outcome.status,
                cors: true,
                headers: {
                  "Cache-Control": "no-store",
                  ...(outcome.headers ?? {}),
                },
              }
            );
          }

          console.log(
            JSON.stringify({
              message: "free signal served",
              mint,
              cacheHit: outcome.cacheHit,
              verdict: outcome.report.safety.verdict,
              degraded: outcome.report.degraded,
            })
          );

          return jsonResponse(outcome.report, {
            status: 200,
            cors: true,
            headers: {
              "Cache-Control": `public, max-age=${parsePositiveInt(env.SIGNAL_CACHE_TTL_SECONDS, DEFAULT_CACHE_TTL_SECONDS)}`,
              "X-Cache": outcome.cacheHit ? "HIT" : "MISS",
              ...outcome.rateLimitHeaders,
            },
          });
        }

        // 8. Pro x402 Payment-Gated Deep Signal API (GET & POST — PayAI Facilitator + Solana RPC Fallback)
        if (pathname === "/api/v1/pro/signal") {
          if (method !== "GET" && method !== "POST") {
            return jsonResponse(
              { error: "Method not allowed" },
              { status: 405, cors: true }
            );
          }

          const x402Method: X402HttpMethod = method === "POST" ? "POST" : "GET";
          const hasPayment = hasAnyPaymentHeader(request);
          let mint = "";

          if (x402Method === "POST") {
            // CRITICAL x402scan rule: unauthenticated POST probes (even with empty/missing body)
            // MUST return HTTP 402 BEFORE body validation can return HTTP 400.
            if (!hasPayment) {
              const x402 = resolveX402Config(env);
              const canonicalResource = `${origin}/api/v1/pro/signal`;
              return buildX402ChallengeResponse(
                buildX402Challenge(
                  canonicalResource,
                  origin,
                  x402,
                  "X-PAYMENT header is required",
                  "POST"
                ),
                buildX402ChallengeV2(
                  canonicalResource,
                  origin,
                  x402,
                  "PAYMENT-SIGNATURE header is required",
                  "POST"
                )
              );
            }

            // Authenticated POST: parse bounded JSON body { mint } and validate Base58 BEFORE settling.
            const parsedBody = await readBoundedRequestJson(
              request,
              MAX_PRO_POST_BODY_BYTES
            );
            if (!parsedBody.ok) {
              return jsonResponse(
                {
                  error: `Invalid JSON body: ${parsedBody.error}. Expected { "mint": "<SPL_MINT>" }`,
                  code: "INVALID_BODY",
                },
                {
                  status: parsedBody.status,
                  cors: true,
                  headers: { "Cache-Control": "no-store" },
                }
              );
            }
            const bodyObj =
              parsedBody.data &&
              typeof parsedBody.data === "object" &&
              !Array.isArray(parsedBody.data)
                ? (parsedBody.data as Record<string, unknown>)
                : null;
            const bodyMint =
              typeof bodyObj?.mint === "string" ? bodyObj.mint.trim() : "";
            mint = bodyMint || (url.searchParams.get("mint")?.trim() ?? "");

            if (!mint) {
              return jsonResponse(
                {
                  error:
                    "Missing 'mint' field in JSON body: pass { \"mint\": \"<SPL_MINT>\" } (Base58, 32-44 chars)",
                  code: "MISSING_MINT",
                },
                { status: 400, cors: true, headers: { "Cache-Control": "no-store" } }
              );
            }
            if (!isValidSolanaMint(mint)) {
              return jsonResponse(
                {
                  error:
                    "Invalid 'mint' field: must be a strict Base58 Solana SPL mint address (32-44 chars)",
                  code: "INVALID_MINT",
                },
                { status: 400, cors: true, headers: { "Cache-Control": "no-store" } }
              );
            }
          } else {
            const rawMintParam = url.searchParams.get("mint");
            mint = rawMintParam?.trim() ?? "";

            // Allow discovery crawlers (x402scan, x402.new, PayAI Bazaar) probing without ?mint=
            // to receive a valid HTTP 402 discovery manifest, while rejecting malformed mints (SSRF).
            if (!mint) {
              if (!hasPayment) {
                const x402 = resolveX402Config(env);
                const canonicalResource = `${origin}/api/v1/pro/signal`;
                return buildX402ChallengeResponse(
                  buildX402Challenge(
                    canonicalResource,
                    origin,
                    x402,
                    "X-PAYMENT header is required",
                    "GET"
                  ),
                  buildX402ChallengeV2(
                    canonicalResource,
                    origin,
                    x402,
                    "PAYMENT-SIGNATURE header is required",
                    "GET"
                  )
                );
              }
              return jsonResponse(
                {
                  error:
                    "Missing 'mint' query parameter: pass a valid Base58 Solana SPL mint address (32-44 chars)",
                  code: "MISSING_MINT",
                },
                { status: 400, cors: true, headers: { "Cache-Control": "no-store" } }
              );
            }

            if (!isValidSolanaMint(mint)) {
              return jsonResponse(
                {
                  error:
                    "Invalid 'mint' query parameter: must be a strict Base58 Solana SPL mint address (32-44 chars)",
                  code: "INVALID_MINT",
                },
                { status: 400, cors: true, headers: { "Cache-Control": "no-store" } }
              );
            }
          }

          const outcome = await runProSignalPipeline({
            request,
            mint,
            origin,
            env,
            ctx,
            httpMethod: x402Method,
          });

          if (!outcome.ok && outcome.kind === "payment_required") {
            console.log(
              JSON.stringify({
                message: "x402 payment challenge issued",
                mint,
                reason: outcome.challenge.error,
              })
            );
            return buildX402ChallengeResponse(
              outcome.challenge,
              outcome.challengeV2
            );
          }

          if (!outcome.ok) {
            return jsonResponse(
              { error: outcome.error },
              {
                status: outcome.status,
                cors: true,
                headers: { "Cache-Control": "no-store" },
              }
            );
          }

          console.log(
            JSON.stringify({
              message: "pro signal served",
              mint,
              verdict: outcome.report.verdict,
              settlementMethod: outcome.report.payment.settlementMethod,
              network: outcome.report.payment.network,
              txSignature: outcome.report.payment.txSignature,
              amountMicroUsdc: outcome.report.payment.amountMicroUsdc,
              cacheHit: outcome.cacheHit,
            })
          );

          return jsonResponse(outcome.report, {
            status: 200,
            cors: true,
            headers: {
              "Cache-Control": "private, no-store",
              "X-Cache": outcome.cacheHit ? "HIT" : "MISS",
              "X-PAYMENT-RESPONSE": outcome.paymentResponseHeader,
              "PAYMENT-RESPONSE": outcome.paymentResponseHeader,
            },
          });
        }

        return jsonResponse(
          {
            error: "Not found",
            endpoints: [
              "/",
              "/health",
              "/openapi.json",
              "/.well-known/x402",
              "/.well-known/x402.json",
              "/docs/scoring",
              "/api/v1/free/signal?mint=<SPL_MINT>",
              "/api/v1/pro/signal",
              "/.well-known/mcp.json",
              "/mcp",
              "/.well-known/farcaster.json",
            ],
          },
          { status: 404, cors: isCorsEnabledPath(pathname) }
        );
      } catch (err) {
        console.error(
          JSON.stringify({
            message: "unhandled worker error",
            method,
            pathname,
            error: err instanceof Error ? err.message : String(err),
          })
        );
        return jsonResponse(
          { error: "Internal server error" },
          { status: 500, cors: isCorsEnabledPath(pathname) }
        );
      }
    },
  };
}

const defaultWorker = createWorker();

export default defaultWorker satisfies ExportedHandler<Env>;
