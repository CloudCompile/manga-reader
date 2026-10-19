// Anime metadata and streaming, backed by the external anime API.
//
// The API is a small REST service that wraps a streaming index. Its responses
// are shallow and loosely typed, so everything here is parsed defensively: a
// missing field yields an empty value rather than an exception, and a shape we
// do not recognise is reported as "no match" instead of a crash.
//
// Streaming is HLS. The CDN serves playlists and segments with
// `Access-Control-Allow-Origin: https://play.echovideo.ru`, so a browser on any
// other origin cannot fetch them directly. `/api/anime/hls` therefore relays
// them and rewrites the playlist so the player never has to leave our origin.

import { ANIME_API, UA } from "./sources";

export interface AnimeSearchResult {
  id: string;
  title: string;
  japaneseTitle?: string;
  poster?: string;
  showType?: string;
  // Episode counts as advertised by the listing; a string because the upstream
  // sends "?" for an ongoing series.
  subEpisodes?: string;
  dubEpisodes?: string;
}

export interface AnimeInfo {
  id: string;
  title: string;
  japaneseTitle?: string;
  poster?: string;
  showType?: string;
  overview?: string;
  status?: string;
  score?: string;
  duration?: string;
  episodes?: string;
  premiered?: string;
  dateAired?: string;
  studios: string[];
  producers: string[];
  genres: string[];
  subEpisodes?: string;
  dubEpisodes?: string;
  adult?: boolean;
}

export interface AnimeEpisode {
  // Opaque id the stream endpoint expects; already carries the "?ep=" suffix.
  id: string;
  num: number;
  title: string;
  filler: boolean;
  subbed: boolean;
  dubbed: boolean;
}

export interface AnimeServer {
  type: "sub" | "dub" | string;
  name: string;
}

export interface AnimeStream {
  // "hls" when the API returned a playlist we can relay, "iframe" when the only
  // option is an embed served by the upstream provider.
  kind: "hls" | "iframe";
  // Raw playlist URL for hls; embed URL for iframe.
  url: string;
  server: string;
  servers: AnimeServer[];
}

// ─── Fetch plumbing ───────────────────────────────────────

const TTL = 10 * 60 * 1000;

interface CacheEntry {
  value: unknown;
  expires: number;
}

// A tiny TTL map, matching the shape of the source caches but local so this
// module has no dependency on the scraping pipeline's cache sizes.
const CACHE = new Map<string, CacheEntry>();
const CACHE_MAX = 200;

function cacheGet<T>(key: string): T | undefined {
  const hit = CACHE.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    CACHE.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown): void {
  if (CACHE.size >= CACHE_MAX) {
    const oldest = CACHE.keys().next();
    if (!oldest.done) CACHE.delete(oldest.value);
  }
  CACHE.set(key, { value, expires: Date.now() + TTL });
}

async function apiFetch<T>(url: string): Promise<T | null> {
  const cached = cacheGet<T>(url);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; results?: T };
    if (!json || json.success === false || json.results === undefined) return null;
    cacheSet(url, json.results);
    return json.results;
  } catch {
    return null;
  }
}

// Query-string endpoints: `info?id=`, `stream?id=`, `search?keyword=`.
async function apiGet<T>(path: string, params: Record<string, string | undefined>): Promise<T | null> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const qs = search.toString();
  return apiFetch<T>(`${ANIME_API}/api/${path}${qs ? `?${qs}` : ""}`);
}

// Path-parameter endpoints: `episodes/<id>`. Kept separate so the query-string
// helper stays simple.
async function apiGetPath<T>(path: string): Promise<T | null> {
  return apiFetch<T>(`${ANIME_API}/api/${path}`);
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && isFinite(v)) return String(v);
  return undefined;
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(asString).filter((s): s is string => !!s);
}

// ─── Search ───────────────────────────────────────────────

export interface RawSearchItem {
  id?: unknown;
  title?: unknown;
  japanese_title?: unknown;
  poster?: unknown;
  showType?: unknown;
  tvInfo?: { showType?: unknown; sub?: unknown; dub?: unknown; eps?: unknown };
}

export function parseSearchItem(raw: RawSearchItem): AnimeSearchResult | null {
  const id = asString(raw.id);
  const title = asString(raw.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    japaneseTitle: asString(raw.japanese_title),
    poster: asString(raw.poster),
    showType: asString(raw.showType) || asString(raw.tvInfo?.showType),
    subEpisodes: asString(raw.tvInfo?.sub),
    dubEpisodes: asString(raw.tvInfo?.dub),
  };
}

