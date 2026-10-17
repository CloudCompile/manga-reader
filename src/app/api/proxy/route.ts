import { NextRequest, NextResponse } from "next/server";
import { PROXY_BASE } from "@/lib/sources";
import { TtlCache } from "@/lib/cache";

const CACHE_TTL = 30 * 60 * 1000;
// Roughly 100 pages of ~250KB, or a few large spreads. Without a ceiling the
// process holds every proxied image forever on a long-lived server.
const CACHE_MAX_BYTES = 256 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
// Redirect chains are followed by hand so every hop can be re-checked; this is
// the ceiling on how many we follow.
const MAX_REDIRECTS = 5;

const CACHE = new TtlCache<string, { buf: ArrayBuffer; ct: string }>({
  ttlMs: CACHE_TTL,
  maxEntries: 2000,
  maxBytes: CACHE_MAX_BYTES,
  sizeOf: (v) => v.buf.byteLength,
});

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function okImageUrl(raw: string, base?: string): URL | null {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (isPrivateHost(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

function imageResponse(buf: ArrayBuffer, ct: string) {
  return new NextResponse(buf, {
    headers: {
      "Content-Type": ct,
      "Cache-Control": "public, max-age=1800, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function fetchOnce(url: string, referer: string): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": UA, Referer: referer, Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
    cache: "no-store",
    redirect: "manual",
  });
}

// Follow redirects one hop at a time, refusing any hop that lands on a private
// address. `fetch` with the default redirect mode would follow a public URL to
// 127.0.0.1 (or a cloud metadata endpoint) without ever re-running the check.
async function fetchFollowingSafe(url: URL, referer: string): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const resp = await fetchOnce(current.href, referer);
    const isRedirect = resp.status >= 300 && resp.status < 400;
    if (!isRedirect) return resp;
    const location = resp.headers.get("location");
    if (!location) return resp;
    const next = okImageUrl(location, current.href);
    if (!next) throw new Error("Redirect left the public internet");
    current = next;
  }
  throw new Error("Too many redirects");
}

// Read the body while enforcing a byte ceiling, so an endless or oversized
// upstream cannot exhaust memory.
async function readCapped(resp: Response, limit: number): Promise<ArrayBuffer | null> {
  const declared = Number(resp.headers.get("content-length") || "0");
  if (declared > limit) return null;
  if (!resp.body) {
    const buf = await resp.arrayBuffer();
    return buf.byteLength > limit ? null : buf;
  }
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return NextResponse.json({ error: "url param required" }, { status: 400 });

  const target = okImageUrl(raw);
  if (!target) return NextResponse.json({ error: "invalid image url" }, { status: 400 });
  const key = target.href;

  const cached = CACHE.get(key);
  if (cached) return imageResponse(cached.buf, cached.ct);

  const referer = req.nextUrl.searchParams.get("ref") || `${target.origin}/`;

  try {
    let resp: Response;
    try {
      resp = await fetchFollowingSafe(target, referer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    } catch {
      // Retry through the CORS/captcha worker proxy.
      resp = await fetch(`${PROXY_BASE}/?url=${encodeURIComponent(key)}`, {
        headers: { "User-Agent": UA, Referer: referer, Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
        cache: "no-store",
      });
    }

    if (!resp.ok) return new NextResponse("Image fetch failed", { status: resp.status });

    const ct = resp.headers.get("content-type") || "image/jpeg";
    if (!ct.startsWith("image/") && !ct.startsWith("application/octet-stream")) {
      return new NextResponse("Upstream did not return an image", { status: 502 });
    }

    const buf = await readCapped(resp, MAX_IMAGE_BYTES);
    if (!buf) return new NextResponse("Image too large", { status: 502 });

    CACHE.set(key, { buf, ct });
    return imageResponse(buf, ct);
  } catch (err) {
    console.error("Proxy error:", err);
    return NextResponse.json({ error: "Failed to fetch image" }, { status: 502 });
  }
}

