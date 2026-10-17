// Models agents can run on. Agents without their own model use DEFAULT_MODEL.
export const DEFAULT_MODEL = "claude-opus-5-5";

const MODEL_LABELS: Record<string, string> = {
  "claude-fable-5-1": "Fable 5.1",
  "claude-opus-5-5": "Opus 5.5",
  "claude-sonnet-5-5": "Sonnet 5.5",
  "claude-haiku-5-5": "Haiku 5.5",
};

// Choices offered in the model picker, most capable first
export const MODEL_CHOICES = [
  { id: "claude-fable-5-1", label: "Fable 5.1", hint: "Most capable; uses plan limits fastest" },
  { id: "claude-opus-5-5", label: "Opus 5.5", hint: "Deep reasoning: planning, reviews" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "Everyday coding and tests" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", hint: "Fast and light: simple, repetitive jobs" },
] as const;

// Models the lead may pick per subtask. Fable is left out: it uses plan limits fastest, so only
// you choose it (from an agent's model picker).
export const LEAD_SELECTABLE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

// "claude-opus-5-5" → "Opus 5.5"; unknown ids are shown as-is
export function modelLabel(model: string | null | undefined) {
  const id = model || DEFAULT_MODEL;
  return MODEL_LABELS[id] ?? id;
}
