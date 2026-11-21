/*
 * Win-probability model: from any game state, the chance that the player's side wins (like a chess
 * evaluation bar). Features describe the objective race from the player's side; the model is trained on
 * self-play games by tools/ai_value.js, which writes the weights at the bottom of this file.
 * The AI can use it to choose between candidate plans for a turn (js/ai.js, the `lookahead` setting).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.TacticleValue = factory(root.TacticleEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const NAMES = [
    'metShare', 'missingShare', 'turnsLeft', 'lastTurn', 'playerMoving',
    'tuvRatio', 'attackVsDefence', 'enemyAttackVsDefence',
    'reach1Mean', 'reach1Min', 'reach2Mean', 'heldThreatMax', 'holdThreatMax', 'hasHold',
    'incomeRatio', 'moneyDiff', 'playerCanBuy', 'enemyCanBuy',
    'takeNeeded', 'takeBest', 'keepHeld', 'keepHolds',
  ];

  // distances from each objective, per board (land-only graph and any-space graph)
  const cache = new WeakMap();
  function bfs(B, from, landOnly) {
    const d = { [from]: 0 };
    const q = [from];
    while (q.length) {
      const x = q.shift();
      for (const y of B.adj[x] || []) {
        if (d[y] !== undefined || !B.playable.has(y)) continue;
        if (landOnly && (!B.isLand(y) || !B.isLand(x))) continue;
        d[y] = d[x] + 1;
        q.push(y);
      }
    }
    return d;
  }
  function distFrom(g, id) {
    let c = cache.get(g.B);
    if (!c) { c = {}; cache.set(g.B, c); }
    if (!c[id]) c[id] = { land: bfs(g.B, id, true), any: bfs(g.B, id, false) };
    return c[id];
  }

  /** Attack strength of `side` units able to reach territory `id` within `turns` turns. */
  function reach(g, id, isSide, turns) {
    const D = distFrom(g, id);
    let t = 0;
    for (const x of Object.keys(g.s.terr)) {
      for (const u of g.s.terr[x].u) {
        if (!isSide(u.o)) continue;
        const d = g.def(u);
        if (d.infrastructure || !(d.att > 0)) continue;
        if (u.tr) {
          // cargo: lands next turn on a coast next to its sea zone
          if (g.B.isSea(x) && (D.land[x] === undefined) && g.B.adj[x].includes(id)) t += d.att;
          continue;
        }
        if (d.domain === 'land') {
          const dd = D.land[x];
          if (dd !== undefined && dd <= d.move * turns) t += d.att + (d.supportable ? 0.3 : 0);
        } else if (d.domain === 'air') {
          const dd = D.any[x];
          if (dd !== undefined && dd <= Math.ceil(d.move / 2) * turns + 1) t += d.att * 0.8;
        } else if (g.B.isSea(id)) {
          const dd = D.any[x];
          if (dd !== undefined && dd <= d.move * turns) t += d.att;
        }
      }
    }
    return t;
  }
  /** Units by type of one side that could attack territory `id` next turn. */
  function attackersInReach(g, id, isSide) {
    const D = distFrom(g, id);
    const out = {};
    for (const x of Object.keys(g.s.terr)) {
      for (const u of g.s.terr[x].u) {
        if (!isSide(u.o)) continue;
        const d = g.def(u);
        if (d.infrastructure || !(d.att > 0)) continue;
        let ok = false;
        if (u.tr) ok = g.B.isSea(x) && g.B.adj[x].includes(id) && g.B.isLand(id);
        else if (d.domain === 'land') ok = g.B.isLand(id) && D.land[x] !== undefined && D.land[x] <= d.move;
        else if (d.domain === 'air') ok = D.any[x] !== undefined && D.any[x] <= Math.ceil(d.move / 2) + 1;
        else ok = g.B.isSea(id) && D.any[x] !== undefined && D.any[x] <= d.move;
        if (ok) out[u.t] = (out[u.t] || 0) + 1;
      }
    }
    return out;
  }
  /** Simulated chance that everything one side can bring next turn takes territory `id` (fixed seed per space). */
  function takeOdds(g, id, isAtt, isDef) {
    const att = attackersInReach(g, id, isAtt);
    const land = Object.keys(att).some((t) => g.R.units[t].domain === 'land');
    if (g.B.isLand(id) && !land) return 0;
    const def = {};
    for (const u of g.units(id)) {
      if (!isDef(u.o) || u.tr) continue;
      const d = g.def(u);
      if (d.infrastructure && !d.aa) continue;
      def[u.t] = (def[u.t] || 0) + 1;
    }
    if (!Object.keys(def).length) return Object.keys(att).length ? 1 : 0;
    if (!Object.keys(att).length) return 0;
    let h = 7;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return E.simulate(att, def, { sea: g.B.isSea(id), ruleset: g.R.id, trials: 16, seed: h }).win;
  }
  function defence(g, id, isSide) {
    let t = 0;
    for (const u of g.units(id)) {
      if (!isSide(u.o) || u.tr) continue;
      const d = g.def(u);
      if (d.infrastructure && !d.aa) continue;
      t += (d.def || 0) * (d.hp || 1) + 0.3;
    }
    return t;
  }

  /** Feature vector for the current state, from the player's side. */
  function features(g) {
    const ht = g.humanTeam();
    const isH = (o) => g.team(o) === ht;
    const isE = (o) => !!o && g.team(o) && g.team(o) !== ht;
    let tuvH = 0, tuvE = 0, attH = 0, attE = 0, defH = 0, defE = 0;
    for (const x of Object.keys(g.s.terr)) {
      for (const u of g.s.terr[x].u) {
        const d = g.def(u);
        if (d.infrastructure && !d.aa) continue;
        if (isH(u.o)) { tuvH += d.cost || 0; attH += d.att || 0; defH += d.def || 0; } else { tuvE += d.cost || 0; attE += d.att || 0; defE += d.def || 0; }
      }
    }
    // player turns still to come, counting the current one if the player is moving
    const order = g.s.order;
    let left = 0;
    for (let i = g.s.turn; i < order.length; i++) if (g.team(order[i]) === ht) left++;
    left += order.filter((q) => g.team(q) === ht).length * Math.max(0, g.s.maxTurns - g.s.round);
    const targets = g.objectiveTargets();
    const need = Math.max(1, g.objectivesNeeded());
    const cap = targets.filter((t) => t.type !== 'hold');
    const met = cap.filter((t) => t.met).length;
    const missing = cap.filter((t) => !t.met).map((t) => {
      const d = t.type === 'destroy' ? defence(g, t.id, isE) : defence(g, t.id, isE);
      return { r1: Math.log((reach(g, t.id, isH, 1) + 1) / (d + 1)), r2: Math.log((reach(g, t.id, isH, 2) + 1) / (d + 1)) };
    }).sort((a, b) => b.r1 - a.r1);
    const k = Math.max(1, need - met);
    const top = missing.slice(0, k);
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const held = cap.filter((t) => t.met).map((t) => Math.log((reach(g, t.id, isE, 1) + 1) / (defence(g, t.id, isH) + 1)));
    const holds = targets.filter((t) => t.type === 'hold').map((t) => Math.log((reach(g, t.id, isE, 1) + 1) / (defence(g, t.id, isH) + 1)));
    let incH = 0, incE = 0, moneyH = 0, moneyE = 0, facH = false, facE = false;
    for (const p of Object.keys(g.s.powers)) {
      const inc = typeof g.income === 'function' ? g.income(p) : 0;
      if (isH(p)) { incH += inc; moneyH += g.s.powers[p].money || 0; } else { incE += inc; moneyE += g.s.powers[p].money || 0; }
    }
    for (const x of Object.keys(g.s.terr)) {
      const t = g.s.terr[x];
      if (!t.o || !t.u.some((u) => u.t === 'factory')) continue;
      if (isH(t.o)) facH = true; else facE = true;
    }
    const buy = g.sc.purchase !== false;
    // battle odds: taking what is still needed next turn, and keeping what is held
    const take = cap.filter((t) => !t.met).map((t) => takeOdds(g, t.id, isH, isE)).sort((a, b) => b - a);
    const takeNeeded = take.slice(0, k).reduce((a, b) => a * b, take.length >= k ? 1 : 0);
    const keepHeld = cap.filter((t) => t.met).reduce((a, t) => a * (1 - takeOdds(g, t.id, isE, isH)), 1);
    const keepHolds = targets.filter((t) => t.type === 'hold').reduce((a, t) => a * (1 - takeOdds(g, t.id, isE, isH)), 1);
    return [
      met / need, Math.max(0, need - met) / need, left / 4, left <= 1 ? 1 : 0, isH(g.current()) ? 1 : 0,
      Math.log((tuvH + 1) / (tuvE + 1)), Math.log((attH + 1) / (defE + 1)), Math.log((attE + 1) / (defH + 1)),
      top.length ? mean(top.map((m) => m.r1)) : 2, top.length ? Math.min(...top.map((m) => m.r1)) : 2, top.length ? mean(top.map((m) => m.r2)) : 2,
      held.length ? Math.max(...held) : -2, holds.length ? Math.max(...holds) : -2, holds.length ? 1 : 0,
      Math.log((incH + 1) / (incE + 1)), (moneyH - moneyE) / 30, buy && facH ? 1 : 0, buy && facE ? 1 : 0,
      takeNeeded, take.length ? take[0] : 0, keepHeld, keepHolds,
    ];
  }

  /** Model output for a feature vector (logistic regression or a one-hidden-layer network). */
  function score(model, f) {
    const x = f.map((v, i) => (v - model.mean[i]) / (model.std[i] || 1));
    let z;
    if (model.type === 'mlp') {
      const h = model.W1.map((row, j) => Math.tanh(row.reduce((a, w, i) => a + w * x[i], model.b1[j])));
      z = h.reduce((a, v, j) => a + v * model.W2[j], model.b2);
    } else z = x.reduce((a, v, i) => a + v * model.w[i], model.b);
    return 1 / (1 + Math.exp(-z));
  }
  /** P(the player's side wins) from the current state; the finished result once the game is over. */
  function predict(g, model) {
    if (g.s.phase === 'gameOver' && g.s.result) return g.s.result.won ? 1 : 0;
    const m = model || MODEL;
    return m ? score(m, features(g)) : 0.5;
  }

  // ---- trained weights (written by tools/ai_value.js) ----
  /* MODEL-BEGIN */
  // logistic regression trained on 19253 positions from 5225 self-play games
  const MODEL = {"type":"logistic","mean":[0.1161,0.8839,0.4953,0.3571,0.6097,0.0924,-0.2068,-0.3829,-0.4121,-0.5188,-0.0172,-1.7158,-1.7603,0.1557,0.1098,0.1053,0.3996,0.413,0.3347,0.3814,0.9323,0.951],"std":[0.2349,0.2349,0.248,0.4791,0.4878,1.2577,1.0974,1.072,1.1616,1.214,1.126,0.7299,0.7161,0.3626,0.7748,0.4645,0.4898,0.4924,0.4325,0.4436,0.2256,0.2012],"w":[0.0745,-0.0745,0.4054,-0.2949,0.2821,-0.787,-0.0582,-1.3876,-2.0039,1.8578,1.5925,-0.2967,-0.0089,-0.0458,0.3603,0.0317,-0.2446,-0.6817,1.2292,-0.5354,0.1532,0.1427],"b":-2.101};
  /* MODEL-END */

  return { NAMES, features, score, predict, get model() { return MODEL; } };
});
