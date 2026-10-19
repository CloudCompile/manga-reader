"use client";

// Overlay player for an anime episode.
//
// Streams are HLS and the CDN refuses cross-origin reads (its
// Access-Control-Allow-Origin is pinned to the provider's own player), so the
// playlist and every segment are fetched through /api/anime/hls. The playlist
// that route returns already points its children back at itself, so the player
// can be handed that one URL and never needs to know about the CDN.
//
// Playback prefers hls.js where the browser lacks native HLS (Chrome, Firefox,
// Android WebView) and falls back to the native player where it does (Safari).
// If neither is usable the upstream iframe embed is the last resort, since some
// titles are only offered as an embed.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
  List,
  Volume2,
  VolumeX,
  RotateCw,
} from "lucide-react";
import { getAnimeRotate, setAnimeRotate } from "@/lib/storage";
import type { AnimeEpisode, AnimeServer, AnimeStream } from "@/lib/anime";

const RELAY = (url: string) => `/api/anime/hls?url=${encodeURIComponent(url)}`;

interface AnimePlayerProps {
  title: string;
  episodes: AnimeEpisode[];
  startIndex: number;
  isDark: boolean;
  onClose: () => void;
}

type Mode = "hls" | "iframe";

export default function AnimePlayer({ title, episodes, startIndex, isDark, onClose }: AnimePlayerProps) {
  const [index, setIndex] = useState(startIndex);
  const [stream, setStream] = useState<AnimeStream | null>(null);
  const [server, setServer] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showList, setShowList] = useState(false);
  const [muted, setMuted] = useState(false);
  // Quarter-turn mode: the player is rotated to fill a portrait-locked screen.
  // Seeded from the cookie so the choice survives a reload, and written back
  // when toggled.
  const [rotated, setRotated] = useState(() => getAnimeRotate());
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // hls.js instance, kept out of state: attaching and destroying it is an
  // imperative side effect and re-rendering on it would thrash the player.
  const hlsRef = useRef<{ destroy: () => void } | null>(null);

  const episode = episodes[index];
  const hasPrev = index > 0;
  const hasNext = index < episodes.length - 1;

  const bg = isDark ? "bg-[#0a0a0a]" : "bg-[#f5f5f5]";
  const textCol = isDark ? "text-white" : "text-gray-900";
  const subText = isDark ? "text-white/50" : "text-gray-500";
  const barBg = isDark ? "bg-[#111] border-white/10" : "bg-white border-gray-200";
  const panelBg = isDark ? "bg-[#111]" : "bg-white";
  const hoverBg = isDark ? "hover:bg-white/10" : "hover:bg-gray-100";

  const goTo = useCallback((next: number) => {
    if (next < 0 || next >= episodes.length) return;
    setIndex(next);
    setShowList(false);
  }, [episodes.length]);

  // Turn the player a quarter turn. As a convenience it also asks the browser
  // for real fullscreen and a landscape orientation lock, but neither is
  // required: the CSS rotation works on its own, which is the whole point on
  // devices that cannot fullscreen or whose rotation is fixed. Every request is
  // best-effort and rejected promises are ignored, since these APIs are absent
  // or denied on many of the WebViews this app targets.
  const toggleRotate = useCallback(() => {
    const next = !rotated;
    setRotated(next);
    setAnimeRotate(next);
    if (next) {
      rootRef.current?.requestFullscreen?.({ navigationUI: "hide" }).catch(() => undefined);
      const orientation = screen.orientation as (ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      }) | undefined;
      orientation?.lock?.("landscape").catch(() => undefined);
    } else {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
      screen.orientation?.unlock?.();
    }
  }, [rotated]);

  // Leaving the player must not leave the device locked in fullscreen/landscape,
  // which would be confusing once the rest of the reader is shown.
  useEffect(() => {
    return () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
      screen.orientation?.unlock?.();
    };
  }, []);

  // Resolve the episode to a playable stream. Re-runs when the episode or the
  // chosen server changes, so switching servers does not need a separate path.
  useEffect(() => {
    if (!episode) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setStream(null);
    const params = new URLSearchParams({ id: episode.id });
    if (server) params.set("server", server);
    fetch(`/api/anime/stream?${params.toString()}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "No stream available");
        if (!cancelled) setStream(json as AnimeStream);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this episode");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [episode, server]);

  // Attach the stream to the <video>. Native HLS is used where available, since
  // it is what Safari and iOS WebViews support; otherwise hls.js is imported on
  // demand so a browser that never opens the player does not pay for it.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream || stream.kind !== "hls" || !stream.url) return;
    const src = RELAY(stream.url);

    const attachNative = () => {
      video.src = src;
      video.play().catch(() => undefined);
    };

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      attachNative();
      return () => {
        video.removeAttribute("src");
      };
    }

    let disposed = false;
    import("hls.js")
      .then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) {
          attachNative();
          return;
        }
        const hls = new Hls({ enableWorker: true });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => undefined);
        });
      })
      .catch(() => {
        // hls.js unavailable (offline, blocked): the native player is the only
        // remaining option, and a browser without it simply shows the error.
        if (!disposed) attachNative();
      });

    return () => {
      disposed = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [stream]);

  // Esc closes the player; arrow keys move between episodes, but only when the
  // video itself does not have focus, so the native seek keys keep working.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "r" || e.key === "R") {
        toggleRotate();
      } else if (document.activeElement !== videoRef.current) {
        if (e.key === "ArrowRight" && hasNext) goTo(index + 1);
        else if (e.key === "ArrowLeft" && hasPrev) goTo(index - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, hasNext, hasPrev, goTo, onClose, toggleRotate]);

  const servers: AnimeServer[] = stream?.servers?.length
    ? stream.servers
    : [{ type: "sub", name: stream?.server || "Default" }];

  return (
    <div
      ref={rootRef}
      className={`fixed inset-0 z-[70] flex flex-col ${bg} ${textCol} ${rotated ? "anime-rotate" : ""}`}
    >
      {/* Header */}
      <header className={`shrink-0 border-b px-3 py-2 flex items-center gap-2 ${barBg}`}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h1 className="text-sm font-semibold truncate">{title}</h1>
          {episode && <span className={`${subText} shrink-0`}>· Ep {episode.num}</span>}
        </div>
        <button
          onClick={() => setMuted((v) => !v)}
          aria-label={muted ? "Unmute" : "Mute"}
          aria-pressed={muted}
          className={`p-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${subText} ${hoverBg}`}
          title={muted ? "Unmute" : "Mute"}
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        {/* Sits in the header rather than by the video so it stays on screen
            once the player is rotated and other controls may be off-view. */}
        <button
          onClick={toggleRotate}
          aria-label={rotated ? "Restore upright player" : "Rotate player to fill the screen"}
          aria-pressed={rotated}
          className={`p-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${rotated ? (isDark ? "bg-white/15 text-white" : "bg-gray-200 text-gray-900") : subText + " " + hoverBg}`}
          title={rotated ? "Restore upright (R)" : "Rotate to fill screen (R)"}
        >
          <RotateCw className="h-4 w-4" />
        </button>
        <button
          onClick={() => setShowList((v) => !v)}
          aria-label="Episode list"
          aria-pressed={showList}
          className={`px-2 py-1.5 rounded text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${showList ? (isDark ? "bg-white/15" : "bg-gray-200") : ""} ${subText} ${hoverBg}`}
        >
          <List className="h-3.5 w-3.5 inline mr-1" />Episodes
        </button>
        <button
          onClick={onClose}
          aria-label="Close player"
          className={`p-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${subText} ${hoverBg}`}
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Player surface */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 relative flex items-center justify-center bg-black min-h-0">
            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
                <Loader2 className="h-8 w-8 animate-spin text-white/70" />
                <p className="text-xs text-white/50">Loading episode {episode?.num}…</p>
              </div>
            )}
            {!loading && error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center z-10">
                <p className="text-sm text-white/80">{error}</p>
                <Button size="sm" variant="outline" onClick={() => setServer("")}>
                  Try again
                </Button>
              </div>
            )}
            {stream?.kind === "iframe" && (
              <iframe
                src={stream.url}
                title={`${title} episode ${episode?.num}`}
                className="w-full h-full"
                allow="autoplay; fullscreen; encrypted-media"
                allowFullScreen
                referrerPolicy="no-referrer"
              />
            )}
            {stream?.kind === "hls" && stream.url && (
              <video
                ref={videoRef}
                className="w-full h-full max-h-full"
                controls
                autoPlay
                muted={muted}
                playsInline
              />
            )}
            {stream?.kind === "hls" && !stream.url && !loading && !error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm text-white/80">
                  This episode has no direct stream. Try another server.
                </p>
              </div>
            )}
          </div>

          {/* Transport + server picker */}
          <div className={`shrink-0 border-t px-3 py-2 flex flex-wrap items-center gap-2 ${barBg}`}>
            <Button variant="ghost" size="sm" disabled={!hasPrev} aria-label="Previous episode" onClick={() => goTo(index - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">Prev</span>
            </Button>
            <Button variant="ghost" size="sm" disabled={!hasNext} aria-label="Next episode" onClick={() => goTo(index + 1)}>
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
            <span className={`text-xs ${subText}`}>
              Episode {episode?.num} of {episodes.length}
            </span>
            <div className="flex-1" />
            {/* Servers are offered per sub/dub group; switching re-resolves the
                stream, which is how a dead server is worked around. */}
            <div className="flex items-center gap-1 flex-wrap">
              {servers.map((s) => (
                <button
                  key={`${s.type}:${s.name}`}
                  onClick={() => setServer(s.name)}
                  aria-pressed={server === s.name || (!server && s.name === (stream?.server || ""))}
                  className={`px-2 py-1 rounded text-[11px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isDark ? "focus-visible:outline-white/60" : "focus-visible:outline-gray-500"} ${
                    server === s.name || (!server && s.name === (stream?.server || ""))
                      ? isDark ? "bg-white/15 text-white" : "bg-gray-200 text-gray-900"
                      : subText + " " + hoverBg
                  }`}
                >
                  {s.name}
                  {s.type === "dub" ? " (dub)" : ""}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Episode list */}
        {showList && (
          <aside className={`w-full max-w-xs shrink-0 border-l flex flex-col ${panelBg} ${isDark ? "border-white/10" : "border-gray-200"}`}>
            <div className={`px-4 py-3 border-b text-xs font-semibold uppercase tracking-wider ${isDark ? "border-white/10" : "border-gray-200"} ${subText}`}>
              Episodes ({episodes.length})
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {episodes.map((e, i) => (
                <button
                  key={e.id}
                  onClick={() => goTo(i)}
                  aria-current={i === index}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    i === index ? (isDark ? "bg-white/15 text-white" : "bg-gray-200 text-gray-900") : `${hoverBg} ${isDark ? "text-white/80" : "text-gray-700"}`
                  }`}
                >
                  <span className="font-medium">{e.num}</span>
                  <span className={`ml-2 text-xs ${subText}`}>{e.title}</span>
                  {e.filler && <span className={`ml-2 text-[10px] ${subText}`}>filler</span>}
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
