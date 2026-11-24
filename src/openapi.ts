// OpenAPI 3.1.0 discovery document (`GET /openapi.json`) for x402scan & Bazaar indexers,
// plus `GET /.well-known/x402` / `GET /.well-known/x402.json` universal crawler manifest.

import {
  resolveX402Config,
  SOLANA_X402_V1_NETWORK,
  SOLANA_X402_V2_NETWORK,
} from "./x402.ts";

const EXAMPLE_BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function formatUsdSixDecimals(microUsdc: string): string {
  const num = Number(microUsdc) / 1_000_000;
  return Number.isFinite(num) ? num.toFixed(6) : "0.005000";
}

function buildProSignalResponseSchema() {
  return {
    type: "object",
    required: [
      "product",
      "schemaVersion",
      "tier",
      "mint",
      "generatedAt",
      "degraded",
      "verdict",
      "confidence",
      "summary",
      "rugRiskScore",
      "token",
      "market",
      "riskFlags",
      "rugcheckBreakdown",
      "holderConcentration",
      "lpLockAndBurn",
      "liquidityFragmentation",
      "orderFlowMicrostructure",
      "washVolumeAnomaly",
      "ammDumpStressTest",
      "sources",
      "payment",
    ],
    properties: {
      product: { type: "string", const: "upswing-solsignal" },
      schemaVersion: { type: "string", const: "2.0" },
      tier: { type: "string", const: "pro" },
      mint: { type: "string", description: "Validated Solana SPL token mint address" },
      generatedAt: { type: "string", format: "date-time" },
      degraded: { type: "boolean" },
      verdict: {
        type: "string",
        enum: ["LOW_RISK", "CAUTION", "HIGH_RISK", "HONEYPOT_ALERT"],
      },
      confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
      summary: { type: "string" },
      rugRiskScore: { type: "integer", minimum: 0, maximum: 100 },
      token: {
        type: "object",
        properties: {
          name: { type: ["string", "null"] },
          symbol: { type: ["string", "null"] },
          priceUsd: { type: ["number", "null"] },
          priceNative: { type: ["number", "null"] },
          imageUrl: { type: ["string", "null"] },
          primaryDex: { type: ["string", "null"] },
          primaryPairAddress: { type: ["string", "null"] },
          pairCreatedAt: { type: ["string", "null"] },
        },
      },
      market: {
        type: "object",
        properties: {
          liquidityUsd: { type: "number" },
          volume24hUsd: { type: "number" },
          fdvUsd: { type: ["number", "null"] },
          marketCapUsd: { type: ["number", "null"] },
          fdvToLiquidityRatio: { type: ["number", "null"] },
          volume24hToLiquidityRatio: { type: ["number", "null"] },
          poolCount: { type: "integer" },
          priceChange24hPct: { type: ["number", "null"] },
        },
      },
      riskFlags: {
        type: "array",
        items: {
          type: "object",
          properties: {
            code: { type: "string" },
            severity: { type: "string", enum: ["info", "warn", "danger"] },
            label: { type: "string" },
            detail: { type: "string" },
          },
        },
      },
      rugcheckBreakdown: {
        type: "object",
        properties: {
          dataMode: { type: "string", enum: ["full", "summary_fallback", "unavailable"] },
          rawScore: { type: ["number", "null"] },
          scoreNormalised: { type: ["number", "null"] },
          rugged: { type: "boolean" },
          tokenProgram: { type: ["string", "null"] },
          creator: { type: ["string", "null"] },
          creatorBalance: { type: ["number", "null"] },
          mintAuthorityActive: { type: ["boolean", "null"] },
          freezeAuthorityActive: { type: ["boolean", "null"] },
          mutableMetadata: { type: ["boolean", "null"] },
          transferFeePct: { type: ["number", "null"] },
          totalHolders: { type: ["integer", "null"] },
          graphInsidersDetected: { type: ["integer", "null"] },
          insiderNetworkCount: { type: ["integer", "null"] },
          jupVerified: { type: ["boolean", "null"] },
          deployPlatform: { type: ["string", "null"] },
          risks: { type: "array", items: { type: "object" } },
        },
      },
      holderConcentration: {
        type: "object",
        properties: {
          available: { type: "boolean" },
          top1Pct: { type: ["number", "null"] },
          top5Pct: { type: ["number", "null"] },
          top10Pct: { type: ["number", "null"] },
          top20Pct: { type: ["number", "null"] },
          insiderHolderCount: { type: "integer" },
          insiderSupplyPct: { type: ["number", "null"] },
          concentrationRisk: {
            type: "string",
            enum: ["LOW", "MODERATE", "HIGH", "CRITICAL", "UNAVAILABLE"],
          },
          topHolders: { type: "array", items: { type: "object" } },
        },
      },
      lpLockAndBurn: {
        type: "object",
        properties: {
          lpLockedPct: { type: ["number", "null"] },
          lpBurnedOrLockedEstimatePct: { type: ["number", "null"] },
          totalLPProviders: { type: ["integer", "null"] },
          lockerCount: { type: ["integer", "null"] },
          totalMarketLiquidityUsd: { type: ["number", "null"] },
          totalStableLiquidityUsd: { type: ["number", "null"] },
          stableLiquiditySharePct: { type: ["number", "null"] },
          status: {
            type: "string",
            enum: ["STRONG_LOCK", "PARTIAL_LOCK", "UNLOCKED_OR_UNKNOWN"],
          },
        },
      },
      liquidityFragmentation: {
        type: "object",
        properties: {
          totalLiquidityUsd: { type: "number" },
          poolCount: { type: "integer" },
          dexCount: { type: "integer" },
          dexes: { type: "array", items: { type: "string" } },
          dominantPoolSharePct: { type: ["number", "null"] },
          hhiIndex: { type: ["integer", "null"] },
          fragmentationGrade: {
            type: "string",
            enum: ["CONCENTRATED", "BALANCED", "FRAGMENTED", "NO_POOLS"],
          },
          topPools: { type: "array", items: { type: "object" } },
        },
      },
      orderFlowMicrostructure: {
        type: "object",
        properties: {
          m5: { type: "object" },
          h1: { type: "object" },
          h6: { type: "object" },
          h24: { type: "object" },
          momentumAlignment: {
            type: "string",
            enum: ["BULLISH_ALIGNED", "BEARISH_ALIGNED", "DIVERGENT", "LOW_ACTIVITY"],
          },
        },
      },
      washVolumeAnomaly: {
        type: "object",
        properties: {
          score: { type: "integer", minimum: 0, maximum: 100 },
          level: {
            type: "string",
            enum: ["NORMAL", "ELEVATED", "SUSPICIOUS", "EXTREME"],
          },
          volumeToLiquidityRatio24h: { type: ["number", "null"] },
          avgTradeSizeUsd24h: { type: ["number", "null"] },
          signals: { type: "array", items: { type: "string" } },
        },
      },
      ammDumpStressTest: {
        type: "object",
        description:
          "Constant-product AMM (x*y=k) liquidity dump stress-test across $5k/$25k/$100k sell tiers and top-10 holder dump impact",
        properties: {
          clusterConcentrationRisk: {
            type: "string",
            enum: ["LOW", "MODERATE", "HIGH", "CRITICAL", "UNAVAILABLE"],
          },
          dataQuality: { type: "string" },
          tiers: { type: "object" },
          explanation: { type: "string" },
        },
      },
      sources: { type: "object" },
      payment: {
        type: "object",
        properties: {
          verified: { type: "boolean" },
          scheme: { type: "string" },
          network: { type: "string" },
          x402Version: { type: "integer" },
          settlementMethod: { type: "string" },
          txSignature: { type: "string" },
          payer: { type: ["string", "null"] },
          amountMicroUsdc: { type: "string" },
          asset: { type: "string" },
          payTo: { type: "string" },
          settledAt: { type: "string", format: "date-time" },
        },
      },
    },
  };
}

