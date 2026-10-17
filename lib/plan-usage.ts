import { query, type SDKRateLimitInfo, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { eq } from "drizzle-orm";
import { db, planUsage, type UsageWindow } from "@/db";
import { agentAuth } from "@/lib/agent-auth";

// Claude plan usage for the agents' Claude login: how much of each limit window (5-hour, weekly…)
// is used and when it resets. Two sources keep it current:
// - a usage snapshot read from Claude Code (the data behind /usage; marked experimental in the SDK,
//   so failures are ignored), refreshed when it's a few minutes old and after every agent run;
// - rate-limit events the SDK emits during runs, merged in as they arrive.

const ROW_ID = "claude";
const STALE_MS = 5 * 60_000;
const SNAPSHOT_TIMEOUT_MS = 45_000;

const globalForUsage = globalThis as unknown as { planUsageRefresh?: Promise<void> | null };

export async function getPlanUsage() {
  if (agentAuth() !== "claude_login") return null;
  const [row] = await db.select().from(planUsage).where(eq(planUsage.id, ROW_ID));
  if (!row || Date.now() - row.updatedAt.getTime() > STALE_MS) void refreshPlanUsage();
  return row ?? null;
}

async function saveWindows(windows: Record<string, UsageWindow>, subscriptionType?: string | null) {
  const [existing] = await db.select().from(planUsage).where(eq(planUsage.id, ROW_ID));
  // Merge field by field: a rate-limit event without a percentage mustn't wipe the last known one
  const merged = { ...(existing?.windows ?? {}) };
  for (const [name, window] of Object.entries(windows)) {
    const previous = merged[name];
    merged[name] = {
      utilization: window.utilization ?? previous?.utilization ?? null,
      resetsAt: window.resetsAt ?? previous?.resetsAt ?? null,
      status: window.status ?? previous?.status,
    };
  }
  const values = { windows: merged, subscriptionType: subscriptionType ?? existing?.subscriptionType ?? null, updatedAt: new Date() };
  await db
    .insert(planUsage)
    .values({ id: ROW_ID, ...values })
    .onConflictDoUpdate({ target: planUsage.id, set: values });
}

// Rate-limit events report one window at a time. Utilization may come as a fraction; store percent.
export async function recordRateLimit(info: SDKRateLimitInfo) {
  if (!info.rateLimitType) return;
  const utilization = info.utilization === undefined ? null : info.utilization <= 1 ? info.utilization * 100 : info.utilization;
  const resetsAt = info.resetsAt ? new Date(info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt).toISOString() : null;
  await saveWindows({ [info.rateLimitType]: { utilization, resetsAt, status: info.status } });
}

// Opens a short Claude Code session that never sends a prompt (so it uses no plan quota), asks it
// for the usage snapshot, and closes it. One refresh at a time.
export function refreshPlanUsage() {
  if (agentAuth() !== "claude_login") return Promise.resolve();
  globalForUsage.planUsageRefresh ??= readSnapshot()
    .catch((error) => console.warn("[plan-usage] snapshot failed:", error instanceof Error ? error.message : error))
    .finally(() => {
      globalForUsage.planUsageRefresh = null;
    });
  return globalForUsage.planUsageRefresh;
}

async function readSnapshot() {
  let close!: () => void;
  const closed = new Promise<void>((resolve) => (close = resolve));
  // A prompt stream that stays open without ever sending a message
  async function* noPrompt(): AsyncGenerator<SDKUserMessage> {
    await closed;
  }

  const session = query({
    prompt: noPrompt(),
    options: {
      settingSources: [],
      strictMcpConfig: true,
      settings: { disableClaudeAiConnectors: true },
      tools: [],
      env: { ...process.env, ANTHROPIC_API_KEY: undefined },
    },
  });
  const timer = setTimeout(close, SNAPSHOT_TIMEOUT_MS);
  try {
    const usage = await Promise.race([
      session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
      closed.then(() => {
        throw new Error("timed out");
      }),
    ]);
    if (!usage.rate_limits_available || !usage.rate_limits) return;

    const windows: Record<string, UsageWindow> = {};
    for (const [name, window] of Object.entries(usage.rate_limits)) {
      // Limit windows have a reset time; skip other rows such as extra-usage credits
      if (window && typeof window === "object" && "resets_at" in window) {
        windows[name] = { utilization: window.utilization, resetsAt: window.resets_at };
      }
    }
    await saveWindows(windows, usage.subscription_type);
  } finally {
    clearTimeout(timer);
    close();
    session.close();
  }
}
