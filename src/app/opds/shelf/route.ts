import { NextRequest, NextResponse } from "next/server";
import { acquisitionFeed, OPDS_CONTENT_TYPE } from "@/lib/opds";
import { listCuratedTitlesWithHealth } from "@/lib/sources";
import { withRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// The curated shelf as a single acquisition feed.
async function handler(_req: NextRequest) {
  const { titles } = await listCuratedTitlesWithHealth();
  const xml = acquisitionFeed({
    id: "urn:manga-reader:opds:shelf",
    title: "Manga Reader — Shelf",
    selfHref: "/opds/shelf",
    allHref: "/opds/all",
    searchHref: "/opds/search",
    entries: titles,
  });
  return new NextResponse(xml, { headers: { "Content-Type": OPDS_CONTENT_TYPE } });
}

export const GET = withRateLimit(handler, 60);
