import { NextRequest, NextResponse } from "next/server";
import { listTitles } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
    const titles = await listTitles();
    const filtered = q ? titles.filter((t) => t.title.toLowerCase().includes(q)) : titles;
    return NextResponse.json(filtered);
  } catch (err) {
    console.error("Title list error:", err);
    const message = err instanceof Error ? err.message : "Failed to list titles";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
