import { NextRequest, NextResponse } from "next/server";
import { fetchFollowingSafe, okPublicUrl, readCapped, UA } from "@/lib/net";
import { isPlaylist, rewritePlaylist } from "@/lib/anime";
import { PROXY_BASE } from "@/lib/sources";

export const dynamic = "force-dynamic";

// HLS relay.
//
// The streaming CDN sends `Access-Control-Allow-Origin: https://play.echovideo.ru`,
// so the browser player cannot fetch the playlist or its segments directly from
// our origin. This route fetches them server-side and, for a playlist, rewrites
// every child URI to point back through this route. The player therefore only
// ever talks to our own origin and CORS never comes into it.
//
// Range requests are forwarded so seeking works, and the byte ceiling still
// applies to a segment that ignores the range.

const MAX_SEGMENT_BYTES = 40 * 1024 * 1024;

function notFound(message: string, status = 502) {
  return new NextResponse(message, { status, headers: { "Access-Control-Allow-Origin": "*" } });
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return notFound("url param required", 400);

  const target = okPublicUrl(raw);
  if (!target) return notFound("invalid url", 400);

  const referer = req.nextUrl.searchParams.get("ref") || "https://play.echovideo.ru/";
  const range = req.headers.get("range");

  try {
    let resp: Response;
    // Forward a Range header so the player can seek without re-downloading the
    // whole segment; the byte ceiling below still caps what we hold in memory.
    const extra = range ? { Range: range } : undefined;
    try {
      resp = await fetchFollowingSafe(target, referer, "*/*", extra);
      if (!resp.ok && resp.status !== 206) throw new Error(`HTTP ${resp.status}`);
    } catch {
      // The CORS worker also relays arbitrary bodies; use it as a fallback when
      // the CDN refuses a direct fetch.
      resp = await fetch(`${PROXY_BASE}/?url=${encodeURIComponent(target.href)}`, {
        headers: { "User-Agent": UA, Referer: referer, ...(range ? { Range: range } : {}) },
        cache: "no-store",
      });
    }
    if (!resp.ok && resp.status !== 206) return notFound("upstream fetch failed", resp.status);

    const contentType = resp.headers.get("content-type") || "application/octet-stream";
    const buf = await readCapped(resp, MAX_SEGMENT_BYTES);
    if (!buf) return notFound("stream chunk too large");

    // The CDN labels playlists and segments alike as image/jpeg, so the body is
    // inspected rather than the Content-Type.
    const head = new TextDecoder().decode(buf.slice(0, 4096));
    if (isPlaylist(head, contentType)) {
      const body = rewritePlaylist(new TextDecoder().decode(buf), target.href);
      return new NextResponse(body, {
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const headers: Record<string, string> = {
      "Content-Type": contentType.startsWith("image/") ? "video/mp2t" : contentType,
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
    };
    const contentRange = resp.headers.get("content-range");
    if (contentRange) headers["Content-Range"] = contentRange;
    return new NextResponse(buf, { status: contentRange ? 206 : 200, headers });
  } catch (err) {
    console.error("HLS relay error:", err);
    return notFound("HLS relay failed");
  }
}
