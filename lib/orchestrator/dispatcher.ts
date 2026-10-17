import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { agents, approvals, artifacts, db, projects, tasks, type Agent, type Task } from "@/db";
import { DEFAULT_MODEL } from "@/lib/agent-models";
import { getPlanUsage } from "@/lib/plan-usage";
import { refreshLeadStatus } from "@/lib/orchestrator/lead";
import { activeRunCount, isAgentRunning, logEvent, settleOrphanedRuns, startSession, stopAgentRun } from "@/lib/orchestrator/session";
import { reportResultTool, WORKER_DENIED, WORKER_DENIED_COMMANDS, workerPrompt, workerTools, type WorkerReport } from "@/lib/orchestrator/workers";
import { commitLeftovers, diffSummary, getToolchainEnv, prepareWorkspace, removeWorkspace } from "@/lib/orchestrator/workspace";

// The background worker loop. Every few seconds it:
// 1. prepares a workspace (branch + worktree + setup) for each newly approved task;
// 2. starts the next subtask of each task once the earlier ones are done, on the assigned agent,
//    within the concurrency cap and while the Claude plan has room;
// 3. when a task's subtasks are all done, asks you to approve pushing its branch.
// The database is the source of truth, so a restart picks up where it left off.

const TICK_MS = 3000;
const MAX_CONCURRENT = Math.max(1, Number(process.env.AGENT_MAX_CONCURRENT) || 3);
// Pause new work when the 5-hour plan window is this full (percent)
const PAUSE_AT = Number(process.env.AGENT_PAUSE_AT_PERCENT) || 90;
const WORKER_MAX_TURNS = 200;
// After a failed workspace removal (e.g. a file still locked), wait this long before trying again
const REMOVE_RETRY_MS = 10 * 60_000;

type State = { timer: NodeJS.Timeout | null; ticking: boolean; preparing: Set<number>; removing: Set<number>; removeFailedAt: Map<number, number>; pausedUntil: string | null };
const globalForDispatcher = globalThis as unknown as { missionControlDispatcher?: State };
const state = (globalForDispatcher.missionControlDispatcher ??= { timer: null, ticking: false, preparing: new Set(), removing: new Set(), removeFailedAt: new Map(), pausedUntil: null });

export function startDispatcher() {
  if (state.timer) return;
  state.timer = setInterval(() => void tick(), TICK_MS);
  void recoverAfterRestart().catch((error) => console.error("[dispatcher] recovery failed", error));
}

export function dispatcherStatus() {
  return { running: activeRunCount(), max: MAX_CONCURRENT, pausedUntil: state.pausedUntil, pauseAt: PAUSE_AT };
}

// Nothing is running right after a start: settle runs and subtasks the last process left mid-way.
async function recoverAfterRestart() {
  const orphaned = await settleOrphanedRuns();
  const interrupted = await db.update(tasks).set({ status: "queued" }).where(and(isNotNull(tasks.parentId), eq(tasks.status, "working"))).returning({ id: tasks.id });
  await db.update(agents).set({ status: "idle" }).where(eq(agents.status, "working"));
  const leads = await db.select({ id: agents.id }).from(agents).where(eq(agents.role, "lead"));
  await Promise.all(leads.map((lead) => refreshLeadStatus(lead.id)));
  if (orphaned.length || interrupted.length) console.log(`[dispatcher] recovered ${orphaned.length} runs, requeued ${interrupted.length} subtasks`);
}

async function tick() {
  if (state.ticking) return;
  state.ticking = true;
  try {
    await prepareApprovedTasks();
    await dispatchSubtasks();
    await cleanUpFinishedTasks();
  } catch (error) {
    console.error("[dispatcher] tick failed", error);
  } finally {
    state.ticking = false;
  }
}

async function taskEvent(task: Pick<Task, "id" | "projectId">, type: string, message: string, data?: Record<string, unknown>, agentId?: number) {
  await logEvent({ projectId: task.projectId, taskId: task.id, agentId, type, message, data });
}

