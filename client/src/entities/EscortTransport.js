import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { UI_RES } from '../constants.js';

// Transport sprite has nose at BOTTOM (like pirate mobs), not nose-up like player ships.
const TRANSPORT_ART_OFFSET = -Math.PI / 2;

export const ESCORT_SPEED   = 55;   // px/sec
export const ESCORT_WAVE_AT = [0.20, 0.50, 0.75];
const SPEED        = ESCORT_SPEED;
const TRIGGER_DIST = 280;     // player approach distance to start moving
const ARRIVE_DIST  = 80;      // distance to target to consider arrived
const HINT_DIST    = 580;     // distance at which idle approach prompt appears
const DANGER_DIST  = 420;     // escort mob distance at which danger prompt shows
const WAVE_AT = ESCORT_WAVE_AT;

export default class EscortTransport {
  constructor(scene, x, y, targetX, targetY, hullMax) {
    this.scene   = scene;
    this.x       = x;
    this.y       = y;
    this.targetX = targetX;
    this.targetY = targetY;
    this.hull    = hullMax;
    this.maxHull = hullMax;
    this.state   = 'idle';   // idle | moving | arrived | destroyed
    this.alive   = true;

    this._totalDist    = Phaser.Math.Distance.Between(x, y, targetX, targetY);
    this._waveTriggered = [false, false, false];

    this._buildSprite(x, y);
    this._buildHullBar();
    this._buildPrompt();
  }

  _buildSprite(x, y) {
    this.sprite = this.scene.add.image(x, y, 'npc_transport')
      .setDepth(42).setDisplaySize(96, 120);
    // Face toward destination from the start
    const dx = this.targetX - x, dy = this.targetY - y;
    this.sprite.rotation = Math.atan2(dy, dx) + TRANSPORT_ART_OFFSET;
    // Idle pulse ring
    this._idleRing = this.scene.add.graphics().setDepth(38);
    this._idleRingPhase = 0;
    this._drawIdleRing();
  }

  _buildPrompt() {
    const s = this.scene;
    this._bubbleBg  = s.add.graphics().setDepth(67).setVisible(false);
    // Phaser 4: Text canvas is lazy-init; setVisible(false) on empty text leaves canvas null.
    // Use setAlpha(0) + non-empty initial content so the canvas is ready before first setText.
    this._bubbleTxt = s.add.text(this.x, this.y, ' ',
      { fontFamily: 'Orbitron, sans-serif', fontSize: '11px', color: '#4dd0e1',
        resolution: UI_RES, align: 'center' })
      .setOrigin(0.5, 1).setDepth(68).setAlpha(0);
    this._promptPhase = 0;
  }

  _updatePrompt(dt, playerDist) {
    this._promptPhase += dt * 3.2;
    const pulse = 0.6 + 0.4 * Math.abs(Math.sin(this._promptPhase));

    const hasDanger = this.state === 'moving'
      && (this.scene._escortMobs ?? []).some(m => m.alive
        && Phaser.Math.Distance.Between(m.x, m.y, this.x, this.y) < DANGER_DIST);
    const showHint  = this.state === 'idle' && playerDist < HINT_DIST;
    const show      = hasDanger || showHint;

    this._bubbleBg.setVisible(show);
    if (!show) { this._bubbleTxt.setAlpha(0); return; }

    const isDanger  = hasDanger;
    const text      = isDanger ? '⚠  КОРСАРЫ АТАКУЮТ!' : 'Мне нужна защита!\nПодлети ближе.';
    const fillColor = isDanger ? 0x1e0404 : 0x061620;
    const lineColor = isDanger ? 0xef5350 : 0x4dd0e1;
    const txtColor  = isDanger ? '#ef5350' : '#4dd0e1';

    this._bubbleTxt.setText(text).setColor(txtColor);

    const pad = 12, th = this._bubbleTxt.height + pad * 2;
    const tw  = Math.max(this._bubbleTxt.width + pad * 2, 160);
    const tailH = 8;
    // Position bubble above sprite (above hull bar, which sits at y-38)
    const bubbleY = this.y - 52 - th;
    const bx = this.x - tw / 2;

    this._bubbleTxt.setPosition(this.x, bubbleY + th - pad).setAlpha(pulse);
    this._bubbleBg.clear();
    // Bubble body
    this._bubbleBg.fillStyle(fillColor, 0.92);
    this._bubbleBg.fillRoundedRect(bx, bubbleY, tw, th, 6);
    this._bubbleBg.lineStyle(1.5, lineColor, pulse * 0.75);
    this._bubbleBg.strokeRoundedRect(bx, bubbleY, tw, th, 6);
    // Triangle pointer pointing down toward sprite
    const tx = this.x, ty = bubbleY + th;
    this._bubbleBg.fillStyle(fillColor, 0.92);
    this._bubbleBg.fillTriangle(tx - 7, ty, tx + 7, ty, tx, ty + tailH);
    this._bubbleBg.lineStyle(1.5, lineColor, pulse * 0.75);
    this._bubbleBg.strokeTriangle(tx - 7, ty, tx + 7, ty, tx, ty + tailH);
    // Cover triangle base seam with fill
    this._bubbleBg.lineStyle(2, lineColor, 0);
    this._bubbleBg.fillStyle(fillColor, 0.92);
    this._bubbleBg.fillRect(tx - 6, ty - 1, 12, 3);
  }

