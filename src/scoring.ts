// Deterministic Solana token safety scoring, constant-product AMM liquidity dump stress-testing,
// holder concentration, LP lock/burn, multi-pool liquidity fragmentation, multi-timeframe
// order-flow imbalance, and wash-volume analytics.

import type {
  AmmDumpStressSummary,
  AmmDumpStressTest,
  AmmDumpTierResult,
  AmmStressDataQuality,
  ClusterConcentrationRisk,
  DexScreenerPair,
  FreeSignalReport,
  MarketSnapshot,
  OrderFlowWindow,
  ProPaymentReceipt,
  ProSignalReport,
  RiskFlag,
  RugCheckFullResponse,
  RugCheckRiskItem,
  RugCheckSummaryResponse,
  SignalSourcesStatus,
  TokenSnapshotMeta,
  Verdict,
} from "./types.ts";
import type { NormalizedDexData } from "./upstream.ts";

export const AMM_DUMP_FORMULA =
  "priceDropPct = (1 - (R / (R + Q_risk))^2) * 100" as const;

export const AMM_STRESS_TIERS_USD = {
  sell5k: 5_000,
  sell25k: 25_000,
  sell100k: 100_000,
} as const;

export interface AmmDumpCalculation {
  reserveUsd: number;
  dumpUsd: number;
  priceAfterRatio: number;
  priceDropPct: number;
}

function finiteNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Standard constant-product AMM (x * y = k, zero-fee lower bound) sell impact:
 *   P_after / P_before = (R / (R + Q_risk))^2
 *   priceDropPct       = (1 - (R / (R + Q_risk))^2) * 100
 *
 * Equivalent in USD terms when R_usd = R * P_before (= pool TVL / 2) and D_usd = Q_risk * P_before.
 * Uses `1 / (1 + q / r)` to avoid floating-point overflow and guarantees zero-division safety.
 */
export function computeConstantProductDumpImpact(
  reserve: number,
  dumpAmount: number
): AmmDumpCalculation {
  const r = Number.isFinite(reserve) && reserve > 0 ? reserve : 0;
  const q = Number.isFinite(dumpAmount) && dumpAmount > 0 ? dumpAmount : 0;

  if (q === 0) {
    return {
      reserveUsd: round2(r),
      dumpUsd: 0,
      priceAfterRatio: 1,
      priceDropPct: 0,
    };
  }

  if (r === 0) {
    return {
      reserveUsd: 0,
      dumpUsd: round2(q),
      priceAfterRatio: 0,
      priceDropPct: 100,
    };
  }

  const ratio = 1 / (1 + q / r);
  const priceAfterRatio = clamp(ratio * ratio, 0, 1);
  const priceDropPct = clamp((1 - priceAfterRatio) * 100, 0, 100);

  return {
    reserveUsd: round2(r),
    dumpUsd: round2(q),
    priceAfterRatio: round4(priceAfterRatio),
    priceDropPct: round2(priceDropPct),
  };
}

function makeStressTier(
  effectiveReserveUsd: number,
  dumpUsd: number,
  hasLiquidityTelemetry: boolean
): AmmDumpTierResult {
  if (!hasLiquidityTelemetry) {
    return {
      dumpUsd,
      priceAfterRatio: null,
      priceDropPct: null,
    };
  }
  const calc = computeConstantProductDumpImpact(effectiveReserveUsd, dumpUsd);
  return {
    dumpUsd,
    priceAfterRatio: calc.priceAfterRatio,
    priceDropPct: calc.priceDropPct,
  };
}

