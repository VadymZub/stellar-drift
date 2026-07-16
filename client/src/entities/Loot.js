// Коробка лута на месте смерти моба.
// tier: 'common' | 'boss' | 'legendary' | 'jackpot' | 'wagon'
import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { dungeonLootCollected } from '../api.js';

export default class Loot {
  constructor(scene, x, y, item, tier = 'common') {
    this.scene  = scene;
    this.item   = item;
    this.alive  = true;
    this.tier   = tier;
    this.baseX  = x;
    this.baseY  = y;

    // 'wagon' — трофей с вагона/головы бронепоезда (см. GameScene._onPvpLootSpawned).
    // ПЕРВАЯ правка (стальной сине-серый, обычный alpha-blend) — сливалась с фоном.
    // ВТОРАЯ (яркая маджента + ADD blend) — "слишком прозрачная": ADD складывает цвет
    // поверх фона вместо перекрытия, на ярком фоне выглядит блёкло/полупрозрачно, никогда
    // не даёт плотного "непрозрачного" вида. Обычный alpha-blend (как у остальных тиров),
    // просто с насыщенным цветом — плотная, непрозрачная коробка.
    const SIZE = { common: 34, boss: 42, legendary: 52, jackpot: 52, wagon: 48 };
    const TINT = { common: null, boss: 0xffb74d, legendary: 0xffd54f, jackpot: 0x00e5ff, wagon: 0xe000ff };
    const size = SIZE[tier] ?? 34;

    if (tier === 'legendary' || tier === 'jackpot' || tier === 'wagon') {
      this._ring = scene.add.graphics().setDepth(35);
    }

    this.sprite = scene.add.image(x, y, 'lootbox')
      .setDepth(36).setDisplaySize(size, size);

    const tint = TINT[tier];
    if (tint) this.sprite.setTint(tint);

    // Эффект дропа для ОТЛИЧНОЕ (statRoll ≥ 1.08) и ПЕРФЕКТ (statRoll = 1.15)
    const sr = item?.statRoll ?? 0;
    if (sr >= 1.08) this._spawnDropBurst(scene, x, y, sr >= 1.15);
  }

  _spawnDropBurst(scene, x, y, isPerfect) {
    const color  = isPerfect ? 0xffffff : 0xff9800;
    const rings  = isPerfect ? 5 : 3;
    const maxR   = isPerfect ? 90 : 60;
    if (isPerfect) scene.cameras?.main?.flash(160, 255, 230, 180, true);
    for (let i = 0; i < rings; i++) {
      const circle = scene.add.circle(x, y, 8 + i * 6, color, 0.75 - i * 0.1).setDepth(60);
      scene.tweens.add({
        targets: circle, scaleX: (maxR + i * 18) / (8 + i * 6),
        scaleY:  (maxR + i * 18) / (8 + i * 6),
        alpha: 0, duration: 450 + i * 100, delay: i * 70,
        ease: 'Quad.easeOut', onComplete: () => circle.destroy(),
      });
    }
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  update(now) {
    if (!this.alive) return;
    if (this._magnetPull) return; // magnet controls position

    if (this.tier === 'jackpot') {
      this.sprite.y = this.baseY + Math.sin(now * 0.007) * 5;
      this.sprite.rotation = Math.sin(now * 0.005) * 0.25;
    } else {
      this.sprite.y = this.baseY + Math.sin(now * 0.004) * 4;
      this.sprite.rotation = Math.sin(now * 0.002) * 0.2;
    }

    if (this._ring) {
      const sx = this.sprite.x, sy = this.sprite.y;
      if (this.tier === 'jackpot') {
        const t = now * 0.009;
        const r1 = 28 + 5 * Math.sin(t);
        const a1 = 0.65 + 0.3 * Math.sin(t);
        this._ring.clear();
        this._ring.lineStyle(3, 0x00e5ff, a1);
        this._ring.strokeCircle(sx, sy, r1);
        this._ring.lineStyle(1.5, 0xffffff, a1 * 0.45);
        this._ring.strokeCircle(sx, sy, r1 + 9);
        this._ring.lineStyle(1, 0x00e5ff, a1 * 0.25);
        this._ring.strokeCircle(sx, sy, r1 + 18);
      } else if (this.tier === 'wagon') {
        const t = now * 0.007;
        const r1 = 30 + 6 * Math.sin(t);
        const a1 = 0.7 + 0.3 * Math.sin(t);
        this._ring.clear();
        this._ring.lineStyle(3, 0xe000ff, a1);
        this._ring.strokeCircle(sx, sy, r1);
        this._ring.lineStyle(1.5, 0xffffff, a1 * 0.5);
        this._ring.strokeCircle(sx, sy, r1 + 9);
        this._ring.lineStyle(1, 0xe000ff, a1 * 0.3);
        this._ring.strokeCircle(sx, sy, r1 + 18);
      } else {
        const t = now * 0.004;
        const r1 = 30 + 4 * Math.sin(t);
        const a1 = 0.55 + 0.3 * Math.sin(t);
        this._ring.clear();
        this._ring.lineStyle(2.5, 0xffd54f, a1);
        this._ring.strokeCircle(sx, sy, r1);
        this._ring.lineStyle(1.5, 0xffa000, a1 * 0.45);
        this._ring.strokeCircle(sx, sy, r1 + 9);
      }
    }
  }

  collect() {
    this.alive = false;
    this._ring?.destroy();
    this.sprite.destroy();
    // Лут данж-инстанса — сообщаем серверу, что подобрано (иначе при следующем
    // входе тем же днём этот же предмет снова окажется на полу)
    if (this.dungeonLootId && this.scene?._dungeonRunId) {
      dungeonLootCollected(this.scene._dungeonRunId, this.dungeonLootId).catch(() => {});
    }
  }
}
