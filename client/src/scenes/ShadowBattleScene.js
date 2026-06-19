import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES, ART_ANGLE_OFFSET } from '../constants.js';
import { i18n } from '../i18n.js';
import { SHIPS, SHIP_BY_KEY, shipLevelMods, SHIP_MAX_LEVEL } from '../ships.js';

// Тиры снаряжения (базовые значения без upgrade-мультов, для быстрого расчёта)
const CANNON_BASE_DMG  = { 1: 40,  2: 75,  3: 130, 4: 210 };
const SHIELD_BASE_DUR  = { 1: 300, 2: 550, 3: 900, 4: 1500 };
const SHIELD_BASE_REG  = { 1: 30,  2: 45,  3: 70,  4: 100  };
const ENGINE_BASE_SPD  = { 1: 10,  2: 15,  3: 20,  4: 27   };
const LASER_BASE_DMG   = 252;

// ── Арена ──────────────────────────────────────────────────────────────────
// Мир арены в пикселях; камера следит за игроком.
const ARENA_W  = 3200;
const ARENA_H  = 2400;
const WALL_T   = 60;   // толщина стены
const PROJ_SPD = 680;
const FIRE_CD  = 1.0;  // сек между выстрелами

// Доступные корабли (исключаем ADMIN)
const BATTLE_SHIPS = SHIPS.filter(s => s.tier !== 'ADMIN');

// ── Рейтинг мощи ───────────────────────────────────────────────────────────
function powerRating(hull, shield, damage, speed, pilotLvl) {
  return hull * 0.4 + shield * 0.6 + damage * 14 + speed * 5 + pilotLvl * 60;
}

// ── Статы бота по конфигу ──────────────────────────────────────────────────
function computeBotStats(cfg) {
  const ship  = cfg.shipDef;
  const m     = shipLevelMods(cfg.shipLevel);
  const wSlots = Math.min(ship.wSlots, 4);
  const sSlots = Math.min(ship.sSlots, 4);
  const eSlots = ship.eSlots || 0;

  const hull   = Math.round(ship.hullMax  * m.hull);
  const shield = Math.round((ship.shieldBase + SHIELD_BASE_DUR[cfg.equipTier] * sSlots) * m.shield);
  const regen  = Math.round(SHIELD_BASE_REG[cfg.equipTier] * sSlots);
  const speed  = Math.round((ship.baseSpeed + ENGINE_BASE_SPD[cfg.equipTier] * eSlots) * m.speed);

  const baseDmg = cfg.weaponType === 'laser'
    ? LASER_BASE_DMG * wSlots
    : CANNON_BASE_DMG[cfg.equipTier] * wSlots;
  // skill bonus: pilot level linearly → ~15 skill points at lvl 50, heavy_caliber capped at 5 → +30%
  const skillDmgBonus = 1 + Math.min(0.30, (cfg.pilotLevel / 50) * 0.30);
  const skillHullBonus = 1 + Math.min(0.30, (cfg.pilotLevel / 50) * 0.30);
  const skillShdBonus  = 1 + Math.min(0.25, (cfg.pilotLevel / 50) * 0.25);
  const damage = Math.round(baseDmg * skillDmgBonus);
  const fireRate = cfg.weaponType === 'laser' ? 1.4 : 1.0;
  const penetration = cfg.weaponType === 'laser' ? 0 : 0.05;
  const projType = cfg.weaponType === 'laser' ? 'void' : (cfg.equipTier >= 3 ? 'ion' : 'plasma');

  return {
    hull: Math.round(hull * skillHullBonus),
    shield: Math.round(shield * skillShdBonus),
    regen, speed, damage, fireRate, penetration, projType,
    power: powerRating(hull, shield, damage, speed, cfg.pilotLevel),
  };
}

export default class ShadowBattleScene extends Phaser.Scene {
  constructor() { super('ShadowBattleScene'); }

  init(data) {
    // При РЕВАНШ передаётся прежний конфиг
    this._initCfg = data?.cfg || null;
  }

