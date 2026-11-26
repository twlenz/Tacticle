/*
 * Site version, shown next to the attribution at the bottom of both pages so you can tell when an
 * update has loaded. Bump it with every change that goes live (date, then a counter for the day).
 */
(function () {
  'use strict';
  var VERSION = '2026.11.26';
  if (typeof module === 'object' && module.exports) { module.exports = VERSION; return; }
  window.TACTICLE_VERSION = VERSION;
  var show = function () { var el = document.getElementById('version'); if (el) el.textContent = 'v' + VERSION; };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
})();
