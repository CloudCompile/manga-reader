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
  // Volume number this chapter belongs to, when it can be resolved.
  volume?: string;
}

export interface ChapterListData {
  mangaName: string;
  chapters: ChapterItem[];
  // Present only when volume grouping resolved confidently.
  volumes?: string[];
}

export interface SearchResult {
  title: string;
  latestChapter: string;
  url: string;
  source: string;
}

// A series available from a source, used to build the browse listing.
export interface TitleItem {
  title: string;
  // Where to send the reader: a series page, or a chapter to open directly.
  url: string;
  sourceId: string;
  sourceName: string;
  latestChapter: string;
  totalChapters: number;
  thumbnail?: string;
}

// Titles featured on the home shelf, in display order. These are Spectre Scans
// series slugs; the shelf only renders entries the catalogue actually returns.
export const CURATED_TITLES: string[] = [
  "berserk",
  "koe-no-katachi",
  "oshi-no-ko",
  "bleach",
  "vinland-saga",
  "jujutsu-kaisen",
  "blue-lock",
  "solo-leveling",
  "tower-of-god",
  "chainsaw-man",
  "holyland",
  "blame",
  "claymore",
  "yotsubato",
  "made-in-abyss",
];

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
  // Enumerate every series the source hosts. Sources that only carry one
  // series per host derive it from their listing instead (see listTitles).
  browse?: () => Promise<TitleItem[]>;
  // Derive a single title from this source's listing page.
  browseFromListing?: boolean;
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
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#([0-9]+);/g, (_, d: string) => {
      try {
        return String.fromCodePoint(parseInt(d, 10));
      } catch {
        return "";
      }
    });
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
  browseFromListing: true,
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
  browseFromListing: true,
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
  browseFromListing: true,
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
  browseFromListing: true,
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
  browseFromListing: true,
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
  browseFromListing: true,
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

// ── specterscans.com — Next.js catalogue ───────────────────
//
// A multi-series catalogue (unlike the single-series hosts above). Series
// pages carry the full chapter list; chapter pages embed the ordered page
// list in the React Server Component payload. specterscans.net mirrors the
// same app under a second host with a different series slug set.
const SPECTRE_ORIGIN = "https://specterscans.com";

