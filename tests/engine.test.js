const test = require('node:test');
const assert = require('node:assert');
const E = require('../js/engine.js');
const { map, scenario } = require('./fixture.js');

function newGame(over, seed) {
  return E.Game.create(map, scenario(over), { seed: seed == null ? 7 : seed });
}
const ids = (g, at, type, owner) => g.units(at).filter((u) => u.t === type && (!owner || u.o === owner)).map((u) => u.id);

test('setup: owners, units, turn order', () => {
  const g = newGame();
  assert.equal(g.current(), 'Germany');
  assert.equal(g.phase, 'purchase');
  assert.equal(g.s.terr.A1.o, 'Germany');
  assert.equal(g.s.terr.N.o, null);
  assert.equal(ids(g, 'A1', 'infantry').length, 2);
  assert.equal(g.s.powers.Germany.capital, 'A1');
  assert.equal(g.s.powers['Soviet Union'].capital, 'B2');
});

test('walking into an empty enemy territory captures it', () => {
  const g = newGame();
  g.nextPhase();
  const r = g.move('A1', ids(g, 'A1', 'infantry').slice(0, 1), 'B1');
  assert.ok(r.ok, r.error);
  assert.equal(r.kind, 'capture');
  assert.equal(g.s.terr.B1.o, 'Germany');
  assert.ok(g.s.terr.B1.conq);
});

test('tanks blitz through empty enemy land; infantry cannot pass', () => {
  const g = newGame();
  g.nextPhase();
  const tank = ids(g, 'A1', 'tank');
  const chk = g.checkMove('A1', tank, 'B2');
  assert.ok(chk.ok, chk.error);
  assert.deepEqual(chk.plan[0].blitz, ['B1']);
  // a tank with a friendly route does not blitz
  assert.deepEqual(g.checkMove('A2', ids(g, 'A2', 'tank'), 'B2').plan[0].blitz, []);
  g.move('A1', tank, 'B2');
  assert.equal(g.s.terr.B1.o, 'Germany', 'blitzed territory captured');
  const inf = ids(g, 'A1', 'infantry');
  assert.ok(!g.checkMove('A1', inf, 'B2').ok, 'infantry has 1 move');
});

test('neutral territory is impassable and noncombat cannot enter enemy land', () => {
  const g = newGame();
  g.nextPhase();
  assert.ok(!g.checkMove('A2', ids(g, 'A2', 'infantry'), 'N').ok);
  g.nextPhase(); // -> noncombat (no battles)
  assert.equal(g.phase, 'noncombatMove');
  assert.ok(!g.checkMove('A1', ids(g, 'A1', 'infantry'), 'B1').ok);
  assert.ok(g.checkMove('A1', ids(g, 'A1', 'infantry'), 'A2').ok);
});

test('battle: capture after defenders die, casualties and dice stats recorded', () => {
  const g = newGame({ setup: Object.assign(scenario().setup, { B1: { owner: 'Soviet Union', units: { 'Soviet Union': { infantry: 1 } } } }) }, 3);
  g.nextPhase();
  g.move('A1', ids(g, 'A1', 'tank'), 'B1');
  g.move('A2', ids(g, 'A2', 'tank'), 'B1');
  g.nextPhase();
  assert.equal(g.phase, 'combat');
  assert.deepEqual(g.s.battles, ['B1']);
  assert.ok(g.startBattle('B1').ok);
  g.autoResolve();
  assert.ok(g.s.battle.over);
  const res = g.s.battle.result;
  g.closeBattle();
  if (res === 'attacker') assert.equal(g.s.terr.B1.o, 'Germany');
  assert.ok(g.s.stats.Axis.n > 0);
  assert.ok(g.s.stats.Allies.n > 0);
  assert.equal(g.nextPhase().ok, true);
  assert.equal(g.phase, 'noncombatMove');
});

test('human casualty choice is validated', () => {
  const g = newGame({ setup: Object.assign(scenario().setup, { B1: { owner: 'Soviet Union', units: { 'Soviet Union': { infantry: 3 } } } }) }, 11);
  g.nextPhase();
  g.move('A1', ids(g, 'A1', 'infantry').concat(ids(g, 'A1', 'tank')), 'B1');
  g.nextPhase();
  g.startBattle('B1');
  let guard = 0;
  while (!g.s.battle.over && guard++ < 50) {
    const b = g.s.battle;
    if (b.need === 'roll') g.battleRoll();
    else if (b.need === 'casualties') {
      const ch = g.casualtyChoice('A');
      assert.ok(ch, 'attacker (human) must choose');
      if (ch.need > 0 && ch.units.length > ch.need) {
        assert.equal(g.battleAssign('A', []).ok, false, 'empty pick rejected');
      }
      assert.ok(g.battleAssign('A', ch.auto).ok);
    } else if (b.need === 'decision') g.battleContinue();
  }
  assert.ok(g.s.battle.over);
});

test('AA guns (1942) fire at most 3 shots each, only at aircraft', () => {
  const R = require('../js/rulesets.js').get('1942');
  const units = [{ id: 1, t: 'fighter', h: 0 }, { id: 2, t: 'tank', h: 0 }];
  assert.equal(E.maxAssignable(R, units, { any: 0, notAir: 0, notSub: 0, airOnly: 2 }), 1);
  assert.equal(E.validatePicks(R, units, { any: 0, notAir: 0, notSub: 0, airOnly: 1 }, [2]) !== null, true);
  assert.equal(E.validatePicks(R, units, { any: 0, notAir: 0, notSub: 0, airOnly: 1 }, [1]), null);
});

