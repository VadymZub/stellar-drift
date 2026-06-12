import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, BASE_WORLD, PVP_WORLD_SCALE, PLAYER, MOBS, PROJECTILE, RESPAWN_MS, UI_RES, BOSS, DPR, HANDLING, ART_ANGLE_OFFSET } from '../constants.js';
import { minimapRect, minimapToWorld } from '../systems/minimap.js';
import { i18n } from '../i18n.js';
import Player from '../entities/Player.js';   
import Mob from '../entities/Mob.js';
import Projectile from '../entities/Projectile.js';
import Loot from '../entities/Loot.js';       
import Movement from '../systems/Movement.js';
import { EXP_CLASSES } from './BootScene.js'; 
import { rollLootForMob, dropChance, itemName, rollStarGold, starterCannon, starterShield } from '../items.js';
import { levelInfo, xpToNext, MAX_LEVEL } from '../leveling.js';
import { SHIP_BY_KEY } from '../ships.js';    
import { SECTORS, galaxy, neighbors, edgeDir, sectorAccess } from '../galaxy.js';
import { calculateRating, getRank } from '../ranking.js';
import VFXManager from '../systems/VFXManager.js';

const PICKUP_RADIUS = 95;
const PICKUP_TIME = 2000;

const DEV_MODE = true;
const MOCK_CORP_RATINGS = [0.95, 0.92, 0.88, 0.85, 0.82, 0.78, 0.75, 0.72, 0.68, 0.65, 0.62, 0.58, 0.55, 0.52, 0.48];

