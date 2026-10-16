import { NextRequest, NextResponse } from "next/server";
import { searchAll } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
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
