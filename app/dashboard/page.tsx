import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOfficeScene } from "@/lib/offices";
import { getActiveProject } from "@/lib/projects";
import { AgentOffice } from "@/components/office/agent-office";

export const metadata: Metadata = { title: "Office · Mission Control" };

// The dashboard's home: the project's office, filling the space next to the sidebar.
export default async function OfficePage() {
  const project = await getActiveProject();
  if (!project) redirect("/projects/new");
  const scene = await getOfficeScene(project.officeId);

  return (
    <div className="h-[calc(100svh-6rem)] min-h-80 overflow-hidden rounded-3xl bg-card shadow-xl ring-1 ring-border/60">
      {scene ? (
        <AgentOffice scene={scene} fit="cover" className="h-full" />
      ) : (
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
          This project&apos;s office ({project.officeId}) is missing. Pick another office from the top right.
        </div>
      )}
    </div>
  );
}
