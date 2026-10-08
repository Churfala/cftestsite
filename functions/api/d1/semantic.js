const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';

export async function onRequestGet({ request, env }) {
  const url   = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();

  if (!query || query.length < 2) {
    return Response.json({ error: 'q must be at least 2 characters' }, { status: 400, headers: CORS });
  }
  if (query.length > 100) {
    return Response.json({ error: 'q must be under 100 characters' }, { status: 400, headers: CORS });
  }

  // Degrade gracefully when the index or AI binding isn't provisioned yet.
  if (!env.VECTORIZE || !env.AI) {
    return Response.json({
      not_configured: true,
      message: 'Semantic search needs a Vectorize index. See the setup steps in the README, then POST /api/admin/reindex to seed it.',
    }, { headers: CORS });
  }

  try {
    const start = Date.now();

    // 1. Embed the query, 2. nearest-neighbour search, 3. hydrate from D1.
    const emb = await env.AI.run(EMBED_MODEL, { text: [query] });
    const vector = emb.data?.[0];
    if (!vector) {
      return Response.json({ error: 'Failed to embed query' }, { status: 502, headers: CORS });
    }

    const matches = await env.VECTORIZE.query(vector, { topK: 5, returnMetadata: true });
    const hits    = matches.matches ?? [];

    if (!hits.length) {
      return Response.json({
        query, total: 0, posts: [],
        query_ms: Date.now() - start,
        hint: 'Index is empty — POST /api/admin/reindex to seed it from the posts table.',
      }, { headers: CORS });
    }

    // Hydrate the matched post rows from D1, preserving the similarity order.
    const ids  = hits.map(h => h.id);
    const ph   = ids.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT id, title, content, category, author, view_count FROM posts WHERE id IN (${ph})`
    ).bind(...ids).all();

    const byId  = new Map((rows.results ?? []).map(r => [String(r.id), r]));
    const posts = hits
      .map(h => { const p = byId.get(String(h.id)); return p ? { ...p, score: h.score } : null; })
      .filter(Boolean);

    const query_ms = Date.now() - start;

    env.DB.prepare(
      'INSERT INTO analytics (event_type, feature, latency_ms, country) VALUES (?, ?, ?, ?)'
    ).bind('search', 'vectorize_search', query_ms, request.cf?.country ?? null)
     .run().catch(() => {});

    return Response.json({
      query, posts, total: posts.length, query_ms,
    }, { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return Response.json({
      error: e.message,
      hint:  'Ensure the Vectorize index exists (768 dims, cosine) and has been seeded via /api/admin/reindex.',
    }, { status: 503, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
