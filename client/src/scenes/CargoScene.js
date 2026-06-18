import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';
import { itemName, itemStats, itemIconKey, PLASMATE_PER_SLOT, PLASMATE_GOLD_RATE, removePlasmateFromInventory, totalPlasmateInInventory, CONSUMABLES, AMMO_ICON, addConsumableToInventory } from '../items.js';
import { prerenderTex } from '../utils/prerenderTex.js';
import { PERK_MAP, RARITY_COLOR, perkBonus } from '../perks.js';

// Трюм (хоткей C). Доступен всегда — в космосе и на базе.
// На базе добавляет колонку СКЛАД и кнопки переноса предметов.
export default class CargoScene extends Phaser.Scene {
  constructor() { super('CargoScene'); }

  O(s, c) { return { fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }
  F(s, c) { return { fontFamily: 'Inter, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }

  _cargoMax() {
    const gs = this.gs; const sl = gs.skillLevels?.cargo_expand || 0;
    const drover = gs.activeShip === 'drover' ? 2 : 0;
    const prem   = gs.premium ? (gs.activeShip === 'drover' ? 6 : 8) : 0;
    return 8 + drover + sl * (sl + 1) + prem;
  }
  _whMax() { const gs = this.gs; const sl = gs.skillLevels?.cargo_expand || 0; return 8 + sl * (sl + 1) + (gs.premium ? 8 : 0); }

  _addConsumableToBar(type) {
    const gs = this.gs;
    const bar = gs.actionBar ? [...gs.actionBar] : Array(10).fill(null);
    const barKey = `use:${type}`;
    if (bar.includes(barKey)) return;
    const freeIdx = bar.indexOf(null);
    if (freeIdx < 0) return;
    bar[freeIdx] = barKey;
    gs.actionBar = bar;
    gs._saveState?.();
    this.scene.restart();
  }

  create() {
    this.gs = this.scene.get('GameScene');
    const W = this.scale.width, H = this.scale.height;

    const _bg = this.add.image(W / 2, H / 2, 'bg_garage');
    _bg.setScale(Math.max(W / _bg.width, H / _bg.height)).setAlpha(0.8);

    const atBase = !!this.gs.atBase;
    const pw = atBase ? Math.min(900, W - 40) : Math.min(580, W - 60);
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

  // ── Ammo texture for inventory display ───────────────────────────────────

  _ensureAmmoTex(type) {
    const key = `__amtex_${type}`;
    if (this.textures.exists(key)) return key;
    const info = AMMO_ICON[type];
    const def  = CONSUMABLES[type];
    const icon  = info?.icon || (def?.category === 'consumable' ? '?' : '?');
    const hexC  = info?.color ?? 0x44aacc;
    const r = (hexC >> 16) & 0xff, g = (hexC >> 8) & 0xff, b = hexC & 0xff;
    const c = this.textures.createCanvas(key, 52, 52);
    const ctx = c.getContext();
    ctx.fillStyle = `rgb(${Math.round(r*0.15)},${Math.round(g*0.15)},${Math.round(b*0.15)})`;
    ctx.fillRect(0, 0, 52, 52);
    ctx.strokeStyle = `rgba(${r},${g},${b},0.85)`;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 50, 50);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.font = 'bold 18px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, 26, 26);
    c.refresh();
    return key;
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

      // ── Plasmate stack — special rendering ─────────────────────────────
      if (item.type === 'plasmate') {
        // cargo: exchange strip (at base, 500+) or warehouse strip; warehouse: return strip
        const inCargo    = type === 'cargo';
        const inWarehouse = type === 'warehouse';
        const canExchange = inCargo && item.amount >= PLASMATE_GOLD_RATE;
        const hasStrip = inCargo || inWarehouse;
        const boxH = hasStrip ? BODY_H : SZ;

        const box = this.add.rectangle(sx, sy, SZ, boxH, 0x0a1a2a, 0.95).setOrigin(0, 0)
          .setStrokeStyle(2, 0x44aacc, 0.8);
        const iconK = itemIconKey(item);
        const iconImg = iconK
          ? this.add.image(sx + SZ / 2, sy + boxH / 2 - 6, prerenderTex(this, iconK, 38, 38)).setDisplaySize(38, 38).setOrigin(0.5)
          : null;
        const countTxt = this.add.text(sx + SZ / 2, sy + boxH - 10,
          `${item.amount}/${PLASMATE_PER_SLOT}`, this.F('10px', '#88eeff')).setOrigin(0.5);
        const els = [box, countTxt];
        if (iconImg) els.push(iconImg);

        if (hasStrip) {
          let stripLabel, stripColor, stripBg;
          if (canExchange) {
            stripLabel = '⭐ 500→1'; stripColor = '#ffcc44'; stripBg = 0x072030;
          } else if (inCargo) {
            stripLabel = '→ склад';  stripColor = '#4aa8cc'; stripBg = 0x071828;
          } else {
            stripLabel = '← трюм';  stripColor = '#4a9860'; stripBg = 0x0a1a0a;
          }
          const strip = this.add.rectangle(sx, sy + BODY_H, SZ, STRIP_H, stripBg, 0.95).setOrigin(0, 0)
            .setStrokeStyle(1, 0x2a6888, 0.5).setInteractive({ useHandCursor: true });
          const stripT = this.add.text(sx + SZ / 2, sy + BODY_H + STRIP_H / 2,
            stripLabel, this.F('9px', stripColor)).setOrigin(0.5);
          strip.on('pointerdown', () => {
            if (canExchange) {
              const inv = gs.inventory || [];
              const total = totalPlasmateInInventory(inv);
              const sets  = Math.floor(total / PLASMATE_GOLD_RATE);
              if (sets <= 0) return;
              removePlasmateFromInventory(inv, sets * PLASMATE_GOLD_RATE);
              gs.starGold = (gs.starGold || 0) + sets;
              gs.log(i18n.t('log.plasmate_exchanged', { amount: sets * PLASMATE_GOLD_RATE, gold: sets }));
              gs._saveState?.();
            } else if (inCargo) {
              this._moveToWarehouse(item);
              return; // _moveToWarehouse calls restart
            } else {
              // warehouse → cargo
              const cargoMax = this._cargoMax();
              const inv = gs.inventory || [];
              if (inv.length >= cargoMax) return;
              const idx = (gs.warehouse || []).indexOf(item); if (idx < 0) return;
              gs.warehouse.splice(idx, 1);
              inv.push(item);
            }
            this.scene.restart();
          });
          els.push(strip, stripT);
        }
        container.add(els);
        if (overflow) {
          const dg = this.add.graphics();
          dg.fillStyle(0xffa000, 0.85); dg.fillTriangle(sx, sy, sx + 14, sy, sx, sy + 14);
          container.add(dg);
        }
        continue;
      }

      // ── Consumable / Material stack ───────────────────────────────────────────
      if (CONSUMABLES[item.type]) {
        const def = CONSUMABLES[item.type];
        const isConsumable = def.category === 'consumable';
        const isAmmo       = def.category === 'ammo';

        // Strip specs: { label, color, bg, h, action }
        const strips = [];

        if (type === 'cargo' && isConsumable) {
          // At base: two actions — warehouse, action bar
          const barKey = `use:${item.type}`;
          const inBar = (gs.actionBar || []).includes(barKey);
          strips.push({ label: '→ склад',  color: '#4aa8cc', bg: 0x071828, h: STRIP_H,
            action: () => this._moveToWarehouse(item) });
          strips.push({ label: inBar ? '✓ панель' : '→ панель',
            color: inBar ? '#4a9860' : '#4dd0e1', bg: 0x051520, h: STRIP_H,
            action: () => this._addConsumableToBar(item.type) });
        } else if (type === 'cargo' && !isConsumable) {
          strips.push({ label: '→ склад', color: '#4aa8cc', bg: 0x071828, h: STRIP_H,
            action: () => this._moveToWarehouse(item) });
        } else if (type === 'cargo_nosell' && isConsumable) {
          const barKey = `use:${item.type}`;
          const inBar = (gs.actionBar || []).includes(barKey);
          strips.push({ label: inBar ? '✓ в панели' : '→ панель',
            color: inBar ? '#4a9860' : '#4dd0e1', bg: 0x051520, h: STRIP_H,
            action: () => this._addConsumableToBar(item.type) });
        } else if (type === 'warehouse') {
          strips.push({ label: '← трюм', color: '#4a9860', bg: 0x0a1a0a, h: STRIP_H,
            action: () => {
              const inv = gs.inventory || [];
              const hasStack = inv.some(i => i.type === item.type && i.amount < def.maxPerSlot);
              if (!hasStack && inv.length >= this._cargoMax()) return;
              const idx = (gs.warehouse || []).indexOf(item); if (idx < 0) return;
              gs.warehouse.splice(idx, 1);
              addConsumableToInventory(inv, item.type, item.amount, this._cargoMax());
              this.scene.restart();
            } });
        }

        const stripsTotalH = strips.reduce((s, r) => s + r.h, 0);
        const boxH = SZ - stripsTotalH;
        const iconSz = boxH >= 36 ? 34 : 24;
        const borderColor = isAmmo ? (AMMO_ICON[item.type]?.color ?? 0xffb74d) : isConsumable ? 0x44aacc : 0xccaa44;
        const box = this.add.rectangle(sx, sy, SZ, boxH, 0x0a1a2a, 0.95).setOrigin(0, 0)
          .setStrokeStyle(2, borderColor, 0.8);
        let iconImg = null;
        if (isAmmo) {
          const ammoTex = this._ensureAmmoTex(item.type);
          iconImg = this.add.image(sx + SZ / 2, sy + boxH / 2 - 5, ammoTex).setDisplaySize(iconSz, iconSz).setOrigin(0.5);
        } else {
          const iconK = itemIconKey(item);
          if (iconK) iconImg = this.add.image(sx + SZ / 2, sy + boxH / 2 - 5, prerenderTex(this, iconK, iconSz, iconSz)).setDisplaySize(iconSz, iconSz).setOrigin(0.5);
        }
        const ammoColor = isAmmo ? `#${(AMMO_ICON[item.type]?.color ?? 0xaaccdd).toString(16).padStart(6,'0')}` : isConsumable ? '#88eeff' : '#ffcc88';
        const countTxt = this.add.text(sx + SZ / 2, sy + boxH - 8,
          `${item.amount}/${def.maxPerSlot}`, this.F('9px', ammoColor)).setOrigin(0.5);
        const els = [box, countTxt];
        if (iconImg) els.push(iconImg);

        let stripY = sy + boxH;
        for (const s of strips) {
          const strip = this.add.rectangle(sx, stripY, SZ, s.h, s.bg, 0.95).setOrigin(0, 0)
            .setStrokeStyle(1, 0x2a6888, 0.5).setInteractive({ useHandCursor: true });
          const stripT = this.add.text(sx + SZ / 2, stripY + s.h / 2, s.label,
            this.F('9px', s.color)).setOrigin(0.5);
          strip.on('pointerdown', s.action);
          els.push(strip, stripT);
          stripY += s.h;
        }
        container.add(els);
        continue;
      }

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
        const iconK = itemIconKey(item);
        const iconImg = iconK
          ? this.add.image(sx + SZ / 2, sy + BODY_H / 2, prerenderTex(this, iconK, 48, 48)).setDisplaySize(48, 48).setOrigin(0.5)
          : this.add.text(sx + SZ / 2, sy + BODY_H / 2, `T${item.tier}`, this.O('14px', '#ffe0b2')).setOrigin(0.5);
        container.add([box, strip, stripT, iconImg]);
      } else if (type === 'cargo_nosell') {
        const box = this.add.rectangle(sx, sy, SZ, SZ, 0x0d1e2c, 0.9).setOrigin(0, 0)
          .setStrokeStyle(1, bdrHex, 0.6).setInteractive({ useHandCursor: true });
        box.on('pointerover', (p) => this._showTooltip(p.x, p.y, item));
        box.on('pointerout',  ()  => this._hideTooltip());
        const iconK = itemIconKey(item);
        const iconImg = iconK
          ? this.add.image(sx + SZ / 2, sy + SZ / 2, prerenderTex(this, iconK, 48, 48)).setDisplaySize(48, 48).setOrigin(0.5)
          : this.add.text(sx + SZ / 2, sy + SZ / 2, `T${item.tier}`, this.O('14px', '#ffe0b2')).setOrigin(0.5);
        container.add([box, iconImg]);
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
        const iconK = itemIconKey(item);
        const iconImg = iconK
          ? this.add.image(sx + SZ / 2, sy + BODY_H / 2, prerenderTex(this, iconK, 48, 48)).setDisplaySize(48, 48).setOrigin(0.5)
          : this.add.text(sx + SZ / 2, sy + BODY_H / 2, `T${item.tier}`, this.O('14px', '#b8e4c4')).setOrigin(0.5);
        container.add([box, strip, stripT, iconImg]);
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

  _showSellConfirm(gs, item, slotSx, slotSy, def) {
    this._hideSellConfirm();
    const name  = i18n.t(`item.${item.type}`);
    const total = def.sell * item.amount;
    const OW = 170, OH = 66;
    const ox = Math.max(4, slotSx - Math.floor((OW - SZ) / 2));
    const oy = Math.max(4, slotSy - OH - 6);

    const bg = this.add.rectangle(ox, oy, OW, OH, 0x060c14, 0.98).setOrigin(0, 0)
      .setStrokeStyle(1.5, 0x883830, 0.9).setDepth(200);
    const lbl = this.add.text(ox + OW / 2, oy + 8,
      `Продать: ${name}\n×${item.amount}  →  +${total.toLocaleString()} кр.`,
      { fontFamily: 'Inter, sans-serif', fontSize: '10px', color: '#ffc0a0',
        resolution: UI_RES, align: 'center' }).setOrigin(0.5, 0).setDepth(201);

    const BW = 68, BH = 20, bY = oy + OH - BH - 6;
    const btnYes = this.add.rectangle(ox + 10, bY, BW, BH, 0x0a2010).setOrigin(0, 0)
      .setStrokeStyle(1, 0x3a8040, 0.9).setInteractive({ useHandCursor: true }).setDepth(200);
    const btnYesTxt = this.add.text(ox + 10 + BW / 2, bY + BH / 2, 'Продать',
      { fontFamily: 'Orbitron, sans-serif', fontSize: '9px', color: '#4dc060',
        resolution: UI_RES }).setOrigin(0.5).setDepth(201);

    const btnNo = this.add.rectangle(ox + OW - BW - 10, bY, BW, BH, 0x200808).setOrigin(0, 0)
      .setStrokeStyle(1, 0x884040, 0.9).setInteractive({ useHandCursor: true }).setDepth(200);
    const btnNoTxt = this.add.text(ox + OW - BW / 2 - 10, bY + BH / 2, 'Отмена',
      { fontFamily: 'Orbitron, sans-serif', fontSize: '9px', color: '#c06060',
        resolution: UI_RES }).setOrigin(0.5).setDepth(201);

    this._sellConfirmObjs = [bg, lbl, btnYes, btnYesTxt, btnNo, btnNoTxt];

    btnYes.on('pointerover', () => btnYes.setFillStyle(0x164030));
    btnYes.on('pointerout',  () => btnYes.setFillStyle(0x0a2010));
    btnNo.on('pointerover',  () => btnNo.setFillStyle(0x3a1010));
    btnNo.on('pointerout',   () => btnNo.setFillStyle(0x200808));

    btnYes.on('pointerdown', () => {
      const inv = gs.inventory || [];
      const idx = inv.indexOf(item); if (idx < 0) return;
      inv.splice(idx, 1);
      gs.credits = (gs.credits || 0) + total;
      gs.log?.(`Продано: ${name} ×${item.amount} +${total.toLocaleString()} кр.`);
      gs._saveState?.();
      this.scene.restart();
    });
    btnNo.on('pointerdown', () => this._hideSellConfirm());
  }

  _hideSellConfirm() {
    this._sellConfirmObjs?.forEach(o => o?.destroy());
    this._sellConfirmObjs = null;
  }

  _moveToWarehouse(item, isClanWarehouse = false) {
    if (isClanWarehouse && (item.type === 'plasmate' || CONSUMABLES[item.type])) return;
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
