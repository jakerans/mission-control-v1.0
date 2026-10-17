import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createSdkMcpServer, query, tool, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { agents, approvals, artifacts, db, events, projects, runs, taskDependencies, tasks, type Agent, type Project } from "@/db";
import { listAgents, ROLE_LABELS } from "@/lib/agents";
import { agentAuth, authReady } from "@/lib/agent-auth";
import { DEFAULT_MODEL, EFFORT_LEVELS, LEAD_SELECTABLE_MODELS, modelLabel } from "@/lib/agent-models";
import { recordRateLimit, refreshPlanUsage } from "@/lib/plan-usage";

// The lead agent: a read-only Claude Agent SDK session in the project's repository. You chat with it
// in Mission Control; when a request needs work, it investigates and submits a plan through the
// propose_plan tool, which lands in the approval queue. It can't edit files, merge or deploy.

const exec = promisify(execFile);

const MAX_TURNS = 80;
const MCP_SERVER = "mission-control";

// Read-only git commands the lead may run without asking
const GIT_READ_COMMANDS = ["log", "show", "diff", "status", "ls-files", "blame", "branch", "rev-parse"];
const ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  ...GIT_READ_COMMANDS.map((cmd) => `Bash(git ${cmd} *)`),
  `mcp__${MCP_SERVER}__propose_plan`,
];

// Runs in progress in this server process, so they can be stopped, and so a run left "running" by a
// restart can be recognised as interrupted.
type ActiveRun = { runId: number; abort: AbortController };
const globalForRuns = globalThis as unknown as { activeLeadRuns?: Map<number, ActiveRun> };
const active = (globalForRuns.activeLeadRuns ??= new Map<number, ActiveRun>());

export function isLeadRunning(agentId: number) {
  return active.has(agentId);
}

async function logEvent(values: typeof events.$inferInsert) {
  await db.insert(events).values(values);
}

// Marks runs the database thinks are running, but which this process isn't running, as interrupted
// (the server restarted mid-run).
async function settleOrphanedRuns(agentId: number) {
  if (active.has(agentId)) return;
  const orphaned = await db
    .update(runs)
    .set({ status: "failed", error: "Interrupted: Mission Control restarted during this run.", endedAt: new Date() })
    .where(and(eq(runs.agentId, agentId), eq(runs.status, "running")))
    .returning({ id: runs.id });
  if (orphaned.length) await refreshLeadStatus(agentId);
}

// Idle, or waiting on you while a plan it requested is undecided.
export async function refreshLeadStatus(agentId: number) {
  const [pending] = await db
    .select({ id: approvals.id })
    .from(approvals)
    .where(and(eq(approvals.requestedByAgentId, agentId), eq(approvals.status, "pending")))
    .limit(1);
  const status = active.has(agentId) ? "working" : pending ? "needs_approval" : "idle";
  await db.update(agents).set({ status }).where(eq(agents.id, agentId));
}

// Sends a message to a project's lead. Returns immediately; the reply and the lead's activity are
// written to the events table as the run progresses.
export async function sendToLead(agentId: number, text: string): Promise<{ error?: string }> {
  const message = text.trim();
  if (!message) return { error: "Write a message first." };

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent || agent.role !== "lead") return { error: "Only the lead agent takes messages for now." };
  const [project] = await db.select().from(projects).where(eq(projects.id, agent.projectId));
  if (!project?.repoPath) return { error: "Link this project to a code repository in Settings first." };
  // Without a key the SDK would silently fall back to the Claude Code login, so require the
  // sign-in method to be chosen explicitly
  if (!authReady()) return { error: "Add your Anthropic API key to mission-control/.env as ANTHROPIC_API_KEY, then restart the app." };

  await settleOrphanedRuns(agentId);
  if (active.has(agentId)) return { error: `${agent.name} is still working on your last message.` };

  await logEvent({ projectId: project.id, agentId, type: "message.user", message });
  const [run] = await db.insert(runs).values({ projectId: project.id, agentId, engine: "claude", status: "running" }).returning();
  const abort = new AbortController();
  active.set(agentId, { runId: run.id, abort });
  await db.update(agents).set({ status: "working" }).where(eq(agents.id, agentId));

  // Deliberately not awaited: the run outlives this request.
  void executeRun(agent, project, run.id, message, abort).catch((error) => console.error(`[lead] run ${run.id} crashed`, error));
  return {};
}

