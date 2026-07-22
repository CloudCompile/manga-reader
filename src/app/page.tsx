"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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
  Download,
  ChevronDown,
  Menu,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────
interface ChapterData {
  title: string;
  images: string[];
  prevUrl: string | null;
  nextUrl: string | null;
  mangaName: string;
  chapterNum: string;
  seriesSlug: string;
  warning?: string;
}

interface ChapterItem {
  num: number;
  url: string;
  title: string;
}

interface HistoryEntry {
  url: string;
  mangaName: string;
  chapterNum: string;
  timestamp: number;
}

interface OfflineChapter {
  url: string;
  mangaName: string;
  chapterNum: string;
  images: string[];
  savedAt: number;
}

type Theme = "dark" | "light";
type FitMode = "width" | "height" | "original";

const PROXY = (src: string) => `/api/proxy?url=${encodeURIComponent(src)}`;

// ─── LocalStorage helpers ────────────────────────────
function getHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem("manga-history") || "[]"); } catch { return []; }
}
function saveHistory(entry: HistoryEntry) {
  const h = getHistory().filter((e) => e.url !== entry.url);
  h.unshift({ ...entry, timestamp: Date.now() });
  localStorage.setItem("manga-history", JSON.stringify(h.slice(0, 50)));
}
function getLastRead(): string | null {
  return localStorage.getItem("manga-last-read");
}
function setLastRead(url: string) {
  localStorage.setItem("manga-last-read", url);
}

