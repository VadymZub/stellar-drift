import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, BASE_WORLD, PVP_WORLD_SCALE, PLAYER, MOBS, PROJECTILE, PROJ_TYPES, RESPAWN_MS, UI_RES, BOSS, DPR, HANDLING, ART_ANGLE_OFFSET, RANKS, BASE_SCAN_RADIUS, HONOR_PER_LVL50, DUNGEON_DIFF, DUNGEON_BOSS_DROPS } from '../constants.js';
import { minimapRect, minimapToWorld } from '../systems/minimap.js';
import { i18n } from '../i18n.js';
import Player from '../entities/Player.js';
import Mob from '../entities/Mob.js';
import Projectile from '../entities/Projectile.js';
import Loot from '../entities/Loot.js';       
import Movement from '../systems/Movement.js';
import { EXP_CLASSES, MOD_ICON_FILES, NPC_PORTRAITS } from './BootScene.js'; 
import { rollLootForMob, dropChance, itemName, rollStarGold, starterCannon, starterShield, rollCannon, rollShield, rollEngine, rollLaser, rollArmor, rollApophisLoot, PLASMATE_PER_SLOT, PLASMATE_DAILY_MAX, addPlasmateToInventory, totalPlasmateInInventory, removePlasmateFromInventory, CONSUMABLES, addConsumableToInventory, countConsumableInInventory, removeConsumableFromInventory, rollConsumableDrop, rollAmmoDrop, MATERIAL_NAMES, RESOURCE_NAMES } from '../items.js';
import { rollBoard, rollConnector } from '../boards.js';
import PlasmateDeposit from '../entities/PlasmateDeposit.js';
import { rollPerk, perkBonus, PERK_DEFS } from '../perks.js';
import { levelInfo, xpToNext, MAX_LEVEL } from '../leveling.js';
import { SHIPS, SHIP_BY_KEY, shipLevelMods } from '../ships.js';
import { SECTORS, galaxy, neighbors, edgeDir, sectorAccess } from '../galaxy.js';
import { calculateRating, getRank } from '../ranking.js';
import VFXManager from '../systems/VFXManager.js';
import MiningBase from '../entities/MiningBase.js';
import HomeBase from '../entities/HomeBase.js';
import ArgusController from '../systems/ArgusController.js';
import ConfedGuardSystem, { getLastResetTime } from '../systems/ConfedGuardSystem.js';
import { getUsername, getToken, apiPut, apiGet } from '../api.js';
import { prepShipTex, removeWhiteBg } from '../utils/prepShipTex.js';
import { MISSIONS, getMissionSectorTarget } from '../data/missions.js';
import EscortTransport, { ESCORT_SPEED, ESCORT_WAVE_AT } from '../entities/EscortTransport.js';
import { loadSettings, getMinimapDims } from '../settings.js';
import SettingsScene from './SettingsScene.js';

const PICKUP_RADIUS = 95;
const PICKUP_TIME = 2000;

const DEV_MODE = true;
const MOCK_CORP_RATINGS = [0.95, 0.92, 0.88, 0.85, 0.82, 0.78, 0.75, 0.72, 0.68, 0.65, 0.62, 0.58, 0.55, 0.52, 0.48];

function xpForLevel(L) {
  let total = 0;
  for (let i = 1; i < L; i++) total += xpToNext(i);
  return total;
}

function applyLootPreset(scene, preset) {
  const tier = { t1: 1, t2: 2, t3: 3, t4: 4 }[preset];
  if (!tier) return;
  const midLvl = [5, 15, 25, 35][tier - 1];
  scene.inventory = [
    rollCannon(tier, midLvl), rollCannon(tier, midLvl),
    rollShield(tier, midLvl), rollShield(tier, midLvl),
    rollEngine(tier, midLvl),
  ];
}

// Compute the intercept point for a projectile flying at `boltSpeed` toward a moving target.
// Returns the aim position (or current target pos if no valid solution).
function _leadTarget(sx, sy, tx, ty, tvx, tvy, boltSpeed) {
  if (tvx === 0 && tvy === 0) return { x: tx, y: ty };
  const dx = tx - sx, dy = ty - sy;
  const a = tvx * tvx + tvy * tvy - boltSpeed * boltSpeed;
  const b = 2 * (dx * tvx + dy * tvy);
  const c = dx * dx + dy * dy;
  let leadT = 0;
  if (Math.abs(a) < 0.001) {
    leadT = (b !== 0) ? -c / b : 0;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const t1 = (-b - Math.sqrt(disc)) / (2 * a);
      const t2 = (-b + Math.sqrt(disc)) / (2 * a);
      leadT = (t1 > 0) ? t1 : (t2 > 0 ? t2 : 0);
    }
  }
  if (leadT <= 0) {
    // target faster than bolt — partial lead: aim where target is in bolt-travel-time to current distance
    const dist = Math.sqrt(dx * dx + dy * dy);
    const partialT = boltSpeed > 0 ? dist / boltSpeed : 0;
    return { x: tx + tvx * partialT, y: ty + tvy * partialT };
  }
  return { x: tx + tvx * leadT, y: ty + tvy * leadT };
}

// Highest corp home sector accessible by level (used on arena reconnect redirect)
function _bestHomeSector(corp, level) {
  const prefix = corp === 'neutral' ? 'helios' : corp;
  for (let n = 5; n >= 1; n--) {
    const key = `${prefix}_${n}`;
    if (SECTORS[key] && SECTORS[key].lvlMin <= level) return key;
  }
  return `${prefix}_1`;
}

// Fixed gate positions for PvP sectors — offsets [ox, oy] from world center (px).
// Computed for PVP_WORLD_SCALE=2.4: mx=9658, my=5296.
// Layout A: 2-left + 1-right │ B: top + 2-bottom │ C: left + 2-right │ D: NW + NE + S-center
const PVP_GATES = {
  pvp_1: {                                    // Layout A
    helios_2: [-9658, -2640],                 // left edge, upper third
    karax_2:  [-9658, +2640],                 // left edge, lower third
    tides_2:  [+9658,     0],                 // right edge, center
  },
  pvp_2: {                                    // Layout B
    helios_3: [    0, -5296],                 // top edge, center
    karax_3:  [-4640, +5296],                 // bottom edge, left
    tides_3:  [+4640, +5296],                 // bottom edge, right
  },
  pvp_3: {                                    // Layout D
    helios_4: [-9658, -5296],                 // NW corner
    karax_4:  [+9658, -5296],                 // NE corner
    tides_4:  [    0, +5296],                 // S-center
  },
  pvp_4: {                                    // Layout C
    helios_5: [-9658,     0],                 // left edge, center
    karax_5:  [+9658, -2640],                 // right edge, upper
    tides_5:  [+9658, +2640],                 // right edge, lower
  },
  pvp_5: {                                    // Layout D
    helios_5:   [-9658, -5296],               // NW corner
    karax_5:    [+9658, -5296],               // NE corner
    tides_5:    [    0, +5296],               // S-center
    'R-1-boss': [+9658,     0],               // right edge, center
  },
};

export default class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  create(data) {
    // Apply persisted player state on first session start (not on sector restarts)
    if (window.PLAYER_STATE) {
      this._applyLoadedState(window.PLAYER_STATE);
      window.PLAYER_STATE = null;
    }

    // TEST_PROFILE is only valid for unauthenticated DEV sessions; ignore for real users.
    const tp  = getToken() ? null : (window.TEST_PROFILE ?? null);
    let sec = SECTORS[galaxy.current];
    if (!sec) { galaxy.current = 'helios_1'; sec = SECTORS['helios_1']; }
    const isPvp        = sec.pvp      === true;
    const isDungeon    = sec.isDungeon === true;  // данжи + R-1-boss
    const isPersonal   = sec.personal  === true;  // shadow_arena
    // PvE-секторы (не данж, не PvP, не персональный) — +20% по каждой стороне
    const scale = isPvp ? PVP_WORLD_SCALE : (isDungeon || isPersonal) ? 1.0 : 1.2;

    const worldScale = galaxy.current === 'shadow_arena' ? 0.5 : galaxy.current === 'R-1-boss' ? 2.0 : scale;
    this.worldWidth = BASE_WORLD.width * worldScale;
    this.worldHeight = BASE_WORLD.height * worldScale;
    this.safeZoneRadius = BASE_WORLD.safeZoneRadius;
    this.objScale = 1.0;

    // Shadow battle — persist across sector restarts
    this._shadowBattleCfg  = this._shadowBattleCfg  ?? null;
    this._shadowPrevSector = this._shadowPrevSector ?? null;
    this._shadowBattleDone = false;
    this.botPilot = null;
    // Сброс базового режима при входе в персональный сектор
    if (galaxy.current === 'shadow_arena') {
      this.atBase  = false;
      this.jumping = false;
      this.pendingGate = null;
      this.steering = true;
    }

    // Камера БЕЗ границ (корабль всегда в центре). Физика ОСТАЁТСЯ в границах.
    this.physics.world.setBounds(0, 0, this.worldWidth, this.worldHeight);

    this.createBackground();
    this.createWorldBoundary();
    this.createBaseAndSafeZone();

    // Экипированные модули теперь глобальные (не привязаны к конкретному кораблю),
    // чтобы апгрейды сохранялись при смене судна.
    if (!this.equipped) {
      this.equipped = {
        weapon: [starterCannon(), ...Array(9).fill(null)],
        shield: [starterShield(), ...Array(9).fill(null)],
        engine: Array(10).fill(null)
      };
    }

    const cx = this.worldWidth / 2, cy = this.worldHeight / 2;
    let startX = data?.startX ?? cx;
    let startY = data?.startY ?? (cy - 40);
    if (galaxy.current === 'shadow_arena') { startX = Math.round(this.worldWidth * 0.2); startY = Math.round(cy); }
    if (this._reconnectPvpCorp) {
      const pos = this.homeBasePositions?.[this._reconnectPvpCorp];
      if (pos) { startX = pos.x; startY = pos.y + 80; }
      this._reconnectPvpCorp = null;
    }
    this.player = new Player(this, startX, startY, this.objScale);
    this.movement = new Movement(this, this.player);

    this.cameras.main.startFollow(this.player.sprite, false, 0.15, 0.15);
    this.cameras.main.setZoom(DPR);
    this.cameras.main.roundPixels = true;
    // Snap camera to spawn position immediately (prevents visible drift on restart)
    this.cameras.main.setScroll(startX - this.scale.width / (2 * DPR), startY - this.scale.height / (2 * DPR));

    this.reticle = this.add.graphics().setDepth(45);
    this.target = null;
    this.isFiring = false; 

    this.mobs = [];
    this.projectiles = [];
    this.loot = [];
    this.plasmateDeposits = [];
    this.inventory = this.inventory || [];
    if (tp?.lootPreset) applyLootPreset(this, tp.lootPreset);
    this.warehouse = this.warehouse ?? [];

    // Daily plasmate collection limit (persists across sector jumps via ??).
    const nowMs = Date.now();
    if (!this.plasmateDayReset || nowMs >= this.plasmateDayReset) {
      this.plasmateToday = 0;
      const tomorrow = new Date(); tomorrow.setHours(24, 0, 0, 0);
      this.plasmateDayReset = tomorrow.getTime();
    }
    this.atBase    = this.atBase    ?? false;
    this.premium   = this.premium   ?? (tp ? tp.premium : false);
    this.devMode   = DEV_MODE;
    this.credits  = this.credits  ?? (tp ? tp.credits  : DEV_MODE ? 3000000 : 0);
    this.starGold = this.starGold ?? (tp ? tp.starGold : DEV_MODE ? 20000   : 0);

    this.ownedShips     = this.ownedShips     || new Set(['wisp']);
    this.activeShip     = this.activeShip     || 'wisp';
    this.dungeonDifficulty  = this.dungeonDifficulty  ?? 'normal';
    this.boardInventory     = this.boardInventory ?? [];
    this.connectorInventory = this.connectorInventory ?? [];
    this.chips              = this.chips ?? 0;
    this.equippedBoard      = this.equippedBoard  ?? null;

    // TEST_PROFILE: apply ship override (must come after ownedShips/activeShip init)
    if (tp?.ship && SHIP_BY_KEY[tp.ship] && tp.ship !== 'argus') {
      this.ownedShips.add(tp.ship);
      this.activeShip = tp.ship;
    }
    // TEST_PROFILE: equip board of given tier if none equipped yet
    if (tp?.boardTier > 0 && !this.equippedBoard) {
      const tpBoard = rollBoard(tp.boardTier);
      this.boardInventory.push(tpBoard);
      this.equippedBoard = tpBoard;
    }

    if (DEV_MODE) {
      this.input.keyboard.on('keydown-EIGHT', () => {
        this.ownedShips.add('argus');
        this.activeShip = 'argus';
        const maxCannon = { type: 'cannon', tier: 4, damage: 210, penetration: 0.20, fireRate: 1.0, starLvl: 5 };
        const maxShield = { type: 'shield', tier: 4, durability: 1500, regen: 100, evasion: 0.10, starLvl: 5 };
        const maxArmor  = { type: 'armor',  tier: 4, hullBonus: 1350, starLvl: 5 };
        const maxEngine = { type: 'engine', tier: 4, speed: 27, starLvl: 5 };
        this.equipped.weapon = Array(10).fill(null).map(() => ({...maxCannon}));
        this.equipped.shield = [
          ...Array(6).fill(null).map(() => ({...maxShield})),
          ...Array(4).fill(null).map(() => ({...maxArmor})),
        ];
        this.equipped.engine = Array(6).fill(null).map(() => ({...maxEngine}));
        this.player.applyShip(SHIP_BY_KEY['argus']);
        this.player.hull = this.player.maxHull;
        this.player.shield = this.player.maxShield;
        this.argusCtrl.attachToPlayer(this.player);
        // DEV: add 2 boards of each tier + 20 random connectors
        this.boardInventory = this.boardInventory ?? [];
        this.connectorInventory = this.connectorInventory ?? [];
        for (let t = 1; t <= 3; t++) {
          this.boardInventory.push(rollBoard(t), rollBoard(t));
        }
        for (let i = 0; i < 20; i++) {
          const tier = Math.ceil(Math.random() * 3);
          this.connectorInventory.push(rollConnector(tier));
        }
        this.log('DEV: Argus + 6 плат + 20 коннекторов');
      });
      this.input.keyboard.on('keydown-NINE', () => {
        const laser = { type: 'laser', tier: 4, damage: 252, penetration: 0, fireRate: 1.0, starLvl: 5 };
        this.equipped.weapon = Array(10).fill(null).map(() => ({ ...laser }));
        this.player.recomputeStats();
        this.player.hull = this.player.maxHull;
        this.player.shield = this.player.maxShield;
        this.log('DEV: Laser Cannon Equipped');
      });
      this.input.keyboard.on('keydown-SEVEN', () => this._toggleTrainingDummies());
    }

    this.shipLevels = this.shipLevels || {};
    this.pilotXp    = this.pilotXp    || (tp ? xpForLevel(tp.level) : 1829100);
    this.pilotHonor = this.pilotHonor ?? (DEV_MODE ? 420500 : 0);
    this.pilotLevel = levelInfo(this.pilotXp).level;
    this.initMissionState();

    // Persist test-profile rank override across sector jumps (window.TEST_PROFILE is cleared after first create)
    if (tp?.rankOverride) this._testRankOverride = tp.rankOverride;

    if (this._testRankOverride) {
      // Test profile: fixed rank from the test profile window, stable until game restarts from login
      this.pilotRank = RANKS.find(r => r.name === this._testRankOverride) ?? this.pilotRank ?? RANKS[RANKS.length - 1];
    } else {
      // Real profile: recompute only when XP/honor actually changed, not on every sector jump
      const playerRating = calculateRating(this.pilotXp, this.pilotHonor);
      if (this.pilotRank == null || this._rankRating !== playerRating) {
        const ratings = MOCK_CORP_RATINGS.includes(playerRating)
          ? MOCK_CORP_RATINGS
          : [...MOCK_CORP_RATINGS, playerRating].sort((a, b) => b - a);
        this.pilotRank = getRank(playerRating, ratings);
        this._rankRating = playerRating;
      }
    }

    this.corpRep = this.corpRep ?? 1;
    this.seasonWon = this.seasonWon ?? true;
    this.garageTab = this.garageTab || 'ships';

    if (this.activeShip !== 'wisp' && SHIP_BY_KEY[this.activeShip]) {
      this.player.applyShip(SHIP_BY_KEY[this.activeShip]);
      this.player.hull = this.player.maxHull; this.player.shield = this.player.maxShield;
    }

    // Derive corp from active prestige ship first, then any owned prestige ship, else neutral.
    // This means Helios pilots build Helios bases regardless of which ship they fly now.
    this.playerCorp = this.playerCorp ||
      this.player?.ship?.corp ||
      Object.values(SHIP_BY_KEY).find(s => s.prestige && this.ownedShips.has(s.key))?.corp ||
      'neutral';
    if (tp?.corp) this.playerCorp = tp.corp;
    if (tp) window.TEST_PROFILE = null; // consume after first use
    this.corpSwitchCount = this.corpSwitchCount || 0;

    // Skill system (account-level, persistent across sector restarts)
    this.skillLevels = this.skillLevels || (tp?.skillLevels ?? {});
    this.actionBar   = this.actionBar   || Array(10).fill(null);
    this.respeckCount     = this.respeckCount     || 0;
    this.skillAchievementSP = this.skillAchievementSP || 0;

    // Ammo slots: N generic slots (any ammo or consumable), count = ship's aSlots
    const _aSlotCount = SHIP_BY_KEY[this.activeShip]?.aSlots || 3;
    const _rawAmmo = Array.isArray(this.ammoSlots) ? this.ammoSlots : [];
    // Normalize: keep type only when count > 0 (clears empty fixed-type entries from older save format)
    this.ammoSlots = _rawAmmo.map(s =>
      (s && typeof s === 'object') ? { type: (s.count > 0 ? s.type : null) || null, count: s.count || 0 } : { type: null, count: 0 }
    );
    while (this.ammoSlots.length < _aSlotCount) this.ammoSlots.push({ type: null, count: 0 });
    if (this.ammoSlots.length > _aSlotCount) {
      const excess = this.ammoSlots.splice(_aSlotCount);
      for (const s of excess) {
        if (s.type && s.count > 0) addConsumableToInventory(this.inventory, s.type, s.count, this._cargoMax());
      }
    }

    // autoAmmo board effect: auto-purchase ammo_plasma for occupied slots each sector entry
    if (this.player?.autoAmmo) {
      const _AMMO_PRICE_PER_UNIT = 10; // 10000 cr / 1000 units (matches ShopScene)
      for (const slot of this.ammoSlots) {
        if (slot.type !== 'ammo_plasma') continue;
        const need = (CONSUMABLES[slot.type]?.maxPerSlot ?? 10000) - slot.count;
        if (need <= 0) continue;
        const cost = need * _AMMO_PRICE_PER_UNIT;
        if ((this.credits || 0) < cost) continue;
        this.credits -= cost;
        slot.count += need;
      }
    }

    // autoConsumables skill: auto-purchase one pack of each buyable consumable if low
    if (this.player?.autoConsumables) {
      const _disc = this.player.shopDiscountMod ?? 1;
      const _cargoMax = this._cargoMax();
      for (const [type, def] of Object.entries(CONSUMABLES)) {
        if (!def.canBuy || def.category !== 'consumable') continue;
        const have = countConsumableInInventory(this.inventory, type);
        if (have >= 1000) continue;
        const price = Math.round(def.price * _disc);
        if ((this.credits || 0) < price) continue;
        this.credits -= price;
        addConsumableToInventory(this.inventory, type, 1000, _cargoMax);
      }
    }

    // Auto-insert ship active skill into action bar slot 0 on equip
    const _asDef = SHIP_BY_KEY[this.activeShip];
    if (_asDef?.activeSkill) {
      const _ask = _asDef.activeSkill.key;
      if (!this.actionBar[0] || (this.actionBar[0] + '').startsWith('ship:')) {
        this.actionBar[0] = _ask;
      }
    } else if ((this.actionBar[0] + '').startsWith('ship:')) {
      this.actionBar[0] = null;
    }
    // Clear argus abilities if not on argus ship
    if (this.activeShip !== 'argus') {
      this.actionBar = this.actionBar.map(k => (k + '').startsWith('argus:') ? null : k);
    }

    // Auto-fill empty action bar slots 1-9 with learned active skills
    const _ACTIVE_SKILL_ORDER = ['overcharge_shot', 'salvo', 'emergency_repair', 'shield_burst', 'stealth_sprint', 'berserker'];
    const _usedKeys = new Set(this.actionBar.filter(Boolean));
    for (const sk of _ACTIVE_SKILL_ORDER) {
      if ((this.skillLevels[sk] || 0) === 0) continue;
      if (_usedKeys.has(sk)) continue;
      const slot = this.actionBar.findIndex((v, i) => i > 0 && v === null);
      if (slot < 0) break;
      this.actionBar[slot] = sk;
      _usedKeys.add(sk);
    }

    // Active skill runtime state (reset per session)
    this.skillCooldowns    = {};
    this._consBuffEndTimes = {};   // key → timestamp when buff/effect expires
    this._overchargeActive = false;
    this._volleyBlastMult  = 0;
    this._berserkerBuff    = null;   // { endTime, mult } | null
    this._stealthEndTime  = 0;
    this._speedBoostMult  = 1.0;
    this._stealthMult     = 1.0;
    this._speedBoostTimer = null;
    this._scanPulseTimer   = null;

    this.playerName  = this.playerName  || getUsername();
    this.player.setNameplate(this.playerName, this.pilotRank, this.playerCorp, this.clan?.tag);
    this.miningBases = [];
    this.homeBases   = [];

    this.steering = false;
    this.collectTarget = null;
    this.collectTimer = 0;
    this.collectGfx = this.add.graphics().setDepth(58);
    // Ensure SettingsScene is registered — fallback for cases where main.js
    // registration was skipped (stale cache, module-load race, etc.)
    if (!this.sys.game.scene.scenes.some(s => s.sys?.settings?.key === 'SettingsScene')) {
      this.sys.game.scene.add('SettingsScene', SettingsScene, false);
    }

    const _cfg = loadSettings();
    this.magnetEnabled      = _cfg.autoLoot;
    this._autoTargetEnabled = _cfg.autoTarget;

    this.aoeZones = [];
    this.aoeGfx = this.add.graphics().setDepth(36);

    const trail = { lifespan: 180, speed: 0, scale: { start: 0.55, end: 0 }, alpha: { start: 0.5, end: 0 }, blendMode: 'ADD', emitting: false };
    this.trailCyan = this.add.particles(0, 0, 'glow', { ...trail, tint: 0x8fe6ff }).setDepth(59);
    this.trailRed = this.add.particles(0, 0, 'glow', { ...trail, tint: 0xff8a7a }).setDepth(59);

    this.createBoostFx();
    this.spawnMobs();

    // Restore floor loot for current sector
    if (!this._lootBySector) this._lootBySector = {};
    const _prevSec = this._prevSector;
    const _prevDef = _prevSec ? SECTORS[_prevSec] : null;
    // Leaving a dungeon — clear its loot (it's a one-time instance)
    if (_prevDef?.isDungeon && _prevSec !== galaxy.current) {
      delete this._lootBySector[_prevSec];
    }
    const floorLoot = this._lootBySector[galaxy.current] || [];
    floorLoot.forEach(l => this.loot.push(new Loot(this, l.x, l.y, l.item)));

