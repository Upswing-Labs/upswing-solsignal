// JSON-RPC 2.0 Model Context Protocol (MCP) server (`GET /.well-known/mcp.json` & `POST /mcp`)
// exposing `scan_solana_token` (free) and `deep_solana_signal` (PayAI x402 USDC-gated pro).

import {
  isValidSolanaMint,
  jsonResponse,
  readBoundedRequestJson,
} from "./security.ts";
import {
  buildX402Challenge,
  resolveX402Config,
  SOLANA_X402_V1_NETWORK,
  SOLANA_X402_V2_NETWORK,
} from "./x402.ts";
import type {
  FreeSignalReport,
  ProSignalReport,
  X402ChallengePayload,
} from "./types.ts";

const MCP_PROTOCOL_VERSION = "2025-03-26";
const MAX_MCP_BODY_BYTES = 64 * 1024; // 64 KiB

export const MCP_TOOLS = [
  {
    name: "scan_solana_token",
    description:
      "Free real-time Solana SPL token safety snapshot aggregating DexScreener market depth, RugCheck risk flags, 0-100 rug-risk score, and a constant-product AMM liquidity dump stress-test headline ($5k / $25k / $100k simultaneous sell impact).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["mint"],
      properties: {
        mint: {
          type: "string",
          description: "Solana SPL token mint address (Base58, 32-44 chars).",
          pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
        },
      },
    },
  },
  {
    name: "deep_solana_signal",
    description:
      "PayAI x402-gated (0.005 USDC on Solana mainnet) deep token intelligence report (v2.0.0): Constant-Product AMM Liquidity Dump Stress-Test ((R/(R+Q_risk))^2 with Top-10 holder dump impact %, $5k/$25k/$100k sell tiers, clusterConcentrationRisk & dataQuality), full RugCheck authority & insider breakdown, top-holder concentration, LP lock/burn, multi-pool liquidity fragmentation (HHI), 5m/1h/6h/24h order-flow imbalance, wash-volume anomaly score, and structured verdict.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["mint"],
      properties: {
        mint: {
          type: "string",
          description: "Solana SPL token mint address (Base58, 32-44 chars).",
          pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
        },
        paymentTx: {
          type: "string",
          description:
            "Optional confirmed Solana mainnet USDC transfer signature (>= 5000 micro-USDC to payTo). Alternatively pass PAYMENT-SIGNATURE (x402 v2), X-PAYMENT (x402 v1), or X-PAYMENT-TX HTTP header.",
          pattern: "^[1-9A-HJ-NP-Za-km-z]{64,96}$",
        },
      },
    },
  },
] as const;

export function buildMcpDiscoveryManifest(origin: string, env: Env) {
  const x402 = resolveX402Config(env);
  return {
    name: "upswing-solsignal",
    title: "Upswing SolSignal MCP Server",
    version: "2.0.0",
    protocolVersion: MCP_PROTOCOL_VERSION,
    description:
      "Dual-rail Solana token safety, constant-product AMM liquidity dump stress-test & microstructure signal server for AI agents (free scanner + PayAI x402 USDC deep intelligence).",
    scoringRubricUrl: `${origin}/docs/scoring`,
    transport: {
      type: "streamable-http",
      protocol: "json-rpc-2.0",
      endpoint: `${origin}/mcp`,
    },
    pricing: {
      freeTools: ["scan_solana_token"],
      paidTools: {
        deep_solana_signal: {
          protocol: "x402",
          facilitator: x402.facilitatorUrl,
          scheme: "exact",
          networks: {
            v1: SOLANA_X402_V1_NETWORK,
            v2: SOLANA_X402_V2_NETWORK,
          },
          feePayer: x402.feePayer,
          asset: x402.asset,
          maxAmountRequired: x402.maxAmountRequired,
          payTo: x402.payTo,
        },
      },
    },
    tools: MCP_TOOLS,
  };
}

export interface McpToolExecutionServices {
  executeFreeScan: (
    mint: string
  ) => Promise<
    | { ok: true; report: FreeSignalReport; cacheHit: boolean }
    | { ok: false; status: number; error: string }
  >;
  executeProScan: (
    mint: string,
    explicitPaymentTx?: string
  ) => Promise<
    | { ok: true; report: ProSignalReport; paymentResponseHeader: string }
    | { ok: false; kind: "payment_required"; challenge: X402ChallengePayload }
    | { ok: false; kind: "error"; status: number; error: string }
  >;
}

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

function rpcSuccess(
  id: string | number | null,
  result: unknown,
  extraHeaders?: Record<string, string>
): Response {
  return jsonResponse(
    {
      jsonrpc: "2.0",
      id,
      result,
    },
    { status: 200, cors: true, headers: extraHeaders }
  );
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
  httpStatus = 200
): Response {
  return jsonResponse(
    {
      jsonrpc: "2.0",
      id,
      error: data !== undefined ? { code, message, data } : { code, message },
    },
    { status: httpStatus, cors: true }
  );
}

