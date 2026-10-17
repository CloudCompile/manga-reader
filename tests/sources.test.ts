// Source parsers run against real captured pages. When a site changes its
// markup these fail, which is the point: that is how MangaFragrant started
// serving a different series without anyone noticing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, assertEqual, suite, test } from "./harness.ts";
import { getSource, SOURCES } from "../src/lib/sources.ts";

const FIXTURES = join(process.cwd(), "tests", "fixtures");
const read = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const FFB_191 = "https://thefragrantflowerbloomswithdignity.com/the-fragrant-flower-blooms-with-dignity-manga-chapter-191/";
const MF_182 = "https://www.mangafragrant.com/manga/the-fragrant-flower-blooms-with-dignity-chapter-182/";
const MF_190 = "https://www.mangafragrant.com/manga/the-fragrant-flower-blooms-with-dignity-chapter-190/";

export async function run(): Promise<void> {
  suite("sources");

  await test("every source has a unique id and at least one host pattern", () => {
    const ids = new Set<string>();
    for (const s of SOURCES) {
      assert(!ids.has(s.id), `duplicate source id: ${s.id}`);
      ids.add(s.id);
      assert(s.hosts.length > 0, `${s.id} has no host patterns`);
      assert(!!(s.fetchChapter || s.parseChapter), `${s.id} cannot fetch a chapter`);
    }
  });

  await test("ffb parses every page image and the neighbouring chapters", () => {
    const source = getSource(FFB_191);
    assert(source, "ffb source should match its own URL");
    assertEqual(source!.id, "ffb", "wrong source matched");
    const parsed = source!.parseChapter!(read("ffb-chapter-191.html"), FFB_191);
    assertEqual(parsed.images.length, 22, "expected 22 page images");
    // The logo and avatar are on the same host, so they must be filtered out.
    assert(
      parsed.images.every((u) => u.includes("/uploads/manga/the-fragrant-flower-blooms-with-dignity-manga/")),
      "only chapter page images should be kept"
    );
    assert(parsed.images[0].endsWith("/chapter-191/1.png"), `first page should be 1.png, got ${parsed.images[0]}`);
    assert(parsed.images[21].endsWith("/chapter-191/22.png"), `last page should be 22.png, got ${parsed.images[21]}`);
    assertEqual(parsed.chapterNum, "191", "chapter number should come from the URL");
    assertEqual(parsed.mangaName, "The Fragrant Flower Blooms with Dignity", "series name should be clean");
    assert(!!parsed.prevUrl && parsed.prevUrl.includes("chapter-190"), `prev should be 190, got ${parsed.prevUrl}`);
    assert(!!parsed.nextUrl && parsed.nextUrl.includes("chapter-192"), `next should be 192, got ${parsed.nextUrl}`);
  });

  await test("mangafragrant parses its last correct chapter", () => {
    const source = getSource(MF_182);
    assert(source, "mangafragrant source should match its own URL");
    assertEqual(source!.id, "mangafragrant", "wrong source matched");
    const parsed = source!.parseChapter!(read("mangafragrant-chapter-182.html"), MF_182);
    assertEqual(parsed.images.length, 22, "expected 22 page images");
    assertEqual(parsed.chapterNum, "182", "chapter number should come from the URL");
  });

  await test("mangafragrant refuses the wrong-series chapter", () => {
    // From #183 the site points at its "return of" upload folder, a different
    // series. Showing that would be worse than an error.
    const source = getSource(MF_190)!;
    let message = "";
    try {
      source.parseChapter!(read("mangafragrant-chapter-190.html"), MF_190);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    assert(message.includes("wrong series"), `expected a wrong-series refusal, got: ${message || "(no error)"}`);
  });

  await test("mangafragrant caps the listing at its last correct chapter", () => {
    const source = getSource(MF_182)!;
    const items = source.parseList!(read("mangafragrant-chapter-182.html"), MF_182);
    assert(items.every((c) => c.num <= 182), "no chapter above 182 should survive the cap");
  });

  // The single-series hosts below each get one captured chapter page, so a
  // change to their markup or image host fails here instead of reaching a
  // reader. The counts are the real page counts at capture time.
  await test("komic parses its page images and neighbours", () => {
    const url = "https://komicantcommunicatechapters.website/manga/komi-cant-communicate-chapter-300/";
    const source = getSource(url);
    assert(source, "komic source should match its own URL");
    assertEqual(source!.id, "komic", "wrong source matched");
    const parsed = source!.parseChapter!(read("komi-chapter-300.html"), url);
    assertEqual(parsed.images.length, 19, "expected 19 page images");
    assert(parsed.images.every((u) => u.includes("tsukiread.com/")), "only tsukiread page images should be kept");
    assert(parsed.images[0].includes("/PBJE5UYaUBINl9sMGBsUX0sPNPCRDQ"), `unexpected first page: ${parsed.images[0]}`);
    assertEqual(parsed.chapterNum, "300", "chapter number should come from the URL");
    assert(!!parsed.prevUrl && parsed.prevUrl.includes("chapter-299"), `prev should be 299, got ${parsed.prevUrl}`);
    assert(!!parsed.nextUrl && parsed.nextUrl.includes("chapter-301"), `next should be 301, got ${parsed.nextUrl}`);
  });

  await test("bluebox parses its page images and full listing", () => {
    const url = "https://blue-box-manga.online/comic/blue-box-chapter-250/";
    const source = getSource(url);
    assertEqual(source!.id, "bluebox", "wrong source matched");
    const parsed = source!.parseChapter!(read("bluebox-chapter-250.html"), url);
    assertEqual(parsed.images.length, 23, "expected 23 page images");
    assert(parsed.images.every((u) => u.includes("laiond.com/")), "only laiond page images should be kept");
    assertEqual(parsed.chapterNum, "250", "chapter number should come from the URL");
    assertEqual(parsed.mangaName, "Blue Box", "series name should be clean");
    // The listing comes from a <select> on the same page, not just anchors.
    const items = source!.parseList!(read("bluebox-chapter-250.html"), url);
    assert(items.length > 200, `expected the full chapter list, got ${items.length}`);
    assert(items.some((c) => c.num === 250), "the newest chapter should be listed");
  });

  await test("dandadana parses its page images and previous chapter", () => {
    const url = "https://dandadana.com/manga/dandadan-chapter-248/";
    const source = getSource(url);
    assertEqual(source!.id, "dandadana", "wrong source matched");
    const parsed = source!.parseChapter!(read("dandadana-chapter-248.html"), url);
    assertEqual(parsed.images.length, 23, "expected 23 page images");
    assert(parsed.images.every((u) => u.includes("pic.readkakegurui.com/")), "only the reader CDN should be kept");
    assert(parsed.images[0].endsWith("/chapter-248/1.webp"), `first page should be 1.webp, got ${parsed.images[0]}`);
    assert(parsed.images[22].endsWith("/chapter-248/23.webp"), `last page should be 23.webp, got ${parsed.images[22]}`);
    assert(!!parsed.prevUrl && parsed.prevUrl.includes("chapter-247"), `prev should be 247, got ${parsed.prevUrl}`);
  });

  await test("oshino parses its blogger page images", () => {
    const url = "https://readoshino.com/manga/oshi-no-ko-chapter-166/";
    const source = getSource(url);
    assertEqual(source!.id, "oshino", "wrong source matched");
    const parsed = source!.parseChapter!(read("oshino-chapter-166.html"), url);
    assertEqual(parsed.images.length, 25, "expected 25 page images");
    assert(
      parsed.images.every((u) => u.includes("blogger.googleusercontent.com/")),
      "only blogger-hosted page images should be kept"
    );
    assert(parsed.images[0].endsWith("/001.jpg"), `first page should be 001.jpg, got ${parsed.images[0]}`);
    assert(parsed.images[24].endsWith("/025.jpg"), `last page should be 025.jpg, got ${parsed.images[24]}`);
    // On this theme rel=next points at the lower chapter, so prev is the higher
    // one. Getting this backwards would send the reader the wrong way.
    assert(!!parsed.prevUrl && parsed.prevUrl.includes("chapter-165"), `prev should be 165, got ${parsed.prevUrl}`);
  });

  await test("chainsawman parses its page images and both neighbours", () => {
    const url = "https://onlinechainsawmanmanga.us/chainsaw-man-chapter-2/";
    const source = getSource(url);
    assertEqual(source!.id, "chainsawman", "wrong source matched");
    const parsed = source!.parseChapter!(read("chainsawman-chapter-2.html"), url);
    assertEqual(parsed.images.length, 26, "expected 26 page images");
    assert(
      parsed.images.every((u) => u.startsWith("https://onlinechainsawmanmanga.us/wp-content/")),
      "only the site's own uploads should be kept"
    );
    assert(!!parsed.prevUrl && parsed.prevUrl.includes("chapter-1"), `prev should be 1, got ${parsed.prevUrl}`);
    assert(!!parsed.nextUrl && parsed.nextUrl.includes("chapter-3"), `next should be 3, got ${parsed.nextUrl}`);
  });

  await test("specterscans reads the RSC payload for pages and chapters", () => {
    const chapterUrl = "https://specterscans.com/series/boku-no-kokoro-no-yabai-yatsu/chapter/199";
    const source = getSource(chapterUrl);
    assertEqual(source!.id, "specterscans", "wrong source matched");
    const parsed = source!.parseChapter!(read("spectre-chapter-199.html"), chapterUrl);
    assertEqual(parsed.images.length, 19, "expected 19 page images");
    assert(parsed.images[0].includes("/ch-000199/001.png"), `first page should be 001.png, got ${parsed.images[0]}`);
    assertEqual(parsed.chapterNum, "199", "chapter number should come from the payload");
    assertEqual(parsed.mangaName, "The Dangers in My Heart", "series name should come from the payload");
    assert(!!parsed.prevUrl && parsed.prevUrl.endsWith("/chapter/198"), `prev should be 198, got ${parsed.prevUrl}`);

    // The series page carries the whole chapter list.
    const seriesUrl = "https://specterscans.com/series/boku-no-kokoro-no-yabai-yatsu";
    const items = source!.parseList!(read("spectre-series.html"), seriesUrl);
    assert(items.length > 190, `expected the full chapter list, got ${items.length}`);
    const nums = items.map((c) => c.num);
    assert(Math.max(...nums) === 199, `newest chapter should be 199, got ${Math.max(...nums)}`);
    assert(Math.min(...nums) === 1, `oldest chapter should be 1, got ${Math.min(...nums)}`);
  });
}
