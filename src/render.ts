import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type VideoFormat = "vertical" | "square" | "landscape";

export interface RenderRequest {
  title: string;
  subtitle?: string;
  durationSeconds: number;
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

export async function renderTextVideo(
  input: RenderRequest,
  outputDirectory = process.env.RENDER_OUTPUT_DIR ?? "./renders",
  ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg"
): Promise<RenderResult> {
  const id = randomUUID();
  const { width, height } = DIMENSIONS[input.format];
  const outputDir = path.resolve(outputDirectory);
  await mkdir(outputDir, { recursive: true });

  // Text is written to files instead of interpolated into an FFmpeg filter,
  // avoiding filter-escaping problems with user-supplied punctuation.
  const titlePath = path.join(outputDir, `${id}-title.txt`);
  const subtitlePath = path.join(outputDir, `${id}-subtitle.txt`);
  const filePath = path.join(outputDir, `${id}.mp4`);
  await writeFile(titlePath, input.title, "utf8");
  await writeFile(subtitlePath, input.subtitle ?? "", "utf8");

  const font = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  const filter = [
    `drawtext=fontfile=${font}:textfile=${titlePath}:fontcolor=white:fontsize=${Math.max(34, Math.round(width * 0.055))}:x=(w-text_w)/2:y=(h-text_h)/2-60:line_spacing=18`,
    `drawtext=fontfile=${font}:textfile=${subtitlePath}:fontcolor=white:fontsize=${Math.max(22, Math.round(width * 0.026))}:x=(w-text_w)/2:y=(h-text_h)/2+100:line_spacing=12`
  ].join(",");

  try {
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `color=c=0x132238:s=${width}x${height}:r=30:d=${input.durationSeconds}`,
      "-vf", filter,
      "-an",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      "-t", String(input.durationSeconds),
      filePath
    ], ffmpegPath);
  } catch (error) {
    // Do not leave half-written output behind after a failed render.
    const { rm } = await import("node:fs/promises");
    await Promise.all([rm(filePath, { force: true }), rm(titlePath, { force: true }), rm(subtitlePath, { force: true })]);
    throw error;
  }

  const { rm } = await import("node:fs/promises");
  await Promise.all([rm(titlePath, { force: true }), rm(subtitlePath, { force: true })]);
  return { id, filePath, width, height, durationSeconds: input.durationSeconds };
}

export function getDimensions(format: VideoFormat): { width: number; height: number } {
  return DIMENSIONS[format];
}
