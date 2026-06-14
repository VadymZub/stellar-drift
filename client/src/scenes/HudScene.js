import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
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

    // ── Игрок ── (бары под подписями: ЩИТ y48→бар y64, КОРПУС y82→бар y98)
    this.pName.setText(i18n.t(p.ship.nameKey));
    const sFrac = p.shield / p.maxShield, hFrac = p.hull / p.maxHull;
    this.pShieldTxt.setText(`${i18n.t('hud.shield')}  ${Math.ceil(p.shield)} / ${p.maxShield}`);
    this.bar(g, 20, 64, 220, 10, sFrac, COLORS.primary);
    this.pHullTxt.setText(`${i18n.t('hud.hull')}  ${Math.ceil(p.hull)} / ${p.maxHull}`);
    this.bar(g, 20, 98, 220, 10, hFrac, COLORS.emerald);
    const boostTag = p.boosting ? `  ⚡${i18n.t('hud.boost')}` : '';
    this.pSpeed.setText(`${i18n.t('hud.speed')}  ${Math.round(p.speed)}${boostTag}`)
      .setColor(p.boosting ? '#ffb74d' : '#9fb3b8');
    this.pCredits.setText(`${i18n.t('hud.credits')}  ${this.gs.credits || 0}`);
    this.pStarGold.setText(`⭐ ${i18n.t('hud.stargold')}  ${this.gs.starGold || 0}`);

    // ── Уровень пилота + XP-бар ──
    const info = levelInfo(this.gs.pilotXp || 0);
    this.pPilot.setText(`${i18n.t('hud.pilot')}  ${i18n.t('mob.level')}${info.level}`);
    
    // Ранг (Милитаристский флот)
    if (this.gs.pilotRank) {
      this.pRank.setText(`${this.gs.pilotRank.name.toUpperCase()}`).setVisible(true);
    } else {
      this.pRank.setVisible(false);
    }

    if (info.level >= MAX_LEVEL) {
      this.pXpTxt.setText('MAX');
      this.bar(g, 20, 204, 220, 6, 1, 0xb39ddb);
    } else {
      this.pXpTxt.setText(`${Math.floor(info.into)} / ${info.need}`);
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

    // ── Безопасная зона ── (гаснет, пока игрок атакует у базы — защита снята)
    this.safeTxt.setX(W / 2).setY(targetBottom).setVisible(!!this.gs.safeProtected);

    // ── Миникарта (векторные блипы) ──
    this.drawMinimap();

    // ── Подсказка (выше action bar) ──
    this.hint.setPosition(W / 2, H - 66);

    // ── Action bar ──
    this._updateActionBarHUD(this.time.now);

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

    // Лут (янтарные точки)
    g.fillStyle(COLORS.amber, 0.9);
    for (const l of gs.loot) { if (!l.alive) continue; const p = worldToMinimap(l.x, l.y, r, ww, wh); g.fillCircle(p.x, p.y, 1.6); }

    // Мобы (красные; боссы крупнее/оранжевые)
    for (const m of gs.mobs) {
      if (!m.alive) continue;
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
