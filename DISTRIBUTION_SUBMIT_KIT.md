# Upswing SolSignal — Production Distribution & Directory Submit Kit

**Live Production Base URL:** `https://upswing-solsignal.upswing-labs.workers.dev`
**Verified Live:** `2026-11-23` (`/health` 200, `/api/v1/free/signal` 200, `/api/v1/pro/signal` 402 + v2 `PAYMENT-REQUIRED` header `2488B`, `/.well-known/mcp.json` 200, `POST /mcp` 200).

## 1. x402 Directories (Zero-Cost Programmatic Discovery)
Submit this exact Pro endpoint URL (it returns PayAI v1 JSON body + v2 `PAYMENT-REQUIRED` header + `outputSchema` + `extensions.bazaar` even without `?mint=`):
- **Endpoint URL:** `https://upswing-solsignal.upswing-labs.workers.dev/api/v1/pro/signal`
- **Price:** `0.005 USDC` (`5000` micro-USDC) per call on Solana (`solana` / `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`)
- **Facilitator:** `https://facilitator.payai.network`
- **Targets:**
  1. `https://www.x402scan.com` (Add Resource → paste Pro endpoint URL above)
  2. `https://x402.new` / PayAI Bazaar (auto-indexes upon first settled PayAI transaction or manual submission)

## 2. MCP Server Directories (AI Agent Distribution)
- **Streamable HTTP MCP Endpoint:** `https://upswing-solsignal.upswing-labs.workers.dev/mcp`
- **Discovery Manifest:** `https://upswing-solsignal.upswing-labs.workers.dev/.well-known/mcp.json`
- **Tools Exposed:**
  - `scan_solana_token` (Free: DexScreener + RugCheck 0–100 rug-risk score)
  - `deep_solana_signal` (Pro: PayAI x402 USDC microstructure & holder concentration report)
- **Targets:**
  1. **Official MCP Registry (`2025-12-11`):** update `"name"` in `server.json` to your verified GitHub org namespace (e.g., `"io.github.Upswing-Labs/upswing-solsignal"`), then publish via `mcp-publisher`.
  2. **Glama (`glama.ai/mcp/servers`)** — submit remote HTTP endpoint URL.
  3. **Smithery (`smithery.ai`)** — submit remote HTTP endpoint URL.
  4. **PulseMCP (`pulsemcp.com`)** — submit website + remote MCP URL.

## 3. Farcaster Mini-App (Optional Follow-up)
- Manifest URL: `https://upswing-solsignal.upswing-labs.workers.dev/.well-known/farcaster.json`
- Once you generate a signed `accountAssociation` for `upswing-solsignal.upswing-labs.workers.dev`, set `FARCASTER_HEADER`, `FARCASTER_PAYLOAD`, and `FARCASTER_SIGNATURE` in `wrangler.jsonc` and re-run `npx wrangler deploy`.
