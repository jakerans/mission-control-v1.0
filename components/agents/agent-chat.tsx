"use client";

/* eslint-disable @next/next/no-img-element -- avatars are sprite frames served from our own API */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUp, Check, ChevronDown, CircleSlash, ClipboardList, FileSearch, KeyRound, MessageSquarePlus, Square, X } from "lucide-react";
import { decidePlan, sendMessage, startNewConversation, stopAgent } from "@/app/agents/actions";
import { modelLabel } from "@/lib/agent-models";
import type { AgentFeed, FeedEvent, FeedPlan } from "@/lib/feed";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/agents/markdown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  agentId: number;
  agentName: string;
  avatarUrl: string | null;
  initialFeed: AgentFeed;
  // Why the lead can't take messages yet (e.g. no repository linked), if it can't
  blockedReason?: string;
};

// Polling cadence: quick while the agent works, relaxed while it's idle
const FAST_POLL = 1500;
const SLOW_POLL = 6000;

// Conversation rows: consecutive tool calls are folded into one activity row
type Row =
  | { kind: "user" | "agent"; event: FeedEvent }
  | { kind: "activity"; events: FeedEvent[] }
  | { kind: "plan"; event: FeedEvent; approvalId: number }
  | { kind: "note"; event: FeedEvent }
  | { kind: "divider"; event: FeedEvent };

function toRows(events: FeedEvent[]): Row[] {
  const rows: Row[] = [];
  for (const event of events) {
    const last = rows[rows.length - 1];
    if (event.type === "conversation.new") rows.push({ kind: "divider", event });
    else if (event.type === "message.user") rows.push({ kind: "user", event });
    else if (event.type === "message.agent") rows.push({ kind: "agent", event });
    else if (event.type === "tool.called") {
      if (last?.kind === "activity") last.events.push(event);
      else rows.push({ kind: "activity", events: [event] });
    } else if (event.type === "approval.requested" && typeof event.data?.approvalId === "number") {
      rows.push({ kind: "plan", event, approvalId: event.data.approvalId });
    } else if (event.type !== "approval.requested") rows.push({ kind: "note", event });
  }
  return rows;
}

