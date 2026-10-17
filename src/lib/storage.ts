// Persistent state for the reader.
//
// Storage deliberately avoids localStorage and IndexedDB. Some constrained
// browsers and Android WebView builds expose those as throwing or missing
// stubs, so everything lives in a `Secure` cookie instead. When cookies are
// unavailable the reader keeps working for the current session using an
// in-memory fallback — nothing here ever throws.

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
  lastRead: string | null;
  theme: "dark" | "light";
  fitMode: "width" | "height" | "original";
  wide: boolean;
}

const COOKIE = "manga_reader_state";
const MAX_AGE = 365 * 24 * 60 * 60;
// Browsers cap a single cookie at ~4KB; stay comfortably below that.
const MAX_COOKIE_LEN = 3800;
const MAX_HISTORY = 30;

const DEFAULT_STATE: StoredState = { history: [], lastRead: null, theme: "dark", fitMode: "width", wide: false };

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

function parseState(raw: string | null): StoredState {
  if (!raw) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    const history = Array.isArray(parsed.history)
      ? parsed.history.filter(
          (h): h is HistoryEntry => !!h && typeof h.url === "string" && typeof h.timestamp === "number"
        )
      : [];
    const fitMode = parsed.fitMode;
    return {
      history,
      lastRead: typeof parsed.lastRead === "string" ? parsed.lastRead : null,
      theme: parsed.theme === "light" ? "light" : "dark",
      fitMode: fitMode === "height" || fitMode === "original" ? fitMode : "width",
      wide: parsed.wide === true,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function persist(state: StoredState): void {
  let history = state.history.slice(0, MAX_HISTORY);
  let payload = JSON.stringify({ ...state, history });
  while (payload.length > MAX_COOKIE_LEN && history.length > 0) {
    history = history.slice(0, history.length - 1);
    payload = JSON.stringify({ ...state, history });
  }
  writeCookie(COOKIE, payload);
  memoryState = state;
}

export function loadState(): StoredState {
  if (!loaded) {
    memoryState = parseState(readCookie(COOKIE));
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
