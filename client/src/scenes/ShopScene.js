import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';

export default class ShopScene extends Phaser.Scene {
  constructor() { super('ShopScene'); }

  create() {
    const W = this.scale.width, H = this.scale.height;
    // Сплошной темный фон
    this.add.rectangle(0, 0, W, H, 0x05070f, 1.0).setOrigin(0);

    const bg = this.add.image(W / 2, H / 2, 'bg_shop');
    bg.setScale(Math.max(W / bg.width, H / bg.height)).setAlpha(0.8).setTint(0x887766);
    this.add.rectangle(0, 0, W, H, 0x000000, 0.2).setOrigin(0);

    const pw = Math.min(940, W - 40), ph = Math.min(640, H - 40);
    const px = (W - pw) / 2, py = (H - ph) / 2;
    
    const g = this.add.graphics();
    g.fillStyle(0x0b1622, 0.95); g.fillRoundedRect(px, py, pw, ph, 12);
    g.lineStyle(2, COLORS.amber, 0.8); g.strokeRoundedRect(px, py, pw, ph, 12);

    this.add.text(px + 30, py + 20, i18n.t('menu.shop') || 'STATION SHOP', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '24px', color: '#ffb74d', resolution: UI_RES
    });

    this.add.text(px + pw - 30, py + 25, 'ESC TO EXIT', {
      fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#7e9398', resolution: UI_RES
    }).setOrigin(1, 0);

    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());
  }
}
