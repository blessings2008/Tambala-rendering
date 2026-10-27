# Tambala Rendering

**Tambala Rendering** is the dedicated, API-first video rendering service for Tambala Technologies. It is being built as our own rendering pipeline—not as a CapCut-style editor and not as a thin wrapper around a third-party video-generation API.

## Current MVP

- Node.js + TypeScript HTTP API.
- FFmpeg-powered MP4 rendering.
- Vertical (1080×1920), square (1080×1080), and landscape (1920×1080) output.
- Text-based starter videos with a title and optional subtitle.
- Health endpoint, request validation, Docker image, and CI checks.

This is the first rendering foundation. Image sequences, uploaded media, music, transitions, templates, queued jobs, and AI-generated scenes are planned follow-on capabilities; they are not implemented yet.

## Run locally

Requirements: Node.js 20+ and FFmpeg installed on your machine.

```bash
npm install
cp .env.example .env
npm run dev
```

Set `FFMPEG_PATH` if the FFmpeg executable is not on your PATH. The default output folder is `./renders`.

## API

### Health check

```http
GET /health
```

### Render a video

```http
POST /v1/renders
Content-Type: application/json

{
  "title": "Your next big idea",
  "subtitle": "Made with Tambala",
  "durationSeconds": 8,
  "format": "vertical"
}
```

Supported formats: `vertical`, `square`, `landscape`. Duration must be 3 seconds or more and is capped by `MAX_RENDER_SECONDS` (30 seconds by default).

A successful response includes a render ID and a relative `videoUrl`. Download it with `GET /v1/renders/{id}/video`.

Example with curl:

```bash
curl -X POST http://localhost:3000/v1/renders \
  -H 'Content-Type: application/json' \
  -d '{"title":"Hello from Tambala","subtitle":"First render","durationSeconds":5,"format":"vertical"}'
```

## Docker

```bash
docker build -t tambala-rendering .
docker run --rm -p 3000:3000 tambala-rendering
```

The container installs FFmpeg and the DejaVu font used by the title renderer.

## Important MVP limits

- Rendering is synchronous and intended for short test jobs.
- Render files are stored on the service's local filesystem. Ephemeral hosting filesystems can be cleared on restart/redeploy, so this is not yet durable production storage.
- There is no authentication or public multi-tenant protection yet. Keep the service private until API keys, rate limits, job quotas, and storage lifecycle controls are implemented.
- The first endpoint generates a designed background with text; it does not yet accept user uploads or generate footage from a prompt.

## Next milestones

1. Verify builds and create the first real MP4.
2. Add safe asset uploads and scene-based composition.
3. Add a job queue and progress/status endpoint.
4. Add durable object storage and signed download links.
5. Add an authenticated internal API for Tambala agents and products.
6. Explore AI scene generation as a separate optional pipeline.

## Project

Repository: https://github.com/blessings2008/Tambala-rendering
