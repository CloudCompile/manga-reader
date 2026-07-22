import { NextRequest, NextResponse } from "next/server";

const CACHE = new Map<string, { data: ChapterData; ts: number }>();
const CACHE_TTL = 10 * 60 * 1000;

interface ChapterData {
  title: string;
  images: string[];
  prevUrl: string | null;
  nextUrl: string | null;
  mangaName: string;
  chapterNum: string;
  warning?: string;
}

function extractImages(html: string): string[] {
  const imgs: string[] = [];
  const srcRe = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = srcRe.exec(html)) !== null) imgs.push(m[1]);

  const lazyRe = /data-(?:src|lazy-src|original|image-url)=["']([^"']+)["']/gi;
  while ((m = lazyRe.exec(html)) !== null) imgs.push(m[1]);

  const srcsetRe = /srcset=["']([^"']+)["']/gi;
  while ((m = srcsetRe.exec(html)) !== null) {
    const first = m[1].split(/\s+/)[0].split(",")[0];
    if (first) imgs.push(first);
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const url of imgs) {
    const clean = url.trim();
    if (!clean || seen.has(clean)) continue;
    if (!/\.(jpe?g|png|webp|gif|avif)/i.test(clean)) continue;
    if (/(?:icon|logo|emoji|avatar|button|banner|ads?|popup|1x1|tracking|pixel|w\.org|gravatar)/i.test(clean)) continue;
    seen.add(clean);
    unique.push(clean);
  }
  return unique;
}

function extractNavLinks(html: string): { prev: string | null; next: string | null } {
  let prev: string | null = null;
  let next: string | null = null;

  const patterns: Array<{ re: RegExp; type: "prev" | "next" }> = [
    { re: /<a[^>]+href=["']([^"']*chapter[^"']*)["'][^>]*rel=["']prev["']/i, type: "prev" },
    { re: /<a[^>]+rel=["']prev["'][^>]+href=["']([^"']*chapter[^"']*)["']/i, type: "prev" },
    { re: /<a[^>]+class=["'][^"']*(?:prev|previous)[^"']*["'][^>]+href=["']([^"']*chapter[^"']*)["']/i, type: "prev" },
    { re: /<a[^>]+href=["']([^"']*chapter[^"']*)["'][^>]*class=["'][^"']*(?:prev|previous)[^"']*["']/i, type: "prev" },
    { re: /<a[^>]+href=["']([^"']*chapter[^"']*)["'][^>]*rel=["']next["']/i, type: "next" },
    { re: /<a[^>]+rel=["']next["'][^>]+href=["']([^"']*chapter[^"']*)["']/i, type: "next" },
    { re: /<a[^>]+class=["'][^"']*next-ch?[^"']*["'][^>]+href=["']([^"']*chapter[^"']*)["']/i, type: "next" },
    { re: /<a[^>]+href=["']([^"']*chapter[^"']*)["'][^>]*class=["'][^"']*next-ch?[^"']*["']/i, type: "next" },
  ];

  for (const { re, type } of patterns) {
    const match = re.exec(html);
    if (match) {
      const url = match[1].replace(/&amp;/g, "&");
      if (type === "prev" && !prev) prev = url;
      if (type === "next" && !next) next = url;
    }
  }

  // Broader text-based fallback
  if (!prev) {
    const pm = /<a[^>]+href=["']([^"']*chapter[^"']*)["'][^>]*>\s*<span[^>]*>[\s\S]*?prev[\s\S]*?<\/span>/i.exec(html)
      || /<a[^>]+href=["']([^"']*chapter[^"']*)["'][^>]*>[^<]*prev/i.exec(html);
    if (pm) prev = pm[1].replace(/&amp;/g, "&");
  }
  if (!next) {
    const nm = /<a[^>]+href=["']([^"']*chapter[^"']*)["'][^>]*>\s*<span[^>]*>[\s\S]*?next[\s\S]*?<\/span>/i.exec(html)
      || /<a[^>]+href=["']([^"']*chapter[^"']*)["'][^>]*>[^<]*next/i.exec(html);
    if (nm) next = nm[1].replace(/&amp;/g, "&");
  }

  return { prev, next };
}

function extractTitle(html: string): { mangaName: string; chapterNum: string; fullTitle: string } {
  const ogMatch = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html);
  const titleMatch = /<title>([^<]+)<\/title>/i.exec(html);
  const raw = ogMatch?.[1] || titleMatch?.[1] || "Unknown Manga";

  const chapMatch = /chapter\s*(\d+)/i.exec(raw);
  const chapterNum = chapMatch ? chapMatch[1] : "";
  const mangaName = raw.replace(/,\s*Chapter\s*\d+.*$/i, "").replace(/\s*-\s*Manga\s*Online.*$/i, "").trim();

  return { mangaName, chapterNum, fullTitle: raw };
}

function findReadingArea(html: string): string {
  const patterns = [
    /<div[^>]*(?:class|id)=["'][^"']*(?:reading-content|manga-reading|chapter-content|reader-area|entry-content|post-content|manga-content|read-content|wp-manga-chapter)[^"']*["'][^>]*>([\s\S]*?)(?=<\/div>\s*(?:<\/div>\s*)?(?:<div|<nav|<footer|<section|<!--\s*(?:end|comment|navigation)))/i,
    /<div[^>]*(?:class|id)=["'][^"']*(?:reading-content|manga-reading|chapter-content|reader-area|entry-content|post-content|manga-content|read-content|wp-manga-chapter)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const p of patterns) {
    const m = p.exec(html);
    if (m) return m[1];
  }
  return html;
}

async function scrapeChapter(url: string): Promise<ChapterData> {
  const cached = CACHE.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.mangafragrant.com/",
    },
    next: { revalidate: 0 },
  });

  if (!resp.ok) throw new Error(`Failed to fetch page: ${resp.status}`);
  const html = await resp.text();

  const readingArea = findReadingArea(html);
  const images = extractImages(readingArea);
  const { prev, next } = extractNavLinks(html);
  const { mangaName, chapterNum, fullTitle } = extractTitle(html);

  const data: ChapterData = { title: fullTitle, images, prevUrl: prev, nextUrl: next, mangaName, chapterNum };
  if (images.length === 0) data.warning = "No images found. This chapter may not be available yet or uses a different loading method.";

  CACHE.set(url, { data, ts: Date.now() });
  return data;
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") return NextResponse.json({ error: "URL is required" }, { status: 400 });
    try { new URL(url); } catch { return NextResponse.json({ error: "Invalid URL format" }, { status: 400 }); }

    const data = await scrapeChapter(url);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Scrape error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to scrape chapter" }, { status: 500 });
  }
}