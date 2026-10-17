import { createSdkMcpServer, query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { agents, db, events, runs, type Agent } from "@/db";
import { agentAuth } from "@/lib/agent-auth";
import type { EFFORT_LEVELS } from "@/lib/agent-models";
import { recordRateLimit, refreshPlanUsage } from "@/lib/plan-usage";

// Runs one Claude Agent SDK session turn for an agent and records everything it does: the run row
// (model, tokens, outcome), and events for its messages and tool calls. Shared by the lead's chat and
// the team's task runs. One run per agent at a time.

export const MCP_SERVER = "mission-control";

type McpTools = NonNullable<Parameters<typeof createSdkMcpServer>[0]["tools"]>;
export type Effort = (typeof EFFORT_LEVELS)[number];

export type SessionSpec = {
  agent: Agent;
  projectId: number;
  taskId?: number | null;
  cwd: string;
  prompt: string;
  resume?: string;
  model: string;
  effort: Effort;
  maxTurns: number;
  // Built-in tools available, those that run without asking, and scoped denials (e.g. "Bash(git push *)")
  tools: string[];
  allowedTools: string[];
  disallowedTools?: string[];
  // Mission Control's own tools for this run (they get the run id to attach what they write)
  mcpTools?: (runId: number) => McpTools;
  systemPromptAppend: string;
  // Extra environment for the session, e.g. PATH additions for the project's toolchain
  env?: Record<string, string>;
};

export type SessionOutcome = { runId: number; ok: boolean; cancelled: boolean; error: string | null };

type ActiveRun = { runId: number; abort: AbortController };
const globalForRuns = globalThis as unknown as { activeAgentRuns?: Map<number, ActiveRun> };
const active = (globalForRuns.activeAgentRuns ??= new Map<number, ActiveRun>());

export function isAgentRunning(agentId: number) {
  return active.has(agentId);
}

export function activeRunCount() {
  return active.size;
}

export function stopAgentRun(agentId: number) {
  active.get(agentId)?.abort.abort();
}

export async function logEvent(values: typeof events.$inferInsert) {
  await db.insert(events).values(values);
}

// Runs the database thinks are running but this process isn't (the server restarted mid-run) are
// marked interrupted. With no agent ids, settles every orphan (used at startup).
export async function settleOrphanedRuns(agentIds?: number[]) {
  const candidates = agentIds?.filter((id) => !active.has(id));
  if (candidates && candidates.length === 0) return [];
  const running = [...active.keys()];
  return db
    .update(runs)
    .set({ status: "failed", error: "Interrupted: Mission Control restarted during this run.", endedAt: new Date() })
    .where(
      and(
        eq(runs.status, "running"),
        candidates ? inArray(runs.agentId, candidates) : undefined,
        running.length ? notInArray(runs.agentId, running) : undefined
      )
    )
    .returning({ id: runs.id, agentId: runs.agentId, taskId: runs.taskId });
}

// Starts a session in the background. Resolves once the run is recorded as started; `done` settles
// when it finishes (it never rejects).
export async function startSession(spec: SessionSpec): Promise<{ error: string } | { runId: number; done: Promise<SessionOutcome> }> {
  const { agent } = spec;
  if (active.has(agent.id)) return { error: `${agent.name} is already working.` };

  const [run] = await db
    .insert(runs)
    .values({ projectId: spec.projectId, taskId: spec.taskId ?? null, agentId: agent.id, engine: "claude", status: "running", worktreePath: spec.cwd })
    .returning({ id: runs.id });
  const abort = new AbortController();
  active.set(agent.id, { runId: run.id, abort });
  await db.update(agents).set({ status: "working" }).where(eq(agents.id, agent.id));

  const done = execute(spec, run.id, abort).finally(() => {
    active.delete(agent.id);
    void refreshPlanUsage();
  });
  return { runId: run.id, done };
}

async function execute(spec: SessionSpec, runId: number, abort: AbortController): Promise<SessionOutcome> {
  const base = { projectId: spec.projectId, agentId: spec.agent.id, runId, taskId: spec.taskId ?? null };
  try {
    const tools = spec.mcpTools?.(runId) ?? [];
    const session = query({
      prompt: spec.prompt,
      options: {
        cwd: spec.cwd,
        model: spec.model,
        effort: spec.effort,
        resume: spec.resume,
        abortController: abort,
        maxTurns: spec.maxTurns,
        // Don't load the repository's or this PC's Claude Code settings (hooks, MCP servers,
        // permissions); agents read the repo's CLAUDE.md themselves.
        settingSources: [],
        tools: spec.tools,
        allowedTools: [...spec.allowedTools, ...tools.map((t) => `mcp__${MCP_SERVER}__${t.name}`)],
        disallowedTools: spec.disallowedTools,
        // Anything not pre-approved is denied rather than prompting
        permissionMode: "dontAsk",
        mcpServers: tools.length ? { [MCP_SERVER]: createSdkMcpServer({ name: MCP_SERVER, version: "1.0.0", tools }) } : {},
        // Only Mission Control's own tools: no .mcp.json, user or plugin servers, and none of your
        // claude.ai connectors (their tool definitions alone were ~400k tokens per request)
        strictMcpConfig: true,
        settings: { disableClaudeAiConnectors: true },
        env: {
          ...process.env,
          ...spec.env,
          // On the Claude login, hide any API key so the session can't bill it by accident
          ...(agentAuth() === "claude_login" ? { ANTHROPIC_API_KEY: undefined } : {}),
        },
        systemPrompt: { type: "preset", preset: "claude_code", append: spec.systemPromptAppend },
      },
    });

    let outcome: SessionOutcome | null = null;
    for await (const msg of session) {
      outcome = (await recordMessage(msg, base)) ?? outcome;
    }
    if (!outcome) throw new Error("The session ended without a result.");
    return outcome;
  } catch (error) {
    const cancelled = abort.signal.aborted;
    const detail = cancelled ? "Stopped by you." : error instanceof Error ? error.message : String(error);
    await db
      .update(runs)
      .set({ status: cancelled ? "cancelled" : "failed", error: detail, endedAt: new Date() })
      .where(eq(runs.id, runId));
    await logEvent({ ...base, type: cancelled ? "run.cancelled" : "run.failed", message: detail });
    return { runId, ok: false, cancelled, error: detail };
  }
}

// One-line description of a tool call for the activity feed
function describeToolCall(name: string, input: Record<string, unknown>) {
  const str = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
  switch (name) {
    case "Read":
      return `Read ${str("file_path")}`;
    case "Write":
      return `Wrote ${str("file_path")}`;
    case "Edit":
      return `Edited ${str("file_path")}`;
    case "Glob":
      return `Looked for ${str("pattern")}`;
    case "Grep":
      return `Searched for "${str("pattern")}"${str("path") ? ` in ${str("path")}` : ""}`;
    case "Bash":
      return `Ran ${str("command")}`;
    case `mcp__${MCP_SERVER}__propose_plan`:
      return `Submitted a plan: ${str("title")}`;
    case `mcp__${MCP_SERVER}__report_result`:
      return "Reported back";
    default:
      return `Used ${name}`;
  }
}

// Records one SDK message. Returns the outcome once the run's result arrives.
async function recordMessage(msg: SDKMessage, base: { projectId: number; agentId: number; runId: number; taskId: number | null }): Promise<SessionOutcome | null> {
  if (msg.type === "system" && msg.subtype === "init") {
    await db.update(runs).set({ sessionId: msg.session_id, model: msg.model }).where(eq(runs.id, base.runId));
    return null;
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
    return null;
  }

  if (msg.type === "rate_limit_event") {
    await recordRateLimit(msg.rate_limit_info).catch(() => undefined);
    return null;
  }

  if (msg.type === "result") {
    const ok = msg.subtype === "success" && !msg.is_error;
    const error = ok ? null : msg.subtype === "success" ? msg.result : msg.errors.join("\n") || msg.subtype;
    const inputTokens = msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
    const [{ model }] = await db
      .update(runs)
      .set({
        status: ok ? "succeeded" : "failed",
        sessionId: msg.session_id,
        inputTokens,
        outputTokens: msg.usage.output_tokens,
        costUsd: msg.total_cost_usd.toFixed(4),
        error,
        endedAt: new Date(),
      })
      .where(eq(runs.id, base.runId))
      .returning({ model: runs.model });
    await logEvent({
      ...base,
      type: ok ? "run.finished" : "run.failed",
      message: ok ? "" : (error ?? "The run failed."),
      data: { costUsd: msg.total_cost_usd, turns: msg.num_turns, tokens: inputTokens + msg.usage.output_tokens, auth: agentAuth(), model },
    });
    return { runId: base.runId, ok, cancelled: false, error };
  }

  return null;
}
