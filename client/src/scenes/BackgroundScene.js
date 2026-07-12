import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { SECTORS, galaxy } from '../galaxy.js';
import { loadSettings } from '../settings.js';

// Фон сектора в ОТДЕЛЬНОЙ сцене БЕЗ зума (под GameScene). Так карта рисуется 1:1 к экрану
// (cover-fit, аспект сохранён), не попадая под DPR-зум мир-камеры (иначе показывалась четверть).
// Сцена идёт в списке раньше GameScene → рендерится позади. Текстуру меняем при прыжке без рестарта.
export default class BackgroundScene extends Phaser.Scene {
  constructor() { super({ key: 'BackgroundScene', active: false }); }

  create() {
    this.cur = galaxy.current;
    this.img = this.add.image(0, 0, SECTORS[this.cur].map).setOrigin(0.5);
    this.fit();
    this.scale.on('resize', () => this.fit());
  }

  fit() {
    const W = this.scale.width, H = this.scale.height;
    // Use this.cur (the currently displayed sector), not galaxy.current which may be loading.
    const mapKey = SECTORS[this.cur]?.map;
    if (!mapKey || !this.textures.exists(mapKey)) return;
    const src = this.textures.get(mapKey).getSourceImage();
    const cover = Math.max(W / src.width, H / src.height) * 1.30;   // увеличенный запас под PvP-параллакс
    this.img.setDisplaySize(src.width * cover, src.height * cover).setPosition(W / 2, H / 2);
  }

  update() {
    const sec = SECTORS[galaxy.current];
    if (!sec) return;
    // Swap texture only when the new map is fully loaded (lazy-loaded during jump animation).
    if (this.cur !== galaxy.current && this.textures.exists(sec.map)) {
      this.cur = galaxy.current;
      this.img.setTexture(sec.map);
      this.fit();
    }
    // Плавный параллакс: центрируем смещение относительно центра мира, чтобы минимизировать выход за края.
    // Настройка "Параллакс фон" (SettingsScene → Графика) — раньше тумблер ничего не
    // проверял (единственный реально ВИДИМЫЙ параллакс-слой — не путать с bgNear в
    // GameScene, который тоже гейтится той же настройкой, но куда менее заметен).
    if (loadSettings().bgParallax === false) {
      this.img.setPosition(this.scale.width / 2, this.scale.height / 2);
      return;
    }
    const gs = this.scene.get('GameScene');
    const cam = gs.cameras && gs.cameras.main;
    if (cam && gs.worldWidth) {
      const dx = cam.scrollX - (gs.worldWidth / 2);
      const dy = cam.scrollY - (gs.worldHeight / 2);
      this.img.setPosition(this.scale.width / 2 - dx * 0.025, this.scale.height / 2 - dy * 0.025);
    }
  }
}