test('subs cannot hit aircraft; aircraft need a destroyer to hit subs', () => {
  const R = require('../js/rulesets.js').get('1942');
  const sea = [{ id: 1, t: 'fighter', h: 0 }, { id: 2, t: 'submarine', h: 0 }, { id: 3, t: 'destroyer', h: 0 }];
  assert.equal(E.maxAssignable(R, sea, { any: 0, notAir: 3, notSub: 0 }), 2, 'sub hits skip the fighter');
  assert.equal(E.maxAssignable(R, sea, { any: 0, notAir: 0, notSub: 3 }), 2, 'air hits skip the sub');
  assert.ok(E.validatePicks(R, sea, { any: 0, notAir: 1, notSub: 0 }, [1]));
});

test('battleship takes two hits; first hit is free by default', () => {
  const R = require('../js/rulesets.js').get('1942');
  const u = [{ id: 1, t: 'battleship', h: 0 }, { id: 2, t: 'destroyer', h: 0 }];
  assert.deepEqual(E.autoPicks(R, u, { any: 1, notAir: 0, notSub: 0 }, 'D'), [1]);
  assert.equal(E.maxAssignable(R, u, { any: 5, notAir: 0, notSub: 0 }), 3);
});

test('transports are defenceless and taken last (1942)', () => {
  const R = require('../js/rulesets.js').get('1942');
  const u = [{ id: 1, t: 'transport', h: 0 }, { id: 2, t: 'destroyer', h: 0 }];
  const opts = { defenseless: true };
  assert.equal(E.validatePicks(R, u, { any: 1, notAir: 0, notSub: 0 }, [1], opts), 'Transports are taken last');
  assert.equal(E.validatePicks(R, u, { any: 1, notAir: 0, notSub: 0 }, [2], opts), null);
  assert.equal(E.maxAssignable(R, u, { any: 2, notAir: 0, notSub: 0 }, opts), 2);
});

test('transport: load, sail, amphibious landing captures empty island', () => {
  const g = newGame({ setup: Object.assign(scenario().setup, { I: { owner: 'United Kingdom', units: {} } }) });
  g.nextPhase();
  const inf = ids(g, 'A1', 'infantry');
  const r1 = g.move('A1', inf, 'S1');
  assert.ok(r1.ok, r1.error);
  assert.equal(r1.kind, 'load');
  const tr = ids(g, 'S1', 'transport');
  assert.ok(g.move('S1', tr, 'S2').ok);
  assert.equal(g.units('S2').filter((u) => u.tr).length, 2, 'cargo sails along');
  const cargo = g.units('S2').filter((u) => u.tr).map((u) => u.id);
  const r2 = g.move('S2', cargo, 'I');
  assert.ok(r2.ok, r2.error);
  assert.equal(r2.kind, 'amphibious');
  assert.equal(g.s.terr.I.o, 'Germany');
  const t = g.unit(tr[0]);
  assert.ok(t.unl);
  assert.ok(!g.canUnitMove(t, 'S2'), 'unloaded transport stops');
});

test('aircraft that cannot land are lost at the end of noncombat', () => {
  const g = newGame();
  g.nextPhase();
  g.nextPhase(); // straight to noncombat (no battles)
  // a fighter stranded at sea with no moves left (e.g. after a sea battle)
  const f = g.units('A1').find((u) => u.t === 'fighter');
  g._moveUnit(f, 'A1', 'S3');
  f.ml = 0;
  assert.equal(g.strandedAir().length, 1);
  const res = g.nextPhase();
  assert.equal(res.lost.length, 1);
  assert.equal(ids(g, 'S3', 'fighter').length, 0);
  assert.equal(g.s.losses.Axis, 10, 'counted in the IPC losses');
});

test('aircraft may only move where they can still return to friendly territory', () => {
  // I (enemy island) is 3 spaces from A1; a fighter (move 4) would have 1 left and no landing spot
  let g = newGame();
  g.nextPhase();
  const f = ids(g, 'A1', 'fighter');
  let r = g.checkMove('A1', f, 'I');
  assert.equal(r.ok, false);
  assert.match(r.error, /return/);
  assert.ok(!('I' in g.destinations('A1', f)), 'not highlighted');
  // attacking B2 leaves 2 moves and A3 (held all turn) in reach
  assert.ok(g.checkMove('A1', f, 'B2').ok);
  // a friendly carrier next to the island makes the attack legal
  g = newGame({ setup: Object.assign(scenario().setup, { S2: { units: { Germany: { carrier: 1 } } } }) });
  g.nextPhase();
  assert.ok(g.checkMove('A1', ids(g, 'A1', 'fighter'), 'I').ok, 'carrier in S2');
  // so does one of your own carriers that can still sail there this turn
  g = newGame({ setup: Object.assign(scenario().setup, { S1: { units: { Germany: { carrier: 1, destroyer: 1 } } } }) });
  g.nextPhase();
  assert.ok(g.checkMove('A1', ids(g, 'A1', 'fighter'), 'I').ok, 'carrier in S1 can reach S2');
  // ...but not once it has moved and used its movement
  const carrier = g.units('S1').find((u) => u.t === 'carrier');
  carrier.ml = 0;
  assert.equal(g.checkMove('A1', ids(g, 'A1', 'fighter'), 'I').ok, false);
  // noncombat: no flying off to empty sea
  g = newGame();
  g.nextPhase(); g.nextPhase();
  assert.equal(g.phase, 'noncombatMove');
  assert.equal(g.checkMove('A1', ids(g, 'A1', 'fighter'), 'S3').ok, false);
  assert.ok(g.checkMove('A1', ids(g, 'A1', 'fighter'), 'A3').ok);
});

