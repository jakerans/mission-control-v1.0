import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { artifacts, db, type Agent, type Project, type Task } from "@/db";
import { ROLE_LABELS } from "@/lib/agents";

// How the team (developer, tester, reviewer) work on a subtask: their tools and limits, the brief
// they get, and the report_result tool they finish with.

// Never allowed, in any mode: anything that leaves this PC or rewrites shared history, Forge
// (production deploys), and git operations that would move work off the task's branch.
export const WORKER_DENIED = [
  "git push",
  "git remote",
  "git merge",
  "git rebase",
  "git switch",
  "git worktree",
  "git config",
  "git reset --hard origin",
  "git branch -D",
  "git branch -d",
  "forge",
  "forge.bat",
  "ssh",
  "scp",
].flatMap((cmd) => [`Bash(${cmd})`, `Bash(${cmd} *)`]);

export function workerTools(role: Agent["role"]) {
  // The reviewer reads and runs checks but doesn't edit
  const editing = role !== "reviewer";
  const tools = ["Read", "Glob", "Grep", "Bash", ...(editing ? ["Write", "Edit"] : [])];
  return { tools, allowedTools: tools };
}

export type WorkerReport = {
  outcome: "done" | "blocked";
  summary: string;
};

const ARTIFACT_TYPE = { developer: "document", tester: "test_report", reviewer: "review" } as const;

// The tool a worker calls once at the end. Stores the report as an artifact on the subtask and
// hands the outcome back to the dispatcher.
export function reportResultTool(opts: { agent: Agent; project: Project; subtask: Task; runId: number; onReport: (report: WorkerReport) => void }) {
  const { agent, project, subtask, runId, onReport } = opts;
  return tool(
    "report_result",
    "Report the result of your subtask to Mission Control. Call this exactly once, as your last action.",
    {
      outcome: z.enum(["done", "blocked"]).describe("done if the subtask's completion criteria are met; blocked if you couldn't finish and the owner or lead must decide something"),
      summary: z.string().describe("What you did or found, in a few sentences"),
      changes: z.array(z.string()).optional().describe("Files you changed, with a few words each"),
      verification: z
        .array(z.object({ command: z.string(), passed: z.boolean(), notes: z.string().optional() }))
        .optional()
        .describe("Each check you ran and whether it passed"),
      findings: z
        .array(z.object({ severity: z.enum(["critical", "major", "minor"]), file: z.string().optional(), problem: z.string() }))
        .optional()
        .describe("Reviewer: problems found, most severe first"),
      open_issues: z.array(z.string()).optional().describe("Anything unresolved the owner should know"),
    },
    async (input) => {
      const lines = [input.summary];
      if (input.changes?.length) lines.push("", "**Changes**", ...input.changes.map((c) => `- ${c}`));
      if (input.verification?.length)
        lines.push("", "**Checks**", ...input.verification.map((v) => `- ${v.passed ? "✅" : "❌"} \`${v.command}\`${v.notes ? `: ${v.notes}` : ""}`));
      if (input.findings?.length) lines.push("", "**Findings**", ...input.findings.map((f) => `- **${f.severity}**${f.file ? ` \`${f.file}\`` : ""}: ${f.problem}`));
      if (input.open_issues?.length) lines.push("", "**Open issues**", ...input.open_issues.map((i) => `- ${i}`));

      const type = ARTIFACT_TYPE[agent.role as keyof typeof ARTIFACT_TYPE] ?? "document";
      await db.insert(artifacts).values({
        projectId: project.id,
        taskId: subtask.id,
        runId,
        type,
        title: `${agent.name}'s report: ${subtask.title}`,
        content: lines.join("\n"),
        data: { ...input },
      });
      onReport({ outcome: input.outcome, summary: input.summary });
      return { content: [{ type: "text" as const, text: "Report received. You're done; end your turn now." }] };
    }
  );
}

type Brief = {
  agent: Agent;
  project: Project;
  parent: Task;
  subtask: Task;
  plan: string;
  branch: string;
  base: string;
  previousReports: { agentName: string; title: string; content: string }[];
};

export function workerPrompt({ agent, project, parent, subtask, plan, branch, base, previousReports }: Brief) {
  const spec = subtask.spec;
  const list = (items?: string[]) => (items?.length ? items.map((i) => `- ${i}`).join("\n") : "- (none given)");
  const editing = agent.role !== "reviewer";

  return `
# Mission Control

You are ${agent.name}, the ${ROLE_LABELS[agent.role].toLowerCase()} on the "${project.name}" team. You're working on one subtask of a plan the owner approved. Nobody is watching live, so work autonomously; your activity is logged in Mission Control.

${agent.instructions}

## Where you are
- Your working directory is a separate git worktree on the branch \`${branch}\`, started from \`${base.slice(0, 12)}\` of ${project.defaultBranch}. Earlier subtasks' commits are already on this branch.
- The owner's own checkout and other worktrees are off limits; stay inside your working directory.
- PHP, Composer and npm are on your PATH. The project's setup commands have already run (dependencies installed, frontend built).
- Read the repository's CLAUDE.md first and follow its conventions, formatting and testing rules.

## The approved plan: ${parent.title}
${parent.objective}

${plan}

## Your subtask: ${subtask.title}
${subtask.objective}

Allowed paths:
${list(spec.allowedPaths)}

Done when:
${list(spec.completionCriteria)}

Verify with:
${list(spec.verificationCommands)}

${previousReports.length ? `## Earlier reports on this task\n${previousReports.map((r) => `### ${r.agentName}: ${r.title}\n${r.content}`).join("\n\n")}` : ""}

## Rules
${
  editing
    ? `- Change only what the subtask needs. Run the project's formatter and the relevant tests before finishing.
- Commit your work to this branch with clear messages (git add, git commit). Never push, merge, rebase or switch branches.`
    : `- Don't edit files. Review the branch's changes with \`git diff ${base.slice(0, 12)}...HEAD\` and run the relevant tests if useful.
- Report real problems with a concrete failure scenario, ranked by severity. Don't pad with style nits.`
}
- Never touch production: no deploys, no Forge, no remote databases, no real credentials. Use only the local environment.
- If you can't finish (missing information, a failing test you can't fix, a decision the owner must make), stop and report blocked with what you found.
- Finish by calling report_result exactly once.
`.trim();
}
