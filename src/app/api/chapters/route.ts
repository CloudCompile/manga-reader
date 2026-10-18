import { NextRequest, NextResponse } from "next/server";
import { fetchChapterList, isSupported } from "@/lib/sources";
import { withRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Fetching a chapter list hits the source and, for volume grouping, MangaDex.
async function handler(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }
    if (!isSupported(url)) {
      return NextResponse.json({ error: "This site is not supported yet." }, { status: 400 });
    }

    const data = await fetchChapterList(url);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Chapter list error:", err);
    const message = err instanceof Error ? err.message : "Failed to fetch chapters";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 60);
