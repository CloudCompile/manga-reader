import { NextRequest, NextResponse } from "next/server";

const CACHE = new Map<string, { data: ChapterListData; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000;

interface ChapterItem {
  num: number;
  url: string;
  title: string;
}

interface ChapterListData {
  mangaName: string;
  chapters: ChapterItem[];
}

// Extract the series slug from a chapter URL
function extractSeriesSlug(url: string): string {
  const m = url.match(/manga\/(.+?)-chapter-\d+/i);
  return m ? m[1] : "";
}

// Build the /manga/ listing page URL
function getSeriesListingUrl(seriesSlug: string): string {
  return `https://www.mangafragrant.com/manga/`;
}

// Fetch the manga listing page and extract all chapter links for this series
async function fetchChapterList(chapterUrl: string): Promise<ChapterListData> {
  const seriesSlug = extractSeriesSlug(chapterUrl);
  if (!seriesSlug) throw new Error("Could not extract series slug from URL");

  const cacheKey = `chapters:${seriesSlug}`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  // Fetch the /manga/ listing page
  const listingUrl = getSeriesListingUrl(seriesSlug);
  const resp = await fetch(listingUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      Referer: "https://www.mangafragrant.com/",
    },
    next: { revalidate: 0 },
  });

  if (!resp.ok) throw new Error(`Failed to fetch listing page: ${resp.status}`);
  const html = await resp.text();

  // Extract all chapter links that match this series
  const chapterMap = new Map<number, ChapterItem>();
  const escaped = seriesSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linkRe = new RegExp(`<a[^>]+href=["']https://www\\.mangafragrant\\.com/manga/${escaped}-chapter-(\\d+)(?:-\\d+)?/["'][^>]*>([^<]+)`, "gi");
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const num = parseInt(m[1]);
    const title = m[2].trim();
    if (!chapterMap.has(num)) {
      chapterMap.set(num, { num, url: `https://www.mangafragrant.com/manga/${seriesSlug}-chapter-${num}/`, title });
    }
  }

  // Also extract manga name from the page
  const titleMatch = /<title>([^<]+)<\/title>/i.exec(html);
  const mangaName = (titleMatch?.[1] || "Unknown Manga").replace(/\s*-\s*Manga\s*Online.*$/i, "").trim();

  // Sort chapters descending (newest first)
  const chapters = Array.from(chapterMap.values()).sort((a, b) => b.num - a.num);

  const data: ChapterListData = { mangaName, chapters };
  CACHE.set(cacheKey, { data, ts: Date.now() });
  return data;
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") return NextResponse.json({ error: "URL is required" }, { status: 400 });

    const data = await fetchChapterList(url);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Chapter list error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to fetch chapters" }, { status: 500 });
  }
}
