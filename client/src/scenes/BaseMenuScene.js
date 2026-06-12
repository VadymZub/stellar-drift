import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { BASE_CONFIG, TURRET_SLOTS } from '../bases.js';
import { COLORS, UI_RES } from '../constants.js';

const W = 480, H = 520;
const PAD = 20;
const BTN_H = 38;

export default class BaseMenuScene extends Phaser.Scene {
  constructor() { super('BaseMenuScene'); }

  init(data) {
    this.base       = data.base;
    this.playerName = data.playerName;
  }

  create() {
    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;

    // Dim overlay
    this.add.rectangle(cx, cy, width, height, 0x000000, 0.55);

    // Panel
    const panel = this.add.rectangle(cx, cy, W, H, 0x0a0e1a, 0.97);
    panel.setStrokeStyle(2, COLORS.primary, 0.9);

    const tf  = { fontFamily: 'Orbitron', resolution: UI_RES };
    const top = cy - H / 2 + PAD;

    // Title
    this.add.text(cx, top + 12, 'БАЗА: ' + this.base.corp.toUpperCase(), { ...tf, fontSize: '18px', color: '#4dd0e1' }).setOrigin(0.5);

    // Corp label
    const stateColor = this.base.state === 'active' ? '#4dd0e1' : '#ffb74d';
    this.add.text(cx, top + 38, this._stateText(), { ...tf, fontSize: '13px', color: stateColor }).setOrigin(0.5);

    // HP bar
    const barY = top + 62;
    this.add.rectangle(cx, barY, W - PAD * 2, 8, 0x333344);
    const frac = this.base.hull / BASE_CONFIG.hullMax;
    this.add.rectangle(cx - (W - PAD * 2) / 2, barY, Math.round((W - PAD * 2) * frac), 8, COLORS.primary).setOrigin(0, 0.5);
    this.add.text(cx, barY + 14, `HP ${this.base.hull} / ${BASE_CONFIG.hullMax}`, { ...tf, fontSize: '11px', color: '#6688aa' }).setOrigin(0.5);

    // Owners table
    let oy = top + 100;
    this.add.text(cx, oy, 'ВЛАДЕЛЬЦЫ', { ...tf, fontSize: '13px', color: '#ccddff' }).setOrigin(0.5);
    oy += 20;
    if (this.base.owners.length === 0) {
      this.add.text(cx, oy, '(нет)', { ...tf, fontSize: '12px', color: '#556677' }).setOrigin(0.5);
      oy += 18;
    } else {
      for (const o of this.base.owners) {
        const line = `${o.name}   ${Math.floor(o.points)} очков   ${Math.floor(o.gold * 100) / 100} ⭐`;
        this.add.text(cx, oy, line, { ...tf, fontSize: '12px', color: '#aabbcc' }).setOrigin(0.5);
        oy += 18;
      }
    }
    // Banked totals
    oy += 4;
    this.add.text(cx, oy, `Накоплено в базе: ${Math.floor(this.base.pointsBanked)} очков / ${Math.floor(this.base.goldBanked * 100) / 100} ⭐`, { ...tf, fontSize: '11px', color: '#556677' }).setOrigin(0.5);

    // Turret slots (if active)
    if (this.base.state === 'active') {
      oy += 30;
      this.add.text(cx, oy, 'ТУРЕЛЬНЫЕ СЛОТЫ', { ...tf, fontSize: '13px', color: '#ccddff' }).setOrigin(0.5);
      oy += 22;

      const isOwner = this.base.owners.some(o => o.name === this.playerName);
      const colW = (W - PAD * 2) / 3;

      TURRET_SLOTS.forEach((_, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        const bx  = cx - (W - PAD * 2) / 2 + col * colW + colW / 2;
        const by  = oy + row * (BTN_H + 6);
        const type = this.base.turrets[i];

        if (type) {
          this.add.rectangle(bx, by, colW - 8, BTN_H, 0x0d2a1a).setStrokeStyle(1, COLORS.primary, 0.6).setOrigin(0.5);
          this.add.text(bx, by, type === 'cannon2' ? '⬡⬡' : '⬡', { ...tf, fontSize: '14px', color: '#4dd0e1' }).setOrigin(0.5);
        } else if (isOwner) {
          const btnBg = this.add.rectangle(bx, by, colW - 8, BTN_H, 0x152030).setStrokeStyle(1, 0x446688, 0.8).setOrigin(0.5).setInteractive();
          this.add.text(bx, by - 6, `Слот ${i + 1}`, { ...tf, fontSize: '11px', color: '#556677' }).setOrigin(0.5);
          this.add.text(bx, by + 8, `[купить 5k]`, { ...tf, fontSize: '10px', color: '#4488aa' }).setOrigin(0.5);

          btnBg.on('pointerover',  () => btnBg.setFillStyle(0x1e3a50));
          btnBg.on('pointerout',   () => btnBg.setFillStyle(0x152030));
          btnBg.on('pointerdown',  () => this._showTurretPicker(i));
        } else {
          this.add.rectangle(bx, by, colW - 8, BTN_H, 0x0d0d1a).setStrokeStyle(1, 0x223344, 0.5).setOrigin(0.5);
          this.add.text(bx, by, `Слот ${i + 1}`, { ...tf, fontSize: '11px', color: '#334455' }).setOrigin(0.5);
        }
      });

      oy += 2 * (BTN_H + 6) + 10;
    } else {
      oy += 30;
    }

    // Close button
    const closeY = cy + H / 2 - PAD - BTN_H / 2;
    const closeBg = this.add.rectangle(cx, closeY, 160, BTN_H, 0x1a1a2e).setStrokeStyle(1, COLORS.primary, 0.7).setInteractive();
    this.add.text(cx, closeY, 'ЗАКРЫТЬ', { ...tf, fontSize: '14px', color: '#4dd0e1' }).setOrigin(0.5);
    closeBg.on('pointerover',  () => closeBg.setFillStyle(0x22224a));
    closeBg.on('pointerout',   () => closeBg.setFillStyle(0x1a1a2e));
    closeBg.on('pointerdown',  () => this.scene.stop());

    this.input.keyboard.once('keydown-ESC',   () => this.scene.stop());
    this.input.keyboard.once('keydown-F',     () => this.scene.stop());
  }

