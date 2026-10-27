# Tambala Rendering API

## Authentication

Send the configured render key as:

`Authorization: Bearer <RENDER_API_KEY>`

## Synchronous render

`POST /v1/renders`

The existing endpoint returns the completed render metadata and a signed video URL.

## Asynchronous render

`POST /v1/renders?async=true`

The endpoint returns HTTP `202` immediately:

```json
{
  "id": "<render-id>",
  "status": "queued",
  "statusUrl": "/v1/renders/<render-id>"
}
```

Poll `GET /v1/renders/<render-id>` using the same bearer token. A job moves through `queued`, `rendering`, `completed`, or `failed`.

A completed job contains `result.videoUrl` and `result.videoUrlExpiresAt`.

## Multi-scene render with images

Each scene can include `backgroundImageDataUrl` using a PNG, JPEG, or WebP data URL:

```json
{
  "format": "vertical",
  "template": "sunrise",
  "transition": "fade",
  "scenes": [
    {
      "title": "Welcome to our lodge",
      "subtitle": "Comfort in the heart of Malawi",
      "durationSeconds": 4,
      "backgroundImageDataUrl": "data:image/jpeg;base64,..."
    },
    {
      "title": "Relax. Stay. Explore.",
      "subtitle": "Book your next escape",
      "durationSeconds": 4,
      "backgroundImageDataUrl": "data:image/jpeg;base64,..."
    }
  ]
}
```

The current server limits combined render duration to 30 seconds by default and accepts up to 8 scenes. Image and audio payloads are deliberately size-limited to protect the small Render instance.

## Busy protection

Only one render is allowed at a time on the current small instance. A second request receives HTTP `429` with `RENDER_BUSY`. This prevents concurrent FFmpeg processes from exhausting memory.
