import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES, BASE_SCAN_RADIUS } from '../constants.js';
import { i18n } from '../i18n.js';
import { levelInfo, MAX_LEVEL } from '../leveling.js';
import { minimapRect, worldToMinimap } from '../systems/minimap.js';
import { SECTORS, galaxy } from '../galaxy.js';

// Оверлей-сцена HUD. Читает статы из GameScene, слушает события лога.
export default class HudScene extends Phaser.Scene {
  constructor() { super({ key: 'HudScene', active: false }); }

  create() {
    this.gs = this.scene.get('GameScene');
    this.bars = this.add.graphics().setDepth(100);
    this.miniGfx = this.add.graphics().setDepth(101);   // миникарта — векторные блипы

    const F = (size, color = '#cfe9ee', weight = '600') =>
      ({ fontFamily: 'Inter, sans-serif', fontSize: size, color, fontStyle: weight, resolution: UI_RES });
    const O = (size, color = '#4dd0e1') =>
      ({ fontFamily: 'Orbitron, sans-serif', fontSize: size, color, resolution: UI_RES });

    // Панель игрока (лев-верх) — фиксированный вертикальный layout
    this.pName = this.add.text(20, 14, '', O('18px')).setDepth(101);
    this.pShieldTxt = this.add.text(20, 48, '', F('12px', '#4dd0e1')).setDepth(101);
    this.pHullTxt = this.add.text(20, 82, '', F('12px', '#66bb6a')).setDepth(101);
    this.pSpeed = this.add.text(20, 116, '', F('12px', '#9fb3b8')).setDepth(101);
    this.pCredits = this.add.text(20, 136, '', F('12px', '#ffb74d')).setDepth(101);
    this.pStarGold = this.add.text(20, 156, '', F('12px', '#ffd54f')).setDepth(101);
    // Уровень пилота + XP-бар (растёт только за PvE)
    this.pPilot = this.add.text(20, 182, '', O('13px', '#b39ddb')).setDepth(101);
    this.pRank = this.add.text(20, 218, '', O('14px', '#ffcc80')).setDepth(101); // Оранжевый/золотистый для ранга
    this.pXpTxt = this.add.text(240, 184, '', F('10px', '#9fb3b8')).setOrigin(1, 0).setDepth(101);

    // Панель цели (центр-верх)
    this.tName = this.add.text(0, 16, '', O('16px', '#ef5350')).setOrigin(0.5, 0).setDepth(101);
    this.tHullTxt = this.add.text(0, 44, '', F('11px', '#ef9a9a')).setOrigin(0.5, 0).setDepth(101);

    // Безопасная зона (центр-верх под целью)
    this.safeTxt = this.add.text(0, 0, i18n.t('hud.safezone'), O('13px', '#4dd0e1'))
      .setOrigin(0.5, 0).setDepth(101).setVisible(false);

    // Подсказка управления (низ-центр)
    this.hint = this.add.text(0, 0, i18n.t('hud.controls'), F('11px', '#7e9398'))
      .setOrigin(0.5, 1).setDepth(101);

    // Лог событий (лев-низ)
    this.logEntries = [];
    this.game.events.on('hud-log', this.pushLog, this);
    this.events.once('shutdown', () => this.game.events.off('hud-log', this.pushLog, this));

    // Action bar (10 slots)
    this._abSlots = null;
    this._buildActionBarHUD();

    // Cargo indicator (always visible)
    this._cargoTxt = this.add.text(0, 0, '', F('11px', '#7e9398')).setOrigin(1, 0.5).setDepth(101);

    // Base nav bar (dynamic — built/destroyed on atBase change)
    this._navObjs = null;
    this._navBtnItems = null;
    this._lastAtBase = false;

    // DEV: кнопка Premium (правый нижний угол)
    if (this.gs.devMode) {
      const W = this.scale.width, H = this.scale.height;
      const BW = 110, BH = 26, BX = W - BW - 8, BY = H - BH - 8;
      const devBg = this.add.rectangle(BX, BY, BW, BH, 0x1a0d00, 0.92)
        .setOrigin(0, 0).setDepth(200).setInteractive({ useHandCursor: true })
        .setStrokeStyle(1, 0x554422, 0.8);
      this._devPremTxt = this.add.text(BX + BW / 2, BY + BH / 2, 'DEV  ⭐ premium',
        F('10px', '#ffb74d')).setOrigin(0.5).setDepth(201);
      devBg.on('pointerdown', () => {
        this.gs.premium = !this.gs.premium;
        this._devPremTxt.setText(this.gs.premium ? 'DEV  ⭐ PREMIUM ✓' : 'DEV  ⭐ premium');
        this._devPremTxt.setColor(this.gs.premium ? '#ffd54f' : '#ffb74d');
        devBg.setFillStyle(this.gs.premium ? 0x2a1a00 : 0x1a0d00, 0.92);
      });
      devBg.on('pointerover', () => devBg.setAlpha(0.75));
      devBg.on('pointerout',  () => devBg.setAlpha(1));
    }
  }

