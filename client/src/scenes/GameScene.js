import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, BASE_WORLD, PVP_WORLD_SCALE, PLAYER, MOBS, PROJECTILE, RESPAWN_MS, UI_RES, BOSS, DPR, HANDLING, ART_ANGLE_OFFSET, RANKS } from '../constants.js';
import { minimapRect, minimapToWorld } from '../systems/minimap.js';
import { i18n } from '../i18n.js';
import Player from '../entities/Player.js';
import Mob from '../entities/Mob.js';
import Projectile from '../entities/Projectile.js';
import Loot from '../entities/Loot.js';       
import Movement from '../systems/Movement.js';
import { EXP_CLASSES } from './BootScene.js'; 
import { rollLootForMob, dropChance, itemName, rollStarGold, starterCannon, starterShield, rollCannon, rollShield, rollEngine, rollLaser, rollApophisLoot, PLASMATE_PER_SLOT, PLASMATE_DAILY_MAX, addPlasmateToInventory, totalPlasmateInInventory, removePlasmateFromInventory } from '../items.js';
import PlasmateDeposit from '../entities/PlasmateDeposit.js';
import { levelInfo, xpToNext, MAX_LEVEL } from '../leveling.js';
import { SHIP_BY_KEY } from '../ships.js';    
import { SECTORS, galaxy, neighbors, edgeDir, sectorAccess } from '../galaxy.js';
import { calculateRating, getRank } from '../ranking.js';
import VFXManager from '../systems/VFXManager.js';
import MiningBase from '../entities/MiningBase.js';
import HomeBase from '../entities/HomeBase.js';
import ArgusController from '../systems/ArgusController.js';
import { getUsername, getToken, apiPut, apiGet } from '../api.js';
import { MISSIONS, getMissionSectorTarget } from '../data/missions.js';
import EscortTransport, { ESCORT_SPEED, ESCORT_WAVE_AT } from '../entities/EscortTransport.js';

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
  if (leadT <= 0) return { x: tx, y: ty };
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

export default class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  create(data) {
    // Apply persisted player state on first session start (not on sector restarts)
    if (window.PLAYER_STATE) {
      this._applyLoadedState(window.PLAYER_STATE);
      window.PLAYER_STATE = null;
    }

    const tp  = window.TEST_PROFILE ?? null;
    const sec = SECTORS[galaxy.current];
    const isPvp = sec.pvp === true;
    const scale = isPvp ? PVP_WORLD_SCALE : 1.0;
    
    this.worldWidth = BASE_WORLD.width * scale;
    this.worldHeight = BASE_WORLD.height * scale;
    this.safeZoneRadius = BASE_WORLD.safeZoneRadius;
    this.objScale = 1.0;

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

    this.ownedShips = this.ownedShips || new Set(['wisp']);
    this.activeShip = this.activeShip || 'wisp';
    
    if (DEV_MODE) {
      this.input.keyboard.on('keydown-EIGHT', () => {
        this.ownedShips.add('argus');
        this.activeShip = 'argus';
        const maxCannon = { type: 'cannon', tier: 4, damage: 210, penetration: 0.20, fireRate: 1.0, starLvl: 5 };
        const maxShield = { type: 'shield', tier: 4, durability: 1500, regen: 100, evasion: 0.10, starLvl: 5 };
        const maxEngine = { type: 'engine', tier: 4, speed: 27, starLvl: 5 };
        this.equipped.weapon = Array(10).fill(null).map(() => ({...maxCannon}));
        this.equipped.shield = Array(10).fill(null).map(() => ({...maxShield}));
        this.equipped.engine = Array(10).fill(null).map(() => ({...maxEngine}));
        this.player.applyShip(SHIP_BY_KEY['argus']);
        this.player.hull = this.player.maxHull;
        this.player.shield = this.player.maxShield;
        this.log('DEV: Argus Activated');
      });
      this.input.keyboard.on('keydown-NINE', () => {
        const laser = { type: 'laser', tier: 4, damage: 252, penetration: 0, fireRate: 1.0, starLvl: 5 };
        this.equipped.weapon = Array(10).fill(null).map((_, i) => i === 0 ? { ...laser } : null);
        this.player.recomputeStats();
        this.player.hull = this.player.maxHull;
        this.player.shield = this.player.maxShield;
        this.log('DEV: Laser Cannon Equipped');
      });
    }

    this.shipLevels = this.shipLevels || {};
    this.pilotXp    = this.pilotXp    || (tp ? xpForLevel(tp.level) : 1829100);
    this.pilotHonor = this.pilotHonor ?? (DEV_MODE ? 420500 : 0);
    this.pilotLevel = levelInfo(this.pilotXp).level;
    this.initMissionState();

    const playerRating = calculateRating(this.pilotXp, this.pilotHonor);
    const ratings = MOCK_CORP_RATINGS.includes(playerRating)
      ? MOCK_CORP_RATINGS
      : [...MOCK_CORP_RATINGS, playerRating].sort((a, b) => b - a);
    this.pilotRank = getRank(playerRating, ratings);
    if (tp?.rankOverride) this.pilotRank = RANKS.find(r => r.name === tp.rankOverride) ?? this.pilotRank;

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
    this.skillLevels = this.skillLevels || {};
    this.actionBar   = this.actionBar   || Array(10).fill(null);
    this.respeckCount     = this.respeckCount     || 0;
    this.skillAchievementSP = this.skillAchievementSP || 0;

