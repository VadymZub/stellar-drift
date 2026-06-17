import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';
import { CONSUMABLES, addConsumableToInventory, countConsumableInInventory } from '../items.js';
import { prerenderTex } from '../utils/prerenderTex.js';

// Количество расходников за 1 золотой
const GOLD_PACK = 10;

export default class ShopScene extends Phaser.Scene {
  constructor() { super('ShopScene'); }

  O(s, c) { return { fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }
  F(s, c) { return { fontFamily: 'Inter, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }

  create() {
    const W = this.scale.width, H = this.scale.height;
    const gs = this.scene.get('GameScene');

    const _bg = this.add.image(W / 2, H / 2, 'bg_shop');
    _bg.setScale(Math.max(W / _bg.width, H / _bg.height)).setAlpha(0.8);

    const pw = Math.min(1140, W - 24), ph = Math.min(700, H - 24);
    const px = (W - pw) / 2, py = (H - ph) / 2;

    const g = this.add.graphics();
    g.fillStyle(0x080e1c, 0.97); g.fillRoundedRect(px, py, pw, ph, 14);
    g.lineStyle(2, COLORS.amber, 0.9); g.strokeRoundedRect(px, py, pw, ph, 14);

    this.add.text(px + 34, py + 22, 'СТАНЦИОННЫЙ МАГАЗИН', this.O('22px', '#ffb74d'));
    this.add.text(px + pw - 30, py + 28, 'ESC', this.F('13px', '#445566')).setOrigin(1, 0);

    // Live balance display
    const credTxt = this.add.text(px + pw / 2 - 60, py + 26, '', this.O('14px', '#ffd54f')).setOrigin(0, 0);
    const goldTxt = this.add.text(px + pw / 2 + 60, py + 26, '', this.O('14px', '#ffd54f')).setOrigin(0, 0);
    const refresh = () => {
      credTxt.setText(`💰 ${(gs.credits || 0).toLocaleString()} кр.`);
      goldTxt.setText(`⭐ ${gs.starGold || 0}`);
    };
    refresh();

    // Section: consumables (4 items in row)
    this.add.text(px + 34, py + 68, 'РАСХОДНИКИ', this.O('14px', '#4dd0e1'));

    const buyable = Object.entries(CONSUMABLES)
      .filter(([, def]) => def.canBuy)
      .map(([type, def]) => ({ type, ...def }));

    // Layout: max 4 per row (3 ammo slots reserved in next row)
    const COLS = 4, CARD_W = 220, CARD_H = 290, CARD_GAP = 20;
    const gridW = COLS * CARD_W + (COLS - 1) * CARD_GAP;
    const gridX = px + (pw - gridW) / 2;
    const row1Y  = py + 92;

    buyable.forEach((item, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cx = gridX + col * (CARD_W + CARD_GAP);
      const cy = row1Y + row * (CARD_H + 24);
      this._drawCard(cx, cy, CARD_W, CARD_H, item, gs, refresh);
    });

    // Placeholder row for future ammo (3 slots)
    const ammoY = row1Y + CARD_H + 24;
    this.add.text(px + 34, ammoY, 'БОЕПРИПАСЫ', this.O('14px', '#ffb74d'));
    const AMMO_W = 220, AMMO_H = 290, AMMO_GAP = 20;
    const ammoGridW = 3 * AMMO_W + 2 * AMMO_GAP;
    const ammoX = px + (pw - ammoGridW) / 2;
    for (let i = 0; i < 3; i++) {
      const cx = ammoX + i * (AMMO_W + AMMO_GAP);
      this._drawPlaceholder(cx, ammoY + 24, AMMO_W, AMMO_H);
    }

    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());
  }

  _drawCard(cx, cy, cw, ch, item, gs, refresh) {
    const g = this.add.graphics();
    g.fillStyle(0x0c1a2e, 0.97); g.fillRoundedRect(cx, cy, cw, ch, 10);
    g.lineStyle(2, 0x2a6888, 0.8); g.strokeRoundedRect(cx, cy, cw, ch, 10);

    // Icon (big)
    const iconKey = `consumable_${item.type}`;
    if (this.textures.exists(iconKey)) {
      this.add.image(cx + cw / 2, cy + 62, prerenderTex(this, iconKey, 96, 96)).setDisplaySize(96, 96).setOrigin(0.5);
    }

    // Name
    this.add.text(cx + cw / 2, cy + 118, i18n.t(`item.${item.type}`),
      { ...this.O('13px', '#e0f0ff'), wordWrap: { width: cw - 24 }, align: 'center' }).setOrigin(0.5, 0);

    // In cargo
    const have = countConsumableInInventory(gs.inventory || [], item.type);
    const haveTxt = this.add.text(cx + cw / 2, cy + 142, `в трюме: ${have}`,
      this.F('11px', '#4a7a90')).setOrigin(0.5, 0);

    // Sell price hint
    this.add.text(cx + cw / 2, cy + 160, `продажа: ${item.sell} кр./шт.`,
      this.F('11px', '#4a6040')).setOrigin(0.5, 0);

    // ── Credit buy button (×1) ──────────────────────────────────
    const btn1H = 34, btn1Y = cy + ch - 78;
    const btn1 = this.add.rectangle(cx + cw / 2, btn1Y + btn1H / 2, cw - 28, btn1H, 0x0d3a58)
      .setStrokeStyle(1.5, 0x4dd0e1, 0.85).setInteractive({ useHandCursor: true });
    const btn1Txt = this.add.text(cx + cw / 2, btn1Y + btn1H / 2,
      `КУПИТЬ ×1  —  ${item.price.toLocaleString()} кр.`, this.O('10px', '#4dd0e1')).setOrigin(0.5);

    btn1.on('pointerover', () => btn1.setFillStyle(0x1a5a80));
    btn1.on('pointerout',  () => btn1.setFillStyle(0x0d3a58));
    btn1.on('pointerdown', () => {
      if ((gs.credits || 0) < item.price) {
        btn1.setFillStyle(0x5a1010);
        this.time.delayedCall(300, () => btn1.setFillStyle(0x0d3a58));
        return;
      }
      const inv = gs.inventory || [];
      const cargoMax = this._cargoMax(gs);
      const hasStack = inv.some(i => i.type === item.type && i.amount < item.maxPerSlot);
      if (!hasStack && inv.length >= cargoMax) {
        btn1Txt.setText('ТРЮМ ПОЛОН');
        this.time.delayedCall(1400, () => btn1Txt.setText(`КУПИТЬ ×1  —  ${item.price.toLocaleString()} кр.`));
        return;
      }
      gs.credits -= item.price;
      addConsumableToInventory(inv, item.type, 1, cargoMax);
      haveTxt.setText(`в трюме: ${countConsumableInInventory(inv, item.type)}`);
      gs._saveState?.();
      gs.log?.(`Куплено: ${i18n.t(`item.${item.type}`)} −${item.price} кр.`);
      refresh();
    });

    // ── Gold buy button (×10 = 1⭐) ─────────────────────────────
    const btn2H = 34, btn2Y = cy + ch - 36;
    const btn2 = this.add.rectangle(cx + cw / 2, btn2Y + btn2H / 2, cw - 28, btn2H, 0x2a1a00)
      .setStrokeStyle(1.5, 0xffb74d, 0.85).setInteractive({ useHandCursor: true });
    const btn2Txt = this.add.text(cx + cw / 2, btn2Y + btn2H / 2,
      `КУПИТЬ ×${GOLD_PACK}  —  1 ⭐`, this.O('10px', '#ffb74d')).setOrigin(0.5);

    btn2.on('pointerover', () => btn2.setFillStyle(0x4a2a00));
    btn2.on('pointerout',  () => btn2.setFillStyle(0x2a1a00));
    btn2.on('pointerdown', () => {
      if ((gs.starGold || 0) < 1) {
        btn2.setFillStyle(0x5a1010);
        this.time.delayedCall(300, () => btn2.setFillStyle(0x2a1a00));
        return;
      }
      const inv = gs.inventory || [];
      const cargoMax = this._cargoMax(gs);
      const space = this._freeConsumableSpace(inv, item.type, item.maxPerSlot, cargoMax);
      if (space <= 0) {
        btn2Txt.setText('ТРЮМ ПОЛОН');
        this.time.delayedCall(1400, () => btn2Txt.setText(`КУПИТЬ ×${GOLD_PACK}  —  1 ⭐`));
        return;
      }
      gs.starGold -= 1;
      addConsumableToInventory(inv, item.type, GOLD_PACK, cargoMax);
      haveTxt.setText(`в трюме: ${countConsumableInInventory(inv, item.type)}`);
      gs._saveState?.();
      gs.log?.(`Куплено: ${i18n.t(`item.${item.type}`)} ×${GOLD_PACK} −1 ⭐`);
      refresh();
    });
  }

  _drawPlaceholder(cx, cy, cw, ch) {
    const g = this.add.graphics();
    g.fillStyle(0x080e18, 0.6); g.fillRoundedRect(cx, cy, cw, ch, 10);
    g.lineStyle(1.5, 0x1e3040, 0.5); g.strokeRoundedRect(cx, cy, cw, ch, 10);
    this.add.text(cx + cw / 2, cy + ch / 2, 'СКОРО',
      { ...this.O('13px', '#1e3040'), align: 'center' }).setOrigin(0.5);
  }

  _freeConsumableSpace(inv, type, maxPerSlot, cargoMax) {
    let space = 0;
    for (const i of inv) {
      if (i.type === type && i.amount < maxPerSlot) space += maxPerSlot - i.amount;
    }
    const freeSlots = Math.max(0, cargoMax - inv.length);
    space += freeSlots * maxPerSlot;
    return space;
  }

  _cargoMax(gs) {
    const sl = gs.skillLevels?.cargo_expand || 0;
    const drover = gs.activeShip === 'drover' ? 2 : 0;
    const prem   = gs.premium ? (gs.activeShip === 'drover' ? 6 : 8) : 0;
    return 8 + drover + sl * (sl + 1) + prem;
  }
}
