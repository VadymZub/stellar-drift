import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';
import { CONSUMABLES, addConsumableToInventory, countConsumableInInventory } from '../items.js';
import { prerenderTex } from '../utils/prerenderTex.js';

export default class ShopScene extends Phaser.Scene {
  constructor() { super('ShopScene'); }

  O(s, c) { return { fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }
  F(s, c) { return { fontFamily: 'Inter, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }

  create() {
    const W = this.scale.width, H = this.scale.height;
    const gs = this.scene.get('GameScene');

    const _bg = this.add.image(W / 2, H / 2, 'bg_shop');
    _bg.setScale(Math.max(W / _bg.width, H / _bg.height)).setAlpha(0.8);

    const pw = Math.min(940, W - 40), ph = Math.min(640, H - 40);
    const px = (W - pw) / 2, py = (H - ph) / 2;

    const g = this.add.graphics();
    g.fillStyle(0x0b1622, 0.95); g.fillRoundedRect(px, py, pw, ph, 12);
    g.lineStyle(2, COLORS.amber, 0.8); g.strokeRoundedRect(px, py, pw, ph, 12);

    this.add.text(px + 30, py + 20, i18n.t('menu.shop') || 'СТАНЦИОННЫЙ МАГАЗИН',
      this.O('24px', '#ffb74d'));

    this.add.text(px + pw - 30, py + 25, 'ESC TO EXIT',
      this.F('12px', '#7e9398')).setOrigin(1, 0);

    // Live credits display
    const credTxt = this.add.text(px + pw / 2, py + 22, `💰 ${gs.credits || 0}`,
      this.O('14px', '#ffd54f')).setOrigin(0.5, 0);

    // Section: consumables
    this.add.text(px + 30, py + 68, 'РАСХОДНИКИ', this.O('13px', '#4dd0e1'));

    const buyable = Object.entries(CONSUMABLES)
      .filter(([, def]) => def.canBuy)
      .map(([type, def]) => ({ type, ...def }));

    const CARD_W = 170, CARD_H = 210, CARD_GAP = 18;
    const totalW = buyable.length * CARD_W + (buyable.length - 1) * CARD_GAP;
    let cx = px + (pw - totalW) / 2;
    const cy = py + 90;

    buyable.forEach(item => {
      this._drawCard(cx, cy, CARD_W, CARD_H, item, gs, credTxt);
      cx += CARD_W + CARD_GAP;
    });

    // Section label: materials (info only)
    const matY = cy + CARD_H + 28;
    this.add.text(px + 30, matY, 'КРАФТОВЫЕ МАТЕРИАЛЫ', this.O('13px', '#ffb74d'));
    this.add.text(px + 30, matY + 22, 'Выпадают из лутовых коробок. Используются для крафта.',
      this.F('11px', '#607d8b'));

    const mats = Object.entries(CONSUMABLES)
      .filter(([, def]) => !def.canBuy)
      .map(([type, def]) => ({ type, ...def }));

    const MAT_W = 120, MAT_H = 130, MAT_GAP = 14;
    const matTotalW = mats.length * MAT_W + (mats.length - 1) * MAT_GAP;
    let mx = px + (pw - matTotalW) / 2;
    const my = matY + 46;

    mats.forEach(item => {
      this._drawMatCard(mx, my, MAT_W, MAT_H, item, gs);
      mx += MAT_W + MAT_GAP;
    });

    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());
  }

  _drawCard(cx, cy, cw, ch, item, gs, credTxt) {
    const g = this.add.graphics();
    g.fillStyle(0x0c1a28, 0.95); g.fillRoundedRect(cx, cy, cw, ch, 8);
    g.lineStyle(1.5, 0x2a6888, 0.7); g.strokeRoundedRect(cx, cy, cw, ch, 8);

    const iconKey = `consumable_${item.type}`;
    if (this.textures.exists(iconKey)) {
      const iconTex = prerenderTex(this, iconKey, 64, 64);
      this.add.image(cx + cw / 2, cy + 52, iconTex).setDisplaySize(64, 64).setOrigin(0.5);
    }

    this.add.text(cx + cw / 2, cy + 90, i18n.t(`item.${item.type}`),
      { ...this.O('10px', '#cfd8dc'), wordWrap: { width: cw - 16 }, align: 'center' }).setOrigin(0.5, 0);

    this.add.text(cx + cw / 2, cy + 118, `${item.price.toLocaleString()} cr.`,
      this.O('12px', '#ffd54f')).setOrigin(0.5, 0);

    this.add.text(cx + cw / 2, cy + 136, `макс. ${item.maxPerSlot} / слот`,
      this.F('10px', '#607d8b')).setOrigin(0.5, 0);

    const btnH = 28, btnY = cy + ch - btnH - 10;
    const btn = this.add.rectangle(cx + cw / 2, btnY + btnH / 2, cw - 20, btnH, 0x0d4060)
      .setStrokeStyle(1.5, 0x4dd0e1, 0.8).setInteractive({ useHandCursor: true });
    const btnTxt = this.add.text(cx + cw / 2, btnY + btnH / 2, 'КУПИТЬ ×1',
      this.O('9px', '#4dd0e1')).setOrigin(0.5);

    btn.on('pointerover', () => btn.setFillStyle(0x1a6080));
    btn.on('pointerout',  () => btn.setFillStyle(0x0d4060));
    btn.on('pointerdown', () => {
      if ((gs.credits || 0) < item.price) {
        btn.setFillStyle(0x5a1010);
        this.time.delayedCall(300, () => btn.setFillStyle(0x0d4060));
        return;
      }
      const inv = gs.inventory || [];
      const cargoMax = this._cargoMax(gs);
      const hasStack = inv.some(i => i.type === item.type && i.amount < item.maxPerSlot);
      if (!hasStack && inv.length >= cargoMax) {
        btnTxt.setText('ТРЮМ ПОЛОН');
        this.time.delayedCall(1400, () => btnTxt.setText('КУПИТЬ ×1'));
        return;
      }
      gs.credits -= item.price;
      addConsumableToInventory(inv, item.type, 1, cargoMax);
      credTxt.setText(`💰 ${gs.credits}`);
      gs._saveState?.();
      gs.log?.(`Куплено: ${i18n.t(`item.${item.type}`)} −${item.price} кр.`);
    });
  }

  _drawMatCard(cx, cy, cw, ch, item, gs) {
    const g = this.add.graphics();
    g.fillStyle(0x140f08, 0.95); g.fillRoundedRect(cx, cy, cw, ch, 8);
    g.lineStyle(1.5, 0x6a4a18, 0.5); g.strokeRoundedRect(cx, cy, cw, ch, 8);

    const iconKey = `consumable_${item.type}`;
    if (this.textures.exists(iconKey)) {
      const iconTex = prerenderTex(this, iconKey, 48, 48);
      this.add.image(cx + cw / 2, cy + 34, iconTex).setDisplaySize(48, 48).setOrigin(0.5);
    }

    this.add.text(cx + cw / 2, cy + 64, i18n.t(`item.${item.type}`),
      { ...this.F('10px', '#c8a870'), wordWrap: { width: cw - 10 }, align: 'center' }).setOrigin(0.5, 0);

    // Show how many player has
    const total = countConsumableInInventory(gs.inventory || [], item.type);
    this.add.text(cx + cw / 2, cy + ch - 22, `в трюме: ${total}`,
      this.F('10px', '#607d8b')).setOrigin(0.5, 0);
  }

  _cargoMax(gs) {
    const sl = gs.skillLevels?.cargo_expand || 0;
    const drover = gs.activeShip === 'drover' ? 2 : 0;
    const prem   = gs.premium ? (gs.activeShip === 'drover' ? 6 : 8) : 0;
    return 8 + drover + sl * (sl + 1) + prem;
  }
}
