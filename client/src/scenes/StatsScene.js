import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { buildStatsBreakdown } from '../systems/statsBreakdown.js';

// Окно "Статы конфигурации" — детальная разбивка боевых статов по источникам (предмет:
// база/апгрейд/перк + общие модификаторы: улучшение корабля/скиллы/платы/пассивки/бустеры).
// Открывается ПОВЕРХ GarageScene (кнопка "СТАТЫ" на вкладке ОБОРУДОВАНИЕ) тем же паттерном,
// что и ProfileViewScene (`scene.launch`, без pause/stop нижней сцены) — см. диалог: "окно
// поверх оборудования, непрозрачное, задний фон тот же что и в гараже".
const TABS = [
  { id: 'damage', label: 'УРОН' },
  { id: 'shield', label: 'ЩИТ' },
  { id: 'hull',   label: 'ПРОЧНОСТЬ' },
  { id: 'speed',  label: 'СКОРОСТЬ' },
  { id: 'other',  label: 'ДРУГОЕ' },
];

// Колонки — доли от ширины видимой области (viewW), а не фикс. пиксели: диалог "мелковато,
// есть ещё запас справа" — итоговая колонка раньше сидела в фикс. x=760 и не растягивалась
// на всю ширину широкой панели. ИТОГ теперь прижат к правому краю (setOrigin(1,0)).
const COL_FRAC = { type: 0, name: 0.065, base: 0.30, upg: 0.40, perk: 0.50 };
const ROW_H = 26, TITLE_H = 32, HEADER_H = 22, MODHDR_H = 20, MOD_H = 21, TOTAL_H = 36, SPACER_H = 22;

export default class StatsScene extends Phaser.Scene {
  constructor() { super('StatsScene'); }

