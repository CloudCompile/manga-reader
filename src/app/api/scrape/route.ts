import { NextRequest, NextResponse } from "next/server";
import { scrapeChapter, isSupported } from "@/lib/sources";
import { withRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Scraping fans out to a third-party site, so it is the most expensive route
// and the one most worth throttling (30 requests/minute per client).
async function handler(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
    }
    if (!isSupported(url)) {
      return NextResponse.json({ error: "This site is not supported yet." }, { status: 400 });
    }

    const data = await scrapeChapter(url);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Scrape error:", err);
    const message = err instanceof Error ? err.message : "Failed to scrape chapter";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 30);
