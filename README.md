# New Projection

A real-time strategy game for the browser, built on **WebGL2**, with a **Warcraft III–style
ruleset** and a strictly **black-and-white, single-line** art style. No sprites, no texture
files, no colours — every unit, building and tree is drawn procedurally as stick-figure line
art on a top-down isometric (StarCraft-style) field.

```
npm install        # optional, only needed for the browser test tools
npm start          # http://localhost:5173
```

Open the page, press **New Game**, and you are commanding the Human Alliance against a
computer player on a procedurally generated, mirror-symmetric map.

---

## What is in the game

### Economy and tech tree
* **Gold and lumber**: peasants mine gold mines and chop trees, carry the load back to the
  town hall, and repeat. Food is provided by farms; units consume it.
* **Upkeep** works like WC3: above 50 food you deliver less gold, above 80 less again.
* **Three town tiers** — Town Hall → Keep → Castle — gate higher technology exactly like the
  original: tier 2 unlocks the Sanctum, Blacksmith upgrades and Knights; tier 3 unlocks the
  Castle-tier units (Mortar Teams) and the Arcane Vault.
* **Twelve buildings**: Town Hall/Keep/Castle, Farm, Altar of Kings, Barracks, Blacksmith,
  Lumber Mill, Arcane Sanctum, Arcane Vault, Guard Tower, Cannon Tower — each with real
  requirements and costs.
* **Five multi-level upgrades** at the Blacksmith (Iron Forging, Black Gunpowder, Plated
  Armor, Masonry, Animal War Training), each with real stat effects and prerequisites.
* **Nine trainable units**: Peasant (and Militia), Footman, Rifleman, Knight, Mortar Team,
  Priest, Sorceress, Water Elemental (summoned).

### Combat
* WC3 **damage/armour type matrix** (normal, pierce, siege, magic, hero vs. light, medium,
  heavy, fortified, hero) with percentage multipliers and armour reduction.
* Attack ranges, cooldowns, projectiles, animations, damage-over-time, stuns, buffs, auras.
* Units hold their ground once in melee range; ranged units fire from range and keep their
  spacing. Attack-move, hold position, stop, guard behaviour and neutral creeps that leash
  back to their camp.

### Heroes and items
* Three heroes (Archmage, Mountain King, Paladin) with **attributes, levels 1–10, skill
  points, learnable abilities, ultimates and passive auras**, bought at the Altar.
* **Seventeen abilities** — twelve hero abilities, most with several levels (Blizzard, Water
  Elemental, Brilliance Aura, Mass Teleport, Storm Bolt, Thunder Clap, Bash, Avatar, Holy
  Light, Divine Shield, Devotion Aura, Resurrection), plus the Priest's Heal and Inner Fire,
  the Sorceress's Slow and Invisibility, and hero passives.
* **Six inventory slots** and **ten items**: potions and scrolls with charges, passive gear
  (Ring of Protection, Boots of Speed, Claws of Attack) and attribute tomes. Creeps drop
  items, and only a hero standing near the Arcane Vault can buy from it.
* Heroes **die and revive at the Altar** on a level-scaled timer, dropping their inventory.

### Fog of war
* Per-team grid with three states (unexplored, explored, visible), uploaded to the GPU as an
  `RG8` texture and applied in the terrain fragment shader, so the fog has soft edges.
* Enemies are only drawn while visible; terrain and buildings stay once explored. The
  minimap mirrors the same fog state.

### UI
A full WC3-style console, all drawn with the same WebGL primitives as the world:

* resource bar with gold / lumber / food, upkeep state and game clock
* hero panel with portrait, level, HP/mana/XP bars, learnable ability icons
* minimap with terrain, fog, units, buildings and the camera frustum (click to move)
* selection panel with portrait art, multi-selection icons, live stats
* production queue chips with progress (click to cancel)
* six-slot inventory with tooltips and click-to-use
* 4×3 command card with hotkeys, costs, cooldown/charge counters and full tooltips
* message log, idle-worker button, control-group chips, placement ghost, main/pause/help/victory
  screens

