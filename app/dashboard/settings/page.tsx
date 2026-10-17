import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveProject } from "@/lib/projects";
import { ProjectSettingsForm } from "@/components/project/project-settings-form";

export const metadata: Metadata = { title: "Settings · Mission Control" };

export default async function SettingsPage() {
  const project = await getActiveProject();
  if (!project) redirect("/projects/new");

  return (
    <section className="max-w-2xl rounded-3xl bg-card p-6 shadow-sm ring-1 ring-border/60 sm:p-8">
      <div className="mb-6 space-y-1">
        <h2 className="text-lg font-bold tracking-tight">Project</h2>
        <p className="text-sm text-muted-foreground">The name, and the code your agents work on.</p>
      </div>
      {/* Keyed so the form resets when you switch projects */}
      <ProjectSettingsForm key={project.id} projectId={project.id} name={project.name} repoPath={project.repoPath} devUrl={project.devUrl} setupCommands={project.setupCommands} />
    </section>
  );
}
