"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  BookOpen,
  ArrowUp,
  Sun,
  Moon,
  List,
  Search,
  X,
  History,
  Menu,
  Layers,
  Library,
  Home,
  Maximize2,
  Minimize2,
  Keyboard,
  Columns2,
  Bookmark,
  BookmarkCheck,
  BookmarkPlus,
  ArrowLeftRight,
} from "lucide-react";
import {
  getHistory,
  pushHistory,
  getLastRead,
  setLastRead,
  getTheme,
  setTheme as persistTheme,
  getFitMode,
  setFitMode as persistFitMode,
  getWide,
  setWide as persistWide,
  getPaged,
  setPaged as persistPaged,
  getRtl,
  setRtl as persistRtl,
  setPage,
  getList,
  toggleInList,
  removeFromList,
  type HistoryEntry,
} from "@/lib/storage";

// ─── Types ───────────────────────────────────────────
interface ChapterData {
  title: string;
  images: string[];
  prevUrl: string | null;
  nextUrl: string | null;
  mangaName: string;
  chapterNum: string;
  seriesSlug: string;
  sourceName?: string;
  warning?: string;
}

interface ChapterItem {
  num: number;
  url: string;
  title: string;
  volume?: string;
}

interface SearchResult {
  title: string;
  latestChapter: string;
  url: string;
  source?: string;
}

interface TitleItem {
  title: string;
  url: string;
  sourceId: string;
  sourceName: string;
  latestChapter: string;
  totalChapters: number;
  thumbnail?: string;
}

interface SourceHealth {
  id: string;
  name: string;
  ok: boolean;
  count: number;
  error?: string;
}

interface TitlesResponse {
  titles: TitleItem[];
  sources: SourceHealth[];
  total: number;
  offset: number;
  hasMore: boolean;
}

// A transient message shown over the current view. Errors are deliberately not
// a separate full-page state: one dead cover used to replace the whole shelf.
interface Banner {
  kind: "error" | "info";
  text: string;
}

type Theme = "dark" | "light";
type FitMode = "width" | "height" | "original";
type GroupMode = "chapter" | "volume";
type CatalogueScope = "shelf" | "all";

const PROXY = (src: string) => `/api/proxy?url=${encodeURIComponent(src)}`;

// Chapter payloads fetched ahead of time, keyed by chapter URL. Session-only:
// this is a latency optimisation, not storage, so it is deliberately not
// persisted and is dropped when the tab goes away.
const PREFETCHED_CHAPTERS = new Map<string, ChapterData>();
const PREFETCH_LIMIT = 4;
// Both of the caches below live for the session only. Cap them so a long read
// through a big series cannot grow the tab's memory without bound.
const PREFETCH_MAX_ENTRIES = 12;
const WARM_MAX_ENTRIES = 24;

function cacheChapter(chapterUrl: string, json: ChapterData) {
  PREFETCHED_CHAPTERS.delete(chapterUrl);
  PREFETCHED_CHAPTERS.set(chapterUrl, json);
  while (PREFETCHED_CHAPTERS.size > PREFETCH_MAX_ENTRIES) {
    const oldest = PREFETCHED_CHAPTERS.keys().next().value;
    if (oldest === undefined) break;
    PREFETCHED_CHAPTERS.delete(oldest);
  }
}

// Chapters whose opening pages have already been warmed through the proxy.
// Warming the first screenful means Prev/Next paints immediately instead of
// starting from an empty placeholder.
const WARMED_CHAPTERS = new Set<string>();
const WARM_PAGES = 3;
function warmPages(chapterUrl: string, images: string[]) {
  if (WARMED_CHAPTERS.has(chapterUrl)) return;
  WARMED_CHAPTERS.add(chapterUrl);
  while (WARMED_CHAPTERS.size > WARM_MAX_ENTRIES) {
    const oldest = WARMED_CHAPTERS.values().next().value;
    if (oldest === undefined) break;
    WARMED_CHAPTERS.delete(oldest);
  }
  for (const src of images.slice(0, WARM_PAGES)) {
    const img = new Image();
    img.decoding = "async";
    img.src = PROXY(src);
  }
}

// Pages warmed ahead of the reader's current position within one chapter.
// Neighbour-chapter warming above only covers the first screenful; this keeps
// the next few pages of the *current* chapter decoded so a flick through a long
// chapter does not hit a blank placeholder at every screen boundary.
//
// WARMED_SRCS remembers which source URLs have already been warmed, so
// scrolling back and forth over a page warms it once. It is capped like the
// other session caches so a long read cannot grow it without bound.
const WARMED_SRCS = new Set<string>();
// Per-chapter count of pages warmed, keyed by the chapter's image array so the
// cap resets when a different chapter loads and is released with it.
const WARMED_PER_CHAPTER = new WeakMap<string[], number>();
const LOOKAHEAD_MAX_ENTRIES = 200;
// How many pages past the visible one to warm, and how many per chapter.
const LOOKAHEAD_PAGES = 3;
const LOOKAHEAD_TOTAL = 12;
function warmLookahead(images: string[], fromIndex: number) {
  if (!images.length) return;
  let warmed = WARMED_PER_CHAPTER.get(images) || 0;
  if (warmed >= LOOKAHEAD_TOTAL) return;
  const start = Math.max(0, fromIndex);
  const end = Math.min(images.length, start + LOOKAHEAD_PAGES + 1);
  for (let i = start; i < end && warmed < LOOKAHEAD_TOTAL; i++) {
    const src = images[i];
    if (!src || WARMED_SRCS.has(src)) continue;
    WARMED_SRCS.add(src);
    warmed++;
    while (WARMED_SRCS.size > LOOKAHEAD_MAX_ENTRIES) {
      const oldest = WARMED_SRCS.values().next().value;
      if (oldest === undefined) break;
      WARMED_SRCS.delete(oldest);
    }
    const img = new Image();
    img.decoding = "async";
    img.src = PROXY(src);
  }
  WARMED_PER_CHAPTER.set(images, warmed);
}

