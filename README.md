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
- Moving: highlighted territories are legal destinations (red outline = attack). A dashed
  outline means only some of the selected units can go there (tanks two spaces away with
  infantry selected too, say): tapping it moves those, and the rest stay where they are.
  Moving land units into a sea zone loads them onto your transport; select the sea zone and
  tap a coast to unload. Drag to pan, pinch or scroll to zoom, <kbd>Esc</kbd> cancels,
  <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes a move.
- Ending combat movement asks for confirmation in an in-page popup that lists the battles
  about to be fought.
- **Battles:**
  - With several battles you pick each one from the list, and the page returns to the
    list after each. A single battle opens by itself.
  - The battle window is laid out like the battle board: one row per combat value, 1 at the
    top, the attacker's units on the left and the defender's on the right, and units that
    cannot fire in a "–" row at the bottom. Infantry supported by artillery sit in the 2 row.
    Each die sits in the row of the value it was rolled at, so hits are easy to read off.
    On small screens the buttons stay pinned to the bottom of the window.
  - A round follows the rule book. **Roll dice**: your dice grow in, then the defender's
    casualties are outlined in red with a "−n" count and a brief shake. They stay on show and still fire back.
    After a short pause the defender rolls, and your casualties are marked the same way.
  - Both sides' dice and every casualty of the round stay on show. Tap one of your unit
    types to lose one of those instead of another (tapping a fully marked type unmarks one).
  - Units that cannot fight back at all (transports, AA guns) are destroyed outright once
    nothing else is left on their side and the enemy can hit them, instead of being rolled
    at until a die hits. AA guns still get their shot at attacking aircraft first.
  - Then **Press the attack** (the casualties shrink away and the next round is rolled),
    **Retreat**, or, if the battle is decided, **End of battle**. **Submerge subs** appears
    when your submarines can dive.
  - **Retreat** closes the battle window and outlines, with arrows, where your units can go.
    Click one on the map and every unit that can retreat goes there together. Nothing else
    can be done until then, apart from going back to the battle.
  - When the computer attacks you, it rolls first and your casualties are marked. Change
    them if you like, then **Roll for defense**. After your roll it pauses briefly and then
    presses on or retreats.
  - Opening fire (AA guns, shore bombardment, submarine surprise strikes) is shown the same
    way, labelled by the dice. It pauses for you only when you have a choice of casualties.
  - Reloading mid-battle resumes at the same step with the same dice.
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

### Player results (optional)

