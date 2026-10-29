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
  // Degrade gracefully when the compute Worker isn't bound yet.
  if (!env.COMPUTE) {
    return Response.json({
      not_configured: true,
      message: 'Browser Run needs the compute Worker + COMPUTE service binding. See README step 11.',
    }, { headers: CORS });
  }

  const start = Date.now();
  const body  = await request.json().catch(() => ({}));
  const url   = String(body.url ?? '').trim().slice(0, 300);
  const turnstileToken = body.turnstileToken ?? null;

  if (!url) {
    return Response.json({ error: 'url is required' }, { status: 400, headers: CORS });
  }

  // Turnstile-gate — browser time is the scarce free resource (10 min/day).
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

  try {
    const res = await env.COMPUTE.fetch('https://compute/browser/screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: url }),
    });
    const data = await res.json();
    if (!res.ok) {
      return Response.json(data, { status: res.status, headers: CORS });
    }

    env.DB?.prepare(
      'INSERT INTO analytics (event_type, feature, latency_ms, country) VALUES (?, ?, ?, ?)'
    ).bind('render', 'browser_run', Date.now() - start, request.cf?.country ?? null)
     .run().catch(() => {});

    return Response.json(data, { headers: { ...CORS, 'Cache-Control': 'no-cache' } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 503, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
