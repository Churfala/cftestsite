/* ── Constants ───────────────────────────────────────────────────────────── */
const API = {
  stats:    '/api/stats',
  geo:      '/api/geo',
  counter:  '/api/counter',
  messages: '/api/guestbook',
  search:   '/api/d1/search',
  d1stats:  '/api/d1/stats',
  posts:    '/api/d1/posts',
  kvcache:  '/api/kv/cache',
  ai:       '/api/ai/generate',
  r2list:   '/api/r2/list',
  r2upload: '/api/r2/upload',
};

// Free-tier daily limits (for headroom bars)
const LIMITS = {
  workers:    { label: 'Workers Requests', limit: 100_000, unit: 'req/day', color: 'workers' },
  kv_reads:   { label: 'KV Reads',         limit: 100_000, unit: 'reads/day', color: 'kv' },
  d1_msgs:    { label: 'D1 Messages',       limit: 50_000,  unit: 'rows (write budget)', color: 'd1' },
  r2_objects: { label: 'R2 Objects',        limit: 30,      unit: 'demo objects', color: 'r2' },
  ai_runs:    { label: 'AI Inferences',     limit: 200,     unit: 'est. daily beta', color: 'ai' },
};

/* ── Turnstile tokens ────────────────────────────────────────────────────── */
let gbToken  = null;
let r2Token  = null;
let aiToken  = null;
window.onGbTurnstile  = t => { gbToken  = t; };
window.onR2Turnstile  = t => { r2Token  = t; };
window.onAiTurnstile  = t => { aiToken  = t; };

