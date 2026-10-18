// A small in-memory rate limiter for the public API surface.
//
// The scrape endpoints fan out to third-party sites on every call, so an
// unthrottled client can hammer those upstreams (and get the deployment
// blocked). A fixed-window counter per client is enough here: it is cheap, it
// needs no shared store, and a per-instance limit is acceptable for a
// single-user reader.
//
// Image proxying is deliberately exempt — one chapter view legitimately fetches
// dozens of images, so a per-request limit there would break normal reading.

import type { NextRequest } from "next/server";

interface Window {
  count: number;
  resetAt: number;
}

const WINDOWS = new Map<string, Window>();
const MAX_KEYS = 5000;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfter: number;
}

// Best-effort client identity. `x-forwarded-for` is set by the platform proxy;
// falling back to a constant means a deployment without it shares one bucket,
// which is still safer than no limit at all.
export function clientKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export function rateLimit(req: NextRequest, limit: number, windowMs: number): RateLimitResult {
  const key = clientKey(req);
  const now = Date.now();
  let win = WINDOWS.get(key);
  if (!win || win.resetAt <= now) {
    win = { count: 0, resetAt: now + windowMs };
    WINDOWS.set(key, win);
  }
  win.count += 1;

  // Keep the map from growing without bound when many distinct clients appear.
  if (WINDOWS.size > MAX_KEYS) {
    for (const [k, w] of WINDOWS) if (w.resetAt <= now) WINDOWS.delete(k);
  }

  const remaining = Math.max(0, limit - win.count);
  return {
    ok: win.count <= limit,
    remaining,
    retryAfter: Math.max(1, Math.ceil((win.resetAt - now) / 1000)),
  };
}

// Wraps a handler with a limit, returning a 429 with standard headers when the
// client is over budget. The wrapper keeps the handler's own parameter list so
// the result stays assignable to the route signature Next.js expects.
export function withRateLimit<A extends unknown[]>(
  handler: (req: NextRequest, ...args: A) => Promise<Response> | Response,
  limit: number,
  windowMs = 60_000
): (req: NextRequest, ...args: A) => Promise<Response> {
  return async (req, ...args) => {
    const { ok, remaining, retryAfter } = rateLimit(req, limit, windowMs);
    if (!ok) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": "0",
        },
      });
    }
    const res = await handler(req, ...args);
    res.headers.set("X-RateLimit-Limit", String(limit));
    res.headers.set("X-RateLimit-Remaining", String(remaining));
    return res;
  };
}
