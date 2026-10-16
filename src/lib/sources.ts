// Multi-source manga scraping library.
//
// Each site is described by a Source object. Sites that serve plain HTML
// (WordPress manga themes / Blogger) are scraped from markup; sites that render
// client-side (allmanga.to) expose a GraphQL API instead.
//
// A CORS/captcha worker proxy is used as a fallback whenever a direct fetch is
// blocked (Cloudflare "Just a moment..." interstitials, bot walls, ...).

export interface RawChapter {
  title: string;
  mangaName: string;
  chapterNum: string;
  images: string[];
  prevUrl: string | null;
  nextUrl: string | null;
  warning?: string;
}

export interface ChapterData extends RawChapter {
  seriesSlug: string;
  sourceId: string;
  sourceName: string;
}

export interface ChapterItem {
  num: number;
  url: string;
  title: string;
}

export interface ChapterListData {
  mangaName: string;
  chapters: ChapterItem[];
}

export interface SearchResult {
  title: string;
  latestChapter: string;
  url: string;
  source: string;
}

interface Source {
  id: string;
  name: string;
  hosts: RegExp[];
  // Identifies the series a chapter URL belongs to (used to group chapters).
  seriesKey: (url: string) => string;
  // Parser for a fetched chapter page.
  parseChapter?: (html: string, url: string) => RawChapter;
  // Custom chapter fetch (non-HTML protocols, e.g. GraphQL).
  fetchChapter?: (url: string) => Promise<RawChapter>;
  // Pages that list the chapters of the series.
  listingUrls?: (url: string) => string[];
  // Parser for a listing page.
  parseList?: (html: string, url: string) => ChapterItem[];
  // Custom list fetch.
  fetchList?: (url: string) => Promise<{ chapters: ChapterItem[]; mangaName?: string }>;
  // Custom search.
  search?: (query: string) => Promise<SearchResult[]>;
}

export const PROXY_BASE =
  process.env.CORS_PROXY || "https://cors-proxy.christopher-j-hauser2025.workers.dev";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// ───────────────────────────────────────────────────────────
