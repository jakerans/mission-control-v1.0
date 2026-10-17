import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { agents, approvals, artifacts, db, events, tasks, type TaskSpec } from "@/db";
import { modelLabel } from "@/lib/agent-models";
import { dispatcherStatus } from "@/lib/orchestrator/dispatcher";

// Everything the Tasks page shows: each task with its subtasks, the agents on them, their reports,
// the activity log, and what's waiting on you.

const RECENT_TASKS = 30;
const EVENTS_PER_TASK = 80;

export type BoardSubtask = {
  id: number;
  title: string;
  objective: string;
  status: string;
  agentId: number | null;
  agentName: string | null;
  agentRole: string | null;
  model: string;
  effort: string;
};

export type BoardArtifact = { id: number; taskId: number | null; type: string; title: string; content: string | null; url: string | null };
export type BoardEvent = { id: number; taskId: number | null; type: string; message: string; createdAt: string; agentName: string | null };

export type BoardTask = {
  id: number;
  title: string;
  objective: string;
  status: string;
  branch: string | null;
  createdAt: string;
  subtasks: BoardSubtask[];
  artifacts: BoardArtifact[];
  events: BoardEvent[];
  pendingApproval: { id: number; kind: string; title: string } | null;
  pullRequestUrl: string | null;
};

export type TaskBoard = { tasks: BoardTask[]; dispatcher: ReturnType<typeof dispatcherStatus> };

export async function getTaskBoard(projectId: number): Promise<TaskBoard> {
  const parents = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.parentId)))
    .orderBy(desc(tasks.id))
    .limit(RECENT_TASKS);
  if (!parents.length) return { tasks: [], dispatcher: dispatcherStatus() };

  const parentIds = parents.map((p) => p.id);
  const children = await db.select().from(tasks).where(inArray(tasks.parentId, parentIds)).orderBy(asc(tasks.id));
  const allIds = [...parentIds, ...children.map((c) => c.id)];
  const [team, docs, pending, log] = await Promise.all([
    db.select().from(agents).where(eq(agents.projectId, projectId)),
    db.select().from(artifacts).where(inArray(artifacts.taskId, allIds)).orderBy(asc(artifacts.id)),
    db.select().from(approvals).where(and(inArray(approvals.taskId, parentIds), eq(approvals.status, "pending"))),
    db.select().from(events).where(inArray(events.taskId, allIds)).orderBy(desc(events.id)).limit(RECENT_TASKS * EVENTS_PER_TASK),
  ]);
  const agentOf = (id: number | null) => team.find((a) => a.id === id);
  const parentOf = (taskId: number | null) => (taskId === null ? null : parentIds.includes(taskId) ? taskId : (children.find((c) => c.id === taskId)?.parentId ?? null));

  return {
    dispatcher: dispatcherStatus(),
    tasks: parents.map((parent) => {
      const mine = children.filter((c) => c.parentId === parent.id);
      const ids = new Set([parent.id, ...mine.map((c) => c.id)]);
      const approval = pending.find((a) => a.taskId === parent.id);
      const taskDocs = docs.filter((d) => d.taskId !== null && ids.has(d.taskId));
      return {
        id: parent.id,
        title: parent.title,
        objective: parent.objective,
        status: parent.status,
        branch: parent.branch,
        createdAt: parent.createdAt.toISOString(),
        subtasks: mine.map((c) => {
          const agent = agentOf(c.assignedAgentId);
          const spec = c.spec as TaskSpec;
          return {
            id: c.id,
            title: c.title,
            objective: c.objective,
            status: c.status,
            agentId: agent?.id ?? null,
            agentName: agent?.name ?? null,
            agentRole: agent?.role ?? null,
            model: modelLabel(spec.model ?? agent?.model),
            effort: spec.effort ?? "high",
          };
        }),
        artifacts: taskDocs
          .filter((d) => d.type !== "plan" || d.taskId === parent.id)
          .map((d) => ({ id: d.id, taskId: d.taskId, type: d.type, title: d.title, content: d.content, url: d.url })),
        events: log
          .filter((e) => parentOf(e.taskId) === parent.id)
          .slice(0, EVENTS_PER_TASK)
          .map((e) => ({ id: e.id, taskId: e.taskId, type: e.type, message: e.message, createdAt: e.createdAt.toISOString(), agentName: agentOf(e.agentId)?.name ?? null })),
        pendingApproval: approval ? { id: approval.id, kind: approval.kind, title: approval.title } : null,
        pullRequestUrl: taskDocs.findLast((d) => d.type === "pull_request")?.url ?? null,
      };
    }),
  };
}
