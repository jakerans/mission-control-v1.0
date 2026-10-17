"use client";

/* eslint-disable @next/next/no-img-element -- scene images are pre-sized sprites served from our own API */
import { useEffect, useRef, useState } from "react";
import type { OfficeAgent, OfficeScene } from "@/lib/offices";
import { cn } from "@/lib/utils";

type Props = {
  scene: OfficeScene;
  // "contain": keep the scene's aspect ratio (height follows width).
  // "cover": fill the size given via className, cropping around the agents.
  fit?: "contain" | "cover";
  // Animation speed for every agent, in frames per second
  fps?: number;
  // Show a name tag above each agent
  showNames?: boolean;
  // Play the looping background video when the office has one (falls back to the still image)
  playVideo?: boolean;
  className?: string;
};

// Scene pixels kept around the outermost agents when cropping in "cover" mode
const AGENT_MARGIN = 40;
// The characters are drawn from behind, seated, with their heads a little left of centre
const HEAD_X = 0.4;

// Renders an office: the background (still or looping video) plus each agent at its seat, playing its
// animation. Agents are laid out in percentages of an aspect-locked stage, so they never drift off their
// desks; the stage itself is sized with container query units to fit (or cover) whatever box it's given.
export function AgentOffice({ scene, fit = "contain", fps = 8, showNames = true, playVideo = true, className }: Props) {
  const [ready, setReady] = useState(false);
  const backgroundRef = useRef<HTMLImageElement>(null);
  const video = playVideo ? scene.video : null;

  // The server-rendered background often finishes loading before hydration, in which case onLoad
  // never fires — so also check the element once mounted.
  useEffect(() => {
    if (backgroundRef.current?.complete) setReady(true);
  }, [scene.background]);

  const pct = (value: number, total: number) => `${(value / total) * 100}%`;

  // Horizontal band the agents occupy, as fractions of the scene width
  const left = Math.max(0, Math.min(...scene.agents.map((a) => a.x)) - AGENT_MARGIN);
  const right = Math.min(scene.width, Math.max(...scene.agents.map((a) => a.x + a.width)) + AGENT_MARGIN);
  const band = scene.agents.length ? { width: (right - left) / scene.width, center: (left + right) / 2 / scene.width } : { width: 1, center: 0.5 };

  // Stage width: cover the box, but never zoom in past the point where the agents' band fits.
  // Then centre on the agents without exposing an edge, and centre vertically (letterboxed if capped).
  // In "contain" mode the box already has the scene's aspect ratio, so this resolves to 100cqw.
  const ratio = scene.width / scene.height;
  const stageWidth = `min(max(100cqw, 100cqh * ${ratio}), 100cqw / ${band.width})`;
  const stageStyle = {
    width: `calc(${stageWidth})`,
    height: `calc(${stageWidth} / ${ratio})`,
    left: `clamp(100cqw - ${stageWidth}, 50cqw - ${stageWidth} * ${band.center}, 0px)`,
    top: `calc((100cqh - ${stageWidth} / ${ratio}) / 2)`,
  };

  const fadeIn = cn("transition-opacity duration-500", ready ? "opacity-100" : "opacity-0");

  return (
    <div
      role="img"
      aria-label={`${scene.name} with ${scene.agents.length} AI agents at work`}
      className={cn("relative w-full overflow-hidden bg-muted select-none", !ready && "animate-pulse", className)}
      style={{ containerType: "size", aspectRatio: fit === "contain" ? `${scene.width} / ${scene.height}` : undefined }}
    >
      {/* Soft fill behind the stage for any letterboxing in "cover" mode */}
      {fit === "cover" && (
        <img src={scene.background} alt="" draggable={false} className={cn("absolute inset-0 size-full scale-110 object-cover blur-2xl", fadeIn)} />
      )}

      <div className="absolute" style={stageStyle}>
        <img
          ref={backgroundRef}
          src={scene.background}
          alt=""
          draggable={false}
          onLoad={() => setReady(true)}
          onError={() => setReady(true)}
          className={cn("absolute inset-0 size-full", fadeIn)}
        />
        {video && <BackgroundVideo key={video} src={video} poster={scene.background} />}

        {scene.agents.map((agent) => (
          <div
            key={agent.id}
            className="absolute"
            style={{
              left: pct(agent.x, scene.width),
              top: pct(agent.y, scene.height),
              width: pct(agent.width, scene.width),
              height: pct(agent.height, scene.height),
              zIndex: agent.zIndex,
            }}
          >
            <AgentSprite agent={agent} fps={fps} />
          </div>
        ))}

        {/* Name tags sit in their own layer so a nearer agent never covers another's tag */}
        {showNames &&
          scene.agents.map((agent) => (
            <div
              key={agent.id}
              className="absolute z-50 -translate-x-1/2 -translate-y-full pb-[0.6em] text-[clamp(9px,1.5cqw,13px)]"
              style={{ left: pct(agent.x + agent.width * HEAD_X, scene.width), top: pct(agent.y, scene.height) }}
            >
              <div className="relative rounded-full bg-card/95 px-[0.8em] py-[0.35em] leading-none font-semibold whitespace-nowrap text-foreground shadow-lg ring-1 ring-border/70 backdrop-blur-sm">
                {agent.name}
                <span
                  aria-hidden
                  className="absolute top-full left-1/2 size-[0.6em] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-card/95 ring-1 ring-border/70 [clip-path:polygon(100%_0,100%_100%,0_100%)]"
                />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

// Looping, muted background video layered over the still image; it fades in once it can play, so
// the still stays visible while it loads. Respects reduced-motion by never starting.
function BackgroundVideo({ src, poster }: { src: string; poster: string }) {
  const [playing, setPlaying] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    setAllowed(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  if (!allowed) return null;
  return (
    <video
      src={src}
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      onPlaying={() => setPlaying(true)}
      // object-fill: generated videos can come back a few pixels off the scene's aspect ratio, and
      // stretching (not cropping) is what keeps the desks under the agents
      className={cn("absolute inset-0 size-full object-fill transition-opacity duration-700", playing ? "opacity-100" : "opacity-0")}
    />
  );
}

function AgentSprite({ agent, fps }: { agent: OfficeAgent; fps: number }) {
  const [frame, setFrame] = useState(0);
  const { frames } = agent;

  useEffect(() => {
    if (frames.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let timer: number | undefined;
    let cancelled = false;

    // Hold the first frame until every frame has decoded, so the loop never blinks to an empty frame.
    // Each agent starts at a random frame so the team doesn't type in lockstep.
    Promise.all(
      frames.map((src) => {
        const image = new Image();
        image.src = src;
        return image.decode().catch(() => undefined);
      })
    ).then(() => {
      if (cancelled) return;
      let current = Math.floor(Math.random() * frames.length);
      setFrame(current);
      timer = window.setInterval(() => {
        current = (current + 1) % frames.length;
        setFrame(current);
      }, 1000 / fps);
    });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [frames, fps]);

  return (
    <>
      {frames.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          className={cn("pointer-events-none absolute inset-0 size-full object-contain", i !== frame && "invisible")}
        />
      ))}
    </>
  );
}
