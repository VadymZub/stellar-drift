import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';

export default class CorpScene extends Phaser.Scene {
  constructor() { super('CorpScene'); }

  create(data) {
    const corp = data.corp || 'helios'; // helios, karaks, tides
    const W = this.scale.width, H = this.scale.height;
    
    // Сплошной темный фон
    this.add.rectangle(0, 0, W, H, 0x05070f, 1.0).setOrigin(0);

    const bgKey = `bg_corp_${corp}`;
    const bg = this.add.image(W / 2, H / 2, bgKey);
    bg.setScale(Math.max(W / bg.width, H / bg.height)).setAlpha(0.8).setTint(0x776688);
    this.add.rectangle(0, 0, W, H, 0x000000, 0.2).setOrigin(0);

    const pw = Math.min(960, W - 40), ph = Math.min(640, H - 40);
    const px = (W - pw) / 2, py = (H - ph) / 2;
    
    const g = this.add.graphics();
    g.fillStyle(0x0b1622, 0.92); g.fillRoundedRect(px, py, pw, ph, 12);
    g.lineStyle(2, 0xb39ddb, 0.8); g.strokeRoundedRect(px, py, pw, ph, 12);

    const corpName = i18n.t(`corp.${corp}`) || corp.toUpperCase();
    this.add.text(px + 30, py + 20, `${corpName} HQ`, {
      fontFamily: 'Orbitron, sans-serif', fontSize: '24px', color: '#b39ddb', resolution: UI_RES
    });

    this.add.text(px + pw - 30, py + 25, 'ESC TO EXIT', {
      fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#7e9398', resolution: UI_RES
    }).setOrigin(1, 0);

    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());
  }
}
