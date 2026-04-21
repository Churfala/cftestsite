const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestGet({ request, env }) {
  const cf  = request.cf || {};
  const start = Date.now();

  const data = {
    colo:           cf.colo           || '—',
    country:        cf.country        || '—',
    city:           cf.city           || '—',
    region:         cf.region         || '—',
    continent:      cf.continent      || '—',
    timezone:       cf.timezone       || '—',
    postalCode:     cf.postalCode     || '—',
    latitude:       cf.latitude       ?? null,
    longitude:      cf.longitude      ?? null,
    asn:            cf.asn            || null,
    asOrganization: cf.asOrganization || '—',
    httpProtocol:   cf.httpProtocol   || '—',
    tlsCipher:      cf.tlsCipher      || '—',
    tlsVersion:     cf.tlsVersion     || '—',
    ip:             request.headers.get('CF-Connecting-IP') || '—',
    latency_ms:     Date.now() - start,
  };

  env.DB.prepare(
    'INSERT INTO analytics (event_type, feature, latency_ms, country) VALUES (?, ?, ?, ?)'
  ).bind('demo', 'geo', data.latency_ms, cf.country ?? null)
   .run().catch(() => {});

  return Response.json(data, {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
  });
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
