#!/usr/bin/env node
/*
 * Computer-opponent tournament: plays a fixed set of scenarios with fixed seeds, the player's side and the
 * computer's side each with their own AI options, and reports how often the player's side wins.
 * A lower player win rate means a stronger computer opponent.
 *
 *   node tools/ai_bench.js build [--count 36]                  generate the scenario set (tools/cache/bench.json)
 *   node tools/ai_bench.js run [--foe JSON] [--player JSON] [--seeds 6] [--only N]
 *   node tools/ai_bench.js compare FILE [--seeds 6]            FILE: {"name": {foe options}, ...}; each against the baseline
 *   Options: --set PATH (another scenario set, e.g. a held-out one built with --set PATH --seed 5000 --no-puzzles),
 *            --base JSON (the computer side's options to compare against; default: the defaults)
 *
 * Games run in worker threads, one per CPU core. Each variant plays the same scenarios and seeds as the
 * baseline, so the comparison is paired (McNemar test on games whose result differs).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(__dirname, 'cache', 'bench.json');
const setPath = (p) => (p ? path.resolve(p) : CACHE);
const maps = {};
const mapOf = (id) => maps[id] || (maps[id] = JSON.parse(fs.readFileSync(path.join(ROOT, 'maps', id + '.json'), 'utf8')));

if (!isMainThread) {
  // worker: play the games it is given
  const AI = require('../js/ai.js');
  const set = JSON.parse(fs.readFileSync(workerData.set, 'utf8'));
  parentPort.on('message', (job) => {
    if (job === 'stop') { process.exit(0); }
    const sc = set[job.i].sc;
    let r;
    try {
      r = AI.selfPlay(mapOf(sc.map), sc, { seed: job.seed, ai: job.player || {}, aiFoe: job.foe || null });
      parentPort.postMessage({ id: job.id, won: r.won, turns: r.turns, reason: r.result ? r.result.reason : 'unfinished' });
    } catch (e) {
      parentPort.postMessage({ id: job.id, error: e.message });
    }
  });
  return;
}

const args = require.main === module ? process.argv.slice(2) : [];
const flag = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };

function build() {
  const GEN = require('../js/generator.js');
  const count = +flag('count', 36);
  const base = +flag('seed', 1000);
  const out = setPath(flag('set'));
  const set = [];
  if (!args.includes('--no-puzzles')) {
    for (const f of fs.readdirSync(path.join(ROOT, 'puzzles')).filter((x) => x.endsWith('.json') && x !== 'index.json')) {
      const sc = JSON.parse(fs.readFileSync(path.join(ROOT, 'puzzles', f), 'utf8'));
      set.push({ name: 'puzzle:' + sc.id, sc });
    }
  }
  const theaters = ['eastern', 'western', 'mediterranean', 'china', 'pacific', 'any'];
  const mapsIn = ['total_world_war', 'world_at_war'];
  let made = 0;
  for (let k = 0; made < count && k < count * 4; k++) {
    const opts = {
      seed: base + k * 37, theater: theaters[k % theaters.length], size: 6 + (k * 5) % 7,
      difficulty: ['medium', 'medium', 'easy', 'hard'][k % 4], naval: k % 3 === 1, mapUnits: k % 2 === 0, tune: 8,
    };
    const mapId = mapsIn[Math.floor(k / theaters.length) % mapsIn.length];
    try {
      const sc = GEN.generate(mapOf(mapId), opts);
      sc.id = `gen-${mapId}-${k}`;
      set.push({ name: `gen:${mapId}:${opts.theater}:${opts.difficulty}${opts.naval ? ':naval' : ''}${opts.mapUnits ? ':armies' : ''}`, sc });
      made++;
      process.stdout.write(`\r${made}/${count} generated`);
    } catch (e) { /* theatre not on this map */ }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(set));
  console.log(`\n${set.length} scenarios written to ${path.relative(ROOT, out)}`);
}

