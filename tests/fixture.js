// A tiny board for engine tests.
//   N - A3 - B2 - S2 - I
//        |    |    |
//       A2 - B1   S3
//        |  / |
//       A1 ---+
//        \   /
//         S1 ---- S2
const map = {
  id: 'fixture', name: 'Fixture', width: 100, height: 100,
  powers: [
    { id: 'Germany', team: 'Axis', color: '#555' },
    { id: 'Soviet Union', team: 'Allies', color: '#a33' },
    { id: 'United Kingdom', team: 'Allies', color: '#ca6' },
  ],
  territories: [
    { id: 'A1', name: 'A1', type: 'land', ipc: 3, owner: 'Germany', capital: 'Germany', adj: ['A2', 'B1', 'S1'] },
    { id: 'A2', name: 'A2', type: 'land', ipc: 2, owner: 'Germany', adj: ['A1', 'A3', 'B1'] },
    { id: 'A3', name: 'A3', type: 'land', ipc: 1, owner: 'Germany', adj: ['A2', 'N', 'B2'] },
    { id: 'B1', name: 'B1', type: 'land', ipc: 2, owner: 'Soviet Union', adj: ['A1', 'A2', 'B2', 'S1'] },
    { id: 'B2', name: 'B2', type: 'land', ipc: 3, owner: 'Soviet Union', capital: 'Soviet Union', adj: ['B1', 'A3', 'S2'] },
    { id: 'N', name: 'N', type: 'land', ipc: 0, owner: null, neutral: true, adj: ['A3'] },
    { id: 'I', name: 'I', type: 'land', ipc: 1, owner: 'United Kingdom', adj: ['S2'] },
    { id: 'S1', name: 'S1', type: 'sea', adj: ['A1', 'B1', 'S2'] },
    { id: 'S2', name: 'S2', type: 'sea', adj: ['S1', 'B2', 'I', 'S3'] },
    { id: 'S3', name: 'S3', type: 'sea', adj: ['S2'] },
  ],
  canals: [],
};

function scenario(over) {
  return Object.assign({
    id: 'test', title: 'Test', map: 'fixture', ruleset: '1942', maxTurns: 3,
    playable: ['A1', 'A2', 'A3', 'B1', 'B2', 'N', 'I', 'S1', 'S2', 'S3'],
    powers: {
      Germany: { team: 'Axis', controller: 'human', money: 20 },
      'Soviet Union': { team: 'Allies', controller: 'ai', money: 10 },
      'United Kingdom': { team: 'Allies', controller: 'ai', money: 0 },
    },
    turnOrder: ['Germany', 'Soviet Union', 'United Kingdom'],
    setup: {
      A1: { owner: 'Germany', units: { Germany: { infantry: 2, tank: 1, factory: 1, fighter: 1 } } },
      A2: { owner: 'Germany', units: { Germany: { infantry: 1, tank: 1 } } },
      B1: { owner: 'Soviet Union', units: {} },
      B2: { owner: 'Soviet Union', units: { 'Soviet Union': { infantry: 2, factory: 1 } } },
      S1: { units: { Germany: { transport: 1, destroyer: 1 } } },
      I: { owner: 'United Kingdom', units: { 'United Kingdom': { infantry: 1 } } },
    },
    objectives: [{ type: 'capture', territories: ['B2'] }],
  }, over || {});
}

module.exports = { map, scenario };
