import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';
import { itemName, itemStats, itemIconKey, itemSellPrice, PLASMATE_PER_SLOT, PLASMATE_GOLD_RATE, removePlasmateFromInventory, totalPlasmateInInventory, CONSUMABLES, AMMO_ICON, addConsumableToInventory } from '../items.js';
import { prerenderTex } from '../utils/prerenderTex.js';
import { PERK_MAP, RARITY_COLOR, RARITY_LABEL, perkBonus } from '../perks.js';

// Трюм (хоткей C). Доступен всегда — в космосе и на базе.
// На базе добавляет колонку СКЛАД и кнопки переноса предметов.
export default class CargoScene extends Phaser.Scene {
  constructor() { super('CargoScene'); }

  O(s, c) { return { fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }
  F(s, c) { return { fontFamily: 'Inter, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }

  _cargoMax() { return this.gs._cargoMax(); }
  _whMax() { const gs = this.gs; const sl = gs.skillLevels?.cargo_expand || 0; return 8 + ([0,3,8,16][sl]||0) + (gs.premium ? 8 : 0); }

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
    const atBase = !!this.gs.atBase;

    if (!this.textures.exists('bg_garage')) this.gs._bgPreloadDeferred?.();

    if (atBase && this.textures.exists('bg_garage')) {
      const _bg = this.add.image(W / 2, H / 2, 'bg_garage');
      _bg.setScale(Math.max(W / _bg.width, H / _bg.height)).setAlpha(0.8);
    } else if (atBase) {
      this.add.rectangle(0, 0, W, H, 0x060d18, 1).setOrigin(0);
    } else {
      this.add.rectangle(0, 0, W, H, 0x000000, 0.35).setOrigin(0);
    }

    const pw = atBase ? Math.min(900, W - 40) : Math.min(520, W - 60);
    const ph = Math.min(640, H - 124);
    const px = (W - pw) / 2;
    const py = Math.min(Math.round((H - ph) / 2), H - ph - 62);

    const panel = this.add.graphics();
    panel.fillStyle(0x080e1a, 0.97); panel.fillRoundedRect(px, py, pw, ph, 12);

    const title = atBase ? 'СКЛАД' : 'ТРЮМ';
    this.add.text(px + 22, py + 16, title, this.O('20px', '#4dd0e1')).setDepth(14);
    this.add.text(px + pw - 20, py + 20, 'I / ESC', this.F('11px', '#445566')).setOrigin(1, 0).setDepth(14);

    const cargoMax = this._cargoMax(), whMax = this._whMax();
    const cargoCount = (this.gs.inventory || []).length;
    const statsLine = atBase
      ? `ТРЮМ ${cargoCount}/${cargoMax}  ·  СКЛАД ${(this.gs.warehouse||[]).length}/${whMax}`
      : `ТРЮМ КОРАБЛЯ  ${cargoCount} / ${cargoMax}`;
    this.add.text(px + 22, py + 46, statsLine, this.F('12px', '#4a6678')).setDepth(14);

    // Panel border above items/cover strips
    const panelBorder = this.add.graphics().setDepth(15);
    panelBorder.lineStyle(2, COLORS.primary, 0.7); panelBorder.strokeRoundedRect(px, py, pw, ph, 12);

    this.panelBox = { px, py, pw, ph };

    if (atBase) {
      const BTN_H = 32;
      const gridH = ph - 90 - BTN_H * 2 - 14;
      // Минимум 290 px = ровно 4 колонки × 68 px + 3 зазора × 6 px
      const colW = Math.max(290, Math.floor((pw - 36) / 2));
      this._renderSlotGrid(px + 12, py + 72, colW, gridH, this.gs.inventory || [], cargoMax, 'cargo');
      this._renderSlotGrid(px + colW + 24, py + 72, colW, gridH, this.gs.warehouse || [], whMax, 'warehouse');
      // Column headers (depth 14 — above cover strips / mask)
      this.add.text(px + 12 + colW / 2, py + 58, 'ТРЮМ КОРАБЛЯ', this.O('12px', '#2a5a70')).setOrigin(0.5, 0).setDepth(14);
      this.add.text(px + colW + 24 + colW / 2, py + 58, `СКЛАД  ${(this.gs.warehouse||[]).length}/${whMax}`,
        this.O('12px', '#2a5a30')).setOrigin(0.5, 0).setDepth(14);
      // Global guild mode checkbox — right of warehouse column, above header
      if (typeof this.gs._whGuildMode !== 'boolean') this.gs._whGuildMode = false;
      const gMode = !!this.gs._whGuildMode;
      const _clan = this.gs.clan;
      const _canGV = !!(_clan && ['Капитан', 'Офицер'].includes(_clan.myRole));
      const _cbW = 96, _cbH = 18;
      const _cbX = px + colW + 24 + colW - _cbW - 4;
      const _cbY = py + 44;
      const _cbBg = this.add.graphics();
      _cbBg.fillStyle(gMode ? 0x0a1f28 : 0x060e14, _canGV ? 0.95 : 0.5);
      _cbBg.fillRoundedRect(_cbX, _cbY, _cbW, _cbH, 3);
      _cbBg.lineStyle(1, gMode ? 0x1e6a80 : (_canGV ? 0x1a3040 : 0x0d1a20), 0.75);
      _cbBg.strokeRoundedRect(_cbX, _cbY, _cbW, _cbH, 3);
      const _cbHit = this.add.rectangle(_cbX + _cbW / 2, _cbY + _cbH / 2, _cbW, _cbH, 0, 0)
        .setInteractive({ useHandCursor: _canGV }).setDepth(15);
      this.add.text(_cbX + _cbW / 2, _cbY + _cbH / 2,
        (gMode ? '[✓]' : '[ ]') + ' склад ги.',
        this.F('10px', !_canGV ? '#1a3040' : gMode ? '#4dd0e1' : '#3a7888')).setOrigin(0.5).setDepth(15);
      if (_canGV) {
        _cbHit.on('pointerdown', () => { this.gs._whGuildMode = !gMode; this.scene.restart(); });
      }
      // Утилитарные кнопки: СОРТИРОВАТЬ + ПРОДАТЬ COMMON
      const utilY = py + 72 + gridH + 4;
      const bGap = 4, bW = Math.floor((pw - 28) / 2);

      const bSort = this.add.rectangle(px + 12, utilY, bW, BTN_H, 0x0d1a2c, 0.95)
        .setOrigin(0, 0).setStrokeStyle(1, 0x1a3a50, 0.7).setInteractive({ useHandCursor: true }).setDepth(15);
      const bSortLbl = this.add.text(px + 12 + bW / 2, utilY + BTN_H / 2, '↕ Сортировать',
        this.F('11px', '#4a8aaa')).setOrigin(0.5).setDepth(15);
      bSort.on('pointerover', () => { bSort.setFillStyle(0x142838); bSortLbl.setColor('#7ab8d4'); });
      bSort.on('pointerout',  () => { bSort.setFillStyle(0x0d1a2c); bSortLbl.setColor('#4a8aaa'); });
      bSort.on('pointerdown', () => {
        this._sortInventory(this.gs.inventory);
        this.gs._saveState?.();
        this.scene.restart();
      });

      const { count: sellCount, total: sellTotal } = this._calcSellCommon(this.gs.inventory || []);
      const sellClr = sellCount > 0 ? '#88bb44' : '#2a3a1a';
      const bSell = this.add.rectangle(px + 12 + bW + bGap, utilY, bW, BTN_H, sellCount > 0 ? 0x0d1a08 : 0x080e08, 0.95)
        .setOrigin(0, 0).setStrokeStyle(1, sellCount > 0 ? 0x2a5018 : 0x141a10, 0.7)
        .setInteractive({ useHandCursor: sellCount > 0 }).setDepth(15);
      const bSellLbl = this.add.text(px + 12 + bW + bGap + bW / 2, utilY + BTN_H / 2,
        sellCount > 0 ? `🗑 Продать common (${sellCount}) → ${sellTotal.toLocaleString()} кр.` : '🗑 Нет common для продажи',
        this.F('10px', sellClr)).setOrigin(0.5).setDepth(15);
      if (sellCount > 0) {
        bSell.on('pointerover', () => { bSell.setFillStyle(0x182a10); bSellLbl.setColor('#aadd66'); });
        bSell.on('pointerout',  () => { bSell.setFillStyle(0x0d1a08); bSellLbl.setColor(sellClr); });
        bSell.on('pointerdown', () => this._showSellCommonConfirm(sellCount, sellTotal));
      }

      // Нижние кнопки навигации: ГАРАЖ + СКЛАД ГИЛЬДИИ
      const btnY = utilY + BTN_H + bGap;

      // Кнопка 1: ГАРАЖ
      const b1x = px + 12;
      const b1Bg = this.add.rectangle(b1x, btnY, bW, BTN_H, 0x0d1e2c, 0.95)
        .setOrigin(0, 0).setStrokeStyle(1, 0x1e3a50, 0.7).setInteractive({ useHandCursor: true }).setDepth(15);
      const b1Lbl = this.add.text(b1x + bW / 2, btnY + BTN_H / 2, 'ГАРАЖ  →  G',
        this.O('12px', '#4dd0e1')).setOrigin(0.5).setDepth(15);
      b1Bg.on('pointerover', () => { b1Bg.setFillStyle(0x142838); b1Lbl.setColor('#7ee8f0'); });
      b1Bg.on('pointerout',  () => { b1Bg.setFillStyle(0x0d1e2c); b1Lbl.setColor('#4dd0e1'); });
      b1Bg.on('pointerdown', () => {
        this.scene.stop();
        if (this.scene.isActive('GarageScene')) this.scene.bringToTop('GarageScene');
        else this.scene.launch('GarageScene');
      });

      // Кнопка 2: СКЛАД ГИЛЬДИИ
      const clan        = this.gs.clan;
      const canGuildVlt = !!(clan && ['Капитан', 'Офицер'].includes(clan.myRole));
      const b2x   = b1x + bW + bGap;
      const b2Clr = canGuildVlt ? '#66bb6a' : '#2a3a2a';
      const b2Bg  = this.add.rectangle(b2x, btnY, bW, BTN_H, canGuildVlt ? 0x0a1a10 : 0x0a0e0a, 0.95)
        .setOrigin(0, 0).setStrokeStyle(1, canGuildVlt ? 0x2a6840 : 0x1a221a, 0.7)
        .setInteractive({ useHandCursor: canGuildVlt }).setDepth(15);
      const b2Lbl = this.add.text(b2x + bW / 2, btnY + BTN_H / 2, 'СКЛАД ГИЛЬДИИ  N',
        this.O('12px', b2Clr)).setOrigin(0.5).setDepth(15);
      if (canGuildVlt) {
        b2Bg.on('pointerover', () => { b2Bg.setFillStyle(0x122018); b2Lbl.setColor('#8add8a'); });
        b2Bg.on('pointerout',  () => { b2Bg.setFillStyle(0x0a1a10); b2Lbl.setColor(b2Clr); });
        b2Bg.on('pointerdown', () => {
          this.gs.clanTab = 'vault';
          this.scene.stop();
          if (this.scene.isActive('ClanScene')) this.scene.bringToTop('ClanScene');
          else this.scene.launch('ClanScene');
        });
      }
    } else {
      // Remote sell mode: premium + не на базе + кулдаун не активен
      const _now = Date.now();
      const _cdUntil = this.gs._remoteSellCooldownUntil ?? 0;
      this._remoteMode = !!(this.gs.premium && _now >= _cdUntil);
      this._remoteSellUsed = false;

      if (this.gs.premium) {
        if (this._remoteMode) {
          this.add.text(px + pw - 14, py + 36, '🛒 удалённая продажа', this.F('10px', '#66bb6a'))
            .setOrigin(1, 0).setDepth(14);
        } else {
          const _secsLeft = Math.max(0, Math.ceil((_cdUntil - _now) / 1000));
          const _cdTxt = this.add.text(px + pw - 14, py + 36,
            `🛒 ${Math.floor(_secsLeft / 60)}:${(_secsLeft % 60).toString().padStart(2, '0')}`,
            this.F('10px', '#e57373')).setOrigin(1, 0).setDepth(14);
          this.time.addEvent({ delay: 1000, repeat: _secsLeft, callback: () => {
            const _rem = Math.max(0, Math.ceil(((this.gs._remoteSellCooldownUntil ?? 0) - Date.now()) / 1000));
            if (_rem <= 0) { _cdTxt.setText('🛒 удалённая продажа'); _cdTxt.setColor('#66bb6a'); return; }
            _cdTxt.setText(`🛒 ${Math.floor(_rem / 60)}:${(_rem % 60).toString().padStart(2, '0')}`);
          }});
        }
      }

      this._renderSlotGrid(px + 12, py + 72, pw - 24, ph - 90, this.gs.inventory || [], cargoMax, 'cargo_nosell', undefined, 6);
    }

    const gs2 = this.gs;
    if (gs2._moveMsg) { this._showMoveMsg(gs2._moveMsg); gs2._moveMsg = null; }

    const _closeScene = () => {
      if (this._remoteSellModalObjs) { this._hideRemoteSellModal(); return; }
      if (this._remoteSellUsed) this.gs._remoteSellCooldownUntil = Date.now() + 120_000;
      this.scene.stop();
    };
    this.input.keyboard.on('keydown-ESC', _closeScene);
  }

  // ── Ammo texture for inventory display ───────────────────────────────────

  _ensureAmmoTex(type) {
    if (this.textures.exists(type)) return type; // PNG loaded in BootScene
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
  _renderSlotGrid(ax, ay, aw, ah, items, maxSlots, type, clipBotH, cols = 4) {
    const gs = this.gs;
    const SZ = 68, GAP = 6, COLS = cols;
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
        } else if (type === 'cargo_nosell' && (isConsumable || isAmmo)) {
          if (isConsumable) {
            const barKey = `use:${item.type}`;
            const inBar = (gs.actionBar || []).includes(barKey);
            strips.push({ label: inBar ? '✓ в панели' : '→ панель',
              color: inBar ? '#4a9860' : '#4dd0e1', bg: 0x051520, h: STRIP_H,
              action: () => this._addConsumableToBar(item.type) });
          }
          strips.push({ label: '× выкинуть', color: '#ef9a9a', bg: 0x1a0808, h: STRIP_H,
            action: () => this._showDropConfirm(item) });
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
          const ammoTex = this.textures.exists(item.type)
            ? prerenderTex(this, item.type, iconSz, iconSz)
            : this._ensureAmmoTex(item.type);
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
        const box = this.add.rectangle(sx, sy, SZ, BODY_H, 0x0d1e2c, 0.9).setOrigin(0, 0)
          .setStrokeStyle(1, bdrHex, 0.6).setInteractive({ useHandCursor: true });
        box.on('pointerover', (p) => this._showTooltip(p.x, p.y, item));
        box.on('pointerout',  ()  => this._hideTooltip());
        const iconK = itemIconKey(item);
        const iconImg = iconK
          ? this.add.image(sx + SZ / 2, sy + BODY_H / 2, prerenderTex(this, iconK, 48, 48)).setDisplaySize(48, 48).setOrigin(0.5)
          : this.add.text(sx + SZ / 2, sy + BODY_H / 2, `T${item.tier}`, this.O('14px', '#ffe0b2')).setOrigin(0.5);
        if (this._remoteMode) {
          const sellPrice = Math.floor(itemSellPrice(item) * 0.9);
          const sellStrip = this.add.rectangle(sx, sy + BODY_H, SZ, STRIP_H, 0x0a1f0a, 0.9).setOrigin(0, 0)
            .setStrokeStyle(1, 0x2a6a2a, 0.6).setInteractive({ useHandCursor: true });
          const sellT = this.add.text(sx + SZ / 2, sy + BODY_H + STRIP_H / 2,
            `💰 ${sellPrice.toLocaleString()}`, this.F('9px', '#81c784')).setOrigin(0.5);
          sellStrip.on('pointerdown', () => { this._hideTooltip(); this._showRemoteSellModal(item); });
          container.add([box, sellStrip, sellT, iconImg]);
        } else {
          const dropStrip = this.add.rectangle(sx, sy + BODY_H, SZ, STRIP_H, 0x1a0808, 0.9).setOrigin(0, 0)
            .setStrokeStyle(1, 0x6a2020, 0.5).setInteractive({ useHandCursor: true });
          const dropT = this.add.text(sx + SZ / 2, sy + BODY_H + STRIP_H / 2, '× выкинуть',
            this.F('9px', '#ef9a9a')).setOrigin(0.5);
          dropStrip.on('pointerdown', () => this._showDropConfirm(item));
          container.add([box, dropStrip, dropT, iconImg]);
        }
      } else {
        // Warehouse module item — body (52px) + single action strip (16px)
        // Action label/destination driven by the global gs._whGuildMode checkbox
        if (typeof gs._whGuildMode !== 'boolean') gs._whGuildMode = false;
        const guildMode = !!gs._whGuildMode;

        const VAULT_MAX_BY_TIER = [10, 15, 20, 25, 30, 40, 50];
        const gClan     = gs.clan;
        const canUseGV  = !!(gClan && ['Капитан', 'Офицер'].includes(gClan.myRole));
        const vaultFull = !gClan || (gClan.vault || []).length >= (VAULT_MAX_BY_TIER[gClan.vaultTier ?? 0] ?? 10);
        // Items upgraded with stars (module or perk) cannot be placed in guild vault
        const goldLocked = (item.starLvl || 0) > 0 || (item.perk?.starLvl || 0) > 0;
        const actActive = guildMode ? (canUseGV && !vaultFull && !goldLocked) : true;

        const box = this.add.rectangle(sx, sy, SZ, BODY_H, 0x0c1a10, 0.9).setOrigin(0, 0)
          .setStrokeStyle(1, bdrHex, pDef ? 0.5 : 0.22).setInteractive({ useHandCursor: true });
        box.on('pointerover', (p) => this._showTooltip(p.x, p.y, item));
        box.on('pointerout',  ()  => this._hideTooltip());

        let actLbl, actClr, actBg, actBdr;
        if (!guildMode) {
          actLbl = '← в трюм';    actClr = '#4a9860'; actBg = 0x0a1a0a; actBdr = 0x2a6840;
        } else if (goldLocked) {
          actLbl = '× ⭐ заблок.'; actClr = '#5a4a20'; actBg = 0x0c0e08; actBdr = 0x2a2010;
        } else {
          actLbl = '→ скл ги';
          actClr = actActive ? '#4dd0e1' : '#2a4050';
          actBg = 0x081822; actBdr = 0x1a4a6a;
        }
        const strip = this.add.rectangle(sx, sy + BODY_H, SZ, STRIP_H, actBg, 0.9).setOrigin(0, 0)
          .setStrokeStyle(1, actBdr, 0.4)
          .setInteractive({ useHandCursor: actActive && !goldLocked });
        const stripT = this.add.text(sx + SZ / 2, sy + BODY_H + STRIP_H / 2, actLbl,
          this.F('9px', actClr)).setOrigin(0.5);
        strip.on('pointerdown', () => {
          if (!actActive) return;
          if (guildMode) {
            this._moveToGuildVault(item);
          } else {
            const cargoMax = this._cargoMax();
            const inv = gs.inventory || [];
            if (inv.length >= cargoMax) return;
            const idx = (gs.warehouse || []).indexOf(item); if (idx < 0) return;
            gs.warehouse.splice(idx, 1); inv.push(item);
            gs._saveState?.();
            this.scene.restart();
          }
        });

        const iconK = itemIconKey(item);
        const iconImg = iconK
          ? this.add.image(sx + SZ / 2, sy + BODY_H / 2, prerenderTex(this, iconK, 48, 48)).setDisplaySize(48, 48).setOrigin(0.5)
          : this.add.text(sx + SZ / 2, sy + BODY_H / 2, `T${item.tier}`, this.O('12px', '#b8e4c4')).setOrigin(0.5);
        container.add([box, strip, stripT, iconImg]);
      }

      if (rarHex) {
        const dg = this.add.graphics();
        dg.setPosition(sx, sy); // y must reflect row for visibility grouping
        dg.fillStyle(rarHex, 1); dg.fillCircle(SZ - 6, 6, 4);
        container.add(dg);
      }
      if (overflow) {
        const dg = this.add.graphics();
        dg.setPosition(sx, sy);
        dg.fillStyle(0xffa000, 0.85); dg.fillTriangle(0, 0, 14, 0, 0, 14);
        container.add(dg);
      }
    }

    // ── Row-visibility (virtual scroll): hide rows outside [ay, ay+ah] ────────
    // Group container children by row via their local y inside the container.
    // All item parts for row R have y in [R*(SZ+GAP), R*(SZ+GAP)+SZ-1], so
    // Math.floor(obj.y / (SZ+GAP)) == R reliably (Graphics are repositioned above).
    const pbox = this.panelBox;
    const totalH = Math.ceil(displaySlots / COLS) * (SZ + GAP);

    const rowObjs = {}; // row → [GameObject]
    container.list.forEach(obj => {
      const r = Math.max(0, Math.floor(obj.y / (SZ + GAP)));
      (rowObjs[r] = rowObjs[r] || []).push(obj);
    });

    const updateVisibility = (cY) => {
      Object.entries(rowObjs).forEach(([rStr, objs]) => {
        const r = +rStr;
        const wY = cY + r * (SZ + GAP); // world-y of row top
        const vis = wY < ay + ah && wY + SZ > ay;
        objs.forEach(o => { o.setVisible(vis); if (o.input) o.input.enabled = vis; });
      });
    };
    updateVisibility(ay); // initial pass — container starts at ay

    // ── Inner panel covers: hide partial rows at grid edges (depth 12) ────────
    if (pbox) {
      const bg = 0x080e1a;
      if (ay > pbox.py)
        this.add.rectangle(pbox.px, pbox.py, pbox.pw, ay - pbox.py, bg).setOrigin(0, 0).setDepth(12);
      const botH = pbox.py + pbox.ph - ay - ah;
      if (botH > 0)
        this.add.rectangle(pbox.px, ay + ah, pbox.pw, botH, bg).setOrigin(0, 0).setDepth(12);
      const rW = pbox.px + pbox.pw - ax - aw;
      if (rW > 0 && rW <= 20)
        this.add.rectangle(ax + aw, ay, rW, ah, bg).setOrigin(0, 0).setDepth(12);
    }

    // ── Wheel scroll + scrollbar ───────────────────────────────────────────
    // totalH already computed above
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
        updateVisibility(container.y);
      });
    }
  }

  _showTooltip(wx, wy, item) {
    this._hideTooltip();
    if (!item) return;
    const W = this.scale.width, H = this.scale.height;
    const pDef = item.perk ? PERK_MAP[item.perk.key] : null;
    const rarColor = pDef ? `#${RARITY_COLOR[pDef.rarity].toString(16).padStart(6, '0')}` : null;
    const TW = 240, GAP = 5;

    const lineDefs = [
      { text: itemName(item),  sty: this.O('13px', '#ffe0b2') },
      { text: itemStats(item), sty: this.F('11px', '#9fb3b8') },
    ];
    if (pDef) {
      const rarLabel = RARITY_LABEL[pDef.rarity] ?? pDef.rarity.toUpperCase();
      lineDefs.push({ text: rarLabel,                         sty: this.F('10px', rarColor) });
      lineDefs.push({ text: `✦ ${pDef.name}`,                sty: this.F('11px', rarColor) });
      lineDefs.push({ text: pDef.desc(perkBonus(item.perk)), sty: this.F('11px', '#aaccdd') });
    }

    // Первый проход — создаём тексты вне экрана, чтобы замерить реальную высоту с word-wrap
    const textObjs = lineDefs
      .filter(l => l.text)
      .map(l => this.add.text(-9999, -9999, l.text,
        { ...l.sty, wordWrap: { width: TW - 20 } }).setDepth(201));

    const TH = 10 + textObjs.reduce((s, t) => s + t.height + GAP, 0);
    let tx = wx + 16, ty = wy - TH / 2;
    if (tx + TW > W - 8) tx = wx - TW - 8;
    if (ty < 4) ty = 4;
    if (ty + TH > H - 4) ty = H - TH - 4;

    const g = this.add.graphics().setDepth(200);
    g.fillStyle(0x08121e, 0.97); g.fillRoundedRect(tx, ty, TW, TH, 6);
    g.lineStyle(1, 0x1e3a50, 0.9); g.strokeRoundedRect(tx, ty, TW, TH, 6);

    // Второй проход — расставляем тексты по финальным координатам
    let ly = ty + 8;
    textObjs.forEach(t => { t.setPosition(tx + 10, ly); ly += t.height + GAP; });

    this._tooltipObjs = [g, ...textObjs];
  }

  _hideTooltip() {
    if (!this._tooltipObjs) return;
    this._tooltipObjs.forEach(o => o?.destroy());
    this._tooltipObjs = null;
  }

  _showDropConfirm(item) {
    if (this._dropModal) this._closeDropModal();
    const W = this.scale.width, H = this.scale.height;
    const mw = 320, mh = 150;
    const mx = (W - mw) / 2, my = (H - mh) / 2;
    const objs = [];

    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.65).setOrigin(0).setDepth(60).setInteractive();
    dim.on('pointerdown', () => this._closeDropModal());
    objs.push(dim);

    const panel = this.add.graphics().setDepth(61);
    panel.fillStyle(0x0a0f1a, 0.98); panel.fillRoundedRect(mx, my, mw, mh, 10);
    panel.lineStyle(2, 0xef5350, 0.85); panel.strokeRoundedRect(mx, my, mw, mh, 10);
    objs.push(panel);

    objs.push(this.add.text(W / 2, my + 22, 'ВЫБРОСИТЬ ПРЕДМЕТ?', this.O('13px', '#ef9a9a')).setOrigin(0.5).setDepth(62));
    objs.push(this.add.text(W / 2, my + 52, itemName(item), this.F('12px', '#b0bec5')).setOrigin(0.5).setDepth(62));
    objs.push(this.add.text(W / 2, my + 70, 'Предмет появится рядом с кораблём', this.F('10px', '#445566')).setOrigin(0.5).setDepth(62));

    const btnY = my + mh - 42;
    const cancelBtn = this.add.rectangle(W / 2 - 75, btnY, 120, 30, 0x0d1e2c, 1)
      .setStrokeStyle(1, 0x2a6888, 0.8).setDepth(61).setInteractive({ useHandCursor: true });
    cancelBtn.on('pointerover', () => cancelBtn.setFillStyle(0x162838));
    cancelBtn.on('pointerout',  () => cancelBtn.setFillStyle(0x0d1e2c));
    cancelBtn.on('pointerdown', () => this._closeDropModal());
    objs.push(cancelBtn);
    objs.push(this.add.text(W / 2 - 75, btnY, 'ОТМЕНА', this.O('11px', '#4dd0e1')).setOrigin(0.5).setDepth(62));

    const dropBtn = this.add.rectangle(W / 2 + 75, btnY, 120, 30, 0x1a0808, 1)
      .setStrokeStyle(1, 0xef5350, 0.8).setDepth(61).setInteractive({ useHandCursor: true });
    dropBtn.on('pointerover', () => dropBtn.setFillStyle(0x2e1010));
    dropBtn.on('pointerout',  () => dropBtn.setFillStyle(0x1a0808));
    dropBtn.on('pointerdown', () => { this._closeDropModal(); this._dropItem(item); });
    objs.push(dropBtn);
    objs.push(this.add.text(W / 2 + 75, btnY, 'ВЫБРОСИТЬ', this.O('11px', '#ef9a9a')).setOrigin(0.5).setDepth(62));

    this._dropModal = objs;
  }

  _closeDropModal() {
    this._dropModal?.forEach(o => o?.destroy());
    this._dropModal = null;
  }

  _dropItem(item) {
    const gs = this.gs;
    const inv = gs.inventory || [];
    const idx = inv.indexOf(item);
    if (idx < 0) return;
    inv.splice(idx, 1);
    gs.dropItemAtPlayer?.(item);
    gs._saveState?.();
    this.scene.restart();
  }

  // ── Sell common + Sort ───────────────────────────────────────────────────

  _isSellableCommon(item) {
    const MODULE_TYPES = new Set(['cannon', 'laser', 'shield', 'engine', 'armor']);
    if (!MODULE_TYPES.has(item.type)) return false;
    if ((item.tier || 1) >= 4) return false;
    if (item.perk?.rarity === 'jackpot') return false;
    return true;
  }

  _calcSellCommon(inv) {
    let count = 0, total = 0;
    for (const item of inv) {
      if (!this._isSellableCommon(item)) continue;
      count++;
      total += itemSellPrice(item);
    }
    return { count, total };
  }

  _showSellCommonConfirm(count, total) {
    const W = this.scale.width, H = this.scale.height;
    const OW = 320, OH = 110, ox = (W - OW) / 2, oy = (H - OH) / 2;
    const objs = [];
    const bg = this.add.rectangle(ox, oy, OW, OH, 0x060c14, 0.98)
      .setOrigin(0, 0).setStrokeStyle(1, 0x88bb44, 0.7).setDepth(70);
    objs.push(bg);
    objs.push(this.add.text(ox + OW / 2, oy + 18, '🗑 Продать common-модули?', this.O('13px', '#88bb44')).setOrigin(0.5).setDepth(71));
    objs.push(this.add.text(ox + OW / 2, oy + 42, `${count} предмет(ов)  →  +${total.toLocaleString()} кр.`, this.F('12px', '#ccddaa')).setOrigin(0.5).setDepth(71));
    objs.push(this.add.text(ox + OW / 2, oy + 58, 'T4, jackpot-перки и расходники не затронуты', this.F('10px', '#4a6a3a')).setOrigin(0.5).setDepth(71));

    const btnY = oy + OH - 20;
    const noBtn = this.add.rectangle(ox + OW / 2 - 65, btnY, 100, 26, 0x0d1e2c, 1)
      .setStrokeStyle(1, 0x2a4a60, 0.8).setDepth(71).setInteractive({ useHandCursor: true });
    noBtn.on('pointerdown', () => objs.forEach(o => o?.destroy()));
    objs.push(noBtn);
    objs.push(this.add.text(ox + OW / 2 - 65, btnY, 'ОТМЕНА', this.O('11px', '#4dd0e1')).setOrigin(0.5).setDepth(72));

    const yesBtn = this.add.rectangle(ox + OW / 2 + 65, btnY, 100, 26, 0x0d1a08, 1)
      .setStrokeStyle(1, 0x4a8822, 0.8).setDepth(71).setInteractive({ useHandCursor: true });
    yesBtn.on('pointerdown', () => {
      const gs = this.gs;
      const inv = gs.inventory || [];
      let earned = 0;
      for (let i = inv.length - 1; i >= 0; i--) {
        if (!this._isSellableCommon(inv[i])) continue;
        earned += itemSellPrice(inv[i]);
        inv.splice(i, 1);
      }
      gs.credits = (gs.credits || 0) + earned;
      gs.log?.(`Продано: ${count} модулей на ${earned.toLocaleString()} кр.`);
      gs._saveState?.();
      this.scene.restart();
    });
    objs.push(yesBtn);
    objs.push(this.add.text(ox + OW / 2 + 65, btnY, 'ПРОДАТЬ', this.O('11px', '#88bb44')).setOrigin(0.5).setDepth(72));
  }

  _sortInventory(inv) {
    const ORDER = { cannon: 0, laser: 1, shield: 2, armor: 3, engine: 4,
      repair_pack: 5, speed_boost: 5, scanner_pulse: 5, emergency_warp: 5,
      damage_booster: 5, hull_booster: 5, shield_booster: 5, xp_booster: 5,
      ammo_plasma: 6, ammo_plasma_elite: 6,
      biomech_core: 7, quantum_crystal: 7, plasma_coil: 7 };
    inv.sort((a, b) => {
      const ao = ORDER[a.type] ?? 8, bo = ORDER[b.type] ?? 8;
      if (ao !== bo) return ao - bo;
      return (b.tier || 0) - (a.tier || 0);
    });
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

  _showRemoteSellModal(item) {
    this._hideRemoteSellModal();
    const W = this.scale.width, H = this.scale.height;
    const gs = this.gs;
    const pDef    = item.perk ? PERK_MAP[item.perk.key] : null;
    const name    = itemName(item);
    const stats   = itemStats(item);
    const basePrice = itemSellPrice(item);
    const net     = Math.floor(basePrice * 0.9);
    const penalty = basePrice - net;

    const MW = 322, MH = pDef ? 274 : 242;
    const mx = Math.round((W - MW) / 2);
    const my = Math.round((H - MH) / 2);
    const objs = [];
    const t = (x, y, s, style) => { const o = this.add.text(x, y, s, { resolution: UI_RES, ...style }).setDepth(202); objs.push(o); return o; };

    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.5).setOrigin(0).setDepth(200).setInteractive();
    dim.on('pointerdown', () => this._hideRemoteSellModal());
    objs.push(dim);

    const panel = this.add.graphics().setDepth(201);
    panel.fillStyle(0x060c18, 0.98); panel.fillRoundedRect(mx, my, MW, MH, 10);
    panel.lineStyle(1.5, 0x2a6040, 0.9); panel.strokeRoundedRect(mx, my, MW, MH, 10);
    objs.push(panel);

    // Иконка
    const iconK = itemIconKey(item);
    if (iconK) objs.push(this.add.image(mx + 36, my + 36, prerenderTex(this, iconK, 48, 48)).setDisplaySize(48, 48).setOrigin(0.5).setDepth(202));

    // Название + тир
    t(mx + 68, my + 16, name, { fontFamily: 'Orbitron, sans-serif', fontSize: '14px', color: '#e0e8ff', wordWrap: { width: MW - 80 } });
    t(mx + 68, my + 38, `Класс T${item.tier ?? '?'}`, { fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#7a9ab8' });

    // Статы
    if (stats) t(mx + 12, my + 52, stats, { fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#7a9ab8', wordWrap: { width: MW - 24 } });

    let nextY = my + 106;

    // Перк: плашка редкости + название + показатель
    if (pDef) {
      const rarHex   = RARITY_COLOR[pDef.rarity];
      const rarColor = `#${(rarHex & 0xffffff).toString(16).padStart(6, '0')}`;
      const rarLabel = RARITY_LABEL[pDef.rarity] ?? pDef.rarity.toUpperCase();
      // Плашка редкости
      const labelBg = this.add.rectangle(mx + 12, nextY, 0, 18, rarHex, 0.18).setOrigin(0, 0).setDepth(201);
      const labelTxt = this.add.text(mx + 16, nextY + 2, rarLabel,
        { fontFamily: 'Orbitron, sans-serif', fontSize: '9px', color: rarColor, resolution: UI_RES }).setDepth(202);
      labelBg.width = labelTxt.width + 8;
      objs.push(labelBg, labelTxt);
      nextY += 22;
      // Название + показатели перка
      t(mx + 12, nextY, `✦ ${pDef.name}`,
        { fontFamily: 'Inter, sans-serif', fontSize: '13px', color: rarColor, wordWrap: { width: MW - 24 } });
      nextY += 20;
      t(mx + 12, nextY, pDef.desc(perkBonus(item.perk)),
        { fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#c5cce8', wordWrap: { width: MW - 24 } });
      nextY += 22;
    }

    // Разделитель
    const div = this.add.graphics().setDepth(201);
    div.lineStyle(1, 0x1a3a28, 0.8);
    div.beginPath(); div.moveTo(mx + 12, nextY); div.lineTo(mx + MW - 12, nextY); div.strokePath();
    objs.push(div);
    nextY += 12;

    // Цена
    t(mx + 12, nextY,      `Выручка:   +${net.toLocaleString()} кр.`,                      { fontFamily: 'Inter, sans-serif', fontSize: '14px', color: '#81c784' });
    t(mx + 12, nextY + 22, `Комиссия:  −${penalty.toLocaleString()} кр.  (−10% вне базы)`, { fontFamily: 'Inter, sans-serif', fontSize: '11px', color: '#e57373' });

    // Кнопки
    const BW = 124, BH = 30, btnY = my + MH - BH - 12;
    const btnSell = this.add.rectangle(mx + 12, btnY, BW, BH, 0x0a2010).setOrigin(0, 0)
      .setStrokeStyle(1, 0x3a8040, 0.9).setInteractive({ useHandCursor: true }).setDepth(201);
    const btnSellT = this.add.text(mx + 12 + BW / 2, btnY + BH / 2, 'ПРОДАТЬ',
      { fontFamily: 'Orbitron, sans-serif', fontSize: '12px', color: '#4dc060', resolution: UI_RES }).setOrigin(0.5).setDepth(202);
    const btnCancel = this.add.rectangle(mx + MW - BW - 12, btnY, BW, BH, 0x200808).setOrigin(0, 0)
      .setStrokeStyle(1, 0x884040, 0.9).setInteractive({ useHandCursor: true }).setDepth(201);
    const btnCancelT = this.add.text(mx + MW - BW / 2 - 12, btnY + BH / 2, 'ОТМЕНА',
      { fontFamily: 'Orbitron, sans-serif', fontSize: '12px', color: '#c06060', resolution: UI_RES }).setOrigin(0.5).setDepth(202);
    objs.push(btnSell, btnSellT, btnCancel, btnCancelT);

    btnSell.on('pointerover', () => btnSell.setFillStyle(0x164030));
    btnSell.on('pointerout',  () => btnSell.setFillStyle(0x0a2010));
    btnCancel.on('pointerover', () => btnCancel.setFillStyle(0x3a1010));
    btnCancel.on('pointerout',  () => btnCancel.setFillStyle(0x200808));

    btnSell.on('pointerdown', () => {
      const inv = gs.inventory || [];
      const idx = inv.indexOf(item); if (idx < 0) return;
      inv.splice(idx, 1);
      gs.credits = (gs.credits || 0) + net;
      gs.log?.(`🛒 ${name} → +${net.toLocaleString()} кр. (−10% комиссия)`);
      gs._saveState?.();
      this._remoteSellUsed = true;
      this.scene.restart();
    });
    btnCancel.on('pointerdown', () => this._hideRemoteSellModal());

    this._remoteSellModalObjs = objs;
  }

  _hideRemoteSellModal() {
    this._remoteSellModalObjs?.forEach(o => o?.destroy());
    this._remoteSellModalObjs = null;
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
    this.gs._saveState?.();
    this.scene.restart();
  }

  _moveToGuildVault(item) {
    const gs   = this.gs;
    const clan = gs.clan;
    if (!clan) return;
    if ((item.starLvl || 0) > 0 || (item.perk?.starLvl || 0) > 0) return;
    const VAULT_MAX_BY_TIER = [10, 15, 20, 25, 30, 40, 50];
    const vaultMax = VAULT_MAX_BY_TIER[clan.vaultTier ?? 0] ?? 10;
    const vault = clan.vault = clan.vault || [];
    if (vault.length >= vaultMax) return;
    const wh  = gs.warehouse || [];
    const idx = wh.indexOf(item);
    if (idx < 0) return;
    wh.splice(idx, 1);
    vault.push(item);
    const d = new Date();
    const ts = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}  ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    (clan.log = clan.log || []).unshift({ time: ts,
      text: `${gs.playerName || 'Пилот'} положил «${itemName(item)}» на склад гильдии`,
      color: '#4dd0e1' });
    gs._saveState?.();
    gs._moveMsg = `→ Склад гильдии: ${itemName(item)}`;
    this.scene.restart();
  }

  _showMoveMsg(text) {
    const W = this.scale.width, H = this.scale.height;
    const t = this.add.text(W / 2, H - 110, text,
      { fontFamily: 'Orbitron, sans-serif', fontSize: '13px', color: '#66bb6a', resolution: UI_RES })
      .setOrigin(0.5).setDepth(300).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 150,
      onComplete: () => this.tweens.add({ targets: t, alpha: 0, y: H - 140,
        duration: 600, delay: 900, onComplete: () => t.destroy() }) });
  }
}
