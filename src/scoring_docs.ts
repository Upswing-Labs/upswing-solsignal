// Transparent scoring rubric & Constant-Product AMM Dump Stress-Test methodology
// served via `GET /docs/scoring` (structured JSON by default, Markdown via `?format=md` or `Accept: text/markdown`).

import { AMM_DUMP_FORMULA, AMM_STRESS_TIERS_USD } from "./scoring.ts";

export function buildScoringRubricJson(origin: string) {
  return {
    service: "upswing-solsignal",
    version: "2.0.0",
    schemaVersion: "2.0",
    endpoint: `${origin}/docs/scoring`,
    markdownUrl: `${origin}/docs/scoring?format=md`,
    methodologySummary:
      "Upswing SolSignal v2.0.0 combines deterministic on-chain safety heuristics (DexScreener + RugCheck) with a Constant-Product AMM (x * y = k) Liquidity Dump Stress-Test Engine. Every score, threshold, and formula is open and reproducible.",
    rugRiskScoreRubric: {
      range: { min: 0, max: 100 },
      verdictThresholds: [
        { verdict: "LOW_RISK", minScore: 0, maxScore: 24, condition: "No hard honeypot trigger" },
        { verdict: "CAUTION", minScore: 25, maxScore: 54, condition: "No hard honeypot trigger" },
        { verdict: "HIGH_RISK", minScore: 55, maxScore: 79, condition: "No hard honeypot trigger" },
        {
          verdict: "HONEYPOT_ALERT",
          minScore: 80,
          maxScore: 100,
          condition: "Score >= 80 OR any hard honeypot trigger",
        },
      ],
      hardHoneypotTriggers: [
        "RugCheck reports rugged === true (forces score >= 95)",
        "RugCheck risk label contains 'honeypot', 'freezeable', or 'non-transferable'",
        "Token-2022 transferFee.pct >= 25%",
      ],
      coreComponentWeights: {
        rugcheckNormalisedScore: "round(clamp(score_normalised, 0, 100) * 0.45) (max +45)",
        rugcheckDangerFlags: "+14 per danger flag (capped at +35)",
        rugcheckWarnFlags: "+5 per warn flag (capped at +15)",
        liquidityDepth: {
          noActivePools: "+25",
          under1kUsd: "+35",
          under10kUsd: "+22",
          under50kUsd: "+10",
        },
        fdvToLiquidityDistortion: {
          deepMultiVenueOver100x: "+6 (info; >=$1M DEX liq or >=$500k across >=5 pools)",
          nonDeepOver100x: "+24 (danger)",
          nonDeepOver40x: "+14 (warn)",
          under500kLiqOver15x: "+6 (info)",
        },
        lowLpLockSmallCap: "+15 (liquidity < $250k and lpLockedPct < 20%)",
        newPairUnder24h: "+10 (pair age < 24h and liquidity < $100k)",
        token2022TransferFee: {
          atLeast15Pct: "+30 (danger; >=25% also sets HONEYPOT_ALERT)",
          atLeast5Pct: "+12 (warn)",
        },
        upstreamDegradation: {
          dexscreenerUnavailable: "+10",
          rugcheckUnavailable: "+10",
        },
      },
      proMicrostructureAdjustments: {
        holderConcentration: {
          CRITICAL: "+18 (top1 >= 35% OR top10 >= 75% OR insiderSupply >= 25%)",
          HIGH: "+10 (top1 >= 20% OR top10 >= 55% OR insiderSupply >= 10%)",
          MODERATE: "+3 (top10 >= 35%)",
        },
        washVolumeAnomaly: {
          EXTREME: "+14 (wash score >= 70)",
          SUSPICIOUS: "+8 (wash score >= 45)",
        },
        ammDumpStressTest: {
          CRITICAL: "+8 (when liquidity telemetry is available)",
          HIGH: "+4 (when liquidity telemetry is available)",
        },
      },
    },
    ammDumpStressTest: {
      model: "constant-product-xy-k",
      description:
        "Deterministic constant-product AMM (x * y = k, zero-fee lower bound) spot price impact model measuring how much simultaneous sell pressure degrades token price.",
      formula: {
        priceRatio: "P_after / P_before = (R / (R + Q_risk))^2",
        priceDropPct: AMM_DUMP_FORMULA,
        usdEquivalent:
          "priceDropPct = (1 - (R_usd / (R_usd + D_usd))^2) * 100 where R_usd = aggregateLiquidityUsd / 2 and D_usd = Q_risk * priceUsd",
        numericalStability:
          "Computed via ratio = 1 / (1 + D_usd / R_usd) to eliminate overflow and division-by-zero across all finite inputs.",
      },
      workedReferenceCase: {
        condition: "R = Q_risk (dump equals 100% of single-sided pool reserve)",
        reserveUsd: 100000,
        dumpUsd: 100000,
        priceAfterRatio: 0.25,
        priceDropPct: 75.0,
      },
      edgeCaseHandling: {
        zeroDump: "Q_risk <= 0 or non-finite -> priceAfterRatio = 1, priceDropPct = 0",
        zeroLiquidityConfirmed:
          "R <= 0 with Q_risk > 0 -> priceAfterRatio = 0, priceDropPct = 100 (bounded 0..100, never NaN/Infinity)",
        upstreamOutage:
          "DexScreener unavailable and no RugCheck totalMarketLiquidity fallback -> tier impacts are null, dataQuality = 'UNAVAILABLE', clusterConcentrationRisk = 'HIGH' (fail-safe)",
      },
      fixedStressTiersUsd: [
        AMM_STRESS_TIERS_USD.sell5k,
        AMM_STRESS_TIERS_USD.sell25k,
        AMM_STRESS_TIERS_USD.sell100k,
      ],
      top10HoldersScenario: {
        tierAvailability: "Pro Signal (/api/v1/pro/signal & deep_solana_signal MCP tool)",
        valuationPriority: [
          "1. DexScreener circulating marketCapUsd (dataQuality: FULL)",
          "2. DexScreener fdvUsd (dataQuality: FULL)",
          "3. Aggregate pool liquidity proxy (dataQuality: PARTIAL_POOL_PROXY)",
        ],
        dumpUsdFormula: "D_top10 = valuationBasisUsd * (clamp(top10Pct, 0, 100) / 100)",
        degradedBehavior:
          "When RugCheck full topHolders data is unavailable (Free tier or summary_fallback), top10HoldersDumpImpactPct is null and dataQuality is tagged 'DEGRADED_NO_HOLDER_DATA'.",
      },
      clusterConcentrationRiskThresholds: {
        CRITICAL: [
          "Confirmed $0 active pool reserve",
          "$5k sell impact >= 50% OR $25k sell impact >= 80%",
          "Top-1 holder >= 35% OR Top-10 holders >= 75% OR insider supply >= 25%",
          "graphInsidersDetected >= 5 AND top10HoldersDumpImpactPct >= 85%",
          "Top-10 holders >= 50% AND top10HoldersDumpImpactPct >= 90%",
        ],
        HIGH: [
          "Liquidity telemetry unavailable (fail-safe)",
          "$25k sell impact >= 50% OR $100k sell impact >= 85%",
          "Top-1 holder >= 20% OR Top-10 holders >= 55% OR insider supply >= 10%",
          "graphInsidersDetected >= 2 AND top10HoldersDumpImpactPct >= 70%",
          "Top-10 holders >= 35% AND top10HoldersDumpImpactPct >= 85%",
        ],
        MODERATE: [
          "$25k sell impact >= 15% OR $100k sell impact >= 45%",
          "Top-10 holders >= 35% OR insider supply >= 5% OR graphInsidersDetected >= 1",
          "top10HoldersDumpImpactPct >= 75% on sub-$1M DEX liquidity (R_usd < $500k)",
        ],
        LOW: [
          "Deep DEX depth ($25k sell impact < 15% and $100k sell impact < 45%) with dispersed holder concentration",
        ],
      },
      dataQualityTags: {
        FULL: "Active DEX pool reserve + RugCheck full top-holder breakdown + market cap or FDV valuation.",
        PARTIAL_POOL_PROXY:
          "Active DEX reserve + RugCheck top-holder breakdown, using pool TVL as valuation proxy because marketCap/FDV is missing.",
        DEGRADED_NO_HOLDER_DATA:
          "Active DEX reserve available for $5k/$25k/$100k tiers, but top-holder breakdown is unavailable (Free tier or RugCheck degraded).",
        DEGRADED_NO_LIQUIDITY:
          "Confirmed $0 active Solana DEX liquidity; any positive dump yields 100% impact.",
        UNAVAILABLE:
          "Upstream liquidity telemetry failed; impact figures omitted rather than fabricated.",
      },
    },
    limitations: [
      "Constant-product x * y = k is a zero-fee lower bound; concentrated-liquidity pools (CLMM/DLMM) can experience steeper cliff slippage once spot price leaves active liquidity ticks.",
      "DEX reserve modeling excludes off-chain CEX order-book liquidity; blue-chip CEX-listed tokens can show high theoretical DEX-only top-10 dump impact despite deep centralized books.",
      "All intelligence is read-only informational telemetry and not financial advice.",
    ],
  };
}

