import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';

// Single plasmate crystal — 1 unit. Respawns at a random new position within zone.
export default class PlasmateDeposit {
  constructor(scene, x, y, amount, zone, respawnMs = 10 * 60 * 1000) {
    this.scene     = scene;
    this.amount    = amount;
    this.zone      = zone;   // { xMin, xMax, yMin, yMax } for respawn range
    this.respawnMs = respawnMs;
    this.alive     = true;
    this.isPlasmate = true;
    this.respawnAt  = 0;
    this._build(x, y);
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  _build(x, y) {
    this.sprite = this.scene.add.image(x, y, 'plasmate_deposit')
      .setDepth(36).setDisplaySize(28, 28).setBlendMode(Phaser.BlendModes.ADD);
  }

  collect() {
    this.alive = false;
    this.sprite.setVisible(false);
    this.respawnAt = this.scene.time.now + this.respawnMs;
  }

  update(now) {
    if (!this.alive) {
      if (this.respawnAt > 0 && now >= this.respawnAt) this._respawn();
      return;
    }
    this.sprite.alpha = 0.55 + Math.sin(now * 0.003) * 0.45;
    this.sprite.rotation = now * 0.0006;
  }

  _respawn() {
    const nx = Phaser.Math.Between(this.zone.xMin, this.zone.xMax);
    const ny = Phaser.Math.Between(this.zone.yMin, this.zone.yMax);
    this.sprite.setPosition(nx, ny).setVisible(true);
    this.alive = true;
    this.respawnAt = 0;
  }

  destroy() {
    this.sprite.destroy();
  }
}
