// Shared strict TypeScript types for Upswing SolSignal Worker.
// Pure erasable syntax (compatible with both Wrangler/esbuild and Node 24 native TS stripping).

export type Verdict = "LOW_RISK" | "CAUTION" | "HIGH_RISK" | "HONEYPOT_ALERT";

export type RiskSeverity = "info" | "warn" | "danger";

export interface RiskFlag {
  code: string;
  severity: RiskSeverity;
  label: string;
  detail: string;
}

export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface WorkerRuntimeDeps {
  fetchFn?: FetchLike;
  cache?: CacheLike;
  now?: () => number;
  upstreamTimeoutMs?: number;
  maxPaymentAgeSeconds?: number;
}

export interface DexScreenerTokenRef {
  address?: string;
  name?: string;
  symbol?: string;
}

export interface DexScreenerTxnWindow {
  buys?: number;
  sells?: number;
}

export interface DexScreenerPair {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  labels?: string[];
  baseToken?: DexScreenerTokenRef;
  quoteToken?: DexScreenerTokenRef;
  priceNative?: string;
  priceUsd?: string;
  txns?: {
    m5?: DexScreenerTxnWindow;
    h1?: DexScreenerTxnWindow;
    h6?: DexScreenerTxnWindow;
    h24?: DexScreenerTxnWindow;
  };
  volume?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  priceChange?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  liquidity?: {
    usd?: number;
    base?: number;
    quote?: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
  };
}

export interface DexScreenerResponse {
  schemaVersion?: string;
  pairs?: DexScreenerPair[] | null;
}

export interface RugCheckRiskItem {
  name?: string;
  value?: string;
  description?: string;
  score?: number;
  level?: string;
}

export interface RugCheckSummaryResponse {
  tokenProgram?: string;
  tokenType?: string;
  risks?: RugCheckRiskItem[];
  score?: number;
  score_normalised?: number;
  lpLockedPct?: number;
}

export interface RugCheckTopHolder {
  address?: string;
  owner?: string;
  amount?: number;
  decimals?: number;
  pct?: number;
  uiAmount?: number;
  insider?: boolean;
}

export interface RugCheckMarketLp {
  lpLockedPct?: number;
  lpLockedUSD?: number;
  lpUnlocked?: number;
  lpMaxSupply?: number;
  lpCurrentSupply?: number;
}

export interface RugCheckMarket {
  pubkey?: string;
  marketType?: string;
  mintA?: string;
  mintB?: string;
  lp?: RugCheckMarketLp;
}

export interface RugCheckFullResponse extends RugCheckSummaryResponse {
  mint?: string;
  creator?: string | null;
  creatorBalance?: number;
  mintAuthority?: unknown;
  freezeAuthority?: unknown;
  topHolders?: RugCheckTopHolder[] | null;
  markets?: RugCheckMarket[] | null;
  lockers?: Record<string, unknown> | null;
  totalMarketLiquidity?: number;
  totalStableLiquidity?: number;
  totalLPProviders?: number;
  totalHolders?: number;
  rugged?: boolean;
  transferFee?: {
    pct?: number;
    maxAmount?: number;
    authority?: string;
  } | null;
  graphInsidersDetected?: number;
  insiderNetworks?: unknown[] | null;
  verification?: {
    jup_verified?: boolean;
    jup_strict?: boolean;
    symbol?: string;
    name?: string;
  } | null;
  tokenMeta?: {
    name?: string;
    symbol?: string;
    mutable?: boolean;
  } | null;
  launchpad?: {
    name?: string;
    platform?: string;
  } | null;
  deployPlatform?: string | null;
}

export interface UpstreamSourceStatus {
  ok: boolean;
  latencyMs: number;
  mode?: string;
  error?: string;
}

export interface SignalSourcesStatus {
  dexscreener: UpstreamSourceStatus;
  rugcheck: UpstreamSourceStatus;
}

export interface TokenSnapshotMeta {
  name: string | null;
  symbol: string | null;
  priceUsd: number | null;
  priceNative: number | null;
  imageUrl: string | null;
  primaryDex: string | null;
  primaryPairAddress: string | null;
  pairCreatedAt: string | null;
}

export interface MarketSnapshot {
  liquidityUsd: number;
  volume24hUsd: number;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  fdvToLiquidityRatio: number | null;
  volume24hToLiquidityRatio: number | null;
  poolCount: number;
  priceChange24hPct: number | null;
}

export type AmmStressDataQuality =
  | "FULL"
  | "PARTIAL_POOL_PROXY"
  | "DEGRADED_NO_HOLDER_DATA"
  | "DEGRADED_NO_LIQUIDITY"
  | "UNAVAILABLE";

