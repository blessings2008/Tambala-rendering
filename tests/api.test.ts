import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const servers: Array<{ close: (callback?: (error?: Error) => void) => void }> = [];
const temporaryDirectories: string[] = [];
const originalRenderOutputDirectory = process.env.RENDER_OUTPUT_DIR;

async function startServer() {
  const server = createApp().listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not determine test server port");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  ));
  process.env.RENDER_OUTPUT_DIR = originalRenderOutputDirectory;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("HTTP API", () => {
  it("reports service health", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "tambala-rendering",
      version: "0.1.0"
    });
  });

  it("rejects invalid render requests before starting FFmpeg", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/v1/renders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "", durationSeconds: 1, format: "cinema" })
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_RENDER_REQUEST" });
  });

  it("renders a multi-scene request and exposes its MP4 download", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "tambala-api-render-"));
    temporaryDirectories.push(outputDirectory);
    process.env.RENDER_OUTPUT_DIR = outputDirectory;
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/v1/renders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        format: "square",
        scenes: [
          { title: "API opening", durationSeconds: 3 },
          { title: "API ending", subtitle: "Done", durationSeconds: 3 }
        ]
      })
    });
    expect(response.status).toBe(201);
    const payload = await response.json() as {
      id: string;
      status: string;
      sceneCount: number;
      durationSeconds: number;
      videoUrl: string;
    };
    expect(payload).toMatchObject({ status: "completed", sceneCount: 2, durationSeconds: 6 });
    const videoResponse = await fetch(new URL(payload.videoUrl, baseUrl));
    expect(videoResponse.status).toBe(200);
    const video = Buffer.from(await videoResponse.arrayBuffer());
    expect(video.subarray(4, 8).toString("ascii")).toBe("ftyp");
  }, 90_000);

  it("rejects scene requests above the configured duration limit", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/v1/renders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        format: "vertical",
        scenes: [
          { title: "Opening", durationSeconds: 16 },
          { title: "Ending", durationSeconds: 15 }
        ]
      })
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_RENDER_REQUEST" });
  });

  it("rejects requests mixing single-scene fields with a scene list", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/v1/renders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "This should not be mixed",
        format: "vertical",
        scenes: [
          { title: "Opening", durationSeconds: 3 },
          { title: "Ending", durationSeconds: 3 }
        ]
      })
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_RENDER_REQUEST" });
  });

  it("rejects malformed render IDs", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/v1/renders/not-a-uuid/video`);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_RENDER_ID" });
  });
});
