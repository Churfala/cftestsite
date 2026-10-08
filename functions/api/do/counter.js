const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const NOT_CONFIGURED = {
  not_configured: true,
  message: 'Durable Objects counter needs the do-worker deployed and bound. See README step 10.',
};

// One globally-unique object coordinates the count. idFromName keeps every
// request routed to the same instance worldwide.
function stub(env) {
  return env.LIVE_COUNTER.get(env.LIVE_COUNTER.idFromName('global'));
}

export async function onRequestGet({ env }) {
  if (!env.LIVE_COUNTER) return Response.json(NOT_CONFIGURED, { headers: CORS });
  try {
    const count = await stub(env).value();
    return Response.json({ count }, { headers: { ...CORS, 'Cache-Control': 'no-cache' } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 503, headers: CORS });
  }
}

export async function onRequestPost({ env, request }) {
  if (!env.LIVE_COUNTER) return Response.json(NOT_CONFIGURED, { headers: CORS });
  try {
    const count = await stub(env).increment();

    env.DB?.prepare(
      'INSERT INTO analytics (event_type, feature, country) VALUES (?, ?, ?)'
    ).bind('increment', 'durable_objects', request.cf?.country ?? null)
     .run().catch(() => {});

    return Response.json({ count }, { headers: { ...CORS, 'Cache-Control': 'no-cache' } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 503, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
