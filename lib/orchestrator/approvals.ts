import { and, eq } from "drizzle-orm";
import { approvals, artifacts, db, projects, tasks } from "@/db";
import { refreshLeadStatus, sendToLead } from "@/lib/orchestrator/lead";
import { logEvent } from "@/lib/orchestrator/session";
import { git } from "@/lib/orchestrator/workspace";

const MAX_NOTE = 2000;

// Your decisions on what agents ask for:
// - plan: approving queues the task for the team; rejecting cancels it and, if you said why,
//   passes your note to the lead so it can revise.
// - pull_request: approving pushes the task's branch to GitHub and links the pull request page;
//   rejecting cancels the task (the branch and worktree stay on this PC).
export async function decideApproval(approvalId: number, decision: "approved" | "rejected", note: string): Promise<{ error?: string; url?: string }> {
  const decisionNote = note.trim().slice(0, MAX_NOTE) || null;
  const [approval] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
  if (!approval || approval.status !== "pending") return { error: "This was already decided." };

  let url: string | undefined;
  if (approval.kind === "pull_request" && decision === "approved") {
    const pushed = await pushTaskBranch(approval.taskId);
    if ("error" in pushed) return { error: pushed.error };
    url = pushed.url;
  }

  // Claim the decision (guards against a double click deciding twice)
  const [claimed] = await db
    .update(approvals)
    .set({ status: decision, decisionNote, decidedAt: new Date() })
    .where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending")))
    .returning();
  if (!claimed) return { error: "This was already decided." };

  if (approval.taskId) {
    const status = approval.kind === "plan" ? (decision === "approved" ? "queued" : "cancelled") : decision === "approved" ? "done" : "cancelled";
    await db.update(tasks).set({ status }).where(eq(tasks.id, approval.taskId));
    if (status === "cancelled") await db.update(tasks).set({ status: "cancelled" }).where(and(eq(tasks.parentId, approval.taskId), eq(tasks.status, "queued")));
  }

  await logEvent({
    projectId: approval.projectId,
    taskId: approval.taskId,
    agentId: approval.requestedByAgentId,
    type: decision === "approved" ? "approval.approved" : "approval.rejected",
    message: decisionNote ?? "",
    data: { approvalId, kind: approval.kind, url },
  });

  if (approval.requestedByAgentId) {
    await refreshLeadStatus(approval.requestedByAgentId);
    if (approval.kind === "plan" && decision === "rejected" && decisionNote) {
      const sent = await sendToLead(approval.requestedByAgentId, `I rejected the plan "${approval.title}". ${decisionNote}\n\nPlease revise it.`);
      if (sent.error) return { error: `Rejected, but the note couldn't be sent: ${sent.error}` };
    }
  }
  return { url };
}

async function pushTaskBranch(taskId: number | null): Promise<{ error: string } | { url: string }> {
  if (!taskId) return { error: "No task to push." };
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task?.worktreePath || !task.branch) return { error: "This task has no branch to push." };
  const [project] = await db.select().from(projects).where(eq(projects.id, task.projectId));

  try {
    await git(task.worktreePath, "push", "-u", "origin", task.branch);
  } catch (error) {
    return { error: `Push failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  // GitHub's "open a pull request" page for the branch; you create the PR there
  const url = project?.repoUrl ? `${project.repoUrl}/compare/${project.defaultBranch}...${task.branch}?expand=1` : "";
  await db.insert(artifacts).values({ projectId: task.projectId, taskId, type: "pull_request", title: `Pull request for ${task.branch}`, url });
  return { url };
}
