import { spawn } from "node:child_process";
import { mkdir, writeFile, rm, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type VideoFormat = "vertical" | "square" | "landscape";
export type VideoTemplate = "midnight" | "sunrise" | "paper" | "neon";
export type SceneTransition = "cut" | "fade";
export type TextAnimation = "none" | "fade-in" | "slide-up" | "slide-down" | "zoom-in";
export type BackgroundMotion = "none" | "zoom-in" | "zoom-out" | "pan-left" | "pan-right";

export interface RenderRequest {
  title: string;
  subtitle?: string;
  durationSeconds: number;
  format: VideoFormat;
  backgroundImageDataUrl?: string;
  template?: VideoTemplate;
  textAnimation?: TextAnimation;
  backgroundMotion?: BackgroundMotion;
}

export interface RenderScene {
  title: string;
  subtitle?: string;
  durationSeconds: number;
  backgroundImageDataUrl?: string;
  textAnimation?: TextAnimation;
  backgroundMotion?: BackgroundMotion;
}

export interface SceneRenderRequest {
  scenes: RenderScene[];
  format: VideoFormat;
  template?: VideoTemplate;
  transition?: SceneTransition;
}

export type AudioDataUrl = string;

export interface RenderResult {
  id: string;
  filePath: string;
  width: number;
  height: number;
  durationSeconds: number;
}

const THEMES: Record<VideoTemplate, { backgroundColor: string; titleColor: string; subtitleColor: string }> = {
  midnight: { backgroundColor: "0x132238", titleColor: "white", subtitleColor: "white" },
  sunrise: { backgroundColor: "0x9D3C2B", titleColor: "white", subtitleColor: "0xFFF0D5" },
  paper: { backgroundColor: "0xF2EEE5", titleColor: "0x17212B", subtitleColor: "0x49545F" },
  neon: { backgroundColor: "0x101024", titleColor: "0xC4FF4D", subtitleColor: "white" }
};

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
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-8000); });
    child.on("error", (error) => reject(new Error(`Could not start FFmpeg: ${error.message}`)));
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`)));
  });
}

function decodeBackgroundImage(dataUrl: string): { bytes: Buffer; extension: string } {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("Background image must be a base64 PNG, JPEG, or WebP data URL.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) throw new Error("Background image must be between 1 byte and 5 MB.");
  return { bytes, extension: match[1] === "jpeg" ? "jpg" : match[1] };
}

function escapedFilterNumber(value: number): string { return String(Math.round(value * 1000) / 1000); }

function textAnimationFilters(animation: TextAnimation, titlePath: string, subtitlePath: string, titleColor: string, subtitleColor: string, width: number, height: number) {
  const titleSize = Math.max(34, Math.round(width * 0.055));
  const subtitleSize = Math.max(22, Math.round(width * 0.026));
  const titleY = "(h-text_h)/2-60";
  const subtitleY = "(h-text_h)/2+100";
  const alpha = animation === "fade-in" ? ":alpha='if(lt(t,0.7),t/0.7,1)'" : "";
  const slide = (base: string, direction: number) => animation.startsWith("slide-")
    ? `:y='if(lt(t,0.65),${base}+${direction}*80*(1-t/0.65),${base})'`
    : `:y=${base}`;
  const zoom = animation === "zoom-in" ? ":fontsize='if(lt(t,0.7),0.7,1)*SIZE'" : "";
  const titleSizeExpr = zoom ? `:fontsize='if(lt(t,0.7),${titleSize}*(0.7+0.3*t/0.7),${titleSize})'` : `:fontsize=${titleSize}`;
  const subtitleSizeExpr = zoom ? `:fontsize='if(lt(t,0.7),${subtitleSize}*(0.7+0.3*t/0.7),${subtitleSize})'` : `:fontsize=${subtitleSize}`;
  const titleSlide = animation === "slide-down" ? slide(titleY, -1) : animation === "slide-up" ? slide(titleY, 1) : `:y=${titleY}`;
  const subtitleSlide = animation === "slide-down" ? slide(subtitleY, -1) : animation === "slide-up" ? slide(subtitleY, 1) : `:y=${subtitleY}`;
  return [
    `drawtext=fontfile=${process.env.FONT_PATH ?? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"}:textfile=${titlePath}:fontcolor=${titleColor}${titleSizeExpr}:x=(w-text_w)/2${titleSlide}:line_spacing=18${alpha}`,
    `drawtext=fontfile=${process.env.FONT_PATH ?? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"}:textfile=${subtitlePath}:fontcolor=${subtitleColor}${subtitleSizeExpr}:x=(w-text_w)/2${subtitleSlide}:line_spacing=12${alpha}`
  ];
}

