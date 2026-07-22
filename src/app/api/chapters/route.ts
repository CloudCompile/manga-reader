import { NextRequest, NextResponse } from "next/server";

interface ChapterInfo {
  num: string;
  label: string;
  url: string;
}

const CACHE = { data: null as { chapters: ChapterInfo[]; baseTitle: string } | null, ts: 0 };
const CACHE_TTL = 30 * 60 * 1000;

function parseChapters(html: string, baseUrl: string): { chapters: ChapterInfo[]; baseTitle: string } {
  // Extract manga title from <title>
  const titleMatch = /<title>([^<]+)<\/title>/i.exec(html);
  const rawTitle = titleMatch?.[1] || "Manga";
  const baseTitle = rawTitle
    .replace(/,\s*Chapter\s*\d+.*$/i, "")
    .replace(/\s*-\s*Manga\s*Online.*$/i, "")
    .replace(/\s*Manga\s*Online.*$/i, "")
    .trim();

  // Extract all chapter links from the page
  const linkRe = /href=["']([^"']*\/manga\/[^"']*chapter[^"']*)["']/gi;
  const seen = new Map<string, ChapterInfo>();
  let m: RegExpExecArray | null;

  while ((m = linkRe.exec(html)) !== null) {
    let url = m[1].replace(/&amp;/g, "&");
    // Normalize to full URL
    if (url.startsWith("/")) {
      const base = new URL(baseUrl).origin;
      url = base + url;
    }
    // Skip feed/tag links
    if (/\/feed\/?$|\/tag\//i.test(url)) continue;

    // Extract chapter number
    const numMatch = url.match(/chapter-?(\d+(?:-\d+)?)/i);
    const num = numMatch ? numMatch[1] : "?";
    const label = `Chapter ${num}`;

    if (!seen.has(url)) {
      seen.set(url, { num, label, url });
    }
  }

  // Sort: parse numeric part, higher first (newest first)
  const chapters = Array.from(seen.values()).sort((a, b) => {
    const an = parseInt(a.num.split("-")[0]) || 0;
    const bn = parseInt(b.num.split("-")[0]) || 0;
    if (bn !== an) return bn - an;
    const as = parseInt(a.num.split("-")[1] || "0");
    const bs = parseInt(b.num.split("-")[1] || "0");
    return bs - as;
  });

  return { chapters, baseTitle };
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    // Default: scrape mangafragrant.com homepage
    if (CACHE.data && Date.now() - CACHE.ts < CACHE_TTL) {
      return NextResponse.json(CACHE.data);
    }
    try {
      const resp = await fetch("https://www.mangafragrant.com/", {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          Accept: "text/html",
        },
        next: { revalidate: 0 },
      });
      if (!resp.ok) throw new Error(`Failed: ${resp.status}`);
      const html = await resp.text();
      const result = parseChapters(html, "https://www.mangafragrant.com/");
      CACHE.data = result;
      CACHE.ts = Date.now();
      return NextResponse.json(result);
    } catch (err) {
      console.error("Chapter list error:", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch chapters" },
        { status: 500 }
      );
    }
  }

  // Custom URL: derive base URL from chapter URL
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  try {
    // Derive the base URL (homepage) from the chapter URL
    const parsed = new URL(url);
    const baseUrl = `${parsed.protocol}//${parsed.host}/`;

    const resp = await fetch(baseUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html",
      },
      next: { revalidate: 0 },
    });
    if (!resp.ok) throw new Error(`Failed: ${resp.status}`);
    const html = await resp.text();
    const result = parseChapters(html, baseUrl);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Chapter list error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch chapters" },
      { status: 500 }
    );
  }
}
