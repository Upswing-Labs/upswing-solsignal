// Generated-format binding types matching wrangler.jsonc.
// Re-run `npm run types` (`wrangler types`) after adding or renaming bindings in wrangler.jsonc.

interface Env {
  PAYOUT_SOLANA_WALLET: string;
  USDC_SOLANA_MINT: string;
  PRO_PRICE_MICRO_USDC: string;
  X402_FACILITATOR_URL: string;
  X402_FEE_PAYER: string;
  SOLANA_RPC_URL: string;
  FREE_RATE_LIMIT_PER_MINUTE: string;
  SIGNAL_CACHE_TTL_SECONDS: string;
  PUBLIC_BASE_URL: string;
  FARCASTER_HEADER: string;
  FARCASTER_PAYLOAD: string;
  FARCASTER_SIGNATURE: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ExportedHandler<Environment = Env> {
  fetch(
    request: Request,
    env: Environment,
    ctx: ExecutionContext
  ): Response | Promise<Response>;
}

interface CacheStorageWithDefault {
  default: Cache;
}
