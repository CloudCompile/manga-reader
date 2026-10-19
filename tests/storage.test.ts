// Storage has to survive a round trip through a ~4KB cookie without silently
// dropping entries. These run against a fake `document.cookie` so the real
// read/write path is exercised, not a stub of the module.
import { assert, assertEqual, suite, test } from "./harness.ts";

// A cookie jar that enforces a browser-like size limit, so an oversized write
// fails the same way it would in a real WebView.
const COOKIE_LIMIT = 4096;

function installCookieJar(): { stored: () => string; value: (name: string) => string | null } {
  let jar = "";
  const doc = {
    get cookie() {
      return jar;
    },
    set cookie(v: string) {
      const pair = v.split(";")[0];
      const name = pair.split("=")[0];
      const rest = jar
        .split("; ")
        .filter((p) => p && p.split("=")[0] !== name);
      // Real browsers drop an oversized cookie outright; model that so the
      // storage layer has to keep every cookie under the limit on its own.
      if (pair.length <= COOKIE_LIMIT) rest.push(pair);
      jar = rest.join("; ");
    },
  };
  (globalThis as unknown as { document: unknown }).document = doc;
  // Node exposes `navigator` as a getter-only global, so it has to be replaced
  // with defineProperty rather than assigned.
  Object.defineProperty(globalThis, "navigator", {
    value: { cookieEnabled: true },
    configurable: true,
    writable: true,
  });
  return {
    stored: () => jar,
    value: (name: string) => {
      const prefix = encodeURIComponent(name) + "=";
      for (const part of jar.split("; ")) {
        if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
      }
      return null;
    },
  };
}

// The largest single cookie the storage layer wrote, in characters.
function largestCookie(jar: { stored: () => string }): number {
  return jar
    .stored()
    .split("; ")
    .reduce((max, part) => Math.max(max, part.length), 0);
}

function clearCookies(): void {
  for (const part of (globalThis as unknown as { document: { cookie: string } }).document.cookie.split("; ")) {
    const name = part.split("=")[0];
    if (name) {
      (globalThis as unknown as { document: { cookie: string } }).document.cookie = `${name}=; Max-Age=0`;
    }
  }
}

function entry(url: string, chapter: string, name: string, page?: number) {
  return { url, mangaName: name, chapterNum: chapter, timestamp: Date.now(), page };
}

// Imports a second, independent copy of the storage module so its one-time
// cookie read actually runs. The specifier is built at runtime because the
// query string is a Node cache-buster, not a resolvable module path.
async function freshStorage(tag: string): Promise<typeof import("../src/lib/storage.ts")> {
  const spec = "../src/lib/storage.ts";
  return (await import(/* @vite-ignore */ `${spec}?${tag}`)) as typeof import("../src/lib/storage.ts");
}

const FFB = "https://thefragrantflowerbloomswithdignity.com";
const LONG_NAME = "The Fragrant Flower Blooms with Dignity";

