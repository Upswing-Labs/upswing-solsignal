// PayAI-compatible x402 v1 & v2 challenge builder (with outputSchema + extensions.bazaar + PAYMENT-REQUIRED),
// PayAI Facilitator /verify + /settle integration, and direct Solana RPC postTokenBalances fallback verifier.

import { getCachedJson, putCachedJson } from "./cache.ts";
import {
  fetchBoundedJson,
  isValidSolanaTxSignature,
  jsonResponse,
  sha256Hex,
} from "./security.ts";
import type {
  CacheLike,
  FetchLike,
  ProPaymentReceipt,
  SolanaX402Network,
  X402BazaarExtension,
  X402ChallengePayload,
  X402ChallengePayloadV2,
  X402HttpMethod,
  X402OutputSchema,
  X402ResourceMetadata,
} from "./types.ts";

export const SOLANA_X402_V1_NETWORK = "solana" as const;
export const SOLANA_X402_V2_NETWORK =
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const;

const DEFAULT_PAYOUT_WALLET = "9kE6pAKgW1M2J27JAX7bMkY2uGanjNGjxzrNpomA6bte";
const DEFAULT_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEFAULT_PRICE_MICRO_USDC = "5000";
const DEFAULT_FACILITATOR_URL = "https://facilitator.payai.network";
// Verified live from https://facilitator.payai.network/supported
const DEFAULT_FEE_PAYER = "CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww";
const DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const PRO_RESOURCE_DESCRIPTION =
  "Deep Solana Token Safety, Constant-Product AMM Dump Stress-Test, Holder Concentration & Liquidity Microstructure Report";
const EXAMPLE_BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const SERVICE_TAGS = [
  "solana",
  "defi",
  "security",
  "rugcheck",
  "microstructure",
  "amm-stress-test",
  "signals",
];

const MAX_FACILITATOR_RESPONSE_BYTES = 64 * 1024; // 64 KiB
const MAX_RPC_RESPONSE_BYTES = 256 * 1024; // 256 KiB
const REPLAY_CACHE_TTL_SECONDS = 86400; // 24 hours

export interface X402Config {
  payTo: string;
  asset: string;
  maxAmountRequired: string;
  facilitatorUrl: string;
  feePayer: string;
  solanaRpcUrl: string;
}

export function resolveX402Config(env: Env): X402Config {
  const payTo = env.PAYOUT_SOLANA_WALLET?.trim() || DEFAULT_PAYOUT_WALLET;
  const asset = env.USDC_SOLANA_MINT?.trim() || DEFAULT_USDC_MINT;
  const rawPrice = env.PRO_PRICE_MICRO_USDC?.trim() || DEFAULT_PRICE_MICRO_USDC;
  const maxAmountRequired = /^\d+$/.test(rawPrice)
    ? rawPrice
    : DEFAULT_PRICE_MICRO_USDC;
  const rawFacilitator =
    env.X402_FACILITATOR_URL?.trim() || DEFAULT_FACILITATOR_URL;
  const facilitatorUrl = rawFacilitator.replace(/\/+$/, "");
  const feePayer = env.X402_FEE_PAYER?.trim() || DEFAULT_FEE_PAYER;
  const solanaRpcUrl = env.SOLANA_RPC_URL?.trim() || DEFAULT_SOLANA_RPC;
  return {
    payTo,
    asset,
    maxAmountRequired,
    facilitatorUrl,
    feePayer,
    solanaRpcUrl,
  };
}

function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

function encodeBase64Json(value: unknown): string {
  return encodeBase64Utf8(JSON.stringify(value));
}

