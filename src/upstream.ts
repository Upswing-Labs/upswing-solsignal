// Read-only upstream aggregators for DexScreener and RugCheck with strict 4s timeouts,
// bounded stream reading, and graceful degradation.

import { fetchBoundedJson, isValidSolanaMint } from "./security.ts";
import type {
  DexScreenerPair,
  DexScreenerResponse,
  FetchLike,
  RugCheckFullResponse,
  RugCheckSummaryResponse,
  UpstreamSourceStatus,
} from "./types.ts";

const DEXSCREENER_BASE = "https://api.dexscreener.com/latest/dex/tokens/";
const RUGCHECK_BASE = "https://api.rugcheck.xyz/v1/tokens/";

const MAX_DEXSCREENER_BYTES = 512 * 1024; // 512 KiB
const MAX_RUGCHECK_SUMMARY_BYTES = 128 * 1024; // 128 KiB
const MAX_RUGCHECK_FULL_BYTES = 4 * 1024 * 1024; // 4 MiB safety ceiling

export interface NormalizedDexData {
  allSolanaPairs: DexScreenerPair[];
  basePairs: DexScreenerPair[];
  primaryPair: DexScreenerPair | null;
}

export interface FreeUpstreamBundle {
  dex: NormalizedDexData | null;
  rugcheck: RugCheckSummaryResponse | null;
  sources: {
    dexscreener: UpstreamSourceStatus;
    rugcheck: UpstreamSourceStatus;
  };
}

export interface ProUpstreamBundle {
  dex: NormalizedDexData | null;
  rugcheckFull: RugCheckFullResponse | null;
  rugcheckSummary: RugCheckSummaryResponse | null;
  rugcheckMode: "full" | "summary_fallback" | "unavailable";
  sources: {
    dexscreener: UpstreamSourceStatus;
    rugcheck: UpstreamSourceStatus;
  };
}

function liquidityUsdOf(pair: DexScreenerPair): number {
  const val = pair.liquidity?.usd;
  return typeof val === "number" && Number.isFinite(val) && val > 0 ? val : 0;
}

export function normalizeDexScreenerPairs(
  mint: string,
  payload: DexScreenerResponse
): NormalizedDexData {
  const rawPairs = Array.isArray(payload.pairs) ? payload.pairs : [];
  const solanaPairs = rawPairs
    .filter((pair) => pair && pair.chainId === "solana")
    .sort((a, b) => liquidityUsdOf(b) - liquidityUsdOf(a));

  const matchingBasePairs = solanaPairs.filter(
    (pair) => pair.baseToken?.address === mint
  );
  const basePairs = matchingBasePairs.length > 0 ? matchingBasePairs : solanaPairs;

  return {
    allSolanaPairs: solanaPairs,
    basePairs,
    primaryPair: basePairs[0] ?? null,
  };
}

async function fetchDexScreener(
  mint: string,
  fetchFn: FetchLike,
  timeoutMs: number,
  now: () => number
): Promise<{ data: NormalizedDexData | null; status: UpstreamSourceStatus }> {
  if (!isValidSolanaMint(mint)) {
    return {
      data: null,
      status: { ok: false, latencyMs: 0, error: "Invalid mint address" },
    };
  }

  const res = await fetchBoundedJson<DexScreenerResponse>(
    `${DEXSCREENER_BASE}${encodeURIComponent(mint)}`,
    fetchFn,
    {
      timeoutMs,
      maxBytes: MAX_DEXSCREENER_BYTES,
      now,
    }
  );

  if (!res.ok) {
    return {
      data: null,
      status: { ok: false, latencyMs: res.latencyMs, error: res.error },
    };
  }

  return {
    data: normalizeDexScreenerPairs(mint, res.data),
    status: { ok: true, latencyMs: res.latencyMs, mode: "pairs" },
  };
}

