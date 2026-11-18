#!/usr/bin/env node
/*
 * Tacticle authoring server: serves the site and lets the authoring page save files.
 *   node tools/serve.js [port]      then open http://localhost:8080/author.html
 *
 * API (localhost only):
 *   GET    /api/status              -> {ok, writable}
 *   GET    /api/puzzles             -> [{id, file, title, map, ruleset, maxTurns, mtime}]
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
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
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
      return { id: j.id || f.replace(/\.json$/, ''), file: 'puzzles/' + f, title: j.title || '', map: j.map, ruleset: j.ruleset, maxTurns: j.maxTurns, difficulty: j.difficulty || (j.generator && j.generator.difficulty) || '', mtime: fs.statSync(file).mtimeMs };
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
    for (const d of Object.keys(data.days).sort()) if (/^\d{4}-\d\d-\d\d$/.test(d) && data.days[d]) days[d] = data.days[d];
    writeJSON(path.join(ROOT, 'schedule.json'), { epoch: data.epoch, days });
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

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || p.includes('/.git')) return send(res, 403, 'Forbidden', 'text/plain');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
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
