import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SIDEBAR_COOKIE } from "@/lib/dashboard-nav";
import { listOfficeScenes } from "@/lib/offices";
import { getActiveProject, listProjects, projectIconUrl } from "@/lib/projects";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const active = await getActiveProject();
  if (!active) redirect("/projects/new");

  const [projects, offices] = await Promise.all([listProjects(), listOfficeScenes()]);

  // Sidebar starts as an icon rail (more room for the office) unless it was expanded before
  const defaultExpanded = (await cookies()).get(SIDEBAR_COOKIE)?.value === "true";

  return (
    <DashboardShell
      projects={projects.map((p) => ({ id: p.id, name: p.name, icon: p.icon, iconUrl: projectIconUrl(p.iconFile) }))}
      activeProjectId={active.id}
      offices={offices.map((o) => ({ id: o.id, name: o.name, background: o.background, video: o.video }))}
      activeOfficeId={active.officeId}
      defaultExpanded={defaultExpanded}
    >
      {children}
    </DashboardShell>
  );
}
