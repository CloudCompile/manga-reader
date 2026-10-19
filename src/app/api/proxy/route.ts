import { NextRequest, NextResponse } from "next/server";
import { PROXY_BASE } from "@/lib/sources";
import { TtlCache } from "@/lib/cache";
import { UA, fetchFollowingSafe, okPublicUrl, readCapped } from "@/lib/net";

const CACHE_TTL = 30 * 60 * 1000;
// Roughly 100 pages of ~250KB, or a few large spreads. Without a ceiling the
// process holds every proxied image forever on a long-lived server.
const CACHE_MAX_BYTES = 256 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const CACHE = new TtlCache<string, { buf: ArrayBuffer; ct: string }>({
  ttlMs: CACHE_TTL,
  maxEntries: 2000,
  maxBytes: CACHE_MAX_BYTES,
  sizeOf: (v) => v.buf.byteLength,
});

function imageResponse(buf: ArrayBuffer, ct: string) {
  return new NextResponse(buf, {
    headers: {
      "Content-Type": ct,
      "Cache-Control": "public, max-age=1800, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return NextResponse.json({ error: "url param required" }, { status: 400 });

  const target = okPublicUrl(raw);
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

