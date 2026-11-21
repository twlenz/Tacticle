#!/usr/bin/env node
/*
 * Genetic search over the computer opponent's strategy settings (js/ai.js, AI.DEFAULTS).
 *
 *   node tools/ai_evolve.js [--pop 10] [--gens 8] [--seeds 2] [--set PATH] [--out tools/cache/evolved.json]
 *
 * Each generation, on fresh seeds, every candidate plays the computer side of every scenario against
 *   (a) the baseline AI as the player, and
 *   (b) the previous generation's champion as the player (candidates compete against each other),
 * and its fitness is how often the player side loses, averaged over (a) and (b). The best 3 carry over and
 * are scored again (so a lucky run does not stick); the rest are bred by tournament selection, uniform
 * crossover and mutation. Games run in worker threads (tools/ai_bench.js).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../js/engine.js');
const { runJobs, setPath } = require('./ai_bench.js');

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };

// gene: [low, high] for numbers, 'bool' for switches
const GENES = {
  swingOdds: [0.3, 0.85],
  objOdds: [0.5, 1.6],
  trimSlack: [0, 3],
  garrison: [0.4, 2.2],
  counter: [0, 1.5],
  deadZone: [0, 3.5],
  objGuard: [1, 3],
  frontPull: [0, 6],
  incomeAware: 'bool',
  tuvEndgame: 'bool',
  defBuy: 'bool',
};
const BASELINE = { swingOdds: 0.6, objOdds: 1, trimSlack: 0.5, garrison: 1, counter: 0, deadZone: 0, objGuard: 1.5, frontPull: 3, incomeAware: false, tuvEndgame: false, defBuy: false };
const HAND = Object.assign({}, BASELINE, { incomeAware: true, tuvEndgame: true, counter: 0.5, deadZone: 2, defBuy: true });

/** Settings for js/ai.js from a genome (dead zones under 0.9 are off; numbers rounded). */
function decode(g) {
  const o = {};
  for (const k of Object.keys(GENES)) o[k] = GENES[k] === 'bool' ? !!g[k] : Math.round(g[k] * 100) / 100;
  if (o.deadZone < 0.9) o.deadZone = 0;
  return o;
}
/** The same strategy playing the player's side (buying infantry only is for the computer's side). */
function asPlayer(g) { const o = decode(g); delete o.defBuy; return o; }
function randomGenome(rng) {
  const g = {};
  for (const k of Object.keys(GENES)) g[k] = GENES[k] === 'bool' ? rng() < 0.5 : GENES[k][0] + rng() * (GENES[k][1] - GENES[k][0]);
  return g;
}
function mutate(g, rng) {
  const c = Object.assign({}, g);
  for (const k of Object.keys(GENES)) {
    if (rng() > 0.35) continue;
    if (GENES[k] === 'bool') { c[k] = !c[k]; continue; }
    const [lo, hi] = GENES[k];
    // roughly normal step of 15% of the range
    const step = ((rng() + rng() + rng() - 1.5) / 1.5) * 0.15 * (hi - lo) * 2;
    c[k] = Math.max(lo, Math.min(hi, c[k] + step));
  }
  return c;
}
function crossover(a, b, rng) {
  const c = {};
  for (const k of Object.keys(GENES)) c[k] = rng() < 0.5 ? a[k] : b[k];
  return c;
}
const key = (g) => JSON.stringify(decode(g));

async function main() {
  const pop = +flag('pop', 10);
  const gens = +flag('gens', 8);
  const seeds = +flag('seeds', 2);
  const file = flag('set');
  const out = path.resolve(flag('out', path.join(__dirname, 'cache', 'evolved.json')));
  const set = JSON.parse(fs.readFileSync(setPath(file), 'utf8'));
  const rng = E.makeRng(+flag('seed', 20261120));
  let population = [BASELINE, HAND];
  while (population.length < pop) population.push(randomGenome(rng));
  let champion = null;
  const history = [];
  const t0 = Date.now();
  for (let gen = 1; gen <= gens; gen++) {
    // one batch of games for the whole generation: every candidate on the same fresh seeds
    const jobs = [];
    population.forEach((g, c) => {
      for (let i = 0; i < set.length; i++) {
        for (let s = 1; s <= seeds; s++) jobs.push({ c, vs: 'base', i, seed: gen * 100003 + s * 7919 + i, foe: decode(g), player: {} });
        if (champion) jobs.push({ c, vs: 'champ', i, seed: gen * 100003 + 31 + i, foe: decode(g), player: asPlayer(champion) });
      }
    });
    const rs = await runJobs(jobs, file);
    const score = population.map(() => ({ base: [0, 0], champ: [0, 0] }));
    rs.forEach((r, k) => {
      const j = jobs[k];
      if (r.error) return;
      const t = score[j.c][j.vs];
      t[0] += r.won ? 0 : 1; // the computer side held
      t[1]++;
    });
    const ranked = population.map((g, c) => {
      const b = score[c].base, h = score[c].champ;
      const fb = b[1] ? b[0] / b[1] : 0, fh = h[1] ? h[0] / h[1] : null;
      return { g, fit: fh == null ? fb : (fb + fh) / 2, vsBase: fb, vsChamp: fh };
    }).sort((a, b) => b.fit - a.fit);
    champion = ranked[0].g;
    history.push({ gen, ranked: ranked.map((r) => ({ fit: r.fit, vsBase: r.vsBase, vsChamp: r.vsChamp, opts: decode(r.g) })) });
    const fmt = (x) => (x == null ? '  –  ' : (100 * x).toFixed(1).padStart(5) + '%');
    console.log(`generation ${gen} (${((Date.now() - t0) / 60000).toFixed(1)} min): best computer side held ${fmt(ranked[0].vsBase)} vs baseline, ${fmt(ranked[0].vsChamp)} vs last champion`);
    for (const r of ranked.slice(0, 3)) console.log(`   ${fmt(r.fit)}  ${JSON.stringify(decode(r.g))}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ best: decode(champion), history }, null, 1));
    if (gen === gens) break;
    // next generation: 3 elites, children of tournament winners
    const next = ranked.slice(0, 3).map((r) => r.g);
    const seen = new Set(next.map(key));
    const pick = () => { const a = ranked[Math.floor(rng() * ranked.length)], b = ranked[Math.floor(rng() * ranked.length)]; return (a.fit >= b.fit ? a : b).g; };
    let guard = 0;
    while (next.length < pop && guard++ < 500) {
      const child = mutate(crossover(pick(), pick(), rng), rng);
      if (seen.has(key(child))) continue;
      seen.add(key(child));
      next.push(child);
    }
    population = next;
  }
  console.log(`best: ${JSON.stringify(decode(champion))}\nwritten to ${path.relative(process.cwd(), out)}`);
}
main();
