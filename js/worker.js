/* Web worker for the authoring tool: generation and AI self-play off the UI thread. */
/* global importScripts, TacticleGen, TacticleAI */
importScripts('rulesets.js', 'engine.js', 'ai.js', 'generator.js');
const maps = {};
self.onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.map) maps[m.map.id] = m.map;
    const map = maps[m.mapId || (m.map && m.map.id)];
    if (!map) throw new Error('Map not loaded in worker');
    if (m.cmd === 'generate') {
      self.postMessage({ id: m.id, ok: true, sc: TacticleGen.generate(map, m.opts) });
    } else if (m.cmd === 'variant') {
      self.postMessage({ id: m.id, ok: true, sc: TacticleGen.variant(map, m.sc, m.opts) });
    } else if (m.cmd === 'selfplay') {
      const games = m.games || 20;
      const out = { won: 0, turns: {}, reasons: {} };
      for (let i = 0; i < games; i++) {
        const r = TacticleAI.selfPlay(map, m.sc, { seed: (m.seed || 1) + i * 7919, ai: { trials: 40 } });
        if (r.won) { out.won++; out.turns[r.turns] = (out.turns[r.turns] || 0) + 1; }
        const why = r.result ? r.result.reason.replace(/\d+ turns?/, 'N turns') : 'unfinished';
        out.reasons[why] = (out.reasons[why] || 0) + 1;
        self.postMessage({ id: m.id, progress: (i + 1) / games });
      }
      out.games = games;
      self.postMessage({ id: m.id, ok: true, result: out });
    }
  } catch (e) {
    self.postMessage({ id: m.id, ok: false, error: String(e && e.message || e) });
  }
};
