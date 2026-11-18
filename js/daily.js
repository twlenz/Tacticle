/* Tacticle daily helpers: dates, schedule lookup, share text. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TacticleDaily = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function pad(n) { return String(n).padStart(2, '0'); }
  function dateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function today() { return dateStr(new Date()); }
  function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return dateStr(d); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }

  /** Puzzle number: days since the schedule's epoch, starting at #1. */
  function number(schedule, date) {
    const epoch = schedule.epoch || Object.keys(schedule.days || {}).sort()[0] || date;
    return daysBetween(epoch, date) + 1;
  }
  /** The scheduled entry for a date, or the latest one before it. */
  function entryFor(schedule, date, exact) {
    const days = schedule.days || {};
    if (days[date]) return { date, file: days[date] };
    if (exact) return null;
    const past = Object.keys(days).filter((d) => d <= date).sort();
    if (!past.length) return null;
    const d = past[past.length - 1];
    return { date: d, file: days[d] };
  }

  function signed(x) {
    const v = Math.abs(x) < 0.05 ? 0 : x;
    return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1);
  }
  function luckWords(l) {
    if (!l || !l.dice) return 'no dice rolled';
    if (l.diff > 0.25) return `above the odds (${signed(l.diff)} hits)`;
    if (l.diff < -0.25) return `below the odds (${signed(l.diff)} hits)`;
    return `right on the odds (${signed(l.diff)} hits)`;
  }
  function squares(history, maxTurns) {
    const row = (history || []).map((h) => (h.progress >= 1 ? '🟩' : h.progress > 0 ? '🟨' : '🟥'));
    return row.join('');
  }

  /**
   * r: {number, title, won, turns, maxTurns, objectivesDone, objectivesTotal, history, luckYou, luckFoe, url, test}
   */
  function shareText(r) {
    const lines = [];
    lines.push(`Tacticle ${r.test ? '(test)' : '#' + r.number} · ${r.title}`);
    if (r.won) lines.push(`🏆 Won in ${r.turns}/${r.maxTurns} turn${r.maxTurns === 1 ? '' : 's'}`);
    else lines.push(`💀 Lost · ${r.objectivesDone}/${r.objectivesTotal} objectives · ${r.turns}/${r.maxTurns} turns`);
    const sq = squares(r.history, r.maxTurns);
    if (sq) lines.push(sq);
    lines.push(`🎲 I rolled ${luckWords(r.luckYou)}`);
    lines.push(`🎲 Foe rolled ${luckWords(r.luckFoe)}`);
    if (r.url) lines.push(r.url);
    return lines.join('\n');
  }

  return { today, dateStr, parse, addDays, daysBetween, number, entryFor, shareText, luckWords, squares };
});