test('aircraft cannot land in territory captured this turn', () => {
  const g = newGame();
  g.nextPhase();
  g.move('A1', ids(g, 'A1', 'infantry').slice(0, 1), 'B1'); // capture empty B1
  assert.equal(g.s.terr.B1.o, 'Germany');
  g.nextPhase(); // no battles -> noncombat
  const f = g.units('A1').find((u) => u.t === 'fighter');
  // with moves to spare it may pass through, but it cannot end its move there
  assert.ok(g.checkMove('A1', [f.id], 'B1').ok);
  f.ml = 1;
  const r = g.checkMove('A1', [f.id], 'B1');
  assert.equal(r.ok, false, 'B1 was captured this turn, so it is not a landing spot');
  assert.match(r.error, /return/);
});

test('purchase, placement at factory with capacity, income', () => {
  const g = newGame();
  assert.ok(g.buy('infantry', 4).ok);
  assert.equal(g.buy('tank', 2).ok, false, 'not enough money (12 + 12 > 20)');
  g.commitPurchase();
  assert.equal(g.s.powers.Germany.money, 8);
  g.nextPhase(); g.nextPhase(); g.nextPhase();
  assert.equal(g.phase, 'place');
  assert.ok(g.place('infantry', 'A1').ok);
  assert.ok(g.place('infantry', 'A1').ok);
  assert.ok(g.place('infantry', 'A1').ok);
  assert.equal(g.place('infantry', 'A1').ok, false, 'A1 produces up to 3');
  assert.equal(g.place('infantry', 'A2').ok, false, 'no factory');
  g.nextPhase();
  assert.equal(g.current(), 'Soviet Union');
  assert.equal(g.s.powers.Germany.unplaced.infantry, 1, 'unplaced units carry over');
  assert.equal(g.s.powers.Germany.money, 8 + 6, 'income from A1, A2, A3');
});

test('capturing a capital takes the treasury', () => {
  const g = newGame({ setup: Object.assign(scenario().setup, { B2: { owner: 'Soviet Union', units: {} } }) });
  g.nextPhase();
  g.move('A2', ids(g, 'A2', 'tank'), 'B2');
  assert.equal(g.s.terr.B2.o, 'Germany');
  assert.equal(g.s.powers.Germany.money, 30);
  assert.equal(g.s.powers['Soviet Union'].money, 0);
});

test('capture objective at end of the player turn wins and records turns', () => {
  const g = newGame({ setup: Object.assign(scenario().setup, { B2: { owner: 'Soviet Union', units: {} } }) });
  g.nextPhase();
  g.move('A2', ids(g, 'A2', 'tank'), 'B2');
  g.nextPhase(); g.nextPhase(); g.nextPhase();
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.s.result.won, true);
  assert.equal(g.s.result.turns, 1);
  assert.equal(g.s.history.length, 1);
  assert.equal(g.s.history[0].progress, 1);
});

test('running out of turns loses', () => {
  const g = newGame({ maxTurns: 1 });
  g.nextPhase(); g.nextPhase(); g.nextPhase(); g.nextPhase();
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.s.result.won, false);
});

test('hold objective: losing the territory at any turn end loses', () => {
  const g = newGame({ objectives: [{ type: 'hold', territories: ['A3'] }], maxTurns: 2 });
  for (let i = 0; i < 4; i++) g.nextPhase();
  assert.equal(g.current(), 'Soviet Union');
  g.s.terr.A3.o = 'Soviet Union';
  for (let i = 0; i < 5; i++) g.nextPhase();
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.s.result.won, false);
});

test('state survives a JSON round trip (save/restore)', () => {
  const g = newGame(null, 99);
  g.nextPhase();
  g.move('A2', ids(g, 'A2', 'tank'), 'B2');
  const saved = JSON.stringify(g.s);
  const h = new E.Game(map, scenario(), JSON.parse(saved));
  g.nextPhase(); h.nextPhase();
  g.startBattle('B2'); h.startBattle('B2');
  g.autoResolve(); h.autoResolve();
  assert.deepEqual(g.s.battle.result, h.s.battle.result);
  assert.deepEqual(g.s.stats, h.s.stats);
});

test('luck: z-score sign follows actual vs expected hits', () => {
  const g = newGame();
  g.s.stats.Axis = { exp: 3, act: 5, v: 2, n: 10 };
  const l = g.luck('Axis');
  assert.ok(l.diff > 0 && l.pct > 0.5);
});