function motionFilter(motion: BackgroundMotion, width: number, height: number, duration: number): string {
  if (motion === "none") return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  const zoom = motion === "zoom-out" ? "1.12-0.12*min(t/3,1)" : "1+0.12*min(t/3,1)";
  const x = motion === "pan-left" ? "iw*0.06*min(t/3,1)" : motion === "pan-right" ? "iw*0.06*(1-min(t/3,1))" : "(iw-iw/zoom)/2";
  const y = "(ih-ih/zoom)/2";
  return `scale=${width * 1.14}:${height * 1.14}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=${width}x${height}:fps=30,trim=duration=${escapedFilterNumber(duration)},setpts=PTS-STARTPTS`;
}

export async function renderTextVideo(input: RenderRequest, outputDirectory = process.env.RENDER_OUTPUT_DIR ?? "./renders", ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg"): Promise<RenderResult> {
  const id = randomUUID();
  const { width, height } = DIMENSIONS[input.format];
  const theme = THEMES[input.template ?? "midnight"];
  const outputDir = path.resolve(outputDirectory);
  await mkdir(outputDir, { recursive: true });
  const titlePath = path.join(outputDir, `${id}-title.txt`);
  const subtitlePath = path.join(outputDir, `${id}-subtitle.txt`);
  const filePath = path.join(outputDir, `${id}.mp4`);
  let imagePath: string | undefined;
  let completed = false;
  const decodedImage = input.backgroundImageDataUrl ? decodeBackgroundImage(input.backgroundImageDataUrl) : undefined;
  try {
    await writeFile(titlePath, input.title, "utf8");
    await writeFile(subtitlePath, input.subtitle ?? "", "utf8");
    const animation = input.textAnimation ?? "none";
    const filters = textAnimationFilters(animation, titlePath, subtitlePath, theme.titleColor, theme.subtitleColor, width, height);
    let inputArgs: string[];
    if (decodedImage) {
      imagePath = path.join(outputDir, `${id}-background.${decodedImage.extension}`);
      await writeFile(imagePath, decodedImage.bytes);
      inputArgs = ["-loop", "1", "-framerate", "30", "-i", imagePath];
      filters.unshift(motionFilter(input.backgroundMotion ?? "none", width, height, input.durationSeconds));
    } else {
      inputArgs = ["-f", "lavfi", "-i", `color=c=${theme.backgroundColor}:s=${width}x${height}:r=30:d=${input.durationSeconds}`];
    }
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y", ...inputArgs,
      "-vf", filters.join(","), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", String(input.durationSeconds), filePath
    ], ffmpegPath);
    completed = true;
    return { id, filePath, width, height, durationSeconds: input.durationSeconds };
  } finally {
    await Promise.all([...(completed ? [] : [rm(filePath, { force: true })]), rm(titlePath, { force: true }), rm(subtitlePath, { force: true }), ...(imagePath ? [rm(imagePath, { force: true })] : [])]);
  }
}

