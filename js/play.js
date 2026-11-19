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
    sel: null, dest: {}, undo: [], busy: false, fast: false, placeType: null, picks: {}, waitAck: null,
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
    $('puzzleNo').textContent = S.test ? 'test' : `#${S.number} · ${S.date}`;
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
    S.chooseOwn = store.get('tacticle:chooseCasualties') === true;
    S.g.s.autoCasualties = !S.chooseOwn;
    S.ai = new TAI(S.g);
    S.sel = null; S.dest = {}; S.unload = {}; S.placeType = null; S.picks = {};
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
  function color(p) { return (S.map.powers.find((x) => x.id === p) || {}).color || '#888'; }
  function uname(t) { return (G().R.units[t] || {}).name || t; }
  function canUndo() { return humanTurn() && S.undo.length > 0 && ['combatMove', 'noncombatMove', 'place'].includes(G().phase) && !G().s.battle; }
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
    if (!S.sel) return;
    const g = G();
    const ids = selIds();
    if (ids.length) S.dest = g.destinations(S.sel.from, ids);
    const cargo = selIds(true).length ? selIds(true) : allCargo();
    if (cargo.length && !(ids.length && ids.every((id) => cargo.includes(id)))) {
      S.unload = g.destinations(S.sel.from, cargo);
    }
  }
  function clearSel(silent) {
    S.sel = null; S.dest = {}; S.unload = {};
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
    if (S.sel && id !== S.sel.from && (S.dest[id] || S.unload[id])) return doMove(id);
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
    if (!kind && S.unload[to]) { ids = selIds(true).length ? selIds(true) : allCargo(); kind = S.unload[to]; }
    const chk = g.checkMove(from, ids, to);
    if (!chk.ok) { toast(chk.error); return; }
    pushUndo();
    const r = g.move(from, ids, to);
    if (!r.ok) { S.undo.pop(); toast(r.error); return; }
    S.mv.arrows([{ path: chk.plan[0].path }]);
    setTimeout(() => S.mv.arrows([]), 900);
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
    if (g.phase === 'combat') for (const id of g.s.battles) hl[id] = 'battle';
    if (g.phase === 'place' && S.placeType && humanTurn()) for (const id of g.placeTargets(S.placeType)) hl[id] = 'place';
    const objectives = {};
    for (const o of S.sc.objectives || []) for (const id of o.territories || []) objectives[id] = o.type;
    S.mv.update({ owners, units, highlight: hl, selected: sel, objectives, playable: new Set(S.sc.playable), dimInactive: true, labels: 'playable' });
  }

  function renderPanel() {
    const g = G();
    const p = g.current();
    const parts = [];
    // objectives
    const st = g.objectiveStatus();
    parts.push(`<div class="h">Objectives${G().objectivesNeeded() < st.filter((o) => o.type !== 'hold').reduce((a, o) => a + o.total, 0) ? ` (need ${G().objectivesNeeded()})` : ''}</div><ul class="objlist">` + st.map((o) => {
      const verb = o.type === 'hold' ? 'Hold' : o.type === 'destroy' ? 'Clear enemies from' : 'Capture';
      return o.territories.map((id) => {
        const t = S.mv.T[id];
        const ok = o.type === 'destroy' ? !g.units(id).some((u) => g.team(u.o) !== humanTeam() && !g.def(u).infrastructure)
          : g.s.terr[id].o && g.team(g.s.terr[id].o) === humanTeam();
        return `<li class="${ok ? 'done' : ''}">${verb} <b>${esc(t.name)}</b></li>`;
      }).join('');
    }).join('') + `</ul><div class="hint" style="margin-top:4px">${winCheckText()}</div>`);

    if (S.mode === 'free' && !S.busy) {
      parts.push('<div class="h">Free play</div><p class="hint">Practice on today\'s setup. It does not change your result or stats.</p><div class="actions"><button id="pFreeReset">↺ Reset board</button><button id="pDaily">Back to my result</button></div>');
    }
    if (g.phase === 'gameOver') {
      parts.push(`<div class="h">Result</div><p><b>${g.s.result.won ? '🏆 Victory' : '💀 Defeat'}</b> — ${esc(g.s.result.reason)}</p><div class="actions"><button class="primary" id="pResult">Share result</button>${!S.test && S.mode === 'daily' ? '<button id="pFree">Free play</button>' : ''}</div>`);
      if (S.test) parts.push('<div class="actions"><button id="pRestart">Restart test</button></div>');
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
  function winCheckText() {
    const holds = (S.sc.objectives || []).some((o) => o.type === 'hold');
    const need = G().objectivesNeeded();
    const total = (S.sc.objectives || []).filter((o) => o.type !== 'hold').reduce((a, o) => a + (o.territories || []).length, 0);
    const some = need < total ? `Any ${need} of the ${total} capture objectives is enough. ` : '';
    return some + winCheckTiming(holds);
  }
  function winCheckTiming(holds) {
    if (S.sc.winCheck === 'roundEnd' || holds) return `Checked at the end of each round${holds ? '; held territories must be kept every turn' : ''}. ${G().s.maxTurns} turns.`;
    return `Win as soon as they are yours at the end of your turn. ${G().s.maxTurns} turns.`;
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
    }).join('') + '</div><p class="hint">Highlighted territories are valid destinations. Esc or right-click to cancel.</p>';
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
    if (g.s.battle && g.s.battle.held && !S.animating) {
      // reloaded while hits were on show: finish applying them
      openBattle();
      animateBattle().then(afterBattleAction);
      return;
    }
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
        if (b && b.over && humanInvolved(b) && !S.fast) {
          openBattle();
          await new Promise((res) => { S.waitAck = res; });
        }
        if (!b && humanTurn()) break;
        if (b && !b.over && humanInvolved(b)) {
          if (b.held) { openBattle(); await animateBattle(); continue; }
          if (b.need === 'roll' && g.s.powers[b.att].ai && S.battleOpen) await shrinkDice();
        }
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
        if (g.s.battle && humanInvolved(g.s.battle)) openBattle();
        else if (a.type === 'battleEnd' && $('modal').classList.contains('open') && S.battleOpen) closeModal();
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
    if (g.s.battle && !g.s.battle.over) openBattle();
    else if (g.phase === 'gameOver') showResult();
    else continueFlow();
  }
  function humanInvolved(b) {
    const g = G();
    if (!g.s.powers[b.att].ai) return true;
    return g.units(b.id).some((u) => !g.s.powers[u.o].ai) || (b.lostD && Object.keys(b.lostD).length) || (b.lost && b.lost.D && Object.keys(b.lost.D).length && humanTeam() !== g.team(b.att));
  }

  // ------------------------------------------------------------------ battles
  function fight(id) {
    const g = G();
    if (g.s.battle) { openBattle(); return; }
    const r = g.startBattle(id);
    if (!r.ok) { toast(r.error); return; }
    S.undo = [];
    save();
    openBattle();
  }
  function openBattle() {
    S.battleOpen = true;
    S.modalClosable = false;
    $('modal').classList.add('open');
    renderBattle();
  }
  function bunits(list, side, pickable, hitIds) {
    const g = G();
    const groups = {};
    for (const u of list) {
      const k = u.t + '|' + (u.h || 0);
      if (!groups[k]) groups[k] = { t: u.t, h: u.h || 0, o: u.o, ids: [] };
      groups[k].ids.push(u.id);
    }
    const b = g.s.battle;
    return Object.values(groups).map((gr) => {
      const d = g.def(gr.t);
      const val = side === 'A' ? d.att : d.def;
      const picked = pickable ? (S.picks[side] || []).filter((id) => gr.ids.includes(id)).length : 0;
      const doomed = b ? gr.ids.filter((id) => b.doomed.includes(id)).length : 0;
      const hits = hitIds ? hitIds.filter((id) => gr.ids.includes(id)).length : 0;
      const minus = picked || hits;
      return `<div class="bunit ${pickable ? 'pick' : ''} ${picked ? 'picked' : ''} ${hits ? 'shake' : ''} ${doomed === gr.ids.length ? 'dead' : ''}" style="background:${color(gr.o)}" title="${esc(d.name)}${gr.h ? ' (damaged)' : ''}" ${pickable ? `data-pick="${side}|${gr.t}|${gr.h}"` : ''}>
        ${I.svg(gr.t, 28, '#fff')}<span class="v">${val}</span><span class="n">${gr.ids.length}</span>${minus ? `<span class="x">−${minus}</span>` : ''}${gr.h ? '<span class="x" style="left:auto;right:-5px;top:-5px;background:#ff8800">dmg</span>' : ''}</div>`;
    }).join('');
  }
  function renderBattle() {
    const g = G();
    const b = g.s.battle;
    if (!b) { closeModal(); return; }
    const t = S.mv.T[b.id];
    const A = g._side('A');
    const Dd = g._side('D');
    const defOwner = (Dd[0] && Dd[0].o) || g.s.terr[b.id].o || '—';
    const att = b.att;
    const humanA = !g.s.powers[att].ai;
    const held = b.need === 'casualties' && b.held;
    const needA = !held && b.need === 'casualties' && b.pend.A && !b.picks.A && humanA;
    const needD = !held && b.need === 'casualties' && b.pend.D && !b.picks.D && Dd.length && !g.s.powers[Dd[0].o].ai;
    const shakeA = held && S.shaking ? b.picks.A : null;
    const shakeD = held && S.shaking ? b.picks.D : null;
    for (const side of ['A', 'D']) {
      if ((side === 'A' ? needA : needD) && !S.picks[side + 'init']) {
        const ch = g.casualtyChoice(side);
        S.picks[side] = ch ? ch.auto.slice() : [];
        S.picks[side + 'init'] = true;
      }
    }
    // dice added since the last render grow in; everything else is drawn still
    if (S.diceRoll !== b.rollNo) { S.diceRoll = b.rollNo; S.diceSeen = { A: 0, D: 0 }; }
    const seen = S.diceSeen || { A: 0, D: 0 };
    const dice = (arr, side) => arr.map((d, i) => {
      const fresh = i >= seen[side];
      return `<span class="die ${d.hit ? 'hit' : ''} ${fresh ? 'new' : ''}" ${fresh ? `style="animation-delay:${Math.min(220, (i - seen[side]) * 22)}ms"` : ''} title="${esc(uname(d.t))} needs ${d.v} or less">${d.die}</span>`;
    }).join('');
    S.diceSeen = { A: (b.dice.A || []).length, D: (b.dice.D || []).length };
    const h = [];
    h.push(`<div class="battle"><h2>⚔️ ${esc(t.name)}</h2><p class="hint">Round ${Math.max(1, b.round)}${b.sea ? ' · sea battle' : ''}${b.bombard && b.bombard.length ? ' · shore bombardment ready' : ''}</p>`);
    h.push('<div class="sides">');
    h.push(`<div><div class="side-h"><span class="swatch" style="background:${color(att)}"></span>Attacker · ${esc(att)}</div><div class="units">${bunits(A, 'A', needA, shakeA)}</div><div class="dice">${dice(b.dice.A || [], 'A')}</div></div>`);
    h.push(`<div><div class="side-h"><span class="swatch" style="background:${color(defOwner)}"></span>Defender · ${esc(defOwner)}</div><div class="units">${bunits(Dd, 'D', needD, shakeD)}</div><div class="dice">${dice(b.dice.D || [], 'D')}</div></div>`);
    h.push('</div>');
    if (b.lines && b.lines.length) h.push('<ul class="blines">' + b.lines.map((l) => `<li>${esc(l)}</li>`).join('') + '</ul>');
    const btns = [];
    if (held || S.animating) {
      h.push('<p class="hint" style="min-height:1.4em">&nbsp;</p>');
    } else if (b.over) {
      const r = b.result === 'attacker' ? `${att} wins` : b.result === 'defender' ? `${defOwner} holds` : 'No winner';
      h.push(`<p><b>${esc(r)}.</b></p>`);
      btns.push('<button class="primary" id="bClose">Continue</button>');
    } else if (needA || needD) {
      const side = needA ? 'A' : 'D';
      const ch = g.casualtyChoice(side);
      const kind = ch.kind === 'aa' ? ' (aircraft only)' : ch.kind === 'subs' ? ' (submarine hits cannot hit aircraft)' : '';
      h.push(`<p class="picknote">Choose ${ch.need} casualt${ch.need === 1 ? 'y' : 'ies'}${kind}: tap your units to mark or unmark them.</p>`);
      h.push(`<p class="hint">Picked ${(S.picks[side] || []).length} of ${ch.need}. Battleships take a hit before sinking.</p>`);
      btns.push(`<button id="bReset">Reset to default</button><button class="primary" id="bConfirm" data-side="${side}">Confirm casualties</button>`);
    } else if (b.need === 'roll' && humanA) {
      btns.push('<button id="bAuto">Fight to the end</button><button class="primary" id="bRoll">Roll dice 🎲</button>');
    } else if (b.need === 'decision' && humanA) {
      const opts = g.retreatOptions();
      const enemyDestroyer = Dd.some((u) => g.def(u).antiSub);
      const subs = A.some((u) => g.def(u).sub) && !enemyDestroyer;
      if (opts.length) btns.push(`<select id="bRetTo">${opts.map((id) => `<option value="${id}">${id === b.id ? 'Break off' : 'Retreat to ' + esc(S.mv.T[id].name)}</option>`).join('')}</select><button id="bRetreat">Retreat</button>`);
      if (subs) btns.push('<button id="bSub">Submerge subs</button>');
      btns.push('<button id="bAuto">Fight to the end</button><button class="primary" id="bCont">Next round 🎲</button>');
    } else {
      h.push('<p class="hint">…</p>');
    }
    h.push(`<div class="actions">${btns.join('')}</div>`);
    if (!b.over) h.push(`<label class="chk hint" style="margin-top:10px"><input type="checkbox" id="bChoose" ${S.chooseOwn ? 'checked' : ''}> Let me choose my casualties</label>`);
    h.push('</div>');
    $('dialog').innerHTML = h.join('');
    const ch = $('bChoose');
    if (ch) ch.onchange = () => { S.chooseOwn = ch.checked; store.set('tacticle:chooseCasualties', S.chooseOwn); g.s.autoCasualties = !S.chooseOwn; save(); };
    const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
    $('dialog').querySelectorAll('[data-pick]').forEach((el) => el.onclick = () => togglePick(el.dataset.pick));
    on('bRoll', () => rollWith(() => g.battleRoll()));
    on('bCont', () => rollWith(() => g.battleContinue()));
    on('bAuto', () => { g.autoResolve(); afterBattleAction(); });
    on('bRetreat', () => { g.battleRetreat($('bRetTo').value); afterBattleAction(); });
    on('bSub', () => { const r = g.battleSubmerge('A'); if (!r.ok) toast(r.error); afterBattleAction(); });
    on('bReset', () => { const side = needA ? 'A' : 'D'; S.picks[side] = g.casualtyChoice(side).auto.slice(); renderBattle(); });
    on('bConfirm', (e) => {
      const side = e.currentTarget.dataset.side;
      const r = g.battleAssign(side, S.picks[side]);
      if (!r.ok) { toast(r.error); return; }
      S.picks = {};
      animateBattle().then(afterBattleAction);
    });
    on('bClose', () => {
      if (S.waitAck) { const f = S.waitAck; S.waitAck = null; closeModal(); f(); return; }
      g.closeBattle();
      save();
      closeModal();
      render();
      continueFlow();
    });
  }
  function togglePick(key) {
    const g = G();
    const [side, t, h] = key.split('|');
    const ch = g.casualtyChoice(side);
    const ids = ch.units.filter((u) => u.t === t && String(u.h || 0) === h).map((u) => u.id);
    const picks = S.picks[side] || [];
    const hpOf = (id) => (g.def(t).hp || 1) - (ch.units.find((u) => u.id === id).h || 0);
    // add one more hit to this group if room, otherwise clear the group
    const used = picks.filter((id) => ids.includes(id)).length;
    const room = ids.reduce((a, id) => a + hpOf(id), 0);
    if (picks.length < ch.need && used < room) {
      // next id: spread first hits before second hits
      const cnt = {};
      for (const id of picks) cnt[id] = (cnt[id] || 0) + 1;
      const next = ids.slice().sort((a, b) => (cnt[a] || 0) - (cnt[b] || 0)).find((id) => (cnt[id] || 0) < hpOf(id));
      picks.push(next);
    } else {
      S.picks[side] = picks.filter((id) => !ids.includes(id));
      renderBattle();
      return;
    }
    S.picks[side] = picks;
    renderBattle();
  }
  // ---- battle animation: dice grow in, hit units shake, then the hits are applied
  async function shrinkDice() {
    const boxes = [...$('dialog').querySelectorAll('.dice')];
    if (!boxes.some((x) => x.children.length)) return;
    boxes.forEach((x) => x.classList.add('out'));
    await sleep(S.fast ? 0 : 150);
  }
  async function animateBattle() {
    if (S.animating) return;
    S.animating = true;
    try {
      for (let i = 0; i < 30; i++) {
        renderBattle();
        await sleep(S.fast ? 0 : 380);
        const b = G().s.battle;
        if (!b || b.over || !(b.need === 'casualties' && b.held)) break;
        S.shaking = true;
        renderBattle();
        await sleep(S.fast ? 0 : 480);
        S.shaking = false;
        G().battleCommit();
        save();
      }
    } finally {
      S.animating = false;
      S.shaking = false;
    }
  }
  async function rollWith(fn) {
    if (S.animating) return;
    await shrinkDice();
    fn();
    save();
    await animateBattle();
    afterBattleAction();
  }
  function afterBattleAction() {
    S.picks = {};
    save();
    render();
    renderBattle();
    if (S.busy) return;
    const b = G().s.battle;
    if (b && G().s.powers[b.att].ai) runAI();
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
    const fmt = (ps) => (ps || []).map((p) => `<span class="swatch" style="background:${color(p)}"></span> ${esc(p)} <span class="hint">(${g.s.powers[p].team}, ${g.s.powers[p].money} IPC)</span>`).join('<br>');
    return `<p><b>You command</b><br>${fmt(by.you)}</p><p><b>The computer commands</b><br>${fmt(by.ai) || '—'}</p>`;
  }
  function showBriefing() {
    const sc = S.sc;
    const R = Rules.get(sc.ruleset);
    const objs = G().objectiveStatus().map((o) => `<li>${o.type === 'hold' ? 'Hold' : o.type === 'destroy' ? 'Clear enemies from' : 'Capture'} ${o.territories.map((id) => '<b>' + esc(S.mv.T[id].name) + '</b>').join(', ')}</li>`).join('');
    openDialog(`<h2>${esc(sc.title || 'Today\'s puzzle')}</h2>
      ${S.replayOf ? `<p class="hint">No new puzzle was set for today, so this is a replay of #${S.replayOf.number} (${esc(S.replayOf.date)}). Everyone gets the same one.</p>` : ''}
      ${sc.description ? `<p>${esc(sc.description)}</p>` : ''}
      ${sidesText()}
      <h3>Objectives</h3><ul>${objs}</ul>
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
        <li><b>Battles</b>: roll each round, choose your casualties, keep going or retreat.</li>
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
      url: location.origin + location.pathname.replace(/index\.html$/, ''),
    });
  }
  function showResult() {
    const g = G();
    if (!g.s.result) return;
    recordStats(g.s.result.won, g.s.result.turns);
    const text = shareText();
    const next = new Date(); next.setHours(24, 0, 0, 0);
    const mins = Math.max(0, Math.round((next - new Date()) / 60000));
    const free = S.mode === 'free';
    openDialog(`<h2>${free ? 'Free play: ' : ''}${g.s.result.won ? '🏆 Victory!' : '💀 Defeat'}</h2><p>${esc(g.s.result.reason)}.</p>
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
      try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); } catch (e) {
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