export function buildX402OutputSchema(
  method: X402HttpMethod = "GET"
): X402OutputSchema {
  const mintField = {
    type: "string" as const,
    required: true as const,
    description:
      "Solana SPL token mint address (Base58, 32-44 chars), e.g. DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  };

  return {
    input:
      method === "POST"
        ? {
            type: "http",
            method: "POST",
            discoverable: true,
            bodyType: "json",
            bodyFields: { mint: mintField },
          }
        : {
            type: "http",
            method: "GET",
            discoverable: true,
            queryParams: { mint: mintField },
          },
    output: {
      type: "object",
      description:
        "Deep Solana token safety, RugCheck authority/insider breakdown, top-holder concentration, LP lock/burn, multi-pool liquidity fragmentation (HHI), 5m/1h/6h/24h order-flow imbalance, wash-volume anomaly score, and structured verdict",
      properties: {
        verdict: {
          type: "string",
          enum: ["LOW_RISK", "CAUTION", "HIGH_RISK", "HONEYPOT_ALERT"],
          description: "Structured risk verdict for traders and autonomous agents",
        },
        rugRiskScore: {
          type: "number",
          description: "Composite rug-risk score from 0 (safest) to 100 (highest risk)",
        },
        confidence: {
          type: "string",
          enum: ["HIGH", "MEDIUM", "LOW"],
          description: "Data coverage confidence level across upstreams",
        },
        summary: {
          type: "string",
          description: "Concise natural-language microstructure synthesis",
        },
        rugcheckBreakdown: {
          type: "object",
          description: "Mint/freeze authority, transfer fee, insider graph, and RugCheck risk list",
        },
        holderConcentration: {
          type: "object",
          description: "Top 1 / 5 / 10 / 20 holder shares and insider supply concentration",
        },
        lpLockAndBurn: {
          type: "object",
          description: "LP locked percentage, locker counts, and stable-quote liquidity share",
        },
        liquidityFragmentation: {
          type: "object",
          description: "Multi-pool HHI concentration index, DEX venues, and top pool shares",
        },
        orderFlowMicrostructure: {
          type: "object",
          description: "Buy/sell ratio, buy pressure %, and flow bias across m5, h1, h6, h24",
        },
        washVolumeAnomaly: {
          type: "object",
          description: "0-100 wash-trading anomaly score, level, and concrete trigger signals",
        },
        ammDumpStressTest: {
          type: "object",
          description:
            "Constant-product AMM (x*y=k) liquidity dump stress-test: top-10 holder dump impact %, $5k/$25k/$100k simultaneous sell tiers, clusterConcentrationRisk, dataQuality, and explanation",
        },
      },
    },
  };
}

export function buildBazaarExtension(
  method: X402HttpMethod = "GET"
): X402BazaarExtension {
  const mintPropSchema = {
    type: "string",
    pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    description: "Solana SPL token mint address (Base58, 32-44 chars)",
  };

  return {
    discoverable: true,
    info: {
      tags: [...SERVICE_TAGS],
      input:
        method === "POST"
          ? {
              type: "http",
              method: "POST",
              bodyType: "json",
              body: {
                mint: EXAMPLE_BONK_MINT,
              },
            }
          : {
              type: "http",
              method: "GET",
              queryParams: {
                mint: EXAMPLE_BONK_MINT,
              },
            },
      output: {
        type: "json",
        example: {
          product: "upswing-solsignal",
          schemaVersion: "2.0",
          tier: "pro",
          mint: EXAMPLE_BONK_MINT,
          verdict: "LOW_RISK",
          rugRiskScore: 14,
          confidence: "HIGH",
          summary:
            "BONK rated LOW_RISK (risk 14/100, confidence HIGH) across 30 Solana pools; AMM dump stress LOW.",
          washVolumeAnomaly: {
            score: 0,
            level: "NORMAL",
          },
          ammDumpStressTest: {
            clusterConcentrationRisk: "LOW",
            dataQuality: "FULL",
            tiers: {
              sell5k: { dumpUsd: 5000, priceDropPct: 1.35 },
              sell25k: { dumpUsd: 25000, priceDropPct: 6.47 },
              sell100k: { dumpUsd: 100000, priceDropPct: 22.52 },
            },
          },
        },
      },
    },
    schema: {
      type: "object",
      required: ["input"],
      properties: {
        input:
          method === "POST"
            ? {
                type: "object",
                required: ["type", "method", "bodyType", "body"],
                properties: {
                  type: { const: "http" },
                  method: { enum: ["POST"] },
                  bodyType: { enum: ["json"] },
                  body: {
                    type: "object",
                    required: ["mint"],
                    properties: { mint: mintPropSchema },
                  },
                },
              }
            : {
                type: "object",
                required: ["type", "method", "queryParams"],
                properties: {
                  type: { const: "http" },
                  method: { enum: ["GET"] },
                  queryParams: {
                    type: "object",
                    required: ["mint"],
                    properties: { mint: mintPropSchema },
                  },
                },
              },
        output: {
          type: "object",
          required: ["type"],
          properties: {
            type: { type: "string" },
            example: { type: "object" },
          },
        },
      },
    },
  };
}

function buildResourceMetadata(
  resourceUrl: string,
  origin: string
): X402ResourceMetadata {
  return {
    url: resourceUrl,
    description: PRO_RESOURCE_DESCRIPTION,
    mimeType: "application/json",
    serviceName: "Upswing SolSignal",
    tags: [...SERVICE_TAGS],
    iconUrl: `${origin}/icon.svg`,
  };
}

export function buildX402Challenge(
  resourceUrl: string,
  origin: string,
  config: X402Config,
  errorMessage = "X-PAYMENT header is required",
  method: X402HttpMethod = "GET"
): X402ChallengePayload {
  const humanAmount = `${(Number(config.maxAmountRequired) / 1_000_000).toFixed(3)} USDC`;
  return {
    x402Version: 1,
    error: errorMessage,
    resource: buildResourceMetadata(resourceUrl, origin),
    accepts: [
      {
        scheme: "exact",
        network: SOLANA_X402_V1_NETWORK,
        maxAmountRequired: config.maxAmountRequired,
        resource: resourceUrl,
        description: PRO_RESOURCE_DESCRIPTION,
        mimeType: "application/json",
        payTo: config.payTo,
        maxTimeoutSeconds: 120,
        asset: config.asset,
        outputSchema: buildX402OutputSchema(method),
        extra: {
          feePayer: config.feePayer,
          assetSymbol: "USDC",
          assetDecimals: 6,
          humanAmount,
          facilitator: config.facilitatorUrl,
          caip2Network: SOLANA_X402_V2_NETWORK,
          acceptedHeaders: ["PAYMENT-SIGNATURE", "X-PAYMENT", "X-PAYMENT-TX"],
        },
      },
    ],
    extensions: {
      bazaar: buildBazaarExtension(method),
    },
  };
}

export function buildX402ChallengeV2(
  resourceUrl: string,
  origin: string,
  config: X402Config,
  errorMessage = "PAYMENT-SIGNATURE header is required",
  method: X402HttpMethod = "GET"
): X402ChallengePayloadV2 {
  return {
    x402Version: 2,
    error: errorMessage,
    resource: buildResourceMetadata(resourceUrl, origin),
    accepts: [
      {
        scheme: "exact",
        network: SOLANA_X402_V2_NETWORK,
        asset: config.asset,
        amount: config.maxAmountRequired,
        payTo: config.payTo,
        maxTimeoutSeconds: 120,
        extra: {
          feePayer: config.feePayer,
        },
      },
    ],
    extensions: {
      bazaar: buildBazaarExtension(method),
    },
  };
}

export function buildX402ChallengeResponse(
  challengeV1: X402ChallengePayload,
  challengeV2: X402ChallengePayloadV2
): Response {
  return jsonResponse(challengeV1, {
    status: 402,
    cors: true,
    headers: {
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'x402 realm="Upswing SolSignal"',
      "PAYMENT-REQUIRED": encodeBase64Json(challengeV2),
    },
  });
}

export type PaymentProofExtraction =
  | { kind: "missing" }
  | {
      kind: "facilitator";
      x402Version: 1 | 2;
      network: SolanaX402Network;
      paymentPayload: Record<string, unknown>;
      signedTransactionBlob: string;
      source: "PAYMENT-SIGNATURE" | "X-PAYMENT";
    }
  | {
      kind: "direct_tx";
      x402Version: 1 | 2;
      network: SolanaX402Network;
      txSignature: string;
      source: "X-PAYMENT-TX" | "X-PAYMENT" | "param";
    }
  | { kind: "malformed"; error: string };

export function hasAnyPaymentHeader(request: Request): boolean {
  return Boolean(
    request.headers.get("PAYMENT-SIGNATURE")?.trim() ||
      request.headers.get("X-PAYMENT")?.trim() ||
      request.headers.get("X-PAYMENT-TX")?.trim()
  );
}

function tryDecodeJsonHeader(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  try {
    const normalized = trimmed.replaceAll("-", "+").replaceAll("_", "/");
    const padded =
      normalized.length % 4 === 0
        ? normalized
        : normalized + "=".repeat(4 - (normalized.length % 4));
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const decoded = new TextDecoder().decode(bytes);
    if (decoded.trim().startsWith("{")) {
      const parsed: unknown = JSON.parse(decoded);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function isSupportedSolanaNetwork(value: unknown): value is SolanaX402Network {
  return value === SOLANA_X402_V1_NETWORK || value === SOLANA_X402_V2_NETWORK;
}

function readDirectSignatureField(obj: Record<string, unknown>): string | null {
  const keys = ["txSignature", "signature", "txHash"];
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  }
  const payload = obj.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const nested = payload as Record<string, unknown>;
    for (const key of keys) {
      const val = nested[key];
      if (typeof val === "string" && val.trim()) {
        return val.trim();
      }
    }
  }
  return null;
}

export function extractPaymentProof(
  request: Request,
  explicitSignature?: string
): PaymentProofExtraction {
  if (typeof explicitSignature === "string" && explicitSignature.trim() !== "") {
    const trimmed = explicitSignature.trim();
    if (!isValidSolanaTxSignature(trimmed)) {
      return {
        kind: "malformed",
        error: "Invalid Solana transaction signature format in paymentTx parameter",
      };
    }
    return {
      kind: "direct_tx",
      x402Version: 1,
      network: SOLANA_X402_V1_NETWORK,
      txSignature: trimmed,
      source: "param",
    };
  }

  const rawTxHeader = request.headers.get("X-PAYMENT-TX")?.trim();
  if (rawTxHeader) {
    if (!isValidSolanaTxSignature(rawTxHeader)) {
      return {
        kind: "malformed",
        error: "Invalid Solana transaction signature format in X-PAYMENT-TX header",
      };
    }
    return {
      kind: "direct_tx",
      x402Version: 1,
      network: SOLANA_X402_V1_NETWORK,
      txSignature: rawTxHeader,
      source: "X-PAYMENT-TX",
    };
  }

  const rawV2Header = request.headers.get("PAYMENT-SIGNATURE")?.trim();
  const rawV1Header = request.headers.get("X-PAYMENT")?.trim();
  const headerSource: "PAYMENT-SIGNATURE" | "X-PAYMENT" | null = rawV2Header
    ? "PAYMENT-SIGNATURE"
    : rawV1Header
      ? "X-PAYMENT"
      : null;
  const rawHeaderValue = rawV2Header || rawV1Header || "";

  if (!headerSource || !rawHeaderValue) {
    return { kind: "missing" };
  }

  // Lightweight clients may pass a confirmed Base58 tx signature directly in X-PAYMENT.
  if (headerSource === "X-PAYMENT" && isValidSolanaTxSignature(rawHeaderValue)) {
    return {
      kind: "direct_tx",
      x402Version: 1,
      network: SOLANA_X402_V1_NETWORK,
      txSignature: rawHeaderValue,
      source: "X-PAYMENT",
    };
  }

  const parsed = tryDecodeJsonHeader(rawHeaderValue);
  if (!parsed) {
    return {
      kind: "malformed",
      error: `Malformed ${headerSource} header: expected base64 JSON x402 payment payload`,
    };
  }

  const accepted =
    parsed.accepted &&
    typeof parsed.accepted === "object" &&
    !Array.isArray(parsed.accepted)
      ? (parsed.accepted as Record<string, unknown>)
      : null;

  const declaredVersion: 1 | 2 =
    parsed.x402Version === 2 || headerSource === "PAYMENT-SIGNATURE" ? 2 : 1;

  const rawNetwork = accepted?.network ?? parsed.network;
  if (rawNetwork !== undefined && !isSupportedSolanaNetwork(rawNetwork)) {
    return {
      kind: "malformed",
      error: `Unsupported x402 network '${String(rawNetwork)}': expected '${SOLANA_X402_V1_NETWORK}' (v1) or '${SOLANA_X402_V2_NETWORK}' (v2)`,
    };
  }

  const resolvedNetwork: SolanaX402Network = isSupportedSolanaNetwork(rawNetwork)
    ? rawNetwork
    : declaredVersion === 2
      ? SOLANA_X402_V2_NETWORK
      : SOLANA_X402_V1_NETWORK;

  const rawScheme = accepted?.scheme ?? parsed.scheme;
  if (rawScheme !== undefined && rawScheme !== "exact") {
    return {
      kind: "malformed",
      error: `Unsupported x402 scheme '${String(rawScheme)}': expected 'exact'`,
    };
  }

  // Rail A: Standard PayAI/x402 signed Solana transaction payload (`payload.transaction`)
  const payloadObj =
    parsed.payload &&
    typeof parsed.payload === "object" &&
    !Array.isArray(parsed.payload)
      ? (parsed.payload as Record<string, unknown>)
      : null;

  if (
    payloadObj &&
    typeof payloadObj.transaction === "string" &&
    payloadObj.transaction.trim().length > 0
  ) {
    const versionForNetwork: 1 | 2 =
      resolvedNetwork === SOLANA_X402_V2_NETWORK ? 2 : declaredVersion;
    return {
      kind: "facilitator",
      x402Version: versionForNetwork,
      network: resolvedNetwork,
      paymentPayload: parsed,
      signedTransactionBlob: payloadObj.transaction.trim(),
      source: headerSource,
    };
  }

  // Rail B: Direct confirmed Solana tx signature embedded inside JSON X-PAYMENT
  const directSig = readDirectSignatureField(parsed);
  if (directSig) {
    if (!isValidSolanaTxSignature(directSig)) {
      return {
        kind: "malformed",
        error: `${headerSource} payload contains an invalid Base58 Solana transaction signature`,
      };
    }
    return {
      kind: "direct_tx",
      x402Version: declaredVersion,
      network: resolvedNetwork,
      txSignature: directSig,
      source: "X-PAYMENT",
    };
  }

  return {
    kind: "malformed",
    error: `${headerSource} payload must include payload.transaction (for PayAI facilitator settlement) or a confirmed Solana signature`,
  };
}

function buildFacilitatorRequirements(
  x402Version: 1 | 2,
  network: SolanaX402Network,
  resourceUrl: string,
  config: X402Config
): Record<string, unknown> {
  if (x402Version === 2 || network === SOLANA_X402_V2_NETWORK) {
    return {
      scheme: "exact",
      network: SOLANA_X402_V2_NETWORK,
      asset: config.asset,
      amount: config.maxAmountRequired,
      payTo: config.payTo,
      maxTimeoutSeconds: 120,
      extra: {
        feePayer: config.feePayer,
      },
    };
  }
  return {
    scheme: "exact",
    network: SOLANA_X402_V1_NETWORK,
    maxAmountRequired: config.maxAmountRequired,
    resource: resourceUrl,
    description: PRO_RESOURCE_DESCRIPTION,
    mimeType: "application/json",
    payTo: config.payTo,
    maxTimeoutSeconds: 120,
    asset: config.asset,
    extra: {
      feePayer: config.feePayer,
    },
  };
}

interface FacilitatorVerifyResponse {
  isValid?: boolean;
  invalidReason?: string;
  payer?: string;
}

interface FacilitatorSettleResponse {
  success?: boolean;
  errorReason?: string;
  transaction?: string;
  txHash?: string;
  network?: string;
  payer?: string;
}

export type FacilitatorVerifyOutcome =
  | {
      ok: true;
      payer: string | null;
      payloadHash: string;
      paymentRequirements: Record<string, unknown>;
    }
  | {
      ok: false;
      reason: "REPLAY_DETECTED" | "FACILITATOR_UNAVAILABLE" | "PAYMENT_INVALID";
      message: string;
    };

export async function verifyWithPayAIFacilitator(params: {
  x402Version: 1 | 2;
  network: SolanaX402Network;
  paymentPayload: Record<string, unknown>;
  signedTransactionBlob: string;
  resourceUrl: string;
  config: X402Config;
  fetchFn: FetchLike;
  cache: CacheLike;
  now: () => number;
  timeoutMs: number;
}): Promise<FacilitatorVerifyOutcome> {
  const payloadHash = (
    await sha256Hex(`x402-payload:${params.signedTransactionBlob}`)
  ).slice(0, 48);
  const payloadReplayKey = `https://replay.solsignal.internal/v1/payload/${payloadHash}`;

  const alreadyUsed = await getCachedJson<{ redeemedAt?: string }>(
    params.cache,
    payloadReplayKey
  );
  if (alreadyUsed) {
    return {
      ok: false,
      reason: "REPLAY_DETECTED",
      message:
        "Payment authorization payload has already been settled (replay rejected)",
    };
  }

  const paymentRequirements = buildFacilitatorRequirements(
    params.x402Version,
    params.network,
    params.resourceUrl,
    params.config
  );

  const verifyRes = await fetchBoundedJson<FacilitatorVerifyResponse>(
    `${params.config.facilitatorUrl}/verify`,
    params.fetchFn,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: params.x402Version,
        paymentPayload: params.paymentPayload,
        paymentRequirements,
      }),
      timeoutMs: params.timeoutMs,
      maxBytes: MAX_FACILITATOR_RESPONSE_BYTES,
      now: params.now,
    }
  );

  if (!verifyRes.ok) {
    return {
      ok: false,
      reason: "FACILITATOR_UNAVAILABLE",
      message: `PayAI facilitator /verify failed: ${verifyRes.error}`,
    };
  }

  if (verifyRes.data.isValid !== true) {
    return {
      ok: false,
      reason: "PAYMENT_INVALID",
      message: `PayAI verification rejected payment: ${verifyRes.data.invalidReason ?? "invalid_payment"}`,
    };
  }

  return {
    ok: true,
    payer:
      typeof verifyRes.data.payer === "string" && verifyRes.data.payer.trim()
        ? verifyRes.data.payer.trim()
        : null,
    payloadHash,
    paymentRequirements,
  };
}