  _stateText() {
    const b = this.base;
    if (b.state === 'building') {
      const rem = Math.ceil(BASE_CONFIG.buildTimeSec - b._buildTimer);
      const m = Math.floor(rem / 60), s = rem % 60;
      return `СТРОИТСЯ — ${m}:${String(s).padStart(2, '0')}`;
    }
    if (b.corp === 'neutral') {
      return b._neutralPhase === 'immune' ? 'НЕЙТРАЛЬНА (иммунитет)' : 'НЕЙТРАЛЬНА (открыта)';
    }
    return 'АКТИВНА';
  }

  _showTurretPicker(slotIdx) {
    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;
    const pw = 300, ph = 160;

    const overlay = this.add.rectangle(cx, cy, width, height, 0x000000, 0.4).setInteractive();
    const bg      = this.add.rectangle(cx, cy, pw, ph, 0x0a0e1a).setStrokeStyle(2, COLORS.primary, 0.9);
    const tf      = { fontFamily: 'Orbitron', resolution: UI_RES };

    this.add.text(cx, cy - ph / 2 + 16, `СЛОТ ${slotIdx + 1} — выбор турели`, { ...tf, fontSize: '13px', color: '#4dd0e1' }).setOrigin(0.5);

    const buttons = [
      { label: 'Cannon I (базовая)',  type: 'cannon1', desc: '5 000 кр' },
      { label: 'Cannon II (двойная)', type: 'cannon2', desc: '5 000 кр' },
    ];
    const created = [overlay, bg];
    buttons.forEach((b, i) => {
      const by = cy - 20 + i * 50;
      const btnBg = this.add.rectangle(cx, by, pw - 40, 40, 0x152030).setStrokeStyle(1, 0x446688, 0.8).setInteractive();
      const lbl   = this.add.text(cx, by - 6, b.label, { ...tf, fontSize: '13px', color: '#ccddee' }).setOrigin(0.5);
      const sub   = this.add.text(cx, by + 10, b.desc,  { ...tf, fontSize: '11px', color: '#556677' }).setOrigin(0.5);
      created.push(btnBg, lbl, sub);

      btnBg.on('pointerover',  () => btnBg.setFillStyle(0x1e3a50));
      btnBg.on('pointerout',   () => btnBg.setFillStyle(0x152030));
      btnBg.on('pointerdown',  () => {
        created.forEach(o => o.destroy());
        this.base.buyTurret(slotIdx, b.type, this.playerName);
        this.scene.restart({ base: this.base, playerName: this.playerName });
      });
    });

    const cancel = this.add.text(cx, cy + ph / 2 - 18, 'Отмена', { ...tf, fontSize: '12px', color: '#556677' }).setOrigin(0.5).setInteractive();
    created.push(cancel);
    cancel.on('pointerdown', () => created.forEach(o => o.destroy()));
    overlay.on('pointerdown', () => created.forEach(o => o.destroy()));
  }
}
