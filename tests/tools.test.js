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
  // an empty day replays an earlier puzzle, keeps its own date (fresh save, own number) and is the same for everyone
  assert.deepEqual(D.entryFor(sch, '2026-11-19'), { date: '2026-11-19', file: 'puzzles/a.json', replay: true, from: '2026-11-18' });
  assert.equal(D.entryFor(sch, '2026-11-19', true), null);
  assert.deepEqual(D.entryFor(Object.assign({ fallback: 'latest' }, sch), '2026-11-19'), { date: '2026-11-18', file: 'puzzles/a.json' });
  assert.equal(D.entryFor(sch, '2026-11-17'), null, 'nothing before the first puzzle');
  const many = { epoch: '2026-01-01', days: {} };
  for (let i = 0; i < 20; i++) many.days[D.addDays('2026-01-01', i)] = `puzzles/p${i}.json`;
  const picks = [];
  for (let i = 30; i < 60; i++) {
    const d = D.addDays('2026-01-01', i);
    const e = D.entryFor(many, d);
    assert.deepEqual(e, D.entryFor(JSON.parse(JSON.stringify(many)), d), 'deterministic');
    assert.ok(e.replay && many.days[e.from] === e.file);
    picks.push(e.file);
  }
  assert.ok(new Set(picks).size > 8, 'replays vary from day to day');
  for (let i = 1; i < picks.length; i++) assert.notEqual(picks[i], picks[i - 1], 'no back-to-back repeat');
  // a week after the last scheduled day, recent puzzles are avoided while older ones exist
  const e = D.entryFor(many, '2026-01-21');
  assert.ok(+e.file.match(/p(\d+)/)[1] < 13, e.file);
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  // a loss: one square per objective territory, yellow = taken, red = not
  let txt = D.shareText({ number: 1, title: 'Karelian Front', won: false, turns: 1, maxTurns: 4, objectivesDone: 2, objectivesTotal: 3,
    targets: [{ met: true }, { met: true }, { met: false }], luckYou: { dice: 20, diff: -3 }, luckFoe: { dice: 15, diff: 3.24 },
    lossYou: 15, lossFoe: 25, url: 'https://twlenz.github.io/Tacticle/index.html' });
  assert.equal(txt, 'Tacticle #1 · Karelian Front\n💀 Lost · 2/3 objectives · 1/4 turns\n🟨🟨🟥\n🎲 I rolled below odds (-3 hits)\n🎲 Opponent rolled above odds (+3.2 hits)\nMe -15 IPC / Them -25 IPC\ntwlenz.github.io/Tacticle');
  // a win where 2 of 3 was enough: green = taken, orange = not needed
  txt = D.shareText({ number: 3, title: 'Kursk', won: true, turns: 2, maxTurns: 4, targets: [{ met: true }, { met: false }, { met: true }],
    luckYou: { dice: 20, diff: 0.1 }, luckFoe: { dice: 0 }, lossYou: 0, lossFoe: 12, url: 'https://twlenz.github.io/Tacticle/' });
  assert.equal(txt, 'Tacticle #3 · Kursk\n🏆 Won in 2/4 turns\n🟩🟧🟩\n🎲 I rolled at odds (+0.1 hits)\n🎲 Opponent rolled no dice\nMe 0 IPC / Them -12 IPC\ntwlenz.github.io/Tacticle');
  assert.equal(D.shortUrl('http://localhost:8080/'), 'http://localhost:8080/');
  // free play: no squares or turns, just the outcome, dice and IPCs
  txt = D.shareText({ number: 1, title: 'Karelian Front', freePlay: true, won: true, turns: 2, maxTurns: 4, targets: [{ met: true }],
    luckYou: { dice: 10, diff: 1 }, luckFoe: { dice: 9, diff: -0.5 }, lossYou: 6, lossFoe: 20, url: 'https://twlenz.github.io/Tacticle/' });
  assert.equal(txt, 'Tacticle #1 · Karelian Front\nI won in free play\n🎲 I rolled above odds (+1 hits)\n🎲 Opponent rolled below odds (-0.5 hits)\nMe -6 IPC / Them -20 IPC\ntwlenz.github.io/Tacticle');
});

