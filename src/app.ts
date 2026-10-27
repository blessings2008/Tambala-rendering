import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { renderTextVideo } from "./render";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "7mb" }));

  const configuredMax = Number.parseInt(process.env.MAX_RENDER_SECONDS ?? "30", 10);
  const maxDuration = Number.isFinite(configuredMax) && configuredMax >= 3 ? configuredMax : 30;
  const renderSchema = z.object({
    title: z.string().trim().min(1).max(160),
    subtitle: z.string().trim().max(240).optional(),
    durationSeconds: z.number().int().min(3).max(maxDuration).default(8),
    format: z.enum(["vertical", "square", "landscape"]).default("vertical"),
    backgroundImageDataUrl: z.string().max(7_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/).optional()
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "tambala-rendering", version: "0.1.0" });
  });

  app.get("/", (_req, res) => {
    res.json({
      service: "Tambala Rendering",
      version: "0.1.0",
      endpoints: {
        health: "GET /health",
        createRender: "POST /v1/renders",
        getVideo: "GET /v1/renders/:id/video"
      }
    });
  });

  app.post("/v1/renders", async (req, res) => {
    const parsed = renderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "INVALID_RENDER_REQUEST",
        details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
      });
    }

    try {
      const result = await renderTextVideo(parsed.data);
      return res.status(201).json({
        id: result.id,
        status: "completed",
        format: parsed.data.format,
        width: result.width,
        height: result.height,
        durationSeconds: result.durationSeconds,
        videoUrl: `/v1/renders/${result.id}/video`
      });
    } catch (error) {
      console.error("Render failed:", error instanceof Error ? error.message : "unknown error");
      return res.status(500).json({ error: "RENDER_FAILED", message: "The video could not be rendered." });
    }
  });

  app.get("/v1/renders/:id/video", (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
      return res.status(400).json({ error: "INVALID_RENDER_ID" });
    }
    const outputDirectory = path.resolve(process.env.RENDER_OUTPUT_DIR ?? "./renders");
    const filePath = path.join(outputDirectory, `${req.params.id}.mp4`);
    if (!existsSync(filePath)) return res.status(404).json({ error: "RENDER_NOT_FOUND" });
    return res.type("video/mp4").download(filePath, `${req.params.id}.mp4`);
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof SyntaxError) return res.status(400).json({ error: "INVALID_JSON" });
    console.error("Unhandled request error:", error instanceof Error ? error.message : "unknown error");
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  });

  return app;
}
