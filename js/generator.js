/*
 * Tacticle procedural scenario generator.
 *
 * generate(map, opts)  - a new puzzle around a front line between the two teams
 * variant(map, sc, opts) - a similar puzzle: nudged armies, neighbouring objectives, turn limit
 * Both tune the armies by AI self-play toward a target win rate for the chosen difficulty.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./ai.js'), require('./rulesets.js'));
  else root.TacticleGen = factory(root.TacticleEngine, root.TacticleAI, root.TacticleRules);
})(typeof self !== 'undefined' ? self : this, function (E, AI, Rules) {
  'use strict';

  // Theatres are defined by which powers face each other, so they work on any map whose
  // powers use the usual names (Tacticle's own map and imported TripleA maps alike).
  const JAPAN = ['Japan', 'Yamamoto', 'Hisaichi'];
  const THEATERS = {
    any: { name: 'Anywhere', pairs: null },
    eastern: { name: 'Eastern Front', pairs: [['Germany', 'Finland', 'Finns', 'DanubeAxis', 'Romanians', 'Hungarians', 'Italy'], ['Soviet Union']] },
    western: { name: 'Western Europe', pairs: [['Germany'], ['United Kingdom', 'United States', 'France', 'Canada', 'ExiledAllies', 'Dutch']], naval: true },
    mediterranean: { name: 'Mediterranean & Africa', pairs: [['Italy', 'Germany'], ['United Kingdom', 'France', 'Egypt', 'SouthAfrica', 'ExiledAllies', 'United States', 'Anzac']] },
    china: { name: 'China & Burma', pairs: [JAPAN.concat(['Manchuria', 'Thailand', 'Thai']), ['China', 'India']] },
    pacific: { name: 'Pacific', pairs: [JAPAN, ['United States', 'United Kingdom', 'Australia', 'India', 'Anzac', 'Dutch']], naval: true },
  };
  const MAIN = (tm) => tm === 'Axis' || tm === 'Allies';


  const DIFFICULTY = {
    easy: { ratio: 1.7, band: [0.7, 0.92], slack: 2 },
    medium: { ratio: 1.35, band: [0.45, 0.72], slack: 1 },
    hard: { ratio: 1.12, band: [0.22, 0.48], slack: 0 },
  };

  function idx(map) {
    const T = {};
    for (const t of map.territories) T[t.id] = t;
    const team = {};
    for (const p of map.powers || []) team[p.id] = p.team;
    return { T, team };
  }

  function landDist(map, T, from, allowed) {
    const d = { [from]: 0 };
    const q = [from];
    while (q.length) {
      const x = q.shift();
      for (const y of T[x].adj) {
        if (d[y] !== undefined || T[y].type === 'sea' || (allowed && !allowed.has(y))) continue;
        d[y] = d[x] + 1; q.push(y);
      }
    }
    return d;
  }

  /**
   * opts: {seed, ruleset, theater, center, size (land territories), difficulty, naval,
   *        playerTeam ('Axis'|'Allies'|'any'), maxTurns, tune (self-play games, 0 = off)}
   */
  function generate(map, opts) {
    opts = Object.assign({ ruleset: '1942', theater: 'any', size: 9, difficulty: 'medium', naval: false, playerTeam: 'any', tune: 16 }, opts || {});
    const rng = E.makeRng(opts.seed != null ? opts.seed : E.randomSeed());
    const { T, team } = idx(map);
    const R = Rules.get(opts.ruleset);
    const isLand = (id) => T[id] && T[id].type === 'land';
    const owned = (id) => isLand(id) && T[id].owner && team[T[id].owner];
    // candidate front edges
    const th = THEATERS[opts.theater] || THEATERS.any;
    const near = opts.center ? new Set([opts.center].concat(T[opts.center] ? T[opts.center].adj : [])) : null;
    const fits = (a, b) => {
      const oa = T[a].owner, ob = T[b].owner;
      if (team[oa] === team[ob]) return false;
      if (!opts.center && (!MAIN(team[oa]) || !MAIN(team[ob]))) return false; // neutrals only when asked for
      if (near && !near.has(a) && !near.has(b)) return false;
      if (th.pairs) {
        const [x, y] = th.pairs;
        if (!((x.includes(oa) && y.includes(ob)) || (y.includes(oa) && x.includes(ob)))) return false;
      }
      return true;
    };
    const edges = [];
    for (const t of map.territories) {
      if (!owned(t.id)) continue;
      for (const n of t.adj) if (owned(n) && fits(t.id, n)) edges.push([t.id, n]);
    }
    // fronts across one sea zone (naval puzzles, or when there is no land front)
    if (opts.naval || th.naval || !edges.length) {
      const seaEdges = [];
      for (const t of map.territories) {
        if (!owned(t.id)) continue;
        for (const z of t.adj) {
          if (T[z].type !== 'sea') continue;
          for (const n of T[z].adj) if (n !== t.id && owned(n) && fits(t.id, n)) seaEdges.push([t.id, n, z]);
        }
      }
      if (opts.naval || !edges.length) edges.push(...seaEdges);
    }
    if (!edges.length) throw new Error('No front line between the two teams in that area');
    let edge = rng.pick(edges);
    if (opts.playerTeam !== 'any') {
      const fit = edges.filter((e) => team[T[e[0]].owner] === opts.playerTeam);
      if (fit.length) edge = rng.pick(fit);
    }
    const [pa, pb] = edge;
    const playerTeam = team[T[pa].owner];
    // grow a compact region outward from the front edge (nearest first, random ties)
    const region = new Set([pa, pb]);
    const sea = new Set(edge[2] ? [edge[2]] : []);
    const size = Math.max(4, opts.size | 0);
    const dist = { [pa]: 0, [pb]: 0 };
    if (edge[2]) dist[edge[2]] = 0;
    const q = [pa, pb].concat(edge[2] ? [edge[2]] : []);
    const order = [];
    while (q.length) {
      const x = q.shift();
      for (const y of T[x].adj) {
        if (dist[y] !== undefined) continue;
        const viaSea = T[y].type === 'sea';
        if (viaSea && !opts.naval) continue;
        if (!viaSea && !owned(y)) continue;
        if (!viaSea && !opts.center && !MAIN(team[T[y].owner])) continue; // keep neutrals out
        dist[y] = dist[x] + (viaSea ? 0.6 : 1);
        q.push(y);
        if (!viaSea) order.push(y);
      }
    }
    order.sort((a, b) => dist[a] + rng() * 0.9 - (dist[b] + rng() * 0.9));
    for (const y of order) {
      if (region.size >= size) break;
      // keep both sides represented: skip if one side already has 2/3 of the board
      const side = team[T[y].owner] === playerTeam;
      const mine = [...region].filter((id) => (team[T[id].owner] === playerTeam) === side).length;
      if (mine > size * 0.67) continue;
      region.add(y);
    }
    if (opts.naval) {
      // sea zones that link region coasts
      for (const id of region) for (const z of T[id].adj) if (T[z].type === 'sea' && T[z].adj.filter((y) => region.has(y)).length >= 1 && dist[z] !== undefined && dist[z] <= 2) sea.add(z);
    }
    // playable sea zones: those touching 2+ region coasts (and the bridging one)
    for (const t of map.territories) {
      if (t.type !== 'sea') continue;
      const coasts = t.adj.filter((y) => region.has(y)).length;
      if (coasts >= 2 || (opts.naval && coasts >= 1)) sea.add(t.id);
    }
    // two powers: the main owner on each side
    const countOwner = (tm) => {
      const c = {};
      for (const id of region) if (team[T[id].owner] === tm) c[T[id].owner] = (c[T[id].owner] || 0) + 1;
      return Object.keys(c).sort((a, b) => c[b] - c[a])[0];
    };
    const enemyTeam = playerTeam === 'Axis' ? 'Allies' : 'Axis';
    const human = T[pa].owner || countOwner(playerTeam);
    const foe = T[pb].owner || countOwner(enemyTeam);
    const ownerOf = (id) => (team[T[id].owner] === playerTeam ? human : foe);
    const playable = [...region, ...sea];
    // distances from the front
    const allowed = new Set(region);
    const dEnemy = {}, dPlayer = {};
    for (const id of region) {
      dEnemy[id] = Infinity; dPlayer[id] = Infinity;
    }
    for (const id of region) {
      const d = landDist(map, T, id, allowed);
      for (const k of Object.keys(d)) {
        if (ownerOf(id) === foe) dEnemy[k] = Math.min(dEnemy[k], d[k]);
        else dPlayer[k] = Math.min(dPlayer[k], d[k]);
      }
    }
    // objectives: valuable enemy territories near the front
    const enemyLand = [...region].filter((id) => ownerOf(id) === foe);
    const playerLand = [...region].filter((id) => ownerOf(id) === human);
    // prefer valuable targets close to the front line
    const val = (id) => Math.min(T[id].ipc || 0, 4) + (T[id].factory ? 1.5 : 0) + (T[id].capital ? 1.5 : 0) + rng() * 2 -
      1.6 * Math.max(0, (dPlayer[id] === Infinity ? 2 : dPlayer[id]) - 1);
    const reachable = enemyLand.filter((id) => dPlayer[id] <= 3 || (opts.naval && T[id].adj.some((z) => sea.has(z))));
    const pool = (reachable.length ? reachable : enemyLand).sort((a, b) => val(b) - val(a));
    const nObj = Math.min(pool.length, opts.difficulty === 'easy' ? 1 : rng() < 0.5 ? 1 : 2);
    const objIds = pool.slice(0, nObj);
    const objectives = [{ type: 'capture', territories: objIds }];
    if (opts.difficulty === 'hard' && playerLand.length > 1 && rng() < 0.5) {
      const keep = playerLand.filter((id) => dEnemy[id] === 1).sort((a, b) => val(b) - val(a))[0];
      if (keep) objectives.push({ type: 'hold', territories: [keep] });
    }
    const far = Math.max(1, ...objIds.map((id) => (dPlayer[id] === Infinity ? 2 : dPlayer[id])));
    let diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.medium;
    // calibration {a, b} (results.js fitCalibration): real players win σ(a + b·logit(sim)); aim the self-play
    // target at the rates that put real players in the band. A plain number shifts the band by that many points.
    if (opts.calibration && opts.calibration.b) {
      const c = opts.calibration;
      const lg = (p) => { const q = Math.min(0.98, Math.max(0.02, p)); return Math.log(q / (1 - q)); };
      const inv = (r) => 1 / (1 + Math.exp(-(lg(r) - c.a) / c.b));
      diff = Object.assign({}, diff, { band: diff.band.map((x) => Math.min(0.97, Math.max(0.03, inv(x)))) });
    } else if (opts.calibrate) diff = Object.assign({}, diff, { band: diff.band.map((x) => Math.min(0.97, Math.max(0.03, x - opts.calibrate / 100))) });
    const maxTurns = opts.maxTurns || Math.min(6, Math.max(2, far + diff.slack + (objIds.length > 1 ? 1 : 0)));

    const base = {
      format: 'tacticle-scenario', version: 1,
      id: 'gen-' + Math.abs(opts.seed || 0).toString(36),
      title: `${th.name === 'Anywhere' ? '' : th.name + ': '}${objIds.map((id) => T[id].name).join(' & ')}`,
      description: `Take ${objIds.map((id) => T[id].name).join(' and ')} from ${foe} within ${maxTurns} turns.`,
      author: 'generator', map: map.id, ruleset: R.id,
      playable, maxTurns, winCheck: 'turnEnd', income: true, purchase: true,
      powers: {
        [human]: { team: playerTeam, controller: 'human', money: 0 },
        [foe]: { team: enemyTeam, controller: 'ai', money: 0 },
      },
      turnOrder: [human, foe],
      setup: {},
      objectives,
      generator: { seed: opts.seed, difficulty: opts.difficulty, theater: opts.theater, size, naval: !!opts.naval },
    };
    for (const id of region) base.setup[id] = { owner: ownerOf(id), units: {} };
    for (const id of sea) base.setup[id] = { units: {} };
    // factories from the map
    for (const id of region) if (T[id].factory) base.setup[id].units[ownerOf(id)] = { factory: 1 };
    const regionIpc = [...region].reduce((a, id) => a + (T[id].ipc || 0), 0);
    const hasFactory = [...region].some((id) => T[id].factory);
    base.purchase = hasFactory;
    base.powers[human].money = hasFactory ? Math.round(regionIpc * 0.4) : 0;
    base.powers[foe].money = hasFactory ? Math.round(regionIpc * 0.4) : 0;

    const ctx = { map, T, R, rng, region, sea, human, foe, dEnemy, dPlayer, objIds, playerLand, enemyLand, naval: !!opts.naval };
    let ratio = diff.ratio;
    const defBudget = Math.max(12, regionIpc * 3 + objIds.length * 6);
    if (opts.mapUnits && map.defaultSetup) {
      // the map's own starting armies (TripleA setups); tune the turn limit instead of the armies
      let sc = mapArmies(base, ctx, map, team, playerTeam);
      sc.generator.mapUnits = true;
      if (opts.tune) {
        let best = null;
        const baseTurns = sc.maxTurns;
        const U = R.units;
        const front = (side) => (side === ctx.human ? ctx.playerLand : ctx.objIds).slice().sort((a, b) =>
          (side === ctx.human ? ctx.dEnemy[a] - ctx.dEnemy[b] : 0));
        const reinforce = (side, n) => {
          const ids = front(side);
          for (let k = 0; k < n && ids.length; k++) {
            const id = ids[k % Math.min(ids.length, 2)];
            const u = sc.setup[id].units[side] = sc.setup[id].units[side] || {};
            const t = k % 3 === 2 && U.artillery ? 'artillery' : k % 4 === 3 && U.tank ? 'tank' : 'infantry';
            u[t] = (u[t] || 0) + 1;
          }
        };
        for (let iter = 0; iter < 8; iter++) {
          const rate = winRate(map, sc, opts.tune, (opts.seed | 0) + iter * 977);
          if (!best || Math.abs(rate - mid(diff.band)) < Math.abs(best.rate - mid(diff.band))) best = { sc: JSON.parse(JSON.stringify(sc)), rate };
          if (rate >= diff.band[0] && rate <= diff.band[1]) break;
          if (rate < diff.band[0]) {
            if (sc.maxTurns < Math.min(6, baseTurns + 1)) sc.maxTurns++;
            else reinforce(ctx.human, rate === 0 ? 6 : 3);
          } else if (sc.maxTurns > Math.max(2, baseTurns - 1)) sc.maxTurns--;
          else reinforce(ctx.foe, rate === 1 ? 5 : 2);
          sc.description = sc.description.replace(/within \d+ turns?/, `within ${sc.maxTurns} turn${sc.maxTurns === 1 ? '' : 's'}`);
        }
        sc = best.sc;
        sc.generator.winRate = best.rate;
      }
      return sc;
    }
    let sc = placeArmies(base, ctx, ratio * defBudget, defBudget);
    if (opts.tune) {
      let best = null;
      for (let iter = 0; iter < 7; iter++) {
        const rate = winRate(map, sc, opts.tune, (opts.seed | 0) + iter * 977);
        sc.generator.winRate = rate;
        if (!best || Math.abs(rate - mid(diff.band)) < Math.abs(best.rate - mid(diff.band))) best = { sc, rate };
        if (rate >= diff.band[0] && rate <= diff.band[1]) break;
        ratio *= rate === 0 ? 1.45 : rate < diff.band[0] ? 1.18 : rate === 1 ? 0.7 : 0.86;
        sc = placeArmies(base, Object.assign({}, ctx, { rng: E.makeRng((opts.seed | 0) + iter) }), ratio * defBudget, defBudget);
      }
      sc = best.sc;
      sc.generator.winRate = best.rate;
    }
    return sc;
  }
  function mid(b) { return (b[0] + b[1]) / 2; }

  /** Copy the map's starting units into the region; each team's units go to its puzzle power. */
  function mapArmies(base, ctx, map, team, playerTeam) {
    const sc = JSON.parse(JSON.stringify(base));
    const R = ctx.R;
    for (const id of Object.keys(sc.setup)) {
      const src = (map.defaultSetup[id] && map.defaultSetup[id].units) || {};
      sc.setup[id].units = {};
      for (const p of Object.keys(src)) {
        const tm = team[p];
        const to = tm === playerTeam ? ctx.human : (tm === 'Axis' || tm === 'Allies') ? ctx.foe : null;
        if (!to) continue;
        for (const k of Object.keys(src[p])) {
          if (!R.units[k]) continue;
          if (k === 'factory' && sc.setup[id].owner !== to) continue;
          const u = sc.setup[id].units[to] = sc.setup[id].units[to] || {};
          u[k] = (u[k] || 0) + src[p][k];
        }
      }
    }
    // starting money from the map, scaled to the region's share of income
    for (const p of [ctx.human, ctx.foe]) if (map.defaultMoney && map.defaultMoney[p] != null && sc.purchase) sc.powers[p].money = Math.min(sc.powers[p].money * 2, map.defaultMoney[p]);
    return sc;
  }

  /** Spend IPC budgets on armies: defenders weighted to objectives and the front. */
  function placeArmies(base, ctx, atkBudget, defBudget) {
    const sc = JSON.parse(JSON.stringify(base));
    const { R, rng, T } = ctx;
    const U = R.units;
    const add = (id, p, t, n) => {
      if (!U[t] || n <= 0) return;
      const st = sc.setup[id];
      st.units[p] = st.units[p] || {};
      st.units[p][t] = (st.units[p][t] || 0) + n;
    };
    // defender
    const dWeights = ctx.enemyLand.map((id) => ({ id, w: (ctx.objIds.includes(id) ? 4 : 1) + (ctx.dPlayer[id] <= 1 ? 1.5 : 0) + (T[id].ipc || 0) * 0.3 }));
    spend(defBudget, dWeights, (id, budget) => {
      let left = budget;
      const mix = [['infantry', 0.6], ['artillery', 0.15], ['tank', 0.2], ['fighter', 0.05]];
      while (left >= U.infantry.cost) {
        const t = pickMix(mix, rng, U, left);
        if (!t) break;
        add(id, ctx.foe, t, 1); left -= U[t].cost;
      }
      return left;
    });
    // attacker: near the front; a naval puzzle puts part of the budget into the fleet
    let landBudget = atkBudget;
    const seas = [...ctx.sea];
    const hz = seas.filter((z) => T[z].adj.some((y) => sc.setup[y] && sc.setup[y].owner === ctx.human));
    if (ctx.naval && hz.length) {
      const z = rng.pick(hz);
      let fleet = atkBudget * 0.4;
      landBudget -= fleet;
      const nTr = Math.max(1, Math.min(4, Math.round(fleet / 30)));
      add(z, ctx.human, 'transport', nTr); fleet -= nTr * U.transport.cost;
      for (let k = 0; k < nTr; k++) { add(z, ctx.human, 'infantry', 1); add(z, ctx.human, U.tank && rng() < 0.6 ? 'tank' : 'infantry', 1); fleet -= 9; }
      const escorts = ['destroyer', 'cruiser', 'battleship', 'carrier'].filter((t) => U[t]);
      while (fleet > 8 && escorts.length) {
        const t = rng.pick(escorts);
        if (U[t].cost > fleet + 4) { escorts.splice(escorts.indexOf(t), 1); continue; }
        add(z, ctx.human, t, 1); fleet -= U[t].cost;
        if (t === 'carrier' && U.fighter) { add(z, ctx.human, 'fighter', 1); fleet -= U.fighter.cost; }
      }
    }
    // no single territory takes more than ~40% of the army (unless it is the only one)
    const aWeights = ctx.playerLand.map((id) => ({ id, w: ctx.dEnemy[id] <= 1 ? 3 : ctx.dEnemy[id] === 2 ? 1.5 : 0.5 }));
    const wsum = aWeights.reduce((a, b) => a + b.w, 0);
    if (aWeights.length > 1) for (const w of aWeights) w.w = Math.min(w.w, wsum * 0.4);
    spend(landBudget, aWeights, (id, budget) => {
      let left = budget;
      const mix = [['infantry', 0.4], ['artillery', 0.25], ['tank', 0.25], ['fighter', 0.07], ['bomber', 0.03]];
      while (left >= U.infantry.cost) {
        const t = pickMix(mix, rng, U, left);
        if (!t) break;
        add(id, ctx.human, t, 1); left -= U[t].cost;
      }
      return left;
    });
    // the defender gets a small squadron in naval puzzles
    if (ctx.naval && ctx.sea.size) {
      const fz = seas.filter((z) => T[z].adj.some((y) => sc.setup[y] && sc.setup[y].owner === ctx.foe));
      if (fz.length) {
        const z = rng.pick(fz);
        add(z, ctx.foe, U.destroyer ? 'destroyer' : 'submarine', 1);
        add(z, ctx.foe, 'submarine', 1);
      }
    }
    return sc;
  }
  function spend(total, weights, fn) {
    const W = weights.reduce((a, b) => a + b.w, 0) || 1;
    let carry = 0;
    for (const { id, w } of weights) carry = fn(id, total * w / W + carry);
  }
  function pickMix(mix, rng, U, left) {
    const ok = mix.filter(([t]) => U[t] && U[t].cost <= left);
    if (!ok.length) return null;
    let r = rng() * ok.reduce((a, b) => a + b[1], 0);
    for (const [t, w] of ok) { r -= w; if (r <= 0) return t; }
    return ok[0][0];
  }

  /** Share of AI self-play games the player side wins. */
  function winRate(map, sc, games, seed) {
    let w = 0;
    for (let i = 0; i < games; i++) {
      try { if (AI.selfPlay(map, sc, { seed: (seed + i * 7919) | 0, ai: { trials: 30 } }).won) w++; } catch (e) { /* invalid setups count as losses */ }
    }
    return w / games;
  }

  /** A similar puzzle: armies nudged, objectives shifted to a neighbour, turn limit +/-1. */
  function variant(map, sc, opts) {
    opts = Object.assign({ tune: 16 }, opts || {});
    const rng = E.makeRng(opts.seed != null ? opts.seed : E.randomSeed());
    const out = JSON.parse(JSON.stringify(sc));
    const { T } = idx(map);
    const R = Rules.get(sc.ruleset);
    const human = Object.keys(sc.powers).find((p) => sc.powers[p].controller === 'human');
    const play = new Set(sc.playable);
    // nudge armies
    for (const id of Object.keys(out.setup || {})) {
      const us = out.setup[id].units || {};
      for (const p of Object.keys(us)) {
        for (const t of Object.keys(us[p])) {
          if (t === 'factory' || !R.units[t]) continue;
          const r = rng();
          if (r < 0.2) us[p][t] = Math.max(0, us[p][t] - 1);
          else if (r < 0.4) us[p][t] += 1;
          if (!us[p][t]) delete us[p][t];
        }
        if (rng() < 0.15 && R.units.infantry && T[id].type === 'land') us[p].infantry = (us[p].infantry || 0) + 1;
      }
    }
    // shift one capture objective to an adjacent enemy territory
    const cap = out.objectives.find((o) => o.type === 'capture');
    if (cap && cap.territories.length && rng() < 0.6) {
      const i = rng.int(cap.territories.length);
      const cur = cap.territories[i];
      const owner = (out.setup[cur] && out.setup[cur].owner) || T[cur].owner;
      const nb = T[cur].adj.filter((y) => play.has(y) && T[y].type === 'land' && !cap.territories.includes(y) &&
        ((out.setup[y] && out.setup[y].owner) || T[y].owner) === owner && owner !== human);
      if (nb.length) cap.territories[i] = rng.pick(nb);
    }
    if (rng() < 0.4) out.maxTurns = Math.max(1, out.maxTurns + (rng() < 0.5 ? -1 : 1));
    out.id = (sc.id || 'puzzle') + '-v' + Math.abs(opts.seed || rng.int(1e6)).toString(36);
    out.title = (sc.title || 'Puzzle') + ' (variant)';
    if (opts.tune) {
      const target = sc.generator && sc.generator.winRate != null ? sc.generator.winRate : winRate(map, sc, opts.tune, 1);
      let rate = winRate(map, out, opts.tune, 3);
      // pull the win rate back toward the original by adding/removing player infantry near the front
      for (let k = 0; k < 4 && Math.abs(rate - target) > 0.15; k++) {
        const ids = Object.keys(out.setup).filter((id) => out.setup[id].owner === human && (out.setup[id].units[human] || {}).infantry !== undefined);
        if (!ids.length) break;
        const id = rng.pick(ids);
        const u = out.setup[id].units[human];
        u.infantry = Math.max(0, u.infantry + (rate < target ? 2 : -1));
        rate = winRate(map, out, opts.tune, 3 + k);
      }
      out.generator = Object.assign({}, out.generator || {}, { winRate: rate, variantOf: sc.id });
    }
    return out;
  }

  return { generate, variant, winRate, THEATERS, DIFFICULTY };
});
