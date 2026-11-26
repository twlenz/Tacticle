/*
 * Tacticle rules engine.
 *
 * Pure game logic with no DOM. Runs in the browser (window.TacticleEngine) and in Node.
 * All mutable state is one plain JSON object (game.s), so it can be saved to
 * localStorage, restored after a refresh, and snapshotted for undo.
 *
 * Turn: purchase -> combatMove -> combat -> noncombatMove -> place -> (income, next power)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rulesets.js'));
  else root.TacticleEngine = factory(root.TacticleRules);
})(typeof self !== 'undefined' ? self : this, function (Rules) {
  'use strict';

  const PHASES = ['purchase', 'combatMove', 'combat', 'noncombatMove', 'place'];
  const PHASE_NAMES = {
    purchase: 'Buying', combatMove: 'Combat Moves', combat: 'Battling',
    noncombatMove: 'Noncombat Moves', place: 'Unit Placement', gameOver: 'Game Over',
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function randomSeed() {
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (c && c.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0] | 0;
    return Math.floor(Math.random() * 2147483647);
  }
  /** mulberry32 step: returns [nextState, float in [0,1)] */
  function rngNext(state) {
    state = (state + 0x6D2B79F5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return [state, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
  }
  /** Small standalone RNG (for simulations and the generator). */
  function makeRng(seed) {
    let s = seed | 0;
    const f = () => { const r = rngNext(s); s = r[0]; return r[1]; };
    f.int = (n) => Math.floor(f() * n);
    f.pick = (a) => a[Math.floor(f() * a.length)];
    f.die = () => 1 + Math.floor(f() * 6);
    return f;
  }

  // ------------------------------------------------------------------
  // Battle core: pure helpers shared by real battles and the simulator.
  // A "unit" here only needs {id, t, h}; defs come from the rule set.
  // Hit spec: {any, notAir, notSub, airOnly} = how many hits of each kind.
  // ------------------------------------------------------------------
  function hp(def) { return def.hp || 1; }

  function groupOf(def) { return def.domain === 'air' ? 'air' : def.sub ? 'sub' : 'oth'; }

  /** Largest number of hit points a side can absorb from these hits. */
  function maxAssignable(R, units, hits, opts) {
    const cap = { air: 0, sub: 0, oth: 0 };
    let trn = 0;
    for (const u of units) {
      const d = R.units[u.t];
      if (d.infrastructure) continue;
      const left = hp(d) - (u.h || 0);
      if (opts && opts.defenseless && d.transport) { trn += left; continue; }
      cap[groupOf(d)] += left;
    }
    const best = flowMax(cap, hits);
    // Transports are chosen last: they soak up whatever general hits remain
    let extra = 0;
    if (trn && best.used.oth >= cap.oth) {
      const left = (hits.any + hits.notAir + hits.notSub) - best.surfaceUsed;
      extra = Math.max(0, Math.min(trn, left));
    }
    return best.n + extra;
  }

  /** Brute-force the 3-group assignment (sizes are tiny). */
  function flowMax(cap, hits) {
    const A = hits.any || 0, NA = hits.notAir || 0, NS = hits.notSub || 0, AO = hits.airOnly || 0;
    let best = { n: 0, used: { air: 0, sub: 0, oth: 0 }, surfaceUsed: 0 };
    const airMax = Math.min(cap.air, A + NS + AO);
    for (let a = 0; a <= airMax; a++) {
      const subMax = Math.min(cap.sub, A + NA);
      for (let s = 0; s <= subMax; s++) {
        // hits left after serving air (prefer AO, NS first) and subs (prefer NA first)
        let ao = AO, ns = NS, na = NA, an = A;
        let need = a;
        let t = Math.min(ao, need); ao -= t; need -= t;
        t = Math.min(ns, need); ns -= t; need -= t;
        t = Math.min(an, need); an -= t; need -= t;
        if (need > 0) continue;
        need = s;
        t = Math.min(na, need); na -= t; need -= t;
        t = Math.min(an, need); an -= t; need -= t;
        if (need > 0) continue;
        const o = Math.min(cap.oth, an + na + ns);
        const n = a + s + o;
        if (n > best.n) best = { n, used: { air: a, sub: s, oth: o }, surfaceUsed: (A + NA + NS) - (an + na + ns) + o };
      }
    }
    return best;
  }

  /** Check a casualty pick list (unit ids, repeated for multi-hit units). */
  function validatePicks(R, units, hits, picks, opts) {
    const byId = {};
    for (const u of units) byId[u.id] = u;
    const need = maxAssignable(R, units, hits, opts);
    if (picks.length !== need) return `Choose ${need} casualt${need === 1 ? 'y' : 'ies'}`;
    const cnt = {};
    const g = { air: 0, sub: 0, oth: 0 };
    let trn = 0;
    for (const id of picks) {
      const u = byId[id];
      if (!u) return 'Unknown unit';
      const d = R.units[u.t];
      if (d.infrastructure) return `${d.name} cannot be a casualty`;
      cnt[id] = (cnt[id] || 0) + 1;
      if (cnt[id] > hp(d) - (u.h || 0)) return `${d.name} picked too many times`;
      if (opts && opts.defenseless && d.transport) trn++;
      else g[groupOf(d)]++;
    }
    const cap = { air: g.air, sub: g.sub, oth: g.oth };
    const f = flowMax(cap, hits);
    if (f.n !== g.air + g.sub + g.oth) {
      if (g.air && !(hits.any + hits.notSub + (hits.airOnly || 0))) return 'These hits cannot be taken by aircraft';
      if (g.sub && !(hits.any + hits.notAir)) return 'These hits cannot be taken by submarines';
      return 'Those casualties do not match the kinds of hits';
    }
    if (trn) {
      // all other hittable units must be fully used first
      let otherLeft = 0;
      for (const u of units) {
        const d = R.units[u.t];
        if (d.infrastructure || d.transport) continue;
        if (groupOf(d) !== 'oth') continue;
        otherLeft += hp(d) - (u.h || 0) - (cnt[u.id] || 0);
      }
      if (otherLeft > 0) return 'Transports are taken last';
    }
    return null;
  }

  function supportCount(R, units, role) {
    if (role !== 'A') return { inf: 0, art: 0 };
    let inf = 0, art = 0;
    for (const u of units) {
      const d = R.units[u.t];
      if (d.supportable) inf++;
      if (d.supports) art += d.supports;
    }
    return { inf, art };
  }

  /** Value used to pick cheap casualties first: low = lose first. */
  function keepScore(R, u, role, round) {
    const d = R.units[u.t];
    if (hp(d) > 1 && (u.h || 0) < hp(d) - 1) return -100; // free hit on a battleship
    let v = role === 'A' ? d.att : d.def;
    if (d.aa && round > 1) v = 0;
    return v * 3 + d.cost / 2 + (d.transport ? 1000 : 0);
  }

  function autoPicks(R, units, hits, role, opts) {
    const need = maxAssignable(R, units, hits, opts);
    const pool = [];
    for (const u of units) {
      const d = R.units[u.t];
      if (d.infrastructure) continue;
      for (let k = 0; k < hp(d) - (u.h || 0); k++) pool.push({ u, k });
    }
    const round = (opts && opts.round) || 1;
    pool.sort((a, b) => {
      const sa = a.k === 0 ? keepScore(R, a.u, role, round) : keepScore(R, a.u, role, round) + 0.01 + (hp(R.units[a.u.t]) > 1 ? 30 : 0);
      const sb = b.k === 0 ? keepScore(R, b.u, role, round) : keepScore(R, b.u, role, round) + 0.01 + (hp(R.units[b.u.t]) > 1 ? 30 : 0);
      return sa - sb || a.u.id - b.u.id;
    });
    const picks = [];
    for (const p of pool) {
      if (picks.length >= need) break;
      const trial = picks.concat([p.u.id]);
      // feasible if remaining need can still be met
      const err = validatePartial(R, units, hits, trial, opts);
      if (!err) picks.push(p.u.id);
    }
    return picks;
  }

  function validatePartial(R, units, hits, picks, opts) {
    const g = { air: 0, sub: 0, oth: 0 };
    const byId = {};
    for (const u of units) byId[u.id] = u;
    let trn = 0;
    for (const id of picks) {
      const d = R.units[byId[id].t];
      if (opts && opts.defenseless && d.transport) trn++;
      else g[groupOf(d)]++;
    }
    const f = flowMax(g, hits);
    if (f.n !== g.air + g.sub + g.oth) return 'bad';
    if (trn) {
      let otherLeft = 0;
      const cnt = {};
      for (const id of picks) cnt[id] = (cnt[id] || 0) + 1;
      for (const u of units) {
        const d = R.units[u.t];
        if (d.infrastructure || d.transport || groupOf(d) !== 'oth') continue;
        otherLeft += hp(d) - (u.h || 0) - (cnt[u.id] || 0);
      }
      if (otherLeft > 0) return 'bad';
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Board: static map + playable subset
  // ------------------------------------------------------------------
  class Board {
    constructor(map, scenario) {
      this.map = map;
      this.T = {};
      for (const t of map.territories) this.T[t.id] = t;
      this.playable = new Set((scenario && scenario.playable && scenario.playable.length)
        ? scenario.playable.filter((id) => this.T[id]) : map.territories.map((t) => t.id));
      this.adj = {};
      for (const id of this.playable) this.adj[id] = (this.T[id].adj || []).filter((a) => this.playable.has(a));
      this.canals = [];
      for (const c of map.canals || []) {
        if (this.playable.has(c.a) && this.playable.has(c.b)) {
          this.canals.push(c);
          if (!this.adj[c.a].includes(c.b)) this.adj[c.a].push(c.b);
          if (!this.adj[c.b].includes(c.a)) this.adj[c.b].push(c.a);
        }
      }
      // a canal (or controlled strait) restricts ships between its two sea zones
      this.canalKey = {};
      for (const c of this.canals) {
        for (const k of [c.a + '|' + c.b, c.b + '|' + c.a]) (this.canalKey[k] = this.canalKey[k] || []).push(c);
      }
      this.powers = {};
      for (const p of map.powers || []) this.powers[p.id] = p;
    }
    isSea(id) { return this.T[id].type === 'sea'; }
    isLand(id) { return this.T[id].type !== 'sea'; }
    ipc(id) { return this.T[id].ipc || 0; }
    name(id) { return this.T[id] ? this.T[id].name : id; }
  }

  // ------------------------------------------------------------------
  // Game
  // ------------------------------------------------------------------
  class Game {
    constructor(map, scenario, state) {
      this.map = map;
      this.sc = scenario;
      this.B = new Board(map, scenario);
      this.R = Rules.get(scenario.ruleset);
      this.s = state;
      const b = state && state.battle;
      if (b && !b.over) {
        // battles saved before the round was split into attacker and defender fire
        if (b.step === 'fire') b.step = 'fireA';
        if (b.held) { delete b.held; if (b.need === 'casualties') b.need = 'roll'; }
      }
    }

    static create(map, scenario, opts) {
      opts = opts || {};
      const g = new Game(map, scenario, null);
      const errs = Game.validate(map, scenario).filter((e) => e.level === 'error');
      if (errs.length && !opts.force) throw new Error(errs.map((e) => e.msg).join('; '));
      const R = g.R;
      const powers = {};
      const order = (scenario.turnOrder && scenario.turnOrder.length)
        ? scenario.turnOrder.filter((p) => scenario.powers[p])
        : R.turnOrder.filter((p) => scenario.powers[p]).concat(Object.keys(scenario.powers).filter((p) => !R.turnOrder.includes(p)));
      for (const p of Object.keys(scenario.powers)) {
        const sp = scenario.powers[p];
        const mp = g.B.powers[p] || {};
        powers[p] = {
          team: sp.team || mp.team || 'Allies', ai: sp.controller !== 'human', money: sp.money | 0,
          capital: null, unplaced: {},
        };
      }
      const terr = {};
      let nextId = 1;
      for (const id of g.B.playable) {
        const t = g.B.T[id];
        const st = (scenario.setup && scenario.setup[id]) || {};
        const owner = t.type === 'sea' ? null : (st.owner !== undefined ? st.owner : (t.owner || null));
        terr[id] = { o: owner && powers[owner] ? owner : (owner ? null : null), u: [], dmg: st.dmg | 0, conq: false };
        if (t.type !== 'sea' && owner && !powers[owner]) terr[id].o = null;
        if (t.type !== 'sea' && st.owner === undefined && t.owner && !powers[t.owner]) terr[id].o = null;
        const us = st.units || {};
        for (const p of Object.keys(us)) {
          if (!powers[p]) continue;
          for (const type of Object.keys(us[p])) {
            if (!R.units[type]) continue;
            for (let k = 0; k < (us[p][type] | 0); k++) terr[id].u.push(g._mkUnit(nextId++, type, p));
          }
        }
      }
      // capitals: scenario override, else the map's (most valuable) capital for that power if playable
      for (const id of g.B.playable) {
        const t = g.B.T[id];
        if (!t.capital || !powers[t.capital]) continue;
        const cur = powers[t.capital].capital;
        if (!cur || g.B.ipc(id) > g.B.ipc(cur)) powers[t.capital].capital = id;
      }
      for (const p of Object.keys(scenario.powers)) {
        const c = scenario.powers[p].capital;
        if (c !== undefined) powers[p].capital = c && g.B.playable.has(c) ? c : null;
      }
      const s = {
        v: 1, scenarioId: scenario.id || 'custom', mapId: map.id, rules: R.id,
        round: 1, turn: 0, order, phase: 'purchase', maxTurns: scenario.maxTurns || 5,
        powers, terr, nextId, rng: opts.seed != null ? opts.seed | 0 : randomSeed(),
        buy: {}, battles: [], battle: null, startOwned: {},
        stats: {}, losses: {}, history: [], log: [], result: null, origOwner: {},
      };
      for (const id of Object.keys(terr)) if (terr[id].o) s.origOwner[id] = terr[id].o;
      for (const p of Object.keys(powers)) if (!s.stats[powers[p].team]) s.stats[powers[p].team] = { exp: 0, act: 0, v: 0, n: 0 };
      g.s = s;
      // a set income per turn changes from here as territories change hands
      for (const p of Object.keys(powers)) powers[p].startInc = g.landIncome(p);
      // load setup cargo onto transports
      for (const id of Object.keys(terr)) {
        if (!g.B.isSea(id)) continue;
        const land = terr[id].u.filter((u) => R.units[u.t].domain === 'land');
        for (const u of land) {
          const tr = terr[id].u.find((x) => x.o === u.o && R.units[x.t].transport && g._space(x, id) >= R.units[u.t].transportCost);
          if (tr) u.tr = tr.id;
          else terr[id].u.splice(terr[id].u.indexOf(u), 1);
        }
      }
      g._startTurn();
      return g;
    }

    /** Problems with a scenario: [{level:'error'|'warn', msg}] */
    static validate(map, sc) {
      const out = [];
      const err = (msg) => out.push({ level: 'error', msg });
      const warn = (msg) => out.push({ level: 'warn', msg });
      const T = {};
      for (const t of map.territories) T[t.id] = t;
      if (!sc.powers || !Object.keys(sc.powers).length) err('No powers in the scenario');
      const humans = Object.keys(sc.powers || {}).filter((p) => sc.powers[p].controller === 'human');
      if (!humans.length) err('Choose at least one power for the player');
      const teams = new Set(humans.map((p) => sc.powers[p].team));
      // a play test of both sides fixes the player's team instead (sc.playerTeam)
      if (teams.size > 1 && !sc.playerTeam) err('All player powers must be on the same team');
      for (const p of Object.keys(sc.powers || {})) {
        const inc = sc.powers[p].income;
        if (inc != null && !(inc >= 0)) err(`${p}: IPCs per turn must be 0 or more`);
        else if (inc != null && sc.income === false) warn(`Income is off, so ${p} does not collect its ${inc} IPCs per turn`);
      }
      const ais = Object.keys(sc.powers || {}).filter((p) => sc.powers[p].controller !== 'human');
      if (!ais.length) warn('There is no computer opponent');
      if (!sc.playable || !sc.playable.length) err('No playable territories');
      const mineObj = (sc.objectives || []).filter((o) => o.side !== 'opponent');
      if (!mineObj.length) err('Add at least one objective for the player');
      if (!(sc.maxTurns >= 1)) err('Max turns must be at least 1');
      if (sc.winCheck === 'turn' && !(sc.checkTurn >= 1 && sc.checkTurn <= sc.maxTurns)) err('The turn objectives are checked on must be between 1 and the last turn');
      const ipcType = (o) => o.type === 'bank' || o.type === 'damage';
      const capTotal = mineObj.filter((o) => o.type !== 'hold').reduce((a, o) => a + (ipcType(o) ? 1 : (o.territories || []).length), 0);
      if (sc.objectivesNeeded && sc.objectivesNeeded > capTotal) warn(`Objectives needed (${sc.objectivesNeeded}) is more than the ${capTotal} objective targets; all are required`);
      const R = Rules.get(sc.ruleset);
      const play = new Set(sc.playable || []);
      for (const o of sc.objectives || []) {
        if (o.type === 'bank') { if (!(o.ipc > 0)) err('A bank objective needs an amount of IPC'); continue; }
        if (o.type === 'damage') {
          if (!(o.inflict > 0)) err('A damage objective needs an amount of IPC to inflict');
          if (o.maxLoss != null && !(o.maxLoss >= 0)) err('A damage objective\'s loss limit must be 0 or more');
          continue;
        }
        if (o.side === 'opponent' && o.type === 'hold') err('Opponent objectives can capture, clear, bank or inflict damage, not hold');
        for (const id of o.territories || []) {
          if (!T[id]) err(`Objective territory ${id} is not on the map`);
          else if (!play.has(id)) err(`Objective ${T[id].name} is not playable`);
        }
        if (!(o.territories || []).length) err('An objective has no territories');
      }
      for (const id of Object.keys(sc.setup || {})) {
        if (!T[id]) { err(`Setup names unknown territory ${id}`); continue; }
        if (!play.has(id)) continue;
        const us = sc.setup[id].units || {};
        for (const p of Object.keys(us)) {
          if (!sc.powers[p]) err(`${T[id].name}: units for ${p}, who is not in the scenario`);
          for (const type of Object.keys(us[p])) {
            const d = R.units[type];
            if (!d) { warn(`${T[id].name}: ${type} does not exist in ${R.name} rules`); continue; }
            if (T[id].type === 'sea' && d.domain === 'land') {
              // must fit on transports
            } else if (T[id].type !== 'sea' && d.domain === 'sea') err(`${T[id].name}: ships on land`);
          }
        }
      }
      return out;
    }

    // ---------------- basics ----------------
    _mkUnit(id, t, o) {
      const d = this.R.units[t];
      return { id, t, o, ml: d.move, h: 0 };
    }
    get phase() { return this.s.phase; }
    current() { return this.s.order[this.s.turn]; }
    team(p) { return p && this.s.powers[p] ? this.s.powers[p].team : null; }
    /** The player's side. A play test can hand control of any side to a person (sc.playerTeam keeps it fixed). */
    humanTeam() {
      if (this.sc.playerTeam) return this.sc.playerTeam;
      for (const p of Object.keys(this.s.powers)) if (!this.s.powers[p].ai) return this.s.powers[p].team;
      return null;
    }
    isHuman(p) { return this.s.powers[p] && !this.s.powers[p].ai; }
    isEnemy(p, q) { return !!p && !!q && this.team(p) !== this.team(q); }
    friendlyOwner(id, p) { const o = this.s.terr[id].o; return !!o && this.team(o) === this.team(p); }
    units(id) { return this.s.terr[id] ? this.s.terr[id].u : []; }
    unit(uid) {
      for (const id of Object.keys(this.s.terr)) {
        const u = this.s.terr[id].u.find((x) => x.id === uid);
        if (u) return u;
      }
      return null;
    }
    whereIs(uid) {
      for (const id of Object.keys(this.s.terr)) if (this.s.terr[id].u.some((x) => x.id === uid)) return id;
      return null;
    }
    def(u) { return this.R.units[typeof u === 'string' ? u : u.t]; }
    enemies(id, p) { return this.units(id).filter((u) => this.isEnemy(u.o, p)); }
    log(msg) {
      this.s.log.push({ r: this.s.round, p: this.current(), m: msg });
      if (this.s.log.length > 400) this.s.log.splice(0, this.s.log.length - 400);
    }
    roll(team, value) {
      const r = rngNext(this.s.rng);
      this.s.rng = r[0];
      const die = 1 + Math.floor(r[1] * 6);
      const st = this.s.stats[team] || (this.s.stats[team] = { exp: 0, act: 0, v: 0, n: 0 });
      const p = Math.max(0, Math.min(6, value)) / 6;
      const hit = die <= value;
      st.exp += p; st.v += p * (1 - p); st.act += hit ? 1 : 0; st.n += 1;
      return { die, hit };
    }
    _space(tr, at) {
      const d = this.def(tr);
      let used = 0;
      for (const u of this.units(at)) if (u.tr === tr.id) used += this.def(u).transportCost || 3;
      return d.capacity - used;
    }
    cargo(tr, at) { return this.units(at || this.whereIs(tr.id)).filter((u) => u.tr === tr.id); }
    blocksShips(u, mover) {
      const d = this.def(u);
      if (d.domain !== 'sea') return false;
      if (mover && this.def(mover).sub) return !!d.antiSub;
      if (d.sub) return !!this.R.subsBlock;
      if (d.transport) return !!this.R.transportsBlock;
      return true;
    }
    hostileSurface(id, p) {
      return this.enemies(id, p).some((u) => { const d = this.def(u); return d.domain === 'sea' && !d.sub && !d.transport; });
    }

    // ---------------- turn flow ----------------
    _startTurn() {
      const p = this.current();
      this.s.phase = this.sc.purchase === false ? 'combatMove' : 'purchase';
      this.s.buy = {};
      this.s.battles = [];
      this.s.battle = null;
      this.s.startOwned = {};
      for (const id of Object.keys(this.s.terr)) {
        const t = this.s.terr[id];
        t.conq = false;
        if (t.o) this.s.startOwned[id] = t.o;
        for (const u of t.u) {
          if (u.o !== p) continue;
          u.ml = this.def(u).move;
          delete u.cm; delete u.f; delete u.mv; delete u.prev; delete u.amph; delete u.unl; delete u.trWas; delete u.loaded; delete u.sub;
        }
      }
      this.log(`${p}: turn ${this.s.round} begins`);
    }

    /** Advance to the next phase. Returns {ok, error?, lost?: [...]} */
    nextPhase() {
      const s = this.s;
      if (s.phase === 'gameOver') return { ok: false, error: 'The game is over' };
      if (s.phase === 'purchase') {
        s.phase = 'combatMove';
        return { ok: true };
      }
      if (s.phase === 'combatMove') {
        s.battles = this.findBattles();
        s.battleCount = s.battles.length;
        s.phase = 'combat';
        if (!s.battles.length) s.phase = 'noncombatMove';
        return { ok: true };
      }
      if (s.phase === 'combat') {
        if (s.battle) return { ok: false, error: 'Finish the current battle first' };
        if (s.battles.length) return { ok: false, error: 'Fight every battle first' };
        s.phase = 'noncombatMove';
        return { ok: true };
      }
      if (s.phase === 'noncombatMove') {
        const lost = this.crashAir();
        if (this.sc.purchase === false && !Object.values(s.buy || {}).some((n) => n > 0) && !Object.values(s.powers[this.current()].unplaced || {}).some((n) => n > 0)) {
          this.endTurn();
          return { ok: true, lost };
        }
        s.phase = 'place';
        return { ok: true, lost };
      }
      if (s.phase === 'place') {
        this.endTurn();
        return { ok: true };
      }
      return { ok: false, error: 'Unknown phase' };
    }

    endTurn() {
      const s = this.s;
      const p = this.current();
      // unplaced units carry over
      const left = {};
      for (const k of Object.keys(s.buy)) if (s.buy[k] > 0) left[k] = s.buy[k];
      s.powers[p].unplaced = left;
      s.buy = {};
      // income
      if (this.sc.income !== false) {
        const cap = s.powers[p].capital;
        if (!cap || this.s.terr[cap].o === p) {
          const inc = this.income(p);
          s.powers[p].money += inc;
          if (inc) this.log(`${p} collects ${inc} IPCs`);
        } else this.log(`${p} has lost its capital and collects nothing`);
      }
      // repair multi-hit ships
      for (const id of Object.keys(s.terr)) for (const u of s.terr[id].u) if (u.o === p && u.h && this.def(u).hp > 1) u.h = 0;
      this._recordHistory(p);
      if (this._checkEnd('turn', p)) return;
      s.turn++;
      if (s.turn >= s.order.length) {
        if (this._checkEnd('round', p)) return;
        s.turn = 0;
        s.round++;
      }
      this._startTurn();
    }

    /** IPC value of the territories `p` holds in play. */
    landIncome(p) {
      let n = 0;
      for (const id of Object.keys(this.s.terr)) if (this.s.terr[id].o === p) n += this.B.ipc(id);
      return n;
    }
    /**
     * What `p` collects at the end of its turn. By default, the value of the territories it holds. A
     * scenario can set the amount per turn instead (powers[p].income); captures and losses then still
     * change it by those territories' values, unless powers[p].incomeFixed keeps it the same throughout.
     */
    income(p) {
      const land = this.landIncome(p);
      const sp = (this.sc.powers || {})[p];
      if (!sp || sp.income == null || !(sp.income >= 0)) return land;
      if (sp.incomeFixed) return sp.income | 0;
      const start = this.s.powers[p].startInc != null ? this.s.powers[p].startInc : land;
      return Math.max(0, (sp.income | 0) + land - start);
    }

    // ---------------- objectives ----------------
    // Objective types: capture, hold, destroy (clear) take territories; bank {ipc} needs that much money
    // in the side's treasury; damage {inflict, maxLoss} needs that much enemy unit value destroyed while
    // losing no more than maxLoss. side 'opponent' marks the computer's objectives (it wins by meeting them).
    _objStatus(o) {
      const ht = this.humanTeam();
      const side = o.side === 'opponent' ? 'opponent' : 'player';
      const mine = (team) => (side === 'player' ? team === ht : !!team && team !== ht);
      const type = o.type || 'capture';
      if (type === 'bank') {
        const have = Object.keys(this.s.powers).filter((p) => mine(this.team(p))).reduce((a, p) => a + (this.s.powers[p].money || 0), 0);
        const met = have >= (o.ipc || 0);
        return { type, side, territories: [], done: met ? 1 : 0, total: 1, met, have, ipc: o.ipc || 0 };
      }
      if (type === 'damage') {
        const L = this.s.losses || {};
        let inflicted = 0, taken = 0;
        for (const t of Object.keys(L)) { if (mine(t)) taken += L[t]; else inflicted += L[t]; }
        const met = inflicted >= (o.inflict || 0) && (o.maxLoss == null || taken <= o.maxLoss);
        return { type, side, territories: [], done: met ? 1 : 0, total: 1, met, inflicted, taken, inflict: o.inflict || 0, maxLoss: o.maxLoss };
      }
      const ids = o.territories || [];
      let done = 0;
      for (const id of ids) if (this._territoryMet(type, id, mine)) done++;
      return { type, side, territories: ids, done, total: ids.length, met: done === ids.length };
    }
    _territoryMet(type, id, mine) {
      if (type === 'destroy') return !this.units(id).some((u) => !mine(this.team(u.o)) && !this.def(u).infrastructure);
      return !!(this.s.terr[id] && this.s.terr[id].o && mine(this.team(this.s.terr[id].o)));
    }
    /** The player's objectives with progress: [{type, side, territories, done, total, met, ...}]. */
    objectiveStatus() {
      return (this.sc.objectives || []).filter((o) => o.side !== 'opponent').map((o) => this._objStatus(o));
    }
    /** The computer's objectives (it wins when all are met at the end of one of its turns). */
    opponentStatus() {
      return (this.sc.objectives || []).filter((o) => o.side === 'opponent').map((o) => this._objStatus(o));
    }
    _targets(side) {
      const out = [];
      for (const o of this.sc.objectives || []) {
        if ((o.side === 'opponent') !== (side === 'opponent')) continue;
        const type = o.type || 'capture';
        if (type === 'bank' || type === 'damage') { out.push({ id: null, type, met: this._objStatus(o).met }); continue; }
        const ht = this.humanTeam();
        const mine = (team) => (side === 'opponent' ? !!team && team !== ht : team === ht);
        for (const id of o.territories || []) out.push({ id, type, met: this._territoryMet(type, id, mine) });
      }
      return out;
    }
    /** One entry per player objective target: {id, type, met} (id is null for IPC objectives). */
    objectiveTargets() { return this._targets('player'); }
    /** The same for the computer's objectives. */
    opponentTargets() { return this._targets('opponent'); }
    /** How many capture/clear/IPC targets the player must meet to win (all unless the puzzle says fewer). */
    objectivesNeeded() {
      const total = this.objectiveTargets().filter((t) => t.type !== 'hold').length;
      const n = this.sc.objectivesNeeded | 0;
      return n > 0 ? Math.min(n, total) : total;
    }
    progress() {
      const st = this.objectiveStatus();
      let d = 0, t = 0;
      for (const o of st) { d += o.done; t += o.total; }
      return t ? d / t : 0;
    }
    _recordHistory(p) {
      const s = this.s;
      const ht = this.humanTeam();
      if (this.team(p) !== ht) return;
      const humans = s.order.filter((q) => this.team(q) === ht);
      if (humans[humans.length - 1] !== p) return;
      s.history.push({ round: s.round, progress: this.progress(), met: this.objectiveStatus().map((o) => o.met) });
    }
    _checkEnd(moment, p) {
      const s = this.s;
      const st = this.objectiveStatus();
      const holds = st.filter((o) => o.type === 'hold');
      const others = st.filter((o) => o.type !== 'hold');
      const ht = this.humanTeam();
      const finish = (won, reason) => {
        s.result = { won, turns: s.round, maxTurns: s.maxTurns, reason, progress: this.progress() };
        s.phase = 'gameOver';
        this.log(won ? `Victory! ${reason}` : `Defeat. ${reason}`);
        return true;
      };
      // Losing a held territory at the end of any turn ends the game
      for (const o of holds) {
        if (!o.met) return finish(false, `Lost ${o.territories.filter((id) => !(s.terr[id].o && this.team(s.terr[id].o) === ht)).map((id) => this.B.name(id)).join(', ')}`);
      }
      // Player wiped out
      const alive = Object.keys(s.terr).some((id) => s.terr[id].o && this.team(s.terr[id].o) === ht) ||
        Object.keys(s.terr).some((id) => s.terr[id].u.some((u) => this.team(u.o) === ht));
      if (!alive) return finish(false, 'Your forces were wiped out');
      // the computer wins by meeting all its objectives at the end of one of its turns
      const opp = this.opponentStatus().filter((o) => o.type !== 'hold');
      if (moment === 'turn' && opp.length && this.team(p) !== ht && opp.every((o) => o.met)) {
        return finish(false, 'The enemy met its objectives');
      }
      const allOthers = others.reduce((a, o) => a + o.done, 0) >= this.objectivesNeeded();
      const humanTurnEnd = moment === 'turn' && this.team(p) === ht && this._lastHumanInRound(p);
      // winCheck: 'turnEnd' (end of the player's turn), 'roundEnd' (after the counterattack), or
      // 'turn' (only at the end of the player's turn checkTurn, which also ends the game)
      const last = this.sc.winCheck === 'turn' ? Math.min(s.maxTurns, this.sc.checkTurn || s.maxTurns) : s.maxTurns;
      const check = this.sc.winCheck === 'roundEnd' ? moment === 'round'
        : this.sc.winCheck === 'turn' ? humanTurnEnd && s.round === last
          : (holds.length ? moment === 'round' : humanTurnEnd);
      if (check && allOthers && (!holds.length || s.round >= last) && (others.length || s.round >= last)) {
        return finish(true, `Objectives complete in ${s.round} turn${s.round === 1 ? '' : 's'}`);
      }
      if (this.sc.winCheck === 'turn' && check) return finish(false, `Objectives not met by the end of turn ${last}`);
      if (s.round >= s.maxTurns) {
        const noMoreChances = (check && (others.length || holds.length)) ||
          (moment === 'round');
        if (noMoreChances) return finish(false, `Out of turns (${s.maxTurns})`);
      }
      return false;
    }
    _lastHumanInRound(p) {
      const ht = this.humanTeam();
      const humans = this.s.order.filter((q) => this.team(q) === ht);
      return humans[humans.length - 1] === p;
    }

    // ---------------- purchase ----------------
    buyable() {
      return Rules.UNIT_ORDER.filter((t) => this.R.units[t]);
    }
    spent() {
      let n = 0;
      for (const k of Object.keys(this.s.buy)) n += (this.s.buy[k] || 0) * this.R.units[k].cost;
      return n;
    }
    buy(type, delta) {
      if (this.s.phase !== 'purchase') return { ok: false, error: 'Not the purchase phase' };
      if (this.sc.purchase === false) return { ok: false, error: 'Purchasing is off in this puzzle' };
      const d = this.R.units[type];
      if (!d) return { ok: false, error: 'Unknown unit' };
      const cur = this.s.buy[type] || 0;
      const n = Math.max(0, cur + delta);
      const money = this.s.powers[this.current()].money;
      const cost = this.spent() + (n - cur) * d.cost;
      if (cost > money) return { ok: false, error: 'Not enough IPCs' };
      this.s.buy[type] = n;
      if (!n) delete this.s.buy[type];
      return { ok: true };
    }
    /** Pay for purchases (called when the purchase phase ends) */
    commitPurchase() {
      const p = this.current();
      const cost = this.spent();
      this.s.powers[p].money -= cost;
      const un = this.s.powers[p].unplaced || {};
      const bought = Object.assign({}, this.s.buy);
      for (const k of Object.keys(un)) this.s.buy[k] = (this.s.buy[k] || 0) + un[k];
      this.s.powers[p].unplaced = {};
      if (cost) this.log(`${p} buys ${Object.keys(bought).map((k) => bought[k] + ' ' + this.R.units[k].name).join(', ')}`);
    }

    // ---------------- movement ----------------
    /** Which of the current power's units at `id` may move now. */
    movable(id) {
      const p = this.current();
      const ph = this.s.phase;
      if (ph !== 'combatMove' && ph !== 'noncombatMove') return [];
      return this.units(id).filter((u) => u.o === p && this.canUnitMove(u, id));
    }
    canUnitMove(u, at) {
      const d = this.def(u);
      const ph = this.s.phase;
      if (d.move === 0 || d.infrastructure && d.move === 0) return false;
      if (u.tr) {
        // cargo can unload unless its transport already unloaded
        const tr = this.units(at).find((x) => x.id === u.tr);
        return !!tr && !tr.unl && !(ph === 'noncombatMove' && (tr.f));
      }
      if (u.ml <= 0) return false;
      if (ph === 'combatMove' && d.noCombatMove) return false;
      if (ph === 'noncombatMove' && d.domain !== 'air' && (u.cm || u.f)) return false;
      if (d.transport && u.unl) return false;
      return true;
    }

    /** BFS distance for air units (any playable, non-neutral land or sea). */
    airDist(from, maxD) {
      const dist = { [from]: 0 };
      const q = [from];
      while (q.length) {
        const x = q.shift();
        if (dist[x] >= maxD) continue;
        for (const y of this.B.adj[x]) {
          if (dist[y] !== undefined) continue;
          if (this.B.isLand(y) && !this.s.terr[y].o && this.B.T[y].neutral !== false && !this.s.terr[y].u.length) {
            // neutral land: impassable
            if (!this.s.terr[y].o) continue;
          }
          dist[y] = dist[x] + 1;
          q.push(y);
        }
      }
      return dist;
    }

    /**
     * Route for one unit from `from` to `to` in the current phase.
     * Returns {path:[...], blitz:[ids]} or {error}.
     */
    route(u, from, to) {
      const d = this.def(u);
      const p = u.o;
      const ph = this.s.phase;
      const combat = ph === 'combatMove';
      if (from === to) return { error: 'Already there' };
      if (!this.B.playable.has(to)) return { error: 'Not in play' };
      const toSea = this.B.isSea(to);
      if (d.domain === 'air') {
        const dist = this.airDist(from, u.ml);
        if (dist[to] === undefined) return { error: 'Out of range' };
        if (!toSea && !this.s.terr[to].o) return { error: 'Neutral territory' };
        const hostile = this.enemies(to, p).length > 0;
        if (combat) {
          if (!hostile && !this.friendlyOwner(to, p) && !toSea) return { error: 'Aircraft cannot capture territory' };
        } else if (hostile && !this.enemies(to, p).every((e) => !this.blocksShips(e) && toSea)) {
          return { error: 'Cannot move into enemy units now' };
        } else if (!toSea && !this.friendlyOwner(to, p)) return { error: 'Must stay in friendly territory' };
        if (d.bomber && toSea && !hostile) return { error: 'Bombers cannot land at sea' };
        // aircraft may only go where they can still get back to a friendly landing spot
        if (!this.canLandFrom(u, to, u.ml - dist[to])) return { error: 'Could not return to friendly territory from there' };
        return { path: this._pathFromDist(from, to, dist), cost: dist[to] };
      }
      if (d.domain === 'sea') {
        if (!toSea) return { error: 'Ships stay at sea' };
        const passable = (x) => !this.enemies(x, p).some((e) => this.blocksShips(e, u));
        const dist = { [from]: 0 }; const prev = {};
        const q = [from];
        while (q.length) {
          const x = q.shift();
          if (dist[x] >= u.ml) continue;
          if (x !== from && !passable(x)) continue; // must stop in hostile zones
          for (const y of this.B.adj[x]) {
            if (!this.B.isSea(y) || dist[y] !== undefined) continue;
            const canals = this.B.canalKey[x + '|' + y];
            if (canals && !canals.some((c) => c.requires.every((r) => this._canalFriendly(r, p)))) continue;
            dist[y] = dist[x] + 1; prev[y] = x; q.push(y);
          }
        }
        if (dist[to] === undefined) return { error: 'Out of range or blocked' };
        // in noncombat, ships end only where no enemy ship would stop them; submarines may end in a hostile sea zone
        const subFree = d.sub && this.R.subsEnterHostileNoncombat;
        if (!combat && !subFree && this.enemies(to, p).some((e) => this.blocksShips(e, u))) {
          return { error: 'Enemy ships there (combat move only)' };
        }
        if (!combat && !subFree && this.enemies(to, p).some((e) => this.blocksShips(e))) {
          return { error: 'Enemy ships there' };
        }
        const path = [to];
        while (path[0] !== from) path.unshift(prev[path[0]]);
        return { path, cost: dist[to] };
      }
      // land
      if (toSea) return { error: 'Load onto a transport instead' };
      const destHostile = !this.friendlyOwner(to, p);
      if (!this.s.terr[to].o) return { error: 'Neutral territory' };
      if (destHostile && !combat) return { error: 'Attacks happen in the combat move' };
      // BFS preferring friendly paths; blitz through empty enemy land for tanks in combat
      let best = null;
      const tryBfs = (allowBlitz) => {
        const dist = { [from]: 0 }; const prev = {};
        const q = [from];
        while (q.length) {
          const x = q.shift();
          if (dist[x] >= u.ml) continue;
          if (x !== from) {
            const friendly = this.friendlyOwner(x, p);
            if (!friendly) {
              if (!(allowBlitz && d.blitz && combat && this.enemies(x, p).every((e) => this.def(e).infrastructure))) continue;
              if (!this.s.terr[x].o) continue;
            }
          }
          for (const y of this.B.adj[x]) {
            if (this.B.isSea(y) || dist[y] !== undefined) continue;
            if (!this.s.terr[y].o) continue;
            dist[y] = dist[x] + 1; prev[y] = x; q.push(y);
          }
        }
        if (dist[to] === undefined) return null;
        const path = [to];
        while (path[0] !== from) path.unshift(prev[path[0]]);
        const blitz = path.slice(1, -1).filter((x) => !this.friendlyOwner(x, p));
        return { path, cost: dist[to], blitz };
      };
      best = tryBfs(false) || tryBfs(true);
      if (!best) return { error: 'Out of range' };
      return best;
    }
    /** Canal land: its current owner if in play, else its starting owner on the map. */
    _canalFriendly(r, p) {
      if (this.s.terr[r]) return this.friendlyOwner(r, p);
      const o = this.B.T[r] && this.B.T[r].owner;
      return !!o && this.B.powers[o] && this.B.powers[o].team === this.team(p);
    }
    _pathFromDist(from, to, dist) {
      const path = [to];
      let cur = to;
      while (cur !== from) {
        const nb = this.B.adj[cur].find((y) => dist[y] === dist[cur] - 1);
        if (!nb) break;
        path.unshift(nb);
        cur = nb;
      }
      return path;
    }

    /**
     * Check a move of these unit ids (all at `from`) to `to`.
     * Returns {ok, kind, error, plan:[{uid, path}], warn}
     */
    checkMove(from, uids, to, opts) {
      opts = opts || {};
      const p = this.current();
      if (this.s.phase !== 'combatMove' && this.s.phase !== 'noncombatMove') return { ok: false, error: 'Not a movement phase' };
      if (!uids.length) return { ok: false, error: 'No units selected' };
      const here = this.units(from);
      const us = uids.map((id) => here.find((u) => u.id === id));
      if (us.some((u) => !u)) return { ok: false, error: 'Units are not there' };
      if (us.some((u) => u.o !== p)) return { ok: false, error: 'Not your units' };
      for (const u of us) if (!this.canUnitMove(u, from)) return { ok: false, error: `${this.def(u).name} cannot move now` };
      const combat = this.s.phase === 'combatMove';
      // unload: all selected are cargo
      if (us.every((u) => u.tr)) {
        if (!this.B.isLand(to) || !this.B.adj[from].includes(to)) return { ok: false, error: 'Unload into an adjacent coastal territory' };
        if (!this.s.terr[to].o) return { ok: false, error: 'Neutral territory' };
        const hostile = !this.friendlyOwner(to, p);
        if (hostile && !combat) return { ok: false, error: 'Amphibious assaults happen in the combat move' };
        if (this.hostileSurface(from, p) && !(combat && this._attackingHere(from))) {
          return { ok: false, error: 'Clear the enemy warships first' };
        }
        return { ok: true, kind: hostile ? 'amphibious' : 'unload', plan: us.map((u) => ({ uid: u.id, path: [from, to] })) };
      }
      if (us.some((u) => u.tr)) return { ok: false, error: 'Unload cargo separately from other units' };
      // load: land units into a sea zone
      if (this.B.isSea(to) && us.every((u) => this.def(u).domain === 'land')) {
        if (!this.B.adj[from].includes(to)) return { ok: false, error: 'Load from a territory next to that sea zone' };
        if (this.hostileSurface(to, p)) return { ok: false, error: 'Enemy warships are there' };
        const trs = this.units(to).filter((x) => x.o === p && this.def(x).transport && !x.unl);
        if (!trs.length) return { ok: false, error: 'No transport there' };
        const space = {};
        for (const t of trs) space[t.id] = this._space(t, to);
        const assign = [];
        // put infantry with others first, greedy by space
        const sorted = us.slice().sort((a, b) => (this.def(b).transportCost || 3) - (this.def(a).transportCost || 3));
        for (const u of sorted) {
          const c = this.def(u).transportCost || 3;
          const prefer = opts.transport ? trs.filter((t) => t.id === opts.transport) : [];
          const cand = prefer.concat(trs.filter((t) => !prefer.includes(t)))
            .filter((t) => space[t.id] >= c)
            .sort((a, b) => space[a.id] - space[b.id]);
          if (!cand.length) return { ok: false, error: 'Not enough transport space' };
          space[cand[0].id] -= c;
          assign.push({ uid: u.id, path: [from, to], tr: cand[0].id });
        }
        return { ok: true, kind: 'load', plan: assign };
      }
      const plan = [];
      let kind = 'move';
      for (const u of us) {
        const r = this.route(u, from, to);
        if (r.error) return { ok: false, error: `${this.def(u).name}: ${r.error}` };
        plan.push({ uid: u.id, path: r.path, blitz: r.blitz || [] });
      }
      if (this.enemies(to, p).length && this.enemies(to, p).some((e) => !this.def(e).infrastructure)) kind = 'attack';
      else if (this.B.isLand(to) && !this.friendlyOwner(to, p)) kind = 'capture';
      if (plan.some((x) => x.blitz.length)) kind = kind === 'move' ? 'blitz' : kind;
      // (aircraft that could not get back were already refused in route())
      return { ok: true, kind, plan, warn: null };
    }
    _attackingHere(sea) {
      return this.units(sea).some((u) => u.o === this.current() && u.cm && this.def(u).domain === 'sea' && !this.def(u).transport) &&
        this.enemies(sea, this.current()).length > 0;
    }
    /**
     * Can aircraft `u`, once at `at` with `left` movement, still reach a landing spot this turn?
     * Landing spots: friendly land held since the start of the turn (not captured this turn, no
     * enemies), or for fighters a sea zone with a friendly carrier, including zones the
     * current power's own carriers can still sail to this turn.
     */
    canLandFrom(u, at, left, strict) {
      const p = u.o;
      const d = this.def(u);
      if (left < 0) return false;
      const dist = this.airDist(at, Math.max(0, left));
      const carriers = d.bomber ? null : this._carrierZones(p, strict);
      for (const id of Object.keys(dist)) {
        if (this.B.isLand(id)) {
          if (this.friendlyOwner(id, p) && this.s.startOwned[id] && this.team(this.s.startOwned[id]) === this.team(p) && !this.enemies(id, p).length) return true;
        } else if (carriers && carriers.has(id)) return true;
      }
      return false;
    }
    /** Sea zones where a friendly carrier is, or that one of the mover's carriers can still reach. */
    _carrierZones(p, strict) {
      const out = new Set();
      const me = this.current();
      for (const id of Object.keys(this.s.terr)) {
        if (!this.B.isSea(id)) continue;
        for (const c of this.s.terr[id].u) {
          if (this.team(c.o) !== this.team(p) || !this.def(c).carrierCapacity) continue;
          out.add(id);
          // the moving power's own carriers that can still sail this turn
          const canSail = !strict && c.o === me && c.ml > 0 && !c.f && (this.s.phase === 'combatMove' || !c.cm);
          if (!canSail) continue;
          const dist = { [id]: 0 };
          const q = [id];
          while (q.length) {
            const x = q.shift();
            if (dist[x] >= c.ml) continue;
            if (x !== id && this.enemies(x, c.o).some((e) => this.blocksShips(e, c))) continue;
            for (const y of this.B.adj[x]) {
              if (!this.B.isSea(y) || dist[y] !== undefined) continue;
              const canals = this.B.canalKey[x + '|' + y];
              if (canals && !canals.some((k) => k.requires.every((r) => this._canalFriendly(r, c.o)))) continue;
              dist[y] = dist[x] + 1;
              q.push(y);
            }
          }
          for (const z of Object.keys(dist)) if (!this.enemies(z, c.o).some((e) => this.blocksShips(e, c))) out.add(z);
        }
      }
      return out;
    }

    /** Destinations for highlight: {tid: kind} */
    destinations(from, uids) {
      const out = {};
      for (const id of this.B.playable) {
        if (id === from) continue;
        const r = this.checkMove(from, uids, id);
        if (r.ok) out[id] = r.kind;
      }
      return out;
    }

    move(from, uids, to, opts) {
      const r = this.checkMove(from, uids, to, opts);
      if (!r.ok) return r;
      const p = this.current();
      const combat = this.s.phase === 'combatMove';
      const src = this.s.terr[from];
      const moved = [];
      for (const step of r.plan) {
        const u = src.u.find((x) => x.id === step.uid);
        const d = this.def(u);
        if (r.kind === 'load') {
          u.ml = 0; u.tr = step.tr; u.loaded = true; u.prev = from;
          if (combat) u.cm = true;
          u.mv = true;
          this._moveUnit(u, from, to);
          moved.push(u);
          continue;
        }
        if (r.kind === 'unload' || r.kind === 'amphibious') {
          const tr = src.u.find((x) => x.id === u.tr);
          if (tr) { tr.unl = true; tr.ml = 0; }
          u.trWas = u.tr; delete u.tr;
          u.ml = 0; u.mv = true; u.prev = from;
          if (combat) u.cm = true;
          if (r.kind === 'amphibious') u.amph = from;
          this._moveUnit(u, from, to);
          moved.push(u);
          continue;
        }
        const cost = step.path.length - 1;
        // blitzed territories are captured on the way
        for (const b of step.blitz || []) if (!this.friendlyOwner(b, p)) this.conquer(b, p);
        u.ml -= cost; u.mv = true; u.prev = step.path[step.path.length - 2];
        if (combat) u.cm = true;
        this._moveUnit(u, from, to);
        // cargo travels with its transport
        if (d.transport) for (const c of src.u.filter((x) => x.tr === u.id)) { this._moveUnit(c, from, to); c.prev = from; }
        moved.push(u);
      }
      // walking into an empty enemy territory captures it
      if (this.B.isLand(to) && !this.friendlyOwner(to, p) && combat) {
        const enemiesLeft = this.enemies(to, p).filter((e) => !this.def(e).infrastructure && !(this.R.aaCaptured && this.def(e).aa));
        const hasLand = moved.some((u) => this.def(u).domain === 'land');
        const pendingSea = moved.some((u) => u.amph && this.hostileSurface(u.amph, p));
        if (!enemiesLeft.length && hasLand && !pendingSea) this.conquer(to, p);
      }
      const names = {};
      for (const u of moved) names[u.t] = (names[u.t] || 0) + 1;
      this.log(`${p} ${r.kind === 'load' ? 'loads' : r.kind === 'unload' ? 'unloads' : r.kind === 'amphibious' ? 'lands' : 'moves'} ${Object.keys(names).map((k) => names[k] + ' ' + this.R.units[k].short).join(', ')} ${from === to ? '' : this.B.name(from) + ' → '}${this.B.name(to)}`);
      return { ok: true, kind: r.kind, warn: r.warn };
    }
    _moveUnit(u, from, to) {
      const a = this.s.terr[from].u;
      a.splice(a.indexOf(u), 1);
      this.s.terr[to].u.push(u);
    }

    conquer(id, p) {
      const t = this.s.terr[id];
      const prevOwner = t.o;
      let newOwner = p;
      const orig = this.s.origOwner[id];
      if (orig && orig !== p && this.team(orig) === this.team(p) && this.s.powers[orig]) {
        const cap = this.s.powers[orig].capital;
        if (!cap || this.s.terr[cap].o === orig) newOwner = orig;
      }
      t.o = newOwner;
      t.conq = true;
      for (const u of t.u) {
        const d = this.def(u);
        if (this.isEnemy(u.o, p) && (d.infrastructure || (this.R.aaCaptured && d.aa))) u.o = newOwner;
      }
      if (prevOwner && this.s.powers[prevOwner] && this.s.powers[prevOwner].capital === id) {
        const loot = this.s.powers[prevOwner].money;
        this.s.powers[prevOwner].money = 0;
        this.s.powers[p].money += loot;
        if (loot) this.log(`${p} captures ${prevOwner}'s capital and seizes ${loot} IPCs`);
      }
      this.log(`${newOwner === p ? p + ' captures' : p + ' liberates'} ${this.B.name(id)}${newOwner !== p ? ' for ' + newOwner : ''}`);
    }

    /** Air units that cannot stay where they are are lost at the end of noncombat. */
    crashAir() {
      const p = this.current();
      const lost = [];
      const T = this.s.terr;
      for (const id of Object.keys(T)) {
        const air = T[id].u.filter((u) => u.o === p && this.def(u).domain === 'air');
        if (!air.length) continue;
        let ok;
        if (this.B.isLand(id)) {
          ok = this.friendlyOwner(id, p) && !T[id].conq && !this.enemies(id, p).length;
          if (!ok) lost.push(...air.map((u) => ({ u, id })));
        } else {
          let cap = 0;
          for (const c of T[id].u) if (this.team(c.o) === this.team(p) && this.def(c).carrierCapacity) cap += this.def(c).carrierCapacity;
          let need = 0;
          for (const f of T[id].u) if (this.team(f.o) === this.team(p) && this.def(f).domain === 'air') need++;
          const bombers = air.filter((u) => this.def(u).bomber);
          lost.push(...bombers.map((u) => ({ u, id })));
          need -= bombers.length;
          const fighters = air.filter((u) => !this.def(u).bomber);
          let over = need - cap;
          for (const f of fighters) { if (over <= 0) break; lost.push({ u: f, id }); over--; }
        }
      }
      for (const { u, id } of lost) {
        this._recordLoss(u);
        T[id].u.splice(T[id].u.indexOf(u), 1);
        this.log(`${this.def(u).name} could not land and was lost (${this.B.name(id)})`);
      }
      return lost.map((x) => ({ type: x.u.t, at: x.id }));
    }
    /** Air units that would be lost if noncombat ended now. */
    strandedAir() {
      const snap = clone(this.s);
      const lost = this.crashAir();
      this.s = snap;
      return lost;
    }

    // ---------------- placement ----------------
    toPlace() { return Object.assign({}, this.s.buy); }
    /** Territory -> remaining production capacity for the current power. */
    factories() {
      const p = this.current();
      const out = {};
      for (const id of Object.keys(this.s.terr)) {
        const t = this.s.terr[id];
        if (t.o !== p || t.conq || this.s.startOwned[id] !== p) continue;
        if (!t.u.some((u) => this.def(u).infrastructure && u.t === 'factory')) continue;
        const cap = Math.max(0, this.B.ipc(id) - (this.R.sbr === 'damage' ? t.dmg : 0));
        const used = t.u.filter((u) => u.born && u.bornAt === id).length +
          this.B.adj[id].reduce((n, z) => n + (this.B.isSea(z) ? this.s.terr[z].u.filter((u) => u.born && u.bornAt === id).length : 0), 0);
        out[id] = Math.max(0, cap - used);
      }
      return out;
    }
    canPlace(type, at) {
      const p = this.current();
      if (this.s.phase !== 'place') return { ok: false, error: 'Not the placement phase' };
      if (!(this.s.buy[type] > 0)) return { ok: false, error: 'None left to place' };
      const d = this.R.units[type];
      const fac = this.factories();
      if (type === 'factory') {
        const t = this.s.terr[at];
        if (!t || this.B.isSea(at) || t.o !== p || t.conq || this.s.startOwned[at] !== p) return { ok: false, error: 'Place factories in territory you held all turn' };
        if (t.u.some((u) => u.t === 'factory')) return { ok: false, error: 'Already has a factory' };
        if (this.B.ipc(at) < 1) return { ok: false, error: 'Territory has no IPC value' };
        return { ok: true, factory: at };
      }
      if (d.domain === 'sea' || (d.domain === 'air' && this.B.isSea(at))) {
        if (!this.B.isSea(at)) return { ok: false, error: 'Ships go in a sea zone next to a factory' };
        // 1942 rules: new ships may be placed among enemy warships; no combat now, the enemy fights or leaves on its turn
        if (this.hostileSurface(at, p) && !this.R.placeInHostileSea) return { ok: false, error: 'Enemy warships are there' };
        if (d.domain === 'air') {
          let cap = 0, need = 1;
          for (const u of this.units(at)) {
            if (u.o === p && this.def(u).carrierCapacity) cap += this.def(u).carrierCapacity;
            if (this.team(u.o) === this.team(p) && this.def(u).domain === 'air') need++;
          }
          if (d.bomber || need > cap) return { ok: false, error: 'No carrier space there' };
        }
        const f = this.B.adj[at].find((x) => fac[x] > 0);
        if (!f) return { ok: false, error: 'No factory with capacity next to this sea zone' };
        return { ok: true, factory: f };
      }
      if (!(fac[at] > 0)) return { ok: false, error: fac[at] === 0 ? 'Factory is at capacity' : 'Needs a factory you held all turn' };
      return { ok: true, factory: at };
    }
    place(type, at) {
      const r = this.canPlace(type, at);
      if (!r.ok) return r;
      const u = this._mkUnit(this.s.nextId++, type, this.current());
      u.ml = 0; u.born = true; u.bornAt = r.factory;
      this.s.terr[at].u.push(u);
      this.s.buy[type]--;
      if (!this.s.buy[type]) delete this.s.buy[type];
      return { ok: true };
    }
    placeTargets(type) {
      const out = [];
      for (const id of this.B.playable) if (this.canPlace(type, id).ok) out.push(id);
      return out;
    }
    clearBorn() {
      for (const id of Object.keys(this.s.terr)) for (const u of this.s.terr[id].u) { delete u.born; delete u.bornAt; }
    }

    // ---------------- battles ----------------
    findBattles() {
      const p = this.current();
      const out = [];
      for (const id of Object.keys(this.s.terr)) {
        const mine = this.units(id).filter((u) => u.o === p && u.cm && !u.tr);
        // ships that start the turn sharing a sea zone with enemy warships must fight there or leave (rulebook p. 9)
        const sharing = this.B.isSea(id) && this.hostileSurface(id, p) && this.units(id).some((u) => u.o === p && !u.tr && this.def(u).domain === 'sea');
        if (!mine.length && !sharing) continue;
        const foes = this.enemies(id, p).filter((e) => !this.def(e).infrastructure || (this.def(e).aa));
        const realFoes = foes.filter((e) => !(this.R.aaCaptured && this.def(e).aa) || mine.some((m) => this.def(m).domain === 'air'));
        if (this.B.isSea(id)) {
          if (foes.length) out.push(id);
        } else if (realFoes.length || (mine.some((u) => u.amph) && !this.friendlyOwner(id, p))) {
          out.push(id);
        }
      }
      // sea battles first
      out.sort((a, b) => (this.B.isSea(b) ? 1 : 0) - (this.B.isSea(a) ? 1 : 0));
      return out;
    }
    /** Battles that can be fought now (sea battles that support a landing come first). */
    readyBattles() {
      const p = this.current();
      return this.s.battles.filter((id) => {
        if (this.B.isSea(id)) return true;
        const deps = new Set(this.units(id).filter((u) => u.o === p && u.amph).map((u) => u.amph));
        return ![...deps].some((z) => this.s.battles.includes(z));
      });
    }

    startBattle(id) {
      if (this.s.phase !== 'combat') return { ok: false, error: 'Not the battle phase' };
      if (this.s.battle) return { ok: false, error: 'A battle is already in progress' };
      if (!this.readyBattles().includes(id)) return { ok: false, error: 'Fight the sea battle for this landing first' };
      const p = this.current();
      const sea = this.B.isSea(id);
      const b = {
        id, sea, att: p, round: 0, step: 'start', over: false, winner: null,
        pend: { A: null, D: null }, picks: { A: null, D: null }, doomed: [], dice: { A: [], D: [] },
        need: 'roll', lines: [], bombard: [], fired: {}, rollNo: 0,
      };
      // bombardment: ships in the source zones of amphibious units that did not fight this turn
      if (!sea) {
        const zones = new Set(this.units(id).filter((u) => u.o === p && u.amph).map((u) => u.amph));
        const landers = this.units(id).filter((u) => u.o === p && u.amph).length;
        let ships = [];
        for (const z of zones) ships = ships.concat(this.units(z).filter((u) => u.o === p && this.def(u).bombard && !u.f));
        if (this.R.bombardLimitedByLanders) ships = ships.slice(0, landers);
        b.bombard = ships.map((u) => u.id);
      }
      // With uiHold, battles the player is part of advance one roll at a time, and casualties stay on
      // show (changeable) until the next action: see battleRoll.
      b.hold = !!this.s.uiHold && (this.isHuman(p) || this.units(id).some((u) => this.isEnemy(u.o, p) && this.isHuman(u.o)));
      this.s.battle = b;
      b.roundDead = [];
      // empty landing (sea battle already won): capture straight away
      if (!this._side('D').length) {
        this._endBattle();
        return { ok: true };
      }
      // units that cannot fight back at all are destroyed without combat: AA guns with no combat units
      // (no AA shot either: "no actual combat is necessary", rulebook pp. 16, 25) and defenceless transports
      if (this._destroyHelpless() && this._roundOver(this._side('A'), this._side('D'))) this._endBattle();
      return { ok: true };
    }
    _side(side) {
      const b = this.s.battle;
      const p = b.att;
      const sea = b.sea;
      if (side === 'A') {
        return this.units(b.id).filter((u) => {
          if (u.o !== p || u.tr || u.sub) return false;
          const d = this.def(u);
          if (d.infrastructure || d.aa) return false;
          if (sea) return d.domain !== 'land';
          return d.domain !== 'sea';
        });
      }
      return this.units(b.id).filter((u) => {
        if (!this.isEnemy(u.o, p) || u.tr || u.sub) return false;
        const d = this.def(u);
        if (d.infrastructure && !d.aa) return false;
        if (sea) return d.domain !== 'land';
        return d.domain !== 'sea';
      });
    }
    /** Units that can be chosen as casualties on a side (excludes infrastructure AA). */
    _hittable(side) {
      return this._side(side).filter((u) => !this.def(u).infrastructure);
    }
    _hasDestroyer(units) { return units.some((u) => this.def(u).antiSub); }
    _canHit(firing, target, role) {
      // can any unit of `firing` (role 'A' attacks, 'D' defends) damage any of `target`?
      const destroyer = this._hasDestroyer(firing);
      for (const f of firing) {
        const fd = this.def(f);
        const v = this._fireValue(f, firing, role);
        if (v <= 0) continue;
        for (const t of target) {
          const td = this.def(t);
          if (td.infrastructure) continue;
          if (fd.sub && td.domain === 'air') continue;
          if (fd.domain === 'air' && td.sub && this.R.airNeedsDestroyerVsSub && !destroyer) continue;
          return true;
        }
      }
      return false;
    }
    _fireValue(u, side, role) {
      const d = this.def(u);
      return role === 'A' ? d.att : d.def;
    }
    _teamOf(side) {
      const b = this.s.battle;
      if (side === 'A') return this.team(b.att);
      const d = this._side('D');
      return d.length ? this.team(d[0].o) : (this.team(b.att) === 'Axis' ? 'Allies' : 'Axis');
    }
    /** Roll a group of units; returns hit spec and dice for display. */
    _fire(units, role, opts) {
      opts = opts || {};
      const b = this.s.battle;
      const team = this._teamOf(role);
      const enemyUnits = this._side(role === 'A' ? 'D' : 'A');
      const destroyer = b && b.dd ? b.dd[role] : this._hasDestroyer(this._side(role));
      const hits = { any: 0, notAir: 0, notSub: 0, airOnly: 0 };
      const dice = [];
      // artillery support
      let support = 0;
      if (role === 'A' && !opts.bombard) {
        for (const u of units) support += this.def(u).supports || 0;
      }
      const enemyHasSub = enemyUnits.some((u) => this.def(u).sub);
      for (const u of units) {
        const d = this.def(u);
        let v = opts.bombard ? d.bombard : (role === 'A' ? d.att : d.def);
        if (role === 'A' && d.supportable && support > 0 && !opts.bombard) { v += 1; support--; }
        if (v <= 0) continue;
        const r = this.roll(team, v);
        dice.push({ id: u.id, t: u.t, v, die: r.die, hit: r.hit });
        if (!r.hit) continue;
        if (d.sub) hits.notAir++;
        else if (d.domain === 'air' && this.R.airNeedsDestroyerVsSub && !destroyer && enemyHasSub) hits.notSub++;
        else hits.any++;
      }
      return { hits, dice };
    }
    _total(h) { return h ? h.any + h.notAir + h.notSub + (h.airOnly || 0) : 0; }

    /**
     * Roll the next step of the current battle. Steps in a round, in the order of the rule book:
     *   aa (round 1) -> bombard (round 1) -> subs (surprise strike) -> fireA (attacker) -> fireD (defender)
     *   -> end of round (the attacker presses on or retreats)
     * Without hold, one call runs the whole round, stopping only for a person's casualty choice
     * (b.need = 'casualties').
     * With hold (a person is in the battle, see startBattle), one call runs the next step that rolls dice
     * and stops there. Its casualties get default picks (b.picks) that stay on show, and can be changed
     * with battleAssign, until the next action locks them in. After the defender fires, the round waits
     * for the attacker's decision with every casualty of the round still on show (b.need = 'decision').
     */
    battleRoll() {
      const b = this.s.battle;
      if (!b) return { ok: false, error: 'No battle' };
      if (b.need !== 'roll') return { ok: false, error: 'Waiting for ' + b.need };
      this._lockIn();
      if (b.step === 'start' || b.step === 'decide') {
        b.round++;
        b.step = b.round === 1 ? 'aa' : 'subs';
        b.dice = { A: [], D: [] };
        b.lines = [];
        b.roundDead = [];
        // destroyers present when the round starts decide submarine abilities for the whole round
        b.dd = { A: this._hasDestroyer(this._side('A')), D: this._hasDestroyer(this._side('D')) };
      }
      b.rollNo = (b.rollNo || 0) + 1;
      this._runSteps();
      return { ok: true };
    }
    _runSteps() {
      const b = this.s.battle;
      for (let guard = 0; guard < 20; guard++) {
        const st = b.step;
        if (st === 'endRound') return this._endRound();
        let rolled = false;
        if (st === 'aa') { b.step = 'bombard'; rolled = this._stepAA(); }
        else if (st === 'bombard') { b.step = 'subs'; rolled = this._stepBombard(); }
        else if (st === 'subs') { b.step = 'fireA'; rolled = this._stepSubs(); }
        else if (st === 'fireA') { b.step = 'fireD'; rolled = this._stepFire('A'); }
        else if (st === 'fireD') { b.step = 'endRound'; rolled = this._stepFire('D'); }
        else return;
        if (!rolled) continue;
        if (b.hold) {
          this._askCasualties();
          if (b.step === 'endRound') return this._endRound();
          b.need = 'roll';
          return;
        }
        if (b.pend.A || b.pend.D) {
          if (!this._askCasualties()) { b.need = 'casualties'; return; }
          this._lockIn();
        }
      }
    }
    _tag(dice, k) { for (const d of dice) d.k = k; return dice; }
    /** Opening fire, round 1: AA guns shoot at attacking aircraft (hits are removed at once). */
    _stepAA() {
      const b = this.s.battle;
      if (b.sea) return false;
      const guns = this._side('D').filter((u) => this.def(u).aa);
      const air = this._side('A').filter((u) => this.def(u).domain === 'air');
      if (!guns.length || !air.length) return false;
      let shots = 0;
      for (const g of guns) shots += this.def(g).aa.maxShots;
      shots = Math.min(shots, air.length);
      const team = this._teamOf('D');
      let n = 0;
      const dice = [];
      for (let i = 0; i < shots; i++) {
        const r = this.roll(team, this.def(guns[0]).aa.hit);
        dice.push({ id: guns[i % guns.length].id, t: guns[i % guns.length].t, v: 1, die: r.die, hit: r.hit, k: 'aa' });
        if (r.hit) n++;
      }
      b.dice.D = b.dice.D.concat(dice);
      b.lines.push(`AA fire: ${n} hit${n === 1 ? '' : 's'} from ${shots} shot${shots === 1 ? '' : 's'}`);
      b.kind = 'aa';
      if (n) b.pend.A = { any: 0, notAir: 0, notSub: 0, airOnly: n };
      return true;
    }
    /** Opening fire, round 1 of an amphibious assault: ships bombard (casualties still fire back this round). */
    _stepBombard() {
      const b = this.s.battle;
      if (b.sea || !b.bombard.length) return false;
      const ships = b.bombard.map((id) => this.unit(id)).filter(Boolean);
      if (!ships.length) return false;
      const shot = this._fire(ships, 'A', { bombard: true });
      b.dice.A = b.dice.A.concat(this._tag(shot.dice, 'bombard'));
      const n = this._total(shot.hits);
      b.lines.push(`Shore bombardment: ${n} hit${n === 1 ? '' : 's'}`);
      b.kind = 'bombard';
      if (n) b.pend.D = shot.hits;
      return true;
    }
    /** Submarine surprise strike, each round, by subs the enemy has no destroyer against (hits are removed at once). */
    _stepSubs() {
      const b = this.s.battle;
      const A = this._side('A'), D = this._side('D');
      const aSubs = A.filter((u) => this.def(u).sub);
      const dSubs = D.filter((u) => this.def(u).sub);
      b.fired = {};
      const aFirst = aSubs.length && !(b.dd ? b.dd.D : this._hasDestroyer(D));
      const dFirst = dSubs.length && !(b.dd ? b.dd.A : this._hasDestroyer(A));
      if (!aFirst && !dFirst) return false;
      if (aFirst) {
        const shot = this._fire(aSubs, 'A');
        b.dice.A = b.dice.A.concat(this._tag(shot.dice, 'subs'));
        for (const u of aSubs) b.fired[u.id] = 1;
        if (this._total(shot.hits)) b.pend.D = shot.hits;
      }
      if (dFirst) {
        const shot = this._fire(dSubs, 'D');
        b.dice.D = b.dice.D.concat(this._tag(shot.dice, 'subs'));
        for (const u of dSubs) b.fired[u.id] = 1;
        if (this._total(shot.hits)) b.pend.A = shot.hits;
      }
      b.lines.push('Submarine surprise strike');
      b.kind = 'subs';
      return true;
    }
    /** General fire: the attacker's units, then the defender's (the defender's casualties fire back). */
    _stepFire(side) {
      const b = this.s.battle;
      // after opening fire: a side left with nothing that can fight back is destroyed, no dice needed
      if (side === 'A') this._destroyHelpless();
      // nothing left on one side (AA fire or a surprise strike cleared it): no more dice this round
      if (!this._side('A').length || !this._hittable('D').length) { b.step = 'endRound'; return false; }
      const units = this._side(side).filter((u) => !b.fired[u.id] && !(side === 'D' && this.def(u).aa));
      const shot = this._fire(units, side);
      b.dice[side] = b.dice[side].concat(shot.dice);
      const n = this._total(shot.hits);
      b.lines.push(`${side === 'A' ? 'Attacker' : 'Defender'} scores ${n} hit${n === 1 ? '' : 's'}`);
      b.kind = 'fire';
      if (n) b.pend[side === 'A' ? 'D' : 'A'] = shot.hits;
      return true;
    }
    _defenselessOpt() { return { defenseless: this.R.transportsDefenseless, round: this.s.battle.round }; }
    _candidates(side) {
      const b = this.s.battle;
      return this._hittable(side).filter((u) => !b.doomed.includes(u.id) || this.def(u).hp > 1);
    }
    /** Default picks for the pending hits (always with hold). True when every side with hits has picks. */
    _askCasualties() {
      const b = this.s.battle;
      b.picks = { A: null, D: null };
      for (const side of ['A', 'D']) {
        const h = b.pend[side];
        if (!h) continue;
        const units = this._candidates(side);
        const n = maxAssignable(this.R, units, h, this._defenselessOpt());
        if (n === 0) { b.pend[side] = null; continue; }
        const owner = side === 'A' ? b.att : (units[0] && units[0].o);
        if (b.hold || !owner || this.s.powers[owner].ai || this.s.autoCasualties) {
          b.picks[side] = autoPicks(this.R, units, h, side, this._defenselessOpt());
        }
      }
      return (!b.pend.A || !!b.picks.A) && (!b.pend.D || !!b.picks.D);
    }
    /** For the UI: units the side may choose from and the default picks. */
    casualtyChoice(side) {
      const b = this.s.battle;
      if (!b || !b.pend[side]) return null;
      const units = this._candidates(side);
      return {
        units, hits: b.pend[side], need: maxAssignable(this.R, units, b.pend[side], this._defenselessOpt()),
        auto: autoPicks(this.R, units, b.pend[side], side, this._defenselessOpt()),
        kind: b.kind, picks: b.picks[side],
      };
    }
    /** Choose casualties: when asked (b.need = 'casualties'), or with hold any time before they are locked in. */
    battleAssign(side, picks) {
      const b = this.s.battle;
      if (!b || b.over || !b.pend[side]) return { ok: false, error: 'No casualties to choose' };
      const ch = this.casualtyChoice(side);
      const err = validatePicks(this.R, ch.units, ch.hits, picks, this._defenselessOpt());
      if (err) return { ok: false, error: err };
      b.picks[side] = picks.slice();
      if (b.hold && b.need === 'decision' && !b.settled) b.ending = this._wouldEnd();
      if (b.need === 'casualties' && (!b.pend.A || b.picks.A) && (!b.pend.D || b.picks.D)) {
        this._lockIn();
        b.need = 'roll';
        this._runSteps();
      }
      return { ok: true };
    }
    /**
     * Apply the chosen casualties. Hits from AA fire and surprise strikes remove units at once; other
     * casualties are doomed: they still fire this round and go when the round is settled.
     */
    _lockIn() {
      const b = this.s.battle;
      if (!b || (!b.pend.A && !b.pend.D)) return;
      for (const side of ['A', 'D']) {
        if (b.pend[side] && !b.picks[side]) { const ch = this.casualtyChoice(side); b.picks[side] = ch.auto; }
      }
      const immediate = b.kind === 'aa' || b.kind === 'subs';
      for (const side of ['A', 'D']) {
        const picks = b.picks[side];
        if (!picks || !picks.length) continue;
        const cnt = {};
        for (const id of picks) cnt[id] = (cnt[id] || 0) + 1;
        const names = {};
        for (const id of picks) { const u = this.unit(+id); if (u) names[u.t] = (names[u.t] || 0) + 1; }
        for (const id of Object.keys(cnt)) {
          const u = this.unit(+id);
          if (!u) continue;
          u.h = (u.h || 0) + cnt[id];
          if (u.h >= hp(this.def(u))) {
            if (immediate) this._kill(u);
            else if (!b.doomed.includes(u.id)) b.doomed.push(u.id);
          }
        }
        b.lines.push(`${side === 'A' ? 'Attacker' : 'Defender'} loses ${Object.keys(names).map((k) => names[k] + ' ' + this.R.units[k].short).join(', ')}`);
      }
      b.pend = { A: null, D: null };
      b.picks = { A: null, D: null };
    }
    /** IPC value of destroyed units, per team (for the result text). */
    _recordLoss(u) {
      const team = this.team(u.o);
      if (!team) return;
      const L = this.s.losses || (this.s.losses = {});
      L[team] = (L[team] || 0) + (this.def(u).cost || 0);
    }
    _kill(u) {
      const at = this.whereIs(u.id);
      if (!at) return;
      const list = this.s.terr[at].u;
      // cargo sinks with its transport
      if (this.def(u).transport) {
        for (const c of list.filter((x) => x.tr === u.id)) { this._recordLoss(c); list.splice(list.indexOf(c), 1); }
        // units that already landed from this transport stay ashore
      }
      this._recordLoss(u);
      list.splice(list.indexOf(u), 1);
      const b = this.s.battle;
      if (b) {
        b.lost = b.lost || { A: {}, D: {} };
        const side = u.o === b.att ? 'A' : 'D';
        b.lost[side][u.t] = (b.lost[side][u.t] || 0) + 1;
        // kept for showing the round's casualties until the next round starts
        if (b.roundDead && !u.tr) b.roundDead.push({ id: u.id, t: u.t, o: u.o, h: u.h || 0, side });
      }
    }
    _endRound() {
      const b = this.s.battle;
      b.step = 'decide';
      if (b.hold) {
        // the round's casualties stay on show until the attacker decides (battleContinue, battleRetreat)
        b.need = 'decision';
        b.settled = false;
        b.ending = this._wouldEnd();
        return;
      }
      this._settle();
    }
    /** End of round: remove the casualties and see whether the battle is over. True if it ended. */
    _settle() {
      const b = this.s.battle;
      this._lockIn();
      for (const id of b.doomed) { const u = this.unit(id); if (u) this._kill(u); }
      b.doomed = [];
      b.fired = {};
      b.bombard = [];
      b.settled = true;
      b.ending = false;
      b.autoLost = [];
      this._destroyHelpless();
      const over = this._roundOver(this._side('A'), this._side('D'));
      if (over) {
        if (over === 'stalemate') b.lines.push('Neither side can harm the other');
        this._endBattle();
        return true;
      }
      b.step = 'decide';
      b.need = 'decision';
      return false;
    }
    /** A unit that cannot fight back at all: a defenceless transport, or an AA gun outside its shot at aircraft. */
    _helpless(u, side) {
      const d = this.def(u);
      return (side === 'A' ? d.att : d.def) <= 0 && ((d.transport && this.R.transportsDefenseless) || !!d.aa);
    }
    /**
     * Helpless units the enemy could hit are destroyed outright, instead of being rolled at until a die
     * happens to hit them, when nothing on their side can protect them: no combat units left, or the combat
     * units left on both sides cannot hit each other (e.g. transports and subs against aircraft). Attacking
     * transports that can still retreat are left alone. Rulebook p. 17 (defenceless transports), p. 25 (AA).
     */
    _helplessVictims(mine, other, side) {
      const role = side === 'A' ? 'D' : 'A';
      const helpless = mine.filter((u) => this._helpless(u, side));
      if (!helpless.length) return [];
      const fighters = mine.filter((u) => !this._helpless(u, side));
      const foes = other.filter((u) => !this._helpless(u, role));
      if (fighters.length && (this._canHit(fighters, foes, side) || this._canHit(foes, fighters, role))) return [];
      if (side === 'A' && this._retreatSpots(mine).length) return [];
      return helpless.filter((u) => this._canHit(other, [u], role));
    }
    /** Destroy helpless sides (see _helplessVictims). True if any unit was removed. */
    _destroyHelpless() {
      const b = this.s.battle;
      let any = false;
      for (const side of ['A', 'D']) {
        const alive = (x) => !b.doomed.includes(x.id);
        const victims = this._helplessVictims(this._side(side).filter(alive), this._side(side === 'A' ? 'D' : 'A').filter(alive), side);
        if (!victims.length) continue;
        const names = {};
        for (const u of victims) names[u.t] = (names[u.t] || 0) + 1;
        for (const u of victims) this._kill(u);
        b.lines.push(`${side === 'A' ? 'Attacking' : 'Defending'} ${Object.keys(names).map((k) => names[k] + ' ' + this.R.units[k].short).join(', ')} cannot fight back and ${victims.length === 1 ? 'is' : 'are'} destroyed`);
        any = true;
      }
      return any;
    }
    _roundOver(A, Dall) {
      const D = Dall.filter((u) => !this.def(u).infrastructure);
      if (!A.length || !D.length) return 'empty';
      if (!this._canHit(A, D, 'A') && !this._canHit(Dall, A, 'D')) return 'stalemate';
      return null;
    }
    /** Units on a side that live through the casualties chosen so far (for decisions made before they go). */
    survivors(side) {
      const b = this.s.battle;
      if (!b) return [];
      const hits = {};
      for (const id of b.picks[side] || []) hits[id] = (hits[id] || 0) + 1;
      return this._side(side).filter((u) => !b.doomed.includes(u.id) && (u.h || 0) + (hits[u.id] || 0) < hp(this.def(u)));
    }
    /**
     * Whether settling the round would end the battle (with hold, before the casualties are removed).
     * Also notes in b.autoLost the helpless units that settling will destroy, so they can be shown as lost.
     */
    _wouldEnd() {
      const b = this.s.battle;
      let A = this.survivors('A'), D = this.survivors('D');
      const lostA = this._helplessVictims(A, D, 'A');
      A = A.filter((u) => !lostA.includes(u));
      const lostD = this._helplessVictims(D, A, 'D');
      D = D.filter((u) => !lostD.includes(u));
      b.autoLost = lostA.concat(lostD).map((u) => u.id);
      return !!this._roundOver(A, D);
    }
    retreatOptions() {
      const b = this.s.battle;
      if (!b || b.need !== 'decision') return [];
      return this._retreatSpots(this.survivors('A'));
    }
    /** Where these attacking units could retreat to: a space at least one of them came from. */
    _retreatSpots(A) {
      const b = this.s.battle;
      const p = b.att;
      const set = new Set();
      for (const u of A) {
        const d = this.def(u);
        if (d.domain === 'air' || u.amph) continue;
        if (u.prev && this.s.terr[u.prev] && this.B.adj[b.id].includes(u.prev)) {
          if (b.sea ? !this.enemies(u.prev, p).some((e) => this.blocksShips(e)) : this.friendlyOwner(u.prev, p)) set.add(u.prev);
        }
      }
      if (!set.size && A.length && A.every((u) => this.def(u).domain === 'air')) set.add(b.id); // air-only: break off
      return [...set];
    }
    /** With hold: remove the round's casualties now, ahead of the decision (e.g. before choosing where to retreat). */
    battleSettle() {
      const b = this.s.battle;
      if (!b || b.need !== 'decision') return { ok: false, error: 'No decision pending' };
      if (!b.settled) this._settle();
      return { ok: true, over: !!b.over };
    }
    /** Press the attack: the round's casualties go and the next round starts (or the battle ends if it is over). */
    battleContinue() {
      const b = this.s.battle;
      if (!b || b.need !== 'decision') return { ok: false, error: 'No decision pending' };
      if (!b.settled && this._settle()) return { ok: true };
      b.need = 'roll';
      // with hold the page rolls the next round itself, after any submarine decisions (step 2 of the round)
      if (b.hold) return { ok: true };
      return this.battleRoll();
    }
    battleRetreat(to) {
      const b = this.s.battle;
      if (!b || b.need !== 'decision') return { ok: false, error: 'No decision pending' };
      if (!this.retreatOptions().includes(to)) return { ok: false, error: 'Cannot retreat there' };
      if (!b.settled && this._settle()) return { ok: true };
      const A = this._side('A');
      let left = 0;
      for (const u of A) {
        if (u.amph) { left++; continue; }
        if (to !== b.id) {
          this._moveUnit(u, b.id, to);
          if (this.def(u).transport) for (const c of this.units(b.id).filter((x) => x.tr === u.id)) this._moveUnit(c, b.id, to);
        }
        u.f = true;
        if (this.def(u).domain !== 'air') u.ml = 0;
      }
      b.lines.push(`Attacker retreats${to !== b.id ? ' to ' + this.B.name(to) : ''}`);
      this.log(`${b.att} retreats from ${this.B.name(b.id)}`);
      b.retreatedTo = to;
      if (left) { b.need = 'roll'; return b.hold ? { ok: true } : this.battleRoll(); }
      b.retreated = true;
      return this._endBattle();
    }
    /** True between rounds: after a round's decision, or before the first or next round's dice. */
    _betweenRounds() {
      const b = this.s.battle;
      return !!b && !b.over && (b.need === 'decision' || (b.need === 'roll' && (b.step === 'start' || b.step === 'decide')));
    }
    /** Whether a side's submarines may submerge now: between rounds, and the enemy has no destroyer in the battle. */
    canSubmerge(side) {
      if (!this._betweenRounds()) return false;
      const live = (s) => this.survivors(s);
      return live(side).some((u) => this.def(u).sub) && !this._hasDestroyer(live(side === 'A' ? 'D' : 'A'));
    }
    /** A side may still decide whether to submerge before the coming round. */
    subChoicePending(side) {
      const b = this.s.battle;
      if (!this.canSubmerge(side)) return false;
      return (b.subChoice || {})[side] !== b.round + 1;
    }
    /** Keep a side's submarines in the coming round (records the decision so it is not asked again). */
    battleKeepSubs(side) {
      const b = this.s.battle;
      if (!b) return { ok: false, error: 'No battle' };
      b.subChoice = b.subChoice || {};
      b.subChoice[side] = b.round + 1;
      return { ok: true };
    }
    /** Submerge a side's subs: they leave the battle. Only between rounds and when the enemy has no destroyer. */
    battleSubmerge(side) {
      const b = this.s.battle;
      if (!this._betweenRounds()) return { ok: false, error: 'Only between rounds' };
      if (b.need === 'decision' && !b.settled && this._settle()) return { ok: true };
      const enemy = this._side(side === 'A' ? 'D' : 'A');
      if (this._hasDestroyer(enemy)) return { ok: false, error: 'An enemy destroyer prevents submerging' };
      const subs = this._side(side).filter((u) => this.def(u).sub);
      if (!subs.length) return { ok: false, error: 'No submarines' };
      for (const u of subs) u.sub = true;
      this.battleKeepSubs(side);
      b.lines.push(`${side === 'A' ? 'Attacking' : 'Defending'} submarines submerge`);
      // what is left may now be defenceless (e.g. transports whose subs dived), or the battle over
      this._destroyHelpless();
      if (this._roundOver(this._side('A'), this._side('D'))) return this._endBattle();
      return { ok: true };
    }
    _endBattle() {
      const b = this.s.battle;
      const p = b.att;
      const A = this.units(b.id).filter((u) => u.o === p && !u.tr);
      const D = this._hittable('D');
      for (const u of A) { u.f = true; if (this.def(u).domain !== 'air') u.ml = 0; }
      for (const u of this.units(b.id)) delete u.sub;
      let result;
      if (!D.length && A.length && !b.retreated) {
        result = 'attacker';
        if (!b.sea && A.some((u) => this.def(u).domain === 'land') && !this.friendlyOwner(b.id, p)) this.conquer(b.id, p);
      } else if (!A.length) result = 'defender';
      else result = 'draw';
      // remove leftover enemy AA (1942: AA can be destroyed; Revised: captured in conquer)
      if (b.sea) this._resolveLandings(b.id, result === 'attacker');
      // defending fighters without carriers after a sea battle are lost
      if (b.sea) {
        const defTeam = this.team(p) === 'Axis' ? 'Allies' : 'Axis';
        let cap = 0, air = [];
        for (const u of this.units(b.id)) {
          if (this.team(u.o) === this.team(p)) continue;
          if (this.def(u).carrierCapacity) cap += this.def(u).carrierCapacity;
          if (this.def(u).domain === 'air') air.push(u);
        }
        for (const u of air.slice(cap)) this._kill(u);
        void defTeam;
      }
      b.result = result;
      b.over = true;
      b.need = 'done';
      const lostA = b.lost ? b.lost.A : {}, lostD = b.lost ? b.lost.D : {};
      this.log(`Battle in ${this.B.name(b.id)}: ${result === 'attacker' ? p + ' wins' : result === 'defender' ? 'defender holds' : 'no winner'}`);
      this.s.lastBattle = { id: b.id, result, lostA, lostD, att: p, round: this.s.round };
      return { ok: true };
    }
    /** After a sea battle: landings from that zone go ahead, go back aboard, or sink. */
    _resolveLandings(zone, cleared) {
      const p = this.s.battle.att;
      if (cleared && !this.hostileSurface(zone, p)) {
        // landings into empty enemy territory now capture
        for (const id of this.s.battles) {
          if (this.B.isSea(id)) continue;
          const landers = this.units(id).filter((u) => u.o === p && u.amph === zone);
          if (landers.length && !this.enemies(id, p).some((e) => !this.def(e).infrastructure)) {
            // handled when that battle is started (it has no defenders)
          }
        }
        return;
      }
      for (const id of Object.keys(this.s.terr)) {
        if (this.B.isSea(id)) continue;
        for (const u of this.units(id).filter((x) => x.o === p && x.amph === zone)) {
          const tr = this.unit(u.trWas);
          if (tr) {
            const at = this.whereIs(tr.id);
            this._moveUnit(u, id, at);
            u.tr = tr.id; delete u.amph;
          } else {
            const list = this.s.terr[id].u;
            this._recordLoss(u);
            list.splice(list.indexOf(u), 1);
          }
        }
        if (this.s.battles.includes(id) && !this.units(id).some((u) => u.o === p && u.cm)) {
          this.s.battles.splice(this.s.battles.indexOf(id), 1);
        }
      }
    }
    /** Close the finished battle and drop it from the list. */
    closeBattle() {
      const b = this.s.battle;
      if (!b || !b.over) return { ok: false, error: 'Battle not finished' };
      const i = this.s.battles.indexOf(b.id);
      if (i >= 0) this.s.battles.splice(i, 1);
      this.s.battle = null;
      return { ok: true };
    }
    /** Fight the current battle to the end with default casualties and no retreat. */
    autoResolve(decide) {
      let guard = 0;
      while (this.s.battle && !this.s.battle.over && guard++ < 500) {
        const b = this.s.battle;
        if (b.need === 'roll') this.battleRoll();
        else if (b.need === 'casualties') {
          for (const side of ['A', 'D']) if (b.pend[side] && !b.picks[side]) this.battleAssign(side, this.casualtyChoice(side).auto);
        } else if (b.need === 'decision') {
          const d = decide ? decide(this) : null;
          if (d && d.retreat) this.battleRetreat(d.retreat);
          else this.battleContinue();
        } else break;
      }
    }

    luck(team) {
      const st = this.s.stats[team] || { exp: 0, act: 0, v: 0, n: 0 };
      const diff = st.act - st.exp;
      const z = st.v > 0 ? diff / Math.sqrt(st.v) : 0;
      return { expected: st.exp, actual: st.act, diff, z, pct: normCdf(z), dice: st.n };
    }
  }

  function normCdf(z) {
    // Abramowitz-Stegun approximation
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    if (z > 0) p = 1 - p;
    return p;
  }

  /**
   * Monte-Carlo battle odds without touching a real game.
   * att/def: {type: count}. opts: {sea, ruleset, trials, seed, bombard:{type:n}, amphibious:bool}
   */
  function simulate(att, def, opts) {
    opts = opts || {};
    const R = Rules.get(opts.ruleset);
    const trials = opts.trials || 200;
    const terr = opts.sea ? 'S' : 'L';
    const map = {
      id: 'sim', powers: [{ id: 'A', team: 'Axis' }, { id: 'D', team: 'Allies' }],
      territories: [
        { id: 'L', type: 'land', ipc: 0, adj: ['S', 'L0'] },
        { id: 'L0', type: 'land', ipc: 0, adj: ['L'] },
        { id: 'S', type: 'sea', adj: ['L', 'S0'] },
        { id: 'S0', type: 'sea', adj: ['S'] },
      ],
    };
    const sc = {
      ruleset: R.id, playable: ['L', 'L0', 'S', 'S0'], maxTurns: 9, objectives: [{ type: 'capture', territories: ['L'] }],
      powers: { A: { team: 'Axis', controller: 'ai', money: 0 }, D: { team: 'Allies', controller: 'human', money: 0 } },
      setup: { L: { owner: 'D', units: {} }, L0: { owner: 'A', units: {} } },
      turnOrder: ['A', 'D'],
    };
    const rng = makeRng(opts.seed || 12345);
    let aw = 0, dw = 0, dr = 0, aLoss = 0, dLoss = 0, aLeft = 0;
    const g0 = Game.create(map, sc, { seed: 1, force: true });
    const cost = (u) => R.units[u.t].cost;
    for (let i = 0; i < trials; i++) {
      const g = new Game(map, sc, clone(g0.s));
      g.s.rng = (rng() * 4294967296) | 0;
      g.s.autoCasualties = true;
      let id = g.s.nextId;
      const T = g.s.terr;
      for (const k of Object.keys(def)) for (let j = 0; j < def[k]; j++) T[terr].u.push({ id: id++, t: k, o: 'D', ml: 0, h: 0 });
      for (const k of Object.keys(att)) for (let j = 0; j < att[k]; j++) {
        const u = { id: id++, t: k, o: 'A', ml: 0, h: 0, cm: true, prev: opts.sea ? 'S0' : 'L0' };
        if (opts.amphibious && R.units[k].domain === 'land') u.amph = 'S';
        T[terr].u.push(u);
      }
      if (opts.bombard && !opts.sea) for (const k of Object.keys(opts.bombard)) for (let j = 0; j < opts.bombard[k]; j++) T.S.u.push({ id: id++, t: k, o: 'A', ml: 0, h: 0 });
      g.s.nextId = id;
      g.s.phase = 'combat';
      g.s.turn = 0;
      g.s.battles = [terr];
      const before = { A: 0, D: 0 };
      for (const u of T[terr].u) before[u.o] += cost(u);
      g.startBattle(terr);
      g.autoResolve(opts.retreatWhen ? (gg) => (opts.retreatWhen(gg) ? { retreat: gg.retreatOptions()[0] } : null) : null);
      const res = g.s.lastBattle ? g.s.lastBattle.result : 'draw';
      const after = { A: 0, D: 0 };
      for (const u of T[terr].u) after[u.o] += cost(u);
      for (const u of T.L0.u) if (u.o === 'A') after.A += cost(u);
      if (res === 'attacker') aw++; else if (res === 'defender') dw++; else dr++;
      aLoss += before.A - after.A;
      dLoss += before.D - after.D;
      aLeft += T[terr].u.filter((u) => u.o === 'A').length;
    }
    return { win: aw / trials, lose: dw / trials, draw: dr / trials, attLoss: aLoss / trials, defLoss: dLoss / trials, attLeft: aLeft / trials, trials };
  }

  return {
    Game, Board, PHASES, PHASE_NAMES, clone, randomSeed, makeRng, simulate, normCdf,
    maxAssignable, validatePicks, autoPicks,
  };
});