export async function searchAnime(query: string): Promise<AnimeSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const results = await apiGet<{ data?: RawSearchItem[] }>("search", { keyword: q });
  const items = Array.isArray(results?.data) ? results.data : [];
  return items.map(parseSearchItem).filter((r): r is AnimeSearchResult => r !== null);
}

// ─── Info ─────────────────────────────────────────────────

export interface RawInfo {
  id?: unknown;
  title?: unknown;
  japanese_title?: unknown;
  poster?: unknown;
  showType?: unknown;
  adultContent?: unknown;
  animeInfo?: {
    Overview?: unknown;
    Status?: unknown;
    Scores?: unknown;
    Duration?: unknown;
    Episodes?: unknown;
    Premiered?: unknown;
    "Date aired"?: unknown;
    Genre?: unknown;
    Studios?: unknown;
    Producers?: unknown;
    tvInfo?: { sub?: unknown; dub?: unknown };
  };
}

export function parseAnimeInfo(raw: unknown, fallbackId = ""): AnimeInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawInfo;
  const title = asString(r.title);
  if (!title) return null;
  const ai = r.animeInfo || {};
  const premiered = asStringList(ai.Premiered);
  return {
    id: asString(r.id) || fallbackId,
    title,
    japaneseTitle: asString(r.japanese_title),
    poster: asString(r.poster),
    showType: asString(r.showType),
    overview: asString(ai.Overview),
    status: asString(ai.Status),
    score: asString(ai.Scores),
    duration: asString(ai.Duration),
    episodes: asString(ai.Episodes),
    premiered: premiered[0],
    dateAired: asString(ai["Date aired"]),
    studios: asStringList(ai.Studios),
    producers: asStringList(ai.Producers),
    genres: asStringList(ai.Genre),
    subEpisodes: asString(ai.tvInfo?.sub),
    dubEpisodes: asString(ai.tvInfo?.dub),
    adult: r.adultContent === true,
  };
}

export async function animeInfo(id: string): Promise<AnimeInfo | null> {
  const result = await apiGet<{ data?: unknown }>("info", { id });
  return parseAnimeInfo(result?.data, id);
}

// ─── Episodes ─────────────────────────────────────────────

export interface RawEpisode {
  id?: unknown;
  episode_no?: unknown;
  title?: unknown;
  filler?: unknown;
  subbed?: unknown;
  dubbed?: unknown;
}

export function parseEpisodes(raw: unknown): AnimeEpisode[] {
  const items = Array.isArray(raw) ? (raw as RawEpisode[]) : [];
  const out: AnimeEpisode[] = [];
  for (const e of items) {
    const epId = asString(e.id);
    const num = typeof e.episode_no === "number" ? e.episode_no : Number(asString(e.episode_no));
    if (!epId || !isFinite(num)) continue;
    out.push({
      id: epId,
      num,
      title: asString(e.title) || `Episode ${num}`,
      filler: e.filler === true,
      subbed: e.subbed !== false,
      dubbed: e.dubbed === true,
    });
  }
  out.sort((a, b) => a.num - b.num);
  return out;
}

export async function animeEpisodes(id: string): Promise<AnimeEpisode[]> {
  // `episodes/<id>` takes the id in the path, not as a query parameter.
  const result = await apiGetPath<{ episodes?: unknown }>(`episodes/${encodeURIComponent(id)}`);
  return parseEpisodes(result?.episodes);
}

// ─── Stream ───────────────────────────────────────────────

export interface RawStream {
  streamingLink?: {
    iframe?: unknown;
    link?: { file?: unknown; type?: unknown };
    server?: unknown;
  };
  servers?: { type?: unknown; serverName?: unknown }[];
}

export function parseStream(result: unknown, requestedServer?: string): AnimeStream | null {
  if (!result || typeof result !== "object") return null;
  const r = result as RawStream;
  const link = r.streamingLink || {};
  const servers: AnimeServer[] = [];
  for (const s of r.servers || []) {
    const name = asString(s.serverName);
    if (!name) continue;
    if (!servers.some((x) => x.name === name)) servers.push({ type: asString(s.type) || "sub", name });
  }
  const file = asString(link.link?.file);
  const iframe = asString(link.iframe);
  const chosen = asString(link.server) || requestedServer || "";
  // Prefer the relayable playlist; the iframe is only used when the upstream
  // gave us nothing else, since embedding an unknown third party is a worse
  // experience (ads, no quality control, and it can refuse to frame).
  if (file) return { kind: "hls", url: file, server: chosen, servers };
  if (iframe) return { kind: "iframe", url: iframe, server: chosen, servers };
  return { kind: "hls", url: "", server: chosen, servers };
}

