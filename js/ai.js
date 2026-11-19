/*
 * Tacticle computer opponent.
 *
 * Greedy and objective-aware:
 *   purchase  - infantry first when threatened, otherwise a mix with artillery/tanks
 *   combat    - pick the attack with the best simulated IPC swing (damage dealt minus own
 *               losses) plus territory value; when the player is about to win, retaking or
 *               holding objectives comes first, even at long odds
 *   battles   - retreat when the odds turn bad; casualties cheapest-first
 *   noncombat - fighters land where they defend best; land units reinforce the
 *               most threatened valuable territories, else move toward the front
 *   place     - at the most threatened factory
 * It does not plan amphibious assaults.
 *
 * Usage: const ai = new TacticleAI(game); while ((a = ai.step())) render(a);
 * step() returns null when it is not an AI decision (human turn or human casualty choice).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.TacticleAI = factory(root.TacticleEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  class AI {
    constructor(game, opts) {
      this.g = game;
      this.opts = Object.assign({ trials: 60, swingOdds: 0.6, playerAggression: 1 }, opts || {});
      this.queue = [];
      this.planned = null; // phase key the queue was built for
    }

    /** Execute one AI action. Returns a description, or null if nothing for the AI to do. */
    step() {
      const g = this.g;
      if (g.phase === 'gameOver') return null;
      // battles: the AI may need to act inside a battle even on the human's turn (never as attacker then)
      const b = g.s.battle;
      if (b && !b.over) return this._battleStep();
      if (b && b.over) { g.closeBattle(); return { type: 'battleEnd', id: b.id, result: b.result }; }
      const p = g.current();
      if (!g.s.powers[p].ai) return null;
      const key = `${g.s.round}|${g.s.turn}|${g.phase}`;
      if (this.planned !== key) { this.queue = this._plan(); this.planned = key; }
      while (this.queue.length) {
        const a = this.queue.shift();
        const r = this._do(a);
        if (r) return r;
      }
      // phase done
      if (g.phase === 'combat' && g.s.battles.length) {
        const ready = g.readyBattles();
        if (ready.length) { g.startBattle(ready[0]); return { type: 'battleStart', id: ready[0] }; }
        g.log(`Battles that could not be fought were skipped: ${g.s.battles.join(', ')}`);
        g.s.battles = [];
      }
      if (g.phase === 'purchase') g.commitPurchase();
      if (g.phase === 'place') g.clearBorn();
      const ph = g.phase;
      const res = g.nextPhase();
      return { type: 'phase', from: ph, to: g.phase, lost: res.lost };
    }

    /** Run AI actions until a human decision is needed or it is a human turn. */
    runUntilHuman(limit) {
      let n = 0;
      const out = [];
      let a;
      while ((a = this.step()) && n++ < (limit || 5000)) out.push(a);
      return out;
    }

    // ------------------------------------------------------------------
    _do(a) {
      const g = this.g;
      if (a.type === 'move') {
        // re-validate: units may have changed
        const here = g.units(a.from).filter((u) => a.uids.includes(u.id) && g.canUnitMove(u, a.from)).map((u) => u.id);
        if (!here.length) return null;
        const r = g.move(a.from, here, a.to);
        if (!r.ok) return null;
        return { type: 'move', from: a.from, to: a.to, uids: here, kind: r.kind };
      }
      if (a.type === 'buy') {
        for (const k of Object.keys(a.units)) g.buy(k, a.units[k]);
        return { type: 'buy', units: Object.assign({}, g.s.buy) };
      }
      if (a.type === 'place') {
        const r = g.place(a.unit, a.at);
        if (!r.ok) return null;
        return { type: 'place', unit: a.unit, at: a.at };
      }
      if (a.type === 'battle') {
        if (!g.s.battles.includes(a.id) || !g.readyBattles().includes(a.id)) return null;
        g.startBattle(a.id);
        return { type: 'battleStart', id: a.id };
      }
      return null;
    }

    _battleStep() {
      const g = this.g;
      const b = g.s.battle;
      const attackerAI = g.s.powers[b.att].ai;
      if (b.need === 'roll') {
        if (!attackerAI) return null; // the human rolls their own attacks
        this.subDecisions();
        if (g.s.battle !== b || b.over) return { type: 'battleRoll', id: b.id };
        g.battleRoll();
        return { type: 'battleRoll', id: b.id };
      }
      if (b.need === 'casualties') {
        let did = false;
        for (const side of ['A', 'D']) {
          if (!b.pend[side] || b.picks[side]) continue;
          const ch = g.casualtyChoice(side);
          const owner = side === 'A' ? b.att : (ch.units[0] && ch.units[0].o);
          if (owner && !g.s.powers[owner].ai) continue;
          g.battleAssign(side, ch.auto);
          did = true;
        }
        return did ? { type: 'casualties', id: b.id } : null;
      }
      if (b.need === 'decision') {
        if (!attackerAI) return null;
        const to = this.battleDecision();
        if (to) {
          g.battleRetreat(to);
          return { type: 'retreat', id: b.id };
        }
        g.battleContinue();
        return { type: 'battleRoll', id: b.id };
      }
      return null;
    }
    /**
     * Before a round's dice: the computer's defending submarines dive when the defence is likely lost anyway
     * (only possible when the attacker has no destroyer). Records the choice either way.
     */
    subDecisions() {
      const g = this.g;
      const b = g.s.battle;
      if (!b || !g.subChoicePending('D')) return;
      const owner = (g._side('D').find((u) => g.def(u).sub) || {}).o;
      if (!owner || !g.s.powers[owner].ai) return;
      const odds = E.simulate(count(g.survivors('A')), count(g.survivors('D')), { sea: b.sea, ruleset: g.R.id, trials: 40, seed: g.s.rng ^ 0x51b });
      if (odds.win >= 0.75) g.battleSubmerge('D');
      else g.battleKeepSubs('D');
    }
    /** At the end of a round: where the attacking computer retreats to, or null to press the attack. */
    battleDecision() {
      const g = this.g;
      const b = g.s.battle;
      if (!b || b.need !== 'decision' || b.ending) return null;
      const opts = g.retreatOptions();
      if (!opts.length || !this._shouldRetreat()) return null;
      return opts.includes(b.id) ? b.id : opts[0];
    }

    _shouldRetreat() {
      const g = this.g;
      const b = g.s.battle;
      // the units that live through this round's casualties (with hold they are still on the board)
      const A = g.survivors('A'), D = g.survivors('D');
      const odds = E.simulate(count(A), count(D), { sea: b.sea, ruleset: g.R.id, trials: 40, seed: g.s.rng ^ 0x5bd1 });
      const bonus = this._objBonus(b.id, this._situation());
      if (bonus >= 60) return odds.win < 0.03; // the game depends on it: fight on
      return odds.win < (bonus ? 0.15 : 0.3);
    }

    // ------------------------------------------------------------------
    _objectiveIds() {
      const s = new Set();
      for (const o of this.g.sc.objectives || []) for (const id of o.territories || []) s.add(id);
      return s;
    }
    /** Plain worth of a territory: income, capitals, factories (objectives are scored separately). */
    _value(id) {
      const g = this.g;
      if (g.B.isSea(id)) return 0;
      let v = g.B.ipc(id) + 1;
      for (const p of Object.keys(g.s.powers)) if (g.s.powers[p].capital === id) v += 6;
      if (g.units(id).some((u) => u.t === 'factory')) v += 3;
      return v;
    }
    /**
     * Where the race for the objectives stands, from the moving power's point of view.
     * state: 'winning' = the player meets enough objectives to win at the next check,
     *        'close' = one short, 'calm' otherwise.
     */
    _situation() {
      const g = this.g;
      const p = g.current();
      const ht = g.humanTeam();
      const targets = g.objectiveTargets();
      const need = g.objectivesNeeded();
      const met = targets.filter((t) => t.type !== 'hold' && t.met).length;
      const state = need > 0 && met >= need ? 'winning' : need > 0 && met === need - 1 ? 'close' : 'calm';
      return { p, forPlayer: g.team(p) === ht, targets, need, met, state, finalRound: g.s.round >= g.s.maxTurns };
    }
    /** What capturing `to` is worth next to the IPC swing: half its income, plus capitals and factories in full. */
    _gain(id) {
      const g = this.g;
      if (g.B.isSea(id)) return 0;
      let v = (g.B.ipc(id) + 1) / 2;
      for (const p of Object.keys(g.s.powers)) if (g.s.powers[p].capital === id) v += 6;
      if (g.units(id).some((u) => u.t === 'factory')) v += 3;
      return v;
    }
    /** Extra score (in IPC) for winning a battle at `to` because of the objectives. */
    _objBonus(to, sit) {
      const t = sit.targets.filter((x) => x.id === to);
      if (!t.length) return 0;
      const k = this.opts.playerAggression;
      if (sit.forPlayer) {
        // the player's side: take what is still missing, all-in on the last turn
        return t.some((x) => x.type !== 'hold' && !x.met) ? (sit.finalRound ? 60 : 25) * k : 0;
      }
      let b = 0;
      if (t.some((x) => x.type === 'hold')) b = Math.max(b, sit.finalRound ? 60 : 30); // breaking a hold wins outright
      if (t.some((x) => x.type !== 'hold' && x.met)) b = Math.max(b, sit.state === 'winning' ? 80 : sit.state === 'close' ? 30 : 18);
      return b;
    }
    /** Lowest win chance worth attacking with, given how much rides on the battle. */
    _minOdds(bonus) {
      if (bonus >= 60) return 0.12;
      if (bonus >= 25) return 0.35;
      if (bonus > 0) return 0.45;
      return this.opts.swingOdds;
    }
    /** Is this a territory the moving side must keep for the objectives? */
    _guarding(id, sit) {
      const t = sit.targets.filter((x) => x.id === id);
      if (!t.length || !this.g.friendlyOwner(id, sit.p)) return false;
      return sit.forPlayer ? t.some((x) => x.type === 'hold' || x.met) : t.some((x) => x.type !== 'hold' && !x.met);
    }
    _unitValue(units) { return units.reduce((a, u) => a + (this.g.def(u).cost || 0), 0); }
    /** Bonus for wiping out enemy units at `to` that could reach an objective we guard next turn. */
    _spoilValue(to, sit) {
      const g = this.g;
      const D = this._dist();
      const guarded = [...g.B.playable].filter((id) => this._guarding(id, sit));
      if (!guarded.length) return 0;
      let v = 0;
      for (const u of g.enemies(to, sit.p)) {
        const d = g.def(u);
        if (d.infrastructure || !d.att) continue;
        const reach = d.domain === 'land' ? D.land[to] : D.any[to];
        if (guarded.some((id) => reach && reach[id] !== undefined && reach[id] <= d.move)) v += d.att * 1.5;
      }
      return v;
    }
    /** How much the moving side cares about keeping territory `id` (for garrisons and reinforcement). */
    _defValue(id, sit) {
      let v = this._value(id);
      const t = sit.targets.filter((x) => x.id === id);
      if (!t.length) return v;
      if (sit.forPlayer) {
        if (t.some((x) => x.type === 'hold' || x.met)) v += 25; // must keep what the objectives need
      } else if (t.some((x) => x.type !== 'hold' && !x.met)) {
        v += sit.state === 'close' || sit.state === 'winning' ? 40 : 14; // deny the player's targets
      }
      return v;
    }

    /** All-pairs land distance and air distance over playable territories. */
    _dist() {
      if (this._distCache && this._distCache.key === this.g.s.round) return this._distCache;
      const g = this.g;
      const ids = [...g.B.playable];
      const land = {}, any = {};
      for (const a of ids) {
        land[a] = bfs(a, (x) => g.B.adj[x].filter((y) => g.B.isLand(y) && g.B.isLand(x)));
        any[a] = bfs(a, (x) => g.B.adj[x]);
      }
      this._distCache = { key: g.s.round, land, any };
      return this._distCache;
    }

    /** Enemy attack strength that could reach territory id next turn. */
    _threat(id, p) {
      const g = this.g;
      const D = this._dist();
      let t = 0;
      for (const x of g.B.playable) {
        for (const u of g.units(x)) {
          if (!g.isEnemy(u.o, p) || u.tr) continue;
          const d = g.def(u);
          if (d.infrastructure || !d.att) continue;
          if (d.domain === 'land') {
            const dd = D.land[x][id];
            if (dd !== undefined && dd <= d.move && g.B.isLand(id)) t += d.att + (d.supportable ? 0.3 : 0);
          } else if (d.domain === 'air') {
            const dd = D.any[x][id];
            if (dd !== undefined && dd <= Math.ceil(d.move / 2) + 1) t += d.att * 0.8;
          } else if (g.B.isSea(id)) {
            const dd = D.any[x][id];
            if (dd !== undefined && dd <= d.move) t += d.att;
          }
        }
      }
      return t;
    }
    _defense(id, p) {
      const g = this.g;
      let d = 0;
      for (const u of g.units(id)) if (g.team(u.o) === g.team(p) && !u.tr) d += g.def(u).def;
      return d;
    }

    _plan() {
      const g = this.g;
      switch (g.phase) {
        case 'purchase': return this._planPurchase();
        case 'combatMove': return this._planCombat();
        case 'combat': return this._planBattles();
        case 'noncombatMove': return this._planNoncombat();
        case 'place': return this._planPlace();
        default: return [];
      }
    }

    _planPurchase() {
      const g = this.g;
      const p = g.current();
      if (g.sc.purchase === false) return [];
      let money = g.s.powers[p].money;
      const fac = g.factories();
      let capacity = Object.values(fac).reduce((a, b) => a + b, 0);
      for (const k of Object.keys(g.s.powers[p].unplaced || {})) capacity -= g.s.powers[p].unplaced[k];
      if (capacity <= 0 || money < 3) return [];
      const U = g.R.units;
      let threatened = false;
      for (const id of Object.keys(fac)) if (this._threat(id, p) > this._defense(id, p)) threatened = true;
      const sit = this._situation();
      if (!sit.forPlayer && sit.state !== 'calm') threatened = true; // the player is close to winning: bodies first
      const buy = {};
      let n = 0;
      const add = (t) => { if (!U[t] || U[t].cost > money || n >= capacity) return false; buy[t] = (buy[t] || 0) + 1; money -= U[t].cost; n++; return true; };
      let i = 0;
      while (n < capacity && money >= U.infantry.cost && i++ < 100) {
        if (!threatened && n % 3 === 2) {
          if (U.tank && money >= U.tank.cost + U.infantry.cost && add('tank')) continue;
          if (U.artillery && add('artillery')) continue;
        }
        if (!add('infantry')) break;
      }
      return [{ type: 'buy', units: buy }];
    }

    _planBattles() {
      const g = this.g;
      // sea first, then land in the engine's order
      return g.s.battles.map((id) => ({ type: 'battle', id }));
    }

    /** Units of p that could join an attack on `to`, with their origin. */
    _attackersFor(to, used) {
      const g = this.g;
      const p = g.current();
      const out = [];
      for (const from of g.B.playable) {
        for (const u of g.units(from)) {
          if (u.o !== p || used.has(u.id) || !g.canUnitMove(u, from) || u.tr) continue;
          const d = g.def(u);
          if (d.infrastructure || d.att <= 0 && !d.transport) continue;
          if (d.transport) continue;
          if (g.B.isSea(to) && d.domain === 'land') continue;
          if (g.B.isLand(to) && d.domain === 'sea') continue;
          const r = g.checkMove(from, [u.id], to);
          if (!r.ok) continue;
          if (d.domain === 'air') {
            // the AI does not plan carrier moves, so it only counts landing spots that exist now
            const left = u.ml - (r.plan[0].path.length - 1);
            if (!g.canLandFrom(u, to, left, true)) continue;
          }
          out.push({ u, from });
        }
      }
      return out;
    }

    _planCombat() {
      const g = this.g;
      const p = g.current();
      const used = new Set();
      const committed = new Set();
      const sit = this._situation();
      // ships sharing a sea zone with enemy warships must fight there or leave: leave when the odds are poor
      this._lastMoves = this._lastMoves || [];
      for (const z of g.B.playable) {
        if (!g.B.isSea(z) || !g.hostileSurface(z, p)) continue;
        const mine = g.units(z).filter((u) => u.o === p && !u.tr && g.def(u).domain === 'sea');
        if (!mine.length) continue;
        const foes = g.enemies(z, p).filter((e) => !g.def(e).infrastructure);
        const odds = E.simulate(count(mine), count(foes), { sea: true, ruleset: g.R.id, trials: 60, seed: hash(z) ^ g.s.round });
        for (const u of mine) used.add(u.id);
        if (odds.win >= 0.5) continue; // stay and fight
        const away = g.B.adj[z].filter((y) => g.B.isSea(y) && !g.hostileSurface(y, p))
          .sort((a, c) => g.units(c).filter((u) => g.team(u.o) === g.team(p)).length - g.units(a).filter((u) => g.team(u.o) === g.team(p)).length);
        for (const u of mine) {
          const to = away.find((y) => g.checkMove(z, [u.id], y).ok);
          if (!to) continue;
          const r = g.move(z, [u.id], to);
          if (r.ok) this._lastMoves.push({ from: z, to, uids: [u.id] });
        }
      }
      // garrison: keep a defender in threatened capitals/objectives/factories
      const keep = {};
      for (const id of g.B.playable) {
        if (!g.friendlyOwner(id, p) || g.B.isSea(id)) continue;
        const v = this._defValue(id, sit);
        if (v < 5) continue;
        const threat = this._threat(id, p);
        if (threat > 0) keep[id] = this._guarding(id, sit) ? threat * 1.5 : Math.min(threat, v * 2) * 0.6;
      }
      const garrisonOk = (from, u) => {
        if (!keep[from]) return true;
        const rest = g.units(from).filter((x) => g.team(x.o) === g.team(p) && !used.has(x.id) && x.id !== u.id && !x.tr);
        const def = rest.reduce((a, x) => a + g.def(x).def, 0);
        return def >= keep[from];
      };
      for (let iter = 0; iter < 12; iter++) {
        let best = null;
        for (const to of g.B.playable) {
          if (committed.has(to)) continue;
          const isSea = g.B.isSea(to);
          const foes = g.enemies(to, p).filter((e) => !g.def(e).infrastructure || g.def(e).aa);
          if (isSea && !foes.length) continue;
          if (!isSea && (g.friendlyOwner(to, p) || !g.s.terr[to].o)) continue;
          const cand = this._attackersFor(to, used).filter((c) => garrisonOk(c.from, c.u));
          if (!cand.length) continue;
          const value = this._gain(to);
          const bonus = this._objBonus(to, sit);
          if (!foes.length) {
            // empty enemy land: take it with the cheapest land unit
            const land = cand.filter((c) => g.def(c.u).domain === 'land').sort((a, b) => g.def(a.u).cost - g.def(b.u).cost);
            if (!land.length) continue;
            const score = value + bonus;
            if (!best || score > best.score) best = { to, score, units: [land[0]] };
            continue;
          }
          const def = count(foes);
          const sim = (s) => E.simulate(count(s.map((c) => c.u)), def, { sea: isSea, ruleset: g.R.id, trials: this.opts.trials, seed: (g.s.rng ^ hash(to)) | 0 });
          // expected IPC damage dealt minus expected IPC lost, plus what winning the territory is worth
          // spoiling attacks: destroying units poised to strike an objective we guard is worth extra
          const spoil = this._spoilValue(to, sit);
          const scoreOf = (o) => (o.defLoss - o.attLoss) + o.win * (value + bonus) + (o.defLoss / Math.max(1, this._unitValue(foes))) * spoil;
          const minOdds = this._minOdds(bonus);
          let set = cand.slice();
          let odds = sim(set);
          if (odds.win < minOdds) continue;
          let score = scoreOf(odds);
          // try leaving out the most expensive units; keep whichever force scores best
          set.sort((a, b) => g.def(b.u).cost - g.def(a.u).cost);
          for (let k = 0; k < set.length && set.length > 1; k++) {
            const trial = set.slice(0, k).concat(set.slice(k + 1));
            if (!trial.some((c) => g.def(c.u).domain === 'land') && !isSea) continue;
            const o2 = sim(trial);
            const s2 = scoreOf(o2);
            if (o2.win >= minOdds && s2 >= score - 0.5) { set = trial; odds = o2; score = s2; k--; }
          }
          if (!isSea && !set.some((c) => g.def(c.u).domain === 'land')) continue;
          if (score > 0 && (!best || score > best.score)) best = { to, score, units: set };
        }
        if (!best) break;
        committed.add(best.to);
        const byFrom = {};
        for (const c of best.units) { used.add(c.u.id); (byFrom[c.from] = byFrom[c.from] || []).push(c.u.id); }
        for (const from of Object.keys(byFrom)) {
          const r = g.move(from, byFrom[from], best.to);
          if (r.ok) this._lastMoves = (this._lastMoves || []).concat([{ from, to: best.to, uids: byFrom[from] }]);
        }
      }
      this._planAmphibious(used, committed);
      // moves were executed directly while planning; replay them as display actions
      const done = this._lastMoves || [];
      this._lastMoves = [];
      return done.map((m) => ({ type: 'shown', ...m }));
    }

    /** Load transports, sail next to an enemy coast and land, when the odds are good. */
    _planAmphibious(used, committed) {
      const g = this.g;
      const p = g.current();
      const record = (from, to, uids) => { this._lastMoves = (this._lastMoves || []).concat([{ from, to, uids }]); };
      for (let iter = 0; iter < 3; iter++) {
        let best = null;
        for (const z0 of g.B.playable) {
          if (!g.B.isSea(z0)) continue;
          for (const tr of g.units(z0).filter((u) => u.o === p && g.def(u).transport && !u.unl && !used.has(u.id))) {
            const aboard = g.units(z0).filter((u) => u.tr === tr.id);
            // loadable units next to the zone (only before the transport moves)
            let space = g._space(tr, z0);
            const loads = [];
            if (tr.ml === g.def(tr).move) {
              const cands = [];
              for (const L of g.B.adj[z0]) {
                if (!g.B.isLand(L) || !g.friendlyOwner(L, p)) continue;
                for (const u of g.units(L)) {
                  if (u.o !== p || used.has(u.id) || g.def(u).domain !== 'land' || !g.canUnitMove(u, L) || g.def(u).noCombatMove) continue;
                  cands.push({ u, from: L });
                }
              }
              cands.sort((a, b) => g.def(b.u).att - g.def(a.u).att);
              for (const c of cands) {
                const cost = g.def(c.u).transportCost || 3;
                if (cost <= space) { loads.push(c); space -= cost; }
              }
            }
            const cargo = aboard.concat(loads.map((c) => c.u));
            if (!cargo.length) continue;
            for (const to of g.B.playable) {
              if (!g.B.isLand(to) || committed.has(to) || g.friendlyOwner(to, p) || !g.s.terr[to].o) continue;
              const zones = g.B.adj[to].filter((z) => g.B.isSea(z) && !g.hostileSurface(z, p));
              let z1 = null;
              for (const z of zones) {
                if (z === z0) { z1 = z; break; }
                const r = g.route(tr, z0, z);
                if (!r.error) { z1 = z; break; }
              }
              if (!z1) continue;
              const foes = g.enemies(to, p).filter((e) => !g.def(e).infrastructure || g.def(e).aa);
              const extra = this._attackersFor(to, used);
              const all = cargo.concat(extra.map((c) => c.u));
              const value = this._gain(to);
              const bonus = this._objBonus(to, this._situation());
              let odds = { win: 1, attLoss: 0, defLoss: 0 };
              if (foes.length) {
                odds = E.simulate(count(all), count(foes), { ruleset: g.R.id, trials: this.opts.trials, seed: (g.s.rng ^ hash(to + z0)) | 0, amphibious: true });
              }
              if (odds.win < Math.max(this._minOdds(bonus), 0.4)) continue;
              const score = (odds.defLoss - odds.attLoss) + odds.win * (value + bonus);
              if (score > 0 && (!best || score > best.score)) best = { score, tr, z0, z1, to, loads, extra };
            }
          }
        }
        if (!best) return;
        const { tr, z0, z1, to, loads, extra } = best;
        committed.add(to);
        used.add(tr.id);
        const byFrom = {};
        for (const c of loads) (byFrom[c.from] = byFrom[c.from] || []).push(c.u.id);
        for (const from of Object.keys(byFrom)) {
          const r = g.move(from, byFrom[from], z0, { transport: tr.id });
          if (r.ok) { record(from, z0, byFrom[from]); byFrom[from].forEach((id) => used.add(id)); }
        }
        if (z1 !== z0) {
          const r = g.move(z0, [tr.id], z1);
          if (r.ok) record(z0, z1, [tr.id]);
        }
        const cargoIds = g.units(z1).filter((u) => u.tr === tr.id).map((u) => u.id);
        if (cargoIds.length) {
          const r = g.move(z1, cargoIds, to);
          if (r.ok) { record(z1, to, cargoIds); cargoIds.forEach((id) => used.add(id)); }
        }
        const ex = {};
        for (const c of extra) if (!used.has(c.u.id)) (ex[c.from] = ex[c.from] || []).push(c.u.id);
        for (const from of Object.keys(ex)) {
          const r = g.move(from, ex[from], to);
          if (r.ok) { record(from, to, ex[from]); ex[from].forEach((id) => used.add(id)); }
        }
      }
    }

    _planNoncombat() {
      const g = this.g;
      const p = g.current();
      const D = this._dist();
      const moves = [];
      const sit = this._situation();
      const doMove = (from, uids, to) => {
        const r = g.move(from, uids, to);
        if (r.ok) moves.push({ type: 'shown', from, to, uids });
        return r.ok;
      };
      // need score per friendly land territory
      const need = () => {
        const out = {};
        for (const id of g.B.playable) {
          if (g.B.isSea(id) || !g.friendlyOwner(id, p) || g.s.terr[id].conq) continue;
          const th = this._threat(id, p);
          const def = this._defense(id, p);
          const front = g.B.adj[id].some((y) => g.B.isLand(y) && g.s.terr[y].o && g.isEnemy(g.s.terr[y].o, p));
          // objective territories the player needs are over-provisioned: 1.5x the threat
          out[id] = { deficit: Math.max(0, th * (this._guarding(id, sit) ? 1.5 : 1) - def), value: this._defValue(id, sit), front, th };
        }
        return out;
      };
      // 1) aircraft: land somewhere safe and useful
      for (const from of [...g.B.playable]) {
        for (const u of g.units(from).filter((x) => x.o === p && g.def(x).domain === 'air' && x.ml > 0)) {
          const N = need();
          let best = null;
          const reach = g.airDist(from, u.ml);
          for (const id of Object.keys(N)) {
            if (!g.s.startOwned[id] || g.team(g.s.startOwned[id]) !== g.team(p)) continue;
            const d = reach[id];
            if (d === undefined || (id !== from && !g.checkMove(from, [u.id], id).ok)) continue;
            const sc = (N[id].deficit > 0 ? 5 + N[id].value : 0) + (N[id].front ? 2 : 0) - (N[id].th > this._defense(id, p) * 2 + 8 ? 6 : 0) - d * 0.1;
            if (!best || sc > best.sc) best = { id, sc };
          }
          // fighters may also land on a friendly carrier with room
          if (!g.def(u).bomber) {
            for (const id of Object.keys(reach)) {
              if (!g.B.isSea(id) || id === from) continue;
              let cap = 0, used = 0;
              for (const x of g.units(id)) {
                if (g.team(x.o) !== g.team(p)) continue;
                cap += g.def(x).carrierCapacity || 0;
                if (g.def(x).domain === 'air') used++;
              }
              if (cap > used && g.checkMove(from, [u.id], id).ok) {
                const sc = -1 - reach[id] * 0.1;
                if (!best || sc > best.sc) best = { id, sc };
              }
            }
          }
          const atSeaOk = g.B.isSea(from) && g.units(from).filter((x) => g.team(x.o) === g.team(p) && g.def(x).domain === 'air').length <=
            g.units(from).reduce((a, x) => a + (g.team(x.o) === g.team(p) ? g.def(x).carrierCapacity || 0 : 0), 0);
          const stay = (g.B.isLand(from) && g.friendlyOwner(from, p) && !g.s.terr[from].conq && !g.enemies(from, p).length) || (atSeaOk && !g.def(u).bomber);
          if (best && best.id !== from && !(stay && best.sc < 1)) doMove(from, [u.id], best.id);
          else if (!stay && best) doMove(from, [u.id], best.id);
        }
      }
      // 2) land units: reinforce deficits, else move toward the front
      for (let pass = 0; pass < 2; pass++) {
        for (const from of [...g.B.playable]) {
          if (g.B.isSea(from)) continue;
          const mine = g.units(from).filter((u) => u.o === p && g.def(u).domain === 'land' && g.canUnitMove(u, from));
          for (const u of mine) {
            const N = need();
            const here = N[from];
            if (!here) continue;
            // keep enough to hold valuable territory
            if (here.deficit > 0 || (here.th > 0 && here.value >= 5 && this._defense(from, p) - g.def(u).def < here.th)) continue;
            let best = null;
            for (const id of Object.keys(N)) {
              if (id === from) continue;
              const d = D.land[from][id];
              if (d === undefined || d > u.ml) continue;
              const n = N[id];
              let sc = n.deficit > 0 ? n.deficit * 0.5 + n.value : 0;
              if (!here.front && n.front) sc += 3;
              if (sc <= 0) continue;
              if (!best || sc > best.sc) best = { id, sc };
            }
            if (!best && !here.front) {
              // walk toward the nearest front territory
              let tgt = null;
              for (const id of Object.keys(N)) {
                if (!N[id].front) continue;
                const d = D.land[from][id];
                if (d === undefined) continue;
                if (!tgt || d < tgt.d) tgt = { id, d };
              }
              if (tgt) {
                // step along a land path toward it
                const step = g.B.adj[from].filter((y) => N[y] && D.land[y][tgt.id] !== undefined && D.land[y][tgt.id] < tgt.d)
                  .sort((a, b) => D.land[a][tgt.id] - D.land[b][tgt.id])[0];
                if (step) best = { id: step, sc: 1 };
              }
            }
            if (best) doMove(from, [u.id], best.id);
          }
        }
      }
      return moves;
    }

    _planPlace() {
      const g = this.g;
      const p = g.current();
      const out = [];
      const types = Object.keys(g.s.buy);
      // factories whose area most needs men first (threat, weighted by what is at stake nearby)
      const sit = this._situation();
      const need = (id) => {
        let v = (this._threat(id, p) - this._defense(id, p)) * (1 + this._defValue(id, sit) / 20);
        for (const n of g.B.adj[id]) if (g.B.isLand(n) && g.friendlyOwner(n, p)) v += Math.max(0, this._threat(n, p) - this._defense(n, p)) * this._defValue(n, sit) / 40;
        return v;
      };
      const order = Object.keys(g.factories()).sort((a, b) => need(b) - need(a));
      for (const t of types) {
        let left = g.s.buy[t];
        while (left-- > 0) {
          const targets = g.placeTargets(t);
          if (!targets.length) break;
          let pick = order.find((id) => targets.includes(id));
          if (!pick) {
            // sea zones: next to the factory that most needs help, away from enemy warships when possible
            const rank = (z) => (g.hostileSurface(z, p) ? 100 : 0) + Math.min(...g.B.adj[z].map((x) => (order.indexOf(x) < 0 ? 99 : order.indexOf(x))));
            pick = targets.slice().sort((a, c) => rank(a) - rank(c))[0];
          }
          const r = g.place(t, pick);
          if (r.ok) out.push({ type: 'shownPlace', unit: t, at: pick });
        }
      }
      return out;
    }
  }

  // queue entries of type 'shown' were already executed during planning; report them one by one
  const baseDo = AI.prototype._do;
  AI.prototype._do = function (a) {
    if (a.type === 'shown') return { type: 'move', from: a.from, to: a.to, uids: a.uids };
    if (a.type === 'shownPlace') return { type: 'place', unit: a.unit, at: a.at };
    if (a.type === 'noop') return null;
    return baseDo.call(this, a);
  };

  function count(units) {
    const c = {};
    for (const u of units) c[u.t] = (c[u.t] || 0) + 1;
    return c;
  }
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h | 0;
  }
  function bfs(a, nb) {
    const d = { [a]: 0 };
    const q = [a];
    while (q.length) {
      const x = q.shift();
      for (const y of nb(x)) if (d[y] === undefined) { d[y] = d[x] + 1; q.push(y); }
    }
    return d;
  }

  /**
   * Play a whole scenario with the AI on every side (for balance testing).
   * Returns {won, turns, result}.
   */
  function selfPlay(map, scenario, opts) {
    opts = opts || {};
    const sc = JSON.parse(JSON.stringify(scenario));
    const g = E.Game.create(map, sc, { seed: opts.seed });
    // the "human" side is played by the AI but still counts as the player for objectives
    const humans = Object.keys(g.s.powers).filter((p) => !g.s.powers[p].ai);
    for (const p of humans) g.s.powers[p].ai = true;
    g.humanTeam = () => g.s.powers[humans[0]].team;
    g.isHuman = (p) => humans.includes(p);
    const ai = new AI(g, opts.ai);
    let guard = 0;
    while (g.phase !== 'gameOver' && guard++ < 20000) {
      if (!ai.step()) break;
    }
    return { won: !!(g.s.result && g.s.result.won), turns: g.s.result ? g.s.result.turns : g.s.round, result: g.s.result, game: g };
  }

  AI.selfPlay = selfPlay;
  return AI;
});
