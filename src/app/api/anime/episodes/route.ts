import { NextRequest, NextResponse } from "next/server";
import { animeEpisodes } from "@/lib/anime";
import { withRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Episode list for one anime, sorted ascending. Each episode id already carries
// the "?ep=" suffix the stream endpoint expects, so the UI passes it straight
// back rather than rebuilding it.
async function handler(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "id param required" }, { status: 400 });

  try {
    const episodes = await animeEpisodes(id);
    return NextResponse.json({ id, episodes });
  } catch (err) {
    console.error("Anime episodes error:", err);
    return NextResponse.json({ error: "Episode list failed" }, { status: 502 });
  }
}

export const GET = withRateLimit(handler, 60);
