import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';
import { SECTORS, EDGES, galaxy, neighbors, sectorAccess } from '../galaxy.js';

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

    // Связи-линии
    const lg = this.add.graphics();
    this.mapContainer.add(lg);
    for (const [a, b] of EDGES) {
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

    // Узлы
    for (const key of Object.keys(SECTORS)) {
      const s = SECTORS[key], p = pos(s);
      this.node(p.x, p.y, nodeW, nodeH, key, s, cur, nb, lvl, playerCorp);
    }

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
      { color: '#a5d6a7', label: 'PvP' },
      { color: '#bb86fc', label: 'Данж' },
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

  node(cx, cy, w, h, key, s, cur, nb, lvl, playerCorp) {
    const isCur      = key === cur;
    const acc        = sectorAccess(key, lvl, this.gs.activeShip);
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
      border = COLORS.emerald; fill = 0x12251a; badge = i18n.t('map.jump'); badgeColor = '#a5d6a7';
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
      border = 0xef5350; fill = 0x1c0e0e; badge = 'PvP'; badgeColor = '#ef9a9a';
    } else {
      border = 0x2a4a54; fill = 0x0e1a22; badge = i18n.t('map.sector'); badgeColor = '#7e9398';
    }

    const x = cx - w / 2, y = cy - h / 2;
    const r = this.add.rectangle(x, y, w, h, fill, 0.97).setOrigin(0, 0)
      .setStrokeStyle(isCur || canJump ? 3 : 1.5, border, 0.95)
      .setAlpha(nodeAlpha);

    const textCol = acc.ok ? '#cfe9ee' : '#8a7274';
    const tName  = this.add.text(cx, y + 10, s.name,
      { ...this.O('14px', textCol), align: 'center', wordWrap: { width: w - 16 } })
      .setOrigin(0.5, 0).setAlpha(nodeAlpha);
    const tLvl   = this.add.text(cx, y + h - 32, `ур. ${s.lvlMin}–${s.lvlMax}`,
      this.F('11px', '#9fb3b8')).setOrigin(0.5, 0).setAlpha(nodeAlpha);
    const tBadge = this.add.text(cx, y + h - 17, badge,
      this.F('11px', badgeColor)).setOrigin(0.5, 0).setAlpha(nodeAlpha);

    this.mapContainer.add([r, tName, tLvl, tBadge]);

    if (canJump) {
      r.setInteractive({ useHandCursor: true }).on('pointerdown', (p, lx, ly, event) => {
        if (event) event.stopPropagation();
        this.scene.stop();
        this.gs.travelTo(key);
      });
    }
  }
}
