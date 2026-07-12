import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { i18n } from '../i18n.js';
import { MOBS, DPR } from '../constants.js';
import { SHIPS } from '../ships.js';
import { SECTORS } from '../galaxy.js';
import { buildBitmapFont } from '../utils/buildBitmapFont.js';
import { prepShipTex, removeWhiteBg } from '../utils/prepShipTex.js';
import { PERK_DEFS } from '../perks.js';
import { SFX_KEYS } from '../systems/SoundManager.js';

// Классы взрывов (px нативного кадра). Стек 28 кадров на класс — из design/slice_explosion24.py,
// лежит в client/explosion24/<class>_sheet.png (игра берёт свежий стек оттуда).
export const EXP_CLASSES = [['micro', 32], ['small', 64], ['medium', 128], ['large', 192], ['huge', 288], ['mega', 448]];

export const MOD_ICON_FILES = {
  mod_plasma_t1: 'T1 Plasma Cannon.png', mod_plasma_t2: 'T2 Plasma Cannon.png',
  mod_plasma_t3: 'T3 Plasma Cannon.png', mod_plasma_t4: 'T4 Plasma Cannon.png',
  mod_shield_t1: 'T1 Shield Module.png', mod_shield_t2: 'T2 Shield Module.png',
  mod_shield_t3: 'T3 Shield Module.png', mod_shield_t4: 'T4 Shield Module.png',
  mod_engine_t1: 'T1 Engine.png',        mod_engine_t2: 'T2 Engine.png',
  mod_engine_t3: 'T3 Engine.png',        mod_engine_t4: 'T4 Engine.png',
  mod_armor_t1:  'T1 Armor Module.png',  mod_armor_t2:  'T2 Armor Module.png',
  mod_armor_t3:  'T3 Armor Module.png',  mod_armor_t4:  'T4 Armor Module.png',
  mod_laser:     'laser_cannon.png',
};

// Programmatically generate rank tier icons that have no source PNG.
// All drawn in white so Phaser tinting in Player.js applies the correct color.
function _genRankTier(scene, tier, size) {
  const key = `rank_tier${tier}`;
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, size, size);
  const ctx = tex.getContext();
  const s = size;
  ctx.fillStyle = '#ffffff';
  if (tier === 8) {
    // Single horizontal bar — classic enlisted bar insignia
    const bh = Math.max(3, Math.round(s * 0.14));
    ctx.fillRect(Math.round(s * 0.08), Math.round((s - bh) / 2), Math.round(s * 0.84), bh);
  } else if (tier === 9) {
    // Single pip (filled circle) — lowest rank insignia
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, Math.round(s * 0.20), 0, Math.PI * 2);
    ctx.fill();
  }
  tex.refresh();
}

// NPC portraits for MissionsScene — lazy-loaded from GameScene after boot.
export const NPC_PORTRAITS = [
  ['npc_corvus',   'Бригадир Корвус.png'],
  ['npc_lynx',     'Брокер Линкс.png'],
  ['npc_ancient',  'голос Древних.png'],
  ['npc_erixon',   'Доктор Эриксонpng.png'],
  ['npc_morgan',   'Капитан Морган.png'],
  ['npc_orion',    'Капитан Орион.png'],
  ['npc_artemis',  'Командор Артемис.png'],
  ['npc_terranov', 'Магнат Терранов.png'],
  ['npc_siren',    'Сирена.png'],
  ['npc_jakob',    'Старый Якоб.png'],
  ['npc_hazard',   'Хазард.png'],
];


export default class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  preload() {
    // Локаль (MVP — ru). Всё UI-текст идёт через i18n.t().
    this.load.json('locale-ru', 'locales/ru.json');

    // Карты секторов грузятся лениво: стартовая — в LoginScene/TestProfileScene,
    // следующая — в фоне во время jump-анимации (3s окно). Не грузим здесь.
    // Джапгейт: кольцо + вихрь (вихрь крутится в игре).
    this.load.image('jumpgate_ring', 'assets/structures/jumpgate_ring.png');
    this.load.image('jumpgate_vortex', 'assets/structures/jumpgate_vortex.png');