export type PaymentVerificationResult =
  | {
      ok: true;
      receipt: ProPaymentReceipt;
      paymentResponseHeader: string;
    }
  | {
      ok: false;
      reason:
        | "REPLAY_DETECTED"
        | "FACILITATOR_UNAVAILABLE"
        | "SETTLEMENT_FAILED"
        | "RPC_ERROR"
        | "TX_NOT_FOUND"
        | "TX_FAILED_ONCHAIN"
        | "TX_EXPIRED"
        | "INSUFFICIENT_PAYMENT";
      message: string;
    };

export async function settleWithPayAIFacilitator(params: {
  x402Version: 1 | 2;
  network: SolanaX402Network;
  paymentPayload: Record<string, unknown>;
  paymentRequirements: Record<string, unknown>;
  payloadHash: string;
  verifiedPayer: string | null;
  config: X402Config;
  fetchFn: FetchLike;
  cache: CacheLike;
  now: () => number;
  timeoutMs: number;
}): Promise<PaymentVerificationResult> {
  const settleRes = await fetchBoundedJson<FacilitatorSettleResponse>(
    `${params.config.facilitatorUrl}/settle`,
    params.fetchFn,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: params.x402Version,
        paymentPayload: params.paymentPayload,
        paymentRequirements: params.paymentRequirements,
      }),
      timeoutMs: params.timeoutMs,
      maxBytes: MAX_FACILITATOR_RESPONSE_BYTES,
      now: params.now,
    }
  );

  if (!settleRes.ok) {
    return {
      ok: false,
      reason: "FACILITATOR_UNAVAILABLE",
      message: `PayAI facilitator /settle failed: ${settleRes.error}`,
    };
  }

  const txSig = (
    settleRes.data.transaction ??
    settleRes.data.txHash ??
    ""
  ).trim();

  if (settleRes.data.success !== true || !txSig) {
    return {
      ok: false,
      reason: "SETTLEMENT_FAILED",
      message: `PayAI settlement rejected: ${settleRes.data.errorReason ?? "settlement_failed"}`,
    };
  }

  const settledAt = new Date(params.now()).toISOString();
  const settledNetwork: SolanaX402Network = isSupportedSolanaNetwork(
    settleRes.data.network
  )
    ? settleRes.data.network
    : params.network;
  const payer =
    (typeof settleRes.data.payer === "string" && settleRes.data.payer.trim()) ||
    params.verifiedPayer ||
    null;

  // Lock BOTH the signed payload hash and the settled Solana tx signature against replays.
  const payloadReplayKey = `https://replay.solsignal.internal/v1/payload/${params.payloadHash}`;
  const txReplayKey = `https://replay.solsignal.internal/v1/tx/${encodeURIComponent(txSig)}`;
  await Promise.all([
    putCachedJson(
      params.cache,
      payloadReplayKey,
      { redeemedAt: settledAt, txSignature: txSig },
      REPLAY_CACHE_TTL_SECONDS
    ),
    putCachedJson(
      params.cache,
      txReplayKey,
      { redeemedAt: settledAt, amountMicroUsdc: params.config.maxAmountRequired },
      REPLAY_CACHE_TTL_SECONDS
    ),
  ]);

  const receipt: ProPaymentReceipt = {
    verified: true,
    scheme: "exact",
    network: settledNetwork,
    x402Version: params.x402Version,
    settlementMethod: "payai-facilitator",
    txSignature: txSig,
    payer,
    amountMicroUsdc: params.config.maxAmountRequired,
    asset: params.config.asset,
    payTo: params.config.payTo,
    settledAt,
  };

  const paymentResponseHeader = encodeBase64Json({
    success: true,
    transaction: receipt.txSignature,
    network: receipt.network,
    payer: receipt.payer ?? "",
    amountMicroUsdc: receipt.amountMicroUsdc,
    payTo: receipt.payTo,
  });

  return { ok: true, receipt, paymentResponseHeader };
}

