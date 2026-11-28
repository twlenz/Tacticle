#!/usr/bin/env node
/*
 * Tacticle authoring server: serves the site and lets the authoring page save files.
 *   node tools/serve.js [port]      then open http://localhost:8080/author.html
 *
 * Security: listens on 127.0.0.1 only; refuses requests whose Host is not localhost/127.0.0.1/[::1]
 * on this port (DNS rebinding), cross-site API calls (CSRF), and any path outside the repository,
 * through `..`, dotfiles (.git, .env) or symlinks.
 *
 * API (localhost only):
 *   GET    /api/status              -> {ok, writable}
 *   GET    /api/puzzles             -> [{id, file, title, map, ruleset, maxTurns, edited, mtime}]
 *   PUT    /api/puzzles/<id>        body: scenario JSON  -> writes puzzles/<id>.json, refreshes puzzles/index.json
 *   DELETE /api/puzzles/<id>
 *   PUT    /api/schedule            body: schedule JSON  -> writes schedule.json
 *   PUT    /api/maps/<id>           body: map JSON       -> writes maps/<id>.json, refreshes maps/index.json
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = +(process.argv[2] || process.env.PORT || 8080);
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PUZZLE_FILE = /^puzzles\/[a-z0-9][a-z0-9_-]{0,63}\.json$/;
const DATE = /^\d{4}-\d\d-\d\d$/;
const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};
let realRoot = null;
function rootReal() { return realRoot || (realRoot = fs.realpathSync(ROOT)); }
/** true if `file` is ROOT itself or inside it (not merely a folder whose name starts the same) */
function inside(base, file) {
  const rel = path.relative(base, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };

function send(res, code, body, type) {
  res.writeHead(code, Object.assign({ 'Content-Type': type || 'application/json; charset=utf-8' }, SECURITY_HEADERS));
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > 8e6) { reject(new Error('too large')); req.destroy(); } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function writeJSON(file, data, pretty) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, pretty === false ? 0 : 2) + '\n');
  fs.renameSync(tmp, file);
}
function listPuzzles() {
  const dir = path.join(ROOT, 'puzzles');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => {
    const file = path.join(dir, f);
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { id: j.id || f.replace(/\.json$/, ''), file: 'puzzles/' + f, title: j.title || '', map: j.map, ruleset: j.ruleset, maxTurns: j.maxTurns, difficulty: j.difficulty || (j.generator && j.generator.difficulty) || '', edited: j.edited || new Date(fs.statSync(file).mtimeMs).toISOString(), mtime: fs.statSync(file).mtimeMs };
    } catch (e) {
      return { id: f.replace(/\.json$/, ''), file: 'puzzles/' + f, error: String(e.message) };
    }
  }).sort((a, b) => a.id.localeCompare(b.id));
}
function refreshPuzzleIndex() {
  const list = listPuzzles().map(({ mtime, ...rest }) => rest);
  writeJSON(path.join(ROOT, 'puzzles', 'index.json'), { puzzles: list });
  return list;
}
function refreshMapIndex() {
  const dir = path.join(ROOT, 'maps');
  const maps = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      return { id: j.id, name: j.name, file: 'maps/' + f, territories: (j.territories || []).length, source: j.source || '', credit: j.credit || '', origin: j.origin || null };
    } catch (e) { return null; }
  }).filter(Boolean).sort((a, b) => ((b.source === 'TripleA') - (a.source === 'TripleA')) || a.name.localeCompare(b.name));
  writeJSON(path.join(dir, 'index.json'), { maps });
  return maps;
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // api, kind, id
  const kind = parts[1], id = parts[2];
  if (kind === 'status') return send(res, 200, { ok: true, writable: true, root: path.basename(ROOT) });
  if (kind === 'puzzles' && !id && req.method === 'GET') return send(res, 200, listPuzzles());
  if (kind === 'puzzles' && id) {
    if (!ID.test(id)) return send(res, 400, { error: 'Puzzle ids use a-z, 0-9, - and _' });
    const file = path.join(ROOT, 'puzzles', id + '.json');
    if (req.method === 'PUT') {
      const data = JSON.parse(await readBody(req));
      data.id = id;
      writeJSON(file, data);
      return send(res, 200, { ok: true, file: 'puzzles/' + id + '.json', index: refreshPuzzleIndex() });
    }
    if (req.method === 'DELETE') {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return send(res, 200, { ok: true, index: refreshPuzzleIndex() });
    }
  }
  if (kind === 'schedule' && req.method === 'PUT') {
    const data = JSON.parse(await readBody(req));
    if (!data || typeof data.days !== 'object') return send(res, 400, { error: 'Schedule needs a days object' });
    const days = {};
    for (const d of Object.keys(data.days).sort()) {
      const f = data.days[d];
      if (!DATE.test(d) || !f) continue;
      if (typeof f !== 'string' || !PUZZLE_FILE.test(f)) return send(res, 400, { error: `Schedule entries must be puzzles/<id>.json (bad entry for ${d})` });
      days[d] = f;
    }
    if (data.epoch != null && !DATE.test(String(data.epoch))) return send(res, 400, { error: 'epoch must be YYYY-MM-DD' });
    const out = { epoch: data.epoch };
    if (data.fallback === 'latest') out.fallback = 'latest'; // default: replay a random earlier puzzle
    out.days = days;
    writeJSON(path.join(ROOT, 'schedule.json'), out);
    return send(res, 200, { ok: true });
  }
  if (kind === 'maps' && id && req.method === 'PUT') {
    if (!ID.test(id)) return send(res, 400, { error: 'Map ids use a-z, 0-9, - and _' });
    const data = JSON.parse(await readBody(req));
    data.id = id;
    writeJSON(path.join(ROOT, 'maps', id + '.json'), data, false);
    return send(res, 200, { ok: true, maps: refreshMapIndex() });
  }
  return send(res, 404, { error: 'Unknown API call' });
}

