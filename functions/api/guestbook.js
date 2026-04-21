const POSITIVE = new Set(['good','great','love','awesome','amazing','excellent','fantastic','brilliant','superb','fast','free','easy','perfect','best','cool','nice','impressive','incredible','insane','zero','instant','powerful','clean','simple','smart','efficient','happy','glad','thanks','thank','wow','incredible','solid','smooth','useful','helpful','works','worked','changed']);
const NEGATIVE = new Set(['bad','slow','awful','terrible','horrible','broken','hate','worst','useless','ugly','poor','difficult','hard','pain','fail','failed','error','bug','issue','problem','ugly','disappointing','disappointed','frustrating','frustration','confusing','confused','missing','lacking','expensive','costly']);

function analyseSentiment(text) {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
  let score = 0;
  for (const w of words) {
    if (POSITIVE.has(w)) score++;
    if (NEGATIVE.has(w)) score--;
  }
  return score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB
      .prepare('SELECT id, name, message, country, city, sentiment, word_count, created_at FROM messages ORDER BY created_at DESC LIMIT 30')
      .all();
    return Response.json(results, { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: CORS });
  }
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: CORS });
  }

  const { name, message, turnstileToken } = body ?? {};

  if (
    typeof name    !== 'string' || !name.trim()    || name.trim().length    > 50  ||
    typeof message !== 'string' || !message.trim() || message.trim().length > 500
  ) {
    return Response.json({ error: 'name (1–50 chars) and message (1–500 chars) required' }, { status: 400, headers: CORS });
  }

  // Verify Turnstile — skip in dev if secret not configured
  const secret = env.TURNSTILE_SECRET_KEY;
  if (secret && secret !== '1x0000000000000000000000000000000AA') {
    if (!turnstileToken) {
      return Response.json({ error: 'Turnstile token required' }, { status: 400, headers: CORS });
    }
    const ip   = request.headers.get('CF-Connecting-IP') ?? undefined;
    const ok   = await verifyTurnstile(turnstileToken, secret, ip);
    if (!ok) {
      return Response.json({ error: 'Turnstile verification failed' }, { status: 403, headers: CORS });
    }
  }

  const cf        = request.cf ?? {};
  const trimName  = name.trim();
  const trimMsg   = message.trim();
  const wordCount = trimMsg.split(/\s+/).filter(Boolean).length;
  const sentiment = analyseSentiment(trimMsg);

  await env.DB
    .prepare('INSERT INTO messages (name, message, country, city, sentiment, word_count) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(trimName, trimMsg, cf.country ?? null, cf.city ?? null, sentiment, wordCount)
    .run();

  return Response.json({ success: true }, { status: 201, headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