export function AgentChat({ agentId, agentName, avatarUrl, initialFeed, blockedReason }: Props) {
  const [feed, setFeed] = useState(initialFeed);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [sending, startSend] = useTransition();
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastIdRef = useRef(0);
  lastIdRef.current = feed.events.at(-1)?.id ?? 0;

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/agents/${agentId}/feed?after=${lastIdRef.current}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const next = (await res.json()) as AgentFeed;
    setFeed((prev) => {
      const known = new Set(prev.events.map((e) => e.id));
      return { ...next, events: [...prev.events, ...next.events.filter((e) => !known.has(e.id))] };
    });
  }, [agentId]);

  // Poll for new activity; faster while the agent is working
  useEffect(() => {
    const timer = window.setInterval(refresh, feed.running || sending ? FAST_POLL : SLOW_POLL);
    return () => window.clearInterval(timer);
  }, [refresh, feed.running, sending]);

  // The page header (and sidebar badges) are server-rendered; refresh them when the status changes
  const router = useRouter();
  const shownStatus = useRef(initialFeed.status);
  useEffect(() => {
    if (feed.status === shownStatus.current) return;
    shownStatus.current = feed.status;
    router.refresh();
  }, [feed.status, router]);

  // Follow new messages unless you've scrolled up to read
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [feed.events.length, feed.running]);

  const send = () => {
    const text = draft.trim();
    if (!text || sending || feed.running) return;
    setError(undefined);
    stickToBottom.current = true;
    startSend(async () => {
      const result = await sendMessage(agentId, text);
      if (result.error) setError(result.error);
      else setDraft("");
      await refresh();
    });
  };

  const rows = toRows(feed.events);
  const disabledReason = blockedReason ?? (!feed.authReady ? "Add an API key to start." : undefined);
  const working = feed.running || sending;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {!feed.authReady && <ApiKeyNotice />}

          {rows.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Avatar url={avatarUrl} name={agentName} className="size-16" />
              <div>
                <p className="font-semibold">Talk to {agentName}</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  Ask about the code, or describe a feature or bug. {agentName} investigates the repository and sends you a plan to approve before anyone changes anything.
                </p>
              </div>
            </div>
          )}

          {rows.map((row) => {
            switch (row.kind) {
              case "user":
                return (
                  <div key={row.event.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground shadow-sm">
                      {row.event.message}
                    </div>
                  </div>
                );
              case "agent":
                return (
                  <div key={row.event.id} className="flex gap-3">
                    <Avatar url={avatarUrl} name={agentName} className="mt-0.5 size-8" />
                    <Markdown className="min-w-0 flex-1 pt-1">{row.event.message}</Markdown>
                  </div>
                );
              case "activity":
                return <ActivityRow key={row.events[0].id} events={row.events} live={working && row === rows.at(-1)} />;
              case "plan": {
                const plan = feed.plans.find((p) => p.approvalId === row.approvalId);
                return plan ? <PlanCard key={row.event.id} plan={plan} onDecided={refresh} /> : null;
              }
              case "note":
                return <NoteRow key={row.event.id} event={row.event} />;
              case "divider":
                return (
                  <div key={row.event.id} className="flex items-center gap-3 text-[11px] font-semibold text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    New conversation
                    <span className="h-px flex-1 bg-border" />
                  </div>
                );
            }
          })}

          {working && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Avatar url={avatarUrl} name={agentName} className="size-8 animate-pulse" />
              <span>{agentName} is working…</span>
            </div>
          )}
        </div>
      </div>

      <div className="border-t bg-card/80 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto max-w-3xl">
          {error && (
            <Alert variant="destructive" className="mb-2">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {rows.length > 0 && rows.at(-1)?.kind !== "divider" && !working && (
            <div className="mb-2 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() =>
                  startNewConversation(agentId).then((r) => {
                    if (r.error) setError(r.error);
                    return refresh();
                  })
                }
              >
                <MessageSquarePlus data-icon="inline-start" />
                New conversation
              </Button>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm focus-within:ring-3 focus-within:ring-ring/40"
          >
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={Boolean(disabledReason)}
              placeholder={disabledReason ?? `Message ${agentName}… (Enter to send, Shift+Enter for a new line)`}
              aria-label={`Message ${agentName}`}
              rows={1}
              className="max-h-48 min-h-10 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            {feed.running ? (
              <Button type="button" variant="outline" size="icon-lg" className="rounded-xl" onClick={() => stopAgent(agentId).then(refresh)} aria-label={`Stop ${agentName}`}>
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button type="submit" size="icon-lg" className="rounded-xl" disabled={!draft.trim() || sending || Boolean(disabledReason)} aria-label="Send">
                {sending ? <Spinner /> : <ArrowUp />}
              </Button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

function Avatar({ url, name, className }: { url: string | null; name: string; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-end justify-center overflow-hidden rounded-full bg-accent", className)}>
      {url ? (
        <img src={url} alt="" className="h-[125%] w-auto max-w-none translate-y-[10%]" />
      ) : (
        <span className="self-center text-xs font-bold text-accent-foreground">{name[0]}</span>
      )}
    </span>
  );
}

// "Looked at 12 things" with the latest step visible and the rest expandable
function ActivityRow({ events, live }: { events: FeedEvent[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const latest = events.at(-1)!;
  return (
    <div className="ml-11 rounded-xl border border-dashed bg-muted/30 text-xs text-muted-foreground">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left" aria-expanded={open}>
        {live ? <Spinner className="size-3.5" /> : <FileSearch className="size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">
          {events.length > 1 && <span className="font-semibold text-foreground/80">{events.length} steps · </span>}
          {latest.message}
        </span>
        {events.length > 1 && <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")} />}
      </button>
      {open && (
        <ol className="space-y-1 border-t border-dashed px-3 py-2 font-mono text-[11px]">
          {events.map((e) => (
            <li key={e.id} className="truncate" title={e.message}>
              {e.message}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function NoteRow({ event }: { event: FeedEvent }) {
  if (event.type === "run.finished") {
    // On the Claude plan nothing is billed per reply, so show what it used instead of a price
    const tokens = typeof event.data?.tokens === "number" ? event.data.tokens : null;
    const cost = typeof event.data?.costUsd === "number" ? event.data.costUsd : null;
    const usage =
      event.data?.auth === "claude_login"
        ? tokens !== null && `used ${formatTokens(tokens)} tokens of your plan`
        : cost !== null && `cost $${cost.toFixed(2)}`;
    const model = typeof event.data?.model === "string" ? modelLabel(event.data.model) : null;
    const text = [model, usage].filter(Boolean).join(" · ");
    return text ? <p className="ml-11 text-[11px] text-muted-foreground/70">{text}</p> : null;
  }
  const styles: Record<string, { Icon: typeof Check; text: string; className: string }> = {
    "run.failed": { Icon: AlertTriangle, text: event.message || "The run failed.", className: "text-destructive" },
    "run.cancelled": { Icon: CircleSlash, text: "Stopped.", className: "text-muted-foreground" },
    "approval.approved": { Icon: Check, text: "You approved the plan.", className: "text-emerald-700 dark:text-emerald-400" },
    "approval.rejected": { Icon: X, text: `You rejected the plan${event.message ? `: ${event.message}` : "."}`, className: "text-muted-foreground" },
  };
  const style = styles[event.type];
  if (!style) return null;
  return (
    <p className={cn("ml-11 flex items-start gap-1.5 text-xs", style.className)}>
      <style.Icon className="mt-0.5 size-3.5 shrink-0" />
      <span className="whitespace-pre-wrap">{style.text}</span>
    </p>
  );
}

function formatTokens(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

const PLAN_STATUS = {
  pending: { label: "Waiting for you", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  approved: { label: "Approved", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  rejected: { label: "Rejected", className: "bg-muted text-muted-foreground" },
} as const;

function PlanCard({ plan, onDecided }: { plan: FeedPlan; onDecided: () => Promise<void> }) {
  const pending = plan.status === "pending";
  const [open, setOpen] = useState(pending);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [deciding, startDecide] = useTransition();

  const decide = (decision: "approved" | "rejected") =>
    startDecide(async () => {
      setError(undefined);
      const result = await decidePlan(plan.approvalId, decision, note);
      if (result.error) setError(result.error);
      await onDecided();
    });

  const status = PLAN_STATUS[plan.status];
  return (
    <div className={cn("ml-11 overflow-hidden rounded-2xl border bg-card shadow-sm", pending && "ring-2 ring-amber-500/50")}>
      <div className="flex items-start gap-3 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <ClipboardList className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{plan.title}</p>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", status.className)}>{status.label}</span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{plan.summary}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 border-t px-4 py-2 text-xs font-semibold text-primary"
        aria-expanded={open}
      >
        {open ? "Hide plan" : "Show plan"}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 border-t bg-muted/20 px-4 py-4">
          <Markdown>{plan.plan}</Markdown>
          {plan.subtasks.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Work for the team</p>
              <ol className="space-y-1.5 text-sm">
                {plan.subtasks.map((t, i) => (
                  <li key={t.id} className="flex gap-2">
                    <span className="w-5 shrink-0 text-right text-muted-foreground">{i + 1}.</span>
                    <span className="min-w-0 flex-1">{t.title}</span>
                    {(t.model || t.effort) && (
                      <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground" title="Juno chose this for the subtask">
                        {[t.model && modelLabel(t.model), t.effort && `${t.effort} effort`].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    {t.agentName && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">{t.agentName}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {plan.status === "rejected" && plan.decisionNote && <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">Your note: {plan.decisionNote}</p>}

      {pending && (
        <div className="space-y-2 border-t p-3">
          {rejecting && (
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What should change? (sent back to the lead so it can revise)"
              className="min-h-20 text-sm"
              autoFocus
            />
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {rejecting ? (
              <>
                <Button variant="ghost" onClick={() => setRejecting(false)} disabled={deciding}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => decide("rejected")} disabled={deciding}>
                  {deciding && <Spinner />}
                  {note.trim() ? "Reject and send note" : "Reject"}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setRejecting(true)} disabled={deciding}>
                  Reject…
                </Button>
                <Button onClick={() => decide("approved")} disabled={deciding}>
                  {deciding ? <Spinner /> : <Check />}
                  Approve plan
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ApiKeyNotice() {
  return (
    <Alert>
      <KeyRound />
      <AlertTitle>Add your Anthropic API key</AlertTitle>
      <AlertDescription>
        <p>
          Agents run on the Claude Agent SDK, which needs an API key from{" "}
          <a href="https://platform.claude.com/" target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2">
            platform.claude.com
          </a>
          . Add it to <code className="rounded bg-muted px-1 font-mono text-xs">mission-control/.env</code> as{" "}
          <code className="rounded bg-muted px-1 font-mono text-xs">ANTHROPIC_API_KEY=…</code>, then restart the app.
        </p>
      </AlertDescription>
    </Alert>
  );
}
