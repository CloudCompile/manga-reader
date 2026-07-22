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

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const url of imgs) {
    const clean = url.trim();
    if (!clean || seen.has(clean)) continue;
    if (!/\.(jpe?g|png|webp|gif|avif)/i.test(clean)) continue;
    if (/(?:icon|logo|emoji|avatar|button|banner|ads?|popup|1x1|tracking|pixel|w\.org|gravatar|pinterest)/i.test(clean)) continue;
    // Must be a manga image — large, hosted on CDN, contains "chapter" or numeric path pattern
    // Filter: keep images that look like manga pages (hosted on storage/CDN, not tiny UI elements)
    seen.add(clean);
    unique.push(clean);
  }
  return unique;
}

function extractNavLinks(html: string): { prev: string | null; next: string | null } {
  let prev: string | null = null;
  let next: string | null = null;

  const prevMatch = /<a[^>]+href=["']([^"']+)["'][^>]*rel=["']prev["']/i.exec(html)
    || /<a[^>]+rel=["']prev["'][^>]+href=["']([^"']+)["']/i.exec(html);
  if (prevMatch) prev = prevMatch[1].replace(/&amp;/g, "&");

  const nextMatch = /<a[^>]+href=["']([^"']+)["'][^>]*rel=["']next["']/i.exec(html)
    || /<a[^>]+rel=["']next["'][^>]+href=["']([^"']+)["']/i.exec(html);
  if (nextMatch) next = nextMatch[1].replace(/&amp;/g, "&");

  return { prev, next };
}

function extractTitle(html: string): { mangaName: string; chapterNum: string; fullTitle: string } {
  const titleMatch = /<title>([^<]+)<\/title>/i.exec(html);
  const raw = titleMatch?.[1] || "Unknown Manga";

  const chapMatch = /chapter\s*(\d+)/i.exec(raw);
  const chapterNum = chapMatch ? chapMatch[1] : "";
  const mangaName = raw.replace(/,\s*Chapter\s*\d+.*$/i, "").replace(/\s*-\s*Manga\s*Online.*$/i, "").trim();

  return { mangaName, chapterNum, fullTitle: raw };
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

  // Extract images from the full HTML — mangafragrant uses plain <img src> inside <p> tags
  // within .entry-content, but the regex-safe approach is to scan everything and filter
  const allImages = extractImages(html);

  // Filter to only keep actual manga page images (from contabostorage or similar CDN,
  // with chapter-based paths and sequential numbering)
  const mangaImages = allImages.filter((u) => {
    // Keep CDN-hosted images that look like manga pages
    if (/contabostorage\.com/i.test(u)) return true;
    // Keep images with /Chapter N/ or /chapter-n/ in path
    if (/chapter\s*\d+/i.test(u)) return true;
    // Keep large images from any CDN (not tiny UI assets)
    // For mangafragrant specifically, all manga images come from contabostorage
    return false;
  });

  const { prev, next } = extractNavLinks(html);
  const { mangaName, chapterNum, fullTitle } = extractTitle(html);

  const data: ChapterData = {
    title: fullTitle,
    images: mangaImages,
    prevUrl: prev,
    nextUrl: next,
    mangaName,
    chapterNum,
  };
  if (mangaImages.length === 0) data.warning = "No images found. This chapter may not be available yet.";

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