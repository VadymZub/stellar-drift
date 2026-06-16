# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the game

```powershell
cd client
.\run.ps1          # starts python -m http.server 8080, opens http://localhost:8080
```

No build step. Phaser 4.1.0 loads from CDN as an ES module. ES modules require HTTP (not `file://`), so the server is mandatory.

**DEV hotkeys** (in-game, `DEV_MODE = true` in `GameScene.js`):
- `0` — level up pilot
- `9` — +1 000 000 credits + 500 ⭐
- `8` — switch to Argus ship (max stats); engine speed uses T4 base 27 (matches item nerf)

**Test profile launcher** (DEV_MODE): clicking START GAME on the login screen opens `TestProfileScene` — an HTML overlay to configure level, rank, corp, premium, loot preset, credits, and gold before launching the game. Sets `window.TEST_PROFILE`, consumed once by `GameScene.create()`.

**Admin panel**: `http://localhost:8080/admin.html` — standalone page, same origin as game. Sections: Dashboard, Argus Control, Players (mock), Audit Log, Analytics.

## Architecture

### No-build, no bundler

All imports use full CDN URL for Phaser: `import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js'`. All other imports are relative paths. There is no `package.json` in `client/`.

### Scene graph

Scenes registered in `main.js` in this order:

```
BootScene       — asset preload (all textures, spritesheets, locale JSON)
LoginScene      — title screen; in DEV_MODE routes to TestProfileScene
BackgroundScene — persistent parallax background (runs alongside GameScene)
TestProfileScene — dev-only HTML overlay, sets window.TEST_PROFILE
GameScene       — core game loop; owns all persistent player state
HudScene        — overlay UI (stats, minimap, event log, action bar)
InventoryScene  — I key
CargoScene      — cargo/warehouse
ClanScene       — clan UI
GarageScene     — G key: ships, modules, upgrades, perks tabs
MapScene        — M key: galaxy map
MissionsScene   — missions
ShopScene       — shop
CorpScene       — C key: corporation standings/switch
BaseMenuScene   — base interaction
SkillScene      — K key: skill tree
```

### GameScene as state owner

`GameScene` is the single source of truth for all player state. All other scenes access it via `this.scene.get('GameScene')` (aliased as `gs` or `this.gs`). Key fields:

- **Currency**: `gs.credits`, `gs.starGold`
- **Pilot**: `gs.pilotXp`, `gs.pilotHonor`, `gs.pilotLevel`, `gs.pilotRank` (object from `RANKS`, not a string), `gs.playerName`
- **Corp**: `gs.playerCorp` (`'helios'|'karax'|'tides'|'neutral'`), `gs.corpRep`, `gs.seasonWon`
- **Ships**: `gs.ownedShips` (Set of keys), `gs.activeShip`, `gs.shipLevels`
- **Modules**: `gs.equipped` (`{ weapon: [], shield: [], engine: [] }`), `gs.inventory`, `gs.warehouse`
- **Skills**: `gs.skillLevels`, `gs.actionBar` (10-slot array), `gs.skillAchievementSP`
- **Premium**: `gs.premium`

State persists across `scene.restart()` (sector jumps) because it lives on the Scene object. Fields are initialised with `??` / `||` to preserve values on restart.

### Galaxy and sectors

`galaxy.current` in `galaxy.js` is a **mutable global string** (e.g. `'helios_1'`). Mutated on jumpgate transit and on corp switch. `BackgroundScene` and `HudScene` react to changes in their `update()` loops.

`SECTORS` object in `galaxy.js` defines all 40+ sectors. Each has `{ name, map, lvlMin, lvlMax, sx, sy, isDungeon?, pvp? }`. Corp home sectors: `helios_1 / karax_1 / tides_1`.

### Entities