    // Active skill runtime state (reset per session)
    this.skillCooldowns    = {};
    this._overchargeActive = false;
    this._berserkerBuff    = null;   // { endTime, mult } | null
    this._stealthEndTime   = 0;
    this._stealthOrigSpeed = 0;

    this.playerName  = this.playerName  || getUsername();
    this.player.setNameplate(this.playerName, this.pilotRank);
    this.miningBases = [];
    this.homeBases   = [];

    this.steering = false;
    this.collectTarget = null;
    this.collectTimer = 0;
    this.collectGfx = this.add.graphics().setDepth(58);

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
    this._targetFx = null;

    // Admin game-state broadcast (same channel as ArgusController)
    this._adminCh = null;
    this._adminBroadcastT = 0;
    try { this._adminCh = new BroadcastChannel('stellar-drift-admin'); } catch (_) {}
    this._adminBroadcastGameState();

    this.time.delayedCall(60, () => this.log(i18n.t('log.entered', { sector: SECTORS[galaxy.current].name })));
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
    if (sec.isDungeon) return;
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

  _collectPlasmateDeposit(deposit) {
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
    const drover = this.activeShip === 'drover' ? 2 : 0;
    const prem   = this.premium ? (this.activeShip === 'drover' ? 6 : 8) : 0;
    return 8 + drover + sl * (sl + 1) + prem;
  }

