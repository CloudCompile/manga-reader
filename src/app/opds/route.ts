import { NextResponse } from "next/server";
import { navigationFeed } from "@/lib/opds";

export const dynamic = "force-dynamic";

// OPDS root. An external reader points at /opds and gets the navigation feed,
// from which it can reach the shelf, the full catalogue and search.
export async function GET() {
  const xml = navigationFeed({
    title: "Manga Reader",
    selfHref: "/opds",
    nav: [
      { title: "Shelf", href: "/opds/shelf", content: "Hand-picked titles" },
      { title: "All titles", href: "/opds/all", content: "The full catalogue" },
      { title: "Search", href: "/opds/search", content: "Search the catalogue" },
    ],
  });
  return new NextResponse(xml, {
    headers: { "Content-Type": "application/atom+xml;profile=opds-catalog;kind=navigation" },
  });
}
