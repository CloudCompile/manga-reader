import { NextRequest, NextResponse } from "next/server";
import {
  listCuratedTitlesWithHealth,
  listTitlesWithHealth,
  sortTitles,
  titleMatches,
  type TitleItem,
  type TitleSort,
} from "@/lib/sources";

export const dynamic = "force-dynamic";

// The full catalogue is ~1200 titles / 330 KB, so `?all=1` pages it server-side
// rather than shipping the lot to the grid. The default response stays the small
// curated shelf, which keeps first paint fast.
const PAGE_SIZE = 60;

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const q = (params.get("q") || "").trim().toLowerCase();
    const source = params.get("source") || "all";
    const offset = Math.max(0, Number(params.get("offset")) || 0);
    const sort = (params.get("sort") || "shelf") as TitleSort;
    // Hide entries whose latest chapter is an empty placeholder ("coming soon").
    const hideEmpty = params.get("hideEmpty") === "1";

    if (params.get("all") !== "1") {
      const { titles, sources } = await listCuratedTitlesWithHealth();
      return NextResponse.json({ titles, sources, total: titles.length, offset: 0, hasMore: false });
    }

    const { titles: all, sources } = await listTitlesWithHealth();
    let filtered: TitleItem[] = all;
    if (source !== "all") filtered = filtered.filter((t) => t.sourceId === source);
    // Matching the display title or any alternate/romanised name the shelf knows.
    if (q) filtered = filtered.filter((t) => titleMatches(t, q));
    if (hideEmpty) filtered = filtered.filter((t) => t.totalChapters > 1);

    filtered = sortTitles(filtered, sort);

    const page = filtered.slice(offset, offset + PAGE_SIZE);
    return NextResponse.json({
      titles: page,
      sources,
      total: filtered.length,
      offset,
      hasMore: offset + page.length < filtered.length,
    });
  } catch (err) {
    console.error("Title list error:", err);
    const message = err instanceof Error ? err.message : "Failed to list titles";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
