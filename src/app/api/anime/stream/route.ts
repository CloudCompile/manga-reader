import { NextRequest, NextResponse } from "next/server";
import { animeStream } from "@/lib/anime";
import { withRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Resolves an episode to something playable. The API returns either an HLS
// playlist URL (preferred: we relay it, so the player stays on our origin) or
// an iframe embed (used only when no playlist is offered).
//
// The playlist URL is returned as-is; the client sends it to /api/anime/hls.
async function handler(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  const server = (req.nextUrl.searchParams.get("server") || "").trim() || undefined;
  if (!id) return NextResponse.json({ error: "id param required" }, { status: 400 });

  try {
    const stream = await animeStream(id, server);
    if (!stream || (!stream.url && !stream.servers.length)) {
      return NextResponse.json({ error: "No stream available for this episode" }, { status: 404 });
    }
    return NextResponse.json(stream);
  } catch (err) {
    console.error("Anime stream error:", err);
    return NextResponse.json({ error: "Stream lookup failed" }, { status: 502 });
  }
}

export const GET = withRateLimit(handler, 60);
