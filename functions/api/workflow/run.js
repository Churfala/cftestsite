const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const NOT_CONFIGURED = {
  not_configured: true,
  message: 'Workflows need the compute Worker + COMPUTE service binding. See README step 11.',
};

// Start a Workflow instance.
export async function onRequestPost({ env, request }) {
  if (!env.COMPUTE) return Response.json(NOT_CONFIGURED, { headers: CORS });
  try {
    const res  = await env.COMPUTE.fetch('https://compute/workflow', { method: 'POST' });
    const data = await res.json();

    env.DB?.prepare(
      'INSERT INTO analytics (event_type, feature, country) VALUES (?, ?, ?)'
    ).bind('start', 'workflows', request.cf?.country ?? null)
     .run().catch(() => {});

    return Response.json(data, { status: res.status, headers: { ...CORS, 'Cache-Control': 'no-cache' } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 503, headers: CORS });
  }
}

// Poll a Workflow instance's status: /api/workflow/run?id=<instanceId>
export async function onRequestGet({ env, request }) {
  if (!env.COMPUTE) return Response.json(NOT_CONFIGURED, { headers: CORS });
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: CORS });
  try {
    const res = await env.COMPUTE.fetch(`https://compute/workflow?id=${encodeURIComponent(id)}`);
    return new Response(res.body, { status: res.status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 503, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
