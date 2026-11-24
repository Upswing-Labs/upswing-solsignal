// Cloudflare Cache API wrapper + bounded in-memory adapter for local tests,
// plus zero-cost IP rate limiting and x402 replay protection.

import { sha256Hex } from "./security.ts";
import type { CacheLike, RateLimitResult } from "./types.ts";

interface MemoryCacheEntry {
  body: string;
  status: number;
  headers: Array<[string, string]>;
  expiresAtMs: number;
}

function parseMaxAgeSeconds(cacheControl: string | null): number {
  if (!cacheControl) {
    return 60;
  }
  const match = /max-age=(\d+)/i.exec(cacheControl);
  if (!match || !match[1]) {
    return 60;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

export function createMemoryCache(
  options: { now?: () => number; maxEntries?: number } = {}
): CacheLike {
  const now = options.now ?? (() => Date.now());
  const maxEntries = options.maxEntries ?? 1024;
  const store = new Map<string, MemoryCacheEntry>();

  return {
    async match(request: Request): Promise<Response | undefined> {
      const entry = store.get(request.url);
      if (!entry) {
        return undefined;
      }
      if (now() >= entry.expiresAtMs) {
        store.delete(request.url);
        return undefined;
      }
      return new Response(entry.body, {
        status: entry.status,
        headers: entry.headers,
      });
    },

    async put(request: Request, response: Response): Promise<void> {
      const ttlSeconds = parseMaxAgeSeconds(response.headers.get("Cache-Control"));
      const cloned = response.clone();
      const body = await cloned.text();
      const headers: Array<[string, string]> = [];
      cloned.headers.forEach((value, key) => {
        headers.push([key, value]);
      });

      if (store.size >= maxEntries && !store.has(request.url)) {
        const oldestKey = store.keys().next().value;
        if (oldestKey !== undefined) {
          store.delete(oldestKey);
        }
      }

      store.set(request.url, {
        body,
        status: cloned.status,
        headers,
        expiresAtMs: now() + ttlSeconds * 1000,
      });
    },
  };
}

function isCacheStorageWithDefault(value: unknown): value is { default: CacheLike } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = Reflect.get(value, "default");
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }
  return (
    typeof Reflect.get(candidate, "match") === "function" &&
    typeof Reflect.get(candidate, "put") === "function"
  );
}

export function resolveEdgeCache(
  injected: CacheLike | undefined,
  fallbackFactory: () => CacheLike
): CacheLike {
  if (injected) {
    return injected;
  }
  const globalCaches = Reflect.get(globalThis, "caches");
  if (isCacheStorageWithDefault(globalCaches)) {
    return globalCaches.default;
  }
  return fallbackFactory();
}

export async function getCachedJson<T>(
  cache: CacheLike,
  cacheKeyUrl: string
): Promise<T | null> {
  try {
    const cached = await cache.match(new Request(cacheKeyUrl, { method: "GET" }));
    if (!cached) {
      return null;
    }
    return (await cached.json()) as T;
  } catch {
    return null;
  }
}

export async function putCachedJson(
  cache: CacheLike,
  cacheKeyUrl: string,
  payload: unknown,
  ttlSeconds: number
): Promise<void> {
  const safeTtl = Math.max(5, Math.min(86400, Math.floor(ttlSeconds)));
  const response = new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${safeTtl}`,
    },
  });
  await cache.put(new Request(cacheKeyUrl, { method: "GET" }), response);
}

export async function checkFreeRateLimit(
  cache: CacheLike,
  clientIp: string,
  limitPerMinute: number,
  nowMs: number
): Promise<RateLimitResult> {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limitPerMinute)));
  const windowSeconds = 60;
  const bucket = Math.floor(nowMs / (windowSeconds * 1000));
  const resetEpochSeconds = (bucket + 1) * windowSeconds;
  const retryAfterSeconds = Math.max(
    1,
    resetEpochSeconds - Math.floor(nowMs / 1000)
  );

  // Hash IP with SHA-256 so raw IP addresses are never placed in cache keys or logs.
  const ipHash = (await sha256Hex(`solsignal-rl:${clientIp}`)).slice(0, 24);
  const keyUrl = `https://ratelimit.solsignal.internal/v1/free/${ipHash}/${bucket}`;

  let currentCount = 0;
  try {
    const existing = await cache.match(new Request(keyUrl, { method: "GET" }));
    if (existing) {
      const parsed = (await existing.json()) as { count?: unknown };
      if (typeof parsed.count === "number" && Number.isFinite(parsed.count)) {
        currentCount = parsed.count;
      }
    }
  } catch {
    currentCount = 0;
  }

  if (currentCount >= safeLimit) {
    return {
      allowed: false,
      limit: safeLimit,
      remaining: 0,
      resetEpochSeconds,
      retryAfterSeconds,
    };
  }

  const nextCount = currentCount + 1;
  try {
    await putCachedJson(cache, keyUrl, { count: nextCount }, windowSeconds + 5);
  } catch {
    // Cache write failures degrade open for availability rather than dropping traffic.
  }

  return {
    allowed: true,
    limit: safeLimit,
    remaining: Math.max(0, safeLimit - nextCount),
    resetEpochSeconds,
    retryAfterSeconds,
  };
}
