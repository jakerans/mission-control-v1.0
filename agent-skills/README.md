# Agent skills

Third-party skill instructions given to Mission Control's agents (see `lib/agent-skills.ts`).
Only the instruction files are used; the upstream plugins' hooks and scripts are not.

| Skill | Source | Commit | License |
|---|---|---|---|
| caveman | https://github.com/JuliusBrussee/caveman (skills/caveman/SKILL.md) | d262ab3 | Apache-2.0 |
| ponytail | https://github.com/DietrichGebert/ponytail (skills/ponytail/SKILL.md) | 16352ac | MIT |
| ponytail-review | https://github.com/DietrichGebert/ponytail (skills/ponytail-review/SKILL.md) | 16352ac | MIT |

RTK (https://github.com/rtk-ai/rtk, rtk-oss edition, Apache-2.0) is a program, not an instruction
file: Mission Control runs agents' shell commands through `rtk rewrite` when the RTK skill is on.
It's installed at `~/.mission-control/tools/rtk/rtk.exe`.
