import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { UI_RES } from '../constants.js';

const SIZE   = 520;   // sprite display size
const AURA_R = 380;   // heal radius
const HEAL_HULL_PCT   = 0.02;  // 2% max hull / sec
const HEAL_SHIELD_PCT = 0.05;  // 5% max shield / sec

const CORP_COLOR = { helios: '#ffb74d', karax: '#ef5350', tides: '#4dd0e1' };
const CORP_LABEL = { helios: 'ШТАБ HELIOS', karax: 'ШТАБ KARAX', tides: 'ШТАБ TIDES' };

export default class HomeBase {
  constructor(scene, x, y, corp) {
    this.scene = scene;
    this.x     = x;
    this.y     = y;
    this.corp  = corp;

    const color  = CORP_COLOR[corp] || '#4dd0e1';
    const hexCol = corp === 'helios' ? 0xffb74d : corp === 'karax' ? 0xef5350 : 0x4dd0e1;
    const tf     = { fontFamily: 'Orbitron', resolution: UI_RES };

    // Aura glow
    this._zone = scene.add.circle(x, y, AURA_R, hexCol, 0.05).setDepth(-4);

    // Sprite
    this._sprite = scene.add.image(x, y, `home_base_${corp}`)
      .setDisplaySize(SIZE, SIZE).setDepth(5);

    // Name label — above base
    this._label = scene.add.text(x, y - SIZE / 2 - 36, CORP_LABEL[corp],
      { ...tf, fontSize: '20px', color }).setOrigin(0.5).setDepth(7);

    // Heal range hint — shown when player is close
    this._healHint = scene.add.text(x, y - SIZE / 2 - 14, '[ зона восстановления ]',
      { ...tf, fontSize: '12px', color: '#66cc88' }).setOrigin(0.5).setDepth(7).setVisible(false);

    // Corp menu button — opens CorpScene overlay
    const btnY = y + SIZE / 2 + 44;
    this._btnBg = scene.add.rectangle(x, btnY, 220, 32, 0x0d1a26, 0.92)
      .setDepth(8).setStrokeStyle(1, hexCol, 0.8).setInteractive({ useHandCursor: true });
    this._btnLbl = scene.add.text(x, btnY, '[ КОРПОРАЦИЯ ]',
      { ...tf, fontSize: '13px', color }).setOrigin(0.5).setDepth(9);

    this._btnBg.on('pointerover', () => this._btnBg.setFillStyle(0x1a2838));
    this._btnBg.on('pointerout',  () => this._btnBg.setFillStyle(0x0d1a26));
    this._btnBg.on('pointerdown', () => this.openInfo());

    this._healTimer = 0;
  }

  // Called by F key or button click — stops ship and opens CorpScene overlay
  openInfo() {
    const gs = this.scene;
    const p  = gs.player;
    if (p) {
      p.waypoint = null; p.speed = 0; p.boosting = false;
      p.sprite?.body?.setVelocity(0, 0);
      gs.steering = false;
      if (gs.movement) {
        gs.movement.showArrow = false;
        gs.movement.courseArrow?.setVisible(false);
      }
    }
    if (!gs.scene.isActive('CorpScene')) {
      gs.scene.launch('CorpScene');
    }
  }

  update(dt) {
    const gs = this.scene;
    const d  = Phaser.Math.Distance.Between(gs.player.x, gs.player.y, this.x, this.y);
    const near = d < AURA_R && gs.player.alive;

    this._healHint.setVisible(near);

    if (near) {
      this._healTimer += dt;
      if (this._healTimer >= 1) {
        this._healTimer = 0;
        const p = gs.player;
        p.hull   = Math.min(p.maxHull,   p.hull   + p.maxHull   * HEAL_HULL_PCT);
        p.shield = Math.min(p.maxShield, p.shield + p.maxShield * HEAL_SHIELD_PCT);
      }
    } else {
      this._healTimer = 0;
    }
  }

  destroy() {
    [this._zone, this._sprite, this._label, this._healHint, this._btnBg, this._btnLbl]
      .forEach(o => o?.destroy());
  }
}
