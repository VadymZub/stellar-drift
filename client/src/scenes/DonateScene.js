import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { prerenderTex } from '../utils/prerenderTex.js';

const PREMIUM_PLANS = [
  { id: 'prem_1m',  label: '1 МЕСЯЦ',  price: '$5.00',  days: 30  },
  { id: 'prem_3m',  label: '3 МЕСЯЦА', price: '$12.00', days: 90, badge: '−20%' },
  { id: 'prem_12m', label: '1 ГОД',    price: '$45.00', days: 365, badge: '−25%' },
];

const STAR_PACKS = [
  { id: 'stars_pilot',    label: 'ПИЛОТ',    stars: 125,  price: '$4.99'  },
  { id: 'stars_sergeant', label: 'СЕРЖАНТ',  stars: 250,  price: '$9.99'  },
  { id: 'stars_captain',  label: 'КАПИТАН',  stars: 550,  price: '$19.99', badge: '+10%' },
  { id: 'stars_admiral',  label: 'АДМИРАЛ',  stars: 1200, price: '$39.99', badge: '+20%' },
];

const PREMIUM_BENEFITS = [
  '+8 слотов трюма  (+6 для Drover)',
  '+8 слотов склада',
  'Авто-сбор плазмита (магнит)',
  'Элитные миссии  (скоро)',
  'Премиум данж  (скоро)',
];

export default class DonateScene extends Phaser.Scene {
  constructor() { super('DonateScene'); }

  O(s, c = '#4dd0e1') { return { fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }
  F(s, c = '#cce8f0') { return { fontFamily: 'Inter, sans-serif',    fontSize: s, color: c, resolution: UI_RES }; }

  create() {
    const W = this.scale.width, H = this.scale.height;
    const gs = this.scene.get('GameScene');

    // Dim backdrop
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55);

    const pw = Math.min(1100, W - 24), ph = Math.min(680, H - 24);
    const px = (W - pw) / 2,          py = (H - ph) / 2;

    // Panel
    const g = this.add.graphics();
    g.fillStyle(0x060c18, 0.98); g.fillRoundedRect(px, py, pw, ph, 14);
    g.lineStyle(2, COLORS.amber, 0.9); g.strokeRoundedRect(px, py, pw, ph, 14);

    // Header
    this.add.text(px + 34, py + 22, 'ДОНАТ МАГАЗИН', this.O('20px', '#ffd54f'));
    const escBtn = this.add.text(px + pw - 30, py + 28, 'ESC', this.F('13px', '#445566')).setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    escBtn.on('pointerover', () => escBtn.setColor('#aabbcc'));
    escBtn.on('pointerout',  () => escBtn.setColor('#445566'));
    escBtn.on('pointerdown', () => this.scene.stop());
    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());

    // Divider
    g.lineStyle(1, 0x1e3a5a, 0.7); g.lineBetween(px + 20, py + 58, px + pw - 20, py + 58);

    // Live balance — icon + number + separator + premium status
    const balCX = px + pw / 2;
    const balY  = py + 32;
    const icoB  = this.add.image(balCX - 76, balY, prerenderTex(this, 'icon_gold', 20, 20))
      .setDisplaySize(20, 20).setOrigin(0.5);
    const starTxt  = this.add.text(balCX - 62, balY, '', this.O('13px', '#ffd54f')).setOrigin(0, 0.5);
    const sepTxt   = this.add.text(0, balY, '  |  ', this.O('13px', '#445566')).setOrigin(0, 0.5);
    const premTxt  = this.add.text(0, balY, '', this.O('13px', '#ce93d8')).setOrigin(0, 0.5);
    const refreshBal = () => {
      starTxt.setText(`${gs.starGold || 0}`);
      sepTxt.setX(balCX - 62 + starTxt.width);
      const active = gs.premium;
      premTxt.setX(sepTxt.x + sepTxt.width)
             .setText(`PREMIUM: ${active ? 'АКТИВЕН' : 'НЕТ'}`)
             .setColor(active ? '#ffd54f' : '#ce93d8');
    };
    refreshBal();

    const colW = (pw - 60) / 2;
    const leftX  = px + 20;
    const rightX = px + 40 + colW;
    const contentY = py + 72;

    // ── LEFT: Premium subscription ───────────────────────────────────────────
    this._drawPremiumSection(leftX, contentY, colW, ph - 90, gs, refreshBal);

    // Vertical separator
    g.lineStyle(1, 0x1e3a5a, 0.6);
    g.lineBetween(px + pw / 2, py + 65, px + pw / 2, py + ph - 20);