    this.createJumpgates();
    this.createDungeonWalls();
    this.spawnPlasmateDeposits();
    this.spawnDungeonDeposits();
    this.setupInput();
    this.keyJ = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J);
    this.keyCtrl = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);

    this.playerRespawning = false;
    this.pendingGate = null;
    this.jumping = false;
    
    this.createSpaceDust();

    this.vfx = new VFXManager(this);
    this.engineFxList = [];
    this._engineFxShipKey = null;
    this._spawnEngineFx();

    // Argus boss controller — BroadcastChannel listener for admin.html commands
    this.argusCtrl?.destroy();
    this.argusCtrl = new ArgusController(this);
    // Restore quantum FX and action bar abilities if player is still on Argus ship
    if (this.activeShip === 'argus') this.argusCtrl.attachToPlayer(this.player);
    this._targetFx = null;

    // Admin game-state broadcast (same channel as ArgusController)
    this._adminCh = null;
    this._adminBroadcastT = 0;
    try { this._adminCh = new BroadcastChannel('stellar-drift-admin'); } catch (_) {}
    this._adminBroadcastGameState();

    this.time.delayedCall(60, () => this.log(i18n.t('log.entered', { sector: SECTORS[galaxy.current].name })));
    // Auto-select bot target (vfx not ready during spawnMobs, defer one tick)
    if (this.botPilot) this.time.delayedCall(16, () => { if (this.botPilot?.alive) this.selectTarget(this.botPilot); });

    // All secondary assets (perks, module icons, NPC portraits, UI backgrounds) are now
    // loaded in BootScene.preload() so _bgPreloadDeferred is no longer needed.

    // Fade out the #scene-overlay shown by _doRestart() before scene.restart().
    // The overlay is a fixed HTML element that survives Phaser scene lifecycle,
    // so it hides the synchronous create() processing time on every sector transition.
    this.time.delayedCall(1, () => {
      document.getElementById('scene-overlay')?.classList.remove('active');
    });
  }

  _bgPreloadDeferred() {
    if (this._bgDeferredDone) return;
    this._bgDeferredDone = true;
    // UI backgrounds (non-login)
    for (const [key, file] of [
      ['bg_garage',      'garage.png'],
      ['bg_missions',    'missions.png'],
      ['bg_shop',        'shop.png'],
      ['bg_corp_helios', 'Corp_Hub_Helios.png'],
      ['bg_corp_karaks', 'Corp_Hub_Karaks.png'],
      ['bg_corp_tides',  'Corp_Hub_Tides.png'],
    ]) {
      if (!this.textures.exists(key))
        this.load.image(key, `assets/UI BACKGROUNDS/${file}`);
    }
    // Module icons
    for (const [key, file] of Object.entries(MOD_ICON_FILES)) {
      if (!this.textures.exists(key))
        this.load.image(key, `assets/modules/${encodeURIComponent(file)}`);
    }
    // Ammo icons
    for (const type of ['ammo_plasma', 'ammo_plasma_elite', 'ammo_laser']) {
      if (!this.textures.exists(type))
        this.load.image(type, `assets/ammo/${type}.png`);
    }
    // Perk images
    for (const p of PERK_DEFS) {
      if (!this.textures.exists(p.key))
        this.load.image(p.key, `assets/perks/${p.imgFile}`);
    }
    // NPC portraits
    for (const [key, file] of NPC_PORTRAITS) {
      if (!this.textures.exists(key))
        this.load.image(key, `assets/npc/${file}`);
    }
    this.load.once('complete', () => {
      // Process one job per idle slice — requestIdleCallback fires AFTER Phaser renders,
      // so canvas ops never eat into the frame budget and cause stutter.
      const jobs = [
        ...Object.keys(MOD_ICON_FILES).map(key => () => prepShipTex(this, key, 96)),
        ...['ammo_plasma', 'ammo_plasma_elite', 'ammo_laser'].map(t => () => prepShipTex(this, t, 230)),
        ...PERK_DEFS.flatMap(p => [() => prepShipTex(this, p.key, 384), () => removeWhiteBg(this, p.key)]),
        ...NPC_PORTRAITS.map(([key]) => () => prepShipTex(this, key, 432)),
      ];
      let i = 0;
      const scheduleNext = () => {
        if (i >= jobs.length) return;
        if (typeof requestIdleCallback === 'function') {
          // One job per idle callback — each job may take 5-15 ms, so batching
          // causes dropped frames even with timeRemaining() checks.
          requestIdleCallback(() => { jobs[i++](); scheduleNext(); }, { timeout: 400 });
        } else {
          requestAnimationFrame(() => { jobs[i++](); scheduleNext(); });
        }
      };
      scheduleNext();
    });
    this.load.start();
  }

  createSpaceDust() {
    const cx = this.scale.width / (2 * DPR);
    const cy = this.scale.height / (2 * DPR);
    this.dust = this.add.particles(cx, cy, 'glow', {
      emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(-1500, -1200, 3000, 2400) },
      lifespan: 800,
      scaleX: 18.0, 
      scaleY: 0.05,
      alpha: 0.6,
      tint: 0xffffff,
      blendMode: 'ADD',
      frequency: 1,
      emitting: false,
      speedX: 0,
      speedY: 0,
      particleRotate: 0
    }).setDepth(-10).setScrollFactor(0);
  }

  createBackground() {
    const w = this.scale.width, h = this.scale.height;
    this.bgNear = this.add.tileSprite(w / 2, h / 2, w * 2, h * 2, 'stars_near')
      .setOrigin(0.5).setScrollFactor(0).setDepth(-19).setAlpha(0.32);
    this.scale.on('resize', (gs) => {
      this.bgNear.setPosition(gs.width / 2, gs.height / 2).setSize(gs.width * 2, gs.height * 2);
      if (this.dust) this.dust.setPosition(gs.width / (2 * DPR), gs.height / (2 * DPR));
    });
  }

  createWorldBoundary() {
    const w = this.worldWidth, h = this.worldHeight;
    const cx = w / 2, cy = h / 2;
    
    // Вместо черных блоков создаем мягкую виньетку.
    // Она дает понять, где центр и границы, но не обрывает вид звезд.
    const g = this.add.graphics().setDepth(-18);
    
    // Рисуем очень большое радиальное затенение к краям
    // Центр прозрачный, края уходят в глубокий сине-черный
    const radius = Math.max(w, h) * 0.8;
    
    // В Phaser 4 (Graphics) мы имитируем градиент через несколько кругов с разной альфой
    // для максимальной производительности без шейдеров.
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const r = radius * (1 + i * 0.2);
      const alpha = (i / steps) * 0.7;
      g.lineStyle(radius * 0.3, 0x050a10, alpha);
      g.strokeCircle(cx, cy, r);
    }

    // Тонкая ограничительная линия (опционально, для стиля)
    g.lineStyle(2, 0x4dd0e1, 0.05);
    g.strokeRect(0, 0, w, h);
  }

  spawnPlasmateDeposits() {
    const sec = SECTORS[galaxy.current];
    if (sec.isDungeon || sec.personal) return;
    const isPvp = sec.pvp === true;
    const lvl = sec.lvlMin || 1;
    const tier = Math.min(4, Math.floor(lvl / 10));

    // [ countMin, countMax, amountMin, amountMax, respawnMin (ms) ]
    const HOME_TIERS = [
      [15, 25, 1, 1, 10 * 60000],
      [15, 25, 1, 2, 10 * 60000],
      [15, 25, 2, 3, 10 * 60000],
      [15, 25, 2, 4, 10 * 60000],
      [15, 25, 3, 5, 10 * 60000],
    ];
    const PVP_TIERS = [
      [ 70,  90, 1, 2, 12 * 60000],
      [ 80, 100, 2, 4, 12 * 60000],
      [ 90, 110, 3, 6, 12 * 60000],
      [100, 120, 4, 7, 14 * 60000],
      [100, 120, 5, 8, 16 * 60000],
    ];
    const [cMin, cMax, aMin, aMax, respawnMs] = isPvp ? PVP_TIERS[tier] : HOME_TIERS[tier];
    const count = Phaser.Math.Between(cMin, cMax);

    const ww = this.worldWidth, wh = this.worldHeight;
    const zone = { xMin: 200, xMax: ww - 200, yMin: 200, yMax: wh - 200 };
    for (let i = 0; i < count; i++) {
      let x, y, tries = 0;
      do {
        x = Phaser.Math.Between(200, ww - 200);
        y = Phaser.Math.Between(200, wh - 200);
        tries++;
      } while (tries < 30 &&
        isPvp && this.miningBases.some(b => Phaser.Math.Distance.Between(x, y, b.x, b.y) < 600)
      );
      const amount = Phaser.Math.Between(aMin, aMax);
      this.plasmateDeposits.push(new PlasmateDeposit(this, x, y, amount, zone, respawnMs));
    }
  }

  _collectDungeonResource(deposit) {
    const whMax = 8 + ([0,3,8,16][this.skillLevels?.cargo_expand||0]||0) + (this.premium ? 8 : 0);
    this.warehouse = this.warehouse || [];
    const leftover = addConsumableToInventory(this.warehouse, deposit.resourceType, deposit.amount, whMax);
    const collected = deposit.amount - leftover;
    if (collected <= 0) {
      this.log(`⛏ Склад полон (${RESOURCE_NAMES[deposit.resourceType] || deposit.resourceType})`);
      return;
    }
    this.log(`⛏ +${collected} ${RESOURCE_NAMES[deposit.resourceType] || deposit.resourceType} → склад`);
    deposit.collect();
  }

  _collectPlasmateDeposit(deposit) {
    if (deposit.isDungeonResource) { this._collectDungeonResource(deposit); return; }
    // Daily limit check
    if ((this.plasmateToday || 0) >= PLASMATE_DAILY_MAX) {
      this.log(i18n.t('log.plasmate_limit'));
      return;
    }
    const canCollect = PLASMATE_DAILY_MAX - (this.plasmateToday || 0);
    const toCollect  = Math.min(deposit.amount, canCollect);

    // Cargo capacity
    const maxSlots = this._cargoMax();
    const leftover = addPlasmateToInventory(this.inventory, toCollect, maxSlots);
    const collected = toCollect - leftover;

    if (collected <= 0) {
      this.log(i18n.t('log.plasmate_cargo_full'));
      return;
    }
    this.plasmateToday = (this.plasmateToday || 0) + collected;
    this.advanceMission('story_supply', 0, collected);
    this.log(i18n.t('log.plasmate_collected', {
      amount: collected,
      total:  this.plasmateToday,
      max:    PLASMATE_DAILY_MAX,
    }));
    deposit.collect();

    if (leftover > 0) this.log(i18n.t('log.plasmate_cargo_full'));
    if (this.plasmateToday >= PLASMATE_DAILY_MAX) this.log(i18n.t('log.plasmate_limit'));
  }

  _cargoMax() {
    const sl = (this.skillLevels?.cargo_expand || 0);
    const drover = this.activeShip === 'drover' ? 4 : 0;
    const prem   = this.premium ? 8 : 0;
    const base   = 8 + drover + ([0,3,8,16][sl]||0) + prem;
    return Math.round(base * (1 + (this.player?.cargoBonusMod ?? 0)));
  }

  createBaseAndSafeZone() {
    const sec = SECTORS[galaxy.current];
    if (sec.isDungeon) return; // В данжах нет безопасных зон
    if (sec.pvp) return; // В PvP секторах нет центральной базы
    if (sec.personal) return; // В персональных секторах нет базы

    const cx = this.worldWidth / 2, cy = this.worldHeight / 2;
    this.safeZoneGfx = this.add.graphics().setDepth(-10);
    this.safeZoneGfx.lineStyle(2, COLORS.safezone, 0.35);
    this.safeZoneGfx.strokeCircle(cx, cy, this.safeZoneRadius);
    this.safeZoneGfx.fillStyle(COLORS.safezone, 0.04);
    this.safeZoneGfx.fillCircle(cx, cy, this.safeZoneRadius);
    const base = this.add.graphics().setDepth(-9);
    base.fillStyle(COLORS.primary, 0.18); base.fillCircle(cx, cy, 70);
    base.lineStyle(3, COLORS.primary, 0.8); base.strokeCircle(cx, cy, 70);
    base.lineStyle(2, COLORS.amber, 0.7); base.strokeCircle(cx, cy, 44);
    this.add.text(cx, cy, '⌬', { fontFamily: 'Orbitron', fontSize: '48px', color: '#4dd0e1', resolution: UI_RES }).setOrigin(0.5).setDepth(-8);
  }

  spawnMobs() {
    // Clean up any previous base visuals (scene restart)
    this.confedGuards?.destroy();
    this.confedGuards = null;
    for (const b of this.miningBases) b.destroy();
    this.miningBases = [];
    for (const b of this.homeBases) b.destroy();
    this.homeBases = [];

    // Shadow arena — no mobs, no bases, only BotPilot
    if (galaxy.current === 'shadow_arena') { this._initBotPilot(); return; }

    this._spawnHomeBase();

    const sec = SECTORS[galaxy.current];
    const cx = this.worldWidth / 2, cy = this.worldHeight / 2, M = MOBS;
    const Lmin = sec.lvlMin, Lmax = Math.min(50, sec.lvlMax);
    const rnd = (a, b) => Phaser.Math.Between(a, b);
    let pool, boss;
    const _diff = sec.isDungeon ? this._dungeonDiff() : null;
    const add = (k, lvl, ox, oy, opts) => {
      const finalOpts = _diff ? { hpMult: _diff.mobHP, dmgMult: _diff.mobDamage, ...opts } : opts;
      const m = new Mob(this, M[k], lvl, cx + ox, cy + oy, finalOpts);
      this.mobs.push(m);
      return m;
    };

    if (sec.pvp) {
      // PvP-карты: Частная Безопасность охраняет добывающие базы.
      const pvpLvl = parseInt(galaxy.current.split('_')[1]);
      let basePoints = [];
      
      // Конфигурация количества баз согласно ТЗ:
      // PvP-1: 2 базы, PvP-2: 3, PvP-3: 3, PvP-4: 4, PvP-5: 4
      if (pvpLvl === 1) {
        basePoints = [[-1200, -960], [1200, 960]]; // 2 базы по диагонали
      } else if (pvpLvl === 2 || pvpLvl === 3) {
        basePoints = [[-1680, -1200], [0, 0], [1680, 1200]]; // 3 базы в ряд по диагонали
      } else {
        // 4 базы квадратом
        const d = 1800;
        basePoints = [[-d, -d], [d, -d], [d, d], [-d, d]];
      }

      const miningBases = basePoints.map((p, idx) => {
        const base = new MiningBase(this, cx + p[0], cy + p[1], {
          id: `${galaxy.current}_base_${idx}`,
          pvpTier: pvpLvl,
        });
        this.miningBases.push(base);
        return base;
      });

      const baseTargets = miningBases.map(b => ({ x: b.x, y: b.y }));

      if (pvpLvl === 1) {
        // PvP 1: 3 дрона курсируют между базами (стаей)
        const leader = add('sec_drone', Lmax, rnd(-1800, 1800), rnd(-1200, 1200), { behavior: 'roam', targets: baseTargets });
        for (let i = 0; i < 2; i++) {
          add('sec_drone', Lmax, leader.spawnX - cx + rnd(-100, 100), leader.spawnY - cy + rnd(-100, 100), { leader, orbitLeader: true });
        }
      } else {
        // PvP 2-5: Эсминцы + Дроны
        const compositions = {
          2: { destroyers: 2, dronesPerDest: 2 },
          3: { destroyers: 2, dronesPerDest: 3 },
          4: { destroyers: 3, dronesPerDest: 3 },
          5: { destroyers: 4, dronesPerDest: 4 }
        };
        const config = compositions[pvpLvl] || compositions[2];

        for (let i = 0; i < config.destroyers; i++) {
          const b = miningBases[i % miningBases.length];
          // Эсминцы курсируют между базами с отклонением от прямой линии
          const dest = add('sec_destroyer', Lmax, b.x - cx + rnd(-200, 200), b.y - cy + rnd(-200, 200), { behavior: 'roam', targets: baseTargets, pathDeviation: 200 });
          dest.isConfedBoss = true;
          for (let j = 0; j < config.dronesPerDest; j++) {
            add('sec_drone', Lmax, dest.spawnX - cx + rnd(-100, 100), dest.spawnY - cy + rnd(-100, 100), { leader: dest, orbitLeader: true });
          }
        }
      }

      // Охранники нейтральных баз — спавн по таймеру, уходят когда все базы захвачены
      this._checkGuardReset();
      this.confedGuards = new ConfedGuardSystem(this, Lmax);
      return;
    }

    if (galaxy.current === 'R-1-boss') {
      // Специальный спавн для босс-уровня Алгол: Зов Апофиса (все мобы ×3)
      const apophis = add('apophis', 50, 0, 0, { behavior: 'guard', patrolRadius: 100, leash: Infinity, hpMult: 3, dmgMult: 6 });
      apophis.isDungeonBoss = true;
      apophis.sprite.setAlpha(0.92);
      this._apophisBoss = apophis;
      this._apophisRingsEnraged = false;
      this._apophisPhase2Started = false;
      this._apophisRings = this._createApophisRings(cx, cy);
      // Пульс тела: медленное дыхание
      const sx = apophis.sprite.scaleX, sy = apophis.sprite.scaleY;
      this._apophisPulseTween = this.tweens.add({
        targets: apophis.sprite,
        scaleX: sx * 1.12, scaleY: sy * 1.12,
        duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      const ringPts = [[1440, 1440], [-1440, 1440], [1440, -1440], [-1440, -1440]];
      ringPts.forEach(o => {
        const g = add('ancient_06', 50, o[0], o[1], { behavior: 'guard', patrolRadius: 600, bossRef: apophis, hpMult: 3, dmgMult: 6 });
        g.isBossEscort = true;
      });
      return;
    }

    // Home sectors (lvlMin 1) — мобы пассивны, не атакуют первыми
    const isHomeSector = sec.lvlMin === 1 && !sec.isDungeon && !sec.pvp;

    if (galaxy.current === 'dungeon_1') {
      pool = ['swarm_01', 'swarm_02', 'swarm_03', 'swarm_04', 'swarm_05']; boss = 'swarm_09';
    } else if (galaxy.current === 'dungeon_2') {
      pool = ['corsair_01', 'corsair_02', 'corsair_04', 'corsair_03', 'corsair_05']; boss = 'corsair_09';
    } else if (galaxy.current === 'dungeon_3') {
      pool = ['syndicate_01', 'syndicate_02', 'syndicate_03', 'syndicate_04', 'syndicate_05']; boss = 'syndicate_11';
    } else if (galaxy.current === 'dungeon_4') {
      pool = ['ancient_01', 'ancient_02', 'ancient_03', 'ancient_07', 'ancient_08']; boss = 'ancient_06';
    } else if (galaxy.current === 'dungeon_5') {
      pool = ['ancient_09', 'ancient_10', 'ancient_11', 'ancient_08', 'ancient_07'];
      boss = 'ancient_06';
    } else if (galaxy.current === 'dungeon_prem') {
      pool = ['ancient_09', 'ancient_10', 'ancient_11', 'ancient_08']; boss = 'ancient_06';
    } else if (galaxy.current === 'helios_5') {
      // Бастион Конфедерации — дезертиры и элита
      pool = ['confed_01', 'confed_02', 'confed_06', 'syndicate_05', 'confed_01'];
      boss = 'confed_09';
    } else if (Lmax <= 20) {
      pool = ['swarm_01', 'swarm_02', 'swarm_03', 'swarm_04', 'swarm_05', 'swarm_06', 'swarm_07']; boss = 'swarm_09';
    } else if (Lmax <= 30) {
      // Корсары — люди-пираты, мид-ранний
      pool = ['corsair_01', 'corsair_02', 'corsair_03', 'corsair_04', 'corsair_05', 'corsair_06']; boss = 'corsair_09';
    } else if (Lmax <= 45) {
      // Синдикат + Безопасность
      pool = ['syndicate_01', 'syndicate_02', 'syndicate_04', 'syndicate_07', 'syndicate_08', 'syndicate_03'];
      boss = 'syndicate_11';
    } else {
      pool = ['ancient_07', 'ancient_08', 'ancient_09', 'ancient_10', 'ancient_11']; boss = 'ancient_06';
    }
    
    if (galaxy.current === 'dungeon_1') {
      // D1: Рой в крестообразных коридорах; мини-боссы на E/W; босс + охрана за северной дверью
      add('swarm_01', rnd(Lmin, Lmax), 0, -900, { patrolRadius: 350 });
      add('swarm_02', rnd(Lmin, Lmax), 1500, 0, {});
      add('swarm_03', rnd(Lmin, Lmax), -1500, 0, {});
      add('swarm_02', rnd(Lmin, Lmax), 0, 1200, { patrolRadius: 400 });
      add('swarm_04', rnd(Lmin, Lmax), 2000, 0, {});
      add('swarm_01', rnd(Lmin, Lmax), -2000, 0, {});
      add('swarm_03', rnd(Lmin, Lmax), 0, -500, { patrolRadius: 300 });
      add('swarm_05', rnd(Lmin, Lmax), 100, 700, {});    // S-рукав (был внутри SE-блока)
      add('swarm_04', rnd(Lmin, Lmax), -100, 700, {});   // S-рукав (был внутри SW-блока)
      // левый борт (x≈958, за NW/SW блоком)
      add('swarm_02', rnd(Lmin, Lmax), -3200, -600, { patrolRadius: 400 });
      add('swarm_04', rnd(Lmin, Lmax), -3200, 800, {});
      // правый борт (x≈7358, за NE/SE блоком)
      add('swarm_01', rnd(Lmin, Lmax), 3200, -600, { patrolRadius: 400 });
      add('swarm_03', rnd(Lmin, Lmax), 3200, 800, {});
      add('swarm_07', Lmax, 2200, 0, { behavior: 'guard', patrolRadius: 250, leash: 600 });
      add('swarm_07', Lmax, -2200, 0, { behavior: 'guard', patrolRadius: 250, leash: 600 });
      const d1boss = add('swarm_09', Lmax, 0, -2200, { behavior: 'guard', patrolRadius: 180, leash: 450 });
      d1boss.isDungeonBoss = true;
      // охрана босса ×4 (в боссовой комнате — не открывают дверь)
      const d1e1 = add('swarm_07', Lmax, -250, -2000, { behavior: 'guard', patrolRadius: 150, leash: 500 });
      d1e1.isBossEscort = true;
      const d1e2 = add('swarm_07', Lmax,  250, -2000, { behavior: 'guard', patrolRadius: 150, leash: 500 });
      d1e2.isBossEscort = true;
      const d1e3 = add('swarm_07', Lmax, -250, -2150, { behavior: 'guard', patrolRadius: 150, leash: 500 });
      d1e3.isBossEscort = true;
      const d1e4 = add('swarm_07', Lmax,  250, -2150, { behavior: 'guard', patrolRadius: 150, leash: 500 });
      d1e4.isBossEscort = true;
      // разведчики (одиночки) и патрули (пары) в незанятых коридорах
      add('swarm_01', rnd(Lmin, Lmax),    0, 1900, { patrolRadius: 250 });     // S-рукав: разведчик (глубокий юг)
      add('swarm_03', rnd(Lmin, Lmax),  150, 1500, { patrolRadius: 200 });     // S-рукав: патруль (пара)
      add('swarm_02', rnd(Lmin, Lmax), -150, 1500, { patrolRadius: 200 });
      add('swarm_04', rnd(Lmin, Lmax), 1800,  250, { patrolRadius: 250 });     // E-рукав: патруль (пара)
      add('swarm_02', rnd(Lmin, Lmax), 1800, -250, { patrolRadius: 250 });
      add('swarm_01', rnd(Lmin, Lmax), -1800,  250, { patrolRadius: 250 });    // W-рукав: патруль (пара)
      add('swarm_03', rnd(Lmin, Lmax), -1800, -250, { patrolRadius: 250 });

    } else if (galaxy.current === 'dungeon_2') {
      // D2: Корсары по Z-маршруту; ресурсы в тупиках; охрана босса в сев-вост комнате
      add('corsair_01', rnd(Lmin, Lmax), -1800, 1000, {});
      add('corsair_03', rnd(Lmin, Lmax), 0, 1200, {});
      add('corsair_02', rnd(Lmin, Lmax), 0, 0, {});
      add('corsair_05', rnd(Lmin, Lmax), -800, -300, {});
      add('corsair_04', rnd(Lmin, Lmax), 1500, 0, {});
      add('corsair_03', rnd(Lmin, Lmax), -1200, 1400, {});
      add('corsair_01', rnd(Lmin, Lmax), 1800, 800, {});
      add('corsair_04', rnd(Lmin, Lmax), -700, -1300, {});
      add('corsair_02', rnd(Lmin, Lmax), 800, -1200, {});
      add('corsair_08', Lmax, 1900, 1100, { behavior: 'guard', patrolRadius: 200, leash: 550 });
      add('corsair_08', Lmax, -1900, -450, { behavior: 'guard', patrolRadius: 200, leash: 550 });
      add('corsair_05', Lmax,  2200,  1000, { behavior: 'guard', patrolRadius: 200, leash: 500 }); // охрана SE-депо
      // правый тупик (x≈7747, y≈3564): депо + патруль + охрана
      add('corsair_06', rnd(Lmin, Lmax), 3589, -1000, { patrolRadius: 300 }); // патруль
      add('corsair_04', rnd(Lmin, Lmax), 3589, -1400, { patrolRadius: 300 });
      add('corsair_08', Lmax, 3400, -1224, { behavior: 'guard', patrolRadius: 180, leash: 500 }); // охрана депо
      // левый тупик (x≈707, y≈3327): депо + патруль + охрана
      add('corsair_03', rnd(Lmin, Lmax), -3451, -700,  { patrolRadius: 300 }); // патруль
      add('corsair_01', rnd(Lmin, Lmax), -3451, -1100, { patrolRadius: 300 });
      add('corsair_07', Lmax, -3200, -987, { behavior: 'guard', patrolRadius: 180, leash: 500 }); // охрана депо
      const d2boss = add('corsair_09', Lmax, 1800, -1800, { behavior: 'guard', patrolRadius: 180, leash: 480 });
      d2boss.isDungeonBoss = true;
      // охрана босса ×4
      const d2e1 = add('corsair_08', Lmax, 1500, -1800, { behavior: 'guard', patrolRadius: 150, leash: 500 });
      d2e1.isBossEscort = true;
      const d2e2 = add('corsair_08', Lmax, 2100, -1800, { behavior: 'guard', patrolRadius: 150, leash: 500 });
      d2e2.isBossEscort = true;
      const d2e3 = add('corsair_08', Lmax, 1500, -1600, { behavior: 'guard', patrolRadius: 150, leash: 500 });
      d2e3.isBossEscort = true;
      const d2e4 = add('corsair_08', Lmax, 2100, -1600, { behavior: 'guard', patrolRadius: 150, leash: 500 });
      d2e4.isBossEscort = true;
      // разведчики и патрули в основных зонах
      add('corsair_02', rnd(Lmin, Lmax), -2100, 1800, { patrolRadius: 350 });
      add('corsair_04', rnd(Lmin, Lmax),  2100, 1800, { patrolRadius: 350 });
      add('corsair_01', rnd(Lmin, Lmax),  2100, -500, { patrolRadius: 300 });
      add('corsair_03', rnd(Lmin, Lmax),  2100, -200, { patrolRadius: 300 });
      add('corsair_02', rnd(Lmin, Lmax), -1800, -900,  { patrolRadius: 250 });
      add('corsair_04', rnd(Lmin, Lmax), -1800, -1100, { patrolRadius: 250 });

    } else if (galaxy.current === 'dungeon_3') {
      // D3: Синдикат в военной сетке; мини-боссы на постах; охрана босса в верхне-правой комнате
      add('syndicate_01', rnd(Lmin, Lmax), -1650, -1000, {});
      add('syndicate_02', rnd(Lmin, Lmax), 0, -1000, {});
      add('syndicate_03', rnd(Lmin, Lmax), -1650, 900, {});
      add('syndicate_04', rnd(Lmin, Lmax), 0, 900, {});
      add('syndicate_05', rnd(Lmin, Lmax), 1200, 500, {});
      add('syndicate_01', rnd(Lmin, Lmax), 1650, 500, {});
      add('syndicate_02', rnd(Lmin, Lmax), -1650, 0, {});
      add('syndicate_04', rnd(Lmin, Lmax), 0, 0, {});
      add('syndicate_07', Lmax, -1650, -300, { behavior: 'guard', patrolRadius: 200, leash: 500 });
      add('syndicate_07', Lmax, 0, -300, { behavior: 'guard', patrolRadius: 200, leash: 500 });
      const d3boss = add('syndicate_11', Lmax, 1650, -1800, { behavior: 'guard', patrolRadius: 180, leash: 420 });
      d3boss.isDungeonBoss = true;
      // охрана босса
      const d3e1 = add('syndicate_07', Lmax, 1300, -1800, { behavior: 'guard', patrolRadius: 150, leash: 480 });
      d3e1.isBossEscort = true;
      const d3e2 = add('syndicate_07', Lmax, 2000, -1800, { behavior: 'guard', patrolRadius: 150, leash: 480 });
      d3e2.isBossEscort = true;

    } else if (galaxy.current === 'dungeon_4') {
      // D4: Древние среди обломков; мини-боссы у кластеров; охрана босса в юго-вост углу
      const d4pts = [[500,-900], [-700,-600], [1200,200], [-900,600], [400,1000], [-500,-1200], [700,-1500], [-1200,900]];
      d4pts.forEach(([ox, oy], i) => add(pool[i % pool.length], rnd(Lmin, Lmax), ox, oy, {}));
      add('ancient_05', Lmax, 1200, -1200, { behavior: 'guard', patrolRadius: 280, leash: 650 });
      add('ancient_05', Lmax, -900, 900, { behavior: 'guard', patrolRadius: 280, leash: 650 });
      add('ancient_03', Lmax, 1400, 900, { behavior: 'guard', patrolRadius: 250, leash: 600 });
      const d4boss = add('ancient_06', Lmax, 2200, 1600, { behavior: 'guard', patrolRadius: 180, leash: 420 });
      d4boss.isDungeonBoss = true;
      // охрана босса
      const d4e1 = add('ancient_03', Lmax, 1900, 1600, { behavior: 'guard', patrolRadius: 150, leash: 480 });
      d4e1.isBossEscort = true;
      const d4e2 = add('ancient_05', Lmax, 2200, 1300, { behavior: 'guard', patrolRadius: 150, leash: 480 });
      d4e2.isBossEscort = true;

    } else if (galaxy.current === 'dungeon_5') {
      // D5: три кольца обороны; босс в центральной арене (за северной дверью); охрана в арене
      const pts = [[960,960], [-960,960], [960,-960], [-960,-960], [0,1800], [0,-1800], [2160,0], [-2160,0], [1500,1500], [-1500,-1500]];
      pts.forEach((o, i) => add(pool[i % pool.length], rnd(Lmin, Lmax), o[0], o[1], { patrolRadius: 400 }));
      const dungeon5boss = add(boss, Lmax, 0, 0, { behavior: 'guard', patrolRadius: 300, leash: 900 });
      dungeon5boss.isDungeonBoss = true;
      // охрана в арене (не считаются для открытия двери)
      const d5e1 = add('ancient_09', Lmax, -300, 200, { behavior: 'guard', patrolRadius: 150, leash: 600 });
      d5e1.isBossEscort = true;
      const d5e2 = add('ancient_11', Lmax, 300, 200, { behavior: 'guard', patrolRadius: 150, leash: 600 });
      d5e2.isBossEscort = true;

    } else if (galaxy.current === 'dungeon_prem') {
      // Лабиринт Тьмы — только Древние; мини-боссы в тупиках; охрана босса за юго-вост дверью
      const tdpts = [[-1800,-1300], [600,-1200], [-400,-500], [1200,-500], [-800,300], [1600,900], [-2000,100], [400,200]];
      tdpts.forEach(([ox, oy], i) => add(pool[i % pool.length], rnd(Lmin, Lmax), ox, oy, {}));
      add('ancient_05', Lmax, 0, -1800, { behavior: 'guard', patrolRadius: 250, leash: 580 });
      add('ancient_05', Lmax, -1800, 200, { behavior: 'guard', patrolRadius: 250, leash: 580 });
      add('ancient_03', Lmax, 800, 1400, { behavior: 'guard', patrolRadius: 250, leash: 580 });
      add('ancient_05', Lmax, -800, 1600, { behavior: 'guard', patrolRadius: 250, leash: 580 });
      const tdboss = add('ancient_06', Lmax, 2300, 1900, { behavior: 'guard', patrolRadius: 180, leash: 420 });
      tdboss.isDungeonBoss = true;
      // охрана босса
      const tde1 = add('ancient_08', Lmax, 2000, 1900, { behavior: 'guard', patrolRadius: 150, leash: 480 });
      tde1.isBossEscort = true;
      const tde2 = add('ancient_10', Lmax, 2300, 1600, { behavior: 'guard', patrolRadius: 150, leash: 480 });
      tde2.isBossEscort = true;

    }

    if (sec.isDungeon) this._spawnDifficultyReinforcements(pool, cx, cy, Lmin, Lmax);

    // Назначаем ID и помечаем призраками боссов + охрану в данже для не-лидеров группы.
    this._nextGroupMobId = 0;
    const _grpForGhost = this.groupSystem;
    const _isMember = sec.isDungeon && _grpForGhost?.inGroup && !_grpForGhost.isLeader;
    for (const _m of this.mobs) {
      if (_m.isDungeonBoss || _m.isBossEscort) {
        _m._groupMobId = this._nextGroupMobId++;
        if (_isMember) _m.ghostBoss = true;
      }
    }

    if (!sec.isDungeon && galaxy.current !== 'R-1-boss') {
      const ring = [[1200, -360], [-1320, 480], [480, 1260], [-1020, -840], [1800, 624], [-1800, -180]];
      ring.forEach((o, i) => add(pool[i % pool.length], rnd(Lmin, Lmax), o[0], o[1], isHomeSector ? { passive: true } : {}));
      const gx = 1800, gy = 1140;
      const sectorBoss = add(boss, Lmax, gx, gy, { behavior: 'guard', patrolRadius: 180, leash: 480 });
      sectorBoss.isSectorBoss = true;
      if (galaxy.current === 'helios_5') sectorBoss.isConfedBoss = true;
      for (const [ox, oy] of [[-240, -130], [250, -90], [-110, 250]]) {
        add(pool[0], rnd(Lmin, Lmax), gx + ox, gy + oy, { patrolRadius: 150, leash: 520, bossRef: sectorBoss, ...(isHomeSector ? { passive: true } : {}) });
      }
    }
  }

  get groupSystem() { return this.scene.get('HudScene')?.groupSystem ?? null; }

  _dungeonDiff() {
    return DUNGEON_DIFF[this.dungeonDifficulty ?? 'normal'];
  }

  _spawnDifficultyReinforcements(pool, cx, cy, Lmin, Lmax) {
    const diff = this._dungeonDiff();
    if (diff.mobCount <= 1.0) return;

    // Предопределённые патрульные зоны для каждого данжа (offset от центра мира)
    const ZONES = {
      dungeon_1: [[0,-500],[1800,0],[-1800,0],[0,1500],[2800,400],[-2800,-400],[0,-1200],[1200,-800],[-1200,800]],
      dungeon_2: [[0,800],[-1000,200],[1000,-500],[-2200,600],[2200,400],[-600,-800],[600,800],[-1500,500],[1500,-900]],
      dungeon_3: [[1650,-500],[-1650,-500],[0,-500],[1650,400],[-1650,400],[0,400],[800,-1000],[-800,1000],[0,0]],
      dungeon_4: [[0,-600],[0,600],[-1400,0],[1400,0],[-700,-900],[700,900],[-700,900],[700,-900],[0,0]],
      dungeon_5: [[0,-800],[800,0],[-800,0],[0,800],[1200,-600],[-1200,600],[0,-1500],[1500,0],[-1500,0]],
      dungeon_prem: [[-2000,-1200],[0,-900],[2000,-600],[-2000,300],[0,600],[2000,900],[-1000,-300],[1000,300],[0,0]],
    };

    const zones = ZONES[galaxy.current];
    if (!zones) return;

    const baseCount = this.mobs.filter(m => !m.isDungeonBoss && !m.isBossEscort && !m.isDepositGuard).length;
    const extraCount = Math.round(baseCount * (diff.mobCount - 1.0));
    const rnd = (a, b) => Phaser.Math.Between(a, b);
    const M = MOBS;

    for (let i = 0; i < extraCount; i++) {
      const [oz, oz2] = zones[i % zones.length];
      const jx = oz  + rnd(-180, 180);
      const jy = oz2 + rnd(-180, 180);
      const k  = pool[rnd(0, pool.length - 1)];
      const lvl = rnd(Lmin, Lmax);
      const m = new Mob(this, M[k], lvl, cx + jx, cy + jy,
        { behavior: 'patrol', patrolRadius: 280, hpMult: diff.mobHP, dmgMult: diff.mobDamage });
      this.mobs.push(m);
    }
  }

  // Сбрасывает нейтральные базы текущего сектора в активное состояние при еженедельном респауне.
  // Расписание: среда и суббота в 22:00 UTC. Отслеживается per-sector чтобы каждый PvP-сектор
  // сбрасывался независимо при первом посещении после времени респауна.
  _checkGuardReset() {
    const resetTime = getLastResetTime();
    if (!resetTime) return;
    this.lastGuardReset = this.lastGuardReset || {};
    const key = galaxy.current;
    if ((this.lastGuardReset[key] || 0) >= resetTime) return;
    this.lastGuardReset[key] = resetTime;
    for (const base of this.miningBases) base.resetToNeutral();
  }

  _createApophisRings(cx, cy) {
    const defs = [
      { key: 'ring_apophis_outer', depth: 37, size: 440, speed:  0.25 },
      { key: 'ring_apophis_mid',   depth: 38, size: 330, speed: -0.45 },
      { key: 'ring_apophis_inner', depth: 41, size: 220, speed:  0.75 },
    ];
    return defs.map(d => {
      const img = this.add.image(cx, cy, d.key)
        .setDepth(d.depth)
        .setDisplaySize(d.size, d.size)
        .setBlendMode('ADD');
      img._rotSpeed = d.speed;
      return img;
    });
  }

  _updateApophisRings(dt) {
    const boss = this._apophisBoss;
    if (!boss || !boss.alive) {
      this._apophisPulseTween?.stop();
      this._apophisPulseTween = null;
      for (const r of this._apophisRings) r.destroy();
      this._apophisRings = null;
      this._apophisBoss = null;
      return;
    }
    const hpRatio = boss.maxHull > 0 ? boss.hull / boss.maxHull : 1;
    // Синхронизация HP босса для участников группы (лидер — раз в 0.5с)
    this._bossSyncTimer = (this._bossSyncTimer || 0) + dt;
    if (this._bossSyncTimer >= 0.5) {
      this._bossSyncTimer = 0;
      const grp = this.groupSystem;
      if (grp?.inGroup && grp.isLeader) grp.syncBossHp(hpRatio);
    }
    // Фаза 2: при 50% HP вызвать Жнецов и Левиафанов
    if (!this._apophisPhase2Started && hpRatio < 0.50) {
      this._apophisPhase2Started = true;
      this._startApophisPhase2();
    }
    if (!this._apophisRingsEnraged && hpRatio < 0.40) {
      this._apophisRingsEnraged = true;
      for (const r of this._apophisRings) {
        r._rotSpeed *= 2.2;
        r.setTint(0xff4444);
      }
    }
    for (const r of this._apophisRings) {
      r.x = boss.x;
      r.y = boss.y;
      r.rotation += r._rotSpeed * dt;
    }
  }

  // ── Суточный лимит данжей (1 раз в сутки, сброс в 01:00) ─────────────────
  // TODO: перенести cooldown в БД → player_state.state.dungeonCooldowns (таблица player_state уже есть)
  _canEnterDungeon(key) {
    try {
      const stored = JSON.parse(localStorage.getItem('sd_dungeon_cd') || '{}');
      const resetTs = stored[key];
      if (!resetTs) return true;
      return Date.now() >= resetTs;
    } catch { return true; }
  }

  _recordDungeonClearance(key) {
    try {
      const stored = JSON.parse(localStorage.getItem('sd_dungeon_cd') || '{}');
      const reset = new Date();
      reset.setHours(1, 0, 0, 0);
      if (reset <= new Date()) reset.setDate(reset.getDate() + 1);
      stored[key] = reset.getTime();
      localStorage.setItem('sd_dungeon_cd', JSON.stringify(stored));
    } catch {}
  }

  _startApophisPhase2() {
    const cx = this.worldWidth / 2, cy = this.worldHeight / 2;
    this.log('Апофис входит во вторую фазу!');
    let delay = 0;
    // 3 Жнеца (ancient_10 ×3) последовательно с интервалом 2с
    [[-400, 350], [0, 500], [400, 350]].forEach(([ox, oy]) => {
      this.time.delayedCall(delay, () => {
        if (!this._apophisBoss?.alive) return;
        const m = new Mob(this, MOBS['ancient_10'], 50, cx + ox, cy + oy,
          { behavior: 'guard', patrolRadius: 350, bossRef: this._apophisBoss, hpMult: 3, dmgMult: 3 });
        m.isBossEscort = true;
        m._groupMobId = this._nextGroupMobId++;
        const _grp2 = this.groupSystem;
        if (_grp2?.inGroup && !_grp2.isLeader) m.ghostBoss = true;
        this.mobs.push(m);
        this.log('Жнец появляется!');
      });
      delay += 2000;
    });
    delay += 1000;
    // 4 Левиафана (ancient_06 ×4) последовательно с интервалом 2с
    [[-700, 0], [-230, 0], [230, 0], [700, 0]].forEach(([ox, oy]) => {
      this.time.delayedCall(delay, () => {
        if (!this._apophisBoss?.alive) return;
        const m = new Mob(this, MOBS['ancient_06'], 50, cx + ox, cy + oy,
          { behavior: 'guard', patrolRadius: 350, bossRef: this._apophisBoss, hpMult: 3, dmgMult: 3 });
        m.isBossEscort = true;
        m._groupMobId = this._nextGroupMobId++;
        const _grp2 = this.groupSystem;
        if (_grp2?.inGroup && !_grp2.isLeader) m.ghostBoss = true;
        this.mobs.push(m);
        this.log('Левиафан появляется!');
      });
      delay += 2000;
    });
  }

  _spawnHomeBase() {
    const cur = galaxy.current;
    const sec = SECTORS[cur];
    if (sec?.isDungeon) return; // Данжи — без штабов

    const cx  = this.worldWidth / 2;
    const cy  = this.worldHeight / 2;
    // Gate edge margin (same formula as createJumpgates)
    const my  = this.worldHeight / 2 - 320;

    const add = (corp, ox, oy) => {
      const hb = new HomeBase(this, cx + ox, cy + oy, corp);
      this.homeBases.push(hb);
    };

    if (cur.startsWith('helios')) { add('helios', 0, 0); return; }
    if (cur.startsWith('karax'))  { add('karax',  0, 0); return; }
    if (cur.startsWith('tides'))  { add('tides',  0, 0); return; }

    if (cur.startsWith('pvp')) {
      // Each corp base is placed 700px inward from its gate (toward world center)
      const layout = PVP_GATES[cur];
      if (!layout) return;
      for (const [target, [ox, oy]] of Object.entries(layout)) {
        const corp = ['helios', 'karax', 'tides'].find(c => target.startsWith(c));
        if (!corp) continue; // skip R-1-boss gate
        const dist = Math.hypot(ox, oy) || 1;
        add(corp, ox - ox / dist * 700, oy - oy / dist * 700);
      }
    }
  }

  createJumpgates() {
    this.gates = [];
    const cx = this.worldWidth / 2, cy = this.worldHeight / 2, cur = galaxy.current;
    const mx = this.worldWidth / 2 - 320, my = this.worldHeight / 2 - 320;
    const curSec = SECTORS[cur];

    const nbrs = neighbors(cur);
    const pvpLayout = PVP_GATES[cur]; // fixed positions for PvP sectors

    // Dungeons: show only one exit gate at fixed south-center position (→ player's own corp).
    // Other corp exit gates are hidden — each player sees only their own exit.
    // Non-corp dungeon gates (e.g. dungeon_5 → dungeon_prem) are still shown via edgeDir.
    // Side-effect fix: the old Karax gate in D1 (north edge, dy=-1) was within 650px of the
    // boss door, causing addWall to silently skip it. Now gone → boss door properly exists.
    let dungeonGate = null;
    let dungeonOtherNbrs = [];
    if (curSec?.isDungeon && !pvpLayout) {
      const exitKey = nbrs.find(k => k.startsWith(this.playerCorp + '_'));
      if (exitKey) dungeonGate = { target: exitKey, gx: cx, gy: cy + my };
      // Keep non-corp dungeon-to-dungeon connections (dungeon_prem, etc.)
      dungeonOtherNbrs = nbrs.filter(k => !['helios', 'karax', 'tides'].some(c => k.startsWith(c + '_')));
    }
    const gateTargets = dungeonGate
      ? [dungeonGate.target, ...dungeonOtherNbrs]
      : nbrs;

    // Count gates per direction for perpendicular spread (non-PvP, non-dungeon-corp-gates only)
    const dirCount = {}, dirIdx = {};
    const needsEdgeDirs = !pvpLayout && (!dungeonGate || dungeonOtherNbrs.length > 0);
    if (needsEdgeDirs) {
      const toCount = dungeonGate ? dungeonOtherNbrs : gateTargets;
      for (const t of toCount) {
        const { dx, dy } = edgeDir(cur, t);
        const k = `${dx},${dy}`;
        dirCount[k] = (dirCount[k] || 0) + 1;
        dirIdx[k] = 0;
      }
    }

    for (const t of gateTargets) {
      let gx, gy;
      if (dungeonGate && t === dungeonGate.target) {
        gx = dungeonGate.gx;
        gy = dungeonGate.gy;
      } else if (pvpLayout && pvpLayout[t]) {
        const [ox, oy] = pvpLayout[t];
        gx = cx + ox;
        gy = cy + oy;
      } else if (pvpLayout) {
        continue; // target not in layout (shouldn't happen)
      } else {
        const { dx, dy } = edgeDir(cur, t);
        const k = `${dx},${dy}`;
        const total = dirCount[k];
        const idx = dirIdx[k]++;
        // Разносим: dy≠0 → расталкиваем по X; dx≠0 → по Y
        const perpOff = total > 1 ? (idx - (total - 1) / 2) * 520 : 0;
        gx = cx + dx * mx + (dy !== 0 ? perpOff : 0);
        gy = cy + dy * my + (dx !== 0 ? perpOff : 0);
      }

      const sec = SECTORS[t];
      const isDungeon = sec.isDungeon === true;

      // Enemy-corp gate in PvP: player can't jump there
      const isEnemyPvp = !!pvpLayout && ['helios', 'karax', 'tides']
        .some(c => c !== this.playerCorp && t.startsWith(c));

      // Ring hole is offset +2.1px right, +5.9px down from PNG center at 512px;
      // at display size 260px (scale 0.508) → +1px X, +3px Y in world coords.
      const vx = gx + 1, vy = gy + 3;
      const vortex = this.add.image(vx, vy, 'jumpgate_vortex').setOrigin(0.5, 0.5).setDepth(2).setDisplaySize(110, 110).setVisible(false);
      if (isDungeon)  vortex.setTint(0xffaa00);
      if (isEnemyPvp) vortex.setTint(0xff4444);

      const ring = this.add.image(gx, gy, 'jumpgate_ring').setDepth(4).setDisplaySize(260, 260);
      if (isDungeon)  ring.setTint(0xffe0b2);
      if (isEnemyPvp) ring.setTint(0xff4444);

      const lock = sectorAccess(t, this.pilotLevel, this.activeShip, this.premium).ok ? '' : ' 🔒';
      const labelSuffix = isEnemyPvp ? ' 🚫' : lock;
      const labelColor  = isEnemyPvp ? '#ff8080' : isDungeon ? '#ffcc80' : (lock ? '#ef9a9a' : '#9fe6ff');
      const label = this.add.text(gx, gy - 135,
        `${sec.name}${labelSuffix}\n${i18n.t('mob.level')}${sec.lvlMin}–${sec.lvlMax}`,
        { fontFamily: 'Orbitron, sans-serif', fontSize: '14px', color: labelColor, align: 'center', resolution: UI_RES })
        .setOrigin(0.5, 1).setDepth(6);

      const btnBg = isEnemyPvp ? '#5a1a1a' : isDungeon ? '#f57c00' : '#4dd0e1';
      const btnText = isEnemyPvp ? '🚫 ЗАКРЫТО' : i18n.t('map.jump');
      const btn = this.add.text(gx, gy - 185, btnText, {
        fontFamily: 'Orbitron', fontSize: '18px', color: isEnemyPvp ? '#ff8080' : '#ffffff',
        backgroundColor: btnBg, padding: { x: 14, y: 8 }
      }).setOrigin(0.5, 1).setDepth(10).setInteractive({ useHandCursor: true }).setVisible(false);

      const gate = { x: vx, y: vy, target: t, ring, vortex, label, btn, spin: 1.1 };
      btn.on('pointerdown', (pointer, localX, localY, event) => {
        if (event) event.stopPropagation();
        this._tryJump(gate);
      });
      this.gates.push(gate);
    }

    // Pre-load neighboring sector maps after the first frame so the loader doesn't
    // compete with scene setup. Uses delayedCall so it fires after create() returns.
    let _mapsQueued = false;
    for (const t of gateTargets) {
      const _map = SECTORS[t]?.map;
      if (_map && !this.textures.exists(_map)) {
        this.load.image(_map, `assets/maps/${_map}.jpg`);
        _mapsQueued = true;
      }
    }
    if (_mapsQueued) this.time.delayedCall(300, () => { if (this.scene.isActive()) this.load.start(); });
  }

  _tryJump(gate) {
    if (this.jumping) return;
    const acc = sectorAccess(gate.target, this.pilotLevel, this.activeShip, this.premium);
    if (!acc.ok) { this.log(i18n.t('log.jump_locked', { reason: acc.reason })); return; }
    // From PvP: block jumps into enemy corp sectors
    if (SECTORS[galaxy.current]?.pvp) {
      const isEnemyCorp = ['helios', 'karax', 'tides']
        .some(c => c !== this.playerCorp && gate.target.startsWith(c));
      if (isEnemyCorp) { this.log(i18n.t('log.jump_enemy_corp')); return; }
    }
    const sec = SECTORS[gate.target];

    // Суточный лимит: 1 прохождение в сутки (кулдаун записывается после гибели босса)
    if (sec?.isDungeon && !this._canEnterDungeon(gate.target)) {
      this.log('Данж уже пройден сегодня. Доступ откроется в 01:00.');
      return;
    }

    // R-1-boss: требуется группа ≥ 4 (в DEV_MODE разрешаем соло)
    if (gate.target === 'R-1-boss' && !DEV_MODE) {
      const hud = this.scene.get('HudScene');
      const memberCount = hud?.groupSystem?.memberCount ?? 1;
      if (memberCount < 4) {
        this.log('Зов Апофиса требует группу минимум 4 пилота.');
        return;
      }
    }

    const proceed = () => {
      if (sec?.lvlMin && sec.lvlMin > this.pilotLevel + 5) {
        this._showJumpDangerWarning(gate.target, sec.lvlMin, () => this.startJumpSequence(gate));
        return;
      }
      this.startJumpSequence(gate);
    };

    // R-1-boss — фиксированная сложность, модал не нужен
    if (sec?.isDungeon && gate.target !== 'R-1-boss') {
      this._showDungeonDifficultyModal(gate, proceed);
    } else {
      proceed();
    }
  }

  _showDungeonDifficultyModal(gate, onConfirm) {
    const W = this.scale.width, H = this.scale.height;
    const OW = 360, OH = 230;
    const ox = (W - OW) / 2, oy = (H - OH) / 2;
    const objs = [];
    const destroy = () => { objs.forEach(o => o?.destroy()); };

    objs.push(this.add.rectangle(ox, oy, OW, OH, 0x060c14, 0.97)
      .setOrigin(0, 0).setStrokeStyle(1.5, 0x4dd0e1, 0.5).setDepth(200).setScrollFactor(0));
    objs.push(this.add.text(ox + OW / 2, oy + 18, 'ВЫБОР СЛОЖНОСТИ', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '13px', color: '#4dd0e1', resolution: 2,
    }).setOrigin(0.5).setDepth(201).setScrollFactor(0));

    const modes = [
      { key: 'normal', label: 'NORMAL',  hint: 'Соло',                        fill: 0x0d1e0d, border: 0x388e3c, tc: '#81c784' },
      { key: 'hard',   label: 'HARD',    hint: 'Рекомендуется 2–3 игрока',    fill: 0x1e1800, border: 0xf9a825, tc: '#fff176' },
      { key: 'elite',  label: 'ELITE',   hint: 'Рекомендуется 4–5 игроков',   fill: 0x1e0808, border: 0xef5350, tc: '#ef9a9a' },
    ];

    modes.forEach((m, i) => {
      const by = oy + 48 + i * 54;
      const btn = this.add.rectangle(ox + OW / 2, by + 22, OW - 40, 46, m.fill, 1)
        .setOrigin(0.5, 0.5).setStrokeStyle(1, m.border, 0.8).setDepth(201).setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setAlpha(0.85));
      btn.on('pointerout',  () => btn.setAlpha(1));
      btn.on('pointerdown', () => {
        this.dungeonDifficulty = m.key;
        destroy();
        onConfirm();
      });
      objs.push(btn);
      objs.push(this.add.text(ox + 35, by + 12, m.label, {
        fontFamily: 'Orbitron, sans-serif', fontSize: '12px', color: m.tc, resolution: 2,
      }).setOrigin(0, 0).setDepth(202).setScrollFactor(0));
      objs.push(this.add.text(ox + 35, by + 30, m.hint, {
        fontFamily: 'Inter, sans-serif', fontSize: '10px', color: '#667788', resolution: 2,
      }).setOrigin(0, 0).setDepth(202).setScrollFactor(0));
    });

    const cancelY = oy + OH - 16;
    const cancel = this.add.text(ox + OW / 2, cancelY, 'ОТМЕНА', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '10px', color: '#445566', resolution: 2,
    }).setOrigin(0.5).setDepth(202).setScrollFactor(0).setInteractive({ useHandCursor: true });
    cancel.on('pointerdown', () => destroy());
    objs.push(cancel);
  }

  updateGates(dt) {
    if (!this.gates) return;
    const px = this.player.x, py = this.player.y;
    for (const g of this.gates) {
      g.vortex.rotation += dt * g.spin;
      const d = Phaser.Math.Distance.Between(px, py, g.x, g.y);
      const near = d < 200;
      g.btn.setVisible(this.player.alive && !this.jumping && near);
      if (near && this.input.keyboard.checkDown(this.keyJ, 500)) {
        this._tryJump(g);
      }
    }
  }

  startJumpSequence(gate) {
    if (this.jumping) return;
    this.jumping = true;
    // Solo-lock: entering dungeon without group marks instance as solo
    const _targetSec = SECTORS[gate.target];
    const _grp = this.groupSystem;
    if (_grp) {
      if (_targetSec?.isDungeon && !_grp.inGroup) _grp.isSolo = true;
      else if (!_targetSec?.isDungeon) _grp.isSolo = false;
    }
    this.player.waypoint = null;
    this.movement.setWaypoint(null);
    this.player.speed = 0;
    this.selectTarget(null);
    this.isFiring = false;
    
    // Вихрь появляется ОДНОМОМЕНТНО
    gate.vortex.setVisible(true).setAlpha(1).setDisplaySize(165, 165);
    
    const spinUpDuration = 2600;
    const flashDuration = 400;
    const totalDuration = spinUpDuration + flashDuration;
    
    const targetAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, gate.x, gate.y);
    this.player.lockedRotation = true;

    if (Phaser.Math.Distance.Between(this.player.x, this.player.y, gate.x, gate.y) > 10) {
      this.tweens.add({
        targets: this.player.sprite,
        rotation: targetAngle + (this.player.ship.artAngleOffset ?? ART_ANGLE_OFFSET),
        duration: 400
      });
    }

    this.tweens.add({
      targets: gate,
      spin: 35.0, 
      duration: spinUpDuration,
      ease: 'Quint.easeIn'
    });

    this._jumpScaleTween = this.tweens.add({
      targets: this.player.sprite,
      x: gate.x, y: gate.y,
      scaleX: 0.01, scaleY: 0.01,
      duration: spinUpDuration,
      ease: 'Back.easeIn'
    });

    this._jumpVisTimer = this.time.delayedCall(spinUpDuration, () => {
      this._jumpVisTimer = null;
      this.player.sprite.setVisible(false);

      const flash = this.add.image(gate.x, gate.y, 'glow')
        .setDepth(50).setTint(0x8fe6ff).setScale(0.1).setAlpha(1).setBlendMode('ADD');

      this.tweens.add({
        targets: flash,
        scaleX: 25,
        scaleY: 25,
        alpha: 0,
        duration: flashDuration,
        ease: 'Expo.easeOut',
        onComplete: () => flash.destroy()
      });
    });

    this._jumpTravelTimer = this.time.delayedCall(totalDuration, () => {
      this._jumpTravelTimer = null;
      this.player.lockedRotation = false;
      this.travelTo(gate.target);
    });
  }

  gateAt(wx, wy) {
    for (const g of this.gates) {
      if (Phaser.Math.Distance.Between(wx, wy, g.x, g.y) < 120) return g;
    }
    return null;
  }

  inSafeZone(x, y) {
    return Phaser.Math.Distance.Between(x, y, this.worldWidth / 2, this.worldHeight / 2) < this.safeZoneRadius;
  }

  travelTo(key) {
    const acc = sectorAccess(key, this.pilotLevel, this.activeShip, this.premium);
    if (!acc.ok) { this.jumping = false; this.player.sprite.setVisible(true); this.player._restoreDisplaySize(); return; }
    this._execJump(key, galaxy.current);
  }

  _showJumpDangerWarning(key, recLevel, onConfirm) {
    const W = this.scale.width, H = this.scale.height;
    const OW = 300, OH = 120, ox = (W - OW) / 2, oy = (H - OH) / 2;
    const objs = [];
    const bg = this.add.rectangle(ox, oy, OW, OH, 0x0e0608, 0.97)
      .setOrigin(0, 0).setStrokeStyle(1.5, 0xef5350, 0.8).setDepth(200).setScrollFactor(0);
    objs.push(bg);
    objs.push(this.add.text(ox + OW / 2, oy + 18, '⚠ Опасный сектор', { fontFamily: 'Orbitron, sans-serif', fontSize: '14px', color: '#ef5350', resolution: 2 }).setOrigin(0.5).setDepth(201).setScrollFactor(0));
    objs.push(this.add.text(ox + OW / 2, oy + 44, `Рекомендуемый уровень: ${recLevel}`, { fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#ccaaaa', resolution: 2 }).setOrigin(0.5).setDepth(201).setScrollFactor(0));
    objs.push(this.add.text(ox + OW / 2, oy + 62, `Ваш уровень: ${this.pilotLevel}`, { fontFamily: 'Inter, sans-serif', fontSize: '11px', color: '#886666', resolution: 2 }).setOrigin(0.5).setDepth(201).setScrollFactor(0));

    const btnY = oy + OH - 22;
    const noBtn = this.add.rectangle(ox + OW / 2 - 65, btnY, 100, 28, 0x0d1e2c, 1)
      .setStrokeStyle(1, 0x2a4a60, 0.8).setDepth(201).setScrollFactor(0).setInteractive({ useHandCursor: true });
    noBtn.on('pointerdown', () => { objs.forEach(o => o?.destroy()); });
    objs.push(noBtn);
    objs.push(this.add.text(ox + OW / 2 - 65, btnY, 'НАЗАД', { fontFamily: 'Orbitron, sans-serif', fontSize: '11px', color: '#4dd0e1', resolution: 2 }).setOrigin(0.5).setDepth(202).setScrollFactor(0));

    const yesBtn = this.add.rectangle(ox + OW / 2 + 65, btnY, 100, 28, 0x1a0808, 1)
      .setStrokeStyle(1, 0xef5350, 0.8).setDepth(201).setScrollFactor(0).setInteractive({ useHandCursor: true });
    yesBtn.on('pointerdown', () => { objs.forEach(o => o?.destroy()); onConfirm(); });
    objs.push(yesBtn);
    objs.push(this.add.text(ox + OW / 2 + 65, btnY, 'ВОЙТИ', { fontFamily: 'Orbitron, sans-serif', fontSize: '11px', color: '#ef9a9a', resolution: 2 }).setOrigin(0.5).setDepth(202).setScrollFactor(0));
  }

  _execJump(key, fromKey) {
    galaxy.current = key;
    if (key === 'R-1-boss') this.advanceMission('story_signal', 0);
    const nextSec = SECTORS[key];
    const nextPvp = nextSec.pvp === true;
    const nextDungeon = nextSec.isDungeon === true;
    const nextPersonal = nextSec.personal === true;
    const nextScale = nextPvp ? PVP_WORLD_SCALE : (nextDungeon || nextPersonal) ? 1.0 : 1.2;
    const nextW = BASE_WORLD.width * nextScale;
    const nextH = BASE_WORLD.height * nextScale;
    const mx = nextW / 2 - 320, my = nextH / 2 - 320;
    let startX, startY;
    // Dungeon exits are always at south center for all corps (see createJumpgates dungeonGate).
    // edgeDir(dungeon, karax_1) gives dy=-1 (north) → player spawned next to boss. Fix:
    // always spawn at south center when entering a dungeon from a corp sector.
    const fromCorpSector = ['helios', 'karax', 'tides'].some(c => fromKey?.startsWith(c + '_'));
    if (nextDungeon && fromCorpSector) {
      startX = nextW / 2;
      startY = nextH / 2 + my; // south center — matches the dungeon exit gate position
    } else {
      const { dx, dy } = edgeDir(key, fromKey);
      startX = nextW / 2 + dx * mx;
      startY = nextH / 2 + dy * my;
    }
    document.getElementById('scene-overlay')?.classList.add('active');
    this.scene.restart({ startX, startY });
  }

  setupInput() {
    this.input.mouse?.disableContextMenu();
    let lastClickTime = 0;

    this.input.on('pointerdown', (pointer) => {
      if (this.scene.isActive('GarageScene') || this.scene.isActive('CargoScene') || this.scene.isActive('MapScene') || this.scene.isActive('BaseMenuScene') || this.scene.isActive('CorpScene') || this.scene.isActive('SkillScene') || this.scene.isActive('ClanScene') || this.scene.isActive('MissionsScene') || this.scene.isActive('ShopScene')) return;
      if (this.atBase) return;

      const now = this.time.now;
      const isDouble = (now - lastClickTime < 350);
      lastClickTime = now;

      const mr = minimapRect(this, getMinimapDims(loadSettings().minimapSize));
      if (pointer.x >= mr.x && pointer.x <= mr.x + mr.w && pointer.y >= mr.y && pointer.y <= mr.y + mr.h) {
        const wp = minimapToWorld(pointer.x, pointer.y, mr, this.worldWidth, this.worldHeight);
        this.cancelCollect(); this.selectTarget(null);
        if (this.player.alive && !this.jumping) this.movement.setWaypoint(wp.x, wp.y, true);
        return;
      }

      const wpt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const wx = wpt.x, wy = wpt.y;

      if (this.movement.isOverBoostChevron(wx, wy)) { this.movement.toggleBoost(); return; }

      const gate = this.gateAt(wx, wy);
      if (gate) {
        this.cancelCollect(); this.selectTarget(null); this.pendingGate = gate; this.steering = false;
        if (this.player.alive && !this.jumping) this.movement.setWaypoint(gate.x, gate.y, false);
        return;
      }

      // Shadow arena bot targeting
      if (this.botPilot?.alive) {
        const bd = Phaser.Math.Distance.Between(wx, wy, this.botPilot.x, this.botPilot.y);
        if (bd < 80) {
          this.selectTarget(this.botPilot);
          if (isDouble) this.isFiring = true;
          return;
        }
      }

      // Mob check first — takes priority over loot when overlapping
      const mob = this.mobAt(wx, wy);
      if (isDouble && mob) {
        this.selectTarget(mob); this.isFiring = true;
        this.log("ATTACK: " + i18n.t(mob.tpl.nameKey));
        return;
      }
      if (mob) { this.cancelCollect(); this.selectTarget(mob); return; }

      // Double-click empty space → check for base attack
      if (isDouble) {
        const base = this.baseAt(wx, wy);
        if (base?.canBeAttacked) { this.selectTarget(base); this.isFiring = true; return; }
      }

      const box = this.lootAt(wx, wy);
      if (box) {
        if (this.inventory.length >= this._cargoMax()) { this.log(i18n.t('log.cargo_full')); return; }
        this.cancelCollect();
        this.collectTarget = box;
        this.collectTimer = 0;
        if (this.player.alive && !this.jumping) this.movement.setWaypoint(box.x, box.y - 85, false);
        return;
      }
      const deposit = this.depositAt(wx, wy);
      if (deposit) {
        this.cancelCollect();
        this.collectTarget = deposit;
        this.collectTimer = 0;
        if (this.player.alive && !this.jumping) this.movement.setWaypoint(deposit.x, deposit.y - 85, false);
        return;
      }

      // Empty space → move
      if (this.player.alive && !this.jumping) { this.cancelCollect(); this.steering = true; this.movement.setWaypoint(wx, wy, false); this.pingAt(wx, wy); }
    });

    this.input.on('pointerup', () => { this.steering = false; this.movement.steerMode = false; });
    this.input.keyboard.addCapture('TAB,ESC,G,M,J,F,CTRL,I,S');

    this.input.keyboard.on('keydown-TAB', (e) => { e.preventDefault(); if (this._autoTargetEnabled !== false) this.cycleTarget(); });
    this.input.keyboard.on('keydown-S', () => { this.toggleOverlay('SettingsScene'); });
    this.input.keyboard.on('keydown-ESC', () => { this._exitToSpace(); });
    this.input.keyboard.on('keydown-F', () => {
      if (!this.player.alive) return;
      if (this.atBase) return; // F = Друзья (обрабатывается в HudScene)
      const nearMining = this.miningBases.find(b => Phaser.Math.Distance.Between(this.player.x, this.player.y, b.x, b.y) < 360);
      if (nearMining) { nearMining.interact(this.playerName); return; }
      const nearHome = this.homeBases.find(b => Phaser.Math.Distance.Between(this.player.x, this.player.y, b.x, b.y) < 380);
      if (nearHome) nearHome.openInfo();
    });
    const _openBase = (sceneKey, hint) => {
      if (!this.atBase) {
        if (!this.nearBase) { this.log(`${hint} — подлетите к базе`); return; }
        this._enterNearestBase(sceneKey); return;
      }
      if (this.scene.isActive(sceneKey)) { this._exitToSpace(); return; }
      this.player.waypoint = null; this.cancelCollect(); this.toggleOverlay(sceneKey);
    };
    this.input.keyboard.on('keydown-C', () => _openBase('CargoScene', 'Склад'));
    this.input.keyboard.on('keydown-I', () => {
      this.player.waypoint = null; this.isFiring = false; this.steering = false;
      this.cancelCollect(); this.toggleOverlay('CargoScene');
    });
    this.input.keyboard.on('keydown-G', () => _openBase('GarageScene',   'Гараж'));
    this.input.keyboard.on('keydown-M', () => { this.player.waypoint = null; this.cancelCollect(); this.toggleOverlay('MapScene'); });
    this.input.keyboard.on('keydown-K', () => _openBase('SkillScene',    'Скиллы'));
    this.input.keyboard.on('keydown-O', () => _openBase('MissionsScene', 'Миссии'));
    this.input.keyboard.on('keydown-P', () => _openBase('ShopScene',     'Магазин'));
    this.input.keyboard.on('keydown-H', () => _openBase('CorpScene',     'Корпорация'));
    this.input.keyboard.on('keydown-N', () => _openBase('ClanScene',     'Гильдия'));
    
    this.input.keyboard.on('keydown-CTRL', (e) => {
      e.preventDefault();
      if (this.target && this.target.alive) {
        this.isFiring = !this.isFiring;
        this.log(this.isFiring ? "FIRE ON" : "FIRE OFF");
      }
    });

    // Action bar hotkeys 1-9 / 0
    ['ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE'].forEach((k, i) => {
      this.input.keyboard.on(`keydown-${k}`, () => this._activateSkillSlot(i));
    });
    this.input.keyboard.on('keydown-ZERO', () => this._activateSkillSlot(9));

    if (DEV_MODE) {
      this.input.keyboard.on('keydown-ZERO', () => {
        if (this.pilotLevel >= MAX_LEVEL) return;
        const info = levelInfo(this.pilotXp);
        this.gainXp(info.need - info.into + 1);
        if (this.pilotLevel >= 45) { this.seasonWon = true; this.corpRep = 1.0; }
      });
      this.input.keyboard.on('keydown-NINE', () => {
        this.credits  = (this.credits  || 0) + 1000000;
        this.starGold = (this.starGold || 0) + 500;
        addPlasmateToInventory(this.inventory, 500, this._cargoMax());
        this._tryAddToAmmoSlots('ammo_laser',  5000);
        this._tryAddToAmmoSlots('ammo_plasma', 5000);
        for (let i = 0; i < 3; i++) this.inventory.push(rollLaser(4, 50));
        for (let i = 0; i < 3; i++) this.inventory.push(rollCannon(4, 50));
        for (let i = 0; i < 2; i++) this.inventory.push(rollArmor(4, 50));
        // DEV: add boards, connectors, chips
        this.boardInventory = this.boardInventory ?? [];
        this.boardInventory.push(rollBoard(1), rollBoard(2), rollBoard(3));
        this.connectorInventory = this.connectorInventory ?? [];
        for (let t = 1; t <= 3; t++) for (let k = 0; k < 6; k++) this.connectorInventory.push(rollConnector(t));
        this.chips = (this.chips ?? 0) + 20;
        this.log('DEV: +1M кр, +500 ⭐, патроны (лазер+плазма), 3×лазер T4, 3×пушка T4, 2×броня T4, 3 платы, 18 коннекторов, 20 чипов');
      });
    }
  }

  // ── Active skill system ────────────────────────────────────────────────

  _skillCooldownMs(key) {
    const CONS_CD = { repair_pack: 90000, speed_boost: 120000, scanner_pulse: 180000, emergency_warp: 600000 };
    if (key.startsWith('use:')) return CONS_CD[key.slice(4)] ?? 60000;
    if (key === 'argus:pulsar')       return 25000;
    if (key === 'argus:cocoon')       return 60000;
    if (key === 'argus:missiles')     return 35000;
    if (key === 'argus:phase_strike') return 50000;
    if (key.startsWith('ship:')) {
      const mod = this.player?.activeCooldownMod ?? 1;
      const SHIP_CD = {
        'ship:helion_volley': 40000, 'ship:argosy_repair': 55000, 'ship:drifter_jump': 60000,
        'ship:drover_scan': 120000,
        'ship:stiletto_afterburner': 50000, 'ship:anvil_lockdown': 90000,
        'ship:aegis_dome': 120000, 'ship:phantom_cloak': 180000,
        'ship:wisp_recall': 180000,
      };
      return Math.round((SHIP_CD[key] || 40000) * mod);
    }
    const lv  = Math.max(1, (this.skillLevels || {})[key] || 1);
    const mod = this.player?.activeCooldownMod ?? 1;
    const base = { overcharge_shot: 25000, salvo: 55000, emergency_repair: 120000,
                   shield_burst: 85000, stealth_sprint: 55000,
                   berserker: [90000, 80000, 70000, 60000][lv - 1] ?? 90000 };
    return Math.round((base[key] || 30000) * mod);
  }

  _enterNearestBase(sceneKey = 'GarageScene') {
    this.player.waypoint = null; this.cancelCollect();
    for (const hb of (this.homeBases || [])) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, hb.x, hb.y);
      if (d < 420) { hb.enterBase(sceneKey); return; }
    }
  }

  _activateSkillSlot(i) {
    const key = (this.actionBar || [])[i];
    if (!key || !this.player?.alive) return;
    if (key.startsWith('use:')) { this._useConsumable(key.slice(4), this.time.now); return; }
    if (key.startsWith('argus:')) {
      const now = this.time.now;
      const cdEnd = this.skillCooldowns[key] || 0;
      if (now < cdEnd) { this.log(`⏳ КД: ${Math.ceil((cdEnd - now) / 1000)}с`); return; }
      this.skillCooldowns[key] = now + this._skillCooldownMs(key);
      if (key === 'argus:pulsar')              this.argusCtrl?._activatePulsar();
      else if (key === 'argus:cocoon')         this.argusCtrl?._activateCocoon();
      else if (key === 'argus:missiles')       this.argusCtrl?._activateMissiles();
      else if (key === 'argus:phase_strike')   this.argusCtrl?._activatePhaseStrike();
      return;
    }
    if (key.startsWith('ship:')) {
      const now = this.time.now;
      const cdEnd = this.skillCooldowns[key] || 0;
      if (now < cdEnd) { this.log(`⏳ КД: ${Math.ceil((cdEnd - now) / 1000)}с`); return; }
      const cd = this._skillCooldownMs(key);
      if (key === 'ship:helion_volley') this._doShipVolleyBlast(now, cd);
      else if (key === 'ship:argosy_repair') this._doShipArgosyRepair(now, cd);
      else if (key === 'ship:drifter_jump')  this._doShipDrifterJump(now, cd);
      else if (key === 'ship:drover_scan')          this._doShipDroverScan(now, cd);
      else if (key === 'ship:stiletto_afterburner') this._doShipStilettoAfterburner(now, cd);
      else if (key === 'ship:anvil_lockdown')       this._doShipAnvilLockdown(now, cd);
      else if (key === 'ship:aegis_dome')           this._doShipAegisDome(now, cd);
      else if (key === 'ship:phantom_cloak')        this._doShipPhantomCloak(now, cd);
      else if (key === 'ship:wisp_recall')          this._doShipWispRecall(now, cd);
      return;
    }
    const lv = (this.skillLevels || {})[key] || 0;
    if (lv === 0) return;
    const now = this.time.now;
    const cdEnd = this.skillCooldowns[key] || 0;
    if (now < cdEnd) { this.log(`⏳ КД: ${Math.ceil((cdEnd - now) / 1000)}с`); return; }
    const cd = this._skillCooldownMs(key);
    switch (key) {
      case 'overcharge_shot':  this._doOverchargeShot(now, cd);  break;
      case 'salvo':            this._doSalvo(now, cd);           break;
      case 'emergency_repair': this._doEmergencyRepair(now, cd); break;
      case 'shield_burst':     this._doShieldBurst(now, cd);     break;
      case 'stealth_sprint':   this._doStealthSprint(now, cd);   break;
      case 'berserker':        this._doBerserker(lv, now, cd);   break;
    }
  }

  _useConsumable(type, now) {
    const barKey  = `use:${type}`;
    const cdEnd   = this.skillCooldowns[barKey] || 0;
    const buffEnd = (this._consBuffEndTimes || {})[barKey] || 0;
    if (now < cdEnd)   { this.log(`⏳ КД: ${Math.ceil((cdEnd - now) / 1000)}с`); return; }
    if (now < buffEnd) { this.log(`⏳ Действует: ${Math.ceil((buffEnd - now) / 1000)}с`); return; }

    // Check ammo slots first, then cargo
    const inv = this.inventory || [];
    const _ammoSlot = (this.ammoSlots || []).find(s => s.type === type && s.count > 0);
    if (_ammoSlot) {
      _ammoSlot.count--;
      if (_ammoSlot.count <= 0) { _ammoSlot.type = null; _ammoSlot.count = 0; }
    } else {
      if (countConsumableInInventory(inv, type) <= 0) { this.log('❌ Расходник закончился'); return; }
      removeConsumableFromInventory(inv, type, 1);
    }

    switch (type) {
      case 'repair_pack': {
        this.skillCooldowns[barKey] = now + this._skillCooldownMs(barKey);
        const heal = Math.round(this.player.maxHull * 0.30);
        this.player.hull = Math.min(this.player.maxHull, this.player.hull + heal);
        this.log(`🔧 Ремкомплект: +${heal} HP`);
        this.hitFlash(this.player.x, this.player.y, true);
        this.groupSystem?.recordHeal(heal);
        break;
      }
      case 'speed_boost': {
        const BUFF_DUR = 15000, CD_MS = this._skillCooldownMs(barKey);
        this._consBuffEndTimes[barKey] = now + BUFF_DUR;
        this._speedBoostMult = 1.5;
        this.player.recomputeStats();
        this.log('⚡ Ускоритель: +50% скорость, 15с');
        this.muzzleFlash(this.player.x, this.player.y, 0xffee44);
        this._speedBoostTimer = this.time.delayedCall(BUFF_DUR, () => {
          this._speedBoostMult = 1.0;
          if (this.player?.alive) this.player.recomputeStats();
          this._speedBoostTimer = null;
          this._consBuffEndTimes[barKey] = 0;
          this.skillCooldowns[barKey] = this.time.now + CD_MS;
          this.log('⚡ Ускорение завершено');
        });
        break;
      }
      case 'scanner_pulse': {
        const BUFF_DUR = 20000, CD_MS = this._skillCooldownMs(barKey);
        this._consBuffEndTimes[barKey] = now + BUFF_DUR;
        const baseR = Math.round(BASE_SCAN_RADIUS * (1 + (this.skillLevels?.scanner_boost || 0) * 0.20));
        this.scanRadius = baseR * 2;
        this.log('📡 Сканер-импульс: радиус ×2, 20с');
        this.muzzleFlash(this.player.x, this.player.y, 0x44ddff);
        this._scanPulseTimer = this.time.delayedCall(BUFF_DUR, () => {
          this.scanRadius = baseR;
          this._scanPulseTimer = null;
          this._consBuffEndTimes[barKey] = 0;
          this.skillCooldowns[barKey] = this.time.now + CD_MS;
          this.log('📡 Сканер нормализован');
        });
        break;
      }
      case 'emergency_warp': {
        const sec = SECTORS[galaxy.current];
        if (sec.isDungeon) { this.log('🚫 Варп недоступен здесь'); addConsumableToInventory(inv, type, 1, this._cargoMax()); return; }
        this.skillCooldowns[barKey] = now + this._skillCooldownMs(barKey);
        let cx, cy;
        if (sec.pvp) {
          const homeBase = this.homeBases?.find(hb => hb.corp === this.playerCorp);
          cx = homeBase?.x ?? this.worldWidth / 2;
          cy = homeBase?.y ?? this.worldHeight / 2;
        } else {
          cx = this.worldWidth / 2; cy = this.worldHeight / 2;
        }
        this.player.sprite.setPosition(cx, cy);
        if (this.player.sprite.body) this.player.sprite.body.reset(cx, cy);
        this.muzzleFlash(cx, cy, 0x8888ff);
        this.log(sec.pvp ? '🌀 Варп: телепорт к родной базе' : '🌀 Аварийный прыжок: телепорт на базу');
        break;
      }
    }
    this._saveState?.();
  }

  _doOverchargeShot(now, cd) {
    this.skillCooldowns.overcharge_shot = now + cd;
    this._overchargeActive = true;
    this.log('⚡ Перегрузочный выстрел — следующий выстрел ×2');
    this.muzzleFlash(this.player.x, this.player.y, 0xff8800);
  }

  _doSalvo(now, cd) {
    this.skillCooldowns.salvo = now + cd;
    // mixed: laser timing (3×80ms), cannon-only: 5×100ms, laser-only: 3×80ms
    const p = this.player;
    const shots = p.hasLaser ? 3 : 5;
    const delay = p.hasLaser ? 80 : 100;
    this.log('🚀 Залп!');
    for (let i = 0; i < shots; i++) {
      this.time.delayedCall(i * delay, () => {
        if (this.target?.alive && this.player.alive) this.firePlayerWeapon();
      });
    }
  }

  _doEmergencyRepair(now, cd) {
    this.skillCooldowns.emergency_repair = now + cd;
    const heal = Math.round(this.player.maxHull * 0.30);
    this.player.hull = Math.min(this.player.maxHull, this.player.hull + heal);
    this.log(`💉 Ремонт: +${heal} HP`);
    this.hitFlash(this.player.x, this.player.y, true);
    this.groupSystem?.recordHeal(heal);
  }

  _doShieldBurst(now, cd) {
    this.skillCooldowns.shield_burst = now + cd;
    const boost = Math.round(this.player.maxShield * 1.20);
    this.player.shield = Math.min(this.player.maxShield, this.player.shield + boost);
    this.log(`🛡 Всплеск щита: +${boost}`);
    this.hitFlash(this.player.x, this.player.y, false);
  }

  _doStealthSprint(now, cd) {
    if (this._stealthEndTime > now) return;
    const dur = Math.round(8000 * (this.player.stealthDurMult ?? 1));
    this._stealthEndTime = now + dur;
    this._consBuffEndTimes.stealth_sprint = now + dur;
    this._stealthMult = 1.30;
    this.player.recomputeStats();
    this.player.sprite.setAlpha(0.35);
    this.log(`👻 Стелс-рывок: +30% скорость, ${Math.round(dur / 1000)}с`);
    this.time.delayedCall(dur, () => {
      this._stealthMult = 1.0;
      if (this.player?.alive) {
        this.player.recomputeStats();
        this.player.sprite.setAlpha(1.0);
      }
      this._stealthEndTime = 0;
      this._consBuffEndTimes.stealth_sprint = 0;
      this.skillCooldowns.stealth_sprint = this.time.now + cd;
      this.log('👻 Стелс завершён');
    });
  }

  _doBerserker(lv, now, cd) {
    const thresholds = [0.40, 0.35, 0.30, 0.25];
    const boosts     = [0.25, 0.35, 0.50, 0.60];
    const thresh = thresholds[lv - 1] ?? 0.40;
    const boost  = boosts[lv - 1]     ?? 0.25;
    if (this.player.hull / this.player.maxHull > thresh) {
      this.log(`💀 Берсерк: нужно HP < ${thresh * 100}%`); return;
    }
    const BUFF_DUR = 15000;
    this._berserkerBuff = { endTime: now + BUFF_DUR, mult: 1 + boost };
    this._consBuffEndTimes.berserker = now + BUFF_DUR;
    this.log(`💀 Берсерк: +${Math.round(boost * 100)}% урон, 15с`);
    this.hitFlash(this.player.x, this.player.y, true);
    this.time.delayedCall(BUFF_DUR, () => {
      this._berserkerBuff = null;
      this._consBuffEndTimes.berserker = 0;
      this.skillCooldowns.berserker = this.time.now + cd;
      this.log('💀 Берсерк завершён');
    });
  }

  // ── Ship active skills ─────────────────────────────────────────────────

  _doShipVolleyBlast(now, cd) {
    const p = this.player;
    if (!p?.alive) return;
    if (!this.target?.alive) { this.log('⚠ Нет цели для залпа'); return; }
    this.skillCooldowns['ship:helion_volley'] = now + cd;
    this._volleyBlastMult = 1.25;
    this.firePlayerWeapon();
    this.log('💥 Залповый огонь!');
    this.hitFlash(p.x, p.y, false);
  }

  _doShipArgosyRepair(now, cd) {
    const p = this.player;
    if (!p?.alive) return;
    this.skillCooldowns['ship:argosy_repair'] = now + cd;
    const heal = Math.round(p.maxHull * 0.25);
    p.hull = Math.min(p.maxHull, p.hull + heal);
    p.lastDamageAt = 0;
    this.log(`🔧 Ремонт: +${heal} HP`);
    this.groupSystem?.recordHeal(heal);
  }

  _doShipDrifterJump(now, cd) {
    const p = this.player;
    if (!p?.alive) return;
    this.skillCooldowns['ship:drifter_jump'] = now + cd;
    const dist = 700;
    const destX = Phaser.Math.Clamp(p.sprite.x + Math.cos(p.facing) * dist, 50, this.worldWidth - 50);
    const destY = Phaser.Math.Clamp(p.sprite.y + Math.sin(p.facing) * dist, 50, this.worldHeight - 50);
    p.invulnerable = true;
    p.sprite.setAlpha(0.25);
    p.waypoint = null;
    p.speed = 0;
    p.sprite.setPosition(destX, destY);
    if (p.sprite.body) p.sprite.body.reset(destX, destY);
    this.time.delayedCall(250, () => {
      if (p?.alive) {
        p.invulnerable = false;
        this.tweens.add({ targets: p.sprite, alpha: 1, duration: 150 });
      }
    });
    this.log('⇗ Фазовый прыжок!');
  }

  _doShipDroverScan(now, cd) {
    const p = this.player;
    if (!p?.alive) return;
    this.skillCooldowns['ship:drover_scan'] = now + cd;
    this._consBuffEndTimes['ship:drover_scan'] = now + 30000;
    this._scannerActive = true;

    // Expanding pulse sweep — world-space graphics
    const ring = this.add.graphics().setDepth(60);
    const snapX = p.sprite.x, snapY = p.sprite.y;
    const maxR = Math.max(this.worldWidth, this.worldHeight);
    let elapsed = 0;
    const expandMs = 1000;
    this.time.addEvent({
      delay: 16, repeat: Math.ceil(expandMs / 16),
      callback: () => {
        elapsed += 16;
        const frac = Math.min(1, elapsed / expandMs);
        const r = frac * maxR;
        const alpha = (1 - frac) * 0.75;
        ring.clear();
        ring.lineStyle(3, 0xab47bc, alpha);
        ring.strokeCircle(snapX, snapY, r);
        ring.lineStyle(1, 0xce93d8, alpha * 0.45);
        ring.strokeCircle(snapX, snapY, r + 14);
      }
    });
    this.time.delayedCall(expandMs + 50, () => ring.destroy());
    this.log('🔍 Глубокий сканер (30 с)');
    this.time.delayedCall(30000, () => {
      this._scannerActive = false;
      this._consBuffEndTimes['ship:drover_scan'] = 0;
    });
  }

  _doShipWispRecall(now, cd) {
    const p = this.player;
    if (!p?.alive) return;
    const sec = SECTORS[galaxy.current];
    if (sec?.isDungeon) { this.log('⚠ Телепорт недоступен в данже'); return; }
    if (!this.homeBases?.length) { this.log('⚠ В секторе нет базы'); return; }
    const underPvpAttack = (this.mobs || []).some(m => m.alive && m.isPlayerMob && m.state !== 'idle');
    if (underPvpAttack) { this.log('⚠ Телепорт заблокирован: атака противника'); return; }
    this.skillCooldowns['ship:wisp_recall'] = now + cd;
    const base = this.homeBases[0];
    const bx = base.x ?? this.worldWidth / 2;
    const by = base.y ?? this.worldHeight / 2;
    p.sprite.setAlpha(0);
    p.sprite.setPosition(bx, by);
    if (p.sprite.body) p.sprite.body.reset(bx, by);
    p.waypoint = null; p.speed = 0;
    this.cameras.main.centerOn(bx, by);
    this.tweens.add({ targets: p.sprite, alpha: 1, duration: 350 });
    this.log('⤴ Телепорт на базу!');
  }

  _doShipStilettoAfterburner(now, cd) {
    const p = this.player;
    if (!p?.alive) return;
    this.skillCooldowns['ship:stiletto_afterburner'] = now + cd;
    this._consBuffEndTimes['ship:stiletto_afterburner'] = now + 4000;
    p.baseSpeed = Math.round(p.baseSpeed * 2);
    this.log('🔥 Форсаж! (+100% скорость, 4 с)');
    this.time.delayedCall(4000, () => {
      this._consBuffEndTimes['ship:stiletto_afterburner'] = 0;
      if (p?.alive) p.recomputeStats();
    });
  }

  _doShipAnvilLockdown(now, cd) {
    const p = this.player;
    if (!p?.alive) return;
    this.skillCooldowns['ship:anvil_lockdown'] = now + cd;
    this._consBuffEndTimes['ship:anvil_lockdown'] = now + 10000;
    p._lockdownMult = 0.40;
    this.log('🛡 Уплотнение! (-60% урон, 10 с)');
    this.time.delayedCall(10000, () => {
      this._consBuffEndTimes['ship:anvil_lockdown'] = 0;
      if (p) p._lockdownMult = null;
    });
  }

  _doShipAegisDome(now, cd) {
    const p = this.player;
    if (!p?.alive) return;
    this.skillCooldowns['ship:aegis_dome'] = now + cd;
    this._consBuffEndTimes['ship:aegis_dome'] = now + 6000;
    p.shield = p.maxShield;
    this._aegisDomeEndTime = now + 6000;
    this.log('⚡ Щитовой купол! (корпус защищён, 6 с)');
    this.time.delayedCall(6000, () => {
      this._consBuffEndTimes['ship:aegis_dome'] = 0;
      this._aegisDomeEndTime = 0;
    });
  }

  _doShipPhantomCloak(now, cd) {
    const p = this.player;
    if (!p?.alive) return;
    if (now - (p.lastAttackAt || 0) < 3000) {
      this.log('⚠ Маскировка: 3 с без атаки');
      return;
    }
    this.skillCooldowns['ship:phantom_cloak'] = now + cd;
    this._consBuffEndTimes['ship:phantom_cloak'] = now + 10000;
    p.baseSpeed = Math.round(p.baseSpeed * 1.3);
    p.sprite.setAlpha(0.28);
    this._phantomCloakEndTime = now + 10000;
    this.log('👻 Маскировка! (+30% скорость, 10 с)');
    this.time.delayedCall(10000, () => this._breakPhantomCloak());
  }

  _breakPhantomCloak() {
    if (!this._phantomCloakEndTime) return;
    this._phantomCloakEndTime = 0;
    this._consBuffEndTimes['ship:phantom_cloak'] = 0;
    const p = this.player;
    if (p?.alive) { p.sprite.setAlpha(1); p.recomputeStats(); }
    this.log('👁 Маскировка снята');
  }

  gainXp(amount) {
    if (this.pilotLevel >= MAX_LEVEL || amount <= 0) return;
    const _premiumXp = this.premium ? 1.10 : 1.0;
    this.pilotXp += Math.round(amount * (this.player?.xpBonusMod ?? 1) * _premiumXp);
    const newLevel = levelInfo(this.pilotXp).level;
    while (newLevel > this.pilotLevel && this.pilotLevel < MAX_LEVEL) {
      this.pilotLevel++;
      this.log(i18n.t('log.levelup', { lvl: this.pilotLevel }));
    }
    // Unlock missions that require the new level
    if (this.missionState) {
      for (const m of MISSIONS) {
        const st = this.missionState[m.id];
        if (st?.status === 'locked' && (m.minLevel ?? 1) <= this.pilotLevel) {
          st.status = m.defaultStatus;
          this.log(`Миссия разблокирована: ${m.title}`);
        }
      }
    }
  }

  gainHonor(amount) {
    if (amount <= 0) return;
    this.pilotHonor = (this.pilotHonor || 0) + amount;
    // Small corp rep bonus proportional to honor earned
    this.gainCorpRep(amount * 0.0000004);
    this.log(`⚔️ +${amount} честь`);
  }

  gainCorpRep(amount) {
    if (amount <= 0) return;
    this.corpRep = Math.min(1.0, (this.corpRep || 0) + amount);
  }
  mobAt(wx, wy) {
    let best = null, bestD = Infinity;
    for (const m of this.mobs) { if (!m.alive) continue; const d = Phaser.Math.Distance.Between(wx, wy, m.x, m.y); if (d < m.tpl.displaySize * 0.8 && d < bestD) { best = m; bestD = d; } }
    return best;
  }
  lootAt(wx, wy) {
    let best = null, bestD = Infinity;
    for (const l of this.loot) { if (!l.alive) continue; const d = Phaser.Math.Distance.Between(wx, wy, l.x, l.y); if (d < 40 && d < bestD) { best = l; bestD = d; } }
    return best;
  }
  depositAt(wx, wy) {
    for (const d of this.plasmateDeposits) { if (d.alive && Phaser.Math.Distance.Between(wx, wy, d.x, d.y) < 50) return d; }
    return null;
  }
  baseAt(wx, wy) {
    let best = null, bestD = Infinity;
    for (const b of this.miningBases) { const d = Phaser.Math.Distance.Between(wx, wy, b.x, b.y); if (d < 120 && d < bestD) { best = b; bestD = d; } }
    return best;
  }
  cancelCollect() { this.collectTarget = null; this.collectTimer = 0; }

  dropItemAtPlayer(item) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 70 + Math.random() * 50;
    const loot  = new Loot(this, this.player.x + Math.cos(angle) * dist, this.player.y + Math.sin(angle) * dist, item, 'common');
    this.loot.push(loot);
  }
  _canOpenBase() {
    const sec = SECTORS[galaxy.current];
    // Данжи, арены, boss-карта (R-1-boss) — isDungeon:true, доступа нет
    if (sec.isDungeon) return false;
    // PvP — доступ только рядом с домашней базой корпорации
    if (sec.pvp) {
      return this.homeBases.some(b =>
        Phaser.Math.Distance.Between(this.player.x, this.player.y, b.x, b.y) < 380
      );
    }
    // Обычные секторы — в пределах безопасной зоны у базы
    return this.inSafeZone(this.player.x, this.player.y);
  }

  _exitToSpace() {
    this.selectTarget(null);
    this.isFiring = false;
    this.atBase = false;
    if (galaxy.current === 'shadow_arena') { this.exitShadowBattle(); return; }
    for (const o of ['GarageScene','CargoScene','MapScene','MissionsScene','ShopScene','CorpScene','BaseMenuScene','SkillScene','ClanScene','ShadowBattleScene','SettingsScene'])
      if (this._sceneExists(o) && this.scene.isActive(o)) this.scene.stop(o);
  }

  // Safe existence check — avoids "Scene key not found" on Phaser 4 isActive/stop/launch.
  _sceneExists(key) {
    return this.sys.game.scene.scenes.some(s => s.sys?.settings?.key === key);
  }

  toggleOverlay(key, data) {
    document.getElementById('sd-guild-search')?.remove(); // always clean up HTML overlay on any scene switch
    const overlays = ['GarageScene', 'CargoScene', 'MapScene', 'MissionsScene', 'ShopScene', 'CorpScene', 'ClanScene', 'SkillScene', 'ShadowBattleScene', 'SettingsScene'];
    for (const o of overlays) { if (o !== key && this._sceneExists(o) && this.scene.isActive(o)) this.scene.stop(o); }
    if (!this._sceneExists(key)) return;
    if (this.scene.isActive(key)) this.scene.stop(key); else this.scene.launch(key, data);
  }
  selectTarget(mob) {
    this.target = mob;
    if (this._targetFx?.active) { this.vfx?.stopLoop(this._targetFx); this._targetFx = null; }
    if (!mob) { this.isFiring = false; return; }
    this._targetFx = this.vfx?.playLoop('targeting_reticle', mob.x, mob.y, { scale: 0.18, depth: 46 });
  }
  cycleTarget() {
    if (this.botPilot?.alive) { this.selectTarget(this.botPilot); this.isFiring = true; return; }
    const alive = this.mobs.filter((m) => m.alive).sort((a, b) => Phaser.Math.Distance.Between(this.player.x, this.player.y, a.x, a.y) - Phaser.Math.Distance.Between(this.player.x, this.player.y, b.x, b.y));
    if (!alive.length) { this.target = null; return; }
    const idx = alive.indexOf(this.target); this.target = alive[(idx + 1) % alive.length];
  }
  firePlayerWeapon() {
    const p = this.player;
    const isOC = this._overchargeActive;
    if (isOC) this._overchargeActive = false;
    const isVolley = this._volleyBlastMult > 0;
    const volleyMult = isVolley ? this._volleyBlastMult : 1.0;
    if (isVolley) this._volleyBlastMult = 0;
    let skillMult = isOC ? 2.0 : isVolley ? volleyMult : 1.0;
    if (this._berserkerBuff && this.time.now < this._berserkerBuff.endTime) skillMult *= this._berserkerBuff.mult;

    const isAdmin = p.ship?.tier === 'ADMIN';

    if (!p.hasCannon && !p.hasLaser) {
      if (!isAdmin) this._warnThrottle('no_weapon', 'Не установлено вооружение');
      return;
    }

    const cannonCount = p.hasCannon
      ? (this.equipped?.weapon || []).filter(w => w && w.type !== 'laser').length
      : 0;

    let blocked = false;
    if (!isAdmin && cannonCount > 0 && !this._checkAmmo('cannon', cannonCount)) blocked = true;
    if (!isAdmin && p.hasLaser && !this._checkAmmo('laser', 1)) blocked = true;
    if (blocked) { this._warnThrottle('no_ammo', 'Недостаточно боеприпасов'); return; }

    if (p.hasCannon) this._fireCannon(skillMult, isOC, cannonCount);
    if (p.hasLaser)  this._fireLaser(skillMult, isOC);
  }

  _checkAmmo(type, count) {
    const slots = this.ammoSlots || [];
    if (type === 'cannon') {
      const avail = slots.reduce((s, sl) =>
        s + ((sl.type === 'ammo_plasma_elite' || sl.type === 'ammo_plasma') ? sl.count : 0), 0);
      return avail >= count;
    }
    if (type === 'laser') return slots.some(s => s.type === 'ammo_laser' && s.count > 0);
    return true;
  }

  _warnThrottle(key, msg) {
    const now = this.time.now;
    this._warnTimes = this._warnTimes || {};
    if ((this._warnTimes[key] || 0) + 3000 > now) return;
    this._warnTimes[key] = now;
    this.log(msg);
  }

  _fireCannon(skillMult, isOC, cannonCount = 1) {
    const t = this.target, p = this.player;
    if (!t?.alive || !p.alive) return;

    if (Math.random() >= (p.cannonAccuracy ?? 0.90)) {
      this.muzzleFlash(p.x, p.y, 0x8fe6ff);
      return;
    }

    const isCrit    = p.critChance > 0 && Math.random() < p.critChance;
    const ammoMult  = this._consumeAmmo('cannon', cannonCount);
    const dmg       = Math.round(p.cannonDamage * skillMult * ammoMult * (isCrit ? (p.critMult ?? 2) : 1));
    const color     = isOC ? 0xff8800 : ammoMult > 1 ? 0xff6d00 : isCrit ? 0xffee44 : PROJECTILE.playerColor;
    // Predictive aim: lead the target based on its current velocity.
    const aimPt = _leadTarget(p.x, p.y, t.x, t.y,
      (t.sprite?.body?.velocity?.x ?? 0) / DPR,
      (t.sprite?.body?.velocity?.y ?? 0) / DPR,
      PROJECTILE.speed);
    this.projectiles.push(new Projectile(this, 'player', p.x, p.y, aimPt.x, aimPt.y, t, dmg, p.weaponPenetration, color, 160 * Math.PI / 180));
    this.muzzleFlash(p.x, p.y, isOC ? 0xff8800 : isCrit ? 0xffee44 : 0x8fe6ff);
    if (isCrit || isOC) {
      const label = isOC ? '⚡ УДАР!' : 'КРИТ!';
      const clr   = isOC ? '#ff8800' : '#ffee44';
      const txt = this.add.text(t.x, t.y - 40, label,
        { fontFamily: 'Orbitron', fontSize: '14px', color: clr, fontStyle: 'bold', resolution: 2 })
        .setOrigin(0.5).setDepth(71);
      this.tweens.add({ targets: txt, y: t.y - 80, alpha: 0, duration: 600, ease: 'Quad.easeOut', onComplete: () => txt.destroy() });
    }
  }

  // Hitscan laser: instant hit, accuracy check, shield/hull multipliers, amber VFX beam.
  _fireLaser(skillMult = 1, isOC = false) {
    const t = this.target, p = this.player;
    if (!t?.alive || !p.alive) return;

    const hit    = Math.random() < (p.laserAccuracy ?? 0.80);
    const isCrit = hit && p.critChance > 0 && Math.random() < p.critChance;

    // Beam visual: OC=thick bright-yellow, crit=medium-yellow, normal=amber, miss=dim
    const beamColor = isOC ? 0xffcc00 : isCrit ? 0xffff44 : 0xffaa00;
    const beamWidth = isOC ? 12 : isCrit ? 6 : 3;
    this._laserBeam(p.x, p.y, t.x, t.y, beamColor, hit ? 1.0 : 0.25, beamWidth);
    this.muzzleFlash(p.x, p.y, beamColor);
    // Animated muzzle discharge — beam1 rotated toward target
    const _beamAngle = Math.atan2(t.y - p.y, t.x - p.x);
    const _beamSpr = this.vfx?.play('laser_beam1', p.x, p.y, { scale: isOC ? 0.22 : isCrit ? 0.17 : 0.13, depth: 64 });
    if (_beamSpr) _beamSpr.setRotation(_beamAngle);

    if (!hit) return;

    this._consumeAmmo('laser');
    const dmg = Math.round(p.laserDamage * skillMult * (isCrit ? (p.critMult ?? 2) : 1));
    const opts = { shieldMult: p.weaponShieldMult ?? 0.90, hullMult: p.weaponHullMult ?? 1.30, ignoreMovEvasion: true };
    const res = t.takeDamage(dmg, p.weaponPenetration, opts);

    this.vfx?.play('laser_beam2', t.x, t.y, { scale: isOC ? 0.22 : 0.13, depth: 67 });
    if (res.dodged) { this.showDodge(t.x, t.y); return; }
    const toHull = (res.hullHit || 0) > 0;
    this.hitFlash(t.x, t.y, toHull);
    if (toHull && this._onScreen(t.x, t.y)) this.vfx?.play('hull_hit', t.x, t.y, { scale: 0.15, depth: 67 });
    this.showDamage(t.x, t.y, res);
    const laserDmgDone = (res.shieldHit || 0) + (res.hullHit || 0);
    if (laserDmgDone > 0) this.groupSystem?.recordDamage(laserDmgDone);
    if (res.killed) {
      if (t.ghostBoss) t.hull = 1; // не убиваем призрака локально
      else this.onMobKilled(t);
      return;
    }
    if (isOC || isCrit) {
      const label = isOC ? '⚡ УДАР!' : 'КРИТ!';
      const clr   = isOC ? '#ffcc00' : '#ffff44';
      const txt = this.add.text(t.x, t.y - 40, label,
        { fontFamily: 'Orbitron', fontSize: '14px', color: clr, fontStyle: 'bold', resolution: 2 })
        .setOrigin(0.5).setDepth(71);
      this.tweens.add({ targets: txt, y: t.y - 80, alpha: 0, duration: 600, ease: 'Quad.easeOut', onComplete: () => txt.destroy() });
    }
  }

  // Consume ammo charges. For cannon: elite first, then regular; returns proportional mult (1.0–1.2).
  _consumeAmmo(weaponType, count = 1) {
    const slots = this.ammoSlots;
    if (!slots?.length) return 1.0;
    let slotEmptied = false;
    if (weaponType === 'cannon') {
      let rem = count, eliteUsed = 0;
      for (const s of slots) {
        if (rem <= 0) break;
        if (s.type === 'ammo_plasma_elite' && s.count > 0) {
          const take = Math.min(s.count, rem);
          s.count -= take; rem -= take; eliteUsed += take;
          if (s.count <= 0) { s.type = null; s.count = 0; slotEmptied = true; }
        }
      }
      for (const s of slots) {
        if (rem <= 0) break;
        if (s.type === 'ammo_plasma' && s.count > 0) {
          const take = Math.min(s.count, rem);
          s.count -= take; rem -= take;
          if (s.count <= 0) { s.type = null; s.count = 0; slotEmptied = true; }
        }
      }
      if (slotEmptied) this._saveState();
      return count > 0 ? 1.0 + 0.2 * (eliteUsed / count) : 1.0;
    } else if (weaponType === 'laser') {
      const slot = slots.find(s => s.type === 'ammo_laser' && s.count > 0);
      if (slot) { slot.count--; if (slot.count <= 0) { slot.type = null; slot.count = 0; slotEmptied = true; } }
    }
    if (slotEmptied) this._saveState();
    return 1.0;
  }

  // Try to add item amount to matching ammo slots (any item type). Returns how many were added.
  _tryAddToAmmoSlots(type, amount) {
    const slots = this.ammoSlots;
    if (!slots?.length) return 0;
    const def = CONSUMABLES[type];
    if (!def) return 0;
    const maxPer = def.maxPerSlot;
    let rem = amount;
    for (const slot of slots) {
      if (rem <= 0) break;
      if (slot.type === type && slot.count < maxPer) {
        const add = Math.min(maxPer - slot.count, rem);
        slot.count += add; rem -= add;
      }
    }
    for (const slot of slots) {
      if (rem <= 0) break;
      if (!slot.type) {
        const add = Math.min(maxPer, rem);
        slot.type = type; slot.count = add; rem -= add;
      }
    }
    return amount - rem;
  }

  _laserBeam(x1, y1, x2, y2, color, alpha, width = 3) {
    const g = this.add.graphics().setDepth(65).setBlendMode('ADD');
    const line = () => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.strokePath(); };
    // Outer glow — wide, dim
    g.lineStyle(width * 6, color, 0.12 * alpha); line();
    // Mid halo
    g.lineStyle(width * 2.5, color, 0.35 * alpha); line();
    // Bright core
    g.lineStyle(Math.max(1, width * 0.6), 0xffffff, 0.90 * alpha); line();
    this.tweens.add({ targets: g, alpha: 0, duration: 200, ease: 'Expo.easeOut', onComplete: () => g.destroy() });
  }
  fireMobWeapon(mob, tx, ty, victim = this.player, extraOpts = {}) {
    const pType = mob.tpl.projectileType || 'plasma';
    const cfg   = PROJ_TYPES[pType] || PROJ_TYPES.plasma;

    // void — хитскан: мгновенный луч, урон без снаряда
    if (cfg.hitscan) {
      const pen = cfg.penetration ?? 0.6;
      const res = victim.takeDamage(mob.damage, pen, { ignoreMovEvasion: true, ...extraOpts });
      this._laserBeam(mob.x, mob.y, victim.x, victim.y, 0xce93d8, 0.85, 4);
      this.onProjectileHit({ owner: 'mob', victim, type: pType, effect: null, effectCfg: cfg }, res);
      return;
    }

    // ion — 3 болта в ±12° веере, каждый несёт 35% урона
    if (cfg.spread) {
      const baseAng = Math.atan2(ty - mob.y, tx - mob.x);
      const turnRate = mob.isBoss ? (150 * Math.PI / 180) : (70 * Math.PI / 180);
      for (const off of [-0.21, 0, 0.21]) {
        const ang = baseAng + off;
        const ex = mob.x + Math.cos(ang) * 60;
        const ey = mob.y + Math.sin(ang) * 60;
        this.projectiles.push(new Projectile(this, 'mob', mob.x, mob.y, ex, ey, victim, mob.damage * 0.35, 0.05, cfg.color, turnRate, pType));
      }
      this.muzzleFlash(mob.x, mob.y, 0x80d8ff);
      return;
    }

    // Остальные типы: один болт с самонаведением
    const turnRate = mob.isBoss ? (180 * Math.PI / 180) : (90 * Math.PI / 180);
    const pen = cfg.penetration ?? 0.05;
    this.projectiles.push(new Projectile(this, 'mob', mob.x, mob.y, tx, ty, victim, mob.damage, pen, cfg.color, turnRate, pType));
    const flashColor = { plasma: 0xff8a7a, acid: 0x76ff03, grav: 0xffb74d, emp: 0x4dd0e1 }[pType] ?? 0xff8a7a;
    this.muzzleFlash(mob.x, mob.y, flashColor);
  }
  muzzleFlash(x, y, color) {
    const f = this.add.image(x, y, 'glow').setTint(color).setBlendMode(Phaser.BlendModes.ADD).setDepth(61).setDisplaySize(10, 10);
    this.tweens.add({ targets: f, displayWidth: 48, displayHeight: 48, alpha: 0, duration: 110, ease: 'Quad.easeOut', onComplete: () => f.destroy() });
  }
  hitFlash(x, y, toHull) {
    const f = this.add.image(x, y, 'glow').setTint(toHull ? 0xffa040 : 0x8fe6ff).setBlendMode(Phaser.BlendModes.ADD).setDepth(67).setDisplaySize(16, 16);
    this.tweens.add({ targets: f, displayWidth: 58, displayHeight: 58, alpha: 0, duration: 170, ease: 'Quad.easeOut', onComplete: () => f.destroy() });
  }
  onProjectileHit(proj, res) {
    if (proj.owner === 'player') {
      const m = proj.victim;
      if (res.dodged) { this.showDodge(m.x, m.y); return; }
      const toHull = (res.hullHit || 0) > 0;
      this.hitFlash(m.x, m.y, toHull);
      if (toHull && this._onScreen(m.x, m.y)) this.vfx?.play('hull_hit', m.x, m.y, { scale: 0.15, depth: 67 });
      this.showDamage(m.x, m.y, res);
      const dmgDone = (res.shieldHit || 0) + (res.hullHit || 0);
      if (dmgDone > 0) this.groupSystem?.recordDamage(dmgDone);
      if (res.killed) {
        if (m.ghostBoss) m.hull = 1; // не убиваем призрака — смерть придёт от сервера
        else this.onMobKilled(m);
      }
    } else {
      const hx = proj.victim?.x ?? this.player.x;
      const hy = proj.victim?.y ?? this.player.y;
      if (res?.dodged) { this.showDodge(hx, hy); return; }
      const toHull = (res?.hullHit || 0) > 0;
      this.hitFlash(hx, hy, toHull);
      if (toHull) this.vfx?.play('hull_hit', hx, hy, { scale: 0.15, depth: 67 });
      this.showDamage(hx, hy, res);
      if (proj.victim === this.player && !res?.dodged) {
        this._applyProjEffect(proj, hx, hy);
        if (res?.brokeShield) this.log(i18n.t('log.shield_down'));
        if (!this.player.alive) this.onPlayerKilled();
      }
    }
  }

  _applyProjEffect(proj, hx, hy) {
    const eff = proj.effect;
    const cfg = proj.effectCfg;
    const p   = this.player;
    if (!eff || !cfg) return;
    if (eff === 'dot') {
      p.dotDamage = proj.damage * (cfg.dotDmg ?? 0.5) / (cfg.dotSec ?? 2.0);
      p.dotTimer  = cfg.dotSec ?? 2.0;
      this.log('☣ Кислотное поражение!');
    } else if (eff === 'emp') {
      p.empMult  = cfg.slowMult ?? 0.45;
      p.empTimer = cfg.slowSec  ?? 2.0;
      this.log('⚡ ЭМИ-разряд! Скорость снижена.');
    } else if (eff === 'push') {
      // Гравпульс: отталкиваем игрока + замедляем
      const ang = Math.atan2(p.y - hy, p.x - hx);
      p.sprite.body.setVelocity(Math.cos(ang) * (cfg.pushDist ?? 180) * 3, Math.sin(ang) * (cfg.pushDist ?? 180) * 3);
      p.gravMult  = cfg.slowMult ?? 0.65;
      p.gravTimer = cfg.slowSec  ?? 1.5;
    }
  }
  onMobKilled(mob) {
    this.explosion(mob.x, mob.y, mob.isBoss ? 1.6 : 0.6);
    const name = i18n.t(mob.tpl.nameKey); const lvl = `${i18n.t('mob.level')}${mob.level}`;
    const lvlScale = 1 + 0.5 * (mob.level - 1);
    const _credMult = this.player?.creditBonusMod ?? 1;
    const credits = Math.round(mob.tpl.credits * lvlScale * _credMult / 5);
    const sec = SECTORS[galaxy.current];
    const isDung = sec?.isDungeon === true;
    const diff = isDung ? this._dungeonDiff() : null;
    const xp = Math.round(mob.tpl.xp * lvlScale * (diff?.xpMult ?? 1) / 60);
    this.log(i18n.t('log.killed', { name, lvl })); this.log(i18n.t('log.reward', { credits, xp }));
    this.credits = (this.credits || 0) + credits; this.gainXp(xp);
    if (this.target === mob) {
      this.target = null; this.isFiring = false;
      if (this._targetFx?.active) { this.vfx?.stopLoop(this._targetFx); this._targetFx = null; }
    }
    let sg;
    if (galaxy.current === 'R-1-boss') {
      // Боссовый данж: мобы 20-40 ⭐, Апофис 250-280 ⭐ (делится в группе через GroupSystem)
      sg = mob.isDungeonBoss
        ? Phaser.Math.Between(62, 70)
        : Phaser.Math.Between(5, 10);
    } else if (isDung) {
      const rawSg = rollStarGold(mob);
      sg = rawSg > 0 ? Math.round(rawSg * (diff?.goldMult ?? 1) / 2) : 0;
    } else {
      if (mob.isConfedBoss) {
        const sg_tpl = mob.tpl.starGold;
        sg = (sg_tpl && Phaser.Math.FloatBetween(0, 1) < 0.02)
          ? Phaser.Math.Between(sg_tpl.min, sg_tpl.max) : 0;
      } else if (mob.isSectorBoss) {
        const sg_tpl = mob.tpl.starGold;
        sg = (sg_tpl && Phaser.Math.FloatBetween(0, 1) < 0.08)
          ? Phaser.Math.Between(sg_tpl.min, sg_tpl.max) : 0;
      } else {
        sg = 0;
      }
    }
    // Данж-босс в группе: сервер распределяет золото, не начисляем локально
    const _grpKill = this.groupSystem;
    if (isDung && mob.isDungeonBoss && _grpKill?.inGroup) {
      _grpKill.bossKilled(sg);
      sg = 0;
    }
    // Охранник/минибосс в группе: лидер уведомляет остальных участников
    if (isDung && mob.isBossEscort && _grpKill?.inGroup && _grpKill.isLeader && mob._groupMobId !== undefined) {
      _grpKill.sendMobDied(mob._groupMobId);
    }
    if (sg > 0) { this.starGold = (this.starGold || 0) + sg; this.log(i18n.t('log.stargold', { amount: sg })); }

    // Модульный дроп — solo: всегда игроку. Группа (будущее): владелец = последний наносивший урон 30с без перерыва.
    const modDropChance = dropChance(mob) * (this.player?.dropChanceMult ?? 1) + (diff?.dropBonus ?? 0);
    if (isDung && !mob.isBoss && !mob.tpl.elite && !mob.isBossEscort) {
      // Обычный данж-моб (группа): 1 ящик → владелец урона (solo = всегда игрок)
      if (Phaser.Math.FloatBetween(0, 1) < modDropChance) {
        const lootItem = rollLootForMob(mob);
        this.loot.push(new Loot(this, mob.x, mob.y, lootItem, 'common'));
      }
    } else if (isDung && (mob.isBoss || mob.tpl.elite || mob.isBossEscort)) {
      // Босс/элита/минибосс (группа): каждый участник получает свой ящик; solo = 1 ящик
      if (Phaser.Math.FloatBetween(0, 1) < modDropChance) {
        const lootItem = mob.tpl.key === 'ancient_12' ? rollApophisLoot() : rollLootForMob(mob);
        const isLegendary = mob.tpl.key === 'ancient_12' || mob.tpl.key === 'argus_boss' || mob.isBoss;
        const lootTier = isLegendary ? 'legendary' : 'boss';
        const isPremium = lootItem.tier === 4 || lootItem.perk?.rarity === 'jackpot';
        this.loot.push(new Loot(this, mob.x, mob.y, lootItem, isPremium ? 'jackpot' : lootTier));
      }
    } else {
      // Обычный сектор — прежняя логика
      if (Phaser.Math.FloatBetween(0, 1) < dropChance(mob) * (this.player?.dropChanceMult ?? 1)) {
        const lootItem = mob.tpl.key === 'ancient_12' ? rollApophisLoot() : rollLootForMob(mob);
        const isLegendary = mob.tpl.key === 'ancient_12' || mob.tpl.key === 'argus_boss';
        const lootTier = isLegendary ? 'legendary' : (mob.isBoss || mob.tpl.elite) ? 'boss' : 'common';
        const isPremium = lootItem.tier === 4 || lootItem.perk?.rarity === 'jackpot'
          || lootItem.type === 'biomech_core' || lootItem.type === 'quantum_crystal' || lootItem.type === 'plasma_coil';
        this.loot.push(new Loot(this, mob.x, mob.y, lootItem, isPremium ? 'jackpot' : lootTier));
      }
    }

    const consDrop = rollConsumableDrop(mob);
    if (consDrop) {
      const ox = Phaser.Math.Between(-24, 24), oy = Phaser.Math.Between(-24, 24);
      this.loot.push(new Loot(this, mob.x + ox, mob.y + oy, consDrop, 'common'));
    }

    const ammoDrop = rollAmmoDrop(mob, isDung, this.dungeonDifficulty);
    if (ammoDrop) {
      const ox = Phaser.Math.Between(-24, 24), oy = Phaser.Math.Between(-24, 24);
      this.loot.push(new Loot(this, mob.x + ox, mob.y + oy, ammoDrop, 'common'));
    }

    // Платы и коннекторы с ГЛАВНОГО босса данжа — по таблице сложности
    if (isDung && mob.isDungeonBoss) {
      const diffKey = galaxy.current === 'R-1-boss' ? 'normal' : (this.dungeonDifficulty ?? 'normal');
      const dropCfg = DUNGEON_BOSS_DROPS[galaxy.current]?.[diffKey];
      if (dropCfg) {
        if (Phaser.Math.FloatBetween(0, 1) < dropCfg.boardChance) {
          this.boardInventory = this.boardInventory ?? [];
          this.boardInventory.push(rollBoard(dropCfg.boardTier));
          this.log(`Найдена плата расширения T${dropCfg.boardTier}`);
        }
        if (Phaser.Math.FloatBetween(0, 1) < dropCfg.connChance) {
          this.connectorInventory = this.connectorInventory ?? [];
          this.connectorInventory.push(rollConnector(dropCfg.connTier));
          this.log(`Найден коннектор T${dropCfg.connTier}`);
        }
      }
    } else if (!isDung) {
      // Вне данжа: старая логика (10% обычный / 35% босс)
      const boardChance = mob.isBoss ? 0.35 : 0.10;
      if (Phaser.Math.FloatBetween(0, 1) < boardChance) {
        const boardTier = mob.isBoss ? 2 : Math.max(1, Math.min(2, Math.ceil(mob.level / 20)));
        this.boardInventory = this.boardInventory ?? [];
        this.boardInventory.push(rollBoard(boardTier));
        this.log(`Найдена плата расширения T${boardTier}`);
      }
    }

    // Dungeon boss material drop (2.5%)
    if (mob.isBoss && isDung && Math.random() < 0.025) {
      const MATS = ['biomech_core', 'quantum_crystal', 'plasma_coil'];
      const matType = MATS[Math.floor(Math.random() * 3)];
      const matName = MATERIAL_NAMES[matType] || matType;
      if (this.clan) {
        this.clan.treasury = this.clan.treasury || {};
        this.clan.treasury[matType] = (this.clan.treasury[matType] || 0) + 1;
        const d = new Date();
        const ts = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}  ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        (this.clan.log = this.clan.log || []).unshift({ time: ts, text: `${this.playerName || 'Пилот'} добыл «${matName}» → казна`, color: '#ffd54f' });
        this.clan.log = this.clan.log.slice(0, 500);
        this._trackClanContrib(matType, 1);
        this.log(`💎 ${matName} → казна гильдии!`);
      } else {
        addConsumableToInventory(this.inventory, matType, 1, this._cargoMax());
        this.log(`💎 ${matName} (вступи в гильдию для вклада в казну)`);
      }
    }
    if (!mob.noRespawn && !SECTORS[galaxy.current]?.isDungeon) {
      if (mob.bossRef) {
        // эскорт босса: не респавнится сам — поднимается вместе с боссом
      } else if (mob.isSectorBoss) {
        this.time.delayedCall(300000, () => {
          if (!mob.alive) {
            mob.respawn();
            this.log(i18n.t('log.respawn', { name, lvl }));
            this.mobs.forEach(m => { if (m.bossRef === mob && !m.alive) m.respawn(); });
          }
        });
      } else if (mob.isConfedBoss) {
        this.time.delayedCall(300000, () => {
          if (!mob.alive) {
            const canRespawn = !sec?.pvp || this.miningBases?.some(b => b.corp === 'neutral');
            if (canRespawn) { mob.respawn(); this.log(i18n.t('log.respawn', { name, lvl })); }
          }
        });
      } else {
        this.time.delayedCall(60000, () => {
          if (!mob.alive) { mob.respawn(); this.log(i18n.t('log.respawn', { name, lvl })); }
        });
      }
    }
    // Mission hooks
    if (mob.tpl.key.startsWith('pirate')) this.advanceMission('daily_patrol', 0);
    if (mob.isDungeonBoss && galaxy.current === 'R-1-boss') {
      this.advanceMission('story_signal', 1);
      this.advanceMission('story_signal', 2);
      this._recordDungeonClearance('R-1-boss');
    }
    if (mob.isDungeonBoss && isDung && galaxy.current !== 'R-1-boss') {
      this._recordDungeonClearance(galaxy.current);
    }
    // Honor hooks
    if (mob.tpl.key === 'ancient_12') {
      // Apophysis: each participant earns honor equal to 1× level-50 player kill
      this.gainHonor(HONOR_PER_LVL50);
    }
    if ((sec?.pvp || sec?.isDungeon) && mob.isPlayerMob) {
      // Future PvP: honor scales with victim level
      this.gainHonor(Math.round(mob.level * HONOR_PER_LVL50 / 50));
    }
    if (sec?.isDungeon) this._checkDungeonBossDoor();
  }

  _trackClanContrib(type, amount) {
    if (!this.clan) return;
    const name = this.playerName || 'Пилот';
    this.clan.contributions = this.clan.contributions || {};
    const c = this.clan.contributions[name] = this.clan.contributions[name] || { biomech_core: 0, quantum_crystal: 0, plasma_coil: 0, credits: 0 };
    if (c[type] !== undefined) c[type] += amount;
  }

  // ── Mission system ───────────────────────────────────────────────────────
  initMissionState() {
    if (!this.missionState) this.missionState = {};
    for (const m of MISSIONS) {
      if (!this.missionState[m.id]) {
        const locked = (m.minLevel ?? 1) > (this.pilotLevel ?? 1);
        this.missionState[m.id] = {
          status: locked ? 'locked' : m.defaultStatus,
          objectives: m.objectives.map(() => ({ current: 0 })),
        };
      }
    }
    // Migrate old story_supply progress from previous session format
    if (this.missionProgress?.story_supply_collected != null) {
      const ss = this.missionState['story_supply'];
      if (ss) ss.objectives[0].current = this.missionProgress.story_supply_collected;
      delete this.missionProgress.story_supply_collected;
    }
    // Daily reset at midnight
    const nowMs = Date.now();
    if (!this.missionDailyReset || nowMs >= this.missionDailyReset) {
      const tomorrow = new Date(); tomorrow.setHours(24, 0, 0, 0);
      this.missionDailyReset = tomorrow.getTime();
      for (const m of MISSIONS) {
        if (m.type !== 'daily') continue;
        const locked = (m.minLevel ?? 1) > (this.pilotLevel ?? 1);
        this.missionState[m.id] = {
          status: locked ? 'locked' : m.defaultStatus,
          objectives: m.objectives.map(() => ({ current: 0 })),
        };
      }
    }
  }

  completeMission(id) {
    const m = MISSIONS.find(m => m.id === id);
    const state = this.missionState?.[id];
    if (!m || !state || state.status === 'completed') return;
    state.status = 'completed';
    this.credits = (this.credits || 0) + m.rewards.credits;
    this.gainXp(m.rewards.xp);
    if (m.rewards.stars > 0) this.starGold = (this.starGold || 0) + m.rewards.stars;
    this.gainCorpRep(0.01);
    this.log(`Миссия завершена: ${m.title}`);
    this.log(`+${m.rewards.credits} кр · +${m.rewards.xp} XP${m.rewards.stars > 0 ? ` · +${m.rewards.stars} ★` : ''}`);
  }

  advanceMission(id, objIdx, amount = 1) {
    const m = MISSIONS.find(m => m.id === id);
    const state = this.missionState?.[id];
    if (!m || !state || state.status !== 'active') return;
    const objDef = m.objectives[objIdx];
    const objState = state.objectives[objIdx];
    if (!objDef || !objState || objState.current >= objDef.total) return;
    objState.current = Math.min(objDef.total, objState.current + amount);
    const allDone = m.objectives.every((o, i) => state.objectives[i].current >= o.total);
    if (allDone) this.completeMission(id);
  }
  // ── Escort transport ─────────────────────────────────────────────────────
  _shouldSpawnEscort() {
    const escortM = MISSIONS.find(m => m.id === 'daily_escort');
    const escortTarget = getMissionSectorTarget(escortM, this.playerCorp ?? 'helios')?.key;
    if (!escortTarget || galaxy.current !== escortTarget) return false;
    const st = this.missionState?.['daily_escort'];
    return st?.status === 'active' && (st.objectives[1]?.current ?? 0) < 1;
  }

  _spawnEscortTransport() {
    if (this.escortTransport) return;
    const corpSector1 = { helios: 'helios_1', karax: 'karax_1', tides: 'tides_1' };
    const sector1Key  = corpSector1[this.playerCorp] ?? 'helios_1';
    const entranceGate = this.gates?.find(g => g.target === sector1Key);
    if (!entranceGate) return;

    const cx = this.worldWidth / 2, cy = this.worldHeight / 2;
    const dx = cx - entranceGate.x, dy = cy - entranceGate.y;
    const d  = Math.sqrt(dx * dx + dy * dy) || 1;
    const spawnX = entranceGate.x + (dx / d) * 250;
    const spawnY = entranceGate.y + (dy / d) * 250;
    const destX  = cx + (dx / d) * (-150);
    const destY  = cy + (dy / d) * (-150);

    // Hull scales to journey AND pilot level: wave 1 (20%→50% window) should kill an
    // unprotected transport. Mob damage scales as base × (1 + 0.5 × (level − 1)).
    const levelScale = 1 + 0.5 * ((this.pilotLevel ?? 1) - 1);
    const wave1Dps = [MOBS.swarm_03, MOBS.swarm_04]
      .reduce((s, m) => s + m.damage * m.fireRate * levelScale, 0);
    const journeyDist = Phaser.Math.Distance.Between(spawnX, spawnY, destX, destY);
    const hull = Math.max(800,
      Math.round(wave1Dps * (ESCORT_WAVE_AT[1] - ESCORT_WAVE_AT[0]) * (journeyDist / ESCORT_SPEED) * 1.1 * 2.25)
    );
    this.escortTransport = new EscortTransport(this, spawnX, spawnY, destX, destY, hull);
    this._escortMobs = [];
    // Ensure obj0 ("arrived in sector") is marked whether player jumped or was already here
    this.advanceMission('daily_escort', 0);
    this.log('Транспорт ждёт сопровождения — подлети к нему, чтобы начать.');
  }

  _spawnEscortWave(tx, ty, waveIdx) {
    const WAVES = [
      ['swarm_03', 'swarm_04'],
      ['swarm_04', 'swarm_05', 'swarm_04'],
      ['swarm_05', 'swarm_06', 'swarm_05'],
    ];
    const keys = WAVES[waveIdx] ?? WAVES[0];
    const sec = SECTORS[galaxy.current];
    const Lmin = sec?.lvlMin ?? 1;
    const Lmax = Math.min(50, sec?.lvlMax ?? 10);
    for (let i = 0; i < keys.length; i++) {
      const angle = (Math.PI * 2 / keys.length) * i;
      const spawnX = tx + Math.cos(angle) * 380;
      const spawnY = ty + Math.sin(angle) * 380;
      const mobLvl = Phaser.Math.Between(Lmin, Lmax);
      const mob = new Mob(this, MOBS[keys[i]], mobLvl, spawnX, spawnY, {});
      mob.noRespawn    = true;
      mob.escortTarget = this.escortTransport; // target transport, not player
      this.mobs.push(mob);
      this._escortMobs.push(mob);
    }
    this.log(`Корсары атакуют транспорт — волна ${waveIdx + 1}!`);
  }

  _updateEscort(dt) {
    if (!this.escortTransport) return;
    const et = this.escortTransport;
    et.update(dt);
    if (!et.alive) { this.escortTransport = null; this._escortMobs = null; return; }
  }

  _spawnEngineFx() {
    for (const fx of this.engineFxList) this.vfx.stopLoop(fx);
    this.engineFxList = [];
    const ship = this.player.ship;
    if (!ship) return;
    this._engineFxShipKey = ship.key;
    for (const _n of (ship.engines || [{ x: 0, y: 42 }])) {
      this.engineFxList.push(this.vfx.playLoop('engine_particle', this.player.x, this.player.y, { scale: 0.12, depth: 52 }));
    }
  }
  onPlayerKilled(killedByPlayer = false) {
    if (galaxy.current === 'shadow_arena') { this._endShadowBattle('lose'); return; }
    if (this.playerRespawning) return;
    this.playerRespawning = true;
    this.jumping = false;
    this.player.lockedRotation = false;
    // Cancel any in-progress jump animation so it doesn't hide/teleport the player after respawn
    if (this._jumpScaleTween) { this._jumpScaleTween.stop(); this._jumpScaleTween = null; }
    if (this._jumpVisTimer)   { this._jumpVisTimer.remove(false);   this._jumpVisTimer = null; }
    if (this._jumpTravelTimer){ this._jumpTravelTimer.remove(false); this._jumpTravelTimer = null; }
    this.player._restoreDisplaySize();
    const deathX = this.player.x, deathY = this.player.y;
    this.explosion(deathX, deathY, 1.1);
    this.log(i18n.t('log.you_died'));
    // PvP death: drop 5% plasmate as loot box; mob death: plasmate is safe
    if (killedByPlayer) {
      const totalP = totalPlasmateInInventory(this.inventory);
      if (totalP > 0) {
        const drop = Math.max(1, Math.floor(totalP * 0.05));
        removePlasmateFromInventory(this.inventory, drop);
        this.loot.push(new Loot(this, deathX, deathY, { type: 'plasmate', amount: drop }, 'boss'));
        this.log(i18n.t('log.plasmate_dropped', { amount: drop }));
      }
    }
    this.target = null;
    this.time.delayedCall(2000, () => this._showRepairDialog(deathX, deathY));
  }
  _showRepairDialog(deathX, deathY) {
    const REPAIR_COST = {
      wisp:     { credits: 0,       stars: 0 },
      stiletto: { credits: 50000,   stars: 0 },
      anvil:    { credits: 100000,  stars: 0 },
      phantom:  { credits: 300000,  stars: 0 },
      drover:   { credits: 150000,  stars: 0 },
      aegis:    { credits: 150000,  stars: 0 },
      helion:   { credits: 0,       stars: 3 },
      argosy:   { credits: 0,       stars: 3 },
      drifter:  { credits: 0,       stars: 3 },
    };
    const cam = this.cameras.main;
    const W = cam.width, H = cam.height;
    const tf = { fontFamily: 'Orbitron', resolution: UI_RES };

    const shipKey = this.activeShip || 'wisp';
    const raw = REPAIR_COST[shipKey] || { credits: 0, stars: 0 };
    const mult = this.player?.repairCostMult ?? 1;
    const baseCr = Math.round(raw.credits * mult);
    const baseSt = raw.stars > 0 ? Math.max(1, Math.round(raw.stars       * mult)) : 0;
    const spotCr = Math.round(raw.credits * 2 * mult);
    const spotSt = raw.stars > 0 ? Math.max(1, Math.round(raw.stars * 2   * mult)) : 0;

    const sec          = SECTORS[galaxy.current];
    const isPvp        = sec?.pvp === true;
    const isDungOrBoss = !!(sec?.isDungeon || sec?.personal);

    // Dungeon / boss-map deaths → eject to the parent sector (the one with the jumpgate to here).
    // personal sectors (shadow_arena) have no edges → fall back to corp home sector.
    const CORP_HOME  = { helios: 'helios_1', karax: 'karax_1', tides: 'tides_1' };
    const parentSecKey = isDungOrBoss
      ? (() => {
          const cands = neighbors(galaxy.current).filter(k => !SECTORS[k]?.isDungeon && !SECTORS[k]?.personal);
          return cands.find(k => k.startsWith(this.playerCorp + '_'))
              ?? cands[0]
              ?? CORP_HOME[this.playerCorp]
              ?? 'helios_1';
        })()
      : null;

    // Compute corp-base position within the parent sector, mirroring _spawnHomeBase() logic.
    const parentSec        = parentSecKey ? SECTORS[parentSecKey] : null;
    const parentIsDung     = parentSec?.isDungeon === true;
    const parentIsPersonal = parentSec?.personal === true;
    const parentScale      = parentSec?.pvp ? PVP_WORLD_SCALE : (parentIsDung || parentIsPersonal) ? 1.0 : 1.2;
    const parentW          = BASE_WORLD.width  * parentScale;
    const parentH          = BASE_WORLD.height * parentScale;

    let baseX, baseY;
    if (isDungOrBoss) {
      if (parentSec?.pvp) {
        // Use PVP_GATES layout to find this corp's base in the parent PvP sector
        const pvpLayout = PVP_GATES[parentSecKey] || {};
        const corpGateKey = Object.keys(pvpLayout).find(k => k.startsWith(this.playerCorp));
        let bx = 0, by = 0;
        if (corpGateKey) {
          const [gox, goy] = pvpLayout[corpGateKey];
          const dist = Math.hypot(gox, goy) || 1;
          bx = gox - gox / dist * 700;
          by = goy - goy / dist * 700;
        }
        baseX = parentW / 2 + bx;
        baseY = parentH / 2 + by + 80;
      } else {
        // Corp / neutral sector: base is always at world centre
        baseX = parentW / 2;
        baseY = parentH / 2 + 80;
      }
    } else {
      const corpPos = isPvp ? this.homeBasePositions?.[this.playerCorp] : null;
      baseX = corpPos ? corpPos.x : this.worldWidth  / 2;
      baseY = corpPos ? corpPos.y : this.worldHeight / 2 - 40;
    }

    const canAffordCheck = (cr, st) => st > 0 ? (this.starGold || 0) >= st : (this.credits || 0) >= cr;
    const costStr = (cr, st) => st > 0 ? `${st} ⭐` : cr > 0 ? `${cr.toLocaleString()} cr` : 'бесплатно';
    const canBase = canAffordCheck(baseCr, baseSt);
    const canSpot = canAffordCheck(spotCr, spotSt);

    const overlay = this.add.rectangle(0, 0, W, H, 0x000000, 0.72).setOrigin(0).setDepth(300).setScrollFactor(0);
    const panel   = this.add.rectangle(W / 2, H / 2, 530, 260, 0x06101e, 1).setDepth(301).setScrollFactor(0)
      .setStrokeStyle(2, 0xef5350, 0.9);
    const txtTitle = this.add.text(W / 2, H / 2 - 112, 'ВЫ ПОГИБЛИ',
      { ...tf, fontSize: '20px', color: '#ef5350', fontStyle: 'bold' })
      .setOrigin(0.5).setDepth(302).setScrollFactor(0);

    const allObjs = [overlay, panel, txtTitle];
    const destroyAll = () => allObjs.forEach(o => o?.destroy());

    const makeCard = (cx, title, hpLabel, cStr, affordable, onConfirm) => {
      const fc = affordable ? 0x081a14 : 0x0d0d0d;
      const bc = affordable ? 0x2a7a5a : 0x222222;
      const cg = this.add.graphics().setDepth(302).setScrollFactor(0);
      cg.fillStyle(fc, 1); cg.fillRoundedRect(cx - 110, H / 2 - 78, 220, 148, 7);
      cg.lineStyle(2, bc, affordable ? 0.9 : 0.25);
      cg.strokeRoundedRect(cx - 110, H / 2 - 78, 220, 148, 7);

      const tc = affordable ? '#4dd0e1' : '#2a4455';
      const t1 = this.add.text(cx, H / 2 - 56, title,
        { ...tf, fontSize: '15px', color: tc }).setOrigin(0.5).setDepth(303).setScrollFactor(0);
      const t2 = this.add.text(cx, H / 2 - 26, hpLabel,
        { fontFamily: 'Inter,sans-serif', fontSize: '12px', color: affordable ? '#88bbaa' : '#2a3a3a', resolution: UI_RES })
        .setOrigin(0.5).setDepth(303).setScrollFactor(0);
      const t3 = this.add.text(cx, H / 2 + 2, cStr,
        { ...tf, fontSize: '13px', color: affordable ? '#ffdd55' : '#443333' })
        .setOrigin(0.5).setDepth(303).setScrollFactor(0);

      const btnFill = affordable ? 0x0a2a18 : 0x111111;
      const btnBord = affordable ? 0x44cc77 : 0x1a2a1a;
      const btn = this.add.rectangle(cx, H / 2 + 46, 196, 32, btnFill, 1)
        .setDepth(303).setScrollFactor(0)
        .setStrokeStyle(2, btnBord, affordable ? 0.9 : 0.2)
        .setInteractive({ useHandCursor: affordable });
      const btnLbl = this.add.text(cx, H / 2 + 46,
        affordable ? 'РЕМОНТИРОВАТЬ' : '🔒 НЕТ РЕСУРСОВ',
        { ...tf, fontSize: '11px', color: affordable ? '#66dd88' : '#2a3a2a' })
        .setOrigin(0.5).setDepth(304).setScrollFactor(0);

      if (affordable) {
        btn.on('pointerover', () => btn.setFillStyle(0x0f3a22));
        btn.on('pointerout',  () => btn.setFillStyle(0x0a2a18));
        btn.on('pointerdown', (p, lx, ly, event) => { if (event) event.stopPropagation(); onConfirm(); });
      }
      allObjs.push(cg, t1, t2, t3, btn, btnLbl);
    };

    const finishRespawn = (rx, ry, fullHull, cr, st, jumpToSector) => {
      if (st > 0)      this.starGold = (this.starGold || 0) - st;
      else if (cr > 0) this.credits  = (this.credits  || 0) - cr;
      destroyAll();
      this.steering = false;
      this.cancelCollect();
      this.playerRespawning = false;
      if (jumpToSector) {
        // Eject from dungeon/boss map → jump to home sector
        galaxy.current = jumpToSector;
        document.getElementById('scene-overlay')?.classList.add('active');
        this.scene.restart({ startX: rx, startY: ry });
      } else {
        this.player.respawn(rx, ry);
        if (!fullHull) this.player.hull = Math.round(this.player.maxHull * 0.5);
        this._spawnEngineFx();
      }
    };

    makeCard(W / 2 - 130, 'К БАЗЕ',
      isDungOrBoss ? '100% HP · родная база' : '100% прочности',
      costStr(baseCr, baseSt), canBase,
      () => finishRespawn(baseX, baseY, true, baseCr, baseSt, parentSecKey));
    makeCard(W / 2 + 130, 'НА МЕСТЕ', '50% прочности', costStr(spotCr, spotSt), canSpot,
      () => finishRespawn(deathX, deathY, false, spotCr, spotSt));
  }
  showDamage(x, y, res) {
    const total = Math.round((res.shieldHit || 0) + (res.hullHit || 0)); if (total <= 0) return;
    const toHull = (res.hullHit || 0) > 0;
    const txt = this.add.text(x + Phaser.Math.Between(-12, 12), y - 20, `-${total}`, { fontFamily: 'Orbitron', fontSize: toHull ? '20px' : '16px', color: toHull ? '#ef5350' : '#4dd0e1', fontStyle: 'bold', resolution: UI_RES, }).setOrigin(0.5).setDepth(70);
    this.tweens.add({ targets: txt, y: y - 60, duration: 1500, ease: 'Quad.easeOut', onComplete: () => txt.destroy() });
    this.tweens.add({ targets: txt, alpha: 0, delay: 700, duration: 800 });
  }
  pingAt(x, y) {
    const ring = this.add.circle(x, y, 6, COLORS.primary, 0).setStrokeStyle(2, COLORS.primary, 0.9).setDepth(35);
    this.tweens.add({ targets: ring, radius: 26, alpha: 0, duration: 380, ease: 'Quad.easeOut', onUpdate: () => ring.setStrokeStyle(2, COLORS.primary, ring.alpha), onComplete: () => ring.destroy() });
  }
  showDodge(x, y) {
    const txt = this.add.text(x, y - 24, i18n.t('hud.dodge'), { fontFamily: 'Orbitron', fontSize: '15px', color: '#4dd0e1', fontStyle: 'bold', resolution: UI_RES, }).setOrigin(0.5).setDepth(70);
    this.tweens.add({ targets: txt, y: y - 56, alpha: 0, duration: 650, ease: 'Quad.easeOut', onComplete: () => txt.destroy() });
  }
  explosion(x, y, scale = 1) {
    const size = Math.round(scale * 300); const cls = EXP_CLASSES.find((c) => c[1] >= size) || EXP_CLASSES[EXP_CLASSES.length - 1];
    const spr = this.add.sprite(x, y, `exp_${cls[0]}`).setDepth(66); spr.setDisplaySize(size, size); spr.play(`boom_${cls[0]}`); spr.once('animationcomplete', () => spr.destroy());
  }
  spawnBossAoe(mob, x, y) {
    const telegraph = mob.phase >= 2 ? BOSS.aoeTelegraphP2 : BOSS.aoeTelegraphP1;
    const now = this.time.now; this.aoeZones.push({ x, y, radius: BOSS.aoeRadius, bornAt: now, detonateAt: now + telegraph, done: false }); this.log(i18n.t('log.boss_aoe'));
  }
  spawnApophisMinions() {
    const apophis = this.mobs.find(m => m.tpl.key === 'bigboss' && m.alive);
    if (!apophis) return;
    const cx = apophis.x, cy = apophis.y;
    [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach(ang => {
      const m = new Mob(this, MOBS['ancient_01'], 50,
        cx + Math.cos(ang) * 320, cy + Math.sin(ang) * 320,
        { patrolRadius: 150, bossRef: apophis });
      this.mobs.push(m);
    });
  }
  updateAoe() {
    this.aoeGfx.clear(); if (!this.aoeZones.length) return;
    const now = this.time.now;
    for (const z of this.aoeZones) {
      const frac = Phaser.Math.Clamp((now - z.bornAt) / (z.detonateAt - z.bornAt), 0, 1);
      this.aoeGfx.fillStyle(COLORS.danger, 0.08); this.aoeGfx.fillCircle(z.x, z.y, z.radius); this.aoeGfx.lineStyle(3, COLORS.danger, 0.9); this.aoeGfx.strokeCircle(z.x, z.y, z.radius);
      this.aoeGfx.fillStyle(COLORS.amber, 0.30); this.aoeGfx.fillCircle(z.x, z.y, z.radius * frac); this.aoeGfx.fillStyle(COLORS.danger, 0.22); this.aoeGfx.fillCircle(z.x, z.y, z.radius * 0.35);
      if (now >= z.detonateAt) { z.done = true; this.detonateAoe(z); }
    }
    this.aoeZones = this.aoeZones.filter((z) => !z.done);
  }
  detonateAoe(z) {
    this.explosion(z.x, z.y, 1.6); const p = this.player; if (!p.alive) return;
    const d = Phaser.Math.Distance.Between(p.x, p.y, z.x, z.y);
    if (d <= z.radius) {
      const falloff = 1 - (d / z.radius) * (1 - BOSS.aoeEdgeFactor);
      const res = p.takeDamage(BOSS.aoeDamage * falloff, BOSS.aoePenetration, true);
      this.showDamage(p.x, p.y, res); if (!p.alive) this.onPlayerKilled();
    }
  }
  _onScreen(x, y) { return this.cameras.main.worldView.contains(x, y); }
  log(msg) { this.game.events.emit('hud-log', msg); }
  update(time, delta) {
    const dt = delta / 1000;
    this.bgNear.tilePositionX = this.cameras.main.scrollX * 0.05;
    this.bgNear.tilePositionY = this.cameras.main.scrollY * 0.05;

    // Engine particles: one emitter per nozzle, positioned in ship-local space.
    // Coordinate formula (sprite drawn nose-down, artAngleOffset -π/2):
    //   wx = px + nx·sin(f) − ny·cos(f),  wy = py − nx·cos(f) − ny·sin(f)
    if (!this.player.alive) {
      if (this.engineFxList.length) {
        for (const fx of this.engineFxList) this.vfx.stopLoop(fx);
        this.engineFxList = [];
        this._engineFxShipKey = null;
      }
    } else {
      if (this.player.ship?.key !== this._engineFxShipKey) this._spawnEngineFx();
      const f = this.player.facing;
      const px = this.player.x, py = this.player.y;
      const alpha = this.player.speed > 8 ? 1 : 0;
      const nozzles = this.player.ship?.engines || [{ x: 0, y: 42 }];
      this.engineFxList.forEach((fx, i) => {
        if (!fx?.active) return;
        const n = nozzles[i] || nozzles[0];
        fx.setPosition(px + n.x * Math.sin(f) - n.y * Math.cos(f),
                       py - n.x * Math.cos(f) - n.y * Math.sin(f));
        fx.setRotation(f + Math.PI);
        fx.setAlpha(alpha);
      });
    }

    // Targeting reticle follows locked target
    if (this._targetFx?.active) {
      if (this.target?.alive) {
        this._targetFx.setPosition(this.target.x, this.target.y);
      } else {
        this.vfx.stopLoop(this._targetFx);
        this._targetFx = null;
      }
    }

    // Эффект варп-пыли (проносящиеся мимо частицы) при форсаже
    if (this.player.boosting && this.player.speed > 50) {
      this.dust.emitting = true;
      const oppRad = this.player.heading + Math.PI;
      const speed = 3500;
      this.dust.speedX = Math.cos(oppRad) * speed;
      this.dust.speedY = Math.sin(oppRad) * speed;
      this.dust.particleRotate = Phaser.Math.RadToDeg(oppRad);
    } else {
      this.dust.emitting = false;
    }

    const inSafe = this.inSafeZone(this.player.x, this.player.y);
    let faceAngle = null;
    
    if (this.target && this.target.alive && !this.jumping) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.target.x, this.target.y);
      if (d < this.player.weaponRange) {
        faceAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, this.target.x, this.target.y);
        if (this.isFiring && time > this.player.fireCooldown) {
          this.firePlayerWeapon();
          if (this._phantomCloakEndTime > time) this._breakPhantomCloak();
          this.player.fireCooldown = time + 1000 / this.player.weaponFireRate;
          this.player.lastAttackAt = time;
        }
      }
    }
    
    this.player.update(dt, inSafe, faceAngle);
    if (this.steering && this.player.alive && !this.jumping) {
      const wpt = this.cameras.main.getWorldPoint(this.input.activePointer.x, this.input.activePointer.y);
      this.movement.steerMode = true;
      this.movement.setWaypoint(wpt.x, wpt.y, false);
    }
    if (!this.jumping && this.player.alive) this.movement.update(dt, inSafe);
    // EMP slow: применяем после movement, до обновления мобов
    if (this.player.alive && (this._empSlowUntil || 0) > this.time.now) {
      const b = this.player.sprite.body;
      b.setVelocity(b.velocity.x * 0.45, b.velocity.y * 0.45);
    }
    // Данж: охранники депозитов просыпаются, рой агрится стаей
    if (this.player.alive && SECTORS[galaxy.current]?.isDungeon) {
      this._updateDepositGuardSleep();
      if (galaxy.current === 'dungeon_1') this._updateSwarmPack();
    }
    this.mobs.forEach((m) => {
      const tgt = (m.escortTarget?.alive) ? m.escortTarget : this.player;
      const victim = (m.escortTarget?.alive) ? this.escortTransport : this.player;
      const _fireCb = this.mobAimDisrupted ? () => {} : (mob, tx, ty) => this.fireMobWeapon(mob, tx, ty, victim);
      m.update(dt, tgt, tgt === this.player && inSafe, _fireCb);
      if (m.requestAoe) { this.spawnBossAoe(m, this.player.x, this.player.y); m.requestAoe = false; }
    });
    this.updateAoe();
    if (this.player.alive && galaxy.current === 'dungeon_3') this._updateSyndicateEMP(dt);

    this.miningBases.forEach(b => b.update(dt));
    this.nearBase = false; // reset before home bases accumulate — any base can set it to true
    this.homeBases.forEach(b => b.update(dt));
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    this.projectiles.forEach((p) => p.update(dt));
    this.updateLoot(dt); this.updateGates(dt);
    this._updateMagnet(dt);
    const now2 = this.time.now;
    this.plasmateDeposits.forEach(d => d.update(now2));
    if (this.pendingGate && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.pendingGate.x, this.pendingGate.y) < 60) { this.pendingGate = null; }
    this.argusCtrl?.update(dt);
    this.confedGuards?.update(dt, this.player);
    if (this._apophisRings) this._updateApophisRings(dt);
    this._updateBotPilot(dt);
    this._updateEscort(dt);

    // Spawn transport if we just arrived in the escort target sector
    if (!this.escortTransport && this._shouldSpawnEscort()) {
      this._spawnEscortTransport();
    }

    this._adminBroadcastT += dt;
    if (this._adminBroadcastT >= 2) {
      this._adminBroadcastT = 0;
      this._adminBroadcastGameState();
    }

    this._saveTimer = (this._saveTimer || 0) + dt;
    if (this._saveTimer >= 60) {
      this._saveTimer = 0;
      this._saveState();
    }

    this._updateCursor();
  }

  _adminBroadcastGameState() {
    if (!this._adminCh) return;
    const p = this.player;
    this._adminCh.postMessage({
      type:       'GAME_STATE',
      playerName: this.playerName ?? 'Player',
      level:      this.pilotLevel ?? 1,
      rank:       this.pilotRank?.name ?? '—',
      corp:       this.playerCorp ?? 'neutral',
      hullPct:    p?.alive ? Math.round(p.hull   / p.maxHull   * 100) : 0,
      shieldPct:  p?.alive ? Math.round(p.shield / p.maxShield * 100) : 0,
      sector:     galaxy.current,
      credits:    this.credits   ?? 0,
      starGold:   this.starGold  ?? 0,
      mobs:       this.mobs.filter(m => m.alive).length,
      alive:      p?.alive ?? false,
    });
  }

  // ── Данж: охранники депозитов — спят до 300px ────────────────────────────
  _updateDepositGuardSleep() {
    for (const mob of this.mobs) {
      if (!mob.alive || !mob.depositGuardSleeping) continue;
      const d = Phaser.Math.Distance.Between(mob.x, mob.y, this.player.x, this.player.y);
      if (d < 300) {
        mob.depositGuardSleeping = false;
        mob.passive  = false;
        mob.state    = 'aggro';
        mob.sprite.setTint(0xff3333);
        this.time.delayedCall(350, () => { if (mob.alive) mob.sprite.clearTint(); });
        this.cameras.main.shake(160, 0.004);
      }
    }
  }

  // ── Данж: Рой — стайный агрос (pack trigger) ─────────────────────────────
  _updateSwarmPack() {
    const PACK_R = 520;
    for (const aggr of this.mobs) {
      if (!aggr.alive || aggr.state !== 'aggro') continue;
      if (!aggr.tpl.key?.startsWith('swarm_')) continue;
      for (const nb of this.mobs) {
        if (!nb.alive || nb.state === 'aggro' || nb.passive || nb.depositGuardSleeping) continue;
        if (!nb.tpl.key?.startsWith('swarm_')) continue;
        const d = Phaser.Math.Distance.Between(aggr.x, aggr.y, nb.x, nb.y);
        if (d < PACK_R) { nb.state = 'aggro'; nb.neutral = false; }
      }
    }
  }

  // ── Данж: Синдикат — ЭМИ-разряд от шиелдеров ────────────────────────────
  _updateSyndicateEMP(dt) {
    const EMP_CD = 14, EMP_RANGE = 600;
    for (const mob of this.mobs) {
      if (!mob.alive || mob.state !== 'aggro') continue;
      if (mob.tpl.faction !== 'syndicate' || mob.tpl.aiClass !== 'shielder') continue;
      mob._empCd = (mob._empCd ?? EMP_CD) - dt;
      if (mob._empCd > 0) continue;
      const d = Phaser.Math.Distance.Between(mob.x, mob.y, this.player.x, this.player.y);
      if (d > EMP_RANGE) { mob._empCd = 5; continue; }
      mob._empCd = EMP_CD;
      this._spawnEMPPulse(mob.x, mob.y);
    }
  }

  _spawnEMPPulse(ox, oy) {
    const g = this.add.graphics().setDepth(58);
    const MAX_R = 380, DUR = 700;
    let elapsed = 0;
    const hit = new Set();
    const timer = this.time.addEvent({
      delay: 16, loop: true,
      callback: () => {
        elapsed += 16;
        const frac = Math.min(1, elapsed / DUR);
        const r    = MAX_R * frac;
        const a    = 0.85 * (1 - frac);
        g.clear();
        g.lineStyle(4, 0x4dd0e1, a); g.strokeCircle(ox, oy, r);
        g.lineStyle(1.5, 0x80ffff, a * 0.45); g.strokeCircle(ox, oy, r * 0.65);
        if (this.player.alive && !hit.has('p')) {
          const pd = Phaser.Math.Distance.Between(ox, oy, this.player.x, this.player.y);
          if (pd >= r - 40 && pd <= r + 40) { hit.add('p'); this._applyEMPSlow(2400); }
        }
        if (frac >= 1) { g.destroy(); timer.destroy(); }
      },
    });
    this.log('⚡ ЭМИ-разряд Синдиката!');
  }

  _applyEMPSlow(ms) {
    const end = this.time.now + ms;
    if ((this._empSlowUntil || 0) >= end) return;
    this._empSlowUntil = end;
    this.log('⚡ Двигатель замедлен на 2.4с');
  }

  _updateCursor() {
    if (this.atBase) { this.game.canvas.style.cursor = 'default'; return; }
    const ptr = this.input.activePointer;
    const wp  = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
    const HOVER_R = 55;
    let cursor = 'default';

    // Mobs
    for (const m of this.mobs) {
      if (!m.alive) continue;
      if (Phaser.Math.Distance.Between(wp.x, wp.y, m.x, m.y) < HOVER_R) {
        cursor = 'crosshair'; break;
      }
    }

    // Loot boxes
    if (cursor === 'default') {
      for (const l of this.loot) {
        if (!l.alive) continue;
        if (Phaser.Math.Distance.Between(wp.x, wp.y, l.x, l.y) < HOVER_R) {
          cursor = 'grab'; break;
        }
      }
    }

    // Plasmate crystals
    if (cursor === 'default') {
      for (const d of this.plasmateDeposits) {
        if (!d.alive) continue;
        if (Phaser.Math.Distance.Between(wp.x, wp.y, d.x, d.y) < HOVER_R) {
          cursor = 'grab'; break;
        }
      }
    }

    if (this.game.canvas.style.cursor !== cursor)
      this.game.canvas.style.cursor = cursor;
  }
  updateLoot(dt) {
    this.collectGfx.clear();
    const target = this.collectTarget;
    if (!target || !this.player.alive) return;

    if (!target.alive) { this.cancelCollect(); return; }

    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, target.x, target.y);
    
    // Начинаем сбор только если мы в радиусе. Если далеко — просто ждем прибытия.
    const pickupR = PICKUP_RADIUS * (this.player.lootPickupRadiusMult || 1);
    if (dist <= pickupR + 10) {
      this.collectTimer += dt * 1000;
      const frac = Math.min(1, this.collectTimer / PICKUP_TIME);
      
      this.collectGfx.lineStyle(3, COLORS.primary, 0.8);
      this.collectGfx.strokeCircle(target.x, target.y, 45 * (1 - frac));
      
      if (frac >= 1) {
        if (target.isPlasmate || target.isDungeonResource) {
          this._collectPlasmateDeposit(target);
          this.cancelCollect();
        } else {
          const item = target.item;
          if (CONSUMABLES[item.type]) {
            const inv = this.inventory;
            const ammoAdded = this._tryAddToAmmoSlots(item.type, item.amount);
            const remaining = item.amount - ammoAdded;
            if (remaining > 0) {
              const hasStack = inv.some(i => i.type === item.type && i.amount < CONSUMABLES[i.type].maxPerSlot);
              if (!hasStack && inv.length >= this._cargoMax()) {
                if (ammoAdded === 0) { this.log(i18n.t('log.cargo_full')); this.cancelCollect(); }
                else { this.log(i18n.t('log.loot_pickup', { item: itemName(item) })); target.collect(); this.cancelCollect(); this.advanceMission('daily_salvage', 0); this._saveState(); }
                return;
              }
              addConsumableToInventory(inv, item.type, remaining, this._cargoMax());
            }
            this.log(i18n.t('log.loot_pickup', { item: itemName(item) }));
            target.collect();
            this.cancelCollect();
            this.advanceMission('daily_salvage', 0);
            this._saveState();
          } else if (this.inventory.length >= this._cargoMax()) {
            this.log(i18n.t('log.cargo_full'));
            this.cancelCollect();
          } else {
            this.inventory.push(item);
            this.log(i18n.t('log.loot_pickup', { item: itemName(item) }));
            target.collect();
            this.cancelCollect();
            this.advanceMission('daily_salvage', 0);
            this._saveState();
          }
        }
      }
    } else {
      // Пока летим или если отлетели — таймер сброшен, но цель НЕ теряем
      this.collectTimer = 0;
    }

    this.loot = this.loot.filter((l) => l.alive);
  }

  _updateMagnet(dt) {
    if (!this.magnetEnabled) return;
    if (!this.player?.alive || this.atBase || this.jumping) return;

    // Release all when cargo full — unless a stackable consumable or partial plasmate slot still fits
    if (this.inventory.length >= this._cargoMax()) {
      const anyStackable = this.loot.some(l => l.alive && l._magnetPull
        && CONSUMABLES[l.item?.type]
        && this.inventory.some(i => i.type === l.item.type && i.amount < CONSUMABLES[i.type].maxPerSlot));
      const hasPlasmateSpace = this.inventory.some(i => i.type === 'plasmate' && i.amount < PLASMATE_PER_SLOT);
      if (!anyStackable) {
        for (const l of this.loot) {
          if (l._magnetPull) {
            l._magnetPull = false;
            l.sprite.setDisplaySize(l._origDisplayW ?? l.sprite.displayWidth, l._origDisplayH ?? l.sprite.displayHeight);
          }
        }
        if (!hasPlasmateSpace) return; // пласмит тоже полон — выходим полностью
      }
    }

    const MAGNET_BASE = 180;
    const radius = MAGNET_BASE * (this.player.lootPickupRadiusMult ?? 1.0);
    const px = this.player.x, py = this.player.y;

    for (const loot of this.loot) {
      if (!loot.alive) continue;
      if (loot === this.collectTarget) continue; // manual collect takes priority

      const dx = px - loot.sprite.x, dy = py - loot.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!loot._magnetPull) {
        if (dist >= radius) continue;
        loot._magnetPull = true;
        loot._origDisplayW = loot.sprite.displayWidth;
        loot._origDisplayH = loot.sprite.displayHeight;
      } else if (dist > radius * 2) {
        // Player flew too far — break the connection
        loot._magnetPull = false;
        loot.sprite.setDisplaySize(loot._origDisplayW ?? loot.sprite.displayWidth, loot._origDisplayH ?? loot.sprite.displayHeight);
        continue;
      }

      if (dist < 8) {
        // Arrived — collect
        const mi = loot.item;
        if (CONSUMABLES[mi.type]) {
          const ammoAdded = this._tryAddToAmmoSlots(mi.type, mi.amount);
          const remaining = mi.amount - ammoAdded;
          if (remaining > 0) addConsumableToInventory(this.inventory, mi.type, remaining, this._cargoMax());
        } else {
          this.inventory.push(mi);
        }
        this.log(i18n.t('log.loot_pickup', { item: itemName(mi) }));
        loot.collect();
        this.advanceMission('daily_salvage', 0);
        this._saveState();
        continue;
      }

      // Accelerating pull: 150 px/s at radius edge → 600 px/s near center
      const t = Math.max(0, 1 - dist / radius);
      const speed = (150 + 450 * t) * dt;
      loot.sprite.x += (dx / dist) * speed;
      loot.sprite.y += (dy / dist) * speed;
      // Keep baseX/Y in sync so Loot.update() bobbing doesn't fight the magnet
      loot.baseX = loot.sprite.x;
      loot.baseY = loot.sprite.y;

      // Shrink sprite as it nears the ship
      const SHRINK_DIST = 50;
      if (dist < SHRINK_DIST) {
        const scale = dist / SHRINK_DIST;
        loot.sprite.setDisplaySize(loot._origDisplayW * scale, loot._origDisplayH * scale);
      }
    }

    // ── Plasmate auto-collect (premium + loot_magnet skill affects radius) ──
    if (this.premium) {
      const limitReached = (this.plasmateToday || 0) >= PLASMATE_DAILY_MAX;
      const plasmateCargoFull = this.inventory.length >= this._cargoMax()
        && !this.inventory.some(i => i.type === 'plasmate' && i.amount < PLASMATE_PER_SLOT);

      for (const dep of this.plasmateDeposits) {
        if (!dep.alive) continue;
        if (!dep.isPlasmate) continue; // magnet only auto-collects plasmate
        if (dep === this.collectTarget) continue;

        // Release if blocked by limit or cargo
        if (limitReached || plasmateCargoFull) {
          if (dep._magnetPull) {
            dep._magnetPull = false;
            dep.sprite.setDisplaySize(dep._origDisplayW ?? 40, dep._origDisplayH ?? 40);
          }
          continue;
        }
        // Respect per-deposit cooldown (set after failed collection)
        if (dep._magnetCooldownUntil && this.time.now < dep._magnetCooldownUntil) continue;

        const ddx = px - dep.sprite.x, ddy = py - dep.sprite.y;
        const ddist = Math.sqrt(ddx * ddx + ddy * ddy);

        if (!dep._magnetPull) {
          if (ddist >= radius) continue;
          dep._magnetPull = true;
          dep._origDisplayW = dep.sprite.displayWidth;
          dep._origDisplayH = dep.sprite.displayHeight;
        } else if (ddist > radius * 2) {
          // Player flew too far — break the connection
          dep._magnetPull = false;
          dep.sprite.setDisplaySize(dep._origDisplayW ?? 40, dep._origDisplayH ?? 40);
          continue;
        }

        if (ddist < 8) {
          dep._magnetPull = false;
          dep.sprite.setDisplaySize(dep._origDisplayW ?? 40, dep._origDisplayH ?? 40);
          const wasAlive = dep.alive;
          this._collectPlasmateDeposit(dep);
          if (dep.alive) dep._magnetCooldownUntil = this.time.now + 3000; // failed — cooldown
          continue;
        }

        const pt = Math.max(0, 1 - ddist / radius);
        const pspeed = (150 + 450 * pt) * dt;
        dep.sprite.x += (ddx / ddist) * pspeed;
        dep.sprite.y += (ddy / ddist) * pspeed;

        const SHRINK_DIST = 50;
        if (ddist < SHRINK_DIST) {
          const pscale = ddist / SHRINK_DIST;
          dep.sprite.setDisplaySize(dep._origDisplayW * pscale, dep._origDisplayH * pscale);
        }
      }
    }
  }

  createBoostFx() {
    this.boostEmitter = this.add.particles(0, 0, 'glow', {
      lifespan: 400, speed: { min: 50, max: 150 }, scale: { start: 0.4, end: 0 }, alpha: { start: 0.6, end: 0 },
      tint: COLORS.amber, blendMode: 'ADD', frequency: -1, rotate: { min: 0, max: 360 }
    }).setDepth(49);
  }

  createDungeonWalls() {
    const sec = SECTORS[galaxy.current];
    if (!sec.isDungeon) return;

    this.dungeonBossDoor    = null;
    this.dungeonBossDoorVis = null;
    this.walls = this.physics.add.staticGroup();
    const g  = this.add.graphics().setDepth(1);
    const cx = this.worldWidth / 2, cy = this.worldHeight / 2;

    const WALL_STYLES = {
      dungeon_1:    { type: 'asteroid', fill: 0x2a1206, fillA: 0.92, edge: 0x8b3a1a },
      dungeon_2:    { type: 'metal',    fill: 0x0e1e0e, fillA: 0.92, edge: 0x3a6a3a },
      dungeon_3:    { type: 'stone',    fill: 0x1c1c2e, fillA: 0.92, edge: 0x505080 },
      dungeon_4:    { type: 'debris',   fill: 0x0e180e, fillA: 0.92, edge: 0x3a5a3a },
      dungeon_5:    { type: 'energy',   fill: 0x020c14, fillA: 0.80, edge: 0x4dd0e1 },
      dungeon_prem: { type: 'ancient',   fill: 0x020a04, fillA: 0.92, edge: 0x00c853 },
      'R-1-boss':   { type: 'boss',     fill: 0x060a06, fillA: 0.88, edge: 0xc8a800 },
    };
    const ws = WALL_STYLES[galaxy.current] ?? WALL_STYLES['dungeon_5'];

    const drawWallVisual = (x0, y0, w, h) => {
      g.fillStyle(ws.fill, ws.fillA);
      g.fillRect(x0, y0, w, h);

      if (ws.type === 'asteroid') {
        const rng = new Phaser.Math.RandomDataGenerator([`${x0}|${y0}`]);
        g.lineStyle(1, 0x6b2e0e, 0.45);
        for (let k = 0; k < 3; k++) {
          const ax = x0 + rng.between(12, w - 12), ay = y0 + rng.between(12, h - 12);
          const bx = Phaser.Math.Clamp(ax + rng.between(-90, 90), x0, x0 + w);
          const by = Phaser.Math.Clamp(ay + rng.between(-90, 90), y0, y0 + h);
          g.lineBetween(ax, ay, bx, by);
        }
        g.lineStyle(2, ws.edge, 0.85); g.strokeRect(x0, y0, w, h);
        g.lineStyle(1, ws.edge, 0.22); g.strokeRect(x0 + 4, y0 + 4, w - 8, h - 8);

      } else if (ws.type === 'metal') {
        const seams = Math.max(1, Math.floor(h / 120));
        g.lineStyle(1, 0x2a5a2a, 0.38);
        for (let k = 1; k <= seams; k++) {
          const sy = y0 + k * h / (seams + 1);
          g.lineBetween(x0 + 6, sy, x0 + w - 6, sy);
          g.fillStyle(0x3a6a3a, 0.55);
          g.fillRect(x0 + 10, sy - 2, 4, 4);
          g.fillRect(x0 + w - 14, sy - 2, 4, 4);
        }
        g.lineStyle(2, ws.edge, 0.82); g.strokeRect(x0, y0, w, h);
        g.lineStyle(1, ws.edge, 0.18); g.strokeRect(x0 + 2, y0 + 2, w - 4, h - 4);

      } else if (ws.type === 'stone') {
        const rowH = 90, colW = 160;
        g.lineStyle(1, 0x404068, 0.32);
        let row = 0;
        for (let gy2 = y0 + rowH; gy2 < y0 + h; gy2 += rowH, row++) g.lineBetween(x0, gy2, x0 + w, gy2);
        row = 0;
        for (let gy2 = y0; gy2 < y0 + h; gy2 += rowH, row++) {
          const off = (row % 2) * (colW / 2);
          for (let gx2 = x0 + colW - off; gx2 < x0 + w; gx2 += colW)
            g.lineBetween(gx2, gy2, gx2, Math.min(y0 + h, gy2 + rowH));
        }
        g.lineStyle(2, ws.edge, 0.78); g.strokeRect(x0, y0, w, h);

      } else if (ws.type === 'debris') {
        const rng3 = new Phaser.Math.RandomDataGenerator([`${x0}|${y0}`]);
        g.lineStyle(1, 0x2a4a2a, 0.38);
        for (let k = 0; k < 3; k++) {
          const ax = x0 + rng3.between(0, w);
          g.lineBetween(ax, y0, ax - rng3.between(20, 60), y0 + h);
        }
        g.lineStyle(2, ws.edge, 0.75); g.strokeRect(x0, y0, w, h);
        g.lineStyle(1, ws.edge, 0.18); g.strokeRect(x0 + 3, y0 + 3, w - 6, h - 6);

      } else if (ws.type === 'energy') {
        g.lineStyle(8, ws.edge, 0.04); g.strokeRect(x0 - 4, y0 - 4, w + 8, h + 8);
        g.lineStyle(4, ws.edge, 0.13); g.strokeRect(x0 - 2, y0 - 2, w + 4, h + 4);
        g.lineStyle(2, ws.edge, 0.88); g.strokeRect(x0, y0, w, h);
        g.lineStyle(1, ws.edge, 0.05);
        for (let i = 80; i < w; i += 80) g.lineBetween(x0 + i, y0, x0 + i, y0 + h);
        for (let j = 80; j < h; j += 80) g.lineBetween(x0, y0 + j, x0 + w, y0 + j);

      } else if (ws.type === 'ancient') {
        // Биоорганические стены зелёного храма — прожилки и кристальное свечение
        g.lineStyle(12, ws.edge, 0.03); g.strokeRect(x0 - 6, y0 - 6, w + 12, h + 12);
        g.lineStyle(5,  ws.edge, 0.10); g.strokeRect(x0 - 2, y0 - 2, w + 4,  h + 4);
        g.lineStyle(2,  ws.edge, 0.90); g.strokeRect(x0, y0, w, h);
        const rngA = new Phaser.Math.RandomDataGenerator([`a${x0}|${y0}`]);
        g.lineStyle(1, ws.edge, 0.12);
        for (let k = 0; k < 4; k++) {
          const sx2 = x0 + rngA.between(10, w - 10), sy2 = y0 + rngA.between(10, h - 10);
          const len = rngA.between(40, 100), ang = rngA.between(0, 360) * Math.PI / 180;
          g.lineBetween(sx2, sy2,
            Phaser.Math.Clamp(sx2 + Math.cos(ang) * len, x0, x0 + w),
            Phaser.Math.Clamp(sy2 + Math.sin(ang) * len, y0, y0 + h));
        }

      } else if (ws.type === 'void') {
        g.lineStyle(10, ws.edge, 0.03); g.strokeRect(x0 - 5, y0 - 5, w + 10, h + 10);
        g.lineStyle(5,  ws.edge, 0.09); g.strokeRect(x0 - 2, y0 - 2, w + 4,  h + 4);
        g.lineStyle(2,  ws.edge, 0.82); g.strokeRect(x0, y0, w, h);
        g.lineStyle(1, ws.edge, 0.06);
        for (let d = -(h + 10); d < w + h; d += 120) {
          const ax = x0 + d, bx = x0 + d + h;
          g.lineBetween(
            Phaser.Math.Clamp(ax, x0, x0 + w), ax < x0 ? y0 + (x0 - ax) : y0,
            Phaser.Math.Clamp(bx, x0, x0 + w), bx > x0 + w ? y0 + h - (bx - x0 - w) : y0 + h,
          );
        }

      } else {
        g.lineStyle(8, ws.edge, 0.05); g.strokeRect(x0 - 4, y0 - 4, w + 8, h + 8);
        g.lineStyle(3, ws.edge, 0.20); g.strokeRect(x0 - 1, y0 - 1, w + 2, h + 2);
        g.lineStyle(2, ws.edge, 0.88); g.strokeRect(x0, y0, w, h);
        g.lineStyle(1, ws.edge, 0.10);
        g.lineBetween(x0, y0, x0 + w, y0 + h);
        g.lineBetween(x0 + w, y0, x0, y0 + h);
      }
    };

    const addWall = (x, y, w, h, force = false) => {
      if (!force && Phaser.Math.Distance.Between(x, y, cx, cy) < 650) return;
      if (!force && this.gates) {
        for (const gate of this.gates) {
          if (Phaser.Math.Distance.Between(x, y, gate.x, gate.y) < 650) return;
        }
      }
      const wall = this.add.rectangle(x, y, w, h, 0x000000, 0);
      this.physics.add.existing(wall, true);
      this.walls.add(wall);
      drawWallVisual(x - w / 2, y - h / 2, w, h);
    };

    const addBossDoor = (x, y, w, h) => {
      const door = this.add.rectangle(x, y, w, h, 0x000000, 0);
      this.physics.add.existing(door, true);
      this.walls.add(door);
      const dg = this.add.graphics().setDepth(3);
      const x0 = x - w / 2, y0 = y - h / 2;
      dg.fillStyle(0x550000, 0.60); dg.fillRect(x0, y0, w, h);
      dg.lineStyle(3, 0xff3333, 0.90); dg.strokeRect(x0, y0, w, h);
      dg.lineStyle(2, 0xff6666, 0.35);
      dg.lineBetween(x0, y0, x0 + w, y0 + h);
      dg.lineBetween(x0 + w, y0, x0, y0 + h);
      const dtxt = this.add.text(x, y0 - 18, i18n.t('hud.boss_room'), {
        fontFamily: 'Orbitron, sans-serif', fontSize: '13px', color: '#ff5555',
        resolution: UI_RES, stroke: '#200000', strokeThickness: 4,
      }).setOrigin(0.5, 1).setDepth(4);
      this.dungeonBossDoor    = door;
      this.dungeonBossDoorVis = [dg, dtxt];
    };

    // ── Wall layout per dungeon ───────────────────────────────────────────────
    if (galaxy.current === 'dungeon_1') {
      // Хаб + крест: 4 угловых блока → коридоры 600px N/S/E/W; бутылочное горлышко в N-рукаве → узкая дверь
      // NW/NE вытянуты вверх до y=-2250 чтобы закрыть боковые обходы к боссу
      addWall(cx - 1400, cy - 1320, 2200, 2040);   // NW: x cx-2500..cx-300, y 0..cy-300 (до границы мира)
      addWall(cx + 1400, cy - 1320, 2200, 2040);   // NE: x cx+300..cx+2500, y 0..cy-300
      addWall(cx - 1400, cy + 1000, 2200, 1400);   // SW
      addWall(cx + 1400, cy + 1000, 2200, 1400);   // SE
      // горлышко: 200px проход у верха N-рукава
      addWall(cx - 200, cy - 1450, 200, 500);       // лев. стена горлышка
      addWall(cx + 200, cy - 1450, 200, 500);       // прав. стена горлышка
      addBossDoor(cx, cy - 1750, 200, 300);

    } else if (galaxy.current === 'dungeon_2') {
      // Z-маршрут: юг→полоса1→(поворот E)→полоса2→(поворот W)→полоса3→сев-вост комната
      addWall(cx - 2700, cy - 350, 300, 3700);     // левая граница
      addWall(cx + 2700, cy - 350, 300, 3700);     // правая граница
      addWall(cx, cy - 2100, 5700, 300);            // верхняя граница
      addWall(cx - 750, cy + 700, 3900, 300);       // делитель A — проход справа
      addWall(cx + 1950, cy + 1350, 1500, 300);    // тупик с лутом (юго-восток)
      addWall(cx + 750, cy - 700, 3900, 300);       // делитель B — проход слева
      addWall(cx - 1950, cy - 100, 1500, 300);     // тупик с лутом (запад)
      addBossDoor(cx + 1000, cy - 1450, 300, 1300);

    } else if (galaxy.current === 'dungeon_3') {
      // Военная сетка: 3×2 комнаты с коридорными проходами
      addWall(cx, cy - 2000, 5400, 300);                      // верх
      addWall(cx - 2700, cy - 250, 300, 3500);                // лево
      addWall(cx + 2700, cy - 250, 300, 3500);                // право
      addWall(cx - 800, cy - 1075, 300, 1850);                // лев колонна, верх
      addWall(cx - 800, cy + 1050, 300, 1800);                // лев колонна, низ
      addWall(cx + 800, cy - 1075, 300, 1850);                // прав колонна, верх
      addWall(cx + 800, cy + 1050, 300, 1800);                // прав колонна, низ
      addWall(cx - 1875, cy + 100, 1650, 300);                // горизонт. ряд, лево
      addWall(cx, cy + 100, 1100, 300);                       // горизонт. ряд, центр
      addWall(cx + 1875, cy + 100, 1650, 300);                // горизонт. ряд, право
      addBossDoor(cx + 1650, cy - 1600, 1600, 300);           // верхне-правая комната

    } else if (galaxy.current === 'dungeon_4') {
      // Поле обломков: фиксированные осколки с небольшим jitter
      const rnd4 = new Phaser.Math.RandomDataGenerator([galaxy.current]);
      const CHUNKS = [
        [ 500, -1300, 480, 260], [-900, -900, 380, 240], [1500, -700, 320, 200],
        [-1600, -500, 420, 180], [ 900,  300, 360, 220], [-300,  900, 500, 200],
        [1600,  900, 340, 190], [-1200, 1100, 280, 260], [ 400, -500, 260, 300],
        [-500, -1500, 300, 200], [1900,  100, 260, 340], [-1900, 700, 300, 280],
        [-400, 1400, 440, 200], [1300, 1300, 360, 200], [ 800, -1700, 280, 240],
        [-1100,  300, 200, 380], [ 200, 1700, 300, 200], [-1600, -1300, 260, 200],
      ];
      CHUNKS.forEach(([ox, oy, w, h]) => {
        const jx = rnd4.between(-40, 40), jy = rnd4.between(-30, 30);
        addWall(cx + ox + jx, cy + oy + jy, w, h);
      });
      addBossDoor(cx + 1900, cy + 1100, 300, 1000);           // юго-восточный угол

    } else if (galaxy.current === 'dungeon_5') {
      // Три кольца обороны: внешнее (N/S/E/W проходы), среднее (крест-бары), внутреннее (арена)
      addWall(cx - 1700, cy - 1200, 2200, 1400);
      addWall(cx + 1700, cy - 1200, 2200, 1400);
      addWall(cx - 1700, cy + 1200, 2200, 1400);
      addWall(cx + 1700, cy + 1200, 2200, 1400);
      addWall(cx, cy - 1500, 800, 300);
      addWall(cx, cy + 1500, 800, 300);
      addWall(cx - 1500, cy, 300, 800);
      addWall(cx + 1500, cy, 300, 800);
      addWall(cx, cy + 600, 1400, 250, true);      // юж. стена арены (force — близко к центру)
      addWall(cx - 700, cy, 250, 1200, true);      // зап. стена арены
      addWall(cx + 700, cy, 250, 1200, true);      // вост. стена арены
      addBossDoor(cx, cy - 600, 1400, 250);         // сев. стена арены = boss door

    } else if (galaxy.current === 'dungeon_prem') {
      // Лабиринт Тьмы: плотная Z-сеть из тёмной материи (вход с севера)
      addWall(cx - 2700, cy + 300, 300, 4200);     // левая граница
      addWall(cx + 2700, cy + 300, 300, 4200);     // правая граница
      addWall(cx, cy + 2100, 5700, 300);            // нижняя граница
      addWall(cx - 1300, cy - 1600, 2900, 250);    // L1: проход cx+200..cx+700
      addWall(cx + 1450, cy - 1600, 2500, 250);
      addWall(cx + 450, cy - 1900, 500, 250);      // тупик с лутом у входа
      addWall(cx + 400, cy - 900, 4900, 250);      // L2: проход cx-2700..cx-2100
      addWall(cx + 1600, cy - 1250, 250, 450);     // перегородки L1-L2
      addWall(cx + 700,  cy - 1250, 250, 450);
      addWall(cx - 400, cy - 200, 4900, 250);      // L3: проход cx+2100..cx+2700
      addWall(cx - 1600, cy - 600, 250, 450);      // перегородки L2-L3
      addWall(cx - 700,  cy - 600, 250, 450);
      addWall(cx + 1200, cy - 550, 1100, 250);
      addWall(cx + 400, cy + 600, 4900, 250);      // L4: проход cx-2700..cx-2100
      addWall(cx + 1600, cy + 200, 250, 450);      // перегородки L3-L4
      addWall(cx - 300,  cy + 200, 250, 600);
      addWall(cx - 1800, cy + 200, 1100, 250);
      addWall(cx - 400, cy + 1300, 4900, 250);     // L5: проход cx+2100..cx+2700
      addWall(cx - 1600, cy + 900, 250, 450);      // перегородки L4-L5
      addWall(cx + 800,  cy + 950, 250, 450);
      // Дно лабиринта: барьер с боссовой дверью в правой части (вход в боссовую комнату)
      addWall(cx - 225, cy + 1650, 4950, 250);     // cx-2700..cx+2250 (проход cx+2250..cx+2700)
      addBossDoor(cx + 2475, cy + 1650, 450, 250); // горизонтальный boss door в восточном проходе

    } else if (galaxy.current === 'R-1-boss') {
      // Алтарь: 5 пар колонн — позиции и размер ×2 под удвоенную карту
      addWall(cx + 4400, cy - 1400, 1200, 1200);
      addWall(cx + 4400, cy + 1400, 1200, 1200);
      addWall(cx + 2200, cy - 3900, 1200, 1200);
      addWall(cx + 4200, cy - 2800, 1200, 1200);
      addWall(cx - 2200, cy - 3900, 1200, 1200);
      addWall(cx - 4200, cy - 2800, 1200, 1200);
      addWall(cx - 2200, cy + 3900, 1200, 1200);
      addWall(cx - 4200, cy + 2800, 1200, 1200);
      addWall(cx + 2200, cy + 3900, 1200, 1200);
      addWall(cx + 4200, cy + 2800, 1200, 1200);
    }

    this.physics.add.collider(this.player.sprite, this.walls);
    this.mobs.forEach(m => this.physics.add.collider(m.sprite, this.walls));
  }

  _checkDungeonBossDoor() {
    if (!this.dungeonBossDoor) return;
    const remaining = this.mobs.filter(m => m.alive && !m.isDungeonBoss && !m.isBossEscort).length;
    if (remaining === 0) this._openDungeonBossDoor();
  }

  _openDungeonBossDoor() {
    if (!this.dungeonBossDoor) return;
    this.walls.remove(this.dungeonBossDoor, true, true);
    this.dungeonBossDoor = null;
    if (this.dungeonBossDoorVis) {
      for (const obj of this.dungeonBossDoorVis) obj.destroy();
      this.dungeonBossDoorVis = null;
    }
    this.log(i18n.t('log.boss_door_open'));
  }

  spawnDungeonDeposits() {
    if (!SECTORS[galaxy.current]?.isDungeon) return;
    const cx = this.worldWidth / 2, cy = this.worldHeight / 2;

    // Данжи — только новые ресурсы (плазмит убран, он для обычных секторов).
    // Позиции проверены против стен каждого данжа.
    // res: единственный тип; types: несколько типов (по i % length); guard: ключ охранника
    const RESPAWN_MS = 24 * 60 * 60 * 1000;
    const DUNGEON_DEPOSITS = {
      // D1 hub+крест: тупики в конце E/W рукавов + S рукав
      dungeon_1:    { res:   'biomech_fragment',                                guard: 'swarm_07',     amount: 10, spots: [[0, 1800], [3200, 0], [-3200, 0]] },
      // D2 Z-маршрут: W тупик, SE карман, верхний левый тупик
      dungeon_2:    { res:   'quantum_shard',                                   guard: 'corsair_08',   amount: 12, spots: [[-2000, -400], [3589, -1224], [-1500, -1300], [2200, 1000], [-3451, -987]] },
      // D3 военная сетка: нижнее лево, верхний центр, верхнее право (перед боссом)
      dungeon_3:    { res:   'plasma_strand',                                   guard: 'syndicate_07', amount: 14, spots: [[-1800, 700], [0, -1000], [1800, -700]] },
      // D4 обломки: между кластерами мусора
      dungeon_4:    { types: ['biomech_fragment', 'quantum_shard', 'plasma_strand'], guard: 'ancient_03', amount: 15, spots: [[800, -1400], [-1400, -800], [900, 1300]] },
      // D5 три кольца: 4 прохода между кольцами (N/S/E/W)
      dungeon_5:    { types: ['biomech_fragment', 'quantum_shard', 'plasma_strand'], guard: 'ancient_08', amount: 18, spots: [[0, -1800], [0, 1800], [1700, 0], [-1800, 0]] },
      // D-prem лабиринт: три зоны между горизонтальными барьерами
      dungeon_prem: { types: ['biomech_fragment', 'quantum_shard', 'plasma_strand'], guard: 'ancient_10', amount: 20, spots: [[-1800, -1300], [-400, -500], [1600, 900]] },
      // R-1-boss арена: 6 точек между колоннами (карта ×2, депозитов ×3)
      'R-1-boss':   { types: ['biomech_fragment', 'quantum_shard', 'plasma_strand'], guard: 'ancient_11', amount: 20, spots: [[2400, 2400], [-2400, -2400], [0, 2000], [0, -2000], [3000, 0], [-3000, 0]] },
    };
    const dcfg = DUNGEON_DEPOSITS[galaxy.current];
    if (!dcfg) return;

    const sec2 = SECTORS[galaxy.current];
    const guardLvl = sec2.lvlMax;
    const typeList = dcfg.types ? dcfg.types : [dcfg.res];
    const depositMult = this._dungeonDiff().deposits;
    const scaledAmount = Math.round(dcfg.amount * depositMult);

    const CLUSTER_R = 100; // радиус россыпи кристаллов вокруг центра точки

    dcfg.spots.forEach((spot, i) => {
      const [ox, oy] = spot;
      const x = cx + ox, y = cy + oy;
      const resType = typeList[i % typeList.length];
      const zone = { xMin: x - CLUSTER_R, xMax: x + CLUSTER_R, yMin: y - CLUSTER_R, yMax: y + CLUSTER_R };

      // Россыпь: scaledAmount кристаллов вокруг точки, каждый даёт 1-3 ресурса
      for (let c = 0; c < scaledAmount; c++) {
        const angle = (c / dcfg.amount) * Math.PI * 2 + Math.random() * 0.8;
        const r = 20 + Math.random() * (CLUSTER_R - 20);
        const kx = x + Math.cos(angle) * r;
        const ky = y + Math.sin(angle) * r;
        const yield_ = Phaser.Math.Between(1, 3);
        this.plasmateDeposits.push(new PlasmateDeposit(this, kx, ky, yield_, zone, RESPAWN_MS, resType));
      }

      const guard = new Mob(this, MOBS[dcfg.guard], guardLvl, x + 130, y + 90,
        { behavior: 'guard', patrolRadius: 150, leash: 400, passive: true, ...(galaxy.current === 'R-1-boss' ? { dmgMult: 2 } : {}) });
      guard.isDepositGuard = true;
      guard.depositGuardSleeping = true;
      this.mobs.push(guard);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  БОЙ С ТЕНЬЮ — shadow_arena логика
  // ═══════════════════════════════════════════════════════════════════════════

  startShadowBattle(cfg) {
    this._shadowBattleCfg  = cfg;
    this._shadowPrevSector = galaxy.current;
    galaxy.current = 'shadow_arena';
    document.getElementById('scene-overlay')?.classList.add('active');
    this.scene.restart();
  }

  exitShadowBattle() {
    this._cleanupBotPilot();
    this._shadowBattleCfg  = null;
    this._shadowBattleDone = false;
    galaxy.current = this._shadowPrevSector || 'helios_1';
    this._shadowPrevSector = null;
    document.getElementById('scene-overlay')?.classList.add('active');
    this.scene.restart();
  }

  _cleanupBotPilot() {
    if (this.botPilot) {
      this.botPilot.sprite?.destroy();
      this.botPilot._nameplate?.destroy();
      this.botPilot._hullGfx?.destroy();
      this.botPilot = null;
    }
    this._shadowCdTxt?.destroy();
    this._shadowCdTxt = null;
    this._shadowCountdown = 0;
    this._shadowResultObjs?.forEach(o => o?.destroy());
    this._shadowResultObjs = null;
  }

  _initBotPilot() {
    if (!this._shadowBattleCfg) return;
    const cfg = this._shadowBattleCfg;
    const ship = cfg.shipDef;

    // ── Compute stats — additive-from-base (same model as Player.recomputeStats) ──
    const CANNON_DMG = { 1: 40, 2: 75, 3: 130, 4: 210 };
    const SHIELD_DUR = { 1: 300, 2: 550, 3: 900, 4: 1500 };
    const SHIELD_REG = { 1: 30,  2: 45,  3: 70,  4: 100  };
    const ENGINE_SPD = { 1: 10,  2: 15,  3: 20,  4: 27   };
    const wSlots = Math.min(ship.wSlots, 4), sSlots = Math.min(ship.sSlots, 4), eSlots = ship.eSlots || 0;
    const m = shipLevelMods(cfg.shipLevel);

    // BASE values
    const BASE_hull   = Math.round(ship.hullMax * m.hull);
    const BASE_shield = Math.round((ship.shieldBase + SHIELD_DUR[cfg.equipTier] * sSlots) * m.shield);
    const BASE_regen  = SHIELD_REG[cfg.equipTier] * sSlots;
    const BASE_speed  = Math.round((ship.baseSpeed + ENGINE_SPD[cfg.equipTier] * eSlots) * m.speed);
    const BASE_dmg    = cfg.weaponType === 'laser' ? 252 * wSlots : CANNON_DMG[cfg.equipTier] * wSlots;

    // Simulated module upgrade % — compensates for bot having no creditLvl/starLvl on gear.
    // Values match what a player gets with max star upgrades (starLvl=5 → +15% on modules).
    // Weapons: 100% from modules → +15%. Shield/regen: ~85% from modules → +13%.
    // Speed: engines ≈ 60% of total at T4 → +9%. Hull has no modMult → 0%.
    const BU_DMG = 0.15, BU_SHD = 0.13, BU_REG = 0.13, BU_SPD = 0.09;

    // Board % bonuses per tier (typical average for a bot without a real board instance)
    const BOT_BOARD = {
      1: { hullMax: 6,  cannonDmg: 5,  laserDmg: 5,  shieldMax: 5 },
      2: { hullMax: 12, cannonDmg: 10, laserDmg: 10, shieldMax: 8,  speed: 6 },
      3: { hullMax: 20, cannonDmg: 17, laserDmg: 17, shieldMax: 14, speed: 10, shieldRegen: 8 },
    };
    const board = BOT_BOARD[cfg.boardTier ?? 0] ?? {};
    const BB = s => (board[s] || 0) / 100;

    // Skill % contributions
    const skillHullPct = Math.min(0.30, (cfg.pilotLevel / 50) * 0.30);
    const skillShdPct  = Math.min(0.25, (cfg.pilotLevel / 50) * 0.25);
    const skillDmgPct  = Math.min(0.30, (cfg.pilotLevel / 50) * 0.30);

    // Perk % contributions — all collected before applying to BASE
    const PERK_CL   = [0, 2, 3, 5][cfg.equipTier - 1] ?? 0;
    const PERK_SL   = [0, 0, 1, 3][cfg.equipTier - 1] ?? 0;
    const mkPerk    = (type) => ({ ...rollPerk(type), creditLvl: PERK_CL, starLvl: PERK_SL });
    const wPerkType = cfg.weaponType === 'laser' ? 'laser' : 'cannon';
    let wDmgPct = 0, extraPen = 0, dmgResistRed = 0, shdRegenPct = 0, spdPerkPct = 0;
    let weaponShieldMult = cfg.weaponType === 'laser' ? 0.90 : 1.0;
    let weaponHullMult   = cfg.weaponType === 'laser' ? 1.30 : 1.0;
    for (let i = 0; i < wSlots; i++) {
      const p = mkPerk(wPerkType); const pb = perkBonus(p);
      if (p.key === 'perk_steady_aim')     wDmgPct   += 0.10 * (1 + pb);
      if (p.key === 'perk_hull_breaker')   extraPen   = Math.min(0.15, extraPen + 0.05 * (1 + pb));
      if (p.key === 'perk_laser_shredder') weaponHullMult += 0.20 * (1 + pb);
    }
    for (let i = 0; i < sSlots; i++) {
      const p = mkPerk('shield'); const pb = perkBonus(p);
      if (p.key === 'perk_hardened')  dmgResistRed += 0.10 * (1 + pb);
      if (p.key === 'perk_resonance') shdRegenPct  += 0.12 * (1 + pb);
    }
    for (let i = 0; i < eSlots; i++) {
      const p = mkPerk('engine'); const pb = perkBonus(p);
      if (p.key === 'perk_engine_thrust') spdPerkPct += 0.10 * (1 + pb);
    }

    // FINAL STATS — BASE × (1 + Σ all %)  BU_* компенсирует отсутствие modMult на снаряжении бота
    const maxHull     = Math.round(BASE_hull   * (1 + skillHullPct + BB('hullMax')));
    const maxShield   = Math.round(BASE_shield  * (1 + BU_SHD + skillShdPct  + BB('shieldMax')));
    const shieldRegen = Math.round(BASE_regen   * (1 + BU_REG + shdRegenPct  + BB('shieldRegen')));
    const speed       = Math.round(BASE_speed   * (1 + BU_SPD + spdPerkPct   + BB('speed')));
    const dmgBoardKey = cfg.weaponType === 'laser' ? 'laserDmg' : 'cannonDmg';
    const weaponDmg   = Math.round(BASE_dmg     * (1 + BU_DMG + skillDmgPct  + wDmgPct + BB(dmgBoardKey)));
    const weaponPen   = cfg.weaponType === 'laser' ? 0 : 0.05;
    const weaponTier  = cfg.equipTier;
    const fireRate    = cfg.weaponType === 'laser' ? 1.4 : 1.0;

    // Ship passives — applied on total (after all %)
    const shipPassive    = ship.passives ?? {};
    const maxShieldFinal = Math.round(maxShield * (1 + (shipPassive.shieldBonus  ?? 0)));
    const finalWeaponDmg = Math.round(weaponDmg * (1 + (shipPassive.damageBonus  ?? 0)));
    const shipHullRegen  = shipPassive.hullRegen    ?? 0;
    const shipEvasion    = shipPassive.evasionBonus ?? 0;
    const dmgResist      = Math.min(0.40, dmgResistRed);
    const finalWeaponPen = Math.min(0.60, weaponPen + extraPen);
    const finalShieldRegen = shieldRegen;
    const finalSpeed       = speed;

    // ── Spawn position (правая сторона карты, зеркально игроку) ───────────
    const bx = Math.round(this.worldWidth * 0.8), by = Math.round(this.worldHeight * 0.5);

    // ── Sprite ────────────────────────────────────────────────────────────
    const src   = this.textures.get(ship.key).getSourceImage();
    const scale = ship.displaySize / Math.max(src.width, src.height);
    const dw    = Math.round(src.width  * scale);
    const dh    = Math.round(src.height * scale);
    const sprite = this.add.image(bx, by, ship.key)
      .setDisplaySize(dw, dh).setTint(0xff6666).setDepth(40);
    sprite.body = { velocity: { x: 0, y: 0 }, destroy() {} }; // fake physics body for _leadTarget in _fireCannon

    // Bot HUD — name tag above sprite
    const nameplate = this.add.text(0, 0, 'ТЕНЬ', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '13px',
      color: '#ff6666', stroke: '#000000', strokeThickness: 3, resolution: UI_RES,
    }).setOrigin(0.5, 1).setDepth(51);
    const hullGfx = this.add.graphics().setDepth(52);

    // ── Build botPilot object ──────────────────────────────────────────────
    const scene = this;
    this.botPilot = {
      alive: true, x: bx, y: by, heading: Math.PI,
      hull: maxHull, maxHull, shield: maxShieldFinal, maxShield: maxShieldFinal, shieldRegen: finalShieldRegen,
      hullRegen: shipHullRegen, evasion: shipEvasion, damageResist: dmgResist,
      speed: finalSpeed, baseFireRate: 1 / fireRate,
      fireCooldown: 1.5,
      weaponDamage: finalWeaponDmg, weaponPenetration: finalWeaponPen,
      weaponShieldMult, weaponHullMult,
      weaponType: cfg.weaponType, weaponTier,
      shipDef: ship, isBoss: false, isShadowBot: true,
      tpl: { nameKey: 'mob.shadow_bot' }, level: cfg.pilotLevel,
      _aiState: 'approach', _strafeDir: 1, _strafeTimer: 0,
      _dodgeTimer: 0, _skillCheckTimer: 0.5,
      _speedMult: 1, _speedBuffTimer: 0,
      _overcharge: false,
      skillCooldowns: {},
      _inventory: [
        { type: 'repair_pack', qty: 2 },
        { type: 'speed_boost', qty: 1 },
      ],
      sprite, _nameplate: nameplate, _hullGfx: hullGfx,
      // Mob-like takeDamage interface used by Projectile + _fireLaser
      takeDamage(dmg, pen, opts) {
        if (!this.alive) return { killed: false, hullHit: 0, shieldHit: 0 };
        if (this.evasion > 0 && Math.random() < this.evasion) {
          return { killed: false, hullHit: 0, shieldHit: 0, dodged: true };
        }
        const effDmg  = dmg * (1 - (this.damageResist ?? 0));
        const penFrac = pen ?? 0;
        const direct  = effDmg * penFrac;
        const toShd   = effDmg - direct;
        const shdMult  = opts?.shieldMult ?? 1.0;
        const hullMult = opts?.hullMult   ?? 1.0;
        let shHit = 0, hullHit = 0, brokeShield = false;
        if (this.shield > 0) {
          const shAbs = Math.min(this.shield, toShd * shdMult);
          this.shield = Math.max(0, this.shield - shAbs);
          shHit = shAbs;
          const overflow = Math.max(0, toShd - shAbs / shdMult);
          hullHit = (overflow + direct) * hullMult;
          if (this.shield <= 0) brokeShield = true;
        } else {
          hullHit = effDmg * hullMult;
        }
        this.hull = Math.max(0, this.hull - hullHit);
        if (this.hull <= 0 && this.alive) {
          this.alive = false;
          scene._endShadowBattle('win');
        }
        return { killed: false, hullHit, shieldHit: shHit, brokeShield, dodged: false };
      },
    };

    // ── Обратный отсчёт ───────────────────────────────────────────────────
    this._shadowCountdown = 3.0;
    const W = this.scale.width, H = this.scale.height;
    this._shadowCdTxt = this.add.text(W / 2, H / 2 - 80, '3', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '96px', color: '#4dd0e1',
      stroke: '#000000', strokeThickness: 8, resolution: UI_RES,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(210);

    // ── Auto-target bot (цель без автострельбы до конца отсчёта) ──────────
    this.target = this.botPilot;
    this.isFiring = false;
  }

  _updateBotPilot(dt) {
    if (!this.botPilot || !this.botPilot.alive || this._shadowBattleDone) return;
    const b   = this.botPilot;
    const p   = this.player;
    const now = this.time.now;

    // ── Обратный отсчёт ───────────────────────────────────────────────────
    if (this._shadowCountdown > 0) {
      this._shadowCountdown -= dt;
      // Заморозить игрока — очищать waypoint каждый кадр
      this.movement.setWaypoint(null);
      this.isFiring = false;
      // Обновить текст
      if (this._shadowCdTxt?.active) {
        if (this._shadowCountdown > 0) {
          const n = Math.ceil(this._shadowCountdown);
          this._shadowCdTxt.setText(`${n}`).setColor(n === 1 ? '#ef5350' : n === 2 ? '#ffcc44' : '#4dd0e1');
        } else {
          this._shadowCdTxt.setText('БОЙ!').setColor('#88ff88').setFontSize('64px');
          this.time.delayedCall(700, () => { this._shadowCdTxt?.destroy(); this._shadowCdTxt = null; });
          this.isFiring = true;
          this.log('Бой с тенью начался!');
        }
      }
      return; // бот стоит во время отсчёта
    }

    // Shield regen
    b.shield = Math.min(b.maxShield, b.shield + b.shieldRegen * dt);
    // Hull regen (ship passive, e.g. Argosy)
    if (b.hullRegen > 0) b.hull = Math.min(b.maxHull, b.hull + b.hullRegen * dt);

    // Speed buff timer
    if (b._speedBuffTimer > 0) { b._speedBuffTimer -= dt; if (b._speedBuffTimer <= 0) b._speedMult = 1; }

    const dist    = Phaser.Math.Distance.Between(b.x, b.y, p.x, p.y);
    const hullPct = b.hull / b.maxHull;

    // ── AI state machine ───────────────────────────────────────────────────
    if (hullPct < 0.20)    b._aiState = 'flee';
    else if (dist > 900)   b._aiState = 'approach';
    else if (dist < 280)   b._aiState = 'retreat';
    else                   b._aiState = 'strafe';

    // ── Projectile dodge ──────────────────────────────────────────────────
    if (b._dodgeTimer > 0) {
      b._dodgeTimer -= dt;
    } else {
      for (const proj of this.projectiles) {
        if (proj.owner !== 'player' || proj.dead) continue;
        const pd = Phaser.Math.Distance.Between(proj.sprite.x, proj.sprite.y, b.x, b.y);
        if (pd < 180) {
          b.heading += (Math.random() < 0.5 ? 1 : -1) * Math.PI * 0.55;
          b._dodgeTimer = 0.45;
          break;
        }
      }
    }

    // ── Movement ──────────────────────────────────────────────────────────
    let targetAngle;
    let spd = b.speed * b._speedMult;
    if (b._aiState === 'approach') {
      targetAngle = Math.atan2(p.y - b.y, p.x - b.x);
    } else if (b._aiState === 'retreat' || b._aiState === 'flee') {
      targetAngle = Math.atan2(b.y - p.y, b.x - p.x);
      spd *= 1.35;
    } else {
      b._strafeTimer -= dt;
      if (b._strafeTimer <= 0) {
        b._strafeDir   *= -1;
        b._strafeTimer  = Phaser.Math.FloatBetween(1.2, 2.0);
      }
      targetAngle = Math.atan2(p.y - b.y, p.x - b.x) + Math.PI / 2 * b._strafeDir;
    }

    // ── Уклонение от стен — приоритет над dodge/AI ───────────────────────
    const WALL_M = 260;
    const nearLeft  = b.x < WALL_M, nearRight  = b.x > this.worldWidth  - WALL_M;
    const nearTop   = b.y < WALL_M, nearBottom = b.y > this.worldHeight - WALL_M;
    if (nearLeft || nearRight || nearTop || nearBottom) {
      // Стрельба к центру карты с небольшим смещением к игроку
      const cx = this.worldWidth / 2, cy = this.worldHeight / 2;
      const toCenter = Math.atan2(cy - b.y, cx - b.x);
      const toPlayer = Math.atan2(p.y - b.y, p.x - b.x);
      targetAngle = Phaser.Math.Angle.RotateTo(toCenter, toPlayer, 0.4);
    }

    if (b._dodgeTimer <= 0) {
      b.heading = Phaser.Math.Angle.RotateTo(b.heading, targetAngle, 4.5 * dt);
    }

    const margin = 80;
    b.x = Phaser.Math.Clamp(b.x + Math.cos(b.heading) * spd * dt, margin, this.worldWidth  - margin);
    b.y = Phaser.Math.Clamp(b.y + Math.sin(b.heading) * spd * dt, margin, this.worldHeight - margin);
    b.sprite.body.velocity.x = Math.cos(b.heading) * spd * DPR;
    b.sprite.body.velocity.y = Math.sin(b.heading) * spd * DPR;

    // Update sprite
    b.sprite.setPosition(b.x, b.y);
    b.sprite.setRotation(b.heading + (b.shipDef.artAngleOffset ?? ART_ANGLE_OFFSET));

    // Nameplate + hull bar above bot
    const npY = b.y - b.shipDef.displaySize / 2 - 10;
    b._nameplate.setPosition(b.x, npY);
    b._hullGfx.clear();
    const bw = 60, bh = 5;
    b._hullGfx.fillStyle(0x111a22, 0.9); b._hullGfx.fillRect(b.x - bw / 2, npY - 20, bw, bh);
    b._hullGfx.fillStyle(0xef5350);      b._hullGfx.fillRect(b.x - bw / 2, npY - 20, bw * Math.max(0, b.hull / b.maxHull), bh);
    b._hullGfx.fillStyle(0x111a22, 0.9); b._hullGfx.fillRect(b.x - bw / 2, npY - 14, bw, 3);
    b._hullGfx.fillStyle(COLORS.primary); b._hullGfx.fillRect(b.x - bw / 2, npY - 14, bw * Math.max(0, b.shield / b.maxShield), 3);

    // ── Auto-fire at player (predictive aim) ───────────────────────────────
    b.fireCooldown -= dt;
    if (b.fireCooldown <= 0 && dist < 1400 && b._aiState !== 'flee') {
      b.fireCooldown = b.baseFireRate;
      const pBody = p.sprite?.body;
      const pvx = pBody ? pBody.velocity.x / DPR : 0;
      const pvy = pBody ? pBody.velocity.y / DPR : 0;
      const aim = _leadTarget(b.x, b.y, p.x, p.y, pvx, pvy, PROJECTILE.speed);
      this._botShootAt(aim.x, aim.y);
    }

    // ── Overcharge shot: next bolt double damage ───────────────────────────
    // (flag is consumed in _botShootAt)

    // ── Skill check every 0.5s ────────────────────────────────────────────
    b._skillCheckTimer -= dt;
    if (b._skillCheckTimer <= 0) {
      b._skillCheckTimer = 0.5;
      this._botSkillCheck(now, dist, hullPct);
    }

    // Check if player died
    if (!p.alive && !this._shadowBattleDone) this._endShadowBattle('lose');
  }

  _botShootAt(tx, ty) {
    const b = this.botPilot;
    if (!b?.alive) return;
    const pType = b.weaponType === 'laser' ? 'void' : 'plasma';
    const dmg = Math.round(b.weaponDamage * (b._overcharge ? 2.0 : 1.0));
    b._overcharge = false;
    const dmgOpts = b.weaponType === 'laser'
      ? { shieldMult: b.weaponShieldMult, hullMult: b.weaponHullMult }
      : {};
    this.fireMobWeapon({
      tpl: { projectileType: pType }, damage: dmg,
      x: b.x, y: b.y, isBoss: false, level: 1,
    }, tx, ty, this.player, dmgOpts);
  }

  _botSkillCheck(now, dist, hullPct) {
    const b = this.botPilot;
    if (!b?.alive) return;
    const cdReady = (key, ms) => (b.skillCooldowns[key] || 0) < now && ((b.skillCooldowns[key] = now + ms) || true);
    const invItem = (type) => { const it = b._inventory.find(i => i.type === type); return it?.qty > 0 ? it : null; };

    // ── Корабельная способность ────────────────────────────────────────────
    const sKey = b.shipDef?.activeSkill?.key;
    if (sKey === 'ship:argosy_repair' && hullPct < 0.80 && cdReady(sKey, 55000)) {
      const heal = Math.round(b.maxHull * 0.25);
      b.hull = Math.min(b.maxHull, b.hull + heal);
      this.log(`Тень: ремонт корабля +${heal} HP`);
      return;
    }
    if (sKey === 'ship:helion_volley' && dist < 900 && cdReady(sKey, 40000)) {
      // Залп — 5 выстрелов с интервалом 100мс
      for (let i = 0; i < 5; i++) {
        this.time.delayedCall(i * 110, () => {
          if (!this.botPilot?.alive || !this.player?.alive) return;
          const _pb = this.player.sprite?.body;
          const aim = _leadTarget(this.botPilot.x, this.botPilot.y, this.player.x, this.player.y,
            _pb ? _pb.velocity.x / DPR : 0, _pb ? _pb.velocity.y / DPR : 0, PROJECTILE.speed);
          this._botShootAt(aim.x, aim.y);
        });
      }
      this.log('Тень: залп!');
      return;
    }
    if (sKey === 'ship:drifter_jump' && (hullPct < 0.50 || dist < 220) && cdReady(sKey, 60000)) {
      // Тактический прыжок в направлении движения
      const jd = 700;
      b.x = Phaser.Math.Clamp(b.x + Math.cos(b.heading) * jd, 80, this.worldWidth  - 80);
      b.y = Phaser.Math.Clamp(b.y + Math.sin(b.heading) * jd, 80, this.worldHeight - 80);
      b.sprite.setPosition(b.x, b.y);
      return;
    }

    // ── emergency_repair (скилл, КД как у игрока) ─────────────────────────
    if (hullPct < 0.45 && cdReady('emergency_repair', 120000)) {
      const heal = Math.round(b.maxHull * 0.30);
      b.hull = Math.min(b.maxHull, b.hull + heal);
      this.log(`Тень: аварийный ремонт +${heal} HP`);
      return;
    }

    // ── repair_pack (расходник, собственный КД 35s чтобы не спамить) ──────
    if (hullPct < 0.60) {
      const it = invItem('repair_pack');
      if (it && cdReady('repair_pack', 35000)) {
        it.qty--;
        const heal = Math.round(b.maxHull * 0.30);
        b.hull = Math.min(b.maxHull, b.hull + heal);
        this.log(`Тень использует ремкомплект (+${heal} HP)`);
        return;
      }
    }

    // ── shield_burst ───────────────────────────────────────────────────────
    if (b.shield / b.maxShield < 0.65 && cdReady('shield_burst', 85000)) {
      b.shield = Math.min(b.maxShield, b.shield + b.maxShield * 0.90);
      this.log('Тень: восстановление щита');
      return;
    }

    // ── stealth_sprint (ускорение при ближнем бое) ─────────────────────────
    if (dist < 400 && cdReady('stealth_sprint', 55000)) {
      b._speedMult = 1.5; b._speedBuffTimer = 3;
      return;
    }

    // ── speed_boost consumable (бегство при критическом HP) ───────────────
    if (hullPct < 0.22) {
      const it = invItem('speed_boost');
      if (it && cdReady('speed_boost', 120000)) {
        it.qty--; b._speedMult = 1.6; b._speedBuffTimer = 15;
        return;
      }
    }

    // ── overcharge_shot ────────────────────────────────────────────────────
    if (dist < 650 && !b._overcharge && cdReady('overcharge_shot', 25000)) {
      b._overcharge = true;
      return;
    }

    // ── berserker (агрессия при высоком HP) ───────────────────────────────
    if (hullPct > 0.55 && cdReady('berserker', 90000)) {
      b._speedMult = 1.25; b._speedBuffTimer = 8;
    }
  }

  _endShadowBattle(result) {
    if (this._shadowBattleDone) return;
    this._shadowBattleDone = true;
    this.isFiring = false;
    this.target = null;

    const W = this.scale.width, H = this.scale.height;
    const cx = W / 2, cy = H / 2;
    const TF  = (sz, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: sz, color: c, resolution: UI_RES });
    const TFI = (sz, c) => ({ fontFamily: 'Inter, sans-serif', fontSize: sz, color: c, resolution: UI_RES });

    let xpGain = 0, credGain = 0, honorGain = 0;
    if (result === 'win') {
      xpGain   = 3500;
      credGain = 12000;
      const bPow = this.botPilot ? this._shadowBotPower() : 0;
      const pPow = this._shadowPlayerPower();
      if (bPow > pPow) honorGain = Math.round(50 * (bPow / Math.max(1, pPow)));
      this.gainXp(xpGain);
      this.credits    = (this.credits    || 0) + credGain;
      this.pilotHonor = (this.pilotHonor || 0) + honorGain;
    }

    const panH = 290, panW = 460;
    const objs = [];
    const reg  = (o) => { objs.push(o); return o; };

    reg(this.add.rectangle(cx, cy, panW, panH, 0x040c18, 0.97)
      .setStrokeStyle(2, result === 'win' ? COLORS.primary : 0xef5350, 0.9)
      .setScrollFactor(0).setDepth(200));

    reg(this.add.text(cx, cy - panH / 2 + 34,
      result === 'win' ? '✓  ПОБЕДА' : '✗  ПОРАЖЕНИЕ',
      TF('28px', result === 'win' ? '#4dd0e1' : '#ef5350'))
      .setOrigin(0.5).setScrollFactor(0).setDepth(201));

    if (result === 'win') {
      reg(this.add.text(cx, cy - 30, `+${xpGain.toLocaleString()} XP`,        TF('17px', '#88ff88')).setOrigin(0.5).setScrollFactor(0).setDepth(201));
      reg(this.add.text(cx, cy - 6,  `+${credGain.toLocaleString()} кредитов`, TF('15px', '#ffcc44')).setOrigin(0.5).setScrollFactor(0).setDepth(201));
      const honorLine  = honorGain > 0 ? `+${honorGain} чести` : 'Честь не начислена (противник слабее)';
      const honorColor = honorGain > 0 ? '#aaddff' : '#557788';
      reg(this.add.text(cx, cy + 18, honorLine, TFI('13px', honorColor)).setOrigin(0.5).setScrollFactor(0).setDepth(201));
    } else {
      reg(this.add.text(cx, cy - 10, 'Тень оказалась сильнее.', TFI('15px', '#bb6666')).setOrigin(0.5).setScrollFactor(0).setDepth(201));
    }

    const closeY = cy + panH / 2 - 44;
    [
      { x: cx - 100, label: 'НА БАЗУ', color: COLORS.primary, fill: 0x0d2233, hover: 0x1a3a50, action: () => this.exitShadowBattle() },
      { x: cx + 100, label: 'РЕВАНШ',  color: 0xccbb44, fill: 0x1a1a0d, hover: 0x2a2a10,
        action: () => { this._shadowBattleDone = false; this._cleanupBotPilot(); document.getElementById('scene-overlay')?.classList.add('active'); this.scene.restart(); } },
    ].forEach(({ x, label, color, fill, hover, action }) => {
      const btn = reg(this.add.rectangle(x, closeY, 180, 42, fill)
        .setStrokeStyle(1, color, 0.8).setInteractive({ useHandCursor: true })
        .setScrollFactor(0).setDepth(201));
      reg(this.add.text(x, closeY, label, TF('14px', `#${color.toString(16).padStart(6, '0')}`))
        .setOrigin(0.5).setScrollFactor(0).setDepth(202));
      btn.on('pointerdown', action);
      btn.on('pointerover', () => btn.setFillStyle(hover));
      btn.on('pointerout',  () => btn.setFillStyle(fill));
    });

    this._shadowResultObjs = objs;
  }

  _shadowBotPower() {
    const b = this.botPilot;
    if (!b) return 0;
    return b.maxHull * 0.4 + b.maxShield * 0.6 + b.weaponDamage * 14 + b.speed * 5;
  }

  _shadowPlayerPower() {
    const p = this.player;
    return (p?.maxHull || 1000) * 0.4 + (p?.maxShield || 500) * 0.6
      + (p?.weaponDamage || 100) * 14 + (p?.baseSpeed || 200) * 5
      + (this.pilotLevel || 1) * 60;
  }

  // ── Training dummies [DEV key 7] ─────────────────────────────────────────
  _toggleTrainingDummies() {
    if (this._trainingDummies?.length) {
      if (this._trainingDummies.includes(this.target)) this.selectTarget(null);
      this._trainingDummies.forEach(d => {
        d.destroy();
        const i = this.mobs.indexOf(d);
        if (i !== -1) this.mobs.splice(i, 1);
      });
      this._trainingDummies = [];
      this.log('DEV: Тренажёры убраны');
      return;
    }
    const p = this.player;
    this._trainingDummies = [
      this._makeTrainingDummy({ x: p.x + 380, y: p.y - 130, hull: 300000, shield: 0 }),
      this._makeTrainingDummy({ x: p.x + 380, y: p.y + 130, hull: 150000, shield: 150000 }),
    ];
    this._trainingDummies.forEach(d => this.mobs.push(d));
    this.log('DEV: Тренажёры [7] — корпус 30k | щит+корп 15k+15k');
  }

  _makeTrainingDummy({ x, y, hull, shield }) {
    const scene = this;
    const R = 28;
    const hasShield = shield > 0;
    const edgeClr   = hasShield ? 0x4dd0e1 : 0xef9a4a;

    const bodyGfx = scene.add.graphics().setDepth(40);
    bodyGfx.fillStyle(hasShield ? 0x091520 : 0x1a0a00, 0.90);
    bodyGfx.fillCircle(x, y, R);
    bodyGfx.lineStyle(3, edgeClr, 1);
    bodyGfx.strokeCircle(x, y, R);
    bodyGfx.lineStyle(1, edgeClr, 0.35);
    bodyGfx.lineBetween(x - R, y, x + R, y);
    bodyGfx.lineBetween(x, y - R, x, y + R);

    const barGfx = scene.add.graphics().setDepth(42);
    const lbl = scene.add.text(x, y - R - 20,
      hasShield ? 'ЩИТ+КОР' : 'КОРПУС',
      { fontFamily: 'Orbitron', fontSize: '11px', color: hasShield ? '#4dd0e1' : '#ef9a4a', resolution: 2 }
    ).setOrigin(0.5).setDepth(43);

    const dummy = {
      isTrainingDummy: true,
      alive: true,
      maxHull: hull, hull,
      maxShield: shield, shield,
      evasion: 0,
      neutral: true, passive: false,
      group: [], leader: null,
      lastDamageAt: 0,
      _x: x, _y: y,
      get x() { return this._x; },
      get y() { return this._y; },
      tpl: { displaySize: R * 2, key: '_dummy_', boss: false, nameKey: '' },
      sprite: { x, y, body: { velocity: { x: 0, y: 0 } } },
      bar:   { setVisible() {} },
      label: { setVisible() {} },
      update() {},
    };

    const drawBars = () => {
      barGfx.clear();
      const bw = 80, bx = x - bw / 2, by = y - R - 10;
      barGfx.fillStyle(0x111a22, 0.9);
      barGfx.fillRect(bx, by, bw, 5);
      barGfx.fillStyle(0xef9a4a);
      barGfx.fillRect(bx, by, bw * Math.max(0, dummy.hull / dummy.maxHull), 5);
      if (dummy.maxShield > 0) {
        barGfx.fillStyle(0x111a22, 0.9);
        barGfx.fillRect(bx, by - 8, bw, 5);
        barGfx.fillStyle(0x4dd0e1);
        barGfx.fillRect(bx, by - 8, bw * Math.max(0, dummy.shield / dummy.maxShield), 5);
      }
    };

    dummy.takeDamage = function(amount, penetration = 0, opts = {}) {
      if (!this.alive) return { shieldHit: 0, hullHit: 0, killed: false };
      this.lastDamageAt = scene.time.now;
      const shieldMult  = opts.shieldMult ?? 1;
      const hullMult    = opts.hullMult   ?? 1;
      const direct      = amount * penetration;
      const toShieldRaw = amount - direct;
      let hullHit = 0, shieldHit = 0;
      if (this.shield > 0) {
        hullHit = direct * hullMult;
        const toShield = toShieldRaw * shieldMult;
        shieldHit = toShield;
        if (toShield <= this.shield) { this.shield -= toShield; }
        else { hullHit += (toShield - this.shield) * hullMult; this.shield = 0; }
      } else {
        hullHit = amount * hullMult;
      }
      this.hull = Math.max(0, this.hull - hullHit);
      drawBars();
      if (this.hull <= 0) {
        scene.time.delayedCall(2500, () => {
          if (!this.alive) return;
          this.hull   = this.maxHull;
          this.shield = this.maxShield;
          drawBars();
        });
      }
      return { shieldHit, hullHit, killed: false };
    };

    dummy.destroy = function() {
      this.alive = false;
      bodyGfx.destroy();
      barGfx.destroy();
      lbl.destroy();
    };

    drawBars();
    return dummy;
  }

  shutdown() {
    this._prevSector = galaxy.current;
    this._saveState();
    this._cleanupBotPilot();
    this.escortTransport?.destroy();
    this.escortTransport = null;
    this._escortMobs = null;
    this._trainingDummies?.forEach(d => d.destroy());
    this._trainingDummies = null;
    this.argusCtrl?.destroy();
    this.argusCtrl = null;
    this.confedGuards?.destroy();
    this.confedGuards = null;
    this._apophisPulseTween?.stop();
    this._apophisPulseTween = null;
    for (const r of (this._apophisRings ?? [])) r.destroy();
    this._apophisRings = null;
    this._apophisBoss = null;
    this._adminCh?.postMessage({ type: 'GAME_STATE', alive: false, playerName: this.playerName ?? 'Player' });
    this._adminCh?.close();
    this._adminCh = null;
  }

  // ── Persistence ───────────────────────────────────────────────────

  _serializeState() {
    return {
      playerName:          this.playerName,
      pilotXp:             this.pilotXp,
      pilotHonor:          this.pilotHonor,
      credits:             this.credits,
      starGold:            this.starGold,
      corpRep:             this.corpRep,
      seasonWon:           this.seasonWon,
      premium:             this.premium,
      activeShip:          this.activeShip,
      ownedShips:          [...(this.ownedShips || [])],
      shipLevels:          this.shipLevels  || {},
      equipped:            this.equipped    || {},
      inventory:           this.inventory   || [],
      warehouse:           this.warehouse   || [],
      skillLevels:         this.skillLevels || {},
      actionBar:           this.actionBar   || [],
      ammoSlots:           this.ammoSlots   || [],
      respeckCount:        this.respeckCount        || 0,
      skillAchievementSP:  this.skillAchievementSP  || 0,
      currentSector:       galaxy.current === 'shadow_arena' ? (this._shadowPrevSector || 'helios_1') : galaxy.current,
      playerCorp:          this.playerCorp          || 'neutral',
      lootBySector:        this._serializeLoot(),
      missionState:        this.missionState        || {},
      missionDailyReset:   this.missionDailyReset   || 0,
      plasmateToday:       this.plasmateToday        || 0,
      plasmateDayReset:    this.plasmateDayReset      || 0,
      clan:                this.clan                  ?? null,
      lastGuardReset:      this.lastGuardReset         || {},
    };
  }

  _applyLoadedState(s) {
    if (!s || !Object.keys(s).length) return;
    if (s.playerName         != null) this.playerName         = s.playerName;
    if (s.pilotXp            != null) this.pilotXp            = s.pilotXp;
    if (s.pilotHonor         != null) this.pilotHonor         = s.pilotHonor;
    if (s.credits            != null) this.credits            = s.credits;
    if (s.starGold           != null) this.starGold           = s.starGold;
    if (s.corpRep            != null) this.corpRep            = s.corpRep;
    if (s.seasonWon          != null) this.seasonWon          = s.seasonWon;
    if (s.premium            != null) this.premium            = s.premium;
    if (s.activeShip         != null) this.activeShip         = s.activeShip;
    if (s.ownedShips         != null) this.ownedShips         = new Set(s.ownedShips);
    if (s.shipLevels         != null) this.shipLevels         = s.shipLevels;
    if (s.equipped           != null) this.equipped           = s.equipped;
    if (s.inventory          != null) this.inventory          = s.inventory;
    if (s.warehouse          != null) this.warehouse          = s.warehouse;
    if (s.skillLevels        != null) this.skillLevels        = s.skillLevels;
    if (s.actionBar          != null) this.actionBar          = s.actionBar;
    if (s.ammoSlots          != null) this.ammoSlots          = s.ammoSlots;
    if (s.respeckCount       != null) this.respeckCount       = s.respeckCount;
    if (s.skillAchievementSP != null) this.skillAchievementSP = s.skillAchievementSP;
    if (s.currentSector != null && SECTORS[s.currentSector]) {
      const restoredSec = SECTORS[s.currentSector];
      if (s.currentSector === 'R-1-boss' || s.currentSector === 'shadow_arena') {
        // Персональные/boss арены без базы: редирект на домашний сектор
        const corp  = s.playerCorp || 'helios';
        const level = levelInfo(s.pilotXp || 0).level;
        galaxy.current = _bestHomeSector(corp, level);
      } else if (restoredSec.pvp) {
        // PvP: остаёмся в секторе, спавним у базы корпорации
        galaxy.current = s.currentSector;
        this._reconnectPvpCorp = s.playerCorp || 'helios';
      } else {
        // Обычный сектор или данж — возвращаем как есть (данж: лут сохранён)
        galaxy.current = s.currentSector;
      }
    }
    if (s.lootBySector       != null) this._lootBySector      = s.lootBySector;
    if (s.playerCorp         != null) this.playerCorp         = s.playerCorp;
    if (s.missionState       != null) this.missionState       = s.missionState;
    if (s.missionDailyReset  != null) this.missionDailyReset  = s.missionDailyReset;
    if (s.plasmateToday      != null) this.plasmateToday      = s.plasmateToday;
    if (s.plasmateDayReset   != null) this.plasmateDayReset   = s.plasmateDayReset;
    if (s.clan               !== undefined) this.clan         = s.clan;
    if (s.lastGuardReset     != null) this.lastGuardReset    = s.lastGuardReset;
  }

  _saveState() {
    if (!getToken()) return;
    const state = this._serializeState();
    try { localStorage.setItem('stellar_drift_state_' + getUsername(), JSON.stringify(state)); } catch (_) {}
    apiPut('/player/state', state).catch(() => {});
  }

  _serializeLoot() {
    const sec = SECTORS[galaxy.current];
    // PvP-арены: лут не сохраняем (дропа нет по геймдизайну)
    if (sec?.pvp) return this._lootBySector || {};

    const currentLoot = (this.loot || [])
      .filter(l => l.alive)
      .map(l => ({ x: Math.round(l.x), y: Math.round(l.y), item: l.item }));

    const map = { ...(this._lootBySector || {}) };
    if (currentLoot.length > 0) {
      map[galaxy.current] = currentLoot;
    } else {
      delete map[galaxy.current]; // сектор пустой — убираем из карты
    }
    return map;
  }
}
