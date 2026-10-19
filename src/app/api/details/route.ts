import { NextRequest, NextResponse } from "next/server";
import { mangaDetails } from "@/lib/sources";
import { withRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Series metadata for the details panel. The title comes from whatever the
// reader scraped, so this is a lookup rather than an id-based fetch, and a
// confident match is required — see mangaDetails.
async function handler(req: NextRequest) {
  const title = (req.nextUrl.searchParams.get("title") || "").trim();
  if (!title) return NextResponse.json({ error: "title param required" }, { status: 400 });

  try {
    const details = await mangaDetails(title);
    return NextResponse.json({ title, details });
  } catch (err) {
    console.error("Details error:", err);
    const message = err instanceof Error ? err.message : "Failed to load details";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withRateLimit(handler, 30);
