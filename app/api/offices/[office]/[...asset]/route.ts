import { serveFileRange } from "@/lib/file-range";
import { findOfficeVideo, getOfficeImage } from "@/lib/offices";

const CACHE_FOREVER = "public, max-age=31536000, immutable";

// Serves an office's background, agent animation frames and optional looping video.
// URLs carry a ?v=<file version>, so responses can be cached forever.
export async function GET(request: Request, { params }: { params: Promise<{ office: string; asset: string[] }> }) {
  const { office, asset } = await params;

  if (asset.length === 1 && asset[0] === "video") {
    const video = await findOfficeVideo(office);
    if (!video) return new Response("Not found", { status: 404 });
    return serveFileRange(video, request.headers.get("range"), CACHE_FOREVER);
  }

  const image = await getOfficeImage(office, asset);
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(image.body), {
    headers: { "Content-Type": image.contentType, "Cache-Control": CACHE_FOREVER },
  });
}
