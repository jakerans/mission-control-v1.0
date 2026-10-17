import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { agents, approvals, db, events, runs, tasks, type AgentStatus } from "@/db";
import { modelLabel } from "@/lib/agent-models";
import { ROLE_LABELS } from "@/lib/agents";
import { dispatcherStatus } from "@/lib/orchestrator/dispatcher";

// The Overview page: what needs you, what the team is doing, how much of the plan it used today,
// and the latest milestones.

const MILESTONES = [
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "subtask.done",
  "subtask.blocked",
  "task.ready",
  "task.cancelled",
  "workspace.failed",
];
const RECENT = 15;

export type OverviewAgent = {
  id: number;
  name: string;
  role: string;
  desk: number | null;
  status: AgentStatus;
  model: string;
  // While working: the subtask (or "Chatting with you" for the lead) and its latest step
  doing: string | null;
  lastStep: string | null;
  tokensToday: number;
  runsToday: number;
};

export type Overview = {
  needsYou: { approvalId: number; kind: string; title: string; taskTitle: string | null; taskId: number | null; agentId: number | null; createdAt: string }[];
  team: OverviewAgent[];
  counts: { inProgress: number; doneThisWeek: number };
  recent: { id: number; type: string; message: string; agentName: string | null; taskTitle: string | null; createdAt: string }[];
  dispatcher: ReturnType<typeof dispatcherStatus>;
};

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function getOverview(projectId: number): Promise<Overview> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [team, pending, parentCounts, usage, running, recent] = await Promise.all([
    db.select().from(agents).where(eq(agents.projectId, projectId)).orderBy(agents.desk, agents.id),
    db
      .select()
      .from(approvals)
      .where(and(eq(approvals.projectId, projectId), eq(approvals.status, "pending")))
      .orderBy(approvals.createdAt),
    db
      .select({
        inProgress: sql<number>`count(*) filter (where ${tasks.status} in ('queued','working','blocked','review'))`.mapWith(Number),
        doneThisWeek: sql<number>`count(*) filter (where ${tasks.status} = 'done' and ${tasks.updatedAt} >= ${weekAgo.toISOString()}::timestamptz)`.mapWith(Number),
      })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.parentId))),
    db
      .select({
        agentId: runs.agentId,
        tokens: sql<number>`coalesce(sum(coalesce(${runs.inputTokens}, 0) + coalesce(${runs.outputTokens}, 0)), 0)`.mapWith(Number),
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(runs)
      .where(and(eq(runs.projectId, projectId), gte(runs.startedAt, startOfToday())))
      .groupBy(runs.agentId),
    db.select().from(runs).where(and(eq(runs.projectId, projectId), eq(runs.status, "running"))),
    db
      .select()
      .from(events)
      // task.ready is also logged on the lead's chat (with its agent id); show it once
      .where(and(eq(events.projectId, projectId), inArray(events.type, MILESTONES), sql`not (${events.type} = 'task.ready' and ${events.agentId} is not null)`))
      .orderBy(desc(events.id))
      .limit(RECENT),
  ]);

  // Titles for the tasks mentioned above
  const taskIds = [...new Set([...pending.map((a) => a.taskId), ...running.map((r) => r.taskId), ...recent.map((e) => e.taskId)].filter((id): id is number => id !== null))];
  const titled = taskIds.length ? await db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, taskIds)) : [];
  const titleOf = (id: number | null) => titled.find((t) => t.id === id)?.title ?? null;

  // Latest step of each running run
  const runIds = running.map((r) => r.id);
  const steps = runIds.length
    ? await db
        .selectDistinctOn([events.runId], { runId: events.runId, message: events.message })
        .from(events)
        .where(and(inArray(events.runId, runIds), eq(events.type, "tool.called")))
        .orderBy(events.runId, desc(events.id))
    : [];

  return {
    needsYou: pending.map((a) => ({
      approvalId: a.id,
      kind: a.kind,
      title: a.title,
      taskTitle: titleOf(a.taskId),
      taskId: a.taskId,
      agentId: a.requestedByAgentId,
      createdAt: a.createdAt.toISOString(),
    })),
    team: team.map((agent) => {
      const run = running.find((r) => r.agentId === agent.id);
      const used = usage.find((u) => u.agentId === agent.id);
      return {
        id: agent.id,
        name: agent.name,
        role: ROLE_LABELS[agent.role],
        desk: agent.desk,
        status: agent.status,
        model: modelLabel(agent.model),
        doing: run ? (titleOf(run.taskId) ?? (agent.role === "lead" ? "Replying to you" : "Working")) : null,
        lastStep: run ? (steps.find((s) => s.runId === run.id)?.message ?? null) : null,
        tokensToday: used?.tokens ?? 0,
        runsToday: used?.count ?? 0,
      };
    }),
    counts: parentCounts[0] ?? { inProgress: 0, doneThisWeek: 0 },
    recent: recent.map((e) => ({
      id: e.id,
      type: e.type,
      message: e.message,
      agentName: team.find((a) => a.id === e.agentId)?.name ?? null,
      taskTitle: titleOf(e.taskId),
      createdAt: e.createdAt.toISOString(),
    })),
    dispatcher: dispatcherStatus(),
  };
}
