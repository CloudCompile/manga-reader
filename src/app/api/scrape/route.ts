import { NextRequest, NextResponse } from "next/server";
import { scrapeChapter, isSupported } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
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