// ─── Component ───────────────────────────────────────
export default function MangaReader() {
  const [url, setUrl] = useState("");
  const [data, setData] = useState<ChapterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [openingTitle, setOpeningTitle] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [fitMode, setFitMode] = useState<FitMode>("width");
  const [paged, setPaged] = useState(false);
  const [rtl, setRtl] = useState(false);
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [volumes, setVolumes] = useState<string[]>([]);
  const [groupMode, setGroupMode] = useState<GroupMode>("chapter");
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [showChapters, setShowChapters] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [titles, setTitles] = useState<TitleItem[]>([]);
  const [titlesLoading, setTitlesLoading] = useState(true);
  const [titlesError, setTitlesError] = useState("");
  const [sourceHealth, setSourceHealth] = useState<SourceHealth[]>([]);
  const [scope, setScope] = useState<CatalogueScope>("shelf");
  const [catalogueTotal, setCatalogueTotal] = useState(0);
  const [catalogueHasMore, setCatalogueHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [titleQuery, setTitleQuery] = useState("");
  const [titleSource, setTitleSource] = useState("all");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [readingList, setReadingList] = useState<HistoryEntry[]>([]);
  // Derived rather than tracked in its own state, so it is already correct when
  // a saved chapter is reopened and when an entry is removed from the panel.
  const savedHere = readingList.some((e) => e.url === url);
  const [showSaved, setShowSaved] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageInput, setPageInput] = useState("");
  const [showPageJumper, setShowPageJumper] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [wide, setWide] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const imgRefs = useRef<Map<number, HTMLImageElement>>(new Map());
  // Mirrors of state read inside the scroll handler, which is attached once.
  const dataRef = useRef<ChapterData | null>(null);
  const currentUrlRef = useRef<string>("");
  const resumeRef = useRef<{ url: string; page: number } | null>(null);
  const lastPageSaved = useRef(0);
  const lastScrollY = useRef(0);
  // Read by the scroll handler, which is registered once per chapter and so
  // cannot close over the current value of `paged`.
  const pagedRef = useRef(false);
  const scrollEnd = useRef<number | null>(null);

  // Init
  useEffect(() => {
    setHistory(getHistory());
    const saved = getLastRead();
    if (saved) setUrl(saved);
    setTheme(getTheme());
    setFitMode(getFitMode());
    setWide(getWide());
    setPaged(getPaged());
    setRtl(getRtl());
    setReadingList(getList());
  }, []);

  // Catalogue loader. "shelf" is the small curated set that paints fast;
  // "all" pages through the full ~1200-title catalogue on demand, so switching
  // scope refetches rather than filtering a partial list.
  //
  // For "all" the source and text filters are applied server-side: filtering
  // client-side would only ever search the pages already fetched, which makes a
  // title look absent when it is simply on a later page.
  const loadCatalogue = useCallback(
    async (
      nextScope: CatalogueScope,
      opts: { append?: boolean; offset?: number; source?: string; query?: string } = {}
    ) => {
      const { append = false, offset = 0, source = "all", query = "" } = opts;
      if (append) setLoadingMore(true);
      else setTitlesLoading(true);
      if (!append) setTitlesError("");
      try {
        const params = new URLSearchParams();
        if (nextScope === "all") {
          params.set("all", "1");
          params.set("offset", String(offset));
          if (source !== "all") params.set("source", source);
          if (query) params.set("q", query);
        }
        const res = await fetch(`/api/titles?${params}`);
        const json: TitlesResponse = await res.json();
        if (!res.ok) throw new Error((json as unknown as { error?: string }).error || "Failed to load titles");
        setTitles((prev) => (append ? [...prev, ...json.titles] : json.titles));
        setCatalogueTotal(json.total);
        setCatalogueHasMore(json.hasMore);
        if (json.sources?.length) setSourceHealth(json.sources);
      } catch (err) {
        if (!append) setTitlesError(err instanceof Error ? err.message : "Failed to load titles");
      } finally {
        if (append) setLoadingMore(false);
        else setTitlesLoading(false);
      }
    },
    []
  );

  // The shelf is a fixed short list, so it is fetched once per visit and its
  // search box filters it in place (see visibleTitles).
  useEffect(() => {
    if (scope !== "shelf") return;
    loadCatalogue("shelf");
  }, [scope, loadCatalogue]);

  // The full catalogue applies its filters server-side, debounced so typing does
  // not fire a request per keystroke.
  useEffect(() => {
    if (scope !== "all") return;
    const t = window.setTimeout(() => {
      setTitles([]);
      loadCatalogue("all", { source: titleSource, query: titleQuery.trim() });
    }, 250);
    return () => window.clearTimeout(t);
  }, [scope, titleSource, titleQuery, loadCatalogue]);

  // Typing in the search box searches everything, not just the shelf, so the
  // full catalogue is reachable without knowing about the scope tabs.
  const handleTitleQueryChange = (value: string) => {
    setTitleQuery(value);
    if (value && scope === "shelf") {
      setTitleSource("all");
      setScope("all");
    }
  };

  // Switching scope clears the grid so the previous scope's titles never linger.
  const changeScope = (next: CatalogueScope) => {
    if (next === scope) return;
    setTitles([]);
    setTitleSource("all");
    setTitleQuery("");
    setScope(next);
  };

  const loadMoreTitles = useCallback(() => {
    if (loadingMore || !catalogueHasMore || scope !== "all") return;
    loadCatalogue("all", {
      append: true,
      offset: titles.length,
      source: titleSource,
      query: titleQuery.trim(),
    });
  }, [loadingMore, catalogueHasMore, scope, titles.length, titleSource, titleQuery, loadCatalogue]);

  // Retry keeps the active filters, so recovering from a failure does not
  // silently drop the source or search the user had applied.
  const retryCatalogue = () =>
    scope === "all"
      ? loadCatalogue("all", { source: titleSource, query: titleQuery.trim() })
      : loadCatalogue("shelf");

  // Scroll listener: track the visible page, hide the chrome while reading
  // downwards, and remember the furthest page reached in this chapter.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      // In paged mode there is nothing to scroll: currentPage is driven by
      // turnPage instead, so the scroll bookkeeping below does not apply.
      if (pagedRef.current) return;
      const y = el.scrollTop;
      setShowScrollTop(y > 600);

      // Hide the top/bottom bars when scrolling down, reveal on any upward move.
      const delta = y - lastScrollY.current;
      lastScrollY.current = y;
      if (Math.abs(delta) > 6) setChromeHidden(delta > 0 && y > 120);

      const imgs = el.querySelectorAll("img");
      for (let i = 0; i < imgs.length; i++) {
        const rect = imgs[i].getBoundingClientRect();
        if (rect.top >= -rect.height / 2) {
          setCurrentPage(i + 1);
          // Warm the pages just past the visible one so the next screenful is
          // ready before the reader reaches it.
          const current = dataRef.current;
          if (current) warmLookahead(current.images, i);
          break;
        }
      }

      // Persist progress once scrolling settles, so we do not write on every tick.
      if (scrollEnd.current) window.clearTimeout(scrollEnd.current);
      scrollEnd.current = window.setTimeout(() => {
        const imgs2 = el.querySelectorAll("img");
        let page = 0;
        for (let i = 0; i < imgs2.length; i++) {
          const rect = imgs2[i].getBoundingClientRect();
          if (rect.top >= -rect.height / 2) { page = i + 1; break; }
        }
        const current = dataRef.current;
        if (current && page > 0 && page > lastPageSaved.current && currentUrlRef.current) {
          lastPageSaved.current = page;
          setPage(currentUrlRef.current, page);
          setHistory(getHistory());
        }
      }, 400);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scrollEnd.current) window.clearTimeout(scrollEnd.current);
    };
  }, [data]);

  // Set initial page to 1 when data loads
  useEffect(() => { if (data?.images.length) setCurrentPage(1); }, [data?.images.length]);

  // Keep the ref the scroll handler reads in step with the toggle.
  useEffect(() => { pagedRef.current = paged; }, [paged]);

  // In paged mode, record the page reached as it changes. The scroll handler
  // does this for the scrolling reader, but it is inert here.
  useEffect(() => {
    if (!paged || !data?.images.length || !currentUrlRef.current) return;
    if (currentPage > lastPageSaved.current) {
      lastPageSaved.current = currentPage;
      setPage(currentUrlRef.current, currentPage);
      setHistory(getHistory());
    }
  }, [paged, currentPage, data]);

  // Warm the opening pages of a freshly loaded chapter so the first screenful
  // paints without waiting, matching what the scroll handler does further down.
  useEffect(() => {
    if (data?.images.length) warmLookahead(data.images, 0);
  }, [data]);

  // In paged mode the scroll handler never fires, so warm ahead from the page
  // being shown instead; this keeps the next turn instant.
  useEffect(() => {
    if (paged && data?.images.length) warmLookahead(data.images, currentPage - 1);
  }, [paged, currentPage, data]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const isLeft = e.key === "ArrowLeft";
      const isRight = e.key === "ArrowRight";
      if (isLeft || isRight) {
        e.preventDefault();
        if (paged) {
          // In paged mode the arrows turn pages within the chapter before they
          // leave it. In RTL "forward" is the left arrow.
          const forward = rtl ? isLeft : isRight;
          if (forward) advance();
          else retreat();
        } else if (isLeft && data?.prevUrl) {
          goToChapter(data.prevUrl);
        } else if (isRight && data?.nextUrl) {
          goToChapter(data.nextUrl);
        }
      } else if (e.key === "t" || e.key === "T") {
        toggleTheme();
      } else if (e.key === "l" || e.key === "L") {
        setShowChapters((v) => !v);
      } else if (e.key === "s" || e.key === "S") {
        toggleSaved();
      } else if (e.key === "w" || e.key === "W") {
        toggleWide();
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      } else if (e.key === "?") {
        setShowShortcuts((v) => !v);
      } else if (e.key === "Escape") {
        setShowChapters(false);
        setShowSearch(false);
        setShowHistory(false);
        setShowSaved(false);
        setShowPageJumper(false);
        setShowMobileMenu(false);
        setShowShortcuts(false);
      } else if (e.key === "g" || e.key === "G") {
        setShowPageJumper((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [data, paged, currentPage, rtl, wide]);

  // Warm the neighbouring chapters after the current one settles, so Prev/Next
  // does not wait on a scrape. Runs at most once per chapter and is a no-op if
  // that chapter is already cached.
  useEffect(() => {
    const candidates = [data?.nextUrl, data?.prevUrl].filter(
      (u): u is string => typeof u === "string" && u.length > 0 && !PREFETCHED_CHAPTERS.has(u)
    );
    if (!candidates.length) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      for (const target of candidates.slice(0, PREFETCH_LIMIT)) {
        fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: target }),
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((json: ChapterData | null) => {
            if (!cancelled && json && Array.isArray(json.images)) {
              cacheChapter(target, json);
              warmPages(target, json.images);
            }
          })
          .catch(() => {
            // Prefetching is best-effort; a failure just means the chapter loads
            // on demand as before.
          });
      }
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [data?.nextUrl, data?.prevUrl]);

  const handleImageLoad = useCallback((index: number) => {
    setLoadedImages((prev) => new Set(prev).add(index));
  }, []);

  const loadChapter = useCallback(async (chapterUrl: string) => {
    if (!chapterUrl.trim()) return;
    setLoading(true);
    setBanner(null);
    setData(null);
    setLoadedImages(new Set());
    setCurrentPage(0);
    setShowScrollTop(false);
    setChromeHidden(false);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setUrl(chapterUrl);
    setLastRead(chapterUrl);
    setShowChapters(false);
    setShowMobileMenu(false);
    currentUrlRef.current = chapterUrl;
    lastPageSaved.current = 0;
    // Restore the page this chapter was left on, if it was read before.
    const prior = getHistory().find((h) => h.url === chapterUrl);
    resumeRef.current = prior?.page && prior.page > 1 ? { url: chapterUrl, page: prior.page } : null;

    try {
      // A prefetched payload skips the round trip entirely. Drop it on use so a
      // later visit re-reads the chapter rather than serving a stale copy.
      const prefetched = PREFETCHED_CHAPTERS.get(chapterUrl);
      PREFETCHED_CHAPTERS.delete(chapterUrl);
      let json: ChapterData;
      if (prefetched) {
        json = prefetched;
      } else {
        const res = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: chapterUrl }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load chapter");
        json = body;
      }
      dataRef.current = json;
      setData(json);
      setHistory(
        pushHistory({ url: chapterUrl, mangaName: json.mangaName, chapterNum: json.chapterNum, timestamp: Date.now() })
      );

      // Fetch chapter list in background for the sidebar and navigation.
      fetchChapterList(chapterUrl);
    } catch (err) {
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Something went wrong",
      });
      setData(null);
      dataRef.current = null;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchChapterList = async (chapterUrl: string) => {
    setChaptersLoading(true);
    try {
      const res = await fetch("/api/chapters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: chapterUrl }),
      });
      const json = await res.json();
      if (res.ok) {
        setChapters(json.chapters || []);
        setVolumes(json.volumes || []);
      }
    } catch {
      // Silent fail for chapter list
    } finally {
      setChaptersLoading(false);
    }
  };

  // A title's url is a series page or its latest chapter. Resolve it to a
  // chapter that actually has images, since the newest chapter is sometimes an
  // empty placeholder ("coming soon"). The first few candidates are probed in
  // parallel — sequentially this cost up to three round trips before anything
  // appeared on screen.
  const openTitle = useCallback(async (title: TitleItem) => {
    setOpeningTitle(title.title);
    try {
      const res = await fetch("/api/chapters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: title.url }),
      });
      const json = await res.json();
      const list: ChapterItem[] = json.chapters || [];
      if (!res.ok || !list.length) {
        setBanner({ kind: "error", text: `No readable chapters found for “${title.title}” yet.` });
        return;
      }

      const candidates = list.slice(0, 3);
      const probes = await Promise.all(
        candidates.map(async (candidate) => {
          try {
            const sres = await fetch("/api/scrape", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: candidate.url }),
            });
            const scraped = await sres.json();
            return sres.ok && (scraped.images || []).length ? candidate.url : null;
          } catch {
            return null;
          }
        })
      );
      loadChapter(probes.find(Boolean) || list[0].url);
    } catch {
      setBanner({ kind: "error", text: `Could not open “${title.title}”.` });
    } finally {
      setOpeningTitle(null);
    }
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      const json = await res.json();
      if (res.ok) setSearchResults(json);
    } catch { /* ignore */ }
    finally { setSearchLoading(false); }
  };

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); loadChapter(url); };
  const goToChapter = (chapterUrl: string | null) => { if (chapterUrl) loadChapter(chapterUrl); };
  const goHome = () => {
    setData(null);
    dataRef.current = null;
    setBanner(null);
    setChapters([]);
    setVolumes([]);
    setLoadedImages(new Set());
    setShowMobileMenu(false);
    setShowChapters(false);
    setShowShortcuts(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  const scrollToTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    persistTheme(next);
  };
  const toggleSaved = () => {
    if (!data) return;
    const next = toggleInList({
      url: url,
      mangaName: data.mangaName,
      chapterNum: data.chapterNum,
      timestamp: Date.now(),
    });
    setReadingList(next);
  };

  const chooseFitMode = (mode: FitMode) => { setFitMode(mode); persistFitMode(mode); };
  const toggleWide = () => { const next = !wide; setWide(next); persistWide(next); };
  const togglePaged = () => { const next = !paged; setPaged(next); persistPaged(next); };
  const toggleRtl = () => { const next = !rtl; setRtl(next); persistRtl(next); };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  // Restore the saved page once the images have been laid out.
  useEffect(() => {
    const pending = resumeRef.current;
    if (!data || !pending || pending.url !== currentUrlRef.current) return;
    if (!data.images.length) return;
    if (pagedRef.current) {
      // Nothing is scrollable in paged mode, so restore by selecting the group
      // rather than by scrolling to the image.
      setCurrentPage(pending.page);
      lastPageSaved.current = pending.page;
      resumeRef.current = null;
      return;
    }
    let cancelled = false;
    let tries = 0;
    const attempt = () => {
      if (cancelled) return;
      const img = imgRefs.current.get(pending.page - 1);
      if (img && img.getBoundingClientRect().height > 0) {
        img.scrollIntoView({ block: "start" });
        lastPageSaved.current = pending.page;
        resumeRef.current = null;
        return;
      }
      if (tries++ < 20) window.setTimeout(attempt, 120);
    };
    attempt();
    return () => { cancelled = true; };
  }, [data]);

  // Track fullscreen changes so the toggle icon stays in sync.
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Errors auto-dismiss so a transient failure does not linger over the UI.
  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(null), banner.kind === "error" ? 8000 : 4000);
    return () => window.clearTimeout(t);
  }, [banner]);

  // Horizontal swipe turns the page on touch devices. The listener is
  // non-passive because a horizontal swipe cancels the vertical scroll, but it
  // only calls preventDefault once the gesture is clearly horizontal.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let x0 = 0, y0 = 0, tracking = false;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      tracking = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - x0;
      const dy = e.touches[0].clientY - y0;
      if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy) * 1.5) e.preventDefault();
    };
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const current = dataRef.current;
      if (!current) return;
      // Swipe left reveals the next chapter, matching page-turn direction.
      if (dx < 0 && current.nextUrl) loadChapter(current.nextUrl);
      else if (dx > 0 && current.prevUrl) loadChapter(current.prevUrl);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
    };
  }, [data, loadChapter]);

  // Clicking a page advances one screen; only at the last page does it move on
  // to the next chapter. Previously any click jumped straight to the next
  // chapter, so a stray click mid-chapter lost the reader's place. Clicks are
  // also ignored while text is selected, so copying a line does not navigate.
  const onImageClick = () => {
    if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
    // In paged mode a click advances one page (or chapter at the end) rather
    // than nudging the scroll position.
    if (paged) {
      advance();
      return;
    }
    const atLastPage = totalPages > 0 && currentPage >= totalPages;
    if (atLastPage && data?.nextUrl) {
      goToChapter(data.nextUrl);
      return;
    }
    scrollRef.current?.scrollBy({ top: scrollRef.current.clientHeight * 0.9, behavior: "smooth" });
  };

  const jumpToPage = (page: number) => {
    if (paged) {
      setCurrentPage(Math.min(Math.max(1, page), totalPages || 1));
    } else {
      const img = imgRefs.current.get(page - 1);
      if (img) img.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setShowPageJumper(false);
    setPageInput("");
  };

  const totalPages = data?.images.length || 0;
  const displayImages = data ? data.images.map(PROXY) : [];
  const isDark = theme === "dark";

  // Paged mode shows one page per screen. Turning past the last page moves to
  // the next chapter and past the first to the previous one, matching where the
  // scroll reader's click-to-advance ends up. `dir` is in reading order, so it
  // always counts up; only the input mapping below flips for rtl.
  const turnPage = (dir: 1 | -1) => {
    if (!totalPages) return;
    // A spread shows two pages, so a turn moves a whole spread rather than one
    // page; otherwise the second page of the spread would never be reachable.
    const step = wide ? 2 : 1;
    const target = currentPage + dir * step;
    if (target < 1) {
      if (data?.prevUrl) goToChapter(data.prevUrl);
      return;
    }
    if (target > totalPages) {
      if (data?.nextUrl) goToChapter(data.nextUrl);
      return;
    }
    setCurrentPage(target);
  };
  // In LTR the next page is to the right; in RTL it is to the left, so the
  // arrows and click zones swap.
  const advance = () => turnPage(1);
  const retreat = () => turnPage(-1);

  // Distinct sources in the listing. For the full catalogue the health report is
  // authoritative: it is the only way to list a source whose titles all fall on
  // a page not yet fetched. For the shelf, only sources actually present are
  // offered, so the filter never leads to a guaranteed-empty result.
  const sourceOptions = useMemo(() => {
    if (scope === "all" && sourceHealth.length) {
      return sourceHealth
        .filter((s) => s.ok && s.count > 0)
        .map((s) => ({ id: s.id, name: s.name }));
    }
    const seen = new Map<string, string>();
    for (const t of titles) if (!seen.has(t.sourceId)) seen.set(t.sourceId, t.sourceName);
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [titles, sourceHealth, scope]);

  const visibleTitles = useMemo(() => {
    // In "all" scope the server already applied the source and text filters, so
    // re-filtering here would only hide titles the server legitimately returned.
    if (scope === "all") return titles;
    const q = titleQuery.trim().toLowerCase();
    return titles.filter(
      (t) =>
        (titleSource === "all" || t.sourceId === titleSource) &&
        (!q || t.title.toLowerCase().includes(q))
    );
  }, [titles, titleQuery, titleSource, scope]);

  // Sources that failed to load, so the shelf can offer a retry instead of
  // quietly showing fewer titles than the user expects.
  const failedSources = useMemo(() => sourceHealth.filter((s) => !s.ok), [sourceHealth]);

  // Total catalogue size for the "All" tab label. It comes from the health
  // report, which both scopes return, so the count is right before the full
  // catalogue has been fetched. (catalogueTotal tracks the current filtered
  // result instead, and is only meaningful once "all" has loaded.)
  const allCount = useMemo(
    () => sourceHealth.reduce((n, s) => n + (s.ok ? s.count : 0), 0),
    [sourceHealth]
  );

  const canGroupByVolume = volumes.length > 1;

  // Chapters bucketed by volume; unnumbered gaps collect under "Other".
  const volumeGroups = useMemo(() => {
    if (!canGroupByVolume) return [];
    const groups = new Map<string, ChapterItem[]>();
    for (const ch of chapters) {
      const key = ch.volume || "Other";
      const bucket = groups.get(key);
      if (bucket) bucket.push(ch);
      else groups.set(key, [ch]);
    }
    const ordered = Array.from(groups.entries())
      .filter(([k]) => k !== "Other")
      .sort((a, b) => Number(b[0]) - Number(a[0]));
    const other = groups.get("Other");
    if (other) ordered.push(["Other", other]);
    return ordered;
  }, [chapters, canGroupByVolume]);

  const bg = isDark ? "bg-[#0a0a0a]" : "bg-[#f5f5f5]";
  const textCol = isDark ? "text-white" : "text-gray-900";
  const subText = isDark ? "text-white/50" : "text-gray-500";
  const barBg = isDark ? "bg-[#111] border-white/10" : "bg-white border-gray-200";
  const panelBg = isDark ? "bg-[#111]" : "bg-white";
  const hoverBg = isDark ? "hover:bg-white/10" : "hover:bg-gray-100";

  const imgStyle: React.CSSProperties =
    fitMode === "width" ? { width: "100%", height: "auto" }
    : fitMode === "height" ? { height: "100vh", width: "auto", margin: "0 auto" }
    : { maxWidth: "100%", height: "auto", margin: "0 auto" };

  // Wide mode pairs consecutive pages; "width" is the only sensible fit there,
  // so a 50% cap keeps a two-page spread inside the viewport.
  const wideStyle: React.CSSProperties = wide ? { ...imgStyle, width: "100%" } : imgStyle;

  // Pages grouped for rendering: pairs in wide mode, singles otherwise. The
  // pairing applies in paged mode too, so a spread is shown on one screen and
  // the RTL toggle has something to order.
  const pageGroups: number[][] = [];
  if (data) {
    if (wide) {
      for (let i = 0; i < data.images.length; i += 2) {
        pageGroups.push(i + 1 < data.images.length ? [i, i + 1] : [i]);
      }
    } else {
      for (let i = 0; i < data.images.length; i++) pageGroups.push([i]);
    }
  }
  // In paged mode the visible group is derived from currentPage rather than
  // scrolled to, since nothing is scrollable. currentPage is a page index; the
  // group containing it is the one shown.
  const groupOf = (pageIndex: number) =>
    pageGroups.findIndex((g) => g.includes(pageIndex));
  const pagedGroupIndex = paged ? groupOf(currentPage - 1) : -1;
  const pagedGroup =
    paged && pageGroups.length
      ? pageGroups[pagedGroupIndex >= 0 ? pagedGroupIndex : 0]
      : null;

  // ─── Sidebar panel component ─────────────────────
  const SidePanel = ({ title, icon, show, onClose, children }: {
    title: string; icon: React.ReactNode; show: boolean; onClose: () => void; children: React.ReactNode;
  }) => {
    if (!show) return null;
    return (
      <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
        <div className="absolute inset-0 bg-black/50" />
        <div className={`relative w-full max-w-sm ${panelBg} ${textCol} shadow-2xl flex flex-col`} style={{animation: "slideIn 200ms ease-out"}} onClick={(e) => e.stopPropagation()}>
          <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
            <div className="flex items-center gap-2">
              {icon}
              <h2 className="font-semibold text-sm">{title}</h2>
            </div>
            <button onClick={onClose} aria-label="Close panel" className={`p-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${hoverBg}`}><X className="h-4 w-4" /></button>
          </div>
          <ScrollArea className="flex-1">{children}</ScrollArea>
        </div>
      </div>
    );
  };

  // ─── Banner ────────────────────────────────────────
  // A dismissible message layered over the current view rather than replacing
  // it, so a failed action never costs the reader their place.
  // Reading history and the reading list are reachable from both the library
  // and the reader, so they are defined once and rendered in both views.
  const LibraryPanelsView = (
    <>
      <SidePanel title="Reading History" icon={<History className="h-4 w-4" />} show={showHistory} onClose={() => setShowHistory(false)}>
        <div className="p-4 space-y-1">
          {history.length === 0 && <p className={`text-sm ${subText}`}>No history yet</p>}
          {history.map((h) => (
            <button key={h.url} onClick={() => { loadChapter(h.url); setShowHistory(false); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm ${hoverBg} ${isDark ? "text-white/80" : "text-gray-700"}`}>
              <div className="font-medium">{h.mangaName}</div>
              <div className={`text-xs ${subText}`}>
                Ch {h.chapterNum}{h.page ? ` · p${h.page}` : ""} · {new Date(h.timestamp).toLocaleDateString()}
              </div>
            </button>
          ))}
        </div>
      </SidePanel>

      <SidePanel title="Reading List" icon={<Bookmark className="h-4 w-4" />} show={showSaved} onClose={() => setShowSaved(false)}>
        <div className="p-4 space-y-1">
          {readingList.length === 0 && (
            <p className={`text-sm ${subText}`}>Nothing saved yet. Open a chapter and tap the bookmark to keep it here.</p>
          )}
          {readingList.map((h) => (
            <div key={h.url} className={`flex items-center gap-1 rounded-lg ${hoverBg}`}>
              <button onClick={() => { loadChapter(h.url); setShowSaved(false); }}
                className={`flex-1 min-w-0 text-left px-3 py-2 text-sm ${isDark ? "text-white/80" : "text-gray-700"}`}>
                <div className="font-medium truncate">{h.mangaName}</div>
                <div className={`text-xs ${subText}`}>Ch {h.chapterNum}{h.page ? ` · p${h.page}` : ""}</div>
              </button>
              <button onClick={() => setReadingList(removeFromList(h.url))}
                aria-label={`Remove ${h.mangaName} chapter ${h.chapterNum} from the reading list`}
                className={`p-2 mr-1 rounded ${subText} ${hoverBg}`} title="Remove"><X className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      </SidePanel>
    </>
  );

  const BannerView = banner ? (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,32rem)]" role="status" aria-live="polite">
      <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 shadow-xl ${isDark ? "bg-[#1a1a1a] border-white/15 text-white" : "bg-white border-gray-300 text-gray-900"}`}>
        <span className="flex-1 text-sm">{banner.text}</span>
        <button onClick={() => setBanner(null)} aria-label="Dismiss message"
          className={`p-0.5 rounded shrink-0 ${subText} ${hoverBg}`}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  ) : null;

  // ─── Loading ────────────────────────────────────────
  if (loading) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center gap-4 p-6 ${bg}`}>
        <Loader2 className={`h-10 w-10 animate-spin ${isDark ? "text-white/60" : "text-gray-400"}`} />
        <p className={`text-sm ${subText}`}>Loading chapter…</p>
        <button onClick={() => setLoading(false)} className={`text-xs underline ${subText}`}>Cancel</button>
      </div>
    );
  }

  // ─── Landing ────────────────────────────────────────
  if (!data) {
    // Chapters the reader actually opened, most recent first. Previously this
    // was `history.find(h => h.page > 1) || history[0]`, which picked whichever
    // entry happened to have a saved page rather than the one last read, so the
    // headline could point at an older chapter than the one just closed.
    const recentChapters = history.slice(0, 4);
    return (
      <div className={`min-h-screen flex flex-col ${bg} ${textCol}`}>
        {BannerView}
        {/* Header */}
        <header className={`border-b px-6 py-4 flex items-center justify-between ${isDark ? "border-white/10" : "border-gray-200"} ${panelBg}`}>
          <div className="flex items-center gap-3">
            <BookOpen className={`h-6 w-6 ${isDark ? "text-white" : "text-gray-900"}`} />
            <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Manga Reader</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowSearch(true)} aria-label="Search manga" className={`p-2 rounded ${subText} ${hoverBg}`} title="Search manga"><Search className="h-5 w-5" /></button>
            <button onClick={() => setShowHistory(true)} aria-label="Reading history" className={`p-2 rounded ${subText} ${hoverBg}`} title="History"><History className="h-5 w-5" /></button>
            <button onClick={() => setShowSaved(true)} aria-label="Reading list" className={`p-2 rounded ${subText} ${hoverBg}`} title="Reading list"><Bookmark className="h-5 w-5" /></button>
            <button onClick={toggleTheme} aria-label="Toggle colour theme" className={`p-2 rounded ${subText} ${hoverBg}`} title="Toggle theme">
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
          </div>
        </header>

        {/* Main */}
        <main className="flex-1 flex flex-col items-center gap-8 p-6">
          {/* Hero */}
          <section className="w-full max-w-3xl text-center pt-10 pb-2">
            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] mb-5 ${isDark ? "bg-white/5 text-white/60" : "bg-gray-100 text-gray-500"}`}>
              <Library className="h-3 w-3" />
              {scope === "all" ? `${catalogueTotal} titles` : `${titles.length} titles`} · {sourceOptions.length} sources
            </div>
            <h2 className={`text-3xl sm:text-4xl font-bold tracking-tight mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>
              Read manga, ad-free
            </h2>
            <p className={`text-sm mb-8 ${subText}`}>
              Search the catalogue, pick a title from the shelf, or paste a chapter URL.
            </p>

            {/* Live search */}
            <div className="relative max-w-xl mx-auto">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${subText}`} />
              <Input placeholder="Search titles across every source…" value={titleQuery}
                onChange={(e) => handleTitleQueryChange(e.target.value)}
                className={`pl-9 h-11 text-base ${isDark ? "bg-white/5 border-white/10 text-white placeholder:text-white/30" : "bg-white border-gray-200 text-gray-900 placeholder:text-gray-400"}`} />
              {titleQuery && (
                <button onClick={() => setTitleQuery("")} className={`absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded ${subText} ${hoverBg}`}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Continue reading. The most recently opened chapter is the
                headline; the rest of the recent chapters sit under it so a
                reader with several on the go can jump back into any of them. */}
            {recentChapters.length > 0 && !titleQuery && (
              <div className="mt-6 max-w-xl mx-auto text-left">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs uppercase tracking-wider ${subText}`}>Continue reading</span>
                  {recentChapters.length > 1 && (
                    <button onClick={() => setShowHistory(true)} className={`text-xs ${subText} hover:underline`}>See all</button>
                  )}
                </div>
                <button onClick={() => loadChapter(recentChapters[0].url)}
                  className={`w-full inline-flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors ${isDark ? "border-white/10 hover:border-white/25 bg-white/[0.03]" : "border-gray-200 hover:border-gray-300 bg-white"}`}>
                  <BookOpen className={`h-5 w-5 shrink-0 ${isDark ? "text-white/70" : "text-gray-500"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">
                      {recentChapters[0].mangaName}
                      {recentChapters[0].chapterNum && <span className={subText}> · Ch {recentChapters[0].chapterNum}</span>}
                      {recentChapters[0].page ? <span className={subText}> · p{recentChapters[0].page}</span> : null}
                    </span>
                  </span>
                  <ChevronRight className={`h-4 w-4 shrink-0 ${subText}`} />
                </button>
                {recentChapters.slice(1, 4).map((entry) => (
                  <button key={entry.url} onClick={() => loadChapter(entry.url)}
                    className={`w-full mt-1 inline-flex items-center gap-3 px-4 py-2 rounded-lg text-left transition-colors ${hoverBg}`}>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm truncate ${subText}`}>
                        {entry.mangaName}
                        {entry.chapterNum && <span> · Ch {entry.chapterNum}</span>}
                        {entry.page ? <span> · p{entry.page}</span> : null}
                      </span>
                    </span>
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${subText}`} />
                  </button>
                ))}
              </div>
            )}

            {/* URL paste */}
            <form onSubmit={handleSubmit} className="mt-6 max-w-xl mx-auto flex gap-2">
              <Input type="url" placeholder="…or paste a chapter URL" value={url} onChange={(e) => setUrl(e.target.value)}
                className={isDark ? "bg-white/5 border-white/10 text-white placeholder:text-white/30" : "bg-white border-gray-200 text-gray-900 placeholder:text-gray-400"} />
              <Button type="submit" variant={isDark ? "default" : "outline"}>Read</Button>
            </form>
          </section>

          {/* Browse titles */}
          <div className="w-full max-w-5xl pb-6 mx-auto">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <h3 className={`text-xs font-semibold uppercase tracking-wider flex items-center gap-2 ${subText}`}>
                <Library className="h-4 w-4" />
                {scope === "all" ? `Catalogue (${visibleTitles.length} of ${catalogueTotal})` : `Shelf ${visibleTitles.length ? `(${visibleTitles.length})` : ""}`}
              </h3>
              <div className="flex items-center gap-2 flex-1 justify-end min-w-[180px] flex-wrap">
                {/* Scope: the curated shelf is small and instant; the full
                    catalogue is ~1200 titles and pages in on demand. */}
                <div className={`flex items-center gap-0.5 p-0.5 rounded-lg ${isDark ? "bg-white/5" : "bg-gray-100"}`} role="tablist" aria-label="Catalogue scope">
                  {(["shelf", "all"] as const).map((s) => (
                    <button key={s} role="tab" aria-selected={scope === s} onClick={() => changeScope(s)}
                      className={`px-2.5 py-1 rounded text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${scope === s
                        ? isDark ? "bg-white/15 text-white" : "bg-white text-gray-900 shadow-sm"
                        : subText}`}>
                      {s === "shelf" ? "Shelf" : `All${allCount ? ` (${allCount})` : ""}`}
                    </button>
                  ))}
                </div>
                <select value={titleSource} onChange={(e) => setTitleSource(e.target.value)}
                  aria-label="Filter by source"
                  className={`text-sm rounded-md border px-2 py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "bg-white/5 border-white/10 text-white/80 focus-visible:outline-white/60" : "bg-white border-gray-200 text-gray-700 focus-visible:outline-gray-500"}`}>
                  <option value="all">All sources</option>
                  {sourceOptions.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* A source that failed to load is called out rather than silently
                shrinking the shelf, which otherwise looks like missing data. */}
            {failedSources.length > 0 && (
              <div className={`mb-3 flex items-center gap-3 rounded-lg border px-3 py-2 text-xs ${isDark ? "border-amber-800/60 bg-amber-900/20 text-amber-200" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
                <span className="flex-1">
                  {failedSources.map((s) => s.name).join(", ")} {failedSources.length === 1 ? "is" : "are"} unavailable right now — some titles are missing.
                </span>
                <button onClick={retryCatalogue} className="underline shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Retry</button>
              </div>
            )}

            {titlesLoading && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="rounded-xl overflow-hidden">
                    <Skeleton className="w-full" style={{ aspectRatio: "2/3" }} />
                  </div>
                ))}
              </div>
            )}

            {!titlesLoading && titlesError && (
              <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${isDark ? "border-red-900 bg-red-950/40 text-red-300" : "border-red-200 bg-red-50 text-red-700"}`}>
                <span className="flex-1">{titlesError}</span>
                <Button size="sm" variant="outline" onClick={retryCatalogue}>Retry</Button>
              </div>
            )}

            {!titlesLoading && !titlesError && visibleTitles.length === 0 && (
              <p className={`text-sm ${subText}`}>
                {titleQuery.trim()
                  ? <>No titles match “{titleQuery.trim()}”{titleSource !== "all" ? " in this source" : ""}. {scope === "shelf" && <button onClick={() => changeScope("all")} className="underline">Search the full catalogue</button>}</>
                  : "No titles match this filter."}
              </p>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {!titlesLoading && visibleTitles.map((t) => (
                <button key={`${t.sourceId}:${t.url}`} onClick={() => openTitle(t)}
                  disabled={openingTitle === t.title}
                  aria-label={`Open ${t.title} from ${t.sourceName}`}
                  className={`group relative text-left rounded-xl overflow-hidden border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${isDark ? "border-white/10 hover:border-white/25 bg-white/[0.03] focus-visible:outline-white/60" : "border-gray-200 hover:border-gray-300 bg-white focus-visible:outline-gray-500"}`}>
                  <div className={`relative w-full overflow-hidden ${isDark ? "bg-white/5" : "bg-gray-100"}`} style={{ aspectRatio: "2/3" }}>
                    {t.thumbnail ? (
                      <img src={PROXY(t.thumbnail)} alt="" loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                    ) : (
                      <div className={`w-full h-full flex items-center justify-center ${subText}`}>
                        <BookOpen className="h-8 w-8" />
                      </div>
                    )}
                    {openingTitle === t.title && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <Loader2 className="h-6 w-6 animate-spin text-white" />
                      </div>
                    )}
                  </div>
                  <div className="p-2.5">
                    <div className={`text-xs font-medium leading-snug line-clamp-2 ${isDark ? "text-white/90" : "text-gray-800"}`}>{t.title}</div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full truncate max-w-full ${isDark ? "bg-white/10 text-white/50" : "bg-gray-100 text-gray-500"}`}>
                        {t.sourceName}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Paging for the full catalogue. */}
            {scope === "all" && !titlesLoading && catalogueHasMore && (
              <div className="flex justify-center mt-5">
                <Button variant="outline" onClick={loadMoreTitles} disabled={loadingMore}>
                  {loadingMore ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Loading…</> : `Load more (${visibleTitles.length} of ${catalogueTotal})`}
                </Button>
              </div>
            )}
          </div>

          {/* Keyboard shortcuts hint */}
          <div className={`text-xs ${subText} text-center space-y-1 pb-6`}>
            <p>Keyboard shortcuts: <kbd className={`px-1 py-0.5 rounded text-[10px] ${isDark ? "bg-white/10" : "bg-gray-200"}`}>←</kbd> <kbd className={`px-1 py-0.5 rounded text-[10px] ${isDark ? "bg-white/10" : "bg-gray-200"}`}>→</kbd> chapters · <kbd className={`px-1 py-0.5 rounded text-[10px] ${isDark ? "bg-white/10" : "bg-gray-200"}`}>T</kbd> theme · <kbd className={`px-1 py-0.5 rounded text-[10px] ${isDark ? "bg-white/10" : "bg-gray-200"}`}>L</kbd> chapter list · <kbd className={`px-1 py-0.5 rounded text-[10px] ${isDark ? "bg-white/10" : "bg-gray-200"}`}>S</kbd> save · <kbd className={`px-1 py-0.5 rounded text-[10px] ${isDark ? "bg-white/10" : "bg-gray-200"}`}>?</kbd> all</p>
          </div>
        </main>

        {/* Side panels */}
        <SidePanel title="Search Manga" icon={<Search className="h-4 w-4" />} show={showSearch} onClose={() => setShowSearch(false)}>
          <div className="p-4 space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Search…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className={isDark ? "bg-white/5 border-white/10 text-white placeholder:text-white/30" : "bg-gray-50 border-gray-200 text-gray-900"} />
              <Button size="sm" onClick={handleSearch} disabled={searchLoading}>Go</Button>
            </div>
            {searchLoading && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>}
            <div className="space-y-1">
              {searchResults.map((r, i) => (
                <button key={i} onClick={() => { loadChapter(r.url); setShowSearch(false); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm ${hoverBg} ${isDark ? "text-white/80" : "text-gray-700"}`}>
                  <div className="font-medium">{r.title}</div>
                  <div className={`text-xs ${subText}`}>{[r.latestChapter, r.source].filter(Boolean).join(" · ")}</div>
                </button>
              ))}
            </div>
          </div>
        </SidePanel>

        {LibraryPanelsView}
      </div>
    );
  }

  // ─── Reader ─────────────────────────────────────────
  if (!data) return null;

  return (
    <div className={`h-screen relative flex flex-col ${bg} ${textCol} overflow-hidden`}>
      {BannerView}
      {LibraryPanelsView}
      {/* Top bar */}
      <header className={`shrink-0 border-b px-3 py-2 flex items-center gap-2 ${barBg} z-40 transition-transform duration-300 ${chromeHidden ? "-translate-y-full" : ""}`} style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
        <button onClick={() => setShowMobileMenu((v) => !v)} aria-label="Open reader menu" aria-expanded={showMobileMenu} className={`p-2.5 rounded sm:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${hoverBg}`}><Menu className="h-5 w-5" /></button>
        <button onClick={goHome} aria-label="Back to library" className={`p-2.5 sm:p-1.5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${hoverBg}`} title="Back to library"><Home className="h-4 w-4" /></button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h1 className="text-sm font-semibold truncate">{data.mangaName}</h1>
          {data.chapterNum && <span className={subText}>· Ch {data.chapterNum}</span>}
          {data.sourceName && <span className={`hidden sm:inline text-[10px] px-1.5 py-0.5 rounded ${isDark ? "bg-white/10 text-white/50" : "bg-gray-100 text-gray-500"}`}>{data.sourceName}</span>}
        </div>

        {/* Desktop buttons */}
        <div className="hidden sm:flex items-center gap-1">
          <button onClick={toggleSaved} aria-label={savedHere ? "Remove from reading list" : "Add to reading list"} aria-pressed={savedHere} className={`p-1.5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${subText} ${hoverBg}`} title={savedHere ? "Saved to reading list (S)" : "Save to reading list (S)"}>
            {savedHere ? <BookmarkCheck className="h-4 w-4" /> : <BookmarkPlus className="h-4 w-4" />}
          </button>
          <button onClick={() => setShowSaved(true)} aria-label="Open reading list" className={`p-1.5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${subText} ${hoverBg}`} title="Reading list"><Bookmark className="h-4 w-4" /></button>
          <button onClick={() => setShowChapters((v) => !v)} className={`px-2 py-1 rounded text-xs transition-colors ${showChapters ? (isDark ? "bg-white/15" : "bg-gray-200") : ""} ${subText} ${hoverBg}`} title="Chapter list (L)"><List className="h-3.5 w-3.5 inline mr-1" />Chapters</button>
          <div className={`w-px h-4 mx-1 ${isDark ? "bg-white/10" : "bg-gray-200"}`} />
          {(["width", "height", "original"] as const).map((fm) => (
            <button key={fm} onClick={() => chooseFitMode(fm)}
              className={`px-2 py-1 rounded text-xs transition-colors ${fitMode === fm ? (isDark ? "bg-white/15" : "bg-gray-200") : ""} ${subText} ${hoverBg}`}>
              {fm === "width" ? "Fit W" : fm === "height" ? "Fit H" : "1:1"}
            </button>
          ))}
          <button onClick={toggleWide} aria-label="Toggle two-page spread" aria-pressed={wide} className={`p-1.5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${wide ? (isDark ? "bg-white/15" : "bg-gray-200") : ""} ${subText} ${hoverBg}`} title="Two-page spread (W)"><Columns2 className="h-4 w-4" /></button>
          <button onClick={togglePaged} aria-label="Toggle one-page view" aria-pressed={paged} className={`px-2 py-1 rounded text-xs transition-colors ${paged ? (isDark ? "bg-white/15" : "bg-gray-200") : ""} ${subText} ${hoverBg}`} title="One page at a time"><Columns2 className="h-3.5 w-3.5 inline mr-1 rotate-90" />Paged</button>
          <button onClick={toggleRtl} aria-label="Toggle right-to-left page order" aria-pressed={rtl} className={`p-1.5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${rtl ? (isDark ? "bg-white/15" : "bg-gray-200") : ""} ${subText} ${hoverBg}`} title="Right-to-left"><ArrowLeftRight className="h-4 w-4" /></button>
          <button onClick={toggleFullscreen} aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} className={`p-1.5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${subText} ${hoverBg}`} title="Fullscreen (F)">
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <div className={`w-px h-4 mx-1 ${isDark ? "bg-white/10" : "bg-gray-200"}`} />
          <button onClick={() => setShowPageJumper((v) => !v)} aria-label={`Jump to page, currently page ${currentPage} of ${totalPages}`} className={`px-2 py-1 rounded text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${subText} ${hoverBg}`} title="Jump to page (G)">
            {currentPage}/{totalPages}
          </button>
          <button onClick={() => setShowShortcuts(true)} aria-label="Keyboard shortcuts" className={`p-1.5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${subText} ${hoverBg}`} title="Keyboard shortcuts (?)"><Keyboard className="h-4 w-4" /></button>
          <button onClick={toggleTheme} aria-label="Toggle colour theme" className={`p-1.5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${subText} ${hoverBg}`} title="Toggle theme (T)">
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Mobile dropdown menu */}
      {showMobileMenu && (
        <div className={`sm:hidden border-b px-3 py-3 flex flex-wrap gap-2 ${barBg} z-30`}>
          <button onClick={() => { goHome(); setShowMobileMenu(false); }} className={`px-3 py-2 rounded text-xs ${hoverBg}`}><Home className="h-3.5 w-3.5 inline mr-1" />Library</button>
          <button onClick={() => { setShowChapters((v) => !v); setShowMobileMenu(false); }} className={`px-3 py-2 rounded text-xs ${hoverBg}`}><List className="h-3.5 w-3.5 inline mr-1" />Chapters</button>
          {(["width", "height", "original"] as const).map((fm) => (
            <button key={fm} onClick={() => { chooseFitMode(fm); setShowMobileMenu(false); }}
              className={`px-3 py-2 rounded text-xs ${fitMode === fm ? (isDark ? "bg-white/15" : "bg-gray-200") : ""} ${hoverBg}`}>
              {fm === "width" ? "Fit Width" : fm === "height" ? "Fit Height" : "Original"}
            </button>
          ))}
          <button onClick={() => { toggleSaved(); setShowMobileMenu(false); }} aria-pressed={savedHere} className={`px-3 py-2 rounded text-xs ${savedHere ? (isDark ? "bg-white/15" : "bg-gray-200") : ""} ${hoverBg}`}>
            {savedHere ? <BookmarkCheck className="h-3.5 w-3.5 inline mr-1" /> : <BookmarkPlus className="h-3.5 w-3.5 inline mr-1" />}
            {savedHere ? "Saved" : "Save"}
          </button>
          <button onClick={() => { setShowSaved(true); setShowMobileMenu(false); }} className={`px-3 py-2 rounded text-xs ${hoverBg}`}>
            <Bookmark className="h-3.5 w-3.5 inline mr-1" />Reading list
          </button>
          <button onClick={() => { toggleWide(); setShowMobileMenu(false); }} aria-pressed={wide} className={`px-3 py-2 rounded text-xs ${wide ? (isDark ? "bg-white/15" : "bg-gray-200") : ""} ${hoverBg}`}>
            <Columns2 className="h-3.5 w-3.5 inline mr-1" />Two-page
          </button>
          <button onClick={() => { togglePaged(); setShowMobileMenu(false); }} aria-pressed={paged} className={`px-3 py-2 rounded text-xs ${paged ? (isDark ? "bg-white/15" : "bg-gray-200") : ""} ${hoverBg}`}>
            <Columns2 className="h-3.5 w-3.5 inline mr-1 rotate-90" />Paged
          </button>
          <button onClick={() => { toggleRtl(); setShowMobileMenu(false); }} aria-pressed={rtl} className={`px-3 py-2 rounded text-xs ${rtl ? (isDark ? "bg-white/15" : "bg-gray-200") : ""} ${hoverBg}`}>
            <ArrowLeftRight className="h-3.5 w-3.5 inline mr-1" />RTL
          </button>
          <button onClick={() => { toggleFullscreen(); setShowMobileMenu(false); }} className={`px-3 py-2 rounded text-xs ${hoverBg}`}>
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5 inline mr-1" /> : <Maximize2 className="h-3.5 w-3.5 inline mr-1" />}Fullscreen
          </button>
          <button onClick={() => { setShowPageJumper((v) => !v); setShowMobileMenu(false); }} className={`px-3 py-2 rounded text-xs ${hoverBg}`}>Page {currentPage}/{totalPages}</button>
          <button onClick={() => { toggleTheme(); setShowMobileMenu(false); }} className={`px-3 py-2 rounded text-xs ${hoverBg}`}>
            {isDark ? <Sun className="h-3.5 w-3.5 inline mr-1" /> : <Moon className="h-3.5 w-3.5 inline mr-1" />}Theme
          </button>
          <button onClick={() => { setShowShortcuts(true); setShowMobileMenu(false); }} className={`px-3 py-2 rounded text-xs ${hoverBg}`}>
            <Keyboard className="h-3.5 w-3.5 inline mr-1" />Shortcuts
          </button>
        </div>
      )}

      {/* Page jumper overlay */}
      {showPageJumper && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 p-3 rounded-lg shadow-xl border"
          style={{ backgroundColor: isDark ? "#1a1a1a" : "#fff", borderColor: isDark ? "rgba(255,255,255,0.1)" : "#e5e5e5" }}>
          <span className={`text-xs ${subText}`}>Jump to:</span>
          <input type="number" min={1} max={totalPages} value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") jumpToPage(parseInt(pageInput)); }}
            placeholder={`1-${totalPages}`}
            className={`w-20 px-2 py-1 rounded text-sm ${isDark ? "bg-white/10 text-white" : "bg-gray-100 text-gray-900"}`}
            autoFocus />
          <Button size="sm" onClick={() => jumpToPage(parseInt(pageInput))} disabled={!pageInput}>Go</Button>
        </div>
      )}

      {/* Chapter sidebar */}
      <SidePanel title={`Chapters (${chapters.length})`} icon={<List className="h-4 w-4" />} show={showChapters} onClose={() => setShowChapters(false)}>
        <div className="p-3">
          {chaptersLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>}
          {chapters.length === 0 && !chaptersLoading && <p className={`text-sm text-center py-8 ${subText}`}>Load a chapter first to see the list</p>}

          {canGroupByVolume && (
            <div className={`flex items-center gap-1 mb-2 p-0.5 rounded-lg ${isDark ? "bg-white/5" : "bg-gray-100"}`}>
              {(["chapter", "volume"] as GroupMode[]).map((m) => (
                <button key={m} onClick={() => setGroupMode(m)}
                  className={`flex-1 px-2 py-1 rounded text-xs capitalize transition-colors ${groupMode === m
                    ? isDark ? "bg-white/15 text-white" : "bg-white text-gray-900 shadow-sm"
                    : subText}`}>
                  {m === "chapter" ? "All chapters" : `By volume (${volumes.length})`}
                </button>
              ))}
            </div>
          )}

          {groupMode === "chapter" || !canGroupByVolume ? (
            <div className="space-y-0.5 max-h-[70vh] overflow-y-auto">
              {chapters.map((ch) => {
                const isCurrent = ch.num === Number(data.chapterNum);
                return (
                  <button key={ch.url} onClick={() => { loadChapter(ch.url); setShowChapters(false); }}
                    className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${isCurrent
                      ? (isDark ? "bg-white/15" : "bg-gray-200") + " font-semibold"
                      : hoverBg
                    } ${isCurrent ? textCol : subText}`}>
                    {ch.title || `Chapter ${ch.num}`}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2 max-h-[70vh] overflow-y-auto">
              {volumeGroups.map(([vol, items]) => (
                <details key={vol} open={items.some((c) => c.num === Number(data.chapterNum))}>
                  <summary className={`cursor-pointer text-xs font-semibold uppercase tracking-wider px-2 py-1 rounded ${subText} ${hoverBg}`}>
                    {vol === "Other" ? "Unnumbered" : `Volume ${vol}`}
                    <span className="ml-2 font-normal normal-case">({items.length})</span>
                  </summary>
                  <div className="mt-0.5 space-y-0.5">
                    {items.map((ch) => {
                      const isCurrent = ch.num === Number(data.chapterNum);
                      return (
                        <button key={ch.url} onClick={() => { loadChapter(ch.url); setShowChapters(false); }}
                          className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${isCurrent
                            ? (isDark ? "bg-white/15" : "bg-gray-200") + " font-semibold"
                            : hoverBg
                          } ${isCurrent ? textCol : subText}`}>
                          {ch.title || `Chapter ${ch.num}`}
                        </button>
                      );
                    })}
                  </div>
                </details>
              ))}
            </div>
          )}

          {canGroupByVolume && (
            <p className={`text-[10px] mt-3 ${subText}`}>
              Volume numbers come from MangaDex and may not cover every chapter.
            </p>
          )}
        </div>
      </SidePanel>

      {/* Image area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto relative" onClick={onImageClick}>
        {data.warning && (
          <div className="max-w-2xl mx-auto mt-6 px-4">
            <div className={`rounded-lg border p-4 text-sm ${isDark ? "bg-yellow-900/20 border-yellow-800 text-yellow-300" : "bg-yellow-50 border-yellow-200 text-yellow-700"}`}>
              {data.warning}
            </div>
          </div>
        )}
        <div className={`flex flex-col items-center ${wide ? "mx-auto max-w-[1600px]" : ""}`} dir={rtl ? "rtl" : undefined}>
          {(paged ? (pagedGroup ? [pagedGroup] : []) : pageGroups).map((group, gi) => (
            <div key={gi} className={`w-full flex ${group.length > 1 ? "flex-row justify-center" : "flex-col items-center"}`}>
              {group.map((i) => (
                <div key={i} className="relative w-full" style={i === 0 ? { marginTop: data.warning ? "0.5rem" : "0" } : undefined}>
                  {!loadedImages.has(i) && (
                    // A neutral placeholder keeps scroll position stable while
                    // the real dimensions are unknown; no fixed ratio to guess.
                    <div className={`w-full mx-auto ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} animate-pulse`} style={{ minHeight: "70vh", maxWidth: wide ? "50%" : "800px" }} />
                  )}
                  <img ref={(el) => { if (el) imgRefs.current.set(i, el); }}
                    src={displayImages[i]} alt={`Page ${i + 1}`} onLoad={() => handleImageLoad(i)}
                    style={{ ...wideStyle, display: loadedImages.has(i) ? "block" : "none" }}
                    // Paged mode renders only the visible page, so its index can
                    // be any number; it must load eagerly or the lazy heuristic
                    // would leave a blank page until it scrolls into view, which
                    // never happens here.
                    loading={paged || i < 3 ? "eager" : "lazy"} />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="h-20" />
      </div>

      {/* Bottom nav */}
      <nav className={`shrink-0 border-t px-4 py-2 flex items-center justify-between ${barBg} z-40 transition-transform duration-300 ${chromeHidden ? "translate-y-full" : ""}`} style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
        <Button variant="ghost" size="sm" disabled={!data.prevUrl} aria-label="Previous chapter" onClick={(e) => { e.stopPropagation(); goToChapter(data.prevUrl); }}>
          <ChevronLeft className="h-4 w-4 mr-1" /><span className="hidden sm:inline">Prev</span>
        </Button>

        <div className="flex items-center gap-2">
          {paged && (
            <button onClick={(e) => { e.stopPropagation(); retreat(); }} aria-label="Previous page" disabled={currentPage <= 1 && !data.prevUrl} className={`p-1.5 rounded disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${subText} ${hoverBg}`}>
              {/* In RTL the previous page is to the right, so the icon flips. */}
              {rtl ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); setShowPageJumper(true); }} aria-label={`Jump to page, currently page ${currentPage} of ${totalPages}`} className={`px-2 py-1.5 rounded text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${subText} ${hoverBg}`}>
            {currentPage}/{totalPages}
          </button>
          {paged && (
            <button onClick={(e) => { e.stopPropagation(); advance(); }} aria-label="Next page" disabled={currentPage >= totalPages && !data.nextUrl} className={`p-1.5 rounded disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${subText} ${hoverBg}`}>
              {rtl ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          )}
        </div>

        <Button variant="ghost" size="sm" disabled={!data.nextUrl} aria-label="Next chapter" onClick={(e) => { e.stopPropagation(); goToChapter(data.nextUrl); }}>
          <span className="hidden sm:inline">Next</span><ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </nav>

      {/* Reading progress, pinned to the very bottom edge. */}
      {totalPages > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 z-50" aria-hidden="true">
          <div className={`h-full transition-[width] duration-150 ${isDark ? "bg-white/60" : "bg-gray-700"}`}
            style={{ width: `${Math.min(100, (currentPage / totalPages) * 100)}%` }} />
        </div>
      )}

      {/* Keyboard shortcuts */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowShortcuts(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className={`relative w-full max-w-sm rounded-xl border shadow-2xl p-5 ${panelBg} ${textCol}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-sm flex items-center gap-2"><Keyboard className="h-4 w-4" /> Keyboard shortcuts</h2>
              <button onClick={() => setShowShortcuts(false)} aria-label="Close shortcuts" className={`p-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${hoverBg}`}><X className="h-4 w-4" /></button>
            </div>
            <dl className="space-y-2 text-sm">
              {[
                ["← / →", paged ? "Previous / next page" : "Previous / next chapter"],
                ["G", "Jump to page"],
                ["L", "Chapter list"],
                ["S", "Save to reading list"],
                ["W", "Two-page spread"],
                ["F", "Fullscreen"],
                ["T", "Toggle theme"],
                ["?", "This panel"],
                ["Esc", "Close panels"],
              ].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <dt className={`text-xs ${subText}`}>{label}</dt>
                  <dd><kbd className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${isDark ? "bg-white/10" : "bg-gray-200"}`}>{key}</kbd></dd>
                </div>
              ))}
            </dl>
            <p className={`text-[10px] mt-4 ${subText}`}>
              {paged
                ? "Click the page to turn it; at the last page it moves to the next chapter. Turn on RTL for right-to-left manga."
                : "Click the page area to scroll down; at the last page it moves to the next chapter. On a touch screen, swipe left or right to change chapter."}
            </p>
          </div>
        </div>
      )}

      {/* Scroll to top */}
      {showScrollTop && !paged && (
        <button onClick={(e) => { e.stopPropagation(); scrollToTop(); }}
          className={`fixed bottom-20 right-4 p-2.5 rounded-full shadow-lg transition-all z-30 ${isDark ? "bg-white/10 hover:bg-white/20 text-white" : "bg-white hover:bg-gray-100 text-gray-900 border"}`}
          aria-label="Scroll to top"><ArrowUp className="h-5 w-5" /></button>
      )}
    </div>
  );
}