  _buildActionBarHUD() {
    const W = this.scale.width, H = this.scale.height;
    const SW = 52, SH = 52, GAP = 4, N = 10;
    const startX = Math.round((W - (N * SW + (N - 1) * GAP)) / 2);
    const barY   = H - SH - 10;

    this._abSlots = Array.from({ length: N }, (_, i) => {
      const sx = startX + i * (SW + GAP);

      const bg = this.add.graphics().setDepth(101);
      bg.fillStyle(0x0a1828, 0.92);
      bg.fillRoundedRect(sx, barY, SW, SH, 5);
      bg.lineStyle(1, 0x1e4060, 1);
      bg.strokeRoundedRect(sx, barY, SW, SH, 5);

      const cdGfx = this.add.graphics().setDepth(103);
      const hkStyle = { fontFamily: 'Inter, sans-serif', fontSize: '9px', color: '#4a6680', resolution: UI_RES };
      const hk = this.add.text(sx + 3, barY + 2, i < 9 ? `${i + 1}` : '0', hkStyle).setDepth(104);
      const cdStyle = { fontFamily: 'Orbitron, sans-serif', fontSize: '12px', color: '#ffffff', resolution: UI_RES };
      const cdTxt = this.add.text(sx + SW / 2, barY + SH / 2, '', cdStyle).setOrigin(0.5).setDepth(104);

      return { sx, sy: barY, SW, SH, bg, cdGfx, hk, cdTxt, iconImg: null, _key: null };
    });
    this._rebuildActionBarIcons();
  }

  _rebuildActionBarIcons() {
    if (!this._abSlots) return;
    const gs = this.gs;
    this._abSlots.forEach((slot, i) => {
      const key = (gs.actionBar || [])[i] || null;
      slot._key = key;
      if (slot.iconImg) { slot.iconImg.destroy(); slot.iconImg = null; }
      if (!key) return;
      const texKey = `skill_${key}`;
      if (!this.textures.exists(texKey)) return;
      slot.iconImg = this.add.image(slot.sx + slot.SW / 2, slot.sy + slot.SH / 2, texKey)
        .setDisplaySize(slot.SW - 4, slot.SH - 4).setDepth(102);
    });
  }

  _updateActionBarHUD(time) {
    if (!this._abSlots) return;
    const gs  = this.gs;
    const bar = gs.actionBar || [];
    if (this._abSlots.some((s, i) => s._key !== (bar[i] || null))) this._rebuildActionBarIcons();

    for (let i = 0; i < 10; i++) {
      const slot  = this._abSlots[i];
      const key   = bar[i] || null;
      const cdEnd = key ? (gs.skillCooldowns[key] || 0) : 0;
      const cdMs  = key ? gs._skillCooldownMs(key) : 1;
      const rem   = Math.max(0, cdEnd - time);

      slot.cdGfx.clear();
      if (key && rem > 0) {
        const prog = rem / cdMs;
        slot.cdGfx.fillStyle(0x000000, 0.68);
        slot.cdGfx.fillRoundedRect(slot.sx, slot.sy, slot.SW, Math.ceil(slot.SH * prog), 5);
        slot.cdTxt.setText(Math.ceil(rem / 1000));
      } else {
        slot.cdTxt.setText('');
      }
      if (slot.iconImg) {
        const lv = gs.skillLevels?.[key] || 0;
        slot.iconImg.setAlpha(lv === 0 ? 0.25 : rem > 0 ? 0.45 : 1.0);
      }
    }
  }

