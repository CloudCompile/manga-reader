// Persistent state for the reader.
//
// Storage deliberately avoids localStorage and IndexedDB. Some constrained
// browsers and Android WebView builds expose those as throwing or missing
// stubs, so everything lives in a `Secure` cookie instead. When cookies are
// unavailable the reader keeps working for the current session using an
// in-memory fallback — nothing here ever throws.
//
// A cookie is ~4KB and absolute chapter URLs are long, so history entries are
// stored as {origin index, path}: origins are pooled once and each entry keeps
// only its pathname. That fits 30 history entries plus a 50-item reading list
// well under the limit, where plain absolute URLs overflowed and silently
// dropped entries.
//
// Wire format (v2), one cookie for history and one for the reading list:
//   { v: 2, o: [origin...], x: [shared path prefix...], N: [title...],
//     h: [entry...] | l: [entry...], r: {i,u}|null }
//   entry = { u: path with prefix stripped, i: origin index, n?: title index,
//             c?: chapter, t: time, p?: page }
// Settings live in the history cookie alongside `h`.

export interface HistoryEntry {
  url: string;
  mangaName: string;
  chapterNum: string;
  timestamp: number;
  // Last page reached in this chapter, so the reader can resume where it left.
  page?: number;
}

export interface StoredState {
  history: HistoryEntry[];
  // Titles the reader deliberately kept, in the order they were added. Separate
  // from history because history is recency-ordered and gets trimmed first when
  // the cookie fills, which would silently drop things the reader chose to keep.
  list: HistoryEntry[];
  lastRead: string | null;
  theme: "dark" | "light";
  fitMode: "width" | "height" | "original";
  wide: boolean;
}

interface PackedEntry {
  u: string;
  i: number;
  n?: number;
  c?: string;
  t: number;
  p?: number;
}

interface PackedGroup {
  v: number;
  // Origins, the longest shared path prefix for each, and the pooled titles.
  o: string[];
  x: string[];
  N: string[];
  h?: PackedEntry[];
  l?: PackedEntry[];
  r: { i: number; u: string } | null;
}

const COOKIE = "manga_reader_state";
const LIST_COOKIE = "manga_reader_list";
const SETTINGS_COOKIE = "manga_reader_prefs";
const MAX_AGE = 365 * 24 * 60 * 60;
// Browsers cap a single cookie at ~4KB; stay comfortably below that.
const MAX_COOKIE_LEN = 3800;
const MAX_HISTORY = 30;
const MAX_LIST = 50;

const DEFAULT_STATE: StoredState = {
  history: [],
  list: [],
  lastRead: null,
  theme: "dark",
  fitMode: "width",
  wide: false,
};

let memoryState: StoredState = { ...DEFAULT_STATE };
let loaded = false;

function cookiesAvailable(): boolean {
  if (typeof document === "undefined" || typeof document.cookie !== "string") return false;
  try {
    return !(typeof navigator !== "undefined" && navigator.cookieEnabled === false);
  } catch {
    return true;
  }
}

function readCookie(name: string): string | null {
  if (!cookiesAvailable()) return null;
  try {
    const prefix = encodeURIComponent(name) + "=";
    for (const part of document.cookie.split(/;\s*/)) {
      if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
    }
  } catch {
    /* reading cookies is best-effort */
  }
  return null;
}

