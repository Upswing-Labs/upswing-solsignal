# Upswing SolSignal v2.0.0 — Transparent Scoring Rubric & AMM Dump Stress-Test

> Live JSON rubric: `https://upswing-solsignal.upswing-labs.workers.dev/docs/scoring`
> Live Markdown rubric: `https://upswing-solsignal.upswing-labs.workers.dev/docs/scoring?format=md`

Upswing SolSignal computes every rug-risk score and liquidity stress metric deterministically from live **DexScreener** and **RugCheck** telemetry — zero black boxes, zero hidden weights.

---

## 1. Constant-Product AMM Liquidity Dump Stress-Test (`x * y = k`)

In a symmetric constant-product AMM pool with base reserve $R$ and quote reserve $Y$ ($R \cdot Y = k$, initial spot price $P_{\text{before}} = Y / R$), dumping $Q_{\text{risk}}$ base tokens simultaneously shifts reserves to:

$$R' = R + Q_{\text{risk}}, \qquad Y' = \frac{R \cdot Y}{R + Q_{\text{risk}}}$$

Yielding exact post-dump spot price ratio and percentage drop:

$$\frac{P_{\text{after}}}{P_{\text{before}}} = \left(\frac{R}{R + Q_{\text{risk}}}\right)^2$$

$$\text{priceDropPct} = \left(1 - \left(\frac{R}{R + Q_{\text{risk}}}\right)^2\right) \times 100$$

### USD-Equivalent Formulation
Multiplying numerator and denominator by $P_{\text{before}}$:
- **Effective single-sided pool reserve:** $R_{\text{usd}} = \text{aggregateLiquidityUsd} / 2$
- **Simultaneous sell notional:** $D_{\text{usd}} = Q_{\text{risk}} \cdot P_{\text{before}}$
- **Numerically stable ratio (overflow & zero-division safe):**
  $$\text{ratio} = \frac{1}{1 + D_{\text{usd}} / R_{\text{usd}}}, \qquad \text{priceDropPct} = \text{clamp}\!\left((1 - \text{ratio}^2) \times 100,\; 0,\; 100\right)$$

### Worked Reference Sanity Check
- When $R = Q_{\text{risk}}$ (e.g. $R_{\text{usd}} = \$100{,}000$, $D_{\text{usd}} = \$100{,}000$):
  - $P_{\text{after}} / P_{\text{before}} = (100{,}000 / 200{,}000)^2 = 0.25$
  - $\text{priceDropPct} = (1 - 0.25) \times 100 = \mathbf{75.0\%}$
- **Edge-case guards:**
  - $Q_{\text{risk}} \le 0$ or non-finite $\rightarrow$ `priceAfterRatio = 1`, `priceDropPct = 0`
  - Confirmed $R_{\text{usd}} = 0$ with $Q_{\text{risk}} > 0$ $\rightarrow$ `priceAfterRatio = 0`, `priceDropPct = 100` (never `NaN` or `Infinity`)
  - Upstream liquidity outage $\rightarrow$ tier impacts return `null` with `dataQuality: "UNAVAILABLE"` and fail-safe `clusterConcentrationRisk: "HIGH"`

### Stress-Test Scenarios
1. **Standard Fixed-Size Liquidity Stress Tiers (Free + Pro):**
   - Simultaneous sells of **$5,000** (`sell5k`), **$25,000** (`sell25k`), and **$100,000** (`sell100k`).
2. **Top-10 Holders Simultaneous Dump (`top10HoldersDumpImpactPct`, Pro x402 Signal):**
   - $D_{\text{top10}} = \text{valuationBasisUsd} \times (\text{clamp}(\text{top10Pct}, 0, 100) / 100)$
   - Valuation basis priority:
     1. DexScreener circulating `marketCapUsd` (`dataQuality: "FULL"`)
     2. DexScreener `fdvUsd` (`dataQuality: "FULL"`)
     3. Aggregate pool liquidity depth proxy (`dataQuality: "PARTIAL_POOL_PROXY"`)
   - When RugCheck full holder data is unavailable (Free summary tier or `summary_fallback`), `top10HoldersDumpImpactPct` is `null` and `dataQuality` is tagged `"DEGRADED_NO_HOLDER_DATA"`.

