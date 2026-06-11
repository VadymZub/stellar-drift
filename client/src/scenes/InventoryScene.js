import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';
import { itemName, itemStats } from '../items.js';

// Экран «Склад» (хоткей I). Показывает подобранные предметы и их статы.
export default class InventoryScene extends Phaser.Scene {
  constructor() { super('InventoryScene'); }

  create() {
    const gs = this.scene.get('GameScene');
    const W = this.scale.width, H = this.scale.height;

    this.add.rectangle(0, 0, W, H, 0x05070f, 0.6).setOrigin(0);

    const pw = Math.min(580, W - 60), ph = Math.min(560, H - 80);
    const px = (W - pw) / 2, py = (H - ph) / 2;
    const panel = this.add.graphics();
    panel.fillStyle(0x0b1622, 0.98); panel.fillRoundedRect(px, py, pw, ph, 10);
    panel.lineStyle(2, COLORS.primary, 0.8); panel.strokeRoundedRect(px, py, pw, ph, 10);

    const O = (s, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES });
    const F = (s, c) => ({ fontFamily: 'Inter, sans-serif', fontSize: s, color: c, resolution: UI_RES });

    this.add.text(px + 24, py + 18, i18n.t('inv.title'), O('22px', '#4dd0e1'));
    this.add.text(px + pw - 24, py + 24, 'I / ESC', F('12px', '#7e9398')).setOrigin(1, 0);

    const inv = gs.inventory || [];
    this.add.text(px + 24, py + 50, `${inv.length}`, F('12px', '#7e9398'))
      .setText(`${i18n.t('inv.count')}: ${inv.length}`);

    if (!inv.length) {
      this.add.text(px + 24, py + 90, i18n.t('inv.empty'), F('15px', '#9fb3b8'));
    } else {
      let y = py + 78;
      const rowH = 64, gap = 8;
      const maxRows = Math.floor((ph - 90) / (rowH + gap));
      inv.slice(0, maxRows).forEach((it) => {
        const row = this.add.graphics();
        row.fillStyle(0x12222e, 0.9); row.fillRoundedRect(px + 18, y, pw - 36, rowH, 6);
        row.lineStyle(1, COLORS.primary, 0.25); row.strokeRoundedRect(px + 18, y, pw - 36, rowH, 6);
        this.add.image(px + 52, y + rowH / 2, 'lootbox').setDisplaySize(34, 34);
        this.add.text(px + 84, y + 10, itemName(it), O('16px', '#ffe0b2'));
        this.add.text(px + 84, y + 36, itemStats(it), F('13px', '#cfe9ee'));
        y += rowH + gap;
      });
      if (inv.length > maxRows) {
        this.add.text(px + 24, y + 4, `… +${inv.length - maxRows}`, F('12px', '#7e9398'));
      }
    }

    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());
  }
}
