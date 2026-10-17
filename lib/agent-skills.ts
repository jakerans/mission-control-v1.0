import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRole } from "@/db/schema";

// Skills agents can have switched on. Instruction skills (caveman, ponytail) are always-on modes,
// so their text goes straight into the agent's instructions; their upstream plugins' hooks and
// scripts aren't used. RTK is a program: with it on, the agent's shell commands are rewritten to
// RTK's compact equivalents. Sources and licenses: agent-skills/README.md.

const exec = promisify(execFile);

export { SKILLS, SKILL_IDS, type SkillId } from "@/lib/skill-catalog";

const SKILLS_DIR = path.join(process.cwd(), "agent-skills");
export const RTK_PATH = path.join(os.homedir(), ".mission-control", "tools", "rtk", "rtk.exe");

// SKILL.md without its YAML front matter
function skillText(name: string) {
  const file = path.join(SKILLS_DIR, name, "SKILL.md");
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").replace(/^---[\s\S]*?\n---\s*/, "").trim();
}

// The instructions section for an agent's switched-on instruction skills
export function skillInstructions(skills: string[], role: AgentRole) {
  const parts: string[] = [];
  if (skills.includes("ponytail")) {
    const text = skillText(role === "reviewer" ? "ponytail-review" : "ponytail");
    if (text) parts.push(`## Skill: ponytail${role === "reviewer" ? " review" : ""} (always on)\n\n${text}`);
  }
  if (skills.includes("caveman")) {
    const text = skillText("caveman");
    if (text) parts.push(`## Skill: caveman (always on)\nIt applies to your messages. Anything persisted (code, comments, commits, and your report_result report) stays in plain prose, per its own rules.\n\n${text}`);
  }
  return parts.length ? `\n\n# Skills\n\n${parts.join("\n\n")}` : "";
}

// A command is denied if it starts with one of these (matching the agent's "Bash(<cmd> *)" rules).
// Denied commands are never rewritten, so the denial still applies to them.
function isDenied(command: string, deniedPrefixes: string[]) {
  const trimmed = command.trim();
  return deniedPrefixes.some((prefix) => trimmed === prefix || trimmed.startsWith(`${prefix} `));
}

// PreToolUse hook that runs Bash commands through RTK's own rewrite rules
export function rtkHooks(deniedPrefixes: string[]): HookCallbackMatcher[] {
  if (!existsSync(RTK_PATH)) return [];
  return [
    {
      matcher: "Bash",
      hooks: [
        async (input) => {
          if (input.hook_event_name !== "PreToolUse") return {};
          const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
          const command = typeof toolInput.command === "string" ? toolInput.command : "";
          if (!command || command.trimStart().startsWith("rtk ") || isDenied(command, deniedPrefixes)) return {};

          // rtk rewrite prints the equivalent and exits 3 when there is one; anything else: leave as is
          const rewritten = await exec(RTK_PATH, ["rewrite", command], { timeout: 5000, windowsHide: true })
            .then(({ stdout }) => stdout.trim())
            .catch((error: { code?: number; stdout?: string }) => (error.code === 3 ? (error.stdout ?? "").trim() : ""));
          if (!rewritten || rewritten === command) return {};
          return { hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...toolInput, command: rewritten } } };
        },
      ],
    },
  ];
}

// Puts RTK on the PATH (the rewritten commands call it by name). Takes and returns a full env.
export function withRtkOnPath(env: Record<string, string | undefined>) {
  if (!existsSync(RTK_PATH)) return env;
  const key = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  return { ...env, [key]: [path.dirname(RTK_PATH), env[key] ?? ""].join(path.delimiter) };
}