export type ClusterConcentrationRisk =
  | "LOW"
  | "MODERATE"
  | "HIGH"
  | "CRITICAL";

export interface AmmDumpTierResult {
  dumpUsd: number;
  priceAfterRatio: number | null;
  priceDropPct: number | null;
}

export interface AmmDumpStressSummary {
  formula: "priceDropPct = (1 - (R / (R + Q_risk))^2) * 100";
  dataQuality: AmmStressDataQuality;
  effectiveReserveUsd: number;
  sell5kImpactPct: number | null;
  sell25kImpactPct: number | null;
  sell100kImpactPct: number | null;
  top10HoldersDumpImpactPct: number | null;
  clusterConcentrationRisk: ClusterConcentrationRisk;
  headline: string;
}

export interface AmmDumpStressTest {
  formula: "priceDropPct = (1 - (R / (R + Q_risk))^2) * 100";
  model: "constant-product-xy-k";
  dataQuality: AmmStressDataQuality;
  reserveSource:
    | "dexscreener_aggregate_half_tvl"
    | "rugcheck_total_liquidity_fallback"
    | "confirmed_zero_liquidity"
    | "unavailable";
  effectiveReserveUsd: number;
  totalLiquidityUsd: number;
  valuationBasisUsd: number | null;
  valuationBasisSource: "market_cap" | "fdv" | "pool_depth_proxy" | "unavailable";
  top10HoldersPct: number | null;
  top10HoldersDumpUsd: number | null;
  top10HoldersDumpImpactPct: number | null;
  top10HoldersPriceAfterRatio: number | null;
  tiers: {
    sell5k: AmmDumpTierResult;
    sell25k: AmmDumpTierResult;
    sell100k: AmmDumpTierResult;
  };
  clusterConcentrationRisk: ClusterConcentrationRisk;
  explanation: string;
}

export interface FreeSignalReport {
  product: "upswing-solsignal";
  schemaVersion: "2.0";
  tier: "free";
  mint: string;
  generatedAt: string;
  degraded: boolean;
  token: TokenSnapshotMeta;
  market: MarketSnapshot;
  safety: {
    rugRiskScore: number;
    verdict: Verdict;
    lpLockedPct: number | null;
    rugcheckScoreNormalised: number | null;
    riskFlags: RiskFlag[];
  };
  ammDumpStress: AmmDumpStressSummary;
  sources: SignalSourcesStatus;
  upgrade: {
    proEndpoint: string;
    protocol: "x402";
    priceUsdc: string;
    priceMicroUsdc: string;
    features: string[];
  };
}

export interface OrderFlowWindow {
  buys: number;
  sells: number;
  totalTxns: number;
  buySellRatio: number | null;
  buyPressurePct: number | null;
  netFlowBias: "ACCUMULATION" | "NEUTRAL" | "DISTRIBUTION" | "NO_ACTIVITY";
  volumeUsd: number;
  priceChangePct: number | null;
}

export type SolanaX402Network =
  | "solana"
  | "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export interface ProPaymentReceipt {
  verified: true;
  scheme: "exact";
  network: SolanaX402Network;
  x402Version: 1 | 2;
  settlementMethod: "payai-facilitator" | "solana-rpc-postTokenBalances";
  txSignature: string;
  payer: string | null;
  amountMicroUsdc: string;
  asset: string;
  payTo: string;
  settledAt: string;
}

