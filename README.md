# Tacticle

A daily wargame puzzle. Each day players get one small Second World War battle with
Axis & Allies–style rules, play it against the computer in the browser, and share a
Wordle-style result. The repository holds three parts:

| Part | File | What it does |
|---|---|---|
| Player page | `index.html` | Loads today's puzzle from `schedule.json`, saves every move in the browser, and shows a copyable result. |
| Authoring tool | `author.html` | Builds, generates, balance-tests, saves and schedules puzzles. |
| Puzzle files | `puzzles/*.json`, `schedule.json` | One JSON file per puzzle, plus a date → puzzle schedule. |

Everything is static HTML/JS with no build step and no dependencies. The authoring tool
saves files through a small local Node server (`tools/serve.js`).

## Quick start

```sh
node tools/serve.js            # or: npm start
# player page:   http://localhost:8080/
# authoring:     http://localhost:8080/author.html
npm test                       # rules, AI, generator, map, importer and server tests
```

### Hosting

Serve the repository root from any static host. For GitHub Pages: Settings → Pages →
Deploy from a branch → `main` / root. The player page needs only `index.html`, `css/`,
`js/`, `maps/`, `puzzles/` and `schedule.json`. `author.html` is also published, but
it can't write files without the local server, so commit new puzzles and schedule
changes and push them.

## Playing

- The puzzle for the player's **local** date is chosen from `schedule.json`. On a date
  with nothing scheduled, the most recent earlier puzzle is shown. `?date=YYYY-MM-DD`
  opens a past day; future dates are capped at today.
- Turn: **buy → combat move → battles → noncombat move → place**, then income. The
  computer then takes its turns with animated moves (with a "Skip" button).
- Controls: tap a territory to pick up every unit that can move (−/+ adjust counts);
  highlighted territories are legal destinations (red outline = attack). Moving land
  units into a sea zone loads them onto your transport; select the sea zone and tap a
  coast to unload. Drag to pan, pinch or scroll to zoom, <kbd>Esc</kbd> cancels,
  <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes a move.
- Battles: roll each round, then choose casualties. The cheapest losses are
  pre-selected; tap to change them. Between rounds, continue, retreat, submerge subs, or
  "fight to the end".
- **Progress is saved after every action** in `localStorage`
  (`tacticle:save:<date>:<puzzle id>`). Refreshing restores the exact game, including
  dice already rolled. Undo is available only for moves made since the last dice roll,
  so battles can't be re-rolled. Each new game gets a random dice seed, so a player who
  clears site data can start over; a static site can't prevent that.
- When the game ends, the result dialog shows text like:

  ```
  Tacticle #3 · Yellow River
  🏆 Won in 2/3 turns
  🟨🟩
  🎲 I rolled above the odds (+1.2 hits)
  🎲 Foe rolled below the odds (−0.8 hits)
  https://…/
  ```

  Each square is one of your turns: 🟥 no objectives held, 🟨 some, 🟩 all. "Odds" compare
  the hits each side actually rolled with the expected number (each die at value *v*
  expects *v*/6 hits). AA fire and shore bombardment are included.
- Stats (played, win %, streak, wins by turn count) are kept per browser.

## Authoring

Run `node tools/serve.js` and open `author.html`. The page autosaves a draft in the
browser; **Save** (<kbd>Ctrl</kbd>+<kbd>S</kbd>) writes `puzzles/<id>.json` and
refreshes `puzzles/index.json`.

**Map tools** (toolbar, or keys):

| Tool | Key | Click | Shift-click | Right-click |
|---|---|---|---|---|
| Select | <kbd>S</kbd> | inspect/edit a territory in the right panel | | |
| Playable | <kbd>P</kbd> | toggle in/out of play | add it **and all neighbours** | remove |
| Owner | <kbd>O</kbd> | set owner to the brush power (Alt: map default) | | neutral |
| Units | <kbd>U</kbd>, <kbd>1</kbd>–<kbd>9</kbd> pick a unit | +1 (Ctrl: clear) | +5 | −1 |
| Objective | <kbd>J</kbd> | toggle territory in the chosen objective | | |