test('rule sets load with their unit lists', () => {
  const Rules = require('../js/rulesets.js');
  assert.equal(Rules.get().id, '1942');
  assert.ok(!Rules.get('classic').units.artillery);
  assert.ok(!Rules.get('1941').units.aaa);
  assert.equal(Rules.get('revised').units.tank.cost, 5);
  assert.equal(Rules.get('classic').units.battleship.hp, 1);
});

test('losses: IPC value of destroyed units is tallied per team', () => {
  const g = newGame({ setup: Object.assign(scenario().setup, { B1: { owner: 'Soviet Union', units: { 'Soviet Union': { infantry: 2 } } } }) }, 5);
  g.nextPhase();
  g.move('A1', ids(g, 'A1', 'infantry').concat(ids(g, 'A1', 'tank')), 'B1');
  g.nextPhase();
  g.startBattle('B1');
  g.autoResolve();
  const lost = g.s.battle.lost || { A: {}, D: {} };
  const R = require('../js/rulesets.js').get('1942');
  const value = (m) => Object.keys(m).reduce((a, k) => a + m[k] * R.units[k].cost, 0);
  assert.equal(g.s.losses.Axis || 0, value(lost.A));
  assert.equal(g.s.losses.Allies || 0, value(lost.D));
  assert.ok((g.s.losses.Axis || 0) + (g.s.losses.Allies || 0) > 0);
});

test('objectives needed: any N of M capture targets wins; targets report each territory', () => {
  const sc = { objectives: [{ type: 'capture', territories: ['B1', 'B2', 'I'] }], objectivesNeeded: 1 };
  const g = newGame(sc);
  g.nextPhase();
  g.move('A1', ids(g, 'A1', 'infantry').slice(0, 1), 'B1');
  assert.deepEqual(g.objectiveTargets().map((t) => t.met), [true, false, false]);
  assert.equal(g.objectivesNeeded(), 1);
  g.nextPhase(); g.nextPhase(); g.nextPhase();
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.s.result.won, true);
  // without the setting every target is needed
  const h = newGame({ objectives: [{ type: 'capture', territories: ['B1', 'B2'] }] });
  assert.equal(h.objectivesNeeded(), 2);
});

test('IPC line: destroying an infantry and a tank without losses reads Me 0 IPC / Them -9 IPC', () => {
  const D = require('../js/daily.js');
  const setup = Object.assign(scenario().setup, { B1: { owner: 'Soviet Union', units: { 'Soviet Union': { infantry: 1, tank: 1 } } } });
  let checked = 0;
  for (let seed = 1; seed < 200 && checked < 3; seed++) {
    const g = newGame({ setup }, seed);
    g.nextPhase();
    g.move('A1', ids(g, 'A1', 'infantry').concat(ids(g, 'A1', 'tank'), ids(g, 'A1', 'fighter')), 'B1');
    g.move('A2', ids(g, 'A2', 'infantry').concat(ids(g, 'A2', 'tank')), 'B1');
    g.nextPhase();
    g.startBattle('B1');
    g.autoResolve();
    const lost = g.s.battle.lost || { A: {}, D: {} };
    if (Object.keys(lost.A).length || g.s.battle.result !== 'attacker') continue; // want a flawless win
    checked++;
    assert.equal(g.s.losses.Axis || 0, 0);
    assert.equal(g.s.losses.Allies, 9, 'infantry 3 + tank 6');
    const line = D.shareText({ number: 1, title: 'T', won: true, turns: 1, maxTurns: 3, targets: [], luckYou: { dice: 1, diff: 0 }, luckFoe: { dice: 1, diff: 0 },
      lossYou: g.s.losses.Axis || 0, lossFoe: g.s.losses.Allies || 0 }).split('\n').find((l) => l.startsWith('Me '));
    assert.equal(line, 'Me 0 IPC / Them -9 IPC');
  }
  assert.ok(checked > 0, 'found flawless wins to check');
});

test('IPC losses always equal starting value + units placed - units left, per team', () => {
  const AI = require('../js/ai.js');
  const G = require('../js/generator.js');
  const tuv = (g) => {
    const out = {};
    for (const id of Object.keys(g.s.terr)) for (const u of g.s.terr[id].u) {
      if (g.def(u).infrastructure) continue;
      out[g.team(u.o)] = (out[g.team(u.o)] || 0) + g.def(u).cost;
    }
    return out;
  };
  const twMap = require('../maps/total_world_war.json');
  const cases = [];
  for (let i = 0; i < 4; i++) cases.push([map, scenario({ maxTurns: 4 }), i]);
  for (let i = 0; i < 4; i++) cases.push([twMap, G.generate(twMap, { seed: 50 + i, theater: ['eastern', 'pacific', 'mediterranean', 'china'][i], naval: i % 2 === 1, tune: 0, mapUnits: i % 2 === 0 }), i]);
  for (const [m, sc, seed] of cases) {
    const g = E.Game.create(m, sc, { seed: seed + 1 });
    const humans = Object.keys(g.s.powers).filter((p) => !g.s.powers[p].ai);
    for (const p of humans) g.s.powers[p].ai = true;
    g.humanTeam = () => g.s.powers[humans[0]].team;
    g.isHuman = (p) => humans.includes(p);
    const placed = {};
    const place = g.place.bind(g);
    g.place = (t, at) => {
      const r = place(t, at);
      if (r.ok && !g.R.units[t].infrastructure) placed[g.team(g.current())] = (placed[g.team(g.current())] || 0) + g.R.units[t].cost;
      return r;
    };
    const start = tuv(g);
    const ai = new AI(g);
    let n = 0;
    while (g.phase !== 'gameOver' && n++ < 20000) if (!ai.step()) break;
    const end = tuv(g);
    for (const t of new Set([...Object.keys(start), ...Object.keys(end)])) {
      assert.equal((g.s.losses || {})[t] || 0, (start[t] || 0) + (placed[t] || 0) - (end[t] || 0), `${m.id} ${sc.id || ''} ${t}`);
    }
  }
});