export interface ProSignalReport {
  product: "upswing-solsignal";
  schemaVersion: "2.0";
  tier: "pro";
  mint: string;
  generatedAt: string;
  degraded: boolean;
  verdict: Verdict;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  summary: string;
  rugRiskScore: number;
  token: TokenSnapshotMeta;
  market: MarketSnapshot;
  riskFlags: RiskFlag[];
  rugcheckBreakdown: {
    dataMode: "full" | "summary_fallback" | "unavailable";
    rawScore: number | null;
    scoreNormalised: number | null;
    rugged: boolean;
    tokenProgram: string | null;
    creator: string | null;
    creatorBalance: number | null;
    mintAuthorityActive: boolean | null;
    freezeAuthorityActive: boolean | null;
    mutableMetadata: boolean | null;
    transferFeePct: number | null;
    totalHolders: number | null;
    graphInsidersDetected: number | null;
    insiderNetworkCount: number | null;
    jupVerified: boolean | null;
    deployPlatform: string | null;
    risks: Array<{
      name: string;
      level: string;
      score: number;
      value: string;
      description: string;
    }>;
  };
  holderConcentration: {
    available: boolean;
    top1Pct: number | null;
    top5Pct: number | null;
    top10Pct: number | null;
    top20Pct: number | null;
    insiderHolderCount: number;
    insiderSupplyPct: number | null;
    concentrationRisk: "LOW" | "MODERATE" | "HIGH" | "CRITICAL" | "UNAVAILABLE";
    topHolders: Array<{
      address: string;
      owner: string | null;
      pct: number;
      insider: boolean;
    }>;
  };
  lpLockAndBurn: {
    lpLockedPct: number | null;
    lpBurnedOrLockedEstimatePct: number | null;
    totalLPProviders: number | null;
    lockerCount: number | null;
    totalMarketLiquidityUsd: number | null;
    totalStableLiquidityUsd: number | null;
    stableLiquiditySharePct: number | null;
    status: "STRONG_LOCK" | "PARTIAL_LOCK" | "UNLOCKED_OR_UNKNOWN";
  };
  liquidityFragmentation: {
    totalLiquidityUsd: number;
    poolCount: number;
    dexCount: number;
    dexes: string[];
    dominantPoolSharePct: number | null;
    hhiIndex: number | null;
    fragmentationGrade: "CONCENTRATED" | "BALANCED" | "FRAGMENTED" | "NO_POOLS";
    topPools: Array<{
      dexId: string;
      pairAddress: string;
      quoteSymbol: string;
      liquidityUsd: number;
      volume24hUsd: number;
      sharePct: number;
    }>;
  };
  orderFlowMicrostructure: {
    m5: OrderFlowWindow;
    h1: OrderFlowWindow;
    h6: OrderFlowWindow;
    h24: OrderFlowWindow;
    momentumAlignment:
      | "BULLISH_ALIGNED"
      | "BEARISH_ALIGNED"
      | "DIVERGENT"
      | "LOW_ACTIVITY";
  };
  washVolumeAnomaly: {
    score: number;
    level: "NORMAL" | "ELEVATED" | "SUSPICIOUS" | "EXTREME";
    volumeToLiquidityRatio24h: number | null;
    avgTradeSizeUsd24h: number | null;
    signals: string[];
  };
  ammDumpStressTest: AmmDumpStressTest;
  sources: SignalSourcesStatus;
  payment: ProPaymentReceipt;
}

export type X402HttpMethod = "GET" | "POST";

export interface X402OutputSchema {
  input:
    | {
        type: "http";
        method: "GET";
        discoverable: true;
        queryParams: {
          mint: {
            type: "string";
            required: true;
            description: string;
          };
        };
      }
    | {
        type: "http";
        method: "POST";
        discoverable: true;
        bodyType: "json";
        bodyFields: {
          mint: {
            type: "string";
            required: true;
            description: string;
          };
        };
      };
  output: {
    type: "object";
    description: string;
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
  };
}

export interface X402BazaarExtension {
  discoverable: true;
  info: {
    tags: string[];
    input:
      | {
          type: "http";
          method: "GET";
          queryParams: {
            mint: string;
          };
        }
      | {
          type: "http";
          method: "POST";
          bodyType: "json";
          body: {
            mint: string;
          };
        };
    output: {
      type: "json";
      example: Record<string, unknown>;
    };
  };
  schema: Record<string, unknown>;
}

export interface X402ResourceMetadata {
  url: string;
  description: string;
  mimeType: "application/json";
  serviceName: string;
  tags: string[];
  iconUrl: string;
}

export interface X402PaymentAcceptV1 {
  scheme: "exact";
  network: "solana";
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: "application/json";
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  outputSchema: X402OutputSchema;
  extra: {
    feePayer: string;
    assetSymbol: "USDC";
    assetDecimals: 6;
    humanAmount: string;
    facilitator: string;
    caip2Network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
    acceptedHeaders: ["PAYMENT-SIGNATURE", "X-PAYMENT", "X-PAYMENT-TX"];
  };
}

export interface X402PaymentAcceptV2 {
  scheme: "exact";
  network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    feePayer: string;
  };
}

export interface X402ChallengePayloadV2 {
  x402Version: 2;
  error: string;
  resource: X402ResourceMetadata;
  accepts: X402PaymentAcceptV2[];
  extensions: {
    bazaar: X402BazaarExtension;
  };
}

export interface X402ChallengePayload {
  x402Version: 1;
  error: string;
  resource: X402ResourceMetadata;
  accepts: X402PaymentAcceptV1[];
  extensions: {
    bazaar: X402BazaarExtension;
  };
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetEpochSeconds: number;
  retryAfterSeconds: number;
}