  _showBaseNav() {
    if (this._navObjs) return;
    if (this.scene.isActive('MapScene')) this.scene.stop('MapScene');
    this.scene.bringToTop('HudScene');
    const W = this.scale.width, H = this.scale.height;
    const BTN_W = 124, BTN_H = 36, GAP = 6;
    const EXIT_W = 160;
    const O = (s, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES });

    const ITEMS = [
      { label: 'ГАРАЖ  G',   key: 'GarageScene' },
      { label: 'КЛАН  N',    key: 'ClanScene'   },
      { label: 'КОРП  H',    key: 'CorpScene'   },
      { label: 'МИССИИ  O',  key: 'MissionsScene' },
      { label: 'МАГАЗИН  P', key: 'ShopScene'   },
      { label: 'СКИЛЛЫ  K',  key: 'SkillScene'  },
      { label: 'СКЛАД  C',   key: 'CargoScene'  },
    ];

    const totalW = ITEMS.length * BTN_W + (ITEMS.length - 1) * GAP + GAP + EXIT_W;
    const startX = Math.round((W - totalW) / 2);
    const barY   = 5;
    this._navObjs = [];
    this._navBtnItems = [];

    const navBg = this.add.rectangle(W / 2, barY + BTN_H / 2 + 2, W, BTN_H + 10, 0x020508, 1.0).setDepth(105);
    this._navObjs.push(navBg);

    ITEMS.forEach(({ label, key }, i) => {
      const bx = startX + i * (BTN_W + GAP) + BTN_W / 2;
      const btn = this.add.rectangle(bx, barY + BTN_H / 2, BTN_W, BTN_H, 0x081420, 0.95)
        .setDepth(106).setStrokeStyle(1, 0x1e3a50, 1).setInteractive({ useHandCursor: true });
      const txt = this.add.text(bx, barY + BTN_H / 2, label, O('12px', '#3a8aaa'))
        .setOrigin(0.5).setDepth(107);

      btn.on('pointerover',  () => { if (!this.scene.isActive(key)) { btn.setFillStyle(0x0f2535); txt.setColor('#4dd0e1'); } });
      btn.on('pointerout',   () => { if (!this.scene.isActive(key)) { btn.setFillStyle(0x081420); txt.setColor('#3a8aaa'); } });
      btn.on('pointerdown',  () => this.gs.toggleOverlay(key));
      this._navObjs.push(btn, txt);
      this._navBtnItems.push({ btn, txt, key });
    });

