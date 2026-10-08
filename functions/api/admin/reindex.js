const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Wipe-Secret',
};

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';

// (Re)build the Vectorize index from the posts table. Idempotent — upsert
// overwrites by id. Reuses the WIPE_SECRET so it's gated like /api/admin/wipe.
// Posts survive the daily wipe, so this only needs running once after setup
// (or after editing the posts).
export async function onRequestPost({ request, env }) {
  const secret = request.headers.get('X-Wipe-Secret');

  if (!env.WIPE_SECRET) {
    return Response.json({ error: 'WIPE_SECRET not configured' }, { status: 503, headers: CORS });
  }
  if (secret !== env.WIPE_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
  }
  if (!env.VECTORIZE || !env.AI) {
    return Response.json({ error: 'Vectorize or AI binding not configured' }, { status: 503, headers: CORS });
  }

  try {
    const { results: posts } = await env.DB.prepare(
      'SELECT id, title, content FROM posts ORDER BY id'
    ).all();

    if (!posts?.length) {
      return Response.json({ indexed: 0, note: 'No posts to index' }, { headers: CORS });
    }

    // Embed title + content together so search matches on both.
    const inputs = posts.map(p => `${p.title}. ${p.content}`);
    const emb    = await env.AI.run(EMBED_MODEL, { text: inputs });

    const vectors = posts.map((p, i) => ({
      id:       String(p.id),
      values:   emb.data[i],
      metadata: { title: p.title },
    }));

    const result = await env.VECTORIZE.upsert(vectors);

    return Response.json({
      indexed: vectors.length,
      mutation: result?.mutationId ?? null,
    }, { headers: CORS });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
