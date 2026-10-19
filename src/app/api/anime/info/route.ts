import { NextRequest, NextResponse } from "next/server";
import { animeInfo } from "@/lib/anime";
import { withRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Full metadata for one anime, by the id returned from a search.
async function handler(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "id param required" }, { status: 400 });

  try {
    const info = await animeInfo(id);
    if (!info) return NextResponse.json({ error: "Anime not found" }, { status: 404 });
    return NextResponse.json(info);
  } catch (err) {
    console.error("Anime info error:", err);
    return NextResponse.json({ error: "Anime lookup failed" }, { status: 502 });
  }
}

export const GET = withRateLimit(handler, 60);
