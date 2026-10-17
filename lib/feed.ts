import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { agents, approvals, artifacts, db, events, tasks, type AgentStatus } from "@/db";
import { authReady } from "@/lib/agent-auth";
import { isLeadRunning } from "@/lib/orchestrator/lead";

// Everything the agent chat panel shows: the conversation and activity (events), the plans the
// agent asked you to approve, and whether it's working right now.

export type FeedEvent = { id: number; type: string; message: string; createdAt: string; data: Record<string, unknown> | null };

export type FeedPlan = {
  approvalId: number;
  taskId: number | null;
  title: string;
  summary: string;
  status: "pending" | "approved" | "rejected";
  decisionNote: string | null;
  plan: string;
  subtasks: { id: number; title: string; agentName: string | null; model: string | null; effort: string | null }[];
};

export type AgentFeed = {
  events: FeedEvent[];
  plans: FeedPlan[];
  status: AgentStatus;
  running: boolean;
  authReady: boolean;
};

const PAGE = 500;

export async function getAgentFeed(agentId: number, afterId = 0): Promise<AgentFeed | null> {
  const [agent] = await db.select({ status: agents.status }).from(agents).where(eq(agents.id, agentId));
  if (!agent) return null;

  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.agentId, agentId), gt(events.id, afterId)))
    .orderBy(asc(events.id))
    .limit(PAGE);

  // Plans are small and few; always send them all so decisions made elsewhere show up
  const requested = await db.select().from(approvals).where(and(eq(approvals.requestedByAgentId, agentId), eq(approvals.kind, "plan")));
  const taskIds = requested.flatMap((a) => (a.taskId ? [a.taskId] : []));

  const [planDocs, subtasks, team] = taskIds.length
    ? await Promise.all([
        db.select().from(artifacts).where(and(inArray(artifacts.taskId, taskIds), eq(artifacts.type, "plan"))),
        db.select().from(tasks).where(inArray(tasks.parentId, taskIds)).orderBy(asc(tasks.id)),
        db.select({ id: agents.id, name: agents.name }).from(agents),
      ])
    : [[], [], []];
  const nameOf = (id: number | null) => team.find((member) => member.id === id)?.name ?? null;

  return {
    events: rows.map((e) => ({ id: e.id, type: e.type, message: e.message, createdAt: e.createdAt.toISOString(), data: e.data ?? null })),
    plans: requested.map((a) => ({
      approvalId: a.id,
      taskId: a.taskId,
      title: a.title,
      summary: a.summary,
      status: a.status,
      decisionNote: a.decisionNote,
      plan: planDocs.find((doc) => doc.taskId === a.taskId)?.content ?? "",
      subtasks: subtasks
        .filter((t) => t.parentId === a.taskId)
        .map((t) => ({ id: t.id, title: t.title, agentName: nameOf(t.assignedAgentId), model: t.spec.model ?? null, effort: t.spec.effort ?? null })),
    })),
    status: agent.status,
    running: isLeadRunning(agentId),
    authReady: authReady(),
  };
}
