const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const TA = require('../js/triplea.js');
const E = require('../js/engine.js');
const AI = require('../js/ai.js');
const G = require('../js/generator.js');
const D = require('../js/daily.js');
const { map: fixtureMap, scenario } = require('./fixture.js');

const data = (f) => fs.readFileSync(path.join(__dirname, 'data', f), 'utf8');

test('TripleA import: territories, connections, values, owners, units, money', () => {
  const m = TA.convert({ xml: data('mini-triplea.xml'), polygons: data('mini-polygons.txt'), centers: data('mini-centers.txt'), id: 'mini' });
  assert.equal(m.name, 'Mini Test Map');
  assert.equal(m.territories.length, 3);
  const a = m.territories.find((t) => t.name === 'Alpha Land');
  assert.equal(a.id, 'alpha_land');
  assert.equal(a.ipc, 5);
  assert.equal(a.owner, 'Germany');
  assert.equal(a.capital, 'Germany');
  assert.ok(a.factory);
  assert.deepEqual(a.adj, ['1_sea_zone', 'beta_land']);
  assert.deepEqual(a.center, [50, 50]);
  assert.equal(m.territories.find((t) => t.id === '1_sea_zone').type, 'sea');
  assert.deepEqual(m.defaultSetup.alpha_land.units.Germany, { infantry: 3, tank: 1, factory: 1 });
  assert.deepEqual(m.defaultMoney, { Germany: 30, 'Soviet Union': 24 });
  assert.ok(m.warnings.some((w) => w.includes('mystery_unit')));
  assert.equal(m.powers.find((p) => p.id === 'Germany').team, 'Axis');
  // an imported map is playable
  const sc = {
    id: 'mini-test', map: 'mini', ruleset: '1942', maxTurns: 2, playable: m.territories.map((t) => t.id),
    powers: { Germany: { team: 'Axis', controller: 'human', money: 30 }, 'Soviet Union': { team: 'Allies', controller: 'ai', money: 24 } },
    setup: m.defaultSetup, objectives: [{ type: 'capture', territories: ['beta_land'] }],
  };
  const r = AI.selfPlay(m, sc, { seed: 3 });
  assert.ok(r.result, 'game finishes');
});

test('AI self-play finishes on the fixture under every rule set', () => {
  for (const rs of ['1942', '1941', 'revised', 'classic']) {
    for (let i = 0; i < 6; i++) {
      const r = AI.selfPlay(fixtureMap, scenario({ ruleset: rs, maxTurns: 4 }), { seed: i * 31 + 1 });
      assert.ok(r.result, `${rs} game ${i} finished`);
    }
  }
});

test('generator: valid, playable scenarios on the world map', () => {
  const map = require('../maps/world1942.json');
  for (const [theater, naval] of [['eastern', false], ['mediterranean', false], ['pacific', true]]) {
    const sc = G.generate(map, { seed: 11, theater, naval, tune: 2 });
    const errs = E.Game.validate(map, sc).filter((m) => m.level === 'error');
    assert.deepEqual(errs, [], theater);
    assert.ok(sc.objectives[0].territories.length >= 1);
    assert.ok(sc.maxTurns >= 2);
    E.Game.create(map, sc, { seed: 1 });
    const v = G.variant(map, sc, { seed: 5, tune: 0 });
    assert.deepEqual(E.Game.validate(map, v).filter((m) => m.level === 'error'), []);
  }
});

test('world map: symmetric adjacency, ids unique, every territory reachable', () => {
  const map = require('../maps/world1942.json');
  const T = {};
  for (const t of map.territories) { assert.ok(!T[t.id], 'unique ' + t.id); T[t.id] = t; }
  for (const t of map.territories) for (const a of t.adj) assert.ok(T[a] && T[a].adj.includes(t.id), `${t.id} <-> ${a}`);
  const seen = new Set(['moscow']);
  const q = ['moscow'];
  while (q.length) { const x = q.shift(); for (const y of T[x].adj) if (!seen.has(y)) { seen.add(y); q.push(y); } }
  const unreachable = map.territories.filter((t) => !seen.has(t.id)).map((t) => t.id);
  assert.deepEqual(unreachable, []);
  for (const t of map.territories) assert.ok(t.path && t.center && t.bbox, t.id);
});

test('daily: schedule lookup, numbering and share text', () => {
  const sch = { epoch: '2026-11-18', days: { '2026-11-18': 'puzzles/a.json', '2026-11-20': 'puzzles/b.json' } };
  assert.equal(D.number(sch, '2026-11-18'), 1);
  assert.equal(D.number(sch, '2026-12-01'), 14);
  assert.deepEqual(D.entryFor(sch, '2026-11-19'), { date: '2026-11-18', file: 'puzzles/a.json' });
  assert.equal(D.entryFor(sch, '2026-11-19', true), null);
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  const txt = D.shareText({ number: 3, title: 'Kursk', won: true, turns: 2, maxTurns: 4, history: [{ progress: 0.5 }, { progress: 1 }],
    luckYou: { dice: 20, diff: 1.24 }, luckFoe: { dice: 15, diff: -0.8 }, url: 'https://example.org/' });
  assert.equal(txt, 'Tacticle #3 · Kursk\n🏆 Won in 2/4 turns\n🟨🟩\n🎲 I rolled above the odds (+1.2 hits)\n🎲 Foe rolled below the odds (−0.8 hits)\nhttps://example.org/');
});

test('authoring server: save a puzzle, index it, save the schedule', async () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tacticle-'));
  for (const d of ['puzzles', 'maps', 'tools']) fs.mkdirSync(path.join(tmp, d));
  fs.copyFileSync(path.join(__dirname, '..', 'tools', 'serve.js'), path.join(tmp, 'tools', 'serve.js'));
  const { server } = require(path.join(tmp, 'tools', 'serve.js'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const call = (method, p, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ code: res.statusCode, body: s }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
  try {
    let r = await call('PUT', '/api/puzzles/my-puzzle', { title: 'My puzzle', map: 'world1942', ruleset: '1942', maxTurns: 3 });
    assert.equal(r.code, 200);
    assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'puzzles', 'my-puzzle.json'))).id, 'my-puzzle');
    assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'puzzles', 'index.json'))).puzzles[0].title, 'My puzzle');
    r = await call('PUT', '/api/puzzles/Bad%20Id', {});
    assert.equal(r.code, 400);
    r = await call('PUT', '/api/schedule', { epoch: '2026-11-18', days: { '2026-11-19': 'puzzles/my-puzzle.json', bogus: 'x' } });
    assert.equal(r.code, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, 'schedule.json'))).days, { '2026-11-19': 'puzzles/my-puzzle.json' });
    r = await call('GET', '/../../etc/passwd');
    assert.notEqual(r.code, 200);
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