// Approved tasks (queued) and tasks whose setup was interrupted get a workspace
async function prepareApprovedTasks() {
  const pending = await db
    .select()
    .from(tasks)
    .where(and(isNull(tasks.parentId), inArray(tasks.status, ["queued", "working"]), isNull(tasks.worktreePath)));

  for (const task of pending) {
    if (state.preparing.has(task.id)) continue;
    state.preparing.add(task.id);
    await db.update(tasks).set({ status: "working" }).where(eq(tasks.id, task.id));
    void prepare(task).finally(() => state.preparing.delete(task.id));
  }
}

async function prepare(task: Task) {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, task.projectId));
    if (!project?.repoPath) throw new Error("The project has no code repository linked.");
    await taskEvent(task, "workspace.preparing", "Setting up a workspace");
    const workspace = await prepareWorkspace(project, task, (line, data) => taskEvent(task, "workspace.log", line, data));
    await db.update(tasks).set({ worktreePath: workspace.dir, branch: workspace.branch, baseRevision: workspace.base || task.baseRevision }).where(eq(tasks.id, task.id));
    await taskEvent(task, "workspace.ready", `Workspace ready on ${workspace.branch}`, { path: workspace.dir });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(tasks).set({ status: "blocked" }).where(eq(tasks.id, task.id));
    await taskEvent(task, "workspace.failed", message);
  }
}

async function planUsagePaused() {
  const usage = await getPlanUsage().catch(() => null);
  const window = usage?.windows.five_hour;
  const full = window?.utilization != null && window.utilization >= PAUSE_AT && (!window.resetsAt || new Date(window.resetsAt) > new Date());
  state.pausedUntil = full ? (window?.resetsAt ?? "unknown") : null;
  return full;
}

async function dispatchSubtasks() {
  if (activeRunCount() >= MAX_CONCURRENT) return;

  const candidates = await db
    .select({ subtask: tasks })
    .from(tasks)
    .where(and(isNotNull(tasks.parentId), eq(tasks.status, "queued")))
    .orderBy(asc(tasks.id));
  if (!candidates.length || (await planUsagePaused())) return;

  for (const { subtask } of candidates) {
    if (activeRunCount() >= MAX_CONCURRENT) return;
    const [parent] = await db.select().from(tasks).where(eq(tasks.id, subtask.parentId!));
    if (!parent || parent.status !== "working" || !parent.worktreePath || state.preparing.has(parent.id)) continue;

    // Subtasks run in order: every earlier sibling must be done
    const siblings = await db.select({ id: tasks.id, status: tasks.status }).from(tasks).where(eq(tasks.parentId, parent.id));
    if (siblings.some((s) => s.id < subtask.id && s.status !== "done")) continue;

    const [agent] = subtask.assignedAgentId ? await db.select().from(agents).where(eq(agents.id, subtask.assignedAgentId)) : [];
    if (!agent) {
      await block(parent, subtask, "No team member is assigned to this subtask.");
      continue;
    }
    if (isAgentRunning(agent.id)) continue;
    await runSubtask(agent, parent, subtask);
  }
}

async function block(parent: Task, subtask: Task, reason: string, status: "blocked" | "failed" | "cancelled" = "blocked") {
  await db.update(tasks).set({ status }).where(eq(tasks.id, subtask.id));
  // A cancelled task stays cancelled
  await db.update(tasks).set({ status: "blocked" }).where(and(eq(tasks.id, parent.id), eq(tasks.status, "working")));
  await taskEvent(subtask, "subtask.blocked", reason);
}