function writeCookie(name: string, value: string): boolean {
  if (!cookiesAvailable()) return false;
  try {
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Max-Age=${MAX_AGE}; Path=/; Secure; SameSite=Lax`;
    // Confirm the write: WebViews with cookies disabled drop it silently.
    return readCookie(name) === value;
  } catch {
    return false;
  }
}

function parseEntry(h: unknown): HistoryEntry | null {
  if (!h || typeof h !== "object") return null;
  const e = h as Partial<HistoryEntry>;
  if (typeof e.url !== "string" || typeof e.timestamp !== "number") return null;
  return {
    url: e.url,
    mangaName: typeof e.mangaName === "string" ? e.mangaName : "",
    chapterNum: typeof e.chapterNum === "string" ? e.chapterNum : "",
    timestamp: e.timestamp,
    page: typeof e.page === "number" ? e.page : undefined,
  };
}

function unpackEntries(
  list: PackedEntry[] | undefined,
  origins: string[],
  prefixes: string[],
  titles: string[]
): HistoryEntry[] {
  if (!Array.isArray(list)) return [];
  const out: HistoryEntry[] = [];
  for (const e of list) {
    if (!e || typeof e.u !== "string" || typeof e.t !== "number") continue;
    out.push({
      url: (origins[e.i] || "") + (prefixes[e.i] || "") + e.u,
      mangaName: typeof e.n === "number" ? titles[e.n] || "" : "",
      chapterNum: typeof e.c === "string" ? e.c : "",
      timestamp: e.t,
      page: typeof e.p === "number" ? e.p : undefined,
    });
  }
  return out;
}

function readGroup(raw: string | null): { entries: HistoryEntry[]; lastRead: string | null } {
  if (!raw) return { entries: [], lastRead: null };
  try {
    const parsed = JSON.parse(raw) as Partial<PackedGroup>;
    if (!Array.isArray(parsed.o)) return { entries: [], lastRead: null };
    const origins = parsed.o.filter((o): o is string => typeof o === "string");
    const prefixes = Array.isArray(parsed.x)
      ? parsed.x.filter((p): p is string => typeof p === "string")
      : [];
    const titles = Array.isArray(parsed.N)
      ? parsed.N.filter((n): n is string => typeof n === "string")
      : [];
    const entries = unpackEntries(parsed.h || parsed.l, origins, prefixes, titles);
    const lastRead =
      parsed.r && typeof parsed.r === "object"
        ? (origins[parsed.r.i] || "") + (prefixes[parsed.r.i] || "") + parsed.r.u
        : null;
    return { entries, lastRead };
  } catch {
    return { entries: [], lastRead: null };
  }
}

function parseState(raw: string | null, rawList: string | null, rawSettings: string | null): StoredState {
  let settings: Partial<StoredState> = {};
  if (rawSettings) {
    try {
      settings = JSON.parse(rawSettings) as Partial<StoredState>;
    } catch {
      settings = {};
    }
  }

  try {
    // Legacy v1: history, settings and absolute URLs all in one cookie, with no
    // reading list. Recognised by the absence of the v2 origin pool.
    if (raw) {
      const legacy = JSON.parse(raw) as Partial<StoredState> & { o?: unknown };
      if (!Array.isArray(legacy.o) && Array.isArray(legacy.history)) {
        return {
          history: legacy.history.map(parseEntry).filter((e): e is HistoryEntry => e !== null),
          list: [],
          lastRead: typeof legacy.lastRead === "string" ? legacy.lastRead : null,
          theme: legacy.theme === "light" ? "light" : "dark",
          fitMode:
            legacy.fitMode === "height" || legacy.fitMode === "original" ? legacy.fitMode : "width",
          wide: legacy.wide === true,
        };
      }
    }
  } catch {
    /* fall through to the v2 read below, which has its own guards */
  }

  const state = readGroup(raw);
  const list = readGroup(rawList);
  return {
    history: state.entries,
    list: list.entries,
    lastRead: state.lastRead,
    theme: settings.theme === "light" ? "light" : "dark",
    fitMode:
      settings.fitMode === "height" || settings.fitMode === "original" ? settings.fitMode : "width",
    wide: settings.wide === true,
  };
}

// Longest common prefix, trimmed back to the last "/" so it never splits a
// path segment.
function sharedPrefix(values: string[]): string {
  if (values.length < 2) return "";
  let prefix = values[0];
  for (const v of values) {
    let i = 0;
    while (i < prefix.length && i < v.length && prefix[i] === v[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) return "";
  }
  const cut = prefix.lastIndexOf("/");
  return cut > 0 ? prefix.slice(0, cut + 1) : "";
}

function splitUrl(url: string): { origin: string; path: string } {
  try {
    const u = new URL(url);
    return { origin: u.origin, path: u.pathname + u.search };
  } catch {
    return { origin: "", path: url };
  }
}

// Packs one list of entries into the v2 shape. Origins, the longest shared path
// prefix per origin, and the series titles are each stored once, which is what
// lets 30 long chapter URLs fit in a single 4KB cookie.
function packGroup(entries: HistoryEntry[], lastRead: string | null, key: "h" | "l"): string {
  const origins: string[] = [];
  const originIndex = new Map<string, number>();
  const titles: string[] = [];
  const titleIndex = new Map<string, number>();
  const pathByOrigin = new Map<number, string[]>();

  const indexOfOrigin = (origin: string): number => {
    const found = originIndex.get(origin);
    if (found !== undefined) return found;
    const idx = origins.push(origin) - 1;
    originIndex.set(origin, idx);
    return idx;
  };

  for (const e of entries) {
    const { origin, path } = splitUrl(e.url);
    const idx = indexOfOrigin(origin);
    const paths = pathByOrigin.get(idx) || [];
    paths.push(path);
    pathByOrigin.set(idx, paths);
  }
  if (lastRead) indexOfOrigin(splitUrl(lastRead).origin);

  const prefixes = origins.map((_, idx) => sharedPrefix(pathByOrigin.get(idx) || []));

  const indexOfTitle = (name: string): number => {
    const found = titleIndex.get(name);
    if (found !== undefined) return found;
    const idx = titles.push(name) - 1;
    titleIndex.set(name, idx);
    return idx;
  };

  const packed: PackedEntry[] = entries.map((e) => {
    const { origin, path } = splitUrl(e.url);
    const idx = indexOfOrigin(origin);
    const prefix = prefixes[idx] || "";
    const out: PackedEntry = {
      u: path.startsWith(prefix) ? path.slice(prefix.length) : path,
      i: idx,
      t: e.timestamp,
    };
    if (e.mangaName) out.n = indexOfTitle(e.mangaName);
    if (e.chapterNum) out.c = e.chapterNum;
    if (typeof e.page === "number") out.p = e.page;
    return out;
  });

  let r: PackedGroup["r"] = null;
  if (lastRead) {
    const { origin, path } = splitUrl(lastRead);
    const idx = indexOfOrigin(origin);
    const prefix = prefixes[idx] || "";
    r = { i: idx, u: path.startsWith(prefix) ? path.slice(prefix.length) : path };
  }

  const payload: PackedGroup = { v: 2, o: origins, x: prefixes, N: titles, r };
  payload[key] = packed;
  return JSON.stringify(payload);
}

// Trims entries until the payload fits, oldest first.
function fit(
  entries: HistoryEntry[],
  build: (list: HistoryEntry[]) => string
): { entries: HistoryEntry[]; payload: string } {
  let list = entries;
  let payload = build(list);
  while (payload.length > MAX_COOKIE_LEN && list.length > 0) {
    list = list.slice(0, list.length - 1);
    payload = build(list);
  }
  return { entries: list, payload };
}

function persist(state: StoredState): void {
  // History, the reading list and the settings each get their own cookie, so a
  // full history cannot push out titles the reader deliberately saved, and a
  // long URL list cannot push out the theme.
  const historyFit = fit(state.history.slice(0, MAX_HISTORY), (list) =>
    packGroup(list, state.lastRead, "h")
  );
  writeCookie(COOKIE, historyFit.payload);

  const listFit = fit(state.list.slice(0, MAX_LIST), (list) => packGroup(list, null, "l"));
  writeCookie(LIST_COOKIE, listFit.payload);

  writeCookie(
    SETTINGS_COOKIE,
    JSON.stringify({ theme: state.theme, fitMode: state.fitMode, wide: state.wide })
  );

  // Keep memory in step with what was actually stored; otherwise the session
  // shows entries that the next reload will not have.
  memoryState = { ...state, history: historyFit.entries, list: listFit.entries };
}

export function loadState(): StoredState {
  if (!loaded) {
    memoryState = parseState(readCookie(COOKIE), readCookie(LIST_COOKIE), readCookie(SETTINGS_COOKIE));
    loaded = true;
  }
  return memoryState;
}

export function getHistory(): HistoryEntry[] {
  return loadState().history;
}

export function pushHistory(entry: HistoryEntry): HistoryEntry[] {
  const state = loadState();
  // Re-opening a chapter must not discard the page already reached in it.
  const existing = state.history.find((e) => e.url === entry.url);
  const history = state.history.filter((e) => e.url !== entry.url);
  history.unshift({ ...entry, page: entry.page ?? existing?.page, timestamp: Date.now() });
  const next = { ...state, history };
  persist(next);
  return next.history;
}

export function getList(): HistoryEntry[] {
  return loadState().list;
}

export function isInList(url: string): boolean {
  return loadState().list.some((e) => e.url === url);
}

// Toggles a chapter in the reading list, returning the new list. Newest
// additions go on top so the list reads as most-recently-saved first.
export function toggleInList(entry: HistoryEntry): HistoryEntry[] {
  const state = loadState();
  const present = state.list.some((e) => e.url === entry.url);
  const list = present
    ? state.list.filter((e) => e.url !== entry.url)
    : [{ ...entry, timestamp: Date.now() }, ...state.list];
  const next = { ...state, list };
  persist(next);
  return next.list;
}

export function removeFromList(url: string): HistoryEntry[] {
  const state = loadState();
  const list = state.list.filter((e) => e.url !== url);
  const next = { ...state, list };
  persist(next);
  return next.list;
}

export function getLastRead(): string | null {
  return loadState().lastRead;
}

export function setLastRead(url: string): void {
  const state = loadState();
  persist({ ...state, lastRead: url });
}

export function getTheme(): "dark" | "light" {
  return loadState().theme;
}

export function setTheme(theme: "dark" | "light"): void {
  const state = loadState();
  persist({ ...state, theme });
}

export function getFitMode(): "width" | "height" | "original" {
  return loadState().fitMode;
}

export function setFitMode(fitMode: "width" | "height" | "original"): void {
  const state = loadState();
  persist({ ...state, fitMode });
}

export function getWide(): boolean {
  return loadState().wide;
}

export function setWide(wide: boolean): void {
  const state = loadState();
  persist({ ...state, wide });
}

// Records how far into a chapter the reader got, so it can resume later.
export function setPage(url: string, page: number): void {
  const state = loadState();
  const history = state.history.map((h) => (h.url === url ? { ...h, page } : h));
  persist({ ...state, history });
}