function quoteConcatPath(filePath: string): string { return path.resolve(filePath).replace(/'/g, "'\\''"); }

export async function renderScenesVideo(input: SceneRenderRequest, outputDirectory = process.env.RENDER_OUTPUT_DIR ?? "./renders", ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg"): Promise<RenderResult> {
  const outputDir = path.resolve(outputDirectory); await mkdir(outputDir, { recursive: true });
  const id = randomUUID(); const { width, height } = DIMENSIONS[input.format]; const filePath = path.join(outputDir, `${id}.mp4`); const concatListPath = path.join(outputDir, `${id}-concat.txt`); const renderedSegments: RenderResult[] = [];
  const transition = input.transition ?? "cut"; const transitionSeconds = transition === "fade" ? 0.5 : 0;
  const summedDuration = input.scenes.reduce((total, scene) => total + scene.durationSeconds, 0); const durationSeconds = summedDuration - transitionSeconds * (input.scenes.length - 1);
  try {
    for (const scene of input.scenes) renderedSegments.push(await renderTextVideo({ ...scene, format: input.format, template: input.template }, outputDir, ffmpegPath));
    if (transition === "cut") {
      const concatContents = renderedSegments.map(segment => `file '${quoteConcatPath(segment.filePath)}'`).join("\n") + "\n";
      await writeFile(concatListPath, concatContents, "utf8");
      await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", concatListPath, "-c", "copy", "-movflags", "+faststart", filePath], ffmpegPath);
    } else {
      let accumulatedPath = renderedSegments[0].filePath; let accumulatedDuration = input.scenes[0].durationSeconds; const temporaryFadeFiles: string[] = [];
      try {
        for (let index = 1; index < renderedSegments.length; index++) {
          const nextSegment = renderedSegments[index]; const isLast = index === renderedSegments.length - 1; const nextPath = isLast ? filePath : path.join(outputDir, `${id}-fade-${index}.mp4`); if (!isLast) temporaryFadeFiles.push(nextPath);
          const outputDuration = accumulatedDuration + input.scenes[index].durationSeconds - transitionSeconds; const offset = accumulatedDuration - transitionSeconds;
          await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-filter_complex_threads", "1", "-i", accumulatedPath, "-i", nextSegment.filePath, "-filter_complex", `[0:v]settb=AVTB,setpts=PTS-STARTPTS[v0];[1:v]settb=AVTB,setpts=PTS-STARTPTS[v1];[v0][v1]xfade=transition=fade:duration=${transitionSeconds}:offset=${offset}[outv]`, "-map", "[outv]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", "30", "-threads", "1", "-t", String(outputDuration), "-movflags", "+faststart", nextPath], ffmpegPath);
          if (accumulatedPath !== renderedSegments[0].filePath) await rm(accumulatedPath, { force: true });
          accumulatedPath = nextPath; accumulatedDuration = outputDuration;
        }
      } finally { await Promise.all(temporaryFadeFiles.map(temporaryPath => rm(temporaryPath, { force: true }))); }
    }
    return { id, filePath, width, height, durationSeconds };
  } catch (error) { await rm(filePath, { force: true }); throw error; }
  finally { await Promise.all([rm(concatListPath, { force: true }), ...renderedSegments.map(segment => rm(segment.filePath, { force: true }))]); }
}

function decodeAudio(dataUrl: AudioDataUrl): { bytes: Buffer; extension: string } {
  const match = /^data:audio\/(mpeg|mp3|wav|x-wav|mp4|aac|ogg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("Audio must be a base64 MP3, WAV, M4A, AAC, or OGG data URL."); const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) throw new Error("Audio must be between 1 byte and 5 MB.");
  const extensions: Record<string, string> = { mpeg: "mp3", mp3: "mp3", wav: "wav", "x-wav": "wav", mp4: "m4a", aac: "aac", ogg: "ogg" }; return { bytes, extension: extensions[match[1]] };
}

export async function addAudioTrack(result: RenderResult, audioDataUrl: AudioDataUrl, ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg"): Promise<RenderResult> {
  const decodedAudio = decodeAudio(audioDataUrl); const outputDirectory = path.dirname(result.filePath); const audioPath = path.join(outputDirectory, `${result.id}-audio.${decodedAudio.extension}`); const muxedPath = path.join(outputDirectory, `${result.id}-muxed.mp4`);
  try { await writeFile(audioPath, decodedAudio.bytes); await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-i", result.filePath, "-stream_loop", "-1", "-i", audioPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(result.durationSeconds), "-shortest", "-movflags", "+faststart", muxedPath], ffmpegPath); await rename(muxedPath, result.filePath); return result; }
  finally { await Promise.all([rm(audioPath, { force: true }), rm(muxedPath, { force: true })]); }
}

export function getDimensions(format: VideoFormat): { width: number; height: number } { return DIMENSIONS[format]; }