  create() {
    this._phase = 'config';

    // Конфигурация по умолчанию (или восстановленная при реванше)
    const prev = this._initCfg;
    this._cfg = {
      shipIdx:    prev?.shipIdx    ?? 0,
      shipDef:    prev ? (BATTLE_SHIPS[prev.shipIdx] ?? BATTLE_SHIPS[0]) : BATTLE_SHIPS[0],
      shipLevel:  prev?.shipLevel  ?? 5,
      equipTier:  prev?.equipTier  ?? 2,
      weaponType: prev?.weaponType ?? 'plasma',
      pilotLevel: prev?.pilotLevel ?? 25,
    };

    this._buildConfigPanel();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  ФАЗА 1: Конфиг
  // ══════════════════════════════════════════════════════════════════════════
  _buildConfigPanel() {
    const W = this.scale.width, H = this.scale.height;
    const cx = W / 2, cy = H / 2;
    const PW = 520, PH = 580;
    const px = cx - PW / 2, py = cy - PH / 2;
    const TF  = (sz, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: sz, color: c, resolution: UI_RES });
    const TFI = (sz, c) => ({ fontFamily: 'Inter, sans-serif', fontSize: sz, color: c, resolution: UI_RES });

    this._cfgObjs = [];
    const reg = (...os) => { os.forEach(o => this._cfgObjs.push(o)); return os[0]; };

    // Подложка
    reg(this.add.rectangle(cx, cy, W, H, 0x000010, 0.80));
    reg(this.add.rectangle(cx, cy, PW, PH, 0x030c18, 0.98)
      .setStrokeStyle(2, COLORS.primary, 0.7));
    reg(this.add.text(cx, py + 26, 'БОЙ С ТЕНЬЮ — НАСТРОЙКА', TF('18px', '#4dd0e1')).setOrigin(0.5));

    // ── Корабль (карусель) ────────────────────────────────────────────────
    reg(this.add.text(px + 20, py + 60, 'КОРАБЛЬ ПРОТИВНИКА', TFI('12px', '#446688')).setOrigin(0, 0.5));

    const shipY = py + 130;
    this._shipPreview = reg(this.add.image(cx, shipY, this._cfg.shipDef.key)
      .setDisplaySize(88, 88).setTint(0xff6666).setDepth(2));
    this._shipNameTxt = reg(this.add.text(cx, shipY + 55, '', TF('14px', '#ef9a9a')).setOrigin(0.5));
    this._shipTierTxt = reg(this.add.text(cx, shipY + 74, '', TFI('12px', '#446688')).setOrigin(0.5));

    const arrowStyle = (label, x, y) => {
      const btn = this.add.text(x, y, label, TF('24px', '#4dd0e1')).setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setColor('#80e5ff'));
      btn.on('pointerout',  () => btn.setColor('#4dd0e1'));
      reg(btn);
      return btn;
    };
    arrowStyle('◄', px + 36, shipY).on('pointerdown', () => this._stepShip(-1));
    arrowStyle('►', px + PW - 36, shipY).on('pointerdown', () => this._stepShip(+1));

    // ── Уровень корабля ───────────────────────────────────────────────────
    const sLvlY = py + 222;
    reg(this.add.text(px + 20, sLvlY, 'УРОВЕНЬ КОРАБЛЯ', TFI('12px', '#446688')).setOrigin(0, 0.5));
    this._shipLvlTxt = reg(this.add.text(px + PW - 20, sLvlY, '', TF('14px', '#ccddff')).setOrigin(1, 0.5));
    this._shipLvlBar = this._makeSlider(cx, sLvlY + 18, PW - 60, 1, SHIP_MAX_LEVEL, this._cfg.shipLevel, v => {
      this._cfg.shipLevel = v;
      this._refreshConfigPreview();
    });

    // ── Тир оборудования ──────────────────────────────────────────────────
    const tierY = py + 290;
    reg(this.add.text(px + 20, tierY, 'ТИР СНАРЯЖЕНИЯ', TFI('12px', '#446688')).setOrigin(0, 0.5));
    this._tierBtns = [1, 2, 3, 4].map((t, i) => {
      const bx = px + 20 + i * 116;
      const btn = this.add.rectangle(bx + 44, tierY + 22, 88, 30, 0x081420)
        .setStrokeStyle(1, 0x1e3a50).setInteractive({ useHandCursor: true });
      const lbl = this.add.text(bx + 44, tierY + 22, `T${t}`, TF('13px', '#4dd0e1')).setOrigin(0.5);
      btn.on('pointerdown', () => { this._cfg.equipTier = t; this._refreshConfigTierBtns(); this._refreshConfigPreview(); });
      reg(btn, lbl);
      return { btn, lbl, tier: t };
    });

    // ── Тип оружия ────────────────────────────────────────────────────────
    const wepY = py + 348;
    reg(this.add.text(px + 20, wepY, 'ОРУЖИЕ', TFI('12px', '#446688')).setOrigin(0, 0.5));
    this._wepBtns = ['plasma', 'laser'].map((wt, i) => {
      const bx = px + 160 + i * 150;
      const labels = { plasma: 'ПЛАЗМА', laser: 'ЛАЗЕР' };
      const btn = this.add.rectangle(bx, wepY + 22, 130, 30, 0x081420)
        .setStrokeStyle(1, 0x1e3a50).setInteractive({ useHandCursor: true });
      const lbl = this.add.text(bx, wepY + 22, labels[wt], TF('12px', '#4dd0e1')).setOrigin(0.5);
      btn.on('pointerdown', () => { this._cfg.weaponType = wt; this._refreshConfigWepBtns(); this._refreshConfigPreview(); });
      reg(btn, lbl);
      return { btn, lbl, type: wt };
    });

    // ── Уровень пилота ────────────────────────────────────────────────────
    const pLvlY = py + 406;
    reg(this.add.text(px + 20, pLvlY, 'УРОВЕНЬ ПИЛОТА', TFI('12px', '#446688')).setOrigin(0, 0.5));
    this._pilotLvlTxt = reg(this.add.text(px + PW - 20, pLvlY, '', TF('14px', '#ccddff')).setOrigin(1, 0.5));
    this._pilotLvlBar = this._makeSlider(cx, pLvlY + 18, PW - 60, 1, 50, this._cfg.pilotLevel, v => {
      this._cfg.pilotLevel = v;
      this._refreshConfigPreview();
    });