export function analyzeAmmDumpStress(params: {
  market: MarketSnapshot;
  sources: SignalSourcesStatus;
  rcFull: RugCheckFullResponse | null;
  holderConcentration: ProSignalReport["holderConcentration"] | null;
  extraFlags?: RiskFlag[];
}): {
  stressTest: AmmDumpStressTest;
  freeSummary: AmmDumpStressSummary;
  scoreAdjustment: number;
} {
  const { market, sources, rcFull, holderConcentration, extraFlags } = params;

  const rcTotalLiq = finiteNum(rcFull?.totalMarketLiquidity);
  let totalLiquidityUsd = 0;
  let effectiveReserveUsd = 0;
  let reserveSource: AmmDumpStressTest["reserveSource"] = "unavailable";
  let hasLiquidityTelemetry = false;

  if (sources.dexscreener.ok && market.liquidityUsd > 0) {
    totalLiquidityUsd = market.liquidityUsd;
    effectiveReserveUsd = market.liquidityUsd / 2;
    reserveSource = "dexscreener_aggregate_half_tvl";
    hasLiquidityTelemetry = true;
  } else if (rcTotalLiq !== null && rcTotalLiq > 0) {
    totalLiquidityUsd = rcTotalLiq;
    effectiveReserveUsd = rcTotalLiq / 2;
    reserveSource = "rugcheck_total_liquidity_fallback";
    hasLiquidityTelemetry = true;
  } else if (sources.dexscreener.ok) {
    totalLiquidityUsd = 0;
    effectiveReserveUsd = 0;
    reserveSource = "confirmed_zero_liquidity";
    hasLiquidityTelemetry = true;
  }

  const sell5k = makeStressTier(
    effectiveReserveUsd,
    AMM_STRESS_TIERS_USD.sell5k,
    hasLiquidityTelemetry
  );
  const sell25k = makeStressTier(
    effectiveReserveUsd,
    AMM_STRESS_TIERS_USD.sell25k,
    hasLiquidityTelemetry
  );
  const sell100k = makeStressTier(
    effectiveReserveUsd,
    AMM_STRESS_TIERS_USD.sell100k,
    hasLiquidityTelemetry
  );

  const hasHolders = Boolean(
    holderConcentration &&
      holderConcentration.available &&
      holderConcentration.top10Pct !== null
  );
  const top10HoldersPct = hasHolders
    ? round2(clamp(holderConcentration?.top10Pct ?? 0, 0, 100))
    : null;

  let valuationBasisUsd: number | null = null;
  let valuationBasisSource: AmmDumpStressTest["valuationBasisSource"] =
    "unavailable";
  if (market.marketCapUsd !== null && market.marketCapUsd > 0) {
    valuationBasisUsd = round2(market.marketCapUsd);
    valuationBasisSource = "market_cap";
  } else if (market.fdvUsd !== null && market.fdvUsd > 0) {
    valuationBasisUsd = round2(market.fdvUsd);
    valuationBasisSource = "fdv";
  } else if (totalLiquidityUsd > 0) {
    valuationBasisUsd = round2(totalLiquidityUsd);
    valuationBasisSource = "pool_depth_proxy";
  }

  let dataQuality: AmmStressDataQuality;
  let top10HoldersDumpUsd: number | null = null;
  let top10HoldersDumpImpactPct: number | null = null;
  let top10HoldersPriceAfterRatio: number | null = null;

  if (!hasLiquidityTelemetry) {
    dataQuality = "UNAVAILABLE";
    if (top10HoldersPct !== null && valuationBasisUsd !== null) {
      top10HoldersDumpUsd = round2(valuationBasisUsd * (top10HoldersPct / 100));
    }
  } else if (effectiveReserveUsd <= 0) {
    dataQuality = "DEGRADED_NO_LIQUIDITY";
    if (top10HoldersPct !== null) {
      top10HoldersDumpUsd =
        valuationBasisUsd !== null
          ? round2(valuationBasisUsd * (top10HoldersPct / 100))
          : null;
      if (top10HoldersPct === 0) {
        top10HoldersDumpImpactPct = 0;
        top10HoldersPriceAfterRatio = 1;
      } else {
        top10HoldersDumpImpactPct = 100;
        top10HoldersPriceAfterRatio = 0;
      }
    }
  } else if (top10HoldersPct === null) {
    dataQuality = "DEGRADED_NO_HOLDER_DATA";
  } else {
    dataQuality =
      valuationBasisSource === "pool_depth_proxy"
        ? "PARTIAL_POOL_PROXY"
        : "FULL";
    const basis = valuationBasisUsd ?? totalLiquidityUsd;
    const rawDumpUsd = basis * (top10HoldersPct / 100);
    const calc = computeConstantProductDumpImpact(effectiveReserveUsd, rawDumpUsd);
    top10HoldersDumpUsd = calc.dumpUsd;
    top10HoldersDumpImpactPct = calc.priceDropPct;
    top10HoldersPriceAfterRatio = calc.priceAfterRatio;
  }

  const top1Pct = holderConcentration?.available ? holderConcentration.top1Pct : null;
  const insiderSupplyPct = holderConcentration?.available
    ? holderConcentration.insiderSupplyPct
    : null;
  const graphInsiders = finiteNum(rcFull?.graphInsidersDetected) ?? 0;

  const s5 = sell5k.priceDropPct;
  const s25 = sell25k.priceDropPct;
  const s100 = sell100k.priceDropPct;
  const t10 = top10HoldersDumpImpactPct;

  let clusterConcentrationRisk: ClusterConcentrationRisk = "LOW";
  if (
    reserveSource === "confirmed_zero_liquidity" ||
    (s5 !== null && s5 >= 50) ||
    (s25 !== null && s25 >= 80) ||
    (top1Pct !== null && top1Pct >= 35) ||
    (top10HoldersPct !== null && top10HoldersPct >= 75) ||
    (insiderSupplyPct !== null && insiderSupplyPct >= 25) ||
    (graphInsiders >= 5 && t10 !== null && t10 >= 85) ||
    (top10HoldersPct !== null &&
      top10HoldersPct >= 50 &&
      t10 !== null &&
      t10 >= 90)
  ) {
    clusterConcentrationRisk = "CRITICAL";
  } else if (
    !hasLiquidityTelemetry ||
    (s25 !== null && s25 >= 50) ||
    (s100 !== null && s100 >= 85) ||
    (top1Pct !== null && top1Pct >= 20) ||
    (top10HoldersPct !== null && top10HoldersPct >= 55) ||
    (insiderSupplyPct !== null && insiderSupplyPct >= 10) ||
    (graphInsiders >= 2 && t10 !== null && t10 >= 70) ||
    (top10HoldersPct !== null &&
      top10HoldersPct >= 35 &&
      t10 !== null &&
      t10 >= 85)
  ) {
    clusterConcentrationRisk = "HIGH";
  } else if (
    (s25 !== null && s25 >= 15) ||
    (s100 !== null && s100 >= 45) ||
    (top10HoldersPct !== null && top10HoldersPct >= 35) ||
    (insiderSupplyPct !== null && insiderSupplyPct >= 5) ||
    graphInsiders >= 1 ||
    (t10 !== null && t10 >= 75 && effectiveReserveUsd < 500_000)
  ) {
    clusterConcentrationRisk = "MODERATE";
  }

  const roundedReserve = round2(effectiveReserveUsd);
  const roundedTotalLiq = round2(totalLiquidityUsd);

  let explanation: string;
  if (!hasLiquidityTelemetry) {
    explanation =
      "Liquidity reserve telemetry is unavailable due to upstream degradation; constant-product AMM dump impact cannot be verified (fail-safe HIGH risk).";
  } else if (reserveSource === "confirmed_zero_liquidity") {
    explanation =
      "Confirmed $0 active Solana DEX pool reserve: any positive simultaneous sell order ($5k / $25k / $100k) produces 100% AMM price wipeout.";
  } else {
    const tierClause = `Effective single-sided AMM reserve of $${roundedReserve.toLocaleString("en-US")} (half of $${roundedTotalLiq.toLocaleString("en-US")} DEX liquidity) models constant-product sell shocks of -${s5}% ($5k), -${s25}% ($25k), and -${s100}% ($100k).`;
    if (top10HoldersPct !== null && t10 !== null) {
      const basisNote =
        dataQuality === "PARTIAL_POOL_PROXY"
          ? " using pool-depth proxy (FDV/market cap unavailable)"
          : ` against ${valuationBasisSource === "market_cap" ? "market cap" : "FDV"}`;
      explanation = `${tierClause} Top-10 holders (${top10HoldersPct}% supply, ~$${(top10HoldersDumpUsd ?? 0).toLocaleString("en-US")}${basisNote}) dumping simultaneously imply -${t10}% spot impact (${clusterConcentrationRisk} cluster risk).`;
    } else {
      explanation = `${tierClause} Top-10 holder dump scenario unavailable (dataQuality: ${dataQuality}); risk grade (${clusterConcentrationRisk}) reflects constant-product pool depth only.`;
    }
  }

  let headline: string;
  if (!hasLiquidityTelemetry) {
    headline =
      "HIGH AMM dump risk (data unavailable): upstream liquidity telemetry failed; verify DEX depth before trading.";
  } else if (reserveSource === "confirmed_zero_liquidity") {
    headline =
      "CRITICAL AMM dump risk: $0 active Solana pool reserve implies 100% price drop on any sell ($5k / $25k / $100k).";
  } else {
    headline = `${clusterConcentrationRisk} AMM dump stress: $${roundedReserve.toLocaleString("en-US")} effective reserve absorbs $5k (-${s5}%), $25k (-${s25}%), and $100k (-${s100}%) sells; unlock x402 Pro for Top-10 holder cluster dump simulation.`;
  }

  let scoreAdjustment = 0;
  if (extraFlags && hasLiquidityTelemetry) {
    if (clusterConcentrationRisk === "CRITICAL") {
      scoreAdjustment = 8;
      extraFlags.push({
        code: "AMM_DUMP_STRESS_CRITICAL",
        severity: "danger",
        label: "Critical constant-product AMM dump risk",
        detail: explanation,
      });
    } else if (clusterConcentrationRisk === "HIGH") {
      scoreAdjustment = 4;
      extraFlags.push({
        code: "AMM_DUMP_STRESS_HIGH",
        severity: "warn",
        label: "High constant-product AMM dump impact",
        detail: explanation,
      });
    }
  }

  const stressTest: AmmDumpStressTest = {
    formula: AMM_DUMP_FORMULA,
    model: "constant-product-xy-k",
    dataQuality,
    reserveSource,
    effectiveReserveUsd: roundedReserve,
    totalLiquidityUsd: roundedTotalLiq,
    valuationBasisUsd,
    valuationBasisSource,
    top10HoldersPct,
    top10HoldersDumpUsd,
    top10HoldersDumpImpactPct,
    top10HoldersPriceAfterRatio,
    tiers: {
      sell5k,
      sell25k,
      sell100k,
    },
    clusterConcentrationRisk,
    explanation,
  };

  const freeSummary: AmmDumpStressSummary = {
    formula: AMM_DUMP_FORMULA,
    dataQuality,
    effectiveReserveUsd: roundedReserve,
    sell5kImpactPct: sell5k.priceDropPct,
    sell25kImpactPct: sell25k.priceDropPct,
    sell100kImpactPct: sell100k.priceDropPct,
    top10HoldersDumpImpactPct,
    clusterConcentrationRisk,
    headline,
  };

  return {
    stressTest,
    freeSummary,
    scoreAdjustment,
  };
}