// ---- battles a person is in (uiHold): one roll at a time, casualties on show until the next action
function heldBattle(seed, sovietInf) {
  const g = newGame({ setup: Object.assign(scenario().setup, { B1: { owner: 'Soviet Union', units: { 'Soviet Union': { infantry: sovietInf } } } }) }, seed);
  g.s.uiHold = true;
  g.nextPhase();
  g.move('A1', ids(g, 'A1', 'infantry').concat(ids(g, 'A1', 'tank')), 'B1');
  g.move('A2', ids(g, 'A2', 'tank'), 'B1');
  g.nextPhase();
  assert.ok(g.startBattle('B1').ok);
  assert.ok(g.s.battle.hold);
  return g;
}
const soviets = (g) => g.units('B1').filter((u) => u.o === 'Soviet Union').length;
const germans = (g) => g.units('B1').filter((u) => u.o === 'Germany').length;

test('held battle: attacker rolls, defender casualties stay and fire back, attacker decides with casualties on show', () => {
  let sawDefHits = 0, sawAttHits = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const g = heldBattle(seed, 3);
    const b = g.s.battle;
    // 1. the attacker's roll only
    assert.ok(g.battleRoll().ok);
    assert.equal(b.need, 'roll');
    assert.equal(b.step, 'fireD', 'the defender rolls next');
    assert.equal(b.dice.A.length, 4);
    assert.equal(b.dice.D.length, 0);
    const defHits = (b.picks.D || []).length;
    assert.equal(soviets(g), 3, 'defender casualties are marked, not removed');
    if (defHits) {
      sawDefHits++;
      assert.deepEqual(g.casualtyChoice('D').picks, b.picks.D, 'default picks are on show');
    }
    // 2. the defender's roll: every defender fires, including the ones marked as casualties
    assert.ok(g.battleRoll().ok);
    assert.equal(b.dice.D.length, 3, 'casualties still fire back');
    assert.equal(b.dice.A.length, 4, 'the round keeps both sides\' dice');
    assert.equal(b.need, 'decision');
    assert.equal(b.doomed.length, defHits, 'defender picks were locked in by the defender roll');
    assert.equal(soviets(g), 3, 'still on the board until the attacker decides');
    const attHits = (b.picks.A || []).length;
    assert.equal(germans(g), 4);
    assert.equal(g.survivors('A').length, 4 - attHits);
    assert.equal(g.survivors('D').length, 3 - defHits);
    if (attHits) {
      sawAttHits++;
      // the attacker can still change its casualties: take tanks instead of infantry, or the other way round
      const ch = g.casualtyChoice('A');
      const alt = ch.units.filter((u) => !b.picks.A.includes(u.id)).slice(0, attHits).map((u) => u.id);
      if (alt.length === attHits) {
        assert.ok(g.battleAssign('A', alt).ok);
        assert.deepEqual(b.picks.A, alt);
      }
    }
    assert.equal(b.ending, 3 - defHits === 0 || 4 - attHits === 0);
    // 3. press the attack: only now do the round's casualties go
    const picksA = (b.picks.A || []).slice();
    assert.ok(g.battleContinue().ok);
    assert.equal(soviets(g), 3 - defHits);
    for (const id of picksA) assert.ok(!g.unit(id), 'attacker casualty removed');
    if (!g.s.battle.over) {
      assert.equal(g.s.battle.need, 'roll', 'the page rolls the next round itself (subs may dive first)');
      g.battleRoll();
      assert.equal(g.s.battle.round, 2);
      assert.equal(g.s.battle.step, 'fireD', 'the next round\'s attack is rolled');
      assert.equal(g.s.battle.dice.D.length, 0, 'last round\'s dice are cleared');
    }
  }
  assert.ok(sawDefHits && sawAttHits, 'some seeds score hits on both sides');
});

test('held and unheld battles play out the same (same dice, same default casualties)', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const a = heldBattle(seed, 4);
    const c = heldBattle(seed, 4);
    c.s.uiHold = false;
    c.s.battle.hold = false;
    a.autoResolve();
    c.autoResolve();
    assert.equal(a.s.battle.result, c.s.battle.result, 'seed ' + seed);
    assert.deepEqual(a.units('B1').map((u) => u.id), c.units('B1').map((u) => u.id), 'seed ' + seed);
    assert.deepEqual(a.s.stats, c.s.stats, 'seed ' + seed);
  }
});