    // ── Предпросмотр статов бота ──────────────────────────────────────────
    const statY = py + 462;
    this._botStatTxt = reg(this.add.text(cx, statY, '', TFI('12px', '#8899aa')).setOrigin(0.5));

    // ── Кнопки ────────────────────────────────────────────────────────────
    const startBtn = this.add.rectangle(cx - 86, py + PH - 36, 160, 44, 0x0a2a1a)
      .setStrokeStyle(2, COLORS.primary, 0.8).setInteractive({ useHandCursor: true });
    const startLbl = this.add.text(cx - 86, py + PH - 36, 'НАЧАТЬ БОЙ', TF('14px', '#4dd0e1')).setOrigin(0.5);
    startBtn.on('pointerover',  () => startBtn.setFillStyle(0x1a4a2a));
    startBtn.on('pointerout',   () => startBtn.setFillStyle(0x0a2a1a));
    startBtn.on('pointerdown',  () => this._launchBattle());
    reg(startBtn, startLbl);

    const cancelBtn = this.add.rectangle(cx + 86, py + PH - 36, 160, 44, 0x1a0808)
      .setStrokeStyle(2, 0x883333, 0.8).setInteractive({ useHandCursor: true });
    const cancelLbl = this.add.text(cx + 86, py + PH - 36, 'ОТМЕНА', TF('14px', '#aa4444')).setOrigin(0.5);
    cancelBtn.on('pointerover',  () => cancelBtn.setFillStyle(0x2a1010));
    cancelBtn.on('pointerout',   () => cancelBtn.setFillStyle(0x1a0808));
    cancelBtn.on('pointerdown',  () => this.scene.stop());
    reg(cancelBtn, cancelLbl);

    this.input.keyboard.once('keydown-ESC', () => this.scene.stop());

