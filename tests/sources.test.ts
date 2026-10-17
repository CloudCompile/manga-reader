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
}
