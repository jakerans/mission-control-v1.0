import { getTaskBoard } from "@/lib/task-board";

// Polled by the Tasks page
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const projectId = Number((await params).id);
  if (!Number.isInteger(projectId) || projectId <= 0) return Response.json({ error: "Bad project id" }, { status: 400 });
  return Response.json(await getTaskBoard(projectId), { headers: { "Cache-Control": "no-store" } });
}
