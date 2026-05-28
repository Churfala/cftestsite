const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_BYTES     = 500 * 1024; // 500 KB — intentionally tight for the demo

async function verifyTurnstile(token, secret, ip) {
  const form = new FormData();
  form.append('secret',   secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res  = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const data = await res.json();
  return data.success === true;
}

export async function onRequestPost({ request, env }) {
  let formData;
  try { formData = await request.formData(); } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400, headers: CORS });
  }

  const file            = formData.get('file');
  const turnstileToken  = formData.get('turnstileToken');

  if (!file || typeof file.arrayBuffer !== 'function') {
    return Response.json({ error: 'No file provided' }, { status: 400, headers: CORS });
  }

  // Verify Turnstile — skip in dev if secret not configured
  const secret = env.TURNSTILE_SECRET_KEY;
  if (secret && secret !== '1x0000000000000000000000000000000AA') {
    if (!turnstileToken) {
      return Response.json({ error: 'Turnstile token required' }, { status: 400, headers: CORS });
    }
    const ip = request.headers.get('CF-Connecting-IP') ?? undefined;
    const ok = await verifyTurnstile(turnstileToken, secret, ip);
    if (!ok) {
      return Response.json({ error: 'Turnstile verification failed' }, { status: 403, headers: CORS });
    }
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return Response.json({ error: 'Only JPEG, PNG, GIF, and WebP allowed' }, { status: 400, headers: CORS });
  }

  // Server-side size check (read the bytes to get true size)
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) {
    return Response.json({ error: `File exceeds ${MAX_BYTES / 1024}KB limit` }, { status: 400, headers: CORS });
  }

  const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
  // Prefix with "upload-" so the daily wipe can selectively delete user content
  const key = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;

  // Vision AI — combined safety check + caption in one LLaVA call.
  // Fails open: a model or parse error allows the upload through (Turnstile +
  // size cap remain the primary controls).
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
    // Best-effort analytics — surfaces in the dashboard's event counts
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
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
