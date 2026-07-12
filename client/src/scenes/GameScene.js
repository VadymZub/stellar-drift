import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { COLORS, BASE_WORLD, PVP_WORLD_SCALE, PLAYER, MOBS, PROJECTILE, PROJ_TYPES, RESPAWN_MS, UI_RES, BOSS, DPR, HANDLING, ART_ANGLE_OFFSET, RANKS, BASE_SCAN_RADIUS, HONOR, DUNGEON_DIFF, DUNGEON_MODIFIERS, DUNGEON_BOSS_DROPS, DUNGEON_STAR_GOLD, dungeonLootNorm, WORLD_EVENT_SECTORS, WORLD_EVENT_STRENGTH_MULT, WORLD_EVENT_WAVE1_FRAC, WORLD_EVENT_WAVE2_DELAY_MS, WORLD_EVENT_WINDOW_MS } from '../constants.js';
import { minimapRect, minimapToWorld } from '../systems/minimap.js';
import { i18n } from '../i18n.js';
import Player from '../entities/Player.js';
import Mob from '../entities/Mob.js';
import Projectile from '../entities/Projectile.js';
import Loot from '../entities/Loot.js';       
import Movement from '../systems/Movement.js';
import { EXP_CLASSES, MOD_ICON_FILES, NPC_PORTRAITS } from './BootScene.js'; 
import { rollLootForMob, rollHomeSectorLoot, dropChance, itemName, rollStarGold, starterCannon, starterShield, rollCannon, rollShield, rollEngine, rollLaser, rollArmor, rollApophisLoot, PLASMATE_PER_SLOT, PLASMATE_DAILY_MAX, addPlasmateToInventory, totalPlasmateInInventory, removePlasmateFromInventory, CONSUMABLES, addConsumableToInventory, countConsumableInInventory, removeConsumableFromInventory, rollConsumableDrop, rollAmmoDrop, MATERIAL_NAMES, RESOURCE_NAMES } from '../items.js';
import { rollBoard, rollConnector } from '../boards.js';
import PlasmateDeposit from '../entities/PlasmateDeposit.js';
import AnomalySignal, { ANOMALY_SCAN_RADIUS, ANOMALY_SCAN_TIME_MS } from '../entities/AnomalySignal.js';
import { rollPerk, perkBonus, PERK_DEFS } from '../perks.js';
import { levelInfo, xpToNext, MAX_LEVEL } from '../leveling.js';
import { SHIPS, SHIP_BY_KEY, shipLevelMods } from '../ships.js';
import { SECTORS, galaxy, neighbors, edgeDir, sectorAccess } from '../galaxy.js';
import { calculateRating, getRank } from '../ranking.js';
import VFXManager from '../systems/VFXManager.js';
import SoundManager from '../systems/SoundManager.js';
import MiningBase, { TBAR_W, TBAR_H } from '../entities/MiningBase.js';
import { BASE_CONFIG } from '../bases.js';
import HomeBase from '../entities/HomeBase.js';
import ArgusController from '../systems/ArgusController.js';
import ConfedGuardSystem, { getLastResetTime } from '../systems/ConfedGuardSystem.js';
import { getUsername, getToken, apiPut, apiGet, dungeonEnter, dungeonMobKilled, dungeonLootDrop, dungeonLootCollected, dungeonCorridorState, dungeonDeath, dungeonComplete, miningBaseSector } from '../api.js';
import { prepShipTex, removeWhiteBg } from '../utils/prepShipTex.js';
import { MISSIONS, getMissionSectorTarget, matchKillObjective, dailyBracketFor } from '../data/missions.js';
import { DUNGEON_LAYOUTS, DUNGEON_BOSS_KIT } from '../data/dungeonLayouts.js';
import EscortTransport, { ESCORT_SPEED, ESCORT_WAVE_AT } from '../entities/EscortTransport.js';
import { loadSettings, getMinimapDims } from '../settings.js';
import SettingsScene from './SettingsScene.js';
import { startAfkGuard } from '../systems/afkGuard.js';

const PICKUP_RADIUS = 95;
const PICKUP_TIME = 2000;
// Розыск оправдан только при реальном разрыве в силе — младше на 1-2 уровня не
// считается: жертва должна быть минимум на столько уровней ниже обидчика.
const BOUNTY_LEVEL_GAP = 3;

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
    pvp_5:    [    0, -5296],                 // top edge, center → Сердце Бездны
  },
  pvp_5: {                                    // Layout D
    helios_5:   [-9658, -5296],               // NW corner
    karax_5:    [+9658, -5296],               // NE corner
    tides_5:    [    0, +5296],               // S-center
    'R-1-boss': [+9658,     0],               // right edge, center
    pvp_4:      [-9658,     0],               // left edge, center → Нейтральная Зона
  },
};

export default class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  create(data) {
    // Общий анти-AFK (не привязан к базам) — 5 мин без ввода = дисконнект, см.
    // client/src/systems/afkGuard.js. Idempotent, безопасно дёргать на каждом
    // scene.restart() (переход между секторами).
    startAfkGuard();

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

    // Realtime-комната для этого захода — считаем РАНО: нужна уже в spawnMobs() ниже
    // (мобы получают pvpMobId по этому ключу, чтобы шариться между игроками одной
    // комнаты). null — соло-данж (никого больше там физически быть не может) и
    // Shadow Arena (бой с ботом) — см. _currentRealtimeRoomKey().
    this._isPvpSector    = isPvp;
    this._realtimeRoomKey = this._currentRealtimeRoomKey();

    const worldScale = galaxy.current === 'shadow_arena' ? 0.5 : galaxy.current === 'R-1-boss' ? 2.5 : scale;
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
    if (galaxy.current === 'R-1-boss' && !data?.startX) {
      startX = this.worldWidth - 400; startY = cy;  // near entry gate at right edge
    }
    if (this._reconnectPvpCorp) {
      const pos = this.homeBasePositions?.[this._reconnectPvpCorp];
      if (pos) { startX = pos.x; startY = pos.y + 80; }
      this._reconnectPvpCorp = null;
    }
    this.player = new Player(this, startX, startY, this.objScale);
    this.movement = new Movement(this, this.player);

    // Realtime-присутствие (позиции живых игроков) — везде, кроме соло-данжа/босс-карты
    // (там больше некому быть) и Shadow Arena (бой с ботом). Бой между игроками
    // (fire_claim) — только в реальных PvP-секторах, см. _isPvpSector.
    if (this._realtimeRoomKey) {
      this.pvpClient?.enterSector(this._realtimeRoomKey, this.player.x, this.player.y, this._pvpLoadoutSnapshot());
    } else {
      this.pvpClient?.leaveSector();
    }

    this.cameras.main.startFollow(this.player.sprite, false, 0.35, 0.35);
    this.cameras.main.setZoom(DPR);
    this.cameras.main.roundPixels = true;
    // Snap camera to spawn position immediately (prevents visible drift on restart)
    this.cameras.main.setScroll(startX - this.scale.width / (2 * DPR), startY - this.scale.height / (2 * DPR));

    this.reticle = this.add.graphics().setDepth(45);
    this.target = null;
    this.isFiring = false;

    // ОДИН общий Graphics-канвас для HP/shield-баров ВСЕХ мобов (см. _redrawMobBars) —
    // раньше каждый Mob держал СВОЙ Graphics-объект; на карте с десятками мобов
    // ("expanded home map spawns") это N отдельных вызовов GraphicsWebGLRenderer.
    // renderWebGLStep КАЖДЫЙ кадр (профилировка: 33-47% времени кадра), независимо
    // от того, менялось ли хп/щит — рендер объекта, в отличие от передрава его
    // геометрии, ничем не гейтится. Один канвас = один вызов рендерера на всех мобов.
    this.mobBarsGfx = this.add.graphics().setDepth(41);

    // Тот же принцип для баз/турелей — каждая MiningBase раньше держала ~21 отдельный
    // Rectangle-объект (свой бар ×3 + 6 турелей ×3), что на PvP-картах с несколькими
    // базами давало сравнимый с мобовскими барами render-overhead ДАЖЕ когда мобов
    // на карте почти нет — см. GameScene._redrawMiningBaseBars().
    this.miningBaseBarsGfx = this.add.graphics().setDepth(7);

    this.mobs = [];
    this.projectiles = [];
    this.loot = [];
    this.plasmateDeposits = [];
    this.anomaly = null;
    this._anomalyRespawnAt = 0;
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
    galaxy.dungeonDiff = this.dungeonDifficulty;
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
    this.magnetEnabled        = _cfg.autoLoot;
    this._autoTargetEnabled   = _cfg.autoTarget;
    this.autoCollectEnabled   = _cfg.autoCollect;
    // Раньше эти три настройки существовали только в SettingsScene UI/localStorage —
    // ничего в коде их не читало, тумблеры были no-op (см. SettingsScene._save()).
    this.cameraShakeEnabled   = _cfg.cameraShake;
    this.engineTrailsEnabled  = _cfg.engineTrails;
    this.bgParallaxEnabled    = _cfg.bgParallax;

    this.aoeZones = [];
    this.aoeGfx = this.add.graphics().setDepth(36);

    const trail = { lifespan: 180, speed: 0, scale: { start: 0.55, end: 0 }, alpha: { start: 0.5, end: 0 }, blendMode: 'ADD', emitting: false };
    this.trailCyan = this.add.particles(0, 0, 'glow', { ...trail, tint: 0x8fe6ff }).setDepth(59);
    this.trailRed = this.add.particles(0, 0, 'glow', { ...trail, tint: 0xff8a7a }).setDepth(59);
    // Трейлы для остальных типов снарядов мобов — раньше только plasma получала
    // шлейф, ion/acid/grav/emp летели голой затонированной капсулой без следа
    this.trailIon  = this.add.particles(0, 0, 'glow', { ...trail, tint: 0x80d8ff }).setDepth(59);
    this.trailAcid = this.add.particles(0, 0, 'glow', { ...trail, tint: 0x76ff03 }).setDepth(59);
    this.trailGrav = this.add.particles(0, 0, 'glow', { ...trail, tint: 0xffb74d }).setDepth(59);
    this.trailEmp  = this.add.particles(0, 0, 'glow', { ...trail, tint: 0x4dd0e1 }).setDepth(59);

    this.createBoostFx();

    // Прогресс данж-инстанса на сегодня (жизни/убитые мобы/лут/коридоры) —
    // получен асинхронно в _tryJump перед стартом прыжка (dungeonEnter).
    // R-1-boss-специфика (clearedCorridors/bossArenaOpen) читается в
    // createDungeonWalls()/_checkCorridorClear через this._dungeonRun.
    const _pending = sec.isDungeon ? this._pendingDungeonRun : null;
    this._pendingDungeonRun = null;
    this._dungeonRun       = _pending || null;
    this._dungeonRunId     = _pending?.runId ?? null;
    this._dungeonKilledIds = new Set(_pending?.killedMobIds ?? []);

    // Стены создаются до мобов: конструктор Mob вешает коллайдер на this.walls,
    // а точки спавна валидируются против this._wallSolids
    this.createJumpgates();
    this.createDungeonWalls();
    this.spawnMobs();

    // Restore floor loot for current sector
    if (!this._lootBySector) this._lootBySector = {};
    if (sec.isDungeon) {
      // Данж: лут инстанса хранится на сервере (DungeonRun.floor_loot), а не в
      // локальной _lootBySector — переживает выход/вход, пока живы жизни/инстанс
      for (const l of (_pending?.floorLoot ?? [])) {
        const loot = new Loot(this, l.x, l.y, l.item);
        loot.dungeonLootId = l.id;
        this.loot.push(loot);
      }
    } else {
      const floorLoot = this._lootBySector[galaxy.current] || [];
      floorLoot.forEach(l => this.loot.push(new Loot(this, l.x, l.y, l.item)));
    }

