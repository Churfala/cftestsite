const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestGet({ env }) {
  try {
    const listed = await env.BUCKET.list({ limit: 100 });
    const sorted = listed.objects.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));

    const total_bytes = sorted.reduce((s, o) => s + o.size, 0);

    const files = sorted.map(obj => ({
      key:      obj.key,
      size:     obj.size,
      uploaded: obj.uploaded,
      url:      `/api/r2/file/${encodeURIComponent(obj.key)}`,
      is_demo:  obj.key.startsWith('demo-'),
    }));

    return Response.json(
      { files, total_bytes, count: files.length, truncated: listed.truncated },
      { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' } }
    );
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
