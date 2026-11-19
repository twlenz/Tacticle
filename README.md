# Tacticle

A daily wargame puzzle. Each day players get one small Second World War battle with
Axis & Allies–style rules, play it against the computer in the browser, and share a
Wordle-style result. The repository holds three parts:

| Part | File | What it does |
|---|---|---|
| Player page | `index.html` | Loads today's puzzle from `schedule.json`, saves every move in the browser, and shows a copyable result. |
| Authoring tool | `author.html` | Builds, generates, balance-tests, saves and schedules puzzles. |
| Puzzle files | `puzzles/*.json`, `schedule.json` | One JSON file per puzzle, plus a date → puzzle schedule. |

Puzzles are played on **TripleA maps**: the same map files the open-source
[TripleA](https://triplea-game.org) game downloads. Two community WW2 maps are bundled,
and the authoring tool can import any other map from TripleA's catalogue in a few
clicks (see [Maps](#maps)). Tacticle's own world map is kept as an extra option.

Everything is static HTML/JS with no build step and no dependencies. The authoring tool
saves files through a small local Node server (`tools/serve.js`).

## Quick start

```sh
node tools/serve.js            # or: npm start
# player page:   http://localhost:8080/
# authoring:     http://localhost:8080/author.html
npm test                       # rules, AI, generator, map, importer and server tests
```

The authoring server only listens on `127.0.0.1`. It refuses:
- requests addressed to any host name other than `localhost`/`127.0.0.1`, which blocks
  DNS-rebinding attacks from web pages
- cross-site API calls
- paths that leave the repository through `..`, a symlink or a similarly named sibling
  folder
- hidden files such as `.git` and `.env`

Schedule entries must be `puzzles/<id>.json`. Both pages carry a Content-Security-Policy
that allows only their own scripts.

### Hosting

Serve the repository root from any static host. For GitHub Pages: Settings → Pages →
Deploy from a branch → `main` / root. The player page needs only `index.html`, `css/`,
`js/`, `maps/`, `puzzles/` and `schedule.json`. `author.html` is also published, but
it can't write files without the local server, so commit new puzzles and schedule
changes and push them.

## Playing

- The puzzle for the player's **local** date is chosen from `schedule.json`.
- **On a date with nothing scheduled**, an earlier puzzle is replayed. The pick comes from
  the date alone, so every player gets the same one. It avoids puzzles from the past week
  when older ones exist and doesn't repeat the previous day's replay. It counts as that
  day's game, with its own number and a fresh save. To keep showing the most recent
  puzzle instead, set `"fallback": "latest"` in `schedule.json` (Schedule tab → "Days with
  nothing scheduled").
- `?date=YYYY-MM-DD`
  opens a past day; future dates are capped at today.
- Turn: **buy → combat move → battles → noncombat move → place**, then income. The
  computer then takes its turns with animated moves (with a "Skip" button).
- Selecting units:
  - Tap a **unit icon** to pick all of that unit type there. Tap it again to drop one,
    and again to drop another.
  - Tapping another icon adds all of that type too.
  - Tap the **territory** itself (outside the icons) to pick everything; tap again to
    clear.
  - The −/+ steppers in the panel fine-tune counts.
- Moving: highlighted territories are legal destinations (red outline = attack). Moving land
  units into a sea zone loads them onto your transport; select the sea zone and tap a
  coast to unload. Drag to pan, pinch or scroll to zoom, <kbd>Esc</kbd> cancels,
  <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes a move.
- Ending combat movement asks for confirmation in an in-page popup that lists the battles
  about to be fought.
- **Battles:**
  - With several battles you pick each one from the list, and the page returns to the
    list after each. A single battle opens by itself.
  - When you roll, the dice grow in from their own spots. The units about to be hit
    shake briefly with a "−n" badge, then the hits are applied, cheapest units first.
  - Rolling again shrinks the old dice away first.
  - **Let me choose my casualties** (remembered per browser) switches to picking losses
    yourself.
  - Between rounds you can continue, retreat, submerge subs, or "fight to the end".
  - Animations are skipped for players who ask their system for reduced motion.
- The page is light by default; the ◐ button switches to dark mode, and the choice is
  remembered.
- **Progress is saved after every action** in `localStorage`
  (`tacticle:save:<date>:<puzzle id>`). Refreshing restores the exact game, including
  dice already rolled. Undo is available only for moves made since the last dice roll,
  so battles can't be re-rolled. Each new game gets a random dice seed, so a player who
  clears site data can start over; a static site can't prevent that.
- **Free play**: once today's game is over, "Free play" replays the same setup as a
  separate game. It has its own save, a **Reset board** button, and no effect on the daily
  result or stats. Its share text reads:

  ```
  Tacticle #1 · Karelian Front
  I won in free play
  🎲 I rolled above odds (+1 hits)
  🎲 Opponent rolled below odds (-0.5 hits)
  Me -6 IPC / Them -20 IPC
  twlenz.github.io/Tacticle
  ```

- When the game ends, the result dialog shows text like:

  ```
  Tacticle #1 · Karelian Front
  💀 Lost · 0/1 objective · 1/4 turns
  🟥
  🎲 I rolled below odds (-3 hits)
  🎲 Opponent rolled above odds (+3.2 hits)
  Me -15 IPC / Them -25 IPC
  twlenz.github.io/Tacticle
  ```

  - **Squares:** one per objective territory. On a win: 🟩 taken, 🟧 not taken but not
    needed. On a loss: 🟨 taken, 🟥 not taken.
  - **Odds:** compare the hits each side actually rolled with the expected number (each die
    at value *v* expects *v*/6 hits). AA fire and shore bombardment are included.
  - **Me / Them:** the IPC value of each side's destroyed units. This counts battle
    casualties, aircraft that couldn't land, and troops lost with sunk transports.
  - **Link:** the page address without `https://` (`twlenz.github.io/Tacticle`). Most chat
    apps turn that into a link; Discord needs `https://`.
- Stats (played, win %, streak, wins by turn count) are kept per browser. Each date counts
  once, however often the page is reloaded.

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
| Move | <kbd>M</kbd> | unit icon: pick that unit (again: one fewer; other icon: add it); territory: pick everything, or drop the picked units here | | cancel |
| Objective | <kbd>J</kbd> | toggle territory in the chosen objective | | |

Toolbar shortcuts in Playable mode: **+ Neighbours** grows the area by one ring,
**+ Seas** adds sea zones that touch two or more playable coasts. Making a territory
playable fills in its map owner and any factory. Powers are added automatically when
you use them. Undo and redo: <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd>.

**Tabs:**

- **Scenario**: id, title, briefing ("Write from objectives" drafts one), map, rule set,
  max turns, win check (end of player's turn, or end of the round after the enemy's
  counter-attack), income and purchasing switches, and **Browse TripleA maps…**.
- **Powers**: player or computer, team, starting IPCs, capital, and turn order.
- **Objectives**: *Capture* (control at the check), *Hold* (lose immediately if lost at
  the end of any turn; the game runs to the last turn), *Clear* (no enemy units left).
  The player wins when every objective is met at the check. With several capture or clear
  territories, **Needed to win** can lower that to "any N of M" (saved as
  `"objectivesNeeded": N`).
- **Generate**: a **new** puzzle (theatre or "around the selected territory", size,
  difficulty, player side, optional fleets and transports, and on TripleA maps the option
  to **use the map's own starting armies**), or a **variant** of the
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
{ "epoch": "2026-11-18", "days": { "2026-11-18": "puzzles/karelian-front.json" } }
```

`puzzles/<id>.json` (abridged):

```json
{
  "id": "karelian-front", "title": "Karelian Front", "description": "…",
  "map": "total_world_war", "ruleset": "1942", "maxTurns": 4, "winCheck": "turnEnd",
  "income": true, "purchase": false,
  "playable": ["eastern_finland", "leningrad", "29_sea_zone", "…"],
  "powers": {
    "Finland": { "team": "Axis", "controller": "human", "money": 0 },
    "Soviet Union": { "team": "Allies", "controller": "ai", "money": 0 }
  },
  "turnOrder": ["Finland", "Soviet Union"],
  "setup": {
    "eastern_finland": { "owner": "Finland", "units": { "Finland": { "infantry": 2 } } },
    "leningrad": { "owner": "Soviet Union", "units": { "Soviet Union": { "infantry": 4, "artillery": 1, "aaa": 3 } } },
    "29_sea_zone": { "units": { "Soviet Union": { "transport": 1, "infantry": 2 } } }
  },
  "objectives": [{ "type": "capture", "territories": ["leningrad"] }]
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
range (an aircraft may only move, in combat or noncombat, to a territory or sea zone
from which its remaining movement still reaches a landing spot: friendly land held since
the start of the turn, a friendly carrier, or a zone one of your carriers can still sail
to; anything it cannot reach is not offered), landing checks (no landing in territory
captured this turn; aircraft left without a landing spot are lost),
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

The AI is greedy and objective-aware. For every possible attack it simulates the battle
(Monte Carlo) and scores the result. The score is the **expected IPC damage dealt minus
its own expected IPC losses**, plus half the territory's income, plus capitals and
factories in full. Attacks made only for the IPC trade need 60% odds. It then commits
the best attack and repeats.

The objective race changes its priorities:
- **The player meets enough objectives to win at the next check:** retaking one comes
  first, at any odds above about 12%, and the AI fights those battles to the end rather
  than retreating.
- **The player is one objective short:** the remaining objectives get full garrisons,
  1.5× reinforcements and all-infantry purchases, placed near them.
- **Spoiling attacks:** wiping out player units that could strike a guarded objective
  next turn earns extra score.
- **Hold objectives:** territories the player must hold are always worth attacking.
- **Playing the player's side** (balance checks): it goes all-in for the missing
  objectives on the last turn.

It also plans amphibious landings from loaded transports, retreats from hopeless fights,
and only counts landing spots that exist (it doesn't plan carrier moves). In 336
generated puzzles played against the earlier version, the player side's win rate fell
from 53% to about 51%. It is a fair opponent for small puzzles, not a strong general one:
it makes no multi-turn plans.

## Maps

### TripleA maps (default)

| Bundled map | File | Credit |
|---|---|---|
| Total World War: December 1941 | `maps/total_world_war.json` | map by Rolf Larsson and Hepster |
| World At War | `maps/world_at_war.json` | map by Sieg |

**Importing more:** in the authoring tool, **Scenario → Browse TripleA maps…** loads
`triplea_maps.yaml`, the catalogue TripleA's "Download maps" screen uses (about 300 maps).
Search it, open a map, pick one of its games (starting setups), and **Import**. The tool
reads the map's text files straight from `raw.githubusercontent.com/triplea-maps/…`:
`map.yml`, the game XML, `polygons.txt`, `centers.txt` and `map.properties`. It writes
`maps/<id>.json` and adds it to `maps/index.json`. From a terminal:

```sh
node tools/triplea_fetch.js list "1942"                       # search the catalogue
node tools/triplea_fetch.js games world_war_ii_v5_1942        # the games a map offers
node tools/triplea_fetch.js import total_world_war --game "3.0" --credit "map by …"
```

What is converted:
- territory borders (simplified to about one pixel)
- connections and production values
- starting owners, capitals and impassable territories
- canals and controlled straits
- the map's turn order and colours
- starting units and money

TripleA's many custom unit types are folded into Tacticle's set: for example
`germanInfantry`, marines and paratroopers become infantry, anti-tank guns become
artillery, and tactical bombers become fighters. Map dressing such as airfields,
railways, flags and fortifications is skipped. Images (relief, tiles) are not used;
Tacticle draws the borders itself in each power's TripleA colour. On an imported map,
making a territory playable fills in its TripleA starting units.

Rules always come from the Tacticle rule set chosen for the puzzle (1942 Second Edition
by default), not from the map's XML.

**Credit and licences:** the bundled maps' repositories carry no licence file. The
player page names the map and its authors in the briefing and help. Check you are happy
with the terms before publishing puzzles on any TripleA map. The catalogue also lists
TripleA's recreations of the published Axis & Allies boards (World War II Classic,
Revised, v3–v6, Pacific, Europe and Global). Those are not bundled; import them yourself
if you want them.

### Tacticle's world map (optional)

`maps/world1942.json` is an original board made for Tacticle: 191 land territories and
101 sea zones in a Miller projection, with the seam in the Bering Strait so the Pacific
wraps left–right. It is built by `tools/build_world_map.py` from **Natural Earth**
1:50m countries and provinces (public domain), downloaded to `tools/cache/` on first run.
Territory groupings, names, IPC values and spring-1942 owners are defined in
`tools/world_config.py`. Sea zones are Voronoi cells around hand-placed points, clipped
to open water. Adjacency is measured on full-detail shapes, and the board is simplified
as one coverage so shared borders stay shared.

```sh
pip install shapely
python3 tools/build_world_map.py --preview /tmp/preview.svg   # ~2 minutes
```

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
js/triplea.js                 TripleA catalogue reader and map converter
tools/triplea_fetch.js        TripleA import from the command line
js/worker.js                  Web Worker for generation and balance checks
tools/serve.js                static server + save API for the authoring tool
tools/build_world_map.py      world map builder (+ tools/world_config.py)
tests/                        node --test suites
```
