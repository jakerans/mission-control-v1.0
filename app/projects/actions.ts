"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, projects } from "@/db";
import { listOfficeIds } from "@/lib/offices";
import { getProjectIcon } from "@/lib/project-icons";
import { ICON_TYPES, MAX_ICON_BYTES, saveProjectIcon, setActiveProject } from "@/lib/projects";

export type CreateProjectState = { error?: string };

const MAX_NAME = 60;

export async function createProject(_prev: CreateProjectState, formData: FormData): Promise<CreateProjectState> {
  const name = String(formData.get("name") ?? "").trim();
  const iconId = String(formData.get("icon") ?? "");
  const iconUpload = formData.get("iconFile");
  const officeId = String(formData.get("office") ?? "");

  if (!name) return { error: "Give your project a name." };
  if (name.length > MAX_NAME) return { error: `Project name must be ${MAX_NAME} characters or fewer.` };
  if (!(await listOfficeIds()).includes(officeId)) return { error: "Choose an office for your agents." };

  let icon: string | null = null;
  let iconFile: string | null = null;
  if (iconUpload instanceof File && iconUpload.size > 0) {
    if (!ICON_TYPES[iconUpload.type]) return { error: "Icon must be a PNG, JPG, WEBP or GIF image." };
    if (iconUpload.size > MAX_ICON_BYTES) return { error: "Icon must be 2MB or smaller." };
    iconFile = await saveProjectIcon(iconUpload);
  } else if (getProjectIcon(iconId)) {
    icon = iconId;
  } else {
    return { error: "Pick an icon or upload your own." };
  }

  const [created] = await db.insert(projects).values({ name, icon, iconFile, officeId }).returning({ id: projects.id });

  // Jump straight into the new project
  await setActiveProject(created.id);
  redirect("/dashboard");
}

// Moves a project into a different office, keeping everything else about it.
export async function changeOffice(projectId: number, officeId: string) {
  if (!(await listOfficeIds()).includes(officeId)) return { error: "That office doesn't exist." };
  await db.update(projects).set({ officeId }).where(eq(projects.id, projectId));
  revalidatePath("/dashboard");
  return {};
}

export async function switchProject(projectId: number) {
  await setActiveProject(projectId);
  revalidatePath("/dashboard");
}
