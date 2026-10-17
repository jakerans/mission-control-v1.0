// Starts the background dispatcher that puts the agent team to work, once per server process.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startDispatcher } = await import("@/lib/orchestrator/dispatcher");
    startDispatcher();
  }
}
