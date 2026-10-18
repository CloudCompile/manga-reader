// OPDS 1.2 feeds, so external readers (Panels, Librera, KOReader, …) can browse
// and open this catalogue instead of only the bundled web reader.
//
// The feed is generated from the same TitleItem list the app uses, so it stays
// in step with the sources. Acquisition entries point at the chapter URL the
// reader itself opens; the consuming app is responsible for parsing the page,
// which is the same contract the "paste a chapter URL" flow uses.

import type { TitleItem } from "./sources";

const UPDATED = () => new Date().toISOString();

function xmlEscape(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function entryId(t: TitleItem): string {
  return `urn:manga-reader:${t.sourceId}:${encodeURIComponent(t.url)}`;
}

// A single acquisition entry. OPDS 1.2 uses Atom with the acquisition link
// relation; the mime type is a generic web page because the target is a
// scraper-facing chapter URL rather than a downloadable file.
function entryXml(t: TitleItem): string {
  const thumb = t.thumbnail
    ? `\n    <link rel="http://opds-spec.org/image/thumbnail" type="image/jpeg" href="${xmlEscape(t.thumbnail)}"/>`
    : "";
  return `  <entry>
    <title>${xmlEscape(t.title)}</title>
    <id>${xmlEscape(entryId(t))}</id>
    <updated>${UPDATED()}</updated>
    <author><name>${xmlEscape(t.sourceName)}</name></author>
    <content type="text">${xmlEscape(
      `${t.sourceName}${t.latestChapter ? ` · ${t.latestChapter}` : ""}${
        t.totalChapters ? ` · ${t.totalChapters} chapters` : ""
      }`
    )}</content>
    <link rel="http://opds-spec.org/acquisition/open-access" type="text/html" href="${xmlEscape(t.url)}"/>${thumb}
  </entry>`;
}

export interface OpdsFeedOptions {
  id: string;
  title: string;
  selfHref: string;
  // Where the reader should look for the whole catalogue / search.
  allHref?: string;
  searchHref?: string;
  nextHref?: string;
  prevHref?: string;
  entries: TitleItem[];
}

// An acquisition feed listing titles.
export function acquisitionFeed(opts: OpdsFeedOptions): string {
  const links = [
    `<link rel="self" href="${xmlEscape(opts.selfHref)}" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>`,
    `<link rel="start" href="/opds" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>`,
  ];
  if (opts.allHref) links.push(`<link rel="http://opds-spec.org/first" href="${xmlEscape(opts.allHref)}" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>`);
  if (opts.nextHref) links.push(`<link rel="next" href="${xmlEscape(opts.nextHref)}" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>`);
  if (opts.prevHref) links.push(`<link rel="previous" href="${xmlEscape(opts.prevHref)}" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>`);
  if (opts.searchHref)
    links.push(
      `<link rel="search" href="${xmlEscape(opts.searchHref)}" type="application/atom+xml"/>`
    );

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <title>${xmlEscape(opts.title)}</title>
  <id>${xmlEscape(opts.id)}</id>
  <updated>${UPDATED()}</updated>
${links.map((l) => `  ${l}`).join("\n")}
${opts.entries.map(entryXml).join("\n")}
</feed>`;
}

export interface OpdsNavEntry {
  title: string;
  href: string;
  content: string;
}

// The root navigation feed: the entry point an OPDS client loads first.
export function navigationFeed(opts: {
  title: string;
  selfHref: string;
  nav: OpdsNavEntry[];
}): string {
  const entries = opts.nav
    .map(
      (n) => `  <entry>
    <title>${xmlEscape(n.title)}</title>
    <id>urn:manga-reader:nav:${xmlEscape(n.href)}</id>
    <updated>${UPDATED()}</updated>
    <content type="text">${xmlEscape(n.content)}</content>
    <link rel="subsection" href="${xmlEscape(n.href)}" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  </entry>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <title>${xmlEscape(opts.title)}</title>
  <id>urn:manga-reader:opds</id>
  <updated>${UPDATED()}</updated>
  <link rel="self" href="${xmlEscape(opts.selfHref)}" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <link rel="start" href="/opds" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <link rel="search" href="/opds/search" type="application/atom+xml"/>
${entries}
</feed>`;
}

export const OPDS_CONTENT_TYPE = "application/atom+xml;profile=opds-catalog;kind=acquisition";