test('held battle: retreat removes the round\'s casualties first, then moves the survivors', () => {
  let retreated = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const g = heldBattle(seed, 8);
    const b = g.s.battle;
    g.battleRoll();
    g.battleRoll();
    if (b.need !== 'decision' || b.ending) continue;
    const opts = g.retreatOptions();
    assert.ok(opts.length && opts.every((id) => id === 'A1' || id === 'A2'), 'back where they came from');
    const live = g.survivors('A').map((u) => u.id);
    const sovietsLeft = g.survivors('D').length;
    assert.ok(g.battleRetreat(opts[0]).ok);
    assert.ok(b.over && b.retreated);
    assert.equal(soviets(g), sovietsLeft);
    for (const id of live) assert.equal(g.whereIs(id), opts[0]);
    assert.equal(germans(g), 0);
    retreated++;
  }
  assert.ok(retreated > 0);
});

test('a battle saved mid-round by the earlier page still loads', () => {
  const g = heldBattle(3, 3);
  const st = JSON.parse(JSON.stringify(g.s));
  Object.assign(st.battle, { step: 'fire', held: true, need: 'casualties' });
  const h = new E.Game(map, scenario({ setup: Object.assign(scenario().setup, { B1: { owner: 'Soviet Union', units: { 'Soviet Union': { infantry: 3 } } } }) }), st);
  assert.equal(h.s.battle.step, 'fireA');
  assert.equal(h.s.battle.need, 'roll');
  assert.ok(!('held' in h.s.battle));
  h.autoResolve();
  assert.ok(h.s.battle.over);
});

// ---- units that cannot fight back (transports, AA guns) are destroyed rather than rolled at
function attackB1(seed, b1Units, movers) {
  const g = newGame({ setup: Object.assign(scenario().setup, { B1: { owner: 'Soviet Union', units: { 'Soviet Union': b1Units } } }) }, seed);
  g.s.uiHold = true;
  g.nextPhase();
  for (const [from, type] of movers) g.move(from, ids(g, from, type), 'B1');
  g.nextPhase();
  assert.ok(g.startBattle('B1').ok);
  return g;
}

test('AA guns alone are destroyed without a roll; the attacker takes the territory', () => {
  const g = attackB1(5, { aaa: 2 }, [['A1', 'tank']]);
  const b = g.s.battle;
  assert.ok(b.over, 'decided before any dice');
  assert.equal(b.result, 'attacker');
  assert.equal(g.s.stats.Axis.n, 0, 'nobody rolled');
  assert.equal(g.units('B1').filter((u) => u.t === 'aaa').length, 0);
  assert.equal(g.s.terr.B1.o, 'Germany');
  assert.equal(g.s.losses.Allies, 2 * g.R.units.aaa.cost, 'their value counts in the IPC exchange');
});

test('AA guns alone are destroyed without combat even when aircraft attack (rulebook pp. 16, 25: no AA shot)', () => {
  const g = attackB1(5, { aaa: 1 }, [['A1', 'tank'], ['A1', 'fighter']]);
  const b = g.s.battle;
  assert.ok(b.over);
  assert.equal(b.result, 'attacker');
  assert.equal(g.s.stats.Allies.n + g.s.stats.Axis.n, 0, 'no dice at all');
  assert.equal(ids(g, 'A1', 'fighter').length + g.units('B1').filter((u) => u.t === 'fighter').length, 1, 'the fighter is safe');
});

test('defenders left with only AA guns are destroyed at the end of the round, not rolled at round after round', () => {
  let checked = 0;
  for (let seed = 1; seed <= 30 && checked < 3; seed++) {
    const g = attackB1(seed, { infantry: 1, aaa: 1 }, [['A1', 'tank'], ['A2', 'tank']]);
    const b = g.s.battle;
    g.battleRoll();
    if (!b.picks.D || b.picks.D.length !== 1) continue; // want exactly one hit...
    assert.ok(g.battleAssign('D', ids(g, 'B1', 'infantry')).ok); // ...taken by the infantry, leaving the gun
    g.battleRoll();
    assert.ok(b.ending, 'the gun alone cannot fight back, so the battle is decided');
    assert.equal(b.autoLost.length, 1, 'shown as lost before the round is settled');
    const gun = b.autoLost[0];
    g.battleContinue();
    assert.ok(b.over && b.result === 'attacker');
    assert.ok(!g.unit(gun));
    assert.equal(b.round, 1);
    checked++;
  }
  assert.ok(checked > 0);
});

test('transports alone are sunk without a roll', () => {
  const g = newGame({ setup: Object.assign(scenario().setup, { S1: { units: { Germany: { destroyer: 1 } } }, S2: { units: { 'Soviet Union': { transport: 2 } } } }) }, 4);
  g.s.uiHold = true;
  g.nextPhase();
  assert.ok(g.move('S1', ids(g, 'S1', 'destroyer'), 'S2').ok);
  g.nextPhase();
  assert.ok(g.startBattle('S2').ok);
  const b = g.s.battle;
  assert.ok(b.over);
  assert.equal(b.result, 'attacker');
  assert.equal(g.units('S2').filter((u) => u.t === 'transport').length, 0);
  assert.equal(g.s.stats.Axis.n, 0);
});


