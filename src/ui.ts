// Crisp, high-craft dark-mode web UI (`GET /`) with live free Solana token scanner,
// interactive x402 Pro challenge & payment unlocker, developer/AI agent API docs,
// Farcaster Mini-App `<meta name="fc:miniapp">` tags, and strict per-request CSP nonces.

import { buildFarcasterMetaTags } from "./farcaster.ts";
import { escapeHtmlAttr } from "./security.ts";
import { resolveX402Config } from "./x402.ts";

export function renderHomeHtml(origin: string, env: Env, cspNonce: string): string {
  const x402 = resolveX402Config(env);
  const farcasterTags = buildFarcasterMetaTags(origin);
  const safeOrigin = escapeHtmlAttr(origin);
  const safeWallet = escapeHtmlAttr(x402.payTo);
  const priceUsdc = (Number(x402.maxAmountRequired) / 1_000_000).toFixed(3);
  const rateLimit = env.FREE_RATE_LIMIT_PER_MINUTE?.trim() || "15";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Upswing SolSignal — Real-Time Solana Token Safety &amp; Liquidity Microstructure Scanner</title>
    <meta name="description" content="Real-time Solana SPL rug-risk scanner, liquidity microstructure analytics, x402 USDC payment-gated pro signals, MCP server, and Farcaster Mini-App." />
    <meta property="og:title" content="Upswing SolSignal — Solana Token Safety &amp; x402 Signal API" />
    <meta property="og:description" content="Instant SPL rug-risk checks + 0.005 USDC x402 deep microstructure reports for traders and AI agents." />
    <meta property="og:image" content="${safeOrigin}/og.svg" />
    <link rel="icon" type="image/svg+xml" href="/icon.svg" />
    ${farcasterTags}
    <style nonce="${cspNonce}">
      :root {
        --bg: #070b14;
        --panel: rgba(13, 21, 38, 0.88);
        --panel-solid: #0d1526;
        --border: rgba(148, 163, 184, 0.16);
        --border-strong: rgba(20, 241, 149, 0.32);
        --text: #f1f5f9;
        --muted: #94a3b8;
        --emerald: #14f195;
        --cyan: #00d1ff;
        --purple: #9945ff;
        --amber: #f59e0b;
        --rose: #fb7185;
        --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        --sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        background:
          radial-gradient(900px 420px at 12% -10%, rgba(20, 241, 149, 0.13), transparent 60%),
          radial-gradient(760px 420px at 90% -5%, rgba(153, 69, 255, 0.15), transparent 60%),
          var(--bg);
        color: var(--text);
        font-family: var(--sans);
        line-height: 1.5;
        min-height: 100vh;
      }
      .shell {
        max-width: 1040px;
        margin: 0 auto;
        padding: 28px 18px 64px;
      }
      .topbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 24px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .brand img {
        width: 38px;
        height: 38px;
        border-radius: 10px;
      }
      .brand-title {
        font-size: 1.15rem;
        font-weight: 700;
        letter-spacing: -0.02em;
      }
      .brand-sub {
        font-size: 0.8rem;
        color: var(--muted);
      }
      .pill-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .pill {
        font-family: var(--mono);
        font-size: 0.72rem;
        padding: 5px 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(15, 23, 42, 0.72);
        color: var(--muted);
        text-decoration: none;
      }
      .pill-green { border-color: rgba(20, 241, 149, 0.4); color: var(--emerald); }
      .pill-cyan { border-color: rgba(0, 209, 255, 0.4); color: var(--cyan); }
      .pill-purple { border-color: rgba(153, 69, 255, 0.45); color: #c084fc; }
      .hero {
        margin-bottom: 22px;
      }
      .hero h1 {
        margin: 0 0 8px;
        font-size: clamp(1.6rem, 3.2vw, 2.35rem);
        letter-spacing: -0.03em;
        line-height: 1.15;
      }
      .hero p {
        margin: 0;
        color: var(--muted);
        max-width: 760px;
        font-size: 0.96rem;
      }
      .hero p a { color: var(--cyan); text-decoration: none; }
      .card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 20px;
        margin-bottom: 18px;
        backdrop-filter: blur(10px);
      }
      .scanner-form {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .mint-input {
        flex: 1 1 320px;
        background: #060a12;
        border: 1px solid rgba(148, 163, 184, 0.25);
        color: var(--text);
        font-family: var(--mono);
        font-size: 0.9rem;
        padding: 12px 14px;
        border-radius: 11px;
        outline: none;
      }
      .mint-input:focus {
        border-color: var(--emerald);
        box-shadow: 0 0 0 3px rgba(20, 241, 149, 0.14);
      }
      .btn {
        cursor: pointer;
        border: none;
        border-radius: 11px;
        padding: 12px 18px;
        font-weight: 600;
        font-size: 0.9rem;
        transition: opacity 0.15s ease, transform 0.12s ease;
      }
      .btn:hover { opacity: 0.92; }
      .btn:active { transform: translateY(1px); }
      .btn-primary {
        background: linear-gradient(135deg, var(--emerald), var(--cyan));
        color: #041016;
      }
      .btn-secondary {
        background: rgba(153, 69, 255, 0.16);
        color: #d8b4fe;
        border: 1px solid rgba(153, 69, 255, 0.45);
      }
      .presets {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
        font-size: 0.78rem;
        color: var(--muted);
      }
      .preset-btn {
        cursor: pointer;
        background: rgba(30, 41, 59, 0.72);
        border: 1px solid var(--border);
        color: var(--text);
        font-family: var(--mono);
        font-size: 0.75rem;
        padding: 4px 10px;
        border-radius: 8px;
      }
      .preset-btn:hover { border-color: var(--cyan); color: var(--cyan); }
      .status-line {
        margin-top: 12px;
        font-family: var(--mono);
        font-size: 0.8rem;
        color: var(--muted);
        min-height: 1.2em;
      }
      .result-box { display: none; margin-top: 16px; }
      .result-box.visible { display: block; }
      .verdict-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding-bottom: 14px;
        border-bottom: 1px solid var(--border);
        margin-bottom: 14px;
      }
      .token-heading {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .token-name {
        font-size: 1.2rem;
        font-weight: 700;
      }
      .token-mint {
        font-family: var(--mono);
        font-size: 0.76rem;
        color: var(--muted);
        word-break: break-all;
      }
      .badge {
        font-family: var(--mono);
        font-weight: 700;
        font-size: 0.8rem;
        padding: 6px 12px;
        border-radius: 999px;
      }
      .badge-LOW_RISK { background: rgba(20, 241, 149, 0.14); color: var(--emerald); border: 1px solid rgba(20, 241, 149, 0.45); }
      .badge-CAUTION { background: rgba(245, 158, 11, 0.16); color: var(--amber); border: 1px solid rgba(245, 158, 11, 0.45); }
      .badge-HIGH_RISK { background: rgba(251, 113, 133, 0.16); color: var(--rose); border: 1px solid rgba(251, 113, 133, 0.45); }
      .badge-HONEYPOT_ALERT { background: rgba(239, 68, 68, 0.24); color: #fecaca; border: 1px solid #ef4444; }
      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(165px, 1fr));
        gap: 10px;
        margin-bottom: 14px;
      }
      .metric {
        background: rgba(6, 10, 18, 0.75);
        border: 1px solid var(--border);
        border-radius: 11px;
        padding: 11px 13px;
      }
      .metric-label {
        font-size: 0.72rem;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .metric-val {
        font-family: var(--mono);
        font-size: 1.02rem;
        font-weight: 700;
        margin-top: 3px;
      }
      .flags-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .flag-item {
        padding: 9px 12px;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: rgba(6, 10, 18, 0.65);
        font-size: 0.84rem;
      }
      .flag-danger { border-color: rgba(251, 113, 133, 0.45); }
      .flag-warn { border-color: rgba(245, 158, 11, 0.42); }
      .flag-info { border-color: rgba(0, 209, 255, 0.35); }
      .flag-title { font-weight: 600; font-family: var(--mono); font-size: 0.78rem; }
      .flag-detail { color: var(--muted); font-size: 0.8rem; margin-top: 2px; }
      .pro-unlock {
        margin-top: 14px;
        padding-top: 14px;
        border-top: 1px solid var(--border);
      }
      .pro-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 8px;
      }
      .code-panel {
        background: #050810;
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 14px;
        font-family: var(--mono);
        font-size: 0.78rem;
        overflow-x: auto;
        white-space: pre;
        color: #cbd5e1;
        margin: 10px 0 0;
      }
      .docs-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
        gap: 14px;
      }
      .endpoint-title {
        font-family: var(--mono);
        font-size: 0.84rem;
        font-weight: 700;
        color: var(--emerald);
        margin: 0 0 6px;
      }
      .endpoint-desc {
        font-size: 0.84rem;
        color: var(--muted);
        margin: 0 0 8px;
      }
      .footer {
        margin-top: 28px;
        font-size: 0.78rem;
        color: var(--muted);
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 10px;
      }
      .footer a { color: var(--cyan); text-decoration: none; }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <div class="brand">
          <img src="/icon.svg" alt="Upswing SolSignal logo" />
          <div>
            <div class="brand-title">Upswing SolSignal v2.0.0</div>
            <div class="brand-sub">Real-Time Solana Token Safety &amp; AMM Dump Stress-Test API</div>
          </div>
        </div>
        <nav class="pill-row" aria-label="Discovery endpoints">
          <span class="pill pill-green">v2.0.0 &middot; AMM Dump Stress-Test</span>
          <span class="pill pill-green">x402: ${priceUsdc} USDC</span>
          <a class="pill pill-cyan" href="/docs/scoring">Scoring Rubric</a>
          <a class="pill pill-cyan" href="/.well-known/mcp.json">MCP Discovery</a>
          <a class="pill pill-purple" href="/.well-known/farcaster.json">Farcaster Manifest</a>
          <a class="pill" href="/health">Health</a>
        </nav>
      </header>

      <section class="hero">
        <h1>Instant Solana SPL Rug-Risk &amp; AMM Dump Stress-Test Intelligence</h1>
        <p>
          Dual-rail edge scanner built for human traders and autonomous AI agents. Run free rate-limited safety + constant-product AMM sell-shock snapshots (${rateLimit}/min per IP, 60s edge cache) or unlock Top-10 holder dump impact, <code>$5k/$25k/$100k</code> stress tiers, LP lock/burn, multi-pool HHI, order-flow imbalance, and wash-volume analytics via <strong>HTTP 402 (x402) Solana USDC</strong>. Read the open math in <a href="/docs/scoring">/docs/scoring</a>.
        </p>
      </section>

      <section class="card" aria-label="Interactive token scanner">
        <form id="scan-form" class="scanner-form">
          <input
            id="mint-input"
            class="mint-input"
            type="text"
            placeholder="Paste Solana SPL mint address (e.g. DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263)"
            autocomplete="off"
            spellcheck="false"
            required
          />
          <button id="scan-btn" type="submit" class="btn btn-primary">Free Scan</button>
          <button id="pro-probe-btn" type="button" class="btn btn-secondary">Inspect x402 Pro</button>
        </form>
        <div class="presets">
          <span>Quick presets:</span>
          <button type="button" class="preset-btn" data-mint="DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263">BONK</button>
          <button type="button" class="preset-btn" data-mint="So11111111111111111111111111111111111111112">SOL</button>
          <button type="button" class="preset-btn" data-mint="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v">USDC</button>
          <button type="button" class="preset-btn" data-mint="JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN">JUP</button>
        </div>
        <div id="status-line" class="status-line">Ready. Paste any Base58 Solana SPL mint address.</div>

        <div id="result-box" class="result-box">
          <div class="verdict-header">
            <div class="token-heading">
              <div id="res-token-name" class="token-name"></div>
              <div id="res-token-mint" class="token-mint"></div>
            </div>
            <div id="res-verdict" class="badge"></div>
          </div>
          <div id="metrics-grid" class="metrics-grid"></div>
          <div id="flags-list" class="flags-list"></div>

          <div class="pro-unlock">
            <div class="endpoint-title">Unlock Deep Pro Signal (x402 &middot; ${priceUsdc} USDC to ${safeWallet})</div>
            <div class="endpoint-desc">Send &ge; ${x402.maxAmountRequired} micro-USDC on Solana mainnet to the payout wallet, then paste the confirmed transaction signature below to fetch the Pro Microstructure Report.</div>
            <div class="pro-row">
              <input
                id="tx-input"
                class="mint-input"
                type="text"
                placeholder="Paste confirmed Solana USDC tx signature (X-PAYMENT-TX)"
                autocomplete="off"
                spellcheck="false"
              />
              <button id="pro-unlock-btn" type="button" class="btn btn-secondary">Verify &amp; Unlock Pro</button>
            </div>
          </div>
          <pre id="raw-json" class="code-panel"></pre>
        </div>
      </section>

      <section class="card" aria-label="Developer and AI agent documentation">
        <div class="docs-grid">
          <div>
            <div class="endpoint-title">GET /api/v1/free/signal?mint=&lt;SPL_MINT&gt;</div>
            <p class="endpoint-desc">Rate-limited free preview (${rateLimit} req/min/IP, 60s Cache API). Aggregates DexScreener + RugCheck summary with 4s timeouts and graceful fallback.</p>
            <pre class="code-panel">curl "${safeOrigin}/api/v1/free/signal?mint=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"</pre>
          </div>
          <div>
            <div class="endpoint-title">GET /api/v1/pro/signal?mint=&lt;SPL_MINT&gt;</div>
            <p class="endpoint-desc">PayAI x402 v1/v2 &amp; Bazaar discoverable (${priceUsdc} USDC on Solana: <code>solana</code> &amp; CAIP-2 <code>solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp</code>). Supports PayAI Facilitator (<code>PAYMENT-SIGNATURE</code> / <code>X-PAYMENT</code>) and direct Solana RPC fallback (<code>X-PAYMENT-TX</code>).</p>
            <pre class="code-panel">curl -i "${safeOrigin}/api/v1/pro/signal?mint=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"