// Small HTML / URL helpers
// ───────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  if (!s) return "";
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8216;/g, "\u2018")
    .replace(/&#8211;/g, "\u2013")
    .replace(/&#8212;/g, "\u2014")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function toAbs(href: string, base: string): string {
  const clean = decodeEntities(href.trim());
  if (!clean) return "";
  try {
    return new URL(clean, base).href;
  } catch {
    return clean;
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin + "/";
  } catch {
    return url;
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    let s = u.href;
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return url.replace(/\/$/, "").toLowerCase();
  }
}

function attr(tag: string, name: string): string {
  const re = new RegExp(name + `\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const m = tag.match(re);
  return m ? decodeEntities(m[1] ?? m[2] ?? "") : "";
}

const JUNK =
  /(icon|logo|avatar|emoji|button|banner|sprite|placeholder|loading|spacer|1x1|pixel|tracking|gravatar|favicon|cup-border|ko-fi|googletagmanager|misweenownself|grop\.net|aqle3|doubleclick|adservice)/i;

const IMG_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;

function pickImages(
  html: string,
  opts: { hosts?: string[]; altRe?: RegExp | null; base?: string } = {}
): string[] {
  const { hosts = [], altRe = null, base = "" } = opts;
  const tags = html.match(/<img\b[^>]*>/gi) || [];
  const found: { url: string; alt: string; n: number; i: number }[] = [];
  const attrs = ["src", "data-src", "data-lazy-src", "data-original", "data-image-url", "data-cfsrc"];
  let i = 0;
  for (const tag of tags) {
    const alt = attr(tag, "alt");
    if (altRe && !altRe.test(alt)) continue;
    let url = "";
    for (const a of attrs) {
      const v = attr(tag, a);
      if (!v || /^data:/i.test(v)) continue;
      const abs = toAbs(v, base);
      if (!/^https?:/i.test(abs)) continue;
      if (!IMG_EXT.test(abs) && !hosts.some((h) => abs.includes(h))) continue;
      url = abs;
      break;
    }
    if (!url) continue;
    if (hosts.length && !hosts.some((h) => url.includes(h))) continue;
    if (JUNK.test(url)) continue;
    const nm = alt.match(/image\s*([0-9]+)/i);
    found.push({ url, alt, n: nm ? parseInt(nm[1], 10) : NaN, i: i++ });
  }

  // If most images carry an explicit "image NN" alt, trust that ordering.
  const numbered = found.filter((f) => !isNaN(f.n)).length;
  if (numbered >= Math.max(2, Math.floor(found.length * 0.5))) {
    found.sort((a, b) => (isNaN(a.n) ? a.i : a.n) - (isNaN(b.n) ? b.i : b.n));
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of found) {
    const key = f.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f.url);
  }
  return out;
}

function relNav(html: string): { prev: string | null; next: string | null } {
  let prev: string | null = null;
  let next: string | null = null;
  const tags = html.match(/<a\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const rel = attr(tag, "rel").toLowerCase();
    const href = attr(tag, "href");
    if (!href) continue;
    if (rel.split(/\s+/).includes("prev") && !prev) prev = href;
    if (rel.split(/\s+/).includes("next") && !next) next = href;
  }
  return { prev, next };
}

function navButton(html: string, label: RegExp): string | null {
  const re = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = stripTags(m[1]);
    if (label.test(text)) {
      const href = attr(m[0], "href");
      if (href && /chapter/i.test(href)) return decodeEntities(href);
    }
  }
  return null;
}

function pageTitle(html: string): { title: string; h1: string } {
  const title = decodeEntities((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "").trim();
  const h1 = stripTags(decodeEntities((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || ""));
  return { title, h1 };
}

// "Blue Box, Chapter 0 - Blue Box Manga Online" -> { mangaName, chapterNum }
function parseChapterTitle(raw: string): { mangaName: string; chapterNum: string } {
  let s = decodeEntities(raw)
    .replace(/\s*[-|\u2013]\s*[^-|\u2013]*Manga Online.*$/i, "")
    .replace(/\s*\|\s*.*$/, "")
    .replace(/\s*Manga Online\s*$/i, "")
    .trim();
  const m = /^(.*?)[,:;\s\u2013-]*?\bchapter\s*([0-9]+(?:[.-][0-9]+)?)/i.exec(s);
  if (m) {
    const name = m[1].replace(/[,\s\u2013-]+$/, "").trim();
    return { mangaName: name || s, chapterNum: m[2] };
  }
  return { mangaName: s, chapterNum: "" };
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function numFromSlug(slug: string): number {
  const n = parseFloat(slug.replace(/-/g, "."));
  return isNaN(n) ? 0 : n;
}

function chapterLabel(num: number, fallback: string): string {
  const label = fallback || String(num);
  return `Chapter ${label}`;
}

// "the-fragrant-flower-blooms-with-dignity" -> "The Fragrant Flower Blooms With Dignity"
function titleFromSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Extract chapter links matching `slug-chapter-<num>` from `html`. A null slug
// matches any series; `host` is a regex fragment for the domain.
function chapterLinks(
  html: string,
  slug: string | null,
  host: string,
  pathSegment: "manga" | "comic" | "any" = "any"
): ChapterItem[] {
  const seg = pathSegment === "any" ? "(?:manga|comic)" : pathSegment;
  const slugPart = slug ? escapeReg(slug) : "[^/]+?";
  const re = new RegExp(
    `href=["'](https?://(?:[a-z0-9-]+\\.)*${host}/${seg}/${slugPart}-chapter-([0-9]+(?:[.-][0-9]+)?)/?)["']`,
    "gi"
  );
  const map = new Map<string, ChapterItem>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[2];
    const num = numFromSlug(raw);
    const url = `${m[1].replace(/&amp;/g, "&").replace(/\/$/, "")}/`;
    if (map.has(url)) continue;
    map.set(url, { num, url, title: chapterLabel(num, raw) });
  }
  return Array.from(map.values());
}

// ───────────────────────────────────────────────────────────
// Fetching (direct, with proxy fallback)
// ───────────────────────────────────────────────────────────

interface FetchResult {
  ok: boolean;
  status: number;
  text: string;
}

async function directFetch(target: string, referer?: string): Promise<FetchResult> {
  const res = await fetch(target, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...(referer ? { Referer: referer } : {}),
    },
    redirect: "follow",
    cache: "no-store",
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

function looksBlocked(r: FetchResult): boolean {
  if (!r.ok) return true;
  const head = r.text.slice(0, 600).toLowerCase();
  return (
    head.includes("just a moment") ||
    head.includes("enable javascript and cookies") ||
    head.includes("attention required") ||
    head.includes("cf-mitigated") ||
    (r.text.length < 4000 && head.includes("cloudflare"))
  );
}

async function proxyFetch(
  target: string,
  init: { method?: string; referer?: string; body?: string } = {}
): Promise<FetchResult> {
  const proxied = `${PROXY_BASE}/?url=${encodeURIComponent(target)}`;
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  };
  if (init.referer) headers.Referer = init.referer;
  if (init.body) headers["Content-Type"] = "application/json";
  const res = await fetch(proxied, {
    method: init.method || "GET",
    headers,
    body: init.body,
    cache: "no-store",
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

async function fetchText(
  target: string,
  opts: { referer?: string; forceProxy?: boolean } = {}
): Promise<string> {
  if (!opts.forceProxy) {
    try {
      const r = await directFetch(target, opts.referer);
      if (!looksBlocked(r)) return r.text;
    } catch {
      /* fall through to proxy */
    }
  }
  const pr = await proxyFetch(target, { referer: opts.referer });
  if (!pr.ok) throw new Error(`Failed to fetch ${target} (HTTP ${pr.status})`);
  return pr.text;
}

// ───────────────────────────────────────────────────────────
// Sources
// ───────────────────────────────────────────────────────────

const GENERIC_SLUG = (url: string): string => {
  const m = url.match(/(?:manga|comic)\/(.+?)-chapter-([0-9]+(?:[.-][0-9]+)?)/i);
  return m ? m[1] : "";
};

const GENERIC_NUM = (url: string): string => {
  const m = url.match(/-chapter-([0-9]+(?:[.-][0-9]+)?)/i);
  return m ? m[1].replace(/-/g, ".") : "";
};

// mangafragrant.com — the original source.
const mangafragrant: Source = {
  id: "mangafragrant",
  name: "MangaFragrant",
  hosts: [/mangafragrant(flower)?\.com$/i],
  seriesKey: GENERIC_SLUG,
  listingUrls: () => ["https://www.mangafragrant.com/manga/"],
  parseChapter(html, url) {
    const { title, h1 } = pageTitle(html);
    const parsed = parseChapterTitle(h1 || title);
    const images = pickImages(html, { hosts: ["contabostorage.com"], altRe: /image\s*\d+/i, base: url });
    const nav = relNav(html);
    // rel=prev is the lower chapter, rel=next the higher one.
    return {
      title,
      mangaName: parsed.mangaName,
      chapterNum: GENERIC_NUM(url) || parsed.chapterNum,
      images,
      prevUrl: nav.prev,
      nextUrl: nav.next,
    };
  },
  parseList(html) {
    return chapterLinks(html, null, "mangafragrantflower?\\.com", "manga").map((c) => c);
  },
  search: undefined,
};

// Read Komi Can't Communicate chapters.
const komic: Source = {
  id: "komic",
  name: "Komi Can't Communicate",
  hosts: [/komicantcommunicatechapters\.website$/i],
  seriesKey: GENERIC_SLUG,
  listingUrls: () => ["https://komicantcommunicatechapters.website/"],
  parseChapter(html, url) {
    const { title, h1 } = pageTitle(html);
    const parsed = parseChapterTitle(h1 || title);
    const images = pickImages(html, { hosts: ["tsukiread.com"], altRe: /image\s*\d+/i, base: url });
    const nav = relNav(html);
    // rel=next points to the higher chapter; prev is derived from the list later.
    return {
      title,
      mangaName: parsed.mangaName,
      chapterNum: GENERIC_NUM(url) || parsed.chapterNum,
      images,
      prevUrl: nav.prev,
      nextUrl: nav.next,
    };
  },
  parseList(html) {
    return chapterLinks(html, null, "komicantcommunicatechapters\\.website", "manga");
  },
};

// blue-box-manga.online
const bluebox: Source = {
  id: "bluebox",
  name: "Blue Box",
  hosts: [/blue-box-manga\.online$/i],
  seriesKey: GENERIC_SLUG,
  listingUrls: () => ["https://blue-box-manga.online/comic/"],
  parseChapter(html, url) {
    const { title, h1 } = pageTitle(html);
    const parsed = parseChapterTitle(h1 || title);
    const images = pickImages(html, { hosts: ["laiond.com"], altRe: /image\s*\d+/i, base: url });
    return {
      title,
      mangaName: parsed.mangaName,
      chapterNum: GENERIC_NUM(url) || parsed.chapterNum,
      images,
      prevUrl: null,
      nextUrl: null,
    };
  },
  parseList(html, url) {
    // The listing page and each chapter page both embed a <select> of chapters.
    const items = chapterLinks(html, null, "blue-box-manga\\.online", "comic");
    const re = /<option[^>]*value=["'](https?:\/\/[^"']*blue-box-manga\.online\/comic\/[^"']+-chapter-([0-9]+(?:[.-][0-9]+)?)\/?)["']/gi;
    let m: RegExpExecArray | null;
    const map = new Map(items.map((c) => [c.url, c]));
    while ((m = re.exec(html)) !== null) {
      const num = numFromSlug(m[2]);
      const u = `${m[1].replace(/&amp;/g, "&").replace(/\/$/, "")}/`;
      map.set(u, { num, url: u, title: chapterLabel(num, m[2]) });
    }
    void url;
    return Array.from(map.values());
  },
};

// dandadana.com
const dandadana: Source = {
  id: "dandadana",
  name: "Dandadan",
  hosts: [/dandadana\.com$/i],
  seriesKey: GENERIC_SLUG,
  listingUrls: () => ["https://dandadana.com/"],
  parseChapter(html, url) {
    const { title, h1 } = pageTitle(html);
    const parsed = parseChapterTitle(h1 || title);
    const images = pickImages(html, { hosts: ["readkakegurui.com"], altRe: /chapter/i, base: url });
    const next = navButton(html, /next\s+chapter/i);
    const prev = navButton(html, /previous\s+chapter/i);
    return {
      title,
      mangaName: parsed.mangaName,
      chapterNum: GENERIC_NUM(url) || parsed.chapterNum,
      images,
      prevUrl: prev,
      nextUrl: next,
    };
  },
  parseList(html) {
    return chapterLinks(html, null, "dandadana\\.com", "manga");
  },
};

// readoshino.com (Blogger-hosted pages)
const oshino: Source = {
  id: "oshino",
  name: "Oshi No Ko",
  hosts: [/readoshino\.com$/i],
  seriesKey: GENERIC_SLUG,
  listingUrls: () => ["https://readoshino.com/"],
  parseChapter(html, url) {
    const { title, h1 } = pageTitle(html);
    const parsed = parseChapterTitle(h1 || title);
    const images = pickImages(html, { hosts: ["blogger.googleusercontent.com"], base: url });
    const nav = relNav(html);
    // On this theme rel=next points to the lower chapter and rel=prev to the
    // higher one, so the mapping is inverted relative to the usual convention.
    return {
      title,
      mangaName: parsed.mangaName,
      chapterNum: GENERIC_NUM(url) || parsed.chapterNum,
      images,
      prevUrl: nav.next,
      nextUrl: nav.prev,
    };
  },
  parseList(html) {
    return chapterLinks(html, null, "readoshino\\.com", "manga");
  },
};

// onlinechainsawmanmanga.us (origin is frequently offline)
const chainsawman: Source = {
  id: "chainsawman",
  name: "Chainsaw Man",
  hosts: [/onlinechainsawmanmanga\.us$/i],
  seriesKey: GENERIC_SLUG,
  listingUrls: () => ["https://onlinechainsawmanmanga.us/"],
  parseChapter(html, url) {
    const { title, h1 } = pageTitle(html);
    const parsed = parseChapterTitle(h1 || title);
    const images = pickImages(html, { altRe: /image\s*\d+/i, base: url });
    const nav = relNav(html);
    const next = nav.next || navButton(html, /next\s+chapter/i);
    const prev = nav.prev || navButton(html, /previous\s+chapter/i);
    return {
      title,
      mangaName: parsed.mangaName,
      chapterNum: GENERIC_NUM(url) || parsed.chapterNum,
      images,
      prevUrl: prev,
      nextUrl: next,
    };
  },
  parseList(html) {
    return chapterLinks(html, null, "onlinechainsawmanmanga\\.us", "any");
  },
};

// ── allmanga.to — GraphQL backed ───────────────────────────
const ALLMANGA_API = "https://api.allanime.day/api";

async function allmangaGql<T = unknown>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await proxyFetch(ALLMANGA_API, {
    method: "POST",
    referer: "https://allmanga.to/",
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`allmanga API request failed (HTTP ${res.status})`);
  let json: { data?: T; errors?: { message?: string }[] };
  try {
    json = JSON.parse(res.text);
  } catch {
    throw new Error("allmanga API returned an unreadable response");
  }
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join("; ");
    if (/NEED_CAPTCHA/i.test(msg)) {
      throw new Error(
        "allmanga.to requires a captcha to read page images from the server. Open the chapter on allmanga.to to solve it."
      );
    }
    throw new Error(`allmanga API error: ${msg}`);
  }
  return json.data as T;
}

const ALLMANGA_MANGA_QUERY =
  "query($_id:String!){manga(_id:$_id){_id name thumbnail availableChapters availableChaptersDetail}}";

const ALLMANGA_SEARCH_QUERY =
  "query($search:SearchInput,$limit:Int){mangas(search:$search,limit:$limit){edges{_id name thumbnail availableChapters}}}";

const ALLMANGA_PAGES_QUERY =
  "query($mangaId:String!,$translationType:VaildTranslationTypeMangaEnumType!,$chapterString:String!,$page:Int,$limit:Int,$offset:Int){chapterPages(mangaId:$mangaId,translationType:$translationType,chapterString:$chapterString,page:$page,limit:$limit,offset:$offset){edges{streamerId sourceUrl sourceName chapterString pictureUrls pictureUrlsProcessed pictureUrlHead}pageInfo{total}}}";

interface AllMangaDetail {
  _id: string;
  name: string;
  availableChapters?: Record<string, number>;
  availableChaptersDetail?: Record<string, string[]>;
}
interface AllMangaPages {
  chapterPages: {
    edges: { pictureUrls?: string[]; pictureUrlsProcessed?: string[]; pictureUrlHead?: string }[];
    pageInfo?: { total?: number };
  } | null;
}

function allmangaParts(url: string): { id: string; chapter: string; type: string } {
  const ch = url.match(/\/chapter-([^/]+?)-(sub|raw)\/?$/i);
  let id = "";
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    // /manga/<id>/chapter-...   or   /read/<id>/<slug>/chapter-...
    id = parts[1] || "";
  } catch {
    /* ignore */
  }
  return { id, chapter: ch ? ch[1] : "", type: ch ? ch[2].toLowerCase() : "sub" };
}

const allmanga: Source = {
  id: "allmanga",
  name: "AllManga",
  hosts: [/allmanga\.to$/i],
  seriesKey: (url) => allmangaParts(url).id,
  async fetchChapter(url): Promise<RawChapter> {
    const { id, chapter, type } = allmangaParts(url);
    if (!id) throw new Error("Could not determine allmanga manga id from URL");
    const detail = await allmangaGql<{ manga: AllMangaDetail }>(ALLMANGA_MANGA_QUERY, { _id: id });
    const manga = detail.manga;
    const chapters = manga?.availableChaptersDetail?.[type] || [];

    let images: string[] = [];
    let warning: string | undefined;
    if (chapter) {
      try {
        const pages = await allmangaGql<AllMangaPages>(ALLMANGA_PAGES_QUERY, {
          mangaId: id,
          translationType: type,
          chapterString: chapter,
          page: 1,
          limit: 100,
          offset: 0,
        });
        const edge = pages.chapterPages?.edges?.[0];
        if (edge) images = collectAllMangaImages(edge);
      } catch (err) {
        // allmanga gates page images behind a captcha. Surfacing the chapter
        // title and navigation is still useful, so record the reason instead
        // of failing the whole request.
        warning = err instanceof Error ? err.message : "Could not load page images.";
      }
    }

    const idx = chapters.indexOf(chapter);
    const higher = idx > 0 ? chapters[idx - 1] : null; // list is newest-first
    const lower = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null;
    const link = (c: string | null) => (c ? `https://allmanga.to/manga/${id}/chapter-${c}-${type}` : null);

    return {
      title: chapter ? `${manga?.name || "Manga"} Chapter ${chapter}` : manga?.name || "Manga",
      mangaName: manga?.name || "Manga",
      chapterNum: chapter,
      images,
      prevUrl: link(lower),
      nextUrl: link(higher),
      warning,
    };
  },
  async fetchList(url): Promise<{ chapters: ChapterItem[]; mangaName?: string }> {
    const { id, type } = allmangaParts(url);
    if (!id) return { chapters: [] };
    const detail = await allmangaGql<{ manga: AllMangaDetail }>(ALLMANGA_MANGA_QUERY, { _id: id });
    const chapters = detail.manga?.availableChaptersDetail?.[type] || [];
    return {
      mangaName: detail.manga?.name,
      chapters: chapters.map((c) => ({
        num: numFromSlug(c),
        url: `https://allmanga.to/manga/${id}/chapter-${c}-${type}`,
        title: chapterLabel(numFromSlug(c), c),
      })),
    };
  },
  async search(query): Promise<SearchResult[]> {
    const data = await allmangaGql<{ mangas: { edges: { _id: string; name: string; availableChapters?: Record<string, number> }[] } }>(
      ALLMANGA_SEARCH_QUERY,
      { search: { query }, limit: 24 }
    );
    return (data.mangas?.edges || []).map((e) => {
      const count = e.availableChapters?.sub || e.availableChapters?.raw || 0;
      return {
        title: e.name,
        latestChapter: count ? `Ch ${count}` : "",
        url: `https://allmanga.to/manga/${e._id}`,
        source: "AllManga",
      };
    });
  },
};

function collectAllMangaImages(edge: {
  pictureUrls?: string[];
  pictureUrlsProcessed?: string[];
  pictureUrlHead?: string;
}): string[] {
  if (edge.pictureUrlsProcessed?.length) return edge.pictureUrlsProcessed.filter(Boolean);
  const head = edge.pictureUrlHead || "";
  return (edge.pictureUrls || [])
    .filter(Boolean)
    .map((u) => (/^https?:/i.test(u) ? u : head + u));
}

export const SOURCES: Source[] = [
  mangafragrant,
  komic,
  bluebox,
  dandadana,
  oshino,
  chainsawman,
  allmanga,
];

export function getSource(url: string): Source | null {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  return SOURCES.find((s) => s.hosts.some((h) => h.test(host))) || null;
}

export function isSupported(url: string): boolean {
  return getSource(url) !== null;
}

// ───────────────────────────────────────────────────────────
// Public operations
// ───────────────────────────────────────────────────────────

const CHAPTER_CACHE = new Map<string, { data: ChapterData; ts: number }>();
const LIST_CACHE = new Map<string, { data: ChapterListData; ts: number }>();
const SEARCH_CACHE = new Map<string, { data: SearchResult[]; ts: number }>();
const TTL = 10 * 60 * 1000;

function fillNavFromList(raw: RawChapter, chapters: ChapterItem[], url: string): void {
  if (!chapters.length) return;
  const want = normalizeUrl(url);
  let idx = chapters.findIndex((c) => normalizeUrl(c.url) === want);
  if (idx === -1) {
    const n = numFromSlug(raw.chapterNum);
    idx = chapters.findIndex((c) => c.num === n);
  }
  if (idx === -1) return;
  // chapters are sorted newest-first: the next (higher) chapter precedes.
  if (!raw.nextUrl && idx > 0) raw.nextUrl = chapters[idx - 1].url;
  if (!raw.prevUrl && idx < chapters.length - 1) raw.prevUrl = chapters[idx + 1].url;
}

export async function scrapeChapter(url: string): Promise<ChapterData> {
  const cached = CHAPTER_CACHE.get(url);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const source = getSource(url);
  if (!source) throw new Error("This site is not supported yet.");

  let raw: RawChapter;
  if (source.fetchChapter) {
    raw = await source.fetchChapter(url);
  } else if (source.parseChapter) {
    const html = await fetchText(url, { referer: originOf(url) });
    raw = source.parseChapter(html, url);
    if ((!raw.prevUrl || !raw.nextUrl) && (source.parseList || source.fetchList)) {
      try {
        const list = await fetchChapterList(url);
        fillNavFromList(raw, list.chapters, url);
      } catch {
        /* navigation is best-effort */
      }
    }
  } else {
    throw new Error("This site is not supported yet.");
  }

  const data: ChapterData = {
    ...raw,
    seriesSlug: source.seriesKey(url),
    sourceId: source.id,
    sourceName: source.name,
  };
  if (data.images.length === 0) {
    data.warning = data.warning || "No images found. This chapter may not be available yet.";
  }
  CHAPTER_CACHE.set(url, { data, ts: Date.now() });
  return data;
}

export async function fetchChapterList(url: string): Promise<ChapterListData> {
  const source = getSource(url);
  if (!source) throw new Error("This site is not supported yet.");

  const slug = source.seriesKey(url);
  const cacheKey = `${source.id}:${slug}`;
  const cached = LIST_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  let chapters: ChapterItem[] = [];
  let mangaName = source.name;

  if (source.fetchList) {
    const result = await source.fetchList(url);
    chapters = result.chapters;
    if (result.mangaName) mangaName = result.mangaName;
  } else if (source.parseList && source.listingUrls) {
    for (const lu of source.listingUrls(url)) {
      try {
        const html = await fetchText(lu, { referer: originOf(lu) });
        const items = source.parseList(html, lu);
        if (items.length >= chapters.length) {
          chapters = items;
          // Derive the name from the URL slug. The page title on these sites is
          // a generic listing label such as "Comics - ...".
          const sample = items.find((c) => source.seriesKey(c.url)) || items[0];
          const derived = sample ? titleFromSlug(source.seriesKey(sample.url)) : "";
          if (derived) mangaName = derived;
        }
        if (chapters.length) break;
      } catch {
        /* try the next listing URL */
      }
    }
  }

  if (slug) chapters = chapters.filter((c) => source.seriesKey(c.url) === slug);
  chapters.sort((a, b) => b.num - a.num);

  const data: ChapterListData = { mangaName, chapters };
  LIST_CACHE.set(cacheKey, { data, ts: Date.now() });
  return data;
}

export async function searchAll(query: string): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase();
  const cacheKey = `search:${q}`;
  const cached = SEARCH_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const tasks = SOURCES.map(async (source) => {
    if (source.search) {
      try {
        const results = await source.search(query);
        return results.map((r) => ({ ...r, source: source.name }));
      } catch {
        return [];
      }
    }
    if (!source.parseList || !source.listingUrls) return [];
    for (const lu of source.listingUrls("")) {
      try {
        const html = await fetchText(lu, { referer: originOf(lu) });
        const items = source.parseList(html, lu);
        if (!items.length) continue;
        // Group the listing's chapter links by series and report the latest
        // chapter of each series that matches the query.
        const bySeries = new Map<string, ChapterItem>();
        for (const item of items) {
          const slug = source.seriesKey(item.url);
          if (!slug) continue;
          const current = bySeries.get(slug);
          if (!current || item.num > current.num) bySeries.set(slug, item);
        }
        const results: SearchResult[] = [];
        for (const [slug, best] of bySeries) {
          const name = titleFromSlug(slug);
          if (q && !name.toLowerCase().includes(q)) continue;
          results.push({ title: name, latestChapter: `Ch ${best.num}`, url: best.url, source: source.name });
        }
        return results;
      } catch {
        /* ignore */
      }
    }
    return [];
  });

  const settled = await Promise.allSettled(tasks);
  const out: SearchResult[] = [];
  for (const s of settled) if (s.status === "fulfilled") out.push(...s.value);
  SEARCH_CACHE.set(cacheKey, { data: out, ts: Date.now() });
  return out;
}
