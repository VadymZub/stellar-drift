import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { i18n } from '../i18n.js';
import { MOBS } from '../constants.js';
import { SHIPS } from '../ships.js';
import { SECTORS } from '../galaxy.js';

// Классы взрывов (px нативного кадра). Стек 28 кадров на класс — из design/slice_explosion24.py,
// лежит в client/explosion24/<class>_sheet.png (игра берёт свежий стек оттуда).
export const EXP_CLASSES = [['micro', 32], ['small', 64], ['medium', 128], ['large', 192], ['huge', 288], ['mega', 448]];

export default class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  preload() {
    // Локаль (MVP — ru). Всё UI-текст идёт через i18n.t().
    this.load.json('locale-ru', 'locales/ru.json');

    // Фоны секторов галактики (по графу) — текстура с ключом = имя карты.
    for (const s of Object.values(SECTORS)) this.load.image(s.map, `assets/maps/${s.map}.png`);
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
    // Большой босс (R1-тип): 6 кадров 306×419
    this.load.spritesheet('bigboss', 'assets/mobs/bigboss_sheet.png', { frameWidth: 306, frameHeight: 419 });

    // UI-стрелки движения
    this.load.image('arrow_waypoint', 'assets/ui/arrow_waypoint.png');
    this.load.image('arrow_cruise', 'assets/ui/arrow_cruise.png');
    this.load.image('arrow_boost', 'assets/ui/arrow_boost.png');
    // Стрелка-активатор форсажа: анимация «переливания» (бегущий блик), 10 кадров 282×98.
    this.load.spritesheet('arrow_cruise_anim', 'assets/ui/arrow_cruise_anim.png', { frameWidth: 282, frameHeight: 98 });

    // Спрайт-листы взрывов: 6 классов размера, 28 кадров каждый (рост → распад → кольцо).
    for (const [name, px] of EXP_CLASSES) {
      this.load.spritesheet(`exp_${name}`, `explosion24/${name}_sheet.png`, { frameWidth: px, frameHeight: px });
    }

    // UI Backgrounds
    this.load.image('bg_garage', 'assets/UI BACKGROUNDS/garage.png');
    this.load.image('bg_login', 'assets/UI BACKGROUNDS/login_main_menu.png');
    this.load.image('bg_missions', 'assets/UI BACKGROUNDS/missions.png');
    this.load.image('bg_shop', 'assets/UI BACKGROUNDS/shop.png');
    this.load.image('bg_corp_helios', 'assets/UI BACKGROUNDS/Corp_Hub_Helios.png');
    this.load.image('bg_corp_karaks', 'assets/UI BACKGROUNDS/Corp_Hub_Karaks.png');
    this.load.image('bg_corp_tides', 'assets/UI BACKGROUNDS/Corp_Hub_Tides.png');

    // VFX manifest — frame sizes read in create() to load sprite sheets
    this.load.json('vfx_manifest', 'assets/vfx/vfx_manifest.json');
  }

  create() {
    i18n.setDict(this.cache.json.get('locale-ru'));

    // Процедурные текстуры, чтобы не тащить лишние ассеты в прототип:
    this.makeStarTexture('stars_far', 0.5, 90);
    this.makeStarTexture('stars_near', 1.0, 50);
    this.makeGlowTexture('glow', 18);      // мягкий круглый glow (шлейф, вспышки, additive)
    this.makeBoltTexture('bolt_sprite');   // вытянутая светящаяся капсула снаряда
    this.makeLootTexture('lootbox');

    // Анимации взрывов — все кадры листа (28), ~28 fps ≈ 1 сек на класс.
    for (const [name] of EXP_CLASSES) {
      this.anims.create({ key: `boom_${name}`, frames: this.anims.generateFrameNumbers(`exp_${name}`, { start: 0, end: -1 }), frameRate: 28 });
    }

    // Переливание cruise-стрелки (бесшовный цикл)
    this.anims.create({ key: 'cruise_flow', frames: this.anims.generateFrameNumbers('arrow_cruise_anim', { start: 0, end: 9 }), frameRate: 14, repeat: -1 });

    // Большой босс: дыхание yoyo (6 кадров → 1→6→1), медленно и зловеще
    this.anims.create({ key: 'bigboss_idle', frames: this.anims.generateFrameNumbers('bigboss', { start: 0, end: 5 }), frameRate: 6, yoyo: true, repeat: -1 });

    const loading = document.getElementById('loading');
    if (loading) loading.remove();

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