    this.spawnPlasmateDeposits();
    this.spawnDungeonDeposits();
    this._initAnomaly();
    this._initWorldEvent();
    this.setupInput();
    this.keyJ = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J);
    this.keyCtrl = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);

    this.playerRespawning = false;
    this.pendingGate = null;
    this.jumping = false;
    
    this.createSpaceDust();

    this.vfx = new VFXManager(this);
    this.sfx = new SoundManager(this);
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
      // frequency — ms между спавном частиц, а не "интенсивность": 1 = 1000
      // частиц/сек, при lifespan=800мс это ~800 частиц ОДНОВРЕМЕННО живых, все
      // пересчитываются в JS каждый кадр ТОЛЬКО во время форсажа (emitting
      // переключается в update() по p.boosting) — стабильный источник подвисания
      // именно на форсаже, не связанный с остальной профилировкой выше. 12 → тот же
      // визуальный эффект заметно реже, ~66 частиц одновременно (~12× меньше).
      frequency: 12,
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

  // ── Anomaly signal — minimap-telegraphed world event, home sectors only ──────
  _initAnomaly() {
    const sec = SECTORS[galaxy.current];
    if (sec.isDungeon || sec.personal || sec.pvp) return;
    this._scheduleAnomaly(0); // first one appears immediately on entering a fresh sector
  }

  _scheduleAnomaly(delayMs) {
    this._anomalyRespawnAt = this.time.now + delayMs;
  }

  _updateAnomaly(dt) {
    const sec = SECTORS[galaxy.current];
    if (sec.isDungeon || sec.personal || sec.pvp) return;
    if (this.anomaly) { this.anomaly.update(dt); return; }
    if (this._anomalyRespawnAt && this.time.now >= this._anomalyRespawnAt) {
      const ww = this.worldWidth, wh = this.worldHeight;
      const x = Phaser.Math.Between(300, ww - 300), y = Phaser.Math.Between(300, wh - 300);
      this.anomaly = new AnomalySignal(this, x, y);
      this._anomalyRespawnAt = 0;
    }
  }

  anomalyAt(wx, wy) {
    if (!this.anomaly?.alive) return null;
    return Phaser.Math.Distance.Between(wx, wy, this.anomaly.x, this.anomaly.y) < 60 ? this.anomaly : null;
  }

  // Called when the scan channel completes (see updateLoot()) — spawns a reward box
  // and reschedules the next signal 15-20 min out.
  _decodeAnomaly() {
    const a = this.anomaly;
    if (!a) return;
    a.collect();
    this.anomaly = null;
    this._scheduleAnomaly(Phaser.Math.Between(15, 20) * 60000);
    const reward = rollLootForMob({ tpl: { key: 'anomaly' }, level: this.pilotLevel ?? 1 });
    this.loot.push(new Loot(this, a.x, a.y, reward, 'boss'));
    this.log('📡 Аномалия расшифрована — награда ждёт на месте.');
  }

  // ── World event: mob invasion (PvP sectors only) ────────────────────────────
  // Deterministic wall-clock scheduling (same trick as ArgusController's phase
  // window) — every client computes the identical start hour for (date, sector)
  // via a hash, with no server round-trip needed to agree on "when".
  _worldEventHash(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return h;
  }

  _worldEventTodayStart(sectorKey) {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    const hour = this._worldEventHash(`${dateStr}:${sectorKey}`) % 24;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0).getTime();
  }

  _initWorldEvent() {
    this._worldEvent = null;
    const sec = SECTORS[galaxy.current];
    const cfg = WORLD_EVENT_SECTORS[galaxy.current];
    if (!sec?.pvp || !cfg) return;
    const startAt = this._worldEventTodayStart(galaxy.current);
    const now = Date.now();
    if (now < startAt || now >= startAt + WORLD_EVENT_WINDOW_MS) return; // not today's live window

    const wave1Count = Math.round(cfg.count * WORLD_EVENT_WAVE1_FRAC);
    const wave2Count = cfg.count - wave1Count;
    this._worldEvent = {
      sectorKey: galaxy.current, startAt, wave2SpawnedAt: null, mobs: [],
      damaged: false, rewardGranted: false, cleared: false, wave2Count, cfg,
    };
    this.log(`⚠ ${sec.name}: нашествие началось!`);
    this._spawnWorldEventWave(wave1Count, true);
    // Late join mid-window: catch up wave 2 immediately instead of waiting for the
    // 5-min mark to fire again (it already has, for anyone who's been here since start).
    if (now - startAt >= WORLD_EVENT_WAVE2_DELAY_MS) {
      this._worldEvent.wave2SpawnedAt = now;
      this._spawnWorldEventWave(wave2Count, false);
    }
  }

  // idx-seeded deterministic mob pick/level/position — every client spawning "mob idx N"
  // for the same (sector, startAt) independently arrives at the identical template/level,
  // so the shared pvpMobId HP ledger (lazily created on first hit) is consistent for all.
  _spawnWorldEventWave(count, isFirstWave) {
    const we = this._worldEvent;
    if (!we) return;
    const cfg = we.cfg;
    const specialKey = cfg.eliteKey || cfg.bossKey || null;
    const pool = cfg.mobPool;
    const cx = this.worldWidth / 2, cy = this.worldHeight / 2;
    const baseIdx = we.mobs.length;
    const n = (isFirstWave && specialKey) ? count - 1 : count;

    const spawnOne = (idx, key, lvl) => {
      const h = this._worldEventHash(`${we.sectorKey}:${we.startAt}:${idx}:pos`);
      const angle = (h % 360) * Math.PI / 180, dist = 600 + (h % 1400);
      const x = cx + Math.cos(angle) * dist, y = cy + Math.sin(angle) * dist;
      const m = new Mob(this, MOBS[key], lvl, x, y,
        { hpMult: WORLD_EVENT_STRENGTH_MULT, dmgMult: WORLD_EVENT_STRENGTH_MULT });
      m.isWorldEvent = true;
      m.noRespawn = true;
      if (this._realtimeRoomKey) m.pvpMobId = `we:${we.sectorKey}:${we.startAt}:${idx}`;
      this.mobs.push(m);
      we.mobs.push(m);
    };

    for (let i = 0; i < n; i++) {
      const idx = baseIdx + i;
      const h = this._worldEventHash(`${we.sectorKey}:${we.startAt}:${idx}`);
      const key = pool[h % pool.length];
      const lvl = cfg.lvlMin + (h % (cfg.lvlMax - cfg.lvlMin + 1));
      spawnOne(idx, key, lvl);
    }
    if (isFirstWave && specialKey) spawnOne(baseIdx + n, specialKey, cfg.lvlMax);
  }

  _updateWorldEvent(dt) {
    const we = this._worldEvent;
    if (!we) return;
    const now = Date.now();

    if (now >= we.startAt + WORLD_EVENT_WINDOW_MS) {
      if (!we.cleared) {
        we.mobs.forEach(m => { if (m.alive) { m.alive = false; m.sprite?.destroy(); } });
        this.log(`⚠ ${SECTORS[we.sectorKey]?.name ?? we.sectorKey}: нашествие не отражено вовремя — враг отступил без потерь.`);
      }
      this._worldEvent = null;
      return;
    }

    if (!we.wave2SpawnedAt && now >= we.startAt + WORLD_EVENT_WAVE2_DELAY_MS && we.mobs.some(m => m.alive)) {
      we.wave2SpawnedAt = now;
      this._spawnWorldEventWave(we.wave2Count, false);
      this.log(`⚠ ${SECTORS[we.sectorKey]?.name ?? we.sectorKey}: прибыло подкрепление врага!`);
    }

    if (!we.cleared && we.mobs.length && we.mobs.every(m => !m.alive)) {
      we.cleared = true;
      if (we.damaged && !we.rewardGranted) {
        we.rewardGranted = true;
        const r = we.cfg.rewards;
        this.credits = (this.credits || 0) + r.credits;
        this.gainXp(r.xp);
        if (r.stars > 0) this.starGold = (this.starGold || 0) + r.stars;
        this.log(`✅ Нашествие отражено! +${r.credits} кр · +${r.xp} XP${r.stars > 0 ? ` · +${r.stars} ★` : ''}`);
      }
      this._worldEvent = null;
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
    this.advanceMissionsByEvent('collect_resource', obj => obj.resource === 'plasmate', collected);
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
    // Незавершённая очередь амбиентных мобов из ПРЕДЫДУЩЕГО сектора — this.mobs уже
    // пересоздан ниже, а замыкания в очереди ссылались бы на протухшие pool/rnd/add
    // того сектора (scene.restart() не обнуляет обычные instance-поля сам по себе).
    this._pendingAmbientSpawns = [];

    // Shadow arena — no mobs, no bases, only BotPilot
    if (galaxy.current === 'shadow_arena') { this._initBotPilot(); return; }

    this._spawnHomeBase();

    const sec = SECTORS[galaxy.current];
    const cx = this.worldWidth / 2, cy = this.worldHeight / 2, M = MOBS;
    const Lmin = sec.lvlMin, Lmax = Math.min(50, sec.lvlMax);
    const rnd = (a, b) => Phaser.Math.Between(a, b);
    let pool, boss;
    const _diff = sec.isDungeon ? this._dungeonDiff() : null;
    // dungeonId — стабильный id слота спавна (напр. 'spot:3', 'corridor:2:bomb:5'),
    // сохраняющийся в БД-прогрессе инстанса на сутки. Если этот слот уже отмечен
    // убитым (игрок вышел и вернулся тем же днём) — не спавним его повторно.
    // Состав мобов в каждой ветке ниже детерминирован (фиксированные шаблоны/офсеты/
    // порядок; rnd() трогает только уровень, не позицию/количество) — значит id по
    // порядку создания совпадёт у всех клиентов ОДНОЙ комнаты без обмена ростером
    // через сервер (данжи детерминированы по дню — см. _dungeonVariantIndex). Тэг
    // ставим только если для этого захода вообще есть realtime-комната
    // (this._realtimeRoomKey, см. _currentRealtimeRoomKey) — соло-данж/Shadow Arena
    // её не имеют, там делиться HP не с кем.
    let _roomMobIdx = 0;
    const add = (k, lvl, ox, oy, opts, dungeonId) => {
      if (dungeonId && this._dungeonKilledIds?.has(dungeonId)) return null;
      const finalOpts = _diff ? { hpMult: _diff.mobHP, dmgMult: _diff.mobDamage, shieldBonusMult: _diff.mobShieldBonus, ...opts } : opts;
      let px = cx + ox, py = cy + oy;
      // R-1-boss: авторские позиции внутри коридоров, не двигаем.
      // pad 100 — у крупных мобов (Левиафан и пр.) корпус ~170px, при меньшем
      // отступе тело клинит на сегментах стены с самого спавна
      if (sec.isDungeon && galaxy.current !== 'R-1-boss') ({ x: px, y: py } = this._findFreeSpawn(px, py, 100));
      const m = new Mob(this, M[k], lvl, px, py, finalOpts);
      if (dungeonId) m.dungeonId = dungeonId;
      if (this._realtimeRoomKey) m.pvpMobId = `${this._realtimeRoomKey}:${_roomMobIdx++}`;
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
          sector: galaxy.current,
        });
        // Общий HP-леджер с мобами (см. PvpMobState на сервере) — id базы уже стабилен
        // и сектор-скопирован, roomKey добавляем для единообразия с мобами/группами.
        if (this._realtimeRoomKey) base.pvpMobId = `${this._realtimeRoomKey}:${base.id}`;
        this.miningBases.push(base);
        return base;
      });
      // Владение/турели/банк базы переживают ПЕРЕЗАГРУЗКУ СТРАНИЦЫ (не только рестарт
      // сцены) только через сервер — MiningBase._registry живёт лишь в JS-памяти
      // вкладки. Базы уже заспавнены синхронно с дефолтным (neutral/destroyed)
      // состоянием — фетч в фоне, без блокировки спавна; кто первым войдёт после
      // перезагрузки, догрузит актуальное состояние с сервера через ~один RTT.
      this._loadMiningBaseState(galaxy.current, miningBases);

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
      // Зов Апофиса: вертикальная звезда, 5 открытых коридоров, центральный круг закрыт
      const apophis = add('apophis', 50, 0, 0, { behavior: 'guard', patrolRadius: 100, leash: Infinity, hpMult: 15, dmgMult: 6 });
      apophis.isDungeonBoss = true;
      apophis.sprite.setAlpha(0.92);
      this._apophisBoss    = apophis;
      this._apophisRingsEnraged = false;
      this._clearedCorridors    = new Set();
      this._apophisRings   = this._createApophisRings(cx, cy);
      const _sx = apophis.sprite.scaleX, _sy = apophis.sprite.scaleY;
      this._apophisPulseTween = this.tweens.add({
        targets: apophis.sprite, scaleX: _sx * 1.12, scaleY: _sy * 1.12,
        duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      // Вертикальная 5-конечная звезда (вершина — вверх): BASE_ANGLE = -π/2
      const arenaR = 1600, corrLen = 3200;
      const CORR_ANGLES = [
        -Math.PI / 2,                          // 0: вверх (вертикальный луч)
        -Math.PI / 2 + 2 * Math.PI / 5,        // 1: верхне-правый
        -Math.PI / 2 + 4 * Math.PI / 5,        // 2: нижне-правый
        -Math.PI / 2 + 6 * Math.PI / 5,        // 3: нижне-левый
        -Math.PI / 2 + 8 * Math.PI / 5,        // 4: верхне-левый
      ];
      const CORR_HW = [310, 440, 440, 440, 440]; // вертикальный луч уже, боковые шире
      // 6 стражников на коридор (утроено): равномерно по глубине
      const GUARD_DEPTHS = [0.18, 0.32, 0.46, 0.56, 0.70, 0.84];
      const GUARD_PERPS  = [0, 0.28, -0.28, 0.28, -0.28, 0];
      for (let ci = 0; ci < 5; ci++) {
        const a = CORR_ANGLES[ci];
        const cosA = Math.cos(a), sinA = Math.sin(a);
        const pX = -sinA, pY = cosA;
        const hw = CORR_HW[ci];
        GUARD_DEPTHS.forEach((t, gi) => {
          const d = arenaR + corrLen * t;
          const pOff = hw * GUARD_PERPS[gi];
          const g = add('ancient_05', 50, d * cosA + pOff * pX, d * sinA + pOff * pY,
            { behavior: 'guard', patrolRadius: 380, leash: 3000 }, `c${ci}:guard:${gi}`);
          if (g) g.corridorIndex = ci;
        });
        // Гравитационная ловушка-моб + отражатель в коридоре
        const ga07 = add('ancient_07', 50,
          (arenaR + corrLen * 0.40) * cosA + hw * 0.5 * pX,
          (arenaR + corrLen * 0.40) * sinA + hw * 0.5 * pY,
          { behavior: 'guard', patrolRadius: 200, leash: 1500 }, `c${ci}:trap1`);
        if (ga07) ga07.corridorIndex = ci;
        const ga07r = add('ancient_07_1', 50,
          (arenaR + corrLen * 0.62) * cosA - hw * 0.5 * pX,
          (arenaR + corrLen * 0.62) * sinA - hw * 0.5 * pY,
          { behavior: 'guard', patrolRadius: 200, leash: 1500 }, `c${ci}:trap2`);
        if (ga07r) ga07r.corridorIndex = ci;
        // 2 кластера по 3 бомбы (ancient_04b) в коридоре
        [0.35, 0.65].forEach((bt, ci2) => {
          const bd = arenaR + corrLen * bt;
          [0, 1, 2].forEach(bi => {
            const bAng = bi * (Math.PI * 2 / 3);
            const bomb = add('ancient_04b', 50,
              bd * cosA + Math.cos(bAng) * 90,
              bd * sinA + Math.sin(bAng) * 90,
              { behavior: 'guard', patrolRadius: 80, leash: 700 }, `c${ci}:bomb:${ci2}:${bi}`);
            if (bomb) bomb.corridorIndex = ci;
          });
        });
        // Уникальный мини-босс в конце коридора (после всех стражников, перед сундуком)
        const mb = add('ancient_miniboss', 50,
          (arenaR + corrLen * 0.86) * cosA,
          (arenaR + corrLen * 0.86) * sinA,
          { behavior: 'guard', patrolRadius: 320, leash: 3000, hpMult: 3, dmgMult: 2 }, `c${ci}:miniboss`);
        if (mb) { mb.corridorIndex = ci; mb._isMiniBoss = true; }
      }
      // Восстановление прогресса при возврате в тот же дневной инстанс: если все
      // мобы коридора уже отмечены убитыми (killedMobIds) — коридор считается
      // зачищенным без повторного боя. Известное ограничение: награда-сундук за
      // зачистку не переспавнивается здесь (факт его сбора отдельно не хранится) —
      // если чек-точку не пропустили, но не забрали сундук, он теряется при выходе.
      const _restoredCleared = new Set(this._dungeonRun?.corridorState?.clearedCorridors ?? []);
      for (let ci = 0; ci < 5; ci++) {
        if (_restoredCleared.has(ci)) { this._clearedCorridors.add(ci); continue; }
        const ids = [];
        for (let gi = 0; gi < 6; gi++) ids.push(`c${ci}:guard:${gi}`);
        ids.push(`c${ci}:trap1`, `c${ci}:trap2`);
        for (let bc = 0; bc < 2; bc++) for (let bi = 0; bi < 3; bi++) ids.push(`c${ci}:bomb:${bc}:${bi}`);
        ids.push(`c${ci}:miniboss`);
        if (ids.every(id => this._dungeonKilledIds.has(id))) this._clearedCorridors.add(ci);
      }
      if (this._dungeonRun?.corridorState?.bossArenaOpen || this._clearedCorridors.size === 5) {
        this._openBossArena();
      }
      // 5 начальных эскортов вокруг Апофиса (до первой фазы) — не отслеживаются
      // по id: при выходе-входе до убийства Апофиса бой начинается заново
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const esc = add('ancient_06', 50, Math.cos(a) * 700, Math.sin(a) * 700,
          { behavior: 'guard', patrolRadius: 350, bossRef: apophis, hpMult: 2, dmgMult: 2 });
        esc.isBossEscort = true;
      }
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
    
    // Data-driven данжи (D1–D5, prem): вариант размещения дня из DUNGEON_LAYOUTS
    this._dungeonVariant = null;
    const _layout = DUNGEON_LAYOUTS[galaxy.current];
    if (_layout) {
      const v = _layout.variants[this._dungeonVariantIndex(_layout.variants.length)];
      this._dungeonVariant = v;
      // обычные мобы пула; каждому N-му — AI-класс из aiMix данжа (строка) либо
      // полная замена шаблона (объект {key}, напр. статичные мины Синдиката)
      const mix = _layout.aiMix;
      v.spots.forEach(([ox, oy], i) => {
        const sOpts = { patrolRadius: 300 };
        let mobKey = pool[i % pool.length];
        if (mix && (i + 1) % mix.every === 0) {
          const m = mix.classes[Math.floor(i / mix.every) % mix.classes.length];
          if (typeof m === 'object') { mobKey = m.key; sOpts.patrolRadius = 0; }
          else sOpts.aiClass = m;
        }
        add(mobKey, rnd(Lmin, Lmax), ox, oy, sOpts, `spot:${i}`);
      });
      // элитные охранники чоук-пойнтов
      v.guards.forEach(([gk, ox, oy], i) => add(gk, Lmax, ox, oy, { behavior: 'guard', patrolRadius: 220, leash: 550 }, `guard:${i}`));
      const dBoss = add(boss, Lmax, v.boss[0], v.boss[1], { behavior: 'guard', patrolRadius: 200, leash: 480 });
      dBoss.isDungeonBoss = true;
      const kit = DUNGEON_BOSS_KIT[galaxy.current];
      if (kit) {
        dBoss._bossKit = kit;
        // Кит работает в стандартном aggro-пути: снимаем bossType 'roaming' у боссов
        // D1–D3 (иначе они уйдут в _updateRoaming и кит не сработает). Скеттер,
        // который давал roaming-путь, возвращён этим боссам через kit.scatter.
        dBoss.tpl = { ...dBoss.tpl, bossType: null, ...(kit.shielder ? { aiClass: 'shielder' } : {}) };
      }
      // охрана босса (не открывает дверь)
      for (const [ek, ox, oy] of v.escorts) {
        const e = add(ek, Lmax, ox, oy, { behavior: 'guard', patrolRadius: 150, leash: 500 });
        e.isBossEscort = true;
      }
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
      const isMap12  = Lmax <= 20;            // карты 1-2 каждой корп — большинство мобов пассивны
      const isMap345 = Lmax > 20 && !sec.pvp; // карты 3-5 — добавляем блуждающего босса
      const passOpts = isMap12 ? { passive: true } : {};
      const pLen     = pool.length;

      if (!sec.pvp) {
        // ── Корпоративные карты: расширенный спавн без пустых зон ──────────
        // Раньше все 16 амбиентных мобов создавались синхронно в один кадр внутри
        // create() (см. "expanded home map spawns") — на слабом железе это давало
        // заметный скачок сразу после прыжка в сектор. Это чисто фоновые патрульные
        // мобы (никакая другая логика не ждёт их существования сразу же), поэтому
        // откладываем их создание в очередь и раздаём по несколько штук за кадр —
        // см. this._pendingAmbientSpawns/_processPendingAmbientSpawns() в update().
        // Порядок сохранён 1-в-1 (важно для pvpMobId — см. add() выше), просто
        // самого new Mob() ещё не произошло к моменту, когда add() возвращает управление.
        (this._pendingAmbientSpawns ??= []).push(
          // N-зона
          () => add(pool[1%pLen], rnd(Lmin,Lmax),  -200, -1900, { patrolRadius: 320, leash: 760, ...passOpts }),
          () => add(pool[2%pLen], rnd(Lmin,Lmax),   550, -2300, { patrolRadius: 260, leash: 640, ...passOpts }),
          () => add(pool[0],      rnd(Lmin,Lmax),  -900, -1700, { patrolRadius: 400, leash: 900, ...passOpts }),
          // S-зона
          () => add(pool[3%pLen], rnd(Lmin,Lmax),   200,  1900, { patrolRadius: 320, leash: 760, ...passOpts }),
          () => add(pool[4%pLen], rnd(Lmin,Lmax),  -600,  2200, { patrolRadius: 260, leash: 640, ...passOpts }),
          () => add(pool[2%pLen], rnd(Lmin,Lmax),   900,  1750, { patrolRadius: 390, leash: 870, ...passOpts }),
          // E-зона
          () => add(pool[5%pLen], rnd(Lmin,Lmax),  2400,  -300, { patrolRadius: 440, leash: 980, ...passOpts }),
          () => add(pool[0],      rnd(Lmin,Lmax),  3100,   800, { patrolRadius: 360, leash: 810, ...passOpts }),
          () => add(pool[1%pLen], rnd(Lmin,Lmax),  2800, -1500, { patrolRadius: 300, leash: 700, ...passOpts }),
          // W-зона
          () => add(pool[6%pLen], rnd(Lmin,Lmax), -2450,   200, { patrolRadius: 440, leash: 980, ...passOpts }),
          () => add(pool[3%pLen], rnd(Lmin,Lmax), -3000,  -900, { patrolRadius: 360, leash: 810, ...passOpts }),
          () => add(pool[5%pLen], rnd(Lmin,Lmax), -2700,  1350, { patrolRadius: 300, leash: 700, ...passOpts }),
          // Дальние углы
          () => add(pool[4%pLen], rnd(Lmin,Lmax),  3600, -1800, { patrolRadius: 380, leash: 860, ...passOpts }),
          () => add(pool[2%pLen], rnd(Lmin,Lmax), -3500,  1700, { patrolRadius: 380, leash: 860, ...passOpts }),
          () => add(pool[6%pLen], rnd(Lmin,Lmax), -3400, -1900, { patrolRadius: 340, leash: 800, ...passOpts }),
          () => add(pool[1%pLen], rnd(Lmin,Lmax),  3700,  1900, { patrolRadius: 340, leash: 800, ...passOpts }),
        );

        // ── Сектор-босс с охраной (всегда агрессивны) ──────────────────────
        const gx = 3200, gy = 1700;
        const sectorBoss = add(boss, Lmax, gx, gy, { behavior: 'guard', patrolRadius: 180, leash: 480 });
        sectorBoss.isSectorBoss = true;
        if (galaxy.current === 'helios_5') sectorBoss.isConfedBoss = true;
        for (const [ox, oy] of [[-250, -140], [260, -100], [-120, 260]]) {
          add(pool[0], rnd(Lmin,Lmax), gx+ox, gy+oy, { patrolRadius: 150, leash: 520, bossRef: sectorBoss });
        }

        // ── Блуждающий одиночный босс (карты 3-5): roam по всей карте, пассивен до атаки ─
        if (isMap345) {
          const wb = add(boss, Lmax, -3500, -2200, { behavior: 'roam', passive: true, leash: Infinity, patrolRadius: 0 });
          wb.isWanderBoss = true;
          wb.isSectorBoss = true;
        }
      } else {
        // ── PvP-сектора: оригинальный спавн ────────────────────────────────
        const ring = [[1200,-360],[-1320,480],[480,1260],[-1020,-840],[1800,624],[-1800,-180]];
        ring.forEach((o, i) => add(pool[i%pLen], rnd(Lmin,Lmax), o[0], o[1], {}));
        const gx = 1800, gy = 1140;
        const sectorBoss = add(boss, Lmax, gx, gy, { behavior: 'guard', patrolRadius: 180, leash: 480 });
        sectorBoss.isSectorBoss = true;
        for (const [ox, oy] of [[-240,-130],[250,-90],[-110,250]]) {
          add(pool[0], rnd(Lmin,Lmax), gx+ox, gy+oy, { patrolRadius: 150, leash: 520, bossRef: sectorBoss });
        }
      }
    }
  }

  get groupSystem() { return this.scene.get('HudScene')?.groupSystem ?? null; }
  get pvpClient()   { return this.scene.get('HudScene')?.pvpClient ?? null; }

  // Комната realtime-присутствия (позиции игроков + общий HP мобов) для текущего
  // захода. null — синхронизация не нужна: соло-данж/босс-карта (там физически
  // не может быть больше одного игрока) и Shadow Arena (бой с ботом). Данжи/босс-
  // карта ключуются по ИНСТАНСУ ГРУППЫ, не по имени сектора — иначе две разные
  // группы, проходящие один и тот же данж в один день, увидели бы друг друга.
  // Всё остальное (домашние/PvE/PvP-секторы) — по имени сектора, как раньше.
  _currentRealtimeRoomKey() {
    const sec = SECTORS[galaxy.current];
    if (!sec || sec.personal) return null;
    if (sec.isDungeon) {
      const grp = this.groupSystem;
      return grp?.inGroup ? `group:${grp.instanceId}` : null;
    }
    return galaxy.current;
  }

  // Снапшот эффективного лоадаута для серверной валидации PvP-попаданий (см. PvpClient/
  // server PvpRoomManager) — сервер трактует эти числа как ПОТОЛОК (умножается на
  // допуск на баффы, см. PVP_BURST_MULT на сервере), не пересчитывает perks/skills/
  // boards заново. cooldown — секунд между выстрелами текущего оружия. critChance/
  // critMult — крит всё равно решает сервер своим роллом, но по статам ИГРОКА, а не
  // фиксированным числом для всех (иначе крит-билд ощущался бы одинаково слабо).
  _pvpLoadoutSnapshot() {
    const p = this.player;
    return {
      shipKey: p.ship?.key || '',
      corp: this.playerCorp || 'neutral',
      level: this.pilotLevel || 1, // для PVP_HIGHER/EQUAL/LOWER на стороне убийцы (см. _onPvpHitResult)
      hull: p.hull, maxHull: p.maxHull, shield: p.shield, maxShield: p.maxShield,
      dmg: Math.max(p.cannonDamage || 0, p.laserDamage || 0),
      range: p.weaponRange || 0,
      cooldown: 1 / Math.max(0.1, p.weaponFireRate || 1),
      penetration: p.weaponPenetration || 0,
      evasion: p.evasion || 0,
      critChance: p.critChance || 0,
      critMult: p.critMult || 2.0,
    };
  }

  // Вызывается из Player.recomputeStats() при ЛЮБОМ пересчёте статов (смена корабля/
  // экипировки/уровня/скиллов) — если сейчас есть активная realtime-комната, шлём
  // серверу свежий потолок для валидации попаданий, а не оставляем протухший с
  // момента входа в комнату (см. комментарий в recomputeStats).
  _onPlayerStatsChanged() {
    if (this._realtimeRoomKey) this.pvpClient?.updateLoadout(this._pvpLoadoutSnapshot());
  }

  _dungeonDiff() {
    const base = DUNGEON_DIFF[this.dungeonDifficulty ?? 'normal'];
    const mods = this.dungeonModifiers;
    if (!mods?.length) return base;
    const out = { ...base };
    for (const key of mods) {
      const mod = DUNGEON_MODIFIERS[key];
      if (!mod) continue;
      const mult = mod.mult;
      if (mult.mobHP)          out.mobHP          *= mult.mobHP;
      if (mult.mobDamage)      out.mobDamage      *= mult.mobDamage;
      if (mult.mobCount)       out.mobCount       *= mult.mobCount;
      if (mult.deposits)       out.deposits       *= mult.deposits;
      if (mult.goldMult)       out.goldMult       *= mult.goldMult;
      if (mult.xpMult)         out.xpMult         *= mult.xpMult;
      if (mult.dropRate)       out.dropRate       = Math.min(1, out.dropRate + mult.dropRate);
      if (mult.mobShieldBonus) out.mobShieldBonus = (out.mobShieldBonus ?? 1) * mult.mobShieldBonus;
      if (mult.mobAddsCount)   out.mobAddsCount   = (out.mobAddsCount   ?? 1) * mult.mobAddsCount;
      if (mult.mobAddsDamage)  out.mobAddsDamage  = (out.mobAddsDamage  ?? 1) * mult.mobAddsDamage;
    }
    return out;
  }

  // Вариант размещения контента данжа на сегодня: детерминирован по UTC-дате
  // (сдвиг −1ч ≈ суточный сброс 01:00) и ключу сектора — одинаков у всех
  // клиентов независимо от локальной таймзоны (важно для групп)
  _dungeonVariantIndex(nVariants) {
    const d = new Date(Date.now() - 3600e3);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}|${galaxy.current}`;
    return new Phaser.Math.RandomDataGenerator([key]).between(0, nVariants - 1);
  }

  _randomRespawnPoint() {
    const cx = this.worldWidth / 2, cy = this.worldHeight / 2;
    // В лабиринтных данжах случайная точка может попасть в отгороженный стенами
    // карман — респавним у южного гейта (R-1-boss сохраняет старое поведение)
    if (SECTORS[galaxy.current]?.isDungeon && galaxy.current !== 'R-1-boss') {
      return {
        x: cx + Phaser.Math.Between(-250, 250),
        y: this.worldHeight - 320 - Phaser.Math.Between(80, 350),
      };
    }
    const margin = 500;
    let x, y, tries = 0;
    do {
      x = Phaser.Math.Between(margin, this.worldWidth - margin);
      y = Phaser.Math.Between(margin, this.worldHeight - margin);
      tries++;
    } while ((Phaser.Math.Distance.Between(x, y, cx, cy) < 900 || this._isPointNearWall(x, y, 120)) && tries < 20);
    return { x, y };
  }

  _spawnDifficultyReinforcements(pool, cx, cy, Lmin, Lmax) {
    const diff = this._dungeonDiff();
    if (diff.mobCount <= 1.0) return;

    // Зоны подкреплений — из раскладки данжа (общие для суточных вариантов)
    const zones = DUNGEON_LAYOUTS[galaxy.current]?.reinforceZones;
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
      const spot = this._findFreeSpawn(cx + jx, cy + jy, 100);
      const m = new Mob(this, M[k], lvl, spot.x, spot.y,
        { behavior: 'patrol', patrolRadius: 280, hpMult: diff.mobHP, dmgMult: diff.mobDamage });
      this.mobs.push(m);
    }
  }

  // Сбрасывает нейтральные базы текущего сектора в активное состояние при еженедельном респауне.
  // Расписание: среда и суббота в 22:00 UTC. Отслеживается per-sector чтобы каждый PvP-сектор
  // сбрасывался независимо при первом посещении после времени респауна.
  _checkGuardReset() {
    // this.lastGuardReset живёт только в памяти вкладки (не персистится нигде) — на
    // проде это ок, т.к. реальные игроки не перезагружают страницу помногу раз в
    // минуту, но в DEV_MODE КАЖДЫЙ ре-заход в сектор после релоада страницы видел бы
    // resetTime > 0 = ещё не сброшено в этой вкладке → resetToNeutral() откатывал бы
    // только что купленную/захваченную базу обратно в полностью здоровую "нейтральную
    // охраняемую" (100к/100к) при каждом релоаде — блокируя тестирование захвата.
    if (this.devMode) return;
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
    // Кольца ускоряются и краснеют при фазе 4 (25% HP)
    if (!this._apophisRingsEnraged && hpRatio < 0.25) {
      this._apophisRingsEnraged = true;
      for (const r of this._apophisRings) {
        r._rotSpeed *= 2.5;
        r.setTint(0xff3333);
      }
    }
    for (const r of this._apophisRings) {
      r.x = boss.x;
      r.y = boss.y;
      r.rotation += r._rotSpeed * dt;
    }
  }

  // ── Суточный ключ данжей: сутки начинаются в 01:00 по местному времени ───
  // (сдвиг на -1ч перед взятием даты — тот же порог, что был у старого
  // localStorage-лока). Жизни/лок/прогресс данжа теперь хранятся в БД
  // (DungeonLives/DungeonRun на сервере) — см. dungeonEnter/dungeonDeath/dungeonComplete.
  _dungeonDayKey() {
    const d = new Date(Date.now() - 3600e3);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Босс данжа убит: суточная попытка засчитывается ВСЕМ участникам группы
  // (не только тому, чей клиент прислал это событие), соло — только себе.
  _completeDungeonRun() {
    if (!this._dungeonRunId) return;
    const grp = this.groupSystem;
    const members = grp?.inGroup ? (grp.members ?? []) : [];
    dungeonComplete(this._dungeonRunId, galaxy.current, this._dungeonDayKey(), members).catch(() => {});
  }

  onApophisPhase(phase) {
    const boss = this._apophisBoss;
    if (!boss?.alive) return;
    const bx = boss.x, by = boss.y;
    this.log(i18n.t(`log.apophis_phase${phase}`));
    const spawnRing = (tplKey, count, radius, opts = {}) => {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const m = new Mob(this, MOBS[tplKey], 50,
          bx + Math.cos(a) * radius, by + Math.sin(a) * radius,
          { patrolRadius: 450, bossRef: boss, hpMult: 2, dmgMult: 2, ...opts });
        m.isBossEscort = true;
        m._groupMobId = this._nextGroupMobId++;
        const grp = this.groupSystem;
        if (grp?.inGroup && !grp.isLeader) m.ghostBoss = true;
        this.mobs.push(m);
      }
    };
    if (phase === 2) spawnRing('ancient_10', 6, 800);             // 6 Жнецов
    if (phase === 3) {
      spawnRing('ancient_06', 5, 1000);                                          // 5 Левиафанов
      spawnRing('ancient_13', 2, 500, { behavior: 'guard', patrolRadius: 380 }); // 2 Реаниматора
      spawnRing('ancient_shield', 3, 420, { behavior: 'guard', patrolRadius: 200 }); // Кристальные щиты
      this.log(i18n.t('log.shield_drone_active'));
    }
    if (phase === 4) {
      spawnRing('ancient_11', 4, 1200);                                          // 4 Звёздных бойца
      spawnRing('ancient_13', 2, 500, { behavior: 'guard', patrolRadius: 380 }); // ещё 2 Реаниматора
      spawnRing('ancient_shield', 3, 380, { behavior: 'guard', patrolRadius: 200 }); // ещё Кристальные щиты
    }
  }

  // Фаза кита данж-босса (D1–D5/prem, см. DUNGEON_BOSS_KIT): тинт-телеграф,
  // призыв аддов кольцом. Саммоны помечены isSummon — выпадают по обычному
  // dropRate, а не по 100%-каналу эскортов (лут-бюджет данжа не раздувается).
  onDungeonBossPhase(boss, ph) {
    if (!boss?.alive) return;
    this.log(i18n.t('log.dungeon_boss_phase'));
    // Лёгкая тряска+вспышка на переход фазы — раньше был только тинт+лог, из-за
    // чего момент, когда босс данжа стал опаснее, физически не читался на экране
    this._shake(180, 0.008);
    this.cameras.main.flash(120, 200, 160, 255, true);
    this.sfx?.play('sfx_boss_phase', { volume: 0.7 });
    if (ph.tint) boss.sprite.setTint(ph.tint);
    if (ph.acid) boss.tpl = { ...boss.tpl, projectileType: 'acid' };
    if (ph.dashOn) boss._kitDashCd = ph.dashOn;
    const s = ph.summon;
    if (!s) return;
    const diff = this._dungeonDiff();
    const n = Math.round(s.n * (diff.mobAddsCount ?? 1));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const pos = this._findFreeSpawn(boss.x + Math.cos(a) * s.r, boss.y + Math.sin(a) * s.r);
      const m = new Mob(this, MOBS[s.k], boss.level, pos.x, pos.y,
        { patrolRadius: 400, bossRef: boss, dmgMult: diff.mobAddsDamage ?? 1, ...(s.opts ?? {}) });
      m.isBossEscort = true;
      m.isSummon = true;
      m._groupMobId = this._nextGroupMobId++;
      const grp = this.groupSystem;
      if (grp?.inGroup && !grp.isLeader) m.ghostBoss = true;
      this.mobs.push(m);
    }
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

      const lock = sectorAccess(t, this.pilotLevel, this.activeShip, this.premium, this.missionState, this.playerCorp).ok ? '' : ' 🔒';
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
    const acc = sectorAccess(gate.target, this.pilotLevel, this.activeShip, this.premium, this.missionState, this.playerCorp);
    if (!acc.ok) { this.log(i18n.t('log.jump_locked', { reason: acc.reason })); return; }
    // From PvP: block jumps into enemy corp sectors
    if (SECTORS[galaxy.current]?.pvp) {
      const isEnemyCorp = ['helios', 'karax', 'tides']
        .some(c => c !== this.playerCorp && gate.target.startsWith(c));
      if (isEnemyCorp) { this.log(i18n.t('log.jump_enemy_corp')); return; }
    }
    const sec = SECTORS[gate.target];

    // R-1-boss: требуется группа ≥ 4 (в DEV_MODE разрешаем соло)
    if (gate.target === 'R-1-boss' && !DEV_MODE) {
      const hud = this.scene.get('HudScene');
      const memberCount = hud?.groupSystem?.memberCount ?? 1;
      if (memberCount < 4) {
        this.log('Зов Апофиса требует группу минимум 4 пилота.');
        return;
      }
    }

    const proceed = async (difficulty, modifiers = []) => {
      this.dungeonModifiers = modifiers;
      if (sec?.isDungeon) {
        // Выделенный инстанс на (данж, сутки, соло-юзер/группа) + жизни — на сервере.
        // Соло — ключ по имени игрока; группа — instanceId существующей группы.
        const grp = this.groupSystem;
        const ownerKind = grp?.inGroup ? 'group' : 'solo';
        const ownerKey  = ownerKind === 'group' ? grp.instanceId : `user:${getUsername()}`;
        const variantIndex = DUNGEON_LAYOUTS[gate.target]
          ? this._dungeonVariantIndex(DUNGEON_LAYOUTS[gate.target].variants.length)
          : 0;
        let res;
        if (DEV_MODE && !getToken()) {
          // DEV-профиль без реального логина (см. LoginScene "пропустить авторизацию")
          // не имеет токена — apiFetch бросает 'Нет токена авторизации' на КАЖДОМ вызове,
          // dungeonEnter молча уходил в catch и ничего не происходило. Тот же DEV-фоллбэк
          // паттерн, что и для PvP-боя без pvpClient (_localPvpFireResolve) — симулируем
          // успешный ответ локально, без похода на сервер.
          res = { ok: true, difficulty: difficulty ?? 'normal', variantIndex, killedMobIds: [], floorLoot: [], corridorState: null };
        } else {
          try {
            res = await dungeonEnter({
              key: gate.target, difficulty: difficulty ?? 'normal', dayKey: this._dungeonDayKey(),
              ownerKind, ownerKey, variantIndex,
            });
          } catch (e) {
            this.log('Сервер недоступен — вход в данж невозможен.');
            return;
          }
          if (!res.ok) { this.log(res.reason || 'Данж недоступен.'); return; }
        }
        // Инстанс уже существует (начат ранее сегодня) — сложность зафиксирована первым
        // входом, модалка могла предложить другую: держимся исходного выбора.
        if (difficulty && res.difficulty !== difficulty) {
          this.log(`Продолжается ранее начатое прохождение — сложность ${res.difficulty.toUpperCase()}.`);
        }
        this.dungeonDifficulty = res.difficulty;
        galaxy.dungeonDiff = res.difficulty;
        this._pendingDungeonRun = res;
      }
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
      proceed('normal');
    }
  }

  _showDungeonDifficultyModal(gate, onConfirm) {
    const W = this.scale.width, H = this.scale.height;
    const modKeys = Object.keys(DUNGEON_MODIFIERS);
    const rowH = 42, rowGap = 6;
    const OW = 440;
    // Computed top-down so nothing overflows/overlaps regardless of modifier count:
    // title(18) → 3 diff buttons(54 each) → modifiers header → N rows → bottom 2-button row.
    const diffEndY    = 48 + 3 * 54;
    const modsHeaderY = diffEndY + 14;
    const modsStartY  = modsHeaderY + 20;
    const modsEndY    = modsStartY + modKeys.length * (rowH + rowGap) - rowGap;
    const OH = modsEndY + 70;
    const ox = (W - OW) / 2, oy = (H - OH) / 2;
    const objs = [];
    const selectedMods = new Set();
    let selectedDiff = null;
    // Модалка рисуется прямо в GameScene (не отдельной Scene), поэтому глобальный
    // pointerdown-обработчик (клик = двигать корабль) о ней не знает — без этого флага
    // клик по любой кнопке ОДНОВРЕМЕННО тоже уводил корабль в точку клика.
    this._modalBlockingClicks = true;
    // Phaser вызывает pointerdown-обработчик самой кнопки ДО глобального сценового —
    // если снять флаг тут же синхронно, глобальный обработчик (в той же цепочке этого
    // же клика) увидит его уже false и всё равно сдвинет корабль. Снимаем со сдвигом
    // на следующий тик — глобальный успевает проверить true.
    const destroy = () => { objs.forEach(o => o?.destroy()); this.time.delayedCall(0, () => { this._modalBlockingClicks = false; }); };

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

    // Bottom buttons declared up-front (assigned below) so redrawSelection can
    // reference them — only actually called from click handlers, wired up after.
    let jumpBg = null, jumpTxt = null;
    const diffBoxes = [];
    const redrawSelection = () => {
      diffBoxes.forEach(({ bg, m }) => {
        const sel = selectedDiff === m.key;
        bg.setStrokeStyle(sel ? 3 : 1, m.border, sel ? 1 : 0.8);
      });
      const ready = !!selectedDiff;
      jumpBg.setFillStyle(ready ? 0x0a2818 : 0x10161f, 1);
      jumpBg.setStrokeStyle(1, ready ? COLORS.emerald : 0x2a3540, ready ? 0.9 : 0.5);
      jumpTxt.setColor(ready ? '#66cc77' : '#3a4a54');
    };

    // Клик по сложности теперь только ВЫБИРАЕТ её (подсвечивает), не прыгает сразу —
    // сам прыжок только по отдельной кнопке ПРЫЖОК внизу, когда сложность выбрана.
    modes.forEach((m, i) => {
      const by = oy + 48 + i * 54;
      const bg = this.add.rectangle(ox + OW / 2, by + 22, OW - 40, 46, m.fill, 1)
        .setOrigin(0.5, 0.5).setStrokeStyle(1, m.border, 0.8).setDepth(201).setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => { if (selectedDiff !== m.key) bg.setAlpha(0.85); });
      bg.on('pointerout',  () => bg.setAlpha(1));
      bg.on('pointerdown', () => { selectedDiff = m.key; redrawSelection(); });
      objs.push(bg);
      diffBoxes.push({ bg, m });
      objs.push(this.add.text(ox + 35, by + 12, m.label, {
        fontFamily: 'Orbitron, sans-serif', fontSize: '12px', color: m.tc, resolution: 2,
      }).setOrigin(0, 0).setDepth(202).setScrollFactor(0));
      objs.push(this.add.text(ox + 35, by + 30, m.hint, {
        fontFamily: 'Inter, sans-serif', fontSize: '10px', color: '#667788', resolution: 2,
      }).setOrigin(0, 0).setDepth(202).setScrollFactor(0));
    });

    // Контракты-модификаторы: необязательные тумблеры, можно выбрать несколько сразу,
    // стакуются друг с другом и с выбранной сложностью выше (см. GameScene._dungeonDiff()).
    objs.push(this.add.text(ox + 24, oy + modsHeaderY, 'МОДИФИКАТОРЫ (необязательно)', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '10px', color: '#556677', resolution: 2,
    }).setOrigin(0, 0).setDepth(201).setScrollFactor(0));

    const labelWrapW = OW - 54 - 24;
    modKeys.forEach((key, i) => {
      const mod = DUNGEON_MODIFIERS[key];
      const my = oy + modsStartY + i * (rowH + rowGap);
      const bg = this.add.rectangle(ox + OW / 2, my + rowH / 2, OW - 40, rowH, 0x0d1a26, 1)
        .setOrigin(0.5).setStrokeStyle(1, 0x2a3a4a, 0.8).setDepth(201).setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      const check = this.add.text(ox + 32, my + 6, '☐', {
        fontFamily: 'Inter, sans-serif', fontSize: '13px', color: '#556677', resolution: 2,
      }).setOrigin(0, 0).setDepth(202).setScrollFactor(0);
      const label = this.add.text(ox + 54, my + 5, `${mod.label} — ${mod.hint}`, {
        fontFamily: 'Inter, sans-serif', fontSize: '10px', color: '#8ab0bc', resolution: 2,
        wordWrap: { width: labelWrapW },
      }).setOrigin(0, 0).setDepth(202).setScrollFactor(0);
      bg.on('pointerdown', () => {
        if (selectedMods.has(key)) { selectedMods.delete(key); check.setText('☐').setColor('#556677'); bg.setStrokeStyle(1, 0x2a3a4a, 0.8); }
        else { selectedMods.add(key); check.setText('☑').setColor('#4dd0e1'); bg.setStrokeStyle(1, 0x4dd0e1, 0.8); }
      });
      objs.push(bg, check, label);
    });

    // Bottom row: ОТМЕНА (всегда активна) + ПРЫЖОК (активна только после выбора сложности).
    const btnY = oy + OH - 30;
    const cancelBg = this.add.rectangle(ox + OW / 2 - 92, btnY, 160, 38, 0x0d1e2c, 1)
      .setStrokeStyle(1, 0x2a4a60, 0.8).setDepth(201).setScrollFactor(0).setInteractive({ useHandCursor: true });
    cancelBg.on('pointerover', () => cancelBg.setFillStyle(0x14283a, 1));
    cancelBg.on('pointerout',  () => cancelBg.setFillStyle(0x0d1e2c, 1));
    cancelBg.on('pointerdown', () => destroy());
    objs.push(cancelBg);
    objs.push(this.add.text(ox + OW / 2 - 92, btnY, 'ОТМЕНА', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '12px', color: '#4dd0e1', resolution: 2,
    }).setOrigin(0.5).setDepth(202).setScrollFactor(0));

    jumpBg = this.add.rectangle(ox + OW / 2 + 92, btnY, 160, 38, 0x10161f, 1)
      .setStrokeStyle(1, 0x2a3540, 0.5).setDepth(201).setScrollFactor(0).setInteractive({ useHandCursor: true });
    jumpTxt = this.add.text(ox + OW / 2 + 92, btnY, 'ПРЫЖОК', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '12px', color: '#3a4a54', resolution: 2,
    }).setOrigin(0.5).setDepth(202).setScrollFactor(0);
    jumpBg.on('pointerdown', () => {
      if (!selectedDiff) return;
      destroy();
      onConfirm(selectedDiff, Array.from(selectedMods));
    });
    objs.push(jumpBg, jumpTxt);
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
    // Нет безопасной зоны в данжах/PvP/личных секторах — там нет домашней базы в
    // центре карты (см. createBaseAndSafeZone). Без этой проверки геометрический
    // круг 320px вокруг центра мира всё равно «работал» в данжах, просто без
    // визуала: любой моб или бой рядом с центром карты (например, арена босса
    // D5 буквально в (0,0)) молча гасил агро всех мобов сцены — игрок подходит
    // вплотную, а никто не реагирует.
    const sec = SECTORS[galaxy.current];
    if (sec?.isDungeon || sec?.pvp || sec?.personal) return false;
    return Phaser.Math.Distance.Between(x, y, this.worldWidth / 2, this.worldHeight / 2) < this.safeZoneRadius;
  }

  travelTo(key) {
    const acc = sectorAccess(key, this.pilotLevel, this.activeShip, this.premium, this.missionState, this.playerCorp);
    if (!acc.ok) { this.jumping = false; this.player.sprite.setVisible(true); this.player._restoreDisplaySize(); return; }
    this._execJump(key, galaxy.current);
  }

  _showJumpDangerWarning(key, recLevel, onConfirm) {
    const W = this.scale.width, H = this.scale.height;
    const OW = 300, OH = 120, ox = (W - OW) / 2, oy = (H - OH) / 2;
    const objs = [];
    this._modalBlockingClicks = true;
    // Phaser вызывает pointerdown-обработчик самой кнопки ДО глобального сценового —
    // если снять флаг тут же синхронно, глобальный обработчик (в той же цепочке этого
    // же клика) увидит его уже false и всё равно сдвинет корабль. Снимаем со сдвигом
    // на следующий тик — глобальный успевает проверить true.
    const destroy = () => { objs.forEach(o => o?.destroy()); this.time.delayedCall(0, () => { this._modalBlockingClicks = false; }); };
    const bg = this.add.rectangle(ox, oy, OW, OH, 0x0e0608, 0.97)
      .setOrigin(0, 0).setStrokeStyle(1.5, 0xef5350, 0.8).setDepth(200).setScrollFactor(0);
    objs.push(bg);
    objs.push(this.add.text(ox + OW / 2, oy + 18, '⚠ Опасный сектор', { fontFamily: 'Orbitron, sans-serif', fontSize: '14px', color: '#ef5350', resolution: 2 }).setOrigin(0.5).setDepth(201).setScrollFactor(0));
    objs.push(this.add.text(ox + OW / 2, oy + 44, `Рекомендуемый уровень: ${recLevel}`, { fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#ccaaaa', resolution: 2 }).setOrigin(0.5).setDepth(201).setScrollFactor(0));
    objs.push(this.add.text(ox + OW / 2, oy + 62, `Ваш уровень: ${this.pilotLevel}`, { fontFamily: 'Inter, sans-serif', fontSize: '11px', color: '#886666', resolution: 2 }).setOrigin(0.5).setDepth(201).setScrollFactor(0));

    const btnY = oy + OH - 22;
    const noBtn = this.add.rectangle(ox + OW / 2 - 65, btnY, 100, 28, 0x0d1e2c, 1)
      .setStrokeStyle(1, 0x2a4a60, 0.8).setDepth(201).setScrollFactor(0).setInteractive({ useHandCursor: true });
    noBtn.on('pointerdown', () => destroy());
    objs.push(noBtn);
    objs.push(this.add.text(ox + OW / 2 - 65, btnY, 'НАЗАД', { fontFamily: 'Orbitron, sans-serif', fontSize: '11px', color: '#4dd0e1', resolution: 2 }).setOrigin(0.5).setDepth(202).setScrollFactor(0));

    const yesBtn = this.add.rectangle(ox + OW / 2 + 65, btnY, 100, 28, 0x1a0808, 1)
      .setStrokeStyle(1, 0xef5350, 0.8).setDepth(201).setScrollFactor(0).setInteractive({ useHandCursor: true });
    yesBtn.on('pointerdown', () => { destroy(); onConfirm(); });
    objs.push(yesBtn);
    objs.push(this.add.text(ox + OW / 2 + 65, btnY, 'ВОЙТИ', { fontFamily: 'Orbitron, sans-serif', fontSize: '11px', color: '#ef9a9a', resolution: 2 }).setOrigin(0.5).setDepth(202).setScrollFactor(0));
  }

  _execJump(key, fromKey) {
    galaxy.current = key;
    this._escortRoomLockUntil = null; // stagger is per-sector, doesn't carry across jumps
    this.advanceMissionsByEvent('reach_sector', (obj, m, i) => {
      const t = getMissionSectorTarget(m, this.playerCorp ?? 'helios');
      return t && t.key === key && t.objIdx === i;
    });
    this._checkTimeTrials(key);
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
      // Модалки, нарисованные прямо в GameScene (не отдельной Scene, поэтому не покрыты
      // проверкой выше) — напр. _showDungeonDifficultyModal/_showBountyPrompt/
      // _showJumpDangerWarning — ставят этот флаг, пока открыты, чтобы клик по кнопке
      // модалки не ОДНОВРЕМЕННО уводил корабль в точку клика.
      if (this._modalBlockingClicks) return;
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

      // Corridor button click
      if (this._corridorButtons?.length) {
        for (const btn of this._corridorButtons) {
          if (!btn || btn.triggered) continue;
          if (Phaser.Math.Distance.Between(wx, wy, btn.x, btn.y) < 120) {
            if (btn.ready) { this._triggerCorridorButton(btn.index); }
            else { this.log('Приблизьтесь к воротам'); }
            return;
          }
        }
      }

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

      // Другой живой игрок — та же логика клика, что и Shadow Arena бот выше. Вне
      // реальных PvP-секторов это союзник — можно выбрать (посмотреть неймплейт),
      // но авто-огонь по двойному клику не включаем, атаковать всё равно нельзя.
      const rp = this.remotePlayerAt(wx, wy);
      if (rp) {
        this.selectTarget(rp);
        if (isDouble && this._isPvpSector) this.isFiring = true;
        return;
      }

      // Mob check first — takes priority over loot when overlapping
      const mob = this.mobAt(wx, wy);
      if (isDouble && mob) {
        this.selectTarget(mob); this.isFiring = true;
        this.log("ATTACK: " + i18n.t(mob.tpl.nameKey));
        return;
      }
      if (mob) { this.cancelCollect(); this.selectTarget(mob); return; }

      // Turret/base — same click UX as mobs above: single click selects (shows the
      // targeting reticle), double click also opens fire. Previously this only
      // responded to isDouble at all, so a single click did nothing and looked like
      // the reticle simply wouldn't lock onto a base/turret. Turret first — it sits
      // outside the base's own 120px click radius (see turretAt/baseAt), never
      // overlapping, but turrets are the more specific target so check them first.
      const turret = this.turretAt(wx, wy);
      if (turret?.canBeAttacked) {
        this.cancelCollect(); this.selectTarget(turret);
        if (isDouble) this.isFiring = true;
        return;
      }
      const base = this.baseAt(wx, wy);
      if (base?.canBeAttacked) {
        this.cancelCollect(); this.selectTarget(base);
        if (isDouble) this.isFiring = true;
        return;
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
      const anomaly = this.anomalyAt(wx, wy);
      if (anomaly) {
        this.cancelCollect();
        this.collectTarget = anomaly;
        this.collectTimer = 0;
        if (this.player.alive && !this.jumping) this.movement.setWaypoint(anomaly.x, anomaly.y, false);
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
      // DEV: мгновенно завершает все доступные (по уровню) обязательные story_grad_N —
      // иначе тестовый профиль с сразу высоким уровнем (см. TestProfileScene) упирается
      // в sectorAccess() gate на первом же прыжке, т.к. миссии физически не пройдены.
      this.input.keyboard.on('keydown-SEVEN', () => {
        let n = 0;
        for (const m of MISSIONS) {
          if (m.type !== 'story' || !m.mandatory) continue;
          if ((m.minLevel ?? 1) > (this.pilotLevel ?? 1)) continue;
          if (this.missionState?.[m.id]?.status === 'completed') continue;
          this.completeMission(m.id);
          n++;
        }
        this.log(`DEV: ${n} обязательных сюжетных миссий выполнены — сектора разблокированы.`);
      });
      // DEV: дамп TURRET_SLOTS ближайшей базы после ручной перетаскиванием калибровки
      // (турели становятся draggable в MiningBase._createVisuals(), см. там же).
      this.input.keyboard.on('keydown-L', () => {
        const b = this._nearestMiningBase();
        b?.dumpTurretSlots();
      });
      // DEV: на pvp_4 ("Нейтральная Зона", ровно 4 базы) мгновенно раздаёт все 4 базы
      // по одной каждой корпорации (helios/karax/tides/neutral) с 3×Cannon I +
      // 3×Cannon II (все 6 слотов) — нужно для проверки турельных ассетов/калибровки
      // сразу на всех 4 скинах, не гоняя buyBase/buyTurret вручную по кругу. На
      // остальных картах —
      // старое поведение: мгновенно освобождает ближайшую базу (как после уничтожения)
      // без боя, т.к. _checkGuardReset() (теперь пропускается в devMode) раньше
      // откатывал базу в полностью здоровую "нейтральную охраняемую" (100к/100к) при
      // каждом релоаде страницы — этим хоткеем можно привести застрявшую базу в
      // обычное "разрушено".
      this.input.keyboard.on('keydown-R', () => {
        if (galaxy.current === 'pvp_4' && this.miningBases?.length === 4) {
          const corps = ['helios', 'karax', 'tides', 'neutral'];
          this.miningBases.forEach((b, i) => b.devForceSetup(corps[i], this.playerName));
          this.log('DEV: 4 базы настроены — helios/karax/tides/neutral, по 3×Cannon I + 3×Cannon II');
          return;
        }
        const b = this._nearestMiningBase();
        if (!b) return;
        b.hull = 0;
        b._onDestroyed();
        this.log('DEV: ближайшая база сброшена в "разрушено" — можно строить');
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
        this.hitFlash(this.player.x, this.player.y, true, this.player, false);
        this.groupSystem?.recordHeal(heal);
        break;
      }
      case 'speed_boost': {
        const BUFF_DUR = 15000, CD_MS = this._skillCooldownMs(barKey);
        this._consBuffEndTimes[barKey] = now + BUFF_DUR;
        this._speedBoostMult = 1.5;
        this.player.recomputeStats();
        this.log('⚡ Ускоритель: +50% скорость, 15с');
        this.muzzleFlash(this.player.x, this.player.y, 0xffee44, this.player);
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
        this.muzzleFlash(this.player.x, this.player.y, 0x44ddff, this.player);
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
        this.muzzleFlash(cx, cy, 0x8888ff, this.player);
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
    this.muzzleFlash(this.player.x, this.player.y, 0xff8800, this.player);
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
    this.hitFlash(this.player.x, this.player.y, true, this.player, false);
    this.groupSystem?.recordHeal(heal);
  }

  _doShieldBurst(now, cd) {
    this.skillCooldowns.shield_burst = now + cd;
    const boost = Math.round(this.player.maxShield * 1.20);
    this.player.shield = Math.min(this.player.maxShield, this.player.shield + boost);
    this.log(`🛡 Всплеск щита: +${boost}`);
    this.hitFlash(this.player.x, this.player.y, false, this.player, false);
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
    this.hitFlash(this.player.x, this.player.y, true, this.player, false);
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
    this.hitFlash(p.x, p.y, false, p, false);
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
    const _mapXp = 1 + (this.player?.mapXpBonus ?? 0);
    this.pilotXp += Math.round(amount * (this.player?.xpBonusMod ?? 1) * _premiumXp * _mapXp);
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
  // Другие живые игроки в текущем PvP-секторе — таргетятся так же, как мобы.
  remotePlayerAt(wx, wy) {
    if (!this.pvpClient?.players?.size) return null;
    let best = null, bestD = Infinity;
    for (const rp of this.pvpClient.players.values()) {
      const d = Phaser.Math.Distance.Between(wx, wy, rp.x, rp.y);
      if (d < 70 && d < bestD) { best = rp; bestD = d; }
    }
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
  // Турели — независимые от базы цели (см. MiningBase.turretTargets/TurretTarget) —
  // клик по конкретному слоту таргетит только его, а не всю базу.
  turretAt(wx, wy) {
    let best = null, bestD = Infinity;
    for (const b of this.miningBases) {
      for (const tt of b.turretTargets) {
        if (!tt?.alive) continue;
        const d = Phaser.Math.Distance.Between(wx, wy, tt.x, tt.y);
        if (d < 50 && d < bestD) { best = tt; bestD = d; }
      }
    }
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
    // Импульсная мина Синдиката: оружие полностью глушится на 3с (движки — см. основной update)
    if ((this._playerStunUntil || 0) > this.time.now) return;
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

    // PvP: сервер решает урон/крит (см. server main.py:_resolve_pvp_hit) — клиент
    // только заявляет выстрел и рисует визуал, никакого локального takeDamage.
    // Вне реальных PvP-секторов другие игроки — союзники (см. _isPvpSector), не цель.
    // Игрок своего корпа — тоже союзник ВЕЗДЕ (дом/пвп/данж/босс-карта), дружественный
    // огонь запрещён; единственное исключение будет отдельная арена с записью/очередью
    // (дуэли не по корпам) — её пока нет как отдельного сектора, добавить проверку
    // сюда, когда появится.
    if (t.isRemotePlayer) {
      if (!this._isPvpSector || (t.corp && t.corp === this.playerCorp)) {
        this._warnThrottle('ally_fire', 'Нельзя атаковать союзника'); return;
      }
      const ammoMult = this._consumeAmmo('cannon', cannonCount);
      const perkMult = this._offensivePerkMult(p, t, true);
      // Крит не считаем тут — его роллит сервер по loadout.critChance/critMult
      // (см. _pvpLoadoutSnapshot), иначе игрок мог бы заявлять крит на каждый выстрел.
      const dmg = Math.round(p.cannonDamage * skillMult * ammoMult * perkMult);
      this._fireVisualBolt(p.x, p.y, t.x, t.y, isOC ? 0xff8800 : PROJECTILE.playerColor);
      this.muzzleFlash(p.x, p.y, isOC ? 0xff8800 : 0x8fe6ff, p);
      this.sfx?.play('sfx_cannon_fire', { cooldownMs: 60 });
      this.pvpClient?.fireClaim(t.userId, 'cannon', dmg);
      return;
    }
    // PvP: общий моб сектора / база / турель — HP шарится через сервер (см.
    // PvpMobState), тоже без локального takeDamage. Обычные мобы (без pvpMobId) идут
    // дальше как раньше. База/турель несут .corp — свой корпус атаковать нельзя
    // (нейтральные и вражеские — можно, corp-check только на "свой").
    if (t.pvpMobId) {
      if (t.corp && t.corp === this.playerCorp) { this._warnThrottle('ally_fire', 'Нельзя атаковать свою базу'); return; }
      const ammoMult = this._consumeAmmo('cannon', cannonCount);
      const perkMult = this._offensivePerkMult(p, t, true);
      const dmg = Math.round(p.cannonDamage * skillMult * ammoMult * perkMult);
      this._fireVisualBolt(p.x, p.y, t.x, t.y, isOC ? 0xff8800 : PROJECTILE.playerColor);
      this.muzzleFlash(p.x, p.y, isOC ? 0xff8800 : 0x8fe6ff, p);
      this.sfx?.play('sfx_cannon_fire', { cooldownMs: 60 });
      if (this.pvpClient) {
        this.pvpClient.mobFireClaim(t.pvpMobId, t.maxHull, t.maxShield, t.x, t.y, 'cannon', dmg);
      } else {
        // DEV-фоллбэк без сервера — крит здесь ЛОКАЛЬНЫЙ (обычно его роллит сервер по
        // loadout, см. ветку выше), не критично для одиночного DEV-теста без логина.
        const isCrit = p.critChance > 0 && Math.random() < p.critChance;
        this._localPvpFireResolve(t, isCrit ? Math.round(dmg * (p.critMult ?? 2)) : dmg, p.weaponPenetration, isCrit);
      }
      return;
    }

    if (Math.random() >= (p.cannonAccuracy ?? 0.90)) {
      this.muzzleFlash(p.x, p.y, 0x8fe6ff, p);
      this.sfx?.play('sfx_weapon_miss', { volume: 0.4, cooldownMs: 80 });
      return;
    }

    const isCrit    = p.critChance > 0 && Math.random() < p.critChance;
    const ammoMult  = this._consumeAmmo('cannon', cannonCount);
    const perkMult  = this._offensivePerkMult(p, t, true);
    const dmg       = Math.round(p.cannonDamage * skillMult * ammoMult * perkMult * (isCrit ? (p.critMult ?? 2) : 1));
    const color     = isOC ? 0xff8800 : ammoMult > 1 ? 0xff6d00 : isCrit ? 0xffee44 : PROJECTILE.playerColor;
    // Predictive aim: lead the target based on its current velocity.
    const aimPt = _leadTarget(p.x, p.y, t.x, t.y,
      (t.sprite?.body?.velocity?.x ?? 0) / DPR,
      (t.sprite?.body?.velocity?.y ?? 0) / DPR,
      PROJECTILE.speed);
    this.projectiles.push(new Projectile(this, 'player', p.x, p.y, aimPt.x, aimPt.y, t, dmg, p.weaponPenetration, color, 160 * Math.PI / 180, 'plasma', isCrit));
    this.muzzleFlash(p.x, p.y, isOC ? 0xff8800 : isCrit ? 0xffee44 : 0x8fe6ff, p);
    this.sfx?.play('sfx_cannon_fire', { cooldownMs: 60 });
    if (isCrit) this.sfx?.play('sfx_crit', { volume: 0.7 });
    if (isCrit || isOC) {
      const label = isOC ? '⚡ УДАР!' : 'КРИТ!';
      const clr   = isOC ? '#ff8800' : '#ffee44';
      const txt = this.add.text(t.x, t.y - 40, label,
        { fontFamily: 'Orbitron', fontSize: '14px', color: clr, fontStyle: 'bold', resolution: 2 })
        .setOrigin(0.5).setDepth(71);
      this.tweens.add({ targets: txt, y: t.y - 80, alpha: 0, duration: 600, ease: 'Quad.easeOut', onComplete: () => txt.destroy() });
    }
  }

  // Чисто визуальный "снаряд" для PvP-выстрелов из пушки — не заходит в damage-pipeline
  // (Projectile._hit вызывает victim.takeDamage(), а у RemotePlayer его нет и не должно
  // быть: реальный урон решает сервер через pvp_fire_claim/pvp_hit_result).
  _fireVisualBolt(x1, y1, x2, y2, color) {
    const spr = this.add.image(x1, y1, 'bolt_sprite').setDepth(60)
      .setTint(color).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(42, 17);
    spr.rotation = Math.atan2(y2 - y1, x2 - x1);
    const dist = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    const duration = Math.min(500, (dist / PROJECTILE.speed) * 1000);
    this.tweens.add({ targets: spr, x: x2, y: y2, duration, ease: 'Linear', onComplete: () => spr.destroy() });
  }

  // Авторитетный исход PvP-попадания от сервера (см. server/main.py:_resolve_pvp_hit) —
  // пришёл ли по мне (msg.targetUserId===myUserId) или по другому игроку, которого я
  // вижу как RemotePlayer. hullHit/shieldHit считаем сами по разнице до/после. На kill
  // сервер шлёт уже восстановленный (после внутреннего "респавна" в своей бухгалтерии)
  // hull/shield жертвы — локально показываем 0, а не эти значения: визуально корабль
  // должен выглядеть мёртвым до момента фактического респавна через диалог ремонта
  // (as _showRepairDialog/Player.respawn() — та же цепочка, что при смерти от моба).
  _onPvpHitResult(msg) {
    const isMe = msg.targetUserId === this.myUserId;
    if (isMe) {
      const p = this.player;
      if (msg.dodged) { this.showDodge(p.x, p.y); return; }
      const hullHit   = msg.killed ? p.hull   : Math.max(0, p.hull   - msg.hull);
      const shieldHit = msg.killed ? p.shield : Math.max(0, p.shield - msg.shield);
      p.hull = msg.killed ? 0 : msg.hull;
      p.shield = msg.killed ? 0 : msg.shield;
      // КРИТИЧНО: без этого passive-реген (Player.update, гейтится по sinceDamage)
      // считал урон "давним" (lastDamageAt тут никогда не трогался) и мгновенно
      // накатывал щит обратно на следующем же кадре.
      p.lastDamageAt = this.time.now;
      this.hitFlash(p.x, p.y, hullHit > 0, p);
      this.showDamage(p.x, p.y, { shieldHit, hullHit, killed: msg.killed }, msg.maxHull, msg.isCrit);
      this._shakeForHit({ hullHit }, msg.maxHull);
      if (msg.killed && p.alive) {
        p.die(); this.onPlayerKilled(true);
        // Доска розыска: решает сама жертва (см. _promptBountyChoice/_showBountyPrompt),
        // не авто-постится молча.
        this._promptBountyChoice(msg);
      }
      return;
    }

    const rp = this.pvpClient?.players?.get(msg.targetUserId);
    if (!rp) return;
    if (msg.dodged) { this.showDodge(rp.x, rp.y); return; }
    const hullHit   = msg.killed ? rp.hull   : Math.max(0, rp.hull   - msg.hull);
    const shieldHit = msg.killed ? rp.shield : Math.max(0, rp.shield - msg.shield);
    rp.applyState({ hull: msg.hull, maxHull: msg.maxHull, shield: msg.shield, maxShield: msg.maxShield });
    this.hitFlash(rp.x, rp.y, hullHit > 0, rp);
    this.showDamage(rp.x, rp.y, { shieldHit, hullHit, killed: msg.killed }, msg.maxHull, msg.isCrit);
    if (msg.killed) this.explosion(rp.x, rp.y, 1.1);
    if (msg.attackerUserId === this.myUserId && msg.isCrit) {
      const txt = this.add.text(rp.x, rp.y - 40, 'КРИТ!',
        { fontFamily: 'Orbitron', fontSize: '14px', color: '#ffee44', fontStyle: 'bold', resolution: UI_RES })
        .setOrigin(0.5).setDepth(71);
      this.tweens.add({ targets: txt, y: rp.y - 80, alpha: 0, duration: 600, ease: 'Quad.easeOut', onComplete: () => txt.destroy() });
    }
    // Честь за килл — тир по уровню жертвы ОТНОСИТЕЛЬНО СВОЕГО уровня (PVP_HIGHER/
    // EQUAL/LOWER), помноженный на свою долю урона по этой жизни жертвы (msg.damageBy,
    // см. server _resolve_pvp_hit) — несколько атаковавших делят честь пропорционально
    // вкладу, округление математическое (Math.round).
    if (msg.killed && msg.damageBy) {
      const myDmg = msg.damageBy[String(this.myUserId)] || 0;
      if (myDmg > 0) {
        const total = Object.values(msg.damageBy).reduce((s, d) => s + d, 0);
        const share = myDmg / total;
        const tier = rp.level > (this.pilotLevel || 1) ? HONOR.PVP_HIGHER
          : rp.level === (this.pilotLevel || 1) ? HONOR.PVP_EQUAL
          : HONOR.PVP_LOWER;
        // Розыск: жертва была "в розыске" → честь ×3 (не +3, замена нормального
        // множителя) + доля от 20 золота, поровну по вкладу урона (см. server bountyBonus).
        const honorMult = msg.bountyBonus?.honorMult ?? 1;
        const honorGain = Math.round(tier * share * honorMult);
        if (honorGain > 0) this.gainHonor(honorGain);
        if (msg.bountyBonus) {
          const goldGain = Math.round(msg.bountyBonus.gold * share);
          if (goldGain > 0) {
            this.starGold = (this.starGold || 0) + goldGain;
            this.log(`💀 Розыск снят! +${goldGain} ⭐ за устранение разыскиваемого пилота «${rp.name}».`);
          }
        }
        this.advanceMissionsByEvent('pvp_kill', () => true);
      }
    }
    if (msg.killed) this.wantedPlayers?.delete(rp.userId); // на случай гонки с broadcast pvp_bounty_cleared
  }

  // Розыск не вешается на убийцу, если он в этот момент физически защищал СВОЮ
  // (своего корпа) базу: в топ-10 владельцев по очкам (см. MiningBase._presentGuards/
  // owners) и в радиусе guardRadius×1.5 от неё — шире строгого радиуса начисления
  // очков, чтобы отгонять атакующих чуть дальше от базы тоже засчитывалось.
  _isDefendingOwnBase(rp) {
    const R = BASE_CONFIG.guardRadius * 1.5;
    for (const b of this.miningBases ?? []) {
      if (!b?.alive || b.corp !== rp.corp) continue;
      if (Phaser.Math.Distance.Between(b.x, b.y, rp.x, rp.y) > R) continue;
      const top10 = b.owners.slice().sort((a, c) => c.points - a.points).slice(0, BASE_CONFIG.maxOwners);
      if (top10.some(o => o.name === rp.name)) return true;
    }
    return false;
  }

  // Решает жертва, не сервер и не авто-хук: из всех, кто наносил урон за эту жизнь
  // (msg.damageBy — тот же снапшот, что честь выше использует), берём тех, кто минимум
  // на BOUNTY_LEVEL_GAP уровней выше и не защищает свою базу, топ-3 по вкладу урона.
  _promptBountyChoice(msg) {
    const damageBy = msg.damageBy || {};
    const myLvl = this.pilotLevel ?? 1;
    const candidates = Object.entries(damageBy)
      .map(([uid, dmg]) => ({ dmg, rp: this.pvpClient?.players?.get(Number(uid)) }))
      .filter(c => c.rp && c.rp.level >= myLvl + BOUNTY_LEVEL_GAP && !this._isDefendingOwnBase(c.rp))
      .sort((a, b) => b.dmg - a.dmg)
      .slice(0, 3)
      .map(c => c.rp);
    if (candidates.length) this._showBountyPrompt(candidates);
  }

  _showBountyPrompt(candidates) {
    const W = this.scale.width, H = this.scale.height;
    const names = candidates.map(c => c.name).join(', ');
    const OW = 380, OH = 110;
    const ox = (W - OW) / 2, oy = (H - OH) / 2;
    const objs = [];
    this._modalBlockingClicks = true;
    // Phaser вызывает pointerdown-обработчик самой кнопки ДО глобального сценового —
    // если снять флаг тут же синхронно, глобальный обработчик (в той же цепочке этого
    // же клика) увидит его уже false и всё равно сдвинет корабль. Снимаем со сдвигом
    // на следующий тик — глобальный успевает проверить true.
    const destroy = () => { objs.forEach(o => o?.destroy()); this.time.delayedCall(0, () => { this._modalBlockingClicks = false; }); };
    const bg = this.add.rectangle(ox, oy, OW, OH, 0x0e0608, 0.97)
      .setOrigin(0, 0).setStrokeStyle(1.5, 0xef5350, 0.8).setDepth(200).setScrollFactor(0);
    objs.push(bg);
    objs.push(this.add.text(ox + OW / 2, oy + 18, '💀 Отправить в розыск?',
      { fontFamily: 'Orbitron, sans-serif', fontSize: '14px', color: '#ef5350', resolution: 2 })
      .setOrigin(0.5).setDepth(201).setScrollFactor(0));
    objs.push(this.add.text(ox + OW / 2, oy + 46, names,
      { fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#ccaaaa', resolution: 2,
        wordWrap: { width: OW - 30 }, align: 'center' }).setOrigin(0.5).setDepth(201).setScrollFactor(0));

    const btnY = oy + OH - 22;
    const noBtn = this.add.rectangle(ox + OW / 2 - 75, btnY, 120, 28, 0x0d1e2c, 1)
      .setStrokeStyle(1, 0x2a4a60, 0.8).setDepth(201).setScrollFactor(0).setInteractive({ useHandCursor: true });
    noBtn.on('pointerdown', () => destroy());
    objs.push(noBtn);
    objs.push(this.add.text(ox + OW / 2 - 75, btnY, 'НЕТ', { fontFamily: 'Orbitron, sans-serif', fontSize: '11px', color: '#4dd0e1', resolution: 2 }).setOrigin(0.5).setDepth(202).setScrollFactor(0));

    const yesBtn = this.add.rectangle(ox + OW / 2 + 75, btnY, 120, 28, 0x1a0808, 1)
      .setStrokeStyle(1, 0xef5350, 0.8).setDepth(201).setScrollFactor(0).setInteractive({ useHandCursor: true });
    yesBtn.on('pointerdown', () => {
      destroy();
      for (const rp of candidates) this.pvpClient?.bountyPost(rp.userId, rp.name, rp.corp);
      this.log(`💀 В розыск отправлен${candidates.length > 1 ? 'ы' : ''}: ${names}.`);
    });
    objs.push(yesBtn);
    objs.push(this.add.text(ox + OW / 2 + 75, btnY, 'В РОЗЫСК', { fontFamily: 'Orbitron, sans-serif', fontSize: '11px', color: '#ef9a9a', resolution: 2 }).setOrigin(0.5).setDepth(202).setScrollFactor(0));
  }

  // Авторитетный исход попадания по ОБЩЕМУ мобу PvP-сектора (PvpMobState на сервере) —
  // применяем к своей локальной копии с тем же pvpMobId. Убийство засчитывается всем,
  // кто его видит в этот момент (не строим делёж лута по вкладу урона, как для
  // групповых боссов — отдельная задача, если понадобится).
  _onPvpMobHitResult(msg) {
    const mob = this.mobs.find(m => m.pvpMobId === msg.mobId && m.alive)
      || this.miningBases.find(b => b.pvpMobId === msg.mobId && b.alive)
      || this.miningBases.flatMap(b => b.turretTargets).filter(Boolean).find(tt => tt.pvpMobId === msg.mobId && tt.alive);
    if (!mob) return;
    if (msg.dodged) { this.showDodge(mob.x, mob.y); return; }
    const hullHit   = msg.killed ? mob.hull   : Math.max(0, mob.hull   - msg.hull);
    const shieldHit = msg.killed ? mob.shield : Math.max(0, mob.shield - msg.shield);
    mob.hull = msg.killed ? 0 : msg.hull;
    mob.shield = msg.killed ? 0 : msg.shield;
    // КРИТИЧНО: без этого Mob.update() считал урон "давним" (lastDamageAt никогда не
    // трогался при обходе локального takeDamage) и мгновенно откатывал щит обратно
    // на следующем же кадре — именно баг "щит откатывается моментально во время боя".
    mob.lastDamageAt = this.time.now;
    // Мировое событие "нашествие": я реально нанёс урон одному из его мобов → участвую
    // в зачистке, получу награду при завершении (см. _updateWorldEvent).
    if (mob.isWorldEvent && msg.attackerUserId === this.myUserId && this._worldEvent) {
      this._worldEvent.damaged = true;
    }
    this.hitFlash(mob.x, mob.y, hullHit > 0, mob);
    this.showDamage(mob.x, mob.y, { shieldHit, hullHit, killed: msg.killed }, msg.maxHull, msg.isCrit);
    if (msg.attackerUserId === this.myUserId && msg.isCrit) {
      const txt = this.add.text(mob.x, mob.y - 40, 'КРИТ!',
        { fontFamily: 'Orbitron', fontSize: '14px', color: '#ffee44', fontStyle: 'bold', resolution: UI_RES })
        .setOrigin(0.5).setDepth(71);
      this.tweens.add({ targets: txt, y: mob.y - 80, alpha: 0, duration: 600, ease: 'Quad.easeOut', onComplete: () => txt.destroy() });
    }
    const attackerName = msg.attackerUserId === this.myUserId
      ? this.playerName
      : this.pvpClient?.players?.get(msg.attackerUserId)?.name;
    if (mob.isMiningBase || mob.isTurretTarget) {
      this._notifyBaseAttack(mob, msg.killed);
      // Урон по базе ИЛИ по её турели — в общий пул захвата САМОЙ БАЗЫ (см.
      // MiningBase._applyCaptureBonus/_recordDamageContribution): "распределение
      // пропорционально урону по турелям и базе".
      (mob.isTurretTarget ? mob.base : mob)._recordDamageContribution(attackerName, hullHit + shieldHit);
    } else if (attackerName) {
      // Групповой (не соло) бой с общим pvpMobId — обычный моб/данж-босс/Апофис тоже
      // может быть убит несколькими игроками; копим вклад для пропорциональной чести
      // (см. onMobKilled → Honor hooks). Соло-энкаунтеры (нет pvpMobId вовсе) сюда не
      // попадают — там честь как раньше, целиком одному игроку.
      mob._damageBy = mob._damageBy || {};
      mob._damageBy[attackerName] = (mob._damageBy[attackerName] || 0) + hullHit + shieldHit;
    }
    // mob.die() — обычно вызывается ИЗНУТРИ Mob.takeDamage() при hull<=0, ДО того как
    // вызывающий код вызовет onMobKilled(). Здесь takeDamage() в принципе не вызывается
    // (сервер решает исход), так что без явного die() mob.alive остаётся true — спрайт
    // не скрывается, следующий выстрел лениво пересоздаёт запись на сервере с полным HP,
    // выглядит как "моб живёт с hull=0, потом сам восстанавливается".
    // MiningBase не имеет .die()/не идёт в onMobKilled() (там ждут mob.tpl для наград) —
    // у базы своя логика разрушения (_onDestroyed: выплата золота владельцам, сброс corp).
    // TurretTarget — свой слот на базе: смерть турели НЕ разрушает саму базу, только
    // освобождает слот (_onTurretDestroyed), в отличие от _onDestroyed.
    if (msg.killed && mob.alive) {
      if (mob.isTurretTarget) { mob.alive = false; mob.base._onTurretDestroyed(mob.slotIdx); }
      else if (mob.isMiningBase) {
        // Mission credit for denying an ENEMY corp's base — checked before _onDestroyed()
        // resets mob.corp to 'neutral'. Contribution-based (like pvp_kill), not just the killing blow.
        if (mob.corp && mob.corp !== 'neutral' && mob.corp !== this.playerCorp && (mob._damageBy?.[this.playerName] > 0)) {
          this.advanceMissionsByEvent('base_kill', obj => !obj.sector || obj.sector === mob.sector);
        }
        mob._onDestroyed();
      }
      // Аргус — свой отдельный reward-пайплайн (ArgusController._onArgusDied(), читает
      // mob._damageBy выше), не onMobKilled() (данж-лут/миссии/star gold там не при
      // делах — mob.tpl.credits/xp у Аргуса нарочно 0, см. constants.js). die() не
      // вызываем — ArgusController.update() сам детектит !mob.alive и разбирает мертвого.
      else if (mob.isArgusBoss) { mob.alive = false; }
      else { mob.die(); this.onMobKilled(mob); }
    }
  }

  // DEV-фоллбэк: pvpClient недоступен — WS/pvpClient никогда не подключается для
  // сессий без реального логина (см. LoginScene "DEV: пропустить авторизацию" —
  // сознательно сбрасывает токен), а бой с pvpMobId-целями идёт ТОЛЬКО через сервер
  // (mobFireClaim), без локального фоллбэка — в реальной игре это не проблема (там
  // всегда есть токен и WS), но означает, что в DEV-режиме без логина игрок вообще не
  // мог наносить урон мобам/базам/турелям в PvP-секторах. Считаем удар локально сами,
  // теми же takeDamage()-путями, что и обычный (не-PvP) бой.
  _localPvpFireResolve(t, dmg, penetration, isCrit) {
    // Записываем вклад в захват ДО takeDamage() — если этот же выстрел добивающий,
    // takeDamage() сама вызовет base._onDestroyed()/_applyCaptureBonus() ВНУТРИ себя
    // (см. MiningBase/TurretTarget.takeDamage), и после возврата _damageBy уже будет
    // очищен — запись постфактум потеряла бы именно добивающий вклад.
    if (t.isMiningBase || t.isTurretTarget) {
      (t.isTurretTarget ? t.base : t)._recordDamageContribution(this.playerName, dmg);
    }
    const res = t.takeDamage(dmg, penetration);
    if (res.dodged) { this.showDodge(t.x, t.y); return; }
    this.hitFlash(t.x, t.y, res.hullHit > 0, t);
    this.showDamage(t.x, t.y, res, t.maxHull, isCrit);
    if (t.isMiningBase || t.isTurretTarget) {
      // База/турель уже сами обработали смерть ВНУТРИ takeDamage() (_onDestroyed/
      // _onTurretDestroyed) — здесь только уведомление владельца в лог.
      this._notifyBaseAttack(t, res.killed);
    } else if (res.killed) {
      this.onMobKilled(t); // Mob.takeDamage() уже вызвал die() сам, onMobKilled — отдельно
    }
  }

  _nearestMiningBase() {
    if (!this.miningBases?.length) return null;
    return this.miningBases
      .slice()
      .sort((a, c) => Phaser.Math.Distance.Between(this.player.x, this.player.y, a.x, a.y)
                    - Phaser.Math.Distance.Between(this.player.x, this.player.y, c.x, c.y))[0];
  }

  // Фоновая догрузка серверного состояния баз сектора (владение/турели/банк) поверх
  // уже заспавненных с дефолтом баз — см. вызов в spawnMobs(). Асинхронно, поэтому
  // явно проверяем, что сектор не сменился и база не уничтожена, пока летел запрос.
  async _loadMiningBaseState(sector, bases) {
    let res;
    try { res = await miningBaseSector(sector); } catch (_) { return; }
    if (galaxy.current !== sector) return; // успели уйти из сектора, пока грузилось
    for (const b of bases) {
      const saved = res?.bases?.[b.id];
      if (saved) b.applyPersistedState(saved);
    }
  }

  // Уведомление владельцев в лог: их база или турель на ней атакована/уничтожена.
  // Для турели владелец берётся с самой базы (mob.base.owners), не с турели.
  // Атаку логируем не чаще раза в 15 сек на объект, чтобы не спамить каждым выстрелом
  // (killed — всегда, независимо от throttle).
  _notifyBaseAttack(mob, killed) {
    const base = mob.isTurretTarget ? mob.base : mob;
    if (!base?.owners?.some(o => o.name === this.playerName)) return;
    const isTurret = mob.isTurretTarget;
    if (killed) {
      this.log(i18n.t(isTurret ? 'log.turret_destroyed' : 'log.base_destroyed'));
      return;
    }
    const now = this.time.now;
    if (now - (mob._lastAttackLogAt || 0) < 15000) return;
    mob._lastAttackLogAt = now;
    this.log(i18n.t(isTurret ? 'log.turret_under_attack' : 'log.base_under_attack'));
  }

  // Реконсиляция уже заспавненных локально мобов с текущим сервер-леджером при входе в
  // сектор — если по мобу уже стреляли до нас, подхватываем актуальный hull/shield
  // вместо "полного HP", с которым он только что заспавнился локально у нас.
  _applyPvpMobSnapshot(mobsById) {
    const turretTargets = this.miningBases.flatMap(b => b.turretTargets).filter(Boolean);
    for (const mob of [...this.mobs, ...this.miningBases, ...turretTargets]) {
      const s = mob.pvpMobId && mobsById[mob.pvpMobId];
      if (s) { mob.hull = s.hull; mob.shield = s.shield; }
    }
  }

  // ── PvP: общий лут с убитых игроков ────────────────────────────────────────
  // Коробка видна только тем, кому сервер её разослал (победитель + все, кто
  // наносил урон) — сама жертва этот Loot никогда не получает.
  _onPvpLootSpawned(msg) {
    const l = new Loot(this, msg.x, msg.y, msg.item, 'boss');
    l.pvpLootId = msg.lootId;
    this.loot.push(l);
    this.log('💰 Трофей с убитого пилота на карте!');
  }

  // Кто-то из eligible уже забрал коробку раньше нас — убираем локальную копию,
  // если она у нас есть (мы могли ещё не долететь/не успеть подобрать).
  _onPvpLootRemoved(lootId) {
    const target = this.loot.find(l => l.pvpLootId === lootId);
    if (target?.alive) target.collect();
    this.loot = this.loot.filter(l => l.alive);
  }

  // Подбор pvpLootId-лута — не гранится локально сразу (в отличие от обычного лута),
  // ждём авторитетного pvp_loot_result: могли не успеть первыми.
  _claimPvpLoot(target) {
    if (target._claimPending) return;
    target._claimPending = true;
    (this._pvpLootPending ??= new Map()).set(target.pvpLootId, target);
    this.pvpClient?.claimLoot(target.pvpLootId);
  }

  _onPvpLootResult(msg) {
    const target = this._pvpLootPending?.get(msg.lootId);
    this._pvpLootPending?.delete(msg.lootId);
    if (!target) return;
    if (msg.granted) {
      const item = msg.item || target.item;
      this.inventory.push(item);
      this.log(i18n.t('log.loot_pickup', { item: itemName(item) }));
      this._saveState();
    } else {
      this.log('Трофей уже забрали.');
    }
    if (target.alive) target.collect();
    this.loot = this.loot.filter(l => l.alive);
  }

  // Условные множители урона от перков, требующие live-состояния цели/игрока в
  // момент выстрела (щит цели, её скорость, HP игрока) — их нельзя запечь статически
  // в recomputeStats, как cannonPerkPct. cannonOnly — перки из пула WEAPON_PERKS
  // (anti_armor/marksman/vengeance) катаются только на пушки, лазер их не получает;
  // phase_shifter/last_stand — щитовые перки, работают с любым оружием.
  _offensivePerkMult(p, t, cannonOnly) {
    let mult = 1;
    if (cannonOnly) {
      if (p.antiArmorPct > 0 && (t.maxShield <= 0 || (t.shield / t.maxShield) < 0.25)) mult *= (1 + p.antiArmorPct);
      if (p.marksmanPct > 0) {
        const tSpd = t.sprite?.body ? Math.hypot(t.sprite.body.velocity.x, t.sprite.body.velocity.y) : 0;
        if (tSpd < 10) mult *= (1 + p.marksmanPct);
      }
      if (p.vengeancePct > 0 && p.maxHull > 0 && p.hull / p.maxHull < 0.4) mult *= (1 + p.vengeancePct);
    }
    if (p.phaseShifterPct > 0 && t.maxShield > 0 && (t.shield / t.maxShield) > 0.5) mult *= (1 + p.phaseShifterPct);
    if (p.lastStandPct > 0 && p.maxHull > 0 && p.hull / p.maxHull < 0.20) mult *= (1 + p.lastStandPct);
    return mult;
  }

  // Hitscan laser: instant hit, accuracy check, shield/hull multipliers, amber VFX beam.
  _fireLaser(skillMult = 1, isOC = false) {
    const t = this.target, p = this.player;
    if (!t?.alive || !p.alive) return;

    // PvP: как в _fireCannon — сервер решает исход, клиент только рисует луч и заявляет
    // выстрел. Вне реальных PvP-секторов И свой корпус — везде союзники (см. комментарий
    // в _fireCannon про будущую арену-исключение).
    if (t.isRemotePlayer) {
      if (!this._isPvpSector || (t.corp && t.corp === this.playerCorp)) {
        this._warnThrottle('ally_fire', 'Нельзя атаковать союзника'); return;
      }
      const beamColor = isOC ? 0xffcc00 : p.allLasers ? 0xce93d8 : 0xffaa00;
      const perkMult = this._offensivePerkMult(p, t, false);
      const dmg = Math.round(p.laserDamage * skillMult * perkMult);
      this._laserBeam(p.x, p.y, t.x, t.y, beamColor, 1.0, isOC ? 12 : 3, 200, p, t);
      this.muzzleFlash(p.x, p.y, beamColor, p);
      this.sfx?.play('sfx_laser_fire', { cooldownMs: 60 });
      this._consumeAmmo('laser');
      this.pvpClient?.fireClaim(t.userId, 'laser', dmg);
      return;
    }
    if (t.pvpMobId) {
      if (t.corp && t.corp === this.playerCorp) { this._warnThrottle('ally_fire', 'Нельзя атаковать свою базу'); return; }
      const beamColor = isOC ? 0xffcc00 : p.allLasers ? 0xce93d8 : 0xffaa00;
      const perkMult = this._offensivePerkMult(p, t, false);
      const dmg = Math.round(p.laserDamage * skillMult * perkMult);
      this._laserBeam(p.x, p.y, t.x, t.y, beamColor, 1.0, isOC ? 12 : 3, 200, p, t);
      this.muzzleFlash(p.x, p.y, beamColor, p);
      this.sfx?.play('sfx_laser_fire', { cooldownMs: 60 });
      this._consumeAmmo('laser');
      if (this.pvpClient) {
        this.pvpClient.mobFireClaim(t.pvpMobId, t.maxHull, t.maxShield, t.x, t.y, 'laser', dmg);
      } else {
        // DEV-фоллбэк без сервера — см. _fireCannon выше.
        const isCrit = p.critChance > 0 && Math.random() < p.critChance;
        this._localPvpFireResolve(t, isCrit ? Math.round(dmg * (p.critMult ?? 2)) : dmg, p.weaponPenetration, isCrit);
      }
      return;
    }

    if (this._hasWallBetween(p.x, p.y, t.x, t.y)) return;

    const hit    = Math.random() < (p.laserAccuracy ?? 0.80);
    const isCrit = hit && p.critChance > 0 && Math.random() < p.critChance;

    // Beam visual: OC=thick bright-yellow, crit=medium-yellow, normal=amber (purple if all-laser loadout), miss=dim
    const allLasers = p.allLasers;
    const beamColor = isOC ? 0xffcc00 : isCrit ? 0xffff44 : allLasers ? 0xce93d8 : 0xffaa00;
    const beamWidth = isOC ? 12 : isCrit ? 6 : 3;
    this._laserBeam(p.x, p.y, t.x, t.y, beamColor, hit ? 1.0 : 0.25, beamWidth, 200, p, t);
    this.muzzleFlash(p.x, p.y, beamColor, p);
    // Animated muzzle discharge — beam1 rotated toward target
    const _beamAngle = Math.atan2(t.y - p.y, t.x - p.x);
    const _beamSpr = this.vfx?.play('laser_beam1', p.x, p.y, { scale: isOC ? 0.22 : isCrit ? 0.17 : 0.13, depth: 64 });
    if (_beamSpr) { _beamSpr.setRotation(_beamAngle); this._attachFx(_beamSpr, p); }

    if (!hit) { this.sfx?.play('sfx_weapon_miss', { volume: 0.4, cooldownMs: 80 }); return; }

    this.sfx?.play('sfx_laser_fire', { cooldownMs: 60 });
    if (isCrit) this.sfx?.play('sfx_crit', { volume: 0.7 });
    this._consumeAmmo('laser');
    const perkMult = this._offensivePerkMult(p, t, false);
    const dmg = Math.round(p.laserDamage * skillMult * perkMult * (isCrit ? (p.critMult ?? 2) : 1));
    const opts = { shieldMult: p.weaponShieldMult ?? 0.90, hullMult: p.weaponHullMult ?? 1.30, ignoreMovEvasion: true };
    const res = t.takeDamage(dmg, p.weaponPenetration, opts);

    this._attachFx(this.vfx?.play('laser_beam2', t.x, t.y, { scale: isOC ? 0.22 : 0.13, depth: 67 }), t);
    if (res.dodged) { this.showDodge(t.x, t.y); return; }
    const toHull = (res.hullHit || 0) > 0;
    this.hitFlash(t.x, t.y, toHull, t);
    if (toHull && this._onScreen(t.x, t.y)) this._attachFx(this.vfx?.play('hull_hit', t.x, t.y, { scale: 0.15, depth: 67 }), t);
    this.showDamage(t.x, t.y, res, t.maxHull, isCrit);
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

  // e1/e2 — опционально: живые сущности на концах луча (Player/Mob). Без них —
  // прежнее поведение (луч рисуется раз и просто гаснет). С ними — оба конца
  // пересчитываются каждый кадр в _updateTrackedBeams, пока луч не погаснет.
  _laserBeam(x1, y1, x2, y2, color, alpha, width = 3, duration = 200, e1 = null, e2 = null) {
    const g = this.add.graphics().setDepth(65).setBlendMode('ADD');
    const draw = (ax, ay, bx, by) => {
      g.clear();
      const line = () => { g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.strokePath(); };
      g.lineStyle(width * 6, color, 0.12 * alpha); line();               // outer glow
      g.lineStyle(width * 2.5, color, 0.35 * alpha); line();             // mid halo
      g.lineStyle(Math.max(1, width * 0.6), 0xffffff, 0.90 * alpha); line(); // bright core
    };
    draw(x1, y1, x2, y2);
    if (e1 || e2) (this._trackedBeams ??= []).push({ g, e1, e2, x1, y1, x2, y2, draw });
    this.tweens.add({ targets: g, alpha: 0, duration, ease: 'Expo.easeOut', onComplete: () => g.destroy() });
    return g;
  }
  fireMobWeapon(mob, tx, ty, victim = this.player, extraOpts = {}) {
    const pType = mob.tpl.projectileType || 'plasma';
    const cfg   = PROJ_TYPES[pType] || PROJ_TYPES.plasma;
    // Крит — только у боссов (рядовые мобы не критуют, у игрока крит уже есть
    // симметрично). Веерные (ion) выстрелы не критуют — 3 независимых ролла на
    // один залп были бы визуально шумными.
    const isCrit  = !!mob.isBoss && Math.random() < (BOSS.critChance ?? 0.15);
    const dmgMult = isCrit ? (BOSS.critMult ?? 1.8) : 1;

    // void — хитскан: мгновенный луч, урон без снаряда
    if (cfg.hitscan) {
      if (this._hasWallBetween(mob.x, mob.y, victim.x, victim.y)) return;
      const pen = cfg.penetration ?? 0.6;
      const res = victim.takeDamage(mob.damage * dmgMult, pen, { ignoreMovEvasion: true, dmgType: pType, ...extraOpts });
      this._laserBeam(mob.x, mob.y, victim.x, victim.y, isCrit ? 0xffe14d : 0xce93d8, isCrit ? 1.0 : 0.85, isCrit ? 6 : 4, 200, mob, victim);
      this.sfx?.play('sfx_mob_fire_hitscan', { volume: 0.4, cooldownMs: 90 });
      this.onProjectileHit({ owner: 'mob', victim, type: pType, effect: null, effectCfg: cfg, isCrit }, res);
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
      this.muzzleFlash(mob.x, mob.y, 0x80d8ff, mob);
      this.sfx?.play('sfx_mob_fire_plasma', { volume: 0.35, cooldownMs: 90 });
      return;
    }

    // Остальные типы: один болт с самонаведением
    const turnRate = mob.isBoss ? (180 * Math.PI / 180) : (90 * Math.PI / 180);
    const pen = cfg.penetration ?? 0.05;
    this.projectiles.push(new Projectile(this, 'mob', mob.x, mob.y, tx, ty, victim, mob.damage * dmgMult, pen, cfg.color, turnRate, pType, isCrit));
    // gunner — единственный признак класса был +20% к скорострельности, никак не
    // читаемый на глаз; даём его выстрелу свою, более резкую/яркую вспышку
    const flashColor = isCrit ? 0xffe14d : mob.tpl.aiClass === 'gunner'
      ? 0xffffff
      : ({ plasma: 0xff8a7a, acid: 0x76ff03, grav: 0xffb74d, emp: 0x4dd0e1 }[pType] ?? 0xff8a7a);
    this.muzzleFlash(mob.x, mob.y, flashColor, mob);
    this.sfx?.play('sfx_mob_fire_plasma', { volume: 0.35, cooldownMs: 90 });
  }
  // entity — опционально: живая сущность (Player/Mob), за которой эффект должен
  // следовать все время своей жизни. Без него — прежнее поведение (снимок позиции),
  // это ломало эффекты на движущемся корабле: вспышка оставалась висеть в пустом
  // космосе, пока корабль улетал дальше за время тви́на.
  muzzleFlash(x, y, color, entity) {
    const f = this.add.image(x, y, 'glow').setTint(color).setBlendMode(Phaser.BlendModes.ADD).setDepth(61).setDisplaySize(10, 10);
    this.tweens.add({ targets: f, displayWidth: 48, displayHeight: 48, alpha: 0, duration: 110, ease: 'Quad.easeOut', onComplete: () => f.destroy() });
    return entity ? this._attachFx(f, entity) : f;
  }
  // combatSfx=true — по умолчанию для реальных боевых попаданий; при переиспользовании
  // hitFlash как generic-вспышки для активации скиллов (ремонт и т.п.) передают false,
  // иначе "ремкомплект" звучал бы как "попадание по корпусу".
  hitFlash(x, y, toHull, entity, combatSfx = true) {
    const f = this.add.image(x, y, 'glow').setTint(toHull ? 0xffa040 : 0x8fe6ff).setBlendMode(Phaser.BlendModes.ADD).setDepth(67).setDisplaySize(16, 16);
    this.tweens.add({ targets: f, displayWidth: 58, displayHeight: 58, alpha: 0, duration: 170, ease: 'Quad.easeOut', onComplete: () => f.destroy() });
    if (combatSfx) this.sfx?.play(toHull ? 'sfx_hit_hull' : 'sfx_hit_shield', { volume: 0.45, cooldownMs: 40 });
    return entity ? this._attachFx(f, entity) : f;
  }

  // Держит переданный game-object на позиции живой сущности (Player/Mob) до тех
  // пор, пока объект не уничтожится (по завершении твина) или сущность не умрёт.
  _attachFx(obj, entity) {
    if (!obj) return obj;
    (this._attachedFx ??= []).push({ obj, entity });
    return obj;
  }
  // Раздаёт отложенных амбиентных мобов (см. spawnMobs() "expanded home map spawns")
  // по несколько штук за кадр вместо всех разом синхронно внутри create() — сглаживает
  // скачок нагрузки сразу после прыжка в сектор. Порядок гарантированно совпадает у
  // всех клиентов комнаты (см. комментарий в spawnMobs()), т.к. каждый клиент обраба-
  // тывает ОДИН и тот же фиксированный массив в неизменном порядке — реальное время
  // обработки может отличаться по FPS клиента, порядок присвоения pvpMobId — нет.
  _processPendingAmbientSpawns() {
    const q = this._pendingAmbientSpawns;
    if (!q?.length) return;
    const BATCH = 4;
    for (let i = 0; i < BATCH && q.length; i++) q.shift()();
  }

  // Один общий Graphics-канвас для HP/shield-баров ВСЕХ мобов — см. mobBarsGfx в
  // create(). Полностью пересобираем геометрию каждый кадр (mob.x/y меняются почти
  // всегда), но это ОДИН clear()+redraw на канвас вместо N отдельных Graphics-
  // объектов — сама заливка прямоугольников дешёвая (см. профилировку:
  // FillPathWebGL — единицы мс суммарно), дорог был рендер-степ ПО ОБЪЕКТУ.
  _redrawMobBars() {
    const g = this.mobBarsGfx;
    g.clear();
    const w = 46, h = 4;
    for (const m of this.mobs) {
      // Тренажёры (DEV key 7) рисуют свой собственный увеличенный бар (barGfx в
      // _makeTrainingDummy) — не дублируем стандартным мобовским баром поверх.
      if (!m.alive || m.isTrainingDummy) continue;
      const hullFrac = m.hull / m.maxHull;
      const shieldFrac = m.maxShield > 0 ? m.shield / m.maxShield : 0;
      const barY = m.y - (m.tpl?.displaySize ?? 60) * 0.6;
      g.fillStyle(0x000000, 0.5); g.fillRect(m.x - w / 2 - 1, barY - 1, w + 2, h + 2);
      g.fillStyle(COLORS.danger, 1);
      g.fillRect(m.x - w / 2, barY, w * hullFrac, h);
      if (m.maxShield > 0) {
        g.fillStyle(COLORS.primary, 1);
        g.fillRect(m.x - w / 2, barY - 3, w * shieldFrac, 2);
      }
    }
  }

  // Тот же принцип, что и _redrawMobBars() — один общий канвас на ВСЕ базы+турели
  // вместо ~21 отдельного Rectangle-объекта на каждую MiningBase (свой бар ×3 + 6
  // турелей ×3). Координаты те же, что были у Rectangle с setOrigin(0,0.5)/(0.5,0.5) —
  // просто пересчитаны под fillRect(x,y,w,h), у которого (x,y) — левый верхний угол.
  _redrawMiningBaseBars() {
    const g = this.miningBaseBarsGfx;
    g.clear();
    const sz  = BASE_CONFIG.displaySize;
    const tsz = BASE_CONFIG.turretSize;
    for (const b of this.miningBases) {
      if (b.state === 'destroyed') continue;
      const hullFrac   = b.maxHull   > 0 ? b.hull   / b.maxHull   : 0;
      const shieldFrac = b.maxShield > 0 ? b.shield / b.maxShield : 0;
      const barY = b.y - sz / 2 - 22;
      const color = hullFrac > 0.5 ? 0x4dd0e1 : hullFrac > 0.25 ? 0xffb74d : 0xef5350;
      g.fillStyle(0x333344, 1); g.fillRect(b.x - 100, barY - 4, 200, 8);
      g.fillStyle(color, 1);    g.fillRect(b.x - 100, barY - 4, 200 * hullFrac, 8);
      if (b.maxShield > 0) {
        g.fillStyle(0x80deea, 1);
        g.fillRect(b.x - 100, barY - 8, 200 * shieldFrac, 4);
      }

      b.turrets.forEach((type, i) => {
        const tt = b.turretTargets[i];
        if (!type || b.state !== 'active' || !tt?.alive) return;
        const off = b._turretOffsets?.[i];
        if (!off) return;
        const bx = b.x + off.x, by = b.y + off.y + tsz / 2 + 8;
        const tHullFrac   = tt.maxHull   > 0 ? tt.hull   / tt.maxHull   : 0;
        const tShieldFrac = tt.maxShield > 0 ? tt.shield / tt.maxShield : 0;
        g.fillStyle(0x000000, 0.5); g.fillRect(bx - TBAR_W / 2, by - TBAR_H / 2, TBAR_W, TBAR_H);
        g.fillStyle(0xef5350, 1);   g.fillRect(bx - TBAR_W / 2, by - TBAR_H / 2, TBAR_W * tHullFrac, TBAR_H);
        if (tt.maxShield > 0) {
          g.fillStyle(0x4dd0e1, 1);
          g.fillRect(bx - TBAR_W / 2, by - TBAR_H - 1, TBAR_W * tShieldFrac, 2);
        }
      });
    }
  }

  _updateAttachedFx() {
    const arr = this._attachedFx;
    if (!arr?.length) return;
    // Swap-pop in-place — .filter() пересобирал новый массив КАЖДЫЙ кадр, пока
    // висит хоть один hit-flash, то же самое "пила" JS heap, что и у projectiles
    // выше (см. update()) — тот же фикс, тот же паттерн.
    for (let i = arr.length - 1; i >= 0; i--) {
      const { obj, entity } = arr[i];
      if (!obj.active || entity?.alive === false) { arr[i] = arr[arr.length - 1]; arr.pop(); continue; }
      obj.setPosition(entity.x, entity.y);
    }
  }

  // Как _laserBeam, но пересчитывает оба конца линии каждый кадр по живым
  // координатам сущностей — иначе луч рисуется один раз в момент выстрела и
  // «зависает» в пустом космосе, пока стрелок/цель продолжают лететь.
  _updateTrackedBeams() {
    const arr = this._trackedBeams;
    if (!arr?.length) return;
    // Swap-pop in-place — см. _updateAttachedFx выше, тот же принцип.
    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i];
      if (!b.g.active) { arr[i] = arr[arr.length - 1]; arr.pop(); continue; }
      const ax = b.e1?.alive !== false ? (b.e1?.x ?? b.x1) : b.x1;
      const ay = b.e1?.alive !== false ? (b.e1?.y ?? b.y1) : b.y1;
      const bx = b.e2?.alive !== false ? (b.e2?.x ?? b.x2) : b.x2;
      const by = b.e2?.alive !== false ? (b.e2?.y ?? b.y2) : b.y2;
      b.draw(ax, ay, bx, by);
    }
  }
  // Plasma Bleed / Splinter (cannon-only weapon perks) — срабатывают на каждом
  // успешном попадании пушки; лазер их не получает, см. _offensivePerkMult.
  _applyCannonHitPerks(mob, dmgDealt) {
    const p = this.player;
    if (p.plasmaBleedPct > 0) {
      mob._bleedDps   = (dmgDealt * p.plasmaBleedPct) / 2;
      mob._bleedTimer = 2;
    }
    if (p.splinterPct > 0) {
      const splashDmg = dmgDealt * p.splinterPct;
      for (const m2 of this.mobs) {
        if (m2 === mob || !m2.alive) continue;
        const d = Phaser.Math.Distance.Between(mob.x, mob.y, m2.x, m2.y);
        if (d > 150) continue;
        const r2 = m2.takeDamage(splashDmg, 0.3, { ignoreMovEvasion: true });
        this.showDamage(m2.x, m2.y, r2, m2.maxHull);
        if (r2.killed) this.onMobKilled(m2);
      }
    }
  }
  onProjectileHit(proj, res) {
    if (proj.owner === 'player') {
      const m = proj.victim;
      if (res.dodged) { this.showDodge(m.x, m.y); return; }
      const toHull = (res.hullHit || 0) > 0;
      this.hitFlash(m.x, m.y, toHull, m);
      if (toHull && this._onScreen(m.x, m.y)) this._attachFx(this.vfx?.play('hull_hit', m.x, m.y, { scale: 0.15, depth: 67 }), m);
      this.showDamage(m.x, m.y, res, m.maxHull, proj.isCrit);
      const dmgDone = (res.shieldHit || 0) + (res.hullHit || 0);
      if (dmgDone > 0) this.groupSystem?.recordDamage(dmgDone);
      if (dmgDone > 0) this._applyCannonHitPerks(m, dmgDone);
      if (res.killed) {
        if (m.ghostBoss) m.hull = 1; // не убиваем призрака — смерть придёт от сервера
        else this.onMobKilled(m);
      }
    } else {
      const hx = proj.victim?.x ?? this.player.x;
      const hy = proj.victim?.y ?? this.player.y;
      if (res?.dodged) { this.showDodge(hx, hy); return; }
      const toHull = (res?.hullHit || 0) > 0;
      this.hitFlash(hx, hy, toHull, proj.victim);
      if (toHull) this._attachFx(this.vfx?.play('hull_hit', hx, hy, { scale: 0.15, depth: 67 }), proj.victim);
      this.showDamage(hx, hy, res, proj.victim?.maxHull, proj.isCrit);
      if (proj.isCrit && proj.victim === this.player) {
        const txt = this.add.text(hx, hy - 40, 'КРИТ БОССА!',
          { fontFamily: 'Orbitron', fontSize: '13px', color: '#ffe14d', fontStyle: 'bold', resolution: UI_RES })
          .setOrigin(0.5).setDepth(71);
        this.tweens.add({ targets: txt, y: hy - 78, alpha: 0, duration: 600, ease: 'Quad.easeOut', onComplete: () => txt.destroy() });
      }
      if (proj.victim === this.player && !res?.dodged) {
        this._applyProjEffect(proj, hx, hy);
        if (res?.brokeShield) this.log(i18n.t('log.shield_down'));
        this._shakeForHit(res, this.player.maxHull);
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
    this.player?.triggerEnergyShunt();
    this.explosion(mob.x, mob.y, mob.isBoss ? 1.6 : 0.6);
    this.sfx?.play(mob.isBoss ? 'sfx_explosion_boss' : 'sfx_explosion_small', { volume: mob.isBoss ? 0.8 : 0.5, cooldownMs: mob.isBoss ? 0 : 60 });
    if (mob.isBoss) { this._shake(280, 0.013); this.cameras.main.flash(140, 255, 210, 140, true); }
    const name = i18n.t(mob.tpl.nameKey); const lvl = `${i18n.t('mob.level')}${mob.level}`;
    const lvlScale = 1 + 0.5 * (mob.level - 1);
    const _credMult = this.player?.creditBonusMod ?? 1;
    const sec = SECTORS[galaxy.current];
    const isDung = sec?.isDungeon === true;
    // Прогресс инстанса на сутки: отмечаем убитого моба на сервере, чтобы при
    // выходе-входе (пока есть жизни) он не заспавнился заново
    if (isDung && this._dungeonRunId && mob.dungeonId) {
      dungeonMobKilled(this._dungeonRunId, mob.dungeonId).catch(() => {});
    }
    // Лут данж-инстанса тоже персистится на сервере (DungeonRun.floor_loot),
    // чтобы не подобранные предметы оставались на полу при возврате тем же днём
    const pushLoot = (x, y, item, tier) => {
      const l = new Loot(this, x, y, item, tier);
      if (isDung && this._dungeonRunId) {
        l.dungeonLootId = `l${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        dungeonLootDrop(this._dungeonRunId, { id: l.dungeonLootId, x: Math.round(x), y: Math.round(y), item }).catch(() => {});
      }
      this.loot.push(l);
      return l;
    };
    const diff = isDung ? this._dungeonDiff() : null;
    // Лут-бюджет данжа: мобов стало больше (DUNGEON_MOB_GROWTH), награда с каждого
    // обычного моба режется так, чтобы суммарный фарм вырос ≤ LOOT_BUDGET_CAP.
    // Боссы и R-1-boss не нормализуются.
    const lootNorm = (isDung && galaxy.current !== 'R-1-boss' && !mob.isDungeonBoss)
      ? dungeonLootNorm(galaxy.current) : 1;
    const credits = Math.round(mob.tpl.credits * lvlScale * _credMult * lootNorm / 5);
    const xp = Math.round(mob.tpl.xp * lvlScale * (diff?.xpMult ?? 1) * lootNorm / 60);
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
      if (mob.isDungeonBoss) {
        const dsg = DUNGEON_STAR_GOLD[galaxy.current];
        sg = dsg ? Phaser.Math.Between(dsg.bossMin, dsg.bossMax) : rollStarGold(mob);
      } else {
        const rawSg = rollStarGold(mob);
        const dsg = DUNGEON_STAR_GOLD[galaxy.current];
        sg = rawSg > 0 ? Math.round(rawSg * (dsg?.mobMult ?? 1) * lootNorm) : 0;
      }
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
    const mobDropRate = isDung ? (diff?.dropRate ?? 0.10) * lootNorm : dropChance(mob) * (this.player?.dropChanceMult ?? 1);
    if (isDung && (mob.isSummon || (!mob.isBoss && !mob.tpl.elite && !mob.isBossEscort))) {
      // Обычный данж-моб (и саммоны боссовых фаз): шанс дропа по сложности ×norm
      if (Phaser.Math.FloatBetween(0, 1) < mobDropRate) {
        const lootItem = rollLootForMob(mob);
        pushLoot(mob.x, mob.y, lootItem, 'common');
      }
    } else if (isDung && (mob.isBoss || mob.tpl.elite || mob.isBossEscort)) {
      // Босс/элита/минибосс: 100% дроп
      {
        const lootItem = mob.tpl.key === 'ancient_12' ? rollApophisLoot() : rollLootForMob(mob);
        const isLegendary = mob.tpl.key === 'ancient_12' || mob.tpl.key === 'argus_boss' || mob.isBoss;
        const lootTier = isLegendary ? 'legendary' : 'boss';
        const isPremium = lootItem.tier === 4 || lootItem.perk?.rarity === 'jackpot';
        pushLoot(mob.x, mob.y, lootItem, isPremium ? 'jackpot' : lootTier);
      }
    } else {
      // Обычный сектор (не данж): домашние карты — таблица по тиру/сектору; PvP — прежняя логика.
      const _sIdx = parseInt(galaxy.current.split('_').pop());
      const _isHome = !sec?.pvp && _sIdx >= 1 && _sIdx <= 5;
      if (_isHome) {
        const lootItem = rollHomeSectorLoot(mob, _sIdx, this.player?.dropChanceMult ?? 1);
        if (lootItem) {
          const lootTier = mob.isBoss ? 'boss' : 'common';
          const isPremium = lootItem.tier === 4 || lootItem.perk?.rarity === 'jackpot';
          this.loot.push(new Loot(this, mob.x, mob.y, lootItem, isPremium ? 'jackpot' : lootTier));
        }
      } else {
        if (Phaser.Math.FloatBetween(0, 1) < dropChance(mob) * (this.player?.dropChanceMult ?? 1)) {
          const lootItem = mob.tpl.key === 'ancient_12' ? rollApophisLoot() : rollLootForMob(mob);
          const isLegendary = mob.tpl.key === 'ancient_12' || mob.tpl.key === 'argus_boss';
          const lootTier = isLegendary ? 'legendary' : (mob.isBoss || mob.tpl.elite) ? 'boss' : 'common';
          const isPremium = lootItem.tier === 4 || lootItem.perk?.rarity === 'jackpot'
            || lootItem.type === 'biomech_core' || lootItem.type === 'quantum_crystal' || lootItem.type === 'plasma_coil';
          this.loot.push(new Loot(this, mob.x, mob.y, lootItem, isPremium ? 'jackpot' : lootTier));
        }
      }
    }

    const consDrop = rollConsumableDrop(mob);
    if (consDrop && (lootNorm === 1 || Math.random() < lootNorm)) {
      const ox = Phaser.Math.Between(-24, 24), oy = Phaser.Math.Between(-24, 24);
      pushLoot(mob.x + ox, mob.y + oy, consDrop, 'common');
    }

    // Патроны намеренно НЕ нормализуются: больше мобов = больше расход боезапаса (сустейн, не фарм)
    const ammoDrop = rollAmmoDrop(mob, isDung, this.dungeonDifficulty);
    if (ammoDrop) {
      const ox = Phaser.Math.Between(-24, 24), oy = Phaser.Math.Between(-24, 24);
      pushLoot(mob.x + ox, mob.y + oy, ammoDrop, 'common');
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
          if (!mob.alive) {
            if (!SECTORS[galaxy.current]?.isDungeon) {
              const pt = this._randomRespawnPoint();
              mob.spawnX = pt.x; mob.spawnY = pt.y;
            }
            mob.respawn();
            this.log(i18n.t('log.respawn', { name, lvl }));
          }
        });
      }
    }
    // Mission hooks
    this.advanceMissionsByEvent('kill', obj => matchKillObjective(mob, obj));
    if (mob.isDungeonBoss && galaxy.current === 'R-1-boss') {
      this.advanceMission('story_signal', 1);
      this._completeDungeonRun();
    }
    if (mob.isDungeonBoss && isDung && galaxy.current !== 'R-1-boss') {
      this._completeDungeonRun();
    }
    // Honor hooks — если моба убило несколько игроков (общий pvpMobId, см.
    // _onPvpMobHitResult → mob._damageBy), честь делится пропорционально своей доле
    // урона, округление математическое. Соло (нет _damageBy) — доля 1.0, как раньше.
    const honorShare = (() => {
      const by = mob._damageBy;
      if (!by) return 1;
      const total = Object.values(by).reduce((s, d) => s + d, 0);
      return total > 0 ? (by[this.playerName] || 0) / total : 0;
    })();
    if (mob.tpl.key === 'ancient_12') {
      this.gainHonor(Math.round(HONOR.APOPHYSIS * honorShare));
    } else if (mob.isDungeonBoss) {
      const pl = this.pilotLevel || 1;
      const bH = mob.level > pl ? HONOR.BOSS_HIGHER : mob.level === pl ? HONOR.BOSS_EQUAL : HONOR.BOSS_LOWER;
      this.gainHonor(Math.round(bH * honorShare));
    }
    if (sec?.isDungeon) {
      if (galaxy.current === 'R-1-boss' && mob.corridorIndex !== undefined) {
        this._checkCorridorClear(mob.corridorIndex);
      } else {
        this._checkDungeonBossDoor();
      }
    }
  }

  _trackClanContrib(type, amount) {
    if (!this.clan) return;
    const name = this.playerName || 'Пилот';
    this.clan.contributions = this.clan.contributions || {};
    const c = this.clan.contributions[name] = this.clan.contributions[name] || { biomech_core: 0, quantum_crystal: 0, plasma_coil: 0, credits: 0 };
    if (c[type] !== undefined) c[type] += amount;
    this.advanceMissionsByEvent('clan_resource', obj => obj.resource === type, amount);
  }

  // ── Mission system ───────────────────────────────────────────────────────
  initMissionState() {
    if (!this.missionState) this.missionState = {};
    const bracket = dailyBracketFor(this.pilotLevel);
    const bracketed = (m) => (m.type === 'daily' || m.type === 'weekly') && m.bracket !== bracket;

    for (const m of MISSIONS) {
      if (bracketed(m)) continue; // other brackets aren't tracked/shown
      if (!this.missionState[m.id]) {
        // comingSoon missions (e.g. arena stubs — the mode doesn't exist yet) stay locked
        // regardless of level; weekly contracts stay locked until the 5/7 perfect-day threshold.
        const locked = m.comingSoon || (m.minLevel ?? 1) > (this.pilotLevel ?? 1)
          || (m.type === 'weekly' && (this.dailyPerfectDays || 0) < 5);
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

    const nowMs = Date.now();
    const isRealDailyReset = !this.missionDailyReset || nowMs >= this.missionDailyReset;
    const bracketChanged   = this._lastDailyBracket !== undefined && this._lastDailyBracket !== bracket;

    // A real midnight rollover (not just a mid-day bracket change from levelling up) is when
    // we credit yesterday's "perfect day" — evaluated against still-yesterday's state, BEFORE
    // the reset block below wipes it.
    if (isRealDailyReset) {
      const yesterdaysDailies = MISSIONS.filter(m => m.type === 'daily' && m.bracket === bracket);
      if (yesterdaysDailies.length && yesterdaysDailies.every(m => this.missionState[m.id]?.status === 'completed')) {
        this.dailyPerfectDays = (this.dailyPerfectDays || 0) + 1;
      }
      this.dailySetBonusGranted = false;
    }

    // Weekly reset — every Monday 00:00 local time (any 5 of the last 7 days count, not
    // required consecutive — see dailyPerfectDays above).
    if (!this.weeklyReset || nowMs >= this.weeklyReset) {
      const nextMonday = new Date(); nextMonday.setHours(0, 0, 0, 0);
      nextMonday.setDate(nextMonday.getDate() + ((8 - nextMonday.getDay()) % 7 || 7));
      this.weeklyReset = nextMonday.getTime();
      this.dailyPerfectDays = 0;
      for (const m of MISSIONS) { if (m.type === 'weekly') delete this.missionState[m.id]; }
    }

    if (isRealDailyReset || bracketChanged) {
      const tomorrow = new Date(); tomorrow.setHours(24, 0, 0, 0);
      this.missionDailyReset = tomorrow.getTime();
      for (const m of MISSIONS) {
        if (m.type !== 'daily') continue;
        if (m.bracket !== bracket) { delete this.missionState[m.id]; continue; }
        const locked = (m.minLevel ?? 1) > (this.pilotLevel ?? 1);
        this.missionState[m.id] = {
          status: locked ? 'locked' : m.defaultStatus,
          objectives: m.objectives.map(() => ({ current: 0 })),
        };
      }
      for (const m of MISSIONS) {
        if (m.type !== 'weekly') continue;
        if (m.bracket !== bracket) { delete this.missionState[m.id]; continue; }
        if (!this.missionState[m.id]) {
          const locked = (this.dailyPerfectDays || 0) < 5 || (m.minLevel ?? 1) > (this.pilotLevel ?? 1);
          this.missionState[m.id] = {
            status: locked ? 'locked' : m.defaultStatus,
            objectives: m.objectives.map(() => ({ current: 0 })),
          };
        }
      }
    }

    // Live-unlock: threshold reached mid-week without a bracket/daily reset having fired.
    for (const m of MISSIONS) {
      if (m.type !== 'weekly' || m.bracket !== bracket) continue;
      const st = this.missionState[m.id];
      if (st?.status === 'locked' && (this.dailyPerfectDays || 0) >= 5 && (m.minLevel ?? 1) <= (this.pilotLevel ?? 1)) {
        st.status = m.defaultStatus;
      }
    }

    this._lastDailyBracket = bracket;
  }

  completeMission(id) {
    const m = MISSIONS.find(m => m.id === id);
    const state = this.missionState?.[id];
    if (!m || !state || state.status === 'completed') return;
    state.status = 'completed';
    this.credits = (this.credits || 0) + m.rewards.credits;
    this.gainXp(m.rewards.xp);
    if (m.rewards.stars > 0) this.starGold = (this.starGold || 0) + m.rewards.stars;
    const bonus = this._pendingChoiceBonus;
    if (bonus) {
      this.credits = (this.credits || 0) + (bonus.credits || 0);
      if (bonus.stars) this.starGold = (this.starGold || 0) + bonus.stars;
      if (bonus.honor) this.gainHonor(bonus.honor);
      if (bonus.corpRep) this.gainCorpRep(bonus.corpRep);
      this._pendingChoiceBonus = null;
    }
    if (m.rewards.unlockFlag) {
      this.unlockFlags = this.unlockFlags || {};
      this.unlockFlags[m.rewards.unlockFlag] = true;
    }
    this.gainCorpRep(0.01);
    this.log(`Миссия завершена: ${m.title}`);
    this.log(`+${m.rewards.credits} кр · +${m.rewards.xp} XP${m.rewards.stars > 0 ? ` · +${m.rewards.stars} ★` : ''}`);
    if (m.type === 'daily') this._checkDailySetBonus();
  }

  // "Весь комплект": все дейлики текущей ветки за сегодня выполнены → +10% сверху
  // от их суммарной награды, один раз в день (сбрасывается вместе с dailySetBonusGranted
  // в initMissionState на полуночном ресете).
  _checkDailySetBonus() {
    if (this.dailySetBonusGranted) return;
    const bracket = dailyBracketFor(this.pilotLevel);
    const todays = MISSIONS.filter(m => m.type === 'daily' && m.bracket === bracket);
    if (!todays.length) return;
    const allDone = todays.every(m => this.missionState?.[m.id]?.status === 'completed');
    if (!allDone) return;
    this.dailySetBonusGranted = true;
    const sum = todays.reduce((s, m) => ({
      xp: s.xp + m.rewards.xp, credits: s.credits + m.rewards.credits, stars: s.stars + m.rewards.stars,
    }), { xp: 0, credits: 0, stars: 0 });
    const bonusXp = Math.round(sum.xp * 0.10);
    const bonusCr = Math.round(sum.credits * 0.10);
    const bonusSt = Math.round(sum.stars * 0.10);
    this.credits = (this.credits || 0) + bonusCr;
    this.gainXp(bonusXp);
    if (bonusSt > 0) this.starGold = (this.starGold || 0) + bonusSt;
    this.log(`🎯 Все дейлики дня выполнены! Бонус +10%: +${bonusCr} кр · +${bonusXp} XP${bonusSt > 0 ? ` · +${bonusSt} ★` : ''}`);
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

  // Generic data-driven dispatcher: advances every active mission's objective matching `type`
  // (and optional matchFn(obj, mission, objIdx)) — replaces per-mission-id hardcoded hooks.
  advanceMissionsByEvent(type, matchFn = null, amount = 1) {
    if (!this.missionState) return;
    for (const m of MISSIONS) {
      const state = this.missionState[m.id];
      if (!state || state.status !== 'active') continue;
      m.objectives.forEach((obj, i) => {
        if (obj.type !== type) return;
        if (matchFn && !matchFn(obj, m, i)) return;
        this.advanceMission(m.id, i, amount);
      });
    }
  }

  // Escort transports are spawned generically but there's only ever one active 'escort'-type
  // objective at a time — find it by objective type rather than a hardcoded mission id.
  advanceEscortMission(objIdx, amount = 1) {
    this.advanceMissionsByEvent('escort', (obj, m, i) => i === objIdx, amount);
  }

  // Marks whichever active mission owns the escort objective as failed for the rest of the day.
  failEscortMission() {
    if (!this.missionState) return;
    for (const m of MISSIONS) {
      const state = this.missionState[m.id];
      if (!state || state.status !== 'active') continue;
      if (!m.objectives.some(o => o.type === 'escort')) continue;
      state.status = 'failed';
      state.objectives.forEach(o => { o.current = 0; });
    }
  }

  // Time-trial objectives fail (instead of silently staying incomplete) if the sector is
  // reached after the mission's time limit has elapsed since it was accepted.
  _checkTimeTrials(sectorKey) {
    if (!this.missionState) return;
    for (const m of MISSIONS) {
      const state = this.missionState[m.id];
      if (!state || state.status !== 'active') continue;
      m.objectives.forEach((obj, i) => {
        if (obj.type !== 'time_trial') return;
        if ((state.objectives[i]?.current ?? 0) >= obj.total) return;
        const t = getMissionSectorTarget(m, this.playerCorp ?? 'helios');
        if (!t || t.key !== sectorKey || t.objIdx !== i) return;
        const elapsedSec = (Date.now() - (state.acceptedAt ?? Date.now())) / 1000;
        if (elapsedSec <= obj.limitSec) {
          this.advanceMission(m.id, i, 1);
        } else {
          state.status = 'failed';
          state.objectives.forEach(o => { o.current = 0; });
          this.log(`⚠ Миссия «${m.title}» провалена — время вышло.`);
        }
      });
    }
  }

  // Resolves a 'narrative_choice' objective: records the pick and applies its bonus reward
  // (consumed synchronously by completeMission if this was the mission's last objective).
  resolveMissionChoice(id, objIdx, choiceId) {
    const m = MISSIONS.find(m => m.id === id);
    const state = this.missionState?.[id];
    if (!m || !state || state.status !== 'active') return;
    const objDef = m.objectives[objIdx];
    const objState = state.objectives[objIdx];
    if (!objDef || objDef.type !== 'narrative_choice' || !objState || objState.current >= objDef.total) return;
    const opt = objDef.options.find(o => o.id === choiceId);
    objState.current = objDef.total;
    objState.choice = choiceId;
    this._pendingChoiceBonus = opt?.rewardBonus ?? null;
    const allDone = m.objectives.every((o, i) => state.objectives[i].current >= o.total);
    if (allDone) this.completeMission(id);
  }
  // ── Escort transport ─────────────────────────────────────────────────────
  _shouldSpawnEscort() {
    const escortM = MISSIONS.find(m => m.id === 'daily_escort');
    const escortTarget = getMissionSectorTarget(escortM, this.playerCorp ?? 'helios')?.key;
    if (!escortTarget || galaxy.current !== escortTarget) return false;
    // Someone else in this shared sector already started their own (independent,
    // mutually invisible) escort — wait 30s so the two don't spawn/overlap at once.
    if (this._escortRoomLockUntil && Date.now() < this._escortRoomLockUntil) return false;
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
    this.pvpClient?.escortStart();
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
    this.sfx?.play('sfx_player_death', { volume: 0.85 });
    this._shake(320, 0.016);
    this.cameras.main.flash(220, 180, 30, 30, true);
    this.log(i18n.t('log.you_died'));
    // PvP-смерть: штраф в виде выпавшего лута (5% плазмита), которого нет при смерти от моба —
    // это единственная разница в обработке, дальше идёт тот же ремонт-диалог для обоих случаев.
    // Коробку не кладём в свой this.loot — сервер решает, кому она видна (победителю и всем,
    // кто наносил урон в эту жизнь; сама жертва её не видит и не может забрать обратно).
    if (killedByPlayer) {
      const totalP = totalPlasmateInInventory(this.inventory);
      if (totalP > 0) {
        const drop = Math.max(1, Math.floor(totalP * 0.05));
        removePlasmateFromInventory(this.inventory, drop);
        this.pvpClient?.spawnLoot(deathX, deathY, { type: 'plasmate', amount: drop });
        this.log(i18n.t('log.plasmate_dropped', { amount: drop }));
      }
    }
    this.target = null;
    this.time.delayedCall(2000, () => this._showRepairDialog(deathX, deathY));
  }
  _showRepairDialog(deathX, deathY) {
    const REPAIR_COST = {
      wisp:     { credits: 0,      stars: 0 },
      stiletto: { credits: 3500,   stars: 0 },
      anvil:    { credits: 7000,   stars: 0 },
      phantom:  { credits: 20000,  stars: 0 },
      drover:   { credits: 10000,  stars: 0 },
      aegis:    { credits: 10000,  stars: 0 },
      helion:   { credits: 0,      stars: 3 },
      argosy:   { credits: 0,      stars: 3 },
      drifter:  { credits: 0,      stars: 3 },
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

    // 7 жизней на данж/сутки (не важно, ремонт «на месте» или «к базе» — считается
    // сам факт смерти). Аргус (админский слив) — исключение, ограничений нет.
    // Раньше здесь стоял await — диалог не появлялся, пока не придёт ответ сервера
    // (+200-500мс сверху на уже намеренную 2с задержку взрыва, заметно на глаз).
    // Теперь строим диалог сразу с оптимистичным набором кнопок (верно в 6 из 7
    // случаев), а lockedOut применяем к СЛЕДУЮЩЕЙ попытке — сервер всё равно останется
    // источником правды при следующем dungeonEnter, тут только UX.
    let livesInfo = null;
    let dialogOpen = true;
    const argusActive = !!this.argusCtrl?.mob?.alive;
    if (sec?.isDungeon && !argusActive) {
      dungeonDeath(galaxy.current, this._dungeonDayKey()).then(info => {
        livesInfo = info;
        if (info.lockedOut) {
          this.log(dialogOpen
            ? '☠ Это была последняя попытка на сегодня (сервер подтвердил после открытия диалога) — данж будет доступен снова после 01:00.'
            : '☠ Жизни исчерпаны — данж будет доступен снова после 01:00.');
        } else if (info.livesRemaining === 2) {
          this.log('⚠ Осталось 2 попытки в этом данже сегодня!');
        } else if (info.livesRemaining === 1) {
          this.log('⚠ Осталась последняя попытка в этом данже сегодня!');
        }
      }).catch(() => { /* сервер недоступен — не блокируем респавн игрока */ });
    }
    // На 7-й жизни выбор ограничен: только выброс на базу (нет смысла держать
    // игрока в данже, куда он всё равно больше не сможет войти сегодня). livesInfo
    // всегда null в этой строке — .then() выше — микротаск, гарантированно выполнится
    // позже синхронного кода — поэтому forcedEject всегда false при первой отрисовке;
    // это и есть суть фикса (диалог не ждёт сервер), реальный lockedOut учтётся сервером
    // при следующем dungeonEnter, если игрок попробует зайти в данж повторно сегодня.
    const forcedEject = !!livesInfo?.lockedOut;

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
    if (livesInfo) {
      const livesColor = livesInfo.livesRemaining <= 1 ? '#ef5350' : livesInfo.livesRemaining <= 2 ? '#ffb74d' : '#88bbaa';
      allObjs.push(this.add.text(W / 2, H / 2 - 90,
        forcedEject ? 'ЖИЗНИ ИСЧЕРПАНЫ — ВЫБРОС НА БАЗУ' : `Жизни в этом данже: ${livesInfo.livesRemaining}/7`,
        { fontFamily: 'Inter,sans-serif', fontSize: '12px', color: livesColor, resolution: UI_RES })
        .setOrigin(0.5).setDepth(302).setScrollFactor(0));
    }
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
      dialogOpen = false;
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

    if (forcedEject) {
      // 7-я жизнь потрачена: сегодня в этот данж больше не попасть — оставаться
      // здесь незачем, единственный вариант — выброс на родную базу
      makeCard(W / 2, 'К БАЗЕ', '100% HP · родная база', costStr(baseCr, baseSt), canBase,
        () => finishRespawn(baseX, baseY, true, baseCr, baseSt, parentSecKey));
    } else {
      makeCard(W / 2 - 130, 'К БАЗЕ',
        isDungOrBoss ? '100% HP · родная база' : '100% прочности',
        costStr(baseCr, baseSt), canBase,
        () => finishRespawn(baseX, baseY, true, baseCr, baseSt, parentSecKey));
      makeCard(W / 2 + 130, 'НА МЕСТЕ', '50% прочности', costStr(spotCr, spotSt), canSpot,
        () => finishRespawn(deathX, deathY, false, spotCr, spotSt));
    }
  }
  // maxHp — необязательно: max HP цели, чтобы масштабировать подачу по % урона
  // (тычок роя и решающий удар босса раньше выглядели одинаково). isCrit — крит
  // получает свой цвет прямо в числе, а не только отдельную подпись "КРИТ!" рядом.
  showDamage(x, y, res, maxHp, isCrit = false) {
    const total = Math.round((res.shieldHit || 0) + (res.hullHit || 0)); if (total <= 0) return;
    const toHull = (res.hullHit || 0) > 0;
    const pct  = maxHp ? Math.min(1, total / maxHp) : 0;
    const size = Math.round((toHull ? 20 : 16) + pct * 16);
    const color = isCrit ? '#ffe14d' : toHull ? '#ef5350' : '#4dd0e1';
    const txt = this.add.text(x + Phaser.Math.Between(-12, 12), y - 20, `-${total}`,
      { fontFamily: 'Orbitron', fontSize: `${size}px`, color, fontStyle: 'bold', resolution: UI_RES })
      .setOrigin(0.5).setDepth(70).setScale(0.55 + pct * 0.35);
    this.tweens.add({ targets: txt, scale: 1, duration: 140, ease: 'Back.easeOut' });
    const riseDist = 60 + pct * 40, dur = 1500 + pct * 400;
    this.tweens.add({ targets: txt, y: y - riseDist, duration: dur, ease: 'Quad.easeOut', onComplete: () => txt.destroy() });
    this.tweens.add({ targets: txt, alpha: 0, delay: dur * 0.47, duration: dur * 0.53 });
  }
  pingAt(x, y) {
    const ring = this.add.circle(x, y, 6, COLORS.primary, 0).setStrokeStyle(2, COLORS.primary, 0.9).setDepth(35);
    this.tweens.add({ targets: ring, radius: 26, alpha: 0, duration: 380, ease: 'Quad.easeOut', onUpdate: () => ring.setStrokeStyle(2, COLORS.primary, ring.alpha), onComplete: () => ring.destroy() });
  }
  showDodge(x, y) {
    const txt = this.add.text(x, y - 24, i18n.t('hud.dodge'), { fontFamily: 'Orbitron', fontSize: '15px', color: '#4dd0e1', fontStyle: 'bold', resolution: UI_RES, }).setOrigin(0.5).setDepth(70);
    this.tweens.add({ targets: txt, y: y - 56, alpha: 0, duration: 650, ease: 'Quad.easeOut', onComplete: () => txt.destroy() });
    this.sfx?.play('sfx_dodge', { volume: 0.5, cooldownMs: 100 });
  }
  explosion(x, y, scale = 1) {
    const size = Math.round(scale * 300); const cls = EXP_CLASSES.find((c) => c[1] >= size) || EXP_CLASSES[EXP_CLASSES.length - 1];
    const spr = this.add.sprite(x, y, `exp_${cls[0]}`).setDepth(66); spr.setDisplaySize(size, size); spr.play(`boom_${cls[0]}`); spr.once('animationcomplete', () => spr.destroy());
  }
  spawnBossAoe(mob, x, y) {
    const telegraph = mob.phase >= 2 ? BOSS.aoeTelegraphP2 : BOSS.aoeTelegraphP1;
    const now = this.time.now;
    const COUNT = 5;
    const missiles = Array.from({ length: COUNT }, (_, i) => {
      const ang = (Math.PI * 2 * i / COUNT) + (i * 0.37);
      const dist = 700 + i * 60;
      return { sx: x + Math.cos(ang) * dist, sy: y + Math.sin(ang) * dist };
    });
    this.aoeZones.push({ x, y, radius: BOSS.aoeRadius, bornAt: now, detonateAt: now + telegraph, done: false, missiles });
    this.log(i18n.t('log.boss_aoe'));
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
      // Danger circle telegraph
      this.aoeGfx.fillStyle(COLORS.danger, 0.08); this.aoeGfx.fillCircle(z.x, z.y, z.radius); this.aoeGfx.lineStyle(3, COLORS.danger, 0.9); this.aoeGfx.strokeCircle(z.x, z.y, z.radius);
      this.aoeGfx.fillStyle(COLORS.amber, 0.30); this.aoeGfx.fillCircle(z.x, z.y, z.radius * frac); this.aoeGfx.fillStyle(COLORS.danger, 0.22); this.aoeGfx.fillCircle(z.x, z.y, z.radius * 0.35);
      // Incoming missiles converging on target
      if (z.missiles) {
        for (const m of z.missiles) {
          const mx = Phaser.Math.Linear(m.sx, z.x, frac);
          const my = Phaser.Math.Linear(m.sy, z.y, frac);
          const tf = Math.max(0, frac - 0.18);
          const tx = Phaser.Math.Linear(m.sx, z.x, tf);
          const ty = Phaser.Math.Linear(m.sy, z.y, tf);
          this.aoeGfx.lineStyle(2, 0xff6600, 0.85);
          this.aoeGfx.beginPath(); this.aoeGfx.moveTo(tx, ty); this.aoeGfx.lineTo(mx, my); this.aoeGfx.strokePath();
          this.aoeGfx.fillStyle(0xffcc00, 1); this.aoeGfx.fillCircle(mx, my, 4);
        }
      }
      if (now >= z.detonateAt) { z.done = true; this.detonateAoe(z); }
    }
    // Swap-pop, не .filter() — тот же принцип, что и для projectiles выше.
    for (let i = this.aoeZones.length - 1; i >= 0; i--) {
      if (this.aoeZones[i].done) {
        this.aoeZones[i] = this.aoeZones[this.aoeZones.length - 1];
        this.aoeZones.pop();
      }
    }
  }
  detonateAoe(z) {
    this.explosion(z.x, z.y, 1.6);
    // Cluster impacts at each missile hit point
    if (z.missiles) {
      z.missiles.forEach((m, i) => {
        const ex = z.x + (m.sx - z.x) * 0.15;
        const ey = z.y + (m.sy - z.y) * 0.15;
        this.time.delayedCall(40 + i * 55, () => this.explosion(ex, ey, 0.5));
      });
    }
    const p = this.player; if (!p.alive) return;
    const d = Phaser.Math.Distance.Between(p.x, p.y, z.x, z.y);
    if (d <= z.radius) {
      const falloff = 1 - (d / z.radius) * (1 - BOSS.aoeEdgeFactor);
      const res = p.takeDamage(BOSS.aoeDamage * falloff, BOSS.aoePenetration, { ignoreMovEvasion: true, aoe: true });
      this.showDamage(p.x, p.y, res, p.maxHull);
      this._shakeForHit(res, p.maxHull);
      if (!p.alive) this.onPlayerKilled();
    }
  }
  // Общий гейт настройки "Тряска камеры" (SettingsScene → Графика) — раньше тумблер
  // ничего не проверял, camera.shake() вызывался безусловно из ~12 разных мест.
  _shake(duration, intensity) {
    if (this.cameraShakeEnabled === false) return;
    this.cameras.main.shake(duration, intensity);
  }
  // Тряска камеры от удара по игроку — растёт с % урона от maxHull, с нижним
  // порогом, чтобы щитовые тычки роя не превращали экран в непрерывную вибрацию.
  // Раньше камера реагировала только на фазы Апофиса — обычный бой был «немым».
  _shakeForHit(res, maxHp) {
    const pct = (res?.hullHit || 0) / (maxHp || 1);
    if (pct < 0.02) return;
    const k = Math.min(1, pct);
    this._shake(90 + k * 170, 0.004 + k * 0.011);
  }
  // Пульсирующая красная виньетка по краям экрана при HP игрока < 25% — раньше
  // единственным сигналом низкого HP была статичная смена цвета полоски в HUD.
  _updateLowHpVignette(dt) {
    const p = this.player;
    const low = !!(p?.alive && p.maxHull > 0 && p.hull / p.maxHull < 0.25);
    if (!low) {
      if (this._lowHpVignette) this._lowHpVignette.setVisible(false);
      this._lowHpPulseT = 0;
      this.sfx?.stopLoop('sfx_low_hp_warning');
      return;
    }
    this.sfx?.startLoop('sfx_low_hp_warning', { volume: 0.35 });
    if (!this._lowHpVignette) {
      this._lowHpVignette = this.add.graphics().setScrollFactor(0).setDepth(290);
    }
    this._lowHpVignette.setVisible(true);
    // Пульс ускоряется по мере приближения к 0 HP: от ~1.1с на пике порога до ~0.5с у смерти
    const hpFrac = Phaser.Math.Clamp(p.hull / p.maxHull, 0, 0.25) / 0.25; // 1→0
    const period = 0.5 + hpFrac * 0.6;
    this._lowHpPulseT = ((this._lowHpPulseT ?? 0) + dt / period) % 1;
    const pulse = 0.5 - 0.5 * Math.cos(this._lowHpPulseT * Math.PI * 2); // 0..1..0
    const W = this.scale.width, H = this.scale.height;
    const bw = Math.round(Math.min(W, H) * 0.16);
    const a = 0.10 + 0.22 * pulse;
    const g = this._lowHpVignette, red = 0xef5350;
    g.clear();
    g.fillGradientStyle(red, red, red, red, a, a, 0, 0); g.fillRect(0, 0, W, bw);           // верх
    g.fillGradientStyle(red, red, red, red, 0, 0, a, a); g.fillRect(0, H - bw, W, bw);       // низ
    g.fillGradientStyle(red, red, red, red, a, 0, a, 0); g.fillRect(0, 0, bw, H);            // лево
    g.fillGradientStyle(red, red, red, red, 0, a, 0, a); g.fillRect(W - bw, 0, bw, H);       // право
  }
  // Dev-дальномер [хоткей 7, вместе с тренажёрами]: кольцо фактической дальности
  // оружия вокруг игрока + линейка живой дистанции до ближайшего тренажёра —
  // для проверки баланса без гадания "долетит/не долетит".
  _updateRangeRing() {
    const active = this._trainingDummies?.length > 0;
    if (!active) {
      this._rangeRingGfx?.setVisible(false);
      this._rangeRingText?.setVisible(false);
      this._rangeRulerText?.setVisible(false);
      return;
    }
    if (!this._rangeRingGfx) {
      this._rangeRingGfx = this.add.graphics().setDepth(30);
      this._rangeRingText = this.add.text(0, 0, '',
        { fontFamily: 'Orbitron', fontSize: '11px', color: '#4dd0e1', resolution: UI_RES })
        .setOrigin(0.5, 1).setDepth(31);
      this._rangeRulerText = this.add.text(0, 0, '',
        { fontFamily: 'Orbitron', fontSize: '12px', color: '#ffee44', resolution: UI_RES, backgroundColor: '#000000aa' })
        .setOrigin(0.5).setDepth(31).setPadding(4, 2, 4, 2);
    }
    const p = this.player;
    if (!p?.alive) return;
    const range = p.weaponRange ?? 600;
    const g = this._rangeRingGfx;
    g.setVisible(true).clear();
    g.lineStyle(2, 0x4dd0e1, 0.55);
    g.strokeCircle(p.x, p.y, range);
    this._rangeRingText.setVisible(true).setPosition(p.x, p.y - range - 10).setText(`ДАЛЬНОСТЬ ОРУЖИЯ: ${Math.round(range)}px`);

    let nearest = null, nd = Infinity;
    for (const d of this._trainingDummies) {
      if (!d.alive) continue;
      const dist = Phaser.Math.Distance.Between(p.x, p.y, d.x, d.y);
      if (dist < nd) { nd = dist; nearest = d; }
    }
    if (nearest) {
      g.lineStyle(1.5, 0xffee44, 0.8);
      g.lineBetween(p.x, p.y, nearest.x, nearest.y);
      this._rangeRulerText.setVisible(true)
        .setPosition((p.x + nearest.x) / 2, (p.y + nearest.y) / 2 - 12)
        .setText(`${Math.round(nd)}px${nd <= range ? ' · в дальности' : ' · вне дальности'}`);
    } else {
      this._rangeRulerText.setVisible(false);
    }
  }
  _onScreen(x, y) { return this.cameras.main.worldView.contains(x, y); }
  log(msg) { this.game.events.emit('hud-log', msg); }
  update(time, delta) {
    const dt = delta / 1000;

    // Phaser's Camera.startFollow() lerp (0.35 set in create()) is applied as a FIXED
    // FRACTION PER CALL, not scaled by dt — it implicitly assumes a constant ~60fps
    // call rate. Any frame-timing jitter (GC pause, a heavier frame, browser hiccup —
    // not even a full dropped frame, just inconsistent dt) changes how much ground the
    // camera actually covers that frame in TIME terms, so the ship visibly jerks within
    // the viewport even though its own world position moved smoothly. Worse at boost
    // because the camera has more distance to close per frame, so the same timing
    // jitter produces a proportionally bigger pixel error. Recomputing the lerp each
    // frame to match what "0.35 at a nominal 60fps" would give at THIS frame's actual
    // dt makes the follow speed frame-rate independent instead of frame-COUNT dependent.
    const camLerp = 1 - Math.pow(1 - 0.35, dt * 60);
    this.cameras.main.setLerp(camLerp, camLerp);

    // Настройка "Параллакс фон" (SettingsScene → Графика) — раньше тумблер ничего не
    // проверял, слой всегда скроллился безусловно.
    if (this.bgParallaxEnabled !== false) {
      this.bgNear.tilePositionX = this.cameras.main.scrollX * 0.05;
      this.bgNear.tilePositionY = this.cameras.main.scrollY * 0.05;
    }

    // Engine particles: one emitter per nozzle, positioned in ship-local space.
    // Coordinate formula (sprite drawn nose-down, artAngleOffset -π/2):
    //   wx = px + nx·sin(f) − ny·cos(f),  wy = py − nx·cos(f) − ny·sin(f)
    if (!this.player.alive || this.engineTrailsEnabled === false) {
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
      } else if (this.isFiring && time > (this._outOfRangeMsgCd || 0)) {
        this._outOfRangeMsgCd = time + 2000;
        this.log('📡 Вне дальности огня');
      }
    }
    
    this.player.update(dt, inSafe, faceAngle);
    if (!this.player.alive && !this.playerRespawning) this.onPlayerKilled();
    if (this.steering && this.player.alive && !this.jumping) {
      const wpt = this.cameras.main.getWorldPoint(this.input.activePointer.x, this.input.activePointer.y);
      this.movement.steerMode = true;
      this.movement.setWaypoint(wpt.x, wpt.y, false);
    }
    if (!this.jumping && this.player.alive) this.movement.update(dt, inSafe);
    // Импульсная мина Синдиката: полная остановка двигателей (сильнее обычного EMP-замедления)
    if (this.player.alive && (this._playerStunUntil || 0) > this.time.now) {
      this.player.sprite.body.setVelocity(0, 0);
    } else if (this.player.alive && (this._empSlowUntil || 0) > this.time.now) {
      // EMP slow: применяем после movement, до обновления мобов
      const b = this.player.sprite.body;
      b.setVelocity(b.velocity.x * 0.45, b.velocity.y * 0.45);
    }
    if (this.player.alive && galaxy.current === 'dungeon_1') this._updateSwarmPack();
    this.mobs.forEach((m) => {
      const tgt = (m.escortTarget?.alive) ? m.escortTarget : this.player;
      const victim = (m.escortTarget?.alive) ? this.escortTransport : this.player;
      const _fireCb = this.mobAimDisrupted ? () => {} : (mob, tx, ty) => this.fireMobWeapon(mob, tx, ty, victim);
      m.update(dt, tgt, tgt === this.player && inSafe, _fireCb);
      if (m.requestAoe) { this.spawnBossAoe(m, this.player.x, this.player.y); m.requestAoe = false; }
    });
    this._processPendingAmbientSpawns();
    this._redrawMobBars();
    this.updateAoe();
    // PvP: интерполяция чужих кораблей + throttled отправка своей позиции.
    // Сами по себе никогда не наносят урона — бой идёт через pvpClient.fireClaim (шаг 4).
    if (this.pvpClient?.sector) {
      this.pvpClient.update(dt);
      if (this.player.alive) this.pvpClient.sendPos(this.player.x, this.player.y, this.player.facing, dt * 1000);
    }
    if (this.player.alive && galaxy.current === 'dungeon_3') this._updateSyndicateEMP(dt);

    this.miningBases.forEach(b => b.update(dt));
    this._redrawMiningBaseBars();
    this.nearBase = false; // reset before home bases accumulate — any base can set it to true
    this.homeBases.forEach(b => b.update(dt));
    // Убираем протухшие снаряды IN-PLACE (swap-pop) — .filter() пересобирал новый
    // массив КАЖДЫЙ кадр безусловно, даже когда никто не умер; при активной стрельбе
    // (мобы бьют хитскан-лазерами/плазмой почти постоянно) это была ещё одна
    // безусловная аллокация 60 раз/сек (см. profилировку — та же "пила" JS heap).
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.projectiles[i].dead) {
        this.projectiles[i] = this.projectiles[this.projectiles.length - 1];
        this.projectiles.pop();
      }
    }
    this.projectiles.forEach((p) => p.update(dt));
    if (this._wallLines?.length) this._checkProjWallCollision();
    this.updateLoot(dt); this.updateGates(dt);
    this._updateAnomaly(dt);
    this._updateWorldEvent(dt);
    this._updateAttachedFx();
    this._updateTrackedBeams();
    this._updateLowHpVignette(dt);
    this._updateRangeRing();
    this._updateMagnet(dt);
    this._updateAutoCollect(dt);
    const now2 = this.time.now;
    this.plasmateDeposits.forEach(d => d.update(now2));
    if (this.pendingGate && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.pendingGate.x, this.pendingGate.y) < 60) { this.pendingGate = null; }
    this.argusCtrl?.update(dt);
    this.confedGuards?.update(dt, this.player);
    if (this._apophisRings) this._updateApophisRings(dt);
    this._updateRingDamage(dt);
    this._updateGravTraps(dt);
    this._updateMines(dt);
    if (this._apophisBoss) this._updateHealerEffects(dt);
    if (this._bossArenaOpenedAt !== undefined) this._updateBossArena(dt);
    if (this._corridorChests?.length) this._updateCorridorChests();
    if (this._corridorButtons?.length) this._updateCorridorButtons();
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
        if (d < PACK_R && !this._hasWallBetween(aggr.x, aggr.y, nb.x, nb.y)) { nb.state = 'aggro'; nb.neutral = false; }
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
      if (d > EMP_RANGE || this._hasWallBetween(mob.x, mob.y, this.player.x, this.player.y)) { mob._empCd = 5; continue; }
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

    // Anomaly signals require the player to hold still (speed<5, same "stopped" threshold
    // used elsewhere for the HUD) inside a wider radius, for a much longer channel —
    // a scan, not a quick pickup. Any other loot uses the normal radius/duration.
    const isAnomalyTarget = target.isAnomaly === true;
    const radius   = isAnomalyTarget ? ANOMALY_SCAN_RADIUS : PICKUP_RADIUS * (this.player.lootPickupRadiusMult || 1);
    const duration = isAnomalyTarget ? ANOMALY_SCAN_TIME_MS : PICKUP_TIME;
    const stillOk  = !isAnomalyTarget || (this.player.speed ?? 0) <= 5;

    // Начинаем сбор только если мы в радиусе (и, для аномалий, неподвижны). Если далеко — просто ждем прибытия.
    if (dist <= radius + 10 && stillOk) {
      this.collectTimer += dt * 1000;
      const frac = Math.min(1, this.collectTimer / duration);

      this.collectGfx.lineStyle(3, COLORS.primary, 0.8);
      this.collectGfx.strokeCircle(target.x, target.y, 45 * (1 - frac));

      if (frac >= 1) {
        if (isAnomalyTarget) {
          this._decodeAnomaly();
          this.cancelCollect();
        } else if (target.pvpLootId) {
          this._claimPvpLoot(target);
          this.cancelCollect();
        } else if (target.isPlasmate || target.isDungeonResource) {
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
                else { this.log(i18n.t('log.loot_pickup', { item: itemName(item) })); target.collect(); this.cancelCollect(); this.advanceMissionsByEvent('collect_loot', () => true); this._saveState(); }
                return;
              }
              addConsumableToInventory(inv, item.type, remaining, this._cargoMax());
            }
            this.log(i18n.t('log.loot_pickup', { item: itemName(item) }));
            target.collect();
            this.cancelCollect();
            this.advanceMissionsByEvent('collect_loot', () => true);
            this._saveState();
          } else if (this.inventory.length >= this._cargoMax()) {
            this.log(i18n.t('log.cargo_full'));
            this.cancelCollect();
          } else {
            this.inventory.push(item);
            this.log(i18n.t('log.loot_pickup', { item: itemName(item) }));
            target.collect();
            this.cancelCollect();
            this.advanceMissionsByEvent('collect_loot', () => true);
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
        // Не начинаем тянуть непополняемый предмет (модуль/плата/коннектор),
        // если трюм уже полон — расходники/пласмит всё равно могут доложиться
        // в существующие стопки, поэтому им разрешаем попытку в любом случае
        if (!CONSUMABLES[loot.item?.type] && this.inventory.length >= this._cargoMax()) continue;
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
        if (loot.pvpLootId) {
          loot._magnetPull = false;
          this._claimPvpLoot(loot);
          continue;
        }
        const mi = loot.item;
        if (CONSUMABLES[mi.type]) {
          const ammoAdded = this._tryAddToAmmoSlots(mi.type, mi.amount);
          const remaining = mi.amount - ammoAdded;
          if (remaining > 0) addConsumableToInventory(this.inventory, mi.type, remaining, this._cargoMax());
        } else if (this.inventory.length < this._cargoMax()) {
          this.inventory.push(mi);
        } else {
          // Трюм заполнился уже во время притяжения (другой предмет забрал
          // последний слот в этом же кадре) — отпускаем магнит, лут остаётся на месте
          loot._magnetPull = false;
          loot.sprite.setDisplaySize(loot._origDisplayW ?? loot.sprite.displayWidth, loot._origDisplayH ?? loot.sprite.displayHeight);
          continue;
        }
        this.log(i18n.t('log.loot_pickup', { item: itemName(mi) }));
        loot.collect();
        this.advanceMissionsByEvent('collect_loot', () => true);
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

    // ── Plasmate auto-collect (premium, when autoCollect setting is OFF) ──
    // When autoCollect is ON, _updateAutoCollect handles all deposits instead.
    if (this.premium && !this.autoCollectEnabled) {
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

  // Авто-сбор всех ресурсов (★ Премиум + настройка autoCollect).
  // Работает в любом секторе, для плазмида и данж-ресурсов.
  // Независим от autoLoot — магнит лута может быть выключен.
  _updateAutoCollect(dt) {
    if (!this.premium || !this.autoCollectEnabled) return;
    if (!this.player?.alive || this.atBase || this.jumping) return;

    const MAGNET_BASE = 180;
    const radius = MAGNET_BASE * (this.player.lootPickupRadiusMult ?? 1.0);
    const px = this.player.x, py = this.player.y;

    for (const dep of this.plasmateDeposits) {
      if (!dep.alive) continue;
      if (dep === this.collectTarget) continue;
      if (dep._magnetCooldownUntil && this.time.now < dep._magnetCooldownUntil) continue;
      // Не тянем плазмид если лимит или трюм полон
      if (dep.isPlasmate) {
        if ((this.plasmateToday || 0) >= PLASMATE_DAILY_MAX) continue;
        if (this.inventory.length >= this._cargoMax()
          && !this.inventory.some(i => i.type === 'plasmate' && i.amount < PLASMATE_PER_SLOT)) continue;
      }

      const dx = px - dep.sprite.x, dy = py - dep.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!dep._magnetPull) {
        if (dist >= radius) continue;
        dep._magnetPull = true;
        dep._origDisplayW = dep.sprite.displayWidth;
        dep._origDisplayH = dep.sprite.displayHeight;
      } else if (dist > radius * 2) {
        dep._magnetPull = false;
        dep.sprite.setDisplaySize(dep._origDisplayW ?? 40, dep._origDisplayH ?? 40);
        continue;
      }

      if (dist < 8) {
        dep._magnetPull = false;
        dep.sprite.setDisplaySize(dep._origDisplayW ?? 40, dep._origDisplayH ?? 40);
        this._collectPlasmateDeposit(dep); // внутри диспетчеризует на данж-ресурс если нужно
        if (dep.alive) dep._magnetCooldownUntil = this.time.now + 5000;
        continue;
      }

      const t = Math.max(0, 1 - dist / radius);
      const speed = (150 + 450 * t) * dt;
      dep.sprite.x += (dx / dist) * speed;
      dep.sprite.y += (dy / dist) * speed;

      const SHRINK_DIST = 50;
      if (dist < SHRINK_DIST) {
        const scale = dist / SHRINK_DIST;
        dep.sprite.setDisplaySize(dep._origDisplayW * scale, dep._origDisplayH * scale);
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
    // Сброс до раннего return: иначе _wallLines/walls из прошлого данжа переживают
    // scene.restart и продолжают резать снаряды/LOS в обычном космосе
    this._wallLines  = [];
    this._wallSolids = [];
    this.walls = null;
    // R-1-boss-поля тоже переживают restart с уничтоженными display-объектами:
    // стейл _corridorButtons крашили setText в других данжах, стейл gravTraps/mines
    // невидимо тянули/взрывали игрока. Ветка R-1-boss переинициализирует их сама.
    this._corridorButtons  = [];
    this._corridorCapWalls = [];
    this._corridorCapGfx   = [];
    this._corridorChests   = [];
    this.gravTraps         = [];
    this.mines             = [];
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

    // ── Линейные стены (стиль босс-карты): физика 60px сегментами, видимая полоса
    //    150px, записи в _wallLines (LOS/снаряды) и _wallSolids (валидация спавна) ──
    const LINE_T = 60, LINE_VIS = 150;
    // Клип отрезка кругами клиренса (650px: центр мира + гейты). Физика, LOS и визуал
    // режутся синхронно — иначе получится «пролететь можно, а прострелить нельзя».
    const clipLine = (x1, y1, x2, y2) => {
      let parts = [[x1, y1, x2, y2]];
      const circles = [[cx, cy], ...(this.gates ?? []).map(gt => [gt.x, gt.y])];
      for (const [ccx, ccy] of circles) {
        const R = 650;
        const next = [];
        for (const [ax, ay, bx, by] of parts) {
          const dx = bx - ax, dy = by - ay;
          const a = dx * dx + dy * dy;
          if (a < 1) continue;
          const b = 2 * ((ax - ccx) * dx + (ay - ccy) * dy);
          const c = (ax - ccx) ** 2 + (ay - ccy) ** 2 - R * R;
          const disc = b * b - 4 * a * c;
          if (disc <= 0) { next.push([ax, ay, bx, by]); continue; }
          const sq = Math.sqrt(disc);
          const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
          if (t2 <= 0 || t1 >= 1) { next.push([ax, ay, bx, by]); continue; }
          if (t1 > 0.02) next.push([ax, ay, ax + dx * t1, ay + dy * t1]);
          if (t2 < 0.98) next.push([ax + dx * t2, ay + dy * t2, bx, by]);
        }
        parts = next;
      }
      return parts;
    };
    const addLineWall = (x1, y1, x2, y2) => {
      for (const [ax, ay, bx, by] of clipLine(x1, y1, x2, y2)) {
        const dx = bx - ax, dy = by - ay;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) continue;
        const nx = dx / dist, ny = dy / dist;
        // Диагонали — сегменты короче, чтобы AABB-тела не выпирали за видимую полосу
        const segLen = (Math.abs(nx) < 0.05 || Math.abs(ny) < 0.05) ? 180 : 90;
        const N = Math.max(1, Math.ceil(dist / segLen));
        const step = dist / N;
        const wW = Math.abs(nx) * (step + 20) + Math.abs(ny) * (LINE_T + 20);
        const wH = Math.abs(ny) * (step + 20) + Math.abs(nx) * (LINE_T + 20);
        for (let k = 0; k < N; k++) {
          const t = (k + 0.5) / N;
          const wall = this.add.rectangle(ax + t * dx, ay + t * dy, wW, wH, 0, 0);
          this.physics.add.existing(wall, true);
          this.walls.add(wall);
        }
        g.lineStyle(LINE_VIS, ws.fill, 0.85);
        g.lineBetween(ax, ay, bx, by);
        g.lineStyle(4, ws.edge, 1.0);
        g.lineBetween(ax, ay, bx, by);
        this._wallLines.push({ x1: ax, y1: ay, x2: bx, y2: by });
        this._wallSolids.push({ x1: ax, y1: ay, x2: bx, y2: by, halfT: LINE_T / 2 });
      }
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
      const dx1 = x0 + w, dy1 = y0 + h;
      this._wallLines.push(
        { x1: x0,  y1: y0,  x2: dx1, y2: y0,  bossDoor: true },
        { x1: dx1, y1: y0,  x2: dx1, y2: dy1, bossDoor: true },
        { x1: dx1, y1: dy1, x2: x0,  y2: dy1, bossDoor: true },
        { x1: x0,  y1: dy1, x2: x0,  y2: y0,  bossDoor: true },
      );
      this._wallSolids.push({ type: 'rect', x0, y0, x1: dx1, y1: dy1, bossDoor: true });
    };

    // ── Раскладка стен: данные (D1–D5, prem) или литеральная ветка (R-1-boss) ──
    const layout = DUNGEON_LAYOUTS[galaxy.current];
    if (layout) {
      for (const [x1, y1, x2, y2] of layout.walls) addLineWall(cx + x1, cy + y1, cx + x2, cy + y2);
      const [bx, by, bw, bh] = layout.bossDoor;
      addBossDoor(cx + bx, cy + by, bw, bh);

    } else if (galaxy.current === 'R-1-boss') {
      // Вертикальная 5-конечная звезда: толстые стены коридоров (150px) + кольцо арены
      const arenaR = 1600, corrLen = 3200, wallT = 60, ringT = 90;
      const WALL_VIS = 150;  // ширина видимой полосы стены коридора
      const CORR_HW = [310, 440, 440, 440, 440];
      const ANGLES  = [
        -Math.PI / 2,
        -Math.PI / 2 + 2 * Math.PI / 5,
        -Math.PI / 2 + 4 * Math.PI / 5,
        -Math.PI / 2 + 6 * Math.PI / 5,
        -Math.PI / 2 + 8 * Math.PI / 5,
      ];

      this.arenaWalls       = [];
      this.arenaWallsVis    = [];
      this.gravTraps        = [];
      this.mines            = [];
      this._wallLines       = [];  // [{x1,y1,x2,y2}|{type:'arc',...}] для снарядов
      this._corridorCapWalls   = [[], [], [], [], []];  // тела торцев per-corridor
      this._corridorCapGfx     = [null, null, null, null, null]; // визуал торца
      this._corridorButtons    = [];                             // кнопки у торцев

      // ── Сегментированные физические тела вдоль линии ─────────────────────────
      const SEG_LEN = 180;
      const addWallLine = (x1, y1, x2, y2, capIdx = -1) => {
        const dx = x2 - x1, dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return;
        const N = Math.max(1, Math.ceil(dist / SEG_LEN));
        const step = dist / N;
        const nx = dx / dist, ny = dy / dist;
        const wW = Math.abs(nx) * (step + 20) + Math.abs(ny) * (wallT + 20);
        const wH = Math.abs(ny) * (step + 20) + Math.abs(nx) * (wallT + 20);
        for (let k = 0; k < N; k++) {
          const t = (k + 0.5) / N;
          const wx = x1 + t * dx, wy = y1 + t * dy;
          const wall = this.add.rectangle(wx, wy, wW, wH, 0, 0);
          this.physics.add.existing(wall, true);
          this.walls.add(wall);
          if (capIdx >= 0) this._corridorCapWalls[capIdx].push(wall);
        }
      };

      // ── Дуга кольца (физика + визуал) ─────────────────────────────────────────
      const addRingArc = (a1, a2, removable = false) => {
        if (a2 < a1) a2 += Math.PI * 2;
        if (arenaR * (a2 - a1) < 1) return;
        // Визуал: толстая тёмная полоса + яркий контур
        const arcGfx = removable ? this.add.graphics().setDepth(2) : g;
        const VSTEPS = Math.max(2, Math.ceil((a2 - a1) / (Math.PI / 36)));
        const drawArc = (r, lw, color, alpha) => {
          arcGfx.lineStyle(lw, color, alpha);
          arcGfx.beginPath();
          for (let i = 0; i <= VSTEPS; i++) {
            const a = a1 + (a2 - a1) * i / VSTEPS;
            if (i === 0) arcGfx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
            else          arcGfx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
          }
          arcGfx.strokePath();
        };
        drawArc(arenaR + ringT / 2, ringT, ws.fill, 0.85);  // тёмная полоса кольца
        drawArc(arenaR, 4, ws.edge, 1.0);                    // яркий внутренний контур
        if (removable) this.arenaWallsVis.push(arcGfx);
        // Физические тела дуги (~10° на сегмент)
        const N = Math.max(1, Math.ceil((a2 - a1) / (Math.PI / 18)));
        for (let k = 0; k < N; k++) {
          const am = a1 + (a2 - a1) * (k + 0.5) / N;
          const aS = a1 + (a2 - a1) * k / N;
          const aE = a1 + (a2 - a1) * (k + 1) / N;
          const chord = 2 * arenaR * Math.sin((aE - aS) / 2);
          const tx = -Math.sin(am), ty = Math.cos(am);
          const wW = Math.abs(tx) * (chord + 20) + Math.abs(ty) * (ringT + 20);
          const wH = Math.abs(ty) * (chord + 20) + Math.abs(tx) * (ringT + 20);
          const wall = this.add.rectangle(cx + arenaR * Math.cos(am), cy + arenaR * Math.sin(am), wW, wH, 0, 0);
          this.physics.add.existing(wall, true);
          this.walls.add(wall);
          if (removable) this.arenaWalls.push(wall);
        }
        this._wallLines.push({ type: 'arc', cx, cy, r: arenaR, a1, a2, removable });
      };

      // ── Кольцо арены: постоянные дуги + съёмные заглушки ─────────────────────
      for (let i = 0; i < 5; i++) {
        const hw = CORR_HW[i];
        const gapHA = Math.asin(Math.min(hw / arenaR, 0.999)) + 0.06;
        const nextI = (i + 1) % 5;
        const gapHANext = Math.asin(Math.min(CORR_HW[nextI] / arenaR, 0.999)) + 0.06;
        let arcA1 = ANGLES[i] + gapHA;
        let arcA2 = ANGLES[nextI] - gapHANext;
        if (arcA2 < arcA1) arcA2 += Math.PI * 2;
        if (arcA2 - arcA1 > 0.05) addRingArc(arcA1, arcA2, false);
        addRingArc(ANGLES[i] - gapHA, ANGLES[i] + gapHA, true);
      }

      // ── Стены коридоров: толстая полоса (150px) + яркий контур (5px) ──────────
      for (let i = 0; i < 5; i++) {
        const a    = ANGLES[i];
        const cosA = Math.cos(a), sinA = Math.sin(a);
        const pX   = -sinA, pY = cosA;
        const hw   = CORR_HW[i];
        const sin2A   = Math.abs(Math.sin(2 * a));
        const wallOff = hw + wallT / 2 + (SEG_LEN / 2) * sin2A;

        for (const side of [-1, 1]) {
          const vx0 = cx + arenaR * cosA + side * hw * pX;
          const vy0 = cy + arenaR * sinA + side * hw * pY;
          const vx1 = cx + (arenaR + corrLen) * cosA + side * hw * pX;
          const vy1 = cy + (arenaR + corrLen) * sinA + side * hw * pY;
          // Тёмная широкая полоса (центр на hw + WALL_VIS/2)
          const bandOff = hw + WALL_VIS / 2;
          g.lineStyle(WALL_VIS, ws.fill, 0.85);
          g.lineBetween(
            cx + arenaR * cosA + side * bandOff * pX, cy + arenaR * sinA + side * bandOff * pY,
            cx + (arenaR + corrLen) * cosA + side * bandOff * pX, cy + (arenaR + corrLen) * sinA + side * bandOff * pY
          );
          // Яркий внутренний контур (на hw)
          g.lineStyle(5, ws.edge, 1.0);
          g.lineBetween(vx0, vy0, vx1, vy1);
          this._wallLines.push({ x1: vx0, y1: vy0, x2: vx1, y2: vy1 });
          // Физика (сдвинута наружу)
          addWallLine(
            cx + arenaR * cosA + side * wallOff * pX, cy + arenaR * sinA + side * wallOff * pY,
            cx + (arenaR + corrLen) * cosA + side * wallOff * pX, cy + (arenaR + corrLen) * sinA + side * wallOff * pY
          );
        }

        // ── Торцевая стена (закрыта кнопкой) ─────────────────────────────────
        const capX0 = cx + (arenaR + corrLen) * cosA + hw * pX;
        const capY0 = cy + (arenaR + corrLen) * sinA + hw * pY;
        const capX1 = cx + (arenaR + corrLen) * cosA - hw * pX;
        const capY1 = cy + (arenaR + corrLen) * sinA - hw * pY;
        // Визуал торца — сохраняем отдельно, удалим при открытии
        const capGfx = this.add.graphics().setDepth(2);
        const capCX = cx + (arenaR + corrLen) * cosA + cosA * WALL_VIS / 2;
        const capCY = cy + (arenaR + corrLen) * sinA + sinA * WALL_VIS / 2;
        capGfx.lineStyle(WALL_VIS, ws.fill, 0.85);
        capGfx.lineBetween(capX0 + cosA * WALL_VIS / 2, capY0 + sinA * WALL_VIS / 2,
                            capX1 + cosA * WALL_VIS / 2, capY1 + sinA * WALL_VIS / 2);
        capGfx.lineStyle(5, ws.edge, 1.0);
        capGfx.lineBetween(capX0, capY0, capX1, capY1);
        this._corridorCapGfx[i] = capGfx;
        this._wallLines.push({ x1: capX0, y1: capY0, x2: capX1, y2: capY1, corridorCap: i });
        // Физика торца (removable: capIdx = i)
        addWallLine(capX0, capY0, capX1, capY1, i);

        // ── Кнопка открытия коридора (снаружи торца) ─────────────────────────
        const btnX = cx + (arenaR + corrLen + 220) * cosA;
        const btnY = cy + (arenaR + corrLen + 220) * sinA;
        this._spawnCorridorButton(i, btnX, btnY);

        // Гравитационные ловушки и мины (внутри коридора)
        [0.28, 0.72].forEach(t => {
          const d2 = arenaR + corrLen * t;
          this._spawnGravTrap(cx + d2 * cosA, cy + d2 * sinA);
        });
        this._spawnMine(cx + (arenaR + corrLen * 0.50) * cosA, cy + (arenaR + corrLen * 0.50) * sinA);
      }
    }

    this.physics.add.collider(this.player.sprite, this.walls);
  }

  _checkDungeonBossDoor() {
    if (!this.dungeonBossDoor) return;
    const remaining = this.mobs.filter(m => m.alive && !m.isDungeonBoss && !m.isBossEscort && !m.isDepositGuard).length;
    if (remaining === 0) this._openDungeonBossDoor();
  }

  _openDungeonBossDoor() {
    if (!this.dungeonBossDoor) return;
    const door = this.dungeonBossDoor;
    this.dungeonBossDoor = null;
    const vis = this.dungeonBossDoorVis;
    this.dungeonBossDoorVis = null;
    this.log(i18n.t('log.boss_door_open'));
    if (this._wallLines)  this._wallLines  = this._wallLines.filter(l => !l.bossDoor);
    if (this._wallSolids) this._wallSolids = this._wallSolids.filter(l => !l.bossDoor);
    // Defer wall removal to next frame — avoid modifying StaticPhysicsGroup mid-physics-update
    this.time.delayedCall(0, () => {
      if (door?.active) { this.walls.remove(door, true, false); door.destroy(); }
      if (vis) { for (const obj of vis) obj.destroy(); }
    });
  }

  _checkCorridorClear(corridorIndex) {
    if (!this._clearedCorridors || this._clearedCorridors.has(corridorIndex)) return;
    const remaining = this.mobs.filter(m => m.alive && m.corridorIndex === corridorIndex).length;
    if (remaining > 0) return;
    this._clearedCorridors.add(corridorIndex);
    this.log(i18n.t('log.corridor_open', { n: corridorIndex + 1 }));
    this._spawnCorridorChest(corridorIndex);
    this._saveDungeonCorridorState();
    if (this._clearedCorridors.size === 5) this._openBossArena();
  }

  // Персистит прогресс коридоров/арены R-1-boss в DungeonRun.corridor_state,
  // чтобы при выходе-входе (пока живы жизни) не проходить зачищенные коридоры заново
  _saveDungeonCorridorState() {
    if (!this._dungeonRunId) return;
    dungeonCorridorState(this._dungeonRunId, {
      clearedCorridors: [...(this._clearedCorridors ?? [])],
      bossArenaOpen: !!this._bossArenaOpenedAt,
    }).catch(() => {});
  }

  _openBossArena() {
    const walls = [...(this.arenaWalls ?? [])];
    const vis   = [...(this.arenaWallsVis ?? [])];
    this.arenaWalls    = [];
    this.arenaWallsVis = [];
    // Убираем съёмные дуги из списка collision-проверки для снарядов
    if (this._wallLines) this._wallLines = this._wallLines.filter(wl => !wl.removable);
    // Defer wall removal to next frame — avoid modifying StaticPhysicsGroup mid-physics-update
    this.time.delayedCall(0, () => {
      for (const w of walls) { if (w?.active) { this.walls.remove(w, true, false); w.destroy(); } }
      for (const v of vis)   { v?.destroy(); }
    });
    this.log(i18n.t('log.apophis_awakened'));
    // Сохранить базовый урон для системы ярости
    const boss = this._apophisBoss;
    if (boss) boss._baseDamage = boss.damage;
    // Ярость через 10 мин; порталы — первый через 50с, потом каждые 60-80с
    this._bossArenaOpenedAt = this.time.now;
    this._bossEnrageActive  = false;
    this._bossRageCycle     = 0;   // первый раз: ярость включится сразу по истечении 10 мин
    this._saveDungeonCorridorState();
    this._portalTimer       = 90;
  }

  // Шоквав при переходе фаз: 16 лучей, 3с неуязвимость
  _apophisPhaseShockwave(boss) {
    const NUM = 16, BEAM_LEN = 3800;
    for (let i = 0; i < NUM; i++) {
      const a = i * Math.PI * 2 / NUM;
      this._laserBeam(boss.x, boss.y,
        boss.x + Math.cos(a) * BEAM_LEN, boss.y + Math.sin(a) * BEAM_LEN,
        0xce93d8, 0.85, 6, 1200);
    }
    const ring1 = this.add.graphics().setDepth(65).setBlendMode('ADD');
    ring1.lineStyle(28, 0xce93d8, 1.0);
    ring1.strokeCircle(boss.x, boss.y, boss.tpl.displaySize * 0.55);
    this.tweens.add({ targets: ring1, scaleX: 10, scaleY: 10, alpha: 0, duration: 1400,
      ease: 'Quad.easeOut', onComplete: () => ring1.destroy() });
    this._shake(300, 0.012);
    this.sfx?.play('sfx_boss_phase', { volume: 0.8 });
    this.log(i18n.t('log.boss_shockwave'));
  }

  // Ярость + порталы после открытия арены
  _updateBossArena(dt) {
    const boss = this._apophisBoss;
    if (!boss?.alive) return;

    // Ярость: активируется через 10 мин (600с) после открытия арены
    const elapsed = (this.time.now - this._bossArenaOpenedAt) / 1000;
    if (elapsed >= 600) {
      this._bossRageCycle = (this._bossRageCycle ?? 0) - dt;
      if (this._bossRageCycle <= 0) {
        this._bossEnrageActive = !this._bossEnrageActive;
        this._bossRageCycle = this._bossEnrageActive ? 20 : 30;
        if (this._bossEnrageActive) {
          boss.damage          = Math.round((boss._baseDamage ?? boss.damage) * 1.5);
          boss._rageSpeedMult  = 1.5;
          boss.sprite.setTint(0xff0000);
          this.log(i18n.t('log.boss_enrage_burst'));
        } else {
          boss.damage         = boss._baseDamage ?? boss.damage;
          boss._rageSpeedMult = 1;
          boss.sprite.setTint(boss._phaseTint ?? 0xff3333);
          this.log(i18n.t('log.boss_enrage_end'));
        }
      }
    }

    // Порталы с подкреплениями
    if (this._portalTimer !== undefined) {
      this._portalTimer -= dt;
      if (this._portalTimer <= 0) {
        this._portalTimer = 120 + Math.random() * 60;
        const portalMobCount = this.mobs.filter(m => m.alive && m.isBossEscort && m.tpl?.faction === 'ancient' && !m.isDungeonBoss).length;
        if (portalMobCount <= 8) this._spawnPortal();
      }
    }
  }

  // Вихревой портал — вырывается из пустоты, выпускает мобов, схлопывается
  _spawnPortal() {
    const boss = this._apophisBoss;
    const bx = boss?.x ?? this.worldWidth / 2;
    const by = boss?.y ?? this.worldHeight / 2;
    const ang = Math.random() * Math.PI * 2;
    const r   = 800 + Math.random() * 700;
    const px  = bx + Math.cos(ang) * r;
    const py  = by + Math.sin(ang) * r;

    const gfx = this.add.graphics().setDepth(12);
    const proxy = { t: 0 };
    const drawVortex = (t, alpha) => {
      gfx.clear();
      for (let ring = 0; ring < 4; ring++) {
        const rc = (18 + ring * 22) * t;
        const col = ring % 2 === 0 ? 0x7b2ff7 : 0xce93d8;
        gfx.lineStyle(3, col, (0.9 - ring * 0.15) * alpha);
        gfx.strokeCircle(px, py, rc);
      }
    };

    // Открытие: 2.5с
    this.tweens.add({
      targets: proxy, t: 1, duration: 2500, ease: 'Back.easeOut',
      onUpdate: () => drawVortex(proxy.t, Math.min(1, proxy.t * 2)),
      onComplete: () => {
        this.log(i18n.t('log.portal_open'));
        const PORTAL_MOBS = ['ancient_01', 'ancient_02', 'ancient_03', 'ancient_04'];
        const count = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < count; i++) {
          const tplKey = PORTAL_MOBS[Math.floor(Math.random() * PORTAL_MOBS.length)];
          const sa = ang + (Math.random() - 0.5) * 0.8;
          const mob = new Mob(this, MOBS[tplKey], 50,
            px + Math.cos(sa) * 50, py + Math.sin(sa) * 50,
            { patrolRadius: 500, leash: 2000, hpMult: 1.5, dmgMult: 1.5 });
          mob.isBossEscort = true;
          mob._groupMobId = this._nextGroupMobId++;
          this.mobs.push(mob);
        }
        // Схлопывание: 2с после 0.5с паузы
        const proxy2 = { t: 1 };
        this.tweens.add({
          targets: proxy2, t: 0, duration: 2000, ease: 'Quad.easeIn', delay: 500,
          onUpdate: () => drawVortex(proxy2.t * 0.8 + 0.2, proxy2.t),
          onComplete: () => gfx.destroy(),
        });
      },
    });
  }

  // Лут-ящик в конце коридора — открывается при зачистке
  _spawnCorridorChest(corridorIndex) {
    const cx = this.worldWidth / 2, cy = this.worldHeight / 2;
    const arenaR = 1600, corrLen = 3200;
    const CORR_ANGLES = [
      -Math.PI / 2,
      -Math.PI / 2 + 2 * Math.PI / 5,
      -Math.PI / 2 + 4 * Math.PI / 5,
      -Math.PI / 2 + 6 * Math.PI / 5,
      -Math.PI / 2 + 8 * Math.PI / 5,
    ];
    const a = CORR_ANGLES[corridorIndex];
    const d = arenaR + corrLen * 0.92;
    const chX = cx + Math.cos(a) * d;
    const chY = cy + Math.sin(a) * d;

    const glow = this.add.graphics().setDepth(29).setBlendMode('ADD');
    glow.fillStyle(0xffd700, 0.18); glow.fillCircle(chX, chY, 56);

    const img = this.add.image(chX, chY, 'corridor_chest')
      .setDisplaySize(88, 88).setDepth(30);
    this.tweens.add({ targets: img, y: chY - 6, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: glow, alpha: { from: 0.6, to: 1.0 }, duration: 900, yoyo: true, repeat: -1 });

    this._corridorChests = this._corridorChests ?? [];
    this._corridorChests.push({ img, glow, x: chX, y: chY, corridorIndex, open: false });
  }

  _updateCorridorChests() {
    if (!this.player?.alive) return;
    for (const ch of this._corridorChests) {
      if (ch.open) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, ch.x, ch.y);
      if (d < 90) {
        ch.open = true;
        ch.img?.destroy();
        ch.glow?.destroy();
        this._openCorridorChest(ch.corridorIndex);
      }
    }
    this._corridorChests = this._corridorChests.filter(c => !c.open);
  }

  _openCorridorChest(corridorIndex) {
    const AMMO_TYPES = ['ammo_plasma', 'ammo_laser', 'ammo_plasma_elite'];
    const CONSUMABLE_TYPES = ['repair_pack', 'speed_boost', 'scanner_pulse'];
    const whMax = 8 + ([0, 3, 8, 16][this.skillLevels?.cargo_expand || 0] || 0) + (this.premium ? 8 : 0);
    this._mapBoosters = this._mapBoosters ?? {};

    // Рандомный дроп (1 из 5 вариантов)
    const r = Math.random();
    if (r < 0.20) {
      // Очки чести
      const honor = 80 + Math.floor(Math.random() * 80);
      this.gainHonor(honor);
      this.log(`🎁 Ящик коридора ${corridorIndex + 1}: +${honor} ⚔ чести`);
    } else if (r < 0.40) {
      // Боеприпасы → склад
      const aType = AMMO_TYPES[Math.floor(Math.random() * AMMO_TYPES.length)];
      const qty   = 20 + Math.floor(Math.random() * 30);
      const left  = addConsumableToInventory(this.warehouse, aType, qty, whMax);
      if (left > 0) this.warehouse.push({ type: aType, amount: left, _temp: true });
      this.log(`🎁 Ящик коридора ${corridorIndex + 1}: +${qty} ${i18n.t('item.' + aType) || aType}`);
    } else if (r < 0.60) {
      // Расходник → склад
      const cType = CONSUMABLE_TYPES[Math.floor(Math.random() * CONSUMABLE_TYPES.length)];
      const qty   = 1 + Math.floor(Math.random() * 2);
      const left  = addConsumableToInventory(this.warehouse, cType, qty, whMax);
      if (left > 0) this.warehouse.push({ type: cType, amount: left, _temp: true });
      this.log(`🎁 Ящик коридора ${corridorIndex + 1}: ${i18n.t('item.' + cType) || cType} ×${qty}`);
    } else {
      // Мини-бустер (сессионный)
      const boosterTypes = [
        { key: 'dmg',    label: '+урон',   pct: () => 0.01 + Math.random() * 0.01 },
        { key: 'hull',   label: '+корпус', pct: () => 0.02 + Math.random() * 0.01 },
        { key: 'shield', label: '+щит',    pct: () => 0.03 + Math.random() * 0.01 },
        { key: 'xp',     label: '+XP',     pct: () => 0.05 + Math.random() * 0.01 },
      ];
      const bt = boosterTypes[Math.floor(Math.random() * boosterTypes.length)];
      const pct = bt.pct();
      this._mapBoosters[bt.key] = (this._mapBoosters[bt.key] || 0) + pct;
      this.player?.recomputeStats?.();
      this.log(`🎁 Ящик коридора ${corridorIndex + 1}: мини-бустер ${bt.label} +${Math.round(pct * 100)}% (до конца карты)`);
    }
  }

  // Веер из 8 void-лучей: 2 ближних к каждому игроку наводятся и бьют
  _apophisVoidRing(boss) {
    const NUM = 8;
    const BEAM_LEN     = 3000;
    const DETECT_RANGE = 2500;

    // Собираем живых игроков в радиусе (сейчас 1, дизайн на 8)
    const players = [];
    if (this.player.alive &&
        Phaser.Math.Distance.Between(boss.x, boss.y, this.player.x, this.player.y) < DETECT_RANGE) {
      players.push(this.player);
    }

    // Базовые направления лучей (равномерно по кругу)
    const baseAngles = Array.from({ length: NUM }, (_, i) => i * Math.PI * 2 / NUM);

    // Назначаем лучи игрокам: до 2 ближних луча на игрока, луч занять только 1 раз
    const beamTarget = new Array(NUM).fill(null);
    for (const p of players) {
      const pAng = Math.atan2(p.y - boss.y, p.x - boss.x);
      const sorted = baseAngles.map((a, i) => {
        let d = ((pAng - a) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        return { i, d };
      }).sort((a, b) => a.d - b.d);
      let hits = 0;
      for (const { i } of sorted) {
        if (hits >= 2) break;
        if (beamTarget[i] !== null) continue;
        beamTarget[i] = p;
        hits++;
      }
    }

    // Пульс-кольцо от центра босса при залпе (без мигания экрана)
    this.explosion?.(boss.x, boss.y, 0.7);
    const _pulse = this.add.graphics().setDepth(64).setBlendMode('ADD');
    _pulse.lineStyle(18, 0xce93d8, 0.9);
    _pulse.strokeCircle(boss.x, boss.y, boss.tpl.displaySize * 0.6);
    this.tweens.add({ targets: _pulse, scaleX: 4.5, scaleY: 4.5, alpha: 0, duration: 700,
      ease: 'Quad.easeOut', onComplete: () => _pulse.destroy() });

    // Рисуем лучи и наносим урон
    for (let i = 0; i < NUM; i++) {
      const tgt = beamTarget[i];
      let ex, ey;
      if (tgt) {
        ex = tgt.x; ey = tgt.y;
      } else {
        ex = boss.x + Math.cos(baseAngles[i]) * BEAM_LEN;
        ey = boss.y + Math.sin(baseAngles[i]) * BEAM_LEN;
      }
      if (tgt) {
        // Наводящиеся лучи: яркие, толстые, держатся 900мс
        this._laserBeam(boss.x, boss.y, ex, ey, 0xce93d8, 1.0, 8, 900);
      } else {
        // Фоновые лучи: тонкие, полупрозрачные, 600мс
        this._laserBeam(boss.x, boss.y, ex, ey, 0xb03eff, 0.55, 3, 600);
      }
      if (tgt) {
        const res = tgt.takeDamage(boss.damage, 0.6, { ignoreMovEvasion: true });
        this.onProjectileHit({ owner: 'mob', victim: tgt, type: 'void', effect: null, effectCfg: PROJ_TYPES.void }, res);
      }
    }
  }

  // Зелёный луч от Реаниматора к боссу + всплывающие + над боссом
  _updateHealerEffects(dt) {
    const boss = this._apophisBoss;
    if (!boss?.alive) { this._healBeamGfx?.clear(); return; }
    if (!this._healBeamGfx) {
      this._healBeamGfx = this.add.graphics().setDepth(48);
    }
    this._healBeamGfx.clear();
    let anyHealing = false;
    for (const m of this.mobs) {
      if (!m.alive || !m.tpl.bossHealer || !m._isHealing) continue;
      anyHealing = true;
      // Луч: зелёная линия от хилера к боссу
      this._healBeamGfx.lineStyle(3, 0x00e676, 0.75);
      this._healBeamGfx.beginPath();
      this._healBeamGfx.moveTo(m.x, m.y);
      this._healBeamGfx.lineTo(boss.x, boss.y);
      this._healBeamGfx.strokePath();
      // Pulse glow core on beam
      this._healBeamGfx.lineStyle(8, 0x00ff88, 0.25);
      this._healBeamGfx.beginPath();
      this._healBeamGfx.moveTo(m.x, m.y);
      this._healBeamGfx.lineTo(boss.x, boss.y);
      this._healBeamGfx.strokePath();
    }
    // Всплывающие "+" над боссом когда хилят
    if (anyHealing) {
      this._healPlusTimer = (this._healPlusTimer ?? 0) + dt;
      if (this._healPlusTimer >= 0.35) {
        this._healPlusTimer = 0;
        const px = boss.x + Phaser.Math.Between(-50, 50);
        const py = boss.y - 60;
        const plus = this.add.text(px, py, '+', {
          fontFamily: 'Inter, sans-serif', fontSize: '20px', color: '#00e676',
          fontStyle: 'bold', resolution: 2,
        }).setOrigin(0.5, 1).setDepth(60).setAlpha(1);
        this.tweens.add({
          targets: plus, y: py - 80, alpha: 0, duration: 900, ease: 'Quad.easeOut',
          onComplete: () => plus.destroy(),
        });
      }
    } else {
      this._healPlusTimer = 0;
    }
  }

  // Детонация бомбы-моба: урон 10% от (shield+hull), цепная реакция
  _spawnLayerMines(layer, count) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r   = 60 + i * 55;
      // Минёр может заложить мину у самой стены коридора — без проверки мина
      // спавнится внутри физического тела стены и намертво в нём застревает
      const { x: mx, y: my } = this._findFreeSpawn(layer.x + Math.cos(ang) * r, layer.y + Math.sin(ang) * r, 70);
      const mine = new Mob(this, MOBS.ancient_04b, layer.level, mx, my, {
        patrolRadius: 80, leash: 700,
      });
      mine.corridorIndex = layer.corridorIndex; // наследует принадлежность к коридору
      mine.isBossEscort  = layer.isBossEscort;
      mine.isSummon      = true; // мины не участвуют в 100%-канале дропа эскортов
      this.mobs.push(mine);
    }
  }

  onBombDetonate(bomb) {
    const bx = bomb.x, by = bomb.y;
    const br = bomb.tpl.bombBlastRadius ?? 320;
    const cr = bomb.tpl.bombChainRadius ?? 400;
    this.explosion(bx, by, 1.0);
    this.sfx?.play('sfx_mine_detonate', { volume: 0.6 });
    // Урон игроку
    if (this.player?.alive) {
      const pdist = Phaser.Math.Distance.Between(bx, by, this.player.x, this.player.y);
      if (pdist <= br) {
        const totalHp = (this.player.hull ?? 0) + (this.player.shield ?? 0);
        const dmg = Math.max(totalHp * 0.10, 60);
        const falloff = 1 - (pdist / br) * 0.5;
        const res = this.player.takeDamage(dmg * falloff, 0.2, { aoe: true });
        this.showDamage(this.player.x, this.player.y, res, this.player.maxHull);
        this._shakeForHit(res, this.player.maxHull);
        if (!this.player.alive) this.onPlayerKilled();
      }
    }
    // Цепная реакция: активируем соседние бомбы
    for (const m of this.mobs) {
      if (m === bomb || !m.alive || m.tpl.aiClass !== 'bomb') continue;
      if (m._bombTriggered) continue;
      const cd = Phaser.Math.Distance.Between(bx, by, m.x, m.y);
      if (cd <= cr) {
        m._bombTriggered = true;
        m._bombFuseTimer = 0.3; // короткий фитиль при цепи
        m.sprite.setTint(0xff4444);
        this.tweens.add({ targets: m.sprite, alpha: { from: 1, to: 0.3 }, duration: 100, yoyo: true, repeat: -1 });
      }
    }
    bomb.alive = false;
    bomb.sprite?.setVisible(false);
    bomb.label?.setVisible(false);
    bomb.bar?.clear();
    if (bomb.corridorIndex !== undefined) this._checkCorridorClear(bomb.corridorIndex);
  }

  // Направленная мина Синдиката: конус бронебойного импульса вдоль зафиксированного
  // направления. Высокая penetration — бьёт в основном по корпусу, минуя щит; игрок
  // может увернуться, сместившись в сторону от линии до истечения фитиля.
  onDirectedMineDetonate(mine) {
    const mx = mine.x, my = mine.y;
    const ang = mine._mineFireAngle ?? mine.sprite.rotation;
    const RANGE = 900, HALF_ANGLE = 0.17; // ~±10°
    this.sfx?.play('sfx_mine_detonate', { volume: 0.6 });
    this._laserBeam(mx, my, mx + Math.cos(ang) * RANGE, my + Math.sin(ang) * RANGE, 0xff6644, 1.0, 7, 260);
    if (this.player?.alive) {
      const toP = Math.atan2(this.player.y - my, this.player.x - mx);
      const dAng = Math.abs(Phaser.Math.Angle.Wrap(toP - ang));
      const pdist = Phaser.Math.Distance.Between(mx, my, this.player.x, this.player.y);
      if (dAng <= HALF_ANGLE && pdist <= RANGE && !this._hasWallBetween(mx, my, this.player.x, this.player.y)) {
        const totalHp = (this.player.hull ?? 0) + (this.player.shield ?? 0);
        const dmg = Math.max(totalHp * 0.16, 100);
        const res = this.player.takeDamage(dmg, 0.9, { aoe: true }); // высокая пробивная способность — почти весь урон в корпус
        this.showDamage(this.player.x, this.player.y, res, this.player.maxHull);
        this._shakeForHit(res, this.player.maxHull);
        if (!this.player.alive) this.onPlayerKilled();
      }
    }
    mine.alive = false;
    mine.sprite?.setVisible(false);
    mine.label?.setVisible(false);
    mine.bar?.clear();
    if (mine.corridorIndex !== undefined) this._checkCorridorClear(mine.corridorIndex);
  }

  // Импульсная мина Синдиката: радиальный ЭМИ — глушит двигатели и оружие игрока
  // на 3с, урона по корпусу/щиту не наносит.
  onStunMineDetonate(mine) {
    const mx = mine.x, my = mine.y;
    const R = mine.tpl.bombBlastRadius ?? 420;
    this._spawnEMPPulse(mx, my);
    this.sfx?.play('sfx_emp_stun', { volume: 0.6 });
    if (this.player?.alive) {
      const pdist = Phaser.Math.Distance.Between(mx, my, this.player.x, this.player.y);
      if (pdist <= R) this._applyPlayerStun(3000);
    }
    mine.alive = false;
    mine.sprite?.setVisible(false);
    mine.label?.setVisible(false);
    mine.bar?.clear();
    if (mine.corridorIndex !== undefined) this._checkCorridorClear(mine.corridorIndex);
  }

  // Полное глушение двигателей и оружия (в отличие от _applyEMPSlow — только замедление)
  _applyPlayerStun(ms) {
    const end = this.time.now + ms;
    if ((this._playerStunUntil || 0) >= end) return;
    this._playerStunUntil = end;
    this.log('⚡ Двигатели и оружие отключены на 3с!');
  }

  _updateRingDamage(dt) {
    const boss = this._apophisBoss;
    if (!boss?.alive || !this.player?.alive) return;
    this._ringDmgTimer = (this._ringDmgTimer || 0) + dt;
    if (this._ringDmgTimer < 0.35) return;
    this._ringDmgTimer = 0;
    const ZONES = [
      { r: 220, hw: 28, dmg: 45 },
      { r: 165, hw: 22, dmg: 30 },
      { r: 110, hw: 18, dmg: 20 },
    ];
    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, boss.x, boss.y);
    for (const z of ZONES) {
      if (dist >= z.r - z.hw && dist <= z.r + z.hw) {
        const res = this.player.takeDamage(z.dmg, 0, { aoe: true });
        this.showDamage(this.player.x, this.player.y, res, this.player.maxHull);
        this._shakeForHit(res, this.player.maxHull);
        if (!this.player.alive) { this.onPlayerKilled(); return; }
        this.cameras.main.flash(100, 255, 200, 120, true);
        break;
      }
    }
  }

  _updateGravTraps(dt) {
    if (!this.gravTraps?.length || !this.player?.alive) return;
    for (const trap of this.gravTraps) {
      const dx = trap.x - this.player.x, dy = trap.y - this.player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < trap.range && dist > 20) {
        const t = 1 - dist / trap.range;
        // Гравитационное притяжение
        const force = trap.strength * t * dt;
        this.player.sprite.body.velocity.x += (dx / dist) * force;
        this.player.sprite.body.velocity.y += (dy / dist) * force;
        // Торможение скорости — корабль с трудом улетает
        const drag = Math.pow(1 - t * 0.82, dt);
        this.player.sprite.body.velocity.x *= drag;
        this.player.sprite.body.velocity.y *= drag;
      }
    }
  }

  _updateMines(dt) {
    if (!this.mines?.length) return;
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const mine = this.mines[i];
      if (!mine.alive) { this.mines.splice(i, 1); continue; }
      if (!mine.triggered && this.player?.alive) {
        const d = Phaser.Math.Distance.Between(mine.x, mine.y, this.player.x, this.player.y);
        if (d < mine.triggerRange) {
          mine.triggered = true;
          this.tweens.killTweensOf(mine.gfx);
          this.tweens.add({ targets: mine.gfx, alpha: { from: 0.3, to: 1 }, duration: 120, yoyo: true, repeat: -1 });
        }
      }
      if (mine.triggered) {
        mine.fuseMs -= dt * 1000;
        if (mine.fuseMs <= 0) {
          mine.alive = false;
          mine.gfx.destroy();
          this.explosion(mine.x, mine.y, 1.2);
          if (this.player?.alive) {
            const blastDist = Phaser.Math.Distance.Between(mine.x, mine.y, this.player.x, this.player.y);
            if (blastDist <= mine.blastRadius) {
              const falloff = 1 - (blastDist / mine.blastRadius) * 0.6;
              const res = this.player.takeDamage(mine.damage * falloff, mine.penetration, { aoe: true });
              this.showDamage(this.player.x, this.player.y, res, this.player.maxHull);
              this._shakeForHit(res, this.player.maxHull);
              if (!this.player.alive) this.onPlayerKilled();
            }
          }
          this.mines.splice(i, 1);
        }
      }
    }
  }

  // ── Кнопки открытия коридоров ──────────────────────────────────────────────

  _spawnCorridorButton(index, x, y) {
    const gfx = this.add.graphics().setDepth(12);
    gfx.fillStyle(0xc8a800, 0.25); gfx.fillCircle(x, y, 90);
    gfx.lineStyle(4, 0xc8a800, 1.0); gfx.strokeCircle(x, y, 90);
    gfx.lineStyle(3, 0xffd700, 0.8); gfx.strokeCircle(x, y, 60);
    // крест-маркер
    gfx.lineStyle(4, 0xffd700, 0.9);
    gfx.lineBetween(x - 40, y, x + 40, y);
    gfx.lineBetween(x, y - 40, x, y + 40);
    const label = this.add.text(x, y + 110, `ВХОД ${index + 1}`,
      { fontFamily: 'Orbitron', fontSize: '20px', color: '#ffd700', resolution: 2 })
      .setOrigin(0.5).setDepth(13);
    const hint = this.add.text(x, y + 138, 'приблизьтесь',
      { fontFamily: 'Orbitron', fontSize: '14px', color: '#c8a800', resolution: 2 })
      .setOrigin(0.5).setDepth(13);
    this.tweens.add({ targets: gfx, alpha: { from: 0.6, to: 1.0 }, duration: 800, yoyo: true, repeat: -1 });
    this._corridorButtons[index] = { x, y, index, triggered: false, ready: false, gfx, label, hint };
  }

  _triggerCorridorButton(index) {
    const btn = this._corridorButtons[index];
    if (!btn || btn.triggered) return;
    btn.triggered = true;
    btn.gfx.destroy(); btn.label.destroy(); btn.hint.destroy();
    // Убрать физику торца
    const caps = this._corridorCapWalls?.[index];
    if (caps?.length) {
      this.time.delayedCall(0, () => {
        for (const w of caps) { if (w?.active) { this.walls.remove(w, true, false); w.destroy(); } }
      });
      this._corridorCapWalls[index] = [];
    }
    // Убрать визуал торца
    this._corridorCapGfx?.[index]?.destroy();
    if (this._corridorCapGfx) this._corridorCapGfx[index] = null;
    // Убрать _wallLines запись торца
    if (this._wallLines) this._wallLines = this._wallLines.filter(wl => wl.corridorCap !== index);
    this.log(`🔓 Коридор ${index + 1} открыт`);
    // Звуковой эффект открытия двери (если есть)
    this.cameras.main.flash(180, 200, 180, 0, true);
  }

  _updateCorridorButtons() {
    if (!this._corridorButtons?.length) return;
    const px = this.player.x, py = this.player.y;
    for (const btn of this._corridorButtons) {
      if (!btn || btn.triggered) continue;
      const near = Phaser.Math.Distance.Between(px, py, btn.x, btn.y) < 420;
      if (near !== btn.ready) {
        btn.ready = near;
        btn.hint.setText(near ? 'нажмите для входа' : 'приблизьтесь');
        btn.hint.setColor(near ? '#ffd700' : '#c8a800');
      }
    }
  }

  // ── Определение наличия стены на отрезке между двумя точками ───────────────

  _segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const d1x = bx - ax, d1y = by - ay;
    const d2x = dx - cx, d2y = dy - cy;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-10) return false;
    const t = ((cx - ax) * d2y - (cy - ay) * d2x) / cross;
    const u = ((cx - ax) * d1y - (cy - ay) * d1x) / cross;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  _hasWallBetween(x1, y1, x2, y2) {
    if (!this._wallLines?.length) return false;
    const qMinX = Math.min(x1, x2), qMaxX = Math.max(x1, x2);
    const qMinY = Math.min(y1, y2), qMaxY = Math.max(y1, y2);
    for (const wl of this._wallLines) {
      if (wl.type !== 'arc' &&
          ((wl.x1 < qMinX && wl.x2 < qMinX) || (wl.x1 > qMaxX && wl.x2 > qMaxX) ||
           (wl.y1 < qMinY && wl.y2 < qMinY) || (wl.y1 > qMaxY && wl.y2 > qMaxY))) continue;
      if (wl.type === 'arc') {
        // Пересечение отрезка с окружностью
        const dx = x2 - x1, dy = y2 - y1;
        const ex = x1 - wl.cx, ey = y1 - wl.cy;
        const a = dx * dx + dy * dy;
        if (a < 1e-10) continue;
        const b = 2 * (ex * dx + ey * dy);
        const c = ex * ex + ey * ey - wl.r * wl.r;
        const disc = b * b - 4 * a * c;
        if (disc < 0) continue;
        const sqrtD = Math.sqrt(disc);
        for (const s of [(-b - sqrtD) / (2 * a), (-b + sqrtD) / (2 * a)]) {
          if (s < 0 || s > 1) continue;
          if (this._angleInArc(Math.atan2(y1 + s * dy - wl.cy, x1 + s * dx - wl.cx), wl.a1, wl.a2)) return true;
        }
      } else {
        if (this._segmentsIntersect(x1, y1, x2, y2, wl.x1, wl.y1, wl.x2, wl.y2)) return true;
      }
    }
    return false;
  }

  // Точка ближе pad к любой стене (rect-тела старых данжей или линии с halfT)?
  _isPointNearWall(x, y, pad = 60) {
    if (this._wallSolids?.length) {
      for (const s of this._wallSolids) {
        if (s.type === 'rect') {
          const dx = Math.max(s.x0 - x, 0, x - s.x1);
          const dy = Math.max(s.y0 - y, 0, y - s.y1);
          if (dx * dx + dy * dy < pad * pad) return true;
        } else if (this._distToSegment(x, y, s.x1, s.y1, s.x2, s.y2) < (s.halfT ?? 30) + pad) {
          return true;
        }
      }
    }
    // R-1-boss не пишет в _wallSolids (там свой литеральный addWallLine/addRingArc),
    // но всегда пишет в _wallLines — проверяем и его, иначе точка внутри стены
    // коридора/кольца арены будет ложно считаться свободной (например, при
    // случайной раскладке мин минёра рядом со стеной)
    if (this._wallLines?.length) {
      for (const wl of this._wallLines) {
        if (wl.type === 'arc') {
          const dist = Phaser.Math.Distance.Between(x, y, wl.cx, wl.cy);
          if (Math.abs(dist - wl.r) < 55 + pad &&
              this._angleInArc(Math.atan2(y - wl.cy, x - wl.cx), wl.a1, wl.a2)) return true;
        } else if (this._distToSegment(x, y, wl.x1, wl.y1, wl.x2, wl.y2) < 40 + pad) {
          return true;
        }
      }
    }
    return false;
  }

  // Ближайшая свободная от стен точка: спиральная проба 8 направлений × шаги 80..480
  _findFreeSpawn(x, y, pad = 60) {
    if (!this._isPointNearWall(x, y, pad)) return { x, y };
    for (let r = 80; r <= 480; r += 80) {
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        const nx = x + Math.cos(a) * r, ny = y + Math.sin(a) * r;
        if (!this._isPointNearWall(nx, ny, pad)) return { x: nx, y: ny };
      }
    }
    console.warn(`[dungeon] нет свободной точки спавна рядом с ${Math.round(x)},${Math.round(y)}`);
    return { x, y };
  }

  // Минимальное расстояние от точки (px,py) до отрезка (ax,ay)-(bx,by)
  _distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Phaser.Math.Distance.Between(px, py, ax, ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Phaser.Math.Distance.Between(px, py, ax + t * dx, ay + t * dy);
  }

  // Снаряд находится внутри дуги [a1,a2] (угол нормализован к [a1, a1+2π])?
  _angleInArc(angle, a1, a2) {
    if (a2 < a1) a2 += Math.PI * 2;
    while (angle < a1) angle += Math.PI * 2;
    return angle <= a2;
  }

  // Убиваем снаряды, пересёкшие стены коридоров или кольцо арены
  _checkProjWallCollision() {
    const lines = this._wallLines;
    for (const p of this.projectiles) {
      if (p.dead) continue;
      const px = p.sprite.x, py = p.sprite.y;
      for (const wl of lines) {
        if (wl.type === 'arc') {
          const dist = Phaser.Math.Distance.Between(px, py, wl.cx, wl.cy);
          if (Math.abs(dist - wl.r) < 55 &&
              this._angleInArc(Math.atan2(py - wl.cy, px - wl.cx), wl.a1, wl.a2)) {
            p.destroy(); break;
          }
        } else {
          if (this._distToSegment(px, py, wl.x1, wl.y1, wl.x2, wl.y2) < 40) {
            p.destroy(); break;
          }
        }
      }
    }
  }

  _spawnGravTrap(x, y) {
    const gfx = this.add.graphics().setDepth(10);
    gfx.lineStyle(3, 0xce93d8, 0.8); gfx.strokeCircle(x, y, 80);
    gfx.fillStyle(0x4a0080, 0.3); gfx.fillCircle(x, y, 80);
    this.tweens.add({ targets: gfx, alpha: { from: 0.4, to: 1.0 }, duration: 900, yoyo: true, repeat: -1 });
    this.gravTraps.push({ x, y, range: 700, strength: 4800, gfx });
  }

  _spawnMine(x, y) {
    const gfx = this.add.graphics().setDepth(11);
    gfx.fillStyle(0xff2222, 0.8); gfx.fillCircle(x, y, 22);
    gfx.lineStyle(2, 0xff8888, 1); gfx.strokeCircle(x, y, 22);
    this.tweens.add({ targets: gfx, alpha: { from: 0.5, to: 1 }, duration: 600, yoyo: true, repeat: -1 });
    this.mines.push({ x, y, triggerRange: 150, blastRadius: 280, damage: 300, penetration: 0.25, fuseMs: 2000, triggered: false, alive: true, gfx });
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
      // R-1-boss звезда: по 1 депозиту внутри каждого луча (вертикальная звезда, BASE=-π/2)
      // arenaR=1600, corrLen=3200 → середина луча ≈ 3100 от центра
      'R-1-boss':   { types: ['biomech_fragment', 'quantum_shard', 'plasma_strand'], guard: 'ancient_11', amount: 20, spots: [[0,-3100], [2948,-958], [1823,2509], [-1823,2509], [-2948,-958], [0,-4200]] },
    };
    const dcfg = DUNGEON_DEPOSITS[galaxy.current];
    if (!dcfg) return;

    const sec2 = SECTORS[galaxy.current];
    const guardLvl = sec2.lvlMax;
    const typeList = dcfg.types ? dcfg.types : [dcfg.res];
    const depositMult = this._dungeonDiff().deposits;
    const scaledAmount = Math.round(dcfg.amount * depositMult);

    const CLUSTER_R = 100; // радиус россыпи кристаллов вокруг центра точки

    // Для data-driven данжей споты берутся из суточного варианта размещения
    const spots = this._dungeonVariant?.deposits ?? dcfg.spots;
    spots.forEach((spot, i) => {
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

      const gp = galaxy.current === 'R-1-boss'
        ? { x: x + 130, y: y + 90 }
        : this._findFreeSpawn(x + 130, y + 90, 100);
      const guard = new Mob(this, MOBS[dcfg.guard], guardLvl, gp.x, gp.y,
        { behavior: 'guard', patrolRadius: 150, leash: 400, ...(galaxy.current === 'R-1-boss' ? { dmgMult: 2 } : {}) });
      guard.isDepositGuard = true;
      this.mobs.push(guard);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  БОЙ С ТЕНЬЮ — shadow_arena логика
  // ═══════════════════════════════════════════════════════════════════════════

  // Суточный лимит боёв с Тенью — раньше игрок сам настраивал статы "противника"
  // и мог подбирать конфигурацию под формальную победу без риска: дыра для
  // фарма опыта/кредитов. Лимит считается по локальной полуночи (тот же паттерн,
  // что у plasmateDayReset/missionDailyReset).
  _shadowBattleGate() {
    const nowMs = Date.now();
    if (!this.shadowBattleDayReset || nowMs >= this.shadowBattleDayReset) {
      this.shadowBattlesToday = 0;
      const tomorrow = new Date(); tomorrow.setHours(24, 0, 0, 0);
      this.shadowBattleDayReset = tomorrow.getTime();
    }
    const max = this.premium ? 6 : 3;
    const remaining = Math.max(0, max - (this.shadowBattlesToday || 0));
    return { ok: remaining > 0, remaining, max };
  }

  startShadowBattle(cfg) {
    const gate = this._shadowBattleGate();
    if (!gate.ok) { this.log(`⚔ Бой с Тенью: лимит на сегодня исчерпан (${gate.max}/${gate.max}).`); return; }
    this.shadowBattlesToday = (this.shadowBattlesToday || 0) + 1;
    this._shadowRematchesUsed = 0;
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
    if (b.fireCooldown <= 0 && dist < 600 && b._aiState !== 'flee') {
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
    if (sKey === 'ship:helion_volley' && dist < 600 && cdReady(sKey, 40000)) {
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
    if (dist < 600 && !b._overcharge && cdReady('overcharge_shot', 25000)) {
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

    // Тень больше не даёт честь (тренажёр с конфигурацией "противника" целиком в руках
    // игрока — не источник чести, см. диалог), только xp/кредиты.
    let xpGain = 0, credGain = 0;
    if (result === 'win') {
      // ×10 меньше прежнего — конфигурация "противника" целиком в руках игрока,
      // это тренажёр, а не источник фарма опыта/кредитов
      xpGain   = 350;
      credGain = 1200;
      this.gainXp(xpGain);
      this.credits = (this.credits || 0) + credGain;
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
      reg(this.add.text(cx, cy - 20, `+${xpGain.toLocaleString()} XP`,        TF('17px', '#88ff88')).setOrigin(0.5).setScrollFactor(0).setDepth(201));
      reg(this.add.text(cx, cy + 6,  `+${credGain.toLocaleString()} кредитов`, TF('15px', '#ffcc44')).setOrigin(0.5).setScrollFactor(0).setDepth(201));
    } else {
      reg(this.add.text(cx, cy - 10, 'Тень оказалась сильнее.', TFI('15px', '#bb6666')).setOrigin(0.5).setScrollFactor(0).setDepth(201));
    }

    const closeY = cy + panH / 2 - 44;
    // До 2 реванша на бой (в рамках одной из 3/6 суточных попыток) — без этого
    // игрок мог реваншироваться неограниченно против той же удобной конфигурации.
    const rematchesLeft = 2 - (this._shadowRematchesUsed || 0);
    const canRematch = rematchesLeft > 0;
    const buttons = canRematch
      ? [
          { x: cx - 100, label: 'НА БАЗУ', color: COLORS.primary, fill: 0x0d2233, hover: 0x1a3a50, action: () => this.exitShadowBattle() },
          { x: cx + 100, label: `РЕВАНШ (${rematchesLeft})`, color: 0xccbb44, fill: 0x1a1a0d, hover: 0x2a2a10,
            action: () => {
              this._shadowRematchesUsed = (this._shadowRematchesUsed || 0) + 1;
              this._shadowBattleDone = false; this._cleanupBotPilot();
              document.getElementById('scene-overlay')?.classList.add('active'); this.scene.restart();
            } },
        ]
      : [
          { x: cx, label: 'НА БАЗУ', color: COLORS.primary, fill: 0x0d2233, hover: 0x1a3a50, action: () => this.exitShadowBattle() },
        ];
    if (!canRematch) {
      reg(this.add.text(cx, closeY - 34, 'Реванши на этот бой закончились', TFI('11px', '#667788')).setOrigin(0.5).setScrollFactor(0).setDepth(201));
    }
    buttons.forEach(({ x, label, color, fill, hover, action }) => {
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
    this.log('DEV: Тренажёры [7] — корпус 30k | щит+корп 15k+15k · кольцо дальности + линейка включены');
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
    // Тут — сразу, не через debounce: сцена сейчас уничтожается (смена сектора и т.п.),
    // откладывать на 2с нельзя — можем не долететь до срабатывания таймера.
    if (this._saveStateTimer) { clearTimeout(this._saveStateTimer); this._saveStateTimer = null; }
    this._flushSaveState();
    this._cleanupBotPilot();
    this.escortTransport?.destroy();
    this.escortTransport = null;
    this._escortMobs = null;
    this._trainingDummies?.forEach(d => d.destroy());
    this._trainingDummies = null;
    this._rangeRingGfx?.destroy();
    this._rangeRingGfx = null;
    this._rangeRingText?.destroy();
    this._rangeRingText = null;
    this._rangeRulerText?.destroy();
    this._rangeRulerText = null;
    this._lowHpVignette?.destroy();
    this._lowHpVignette = null;
    this.sfx?.stopAllLoops();
    this._attachedFx = [];
    this._trackedBeams = [];
    this.argusCtrl?.destroy();
    this.argusCtrl = null;
    this.confedGuards?.destroy();
    this.confedGuards = null;
    this._apophisPulseTween?.stop();
    this._apophisPulseTween = null;
    for (const r of (this._apophisRings ?? [])) r.destroy();
    this._apophisRings = null;
    this._apophisBoss = null;
    for (const v of (this.arenaWallsVis ?? [])) v.destroy();
    this.arenaWalls = []; this.arenaWallsVis = [];
    this._clearedCorridors = null;
    this._bossArenaOpenedAt = undefined;
    this._portalTimer       = undefined;
    this._mapBoosters       = null;
    for (const ch of (this._corridorChests ?? [])) { ch.img?.destroy(); ch.glow?.destroy(); }
    this._corridorChests = [];
    this._healBeamGfx?.destroy(); this._healBeamGfx = null;
    for (const trap of (this.gravTraps ?? [])) trap.gfx?.destroy();
    this.gravTraps = [];
    for (const mine of (this.mines ?? [])) { if (mine.alive) mine.gfx?.destroy(); }
    this.mines = [];
    this._wallLines = [];
    for (const btn of (this._corridorButtons ?? [])) { if (btn && !btn.triggered) { btn.gfx?.destroy(); btn.label?.destroy(); btn.hint?.destroy(); } }
    this._corridorButtons = [];
    for (const gfx of (this._corridorCapGfx ?? [])) gfx?.destroy();
    this._corridorCapGfx = [];
    this._corridorCapWalls = [];
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
      dailySetBonusGranted: this.dailySetBonusGranted || false,
      dailyPerfectDays:    this.dailyPerfectDays    || 0,
      weeklyReset:         this.weeklyReset         || 0,
      unlockFlags:         this.unlockFlags          || {},
      plasmateToday:       this.plasmateToday        || 0,
      plasmateDayReset:    this.plasmateDayReset      || 0,
      shadowBattlesToday:  this.shadowBattlesToday    || 0,
      shadowBattleDayReset: this.shadowBattleDayReset  || 0,
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
    if (s.dailySetBonusGranted != null) this.dailySetBonusGranted = s.dailySetBonusGranted;
    if (s.dailyPerfectDays   != null) this.dailyPerfectDays   = s.dailyPerfectDays;
    if (s.weeklyReset        != null) this.weeklyReset        = s.weeklyReset;
    if (s.unlockFlags        != null) this.unlockFlags        = s.unlockFlags;
    if (s.plasmateToday      != null) this.plasmateToday      = s.plasmateToday;
    if (s.plasmateDayReset   != null) this.plasmateDayReset   = s.plasmateDayReset;
    if (s.shadowBattlesToday != null) this.shadowBattlesToday = s.shadowBattlesToday;
    if (s.shadowBattleDayReset != null) this.shadowBattleDayReset = s.shadowBattleDayReset;
    if (s.clan               !== undefined) this.clan         = s.clan;
    if (s.lastGuardReset     != null) this.lastGuardReset    = s.lastGuardReset;
  }

  // Схлопываем частые вызовы (магнит подряд подбирает пачку лута за доли секунды,
  // опустошение стака патронов и т.п.) в один реальный save раз в SAVE_DEBOUNCE_MS —
  // раньше JSON.stringify большого стейта + сетевой PUT на КАЖДЫЙ подобранный магнитом
  // предмет давали заметные подсадки FPS во время фарма. window.setTimeout, не
  // this.time.delayedCall — должен переживать scene.restart() при смене сектора.
  _saveState() {
    if (!getToken()) return;
    this._saveStateDirty = true;
    if (this._saveStateTimer) return;
    this._saveStateTimer = setTimeout(() => {
      this._saveStateTimer = null;
      if (this._saveStateDirty) this._flushSaveState();
    }, 2000);
  }

  _flushSaveState() {
    if (!getToken()) return;
    this._saveStateDirty = false;
    const state = this._serializeState();
    try { localStorage.setItem('stellar_drift_state_' + getUsername(), JSON.stringify(state)); } catch (_) {}
    apiPut('/player/state', state).catch(() => {});
  }

  _serializeLoot() {
    const sec = SECTORS[galaxy.current];
    // PvP-арены: лут не сохраняем (дропа нет по геймдизайну).
    // Данжи: лут инстанса хранится на сервере в DungeonRun.floor_loot (см.
    // dungeonLootDrop/dungeonLootCollected), а не в этой суточно-независимой карте.
    if (sec?.pvp || sec?.isDungeon) return this._lootBySector || {};

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