    // Корабли игрока — весь модельный ряд (витрина Гаража)
    for (const s of SHIPS) {
      this.load.image(s.key, `assets/ships/${s.key}.png`);
      if (s.garageKey) this.load.image(s.garageKey, `assets/ships/${s.garageKey}.png`); // геройский арт для Гаража
    }

    // Мобы (анимированные боссы — отдельным spritesheet, не одиночной картинкой)
    for (const m of Object.values(MOBS)) {
      if (m.anim) continue;
      this.load.image(m.key, `assets/mobs/${m.key}.png`);
    }
    this.load.image('npc_transport', 'assets/mobs/transport.png');
    // Апофис: кольца (тело ancient_12 грузится через mob loop как 'ancient_12')
    this.load.image('ring_apophis_outer',  'assets/mobs/ring_apophis_outer.png');
    this.load.image('ring_apophis_mid',    'assets/mobs/ring_apophis_mid.png');
    this.load.image('ring_apophis_inner',  'assets/mobs/ring_apophis_inner.png');
    this.load.image('corridor_chest',      'assets/mobs/corridor_chest.png');
    this.load.image('ancient_miniboss',    'assets/mobs/ancient_miniboss.png');

    // Боевые SFX (см. client/assets/sfx/sfx_prompts.md) — файлов может пока не
    // быть (звук генерируется отдельно); Phaser пропускает недостающие файлы,
    // не блокируя загрузку остального, SoundManager сам не проигрывает то, чего
    // нет в кэше — игра работает молча, без ошибок, до тех пор пока их не положат.
    for (const key of SFX_KEYS) this.load.audio(key, `assets/sfx/${key}.mp3`);

    // Иконки рангов (7 тиров)
    for (let t = 1; t <= 7; t++) this.load.image(`rank_tier${t}`, `assets/ranks/rank_tier${t}.png`);
    for (const c of ['helios', 'karax', 'tides']) this.load.image(`emblem_${c}`, `assets/corps/emblem_${c}.png`);

    // UI-стрелки движения
    this.load.image('arrow_waypoint', 'assets/ui/arrow_waypoint.png');
    this.load.image('arrow_cruise', 'assets/ui/arrow_cruise.png');
    this.load.image('arrow_boost', 'assets/ui/arrow_boost.png');
    // Иконки валют / ресурсов
    this.load.image('icon_credits',  'assets/ui/icon_credits.png');
    this.load.image('icon_gold',     'assets/ui/icon_gold.png');
    this.load.image('icon_honor',    'assets/ui/icon_honor.png');
    this.load.image('icon_corp_rep', 'assets/ui/icon_corp_rep.png');
    this.load.image('icon_premium',  'assets/ui/icon_premium.png');
    // Стрелка-активатор форсажа: анимация «переливания» (бегущий блик), 10 кадров 282×98.
    this.load.spritesheet('arrow_cruise_anim', 'assets/ui/arrow_cruise_anim.png', { frameWidth: 282, frameHeight: 98 });

    // Спрайт-листы взрывов: 6 классов размера, 28 кадров каждый (рост → распад → кольцо).
    for (const [name, px] of EXP_CLASSES) {
      this.load.spritesheet(`exp_${name}`, `explosion24/${name}_sheet.png`, { frameWidth: px, frameHeight: px });
    }

    // UI Backgrounds — only login needed at boot; others deferred to GameScene._bgPreloadDeferred()
    this.load.image('bg_login', 'assets/UI BACKGROUNDS/login_main_menu.jpg');

    // Loot and plasmate sprites
    this.load.image('lootbox',       'assets/modules/lootbox.png');
    this.load.image('plasmate_icon', 'assets/modules/plasmate_icon.png');

    // Consumables & materials icons
    for (const type of ['repair_pack','speed_boost','scanner_pulse','emergency_warp','biomech_core','quantum_crystal','plasma_coil','damage_booster','hull_booster','shield_booster','xp_booster'])
      this.load.image(`consumable_${type}`, `assets/consumables/${type}.png`);

