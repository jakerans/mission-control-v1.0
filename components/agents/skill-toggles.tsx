"use client";

import { useState, useTransition } from "react";
import { Check, Sparkles } from "lucide-react";
import { setAgentSkills } from "@/app/agents/actions";
import { SKILLS } from "@/lib/skill-catalog";
import { cn } from "@/lib/utils";

// Switch an agent's skills on and off. Takes effect from its next run.
export function SkillToggles({ agentId, skills: initial }: { agentId: number; skills: string[] }) {
  const [skills, setSkills] = useState(initial);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) => {
    const next = skills.includes(id) ? skills.filter((s) => s !== id) : [...skills, id];
    const previous = skills;
    setSkills(next);
    startTransition(async () => {
      const result = await setAgentSkills(agentId, next);
      if (result.error) setSkills(previous);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Sparkles className="size-4 text-muted-foreground" aria-label="Skills" />
      {SKILLS.map((skill) => {
        const on = skills.includes(skill.id);
        return (
          <button
            key={skill.id}
            type="button"
            aria-pressed={on}
            disabled={pending}
            title={skill.description}
            onClick={() => toggle(skill.id)}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
              on ? "border-primary/40 bg-primary/10 font-semibold text-primary" : "border-dashed text-muted-foreground hover:bg-muted"
            )}
          >
            {on && <Check className="size-3" strokeWidth={3} />}
            {skill.label}
          </button>
        );
      })}
    </div>
  );
}