### Audio
Every sound is synthesised at runtime with the WebAudio API (sword hits, bow shots, cannon
fire, spells, level-up fanfares). Nothing is loaded from disk. `Ctrl+M` mutes.

---

## Controls

| Input | Action |
| --- | --- |
| Left click | Select |
| Drag | Box select |
| Double click | Select all of that type on screen |
| Right click | Smart order (move / attack / gather / repair / pick up / set rally) |
| `A` + click | Attack-move |
| `M` | Move |
| `S` / `H` | Stop / hold position |
| `B` | Build menu (peasant) |
| `Ctrl` + `1‑5` / `1‑5` | Assign / recall control group |
| Arrow keys, screen edge, middle-drag | Camera |
| Mouse wheel | Zoom |
| `Space` | Centre on town hall |
| `Tab` | Cycle the selection |
| `F1` / `Esc` | Help / menu |
| `Ctrl+M` | Mute |

Command-card hotkeys are the letters shown in each button's corner.

---

## Architecture

```
index.html            canvas + boot overlay
styles.css            page chrome (the game itself is drawn in WebGL)
src/main.js           entry point, error overlay
src/game.js           loop, input, selection, orders, camera, audio wiring
src/core/util.js      iso projection, RNG, maths, armour multipliers
src/sim/world.js      the whole simulation: units, buildings, combat, economy, heroes, items
src/sim/mapgen.js     procedural 80×80 mirror-symmetric map with camps and mines
src/sim/pathfinder.js A* with request queueing and path smoothing
src/sim/fog.js        per-team fog grids
src/ai/ai.js          skirmish AI (economy, tech, army, heroes, expansion, attacks)
src/data/*.js         WC3-derived data tables: units, buildings, abilities, items, creeps, upgrades
src/gl/gl.js          WebGL2 renderer: terrain, shapes, text, fog texture
src/gl/font.js        canvas-rasterised glyph atlases (no font files shipped)
src/render/*.js       camera/world pass, procedural line art, palette, terrain mesh
src/ui/*.js           command-card logic, theme primitives, the HUD
src/audio/audio.js    procedural sound effects
tools/serve.mjs       tiny static server for development
tools/test-*.mjs      headless test suites (simulation, rendering, interaction, systems)
```

Design rules the code sticks to:

* **The simulation never touches the DOM or WebGL.** `src/sim` and `src/data` are plain data
  and logic, so they run headlessly under Node and are covered by tests.
* **No build step and no dependencies at runtime.** Plain ES modules loaded straight from
  disk; `npm start` only serves files.
* **Monochrome only.** The palette (`src/render/palette.js`) contains only greys; faction
  identity is conveyed through line style, ring ticks and density, not colour.

---

## Tests

```bash
npm test             # headless simulation: economy, combat, heroes, abilities, fog, items
npm run test:render  # renders the whole game against a mock WebGL2 context
```

The three browser suites need Puppeteer and a Chromium build (already in
`devDependencies`, ~60 MB, only fetched when you `npm install`):

```bash
node tools/serve.mjs 5199 &     # the suites expect the game on :5199
npm run test:play               # real mouse/keyboard playthrough
npm run test:systems            # tier upgrades, research, shops, revive, victory
npm run shots                   # writes screenshots to shots/
```

`tools/test-play.mjs` drives the game the way a player would — clicking peasants,
right-clicking mines, boxing units, opening the build menu, placing a farm, training at the
town hall, summoning a hero from the Altar, learning and casting abilities, using an item,
attack-moving, scrolling the minimap and pausing — and asserts on simulation state after each
step.

---

## Notes

* The ruleset is modelled on Warcraft III (and on the open-source reimplementations Warsmash
  and OpenRA for structure), but everything here is original code and data.
* Scope: Human Alliance versus a computer player plus neutral creeps. The data tables are
  written so other races could be added the same way.
* The AI is a scripted skirmish opponent: it keeps peasant counts, expands, techs up,
  researches, levels a hero, buys items and attacks in waves once its army is big enough.
