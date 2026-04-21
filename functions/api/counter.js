const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestGet({ env, request }) {
  const start = Date.now();
  try {
    const [current, kvReadCount] = await Promise.all([
      env.KV.get('visit_count'),
      env.KV.get('kv_read_count'),
    ]);

    const count = (parseInt(current ?? '0')) + 1;
    const reads = (parseInt(kvReadCount ?? '0')) + 2; // 2 reads this request

    await Promise.all([
      env.KV.put('visit_count',   String(count)),
      env.KV.put('kv_read_count', String(reads)),
    ]);

    // Best-effort analytics
    env.DB.prepare(
      'INSERT INTO analytics (event_type, feature, latency_ms, country) VALUES (?, ?, ?, ?)'
    ).bind('page_view', 'counter', Date.now() - start, request.cf?.country ?? null)
     .run().catch(() => {});

    return Response.json(
      { count, kv_reads: reads, latency_ms: Date.now() - start },
      { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' } }
    );
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
