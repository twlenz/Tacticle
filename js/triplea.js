/*
 * Convert a TripleA map (game XML + polygons.txt + centers.txt) into a Tacticle map.
 * TripleA is open-source; its map files are plain text. Only the geometry, connections,
 * production values, owners and starting units are read; images are not used.
 *
 *   TacticleTripleA.convert({ xml, polygons, centers, id, name, wrapX }) -> map JSON
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TacticleTripleA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Tiny XML reader: returns {name, attrs, children}. Enough for TripleA game files. */
  function parseXml(text) {
    const rootNode = { name: '#root', attrs: {}, children: [] };
    const stack = [rootNode];
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
    const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(text))) {
      if (m[1]) { // closing
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

  const UNIT_MAP = {
    infantry: 'infantry', artillery: 'artillery', armour: 'tank', armor: 'tank', tank: 'tank', aaGun: 'aaa', aagun: 'aaa', aa: 'aaa',
    factory: 'factory', industrial_complex: 'factory', fighter: 'fighter', bomber: 'bomber', transport: 'transport', submarine: 'submarine',
    destroyer: 'destroyer', cruiser: 'cruiser', carrier: 'carrier', battleship: 'battleship',
    mech_infantry: 'infantry', tactical_bomber: 'fighter',
  };
  const POWER_MAP = {
    Germans: 'Germany', Russians: 'Soviet Union', British: 'United Kingdom', Japanese: 'Japan', Americans: 'United States',
    Italians: 'Italy', Chinese: 'China', French: 'France',
  };
  const COLORS = {
    'Germany': '#5d6b73', 'Soviet Union': '#a63a32', 'United Kingdom': '#c9a96b', 'Italy': '#8a6a48', 'Japan': '#df8f31',
    'United States': '#5a8447', 'China': '#2f8a8f', 'France': '#4767ad',
  };
  const EXTRA = ['#7b5ea7', '#3f7f6a', '#a05a7a', '#6a7f3f', '#5a6fa0', '#a07a3f'];

  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 't'; }

  function convert(opts) {
    const doc = parseXml(opts.xml);
    const polys = parsePolygons(opts.polygons || '');
    const centers = parseCenters(opts.centers || '');
    const warnings = [];
    const info = all(doc, 'info')[0];
    const name = opts.name || (info && info.attrs.name) || 'Imported map';
    // territories
    const terr = {};
    const ids = {};
    const used = new Set();
    for (const t of all(doc, 'territory')) {
      const nm = t.attrs.name;
      let id = slug(nm);
      while (used.has(id)) id += '_';
      used.add(id);
      ids[nm] = id;
      terr[nm] = { id, name: nm, type: t.attrs.water === 'true' ? 'sea' : 'land', ipc: 0, owner: null, capital: null, factory: false, adj: new Set() };
    }
    for (const c of all(doc, 'connection')) {
      const a = terr[c.attrs.t1], b = terr[c.attrs.t2];
      if (!a || !b) continue;
      a.adj.add(b.id); b.adj.add(a.id);
    }
    // players, alliances
    const powerOf = {};
    const powers = [];
    let ex = 0;
    const alliances = {};
    for (const a of all(doc, 'alliance')) alliances[a.attrs.player] = a.attrs.alliance;
    for (const p of all(doc, 'player')) {
      const pid = POWER_MAP[p.attrs.name] || p.attrs.name;
      powerOf[p.attrs.name] = pid;
      let team = alliances[p.attrs.name] || 'Allies';
      if (!/axis|allies/i.test(team)) team = team || 'Allies';
      powers.push({ id: pid, name: pid, team: /axis/i.test(team) ? 'Axis' : /allies/i.test(team) ? 'Allies' : team, color: COLORS[pid] || EXTRA[ex++ % EXTRA.length] });
    }
    // territory attachments
    for (const at of all(doc, 'attachment')) {
      if (!/territoryAttachment/i.test(at.attrs.name || '') && !/TerritoryAttachment/.test(at.attrs.javaClass || '')) continue;
      const t = terr[at.attrs.attachTo];
      if (!t) continue;
      for (const o of at.children.filter((c) => c.name === 'option')) {
        if (o.attrs.name === 'production') t.ipc = +o.attrs.value || 0;
        if (o.attrs.name === 'capital') t.capital = powerOf[o.attrs.value] || o.attrs.value;
        if (o.attrs.name === 'isImpassable' && o.attrs.value === 'true') t.impassable = true;
      }
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
      const type = UNIT_MAP[u.attrs.unitType];
      if (!type) { skipped[u.attrs.unitType] = 1; continue; }
      const p = powerOf[u.attrs.owner] || u.attrs.owner;
      const s = defaultSetup[t.id] = defaultSetup[t.id] || { units: {} };
      s.units[p] = s.units[p] || {};
      s.units[p][type] = (s.units[p][type] || 0) + (+u.attrs.quantity || 1);
      if (type === 'factory') t.factory = true;
    }
    if (Object.keys(skipped).length) warnings.push('Unit types without a Tacticle match were left out: ' + Object.keys(skipped).join(', '));
    const defaultMoney = {};
    for (const r of all(doc, 'resourceGiven')) {
      if (r.attrs.resource && !/PU|IPC/i.test(r.attrs.resource)) continue;
      defaultMoney[powerOf[r.attrs.player] || r.attrs.player] = +r.attrs.quantity || 0;
    }
    // geometry
    let W = 0, H = 0;
    const out = [];
    for (const nm of Object.keys(terr)) {
      const t = terr[nm];
      const ps = polys[nm];
      if (!ps) { warnings.push(`No polygon for ${nm}`); continue; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const path = ps.map((pts) => 'M' + pts.map((p) => {
        x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
        return p[0] + ',' + p[1];
      }).join('L') + 'Z').join('');
      W = Math.max(W, x1); H = Math.max(H, y1);
      const c = centers[nm] || [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)];
      out.push({
        id: t.id, name: t.name, type: t.type, ipc: t.ipc, owner: t.type === 'sea' ? null : t.owner, capital: t.capital, factory: t.factory,
        neutral: t.type !== 'sea' && !t.owner, center: c, bbox: [x0, y0, x1, y1], adj: [...t.adj].sort(), path,
      });
    }
    // drop powers that own nothing and have no units
    return {
      format: 'tacticle-map', version: 1, id: opts.id || slug(name), name, source: 'TripleA import',
      description: `Imported from the TripleA map “${name}”.`,
      width: Math.ceil(W), height: Math.ceil(H), wrapX: !!opts.wrapX,
      powers, territories: out, canals: [], defaultSetup, defaultMoney, warnings,
    };
  }

  return { convert, parseXml, parsePolygons, parseCenters, slug };
});
