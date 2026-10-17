import { getPlanUsage } from "@/lib/plan-usage";

// Polled by the sidebar meter. Null when agents aren't on the Claude plan.
export async function GET() {
  const usage = await getPlanUsage();
  return Response.json(
    usage && { subscriptionType: usage.subscriptionType, windows: usage.windows, updatedAt: usage.updatedAt.toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
