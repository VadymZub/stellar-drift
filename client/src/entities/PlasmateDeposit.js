import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';

const TINTS = {
  biomech_fragment: 0xb39ddb,
  quantum_shard:    0x80ffff,
  plasma_strand:    0xff8c00,
};

// Single crystal deposit — plasmate or dungeon resource. Respawns within zone.
export default class PlasmateDeposit {
  constructor(scene, x, y, amount, zone, respawnMs = 10 * 60 * 1000, resourceType = 'plasmate') {
    this.scene            = scene;
    this.amount           = amount;
    this.zone             = zone;
    this.respawnMs        = respawnMs;
    this.alive            = true;
    this.resourceType     = resourceType;
    this.isPlasmate       = resourceType === 'plasmate';
    this.isDungeonResource = !this.isPlasmate;
    this.respawnAt        = 0;
    this._build(x, y);
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  _build(x, y) {
    this.sprite = this.scene.add.sprite(x, y, 'plasmate_crystal')
      .setDepth(36)
      .setDisplaySize(40, 40)
      .setBlendMode(Phaser.BlendModes.ADD)
      .play('plasmate_idle');
    this.sprite.anims.setProgress(Math.random());
    if (TINTS[this.resourceType]) this.sprite.setTint(TINTS[this.resourceType]);
  }

  collect() {
    this.alive = false;
    this.sprite.setVisible(false);
    this.respawnAt = this.scene.time.now + this.respawnMs;
  }

  update(now) {
    if (!this.alive) {
      if (this.respawnAt > 0 && now >= this.respawnAt) this._respawn();
    }
  }

  _respawn() {
    const nx = Phaser.Math.Between(this.zone.xMin, this.zone.xMax);
    const ny = Phaser.Math.Between(this.zone.yMin, this.zone.yMax);
    this.sprite.setPosition(nx, ny).setVisible(true);
    this.sprite.anims.setProgress(Math.random());
    this.alive = true;
    this.respawnAt = 0;
  }

  destroy() {
    this.sprite.destroy();
  }
}
