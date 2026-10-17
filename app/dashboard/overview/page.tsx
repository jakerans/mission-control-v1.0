import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOfficeScene } from "@/lib/offices";
import { getOverview } from "@/lib/overview";
import { getActiveProject } from "@/lib/projects";
import { OverviewBoard } from "@/components/overview/overview-board";

export const metadata: Metadata = { title: "Overview · Mission Control" };

export default async function OverviewPage() {
  const project = await getActiveProject();
  if (!project) redirect("/projects/new");
  const [overview, scene] = await Promise.all([getOverview(project.id), getOfficeScene(project.officeId)]);
  // Each desk's character, for the team avatars
  const avatars = Object.fromEntries((scene?.agents ?? []).map((seat, desk) => [desk, seat.frames[0]]));
  return <OverviewBoard key={project.id} projectId={project.id} initial={overview} avatars={avatars} />;
}
