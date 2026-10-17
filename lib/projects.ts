import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { desc, eq } from "drizzle-orm";
import { db, projects, type Project } from "@/db";

// The project the dashboard shows; falls back to the newest project when unset or stale.
export const ACTIVE_PROJECT_COOKIE = "mc-project";

export async function listProjects() {
  return db.select().from(projects).orderBy(desc(projects.createdAt));
}

export async function getActiveProject(): Promise<Project | null> {
  const id = Number((await cookies()).get(ACTIVE_PROJECT_COOKIE)?.value);
  if (Number.isInteger(id) && id > 0) {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    if (project) return project;
  }
  const [newest] = await db.select().from(projects).orderBy(desc(projects.createdAt)).limit(1);
  return newest ?? null;
}

export async function setActiveProject(id: number) {
  (await cookies()).set(ACTIVE_PROJECT_COOKIE, String(id), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}

// Uploaded project icons live on disk outside /public (files added there after a build aren't
// served), and are read back through /api/uploads/project-icons/<file>.
const ICON_DIR = path.join(process.cwd(), ".uploads", "project-icons");
const ICON_FILE = /^[a-f0-9-]{36}\.(png|jpg|webp|gif)$/;
export const ICON_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
export const MAX_ICON_BYTES = 2 * 1024 * 1024;

export async function saveProjectIcon(file: File) {
  const ext = ICON_TYPES[file.type];
  if (!ext) throw new Error("Unsupported icon type");
  await mkdir(ICON_DIR, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await writeFile(path.join(ICON_DIR, name), Buffer.from(await file.arrayBuffer()));
  return name;
}

export async function readProjectIcon(name: string) {
  if (!ICON_FILE.test(name)) return null;
  const body = await readFile(path.join(ICON_DIR, name)).catch(() => null);
  if (!body) return null;
  const ext = name.split(".").pop()!;
  const contentType = Object.keys(ICON_TYPES).find((type) => ICON_TYPES[type] === ext)!;
  return { body, contentType };
}

export function projectIconUrl(iconFile: string | null) {
  return iconFile ? `/api/uploads/project-icons/${iconFile}` : null;
}
