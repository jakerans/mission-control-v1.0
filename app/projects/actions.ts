"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, projects } from "@/db";
import { ensureTeam } from "@/lib/agents";
import { listOfficeIds } from "@/lib/offices";
import { getProjectIcon } from "@/lib/project-icons";
import { ICON_TYPES, MAX_ICON_BYTES, saveProjectIcon, setActiveProject } from "@/lib/projects";
import { inspectRepo, normalizeDevUrl, type RepoInfo } from "@/lib/repos";

export type CreateProjectState = { error?: string };

const MAX_NAME = 60;

// The optional code-repository fields shared by the wizard and project settings. An empty folder
// clears the link.
async function readRepoFields(formData: FormData) {
  const repoPath = String(formData.get("repoPath") ?? "").trim();
  const dev = normalizeDevUrl(String(formData.get("devUrl") ?? ""));
  if ("error" in dev) return { error: dev.error };

  if (!repoPath) return { values: { repoPath: null, repoUrl: null, defaultBranch: "main", devUrl: dev.url } };
  const inspected = await inspectRepo(repoPath);
  if ("error" in inspected) return { error: `Code repository: ${inspected.error}` };
  const { repo } = inspected;
  return { values: { repoPath: repo.path, repoUrl: repo.url, defaultBranch: repo.defaultBranch, devUrl: dev.url } };
}

// Live check for the repository folder field, so the form can show what it found before saving.
export async function checkRepo(repoPath: string): Promise<{ repo?: RepoInfo; error?: string }> {
  return inspectRepo(repoPath);
}

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

  const repo = await readRepoFields(formData);
  if ("error" in repo) return { error: repo.error };

  const [created] = await db
    .insert(projects)
    .values({ name, icon, iconFile, officeId, ...repo.values })
    .returning({ id: projects.id });
  await ensureTeam(created.id);

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

export type ProjectSettingsState = { error?: string; saved?: boolean };

export async function updateProjectSettings(projectId: number, _prev: ProjectSettingsState, formData: FormData): Promise<ProjectSettingsState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give your project a name." };
  if (name.length > MAX_NAME) return { error: `Project name must be ${MAX_NAME} characters or fewer.` };

  const repo = await readRepoFields(formData);
  if ("error" in repo) return { error: repo.error };

  // One command per line; blank lines dropped
  const setupCommands = String(formData.get("setupCommands") ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30);

  await db
    .update(projects)
    .set({ name, ...repo.values, setupCommands })
    .where(eq(projects.id, projectId));
  revalidatePath("/dashboard", "layout");
  return { saved: true };
}

export async function switchProject(projectId: number) {
  await setActiveProject(projectId);
  revalidatePath("/dashboard");
}