# Automated PayAI x402 v1/v2 clients settle via PAYMENT-SIGNATURE or X-PAYMENT.
# Direct fallback after sending ${priceUsdc} USDC to ${safeWallet}:
curl -H "X-PAYMENT-TX: &lt;SOLANA_TX_SIG&gt;" \\
  "${safeOrigin}/api/v1/pro/signal?mint=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"</pre>
          </div>
          <div>
            <div class="endpoint-title">POST /mcp &amp; GET /.well-known/mcp.json</div>
            <p class="endpoint-desc">Native JSON-RPC 2.0 MCP server exposing <code>scan_solana_token</code> (free) and <code>deep_solana_signal</code> (x402 pro) for AI agents.</p>
            <pre class="code-panel">curl -X POST "${safeOrigin}/mcp" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'</pre>
          </div>
          <div>
            <div class="endpoint-title">GET /docs/scoring</div>
            <p class="endpoint-desc">Transparent v2.0.0 scoring rubric, exact constant-product AMM formula <code>P_after/P_before = (R/(R+Q_risk))^2</code>, component weights, and risk thresholds (JSON or <code>?format=md</code>).</p>
            <pre class="code-panel">curl "${safeOrigin}/docs/scoring"
curl "${safeOrigin}/docs/scoring?format=md"</pre>
          </div>
          <div>
            <div class="endpoint-title">GET /.well-known/farcaster.json</div>
            <p class="endpoint-desc">Farcaster Mini-App discovery manifest + <code>fc:miniapp</code> embed metadata on <code>/</code>. Zero custody, zero edge secrets, $0 Workers Free Tier.</p>
            <pre class="code-panel">Payout (Deposit-Only):
