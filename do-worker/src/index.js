// Standalone "compute" Worker for the cftestsite showcase.
//
// Durable Object classes, Workflows, and the Browser Rendering binding cannot
// live inside a Pages project, so they live here and the Pages Functions reach
// them through a service binding (COMPUTE) plus the Durable Object binding.
//
// Deploy:  cd do-worker && npx wrangler deploy
// Bindings (see wrangler.toml): LIVE_COUNTER (DO), DEMO_WORKFLOW, BROWSER.

import { DurableObject, WorkflowEntrypoint } from 'cloudflare:workers';

/* ── Durable Object: strongly-consistent counter ─────────────────────────── */
export class LiveCounter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)'
    );
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO counter (id, n) VALUES (1, 0)');
  }
  #read() {
    return this.ctx.storage.sql.exec('SELECT n FROM counter WHERE id = 1').one().n;
  }
  async value() {
    return this.#read();
  }
  async increment() {
    this.ctx.storage.sql.exec('UPDATE counter SET n = n + 1 WHERE id = 1');
    return this.#read();
  }
}

/* ── Workflow: durable, multi-step, with retries + sleeps ─────────────────── */
export class DemoWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const validated = await step.do('validate request', async () => ({ ok: true }));

    // Durable pause — the instance hibernates and resumes later.
    await step.sleep('queue delay', '3 seconds');

    const enriched = await step.do(
      'enrich data',
      { retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' } },
      async () => ({ score: Math.floor(Math.random() * 100) })
    );

    await step.sleep('processing delay', '4 seconds');

    const report = await step.do('finalize report', async () => ({
      summary: `Report ready — quality score ${enriched.score}/100`,
    }));

    return { validated: validated.ok, score: enriched.score, summary: report.summary };
  }
}

/* ── Router (reached via the Pages COMPUTE service binding) ───────────────── */
export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    // Browser Run — capture a screenshot of a URL
    if (path === '/browser/screenshot' && request.method === 'POST') {
      const { target } = await request.json().catch(() => ({}));
      let safe;
      try { safe = new URL(String(target)); } catch { return json({ error: 'Invalid URL' }, 400); }
      if (safe.protocol !== 'http:' && safe.protocol !== 'https:') {
        return json({ error: 'Only http(s) URLs are allowed' }, 400);
      }
      try {
        const shot = await env.BROWSER.quickAction('screenshot', {
          url: safe.toString(),
          viewport: { width: 1280, height: 800 },
        });
        const buf = await shot.arrayBuffer();
        return json({
          dataURI: `data:image/png;base64,${base64(buf)}`,
          bytes:   buf.byteLength,
          browser_ms: Number(shot.headers.get('X-Browser-Ms-Used')) || null,
        });
      } catch (e) {
        return json({ error: e.message, hint: 'Browser Run free tier allows 10 min/day.' }, 503);
      }
    }

    // Workflows — start an instance
    if (path === '/workflow' && request.method === 'POST') {
      const instance = await env.DEMO_WORKFLOW.create();
      return json({ id: instance.id });
    }

    // Workflows — poll instance status
    if (path === '/workflow' && request.method === 'GET') {
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'id required' }, 400);
      const instance = await env.DEMO_WORKFLOW.get(id);
      const s = await instance.status();
      return json({ id, status: s.status, output: s.output ?? null });
    }

    return new Response('cftestsite compute worker', { headers: { 'content-type': 'text/plain' } });
  },
};

function json(obj, status = 200) {
  return Response.json(obj, { status });
}

// Base64 a binary buffer without blowing the call stack on large screenshots.
function base64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