export function renderScoringRubricMarkdown(origin: string): string {
  return `# Upswing SolSignal v2.0.0 — Transparent Scoring Rubric & AMM Dump Stress-Test

> Live JSON rubric: \`${origin}/docs/scoring\`
> Markdown view: \`${origin}/docs/scoring?format=md\`

Upswing SolSignal computes every rug-risk score and liquidity stress metric deterministically from live **DexScreener** and **RugCheck** telemetry — zero black boxes, zero hidden weights.

---

## 1. Constant-Product AMM Liquidity Dump Stress-Test (\`x * y = k\`)

In a symmetric constant-product AMM pool with base reserve \`R\` and quote reserve \`Y\` (\`R * Y = k\`, initial spot price \`P_before = Y / R\`), dumping \`Q_risk\` base tokens simultaneously shifts reserves to \`R' = R + Q_risk\` and \`Y' = (R * Y) / (R + Q_risk)\`:

\`\`\`text
P_after / P_before = (R / (R + Q_risk))^2
priceDropPct       = (1 - (R / (R + Q_risk))^2) * 100
\`\`\`

### USD-Equivalent Formulation
Multiplying numerator and denominator by \`P_before\`:
- Effective single-sided pool reserve: \`R_usd = aggregateLiquidityUsd / 2\`
- Simultaneous sell notional: \`D_usd = Q_risk * P_before\`
- Ratio (overflow & zero-division safe): \`ratio = 1 / (1 + D_usd / R_usd)\`
- \`priceDropPct = (1 - ratio^2) * 100\`, strictly clamped to \`[0, 100]\`.

### Worked Reference Sanity Check
- When \`R = Q_risk\` (e.g. \`R_usd = $100,000\`, \`D_usd = $100,000\`):
  - \`P_after / P_before = (100,000 / 200,000)^2 = 0.25\`
  - \`priceDropPct = (1 - 0.25) * 100 = 75.0%\`
- Edge-case guards:
  - \`Q_risk <= 0\` or non-finite -> \`priceAfterRatio = 1\`, \`priceDropPct = 0%\`
  - Confirmed \`R_usd = 0\` with \`Q_risk > 0\` -> \`priceAfterRatio = 0\`, \`priceDropPct = 100%\` (never \`NaN\` / \`Infinity\`)
  - Upstream liquidity outage -> tier impacts return \`null\` with \`dataQuality: "UNAVAILABLE"\`

### Stress-Test Scenarios
1. **Fixed Liquidity Stress Tiers (Free + Pro):** simultaneous sells of **$5,000**, **$25,000**, and **$100,000**.
2. **Top-10 Holders Simultaneous Dump (Pro x402 Signal):**
   - \`D_top10 = valuationBasisUsd * (clamp(top10Pct, 0, 100) / 100)\`
   - Valuation basis priority: \`marketCapUsd\` -> \`fdvUsd\` -> \`totalLiquidityUsd\` (\`PARTIAL_POOL_PROXY\`).
   - When RugCheck full holder data is unavailable (Free tier or \`summary_fallback\`), \`top10HoldersDumpImpactPct\` is \`null\` and \`dataQuality\` is \`DEGRADED_NO_HOLDER_DATA\`.

### \`clusterConcentrationRisk\` Thresholds
| Grade | Deterministic Trigger Conditions |
| --- | --- |
| **CRITICAL** | Confirmed \`$0\` pool reserve; OR \`$5k\` sell impact \`>= 50%\`; OR \`$25k\` sell impact \`>= 80%\`; OR Top-1 \`>= 35%\`; OR Top-10 \`>= 75%\`; OR insider supply \`>= 25%\`; OR (\`graphInsidersDetected >= 5\` & top-10 dump impact \`>= 85%\`); OR (Top-10 \`>= 50%\` & top-10 dump impact \`>= 90%\`). |
| **HIGH** | Upstream liquidity telemetry unavailable (fail-safe); OR \`$25k\` sell impact \`>= 50%\`; OR \`$100k\` sell impact \`>= 85%\`; OR Top-1 \`>= 20%\`; OR Top-10 \`>= 55%\`; OR insider supply \`>= 10%\`; OR (\`graphInsidersDetected >= 2\` & top-10 dump impact \`>= 70%\`); OR (Top-10 \`>= 35%\` & top-10 dump impact \`>= 85%\`). |
| **MODERATE** | \`$25k\` sell impact \`>= 15%\`; OR \`$100k\` sell impact \`>= 45%\`; OR Top-10 \`>= 35%\`; OR insider supply \`>= 5%\`; OR \`graphInsidersDetected >= 1\`; OR (top-10 dump impact \`>= 75%\` with \`R_usd < $500k\`). |
| **LOW** | Deep DEX liquidity (\`$25k\` impact \`< 15%\` and \`$100k\` impact \`< 45%\`) and dispersed holder structure. |

---

## 2. Composite Rug-Risk Score Rubric (\`0–100\`)

### Verdict Bands
| Verdict | Score Range | Notes |
| --- | --- | --- |
| \`LOW_RISK\` | \`0 – 24\` | Clean structural metrics; no hard honeypot triggers |
| \`CAUTION\` | \`25 – 54\` | Moderate structural or liquidity risks |
| \`HIGH_RISK\` | \`55 – 79\` | Severe liquidity, valuation, or authority/holder red flags |
| \`HONEYPOT_ALERT\` | \`80 – 100\` | Score \`>= 80\` OR hard trigger (\`rugged === true\`, honeypot/freezeable/non-transferable risk, or Token-2022 transfer fee \`>= 25%\`) |

### Component Weights
| Signal Component | Points Added |
| --- | --- |
| RugCheck normalized risk score | \`round(clamp(score_normalised, 0, 100) * 0.45)\` (max \`+45\`) |
| RugCheck \`danger\` flags | \`+14\` each (capped at \`+35\`) |
| RugCheck \`warn\` flags | \`+5\` each (capped at \`+15\`) |
| RugCheck \`rugged === true\` | Floor score at \`95\` + hard \`HONEYPOT_ALERT\` |
| Active Solana liquidity depth | \`0\` pools: \`+25\`; \`<$1k\`: \`+35\`; \`<$10k\`: \`+22\`; \`<$50k\`: \`+10\` |
| FDV / Liquidity distortion | Non-CEX \`>100x\`: \`+24\`; \`>40x\`: \`+14\`; \`>15x\` (sub-\`$500k\`): \`+6\`; Deep multi-venue \`>100x\`: \`+6\` |
| Small-cap unlocked LP (\`<$250k\` liq, \`<20%\` locked) | \`+15\` |
| Fresh pool (\`<24h\` old, \`<$100k\` liq) | \`+10\` |
| Token-2022 transfer tax | \`>=15%\`: \`+30\` (\`>=25%\` hard \`HONEYPOT_ALERT\`); \`>=5%\`: \`+12\` |
| Upstream source degradation | \`+10\` per unavailable upstream (DexScreener / RugCheck) |
| **Pro:** Holder concentration | \`CRITICAL\`: \`+18\`; \`HIGH\`: \`+10\`; \`MODERATE\`: \`+3\` |
| **Pro:** Wash-volume anomaly | \`EXTREME\` (\`>=70\`): \`+14\`; \`SUSPICIOUS\` (\`>=45\`): \`+8\` |
| **Pro:** AMM Dump Stress-Test | \`CRITICAL\`: \`+8\`; \`HIGH\`: \`+4\` (when liquidity telemetry is available) |

Final score is strictly clamped to \`[0, 100]\`.

---

## 3. Known Limitations
- Constant-product \`x * y = k\` represents a zero-fee continuous liquidity baseline; concentrated-liquidity pools (CLMM/DLMM) can exhibit sharper cliff slippage once price exits active liquidity ticks.
- On-chain DEX reserves exclude off-chain CEX order books; multi-venue blue-chip tokens may show large theoretical DEX-only top-10 dump impact while maintaining deep CEX liquidity.
- All outputs are deterministic, read-only risk telemetry and do not constitute financial advice.
`;
}
