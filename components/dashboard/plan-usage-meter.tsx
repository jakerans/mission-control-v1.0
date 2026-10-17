"use client";

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import type { UsageWindow } from "@/db/schema";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Usage = { subscriptionType: string | null; windows: Record<string, UsageWindow>; updatedAt: string } | null;

const POLL_MS = 60_000;

// Limit windows worth showing, in order (others the server reports are ignored)
const WINDOWS: { key: string; label: string }[] = [
  { key: "five_hour", label: "5-hour" },
  { key: "seven_day", label: "Weekly" },
  { key: "seven_day_opus", label: "Weekly Opus" },
];

function level(pct: number) {
  return pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-primary";
}

function resetLabel(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  const hours = (date.getTime() - Date.now()) / 3_600_000;
  if (hours <= 0) return "resetting";
  return hours < 24
    ? `resets ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : `resets ${date.toLocaleDateString([], { weekday: "short" })} ${date.toLocaleTimeString([], { hour: "numeric" })}`;
}

// How much of the Claude plan the agents (and your own Claude Code use) have used, per limit window.
// Hidden when agents aren't on the Claude plan.
export function PlanUsageMeter({ expanded }: { expanded: boolean }) {
  const [usage, setUsage] = useState<Usage>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/plan-usage", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: Usage) => !cancelled && setUsage(data))
        .catch(() => undefined);
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!usage) return null;
  const rows = WINDOWS.flatMap(({ key, label }) => {
    const w = usage.windows[key];
    return w && w.utilization !== null ? [{ key, label, pct: Math.min(100, Math.max(0, w.utilization)), reset: resetLabel(w.resetsAt) }] : [];
  });
  if (rows.length === 0) return null;

  const plan = usage.subscriptionType ? `Claude ${usage.subscriptionType[0].toUpperCase()}${usage.subscriptionType.slice(1)}` : "Claude plan";
  const peak = Math.max(...rows.map((r) => r.pct));

  const details = (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="font-semibold">{r.label}</span>
            <span className="text-muted-foreground tabular-nums">{Math.round(r.pct)}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-label={`${r.label} plan usage`} aria-valuenow={Math.round(r.pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className={cn("h-full rounded-full transition-[width] duration-700", level(r.pct))} style={{ width: `${Math.max(r.pct, 2)}%` }} />
          </div>
          {r.reset && <p className="mt-0.5 text-[10px] text-muted-foreground">{r.reset}</p>}
        </div>
      ))}
    </div>
  );

  if (!expanded) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<div className="relative mx-auto flex size-9 items-center justify-center rounded-xl bg-muted/70 text-[10px] font-bold tabular-nums" />}
        >
          <svg viewBox="0 0 36 36" className="absolute inset-0 size-full -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" className="stroke-border" />
            <circle
              cx="18"
              cy="18"
              r="14"
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${(peak / 100) * 88} 88`}
              className={peak >= 90 ? "stroke-red-500" : peak >= 75 ? "stroke-amber-500" : "stroke-primary"}
            />
          </svg>
          {Math.round(peak)}
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={14} className="w-52">
          <p className="mb-2 font-semibold">{plan} usage</p>
          {details}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="rounded-2xl bg-muted/40 p-2.5 ring-1 ring-border/60">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
        <Gauge className="size-3.5" />
        {plan} usage
      </p>
      {details}
    </div>
  );
}
