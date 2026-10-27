import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const servers: Array<{ close: (callback?: (error?: Error) => void) => void }> = [];

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

  it("rejects malformed render IDs", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/v1/renders/not-a-uuid/video`);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_RENDER_ID" });
  });
});
