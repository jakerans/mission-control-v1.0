"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { agents, approvals, db, events, tasks } from "@/db";
import { MODEL_CHOICES } from "@/lib/agent-models";
import { newConversation, refreshLeadStatus, sendToLead, stopLead } from "@/lib/orchestrator/lead";

export async function sendMessage(agentId: number, text: string) {
  return sendToLead(agentId, text);
}

export async function startNewConversation(agentId: number) {
  return newConversation(agentId);
}

export async function stopAgent(agentId: number) {
  await stopLead(agentId);
}

const MAX_NOTE = 2000;

// Approve or reject a plan the lead submitted. Approving queues the task for the team; rejecting
// cancels it and, if you said why, passes your note to the lead so it can revise.
export async function decidePlan(approvalId: number, decision: "approved" | "rejected", note: string): Promise<{ error?: string }> {
  const decisionNote = note.trim().slice(0, MAX_NOTE) || null;

  const [approval] = await db
    .update(approvals)
    .set({ status: decision, decisionNote, decidedAt: new Date() })
    .where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending")))
    .returning();
  if (!approval) return { error: "This plan was already decided." };

  if (approval.taskId) {
    const status = decision === "approved" ? "queued" : "cancelled";
    await db.update(tasks).set({ status }).where(eq(tasks.id, approval.taskId));
    if (decision === "rejected") await db.update(tasks).set({ status: "cancelled" }).where(eq(tasks.parentId, approval.taskId));
  }

  await db.insert(events).values({
    projectId: approval.projectId,
    taskId: approval.taskId,
    agentId: approval.requestedByAgentId,
    type: decision === "approved" ? "approval.approved" : "approval.rejected",
    message: decisionNote ?? "",
    data: { approvalId },
  });

  if (approval.requestedByAgentId) {
    await refreshLeadStatus(approval.requestedByAgentId);
    if (decision === "rejected" && decisionNote) {
      return sendToLead(approval.requestedByAgentId, `I rejected the plan "${approval.title}". ${decisionNote}\n\nPlease revise it.`);
    }
  }
  return {};
}

export async function setAgentModel(agentId: number, model: string): Promise<{ error?: string }> {
  if (!MODEL_CHOICES.some((choice) => choice.id === model)) return { error: "Unknown model." };
  await db.update(agents).set({ model }).where(eq(agents.id, agentId));
  revalidatePath("/dashboard/agents");
  return {};
}
