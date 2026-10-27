import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getDimensions, renderTextVideo } from "../src/render";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

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
  it("creates an MP4 using a supplied base64 PNG background", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "tambala-render-image-"));
    temporaryDirectories.push(outputDirectory);
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    const result = await renderTextVideo({
      title: "Image-backed video",
      durationSeconds: 3,
      format: "square",
      backgroundImageDataUrl: png
    }, outputDirectory);

    const file = await readFile(result.filePath);
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1080);
    expect(file.subarray(4, 8).toString("ascii")).toBe("ftyp");
  }, 30_000);

});