// The next message starts a fresh session (the old one stays in the history above it)
export async function newConversation(agentId: number): Promise<{ error?: string }> {
  if (active.has(agentId)) return { error: "Wait for the current reply to finish, or stop it first." };
  const [agent] = await db.select({ projectId: agents.projectId }).from(agents).where(eq(agents.id, agentId));
  if (!agent) return { error: "Agent not found." };
  await logEvent({ projectId: agent.projectId, agentId, type: "conversation.new" });
  return {};
}

export async function stopLead(agentId: number) {
  active.get(agentId)?.abort.abort();
}

async function headRevision(repoPath: string) {
  try {
    const { stdout } = await exec("git", ["-C", repoPath, "rev-parse", "HEAD"], { timeout: 10_000, windowsHide: true });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function executeRun(agent: Agent, project: Project, runId: number, message: string, abort: AbortController) {
  const base = { projectId: project.id, agentId: agent.id, runId };
  try {
    const baseRevision = await headRevision(project.repoPath!);
    const team = await listAgents(project.id);

    // Continue the lead's conversation: its latest session since you last started a new one
    const [reset] = await db
      .select({ at: events.createdAt })
      .from(events)
      .where(and(eq(events.agentId, agent.id), eq(events.type, "conversation.new")))
      .orderBy(desc(events.id))
      .limit(1);
    const [previous] = await db
      .select({ sessionId: runs.sessionId })
      .from(runs)
      .where(and(eq(runs.agentId, agent.id), isNotNull(runs.sessionId), reset ? gt(runs.startedAt, reset.at) : undefined))
      .orderBy(desc(runs.startedAt))
      .limit(1);

    const missionControl = createSdkMcpServer({
      name: MCP_SERVER,
      version: "1.0.0",
      tools: [proposePlanTool({ agent, project, runId, baseRevision, team })],
    });

    const conversation = query({
      prompt: message,
      options: {
        cwd: project.repoPath!,
        model: agent.model ?? DEFAULT_MODEL,
        effort: "high",
        resume: previous?.sessionId ?? undefined,
        abortController: abort,
        maxTurns: MAX_TURNS,
        // Don't load the repository's or this PC's Claude Code settings (hooks, MCP servers,
        // permissions); the lead reads the repo's CLAUDE.md itself.
        settingSources: [],
        tools: ["Read", "Glob", "Grep", "Bash"],
        allowedTools: ALLOWED_TOOLS,
        // Anything not pre-approved above is denied rather than prompting
        permissionMode: "dontAsk",
        mcpServers: { [MCP_SERVER]: missionControl },
        // Only Mission Control's own tool: no .mcp.json, user or plugin servers, and none of your
        // claude.ai connectors (their tool definitions alone were ~400k tokens per request)
        strictMcpConfig: true,
        settings: { disableClaudeAiConnectors: true },
        // On the Claude login, hide any API key so the session can't bill it by accident
        env: agentAuth() === "claude_login" ? { ...process.env, ANTHROPIC_API_KEY: undefined } : undefined,
        systemPrompt: { type: "preset", preset: "claude_code", append: leadPrompt(agent, project, team, baseRevision) },
      },
    });

    let finished = false;
    for await (const msg of conversation) {
      finished = (await recordMessage(msg, base)) || finished;
    }
    if (!finished) throw new Error("The session ended without a result.");
  } catch (error) {
    const aborted = abort.signal.aborted;
    const detail = aborted ? "Stopped by you." : error instanceof Error ? error.message : String(error);
    await db
      .update(runs)
      .set({ status: aborted ? "cancelled" : "failed", error: detail, endedAt: new Date() })
      .where(eq(runs.id, runId));
    await logEvent({ ...base, type: aborted ? "run.cancelled" : "run.failed", message: detail });
  } finally {
    active.delete(agent.id);
    await refreshLeadStatus(agent.id);
    void refreshPlanUsage();
  }
}

// One-line description of a tool call for the activity feed
function describeToolCall(name: string, input: Record<string, unknown>) {
  const str = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
  switch (name) {
    case "Read":
      return `Read ${str("file_path")}`;
    case "Glob":
      return `Looked for ${str("pattern")}`;
    case "Grep":
      return `Searched for "${str("pattern")}"${str("path") ? ` in ${str("path")}` : ""}`;
    case "Bash":
      return `Ran ${str("command")}`;
    case `mcp__${MCP_SERVER}__propose_plan`:
      return `Submitted a plan: ${str("title")}`;
    default:
      return `Used ${name}`;
  }
}

// Records one SDK message. Returns true once the run's result has been recorded.
async function recordMessage(msg: SDKMessage, base: { projectId: number; agentId: number; runId: number }) {
  if (msg.type === "system" && msg.subtype === "init") {
    await db.update(runs).set({ sessionId: msg.session_id, model: msg.model }).where(eq(runs.id, base.runId));
    return false;
  }

  if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
    for (const block of msg.message.content) {
      if (block.type === "text" && block.text.trim()) {
        await logEvent({ ...base, type: "message.agent", message: block.text.trim() });
      } else if (block.type === "tool_use") {
        const input = (block.input ?? {}) as Record<string, unknown>;
        await logEvent({ ...base, type: "tool.called", message: describeToolCall(block.name, input), data: { tool: block.name } });
      }
    }
    return false;
  }

  if (msg.type === "rate_limit_event") {
    await recordRateLimit(msg.rate_limit_info).catch(() => undefined);
    return false;
  }

  if (msg.type === "result") {
    const ok = msg.subtype === "success" && !msg.is_error;
    const error = ok ? null : msg.subtype === "success" ? msg.result : msg.errors.join("\n") || msg.subtype;
    await db
      .update(runs)
      .set({
        status: ok ? "succeeded" : "failed",
        sessionId: msg.session_id,
        inputTokens: msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0),
        outputTokens: msg.usage.output_tokens,
        costUsd: msg.total_cost_usd.toFixed(4),
        error,
        endedAt: new Date(),
      })
      .where(eq(runs.id, base.runId));
    const [{ model }] = await db.select({ model: runs.model }).from(runs).where(eq(runs.id, base.runId));
    await logEvent({
      ...base,
      type: ok ? "run.finished" : "run.failed",
      message: ok ? "" : (error ?? "The run failed."),
      data: {
        costUsd: msg.total_cost_usd,
        turns: msg.num_turns,
        tokens: msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0) + msg.usage.output_tokens,
        auth: agentAuth(),
        model,
      },
    });
    return true;
  }

  return false;
}