/* ── Utilities ───────────────────────────────────────────────────────────── */
function esc(s)       { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function setText(id,v) { const el=document.getElementById(id); if(el) el.textContent=v; }
function fmtNum(n)    { return n==null ? '0' : Number(n).toLocaleString(); }
function fmtBytes(b)  { if(!b||b<1024) return `${b||0} B`; if(b<1048576) return `${(b/1024).toFixed(1)} KB`; if(b<1073741824) return `${(b/1048576).toFixed(1)} MB`; return `${(b/1073741824).toFixed(2)} GB`; }
function timeAgo(dt)  { const ms=Date.now()-new Date(dt); if(ms<60e3) return 'just now'; if(ms<3600e3) return `${Math.floor(ms/60e3)}m ago`; if(ms<86400e3) return `${Math.floor(ms/3600e3)}h ago`; return `${Math.floor(ms/86400e3)}d ago`; }
function flag(cc)     { if(!cc||cc.length!==2) return ''; return String.fromCodePoint(...[...cc.toUpperCase()].map(c=>0x1F1E6-65+c.charCodeAt(0))); }


function toast(msg, type='info') {
  const c  = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

async function apiFetch(url, opts) {
  try {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('apiFetch', url, e.message);
    return null;
  }
}

/* ── Stats bar + countdown ───────────────────────────────────────────────── */
async function loadStats() {
  const d = await apiFetch(API.stats);
  if (!d) return;
  setText('s-workers', fmtNum(d.requests_today));
  setText('s-d1', fmtNum(d.d1_messages));
  setText('s-r2', `${d.r2_objects} files · ${fmtBytes(d.r2_bytes)}`);
  setText('s-ai', fmtNum(d.ai_inferences));
  updateLimits(d);
}

function startCountdown() {
  function tick() {
    const now = Date.now();
    const mdn = new Date(); mdn.setUTCHours(24,0,0,0);
    const rem = mdn - now;
    const h = Math.floor(rem/3600000);
    const m = Math.floor((rem%3600000)/60000);
    const s = Math.floor((rem%60000)/1000);
    setText('countdown', `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
  }
  tick();
  setInterval(tick, 1000);
}

/* ── Geo card ────────────────────────────────────────────────────────────── */
async function loadGeo() {
  const start = Date.now();
  const d = await apiFetch(API.geo);
  if (!d) return;
  const grid = document.getElementById('geo-grid');
  const rows = [
    ['Datacenter',   d.colo,           true],
    ['Country',      `${flag(d.country)} ${d.country}`],
    ['City',         d.city],
    ['Region',       d.region],
    ['Timezone',     d.timezone],
    ['Continent',    d.continent],
    ['ASN',          d.asn ? `AS${d.asn}` : '—'],
    ['ISP',          d.asOrganization],
    ['IP Address',   d.ip],
    ['Protocol',     d.httpProtocol],
    ['TLS Version',  d.tlsVersion],
    ['TLS Cipher',   d.tlsCipher],
  ];
  grid.innerHTML = rows.map(([k,v,hi]) => `
    <div class="geo-item">
      <div class="geo-key">${esc(k)}</div>
      <div class="geo-val${hi?' highlight':''}">${esc(v||'—')}</div>
    </div>
  `).join('');
}

/* ── Counter card ────────────────────────────────────────────────────────── */
async function loadCounter() {
  const start = Date.now();
  const d = await apiFetch(API.counter);
  if (!d) return;
  const el = document.getElementById('visit-count');
  el.textContent = fmtNum(d.count);
  el.classList.add('bump');
  setTimeout(() => el.classList.remove('bump'), 300);
  setText('kv-reads', fmtNum(d.kv_reads));
}

/* ── D1 tab switching ────────────────────────────────────────────────────── */
const d1loaded = { messages: false, search: false, stats: false, posts: false };

function switchD1Tab(name, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('#d1-tabs .tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`d1-${name}`).classList.remove('hidden');
  btn.classList.add('active');

  if (!d1loaded[name]) {
    d1loaded[name] = true;
    if (name === 'messages') loadMessages();
    if (name === 'stats')    loadD1Stats();
    if (name === 'posts')    loadPosts();
  }
}

/* ── Guestbook messages ──────────────────────────────────────────────────── */
async function loadMessages() {
  const d = await apiFetch(API.messages);
  const list = document.getElementById('messages-list');
  if (!d || !Array.isArray(d)) { list.innerHTML = '<p class="muted-hint">Could not load messages.</p>'; return; }
  if (!d.length) { list.innerHTML = '<p class="muted-hint">No messages yet — be the first!</p>'; return; }

  list.innerHTML = d.map(m => `
    <div class="msg-item">
      <div class="msg-header">
        <span>${flag(m.country)}</span>
        <span class="msg-name">${esc(m.name)}</span>
        ${m.city ? `<span class="msg-location">${esc(m.city)}${m.country?', '+m.country:''}</span>` : ''}
        <span class="sentiment-badge s-${m.sentiment||'neutral'}">${m.sentiment||'neutral'}</span>
        <span class="msg-time">${timeAgo(m.created_at)}</span>
      </div>
      <div class="msg-text">${esc(m.message)}</div>
    </div>
  `).join('');
}

async function submitMessage(e) {
  e.preventDefault();
  const name    = document.getElementById('gb-name').value.trim();
  const message = document.getElementById('gb-msg').value.trim();
  const status  = document.getElementById('gb-status');
  const btn     = document.getElementById('gb-submit');

  btn.disabled = true;
  btn.textContent = 'Posting…';
  status.className = 'form-status hidden';

  const res = await fetch(API.messages, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, message, turnstileToken: gbToken }),
  });

  gbToken = null;
  btn.disabled = false;
  btn.textContent = 'Post Message';

  if (res.ok) {
    document.getElementById('gb-form').reset();
    if (window.turnstile) turnstile.reset('#gb-turnstile');
    status.textContent = 'Posted!';
    status.className = 'form-status ok';
    setTimeout(() => { status.className = 'form-status hidden'; }, 3000);
    await loadMessages();
  } else {
    const err = await res.json().catch(() => ({}));
    status.textContent = err.error || 'Post failed';
    status.className = 'form-status err';
  }
}

/* ── D1 Search ───────────────────────────────────────────────────────────── */
async function doSearch() {
  const q       = document.getElementById('search-q').value.trim();
  const results = document.getElementById('search-results');
  if (q.length < 2) { results.innerHTML = '<p class="muted-hint">Enter at least 2 characters.</p>'; return; }

  results.innerHTML = '<p class="muted-hint">Searching…</p>';
  const d = await apiFetch(`${API.search}?q=${encodeURIComponent(q)}`);
  if (!d) { results.innerHTML = '<p class="muted-hint">Search failed.</p>'; return; }

  if (!d.total) { results.innerHTML = '<p class="muted-hint">No results found.</p>'; return; }

  let html = `<p class="search-meta">${d.total} result(s) in ${d.query_ms}ms</p>`;

  if (d.posts?.length) {
    html += `<p class="result-section">Posts (${d.posts.length})</p>`;
    html += d.posts.map(p => `
      <div class="result-item">
        <div class="result-title">${esc(p.title)}</div>
        <div class="result-meta">${esc(p.category)} · ${esc(p.author)} · ${fmtNum(p.view_count)} views</div>
        ${p.tags ? p.tags.split(',').filter(Boolean).map(t=>`<span class="tag">${esc(t.trim())}</span>`).join('') : ''}
        <div class="result-excerpt">${esc(p.content.slice(0,200))}…</div>
      </div>`).join('');
  }

  if (d.messages?.length) {
    html += `<p class="result-section">Messages (${d.messages.length})</p>`;
    html += d.messages.map(m => `
      <div class="result-item">
        <div class="result-title">${flag(m.country)} ${esc(m.name)}</div>
        <div class="result-excerpt">${esc(m.message)}</div>
      </div>`).join('');
  }

  results.innerHTML = html;
}

/* ── D1 Stats tab ────────────────────────────────────────────────────────── */
async function loadD1Stats() {
  const d = await apiFetch(API.d1stats);
  const panel = document.getElementById('d1-stats-panel');
  if (!d) { panel.innerHTML = '<p class="muted-hint">Could not load stats.</p>'; return; }

  const s = d.summary || {};

  panel.innerHTML = `
    <div class="stats-kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Total Messages</div><div class="kpi-val">${fmtNum(s.total_messages||0)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Today</div><div class="kpi-val">${fmtNum(s.today_messages||0)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Avg Words</div><div class="kpi-val">${s.avg_word_count||0}</div></div>
      <div class="kpi-card"><div class="kpi-label">Countries</div><div class="kpi-val">${fmtNum(s.unique_countries||0)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Posts</div><div class="kpi-val">${d.categories?.reduce((a,c)=>a+c.count,0)||0}</div></div>
      <div class="kpi-card"><div class="kpi-label">Schema</div><div class="kpi-val small">v${d.migration_version||0}</div></div>
    </div>
    <table class="data-table">
      <caption>Messages by Country · query ${d.query_ms}ms</caption>
      <thead><tr><th>Country</th><th>Messages</th></tr></thead>
      <tbody>${(d.countries||[]).map(r=>`<tr><td>${flag(r.country)} ${esc(r.country)}</td><td class="mono">${r.count}</td></tr>`).join('')}</tbody>
    </table>
    <table class="data-table">
      <caption>Posts by Category</caption>
      <thead><tr><th>Category</th><th>Posts</th><th>Total Views</th></tr></thead>
      <tbody>${(d.categories||[]).map(r=>`<tr><td>${esc(r.category)}</td><td class="mono">${r.count}</td><td class="mono">${fmtNum(r.total_views)}</td></tr>`).join('')}</tbody>
    </table>
    ${d.analytics_today?.length ? `
    <table class="data-table">
      <caption>Today's Demo Events</caption>
      <thead><tr><th>Feature</th><th>Events</th></tr></thead>
      <tbody>${d.analytics_today.map(r=>`<tr><td>${esc(r.feature)}</td><td class="mono">${r.events}</td></tr>`).join('')}</tbody>
    </table>` : ''}
  `;
}

/* ── D1 Posts tab ────────────────────────────────────────────────────────── */
async function loadPosts() {
  const d = await apiFetch(API.posts);
  const list = document.getElementById('posts-list');
  if (!d?.posts?.length) { list.innerHTML = '<p class="muted-hint">No posts found.</p>'; return; }

  list.innerHTML = `<div class="posts-list">${d.posts.map(p => `
    <div class="post-item">
      <div class="post-title">${esc(p.title)}</div>
      <div class="post-meta">
        <span class="post-cat">${esc(p.category)}</span>
        <span>by ${esc(p.author)}</span>
        <span class="post-views">${fmtNum(p.view_count)} views</span>
      </div>
      <div class="post-excerpt">${esc(p.content)}</div>
      <div style="margin-top:.35rem">${p.tags ? p.tags.split(',').filter(Boolean).map(t=>`<span class="tag">${esc(t.trim())}</span>`).join('') : ''}</div>
    </div>
  `).join('')}</div>`;
}

/* ── KV Cache demo ───────────────────────────────────────────────────────── */
async function runKvCache() {
  const btn    = document.getElementById('cache-btn');
  const result = document.getElementById('cache-result');
  btn.disabled = true;
  btn.textContent = 'Fetching…';

  const d = await apiFetch(API.kvcache);

  btn.disabled = false;
  btn.textContent = 'Fetch Stats (with Cache)';
  if (!d) { toast('KV cache request failed', 'err'); return; }

  const isHit = d.status === 'HIT';
  result.className = `cache-result ${isHit ? 'hit' : 'miss'}`;
  result.innerHTML = `
    <div class="cache-status-row">
      <span class="cache-badge ${isHit?'hit':'miss'}">${d.status}</span>
      <span class="cache-total-time mono">${d.total_ms}ms total</span>
    </div>
    <div class="timing-rows">
      <div class="timing-row"><span>KV read</span><span class="mono">${d.kv_read_ms}ms</span></div>
      ${d.d1_query_ms!==null ? `<div class="timing-row"><span>D1 query (cache miss)</span><span class="mono">${d.d1_query_ms}ms</span></div>` : ''}
    </div>
    <p class="cache-note">${isHit
      ? `⚡ Served from KV (${d.kv_read_ms}ms) — D1 not queried. Cache valid for ≤60s.`
      : `⏱ Cache miss — queried D1 (${d.d1_query_ms}ms) and populated KV for 60s. Click again to see a HIT.`}
    </p>
  `;
  result.classList.remove('hidden');
}

/* ── Workers AI ──────────────────────────────────────────────────────────── */
async function runAI() {
  const btn    = document.getElementById('ai-btn');
  const out    = document.getElementById('ai-out');
  const prompt = document.getElementById('ai-prompt').value.trim();
  if (!prompt)   { toast('Enter a prompt first', 'err'); return; }
  if (!aiToken)  { toast('Please wait for Turnstile to verify', 'err'); return; }

  btn.disabled = true;
  btn.textContent = '⏳ Running…';
  out.classList.add('hidden');

  const d = await apiFetch(API.ai, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, turnstileToken: aiToken }) });
  aiToken = null;
  if (window.turnstile) turnstile.reset('#ai-turnstile');

  btn.disabled = false;
  btn.textContent = '▶ Run Inference';

  if (!d) { toast('AI request failed', 'err'); return; }

  if (d.error) {
    document.getElementById('ai-response').textContent = `Error: ${d.error}. ${d.hint||''}`;
    document.getElementById('ai-meta').innerHTML = '';
  } else {
    document.getElementById('ai-response').textContent = d.response;
    document.getElementById('ai-meta').innerHTML =
      `<span>Model: <strong>${esc(d.model)}</strong></span>` +
      `<span>Inference: <strong>${d.inference_ms}ms</strong></span>` +
      `<span>Total runs: <strong>${fmtNum(d.total_runs)}</strong></span>`;
  }
  out.classList.remove('hidden');
}

/* ── R2 Storage ──────────────────────────────────────────────────────────── */
async function loadR2() {
  const start = Date.now();
  const d = await apiFetch(API.r2list);
  if (!d) return;


  const stats = document.getElementById('r2-stats');
  stats.innerHTML = `<span><span class="r2-stat-val">${d.count}</span> objects</span><span><span class="r2-stat-val">${fmtBytes(d.total_bytes)}</span> used</span>`;

  const gallery = document.getElementById('r2-gallery');
  if (!d.files?.length) { gallery.innerHTML = '<p class="muted-hint">No files yet — upload an image!</p>'; return; }

  gallery.innerHTML = d.files.map(f => `
    <div class="gallery-item" title="${esc(f.caption || f.key)}\n${fmtBytes(f.size)} · ${timeAgo(f.uploaded)}">
      ${f.is_demo ? '<span class="demo-flag">demo</span>' : ''}
      <img src="${esc(f.url)}" alt="${esc(f.caption || f.key)}" loading="lazy">
      <div class="gallery-meta">${f.caption ? esc(f.caption) : fmtBytes(f.size)}</div>
    </div>
  `).join('');
}

async function uploadFile(file) {
  if (!r2Token) { toast('Complete the Turnstile challenge first', 'err'); return; }
  const status = document.getElementById('upload-status');
  status.textContent = `Uploading ${file.name}…`;
  status.className = 'form-status ok';

  const form = new FormData();
  form.append('file', file);
  form.append('turnstileToken', r2Token);
  r2Token = null;

  try {
    const res  = await fetch(API.r2upload, { method: 'POST', body: form });
    const data = await res.json();
    if (res.ok) {
      status.textContent = data.caption ? `Uploaded — “${data.caption}”` : `Uploaded! ${fmtBytes(data.size)}`;
      if (window.turnstile) turnstile.reset('#r2-turnstile');
      setTimeout(() => { status.className = 'form-status hidden'; }, 4000);
      await loadR2();
    } else {
      status.textContent = data.error || 'Upload failed';
      status.className = 'form-status err';
      toast(data.error || 'Upload failed', 'err');
      // Content-policy reject: token is spent server-side — reset so the
      // user can pick a different image without reloading.
      if (res.status === 422 && window.turnstile) turnstile.reset('#r2-turnstile');
    }
  } catch (e) {
    status.textContent = 'Upload failed: ' + e.message;
    status.className = 'form-status err';
  }
}

function initDropzone() {
  const dz   = document.getElementById('dropzone');
  const inp  = document.getElementById('file-input');

  dz.addEventListener('click', () => inp.click());
  inp.addEventListener('change', () => { if (inp.files[0]) { uploadFile(inp.files[0]); inp.value=''; } });
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop',      e => {
    e.preventDefault();
    dz.classList.remove('over');
    if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
  });
}

/* ── Free tier headroom bars ─────────────────────────────────────────────── */
function updateLimits(stats) {
  const items = [
    { ...LIMITS.workers,    used: stats.requests_today || 0 },
    { ...LIMITS.kv_reads,   used: stats.requests_today ? stats.requests_today * 2 : 0 },
    { ...LIMITS.d1_msgs,    used: stats.d1_messages || 0 },
    { ...LIMITS.r2_objects, used: stats.r2_objects || 0 },
    { ...LIMITS.ai_runs,    used: stats.ai_inferences || 0 },
  ];

  const grid = document.getElementById('limits-grid');
  grid.innerHTML = items.map(item => {
    const pct  = Math.min(100, (item.used / item.limit) * 100);
    const cls  = pct < 40 ? 'low' : pct < 75 ? 'medium' : 'high';
    const svcCls = { workers:'svc-workers', kv:'svc-kv', d1:'svc-d1', r2:'svc-r2', ai:'svc-ai' }[item.color] || '';
    return `
      <div class="limit-item">
        <div class="limit-header">
          <span class="limit-name"><span class="svc-badge ${svcCls}">${item.label}</span></span>
          <span class="limit-usage">${fmtNum(item.used)} / ${fmtNum(item.limit)}</span>
        </div>
        <div class="limit-bar">
          <div class="limit-fill ${cls}" style="width:${pct.toFixed(1)}%"></div>
        </div>
        <div class="limit-footer">
          <span>${item.unit}</span>
          <span>${pct.toFixed(1)}% used</span>
        </div>
      </div>
    `;
  }).join('');
}

/* ── Init ────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  startCountdown();

  // Load all card data in parallel
  loadStats();
  loadGeo();
  loadCounter();
  loadMessages(); d1loaded.messages = true;
  loadR2();

  // Refresh stats bar every 30s
  setInterval(loadStats, 30_000);

  initDropzone();

  // Search: Enter key
  const sq = document.getElementById('search-q');
  if (sq) sq.addEventListener('keydown', e => { if (e.key==='Enter') doSearch(); });
});
