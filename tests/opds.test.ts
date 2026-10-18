// OPDS feeds are consumed by external readers, so malformed XML or an
// unescaped title silently breaks them. These check the real builders.
import { acquisitionFeed, navigationFeed } from "../src/lib/opds.ts";
import { assert, suite, test } from "./harness.ts";
import type { TitleItem } from "../src/lib/sources.ts";

const TITLES: TitleItem[] = [
  {
    title: 'Komi & "Friends" <special>',
    url: "https://example.com/manga/komi-chapter-1/",
    sourceId: "komic",
    sourceName: "Komi Can't Communicate",
    latestChapter: "Ch 300",
    totalChapters: 300,
    thumbnail: "https://example.com/cover.jpg?a=1&b=2",
  },
];

export async function run(): Promise<void> {
  suite("opds");

  await test("acquisition feed escapes XML in every field", () => {
    const xml = acquisitionFeed({
      id: "urn:test",
      title: "Test & Feed",
      selfHref: "/opds/all",
      entries: TITLES,
    });
    assert(xml.startsWith("<?xml"), "should be an XML document");
    assert(xml.includes("<title>Test &amp; Feed</title>"), "the feed title should be escaped");
    assert(xml.includes("Komi &amp; &quot;Friends&quot; &lt;special&gt;"), "the entry title should be escaped");
    // A raw ampersand or angle bracket would make the document invalid.
    assert(!/&(?!(amp|lt|gt|quot|apos);)/.test(xml), "no unescaped ampersands should remain");
    assert(xml.includes('rel="http://opds-spec.org/acquisition/open-access"'), "an acquisition link is required");
    assert(xml.includes("cover.jpg?a=1&amp;b=2"), "the thumbnail URL should be escaped");
  });

  await test("paging links are emitted only when there is a page to reach", () => {
    const withNext = acquisitionFeed({
      id: "urn:test",
      title: "T",
      selfHref: "/opds/all?offset=0",
      nextHref: "/opds/all?offset=100",
      entries: TITLES,
    });
    assert(withNext.includes('rel="next"'), "a next link should be present");
    const without = acquisitionFeed({ id: "urn:test", title: "T", selfHref: "/opds/all", entries: [] });
    assert(!without.includes('rel="next"'), "no next link when there is no further page");
    assert(!without.includes('rel="previous"'), "no previous link on the first page");
  });

  await test("navigation feed links each section as a subsection", () => {
    const xml = navigationFeed({
      title: "Manga Reader",
      selfHref: "/opds",
      nav: [{ title: "All titles", href: "/opds/all", content: "Everything" }],
    });
    assert(xml.includes('rel="subsection" href="/opds/all"'), "each nav entry should be a subsection link");
    assert(xml.includes('rel="search"'), "the search relation should be advertised");
    assert(xml.includes("kind=navigation"), "the self link should be a navigation feed");
  });
}
