import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { itemName, itemStats } from '../items.js';
import { PERK_MAP, RARITY_COLOR, perkBonus } from '../perks.js';

// Трюм (хоткей C). Доступен всегда — в космосе и на базе.
// На базе добавляет колонку СКЛАД и кнопки переноса предметов.
export default class CargoScene extends Phaser.Scene {
  constructor() { super('CargoScene'); }

  O(s, c) { return { fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }
  F(s, c) { return { fontFamily: 'Inter, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }

  _cargoMax() { const gs = this.gs; const sl = gs.skillLevels?.cargo_expand || 0; return 8 + sl * (sl + 1) + (gs.premium ? 8 : 0); }
  _whMax()    { const gs = this.gs; const sl = gs.skillLevels?.cargo_expand || 0; return 8 + sl * (sl + 1) + (gs.premium ? 8 : 0); }

  create() {
    this.gs = this.scene.get('GameScene');
    const W = this.scale.width, H = this.scale.height;

    const _bg = this.add.image(W / 2, H / 2, 'bg_garage');
    _bg.setScale(Math.max(W / _bg.width, H / _bg.height)).setAlpha(0.8);

    const atBase = !!this.gs.atBase;
    const pw = atBase ? Math.min(900, W - 40) : Math.min(580, W - 60);
    // ph: нужно 518px для сетки (28 слотов / 4 кол = 7 рядов × 74px) + 90px заголовок = 608.
    // Ограничиваем снизу: панель не должна заходить за action bar (H - 62).
    const ph = Math.min(640, H - 124);
    const px = (W - pw) / 2;
    const py = Math.min(Math.round((H - ph) / 2), H - ph - 62);

    const panel = this.add.graphics();
    panel.fillStyle(0x080e1a, 0.97); panel.fillRoundedRect(px, py, pw, ph, 12);
    panel.lineStyle(2, COLORS.primary, 0.7); panel.strokeRoundedRect(px, py, pw, ph, 12);

    this.add.text(px + 22, py + 16, 'СКЛАД', this.O('20px', '#4dd0e1'));
    this.add.text(px + pw - 20, py + 20, 'C / ESC', this.F('11px', '#445566')).setOrigin(1, 0);

    const cargoMax = this._cargoMax(), whMax = this._whMax();
    const cargoCount = (this.gs.inventory || []).length;
    const capColor = cargoCount >= cargoMax ? '#ef5350' : '#4a6678';
    this.add.text(px + 22, py + 46, `ТРЮМ ${cargoCount}/${cargoMax}  ·  СКЛАД ${(this.gs.warehouse||[]).length}/${whMax}`, this.F('12px', '#4a6678'));

    this.panelBox = { px, py, pw, ph };

    if (atBase) {
      const BTN_H = 32;
      const gridH = ph - 90 - BTN_H - 10;
      // Минимум 290 px = ровно 4 колонки × 68 px + 3 зазора × 6 px
      const colW = Math.max(290, Math.floor((pw - 36) / 2));
      this._renderSlotGrid(px + 12, py + 72, colW, gridH, this.gs.inventory || [], cargoMax, 'cargo');
      this._renderSlotGrid(px + colW + 24, py + 72, colW, gridH, this.gs.warehouse || [], whMax, 'warehouse');
      // Column headers
      this.add.text(px + 12 + colW / 2, py + 58, 'ТРЮМ КОРАБЛЯ', this.O('12px', '#2a5a70')).setOrigin(0.5, 0);
      this.add.text(px + colW + 24 + colW / 2, py + 58, `СКЛАД  ${(this.gs.warehouse||[]).length}/${whMax}`,
        this.O('12px', '#2a5a30')).setOrigin(0.5, 0);
      // Кнопка перехода в Гараж
      const btnY = py + 72 + gridH + 8;
      const btnBg = this.add.rectangle(px + 12, btnY, pw - 24, BTN_H, 0x0d1e2c, 0.95)
        .setOrigin(0, 0).setStrokeStyle(1, 0x1e3a50, 0.7).setInteractive({ useHandCursor: true }).setDepth(15);
      const btnLbl = this.add.text(px + pw / 2, btnY + BTN_H / 2, 'ГАРАЖ  →  G',
        this.O('12px', '#4dd0e1')).setOrigin(0.5).setDepth(15);
      btnBg.on('pointerover', () => { btnBg.setFillStyle(0x142838); btnLbl.setColor('#7ee8f0'); });
      btnBg.on('pointerout',  () => { btnBg.setFillStyle(0x0d1e2c); btnLbl.setColor('#4dd0e1'); });
      btnBg.on('pointerdown', () => {
        this.scene.stop();
        if (this.scene.isActive('GarageScene')) this.scene.bringToTop('GarageScene');
        else this.scene.launch('GarageScene');
      });
    } else {
      this._renderSlotGrid(px + 12, py + 72, pw - 24, ph - 90, this.gs.inventory || [], cargoMax, 'cargo_nosell');
      this.add.text(px + 12 + (pw - 24) / 2, py + 58, 'ТРЮМ КОРАБЛЯ', this.O('12px', '#2a5a70')).setOrigin(0.5, 0);
    }

    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());
  }

  // Слот-сетка: type = 'cargo' | 'cargo_nosell' | 'warehouse'
  _renderSlotGrid(ax, ay, aw, ah, items, maxSlots, type, clipBotH) {
    const gs = this.gs;
    const SZ = 68, GAP = 6, COLS = 4;
    const container = this.add.container(ax, ay);
    const displaySlots = Math.max(items.length, maxSlots);

    for (let i = 0; i < displaySlots; i++) {
      const col = i % COLS, row = Math.floor(i / COLS);
      const sx = col * (SZ + GAP), sy = row * (SZ + GAP);
      const item = items[i] || null;
      const overflow = i >= maxSlots;

      if (!item) {
        if (!overflow) {
          container.add(
            this.add.rectangle(sx, sy, SZ, SZ, 0x0f2035, 0.9).setOrigin(0, 0)
              .setStrokeStyle(1, 0x2a4870, 0.65)
          );
        }
        continue;
      }

      const pDef   = item.perk ? PERK_MAP[item.perk.key] : null;
      const rarHex = pDef ? RARITY_COLOR[pDef.rarity] : null;
      const bdrHex = rarHex ?? (COLORS.primary & 0xffffff);
      const STRIP_H = 16, BODY_H = SZ - STRIP_H;

      if (type === 'cargo') {
        const box = this.add.rectangle(sx, sy, SZ, BODY_H, 0x0d1e2c, 0.95).setOrigin(0, 0)
          .setStrokeStyle(2, bdrHex, 0.75).setInteractive({ useHandCursor: true });
        box.on('pointerover', (p) => this._showTooltip(p.x, p.y, item));
        box.on('pointerout',  ()  => this._hideTooltip());
        const strip = this.add.rectangle(sx, sy + BODY_H, SZ, STRIP_H, 0x071828, 0.9).setOrigin(0, 0)
          .setStrokeStyle(1, 0x2a6888, 0.5).setInteractive({ useHandCursor: true });
        const stripT = this.add.text(sx + SZ / 2, sy + BODY_H + STRIP_H / 2, '→ склад',
          this.F('9px', '#4aa8cc')).setOrigin(0.5);
        strip.on('pointerdown', () => this._moveToWarehouse(item));
        const tier = this.add.text(sx + SZ / 2, sy + BODY_H / 2 - 7, `T${item.tier}`,
          this.O('14px', '#ffe0b2')).setOrigin(0.5);
        const typeL = this.add.text(sx + SZ / 2, sy + BODY_H / 2 + 9,
          item.type.slice(0, 3).toUpperCase(), this.F('10px', '#445566')).setOrigin(0.5);
        container.add([box, strip, stripT, tier, typeL]);
      } else if (type === 'cargo_nosell') {
        const box = this.add.rectangle(sx, sy, SZ, SZ, 0x0d1e2c, 0.9).setOrigin(0, 0)
          .setStrokeStyle(1, bdrHex, 0.6).setInteractive({ useHandCursor: true });
        box.on('pointerover', (p) => this._showTooltip(p.x, p.y, item));
        box.on('pointerout',  ()  => this._hideTooltip());
        const tier = this.add.text(sx + SZ / 2, sy + SZ / 2 - 7, `T${item.tier}`,
          this.O('14px', '#ffe0b2')).setOrigin(0.5);
        const typeL = this.add.text(sx + SZ / 2, sy + SZ / 2 + 9,
          item.type.slice(0, 3).toUpperCase(), this.F('10px', '#445566')).setOrigin(0.5);
        container.add([box, tier, typeL]);
      } else {
        const box = this.add.rectangle(sx, sy, SZ, BODY_H, 0x0c1a10, 0.9).setOrigin(0, 0)
          .setStrokeStyle(1, bdrHex, pDef ? 0.5 : 0.22).setInteractive({ useHandCursor: true });
        box.on('pointerover', (p) => this._showTooltip(p.x, p.y, item));
        box.on('pointerout',  ()  => this._hideTooltip());
        const strip = this.add.rectangle(sx, sy + BODY_H, SZ, STRIP_H, 0x0a1a0a, 0.9).setOrigin(0, 0)
          .setStrokeStyle(1, 0x2a6840, 0.4).setInteractive({ useHandCursor: true });
        const stripT = this.add.text(sx + SZ / 2, sy + BODY_H + STRIP_H / 2, '← трюм',
          this.F('9px', '#4a9860')).setOrigin(0.5);
        strip.on('pointerdown', () => {
          const cargoMax = this._cargoMax();
          const inv = gs.inventory || [];
          if (inv.length >= cargoMax) return;
          const idx = (gs.warehouse || []).indexOf(item); if (idx < 0) return;
          gs.warehouse.splice(idx, 1); inv.push(item);
          this.scene.restart();
        });
        const tier = this.add.text(sx + SZ / 2, sy + BODY_H / 2 - 7, `T${item.tier}`,
          this.O('14px', '#b8e4c4')).setOrigin(0.5);
        const typeL = this.add.text(sx + SZ / 2, sy + BODY_H / 2 + 9,
          item.type.slice(0, 3).toUpperCase(), this.F('10px', '#2a5a38')).setOrigin(0.5);
        container.add([box, strip, stripT, tier, typeL]);
      }

      if (rarHex) {
        const dg = this.add.graphics();
        dg.fillStyle(rarHex, 1); dg.fillCircle(sx + SZ - 6, sy + 6, 4);
        container.add(dg);
      }
      if (overflow) {
        const dg = this.add.graphics();
        dg.fillStyle(0xffa000, 0.85); dg.fillTriangle(sx, sy, sx + 14, sy, sx, sy + 14);
        container.add(dg);
      }
    }

    // ── Cover strips: clip overflow outside the visible grid area ─────────
    const pbox = this.panelBox;
    const botH = clipBotH != null ? clipBotH : (pbox ? Math.max(4, pbox.py + pbox.ph - ay - ah) : 20);
    if (botH > 0) this.add.rectangle(ax, ay + ah, aw, botH, 0x080e1a).setOrigin(0, 0).setDepth(12);
    // Right strip: только малый отступ панели (≤20px), не покрывает соседние колонки
    if (pbox) {
      const rW = pbox.px + pbox.pw - ax - aw;
      if (rW > 0 && rW <= 20) this.add.rectangle(ax + aw, ay, rW, ah, 0x080e1a).setOrigin(0, 0).setDepth(12);
    }

    // ── Wheel scroll + scrollbar ───────────────────────────────────────────
    const totalH = Math.ceil(displaySlots / COLS) * (SZ + GAP);
    if (totalH > ah) {
      const startY = ay, minY = ay - (totalH - ah);
      const SBW = 3, thumbH = Math.max(20, Math.round(ah * ah / totalH));
      const thumb = this.add.rectangle(ax + aw - SBW - 2, ay, SBW, thumbH, 0x2a6080, 0.7)
        .setOrigin(0, 0).setDepth(13);
      const updateSB = () => {
        const frac = startY > minY ? (startY - container.y) / (startY - minY) : 0;
        thumb.setY(ay + Math.round(frac * (ah - thumbH)));
      };
      this.input.on('wheel', (p, _o, _dx, dy) => {
        if (p.x < ax || p.x > ax + aw || p.y < ay || p.y > ay + ah) return;
        container.y = Phaser.Math.Clamp(container.y - dy * 0.5, minY, startY);
        updateSB();
      });
    }
  }

  _showTooltip(wx, wy, item) {
    this._hideTooltip();
    if (!item) return;
    const W = this.scale.width, H = this.scale.height;
    const pDef = item.perk ? PERK_MAP[item.perk.key] : null;
    const rarColor = pDef ? `#${RARITY_COLOR[pDef.rarity].toString(16).padStart(6, '0')}` : null;
    const TW = 230, LINE_H = 17;
    const lines = [
      { text: itemName(item),  sty: this.O('13px', '#ffe0b2') },
      { text: itemStats(item), sty: this.F('11px', '#9fb3b8') },
    ];
    if (pDef) {
      lines.push({ text: pDef.name,                       sty: this.F('11px', rarColor) });
      lines.push({ text: pDef.desc(perkBonus(item.perk)), sty: this.F('11px', '#aaccdd') });
    }
    const TH = 10 + lines.length * LINE_H + 6;
    let tx = wx + 16, ty = wy - TH / 2;
    if (tx + TW > W - 8) tx = wx - TW - 8;
    if (ty < 4) ty = 4;
    if (ty + TH > H - 4) ty = H - TH - 4;
    const g = this.add.graphics().setDepth(200);
    g.fillStyle(0x08121e, 0.97); g.fillRoundedRect(tx, ty, TW, TH, 6);
    g.lineStyle(1, 0x1e3a50, 0.9); g.strokeRoundedRect(tx, ty, TW, TH, 6);
    const objs = [g];
    let ly = ty + 8;
    for (const l of lines) {
      objs.push(this.add.text(tx + 10, ly, l.text,
        { ...l.sty, wordWrap: { width: TW - 20 } }).setDepth(201));
      ly += LINE_H;
    }
    this._tooltipObjs = objs;
  }

  _hideTooltip() {
    if (!this._tooltipObjs) return;
    this._tooltipObjs.forEach(o => o?.destroy());
    this._tooltipObjs = null;
  }

  _moveToWarehouse(item) {
    const inv = this.gs.inventory;
    const idx = inv.indexOf(item);
    if (idx < 0) return;
    const whMax = this._whMax();
    this.gs.warehouse = this.gs.warehouse || [];
    if (this.gs.warehouse.length >= whMax) return;
    inv.splice(idx, 1);
    this.gs.warehouse.push(item);
    this.scene.restart();
  }
}
