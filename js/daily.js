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
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  /** Earlier puzzles a replay day may use: older than a week where possible. */
  function replayPool(days, date) {
    const past = Object.keys(days).filter((d) => d < date).sort();
    const all = [...new Set(past.map((d) => days[d]))].sort();
    const recent = new Set(past.filter((d) => daysBetween(d, date) <= 7).map((d) => days[d]));
    const older = all.filter((f) => !recent.has(f));
    return { past, files: older.length ? older : all };
  }
  /**
   * The puzzle for a date. With nothing scheduled that day the default is a replay of an
   * earlier puzzle chosen from the date alone, so every player gets the same one
   * (schedule.fallback = "latest" shows the most recent scheduled puzzle instead).
   * Returns {date, file} or {date, file, replay: true, from} or null.
   */
  function entryFor(schedule, date, exact) {
    const days = schedule.days || {};
    if (days[date]) return { date, file: days[date] };
    if (exact) return null;
    const { past, files } = replayPool(days, date);
    if (!past.length) return null;
    if (schedule.fallback === 'latest') {
      const d = past[past.length - 1];
      return { date: d, file: days[d] };
    }
    let i = hash('tacticle:' + date) % files.length;
    // avoid repeating yesterday's replay when there is a choice
    const prev = addDays(date, -1);
    if (files.length > 1 && !days[prev]) {
      const p = replayPool(days, prev);
      if (p.files.length && p.files[hash('tacticle:' + prev) % p.files.length] === files[i]) i = (i + 1) % files.length;
    }
    const file = files[i];
    return { date, file, replay: true, from: past.filter((d) => days[d] === file).pop() };
  }

  /** One decimal, no trailing .0, ASCII minus (pastes cleanly everywhere). */
  function fmt(x) {
    const v = Math.round(x * 10) / 10;
    return (v > 0 ? '+' : v < 0 ? '-' : '') + String(Math.abs(v)).replace(/\.0$/, '');
  }
  function luckWords(l) {
    if (!l || !l.dice) return 'rolled no dice';
    if (l.diff > 0.25) return `rolled above odds (${fmt(l.diff)} hits)`;
    if (l.diff < -0.25) return `rolled below odds (${fmt(l.diff)} hits)`;
    return `rolled at odds (${fmt(l.diff) || '0'} hits)`;
  }
  /** One square per objective: won -> green (taken) / orange (not needed); lost -> yellow (taken) / red. */
  function squares(targets, won) {
    return (targets || []).map((t) => (won ? (t.met ? '🟩' : '🟧') : (t.met ? '🟨' : '🟥'))).join('');
  }
  function ipc(n) { return n ? `-${Math.round(n)} IPC` : '0 IPC'; }
  /** "https://twlenz.github.io/Tacticle/index.html" -> "twlenz.github.io/Tacticle" */
  function shortUrl(href) {
    try {
      const u = new URL(href);
      if (!/^https?:$/.test(u.protocol) || /^(localhost|127\.|\[::1\])/.test(u.host)) return href;
      return (u.host + u.pathname.replace(/index\.html$/, '')).replace(/\/+$/, '');
    } catch (e) { return href; }
  }

  /**
   * r: {number, title, won, turns, maxTurns, targets:[{met}], objectivesDone, objectivesTotal,
   *     luckYou, luckFoe, lossYou, lossFoe, url, test, freePlay}
   */
  function shareText(r) {
    const lines = [];
    lines.push(`Tacticle ${r.test ? '(test)' : '#' + r.number} · ${r.title}`);
    if (r.freePlay) {
      lines.push(`I ${r.won ? 'won' : 'lost'} in free play`);
      lines.push(`🎲 I ${luckWords(r.luckYou)}`);
      lines.push(`🎲 Opponent ${luckWords(r.luckFoe)}`);
      lines.push(`Me ${ipc(r.lossYou)} / Them ${ipc(r.lossFoe)}`);
      if (r.url) lines.push(shortUrl(r.url));
      return lines.join('\n');
    }
    if (r.won) lines.push(`🏆 Won in ${r.turns}/${r.maxTurns} turn${r.maxTurns === 1 ? '' : 's'}`);
    else lines.push(`💀 Lost · ${r.objectivesDone}/${r.objectivesTotal} objective${r.objectivesTotal === 1 ? '' : 's'} · ${r.turns}/${r.maxTurns} turns`);
    const sq = squares(r.targets, r.won);
    if (sq) lines.push(sq);
    lines.push(`🎲 I ${luckWords(r.luckYou)}`);
    lines.push(`🎲 Opponent ${luckWords(r.luckFoe)}`);
    lines.push(`Me ${ipc(r.lossYou)} / Them ${ipc(r.lossFoe)}`);
    const others = othersLine(r.others, r.today);
    if (others) lines.push(others);
    if (r.url) lines.push(shortUrl(r.url));
    return lines.join('\n');
  }
  /**
   * Words for one objective: a scenario objective, or a status from the engine (objectiveStatus /
   * opponentStatus), which adds progress. `names` is the territories already formatted (e.g. bold, escaped);
   * `enemy` words it for the computer ("captures X", after "The enemy wins if it").
   */
  function objectiveWords(o, names, enemy) {
    const n = (v) => Math.round(v || 0);
    switch (o.type) {
      case 'bank':
        return `${enemy ? 'has' : 'Have'} ${n(o.ipc)} IPC in the bank` + (o.have != null ? ` (${enemy ? 'it has' : 'you have'} ${n(o.have)})` : '');
      case 'damage':
        return `${enemy ? 'inflicts' : 'Inflict'} ${n(o.inflict)} IPC of damage` + (o.maxLoss != null ? ` while losing no more than ${n(o.maxLoss)}` : '') +
          (o.inflicted != null ? ` (so far ${n(o.inflicted)} dealt, ${n(o.taken)} lost)` : '');
      case 'hold': return `${enemy ? 'holds' : 'Hold'} ${names}`;
      case 'destroy': return enemy ? `clears your units from ${names}` : `Clear enemies from ${names}`;
      default: return `${enemy ? 'captures' : 'Capture'} ${names}`;
    }
  }
  /** "🌍 62% of other players won today": how the day's other players did (from results.js), or '' with none. */
  function othersLine(t, isToday) {
    const n = t ? t.won + t.lost : 0;
    if (!n) return '';
    return `🌍 ${Math.round((100 * t.won) / n)}% of other players won ${isToday === false ? 'that day' : 'today'}`;
  }

  return { today, dateStr, parse, addDays, daysBetween, number, entryFor, shareText, othersLine, objectiveWords, luckWords, squares, shortUrl };
});