async function runSubtask(agent: Agent, parent: Task, subtask: Task) {
  const [project] = await db.select().from(projects).where(eq(projects.id, parent.projectId));
  const siblings = await db.select().from(tasks).where(eq(tasks.parentId, parent.id)).orderBy(asc(tasks.id));
  const earlierIds = siblings.filter((s) => s.id < subtask.id).map((s) => s.id);
  const [planDoc] = await db.select({ content: artifacts.content }).from(artifacts).where(and(eq(artifacts.taskId, parent.id), eq(artifacts.type, "plan")));
  const reports = earlierIds.length
    ? await db.select().from(artifacts).where(inArray(artifacts.taskId, earlierIds)).orderBy(asc(artifacts.id))
    : [];
  const team = await db.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.projectId, project.id));
  const nameOf = (taskId: number | null) => team.find((m) => m.id === siblings.find((s) => s.id === taskId)?.assignedAgentId)?.name ?? "Teammate";

  let report: WorkerReport | null = null;
  const { tools, allowedTools } = workerTools(agent.role);
  const gitIdentity = { name: `${agent.name} (Mission Control)`, email: process.env.AGENT_GIT_EMAIL || "mission-control@localhost" };

  await db.update(tasks).set({ status: "working", branch: parent.branch, worktreePath: parent.worktreePath }).where(eq(tasks.id, subtask.id));
  const started = await startSession({
    agent,
    projectId: project.id,
    taskId: subtask.id,
    cwd: parent.worktreePath!,
    prompt: `Start your subtask "${subtask.title}". Your brief is in your instructions. Finish by calling report_result.`,
    model: subtask.spec.model ?? agent.model ?? DEFAULT_MODEL,
    effort: subtask.spec.effort ?? "high",
    maxTurns: WORKER_MAX_TURNS,
    tools,
    allowedTools,
    disallowedTools: WORKER_DENIED,
    deniedCommands: WORKER_DENIED_COMMANDS,
    mcpTools: (runId) => [reportResultTool({ agent, project, subtask, runId, onReport: (r) => (report = r) })],
    systemPromptAppend: workerPrompt({
      agent,
      project,
      parent,
      subtask,
      plan: planDoc?.content ?? "",
      branch: parent.branch!,
      base: parent.baseRevision ?? project.defaultBranch,
      previousReports: reports.filter((r) => r.type !== "diff").map((r) => ({ agentName: nameOf(r.taskId), title: r.title, content: r.content ?? "" })),
    }),
    env: {
      ...(await getToolchainEnv()),
      GIT_AUTHOR_NAME: gitIdentity.name,
      GIT_AUTHOR_EMAIL: gitIdentity.email,
      GIT_COMMITTER_NAME: gitIdentity.name,
      GIT_COMMITTER_EMAIL: gitIdentity.email,
    },
  });

  if ("error" in started) {
    // The agent got busy in the meantime; try again next tick
    await db.update(tasks).set({ status: "queued" }).where(eq(tasks.id, subtask.id));
    return;
  }
  await taskEvent(subtask, "subtask.started", `${agent.name} started "${subtask.title}"`, undefined, agent.id);

  void started.done.then(async (outcome) => {
    try {
      if (agent.role !== "reviewer") {
        await commitLeftovers(parent.worktreePath!, `${subtask.title}\n\nCommitted by Mission Control for ${agent.name}.`).catch(() => false);
      }
      const finalReport = report as WorkerReport | null;
      if (outcome.ok && finalReport?.outcome === "done") {
        await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, subtask.id));
        await taskEvent(subtask, "subtask.done", `${agent.name} finished "${subtask.title}"`, undefined, agent.id);
        await finishIfComplete(parent.id);
      } else {
        const reason = outcome.cancelled
          ? "Stopped by you."
          : finalReport?.outcome === "blocked"
            ? finalReport.summary
            : (outcome.error ?? `${agent.name} finished without reporting back.`);
        await block(parent, subtask, reason, outcome.cancelled ? "cancelled" : outcome.ok ? "blocked" : "failed");
      }
    } catch (error) {
      console.error(`[dispatcher] after subtask ${subtask.id}`, error);
    } finally {
      await db.update(agents).set({ status: "idle" }).where(eq(agents.id, agent.id));
    }
  });
}

// All subtasks done: record the diff and ask the owner to approve pushing the branch.
async function finishIfComplete(parentId: number) {
  const [parent] = await db.select().from(tasks).where(eq(tasks.id, parentId));
  const subtasks = await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.parentId, parentId));
  if (!parent || parent.status !== "working" || subtasks.some((s) => s.status !== "done")) return;

  const summary = await diffSummary(parent.worktreePath!, parent.baseRevision ?? "HEAD~1").catch(() => ({ stat: "", log: "" }));
  await db.update(tasks).set({ status: "review" }).where(eq(tasks.id, parentId));
  await db.insert(artifacts).values({
    projectId: parent.projectId,
    taskId: parentId,
    type: "diff",
    title: `Changes on ${parent.branch}`,
    content: [summary.log && `**Commits**\n\`\`\`\n${summary.log}\n\`\`\``, summary.stat && `**Files**\n\`\`\`\n${summary.stat}\n\`\`\``].filter(Boolean).join("\n\n"),
  });
  await db.insert(approvals).values({
    projectId: parent.projectId,
    taskId: parentId,
    requestedByAgentId: parent.assignedAgentId,
    kind: "pull_request",
    title: `Push ${parent.branch} for a pull request`,
    summary: parent.title,
  });
  await taskEvent(parent, "task.ready", `"${parent.title}" is ready for your review`);
  if (parent.assignedAgentId) {
    await logEvent({ projectId: parent.projectId, taskId: parentId, agentId: parent.assignedAgentId, type: "task.ready", message: parent.title });
    await refreshLeadStatus(parent.assignedAgentId);
  }
}

