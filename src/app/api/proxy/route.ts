import { NextRequest, NextResponse } from "next/server";
import { PROXY_BASE } from "@/lib/sources";

const CACHE = new Map<string, { buf: ArrayBuffer; ct: string; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000;

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

function okImageUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
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

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return NextResponse.json({ error: "url param required" }, { status: 400 });

  const target = okImageUrl(raw);
  if (!target) return NextResponse.json({ error: "invalid image url" }, { status: 400 });
  const key = target.href;

  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return imageResponse(cached.buf, cached.ct);

  const referer = req.nextUrl.searchParams.get("ref") || `${target.origin}/`;

  async function attempt(url: string): Promise<Response> {
    return fetch(url, {
      headers: { "User-Agent": UA, Referer: referer, Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
      cache: "no-store",
    });
  }

  try {
    let resp: Response;
    try {
      resp = await attempt(key);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    } catch {
      // Retry through the CORS/captcha worker proxy.
      resp = await attempt(`${PROXY_BASE}/?url=${encodeURIComponent(key)}`);
    }

    if (!resp.ok) return new NextResponse("Image fetch failed", { status: resp.status });

    const buf = await resp.arrayBuffer();
    const ct = resp.headers.get("content-type") || "image/jpeg";
    if (!ct.startsWith("image/") && !ct.startsWith("application/octet-stream")) {
      return new NextResponse("Upstream did not return an image", { status: 502 });
    }
    CACHE.set(key, { buf, ct, ts: Date.now() });
    return imageResponse(buf, ct);
  } catch (err) {
    console.error("Proxy error:", err);
    return NextResponse.json({ error: "Failed to fetch image" }, { status: 502 });
  }
}
