import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES, PROJ_TYPES, ART_ANGLE_OFFSET } from '../constants.js';
import { i18n } from '../i18n.js';

// ── Константы арены ────────────────────────────────────────────────────────
const AW = 820, AH = 680;        // размер арены в пикселях
const PLAYER_SPEED = 220;
const BOT_SPEED    = 160;
const BOT_STRAFE_DIST = 280;
const PROJ_SPEED   = 680;
const PLAYER_HIT   = 32;
const BOT_HIT      = 32;
const FIRE_RATE    = 0.9;        // выстрелов/сек

const BOT_PROJ_TYPES = ['plasma', 'ion', 'acid', 'grav', 'emp'];
const PROJ_COLORS = {
  plasma: 0xef5350, ion: 0x80d8ff, acid: 0x76ff03, grav: 0xffb74d, emp: 0x4dd0e1
};

export default class ShadowBattleScene extends Phaser.Scene {
  constructor() { super('ShadowBattleScene'); }

  create() {
    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;
    this.ax = cx - AW / 2;   // левый край арены
    this.ay = cy - AH / 2;   // верхний край арены
    this.cx = cx; this.cy = cy;

    // Получаем состояние игрока из GameScene
    const gs  = this.scene.get('GameScene');
    const gsp = gs?.player;

    const pMaxHull   = gsp?.maxHull   || 800;
    const pMaxShield = gsp?.maxShield || 600;
    const botMaxHull   = Math.round(pMaxHull   * 0.95);
    const botMaxShield = Math.round(pMaxShield * 0.85);

    this._pHull   = pMaxHull;   this._pMaxHull   = pMaxHull;
    this._pShield = pMaxShield; this._pMaxShield = pMaxShield;
    this._bHull   = botMaxHull;   this._bMaxHull   = botMaxHull;
    this._bShield = botMaxShield; this._bMaxShield = botMaxShield;
    this._done    = false;
    this._repairUsed = false;

    // Подложка затемнения
    this.add.rectangle(cx, cy, width, height, 0x000010, 0.78);

    // Арена
    const arenaBg = this.add.rectangle(cx, cy, AW, AH, 0x020810, 1)
      .setStrokeStyle(2, COLORS.primary, 0.7);

    // Декоративная сетка
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x0d1f2d, 0.6);
    for (let gx = 0; gx <= AW; gx += 80) { grid.lineBetween(this.ax + gx, this.ay, this.ax + gx, this.ay + AH); }
    for (let gy = 0; gy <= AH; gy += 80) { grid.lineBetween(this.ax, this.ay + gy, this.ax + AW, this.ay + gy); }

