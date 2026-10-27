# Tambala Rendering

**Tambala Rendering** is the dedicated, API-first video rendering service for Tambala Technologies. It is being built as our own rendering pipeline—not as a CapCut-style editor and not as a thin wrapper around a third-party video-generation API.

## Current MVP

- Node.js + TypeScript HTTP API.
- FFmpeg-powered MP4 rendering.
- Vertical (1080×1920), square (1080×1080), and landscape (1920×1080) output.
- Text-based video scenes with a title and optional subtitle.
- Scene-based composition: combine 2–8 scenes into one MP4, each with its own duration and optional background image.
- Optional base64 PNG, JPEG, or WebP background image (up to 5 MB), cropped to fill the selected format.
- Optional looping background audio from base64 MP3, WAV, M4A, AAC, or OGG input; audio is encoded to AAC in the final MP4.
- Health endpoint, request validation, Docker image, and CI checks.

The rendering foundation now supports assembling short multi-scene videos and adding a supplied audio track. AI-generated footage, transitions, uploaded media, templates, queued jobs, and prompt-to-video generation remain future capabilities.

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

### Render one scene

```http
POST /v1/renders
Content-Type: application/json

{
  "title": "Your next big idea",
  "subtitle": "Made with Tambala",
  "durationSeconds": 8,
  "format": "vertical",
  "backgroundImageDataUrl": "data:image/png;base64,...",
  "audioDataUrl": "data:audio/mpeg;base64,..."
}
```

Supported formats: `vertical`, `square`, `landscape`. Duration must be 3 seconds or more and is capped by `MAX_RENDER_SECONDS` (30 seconds by default).

### Render a multi-scene video

Send 2–8 scenes. Each scene has its own title, optional subtitle, duration, and optional base64 image. The combined duration must stay within `MAX_RENDER_SECONDS` (30 seconds by default).

```json
{
  "format": "vertical",
  "scenes": [
    { "title": "The problem", "subtitle": "Every idea starts somewhere", "durationSeconds": 4 },
    { "title": "A better way", "subtitle": "Built with Tambala", "durationSeconds": 5, "backgroundImageDataUrl": "data:image/png;base64,..." }
  ]
}
```

Supported formats: `vertical`, `square`, `landscape`. Scene durations must be at least 3 seconds. The combined duration cannot exceed the configured maximum. You can add `audioDataUrl` at the top level to loop a supported audio track under the full video. Audio and image assets share a combined request limit of approximately 5 MB.

A successful response includes a render ID, total duration, scene count, whether audio was included, and relative `videoUrl`. Download it with `GET /v1/renders/{id}/video`.

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
- This creates designed text scenes, can use supplied background images, and can add a supplied audio track. It does not yet generate moving footage or narration from a text prompt.

## Next milestones

1. Add a job queue and progress/status endpoint.
2. Add transitions and reusable scene templates.
3. Add durable object storage and signed download links.
4. Add an authenticated internal API for Tambala agents and products.
5. Explore AI scene generation as a separate optional pipeline.

## Project

Repository: https://github.com/blessings2008/Tambala-rendering
