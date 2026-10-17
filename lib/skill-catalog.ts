// The skills agents can have switched on (safe to import in the browser). How each one is applied:
// lib/agent-skills.ts.

export const SKILLS = [
  {
    id: "rtk",
    label: "RTK",
    description: "Compresses command output (tests, git, listings) before the agent reads it.",
  },
  {
    id: "caveman",
    label: "caveman",
    description: "Short, filler-free replies. Reports and commits stay in plain prose.",
  },
  {
    id: "ponytail",
    label: "ponytail",
    description: "Smallest change that fully works: reuse before writing new code. Reviewers also check for over-engineering.",
  },
] as const;

export type SkillId = (typeof SKILLS)[number]["id"];
export const SKILL_IDS = SKILLS.map((s) => s.id) as SkillId[];