interface SolanaTokenBalanceEntry {
  accountIndex?: number;
  mint?: string;
  owner?: string;
  uiTokenAmount?: {
    amount?: string;
    decimals?: number;
  };
}

interface SolanaGetTransactionRpcResponse {
  jsonrpc?: string;
  error?: {
    code?: number;
    message?: string;
  };
  result?: {
    slot?: number;
    blockTime?: number | null;
    meta?: {
      err: unknown;
      preTokenBalances?: SolanaTokenBalanceEntry[];
      postTokenBalances?: SolanaTokenBalanceEntry[];
    } | null;
  } | null;
}

export function computeUsdcCreditDelta(
  preBalances: SolanaTokenBalanceEntry[] | undefined,
  postBalances: SolanaTokenBalanceEntry[] | undefined,
  payToWallet: string,
  usdcMint: string
): bigint {
  const preByAccount = new Map<number, bigint>();
  const postByAccount = new Map<number, bigint>();

  for (const entry of preBalances ?? []) {
    if (
      typeof entry.accountIndex === "number" &&
      entry.mint === usdcMint &&
      entry.owner === payToWallet &&
      typeof entry.uiTokenAmount?.amount === "string" &&
      /^\d+$/.test(entry.uiTokenAmount.amount)
    ) {
      preByAccount.set(entry.accountIndex, BigInt(entry.uiTokenAmount.amount));
    }
  }

  for (const entry of postBalances ?? []) {
    if (
      typeof entry.accountIndex === "number" &&
      entry.mint === usdcMint &&
      entry.owner === payToWallet &&
      typeof entry.uiTokenAmount?.amount === "string" &&
      /^\d+$/.test(entry.uiTokenAmount.amount)
    ) {
      postByAccount.set(entry.accountIndex, BigInt(entry.uiTokenAmount.amount));
    }
  }

  const allAccountIndices = new Set<number>([
    ...preByAccount.keys(),
    ...postByAccount.keys(),
  ]);

  let totalDelta = 0n;
  for (const idx of allAccountIndices) {
    const before = preByAccount.get(idx) ?? 0n;
    const after = postByAccount.get(idx) ?? 0n;
    totalDelta += after - before;
  }

  return totalDelta;
}

