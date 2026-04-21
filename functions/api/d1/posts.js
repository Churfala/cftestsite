const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestGet({ env, request }) {
  const start = Date.now();
  try {
    const { results } = await env.DB.prepare(`
      SELECT
        p.id, p.title, p.content, p.category, p.author,
        p.view_count, p.created_at,
        GROUP_CONCAT(t.name, ',') AS tags
      FROM posts p
      LEFT JOIN post_tags pt ON pt.post_id = p.id
      LEFT JOIN tags      t  ON t.id = pt.tag_id
      GROUP BY p.id
      ORDER BY p.view_count DESC
    `).all();

    const query_ms = Date.now() - start;

    env.DB.prepare(
      'INSERT INTO analytics (event_type, feature, latency_ms, country) VALUES (?, ?, ?, ?)'
    ).bind('demo', 'd1_posts', query_ms, request.cf?.country ?? null)
     .run().catch(() => {});

    return Response.json(
      { posts: results, query_ms },
      { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } }
    );
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