    const exitX = startX + ITEMS.length * (BTN_W + GAP) + GAP + EXIT_W / 2;
    const exitBtn = this.add.rectangle(exitX, barY + BTN_H / 2, EXIT_W, BTN_H, 0x1a0808, 0.95)
      .setDepth(106).setStrokeStyle(1, 0x883333, 0.9).setInteractive({ useHandCursor: true });
    const exitTxt = this.add.text(exitX, barY + BTN_H / 2, 'ВЫХОД В КОСМОС', O('12px', '#aa4444'))
      .setOrigin(0.5).setDepth(107);
    exitBtn.on('pointerover',  () => { exitBtn.setFillStyle(0x2a1010); exitTxt.setColor('#ef5350'); });
    exitBtn.on('pointerout',   () => { exitBtn.setFillStyle(0x1a0808); exitTxt.setColor('#aa4444'); });
    exitBtn.on('pointerdown',  () => {
      this.gs.atBase = false;
      ['GarageScene','ClanScene','CorpScene','MissionsScene','ShopScene','SkillScene','CargoScene'].forEach(k => {
        if (this.scene.isActive(k)) this.scene.stop(k);
      });
    });
    this._navObjs.push(exitBtn, exitTxt);
  }

  _hideBaseNav() {
    if (!this._navObjs) return;
    this._navObjs.forEach(o => o?.destroy());
    this._navObjs = null;
    this._navBtnItems = null;
  }

  pushLog(text) {
    const t = this.add.text(20, 0, text, {
      fontFamily: 'Inter, sans-serif', fontSize: '13px', color: '#cfe9ee', resolution: UI_RES,
    }).setDepth(101);
    this.logEntries.push({ t, born: this.time.now });
    while (this.logEntries.length > 7) this.logEntries.shift().t.destroy();
  }

  update() {
    const W = this.scale.width, H = this.scale.height;
    const g = this.bars; g.clear();
    const p = this.gs.player;
    if (!p) return;

    const atBase = this.gs.atBase;

    if (!atBase) {
      // ── Игрок ── (бары под подписями: ЩИТ y48→бар y64, КОРПУС y82→бар y98)
      this.pName.setText(i18n.t(p.ship.nameKey)).setVisible(true);
      const sFrac = p.shield / p.maxShield, hFrac = p.hull / p.maxHull;
      this.pShieldTxt.setText(`${i18n.t('hud.shield')}  ${Math.ceil(p.shield)} / ${p.maxShield}`).setVisible(true);
      this.bar(g, 20, 64, 220, 10, sFrac, COLORS.primary);
      this.pHullTxt.setText(`${i18n.t('hud.hull')}  ${Math.ceil(p.hull)} / ${p.maxHull}`).setVisible(true);
      this.bar(g, 20, 98, 220, 10, hFrac, COLORS.emerald);
      const boostTag = p.boosting ? `  ⚡${i18n.t('hud.boost')}` : '';
      this.pSpeed.setText(`${i18n.t('hud.speed')}  ${Math.round(p.speed)}${boostTag}`)
        .setColor(p.boosting ? '#ffb74d' : '#9fb3b8').setVisible(true);
      this.pCredits.setText(`${i18n.t('hud.credits')}  ${this.gs.credits || 0}`).setVisible(true);
      this.pStarGold.setText(`⭐ ${i18n.t('hud.stargold')}  ${this.gs.starGold || 0}`).setVisible(true);

      // ── Уровень пилота + XP-бар ──
      const info = levelInfo(this.gs.pilotXp || 0);
      this.pPilot.setText(`${i18n.t('hud.pilot')}  ${i18n.t('mob.level')}${info.level}`).setVisible(true);
      if (this.gs.pilotRank) {
        this.pRank.setText(`${this.gs.pilotRank.name.toUpperCase()}`).setVisible(true);
      } else {
        this.pRank.setVisible(false);
      }
      if (info.level >= MAX_LEVEL) {
        this.pXpTxt.setText('MAX').setVisible(true);
        this.bar(g, 20, 204, 220, 6, 1, 0xb39ddb);
      } else {
        this.pXpTxt.setText(`${Math.floor(info.into)} / ${info.need}`).setVisible(true);
        this.bar(g, 20, 204, 220, 6, info.frac, 0xb39ddb);
      }

      // ── Цель ── (щит — cyan-полоска над корпусом, если у цели есть щит)
      const t = this.gs.target;
      let targetBottom = 16;
      if (t && t.alive) {
        const enrageTag = (t.isBoss && t.phase >= 2) ? `  ⚠${i18n.t('hud.enraged')}` : '';
        this.tName.setX(W / 2).setText(`${i18n.t(t.tpl.nameKey)}  ${i18n.t('mob.level')}${t.level}${enrageTag}`).setVisible(true);
        const bx = W / 2 - 110;
        if (t.maxShield > 0) {
          this.bar(g, bx, 40, 220, 6, t.shield / t.maxShield, COLORS.primary);
          this.bar(g, bx, 50, 220, 8, t.hull / t.maxHull, COLORS.danger);
          this.tHullTxt.setY(64).setText(`${i18n.t('hud.shield')} ${Math.ceil(t.shield)}  ·  ${i18n.t('hud.hull')} ${Math.ceil(t.hull)}/${t.maxHull}`);
        } else {
          this.bar(g, bx, 44, 220, 8, t.hull / t.maxHull, COLORS.danger);
          this.tHullTxt.setY(58).setText(`${i18n.t('hud.hull')} ${Math.ceil(t.hull)} / ${t.maxHull}`);
        }
        this.tHullTxt.setX(W / 2).setVisible(true);
        targetBottom = 86;
      } else {
        this.tName.setVisible(false); this.tHullTxt.setVisible(false);
      }

      // ── Безопасная зона ──
      this.safeTxt.setX(W / 2).setY(targetBottom).setVisible(!!this.gs.safeProtected);
    } else {
      // At base: hide all combat/flight stats
      [this.pName, this.pShieldTxt, this.pHullTxt, this.pSpeed, this.pCredits,
       this.pStarGold, this.pPilot, this.pXpTxt, this.pRank,
       this.tName, this.tHullTxt, this.safeTxt].forEach(o => o.setVisible(false));
      g.clear();
    }

    // ── Миникарта (векторные блипы) ──
    this.drawMinimap();

    // ── Активна підсвітка nav-кнопок ──
    if (this._navBtnItems) {
      for (const { btn, txt, key } of this._navBtnItems) {
        const active = this.scene.isActive(key);
        btn.setFillStyle(active ? 0x0f3040 : 0x081420);
        btn.setStrokeStyle(1, active ? 0x4dd0e1 : 0x1e3a50, 1);
        txt.setColor(active ? '#7ee8f0' : '#3a8aaa');
      }
    }

    // ── Base nav bar (показываем/скрываем при смене atBase) ──
    if (this.gs.atBase !== this._lastAtBase) {
      this._lastAtBase = this.gs.atBase;
      if (this.gs.atBase) this._showBaseNav(); else this._hideBaseNav();
    }

    // ── Cargo indicator ──
    const cargoCount = this.gs.inventory?.length || 0;
    const cargoMax   = 30;
    this._cargoTxt.setPosition(W - 16, H - 80)
      .setText(`ТРЮМ  ${cargoCount}/${cargoMax}`)
      .setColor(cargoCount >= cargoMax ? '#ef5350' : '#4a6678');

    // ── Подсказка (выше action bar) ──
    this.hint.setPosition(W / 2, H - 66).setVisible(!atBase);

    // ── Action bar ──
    if (!atBase) {
      this._updateActionBarHUD(this.time.now);
    }
    if (this._abSlots) {
      this._abSlots.forEach(slot => {
        slot.bg.setVisible(!atBase);
        slot.cdGfx.setVisible(!atBase);
        slot.hk.setVisible(!atBase);
        slot.cdTxt.setVisible(!atBase);
        if (slot.iconImg) slot.iconImg.setVisible(!atBase);
      });
    }

    // ── Лог (снизу вверх, с угасанием по возрасту) ──
    const baseY = H - 120;
    for (let i = this.logEntries.length - 1, row = 0; i >= 0; i--, row++) {
      const e = this.logEntries[i];
      e.t.setY(baseY - row * 18);
      const age = this.time.now - e.born;
      e.t.setAlpha(age > 6000 ? Math.max(0.25, 1 - (age - 6000) / 6000) : 1);
    }
  }

  bar(g, x, y, w, h, frac, color) {
    frac = Phaser.Math.Clamp(frac, 0, 1);
    g.fillStyle(0x0a141a, 0.85); g.fillRoundedRect(x - 2, y - 2, w + 4, h + 4, 3);
    g.fillStyle(0x1a2a30, 1); g.fillRect(x, y, w, h);
    g.fillStyle(color, 1); g.fillRect(x, y, w * frac, h);
  }

  // Миникарта векторными блипами: панель + база/safe-зона + лут + мобы + игрок + waypoint.
  // Всё геометрией (не камера) → резко при любом DPR. Позиции мира → миникарты через worldToMinimap.
  drawMinimap() {
    const g = this.miniGfx; g.clear();
    if (this.gs.atBase) return;
    const gs = this.gs;
    const r = minimapRect(this);
    const ww = gs.worldWidth, wh = gs.worldHeight;

    // Панель + рамка
    g.fillStyle(0x06101c, 0.85); g.fillRect(r.x, r.y, r.w, r.h);
    g.lineStyle(2, COLORS.primary, 0.8); g.strokeRect(r.x, r.y, r.w, r.h);

    // База + кольцо безопасной зоны (центр мира)
    const sec = SECTORS[galaxy.current];
    if (!sec.isDungeon && !sec.pvp) {
      const base = worldToMinimap(ww / 2, wh / 2, r, ww, wh);
      g.lineStyle(1, COLORS.safezone, 0.5);
      g.strokeCircle(base.x, base.y, gs.safeZoneRadius * base.s);
      g.fillStyle(COLORS.primary, 0.9); g.fillCircle(base.x, base.y, 3);
    }

    // Домашні бази — завжди видні (без обмеження scan radius)
    if (gs.homeBases) {
      const CORP_HUE = { helios: 0xffb74d, karax: 0xef5350, tides: 0x4dd0e1 };
      for (const hb of gs.homeBases) {
        const hp = worldToMinimap(hb.x, hb.y, r, ww, wh);
        const isOwn = hb.corp === gs.playerCorp;
        const c = isOwn ? 0xffffff : (CORP_HUE[hb.corp] || 0x888888);
        g.lineStyle(2, c, isOwn ? 0.95 : 0.65);
        g.strokeCircle(hp.x, hp.y, 5);
        g.fillStyle(c, isOwn ? 1.0 : 0.75);
        g.fillCircle(hp.x, hp.y, 2.5);
      }
    }

    // Добувальні бази (тільки PvP, завжди видні)
    if (sec.pvp && gs.miningBases) {
      for (const mb of gs.miningBases) {
        const mp = worldToMinimap(mb.x, mb.y, r, ww, wh);
        const isOwn = mb.corp === gs.playerCorp;
        const isNeutral = !mb.corp || mb.corp === 'neutral';
        const c = isOwn ? 0x66ff88 : isNeutral ? 0x778899 : 0xff5555;
        const a = mb.state === 'destroyed' ? 0.3 : 0.85;
        const sz = 3;
        g.lineStyle(1.5, c, a);
        g.strokeRect(mp.x - sz, mp.y - sz, sz * 2, sz * 2);
        g.fillStyle(c, a * 0.5);
        g.fillRect(mp.x - sz + 1, mp.y - sz + 1, sz * 2 - 2, sz * 2 - 2);
      }
    }

    // Скан-радиус: враги/лут видны только в радиусе сканирования
    const sr = gs.scanRadius ?? BASE_SCAN_RADIUS;
    const px2 = gs.player?.x ?? ww / 2, py2 = gs.player?.y ?? wh / 2;
    const mmScale = Math.min(r.w / ww, r.h / wh);
    // Кольцо радиуса сканирования
    const pCenter = worldToMinimap(px2, py2, r, ww, wh);
    g.lineStyle(1, 0x4de1aa, 0.3);
    g.strokeCircle(pCenter.x, pCenter.y, sr * mmScale);

    // Лут (янтарные точки) — только в радиусе скана
    g.fillStyle(COLORS.amber, 0.9);
    for (const l of gs.loot) {
      if (!l.alive) continue;
      if (Phaser.Math.Distance.Between(px2, py2, l.x, l.y) > sr) continue;
      const p = worldToMinimap(l.x, l.y, r, ww, wh); g.fillCircle(p.x, p.y, 1.6);
    }

    // Мобы (красные; боссы крупнее/оранжевые) — только в радиусе скана
    for (const m of gs.mobs) {
      if (!m.alive) continue;
      if (Phaser.Math.Distance.Between(px2, py2, m.x, m.y) > sr) continue;
      const p = worldToMinimap(m.x, m.y, r, ww, wh);
      if (m.isBoss) { g.fillStyle(0xff7a6b, 1); g.fillCircle(p.x, p.y, 3.4); }
      else { g.fillStyle(COLORS.danger, 0.95); g.fillCircle(p.x, p.y, 2); }
    }

    // Джапгейты (порталы) — cyan-кольца, чтобы видеть, куда лететь для прыжка
    if (gs.gates) {
      for (const ga of gs.gates) {
        const p = worldToMinimap(ga.x, ga.y, r, ww, wh);
        g.lineStyle(2, COLORS.primary, 0.95); g.strokeCircle(p.x, p.y, 4.5);
        g.fillStyle(0x9fe6ff, 0.9); g.fillCircle(p.x, p.y, 1.8);
      }
    }

    // Waypoint (если задан курс)
    const pl = gs.player;
    if (pl && pl.waypoint) {
      const w = worldToMinimap(pl.waypoint.x, pl.waypoint.y, r, ww, wh);
      g.lineStyle(1, COLORS.amber, 0.9); g.strokeCircle(w.x, w.y, 3);
    }

    // Игрок — треугольник по курсу (heading)
    if (pl && pl.alive) {
      const p = worldToMinimap(pl.x, pl.y, r, ww, wh);
      const h = pl.heading, sz = 5.5;
      g.fillStyle(0xffffff, 1);
      g.beginPath();
      g.moveTo(p.x + Math.cos(h) * sz, p.y + Math.sin(h) * sz);
      g.lineTo(p.x + Math.cos(h + 2.6) * sz * 0.75, p.y + Math.sin(h + 2.6) * sz * 0.75);
      g.lineTo(p.x + Math.cos(h - 2.6) * sz * 0.75, p.y + Math.sin(h - 2.6) * sz * 0.75);
      g.closePath(); g.fillPath();
    }
  }
}
