"use client";

/* eslint-disable @next/next/no-img-element -- avatars are sprite frames served from our own API */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, CircleSlash, ClipboardList, GitPullRequest, Inbox, X } from "lucide-react";
import type { AgentStatus } from "@/db/schema";
import type { Overview } from "@/lib/overview";
import { cn } from "@/lib/utils";
import { PlanUsageMeter } from "@/components/dashboard/plan-usage-meter";

const POLL_MS = 5000;

const STATUS: Record<AgentStatus, { label: string; dot: string }> = {
  idle: { label: "Idle", dot: "bg-muted-foreground/50" },
  working: { label: "Working", dot: "bg-emerald-500 animate-pulse" },
  blocked: { label: "Blocked", dot: "bg-red-500" },
  needs_approval: { label: "Needs you", dot: "bg-amber-500 animate-pulse" },
  offline: { label: "Offline", dot: "bg-muted-foreground/30" },
};

function compact(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function ago(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

type Props = { projectId: number; initial: Overview; avatars: Record<number, string> };

export function OverviewBoard({ projectId, initial, avatars }: Props) {
  const [data, setData] = useState(initial);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/overview`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) setData(await res.json());
  }, [projectId]);

  useEffect(() => {
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const lead = data.team.find((a) => a.role === "Lead");
  const working = data.team.filter((a) => a.status === "working").length;
  const avatar = (desk: number | null) => (desk !== null ? avatars[desk] : undefined);

  return (
    <div className="flex flex-col gap-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Needs you"
          value={data.needsYou.length}
          note={data.needsYou.length ? "Decisions waiting" : "Nothing waiting"}
          attention={data.needsYou.length > 0}
          href={data.needsYou.length ? "#needs-you" : undefined}
        />
        <StatTile label="Agents working" value={working} note={`of ${data.team.length} · max ${data.dispatcher.max} at once`} />
        <StatTile label="Tasks in progress" value={data.counts.inProgress} note="Approved and not yet pushed" href="/dashboard/tasks" />
        <StatTile label="Done this week" value={data.counts.doneThisWeek} note="Pushed for a pull request" href="/dashboard/tasks" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Card title="Needs you" id="needs-you">
            {data.needsYou.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Inbox className="size-4" />
                You&apos;re all caught up.{" "}
                {lead && (
                  <Link href={`/dashboard/agents/${lead.id}`} className="font-medium text-primary underline underline-offset-2">
                    Give {lead.name} something to do
                  </Link>
                )}
              </p>
            ) : (
              <ul className="-my-1 divide-y">
                {data.needsYou.map((item) => {
                  const plan = item.kind === "plan";
                  const href = plan && item.agentId ? `/dashboard/agents/${item.agentId}` : "/dashboard/tasks";
                  return (
                    <li key={item.approvalId}>
                      <Link href={href} className="group flex items-center gap-3 py-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-400">
                          {plan ? <ClipboardList className="size-4.5" /> : <GitPullRequest className="size-4.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{plan ? item.title : (item.taskTitle ?? item.title)}</span>
                          <span className="block text-xs text-muted-foreground">
                            {plan ? "Plan to approve" : "Finished work to push"} · {ago(item.createdAt)}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                          Review
                          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Team">
            <ul className="-my-1 divide-y">
              {data.team.map((agent) => (
                <li key={agent.id}>
                  <Link href={`/dashboard/agents/${agent.id}`} className="flex items-center gap-3 py-3">
                    <span className="flex size-10 shrink-0 items-end justify-center overflow-hidden rounded-full bg-accent">
                      {avatar(agent.desk) ? (
                        <img src={avatar(agent.desk)} alt="" className="h-[125%] w-auto max-w-none translate-y-[10%]" />
                      ) : (
                        <span className="self-center text-sm font-bold">{agent.name[0]}</span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm">
                        <span className="font-semibold">{agent.name}</span>
                        <span className="text-muted-foreground">
                          {agent.role} · {agent.model}
                        </span>
                      </span>
                      {agent.doing ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/80">{agent.doing}</span>
                          {agent.lastStep && <span className="font-mono"> · {agent.lastStep}</span>}
                        </span>
                      ) : (
                        <span className="block text-xs text-muted-foreground">{agent.runsToday ? `${agent.runsToday} run${agent.runsToday === 1 ? "" : "s"} today` : "No runs today"}</span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <span className={cn("size-2 rounded-full", STATUS[agent.status].dot)} />
                      {STATUS[agent.status].label}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="Claude plan">
            <PlanUsageMeter expanded bare />
            {data.dispatcher.pausedUntil && (
              <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                New work is paused until the 5-hour window drops below {data.dispatcher.pauseAt}%.
              </p>
            )}
          </Card>
          <Card title="Tokens used today">
            <TokenBars team={data.team} />
          </Card>
        </div>
      </div>

      <Card title="Recent activity">
        {data.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet. Plans, finished steps and pushes will show up here.</p>
        ) : (
          <ol className="-my-1 divide-y">
            {data.recent.map((e) => (
              <li key={e.id} className="flex items-start gap-3 py-2.5 text-sm">
                <MilestoneIcon type={e.type} />
                <span className="min-w-0 flex-1">
                  <span className="block">{describe(e)}</span>
                  {e.taskTitle && e.type !== "task.ready" && <span className="block truncate text-xs text-muted-foreground">{e.taskTitle}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{ago(e.createdAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function Card({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border/60">
      <h2 className="mb-3 text-sm font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function StatTile({ label, value, note, attention, href }: { label: string; value: number; note: string; attention?: boolean; href?: string }) {
  const body = (
    <>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        {attention && <AlertTriangle className="size-3.5 text-amber-600" aria-hidden />}
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{value.toLocaleString()}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{note}</p>
    </>
  );
  const className = cn("rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border/60", attention && "ring-2 ring-amber-500/50", href && "transition-shadow hover:shadow-md");
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

// One series (tokens per agent today): a single hue, bars from one baseline, value at the tip,
// details on hover.
function TokenBars({ team }: { team: Overview["team"] }) {
  const max = Math.max(...team.map((a) => a.tokensToday), 1);
  const total = team.reduce((sum, a) => sum + a.tokensToday, 0);
  if (total === 0) return <p className="text-sm text-muted-foreground">No agent runs yet today.</p>;
  return (
    <div className="space-y-2.5">
      {team.map((agent) => (
        <div
          key={agent.id}
          className="group grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-xs"
          title={`${agent.name}: ${agent.tokensToday.toLocaleString()} tokens across ${agent.runsToday} run${agent.runsToday === 1 ? "" : "s"} today`}
        >
          <span className="truncate font-medium">{agent.name}</span>
          <span className="h-3 overflow-hidden rounded-r-[4px]">
            <span
              className="block h-full rounded-r-[4px] bg-primary transition-[width,opacity] duration-500 group-hover:opacity-80"
              style={{ width: agent.tokensToday ? `max(4px, ${(agent.tokensToday / max) * 100}%)` : 0 }}
            />
          </span>
          <span className="w-10 text-right text-muted-foreground tabular-nums">{compact(agent.tokensToday)}</span>
        </div>
      ))}
      <p className="pt-1 text-xs text-muted-foreground">{compact(total)} tokens in total, counted toward your plan&apos;s limits.</p>
    </div>
  );
}

function MilestoneIcon({ type }: { type: string }) {
  const base = "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full";
  if (type === "subtask.done" || type === "approval.approved") return <span className={cn(base, "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400")}><Check className="size-3.5" /></span>;
  if (type === "subtask.blocked" || type === "workspace.failed") return <span className={cn(base, "bg-red-500/15 text-red-700 dark:text-red-400")}><AlertTriangle className="size-3.5" /></span>;
  if (type === "approval.rejected") return <span className={cn(base, "bg-muted text-muted-foreground")}><X className="size-3.5" /></span>;
  if (type === "task.cancelled") return <span className={cn(base, "bg-muted text-muted-foreground")}><CircleSlash className="size-3.5" /></span>;
  return <span className={cn(base, "bg-amber-500/15 text-amber-700 dark:text-amber-400")}><ClipboardList className="size-3.5" /></span>;
}

function describe(e: Overview["recent"][number]) {
  const who = e.agentName ?? "The team";
  switch (e.type) {
    case "approval.requested":
      return `${who} sent a plan for approval: ${e.message}`;
    case "approval.approved":
      return "You approved it";
    case "approval.rejected":
      return "You turned it down";
    case "subtask.done":
      return e.message;
    case "subtask.blocked":
      return `Blocked: ${e.message.length > 140 ? `${e.message.slice(0, 140)}…` : e.message}`;
    case "task.ready":
      return `Ready for your review: ${e.taskTitle ?? e.message}`;
    case "task.cancelled":
      return "Task cancelled";
    case "workspace.failed":
      return `Workspace setup failed: ${e.message}`;
    default:
      return e.message;
  }
}