Toolbar shortcuts in Playable mode: **+ Neighbours** grows the area by one ring,
**+ Seas** adds sea zones that touch two or more playable coasts. Making a territory
playable fills in its map owner and any factory. Powers are added automatically when
you use them. Undo and redo: <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd>.

**Tabs:**

- **Scenario**: id, title, briefing ("Write from objectives" drafts one), map, rule set,
  max turns, win check (end of player's turn, or end of the round after the enemy's
  counter-attack), income and purchasing switches, and the TripleA map importer.
- **Powers**: player or computer, team, starting IPCs, capital, and turn order.
- **Objectives**: *Capture* (control at the check), *Hold* (lose immediately if lost at
  the end of any turn; the game runs to the last turn), *Clear* (no enemy units left).
  The player wins when every objective is met at the check.
- **Generate**: a **new** puzzle (theatre or "around the selected territory", size,
  difficulty, player side, optional fleets and transports), or a **variant** of the
  current one (armies nudged, an objective moved to a neighbour, turn limit ±1). Both run
  AI-vs-AI games in a Web Worker and adjust the armies toward a target win rate (easy
  70–92 %, medium 45–72 %, hard 22–48 % for the computer playing your side).
- **Test**: **Play test** opens the player page with the current scenario (saved
  separately from daily progress). The **balance check** runs *N* computer-vs-computer
  games. A **battle odds** calculator is included.