function extractTokenMeta(
  mint: string,
  dex: NormalizedDexData | null,
  rcFull: RugCheckFullResponse | null
): TokenSnapshotMeta {
  const primary = dex?.primaryPair ?? null;
  const tokenSide =
    primary?.baseToken?.address === mint
      ? primary.baseToken
      : primary?.quoteToken?.address === mint
        ? primary.quoteToken
        : primary?.baseToken;

  const pairCreatedAt =
    typeof primary?.pairCreatedAt === "number" && Number.isFinite(primary.pairCreatedAt)
      ? new Date(primary.pairCreatedAt).toISOString()
      : null;

  return {
    name:
      tokenSide?.name ??
      rcFull?.tokenMeta?.name ??
      rcFull?.verification?.name ??
      null,
    symbol:
      tokenSide?.symbol ??
      rcFull?.tokenMeta?.symbol ??
      rcFull?.verification?.symbol ??
      null,
    priceUsd:
      primary?.baseToken?.address === mint
        ? finiteNum(primary.priceUsd)
        : null,
    priceNative:
      primary?.baseToken?.address === mint
        ? finiteNum(primary.priceNative)
        : null,
    imageUrl: primary?.info?.imageUrl ?? null,
    primaryDex: primary?.dexId ?? null,
    primaryPairAddress: primary?.pairAddress ?? null,
    pairCreatedAt,
  };
}

function extractMarketSnapshot(dex: NormalizedDexData | null): MarketSnapshot {
  const pairs = dex?.basePairs ?? [];
  const primary = dex?.primaryPair ?? null;

  let liquidityUsd = 0;
  let volume24hUsd = 0;
  for (const pair of pairs) {
    liquidityUsd += finiteNum(pair.liquidity?.usd) ?? 0;
    volume24hUsd += finiteNum(pair.volume?.h24) ?? 0;
  }

  const fdvUsd = finiteNum(primary?.fdv);
  const marketCapUsd = finiteNum(primary?.marketCap);
  const fdvToLiquidityRatio =
    fdvUsd !== null && liquidityUsd > 0 ? round2(fdvUsd / liquidityUsd) : null;
  const volume24hToLiquidityRatio =
    liquidityUsd > 0 ? round2(volume24hUsd / liquidityUsd) : null;

  return {
    liquidityUsd: round2(liquidityUsd),
    volume24hUsd: round2(volume24hUsd),
    fdvUsd: fdvUsd !== null ? round2(fdvUsd) : null,
    marketCapUsd: marketCapUsd !== null ? round2(marketCapUsd) : null,
    fdvToLiquidityRatio,
    volume24hToLiquidityRatio,
    poolCount: pairs.length,
    priceChange24hPct: finiteNum(primary?.priceChange?.h24),
  };
}

function mapRugCheckLevel(level?: string): "info" | "warn" | "danger" {
  const normalized = (level ?? "").toLowerCase();
  if (normalized === "danger" || normalized === "critical" || normalized === "error") {
    return "danger";
  }
  if (normalized === "warn" || normalized === "warning") {
    return "warn";
  }
  return "info";
}

function computeVerdict(score: number, honeypotTriggered: boolean): Verdict {
  if (honeypotTriggered || score >= 80) {
    return "HONEYPOT_ALERT";
  }
  if (score >= 55) {
    return "HIGH_RISK";
  }
  if (score >= 25) {
    return "CAUTION";
  }
  return "LOW_RISK";
}

interface CoreRiskComputation {
  rugRiskScore: number;
  verdict: Verdict;
  riskFlags: RiskFlag[];
  honeypotTriggered: boolean;
  lpLockedPct: number | null;
  rugcheckScoreNormalised: number | null;
}

