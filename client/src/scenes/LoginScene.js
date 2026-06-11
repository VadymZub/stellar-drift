import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';

export default class LoginScene extends Phaser.Scene {
  constructor() { super('LoginScene'); }

  create() {
    const W = this.scale.width, H = this.scale.height;

    // Фоновая иллюстрация меню
    const bg = this.add.image(W / 2, H / 2, 'bg_login');
    const scale = Math.max(W / bg.width, H / bg.height);
    bg.setScale(scale);

    // Затемнение для читаемости
    this.add.rectangle(0, 0, W, H, 0x000000, 0.3).setOrigin(0);

    const title = this.add.text(W / 2, H * 0.3, 'STELLAR DRIFT', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '64px',
      color: '#4dd0e1',
      resolution: UI_RES
    }).setOrigin(0.5);

    const startBtn = this.add.rectangle(W / 2, H * 0.7, 280, 60, 0x00bcd4, 0.8)
      .setInteractive({ useHandCursor: true });
    
    const startTxt = this.add.text(W / 2, H * 0.7, i18n.t('menu.start') || 'START GAME', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '24px',
      color: '#ffffff',
      resolution: UI_RES
    }).setOrigin(0.5);

    startBtn.on('pointerover', () => startBtn.setFillStyle(0x4dd0e1, 1));
    startBtn.on('pointerout', () => startBtn.setFillStyle(0x00bcd4, 0.8));
    
    startBtn.on('pointerdown', () => {
      this.scene.start('GameScene');
      this.scene.launch('BackgroundScene');
      this.scene.launch('HudScene');
    });
  }
}