function leadPrompt(agent: Agent, project: Project, team: Agent[], baseRevision: string | null) {
  const workers = team.filter((member) => member.id !== agent.id);
  return `
# Mission Control

You are ${agent.name}, the ${ROLE_LABELS[agent.role].toLowerCase()} agent for the project "${project.name}". The owner talks to you through Mission Control, a dashboard on their PC; your replies are shown in a chat panel and rendered as Markdown. Keep replies concise and lead with what matters.

${agent.instructions}

## The project
- Repository: ${project.repoUrl ?? "local only"} (checked out at your working directory)
- Default branch: ${project.defaultBranch}
- Checked-out commit: ${baseRevision ?? "unknown"}
${project.devUrl ? `- Dev site (the default branch deploys here): ${project.devUrl}` : ""}

## Your team
${workers.map((w) => `- ${w.name} (${w.role}, runs on ${modelLabel(w.model)}): ${w.description}`).join("\n")}

## How you work
- You are read-only. You can read and search files and run read-only git commands; you cannot edit files, run tests or install anything. Your team does the implementation after the owner approves a plan.
- At the start of a conversation, read the repository's own agent and project docs (CLAUDE.md, AGENTS.md, README) before answering questions about the code, and follow its conventions in your plans.
- Answer questions directly. Not every message needs a plan.
- When the owner asks for a change (a feature, a fix, a refactor), investigate until you know which files are involved and how the change will be verified, then call the propose_plan tool once. Ask a clarifying question first if the request is ambiguous in a way that changes the plan.
- Each subtask runs on its assignee's model at high effort unless you set model or effort on it. Override only with a reason: a lighter model or low effort for mechanical work (renames, boilerplate), a stronger model or higher effort for unusually hard or risky work. The owner sees and approves these choices with the plan; their plan limits are shared, so don't over-provision.
- After propose_plan returns, reply with a two or three sentence summary and stop. The owner approves or rejects the plan in Mission Control; if they reject it, they'll tell you why and you revise.
- Never merge, deploy, run migrations against shared databases, or touch production. Those stay with the owner.
`.trim();
}

