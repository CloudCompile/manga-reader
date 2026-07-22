import { NextRequest, NextResponse } from "next/server";

const CACHE = new Map<string, { data: SearchResult[]; ts: number }>();
const CACHE_TTL = 15 * 60 * 1000;

interface SearchResult {
  title: string;
  latestChapter: string;
  url: string;
}

// The /manga/ page lists all available manga
// We scrape it and filter by search query
async function searchManga(query: string): Promise<SearchResult[]> {
  const cacheKey = `search:${query.toLowerCase()}`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  // Always scrape the listing page fresh for unfiltered results, cache per query
  const allCacheKey = "search:__all__";
  let allManga = CACHE.get(allCacheKey)?.data;

  if (!allManga || Date.now() - (CACHE.get(allCacheKey)?.ts || 0) > CACHE_TTL) {
    const resp = await fetch("https://www.mangafragrant.com/manga/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        Referer: "https://www.mangafragrant.com/",
      },
      next: { revalidate: 0 },
    });

    if (!resp.ok) throw new Error(`Failed to fetch manga list: ${resp.status}`);
    const html = await resp.text();

    // Extract unique chapter links, then group by series
    const seriesMap = new Map<string, { title: string; latestNum: number; slug: string }>();
    const linkRe = /<a[^>]+href=["'](https:\/\/www\.mangafragrant\.com\/manga\/([^\/]+)\/)["'][^>]*>([^<]*chapter[^<]*)/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null) {
      const url = m[1].replace(/&amp;/g, "&");
      const rawSlug = m[2];
      const title = m[3].trim();
      const chapNum = parseInt(title.replace(/\D/g, "")) || 0;

      // Normalize slug: strip -chapter-N suffix to get series slug
      const seriesSlug = rawSlug.replace(/-chapter-\d+(?:-\d+)?$/i, "");
      const existing = seriesMap.get(seriesSlug);
      if (!existing || chapNum > existing.latestNum) {
        const cleanName = seriesSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        seriesMap.set(seriesSlug, { title: cleanName, latestNum: chapNum, slug: rawSlug });
      }
    }

    allManga = Array.from(seriesMap.values()).map((s) => ({
      title: s.title,
      latestChapter: s.latestNum > 0 ? `Ch ${s.latestNum}` : "",
      url: `https://www.mangafragrant.com/manga/${s.slug}-chapter-${s.latestNum}/`,
    }));

    CACHE.set(allCacheKey, { data: allManga, ts: Date.now() });
  }

  // Filter by query
  const q = query.toLowerCase();
  const filtered = q
    ? allManga.filter((m) => m.title.toLowerCase().includes(q))
    : allManga;

  CACHE.set(cacheKey, { data: filtered, ts: Date.now() });
  return filtered;
}

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get("q") || "";
    const results = await searchManga(query);
    return NextResponse.json(results);
  } catch (err) {
    console.error("Search error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Search failed" }, { status: 500 });
  }
}