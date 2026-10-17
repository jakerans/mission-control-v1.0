import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Project, Task } from "@/db";

// Task workspaces: each approved task gets its own branch and git worktree (a separate checkout of
// the repository that shares its history), set up with the project's setup commands. The user's own
// checkout is never touched.

const exec = promisify(execFile);

const ROOT = path.join(os.homedir(), ".mission-control");
const WORKTREES = path.join(ROOT, "worktrees");
const SHIMS = path.join(ROOT, "bin");
const SETUP_TIMEOUT_MS = 30 * 60_000;
const OUTPUT_TAIL = 4000;

export async function git(cwd: string, ...args: string[]) {
  const { stdout } = await exec("git", ["-C", cwd, ...args], { timeout: 120_000, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  return stdout.trim();
}

function slugify(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "task"
  );
}

export function branchName(task: Pick<Task, "id" | "title">) {
  return `mc/${task.id}-${slugify(task.title)}`;
}

// The environment's PATH key ("Path" on Windows) and value with extra folders in front
function withPath(extra: string[]) {
  const key = Object.keys(process.env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  return { [key]: [...extra, process.env[key] ?? ""].join(path.delimiter) };
}

// Laravel Herd ships PHP and Composer as .bat launchers, which agents' bash shell can't run by bare
// name. Put Herd's newest php.exe on the PATH and add a `composer` shim next to it.
let toolchainEnv: Promise<Record<string, string>> | null = null;
export function getToolchainEnv() {
  toolchainEnv ??= (async () => {
    const herd = path.join(os.homedir(), ".config", "herd", "bin");
    const phpDirs = (await readdir(herd).catch(() => [] as string[]))
      .filter((name) => /^php\d+$/.test(name) && existsSync(path.join(herd, name, "php.exe")))
      .sort((a, b) => Number(b.slice(3)) - Number(a.slice(3)));
    const extra: string[] = [];
    if (phpDirs[0]) extra.push(path.join(herd, phpDirs[0]));
    const composerPhar = path.join(herd, "composer.phar");
    if (existsSync(composerPhar)) {
      await mkdir(SHIMS, { recursive: true });
      await writeFile(path.join(SHIMS, "composer"), `#!/bin/sh\nexec php "${composerPhar.replaceAll("\\", "/")}" "$@"\n`);
      extra.unshift(SHIMS);
    }
    // Herd's PHP caps memory at 128 MB, which larger test runs exceed; raise it for agents only via
    // an extra ini folder (the leading separator keeps PHP's default scan folder too)
    const iniDir = path.join(ROOT, "php");
    await mkdir(iniDir, { recursive: true });
    await writeFile(path.join(iniDir, "mission-control.ini"), "memory_limit = 2G\n");
    return { ...withPath(extra), PHP_INI_SCAN_DIR: `${path.delimiter}${iniDir}` };
  })();
  return toolchainEnv;
}

type Log = (line: string, data?: Record<string, unknown>) => Promise<void>;

// Creates the task's branch and worktree from the latest default branch, then runs the setup
// commands (setup commands should be safe to re-run). Returns where it lives, or throws with a
// readable message.
export async function prepareWorkspace(project: Project, task: Task, log: Log) {
  const repo = project.repoPath!;
  const branch = branchName(task);
  // Keep the repository's own folder name: some code and tests derive names from it
  const dir = path.join(WORKTREES, `${project.id}-${task.id}`, path.basename(repo));

  if (!existsSync(dir)) {
    await log(`Fetching the latest ${project.defaultBranch}…`);
    await git(repo, "fetch", "origin", project.defaultBranch).catch(() => log("Couldn't fetch from origin; using the local copy."));
    const base = (await git(repo, "rev-parse", "--verify", `origin/${project.defaultBranch}`).catch(() => null)) ?? (await git(repo, "rev-parse", "HEAD"));
    await mkdir(path.dirname(dir), { recursive: true });
    await git(repo, "worktree", "add", "-B", branch, dir, base);
    await log(`Created branch ${branch} from ${base.slice(0, 7)}`, { branch, base });
    await runSetup(project.setupCommands, dir, log);
    return { dir, branch, base };
  }

  // The worktree exists but setup didn't finish (it failed, or the server restarted): run it again
  const base = (await git(dir, "merge-base", "HEAD", `origin/${project.defaultBranch}`).catch(() => "")) || task.baseRevision || "";
  await log(`Reusing the existing worktree on ${branch}`);
  await runSetup(project.setupCommands, dir, log);
  return { dir, branch, base };
}

async function runSetup(commands: string[], cwd: string, log: Log) {
  const env = { ...process.env, ...(await getToolchainEnv()) };
  for (const command of commands) {
    await log(`Setup: ${command}`);
    const { code, output } = await runShell(command, cwd, env);
    if (code !== 0) {
      await log(`Setup command failed (exit ${code}): ${command}`, { output });
      throw new Error(`Setup failed: ${command}`);
    }
  }
  if (commands.length) await log("Workspace ready");
}

// Runs a command in cmd.exe (the setup commands are written for it), keeping the tail of the output
function runShell(command: string, cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number; output: string }>((resolve) => {
    let output = "";
    const child = spawn(command, { cwd, env, shell: true, windowsHide: true });
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-OUTPUT_TAIL);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill(), SETUP_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, output: `${output}\n${error.message}` });
    });
  });
}

// Commits anything an agent left uncommitted, so the next subtask starts from a clean tree
export async function commitLeftovers(dir: string, message: string) {
  const status = await git(dir, "status", "--porcelain");
  if (!status) return false;
  await git(dir, "add", "-A");
  await git(dir, "-c", "user.name=Mission Control", "-c", "user.email=mission-control@localhost", "commit", "-m", message);
  return true;
}

export async function diffSummary(dir: string, base: string) {
  const [stat, log] = await Promise.all([git(dir, "diff", "--stat", `${base}...HEAD`), git(dir, "log", "--oneline", `${base}..HEAD`)]);
  return { stat, log };
}

// Deletes a task's worktree (its checkout and installed packages) once the task is over. The branch
// stays in the repository, so the work can always be checked out again.
export async function removeWorkspace(repoPath: string, dir: string) {
  // Only ever delete inside Mission Control's worktree folder
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(WORKTREES + path.sep)) throw new Error(`Refusing to delete ${dir}: not a Mission Control workspace`);

  await git(repoPath, "worktree", "remove", "--force", resolved).catch(async () => {
    // Windows can fail on very long paths inside node_modules; delete directly, then tidy git's records
    await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
    await git(repoPath, "worktree", "prune");
  });
  // The per-task parent folder (<project>-<task>) is empty now
  const parent = path.dirname(resolved);
  if (parent !== WORKTREES) await rm(parent, { recursive: true, force: true }).catch(() => undefined);
}
