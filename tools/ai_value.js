#!/usr/bin/env node
/*
 * Win-probability model for js/value.js: data from self-play, training, evaluation.
 *
 *   node tools/ai_value.js pool [--count 160]        training scenarios (tools/cache/value-pool.json):
 *                                                   the benchmark set plus quickly generated ones
 *   node tools/ai_value.js data [--games 10]         self-play positions with outcomes (tools/cache/value-data.json):
 *                                                   training pool + the held-out sets (test only)
 *   node tools/ai_value.js train [--hidden 16]       fit logistic regression and a small network, report
 *                                                   held-out quality, write the better one into js/value.js
 *
 * Each game gives both sides random strategy settings (some games the defaults) so positions vary, and
 * records the position at the start of every turn, labelled with whether the player's side won.
 * Held-out scenarios (tools/cache/bench-holdout*.json) are never trained on.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(__dirname, 'cache');
const maps = {};
const mapOf = (id) => maps[id] || (maps[id] = JSON.parse(fs.readFileSync(path.join(ROOT, 'maps', id + '.json'), 'utf8')));

const GENES = { swingOdds: [0.3, 0.85], objOdds: [0.5, 1.6], trimSlack: [0, 3], garrison: [0.4, 2.2], counter: [0, 1.5], deadZone: [0, 3.5], objGuard: [1, 3], frontPull: [0, 6] };
function randomPolicy(rng) {
  const r = rng();
  if (r < 0.35) return {};
  if (r < 0.5) return { roles: false };
  const o = {};
  for (const k of Object.keys(GENES)) o[k] = Math.round((GENES[k][0] + rng() * (GENES[k][1] - GENES[k][0])) * 100) / 100;
  if (o.deadZone < 0.9) o.deadZone = 0;
  return o;
}

if (!isMainThread) {
  const AI = require('../js/ai.js');
  const V = require('../js/value.js');
  const E = require('../js/engine.js');
  const sets = {};
  for (const f of workerData.sets) sets[f] = JSON.parse(fs.readFileSync(f, 'utf8'));
  parentPort.on('message', (job) => {
    if (job === 'stop') process.exit(0);
    const sc = sets[job.set][job.i].sc;
    const rng = E.makeRng(job.seed ^ 0x9e3779b9);
    const rows = [];
    let last = null;
    try {
      const r = AI.selfPlay(mapOf(sc.map), sc, {
        seed: job.seed, ai: randomPolicy(rng), aiFoe: randomPolicy(rng),
        onState: (g) => {
          const key = g.s.round + '|' + g.s.turn;
          if (key === last || g.s.battle || g.phase !== 'purchase') return;
          last = key;
          rows.push(V.features(g));
        },
      });
      parentPort.postMessage({ id: job.id, rows, won: r.won });
    } catch (e) { parentPort.postMessage({ id: job.id, error: e.message, rows: [] }); }
  });
  return;
}

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };

function pool() {
  const GEN = require('../js/generator.js');
  const count = +flag('count', 160);
  const set = JSON.parse(fs.readFileSync(path.join(CACHE, 'bench.json'), 'utf8'));
  const theaters = ['eastern', 'western', 'mediterranean', 'china', 'pacific', 'any'];
  let made = 0;
  for (let k = 0; made < count && k < count * 4; k++) {
    const opts = { seed: 20000 + k * 53, theater: theaters[k % 6], size: 5 + (k * 7) % 9, difficulty: ['medium', 'easy', 'hard'][k % 3], naval: k % 3 === 2, mapUnits: k % 2 === 1, tune: 0 };
    const mapId = ['total_world_war', 'world_at_war'][Math.floor(k / 6) % 2];
    try { const sc = GEN.generate(mapOf(mapId), opts); sc.id = `pool-${k}`; set.push({ name: `pool:${mapId}:${opts.theater}`, sc }); made++; } catch (e) { /* theatre not on map */ }
  }
  fs.writeFileSync(path.join(CACHE, 'value-pool.json'), JSON.stringify(set));
  console.log(`${set.length} training scenarios`);
}