function computeCoreRisk(
  dex: NormalizedDexData | null,
  market: MarketSnapshot,
  rcSummary: RugCheckSummaryResponse | null,
  rcFull: RugCheckFullResponse | null,
  sources: SignalSourcesStatus,
  nowMs: number
): CoreRiskComputation {
  const flags: RiskFlag[] = [];
  let score = 0;
  let honeypotTriggered = false;

  const rugcheckScoreNormalised = finiteNum(rcSummary?.score_normalised);
  const lpLockedPct = finiteNum(rcSummary?.lpLockedPct);

  if (!sources.dexscreener.ok) {
    flags.push({
      code: "UPSTREAM_DEXSCREENER_DEGRADED",
      severity: "warn",
      label: "DexScreener unavailable",
      detail: sources.dexscreener.error ?? "DexScreener request failed",
    });
    score += 10;
  }

  if (!sources.rugcheck.ok) {
    flags.push({
      code: "UPSTREAM_RUGCHECK_DEGRADED",
      severity: "warn",
      label: "RugCheck unavailable",
      detail: sources.rugcheck.error ?? "RugCheck request failed",
    });
    score += 10;
  }

  if (rugcheckScoreNormalised !== null) {
    score += Math.round(clamp(rugcheckScoreNormalised, 0, 100) * 0.45);
  }

  if (rcFull?.rugged === true) {
    honeypotTriggered = true;
    score = Math.max(score, 95);
    flags.push({
      code: "RUGCHECK_MARKED_RUGGED",
      severity: "danger",
      label: "Token flagged as rugged",
      detail: "RugCheck marks this SPL mint as already rugged.",
    });
  }

  const rcRisks: RugCheckRiskItem[] = Array.isArray(rcSummary?.risks)
    ? rcSummary.risks
    : [];
  let dangerCount = 0;
  let warnCount = 0;

  for (const risk of rcRisks) {
    const level = mapRugCheckLevel(risk.level);
    const name = (risk.name ?? "Unknown risk").trim();
    const lowerName = name.toLowerCase();

    if (
      lowerName.includes("honeypot") ||
      lowerName.includes("freezeable") ||
      lowerName.includes("non-transferable")
    ) {
      honeypotTriggered = true;
    }

    if (level === "danger") {
      dangerCount += 1;
    } else if (level === "warn") {
      warnCount += 1;
    }

    flags.push({
      code: `RUGCHECK_${name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 36)}`,
      severity: level,
      label: name,
      detail:
        (risk.description ?? "").trim() ||
        (risk.value ? `Observed value: ${risk.value}` : "Flagged by RugCheck"),
    });
  }

  score += Math.min(35, dangerCount * 14);
  score += Math.min(15, warnCount * 5);

  // Market depth heuristics
  if (sources.dexscreener.ok && market.poolCount === 0) {
    score += 25;
    flags.push({
      code: "NO_ACTIVE_SOLANA_POOLS",
      severity: "danger",
      label: "No active Solana DEX pools",
      detail: "DexScreener reports zero active Solana liquidity pools for this mint.",
    });
  } else if (sources.dexscreener.ok) {
    if (market.liquidityUsd < 1_000) {
      score += 35;
      flags.push({
        code: "CRITICAL_MICRO_LIQUIDITY",
        severity: "danger",
        label: "Microscopic liquidity (< $1K)",
        detail: `Aggregate Solana liquidity is only $${market.liquidityUsd.toLocaleString("en-US")}. Extreme slippage / exit risk.`,
      });
    } else if (market.liquidityUsd < 10_000) {
      score += 22;
      flags.push({
        code: "LOW_LIQUIDITY",
        severity: "danger",
        label: "Low DEX liquidity (< $10K)",
        detail: `Aggregate Solana liquidity is $${market.liquidityUsd.toLocaleString("en-US")}.`,
      });
    } else if (market.liquidityUsd < 50_000) {
      score += 10;
      flags.push({
        code: "THIN_LIQUIDITY",
        severity: "warn",
        label: "Thin DEX liquidity (< $50K)",
        detail: `Aggregate Solana liquidity is $${market.liquidityUsd.toLocaleString("en-US")}.`,
      });
    }
  }

  // FDV / Liquidity ratio — penalize paper valuations on sub-$500K / narrow-pool DEX tokens,
  // while recognizing deep ($1M+, or $500K+ across 5+ pools) assets trade heavily on CEX venues.
  if (market.fdvToLiquidityRatio !== null) {
    const deepMultiVenueLiq =
      market.liquidityUsd >= 1_000_000 ||
      (market.liquidityUsd >= 500_000 && market.poolCount >= 5);
    if (deepMultiVenueLiq && market.fdvToLiquidityRatio > 100) {
      score += 6;
      flags.push({
        code: "CEX_DOMINANT_FDV_LIQ_RATIO",
        severity: "info",
        label: "High FDV/DEX liquidity ratio (multi-venue / CEX-depth asset)",
        detail: `FDV is ${market.fdvToLiquidityRatio}x aggregate DEX liquidity across ${market.poolCount} pools ($${market.liquidityUsd.toLocaleString("en-US")} DEX depth), typical for CEX-listed tokens.`,
      });
    } else if (!deepMultiVenueLiq && market.fdvToLiquidityRatio > 100) {
      score += 24;
      flags.push({
        code: "EXTREME_FDV_LIQ_RATIO",
        severity: "danger",
        label: "Extreme FDV/Liquidity distortion (>100x)",
        detail: `FDV is ${market.fdvToLiquidityRatio}x larger than aggregate DEX liquidity.`,
      });
    } else if (!deepMultiVenueLiq && market.fdvToLiquidityRatio > 40) {
      score += 14;
      flags.push({
        code: "HIGH_FDV_LIQ_RATIO",
        severity: "warn",
        label: "Elevated FDV/Liquidity ratio (>40x)",
        detail: `FDV is ${market.fdvToLiquidityRatio}x larger than aggregate DEX liquidity.`,
      });
    } else if (market.liquidityUsd < 500_000 && market.fdvToLiquidityRatio > 15) {
      score += 6;
      flags.push({
        code: "MODERATE_FDV_LIQ_RATIO",
        severity: "info",
        label: "Watch FDV/Liquidity ratio (>15x)",
        detail: `FDV is ${market.fdvToLiquidityRatio}x aggregate DEX liquidity.`,
      });
    }
  }

  // LP lock risk on small-cap tokens (blue-chip CLMM pools typically don't burn LP NFTs).
  if (
    lpLockedPct !== null &&
    sources.dexscreener.ok &&
    market.poolCount > 0 &&
    market.liquidityUsd < 250_000 &&
    lpLockedPct < 20
  ) {
    score += 15;
    flags.push({
      code: "LOW_LP_LOCK_SMALL_CAP",
      severity: "warn",
      label: "Low LP lock on small-cap liquidity",
      detail: `Only ${round2(lpLockedPct)}% LP locked while aggregate DEX liquidity is under $250K.`,
    });
  }

  // Newly created pool heuristic (< 24h old with < $100K liquidity).
  const createdMs = finiteNum(dex?.primaryPair?.pairCreatedAt);
  if (createdMs !== null && market.liquidityUsd < 100_000) {
    const ageHours = (nowMs - createdMs) / (1000 * 60 * 60);
    if (ageHours >= 0 && ageHours < 24) {
      score += 10;
      flags.push({
        code: "NEW_PAIR_UNDER_24H",
        severity: "warn",
        label: "Fresh liquidity pool (<24h old)",
        detail: `Primary pool launched ${round2(ageHours)}h ago with $${market.liquidityUsd.toLocaleString("en-US")} liquidity.`,
      });
    }
  }

  // High transfer fee check when full RugCheck data is present.
  const transferFeePct = finiteNum(rcFull?.transferFee?.pct);
  if (transferFeePct !== null && transferFeePct >= 5) {
    score += transferFeePct >= 15 ? 30 : 12;
    if (transferFeePct >= 25) {
      honeypotTriggered = true;
    }
    flags.push({
      code: "HIGH_TRANSFER_FEE",
      severity: transferFeePct >= 15 ? "danger" : "warn",
      label: `Token-2022 transfer tax (${round2(transferFeePct)}%)`,
      detail: `Transfer fee of ${round2(transferFeePct)}% reduces realized exit proceeds.`,
    });
  }

  const finalScore = Math.round(clamp(score, 0, 100));
  const verdict = computeVerdict(finalScore, honeypotTriggered);

  return {
    rugRiskScore: finalScore,
    verdict,
    riskFlags: flags,
    honeypotTriggered,
    lpLockedPct: lpLockedPct !== null ? round2(lpLockedPct) : null,
    rugcheckScoreNormalised:
      rugcheckScoreNormalised !== null ? round2(rugcheckScoreNormalised) : null,
  };
}

