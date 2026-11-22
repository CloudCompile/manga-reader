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
  // The streaming host this hit came from. Ids are not portable between hosts,
  // so a hit with a provider is read and streamed through
  // /api/providers/<provider>/… rather than the native /api/info route.
  provider?: string;
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
  // Opaque id the stream endpoint expects; already carries the "?ep=" suffix on
  // the native source, and is the host's own episode id on a provider.
  id: string;
  num: number;
  title: string;
  filler: boolean;
  subbed: boolean;
  dubbed: boolean;
  // Present when the episode belongs to a provider rather than the native API.
  provider?: string;
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
  // The player origin the manifest CDN requires. Sent to /api/anime/hls so the
  // relay and every child request keep it; the CDN answers 403 without it.
  referer?: string;
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
  slug?: unknown;
  title?: unknown;
  japanese_title?: unknown;
  japaneseTitle?: unknown;
  poster?: unknown;
  showType?: unknown;
  type?: unknown;
  subEpisodes?: unknown;
  dubEpisodes?: unknown;
  tvInfo?: { showType?: unknown; sub?: unknown; dub?: unknown; eps?: unknown };
}

export function parseSearchItem(raw: RawSearchItem): AnimeSearchResult | null {
  const id = asString(raw.id);
  const title = asString(raw.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    japaneseTitle: asString(raw.japanese_title) || asString(raw.japaneseTitle),
    poster: asString(raw.poster),
    showType: asString(raw.showType) || asString(raw.type) || asString(raw.tvInfo?.showType),
    subEpisodes: asString(raw.tvInfo?.sub) || asString(raw.subEpisodes),
    dubEpisodes: asString(raw.tvInfo?.dub) || asString(raw.dubEpisodes),
  };
}

// The search endpoint now fans out over several providers and reports each one
// under `sources[].results`, leaving the flat `data` array empty. Flatten both
// shapes so a provider rollback does not empty the picker again.
interface RawSearchResults {
  data?: RawSearchItem[];
  sources?: { provider?: unknown; results?: RawSearchItem[] }[];
}

