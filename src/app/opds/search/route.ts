import { NextRequest, NextResponse } from "next/server";
import { acquisitionFeed, OPDS_CONTENT_TYPE } from "@/lib/opds";
import { listTitlesWithHealth, type TitleItem } from "@/lib/sources";
import { withRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// OPDS search endpoint. An OPDS client either substitutes {searchTerms} into the
// template or appends ?q=; both are handled here. Matching is the same as the
// titles API (display title or alias).
async function handler(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
  const { titles: all } = await listTitlesWithHealth();

  let matches: TitleItem[] = all;
  if (q) {
    matches = all.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.aliases || []).some((a) => a.toLowerCase().includes(q))
    );
  }

  const xml = acquisitionFeed({
    id: `urn:manga-reader:opds:search:${encodeURIComponent(q)}`,
    title: q ? `Manga Reader — Search “${q}”` : "Manga Reader — Search",
    selfHref: `/opds/search?q=${encodeURIComponent(q)}`,
    allHref: "/opds/all",
    searchHref: "/opds/search",
    entries: matches.slice(0, 200),
  });
  return new NextResponse(xml, { headers: { "Content-Type": OPDS_CONTENT_TYPE } });
}

export const GET = withRateLimit(handler, 30);
