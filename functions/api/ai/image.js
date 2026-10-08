const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MODEL = '@cf/black-forest-labs/flux-1-schnell';

async function verifyTurnstile(token, secret, ip) {
  const form = new FormData();
  form.append('secret',   secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res  = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const data = await res.json();
  return data.success === true;
}

export async function onRequestPost({ env, request }) {
  const start = Date.now();
  try {
    if (!env.AI) {
      return Response.json({ error: 'Workers AI binding not configured', hint: 'Add an [ai] binding to wrangler.toml.' }, { status: 503, headers: CORS });
    }

    const body   = await request.json().catch(() => ({}));
    const prompt = String(body.prompt ?? '').trim().slice(0, 500);
    const save   = body.save === true;
    const turnstileToken = body.turnstileToken ?? null;

    if (!prompt) {
      return Response.json({ error: 'prompt is required' }, { status: 400, headers: CORS });
    }

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

    // FLUX.1 [schnell] — fast distilled text-to-image. Returns base64 JPEG.
    const result = await env.AI.run(MODEL, { prompt, steps: 6 });
    const b64    = result.image ?? result.result?.image;
    if (!b64) {
      return Response.json({ error: 'Model returned no image' }, { status: 502, headers: CORS });
    }

    const inference_ms = Date.now() - start;

    env.DB?.prepare(
      'INSERT INTO analytics (event_type, feature, latency_ms, country) VALUES (?, ?, ?, ?)'
    ).bind('inference', 'image_ai', inference_ms, request.cf?.country ?? null)
     .run().catch(() => {});

    // Optional: persist into the R2 gallery (same upload- prefix so the wipe clears it)
    let saved = null;
    if (save && env.BUCKET) {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const key   = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.jpg`;
      await env.BUCKET.put(key, bytes, {
        httpMetadata:   { contentType: 'image/jpeg', cacheControl: 'public, max-age=86400' },
        customMetadata: { caption: `AI-generated: ${prompt}`.slice(0, 256) },
      });
      saved = { key, url: `/api/r2/file/${encodeURIComponent(key)}` };
    }

    return Response.json({
      prompt,
      dataURI: `data:image/jpeg;base64,${b64}`,
      model:   MODEL,
      inference_ms,
      saved,
    }, { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' } });
  } catch (e) {
    return Response.json({
      error: e.message,
      hint:  'Workers AI must be enabled on your Cloudflare account. Image generation draws on the daily free Neuron allowance.',
    }, { status: 503, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