export function buildFreeSignal(params: {
  mint: string;
  dex: NormalizedDexData | null;
  rcSummary: RugCheckSummaryResponse | null;
  sources: SignalSourcesStatus;
  origin: string;
  priceMicroUsdc: string;
  nowMs: number;
}): FreeSignalReport {
  const token = extractTokenMeta(params.mint, params.dex, null);
  const market = extractMarketSnapshot(params.dex);
  const core = computeCoreRisk(
    params.dex,
    market,
    params.rcSummary,
    null,
    params.sources,
    params.nowMs
  );
  const { freeSummary: ammDumpStress } = analyzeAmmDumpStress({
    market,
    sources: params.sources,
    rcFull: null,
    holderConcentration: null,
  });

  const priceUsdcNum = Number(params.priceMicroUsdc) / 1_000_000;
  const priceUsdc = Number.isFinite(priceUsdcNum)
    ? priceUsdcNum.toFixed(3)
    : "0.005";

  return {
    product: "upswing-solsignal",
    schemaVersion: "2.0",
    tier: "free",
    mint: params.mint,
    generatedAt: new Date(params.nowMs).toISOString(),
    degraded: !params.sources.dexscreener.ok || !params.sources.rugcheck.ok,
    token,
    market,
    safety: {
      rugRiskScore: core.rugRiskScore,
      verdict: core.verdict,
      lpLockedPct: core.lpLockedPct,
      rugcheckScoreNormalised: core.rugcheckScoreNormalised,
      riskFlags: core.riskFlags,
    },
    ammDumpStress,
    sources: params.sources,
    upgrade: {
      proEndpoint: `${params.origin}/api/v1/pro/signal?mint=${encodeURIComponent(params.mint)}`,
      protocol: "x402",
      priceUsdc,
      priceMicroUsdc: params.priceMicroUsdc,
      features: [
        "Constant-product AMM liquidity dump stress-test (Top-10 holder dump + $5k / $25k / $100k tiers)",
        "Full RugCheck authority, creator & insider graph breakdown",
        "Top-holder concentration (Top 1 / 5 / 10 / 20 & insider supply %)",
        "LP lock/burn & stable-quote depth analysis",
        "Multi-pool liquidity fragmentation (HHI & venue distribution)",
        "Buy/sell order-flow imbalance across 5m / 1h / 6h / 24h",
        "Wash-volume anomaly score & structured agent verdict",
      ],
    },
  };
}

function buildOrderFlowWindow(
  pairs: DexScreenerPair[],
  primaryPair: DexScreenerPair | null,
  key: "m5" | "h1" | "h6" | "h24"
): OrderFlowWindow {
  let buys = 0;
  let sells = 0;
  let volumeUsd = 0;

  for (const pair of pairs) {
    const txn = pair.txns?.[key];
    buys += finiteNum(txn?.buys) ?? 0;
    sells += finiteNum(txn?.sells) ?? 0;
    volumeUsd += finiteNum(pair.volume?.[key]) ?? 0;
  }

  const totalTxns = buys + sells;
  const buySellRatio =
    sells > 0 ? round4(buys / sells) : buys > 0 ? round4(buys) : null;
  const buyPressurePct =
    totalTxns > 0 ? round2((buys / totalTxns) * 100) : null;

  let netFlowBias: OrderFlowWindow["netFlowBias"] = "NO_ACTIVITY";
  if (totalTxns > 0 && buyPressurePct !== null) {
    if (buyPressurePct >= 56) {
      netFlowBias = "ACCUMULATION";
    } else if (buyPressurePct <= 44) {
      netFlowBias = "DISTRIBUTION";
    } else {
      netFlowBias = "NEUTRAL";
    }
  }

  return {
    buys,
    sells,
    totalTxns,
    buySellRatio,
    buyPressurePct,
    netFlowBias,
    volumeUsd: round2(volumeUsd),
    priceChangePct: finiteNum(primaryPair?.priceChange?.[key]),
  };
}

