const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const CACHE_KEY = 'cached_d1_stats';
const CACHE_TTL = 60; // seconds

export async function onRequestGet({ env, request }) {
  // Step 1 — attempt KV read
  const kvStart  = Date.now();
  const cached   = await env.KV.get(CACHE_KEY, 'json');
  const kv_read_ms = Date.now() - kvStart;

  // Increment KV read counter
  const reads = parseInt(await env.KV.get('kv_read_count') ?? '0') + 1;
  env.KV.put('kv_read_count', String(reads)).catch(() => {});

  if (cached) {
    env.DB.prepare(
      'INSERT INTO analytics (event_type, feature, latency_ms, country) VALUES (?, ?, ?, ?)'
    ).bind('cache_hit', 'kv_cache', kv_read_ms, request.cf?.country ?? null)
     .run().catch(() => {});

    return Response.json({
      status:       'HIT',
      data:         cached,
      kv_read_ms,
      d1_query_ms:  null,
      total_ms:     kv_read_ms,
      expires_in:   '≤60s',
    }, { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' } });
  }

  // Step 2 — cache miss, query D1
  const d1Start = Date.now();
  const stats   = await env.DB.prepare(`
    SELECT
      COUNT(*)                                                    AS total_messages,
      COUNT(CASE WHEN date(created_at) = date('now') THEN 1 END) AS today_messages,
      ROUND(AVG(NULLIF(word_count, 0)), 1)                       AS avg_word_count,
      COUNT(DISTINCT country)                                     AS unique_countries,
      (SELECT COUNT(*) FROM posts)                               AS total_posts,
      (SELECT MAX(version) FROM schema_migrations)               AS schema_version
    FROM messages
  `).first();
  const d1_query_ms = Date.now() - d1Start;

  // Populate KV cache
  await env.KV.put(CACHE_KEY, JSON.stringify(stats), { expirationTtl: CACHE_TTL });

  env.DB.prepare(
    'INSERT INTO analytics (event_type, feature, latency_ms, country) VALUES (?, ?, ?, ?)'
  ).bind('cache_miss', 'kv_cache', kv_read_ms + d1_query_ms, request.cf?.country ?? null)
   .run().catch(() => {});

  return Response.json({
    status:      'MISS',
    data:        stats,
    kv_read_ms,
    d1_query_ms,
    total_ms:    kv_read_ms + d1_query_ms,
    expires_in:  `${CACHE_TTL}s`,
  }, { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' } });
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