export async function searchAnime(query: string): Promise<AnimeSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const results = await apiGet<RawSearchResults>("search", { keyword: q });
  const items: { item: RawSearchItem; provider?: string }[] = [];
  if (Array.isArray(results?.data)) {
    for (const item of results.data) items.push({ item });
  }
  for (const source of results?.sources || []) {
    if (!Array.isArray(source?.results)) continue;
    const provider = asString(source.provider);
    for (const item of source.results) {
      items.push({ item, provider: provider && provider !== "aniwaves" ? provider : undefined });
    }
  }
  // The same show can appear on several hosts with different ids, so the key
  // includes the provider: both entries stay selectable.
  const seen = new Set<string>();
  const out: AnimeSearchResult[] = [];
  for (const { item, provider } of items) {
    const parsed = parseSearchItem(item);
    if (!parsed) continue;
    if (provider) parsed.provider = provider;
    const key = `${provider || "native"}:${parsed.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }
  return out;
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

// Every provider action returns `{ provider, action, data, total }`; the useful
// part is `data`.
interface ProviderEnvelope<T> {
  provider?: string;
  action?: string;
  data?: T;
  total?: number;
}

async function providerGet<T>(
  provider: string,
  action: string,
  params: Record<string, string | undefined>
): Promise<T | null> {
  const result = await apiGet<ProviderEnvelope<T>>(
    `providers/${encodeURIComponent(provider)}/${action}`,
    params
  );
  return result && result.data !== undefined ? result.data : null;
}

// The streaming providers expose a flatter detail object than `/api/info`'s
// `animeInfo` block, so it is mapped separately.
export interface RawProviderAnime {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  japaneseTitle?: unknown;
  poster?: unknown;
  description?: unknown;
  type?: unknown;
  rating?: unknown;
  status?: unknown;
  score?: unknown;
  aired?: unknown;
  duration?: unknown;
  episodes?: unknown;
  subEpisodes?: unknown;
  dubEpisodes?: unknown;
  genres?: unknown;
  studios?: unknown;
  producers?: unknown;
}

export function parseProviderAnime(raw: RawProviderAnime, fallbackId = ""): AnimeInfo | null {
  const title = asString(raw.title);
  if (!title) return null;
  const rating = asString(raw.rating) || "";
  return {
    id: asString(raw.id) || fallbackId,
    title,
    japaneseTitle: asString(raw.japaneseTitle),
    poster: asString(raw.poster),
    showType: asString(raw.type),
    overview: asString(raw.description),
    status: asString(raw.status),
    score: asString(raw.score),
    duration: asString(raw.duration),
    episodes: asString(raw.episodes),
    dateAired: asString(raw.aired),
    studios: asStringList(raw.studios),
    producers: asStringList(raw.producers),
    genres: asStringList(raw.genres),
    subEpisodes: asString(raw.subEpisodes),
    dubEpisodes: asString(raw.dubEpisodes),
    adult: /(^|\b)(R\+|R17|Rx)(\b|$)/i.test(rating),
  };
}

export async function animeInfo(id: string, provider?: string): Promise<AnimeInfo | null> {
  if (provider) {
    const raw = await providerGet<RawProviderAnime>(provider, "anime", { id });
    return raw ? parseProviderAnime(raw, id) : null;
  }
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

export interface RawProviderEpisode {
  id?: unknown;
  number?: unknown;
  title?: unknown;
  japaneseTitle?: unknown;
  slug?: unknown;
}

// Provider episode ids are opaque host-local strings (numeric on the
// otakuthemes hosts), not the native `"<animeId>?ep=<id>_<n>"` form, so they
// are passed back to the provider's stream route verbatim.
export function parseProviderEpisodes(raw: unknown, provider: string): AnimeEpisode[] {
  if (!Array.isArray(raw)) return [];
  const out: AnimeEpisode[] = [];
  for (const row of raw as RawProviderEpisode[]) {
    const id = asString(row.id);
    const num = typeof row.number === "number" ? row.number : Number(asString(row.number));
    if (!id || !isFinite(num)) continue;
    out.push({
      id,
      num,
      title: asString(row.title) || `Episode ${num}`,
      filler: false,
      subbed: true,
      dubbed: false,
      provider,
    });
  }
  out.sort((a, b) => a.num - b.num);
  return out;
}

export async function animeEpisodes(id: string, provider?: string): Promise<AnimeEpisode[]> {
  if (provider) {
    const rows = await providerGet<unknown>(provider, "episodes", { id });
    return parseProviderEpisodes(rows, provider);
  }
  // `episodes/<id>` takes the id in the path, not as a query parameter.
  const result = await apiGetPath<{ episodes?: unknown }>(`episodes/${encodeURIComponent(id)}`);
  return parseEpisodes(result?.episodes);
}

// ─── Stream ───────────────────────────────────────────────

interface RawStreamLink {
  iframe?: unknown;
  link?: { file?: unknown; type?: unknown };
  server?: unknown;
  headers?: unknown;
}

export interface RawStream {
  // Either a single link (older API) or a list of per-server links.
  streamingLink?: RawStreamLink | RawStreamLink[];
  servers?: { type?: unknown; serverName?: unknown; server_name?: unknown }[];
}

export function parseStream(result: unknown, requestedServer?: string): AnimeStream | null {
  if (!result || typeof result !== "object") return null;
  const r = result as RawStream;
  const links = Array.isArray(r.streamingLink)
    ? r.streamingLink
    : r.streamingLink
      ? [r.streamingLink]
      : [];
  const servers: AnimeServer[] = [];
  for (const s of r.servers || []) {
    const name = asString(s.serverName) || asString(s.server_name);
    if (!name) continue;
    if (!servers.some((x) => x.name === name)) servers.push({ type: asString(s.type) || "sub", name });
  }
  const link = links.find((l) => requestedServer && asString(l.server) === requestedServer) || links[0] || {};
  const file = asString(link.link?.file);
  const iframe = asString(link.iframe);
  const chosen = asString(link.server) || requestedServer || "";
  const headers = (link.headers ?? {}) as Record<string, unknown>;
  const referer = asString(headers.Referer) || asString(headers.referer);
  // Prefer the relayable playlist; the iframe is only used when the upstream
  // gave us nothing else, since embedding an unknown third party is a worse
  // experience (ads, no quality control, and it can refuse to frame).
  if (file) return { kind: "hls", url: file, server: chosen, servers, ...(referer ? { referer } : {}) };
  if (iframe) return { kind: "iframe", url: iframe, server: chosen, servers, ...(referer ? { referer } : {}) };
  return { kind: "hls", url: "", server: chosen, servers };
}

interface RawProviderServer {
  type?: unknown;
  name?: unknown;
  serverName?: unknown;
}

interface RawProviderStream {
  server?: unknown;
  iframe?: unknown;
  link?: { file?: unknown; type?: unknown };
  headers?: Record<string, unknown> | unknown;
}

// Host-local server lists, used both for the player's server picker and to
// retry when the default server only offers an embed.
function parseProviderServers(raw: unknown): AnimeServer[] {
  if (!Array.isArray(raw)) return [];
  const out: AnimeServer[] = [];
  for (const row of raw as RawProviderServer[]) {
    const name = asString(row.name) || asString(row.serverName);
    if (!name || out.some((s) => s.name === name)) continue;
    out.push({ type: asString(row.type) || "sub", name });
  }
  return out;
}

function parseProviderStream(raw: RawProviderStream, servers: AnimeServer[]): AnimeStream {
  const file = asString(raw.link?.file);
  const iframe = asString(raw.iframe);
  const headers = (raw.headers ?? {}) as Record<string, unknown>;
  const referer = asString(headers.Referer) || asString(headers.referer);
  return {
    kind: file ? "hls" : "iframe",
    url: file || iframe || "",
    server: asString(raw.server) || "",
    servers,
    ...(referer ? { referer } : {}),
  };
}

// The first server these hosts advertise is usually an embed-only player, so a
// request without an explicit server retries these known HLS-capable names.
const PROVIDER_HLS_SERVERS = ["HD-1", "HD-2", "Vidstream-2"];

export async function animeStream(
  episodeId: string,
  server?: string,
  provider?: string
): Promise<AnimeStream | null> {
  if (provider) {
    const serverRows = await providerGet<unknown>(provider, "servers", { id: episodeId }).catch(
      () => null
    );
    const servers = parseProviderServers(serverRows);
    const load = async (name?: string): Promise<AnimeStream | null> => {
      const raw = await providerGet<RawProviderStream>(provider, "stream", {
        id: episodeId,
        server: name,
        type: "sub",
      });
      return raw ? parseProviderStream(raw, servers) : null;
    };

    let result = await load(server);
    if (!result) return null;
    if (!server && result.kind !== "hls") {
      for (const name of PROVIDER_HLS_SERVERS) {
        const alt = await load(name).catch(() => null);
        if (alt && alt.kind === "hls" && alt.url) {
          result = alt;
          break;
        }
      }
    }
    return result;
  }

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

function rewriteUri(uri: string, base: string, proxyPath: string, referer?: string): string {
  const abs = new URL(uri, base).href;
  // Child requests must keep the referer: the CDN rejects a segment fetched
  // without it, and each rewritten URI is a separate request to the relay.
  const suffix = referer ? `&ref=${encodeURIComponent(referer)}` : "";
  return `${proxyPath}?url=${encodeURIComponent(abs)}${suffix}`;
}

export function rewritePlaylist(
  body: string,
  base: string,
  proxyPath = "/api/anime/hls",
  referer?: string
): string {
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
      if (m) out.push(trimmed.replace(URI_ATTR, `URI="${rewriteUri(m[1], base, proxyPath, referer)}"`));
      else out.push(trimmed);
      continue;
    }
    out.push(rewriteUri(trimmed, base, proxyPath, referer));
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
