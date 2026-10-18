// Catalogue ordering and alias matching drive the /api/titles route, so they
// live in sources.ts and are tested here against the real implementations.
import { sortTitles, titleMatches } from "../src/lib/sources.ts";
import { assert, assertEqual, suite, test } from "./harness.ts";
import type { TitleItem } from "../src/lib/sources.ts";

function t(title: string, latestChapter: string, totalChapters: number, aliases?: string[]): TitleItem {
  return { title, url: `https://example.com/${title}`, sourceId: "s", sourceName: "S", latestChapter, totalChapters, aliases };
}

const TITLES: TitleItem[] = [
  t("Blue Box", "Ch 99", 99),
  t("Berserk", "Ch 100", 400),
  t("Attack on Titan", "Ch 5", 139, ["Shingeki no Kyojin", "進撃の巨人"]),
];

export async function run(): Promise<void> {
  suite("titles");

  await test("sorts by title, chapter count and latest chapter", () => {
    const byTitle = sortTitles(TITLES, "title").map((x) => x.title);
    assertEqual(byTitle.join(","), "Attack on Titan,Berserk,Blue Box", "title sort should be alphabetical");

    const byChapters = sortTitles(TITLES, "chapters").map((x) => x.totalChapters);
    assertEqual(byChapters.join(","), "400,139,99", "chapter-count sort should be descending");

    // Numeric, not lexical: 100 must beat 99, which a string compare gets wrong.
    const byLatest = sortTitles(TITLES, "latest").map((x) => x.latestChapter);
    assertEqual(byLatest.join(","), "Ch 100,Ch 99,Ch 5", "latest-chapter sort should be numeric");
  });

  await test("the default sort leaves the incoming order untouched", () => {
    const out = sortTitles(TITLES, "shelf").map((x) => x.title);
    assertEqual(out.join(","), TITLES.map((x) => x.title).join(","), "shelf order should be preserved");
  });

  await test("sortTitles does not mutate its input", () => {
    const before = TITLES.map((x) => x.title).join(",");
    sortTitles(TITLES, "title");
    assertEqual(TITLES.map((x) => x.title).join(","), before, "the original array should be unchanged");
  });

  await test("titleMatches matches the display name and aliases", () => {
    const titan = TITLES[2];
    assert(titleMatches(titan, "attack"), "a display-name substring should match");
    assert(titleMatches(titan, "shingeki"), "a romaji alias should match");
    assert(titleMatches(titan, "進撃"), "a non-Latin alias should match");
    assert(!titleMatches(titan, "berserk"), "an unrelated query should not match");
    assert(titleMatches(titan, ""), "an empty query matches everything");
  });
}