  createBaseAndSafeZone() {
    const sec = SECTORS[galaxy.current];
    if (sec.isDungeon) return; // В данжах нет безопасных зон
    if (sec.pvp) return; // В PvP секторах нет центральной базы

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
    for (const b of this.miningBases) b.destroy();
    this.miningBases = [];
    for (const b of this.homeBases) b.destroy();
    this.homeBases = [];
    this._spawnHomeBase();

    const sec = SECTORS[galaxy.current];
    const cx = this.worldWidth / 2, cy = this.worldHeight / 2, M = MOBS;
    const Lmin = sec.lvlMin, Lmax = Math.min(50, sec.lvlMax);
    const rnd = (a, b) => Phaser.Math.Between(a, b);
    let pool, boss;
    const add = (k, lvl, ox, oy, opts) => {
      const m = new Mob(this, M[k], lvl, cx + ox, cy + oy, opts);
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
          add('sec_drone', Lmax, leader.spawnX - cx + rnd(-100, 100), leader.spawnY - cy + rnd(-100, 100), { leader });
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
          // Патрули теперь ROAM (курсируют между всеми базами), но стартуют у баз
          const dest = add('sec_destroyer', Lmax, b.x - cx + rnd(-200, 200), b.y - cy + rnd(-200, 200), { behavior: 'roam', targets: baseTargets });
          for (let j = 0; j < config.dronesPerDest; j++) {
            add('sec_drone', Lmax, dest.spawnX - cx + rnd(-100, 100), dest.spawnY - cy + rnd(-100, 100), { leader: dest });
          }
        }
      }
      return;
    }

    if (galaxy.current === 'R-1-boss') {
      // Специальный спавн для босс-уровня Алгол: Зов Апофиса
      const ring = [[720, 720], [-720, 720], [720, -720], [-720, -720]];
      ring.forEach(o => add('ancient_06', 50, o[0], o[1], { behavior: 'guard', patrolRadius: 300 }));
      add('apophis', 50, 0, 0, { behavior: 'guard', patrolRadius: 100, leash: Infinity });
      return;
    }

    if (galaxy.current === 'dungeon_5') {
      pool = ['ancient_03', 'ancient_04', 'ancient_05', 'ancient_01', 'ancient_02'];
      boss = 'ancient_06';
    } else if (galaxy.current === 'helios_5') {
      // Бастион Конфедерации — дезертиры и элита
      pool = ['confed_01', 'confed_02', 'confed_06', 'syndicate_05', 'confed_01'];
      boss = 'confed_09';
    } else if (galaxy.current === 'dungeon_2') {
      // Логово контрабандистов — чисто Синдикат
      pool = ['syndicate_01', 'syndicate_02', 'syndicate_04', 'syndicate_03'];
      boss = 'syndicate_06';
    } else if (Lmax <= 20) { 
      pool = ['pirate_01', 'pirate_02', 'pirate_03', 'pirate_04', 'pirate_05', 'pirate_06', 'pirate_07']; boss = 'pirate_09'; 
    } else if (Lmax <= 35) { 
      // Мид-гейм: Синдикат + Безопасность
      pool = ['syndicate_01', 'sec_drone', 'syndicate_04', 'pirate_08', 'sec_drone', 'syndicate_03']; 
      boss = 'sec_destroyer'; 
    } else { 
      pool = ['ancient_01', 'ancient_02', 'ancient_04', 'confed_06', 'ancient_03']; boss = 'ancient_06'; 
    }
    
    if (galaxy.current === 'dungeon_5') {
      // Плотный спавн для Хранилища Древних
      const pts = [[960, 960], [-960, 960], [960, -960], [-960, -960], [0, 1800], [0, -1800], [2160, 0], [-2160, 0]];
      pts.forEach((o, i) => add(pool[i % pool.length], rnd(Lmin, Lmax), o[0], o[1], { patrolRadius: 400 }));
      // Босс в центре (где обычно база)
      add(boss, Lmax, 0, 0, { behavior: 'guard', patrolRadius: 300, leash: 900 });
    } else {
      const ring = [[1200, -360], [-1320, 480], [480, 1260], [-1020, -840], [1800, 624], [-1800, -180]];
      ring.forEach((o, i) => add(pool[i % pool.length], rnd(Lmin, Lmax), o[0], o[1]));
      const gx = 1800, gy = 1140;
      add(boss, Lmax, gx, gy, { behavior: 'guard', patrolRadius: 180, leash: 480 });
      for (const [ox, oy] of [[-240, -130], [250, -90], [-110, 250]]) {
        add(pool[0], rnd(Lmin, Lmax), gx + ox, gy + oy, { patrolRadius: 150, leash: 520 });
      }
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
      // Each corp has a forward base near the top edge (toward helios/home sectors)
      // Helios: centered, just inside the top gate
      // Karax: offset left (territory is upper-left in galaxy grid)
      // Tides: offset right (territory is lower-right in galaxy grid)
      add('helios',     0, -(my - 500));
      add('karax',  -3120, -(my - 500));
      add('tides',   3120, -(my - 500));
    }
  }

  createJumpgates() {
    this.gates = [];
    const cx = this.worldWidth / 2, cy = this.worldHeight / 2, cur = galaxy.current;
    const mx = this.worldWidth / 2 - 320, my = this.worldHeight / 2 - 320;
    for (const t of neighbors(cur)) {
      const { dx, dy } = edgeDir(cur, t);     
      const gx = cx + dx * mx, gy = cy + dy * my;
      const sec = SECTORS[t];
      const isDungeon = sec.isDungeon === true;
      const vortex = this.add.image(gx, gy, 'jumpgate_vortex').setDepth(2).setDisplaySize(80, 80).setVisible(false);
      if (isDungeon) vortex.setTint(0xffaa00); // Оранжевый вихрь для данжей

      const ring = this.add.image(gx, gy, 'jumpgate_ring').setDepth(4).setDisplaySize(260, 260);
      if (isDungeon) ring.setTint(0xffe0b2);

      const lock = sectorAccess(t, this.pilotLevel, this.activeShip).ok ? '' : ' 🔒';
      const label = this.add.text(gx, gy - 135,
        `${sec.name}${lock}\n${i18n.t('mob.level')}${sec.lvlMin}–${sec.lvlMax}`,
        { 
          fontFamily: 'Orbitron, sans-serif', fontSize: '14px', 
          color: isDungeon ? '#ffcc80' : (lock ? '#ef9a9a' : '#9fe6ff'), 
          align: 'center', resolution: UI_RES 
        })
        .setOrigin(0.5, 1).setDepth(6);
      
      const btn = this.add.text(gx, gy - 185, i18n.t('map.jump'), {
        fontFamily: 'Orbitron', fontSize: '18px', color: '#ffffff',
        backgroundColor: isDungeon ? '#f57c00' : '#4dd0e1', padding: { x: 14, y: 8 }
      }).setOrigin(0.5, 1).setDepth(10).setInteractive({ useHandCursor: true }).setVisible(false);
      
      const gate = { x: gx, y: gy, target: t, ring, vortex, label, btn, spin: 1.1 };
      btn.on('pointerdown', (pointer, localX, localY, event) => { 
        if (event) event.stopPropagation(); 
        this.startJumpSequence(gate); 
      });
      this.gates.push(gate);
    }
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
        this.startJumpSequence(g);
      }
    }
  }

  startJumpSequence(gate) {
    if (this.jumping) return;
    
    const acc = sectorAccess(gate.target, this.pilotLevel, this.activeShip);
    if (!acc.ok) {
      this.log(i18n.t('log.jump_locked', { reason: acc.reason }));
      return;
    }

    this.jumping = true;
    this.player.waypoint = null; 
    this.movement.setWaypoint(null);
    this.player.speed = 0;       
    this.selectTarget(null);    
    this.isFiring = false;
    
    // Вихрь появляется ОДНОМОМЕНТНО на 130px
    gate.vortex.setVisible(true).setAlpha(1).setDisplaySize(130, 130);
    
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

    this.tweens.add({
      targets: this.player.sprite,
      x: gate.x, y: gate.y,
      scaleX: 0.01, scaleY: 0.01,
      duration: spinUpDuration,
      ease: 'Back.easeIn'
    });

    this.time.delayedCall(spinUpDuration, () => {
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

    this.time.delayedCall(totalDuration, () => {
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
    const acc = sectorAccess(key, this.pilotLevel, this.activeShip);
    if (!acc.ok) { this.jumping = false; this.player.sprite.setVisible(true).setScale(1); return; }
    
    const fromKey = galaxy.current;
    galaxy.current = key;

    // Mission: sector arrival hooks
    if (key === 'R-1-boss') this.advanceMission('story_signal', 0);

    // Координаты появления в новом секторе
    const nextPvp = SECTORS[key].pvp === true;
    const nextW = BASE_WORLD.width * (nextPvp ? PVP_WORLD_SCALE : 1.0);
    const nextH = BASE_WORLD.height * (nextPvp ? PVP_WORLD_SCALE : 1.0);

    const { dx, dy } = edgeDir(key, fromKey); 
    const mx = nextW / 2 - 320, my = nextH / 2 - 320;
    const startX = nextW / 2 + dx * mx;
    const startY = nextH / 2 + dy * my;

    this.scene.restart({ startX, startY });
  }

  setupInput() {
    this.input.mouse?.disableContextMenu();
    let lastClickTime = 0;

    this.input.on('pointerdown', (pointer) => {
      if (this.scene.isActive('GarageScene') || this.scene.isActive('CargoScene') || this.scene.isActive('MapScene') || this.scene.isActive('BaseMenuScene') || this.scene.isActive('CorpScene') || this.scene.isActive('SkillScene') || this.scene.isActive('ClanScene') || this.scene.isActive('MissionsScene') || this.scene.isActive('ShopScene')) return;
      if (this.atBase) return;

      // Action bar click (physical canvas coords, SH=52 GAP=4 N=10)
      {
        const AB_SH = 52, AB_SW = 52, AB_GAP = 4, AB_N = 10;
        const abBarY = this.scale.height - AB_SH - 10;
        if (pointer.y >= abBarY) {
          const abStartX = Math.round((this.scale.width - (AB_N * AB_SW + (AB_N - 1) * AB_GAP)) / 2);
          const slotI = Math.floor((pointer.x - abStartX) / (AB_SW + AB_GAP));
          if (slotI >= 0 && slotI < AB_N) { this._activateSkillSlot(slotI); return; }
        }
      }

      const now = this.time.now;
      const isDouble = (now - lastClickTime < 350);
      lastClickTime = now;

      const mr = minimapRect(this);
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

    this.input.on('pointerup', () => { this.steering = false; });
    this.input.keyboard.addCapture('TAB,ESC,G,M,J,F,CTRL');
    
    this.input.keyboard.on('keydown-TAB', (e) => { e.preventDefault(); this.cycleTarget(); });
    this.input.keyboard.on('keydown-ESC', () => { this._exitToSpace(); });
    this.input.keyboard.on('keydown-F', () => {
      if (!this.player.alive) return;
      if (this.atBase) { this._exitToSpace(); return; }
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
    this.input.keyboard.on('keydown-C', () => _openBase('CargoScene',    'Склад'));
    this.input.keyboard.on('keydown-G', () => _openBase('GarageScene',   'Гараж'));
    this.input.keyboard.on('keydown-M', () => { this.player.waypoint = null; this.cancelCollect(); this.toggleOverlay('MapScene'); });
    this.input.keyboard.on('keydown-K', () => _openBase('SkillScene',    'Скиллы'));
    this.input.keyboard.on('keydown-O', () => _openBase('MissionsScene', 'Миссии'));
    this.input.keyboard.on('keydown-P', () => _openBase('ShopScene',     'Магазин'));
    this.input.keyboard.on('keydown-H', () => _openBase('CorpScene',     'Корпорация'));
    this.input.keyboard.on('keydown-N', () => _openBase('ClanScene',     'Клан'));
    
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
        this.log('DEV: +1 000 000 кр, +500 ⭐, +500 плазмита');
      });
    }
  }

  // ── Active skill system ────────────────────────────────────────────────

  _skillCooldownMs(key) {
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
    this.skillCooldowns.stealth_sprint = now + cd;
    const dur = Math.round(8000 * (this.player.stealthDurMult ?? 1));
    this._stealthEndTime = now + dur;
    this._stealthOrigSpeed = this.player.shipBaseSpeed;
    this.player.shipBaseSpeed = Math.round(this.player.shipBaseSpeed * 1.30);
    this.player.recomputeStats();
    this.player.sprite.setAlpha(0.35);
    this.log(`👻 Стелс-рывок: +30% скорость, ${Math.round(dur / 1000)}с`);
    this.time.delayedCall(dur, () => {
      if (!this.player?.alive) return;
      this.player.shipBaseSpeed = this._stealthOrigSpeed;
      this.player.recomputeStats();
      this.player.sprite.setAlpha(1.0);
      this._stealthEndTime = 0;
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
    this.skillCooldowns.berserker = now + cd;
    this._berserkerBuff = { endTime: now + 15000, mult: 1 + boost };
    this.log(`💀 Берсерк: +${Math.round(boost * 100)}% урон, 15с`);
    this.hitFlash(this.player.x, this.player.y, true);
  }

  gainXp(amount) {
    if (this.pilotLevel >= MAX_LEVEL || amount <= 0) return;
    this.pilotXp += amount;
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
    for (const o of ['GarageScene','CargoScene','MapScene','MissionsScene','ShopScene','CorpScene','BaseMenuScene','SkillScene','ClanScene'])
      if (this.scene.isActive(o)) this.scene.stop(o);
  }

  toggleOverlay(key, data) {
    const overlays = ['GarageScene', 'CargoScene', 'MapScene', 'MissionsScene', 'ShopScene', 'CorpScene', 'ClanScene', 'SkillScene'];
    for (const o of overlays) { if (o !== key && this.scene.isActive(o)) this.scene.stop(o); }
    if (this.scene.isActive(key)) this.scene.stop(key); else this.scene.launch(key, data);
  }
  selectTarget(mob) {
    this.target = mob;
    if (this._targetFx?.active) { this.vfx?.stopLoop(this._targetFx); this._targetFx = null; }
    if (!mob) { this.isFiring = false; return; }
    this._targetFx = this.vfx?.playLoop('targeting_reticle', mob.x, mob.y, { scale: 0.18, depth: 46 });
  }
  cycleTarget() {
    const alive = this.mobs.filter((m) => m.alive).sort((a, b) => Phaser.Math.Distance.Between(this.player.x, this.player.y, a.x, a.y) - Phaser.Math.Distance.Between(this.player.x, this.player.y, b.x, b.y));
    if (!alive.length) { this.target = null; return; }
    const idx = alive.indexOf(this.target); this.target = alive[(idx + 1) % alive.length];
  }
  firePlayerWeapon() {
    const p = this.player;
    // Capture shared skill state once — OC/berserker consumed here, not inside sub-methods.
    const isOC = this._overchargeActive;
    if (isOC) this._overchargeActive = false;
    let skillMult = isOC ? 2.0 : 1.0;
    if (this._berserkerBuff && this.time.now < this._berserkerBuff.endTime) skillMult *= this._berserkerBuff.mult;

    if (p.hasCannon) this._fireCannon(skillMult, isOC);
    if (p.hasLaser)  this._fireLaser(skillMult, isOC);
  }

  _fireCannon(skillMult, isOC) {
    const t = this.target, p = this.player;
    if (!t?.alive || !p.alive) return;

    if (Math.random() >= (p.cannonAccuracy ?? 0.90)) {
      this.muzzleFlash(p.x, p.y, 0x8fe6ff);
      return;
    }

    const isCrit = p.critChance > 0 && Math.random() < p.critChance;
    const dmg    = Math.round(p.cannonDamage * skillMult * (isCrit ? 2 : 1));
    const color  = isOC ? 0xff8800 : isCrit ? 0xffee44 : PROJECTILE.playerColor;
    // Predictive aim: lead the target based on its current velocity.
    const aimPt = _leadTarget(p.x, p.y, t.x, t.y,
      t.sprite?.body?.velocity?.x ?? 0, t.sprite?.body?.velocity?.y ?? 0,
      PROJECTILE.speed);
    this.projectiles.push(new Projectile(this, 'player', p.x, p.y, aimPt.x, aimPt.y, t, dmg, p.weaponPenetration, color, 90 * Math.PI / 180));
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

    if (!hit) return;

    const dmg = Math.round(p.laserDamage * skillMult * (isCrit ? 2 : 1));
    const opts = { shieldMult: p.weaponShieldMult ?? 0.80, hullMult: p.weaponHullMult ?? 1.50, ignoreMovEvasion: true };
    const res = t.takeDamage(dmg, p.weaponPenetration, opts);

    this.vfx?.play('laser_beam2', t.x, t.y, { scale: isOC ? 0.22 : 0.13, depth: 67 });
    const toHull = (res.hullHit || 0) > 0;
    this.hitFlash(t.x, t.y, toHull);
    if (toHull && this._onScreen(t.x, t.y)) this.vfx?.play('hull_hit', t.x, t.y, { scale: 0.15, depth: 67 });
    this.showDamage(t.x, t.y, res);
    if (isOC || isCrit) {
      const label = isOC ? '⚡ УДАР!' : 'КРИТ!';
      const clr   = isOC ? '#ffcc00' : '#ffff44';
      const txt = this.add.text(t.x, t.y - 40, label,
        { fontFamily: 'Orbitron', fontSize: '14px', color: clr, fontStyle: 'bold', resolution: 2 })
        .setOrigin(0.5).setDepth(71);
      this.tweens.add({ targets: txt, y: t.y - 80, alpha: 0, duration: 600, ease: 'Quad.easeOut', onComplete: () => txt.destroy() });
    }
    if (res.killed) this.onMobKilled(t);
  }

  _laserBeam(x1, y1, x2, y2, color, alpha, width = 3) {
    const g = this.add.graphics().setDepth(65);
    g.lineStyle(width, color, alpha);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.strokePath();
    this.tweens.add({ targets: g, alpha: 0, duration: 160, ease: 'Expo.easeOut', onComplete: () => g.destroy() });
  }
  fireMobWeapon(mob, tx, ty, victim = this.player) {
    // Самонаводящийся болт: обычные мобы 90°/сек, боссы 180°/сек
    const turnRate = mob.isBoss
      ? (180 * Math.PI / 180)
      : (90  * Math.PI / 180);
    this.projectiles.push(new Projectile(this, 'mob', mob.x, mob.y, tx, ty, victim, mob.damage, 0.05, PROJECTILE.mobColor, turnRate));
    this.muzzleFlash(mob.x, mob.y, 0xff8a7a);
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
      if (res.killed) this.onMobKilled(m);
    } else {
      const hx = proj.victim?.x ?? this.player.x;
      const hy = proj.victim?.y ?? this.player.y;
      if (res?.dodged) { this.showDodge(hx, hy); return; }
      const toHull = (res?.hullHit || 0) > 0;
      this.hitFlash(hx, hy, toHull);
      if (toHull) this.vfx?.play('hull_hit', hx, hy, { scale: 0.15, depth: 67 });
      this.showDamage(hx, hy, res);
      if (proj.victim === this.player) {
        if (res.brokeShield) this.log(i18n.t('log.shield_down'));
        if (!this.player.alive) this.onPlayerKilled();
      }
    }
  }
  onMobKilled(mob) {
    this.explosion(mob.x, mob.y, mob.isBoss ? 1.6 : 0.6);
    const name = i18n.t(mob.tpl.nameKey); const lvl = `${i18n.t('mob.level')}${mob.level}`;
    const lvlScale = 1 + 0.5 * (mob.level - 1); const credits = Math.round(mob.tpl.credits * lvlScale); const xp = Math.round(mob.tpl.xp * lvlScale);
    this.log(i18n.t('log.killed', { name, lvl })); this.log(i18n.t('log.reward', { credits, xp }));
    this.credits = (this.credits || 0) + credits; this.gainXp(xp);
    if (this.target === mob) {
      this.target = null; this.isFiring = false;
      if (this._targetFx?.active) { this.vfx?.stopLoop(this._targetFx); this._targetFx = null; }
    }
    const sg = rollStarGold(mob); if (sg > 0) { this.starGold = (this.starGold || 0) + sg; this.log(i18n.t('log.stargold', { amount: sg })); }
    if (Phaser.Math.FloatBetween(0, 1) < dropChance(mob)) {
      const lootItem = mob.tpl.key === 'bigboss' ? rollApophisLoot() : rollLootForMob(mob);
      this.loot.push(new Loot(this, mob.x, mob.y, lootItem));
    }
    if (!mob.noRespawn) {
      this.time.delayedCall(RESPAWN_MS, () => { if (!mob.alive) { mob.respawn(); this.log(i18n.t('log.respawn', { name, lvl })); } });
    }
    // Mission hooks
    if (mob.tpl.key.startsWith('pirate')) this.advanceMission('daily_patrol', 0);
    if (mob.isBoss && galaxy.current === 'R-1-boss') {
      this.advanceMission('story_signal', 1);
      this.advanceMission('story_signal', 2);
    }
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

    // Hull scales to journey: wave 1 (20%→50% window) should kill unprotected transport.
    // wave1 = [pirate_03, pirate_04]; DPS = damage × fireRate for each
    const wave1Dps = [MOBS.pirate_03, MOBS.pirate_04]
      .reduce((s, m) => s + m.damage * m.fireRate, 0);
    const journeyDist = Phaser.Math.Distance.Between(spawnX, spawnY, destX, destY);
    const hull = Math.max(200,
      Math.round(wave1Dps * (ESCORT_WAVE_AT[1] - ESCORT_WAVE_AT[0]) * (journeyDist / ESCORT_SPEED) * 1.1)
    );
    this.escortTransport = new EscortTransport(this, spawnX, spawnY, destX, destY, hull);
    this._escortMobs = [];
    // Ensure obj0 ("arrived in sector") is marked whether player jumped or was already here
    this.advanceMission('daily_escort', 0);
    this.log('Транспорт ждёт сопровождения — подлети к нему, чтобы начать.');
  }

  _spawnEscortWave(tx, ty, waveIdx) {
    const WAVES = [
      ['pirate_03', 'pirate_04'],
      ['pirate_04', 'pirate_05', 'pirate_04'],
      ['pirate_05', 'pirate_06', 'pirate_05'],
    ];
    const keys = WAVES[waveIdx] ?? WAVES[0];
    for (let i = 0; i < keys.length; i++) {
      const angle = (Math.PI * 2 / keys.length) * i;
      const spawnX = tx + Math.cos(angle) * 380;
      const spawnY = ty + Math.sin(angle) * 380;
      const mob = new Mob(this, MOBS[keys[i]], this.pilotLevel ?? 1, spawnX, spawnY, {});
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
  onPlayerKilled() {
    if (this.playerRespawning) return;
    this.playerRespawning = true;
    this.jumping = false;
    const deathX = this.player.x, deathY = this.player.y;
    this.explosion(deathX, deathY, 1.1);
    this.log(i18n.t('log.you_died'));
    // Lose 5% of plasmate on death
    const totalP = totalPlasmateInInventory(this.inventory);
    if (totalP > 0) {
      const loss = Math.max(1, Math.floor(totalP * 0.05));
      removePlasmateFromInventory(this.inventory, loss);
      this.log(i18n.t('log.plasmate_lost', { amount: loss }));
    }
    this.target = null;
    this.time.delayedCall(2000, () => this._showRepairDialog(deathX, deathY));
  }
  _showRepairDialog(deathX, deathY) {
    const REPAIR_COST = {
      wisp:     { credits: 0,       stars: 0 },
      stiletto: { credits: 50000,   stars: 0 },
      anvil:    { credits: 100000,  stars: 0 },
      phantom:  { credits: 150000,  stars: 0 },
      drover:   { credits: 150000,  stars: 0 },
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

    const sec   = SECTORS[galaxy.current];
    const isPvp = sec?.pvp === true;
    const corpPos = isPvp ? this.homeBasePositions?.[this.playerCorp] : null;
    const baseX = corpPos ? corpPos.x : this.worldWidth / 2;
    const baseY = corpPos ? corpPos.y : this.worldHeight / 2 - 40;

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
        btn.on('pointerdown', onConfirm);
      }
      allObjs.push(cg, t1, t2, t3, btn, btnLbl);
    };

    const finishRespawn = (rx, ry, fullHull, cr, st) => {
      if (st > 0)      this.starGold = (this.starGold || 0) - st;
      else if (cr > 0) this.credits  = (this.credits  || 0) - cr;
      destroyAll();
      this.player.respawn(rx, ry);
      if (!fullHull) this.player.hull = Math.round(this.player.maxHull * 0.5);
      this.playerRespawning = false;
      this._spawnEngineFx();
    };

    makeCard(W / 2 - 130, 'К БАЗЕ', '100% прочности', costStr(baseCr, baseSt), canBase,
      () => finishRespawn(baseX, baseY, true, baseCr, baseSt));
    makeCard(W / 2 + 130, 'НА МЕСТЕ', '50% прочности', costStr(spotCr, spotSt), canSpot,
      () => finishRespawn(deathX, deathY, false, spotCr, spotSt));
  }
  showDamage(x, y, res) {
    const total = Math.round((res.shieldHit || 0) + (res.hullHit || 0)); if (total <= 0) return;
    const toHull = (res.hullHit || 0) > 0;
    const txt = this.add.text(x + Phaser.Math.Between(-12, 12), y - 20, `-${total}`, { fontFamily: 'Orbitron', fontSize: toHull ? '20px' : '16px', color: toHull ? '#ef5350' : '#4dd0e1', fontStyle: 'bold', resolution: UI_RES, }).setOrigin(0.5).setDepth(70);
    this.tweens.add({ targets: txt, y: y - 60, alpha: 0, duration: 700, ease: 'Quad.easeOut', onComplete: () => txt.destroy() });
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
          this.player.fireCooldown = time + 1000 / this.player.weaponFireRate; 
          this.player.lastAttackAt = time; 
        }
      }
    }
    
    this.player.update(dt, inSafe, faceAngle);
    if (this.steering && this.player.alive && !this.jumping) {
      const wpt = this.cameras.main.getWorldPoint(this.input.activePointer.x, this.input.activePointer.y);
      this.movement.setWaypoint(wpt.x, wpt.y, false);
    }
    if (!this.jumping) this.movement.update(dt, inSafe);
    this.mobs.forEach((m) => {
      const tgt = (m.escortTarget?.alive) ? m.escortTarget : this.player;
      const victim = (m.escortTarget?.alive) ? this.escortTransport : this.player;
      m.update(dt, tgt, tgt === this.player && inSafe, (mob, tx, ty) => this.fireMobWeapon(mob, tx, ty, victim));
      if (m.requestAoe) { this.spawnBossAoe(m, this.player.x, this.player.y); m.requestAoe = false; }
    });
    this.updateAoe();
    

    this.miningBases.forEach(b => b.update(dt));
    this.homeBases.forEach(b => b.update(dt));
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    this.projectiles.forEach((p) => p.update(dt));
    this.updateLoot(dt); this.updateGates(dt);
    const now2 = this.time.now;
    this.plasmateDeposits.forEach(d => d.update(now2));
    if (this.pendingGate && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.pendingGate.x, this.pendingGate.y) < 60) { this.pendingGate = null; }
    this.argusCtrl?.update(dt);
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
        if (target.isPlasmate) {
          this._collectPlasmateDeposit(target);
          this.cancelCollect();
        } else {
          if (this.inventory.length >= this._cargoMax()) {
            this.log(i18n.t('log.cargo_full'));
            this.cancelCollect();
          } else {
            const item = target.item;
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
  createBoostFx() {
    this.boostEmitter = this.add.particles(0, 0, 'glow', {
      lifespan: 400, speed: { min: 50, max: 150 }, scale: { start: 0.4, end: 0 }, alpha: { start: 0.6, end: 0 },
      tint: COLORS.amber, blendMode: 'ADD', frequency: -1, rotate: { min: 0, max: 360 }
    }).setDepth(49);
  }

  createDungeonWalls() {
    const sec = SECTORS[galaxy.current];
    if (!sec.isDungeon) return;

    this.walls = this.physics.add.staticGroup();
    const g = this.add.graphics().setDepth(1);
    const cx = this.worldWidth / 2, cy = this.worldHeight / 2;

    const addWall = (x, y, w, h) => {
      // 1. Проверка близости к спавну (центру) — должен быть всегда свободен
      if (Phaser.Math.Distance.Between(x, y, cx, cy) < 650) return;

      // 2. Проверка близости к джампгейтам — стены не должны их перекрывать
      if (this.gates) {
        for (const gate of this.gates) {
          if (Phaser.Math.Distance.Between(x, y, gate.x, gate.y) < 650) return;
        }
      }

      const wall = this.add.rectangle(x, y, w, h, 0x000000, 0); 
      this.physics.add.existing(wall, true);
      this.walls.add(wall);
      
      g.lineStyle(2, 0x4dd0e1, 0.7);
      g.strokeRect(x - w/2, y - h/2, w, h);
      g.fillStyle(0x0d47a1, 0.25);
      g.fillRect(x - w/2, y - h/2, w, h);
      
      g.lineStyle(1, 0x4dd0e1, 0.15);
      const step = 60;
      for(let i=step; i<w; i+=step) g.lineBetween(x - w/2 + i, y - h/2, x - w/2 + i, y + h/2);
      for(let j=step; j<h; j+=step) g.lineBetween(x - w/2, y - h/2 + j, x + w/2, y - h/2 + j);
    };

    if (galaxy.current === 'dungeon_1') {
      // D1: "Разорванная спираль"
      for (let i = 1; i <= 4; i++) {
        const s = i * 500;
        addWall(cx + 300, cy - s, s, 100);
        addWall(cx - 300, cy + s, s, 100);
        addWall(cx - s, cy - 300, 100, s);
        addWall(cx + s, cy + 300, 100, s);
      }
    } else if (galaxy.current === 'dungeon_2') {
      // D2: "Шахматные блоки"
      for (let x = -2000; x <= 2000; x += 600) {
        for (let y = -1200; y <= 1200; y += 600) {
          if ((x + y) % 1200 === 0) addWall(cx + x, cy + y, 350, 350);
        }
      }
    } else if (galaxy.current === 'dungeon_3') {
      // D3: "Зигзаг-линии"
      for (let i = -2000; i <= 2000; i += 500) {
        const ox = i % 1000 === 0 ? 400 : -400;
        addWall(cx + i, cy + ox, 150, 800);
      }
    } else if (galaxy.current === 'dungeon_4') {
      // D4: "Обломки" — seed из имени сектора, раскладка одинакова при каждом входе
      const rnd4 = new Phaser.Math.RandomDataGenerator([galaxy.current]);
      for (let i = 0; i < 25; i++) {
        const rx = rnd4.between(-2800, 2800);
        const ry = rnd4.between(-1600, 1600);
        addWall(cx + rx, cy + ry, rnd4.between(200, 500), rnd4.between(100, 300));
      }
    } else if (galaxy.current === 'dungeon_5' || galaxy.current === 'R-1-boss') {
      // D5 & Boss: "Арена с колоннами"
      const sz = 2000;
      const pts = [[sz, sz], [-sz, sz], [sz, -sz], [-sz, -sz], [sz, 0], [-sz, 0], [0, sz], [0, -sz]];
      pts.forEach(p => addWall(cx + p[0], cy + p[1], 400, 400));
    }
    
    this.physics.add.collider(this.player.sprite, this.walls);
    this.mobs.forEach(m => this.physics.add.collider(m.sprite, this.walls));
  }

  shutdown() {
    this._prevSector = galaxy.current;
    this._saveState();
    this.escortTransport?.destroy();
    this.escortTransport = null;
    this._escortMobs = null;
    this.argusCtrl?.destroy();
    this.argusCtrl = null;
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
      respeckCount:        this.respeckCount        || 0,
      skillAchievementSP:  this.skillAchievementSP  || 0,
      currentSector:       galaxy.current,
      playerCorp:          this.playerCorp          || 'neutral',
      lootBySector:        this._serializeLoot(),
      missionState:        this.missionState        || {},
      missionDailyReset:   this.missionDailyReset   || 0,
      plasmateToday:       this.plasmateToday        || 0,
      plasmateDayReset:    this.plasmateDayReset      || 0,
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
    if (s.respeckCount       != null) this.respeckCount       = s.respeckCount;
    if (s.skillAchievementSP != null) this.skillAchievementSP = s.skillAchievementSP;
    if (s.currentSector != null && SECTORS[s.currentSector]) {
      const restoredSec = SECTORS[s.currentSector];
      if (s.currentSector === 'R-1-boss') {
        // Арена без базы: редирект на максимально доступный домашний сектор
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
  }

  _saveState() {
    if (!getToken()) return;
    apiPut('/player/state', this._serializeState()).catch(() => {});
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
