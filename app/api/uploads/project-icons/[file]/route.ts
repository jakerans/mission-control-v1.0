import { readProjectIcon } from "@/lib/projects";

// Serves an uploaded project icon. File names are random UUIDs, so they can be cached forever.
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const icon = await readProjectIcon(file);
  if (!icon) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(icon.body), {
    headers: {
      "Content-Type": icon.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
