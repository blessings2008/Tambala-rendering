import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { addAudioTrack, renderScenesVideo, renderTextVideo } from "./render";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "7mb" }));

  const configuredMax = Number.parseInt(process.env.MAX_RENDER_SECONDS ?? "30", 10);
  const maxDuration = Number.isFinite(configuredMax) && configuredMax >= 3 ? configuredMax : 30;
  const imageSchema = z.string().max(7_000_000)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/);
  const audioSchema = z.string().max(7_000_000)
    .regex(/^data:audio\/(mpeg|mp3|wav|x-wav|mp4|aac|ogg);base64,[A-Za-z0-9+/]+={0,2}$/);
  const sceneSchema = z.object({
    title: z.string().trim().min(1).max(160),
    subtitle: z.string().trim().max(240).optional(),
    durationSeconds: z.number().int().min(3).max(maxDuration),
    backgroundImageDataUrl: imageSchema.optional()
  });
  const renderSchema = z.object({
    title: z.string().trim().min(1).max(160).optional(),
    subtitle: z.string().trim().max(240).optional(),
    durationSeconds: z.number().int().min(3).max(maxDuration).default(8),
    format: z.enum(["vertical", "square", "landscape"]).default("vertical"),
    template: z.enum(["midnight", "sunrise", "paper", "neon"]).default("midnight"),
    transition: z.enum(["cut", "fade"]).default("cut"),
    backgroundImageDataUrl: imageSchema.optional(),
    audioDataUrl: audioSchema.optional(),
    scenes: z.array(sceneSchema).min(2).max(8).optional()
  }).superRefine((value, context) => {
    if (value.scenes && (value.title !== undefined || value.subtitle !== undefined || value.backgroundImageDataUrl !== undefined)) {
      context.addIssue({ code: "custom", path: ["scenes"], message: "Use either single-scene fields or scenes, not both." });
    } else if (!value.scenes && !value.title) {
      context.addIssue({ code: "custom", path: ["title"], message: "A title or at least two scenes is required." });
    }
    if (value.scenes) {
      const totalDuration = value.scenes.reduce((total, scene) => total + scene.durationSeconds, 0);
      if (totalDuration > maxDuration) {
        context.addIssue({ code: "custom", path: ["scenes"], message: `Combined scene duration must not exceed ${maxDuration} seconds.` });
      }
      const totalAssetCharacters = value.scenes.reduce((total, scene) => total + (scene.backgroundImageDataUrl?.length ?? 0), 0)
        + (value.audioDataUrl?.length ?? 0);
      if (totalAssetCharacters > 6_500_000) {
        context.addIssue({ code: "custom", path: ["scenes"], message: "Combined image and audio data is too large; keep total assets under 5 MB." });
      }
    } else {
      const totalAssetCharacters = (value.backgroundImageDataUrl?.length ?? 0) + (value.audioDataUrl?.length ?? 0);
      if (totalAssetCharacters > 6_500_000) {
        context.addIssue({ code: "custom", path: ["audioDataUrl"], message: "Combined image and audio data is too large; keep total assets under 5 MB." });
      }
    }
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

  // Render creation stays protected by the API key. Completed video downloads use
  // short-lived signed URLs so a browser can open them without exposing the API key.
  const apiKey = process.env.RENDER_API_KEY;
  const downloadTokenTtlSeconds = 60 * 60;

  const requireApiKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (process.env.NODE_ENV === "production" && !apiKey) {
      return res.status(503).json({ error: "RENDER_API_KEY_NOT_CONFIGURED" });
    }
    if (!apiKey) return next();
    const authorization = req.header("authorization") ?? "";
    if (authorization !== `Bearer ${apiKey}`) {
      return res.status(401).json({ error: "UNAUTHORIZED" });
    }
    return next();
  };

  const signDownloadToken = (renderId: string, expiresAt: number) => {
    if (!apiKey) return "";
    const payload = `${renderId}.${expiresAt}`;
    const signature = createHmac("sha256", apiKey).update(payload).digest("base64url");
    return `${expiresAt}.${signature}`;
  };

  const verifyDownloadToken = (renderId: string, token: string) => {
    if (!apiKey) return false;
    const separator = token.indexOf(".");
    if (separator <= 0) return false;
    const expiresAt = Number(token.slice(0, separator));
    const signature = token.slice(separator + 1);
    if (!Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000) || !signature) return false;
    const expected = createHmac("sha256", apiKey)
      .update(`${renderId}.${expiresAt}`)
      .digest("base64url");
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  };

  app.post("/v1/renders", requireApiKey, async (req, res) => {
    const parsed = renderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "INVALID_RENDER_REQUEST",
        details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
      });
    }

    try {
      const input = parsed.data;
      const result = input.scenes
        ? await renderScenesVideo({ scenes: input.scenes, format: input.format, template: input.template, transition: input.transition })
        : await renderTextVideo({
            title: input.title!,
            subtitle: input.subtitle,
            durationSeconds: input.durationSeconds,
            format: input.format,
            template: input.template,
            backgroundImageDataUrl: input.backgroundImageDataUrl
          });
      if (input.audioDataUrl) await addAudioTrack(result, input.audioDataUrl);

      const expiresAt = Math.floor(Date.now() / 1000) + downloadTokenTtlSeconds;
      const downloadToken = signDownloadToken(result.id, expiresAt);
      const videoUrl = `/v1/renders/${result.id}/video?token=${encodeURIComponent(downloadToken)}`;

      return res.status(201).json({
        id: result.id,
        status: "completed",
        format: input.format,
        template: input.template,
        transition: input.scenes ? input.transition : "not_applicable",
        width: result.width,
        height: result.height,
        durationSeconds: result.durationSeconds,
        sceneCount: input.scenes?.length ?? 1,
        audioIncluded: Boolean(input.audioDataUrl),
        videoUrl,
        videoUrlExpiresAt: new Date(expiresAt * 1000).toISOString()
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

    const authorization = req.header("authorization") ?? "";
    const authorizedByApiKey = Boolean(apiKey) && authorization === `Bearer ${apiKey}`;
    const authorizedByDownloadToken = verifyDownloadToken(req.params.id, req.query.token?.toString() ?? "");

    if (process.env.NODE_ENV === "production" && !apiKey) {
      return res.status(503).json({ error: "RENDER_API_KEY_NOT_CONFIGURED" });
    }
    if (apiKey && !authorizedByApiKey && !authorizedByDownloadToken) {
      return res.status(401).json({ error: "UNAUTHORIZED" });
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