function run(jobs, sets) {
  const out = new Array(jobs.length);
  jobs.forEach((j, k) => { j.id = k; });
  return new Promise((resolve) => {
    let next = 0, done = 0;
    for (let w = 0; w < Math.min(os.cpus().length, jobs.length); w++) {
      const wk = new Worker(__filename, { workerData: { sets } });
      const feed = () => wk.postMessage(next < jobs.length ? jobs[next++] : 'stop');
      wk.on('message', (m) => {
        out[m.id] = m;
        if (++done % 100 === 0) process.stderr.write(`\r  ${done}/${jobs.length} games`);
        if (done === jobs.length) { process.stderr.write('\n'); resolve(out); }
        feed();
      });
      feed();
    }
  });
}

async function data() {
  const games = +flag('games', 10);
  const files = { train: path.join(CACHE, 'value-pool.json'), test1: path.join(CACHE, 'bench-holdout.json'), test2: path.join(CACHE, 'bench-holdout2.json') };
  const jobs = [];
  for (const part of Object.keys(files)) {
    const n = JSON.parse(fs.readFileSync(files[part], 'utf8')).length;
    const per = part === 'train' ? games : Math.max(4, Math.round(games / 2));
    for (let i = 0; i < n; i++) for (let s = 0; s < per; s++) jobs.push({ part, set: files[part], i, seed: 300000 + i * 101 + s * 7919 + (part === 'train' ? 0 : 55555) });
  }
  const t0 = Date.now();
  const rs = await run(jobs, Object.values(files));
  const rows = [];
  rs.forEach((r, k) => { for (const f of r.rows) rows.push({ f, y: r.won ? 1 : 0, g: k, part: jobs[k].part, scen: jobs[k].part + ':' + jobs[k].i }); });
  fs.writeFileSync(path.join(CACHE, 'value-data.json'), JSON.stringify(rows));
  const by = (p) => rows.filter((r) => r.part === p || (p === 'test' && r.part !== 'train'));
  console.log(`${rs.length} games, ${rows.length} positions (train ${by('train').length}, test ${by('test').length}) in ${((Date.now() - t0) / 1000).toFixed(0)} s; player side won ${(100 * rs.filter((r) => r.won).length / rs.length).toFixed(1)}% of games`);
}