    // Perk images, module icons, ammo icons, NPC portraits — deferred to GameScene._bgPreloadDeferred()

    // Mining base sprites
    for (const key of ['base_destroyed', 'base_building', 'base_helios', 'base_karax', 'base_tides', 'base_neutral']) {
      this.load.image(key, `assets/bases/${key}.png`);
    }
    // Home base sprites (corp HQ)
    for (const corp of ['helios', 'karax', 'tides']) {
      this.load.image(`home_base_${corp}`, `assets/bases/home_base_${corp}.png`);
    }
    for (const corp of ['helios', 'karax', 'tides', 'neutral']) {
      this.load.image(`cannon1_${corp}`, `assets/bases/cannon1_${corp}.png`);
      this.load.image(`cannon2_${corp}`, `assets/bases/cannon2_${corp}.png`);
    }

    // Skill tree icons (20 skills, 128×128)
    const SKILL_KEYS = [
      'sharpshooter', 'heavy_caliber', 'penetrating_rounds', 'overcharge_shot',
      'salvo', 'targeting_ai', 'berserker',
      'reinforced_hull', 'shield_optimizer', 'fast_regen', 'emergency_repair',
      'shield_burst', 'damage_resist', 'module_specialist',
      'loot_magnet', 'salvager', 'merchants_eye', 'scanner_boost',
      'cargo_expand', 'stealth_sprint',
    ];
    for (const k of SKILL_KEYS) this.load.image(`skill_${k}`, `assets/skills/${k}.png`);

    // Ship ability icons
    const SHIP_SKILL_KEYS = [
      'ship_helion_volley', 'ship_argosy_repair', 'ship_drifter_jump',
      'ship_stiletto_afterburner', 'ship_anvil_lockdown', 'ship_drover_scan',
      'ship_aegis_dome', 'ship_phantom_cloak', 'ship_wisp_recall',
    ];
    for (const k of SHIP_SKILL_KEYS) this.load.image(k, `assets/skills/${k}.png`);

    // VFX manifest — frame sizes read in create() to load sprite sheets
    this.load.json('vfx_manifest', 'assets/vfx/vfx_manifest.json');

    this.load.spritesheet('plasmate_crystal', 'assets/vfx/plasmate_crystal.png',
      { frameWidth: 256, frameHeight: 256 });

    // Assets previously deferred to GameScene._bgPreloadDeferred — moved here so all
    // HTTP requests fire in parallel during the boot loading screen, not during gameplay.
    for (const [key, file] of [
      ['bg_garage',      'garage.jpg'],
      ['bg_missions',    'missions.jpg'],
      ['bg_shop',        'shop.jpg'],
      ['bg_corp_helios', 'Corp_Hub_Helios.jpg'],
      ['bg_corp_karaks', 'Corp_Hub_Karaks.jpg'],
      ['bg_corp_tides',  'Corp_Hub_Tides.jpg'],
    ]) this.load.image(key, `assets/UI BACKGROUNDS/${file}`);

    for (const [key, file] of Object.entries(MOD_ICON_FILES))
      this.load.image(key, `assets/modules/${encodeURIComponent(file)}`);

    for (const type of ['ammo_plasma', 'ammo_plasma_elite', 'ammo_laser'])
      this.load.image(type, `assets/ammo/${type}.png`);

    for (const p of PERK_DEFS)
      this.load.image(p.key, `assets/perks/${encodeURIComponent(p.imgFile)}`);

