/**
 * GET /api/r2/file/:key
 * Retrieves and streams an object from R2.
 * Binding required: BUCKET (R2 bucket)
 */
export async function onRequest({ params, env }) {
  const key    = decodeURIComponent(params.key);
  const object = await env.BUCKET.get(key);

  if (!object) {
    return new Response('Not Found', { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag',          object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');

  return new Response(object.body, { headers });
}
