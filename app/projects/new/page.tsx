import type { Metadata } from "next";
import { listOfficeScenes } from "@/lib/offices";
import { listProjects } from "@/lib/projects";
import { CreateProjectWizard } from "@/components/project/create-project-wizard";

export const metadata: Metadata = { title: "New project · Mission Control" };

export default async function NewProjectPage() {
  const [offices, existing] = await Promise.all([listOfficeScenes(), listProjects()]);
  return <CreateProjectWizard offices={offices} isFirst={existing.length === 0} />;
}
