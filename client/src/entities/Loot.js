// Коробка лута на месте смерти моба. Хранит предмет; визуально покачивается.
export default class Loot {
  constructor(scene, x, y, item) {
    this.scene = scene;
    this.item = item;
    this.alive = true;
    this.sprite = scene.add.image(x, y, 'lootbox').setDepth(36).setDisplaySize(34, 34);
    this.baseX = x;
    this.baseY = y;
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  update(now) {
    if (!this.alive) return;
    this.sprite.y = this.baseY + Math.sin(now * 0.004) * 4;   // покачивание
    this.sprite.rotation = Math.sin(now * 0.002) * 0.2;
  }

  collect() { this.alive = false; this.sprite.destroy(); }
}
