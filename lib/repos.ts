import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type RepoInfo = {
  // Top-level folder of the checkout (normalised, even if a subfolder was given)
  path: string;
  // Browser URL of the remote, e.g. https://github.com/owner/repo (null if there's no origin)
  url: string | null;
  // owner/repo for display
  slug: string | null;
  defaultBranch: string;
};

async function git(cwd: string, ...args: string[]) {
  const { stdout } = await exec("git", ["-C", cwd, ...args], { timeout: 10_000, windowsHide: true });
  return stdout.trim();
}

// git@github.com:owner/repo.git and https://user@github.com/owner/repo.git → https://github.com/owner/repo
export function remoteToUrl(remote: string) {
  const ssh = remote.match(/^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?\/?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  try {
    const url = new URL(remote.replace(/\.git\/?$/, ""));
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

// Reads a local git checkout: where it is, where it pushes, and its main branch. Returns an error
// message the user can act on instead of throwing.
export async function inspectRepo(input: string): Promise<{ repo: RepoInfo } | { error: string }> {
  const folder = input.trim().replace(/^"(.*)"$/, "$1");
  if (!folder) return { error: "Enter the folder of the project's git checkout." };
  if (!path.isAbsolute(folder)) return { error: "Use the full folder path, e.g. C:\\Users\\you\\Herd\\my-app." };

  const info = await stat(folder).catch(() => null);
  if (!info?.isDirectory()) return { error: "That folder doesn't exist." };

  let top: string;
  try {
    top = path.normalize(await git(folder, "rev-parse", "--show-toplevel"));
  } catch {
    return { error: "That folder isn't a git repository." };
  }

  const remote = await git(top, "remote", "get-url", "origin").catch(() => "");
  const url = remote ? remoteToUrl(remote) : null;

  // origin/HEAD names the remote's default branch; fall back to whatever is checked out
  const originHead = await git(top, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").catch(() => "");
  const defaultBranch = originHead.replace(/^origin\//, "") || (await git(top, "branch", "--show-current").catch(() => "")) || "main";

  const slug = url ? new URL(url).pathname.replace(/^\//, "") : null;
  return { repo: { path: top, url, slug, defaultBranch } };
}

// Dev site links must be plain http(s) URLs
export function normalizeDevUrl(input: string): { url: string | null } | { error: string } {
  const value = input.trim();
  if (!value) return { url: null };
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    return { url: url.toString().replace(/\/$/, "") };
  } catch {
    return { error: "The dev site must be a web address, e.g. https://dev.example.com." };
  }
}