  _buildHullBar() {
    this._barBg    = this.scene.add.graphics().setDepth(65);
    this._barFg    = this.scene.add.graphics().setDepth(65);
    this._barLabel = this.scene.add.text(this.x, this.y - 42, 'ТРАНСПОРТ',
      { fontFamily: 'Orbitron, sans-serif', fontSize: '10px', color: '#90caf9', resolution: UI_RES })
      .setOrigin(0.5, 1).setDepth(65);
    this._refreshBar();
  }

  _refreshBar() {
    const bw = 68, bh = 5;
    const bx = this.x - bw / 2, by = this.y - 38;
    this._barBg.clear();
    this._barBg.fillStyle(0x102030, 0.9).fillRect(bx, by, bw, bh);
    this._barFg.clear();
    const pct = Math.max(0, this.hull / this.maxHull);
    const col = pct > 0.5 ? 0x4dd0e1 : pct > 0.25 ? 0xffb74d : 0xef5350;
    this._barFg.fillStyle(col, 0.9).fillRect(bx, by, Math.ceil(bw * pct), bh);
    this._barLabel?.setPosition(this.x, by - 2);
  }

  _drawIdleRing() {
    if (!this._idleRing) return;
    this._idleRing.clear();
    if (this.state !== 'idle') return;
    const alpha = 0.25 + 0.2 * Math.sin(this._idleRingPhase);
    this._idleRing.lineStyle(2, 0x4dd0e1, alpha);
    this._idleRing.strokeCircle(this.x, this.y, 52 + 4 * Math.sin(this._idleRingPhase));
  }

  startMoving() {
    if (this.state !== 'idle') return;
    this.state = 'moving';
    this._idleRing?.destroy();
    this._idleRing = null;
    this.scene.log('Транспорт начинает движение — не дай корсарам добраться до него!');
  }

  update(dt) {
    if (!this.alive) return;

    const px = this.scene.player?.x ?? this.x, py = this.scene.player?.y ?? this.y;
    const playerDist = Phaser.Math.Distance.Between(px, py, this.x, this.y);
    this._updatePrompt(dt, playerDist);

    if (this.state === 'idle') {
      this._idleRingPhase += dt * 2.5;
      this._drawIdleRing();
      if (this.scene.player && playerDist < TRIGGER_DIST) {
        this.startMoving();
      }
      return;
    }

    if (this.state !== 'moving') return;

    const dx = this.targetX - this.x, dy = this.targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < ARRIVE_DIST) { this._arrive(); return; }

    const nx = dx / dist, ny = dy / dist;
    this.x += nx * SPEED * dt;
    this.y += ny * SPEED * dt;
    this.sprite.setPosition(this.x, this.y);
    this.sprite.rotation = Math.atan2(dy, dx) + TRANSPORT_ART_OFFSET;
    this._refreshBar();

    // Wave spawn triggers
    const traveled = this._totalDist - dist;
    const progress  = traveled / this._totalDist;
    WAVE_AT.forEach((t, i) => {
      if (!this._waveTriggered[i] && progress >= t) {
        this._waveTriggered[i] = true;
        this.scene._spawnEscortWave(this.x, this.y, i);
      }
    });
  }

  takeDamage(amount) {
    if (!this.alive || this.state !== 'moving')
      return { dodged: false, hullHit: 0, shieldHit: 0 };
    this.hull = Math.max(0, this.hull - amount);
    this._refreshBar();
    if (this.hull <= 0) this._onDestroyed();
    return { dodged: false, hullHit: amount, shieldHit: 0 };
  }

  _arrive() {
    this.state = 'arrived';
    this.alive = false;
    // Small flash
    const flash = this.scene.add.image(this.x, this.y, 'glow')
      .setDepth(55).setTint(0x4dd0e1).setScale(0.4).setAlpha(0.8).setBlendMode('ADD');
    this.scene.tweens.add({ targets: flash, alpha: 0, scale: 1.2, duration: 600,
      onComplete: () => flash.destroy() });
    this.scene.tweens.add({ targets: this.sprite, alpha: 0, duration: 700,
      onComplete: () => { this.sprite?.destroy(); this.sprite = null; } });
    this._destroyUI();
    this.scene.advanceEscortMission(1);
    this.scene.log('Транспорт добрался до базы! Миссия выполнена.');
  }

  _onDestroyed() {
    if (!this.alive) return;
    this.state = 'destroyed';
    this.alive = false;
    this.scene.explosion(this.x, this.y, 1.1);
    this.sprite?.destroy(); this.sprite = null;
    this._destroyUI();
    this.scene.failEscortMission();
    this.scene.log('⚠ Транспорт уничтожен! Миссия провалена — попробуй завтра.');
  }

  _destroyUI() {
    this._barBg?.destroy();     this._barBg     = null;
    this._barFg?.destroy();     this._barFg     = null;
    this._barLabel?.destroy();  this._barLabel  = null;
    this._idleRing?.destroy();  this._idleRing  = null;
    this._bubbleBg?.destroy();  this._bubbleBg  = null;
    this._bubbleTxt?.destroy(); this._bubbleTxt = null;
  }

  destroy() {
    this.alive = false;
    this.sprite?.destroy();
    this._destroyUI();
  }
}