${safeWallet}
USDC Mint:
${escapeHtmlAttr(x402.asset)}</pre>
          </div>
        </div>
      </section>

      <footer class="footer">
        <span>Upswing SolSignal v2.0.0 &middot; Read-only on-chain intelligence &middot; Zero custody, zero private keys on edge</span>
        <span>
          <a href="/docs/scoring">scoring rubric</a> &middot;
          <a href="/.well-known/mcp.json">mcp.json</a> &middot;
          <a href="/.well-known/farcaster.json">farcaster.json</a> &middot;
          <a href="/health">health</a>
        </span>
      </footer>
    </main>

    <script nonce="${cspNonce}">
      (function () {
        const form = document.getElementById("scan-form");
        const mintInput = document.getElementById("mint-input");
        const txInput = document.getElementById("tx-input");
        const statusLine = document.getElementById("status-line");
        const resultBox = document.getElementById("result-box");
        const tokenNameEl = document.getElementById("res-token-name");
        const tokenMintEl = document.getElementById("res-token-mint");
        const verdictEl = document.getElementById("res-verdict");
        const metricsGrid = document.getElementById("metrics-grid");
        const flagsList = document.getElementById("flags-list");
        const rawJsonEl = document.getElementById("raw-json");
        const proProbeBtn = document.getElementById("pro-probe-btn");
        const proUnlockBtn = document.getElementById("pro-unlock-btn");

        function fmtUsd(val) {
          if (typeof val !== "number" || !Number.isFinite(val)) return "N/A";
          if (val >= 1e9) return "$" + (val / 1e9).toFixed(2) + "B";
          if (val >= 1e6) return "$" + (val / 1e6).toFixed(2) + "M";
          if (val >= 1e3) return "$" + (val / 1e3).toFixed(1) + "K";
          return "$" + val.toFixed(2);
        }

        function clearNode(node) {
          while (node.firstChild) node.removeChild(node.firstChild);
        }

        function addMetric(label, value) {
          const card = document.createElement("div");
          card.className = "metric";
          const lbl = document.createElement("div");
          lbl.className = "metric-label";
          lbl.textContent = label;
          const val = document.createElement("div");
          val.className = "metric-val";
          val.textContent = value;
          card.appendChild(lbl);
          card.appendChild(val);
          metricsGrid.appendChild(card);
        }

        function renderReport(data, httpStatus, cacheHeader) {
          resultBox.classList.add("visible");
          rawJsonEl.textContent = JSON.stringify(data, null, 2);
          clearNode(metricsGrid);
          clearNode(flagsList);

          if (httpStatus === 402) {
            tokenNameEl.textContent = "HTTP 402 Payment Required (x402)";
            tokenMintEl.textContent = data.error || "Payment required";
            verdictEl.className = "badge badge-CAUTION";
            verdictEl.textContent = "x402 CHALLENGE";
            const accept = Array.isArray(data.accepts) ? data.accepts[0] : null;
            if (accept) {
              addMetric("Scheme", accept.scheme + " / " + accept.network);
              addMetric("Price", (accept.extra && accept.extra.humanAmount) || accept.maxAmountRequired);
              addMetric("Asset", "USDC (SPL)");
              addMetric("Pay To", accept.payTo.slice(0, 8) + "..." + accept.payTo.slice(-6));
            }
            return;
          }

          if (!data || !data.market) {
            tokenNameEl.textContent = "Request Error (" + httpStatus + ")";
            tokenMintEl.textContent = (data && data.error) || "Unable to scan token";
            verdictEl.className = "badge badge-HIGH_RISK";
            verdictEl.textContent = "ERROR";
            return;
          }

          const verdict = data.verdict || (data.safety && data.safety.verdict) || "CAUTION";
          const riskScore =
            typeof data.rugRiskScore === "number"
              ? data.rugRiskScore
              : data.safety && typeof data.safety.rugRiskScore === "number"
                ? data.safety.rugRiskScore
                : 0;
          const symbol = (data.token && data.token.symbol) || "UNKNOWN";
          const name = (data.token && data.token.name) || "Solana Token";

          tokenNameEl.textContent = name + " (" + symbol + ") — " + (data.tier || "free").toUpperCase();
          tokenMintEl.textContent = data.mint + (cacheHeader ? "  |  Cache: " + cacheHeader : "");
          verdictEl.className = "badge badge-" + verdict;
          verdictEl.textContent = verdict + " (" + riskScore + "/100)";

          addMetric("Rug Risk Score", riskScore + " / 100");
          addMetric("Liquidity USD", fmtUsd(data.market.liquidityUsd));
          addMetric("24h Volume", fmtUsd(data.market.volume24hUsd));
          addMetric(
            "FDV / Liquidity",
            data.market.fdvToLiquidityRatio !== null ? data.market.fdvToLiquidityRatio + "x" : "N/A"
          );
          addMetric("Active Pools", String(data.market.poolCount));
          const lpPct =
            data.lpLockAndBurn
              ? data.lpLockAndBurn.lpLockedPct
              : data.safety
                ? data.safety.lpLockedPct
                : null;
          addMetric("LP Locked", lpPct !== null && lpPct !== undefined ? lpPct + "%" : "N/A");

          if (data.washVolumeAnomaly) {
            addMetric("Wash Anomaly", data.washVolumeAnomaly.level + " (" + data.washVolumeAnomaly.score + ")");
          }
          if (data.holderConcentration && data.holderConcentration.available) {
            addMetric("Top 10 Holders", data.holderConcentration.top10Pct + "%");
          }
          if (data.ammDumpStressTest) {
            const st = data.ammDumpStressTest;
            addMetric("AMM Cluster Risk", st.clusterConcentrationRisk);
            if (st.tiers && st.tiers.sell25k && st.tiers.sell25k.priceDropPct !== null) {
              addMetric("$25k Sell Impact", "-" + st.tiers.sell25k.priceDropPct + "%");
            }
            if (st.top10HoldersDumpImpactPct !== null && st.top10HoldersDumpImpactPct !== undefined) {
              addMetric("Top-10 Dump Impact", "-" + st.top10HoldersDumpImpactPct + "%");
            }
          } else if (data.ammDumpStress) {
            const s = data.ammDumpStress;
            addMetric("AMM Stress Risk", s.clusterConcentrationRisk);
            if (s.sell25kImpactPct !== null && s.sell25kImpactPct !== undefined) {
              addMetric("$25k Sell Impact", "-" + s.sell25kImpactPct + "%");
            }
            if (s.sell100kImpactPct !== null && s.sell100kImpactPct !== undefined) {
              addMetric("$100k Sell Impact", "-" + s.sell100kImpactPct + "%");
            }
          }

          const flags = data.riskFlags || (data.safety && data.safety.riskFlags) || [];
          if (flags.length === 0) {
            const okItem = document.createElement("div");
            okItem.className = "flag-item flag-info";
            const t = document.createElement("div");
            t.className = "flag-title";
            t.textContent = "NO MAJOR RISK FLAGS DETECTED";
            const d = document.createElement("div");
            d.className = "flag-detail";
            d.textContent = "DexScreener liquidity and RugCheck signals reported clean structural metrics.";
            okItem.appendChild(t);
            okItem.appendChild(d);
            flagsList.appendChild(okItem);
          } else {
            flags.forEach(function (flag) {
              const item = document.createElement("div");
              item.className = "flag-item flag-" + (flag.severity || "info");
              const t = document.createElement("div");
              t.className = "flag-title";
              t.textContent = "[" + String(flag.severity || "info").toUpperCase() + "] " + flag.label;
              const d = document.createElement("div");
              d.className = "flag-detail";
              d.textContent = flag.detail || "";
              item.appendChild(t);
              item.appendChild(d);
              flagsList.appendChild(item);
            });
          }
        }

        async function runFreeScan(mint) {
          statusLine.textContent = "Scanning Solana mint via DexScreener + RugCheck...";
          try {
            const res = await fetch("/api/v1/free/signal?mint=" + encodeURIComponent(mint));
            const data = await res.json();
            const cacheHeader = res.headers.get("X-Cache") || "";
            const rem = res.headers.get("X-RateLimit-Remaining");
            statusLine.textContent =
              "HTTP " + res.status + (cacheHeader ? " | Cache " + cacheHeader : "") + (rem !== null ? " | Rate-limit remaining: " + rem : "");
            renderReport(data, res.status, cacheHeader);
          } catch (err) {
            statusLine.textContent = "Scan failed: " + (err && err.message ? err.message : String(err));
          }
        }

        async function runProScan(mint, txSig) {
          statusLine.textContent = txSig
            ? "Verifying Solana USDC payment on-chain and building Pro report..."
            : "Requesting x402 HTTP 402 payment challenge...";
          try {
            const headers = {};
            if (txSig) headers["X-PAYMENT-TX"] = txSig;
            const res = await fetch("/api/v1/pro/signal?mint=" + encodeURIComponent(mint), { headers });
            const data = await res.json();
            statusLine.textContent = "Pro endpoint responded HTTP " + res.status;
            renderReport(data, res.status, res.headers.get("X-Cache") || "");
          } catch (err) {
            statusLine.textContent = "Pro request failed: " + (err && err.message ? err.message : String(err));
          }
        }

        form.addEventListener("submit", function (e) {
          e.preventDefault();
          const mint = mintInput.value.trim();
          if (mint) runFreeScan(mint);
        });

        proProbeBtn.addEventListener("click", function () {
          const mint = mintInput.value.trim() || "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
          mintInput.value = mint;
          runProScan(mint, "");
        });

        proUnlockBtn.addEventListener("click", function () {
          const mint = mintInput.value.trim();
          const tx = txInput.value.trim();
          if (!mint) {
            statusLine.textContent = "Enter a Solana SPL mint address first.";
            return;
          }
          runProScan(mint, tx);
        });

        document.querySelectorAll(".preset-btn").forEach(function (btn) {
          btn.addEventListener("click", function () {
            const mint = btn.getAttribute("data-mint");
            if (mint) {
              mintInput.value = mint;
              runFreeScan(mint);
            }
          });
        });
      })();
    </script>
  </body>
</html>`;
}