A static site has no server of its own to count results, so Tacticle can use a free
[GoatCounter](https://www.goatcounter.com) site:

1. Create a site at goatcounter.com (its code is the `mycode` in `mycode.goatcounter.com`).
2. In its settings, turn on **Allow adding visitor counts on your website** so counts can be
   read back.
3. Put the code in `config.json`: `{ "results": { "goatcounter": "mycode" } }`.

From then on, each finished daily game is recorded once per browser as two hits:
`/tacticle/<date>/<puzzle id>/won|lost` and `/tacticle/puzzle/<puzzle id>/won|lost`.
Free play and play tests are never recorded.
- **Share text:** before recording, the result screen reads the day's counts and adds
  "🌍 62% of other players won today" as the second-to-last line. The snapshot is kept, so
  the line doesn't change on reload.
- **Authoring tool (Edit Map → Test → Player results):** lists each puzzle's real win rate next to
  its balance check.
  - The balance check is now saved with the puzzle as `balance.winRate`; generated puzzles
    already carry `generator.winRate`.
  - The gap is not the same at every rate (a puzzle at 95% can't gain 35 points), so the tool
    fits a curve in log-odds, `players = σ(a + b·logit(check))`, by maximum likelihood over
    puzzles with at least 5 players. A mild pull toward "no difference" stops a few puzzles
    giving a wild curve, and the slope is fitted only from 3 puzzles up.
  - Example: if players won 85% of a puzzle the check put at 50%, the curve maps a check of
    5% → 22%, 20% → 58%, 80% → 96% and 95% → 99%.
- **Generate a puzzle (Select Map):** "Aim for real players" maps the target band through the inverse curve. For
  players to win a medium puzzle 45–72% of the time in that example, the check aims at 13–32%.
- **Privacy and reliability:** GoatCounter keeps no cookies and nothing beyond a page view
  is sent. Anyone could send fake hits, so treat the numbers as a guide. With the code
  empty (the default), nothing is sent or read.

## Authoring

Run `node tools/serve.js` and open `author.html`. The page autosaves a draft in the
browser. Four tabs on the left take a puzzle from map to calendar: **Select Map**,
**Edit Map**, **Schedule** and **Files**. Undo and redo work everywhere:
<kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd>.

**Select Map.** A scrollable list of the maps, each with a small picture. Click one to see
it full size on the right, then **Select Map** (bottom right) to start a puzzle on it and
go to Edit Map. Picking the map the current puzzle already uses just continues editing it.
Below the list:

- **Import base map…**: TripleA's map catalogue (see [Maps](#maps)), or a TripleA map from
  files on your computer.
- **Import existing scenario…**: open a saved puzzle, or a puzzle JSON file.
- **Generate a puzzle…**: a new puzzle on the map being looked at: theatre, size,
  difficulty, player side, optional fleets and transports, and on TripleA maps the option
  to **use the map's own starting armies**. It plays computer-vs-computer games in a Web
  Worker and adjusts the armies toward a target win rate (easy 70–92 %, medium 45–72 %,
  hard 22–48 % for the computer playing your side).

**Edit Map** has five steps. A step shows ✓ once it has what a puzzle needs, and each has
**Next: <step> →** at the bottom right, next to the file name and **Save**.

| Step | Key | On the map |
|---|---|---|
| 1. Select Territories | <kbd>P</kbd> | Click: in/out of play (a unit icon removes one of those units; a transport takes the cargo that no longer fits). Shift-click: it **and all neighbours**. Right-click: out of play. |
| 2. Select Owners | <kbd>O</kbd> | Click: give it to the chosen power (or Neutral). Alt-click: the map's owner. Right-click: neutral. |
| 3. Place Units | <kbd>U</kbd> place, <kbd>S</kbd> select, <kbd>M</kbd> move, <kbd>1</kbd>–<kbd>9</kbd> pick a unit | See below. |
| 4. Set Objectives | <kbd>J</kbd> | Click: add or remove the territory in the chosen objective. |
| 5. Test | <kbd>T</kbd> | |

1. **Select Territories.** **+ Neighbours** grows the area by one ring; **+ Seas** adds sea
   zones that touch two or more coasts in play; **Remove all** empties it. A territory put in play brings its map owner,
   its factory and the map's starting units. Taking it out of play also takes it out of any
   objective. Moving on to a later step frames the map on the area in play.
2. **Select Owners.** Pick a power (or Neutral), then click territories. Below: the powers in
   the puzzle in turn order (player or computer, team, starting IPCs, IPCs per turn, capital).
   Powers join automatically when they own a territory or units.
   - **IPCs per turn** is by default the value of the territories the power holds in play.
     **Set amount** fixes what it collects instead. Captured territories still add their value
     and lost ones take it away, unless "The same every turn, whatever is captured or lost" is
     ticked. Losing the capital still stops income, and nobody collects anything when income
     is off (Set Objectives → Game rules).
3. **Place Units.** Pick a unit from the pictures, then click territories: each click adds
   one for whoever controls the territory (Shift +5, right-click −1, Ctrl-click clears). At
   sea the unit goes to the power chosen under "Units placed at sea belong to". Click the
   picked unit again, or press <kbd>Esc</kbd>, to stop placing. Then a click selects a
   territory, and the right-hand panel changes its units with − and +, including **troops of
   another country** (friendly powers are listed first). **Auto Populate** gives every
   territory in play that has no troops the map's starting units; a territory with a new
   owner gets its map owner's units. **Move units** moves units between territories, as on
   the player page.
4. **Set Objectives.** Each objective belongs to **You** or the **Opponent**:
   - *Capture*: control the territories when objectives are checked.
   - *Hold*: never lose them (the game runs to its last turn). Player only.
   - *Clear*: no enemy units left in them.
   - *IPC in the bank*: have that much unspent money, e.g. "Have 20 IPC in the bank".
   - *Inflict damage*: destroy that much enemy unit value (IPC cost) while losing no more
     than a limit, e.g. "Inflict 15 IPC of damage while losing no more than 10".

   The player wins when all their objectives are met at the check. **Needed to win** can
   lower that to "any N of M" (saved as `"objectivesNeeded": N`). The opponent wins as soon
   as all its objectives are met at the end of one of its turns. Also here: the number of
   turns; **when objectives are checked** (at the end of each of the player's turns, at the
   end of one chosen turn, which also ends the game, or after all opponents can
   counter-attack); rules, income and buying; and the title, briefing ("Write from
   objectives" drafts one), author and difficulty.
5. **Test.**
   - **Checks** come first, each with a link to the step that fixes it. Problems marked ✖
     stop the puzzle from starting, so the Play buttons wait until they are fixed; ⚠ marks
     things to look at, such as a missing title or briefing.
   - **Play** in a new tab as the player, as the opponent (the computer plays the player's
     side), or both sides. Test games are kept apart from the daily save; results are the
     player side's.
   - **Win odds** runs *N* computer-vs-computer games and keeps the rate with the puzzle.
   - Also: the computer opponent (standard or earlier), the checks, **Make a variant**
     (armies nudged, an objective moved to a neighbour, turn limit ±1, tuned the same way),
     player results, a battle-odds calculator and a share-text preview (the last three fold
     away).

**Saving.** Type a file name above **Save** (<kbd>Ctrl</kbd>+<kbd>S</kbd>, or Enter in the
field); the file it will write shows as you type. Saving writes `puzzles/<name>.json` and
refreshes `puzzles/index.json`; the button then reads **Saved** until the next change. If another puzzle already has that name, the first click only warns
("A save file with this name exists, click again to overwrite it") and the second click
saves. After a save, **Schedule It** opens the Schedule tab with a button that puts the
puzzle on the first free day.

**Schedule.** A calendar of the next weeks: pick a puzzle per day, set the first day
(puzzle #1), or use "Fill empty days with unscheduled puzzles".

- **Saving:** every change saves `schedule.json` by itself, through the local server or a
  connected folder.
- **Without either** (e.g. on GitHub Pages): changes are kept in the browser and survive a
  reload. **Download schedule.json** to publish them, or **Discard changes**.

**Undo and questions.** Edits that remove things (Remove all, deleting an objective,
removing a power, rewriting the briefing) happen at once with **Undo** in the message that
reports them. Steps that cannot be undone (replacing a puzzle that has unsaved changes,
deleting a saved file) ask first in the page; the safe answer, such as **Keep editing**,
has the focus, so Enter or Esc never throws work away.

**Files.** Open, delete, save a copy, download and import JSON. Without the server, Chrome and
Edge can **connect the repository folder** and write files directly; other browsers
download the files for you to copy in.

If the draft cannot be opened at start-up (usually because its map is missing), the page
starts a new puzzle and keeps the draft; **Files** offers to open it once the map is back.

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
set `"capital": "<territory id>"` (or `null` for none), and `"income": N` to collect N IPCs a
turn instead of its territories' value. Captures and losses still change that by the
territories' values, unless `"incomeFixed": true`.

Objectives:

- `{ "type": "capture" | "hold" | "destroy", "territories": [ … ] }`
- `{ "type": "bank", "ipc": 20 }` and `{ "type": "damage", "inflict": 15, "maxLoss": 10 }`
  (`maxLoss` is optional).
- `"side": "opponent"` makes it the computer's objective (any type but `hold`).

`"winCheck"` is `"turnEnd"` (the end of each of the player's turns), `"roundEnd"` (after the
counter-attack), or `"turn"` with `"checkTurn": N` (only at the end of the player's turn N,
which also ends the game).

## Rules

Rule sets are chosen per puzzle. The default is **1942 Second Edition**:

| Unit | Cost | Att | Def | Move | Notes |
|---|---|---|---|---|---|
| Infantry | 3 | 1 | 2 | 1 | attacks at 2 when paired with artillery |
| Artillery | 4 | 2 | 2 | 1 | supports one infantry |
| Tank | 6 | 3 | 3 | 2 | blitzes through empty enemy land |
| AA gun | 5 | 0 | 0 | 1 | before round 1, up to 3 shots (1 per plane) hitting on 1; no combat move; can be a casualty; destroyed without combat when no combat units defend with it |
| Fighter | 10 | 3 | 4 | 4 | lands on carriers |
| Bomber | 12 | 4 | 1 | 6 | |
| Submarine | 6 | 2 | 1 | 2 | surprise strike and submerge unless an enemy destroyer is present; can't hit aircraft; passes enemy ships and may end a noncombat move among them |
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

Checked against the 1942 Second Edition rulebook:

- **New ships in a hostile sea zone** (p. 22): new sea units, and fighters on carriers, may be
  placed in a sea zone adjacent to the factory even when enemy warships are there. No combat
  happens then. On a later turn, a power whose ships share a sea zone with enemy surface
  warships must fight there or move away (p. 9). Ships left there are in a battle when combat
  move ends, and the combat-move panel warns about it.
- **Submarines** (pp. 16, 30): each round starts with the surprise strike (attacker's subs
  hit on 2, then defender's on 1; hits are removed before anyone fires back) or submerging.
  Attacker and defender may both submerge; the player decides with the buttons, the computer
  dives when its defence is likely lost. Subs can't hit aircraft. An enemy destroyer cancels
  surprise strike and submerging, and lets aircraft hit subs; whether a destroyer is present
  is judged when the round starts (p. 17, step 5 note).
- **Defenceless units** (pp. 17, 25): transports with nothing left to protect them (no combat
  units, or only combat units that can't hit the enemy, such as subs against aircraft) are
  destroyed without a roll; attacking transports that can still retreat are not. AA guns
  without combat units are destroyed without combat, and take no AA shot.

Other rule sets: **1941** (1942 units without AA guns), **Revised** (tanks 5,
bombers 15, destroyers 3/3 for 12, carriers 1/3 for 16, battleships 24, no cruisers;
AA guns fire at every plane and are captured; transports defend at 1), and **Classic**
(no artillery, destroyers or cruisers; one-hit 24-IPC battleships; tanks 3/2).

Simplifications compared with the board games: no strategic bombing raids (bombers
fight as normal attackers); transports carry only their own power's units; a
transport can't load in a zone with enemy warships; units loaded during combat movement
that stay aboard simply remain loaded; unplaced purchases carry over to the next turn;
a sea zone that holds only enemy submarines is always attacked when ships end a combat
move there (the rulebook lets them ignore the subs: move there in noncombat instead); and canals (Suez, Panama) open only
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
and only counts landing spots that exist (it doesn't plan carrier moves). It makes no
multi-turn plans.

**Settings by role.** The strategy has numeric settings (`AI.DEFAULTS` in `js/ai.js`). The
side defending the objectives (the computer, in capture and clear puzzles) uses settings found
by a genetic search (`AI.ROLES.defend`):
- **Attacks:** it attacks only at good odds (about 80%), leaves expensive units out of attacks
  more readily, and weighs the counterattack on survivors.
- **Defence:** it keeps 1.6× the threat in threatened territory, stacks objectives to 3× the
  threat, and pulls units out of "dead zones" (places facing more than 1.8× their defence that
  the objectives don't need) into the strongest safe stack.

The attacking side keeps the defaults, because these settings make it a poor attacker. A
puzzle can keep the earlier opponent with `"opponent": "earlier"` (authoring tool, Edit Map
→ Test).

**How the settings were chosen.** `tools/ai_bench.js` plays a fixed set of scenarios (the
saved puzzles plus 36 generated ones) with fixed seeds, the player's side and the computer's
side each with their own settings. Lower player win rates mean a stronger computer.
- **Baseline:** with both sides on the earlier strategy, the player side won 46.3% of 294 games.
- **Hand-picked, one at a time:**
  - dead zones: 40.1%;
  - a heavier garrison: 41.8%;
  - leaving units out of attacks more readily: 43.9%;
  - income awareness, endgame unit value, infantry-only buying, objective odds: no games changed;
  - all of them combined: 35.7%.
- **Genetic search** (`tools/ai_evolve.js`, 10 settings, population 10, 8 generations): each
  candidate played the computer side against the earlier strategy and against the previous
  champion, on fresh seeds each generation. Its champion reached 34.7%.
- **Held-out check:** on 60 generated scenarios that neither the search nor the hand-picking
  saw (360 games), the player side's win rate fell from 57.5% to 50.0% with the evolved
  settings (z ≈ 3.9), against 52.5% with the hand-picked combination.

The gain on the training scenarios (11–12 points) was larger than on new ones (7–8 points):
part of it was fitted to those scenarios.

**Win-probability model** (`js/value.js`, trained by `tools/ai_value.js`). This is a classifier
that estimates, from any position, the chance that the player's side wins, like a chess
evaluation bar.
- **Features:** objectives met and missing, player turns left, units' IPC value and
  attack/defence for each side, attack within reach of each objective (one and two turns)
  against its defenders, threat to held objectives, income and money. It also simulates the
  chance of taking the objectives still needed next turn, and of the enemy retaking those held.
- **Data:** 19,253 positions from 5,225 self-play games on 209 training scenarios, with random
  strategy settings for each side so the positions vary.
- **Quality on 2,861 positions from the 60 held-out scenarios:**

  | Model | Log-loss | Accuracy | AUC |
  |---|---|---|---|
  | Constant win rate | 0.749 | 55% | 0.52 |
  | Objectives and turns only | 0.727 | 56% | 0.64 |
  | Logistic regression (used) | 0.570 | 69% | 0.78 |
  | Network, 16 hidden units | 0.575 | 71% | 0.78 |

  The two battle-odds features improved the log-loss from 0.598. The model is somewhat
  overconfident at the extremes: positions it puts at 90% are won about 81% of the time.

**Using the model to choose actions.** Two settings, both off by default, each measured against
the GA-tuned opponent (player side's win rate; benchmark / held-out 1 / held-out 2):

| Computer side | Benchmark | Held-out 1 | Held-out 2 |
|---|---|---|---|
| GA settings | 34.7% | 43.1% | 54.6% |
| `valueMoves` | 35.0% | 43.8% | 51.4% |
| `lookahead` | 34.7% | 43.1% | 55.1% |

- **`valueMoves`:** in noncombat move it moves land units one at a time to wherever the model
  rates the position best, until no move improves it. Across all three sets it turned 12 games
  into computer wins and 7 into player wins, so no reliable gain.
- **`lookahead`:** it plays its turn on copies of the game with each candidate strategy
  (`AI.POLICIES`), using fresh dice, and plays the one whose resulting positions the model rates
  best. It changed almost nothing: the candidates often produce identical moves, and the
  computer usually has only one or two turns.
- **Conclusion:** the GA-tuned rules already do what the model rewards (stacking objectives,
  leaving dead zones), so the model adds little on top of them.

```sh
node tools/ai_value.js pool                      # training scenarios (benchmark set + generated)
node tools/ai_value.js data --games 25           # self-play positions with outcomes
node tools/ai_value.js train                     # fit, report held-out quality, write js/value.js
node tools/ai_bench.js run --foe '{"valueMoves":true}'
```

```sh
node tools/ai_bench.js build                       # scenario set (tools/cache/bench.json)
node tools/ai_bench.js run --foe '{"roles":false}' # player side's win rate against the earlier computer
node tools/ai_bench.js compare variants.json       # {"name": {settings}, ...}, each paired against the defaults
node tools/ai_evolve.js --pop 10 --gens 8          # genetic search; result in tools/cache/evolved.json
```

## Maps

### TripleA maps (default)

| Bundled map | File | Credit |
|---|---|---|
| Total World War: December 1941 | `maps/total_world_war.json` | map by Rolf Larsson and Hepster |
| World At War | `maps/world_at_war.json` | map by Sieg |

**Importing more:** in the authoring tool, **Select Map → Import base map…** loads
`triplea_maps.yaml`, the catalogue TripleA's "Download maps" screen uses (about 300 maps).
Search it, open a map, pick one of its games (starting setups), and **Import**. The tool
reads the map's text files straight from `raw.githubusercontent.com/triplea-maps/…`:
`map.yml`, the game XML, `polygons.txt`, `centers.txt` and `map.properties`. It writes
`maps/<id>.json` and adds it to `maps/index.json`. Without the server (for example on
GitHub Pages) the map file downloads for you to add to `maps/` and `maps/index.json`, and a
copy is kept in the browser (IndexedDB), so you can build and play-test puzzles on it
straight away. From a terminal:

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
js/value.js                   win-probability model (features + trained weights)
js/generator.js               procedural puzzles and variants
js/mapview.js, js/icons.js    SVG map (pan/zoom/pinch/wrap) and unit icons
js/daily.js                   dates, puzzle numbers, share text
js/results.js                 player results via GoatCounter (config.json)
js/localmaps.js               maps imported in the browser, kept in IndexedDB
js/triplea.js                 TripleA catalogue reader and map converter
tools/triplea_fetch.js        TripleA import from the command line
js/worker.js                  Web Worker for generation and balance checks
tools/serve.js                static server + save API for the authoring tool
tools/ai_bench.js             computer-opponent tournament on fixed scenarios and seeds
tools/ai_evolve.js            genetic search over the opponent's settings
tools/ai_value.js             win-probability model: self-play data, training, evaluation
tools/build_world_map.py      world map builder (+ tools/world_config.py)
tests/                        node --test suites
```




MIT License

Copyright (c) 2026 Thomas Lenz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
