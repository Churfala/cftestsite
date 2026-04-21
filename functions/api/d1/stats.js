const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestGet({ env, request }) {
  const start = Date.now();
  try {
    const [summary, countries, categories, migration, analytics] = await Promise.all([
      env.DB.prepare(`
        SELECT
          COUNT(*)                                                    AS total_messages,
          COUNT(CASE WHEN date(created_at) = date('now') THEN 1 END) AS today_messages,
          ROUND(AVG(word_count), 1)                                   AS avg_word_count,
          COUNT(DISTINCT country)                                     AS unique_countries,
          COUNT(CASE WHEN sentiment = 'positive' THEN 1 END)         AS positive,
          COUNT(CASE WHEN sentiment = 'neutral'  THEN 1 END)         AS neutral,
          COUNT(CASE WHEN sentiment = 'negative' THEN 1 END)         AS negative
        FROM messages
      `).first(),

      env.DB.prepare(`
        SELECT country, COUNT(*) AS count
        FROM messages
        WHERE country IS NOT NULL
        GROUP BY country
        ORDER BY count DESC
        LIMIT 8
      `).all(),

      env.DB.prepare(`
        SELECT category, COUNT(*) AS count, SUM(view_count) AS total_views
        FROM posts
        GROUP BY category
        ORDER BY count DESC
      `).all(),

      env.DB.prepare(
        'SELECT MAX(version) AS version, MAX(applied_at) AS applied_at FROM schema_migrations'
      ).first(),

      env.DB.prepare(`
        SELECT feature, COUNT(*) AS events
        FROM analytics
        WHERE date(created_at) = date('now')
        GROUP BY feature
        ORDER BY events DESC
      `).all(),
    ]);

    const query_ms = Date.now() - start;

    env.DB.prepare(
      'INSERT INTO analytics (event_type, feature, latency_ms, country) VALUES (?, ?, ?, ?)'
    ).bind('demo', 'd1_stats', query_ms, request.cf?.country ?? null)
     .run().catch(() => {});

    return Response.json({
      summary,
      countries:         countries.results,
      categories:        categories.results,
      analytics_today:   analytics.results,
      migration_version: migration?.version ?? 0,
      migration_date:    migration?.applied_at ?? null,
      query_ms,
    }, { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
