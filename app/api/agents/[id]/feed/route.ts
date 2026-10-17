import { getAgentFeed } from "@/lib/feed";

// Polled by the agent chat panel: new events after ?after=<event id>, plus current plans and status.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agentId = Number((await params).id);
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0);
  if (!Number.isInteger(agentId) || agentId <= 0) return Response.json({ error: "Bad agent id" }, { status: 400 });

  const feed = await getAgentFeed(agentId, Number.isInteger(after) && after > 0 ? after : 0);
  if (!feed) return Response.json({ error: "Agent not found" }, { status: 404 });
  return Response.json(feed, { headers: { "Cache-Control": "no-store" } });
}