    this._refreshConfigPreview();
    this._refreshConfigTierBtns();
    this._refreshConfigWepBtns();
  }

  // Слайдер: возвращает { bar, thumb, val }
  _makeSlider(cx, y, w, min, max, init, onChange) {
    const bx = cx - w / 2;
    const bg   = this.add.rectangle(cx, y, w, 4, 0x1a2a3a).setOrigin(0.5);
    const fill = this.add.rectangle(bx, y, 1, 4, COLORS.primary).setOrigin(0, 0.5);
    const thumb = this.add.rectangle(bx, y, 14, 22, 0x4dd0e1).setOrigin(0.5)
      .setInteractive({ useHandCursor: true, draggable: true });
    this._cfgObjs.push(bg, fill, thumb);

    const slider = { min, max, val: init, w, bx, fill, thumb, onChange };
    const setVal = (px) => {
      const t = Phaser.Math.Clamp((px - bx) / w, 0, 1);
      slider.val = Math.round(min + t * (max - min));
      thumb.x = bx + t * w;
      fill.displayWidth = Math.max(1, t * w);
      onChange(slider.val);
    };
    // Init position
    const initT = (init - min) / (max - min);
    thumb.x = bx + initT * w;
    fill.displayWidth = Math.max(1, initT * w);

    thumb.on('drag', (_, dragX) => setVal(Phaser.Math.Clamp(dragX, bx, bx + w)));
    bg.setInteractive().on('pointerdown', (ptr) => setVal(Phaser.Math.Clamp(ptr.x, bx, bx + w)));

    return slider;
  }

  _stepShip(dir) {
    this._cfg.shipIdx = (this._cfg.shipIdx + dir + BATTLE_SHIPS.length) % BATTLE_SHIPS.length;
    this._cfg.shipDef = BATTLE_SHIPS[this._cfg.shipIdx];
    this._refreshConfigPreview();
  }

  _refreshConfigTierBtns() {
    this._tierBtns?.forEach(({ btn, lbl, tier }) => {
      const active = tier === this._cfg.equipTier;
      btn.setFillStyle(active ? 0x0d2a3a : 0x081420)
         .setStrokeStyle(active ? 2 : 1, active ? COLORS.primary : 0x1e3a50, active ? 1 : 0.8);
      lbl.setColor(active ? '#ffffff' : '#4dd0e1');
    });
  }

  _refreshConfigWepBtns() {
    this._wepBtns?.forEach(({ btn, lbl, type }) => {
      const active = type === this._cfg.weaponType;
      btn.setFillStyle(active ? 0x0d2a3a : 0x081420)
         .setStrokeStyle(active ? 2 : 1, active ? COLORS.primary : 0x1e3a50, active ? 1 : 0.8);
      lbl.setColor(active ? '#ffffff' : '#4dd0e1');
    });
  }

  _refreshConfigPreview() {
    const cfg = this._cfg;
    const ship = cfg.shipDef;
    if (this._shipPreview?.active) {
      this._shipPreview.setTexture(ship.key).setDisplaySize(88, 88);
      this._shipPreview.setRotation(ship.artAngleOffset ?? ART_ANGLE_OFFSET);
    }
    if (this._shipNameTxt?.active) this._shipNameTxt.setText(i18n.t(ship.nameKey));
    if (this._shipTierTxt?.active) this._shipTierTxt.setText(`${ship.tier} · ${i18n.t('mob.level')}${ship.levelGate}+`);
    if (this._shipLvlTxt?.active) this._shipLvlTxt.setText(`${cfg.shipLevel}`);
    if (this._pilotLvlTxt?.active) this._pilotLvlTxt.setText(`${cfg.pilotLevel}`);

    const stats = computeBotStats(cfg);
    if (this._botStatTxt?.active) {
      this._botStatTxt.setText(
        `Корпус: ${stats.hull}  Щит: ${stats.shield}  Урон: ${stats.damage}  Скорость: ${stats.speed}`
      );
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  ФАЗА 2: Битва
  // ══════════════════════════════════════════════════════════════════════════
  _launchBattle() {
    // Уничтожаем конфиг-UI
    this._cfgObjs?.forEach(o => o?.destroy());
    this._cfgObjs = null;
    this.input.keyboard.removeAllListeners();

    this._phase = 'battle';
    this._buildArena();
  }

  _buildArena() {
    const gs  = this.scene.get('GameScene');
    const gsp = gs?.player;
    const W   = this.scale.width, H = this.scale.height;

    // ── Игрок: зеркало статов из GameScene ────────────────────────────────
    const pHull   = gsp?.maxHull   || 1000;
    const pShield = gsp?.maxShield || 500;
    const pDmg    = gsp?.weaponDamage || 120;
    const pSpeed  = gsp?.baseSpeed || 200;
    const pLevel  = gs?.pilotLevel || 1;
    const pPower  = powerRating(pHull, pShield, pDmg, pSpeed, pLevel);
    const pShipKey = gs?.activeShip || 'wisp';
    const pShipDef = SHIP_BY_KEY[pShipKey] || SHIPS[0];

    // ── Бот: вычисляем из конфига ──────────────────────────────────────────
    const botStats = computeBotStats(this._cfg);
    const botShipDef = this._cfg.shipDef;

    this._battle = {
      // Игрок
      pHull, pMaxHull: pHull, pShield, pMaxShield: pShield,
      pDmg, pSpeed, pPen: gsp?.weaponPenetration || 0.05, pFireCd: 0,
      pX: ARENA_W / 2 - 600, pY: ARENA_H / 2,
      pVx: 0, pVy: 0, pHeading: 0, pWaypoint: null,
      pShipDef, pSize: pShipDef.displaySize * 0.55,
      // Бот
      bHull: botStats.hull, bMaxHull: botStats.hull,
      bShield: botStats.shield, bMaxShield: botStats.shield,
      bDmg: botStats.damage, bSpeed: botStats.speed,
      bRegen: botStats.regen, bPen: botStats.penetration,
      bFireRate: botStats.fireRate, bFireCd: 1.2,
      bProjType: botStats.projType,
      bX: ARENA_W / 2 + 600, bY: ARENA_H / 2,
      bHeading: Math.PI, bState: 'approach',
      bStrafeDir: 1, bStrafeTimer: 0, bDashTimer: 0,
      bRepairUsed: false, bRepairTimer: 0,
      botShipDef, bSize: botShipDef.displaySize * 0.55,
      // Метаданные
      botPower: botStats.power, playerPower: pPower,
      done: false,
    };
    const b = this._battle;

    // ── Камера ────────────────────────────────────────────────────────────
    this.cameras.main.setBounds(0, 0, ARENA_W, ARENA_H);
    this._followTarget = { x: b.pX, y: b.pY };
    this.cameras.main.startFollow(this._followTarget, false, 0.08, 0.08);

    // ── Задний фон арены ───────────────────────────────────────────────────
    // Тёмный фон
    this.add.rectangle(ARENA_W / 2, ARENA_H / 2, ARENA_W, ARENA_H, 0x010812).setDepth(-10);
    // Сетка
    const gfxGrid = this.add.graphics().setDepth(-9);
    gfxGrid.lineStyle(1, 0x0a1a28, 0.7);
    for (let gx = 0; gx <= ARENA_W; gx += 160) gfxGrid.lineBetween(gx, 0, gx, ARENA_H);
    for (let gy = 0; gy <= ARENA_H; gy += 160) gfxGrid.lineBetween(0, gy, ARENA_W, gy);
    // Стены арены
    const wallGfx = this.add.graphics().setDepth(-8);
    wallGfx.fillStyle(0x0d2233, 1);
    wallGfx.fillRect(0, 0, ARENA_W, WALL_T);
    wallGfx.fillRect(0, ARENA_H - WALL_T, ARENA_W, WALL_T);
    wallGfx.fillRect(0, 0, WALL_T, ARENA_H);
    wallGfx.fillRect(ARENA_W - WALL_T, 0, WALL_T, ARENA_H);
    wallGfx.lineStyle(3, COLORS.primary, 0.6);
    wallGfx.strokeRect(WALL_T, WALL_T, ARENA_W - WALL_T * 2, ARENA_H - WALL_T * 2);
    // Угловые декорации
    [[WALL_T, WALL_T], [ARENA_W - WALL_T, WALL_T], [WALL_T, ARENA_H - WALL_T], [ARENA_W - WALL_T, ARENA_H - WALL_T]].forEach(([cx, cy]) => {
      wallGfx.fillStyle(COLORS.primary, 0.25); wallGfx.fillCircle(cx, cy, 18);
    });
    // Надпись в углу
    this.add.text(WALL_T + 14, WALL_T + 10, 'БОЙ С ТЕНЬЮ', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '14px', color: '#1a3a50', resolution: UI_RES,
    }).setDepth(-7);

    // ── Спрайты кораблей ───────────────────────────────────────────────────
    this._pSprite = this.add.image(b.pX, b.pY, pShipKey)
      .setDisplaySize(b.pSize, b.pSize).setDepth(20);
    this._bSprite = this.add.image(b.bX, b.bY, botShipDef.key)
      .setDisplaySize(b.bSize, b.bSize).setTint(0xff5555).setDepth(20);

    // ── Снаряды ────────────────────────────────────────────────────────────
    this._projs  = [];
    this._projGfx = this.add.graphics().setDepth(25);

    // ── HUD (camera-fixed) ────────────────────────────────────────────────
    const TF  = (sz, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: sz, color: c, resolution: UI_RES });
    const TFI = (sz, c) => ({ fontFamily: 'Inter, sans-serif', fontSize: sz, color: c, resolution: UI_RES });
    this._hudGfx = this.add.graphics().setScrollFactor(0).setDepth(90);
    const hudY = H - 72;
    this.add.text(20, hudY - 14,       'ВЫ',    TFI('11px', '#88aacc')).setScrollFactor(0).setDepth(91);
    this.add.text(W - 20, hudY - 14,   'ТЕНЬ',  TFI('11px', '#cc8888')).setOrigin(1, 0).setScrollFactor(0).setDepth(91);
    this._pHullTxt = this.add.text(20, hudY + 22, '', TFI('12px', '#aabbcc')).setScrollFactor(0).setDepth(91);
    this._bHullTxt = this.add.text(W - 20, hudY + 22, '', TFI('12px', '#ccaabb')).setOrigin(1, 0).setScrollFactor(0).setDepth(91);
    this._statusTxt = this.add.text(W / 2, hudY + 4, '', TFI('13px', '#ffcc44')).setOrigin(0.5, 0).setScrollFactor(0).setDepth(91);

    // ── Ввод ───────────────────────────────────────────────────────────────
    this.input.on('pointerdown', (ptr) => {
      if (this._battle.done) return;
      const wp = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
      this._battle.pWaypoint = {
        x: Phaser.Math.Clamp(wp.x, WALL_T + 16, ARENA_W - WALL_T - 16),
        y: Phaser.Math.Clamp(wp.y, WALL_T + 16, ARENA_H - WALL_T - 16),
      };
    });
    this.input.keyboard.once('keydown-ESC', () => this._endBattle(null));

    // Рейтинг над UI
    const diff = b.botPower - b.playerPower;
    const diffPct = Math.round((diff / b.playerPower) * 100);
    const diffColor = diff > 0 ? '#ef5350' : diff < -10 ? '#66bb6a' : '#ffb74d';
    const diffText  = diff > 0
      ? `Противник сильнее на ${diffPct}% — честь будет начислена за победу`
      : diff < -10
        ? `Противник слабее на ${Math.abs(diffPct)}% — честь не начисляется`
        : 'Сопоставимые сборки';
    this._diffTxt = this.add.text(W / 2, 16, diffText, TFI('12px', diffColor))
      .setOrigin(0.5, 0).setScrollFactor(0).setDepth(91);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  UPDATE
  // ══════════════════════════════════════════════════════════════════════════
  update(_, delta) {
    if (this._phase !== 'battle') return;
    const b = this._battle;
    if (b.done) return;
    const dt = delta / 1000;

    this._updatePlayer(dt, b);
    this._updateBot(dt, b);
    this._updateProjectiles(dt, b);
    this._updateHUD(b);
    this._checkWinLose(b);

    // Следим камерой за игроком
    this._followTarget.x = b.pX;
    this._followTarget.y = b.pY;
  }

  // ── Игрок ─────────────────────────────────────────────────────────────────
  _updatePlayer(dt, b) {
    if (b.pWaypoint) {
      const dx = b.pWaypoint.x - b.pX, dy = b.pWaypoint.y - b.pY;
      const dist = Math.hypot(dx, dy);
      if (dist < 12) {
        b.pWaypoint = null;
        b.pVx *= 0.5; b.pVy *= 0.5;
      } else {
        const target = Math.atan2(dy, dx);
        b.pHeading = Phaser.Math.Angle.RotateTo(b.pHeading, target, 5.5 * dt);
        const spd = Math.min(b.pSpeed, dist > 60 ? b.pSpeed : b.pSpeed * (dist / 60));
        b.pVx = Math.cos(b.pHeading) * spd;
        b.pVy = Math.sin(b.pHeading) * spd;
      }
    } else {
      b.pVx *= Math.pow(0.12, dt);
      b.pVy *= Math.pow(0.12, dt);
    }

    b.pX = Phaser.Math.Clamp(b.pX + b.pVx * dt, WALL_T + 16, ARENA_W - WALL_T - 16);
    b.pY = Phaser.Math.Clamp(b.pY + b.pVy * dt, WALL_T + 16, ARENA_H - WALL_T - 16);
    this._pSprite.setPosition(b.pX, b.pY);
    this._pSprite.setRotation(b.pHeading + (b.pShipDef.artAngleOffset ?? ART_ANGLE_OFFSET));

    // Щит регенерирует (простая логика)
    b.pShield = Math.min(b.pMaxShield, b.pShield + b.pMaxShield * 0.02 * dt);

    // Авто-огонь по боту
    b.pFireCd -= dt;
    if (b.pFireCd <= 0) {
      b.pFireCd = FIRE_CD;
      const gs = this.scene.get('GameScene');
      const gsp = gs?.player;
      // Используем реальный тип оружия игрока
      const hasLaser = gsp?.hasLaser;
      this._fireProjectile('player', b.pX, b.pY, b.bX, b.bY, hasLaser ? 'void' : 'plasma', b.pDmg, b.pPen);
    }
  }

  // ── Бот ───────────────────────────────────────────────────────────────────
  _updateBot(dt, b) {
    const dist = Math.hypot(b.bX - b.pX, b.bY - b.pY);
    b.bFireCd -= dt;
    b.bDashTimer -= dt;
    b.bStrafeTimer -= dt;
    b.bRepairTimer -= dt;

    // Щит реген
    b.bShield = Math.min(b.bMaxShield, b.bShield + b.bRegen * dt);

    // Ремкомплект при HP < 30%
    if (!b.bRepairUsed && b.bHull / b.bMaxHull < 0.30) {
      b.bRepairUsed = true;
      const heal = Math.round(b.bMaxHull * 0.35);
      b.bHull = Math.min(b.bMaxHull, b.bHull + heal);
      b.bShield = Math.min(b.bMaxShield, b.bShield + b.bMaxShield * 0.5);
      this._setStatus('ТЕНЬ использует ремкомплект!', '#80ff80', 2.0);
      this._bSprite.setTint(0xaaffaa);
      this.time.delayedCall(400, () => { if (this._bSprite?.active) this._bSprite.setTint(0xff5555); });
    }

    // Boost-побег при критически низком HP
    const fleeing = b.bHull / b.bMaxHull < 0.15;

    // Выбор состояния
    const STRAFE_DIST = Math.min(600, b.bSpeed * 2.5);
    if (fleeing) {
      b.bState = 'flee';
    } else if (dist > STRAFE_DIST * 1.4) {
      b.bState = 'approach';
    } else if (dist < STRAFE_DIST * 0.5) {
      b.bState = 'retreat';
    } else {
      b.bState = 'strafe';
    }

    // Dodge: уклонение от летящих снарядов
    if (b.bDashTimer <= 0) {
      for (const p of this._projs) {
        if (p.owner !== 'player') continue;
        if (Math.hypot(p.x - b.bX, p.y - b.bY) < 200) {
          b.bHeading += Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
          b.bDashTimer = 0.55;
          break;
        }
      }
    }

    let speed = b.bSpeed;
    if (b.bState === 'approach') {
      b.bHeading = Math.atan2(b.pY - b.bY, b.pX - b.bX);
    } else if (b.bState === 'retreat' || b.bState === 'flee') {
      b.bHeading = Math.atan2(b.bY - b.pY, b.bX - b.pX);
      speed = b.bSpeed * 1.3;
    } else {
      // Strafe: перпендикуляр со сменой направления
      if (b.bStrafeTimer <= 0) {
        b.bStrafeDir  *= -1;
        b.bStrafeTimer = Phaser.Math.FloatBetween(0.9, 1.8);
      }
      const toPlayer = Math.atan2(b.pY - b.bY, b.pX - b.bX);
      b.bHeading = toPlayer + Math.PI / 2 * b.bStrafeDir;
    }

    // Движение к ближайшей свободной точке (учитывая стены)
    const nx = Phaser.Math.Clamp(b.bX + Math.cos(b.bHeading) * speed * dt, WALL_T + 16, ARENA_W - WALL_T - 16);
    const ny = Phaser.Math.Clamp(b.bY + Math.sin(b.bHeading) * speed * dt, WALL_T + 16, ARENA_H - WALL_T - 16);
    b.bX = nx; b.bY = ny;
    this._bSprite.setPosition(b.bX, b.bY);
    this._bSprite.setRotation(b.bHeading + (b.botShipDef.artAngleOffset ?? ART_ANGLE_OFFSET));

    // Стрельба
    if (b.bFireCd <= 0 && dist < 1000 && b.bState !== 'flee') {
      b.bFireCd = FIRE_CD / b.bFireRate;
      this._fireProjectile('bot', b.bX, b.bY, b.pX, b.pY, b.bProjType, b.bDmg, b.bPen);
    }
  }

  // ── Снаряды ───────────────────────────────────────────────────────────────
  _fireProjectile(owner, fx, fy, tx, ty, type, damage, pen) {
    const ang = Math.atan2(ty - fy, tx - fx);
    const COLORS_MAP = {
      plasma: 0xef5350, ion: 0x80d8ff, acid: 0x76ff03, grav: 0xffb74d, emp: 0x4dd0e1, void: 0xce93d8,
    };
    const speeds  = { plasma: PROJ_SPD, ion: PROJ_SPD, acid: 560, grav: 400, emp: 520, void: 999999 };
    const sizes   = { plasma: 4, ion: 3, acid: 8, grav: 8, emp: 6, void: 0 };
    const hitR    = { plasma: 28, ion: 22, acid: 32, grav: 30, emp: 26, void: 0 };

    if (type === 'void') {
      // Хитскан: прямой урон без снаряда
      this._applyHit(owner, damage, pen);
      // Визуальная линия
      const lineGfx = this.add.graphics().setDepth(30);
      lineGfx.lineStyle(2, 0xce93d8, 0.85);
      lineGfx.lineBetween(fx, fy, tx, ty);
      this.tweens.add({ targets: lineGfx, alpha: 0, duration: 120, onComplete: () => lineGfx.destroy() });
      return;
    }

    if (type === 'ion') {
      // 3 болта веером
      for (const off of [-0.18, 0, 0.18]) {
        const a = ang + off;
        this._projs.push({ owner, x: fx, y: fy, vx: Math.cos(a) * speeds.ion, vy: Math.sin(a) * speeds.ion,
          type, damage: damage * 0.4, pen, life: 2.0, hitR: hitR.ion, size: sizes.ion, color: COLORS_MAP.ion });
      }
      return;
    }

    this._projs.push({
      owner, x: fx, y: fy,
      vx: Math.cos(ang) * speeds[type], vy: Math.sin(ang) * speeds[type],
      type, damage, pen, life: 2.2,
      hitR: hitR[type] || 26, size: sizes[type] || 4, color: COLORS_MAP[type] || 0xffffff,
    });
  }

  _updateProjectiles(dt, b) {
    this._projGfx.clear();
    this._projs = this._projs.filter(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) return false;
      if (p.x < WALL_T || p.x > ARENA_W - WALL_T || p.y < WALL_T || p.y > ARENA_H - WALL_T) return false;

      const hitP = p.owner === 'bot'    && Math.hypot(p.x - b.pX, p.y - b.pY) < p.hitR;
      const hitB = p.owner === 'player' && Math.hypot(p.x - b.bX, p.y - b.bY) < p.hitR;
      if (hitP || hitB) { this._applyHit(p.owner, p.damage, p.pen, p.type); return false; }

      // Рисуем снаряд
      this._projGfx.fillStyle(p.color, 0.92);
      if (p.type === 'acid' || p.type === 'grav') {
        this._projGfx.fillCircle(p.x, p.y, p.size);
      } else {
        this._projGfx.fillRect(p.x - p.size * 1.5, p.y - p.size / 2, p.size * 3, p.size);
      }
      return true;
    });
  }

  _applyHit(shooterOwner, damage, pen, type) {
    const b = this._battle;
    const pen2 = pen || 0.05;
    const direct = damage * pen2;
    const toShield = damage - direct;

    if (shooterOwner === 'bot') {
      // Бот попал в игрока
      if (b.pShield > 0) {
        const sh = Math.min(b.pShield, toShield);
        b.pShield -= sh;
        b.pHull   -= (toShield - sh) + direct;
      } else { b.pHull -= damage; }
      b.pHull = Math.max(0, b.pHull);
      // Эффект-статус
      const efx = { acid: '☣ Кислота!', emp: '⚡ ЭМИ!', grav: '↗ Гравпульс!' }[type];
      if (efx) this._setStatus(efx, '#ffcc44', 1.5);
    } else {
      // Игрок попал в бота
      if (b.bShield > 0) {
        const sh = Math.min(b.bShield, toShield);
        b.bShield -= sh;
        b.bHull   -= (toShield - sh) + direct;
      } else { b.bHull -= damage; }
      b.bHull = Math.max(0, b.bHull);
    }
  }

  // ── HUD ───────────────────────────────────────────────────────────────────
  _updateHUD(b) {
    const W = this.scale.width, H = this.scale.height;
    const g = this._hudGfx; g.clear();
    const barW = Math.round(W * 0.38), hudY = H - 56;

    // Игрок: слева
    const phf = Math.max(0, b.pHull / b.pMaxHull);
    const psf = Math.max(0, b.pShield / b.pMaxShield);
    g.fillStyle(0x111a22, 0.85); g.fillRoundedRect(16, hudY, barW, 10, 3);
    g.fillStyle(COLORS.danger);  g.fillRoundedRect(16, hudY, barW * phf, 10, 3);
    g.fillStyle(0x111a22, 0.85); g.fillRoundedRect(16, hudY - 14, barW, 7, 2);
    g.fillStyle(COLORS.primary); g.fillRoundedRect(16, hudY - 14, barW * psf, 7, 2);
    this._pHullTxt.setText(`${Math.ceil(b.pHull)} / ${b.pMaxHull}`);

    // Бот: справа
    const bhf = Math.max(0, b.bHull / b.bMaxHull);
    const bsf = Math.max(0, b.bShield / b.bMaxShield);
    g.fillStyle(0x111a22, 0.85); g.fillRoundedRect(W - 16 - barW, hudY, barW, 10, 3);
    g.fillStyle(0xef5350);       g.fillRoundedRect(W - 16 - barW, hudY, barW * bhf, 10, 3);
    g.fillStyle(0x111a22, 0.85); g.fillRoundedRect(W - 16 - barW, hudY - 14, barW, 7, 2);
    g.fillStyle(0xff8866);       g.fillRoundedRect(W - 16 - barW, hudY - 14, barW * bsf, 7, 2);
    this._bHullTxt.setText(`${Math.ceil(b.bHull)} / ${b.bMaxHull}`);
  }

  _setStatus(text, color, dur) {
    if (!this._statusTxt?.active) return;
    this._statusTxt.setText(text).setColor(color);
    if (this._statusTimer) clearTimeout(this._statusTimer);
    this._statusTimer = setTimeout(() => { if (this._statusTxt?.active) this._statusTxt.setText(''); }, dur * 1000);
  }

  // ── Победа / поражение ────────────────────────────────────────────────────
  _checkWinLose(b) {
    if (b.pHull <= 0) this._endBattle('lose', b);
    else if (b.bHull <= 0) this._endBattle('win', b);
  }

  _endBattle(result, b) {
    if (this._battle?.done) return;
    if (this._battle) this._battle.done = true;
    this.input.off('pointerdown');
    if (this._statusTimer) clearTimeout(this._statusTimer);

    if (result === null) { this.scene.stop(); return; }

    const W = this.scale.width, H = this.scale.height;
    const cx = W / 2, cy = H / 2;
    const TF  = (sz, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: sz, color: c, resolution: UI_RES });
    const TFI = (sz, c) => ({ fontFamily: 'Inter, sans-serif', fontSize: sz, color: c, resolution: UI_RES });

    const gs = this.scene.get('GameScene');
    let xpGain = 0, credGain = 0, honorGain = 0;

    if (result === 'win') {
      xpGain   = 3500;
      credGain = 12000;
      const isStronger = b && b.botPower > b.playerPower;
      if (isStronger) honorGain = Math.round(50 * (b.botPower / b.playerPower));
      gs?.gainXp?.(xpGain);
      if (gs) {
        gs.credits     = (gs.credits || 0) + credGain;
        gs.pilotHonor  = (gs.pilotHonor || 0) + honorGain;
      }
    }

    const panH = result === 'win' ? 300 : 220;
    const panW = 460;

    const panBg = this.add.rectangle(cx, cy, panW, panH, 0x040c18, 0.97)
      .setStrokeStyle(2, result === 'win' ? COLORS.primary : 0xef5350, 0.9)
      .setScrollFactor(0).setDepth(100);

    const title = result === 'win' ? '✓  ПОБЕДА' : '✗  ПОРАЖЕНИЕ';
    const titleColor = result === 'win' ? '#4dd0e1' : '#ef5350';
    this.add.text(cx, cy - panH / 2 + 34, title, TF('28px', titleColor))
      .setOrigin(0.5).setScrollFactor(0).setDepth(101);

    if (result === 'win') {
      this.add.text(cx, cy - 28, `+${xpGain.toLocaleString()} XP`,    TF('17px', '#88ff88')).setOrigin(0.5).setScrollFactor(0).setDepth(101);
      this.add.text(cx, cy - 4,  `+${credGain.toLocaleString()} кредитов`, TF('15px', '#ffcc44')).setOrigin(0.5).setScrollFactor(0).setDepth(101);
      if (honorGain > 0)
        this.add.text(cx, cy + 20, `+${honorGain} очков чести`, TF('14px', '#aaddff')).setOrigin(0.5).setScrollFactor(0).setDepth(101);
      else
        this.add.text(cx, cy + 20, 'Честь не начислена — противник слабее вас', TFI('12px', '#557788')).setOrigin(0.5).setScrollFactor(0).setDepth(101);
    } else {
      this.add.text(cx, cy - 10, 'Тень оказалась сильнее.', TFI('15px', '#bb6666')).setOrigin(0.5).setScrollFactor(0).setDepth(101);
    }

    const closeY = cy + panH / 2 - 44;
    const closeBtn = this.add.rectangle(cx - 100, closeY, 180, 42, 0x0d2233)
      .setStrokeStyle(1, COLORS.primary, 0.8).setInteractive({ useHandCursor: true })
      .setScrollFactor(0).setDepth(101);
    this.add.text(cx - 100, closeY, 'НА БАЗУ', TF('14px', '#4dd0e1'))
      .setOrigin(0.5).setScrollFactor(0).setDepth(102);
    closeBtn.on('pointerdown', () => this.scene.stop());
    closeBtn.on('pointerover',  () => closeBtn.setFillStyle(0x1a3a50));
    closeBtn.on('pointerout',   () => closeBtn.setFillStyle(0x0d2233));

    const retryBtn = this.add.rectangle(cx + 100, closeY, 180, 42, 0x1a1a0d)
      .setStrokeStyle(1, 0x998833, 0.8).setInteractive({ useHandCursor: true })
      .setScrollFactor(0).setDepth(101);
    this.add.text(cx + 100, closeY, 'РЕВАНШ', TF('14px', '#ccbb44'))
      .setOrigin(0.5).setScrollFactor(0).setDepth(102);
    retryBtn.on('pointerdown', () => this.scene.restart({ cfg: this._cfg }));
    retryBtn.on('pointerover',  () => retryBtn.setFillStyle(0x2a2a10));
    retryBtn.on('pointerout',   () => retryBtn.setFillStyle(0x1a1a0d));
  }
}