    for (const [key, file] of NPC_PORTRAITS)
      this.load.image(key, `assets/npc/${encodeURIComponent(file)}`);
  }

  create() {
    i18n.setDict(this.cache.json.get('locale-ru'));

    // Pre-rasterize bitmap font atlases at UI_RES× oversampling.
    // Fonts are guaranteed loaded here (document.fonts.ready wraps Phaser init in main.js).
    buildBitmapFont(this, 'bmf_orb12',  'Orbitron', 12, '500');
    buildBitmapFont(this, 'bmf_inter12', 'Inter',   12, '600');

    // Процедурные текстуры, чтобы не тащить лишние ассеты в прототип:
    this.makeStarTexture('stars_far', 0.5, 90);
    this.makeStarTexture('stars_near', 1.0, 50);
    this.makeGlowTexture('glow', 18);      // мягкий круглый glow (шлейф, вспышки, additive)
    this.makeBoltTexture('bolt_sprite');   // вытянутая светящаяся капсула снаряда
    // lootbox and plasmate_icon loaded from assets/modules/ in preload()

    this.anims.create({
      key: 'plasmate_idle',
      frames: this.anims.generateFrameNumbers('plasmate_crystal', { start: 0, end: 20 }),
      frameRate: 12,
      repeat: -1,
    });

    // Анимации взрывов — все кадры листа (28), ~28 fps ≈ 1 сек на класс.
    for (const [name] of EXP_CLASSES) {
      this.anims.create({ key: `boom_${name}`, frames: this.anims.generateFrameNumbers(`exp_${name}`, { start: 0, end: -1 }), frameRate: 28 });
    }

    // Переливание cruise-стрелки (бесшовный цикл)
    this.anims.create({ key: 'cruise_flow', frames: this.anims.generateFrameNumbers('arrow_cruise_anim', { start: 0, end: 9 }), frameRate: 14, repeat: -1 });

    // Апофис теперь статичный спрайт (ancient_12) + вращающиеся кольца — анимация не нужна

    // Build the dedup map (fast — no canvas work), then queue all texture-prep jobs
    // to run across rAF frames (~14 ms budget each) so boot never freezes the screen.
    const _mobTexMax = new Map();
    for (const m of Object.values(MOBS)) {
      if (m.anim) continue;
      if ((m.displaySize ?? 0) > (_mobTexMax.get(m.key) ?? 0)) _mobTexMax.set(m.key, m.displaySize);
    }
    const _jobs = [
      // ×2 фиксированно (НЕ DPR) — пробовали привязать к реальному DPR вместо
      // максимума, чтобы сэкономить GPU-память на не-retina экранах, но вращающиеся
      // спрайты (heading меняется постоянно) заметно теряли резкость: точное
      // совпадение с физическим DPR без запаса недостаточно из-за передискретизации
      // при повороте под произвольным углом. Откачено — визуальное качество важнее.
      ...SHIPS.map(s => () => prepShipTex(this, s.key, s.displaySize * 2)),
      ...[..._mobTexMax].map(([k, ds]) => () => prepShipTex(this, k, ds * 2)),
      ...['drover_g', 'phantom_g', 'argosy_g', 'helion_g', 'drifter_g'].map(k => () => prepShipTex(this, k, 446)),
      ...Array.from({ length: 7 }, (_, i) => () => prepShipTex(this, `rank_tier${i + 1}`, 44)),
      () => _genRankTier(this, 8, 44), // horizontal bar — Матрос
      () => _genRankTier(this, 9, 44), // pip            — Кадет
      ...['helios', 'karax', 'tides'].map(c => () => prepShipTex(this, `emblem_${c}`, 36)),
      ...['sharpshooter','heavy_caliber','penetrating_rounds','overcharge_shot',
          'salvo','targeting_ai','berserker',
          'reinforced_hull','shield_optimizer','fast_regen','emergency_repair',
          'shield_burst','damage_resist','module_specialist',
          'loot_magnet','salvager','merchants_eye','scanner_boost',
          'cargo_expand','stealth_sprint'].map(k => () => prepShipTex(this, `skill_${k}`, 96)),
      ...['ship_helion_volley','ship_argosy_repair','ship_drifter_jump',
          'ship_stiletto_afterburner','ship_anvil_lockdown','ship_drover_scan',
          'ship_aegis_dome','ship_phantom_cloak','ship_wisp_recall'].map(k => () => prepShipTex(this, k, Math.round(104 * DPR))),
      () => prepShipTex(this, 'npc_transport', 240),
      () => prepShipTex(this, 'lootbox', 68),
      () => prepShipTex(this, 'plasmate_icon', 96),
      ...['ring_apophis_outer', 'ring_apophis_mid', 'ring_apophis_inner'].map(k => () => prepShipTex(this, k, 880)),
      // Previously-deferred assets — now loaded at boot
      ...Object.keys(MOD_ICON_FILES).map(k => () => prepShipTex(this, k, 96)),
      ...['ammo_plasma', 'ammo_plasma_elite', 'ammo_laser'].map(k => () => prepShipTex(this, k, 230)),
      ...PERK_DEFS.flatMap(p => [() => prepShipTex(this, p.key, 384), () => removeWhiteBg(this, p.key)]),
      ...NPC_PORTRAITS.map(([k]) => () => prepShipTex(this, k, 432)),
    ];
    this._runPrepJobs(_jobs);
  }

  _runPrepJobs(jobs) {
    const bar = document.getElementById('loading-bar');
    let i = 0;
    const tick = () => {
      const t0 = performance.now();
      while (i < jobs.length && performance.now() - t0 < 14) jobs[i++]();
      if (bar) bar.style.width = `${Math.round(i / jobs.length * 100)}%`;
      if (i < jobs.length) { requestAnimationFrame(tick); return; }
      this._finishCreate();
    };
    requestAnimationFrame(tick);
  }

  _finishCreate() {
    const LINEAR = 0;
    for (const s of SHIPS) {
      if (this.textures.exists(s.key)) this.textures.get(s.key).setFilter(LINEAR);
      if (s.garageKey && this.textures.exists(s.garageKey)) this.textures.get(s.garageKey).setFilter(LINEAR);
    }
    for (const m of Object.values(MOBS)) {
      if (!m.anim && this.textures.exists(m.key)) this.textures.get(m.key).setFilter(LINEAR);
    }
    document.getElementById('loading')?.remove();
    this._loadVFX();
  }

  _loadVFX() {
    const manifest = this.cache.json.get('vfx_manifest');
    if (!manifest) { this.scene.start('LoginScene'); return; }

    for (const [key, m] of Object.entries(manifest)) {
      this.load.spritesheet(key, m.sheet, { frameWidth: m.frameWidth, frameHeight: m.frameHeight });
    }
    this.load.once('complete', () => {
      for (const [key, m] of Object.entries(manifest)) {
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(key, { start: 0, end: m.frameCount - 1 }),
          frameRate: m.fps,
          repeat: 0,
        });
      }
      this.scene.start('LoginScene');
    });
    this.load.start();
  }

  // Тайл звёздного поля для параллакса
  makeStarTexture(key, scale, count) {
    const size = 512;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    for (let i = 0; i < count; i++) {
      const x = Phaser.Math.Between(0, size);
      const y = Phaser.Math.Between(0, size);
      const r = Phaser.Math.FloatBetween(0.5, 1.6) * scale;
      const a = Phaser.Math.FloatBetween(0.3, 1.0);
      g.fillStyle(0xffffff, a);
      g.fillCircle(x, y, r);
    }
    g.generateTexture(key, size, size);
    g.destroy();
  }

  // Коробка лута: янтарное ядро в cyan-рамке
  makeLootTexture(key) {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffb74d, 1); g.fillRoundedRect(5, 5, 30, 30, 6);
    g.fillStyle(0xffffff, 0.85); g.fillRect(13, 11, 14, 5);
    g.lineStyle(3, 0x4dd0e1, 1); g.strokeRoundedRect(5, 5, 30, 30, 6);
    g.generateTexture(key, 40, 40);
    g.destroy();
  }

  // Plasmate deposit — cyan-purple crystal cluster (map world sprite, additive blend)
  makePlasmateDepositTexture(key) {
    const S = 64, g = this.make.graphics({ x: 0, y: 0 }, false);
    const cx = S / 2, cy = S / 2;
    // Outer soft glow
    for (let i = 4; i >= 1; i--) {
      g.fillStyle(0x44aaff, 0.06 * i); g.fillCircle(cx, cy, 26 + i * 3);
    }
    // Crystal shards (3 jagged polygons)
    const shards = [
      [cx, cy - 20, cx + 10, cy - 4, cx + 4,  cy + 12, cx - 4,  cy + 6],
      [cx - 6, cy - 14, cx + 6, cy - 18, cx + 14, cy + 4,  cx,    cy + 8, cx - 10, cy],
      [cx - 14, cy - 4, cx - 4, cy - 16, cx + 4,  cy + 2,  cx - 6, cy + 14],
    ];
    const colors = [0x88eeff, 0xcc88ff, 0x44ccff];
    shards.forEach((pts, idx) => {
      g.fillStyle(colors[idx], 0.85);
      g.fillTriangle(pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]);
      if (pts.length > 6) g.fillTriangle(pts[0], pts[1], pts[4], pts[5], pts[6], pts[7]);
    });
    // Bright core
    g.fillStyle(0xffffff, 0.9); g.fillCircle(cx, cy, 5);
    g.fillStyle(0xaaddff, 0.7); g.fillCircle(cx, cy, 9);
    g.generateTexture(key, S, S);
    g.destroy();
  }

  // Plasmate cargo icon — canister with glowing crystal viewport
  makePlasmateIconTexture(key) {
    const S = 48, g = this.make.graphics({ x: 0, y: 0 }, false);
    // Dark metallic body
    g.fillStyle(0x1a2a3a, 1); g.fillRoundedRect(6, 4, 36, 40, 5);
    g.lineStyle(2, 0x4488aa, 1); g.strokeRoundedRect(6, 4, 36, 40, 5);
    // Accent stripe
    g.fillStyle(0xff8800, 0.7); g.fillRect(6, 15, 36, 4);
    // Crystal viewport
    for (let i = 3; i >= 1; i--) { g.fillStyle(0x44aaff, 0.12 * i); g.fillCircle(24, 30, 10 + i * 2); }
    g.fillStyle(0x88eeff, 0.85); g.fillCircle(24, 30, 9);
    g.fillStyle(0xcc99ff, 0.7);  g.fillTriangle(24, 24, 30, 34, 18, 34);
    g.fillStyle(0xffffff, 0.9);  g.fillCircle(22, 27, 3);
    g.generateTexture(key, S, S);
    g.destroy();
  }

  makeDotTexture(key, d, color) {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(color, 1);
    g.fillCircle(d, d, d);
    g.generateTexture(key, d * 2, d * 2);
    g.destroy();
  }

  // Мягкий круглый glow: слои от тусклого края к яркому центру (тинтуется в игре, additive).
  makeGlowTexture(key, r) {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const steps = 10;
    for (let i = 0; i < steps; i++) {
      const rr = r * (1 - i / steps);
      g.fillStyle(0xffffff, 0.08 + 0.09 * i);
      g.fillCircle(r, r, rr);
    }
    g.generateTexture(key, r * 2, r * 2);
    g.destroy();
  }

  // Плазма-болт: вытянутая капсула — мягкое гало + яркая сердцевина + лидирующий «носик».
  // Белая (тинтуется по владельцу), смотрит ВПРАВО (Projectile поворачивает по вектору полёта).
  makeBoltTexture(key) {
    const w = 48, h = 20, cy = h / 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 0.16); g.fillRoundedRect(2, 3, w - 4, h - 6, (h - 6) / 2);   // внешнее гало
    g.fillStyle(0xffffff, 0.45); g.fillRoundedRect(7, 6, w - 14, h - 12, (h - 12) / 2); // среднее свечение
    g.fillStyle(0xffffff, 1.0);  g.fillRoundedRect(11, cy - 3, w - 24, 6, 3);           // яркая сердцевина
    g.fillStyle(0xffffff, 1.0);  g.fillCircle(w - 9, cy, 5);                            // лидирующий носик
    g.generateTexture(key, w, h);
    g.destroy();
  }
}
