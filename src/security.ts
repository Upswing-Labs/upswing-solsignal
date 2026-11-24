// Strict input validation, bounded streaming reads, CSP nonces, and security headers.

import type { FetchLike } from "./types.ts";

// Solana SPL mint public key: Base58 alphabet (no 0, O, I, l), 32 to 44 chars.
const SOLANA_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Solana Ed25519 transaction signature: Base58 alphabet, 64 to 96 chars (typically 87-88).
const SOLANA_TX_SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;

export function isValidSolanaMint(value: unknown): value is string {
  return typeof value === "string" && SOLANA_MINT_RE.test(value);
}

export function isValidSolanaTxSignature(value: unknown): value is string {
  return typeof value === "string" && SOLANA_TX_SIG_RE.test(value);
}

export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

export async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  }
  return hex;
}

export function extractClientIp(request: Request): string {
  const cfIp = request.headers.get("CF-Connecting-IP")?.trim();
  if (cfIp) {
    return cfIp;
  }
  const forwarded = request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  if (forwarded) {
    return forwarded;
  }
  return "anonymous";
}

export function resolvePublicOrigin(request: Request, configuredBaseUrl?: string): string {
  const trimmed = configuredBaseUrl?.trim();
  if (trimmed) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return parsed.origin;
      }
    } catch {
      // Fall back to incoming request origin if PUBLIC_BASE_URL is malformed.
    }
  }
  return new URL(request.url).origin;
}

export interface BoundedReadResult {
  ok: true;
  text: string;
  bytesRead: number;
}

export interface BoundedReadError {
  ok: false;
  reason: "PAYLOAD_TOO_LARGE" | "READ_FAILED";
  message: string;
}

// Stream body with a strict byte ceiling so unbounded payloads cannot OOM the Worker.
export async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  contentLengthHeader: string | null,
  maxBytes: number
): Promise<BoundedReadResult | BoundedReadError> {
  if (contentLengthHeader) {
    const declared = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      if (body) {
        try {
          await body.cancel();
        } catch {
          // Ignore cancel error on already-closed stream.
        }
      }
      return {
        ok: false,
        reason: "PAYLOAD_TOO_LARGE",
        message: `Payload exceeds maximum allowed size of ${maxBytes} bytes`,
      };
    }
  }

  if (!body) {
    return { ok: true, text: "", bytesRead: 0 };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return {
          ok: false,
          reason: "PAYLOAD_TOO_LARGE",
          message: `Payload exceeded maximum allowed size of ${maxBytes} bytes`,
        };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, text, bytesRead: totalBytes };
  } catch (err) {
    return {
      ok: false,
      reason: "READ_FAILED",
      message: err instanceof Error ? err.message : "Failed to read stream",
    };
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedRequestJson(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
  const read = await readBoundedText(
    request.body,
    request.headers.get("Content-Length"),
    maxBytes
  );
  if (!read.ok) {
    return {
      ok: false,
      status: read.reason === "PAYLOAD_TOO_LARGE" ? 413 : 400,
      error: read.message,
    };
  }
  if (!read.text.trim()) {
    return { ok: false, status: 400, error: "Empty JSON request body" };
  }
  try {
    const data: unknown = JSON.parse(read.text);
    return { ok: true, data };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON request body" };
  }
}

export interface BoundedFetchResult<T> {
  ok: true;
  data: T;
  status: number;
  latencyMs: number;
}

export interface BoundedFetchFailure {
  ok: false;
  status: number | null;
  latencyMs: number;
  error: string;
}

export async function fetchBoundedJson<T>(
  url: string,
  fetchFn: FetchLike,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs: number;
    maxBytes: number;
    now: () => number;
  }
): Promise<BoundedFetchResult<T> | BoundedFetchFailure> {
  const startedAt = options.now();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs);

  try {
    const response = await fetchFn(url, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Upswing-SolSignal/2.0",
        ...(options.headers ?? {}),
      },
      body: options.body,
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.body) {
        try {
          await response.body.cancel();
        } catch {
          // Ignore stream cancel error.
        }
      }
      return {
        ok: false,
        status: response.status,
        latencyMs: Math.max(0, options.now() - startedAt),
        error: `Upstream returned HTTP ${response.status}`,
      };
    }

    const bodyResult = await readBoundedText(
      response.body,
      response.headers.get("Content-Length"),
      options.maxBytes
    );
    const latencyMs = Math.max(0, options.now() - startedAt);

    if (!bodyResult.ok) {
      return {
        ok: false,
        status: response.status,
        latencyMs,
        error: bodyResult.message,
      };
    }

    try {
      const parsed = JSON.parse(bodyResult.text) as T;
      return {
        ok: true,
        data: parsed,
        status: response.status,
        latencyMs,
      };
    } catch {
      return {
        ok: false,
        status: response.status,
        latencyMs,
        error: "Upstream returned invalid JSON",
      };
    }
  } catch (err) {
    const latencyMs = Math.max(0, options.now() - startedAt);
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" || err.message.toLowerCase().includes("abort"));
    return {
      ok: false,
      status: null,
      latencyMs,
      error: isAbort
        ? `Upstream timed out after ${options.timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : "Upstream fetch failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function isCorsEnabledPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/docs/") ||
    pathname === "/openapi.json" ||
    pathname === "/mcp" ||
    pathname === "/health"
  );
}

export function buildCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Accept, PAYMENT-SIGNATURE, X-PAYMENT, X-PAYMENT-TX, X-PAYMENT-RESPONSE, PAYMENT-RESPONSE",
    "Access-Control-Expose-Headers":
      "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Cache",
    "Access-Control-Max-Age": "86400",
  };
}

export function applySecurityHeaders(
  headers: Headers,
  options: {
    contentType: "html" | "json" | "svg";
    cspNonce?: string;
    cors?: boolean;
  }
): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=()"
  );
  headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");

  if (options.contentType === "html") {
    const nonceDirective = options.cspNonce ? `'nonce-${options.cspNonce}'` : "'none'";
    headers.set(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        `script-src ${nonceDirective}`,
        `style-src ${nonceDirective}`,
        "connect-src 'self'",
        "img-src 'self' https://cdn.dexscreener.com data:",
        "font-src 'self'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'self' https://warpcast.com https://*.warpcast.com https://farcaster.xyz https://*.farcaster.xyz",
      ].join("; ")
    );
  } else if (options.contentType === "svg") {
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    headers.set("X-Frame-Options", "DENY");
  } else {
    headers.set(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'"
    );
    headers.set("X-Frame-Options", "DENY");
  }

  if (options.cors) {
    const corsHeaders = buildCorsHeaders();
    for (const [key, value] of Object.entries(corsHeaders)) {
      headers.set(key, value);
    }
  }
}

export function jsonResponse(
  payload: unknown,
  options: {
    status?: number;
    headers?: Record<string, string>;
    cors?: boolean;
  } = {}
): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    ...(options.headers ?? {}),
  });
  applySecurityHeaders(headers, {
    contentType: "json",
    cors: options.cors ?? false,
  });
  return new Response(JSON.stringify(payload, null, 2), {
    status: options.status ?? 200,
    headers,
  });
}

export function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