// ---- 1942 Second Edition rulebook checks: placement in hostile seas, submarines, destroyers, defenceless transports
function seaGame(over, seed, ruleset) {
  const setup = Object.assign(scenario().setup, over);
  const g = newGame(Object.assign({ setup }, ruleset ? { ruleset } : {}), seed == null ? 3 : seed);
  g.s.uiHold = true;
  return g;
}
const toPhase = (g, ph) => { let n = 0; while (g.phase !== ph && n++ < 20) g.nextPhase(); assert.equal(g.phase, ph); };

test('new ships may be placed in a sea zone with enemy warships; no combat then, and the enemy must fight or leave on its turn', () => {
  const g = seaGame({ S1: { units: { 'Soviet Union': { destroyer: 1 } } } });
  g.buy('destroyer', 1);
  toPhase(g, 'place');
  const r = g.place('destroyer', 'S1');
  assert.ok(r.ok, r.error);
  assert.ok(!g.s.battle && !g.s.battles.length, 'no combat at placement');
  // the Soviet turn: its destroyer shares S1 with a German warship
  let n = 0;
  while (g.current() !== 'Soviet Union' && n++ < 20) g.nextPhase();
  toPhase(g, 'combatMove');
  g.nextPhase();
  assert.equal(g.phase, 'combat');
  assert.ok(g.s.battles.includes('S1'), 'staying means fighting');
});

test('leaving the shared sea zone avoids the battle', () => {
  const g = seaGame({ S1: { units: { 'Soviet Union': { destroyer: 1 } } } });
  g.buy('destroyer', 1);
  toPhase(g, 'place');
  g.place('destroyer', 'S1');
  let n = 0;
  while (g.current() !== 'Soviet Union' && n++ < 20) g.nextPhase();
  toPhase(g, 'combatMove');
  const r = g.move('S1', ids(g, 'S1', 'destroyer', 'Soviet Union'), 'S2');
  assert.ok(r.ok, r.error);
  g.nextPhase();
  assert.ok(!g.s.battles.includes('S1'));
});

test('Revised rules keep blocking placement among enemy warships', () => {
  const g = seaGame({ S1: { units: { 'Soviet Union': { destroyer: 1 } } } }, 3, 'revised');
  g.buy('destroyer', 1);
  toPhase(g, 'place');
  assert.equal(g.place('destroyer', 'S1').ok, false);
});

test('a submarine may end a noncombat move among enemy warships (no destroyer)', () => {
  const g = seaGame({ S1: { units: { Germany: { submarine: 1 } } }, S2: { units: { 'Soviet Union': { cruiser: 1 } } } });
  toPhase(g, 'noncombatMove');
  const r = g.move('S1', ids(g, 'S1', 'submarine'), 'S2');
  assert.ok(r.ok, r.error);
});

function subBattle(att, def, seed) {
  const g = seaGame({ S1: { units: { Germany: att } }, S2: { units: { 'Soviet Union': def } } }, seed);
  toPhase(g, 'combatMove');
  const r = g.move('S1', g.units('S1').filter((u) => u.o === 'Germany').map((u) => u.id), 'S2');
  assert.ok(r.ok, r.error);
  g.nextPhase();
  assert.ok(g.startBattle('S2').ok);
  return g;
}

test('defending submarines may submerge before a round when the attacker has no destroyer', () => {
  const g = subBattle({ cruiser: 1 }, { submarine: 1, transport: 1 });
  assert.ok(g.canSubmerge('D'));
  assert.ok(g.subChoicePending('D'));
  assert.ok(g.battleSubmerge('D').ok);
  const b = g.s.battle;
  // with the sub gone the transport is defenceless and is destroyed: the battle is over
  assert.ok(b.over);
  assert.equal(g.units('S2').filter((u) => u.t === 'submarine').length, 1, 'the submerged sub is still on the map');
  assert.equal(g.units('S2').filter((u) => u.t === 'transport').length, 0);
});

test('an enemy destroyer stops submerging and the surprise strike', () => {
  const g = subBattle({ destroyer: 1 }, { submarine: 1, cruiser: 1 });
  assert.ok(!g.canSubmerge('D'));
  assert.equal(g.battleSubmerge('D').ok, false);
  g.battleRoll();
  const b = g.s.battle;
  assert.ok(!b.dice.D.some((d) => d.k === 'subs'), 'no surprise strike against a destroyer');
});

test('submarines strike first when the enemy has no destroyer, and their hits cannot fall on aircraft', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const g = subBattle({ submarine: 2, fighter: 0 }, { cruiser: 1, fighter: 0 }, seed);
    g.battleRoll();
    const b = g.s.battle;
    assert.equal(b.dice.A.filter((d) => d.k === 'subs').length, 2, 'surprise strike');
    assert.equal(b.dice.D.length, 0, 'before any defender dice');
  }
});

test('transports with subs against aircraft only: the transports are defenceless (rulebook p. 17)', () => {
  const g = seaGame({ S1: { units: { 'Soviet Union': { submarine: 1, transport: 2 } } } });
  toPhase(g, 'combatMove');
  const r = g.move('A1', ids(g, 'A1', 'fighter'), 'S1');
  assert.ok(r.ok, r.error);
  g.nextPhase();
  assert.ok(g.startBattle('S1').ok);
  const b = g.s.battle;
  assert.equal(g.units('S1').filter((u) => u.t === 'transport').length, 0, 'transports destroyed without a roll');
  assert.ok(b.over, 'fighter and sub cannot hit each other');
});

