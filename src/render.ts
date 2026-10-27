import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type VideoFormat = "vertical" | "square" | "landscape";

export interface RenderRequest {
  title: string;
  subtitle?: string;
  durationSeconds: number;
  format: VideoFormat;
  backgroundImageDataUrl?: string;
}

export interface RenderScene {
  title: string;
  subtitle?: string;
  durationSeconds: number;
  backgroundImageDataUrl?: string;
}

export interface SceneRenderRequest {
  scenes: RenderScene[];
  format: VideoFormat;
}

export interface RenderResult {
  id: string;
  filePath: string;
  width: number;
  height: number;
  durationSeconds: number;
}

const DIMENSIONS: Record<VideoFormat, { width: number; height: number }> = {
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 }
};

function runFfmpeg(args: string[], ffmpegPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    child.on("error", (error) => reject(new Error(`Could not start FFmpeg: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
    });
  });
}

function decodeBackgroundImage(dataUrl: string): { bytes: Buffer; extension: string } {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("Background image must be a base64 PNG, JPEG, or WebP data URL.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) {
    throw new Error("Background image must be between 1 byte and 5 MB.");
  }
  const extension = match[1] === "jpeg" ? "jpg" : match[1];
  return { bytes, extension };
}

export async function renderTextVideo(
  input: RenderRequest,
  outputDirectory = process.env.RENDER_OUTPUT_DIR ?? "./renders",
  ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg"
): Promise<RenderResult> {
  const id = randomUUID();
  const { width, height } = DIMENSIONS[input.format];
  const outputDir = path.resolve(outputDirectory);
  await mkdir(outputDir, { recursive: true });

  const titlePath = path.join(outputDir, `${id}-title.txt`);
  const subtitlePath = path.join(outputDir, `${id}-subtitle.txt`);
  const filePath = path.join(outputDir, `${id}.mp4`);
  const fontPath = process.env.FONT_PATH ?? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  let imagePath: string | undefined;
  const decodedImage = input.backgroundImageDataUrl ? decodeBackgroundImage(input.backgroundImageDataUrl) : undefined;

  await writeFile(titlePath, input.title, "utf8");
  await writeFile(subtitlePath, input.subtitle ?? "", "utf8");

  const filters = [
    `drawtext=fontfile=${fontPath}:textfile=${titlePath}:fontcolor=white:fontsize=${Math.max(34, Math.round(width * 0.055))}:x=(w-text_w)/2:y=(h-text_h)/2-60:line_spacing=18`,
    `drawtext=fontfile=${fontPath}:textfile=${subtitlePath}:fontcolor=white:fontsize=${Math.max(22, Math.round(width * 0.026))}:x=(w-text_w)/2:y=(h-text_h)/2+100:line_spacing=12`
  ];

  let inputArgs: string[];
  if (decodedImage) {
    imagePath = path.join(outputDir, `${id}-background.${decodedImage.extension}`);
    await writeFile(imagePath, decodedImage.bytes);
    inputArgs = ["-loop", "1", "-framerate", "30", "-i", imagePath];
    filters.unshift(`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`);
  } else {
    inputArgs = ["-f", "lavfi", "-i", `color=c=0x132238:s=${width}x${height}:r=30:d=${input.durationSeconds}`];
  }

  try {
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y",
      ...inputArgs,
      "-vf", filters.join(","),
      "-an",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      "-t", String(input.durationSeconds),
      filePath
    ], ffmpegPath);
  } catch (error) {
    await Promise.all([
      rm(filePath, { force: true }),
      rm(titlePath, { force: true }),
      rm(subtitlePath, { force: true }),
      ...(imagePath ? [rm(imagePath, { force: true })] : [])
    ]);
    throw error;
  }

  await Promise.all([
    rm(titlePath, { force: true }),
    rm(subtitlePath, { force: true }),
    ...(imagePath ? [rm(imagePath, { force: true })] : [])
  ]);
  return { id, filePath, width, height, durationSeconds: input.durationSeconds };
}


function quoteConcatPath(filePath: string): string {
  return path.resolve(filePath).replace(/'/g, "'\\''");
}

export async function renderScenesVideo(
  input: SceneRenderRequest,
  outputDirectory = process.env.RENDER_OUTPUT_DIR ?? "./renders",
  ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg"
): Promise<RenderResult> {
  const outputDir = path.resolve(outputDirectory);
  await mkdir(outputDir, { recursive: true });
  const id = randomUUID();
  const { width, height } = DIMENSIONS[input.format];
  const filePath = path.join(outputDir, `${id}.mp4`);
  const concatListPath = path.join(outputDir, `${id}-concat.txt`);
  const renderedSegments: RenderResult[] = [];
  const durationSeconds = input.scenes.reduce((total, scene) => total + scene.durationSeconds, 0);

  try {
    for (const scene of input.scenes) {
      renderedSegments.push(await renderTextVideo({ ...scene, format: input.format }, outputDir, ffmpegPath));
    }
    const concatContents = renderedSegments.map((segment) => `file '${quoteConcatPath(segment.filePath)}'`).join("\\n") + "\\n";
    await writeFile(concatListPath, concatContents, "utf8");
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "concat", "-safe", "0", "-i", concatListPath,
      "-c", "copy", "-movflags", "+faststart",
      filePath
    ], ffmpegPath);
    return { id, filePath, width, height, durationSeconds };
  } catch (error) {
    await rm(filePath, { force: true });
    throw error;
  } finally {
    await Promise.all([
      rm(concatListPath, { force: true }),
      ...renderedSegments.map((segment) => rm(segment.filePath, { force: true }))
    ]);
  }
}

export function getDimensions(format: VideoFormat): { width: number; height: number } {
  return DIMENSIONS[format];
}
