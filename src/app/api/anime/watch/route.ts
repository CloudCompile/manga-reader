import { NextRequest, NextResponse } from "next/server";
import { animeEpisodes, animeInfo, findAnimeMatch, searchAnime } from "@/lib/anime";
import { withRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// "Watch the anime" for a manga the reader already has open.
//
// The reader knows the manga by its scraped title and sometimes an alias list,
// so this resolves that title to an anime (see findAnimeMatch), then returns the
// anime's metadata and episode list in one round trip. Pass `?id=` to skip the
// matching and go straight to a specific anime, which is what the picker uses
// when the reader chooses a different entry from the results.
async function handler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const explicitId = (params.get("id") || "").trim();
  const title = (params.get("title") || "").trim();
  const aliases = (params.get("aliases") || "")
    .split("|")
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 5);

  try {
    let id = explicitId;
    let matchScore: number | undefined;
    let alternatives: Awaited<ReturnType<typeof searchAnime>> = [];

    if (!id) {
      if (!title) return NextResponse.json({ error: "title or id param required" }, { status: 400 });
      const match = await findAnimeMatch(title, aliases);
      if (!match) {
        // No confident match. Return the raw search hits so the picker can offer
        // the closest entries rather than a dead end.
        alternatives = await searchAnime(title);
        return NextResponse.json({ matched: false, title, alternatives });
      }
      id = match.anime.id;
      matchScore = match.score;
    }

    const [info, episodes] = await Promise.all([animeInfo(id), animeEpisodes(id)]);
    if (!info) return NextResponse.json({ error: "Anime not found" }, { status: 404 });

    return NextResponse.json({ matched: true, score: matchScore, anime: info, episodes });
  } catch (err) {
    console.error("Anime watch error:", err);
    return NextResponse.json({ error: "Anime lookup failed" }, { status: 502 });
  }
}

export const GET = withRateLimit(handler, 30);
