import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

// Office scenes exported from AgentWorld Studio live in /office-studio/<office-id>.json. An optional
// looping background video sits next to it as <office-id>.mp4 or .webm. Each bundle is ~12MB of
// base64 images, so it never goes to the browser as-is: the page gets a small layout and the images
// are served as binary from /api/offices/<office>/<asset>.

const SCENES_DIR = path.join(process.cwd(), "office-studio");
const OFFICE_ID = /^[a-z0-9][a-z0-9_-]*$/i;
const VIDEO_TYPES = { ".mp4": "video/mp4", ".webm": "video/webm" } as const;

type SceneBundle = {
  office: { name: string; description?: string; width: number; height: number; background: string };
  seats: {
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    zIndex: number;
    character: {
      id: string;
      name: string;
      width: number;
      height: number;
      sprite: string;
      animations?: Record<string, string[]>;
    };
  }[];
};

// Everything the client needs to draw an office. Coordinates are in the scene's own pixel space
// (width × height); an agent's x/y is the character's top-left corner.
export type OfficeScene = {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  video: string | null;
  agents: OfficeAgent[];
};

export type OfficeAgent = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  frames: string[];
};

type LoadedScene = { version: string; bundle: SceneBundle };

// Parsed bundles stay in memory per server process; the version (mtime) busts both this cache and
// the browser's immutable asset cache whenever a scene file is re-exported.
const loaded = new Map<string, Promise<LoadedScene | null>>();

async function loadScene(officeId: string): Promise<LoadedScene | null> {
  if (!OFFICE_ID.test(officeId)) return null;
  const file = path.join(SCENES_DIR, `${officeId}.json`);

  const info = await stat(file).catch(() => null);
  if (!info) return null;
  const version = Math.floor(info.mtimeMs).toString(36);

  const cacheKey = `${officeId}@${version}`;
  let scene = loaded.get(cacheKey);
  if (!scene) {
    scene = readFile(file, "utf8")
      .then((raw) => ({ version, bundle: JSON.parse(raw) as SceneBundle }))
      .catch(() => null);
    for (const key of loaded.keys()) if (key.startsWith(`${officeId}@`)) loaded.delete(key);
    loaded.set(cacheKey, scene);
  }
  return scene;
}

async function findVideo(officeId: string) {
  for (const [ext, contentType] of Object.entries(VIDEO_TYPES)) {
    const file = path.join(SCENES_DIR, `${officeId}${ext}`);
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) return { file, contentType, size: info.size, version: Math.floor(info.mtimeMs).toString(36) };
  }
  return null;
}

export async function listOfficeIds() {
  const files = await readdir(SCENES_DIR).catch(() => [] as string[]);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .filter((id) => OFFICE_ID.test(id))
    .sort();
}

export async function getOfficeScene(officeId: string): Promise<OfficeScene | null> {
  const scene = await loadScene(officeId);
  if (!scene) return null;
  const { bundle, version } = scene;
  const asset = (name: string) => `/api/offices/${officeId}/${name}?v=${version}`;
  const video = await findVideo(officeId);

  return {
    id: officeId,
    name: bundle.office.name,
    width: bundle.office.width,
    height: bundle.office.height,
    background: asset("background"),
    video: video ? `/api/offices/${officeId}/video?v=${video.version}` : null,
    agents: bundle.seats.map((seat) => {
      const { character } = seat;
      const [animation, frames] = Object.entries(character.animations ?? {}).find(([, f]) => f.length > 0) ?? [];
      return {
        id: seat.id,
        name: character.name,
        x: seat.x,
        y: seat.y,
        width: seat.width,
        height: (seat.width * character.height) / character.width,
        zIndex: seat.zIndex,
        frames: frames?.length
          ? frames.map((_, i) => asset(`seats/${seat.id}/${animation}/${i}`))
          : [asset(`seats/${seat.id}/sprite`)],
      };
    }),
  };
}

export async function listOfficeScenes() {
  const scenes = await Promise.all((await listOfficeIds()).map(getOfficeScene));
  return scenes.filter((s): s is OfficeScene => s !== null);
}

// Resolves an image asset path from getOfficeScene back to its decoded bytes.
export async function getOfficeImage(officeId: string, assetPath: string[]) {
  const scene = await loadScene(officeId);
  if (!scene) return null;
  const { bundle } = scene;

  let dataUri: string | undefined;
  if (assetPath.length === 1 && assetPath[0] === "background") {
    dataUri = bundle.office.background;
  } else if (assetPath[0] === "seats") {
    const character = bundle.seats.find((seat) => seat.id === assetPath[1])?.character;
    if (assetPath.length === 3 && assetPath[2] === "sprite") dataUri = character?.sprite;
    if (assetPath.length === 4) dataUri = character?.animations?.[assetPath[2]]?.[Number(assetPath[3])];
  }

  const match = dataUri?.match(/^data:([\w/+.-]+);base64,(.*)$/s);
  if (!match) return null;
  return { contentType: match[1], body: Buffer.from(match[2], "base64") };
}

// The office's looping background video file, if it has one (streamed via lib/file-range).
export async function findOfficeVideo(officeId: string) {
  if (!OFFICE_ID.test(officeId)) return null;
  const video = await findVideo(officeId);
  return video && { path: video.file, size: video.size, contentType: video.contentType };
}
