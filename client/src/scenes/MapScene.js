import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';
import { SECTORS, EDGES, galaxy, neighbors, sectorAccess } from '../galaxy.js';
import { getActiveMissionSectorTargets } from '../data/missions.js';

// Корпорация сектора: 'karax' | 'tides' | null (гелиос/pvp/данжи гелиоса — нейтральные)
function sectorCorp(key) {
  if (key.startsWith('karax')) return 'karax';
  if (key.startsWith('tides')) return 'tides';
  return null;
}

const CORP_STYLE = {
  karax: { border: 0x4fc3f7, fill: 0x071624, dimBorder: 0x1a3a4a, dimFill: 0x040d12, text: '#4fc3f7', dimText: '#1e4a5e' },
  tides: { border: 0x4db6ac, fill: 0x071a18, dimBorder: 0x1a3a36, dimFill: 0x040e0d, text: '#4db6ac', dimText: '#1e4a44' },
};

// Экран-схема галактики (хоткей M). Узлы всех секторов с цветовым кодом по корпорации,
// связи-линии (джапгейты). Текущий сектор подсвечен. Клик по соседнему доступному — прыжок.
export default class MapScene extends Phaser.Scene {
  constructor() { super('MapScene'); }
  O(s, c) { return { fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }
  F(s, c) { return { fontFamily: 'Inter, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }

  create() {
    this.gs = this.scene.get('GameScene');
    const W = this.scale.width, H = this.scale.height;
    const lvl = this.gs.pilotLevel || 1;
    const cur = galaxy.current;
    const nb = neighbors(cur);
    const playerCorp = this.gs.playerCorp || 'neutral';

    // Фиксированный фон и заголовок
    this.add.rectangle(0, 0, W, H, 0x04060d, 0.88).setOrigin(0).setInteractive();
    this.uiHeader = this.add.container(0, 0).setDepth(100);
    this.uiHeader.add(this.add.text(W / 2, 28, i18n.t('map.title'), this.O('24px', '#4dd0e1')).setOrigin(0.5, 0));
    this.uiHeader.add(this.add.text(W / 2, 64, i18n.t('map.hint'), this.F('12px', '#7e9398')).setOrigin(0.5, 0));

    // Легенда корпорации
    this._drawLegend(W, H, playerCorp);

    // Контейнер для карты
    this.mapContainer = this.add.container(0, 0);

    const nodeW = 184, nodeH = 74;
    const colSpacing = 240;
    const rowSpacing = 120;

    // Центрируем вид так, чтобы PvP-ряд (sy=1) всегда был виден:
    // для корп-секторов берём середину между текущим рядом и PvP.
    const curSec = SECTORS[cur];
    let viewSy = curSec.sy;
    if (curSec.sy <= -2) viewSy = (curSec.sy + 1) / 2;  // Karax / их данжи
    if (curSec.sy >= 2)  viewSy = (curSec.sy + 1) / 2;  // Tides / их данжи
    this.mapContainer.setPosition(
      W / 2 - curSec.sx * colSpacing,
      H / 2 - viewSy * rowSpacing
    );

    const pos = (s) => ({ x: s.sx * colSpacing, y: s.sy * rowSpacing });

    // Связи-линии (данжи исключены из основной карты)
    const lg = this.add.graphics();
    this.mapContainer.add(lg);
    for (const [a, b] of EDGES) {
      if (SECTORS[a]?.isDungeon || SECTORS[b]?.isDungeon) continue;
      const pa = pos(SECTORS[a]), pb = pos(SECTORS[b]);
      const sa = SECTORS[a], sb = SECTORS[b];
      const hot = (a === cur || b === cur);
      const scA = sectorCorp(a), scB = sectorCorp(b);
      const edgeCorp = scA || scB;
      let lineColor = hot ? COLORS.amber : 0x2a4a54;
      let lineAlpha = hot ? 0.9 : 0.5;
      if (!hot && edgeCorp) {
        const cs = CORP_STYLE[edgeCorp];
        const isOwn = edgeCorp === playerCorp;
        lineColor = isOwn ? cs.border : cs.dimBorder;
        lineAlpha = isOwn ? 0.6 : 0.25;
      }
      lg.lineStyle(hot ? 3 : 2, lineColor, lineAlpha);
      lg.lineBetween(pa.x, pa.y, pb.x, pb.y);

      // Для длинных связей (пересекают >1 ряда) — стрелочки вдоль линии
      const syDiff = Math.abs(sa.sy - sb.sy);
      if (syDiff > 1) {
        const angle  = Math.atan2(pb.y - pa.y, pb.x - pa.x);
        const L = 9, W = 5;
        const steps = syDiff; // одна стрелка на каждый пересечённый ряд
        lg.fillStyle(lineColor, lineAlpha);
        for (let i = 1; i <= steps; i++) {
          const t  = i / (steps + 1);
          const mx = pa.x + (pb.x - pa.x) * t;
          const my = pa.y + (pb.y - pa.y) * t;
          // Наконечник стрелки — равнобедренный треугольник
          const bx = mx - L * Math.cos(angle);
          const by = my - L * Math.sin(angle);
          lg.beginPath();
          lg.moveTo(mx, my);
          lg.lineTo(bx - W * Math.sin(angle), by + W * Math.cos(angle));
          lg.lineTo(bx + W * Math.sin(angle), by - W * Math.cos(angle));
          lg.closePath();
          lg.fillPath();
        }
      }
    }

    const missionTargets = getActiveMissionSectorTargets(this.gs.missionState, this.gs.playerCorp ?? 'helios');

    // Узлы (данжи — только в боковой панели)
    for (const key of Object.keys(SECTORS)) {
      const s = SECTORS[key];
      if (s.isDungeon || s.personal) continue;
      const p = pos(s);
      this.node(p.x, p.y, nodeW, nodeH, key, s, cur, nb, lvl, playerCorp, missionTargets);
    }

    // Боковая панель данжей (фиксированная, не прокручивается)
    this._drawDungeonPanel(W, H, lvl, cur);

    // Перетаскивание
    this.input.on('pointermove', (pointer) => {
      if (!pointer.isDown) return;
      this.mapContainer.x += (pointer.x - pointer.prevPosition.x);
      this.mapContainer.y += (pointer.y - pointer.prevPosition.y);
    });

    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());
    this.input.keyboard.on('keydown-M',   () => this.scene.stop());
  }

  _drawLegend(W, H, playerCorp) {
    const tf = { fontFamily: 'Orbitron, sans-serif', resolution: UI_RES };
    const items = [
      { color: '#ffb74d', label: 'HELIOS' },
      { color: CORP_STYLE.karax.text, label: 'KARAX', corp: 'karax' },
      { color: CORP_STYLE.tides.text, label: 'TIDES', corp: 'tides' },
      { color: '#ef5350', label: 'PvP' },
      { color: '#bb86fc', label: 'Данж' },
      { color: '#66bb6a', label: 'Прыжок' },
    ];
    let lx = 24;
    for (const item of items) {
      const isOwn = item.corp && item.corp === playerCorp;
      const alpha = item.corp && item.corp !== playerCorp && playerCorp !== 'neutral' ? 0.35 : 1;
      const dot = this.add.circle(lx, H - 28, 5, Phaser.Display.Color.HexStringToColor(item.color).color, 1).setAlpha(alpha).setDepth(101);
      const txt = this.add.text(lx + 10, H - 28, item.label + (isOwn ? ' ★' : ''),
        { ...tf, fontSize: '11px', color: item.color }).setOrigin(0, 0.5).setAlpha(alpha).setDepth(101);
      lx += txt.width + 28;
    }
  }

  node(cx, cy, w, h, key, s, cur, nb, lvl, playerCorp, missionTargets) {
    const isCur      = key === cur;
    const acc        = sectorAccess(key, lvl, this.gs.activeShip, this.gs.premium, this.gs.missionState, playerCorp);
    const isNeighbor = nb.includes(key);
    const canJump    = isNeighbor && acc.ok;
    const sc         = sectorCorp(key);           // 'karax' | 'tides' | null
    const isOwnCorp  = sc && sc === playerCorp;
    const isOtherCorp = sc && sc !== playerCorp && playerCorp !== 'neutral';

    let border, fill, badge, badgeColor, nodeAlpha = 1;

    if (isCur) {
      border = COLORS.amber; fill = 0x2a2415; badge = i18n.t('map.here'); badgeColor = '#ffb74d';
    } else if (!acc.ok) {
      border = 0x4a3030; fill = 0x140e10; badge = `🔒 ${acc.reason}`; badgeColor = '#ef9a9a';
      if (isOtherCorp) nodeAlpha = 0.45;
    } else if (canJump) {
      border = COLORS.emerald; fill = 0x12251a; badge = i18n.t('map.jump'); badgeColor = '#66bb6a';
    } else if (isOtherCorp) {
      const cs = CORP_STYLE[sc];
      border = cs.dimBorder; fill = cs.dimFill;
      badge = s.isDungeon ? '⚔' : i18n.t('map.sector');
      badgeColor = cs.dimText;
      nodeAlpha = 0.45;
    } else if (isOwnCorp) {
      const cs = CORP_STYLE[sc];
      border = cs.border; fill = cs.fill;
      badge = s.isDungeon ? '⚔ Данж' : i18n.t('map.sector');
      badgeColor = cs.text;
    } else if (s.isDungeon) {
      border = 0x7e57c2; fill = 0x100c1e; badge = '⚔ Данж'; badgeColor = '#ce93d8';
    } else if (s.pvp) {
      border = 0xef5350; fill = 0x1c0e0e; badge = 'PvP'; badgeColor = '#ef5350';
    } else {
      border = 0x2a4a54; fill = 0x0e1a22; badge = i18n.t('map.sector'); badgeColor = '#7e9398';
    }

    const isMissionTarget = missionTargets?.has(key) && !isCur;

    const x = cx - w / 2, y = cy - h / 2;

    // Mission target: outer amber glow ring
    if (isMissionTarget) {
      const glow = this.add.graphics();
      glow.lineStyle(3, 0xffb74d, 0.55);
      glow.strokeRect(x - 5, y - 5, w + 10, h + 10);
      glow.lineStyle(1, 0xffb74d, 0.2);
      glow.strokeRect(x - 9, y - 9, w + 18, h + 18);
      this.mapContainer.add(glow);
    }

    const r = this.add.rectangle(x, y, w, h, fill, 0.97).setOrigin(0, 0)
      .setStrokeStyle(isCur || canJump ? 3 : isMissionTarget ? 2.5 : 1.5,
                      isMissionTarget ? 0xffb74d : border, 0.95)
      .setAlpha(nodeAlpha);

    const textCol = acc.ok ? '#cfe9ee' : '#8a7274';
    const tName  = this.add.text(cx, y + 10, s.name,
      { ...this.O('14px', textCol), align: 'center', wordWrap: { width: w - 16 } })
      .setOrigin(0.5, 0).setAlpha(nodeAlpha);
    const tLvl   = this.add.text(cx, y + h - 32, `ур. ${s.lvlMin}–${s.lvlMax}`,
      this.F('11px', '#9fb3b8')).setOrigin(0.5, 0).setAlpha(nodeAlpha);

    // Mission target overrides badge
    const tBadge = this.add.text(cx, y + h - 17,
      isMissionTarget ? '★ ЦЕЛЬ МИССИИ' : badge,
      this.F('11px', isMissionTarget ? '#ffb74d' : badgeColor)).setOrigin(0.5, 0).setAlpha(nodeAlpha);

    // Mission star icon top-right corner
    if (isMissionTarget) {
      const tStar = this.add.text(x + w - 6, y + 4, '★',
        this.O('14px', '#ffb74d')).setOrigin(1, 0).setAlpha(0.9);
      this.mapContainer.add(tStar);
    }

    this.mapContainer.add([r, tName, tLvl, tBadge]);

    if (canJump) {
      r.setInteractive({ useHandCursor: true }).on('pointerdown', (p, lx, ly, event) => {
        if (event) event.stopPropagation();
        this.scene.stop();
        this.gs.travelTo(key);
      });
    }
  }

  _drawDungeonPanel(W, H, lvl, cur) {
    const DUNGEON_KEYS = ['dungeon_1','dungeon_2','dungeon_3','dungeon_4','dungeon_5','dungeon_prem','R-1-boss'];
    const pW = 194, pX = W - pW - 12;
    const nodeH = 66, gap = 5;
    const headerH = 30;
    const totalH = headerH + DUNGEON_KEYS.length * (nodeH + gap) + 8;
    const pY = Math.round((H - totalH) / 2);
    const D = 110; // base depth for panel elements

    // Фон панели
    this.add.rectangle(pX, pY, pW, totalH, 0x020810, 0.93)
      .setOrigin(0).setDepth(D).setStrokeStyle(1, 0x1a2a40, 0.8);
    // Разделитель слева
    this.add.rectangle(pX, pY, 2, totalH, 0x7e57c2, 0.6).setOrigin(0).setDepth(D + 1);
    this.add.text(pX + pW / 2, pY + 8, '⚔  ДАНЖИ', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '12px', color: '#bb86fc', resolution: UI_RES,
    }).setOrigin(0.5, 0).setDepth(D + 1);

    DUNGEON_KEYS.forEach((key, i) => {
      const s = SECTORS[key];
      if (!s) return;
      const ny = pY + headerH + i * (nodeH + gap);
      const acc = sectorAccess(key, lvl, this.gs.activeShip, this.gs.premium, this.gs.missionState, this.gs.playerCorp);
      const ok = acc.ok;
      const isCur = key === cur;
      const isPrem = !!s.premium;
      const isBoss = key === 'R-1-boss';

      const bgColor   = isBoss ? 0x1a0a0a : isPrem ? 0x100520 : 0x0a0818;
      const edgeColor = isBoss ? 0xc82828 : isPrem ? 0x7c27a0 : (ok ? 0x5e3e9a : 0x2a1a3a);
      const nameColor = isCur ? '#ffb74d' : (ok ? '#cfe9ee' : '#5a4a5a');

      this.add.rectangle(pX + 5, ny, pW - 10, nodeH, bgColor, 0.95)
        .setOrigin(0).setDepth(D + 1)
        .setStrokeStyle(isCur ? 2 : 1.5, isCur ? 0xffb74d : edgeColor, isCur ? 1 : (ok ? 0.85 : 0.4));

      this.add.text(pX + pW / 2, ny + 7, s.name, {
        fontFamily: 'Orbitron, sans-serif', fontSize: '11px', color: nameColor,
        wordWrap: { width: pW - 18 }, align: 'center', resolution: UI_RES,
      }).setOrigin(0.5, 0).setDepth(D + 2);

      this.add.text(pX + pW / 2, ny + nodeH - 31, `ур. ${s.lvlMin}–${s.lvlMax}`, {
        fontFamily: 'Inter, sans-serif', fontSize: '10px', color: '#7090a0', resolution: UI_RES,
      }).setOrigin(0.5, 0).setDepth(D + 2);

      const btnLabel = isCur   ? '● ЗДЕСЬ'
                     : !ok     ? `🔒 ${acc.reason}`
                     : isBoss  ? '☠ ВОЙТИ'
                     : isPrem  ? '★ ВОЙТИ'
                     : '▶ ВОЙТИ';
      const btnColor = isCur ? '#ffb74d' : !ok ? '#6a5060' : isBoss ? '#ef5350' : isPrem ? '#ce93d8' : '#66bb6a';

      const btn = this.add.text(pX + pW / 2, ny + nodeH - 16, btnLabel, {
        fontFamily: 'Inter, sans-serif', fontSize: '10px', color: btnColor, resolution: UI_RES,
      }).setOrigin(0.5, 0).setDepth(D + 2);

      if (ok && !isCur) {
        const hit = this.add.rectangle(pX + 5, ny, pW - 10, nodeH, 0, 0)
          .setOrigin(0).setDepth(D + 3).setInteractive({ useHandCursor: true });
        hit.on('pointerover',  () => btn.setStyle({ color: '#ffffff' }));
        hit.on('pointerout',   () => btn.setStyle({ color: btnColor }));
        hit.on('pointerdown',  (ptr, lx, ly, ev) => {
          if (ev) ev.stopPropagation();
          galaxy.current = key;
          this.scene.stop();
          this.gs.scene.restart();
        });
      }
    });
  }
}
