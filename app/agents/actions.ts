"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { agents, db } from "@/db";
import { MODEL_CHOICES } from "@/lib/agent-models";
import { decideApproval } from "@/lib/orchestrator/approvals";
import { cancelTask as cancelTaskRun, retrySubtask as retrySubtaskRun, retryWorkspace as retryWorkspaceRun } from "@/lib/orchestrator/dispatcher";
import { newConversation, sendToLead, stopLead } from "@/lib/orchestrator/lead";
import { stopAgentRun } from "@/lib/orchestrator/session";

export async function sendMessage(agentId: number, text: string) {
  return sendToLead(agentId, text);
}

export async function startNewConversation(agentId: number) {
  return newConversation(agentId);
}

export async function stopAgent(agentId: number) {
  stopLead(agentId);
}

// Approve or reject something an agent asked for (a plan, or pushing a finished task's branch)
export async function decide(approvalId: number, decision: "approved" | "rejected", note: string) {
  const result = await decideApproval(approvalId, decision, note);
  revalidatePath("/dashboard", "layout");
  return result;
}

export async function decidePlan(approvalId: number, decision: "approved" | "rejected", note: string) {
  return decide(approvalId, decision, note);
}

export async function setAgentModel(agentId: number, model: string): Promise<{ error?: string }> {
  if (!MODEL_CHOICES.some((choice) => choice.id === model)) return { error: "Unknown model." };
  await db.update(agents).set({ model }).where(eq(agents.id, agentId));
  revalidatePath("/dashboard/agents");
  return {};
}

export async function retrySubtask(subtaskId: number) {
  return retrySubtaskRun(subtaskId);
}

export async function cancelTask(taskId: number) {
  return cancelTaskRun(taskId);
}

export async function stopWorker(agentId: number) {
  stopAgentRun(agentId);
}

export async function retryWorkspace(taskId: number) {
  return retryWorkspaceRun(taskId);
}
