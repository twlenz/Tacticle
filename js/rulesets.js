/*
 * Tacticle rule sets. Unit statistics and rule switches modelled on the published
 * Axis & Allies editions. "1942" (Second Edition) is the default.
 *
 * A unit hits when a d6 roll is at or under its attack (attacker) or defence (defender).
 * Transport space: capacity 5; infantry takes 2, other land units 3
 * (so 2 infantry, or 1 infantry + 1 other).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TacticleRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const U = {
    infantry: { name: 'Infantry', short: 'Inf', domain: 'land', cost: 3, att: 1, def: 2, move: 1, transportCost: 2, supportable: true },
    artillery: { name: 'Artillery', short: 'Art', domain: 'land', cost: 4, att: 2, def: 2, move: 1, transportCost: 3, supports: 1 },
    tank: { name: 'Tank', short: 'Tank', domain: 'land', cost: 6, att: 3, def: 3, move: 2, transportCost: 3, blitz: true },
    aaa: { name: 'AA Gun', short: 'AAA', domain: 'land', cost: 5, att: 0, def: 0, move: 1, transportCost: 3, aa: { maxShots: 3, hit: 1 }, noCombatMove: true },
    factory: { name: 'Industrial Complex', short: 'Factory', domain: 'land', cost: 15, att: 0, def: 0, move: 0, infrastructure: true },
    fighter: { name: 'Fighter', short: 'Ftr', domain: 'air', cost: 10, att: 3, def: 4, move: 4, carrierCost: 1 },
    bomber: { name: 'Bomber', short: 'Bmr', domain: 'air', cost: 12, att: 4, def: 1, move: 6, bomber: true },
    transport: { name: 'Transport', short: 'Trn', domain: 'sea', cost: 7, att: 0, def: 0, move: 2, capacity: 5, transport: true },
    submarine: { name: 'Submarine', short: 'Sub', domain: 'sea', cost: 6, att: 2, def: 1, move: 2, sub: true },
    destroyer: { name: 'Destroyer', short: 'Dstr', domain: 'sea', cost: 8, att: 2, def: 2, move: 2, antiSub: true },
    cruiser: { name: 'Cruiser', short: 'Crsr', domain: 'sea', cost: 12, att: 3, def: 3, move: 2, bombard: 3 },
    carrier: { name: 'Aircraft Carrier', short: 'Carr', domain: 'sea', cost: 14, att: 1, def: 2, move: 2, carrierCapacity: 2 },
    battleship: { name: 'Battleship', short: 'BB', domain: 'sea', cost: 20, att: 4, def: 4, move: 2, hp: 2, bombard: 4 },
  };

  function units(over, drop) {
    const out = {};
    for (const k of Object.keys(U)) {
      if (drop && drop.includes(k)) continue;
      out[k] = Object.assign({}, U[k], (over && over[k]) || {});
      if (over && over[k] === null) delete out[k];
    }
    return out;
  }

  const ORDER = ['Soviet Union', 'Germany', 'United Kingdom', 'Italy', 'Japan', 'United States', 'China', 'France'];

  const RULESETS = {
    1942: {
      id: '1942', name: '1942 Second Edition (default)',
      summary: 'AAA fires up to 3 shots at aircraft and can be taken as a casualty; transports are defenceless and chosen last; submarines strike first and can submerge unless an enemy destroyer is present, cannot hit aircraft and cannot be hit by aircraft without a friendly destroyer; subs and transports do not block ships; new ships may be placed in a sea zone with enemy warships.',
      units: units(),
      turnOrder: ORDER,
      aaCaptured: false,
      transportsDefenseless: true,
      airNeedsDestroyerVsSub: true,
      subsBlock: false,
      transportsBlock: false,
      bombardLimitedByLanders: true,
      sbr: 'damage',
      // 1942 Second Edition rulebook, p. 22: new sea units may enter play in a hostile sea zone (no combat then);
      // p. 23/30: submarines may end a noncombat move in a hostile sea zone
      placeInHostileSea: true,
      subsEnterHostileNoncombat: true,
    },
    1941: {
      id: '1941', name: '1941',
      summary: '1942 Second Edition units without AA guns.',
      units: units(null, ['aaa']),
      turnOrder: ['Germany', 'Soviet Union', 'Japan', 'United Kingdom', 'Italy', 'United States', 'China', 'France'],
      aaCaptured: false,
      transportsDefenseless: true,
      airNeedsDestroyerVsSub: true,
      subsBlock: false,
      transportsBlock: false,
      bombardLimitedByLanders: true,
      sbr: 'damage',
      // 1942 Second Edition rulebook, p. 22: new sea units may enter play in a hostile sea zone (no combat then);
      // p. 23/30: submarines may end a noncombat move in a hostile sea zone
      placeInHostileSea: true,
      subsEnterHostileNoncombat: true,
    },
    revised: {
      id: 'revised', name: 'Revised',
      summary: 'Tanks 5, bombers 15, destroyers 3/3 for 12, carriers 1/3 for 16, battleships 24; no cruisers. AA guns fire once at every aircraft, cannot be casualties and are captured. Transports defend at 1 and take hits normally.',
      units: units({
        tank: { cost: 5 },
        aaa: { cost: 5, aa: { maxShots: Infinity, hit: 1 }, infrastructure: true },
        bomber: { cost: 15 },
        transport: { cost: 8, def: 1 },
        submarine: { cost: 8, def: 2 },
        destroyer: { cost: 12, att: 3, def: 3 },
        carrier: { cost: 16, def: 3 },
        battleship: { cost: 24 },
      }, ['cruiser']),
      turnOrder: ORDER,
      aaCaptured: true,
      transportsDefenseless: false,
      airNeedsDestroyerVsSub: false,
      subsBlock: true,
      transportsBlock: true,
      bombardLimitedByLanders: false,
      sbr: 'treasury',
    },
    classic: {
      id: 'classic', name: 'Classic',
      summary: 'No artillery, destroyers or cruisers. Tanks 3/2 for 5, fighters 12, bombers 15, carriers 1/3 for 18, battleships 24 and sunk by one hit. AA guns fire at every aircraft and are captured.',
      units: units({
        tank: { cost: 5, def: 2 },
        aaa: { cost: 5, aa: { maxShots: Infinity, hit: 1 }, infrastructure: true },
        fighter: { cost: 12 },
        bomber: { cost: 15 },
        transport: { cost: 8, def: 1 },
        submarine: { cost: 8, def: 2 },
        carrier: { cost: 18, def: 3 },
        battleship: { cost: 24, hp: 1 },
      }, ['artillery', 'destroyer', 'cruiser']),
      turnOrder: ORDER,
      aaCaptured: true,
      transportsDefenseless: false,
      airNeedsDestroyerVsSub: false,
      subsBlock: true,
      transportsBlock: true,
      bombardLimitedByLanders: false,
      sbr: 'treasury',
    },
  };

  // Display order for palettes and battle boards
  const UNIT_ORDER = ['infantry', 'artillery', 'tank', 'aaa', 'fighter', 'bomber', 'submarine', 'destroyer',
    'cruiser', 'carrier', 'battleship', 'transport', 'factory'];

  function get(id) { return RULESETS[id] || RULESETS['1942']; }

  return { RULESETS, UNIT_ORDER, DEFAULT: '1942', get, list: () => Object.values(RULESETS) };
});
