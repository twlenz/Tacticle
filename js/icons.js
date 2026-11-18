/* Tacticle unit icons: original silhouettes drawn on a -12..12 box, filled with currentColor. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TacticleIcons = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const ICON = {
    infantry: '<circle cx="0" cy="-6.6" r="3"/><path d="M-4.2,-7.2q4.2-5 8.4,0z"/><path d="M-4.6,-2.6h9.2l1.4,7.6h-2.8l-.8-3.6-.7,9.6h-2.6l-.5-5.8-.6,5.8h-2.6l-.7-9.6-.8,3.6h-2.8z"/><rect x="5.6" y="-9" width="1.3" height="12" rx=".5"/>',
    artillery: '<circle cx="-3" cy="5" r="4.6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="-3" cy="5" r="1.2"/><path d="M-6,1.6l15.4-9.6 1.6,2.4-14.8,10.4z"/><path d="M-3,5l-8,4.6 1,1.8 8.4-4.2z"/>',
    tank: '<rect x="-11" y="1.6" width="22" height="7" rx="3.5"/><path d="M-7.4,1.6v-4.4q0-1.6 1.6-1.6h9q1.6 0 1.6 1.6v4.4z"/><rect x="3" y="-3.4" width="9.6" height="2.2" rx=".8"/><g fill="#0003"><circle cx="-7" cy="5.1" r="1.6"/><circle cx="-2.4" cy="5.1" r="1.6"/><circle cx="2.2" cy="5.1" r="1.6"/><circle cx="6.8" cy="5.1" r="1.6"/></g>',
    aaa: '<path d="M-9,9h18l-2.4-5h-13.2z"/><rect x="-4" y="-1" width="8" height="5.4" rx="1.4"/><path d="M-2.8,-.4l-3.6-10.4 1.8-.6 3.4,10.6zM2.8,-.4l3.6-10.4-1.8-.6-3.4,10.6z"/>',
    factory: '<path d="M-11,10v-11l5-3.6v3.6l5-3.6v3.6l5-3.6v-6.4h4.4v17z"/><g fill="#0004"><rect x="-8" y="3" width="2.6" height="3"/><rect x="-3" y="3" width="2.6" height="3"/><rect x="2" y="3" width="2.6" height="3"/></g>',
    fighter: '<path d="M0-11l1.7,6.2 9.3,4.2v2.6l-9.3-1.8-.6,6.8 3.6,2.4v1.6l-4.7-1.3-4.7,1.3v-1.6l3.6-2.4-.6-6.8-9.3,1.8v-2.6l9.3-4.2z"/>',
    bomber: '<path d="M0-11l1.8,5 10.2,3.4v2.6l-10.2-.6-.8,7.6 4.6,2.6v1.6l-5.6-1.2-5.6,1.2v-1.6l4.6-2.6-.8-7.6-10.2.6v-2.6l10.2-3.4z"/><g><rect x="-8.2" y="-4" width="2.2" height="4" rx=".8"/><rect x="-4.6" y="-5" width="2.2" height="4" rx=".8"/><rect x="2.4" y="-5" width="2.2" height="4" rx=".8"/><rect x="6" y="-4" width="2.2" height="4" rx=".8"/></g>',
    transport: '<path d="M-12,2h24l-3.4,6.6h-17.4z"/><rect x="-8" y="-4" width="6" height="6" rx=".6"/><rect x="-1" y="-6" width="6" height="8" rx=".6"/><rect x="6.4" y="-3" width="3" height="5"/>',
    submarine: '<path d="M-12,3.6q0-4.4 5-4.4h15q4 0 4,4.4t-4,4.4h-15q-5,0-5-4.4z"/><path d="M-3.6-.8v-4.4q0-1.4 1.4-1.4h3.4q1.4,0 1.4,1.4v4.4z"/><rect x="-.6" y="-10" width="1.2" height="4"/>',
    destroyer: '<path d="M-12,2.4h24l-4,5.4h-17z"/><path d="M-6,2.4v-3.6h7v-2.6h3v6.2z"/><rect x="5" y="-.4" width="5" height="1.6" rx=".6"/><rect x="0.6" y="-7.6" width="1.2" height="5"/>',
    cruiser: '<path d="M-12,2h24l-3.6,6h-16.8z"/><path d="M-4.6,2v-4h3.6v-3.6h3v3.6h3.6v4z"/><rect x="-10" y="-.4" width="4.6" height="1.6" rx=".6"/><rect x="5.6" y="-.4" width="4.6" height="1.6" rx=".6"/>',
    carrier: '<path d="M-12,1h24v2.6l-3,4.6h-18l-3-4.6z"/><path d="M4,1v-6h4v6z"/><rect x="-9" y="-1" width="11" height="1.2" opacity=".6"/>',
    battleship: '<path d="M-12,1.6h24l-3.4,6.8h-17.2z"/><path d="M-3.6,1.6v-5.2h2v-4h3.2v4h2v5.2z"/><rect x="-10.6" y="-1.2" width="5.6" height="2.2" rx=".8"/><rect x="5.2" y="-1.2" width="5.6" height="2.2" rx=".8"/><rect x="-6.6" y="-2.6" width="2.6" height="1.6"/>',
  };
  function svg(type, size, color) {
    return `<svg viewBox="-12 -12 24 24" width="${size || 20}" height="${size || 20}" style="color:${color || 'currentColor'}" aria-hidden="true"><g fill="currentColor">${ICON[type] || '<circle r="8"/>'}</g></svg>`;
  }
  return { ICON, svg };
});