/** Play every (scenario, seed) with the given options; resolves to results in job order. */
function play(foe, player, seeds, only, file, seedBase) {
  const set = JSON.parse(fs.readFileSync(setPath(file), 'utf8'));
  const jobs = [];
  for (let i = 0; i < Math.min(set.length, only || set.length); i++) for (let s = 1; s <= seeds; s++) jobs.push({ id: jobs.length, i, seed: (seedBase || 0) + s * 7919 + i, foe, player });
  return runJobs(jobs, file);
}
/** Run a list of jobs {i, seed, foe, player} in worker threads (one per core). */
function runJobs(jobs, file) {
  jobs.forEach((j, k) => { j.id = k; });
  const out = new Array(jobs.length);
  return new Promise((resolve) => {
    if (!jobs.length) { resolve(out); return; }
    const n = Math.min(os.cpus().length, jobs.length);
    let next = 0, done = 0;
    for (let w = 0; w < n; w++) {
      const wk = new Worker(__filename, { workerData: { set: setPath(file) } });
      const feed = () => { if (next < jobs.length) wk.postMessage(jobs[next++]); else wk.postMessage('stop'); };
      wk.on('message', (m) => {
        out[m.id] = Object.assign({ i: jobs[m.id].i, seed: jobs[m.id].seed }, m);
        done++;
        if (done % 20 === 0 && require.main === module) process.stderr.write(`\r  ${done}/${jobs.length}`);
        if (done === jobs.length) resolve(out);
        feed();
      });
      feed();
    }
  });
}
const rate = (rs) => rs.filter((r) => r.won).length / rs.length;
const pct = (x) => (100 * x).toFixed(1) + '%';

/** Paired comparison against the baseline: b = games the variant (as computer) turned from player wins into losses. */
function paired(base, other) {
  let b = 0, c = 0;
  for (let k = 0; k < base.length; k++) {
    if (base[k].won && !other[k].won) b++;
    else if (!base[k].won && other[k].won) c++;
  }
  const z = b + c ? (b - c) / Math.sqrt(b + c) : 0;
  return { better: b, worse: c, z };
}

async function main() {
  const cmd = args[0];
  if (cmd === 'build') return build();
  const file = flag('set');
  if (!fs.existsSync(setPath(file))) { console.error('Run `node tools/ai_bench.js build` first.'); process.exit(1); }
  const seeds = +flag('seeds', 6);
  const only = +flag('only', 0) || 0;
  if (cmd === 'run') {
    const foe = JSON.parse(flag('foe', '{}'));
    const player = JSON.parse(flag('player', '{}'));
    const t0 = Date.now();
    const rs = await play(foe, player, seeds, only, file);
    const errors = rs.filter((r) => r.error);
    console.log(`player side won ${pct(rate(rs))} of ${rs.length} games (${((Date.now() - t0) / 1000).toFixed(0)} s)${errors.length ? `, ${errors.length} errors: ${errors[0].error}` : ''}`);
    return;
  }
  if (cmd === 'compare') {
    const variants = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    const player = JSON.parse(flag('player', '{}'));
    const t0 = Date.now();
    const base = await play(JSON.parse(flag('base', '{}')), player, seeds, only, file);
    console.log(`baseline: player side won ${pct(rate(base))} of ${base.length} games`);
    const set = JSON.parse(fs.readFileSync(setPath(file), 'utf8'));
    for (const name of Object.keys(variants)) {
      const rs = await play(variants[name], player, seeds, only, file);
      const p = paired(base, rs);
      const errors = rs.filter((r) => r.error);
      // per-scenario breakdown of the biggest changes
      const by = {};
      for (let k = 0; k < rs.length; k++) { const n = set[rs[k].i].name; by[n] = (by[n] || 0) + (base[k].won ? 1 : 0) - (rs[k].won ? 1 : 0); }
      const top = Object.entries(by).filter(([, v]) => v).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3).map(([n, v]) => `${n} ${v > 0 ? '−' : '+'}${Math.abs(v)}`).join(', ');
      console.log(`${name.padEnd(22)} player side won ${pct(rate(rs)).padStart(6)}  (${p.better} games turned to losses, ${p.worse} to wins, z = ${p.z.toFixed(2)})${errors.length ? ` ERRORS ${errors.length}: ${errors[0].error}` : ''}${top ? `  · ${top}` : ''}`);
    }
    console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    return;
  }
  console.log('Usage: node tools/ai_bench.js build | run | compare FILE');
}
if (require.main === module) main();
module.exports = { play, runJobs, paired, rate, setPath };
