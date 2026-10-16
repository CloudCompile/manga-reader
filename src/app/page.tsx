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
} from "lucide-react";
import {
  getHistory,
  pushHistory,
  getLastRead,
  setLastRead,
  getTheme,
  setTheme as persistTheme,
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

type Theme = "dark" | "light";
type FitMode = "width" | "height" | "original";
type GroupMode = "chapter" | "volume";

const PROXY = (src: string) => `/api/proxy?url=${encodeURIComponent(src)}`;

// ─── Component ───────────────────────────────────────
export default function MangaReader() {
  const [url, setUrl] = useState("");
  const [data, setData] = useState<ChapterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [fitMode, setFitMode] = useState<FitMode>("width");
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
  const [titleQuery, setTitleQuery] = useState("");
  const [titleSource, setTitleSource] = useState("all");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageInput, setPageInput] = useState("");
  const [showPageJumper, setShowPageJumper] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const imgRefs = useRef<Map<number, HTMLImageElement>>(new Map());

  // Init
  useEffect(() => {
    setHistory(getHistory());
    const saved = getLastRead();
    if (saved) setUrl(saved);
    setTheme(getTheme());
  }, []);

  // Title listing for the browse grid
  useEffect(() => {
    let active = true;
    (async () => {
      setTitlesLoading(true);
      setTitlesError("");
      try {
        const res = await fetch("/api/titles");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load titles");
        if (active) setTitles(json);
      } catch (err) {
        if (active) setTitlesError(err instanceof Error ? err.message : "Failed to load titles");
      } finally {
        if (active) setTitlesLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Scroll listener
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      setShowScrollTop(el.scrollTop > 600);
      // Track which page we're viewing
      const imgs = el.querySelectorAll("img");
      for (let i = 0; i < imgs.length; i++) {
        const rect = imgs[i].getBoundingClientRect();
        if (rect.top >= -rect.height / 2) {
          setCurrentPage(i + 1);
          break;
        }
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [data]);

  // Set initial page to 1 when data loads
  useEffect(() => { if (data?.images.length) setCurrentPage(1); }, [data?.images.length]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft" && data?.prevUrl) {
        e.preventDefault();
        goToChapter(data.prevUrl);
      } else if (e.key === "ArrowRight" && data?.nextUrl) {
        e.preventDefault();
        goToChapter(data.nextUrl);
      } else if (e.key === "t" || e.key === "T") {
        toggleTheme();
      } else if (e.key === "l" || e.key === "L") {
        setShowChapters((v) => !v);
      } else if (e.key === "Escape") {
        setShowChapters(false);
        setShowSearch(false);
        setShowHistory(false);
        setShowPageJumper(false);
        setShowMobileMenu(false);
      } else if (e.key === "g" || e.key === "G") {
        setShowPageJumper((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [data]);

  const handleImageLoad = useCallback((index: number) => {
    setLoadedImages((prev) => new Set(prev).add(index));
  }, []);

  const loadChapter = useCallback(async (chapterUrl: string) => {
    if (!chapterUrl.trim()) return;
    setLoading(true);
    setError("");
    setData(null);
    setLoadedImages(new Set());
    setCurrentPage(0);
    setShowScrollTop(false);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setUrl(chapterUrl);
    setLastRead(chapterUrl);
    setShowChapters(false);
    setShowMobileMenu(false);

    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: chapterUrl }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load chapter");
      setData(json);
      setHistory(
        pushHistory({ url: chapterUrl, mangaName: json.mangaName, chapterNum: json.chapterNum, timestamp: Date.now() })
      );

      // Fetch chapter list in background for the sidebar and navigation.
      fetchChapterList(chapterUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
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
  // empty placeholder ("coming soon").
  const openTitle = useCallback(async (title: TitleItem) => {
    try {
      const res = await fetch("/api/chapters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: title.url }),
      });
      const json = await res.json();
      const list: ChapterItem[] = json.chapters || [];
      if (!res.ok || !list.length) {
        setError("No readable chapters found for this title yet.");
        return;
      }

      for (const candidate of list.slice(0, 3)) {
        const sres = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: candidate.url }),
        });
        const scraped = await sres.json();
        if (sres.ok && (scraped.images || []).length) {
          loadChapter(candidate.url);
          return;
        }
      }
      loadChapter(list[0].url);
    } catch {
      setError("Could not open this title.");
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
  const scrollToTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    persistTheme(next);
  };

  const jumpToPage = (page: number) => {
    const img = imgRefs.current.get(page - 1);
    if (img) img.scrollIntoView({ behavior: "smooth", block: "start" });
    setShowPageJumper(false);
    setPageInput("");
  };

  const totalPages = data?.images.length || 0;
  const displayImages = data ? data.images.map(PROXY) : [];
  const isDark = theme === "dark";

  // Distinct sources in the listing, ordered with the single-series hosts first.
  const sourceOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of titles) if (!seen.has(t.sourceId)) seen.set(t.sourceId, t.sourceName);
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [titles]);

  const visibleTitles = useMemo(() => {
    const q = titleQuery.trim().toLowerCase();
    return titles.filter(
      (t) =>
        (titleSource === "all" || t.sourceId === titleSource) &&
        (!q || t.title.toLowerCase().includes(q))
    );
  }, [titles, titleQuery, titleSource]);

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
            <button onClick={onClose} className={`p-1 rounded ${hoverBg}`}><X className="h-4 w-4" /></button>
          </div>
          <ScrollArea className="flex-1">{children}</ScrollArea>
        </div>
      </div>
    );
  };

  // ─── Loading ────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 bg-[#0a0a0a]">
        <Loader2 className="h-10 w-10 animate-spin text-white/60" />
        <p className="text-white/60 text-sm">Loading chapter…</p>
      </div>
    );
  }

  // ─── Landing ────────────────────────────────────────
  if (!data && !error) {
    return (
      <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
        {/* Header */}
        <header className={`border-b px-6 py-4 flex items-center justify-between ${isDark ? "border-white/10" : "border-gray-200"} ${panelBg}`}>
          <div className="flex items-center gap-3">
            <BookOpen className="h-6 w-6 text-white" />
            <h1 className="text-xl font-bold text-white">Manga Reader</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowSearch(true)} className={`p-2 rounded ${isDark ? "text-white/60 hover:bg-white/10" : "text-gray-500 hover:bg-gray-100"}`} title="Search manga"><Search className="h-5 w-5" /></button>
            <button onClick={() => setShowHistory(true)} className={`p-2 rounded ${isDark ? "text-white/60 hover:bg-white/10" : "text-gray-500 hover:bg-gray-100"}`} title="History"><History className="h-5 w-5" /></button>
            <button onClick={toggleTheme} className={`p-2 rounded ${isDark ? "text-white/60 hover:bg-white/10" : "text-gray-500 hover:bg-gray-100"}`}><Sun className="h-5 w-5" /></button>
          </div>
        </header>

        {/* Main */}
        <main className="flex-1 flex flex-col items-center gap-8 p-6">
          <div className="text-center max-w-lg pt-6">
            <h2 className="text-2xl font-bold text-white mb-2">Read manga, ad-free</h2>
            <p className="text-white/50 text-sm">Pick a title below, paste a chapter URL from a supported site, or search for a manga.</p>
          </div>

          <form onSubmit={handleSubmit} className="w-full max-w-lg flex gap-2">
            <Input type="url" placeholder="https://example.com/manga/title-chapter-1/" value={url} onChange={(e) => setUrl(e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
            <Button type="submit">Read</Button>
          </form>

          {/* Recent History */}
          {history.length > 0 && (
            <div className="w-full max-w-lg">
              <h3 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${subText}`}>Recent</h3>
              <div className="space-y-1">
                {history.slice(0, 5).map((h) => (
                  <button key={h.url} onClick={() => loadChapter(h.url)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${isDark ? "hover:bg-white/5 text-white/70" : "hover:bg-gray-100 text-gray-600"}`}>
                    <span className="font-medium">{h.mangaName}</span>
                    {h.chapterNum && <span className={subText}> · Ch {h.chapterNum}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Browse titles */}
          <div className="w-full max-w-5xl pb-6">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <h3 className={`text-xs font-semibold uppercase tracking-wider flex items-center gap-2 ${subText}`}>
                <Library className="h-4 w-4" /> All titles {titles.length ? `(${titles.length})` : ""}
              </h3>
              <div className="flex items-center gap-2 flex-1 justify-end min-w-[240px]">
                <Input placeholder="Filter by name…" value={titleQuery} onChange={(e) => setTitleQuery(e.target.value)}
                  className="max-w-[220px] bg-white/5 border-white/10 text-white placeholder:text-white/30" />
                <select value={titleSource} onChange={(e) => setTitleSource(e.target.value)}
                  className={`text-sm rounded-md border px-2 py-1.5 ${isDark ? "bg-white/5 border-white/10 text-white/80" : "bg-white border-gray-200 text-gray-700"}`}>
                  <option value="all">All sources</option>
                  {sourceOptions.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {titlesLoading && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="rounded-lg overflow-hidden">
                    <Skeleton className="w-full" style={{ aspectRatio: "2/3" }} />
                  </div>
                ))}
              </div>
            )}

            {!titlesLoading && titlesError && (
              <p className="text-sm text-red-400">{titlesError}</p>
            )}

            {!titlesLoading && !titlesError && visibleTitles.length === 0 && (
              <p className={`text-sm ${subText}`}>No titles match this filter.</p>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {!titlesLoading && visibleTitles.map((t) => (
                <button key={`${t.sourceId}:${t.url}`} onClick={() => openTitle(t)}
                  className={`group text-left rounded-lg overflow-hidden border transition-colors ${isDark ? "border-white/10 hover:border-white/25 bg-white/[0.03]" : "border-gray-200 hover:border-gray-300 bg-white"}`}>
                  <div className={`relative w-full overflow-hidden ${isDark ? "bg-white/5" : "bg-gray-100"}`} style={{ aspectRatio: "2/3" }}>
                    {t.thumbnail ? (
                      <img src={t.thumbnail} alt="" loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <div className={`w-full h-full flex items-center justify-center ${subText}`}>
                        <BookOpen className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <div className={`text-xs font-medium leading-snug line-clamp-2 ${isDark ? "text-white/90" : "text-gray-800"}`}>{t.title}</div>
                    <div className={`text-[10px] mt-1 ${subText}`}>
                      {t.sourceName}{t.latestChapter ? ` · ${t.latestChapter}` : ""}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Keyboard shortcuts hint */}
          <div className={`text-xs ${subText} text-center space-y-1 pb-6`}>
            <p>Keyboard shortcuts: <kbd className="px-1 py-0.5 rounded bg-white/10 text-[10px]">←</kbd> <kbd className="px-1 py-0.5 rounded bg-white/10 text-[10px]">→</kbd> chapters · <kbd className="px-1 py-0.5 rounded bg-white/10 text-[10px]">T</kbd> theme · <kbd className="px-1 py-0.5 rounded bg-white/10 text-[10px]">L</kbd> chapter list</p>
          </div>
        </main>

        {/* Side panels */}
        <SidePanel title="Search Manga" icon={<Search className="h-4 w-4" />} show={showSearch} onClose={() => setShowSearch(false)}>
          <div className="p-4 space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Search…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
              <Button size="sm" onClick={handleSearch} disabled={searchLoading}>Go</Button>
            </div>
            {searchLoading && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>}
            <div className="space-y-1">
              {searchResults.map((r, i) => (
                <button key={i} onClick={() => { loadChapter(r.url); setShowSearch(false); }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-white/5 text-white/80">
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-white/40">{[r.latestChapter, r.source].filter(Boolean).join(" · ")}</div>
                </button>
              ))}
            </div>
          </div>
        </SidePanel>

        <SidePanel title="Reading History" icon={<History className="h-4 w-4" />} show={showHistory} onClose={() => setShowHistory(false)}>
          <div className="p-4 space-y-1">
            {history.length === 0 && <p className="text-white/40 text-sm">No history yet</p>}
            {history.map((h) => (
              <button key={h.url} onClick={() => { loadChapter(h.url); setShowHistory(false); }}
                className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-white/5 text-white/80">
                <div className="font-medium">{h.mangaName}</div>
                <div className="text-xs text-white/40">Ch {h.chapterNum} · {new Date(h.timestamp).toLocaleDateString()}</div>
              </button>
            ))}
          </div>
        </SidePanel>
      </div>
    );
  }

  // ─── Error ──────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6 bg-[#0a0a0a]">
        <p className="text-red-400 text-sm max-w-md text-center">{error}</p>
        <form onSubmit={handleSubmit} className="w-full max-w-lg flex gap-2">
          <Input type="url" placeholder="Try a different URL…" value={url} onChange={(e) => setUrl(e.target.value)}
            className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
          <Button type="submit">Retry</Button>
        </form>
        {data?.prevUrl && <Button variant="outline" onClick={() => goToChapter(data.prevUrl)}><ChevronLeft className="h-4 w-4 mr-1" /> Previous Chapter</Button>}
      </div>
    );
  }

  // ─── Reader ─────────────────────────────────────────
  if (!data) return null;

  return (
    <div className={`h-screen flex flex-col ${bg} ${textCol} overflow-hidden`}>
      {/* Top bar */}
      <header className={`shrink-0 border-b px-3 py-2 flex items-center gap-2 ${barBg} z-40`}>
        <button onClick={() => setShowMobileMenu((v) => !v)} className={`p-1.5 rounded sm:hidden ${hoverBg}`}><Menu className="h-5 w-5" /></button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <BookOpen className="h-4 w-4 shrink-0" />
          <h1 className="text-sm font-semibold truncate">{data.mangaName}</h1>
          {data.chapterNum && <span className={subText}>· Ch {data.chapterNum}</span>}
          {data.sourceName && <span className={`hidden sm:inline text-[10px] px-1.5 py-0.5 rounded ${isDark ? "bg-white/10 text-white/50" : "bg-gray-100 text-gray-500"}`}>{data.sourceName}</span>}
        </div>

        {/* Desktop buttons */}
        <div className="hidden sm:flex items-center gap-1">
          <button onClick={() => setShowChapters((v) => !v)} className={`px-2 py-1 rounded text-xs transition-colors ${showChapters ? "bg-white/15" : ""} ${subText} ${hoverBg}`} title="Chapter list (L)"><List className="h-3.5 w-3.5 inline mr-1" />Chapters</button>
          <div className="w-px h-4 bg-white/10 mx-1" />
          {(["width", "height", "original"] as const).map((fm) => (
            <button key={fm} onClick={() => setFitMode(fm)}
              className={`px-2 py-1 rounded text-xs transition-colors ${fitMode === fm ? "bg-white/15" : ""} ${subText} ${hoverBg}`}>
              {fm === "width" ? "Fit W" : fm === "height" ? "Fit H" : "1:1"}
            </button>
          ))}
          <div className="w-px h-4 bg-white/10 mx-1" />
          <button onClick={() => setShowPageJumper((v) => !v)} className={`px-2 py-1 rounded text-xs ${subText} ${hoverBg}`} title="Jump to page (G)">
            {currentPage}/{totalPages}
          </button>
          <button onClick={toggleTheme} className={`p-1.5 rounded ${hoverBg} ${subText}`}><Sun className="h-4 w-4" /></button>
        </div>
      </header>

      {/* Mobile dropdown menu */}
      {showMobileMenu && (
        <div className={`sm:hidden border-b px-3 py-3 flex flex-wrap gap-2 ${barBg} z-30`}>
          <button onClick={() => { setShowChapters((v) => !v); setShowMobileMenu(false); }} className={`px-3 py-1.5 rounded text-xs ${hoverBg}`}><List className="h-3.5 w-3.5 inline mr-1" />Chapters</button>
          {(["width", "height", "original"] as const).map((fm) => (
            <button key={fm} onClick={() => { setFitMode(fm); setShowMobileMenu(false); }}
              className={`px-3 py-1.5 rounded text-xs ${fitMode === fm ? "bg-white/15" : ""} ${hoverBg}`}>
              {fm === "width" ? "Fit Width" : fm === "height" ? "Fit Height" : "Original"}
            </button>
          ))}
          <button onClick={() => { setShowPageJumper((v) => !v); setShowMobileMenu(false); }} className={`px-3 py-1.5 rounded text-xs ${hoverBg}`}>Page {currentPage}/{totalPages}</button>
          <button onClick={() => { toggleTheme(); setShowMobileMenu(false); }} className={`px-3 py-1.5 rounded text-xs ${hoverBg}`}>
            {isDark ? <Sun className="h-3.5 w-3.5 inline mr-1" /> : <Moon className="h-3.5 w-3.5 inline mr-1" />}Theme
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
          {chapters.length === 0 && !chaptersLoading && <p className="text-white/40 text-sm text-center py-8">Load a chapter first to see the list</p>}

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
                      ? "bg-white/15 font-semibold"
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
                            ? "bg-white/15 font-semibold"
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto relative">
        {data.warning && (
          <div className="max-w-2xl mx-auto mt-6 px-4">
            <div className={`rounded-lg border p-4 text-sm ${isDark ? "bg-yellow-900/20 border-yellow-800 text-yellow-300" : "bg-yellow-50 border-yellow-200 text-yellow-700"}`}>
              {data.warning}
            </div>
          </div>
        )}
        <div className="flex flex-col items-center">
          {displayImages.map((src, i) => (
            <div key={i} className="relative w-full" style={i === 0 ? { marginTop: data.warning ? "0.5rem" : "0" } : undefined}>
              {!loadedImages.has(i) && (
                <Skeleton className="w-full mx-auto" style={{ aspectRatio: "2/3", maxWidth: "800px" }} />
              )}
              <img ref={(el) => { if (el) imgRefs.current.set(i, el); }}
                src={src} alt={`Page ${i + 1}`} onLoad={() => handleImageLoad(i)}
                style={{ ...imgStyle, display: loadedImages.has(i) ? "block" : "none" }}
                loading="eager" />
            </div>
          ))}
        </div>
        <div className="h-20" />
      </div>

      {/* Bottom nav */}
      <nav className={`shrink-0 border-t px-4 py-2 flex items-center justify-between ${barBg} z-40`}>
        <Button variant="ghost" size="sm" disabled={!data.prevUrl} onClick={() => goToChapter(data.prevUrl)}>
          <ChevronLeft className="h-4 w-4 mr-1" /><span className="hidden sm:inline">Prev</span>
        </Button>

        <div className="flex items-center gap-2">
          <button onClick={() => setShowPageJumper(true)} className={`px-2 py-1 rounded text-xs ${subText} ${hoverBg}`}>
            {currentPage}/{totalPages}
          </button>
        </div>

        <Button variant="ghost" size="sm" disabled={!data.nextUrl} onClick={() => goToChapter(data.nextUrl)}>
          <span className="hidden sm:inline">Next</span><ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </nav>

      {/* Scroll to top */}
      {showScrollTop && (
        <button onClick={scrollToTop}
          className={`fixed bottom-20 right-4 p-2.5 rounded-full shadow-lg transition-all z-30 ${isDark ? "bg-white/10 hover:bg-white/20 text-white" : "bg-white hover:bg-gray-100 text-gray-900 border"}`}
          aria-label="Scroll to top"><ArrowUp className="h-5 w-5" /></button>
      )}
    </div>
  );
}