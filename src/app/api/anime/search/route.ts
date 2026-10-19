import { NextRequest, NextResponse } from "next/server";
import { searchAnime } from "@/lib/anime";
import { withRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Title search against the anime API. A blank query is refused: the upstream
// treats it as "newest additions", which is a recency feed rather than a search
// and would look like a bug in the picker.
async function handler(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ error: "q param required" }, { status: 400 });

  try {
    const results = await searchAnime(q);
    return NextResponse.json({ query: q, results });
  } catch (err) {
    console.error("Anime search error:", err);
    return NextResponse.json({ error: "Anime search failed" }, { status: 502 });
  }
}

export const GET = withRateLimit(handler, 30);
