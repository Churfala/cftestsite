const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestGet({ request, env }) {
  const url   = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();

  if (!query || query.length < 2) {
    return Response.json({ error: 'q must be at least 2 characters' }, { status: 400, headers: CORS });
  }
  if (query.length > 100) {
    return Response.json({ error: 'q must be under 100 characters' }, { status: 400, headers: CORS });
  }

  const start   = Date.now();
  // Use LIKE for portable substring search (FTS5 requires a virtual table — add in v4 migration if needed)
  const pattern = `%${query.replace(/[%_]/g, '\\$&')}%`;

  const [messages, posts] = await Promise.all([
    env.DB.prepare(`
      SELECT id, name, message, country, city, created_at, 'message' AS type
      FROM messages
      WHERE message LIKE ? ESCAPE '\\'  OR name LIKE ? ESCAPE '\\'
      ORDER BY created_at DESC
      LIMIT 10
    `).bind(pattern, pattern).all(),

    env.DB.prepare(`
      SELECT p.id, p.title, p.content, p.category, p.author, p.view_count, 'post' AS type,
             GROUP_CONCAT(t.name, ',') AS tags
      FROM posts p
      LEFT JOIN post_tags pt ON pt.post_id = p.id
      LEFT JOIN tags      t  ON t.id = pt.tag_id
      WHERE p.title LIKE ? ESCAPE '\\' OR p.content LIKE ? ESCAPE '\\'
      GROUP BY p.id
      ORDER BY p.view_count DESC
      LIMIT 10
    `).bind(pattern, pattern).all(),
  ]);

  const query_ms = Date.now() - start;

  env.DB.prepare(
    'INSERT INTO analytics (event_type, feature, latency_ms, country) VALUES (?, ?, ?, ?)'
  ).bind('search', 'd1_search', query_ms, request.cf?.country ?? null)
   .run().catch(() => {});

  return Response.json({
    query,
    messages: messages.results,
    posts:    posts.results,
    total:    messages.results.length + posts.results.length,
    query_ms,
  }, { headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