/** Map a URL path to a file inside the repository, or null. */
function resolveStatic(pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch (e) { return null; }
  if (p.includes('\0')) return null;
  const segs = p.split(/[\\/]+/).filter(Boolean);
  // no parent steps, no hidden files or folders (.git, .env, …)
  if (segs.some((x) => x === '..' || x.startsWith('.'))) return null;
  let file = path.join(ROOT, ...segs);
  if (!segs.length || p.endsWith('/')) file = path.join(file, 'index.html');
  return inside(ROOT, file) ? file : null;
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
  const file = resolveStatic(url.pathname);
  if (!file) return send(res, 403, 'Forbidden', 'text/plain');
  fs.realpath(file, (rerr, real) => {
    // symlinks must not lead outside the repository either
    if (rerr) return send(res, 404, 'Not found', 'text/plain');
    if (!inside(rootReal(), real)) return send(res, 403, 'Forbidden', 'text/plain');
    fs.stat(real, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain');
      res.writeHead(200, Object.assign({ 'Content-Type': TYPES[path.extname(real)] || 'application/octet-stream' }, SECURITY_HEADERS));
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(real).pipe(res);
    });
  });
}

/** Host must name this machine on this port, so a rebinding attacker's domain is refused. */
function hostOk(req) {
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(String(req.headers.host || '').toLowerCase());
  if (!m || !LOCAL_NAMES.has(m[1])) return false;
  return !m[2] || +m[2] === req.socket.localPort;
}
/** API calls from a browser must come from this same local origin (no cross-site requests). */
function sameOriginOk(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true; // command-line tools
  try {
    const o = new URL(origin);
    return o.protocol === 'http:' && LOCAL_NAMES.has(o.hostname.toLowerCase()) && +(o.port || 80) === req.socket.localPort;
  } catch (e) { return false; }
}

const server = http.createServer(async (req, res) => {
  if (!hostOk(req)) return send(res, 421, 'This server only answers requests to localhost', 'text/plain');
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return send(res, 400, 'Bad request', 'text/plain'); }
  try {
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'OPTIONS' || !sameOriginOk(req)) return send(res, 403, { error: 'Cross-site requests are not allowed' });
      if ((req.method === 'PUT' || req.method === 'POST') && !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
        return send(res, 415, { error: 'Send JSON (Content-Type: application/json)' });
      }
      return await api(req, res, url);
    }
    return serveStatic(req, res, url);
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    refreshPuzzleIndex();
    refreshMapIndex();
    console.log(`Tacticle: http://localhost:${PORT}/  (authoring: http://localhost:${PORT}/author.html)`);
  });
}
module.exports = { server, refreshPuzzleIndex, refreshMapIndex };