function analyzeHolderConcentration(
  rcFull: RugCheckFullResponse | null,
  extraFlags: RiskFlag[]
): {
  concentration: ProSignalReport["holderConcentration"];
  scoreAdjustment: number;
} {
  const rawHolders = Array.isArray(rcFull?.topHolders) ? rcFull.topHolders : [];
  if (rawHolders.length === 0) {
    return {
      concentration: {
        available: false,
        top1Pct: null,
        top5Pct: null,
        top10Pct: null,
        top20Pct: null,
        insiderHolderCount: 0,
        insiderSupplyPct: null,
        concentrationRisk: "UNAVAILABLE",
        topHolders: [],
      },
      scoreAdjustment: 0,
    };
  }

  const sorted = [...rawHolders].sort(
    (a, b) => (finiteNum(b.pct) ?? 0) - (finiteNum(a.pct) ?? 0)
  );

  const sumTop = (n: number): number =>
    round2(
      sorted.slice(0, n).reduce((acc, item) => acc + (finiteNum(item.pct) ?? 0), 0)
    );

  const top1Pct = sumTop(1);
  const top5Pct = sumTop(5);
  const top10Pct = sumTop(10);
  const top20Pct = sumTop(20);

  let insiderHolderCount = 0;
  let insiderSupplyPct = 0;
  for (const holder of sorted) {
    if (holder.insider === true) {
      insiderHolderCount += 1;
      insiderSupplyPct += finiteNum(holder.pct) ?? 0;
    }
  }
  insiderSupplyPct = round2(insiderSupplyPct);

  let concentrationRisk: ProSignalReport["holderConcentration"]["concentrationRisk"] =
    "LOW";
  let scoreAdjustment = 0;

  if (top1Pct >= 35 || top10Pct >= 75 || insiderSupplyPct >= 25) {
    concentrationRisk = "CRITICAL";
    scoreAdjustment = 18;
    extraFlags.push({
      code: "CRITICAL_HOLDER_CONCENTRATION",
      severity: "danger",
      label: "Extreme top-holder concentration",
      detail: `Top 1 holds ${top1Pct}%, Top 10 holds ${top10Pct}% (insider supply ${insiderSupplyPct}%).`,
    });
  } else if (top1Pct >= 20 || top10Pct >= 55 || insiderSupplyPct >= 10) {
    concentrationRisk = "HIGH";
    scoreAdjustment = 10;
    extraFlags.push({
      code: "HIGH_HOLDER_CONCENTRATION",
      severity: "warn",
      label: "High top-holder concentration",
      detail: `Top 1 holds ${top1Pct}%, Top 10 holds ${top10Pct}% of tracked supply.`,
    });
  } else if (top10Pct >= 35) {
    concentrationRisk = "MODERATE";
    scoreAdjustment = 3;
  }

  return {
    concentration: {
      available: true,
      top1Pct,
      top5Pct,
      top10Pct,
      top20Pct,
      insiderHolderCount,
      insiderSupplyPct,
      concentrationRisk,
      topHolders: sorted.slice(0, 10).map((holder) => ({
        address: holder.address ?? "unknown",
        owner: holder.owner ?? null,
        pct: round2(finiteNum(holder.pct) ?? 0),
        insider: holder.insider === true,
      })),
    },
    scoreAdjustment,
  };
}

function analyzeLpLockAndBurn(
  rcSummary: RugCheckSummaryResponse | null,
  rcFull: RugCheckFullResponse | null
): ProSignalReport["lpLockAndBurn"] {
  const lpLockedPct = finiteNum(rcSummary?.lpLockedPct);
  const markets = Array.isArray(rcFull?.markets) ? rcFull.markets : [];

  let weightedLockNumerator = 0;
  let weightedLockDenominator = 0;
  for (const market of markets) {
    const pct = finiteNum(market.lp?.lpLockedPct);
    const usd = finiteNum(market.lp?.lpLockedUSD);
    if (pct !== null && usd !== null && usd > 0) {
      weightedLockNumerator += pct * usd;
      weightedLockDenominator += usd;
    }
  }

  const lpBurnedOrLockedEstimatePct =
    weightedLockDenominator > 0
      ? round2(weightedLockNumerator / weightedLockDenominator)
      : lpLockedPct !== null
        ? round2(lpLockedPct)
        : null;

  const totalMarketLiquidityUsd = finiteNum(rcFull?.totalMarketLiquidity);
  const totalStableLiquidityUsd = finiteNum(rcFull?.totalStableLiquidity);
  const stableLiquiditySharePct =
    totalMarketLiquidityUsd !== null &&
    totalMarketLiquidityUsd > 0 &&
    totalStableLiquidityUsd !== null
      ? round2((totalStableLiquidityUsd / totalMarketLiquidityUsd) * 100)
      : null;

  const lockerCount =
    rcFull?.lockers && typeof rcFull.lockers === "object"
      ? Object.keys(rcFull.lockers).length
      : null;

  const effectiveLock = lpBurnedOrLockedEstimatePct ?? lpLockedPct;
  let status: ProSignalReport["lpLockAndBurn"]["status"] = "UNLOCKED_OR_UNKNOWN";
  if (effectiveLock !== null) {
    if (effectiveLock >= 80) {
      status = "STRONG_LOCK";
    } else if (effectiveLock >= 20) {
      status = "PARTIAL_LOCK";
    }
  }

  return {
    lpLockedPct: lpLockedPct !== null ? round2(lpLockedPct) : null,
    lpBurnedOrLockedEstimatePct,
    totalLPProviders: finiteNum(rcFull?.totalLPProviders),
    lockerCount,
    totalMarketLiquidityUsd:
      totalMarketLiquidityUsd !== null ? round2(totalMarketLiquidityUsd) : null,
    totalStableLiquidityUsd:
      totalStableLiquidityUsd !== null ? round2(totalStableLiquidityUsd) : null,
    stableLiquiditySharePct,
    status,
  };
}

