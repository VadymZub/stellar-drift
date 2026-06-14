import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { UI_RES } from '../constants.js';
import { SECTORS, galaxy } from '../galaxy.js';

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

    // Enter base button — shows when player is near, sets gs.atBase = true
    const btnY = y + SIZE / 2 + 44;
    this._enterBtn = scene.add.rectangle(x, btnY, 200, 34, 0x0a1f0a, 0.92)
      .setDepth(8).setStrokeStyle(2, 0x44aa55, 0.9).setInteractive({ useHandCursor: true })
      .setVisible(false);
    this._enterLbl = scene.add.text(x, btnY, '[ ВОЙТИ ]',
      { ...tf, fontSize: '14px', color: '#66cc77' }).setOrigin(0.5).setDepth(9).setVisible(false);

    this._enterBtn.on('pointerover', () => this._enterBtn.setFillStyle(0x102a10));
    this._enterBtn.on('pointerout',  () => this._enterBtn.setFillStyle(0x0a1f0a));
    this._enterBtn.on('pointerdown', () => this.enterBase('GarageScene'));

    this._healTimer = 0;

    // Register for smart hotkey entry and respawn position lookup
    if (!scene.homeBases) scene.homeBases = [];
    scene.homeBases.push(this);
    if (!scene.homeBasePositions) scene.homeBasePositions = {};
    scene.homeBasePositions[corp] = { x, y };
  }

  enterBase(sceneKey) {
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
    gs.atBase = true;
    if (sceneKey && gs.toggleOverlay) gs.toggleOverlay(sceneKey);
  }

  // Legacy: F key opens corp scene directly (kept for backwards compatibility)
  openInfo() { this.enterBase(); }

  update(dt) {
    const gs = this.scene;
    const d  = Phaser.Math.Distance.Between(gs.player.x, gs.player.y, this.x, this.y);
    const near = d < AURA_R && gs.player.alive;

    const pvp = SECTORS[galaxy.current]?.pvp;
    const corpMatch = !pvp || gs.playerCorp === this.corp || gs.playerCorp === 'neutral';
    gs.nearBase = near && corpMatch;
    this._healHint.setVisible(near && corpMatch);
    this._enterBtn.setVisible(near && !gs.atBase && corpMatch);
    this._enterLbl.setVisible(near && !gs.atBase && corpMatch);

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
    if (this.scene.homeBases) {
      const idx = this.scene.homeBases.indexOf(this);
      if (idx >= 0) this.scene.homeBases.splice(idx, 1);
    }
    [this._zone, this._sprite, this._label, this._healHint, this._enterBtn, this._enterLbl]
      .forEach(o => o?.destroy());
  }
}