- **Schedule**: a calendar of the next weeks. Pick a puzzle per day, set the first day
  (puzzle #1), use "Fill empty days with unscheduled puzzles", then **Save schedule**
  (writes `schedule.json`).
- **Files**: open, delete, save-as, download and import JSON. Without the server, Chrome
  and Edge can **connect the repository folder** and write files directly; other browsers
  download the files for you to copy in.

### File formats

`schedule.json`:

```json
{ "epoch": "2026-11-18", "days": { "2026-11-18": "puzzles/leningrad-pocket.json" } }
```

`puzzles/<id>.json` (abridged):

```json
{
  "id": "yellow-river", "title": "Yellow River", "description": "…",
  "map": "world1942", "ruleset": "1942", "maxTurns": 3, "winCheck": "turnEnd",
  "income": true, "purchase": true,
  "playable": ["north_china", "shanghai", "yellow_sea", "…"],
  "powers": {
    "China": { "team": "Allies", "controller": "human", "money": 4 },
    "Japan": { "team": "Axis", "controller": "ai", "money": 4 }
  },
  "turnOrder": ["China", "Japan"],
  "setup": {
    "shanghai": { "owner": "Japan", "units": { "Japan": { "infantry": 4, "tank": 1 } } },
    "yellow_sea": { "units": { "Japan": { "transport": 1, "infantry": 2 } } }
  },
  "objectives": [{ "type": "capture", "territories": ["north_china", "shanghai"] }]
}
```

Land units listed in a sea zone start aboard that power's transports. A power may also
set `"capital": "<territory id>"` (or `null` for none).

## Rules

Rule sets are chosen per puzzle. The default is **1942 Second Edition**:

| Unit | Cost | Att | Def | Move | Notes |
|---|---|---|---|---|---|
| Infantry | 3 | 1 | 2 | 1 | attacks at 2 when paired with artillery |
| Artillery | 4 | 2 | 2 | 1 | supports one infantry |
| Tank | 6 | 3 | 3 | 2 | blitzes through empty enemy land |
| AA gun | 5 | 0 | 0 | 1 | before round 1, up to 3 shots (1 per plane) hitting on 1; no combat move; can be a casualty |
| Fighter | 10 | 3 | 4 | 4 | lands on carriers |
| Bomber | 12 | 4 | 1 | 6 | |
| Submarine | 6 | 2 | 1 | 2 | surprise strike and submerge unless an enemy destroyer is present; can't hit aircraft |
| Destroyer | 8 | 2 | 2 | 2 | cancels submarine abilities; lets its side's aircraft hit subs |
| Cruiser | 12 | 3 | 3 | 2 | shore bombardment |
| Carrier | 14 | 1 | 2 | 2 | holds 2 fighters |
| Battleship | 20 | 4 | 4 | 2 | two hits, repaired at the end of its owner's turn; shore bombardment |
| Transport | 7 | 0 | 0 | 2 | 2 infantry or 1 infantry + 1 other; defenceless, taken last |
| Factory | 15 | – | – | – | produces up to the territory's IPC value; captured |

Also implemented: combat and noncombat movement with automatic routing, blitzing,
loading, amphibious assaults (resolved after any sea battle in the launch zone; a lost
sea battle sinks or re-embarks the landing force), shore bombardment limited to the
number of landing units, retreats to a territory an attacker came from, aircraft
landing checks (no landing in territory captured this turn; stranded aircraft are lost),
capital capture taking the treasury, liberation of allied territory, income, production
limits, and neutral territories that block movement.

Other rule sets: **1941** (1942 units without AA guns), **Revised** (tanks 5,
bombers 15, destroyers 3/3 for 12, carriers 1/3 for 16, battleships 24, no cruisers;
AA guns fire at every plane and are captured; transports defend at 1), and **Classic**
(no artillery, destroyers or cruisers; one-hit 24-IPC battleships; tanks 3/2).

Simplifications compared with the board games: no strategic bombing raids (bombers
fight as normal attackers); transports carry only their own power's units; a
transport can't load in a zone with enemy warships; units loaded during combat movement
that stay aboard simply remain loaded; unplaced purchases carry over to the next turn;
only attackers decide on submerging between rounds; and canals (Suez, Panama) open only
when their territory is controlled by the mover's team.

### Computer opponent (`js/ai.js`)

The AI is greedy and objective-aware. It weighs objective territories heavily and
scores attacks with Monte-Carlo battle odds before committing. It also plans amphibious
landings from loaded transports, retreats when odds turn bad, reinforces threatened
territories, and buys infantry when threatened. It is a fair opponent for small puzzles,
not a strong general one: it doesn't coordinate fleets beyond attacking adjacent zones,
and it makes no multi-turn plans.

## The map

`maps/world1942.json` is an original board made for Tacticle: 191 land territories and
101 sea zones in a Miller projection, with the seam in the Bering Strait so the Pacific
wraps left–right. Puzzles near the seam are drawn across it as one area. It is built
by `tools/build_world_map.py` from **Natural Earth** 1:50m countries and provinces
(public domain), downloaded to `tools/cache/` on first run. Territory groupings, names,
IPC values and spring-1942 owners are defined in `tools/world_config.py`. Sea zones are
Voronoi cells around hand-placed points, clipped to open water. Adjacency is measured on
full-detail shapes, and the board is then simplified as one coverage so shared borders
stay shared. `tools/data/world1942_report.txt` lists every territory's neighbours.

```sh
pip install shapely
python3 tools/build_world_map.py --preview /tmp/preview.svg   # ~2 minutes
```

### Using an edition's board (TripleA import)

The published Axis & Allies edition boards are not included. Tacticle can import a
TripleA map you have, such as one of the community recreations of the 1942 board. In the
authoring tool: **Scenario → Import a TripleA map…**, then choose the game XML from the
map's `games/` folder, `polygons.txt` and (optionally) `centers.txt`. Territories,
connections, production values, owners, capitals, starting units and money are converted;
images are not used. The result is saved to `maps/<id>.json` and listed in
`maps/index.json`. Making a territory playable on an imported map fills in its starting
units. The converter also works from Node:
`require('./js/triplea.js').convert({ xml, polygons, centers, id })`.

## Code layout

```
index.html, js/play.js        player page
author.html, js/author.js     authoring tool
js/engine.js                  rules engine (pure, JSON state; browser + Node)
js/rulesets.js                unit stats and rule switches per edition
js/ai.js                      computer opponent + AI self-play
js/generator.js               procedural puzzles and variants
js/mapview.js, js/icons.js    SVG map (pan/zoom/pinch/wrap) and unit icons
js/daily.js                   dates, puzzle numbers, share text
js/triplea.js                 TripleA map importer
js/worker.js                  Web Worker for generation and balance checks
tools/serve.js                static server + save API for the authoring tool
tools/build_world_map.py      world map builder (+ tools/world_config.py)
tests/                        node --test suites
```