test('authoring server: save a puzzle, index it, save the schedule', async () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tacticle-'));
  for (const d of ['puzzles', 'maps', 'tools']) fs.mkdirSync(path.join(tmp, d));
  fs.copyFileSync(path.join(__dirname, '..', 'tools', 'serve.js'), path.join(tmp, 'tools', 'serve.js'));
  const { server } = require(path.join(tmp, 'tools', 'serve.js'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const call = (method, p, body, headers) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, (res) => {
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
    // a sibling folder whose name starts like the repository's must stay unreachable
    fs.mkdirSync(tmp + '-secret');
    fs.writeFileSync(tmp + '-secret/secret.txt', 'secret');
    r = await call('GET', '/..%2f' + path.basename(tmp) + '-secret%2fsecret.txt');
    assert.notEqual(r.code, 200, 'sibling folder with the same prefix');
    assert.ok(!r.body.includes('secret'));
    // nor through a symlink inside the repository
    fs.symlinkSync(tmp + '-secret', path.join(tmp, 'link'));
    r = await call('GET', '/link/secret.txt');
    assert.equal(r.code, 403, 'symlink out of the repository');
    // hidden files
    fs.writeFileSync(path.join(tmp, '.env'), 'TOKEN=x');
    r = await call('GET', '/.env');
    assert.equal(r.code, 403);
    r = await call('GET', '/puzzles/my-puzzle.json');
    assert.equal(r.code, 200);
    assert.equal(r.code === 200 && JSON.parse(r.body).id, 'my-puzzle');
    // DNS rebinding: a foreign Host header is refused, for files and API alike
    r = await call('GET', '/puzzles/my-puzzle.json', null, { Host: 'evil.example:' + port });
    assert.equal(r.code, 421);
    r = await call('PUT', '/api/schedule', { days: {} }, { Host: 'evil.example' });
    assert.equal(r.code, 421);
    // cross-site API calls (CSRF) are refused; same-origin ones work
    r = await call('PUT', '/api/puzzles/x1', { title: 'x' }, { Origin: 'https://evil.example' });
    assert.equal(r.code, 403);
    r = await call('DELETE', '/api/puzzles/my-puzzle', null, { 'Sec-Fetch-Site': 'cross-site' });
    assert.equal(r.code, 403);
    assert.ok(fs.existsSync(path.join(tmp, 'puzzles', 'my-puzzle.json')));
    r = await call('OPTIONS', '/api/puzzles/x1', null, { Origin: 'https://evil.example' });
    assert.equal(r.code, 403);
    r = await call('PUT', '/api/puzzles/x2', { title: 'ok' }, { Origin: 'http://localhost:' + port, 'Sec-Fetch-Site': 'same-origin' });
    assert.equal(r.code, 200);
    // only JSON bodies; schedule entries must be puzzle files
    r = await call('PUT', '/api/puzzles/x3', { title: 'x' }, { 'Content-Type': 'text/plain' });
    assert.equal(r.code, 415);
    r = await call('PUT', '/api/schedule', { epoch: '2026-11-18', days: { '2026-11-20': 'https://evil.example/p.json' } });
    assert.equal(r.code, 400);
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(tmp + '-secret', { recursive: true, force: true });
  }
});

test('TripleA unit names map onto Tacticle units', () => {
  const cases = {
    infantry: 'infantry', germanInfantry: 'infantry', 'italianMech.Infantry': 'infantry', japaneseMarine: 'infantry', germanParatrooper: 'infantry',
    armour: 'tank', germanTank: 'tank', artillery: 'artillery', germanAntiTankGun: 'artillery', aaGun: 'aaa', AntiAirGun: 'aaa',
    factory: 'factory', germanFactory: 'factory', fighter: 'fighter', americanNavalFighter: 'fighter', germanTacticalBomber: 'fighter',
    bomber: 'bomber', germanStrategicBomber: 'bomber', transport: 'transport', britishTransport: 'transport', submarine: 'submarine',
    destroyer: 'destroyer', cruiser: 'cruiser', carrier: 'carrier', britishBattleship: 'battleship',
    Flagpole: null, germanAirfield: null, britishHull: null, Rail: null, americanAirTransport: null, Truck: null, britishDocks: null,
  };
  for (const k of Object.keys(cases)) assert.equal(TA.mapUnit(k), cases[k], k);
});

test('TripleA catalogue, map.yml and map.properties parsing', () => {
  const idx = TA.parseIndex([
    '# comment',
    '- mapName: Total World War',
    '  mapCategory: BEST',
    '  url: https://github.com/triplea-maps/total_world_war/archive/refs/heads/master.zip',
    '  img: https://example.org/p.png',
    '  version: 7',
    '  description: |',
    '    <br>Created by <b>someone</b>',
    '    December 1941',
    '- mapName: Odd Branch',
    '  url: https://github.com/triplea-maps/odd_branch/archive/main.zip',
  ].join('\n'));
  assert.equal(idx.length, 2);
  assert.deepEqual([idx[0].repo, idx[0].branch, idx[0].category], ['total_world_war', 'master', 'BEST']);
  assert.equal(idx[0].text, 'Created by someone December 1941');
  assert.deepEqual([idx[1].repo, idx[1].branch], ['odd_branch', 'main']);
  assert.deepEqual(TA.parseMapYml("map_name: x\ngames:\n- {game_name: 'Total World War: 3.0', file_name: TWW_3.0.xml}\n"), [{ name: 'Total World War: 3.0', file: 'TWW_3.0.xml' }]);
  assert.deepEqual(TA.parseMapYml('map_name: y\ngames:\n- game_name: World War II v3 1942\n  file_name: WW2v3-1942.xml\n'), [{ name: 'World War II v3 1942', file: 'WW2v3-1942.xml' }]);
  const m = TA.convert({ xml: data('mini-triplea.xml'), polygons: data('mini-polygons.txt'), properties: 'color.Germans=112233\nmap.scrollWrapX=true\nmap.width=400\n' });
  assert.equal(m.powers.find((p) => p.id === 'Germany').color, '#112233');
  assert.equal(m.wrapX, true);
  assert.equal(m.width, 400);
  assert.deepEqual(m.turnOrder, []);
});

test('canals restrict ships between their sea zones', () => {
  const map = JSON.parse(JSON.stringify(fixtureMap));
  map.canals = [{ id: 'c', name: 'Test canal', a: 'S1', b: 'S2', requires: ['B1'] }];
  const g = E.Game.create(map, scenario(), { seed: 2 });
  g.nextPhase();
  const dd = g.units('S1').filter((u) => u.t === 'destroyer').map((u) => u.id);
  assert.equal(g.checkMove('S1', dd, 'S2').ok, false, 'canal held by the enemy');
  g.move('A1', g.units('A1').filter((u) => u.t === 'infantry').slice(0, 1).map((u) => u.id), 'B1');
  assert.equal(g.s.terr.B1.o, 'Germany');
  assert.ok(g.checkMove('S1', dd, 'S2').ok, 'canal open once captured');
});

test('bundled TripleA maps: symmetric adjacency, geometry, playable generator puzzles', () => {
  const idx = require('../maps/index.json').maps;
  const tri = idx.filter((m) => m.source === 'TripleA');
  assert.ok(tri.length >= 1);
  for (const entry of tri) {
    const map = require('../' + entry.file);
    const T = {};
    for (const t of map.territories) T[t.id] = t;
    for (const t of map.territories) {
      assert.ok(t.path && t.center && t.bbox, t.id);
      for (const a of t.adj) assert.ok(T[a] && T[a].adj.includes(t.id), `${entry.id}: ${t.id} <-> ${a}`);
    }
    for (const c of map.canals) assert.ok(T[c.a] && T[c.b], c.name);
    const sc = G.generate(map, { seed: 4, theater: 'eastern', tune: 0, mapUnits: true });
    assert.deepEqual(E.Game.validate(map, sc).filter((m) => m.level === 'error'), [], entry.id);
    assert.ok(AI.selfPlay(map, sc, { seed: 1 }).result, entry.id + ' self-play finishes');
  }
});

test('AI: when the player is about to win, it counter-attacks the objective even at poor odds', () => {
  // Germany (player) took B2 and only needs to keep it to the end of the round
  const sc = scenario({ winCheck: 'roundEnd', objectives: [{ type: 'capture', territories: ['B2'] }] });
  const run = (objectiveHeld) => {
    const g = E.Game.create(fixtureMap, sc, { seed: 4 });
    for (const id of ['B1', 'B2', 'A3']) g.s.terr[id].u = [];
    g.s.terr.B2.o = objectiveHeld ? 'Germany' : 'Soviet Union';
    let id = 900;
    for (let i = 0; i < 4; i++) g.s.terr.B2.u.push({ id: id++, t: 'infantry', o: objectiveHeld ? 'Germany' : 'Soviet Union', ml: 1, h: 0 });
    g.s.terr.B1.o = 'Soviet Union';
    for (const t of ['infantry', 'infantry', 'tank']) g.s.terr.B1.u.push({ id: id++, t, o: 'Soviet Union', ml: g.R.units[t].move, h: 0 });
    g.s.turn = 1; // Soviet Union to move
    g._startTurn();
    g.nextPhase(); // to combat move
    const ai = new AI(g);
    let n = 0;
    while (g.phase === 'combatMove' && n++ < 50) ai.step();
    return g.s.battles.slice();
  };
  // 2 inf + 1 tank against 4 defending infantry is a long shot (~16%), yet it must try: B2 decides the game
  assert.ok(E.simulate({ infantry: 2, tank: 1 }, { infantry: 4 }, { trials: 400 }).win < 0.3);
  assert.deepEqual(run(true), ['B2']);
});

test('AI: picks the attack with the better expected IPC swing', () => {
  // two targets next to B1 with no capital or factory in play: A1 (1 infantry, 3 IPC of units)
  // and A2 (4 artillery, 16 IPC of units); A1 even has more income, but A2 is the bigger swing
  const sc = scenario({ objectives: [{ type: 'capture', territories: ['I'] }] });
  const g = E.Game.create(fixtureMap, sc, { seed: 9 });
  for (const id of Object.keys(g.s.terr)) g.s.terr[id].u = [];
  g.s.powers.Germany.capital = null;
  let id = 1000;
  const put = (at, o, t, n) => { for (let i = 0; i < n; i++) g.s.terr[at].u.push({ id: id++, t, o, ml: g.R.units[t].move, h: 0 }); };
  g.s.terr.B1.o = 'Soviet Union';
  put('B1', 'Soviet Union', 'tank', 3);
  put('B1', 'Soviet Union', 'infantry', 2);
  put('A1', 'Germany', 'infantry', 1);
  put('A2', 'Germany', 'artillery', 4);
  g.s.turn = 1;
  g._startTurn();
  g.nextPhase();
  const ai = new AI(g);
  let n = 0;
  while (g.phase === 'combatMove' && n++ < 50) ai.step();
  assert.ok(g.s.battles.includes('A2'), 'goes for the bigger expected IPC swing (the artillery)');
});

// ---- player results (GoatCounter) and the share line
test('results: paths, counter parsing and calibration', () => {
  const RS = require('../js/results.js');
  assert.ok(RS.valid('tacticle') && !RS.valid('') && !RS.valid('Bad Code') && !RS.valid('x.evil.com'));
  assert.equal(RS.dayPath('2026-11-20', 'karelian-front', 'won'), '/tacticle/2026-11-20/karelian-front/won');
  assert.equal(RS.puzzlePath('karelian-front', 'lost'), '/tacticle/puzzle/karelian-front/lost');
  assert.throws(() => RS.dayPath('2026-11-20', '../x', 'won'));
  assert.equal(RS.counterUrl('tacticle', '/tacticle/puzzle/a/won'), 'https://tacticle.goatcounter.com/counter/%2Ftacticle%2Fpuzzle%2Fa%2Fwon.json');
  assert.ok(RS.hitUrl('tacticle', '/tacticle/puzzle/a/won').startsWith('https://tacticle.goatcounter.com/count?p=%2Ftacticle%2Fpuzzle%2Fa%2Fwon&'));
  assert.equal(RS.parseCount({ count: '1,234' }), 1234);
  assert.equal(RS.parseCount({}), 0);
  assert.deepEqual(RS.without({ won: 3, lost: 2 }, true), { won: 2, lost: 2 });
  assert.equal(RS.pct({ won: 17, lost: 3 }), 85);
  assert.equal(RS.pct({ won: 0, lost: 0 }), null);
  // 20 players won 85% where the check said 50%; 10 players won 70% where it said 40%; a 3-player puzzle is ignored
  const cal = RS.calibration([
    { players: { won: 17, lost: 3 }, sim: 0.5 },
    { players: { won: 7, lost: 3 }, sim: 0.4 },
    { players: { won: 3, lost: 0 }, sim: 0.1 },
    { players: { won: 9, lost: 1 }, sim: null },
  ], 5);
  assert.deepEqual(cal, { gap: 33, players: 30, puzzles: 2 });
});

test('share text: other players\' win rate is the second-to-last line', () => {
  const base = { number: 4, title: 'T', won: true, turns: 2, maxTurns: 3, objectivesDone: 1, objectivesTotal: 1, luckYou: { dice: 0, diff: 0 }, luckFoe: { dice: 0, diff: 0 }, lossYou: 3, lossFoe: 9, url: 'https://twlenz.github.io/Tacticle/' };
  const lines = D.shareText(Object.assign({ others: { won: 31, lost: 19 }, today: true }, base)).split('\n');
  assert.equal(lines[lines.length - 2], '🌍 62% of other players won today');
  assert.equal(lines[lines.length - 1], 'twlenz.github.io/Tacticle');
  assert.ok(!D.shareText(Object.assign({ others: { won: 0, lost: 0 } }, base)).includes('🌍'), 'no line without other players');
  assert.ok(!D.shareText(Object.assign({ others: null }, base)).includes('🌍'));
});

test('AI: settings follow the role (the side defending objectives gets the defensive settings)', () => {
  const capture = E.Game.create(fixtureMap, scenario({ objectives: [{ type: 'capture', territories: ['B2'] }] }), { seed: 1 });
  const ai = new AI(capture);
  assert.equal(capture.current(), 'Germany'); // the player's side
  assert.equal(ai._role(), 'attack');
  assert.equal(ai.opts.deadZone, AI.DEFAULTS.deadZone);
  capture.s.turn = 1; // Soviet Union, the computer
  assert.equal(ai._role(), 'defend');
  assert.equal(ai.opts.deadZone, AI.ROLES.defend.deadZone);
  // only "hold" objectives: the player defends, the computer attacks
  const hold = E.Game.create(fixtureMap, scenario({ objectives: [{ type: 'hold', territories: ['A1'] }] }), { seed: 1 });
  const ai2 = new AI(hold);
  assert.equal(ai2._role(), 'defend');
  hold.s.turn = 1;
  assert.equal(ai2._role(), 'attack');
  // a puzzle can keep the earlier opponent
  assert.deepEqual(AI.opponentOptions({ opponent: 'earlier' }), { roles: false });
  const old = new AI(capture, AI.opponentOptions({ opponent: 'earlier' }));
  assert.equal(old.opts.deadZone, AI.DEFAULTS.deadZone);
});

test('results: the calibration curve is fitted in log-odds, so the gap shrinks near 0% and 100%', () => {
  const RS = require('../js/results.js');
  const sig = (x) => 1 / (1 + Math.exp(-x));
  const logit = (p) => Math.log(p / (1 - p));
  // synthetic puzzles from a known curve: real = σ(1.2 + 0.7·logit(sim))
  const rows = [0.2, 0.35, 0.5, 0.65, 0.8].map((sim) => { const n = 400, k = Math.round(n * sig(1.2 + 0.7 * logit(sim))); return { players: { won: k, lost: n - k }, sim }; });
  const fit = RS.fitCalibration(rows, 5);
  assert.ok(Math.abs(fit.a - 1.2) < 0.1 && Math.abs(fit.b - 0.7) < 0.1, JSON.stringify(fit));
  assert.ok(Math.abs(RS.simFromReal(fit, RS.realFromSim(fit, 0.3)) - 0.3) < 1e-9, 'the inverse undoes the curve');
  // one puzzle (85% of players won where the check said 50%): a shift in log-odds only
  const one = RS.fitCalibration([{ players: { won: 17, lost: 3 }, sim: 0.5 }], 5);
  assert.equal(one.b, 1);
  const at = (x) => Math.round(100 * RS.realFromSim(one, x));
  assert.ok(at(0.5) >= 80 && at(0.5) <= 86, String(at(0.5)));
  assert.ok(at(0.95) < 100 && at(0.95) - 95 < 5, 'near 100% the gap is small: ' + at(0.95));
  assert.ok(at(0.1) - 10 > 20, 'at 10% the gap is large: ' + at(0.1));
});