test('attacking transports that can retreat are not destroyed as defenceless', () => {
  const g = seaGame({ S1: { units: { Germany: { transport: 1, destroyer: 1 } } }, S2: { units: { 'Soviet Union': { cruiser: 1, destroyer: 2 } } } });
  toPhase(g, 'combatMove');
  g.move('S1', g.units('S1').filter((u) => u.o === 'Germany').map((u) => u.id), 'S2');
  g.nextPhase();
  g.startBattle('S2');
  const b = g.s.battle;
  assert.ok(!b.over);
  assert.equal(g._helplessVictims(g._side('A').filter((u) => u.t === 'transport'), g._side('D'), 'A').length, 0, 'it can retreat to S1');
});

// ---- objectives: the computer's own, IPC goals, and a check on one turn
test('opponent objectives: the computer wins by holding its target at the end of its turn', () => {
  const g = newGame({ objectives: [{ type: 'capture', territories: ['B2'] }, { side: 'opponent', type: 'capture', territories: ['A3'] }] });
  assert.equal(g.objectiveStatus().length, 1, 'the player\'s list leaves the computer\'s out');
  assert.equal(g.opponentTargets()[0].id, 'A3');
  assert.equal(g.opponentStatus()[0].met, false);
  g.s.terr.A3.o = 'Soviet Union';
  assert.equal(g.opponentStatus()[0].met, true);
  // end the German turn, then the Soviet turn: the Soviets hold A3 at the end of theirs
  let n = 0;
  while (g.current() === 'Germany' && n++ < 10) g.nextPhase();
  assert.notEqual(g.phase, 'gameOver', 'not checked at the end of the player\'s turn');
  while (g.current() === 'Soviet Union' && g.phase !== 'gameOver' && n++ < 20) g.nextPhase();
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.s.result.won, false);
  assert.match(g.s.result.reason, /enemy/);
});

test('bank objective: met when the side has that much money at the check', () => {
  const g = newGame({ objectives: [{ type: 'bank', ipc: 25 }], purchase: false });
  assert.equal(g.objectiveStatus()[0].met, false, '20 IPC to start');
  assert.deepEqual(g.objectiveTargets(), [{ id: null, type: 'bank', met: false }]);
  assert.equal(g.objectivesNeeded(), 1);
  let n = 0;
  while (g.current() === 'Germany' && g.phase !== 'gameOver' && n++ < 10) g.nextPhase();
  // income (3 + 2 + 1 IPC of German land) takes the bank to 26 at the end of the turn
  assert.equal(g.phase, 'gameOver');
  assert.ok(g.s.result.won, g.s.result.reason);
});

test('damage objective: enough enemy value destroyed, own losses within the limit', () => {
  const g = newGame({ objectives: [{ type: 'damage', inflict: 6, maxLoss: 3 }] });
  g.s.losses = { Allies: 6, Axis: 4 };
  let st = g.objectiveStatus()[0];
  assert.equal(st.inflicted, 6);
  assert.equal(st.taken, 4);
  assert.equal(st.met, false, 'lost too much');
  g.s.losses.Axis = 3;
  st = g.objectiveStatus()[0];
  assert.equal(st.met, true);
});

test('winCheck "turn": objectives count only at the end of that turn, and missing them there ends the game', () => {
  const g = newGame({ objectives: [{ type: 'bank', ipc: 1 }], winCheck: 'turn', checkTurn: 2, maxTurns: 3, purchase: false });
  let n = 0;
  while (g.s.round === 1 && g.phase !== 'gameOver' && n++ < 30) g.nextPhase();
  assert.notEqual(g.phase, 'gameOver', 'met in turn 1, but only turn 2 counts');
  while (g.phase !== 'gameOver' && n++ < 60) g.nextPhase();
  assert.ok(g.s.result.won);
  assert.equal(g.s.result.turns, 2);
  const h = newGame({ objectives: [{ type: 'bank', ipc: 999 }], winCheck: 'turn', checkTurn: 2, maxTurns: 3, purchase: false });
  n = 0;
  while (h.phase !== 'gameOver' && n++ < 60) h.nextPhase();
  assert.equal(h.s.result.won, false);
  assert.equal(h.s.result.turns, 2, 'the game ends at the check');
});

test('validation of the new objectives', () => {
  const { map: m, scenario: S } = require('./fixture.js');
  const v = (o) => E.Game.validate(m, S(o)).filter((x) => x.level === 'error').map((x) => x.msg);
  assert.ok(v({ objectives: [{ side: 'opponent', type: 'capture', territories: ['A1'] }] }).some((x) => /for the player/.test(x)));
  assert.ok(v({ objectives: [{ type: 'bank' }] }).some((x) => /bank/.test(x)));
  assert.ok(v({ objectives: [{ type: 'damage', inflict: 0 }] }).some((x) => /damage/.test(x)));
  assert.ok(v({ winCheck: 'turn', checkTurn: 9 }).some((x) => /checked on/.test(x)));
  assert.deepEqual(v({ objectives: [{ type: 'bank', ipc: 30 }, { side: 'opponent', type: 'damage', inflict: 10 }] }), []);
});
