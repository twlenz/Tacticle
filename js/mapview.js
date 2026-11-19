/*
 * Tacticle map view: SVG board with pan / zoom / pinch, owner colours, unit stacks,
 * highlights and move arrows. Shared by the player page and the authoring tool.
 *
 *   const mv = new TacticleMapView(el, map, { onClick, onContext, onHover });
 *   mv.setFocus(ids); mv.update({ owners, units, highlight, selected, objectives, playable, dim });
 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const ORDER = ['infantry', 'artillery', 'tank', 'aaa', 'fighter', 'bomber', 'battleship', 'carrier', 'cruiser', 'destroyer', 'submarine', 'transport', 'factory'];

  class MapView {
    constructor(container, map, opts) {
      this.c = container;
      this.map = map;
      this.opts = opts || {};
      this.T = {};
      for (const t of map.territories) this.T[t.id] = t;
      this.colors = {};
      for (const p of map.powers || []) this.colors[p.id] = p.color;
      this.W = map.width; this.H = map.height;
      this.wrap = false;
      this.offset = {};
      this.state = {};
      this.svg = el('svg', { class: 'tmap', xmlns: NS, preserveAspectRatio: 'xMidYMid meet' });
      this.c.appendChild(this.svg);
      const defs = el('defs', null, this.svg);
      const mk = el('marker', { id: 'tm-arrow', viewBox: '0 0 10 10', refX: 7, refY: 5, markerWidth: 4, markerHeight: 4, orient: 'auto' }, defs);
      el('path', { d: 'M0,0L10,5L0,10z', fill: 'context-stroke' }, mk);
      const pat = el('pattern', { id: 'tm-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
      el('rect', { width: 6, height: 6, fill: 'var(--inactive-land)' }, pat);
      el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: 'var(--inactive-hatch)', 'stroke-width': 2 }, pat);
      this.gWorld = el('g', { class: 'world' }, this.svg);
      this.gMaps = el('g', null, this.gWorld);
      this.gOver = el('g', { class: 'over' }, this.gWorld);
      this.gHit = el('g', { class: 'hits' }, this.gWorld);
      this.gLabels = el('g', { class: 'labels' }, this.gWorld);
      this.gUnits = el('g', { class: 'units' }, this.gWorld);
      this.gArrows = el('g', { class: 'arrows' }, this.gWorld);
      this.els = {};
      this._buildCopy(0);
      this.full = { x: 0, y: 0, w: this.W, h: this.H };
      this._showBox(this.full);
      this._wire();
      this._ro = new ResizeObserver(() => { this._setVB(); this._relayoutSoon(); });
      this._ro.observe(this.c);
    }

    _buildCopy(dx) {
      const g = el('g', { transform: dx ? `translate(${dx},0)` : '' }, this.gMaps);
      el('rect', { x: 0, y: 0, width: this.W, height: this.H, class: 'ocean' }, g);
      const sea = el('g', { class: 'sea' }, g);
      const land = el('g', { class: 'land' }, g);
      for (const t of this.map.territories) {
        const p = el('path', { d: t.path, 'data-id': t.id, class: t.type === 'sea' ? 'tz sea' : 'tz land', 'fill-rule': 'evenodd' }, t.type === 'sea' ? sea : land);
        (this.els[t.id] = this.els[t.id] || []).push(p);
      }
      if (this.map.decor && this.map.decor.land) el('path', { d: this.map.decor.land, class: 'decor', 'fill-rule': 'evenodd' }, land);
      if (this.map.decor && this.map.decor.lakes) el('path', { d: this.map.decor.lakes, class: 'lake', 'fill-rule': 'evenodd' }, g);
      return g;
    }

    /** Fit the view to these territories; wraps across the seam when that is tighter. */
    setFocus(ids, pad) {
      ids = (ids || []).filter((id) => this.T[id]);
      if (!ids.length) { this.full = { x: 0, y: 0, w: this.W, h: this.H }; this._showBox(this.full); this._relayout(); return; }
      const box = (shift) => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const id of ids) {
          const b = this.T[id].bbox;
          const o = shift && this.T[id].center[0] < this.W / 2 ? this.W : 0;
          // sea zones split across the seam: use the part nearest the rest
          let bx0 = b[0], bx1 = b[2];
          if (bx1 - bx0 > this.W * 0.6) { bx0 = this.T[id].center[0] - 40; bx1 = this.T[id].center[0] + 40; }
          x0 = Math.min(x0, bx0 + o); x1 = Math.max(x1, bx1 + o); y0 = Math.min(y0, b[1]); y1 = Math.max(y1, b[3]);
        }
        return { x0, y0, x1, y1 };
      };
      const a = box(false), b = box(true);
      const wrap = this.map.wrapX && (b.x1 - b.x0) < (a.x1 - a.x0) * 0.7;
      this._setWrap(wrap);
      const r = wrap ? b : a;
      const p = pad == null ? 0.08 : pad;
      const w = Math.max(60, r.x1 - r.x0), h = Math.max(40, r.y1 - r.y0);
      this.full = { x: r.x0 - w * p, y: r.y0 - h * p, w: w * (1 + 2 * p), h: h * (1 + 2 * p) };
      this._showBox(this.full);
      this._relayout();
    }
    _setWrap(on) {
      if (on === this.wrap) return;
      this.wrap = on;
      if (on) this._buildCopy(this.W);
      else {
        while (this.gMaps.childNodes.length > 1) this.gMaps.removeChild(this.gMaps.lastChild);
        for (const id of Object.keys(this.els)) this.els[id].length = 1;
      }
      for (const t of this.map.territories) this.offset[t.id] = on && t.center[0] < this.W / 2 ? this.W : 0;
      this.update(this.state);
    }
    fit() { this._showBox(this.full); this._relayout(); }

    /*
     * The view is a centre point plus a scale (map units per screen pixel). The viewBox is
     * derived from those and the container size, so resizing the page (phone address bar,
     * panel height) never moves or zooms the map.
     */
    _size() { return { cw: this.c.clientWidth || 800, ch: this.c.clientHeight || 600 }; }
    _showBox(b) {
      const { cw, ch } = this._size();
      this.view = { cx: b.x + b.w / 2, cy: b.y + b.h / 2, k: Math.max(b.w / cw, b.h / ch) };
      this._setVB();
    }
    _clampK(k) {
      const { cw } = this._size();
      return Math.min(Math.max(k, 30 / cw), (this.W * 1.5) / cw);
    }
    _setVB() {
      const { cw, ch } = this._size();
      const v = this.view || { cx: this.W / 2, cy: this.H / 2, k: this.W / cw };
      v.k = this._clampK(v.k);
      this.view = v;
      const w = cw * v.k, h = ch * v.k;
      this.vb = { x: v.cx - w / 2, y: v.cy - h / 2, w, h };
      this.svg.setAttribute('viewBox', `${this.vb.x} ${this.vb.y} ${w} ${h}`);
      this.k = v.k; // map units per screen pixel
    }
    /** Zoom by factor f keeping map point (px, py) under the same spot on screen. */
    zoom(f, px, py) {
      const v = this.view;
      if (px == null) { px = v.cx; py = v.cy; }
      const k2 = this._clampK(v.k * f);
      const r = k2 / v.k;
      this.view = { cx: px - (px - v.cx) * r, cy: py - (py - v.cy) * r, k: k2 };
      this._setVB();
      this._relayoutSoon();
    }
    _toMap(ev) {
      const r = this.svg.getBoundingClientRect();
      return { x: this.vb.x + (ev.clientX - r.left) * this.k, y: this.vb.y + (ev.clientY - r.top) * this.k };
    }
    _wire() {
      const pts = new Map();
      let drag = null, moved = false, pinch = null;
      this.svg.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        const m = this._toMap(ev);
        this.zoom(Math.exp(ev.deltaY * 0.0015), m.x, m.y);
      }, { passive: false });
      this.svg.addEventListener('pointerdown', (ev) => {
        pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (pts.size === 1) { drag = { x: ev.clientX, y: ev.clientY, cx: this.view.cx, cy: this.view.cy }; moved = false; }
        if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          const r = this.svg.getBoundingClientRect();
          const mx = (a.x + b.x) / 2 - r.left - r.width / 2, my = (a.y + b.y) / 2 - r.top - r.height / 2;
          // the map point under the fingers' midpoint stays under it
          pinch = { d: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1), k: this.view.k, px: this.view.cx + mx * this.view.k, py: this.view.cy + my * this.view.k };
          drag = null;
          moved = true;
        }
      });
      window.addEventListener('pointermove', (ev) => {
        if (!pts.has(ev.pointerId)) {
          if (this.opts.onHover) { const id = this._idAt(ev); if (id !== this._hover) { this._hover = id; this.opts.onHover(id, ev); } }
          return;
        }
        pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (pinch && pts.size === 2) {
          const [a, b] = [...pts.values()];
          const d = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
          const r = this.svg.getBoundingClientRect();
          const mx = (a.x + b.x) / 2 - r.left - r.width / 2, my = (a.y + b.y) / 2 - r.top - r.height / 2;
          const k = this._clampK(pinch.k * pinch.d / d);
          this.view = { cx: pinch.px - mx * k, cy: pinch.py - my * k, k };
          this._setVB();
          this._relayoutSoon();
          return;
        }
        if (drag) {
          const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
          if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
          if (moved) {
            this.view.cx = drag.cx - dx * this.view.k;
            this.view.cy = drag.cy - dy * this.view.k;
            this._setVB();
          }
        }
      });
      const up = (ev) => {
        if (!pts.has(ev.pointerId)) return;
        pts.delete(ev.pointerId);
        if (pinch && pts.size === 1) {
          // one finger left after a pinch: continue as a drag from where things are now
          const [p] = [...pts.values()];
          drag = { x: p.x, y: p.y, cx: this.view.cx, cy: this.view.cy };
        }
        if (pts.size < 2) pinch = null;
        if (!pts.size) drag = null;
        this._relayoutSoon();
      };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      this.svg.addEventListener('click', (ev) => {
        if (moved) { moved = false; return; }
        const id = this._idAt(ev);
        if (this.opts.onClick) this.opts.onClick(id, ev, this._chipAt(ev));
      });
      this.svg.addEventListener('dblclick', (ev) => {
        const id = this._idAt(ev);
        if (this.opts.onDblClick) { ev.preventDefault(); this.opts.onDblClick(id, ev); }
      });
      this.svg.addEventListener('contextmenu', (ev) => {
        if (!this.opts.onContext) return;
        ev.preventDefault();
        this.opts.onContext(this._idAt(ev), ev);
      });
    }
    /** The unit chip under the pointer, if any: {t: unit type, o: owner}. */
    _chipAt(ev) {
      let t = ev.target;
      while (t && t !== this.svg) {
        if (t.classList && t.classList.contains('chip')) return { t: t.getAttribute('data-t'), o: t.getAttribute('data-o') };
        t = t.parentNode;
      }
      return null;
    }
    _idAt(ev) {
      let t = ev.target;
      while (t && t !== this.svg) {
        if (t.getAttribute && t.getAttribute('data-id')) return t.getAttribute('data-id');
        t = t.parentNode;
      }
      return null;
    }

    /**
     * s: {owners:{id:power|null}, units:{id:[{o,t,n,cargo,dmg}]}, playable:Set, highlight:{id:cls},
     *     selected:id, objectives:{id:'capture'|'hold'|'destroy'}, labels:'playable'|'all'|'none', dimInactive:bool}
     */
    update(s) {
      this.state = s || {};
      s = this.state;
      const play = s.playable;
      for (const t of this.map.territories) {
        const els = this.els[t.id];
        const active = !play || play.has(t.id);
        for (const e of els) {
          let cls = 'tz ' + t.type;
          if (!active) cls += ' inactive';
          if (s.highlight && s.highlight[t.id]) cls += ' hl-' + s.highlight[t.id];
          if (s.selected === t.id) cls += ' selected';
          e.setAttribute('class', cls);
          if (t.type !== 'sea') {
            const o = s.owners ? s.owners[t.id] : t.owner;
            e.style.fill = active || !s.dimInactive ? (o ? (this.colors[o] || '#999') : 'var(--neutral)') : '';
          }
        }
      }
      this._relayout();
    }
    _relayoutSoon() {
      if (this._rl) return;
      this._rl = requestAnimationFrame(() => { this._rl = null; this._relayout(); });
    }
    _relayout() {
      const s = this.state || {};
      const k = this.k || 1;
      const scale = (this.opts.unitScale || 1) * ((this.c.clientWidth || 800) < 600 ? 0.84 : 1);
      this.gUnits.textContent = '';
      this.gLabels.textContent = '';
      this.gOver.textContent = '';
      this.gHit.textContent = '';
      const play = s.playable;
      const ids = this.map.territories.filter((t) => !play || play.has(t.id)).map((t) => t.id);
      const v = this.vb;
      const inView = (x, y) => x > v.x - 50 && x < v.x + v.w + 50 && y > v.y - 50 && y < v.y + v.h + 50;
      // land highlight outlines above land
      for (const id of ids) {
        const t = this.T[id];
        const hl = s.highlight && s.highlight[id];
        const sel = s.selected === id;
        const obj = s.objectives && s.objectives[id];
        if (t.type === 'sea') continue;
        if (hl || sel || obj) {
          const o = this.offset[id] || 0;
          el('path', { d: t.path, class: `outline${hl ? ' hl-' + hl : ''}${sel ? ' selected' : ''}${obj ? ' obj' : ''}`, transform: o ? `translate(${o},0)` : '', 'fill-rule': 'evenodd', 'stroke-width': (sel ? 3.2 : 2.4) * k }, this.gOver);
        }
      }
      const showLabels = s.labels !== 'none';
      const fs = 11 * k * scale;
      for (const id of ids) {
        const t = this.T[id];
        const o = this.offset[id] || 0;
        const cx = t.center[0] + o, cy = t.center[1];
        if (!inView(cx, cy)) continue;
        // generous hit target for small islands
        const bw = t.bbox[2] - t.bbox[0], bh = t.bbox[3] - t.bbox[1];
        if (t.type !== 'sea' && Math.max(bw, bh) < 18 * k) el('circle', { cx, cy, r: 16 * k, 'data-id': id, class: 'hit' }, this.gHit);
        const units = (s.units && s.units[id]) || [];
        const chips = units.slice().sort((a, b) => (a.o === b.o ? 0 : a.o < b.o ? -1 : 1) || ORDER.indexOf(a.t) - ORDER.indexOf(b.t));
        const size = 27 * k * scale;
        const per = Math.min(chips.length, chips.length > 6 ? 4 : 3) || 1;
        const rows = Math.ceil(chips.length / per);
        let y0 = cy - (rows * (size + 2 * k)) / 2 + (showLabels ? fs * 0.6 : 0);
        if (showLabels && (s.labels === 'all' || !play || play.has(id))) {
          const obj = s.objectives && s.objectives[id];
          const name = (obj ? '★ ' : '') + t.name + (t.type === 'land' && t.ipc ? ` (${t.ipc})` : '');
          const ty = chips.length ? y0 - fs * 0.45 : cy + fs * 0.35;
          const tx = el('text', { x: cx, y: ty, 'font-size': fs, class: 'tlabel ' + t.type + (obj ? ' obj' : '') }, this.gLabels);
          tx.textContent = name;
        }
        chips.forEach((c, i) => {
          const r = Math.floor(i / per), col = i % per;
          const inRow = Math.min(per, chips.length - r * per);
          const x = cx - (inRow * (size + 2 * k)) / 2 + col * (size + 2 * k);
          const y = y0 + r * (size + 2 * k);
          const g = el('g', { transform: `translate(${x},${y})`, class: 'chip' + (c.dim ? ' dim' : '') + (c.sel ? ' sel' : ''), 'data-id': id, 'data-t': c.t, 'data-o': c.o }, this.gUnits);
          el('rect', { width: size, height: size, rx: size * 0.22, fill: this.colors[c.o] || '#777', class: 'chipbg' }, g);
          const ic = el('g', { transform: `translate(${size / 2},${size / 2 - size * 0.05}) scale(${size / 30})`, fill: '#fff', color: '#fff' }, g);
          ic.innerHTML = (root.TacticleIcons && root.TacticleIcons.ICON[c.t]) || '';
          if (c.n > 1 || c.sel) {
            const lbl = c.sel ? `${c.sel}/${c.n}` : String(c.n);
            const bw2 = size * (0.32 + 0.16 * lbl.length);
            el('rect', { x: size - bw2 * 0.75, y: size - size * 0.42, width: bw2, height: size * 0.46, rx: size * 0.2, class: 'cnt' + (c.sel ? ' on' : '') }, g);
            const tt = el('text', { x: size - bw2 * 0.75 + bw2 / 2, y: size - size * 0.07, 'font-size': size * 0.4, class: 'cnttext' }, g);
            tt.textContent = lbl;
          }
          if (c.cargo) {
            const tt = el('text', { x: size / 2, y: -size * 0.08, 'font-size': size * 0.34, class: 'cargo' }, g);
            tt.textContent = '+' + c.cargo;
          }
          if (c.dmg) el('circle', { cx: size * 0.18, cy: size * 0.2, r: size * 0.12, class: 'dmg' }, g);
        });
      }
      this._drawArrows();
    }
    arrows(list) { this._arrows = list || []; this._drawArrows(); }
    _drawArrows() {
      this.gArrows.textContent = '';
      const k = this.k || 1;
      for (const a of this._arrows || []) {
        const pts = a.path.map((id) => { const t = this.T[id]; return [t.center[0] + (this.offset[id] || 0), t.center[1]]; });
        if (pts.length < 2) continue;
        const d = 'M' + pts.map((p) => p.join(',')).join('L');
        el('path', { d, class: 'arrow ' + (a.cls || ''), 'stroke-width': 4 * k, 'marker-end': 'url(#tm-arrow)' }, this.gArrows);
      }
    }
    flash(id, cls) {
      for (const e of this.els[id] || []) {
        e.classList.add(cls || 'flash');
        setTimeout(() => e.classList.remove(cls || 'flash'), 700);
      }
    }
    /** Screen (client) position of a territory's centre. */
    screenOf(id) {
      const t = this.T[id];
      const r = this.svg.getBoundingClientRect();
      return { x: r.left + (t.center[0] + (this.offset[id] || 0) - this.vb.x) / this.k, y: r.top + (t.center[1] - this.vb.y) / this.k };
    }
    destroy() { this._ro.disconnect(); this.svg.remove(); }
  }
  root.TacticleMapView = MapView;
})(typeof self !== 'undefined' ? self : this);