function analyzeLiquidityFragmentation(
  dex: NormalizedDexData | null
): ProSignalReport["liquidityFragmentation"] {
  const pairs = dex?.basePairs ?? [];
  if (pairs.length === 0) {
    return {
      totalLiquidityUsd: 0,
      poolCount: 0,
      dexCount: 0,
      dexes: [],
      dominantPoolSharePct: null,
      hhiIndex: null,
      fragmentationGrade: "NO_POOLS",
      topPools: [],
    };
  }

  const totalLiquidityUsd = pairs.reduce(
    (sum, p) => sum + (finiteNum(p.liquidity?.usd) ?? 0),
    0
  );
  const dexSet = new Set<string>();
  let hhi = 0;

  const topPools = pairs.slice(0, 5).map((pair) => {
    const liq = finiteNum(pair.liquidity?.usd) ?? 0;
    const sharePct = totalLiquidityUsd > 0 ? (liq / totalLiquidityUsd) * 100 : 0;
    return {
      dexId: pair.dexId ?? "unknown",
      pairAddress: pair.pairAddress ?? "unknown",
      quoteSymbol: pair.quoteToken?.symbol ?? "UNKNOWN",
      liquidityUsd: round2(liq),
      volume24hUsd: round2(finiteNum(pair.volume?.h24) ?? 0),
      sharePct: round2(sharePct),
    };
  });

  for (const pair of pairs) {
    if (pair.dexId) {
      dexSet.add(pair.dexId);
    }
    const liq = finiteNum(pair.liquidity?.usd) ?? 0;
    if (totalLiquidityUsd > 0 && liq > 0) {
      const sharePct = (liq / totalLiquidityUsd) * 100;
      hhi += sharePct * sharePct;
    }
  }

  const dominantPoolSharePct =
    totalLiquidityUsd > 0
      ? round2(((finiteNum(pairs[0]?.liquidity?.usd) ?? 0) / totalLiquidityUsd) * 100)
      : null;
  const roundedHhi = totalLiquidityUsd > 0 ? Math.round(hhi) : null;

  let fragmentationGrade: ProSignalReport["liquidityFragmentation"]["fragmentationGrade"] =
    "BALANCED";
  if (roundedHhi === null) {
    fragmentationGrade = "NO_POOLS";
  } else if (roundedHhi >= 5000) {
    fragmentationGrade = "CONCENTRATED";
  } else if (roundedHhi <= 2000) {
    fragmentationGrade = "FRAGMENTED";
  }

  return {
    totalLiquidityUsd: round2(totalLiquidityUsd),
    poolCount: pairs.length,
    dexCount: dexSet.size,
    dexes: Array.from(dexSet).sort(),
    dominantPoolSharePct,
    hhiIndex: roundedHhi,
    fragmentationGrade,
    topPools,
  };
}

function analyzeWashVolume(
  market: MarketSnapshot,
  h24: OrderFlowWindow,
  fragmentation: ProSignalReport["liquidityFragmentation"],
  extraFlags: RiskFlag[]
): {
  wash: ProSignalReport["washVolumeAnomaly"];
  scoreAdjustment: number;
} {
  let washScore = 0;
  const signals: string[] = [];

  const volToLiq = market.volume24hToLiquidityRatio;
  const avgTradeSizeUsd24h =
    h24.totalTxns > 0 ? round2(h24.volumeUsd / h24.totalTxns) : null;
  const absPriceMove24h =
    market.priceChange24hPct !== null ? Math.abs(market.priceChange24hPct) : null;

  // High turnover with flat price action is a strong wash-trading signature.
  if (volToLiq !== null && volToLiq >= 50 && (absPriceMove24h === null || absPriceMove24h < 8)) {
    washScore += 45;
    signals.push(
      `Extreme 24h turnover (${volToLiq}x liquidity) paired with muted price move (${market.priceChange24hPct ?? 0}%)`
    );
  } else if (volToLiq !== null && volToLiq >= 20 && (absPriceMove24h === null || absPriceMove24h < 5)) {
    washScore += 28;
    signals.push(
      `Elevated 24h turnover (${volToLiq}x liquidity) with low directional displacement`
    );
  } else if (volToLiq !== null && volToLiq >= 30) {
    washScore += 15;
    signals.push(`High 24h volume-to-liquidity turnover (${volToLiq}x)`);
  }

  // Robotic near-50/50 buy-sell symmetry under elevated turnover.
  if (
    h24.totalTxns >= 500 &&
    h24.buyPressurePct !== null &&
    Math.abs(h24.buyPressurePct - 50) <= 1.8 &&
    volToLiq !== null &&
    volToLiq >= 8
  ) {
    washScore += 25;
    signals.push(
      `Symmetric buy/sell ratio (${h24.buyPressurePct}% buys across ${h24.totalTxns} txns) suggests automated ping-pong flow`
    );
  }

  // Micro-trade bump-bot spam signature.
  if (avgTradeSizeUsd24h !== null && avgTradeSizeUsd24h < 5 && h24.totalTxns >= 2000) {
    washScore += 22;
    signals.push(
      `Micro average trade size ($${avgTradeSizeUsd24h}) across ${h24.totalTxns} txns resembles bump-bot activity`
    );
  }

  // Single-pool extreme churn.
  if (
    fragmentation.dominantPoolSharePct !== null &&
    fragmentation.dominantPoolSharePct >= 95 &&
    volToLiq !== null &&
    volToLiq >= 25
  ) {
    washScore += 15;
    signals.push(
      `Single pool holds ${fragmentation.dominantPoolSharePct}% of liquidity while churning ${volToLiq}x daily volume`
    );
  }

  const finalWashScore = Math.round(clamp(washScore, 0, 100));
  let level: ProSignalReport["washVolumeAnomaly"]["level"] = "NORMAL";
  let scoreAdjustment = 0;
  if (finalWashScore >= 70) {
    level = "EXTREME";
    scoreAdjustment = 14;
    extraFlags.push({
      code: "WASH_VOLUME_EXTREME",
      severity: "danger",
      label: "Extreme wash-volume anomaly",
      detail: signals[0] ?? "Synthetic volume churn patterns detected.",
    });
  } else if (finalWashScore >= 45) {
    level = "SUSPICIOUS";
    scoreAdjustment = 8;
    extraFlags.push({
      code: "WASH_VOLUME_SUSPICIOUS",
      severity: "warn",
      label: "Suspicious volume-to-liquidity churn",
      detail: signals[0] ?? "Elevated automated turnover signals detected.",
    });
  } else if (finalWashScore >= 20) {
    level = "ELEVATED";
  }

  return {
    wash: {
      score: finalWashScore,
      level,
      volumeToLiquidityRatio24h: volToLiq,
      avgTradeSizeUsd24h,
      signals,
    },
    scoreAdjustment,
  };
}

