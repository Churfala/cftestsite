# Cloudflare Free Tier Showcase

A live infrastructure demo site running entirely on Cloudflare's free tier.
Demonstrates Pages, Workers, D1, KV, R2, Workers AI, and Turnstile — no credit card required.

## What it demonstrates

| Service | Feature demoed |
|---------|---------------|
| **Pages** | Static assets served from the global CDN |
| **Workers (Functions)** | API routes, edge request metadata, scheduled wipe |
| **D1 SQLite** | Multi-table schema, aggregate queries, full-text search, schema migrations |
| **Workers KV** | Global visit counter, edge caching with HIT/MISS timing |
| **R2 Object Storage** | Image upload with AI captioning, serving, and listing — zero egress fees |
| **Workers AI** | Llama 3.1 8B text inference; LLaVA 1.5 7B vision — captions and safety-screens every R2 upload |
| **Turnstile** | Privacy-preserving CAPTCHA gating all write operations |

### Abuse mitigation

- **Periodic wipe** — `POST /api/admin/wipe` clears user-submitted messages, analytics events, and user-uploaded R2 objects every 4 hours, then re-seeds with demo data. Configure as a cron via the Cloudflare dashboard (see below).
- **Turnstile** — gates the guestbook POST and R2 upload endpoints.
- **Server-side validation** — R2 uploads capped at 500KB, MIME type enforced.
- **AI content moderation** — a vision model (LLaVA via Workers AI) screens every R2 upload; images flagged as offensive are rejected with a 422 before reaching storage. Fails open on model error — Turnstile and the size cap remain the primary controls. See [docs/vision-ai-captions.md](docs/vision-ai-captions.md).
- **AI endpoint Turnstile-gated** — prevents automated quota exhaustion; prompt length capped at 500 characters server-side.

---

## Project structure

```
functions/
  api/
    stats.js          GET  /api/stats          — aggregate stats for the dashboard
    geo.js            GET  /api/geo            — edge metadata (request.cf)
    counter.js        GET  /api/counter        — KV visit counter
    guestbook.js      GET  /api/guestbook      — D1 messages (Turnstile-gated POST)
    d1/
      stats.js        GET  /api/d1/stats       — aggregate queries, GROUP BY
      search.js       GET  /api/d1/search      — LIKE full-text search
      posts.js        GET  /api/d1/posts       — posts with tag JOINs
    kv/
      cache.js        GET  /api/kv/cache       — KV cache hit/miss demo
    ai/
      generate.js     POST /api/ai/generate    — Workers AI (Llama 3.1 8B)
    r2/
      upload.js       POST /api/r2/upload      — R2 upload (Turnstile-gated, AI-captioned + moderated)
      list.js         GET  /api/r2/list        — R2 object listing
      file/[key].js   GET  /api/r2/file/:key   — R2 object serve
    admin/
      wipe.js         POST /api/admin/wipe     — daily wipe + re-seed (secret-gated)
public/
  index.html          Single-page dashboard UI
  app.js              Frontend JavaScript
  style.css           Dark ops-aesthetic theme
  _headers            Security headers (CSP, CORS)
schema.sql            D1 schema + seed data
wrangler.toml         Cloudflare bindings config
```

---

## Deploy

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
- Node.js 18+
- Wrangler CLI: `npm i -g wrangler`

### 1 — Authenticate

```bash
wrangler login
```

### 2 — Create Cloudflare resources

```bash
# D1 database
wrangler d1 create cftestsite-db

# KV namespace
wrangler kv namespace create KV

# R2 bucket
wrangler r2 bucket create cftestsite-bucket
```

Copy the IDs printed by each command into `wrangler.toml`.

### 3 — Apply the database schema

```bash
npx wrangler d1 execute cftestsite-db --remote --file=schema.sql
```

> **Note:** If you prefer not to use the CLI, you can apply the schema one statement at a time via the D1 console in the Cloudflare dashboard — the console only executes one statement per run.

### 4 — Get a Turnstile site key

1. Go to [Cloudflare Dashboard → Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile)
2. Add site → choose **Invisible** or **Managed**
3. Copy the **Site Key** and replace `1x00000000000000000000AA` in both `<div class="cf-turnstile">` elements in `public/index.html`
4. Copy the **Secret Key** — you will add it as a Pages secret in step 6

### 5 — Deploy to Pages

```bash
npx wrangler pages deploy public --project-name <your-project-name>
```

Or connect your GitHub repo in the Cloudflare dashboard (**Workers & Pages → Create → Connect to Git**) for automatic deploys on push with no CLI needed.

### 6 — Set secrets in the Pages dashboard

Go to **Cloudflare Dashboard → Pages → \<your-project\> → Settings → Environment Variables** and add:

| Variable | Value |
|----------|-------|
| `TURNSTILE_SECRET_KEY` | Your Turnstile secret key |
| `WIPE_SECRET` | Any random string (e.g. `openssl rand -hex 32`) |

Mark both as **Secret** (encrypted).

### 7 — Configure the daily wipe cron

The `/api/admin/wipe` endpoint performs the periodic reset. It needs to be called on a schedule.

> **Note:** Cloudflare Pages Functions do not support cron triggers — that feature is only available on standalone Workers. Use one of the options below instead.

**Option A — cron-job.org (simplest, free)**

1. Create a free account at [cron-job.org](https://cron-job.org)
2. Create a new cronjob:
   - **URL:** `https://<your-domain>/api/admin/wipe`
   - **Schedule:** every 4 hours (`0 */4 * * *`)
   - **Request method:** POST
   - **Request header:** `X-Wipe-Secret: <your WIPE_SECRET>`

**Option B — Standalone Cloudflare Worker with cron**

Create a separate Worker with:

```javascript
export default {
  async scheduled(event, env, ctx) {
    await fetch('https://<your-domain>/api/admin/wipe', {
      method: 'POST',
      headers: { 'X-Wipe-Secret': env.WIPE_SECRET }
    });
  }
};
```

To set this up via the dashboard (no CLI needed):

1. Go to **Workers & Pages → Create → Start with Hello World**
2. Name it `<your-project>-cron`, click **Deploy**
3. Click **Edit code**, replace everything with the code above, click **Deploy**
4. Go to **Settings → Variables**, add `WIPE_SECRET` as an encrypted environment variable
5. Go to **Settings → Triggers → Cron Triggers**, add `0 */4 * * *`, save

### 8 — Seed demo R2 images

After deploying, trigger the wipe endpoint once to populate the demo images:

```bash
curl -X POST https://<your-domain>/api/admin/wipe -H "X-Wipe-Secret: <your WIPE_SECRET>"
```

---

## Local development

```bash
npm install
npm run dev
# → http://localhost:8788
```

Workers AI and some bindings may not work fully in local dev. Use `--remote` for full fidelity:

```bash
npx wrangler pages dev public --remote
```

---

## Free tier limits (as of 2025)

| Service | Free allowance |
|---------|---------------|
| Pages requests | Unlimited |
| Workers requests | 100,000 / day |
| D1 reads | 5,000,000 / day |
| D1 writes | 100,000 / day |
| D1 storage | 5 GB |
| KV reads | 100,000 / day |
| KV writes | 1,000 / day |
| R2 storage | 10 GB |
| R2 Class A ops | 1,000,000 / month |
| R2 egress | $0 (free forever) |
| Workers AI | Free beta |
| Turnstile | Free, unlimited |
