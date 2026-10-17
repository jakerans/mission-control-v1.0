"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronsUpDown, Minimize2, Music2, Pause, Play, Radio, SkipBack, SkipForward, Volume1, Volume2, VolumeX, X } from "lucide-react";
import { LOFI_STATIONS, type Station } from "@/lib/lofi-stations";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Minimal typing for the YouTube IFrame Player API (https://developers.google.com/youtube/iframe_api_reference)
type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  loadVideoById(id: string): void;
  setVolume(volume: number): void;
  destroy(): void;
};
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    options: {
      videoId: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    }
  ) => YTPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number };
};
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi() {
  apiPromise ??= new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return apiPromise;
}

type MusicContext = {
  station: Station;
  playing: boolean;
  loading: boolean;
  error: string | null;
  volume: number;
  toggle: () => void;
  stop: () => void;
  selectStation: (id: string) => void;
  step: (delta: number) => void;
  setVolume: (volume: number) => void;
};

const MusicContext = createContext<MusicContext | null>(null);

function useMusic() {
  const ctx = useContext(MusicContext);
  if (!ctx) throw new Error("useMusic must be used inside <MusicProvider>");
  return ctx;
}

const STORAGE_KEY = "mc-radio";

function loadSettings(): { volume?: number; station?: string } {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveSettings(settings: { volume: number; station: string }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

// Owns the one YouTube player for the dashboard, so the radio keeps playing across page changes and
// however many player UIs are on screen (sidebar + mobile drawer). The player is only created on the
// first press of play, so nothing loads from YouTube until you want music.
export function MusicProvider({ children }: { children: React.ReactNode }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [stationId, setStationId] = useState(LOFI_STATIONS[0].id);
  const [volume, setVolumeState] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Window states: hidden until first played; minimized keeps it as a small tile
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const station = LOFI_STATIONS.find((s) => s.id === stationId) ?? LOFI_STATIONS[0];
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  useEffect(() => {
    const saved = loadSettings();
    if (typeof saved.volume === "number") setVolumeState(Math.min(100, Math.max(0, saved.volume)));
    if (LOFI_STATIONS.some((s) => s.id === saved.station)) setStationId(saved.station!);
  }, []);

  useEffect(() => {
    playerRef.current?.setVolume(volume);
    saveSettings({ volume, station: stationId });
  }, [volume, stationId]);

  useEffect(() => () => playerRef.current?.destroy(), []);

  const start = useCallback(async (target: Station) => {
    setError(null);
    setOpen(true);
    if (playerRef.current) {
      playerRef.current.loadVideoById(target.youtubeId);
      playerRef.current.playVideo();
      return;
    }
    setLoading(true);
    const YT = await loadYouTubeApi();
    const mount = mountRef.current;
    if (!mount) return;
    const el = document.createElement("div");
    mount.replaceChildren(el);
    playerRef.current = new YT.Player(el, {
      videoId: target.youtubeId,
      width: "100%",
      height: "100%",
      playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, modestbranding: 1, disablekb: 1 },
      events: {
        onReady: (e) => {
          e.target.setVolume(volumeRef.current);
          e.target.playVideo();
        },
        onStateChange: (e) => {
          setPlaying(e.data === YT.PlayerState.PLAYING);
          setLoading(e.data === YT.PlayerState.BUFFERING);
        },
        onError: () => {
          setLoading(false);
          setPlaying(false);
          setError("This station is offline. Try another one.");
        },
      },
    });
  }, []);

  const toggle = useCallback(() => {
    if (playing) playerRef.current?.pauseVideo();
    else if (playerRef.current && !error) playerRef.current.playVideo();
    else start(station);
  }, [playing, error, start, station]);

  const selectStation = useCallback(
    (id: string) => {
      const next = LOFI_STATIONS.find((s) => s.id === id);
      if (!next) return;
      setStationId(id);
      start(next);
    },
    [start]
  );

  const step = useCallback(
    (delta: number) => {
      const i = LOFI_STATIONS.findIndex((s) => s.id === stationId);
      selectStation(LOFI_STATIONS[(i + delta + LOFI_STATIONS.length) % LOFI_STATIONS.length].id);
    },
    [stationId, selectStation]
  );

  const stop = useCallback(() => {
    playerRef.current?.pauseVideo();
    setOpen(false);
  }, []);

  const value: MusicContext = { station, playing, loading, error, volume, toggle, stop, selectStation, step, setVolume: setVolumeState };

  return (
    <MusicContext.Provider value={value}>
      {children}

      {/* Floating radio window. YouTube's embed terms expect the player to stay visible while it plays. */}
      <div
        className={cn(
          "fixed bottom-4 left-4 z-40 overflow-hidden rounded-2xl bg-card shadow-2xl ring-1 ring-border/70 transition-[opacity,translate,width,left] duration-300 md:left-[calc(var(--sidebar-w,5.5rem)+0.75rem)]",
          open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
          minimized ? "w-56" : "w-[min(22rem,calc(100vw-2rem))]"
        )}
        aria-hidden={!open}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <Radio className="size-4 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 truncate text-xs font-semibold">
            {station.emoji} {station.name}
          </p>
          <button
            type="button"
            onClick={() => setMinimized((m) => !m)}
            aria-label={minimized ? "Expand radio" : "Minimize radio"}
            className="rounded-md p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {minimized ? <ChevronsUpDown className="size-3.5" /> : <Minimize2 className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={stop}
            aria-label="Stop and close radio"
            className="rounded-md p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <div className={cn("relative aspect-video bg-black", minimized && "aspect-[16/9]")}>
          <div ref={mountRef} className="absolute inset-0 [&_iframe]:size-full" />
          {error && <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-white/90">{error}</p>}
        </div>
      </div>
    </MusicContext.Provider>
  );
}

// Sidebar controls: station, play/pause, skip and volume when expanded; one play button on the icon rail.
export function LofiPlayer({ expanded }: { expanded: boolean }) {
  const { station, playing, loading, error, volume, toggle, selectStation, step, setVolume } = useMusic();
  const [pickerOpen, setPickerOpen] = useState(false);
  const VolumeIcon = volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  if (!expanded) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? "Pause lofi radio" : "Play lofi radio"}
              className="mx-auto flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground transition-transform outline-none hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          }
        >
          {playing ? <Equalizer /> : <Music2 className="size-4.5" />}
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={14}>
          {playing ? "Pause" : "Play"}: {station.name}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="rounded-2xl bg-accent/60 p-2.5 ring-1 ring-border/60">
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger className="flex w-full items-center gap-2.5 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            {playing ? <Equalizer /> : <span className="text-base leading-none">{station.emoji}</span>}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold tracking-wide text-muted-foreground">Lofi Girl radio</span>
            <span className="block truncate text-sm font-semibold" title={station.name}>
              {station.name}
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent side="right" align="end" sideOffset={16} className="max-h-96 w-64 gap-0.5 overflow-y-auto rounded-2xl p-1.5">
          <p className="px-2 pt-1 pb-1.5 text-xs font-semibold text-muted-foreground">Stations</p>
          {LOFI_STATIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setPickerOpen(false);
                selectStation(s.id);
              }}
              className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
            >
              <span className="w-5 text-center">{s.emoji}</span>
              <span className={cn("min-w-0 flex-1 truncate", s.id === station.id && "font-semibold")}>{s.name}</span>
              {s.id === station.id && <Check className="size-4 text-primary" />}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <div className="mt-2 flex items-center justify-center gap-1">
        <PlayerButton label="Previous station" onClick={() => step(-1)}>
          <SkipBack className="size-4" />
        </PlayerButton>
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className={cn(
            "flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform outline-none hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/50",
            loading && "animate-pulse"
          )}
        >
          {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4 translate-x-px" fill="currentColor" />}
        </button>
        <PlayerButton label="Next station" onClick={() => step(1)}>
          <SkipForward className="size-4" />
        </PlayerButton>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-muted-foreground">
        <button
          type="button"
          onClick={() => setVolume(volume === 0 ? 50 : 0)}
          aria-label={volume === 0 ? "Unmute" : "Mute"}
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <VolumeIcon className="size-4" />
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          aria-label="Volume"
          onChange={(e) => setVolume(Number(e.target.value))}
          className="h-1 w-full cursor-pointer accent-(--primary)"
        />
      </div>
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function PlayerButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {children}
    </button>
  );
}

// Three bouncing bars while music plays
function Equalizer() {
  return (
    <span aria-hidden className="flex h-4 items-end gap-0.5">
      {[0, 0.2, 0.4].map((delay) => (
        <span
          key={delay}
          className="w-[3px] origin-bottom animate-[eq_0.9s_ease-in-out_infinite] rounded-full bg-current motion-reduce:animate-none"
          style={{ animationDelay: `${delay}s`, height: "100%" }}
        />
      ))}
    </span>
  );
}
