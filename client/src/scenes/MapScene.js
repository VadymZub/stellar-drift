import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';
import { SECTORS, EDGES, galaxy, neighbors, sectorAccess } from '../galaxy.js';

// Экран-схема галактики (хоткей M). Узлы home-цепочки + PvP с названиями и доступом по уровню,
// связи-линии (джапгейты). Текущий сектор подсвечен. Клик по СОСЕДНЕМУ доступному сектору — прыжок.
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

    // Фиксированный фон и заголовок
    this.add.rectangle(0, 0, W, H, 0x04060d, 0.88).setOrigin(0).setInteractive(); // Захват кликов фона
    this.uiHeader = this.add.container(0, 0).setDepth(100);
    this.uiHeader.add(this.add.text(W / 2, 28, i18n.t('map.title'), this.O('24px', '#4dd0e1')).setOrigin(0.5, 0));
    this.uiHeader.add(this.add.text(W / 2, 64, i18n.t('map.hint'), this.F('12px', '#7e9398')).setOrigin(0.5, 0));

    // Контейнер для карты
    this.mapContainer = this.add.container(0, 0);

    // Раскладка узлов по схеме (sx 0..5, sy -2..2)
    const nodeW = 184, nodeH = 74;
    const colSpacing = 240;
    const rowSpacing = 160;
    
    // Центрируем карту изначально по текущему сектору или просто по центру сетки
    const mapCenter = { x: W / 2 - 2 * colSpacing, y: H / 2 };
    this.mapContainer.setPosition(mapCenter.x, mapCenter.y);

    const pos = (s) => ({ x: s.sx * colSpacing, y: s.sy * rowSpacing });

    // Связи-линии
    const lg = this.add.graphics();
    this.mapContainer.add(lg);
    for (const [a, b] of EDGES) {
      const pa = pos(SECTORS[a]), pb = pos(SECTORS[b]);
      const hot = (a === cur || b === cur);
      lg.lineStyle(hot ? 3 : 2, hot ? COLORS.amber : 0x2a4a54, hot ? 0.9 : 0.6);
      lg.lineBetween(pa.x, pa.y, pb.x, pb.y);
    }

    // Узлы
    for (const key of Object.keys(SECTORS)) {
      const s = SECTORS[key], p = pos(s);
      this.node(p.x, p.y, nodeW, nodeH, key, s, cur, nb, lvl);
    }

    // Логика перетаскивания (Panning)
    this.input.on('pointermove', (pointer) => {
      if (!pointer.isDown) return;
      this.mapContainer.x += (pointer.x - pointer.prevPosition.x);
      this.mapContainer.y += (pointer.y - pointer.prevPosition.y);
    });

    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());
  }

  node(cx, cy, w, h, key, s, cur, nb, lvl) {
    const isCur = key === cur;
    const acc = sectorAccess(key, lvl, this.gs.activeShip);
    const isNeighbor = nb.includes(key);
    const canJump = isNeighbor && acc.ok;

    let border, fill, badge, badgeColor;
    if (isCur) { border = COLORS.amber; fill = 0x2a2415; badge = i18n.t('map.here'); badgeColor = '#ffb74d'; }
    else if (!acc.ok) { border = 0x4a3030; fill = 0x140e10; badge = `🔒 ${acc.reason}`; badgeColor = '#ef9a9a'; }
    else if (canJump) { border = COLORS.emerald; fill = 0x12251a; badge = i18n.t('map.jump'); badgeColor = '#a5d6a7'; }
    else { border = 0x2a4a54; fill = 0x0e1a22; badge = s.pvp ? 'PvP' : i18n.t('map.sector'); badgeColor = '#7e9398'; }

    const x = cx - w / 2, y = cy - h / 2;
    const r = this.add.rectangle(x, y, w, h, fill, 0.97).setOrigin(0, 0)
      .setStrokeStyle(isCur || canJump ? 3 : 1.5, border, 0.95);
    
    const tName = this.add.text(cx, y + 10, s.name, { ...this.O('14px', acc.ok ? '#cfe9ee' : '#8a7274'), align: 'center', wordWrap: { width: w - 16 } }).setOrigin(0.5, 0);
    const tLvl = this.add.text(cx, y + h - 32, `ур. ${s.lvlMin}–${s.lvlMax}`, this.F('11px', '#9fb3b8')).setOrigin(0.5, 0);
    const tBadge = this.add.text(cx, y + h - 17, badge, this.F('11px', badgeColor)).setOrigin(0.5, 0);

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
