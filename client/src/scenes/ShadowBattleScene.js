import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES, ART_ANGLE_OFFSET } from '../constants.js';
import { i18n } from '../i18n.js';
import { SHIPS, SHIP_BY_KEY, shipLevelMods, SHIP_MAX_LEVEL } from '../ships.js';

// Конфиг-панель "Бой с тенью". Не содержит арены — только настройку противника.
// После нажатия "НАЧАТЬ БОЙ" вызывает GameScene.startShadowBattle(cfg) и закрывается.
// Вся боевая логика живёт в GameScene (galaxy.current === 'shadow_arena').

const BATTLE_SHIPS = SHIPS.filter(s => s.tier !== 'ADMIN');

export default class ShadowBattleScene extends Phaser.Scene {
  constructor() { super('ShadowBattleScene'); }

  init(data) { this._initCfg = data?.cfg || null; }

  create() {
    const prev = this._initCfg;
    this._cfg = {
      shipIdx:    prev?.shipIdx    ?? 0,
      shipDef:    prev ? (BATTLE_SHIPS[prev.shipIdx] ?? BATTLE_SHIPS[0]) : BATTLE_SHIPS[0],
      shipLevel:  prev?.shipLevel  ?? 5,
      equipTier:  prev?.equipTier  ?? 2,
      weaponType: prev?.weaponType ?? 'plasma',
      pilotLevel: prev?.pilotLevel ?? 25,
      boardTier:  prev?.boardTier  ?? 0,
    };
    this._buildConfigPanel();
  }

  _buildConfigPanel() {
    const W = this.scale.width, H = this.scale.height;
    const cx = W / 2, cy = H / 2;
    const PW = 520, PH = 640;
    const px = cx - PW / 2, py = cy - PH / 2;
    const TF  = (sz, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: sz, color: c, resolution: UI_RES });
    const TFI = (sz, c) => ({ fontFamily: 'Inter, sans-serif', fontSize: sz, color: c, resolution: UI_RES });

    this._cfgObjs = [];
    const reg = (...os) => { os.forEach(o => this._cfgObjs.push(o)); return os[0]; };

    reg(this.add.rectangle(cx, cy, W, H, 0x000010, 0.82));
    reg(this.add.rectangle(cx, cy, PW, PH, 0x030c18, 0.98).setStrokeStyle(2, COLORS.primary, 0.7));
    reg(this.add.text(cx, py + 26, 'БОЙ С ТЕНЬЮ — НАСТРОЙКА', TF('18px', '#4dd0e1')).setOrigin(0.5));

    // ── Карусель корабля ─────────────────────────────────────────────────
    reg(this.add.text(px + 20, py + 60, 'КОРАБЛЬ ПРОТИВНИКА', TFI('12px', '#446688')).setOrigin(0, 0.5));

    const shipY = py + 138;
    this._shipPreviewContainer = this.add.container(cx, shipY).setDepth(2);
    reg(this._shipPreviewContainer);
    this._refreshShipPreviewSprite();

    this._shipNameTxt = reg(this.add.text(cx, shipY + 62, '', TF('14px', '#ef9a9a')).setOrigin(0.5));
    this._shipTierTxt = reg(this.add.text(cx, shipY + 80, '', TFI('12px', '#446688')).setOrigin(0.5));

