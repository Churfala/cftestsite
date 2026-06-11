const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Wipe-Secret',
};

const SEED_MESSAGES = [
  { name: 'Sarah Chen',    message: 'Just deployed my first Worker — zero cold starts is no joke. This is how edge computing should work.',         country: 'US', city: 'San Francisco', sentiment: 'positive', word_count: 19 },
  { name: 'Markus Weber',  message: 'The KV store latency is insane. Sub-5ms reads globally. My Redis bill is going to zero.',                       country: 'DE', city: 'Berlin',        sentiment: 'positive', word_count: 17 },
  { name: 'Priya Patel',   message: 'D1 SQLite at the edge? I did not think I needed this until I tried it. My API is now 3× faster.',               country: 'IN', city: 'Mumbai',        sentiment: 'positive', word_count: 22 },
  { name: 'James O\'Brien','message': 'R2 with zero egress fees changed the economics of file storage for my startup completely.',                    country: 'IE', city: 'Dublin',        sentiment: 'positive', word_count: 15 },
  { name: 'Yuki Tanaka',   message: 'Workers AI is impressive for a free tier offering. Ran Llama 3 inference in under 2 seconds from Tokyo.',       country: 'JP', city: 'Tokyo',         sentiment: 'positive', word_count: 18 },
];

const DEMO_IMAGES = [
  // SVG tiles can't go through LLaVA (raster only) — captions are hand-written
  {
    key:     'demo-workers.svg',
    content: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#F6821F"/><text x="200" y="140" text-anchor="middle" fill="white" font-size="28" font-family="monospace" font-weight="bold">Workers</text><text x="200" y="180" text-anchor="middle" fill="rgba(255,255,255,0.8)" font-size="14" font-family="monospace">V8 Isolates · Zero Cold Start</text><text x="200" y="210" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-size="12" font-family="monospace">100,000 req/day free</text></svg>',
    type:    'image/svg+xml',
    caption: 'Orange Cloudflare Workers demo tile — V8 isolates, zero cold starts.',
  },
  {
    key:     'demo-d1.svg',
    content: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#8B5CF6"/><text x="200" y="140" text-anchor="middle" fill="white" font-size="28" font-family="monospace" font-weight="bold">D1 Database</text><text x="200" y="180" text-anchor="middle" fill="rgba(255,255,255,0.8)" font-size="14" font-family="monospace">SQLite · 5M reads/day</text><text x="200" y="210" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-size="12" font-family="monospace">5GB storage free</text></svg>',
    type:    'image/svg+xml',
    caption: 'Purple D1 demo tile — serverless SQLite at the edge.',
  },
  {
    key:     'demo-r2.svg',
    content: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#10B981"/><text x="200" y="140" text-anchor="middle" fill="white" font-size="28" font-family="monospace" font-weight="bold">R2 Storage</text><text x="200" y="180" text-anchor="middle" fill="rgba(255,255,255,0.8)" font-size="14" font-family="monospace">S3-Compatible · Zero Egress</text><text x="200" y="210" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-size="12" font-family="monospace">10GB · 1M ops/month free</text></svg>',
    type:    'image/svg+xml',
    caption: 'Green R2 demo tile — S3-compatible storage, zero egress.',
  },
];

export async function onRequestPost({ request, env }) {
  const secret = request.headers.get('X-Wipe-Secret');

  if (!env.WIPE_SECRET) {
    return Response.json({ error: 'WIPE_SECRET not configured' }, { status: 503, headers: CORS });
  }
  if (secret !== env.WIPE_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
  }

  try {
    const wiped_at = new Date().toISOString();

    // 1. Clear user-generated D1 data
    await env.DB.batch([
      env.DB.prepare('DELETE FROM messages'),
      env.DB.prepare('DELETE FROM analytics'),
    ]);

    // 2. Re-seed messages
    const stmt = env.DB.prepare(
      'INSERT INTO messages (name, message, country, city, sentiment, word_count) VALUES (?, ?, ?, ?, ?, ?)'
    );
    await env.DB.batch(
      SEED_MESSAGES.map(m => stmt.bind(m.name, m.message, m.country, m.city, m.sentiment, m.word_count))
    );

    // 3. Delete user-uploaded R2 objects (keep demo- prefix objects)
    const listed = await env.BUCKET.list({ prefix: 'upload-', limit: 1000 });
    if (listed.objects.length > 0) {
      await Promise.all(listed.objects.map(obj => env.BUCKET.delete(obj.key)));
    }

    // 4. Re-seed demo R2 images
    await Promise.all(
      DEMO_IMAGES.map(img =>
        env.BUCKET.put(img.key, img.content, {
          httpMetadata:   { contentType: img.type, cacheControl: 'public, max-age=86400' },
          customMetadata: { caption: img.caption },
        })
      )
    );

    // 5. Reset daily KV counters (keep total visit count)
    await Promise.all([
      env.KV.put('ai_inference_count', '0'),
      env.KV.put('kv_read_count',      '0'),
      env.KV.put('last_wipe',          wiped_at),
      env.KV.delete('cached_d1_stats'), // invalidate KV cache
    ]);

    return Response.json({
      success:        true,
      wiped_at,
      messages_seeded: SEED_MESSAGES.length,
      r2_deleted:     listed.objects.length,
      r2_seeded:      DEMO_IMAGES.length,
    }, { headers: CORS });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