const subtaskSchema = z.object({
  title: z.string().describe("Short imperative title"),
  role: z.enum(["developer", "tester", "reviewer"]).describe("Which team member does this"),
  objective: z.string().describe("What to do and why, specific enough to act on without this conversation"),
  allowed_paths: z.array(z.string()).optional().describe("Files or folders this subtask may change"),
  completion_criteria: z.array(z.string()).optional(),
  verification_commands: z.array(z.string()).optional().describe("Commands that prove the subtask is done, e.g. the relevant test filter"),
  depends_on: z.array(z.number().int()).optional().describe("Indexes (0-based) of subtasks in this list that must finish first"),
  model: z
    .enum(LEAD_SELECTABLE_MODELS)
    .optional()
    .describe("Only when this subtask needs a different model than the assignee's default: a lighter one for mechanical work, a stronger one for unusually hard work"),
  effort: z.enum(EFFORT_LEVELS).optional().describe("Only when this subtask needs a different effort than the default (high): low for mechanical work, xhigh/max for unusually hard work"),
});

// The tool the lead submits plans with. It writes the task, its subtasks, the plan document and an
// approval request; nothing runs until the owner approves.
function proposePlanTool({
  agent,
  project,
  runId,
  baseRevision,
  team,
}: {
  agent: Agent;
  project: Project;
  runId: number;
  baseRevision: string | null;
  team: Agent[];
}) {
  return tool(
    "propose_plan",
    "Submit an implementation plan for the owner's approval. Call this once you have investigated a requested change and know the affected files, the approach, the risks and how it will be verified. Nothing is implemented until the owner approves.",
    {
      title: z.string().describe("Short title for the change, e.g. 'Add credit limits to customer accounts'"),
      type: z.enum(["code_change", "investigation"]).describe("code_change for work that changes the repository; investigation for research that only produces findings"),
      objective: z.string().describe("One or two sentences: what the owner asked for and the outcome"),
      plan: z.string().describe("The plan in Markdown: approach, affected files, risks and open questions, and how it will be verified"),
      subtasks: z.array(subtaskSchema).min(1).describe("The work, split into bounded subtasks for the team, in order"),
    },
    async (input) => {
      const byRole = (role: string) => team.find((member) => member.role === role)?.id ?? null;

      const result = await db.transaction(async (tx) => {
        const [task] = await tx
          .insert(tasks)
          .values({
            projectId: project.id,
            type: input.type,
            title: input.title,
            objective: input.objective,
            status: "awaiting_approval",
            assignedAgentId: agent.id,
            baseRevision,
          })
          .returning();

        const subtaskIds: number[] = [];
        for (const sub of input.subtasks) {
          const [row] = await tx
            .insert(tasks)
            .values({
              projectId: project.id,
              parentId: task.id,
              type: input.type,
              title: sub.title,
              objective: sub.objective,
              status: "queued",
              assignedAgentId: byRole(sub.role),
              baseRevision,
              spec: {
                allowedPaths: sub.allowed_paths,
                completionCriteria: sub.completion_criteria,
                verificationCommands: sub.verification_commands,
                model: sub.model,
                effort: sub.effort,
              },
            })
            .returning({ id: tasks.id });
          subtaskIds.push(row.id);
        }

        // Dependencies between subtasks, by their index in the list
        const dependencies = input.subtasks.flatMap((sub, i) =>
          (sub.depends_on ?? []).filter((d) => d >= 0 && d < subtaskIds.length && d !== i).map((d) => ({ taskId: subtaskIds[i], dependsOnId: subtaskIds[d] }))
        );
        if (dependencies.length) await tx.insert(taskDependencies).values(dependencies).onConflictDoNothing();

        await tx.insert(artifacts).values({ projectId: project.id, taskId: task.id, runId, type: "plan", title: input.title, content: input.plan });
        const [approval] = await tx
          .insert(approvals)
          .values({
            projectId: project.id,
            taskId: task.id,
            runId,
            requestedByAgentId: agent.id,
            kind: "plan",
            title: input.title,
            summary: input.objective,
          })
          .returning({ id: approvals.id });
        await tx.insert(events).values({
          projectId: project.id,
          taskId: task.id,
          runId,
          agentId: agent.id,
          type: "approval.requested",
          message: input.title,
          data: { approvalId: approval.id },
        });
        return { taskId: task.id, approvalId: approval.id };
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Plan submitted as task #${result.taskId} and sent to the owner for approval. Summarise it in two or three sentences and stop; don't start implementing.`,
          },
        ],
      };
    }
  );
}