// ---- models
const sig = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
function standardize(X) {
  const d = X[0].length, mean = new Array(d).fill(0), std = new Array(d).fill(0);
  for (const x of X) for (let i = 0; i < d; i++) mean[i] += x[i] / X.length;
  for (const x of X) for (let i = 0; i < d; i++) std[i] += (x[i] - mean[i]) ** 2 / X.length;
  for (let i = 0; i < d; i++) std[i] = Math.sqrt(std[i]) || 1;
  return { mean, std };
}
/** Logistic regression by Newton's method (with a small L2 penalty). cols: which features to use. */
function fitLogistic(X, y, norm, cols, lam) {
  const d = cols.length + 1;
  const row = (x) => [1].concat(cols.map((c) => (x[c] - norm.mean[c]) / norm.std[c]));
  const Z = X.map(row);
  let w = new Array(d).fill(0);
  for (let it = 0; it < 30; it++) {
    const g = new Array(d).fill(0), H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let n = 0; n < Z.length; n++) {
      const z = Z[n], p = sig(z.reduce((a, v, i) => a + v * w[i], 0)), r = p - y[n], s = p * (1 - p);
      for (let i = 0; i < d; i++) { g[i] += r * z[i]; for (let j = 0; j <= i; j++) H[i][j] += s * z[i] * z[j]; }
    }
    for (let i = 1; i < d; i++) { g[i] += lam * w[i]; H[i][i] += lam; }
    for (let i = 0; i < d; i++) for (let j = 0; j < i; j++) H[j][i] = H[i][j];
    const step = solve(H, g);
    w = w.map((v, i) => v - step[i]);
    if (step.reduce((a, v) => a + Math.abs(v), 0) < 1e-8) break;
  }
  return { predict: (x) => sig(row(x).reduce((a, v, i) => a + v * w[i], 0)), w };
}
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || !M[c][c]) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}
/** One hidden layer (tanh), Adam, L2, early stopping on a validation split. */
function fitMlp(X, y, norm, hidden, valIdx, seed) {
  const E = require('../js/engine.js');
  const rng = E.makeRng(seed || 7);
  const d = X[0].length;
  const Z = X.map((x) => x.map((v, i) => (v - norm.mean[i]) / norm.std[i]));
  const W1 = Array.from({ length: hidden }, () => Array.from({ length: d }, () => (rng() - 0.5) * 2 / Math.sqrt(d)));
  const b1 = new Array(hidden).fill(0), W2 = Array.from({ length: hidden }, () => (rng() - 0.5) * 2 / Math.sqrt(hidden));
  let b2 = 0;
  const params = [W1, b1, W2];
  const m = { W1: W1.map((r) => r.map(() => 0)), b1: b1.map(() => 0), W2: W2.map(() => 0), b2: 0 };
  const v = { W1: W1.map((r) => r.map(() => 0)), b1: b1.map(() => 0), W2: W2.map(() => 0), b2: 0 };
  const val = new Set(valIdx);
  const train = Z.map((_, i) => i).filter((i) => !val.has(i));
  const fwd = (z) => { const h = W1.map((r, j) => Math.tanh(r.reduce((a, w, i) => a + w * z[i], b1[j]))); return { h, p: sig(h.reduce((a, x, j) => a + x * W2[j], b2)) }; };
  const loss = (idx) => idx.reduce((a, i) => { const p = Math.min(1 - 1e-7, Math.max(1e-7, fwd(Z[i]).p)); return a - (y[i] ? Math.log(p) : Math.log(1 - p)); }, 0) / idx.length;
  const lr = 0.003, b1m = 0.9, b2m = 0.999, eps = 1e-8, lam = 1e-4, batch = 256;
  let t = 0, best = { l: Infinity }, bad = 0;
  for (let epoch = 0; epoch < 60; epoch++) {
    for (let i = train.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [train[i], train[j]] = [train[j], train[i]]; }
    for (let s = 0; s < train.length; s += batch) {
      const gW1 = W1.map((r) => r.map(() => 0)), gb1 = b1.map(() => 0), gW2 = W2.map(() => 0);
      let gb2 = 0;
      const B = train.slice(s, s + batch);
      for (const i of B) {
        const z = Z[i], { h, p } = fwd(z), r = p - y[i];
        gb2 += r;
        for (let j = 0; j < hidden; j++) {
          gW2[j] += r * h[j];
          const dh = r * W2[j] * (1 - h[j] * h[j]);
          gb1[j] += dh;
          for (let k = 0; k < d; k++) gW1[j][k] += dh * z[k];
        }
      }
      t++;
      const upd = (val, g, mm, vv) => { mm = b1m * mm + (1 - b1m) * g; vv = b2m * vv + (1 - b2m) * g * g; const mh = mm / (1 - b1m ** t), vh = vv / (1 - b2m ** t); return [val - lr * mh / (Math.sqrt(vh) + eps), mm, vv]; };
      for (let j = 0; j < hidden; j++) {
        for (let k = 0; k < d; k++) { [W1[j][k], m.W1[j][k], v.W1[j][k]] = upd(W1[j][k], gW1[j][k] / B.length + lam * W1[j][k], m.W1[j][k], v.W1[j][k]); }
        [b1[j], m.b1[j], v.b1[j]] = upd(b1[j], gb1[j] / B.length, m.b1[j], v.b1[j]);
        [W2[j], m.W2[j], v.W2[j]] = upd(W2[j], gW2[j] / B.length + lam * W2[j], m.W2[j], v.W2[j]);
      }
      [b2, m.b2, v.b2] = upd(b2, gb2 / B.length, m.b2, v.b2);
    }
    const l = loss(valIdx);
    if (l < best.l - 1e-4) { best = { l, W1: W1.map((r) => r.slice()), b1: b1.slice(), W2: W2.slice(), b2 }; bad = 0; } else if (++bad >= 6) break;
  }
  void params;
  const model = { type: 'mlp', mean: norm.mean, std: norm.std, W1: best.W1, b1: best.b1, W2: best.W2, b2: best.b2 };
  return { model, predict: (x) => require('../js/value.js').score(model, x) };
}
function metrics(p, y) {
  let ll = 0, br = 0, acc = 0;
  for (let i = 0; i < p.length; i++) { const q = Math.min(1 - 1e-7, Math.max(1e-7, p[i])); ll -= y[i] ? Math.log(q) : Math.log(1 - q); br += (p[i] - y[i]) ** 2; acc += (p[i] >= 0.5) === (y[i] === 1) ? 1 : 0; }
  // AUC by ranking
  const idx = p.map((v, i) => i).sort((a, b) => p[a] - p[b]);
  let rank = 0, sumPos = 0, nPos = 0;
  for (const i of idx) { rank++; if (y[i]) { sumPos += rank; nPos++; } }
  const nNeg = p.length - nPos;
  const auc = nPos && nNeg ? (sumPos - nPos * (nPos + 1) / 2) / (nPos * nNeg) : 0.5;
  return { logloss: ll / p.length, brier: br / p.length, acc: acc / p.length, auc };
}
function calibrationTable(p, y) {
  const bins = Array.from({ length: 5 }, () => ({ n: 0, p: 0, y: 0 }));
  for (let i = 0; i < p.length; i++) { const b = bins[Math.min(4, Math.floor(p[i] * 5))]; b.n++; b.p += p[i]; b.y += y[i]; }
  return bins.map((b, k) => `${k * 20}-${k * 20 + 20}%: predicted ${b.n ? (100 * b.p / b.n).toFixed(0) : '–'}%, actual ${b.n ? (100 * b.y / b.n).toFixed(0) : '–'}% (${b.n})`).join('\n    ');
}