function buildFreeSignalResponseSchema() {
  return {
    type: "object",
    required: [
      "product",
      "schemaVersion",
      "tier",
      "mint",
      "generatedAt",
      "degraded",
      "token",
      "market",
      "safety",
      "sources",
      "upgrade",
    ],
    properties: {
      product: { type: "string", const: "upswing-solsignal" },
      schemaVersion: { type: "string", const: "2.0" },
      tier: { type: "string", const: "free" },
      mint: { type: "string" },
      generatedAt: { type: "string", format: "date-time" },
      degraded: { type: "boolean" },
      token: { type: "object" },
      market: { type: "object" },
      safety: {
        type: "object",
        properties: {
          rugRiskScore: { type: "integer", minimum: 0, maximum: 100 },
          verdict: {
            type: "string",
            enum: ["LOW_RISK", "CAUTION", "HIGH_RISK", "HONEYPOT_ALERT"],
          },
          lpLockedPct: { type: ["number", "null"] },
          rugcheckScoreNormalised: { type: ["number", "null"] },
          riskFlags: { type: "array", items: { type: "object" } },
        },
      },
      sources: { type: "object" },
      upgrade: { type: "object" },
    },
  };
}

export function buildOpenApiDocument(origin: string, env: Env) {
  const x402 = resolveX402Config(env);
  const priceAmountUsd = formatUsdSixDecimals(x402.maxAmountRequired);
  const paymentInfo = {
    price: {
      mode: "fixed",
      currency: "USD",
      amount: priceAmountUsd,
    },
    protocols: [{ x402: {} }],
  };
  const proResponseSchema = buildProSignalResponseSchema();
  const freeResponseSchema = buildFreeSignalResponseSchema();

  return {
    openapi: "3.1.0",
    info: {
      title: "Upswing SolSignal",
      version: "2.0.0",
      description:
        "Real-time Solana SPL token rug-risk heuristic, AMM liquidity fragmentation, holder concentration, order-flow imbalance & wash-volume microstructure intelligence.",
      "x-guidance":
        "Use GET /api/v1/free/signal?mint=<SPL_MINT> for a free rate-limited basic safety snapshot, or POST /api/v1/pro/signal (JSON body { mint }) / GET /api/v1/pro/signal?mint=<SPL_MINT> ($0.005 USDC via PayAI x402 on Solana) for full deep microstructure, holder concentration, LP lock & wash-volume anomaly reports.",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/v1/pro/signal": {
        post: {
          operationId: "proSolanaSignalPost",
          summary: "Deep Solana SPL Token Safety & Microstructure Signal (POST)",
          description:
            "x402-gated ($0.005 USDC on Solana via PayAI) full RugCheck authority & insider breakdown, top-holder concentration, LP lock/burn, multi-pool liquidity fragmentation (HHI), 5m/1h/6h/24h order-flow imbalance, wash-volume anomaly score, and structured risk verdict.",
          "x-payment-info": paymentInfo,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["mint"],
                  additionalProperties: false,
                  properties: {
                    mint: {
                      type: "string",
                      minLength: 32,
                      maxLength: 44,
                      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
                      description: "Solana SPL token mint address (Base58)",
                      example: EXAMPLE_BONK_MINT,
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Deep Solana Token Safety & Liquidity Microstructure Report",
              content: {
                "application/json": {
                  schema: proResponseSchema,
                },
              },
            },
            "402": {
              description: "Payment Required",
            },
            "400": {
              description: "Invalid or missing Solana SPL mint address",
            },
          },
        },
        get: {
          operationId: "proSolanaSignalGet",
          summary: "Deep Solana SPL Token Safety & Microstructure Signal (GET)",
          description:
            "x402-gated ($0.005 USDC on Solana via PayAI) full RugCheck authority & insider breakdown, top-holder concentration, LP lock/burn, multi-pool liquidity fragmentation (HHI), 5m/1h/6h/24h order-flow imbalance, wash-volume anomaly score, and structured risk verdict.",
          "x-payment-info": paymentInfo,
          parameters: [
            {
              name: "mint",
              in: "query",
              required: true,
              description: "Solana SPL token mint address (Base58)",
              schema: {
                type: "string",
                minLength: 32,
                maxLength: 44,
                pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
              },
              example: EXAMPLE_BONK_MINT,
            },
          ],
          responses: {
            "200": {
              description: "Deep Solana Token Safety & Liquidity Microstructure Report",
              content: {
                "application/json": {
                  schema: proResponseSchema,
                },
              },
            },
            "402": {
              description: "Payment Required",
            },
            "400": {
              description: "Invalid or missing Solana SPL mint address",
            },
          },
        },
      },
      "/api/v1/free/signal": {
        get: {
          operationId: "freeSolanaSignalGet",
          summary: "Free Rate-Limited Solana SPL Token Safety Snapshot",
          description:
            "Free rate-limited preview aggregating live DexScreener liquidity/volume metrics and RugCheck summary risk flags with a 0-100 rug-risk heuristic score.",
          parameters: [
            {
              name: "mint",
              in: "query",
              required: true,
              description: "Solana SPL token mint address (Base58)",
              schema: {
                type: "string",
                minLength: 32,
                maxLength: 44,
                pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
              },
              example: EXAMPLE_BONK_MINT,
            },
          ],
          responses: {
            "200": {
              description: "Basic Solana Token Safety Snapshot",
              content: {
                "application/json": {
                  schema: freeResponseSchema,
                },
              },
            },
            "400": {
              description: "Invalid or missing Solana SPL mint address",
            },
            "429": {
              description: "Free preview per-IP rate limit exceeded",
            },
          },
        },
      },
    },
  };
}

export function buildWellKnownX402Manifest(origin: string, env: Env) {
  const x402 = resolveX402Config(env);
  return {
    version: 1,
    x402Version: 2,
    openapi: `${origin}/openapi.json`,
    resources: [`${origin}/api/v1/pro/signal`],
    facilitator: x402.facilitatorUrl,
    networks: [SOLANA_X402_V1_NETWORK, SOLANA_X402_V2_NETWORK],
    feePayer: x402.feePayer,
    asset: x402.asset,
    priceMicroUsdc: x402.maxAmountRequired,
    payTo: x402.payTo,
    instructions:
      "Use POST /api/v1/pro/signal with JSON { \"mint\": \"<SPL_MINT>\" } or GET /api/v1/pro/signal?mint=<SPL_MINT> ($0.005 USDC via PayAI x402 on Solana). Free snapshot available at GET /api/v1/free/signal?mint=<SPL_MINT>.",
  };
}