// Pushed or cancelled tasks no longer need their worktree. Waits until nobody is working in it
// (a stopped agent may still be winding down).
async function cleanUpFinishedTasks() {
  const finished = await db
    .select()
    .from(tasks)
    .where(and(isNull(tasks.parentId), inArray(tasks.status, ["done", "cancelled"]), isNotNull(tasks.worktreePath)));

  for (const task of finished) {
    if (state.removing.has(task.id) || Date.now() - (state.removeFailedAt.get(task.id) ?? 0) < REMOVE_RETRY_MS) continue;
    const subtasks = await db.select({ status: tasks.status, agentId: tasks.assignedAgentId }).from(tasks).where(eq(tasks.parentId, task.id));
    if (subtasks.some((s) => s.status === "working" || (s.agentId !== null && isAgentRunning(s.agentId) && s.status !== "done"))) continue;

    state.removing.add(task.id);
    void (async () => {
      try {
        const [project] = await db.select({ repoPath: projects.repoPath }).from(projects).where(eq(projects.id, task.projectId));
        if (project?.repoPath) await removeWorkspace(project.repoPath, task.worktreePath!);
        await db.update(tasks).set({ worktreePath: null }).where(or(eq(tasks.id, task.id), eq(tasks.parentId, task.id)));
        await taskEvent(task, "workspace.removed", `Removed the workspace; the branch ${task.branch} is kept`);
        state.removeFailedAt.delete(task.id);
      } catch (error) {
        state.removeFailedAt.set(task.id, Date.now());
        console.error(`[dispatcher] couldn't remove the workspace for task ${task.id}`, error);
      } finally {
        state.removing.delete(task.id);
      }
    })();
  }
}

// Used by the Tasks page
export async function retrySubtask(subtaskId: number) {
  const [subtask] = await db.select().from(tasks).where(eq(tasks.id, subtaskId));
  if (!subtask?.parentId || !["blocked", "failed", "cancelled"].includes(subtask.status)) return { error: "Only blocked or failed subtasks can be retried." };
  await db.update(tasks).set({ status: "queued" }).where(eq(tasks.id, subtaskId));
  await db.update(tasks).set({ status: "working" }).where(eq(tasks.id, subtask.parentId));
  await taskEvent(subtask, "subtask.retried", "Queued again");
  return {};
}

// Set up the workspace again after a failed setup
export async function retryWorkspace(taskId: number) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task || task.parentId || task.status !== "blocked" || task.worktreePath) return { error: "Only a task whose setup failed can retry it." };
  await db.update(tasks).set({ status: "queued" }).where(eq(tasks.id, taskId));
  return {};
}

export async function cancelTask(taskId: number) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task || task.parentId) return { error: "Task not found." };
  const children = await db.select().from(tasks).where(eq(tasks.parentId, taskId));
  await db.update(tasks).set({ status: "cancelled" }).where(eq(tasks.id, taskId));
  await db.update(tasks).set({ status: "cancelled" }).where(and(eq(tasks.parentId, taskId), inArray(tasks.status, ["queued", "blocked", "failed"])));
  await db.update(approvals).set({ status: "rejected", decidedAt: new Date(), decisionNote: "Task cancelled" }).where(and(eq(approvals.taskId, taskId), eq(approvals.status, "pending")));
  // Stop whoever is working on it; their run settles the subtask as cancelled
  for (const child of children) if (child.status === "working" && child.assignedAgentId) stopAgentRun(child.assignedAgentId);
  await taskEvent(task, "task.cancelled", "Cancelled");
  if (task.assignedAgentId) await refreshLeadStatus(task.assignedAgentId);
  return {};
}

