# Vision AI Image Captioning

Auto-generate a short caption describing each uploaded image using Cloudflare
Workers AI, store it alongside the R2 object, and surface it in the gallery.

## Goal

When a user uploads an image through `POST /api/r2/upload`, run it through a
Workers AI image-to-text model, save the resulting caption with the object, and
display the caption in the R2 gallery (and use it as the image `alt` text).

## Why it fits the showcase

- Demonstrates a **second Workers AI modality** (image-to-text) on top of the
  existing text LLM at `/api/ai/generate`.
- **Chains two free-tier services** — R2 + Workers AI — inside a single request.
- No new bindings, no schema migration, and **$0 on the free tier**.

## Model

Recommended: **`@cf/llava-hf/llava-1.5-7b-hf`** — image-to-text, free-form captions.

| Model | Output | Notes |
|-------|--------|-------|
| `@cf/llava-hf/llava-1.5-7b-hf` | `{ description }` | Best free-form captions; accepts a `prompt`. **Recommended.** |
| `@cf/unum/uform-gen2-qa-500m` | `{ description }` | Smaller/faster, terser captions |
| `@cf/microsoft/resnet-50` | `[{ label, score }]` | Classification labels only, not sentences |

Input shape for LLaVA — the image is passed as an array of byte values:

```js
const result = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
  image:  [...new Uint8Array(bytes)],         // bytes = the uploaded ArrayBuffer
  prompt: 'Give a short, factual caption describing this image.',
  max_tokens: 64,
});
// result.description → "A grey tabby cat sitting on a windowsill."
```

## Data flow

```
client ──multipart──▶ /api/r2/upload
                          │ 1. verify Turnstile + size/MIME (existing)
                          │ 2. env.AI.run(llava, image bytes)  ◀── NEW
                          │ 3. BUCKET.put(key, bytes, { customMetadata: { caption } })
                          ▼
                       { success, key, url, size, caption }
                          │
client ◀──────────────────┘  renders caption immediately

/api/r2/list ──list({ include:['customMetadata'] })──▶ caption per object ◀── NEW
```

## Where the caption lives: R2 custom metadata

Store the caption in the object's `customMetadata` rather than a D1 table.

- **Travels with the object** — no second store to keep in sync.
- **Wipe-safe** — the 4-hour wipe deletes the R2 object and its metadata
  together, so no orphaned caption rows. No change to `admin/wipe.js` needed.
- Retrieved in one call via `BUCKET.list({ include: ['customMetadata'] })`.

> Custom metadata values are strings and capped (~2 KB total per object). Trim
> the caption (e.g. `.slice(0, 256)`) before storing — plenty for a sentence.

(If you later want **search by caption**, mirror it into a D1 column at that
point — the metadata stays the source of truth for display.)

## Implementation

### 1. Backend — `functions/api/r2/upload.js`

After the size check, before responding, generate the caption and attach it to
the `put`. Make captioning **best-effort**: a model error must not fail the
upload.

```js
// … existing Turnstile, MIME, and size checks above …

const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
const key = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;

// ── Vision AI caption (best-effort — never blocks the upload) ──
let caption = '';
try {
  const vision = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
    image:  [...new Uint8Array(bytes)],
    prompt: 'Give a short, factual caption describing this image.',
    max_tokens: 64,
  });
  caption = String(vision.description ?? '').trim().slice(0, 256);
} catch { /* caption stays '' — upload still succeeds */ }

await env.BUCKET.put(key, bytes, {
  httpMetadata: {
    contentType:  file.type,
    cacheControl: 'public, max-age=86400',
  },
  customMetadata: caption ? { caption } : undefined,
});

return Response.json(
  { success: true, key, url: `/api/r2/file/${encodeURIComponent(key)}`, size: bytes.byteLength, caption },
  { status: 201, headers: CORS }
);
```

### 2. Backend — `functions/api/r2/list.js`

Ask `list()` to include custom metadata, then expose `caption` per file.

```js
const listed = await env.BUCKET.list({ limit: 100, include: ['customMetadata'] });
const sorted = listed.objects.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));

const files = sorted.map(obj => ({
  key:      obj.key,
  size:     obj.size,
  uploaded: obj.uploaded,
  url:      `/api/r2/file/${encodeURIComponent(obj.key)}`,
  is_demo:  obj.key.startsWith('demo-'),
  caption:  obj.customMetadata?.caption ?? '',   // ◀── NEW
}));
```

### 3. Frontend — `public/app.js`

Render the caption in the gallery item and use it as `alt` text (accessibility
win — currently `alt` is just the filename).

```js
gallery.innerHTML = d.files.map(f => `
  <div class="gallery-item" title="${esc(f.caption || f.key)}\n${fmtBytes(f.size)} · ${timeAgo(f.uploaded)}">
    ${f.is_demo ? '<span class="demo-flag">demo</span>' : ''}
    <img src="${esc(f.url)}" alt="${esc(f.caption || f.key)}" loading="lazy">
    <div class="gallery-meta">${f.caption ? esc(f.caption) : fmtBytes(f.size)}</div>
  </div>
`).join('');
```

In `uploadFile`, surface the caption on success:

```js
if (res.ok) {
  status.textContent = data.caption ? `Uploaded — “${data.caption}”` : `Uploaded! ${fmtBytes(data.size)}`;
  // … existing reset + loadR2() …
}
```

### 4. Frontend — `public/style.css` (optional polish)

`.gallery-meta` already overlays text on hover. To let a longer caption wrap
instead of clipping:

```css
.gallery-meta { white-space: normal; line-height: 1.25; max-height: 60%; overflow: hidden; }
```

## Edge cases & considerations

- **Model failure / cold model** — captioning is wrapped in `try/catch`; on
  error the caption is empty and the upload still returns `201`.
- **Latency** — LLaVA adds ~1–3 s to the upload. Acceptable synchronously for a
  demo. If it feels slow, move captioning to `ctx.waitUntil()` (caption fills in
  on the next `loadR2()` poll) — at the cost of not returning it in the response.
- **Caption length** — trimmed to 256 chars to stay well under the R2
  customMetadata limit.
- **GIF/WebP** — LLaVA reads the first frame; still produces a usable caption.
- **Moderation** — captions are model-generated from user images; the existing
  Turnstile gate + size cap remain the primary abuse controls.
- **Daily wipe** — no change. Captions live in object metadata and are deleted
  with the object.

## Free tier impact

| Service | Before | After |
|---------|--------|-------|
| Workers AI | 1 text call per `/api/ai/generate` | + 1 image-to-text call per upload |
| R2 | `put` + `list` | same calls; `list` now includes metadata (no extra op) |
| D1 / KV | — | unchanged |

Workers AI is free in beta; image-to-text counts against the same neuron
allowance as the existing text model. Uploads are Turnstile-gated and capped at
500 KB, which bounds inference volume.

## Testing

```bash
# Workers AI needs the real binding — run against remote
npx wrangler pages dev public --remote
```

1. Upload an image → response includes a non-empty `caption`.
2. `GET /api/r2/file/<key>` still serves the bytes (unaffected).
3. `GET /api/r2/list` → each user object has a `caption` field.
4. Gallery shows the caption on hover; `<img alt>` carries it.
5. Force a model error (e.g. temporarily bad model ID) → upload still returns
   `201` with `caption: ""`.

## Future enhancements

- **Search by caption** — mirror captions into a D1 column + `LIKE`/FTS, wired
  into the existing `/api/d1/search`.
- **Alt-text accessibility badge** — show that captions double as screen-reader text.
- **Caption on demand** — a "re-caption" button that calls a dedicated endpoint
  for an existing key.
