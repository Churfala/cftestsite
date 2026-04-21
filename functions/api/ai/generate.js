const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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
    const body = await request.json().catch(() => ({}));
    const prompt         = String(body.prompt ?? '').trim().slice(0, 500);
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

    const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Be concise.' },
        { role: 'user',   content: prompt },
      ],
      max_tokens: 512,
    });

    const inference_ms = Date.now() - start;

    const count = parseInt(await env.KV.get('ai_inference_count') ?? '0') + 1;
    await env.KV.put('ai_inference_count', String(count));

    env.DB.prepare(
      'INSERT INTO analytics (event_type, feature, latency_ms, country) VALUES (?, ?, ?, ?)'
    ).bind('inference', 'workers_ai', inference_ms, request.cf?.country ?? null)
     .run().catch(() => {});

    return Response.json({
      prompt,
      response:     result.response ?? result.result?.response ?? '(no response)',
      model:        '@cf/meta/llama-3.1-8b-instruct',
      inference_ms,
      total_runs:   count,
    }, { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' } });
  } catch (e) {
    return Response.json({
      error: e.message,
      hint:  'Workers AI must be enabled on your Cloudflare account. It is free in beta.',
    }, { status: 503, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
