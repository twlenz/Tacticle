/*
 * Player results, counted with GoatCounter (https://www.goatcounter.com), so a static site can show how
 * other players did and the authoring tool can compare real win rates with the balance check.
 *
 * Off until config.json names a GoatCounter site code: { "results": { "goatcounter": "mycode" } }.
 * In GoatCounter's site settings, turn on "Allow adding visitor counts on your website" so the counts can
 * be read back. Each finished daily game is recorded once per browser as two hits:
 *   /tacticle/<date>/<puzzle id>/won|lost      that day's result
 *   /tacticle/puzzle/<puzzle id>/won|lost      the puzzle over all its days
 * Nothing about the player is sent beyond what any page view sends (GoatCounter keeps no cookies).
 * Anyone could send fake hits, so treat the numbers as a guide, not a record.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TacticleResults = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CODE = /^[a-z0-9][a-z0-9-]{1,48}$/;
  const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  function valid(code) { return typeof code === 'string' && CODE.test(code); }
  function dayPath(date, id, outcome) {
    if (!DATE.test(date) || !SLUG.test(id)) throw new Error('Bad result path');
    return `/tacticle/${date}/${id}/${outcome}`;
  }
  function puzzlePath(id, outcome) {
    if (!SLUG.test(id)) throw new Error('Bad result path');
    return `/tacticle/puzzle/${id}/${outcome}`;
  }
  function base(code) { return `https://${code}.goatcounter.com`; }
  /** GoatCounter's tracking-pixel endpoint for one hit on `path`. */
  function hitUrl(code, path) {
    return `${base(code)}/count?p=${encodeURIComponent(path)}&t=${encodeURIComponent('Tacticle result')}&rnd=${Math.random().toString(36).slice(2, 10)}`;
  }
  /** GoatCounter's public visitor counter for `path` (needs the site setting above). */
  function counterUrl(code, path) { return `${base(code)}/counter/${encodeURIComponent(path)}.json`; }
  /** The counter answers {"count": "1,234"}; a path nobody has visited answers 404. */
  function parseCount(json) {
    const n = parseInt(String((json && json.count) || '0').replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  }
  async function count(code, path, fetchFn) {
    const r = await fetchFn(counterUrl(code, path), { cache: 'no-store', credentials: 'omit' });
    if (r.status === 404) return 0;
    if (!r.ok) throw new Error(`Result counts unavailable (${r.status})`);
    return parseCount(await r.json());
  }
  /** {won, lost} for a day's puzzle, or for a puzzle over all its days (date omitted). */
  async function tally(code, id, date, fetchFn) {
    const path = (o) => (date ? dayPath(date, id, o) : puzzlePath(id, o));
    const [won, lost] = await Promise.all([count(code, path('won'), fetchFn), count(code, path('lost'), fetchFn)]);
    return { won, lost };
  }
  /** Percentage won, or null with no results. */
  function pct(t) { const n = t ? t.won + t.lost : 0; return n ? Math.round((100 * t.won) / n) : null; }
  /** Remove one's own result from a tally that already includes it. */
  function without(t, won) {
    return { won: Math.max(0, t.won - (won ? 1 : 0)), lost: Math.max(0, t.lost - (won ? 0 : 1)) };
  }
  /**
   * How far real players' win rates sit above (+) or below (−) the balance check's, in points (0–100),
   * weighted by players. rows: [{players:{won,lost}, sim (0–1)}]; puzzles with fewer than `min` players are left out.
   */
  function calibration(rows, min) {
    let w = 0, sum = 0, puzzles = 0;
    for (const r of rows) {
      const n = r.players ? r.players.won + r.players.lost : 0;
      if (n < (min || 5) || r.sim == null) continue;
      sum += n * (r.players.won / n - r.sim);
      w += n;
      puzzles++;
    }
    return w ? { gap: Math.round((100 * sum) / w), players: w, puzzles } : null;
  }

  return { valid, dayPath, puzzlePath, hitUrl, counterUrl, parseCount, count, tally, pct, without, calibration };
});