export async function verifySolanaUsdcPayment(params: {
  txSignature: string;
  x402Version?: 1 | 2;
  network?: SolanaX402Network;
  config: X402Config;
  fetchFn: FetchLike;
  cache: CacheLike;
  now: () => number;
  timeoutMs: number;
  maxPaymentAgeSeconds: number;
}): Promise<PaymentVerificationResult> {
  const replayKeyUrl = `https://replay.solsignal.internal/v1/tx/${encodeURIComponent(params.txSignature)}`;

  const existingReplay = await getCachedJson<{ redeemedAt?: string }>(
    params.cache,
    replayKeyUrl
  );
  if (existingReplay) {
    return {
      ok: false,
      reason: "REPLAY_DETECTED",
      message:
        "Payment transaction signature has already been redeemed (replay rejected)",
    };
  }

  const rpcBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getTransaction",
    params: [
      params.txSignature,
      {
        encoding: "jsonParsed",
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      },
    ],
  });

  const rpcRes = await fetchBoundedJson<SolanaGetTransactionRpcResponse>(
    params.config.solanaRpcUrl,
    params.fetchFn,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rpcBody,
      timeoutMs: params.timeoutMs,
      maxBytes: MAX_RPC_RESPONSE_BYTES,
      now: params.now,
    }
  );

  if (!rpcRes.ok) {
    return {
      ok: false,
      reason: "RPC_ERROR",
      message: `Solana RPC verification unavailable: ${rpcRes.error}`,
    };
  }

  if (rpcRes.data.error) {
    return {
      ok: false,
      reason: "RPC_ERROR",
      message: `Solana RPC returned error: ${rpcRes.data.error.message ?? "unknown"}`,
    };
  }

  const txResult = rpcRes.data.result;
  if (!txResult || !txResult.meta) {
    return {
      ok: false,
      reason: "TX_NOT_FOUND",
      message:
        "Transaction not found or not yet confirmed on Solana mainnet",
    };
  }

  if (txResult.meta.err !== null) {
    return {
      ok: false,
      reason: "TX_FAILED_ONCHAIN",
      message: "Transaction failed on-chain (meta.err is non-null)",
    };
  }

  const nowSeconds = Math.floor(params.now() / 1000);
  if (
    typeof txResult.blockTime === "number" &&
    Number.isFinite(txResult.blockTime) &&
    params.maxPaymentAgeSeconds > 0
  ) {
    const ageSeconds = nowSeconds - txResult.blockTime;
    if (ageSeconds > params.maxPaymentAgeSeconds) {
      return {
        ok: false,
        reason: "TX_EXPIRED",
        message: `Payment transaction is too old (${ageSeconds}s > max ${params.maxPaymentAgeSeconds}s)`,
      };
    }
  }

  const requiredMicroUsdc = BigInt(params.config.maxAmountRequired);
  const creditedMicroUsdc = computeUsdcCreditDelta(
    txResult.meta.preTokenBalances,
    txResult.meta.postTokenBalances,
    params.config.payTo,
    params.config.asset
  );

  if (creditedMicroUsdc < requiredMicroUsdc) {
    return {
      ok: false,
      reason: "INSUFFICIENT_PAYMENT",
      message: `Verified USDC delta to ${params.config.payTo} was ${creditedMicroUsdc.toString()} micro-USDC; required >= ${requiredMicroUsdc.toString()} micro-USDC`,
    };
  }

  const settledAt = new Date(params.now()).toISOString();
  await putCachedJson(
    params.cache,
    replayKeyUrl,
    {
      redeemedAt: settledAt,
      amountMicroUsdc: creditedMicroUsdc.toString(),
    },
    REPLAY_CACHE_TTL_SECONDS
  );

  const network = params.network ?? SOLANA_X402_V1_NETWORK;
  const x402Version = params.x402Version ?? 1;

  const receipt: ProPaymentReceipt = {
    verified: true,
    scheme: "exact",
    network,
    x402Version,
    settlementMethod: "solana-rpc-postTokenBalances",
    txSignature: params.txSignature,
    payer: null,
    amountMicroUsdc: creditedMicroUsdc.toString(),
    asset: params.config.asset,
    payTo: params.config.payTo,
    settledAt,
  };

  const paymentResponseHeader = encodeBase64Json({
    success: true,
    transaction: receipt.txSignature,
    network: receipt.network,
    payer: "",
    amountMicroUsdc: receipt.amountMicroUsdc,
    payTo: receipt.payTo,
  });

  return { ok: true, receipt, paymentResponseHeader };
}
