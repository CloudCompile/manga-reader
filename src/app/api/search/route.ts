import { NextRequest, NextResponse } from "next/server";
import { searchAll } from "@/lib/sources";
import { withRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Search fans out to every source at once, so it is throttled like the scrape
// route (30 requests/minute per client).
async function handler(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get("q") || "";
    const results = await searchAll(query);
    return NextResponse.json(results);
  } catch (err) {
    console.error("Search error:", err);
    const message = err instanceof Error ? err.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withRateLimit(handler, 30);
