// Коробка лута на месте смерти моба.
// tier: 'common' | 'boss' | 'legendary'
export default class Loot {
  constructor(scene, x, y, item, tier = 'common') {
    this.scene  = scene;
    this.item   = item;
    this.alive  = true;
    this.tier   = tier;
    this.baseX  = x;
    this.baseY  = y;

    const SIZE = { common: 34, boss: 42, legendary: 52 };
    const TINT = { common: null, boss: 0xffb74d, legendary: 0xffd54f };
    const size = SIZE[tier] ?? 34;

    // Пульсирующее кольцо для legendary
    if (tier === 'legendary') {
      this._ring = scene.add.graphics().setDepth(35);
    }

    this.sprite = scene.add.image(x, y, 'lootbox')
      .setDepth(36).setDisplaySize(size, size);

    const tint = TINT[tier];
    if (tint) this.sprite.setTint(tint);
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  update(now) {
    if (!this.alive) return;
    this.sprite.y = this.baseY + Math.sin(now * 0.004) * 4;
    this.sprite.rotation = Math.sin(now * 0.002) * 0.2;

    if (this._ring) {
      const sx = this.sprite.x, sy = this.sprite.y;
      const t = now * 0.004;
      const r1 = 30 + 4 * Math.sin(t);
      const a1 = 0.55 + 0.3 * Math.sin(t);
      const r2 = r1 + 9;
      const a2 = a1 * 0.45;
      this._ring.clear();
      this._ring.lineStyle(2.5, 0xffd54f, a1);
      this._ring.strokeCircle(sx, sy, r1);
      this._ring.lineStyle(1.5, 0xffa000, a2);
      this._ring.strokeCircle(sx, sy, r2);
    }
  }

  collect() {
    this.alive = false;
    this._ring?.destroy();
    this.sprite.destroy();
  }
}
