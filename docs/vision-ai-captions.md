# Vision AI Image Captioning & Moderation

Use Cloudflare Workers AI to caption every R2 upload **and** reject images the
model flags as potentially offensive — in a single inference call.

## Goal

When a user uploads an image through `POST /api/r2/upload`, run it through a
Workers AI image-to-text model that returns both a **safety verdict** and a
**short caption**:

- Verdict `SAFE: no` → reject with `422`, do **not** write to R2, log a
  `moderation_reject` analytics event.
- Verdict `SAFE: yes` → store the caption in R2 `customMetadata` and surface it
  in the gallery (also used as the image `alt` text).

## Why it fits the showcase

- Demonstrates a **second Workers AI modality** (image-to-text) on top of the
  existing text LLM at `/api/ai/generate`.
- **Chains R2 + Workers AI + D1 analytics** in a single request.
- Adds a visible **content-safety layer** without new bindings, new models, or
  schema migrations.
- **$0 on the free tier.**

## Model

Recommended: **`@cf/llava-hf/llava-1.5-7b-hf`** — image-to-text, free-form captions.

| Model | Output | Notes |
|-------|--------|-------|
| `@cf/llava-hf/llava-1.5-7b-hf` | `{ description }` | Best free-form captions; accepts a `prompt`. **Recommended.** |
| `@cf/unum/uform-gen2-qa-500m` | `{ description }` | Smaller/faster, terser captions |
| `@cf/microsoft/resnet-50` | `[{ label, score }]` | Classification labels only, not sentences |

Input shape for LLaVA — the image is passed as an array of byte values, and we
ask for a two-line structured response so a single call yields both verdict and
caption:

```js
const result = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
  image: [...new Uint8Array(bytes)],          // bytes = the uploaded ArrayBuffer
  prompt:
    'Examine this image. Reply in exactly this format:\n' +
    'SAFE: yes or no\n' +
    'CAPTION: a short factual description\n\n' +
    'Treat the image as UNSAFE if it contains nudity, sexual content, ' +
    'graphic violence or gore, weapons used to threaten, hate symbols, ' +
    'or illegal activity.',
  max_tokens: 96,
});
// result.description → "SAFE: yes\nCAPTION: A grey tabby cat on a windowsill."
```

## Data flow

```
client ──multipart──▶ /api/r2/upload
                          │ 1. verify Turnstile + size/MIME (existing)
                          │ 2. env.AI.run(llava, image bytes)  ◀── NEW
                          │      parse SAFE: + CAPTION:
                          │
                          ├── SAFE: no  ─▶ 422 { error }  +  D1 analytics(moderation_reject)
                          │                (no R2 put)
                          │
                          └── SAFE: yes ─▶ BUCKET.put(key, bytes, { customMetadata: { caption } })
                                            │
                                            ▼
                                          201 { success, key, url, size, caption }
                                            │
client ◀────────────────────────────────────┘  renders caption immediately

/api/r2/list ──list({ include:['customMetadata'] })──▶ caption per object
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

After the size check, run one combined LLaVA call. **Fail open** on a model or
parse error: Turnstile + the 500 KB cap remain the primary controls.

```js
// … existing Turnstile, MIME, and size checks above …

const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
const key = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;

// ── Vision AI — combined safety check + caption (one inference) ──
let caption  = '';
let rejected = false;
try {
  const vision = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
    image: [...new Uint8Array(bytes)],
    prompt:
      'Examine this image. Reply in exactly this format:\n' +
      'SAFE: yes or no\n' +
      'CAPTION: a short factual description\n\n' +
      'Treat the image as UNSAFE if it contains nudity, sexual content, ' +
      'graphic violence or gore, weapons used to threaten, hate symbols, ' +
      'or illegal activity.',
    max_tokens: 96,
  });
  const text         = String(vision.description ?? '').trim();
  const safeMatch    = text.match(/SAFE:\s*(yes|no)/i);
  const captionMatch = text.match(/CAPTION:\s*(.+)/i);
  if (safeMatch && safeMatch[1].toLowerCase() === 'no') {
    rejected = true;
  } else {
    caption = (captionMatch?.[1] ?? '').trim().slice(0, 256);
  }
} catch { /* fail open — caption stays '', rejected stays false */ }

if (rejected) {
  env.DB.prepare(
    'INSERT INTO analytics (event_type, feature, country) VALUES (?, ?, ?)'
  ).bind('moderation_reject', 'r2_upload', request.cf?.country ?? null)
   .run().catch(() => {});
  return Response.json(
    { error: 'Image rejected — content policy flagged this image as potentially offensive.' },
    { status: 422, headers: CORS }
  );
}

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

