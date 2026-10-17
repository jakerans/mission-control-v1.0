import { bigserial, index, integer, jsonb, numeric, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// The data model is deliberately generic (workspace → agents → tasks → runs → events/artifacts/approvals)
// so company operations and an executive assistant can reuse it later. Only the software-project types
// are in use today; the other enum values are reserved for those modules.

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

export const PROJECT_KINDS = ["software_project", "company"] as const;

// A project is a workspace for one agent team: its name, icon, the office its agents work in and,
// for software projects, the code repository they work on.
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: PROJECT_KINDS }).notNull().default("software_project"),
  // Preset icon id (see lib/project-icons.ts); used when iconFile is null
  icon: text("icon"),
  // Uploaded icon, stored under .uploads/project-icons/<iconFile>
  iconFile: text("icon_file"),
  // Office scene id: office-studio/<officeId>.json
  officeId: text("office_id").notNull(),
  // Local git checkout agents branch from (each run gets its own worktree of it)
  repoPath: text("repo_path"),
  // Remote, e.g. https://github.com/owner/repo — where pull requests go
  repoUrl: text("repo_url"),
  defaultBranch: text("default_branch").notNull().default("main"),
  // Where merged work can be checked (e.g. the site main auto-deploys to)
  devUrl: text("dev_url"),
  // Commands that make a fresh worktree ready to build and test (run in order, in cmd.exe)
  setupCommands: jsonb("setup_commands").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

export const AGENT_ROLES = ["lead", "developer", "tester", "reviewer", "researcher", "operator", "assistant"] as const;
export const AGENT_ENGINES = ["claude", "codex"] as const;
export const AGENT_STATUSES = ["idle", "working", "blocked", "needs_approval", "offline"] as const;

// One member of a project's agent team. `desk` is the office seat it sits at (by seat order), so the
// team keeps its places when the project moves to another office.
export const agents = pgTable(
  "agents",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role", { enum: AGENT_ROLES }).notNull(),
    description: text("description").notNull().default(""),
    // Role instructions given to the engine on every run
    instructions: text("instructions").notNull().default(""),
    engine: text("engine", { enum: AGENT_ENGINES }).notNull().default("claude"),
    // Engine model id; null uses the engine's default
    model: text("model"),
    // Capabilities the orchestrator grants this agent, e.g. "read_repo", "write_worktree", "open_pr"
    permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
    desk: integer("desk"),
    // Kept current by the orchestrator from the agent's runs; the office renders it
    status: text("status", { enum: AGENT_STATUSES }).notNull().default("idle"),
    createdAt: createdAt(),
  },
  // One agent per desk; agents without a desk (more agents than seats) are allowed
  (t) => [uniqueIndex("agents_project_desk_idx").on(t.projectId, t.desk)]
);

export const TASK_TYPES = ["code_change", "investigation", "report", "business_operation"] as const;
export const TASK_STATUSES = ["queued", "planning", "awaiting_approval", "working", "blocked", "review", "done", "failed", "cancelled"] as const;

// Typed details of a task, so a worker knows exactly what it may touch and when it's finished.
export type TaskSpec = {
  allowedPaths?: string[];
  deliverable?: string;
  completionCriteria?: string[];
  verificationCommands?: string[];
  // Set by the lead when a subtask needs a different model or effort than the assignee's default
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
};

export const tasks = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Subtasks a lead splits a request into point at it
    parentId: integer("parent_id"),
    type: text("type", { enum: TASK_TYPES }).notNull(),
    title: text("title").notNull(),
    objective: text("objective").notNull(),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("queued"),
    assignedAgentId: integer("assigned_agent_id").references(() => agents.id, { onDelete: "set null" }),
    spec: jsonb("spec").$type<TaskSpec>().notNull().default({}),
    // Commit the work starts from, the branch it lands on, and the worktree it's done in
    baseRevision: text("base_revision"),
    branch: text("branch"),
    worktreePath: text("worktree_path"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_project_status_idx").on(t.projectId, t.status), index("tasks_parent_idx").on(t.parentId)]
);

// taskId can't start until dependsOnId is done
export const taskDependencies = pgTable(
  "task_dependencies",
  {
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnId: integer("depends_on_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnId] })]
);

export const RUN_STATUSES = ["running", "succeeded", "failed", "cancelled"] as const;

// One agent session turn: a reply in a conversation, or an attempt at a task.
export const runs = pgTable(
  "runs",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Null for conversation turns that aren't (yet) work on a task
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    agentId: integer("agent_id").references(() => agents.id, { onDelete: "set null" }),
    engine: text("engine", { enum: AGENT_ENGINES }).notNull(),
    status: text("status", { enum: RUN_STATUSES }).notNull().default("running"),
    // Engine's own session id, for follow-up messages and resuming
    sessionId: text("session_id"),
    // Model the session actually ran on, as reported by the engine
    model: text("model"),
    worktreePath: text("worktree_path"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("runs_task_idx").on(t.taskId), index("runs_agent_idx").on(t.agentId, t.startedAt)]
);

// Append-only activity log: everything agents and the orchestrator do, for the timeline and audit trail.
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    runId: integer("run_id").references(() => runs.id, { onDelete: "cascade" }),
    agentId: integer("agent_id").references(() => agents.id, { onDelete: "set null" }),
    // e.g. "task.created", "run.started", "tool.called", "message", "approval.requested"
    type: text("type").notNull(),
    message: text("message").notNull().default(""),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("events_project_created_idx").on(t.projectId, t.createdAt), index("events_run_idx").on(t.runId)]
);

export const ARTIFACT_TYPES = ["plan", "pull_request", "diff", "test_report", "review", "document", "screenshot", "kpi_snapshot"] as const;

// Durable output of a task — the evidence, not the chat.
export const artifacts = pgTable(
  "artifacts",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    runId: integer("run_id").references(() => runs.id, { onDelete: "set null" }),
    type: text("type", { enum: ARTIFACT_TYPES }).notNull(),
    title: text("title").notNull(),
    content: text("content"),
    url: text("url"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("artifacts_task_idx").on(t.taskId)]
);

export const APPROVAL_KINDS = ["plan", "pull_request", "migration", "merge", "deploy", "message", "data_change", "other"] as const;
export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;

// A consequential step waiting on the user. Work that needs it stays blocked until it's decided.
export const approvals = pgTable(
  "approvals",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    runId: integer("run_id").references(() => runs.id, { onDelete: "set null" }),
    requestedByAgentId: integer("requested_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    kind: text("kind", { enum: APPROVAL_KINDS }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    status: text("status", { enum: APPROVAL_STATUSES }).notNull().default("pending"),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("approvals_status_idx").on(t.status, t.createdAt)]
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type AgentRole = (typeof AGENT_ROLES)[number];
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export type Task = typeof tasks.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type Approval = typeof approvals.$inferSelect;

// Plan usage windows for the agents' Claude login, as last reported by Claude Code
// (percent used and reset time per window, e.g. five_hour, seven_day).
export type UsageWindow = { utilization: number | null; resetsAt: string | null; status?: string };

export const planUsage = pgTable("plan_usage", {
  // One row per sign-in, e.g. "claude"
  id: text("id").primaryKey(),
  subscriptionType: text("subscription_type"),
  windows: jsonb("windows").$type<Record<string, UsageWindow>>().notNull().default({}),
  updatedAt: updatedAt(),
});

export type PlanUsage = typeof planUsage.$inferSelect;