export function buildProSignal(params: {
  mint: string;
  dex: NormalizedDexData | null;
  rcFull: RugCheckFullResponse | null;
  rcSummary: RugCheckSummaryResponse | null;
  rugcheckMode: "full" | "summary_fallback" | "unavailable";
  sources: SignalSourcesStatus;
  nowMs: number;
  payment: ProPaymentReceipt;
}): ProSignalReport {
  const token = extractTokenMeta(params.mint, params.dex, params.rcFull);
  const market = extractMarketSnapshot(params.dex);
  const core = computeCoreRisk(
    params.dex,
    market,
    params.rcSummary,
    params.rcFull,
    params.sources,
    params.nowMs
  );

  const extraFlags: RiskFlag[] = [];
  const { concentration, scoreAdjustment: holderAdj } = analyzeHolderConcentration(
    params.rcFull,
    extraFlags
  );
  const lpLockAndBurn = analyzeLpLockAndBurn(params.rcSummary, params.rcFull);
  const liquidityFragmentation = analyzeLiquidityFragmentation(params.dex);

  const pairs = params.dex?.basePairs ?? [];
  const primary = params.dex?.primaryPair ?? null;
  const m5 = buildOrderFlowWindow(pairs, primary, "m5");
  const h1 = buildOrderFlowWindow(pairs, primary, "h1");
  const h6 = buildOrderFlowWindow(pairs, primary, "h6");
  const h24 = buildOrderFlowWindow(pairs, primary, "h24");

  let momentumAlignment: ProSignalReport["orderFlowMicrostructure"]["momentumAlignment"] =
    "DIVERGENT";
  if (h24.totalTxns < 10 && h1.totalTxns < 3) {
    momentumAlignment = "LOW_ACTIVITY";
  } else if (
    (m5.netFlowBias === "ACCUMULATION" || h1.netFlowBias === "ACCUMULATION") &&
    (h6.netFlowBias === "ACCUMULATION" || h24.netFlowBias === "ACCUMULATION")
  ) {
    momentumAlignment = "BULLISH_ALIGNED";
  } else if (
    (m5.netFlowBias === "DISTRIBUTION" || h1.netFlowBias === "DISTRIBUTION") &&
    (h6.netFlowBias === "DISTRIBUTION" || h24.netFlowBias === "DISTRIBUTION")
  ) {
    momentumAlignment = "BEARISH_ALIGNED";
  }

  const { wash, scoreAdjustment: washAdj } = analyzeWashVolume(
    market,
    h24,
    liquidityFragmentation,
    extraFlags
  );

  const { stressTest: ammDumpStressTest, scoreAdjustment: ammAdj } =
    analyzeAmmDumpStress({
      market,
      sources: params.sources,
      rcFull: params.rcFull,
      holderConcentration: concentration,
      extraFlags,
    });

  const finalScore = Math.round(
    clamp(core.rugRiskScore + holderAdj + washAdj + ammAdj, 0, 100)
  );
  const verdict = computeVerdict(finalScore, core.honeypotTriggered);

  const degraded =
    !params.sources.dexscreener.ok ||
    !params.sources.rugcheck.ok ||
    params.rugcheckMode === "summary_fallback";

  const confidence: ProSignalReport["confidence"] =
    params.sources.dexscreener.ok && params.rugcheckMode === "full"
      ? "HIGH"
      : params.sources.dexscreener.ok || params.sources.rugcheck.ok
        ? "MEDIUM"
        : "LOW";

  const label = token.symbol ? `${token.symbol} (${params.mint.slice(0, 6)}...)` : params.mint;
  const amm25kStr =
    ammDumpStressTest.tiers.sell25k.priceDropPct !== null
      ? `-${ammDumpStressTest.tiers.sell25k.priceDropPct}%`
      : "N/A";
  const top10ImpactStr =
    ammDumpStressTest.top10HoldersDumpImpactPct !== null
      ? `-${ammDumpStressTest.top10HoldersDumpImpactPct}%`
      : `N/A (${ammDumpStressTest.dataQuality})`;
  const summary = `${label} rated ${verdict} (risk ${finalScore}/100, confidence ${confidence}) across ${liquidityFragmentation.poolCount} Solana pool(s) totaling $${market.liquidityUsd.toLocaleString("en-US")} liquidity; 24h flow ${h24.netFlowBias}, wash anomaly ${wash.level} (${wash.score}/100), AMM dump stress ${ammDumpStressTest.clusterConcentrationRisk} ($25k ${amm25kStr}, top-10 ${top10ImpactStr}).`;

  const rcRisks = Array.isArray(params.rcSummary?.risks)
    ? params.rcSummary.risks.map((item) => ({
        name: item.name ?? "Unknown risk",
        level: mapRugCheckLevel(item.level),
        score: finiteNum(item.score) ?? 0,
        value: item.value ?? "",
        description: item.description ?? "",
      }))
    : [];

  return {
    product: "upswing-solsignal",
    schemaVersion: "2.0",
    tier: "pro",
    mint: params.mint,
    generatedAt: new Date(params.nowMs).toISOString(),
    degraded,
    verdict,
    confidence,
    summary,
    rugRiskScore: finalScore,
    token,
    market,
    riskFlags: [...core.riskFlags, ...extraFlags],
    rugcheckBreakdown: {
      dataMode: params.rugcheckMode,
      rawScore: finiteNum(params.rcSummary?.score),
      scoreNormalised: core.rugcheckScoreNormalised,
      rugged: params.rcFull?.rugged === true,
      tokenProgram: params.rcSummary?.tokenProgram ?? null,
      creator: params.rcFull?.creator ?? null,
      creatorBalance: finiteNum(params.rcFull?.creatorBalance),
      mintAuthorityActive:
        params.rcFull !== null
          ? params.rcFull.mintAuthority !== null &&
            params.rcFull.mintAuthority !== undefined
          : null,
      freezeAuthorityActive:
        params.rcFull !== null
          ? params.rcFull.freezeAuthority !== null &&
            params.rcFull.freezeAuthority !== undefined
          : null,
      mutableMetadata:
        typeof params.rcFull?.tokenMeta?.mutable === "boolean"
          ? params.rcFull.tokenMeta.mutable
          : null,
      transferFeePct: finiteNum(params.rcFull?.transferFee?.pct),
      totalHolders: finiteNum(params.rcFull?.totalHolders),
      graphInsidersDetected: finiteNum(params.rcFull?.graphInsidersDetected),
      insiderNetworkCount: Array.isArray(params.rcFull?.insiderNetworks)
        ? params.rcFull.insiderNetworks.length
        : null,
      jupVerified:
        typeof params.rcFull?.verification?.jup_verified === "boolean"
          ? params.rcFull.verification.jup_verified
          : null,
      deployPlatform:
        params.rcFull?.deployPlatform ?? params.rcFull?.launchpad?.name ?? null,
      risks: rcRisks,
    },
    holderConcentration: concentration,
    lpLockAndBurn,
    liquidityFragmentation,
    orderFlowMicrostructure: {
      m5,
      h1,
      h6,
      h24,
      momentumAlignment,
    },
    washVolumeAnomaly: wash,
    ammDumpStressTest,
    sources: params.sources,
    payment: params.payment,
  };
}
