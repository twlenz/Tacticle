/*
 * TripleA maps for Tacticle.
 *
 * TripleA (https://triplea-game.org) publishes its map catalogue and every map's files on
 * GitHub. This module reads that catalogue, fetches a map's text files from
 * raw.githubusercontent.com (no images), and converts one of its games into a Tacticle map:
 * geometry, connections, production values, owners, capitals, canals, turn order,
 * starting units and money.
 *
 *   TacticleTripleA.listMaps(fetchText)                     -> [{name, repo, branch, category, img, description}]
 *   TacticleTripleA.listGames(repo, branch, fetchText)      -> [{name, file}]
 *   TacticleTripleA.importGame(entry, game, fetchText, opts)-> Tacticle map JSON
 *   TacticleTripleA.convert({xml, polygons, centers, properties, id, name}) -> Tacticle map JSON
 * fetchText(url) must return a Promise of the response text (throwing on HTTP errors).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TacticleTripleA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const INDEX_URL = 'https://raw.githubusercontent.com/triplea-game/triplea/master/triplea_maps.yaml';
  const RAW = 'https://raw.githubusercontent.com/triplea-maps/';

  // ------------------------------------------------------------------ XML
  /** Tiny XML reader: returns {name, attrs, children}. Enough for TripleA game files. */
  function parseXml(text) {
    const rootNode = { name: '#root', attrs: {}, children: [] };
    const stack = [rootNode];
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
    const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(text))) {
      if (m[1]) {
        while (stack.length > 1) { const n = stack.pop(); if (n.name === m[1]) break; }
        continue;
      }
      if (!m[2]) continue;
      const node = { name: m[2], attrs: {}, children: [] };
      let a;
      attrRe.lastIndex = 0;
      while ((a = attrRe.exec(m[3] || ''))) node.attrs[a[1]] = decode(a[2] !== undefined ? a[2] : a[3]);
      stack[stack.length - 1].children.push(node);
      if (!m[4]) stack.push(node);
    }
    return rootNode;
  }
  function decode(s) {
    return s.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (x, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e] || String.fromCharCode(+e.slice(1))));
  }
  function all(node, name, out) {
    out = out || [];
    for (const c of node.children) { if (c.name === name) out.push(c); all(c, name, out); }
    return out;
  }
  function options(at) {
    const o = {};
    for (const c of at.children) if (c.name === 'option') o[c.attrs.name] = c.attrs.value;
    return o;
  }

  // ------------------------------------------------------------------ text files
  function parsePolygons(text) {
    const out = {};
    for (const line of text.split(/\r?\n/)) {
      const i = line.indexOf('<');
      if (i < 0) continue;
      const name = line.slice(0, i).trim();
      const polys = [];
      const re = /<([^>]*)>/g;
      let m;
      while ((m = re.exec(line.slice(i)))) {
        const pts = [];
        const pr = /\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)/g;
        let p;
        while ((p = pr.exec(m[1]))) pts.push([+p[1], +p[2]]);
        if (pts.length >= 3) polys.push(pts);
      }
      if (name && polys.length) out[name] = (out[name] || []).concat(polys);
    }
    return out;
  }
  function parseCenters(text) {
    const out = {};
    for (const line of (text || '').split(/\r?\n/)) {
      const m = /^(.*?)\s*\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)/.exec(line);
      if (m && m[1].trim()) out[m[1].trim()] = [+m[2], +m[3]];
    }
    return out;
  }
  function parseProperties(text) {
    const out = {};
    for (const line of (text || '').split(/\r?\n/)) {
      const m = /^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out[m[1]] = m[2];
    }
    return out;
  }

  /** The catalogue (triplea_maps.yaml): a list of maps with a few scalar fields and an HTML description. */
  function parseIndex(text) {
    const maps = [];
    let cur = null, inDesc = false;
    for (const line of text.split(/\r?\n/)) {
      const start = /^- mapName:\s*(.*)$/.exec(line);
      if (start) {
        cur = { name: unquote(start[1]), category: '', url: '', img: '', description: '' };
        maps.push(cur);
        inDesc = false;
        continue;
      }
      if (!cur) continue;
      const kv = /^ {2}(\w+):\s*(.*)$/.exec(line);
      if (kv) {
        inDesc = false;
        if (kv[1] === 'description') { inDesc = true; if (kv[2] && kv[2] !== '|' && kv[2] !== '>') cur.description = kv[2]; }
        else if (kv[1] === 'mapCategory') cur.category = kv[2].trim();
        else if (kv[1] === 'url') cur.url = kv[2].trim();
        else if (kv[1] === 'img') cur.img = kv[2].trim();
        continue;
      }
      if (inDesc && /^ {4}/.test(line)) cur.description += line.trim() + ' ';
    }
    for (const m of maps) {
      const u = /github\.com\/triplea-maps\/([^/]+)\/archive\/(?:refs\/heads\/)?([^/]+?)\.zip/.exec(m.url);
      m.repo = u ? u[1] : m.name.toLowerCase().replace(/ /g, '_');
      m.branch = u ? u[2] : 'master';
      m.text = m.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    // the catalogue lists a few maps twice
    const seen = new Set();
    return maps.filter((m) => (seen.has(m.repo) ? false : seen.add(m.repo)));
  }
  function unquote(s) { s = String(s).trim(); return /^(['"]).*\1$/.test(s) ? s.slice(1, -1) : s; }

  /** map.yml: games list in block or flow style. */
  function parseMapYml(text) {
    const games = [];
    let cur = null;
    for (const line of text.split(/\r?\n/)) {
      const flow = /^\s*-\s*\{(.*)\}\s*$/.exec(line);
      if (flow) {
        const g = {};
        for (const part of flow[1].match(/(\w+):\s*('[^']*'|"[^"]*"|[^,]+)/g) || []) {
          const i = part.indexOf(':');
          g[part.slice(0, i).trim()] = unquote(part.slice(i + 1));
        }
        if (g.file_name) games.push({ name: g.game_name || g.file_name, file: g.file_name });
        continue;
      }
      const item = /^\s*-\s*(\w+):\s*(.*)$/.exec(line);
      if (item) { cur = {}; cur[item[1]] = unquote(item[2]); games.push(cur); continue; }
      const kv = /^\s+(\w+):\s*(.*)$/.exec(line);
      if (kv && cur) cur[kv[1]] = unquote(kv[2]);
    }
    return games.map((g) => (g.file ? g : { name: g.game_name || g.file_name, file: g.file_name })).filter((g) => g.file);
  }

  // ------------------------------------------------------------------ conversion
  /** TripleA unit type -> Tacticle unit (null = left out). Handles per-nation names like germanInfantry. */
  function mapUnit(type) {
    const t = String(type).toLowerCase().replace(/[^a-z]/g, '');
    const has = (...w) => w.some((x) => t.includes(x));
    if (has('airtransport', 'aircraftplant', 'airfield', 'airbase', 'hull', 'flag', 'rail', 'truck', 'material', 'barrack', 'fortif', 'entrench',
      'occupation', 'research', 'train', 'protectorate', 'dock', 'harbo', 'navalbase', 'winter', 'unitsfor', 'bunker', 'mine', 'capital', 'victory')) return null;
    if (has('battleship')) return 'battleship';
    if (has('carrier')) return 'carrier';
    if (has('cruiser')) return 'cruiser';
    if (has('destroyer')) return 'destroyer';
    if (has('submarine')) return 'submarine';
    if (has('transport')) return 'transport';
    if (has('strategicbomber', 'heavybomber') || t === 'bomber' || /bomber$/.test(t) && !has('tactical', 'dive', 'torpedo')) return 'bomber';
    if (has('fighter', 'tacticalbomber', 'divebomber', 'torpedobomber', 'tacbomber', 'plane')) return 'fighter';
    if (has('antiair', 'aagun', 'flak') || t === 'aa') return 'aaa';
    if (has('factory', 'industrialcomplex', 'industry')) return 'factory';
    if (has('artillery', 'antitank', 'atgun', 'howitzer')) return 'artillery';
    if (has('tank', 'armour', 'armor', 'panzer')) return 'tank';
    if (has('infantry', 'marine', 'paratroop', 'engineer', 'alpine', 'militia', 'conscript', 'elite', 'guard', 'mechinf', 'mech')) return 'infantry';
    return null;
  }

  const POWER_MAP = {
    Germans: 'Germany', German: 'Germany', Russians: 'Soviet Union', Russia: 'Soviet Union', Soviets: 'Soviet Union', USSR: 'Soviet Union',
    British: 'United Kingdom', Britain: 'United Kingdom', UK: 'United Kingdom', Japanese: 'Japan', Americans: 'United States',
    Usa: 'United States', USA: 'United States', America: 'United States', Italians: 'Italy', Chinese: 'China', French: 'France',
  };
  const COLORS = {
    Germany: '#5d6b73', 'Soviet Union': '#a63a32', 'United Kingdom': '#c9a96b', Italy: '#8a6a48', Japan: '#df8f31',
    'United States': '#5a8447', China: '#2f8a8f', France: '#4767ad',
  };
  const EXTRA = ['#7b5ea7', '#3f7f6a', '#a05a7a', '#6a7f3f', '#5a6fa0', '#a07a3f', '#4f8f8f', '#8f4f6f'];

  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 't'; }

  /** Ramer-Douglas-Peucker on a closed ring. */
  function simplify(pts, tol) {
    if (pts.length < 8 || !tol) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = 1; keep[pts.length - 1] = 1;
    const t2 = tol * tol;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = pts[a], [bx, by] = pts[b];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let best = -1, bd = t2;
      for (let i = a + 1; i < b; i++) {
        const [px, py] = pts[i];
        let d;
        if (!len2) d = (px - ax) ** 2 + (py - ay) ** 2;
        else {
          const c = dx * (py - ay) - dy * (px - ax);
          d = (c * c) / len2;
        }
        if (d > bd) { bd = d; best = i; }
      }
      if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    const out = pts.filter((p, i) => keep[i]);
    return out.length >= 3 ? out : pts;
  }
  /** Compact SVG path with relative coordinates. */
  function ringPath(pts) {
    let s = 'M' + num(pts[0][0]) + ',' + num(pts[0][1]) + 'l';
    let [px, py] = pts[0];
    const parts = [];
    for (let i = 1; i < pts.length; i++) {
      const dx = round1(pts[i][0] - px), dy = round1(pts[i][1] - py);
      if (!dx && !dy) continue;
      parts.push(num(dx) + (dy >= 0 ? ',' : '') + num(dy));
      px = pts[i][0]; py = pts[i][1];
    }
    return s + parts.join(' ').replace(/ -/g, '-') + 'z';
  }
  function round1(v) { return Math.round(v * 10) / 10; }
  function num(v) {
    let s = String(round1(v));
    if (s.startsWith('0.')) s = s.slice(1); else if (s.startsWith('-0.')) s = '-' + s.slice(2);
    return s;
  }

  function convert(opts) {
    const doc = parseXml(opts.xml);
    const polys = parsePolygons(opts.polygons || '');
    const centers = parseCenters(opts.centers || '');
    const props = parseProperties(opts.properties || '');
    const tol = opts.tolerance == null ? 1.2 : opts.tolerance;
    const warnings = [];
    const info = all(doc, 'info')[0];
    const name = opts.name || (info && info.attrs.name) || 'Imported map';
    // territories
    const terr = {};
    const used = new Set();
    for (const t of all(doc, 'territory')) {
      const nm = t.attrs.name;
      let id = slug(nm);
      while (used.has(id)) id += '_';
      used.add(id);
      terr[nm] = { id, name: nm, type: t.attrs.water === 'true' ? 'sea' : 'land', ipc: 0, owner: null, capital: null, factory: false, adj: new Set() };
    }
    for (const c of all(doc, 'connection')) {
      const a = terr[c.attrs.t1], b = terr[c.attrs.t2];
      if (!a || !b || a === b) continue;
      a.adj.add(b.id); b.adj.add(a.id);
    }
    // players, alliances, turn order
    const powerOf = {};
    const powers = [];
    const alliances = {};
    for (const a of all(doc, 'alliance')) if (!alliances[a.attrs.player]) alliances[a.attrs.player] = a.attrs.alliance;
    let ex = 0;
    for (const p of all(doc, 'player')) {
      const pid = POWER_MAP[p.attrs.name] || p.attrs.name;
      powerOf[p.attrs.name] = pid;
      const al = alliances[p.attrs.name] || '';
      const team = /axis/i.test(al) ? 'Axis' : /allie/i.test(al) ? 'Allies' : (al || 'Neutral');
      const col = props['color.' + p.attrs.name];
      powers.push({ id: pid, name: pid, team, color: col && /^[0-9a-f]{6}$/i.test(col) ? '#' + col.toLowerCase() : (COLORS[pid] || EXTRA[ex++ % EXTRA.length]), triplea: p.attrs.name });
    }
    const turnOrder = [];
    for (const st of all(doc, 'step')) {
      const p = st.attrs.player && powerOf[st.attrs.player];
      if (p && !turnOrder.includes(p) && !/bid/i.test(st.attrs.delegate || '')) turnOrder.push(p);
    }
    // attachments: territory values, capitals, impassable; canals
    const canals = {};
    for (const at of all(doc, 'attachment')) {
      const o = options(at);
      if (/CanalAttachment/i.test(at.attrs.javaClass || '') || /canal/i.test(at.attrs.name || '')) {
        const t = terr[at.attrs.attachTo];
        if (!t || !o.canalName) continue;
        const c = canals[o.canalName] = canals[o.canalName] || { name: o.canalName, seas: [], requires: new Set() };
        c.seas.push(t.id);
        for (const l of (o.landTerritories || '').split(':')) if (terr[l]) c.requires.add(terr[l].id);
        continue;
      }
      if (!/territoryAttachment/i.test(at.attrs.name || '') && !/TerritoryAttachment/.test(at.attrs.javaClass || '')) continue;
      const t = terr[at.attrs.attachTo];
      if (!t) continue;
      if (o.production) t.ipc = +o.production || 0;
      if (o.capital) t.capital = powerOf[o.capital] || o.capital;
      if (o.isImpassable === 'true') t.impassable = true;
    }
    // starting owners, units, money
    for (const o of all(doc, 'territoryOwner')) {
      const t = terr[o.attrs.territory];
      if (t) t.owner = powerOf[o.attrs.owner] || o.attrs.owner;
    }
    const defaultSetup = {};
    const skipped = {};
    for (const u of all(doc, 'unitPlacement')) {
      const t = terr[u.attrs.territory];
      if (!t) continue;
      const type = mapUnit(u.attrs.unitType);
      if (!type) { skipped[u.attrs.unitType] = 1; continue; }
      if (t.type === 'sea' && type === 'factory') continue;
      const p = powerOf[u.attrs.owner] || u.attrs.owner;
      if (!p) continue;
      const s = defaultSetup[t.id] = defaultSetup[t.id] || { units: {} };
      s.units[p] = s.units[p] || {};
      s.units[p][type] = (s.units[p][type] || 0) + (+u.attrs.quantity || 1);
      if (type === 'factory') t.factory = true;
    }
    const sk = Object.keys(skipped);
    if (sk.length) warnings.push(`${sk.length} unit types have no Tacticle equivalent and were left out (${sk.slice(0, 12).join(', ')}${sk.length > 12 ? ', …' : ''})`);
    const defaultMoney = {};
    for (const r of all(doc, 'resourceGiven')) {
      if (r.attrs.resource && !/^(PUs?|IPCs?|PU)$/i.test(r.attrs.resource)) continue;
      defaultMoney[powerOf[r.attrs.player] || r.attrs.player] = +r.attrs.quantity || 0;
    }
    // geometry
    let W = +props['map.width'] || 0, H = +props['map.height'] || 0;
    const out = [];
    for (const nm of Object.keys(terr)) {
      const t = terr[nm];
      const ps = polys[nm];
      if (!ps) { warnings.push(`No polygon for ${nm}`); continue; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const path = ps.map((pts) => {
        for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
        return ringPath(simplify(pts, tol));
      }).join('');
      if (!props['map.width']) W = Math.max(W, x1);
      if (!props['map.height']) H = Math.max(H, y1);
      const c = centers[nm] || [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)];
      const land = t.type !== 'sea';
      const owner = land && !t.impassable ? t.owner : null;
      out.push({
        id: t.id, name: t.name, type: t.type, ipc: t.ipc, owner, capital: t.capital, factory: t.factory,
        neutral: land && !owner, impassable: !!t.impassable, center: c, bbox: [x0, y0, x1, y1], adj: [...t.adj].sort(), path,
      });
    }
    const canalList = [];
    for (const c of Object.values(canals)) {
      for (let i = 0; i < c.seas.length; i++) for (let j = i + 1; j < c.seas.length; j++) {
        canalList.push({ id: slug(c.name) + (canalList.length ? '_' + canalList.length : ''), name: c.name, a: c.seas[i], b: c.seas[j], requires: [...c.requires] });
      }
    }
    const usedPowers = new Set(out.map((t) => t.owner).filter(Boolean));
    for (const s of Object.values(defaultSetup)) for (const p of Object.keys(s.units)) usedPowers.add(p);
    return {
      format: 'tacticle-map', version: 1, id: opts.id || slug(name), name, source: 'TripleA',
      description: `“${name}” from TripleA${opts.credit ? ' — ' + opts.credit : ''}.`,
      credit: opts.credit || '', origin: opts.origin || null,
      width: Math.ceil(W), height: Math.ceil(H), wrapX: opts.wrapX != null ? !!opts.wrapX : props['map.scrollWrapX'] === 'true',
      powers: powers.filter((p) => usedPowers.has(p.id)), turnOrder: turnOrder.filter((p) => usedPowers.has(p)),
      territories: out, canals: canalList, defaultSetup, defaultMoney, warnings,
    };
  }

  // ------------------------------------------------------------------ fetching
  async function listMaps(fetchText) {
    return parseIndex(await fetchText(INDEX_URL));
  }
  async function listGames(repo, branch, fetchText) {
    const base = `${RAW}${repo}/${branch || 'master'}/`;
    try {
      const games = parseMapYml(await fetchText(base + 'map.yml'));
      if (games.length) return games;
    } catch (e) { /* older maps have no map.yml */ }
    throw new Error(`${repo} has no map.yml listing its games; download the map and use “Import from files”`);
  }
  async function firstOk(urls, fetchText) {
    let last;
    for (const u of urls) {
      try { return { url: u, text: await fetchText(u) }; } catch (e) { last = e; }
    }
    throw last || new Error('not found');
  }
  /** entry: {repo, branch, name, text}; game: {name, file}. */
  async function importGame(entry, game, fetchText, opts) {
    opts = opts || {};
    const base = `${RAW}${entry.repo}/${entry.branch || 'master'}/`;
    const poly = await firstOk([base + 'map/polygons.txt', base + 'polygons.txt'], fetchText);
    const dir = poly.url.slice(0, poly.url.lastIndexOf('/') + 1);
    const xml = await firstOk([dir + 'games/' + game.file, base + 'games/' + game.file, base + 'map/games/' + game.file], fetchText);
    let centers = '', properties = '';
    try { centers = await fetchText(dir + 'centers.txt'); } catch (e) { /* optional */ }
    try { properties = await fetchText(dir + 'map.properties'); } catch (e) { /* optional */ }
    const map = convert({
      xml: xml.text, polygons: poly.text, centers, properties, name: game.name,
      id: opts.id || slug(entry.repo === slug(game.name) ? entry.repo : game.name),
      credit: opts.credit || '', origin: { repo: entry.repo, branch: entry.branch || 'master', game: game.file, map: entry.name },
    });
    return map;
  }

  return { convert, parseXml, parsePolygons, parseCenters, parseProperties, parseIndex, parseMapYml, mapUnit, simplify, listMaps, listGames, importGame, slug, INDEX_URL, RAW };
});
