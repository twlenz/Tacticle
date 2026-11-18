/* Tacticle authoring tool. */
(function () {
  'use strict';
  const E = window.TacticleEngine, Rules = window.TacticleRules, D = window.TacticleDaily, I = window.TacticleIcons, TA = window.TacticleTripleA, GEN = window.TacticleGen;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full */ } },
  };
  const TABS = [['scenario', 'Scenario'], ['powers', 'Powers'], ['objectives', 'Objectives'], ['generate', 'Generate'], ['test', 'Test'], ['schedule', 'Schedule'], ['files', 'Files']];
  const TOOLS = [['select', 'Select', 'S'], ['playable', 'Playable', 'P'], ['owner', 'Owner', 'O'], ['units', 'Units', 'U'], ['objective', 'Objective', 'J']];
  const A = {
    server: false, dir: null, maps: [], map: null, mv: null, sc: null, tab: 'scenario', tool: 'playable',
    brush: { power: null, unit: 'infantry', obj: 0 }, selected: null, hist: [], fut: [], savedJSON: null,
    puzzles: [], schedule: { epoch: D.today(), days: {} }, worker: null, jobs: {}, jobN: 0, lastSim: null,
  };

  // ------------------------------------------------------------------ boot
  async function boot() {
    try { const r = await fetch('api/status', { cache: 'no-store' }); A.server = r.ok && (await r.json()).writable; } catch (e) { A.server = false; }
    try { A.maps = (await getJSON('maps/index.json')).maps || []; } catch (e) { A.maps = [{ id: 'world1942', name: 'World 1942', file: 'maps/world1942.json' }]; }
    await refreshPuzzles();
    try { A.schedule = await getJSON('schedule.json'); } catch (e) { A.schedule = { epoch: D.today(), days: {} }; }
    A.schedule.days = A.schedule.days || {};
    const draft = store.get('tacticle:authorDraft');
    A.sc = draft && draft.sc ? draft.sc : newScenario((A.maps[0] || {}).id);
    A.savedJSON = draft ? draft.savedJSON : null;
    await useMap(A.sc.map, true);
    wire();
    renderAll();
    if (!A.sc.playable.length) A.mv.setFocus(null);
    toast(A.server ? 'Connected to the local server: Save writes into puzzles/ and schedule.json' : 'No local server: Save downloads files (or connect a folder in Files)', 4000);
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
  async function useMap(id, initial) {
    const entry = A.maps.find((m) => m.id === id) || { file: `maps/${id}.json` };
    const map = await getJSON(entry.file);
    A.map = map;
    A.T = {};
    for (const t of map.territories) A.T[t.id] = t;
    if (A.mv) A.mv.destroy();
    A.mv = new window.TacticleMapView($('map'), map, { onClick, onContext, onHover, onDblClick: (id) => { if (id) { A.selected = id; renderAll(); } } });
    A.mv.setFocus(A.sc.playable.length ? A.sc.playable : null);
    if (!A.brush.power) A.brush.power = (map.powers[0] || {}).id;
    if (!initial) renderAll();
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
    } else set.delete(id);
    A.sc.playable = [...set];
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
  function undo() {
    if (!A.hist.length) return;
    A.fut.push(JSON.stringify(A.sc));
    const prevMap = A.sc.map;
    A.sc = JSON.parse(A.hist.pop());
    if (A.sc.map !== prevMap) useMap(A.sc.map); else renderAll();
  }
  function redo() {
    if (!A.fut.length) return;
    A.hist.push(JSON.stringify(A.sc));
    const prevMap = A.sc.map;
    A.sc = JSON.parse(A.fut.pop());
    if (A.sc.map !== prevMap) useMap(A.sc.map); else renderAll();
  }
  function draft() { store.set('tacticle:authorDraft', { sc: A.sc, savedJSON: A.savedJSON }); }
  function dirty() { return JSON.stringify(pruned(A.sc)) !== A.savedJSON; }
  function edit(fn) { commit(); fn(); renderAll(); }

  // ------------------------------------------------------------------ map interaction
  function onClick(id, ev) {
    if (!id) { A.selected = null; renderAll(); return; }
    const t = A.T[id];
    switch (A.tool) {
      case 'select': A.selected = id; renderAll(); return;
      case 'playable':
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
        edit(() => { if (!A.sc.playable.includes(id)) setPlayable(id, true); setOwner(id, ev && ev.altKey ? (t.owner || null) : A.brush.power); });
        return;
      case 'units': {
        const d = R().units[A.brush.unit];
        if (!d) return;
        if (t.type === 'sea' && d.domain === 'land' && !(A.sc.setup[id] && A.sc.setup[id].units && A.sc.setup[id].units[A.brush.power] && A.sc.setup[id].units[A.brush.power].transport)) {
          toast('Land units at sea ride on transports: add a transport first');
          return;
        }
        if (t.type === 'land' && d.domain === 'sea') { toast('Ships go in sea zones'); return; }
        if (A.brush.unit === 'factory' && t.type === 'sea') return;
        edit(() => {
          if (!A.sc.playable.includes(id)) setPlayable(id, true);
          const p = A.brush.unit === 'factory' ? (ownerOf(id) || A.brush.power) : A.brush.power;
          if (ev && (ev.ctrlKey || ev.metaKey)) addUnit(id, p, A.brush.unit, -999);
          else addUnit(id, p, A.brush.unit, ev && ev.shiftKey ? 5 : 1);
        });
        return;
      }
      case 'objective': {
        const o = A.sc.objectives[A.brush.obj];
        if (!o) { toast('Add an objective first (Objectives tab)'); return; }
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
  function onContext(id) {
    if (!id) return;
    if (A.tool === 'units') edit(() => addUnit(id, A.brush.unit === 'factory' ? (ownerOf(id) || A.brush.power) : A.brush.power, A.brush.unit, -1));
    else if (A.tool === 'owner') edit(() => setOwner(id, null));
    else if (A.tool === 'playable') edit(() => setPlayable(id, false));
    else { A.selected = id; renderAll(); }
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
    renderHeader();
    renderToolbar();
    renderTab();
    renderInspector();
    renderMap();
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
          list.push({ o: p, t: k, n: us[p][k], dim: !R().units[k] });
        }
      }
      for (const c of list) if (c.t === 'transport' && cargo[c.o]) { c.cargo = cargo[c.o]; cargo[c.o] = 0; }
      units[t.id] = list;
    }
    const objectives = {};
    A.sc.objectives.forEach((o) => o.territories.forEach((id) => { objectives[id] = o.type; }));
    if (A.tool === 'objective' && A.sc.objectives[A.brush.obj]) for (const id of A.sc.objectives[A.brush.obj].territories) hl[id] = 'attack';
    A.mv.update({ owners, units, highlight: hl, selected: A.selected, objectives, playable: play, dimInactive: false, labels: 'playable' });
  }
  function renderToolbar() {
    const h = [];
    if (A.sc.turnOrder && A.sc.turnOrder.length && !A.sc.powers[A.brush.power]) {
      A.brush.power = A.sc.turnOrder.find((p) => A.sc.powers[p].controller === 'human') || A.sc.turnOrder[0];
    }
    h.push('<div class="tgroup">' + TOOLS.map(([k, n, key]) => `<button data-tool="${k}" class="${A.tool === k ? 'on' : ''}" title="${n} (${key})">${n}</button>`).join('') + '</div>');
    const powers = (A.map.powers || []).map((p) => `<option value="${esc(p.id)}" ${A.brush.power === p.id ? 'selected' : ''}>${esc(p.id)}</option>`).join('');
    if (A.tool === 'owner' || A.tool === 'units') {
      h.push(`<div class="tgroup"><span class="swatch" style="margin:0 4px;background:${powerInfo(A.brush.power).color}"></span><select id="brushPower">${powers}</select></div>`);
    }
    if (A.tool === 'units') {
      h.push('<div class="tgroup pal">' + Rules.UNIT_ORDER.filter((t) => R().units[t]).map((t, i) => `<button data-unit="${t}" class="${A.brush.unit === t ? 'on' : ''}" title="${esc(R().units[t].name)} (${i < 9 ? i + 1 : ''})" style="color:${powerInfo(A.brush.power).color}">${I.svg(t, 22)}</button>`).join('') + '</div>');
    }
    if (A.tool === 'objective') {
      h.push('<div class="tgroup"><select id="brushObj">' + A.sc.objectives.map((o, i) => `<option value="${i}" ${A.brush.obj === i ? 'selected' : ''}>#${i + 1} ${o.type} (${o.territories.length})</option>`).join('') + '</select></div>');
    }
    if (A.tool === 'playable') {
      h.push('<div class="tgroup"><button id="tbNb" title="Add every neighbour of the playable land">+ Neighbours</button><button id="tbSea" title="Add sea zones that touch two or more playable coasts">+ Seas</button><button id="tbClr">Clear</button></div>');
    }
    const hint = {
      select: 'Click a territory to inspect and edit it.',
      playable: 'Click toggles. Shift-click adds a territory and all its neighbours. Right-click removes.',
      owner: 'Click sets the owner. Right-click makes it neutral. Alt-click restores the map owner.',
      units: 'Click +1, Shift +5, right-click −1, Ctrl-click clears. Keys 1–9 pick a unit.',
      objective: 'Click toggles a territory in the chosen objective.',
    }[A.tool];
    h.push(`<div class="tgroup" style="padding:4px 8px;font-size:12.5px;color:var(--muted)">${hint}</div>`);
    $('toolbar').innerHTML = h.join('');
    $('toolbar').querySelectorAll('[data-tool]').forEach((b) => b.onclick = () => { A.tool = b.dataset.tool; renderAll(); });
    $('toolbar').querySelectorAll('[data-unit]').forEach((b) => b.onclick = () => { A.brush.unit = b.dataset.unit; renderToolbar(); });
    const bp = $('brushPower'); if (bp) bp.onchange = () => { A.brush.power = bp.value; renderToolbar(); };
    const bo = $('brushObj'); if (bo) bo.onchange = () => { A.brush.obj = +bo.value; renderAll(); };
    const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
    on('tbNb', () => edit(() => {
      for (const id of A.sc.playable.slice()) if (A.T[id].type === 'land') for (const n of A.T[id].adj) if (A.T[n].type === 'land') setPlayable(n, true);
    }));
    on('tbSea', () => edit(() => {
      const play = new Set(A.sc.playable);
      for (const t of A.map.territories) if (t.type === 'sea' && t.adj.filter((y) => play.has(y) && A.T[y].type === 'land').length >= 2) setPlayable(t.id, true);
    }));
    on('tbClr', () => { if (confirm('Remove every territory from play?')) edit(() => { A.sc.playable = []; }); });
  }

  // ------------------------------------------------------------------ inspector
  function renderInspector() {
    const el = $('inspector');
    const id = A.selected;
    if (!id || !A.T[id]) { el.innerHTML = summaryHtml(); bindSummary(); return; }
    const t = A.T[id];
    const play = A.sc.playable.includes(id);
    const o = ownerOf(id);
    const us = (A.sc.setup[id] && A.sc.setup[id].units) || {};
    const h = [];
    h.push(`<div class="h">${t.type === 'sea' ? 'Sea zone' : 'Territory'}</div><h3 style="margin:0">${esc(t.name)}</h3><div class="hint">${esc(id)}${t.ipc ? ' · ' + t.ipc + ' IPC' : ''}${t.capital ? ' · capital of ' + esc(t.capital) : ''} · map owner ${esc(t.owner || '—')}</div>`);
    h.push(`<label class="chk"><input type="checkbox" id="iPlay" ${play ? 'checked' : ''}> Playable</label>`);
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
        h.push(`<div class="urow" style="padding:2px 6px"><span class="ic" style="background:${powerInfo(p).color};width:24px;height:24px">${I.svg(ty, 18, '#fff')}</span><span class="nm" style="font-size:13px">${esc(d.name)}</span><span class="stepper"><button data-iu="${esc(p)}|${ty}|-1">−</button><output>${n}</output><button data-iu="${esc(p)}|${ty}|1">+</button></span></div>`);
      }
      h.push('</div>');
    }
    h.push(`<label class="f">Add units for another power</label><select id="iAddPower"><option value="">—</option>${A.map.powers.filter((p) => !powersHere.includes(p.id)).map((p) => `<option>${esc(p.id)}</option>`).join('')}</select>`);
    h.push('<div class="actions"><button id="iClose">Done</button></div>');
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
    $('iAddPower').onchange = (e) => { if (e.target.value) edit(() => { ensurePower(e.target.value); setupOf(id).units[e.target.value] = setupOf(id).units[e.target.value] || {}; }); };
    $('iClose').onclick = () => { A.selected = null; renderAll(); };
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
      <div class="list">${Object.keys(A.sc.powers).map((p) => `<div class="urow"><span class="swatch" style="background:${powerInfo(p).color}"></span><span class="nm">${esc(p)}<small>${A.sc.powers[p].controller === 'human' ? 'Player' : 'Computer'} · ${A.sc.powers[p].team} · ${A.sc.powers[p].money} IPC</small></span><b title="Army value in IPCs">${val[p] || 0}</b></div>`).join('')}</div>
      <div class="h">Checks</div>${msgs.length ? msgs.map((m) => `<div class="msg ${m.level}">${m.level === 'error' ? '✖' : '⚠'} ${esc(m.msg)}</div>`).join('') : '<div class="msg" style="color:var(--good)">✔ Ready to play</div>'}
      ${A.lastSim ? `<div class="h">Last balance check</div><p class="hint">Computer-as-player won ${Math.round(100 * A.lastSim.won / A.lastSim.games)}% of ${A.lastSim.games} games.</p>` : ''}
      <div class="h">Shortcuts</div><div class="kbd-help"><kbd>S</kbd> select <kbd>P</kbd> playable <kbd>O</kbd> owner <kbd>U</kbd> units <kbd>J</kbd> objective · <kbd>1</kbd>–<kbd>9</kbd> unit · <kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd> undo/redo · <kbd>Ctrl</kbd>+<kbd>S</kbd> save · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> play test</div>`;
  }
  function bindSummary() { /* nothing interactive */ }

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
    if (!A.sc.id) msgs.push({ level: 'warn', msg: 'Give the puzzle an id before saving' });
    return msgs;
  }

  // ------------------------------------------------------------------ tabs
  function renderTab() {
    $('tabs').innerHTML = TABS.map(([k, n]) => `<button data-tab="${k}" class="${A.tab === k ? 'on' : ''}">${n}</button>`).join('');
    $('tabs').querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { A.tab = b.dataset.tab; renderTab(); });
    const fn = { scenario: tabScenario, powers: tabPowers, objectives: tabObjectives, generate: tabGenerate, test: tabTest, schedule: tabSchedule, files: tabFiles }[A.tab];
    $('tabbody').innerHTML = '';
    fn($('tabbody'));
  }
  function field(label, html) { return `<div><label class="f">${label}</label>${html}</div>`; }
  function bindInput(root, sel, fn, ev) {
    const e = root.querySelector(sel);
    if (e) e.addEventListener(ev || 'change', () => fn(e));
  }

  function tabScenario(el) {
    const sc = A.sc;
    el.innerHTML = [
      field('Puzzle id (file name)', `<input type="text" id="sId" value="${esc(sc.id)}" placeholder="e.g. kursk-salient">`),
      field('Title', `<input type="text" id="sTitle" value="${esc(sc.title)}">`),
      field('Briefing', `<textarea id="sDesc">${esc(sc.description)}</textarea><button class="small" id="sAutoDesc" style="margin-top:4px">Write from objectives</button>`),
      '<div class="two">' + field('Author', `<input type="text" id="sAuthor" value="${esc(sc.author)}">`) +
        field('Difficulty label', `<select id="sDiff">${['easy', 'medium', 'hard'].map((d) => `<option ${sc.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select>`) + '</div>',
      field('Map', `<select id="sMap">${A.maps.map((m) => `<option value="${esc(m.id)}" ${m.id === sc.map ? 'selected' : ''}>${esc(m.name)}${m.source ? ' (' + esc(m.source) + ')' : ''}</option>`).join('')}</select>`),
      field('Rules', `<select id="sRules">${Rules.list().map((r) => `<option value="${r.id}" ${r.id === sc.ruleset ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select><div class="hint" style="margin-top:4px">${esc(R().summary)}</div>`),
      '<div class="two">' + field('Max turns', `<input type="number" min="1" max="20" id="sTurns" value="${sc.maxTurns}">`) +
        field('Win check', `<select id="sWin"><option value="turnEnd" ${sc.winCheck !== 'roundEnd' ? 'selected' : ''}>End of player's turn</option><option value="roundEnd" ${sc.winCheck === 'roundEnd' ? 'selected' : ''}>End of round (after counter-attack)</option></select>`) + '</div>',
      `<label class="chk"><input type="checkbox" id="sIncome" ${sc.income !== false ? 'checked' : ''}> Collect income at the end of each turn</label>`,
      `<label class="chk"><input type="checkbox" id="sBuy" ${sc.purchase !== false ? 'checked' : ''}> Allow purchasing units</label>`,
      `<div class="actions"><button id="taBrowse">Browse TripleA maps…</button></div>${A.map.source === 'TripleA' ? `<p class="hint">${esc(A.map.description || '')}</p>` : ''}`,
      '<details style="margin-top:8px"><summary class="hint">Import a TripleA map from files…</summary><p class="hint">For maps you have locally. Pick the game XML (from the map\'s <code>games/</code> folder), <code>polygons.txt</code>, and optionally <code>centers.txt</code> and <code>map.properties</code>.</p>' +
        field('Game XML', '<input type="file" id="taXml" accept=".xml">') + field('polygons.txt', '<input type="file" id="taPoly" accept=".txt">') + field('centers.txt (optional)', '<input type="file" id="taCent" accept=".txt">') + field('map.properties (optional)', '<input type="file" id="taProps" accept=".properties,.txt">') +
        field('Map id', '<input type="text" id="taId" placeholder="e.g. my-triplea-map">') + '<label class="chk"><input type="checkbox" id="taWrap"> Map wraps left-right</label><button id="taGo">Import map</button></details>',
    ].join('');
    const upd = (fn) => edit(fn);
    bindInput(el, '#sId', (e) => upd(() => { sc.id = slug(e.value); }));
    bindInput(el, '#sTitle', (e) => upd(() => { sc.title = e.value; if (!sc.id) sc.id = slug(e.value); }));
    bindInput(el, '#sDesc', (e) => upd(() => { sc.description = e.value; }));
    bindInput(el, '#sAuthor', (e) => upd(() => { sc.author = e.value; }));
    bindInput(el, '#sDiff', (e) => upd(() => { sc.difficulty = e.value; }));
    bindInput(el, '#sMap', (e) => {
      if (A.sc.playable.length && !confirm('Switching maps clears the playable area, owners and units. Continue?')) { renderTab(); return; }
      commit();
      const keep = { title: sc.title, id: sc.id, ruleset: sc.ruleset, description: sc.description, author: sc.author };
      A.sc = Object.assign(newScenario(e.value), keep);
      useMap(e.value);
    });
    bindInput(el, '#sRules', (e) => upd(() => { sc.ruleset = e.value; }));
    bindInput(el, '#sTurns', (e) => upd(() => { sc.maxTurns = Math.max(1, Math.min(20, +e.value || 1)); }));
    bindInput(el, '#sWin', (e) => upd(() => { sc.winCheck = e.value; }));
    bindInput(el, '#sIncome', (e) => upd(() => { sc.income = e.checked; }));
    bindInput(el, '#sBuy', (e) => upd(() => { sc.purchase = e.checked; }));
    $('sAutoDesc').onclick = () => upd(() => { sc.description = autoDescription(); });
    $('taGo').onclick = importTripleA;
    $('taBrowse').onclick = browseTripleA;
  }
  function autoDescription() {
    const sc = A.sc;
    const human = Object.keys(sc.powers).filter((p) => sc.powers[p].controller === 'human');
    const foes = Object.keys(sc.powers).filter((p) => sc.powers[p].controller !== 'human');
    const parts = sc.objectives.map((o) => {
      const names = o.territories.map((id) => A.T[id] ? A.T[id].name : id);
      const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0] || '…';
      return o.type === 'hold' ? `hold ${list}` : o.type === 'destroy' ? `clear the enemy out of ${list}` : `take ${list}`;
    });
    return `As ${human.join(' and ') || 'the player'}, ${parts.join(', then ')} ${foes.length ? 'from ' + foes.join(' and ') + ' ' : ''}within ${sc.maxTurns} turn${sc.maxTurns === 1 ? '' : 's'}.`.replace(/^./, (c) => c.toUpperCase());
  }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64); }

  function tabPowers(el) {
    const sc = A.sc;
    const playLand = sc.playable.filter((id) => A.T[id] && A.T[id].type === 'land');
    const capOpts = (p, pw) => `<option value="">${A.map.territories.find((t) => t.capital === p) ? 'Map default' : 'None'}</option><option value="__none" ${pw.capital === null ? 'selected' : ''}>No capital</option>${playLand.map((id) => `<option value="${id}" ${pw.capital === id ? 'selected' : ''}>${esc(A.T[id].name)}</option>`).join('')}`;
    const cards = (sc.turnOrder || []).filter((p) => sc.powers[p]).map((p, i) => {
      const pw = sc.powers[p];
      return `<div class="objbox"><div class="row"><span class="swatch" style="background:${powerInfo(p).color}"></span><b>${i + 1}. ${esc(p)}</b><div class="grow"></div>
          <button class="small" data-up="${i}" title="Earlier in turn order" ${i ? '' : 'disabled'}>↑</button><button class="small" data-del="${esc(p)}" title="Remove">✕</button></div>
        <div class="two">${field('Played by', `<select data-pw="${esc(p)}" data-k="controller"><option value="human" ${pw.controller === 'human' ? 'selected' : ''}>Player</option><option value="ai" ${pw.controller !== 'human' ? 'selected' : ''}>Computer</option></select>`)}
          ${field('Team', `<select data-pw="${esc(p)}" data-k="team"><option ${pw.team === 'Axis' ? 'selected' : ''}>Axis</option><option ${pw.team === 'Allies' ? 'selected' : ''}>Allies</option></select>`)}
          ${field('Starting IPCs', `<input type="number" min="0" data-pw="${esc(p)}" data-k="money" value="${pw.money || 0}">`)}
          ${field('Capital', `<select data-pw="${esc(p)}" data-k="capital">${capOpts(p, pw)}</select>`)}</div></div>`;
    }).join('');
    el.innerHTML = `<p class="hint">Cards are in turn order. The player controls every “Player” power (they must share a team). Losing the capital stops income; capturing one takes its treasury.</p>
      ${cards}
      ${field('Add a power', `<select id="pwAdd"><option value="">—</option>${A.map.powers.filter((p) => !sc.powers[p.id]).map((p) => `<option>${esc(p.id)}</option>`).join('')}</select>`)}
      <div class="actions"><button id="pwDefault">Sort by the map's turn order</button></div>`;
    el.querySelectorAll('[data-pw]').forEach((c) => c.onchange = () => edit(() => {
      const p = c.dataset.pw, k = c.dataset.k;
      if (k === 'money') sc.powers[p].money = Math.max(0, +c.value || 0);
      else if (k === 'capital') { if (c.value === '') delete sc.powers[p].capital; else sc.powers[p].capital = c.value === '__none' ? null : c.value; }
      else sc.powers[p][k] = c.value;
    }));
    el.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => edit(() => {
      const i = +b.dataset.up;
      if (i > 0) { const o = sc.turnOrder; [o[i - 1], o[i]] = [o[i], o[i - 1]]; }
    }));
    el.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => edit(() => {
      const p = b.dataset.del;
      delete sc.powers[p];
      sc.turnOrder = sc.turnOrder.filter((x) => x !== p);
      for (const id of Object.keys(sc.setup)) { if (sc.setup[id].owner === p) sc.setup[id].owner = null; if (sc.setup[id].units) delete sc.setup[id].units[p]; }
    }));
    $('pwAdd').onchange = (e) => { if (e.target.value) edit(() => ensurePower(e.target.value)); };
    $('pwDefault').onclick = () => edit(() => { const o = mapOrder(); sc.turnOrder.sort((a, b) => idxOr(o, a) - idxOr(o, b)); });
  }

  function tabObjectives(el) {
    const sc = A.sc;
    el.innerHTML = `<p class="hint">Pick an objective, switch to the Objective tool (<kbd>J</kbd>) and click territories on the map.</p>` +
      sc.objectives.map((o, i) => `<div class="objbox ${A.brush.obj === i ? 'on' : ''}"><div class="row"><b>#${i + 1}</b>
        <select data-otype="${i}" style="width:auto">${[['capture', 'Capture (control at the check)'], ['hold', 'Hold (never lose, through the last turn)'], ['destroy', 'Clear (no enemy units left)']].map(([k, n]) => `<option value="${k}" ${o.type === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <div class="grow"></div><button class="small" data-opick="${i}">Edit on map</button><button class="small" data-odel="${i}">✕</button></div>
        <div class="chips">${o.territories.map((id) => `<span class="chipx">${esc(A.T[id] ? A.T[id].name : id)}<button data-orm="${i}|${id}">✕</button></span>`).join('') || '<span class="hint">No territories yet</span>'}</div></div>`).join('') +
      `<div class="actions"><button id="oAdd">+ Add objective</button></div>
      <p class="hint">The player wins when every objective is met at the check (Scenario tab). With a Hold objective the game runs to the last turn, and losing a held territory at the end of any turn loses.</p>`;
    el.querySelectorAll('[data-otype]').forEach((s) => s.onchange = () => edit(() => { sc.objectives[+s.dataset.otype].type = s.value; }));
    el.querySelectorAll('[data-opick]').forEach((b) => b.onclick = () => { A.brush.obj = +b.dataset.opick; A.tool = 'objective'; renderAll(); });
    el.querySelectorAll('[data-odel]').forEach((b) => b.onclick = () => edit(() => { sc.objectives.splice(+b.dataset.odel, 1); A.brush.obj = 0; }));
    el.querySelectorAll('[data-orm]').forEach((b) => b.onclick = () => edit(() => { const [i, id] = b.dataset.orm.split('|'); sc.objectives[+i].territories = sc.objectives[+i].territories.filter((x) => x !== id); }));
    $('oAdd').onclick = () => edit(() => { sc.objectives.push({ type: 'capture', territories: [] }); A.brush.obj = sc.objectives.length - 1; A.tool = 'objective'; });
  }

  function tabGenerate(el) {
    const g = A.genOpts || (A.genOpts = { theater: 'eastern', size: 9, difficulty: 'medium', naval: false, playerTeam: 'any', tune: 16, ruleset: A.sc.ruleset });
    el.innerHTML = `<p class="hint">Builds a puzzle around a front line on the ${esc(A.map.name)} map, then plays it computer-vs-computer and adjusts the armies toward a target win rate. Runs in the background.</p>` +
      field('Theatre', `<select id="gTh">${Object.keys(GEN.THEATERS).map((k) => `<option value="${k}" ${g.theater === k ? 'selected' : ''}>${esc(GEN.THEATERS[k].name)}</option>`).join('')}<option value="__sel" ${g.theater === '__sel' ? 'selected' : ''}>Around the selected territory</option></select>`) +
      '<div class="two">' + field('Land territories', `<input type="number" id="gSize" min="4" max="30" value="${g.size}">`) +
      field('Difficulty', `<select id="gDiff">${['easy', 'medium', 'hard'].map((d) => `<option ${g.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select>`) + '</div>' +
      '<div class="two">' + field('Player side', `<select id="gTeam"><option value="any">Either</option><option ${g.playerTeam === 'Axis' ? 'selected' : ''}>Axis</option><option ${g.playerTeam === 'Allies' ? 'selected' : ''}>Allies</option></select>`) +
      field('Balance games', `<input type="number" id="gTune" min="0" max="60" value="${g.tune}" title="AI self-play games per tuning step (0 = skip)">`) + '</div>' +
      `<label class="chk"><input type="checkbox" id="gNaval" ${g.naval ? 'checked' : ''}> Include sea zones, fleets and transports</label>
      ${A.map.defaultSetup ? `<label class="chk"><input type="checkbox" id="gMapUnits" ${g.mapUnits !== false ? 'checked' : ''}> Use this map's starting armies (tune the turn limit and reinforcements)</label>` : ''}
      <div class="actions"><button class="primary" id="gNew">Generate new</button><button id="gVar">Variant of current</button></div>
      <div class="bar"><div id="gBar"></div></div><div id="gOut" class="hint"></div>`;
    const read = () => {
      g.theater = $('gTh').value; g.size = +$('gSize').value || 9; g.difficulty = $('gDiff').value; g.playerTeam = $('gTeam').value;
      g.tune = Math.max(0, +$('gTune').value || 0); g.naval = $('gNaval').checked; g.ruleset = A.sc.ruleset;
      g.mapUnits = $('gMapUnits') ? $('gMapUnits').checked : false;
    };
    $('gNew').onclick = async () => {
      read();
      const opts = Object.assign({}, g, { seed: E.randomSeed() });
      if (g.theater === '__sel') {
        if (!A.selected) { toast('Select a territory first (Select tool)'); return; }
        opts.theater = 'any'; opts.center = A.selected;
      }
      $('gOut').textContent = 'Generating…';
      $('gBar').style.width = '30%';
      const r = await job({ cmd: 'generate', opts });
      $('gBar').style.width = '100%';
      if (!r.ok) { $('gOut').textContent = r.error; return; }
      loadScenario(r.sc, true);
      $('gOut').textContent = `Done: “${r.sc.title}”. Computer-as-player win rate ${r.sc.generator.winRate != null ? Math.round(r.sc.generator.winRate * 100) + '%' : 'not measured'}. Edit freely, then give it an id and save.`;
    };
    $('gVar').onclick = async () => {
      read();
      if (!A.sc.playable.length) { toast('Nothing to vary yet'); return; }
      $('gOut').textContent = 'Making a variant…';
      $('gBar').style.width = '30%';
      const r = await job({ cmd: 'variant', sc: pruned(A.sc), opts: { seed: E.randomSeed(), tune: g.tune } });
      $('gBar').style.width = '100%';
      if (!r.ok) { $('gOut').textContent = r.error; return; }
      r.sc.id = '';
      loadScenario(r.sc, true);
      $('gOut').textContent = `Variant ready (win rate ${r.sc.generator && r.sc.generator.winRate != null ? Math.round(r.sc.generator.winRate * 100) + '%' : '?'}). Give it a new id before saving.`;
    };
  }

  function tabTest(el) {
    el.innerHTML = `<p class="hint">Play the current scenario in a new tab exactly as players will see it (progress is kept separately from the daily save).</p>
      <div class="actions"><button class="primary" id="tPlay">▶ Play test</button><button id="tShare">Preview share text</button></div>
      <div class="h">Balance check</div><p class="hint">The computer plays your side against the computer opponent. A thoughtful human usually does better than this.</p>
      <div class="row">${field('Games', '<input type="number" id="tGames" value="30" min="5" max="200" style="width:90px">')}</div>
      <div class="actions"><button id="tRun">Run</button></div><div class="bar"><div id="tBar"></div></div><div id="tOut"></div>
      <div class="h">Battle odds</div><p class="hint">Attackers vs defenders as counts, e.g. <code>3 infantry, 1 tank</code>.</p>
      ${field('Attackers', '<input type="text" id="oA" value="3 infantry, 1 artillery, 1 tank">')}${field('Defenders', '<input type="text" id="oD" value="3 infantry">')}
      <label class="chk"><input type="checkbox" id="oSea"> Sea battle</label><div class="actions"><button id="oRun">Calculate</button></div><div id="oOut" class="hint"></div>`;
    $('tPlay').onclick = playTest;
    $('tShare').onclick = () => {
      const txt = D.shareText({ number: 1, title: A.sc.title, won: true, turns: Math.min(2, A.sc.maxTurns), maxTurns: A.sc.maxTurns, objectivesDone: 1, objectivesTotal: 1, history: [{ progress: 0.5 }, { progress: 1 }], luckYou: { dice: 10, diff: 1.2 }, luckFoe: { dice: 8, diff: -0.6 }, url: location.origin + location.pathname.replace(/author\.html$/, '') });
      dialog(`<h2>Share text preview</h2><div class="share">${esc(txt)}</div><p class="hint">Example values; the real numbers come from the game.</p><div class="actions"><button class="primary" data-close>Close</button></div>`);
    };
    $('tRun').onclick = async () => {
      const games = Math.max(5, Math.min(200, +$('tGames').value || 30));
      const errs = validate().filter((m) => m.level === 'error');
      if (errs.length) { $('tOut').innerHTML = `<div class="msg error">${esc(errs[0].msg)}</div>`; return; }
      $('tOut').textContent = 'Running…';
      const r = await job({ cmd: 'selfplay', sc: pruned(A.sc), games, seed: E.randomSeed() }, (p) => { $('tBar').style.width = Math.round(p * 100) + '%'; });
      if (!r.ok) { $('tOut').textContent = r.error; return; }
      A.lastSim = r.result;
      const res = r.result;
      $('tOut').innerHTML = `<p><b>${Math.round(100 * res.won / res.games)}%</b> of ${res.games} games won by the computer playing your side.</p>
        <p class="hint">Wins by turn: ${Object.keys(res.turns).sort().map((k) => `${k}: ${res.turns[k]}`).join(' · ') || '—'}</p>
        <p class="hint">${Object.keys(res.reasons).map((k) => `${esc(k)} ×${res.reasons[k]}`).join('<br>')}</p>`;
      renderInspector();
    };
    $('oRun').onclick = () => {
      const parse = (s) => { const o = {}; for (const part of s.split(',')) { const m = /(\d+)\s*([a-z]+)/i.exec(part.trim()); if (m) { const t = Object.keys(R().units).find((k) => k.startsWith(m[2].toLowerCase()) || R().units[k].name.toLowerCase().startsWith(m[2].toLowerCase())); if (t) o[t] = (o[t] || 0) + +m[1]; } } return o; };
      const a = parse($('oA').value), d = parse($('oD').value);
      const r = E.simulate(a, d, { sea: $('oSea').checked, ruleset: A.sc.ruleset, trials: 2000, seed: E.randomSeed() });
      $('oOut').innerHTML = `Attacker wins <b>${Math.round(r.win * 100)}%</b>, defender holds ${Math.round(r.lose * 100)}%, stalemate ${Math.round(r.draw * 100)}%.<br>Average losses: attacker ${r.attLoss.toFixed(1)} IPC, defender ${r.defLoss.toFixed(1)} IPC.`;
    };
  }
  function playTest() {
    const errs = validate().filter((m) => m.level === 'error');
    if (errs.length) { toast(errs[0].msg, 3500); return; }
    store.set('tacticle:test', pruned(A.sc));
    window.open('index.html?test&fresh', 'tacticle-test');
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
    const opts = (sel) => `<option value="">—</option>` + A.puzzles.map((p) => `<option value="${esc(p.file)}" ${sel === p.file ? 'selected' : ''}>${esc(p.id)}${used[p.file] ? ' ✓' : ''}</option>`).join('') + (sel && !files.includes(sel) ? `<option selected value="${esc(sel)}">${esc(sel)} (missing)</option>` : '');
    el.innerHTML = `<p class="hint">One puzzle per day, by the player's local date. Puzzle numbers count from the first day. Saved puzzles marked ✓ are already scheduled.</p>
      ${field('First day (puzzle #1)', `<input type="date" id="schEpoch" value="${esc(sch.epoch || today)}">`)}
      <div class="actions"><button class="small" id="schPrev">← 4 weeks</button><button class="small" id="schToday">Today</button><button class="small" id="schNext">4 weeks →</button></div>
      <div class="actions"><button class="small" id="schFill">Fill empty days with unscheduled puzzles</button><button class="small" id="schAdd">Schedule current puzzle on…</button></div>
      <table class="sched">${days.map((d) => {
        const dt = D.parse(d);
        const n = D.number({ epoch: sch.epoch || today }, d);
        return `<tr class="${d === today ? 'today' : d < today ? 'past' : ''}"><td>${dt.toLocaleDateString(undefined, { weekday: 'short' })}</td><td>${d}</td><td>${n >= 1 ? '#' + n : ''}</td><td><select data-day="${d}">${opts(sch.days[d])}</select></td></tr>`;
      }).join('')}</table>
      <div class="actions"><button class="primary" id="schSave">Save schedule</button></div>`;
    el.querySelectorAll('[data-day]').forEach((s) => s.onchange = () => { if (s.value) sch.days[s.dataset.day] = s.value; else delete sch.days[s.dataset.day]; A.schedDirty = true; renderTab(); });
    $('schEpoch').onchange = (e) => { sch.epoch = e.target.value; A.schedDirty = true; renderTab(); };
    $('schPrev').onclick = () => { A.schedFrom = D.addDays(start, -28); renderTab(); };
    $('schNext').onclick = () => { A.schedFrom = D.addDays(start, 28); renderTab(); };
    $('schToday').onclick = () => { A.schedFrom = null; renderTab(); };
    $('schFill').onclick = () => {
      const unused = A.puzzles.filter((p) => !used[p.file] && !p.error).map((p) => p.file);
      let d = today, n = 0;
      while (unused.length && n < 400) { if (!sch.days[d]) { sch.days[d] = unused.shift(); } d = D.addDays(d, 1); n++; }
      A.schedDirty = true;
      renderTab();
    };
    $('schAdd').onclick = () => {
      const p = A.puzzles.find((x) => x.id === A.sc.id);
      if (!p) { toast('Save the current puzzle first'); return; }
      const d = prompt('Date (YYYY-MM-DD)', firstFree(today));
      if (!d || !/^\d{4}-\d\d-\d\d$/.test(d)) return;
      sch.days[d] = p.file; A.schedDirty = true; renderTab();
    };
    $('schSave').onclick = saveSchedule;
  }
  function firstFree(from) { let d = from; while (A.schedule.days[d]) d = D.addDays(d, 1); return d; }

  function tabFiles(el) {
    el.innerHTML = `<div class="actions"><button id="fNew">New</button><button id="fSaveAs">Save as…</button><button id="fDl">Download JSON</button><label class="small" style="border:1px solid var(--line);border-radius:8px;padding:3px 8px;cursor:pointer">Open JSON…<input type="file" id="fOpen" accept=".json" hidden></label></div>
      <p class="hint">${A.server ? 'Saving writes <code>puzzles/&lt;id&gt;.json</code> through the local server.' : A.dir ? 'Saving writes into the connected folder.' : 'No local server. Run <code>node tools/serve.js</code> in the repository, or connect the repository folder (Chrome/Edge), or download files and copy them into <code>puzzles/</code>.'}</p>
      ${!A.server && window.showDirectoryPicker ? `<div class="actions"><button id="fDir">${A.dir ? 'Folder connected ✓' : 'Connect repository folder…'}</button></div>` : ''}
      <div class="h">Saved puzzles (${A.puzzles.length})</div>
      <div class="list plist">${A.puzzles.map((p) => `<div class="urow ${p.id === A.sc.id ? 'cur' : ''}"><span class="nm">${esc(p.title || p.id)}<small>${esc(p.id)} · ${esc(p.map || '')} · ${esc(p.ruleset || '')} · ${p.maxTurns || '?'} turns${Object.values(A.schedule.days).includes(p.file) ? ' · scheduled' : ''}</small></span><button class="small" data-load="${esc(p.file)}">Open</button>${A.server ? `<button class="small" data-delp="${esc(p.id)}">✕</button>` : ''}</div>`).join('') || '<p class="hint">None yet.</p>'}</div>`;
    $('fNew').onclick = () => { if (dirty() && !confirm('Discard unsaved changes?')) return; commit(); loadScenario(newScenario(A.map.id), false); A.savedJSON = null; renderAll(); };
    $('fSaveAs').onclick = () => { const id = slug(prompt('New puzzle id', A.sc.id ? A.sc.id + '-2' : slug(A.sc.title)) || ''); if (id) { edit(() => { A.sc.id = id; }); save(); } };
    $('fDl').onclick = () => download((A.sc.id || 'puzzle') + '.json', JSON.stringify(pruned(A.sc), null, 2));
    $('fOpen').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const sc = JSON.parse(await f.text()); loadScenario(sc, true); } catch (err) { toast('Not a scenario: ' + err.message); }
    };
    const fd = $('fDir'); if (fd) fd.onclick = async () => { try { A.dir = await window.showDirectoryPicker({ mode: 'readwrite' }); toast('Folder connected'); renderTab(); } catch (e) { /* cancelled */ } };
    el.querySelectorAll('[data-load]').forEach((b) => b.onclick = async () => {
      if (dirty() && !confirm('Discard unsaved changes?')) return;
      try { const sc = await getJSON(b.dataset.load); loadScenario(sc, false); A.savedJSON = JSON.stringify(pruned(A.sc)); renderAll(); } catch (e) { toast(e.message); }
    });
    el.querySelectorAll('[data-delp]').forEach((b) => b.onclick = async () => {
      if (!confirm(`Delete puzzle ${b.dataset.delp}? Scheduled days that use it will be cleared.`)) return;
      await fetch('api/puzzles/' + b.dataset.delp, { method: 'DELETE' });
      for (const d of Object.keys(A.schedule.days)) if (A.schedule.days[d] === `puzzles/${b.dataset.delp}.json`) delete A.schedule.days[d];
      await refreshPuzzles();
      await saveSchedule(true);
      renderTab();
    });
  }

  async function loadScenario(sc, markDirty) {
    commit();
    sc = Object.assign(newScenario(sc.map), sc);
    sc.setup = sc.setup || {};
    sc.objectives = sc.objectives && sc.objectives.length ? sc.objectives : [{ type: 'capture', territories: [] }];
    const mapChanged = !A.map || sc.map !== A.map.id;
    A.sc = sc;
    A.selected = null;
    A.brush.obj = 0;
    if (mapChanged) await useMap(sc.map);
    A.mv.setFocus(sc.playable.length ? sc.playable : null);
    if (!markDirty) A.savedJSON = JSON.stringify(pruned(sc));
    renderAll();
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
  async function save() {
    const sc = A.sc;
    if (!sc.id) {
      const id = slug(prompt('Puzzle id (used as the file name)', slug(sc.title)) || '');
      if (!id) return;
      edit(() => { sc.id = id; });
    }
    const errs = validate().filter((m) => m.level === 'error');
    if (errs.length && !confirm(`This puzzle has problems:\n• ${errs.map((e) => e.msg).join('\n• ')}\n\nSave anyway?`)) return;
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
      await refreshPuzzles();
      renderAll();
    } catch (e) { toast('Save failed: ' + e.message, 4000); }
  }
  async function saveSchedule(quiet) {
    const text = JSON.stringify({ epoch: A.schedule.epoch, days: sortObj(A.schedule.days) }, null, 2);
    try {
      if (A.server) {
        const r = await fetch('api/schedule', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text });
        if (!r.ok) throw new Error((await r.json()).error);
      } else if (A.dir) await writeFile(['schedule.json'], text);
      else download('schedule.json', text);
      A.schedDirty = false;
      if (!quiet) toast(A.server || A.dir ? 'Schedule saved' : 'Downloaded schedule.json; put it in the repository root');
    } catch (e) { toast('Could not save schedule: ' + e.message); }
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
  async function browseTripleA() {
    dialog('<h2>TripleA maps</h2><p class="hint">Loading the catalogue from GitHub…</p>');
    try { A.taIndex = A.taIndex || await TA.listMaps(fetchText); } catch (e) { dialog(`<h2>TripleA maps</h2><p class="err">Could not load the catalogue: ${esc(e.message)}</p><div class="actions"><button data-close>Close</button></div>`); return; }
    const st = A.taState || (A.taState = { q: '', cat: 'BEST' });
    const draw = () => {
      const q = st.q.toLowerCase();
      const list = A.taIndex.filter((m) => (st.cat === 'all' || m.category === st.cat) && (!q || (m.name + ' ' + m.text).toLowerCase().includes(q)));
      const have = new Set(A.maps.map((m) => m.origin && m.origin.repo).filter(Boolean));
      $('taList').innerHTML = list.slice(0, 80).map((m) => `<div class="urow" style="align-items:flex-start"><span class="nm">${esc(m.name)} <small>${esc(m.category || 'uncategorised')}${have.has(m.repo) ? ' · imported' : ''} — ${esc(m.text.slice(0, 160))}${m.text.length > 160 ? '…' : ''}</small></span><button class="small" data-ta="${esc(m.repo)}">Games…</button></div>`).join('') || '<p class="hint">No maps match.</p>';
      $('taCount').textContent = `${list.length} of ${A.taIndex.length} maps`;
      $('taList').querySelectorAll('[data-ta]').forEach((b) => b.onclick = () => chooseTripleA(A.taIndex.find((m) => m.repo === b.dataset.ta)));
    };
    dialog(`<h2>TripleA maps</h2><p class="hint">The catalogue TripleA's “Download maps” screen uses. Importing reads the map's text files (borders, connections, values, owners, starting units); no images. Credit the map's authors when you publish puzzles on it.</p>
      <div class="row"><input type="text" id="taQ" placeholder="Search, e.g. 1942, pacific, europe" value="${esc(st.q)}"><select id="taCat" style="width:auto">${['BEST', 'GOOD', 'EXPERIMENTAL', 'all'].map((c) => `<option ${st.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <p class="hint" id="taCount"></p><div class="list" id="taList" style="max-height:52vh;overflow:auto"></div>
      <div class="actions"><button data-close>Close</button></div>`);
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
        const id = slug(games.length === 1 ? entry.repo : g.name).replace(/-/g, '_');
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
      A.maps.push({ id, name: map.name, file: 'maps/' + id + '.json' });
      toast('Downloaded; copy it into maps/ and add it to maps/index.json', 4000);
    }
    dialog(`<h2>Imported “${esc(map.name)}”</h2><p>${map.territories.length} territories, ${map.powers.length} powers${A.server ? `, saved as <code>maps/${esc(id)}.json</code>` : ''}.</p>${map.warnings.length ? '<p class="hint">' + map.warnings.slice(0, 6).map(esc).join('<br>') + '</p>' : ''}<div class="actions"><button data-close>Close</button><button class="primary" id="taUse">Start a puzzle on it</button></div>`);
    $('taUse').onclick = () => {
      if (dirty() && !confirm('Start a new puzzle on this map? Unsaved changes to the current one will be lost.')) return;
      closeDialog(); commit(); A.sc = newScenario(id);
      if (A.server) useMap(id); else useMapObject(map);
    };
  }
  function useMapObject(map) {
    A.map = map;
    A.T = {};
    for (const t of map.territories) A.T[t.id] = t;
    if (A.mv) A.mv.destroy();
    A.mv = new window.TacticleMapView($('map'), map, { onClick, onContext, onHover });
    A.mv.setFocus(null);
    renderAll();
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
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(A.toastT);
    A.toastT = setTimeout(() => t.classList.remove('on'), ms || 2400);
  }
  function dialog(html) {
    $('dialog').innerHTML = html;
    $('modal').classList.add('open');
    $('dialog').querySelectorAll('[data-close]').forEach((b) => b.onclick = closeDialog);
  }
  function closeDialog() { $('modal').classList.remove('open'); }

  function wire() {
    $('bUndo').onclick = undo;
    $('bRedo').onclick = redo;
    $('bSave').onclick = save;
    $('bTest').onclick = playTest;
    $('zin').onclick = () => A.mv.zoom(0.7);
    $('zout').onclick = () => A.mv.zoom(1.4);
    $('zfit').onclick = () => A.mv.setFocus(A.sc.playable.length ? A.sc.playable : null);
    $('zworld').onclick = () => A.mv.setFocus(null);
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeDialog(); });
    window.addEventListener('beforeunload', (e) => { if (dirty() || A.schedDirty) { e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); playTest(); return; }
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tool = TOOLS.find((t) => t[2].toLowerCase() === e.key.toLowerCase());
      if (tool) { A.tool = tool[0]; renderAll(); return; }
      if (/^[1-9]$/.test(e.key)) {
        const list = Rules.UNIT_ORDER.filter((t) => R().units[t]);
        const u = list[+e.key - 1];
        if (u) { A.brush.unit = u; A.tool = 'units'; renderAll(); }
      }
      if (e.key === 'Escape') { A.selected = null; closeDialog(); renderAll(); }
    });
  }

  window.TacticleAuthor = { A, save, loadScenario, renderAll };
  boot();
})();