export async function run(): Promise<void> {
  suite("storage");
  const jar = installCookieJar();
  const storage = await freshStorage("main");

  await test("round-trips history through the cookie", () => {
    storage.pushHistory(entry(`${FFB}/the-fragrant-flower-blooms-with-dignity-manga-chapter-191/`, "191", LONG_NAME, 7));
    const history = storage.getHistory();
    assertEqual(history.length, 1, "one entry expected");
    assertEqual(history[0].url, `${FFB}/the-fragrant-flower-blooms-with-dignity-manga-chapter-191/`, "url should survive");
    assertEqual(history[0].mangaName, LONG_NAME, "name should survive");
    assertEqual(history[0].page, 7, "page should survive");
  });

  await test("re-opening a chapter keeps the page already reached", () => {
    storage.pushHistory(entry(`${FFB}/the-fragrant-flower-blooms-with-dignity-manga-chapter-191/`, "191", LONG_NAME));
    const found = storage.getHistory().find((h) => h.chapterNum === "191");
    assertEqual(found?.page, 7, "page should be carried over");
  });

  await test("30 long-URL entries still fit one cookie", () => {
    // This is the case that used to overflow: absolute URLs are ~110 bytes each,
    // so 30 entries plus settings exceeded 3800 and history was truncated.
    for (let n = 1; n <= 30; n++) {
      storage.pushHistory(entry(`${FFB}/the-fragrant-flower-blooms-with-dignity-manga-chapter-${n}/`, String(n), LONG_NAME, n));
    }
    const history = storage.getHistory();
    assertEqual(history.length, 30, `all 30 entries should be retained, got ${history.length}`);
    assert(
      largestCookie(jar) < COOKIE_LIMIT,
      `each cookie must fit the limit, largest was ${largestCookie(jar)}`
    );
  });

  await test("the reading list survives alongside full history", () => {
    for (let n = 1; n <= 10; n++) {
      storage.toggleInList(entry(`${FFB}/the-fragrant-flower-blooms-with-dignity-manga-chapter-${n}/`, String(n), LONG_NAME));
    }
    const list = storage.getList();
    assertEqual(list.length, 10, `10 saved items expected, got ${list.length}`);
    assertEqual(storage.getHistory().length, 30, "history should be unaffected by the reading list");
    assert(
      largestCookie(jar) < COOKIE_LIMIT,
      `each cookie must still fit, largest was ${largestCookie(jar)}`
    );
  });

  await test("toggling removes an item already in the list", () => {
    const url = `${FFB}/the-fragrant-flower-blooms-with-dignity-manga-chapter-5/`;
    assert(storage.isInList(url), "chapter 5 should be in the list");
    storage.toggleInList(entry(url, "5", LONG_NAME));
    assert(!storage.isInList(url), "chapter 5 should have been removed");
    storage.toggleInList(entry(url, "5", LONG_NAME));
    assert(storage.isInList(url), "chapter 5 should be back");
  });

  await test("preferences persist across a reload", () => {
    storage.setTheme("light");
    storage.setFitMode("original");
    storage.setWide(true);
    storage.setPaged(true);
    storage.setRtl(true);
    storage.setAnimeRotate(true);
    assertEqual(storage.getTheme(), "light", "theme should persist");
    assertEqual(storage.getFitMode(), "original", "fit mode should persist");
    assertEqual(storage.getWide(), true, "wide should persist");
    assertEqual(storage.getPaged(), true, "paged should persist");
    assertEqual(storage.getRtl(), true, "rtl should persist");
    assertEqual(storage.getAnimeRotate(), true, "anime rotate should persist");
  });

  await test("a reload keeps the paged and rtl flags", async () => {
    // The settings live in their own cookie, so a fresh module reading only
    // that cookie must still see them; this is the reload path the reader
    // takes on every launch.
    const fresh = await freshStorage("prefs-reload");
    assertEqual(fresh.getPaged(), true, "paged should survive a reload");
    assertEqual(fresh.getRtl(), true, "rtl should survive a reload");
    assertEqual(fresh.getAnimeRotate(), true, "anime rotate should survive a reload");
  });

  await test("anime rotate defaults to off when absent", async () => {
    clearCookies();
    const fresh = await freshStorage("rotate-absent");
    assertEqual(fresh.getAnimeRotate(), false, "a missing flag should read as off");
  });

  await test("a corrupt cookie falls back to defaults instead of throwing", async () => {
    clearCookies();
    (globalThis as unknown as { document: { cookie: string } }).document.cookie =
      "manga_reader_state=" + encodeURIComponent("{not valid json");
    // A fresh module instance so the already-loaded in-memory state is bypassed.
    const fresh = await freshStorage("corrupt");
    let threw = false;
    let history: unknown[] = [];
    try {
      history = fresh.getHistory();
      fresh.getList();
      fresh.getTheme();
    } catch {
      threw = true;
    }
    assert(!threw, "reading a corrupt cookie must not throw");
    assertEqual(history.length, 0, "corrupt payload should yield empty history");
    assertEqual(fresh.getTheme(), "dark", "corrupt payload should fall back to the default theme");
  });

  await test("a v1 payload from an older build still loads", async () => {
    clearCookies();
    const legacy = {
      history: [
        {
          url: `${FFB}/the-fragrant-flower-blooms-with-dignity-manga-chapter-42/`,
          mangaName: LONG_NAME,
          chapterNum: "42",
          timestamp: Date.now(),
          page: 3,
        },
      ],
      lastRead: `${FFB}/the-fragrant-flower-blooms-with-dignity-manga-chapter-42/`,
      theme: "light",
      fitMode: "height",
      wide: true,
    };
    (globalThis as unknown as { document: { cookie: string } }).document.cookie =
      "manga_reader_state=" + encodeURIComponent(JSON.stringify(legacy));
    const fresh = await freshStorage("legacy");
    const history = fresh.getHistory();
    assertEqual(history.length, 1, "legacy entry should be read");
    assertEqual(history[0].page, 3, "legacy page should be preserved");
    assertEqual(fresh.getFitMode(), "height", "legacy fit mode should be preserved");
    assertEqual(fresh.getWide(), true, "legacy wide flag should be preserved");
  });

  await test("read progress is recorded per series and never goes backwards", async () => {
    clearCookies();
    const fresh = await freshStorage("read-progress");
    fresh.markRead("specterscans:boku-no-kokoro-no-yabai-yatsu", 12);
    assertEqual(fresh.getRead()["specterscans:boku-no-kokoro-no-yabai-yatsu"], 12, "chapter 12 should be recorded");
    // Re-reading an earlier chapter must not lower the mark.
    fresh.markRead("specterscans:boku-no-kokoro-no-yabai-yatsu", 4);
    assertEqual(fresh.getRead()["specterscans:boku-no-kokoro-no-yabai-yatsu"], 12, "the mark must not regress");
    fresh.markRead("specterscans:boku-no-kokoro-no-yabai-yatsu", 20);
    assertEqual(fresh.getRead()["specterscans:boku-no-kokoro-no-yabai-yatsu"], 20, "a later chapter should raise the mark");
  });

  await test("read progress survives a reload", async () => {
    const fresh = await freshStorage("read-reload");
    assertEqual(fresh.getRead()["specterscans:boku-no-kokoro-no-yabai-yatsu"], 20, "read progress should survive a reload");
  });

  await test("per-series reader defaults round-trip", async () => {
    clearCookies();
    const fresh = await freshStorage("series-prefs");
    fresh.setSeriesPrefs("ffb:the-fragrant-flower-blooms-with-dignity", { rtl: true, fitMode: "height" });
    const prefs = fresh.getSeriesPrefs("ffb:the-fragrant-flower-blooms-with-dignity");
    assertEqual(prefs.rtl, true, "rtl should persist per series");
    assertEqual(prefs.fitMode, "height", "fit mode should persist per series");
    // A patch merges rather than replacing, so setting one field keeps the rest.
    fresh.setSeriesPrefs("ffb:the-fragrant-flower-blooms-with-dignity", { paged: true });
    const merged = fresh.getSeriesPrefs("ffb:the-fragrant-flower-blooms-with-dignity");
    assertEqual(merged.rtl, true, "an existing field should survive a later patch");
    assertEqual(merged.paged, true, "the new field should be set");
    const reload = await freshStorage("series-prefs-reload");
    assertEqual(reload.getSeriesPrefs("ffb:the-fragrant-flower-blooms-with-dignity").rtl, true, "series prefs should survive a reload");
  });

  await test("the read map and series prefs stay inside the cookie limit", () => {
    clearCookies();
    const s = (globalThis as unknown as { document: { cookie: string } }).document;
    for (let i = 0; i < 120; i++) {
      storage.markRead(`src:series-number-${i}`, i + 1);
      storage.setSeriesPrefs(`src:series-number-${i}`, { rtl: i % 2 === 0, fitMode: "height" });
    }
    assert(
      largestCookie(jar) < COOKIE_LIMIT,
      `the settings cookie must stay under the limit, largest was ${largestCookie(jar)}`
    );
    assert(s.cookie.length > 0, "cookies should still be present");
  });

  await test("clearAll wipes history, list and progress", async () => {
    const fresh = await freshStorage("clear-all");
    fresh.pushHistory(entry(`${FFB}/the-fragrant-flower-blooms-with-dignity-manga-chapter-1/`, "1", LONG_NAME));
    fresh.markRead("ffb:the-fragrant-flower-blooms-with-dignity", 5);
    fresh.clearAll();
    assertEqual(fresh.getHistory().length, 0, "history should be cleared");
    assertEqual(fresh.getList().length, 0, "the reading list should be cleared");
    assertEqual(Object.keys(fresh.getRead()).length, 0, "read progress should be cleared");
    const reload = await freshStorage("clear-all-reload");
    assertEqual(reload.getHistory().length, 0, "a reload after clearing should stay empty");
  });
}
