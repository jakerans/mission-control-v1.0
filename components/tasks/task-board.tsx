"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Circle,
  CircleSlash,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  ListChecks,
  PauseCircle,
  RotateCcw,
  Square,
  Upload,
  X,
} from "lucide-react";
import { cancelTask, decide, retrySubtask, retryWorkspace, stopWorker } from "@/app/agents/actions";
import type { BoardSubtask, BoardTask, TaskBoard as Board } from "@/lib/task-board";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/agents/markdown";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const POLL_MS = 3000;

const TASK_STATUS: Record<string, { label: string; className: string }> = {
  awaiting_approval: { label: "Plan waiting for you", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  queued: { label: "Starting", className: "bg-muted text-muted-foreground" },
  working: { label: "In progress", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  blocked: { label: "Blocked", className: "bg-red-500/15 text-red-700 dark:text-red-400" },
  review: { label: "Ready for you", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  done: { label: "Pushed", className: "bg-primary/15 text-primary" },
  failed: { label: "Failed", className: "bg-red-500/15 text-red-700 dark:text-red-400" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
};

export function TaskBoard({ projectId, leadId, initial }: { projectId: number; leadId: number | null; initial: Board }) {
  const [board, setBoard] = useState(initial);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/tasks`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) setBoard(await res.json());
  }, [projectId]);

  useEffect(() => {
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const { dispatcher } = board;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-card px-4 py-3 text-sm shadow-sm ring-1 ring-border/60">
        <span className="font-semibold">Team</span>
        <span className="text-muted-foreground">
          {dispatcher.running} of {dispatcher.max} agents busy
        </span>
        {dispatcher.pausedUntil && (
          <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
            <PauseCircle className="size-4" />
            Paused: your 5-hour plan window is over {dispatcher.pauseAt}%
            {dispatcher.pausedUntil !== "unknown" &&
              ` until ${new Date(dispatcher.pausedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
          </span>
        )}
      </div>

      {board.tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-card px-6 py-16 text-center ring-1 ring-border/60">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-xl shadow-primary/30">
            <ListChecks className="size-6" />
          </span>
          <p className="font-semibold">No tasks yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Ask the lead for a change. Once you approve its plan, the task shows up here and the team gets to work.
          </p>
          {leadId && (
            <Button nativeButton={false} render={<Link href={`/dashboard/agents/${leadId}`} />}>
              Talk to the lead
            </Button>
          )}
        </div>
      ) : (
        board.tasks.map((task) => <TaskCard key={task.id} task={task} leadId={leadId} onChange={refresh} />)
      )}
    </div>
  );
}

function TaskCard({ task, leadId, onChange }: { task: BoardTask; leadId: number | null; onChange: () => Promise<void> }) {
  const live = ["queued", "working", "review", "blocked", "awaiting_approval"].includes(task.status);
  const [open, setOpen] = useState(live);
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string>();
  const status = TASK_STATUS[task.status] ?? { label: task.status, className: "bg-muted text-muted-foreground" };
  const doneCount = task.subtasks.filter((s) => s.status === "done").length;
  const setupFailed = task.status === "blocked" && task.events.some((e) => e.type === "workspace.failed") && !task.events.some((e) => e.type === "workspace.ready");

  const act = (fn: () => Promise<{ error?: string; url?: string } | void>) =>
    startBusy(async () => {
      setError(undefined);
      const result = await fn();
      if (result && "error" in result && result.error) setError(result.error);
      if (result && "url" in result && result.url) window.open(result.url, "_blank", "noopener");
      await onChange();
    });

  return (
    <article className={cn("overflow-hidden rounded-3xl bg-card shadow-sm ring-1 ring-border/60", task.pendingApproval && "ring-2 ring-amber-500/50")}>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 p-5 text-left" aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-bold tracking-tight">{task.title}</h2>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", status.className)}>{status.label}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{task.objective}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {task.subtasks.length > 0 && (
              <span>
                {doneCount} of {task.subtasks.length} steps done
              </span>
            )}
            {task.branch && (
              <span className="flex items-center gap-1 font-mono">
                <GitBranch className="size-3.5" />
                {task.branch}
              </span>
            )}
            <span>{new Date(task.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
          </div>
        </div>
        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-4 border-t px-5 py-4">
          {task.status === "awaiting_approval" && leadId && (
            <p className="text-sm text-muted-foreground">
              The plan is waiting for your approval in{" "}
              <Link href={`/dashboard/agents/${leadId}`} className="font-medium text-primary underline underline-offset-2">
                the lead&apos;s chat
              </Link>
              .
            </p>
          )}

          {task.subtasks.length > 0 && (
            <ol className="space-y-1">
              {task.subtasks.map((sub, i) => (
                <SubtaskRow key={sub.id} index={i} subtask={sub} task={task} busy={busy} act={act} />
              ))}
            </ol>
          )}

          {task.pendingApproval?.kind === "pull_request" && (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
              <p className="font-semibold">Ready for your review</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The team finished. Check the reports and changes below. Pushing sends <span className="font-mono">{task.branch}</span> to GitHub and opens its pull request page; nothing is merged.
              </p>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button variant="outline" disabled={busy} onClick={() => act(() => decide(task.pendingApproval!.id, "rejected", ""))}>
                  <X data-icon="inline-start" />
                  Discard
                </Button>
                <Button disabled={busy} onClick={() => act(() => decide(task.pendingApproval!.id, "approved", ""))}>
                  {busy ? <Spinner /> : <Upload data-icon="inline-start" />}
                  Push branch & open PR
                </Button>
              </div>
            </div>
          )}

          {task.pullRequestUrl && (
            <a href={task.pullRequestUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm font-semibold text-primary">
              <GitPullRequest className="size-4" />
              Open the pull request page
              <ExternalLink className="size-3.5" />
            </a>
          )}

          {setupFailed && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-red-500/5 p-3 text-sm">
              <span className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <AlertTriangle className="size-4" />
                Workspace setup failed. See the activity log below.
              </span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => retryWorkspace(task.id))}>
                <RotateCcw data-icon="inline-start" />
                Retry setup
              </Button>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Reports task={task} />
          <ActivityLog task={task} />

          {["queued", "working", "blocked", "review"].includes(task.status) && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={busy} onClick={() => act(() => cancelTask(task.id))}>
                <CircleSlash data-icon="inline-start" />
                Cancel task
              </Button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

const SUB_ICON: Record<string, React.ReactNode> = {
  queued: <Circle className="size-4 text-muted-foreground/60" />,
  done: <Check className="size-4 text-emerald-600" strokeWidth={3} />,
  blocked: <AlertTriangle className="size-4 text-red-600" />,
  failed: <AlertTriangle className="size-4 text-red-600" />,
  cancelled: <CircleSlash className="size-4 text-muted-foreground" />,
};

function SubtaskRow({
  index,
  subtask,
  task,
  busy,
  act,
}: {
  index: number;
  subtask: BoardSubtask;
  task: BoardTask;
  busy: boolean;
  act: (fn: () => Promise<{ error?: string } | void>) => void;
}) {
  const working = subtask.status === "working";
  // What the agent is doing right now: its latest step on this subtask
  const latest = working ? task.events.find((e) => e.taskId === subtask.id && e.type === "tool.called") : undefined;
  const blockedReason = ["blocked", "failed"].includes(subtask.status) ? task.events.find((e) => e.taskId === subtask.id && e.type === "subtask.blocked")?.message : undefined;

  return (
    <li className={cn("rounded-xl px-3 py-2.5", working && "bg-emerald-500/5 ring-1 ring-emerald-500/20")}>
      <div className="flex items-center gap-3">
        <span className="flex size-5 shrink-0 items-center justify-center">{working ? <Spinner className="size-4 text-emerald-600" /> : SUB_ICON[subtask.status]}</span>
        <span className="min-w-0 flex-1 text-sm">
          <span className="text-muted-foreground">{index + 1}. </span>
          {subtask.title}
        </span>
        <span className="hidden shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground sm:inline">
          {subtask.model} · {subtask.effort}
        </span>
        {subtask.agentName && (
          <Link href={`/dashboard/agents/${subtask.agentId}`} className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground hover:underline">
            {subtask.agentName}
          </Link>
        )}
        {working && subtask.agentId && (
          <Button size="icon-xs" variant="ghost" aria-label={`Stop ${subtask.agentName}`} disabled={busy} onClick={() => act(() => stopWorker(subtask.agentId!))}>
            <Square className="size-3 fill-current" />
          </Button>
        )}
        {["blocked", "failed", "cancelled"].includes(subtask.status) && task.status !== "cancelled" && (
          <Button size="xs" variant="outline" disabled={busy} onClick={() => act(() => retrySubtask(subtask.id))}>
            <RotateCcw data-icon="inline-start" />
            Retry
          </Button>
        )}
      </div>
      {latest && <p className="mt-1 ml-8 truncate font-mono text-[11px] text-muted-foreground">{latest.message}</p>}
      {blockedReason && <p className="mt-1 ml-8 text-xs whitespace-pre-wrap text-red-700 dark:text-red-400">{blockedReason}</p>}
    </li>
  );
}

function Reports({ task }: { task: BoardTask }) {
  const docs = task.artifacts.filter((a) => a.type !== "pull_request" && a.content);
  if (!docs.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Reports</p>
      {docs.map((doc) => (
        <details key={doc.id} className="group rounded-xl border bg-muted/20" open={doc.type === "diff" && task.status === "review"}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1 truncate">{doc.type === "plan" ? `Plan: ${doc.title}` : doc.title}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <Markdown className="border-t px-3 py-3">{doc.content!}</Markdown>
        </details>
      ))}
    </div>
  );
}

function ActivityLog({ task }: { task: BoardTask }) {
  if (!task.events.length) return null;
  return (
    <details className="group rounded-xl border bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span className="flex-1">Activity log</span>
        <span className="text-xs text-muted-foreground">{task.events.length} entries</span>
        <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <ol className="max-h-80 space-y-1 overflow-y-auto border-t px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {task.events.map((e) => (
          <li key={e.id} className="flex gap-2">
            <span className="shrink-0 tabular-nums">{new Date(e.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
            {e.agentName && <span className="shrink-0 font-semibold text-foreground/70">{e.agentName}</span>}
            <span className={cn("min-w-0 break-words whitespace-pre-wrap", /failed|blocked/.test(e.type) && "text-red-700 dark:text-red-400")}>{e.message || e.type}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
