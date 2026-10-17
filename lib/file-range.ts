import { open } from "node:fs/promises";

// Serves a media file from disk, honouring a single "bytes=" range so browsers can stream and seek
// audio/video. Responses are cacheable when the URL carries a version.
export async function serveFileRange(
  file: { path: string; size: number; contentType: string },
  range: string | null,
  cacheControl: string
) {
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  const partial = !!match && !!(match[1] || match[2]);
  let start = 0;
  let end = file.size - 1;
  if (partial) {
    if (match[1]) {
      start = Number(match[1]);
      if (match[2]) end = Math.min(Number(match[2]), end);
    } else {
      start = Math.max(0, file.size - Number(match[2]));
    }
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } });
  }

  const handle = await open(file.path, "r");
  let body: Buffer;
  try {
    body = Buffer.alloc(end - start + 1);
    await handle.read(body, 0, body.length, start);
  } finally {
    await handle.close();
  }

  return new Response(new Uint8Array(body), {
    status: partial ? 206 : 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(body.length),
      "Accept-Ranges": "bytes",
      ...(partial && { "Content-Range": `bytes ${start}-${end}/${file.size}` }),
      "Cache-Control": cacheControl,
    },
  });
}
