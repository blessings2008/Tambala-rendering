import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addAudioTrack, getDimensions, renderScenesVideo, renderTextVideo } from "../src/render";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});


function makeShortWavDataUrl(): string {
  const sampleRate = 8_000;
  const sampleCount = sampleRate;
  const dataSize = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < sampleCount; i++) {
    wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8_000), 44 + i * 2);
  }
  return `data:audio/wav;base64,${wav.toString("base64")}`;
}

describe("video format dimensions", () => {
  it("uses vertical dimensions for short-form social video", () => {
    expect(getDimensions("vertical")).toEqual({ width: 1080, height: 1920 });
  });

  it("supports square and landscape output", () => {
    expect(getDimensions("square")).toEqual({ width: 1080, height: 1080 });
    expect(getDimensions("landscape")).toEqual({ width: 1920, height: 1080 });
  });
});

describe("FFmpeg rendering", () => {
  it("creates a playable MP4 file with the requested dimensions", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "tambala-render-"));
    temporaryDirectories.push(outputDirectory);

    const result = await renderTextVideo({
      title: "Tambala Rendering",
      subtitle: "First automated render",
      durationSeconds: 3,
      format: "vertical"
    }, outputDirectory);

    const file = await readFile(result.filePath);
    const fileInfo = await stat(result.filePath);

    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
    expect(fileInfo.size).toBeGreaterThan(1_000);
    expect(file.subarray(4, 8).toString("ascii")).toBe("ftyp");
  }, 30_000);
  it("renders a fade transition between scenes", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "tambala-render-fade-"));
    temporaryDirectories.push(outputDirectory);
    const result = await renderScenesVideo({
      format: "square",
      transition: "fade",
      scenes: [
        { title: "First scene", durationSeconds: 3 },
        { title: "Second scene", durationSeconds: 3 }
      ]
    }, outputDirectory);
    const file = await readFile(result.filePath);
    expect(result.durationSeconds).toBe(5.5);
    expect(file.subarray(4, 8).toString("ascii")).toBe("ftyp");
  }, 90_000);

  it("supports the paper and neon visual templates", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "tambala-render-templates-"));
    temporaryDirectories.push(outputDirectory);
    for (const template of ["paper", "neon"] as const) {
      const result = await renderTextVideo({
        title: `${template} template`,
        durationSeconds: 3,
        format: "square",
        template
      }, outputDirectory);
      const file = await readFile(result.filePath);
      expect(file.subarray(4, 8).toString("ascii")).toBe("ftyp");
    }
  }, 60_000);

  it("adds a looping audio track to a rendered MP4", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "tambala-render-audio-"));
    temporaryDirectories.push(outputDirectory);
    const result = await renderTextVideo({
      title: "Audio test",
      durationSeconds: 3,
      format: "square"
    }, outputDirectory);

    await addAudioTrack(result, makeShortWavDataUrl());
    const file = await readFile(result.filePath);
    expect(file.subarray(4, 8).toString("ascii")).toBe("ftyp");
    expect((await stat(result.filePath)).size).toBeGreaterThan(1_000);
  }, 60_000);

  it("combines multiple scenes into one MP4 and cleans up intermediate segments", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "tambala-render-scenes-"));
    temporaryDirectories.push(outputDirectory);

    const result = await renderScenesVideo({
      format: "vertical",
      scenes: [
        { title: "Opening scene", subtitle: "Hook", durationSeconds: 3 },
        { title: "Closing scene", subtitle: "Call to action", durationSeconds: 3 }
      ]
    }, outputDirectory);

    const file = await readFile(result.filePath);
    const fileInfo = await stat(result.filePath);
    expect(result.durationSeconds).toBe(6);
    expect(fileInfo.size).toBeGreaterThan(1_000);
    expect(file.subarray(4, 8).toString("ascii")).toBe("ftyp");
    const files = await (await import("node:fs/promises")).readdir(outputDirectory);
    expect(files.filter((name) => name.endsWith(".mp4"))).toEqual([result.id + ".mp4"]);
    expect(files.some((name) => name.includes("concat"))).toBe(false);
  }, 60_000);

  it("renders text animation and background motion over a supplied PNG", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "tambala-render-image-"));
    temporaryDirectories.push(outputDirectory);
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    const result = await renderTextVideo({
      title: "Image-backed video",
      durationSeconds: 3,
      format: "square",
      backgroundImageDataUrl: png,
      textAnimation: "fade-in",
      backgroundMotion: "zoom-in"
    }, outputDirectory);

    const file = await readFile(result.filePath);
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1080);
    expect(file.subarray(4, 8).toString("ascii")).toBe("ftyp");
  }, 30_000);

});