export async function animeStream(episodeId: string, server?: string): Promise<AnimeStream | null> {
  const result = await apiGet<RawStream>("stream", { id: episodeId, server });
  return parseStream(result, server);
}

// ─── Title matching ───────────────────────────────────────
//
// The reader knows a manga by its scraped title (and sometimes a romanised
// alias); the anime API knows it by its own listing title. Matching is by
// normalised token overlap, with an exact match short-circuiting so an obvious
// hit never loses to a longer near-miss.

function normTitle(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // A leading article is noise for matching: "The Fragrant Flower…" and
    // "Fragrant Flower…" are the same series.
    .replace(/^(the|a|an) /, "");
}

export function titleSimilarity(a: string, b: string): number {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const A = new Set(na.split(" ").filter(Boolean));
  const B = new Set(nb.split(" ").filter(Boolean));
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const jaccard = inter / (A.size + B.size - inter);
  // A whole-word prefix relationship ("Blue Box" / "Blue Box Season 2") is a
  // much stronger signal than the raw token overlap suggests, so it is scored
  // above the match threshold instead of just under it.
  const prefix = (long: string[], short: string[]) =>
    long.length > short.length && long.slice(0, short.length).join(" ") === short.join(" ");
  const arrA = na.split(" ");
  const arrB = nb.split(" ");
  if (prefix(arrA, arrB) || prefix(arrB, arrA)) return Math.max(jaccard, 0.75);
  return jaccard;
}

// Best anime candidate for a manga title. `aliases` are extra names the
// catalogue already resolved (romaji, translated), searched alongside the
// display title so a romanised lookup still lands.
export async function findAnimeMatch(
  mangaTitle: string,
  aliases: string[] = []
): Promise<{ anime: AnimeSearchResult; score: number } | null> {
  const queries = [mangaTitle, ...aliases].map((q) => q.trim()).filter(Boolean).slice(0, 3);
  if (!queries.length) return null;

  const seen = new Map<string, AnimeSearchResult>();
  for (const q of queries) {
    for (const r of await searchAnime(q)) if (!seen.has(r.id)) seen.set(r.id, r);
    // A perfect match on the first query cannot be beaten by a later one.
    if (Array.from(seen.values()).some((r) => titleSimilarity(r.title, q) === 1)) break;
  }

  let best: { anime: AnimeSearchResult; score: number } | null = null;
  for (const anime of seen.values()) {
    let score = 0;
    for (const q of queries) {
      score = Math.max(score, titleSimilarity(anime.title, q));
      if (anime.japaneseTitle) score = Math.max(score, titleSimilarity(anime.japaneseTitle, q));
    }
    if (!best || score > best.score) best = { anime, score };
  }
  // Below this the "match" is a coincidence (a shared common word), so the UI
  // would rather show nothing than send the reader to the wrong series.
  if (!best || best.score < 0.6) return null;
  return best;
}

// ─── HLS playlist rewriting ───────────────────────────────
//
// The relay in /api/anime/hls fetches a playlist or segment and, for a
// playlist, rewrites every child URI back through itself. Relative URIs resolve
// against the playlist's own URL, which is why the original is passed in.

const URI_ATTR = /URI="([^"]+)"/;

function rewriteUri(uri: string, base: string, proxyPath: string): string {
  const abs = new URL(uri, base).href;
  return `${proxyPath}?url=${encodeURIComponent(abs)}`;
}

export function rewritePlaylist(body: string, base: string, proxyPath = "/api/anime/hls"): string {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }
    if (trimmed.startsWith("#")) {
      // EXT-X-KEY / EXT-X-MAP carry a URI attribute that also has to be relayed,
      // otherwise a keyed stream fails to decrypt through the proxy.
      const m = trimmed.match(URI_ATTR);
      if (m) out.push(trimmed.replace(URI_ATTR, `URI="${rewriteUri(m[1], base, proxyPath)}"`));
      else out.push(trimmed);
      continue;
    }
    out.push(rewriteUri(trimmed, base, proxyPath));
  }
  return out.join("\n");
}

// True when a body is an HLS playlist. The CDN labels playlists and segments
// alike as image/jpeg, so the Content-Type cannot be trusted and the body's
// magic must be checked instead.
export function isPlaylist(body: string, contentType: string): boolean {
  if (body.startsWith("#EXTM3U")) return true;
  return /mpegurl/i.test(contentType);
}
