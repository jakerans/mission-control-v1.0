import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { agents, approvals, artifacts, db, events, projects, runs, tasks, type Agent, type Project } from "@/db";
import { listAgents, ROLE_LABELS } from "@/lib/agents";
import { authReady } from "@/lib/agent-auth";
import { DEFAULT_MODEL, EFFORT_LEVELS, LEAD_SELECTABLE_MODELS, modelLabel } from "@/lib/agent-models";
import { isAgentRunning, logEvent, settleOrphanedRuns, startSession, stopAgentRun } from "@/lib/orchestrator/session";

// The lead agent: a read-only Claude Agent SDK session in the project's repository. You chat with it
// in Mission Control; when a request needs work, it investigates and submits a plan through the
// propose_plan tool, which lands in the approval queue. It can't edit files, merge or deploy.

const exec = promisify(execFile);

const MAX_TURNS = 80;

// Read-only git commands the lead may run without asking
const GIT_READ_COMMANDS = ["log", "show", "diff", "status", "ls-files", "blame", "branch", "rev-parse"];
// With the RTK skill these run as "rtk git <cmd>", so allow that form too
const ALLOWED_TOOLS = ["Read", "Glob", "Grep", ...GIT_READ_COMMANDS.flatMap((cmd) => [`Bash(git ${cmd} *)`, `Bash(rtk git ${cmd} *)`])];

export const isLeadRunning = isAgentRunning;

// Idle, or waiting on you while a plan it requested is undecided.
export async function refreshLeadStatus(agentId: number) {
  const [pending] = await db
    .select({ id: approvals.id })
    .from(approvals)
    .where(and(eq(approvals.requestedByAgentId, agentId), eq(approvals.status, "pending")))
    .limit(1);
  const status = isAgentRunning(agentId) ? "working" : pending ? "needs_approval" : "idle";
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

  if ((await settleOrphanedRuns([agentId])).length) await refreshLeadStatus(agentId);
  if (isAgentRunning(agentId)) return { error: `${agent.name} is still working on your last message.` };

  const [baseRevision, team, resume] = await Promise.all([headRevision(project.repoPath), listAgents(project.id), currentSession(agentId)]);

  await logEvent({ projectId: project.id, agentId, type: "message.user", message });
  const started = await startSession({
    agent,
    projectId: project.id,
    cwd: project.repoPath,
    prompt: message,
    resume,
    model: agent.model ?? DEFAULT_MODEL,
    effort: "high",
    maxTurns: MAX_TURNS,
    tools: ["Read", "Glob", "Grep", "Bash"],
    allowedTools: ALLOWED_TOOLS,
    mcpTools: (runId) => [proposePlanTool({ agent, project, runId, baseRevision, team })],
    systemPromptAppend: leadPrompt(agent, project, team, baseRevision),
  });
  if ("error" in started) return { error: started.error };

  // Deliberately not awaited: the run outlives this request.
  void started.done.then(() => refreshLeadStatus(agentId)).catch((error) => console.error("[lead] status refresh failed", error));
  return {};
}

// The lead's conversation continues its latest session since you last started a new one
async function currentSession(agentId: number) {
  const [reset] = await db
    .select({ at: events.createdAt })
    .from(events)
    .where(and(eq(events.agentId, agentId), eq(events.type, "conversation.new")))
    .orderBy(desc(events.id))
    .limit(1);
  const [previous] = await db
    .select({ sessionId: runs.sessionId })
    .from(runs)
    .where(and(eq(runs.agentId, agentId), isNotNull(runs.sessionId), reset ? gt(runs.startedAt, reset.at) : undefined))
    .orderBy(desc(runs.startedAt))
    .limit(1);
  return previous?.sessionId ?? undefined;
}

// The next message starts a fresh session (the old one stays in the history above it)
export async function newConversation(agentId: number): Promise<{ error?: string }> {
  if (isAgentRunning(agentId)) return { error: "Wait for the current reply to finish, or stop it first." };
  const [agent] = await db.select({ projectId: agents.projectId }).from(agents).where(eq(agents.id, agentId));
  if (!agent) return { error: "Agent not found." };
  await logEvent({ projectId: agent.projectId, agentId, type: "conversation.new" });
  return {};
}

export const stopLead = stopAgentRun;

async function headRevision(repoPath: string) {
  try {
    const { stdout } = await exec("git", ["-C", repoPath, "rev-parse", "HEAD"], { timeout: 10_000, windowsHide: true });
    return stdout.trim();
  } catch {
    return null;
  }
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
- After approval, the subtasks run one at a time in the order you list them, on one new branch in a separate copy of the repository, so later subtasks build on earlier ones. A typical order is developer, then tester, then reviewer. Each agent reads its subtask and your plan, not this conversation, so make objectives self-contained.
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
      subtasks: z.array(subtaskSchema).min(1).describe("The work, split into bounded subtasks for the team, in the order they should run"),
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

        for (const sub of input.subtasks) {
          await tx
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
            });
        }

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