    // ── RIGHT: Star packs ────────────────────────────────────────────────────
    this._drawStarSection(rightX, contentY, colW, ph - 90, gs, refreshBal);
  }

  _drawPremiumSection(x, y, w, h, gs, refreshBal) {
    this.add.text(x, y, 'ПОДПИСКА PREMIUM', this.O('14px', '#ffb74d'));

    // Premium icon
    const iconSz = 80;
    const iconX  = x + w / 2;
    this.add.image(iconX, y + 44 + iconSz / 2, prerenderTex(this, 'icon_premium', iconSz, iconSz))
      .setDisplaySize(iconSz, iconSz).setOrigin(0.5);

    // Plan buttons
    const planY = y + 132;
    PREMIUM_PLANS.forEach((plan, i) => {
      this._drawPlanBtn(x, planY + i * 58, w, plan, gs, refreshBal);
    });

    // Benefits hint
    const hintY = planY + PREMIUM_PLANS.length * 58 + 16;
    const hintH = PREMIUM_BENEFITS.length * 22 + 28;
    const hg = this.add.graphics();
    hg.fillStyle(0x0a1a0a, 0.85); hg.fillRoundedRect(x, hintY, w - 10, hintH, 8);
    hg.lineStyle(1, 0x2a5a2a, 0.7); hg.strokeRoundedRect(x, hintY, w - 10, hintH, 8);
    this.add.text(x + 14, hintY + 10, 'ПРЕИМУЩЕСТВА PREMIUM:', this.F('11px', '#66bb6a'));
    PREMIUM_BENEFITS.forEach((line, i) => {
      this.add.text(x + 14, hintY + 28 + i * 22, `✓  ${line}`, this.F('11px', '#99cc99'));
    });
  }

  _drawPlanBtn(x, y, w, plan, gs, refreshBal) {
    const bh = 48, bw = w - 10;
    const bg = this.add.rectangle(x + bw / 2, y + bh / 2, bw, bh, 0x1a0a2e)
      .setStrokeStyle(1.5, 0x7c4dff, 0.8).setInteractive({ useHandCursor: true });

    this.add.text(x + 14, y + bh / 2, plan.label, this.O('11px', '#ce93d8')).setOrigin(0, 0.5);
    this.add.text(x + bw - 14, y + bh / 2, plan.price, this.O('13px', '#ffd54f')).setOrigin(1, 0.5);

    if (plan.badge) {
      const badgeX = x + bw - 78;
      this.add.rectangle(badgeX, y + 12, 38, 16, 0x2a0a4e).setOrigin(0.5);
      this.add.text(badgeX, y + 12, plan.badge, this.F('10px', '#ea80fc')).setOrigin(0.5);
    }

    bg.on('pointerover', () => bg.setFillStyle(0x2e1050));
    bg.on('pointerout',  () => bg.setFillStyle(0x1a0a2e));
    bg.on('pointerdown', () => this._showComingSoon(x + bw / 2, y));
  }

  _drawStarSection(x, y, w, h, gs, refreshBal) {
    // Icon + title
    this.add.image(x + 12, y + 9, prerenderTex(this, 'icon_gold', 24, 24))
      .setDisplaySize(24, 24).setOrigin(0, 0.5);
    this.add.text(x + 30, y, 'ЗОЛОТЫЕ ЗВЁЗДЫ', this.O('14px', '#ffd54f'));

    const cw = (w - 20) / 2, ch = 150, gap = 10;
    STAR_PACKS.forEach((pack, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const cx  = x + col * (cw + gap);
      const cy  = y + 30 + row * (ch + gap);
      this._drawStarCard(cx, cy, cw, ch, pack, gs, refreshBal);
    });
  }

  _drawStarCard(cx, cy, cw, ch, pack, gs, refreshBal) {
    const g = this.add.graphics();
    g.fillStyle(0x0c1810, 0.97); g.fillRoundedRect(cx, cy, cw, ch, 10);
    g.lineStyle(1.5, 0x3a5a20, 0.8); g.strokeRoundedRect(cx, cy, cw, ch, 10);

    this.add.text(cx + cw / 2, cy + 14, pack.label, this.O('12px', '#aed581')).setOrigin(0.5, 0);

    // Icon + number side by side, centered
    const icoSz = 44;
    const numTxt = this.add.text(0, 0, `${pack.stars}`, this.O('22px', '#ffd54f')).setOrigin(0, 0.5);
    const pairW  = icoSz + 8 + numTxt.width;
    const pairX  = cx + (cw - pairW) / 2;
    const pairY  = cy + 60;
    this.add.image(pairX + icoSz / 2, pairY, prerenderTex(this, 'icon_gold', icoSz, icoSz))
      .setDisplaySize(icoSz, icoSz).setOrigin(0.5);
    numTxt.setPosition(pairX + icoSz + 8, pairY);

    if (pack.badge) {
      this.add.text(cx + cw / 2, cy + 80, pack.badge, this.F('11px', '#a5d6a7')).setOrigin(0.5, 0);
    }

    const btnY = cy + ch - 38;
    const btn  = this.add.rectangle(cx + cw / 2, btnY + 16, cw - 16, 32, 0x1a3010)
      .setStrokeStyle(1.5, 0xaed581, 0.8).setInteractive({ useHandCursor: true });
    this.add.text(cx + cw / 2, btnY + 16, pack.price, this.O('12px', '#dce775')).setOrigin(0.5);

    btn.on('pointerover', () => btn.setFillStyle(0x2a4a20));
    btn.on('pointerout',  () => btn.setFillStyle(0x1a3010));
    btn.on('pointerdown', () => this._showComingSoon(cx + cw / 2, cy));
  }

  _showComingSoon(x, y) {
    const lbl = this.add.text(x, y - 10, 'СКОРО', this.O('13px', '#ffcc80'))
      .setOrigin(0.5, 1).setAlpha(0);
    this.tweens.add({ targets: lbl, alpha: 1, y: y - 28, duration: 200,
      onComplete: () => this.tweens.add({ targets: lbl, alpha: 0, duration: 400, delay: 800,
        onComplete: () => lbl.destroy() }) });
  }
}
