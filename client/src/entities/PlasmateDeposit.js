import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';

// Collectible plasmate crystal cluster. Respawns at a new position within zone after 10 min.
export default class PlasmateDeposit {
  constructor(scene, x, y, amount, zone) {
    this.scene  = scene;
    this.amount = amount;
    this.zone   = zone;   // { xMin, xMax, yMin, yMax } for respawn range
    this.alive  = true;
    this.isPlasmate = true;
    this.respawnAt  = 0;
    this._build(x, y);
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  _build(x, y) {
    this.sprite = this.scene.add.image(x, y, 'plasmate_deposit')
      .setDepth(36).setDisplaySize(46, 46).setBlendMode(Phaser.BlendModes.ADD);
    this.label = this.scene.add.text(x, y + 30, `${this.amount}`, {
      fontFamily: 'Orbitron', fontSize: '11px', color: '#88eeff', resolution: 2,
    }).setOrigin(0.5).setDepth(37);
  }

  collect() {
    this.alive = false;
    this.sprite.setVisible(false);
    this.label.setVisible(false);
    this.respawnAt = this.scene.time.now + 10 * 60 * 1000;
  }

  update(now) {
    if (!this.alive) {
      if (this.respawnAt > 0 && now >= this.respawnAt) this._respawn(now);
      return;
    }
    this.sprite.alpha = 0.65 + Math.sin(now * 0.0025) * 0.35;
    this.sprite.rotation = Math.sin(now * 0.0008) * 0.12;
  }

  _respawn(now) {
    const nx = Phaser.Math.Between(this.zone.xMin, this.zone.xMax);
    const ny = Phaser.Math.Between(this.zone.yMin, this.zone.yMax);
    this.sprite.setPosition(nx, ny).setVisible(true);
    this.label.setPosition(nx, ny + 30).setVisible(true);
    this.alive = true;
    this.respawnAt = 0;
  }

  destroy() {
    this.sprite.destroy();
    this.label.destroy();
  }
}