  O(s, c) { return { fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }
  F(s, c) { return { fontFamily: 'Inter, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }

  create(data) {
    this.gs = this.scene.get('GameScene');
    this.tab = data?.tab || 'damage';
    this.scroll = 0;
    const W = this.scale.width, H = this.scale.height;

    // Тот же фон, что у GarageScene — bg_garage либо тёмная заливка.
    if (this.textures.exists('bg_garage')) {
      const bg = this.add.image(W / 2, H / 2, 'bg_garage');
      bg.setScale(Math.max(W / bg.width, H / bg.height)).setAlpha(0.8);
    } else {
      this.add.rectangle(0, 0, W, H, 0x060d18, 1).setOrigin(0);
    }

    const pw = Math.min(1360, W - 40), ph = Math.min(820, H - 40);
    const px = (W - pw) / 2, py = (H - ph) / 2;
    this.box = { px, py, pw, ph };

    const g = this.add.graphics();
    g.fillStyle(0x080d18, 0.96); g.fillRoundedRect(px, py, pw, ph, 12);
    g.lineStyle(2, COLORS.primary, 0.75); g.strokeRoundedRect(px, py, pw, ph, 12);

    this.add.text(px + 24, py + 16, 'СТАТЫ КОНФИГУРАЦИИ', this.O('22px', '#4dd0e1')).setDepth(14);
    const closeBtn = this.add.text(px + pw - 22, py + 24, '✕', this.F('18px', '#335566'))
      .setOrigin(1, 0.5).setDepth(14).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ef5350'));
    closeBtn.on('pointerout',  () => closeBtn.setColor('#335566'));
    closeBtn.on('pointerdown', () => this.scene.stop());
    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());

    const tabSpan = pw / TABS.length;
    TABS.forEach((t, i) => this._tabBtn(px + tabSpan * (i + 0.5), py + 64, t, tabSpan));

    this._viewX = px + 24;
    this._viewY = py + 102;
    this._viewW = pw - 48;
    this._viewH = ph - 102 - 20;
    this._listObjs = [];

    // Колонки в пикселях — считаем один раз от реальной ширины видимой области.
    const vw = this._viewW;
    this._col = {
      type: 0,
      name: Math.round(vw * COL_FRAC.name),
      base: Math.round(vw * COL_FRAC.base),
      upg:  Math.round(vw * COL_FRAC.upg),
      perk: Math.round(vw * COL_FRAC.perk),
      totalRight: vw - 8, // правый край, ИТОГ прижимается сюда через setOrigin(1,0)
    };

    this._layout();
    this._draw();

    this.input.on('wheel', (ptr, _go, _dx, dy) => {
      if (ptr.x < this._viewX || ptr.x > this._viewX + this._viewW) return;
      this.scroll = Phaser.Math.Clamp(this.scroll + dy * 0.5, 0, this._maxScroll);
      this._draw();
    });
  }

  _tabBtn(x, y, t, span) {
    const active = this.tab === t.id;
    const label = this.add.text(x, y, t.label, this.O('15px', active ? '#4dd0e1' : '#7e9398'))
      .setOrigin(0.5).setDepth(14).setInteractive({ useHandCursor: true });
    if (active) this.add.rectangle(x, y + 18, span - 20, 2, COLORS.primary).setOrigin(0.5, 0).setDepth(14);
    label.on('pointerdown', () => { if (this.tab !== t.id) this.scene.restart({ tab: t.id }); });
  }

  // Строит плоский список "виртуальных" строк с накопленным Y — без создания display-объектов
  // (тот же принцип, что MissionsScene._drawMissionRows/GarageScene._drawBoardList: сначала
  // геометрия, потом рисуем только то, что попадает в видимую область).
  _layout() {
    const breakdown = buildStatsBreakdown(this.gs);
    const blocks = breakdown[this.tab] || [];
    const rows = [];
    let y = 0;
    for (const block of blocks) {
      rows.push({ type: 'title', y, h: TITLE_H, block });
      y += TITLE_H;
      if (block.itemRows.length) {
        rows.push({ type: 'header', y, h: HEADER_H });
        y += HEADER_H;
        for (const r of block.itemRows) { rows.push({ type: 'item', y, h: ROW_H, r }); y += ROW_H; }
      }
      if (block.modRows.length) {
        rows.push({ type: 'modhdr', y, h: MODHDR_H });
        y += MODHDR_H;
        for (const r of block.modRows) { rows.push({ type: 'mod', y, h: MOD_H, r }); y += MOD_H; }
      }
      rows.push({ type: 'total', y, h: TOTAL_H, block });
      y += TOTAL_H + SPACER_H;
    }
    this._rows = rows;
    this._contentH = y;
    this._maxScroll = Math.max(0, this._contentH - this._viewH);
    this.scroll = Math.min(this.scroll, this._maxScroll);
  }

  _draw() {
    this._listObjs.forEach(o => o?.destroy());
    this._listObjs = [];
    const { _viewX: vx, _viewY: vy, _viewW: vw, _viewH: vh, _col: COL } = this;
    const put = o => { this._listObjs.push(o); return o; };
    const perkWrapW = Math.max(120, COL.totalRight - 110 - COL.perk);

    if (!this._rows.length) {
      put(this.add.text(vx, vy, 'Нет данных для этой вкладки (пустые слоты).', this.F('14px', '#7e9398')).setDepth(14));
    }

    for (const row of this._rows) {
      const sy = vy + row.y - this.scroll;
      if (sy + row.h < vy || sy > vy + vh) continue; // строго вне видимой зоны — не рисуем
      if (row.type === 'title') {
        put(this.add.text(vx, sy, row.block.title, this.O('16px', '#cfe9ee')).setDepth(14));
      } else if (row.type === 'header') {
        put(this.add.text(vx + COL.type, sy, 'ТИП',      this.F('11px', '#4a6a7a')).setDepth(14));
        put(this.add.text(vx + COL.name, sy, 'ПРЕДМЕТ',  this.F('11px', '#4a6a7a')).setDepth(14));
        put(this.add.text(vx + COL.base, sy, 'БАЗА',     this.F('11px', '#4a6a7a')).setDepth(14));
        put(this.add.text(vx + COL.upg,  sy, 'АПГРЕЙД',  this.F('11px', '#4a6a7a')).setDepth(14));
        put(this.add.text(vx + COL.perk, sy, 'ПЕРК',     this.F('11px', '#4a6a7a')).setDepth(14));
        put(this.add.text(vx + COL.totalRight, sy, 'ИТОГ', this.F('11px', '#4a6a7a')).setOrigin(1, 0).setDepth(14));
      } else if (row.type === 'item') {
        const r = row.r;
        put(this.add.text(vx + COL.type, sy, r.category, this.F('12px', '#5a8aaa')).setDepth(14));
        put(this.add.text(vx + COL.name, sy, r.name,      this.F('12px', '#c8d8dc')).setDepth(14));
        put(this.add.text(vx + COL.base, sy, String(r.base), this.F('12px', '#9fb3b8')).setDepth(14));
        put(this.add.text(vx + COL.upg,  sy, r.upgradePct || '—', this.F('12px', r.upgradePct ? '#7ee8a0' : '#4a6a7a')).setDepth(14));
        put(this.add.text(vx + COL.perk, sy, r.perk || '—', this.F('11px', r.perk ? '#8abccc' : '#4a6a7a')).setDepth(14).setWordWrapWidth(perkWrapW));
        put(this.add.text(vx + COL.totalRight, sy, String(r.rowTotal), this.F('13px', '#ffe0b2')).setOrigin(1, 0).setDepth(14));
      } else if (row.type === 'modhdr') {
        put(this.add.text(vx + COL.name, sy, 'Общие модификаторы:', this.F('11px', '#4a6a7a')).setDepth(14));
      } else if (row.type === 'mod') {
        put(this.add.text(vx + COL.name, sy, row.r.label, this.F('12px', '#7e9398')).setDepth(14));
        put(this.add.text(vx + COL.totalRight, sy, row.r.value, this.F('12px', '#9fb3b8')).setOrigin(1, 0).setDepth(14));
      } else if (row.type === 'total') {
        put(this.add.rectangle(vx, sy + 2, vw, 1, 0x1e3a50, 0.7).setOrigin(0, 0).setDepth(14));
        put(this.add.text(vx, sy + 7, row.block.totalLabel, this.O('14px', '#ffd54f')).setDepth(14));
        put(this.add.text(vx + COL.totalRight, sy + 7, String(row.block.total), this.O('17px', '#ffd54f')).setOrigin(1, 0).setDepth(14));
      }
    }

    // Скроллбар
    if (this._contentH > vh) {
      const thumbH = Math.max(24, vh * (vh / this._contentH));
      const frac = this._maxScroll > 0 ? this.scroll / this._maxScroll : 0;
      const thumbY = vy + frac * (vh - thumbH);
      put(this.add.rectangle(vx + vw - 4, vy + vh / 2, 6, vh, 0x0a1a28, 0.6).setDepth(14));
      put(this.add.rectangle(vx + vw - 4, thumbY + thumbH / 2, 4, thumbH, 0x1e4a6a, 0.9).setDepth(14));
    }
  }
}