- **`Player.js`**: Wraps a Phaser image + physics body. Stats computed by `recomputeStats()` from equipped modules + ship base + skill bonuses. `applyShip(shipDef)` switches the active ship. `lockedRotation = true` disables heading changes during jump animation. Sprite art is drawn nose-down → always add `ART_ANGLE_OFFSET` (-π/2) to `facing` when writing `sprite.rotation`.

- **`Mob.js`**: `constructor(scene, template, level, x, y, opts)`. Template comes from `MOBS` in `constants.js`. Stats scale: `base × (1 + 0.5 × (level − 1))`. `update(dt, player, inSafeZone, fireCallback)`. Boss mobs have enrage phases below 40% hull. `mob.neutral = true` means non-hostile (doesn't attack).

- **`Projectile.js`** / **`Loot.js`**: Short-lived entities managed as arrays on `GameScene` (`this.projectiles`, `this.loot`).

- **`ArgusController.js`** (`systems/`): Admin-spawned boss. Created in `GameScene.create()`, updated after `mobs.forEach` in `GameScene.update()`, destroyed in `GameScene.shutdown()`. Communicates via `BroadcastChannel('stellar-drift-admin')`. Commands: `ARGUS_SPAWN | ARGUS_DESPAWN | ARGUS_HEAL | ARGUS_FORCE_ABILITY`. Broadcasts `ARGUS_UPDATE` every 0.5 s. Wraps `mob.takeDamage` at spawn time to track per-player damage for the top-5 reward leaderboard. **Speed is flat (`m.tpl.speed`), not level-scaled** — only hull/shield/damage scale with level in Mob.js. Movement state machine: `approach` (dist > 1500 px) → `oscillate` (sine-wave distance 360–760 px + slow drift) → `orbit` (tight 380 px circle, triggers at hull < 50% or incoming DPS > 12% maxHull in 3 s). Self-heal every 180 s: +30% hull + shield.

### Ranking system

`pilotRank` is always an **object from the `RANKS` array** (shape: `{ id, name, type, limit? | percent? }`), never a bare string. `getRank(playerRating, allRatings)` in `ranking.js` returns this object. Rating formula: `(xp/2_800_000 × 0.4) + (honor/1_000_000 × 0.6)`. Rank is positional within the `MOCK_CORP_RATINGS` pool.

### Items and modules

Modules have `type: 'cannon'|'shield'|'engine'` and `tier: 1–4`. Upgrade has two mutually exclusive paths: credits (+7.5% max) or stars (+45% max). Modules carry a `perk` object (rolled at drop). `rollCannon/rollShield/rollEngine(tier, mobLevel)` in `items.js` use `Phaser.Math.FloatBetween`.

Engine base speeds (after ÷3 nerf): T1=10, T2=15, T3=20, T4=27 px/s. Max star upgrade (×1.45): T4 ≈ 39 px/s. `modMult(item) = 1 + 0.015×creditLvl + 0.09×starLvl`.

### Render depth conventions

| Depth | Layer |
|---|---|
| -19 | Background image |
| -18 | World boundary vignette |
| -10 | Space dust (boost-only) |
| 4 | Jumpgate ring |
| 40 | Mobs |
| 45 | Reticle |
| 50 | Player |
| 51 | Player nameplate |
| 55 | Course arrow |
| 58 | Collect graphics |
| 59 | Engine trail particles |

### Phaser 4 API notes

Phaser 4 differs significantly from Phaser 3:

- **Particles**: No `setSpeed()`, `setAngle()`, `setScale()`. Use direct emitter properties: `emitter.speedX`, `emitter.speedY`, `emitter.scaleX`, `emitter.scaleY`. Toggle: `emitter.emitting = true/false`.
- **Scene restart with data**: `this.scene.restart({ startX, startY })` — data arrives as the `data` argument in `create(data)`.
- All text uses `resolution: UI_RES` for sharp rendering at non-integer DPR.

### i18n

All user-facing strings go through `i18n.t('key')` (locale file: `locales/ru.json`). Never hardcode Russian text in JS.
