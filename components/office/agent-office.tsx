"use client";

/* eslint-disable @next/next/no-img-element -- scene images are pre-sized sprites served from our own API */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AgentStatus } from "@/db/schema";
import type { OfficeAgent, OfficeScene } from "@/lib/offices";
import { cn } from "@/lib/utils";

// A project's agent, placed at the office seat matching its desk number
export type OfficeTeamMember = { desk: number; name: string; role: string; status: AgentStatus; href?: string };

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
  // The project's real team. When given, only seated agents appear and their status drives the
  // animation; without it (office previews) every seat shows its character at work.
  team?: OfficeTeamMember[];
  className?: string;
};

type Seated = { seat: OfficeAgent; name: string; role?: string; status: AgentStatus; href?: string };

const STATUS_DOT: Record<AgentStatus, string> = {
  idle: "bg-muted-foreground/50",
  working: "bg-emerald-500 animate-pulse",
  blocked: "bg-red-500",
  needs_approval: "bg-amber-500 animate-pulse",
  offline: "bg-muted-foreground/30",
};

const STATUS_TEXT: Partial<Record<AgentStatus, string>> = {
  blocked: "Blocked",
  needs_approval: "Needs you",
};

// Scene pixels kept around the outermost agents when cropping in "cover" mode
const AGENT_MARGIN = 40;
// The characters are drawn from behind, seated, with their heads a little left of centre
const HEAD_X = 0.4;
// Where the animated upper body fades into the steady chair and legs (fraction of sprite height)
const UPPER_BODY_MASK = "linear-gradient(to bottom, #000 0%, #000 52%, transparent 66%)";

// Renders an office: the background (still or looping video) plus each agent at its seat, playing its
// animation. Agents are laid out in percentages of an aspect-locked stage, so they never drift off their
// desks; the stage itself is sized with container query units to fit (or cover) whatever box it's given.
export function AgentOffice({ scene, fit = "contain", fps = 6, showNames = true, playVideo = true, team, className }: Props) {
  const [ready, setReady] = useState(false);
  const seated: Seated[] = team
    ? scene.agents.flatMap((seat, desk) => {
        const member = team.find((m) => m.desk === desk);
        return member ? [{ seat, name: member.name, role: member.role, status: member.status, href: member.href }] : [];
      })
    : scene.agents.map((seat) => ({ seat, name: seat.name, status: "working" as const }));
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
      aria-label={`${scene.name} with ${seated.length} AI agents`}
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

        {seated.map(({ seat, status }) => (
          <div
            key={seat.id}
            className={cn("absolute", status === "offline" && "opacity-50 grayscale")}
            style={{
              left: pct(seat.x, scene.width),
              top: pct(seat.y, scene.height),
              width: pct(seat.width, scene.width),
              height: pct(seat.height, scene.height),
              zIndex: seat.zIndex,
            }}
          >
            <AgentSprite agent={seat} fps={fps} animate={status === "working"} />
          </div>
        ))}

        {/* Name tags sit in their own layer so a nearer agent never covers another's tag */}
        {showNames &&
          seated.map(({ seat, name, role, status, href }) => (
            <div
              key={seat.id}
              className="absolute z-50 -translate-x-1/2 -translate-y-full pb-[0.6em] text-[clamp(9px,1.5cqw,13px)]"
              style={{ left: pct(seat.x + seat.width * HEAD_X, scene.width), top: pct(seat.y, scene.height) }}
            >
              <TagElement
                href={href}
                className={cn(
                  "relative flex items-center gap-[0.45em] rounded-full bg-card/95 px-[0.8em] py-[0.35em] leading-none font-semibold whitespace-nowrap text-foreground shadow-lg ring-1 ring-border/70 backdrop-blur-sm",
                  status === "needs_approval" && "ring-2 ring-amber-500",
                  status === "blocked" && "ring-2 ring-red-500"
                )}
              >
                {team && <span aria-hidden className={cn("size-[0.55em] shrink-0 rounded-full", STATUS_DOT[status])} />}
                {name}
                {role && <span className="font-medium text-muted-foreground">{STATUS_TEXT[status] ?? role}</span>}
                <span
                  aria-hidden
                  className="absolute top-full left-1/2 size-[0.6em] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-card/95 ring-1 ring-border/70 [clip-path:polygon(100%_0,100%_100%,0_100%)]"
                />
              </TagElement>
            </div>
          ))}
      </div>
    </div>
  );
}

// A name tag links to the agent's page when it has one
function TagElement({ href, className, children }: { href?: string; className: string; children: React.ReactNode }) {
  if (!href) return <div className={className}>{children}</div>;
  return (
    <Link href={href} className={cn(className, "transition-transform hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none")}>
      {children}
    </Link>
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

// animate: play the work loop. Otherwise the agent holds its first frame and breathes gently.
function AgentSprite({ agent, fps, animate }: { agent: OfficeAgent; fps: number; animate: boolean }) {
  const [frame, setFrame] = useState(0);
  const { frames } = agent;

  useEffect(() => {
    if (!animate) {
      setFrame(0);
      return;
    }
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
  }, [frames, fps, animate]);

  // The AI-drawn frames each redraw the chair and legs slightly differently, which makes them wobble.
  // So the first frame is the steady base, and the animation plays only over the upper body, fading
  // into the base across a soft band so there's no visible seam.
  return (
    <div className={cn("absolute inset-0 origin-bottom", !animate && "motion-safe:animate-[breathe_4s_ease-in-out_infinite]")}>
      <img src={frames[0]} alt="" draggable={false} className="pointer-events-none absolute inset-0 size-full object-contain" />
      {animate &&
        frames.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            draggable={false}
            style={{ maskImage: UPPER_BODY_MASK, WebkitMaskImage: UPPER_BODY_MASK }}
            className={cn("pointer-events-none absolute inset-0 size-full object-contain", i !== frame && "invisible")}
          />
        ))}
    </div>
  );
}
