import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES, BASE_SCAN_RADIUS } from '../constants.js';
import { i18n } from '../i18n.js';
import { levelInfo, MAX_LEVEL } from '../leveling.js';
import { minimapRect, worldToMinimap } from '../systems/minimap.js';
import { SECTORS, galaxy } from '../galaxy.js';
import { getActiveMissionSectorTargets } from '../data/missions.js';
import { countConsumableInInventory } from '../items.js';
import { prerenderTex } from '../utils/prerenderTex.js';

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
    // Bar rows: icon (left) + bar (center, 155px) + value (right of bar, white)
    this._icoShield = this.add.text(18, 20, '🛡', F('12px', '#4dd0e1')).setDepth(101);
    this._valShield = this.add.text(202, 28, '', F('11px', '#d0eeff')).setOrigin(0, 0.5).setDepth(102);
    this._icoHull   = this.add.text(18, 44, '⚙', F('12px', '#66bb6a')).setDepth(101);
    this._valHull   = this.add.text(202, 52, '', F('11px', '#c8f0d0')).setOrigin(0, 0.5).setDepth(102);
    this.pSpeed     = this.add.text(20, 68, '', F('12px', '#9fb3b8')).setDepth(101);
    // Info panel items — position managed by _buildInfoPanel
    this.pCredits  = this.add.text(0, 0, '', F('13px', '#ffb74d')).setDepth(101).setVisible(false);
    this.pStarGold = this.add.text(0, 0, '', F('13px', '#ffd54f')).setDepth(101).setVisible(false);
    this.pHonor    = this.add.text(0, 0, '', F('13px', '#ef9a9a')).setDepth(101).setVisible(false);
    this.pCorpRep  = this.add.text(0, 0, '', F('13px', '#80cbc4')).setDepth(101).setVisible(false);
    this.pPilot    = this.add.text(0, 0, '', O('12px', '#b39ddb')).setDepth(101).setVisible(false);
    this.pRank     = this.add.text(0, 0, '', O('12px', '#ffcc80')).setDepth(101).setVisible(false);
    this.pXpTxt    = this.add.text(0, 0, '', F('10px', '#9fb3b8')).setOrigin(1, 0).setDepth(101).setVisible(false);

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

    this._buildInfoPanel();
    this._buildLogPanel();
  }

  _buildActionBarHUD() {
    const W = this.scale.width, H = this.scale.height;
    const SW = 52, SH = 52, GAP = 4, N = 10;
    const startX = Math.round((W - (N * SW + (N - 1) * GAP)) / 2);
    const barY   = H - SH - 10;

    this._barEditMode  = false;
    this._barPickedIdx = null;

    this._abSlots = Array.from({ length: N }, (_, i) => {
      const sx = startX + i * (SW + GAP);

      const bg = this.add.graphics().setDepth(101);
      bg.fillStyle(0x0a1828, 0.92);
      bg.fillRoundedRect(sx, barY, SW, SH, 5);
      bg.lineStyle(1, 0x1e4060, 1);
      bg.strokeRoundedRect(sx, barY, SW, SH, 5);

      // Hit zone: ЛКМ = активация / ПКМ = удалить / режим ↔ = перестановка
      const hitZone = this.add.rectangle(sx + SW / 2, barY + SH / 2, SW, SH)
        .setInteractive({ useHandCursor: true }).setDepth(106).setAlpha(0.001);
      hitZone.on('pointerdown', (p) => {
        const gs = this.gs;
        if (p.button === 2) {
          // ПКМ: удалить слот только в режиме редактирования
          if (!this._barEditMode) return;
          const bar = gs.actionBar ? [...gs.actionBar] : Array(10).fill(null);
          if (!bar[i]) return;
          bar[i] = null;
          gs.actionBar = bar;
          gs._saveState?.();
          this._rebuildActionBarIcons();
          return;
        }
        if (!this._barEditMode) {
          // ЛКМ: активировать скилл / расходник
          if (!gs.atBase) gs._activateSkillSlot(i);
          return;
        }
        // Режим ↔: перестановка слотов
        if (this._barPickedIdx === null) {
          this._barPickedIdx = i;
          this._setBarPickHighlight(i, true);
        } else if (this._barPickedIdx === i) {
          this._setBarPickHighlight(i, false);
          this._barPickedIdx = null;
        } else {
          const bar = [...(gs.actionBar || Array(10).fill(null))];
          [bar[i], bar[this._barPickedIdx]] = [bar[this._barPickedIdx], bar[i]];
          gs.actionBar = bar;
          gs._saveState?.();
          this._setBarPickHighlight(this._barPickedIdx, false);
          this._barPickedIdx = null;
          this._rebuildActionBarIcons();
        }
      });

      const cdGfx = this.add.graphics().setDepth(103);
      const hkStyle = { fontFamily: 'Inter, sans-serif', fontSize: '9px', color: '#4a6680', resolution: UI_RES };
      const hk = this.add.text(sx + 3, barY + 2, i < 9 ? `${i + 1}` : '0', hkStyle).setDepth(104);
      const cdStyle = { fontFamily: 'Orbitron, sans-serif', fontSize: '12px', color: '#ffffff', resolution: UI_RES };
      const cdTxt = this.add.text(sx + SW / 2, barY + SH / 2, '', cdStyle).setOrigin(0.5).setDepth(104);

      return { sx, sy: barY, SW, SH, bg, cdGfx, hk, cdTxt, iconImg: null, _key: null, _pickGfx: null };
    });

    // Edit mode toggle button — right of bar
    const ebX = startX + N * (SW + GAP) + 6;
    const ebW = 30, ebH = 30;
    this._editBtn = this.add.rectangle(ebX, barY + (SH - ebH) / 2, ebW, ebH, 0x0a1828, 0.88)
      .setOrigin(0, 0).setStrokeStyle(1, 0x2a4060).setInteractive({ useHandCursor: true }).setDepth(105);
    this._editBtnTxt = this.add.text(ebX + ebW / 2, barY + SH / 2, '↔',
      { fontFamily: 'Inter, sans-serif', fontSize: '17px', color: '#3a5a70', resolution: UI_RES })
      .setOrigin(0.5).setDepth(106);
    this._editBtn.on('pointerover', () => { if (!this._barEditMode) this._editBtn.setFillStyle(0x142030, 0.95); });
    this._editBtn.on('pointerout',  () => { if (!this._barEditMode) this._editBtn.setFillStyle(0x0a1828, 0.88); });
    this._editBtn.on('pointerdown', () => this._toggleBarEditMode());

    this._rebuildActionBarIcons();
  }

  _toggleBarEditMode() {
    this._barEditMode = !this._barEditMode;
    if (!this._barEditMode && this._barPickedIdx !== null) {
      this._setBarPickHighlight(this._barPickedIdx, false);
      this._barPickedIdx = null;
    }
    this._editBtn.setFillStyle(this._barEditMode ? 0x251000 : 0x0a1828, this._barEditMode ? 0.95 : 0.88);
    this._editBtnTxt.setColor(this._barEditMode ? '#ffb74d' : '#3a5a70');
    this._editBtn.setStrokeStyle(1, this._barEditMode ? 0xffb74d : 0x2a4060);
  }

  _setBarPickHighlight(idx, on) {
    const slot = this._abSlots?.[idx];
    if (!slot) return;
    slot._pickGfx?.destroy();
    slot._pickGfx = null;
    if (on) {
      slot._pickGfx = this.add.graphics().setDepth(108);
      slot._pickGfx.lineStyle(2.5, 0xffb74d, 1);
      slot._pickGfx.strokeRoundedRect(slot.sx, slot.sy, slot.SW, slot.SH, 5);
      slot.iconImg?.setAlpha(0.45);
    } else {
      slot.iconImg?.setAlpha(1.0);
    }
  }

  _rebuildActionBarIcons() {
    if (!this._abSlots) return;
    const gs = this.gs;
    this._abSlots.forEach((slot, i) => {
      const key = (gs.actionBar || [])[i] || null;
      slot._key = key;
      if (slot.iconImg) { slot.iconImg.destroy(); slot.iconImg = null; }
      if (slot._pickGfx) { slot._pickGfx.destroy(); slot._pickGfx = null; }

      const isConsumable = !!key?.startsWith('use:');
      if (isConsumable) {
        // Shift icon up, leave room for count text at bottom
        slot.cdTxt.setPosition(slot.sx + slot.SW / 2, slot.sy + slot.SH - 2).setOrigin(0.5, 1);
        try { slot.cdTxt.setFontSize('10px'); } catch (_) {}
      } else {
        slot.cdTxt.setPosition(slot.sx + slot.SW / 2, slot.sy + slot.SH / 2).setOrigin(0.5, 0.5);
        try { slot.cdTxt.setFontSize('12px'); } catch (_) {}
      }

      if (!key) return;
      if (key.startsWith('ship:')) {
        const texKey = this._ensureShipSkillTex(key);
        const iconSz = slot.SW - 4;
        slot.iconImg = this.add.image(slot.sx + slot.SW / 2, slot.sy + slot.SH / 2, texKey)
          .setDisplaySize(iconSz, iconSz).setDepth(102);
        return;
      }
      const texKey = isConsumable ? `consumable_${key.slice(4)}` : `skill_${key}`;
      if (!this.textures.exists(texKey)) return;
      const iconSz  = isConsumable ? 40 : slot.SW - 4;
      const iconY   = isConsumable ? slot.sy + slot.SH / 2 - 5 : slot.sy + slot.SH / 2;
      slot.iconImg = this.add.image(slot.sx + slot.SW / 2, iconY,
          prerenderTex(this, texKey, iconSz, iconSz))
        .setDisplaySize(iconSz, iconSz).setDepth(102);
    });
  }

  _ensureShipSkillTex(key) {
    const cacheKey = `__ss_${key.replace(':', '_')}`;
    if (this.textures.exists(cacheKey)) return cacheKey;
    const INFO = {
      'ship:helion_volley': { label: 'ЗП', bg: '#2a1508', fg: '#ffb74d', border: '#ffb74d' },
      'ship:argosy_repair': { label: 'РМ', bg: '#081624', fg: '#4fc3f7', border: '#4fc3f7' },
      'ship:drifter_jump':  { label: 'ПР', bg: '#071a18', fg: '#4db6ac', border: '#4db6ac' },
    };
    const info = INFO[key] || { label: '??', bg: '#0a0a14', fg: '#7e9398', border: '#7e9398' };
    const sz = 48;
    const ct = this.textures.createCanvas(cacheKey, sz, sz);
    const ctx = ct.getContext();
    ctx.fillStyle = info.bg;
    ctx.fillRect(0, 0, sz, sz);
    ctx.strokeStyle = info.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, sz - 2, sz - 2);
    ctx.fillStyle = info.fg;
    ctx.font = 'bold 15px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(info.label, sz / 2, sz / 2);
    ct.refresh();
    return cacheKey;
  }

  _updateActionBarHUD(time) {
    if (!this._abSlots) return;
    const gs  = this.gs;
    const bar = gs.actionBar || [];
    if (this._abSlots.some((s, i) => s._key !== (bar[i] || null))) this._rebuildActionBarIcons();

    for (let i = 0; i < 10; i++) {
      const slot  = this._abSlots[i];
      const key   = bar[i] || null;

      if (key?.startsWith('use:')) {
        const buffEnd = (gs._consBuffEndTimes || {})[key] || 0;
        const buffRem = Math.max(0, buffEnd - time);
        const cdEnd   = gs.skillCooldowns[key] || 0;
        const cdMs    = gs._skillCooldownMs(key);
        const cdRem   = Math.max(0, cdEnd - time);
        const total   = countConsumableInInventory(gs.inventory || [], key.slice(4));
        slot.cdGfx.clear();
        if (buffRem > 0) {
          slot.cdTxt.setPosition(slot.sx + slot.SW / 2, slot.sy + slot.SH / 2).setOrigin(0.5, 0.5)
            .setColor('#4de8a0').setText(`${Math.ceil(buffRem / 1000)}`);
          if (slot.iconImg) slot.iconImg.setAlpha(1.0);
        } else if (cdRem > 0) {
          const prog = cdRem / cdMs;
          slot.cdGfx.fillStyle(0x000000, 0.68);
          slot.cdGfx.fillRoundedRect(slot.sx, slot.sy, slot.SW, Math.ceil(slot.SH * prog), 5);
          slot.cdTxt.setPosition(slot.sx + slot.SW / 2, slot.sy + slot.SH / 2).setOrigin(0.5, 0.5)
            .setColor('#ffffff').setText(`${Math.ceil(cdRem / 1000)}`);
          if (slot.iconImg) slot.iconImg.setAlpha(0.3);
        } else {
          slot.cdTxt.setPosition(slot.sx + slot.SW / 2, slot.sy + slot.SH - 2).setOrigin(0.5, 1)
            .setColor('#ffffff').setText(total > 0 ? `${total}` : '');
          if (slot.iconImg) slot.iconImg.setAlpha(total > 0 ? 1.0 : 0.3);
        }
        continue;
      }

      const buffEnd = (gs._consBuffEndTimes || {})[key] || 0;
      const buffRem = Math.max(0, buffEnd - time);
      const cdEnd   = key ? (gs.skillCooldowns[key] || 0) : 0;
      const cdMs    = key ? gs._skillCooldownMs(key) : 1;
      const cdRem   = Math.max(0, cdEnd - time);
      const lv      = key?.startsWith('ship:') ? 1 : (gs.skillLevels?.[key] || 0);

      slot.cdGfx.clear();
      if (key && buffRem > 0) {
        slot.cdTxt.setColor('#4de8a0').setText(`${Math.ceil(buffRem / 1000)}`);
        if (slot.iconImg) slot.iconImg.setAlpha(1.0);
      } else if (key && cdRem > 0) {
        const prog = cdRem / cdMs;
        slot.cdGfx.fillStyle(0x000000, 0.68);
        slot.cdGfx.fillRoundedRect(slot.sx, slot.sy, slot.SW, Math.ceil(slot.SH * prog), 5);
        slot.cdTxt.setColor('#ffffff').setText(`${Math.ceil(cdRem / 1000)}`);
        if (slot.iconImg) slot.iconImg.setAlpha(lv === 0 ? 0.25 : 0.45);
      } else {
        slot.cdTxt.setColor('#ffffff').setText('');
        if (slot.iconImg) slot.iconImg.setAlpha(lv === 0 ? 0.25 : 1.0);
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
      const txt = this.add.bitmapText(bx, barY + BTN_H / 2, 'bmf_orb12', label, 12)
        .setOrigin(0.5, 0.5).setDepth(107).setTint(0x3a8aaa);

      btn.on('pointerover',  () => { if (!this.scene.isActive(key)) { btn.setFillStyle(0x0f2535); txt.setTint(0x4dd0e1); } });
      btn.on('pointerout',   () => { if (!this.scene.isActive(key)) { btn.setFillStyle(0x081420); txt.setTint(0x3a8aaa); } });
      btn.on('pointerdown',  () => {
        if (this.scene.isActive('DonateScene')) this.scene.stop('DonateScene');
        if (this.scene.isActive(key)) this.gs._exitToSpace();
        else this.gs.toggleOverlay(key);
      });
      this._navObjs.push(btn, txt);
      this._navBtnItems.push({ btn, txt, key });
    });

    const exitX = startX + ITEMS.length * (BTN_W + GAP) + GAP + EXIT_W / 2;
    const exitBtn = this.add.rectangle(exitX, barY + BTN_H / 2, EXIT_W, BTN_H, 0x1a0808, 0.95)
      .setDepth(106).setStrokeStyle(1, 0x883333, 0.9).setInteractive({ useHandCursor: true });
    const exitTxt = this.add.bitmapText(exitX, barY + BTN_H / 2, 'bmf_orb12', 'ВЫХОД В КОСМОС', 12)
      .setOrigin(0.5, 0.5).setDepth(107).setTint(0xaa4444);
    exitBtn.on('pointerover',  () => { exitBtn.setFillStyle(0x2a1010); exitTxt.setTint(0xef5350); });
    exitBtn.on('pointerout',   () => { exitBtn.setFillStyle(0x1a0808); exitTxt.setTint(0xaa4444); });
    exitBtn.on('pointerdown', () => {
      if (this.scene.isActive('DonateScene')) this.scene.stop('DonateScene');
      this.gs._exitToSpace();
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
    const t = this.add.text(0, 0, text, {
      fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#cfe9ee', resolution: UI_RES,
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
      // ── Игрок ── (горизонтальные бары с иконкой и значением)
      const sFrac = p.shield / p.maxShield, hFrac = p.hull / p.maxHull;
      this._icoShield.setVisible(true);
      this._valShield.setText(`${Math.ceil(p.shield)} / ${p.maxShield}`).setVisible(true);
      this.bar(g, 38, 20, 160, 16, sFrac, COLORS.primary);
      this._icoHull.setVisible(true);
      this._valHull.setText(`${Math.ceil(p.hull)} / ${p.maxHull}`).setVisible(true);
      this.bar(g, 38, 44, 160, 16, hFrac, COLORS.emerald);
      const boostTag = p.boosting ? `  ⚡${i18n.t('hud.boost')}` : '';
      this.pSpeed.setText(`${i18n.t('hud.speed')}  ${Math.round(p.speed)}${boostTag}`)
        .setColor(p.boosting ? '#ffb74d' : '#9fb3b8').setVisible(true);

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
      [this._icoShield, this._valShield, this._icoHull, this._valHull, this.pSpeed,
       this.tName, this.tHullTxt, this.safeTxt].forEach(o => o.setVisible(false));
      g.clear();
    }

    // ── Info panel: always update (stays current at base + in space) ──
    this.pCredits.setText(`💰 ${(this.gs.credits || 0).toLocaleString()}`);
    this.pStarGold.setText(`⭐ ${this.gs.starGold || 0}`);
    this.pHonor.setText(`⚔️ ${(this.gs.pilotHonor || 0).toLocaleString()}`);
    this.pCorpRep.setText(`🛡 ${Math.round((this.gs.corpRep || 0) * 100)}%`);
    const info = levelInfo(this.gs.pilotXp || 0);
    this.pPilot.setText(`${i18n.t('hud.pilot')}  ${i18n.t('mob.level')}${info.level}`);
    this.pRank.setText(this.gs.pilotRank ? this.gs.pilotRank.name.toUpperCase() : '');
    this._ipXpFrac = info.level >= MAX_LEVEL ? 1 : info.frac;
    this.pXpTxt.setText(info.level >= MAX_LEVEL ? 'MAX' : `${Math.floor(info.into)} / ${info.need}`);
    this._updateInfoPanelContent();

    // ── Миникарта (векторные блипы) ──
    this.drawMinimap();

    // ── Активна підсвітка nav-кнопок ──
    if (this._navBtnItems) {
      for (const { btn, txt, key } of this._navBtnItems) {
        const active = this.scene.isActive(key);
        btn.setFillStyle(active ? 0x0f3040 : 0x081420);
        btn.setStrokeStyle(1, active ? 0x4dd0e1 : 0x1e3a50, 1);
        txt.setTint(active ? 0x7ee8f0 : 0x3a8aaa);
      }
    }

    // ── Base nav bar + auto-collapse panels on base enter/exit ──
    if (this.gs.atBase !== this._lastAtBase) {
      this._lastAtBase = this.gs.atBase;
      if (this.gs.atBase) {
        this._savedIpCollapsed  = this._ipCollapsed;
        this._savedLogCollapsed = this._logCollapsed;
        if (!this._ipCollapsed)  { this._ipCollapsed  = true; this._refreshInfoPanel(); }
        if (!this._logCollapsed) { this._logCollapsed = true; this._refreshLogPanel();  }
        this._showBaseNav();
      } else {
        if (this._savedIpCollapsed  === false) { this._ipCollapsed  = false; this._refreshInfoPanel(); }
        if (this._savedLogCollapsed === false) { this._logCollapsed = false; this._refreshLogPanel();  }
        this._hideBaseNav();
      }
    }

    // ── Cargo indicator ──
    const cargoCount = this.gs.inventory?.length || 0;
    const cargoMax   = this.gs._cargoMax();
    this._cargoTxt.setPosition(W - 16, H - 80)
      .setText(`ТРЮМ  ${cargoCount}/${cargoMax}`)
      .setColor(cargoCount >= cargoMax ? '#ef5350' : '#4a6678')
      .setVisible(!atBase);

    const inMap = this.scene.isActive('MapScene');

    // ── Подсказка (выше action bar) ──
    this.hint.setPosition(W / 2, H - 66).setVisible(!atBase && !inMap);

    // ── Action bar ──
    if (!atBase && !inMap) {
      this._updateActionBarHUD(this.time.now);
    }
    if (this._abSlots) {
      this._abSlots.forEach(slot => {
        slot.bg.setVisible(!atBase && !inMap);
        slot.cdGfx.setVisible(!atBase && !inMap);
        slot.hk.setVisible(!atBase && !inMap);
        slot.cdTxt.setVisible(!atBase && !inMap);
        if (slot.iconImg) slot.iconImg.setVisible(!atBase && !inMap);
      });
    }
    this._editBtn?.setVisible(!atBase && !inMap);
    this._editBtnTxt?.setVisible(!atBase && !inMap);

    // ── Лог (внутри панели, снизу вверх) ──
    const LOG_PH = 24 + 7 * 18 + 10;
    const logBottom = this._logY + LOG_PH - 20;
    const logVisible = !this._logCollapsed;
    this._logBtn?.setVisible(true);
    this._logBtnTxt?.setVisible(true);
    for (let i = this.logEntries.length - 1, row = 0; i >= 0; i--, row++) {
      const e = this.logEntries[i];
      e.t.setX(this._logX + 10).setY(logBottom - row * 18).setVisible(logVisible).setAlpha(1);
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

    // Плазмит — точки, только в радиусе сканирования
    if (gs.plasmateDeposits) {
      g.fillStyle(0xaa66ff, 0.85);
      for (const d of gs.plasmateDeposits) {
        if (!d.alive) continue;
        if (Phaser.Math.Distance.Between(px2, py2, d.x, d.y) > sr) continue;
        const p = worldToMinimap(d.x, d.y, r, ww, wh);
        g.fillCircle(p.x, p.y, 1.8);
      }
    }

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
    const missionTargets = getActiveMissionSectorTargets(gs.missionState, gs.playerCorp ?? 'helios');
    if (gs.gates) {
      for (const ga of gs.gates) {
        const p = worldToMinimap(ga.x, ga.y, r, ww, wh);
        const isMissionGate = missionTargets.has(ga.target);
        if (isMissionGate) {
          // Amber outer ring for mission target gate
          g.lineStyle(2, COLORS.amber, 0.7); g.strokeCircle(p.x, p.y, 8);
        }
        g.lineStyle(2, COLORS.primary, 0.95); g.strokeCircle(p.x, p.y, 4.5);
        g.fillStyle(0x9fe6ff, 0.9); g.fillCircle(p.x, p.y, 1.8);
        if (isMissionGate) {
          // Amber star above gate marker
          g.fillStyle(COLORS.amber, 0.95);
          const sx = p.x, sy = p.y - 12, sr = 4;
          for (let i = 0; i < 5; i++) {
            const aOuter = (i * 4 * Math.PI / 5) - Math.PI / 2;
            const aInner = aOuter + 2 * Math.PI / 10;
            const ox = sx + Math.cos(aOuter) * sr, oy = sy + Math.sin(aOuter) * sr;
            const ix = sx + Math.cos(aInner) * sr * 0.45, iy = sy + Math.sin(aInner) * sr * 0.45;
            if (i === 0) g.beginPath(), g.moveTo(ox, oy);
            else g.lineTo(ox, oy);
            g.lineTo(ix, iy);
          }
          g.closePath(); g.fillPath();
        }
      }
    }

    // Escort transport — amber diamond (visually distinct from cyan gate circles)
    const et = gs.escortTransport;
    if (et?.alive) {
      const ep = worldToMinimap(et.x, et.y, r, ww, wh);
      const ds = 5.5;
      g.fillStyle(0xffb74d, 0.92);
      g.beginPath();
      g.moveTo(ep.x,      ep.y - ds);
      g.lineTo(ep.x + ds, ep.y);
      g.lineTo(ep.x,      ep.y + ds);
      g.lineTo(ep.x - ds, ep.y);
      g.closePath(); g.fillPath();
      g.lineStyle(1.5, 0xffe082, 0.85);
      g.beginPath();
      g.moveTo(ep.x,      ep.y - ds);
      g.lineTo(ep.x + ds, ep.y);
      g.lineTo(ep.x,      ep.y + ds);
      g.lineTo(ep.x - ds, ep.y);
      g.closePath(); g.strokePath();
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

  _buildLogPanel() {
    const F = (s, c) => ({ fontFamily: 'Inter, sans-serif', fontSize: s, color: c, resolution: UI_RES });
    const SH = this.scale.height;

    let lpx = 10, lpy = SH - 185;
    try {
      const s = JSON.parse(localStorage.getItem('sd_hud_log_pos') || 'null');
      if (s) { lpx = s.x; lpy = s.y; }
    } catch {}
    this._logX = lpx; this._logY = lpy;
    this._logCollapsed = false;

    this._logBg = this.add.graphics().setDepth(100);

    const BW = 52, BH = 24;
    this._logBtn = this.add.rectangle(0, 0, BW, BH, 0x000000, 0)
      .setOrigin(0).setStrokeStyle(1, 0x4dd0e1, 0.45).setInteractive({ useHandCursor: true }).setDepth(102);
    this._logBtnTxt = this.add.text(BW / 2, BH / 2, 'L ◀', F('11px', '#4dd0e1')).setOrigin(0.5).setDepth(103);

    let dragging = false, dox = 0, doy = 0, moved = false;
    this._logBtn.on('pointerdown', ptr => {
      dragging = true; moved = false;
      dox = ptr.x - this._logX; doy = ptr.y - this._logY;
    });
    this.input.on('pointermove', ptr => {
      if (!dragging) return;
      const nx = Math.max(0, Math.min(this.scale.width - 310, ptr.x - dox));
      const ny = Math.max(0, Math.min(this.scale.height - 185, ptr.y - doy));
      if (Math.abs(nx - this._logX) > 3 || Math.abs(ny - this._logY) > 3) moved = true;
      this._logX = nx; this._logY = ny;
      this._refreshLogPanel();
    });
    this.input.on('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) {
        this._logCollapsed = !this._logCollapsed;
        this._refreshLogPanel();
      }
      try { localStorage.setItem('sd_hud_log_pos', JSON.stringify({ x: this._logX, y: this._logY })); } catch {}
    });

    this._refreshLogPanel();
  }

  _refreshLogPanel() {
    const x = this._logX, y = this._logY;
    const BW = 52, BH = 24, PW = 300, PH = BH + 7 * 18 + 10; // = 160px

    this._logBtn.setPosition(x, y);
    this._logBtnTxt.setPosition(x + BW / 2, y + BH / 2).setText(this._logCollapsed ? 'L ▶' : 'L ◀');

    this._logBg.clear();
    if (!this._logCollapsed) {
      this._logBg.lineStyle(1.5, 0x4dd0e1, 0.45);
      this._logBg.strokeRoundedRect(x, y, PW, PH, 8);
    }
  }

  _buildInfoPanel() {
    const F = (s, c) => ({ fontFamily: 'Inter, sans-serif', fontSize: s, color: c, resolution: UI_RES });
    const O = (s, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES });

    let ipx = 10, ipy = 90;
    try {
      const s = JSON.parse(localStorage.getItem('sd_hud_info_pos') || 'null');
      if (s) { ipx = s.x; ipy = s.y; }
    } catch {}
    this._ipx = ipx; this._ipy = ipy;
    this._ipCollapsed = false;
    this._ipXpFrac = 0;

    // Panel background (persistent graphics, cleared when collapsed)
    this._ipBg = this.add.graphics().setDepth(100);

    // XP bar graphics (redrawn every frame)
    this._ipXpGfx = this.add.graphics().setDepth(100);

    // Toggle/drag button (always visible)
    const BW = 52, BH = 24;
    this._ipBtn = this.add.rectangle(0, 0, BW, BH, 0x000000, 0)
      .setOrigin(0).setStrokeStyle(1, 0x4dd0e1, 0.45).setInteractive({ useHandCursor: true }).setDepth(102);
    this._ipBtnTxt = this.add.text(BW / 2, BH / 2, 'i ◀', F('11px', '#4dd0e1')).setOrigin(0.5).setDepth(103);

    let dragging = false, dox = 0, doy = 0, moved = false;
    this._ipBtn.on('pointerdown', ptr => {
      dragging = true; moved = false;
      dox = ptr.x - this._ipx; doy = ptr.y - this._ipy;
    });
    this.input.on('pointermove', ptr => {
      if (!dragging) return;
      const nx = Math.max(0, Math.min(this.scale.width - 160, ptr.x - dox));
      const ny = Math.max(0, Math.min(this.scale.height - 200, ptr.y - doy));
      if (Math.abs(nx - this._ipx) > 3 || Math.abs(ny - this._ipy) > 3) moved = true;
      this._ipx = nx; this._ipy = ny;
      this._refreshInfoPanel();
    });
    this.input.on('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) {
        this._ipCollapsed = !this._ipCollapsed;
        this._refreshInfoPanel();
      }
      try { localStorage.setItem('sd_hud_info_pos', JSON.stringify({ x: this._ipx, y: this._ipy })); } catch {}
    });

    this._refreshInfoPanel();
  }

  _refreshInfoPanel() {
    const x = this._ipx, y = this._ipy;
    const TB = 22, PW = 148, LH = 21;
    const ITEMS = [this.pCredits, this.pStarGold, this.pHonor, this.pCorpRep, this.pPilot, this.pRank, this.pXpTxt];

    const BW = 52, BH = 24;
    this._ipBtn.setPosition(x, y);
    this._ipBtnTxt.setPosition(x + BW / 2, y + BH / 2).setText(this._ipCollapsed ? 'i ▶' : 'i ◀');

    if (this._ipCollapsed) {
      this._ipBg.clear();
      this._ipXpGfx.clear();
      ITEMS.forEach(o => o.setVisible(false));
      return;
    }

    // 6 text lines + XP bar (6px) + XP fraction text (14px) + padding
    const pH = BH + 6 * LH + 38;
    this._ipBg.clear();
    this._ipBg.lineStyle(1.5, 0x4dd0e1, 0.45);
    this._ipBg.strokeRoundedRect(x, y, PW, pH, 8);

    const tx = x + 10, ty0 = y + BH + 4;
    this.pCredits.setPosition(tx, ty0).setVisible(true);
    this.pStarGold.setPosition(tx, ty0 + LH).setVisible(true);
    this.pHonor.setPosition(tx, ty0 + LH * 2).setVisible(true);
    this.pCorpRep.setPosition(tx, ty0 + LH * 3).setVisible(true);
    this.pPilot.setPosition(tx, ty0 + LH * 4).setVisible(true);
    this.pRank.setPosition(tx + 2, ty0 + LH * 5).setVisible(true);
    // XP fraction text: centered under XP bar (positioned in _updateInfoPanelContent)
    this.pXpTxt.setOrigin(0.5, 0).setPosition(x + PW / 2, ty0 + LH * 6 + 10).setVisible(true);
  }

  _updateInfoPanelContent() {
    if (this._ipCollapsed) { this._ipXpGfx?.clear(); return; }
    const xg = this._ipXpGfx;
    if (!xg) return;
    xg.clear();
    const BH = 24, LH = 21, PW = 148;
    const barX = this._ipx + 10;
    const barY = this._ipy + BH + 4 + 6 * LH + 2;  // below rank line
    const barW = PW - 20;
    xg.fillStyle(0x1a1030, 0.6); xg.fillRect(barX, barY, barW, 6);
    xg.fillStyle(0x7c4dff, 0.9); xg.fillRect(barX, barY, Math.round(barW * (this._ipXpFrac || 0)), 6);
  }
}
