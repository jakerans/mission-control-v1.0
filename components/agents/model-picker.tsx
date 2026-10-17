"use client";

import { useState, useTransition } from "react";
import { Cpu } from "lucide-react";
import { setAgentModel } from "@/app/agents/actions";
import { MODEL_CHOICES } from "@/lib/agent-models";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

// Which model an agent runs on. Takes effect from its next reply.
export function ModelPicker({ agentId, model }: { agentId: number; model: string }) {
  const [value, setValue] = useState(model);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const choice = MODEL_CHOICES.find((c) => c.id === value);

  return (
    <label
      className={cn(
        "relative flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:bg-muted",
        error && "border-destructive text-destructive"
      )}
      title={error ?? choice?.hint ?? value}
    >
      {pending ? <Spinner className="size-3.5" /> : <Cpu className="size-3.5" />}
      <span className="sr-only">Model</span>
      <select
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const previous = value;
          setValue(next);
          setError(undefined);
          startTransition(async () => {
            const result = await setAgentModel(agentId, next);
            if (result.error) {
              setValue(previous);
              setError(result.error);
            }
          });
        }}
        className="cursor-pointer appearance-none bg-transparent pr-0.5 font-medium text-foreground outline-none"
      >
        {!choice && <option value={value}>{value}</option>}
        {MODEL_CHOICES.map((c) => (
          <option key={c.id} value={c.id} className="bg-[Canvas] text-[CanvasText]">
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}
