import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';

export default class MissionsScene extends Phaser.Scene {
  constructor() { super('MissionsScene'); }

  create() {
    const W = this.scale.width, H = this.scale.height;
    // Сплошной темный фон
    this.add.rectangle(0, 0, W, H, 0x05070f, 1.0).setOrigin(0);

    const bg = this.add.image(W / 2, H / 2, 'bg_missions');
    bg.setScale(Math.max(W / bg.width, H / bg.height)).setAlpha(0.8).setTint(0x667788);
    this.add.rectangle(0, 0, W, H, 0x000000, 0.2).setOrigin(0);

    const pw = Math.min(900, W - 60), ph = Math.min(600, H - 60);
    const px = (W - pw) / 2, py = (H - ph) / 2;
    
    const g = this.add.graphics();
    g.fillStyle(0x0b1622, 0.9); g.fillRoundedRect(px, py, pw, ph, 12);
    g.lineStyle(2, COLORS.primary, 0.8); g.strokeRoundedRect(px, py, pw, ph, 12);

    this.add.text(px + 30, py + 20, i18n.t('menu.missions') || 'MISSIONS', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '24px', color: '#4dd0e1', resolution: UI_RES
    });

    this.add.text(px + pw - 30, py + 25, i18n.t('menu.esc_exit'), {
      fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#7e9398', resolution: UI_RES
    }).setOrigin(1, 0);

    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());
  }
}