// ─── IndexedDB for offline ───────────────────────────
const DB_NAME = "manga-offline";
const DB_VERSION = 1;
const STORE = "chapters";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "url" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveOffline(data: OfflineChapter) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getOffline(url: string): Promise<OfflineChapter | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(url);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function getAllOffline(): Promise<OfflineChapter[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function deleteOffline(url: string) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(url);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Component ───────────────────────────────────────
export default function MangaReader() {
  const [url, setUrl] = useState("");
  const [data, setData] = useState<ChapterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("manga-theme") as Theme) || "dark"
  );
  const [fitMode, setFitMode] = useState<FitMode>("width");
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [showChapters, setShowChapters] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ title: string; latestChapter: string; url: string }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [offlineChapters, setOfflineChapters] = useState<OfflineChapter[]>([]);
  const [showOffline, setShowOffline] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageInput, setPageInput] = useState("");
  const [showPageJumper, setShowPageJumper] = useState(false);
  const [savingOffline, setSavingOffline] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const imgRefs = useRef<Map<number, HTMLImageElement>>(new Map());

  // Init
  useEffect(() => {
    setHistory(getHistory());
    getAllOffline().then(setOfflineChapters).catch(() => {});
    const saved = getLastRead();
    if (saved) setUrl(saved);
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
        setShowOffline(false);
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

  const loadChapter = useCallback(async (chapterUrl: string, offline?: OfflineChapter) => {
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
      if (offline) {
        // Load from offline cache
        const chapterData: ChapterData = {
          title: `${offline.mangaName}, Chapter ${offline.chapterNum}`,
          images: offline.images,
          prevUrl: null,
          nextUrl: null,
          mangaName: offline.mangaName,
          chapterNum: offline.chapterNum,
          seriesSlug: "",
          warning: "Offline mode — navigation disabled",
        };
        setData(chapterData);
        setIsOfflineMode(true);
      } else {
        setIsOfflineMode(false);
        const res = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: chapterUrl }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load chapter");
        setData(json);
        saveHistory({ url: chapterUrl, mangaName: json.mangaName, chapterNum: json.chapterNum, timestamp: Date.now() });
        setHistory(getHistory());

        // Fetch chapter list in background
        if (json.seriesSlug) fetchChapterList(chapterUrl);
      }
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
      if (res.ok) setChapters(json.chapters || []);
    } catch {
      // Silent fail for chapter list
    } finally {
      setChaptersLoading(false);
    }
  };

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

  const handleSaveOffline = async () => {
    if (!data || data.images.length === 0) return;
    setSavingOffline(true);
    try {
      // Pre-fetch all images through proxy to cache them
      const imageUrls = data.images.map(PROXY);
      await saveOffline({
        url,
        mangaName: data.mangaName,
        chapterNum: data.chapterNum,
        images: imageUrls,
        savedAt: Date.now(),
      });
      const updated = await getAllOffline();
      setOfflineChapters(updated);
    } catch { /* ignore */ }
    finally { setSavingOffline(false); }
  };

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); loadChapter(url); };
  const goToChapter = (chapterUrl: string | null) => { if (chapterUrl) loadChapter(chapterUrl); };
  const scrollToTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("manga-theme", next);
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
            <button onClick={() => setShowOffline(true)} className={`p-2 rounded ${isDark ? "text-white/60 hover:bg-white/10" : "text-gray-500 hover:bg-gray-100"}`} title="Offline"><Download className="h-5 w-5" /></button>
            <button onClick={toggleTheme} className={`p-2 rounded ${isDark ? "text-white/60 hover:bg-white/10" : "text-gray-500 hover:bg-gray-100"}`}><Sun className="h-5 w-5" /></button>
          </div>
        </header>

        {/* Main */}
        <main className="flex-1 flex flex-col items-center justify-center gap-8 p-6">
          <div className="text-center max-w-lg">
            <h2 className="text-2xl font-bold text-white mb-2">Read manga, ad-free</h2>
            <p className="text-white/50 text-sm">Paste a mangafragrant.com chapter URL, pick from your history, or search for a manga.</p>
          </div>

          <form onSubmit={handleSubmit} className="w-full max-w-lg flex gap-2">
            <Input type="url" placeholder="https://www.mangafragrant.com/manga/..." value={url} onChange={(e) => setUrl(e.target.value)}
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

          {/* Keyboard shortcuts hint */}
          <div className={`text-xs ${subText} text-center space-y-1`}>
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
                  {r.latestChapter && <div className="text-xs text-white/40">{r.latestChapter}</div>}
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

        <SidePanel title="Offline Library" icon={<Download className="h-4 w-4" />} show={showOffline} onClose={() => setShowOffline(false)}>
          <div className="p-4 space-y-1">
            {offlineChapters.length === 0 && <p className="text-white/40 text-sm">No saved chapters</p>}
            {offlineChapters.map((o) => (
              <div key={o.url} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5">
                <button onClick={() => { loadChapter(o.url, o); setShowOffline(false); }} className="text-left text-sm text-white/80">
                  <div className="font-medium">{o.mangaName}</div>
                  <div className="text-xs text-white/40">Ch {o.chapterNum} · {o.images.length} pages</div>
                </button>
                <button onClick={() => { deleteOffline(o.url); getAllOffline().then(setOfflineChapters); }}
                  className="text-white/30 hover:text-red-400 p-1"><X className="h-3 w-3" /></button>
              </div>
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
  return (
    <div className={`h-screen flex flex-col ${bg} ${textCol} overflow-hidden`}>
      {/* Top bar */}
      <header className={`shrink-0 border-b px-3 py-2 flex items-center gap-2 ${barBg} z-40`}>
        <button onClick={() => setShowMobileMenu((v) => !v)} className={`p-1.5 rounded sm:hidden ${hoverBg}`}><Menu className="h-5 w-5" /></button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <BookOpen className="h-4 w-4 shrink-0" />
          <h1 className="text-sm font-semibold truncate">{data.mangaName}</h1>
          {data.chapterNum && <span className={subText}>· Ch {data.chapterNum}</span>}
          {isOfflineMode && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">OFFLINE</span>}
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
          <button onClick={handleSaveOffline} disabled={savingOffline} className={`px-2 py-1 rounded text-xs ${subText} ${hoverBg}`} title="Save offline">
            {savingOffline ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
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
          <button onClick={() => { handleSaveOffline(); setShowMobileMenu(false); }} disabled={savingOffline} className={`px-3 py-1.5 rounded text-xs ${hoverBg}`}>
            {savingOffline ? "Saving…" : <><Download className="h-3.5 w-3.5 inline mr-1" />Save</>}
          </button>
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
          <div className="space-y-0.5 max-h-[70vh] overflow-y-auto">
            {chapters.map((ch) => {
              const isCurrent = ch.num === parseInt(data.chapterNum);
              return (
                <button key={ch.num} onClick={() => { loadChapter(ch.url); setShowChapters(false); }}
                  className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${isCurrent
                    ? "bg-white/15 font-semibold"
                    : hoverBg
                  } ${isCurrent ? textCol : subText}`}>
                  Chapter {ch.num}
                </button>
              );
            })}
          </div>
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