export default class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }       

  create(data) {
    const sec = SECTORS[galaxy.current];
    const isPvp = sec.pvp === true;
    const scale = isPvp ? PVP_WORLD_SCALE : 1.0;
    
    this.worldWidth = BASE_WORLD.width * scale;
    this.worldHeight = BASE_WORLD.height * scale;
    this.safeZoneRadius = BASE_WORLD.safeZoneRadius;
    this.objScale = isPvp ? 0.7 : 1.0; // Масштабирование объектов для PvP-карт

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
    const startX = data?.startX ?? cx;
    const startY = data?.startY ?? (cy - 40);
    this.player = new Player(this, startX, startY, this.objScale);
    this.movement = new Movement(this, this.player);

    this.cameras.main.startFollow(this.player.sprite, false, 0.15, 0.15);
    this.cameras.main.setZoom(DPR);   
    this.cameras.main.roundPixels = false;    

    this.reticle = this.add.graphics().setDepth(45);
    this.target = null;
    this.isFiring = false; 

    this.mobs = [];
    this.projectiles = [];
    this.loot = [];
    this.inventory = [];
    this.credits  = this.credits  ?? (DEV_MODE ? 3000000 : 0);
    this.starGold = this.starGold ?? (DEV_MODE ? 20000   : 0);

    this.ownedShips = this.ownedShips || new Set(['wisp']);
    this.activeShip = this.activeShip || 'wisp';
    
    if (DEV_MODE) {
      this.input.keyboard.on('keydown-EIGHT', () => {
        this.ownedShips.add('argus');
        this.activeShip = 'argus';
        const maxCannon = { type: 'cannon', tier: 4, damage: 210, penetration: 0.20, fireRate: 1.0, starLvl: 5 };
        const maxShield = { type: 'shield', tier: 4, durability: 1500, regen: 100, evasion: 0.10, starLvl: 5 };
        const maxEngine = { type: 'engine', tier: 4, speed: 80, starLvl: 5 };
        this.equipped.weapon = Array(10).fill(null).map(() => ({...maxCannon}));
        this.equipped.shield = Array(10).fill(null).map(() => ({...maxShield}));
        this.equipped.engine = Array(10).fill(null).map(() => ({...maxEngine}));
        this.player.applyShip(SHIP_BY_KEY['argus']);
        this.player.hull = this.player.maxHull;
        this.player.shield = this.player.maxShield;
        this.log('DEV: Argus Activated');
      });
    }

    this.shipLevels = this.shipLevels || {};
    this.pilotXp = this.pilotXp || 1829100;
    this.pilotHonor = this.pilotHonor ?? (DEV_MODE ? 420500 : 0);
    this.pilotLevel = levelInfo(this.pilotXp).level;

    const playerRating = calculateRating(this.pilotXp, this.pilotHonor);
    const ratings = MOCK_CORP_RATINGS.includes(playerRating)
      ? MOCK_CORP_RATINGS
      : [...MOCK_CORP_RATINGS, playerRating].sort((a, b) => b - a);
    this.pilotRank = getRank(playerRating, ratings);

    this.corpRep = this.corpRep ?? 1;
    this.seasonWon = this.seasonWon ?? true;
    this.garageTab = this.garageTab || 'ships';

    if (this.activeShip !== 'wisp' && SHIP_BY_KEY[this.activeShip]) {
      this.player.applyShip(SHIP_BY_KEY[this.activeShip]);
      this.player.hull = this.player.maxHull; this.player.shield = this.player.maxShield;   
    }

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
    this.createJumpgates();
    this.createDungeonWalls();
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
    this._targetFx = null;

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

  createBaseAndSafeZone() {
    const sec = SECTORS[galaxy.current];
    if (sec.isDungeon) return; // В данжах нет безопасных зон

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
        basePoints = [[-1000, -800], [1000, 800]]; // 2 базы по диагонали
      } else if (pvpLvl === 2 || pvpLvl === 3) {
        basePoints = [[-1400, -1000], [0, 0], [1400, 1000]]; // 3 базы в ряд по диагонали
      } else {
        // 4 базы квадратом
        const d = 1500;
        basePoints = [[-d, -d], [d, -d], [d, d], [-d, d]];
      }

      const bases = basePoints.map(p => {
        const b = add('mining_base', Lmax, p[0], p[1], { behavior: 'guard', patrolRadius: 0 });
        this.add.circle(b.x, b.y, 160, 0x4dd0e1, 0.05).setDepth(-5);
        this.add.text(b.x, b.y - 180, "MINING STATION", { fontFamily: 'Orbitron', fontSize: '20px', color: '#4dd0e1' }).setOrigin(0.5).setDepth(5);
        return b;
      });
      
      const baseTargets = bases.map(b => ({ x: b.x, y: b.y }));

      if (pvpLvl === 1) {
        // PvP 1: 3 дрона курсируют между базами (стаей)
        const leader = add('sec_drone', Lmax, rnd(-1500, 1500), rnd(-1000, 1000), { behavior: 'roam', targets: baseTargets });
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
          const b = bases[i % bases.length];
          // Патрули теперь ROAM (курсируют между всеми базами), но стартуют у баз
          const dest = add('sec_destroyer', Lmax, b.spawnX - cx + rnd(-200, 200), b.spawnY - cy + rnd(-200, 200), { behavior: 'roam', targets: baseTargets });
          for (let j = 0; j < config.dronesPerDest; j++) {
            add('sec_drone', Lmax, dest.spawnX - cx + rnd(-100, 100), dest.spawnY - cy + rnd(-100, 100), { leader: dest });
          }
        }
      }
      return;
    }

    if (galaxy.current === 'R-1-boss') {
      // Специальный спавн для босс-уровня Алгол: Зов Апофиса
      const ring = [[600, 600], [-600, 600], [600, -600], [-600, -600]];
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
      const pts = [[800, 800], [-800, 800], [800, -800], [-800, -800], [0, 1500], [0, -1500], [1800, 0], [-1800, 0]];
      pts.forEach((o, i) => add(pool[i % pool.length], rnd(Lmin, Lmax), o[0], o[1], { patrolRadius: 400 }));
      // Босс в центре (где обычно база)
      add(boss, Lmax, 0, 0, { behavior: 'guard', patrolRadius: 300, leash: 900 });
    } else {
      const ring = [[1000, -300], [-1100, 400], [400, 1050], [-850, -700], [1500, 520], [-1500, -150]];
      ring.forEach((o, i) => add(pool[i % pool.length], rnd(Lmin, Lmax), o[0], o[1]));        
      const gx = 1500, gy = 950;
      add(boss, Lmax, gx, gy, { behavior: 'guard', patrolRadius: 180, leash: 480 });
      for (const [ox, oy] of [[-240, -130], [250, -90], [-110, 250]]) {
        add(pool[0], rnd(Lmin, Lmax), gx + ox, gy + oy, { patrolRadius: 150, leash: 520 });   
      }
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
      if (this.scene.isActive('GarageScene') || this.scene.isActive('InventoryScene') || this.scene.isActive('MapScene')) return;
      
      const wpt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const wx = wpt.x, wy = wpt.y;
      const mob = this.mobAt(wx, wy);

      const now = this.time.now;
      if (mob && (now - lastClickTime < 350)) {
        this.selectTarget(mob);
        this.isFiring = true;
        this.log("ATTACK: " + i18n.t(mob.tpl.nameKey));
        lastClickTime = 0;
        return;
      }
      lastClickTime = now;

      const mr = minimapRect(this);
      if (pointer.x >= mr.x && pointer.x <= mr.x + mr.w && pointer.y >= mr.y && pointer.y <= mr.y + mr.h) {
        const wp = minimapToWorld(pointer.x, pointer.y, mr, this.worldWidth, this.worldHeight);
        this.cancelCollect(); this.selectTarget(null);
        if (this.player.alive && !this.jumping) this.movement.setWaypoint(wp.x, wp.y, true);
        return;
      }
      
      if (this.movement.isOverBoostChevron(wx, wy)) { this.movement.toggleBoost(); return; }
      const gate = this.gateAt(wx, wy);
      if (gate) {
        this.cancelCollect(); this.selectTarget(null); this.pendingGate = gate; this.steering = false;
        if (this.player.alive && !this.jumping) this.movement.setWaypoint(gate.x, gate.y, false);
        return;
      }
      const box = this.lootAt(wx, wy);
      if (box) {
        this.cancelCollect();
        this.collectTarget = box; 
        this.collectTimer = 0;
        if (this.player.alive && !this.jumping) {
          // Подлетаем НЕ в центр, а чуть выше (на 85px), чтобы не перекрывать спрайтом
          this.movement.setWaypoint(box.x, box.y - 85, false);
        }
        return;
      }
      
      if (mob) { this.cancelCollect(); this.selectTarget(mob); return; }
      if (this.player.alive && !this.jumping) { this.cancelCollect(); this.steering = true; this.movement.setWaypoint(wx, wy, false); this.pingAt(wx, wy); }
    });

    this.input.on('pointerup', () => { this.steering = false; });
    this.input.keyboard.addCapture('TAB,ESC,I,G,M,J,CTRL');
    
    this.input.keyboard.on('keydown-TAB', (e) => { e.preventDefault(); this.cycleTarget(); });
    this.input.keyboard.on('keydown-ESC', () => {
      this.selectTarget(null);
      this.isFiring = false;
      for (const o of ['GarageScene', 'InventoryScene', 'MapScene', 'MissionsScene', 'ShopScene', 'CorpScene']) {
        if (this.scene.isActive(o)) this.scene.stop(o);
      }
    });
    this.input.keyboard.on('keydown-I', () => this.toggleOverlay('InventoryScene'));
    this.input.keyboard.on('keydown-G', () => { this.player.waypoint = null; this.cancelCollect(); this.toggleOverlay('GarageScene'); });
    this.input.keyboard.on('keydown-M', () => { this.player.waypoint = null; this.cancelCollect(); this.toggleOverlay('MapScene'); });
    this.input.keyboard.on('keydown-O', () => { this.player.waypoint = null; this.cancelCollect(); this.toggleOverlay('MissionsScene'); });
    this.input.keyboard.on('keydown-P', () => { this.player.waypoint = null; this.cancelCollect(); this.toggleOverlay('ShopScene'); });
    this.input.keyboard.on('keydown-H', () => { this.player.waypoint = null; this.cancelCollect(); this.toggleOverlay('CorpScene', { corp: 'helios' }); });
    
    this.input.keyboard.on('keydown-CTRL', (e) => {
      e.preventDefault();
      if (this.target && this.target.alive) {
        this.isFiring = !this.isFiring;
        this.log(this.isFiring ? "FIRE ON" : "FIRE OFF");
      }
    });

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
        this.log('DEV: +1 000 000 кр, +500 ⭐');
      });
    }
  }

  gainXp(amount) {
    if (this.pilotLevel >= MAX_LEVEL || amount <= 0) return;
    this.pilotXp += amount;
    const newLevel = levelInfo(this.pilotXp).level;
    while (newLevel > this.pilotLevel && this.pilotLevel < MAX_LEVEL) {
      this.pilotLevel++;
      this.log(i18n.t('log.levelup', { lvl: this.pilotLevel }));
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
  cancelCollect() { this.collectTarget = null; this.collectTimer = 0; }
  toggleOverlay(key, data) {
    const overlays = ['GarageScene', 'InventoryScene', 'MapScene', 'MissionsScene', 'ShopScene', 'CorpScene'];
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
    const t = this.target, p = this.player;
    this.projectiles.push(new Projectile(this, 'player', p.x, p.y, t.x, t.y, t, p.weaponDamage, p.weaponPenetration, PROJECTILE.playerColor));
    this.muzzleFlash(p.x, p.y, 0x8fe6ff);
  }
  fireMobWeapon(mob, tx, ty) {
    this.projectiles.push(new Projectile(this, 'mob', mob.x, mob.y, tx, ty, this.player, mob.damage, 0.05, PROJECTILE.mobColor));
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
      const toHull = (res.hullHit || 0) > 0;
      this.hitFlash(m.x, m.y, toHull);
      if (toHull && this._onScreen(m.x, m.y)) this.vfx?.play('hull_hit', m.x, m.y, { scale: 0.15, depth: 67 });
      this.showDamage(m.x, m.y, res);
      if (res.killed) this.onMobKilled(m);
    } else {
      if (res.dodged) { this.showDodge(this.player.x, this.player.y); return; }
      const toHull = (res.hullHit || 0) > 0;
      this.hitFlash(this.player.x, this.player.y, toHull);
      if (toHull) this.vfx?.play('hull_hit', this.player.x, this.player.y, { scale: 0.15, depth: 67 });
      this.showDamage(this.player.x, this.player.y, res);
      if (res.brokeShield) this.log(i18n.t('log.shield_down'));
      if (!this.player.alive) this.onPlayerKilled();
    }
  }
  onMobKilled(mob) {
    this.explosion(mob.x, mob.y, mob.isBoss ? 1.6 : 0.6);
    const name = i18n.t(mob.tpl.nameKey); const lvl = `${i18n.t('mob.level')}${mob.level}`;
    const lvlScale = 1 + 0.5 * (mob.level - 1); const credits = Math.round(mob.tpl.credits * lvlScale); const xp = Math.round(mob.tpl.xp * lvlScale);
    this.log(i18n.t('log.killed', { name, lvl })); this.log(i18n.t('log.reward', { credits, xp }));
    this.credits = (this.credits || 0) + credits; this.gainXp(xp); if (this.target === mob) this.target = null;
    const sg = rollStarGold(mob); if (sg > 0) { this.starGold = (this.starGold || 0) + sg; this.log(i18n.t('log.stargold', { amount: sg })); }
    if (Phaser.Math.FloatBetween(0, 1) < dropChance(mob)) { this.loot.push(new Loot(this, mob.x, mob.y, rollLootForMob(mob))); }
    if (this._targetFx?.active && this.target === mob) { this.vfx?.stopLoop(this._targetFx); this._targetFx = null; }
    this.time.delayedCall(RESPAWN_MS, () => { if (!mob.alive) { mob.respawn(); this.log(i18n.t('log.respawn', { name, lvl })); } });
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
    this.explosion(this.player.x, this.player.y, 1.1);
    this.log(i18n.t('log.you_died'));
    this.target = null;
    this.time.delayedCall(3000, () => {
      this.player.respawn(this.worldWidth / 2, this.worldHeight / 2 - 40);
      this.playerRespawning = false;
      this._spawnEngineFx();
    });
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
      m.update(dt, this.player, inSafe, (mob, tx, ty) => this.fireMobWeapon(mob, tx, ty)); 
      if (m.requestAoe) { this.spawnBossAoe(m, this.player.x, this.player.y); m.requestAoe = false; } 
    });
    this.updateAoe();
    

    this.projectiles = this.projectiles.filter((p) => !p.dead); 
    this.projectiles.forEach((p) => p.update(dt));
    this.updateLoot(dt); this.updateGates(dt);
    if (this.pendingGate && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.pendingGate.x, this.pendingGate.y) < 60) { this.pendingGate = null; }
  }
  updateLoot(dt) {
    this.collectGfx.clear();
    const target = this.collectTarget;
    if (!target || !this.player.alive) return;

    if (!target.alive) { this.cancelCollect(); return; }

    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, target.x, target.y);
    
    // Начинаем сбор только если мы в радиусе. Если далеко — просто ждем прибытия.
    if (dist <= PICKUP_RADIUS + 10) {
      this.collectTimer += dt * 1000;
      const frac = Math.min(1, this.collectTimer / PICKUP_TIME);
      
      this.collectGfx.lineStyle(3, COLORS.primary, 0.8);
      this.collectGfx.strokeCircle(target.x, target.y, 45 * (1 - frac));
      
      if (frac >= 1) {
        const item = target.item; 
        this.inventory.push(item); 
        this.log(i18n.t('log.loot_pickup', { item: itemName(item) }));
        target.collect(); 
        this.cancelCollect();
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
}
