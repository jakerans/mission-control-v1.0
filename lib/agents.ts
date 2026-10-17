import { asc, eq } from "drizzle-orm";
import { agents, db, type Agent, type AgentRole, type AgentStatus } from "@/db";

type TeamMember = Pick<Agent, "name" | "role" | "description" | "instructions" | "permissions" | "model" | "skills">;

// Every software project starts with this team: a lead who plans and coordinates, and three workers
// for the plan → build → test → review loop. None of them can merge or deploy; those stay with the
// user's approval. Names, instructions and models are editable per project.
// Models: Opus where judgement matters and token use is small (planning, review), Sonnet for the
// token-heavy implementation and testing work.
export const DEFAULT_TEAM: TeamMember[] = [
  {
    name: "Juno",
    model: "claude-opus-5-5",
    role: "lead",
    description: "Lead engineer. Investigates requests, writes the plan, splits it into tasks and assembles the final pull request.",
    instructions: [
      "You are the lead engineer for this project. You own the outcome of every request.",
      "Investigate the repository before proposing anything. Follow the project's own CLAUDE.md and conventions.",
      "Write a plan with the objective, affected files, risks and how it will be verified, then wait for the user's approval.",
      "After approval, split the work into bounded tasks for the developer, tester and reviewer, with allowed paths and completion criteria.",
      "Reconcile their results into one pull request and one summary. Never merge, deploy or run migrations against shared databases.",
    ].join("\n"),
    permissions: ["read_repo", "plan_tasks", "delegate", "request_approval", "open_pr"],
    skills: ["rtk", "ponytail"],
  },
  {
    name: "Milo",
    model: "claude-sonnet-5-5",
    role: "developer",
    description: "Developer. Implements approved tasks on their own branch in an isolated worktree.",
    instructions: [
      "You implement one approved task at a time, in your own worktree and branch. Stay inside the task's allowed paths.",
      "Follow the project's conventions and run its formatter and the relevant tests before reporting back.",
      "Report the changed files, how you verified them, and anything unresolved. Never push to the default branch.",
    ].join("\n"),
    permissions: ["read_repo", "write_worktree", "run_tests", "commit_branch"],
    skills: ["rtk", "caveman", "ponytail"],
  },
  {
    name: "Ivy",
    model: "claude-sonnet-5-5",
    role: "tester",
    description: "Tester. Writes and runs tests against the developer's branch and reports what passes and fails.",
    instructions: [
      "You verify a branch. Run the project's test suite for the affected areas and add missing tests for the change.",
      "Report exactly which commands you ran, what passed, what failed, and any behaviour that still needs a human to check.",
    ].join("\n"),
    permissions: ["read_repo", "write_worktree", "run_tests", "commit_branch"],
    skills: ["rtk", "caveman"],
  },
  {
    name: "Rex",
    model: "claude-opus-5-5",
    role: "reviewer",
    description: "Reviewer. Independently reviews the combined diff for bugs, security and unintended side effects.",
    instructions: [
      "You review a diff you did not write. Look for correctness bugs, security and authorization gaps, data-loss risks and missing tests.",
      "Do not edit code. Report findings ranked by severity, each with the file, the problem and a concrete failure scenario.",
    ].join("\n"),
    permissions: ["read_repo", "run_tests"],
    skills: ["rtk", "ponytail"],
  },
];

export const ROLE_LABELS: Record<AgentRole, string> = {
  lead: "Lead",
  developer: "Developer",
  tester: "Tester",
  reviewer: "Reviewer",
  researcher: "Researcher",
  operator: "Operator",
  assistant: "Assistant",
};

export const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: "Idle",
  working: "Working",
  blocked: "Blocked",
  needs_approval: "Needs you",
  offline: "Offline",
};

export async function listAgents(projectId: number) {
  return db.select().from(agents).where(eq(agents.projectId, projectId)).orderBy(asc(agents.desk), asc(agents.id));
}

// Gives a project the default team if it has no agents yet (new projects, and ones created before
// agents existed). Desks follow team order; the unique desk index makes concurrent calls safe.
export async function ensureTeam(projectId: number) {
  const existing = await listAgents(projectId);
  if (existing.length > 0) return existing;
  await db
    .insert(agents)
    .values(DEFAULT_TEAM.map((member, desk) => ({ ...member, projectId, desk })))
    .onConflictDoNothing();
  return listAgents(projectId);
}