    // Заголовок
    this.add.text(cx, this.ay - 28, 'БОЙ С ТЕНЬЮ', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '20px', color: '#4dd0e1', resolution: UI_RES,
    }).setOrigin(0.5, 1);

    // Корабли
    const shipKey = gs?.activeShip || 'wisp';
    const botShip = 'phantom'; // тень всегда на Phantom

    this._pSprite = this.add.image(cx, this.ay + AH - 130, shipKey).setDisplaySize(52, 52).setDepth(5).setTint(0xaaddff);
    this._bSprite = this.add.image(cx, this.ay + 130, botShip).setDisplaySize(52, 52).setDepth(5).setTint(0xff4444);

    this._pX = cx; this._pY = this.ay + AH - 130;
    this._pWaypoint = null;
    this._pHeading  = -Math.PI / 2;
    this._pSpeed    = 0;

    this._bX = cx; this._bY = this.ay + 130;
    this._bHeading  = Math.PI / 2;
    this._bSpeed    = 0;
    this._bState    = 'approach';
    this._bFireCd   = 1.0;
    this._bStrafeDir  = 1;
    this._bStrafeTimer = 0;
    this._bDashTimer   = 0;
    this._bProjTypeIdx = 0;

    // Снаряды
    this._projs = [];
    this._projGfx = this.add.graphics().setDepth(6);

    // HP-бары
    this._barGfx = this.add.graphics().setDepth(8);

    // Метки
    const LF = (s, c) => ({ fontFamily: 'Inter, sans-serif', fontSize: s, color: c, resolution: UI_RES });
    this.add.text(this.ax,       this.ay + AH + 10, 'ВЫ',   LF('12px', '#aaddff')).setOrigin(0, 0);
    this.add.text(this.ax + AW, this.ay + AH + 10, 'ТЕНЬ', LF('12px', '#ff8888')).setOrigin(1, 0);
    this._pHullTxt   = this.add.text(this.ax,       this.ay + AH + 24, '', LF('13px', '#ef5350')).setOrigin(0, 0);
    this._bHullTxt   = this.add.text(this.ax + AW, this.ay + AH + 24, '', LF('13px', '#ef5350')).setOrigin(1, 0);
    this._statusTxt  = this.add.text(cx, this.ay - 6, '', LF('14px', '#ffb74d')).setOrigin(0.5, 1);

    // Ввод: клик в арене = задать waypoint
    this.input.on('pointerdown', (ptr) => {
      if (this._done) return;
      const wx = ptr.x, wy = ptr.y;
      if (wx >= this.ax && wx <= this.ax + AW && wy >= this.ay && wy <= this.ay + AH) {
        this._pWaypoint = { x: wx, y: wy };
      }
    });

    this.input.keyboard.once('keydown-ESC', () => { this._endBattle(null); });

    this._drawBars();
  }

  update(_, delta) {
    if (this._done) return;
    const dt = delta / 1000;
    this._updatePlayer(dt);
    this._updateBot(dt);
    this._updateProjectiles(dt);
    this._drawBars();
    this._checkDeath();
  }

  // ── Игрок ─────────────────────────────────────────────────────────────────
  _updatePlayer(dt) {
    if (this._pWaypoint) {
      const dx = this._pWaypoint.x - this._pX;
      const dy = this._pWaypoint.y - this._pY;
      const dist = Math.hypot(dx, dy);
      if (dist < 14) {
        this._pWaypoint = null;
        this._pSpeed = 0;
      } else {
        const target = Math.atan2(dy, dx);
        this._pHeading = Phaser.Math.Angle.RotateTo(this._pHeading, target, 6.0 * dt);
        this._pSpeed = Math.min(PLAYER_SPEED, this._pSpeed + PLAYER_SPEED * 3 * dt);
        this._pX = Phaser.Math.Clamp(this._pX + Math.cos(this._pHeading) * this._pSpeed * dt, this.ax + 30, this.ax + AW - 30);
        this._pY = Phaser.Math.Clamp(this._pY + Math.sin(this._pHeading) * this._pSpeed * dt, this.ay + 30, this.ay + AH - 30);
      }
    } else {
      this._pSpeed = Math.max(0, this._pSpeed - PLAYER_SPEED * 4 * dt);
    }

    this._pSprite.setPosition(this._pX, this._pY);
    this._pSprite.rotation = this._pHeading + ART_ANGLE_OFFSET;

    // Автострельба по тени
    this._pFireCd = (this._pFireCd || 0) - dt;
    if (this._pFireCd <= 0) {
      this._pFireCd = 1 / FIRE_RATE;
      this._fireProjectile('player', this._pX, this._pY, this._bX, this._bY, 'plasma');
    }
  }

  // ── Тень (бот) ────────────────────────────────────────────────────────────
  _updateBot(dt) {
    const dx = this._pX - this._bX, dy = this._pY - this._bY;
    const dist = Math.hypot(dx, dy);

    this._bFireCd -= dt;
    this._bDashTimer -= dt;
    this._bStrafeTimer -= dt;

    // ── Ремонт при низком HP (один раз) ──────────────────────────────────
    if (!this._repairUsed && this._bHull / this._bMaxHull < 0.30) {
      this._repairUsed = true;
      const heal = Math.round(this._bMaxHull * 0.35);
      this._bHull = Math.min(this._bMaxHull, this._bHull + heal);
      this._statusTxt.setText('Тень использует ремкомплект!');
      this.time.delayedCall(1800, () => { if (this._statusTxt?.active) this._statusTxt.setText(''); });
      this._bSprite.setTint(0x80ff80);
      this.time.delayedCall(400, () => { if (this._bSprite?.active) this._bSprite.setTint(0xff4444); });
    }

    // Выбор типа снаряда (ротация по очереди)
    const pType = BOT_PROJ_TYPES[this._bProjTypeIdx % BOT_PROJ_TYPES.length];

    // ── Состояние ─────────────────────────────────────────────────────────
    if (dist > BOT_STRAFE_DIST * 1.4) {
      this._bState = 'approach';
    } else if (dist < BOT_STRAFE_DIST * 0.5) {
      this._bState = 'retreat';
    } else {
      this._bState = 'strafe';
    }

    // ── Boost-побег при низком HP ─────────────────────────────────────────
    if (this._bHull / this._bMaxHull < 0.25 && dist < BOT_STRAFE_DIST * 1.2) {
      this._bState = 'retreat';
    }

    let tx = this._pX, ty = this._pY;
    let speed = BOT_SPEED;

    if (this._bState === 'approach') {
      this._bHeading = Math.atan2(ty - this._bY, tx - this._bX);
    } else if (this._bState === 'retreat') {
      this._bHeading = Math.atan2(this._bY - ty, this._bX - tx);
      speed = BOT_SPEED * 1.3;
    } else {
      // Strafe: перпендикуляр к игроку с периодической сменой направления
      if (this._bStrafeTimer <= 0) {
        this._bStrafeDir  *= -1;
        this._bStrafeTimer = Phaser.Math.FloatBetween(0.8, 1.8);
      }
      const baseAng = Math.atan2(ty - this._bY, tx - this._bX);
      this._bHeading = baseAng + Math.PI / 2 * this._bStrafeDir;
    }

    // Dodge: если снаряд летит в нас — рывок в сторону
    if (this._bDashTimer <= 0) {
      for (const p of this._projs) {
        if (p.owner !== 'player') continue;
        const pdx = p.x - this._bX, pdy = p.y - this._bY;
        if (Math.hypot(pdx, pdy) < 160) {
          this._bHeading += Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
          speed = BOT_SPEED * 1.8;
          this._bDashTimer = 0.5;
          break;
        }
      }
    }

    this._bX = Phaser.Math.Clamp(this._bX + Math.cos(this._bHeading) * speed * dt, this.ax + 30, this.ax + AW - 30);
    this._bY = Phaser.Math.Clamp(this._bY + Math.sin(this._bHeading) * speed * dt, this.ay + 30, this.ay + AH - 30);
    this._bSprite.setPosition(this._bX, this._bY);
    this._bSprite.rotation = this._bHeading + ART_ANGLE_OFFSET;

    // Стрельба
    if (this._bFireCd <= 0 && dist < 500) {
      this._bFireCd = 1 / (FIRE_RATE * 0.85);
      this._bProjTypeIdx++;
      this._fireProjectile('bot', this._bX, this._bY, this._pX, this._pY, pType);
    }
  }

  // ── Снаряды ───────────────────────────────────────────────────────────────
  _fireProjectile(owner, fx, fy, tx, ty, type) {
    const ang = Math.atan2(ty - fy, tx - fx);
    // ion: 3 болта веером
    if (type === 'ion') {
      for (const off of [-0.18, 0, 0.18]) {
        const a = ang + off;
        this._projs.push({ owner, x: fx, y: fy, vx: Math.cos(a) * PROJ_SPEED, vy: Math.sin(a) * PROJ_SPEED, type, life: 1.8, damage: 55 });
      }
      return;
    }
    const speed = type === 'grav' ? 400 : type === 'acid' ? 560 : type === 'emp' ? 520 : PROJ_SPEED;
    const damage = type === 'grav' ? 85 : type === 'acid' ? 70 : type === 'emp' ? 60 : 90;
    this._projs.push({ owner, x: fx, y: fy, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, type, life: 2.0, damage });
  }

  _updateProjectiles(dt) {
    this._projGfx.clear();
    this._projs = this._projs.filter(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) return false;
      if (p.x < this.ax || p.x > this.ax + AW || p.y < this.ay || p.y > this.ay + AH) return false;

      // Хитбоксы
      const hitPlayer = p.owner === 'bot'    && Math.hypot(p.x - this._pX, p.y - this._pY) < PLAYER_HIT;
      const hitBot    = p.owner === 'player' && Math.hypot(p.x - this._bX, p.y - this._bY) < BOT_HIT;

      if (hitPlayer) { this._applyPlayerHit(p); return false; }
      if (hitBot)    { this._applyBotHit(p);    return false; }

      // Рисуем снаряд
      const col = PROJ_COLORS[p.type] ?? 0xffffff;
      const sz  = p.type === 'acid' || p.type === 'grav' ? 7 : 4;
      this._projGfx.fillStyle(col, 0.92);
      this._projGfx.fillCircle(p.x, p.y, sz);
      return true;
    });
  }

  _applyPlayerHit(p) {
    const dmg = p.damage;
    const pen = p.type === 'void' ? 0.65 : 0.05;
    const directDmg = dmg * pen;
    const shieldDmg = dmg - directDmg;
    if (this._pShield > 0) {
      const sh = Math.min(this._pShield, shieldDmg);
      this._pShield -= sh;
      this._pHull   -= (shieldDmg - sh) + directDmg;
    } else {
      this._pHull -= dmg;
    }
    // Эффекты
    if (p.type === 'acid')   this._statusTxt.setText('☣ Кислота — потеря корпуса!');
    if (p.type === 'emp')    this._statusTxt.setText('⚡ ЭМИ-разряд! Скорость снижена.');
    if (p.type === 'grav')   this._statusTxt.setText('↗ Гравпульс — отброшен!');
    this.time.delayedCall(1500, () => { if (this._statusTxt?.active) this._statusTxt.setText(''); });
    this._pHull = Math.max(0, this._pHull);
  }

  _applyBotHit(p) {
    const dmg = p.damage;
    const pen = 0.05;
    const directDmg = dmg * pen;
    const shieldDmg = dmg - directDmg;
    if (this._bShield > 0) {
      const sh = Math.min(this._bShield, shieldDmg);
      this._bShield -= sh;
      this._bHull   -= (shieldDmg - sh) + directDmg;
    } else {
      this._bHull -= dmg;
    }
    this._bHull = Math.max(0, this._bHull);
  }

  // ── HP-бары ───────────────────────────────────────────────────────────────
  _drawBars() {
    const g = this._barGfx; g.clear();
    const barY = this.ay + AH + 44, barW = AW / 2 - 20;

    // Игрок (слева): щит + корпус
    const phf = Math.max(0, this._pHull   / this._pMaxHull);
    const psf = Math.max(0, this._pShield / this._pMaxShield);
    g.fillStyle(0x111122, 0.8); g.fillRect(this.ax, barY, barW, 8);
    g.fillStyle(COLORS.danger, 1); g.fillRect(this.ax, barY, barW * phf, 8);
    g.fillStyle(0x111122, 0.8); g.fillRect(this.ax, barY - 11, barW, 6);
    g.fillStyle(COLORS.primary, 1); g.fillRect(this.ax, barY - 11, barW * psf, 6);
    this._pHullTxt.setText(`Корпус: ${Math.ceil(this._pHull)} / ${this._pMaxHull}`);

    // Бот (справа): щит + корпус
    const bhf = Math.max(0, this._bHull   / this._bMaxHull);
    const bsf = Math.max(0, this._bShield / this._bMaxShield);
    const bx = this.ax + AW / 2 + 20;
    g.fillStyle(0x111122, 0.8); g.fillRect(bx, barY, barW, 8);
    g.fillStyle(COLORS.danger, 1); g.fillRect(bx, barY, barW * bhf, 8);
    g.fillStyle(0x111122, 0.8); g.fillRect(bx, barY - 11, barW, 6);
    g.fillStyle(0xff6644, 1); g.fillRect(bx, barY, barW * bsf, 6);
    this._bHullTxt.setText(`Корпус: ${Math.ceil(this._bHull)} / ${this._bMaxHull}`);
  }

  // ── Смерть ────────────────────────────────────────────────────────────────
  _checkDeath() {
    if (this._pHull <= 0) this._endBattle('lose');
    else if (this._bHull <= 0) this._endBattle('win');
  }

  _endBattle(result) {
    if (this._done) return;
    this._done = true;
    this.input.off('pointerdown');

    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;

    if (result === null) { this.scene.stop(); return; }

    const gs = this.scene.get('GameScene');
    let xpGain = 0, credGain = 0, honorGain = 0;
    if (result === 'win') {
      xpGain    = 3500;
      credGain  = 12000;
      honorGain = 40;
      gs?.gainXp?.(xpGain);
      gs && (gs.credits = (gs.credits || 0) + credGain);
      gs && (gs.pilotHonor = (gs.pilotHonor || 0) + honorGain);
    }

    const panH = result === 'win' ? 260 : 200;
    const panW = 420;
    const bg   = this.add.rectangle(cx, cy, panW, panH, 0x040c18, 0.97)
      .setStrokeStyle(2, result === 'win' ? COLORS.primary : 0xef5350, 0.9).setDepth(20);
    const TF = (s, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES });

    const title = result === 'win' ? '✓  ПОБЕДА' : '✗  ПОРАЖЕНИЕ';
    const titleColor = result === 'win' ? '#4dd0e1' : '#ef5350';
    this.add.text(cx, cy - panH / 2 + 32, title, TF('28px', titleColor)).setOrigin(0.5).setDepth(21);

    if (result === 'win') {
      this.add.text(cx, cy - 28, `+${xpGain.toLocaleString()} XP`, TF('18px', '#88ff88')).setOrigin(0.5).setDepth(21);
      this.add.text(cx, cy,     `+${credGain.toLocaleString()} кредитов`, TF('16px', '#ffcc44')).setOrigin(0.5).setDepth(21);
      this.add.text(cx, cy + 26, `+${honorGain} очков чести`, TF('14px', '#aaddff')).setOrigin(0.5).setDepth(21);
    } else {
      this.add.text(cx, cy - 12, 'Тень оказалась сильнее.', TF('16px', '#bb6666')).setOrigin(0.5).setDepth(21);
    }

    const closeY = cy + panH / 2 - 40;
    const closeBtn = this.add.rectangle(cx, closeY, 280, 44, 0x0d2233, 0.95)
      .setStrokeStyle(1, COLORS.primary, 0.8).setInteractive({ useHandCursor: true }).setDepth(21);
    this.add.text(cx, closeY, 'ВЕРНУТЬСЯ НА БАЗУ', TF('16px', '#4dd0e1')).setOrigin(0.5).setDepth(22);
    closeBtn.on('pointerdown', () => this.scene.stop());
    closeBtn.on('pointerover',  () => closeBtn.setFillStyle(0x1a3a50));
    closeBtn.on('pointerout',   () => closeBtn.setFillStyle(0x0d2233));
  }
}
