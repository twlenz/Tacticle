#!/usr/bin/env node
/*
 * Import maps from TripleA's published catalogue into maps/.
 *
 *   node tools/triplea_fetch.js list [search]          maps in the TripleA catalogue
 *   node tools/triplea_fetch.js games <repo>           games (scenarios) a map offers
 *   node tools/triplea_fetch.js import <repo> [--game "<name or file>"] [--id <map id>] [--credit "<text>"]
 *
 * Only text files are downloaded (game XML, polygons, centres, properties); no images.
 * The authoring page has the same importer under Scenario → TripleA maps.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const TA = require('../js/triplea.js');
const { refreshMapIndex } = require('./serve.js');

const ROOT = path.resolve(__dirname, '..');

async function fetchText(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return await r.text();
  } catch (e) {
    if (/HTTP \d+/.test(e.message)) throw e;
    // fall back to curl (honours proxy settings)
    try { return execFileSync('curl', ['-sSf', '-m', '120', url], { encoding: 'utf8', maxBuffer: 64 << 20 }); } catch (e2) { throw new Error(`${url}: ${e.message}`); }
  }
}

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : null;
}

async function main() {
  const [cmd, a1] = process.argv.slice(2);
  if (cmd === 'list') {
    const maps = await TA.listMaps(fetchText);
    const q = (a1 || '').toLowerCase();
    for (const m of maps) {
      if (q && !(m.name + ' ' + m.text).toLowerCase().includes(q)) continue;
      console.log(`${m.repo.padEnd(40)} ${(m.category || '-').padEnd(13)} ${m.name}`);
    }
    return;
  }
  if (cmd === 'games' && a1) {
    for (const g of await TA.listGames(a1, arg('branch') || 'master', fetchText)) console.log(`${g.file.padEnd(48)} ${g.name}`);
    return;
  }
  if (cmd === 'import' && a1) {
    const maps = await TA.listMaps(fetchText);
    const entry = maps.find((m) => m.repo === a1) || { repo: a1, branch: arg('branch') || 'master', name: a1 };
    const games = await TA.listGames(entry.repo, entry.branch, fetchText);
    const want = (arg('game') || '').toLowerCase();
    const game = want ? games.find((g) => g.file.toLowerCase() === want || g.name.toLowerCase() === want || g.name.toLowerCase().includes(want)) : games[games.length - 1];
    if (!game) throw new Error(`No game “${arg('game')}”. Games: ${games.map((g) => g.name).join(' | ')}`);
    console.log(`Importing ${entry.name} → ${game.name} (${game.file})`);
    const map = await TA.importGame(entry, game, fetchText, { id: arg('id'), credit: arg('credit') || '' });
    const file = path.join(ROOT, 'maps', map.id + '.json');
    fs.writeFileSync(file, JSON.stringify(map));
    refreshMapIndex();
    console.log(`Wrote maps/${map.id}.json (${Math.round(fs.statSync(file).size / 1024)} KB): ${map.territories.length} territories, ${map.powers.length} powers`);
    for (const w of map.warnings.slice(0, 6)) console.log('  note:', w);
    return;
  }
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 11).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