> **Why a generic error message?** The model's own description of an unsafe
> image can echo the offensive content. We surface only a generic policy
> message; the category lands in D1 analytics for debugging.

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

In `uploadFile`, surface the caption on success **and** reset Turnstile on a
`422` so the user can retry with a different image:

```js
if (res.ok) {
  status.textContent = data.caption ? `Uploaded — “${data.caption}”` : `Uploaded! ${fmtBytes(data.size)}`;
  // … existing reset + loadR2() …
} else {
  status.textContent = data.error || 'Upload failed';
  status.className = 'form-status err';
  toast(data.error || 'Upload failed', 'err');
  // Content-policy reject: token is spent server-side — reset so the
  // user can pick a different image without reloading.
  if (res.status === 422 && window.turnstile) turnstile.reset('#r2-turnstile');
}
```

### 4. Frontend — `public/style.css` (optional polish)

`.gallery-meta` already overlays text on hover. To let a longer caption wrap
instead of clipping:

```css
.gallery-meta { white-space: normal; line-height: 1.25; max-height: 60%; overflow: hidden; }
```

## Moderation — what LLaVA can and can't do

The combined-call approach is pragmatic but **not bulletproof**. Be honest
about what's shipped:

- **LLaVA-1.5-7B is not a purpose-built moderation model.** Expect both **false
  positives** (an innocent beach photo flagged) and **false negatives** (subtle
  offensive content waved through). It's defense in depth on top of Turnstile +
  the 500 KB cap — not a guarantee.
- **Production-grade moderation** would use a dedicated CSAM/NSFW classifier
  plus a human review queue. Workers AI does not ship one on the free tier today.
- **Fail-open by design.** A model timeout or unparseable response allows the
  upload through. Locking down would mean every Workers AI outage breaks
  uploads, which is the wrong trade for a demo. The primary abuse controls
  (Turnstile, size cap) still apply.
- **Adversarial inputs.** A determined attacker will find images LLaVA
  misclassifies. The 4-hour wipe limits dwell time on anything that slips through.
- **Generic user-facing reject reason.** The server returns a fixed string so
  the model's own description of the image can never echo back to the client.
  The `moderation_reject` event is logged to D1 for offline review.

## Edge cases & considerations

- **Model failure / cold model** — captioning + safety are wrapped in
  `try/catch`; on error the caption is empty, `rejected` stays `false`, and the
  upload still returns `201`.
- **Parse failure** — if LLaVA returns text without a `SAFE:` line, we treat it
  as safe and use whatever caption-like text we can pull out. Fail-open.
- **Latency** — LLaVA adds ~1–3 s to the upload. Acceptable synchronously for a
  demo. Moving to `ctx.waitUntil()` is incompatible with the safety check —
  rejection has to be synchronous, or the bytes will already be in R2.
- **Caption length** — trimmed to 256 chars to stay well under the R2
  customMetadata limit.
- **GIF/WebP** — LLaVA reads the first frame; usable for both caption and verdict.
- **Daily wipe** — no change. Captions live in object metadata and are deleted
  with the object.
- **Turnstile retry** — on `422`, the frontend resets the widget so the user
  can pick a different image without reloading.

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

1. **Safe image** — upload a benign photo → `201` with a non-empty `caption`;
   gallery shows the caption on hover; `<img alt>` carries it.
2. **Unsafe image** — upload something the model should flag → `422` with the
   generic policy error; **no** object in `/api/r2/list`; an analytics row
   appears with `event_type='moderation_reject'`, `feature='r2_upload'`.
3. **Retry after reject** — Turnstile widget resets automatically; user can
   pick a new image and try again without reloading.
4. **Model error / parse failure** — temporarily break the model ID → upload
   still returns `201` with `caption: ""` (fail-open).
5. `GET /api/r2/file/<key>` still serves the bytes (unaffected).
6. `GET /api/r2/list` → each user object has a `caption` field.

## Future enhancements

- **Search by caption** — mirror captions into a D1 column + `LIKE`/FTS, wired
  into the existing `/api/d1/search`.
- **Alt-text accessibility badge** — show that captions double as screen-reader text.
- **Caption on demand** — a "re-caption" button that calls a dedicated endpoint
  for an existing key.
- **Stricter moderation** — pair LLaVA with `@cf/meta/llama-guard-3-8b` on the
  caption text for a second, text-only safety pass.
- **Surface rejects in the dashboard** — add `moderation_reject` to the
  analytics card so the abuse-mitigation story is visible.
