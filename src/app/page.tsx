"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  BookOpen,
  ArrowUp,
  Sun,
  Moon,
} from "lucide-react";

interface ChapterData {
  title: string;
  images: string[];
  prevUrl: string | null;
  nextUrl: string | null;
  mangaName: string;
  chapterNum: string;
  warning?: string;
}

type Theme = "dark" | "light";

type FitMode = "width" | "height" | "original";

export default function MangaReader() {
  const [url, setUrl] = useState("https://www.mangafragrant.com/manga/the-fragrant-flower-blooms-with-dignity-chapter-182/");
  const [data, setData] = useState<ChapterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [fitMode, setFitMode] = useState<FitMode>("width");
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const imgRefs = useRef<Map<number, HTMLImageElement>>(new Map());

  // Restore last-read URL from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem("manga-last-url");
    if (saved) setUrl(saved);
    const savedTheme = localStorage.getItem("manga-theme") as Theme;
    if (savedTheme) setTheme(savedTheme);
  }, []);

  // Scroll listener for back-to-top button
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setShowScrollTop(el.scrollTop > 600);
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Track loaded images
  const handleImageLoad = useCallback((index: number) => {
    setLoadedImages((prev) => new Set(prev).add(index));
  }, []);

  const loadChapter = useCallback(async (chapterUrl: string) => {
    if (!chapterUrl.trim()) return;
    setLoading(true);
    setError("");
    setData(null);
    setLoadedImages(new Set());
    setShowScrollTop(false);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;

    sessionStorage.setItem("manga-last-url", chapterUrl);

    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: chapterUrl }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load chapter");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadChapter(url);
  };

  const goToChapter = (chapterUrl: string | null) => {
    if (!chapterUrl) return;
    setUrl(chapterUrl);
    loadChapter(chapterUrl);
  };

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const scrollToImage = (index: number) => {
    const img = imgRefs.current.get(index);
    if (img) img.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("manga-theme", next);
  };

  const fitModes: { key: FitMode; label: string }[] = [
    { key: "width", label: "Fit Width" },
    { key: "height", label: "Fit Height" },
    { key: "original", label: "Original" },
  ];

  // ─── Loading screen ───
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 bg-[#0a0a0a]">
        <Loader2 className="h-10 w-10 animate-spin text-white/60" />
        <p className="text-white/60 text-sm">Scraping chapter…</p>
      </div>
    );
  }

  // ─── URL entry screen ───
  if (!data && !error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-8 p-6 bg-[#0a0a0a]">
        <div className="flex items-center gap-3 text-white">
          <BookOpen className="h-10 w-10" />
          <h1 className="text-2xl font-bold tracking-tight">Manga Reader</h1>
        </div>
        <p className="text-white/50 text-sm max-w-md text-center">
          Paste a mangafragrant.com chapter URL to read it clean — no ads, no
          clutter, just the manga.
        </p>
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-lg flex gap-2"
        >
          <Input
            type="url"
            placeholder="https://www.mangafragrant.com/manga/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button type="submit" className="shrink-0">
            Read
          </Button>
        </form>
      </div>
    );
  }

  // ─── Error screen ───
  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6 bg-[#0a0a0a]">
        <p className="text-red-400 text-sm max-w-md text-center">{error}</p>
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-lg flex gap-2"
        >
          <Input
            type="url"
            placeholder="Try a different chapter URL…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button type="submit" className="shrink-0">
            Retry
          </Button>
        </form>
        {data?.prevUrl && (
          <Button
            variant="outline"
            onClick={() => goToChapter(data.prevUrl)}
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Try Previous Chapter
          </Button>
        )}
      </div>
    );
  }

  // ─── Reader view ───
  const isDark = theme === "dark";
  const bg = isDark ? "bg-[#0a0a0a]" : "bg-[#f5f5f5]";
  const textCol = isDark ? "text-white" : "text-gray-900";
  const subText = isDark ? "text-white/50" : "text-gray-500";
  const barBg = isDark
    ? "bg-[#111] border-white/10"
    : "bg-white border-gray-200";
  const btnHover = isDark
    ? "hover:bg-white/10"
    : "hover:bg-gray-100";

  const imgStyle: React.CSSProperties =
    fitMode === "width"
      ? { width: "100%", height: "auto" }
      : fitMode === "height"
        ? { height: "100vh", width: "auto", margin: "0 auto" }
        : { maxWidth: "100%", height: "auto", margin: "0 auto" };

  return (
    <div className={`h-screen flex flex-col ${bg} ${textCol} overflow-hidden`}>
      {/* ─── Top Bar ─── */}
      <header
        className={`shrink-0 border-b px-4 py-2 flex items-center gap-3 ${barBg}`}
      >
        <BookOpen className="h-5 w-5 shrink-0" />
        <h1 className="text-sm font-semibold truncate flex-1">
          {data.mangaName}
          {data.chapterNum && (
            <span className={subText}> · Ch {data.chapterNum}</span>
          )}
        </h1>
        {/* Fit mode buttons */}
        <div className="hidden sm:flex items-center gap-1">
          {fitModes.map((fm) => (
            <button
              key={fm.key}
              onClick={() => setFitMode(fm.key)}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                fitMode === fm.key
                  ? isDark
                    ? "bg-white/15 text-white"
                    : "bg-gray-200 text-gray-900"
                  : `${subText} ${btnHover}`
              }`}
            >
              {fm.label}
            </button>
          ))}
        </div>
        <button
          onClick={toggleTheme}
          className={`p-1.5 rounded transition-colors ${btnHover} ${subText}`}
          aria-label="Toggle theme"
        >
          {isDark ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </button>
      </header>

      {/* ─── Image Area ─── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        style={{ scrollbarGutter: "stable" }}
      >
        {/* Warning */}
        {data.warning && (
          <div className="max-w-2xl mx-auto mt-6 px-4">
            <div
              className={`rounded-lg border p-4 text-sm ${
                isDark
                  ? "bg-yellow-900/20 border-yellow-800 text-yellow-300"
                  : "bg-yellow-50 border-yellow-200 text-yellow-700"
              }`}
            >
              {data.warning}
            </div>
          </div>
        )}

        {/* Images */}
        <div className="flex flex-col items-center">
          {data.images.map((src, i) => (
            <div key={i} className="relative w-full">
              {!loadedImages.has(i) && (
                <Skeleton
                  className="w-full mx-auto"
                  style={{
                    aspectRatio: "2/3",
                    maxWidth: "800px",
                  }}
                />
              )}
              { }
              <img
                ref={(el) => {
                  if (el) imgRefs.current.set(i, el);
                }}
                src={src}
                alt={`Page ${i + 1}`}
                onLoad={() => handleImageLoad(i)}
                style={{
                  ...imgStyle,
                  display: loadedImages.has(i) ? "block" : "none",
                }}
                loading="lazy"
                className={isDark ? "" : ""}
              />
            </div>
          ))}
        </div>

        {/* Bottom spacer for nav buttons */}
        <div className="h-20" />
      </div>

      {/* ─── Bottom Nav ─── */}
      <nav
        className={`shrink-0 border-t px-4 py-2 flex items-center justify-between ${barBg}`}
      >
        <Button
          variant="ghost"
          size="sm"
          disabled={!data.prevUrl}
          onClick={() => goToChapter(data.prevUrl)}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          <span className="hidden sm:inline">Prev</span>
        </Button>

        <span className={`${subText} text-xs`}>
          {data.images.length} page{data.images.length !== 1 ? "s" : ""}
        </span>

        <Button
          variant="ghost"
          size="sm"
          disabled={!data.nextUrl}
          onClick={() => goToChapter(data.nextUrl)}
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </nav>

      {/* ─── Scroll-to-top FAB ─── */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className={`fixed bottom-20 right-4 p-2.5 rounded-full shadow-lg transition-all ${
            isDark
              ? "bg-white/10 hover:bg-white/20 text-white"
              : "bg-white hover:bg-gray-100 text-gray-900 border"
          }`}
          aria-label="Scroll to top"
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      )}

      {/* ─── Mobile Fit Mode ─── */}
      <div
        className={`sm:hidden fixed top-14 right-2 flex flex-col gap-1 z-50`}
      >
        {fitModes.map((fm) => (
          <button
            key={fm.key}
            onClick={() => setFitMode(fm.key)}
            className={`px-2 py-1 rounded text-[10px] shadow transition-colors ${
              fitMode === fm.key
                ? isDark
                  ? "bg-white/20 text-white"
                  : "bg-gray-800 text-white"
                : isDark
                  ? "bg-black/60 text-white/60"
                  : "bg-white/80 text-gray-600 border"
            }`}
          >
            {fm.label}
          </button>
        ))}
      </div>
    </div>
  );
}