function spectreSlug(url: string): string {
  const m = url.match(/\/series\/([^/?#]+)/i);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]).toLowerCase();
  } catch {
    return m[1].toLowerCase();
  }
}

function spectreUrl(base: string, path: string): string {
  try {
    return new URL(path, originOf(base)).href;
  } catch {
    return `${SPECTRE_ORIGIN}${path}`;
  }
}

function spectreSeriesUrl(url: string): string {
  const slug = spectreSlug(url);
  return slug ? spectreUrl(url, `/series/${slug}`) : url;
}

function spectreNum(html: string, key: string): string {
  const m = html.match(new RegExp(`"${key}\\\\?":(null|[0-9]+(?:\\.[0-9]+)?)`));
  return m && m[1] !== "null" ? m[1] : "";
}

function spectreField(html: string, key: string): string {
  const m = html.match(new RegExp(`"${key}\\\\?":\\\\?"([^"]+)"`));
  return m ? decodeEntities(m[1].replace(/\\+$/, "").replace(/\\\//g, "/")) : "";
}

// Page images, in reading order.
function spectreImages(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const url = raw.replace(/\\+$/, "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  // The reader serialises its page list into the RSC payload; prefer it over
  // the markup because lazy pages are not always rendered as <img>.
  const payload = /"imageUrl\\?":\\?"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = payload.exec(html)) !== null) push(m[1]);
  if (out.length) return out;
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    if (!/reader-img/.test(attr(tag, "class"))) continue;
    const src = attr(tag, "src") || attr(tag, "data-src");
    if (src) push(src);
  }
  return out;
}

function spectreChapterLinks(html: string, slug: string, base: string): ChapterItem[] {
  if (!slug) return [];
  // Slugs may contain characters the page entity-encodes inside hrefs
  // (e.g. "lawyer's" renders as "lawyer&#x27;s").
  const slugRe = escapeReg(slug).replace(/'/g, "(?:'|&#x27;|&#39;|&apos;)");
  const re = new RegExp(
    `href=["'](?:https?://[^"']*)?/series/${slugRe}/chapter/([0-9]+(?:[.-][0-9]+)?)/?["']`,
    "gi"
  );
  const map = new Map<number, ChapterItem>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const num = numFromSlug(m[1]);
    if (map.has(num)) continue;
    map.set(num, {
      num,
      url: spectreUrl(base, `/series/${slug}/chapter/${m[1]}`),
      title: chapterLabel(num, m[1]),
    });
  }
  return Array.from(map.values());
}

function spectreChapterFromHtml(html: string, url: string): RawChapter {
  const { title, h1 } = pageTitle(html);
  const parsed = parseChapterTitle(h1 || title);
  const slug = spectreSlug(url);
  const prev = spectreNum(html, "prevNumber");
  const next = spectreNum(html, "nextNumber");
  return {
    title,
    mangaName: spectreField(html, "seriesTitle") || parsed.mangaName,
    chapterNum: spectreNum(html, "chapterNumber") || parsed.chapterNum,
    images: spectreImages(html),
    prevUrl: prev ? spectreUrl(url, `/series/${slug}/chapter/${prev}`) : null,
    nextUrl: next ? spectreUrl(url, `/series/${slug}/chapter/${next}`) : null,
  };
}

const specterscans: Source = {
  id: "specterscans",
  name: "Spectre Scans",
  hosts: [/specterscans\.(?:com|net)$/i],
  seriesKey: spectreSlug,
  async fetchChapter(url): Promise<RawChapter> {
    // A series URL (from search or browse) resolves to its newest readable
    // chapter; the newest entry is sometimes an empty placeholder.
    if (!/\/chapter\//i.test(url)) {
      const page = await fetchText(url, { referer: originOf(url) });
      const chapters = spectreChapterLinks(page, spectreSlug(url), url).sort((a, b) => b.num - a.num);
      if (!chapters.length) throw new Error("No chapters found for this series.");
      for (const c of chapters.slice(0, 3)) {
        const raw = spectreChapterFromHtml(await fetchText(c.url, { referer: originOf(c.url) }), c.url);
        if (raw.images.length) return raw;
      }
      const first = chapters[0];
      return spectreChapterFromHtml(await fetchText(first.url, { referer: originOf(first.url) }), first.url);
    }
    return spectreChapterFromHtml(await fetchText(url, { referer: originOf(url) }), url);
  },
  async fetchList(url): Promise<{ chapters: ChapterItem[]; mangaName?: string }> {
    const seriesUrl = spectreSeriesUrl(url);
    const html = await fetchText(seriesUrl, { referer: originOf(seriesUrl) });
    const chapters = spectreChapterLinks(html, spectreSlug(seriesUrl), seriesUrl);
    const h1 = stripTags(decodeEntities((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || ""));
    const og = decodeEntities((html.match(/<meta property="og:title" content="([^"]*)"/i) || [])[1] || "");
    return { chapters, mangaName: h1 || og || undefined };
  },
  async search(query): Promise<SearchResult[]> {
    const text = await fetchText(`${SPECTRE_ORIGIN}/api/search?q=${encodeURIComponent(query)}`, {
      referer: `${SPECTRE_ORIGIN}/`,
    });
    const json = JSON.parse(text) as {
      results?: { slug?: string; title?: string }[];
      foreign?: { href?: string; title?: string }[];
    };
    const out: SearchResult[] = [];
    for (const r of json.results || []) {
      if (!r.slug || !r.title) continue;
      out.push({
        title: r.title,
        latestChapter: "",
        url: spectreUrl(SPECTRE_ORIGIN, `/series/${r.slug}`),
        source: "Spectre Scans",
      });
    }
    // "foreign" entries live on the .net mirror, which this source also reads.
    for (const f of json.foreign || []) {
      if (!f.href || !f.title || !getSource(f.href)) continue;
      out.push({ title: f.title, latestChapter: "", url: f.href, source: "Spectre Scans" });
    }
    return out;
  },
  async browse(): Promise<TitleItem[]> {
    // The catalogue is server-rendered: the sitemap lists every series with
    // its cover, and /a-z supplies the display titles.
    const [sitemap, az] = await Promise.all([
      fetchText(`${SPECTRE_ORIGIN}/sitemap.xml`, { referer: `${SPECTRE_ORIGIN}/` }).catch(() => ""),
      fetchText(`${SPECTRE_ORIGIN}/a-z`, { referer: `${SPECTRE_ORIGIN}/` }).catch(() => ""),
    ]);

    const covers = new Map<string, string>();
    for (const block of sitemap.split("<url>")) {
      const slug = (block.match(/\/series\/([^<]+)<\/loc>/) || [])[1];
      const cover = (block.match(/<image:loc>([^<]+)<\/image:loc>/) || [])[1];
      if (slug && cover && !covers.has(slug)) covers.set(decodeURIComponent(slug), cover);
    }

    const titles: TitleItem[] = [];
    const seen = new Set<string>();
    const add = (slug: string, title: string) => {
      if (!slug || seen.has(slug)) return;
      seen.add(slug);
      const cover = covers.get(slug);
      // A handful of sitemap covers point at filenames containing a colon,
      // which the CDN does not serve; drop those rather than show a broken img.
      const coverFile = cover ? decodeURIComponent(cover.split("/").pop() || "") : "";
      titles.push({
        title,
        url: spectreUrl(SPECTRE_ORIGIN, `/series/${slug}`),
        sourceId: "specterscans",
        sourceName: "Spectre Scans",
        latestChapter: "",
        totalChapters: 0,
        thumbnail: cover && !coverFile.includes(":") ? cover : undefined,
      });
    };

    const linkRe = /<a[^>]*href="\/series\/([^"]+)"[^>]*>([^<]+)</gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(az)) !== null) add(decodeEntities(m[1]), decodeEntities(m[2]).trim());
    for (const slug of covers.keys()) add(slug, titleFromSlug(slug));
    return titles;
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
  "query($search:SearchInput,$limit:Int){mangas(search:$search,limit:$limit){edges{_id name englishName nativeName thumbnail availableChapters}}}";

const ALLMANGA_BROWSE_QUERY =
  "query($size:Int){queryPopular(type:manga,size:$size){total recommendations{anyCard{_id name englishName nativeName thumbnail}}}}";

const ALLMANGA_PAGES_QUERY =
  "query($mangaId:String!,$translationType:VaildTranslationTypeMangaEnumType!,$chapterString:String!,$page:Int,$limit:Int,$offset:Int){chapterPages(mangaId:$mangaId,translationType:$translationType,chapterString:$chapterString,page:$page,limit:$limit,offset:$offset){edges{streamerId sourceUrl sourceName chapterString pictureUrls pictureUrlsProcessed pictureUrlHead}pageInfo{total}}}";

interface AllMangaDetail {
  _id: string;
  name: string;
  englishName?: string | null;
  nativeName?: string | null;
  availableChapters?: Record<string, number>;
  availableChaptersDetail?: Record<string, string[]>;
}
interface AllMangaPages {
  chapterPages: {
    edges: { pictureUrls?: string[]; pictureUrlsProcessed?: string[]; pictureUrlHead?: string }[];
    pageInfo?: { total?: number };
  } | null;
}
interface AllMangaEdge {
  _id: string;
  name: string;
  englishName?: string | null;
  nativeName?: string | null;
  thumbnail?: string | null;
  availableChapters?: Record<string, number>;
}

// Covers arrive either as an absolute URL or a path relative to the CDN.
function allmangaImage(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  if (/^https?:/i.test(raw)) return raw;
  return `https://cdn.allanime.day/${raw.replace(/^\/+/, "")}`;
}

function allmangaChapterCount(e: AllMangaEdge): number {
  return e.availableChapters?.sub || e.availableChapters?.raw || 0;
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
    const displayName = manga?.englishName || manga?.name || "Manga";

    return {
      title: chapter ? `${displayName} Chapter ${chapter}` : displayName,
      mangaName: displayName,
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
      mangaName: detail.manga?.englishName || detail.manga?.name,
      chapters: chapters.map((c) => ({
        num: numFromSlug(c),
        url: `https://allmanga.to/manga/${id}/chapter-${c}-${type}`,
        title: chapterLabel(numFromSlug(c), c),
      })),
    };
  },
  async search(query): Promise<SearchResult[]> {
    const data = await allmangaGql<{ mangas: { edges: AllMangaEdge[] } }>(ALLMANGA_SEARCH_QUERY, {
      search: { query },
      limit: 24,
    });
    return (data.mangas?.edges || []).map((e) => {
      const count = allmangaChapterCount(e);
      return {
        title: e.name,
        latestChapter: count ? `Ch ${count}` : "",
        url: `https://allmanga.to/manga/${e._id}`,
        source: "AllManga",
      };
    });
  },
  async browse(): Promise<TitleItem[]> {
    // A blank query enumerates the catalogue, which is how the browse grid is
    // populated without paging through the site.
    const data = await allmangaGql<{ mangas: { edges: AllMangaEdge[] } }>(ALLMANGA_SEARCH_QUERY, {
      search: {},
      limit: 60,
    });
    return (data.mangas?.edges || []).map((e) => {
      const count = allmangaChapterCount(e);
      return {
        title: e.englishName || e.name,
        url: `https://allmanga.to/manga/${e._id}`,
        sourceId: "allmanga",
        sourceName: "AllManga",
        latestChapter: count ? `Ch ${count}` : "",
        totalChapters: count,
        thumbnail: allmangaImage(e.thumbnail),
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
  specterscans,
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

  // Volume grouping is best-effort and never fails the request.
  let volumes: string[] | undefined;
  try {
    volumes = (await applyVolumes(mangaName, chapters)) || undefined;
  } catch {
    volumes = undefined;
  }

  const data: ChapterListData = { mangaName, chapters, volumes };
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

// ───────────────────────────────────────────────────────────
// Title listing
// ───────────────────────────────────────────────────────────

const TITLE_CACHE = new Map<string, { data: TitleItem[]; ts: number }>();

// Group a listing page's chapter links into the distinct series it mentions.
async function titlesFromListing(source: Source): Promise<TitleItem[]> {
  if (!source.parseList || !source.listingUrls) return [];
  for (const lu of source.listingUrls("")) {
    try {
      const html = await fetchText(lu, { referer: originOf(lu) });
      const items = source.parseList(html, lu);
      if (!items.length) continue;
      const bySeries = new Map<string, { best: ChapterItem; count: number }>();
      for (const item of items) {
        const slug = source.seriesKey(item.url);
        if (!slug) continue;
        const current = bySeries.get(slug);
        if (!current) bySeries.set(slug, { best: item, count: 1 });
        else {
          current.count += 1;
          if (item.num > current.best.num) current.best = item;
        }
      }
      if (!bySeries.size) continue;
      return Array.from(bySeries.entries()).map(([slug, v]) => ({
        title: titleFromSlug(slug),
        url: v.best.url,
        sourceId: source.id,
        sourceName: source.name,
        latestChapter: v.best.num ? `Ch ${v.best.num}` : "",
        totalChapters: v.count,
      }));
    } catch {
      /* try the next listing URL */
    }
  }
  return [];
}

// Every series the reader can open, grouped by source in the UI.
export async function listTitles(): Promise<TitleItem[]> {
  const cached = TITLE_CACHE.get("all");
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const tasks = SOURCES.map(async (source) => {
    if (source.browse) {
      try {
        return await source.browse();
      } catch {
        return [];
      }
    }
    if (!source.browseFromListing) return [];
    try {
      return await titlesFromListing(source);
    } catch {
      return [];
    }
  });

  const settled = await Promise.allSettled(tasks);
  const seen = new Set<string>();
  const out: TitleItem[] = [];
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const t of s.value) {
      const key = `${t.sourceId}:${t.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  TITLE_CACHE.set("all", { data: out, ts: Date.now() });
  return out;
}

// The home shelf: only the hand-picked titles, in CURATED_TITLES order.
// Entries the catalogue no longer carries are skipped.
export async function listCuratedTitles(): Promise<TitleItem[]> {
  const all = await listTitles();
  const bySlug = new Map<string, TitleItem>();
  for (const t of all) {
    if (t.sourceId !== "specterscans") continue;
    bySlug.set(t.url.replace(/\/$/, "").split("/").pop() || "", t);
  }
  const out: TitleItem[] = [];
  for (const slug of CURATED_TITLES) {
    const t = bySlug.get(slug);
    if (t) out.push(t);
  }
  return out;
}

// ───────────────────────────────────────────────────────────
// Volume grouping
// ───────────────────────────────────────────────────────────
//
// None of the supported sites publish volume numbers, so a confident title
// match against MangaDex's chapter->volume aggregate is used instead. When no
// confident match exists, `volumes` stays undefined and the UI simply omits
// grouping rather than inventing volumes.

const MANGADEX_API = "https://api.mangadex.org";

// Reprints and side stories carry volume data that does not line up with the
// chapter numbering the reader sees, so they are never auto-matched.
const VOLUME_EXCLUDE =
  /(fan[- ]?colou?r|doujin|one[- ]?shot|anthology|full[- ]?colou?r|official colou?r|spin[- ]?off)/i;

const VOLUME_MIN_SCORE = 0.6;
const VOLUME_MIN_COVERAGE = 0.25;
const VOLUME_MIN_MATCHES = 4;

function normTitle(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleScore(a: string, b: string): number {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const A = new Set(na.split(" ").filter(Boolean));
  const B = new Set(nb.split(" ").filter(Boolean));
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

interface MangaDexMatch {
  id: string;
  title: string;
  score: number;
}

function allTitles(m: {
  attributes?: { title?: Record<string, string>; altTitles?: Record<string, string>[] };
}): string[] {
  const out: string[] = [];
  for (const v of Object.values(m.attributes?.title || {})) if (v) out.push(v);
  for (const alt of m.attributes?.altTitles || [])
    for (const v of Object.values(alt)) if (v) out.push(v);
  return out;
}

async function findMangaDexMatch(mangaName: string): Promise<MangaDexMatch | null> {
  const res = await fetch(
    `${MANGADEX_API}/manga?title=${encodeURIComponent(mangaName)}&limit=8&order%5Brelevance%5D=desc`,
    { headers: { "User-Agent": UA }, cache: "no-store" }
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    data?: { id: string; attributes?: { title?: Record<string, string>; altTitles?: Record<string, string>[] } }[];
  };
  let best: MangaDexMatch | null = null;
  for (const m of json.data || []) {
    const titles = allTitles(m);
    if (!titles.length) continue;
    if (titles.some((t) => VOLUME_EXCLUDE.test(t))) continue;
    let score = 0;
    for (const t of titles) score = Math.max(score, titleScore(mangaName, t));
    if (score < VOLUME_MIN_SCORE) continue;
    const primary = Object.values(m.attributes?.title || {})[0] || titles[0];
    if (!best || score > best.score) best = { id: m.id, title: primary, score };
  }
  return best;
}

const VOLUME_CACHE = new Map<string, { data: Map<number, string> | null; ts: number }>();

// chapter number -> volume number, or null when no confident match exists.
async function mangadexChapterVolumes(mangaName: string): Promise<Map<number, string> | null> {
  const key = normTitle(mangaName);
  if (!key) return null;
  const cached = VOLUME_CACHE.get(key);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  let map: Map<number, string> | null = null;
  try {
    const match = await findMangaDexMatch(mangaName);
    if (match) {
      const res = await fetch(`${MANGADEX_API}/manga/${match.id}/aggregate`, {
        headers: { "User-Agent": UA },
        cache: "no-store",
      });
      if (res.ok) {
        const agg = (await res.json()) as { volumes?: Record<string, { chapters?: Record<string, unknown> }> };
        const resolved = new Map<number, string>();
        for (const [vol, entry] of Object.entries(agg.volumes || {})) {
          if (!/^[0-9]+$/.test(vol)) continue;
          for (const ch of Object.keys(entry?.chapters || {})) {
            const n = numFromSlug(ch);
            if (n && !resolved.has(n)) resolved.set(n, vol);
          }
        }
        if (resolved.size) map = resolved;
      }
    }
  } catch {
    map = null;
  }
  VOLUME_CACHE.set(key, { data: map, ts: Date.now() });
  return map;
}

// Annotate chapters with volumes, returning the volume list. Returns null when
// the match is too thin to be trustworthy.
async function applyVolumes(
  mangaName: string,
  chapters: ChapterItem[]
): Promise<string[] | null> {
  if (!mangaName || chapters.length < VOLUME_MIN_MATCHES) return null;
  const map = await mangadexChapterVolumes(mangaName);
  if (!map) return null;

  let matched = 0;
  for (const ch of chapters) {
    const vol = map.get(ch.num);
    if (vol) {
      ch.volume = vol;
      matched += 1;
    }
  }
  if (matched < VOLUME_MIN_MATCHES || matched / chapters.length < VOLUME_MIN_COVERAGE) {
    for (const ch of chapters) delete ch.volume;
    return null;
  }

  const vols = Array.from(new Set(chapters.map((c) => c.volume).filter(Boolean))) as string[];
  if (vols.length < 2) {
    for (const ch of chapters) delete ch.volume;
    return null;
  }
  vols.sort((a, b) => Number(a) - Number(b));
  return vols;
}
