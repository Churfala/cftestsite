const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest({ env }) {
  const start = Date.now();
  try {
    const [msgRow, analyticsRow, visitCount, aiCount] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as n FROM messages').first(),
      env.DB.prepare('SELECT COUNT(*) as n FROM analytics').first(),
      env.KV.get('visit_count'),
      env.KV.get('ai_inference_count'),
    ]);

    const r2List = await env.BUCKET.list({ limit: 1000 });
    const r2Bytes = r2List.objects.reduce((s, o) => s + o.size, 0);

    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);

    return Response.json({
      requests_today:  parseInt(visitCount ?? '0'),
      d1_messages:     msgRow?.n ?? 0,
      d1_analytics:    analyticsRow?.n ?? 0,
      r2_objects:      r2List.objects.length,
      r2_bytes:        r2Bytes,
      ai_inferences:   parseInt(aiCount ?? '0'),
      ms_until_reset:  midnight - now,
      query_ms:        Date.now() - start,
    }, { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
