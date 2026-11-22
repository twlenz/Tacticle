/* Tacticle authoring tool. */
(function () {
  'use strict';
  const E = window.TacticleEngine, Rules = window.TacticleRules, D = window.TacticleDaily, I = window.TacticleIcons, TA = window.TacticleTripleA, GEN = window.TacticleGen;
  const LM = window.TacticleLocalMaps;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* blocked */ } },
  };
  // pages (tabs on the left) and the steps of Edit Map, each with the map tool it uses
  const PAGES = [['select', 'Select Map'], ['edit', 'Edit Map'], ['schedule', 'Schedule'], ['files', 'Files']];
  const SUBS = [
    ['territories', 'Select Territories', 'playable', 'Territories', 'P'],
    ['owners', 'Select Owners', 'owner', 'Owners', 'O'],
    ['units', 'Place Units', 'select', 'Units', 'U'],
    ['objectives', 'Set Objectives', 'objective', 'Objectives', 'J'],
    ['test', 'Test', 'select', 'Test', 'T'],
  ];
  // keyboard: a step, or a Place Units mode (U places the chosen unit, M moves units, S selects)
  const KEYS = { p: ['territories'], o: ['owners'], u: ['units', 'units'], m: ['units', 'move'], s: ['units', 'select'], j: ['objectives'], t: ['test'] };
  const A = {
    server: false, dir: null, maps: [], map: null, mv: null, sc: null, tool: 'playable',
    page: 'select', sub: 'territories', preview: null, mapCache: {}, thumbs: {}, thumbLoading: {}, savedAs: null, overwrite: null,
    brush: { power: null, unit: 'infantry', obj: 0 }, selected: null, hist: [], fut: [], savedJSON: null,
    puzzles: [], schedule: { epoch: D.today(), days: {} }, worker: null, jobs: {}, jobN: 0, lastSim: null,
  };

  // ------------------------------------------------------------------ boot
  async function boot() {
    try { const r = await fetch('api/status', { cache: 'no-store' }); A.server = r.ok && (await r.json()).writable; } catch (e) { A.server = false; }
    try { A.maps = (await getJSON('maps/index.json')).maps || []; } catch (e) { A.maps = [{ id: 'world1942', name: 'World 1942', file: 'maps/world1942.json' }]; }
    await refreshPuzzles();
    try { A.schedule = await getJSON('schedule.json'); } catch (e) { A.schedule = { epoch: D.today(), days: {} }; }
    // without a server, schedule changes made earlier in this browser are kept until downloaded
    A.schedule.days = A.schedule.days || {};
    const schedDraft = !A.server && store.get(SCHED_DRAFT);
    if (schedDraft && schedDraft.days) {
      const same = scheduleText() === JSON.stringify(Object.assign({ epoch: schedDraft.epoch }, schedDraft.fallback === 'latest' ? { fallback: 'latest' } : {}, { days: sortObj(schedDraft.days) }), null, 2);
      if (same) store.del(SCHED_DRAFT); // already published
      else A.schedule = schedDraft;
    }
    // maps imported in this browser (no server to save them to) are listed too
    if (LM && !A.server) for (const m of await LM.list()) if (!A.maps.some((x) => x.id === m.id)) A.maps.push({ id: m.id, name: m.name, file: `maps/${m.id}.json`, local: true });
    wire();
    const draft = store.get('tacticle:authorDraft');
    let problem = null;
    if (draft && draft.sc && typeof draft.sc === 'object') {
      try {
        A.savedJSON = draft.savedJSON || null;
        await useMap(draft.sc.map, Object.assign(newScenario(draft.sc.map), draft.sc), true);
        renderAll();
      } catch (e) {
        // keep the draft so nothing is lost, and start fresh instead of failing to load
        console.error(e);
        problem = e.message;
        store.set('tacticle:authorDraftUnopened', draft);
        A.sc = null;
      }
    }
    if (!A.sc) {
      A.savedJSON = null;
      const first = (A.maps.find((m) => !m.local) || A.maps[0] || {}).id || 'world1942';
      await useMap(first, newScenario(first), true);
      renderAll();
    }
    A.preview = A.sc.map;
    A.savedAs = A.savedJSON && A.sc.id && A.puzzles.some((p) => p.id === A.sc.id) ? A.sc.id : null;
    if (A.sc.playable.length) goSub('territories'); else { goPage('select'); A.mv.setFocus(null); }
    if (problem) toast(`Your last draft could not be opened, so this is a new puzzle. ${problem}`, 9000);
    else toast(A.server ? 'Connected to the local server: Save writes into puzzles/ and schedule.json' : 'No local server: Save downloads files (or connect a folder in Files)', 4000);
  }
  /** Last resort: say what went wrong on the page rather than leaving it blank. */
  function showFatal(e) {
    console.error(e);
    const box = document.createElement('div');
    box.className = 'fatal';
    box.innerHTML = `<b>The authoring tool could not start.</b><p>${esc((e && e.message) || e)}</p><button id="fatalReset">Start over</button><p class="hint">Starting over sets aside the unsaved draft in this browser. Saved puzzles are not touched.</p>`;
    document.body.appendChild(box);
    $('fatalReset').onclick = () => {
      try {
        const d = localStorage.getItem('tacticle:authorDraft');
        if (d) localStorage.setItem('tacticle:authorDraftUnopened', d);
        localStorage.removeItem('tacticle:authorDraft');
      } catch (x) { /* storage blocked */ }
      location.reload();
    };
  }
  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  }
  async function refreshPuzzles() {
    try {
      A.puzzles = A.server ? await getJSON('api/puzzles') : ((await getJSON('puzzles/index.json')).puzzles || []);
    } catch (e) { A.puzzles = []; }
  }
  function newScenario(mapId) {
    return {
      format: 'tacticle-scenario', version: 1, id: '', title: 'Untitled puzzle', description: '', author: '',
      map: mapId || (A.map && A.map.id) || 'world1942', ruleset: Rules.DEFAULT, difficulty: 'medium',
      playable: [], maxTurns: 4, winCheck: 'turnEnd', income: true, purchase: true,
      powers: {}, turnOrder: [], setup: {}, objectives: [{ type: 'capture', territories: [] }],
    };
  }
  /** The map from this site, or the copy kept in this browser for maps imported without a server. */
  async function fetchMap(id) {
    if (A.mapCache[id]) return A.mapCache[id];
    const map = await fetchMapFresh(id);
    A.mapCache[id] = map;
    return map;
  }
  async function fetchMapFresh(id) {
    const known = A.maps.find((m) => m.id === id);
    const file = known && /^maps\/[a-z0-9][a-z0-9_-]{0,63}\.json$/i.test(known.file) ? known.file : `maps/${String(id).replace(/[^a-z0-9_-]/gi, '')}.json`;
    let map = known && known.local && LM ? await LM.get(id) : null;
    if (!map) {
      try { map = await getJSON(file); } catch (e) { map = LM ? await LM.get(id) : null; }
    }
    if (!map) throw new Error(`The map “${id}” is not on this site (${file}) and no copy of it is kept in this browser. Add the map file to maps/ and maps/index.json, or import it again.`);
    if (!Array.isArray(map.territories) || !map.territories.length) throw new Error(`${file} is not a Tacticle map`);
    return map;
  }
  /**
   * Switch to a map together with the scenario that belongs on it. Nothing changes if the map cannot be
   * loaded, so a missing map can never leave a scenario pointing at territories that are not there.
   */
  async function useMap(id, sc, initial, mapObj) {
    const map = mapObj || await fetchMap(id);
    A.map = map;
    A.T = {};
    for (const t of map.territories) A.T[t.id] = t;
    A.sc = tidy(sc || A.sc);
    A.sc.map = map.id;
    A.selected = null;
    A.msel = null;
    if (A.mv) A.mv.destroy();
    A.mv = new window.TacticleMapView($('map'), map, { onClick, onContext, onHover });
    A.mv.setFocus(A.sc.playable.length ? A.sc.playable : null);
    if (!A.brush.power || !(map.powers || []).some((p) => p.id === A.brush.power)) A.brush.power = ((map.powers || [])[0] || {}).id;
    if (!initial) renderAll();
  }
  /** Drop anything the current map does not have, so an old draft or a re-imported map cannot break the editor. */
  function tidy(sc) {
    const base = newScenario(A.map.id);
    for (const k of Object.keys(base)) if (sc[k] == null) sc[k] = base[k];
    sc.playable = [...new Set((Array.isArray(sc.playable) ? sc.playable : []).filter((id) => A.T[id]))];
    if (typeof sc.setup !== 'object') sc.setup = {};
    for (const id of Object.keys(sc.setup)) if (!A.T[id] || !sc.setup[id] || typeof sc.setup[id] !== 'object') delete sc.setup[id];
    sc.objectives = (Array.isArray(sc.objectives) ? sc.objectives : []).filter((o) => o && typeof o === 'object');
    if (!sc.objectives.length) sc.objectives = [{ type: 'capture', territories: [] }];
    for (const o of sc.objectives) o.territories = (Array.isArray(o.territories) ? o.territories : []).filter((id) => A.T[id]);
    if (typeof sc.powers !== 'object' || Array.isArray(sc.powers)) sc.powers = {};
    sc.turnOrder = (Array.isArray(sc.turnOrder) ? sc.turnOrder : []).filter((p) => sc.powers[p]);
    for (const p of Object.keys(sc.powers)) if (!sc.turnOrder.includes(p)) sc.turnOrder.push(p);
    return sc;
  }

  // ------------------------------------------------------------------ scenario helpers
  const R = () => Rules.get(A.sc.ruleset);
  function powerInfo(p) { return (A.map.powers || []).find((x) => x.id === p) || { id: p, team: 'Allies', color: '#888' }; }
  function ownerOf(id) {
    const st = A.sc.setup[id];
    if (A.T[id].type === 'sea') return null;
    if (st && st.owner !== undefined) return st.owner;
    return A.T[id].owner || null;
  }
  function ensurePower(p) {
    if (!p || A.sc.powers[p]) return;
    const info = powerInfo(p);
    const money = A.map.defaultMoney && A.map.defaultMoney[p];
    A.sc.powers[p] = { team: info.team || 'Allies', controller: Object.keys(A.sc.powers).length ? 'ai' : 'human', money: money || 0 };
    const order = mapOrder();
    A.sc.turnOrder = (A.sc.turnOrder || []).concat([p]).sort((a, b) => idxOr(order, a) - idxOr(order, b));
  }
  function idxOr(a, x) { const i = a.indexOf(x); return i < 0 ? 99 : i; }
  /** Turn order: the map's own (TripleA maps carry one), else the rule set's. */
  function mapOrder() { return (A.map && A.map.turnOrder && A.map.turnOrder.length) ? A.map.turnOrder : R().turnOrder; }
  function setupOf(id) { return (A.sc.setup[id] = A.sc.setup[id] || { units: {} }); }
  function setOwner(id, p) {
    if (A.T[id].type === 'sea') return;
    const st = setupOf(id);
    st.owner = p;
    if (p) ensurePower(p);
    // factories follow the owner
    for (const q of Object.keys(st.units || {})) {
      if (q !== p && st.units[q].factory) {
        const n = st.units[q].factory; delete st.units[q].factory;
        if (p) { st.units[p] = st.units[p] || {}; st.units[p].factory = n; }
      }
    }
  }
  function addUnit(id, p, t, n) {
    const st = setupOf(id);
    st.units = st.units || {};
    st.units[p] = st.units[p] || {};
    st.units[p][t] = Math.max(0, (st.units[p][t] || 0) + n);
    if (!st.units[p][t]) delete st.units[p][t];
    if (!Object.keys(st.units[p]).length) delete st.units[p];
    if (n > 0) ensurePower(p);
  }
  function setPlayable(id, on) {
    const set = new Set(A.sc.playable);
    if (on) {
      set.add(id);
      const o = ownerOf(id);
      if (o) ensurePower(o);
      if (A.map.defaultSetup && A.map.defaultSetup[id] && !A.sc.setup[id]) {
        A.sc.setup[id] = E.clone(A.map.defaultSetup[id]);
        for (const p of Object.keys(A.sc.setup[id].units || {})) ensurePower(p);
      }
      if (A.T[id].factory && A.T[id].type === 'land' && o) {
        const st = setupOf(id);
        st.units = st.units || {};
        const has = Object.values(st.units).some((u) => u.factory);
        if (!has && !(A.sc.setup[id].noFactory)) { st.units[o] = st.units[o] || {}; st.units[o].factory = 1; }
      }
    } else {
      set.delete(id);
      // an objective must be playable, and units cannot leave a territory that is gone
      const dropped = [];
      A.sc.objectives.forEach((o, i) => { const j = o.territories.indexOf(id); if (j >= 0) { o.territories.splice(j, 1); dropped.push(i + 1); } });
      if (dropped.length) toast(`${A.T[id].name} left objective ${dropped.map((n) => '#' + n).join(', ')}`);
      if (A.msel && A.msel.from === id) A.msel = null;
    }
    A.sc.playable = [...set];
  }
  /** Removes one unit shown by a chip; a transport takes the cargo that no longer fits with it. */
  function removeOne(id, chip) {
    edit(() => {
      addUnit(id, chip.o, chip.t, -1);
      if (chip.t !== 'transport') return;
      const us = ((A.sc.setup[id] || {}).units || {})[chip.o] || {};
      const cost = (k) => (R().units[k].transportCost || 3);
      const cap = (us.transport || 0) * ((R().units.transport || {}).capacity || 5);
      const land = Rules.UNIT_ORDER.filter((k) => us[k] && R().units[k] && R().units[k].domain === 'land').reverse();
      let need = land.reduce((a, k) => a + us[k] * cost(k), 0);
      for (const k of land) {
        while (need > cap && us[k]) { addUnit(id, chip.o, k, -1); need -= cost(k); }
      }
    });
  }
  function objectiveIdsOf(id) {
    return A.sc.objectives.map((o, i) => (o.territories.includes(id) ? i : -1)).filter((i) => i >= 0);
  }

  // undo / redo / draft
  function commit() {
    A.hist.push(JSON.stringify(A.sc));
    if (A.hist.length > 150) A.hist.shift();
    A.fut = [];
  }
  function undo() { step(A.hist, A.fut); }
  function redo() { step(A.fut, A.hist); }
  function step(from, to) {
    if (!from.length) return;
    A.msel = null;
    const next = JSON.parse(from.pop());
    to.push(JSON.stringify(A.sc));
    if (next.map === A.sc.map) { A.sc = next; renderAll(); return; }
    useMap(next.map, next).catch((e) => { from.push(JSON.stringify(next)); to.pop(); toast(e.message, 6000); });
  }
  function draft() { store.set('tacticle:authorDraft', { sc: A.sc, savedJSON: A.savedJSON }); }
  function dirty() { return JSON.stringify(pruned(A.sc)) !== A.savedJSON; }
  /** Unsaved changes worth asking about before they are replaced (an empty new puzzle is not). */
  function unsavedWork() { return dirty() && A.sc.playable.length > 0; }
  function edit(fn) { commit(); fn(); renderAll(); }

  // ------------------------------------------------------------------ map interaction
  // ---- Move tool: the same selection rules as the player page
  /** Units shown as icons in a territory, keyed "owner|type" (land units at sea ride along with transports). */
  function iconUnits(id) {
    const us = (A.sc.setup[id] && A.sc.setup[id].units) || {};
    const out = {};
    for (const p of Object.keys(us)) for (const k of Object.keys(us[p])) {
      const d = R().units[k];
      if (A.T[id].type === 'sea' && d && d.domain === 'land') continue;
      if (us[p][k] > 0) out[p + '|' + k] = us[p][k];
    }
    return out;
  }
  function mselTotal() { return A.msel ? Object.values(A.msel.n).reduce((a, b) => a + b, 0) : 0; }
  function moveChip(id, chip) {
    const key = chip.o + '|' + chip.t;
    const have = iconUnits(id)[key] || 0;
    if (!have) return;
    if (!A.msel || A.msel.from !== id) A.msel = { from: id, n: {} };
    const cur = A.msel.n[key] || 0;
    A.msel.n[key] = cur ? cur - 1 : have; // first click: all of them; then one fewer per click
    if (!mselTotal()) A.msel = null;
    A.selected = id;
    renderAll();
  }
  function moveTerritory(id) {
    if (A.msel && A.msel.from !== id && mselTotal()) return moveSelected(id);
    const all = iconUnits(id);
    const everything = A.msel && A.msel.from === id && Object.keys(all).every((k) => (A.msel.n[k] || 0) === all[k]);
    A.msel = everything || !Object.keys(all).length ? null : { from: id, n: Object.assign({}, all) };
    A.selected = id;
    renderAll();
  }
  function moveSelected(to) {
    const from = A.msel.from;
    const toSea = A.T[to].type === 'sea';
    for (const key of Object.keys(A.msel.n)) {
      if (!A.msel.n[key]) continue;
      const d = R().units[key.split('|')[1]];
      if (!d) continue;
      if (d.domain === 'land' && toSea) { toast('Land units go to sea aboard transports: move the transport'); return; }
      if (d.domain === 'sea' && !toSea) { toast('Ships stay in sea zones'); return; }
    }
    edit(() => {
      if (!A.sc.playable.includes(to)) setPlayable(to, true);
      for (const key of Object.keys(A.msel.n)) {
        const c = A.msel.n[key];
        if (!c) continue;
        const [p, t] = key.split('|');
        addUnit(from, p, t, -c);
        addUnit(to, p, t, c);
        // a power's cargo sails with its last transports
        if (t === 'transport' && A.T[from].type === 'sea' && !(((A.sc.setup[from] || {}).units || {})[p] || {}).transport) {
          const left = ((A.sc.setup[from] || {}).units || {})[p] || {};
          for (const k of Object.keys(left)) {
            if (R().units[k] && R().units[k].domain === 'land') { addUnit(to, p, k, left[k]); addUnit(from, p, k, -left[k]); }
          }
        }
      }
      A.msel = null;
      A.selected = to;
    });
  }

  function onClick(id, ev, chip) {
    if (!id) { A.selected = null; A.msel = null; renderAll(); return; }
    const t = A.T[id];
    switch (A.tool) {
      case 'select': A.selected = id; renderAll(); return;
      case 'move':
        if (chip) moveChip(id, chip); else moveTerritory(id);
        return;
      case 'playable':
        if (chip && A.sc.playable.includes(id)) { removeOne(id, chip); return; }
        edit(() => {
          const on = !A.sc.playable.includes(id);
          if (ev && ev.shiftKey) {
            setPlayable(id, true);
            for (const n of t.adj) setPlayable(n, true);
          } else setPlayable(id, on);
        });
        return;
      case 'owner':
        if (t.type === 'sea') { toast('Sea zones have no owner'); return; }
        edit(() => { if (!A.sc.playable.includes(id)) setPlayable(id, true); setOwner(id, ev && ev.altKey ? (t.owner || null) : A.brush.owner); });
        return;
      case 'units': {
        const d = R().units[A.brush.unit];
        if (!d) return;
        // a unit goes to whoever controls the territory; at sea, to the power chosen for sea units
        const p = placeFor(id);
        if (!p) { toast(`${t.name} is neutral: give it an owner in Select Owners first`); return; }
        if (t.type === 'sea' && d.domain === 'land' && !(((A.sc.setup[id] || {}).units || {})[p] || {}).transport) {
          toast(`Land units at sea ride on transports: add a transport for ${p} first`);
          return;
        }
        if (t.type === 'land' && d.domain === 'sea') { toast('Ships go in sea zones'); return; }
        if (t.type === 'sea' && (A.brush.unit === 'factory' || A.brush.unit === 'aaa')) { toast(`${d.name}s go on land`); return; }
        edit(() => {
          if (!A.sc.playable.includes(id)) setPlayable(id, true);
          if (ev && (ev.ctrlKey || ev.metaKey)) addUnit(id, p, A.brush.unit, -999);
          else addUnit(id, p, A.brush.unit, ev && ev.shiftKey ? 5 : 1);
        });
        return;
      }
      case 'objective': {
        const o = A.sc.objectives[A.brush.obj];
        if (!o) { toast('Add an objective first'); return; }
        if (o.type === 'bank' || o.type === 'damage') { toast(`Objective #${A.brush.obj + 1} is about IPCs. Click a territory objective on the left to add territories to it.`); return; }
        edit(() => {
          if (!A.sc.playable.includes(id)) setPlayable(id, true);
          const i = o.territories.indexOf(id);
          if (i >= 0) o.territories.splice(i, 1); else o.territories.push(id);
        });
        return;
      }
      default:
    }
  }
  /** Who a placed unit belongs to: the territory's controller, or at sea the power picked for sea units. */
  function placeFor(id) { return A.T[id].type === 'sea' ? A.brush.power : ownerOf(id); }
  function onContext(id) {
    if (A.tool === 'move') { A.msel = null; renderAll(); return; }
    if (!id) return;
    if (A.tool === 'units') { const p = placeFor(id); if (p) edit(() => addUnit(id, p, A.brush.unit, -1)); }
    else if (A.tool === 'owner') edit(() => setOwner(id, null));
    else if (A.tool === 'playable') edit(() => setPlayable(id, false));
    else if (A.tool === 'objective') {
      const o = A.sc.objectives[A.brush.obj];
      if (o && o.territories.includes(id)) edit(() => o.territories.splice(o.territories.indexOf(id), 1));
    } else if (A.tool === 'select') { A.selected = id; renderAll(); }
  }
  function onHover(id, ev) {
    const tip = $('tip');
    if (!id || !A.T[id]) { tip.style.display = 'none'; return; }
    const t = A.T[id];
    const o = ownerOf(id);
    const play = A.sc.playable.includes(id);
    let h = `<b>${esc(t.name)}</b> <span class="hint">${t.type === 'sea' ? 'sea' : (o || 'neutral')}${t.ipc ? ' · ' + t.ipc + ' IPC' : ''}${play ? '' : ' · not playable'}</span>`;
    const us = (A.sc.setup[id] && A.sc.setup[id].units) || {};
    const lines = [];
    for (const p of Object.keys(us)) for (const k of Object.keys(us[p])) lines.push(`<span class="swatch" style="background:${powerInfo(p).color}"></span> ${us[p][k]} ${esc((R().units[k] || {}).name || k)}`);
    if (lines.length) h += '<div>' + lines.join('<br>') + '</div>';
    tip.innerHTML = h;
    tip.style.display = 'block';
    tip.style.left = Math.min(ev.clientX + 14, innerWidth - 270) + 'px';
    tip.style.top = (ev.clientY + 14) + 'px';
  }

  // ------------------------------------------------------------------ rendering
  function renderAll() {
    // the preview's SVG would otherwise sit hidden in the page, and the editing map shares its pattern ids
    if (A.page !== 'select' && A.pv) { A.pv.destroy(); A.pv = null; A.pvId = null; $('pvInfo').innerHTML = ''; }
    document.body.dataset.page = A.page;
    document.body.dataset.sub = A.page === 'edit' ? A.sub : '';
    document.body.dataset.tool = A.page === 'edit' ? A.tool : '';
    renderHeader();
    renderTab();
    renderToolbar();
    renderInspector();
    renderMap();
    renderDock();
    draft();
  }
  function renderHeader() {
    $('hdrTitle').textContent = (A.sc.id ? A.sc.id + ' · ' : '') + (A.sc.title || 'Untitled');
    $('saveState').textContent = dirty() ? '● unsaved changes' : 'saved';
    $('bUndo').disabled = !A.hist.length;
    $('bRedo').disabled = !A.fut.length;
  }
  function renderMap() {
    if (!A.mv) return;
    const owners = {}, units = {}, hl = {};
    const play = new Set(A.sc.playable);
    for (const t of A.map.territories) {
      owners[t.id] = ownerOf(t.id);
      const us = (A.sc.setup[t.id] && A.sc.setup[t.id].units) || {};
      if (!play.has(t.id)) continue;
      const list = [];
      const cargo = {};
      for (const p of Object.keys(us)) {
        for (const k of Object.keys(us[p])) {
          if (t.type === 'sea' && R().units[k] && R().units[k].domain === 'land') { cargo[p] = (cargo[p] || 0) + us[p][k]; continue; }
          const sel = A.msel && A.msel.from === t.id ? A.msel.n[p + '|' + k] || 0 : 0;
          list.push({ o: p, t: k, n: us[p][k], dim: !R().units[k], sel: sel || undefined });
        }
      }
      for (const c of list) if (c.t === 'transport' && cargo[c.o]) { c.cargo = cargo[c.o]; cargo[c.o] = 0; }
      units[t.id] = list;
    }
    const objectives = {};
    A.sc.objectives.forEach((o) => o.territories.forEach((id) => { if (!objectives[id] || o.side !== 'opponent') objectives[id] = o.side === 'opponent' ? 'enemy' : o.type; }));
    if (A.tool === 'objective' && A.sc.objectives[A.brush.obj]) for (const id of A.sc.objectives[A.brush.obj].territories) hl[id] = 'attack';
    A.mv.update({ owners, units, highlight: hl, selected: A.selected, objectives, playable: play, dimInactive: false, labels: 'playable' });
  }
  /** A one-line hint over the map for what a click does now (the controls themselves are on the left). */
  function renderToolbar() {
    const mapPowers = (A.map.powers || []).map((p) => p.id);
    const first = A.sc.turnOrder.find((p) => A.sc.powers[p].controller === 'human') || A.sc.turnOrder[0] || mapPowers[0];
    if (!mapPowers.includes(A.brush.power)) A.brush.power = first;
    if (A.brush.owner === undefined || (A.brush.owner !== null && !mapPowers.includes(A.brush.owner))) A.brush.owner = first;
    const o = A.sc.objectives[A.brush.obj];
    const hint = A.page !== 'edit' ? '' : {
      select: A.sub === 'units' ? 'Click a territory to change its units on the right.' : 'Click a territory to see it.',
      move: A.msel ? `${mselTotal()} selected. Click where they go (right-click or Esc cancels). Icon clicks: one fewer, or add another type.` : 'Click a unit icon to pick those units (again: one fewer; another icon: add it), or the territory for everything. Then click where they go.',
      playable: 'Click toggles a territory in or out of play. Shift-click adds it and its neighbours. Right-click removes. A unit icon click removes one unit.',
      owner: A.brush.owner ? `Click gives a territory to ${A.brush.owner}. Right-click makes it neutral; Alt-click restores the map's owner.` : 'Click makes a territory neutral (impassable). Alt-click restores the map\'s owner.',
      units: `Click adds one ${((R().units[A.brush.unit] || {}).name || 'unit').toLowerCase()} for the territory's owner. Shift +5, right-click −1, Ctrl-click clears. Esc stops placing.`,
      objective: o && (o.type === 'bank' || o.type === 'damage') ? 'This objective is about IPCs: set its numbers on the left.' : `Click toggles a territory in objective #${A.brush.obj + 1}. Right-click removes.`,
    }[A.tool];
    $('toolbar').innerHTML = hint ? `<div class="tgroup" style="padding:4px 8px;font-size:12.5px;color:var(--muted)">${esc(hint)}</div>` : '';
  }

  // ------------------------------------------------------------------ inspector
  function renderInspector() {
    const el = $('inspector');
    const id = A.selected;
    if (!id || !A.T[id]) { el.innerHTML = summaryHtml(); bindChecks(el); return; }
    const t = A.T[id];
    const play = A.sc.playable.includes(id);
    const o = ownerOf(id);
    const us = (A.sc.setup[id] && A.sc.setup[id].units) || {};
    const h = [];
    h.push(`<div class="h">${t.type === 'sea' ? 'Sea zone' : 'Territory'}</div><h3 style="margin:0">${esc(t.name)}</h3><div class="hint">${esc(id)}${t.ipc ? ' · ' + t.ipc + ' IPC' : ''}${t.capital ? ' · capital of ' + esc(t.capital) : ''} · map owner ${esc(t.owner || '—')}</div>`);
    h.push(`<label class="chk"><input type="checkbox" id="iPlay" ${play ? 'checked' : ''}> In play</label>`);
    if (t.type === 'land') {
      h.push(`<label class="f">Owner</label><select id="iOwner"><option value="">Neutral (impassable)</option>${A.map.powers.map((p) => `<option ${o === p.id ? 'selected' : ''}>${esc(p.id)}</option>`).join('')}</select>`);
    }
    if (A.sc.objectives.length) {
      h.push('<label class="f">Objectives</label>' + A.sc.objectives.map((ob, i) => `<label class="chk"><input type="checkbox" data-iobj="${i}" ${ob.territories.includes(id) ? 'checked' : ''}> #${i + 1} ${ob.type}</label>`).join(''));
    }
    h.push('<div class="h">Units</div>');
    const powersHere = Object.keys(us);
    if (o && !powersHere.includes(o)) powersHere.unshift(o);
    if (!powersHere.length && A.brush.power) powersHere.push(A.brush.power);
    for (const p of powersHere) {
      h.push(`<div class="row" style="margin:6px 0 4px"><span class="swatch" style="background:${powerInfo(p).color}"></span><b style="font-size:13px">${esc(p)}</b></div><div class="list">`);
      for (const ty of Rules.UNIT_ORDER) {
        const d = R().units[ty];
        if (!d) continue;
        if (t.type === 'land' && d.domain === 'sea') continue;
        if (t.type === 'sea' && (ty === 'factory' || ty === 'aaa')) continue;
        const n = (us[p] && us[p][ty]) || 0;
        h.push(`<div class="urow ${n ? '' : 'zero'}" style="padding:2px 6px"><span class="ic" style="background:${powerInfo(p).color};width:24px;height:24px">${I.svg(ty, 18, '#fff')}</span><span class="nm" style="font-size:13px">${esc(d.name)}</span><span class="stepper"><button data-iu="${esc(p)}|${ty}|-1" aria-label="One fewer ${esc(d.name)}" ${n ? '' : 'disabled'}>−</button><output>${n}</output><button data-iu="${esc(p)}|${ty}|1" aria-label="One more ${esc(d.name)}">+</button></span></div>`);
      }
      h.push('</div>');
    }
    const teamOf = (p) => (A.sc.powers[p] && A.sc.powers[p].team) || powerInfo(p).team;
    const ref = o || powersHere[0];
    const others = A.map.powers.filter((p) => !powersHere.includes(p.id));
    const friends = others.filter((p) => ref && teamOf(p.id) === teamOf(ref));
    const rest = others.filter((p) => !friends.includes(p));
    const opts = (list) => list.map((p) => `<option>${esc(p.id)}</option>`).join('');
    h.push(`<label class="f">Add troops of another country</label><select id="iAddPower"><option value="">—</option>${friends.length ? `<optgroup label="Friendly">${opts(friends)}</optgroup>` : ''}${rest.length ? `<optgroup label="${ref ? 'Enemy' : 'Other'}">${opts(rest)}</optgroup>` : ''}</select>`);
    h.push('<p class="hint" style="margin-top:10px"><kbd>Esc</kbd> closes this panel.</p>');
    el.innerHTML = h.join('');
    $('iPlay').onchange = (e) => edit(() => setPlayable(id, e.target.checked));
    const io = $('iOwner'); if (io) io.onchange = () => edit(() => setOwner(id, io.value || null));
    el.querySelectorAll('[data-iobj]').forEach((c) => c.onchange = () => edit(() => {
      const ob = A.sc.objectives[+c.dataset.iobj];
      if (c.checked) { if (!ob.territories.includes(id)) ob.territories.push(id); if (!A.sc.playable.includes(id)) setPlayable(id, true); } else ob.territories = ob.territories.filter((x) => x !== id);
    }));
    el.querySelectorAll('[data-iu]').forEach((b) => b.onclick = () => {
      const [p, ty, d] = b.dataset.iu.split('|');
      edit(() => { if (!A.sc.playable.includes(id)) setPlayable(id, true); addUnit(id, p, ty, +d); });
    });
    $('iAddPower').onchange = (e) => {
      const p = e.target.value;
      if (p) edit(() => { if (!A.sc.playable.includes(id)) setPlayable(id, true); ensurePower(p); const st = setupOf(id); st.units = st.units || {}; st.units[p] = st.units[p] || {}; });
    };
  }
  function armyValue() {
    const out = {};
    for (const id of A.sc.playable) {
      const us = (A.sc.setup[id] && A.sc.setup[id].units) || {};
      for (const p of Object.keys(us)) for (const k of Object.keys(us[p])) {
        if (k === 'factory' || !R().units[k]) continue;
        out[p] = (out[p] || 0) + us[p][k] * R().units[k].cost;
      }
    }
    return out;
  }
  function summaryHtml() {
    const play = A.sc.playable;
    const land = play.filter((id) => A.T[id] && A.T[id].type === 'land').length;
    const val = armyValue();
    const msgs = validate();
    return `<div class="h">Scenario summary</div>
      <p class="hint">${land} land territories and ${play.length - land} sea zones in play. ${A.sc.maxTurns} turns. Rules: ${esc(R().name)}.</p>
      <div class="list">${Object.keys(A.sc.powers).map((p) => `<div class="urow"><span class="swatch" style="background:${powerInfo(p).color}"></span><span class="nm">${esc(p)}<small>${A.sc.powers[p].controller === 'human' ? 'Player' : 'Computer'} · ${A.sc.powers[p].team} · ${A.sc.powers[p].money} IPC${A.sc.income !== false ? `, +${perTurn(p)} a turn` : ''}</small></span><b title="Army value in IPCs">${val[p] || 0}</b></div>`).join('')}</div>
      <div class="h">Checks</div>${checksHtml(msgs)}
      ${A.lastSim ? `<div class="h">Last balance check</div><p class="hint">Computer-as-player won ${Math.round(100 * A.lastSim.won / A.lastSim.games)}% of ${A.lastSim.games} games.</p>` : ''}
      <div class="h">Shortcuts</div><div class="kbd-help"><kbd>P</kbd> territories <kbd>O</kbd> owners <kbd>U</kbd> place units <kbd>S</kbd> select <kbd>M</kbd> move <kbd>J</kbd> objectives <kbd>T</kbd> test · <kbd>1</kbd>–<kbd>9</kbd> pick a unit · <kbd>Esc</kbd> stop placing · <kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd> undo/redo · <kbd>Ctrl</kbd>+<kbd>S</kbd> save · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> play test</div>`;
  }

  function validate() {
    const msgs = E.Game.validate(A.map, A.sc).slice();
    if (!msgs.some((m) => m.level === 'error')) {
      try { E.Game.create(A.map, A.sc, { seed: 1 }); } catch (e) { msgs.push({ level: 'error', msg: e.message }); }
    }
    // cargo must fit
    for (const id of A.sc.playable) {
      if (!A.T[id] || A.T[id].type !== 'sea') continue;
      const us = (A.sc.setup[id] && A.sc.setup[id].units) || {};
      for (const p of Object.keys(us)) {
        let need = 0;
        for (const k of Object.keys(us[p])) { const d = R().units[k]; if (d && d.domain === 'land') need += us[p][k] * (d.transportCost || 3); }
        const cap = (us[p].transport || 0) * ((R().units.transport || {}).capacity || 5);
        if (need > cap) msgs.push({ level: 'warn', msg: `${A.T[id].name}: ${p}'s land units do not all fit on its transports` });
      }
    }
    const factories = A.sc.playable.some((id) => { const us = (A.sc.setup[id] && A.sc.setup[id].units) || {}; return Object.values(us).some((u) => u.factory); });
    if (A.sc.purchase !== false && !factories) msgs.push({ level: 'warn', msg: 'No factories in play, so nobody can place new units' });
    if (!A.sc.title || A.sc.title === 'Untitled puzzle') msgs.push({ level: 'warn', msg: 'Give the puzzle a title' });
    if (!String(A.sc.description || '').trim()) msgs.push({ level: 'warn', msg: 'Write a briefing for players (Write from objectives drafts one)' });
    if (!A.sc.id) msgs.push({ level: 'warn', msg: 'Give the puzzle a file name before saving' });
    return msgs;
  }

  // ------------------------------------------------------------------ pages and steps
  function goPage(p) {
    if (p !== 'schedule') A.schedFocus = null;
    A.page = p;
    if (p === 'select' && !A.preview) A.preview = A.sc.map;
    if (p === 'edit') { goSub(A.sub); return; }
    A.selected = null;
    A.msel = null;
    renderAll();
  }
  /** Open a step of Edit Map (and its map tool; Place Units can be in place, move or select mode). */
  function goSub(s, mode) {
    const sub = SUBS.find((x) => x[0] === s) || SUBS[0];
    A.page = 'edit';
    const tool = sub[0] === 'units' ? (mode || (A.sub === 'units' ? A.tool : 'select')) : sub[2];
    if (A.sub !== sub[0] || A.tool !== tool) { A.selected = null; A.msel = null; }
    // after choosing the territories, frame them for the later steps
    const framed = A.page === 'edit' && A.sub === 'territories' && sub[0] !== 'territories' && A.sc.playable.length;
    A.sub = sub[0];
    A.tool = tool;
    renderAll();
    if (framed && A.mv) A.mv.setFocus(A.sc.playable);
  }
  function renderTab() {
    $('tabs').innerHTML = PAGES.map(([k, n]) => `<button role="tab" aria-selected="${A.page === k}" data-page="${k}" class="${A.page === k ? 'on' : ''}">${n}</button>`).join('');
    $('tabs').querySelectorAll('[data-page]').forEach((b) => b.onclick = () => goPage(b.dataset.page));
    const done = A.page === 'edit' ? stepDone() : {};
    $('subtabs').innerHTML = A.page === 'edit' ? SUBS.map(([k, n, , , key], i) => `<button data-sub="${k}" class="${A.sub === k ? 'on' : ''}${done[k] ? ' done' : ''}" ${A.sub === k ? 'aria-current="step"' : ''} title="${n} (${key})"><span class="num" aria-hidden="true">${done[k] ? '✓' : i + 1}</span>${n}${done[k] ? '<span class="sr">, done</span>' : ''}</button>`).join('') : '';
    $('subtabs').querySelectorAll('[data-sub]').forEach((b) => b.onclick = () => goSub(b.dataset.sub));
    const body = $('tabbody');
    body.innerHTML = '';
    const page = $('page');
    if (A.page === 'select') leftSelect(body);
    else if (A.page === 'edit') ({ territories: subTerritories, owners: subOwners, units: subUnits, objectives: subObjectives, test: subTest })[A.sub](body);
    else body.innerHTML = A.page === 'schedule'
      ? '<p class="hint" style="padding:12px">Choose which saved puzzle players get each day. Changes save as you make them.</p>'
      : '<p class="hint" style="padding:12px">Open, save, download and delete puzzle files.</p>';
    if (A.page === 'schedule' || A.page === 'files') {
      page.innerHTML = '<div class="wide" id="pageIn"></div>';
      (A.page === 'schedule' ? tabSchedule : tabFiles)($('pageIn'));
    } else page.innerHTML = '';
    if (A.page === 'select') renderPreview();
  }
  function pad(el) { el.style.padding = '12px'; return el; }
  /** Which steps of Edit Map have what a puzzle needs, shown as ✓ in the step list. */
  function stepDone() {
    const sc = A.sc;
    const human = Object.keys(sc.powers).filter((p) => sc.powers[p].controller === 'human');
    const complete = (o) => (o.type === 'bank' ? o.ipc > 0 : o.type === 'damage' ? o.inflict > 0 : o.territories.length > 0);
    const val = armyValue();
    return {
      territories: sc.playable.length > 0,
      owners: human.length > 0 && Object.keys(sc.powers).some((p) => sc.powers[p].controller !== 'human') && new Set(human.map((p) => sc.powers[p].team)).size === 1,
      units: Object.keys(val).some((p) => val[p] > 0),
      objectives: sc.objectives.some((o) => o.side !== 'opponent') && sc.objectives.every(complete),
      test: !!sc.balance,
    };
  }

  // ---- Select Map: the maps as thumbnails; the one clicked fills the map area; Select Map opens it
  function leftSelect(el) {
    pad(el);
    el.innerHTML = `<p class="hint" style="margin-top:0">Pick the map the puzzle is played on. Click one to look at it; double-click to start on it.</p>
      <div class="maplist">${A.maps.map((m) => `<button class="mapcard ${m.id === (A.preview || A.sc.map) ? 'on' : ''}" aria-pressed="${m.id === (A.preview || A.sc.map)}" data-map="${esc(m.id)}">
        <div class="thumb" data-thumb="${esc(m.id)}">${A.thumbs[m.id] || '<span class="hint">Loading…</span>'}</div>
        <div class="mname">${esc(m.name)}${m.id === A.sc.map ? ' · current puzzle' : ''}<small>${esc(m.source || (m.local ? 'kept in this browser' : ''))}</small></div></button>`).join('')}</div>
      ${field('Rules', `<select id="smRules">${Rules.list().map((r) => `<option value="${r.id}" ${r.id === A.sc.ruleset ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>`)}
      <div class="actions col"><button id="smImport">Import base map…</button><button id="smOpen">Import existing scenario…</button><button id="smGen">Generate a puzzle…</button></div>`;
    el.querySelectorAll('[data-map]').forEach((b) => {
      b.onclick = () => { if (A.preview === b.dataset.map) return; A.preview = b.dataset.map; renderTab(); renderDock(); };
      b.ondblclick = () => { A.preview = b.dataset.map; selectMap(); };
    });
    $('smRules').onchange = (e) => edit(() => { A.sc.ruleset = e.target.value; });
    $('smImport').onclick = browseTripleA;
    $('smOpen').onclick = openScenarioDialog;
    $('smGen').onclick = generateDialog;
    for (const m of A.maps) if (!A.thumbs[m.id]) loadThumb(m.id);
    const on = el.querySelector('.mapcard.on');
    if (on && !A.scrolledTo) { on.scrollIntoView({ block: 'nearest' }); A.scrolledTo = true; }
  }
  async function loadThumb(id) {
    if (A.thumbLoading[id]) return;
    A.thumbLoading[id] = true;
    try { A.thumbs[id] = thumbImg(await fetchMap(id)); } catch (e) { A.thumbs[id] = '<span class="hint">Could not load</span>'; }
    const box = document.querySelector(`[data-thumb="${CSS.escape(id)}"]`);
    if (box) box.innerHTML = A.thumbs[id];
  }
  /** A small picture of a whole map (sea, then land in its map owner's colour), drawn once and kept as an image. */
  function thumbImg(map) {
    const k = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(300 * k), H = Math.max(40, Math.round((W * map.height) / map.width));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const cx = cv.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const v = (n, d) => (css.getPropertyValue(n) || '').trim() || d;
    const ocean = v('--ocean', '#a9cfe3');
    cx.fillStyle = ocean;
    cx.fillRect(0, 0, W, H);
    cx.scale(W / map.width, H / map.height);
    const colors = {};
    for (const p of map.powers || []) colors[p.id] = p.color;
    cx.fillStyle = v('--sea', '#b5d7e8');
    for (const t of map.territories) if (t.type === 'sea' && t.path) cx.fill(new Path2D(t.path), 'evenodd');
    cx.lineWidth = (map.width / W) * 0.7;
    cx.strokeStyle = 'rgba(0,0,0,.35)';
    for (const t of map.territories) {
      if (t.type === 'sea' || !t.path) continue;
      const p = new Path2D(t.path);
      cx.fillStyle = t.owner ? colors[t.owner] || '#999' : v('--neutral', '#e5dcc6');
      cx.fill(p, 'evenodd');
      cx.stroke(p);
    }
    if (map.decor && map.decor.lakes) { cx.fillStyle = ocean; cx.fill(new Path2D(map.decor.lakes), 'evenodd'); }
    return `<img src="${cv.toDataURL('image/png')}" alt="">`;
  }
  async function renderPreview() {
    const id = A.preview || A.sc.map;
    if (A.pv && A.pvId === id) return;
    let map;
    try { map = await fetchMap(id); } catch (e) { $('pvInfo').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    if ((A.preview || A.sc.map) !== id || A.page !== 'select') return;
    if (A.pv) A.pv.destroy();
    A.pv = new window.TacticleMapView($('preview'), map, { onClick: () => {}, onHover: (tid, ev) => previewHover(map, tid, ev) });
    const owners = {};
    for (const t of map.territories) owners[t.id] = t.owner || null;
    A.pv.update({ owners, units: {}, highlight: {}, objectives: {}, playable: null, labels: 'none', dimInactive: false });
    A.pv.setFocus(null);
    A.pvId = id;
    const land = map.territories.filter((t) => t.type !== 'sea').length;
    const m = A.maps.find((x) => x.id === id) || {};
    $('pvInfo').innerHTML = `<h3>${esc(map.name || m.name || id)}</h3><div class="hint">${land} territories, ${map.territories.length - land} sea zones, ${(map.powers || []).length} powers${map.defaultSetup ? ' · has starting armies' : ''}</div>${map.credit || m.credit ? `<div class="hint">${esc(map.credit || m.credit)}</div>` : ''}`;
  }
  function previewHover(map, id, ev) {
    const tip = $('tip');
    const t = id && map.territories.find((x) => x.id === id);
    if (!t) { tip.style.display = 'none'; return; }
    tip.innerHTML = `<b>${esc(t.name)}</b> <span class="hint">${t.type === 'sea' ? 'sea' : esc(t.owner || 'neutral')}${t.ipc ? ' · ' + t.ipc + ' IPC' : ''}</span>`;
    tip.style.display = 'block';
    tip.style.left = Math.min(ev.clientX + 14, innerWidth - 270) + 'px';
    tip.style.top = (ev.clientY + 14) + 'px';
  }
  /** Use the map shown in Select Map: a new puzzle on it (unless it is the current puzzle's map), then Edit Map. */
  async function selectMap() {
    const id = A.preview || A.sc.map;
    if (id !== A.sc.map) {
      if (!await okToReplace('Start a new puzzle on this map?')) return;
      const before = JSON.stringify(A.sc);
      try { await useMap(id, Object.assign(newScenario(id), { ruleset: A.sc.ruleset })); } catch (e) { toast(e.message, 6000); return; }
      A.hist.push(before); A.fut = [];
      A.savedJSON = null; A.savedAs = null;
    }
    goSub('territories');
    if (A.mv) A.mv.setFocus(A.sc.playable.length ? A.sc.playable : null);
  }
  function openScenarioDialog() {
    dialog(`<h2>Import an existing scenario</h2><p class="hint">Open a saved puzzle to edit it, or a puzzle file from your computer.</p>
      <div class="list plist" style="max-height:50vh;overflow:auto">${A.puzzles.map((p) => `<div class="urow"><span class="nm">${esc(p.title || p.id)}<small>${esc(p.id)} · ${esc(p.map || '')}${p.maxTurns ? ' · ' + p.maxTurns + ' turns' : ''}</small></span><button class="small" data-open="${esc(p.file)}">Open</button></div>`).join('') || '<p class="hint">No saved puzzles yet.</p>'}</div>
      <div class="actions"><label class="small" style="border:1px solid var(--line);border-radius:8px;padding:6px 10px;cursor:pointer">Open a JSON file…<input type="file" id="osFile" accept=".json" hidden></label><button data-close>Cancel</button></div>`);
    $('dialog').querySelectorAll('[data-open]').forEach((b) => b.onclick = async () => {
      if (!await okToReplace('Open this puzzle instead?')) return;
      try {
        if (await loadScenario(await getJSON(b.dataset.open), false)) { closeDialog(); A.preview = A.sc.map; goSub('territories'); }
      } catch (e) { toast(e.message); }
    });
    $('osFile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { if (await loadScenario(JSON.parse(await f.text()), true)) { closeDialog(); A.preview = A.sc.map; goSub('territories'); } } catch (err) { toast('Not a scenario: ' + err.message); }
    };
  }

  // ---- the bottom-right dock: Next, file name, Save / Saved, Schedule It (Edit Map); Select Map (Select Map)
  function renderDock() {
    const el = $('dock');
    if (A.page === 'select') {
      const id = A.preview || A.sc.map;
      const m = A.maps.find((x) => x.id === id);
      el.innerHTML = `<p class="hint" style="margin:0">${id === A.sc.map ? `The map of the puzzle you are editing. Select it to carry on with “${esc(A.sc.title || 'Untitled puzzle')}”.` : `Starts a new puzzle on ${esc((m && m.name) || id)}.`}</p><button class="primary" id="dkSelect">Select Map</button>`;
      $('dkSelect').onclick = selectMap;
      return;
    }
    if (A.page !== 'edit') { el.innerHTML = ''; return; }
    const i = SUBS.findIndex((x) => x[0] === A.sub);
    const saved = !!A.sc.id && !!A.savedJSON && !dirty();
    const warn = A.overwrite && A.overwrite === A.sc.id ? 'A save file with this name exists, click again to overwrite it' : A.dockMsg || '';
    el.innerHTML = `<label class="f" for="dkName" style="margin:0">File name</label><input type="text" id="dkName" value="${esc(A.sc.id)}" placeholder="e.g. kursk-salient" spellcheck="false" autocomplete="off" aria-describedby="dkHint dkWarn" ${A.dockMsg ? 'aria-invalid="true"' : ''}>
      <p class="hint dkhint" id="dkHint">${fileHint(A.sc.id)}</p>
      <p class="dkwarn" id="dkWarn" role="alert">${esc(warn)}</p>
      <div class="row"><button class="primary ${saved ? 'saved' : ''}" id="dkSave" title="Save (Ctrl+S)">${saved ? 'Saved' : 'Save'}</button>${i < SUBS.length - 1 ? `<button id="dkNext" title="${SUBS[i + 1][1]} (${SUBS[i + 1][4]})">Next: ${SUBS[i + 1][3]} →</button>` : ''}</div>
      ${saved && A.justSaved ? '<button id="dkSched">Schedule It</button>' : ''}`;
    $('dkName').oninput = (e) => {
      $('dkHint').innerHTML = fileHint(slug(e.target.value));
      // the warnings were about the name before this change
      if (A.overwrite || A.dockMsg) { A.overwrite = null; A.dockMsg = null; $('dkWarn').textContent = ''; e.target.removeAttribute('aria-invalid'); }
    };
    $('dkName').onkeydown = (e) => { if (e.key === 'Enter') dockSave(); };
    $('dkName').onchange = (e) => {
      const id = slug(e.target.value);
      if (id !== A.sc.id) { A.overwrite = null; edit(() => { A.sc.id = id; }); } else if (e.target.value !== id) renderDock(); // show the name as saved
    };
    $('dkSave').onclick = dockSave;
    const nx = $('dkNext'); if (nx) nx.onclick = () => goSub(SUBS[i + 1][0]);
    const sc = $('dkSched'); if (sc) sc.onclick = () => { A.schedFocus = { file: `puzzles/${A.sc.id}.json`, title: A.sc.title }; goPage('schedule'); };
  }
  function fileHint(id) { return id ? `Saves as <code>puzzles/${esc(id)}.json</code>` : 'Letters, numbers and dashes'; }
  /** Save from the dock: names an existing file only after a second click. */
  async function dockSave() {
    const box = $('dkName');
    const id = slug((box && box.value) || A.sc.id || '');
    if (!id) { A.dockMsg = 'Type a file name to save'; renderDock(); $('dkName').focus(); return; }
    A.dockMsg = null;
    if (id !== A.sc.id) edit(() => { A.sc.id = id; });
    const exists = A.puzzles.some((p) => p.id === id);
    if (exists && A.savedAs !== id && A.overwrite !== id) { A.overwrite = id; renderDock(); return; }
    A.overwrite = null;
    if (await save()) { A.savedAs = id; A.justSaved = true; }
    renderAll();
  }
  /** A labelled field; the label is tied to the first input, select or textarea with an id. */
  function field(label, html) {
    const m = /<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/.exec(html);
    return `<div><label class="f"${m ? ` for="${m[1]}"` : ''}>${label}</label>${html}</div>`;
  }
  function autoDescription() {
    const sc = A.sc;
    const human = Object.keys(sc.powers).filter((p) => sc.powers[p].controller === 'human');
    const team = human.length ? sc.powers[human[0]].team : null;
    const foes = Object.keys(sc.powers).filter((p) => sc.powers[p].team !== team);
    const mine = sc.objectives.filter((o) => o.side !== 'opponent').map((o) => D.objectiveWords(o, namesOf(o), false).replace(/^./, (c) => c.toLowerCase()));
    const theirs = sc.objectives.filter((o) => o.side === 'opponent').map((o) => D.objectiveWords(o, namesOf(o), true));
    const when = sc.winCheck === 'turn' ? `by the end of turn ${sc.checkTurn || sc.maxTurns}` : `within ${sc.maxTurns} turn${sc.maxTurns === 1 ? '' : 's'}`;
    let s = `As ${human.join(' and ') || 'the player'}${foes.length ? ', facing ' + foes.join(' and ') : ''}, ${mine.join(', then ') || '…'} ${when}.`;
    if (theirs.length) s += ` You lose if the enemy ${theirs.join(' and ')}.`;
    // names such as “Karelia S.S.R.” already end a sentence
    return s.replace(/\.\./g, '.').replace(/^./, (c) => c.toUpperCase());
  }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64); }

  // ---- Edit Map, step 1: Select Territories
  function subTerritories(el) {
    pad(el);
    const play = A.sc.playable;
    const land = play.filter((id) => A.T[id] && A.T[id].type === 'land').length;
    el.innerHTML = `<p class="hint" style="margin-top:0">Click territories and sea zones on the map to put them in play, or click again to take them out.${A.map.defaultSetup ? ' Each one comes with the map\'s starting units: click a unit icon to remove one.' : ''}</p>
      <ul class="hint" style="padding-left:18px;margin:6px 0"><li>Shift-click: a territory and all its neighbours</li><li>Right-click: take it out of play</li></ul>
      <div class="actions"><button id="tNb" title="Add every land neighbour of the land in play">+ Neighbours</button><button id="tSea" title="Add sea zones that touch two or more coasts in play">+ Seas</button><button id="tClr" title="Take every territory out of play (Undo brings them back)">Remove all</button></div>
      <p><b>${land}</b> territor${land === 1 ? 'y' : 'ies'} and <b>${play.length - land}</b> sea zone${play.length - land === 1 ? '' : 's'} in play.</p>`;
    $('tNb').onclick = () => edit(() => {
      for (const id of A.sc.playable.slice()) if (A.T[id].type === 'land') for (const n of A.T[id].adj) if (A.T[n] && A.T[n].type === 'land') setPlayable(n, true);
    });
    $('tSea').onclick = () => edit(() => {
      const on = new Set(A.sc.playable);
      for (const t of A.map.territories) if (t.type === 'sea' && t.adj.filter((y) => on.has(y) && A.T[y] && A.T[y].type === 'land').length >= 2) setPlayable(t.id, true);
    });
    $('tClr').onclick = () => {
      if (!A.sc.playable.length) return;
      edit(() => { A.sc.playable = []; A.sc.objectives.forEach((o) => { o.territories = []; }); A.selected = null; A.msel = null; });
      undoable('Removed every territory from play');
    };
  }

  // ---- step 2: Select Owners (who controls each territory, and the powers' settings)
  function subOwners(el) {
    pad(el);
    if (A.brush.owner !== null && !(A.map.powers || []).some((p) => p.id === A.brush.owner)) A.brush.owner = A.sc.turnOrder[0] || ((A.map.powers || [])[0] || {}).id;
    el.innerHTML = `<p class="hint" style="margin-top:0">Pick a power, then click territories to give them to it. Right-click makes a territory neutral; Alt-click gives it back to the map's owner.</p>
      <div class="powlist">${(A.map.powers || []).map((p) => `<button data-own="${esc(p.id)}" class="${A.brush.owner === p.id ? 'on' : ''}" aria-pressed="${A.brush.owner === p.id}"><span class="swatch" style="background:${esc(p.color)}"></span>${esc(p.id)}</button>`).join('')}<button data-own="" class="${A.brush.owner === null ? 'on' : ''}" aria-pressed="${A.brush.owner === null}"><span class="swatch" style="background:var(--neutral)"></span>Neutral</button></div>
      <div class="h">Powers in this puzzle</div><div id="powersPanel"></div>`;
    el.querySelectorAll('[data-own]').forEach((b) => b.onclick = () => { A.brush.owner = b.dataset.own || null; renderTab(); renderToolbar(); });
    powersPanel($('powersPanel'));
  }
  /** The IPC value of the land a power starts with in play (what it collects by default). */
  function landIncomeOf(p) {
    return A.sc.playable.reduce((a, id) => a + (A.T[id] && A.T[id].type === 'land' && ownerOf(id) === p ? A.T[id].ipc || 0 : 0), 0);
  }
  /** What a power collects at the end of each turn, as shown in summaries. */
  function perTurn(p) { const pw = A.sc.powers[p]; return pw.income != null ? pw.income : landIncomeOf(p); }
  /** IPCs per turn: the territories' value (the default), or an amount the author sets. */
  function incomeFields(p, pw, i, capitalOptions) {
    const land = landIncomeOf(p);
    const set = pw.income != null;
    const off = A.sc.income === false;
    const note = off
      ? `<span class="warnink">Income is off for this puzzle, so nobody collects any.</span> <button class="small link" data-incon>Turn income on</button>`
      : !set ? `The IPC value of the territories it holds in play: ${land} now. Captures add to it, losses take from it.`
        : pw.incomeFixed ? `${pw.income} every turn, whatever it captures or loses.`
          : `${pw.income} to start. Captured territories add their value, lost ones take it away.`;
    return `${field('IPCs per turn', `<select id="pw${i}inc" data-pw="${esc(p)}" data-k="incomeMode"><option value="">Territories (${land})</option><option value="set" ${set ? 'selected' : ''}>Set amount</option></select>`)}
      ${set ? field('Amount per turn', `<input type="number" min="0" id="pw${i}amt" data-pw="${esc(p)}" data-k="income" value="${pw.income}">`) : ''}
      ${field('Capital', `<select id="pw${i}cap" data-pw="${esc(p)}" data-k="capital">${capitalOptions}</select>`)}
      ${set ? `<label class="chk" style="grid-column:1/-1;margin:2px 0"><input type="checkbox" data-pw="${esc(p)}" data-k="incomeFixed" ${pw.incomeFixed ? 'checked' : ''}> The same every turn, whatever is captured or lost</label>` : ''}
      <p class="hint" style="grid-column:1/-1;margin:2px 0 0">${note}</p>`;
  }
  function powersPanel(el) {
    const sc = A.sc;
    const playLand = sc.playable.filter((id) => A.T[id] && A.T[id].type === 'land');
    const capOpts = (p, pw) => `<option value="">${A.map.territories.find((t) => t.capital === p) ? 'Map default' : 'None'}</option><option value="__none" ${pw.capital === null ? 'selected' : ''}>No capital</option>${playLand.map((id) => `<option value="${id}" ${pw.capital === id ? 'selected' : ''}>${esc(A.T[id].name)}</option>`).join('')}`;
    const cards = (sc.turnOrder || []).filter((p) => sc.powers[p]).map((p, i) => {
      const pw = sc.powers[p];
      return `<div class="objbox"><div class="row"><span class="swatch" style="background:${powerInfo(p).color}"></span><b>${i + 1}. ${esc(p)}</b><div class="grow"></div>
          <button class="small" data-up="${i}" title="Earlier in turn order" ${i ? '' : 'disabled'}>↑</button><button class="small" data-del="${esc(p)}" title="Remove ${esc(p)} from the puzzle" aria-label="Remove ${esc(p)}">✕</button></div>
        <div class="two">${field('Played by', `<select id="pw${i}ctl" data-pw="${esc(p)}" data-k="controller"><option value="human" ${pw.controller === 'human' ? 'selected' : ''}>Player</option><option value="ai" ${pw.controller !== 'human' ? 'selected' : ''}>Computer</option></select>`)}
          ${field('Team', `<select id="pw${i}team" data-pw="${esc(p)}" data-k="team"><option ${pw.team === 'Axis' ? 'selected' : ''}>Axis</option><option ${pw.team === 'Allies' ? 'selected' : ''}>Allies</option></select>`)}
          ${field('Starting IPCs', `<input type="number" min="0" id="pw${i}money" data-pw="${esc(p)}" data-k="money" value="${pw.money || 0}">`)}
          ${incomeFields(p, pw, i, capOpts(p, pw))}</div></div>`;
    }).join('');
    el.innerHTML = `<p class="hint">In turn order. The player controls every “Player” power (they must share a team). Losing the capital stops income; capturing one takes its treasury.</p>
      ${cards || '<p class="hint">None yet: powers join when they own a territory or units in play.</p>'}
      ${field('Add a power', `<select id="pwAdd"><option value="">—</option>${A.map.powers.filter((p) => !sc.powers[p.id]).map((p) => `<option>${esc(p.id)}</option>`).join('')}</select>`)}
      <div class="actions"><button id="pwDefault">Sort by the map's turn order</button></div>`;
    el.querySelectorAll('[data-pw]').forEach((c) => c.onchange = () => edit(() => {
      const p = c.dataset.pw, k = c.dataset.k;
      if (k === 'money') sc.powers[p].money = Math.max(0, +c.value || 0);
      // a set amount starts from what the territories give now, so choosing it changes nothing until edited
      else if (k === 'incomeMode') { if (c.value === 'set') sc.powers[p].income = landIncomeOf(p); else { delete sc.powers[p].income; delete sc.powers[p].incomeFixed; } }
      else if (k === 'income') sc.powers[p].income = Math.max(0, Math.round(+c.value || 0));
      else if (k === 'incomeFixed') { if (c.checked) sc.powers[p].incomeFixed = true; else delete sc.powers[p].incomeFixed; }
      else if (k === 'capital') { if (c.value === '') delete sc.powers[p].capital; else sc.powers[p].capital = c.value === '__none' ? null : c.value; }
      else sc.powers[p][k] = c.value;
    }));
    el.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => edit(() => {
      const i = +b.dataset.up;
      if (i > 0) { const o = sc.turnOrder; [o[i - 1], o[i]] = [o[i], o[i - 1]]; }
    }));
    el.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
      const p = b.dataset.del;
      edit(() => {
        delete sc.powers[p];
        sc.turnOrder = sc.turnOrder.filter((x) => x !== p);
        for (const id of Object.keys(sc.setup)) { if (sc.setup[id].owner === p) sc.setup[id].owner = null; if (sc.setup[id].units) delete sc.setup[id].units[p]; }
      });
      undoable(`Removed ${p}, its territories and its units`);
    });
    $('pwAdd').onchange = (e) => { if (e.target.value) edit(() => ensurePower(e.target.value)); };
    el.querySelectorAll('[data-incon]').forEach((b) => b.onclick = () => edit(() => { sc.income = true; }));
    $('pwDefault').onclick = () => edit(() => { const o = mapOrder(); sc.turnOrder.sort((a, b) => idxOr(o, a) - idxOr(o, b)); });
  }

  // ---- step 3: Place Units (place mode: a unit is picked; select mode: change a territory on the right)
  function unitTypes() { return Rules.UNIT_ORDER.filter((t) => R().units[t]); }
  function subUnits(el) {
    pad(el);
    const placing = A.tool === 'units';
    const nm = (t) => R().units[t].name;
    const val = armyValue();
    const tip = placing
      ? `Click territories to add one ${esc(nm(A.brush.unit).toLowerCase())} for whoever controls each. Shift-click adds 5, right-click removes one. Click the icon again or press Esc to stop placing.`
      : A.tool === 'move'
        ? 'Click a unit icon on the map to pick those units (again: one fewer), or a territory for all of them, then click where they go.'
        : 'Pick a unit to place it with clicks on the map. Or click a territory to change its units on the right, including adding friendly troops of another country.';
    el.innerHTML = `<p class="hint" style="margin-top:0">${tip}</p>
      <div class="unitpal">${unitTypes().map((t, i) => `<button data-unit="${t}" class="${placing && A.brush.unit === t ? 'on' : ''}" aria-pressed="${placing && A.brush.unit === t}" title="${esc(nm(t))}${i < 9 ? ' (' + (i + 1) + ')' : ''}">${I.svg(t, 30)}<span>${esc(nm(t))}</span></button>`).join('')}</div>
      ${field('Units placed at sea belong to', `<select id="uSea">${(A.map.powers || []).map((p) => `<option value="${esc(p.id)}" ${A.brush.power === p.id ? 'selected' : ''}>${esc(p.id)}</option>`).join('')}</select>`)}
      <div class="actions"><button id="uAuto" title="Give every territory in play that has no troops the map's starting units">Auto Populate</button><button id="uMove" class="${A.tool === 'move' ? 'on toggle' : ''}" aria-pressed="${A.tool === 'move'}">${A.tool === 'move' ? 'Stop moving' : 'Move units'}</button></div>
      <div class="h">Army value (IPCs)</div>
      <div class="list">${Object.keys(A.sc.powers).map((p) => `<div class="urow"><span class="swatch" style="background:${powerInfo(p).color}"></span><span class="nm">${esc(p)}<small>${A.sc.powers[p].controller === 'human' ? 'Player' : 'Computer'} · ${esc(A.sc.powers[p].team)}</small></span><b>${val[p] || 0}</b></div>`).join('') || '<p class="hint">No units yet.</p>'}</div>`;
    el.querySelectorAll('[data-unit]').forEach((b) => b.onclick = () => pickUnit(b.dataset.unit));
    $('uSea').onchange = (e) => { A.brush.power = e.target.value; renderToolbar(); };
    $('uAuto').onclick = autoPopulate;
    $('uMove').onclick = () => goSub('units', A.tool === 'move' ? 'select' : 'move');
  }
  /** Clicking the unit already picked leaves place mode for select mode. */
  function pickUnit(t) {
    if (A.tool === 'units' && A.brush.unit === t) { goSub('units', 'select'); return; }
    A.brush.unit = t;
    goSub('units', 'units');
  }
  function hasTroops(id) {
    const us = (A.sc.setup[id] && A.sc.setup[id].units) || {};
    return Object.keys(us).some((p) => Object.keys(us[p]).some((k) => us[p][k] > 0 && R().units[k] && !R().units[k].infrastructure && k !== 'factory'));
  }
  /** The map's starting units, in every territory in play that has no troops. A territory given a new owner gets its map owner's units. */
  function autoPopulate() {
    const ds = A.map.defaultSetup;
    if (!ds) { toast('This map has no starting armies to copy'); return; }
    const team = (p) => (A.sc.powers[p] && A.sc.powers[p].team) || powerInfo(p).team;
    const todo = A.sc.playable.filter((id) => ds[id] && ds[id].units && !hasTroops(id));
    if (!todo.length) { toast('Every territory in play that the map gives troops already has some'); return; }
    edit(() => {
      for (const id of todo) {
        const t = A.T[id];
        const owner = ownerOf(id);
        if (t.type === 'land' && !owner) continue;
        const st = setupOf(id);
        st.units = st.units || {};
        const hasFactory = Object.values(st.units).some((u) => u.factory);
        for (const p of Object.keys(ds[id].units)) {
          let to = p;
          if (t.type === 'land' && p === t.owner && owner !== p) to = owner;
          else if (t.type === 'land' && team(p) !== team(owner)) continue;
          for (const k of Object.keys(ds[id].units[p])) {
            if (!R().units[k] || (k === 'factory' && (hasFactory || to !== owner))) continue;
            addUnit(id, to, k, ds[id].units[p][k]);
          }
        }
      }
    });
    toast(`Added the map's starting units to ${todo.length} territor${todo.length === 1 ? 'y' : 'ies'}`);
  }

  // ---- step 4: Set Objectives (yours and the opponent's, the turn limit, when they are checked)
  const OBJ_TYPES = [
    ['capture', 'Capture', 'Control these territories when objectives are checked.'],
    ['hold', 'Hold', 'Never lose these, through the last turn.'],
    ['destroy', 'Clear', 'No enemy units left in these.'],
    ['bank', 'IPC in the bank', 'Have this much unspent money when objectives are checked.'],
    ['damage', 'Inflict damage', 'Destroy this much enemy unit value (IPC cost), while losing no more than the limit.'],
  ];
  const isIpcObj = (o) => o.type === 'bank' || o.type === 'damage';
  function namesOf(o) {
    const names = (o.territories || []).map((id) => (A.T[id] ? A.T[id].name : id));
    return names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0] || '…';
  }
  function subObjectives(el) {
    pad(el);
    const sc = A.sc;
    if (!sc.objectives[A.brush.obj]) A.brush.obj = 0;
    const box = (o, i) => {
      const opp = o.side === 'opponent';
      const types = OBJ_TYPES.filter(([k]) => !(opp && k === 'hold'));
      const info = (OBJ_TYPES.find(([k]) => k === o.type) || OBJ_TYPES[0])[2];
      const body = o.type === 'bank'
        ? `<div class="two">${field('IPC in the bank', `<input type="number" min="1" data-onum="${i}|ipc" value="${o.ipc != null ? o.ipc : ''}">`)}</div>`
        : o.type === 'damage'
          ? `<div class="two">${field('IPC of damage', `<input type="number" min="1" data-onum="${i}|inflict" value="${o.inflict != null ? o.inflict : ''}">`)}${field('Most IPC lost', `<input type="number" min="0" data-onum="${i}|maxLoss" value="${o.maxLoss != null ? o.maxLoss : ''}" placeholder="no limit">`)}</div>`
          : `<div class="chips">${o.territories.map((id) => `<span class="chipx">${esc(A.T[id] ? A.T[id].name : id)}<button data-orm="${i}|${esc(id)}" title="Remove">✕</button></span>`).join('') || `<span class="hint">${A.brush.obj === i ? 'Click territories on the map' : 'Click here, then territories on the map'}</span>`}</div>`;
      return `<div class="objbox ${A.brush.obj === i ? 'on' : ''}" data-opick="${i}" style="cursor:pointer">
        <div class="row"><b>#${i + 1}</b><select data-oside="${i}" style="width:auto"><option value="player">You</option><option value="opponent" ${opp ? 'selected' : ''}>Opponent</option></select>
        <select data-otype="${i}" style="width:auto">${types.map(([k, n]) => `<option value="${k}" ${o.type === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <div class="grow"></div><button class="small" data-odel="${i}" title="Delete objective #${i + 1}" aria-label="Delete objective #${i + 1}">✕</button></div>
        <div class="hint" style="margin:2px 0 4px">${esc(info)}</div>${body}
        <div class="hint"><i>${esc(opp ? 'The opponent wins if it ' + D.objectiveWords(o, namesOf(o), true) : D.objectiveWords(o, namesOf(o), false))}</i></div></div>`;
    };
    const mine = sc.objectives.map((o, i) => [o, i]).filter(([o]) => o.side !== 'opponent');
    const theirs = sc.objectives.map((o, i) => [o, i]).filter(([o]) => o.side === 'opponent');
    const total = mine.filter(([o]) => o.type !== 'hold').reduce((a, [o]) => a + (isIpcObj(o) ? 1 : o.territories.length), 0);
    const need = sc.objectivesNeeded > 0 && sc.objectivesNeeded < total ? sc.objectivesNeeded : 0;
    const when = sc.winCheck === 'turn' ? 'turn' : sc.winCheck === 'roundEnd' ? 'roundEnd' : 'turnEnd';
    el.innerHTML = `<p class="hint" style="margin-top:0">Click an objective, then click territories on the map to add or remove them.</p>
      <div class="h" style="margin-top:4px">You win by</div>${mine.map(([o, i]) => box(o, i)).join('') || '<p class="hint">No objectives for the player yet.</p>'}
      ${total >= 2 ? field('Needed to win', `<select id="oNeed"><option value="0">All ${total}</option>${Array.from({ length: total - 1 }, (_, k) => k + 1).map((n) => `<option value="${n}" ${need === n ? 'selected' : ''}>Any ${n} of ${total}</option>`).join('')}</select>`) : ''}
      <div class="h">The opponent wins by</div>${theirs.map(([o, i]) => box(o, i)).join('') || '<p class="hint">Nothing but stopping you (optional).</p>'}
      <div class="actions"><button id="oAddMine">+ Your objective</button><button id="oAddOpp">+ Opponent objective</button></div>
      <div class="h">Turns</div>
      <div class="two">${field('Turns in the game', `<input type="number" min="1" max="20" id="sTurns" value="${sc.maxTurns}">`)}${when === 'turn' ? field('Checked at the end of turn', `<input type="number" min="1" max="${sc.maxTurns}" id="sCheckTurn" value="${sc.checkTurn || sc.maxTurns}">`) : ''}</div>
      ${field('When objectives are checked', `<select id="sWin"><option value="turnEnd" ${when === 'turnEnd' ? 'selected' : ''}>At the end of each of your turns</option><option value="turn" ${when === 'turn' ? 'selected' : ''}>At the end of one turn</option><option value="roundEnd" ${when === 'roundEnd' ? 'selected' : ''}>After all opponents can counter-attack</option></select>`)}
      <p class="hint">${when === 'turn' ? `Checked once, at the end of your turn ${sc.checkTurn || sc.maxTurns}. The game ends there.` : when === 'roundEnd' ? 'Checked at the end of each round, after every opponent has had a turn to strike back.' : 'You win as soon as they are met at the end of one of your turns.'} A Hold objective runs the game to its last turn. The opponent wins when all its objectives are met at the end of one of its turns.</p>
      ${fold('rules', 'Game rules', `${field('Rules', `<select id="sRules">${Rules.list().map((r) => `<option value="${r.id}" ${r.id === sc.ruleset ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>`)}
        <label class="chk"><input type="checkbox" id="sIncome" ${sc.income !== false ? 'checked' : ''}> Collect income at the end of each turn</label>
        <label class="chk"><input type="checkbox" id="sBuy" ${sc.purchase !== false ? 'checked' : ''}> Allow buying units</label>`, `${R().name}, ${sc.income !== false ? 'income' : 'no income'}, ${sc.purchase !== false ? 'buying' : 'no buying'}`)}
      <div class="h">Puzzle details</div>
      ${field('Title', `<input type="text" id="sTitle" value="${esc(sc.title)}">`)}
      ${field('Briefing', `<textarea id="sDesc">${esc(sc.description)}</textarea><button class="small" id="sAutoDesc" style="margin-top:4px">Write from objectives</button>`)}
      <div class="two">${field('Author', `<input type="text" id="sAuthor" value="${esc(sc.author)}">`)}${field('Difficulty', `<select id="sDiff">${['easy', 'medium', 'hard'].map((d) => `<option ${sc.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select>`)}</div>`;
    el.querySelectorAll('[data-opick]').forEach((b) => b.onclick = (e) => {
      if (e.target.closest('button, select, input')) return;
      if (A.brush.obj === +b.dataset.opick) return;
      A.brush.obj = +b.dataset.opick;
      renderAll();
    });
    el.querySelectorAll('[data-oside]').forEach((s) => s.onchange = () => edit(() => {
      const o = sc.objectives[+s.dataset.oside];
      if (s.value === 'opponent') { o.side = 'opponent'; if (o.type === 'hold') o.type = 'capture'; } else delete o.side;
      A.brush.obj = +s.dataset.oside;
    }));
    el.querySelectorAll('[data-otype]').forEach((s) => s.onchange = () => edit(() => {
      const i = +s.dataset.otype, o = sc.objectives[i];
      o.type = s.value;
      for (const k of ['ipc', 'inflict', 'maxLoss']) delete o[k];
      if (o.type === 'bank') { o.ipc = 20; o.territories = []; }
      if (o.type === 'damage') { o.inflict = 15; o.maxLoss = 10; o.territories = []; }
      A.brush.obj = i;
    }));
    el.querySelectorAll('[data-onum]').forEach((c) => c.onchange = () => edit(() => {
      const [i, k] = c.dataset.onum.split('|');
      const o = sc.objectives[+i];
      if (k === 'maxLoss' && c.value === '') delete o.maxLoss;
      else o[k] = Math.max(k === 'maxLoss' ? 0 : 1, Math.round(+c.value || 0));
    }));
    el.querySelectorAll('[data-odel]').forEach((b) => b.onclick = () => { const n = +b.dataset.odel + 1; edit(() => { sc.objectives.splice(n - 1, 1); A.brush.obj = 0; }); undoable(`Deleted objective #${n}`); });
    el.querySelectorAll('[data-orm]').forEach((b) => b.onclick = () => edit(() => { const [i, id] = b.dataset.orm.split('|'); sc.objectives[+i].territories = sc.objectives[+i].territories.filter((x) => x !== id); }));
    const on = (id, fn, ev) => { const e = $(id); if (e) e.addEventListener(ev || 'change', () => fn(e)); };
    on('oNeed', (e) => edit(() => { if (+e.value > 0) sc.objectivesNeeded = +e.value; else delete sc.objectivesNeeded; }));
    on('oAddMine', () => edit(() => { sc.objectives.push({ type: 'capture', territories: [] }); A.brush.obj = sc.objectives.length - 1; }), 'click');
    on('oAddOpp', () => edit(() => { sc.objectives.push({ type: 'capture', side: 'opponent', territories: [] }); A.brush.obj = sc.objectives.length - 1; }), 'click');
    on('sTurns', (e) => edit(() => { sc.maxTurns = Math.max(1, Math.min(20, +e.value || 1)); if (sc.checkTurn > sc.maxTurns) sc.checkTurn = sc.maxTurns; }));
    on('sCheckTurn', (e) => edit(() => { sc.checkTurn = Math.max(1, Math.min(sc.maxTurns, +e.value || sc.maxTurns)); }));
    on('sWin', (e) => edit(() => { sc.winCheck = e.value; if (e.value === 'turn') sc.checkTurn = Math.min(sc.maxTurns, sc.checkTurn || sc.maxTurns); else delete sc.checkTurn; }));
    on('sRules', (e) => edit(() => { sc.ruleset = e.value; }));
    on('sIncome', (e) => edit(() => { sc.income = e.checked; }));
    on('sBuy', (e) => edit(() => { sc.purchase = e.checked; }));
    on('sTitle', (e) => edit(() => { sc.title = e.value; if (!sc.id) sc.id = slug(e.value); }));
    on('sDesc', (e) => edit(() => { sc.description = e.value; }));
    on('sAuthor', (e) => edit(() => { sc.author = e.value; }));
    on('sDiff', (e) => edit(() => { sc.difficulty = e.value; }));
    on('sAutoDesc', () => {
      const had = !!sc.description;
      edit(() => { sc.description = autoDescription(); });
      if (had) undoable('Briefing rewritten from the objectives');
    }, 'click');
    bindFolds(el);
  }

  // ---- step 5: Test (play it as either side or both; the computer's win odds)
  function subTest(el) {
    pad(el);
    const sc = A.sc;
    const human = Object.keys(sc.powers).filter((p) => sc.powers[p].controller === 'human');
    const team = human.length ? sc.powers[human[0]].team : null;
    const foes = Object.keys(sc.powers).filter((p) => sc.powers[p].team !== team);
    const msgs = validate();
    const blocked = msgs.some((m) => m.level === 'error');
    const sim = A.lastSim;
    el.innerHTML = `<div class="h" style="margin-top:0">Checks</div>${checksHtml(msgs)}
      <div class="h">Play it</div><p class="hint" style="margin-top:0">${blocked ? 'Fix the problems marked ✖ above to play.' : 'Opens a new tab exactly as players will see it. Test games are kept apart from the daily save.'}</p>
      <div class="actions col"><button class="primary" data-play="player" ${blocked ? 'disabled' : ''}>▶ Play as the player${human.length ? ' (' + esc(human.join(', ')) + ')' : ''}</button>
        <button data-play="opponent" ${foes.length && !blocked ? '' : 'disabled'}>▶ Play as the opponent${foes.length ? ' (' + esc(foes.join(', ')) + ')' : ''}</button>
        <button data-play="both" ${blocked ? 'disabled' : ''}>▶ Play both sides</button></div>
      ${field('Computer opponent', `<select id="sOpp"><option value="">Standard</option><option value="earlier" ${sc.opponent === 'earlier' ? 'selected' : ''}>Earlier, easier (before the November 2026 update)</option></select>`)}
      <div class="h">Win odds</div><p class="hint">The computer plays your side against the computer opponent, many times. A thoughtful person usually does better than this.</p>
      <div class="row">${field('Games', `<input type="number" id="tGames" value="${A.simGames || 30}" min="5" max="200" style="width:90px">`)}<button id="tRun" style="align-self:flex-end" ${blocked ? 'disabled title="Fix the problems marked ✖ first"' : ''}>Run</button></div>
      <div class="bar"><div id="tBar"></div></div><div id="tOut">${sim ? `<p><b>${Math.round(100 * sim.won / sim.games)}%</b> of ${sim.games} games won by the computer playing your side.</p>
        <p class="hint">Wins by turn: ${Object.keys(sim.turns).sort().map((k) => `${k}: ${sim.turns[k]}`).join(' · ') || '—'}</p>
        <p class="hint">${Object.keys(sim.reasons).map((k) => `${esc(k)} ×${sim.reasons[k]}`).join('<br>')}</p>` : sc.balance ? `<p class="hint">Last check: ${Math.round(sc.balance.winRate * 100)}% of ${sc.balance.games} games.</p>` : ''}</div>
      <div class="actions"><button id="gVar" title="A new puzzle like this one with the armies adjusted toward the same win rate">Make a variant</button></div><div id="gOut" class="hint"></div>
      ${fold('players', 'Player results', `<p class="hint">Daily results reported by players' browsers (needs a GoatCounter site code in <code>config.json</code>), next to each puzzle's win odds, to see how much better or worse people do than the computer.</p>
        <div class="actions"><button id="tPlayers">Load player results</button></div><div id="tPlayersOut"></div>`)}
      ${fold('battle', 'Battle odds', `<p class="hint">Attackers vs defenders as counts, e.g. <code>3 infantry, 1 tank</code>.</p>
        ${field('Attackers', '<input type="text" id="oA" value="3 infantry, 1 artillery, 1 tank">')}${field('Defenders', '<input type="text" id="oD" value="3 infantry">')}
        <label class="chk"><input type="checkbox" id="oSea"> Sea battle</label><div class="actions"><button id="oRun">Calculate</button></div><div id="oOut" class="hint"></div>`)}
      ${fold('share', 'Share text', '<div class="actions"><button id="tShare">Preview share text</button></div>')}`;
    bindFolds(el);
    bindChecks(el);
    el.querySelectorAll('[data-play]').forEach((b) => b.onclick = () => playTest(b.dataset.play));
    $('sOpp').onchange = (e) => edit(() => { if (e.target.value === 'earlier') sc.opponent = 'earlier'; else delete sc.opponent; });
    $('tShare').onclick = () => {
      const txt = D.shareText({ number: 1, title: A.sc.title, won: true, turns: Math.min(2, A.sc.maxTurns), maxTurns: A.sc.maxTurns, objectivesDone: 1, objectivesTotal: 1, history: [{ progress: 0.5 }, { progress: 1 }], luckYou: { dice: 10, diff: 1.2 }, luckFoe: { dice: 8, diff: -0.6 }, url: location.origin + location.pathname.replace(/author\.html$/, '') });
      dialog(`<h2>Share text preview</h2><div class="share">${esc(txt)}</div><p class="hint">Example values; the real numbers come from the game.</p><div class="actions"><button class="primary" data-close>Close</button></div>`);
    };
    $('tRun').onclick = async () => {
      const games = A.simGames = Math.max(5, Math.min(200, +$('tGames').value || 30));
      const errs = validate().filter((m) => m.level === 'error');
      if (errs.length) { $('tOut').innerHTML = `<div class="msg error">${esc(errs[0].msg)}</div>`; return; }
      $('tOut').textContent = 'Running…';
      $('tRun').disabled = true;
      const r = await job({ cmd: 'selfplay', sc: pruned(A.sc), games, seed: E.randomSeed() }, (p) => { const b = $('tBar'); if (b) b.style.width = Math.round(p * 100) + '%'; });
      if (!r.ok) { const o = $('tOut'); if (o) o.textContent = r.error; return; }
      A.lastSim = r.result;
      // kept with the puzzle, to compare with how real players do (Player results below)
      A.sc.balance = { winRate: Math.round((1000 * r.result.won) / r.result.games) / 1000, games: r.result.games, ai: (window.TacticleAI && window.TacticleAI.VERSION) || 1 };
      renderAll();
    };
    $('gVar').onclick = async () => {
      if (!A.sc.playable.length) { toast('Nothing to vary yet'); return; }
      $('gOut').textContent = 'Making a variant…';
      const r = await job({ cmd: 'variant', sc: pruned(A.sc), opts: { seed: E.randomSeed(), tune: 16 } });
      if (!r.ok) { const o = $('gOut'); if (o) o.textContent = r.error; return; }
      r.sc.id = '';
      if (await loadScenario(r.sc, true)) {
        A.savedAs = null;
        toast(`Variant ready (computer win rate ${r.sc.generator && r.sc.generator.winRate != null ? Math.round(r.sc.generator.winRate * 100) + '%' : '?'}). Give it a new file name before saving.`, 6000);
      }
    };
    $('tPlayers').onclick = loadPlayerResults;
    $('oRun').onclick = () => {
      const parse = (s) => { const o = {}; for (const part of s.split(',')) { const m = /(\d+)\s*([a-z]+)/i.exec(part.trim()); if (m) { const t = Object.keys(R().units).find((k) => k.startsWith(m[2].toLowerCase()) || R().units[k].name.toLowerCase().startsWith(m[2].toLowerCase())); if (t) o[t] = (o[t] || 0) + +m[1]; } } return o; };
      const a = parse($('oA').value), d = parse($('oD').value);
      const r = E.simulate(a, d, { sea: $('oSea').checked, ruleset: A.sc.ruleset, trials: 2000, seed: E.randomSeed() });
      $('oOut').innerHTML = `Attacker wins <b>${Math.round(r.win * 100)}%</b>, defender holds ${Math.round(r.lose * 100)}%, stalemate ${Math.round(r.draw * 100)}%.<br>Average losses: attacker ${r.attLoss.toFixed(1)} IPC, defender ${r.defLoss.toFixed(1)} IPC.`;
    };
  }
  /** Which step fixes a problem the checks report ('name' is the file name in the dock). */
  function stepFor(msg) {
    const m = msg.toLowerCase();
    if (/file name/.test(m)) return 'name';
    if (/objective|max turns|turn objectives|title|briefing/.test(m)) return 'objectives';
    if (/no playable/.test(m)) return 'territories';
    if (/power|player|team|computer opponent|capital/.test(m)) return 'owners';
    if (/unit|ship|transport|factor|rules/.test(m)) return 'units';
    return null;
  }
  /** The checks, each with a button to the step that fixes it. */
  function checksHtml(msgs) {
    if (!msgs.length) return '<div class="msg" style="color:var(--good)">✔ Ready to play</div>';
    return msgs.map((m) => {
      const to = stepFor(m.msg);
      const sub = SUBS.find((x) => x[0] === to);
      const btn = to === 'name' ? '<button class="small link" data-fix="name">File name</button>' : sub ? `<button class="small link" data-fix="${to}">${sub[1]}</button>` : '';
      return `<div class="msg ${m.level}"><span>${m.level === 'error' ? '✖' : '⚠'} ${esc(m.msg)}</span>${btn}</div>`;
    }).join('');
  }
  function bindChecks(el) {
    el.querySelectorAll('[data-fix]').forEach((b) => b.onclick = () => {
      if (b.dataset.fix === 'name') { const n = $('dkName'); if (n) { n.focus(); n.select(); } return; }
      goSub(b.dataset.fix);
    });
  }
  /** A section that folds away; whether it is open is remembered while the page is open. */
  function fold(key, title, html, summary) {
    const open = (A.folds || (A.folds = {}))[key];
    return `<details class="fold" data-fold="${key}" ${open ? 'open' : ''}><summary>${esc(title)}${summary ? `<span class="hint"> · ${esc(summary)}</span>` : ''}</summary>${html}</details>`;
  }
  function bindFolds(el) {
    el.querySelectorAll('[data-fold]').forEach((d) => d.addEventListener('toggle', () => { A.folds[d.dataset.fold] = d.open; }));
  }
  /**
   * Opens the puzzle in a new tab. 'opponent' hands the opposing side to the person and the player's side to the
   * computer; 'both' lets the person move every power. playerTeam keeps objectives and the result on the player's side.
   */
  function playTest(mode) {
    const errs = validate().filter((m) => m.level === 'error');
    if (errs.length) { toast(`Can't play yet: ${errs[0].msg}${errs.length > 1 ? ` (and ${errs.length - 1} more)` : ''}`, 0, { label: 'Show problems', run: () => goSub('test') }); return; }
    const sc = pruned(A.sc);
    if (mode === 'opponent' || mode === 'both') {
      const human = Object.keys(sc.powers).filter((p) => sc.powers[p].controller === 'human');
      sc.playerTeam = sc.powers[human[0]].team;
      for (const p of Object.keys(sc.powers)) sc.powers[p].controller = mode === 'both' || sc.powers[p].team !== sc.playerTeam ? 'human' : 'ai';
      sc.testAs = mode;
    }
    store.set('tacticle:test', sc);
    window.open('index.html?test&fresh', 'tacticle-test');
  }

  // ---- Generate (from Select Map): a puzzle built around a front line, tuned toward a win rate
  async function generateDialog() {
    const id = A.preview || A.sc.map;
    let map;
    try { map = await fetchMap(id); } catch (e) { toast(e.message, 6000); return; }
    const g = A.genOpts || (A.genOpts = { theater: 'eastern', size: 9, difficulty: 'medium', naval: false, playerTeam: 'any', tune: 16 });
    const cal = store.get('tacticle:calibration');
    const band = (GEN.DIFFICULTY ? GEN.DIFFICULTY[g.difficulty].band : [0.45, 0.72]);
    dialog(`<h2>Generate a puzzle</h2><p class="hint">Builds a puzzle around a front line on the ${esc(map.name || id)} map, then plays it computer-vs-computer and adjusts the armies toward a target win rate.</p>` +
      field('Theatre', `<select id="gTh">${Object.keys(GEN.THEATERS).map((k) => `<option value="${k}" ${g.theater === k ? 'selected' : ''}>${esc(GEN.THEATERS[k].name)}</option>`).join('')}</select>`) +
      '<div class="two">' + field('Land territories', `<input type="number" id="gSize" min="4" max="30" value="${g.size}">`) +
      field('Difficulty', `<select id="gDiff">${['easy', 'medium', 'hard'].map((d) => `<option ${g.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select>`) + '</div>' +
      '<div class="two">' + field('Player side', `<select id="gTeam"><option value="any">Either</option><option ${g.playerTeam === 'Axis' ? 'selected' : ''}>Axis</option><option ${g.playerTeam === 'Allies' ? 'selected' : ''}>Allies</option></select>`) +
      field('Balance games', `<input type="number" id="gTune" min="0" max="60" value="${g.tune}" title="Computer self-play games per tuning step (0 = skip)">`) + '</div>' +
      `<label class="chk"><input type="checkbox" id="gNaval" ${g.naval ? 'checked' : ''}> Include sea zones, fleets and transports</label>
      ${map.defaultSetup ? `<label class="chk"><input type="checkbox" id="gMapUnits" ${g.mapUnits !== false ? 'checked' : ''}> Use this map's starting armies (tune the turn limit and reinforcements)</label>` : ''}
      ${cal && cal.b ? `<label class="chk"><input type="checkbox" id="gCal" ${g.calibrate ? 'checked' : ''}> Aim for real players (${cal.players} players, ${cal.puzzles} puzzle${cal.puzzles === 1 ? '' : 's'}): for players to win ${band.map((x) => Math.round(x * 100) + '%').join('–')}, the computer's win odds aim at ${band.map((x) => Math.round(100 * window.TacticleResults.simFromReal(cal, x)) + '%').join('–')}</label>` : ''}
      <div class="bar"><div id="gBar"></div></div><div id="gOut2" class="hint"></div>
      ${unsavedWork() ? `<p class="dkwarn">The generated puzzle replaces “${esc(A.sc.title || 'Untitled puzzle')}”, which has changes that are not saved.</p>` : ''}
      <div class="actions"><button data-close>Cancel</button><button class="primary" id="gNew">${unsavedWork() ? 'Discard changes and generate' : 'Generate'}</button></div>`);
    $('gNew').onclick = async () => {
      g.theater = $('gTh').value; g.size = +$('gSize').value || 9; g.difficulty = $('gDiff').value; g.playerTeam = $('gTeam').value;
      g.tune = Math.max(0, +$('gTune').value || 0); g.naval = $('gNaval').checked; g.ruleset = A.sc.ruleset;
      g.mapUnits = $('gMapUnits') ? $('gMapUnits').checked : false;
      g.calibrate = !!($('gCal') && $('gCal').checked);
      if (id !== A.map.id) {
        try { await useMap(id, Object.assign(newScenario(id), { ruleset: A.sc.ruleset }), false, map); } catch (e) { $('gOut2').textContent = e.message; return; }
        A.savedJSON = null;
      }
      $('gNew').disabled = true;
      $('gOut2').textContent = 'Generating…';
      $('gBar').style.width = '30%';
      const r = await job({ cmd: 'generate', opts: Object.assign({}, g, { seed: E.randomSeed(), calibration: g.calibrate && cal && cal.b ? { a: cal.a, b: cal.b } : null }) });
      if (!r.ok) { $('gOut2').textContent = r.error; $('gNew').disabled = false; return; }
      $('gBar').style.width = '100%';
      if (await loadScenario(r.sc, true)) {
        closeDialog();
        A.savedAs = null;
        A.preview = A.sc.map;
        goSub('territories');
        toast(`Generated “${r.sc.title}”. The computer won ${r.sc.generator && r.sc.generator.winRate != null ? Math.round(r.sc.generator.winRate * 100) + '%' : '?'} of its games as the player.`, 6000);
      }
    };
  }

  /** Real players' results per puzzle (GoatCounter counts, see js/results.js) next to the balance check. */
  async function loadPlayerResults() {
    const out = $('tPlayersOut');
    const RS = window.TacticleResults;
    let cfg = null;
    try { cfg = await getJSON('config.json'); } catch (e) { /* none */ }
    const code = cfg && cfg.results && cfg.results.goatcounter;
    if (!RS || !RS.valid(code)) {
      out.innerHTML = '<p class="hint">Not set up. Create a free site at goatcounter.com, turn on “Allow adding visitor counts on your website” in its settings, and put its code in <code>config.json</code> as <code>{"results": {"goatcounter": "yourcode"}}</code>. Results are counted from then on.</p>';
      return;
    }
    out.textContent = 'Loading…';
    const rows = [];
    for (const p of A.puzzles) {
      let sim = null;
      try { const sc = await getJSON(p.file); sim = sc.balance && sc.balance.winRate != null ? sc.balance.winRate : sc.generator && sc.generator.winRate != null ? sc.generator.winRate : null; } catch (e) { /* missing file */ }
      let players = null;
      try { players = await RS.tally(code, p.id, null, (u, o) => fetch(u, o)); } catch (e) { out.innerHTML = `<p class="hint">${esc(e.message)}. Is “Allow adding visitor counts on your website” on in GoatCounter?</p>`; return; }
      rows.push({ id: p.id, title: p.title || p.id, sim, players });
    }
    const cal = RS.calibration(rows, 5);
    const fit = RS.fitCalibration(rows, 5);
    store.set('tacticle:calibration', fit ? Object.assign({ at: D.today(), gap: cal ? cal.gap : 0 }, fit) : null);
    const pctOf = (t) => { const v = RS.pct(t); return v == null ? '—' : v + '%'; };
    out.innerHTML = `<table class="ptable"><tr><th align="left">Puzzle</th><th>Players</th><th>Won</th><th>Balance check</th></tr>${rows.map((r) => {
      const n = r.players.won + r.players.lost;
      return `<tr><td>${esc(r.title)}</td><td align="center">${n}</td><td align="center">${pctOf(r.players)}</td><td align="center">${r.sim == null ? '—' : Math.round(r.sim * 100) + '%'}</td></tr>`;
    }).join('')}</table>
      <p class="hint">${cal && fit ? `On average players won <b>${Math.abs(cal.gap)} points ${cal.gap >= 0 ? 'more' : 'less'}</b> often than the balance check predicted (${cal.players} players on ${cal.puzzles} puzzle${cal.puzzles === 1 ? '' : 's'} with at least 5 players and a balance check). The gap is not the same at every rate, so it is fitted as a curve: a balance check of ${[0.2, 0.5, 0.8].map((x) => `${Math.round(x * 100)}% → ${Math.round(100 * RS.realFromSim(fit, x))}%`).join(', ')} for players. The Generate tab can aim for that.` : 'Not enough results yet: a puzzle needs at least 5 players and a saved balance check (run one in this tab, or generate the puzzle) to count.'}</p>`;
  }
  function tabSchedule(el) {
    const sch = A.schedule;
    const today = D.today();
    const start = A.schedFrom || D.addDays(today, -7);
    const days = [];
    for (let i = 0; i < 49; i++) days.push(D.addDays(start, i));
    const files = A.puzzles.map((p) => p.file);
    const used = {};
    for (const d of Object.keys(sch.days)) used[sch.days[d]] = (used[sch.days[d]] || 0) + 1;
    const replayLabel = (d) => {
      if (sch.fallback === 'latest') return '— (latest puzzle)';
      const e = D.entryFor(sch, d);
      return e && e.replay ? `— replay: ${e.file.replace(/^puzzles\/|\.json$/g, '')}` : '— (nothing to replay yet)';
    };
    const opts = (sel, d) => `<option value="">${esc(replayLabel(d))}</option>` + A.puzzles.map((p) => `<option value="${esc(p.file)}" ${sel === p.file ? 'selected' : ''}>${esc(p.id)}${used[p.file] ? ' ✓' : ''}</option>`).join('') + (sel && !files.includes(sel) ? `<option selected value="${esc(sel)}">${esc(sel)} (missing)</option>` : '');
    const focus = A.schedFocus && files.includes(A.schedFocus.file) ? A.schedFocus : null;
    const free = firstFree(today);
    el.innerHTML = `<h2 style="margin-top:0">Schedule</h2>${focus ? `<div class="objbox on"><b>Schedule “${esc(focus.title || focus.file)}”</b>${used[focus.file] ? ' <span class="hint">(already scheduled ✓)</span>' : ''}<div class="actions"><button class="primary small" id="schPut" style="flex:none">Put it on ${esc(free)}</button><button class="small" id="schFocusX">Done</button></div><p class="hint" style="margin:0">Or pick it in any day's list below.</p></div>` : ''}<p class="hint">One puzzle per day, by the player's local date. Puzzle numbers count from the first day. Saved puzzles marked ✓ are already scheduled.</p>
      <p class="hint" id="schStatus"></p>
      ${field('First day (puzzle #1)', `<input type="date" id="schEpoch" value="${esc(sch.epoch || today)}">`)}
      ${field('Days with nothing scheduled', `<select id="schFallback"><option value="random" ${sch.fallback !== 'latest' ? 'selected' : ''}>Replay an earlier puzzle (picked from the date, same for everyone)</option><option value="latest" ${sch.fallback === 'latest' ? 'selected' : ''}>Keep showing the most recent puzzle</option></select>`)}
      <div class="actions"><button class="small" id="schPrev">← 4 weeks</button><button class="small" id="schToday">Today</button><button class="small" id="schNext">4 weeks →</button></div>
      <div class="actions"><button class="small" id="schFill">Fill empty days with unscheduled puzzles</button></div>
      <table class="sched">${days.map((d) => {
        const dt = D.parse(d);
        const n = D.number({ epoch: sch.epoch || today }, d);
        return `<tr class="${d === today ? 'today' : d < today ? 'past' : ''}"><td>${dt.toLocaleDateString(undefined, { weekday: 'short' })}</td><td>${d}</td><td>${n >= 1 ? '#' + n : ''}</td><td><select data-day="${d}">${opts(sch.days[d], d)}</select></td></tr>`;
      }).join('')}</table>
      ${A.server || A.dir ? '' : `<div class="actions"><button class="primary" id="schSave">Download schedule.json</button>${store.get(SCHED_DRAFT) ? '<button id="schDiscard">Discard changes</button>' : ''}</div>`}`;
    const put = $('schPut'); if (put) put.onclick = () => { sch.days[free] = focus.file; A.schedFocus = null; if (free > D.addDays(start, 48)) A.schedFrom = D.addDays(free, -7); scheduleChanged(); toast(`Scheduled for ${free}`); };
    const fx = $('schFocusX'); if (fx) fx.onclick = () => { A.schedFocus = null; renderTab(); };
    el.querySelectorAll('[data-day]').forEach((s) => s.onchange = () => { if (s.value) sch.days[s.dataset.day] = s.value; else delete sch.days[s.dataset.day]; scheduleChanged(); });
    $('schEpoch').onchange = (e) => { sch.epoch = e.target.value; scheduleChanged(); };
    $('schFallback').onchange = (e) => { if (e.target.value === 'latest') sch.fallback = 'latest'; else delete sch.fallback; scheduleChanged(); };
    $('schPrev').onclick = () => { A.schedFrom = D.addDays(start, -28); renderTab(); };
    $('schNext').onclick = () => { A.schedFrom = D.addDays(start, 28); renderTab(); };
    $('schToday').onclick = () => { A.schedFrom = null; renderTab(); };
    $('schFill').onclick = () => {
      const unused = A.puzzles.filter((p) => !used[p.file] && !p.error).map((p) => p.file);
      let d = today, n = 0;
      while (unused.length && n < 400) { if (!sch.days[d]) { sch.days[d] = unused.shift(); } d = D.addDays(d, 1); n++; }
      scheduleChanged();
    };
    const save = $('schSave'); if (save) save.onclick = () => saveSchedule();
    const discard = $('schDiscard');
    if (discard) discard.onclick = async () => {
      if (!await ask('Discard the schedule changes made in this browser?', '<p>The schedule goes back to the published <code>schedule.json</code>.</p>', 'Discard changes', 'Keep them', true)) return;
      store.del(SCHED_DRAFT);
      try { A.schedule = await getJSON('schedule.json'); } catch (e) { A.schedule = { epoch: D.today(), days: {} }; }
      A.schedule.days = A.schedule.days || {};
      A.schedDirty = false;
      renderTab();
    };
    renderSchedStatus();
  }
  // ---- the schedule saves itself: through the local server or a connected folder; otherwise it is
  // kept in this browser (it survives a reload) until it is downloaded
  const SCHED_DRAFT = 'tacticle:scheduleDraft';
  function scheduleText() {
    return JSON.stringify(Object.assign({ epoch: A.schedule.epoch }, A.schedule.fallback === 'latest' ? { fallback: 'latest' } : {}, { days: sortObj(A.schedule.days) }), null, 2);
  }
  function scheduleChanged() {
    A.schedDirty = true;
    if (A.server || A.dir) {
      A.schedState = 'saving';
      clearTimeout(A.schedTimer);
      A.schedTimer = setTimeout(() => saveSchedule(true), 400);
    } else {
      store.set(SCHED_DRAFT, JSON.parse(scheduleText()));
      A.schedState = 'local';
      A.schedDirty = false; // kept in this browser
    }
    renderTab();
  }
  function renderSchedStatus() {
    const el = $('schStatus');
    if (!el) return;
    const st = A.schedState;
    el.textContent = A.server || A.dir
      ? (st === 'saving' ? 'Saving…' : st === 'error' ? `Not saved: ${A.schedError}. Change anything to try again.` : 'Changes save automatically.')
      : (store.get(SCHED_DRAFT) ? 'No local server: changes are kept in this browser. Download schedule.json and put it in the repository root to publish them.' : 'No local server: changes are kept in this browser until you download schedule.json.');
    el.className = 'hint' + (st === 'error' ? ' err' : '');
  }
  function firstFree(from) { let d = from; while (A.schedule.days[d]) d = D.addDays(d, 1); return d; }

  function tabFiles(el) {
    el.innerHTML = `<h2 style="margin-top:0">Files</h2><div class="actions"><button id="fNew">New</button><button id="fSaveAs">Save as…</button><button id="fDl">Download JSON</button><label class="small" style="border:1px solid var(--line);border-radius:8px;padding:3px 8px;cursor:pointer">Open JSON…<input type="file" id="fOpen" accept=".json" hidden></label></div>
      <p class="hint">${A.server ? 'Saving writes <code>puzzles/&lt;id&gt;.json</code> through the local server.' : A.dir ? 'Saving writes into the connected folder.' : 'No local server. Run <code>node tools/serve.js</code> in the repository, or connect the repository folder (Chrome/Edge), or download files and copy them into <code>puzzles/</code>.'}</p>
      ${!A.server && window.showDirectoryPicker ? `<div class="actions"><button id="fDir">${A.dir ? 'Folder connected ✓' : 'Connect repository folder…'}</button></div>` : ''}
      ${unopenedHtml()}
      <div class="h">Saved puzzles (${A.puzzles.length})</div>
      <div class="list plist">${A.puzzles.map((p) => `<div class="urow ${p.id === A.sc.id ? 'cur' : ''}"><span class="nm">${esc(p.title || p.id)}<small>${esc(p.id)} · ${esc(p.map || '')} · ${esc(p.ruleset || '')} · ${p.maxTurns || '?'} turns${Object.values(A.schedule.days).includes(p.file) ? ' · scheduled' : ''}</small></span><button class="small" data-load="${esc(p.file)}">Open</button>${A.server ? `<button class="small" data-delp="${esc(p.id)}">✕</button>` : ''}</div>`).join('') || '<p class="hint">None yet.</p>'}</div>`;
    $('fNew').onclick = async () => { if (!await okToReplace('Start a new puzzle?')) return; await loadScenario(newScenario(A.map.id), false); A.savedJSON = null; A.savedAs = null; goPage('select'); };
    $('fSaveAs').onclick = saveAsDialog;
    $('fDl').onclick = () => download((A.sc.id || 'puzzle') + '.json', JSON.stringify(pruned(A.sc), null, 2));
    $('fOpen').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const sc = JSON.parse(await f.text()); if (await loadScenario(sc, true)) goSub('territories'); } catch (err) { toast('Not a scenario: ' + err.message); }
    };
    const fu = $('fUnopened');
    if (fu) {
      fu.onclick = async () => {
        if (!await okToReplace('Open the set-aside draft?')) return;
        const d = store.get('tacticle:authorDraftUnopened');
        if (d && d.sc && await loadScenario(d.sc, true)) { store.del('tacticle:authorDraftUnopened'); goSub('territories'); }
      };
      $('fUnopenedX').onclick = () => { store.del('tacticle:authorDraftUnopened'); renderTab(); };
    }
    const fd = $('fDir'); if (fd) fd.onclick = async () => { try { A.dir = await window.showDirectoryPicker({ mode: 'readwrite' }); toast('Folder connected'); renderTab(); } catch (e) { /* cancelled */ } };
    el.querySelectorAll('[data-load]').forEach((b) => b.onclick = async () => {
      if (!await okToReplace('Open this puzzle instead?')) return;
      try { if (await loadScenario(await getJSON(b.dataset.load), false)) goSub('territories'); } catch (e) { toast(e.message); }
    });
    el.querySelectorAll('[data-delp]').forEach((b) => b.onclick = async () => {
      const p = A.puzzles.find((x) => x.id === b.dataset.delp) || { id: b.dataset.delp };
      if (!await ask(`Delete “${p.title || p.id}”?`, `<p>This deletes <code>puzzles/${esc(p.id)}.json</code> and clears any scheduled days that use it. It cannot be undone.</p>`, 'Delete puzzle', 'Keep it', true)) return;
      await fetch('api/puzzles/' + b.dataset.delp, { method: 'DELETE' });
      for (const d of Object.keys(A.schedule.days)) if (A.schedule.days[d] === `puzzles/${b.dataset.delp}.json`) delete A.schedule.days[d];
      await refreshPuzzles();
      await saveSchedule(true);
      renderTab();
    });
  }

  /** Saves a copy under a new name. The file it writes shows as the name is typed, and an existing file is named before it is replaced. */
  function saveAsDialog() {
    const first = A.sc.id ? A.sc.id + '-2' : slug(A.sc.title);
    dialog(`<h2>Save a copy</h2>${field('File name', `<input type="text" id="saIn" value="${esc(first)}" spellcheck="false" autocomplete="off">`)}<p class="hint" id="saHint"></p>
      <div class="actions"><button data-close>Cancel</button><button class="primary" id="saGo">Save copy</button></div>`);
    const inp = $('saIn');
    const upd = () => {
      const id = slug(inp.value);
      const exists = !!id && id !== A.savedAs && A.puzzles.some((p) => p.id === id);
      $('saHint').innerHTML = !id ? 'Use letters, numbers and dashes.' : exists ? `<span class="warnink">A save file named <code>${esc(id)}</code> exists. Saving replaces it.</span>` : `Saves as <code>puzzles/${esc(id)}.json</code>`;
      $('saGo').textContent = exists ? 'Replace it' : 'Save copy';
      $('saGo').disabled = !id;
    };
    const go = async () => {
      const id = slug(inp.value);
      if (!id) return;
      closeDialog();
      edit(() => { A.sc.id = id; });
      if (await save()) { A.savedAs = id; A.justSaved = true; renderAll(); }
    };
    inp.oninput = upd;
    inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    $('saGo').onclick = go;
    upd();
    inp.focus();
    inp.select();
  }
  /** A draft set aside at start-up because its map was missing; it can be reopened once the map is back. */
  function unopenedHtml() {
    const d = store.get('tacticle:authorDraftUnopened');
    if (!d || !d.sc) return '';
    return `<div class="msg warn">An unsaved draft, “${esc(d.sc.title || d.sc.id || 'Untitled')}” on the map ${esc(d.sc.map)}, could not be opened. Once its map is available (import it again, or add it to maps/), open it here.
      <div class="actions"><button class="small" id="fUnopened">Open that draft</button><button class="small" id="fUnopenedX">Discard it</button></div></div>`;
  }
  /** Resolves true once the scenario is open, false if its map could not be loaded (nothing changes then). */
  async function loadScenario(sc, markDirty) {
    commit();
    sc = Object.assign(newScenario(sc.map), sc);
    sc.setup = sc.setup || {};
    sc.objectives = sc.objectives && sc.objectives.length ? sc.objectives : [{ type: 'capture', territories: [] }];
    const mapChanged = !A.map || sc.map !== A.map.id;
    if (mapChanged) {
      try { await useMap(sc.map, sc, true); } catch (e) { A.hist.pop(); toast(e.message, 6000); return false; }
    } else A.sc = tidy(sc);
    A.selected = null;
    A.brush.obj = 0;
    A.mv.setFocus(A.sc.playable.length ? A.sc.playable : null);
    if (!markDirty) A.savedJSON = JSON.stringify(pruned(A.sc));
    A.savedAs = markDirty ? null : A.sc.id || null;
    A.justSaved = false;
    A.overwrite = null;
    A.lastSim = null;
    A.preview = A.sc.map;
    renderAll();
    return true;
  }

  // ------------------------------------------------------------------ saving
  function pruned(sc) {
    const out = E.clone(sc);
    const play = new Set(out.playable);
    for (const id of Object.keys(out.setup)) {
      if (!play.has(id)) { delete out.setup[id]; continue; }
      const st = out.setup[id];
      for (const p of Object.keys(st.units || {})) if (!Object.keys(st.units[p]).length) delete st.units[p];
      if (st.units && !Object.keys(st.units).length) delete st.units;
      if (!Object.keys(st).length) delete out.setup[id];
    }
    // store owners explicitly so map edits never change a saved puzzle
    for (const id of play) {
      const t = A.T[id];
      if (!t || t.type === 'sea') continue;
      out.setup[id] = out.setup[id] || {};
      if (out.setup[id].owner === undefined) out.setup[id].owner = t.owner || null;
      if (out.setup[id].owner && !out.powers[out.setup[id].owner]) out.setup[id].owner = null;
    }
    out.playable = [...play].sort();
    out.format = 'tacticle-scenario';
    out.version = 1;
    return out;
  }
  /** Writes the puzzle (local server, connected folder, or a download). Resolves true once saved. */
  async function save() {
    const sc = A.sc;
    if (!sc.id) { toast('Give the puzzle a file name first'); return false; }
    const errs = validate().filter((m) => m.level === 'error');
    if (errs.length && !await ask('Save a puzzle with problems?', `<ul>${errs.map((e) => `<li>${esc(e.msg)}</li>`).join('')}</ul><p>Players cannot start it until these are fixed. The Test step lists them with links to the step that fixes each.</p>`, 'Save anyway', 'Don\'t save', true)) return false;
    const data = pruned(sc);
    const text = JSON.stringify(data, null, 2);
    try {
      if (A.server) {
        const r = await fetch('api/puzzles/' + sc.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || r.status);
        toast(`Saved ${j.file}`);
      } else if (A.dir) {
        await writeFile(['puzzles', sc.id + '.json'], text);
        await refreshPuzzles();
        if (!A.puzzles.some((p) => p.id === sc.id)) A.puzzles.push({ id: sc.id, file: `puzzles/${sc.id}.json`, title: sc.title, map: sc.map, ruleset: sc.ruleset, maxTurns: sc.maxTurns });
        await writeFile(['puzzles', 'index.json'], JSON.stringify({ puzzles: A.puzzles }, null, 2));
        toast(`Saved puzzles/${sc.id}.json`);
      } else {
        download(sc.id + '.json', text);
        if (!A.puzzles.some((p) => p.id === sc.id)) A.puzzles.push({ id: sc.id, file: `puzzles/${sc.id}.json`, title: sc.title, map: sc.map, ruleset: sc.ruleset, maxTurns: sc.maxTurns });
        toast('Downloaded. Copy it into puzzles/ in the repository.');
      }
      A.savedJSON = JSON.stringify(data);
      const kept = A.puzzles.find((p) => p.id === sc.id);
      await refreshPuzzles();
      if (kept && !A.puzzles.some((p) => p.id === sc.id)) A.puzzles.push(kept); // a download is not listed by the site yet
      renderAll();
      return true;
    } catch (e) { toast('Save failed: ' + e.message, 4000); return false; }
  }
  async function saveSchedule(quiet) {
    // one save at a time; a change made while saving is saved right after
    if (A.schedSaving) { A.schedAgain = true; return; }
    A.schedSaving = true;
    const text = scheduleText();
    try {
      if (A.server) {
        const r = await fetch('api/schedule', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text });
        if (!r.ok) throw new Error((await r.json()).error);
      } else if (A.dir) await writeFile(['schedule.json'], text);
      else download('schedule.json', text);
      if (A.server || A.dir) { A.schedState = 'saved'; store.del(SCHED_DRAFT); }
      A.schedDirty = false;
      if (!quiet) toast(A.server || A.dir ? 'Schedule saved' : 'Downloaded schedule.json; put it in the repository root');
    } catch (e) {
      A.schedState = 'error';
      A.schedError = e.message;
      if (!quiet) toast('Could not save schedule: ' + e.message);
    } finally {
      A.schedSaving = false;
      renderSchedStatus();
      if (A.schedAgain) { A.schedAgain = false; saveSchedule(true); }
    }
  }
  function sortObj(o) { const out = {}; for (const k of Object.keys(o).sort()) out[k] = o[k]; return out; }
  async function writeFile(parts, text) {
    let dir = A.dir;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
    const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function importTripleA() {
    const xml = $('taXml').files[0], poly = $('taPoly').files[0], cent = $('taCent').files[0], props = $('taProps').files[0];
    if (!xml || !poly) { toast('Choose the game XML and polygons.txt'); return; }
    const id = slug($('taId').value || xml.name.replace(/\.xml$/i, ''));
    try {
      const map = TA.convert({ xml: await xml.text(), polygons: await poly.text(), centers: cent ? await cent.text() : '', properties: props ? await props.text() : '', id, wrapX: $('taWrap').checked || undefined });
      await installMap(map);
    } catch (e) { toast('Import failed: ' + e.message, 4000); }
  }

  // TripleA's published catalogue, fetched live from GitHub (text files only)
  async function fetchText(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url.replace(/^https:\/\/raw\.githubusercontent\.com\//, '')}: HTTP ${r.status}`);
    return r.text();
  }
  /** Importing a TripleA map from files on this computer (for maps not in the catalogue, or offline). */
  function filesImportHtml(open) {
    return `<details style="margin-top:8px" ${open ? 'open' : ''}><summary class="hint">Import a TripleA map from files on this computer…</summary><p class="hint">Pick the game XML (from the map's <code>games/</code> folder), <code>polygons.txt</code>, and optionally <code>centers.txt</code> and <code>map.properties</code>.</p>` +
      field('Game XML', '<input type="file" id="taXml" accept=".xml">') + field('polygons.txt', '<input type="file" id="taPoly" accept=".txt">') + field('centers.txt (optional)', '<input type="file" id="taCent" accept=".txt">') + field('map.properties (optional)', '<input type="file" id="taProps" accept=".properties,.txt">') +
      field('Map id', '<input type="text" id="taId" placeholder="e.g. my-triplea-map">') + '<label class="chk"><input type="checkbox" id="taWrap"> Map wraps left-right</label><button id="taGo">Import map</button></details>';
  }
  async function browseTripleA() {
    dialog('<h2>Import a base map</h2><p class="hint">Loading the TripleA catalogue from GitHub…</p>');
    try { A.taIndex = A.taIndex || await TA.listMaps(fetchText); } catch (e) {
      dialog(`<h2>Import a base map</h2><p class="err">Could not load the TripleA catalogue: ${esc(e.message)}</p>${filesImportHtml(true)}<div class="actions"><button data-close>Close</button></div>`);
      $('taGo').onclick = importTripleA;
      return;
    }
    const st = A.taState || (A.taState = { q: '', cat: 'BEST' });
    const draw = () => {
      const q = st.q.toLowerCase();
      const list = A.taIndex.filter((m) => (st.cat === 'all' || m.category === st.cat) && (!q || (m.name + ' ' + m.text).toLowerCase().includes(q)));
      const have = new Set(A.maps.map((m) => m.origin && m.origin.repo).filter(Boolean));
      $('taList').innerHTML = list.slice(0, 80).map((m) => `<div class="urow" style="align-items:flex-start"><span class="nm">${esc(m.name)} <small>${esc(m.category || 'uncategorised')}${have.has(m.repo) ? ' · imported' : ''} — ${esc(m.text.slice(0, 160))}${m.text.length > 160 ? '…' : ''}</small></span><button class="small" data-ta="${esc(m.repo)}">Games…</button></div>`).join('') || '<p class="hint">No maps match.</p>';
      $('taCount').textContent = `${list.length} of ${A.taIndex.length} maps`;
      $('taList').querySelectorAll('[data-ta]').forEach((b) => b.onclick = () => chooseTripleA(A.taIndex.find((m) => m.repo === b.dataset.ta)));
    };
    dialog(`<h2>Import a base map</h2><p class="hint">The catalogue TripleA's “Download maps” screen uses. Importing reads the map's text files (borders, connections, values, owners, starting units); no images. Credit the map's authors when you publish puzzles on it.</p>
      <div class="row"><input type="text" id="taQ" placeholder="Search, e.g. 1942, pacific, europe" value="${esc(st.q)}"><select id="taCat" style="width:auto">${['BEST', 'GOOD', 'EXPERIMENTAL', 'all'].map((c) => `<option ${st.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <p class="hint" id="taCount"></p><div class="list" id="taList" style="max-height:46vh;overflow:auto"></div>
      ${filesImportHtml(false)}
      <div class="actions"><button data-close>Close</button></div>`);
    $('taGo').onclick = importTripleA;
    $('taQ').oninput = () => { st.q = $('taQ').value; draw(); };
    $('taCat').onchange = () => { st.cat = $('taCat').value; draw(); };
    draw();
    $('taQ').focus();
  }
  async function chooseTripleA(entry) {
    dialog(`<h2>${esc(entry.name)}</h2><p class="hint">Reading the map's game list…</p>`);
    let games;
    try { games = await TA.listGames(entry.repo, entry.branch, fetchText); } catch (e) {
      dialog(`<h2>${esc(entry.name)}</h2><p class="err">${esc(e.message)}</p><div class="actions"><button id="taBack">Back</button></div>`);
      $('taBack').onclick = browseTripleA;
      return;
    }
    dialog(`<h2>${esc(entry.name)}</h2><p class="hint">${esc(entry.text.slice(0, 400))}</p><p>Each game is a starting setup on this map. Pick one to import:</p>
      <div class="list">${games.map((g, i) => `<div class="urow"><span class="nm">${esc(g.name)}<small>${esc(g.file)}</small></span><button class="small primary" data-g="${i}">Import</button></div>`).join('')}</div>
      <div class="hint" id="taMsg"></div><div class="actions"><button id="taBack">Back</button></div>`);
    $('taBack').onclick = browseTripleA;
    $('dialog').querySelectorAll('[data-g]').forEach((b) => b.onclick = async () => {
      const g = games[+b.dataset.g];
      $('taMsg').textContent = `Downloading and converting ${g.name}…`;
      $('dialog').querySelectorAll('button').forEach((x) => { x.disabled = true; });
      try {
        const id = slug(games.length === 1 ? entry.repo : g.name).replace(/-/g, '_').slice(0, 60);
        const map = await TA.importGame(entry, g, fetchText, { id });
        await installMap(map);
      } catch (e) {
        $('taMsg').innerHTML = `<span class="err">Import failed: ${esc(e.message)}</span>`;
        $('dialog').querySelectorAll('button').forEach((x) => { x.disabled = false; });
      }
    });
  }
  /** Save an imported map (server, connected folder, or download) and offer to use it. */
  async function installMap(map) {
    const id = map.id;
    if (!map.territories.length) throw new Error('No territories with polygons found');
    const text = JSON.stringify(map);
    if (A.server) {
      const r = await fetch('api/maps/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      A.maps = j.maps;
    } else {
      download(id + '.json', text);
      let kept = false;
      if (LM) try { await LM.put(map); kept = true; } catch (e) { /* private window or storage full */ }
      if (!A.maps.some((m) => m.id === id)) A.maps.push({ id, name: map.name, file: 'maps/' + id + '.json', local: kept });
      toast(kept ? 'Downloaded, and kept in this browser so you can build on it now. To publish puzzles on it, copy the file into maps/ and add it to maps/index.json.' : 'Downloaded; copy it into maps/ and add it to maps/index.json', 6000);
    }
    dialog(`<h2>Imported “${esc(map.name)}”</h2><p>${map.territories.length} territories, ${map.powers.length} powers${A.server ? `, saved as <code>maps/${esc(id)}.json</code>` : ''}.</p>${map.warnings.length ? '<p class="hint">' + map.warnings.slice(0, 6).map(esc).join('<br>') + '</p>' : ''}<div class="actions"><button data-close>Close</button><button class="primary" id="taUse">Start a puzzle on it</button></div>`);
    // the new map shows in Select Map's list straight away (a re-import replaces the old picture)
    A.mapCache[id] = map;
    delete A.thumbs[id];
    A.thumbLoading[id] = false;
    if (A.pv && A.pvId === id) { A.pv.destroy(); A.pv = null; A.pvId = null; }
    if (A.page === 'select') { A.preview = id; renderTab(); renderDock(); }
    $('taUse').onclick = async () => {
      if (!await okToReplace('Start a new puzzle on this map?')) return;
      closeDialog(); commit();
      A.savedJSON = null;
      useMap(id, Object.assign(newScenario(id), { ruleset: A.sc.ruleset }), false, map)
        .then(() => { A.savedAs = null; A.preview = id; goSub('territories'); })
        .catch((e) => { A.hist.pop(); toast(e.message, 6000); });
    };
  }

  // ------------------------------------------------------------------ worker jobs
  function job(msg, onProgress) {
    if (!A.worker) {
      A.worker = new Worker('js/worker.js');
      A.worker.onmessage = (ev) => {
        const m = ev.data;
        const j = A.jobs[m.id];
        if (!j) return;
        if (m.progress != null && !m.ok) { if (j.onProgress) j.onProgress(m.progress); return; }
        delete A.jobs[m.id];
        j.resolve(m);
      };
      A.workerMaps = {};
    }
    const id = ++A.jobN;
    msg.id = id;
    msg.mapId = A.map.id;
    if (!A.workerMaps[A.map.id]) { msg.map = A.map; A.workerMaps[A.map.id] = true; }
    return new Promise((resolve) => { A.jobs[id] = { resolve, onProgress }; A.worker.postMessage(msg); });
  }

  // ------------------------------------------------------------------ misc UI
  /** A short message; long ones stay up longer. An action (such as Undo) adds a button and more time. */
  function toast(msg, ms, action) {
    const t = $('toast');
    t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="small" id="toastAct">${esc(action.label)}</button>` : ''}`;
    t.classList.toggle('act', !!action);
    t.classList.add('on');
    if (action) $('toastAct').onclick = () => { t.classList.remove('on'); action.run(); };
    clearTimeout(A.toastT);
    A.toastT = setTimeout(() => t.classList.remove('on'), ms || Math.max(action ? 7000 : 2400, 55 * String(msg).length));
  }
  /** Reports an edit that removed things, with Undo right there instead of an “Are you sure?” first. */
  function undoable(msg) { toast(msg, 0, { label: 'Undo', run: undo }); }
  /** onClose runs once when the dialog closes or is replaced by another (Cancel, Esc, a click outside). */
  function dialog(html, onClose) {
    const prev = A.dialogClose;
    A.dialogClose = null;
    if (prev) prev();
    $('dialog').innerHTML = html;
    $('modal').classList.add('open');
    A.dialogClose = onClose || null;
    $('dialog').querySelectorAll('[data-close]').forEach((b) => b.onclick = closeDialog);
  }
  function closeDialog() {
    $('modal').classList.remove('open');
    const f = A.dialogClose;
    A.dialogClose = null;
    if (f) f();
  }
  /**
   * A question in the page. The buttons say what they do, and the safe answer has the focus, so Enter
   * never throws work away. Resolves true for `yes`.
   */
  function ask(title, body, yes, no, danger) {
    return new Promise((resolve) => {
      dialog(`<h2>${esc(title)}</h2>${body ? `<div class="askbody">${body}</div>` : ''}<div class="actions end"><button id="askNo">${esc(no || 'Cancel')}</button><button class="${danger ? 'danger' : 'primary'}" id="askYes">${esc(yes)}</button></div>`, () => resolve(false));
      $('askYes').onclick = () => { resolve(true); closeDialog(); };
      $('askNo').onclick = closeDialog;
      $('askNo').focus();
    });
  }
  /** Asks before replacing a puzzle with unsaved changes; resolves true when it may go. */
  async function okToReplace(what) {
    if (!unsavedWork()) return true;
    return ask(what, `<p>“${esc(A.sc.title || 'Untitled puzzle')}” has changes that are not saved. They will be lost.</p>`, 'Discard changes', 'Keep editing', true);
  }

  function wire() {
    $('bUndo').onclick = undo;
    $('bRedo').onclick = redo;
    $('bTest').onclick = () => playTest('player');
    $('zin').onclick = () => A.mv.zoom(0.7);
    $('zout').onclick = () => A.mv.zoom(1.4);
    $('zfit').onclick = () => A.mv.setFocus(A.sc.playable.length ? A.sc.playable : null);
    $('zworld').onclick = () => A.mv.setFocus(null);
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeDialog(); });
    window.addEventListener('beforeunload', (e) => { if ((A.sc && dirty()) || A.schedDirty) { e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
      // with a dialog open only Esc counts; the shortcuts would change the page behind it
      if ($('modal').classList.contains('open')) { if (e.key === 'Escape') { e.preventDefault(); closeDialog(); } return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (A.page !== 'edit') goPage('edit'); dockSave(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); playTest('player'); return; }
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = KEYS[e.key.toLowerCase()];
      if (k) { goSub(k[0], k[1]); return; }
      if (/^[1-9]$/.test(e.key) && A.page === 'edit' && A.sub === 'units') {
        const u = unitTypes()[+e.key - 1];
        if (u) { A.brush.unit = u; goSub('units', 'units'); }
        return;
      }
      if (e.key === 'Escape') {
        if ($('modal').classList.contains('open')) { closeDialog(); return; }
        // Esc leaves place or move mode for select mode
        if (A.page === 'edit' && A.sub === 'units' && A.tool !== 'select' && !A.msel) { goSub('units', 'select'); return; }
        A.selected = null; A.msel = null; renderAll();
      }
    });
  }

  window.TacticleAuthor = { A, save, loadScenario, renderAll };
  boot().catch(showFatal);
})();