export async function handleMcpPost(
  request: Request,
  origin: string,
  env: Env,
  services: McpToolExecutionServices
): Promise<Response> {
  const parsedBody = await readBoundedRequestJson(request, MAX_MCP_BODY_BYTES);
  if (!parsedBody.ok) {
    return rpcError(
      null,
      -32700,
      `Parse error: ${parsedBody.error}`,
      undefined,
      parsedBody.status
    );
  }

  const raw = parsedBody.data;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return rpcError(
      null,
      -32600,
      "Invalid Request: expected JSON-RPC object",
      undefined,
      400
    );
  }

  const rpc = raw as JsonRpcRequest;
  const id: string | number | null =
    typeof rpc.id === "string" || typeof rpc.id === "number" || rpc.id === null
      ? rpc.id
      : null;

  if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
    return rpcError(
      id,
      -32600,
      "Invalid Request: jsonrpc must be '2.0' and method must be a string",
      undefined,
      400
    );
  }

  switch (rpc.method) {
    case "initialize":
      return rpcSuccess(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: "upswing-solsignal",
          version: "2.0.0",
        },
        instructions:
          `Use scan_solana_token for a free safety + AMM stress snapshot or deep_solana_signal with PayAI x402 Solana USDC settlement (0.005 USDC via PAYMENT-SIGNATURE / X-PAYMENT / X-PAYMENT-TX or paymentTx) for constant-product AMM dump stress-testing and deep microstructure intelligence. Transparent rubric: ${origin}/docs/scoring`,
      });

    case "notifications/initialized":
      return jsonResponse({ ok: true }, { status: 202, cors: true });

    case "ping":
      return rpcSuccess(id, {});

    case "tools/list":
      return rpcSuccess(id, { tools: MCP_TOOLS });

    case "tools/call": {
      if (
        !rpc.params ||
        typeof rpc.params !== "object" ||
        Array.isArray(rpc.params)
      ) {
        return rpcError(
          id,
          -32602,
          "Invalid params: expected object with name and arguments"
        );
      }
      const params = rpc.params as { name?: unknown; arguments?: unknown };
      const toolName = params.name;
      const args =
        params.arguments &&
        typeof params.arguments === "object" &&
        !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};

      if (toolName === "scan_solana_token") {
        const mint = args.mint;
        if (!isValidSolanaMint(mint)) {
          return rpcError(
            id,
            -32602,
            "Invalid params: 'mint' must be a valid Solana Base58 SPL address (32-44 chars)"
          );
        }

        const outcome = await services.executeFreeScan(mint);
        if (!outcome.ok) {
          return rpcSuccess(id, {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: outcome.error,
                  status: outcome.status,
                }),
              },
            ],
          });
        }

        return rpcSuccess(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(outcome.report, null, 2),
            },
          ],
          structuredContent: outcome.report,
        });
      }

      if (toolName === "deep_solana_signal") {
        const mint = args.mint;
        if (!isValidSolanaMint(mint)) {
          return rpcError(
            id,
            -32602,
            "Invalid params: 'mint' must be a valid Solana Base58 SPL address (32-44 chars)"
          );
        }

        const paymentTx =
          typeof args.paymentTx === "string" ? args.paymentTx : undefined;
        const outcome = await services.executeProScan(mint, paymentTx);

        if (!outcome.ok && outcome.kind === "payment_required") {
          return rpcSuccess(id, {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: 402,
                    message:
                      "Payment required via PayAI x402. Settle exact 0.005 USDC on Solana and retry with PAYMENT-SIGNATURE / X-PAYMENT / X-PAYMENT-TX header or paymentTx argument.",
                    x402: outcome.challenge,
                  },
                  null,
                  2
                ),
              },
            ],
            structuredContent: outcome.challenge,
          });
        }

        if (!outcome.ok) {
          const x402 = resolveX402Config(env);
          const fallbackChallenge = buildX402Challenge(
            `${origin}/api/v1/pro/signal?mint=${encodeURIComponent(mint)}`,
            origin,
            x402,
            outcome.error
          );
          return rpcSuccess(id, {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: outcome.error,
                    status: outcome.status,
                    x402: fallbackChallenge,
                  },
                  null,
                  2
                ),
              },
            ],
          });
        }

        return rpcSuccess(
          id,
          {
            content: [
              {
                type: "text",
                text: JSON.stringify(outcome.report, null, 2),
              },
            ],
            structuredContent: outcome.report,
          },
          {
            "X-PAYMENT-RESPONSE": outcome.paymentResponseHeader,
            "PAYMENT-RESPONSE": outcome.paymentResponseHeader,
          }
        );
      }

      return rpcError(id, -32601, `Unknown MCP tool: ${String(toolName)}`);
    }

    default:
      return rpcError(id, -32601, `Method not found: ${rpc.method}`);
  }
}