async function fetchRugCheckSummary(
  mint: string,
  fetchFn: FetchLike,
  timeoutMs: number,
  now: () => number
): Promise<{ data: RugCheckSummaryResponse | null; status: UpstreamSourceStatus }> {
  if (!isValidSolanaMint(mint)) {
    return {
      data: null,
      status: { ok: false, latencyMs: 0, error: "Invalid mint address" },
    };
  }

  const res = await fetchBoundedJson<RugCheckSummaryResponse>(
    `${RUGCHECK_BASE}${encodeURIComponent(mint)}/report/summary`,
    fetchFn,
    {
      timeoutMs,
      maxBytes: MAX_RUGCHECK_SUMMARY_BYTES,
      now,
    }
  );

  if (!res.ok) {
    return {
      data: null,
      status: { ok: false, latencyMs: res.latencyMs, mode: "summary", error: res.error },
    };
  }

  return {
    data: res.data,
    status: { ok: true, latencyMs: res.latencyMs, mode: "summary" },
  };
}

async function fetchRugCheckFullWithFallback(
  mint: string,
  fetchFn: FetchLike,
  timeoutMs: number,
  now: () => number
): Promise<{
  full: RugCheckFullResponse | null;
  summary: RugCheckSummaryResponse | null;
  mode: "full" | "summary_fallback" | "unavailable";
  status: UpstreamSourceStatus;
}> {
  if (!isValidSolanaMint(mint)) {
    return {
      full: null,
      summary: null,
      mode: "unavailable",
      status: { ok: false, latencyMs: 0, error: "Invalid mint address" },
    };
  }

  const fullRes = await fetchBoundedJson<RugCheckFullResponse>(
    `${RUGCHECK_BASE}${encodeURIComponent(mint)}/report`,
    fetchFn,
    {
      timeoutMs,
      maxBytes: MAX_RUGCHECK_FULL_BYTES,
      now,
    }
  );

  if (fullRes.ok) {
    return {
      full: fullRes.data,
      summary: fullRes.data,
      mode: "full",
      status: { ok: true, latencyMs: fullRes.latencyMs, mode: "full" },
    };
  }

  // Fallback to lightweight summary endpoint when full report is too large or slow.
  const summaryRes = await fetchRugCheckSummary(
    mint,
    fetchFn,
    Math.min(timeoutMs, 2500),
    now
  );

  if (summaryRes.data) {
    return {
      full: null,
      summary: summaryRes.data,
      mode: "summary_fallback",
      status: {
        ok: true,
        latencyMs: fullRes.latencyMs + summaryRes.status.latencyMs,
        mode: "summary_fallback",
        error: `Full report degraded (${fullRes.error}); served summary fallback`,
      },
    };
  }

  return {
    full: null,
    summary: null,
    mode: "unavailable",
    status: {
      ok: false,
      latencyMs: fullRes.latencyMs + summaryRes.status.latencyMs,
      mode: "unavailable",
      error: fullRes.error,
    },
  };
}

export async function gatherFreeUpstream(
  mint: string,
  fetchFn: FetchLike,
  timeoutMs: number,
  now: () => number
): Promise<FreeUpstreamBundle> {
  const [dexResult, rcResult] = await Promise.all([
    fetchDexScreener(mint, fetchFn, timeoutMs, now),
    fetchRugCheckSummary(mint, fetchFn, timeoutMs, now),
  ]);

  return {
    dex: dexResult.data,
    rugcheck: rcResult.data,
    sources: {
      dexscreener: dexResult.status,
      rugcheck: rcResult.status,
    },
  };
}

export async function gatherProUpstream(
  mint: string,
  fetchFn: FetchLike,
  timeoutMs: number,
  now: () => number
): Promise<ProUpstreamBundle> {
  const [dexResult, rcResult] = await Promise.all([
    fetchDexScreener(mint, fetchFn, timeoutMs, now),
    fetchRugCheckFullWithFallback(mint, fetchFn, timeoutMs, now),
  ]);

  return {
    dex: dexResult.data,
    rugcheckFull: rcResult.full,
    rugcheckSummary: rcResult.summary,
    rugcheckMode: rcResult.mode,
    sources: {
      dexscreener: dexResult.status,
      rugcheck: rcResult.status,
    },
  };
}
