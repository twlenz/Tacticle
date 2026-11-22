/* Tacticle player page. */
(function () {
  'use strict';
  const E = window.TacticleEngine, TAI = window.TacticleAI, Rules = window.TacticleRules, D = window.TacticleDaily, I = window.TacticleIcons;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const S = {
    map: null, sc: null, g: null, ai: null, mv: null, date: null, number: null, key: null, test: false,
    sel: null, dest: {}, undo: [], busy: false, fast: false, placeType: null, edit: null, anim: {}, retreat: null,
  };

  // ------------------------------------------------------------------ boot
  async function boot() {
    applyTheme(store.get('tacticle:theme'));
    const qs = new URLSearchParams(location.search);
    S.test = qs.has('test');
    try {
      if (S.test) {
        S.sc = store.get('tacticle:test');
        if (!S.sc) throw new Error('No test scenario. Use “Play test” in the authoring tool.');
        S.date = 'test';
        S.key = 'tacticle:testsave:' + (S.sc.id || 'x');
        if (qs.has('fresh')) { store.del(S.key); history.replaceState(null, '', location.pathname + '?test'); }
      } else {
        const schedule = await getJSON('schedule.json');
        const today = D.today();
        let want = qs.get('date') || today;
        if (want > today) want = today;
        const entry = D.entryFor(schedule, want, false);
        if (!entry) throw new Error('No puzzle is scheduled yet. Come back soon!');
        S.date = entry.date;
        S.number = D.number(schedule, entry.date);
        if (entry.replay) S.replayOf = { date: entry.from, number: D.number(schedule, entry.from) };
        // only ever load puzzles from this site's puzzles/ folder
        if (!/^puzzles\/[a-z0-9][a-z0-9_-]{0,63}\.json$/i.test(entry.file)) throw new Error('The schedule points at an invalid puzzle file');
        S.sc = await getJSON(entry.file);
        S.key = `tacticle:save:${S.date}:${S.sc.id}`;
      }
      S.map = await loadMap(S.sc.map);
    } catch (e) {
      $('panel').innerHTML = `<p class="err">${esc(e.message)}</p>`;
      $('status').textContent = '';
      return;
    }
    $('puzzleNo').textContent = S.test ? 'test' + (S.sc.testAs === 'opponent' ? ' · you play the opponent' : S.sc.testAs === 'both' ? ' · you play both sides' : '') : `#${S.number} · ${S.date}`;
    S.puzzleLabel = $('puzzleNo').textContent;
    document.title = `Tacticle ${S.test ? '(test)' : '#' + S.number}`;
    S.dailyKey = S.key;
    S.mode = 'daily';
    const m = store.get('tacticle:mode');
    if (!S.test && m && m.mode === 'free' && m.date === S.date && m.id === S.sc.id && dailyDone()) { S.mode = 'free'; S.key = freeKey(); }
    const saved = store.get(S.key);
    loadGame(S.key);
    S.mv = new window.TacticleMapView($('map'), S.map, { onClick, onContext: () => clearSel(), onHover, onDblClick });
    S.mv.setFocus(S.sc.playable);
    S.fullFocus = true;
    if ($('map').clientWidth < 600) {
      // phones: start on the objectives and what borders them
      const objs = (S.sc.objectives || []).flatMap((o) => o.territories || []);
      const near = new Set(objs);
      for (const id of objs) for (const n of (S.mv.T[id] ? S.mv.T[id].adj : [])) if (S.sc.playable.includes(n) && S.mv.T[n].type === 'land') near.add(n);
      if (near.size) { S.mv.setFocus([...near], 0.04); S.fullFocus = false; }
    }
    wire();
    render();
    if (!saved && S.g.phase !== 'gameOver') showBriefing();
    else if (S.g.phase === 'gameOver') showResult();
    else continueFlow();
  }

  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Could not load ${url} (${r.status})`);
    return r.json();
  }
  async function loadMap(id) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(String(id))) throw new Error('Invalid map id in puzzle');
    let file = `maps/${id}.json`;
    try {
      const idx = await getJSON('maps/index.json');
      const m = (idx.maps || []).find((x) => x.id === id);
      if (m && /^maps\/[a-z0-9][a-z0-9_-]{0,63}\.json$/i.test(m.file)) file = m.file;
    } catch (e) { /* default path */ }
    try { return await getJSON(file); } catch (e) {
      // a play test may run on a map imported in the authoring tool and kept only in this browser
      const local = S.test && window.TacticleLocalMaps ? await window.TacticleLocalMaps.get(id) : null;
      if (local) return local;
      throw e;
    }
  }

  // ---------------------------------------------------------------- daily game vs free play
  function freeKey() { return `tacticle:free:${S.date}:${S.sc.id}`; }
  function dailyDone() {
    const sv = store.get(S.dailyKey);
    return !!(sv && sv.state && sv.state.phase === 'gameOver');
  }
  /** Load the game saved under `key` (or start a new one) and make it current. */
  function loadGame(key, fresh) {
    const saved = fresh ? null : store.get(key);
    S.key = key;
    if (saved && saved.state && saved.v === 1) {
      S.g = new E.Game(S.map, S.sc, saved.state);
      S.undo = saved.undo || [];
    } else {
      S.g = E.Game.create(S.map, S.sc, {});
      S.undo = [];
      save();
    }
    S.g.s.uiHold = true;
    S.g.s.autoCasualties = true;
    S.ai = new TAI(S.g, TAI.opponentOptions(S.sc));
    S.sel = null; S.dest = {}; S.unload = {}; S.part = {}; S.placeType = null; S.edit = null; S.anim = {}; S.retreat = null;
    $('puzzleNo').textContent = (S.puzzleLabel || '') + (S.mode === 'free' ? ' · free play' : '');
  }
  async function enterFreePlay(fresh) {
    if (S.test || S.busy || !dailyDone()) return;
    if (fresh && S.mode === 'free' && G().phase !== 'gameOver' && !await ask('Reset the board?', '<p>Start a new free-play game from the beginning.</p>', 'Reset', 'Keep playing')) return;
    S.mode = 'free';
    store.set('tacticle:mode', { mode: 'free', date: S.date, id: S.sc.id });
    loadGame(freeKey(), fresh);
    closeModal();
    render();
    toast(fresh ? 'New free-play game: try anything, it does not affect your stats' : 'Free play');
    continueFlow();
  }
  function exitFreePlay() {
    if (S.busy) return;
    S.mode = 'daily';
    store.set('tacticle:mode', { mode: 'daily', date: S.date, id: S.sc.id });
    loadGame(S.dailyKey);
    closeModal();
    render();
    showResult();
  }

  function save() {
    if (!S.g) return;
    const ok = store.set(S.key, { v: 1, state: S.g.s, undo: S.undo.slice(-12), at: Date.now() });
    if (!ok) S.undo = S.undo.slice(-3);
  }
  function snapshot() {
    const s = Object.assign({}, S.g.s);
    const logLen = s.log.length;
    delete s.log;
    return { s: E.clone(s), logLen };
  }
  function pushUndo() { S.undo.push(snapshot()); if (S.undo.length > 12) S.undo.shift(); }
  function undo() {
    const u = S.undo.pop();
    if (!u) return;
    const log = S.g.s.log.slice(0, u.logLen);
    S.g.s = u.s;
    S.g.s.log = log;
    clearSel(true);
    save();
    render();
  }

  function wire() {
    $('zin').onclick = () => S.mv.zoom(0.7);
    $('zout').onclick = () => S.mv.zoom(1.4);
    $('zfit').onclick = () => { if (S.fullFocus) S.mv.fit(); else { S.mv.setFocus(S.sc.playable); S.fullFocus = true; } };
    $('btnHelp').onclick = showHelp;
    $('btnStats').onclick = showStats;
    $('btnTheme').onclick = () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const dark = cur === 'dark'; // light unless the player chose dark
      applyTheme(dark ? 'light' : 'dark');
      store.set('tacticle:theme', dark ? 'light' : 'dark');
    };
    $('btnFast').onclick = () => { S.fast = true; };
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal') && S.modalClosable) closeModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if ($('modal').classList.contains('open') && S.modalClosable) closeModal(); else clearSel(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); if (canUndo()) undo(); }
    });
  }
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t);
  }

  // ------------------------------------------------------------------ helpers
  const G = () => S.g;
  function humanTurn() { const g = G(); return g.phase !== 'gameOver' && !g.s.powers[g.current()].ai; }
  /** A play test from the authoring tool in which the person plays the opponent's side. */
  function asOpponent() { return S.test && S.sc.testAs === 'opponent'; }
  /** The result headline. Results are the puzzle player's; a test as the opponent reads them the other way round. */
  function verdict(won) {
    if (asOpponent()) return won ? '💀 Defeat: the player side won' : '🏆 Victory: you stopped the player side';
    return won ? '🏆 Victory' : '💀 Defeat';
  }
  function color(p) { return (S.map.powers.find((x) => x.id === p) || {}).color || '#888'; }
  function uname(t) { return (G().R.units[t] || {}).name || t; }
  function canUndo() { return humanTurn() && S.undo.length > 0 && ['combatMove', 'noncombatMove', 'place'].includes(G().phase) && !G().s.battle && !S.retreat; }
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(S.toastT);
    S.toastT = setTimeout(() => t.classList.remove('on'), ms || 2200);
  }
  function humanPowers() { return Object.keys(G().s.powers).filter((p) => !G().s.powers[p].ai); }
  function humanTeam() { return G().humanTeam(); }
  function foeTeam() {
    const ht = humanTeam();
    const t = Object.values(G().s.powers).map((p) => p.team).find((x) => x !== ht);
    return t || (ht === 'Axis' ? 'Allies' : 'Axis');
  }

  // ------------------------------------------------------------------ selection
  function groupsAt(id) {
    const g = G();
    const out = {};
    for (const u of g.movable(id)) {
      const d = g.def(u);
      const key = `${u.t}|${u.tr ? 'c' : ''}|${d.domain === 'air' || d.move > 1 ? u.ml : ''}`;
      if (!out[key]) out[key] = { key, t: u.t, cargo: !!u.tr, ml: u.ml, ids: [] };
      out[key].ids.push(u.id);
    }
    const order = Rules.UNIT_ORDER;
    return Object.values(out).sort((a, b) => (a.cargo - b.cargo) || order.indexOf(a.t) - order.indexOf(b.t) || b.ml - a.ml);
  }
  function selectAt(id, all) {
    const groups = groupsAt(id);
    if (!groups.length) return false;
    const n = {};
    const anyShip = groups.some((x) => !x.cargo);
    for (const gr of groups) n[gr.key] = gr.cargo && anyShip ? 0 : gr.ids.length;
    if (all === false) for (const gr of groups) n[gr.key] = gr.cargo && anyShip ? 0 : 1;
    S.sel = { from: id, n };
    computeDest();
    return true;
  }
  function selIds(cargoOnly) {
    if (!S.sel) return [];
    const ids = [];
    for (const gr of groupsAt(S.sel.from)) {
      if (cargoOnly != null && gr.cargo !== cargoOnly) continue;
      ids.push(...gr.ids.slice(0, S.sel.n[gr.key] || 0));
    }
    return ids;
  }
  function allCargo() {
    return groupsAt(S.sel.from).filter((gr) => gr.cargo).reduce((a, gr) => a.concat(gr.ids), []);
  }
  function computeDest() {
    S.dest = {};
    S.unload = {};
    S.part = {};
    if (!S.sel) return;
    const g = G();
    const ids = selIds();
    if (ids.length) S.dest = g.destinations(S.sel.from, ids);
    const cargo = selIds(true).length ? selIds(true) : allCargo();
    if (cargo.length && !(ids.length && ids.every((id) => cargo.includes(id)))) {
      S.unload = g.destinations(S.sel.from, cargo);
    }
    S.part = partialDest();
  }
  /**
   * Places only some of the selected units can reach (tanks two spaces away, say, with infantry
   * selected too). A click there moves the ones that can: S.part[to] = { kind, ids }.
   */
  function partialDest() {
    const g = G();
    const from = S.sel.from;
    const groups = groupsAt(from).filter((gr) => (S.sel.n[gr.key] || 0) > 0);
    if (groups.length < 2) return {};
    // units in a group are alike, so one of each shows where the group can go
    const reach = {};
    for (const gr of groups) {
      for (const to of Object.keys(g.destinations(from, [gr.ids[0]]))) {
        if (!S.dest[to] && !S.unload[to]) (reach[to] = reach[to] || []).push(gr);
      }
    }
    const out = {};
    for (const to of Object.keys(reach)) {
      let take = [];
      for (const gr of reach[to]) take.push(...gr.ids.slice(0, S.sel.n[gr.key]));
      let chk = g.checkMove(from, take, to);
      if (!chk.ok) {
        // together they may not all fit (a transport's room, say): keep each one that still does
        const fit = [];
        for (const id of take) if (g.checkMove(from, fit.concat([id]), to).ok) fit.push(id);
        take = fit;
        chk = take.length ? g.checkMove(from, take, to) : chk;
      }
      if (chk.ok && take.length) out[to] = { kind: chk.kind, ids: take };
    }
    return out;
  }
  /** "2 tanks and 1 fighter" for a list of unit ids. */
  function unitsText(ids) {
    const g = G();
    const n = {};
    for (const id of ids) { const u = g.unit(id); if (u) n[u.t] = (n[u.t] || 0) + 1; }
    const parts = Object.keys(n).map((t) => `${n[t]} ${uname(t).toLowerCase()}${n[t] === 1 ? '' : /y$/.test(uname(t)) ? '' : 's'}`);
    return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0] || '';
  }
  function clearSel(silent) {
    S.sel = null; S.dest = {}; S.unload = {}; S.part = {};
    if (!silent) render();
  }

  /**
   * Clicking one of your unit icons: first click selects every unit of that type there,
   * each further click on it drops one, and clicking another type adds all of that type.
   */
  function chipSelect(id, t) {
    const groups = groupsAt(id);
    const mine = groups.filter((gr) => gr.t === t && !gr.cargo);
    if (!mine.length) return false;
    if (!S.sel || S.sel.from !== id) {
      const n = {};
      for (const gr of groups) n[gr.key] = 0;
      S.sel = { from: id, n };
    }
    const n = S.sel.n;
    const cur = mine.reduce((a, gr) => a + (n[gr.key] || 0), 0);
    if (!cur) for (const gr of mine) n[gr.key] = gr.ids.length;
    else {
      // drop one, from the group with the fewest moves left
      const gr = mine.slice().reverse().find((x) => (n[x.key] || 0) > 0);
      n[gr.key]--;
    }
    if (!Object.values(n).some((v) => v > 0)) { clearSel(); return true; }
    computeDest();
    render();
    return true;
  }
  function allSelected(id) {
    if (!S.sel || S.sel.from !== id) return false;
    const groups = groupsAt(id);
    const anyShip = groups.some((x) => !x.cargo);
    return groups.every((gr) => (S.sel.n[gr.key] || 0) === (gr.cargo && anyShip ? 0 : gr.ids.length));
  }

  function onClick(id, ev, chip) {
    if (S.retreat) {
      if (id && S.retreat.opts.includes(id)) doRetreat(id);
      else toast('Choose one of the highlighted territories to retreat to');
      return;
    }
    if (!id || S.busy) { if (!S.busy) clearSel(); return; }
    const g = G();
    if (!humanTurn()) return;
    const ph = g.phase;
    if (ph === 'combat') {
      if (g.s.battles.includes(id)) fight(id);
      return;
    }
    if (ph === 'place') {
      if (!S.placeType) return;
      const n = ev && ev.shiftKey ? (g.s.buy[S.placeType] || 0) : 1;
      let placed = 0;
      pushUndo();
      for (let i = 0; i < n; i++) { const r = g.place(S.placeType, id); if (!r.ok) { if (!placed) toast(r.error); break; } placed++; }
      if (!placed) S.undo.pop();
      if (!(g.s.buy[S.placeType] > 0)) S.placeType = Object.keys(g.s.buy)[0] || null;
      save(); render();
      return;
    }
    if (ph !== 'combatMove' && ph !== 'noncombatMove') return;
    // a click on one of your own movable unit icons always adjusts the selection
    if (chip && chip.o === g.current() && chipSelect(id, chip.t)) return;
    // otherwise a click on the territory: move there if it is a destination...
    if (S.sel && id !== S.sel.from && (S.dest[id] || S.unload[id] || S.part[id])) return doMove(id);
    // ...or select everything there (a second click clears it)
    if (allSelected(id)) { clearSel(); return; }
    if (selectAt(id, true)) { render(); return; }
    clearSel();
  }
  function onDblClick(id) {
    if (!humanTurn() || !id) return;
    if (selectAt(id, true)) render();
  }
  function doMove(to) {
    const g = G();
    const from = S.sel.from;
    let ids = selIds();
    let kind = S.dest[to];
    let left = [];
    if (!kind && S.unload[to]) { ids = selIds(true).length ? selIds(true) : allCargo(); kind = S.unload[to]; }
    // not all of the selection can go there: the ones that can do
    else if (!kind && S.part[to]) { left = ids.filter((x) => !S.part[to].ids.includes(x)); ids = S.part[to].ids; kind = S.part[to].kind; }
    const chk = g.checkMove(from, ids, to);
    if (!chk.ok) { toast(chk.error); return; }
    pushUndo();
    const r = g.move(from, ids, to);
    if (!r.ok) { S.undo.pop(); toast(r.error); return; }
    S.mv.arrows([{ path: chk.plan[0].path }]);
    setTimeout(() => S.mv.arrows([]), 900);
    if (left.length) toast(`${unitsText(ids)} went; ${unitsText(left)} can't ${kind === 'attack' ? 'join that attack' : 'make that move'} and stay${left.length === 1 ? 's' : ''} in ${S.mv.T[from].name}`, 4500);
    clearSel(true);
    save();
    render();
  }

  function onHover(id, ev) {
    const tip = $('tip');
    if (!id || !S.g) { tip.style.display = 'none'; return; }
    const g = G();
    const t = S.mv.T[id];
    if (!g.s.terr[id]) { tip.style.display = 'none'; return; }
    const o = g.s.terr[id].o;
    let html = `<b>${esc(t.name)}</b>`;
    if (t.type === 'land') html += ` <span class="hint">${o ? esc(o) : 'Neutral'}${t.ipc ? ' · ' + t.ipc + ' IPC' : ''}</span>`;
    const us = g.units(id);
    if (us.length) {
      const c = {};
      for (const u of us) { const k = u.o + '|' + u.t; c[k] = (c[k] || 0) + 1; }
      html += '<div>' + Object.keys(c).map((k) => { const [p, ty] = k.split('|'); return `<span class="swatch" style="background:${color(p)}"></span> ${c[k]} ${esc(uname(ty))}`; }).join('<br>') + '</div>';
    }
    const kind = S.dest[id] || S.unload[id];
    if (kind) html += `<div class="hint">Click: ${kindText(kind)}</div>`;
    else if (S.part && S.part[id]) html += `<div class="hint">Click: ${kindText(S.part[id].kind)} with ${unitsText(S.part[id].ids)} (the rest can't)</div>`;
    tip.innerHTML = html;
    tip.style.display = 'block';
    tip.style.left = Math.min(ev.clientX + 14, innerWidth - 270) + 'px';
    tip.style.top = (ev.clientY + 14) + 'px';
  }
  function kindText(k) {
    return { move: 'move here', attack: 'attack (battle)', capture: 'capture', blitz: 'blitz through', load: 'load onto transport', unload: 'unload here', amphibious: 'amphibious assault' }[k] || k;
  }

  // ------------------------------------------------------------------ render
  function render() {
    if (!S.g) return;
    renderStatus();
    renderMap();
    renderPanel();
  }
  function renderStatus() {
    const g = G();
    const p = g.current();
    const st = g.objectiveStatus();
    const done = st.reduce((a, o) => a + o.done, 0), tot = st.reduce((a, o) => a + o.total, 0);
    const money = humanPowers().map((h) => `${h === p || humanPowers().length > 1 ? '' : ''}${g.s.powers[h].money}`).join(' / ');
    $('status').innerHTML = [
      S.mode === 'free' ? '<span class="pill" style="border-color:var(--accent);color:var(--accent)"><b>Free play</b></span>' : '',
      `<span class="pill">Turn <b>${Math.min(g.s.round, g.s.maxTurns)}</b>/${g.s.maxTurns}</span>`,
      g.phase === 'gameOver' ? '<span class="pill"><b>Game over</b></span>'
        : `<span class="pill"><span class="swatch" style="background:${color(p)}"></span><b>${esc(p)}</b> · ${E.PHASE_NAMES[g.phase]}</span>`,
      `<span class="pill">💰 ${money} IPC</span>`,
      `<span class="pill">★ ${done}/${tot} objectives</span>`,
    ].join('');
  }
  function renderMap() {
    const g = G();
    const owners = {}, units = {};
    const hl = {};
    const sel = S.sel ? S.sel.from : null;
    for (const id of Object.keys(g.s.terr)) {
      owners[id] = g.s.terr[id].o;
      const c = {};
      const cargo = {};
      for (const u of g.s.terr[id].u) {
        if (u.tr) { cargo[u.o] = (cargo[u.o] || 0) + 1; continue; }
        const k = u.o + '|' + u.t + '|' + (u.h ? 1 : 0);
        if (!c[k]) c[k] = { o: u.o, t: u.t, n: 0, dmg: !!u.h, ids: [] };
        c[k].n++;
        c[k].ids.push(u.id);
      }
      const list = Object.values(c);
      for (const ch of list) if (ch.t === 'transport' && cargo[ch.o]) { ch.cargo = cargo[ch.o]; cargo[ch.o] = 0; }
      if (sel === id) {
        const picked = new Set(selIds());
        for (const ch of list) { const k = ch.ids.filter((x) => picked.has(x)).length; if (k) ch.sel = k; }
      }
      if (humanTurn() && (g.phase === 'combatMove' || g.phase === 'noncombatMove')) {
        for (const ch of list) if (ch.o === g.current() && !ch.ids.some((x) => g.canUnitMove(g.unit(x), id))) ch.dim = true;
      }
      units[id] = list;
    }
    for (const id of Object.keys(S.dest)) hl[id] = S.dest[id];
    for (const id of Object.keys(S.unload || {})) if (!hl[id]) hl[id] = S.unload[id];
    // only some of the selection can go: same colour, dashed outline
    for (const id of Object.keys(S.part || {})) if (!hl[id]) hl[id] = S.part[id].kind + ' part';
    if (g.phase === 'combat') for (const id of g.s.battles) hl[id] = 'battle';
    if (S.retreat) for (const id of S.retreat.opts) hl[id] = 'move';
    if (g.phase === 'place' && S.placeType && humanTurn()) for (const id of g.placeTargets(S.placeType)) hl[id] = 'place';
    const objectives = {};
    for (const o of S.sc.objectives || []) for (const id of o.territories || []) objectives[id] = o.side === 'opponent' ? (objectives[id] || 'enemy') : o.type;
    S.mv.update({ owners, units, highlight: hl, selected: sel, objectives, playable: new Set(S.sc.playable), dimInactive: true, labels: 'playable' });
  }

  function renderPanel() {
    const g = G();
    const p = g.current();
    const parts = [];
    // objectives
    const st = g.objectiveStatus();
    const total = g.objectiveTargets().filter((t) => t.type !== 'hold').length;
    parts.push(`<div class="h">${asOpponent() ? 'The player side wins by' : 'Objectives'}${g.objectivesNeeded() < total ? ` (need ${g.objectivesNeeded()})` : ''}</div><ul class="objlist">${objectiveRows(st, false)}</ul>`);
    const opp = g.opponentStatus();
    if (opp.length) parts.push(`<div class="h">${asOpponent() ? 'You win if you' : 'The enemy wins if it'}</div><ul class="objlist enemy">${objectiveRows(opp, true)}</ul>`);
    parts.push(`<div class="hint" style="margin-top:4px">${winCheckText()}</div>`);

    if (S.mode === 'free' && !S.busy) {
      parts.push('<div class="h">Free play</div><p class="hint">Practice on today\'s setup. It does not change your result or stats.</p><div class="actions"><button id="pFreeReset">↺ Reset board</button><button id="pDaily">Back to my result</button></div>');
    }
    if (g.phase === 'gameOver') {
      parts.push(`<div class="h">Result</div><p><b>${verdict(g.s.result.won)}</b> — ${esc(g.s.result.reason)}</p><div class="actions"><button class="primary" id="pResult">Share result</button>${!S.test && S.mode === 'daily' ? '<button id="pFree">Free play</button>' : ''}</div>`);
      if (S.test) parts.push('<div class="actions"><button id="pRestart">Restart test</button></div>');
    } else if (S.retreat) {
      const from = S.mv.T[S.retreat.from].name;
      parts.push(`<div class="h">Retreat from ${esc(from)}</div><p>Click a highlighted territory on the map. Every unit that can retreat goes there together${G().units(S.retreat.from).some((u) => u.o === G().s.battle.att && u.amph) ? '; units that landed from the sea cannot retreat and fight on' : ''}.</p><div class="actions"><button id="pRetBack">Back to the battle</button></div>`);
    } else if (!humanTurn()) {
      parts.push(`<div class="h">${esc(p)}'s turn</div><p class="hint">The computer is moving…</p>`);
    } else {
      parts.push(phasePanel());
    }
    parts.push('<div class="log" id="log">' + g.s.log.slice(-40).reverse().map((l) => `<div>${esc(l.m)}</div>`).join('') + '</div>');
    if (S.test && g.phase !== 'gameOver') parts.push('<div class="actions"><button class="small" id="pRestart">Restart test</button></div>');
    $('panel').innerHTML = parts.join('');
    bindPanel();
  }
  /** List items for objectives (player's or the enemy's), one per territory or IPC goal, marked when met. */
  function objectiveRows(st, enemy) {
    const g = G();
    const ht = humanTeam();
    const mine = (team) => (enemy ? !!team && team !== ht : team === ht);
    return st.map((o) => {
      if (o.type === 'bank' || o.type === 'damage') return `<li class="${o.met ? (enemy ? 'warn' : 'done') : ''}">${D.objectiveWords(o, '', enemy)}</li>`;
      return o.territories.map((id) => {
        const ok = g._territoryMet(o.type, id, mine);
        return `<li class="${ok ? (enemy ? 'warn' : 'done') : ''}">${D.objectiveWords(o, `<b>${esc(S.mv.T[id].name)}</b>`, enemy)}</li>`;
      }).join('');
    }).join('');
  }
  function winCheckText() {
    const g = G();
    const holds = (S.sc.objectives || []).some((o) => o.type === 'hold' && o.side !== 'opponent');
    const need = g.objectivesNeeded();
    const total = g.objectiveTargets().filter((t) => t.type !== 'hold').length;
    const some = need < total ? `Any ${need} of the ${total} objectives is enough. ` : '';
    const enemy = g.opponentStatus().length ? ' The enemy wins if it meets all its objectives at the end of one of its turns.' : '';
    return some + winCheckTiming(holds) + enemy;
  }
  function winCheckTiming(holds) {
    if (S.sc.winCheck === 'turn') return `Checked only at the end of your turn ${Math.min(G().s.maxTurns, S.sc.checkTurn || G().s.maxTurns)}.`;
    if (S.sc.winCheck === 'roundEnd' || holds) return `Checked at the end of each round${holds ? '; held territories must be kept every turn' : ''}. ${G().s.maxTurns} turns.`;
    return `Win as soon as they are met at the end of your turn. ${G().s.maxTurns} turns.`;
  }

  function phasePanel() {
    const g = G();
    const p = g.current();
    const h = [];
    const undoBtn = `<button id="pUndo" ${canUndo() ? '' : 'disabled'}>↶ Undo</button>`;
    if (g.phase === 'purchase') {
      const money = g.s.powers[p].money;
      h.push(`<div class="h">Buy units · ${money - g.spent()} of ${money} IPC left</div>`);
      if (S.sc.purchase === false) h.push('<p class="hint">No purchasing in this puzzle.</p>');
      else {
        const fac = g.factories();
        const cap = Object.values(fac).reduce((a, b) => a + b, 0);
        h.push(`<p class="hint">${cap ? `Units appear at your factories at the end of the turn (room for ${cap}).` : 'You have no factory in play, so bought units cannot be placed.'}</p>`);
        h.push('<div class="list">' + g.buyable().filter((t) => t !== 'factory' || cap >= 0).map((t) => {
          const d = g.R.units[t];
          const n = g.s.buy[t] || 0;
          return `<div class="urow"><span class="ic" style="background:${color(p)}">${I.svg(t, 22, '#fff')}</span><span class="nm">${esc(d.name)}<small>${d.cost} IPC · ${d.att}/${d.def}/${d.move}</small></span>
            <span class="stepper"><button data-buy="${t}" data-d="-1">−</button><output>${n}</output><button data-buy="${t}" data-d="1">+</button></span></div>`;
        }).join('') + '</div>');
      }
      h.push(`<div class="actions"><button class="primary" id="pNext">Done buying →</button></div>`);
    } else if (g.phase === 'combatMove' || g.phase === 'noncombatMove') {
      const combat = g.phase === 'combatMove';
      h.push(`<div class="h">${combat ? 'Combat move' : 'Noncombat move'}</div>`);
      h.push(`<p class="hint">${combat
        ? 'Tap a unit icon to pick those units (tap again to drop one), or tap the territory to pick everything. Then tap where to send them. Moving into enemy territory starts a battle; empty enemy land is captured; tanks can blitz through it.'
        : 'Reposition units that did not fight. Aircraft must end on friendly land held since the start of the turn, or on a carrier.'}</p>`);
      if (combat) {
        // ships sharing a sea zone with enemy warships fight there unless they leave (rulebook p. 9)
        const shared = Object.keys(g.s.terr).filter((id) => S.mv.T[id] && S.mv.T[id].type === 'sea' && g.hostileSurface(id, g.current()) && g.units(id).some((u) => u.o === g.current() && !u.tr && g.def(u).domain === 'sea'));
        if (shared.length) h.push(`<p class="picknote">Your ships in ${shared.map((id) => esc(S.mv.T[id].name)).join(', ')} share the sea with enemy warships. They fight there unless you move them away.</p>`);
      }
      if (S.sel) h.push(selPanel());
      h.push(`<div class="actions">${undoBtn}<button class="primary" id="pNext">${combat ? 'Done moving → battles' : 'Done moving →'}</button></div>`);
    } else if (g.phase === 'combat') {
      const ready = g.readyBattles();
      h.push('<div class="h">Battles</div>');
      if (!g.s.battles.length) h.push('<p class="hint">All battles fought.</p>');
      h.push('<div class="list">' + g.s.battles.map((id) => `<div class="urow"><span class="nm">⚔️ ${esc(S.mv.T[id].name)}</span><button class="small ${ready.includes(id) ? 'primary' : ''}" data-fight="${id}" ${ready.includes(id) ? '' : 'disabled'}>Fight</button></div>`).join('') + '</div>');
      h.push(`<div class="actions"><button class="primary" id="pNext" ${g.s.battles.length ? 'disabled' : ''}>Continue →</button></div>`);
    } else if (g.phase === 'place') {
      const left = g.toPlace();
      const types = Object.keys(left);
      h.push('<div class="h">Place new units</div>');
      if (!types.length) h.push('<p class="hint">Nothing to place.</p>');
      else {
        if (!S.placeType || !left[S.placeType]) S.placeType = types[0];
        h.push('<p class="hint">Pick a unit, then tap a highlighted territory (Shift-click places all). Ships go in a sea zone next to a factory.</p><div class="list">' +
          types.map((t) => `<div class="urow" style="${S.placeType === t ? 'border-color:var(--accent)' : ''}"><span class="ic" style="background:${color(p)}">${I.svg(t, 22, '#fff')}</span><span class="nm">${esc(uname(t))}</span><b>${left[t]}</b><button class="small" data-ptype="${t}">${S.placeType === t ? 'Selected' : 'Select'}</button></div>`).join('') + '</div>');
        h.push('<div class="actions"><button id="pAuto">Auto-place</button></div>');
      }
      h.push(`<div class="actions">${undoBtn}<button class="primary" id="pNext">End turn ✓</button></div>`);
    }
    return h.join('');
  }
  function selPanel() {
    const g = G();
    const groups = groupsAt(S.sel.from);
    const p = g.current();
    return `<div class="h">Selected in ${esc(S.mv.T[S.sel.from].name)}</div><div class="list">` + groups.map((gr) => {
      const n = S.sel.n[gr.key] || 0;
      const d = g.def(gr.t);
      const sub = gr.cargo ? 'aboard transport' : (d.domain === 'air' || d.move > 1) ? `${gr.ml} move${gr.ml === 1 ? '' : 's'} left` : '';
      return `<div class="urow"><span class="ic" style="background:${color(p)}">${I.svg(gr.t, 22, '#fff')}</span><span class="nm">${esc(d.name)}<small>${sub}</small></span>
        <span class="stepper"><button data-sel="${gr.key}" data-d="-1">−</button><output>${n}/${gr.ids.length}</output><button data-sel="${gr.key}" data-d="1">+</button></span></div>`;
    }).join('') + `</div><p class="hint">Highlighted territories are valid destinations${Object.keys(S.part || {}).length ? '; a dashed outline means only some of these units can go, and those that can will' : ''}. Esc or right-click to cancel.</p>`;
  }

  function bindPanel() {
    const g = G();
    const q = (sel) => $('panel').querySelectorAll(sel);
    q('[data-buy]').forEach((b) => b.onclick = () => {
      const r = g.buy(b.dataset.buy, +b.dataset.d);
      if (!r.ok) toast(r.error);
      save(); render();
    });
    q('[data-sel]').forEach((b) => b.onclick = () => {
      const gr = groupsAt(S.sel.from).find((x) => x.key === b.dataset.sel);
      S.sel.n[gr.key] = Math.max(0, Math.min(gr.ids.length, (S.sel.n[gr.key] || 0) + +b.dataset.d));
      computeDest(); render();
    });
    q('[data-fight]').forEach((b) => b.onclick = () => fight(b.dataset.fight));
    const rb = $('pRetBack'); if (rb) rb.onclick = cancelRetreat;
    q('[data-ptype]').forEach((b) => b.onclick = () => { S.placeType = b.dataset.ptype; render(); });
    const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
    on('pUndo', undo);
    on('pNext', nextPhase);
    on('pResult', showResult);
    on('pFree', () => enterFreePlay(false));
    on('pFreeReset', () => enterFreePlay(true));
    on('pDaily', exitFreePlay);
    on('pRestart', async () => { if (await ask('Restart the test?', '<p>Start this test game again from the beginning.</p>', 'Restart', 'Cancel')) { store.del(S.key); location.reload(); } });
    on('pAuto', () => {
      pushUndo();
      for (const t of Object.keys(g.s.buy)) {
        let n = g.s.buy[t];
        while (n-- > 0) { const tg = g.placeTargets(t); if (!tg.length) break; g.place(t, tg[0]); }
      }
      save(); render();
    });
  }

  /** In-page confirmation in the same style as the battle window. Resolves true/false. */
  function ask(title, body, ok, cancel) {
    return new Promise((resolve) => {
      openDialog(`<div class="battle"><h2>${title}</h2>${body}
        <div class="actions"><button id="askNo">${esc(cancel || 'Cancel')}</button><button class="primary" id="askYes">${esc(ok || 'OK')}</button></div></div>`, false);
      const done = (v) => { closeModal(); resolve(v); };
      $('askYes').onclick = () => done(true);
      $('askNo').onclick = () => done(false);
      $('askYes').focus();
    });
  }
  async function nextPhase() {
    const g = G();
    if (g.phase === 'purchase') g.commitPurchase();
    if (g.phase === 'combatMove') {
      const battles = g.findBattles();
      const body = battles.length
        ? `<p>You will fight ${battles.length === 1 ? 'this battle' : `these ${battles.length} battles`}:</p><ul class="blines">${battles.map((id) => `<li>⚔️ ${esc(S.mv.T[id].name)}</li>`).join('')}</ul><p class="hint">Moves can't be changed once the dice roll.</p>`
        : '<p class="hint">No attacks are planned this turn.</p>';
      if (!await ask(battles.length ? 'Ready for battle?' : 'End combat moves?', body, battles.length ? 'Fight ⚔️' : 'Continue', 'Back to moves')) return;
    }
    if (g.phase === 'noncombatMove') {
      const lost = g.strandedAir();
      if (lost.length && !await ask('Aircraft cannot land', `<p>${lost.length} aircraft ${lost.length === 1 ? 'has' : 'have'} no friendly territory or carrier to land on and will be lost.</p>`, 'End movement', 'Back to moves')) return;
    }
    if (g.phase === 'place') {
      const left = Object.values(g.s.buy).reduce((a, b) => a + b, 0);
      if (left && !await ask('Units not placed', `<p>${left} unit${left === 1 ? ' is' : 's are'} not placed. They wait until your next turn.</p>`, 'End turn', 'Keep placing')) return;
      g.clearBorn();
    }
    const r = g.nextPhase();
    if (!r.ok) { toast(r.error); return; }
    if (r.lost && r.lost.length) toast(`${r.lost.length} aircraft lost`);
    S.undo = [];
    clearSel(true);
    S.placeType = null;
    save();
    render();
    continueFlow();
  }

  // Skip phases with nothing to do, run the computer, open battles
  function continueFlow() {
    const g = G();
    if (g.phase === 'gameOver') { render(); showResult(); return; }
    if (S.retreat) { render(); return; }
    if (g.s.battle && g.s.battle.hold) { openBattle(); driveBattle(); return; }
    if (g.s.battle) { openBattle(); if (!g.s.powers[g.s.battle.att].ai) return; }
    if (humanTurn()) {
      const pw = g.s.powers[g.current()];
      const noRoom = !Object.keys(g.factories()).length;
      if (g.phase === 'purchase' && (S.sc.purchase === false || noRoom || (pw.money < 3 && !Object.keys(pw.unplaced || {}).length))) {
        g.commitPurchase(); g.nextPhase(); save(); render();
      }
      if (g.phase === 'combat' && !g.s.battle && g.s.battles.length === 1 && (g.s.battleCount || 1) === 1) fight(g.s.battles[0]);
      else if (g.phase === 'combat' && !g.s.battle && g.s.battles.length) toast('Pick your next battle');
      return;
    }
    runAI();
  }

  // ------------------------------------------------------------------ computer turns
  async function runAI() {
    if (S.busy) return;
    S.busy = true;
    S.fast = false;
    const g = G();
    const banner = $('banner');
    let guard = 0;
    try {
      while (guard++ < 5000) {
        if (G() !== g) return; // the game was switched (free play / reset)
        if (g.phase === 'gameOver') break;
        const b = g.s.battle;
        if (b && b.hold) {
          // a battle the person is in: its own pace, and it waits for them where they act
          openBattle();
          if (await driveBattle()) break;
          continue;
        }
        if (!b && humanTurn()) break;
        const p = g.current();
        banner.classList.add('on');
        $('bannerText').textContent = `${p} is moving…`;
        const a = S.ai.step();
        if (!a) break;
        save();
        if (a.type === 'move') {
          S.mv.arrows([{ path: [a.from, a.to], cls: 'enemy' }]);
          $('bannerText').textContent = `${p}: ${S.mv.T[a.from].name} → ${S.mv.T[a.to].name}`;
        }
        if (g.s.battle && g.s.battle.hold) openBattle();
        render();
        const wait = S.fast ? 0 : a.type === 'move' ? 550 : a.type === 'battleRoll' ? 420 : a.type === 'place' ? 200 : a.type === 'phase' ? 250 : 120;
        if (wait) await sleep(wait);
        else if (guard % 20 === 0) await sleep(0);
      }
    } finally {
      S.busy = false;
      banner.classList.remove('on');
      S.mv.arrows([]);
    }
    render();
    if (G() !== g) return;
    if (g.s.battle && g.s.battle.hold) { openBattle(); return; } // waiting for the person
    if (g.s.battle && !g.s.battle.over) openBattle();
    else if (g.phase === 'gameOver') showResult();
    else continueFlow();
  }
  // ------------------------------------------------------------------ battles
  // A battle the person is in (b.hold) runs one roll at a time, in the rule book's order:
  //   attacker rolls -> defender's casualties are marked (they still fire back) -> defender rolls ->
  //   attacker's casualties are marked -> the round's dice and casualties stay on show while the attacker
  //   presses the attack (casualties removed, next round rolled), retreats (on the map), or ends the battle.
  // The person rolls their own dice; the computer's steps run by themselves with short pauses (driveBattle).
  const PAUSE = { roll: 700, defend: 950, decide: 1300 };
  function fight(id) {
    const g = G();
    if (g.s.battle) { openBattle(); return; }
    const r = g.startBattle(id);
    if (!r.ok) { toast(r.error); return; }
    S.undo = [];
    save();
    openBattle();
    driveBattle();
  }
  function openBattle() {
    if (S.retreat) return;
    S.battleOpen = true;
    S.modalClosable = false;
    $('modal').classList.add('open');
    renderBattle();
  }
  function isHumanPower(p) { return !!p && !!G().s.powers[p] && !G().s.powers[p].ai; }
  function defOwnerOf(b) {
    const g = G();
    const d = g._side('D');
    return (d[0] && d[0].o) || (b.roundDead || []).filter((x) => x.side === 'D').map((x) => x.o)[0] || g.s.terr[b.id].o || '—';
  }
  /** The person's side with pending casualties ('A'/'D'), if any. */
  function humanHitSide(b) {
    const g = G();
    for (const side of ['A', 'D']) {
      if (!b.pend[side]) continue;
      const owner = side === 'A' ? b.att : (g.casualtyChoice(side).units[0] || {}).o;
      if (isHumanPower(owner)) return side;
    }
    return null;
  }
  /** Whether the hits leave a real choice of casualties (more hit points that could take them than hits). */
  function hasChoice(side) {
    const g = G();
    const ch = g.casualtyChoice(side);
    if (!ch) return false;
    const h = ch.hits;
    const air = (u) => g.def(u).domain === 'air';
    const able = ch.units.filter((u) => (h.airOnly && !(h.any || h.notAir || h.notSub) ? air(u) : h.notAir && !(h.any || h.notSub || h.airOnly) ? !air(u) : true));
    return able.reduce((a, u) => a + (g.def(u).hp || 1) - (u.h || 0), 0) > ch.need;
  }
  /** The side whose pending casualties the person may still change, if any. */
  function humanPickSide(b) {
    const side = humanHitSide(b);
    return side && hasChoice(side) ? side : null;
  }
  /** What happens next in the current battle, and whether it waits for the person. */
  function battleNext() {
    const g = G();
    const b = g.s.battle;
    if (!b) return null;
    const humanA = isHumanPower(b.att);
    if (b.over) return { human: true, act: 'over' };
    if (b.need === 'casualties') return { human: false, act: 'assign', pause: 0 };
    if (b.need === 'decision') {
      if (b.ending) return { human: true, act: 'end' };
      return humanA ? { human: true, act: 'decide' } : { human: false, act: 'botDecide', pause: PAUSE.decide };
    }
    if (b.need !== 'roll') return { human: true, act: 'wait' };
    const roundStart = b.step === 'start' || b.step === 'decide';
    // step 2 of a round: defending subs may dive when the attacker has no destroyer
    if (roundStart && g.subChoicePending('D') && isHumanPower((g._side('D').find((u) => g.def(u).sub) || {}).o)) return { human: true, act: 'dive' };
    if (roundStart) return humanA ? { human: true, act: 'roll' } : { human: false, act: 'roll', pause: PAUSE.roll };
    if (b.step === 'fireD' && g._side('D').some((u) => isHumanPower(u.o))) return { human: true, act: 'defend' };
    if (humanPickSide(b)) return { human: true, act: 'continue' };
    return { human: false, act: 'roll', pause: PAUSE.defend };
  }
  /** Run the computer's part of the battle. Resolves true when it stops for the person. */
  async function driveBattle() {
    if (S.driving) return true;
    S.driving = true;
    try {
      for (let i = 0; i < 400; i++) {
        const g = G();
        const b = g.s.battle;
        if (!b || S.retreat) return !!b;
        const nx = battleNext();
        if (nx.human) { renderBattle(); return true; }
        if (!S.battleOpen) openBattle();
        await sleep(S.fast ? 0 : nx.pause);
        if (G() !== g || g.s.battle !== b) return false;
        S.animating = true;
        try {
          if (nx.act === 'assign') {
            for (const side of ['A', 'D']) if (b.pend[side] && !b.picks[side]) g.battleAssign(side, g.casualtyChoice(side).auto);
          } else if (nx.act === 'botDecide') {
            const to = S.ai.battleDecision();
            await removeCasualties();
            if (to) g.battleRetreat(to);
            else g.battleContinue();
            save();
            // the next round is rolled on the next pass (after the defender's subs may have dived)
          } else {
            await rollStep();
          }
        } finally { S.animating = false; }
        save();
        render();
      }
    } finally { S.driving = false; }
    return false;
  }
  /** Roll the next step; at the start of a round the computer's defending subs first decide whether to dive. */
  async function rollStep() {
    const g = G();
    const b = g.s.battle;
    if (b.step === 'start' || b.step === 'decide') {
      S.ai.subDecisions();
      save();
      if (!g.s.battle || g.s.battle.over || g.s.battle.need !== 'roll') { renderBattle(); return; }
    }
    g.battleRoll();
    save();
    await showRoll();
  }
  // ---- animation: a roll's dice grow in, then its casualties are marked with a shake
  async function showRoll() {
    S.anim = { hideMarks: true };
    renderBattle();
    await sleep(S.fast ? 0 : 560);
    const b = G().s.battle;
    S.anim = { shake: new Set([...(b && b.picks.A) || [], ...(b && b.picks.D) || []]) };
    renderBattle();
    await sleep(S.fast ? 0 : 560);
    S.anim = {};
    renderBattle();
  }
  // ---- the round's casualties and dice shrink away before they are removed
  async function removeCasualties() {
    S.anim = { leaving: true };
    renderBattle();
    await sleep(S.fast ? 0 : 380);
    S.anim = {};
  }
  /** The person's casualty picks must be complete before the battle moves on. */
  function picksReady() {
    if (!S.edit) return true;
    const ch = G().casualtyChoice(S.edit.side);
    if (!ch || S.edit.picks.length === ch.need) return true;
    toast(`Mark ${ch.need - S.edit.picks.length} more casualt${ch.need - S.edit.picks.length === 1 ? 'y' : 'ies'} first`);
    return false;
  }
  async function battleAct(act) {
    const g = G();
    const b = g.s.battle;
    if (!b || S.animating || S.driving) return;
    if (act === 'over') { finishBattle(); return; }
    if (!picksReady()) return;
    if (act === 'retreat') { startRetreat(); return; }
    S.animating = true;
    try {
      if (act === 'press' || act === 'end') {
        await removeCasualties();
        g.battleContinue();
        save();
        if (act === 'press' && !g.s.battle.over) await rollStep();
      } else if (act === 'dive' || act === 'stay') {
        const r = act === 'dive' ? g.battleSubmerge('D') : g.battleKeepSubs('D');
        if (!r.ok) toast(r.error);
        save();
      } else if (act === 'submerge') {
        await removeCasualties();
        const r = g.battleSubmerge('A');
        if (!r.ok) toast(r.error);
        save();
      } else {
        await rollStep();
      }
    } finally { S.animating = false; }
    S.edit = null;
    render();
    if (act === 'end' || (g.s.battle && g.s.battle.over && act === 'press')) { finishBattle(); return; }
    renderBattle();
    driveBattle();
  }
  /** Close a finished battle and carry on (next battle, the computer's turn, ...). */
  function finishBattle() {
    const g = G();
    const b = g.s.battle;
    if (b && b.over) {
      if (b.retreated && b.retreatedTo && b.retreatedTo !== b.id && !isHumanPower(b.att)) toast(`${b.att} retreats to ${S.mv.T[b.retreatedTo].name}`);
      g.closeBattle();
    }
    S.edit = null;
    S.anim = {};
    save();
    closeModal();
    render();
    continueFlow();
  }
  // ---- retreat: pick the territory on the map; nothing else can be done until the units have gone
  async function startRetreat() {
    const g = G();
    const b = g.s.battle;
    S.animating = true;
    try {
      await removeCasualties();
      g.battleSettle();
      save();
    } finally { S.animating = false; }
    if (g.s.battle.over) { render(); renderBattle(); return; }
    const opts = g.retreatOptions();
    if (!opts.length) { toast('There is nowhere to retreat to'); renderBattle(); return; }
    if (opts.length === 1 && opts[0] === b.id) {
      // aircraft only: they break off here and fly home in noncombat move
      g.battleRetreat(b.id);
      save();
      toast('Your aircraft break off. Land them in noncombat move.', 3500);
      finishBattle();
      return;
    }
    S.retreat = { from: b.id, opts };
    closeModal();
    S.mv.setFocus([b.id, ...opts], 0.15);
    S.mv.arrows(opts.map((to) => ({ path: [b.id, to] })));
    render();
  }
  function doRetreat(id) {
    const g = G();
    const r = g.battleRetreat(id);
    if (!r.ok) { toast(r.error); return; }
    S.retreat = null;
    S.mv.arrows([]);
    save();
    const b = g.s.battle;
    if (b && !b.over) {
      // units that landed from the sea cannot retreat: they fight on
      toast('Your units that landed from the sea fight on', 3000);
      render();
      openBattle();
      driveBattle();
      return;
    }
    toast(`Retreated to ${S.mv.T[id].name}`);
    finishBattle();
  }
  function cancelRetreat() {
    S.retreat = null;
    S.mv.arrows([]);
    render();
    openBattle();
  }

  // ---- the battle window: laid out like the battle board, one row per combat value
  /** The value a unit rolls at in this battle: attack (with artillery support) or defence. 0 = cannot roll. */
  function battleValues(side) {
    const g = G();
    const units = g._side(side);
    const out = {};
    let support = 0;
    if (side === 'A') for (const u of units) support += g.def(u).supports || 0;
    // which infantry get the support is arbitrary; lowest ids first keeps the rows steady
    for (const u of units.slice().sort((a, c) => a.id - c.id)) {
      const d = g.def(u);
      let v = side === 'A' ? d.att : d.def;
      if (side === 'A' && d.supportable && support > 0 && v > 0) { v++; support--; }
      out[u.id] = v;
    }
    return out;
  }
  /**
   * A side's unit chips by row (value). One chip per type in a row. Casualties keep their chip: it is
   * outlined in red with a "−n" count until the round is settled. While they are removed, the lost ones
   * get a chip of their own that shrinks away.
   */
  function battleUnits(side) {
    const g = G();
    const b = g.s.battle;
    const anim = S.anim || {};
    const editing = S.edit && S.edit.side === side;
    const picks = editing ? S.edit.picks : (b.picks[side] || []);
    const cnt = {};
    if (!anim.hideMarks) for (const id of picks) cnt[id] = (cnt[id] || 0) + 1;
    const auto = new Set(anim.hideMarks ? [] : (b.autoLost || []));
    const ch = editing ? g.casualtyChoice(side) : null;
    const cand = new Set(ch ? ch.units.map((u) => u.id) : []);
    const vals = battleValues(side);
    const groups = {};
    const add = (u, v, minus, dies, damaged) => {
      const leaving = !!anim.leaving && dies;
      const key = `${v}|${u.t}|${damaged ? 1 : 0}|${leaving ? 1 : 0}`;
      if (!groups[key]) groups[key] = { key, v, t: u.t, o: u.o, damaged, leaving, ids: [], minus: 0, lost: 0, pickable: false };
      const gr = groups[key];
      gr.ids.push(u.id);
      gr.minus += minus;
      if (dies) gr.lost++;
      if (editing && cand.has(u.id) && !b.doomed.includes(u.id)) gr.pickable = true;
    };
    for (const u of g._side(side)) {
      const left = (g.def(u).hp || 1) - (u.h || 0);
      const doomed = b.doomed.includes(u.id) || auto.has(u.id);
      const hits = cnt[u.id] || 0;
      const dies = doomed || hits >= left;
      add(u, vals[u.id], dies ? 1 : hits, dies, !dies && (u.h || 0) > 0);
    }
    for (const u of (b.roundDead || []).filter((x) => x.side === side)) {
      const d = g.def(u.t);
      add(u, side === 'A' ? d.att : d.def, 1, true, false);
    }
    const order = Rules.UNIT_ORDER;
    const rows = {};
    for (const gr of Object.values(groups).sort((x, y) => order.indexOf(x.t) - order.indexOf(y.t) || (x.leaving ? 1 : 0) - (y.leaving ? 1 : 0))) {
      const d = g.def(gr.t);
      const shake = anim.shake && gr.ids.some((id) => anim.shake.has(id));
      const hit = gr.minus > 0 || gr.leaving;
      const cls = ['bunit', hit ? 'hit' : '', gr.pickable ? 'pick' : '', shake ? 'shake' : '', gr.leaving ? 'leaving' : ''].join(' ');
      const pk = `${side}|${gr.key}`;
      if (gr.pickable) S.pickGroups[pk] = gr.ids;
      const supported = side === 'A' && d.supportable && gr.v > d.att;
      const title = `${d.name}${supported ? ' (supported by artillery)' : ''}${gr.damaged ? ' (damaged)' : ''}${gr.v > 0 ? `: hits on ${gr.v} or less` : ': cannot fire'}${gr.lost ? ` · ${gr.lost} lost` : ''}${gr.minus > gr.lost ? ` · ${gr.minus - gr.lost} take${gr.minus - gr.lost === 1 ? 's' : ''} a hit` : ''}`;
      (rows[gr.v] = rows[gr.v] || []).push(`<div class="${cls}" style="background:${color(gr.o)}" title="${esc(title)}" ${gr.pickable ? `data-pick="${esc(pk)}" role="button" tabindex="0"` : ''}>
        ${I.svg(gr.t, 28, '#fff')}<span class="n">${gr.ids.length}</span>${gr.minus && !gr.leaving ? `<span class="x">−${gr.minus}</span>` : ''}${gr.damaged ? '<span class="x" style="left:auto;right:-5px;top:-5px;background:#ff8800">dmg</span>' : ''}</div>`);
    }
    return rows;
  }
  /** A side's dice this round by row: each die sits in the row of the value it was rolled at. */
  function battleDice(b, side) {
    const key = `${b.id}:${b.round}`;
    if (!S.diceSeen || S.diceSeen.key !== key) S.diceSeen = { key, A: 0, D: 0 };
    const seen = S.diceSeen[side];
    const names = { aa: 'AA', bombard: 'Bombard', subs: 'Subs', fire: 'Fire' };
    const rows = {}, prev = {};
    (b.dice[side] || []).forEach((d, i) => {
      const k = d.k || 'fire';
      const sep = k !== prev[d.v] && (k !== 'fire' || prev[d.v]) ? `<span class="dsep">${names[k]}</span>` : '';
      prev[d.v] = k;
      const fresh = i >= seen;
      (rows[d.v] = rows[d.v] || []).push(`${sep}<span class="die ${d.hit ? 'hit' : ''} ${fresh ? 'new' : ''}" ${fresh ? `style="animation-delay:${Math.min(260, (i - seen) * 26)}ms"` : ''} title="${esc(uname(d.t))} hits on ${d.v} or less">${d.die}</span>`);
    });
    S.diceSeen[side] = (b.dice[side] || []).length;
    return rows;
  }
  /** Attacker on the left, defender on the right, rows from 1 down to the highest value; units that cannot fire last. */
  function battleBoard(b, att, defOwner) {
    const anim = S.anim || {};
    const units = { A: battleUnits('A'), D: battleUnits('D') };
    const dice = { A: battleDice(b, 'A'), D: battleDice(b, 'D') };
    const vals = new Set();
    for (const side of ['A', 'D']) for (const m of [units[side], dice[side]]) for (const v of Object.keys(m)) vals.add(+v);
    const rows = [...vals].sort((x, y) => (x === 0) - (y === 0) || x - y);
    const head = (p, role) => `<div class="bhead ${role}"><span class="swatch" style="background:${color(p)}"></span>${role === 'a' ? 'Attacker' : 'Defender'} · ${esc(p)}${isHumanPower(p) ? ' (you)' : ''}</div>`;
    const cell = (side, v) => `<div class="bcell ${side === 'A' ? 'a' : 'd'}"><div class="units">${(units[side][v] || []).join('')}</div>${dice[side][v] ? `<div class="dice ${anim.leaving ? 'out' : ''}">${dice[side][v].join('')}</div>` : ''}</div>`;
    return `<div class="board">${head(att, 'a')}<div class="bhead mid"></div>${head(defOwner, 'd')}` +
      rows.map((v) => `${cell('A', v)}<div class="bval" title="${v ? `Hits on a roll of ${v} or less` : 'Cannot fire'}">${v || '–'}</div>${cell('D', v)}`).join('') + '</div>';
  }
  function renderBattle() {
    const g = G();
    const b = g.s.battle;
    if (!b) { closeModal(); return; }
    if (!S.battleOpen) return;
    S.pickGroups = {};
    const t = S.mv.T[b.id];
    const att = b.att;
    const defOwner = defOwnerOf(b);
    const nx = S.animating || S.driving && !(battleNext() || {}).human ? null : battleNext();
    const act = nx && nx.human ? nx.act : null;
    // the person's own casualties can be changed until the battle moves on
    const editSide = act && act !== 'over' ? humanPickSide(b) : null;
    const editKey = editSide ? `${b.id}:${b.rollNo}:${editSide}` : null;
    if (!editSide) S.edit = null;
    else if (!S.edit || S.edit.key !== editKey) S.edit = { side: editSide, key: editKey, picks: (b.picks[editSide] || []).slice() };
    const h = [];
    h.push(`<div class="battle"><h2>⚔️ ${esc(t.name)}</h2><p class="hint">Round ${Math.max(1, b.round)}${b.sea ? ' · sea battle' : ''}${b.round === 0 && b.bombard && b.bombard.length ? ' · ships ready to bombard' : ''}</p>`);
    h.push(battleBoard(b, att, defOwner));
    if (b.lines && b.lines.length) h.push('<ul class="blines">' + b.lines.map((l) => `<li>${esc(l)}</li>`).join('') + '</ul>');
    const btns = [];
    let note = '';
    const hitSide = act && act !== 'over' ? humanHitSide(b) : null;
    if (hitSide && !S.edit) {
      const n = g.casualtyChoice(hitSide).need;
      note = `<p class="picknote">${n === 1 ? 'Your marked unit is lost' : `All ${n} of your marked units are lost`}${hitSide === 'D' && b.kind !== 'aa' && b.kind !== 'subs' ? ', but they still fire back this round' : ''}.</p>`;
    }
    if (S.edit) {
      const ch = g.casualtyChoice(S.edit.side);
      const left = ch.need - S.edit.picks.length;
      const kind = ch.kind === 'aa' ? ' AA fire only hits aircraft.' : ch.kind === 'subs' ? ' Submarine hits cannot hit aircraft.' : '';
      const fireBack = S.edit.side === 'D' && ch.kind !== 'aa' && ch.kind !== 'subs' ? ' They still fire back this round.' : '';
      note = `<p class="picknote">Your casualties are outlined in red.${fireBack} Tap a unit to lose one of those instead.${kind}${left > 0 ? ` <b>Mark ${left} more.</b>` : ''}</p>`;
    }
    const ready = !S.edit || g.casualtyChoice(S.edit.side).need === S.edit.picks.length;
    const dis = ready ? '' : 'disabled';
    if (!act) {
      h.push(`<p class="hint bstate">${S.animating ? '&nbsp;' : waitText(b, att, defOwner)}</p>`);
    } else if (act === 'over') {
      const r = b.result === 'attacker' ? `${att} wins` : b.retreated ? `${att} retreated` : b.result === 'defender' ? `${defOwner} holds` : 'No winner';
      h.push(`<p class="bstate"><b>${esc(r)}.</b></p>`);
      btns.push('<button class="primary" data-act="over">End of battle</button>');
    } else if (act === 'roll') {
      btns.push('<button class="primary" data-act="roll">Roll dice 🎲</button>');
    } else if (act === 'dive') {
      h.push(`<p class="picknote">The attacker has no destroyer, so your submarines may dive before ${b.round ? 'the next round' : 'the battle starts'}. Submerged subs leave the battle and stay in the sea zone; otherwise they strike first.</p>`);
      btns.push('<button data-act="dive">Submerge subs</button><button class="primary" data-act="stay">Keep them fighting</button>');
    } else if (act === 'defend') {
      h.push(note || '<p class="hint bstate">Your turn to fire back.</p>');
      btns.push(`<button class="primary" data-act="defend" ${dis}>Roll for defense 🎲</button>`);
    } else if (act === 'continue') {
      h.push(note);
      btns.push(`<button class="primary" data-act="continue" ${dis}>Continue 🎲</button>`);
    } else if (act === 'end') {
      const A = g.survivors('A'), D = g.survivors('D').filter((u) => !g.def(u).infrastructure);
      const r = A.length && !D.length ? `${att} wins` : !A.length && D.length ? `${defOwner} holds` : !A.length ? 'Both sides are wiped out' : 'Neither side can harm the other';
      h.push(`<p class="bstate"><b>${esc(r)}.</b></p>`);
      h.push(note);
      btns.push(`<button class="primary" data-act="end" ${dis}>End of battle</button>`);
    } else if (act === 'decide') {
      h.push(note);
      const opts = g.retreatOptions();
      const subs = g.canSubmerge('A');
      if (opts.length) btns.push(`<button data-act="retreat" ${dis}>Retreat</button>`);
      if (subs) btns.push(`<button data-act="submerge" ${dis}>Submerge subs</button>`);
      btns.push(`<button class="primary" data-act="press" ${dis}>Press the attack 🎲</button>`);
    }
    h.push(`<div class="actions">${btns.join('')}</div>`);
    h.push('</div>');
    $('dialog').innerHTML = h.join('');
    $('dialog').querySelectorAll('[data-pick]').forEach((el) => {
      el.onclick = () => togglePick(el.dataset.pick);
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePick(el.dataset.pick); } };
    });
    $('dialog').querySelectorAll('[data-act]').forEach((el) => el.onclick = () => battleAct(el.dataset.act));
  }
  /** While the computer's part of the battle runs: what comes next. */
  function waitText(b, att, defOwner) {
    const you = isHumanPower(att);
    if (b.need === 'decision') return `${esc(att)} decides whether to press the attack…`;
    if (b.step === 'start' || b.step === 'decide') return `${esc(att)} is attacking…`;
    if (b.step === 'fireD') return you ? `${esc(defOwner)} fires back…` : `${esc(defOwner)} fires back…`;
    return you ? 'Your units fire next…' : `${esc(att)} fires next…`;
  }
  /**
   * Tap a unit type: lose one more of it, instead of the most recent other pick when all hits are used.
   * Tapping a type whose units are all marked unmarks one (then tap the type to lose instead).
   */
  function togglePick(key) {
    if (!S.edit || S.animating) return;
    const g = G();
    const side = key.split('|')[0];
    const ch = g.casualtyChoice(side);
    if (!ch) return;
    const group = new Set((S.pickGroups || {})[key] || []);
    const units = ch.units.filter((u) => group.has(u.id));
    if (!units.length) return;
    const picks = S.edit.picks;
    const cnt = {};
    for (const id of picks) cnt[id] = (cnt[id] || 0) + 1;
    const hpOf = (u) => (g.def(u).hp || 1) - (u.h || 0);
    // spread first hits before second hits (battleships)
    const next = units.slice().sort((a, c) => (cnt[a.id] || 0) - (cnt[c.id] || 0)).find((u) => (cnt[u.id] || 0) < hpOf(u));
    if (!next) {
      for (let i = picks.length - 1; i >= 0; i--) if (group.has(picks[i])) { picks.splice(i, 1); break; }
    } else {
      if (picks.length >= ch.need) {
        let i = picks.length - 1;
        while (i >= 0 && group.has(picks[i])) i--;
        if (i < 0) return;
        picks.splice(i, 1);
      }
      picks.push(next.id);
    }
    if (picks.length === ch.need) {
      const r = g.battleAssign(side, picks);
      if (!r.ok) { toast(r.error); S.edit.picks = (g.s.battle.picks[side] || []).slice(); }
      else save();
    }
    renderBattle();
  }
  function closeModal() {
    $('modal').classList.remove('open');
    S.battleOpen = false;
    S.modalClosable = false;
  }

  // ------------------------------------------------------------------ dialogs
  function openDialog(html, closable) {
    $('dialog').innerHTML = html;
    S.modalClosable = closable !== false;
    S.battleOpen = false;
    $('modal').classList.add('open');
    $('dialog').querySelectorAll('[data-close]').forEach((b) => b.onclick = () => { closeModal(); if (b.dataset.close === 'go') continueFlow(); });
  }
  function sidesText() {
    const g = G();
    const by = {};
    for (const p of Object.keys(g.s.powers)) (by[g.s.powers[p].ai ? 'ai' : 'you'] = by[g.s.powers[p].ai ? 'ai' : 'you'] || []).push(p);
    const inc = (p) => (S.sc.income !== false ? `, +${g.income(p)} a turn` : '');
    const fmt = (ps) => (ps || []).map((p) => `<span class="swatch" style="background:${color(p)}"></span> ${esc(p)} <span class="hint">(${g.s.powers[p].team}, ${g.s.powers[p].money} IPC${inc(p)})</span>`).join('<br>');
    return `<p><b>You command</b><br>${fmt(by.you)}</p><p><b>The computer commands</b><br>${fmt(by.ai) || '—'}</p>`;
  }
  function showBriefing() {
    const sc = S.sc;
    const R = Rules.get(sc.ruleset);
    const names = (o) => o.territories.map((id) => '<b>' + esc(S.mv.T[id].name) + '</b>').join(', ');
    const objs = G().objectiveStatus().map((o) => `<li>${D.objectiveWords(o, names(o), false)}</li>`).join('') +
      (G().opponentStatus().length ? `</ul><h3>The enemy wins if it</h3><ul>${G().opponentStatus().map((o) => `<li>${D.objectiveWords(o, names(o), true)}</li>`).join('')}` : '');
    openDialog(`<h2>${esc(sc.title || 'Today\'s puzzle')}</h2>
      ${S.replayOf ? `<p class="hint">No new puzzle was set for today, so this is a replay of #${S.replayOf.number} (${esc(S.replayOf.date)}). Everyone gets the same one.</p>` : ''}
      ${sc.description ? `<p>${esc(sc.description)}</p>` : ''}
      ${sidesText()}
      <h3>${asOpponent() ? 'The player side wins by (stop it)' : 'Objectives'}</h3><ul>${objs}</ul>
      <p class="hint">${winCheckText()} Rules: ${esc(R.name)}. Your moves are saved as you play, so you get one attempt per day.</p>
      ${mapCredit() ? `<p class="hint">Map: ${esc(mapCredit())}</p>` : ''}
      <div class="actions"><button data-close="help" id="brHelp">How to play</button><button class="primary" data-close="go">Start</button></div>`, false);
    $('brHelp').onclick = showHelp;
  }
  function mapCredit() {
    const m = S.map || {};
    if (m.source === 'TripleA') return `${m.origin && m.origin.map ? m.origin.map : m.name} from TripleA (triplea-game.org)${m.credit ? ', ' + m.credit : ''}`;
    return m.credit || '';
  }
  function showHelp() {
    const R = G() ? G().R : Rules.get();
    const rows = Rules.UNIT_ORDER.filter((t) => R.units[t] && t !== 'factory').map((t) => {
      const d = R.units[t];
      return `<tr><td>${I.svg(t, 18)}</td><td>${esc(d.name)}</td><td>${d.cost}</td><td>${d.att}</td><td>${d.def}</td><td>${d.move}</td></tr>`;
    }).join('');
    openDialog(`<h2>How to play</h2>
      <p>Each day brings a small battle from the Second World War. Take the objectives before the turn limit, playing against the computer. Combat works like the classic board game: each unit rolls a die and hits on a roll at or under its attack (or defence) value.</p>
      <h3>Your turn</h3>
      <ol class="hint" style="padding-left:18px">
        <li><b>Buy</b> units with IPCs. They appear at your factories at the end of the turn.</li>
        <li><b>Combat move</b>: tap your units, then a highlighted territory. Red outline = attack.</li>
        <li><b>Battles</b>: you roll, then the defender. Hits are outlined in red and stay until the round ends (defenders still fire back). Tap your units to change which are lost, then press the attack or retreat.</li>
        <li><b>Noncombat move</b>: units that did not fight may reposition; aircraft must land.</li>
        <li><b>Place</b> the units you bought, then end your turn. You collect income from your territories.</li>
      </ol>
      <h3>Controls</h3>
      <p class="hint">Tap a unit icon to select those units; tap it again to drop one; tap another icon to add that type too. Tap the territory itself to select everything (again to clear). −/+ in the panel fine-tune counts. Tap a highlighted territory to move there. Load infantry or tanks by moving them into a sea zone with your transport; select the sea zone and tap a coast to unload. Drag to pan, pinch or scroll to zoom. <kbd>Esc</kbd> cancels, <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes a move.</p>
      <h3>Units (${esc(R.name)})</h3>
      <table class="hint" style="width:100%;border-collapse:collapse"><tr><th></th><th align="left">Unit</th><th>Cost</th><th>Att</th><th>Def</th><th>Move</th></tr>${rows}</table>
      <p class="hint">${esc(R.summary)}</p>
      ${S.map && mapCredit() ? `<p class="hint">Map: ${esc(mapCredit())}</p>` : ''}
      <div class="actions"><button class="primary" data-close="1">Close</button></div>`);
  }
  /**
   * Per-browser stats. `seen` maps each finished date to turns taken (wins) or 0 (losses), and is
   * the source of truth: played/won are recounted from it, which also repairs totals that an
   * earlier version inflated by counting a lost game again on every reload.
   */
  function stats() {
    const st = Object.assign({ played: 0, won: 0, streak: 0, best: 0, last: null, dist: {}, seen: {} }, store.get('tacticle:stats') || {});
    st.seen = st.seen && typeof st.seen === 'object' ? st.seen : {};
    st.dist = st.dist && typeof st.dist === 'object' ? st.dist : {};
    const dates = Object.keys(st.seen);
    st.played = dates.length;
    st.won = dates.filter((d) => st.seen[d] > 0).length;
    return st;
  }
  function recordStats(won, turns) {
    if (S.test || S.mode === 'free') return;
    const st = stats();
    if (Object.prototype.hasOwnProperty.call(st.seen, S.date)) { store.set('tacticle:stats', st); return; }
    st.seen[S.date] = won ? Math.max(1, turns) : 0;
    st.played++;
    if (won) {
      st.won++;
      st.dist[turns] = (st.dist[turns] || 0) + 1;
      st.streak = st.last && D.daysBetween(st.last, S.date) === 1 ? st.streak + 1 : 1;
      st.best = Math.max(st.best, st.streak);
    } else st.streak = 0;
    st.last = S.date;
    store.set('tacticle:stats', st);
  }
  function statsHtml() {
    const st = stats();
    const max = Math.max(1, ...Object.values(st.dist));
    const bars = [1, 2, 3, 4, 5, 6].map((n) => `<div class="row" style="margin:2px 0"><span style="width:16px">${n}</span><div style="background:var(--accent);color:#fff;padding:0 6px;border-radius:4px;min-width:20px;width:${8 + 80 * (st.dist[n] || 0) / max}%">${st.dist[n] || 0}</div></div>`).join('');
    return `<div class="stats"><div><b>${st.played}</b><span>Played</span></div><div><b>${st.played ? Math.round(100 * st.won / st.played) : 0}</b><span>Win %</span></div><div><b>${st.streak}</b><span>Streak</span></div><div><b>${st.best}</b><span>Best</span></div></div><div class="hint">Wins by turns taken</div>${bars}`;
  }
  function showStats() {
    openDialog(`<h2>Statistics</h2>${statsHtml()}<div class="actions"><button class="primary" data-close="1">Close</button></div>`);
  }
  function shareText() {
    const g = G();
    const ht = humanTeam();
    const st = g.objectiveStatus();
    return D.shareText({
      number: S.number, test: S.test, freePlay: S.mode === 'free', title: S.sc.title || 'Puzzle', won: g.s.result.won, turns: g.s.result.turns, maxTurns: g.s.maxTurns,
      objectivesDone: st.reduce((a, o) => a + o.done, 0), objectivesTotal: st.reduce((a, o) => a + o.total, 0),
      targets: g.objectiveTargets(), luckYou: g.luck(ht), luckFoe: g.luck(foeTeam()),
      lossYou: (g.s.losses || {})[ht] || 0,
      lossFoe: Object.keys(g.s.losses || {}).filter((t) => t !== ht).reduce((a, t) => a + g.s.losses[t], 0),
      others: S.mode === 'free' || S.test ? null : S.others, today: S.date === D.today(),
      url: location.origin + location.pathname.replace(/index\.html$/, ''),
    });
  }
  // ---- results of other players (js/results.js; off unless config.json names a GoatCounter site)
  async function resultsCode() {
    if (S.config === undefined) {
      try { S.config = await getJSON('config.json'); } catch (e) { S.config = null; }
    }
    const code = S.config && S.config.results && S.config.results.goatcounter;
    return window.TacticleResults && window.TacticleResults.valid(code) ? code : null;
  }
  /** See how others did today (before our own result counts), then record ours, once per browser. */
  async function reportResult() {
    const R = window.TacticleResults;
    if (S.test || S.mode === 'free' || !S.sc.id || !G().s.result) return;
    const code = await resultsCode();
    if (!code) return;
    const won = !!G().s.result.won;
    const key = `${S.date}:${S.sc.id}`;
    const sent = store.get('tacticle:sent:' + key);
    let others = store.get('tacticle:others:' + key);
    if (!others) {
      try {
        const t = await R.tally(code, S.sc.id, S.date, (u, o) => fetch(u, o));
        others = sent ? R.without(t, won) : t;
        store.set('tacticle:others:' + key, others);
      } catch (e) { /* offline, or the counter is not switched on */ }
    }
    if (!sent) {
      for (const path of [R.dayPath(S.date, S.sc.id, won ? 'won' : 'lost'), R.puzzlePath(S.sc.id, won ? 'won' : 'lost')]) new Image().src = R.hitUrl(code, path);
      store.set('tacticle:sent:' + key, 1);
    }
    S.others = others || null;
    const box = $('shareText');
    if (box) box.textContent = shareText();
  }
  function showResult() {
    const g = G();
    if (!g.s.result) return;
    recordStats(g.s.result.won, g.s.result.turns);
    if (!S.test && S.mode !== 'free' && S.others === undefined) {
      const key = `${S.date}:${S.sc.id}`;
      S.others = store.get('tacticle:others:' + key) || undefined;
    }
    const text = shareText();
    reportResult();
    const next = new Date(); next.setHours(24, 0, 0, 0);
    const mins = Math.max(0, Math.round((next - new Date()) / 60000));
    const free = S.mode === 'free';
    openDialog(`<h2>${free ? 'Free play: ' : ''}${verdict(g.s.result.won)}</h2><p>${esc(g.s.result.reason)}.</p>
      <div class="share" id="shareText">${esc(text)}</div>
      <div class="actions"><button class="primary" id="copyShare">Copy result</button></div>
      ${S.test || free ? '' : statsHtml() + `<p class="hint">Next puzzle in ${Math.floor(mins / 60)}h ${mins % 60}m.</p>`}
      ${S.test ? '' : free
        ? '<div class="actions"><button id="rFreeAgain">Play again</button><button id="rDaily">Back to my result</button></div>'
        : '<p class="hint">Free play lets you replay this setup and try other plans. It does not change your result or stats.</p><div class="actions"><button id="rFree">Free play</button></div>'}
      <div class="actions"><button data-close="1">View the board</button></div>`);
    const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
    on('rFree', () => enterFreePlay(false));
    on('rFreeAgain', () => enterFreePlay(true));
    on('rDaily', exitFreePlay);
    $('copyShare').onclick = async () => {
      try { await navigator.clipboard.writeText(shareText()); toast('Copied to clipboard'); } catch (e) {
        const r = document.createRange(); r.selectNodeContents($('shareText'));
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        toast('Select and copy the text');
      }
    };
  }

  // handle for debugging and automated checks
  window.TacticlePlay = { S, render, nextPhase, fight, undo };
  boot();
})();