    const arrow = (label, x, y, cb) => {
      const btn = this.add.text(x, y, label, TF('24px', '#4dd0e1')).setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setColor('#80e5ff'));
      btn.on('pointerout',  () => btn.setColor('#4dd0e1'));
      btn.on('pointerdown', cb);
      reg(btn);
    };
    arrow('◄', px + 36, shipY, () => this._stepShip(-1));
    arrow('►', px + PW - 36, shipY, () => this._stepShip(+1));

    // ── Уровень корабля ───────────────────────────────────────────────────
    const sLvlY = py + 228;
    reg(this.add.text(px + 20, sLvlY, 'УРОВЕНЬ КОРАБЛЯ', TFI('12px', '#446688')).setOrigin(0, 0.5));
    this._shipLvlTxt = reg(this.add.text(px + PW - 20, sLvlY, '', TF('14px', '#ccddff')).setOrigin(1, 0.5));
    this._makeSlider(reg, cx, sLvlY + 18, PW - 60, 1, SHIP_MAX_LEVEL, this._cfg.shipLevel, v => {
      this._cfg.shipLevel = v; this._refreshPreview();
    });

    // ── Тир оборудования ──────────────────────────────────────────────────
    const tierY = py + 295;
    reg(this.add.text(px + 20, tierY, 'ТИР СНАРЯЖЕНИЯ', TFI('12px', '#446688')).setOrigin(0, 0.5));
    this._tierBtns = [1, 2, 3, 4].map((t, i) => {
      const bx = px + 20 + i * 116;
      const btn = this.add.rectangle(bx + 44, tierY + 22, 88, 30, 0x081420)
        .setStrokeStyle(1, 0x1e3a50).setInteractive({ useHandCursor: true });
      const lbl = this.add.text(bx + 44, tierY + 22, `T${t}`, TF('13px', '#4dd0e1')).setOrigin(0.5);
      btn.on('pointerdown', () => { this._cfg.equipTier = t; this._refreshTierBtns(); this._refreshPreview(); });
      reg(btn, lbl);
      return { btn, lbl, tier: t };
    });

    // ── Тип оружия ────────────────────────────────────────────────────────
    const wepY = py + 352;
    reg(this.add.text(px + 20, wepY, 'ОРУЖИЕ', TFI('12px', '#446688')).setOrigin(0, 0.5));
    this._wepBtns = ['plasma', 'laser'].map((wt, i) => {
      const bx = px + 160 + i * 150;
      const btn = this.add.rectangle(bx, wepY + 22, 130, 30, 0x081420)
        .setStrokeStyle(1, 0x1e3a50).setInteractive({ useHandCursor: true });
      const lbl = this.add.text(bx, wepY + 22, wt === 'plasma' ? 'ПЛАЗМА' : 'ЛАЗЕР', TF('12px', '#4dd0e1')).setOrigin(0.5);
      btn.on('pointerdown', () => { this._cfg.weaponType = wt; this._refreshWepBtns(); this._refreshPreview(); });
      reg(btn, lbl);
      return { btn, lbl, type: wt };
    });

    // ── Плата (тир) ───────────────────────────────────────────────────────
    const boardY = py + 410;
    reg(this.add.text(px + 20, boardY, 'ПЛАТА', TFI('12px', '#446688')).setOrigin(0, 0.5));
    this._boardBtns = [0, 1, 2, 3].map((t, i) => {
      const bx = px + 20 + i * 116;
      const btn = this.add.rectangle(bx + 44, boardY + 22, 88, 30, 0x081420)
        .setStrokeStyle(1, 0x1e3a50).setInteractive({ useHandCursor: true });
      const lbl = this.add.text(bx + 44, boardY + 22, t === 0 ? 'НЕТ' : `T${t}`, TF('13px', '#4dd0e1')).setOrigin(0.5);
      btn.on('pointerdown', () => { this._cfg.boardTier = t; this._refreshBoardBtns(); this._refreshPreview(); });
      reg(btn, lbl);
      return { btn, lbl, tier: t };
    });

    // ── Уровень пилота ────────────────────────────────────────────────────
    const pLvlY = py + 468;
    reg(this.add.text(px + 20, pLvlY, 'УРОВЕНЬ ПИЛОТА', TFI('12px', '#446688')).setOrigin(0, 0.5));
    this._pilotLvlTxt = reg(this.add.text(px + PW - 20, pLvlY, '', TF('14px', '#ccddff')).setOrigin(1, 0.5));
    this._makeSlider(reg, cx, pLvlY + 18, PW - 60, 1, 50, this._cfg.pilotLevel, v => {
      this._cfg.pilotLevel = v; this._refreshPreview();
    });

    // ── Стат-превью бота ─────────────────────────────────────────────────
    this._statTxt = reg(this.add.text(cx, py + 524, '', TFI('12px', '#8899aa')).setOrigin(0.5));

    // ── Кнопки ────────────────────────────────────────────────────────────
    const startBtn = this.add.rectangle(cx - 86, py + PH - 36, 160, 44, 0x0a2a1a)
      .setStrokeStyle(2, COLORS.primary, 0.8).setInteractive({ useHandCursor: true });
    const startLbl = this.add.text(cx - 86, py + PH - 36, 'НАЧАТЬ БОЙ', TF('14px', '#4dd0e1')).setOrigin(0.5);
    startBtn.on('pointerover', () => startBtn.setFillStyle(0x1a4a2a));
    startBtn.on('pointerout',  () => startBtn.setFillStyle(0x0a2a1a));
    startBtn.on('pointerdown', () => this._launch());
    reg(startBtn, startLbl);

    const cancelBtn = this.add.rectangle(cx + 86, py + PH - 36, 160, 44, 0x1a0808)
      .setStrokeStyle(2, 0x883333, 0.8).setInteractive({ useHandCursor: true });
    const cancelLbl = this.add.text(cx + 86, py + PH - 36, 'ОТМЕНА', TF('14px', '#aa4444')).setOrigin(0.5);
    cancelBtn.on('pointerover', () => cancelBtn.setFillStyle(0x2a1010));
    cancelBtn.on('pointerout',  () => cancelBtn.setFillStyle(0x1a0808));
    cancelBtn.on('pointerdown', () => this.scene.stop());
    reg(cancelBtn, cancelLbl);

    this.input.keyboard.once('keydown-ESC', () => this.scene.stop());
    this._refreshPreview();
    this._refreshTierBtns();
    this._refreshWepBtns();
    this._refreshBoardBtns();
  }

  _refreshShipPreviewSprite() {
    const ship = this._cfg.shipDef;
    this._shipPreviewContainer.removeAll(true);
    const src   = this.textures.get(ship.key).getSourceImage();
    const scale = 80 / Math.max(src.width, src.height);
    const img   = this.add.image(0, 0, ship.key)
      .setDisplaySize(Math.round(src.width * scale), Math.round(src.height * scale))
      .setTint(0xff8888)
      .setRotation(ship.artAngleOffset ?? ART_ANGLE_OFFSET);
    this._shipPreviewContainer.add(img);
  }

  _makeSlider(reg, cx, y, w, min, max, init, onChange) {
    const bx   = cx - w / 2;
    const bg   = this.add.rectangle(cx, y, w, 4, 0x1a2a3a).setOrigin(0.5);
    const fill = this.add.rectangle(bx, y, 1, 4, COLORS.primary).setOrigin(0, 0.5);
    const thumb = this.add.rectangle(bx, y, 14, 22, 0x4dd0e1).setOrigin(0.5)
      .setInteractive({ useHandCursor: true, draggable: true });
    reg(bg, fill, thumb);

    const setVal = (px2) => {
      const t  = Phaser.Math.Clamp((px2 - bx) / w, 0, 1);
      const v  = Math.round(min + t * (max - min));
      thumb.x  = bx + t * w;
      fill.displayWidth = Math.max(1, t * w);
      onChange(v);
    };
    const initT = (init - min) / (max - min);
    thumb.x = bx + initT * w;
    fill.displayWidth = Math.max(1, initT * w);

    thumb.on('drag', (_, dragX) => setVal(Phaser.Math.Clamp(dragX, bx, bx + w)));
    bg.setInteractive().on('pointerdown', (ptr) => setVal(Phaser.Math.Clamp(ptr.x, bx, bx + w)));
  }

  _stepShip(dir) {
    this._cfg.shipIdx = (this._cfg.shipIdx + dir + BATTLE_SHIPS.length) % BATTLE_SHIPS.length;
    this._cfg.shipDef = BATTLE_SHIPS[this._cfg.shipIdx];
    this._refreshShipPreviewSprite();
    this._refreshPreview();
  }

  _refreshTierBtns() {
    this._tierBtns?.forEach(({ btn, lbl, tier }) => {
      const on = tier === this._cfg.equipTier;
      btn.setFillStyle(on ? 0x0d2a3a : 0x081420).setStrokeStyle(on ? 2 : 1, on ? COLORS.primary : 0x1e3a50);
      lbl.setColor(on ? '#ffffff' : '#4dd0e1');
    });
  }

  _refreshWepBtns() {
    this._wepBtns?.forEach(({ btn, lbl, type }) => {
      const on = type === this._cfg.weaponType;
      btn.setFillStyle(on ? 0x0d2a3a : 0x081420).setStrokeStyle(on ? 2 : 1, on ? COLORS.primary : 0x1e3a50);
      lbl.setColor(on ? '#ffffff' : '#4dd0e1');
    });
  }

  _refreshBoardBtns() {
    this._boardBtns?.forEach(({ btn, lbl, tier }) => {
      const on = tier === this._cfg.boardTier;
      btn.setFillStyle(on ? 0x0d2a3a : 0x081420).setStrokeStyle(on ? 2 : 1, on ? COLORS.primary : 0x1e3a50);
      lbl.setColor(on ? '#ffffff' : '#4dd0e1');
    });
  }

  _refreshPreview() {
    const cfg  = this._cfg;
    const ship = cfg.shipDef;
    if (this._shipNameTxt?.active) this._shipNameTxt.setText(i18n.t(ship.nameKey));
    if (this._shipTierTxt?.active) this._shipTierTxt.setText(`${ship.tier}`);
    if (this._shipLvlTxt?.active)  this._shipLvlTxt.setText(`${cfg.shipLevel}`);
    if (this._pilotLvlTxt?.active) this._pilotLvlTxt.setText(`${cfg.pilotLevel}`);
    // Stats preview — additive from base, same formula as _initBotPilot
    const m = shipLevelMods(cfg.shipLevel);
    const wSlots = Math.min(ship.wSlots, 4), sSlots = Math.min(ship.sSlots, 4);
    const BOARD_BONUS = {
      1: { hullMax: 6, cannonDmg: 5, laserDmg: 5, shieldMax: 5 },
      2: { hullMax: 12, cannonDmg: 10, laserDmg: 10, shieldMax: 8, speed: 6 },
      3: { hullMax: 20, cannonDmg: 17, laserDmg: 17, shieldMax: 14, speed: 10, shieldRegen: 8 },
    };
    const bb = BOARD_BONUS[cfg.boardTier] ?? {};
    const BU_DMG = 0.15, BU_SHD = 0.13;
    const skillHullPct = Math.min(0.30, (cfg.pilotLevel / 50) * 0.30);
    const skillDmgPct  = Math.min(0.30, (cfg.pilotLevel / 50) * 0.30);
    const skillShdPct  = Math.min(0.25, (cfg.pilotLevel / 50) * 0.25);
    const SHIELD_DUR = { 1: 300, 2: 550, 3: 900, 4: 1500 };
    const CANNON_DMG = { 1: 40, 2: 75, 3: 130, 4: 210 };
    const hull     = Math.round(ship.hullMax * m.hull * (1 + skillHullPct + (bb.hullMax || 0) / 100));
    const shld     = Math.round((ship.shieldBase + (SHIELD_DUR[cfg.equipTier] || 0) * sSlots) * m.shield * (1 + BU_SHD + skillShdPct + (bb.shieldMax || 0) / 100));
    const baseDmg  = cfg.weaponType === 'laser' ? 252 * wSlots : (CANNON_DMG[cfg.equipTier] || 75) * wSlots;
    const boardDmgPct = cfg.weaponType === 'laser' ? (bb.laserDmg || 0) : (bb.cannonDmg || 0);
    const dmg = Math.round(baseDmg * (1 + BU_DMG + skillDmgPct + boardDmgPct / 100));
    const boardStr = cfg.boardTier > 0 ? `  Плата T${cfg.boardTier}` : '';
    if (this._statTxt?.active)
      this._statTxt.setText(`HP ${hull}  Щит ${shld}  Урон ~${dmg}  Пилот ${cfg.pilotLevel}${boardStr}`);
  }

  _launch() {
    const gs = this.scene.get('GameScene');
    if (!gs) { this.scene.stop(); return; }
    const cfg = this._cfg;
    this.scene.stop();
    gs.startShadowBattle(cfg);
  }
}
