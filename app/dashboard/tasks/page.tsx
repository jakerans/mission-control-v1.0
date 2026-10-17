import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { listAgents } from "@/lib/agents";
import { getActiveProject } from "@/lib/projects";
import { getTaskBoard } from "@/lib/task-board";
import { TaskBoard } from "@/components/tasks/task-board";

export const metadata: Metadata = { title: "Tasks · Mission Control" };

export default async function TasksPage() {
  const project = await getActiveProject();
  if (!project) redirect("/projects/new");
  const [board, team] = await Promise.all([getTaskBoard(project.id), listAgents(project.id)]);
  const lead = team.find((agent) => agent.role === "lead");
  return <TaskBoard key={project.id} projectId={project.id} leadId={lead?.id ?? null} initial={board} />;
}
