import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';

// World event: a rare anomaly signal, telegraphed on the minimap by a blinking marker.
// Player must fly in and hold still inside SCAN_RADIUS for SCAN_TIME_MS to decode it —
// see GameScene.updateLoot() (shares the loot/plasmate collect-channel plumbing, gated
// by target.isAnomaly for the longer duration + stillness requirement).
export const ANOMALY_SCAN_RADIUS = 150;
export const ANOMALY_SCAN_TIME_MS = 10000;

export default class AnomalySignal {
  constructor(scene, x, y) {
    this.scene    = scene;
    this.isAnomaly = true;
    this.alive    = true;
    this.x        = x;
    this.y        = y;
    this._phase   = Math.random() * Math.PI * 2;
    this._build();
  }

  _build() {
    // Reuses the generic 'glow' texture (already loaded — see EscortTransport arrival
    // flash) instead of a bespoke sprite: additive-tinted pulse reads as an anomaly
    // without needing new art.
    this.sprite = this.scene.add.image(this.x, this.y, 'glow')
      .setDepth(37).setScale(0.55).setTint(0x9c6bff).setAlpha(0.9).setBlendMode(Phaser.BlendModes.ADD);
    this._ring = this.scene.add.graphics().setDepth(37);
  }

  update(dt) {
    if (!this.alive) return;
    this._phase += dt * 2.2;
    const pulse = 0.6 + 0.4 * Math.abs(Math.sin(this._phase));
    this.sprite.setAlpha(0.55 * pulse + 0.35).setScale(0.45 + 0.15 * pulse);
    this._ring.clear();
    this._ring.lineStyle(2, 0x9c6bff, 0.35 * pulse);
    this._ring.strokeCircle(this.x, this.y, ANOMALY_SCAN_RADIUS * (0.7 + 0.1 * pulse));
  }

  collect() {
    this.alive = false;
    this.sprite.destroy();
    this._ring.destroy();
  }

  destroy() {
    this.alive = false;
    this.sprite?.destroy();
    this._ring?.destroy();
  }
}
