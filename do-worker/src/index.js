// Standalone Worker that defines the LiveCounter Durable Object.
//
// Durable Object classes cannot be defined inside a Pages project, so this
// lives in its own Worker. Deploy it (`cd do-worker && npx wrangler deploy`),
// then bind it from the main Pages project's wrangler.toml with:
//   [[durable_objects.bindings]]
//   name = "LIVE_COUNTER"
//   class_name = "LiveCounter"
//   script_name = "cftestsite-do"
//
// The Pages Function at /api/do/counter calls the RPC methods below.

import { DurableObject } from 'cloudflare:workers';

export class LiveCounter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // SQLite storage backend — the only backend available on the free tier.
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)'
    );
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO counter (id, n) VALUES (1, 0)');
  }

  #read() {
    return this.ctx.storage.sql.exec('SELECT n FROM counter WHERE id = 1').one().n;
  }

  // RPC: read the current count (strongly consistent — read-your-writes).
  async value() {
    return this.#read();
  }

  // RPC: atomic increment. The object is single-threaded, so concurrent
  // callers are serialized — no lost updates.
  async increment() {
    this.ctx.storage.sql.exec('UPDATE counter SET n = n + 1 WHERE id = 1');
    return this.#read();
  }
}

export default {
  async fetch() {
    return new Response('cftestsite LiveCounter DO worker — bind it to the Pages project.', {
      headers: { 'content-type': 'text/plain' },
    });
  },
};
