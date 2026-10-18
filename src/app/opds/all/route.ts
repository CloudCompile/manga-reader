import { NextRequest, NextResponse } from "next/server";
import { acquisitionFeed, OPDS_CONTENT_TYPE } from "@/lib/opds";
import { listTitlesWithHealth } from "@/lib/sources";
import { withRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

// The full-catalogue acquisition feed, paged the same way /api/titles pages it.
async function handler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const source = params.get("source") || "all";

  const { titles: all } = await listTitlesWithHealth();
  const filtered = source === "all" ? all : all.filter((t) => t.sourceId === source);

  const page = filtered.slice(offset, offset + PAGE_SIZE);
  const hasMore = offset + page.length < filtered.length;
  const suffix = source !== "all" ? `&source=${source}` : "";

  const xml = acquisitionFeed({
    id: "urn:manga-reader:opds:all",
    title: "Manga Reader — All titles",
    selfHref: `/opds/all?offset=${offset}${suffix}`,
    allHref: "/opds/all",
    searchHref: "/opds/search",
    nextHref: hasMore ? `/opds/all?offset=${offset + PAGE_SIZE}${suffix}` : undefined,
    prevHref: offset > 0 ? `/opds/all?offset=${Math.max(0, offset - PAGE_SIZE)}${suffix}` : undefined,
    entries: page,
  });
  return new NextResponse(xml, { headers: { "Content-Type": OPDS_CONTENT_TYPE } });
}

export const GET = withRateLimit(handler, 60);
