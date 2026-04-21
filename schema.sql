-- Cloudflare Pages Free Tier Demo — D1 Schema
-- Run: npx wrangler d1 execute cftestsite-db --remote --file=schema.sql

-- ── Migration tracking ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── Guestbook messages (reset on daily wipe) ────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  message     TEXT    NOT NULL,
  country     TEXT,
  city        TEXT,
  sentiment   TEXT    DEFAULT 'neutral',
  word_count  INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

-- ── Demo posts (pre-seeded, survives daily wipe) ────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  category    TEXT    NOT NULL,
  author      TEXT    NOT NULL,
  view_count  INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);

-- ── Tags ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT UNIQUE NOT NULL,
  color TEXT DEFAULT '#F6821F'
);

-- ── Post ↔ Tag relationship ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

-- ── Analytics events (reset on daily wipe) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type  TEXT    NOT NULL,
  feature     TEXT    NOT NULL,
  latency_ms  INTEGER,
  country     TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_feature   ON analytics(feature, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_created   ON analytics(created_at DESC);

-- ── Migration records ───────────────────────────────────────────────────────
INSERT OR IGNORE INTO schema_migrations (version, description) VALUES
  (1, 'Initial schema — messages table'),
  (2, 'Add posts, tags, post_tags tables'),
  (3, 'Add analytics table and sentiment column to messages');

-- ── Seed: Tags ──────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO tags (id, name, color) VALUES
  (1,  'workers',    '#F6821F'),
  (2,  'edge',       '#3B82F6'),
  (3,  'database',   '#8B5CF6'),
  (4,  'storage',    '#10B981'),
  (5,  'security',   '#EF4444'),
  (6,  'ai',         '#F59E0B'),
  (7,  'performance','#06B6D4'),
  (8,  'free-tier',  '#84CC16'),
  (9,  'serverless', '#EC4899'),
  (10, 'cloudflare', '#F6821F');

-- ── Seed: Posts ─────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO posts (id, title, content, category, author, view_count) VALUES
(1,
 'Zero Cold Starts: How Workers Changed Our Architecture',
 'Traditional serverless platforms like AWS Lambda spin up containers on demand, causing 100–500ms cold starts on first request. Cloudflare Workers runs V8 isolates that are always warm — startup time is measured in microseconds, not milliseconds. This fundamentally changes what you can build: real-time APIs, streaming responses, and sub-50ms global latency become the default, not a paid upgrade.',
 'Engineering', 'Cloudflare Engineering Blog', 4821),
(2,
 'D1: Why SQLite at the Edge Is the Right Abstraction',
 'The relational model never went away — it just got slow when the database lived 200ms from your users. D1 puts SQLite at the same datacenter as your Worker, cutting query latency to single-digit milliseconds. You get full SQL: JOINs, indexes, transactions, FTS5 full-text search. At 5GB storage and 5M reads per day on the free tier, it covers most production workloads without a credit card.',
 'Database', 'Cloudflare Blog', 3102),
(3,
 'R2 vs S3: A Real Cost Comparison After 6 Months',
 'S3 egress costs are famously painful — $0.09/GB out of AWS means a 1TB/month CDN workload costs $90 just in transfer fees. R2 charges zero egress. After migrating 40GB of user-uploaded assets, our storage bill went from $47/month to $0.92/month (just the storage). The S3-compatible API meant our existing SDK code worked without changes.',
 'Infrastructure', 'Community Case Study', 2445),
(4,
 'Workers KV: Understanding Eventual Consistency',
 'KV is not a database — it is a globally distributed cache with eventual consistency. Writes propagate to all ~300 edge locations within 60 seconds. For counters, feature flags, and session tokens, this tradeoff is perfect: reads are served from the nearest PoP in single-digit milliseconds, and you rarely need the latest write immediately. For strong consistency, use D1 or Durable Objects.',
 'Engineering', 'Cloudflare Documentation', 1988),
(5,
 'Turnstile vs reCAPTCHA: An Honest Comparison',
 'Google reCAPTCHA v3 gives every user a risk score but the scoring model is opaque and tied to Google account data. Cloudflare Turnstile is fully private — it proves humanity without fingerprinting users, works without cookies, and has no Google dependency. The invisible challenge passes instantly for most users. Free, unlimited, and GDPR-friendly.',
 'Security', 'Privacy Engineering', 1654),
(6,
 'Workers AI: Running LLMs at the Edge in 2024',
 'Workers AI gives you inference as a binding — no GPU provisioning, no model deployment, no inference servers. Call env.AI.run() with a model ID and get a response. Available models include Llama 3.1 8B, Mistral 7B, ResNet-50 for image classification, and BGE for embeddings. On the free beta tier, you get enough tokens to power real features without paying for GPUs.',
 'AI/ML', 'Cloudflare AI Team', 3317),
(7,
 'Building a Global CDN on Zero Dollars',
 'Cloudflare Pages serves static assets from 300+ edge locations with automatic compression, HTTP/3, and smart cache headers — for free. Combined with Workers for dynamic logic, D1 for data, and R2 for files, you can build a complete full-stack application that serves global traffic with no origin server and no monthly bill. This demo is running entirely on the free tier right now.',
 'Case Study', 'Community', 5203),
(8,
 'Pages vs Vercel: What the Free Tiers Actually Include',
 'Both platforms serve static sites for free, but the differences matter at scale. Vercel free tier caps at 100GB bandwidth and 6,000 serverless function invocations per day. Cloudflare Pages gives you 100,000 Worker invocations, unlimited bandwidth, and includes D1, KV, and R2 storage — all with no credit card required. For teams building data-intensive apps, the difference is significant.',
 'Comparison', 'Independent Review', 2891);

-- ── Seed: Post tags ──────────────────────────────────────────────────────────
INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES
  (1, 1), (1, 2), (1, 7), (1, 9),
  (2, 3), (2, 2), (2, 8),
  (3, 4), (3, 8), (3, 10),
  (4, 1), (4, 7), (4, 9),
  (5, 5), (5, 10), (5, 8),
  (6, 1), (6, 6), (6, 9),
  (7, 1), (7, 2), (7, 8), (7, 10),
  (8, 8), (8, 10);

-- ── Seed: Guestbook messages ─────────────────────────────────────────────────
INSERT OR IGNORE INTO messages (id, name, message, country, city, sentiment, word_count) VALUES
(1, 'Sarah Chen',    'Just deployed my first Worker — zero cold starts is no joke. This is how edge computing should work.',              'US', 'San Francisco', 'positive', 19),
(2, 'Markus Weber',  'The KV store latency is insane. Sub-5ms reads globally. My Redis bill is going to zero.',                         'DE', 'Berlin',        'positive', 17),
(3, 'Priya Patel',   'D1 SQLite at the edge? I did not think I needed this until I tried it. My API is now 3× faster.',                 'IN', 'Mumbai',        'positive', 22),
(4, 'James O''Brien','R2 with zero egress fees changed the economics of file storage for my startup completely.',                         'IE', 'Dublin',        'positive', 15),
(5, 'Yuki Tanaka',   'Workers AI is impressive for a free tier offering. Ran Llama 3 inference in under 2 seconds from Tokyo.',         'JP', 'Tokyo',         'positive', 18);
