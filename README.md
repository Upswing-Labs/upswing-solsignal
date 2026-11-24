# Upswing SolSignal (`PayAI x402` USDC + Bazaar + Official MCP Registry + Farcaster Mini-App)

Production-grade, **$0-infrastructure** Cloudflare Worker serving real-time Solana SPL token safety and liquidity microstructure intelligence across three distribution rails:

1. **Human Web Scanner & Farcaster Mini-App (`GET /`, `GET /.well-known/farcaster.json`)** — Dark-mode scanner with rate-limited free preview checks and interactive `x402` Pro unlocking.
2. **PayAI `x402` v1 & v2 USDC Micropayment API (`GET /api/v1/pro/signal`)** — Live-verified against `https://facilitator.payai.network/supported` (`solana` for v1 body + CAIP-2 `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` in `PAYMENT-REQUIRED` v2 header, `extra.feePayer: CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww`, `outputSchema`, and `extensions.bazaar` for automatic `PayAI Bazaar` / `x402scan` / `x402.new` indexing). Supports PayAI Facilitator `/verify` + `/settle` (`PAYMENT-SIGNATURE` / `X-PAYMENT`, zero API key needed on shared `exact` lane) **and** direct Solana RPC `postTokenBalances` fallback (`X-PAYMENT-TX`).
3. **Native AI Agent MCP Server (`GET /.well-known/mcp.json`, `POST /mcp`, `server.json`)** — JSON-RPC 2.0 Streamable HTTP MCP server exposing `scan_solana_token` (free) and `deep_solana_signal` (`x402`-gated pro), plus an Official MCP Registry (`2025-12-11`) `server.json` manifest ready for registry submission.

## Architecture & Security Guarantees

- **$0 Infra / Workers Free Tier (`100k req/day`)**: Zero KV, zero Durable Objects, zero R2, zero D1, zero paid add-ons. Uses Cloudflare's built-in Cache API for 60s signal caching, SHA-256 IP rate limiting, and 24h cross-rail `x402` payment replay protection.
- **Zero Custody / Zero Secrets on Edge**: Payout wallet (`9kE6pAKgW1M2J27JAX7bMkY2uGanjNGjxzrNpomA6bte`) is public deposit-only via `wrangler.jsonc` `vars.PAYOUT_SOLANA_WALLET`. PayAI facilitator (`https://facilitator.payai.network`) requires no API key on the shared Solana `exact` lane. Zero private keys anywhere in code or config.
- **Verify -> Fulfill -> Settle Safety**: On the PayAI facilitator rail, `/verify` runs first, upstream DexScreener + RugCheck data is fetched second, and `/settle` executes only if upstream data succeeds — callers are never billed on a `502` upstream outage.
- **Hardened Input & Memory Bounds**: Strict Base58 validation on SPL mints (`32–44` chars) and Solana tx signatures (`64–96` chars), `4s` outbound timeouts with graceful single-upstream degradation, bounded `ReadableStream` response caps, per-request cryptographic CSP nonces on `/`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and scoped CORS exposing `PAYMENT-REQUIRED`, `PAYMENT-RESPONSE`, and `X-PAYMENT-RESPONSE`.

## Endpoints

| Method & Path | Description |
| --- | --- |
| `GET /` | Dark-mode Solana Token Scanner (v2.0.0 AMM Dump Stress-Test UI) + live API docs + Farcaster `fc:miniapp` meta tags |
| `GET /docs/scoring` | Transparent v2.0.0 scoring rubric, exact constant-product AMM dump formula `(R/(R+Q_risk))^2`, weights, and thresholds (`?format=md` for Markdown; see also `docs/scoring.md`) |
| `GET /api/v1/free/signal?mint=<SPL_MINT>` | Rate-limited free safety + AMM stress headline snapshot (DexScreener + RugCheck summary, 60s cache, 0–100 rug-risk score, `$5k/$25k/$100k` sell impact) |
| `GET /api/v1/pro/signal?mint=<SPL_MINT>` | `HTTP 402` PayAI `x402` v1/v2 + Bazaar challenge (probe-friendly without `?mint=`); unlocks Deep Pro Signal with full Constant-Product AMM Dump Stress-Test (`top10HoldersDumpImpactPct`, `$5k/$25k/$100k` tiers, `clusterConcentrationRisk`) via `PAYMENT-SIGNATURE`, `X-PAYMENT`, or `X-PAYMENT-TX` |
| `GET /.well-known/mcp.json` | MCP discovery manifest & PayAI x402 pricing metadata |
| `POST /mcp` | JSON-RPC 2.0 MCP endpoint (`initialize`, `tools/list`, `tools/call`) |
| `GET /.well-known/farcaster.json` | Ready-to-sign Farcaster Mini-App manifest template |
| `GET /icon.svg`, `GET /og.svg` | Inline zero-cost SVG Mini-App icon & OG preview card |
| `GET /health` | Clean JSON health check (zero secrets exposed) |

## Local Verification (Zero Dependencies Required on Node 24+)

```bash
cd products/solsignal_x402
npm test
```

Dry-run bundle build:

```bash
cd products/solsignal_x402
npx wrangler deploy --dry-run --outdir dist
```

Run the SURVIVOR-OS static anti-honeypot security scanner:

```bash
python scripts/scan_untrusted_code.py products/solsignal_x402
```

## 1-Command Production Deploy (Owner Morning Review)

Verify `wrangler.jsonc` (`vars.PAYOUT_SOLANA_WALLET`), authenticate Wrangler once (`npx wrangler login`), then deploy to Cloudflare Workers Free Tier:

```bash
cd products/solsignal_x402
npx wrangler deploy
```

### Post-Deploy Distribution Checklist

1. **x402scan / x402.new / PayAI Bazaar**: Submit `https://<deployed-host>/api/v1/pro/signal` — the endpoint emits compliant v1 body (`network: "solana"`, `outputSchema`, `extensions.bazaar`) and v2 `PAYMENT-REQUIRED` header (`network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"`, `extra.feePayer`), and auto-indexes on PayAI Bazaar upon the first settled PayAI transaction.
2. **Official MCP Registry / Glama / Smithery / PulseMCP**: Update `websiteUrl`, `icons[0].src`, `remotes[0].url`, and namespace `name` in `server.json` to match your deployed hostname & verified publisher namespace, then publish with `mcp-publisher`.
3. **Farcaster Mini-App domain verification**: Generate the signed `accountAssociation` (`header`, `payload`, `signature`) for your deployed domain, paste into `wrangler.jsonc` `vars.FARCASTER_*`, and re-run `npx wrangler deploy`.