### `clusterConcentrationRisk` Deterministic Thresholds
| Grade | Trigger Conditions (Highest Matching Tier Wins) |
| --- | --- |
| **CRITICAL** | Confirmed `$0` active pool reserve; OR `$5k` sell impact $\ge 50\%$; OR `$25k` sell impact $\ge 80\%$; OR Top-1 $\ge 35\%$; OR Top-10 $\ge 75\%$; OR insider supply $\ge 25\%$; OR (`graphInsidersDetected >= 5` & `top10HoldersDumpImpactPct >= 85%`); OR (Top-10 $\ge 50\%$ & `top10HoldersDumpImpactPct >= 90%`). |
| **HIGH** | Upstream liquidity telemetry unavailable (fail-safe); OR `$25k` sell impact $\ge 50\%$; OR `$100k` sell impact $\ge 85\%$; OR Top-1 $\ge 20\%$; OR Top-10 $\ge 55\%$; OR insider supply $\ge 10\%$; OR (`graphInsidersDetected >= 2` & `top10HoldersDumpImpactPct >= 70%`); OR (Top-10 $\ge 35\%$ & `top10HoldersDumpImpactPct >= 85%`). |
| **MODERATE** | `$25k` sell impact $\ge 15\%$; OR `$100k` sell impact $\ge 45\%$; OR Top-10 $\ge 35\%$; OR insider supply $\ge 5\%$; OR `graphInsidersDetected >= 1`; OR (`top10HoldersDumpImpactPct >= 75%` with $R_{\text{usd}} < \$500\text{k}$). |
| **LOW** | Deep DEX liquidity (`$25k` impact $< 15\%$ and `$100k` impact $< 45\%$) and dispersed holder concentration. |

### `dataQuality` Tags
| Tag | Meaning |
| --- | --- |
| `FULL` | Active DEX reserve + RugCheck full top-holder breakdown + market cap or FDV valuation. |
| `PARTIAL_POOL_PROXY` | Active DEX reserve + RugCheck top-holder breakdown, using pool TVL as valuation proxy because marketCap/FDV is unavailable. |
| `DEGRADED_NO_HOLDER_DATA` | Active DEX reserve available for `$5k`/`$25k`/`$100k` tiers, but top-holder breakdown is unavailable (Free tier or RugCheck fallback). |
| `DEGRADED_NO_LIQUIDITY` | Confirmed `$0` active Solana DEX liquidity; any positive sell yields `100%` price impact. |
| `UNAVAILABLE` | Upstream liquidity telemetry failed; impact figures omitted rather than fabricated. |

---

## 2. Composite Rug-Risk Score Rubric (`0–100`)

### Verdict Bands
| Verdict | Score Range | Condition |
| --- | --- | --- |
| `LOW_RISK` | `0 – 24` | Clean structural metrics; no hard honeypot triggers |
| `CAUTION` | `25 – 54` | Moderate structural or liquidity risks |
| `HIGH_RISK` | `55 – 79` | Severe liquidity, valuation, or authority/holder red flags |
| `HONEYPOT_ALERT` | `80 – 100` | Score $\ge 80$ OR hard trigger (`rugged === true`, RugCheck `honeypot`/`freezeable`/`non-transferable` flag, or Token-2022 transfer fee $\ge 25\%$) |

### Core Risk Weights (Free + Pro)
| Component | Weight / Points |
| --- | --- |
| RugCheck normalized score | `round(clamp(score_normalised, 0, 100) * 0.45)` (max `+45`) |
| RugCheck `danger` flags | `+14` each (capped at `+35`) |
| RugCheck `warn` flags | `+5` each (capped at `+15`) |
| RugCheck `rugged === true` | Floor score at `95` + hard `HONEYPOT_ALERT` |
| Active Solana DEX liquidity | `0` pools: `+25`; `<$1k`: `+35`; `<$10k`: `+22`; `<$50k`: `+10` |
| FDV / Liquidity distortion | Non-CEX `>100x`: `+24`; `>40x`: `+14`; `>15x` (sub-`$500k` liq): `+6`; Deep multi-venue (`>=$1M` or `>=$500k` across `>=5` pools) `>100x`: `+6` |
| Small-cap unlocked LP (`<$250k` liq, `<20%` locked) | `+15` |
| Fresh pool (`<24h` old, `<$100k` liq) | `+10` |
| Token-2022 transfer fee | `>=15%`: `+30` (`>=25%` hard `HONEYPOT_ALERT`); `>=5%`: `+12` |
| Upstream source degradation | `+10` per unavailable upstream (DexScreener / RugCheck) |

### Pro-Only Microstructure Adjustments
| Component | Weight / Points |
| --- | --- |
| Holder concentration | `CRITICAL`: `+18`; `HIGH`: `+10`; `MODERATE`: `+3` |
| Wash-volume anomaly | `EXTREME` (`>=70`): `+14`; `SUSPICIOUS` (`>=45`): `+8` |
| Constant-Product AMM Dump Stress-Test | `CRITICAL`: `+8`; `HIGH`: `+4` (when liquidity telemetry is available) |

Final composite score is strictly clamped to `[0, 100]`.

---

## 3. Limitations & Disclosures
- Constant-product `x * y = k` is a deterministic zero-fee lower bound. Concentrated-liquidity pools (Orca Whirlpools, Meteora DLMM, Raydium CLMM) can exhibit sharper cliff slippage once price moves outside active liquidity ticks.
- On-chain DEX reserves do not include centralized exchange (CEX) order books; multi-venue blue-chip tokens can show elevated theoretical DEX-only top-10 dump impact while remaining liquid on CEX venues.
- Upswing SolSignal provides read-only informational telemetry only and is not financial advice.
