# Image-based scenes

Tambala Rendering supports an optional `backgroundImageDataUrl` on every scene.

## Scene request

```json
{
  "scenes": [
    {
      "title": "Welcome to Malabi",
      "subtitle": "A place to relax and reconnect",
      "durationSeconds": 4,
      "backgroundImageDataUrl": "data:image/jpeg;base64,..."
    },
    {
      "title": "Premium Rooms",
      "subtitle": "Comfort with a view",
      "durationSeconds": 4,
      "backgroundImageDataUrl": "data:image/jpeg;base64,..."
    }
  ],
  "format": "vertical",
  "template": "sunrise",
  "transition": "fade"
}
```

## Supported image formats

- PNG
- JPEG
- WebP

Maximum decoded upload size per scene: 5 MB.

If no image is supplied, the renderer uses the selected template background. Images are scaled and cropped to the selected output dimensions before text is drawn.

## Design direction

The web studio should expose image selection per scene rather than requiring callers to construct data URLs manually. The API remains the source of truth so other Tambala products and agents can generate the same videos programmatically.
