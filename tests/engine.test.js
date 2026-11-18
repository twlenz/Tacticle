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