function train() {
  const V = require('../js/value.js');
  const rows = JSON.parse(fs.readFileSync(path.join(CACHE, 'value-data.json'), 'utf8'));
  const tr = rows.filter((r) => r.part === 'train'), te = rows.filter((r) => r.part !== 'train');
  const X = tr.map((r) => r.f), y = tr.map((r) => r.y);
  const norm = standardize(X);
  // validation for early stopping: whole games, 10%
  const games = [...new Set(tr.map((r) => r.g))];
  const valGames = new Set(games.filter((g, k) => k % 10 === 3));
  const valIdx = tr.map((r, i) => (valGames.has(r.g) ? i : -1)).filter((i) => i >= 0);
  const yT = te.map((r) => r.y);
  const report = (name, pred) => { const m = metrics(te.map((r) => pred(r.f)), yT); console.log(`${name.padEnd(34)} log-loss ${m.logloss.toFixed(3)}  Brier ${m.brier.toFixed(3)}  accuracy ${(100 * m.acc).toFixed(1)}%  AUC ${m.auc.toFixed(3)}`); return m; };
  const base = y.reduce((a, b) => a + b, 0) / y.length;
  console.log(`train ${tr.length} positions from ${games.length} games, test ${te.length} positions (held-out scenarios)`);
  report('constant (training win rate)', () => base);
  const all = V.NAMES.map((_, i) => i);
  report('objectives + turns only (logistic)', fitLogistic(X, y, norm, [0, 1, 2, 3, 4], 1).predict);
  const lr = fitLogistic(X, y, norm, all, 1);
  const mLr = report('logistic regression, all features', lr.predict);
  const hidden = +flag('hidden', 16);
  const mlp = fitMlp(X, y, norm, hidden, valIdx, 11);
  const mMlp = report(`network (${hidden} hidden units)`, mlp.predict);
  const useMlp = mMlp.logloss < mLr.logloss - 0.002;
  const chosen = useMlp ? mlp.model : { type: 'logistic', mean: norm.mean, std: norm.std, w: lr.w.slice(1), b: lr.w[0] };
  const pick = (x) => V.score(chosen, x);
  console.log(`chosen: ${useMlp ? 'network' : 'logistic regression'}; calibration on held-out positions:\n    ${calibrationTable(te.map((r) => pick(r.f)), yT)}`);
  if (!useMlp) console.log('logistic weights (standardized): ' + V.NAMES.map((n, i) => `${n} ${lr.w[i + 1].toFixed(2)}`).join(', '));
  const round = (v) => (Array.isArray(v) ? v.map(round) : typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);
  const json = JSON.stringify(Object.fromEntries(Object.entries(chosen).map(([k, v]) => [k, round(v)])));
  const file = path.join(ROOT, 'js', 'value.js');
  const src = fs.readFileSync(file, 'utf8').replace(/\/\* MODEL-BEGIN \*\/[\s\S]*\/\* MODEL-END \*\//, `/* MODEL-BEGIN */\n  // ${useMlp ? 'network' : 'logistic regression'} trained on ${tr.length} positions from ${games.length} self-play games\n  const MODEL = ${json};\n  /* MODEL-END */`);
  fs.writeFileSync(file, src);
  console.log('weights written to js/value.js');
}

const cmd = args[0];
if (cmd === 'pool') pool();
else if (cmd === 'data') data();
else if (cmd === 'train') train();
else console.log('Usage: node tools/ai_value.js pool | data | train');
