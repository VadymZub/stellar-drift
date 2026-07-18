import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { BASE_CONFIG, cannon2GoldCost, goldPerSecByTier } from '../bases.js';
import { COLORS, UI_RES } from '../constants.js';

// All sizes are ×1.3 vs the original 500/22 design.
const W   = 650;
const PAD = 29;
const TF  = { fontFamily: 'Orbitron', resolution: UI_RES };

export default class BaseMenuScene extends Phaser.Scene {
  constructor() { super('BaseMenuScene'); }

  init(data) {
    this.base       = data.base;
    this.playerName = data.playerName;
  }

  create() {
    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;

    // Full-screen dim — clicking outside closes. stopPropagation everywhere in this
    // scene is required — GameScene's OWN scene-level pointerdown listener (click to
    // move the ship) also runs on every click that reaches the canvas regardless of
    // what this (separate, overlaid) scene's objects consume, so without it clicking
    // any button here also moved the ship underneath.
    const dim = this.add.rectangle(cx, cy, width, height, 0x000000, 0.55).setInteractive();
    dim.on('pointerdown', (pointer, lx, ly, event) => { if (event) event.stopPropagation(); this.scene.stop(); });

    if (this.base.state === 'destroyed') {
      this._buildDestroyedPanel(cx, cy);
    } else {
      this._buildInfoPanel(cx, cy);
    }

    this.input.keyboard.once('keydown-ESC', () => this.scene.stop());
    this.input.keyboard.once('keydown-F',   () => this.scene.stop());
  }

  // ── Destroyed: buy-only ────────────────────────────────────────────────────

  _buildDestroyedPanel(cx, cy) {
    const H = 260;
    this._panel(cx, cy, W, H);

    const top = cy - H / 2 + PAD;
    this.add.text(cx, top + 14, this.base.stationName, { ...TF, fontSize: '21px', color: '#4dd0e1' }).setOrigin(0.5);
    this.add.text(cx, top + 36, 'ДОБЫВАЮЩАЯ БАЗА',      { ...TF, fontSize: '12px', color: '#5a8095' }).setOrigin(0.5);
    this.add.text(cx, top + 58, 'РАЗРУШЕНА',            { ...TF, fontSize: '17px', color: '#ef5350' }).setOrigin(0.5);

    const gs = this.scene.get('GameScene');
    const canAfford = (gs?.credits || 0) >= BASE_CONFIG.baseCostCredits;
    const btnColor  = canAfford ? 0x0d2a1a : 0x2a0d0d;
    const lblColor  = canAfford ? '#4dd0e1' : '#884444';

    const btnY = cy + 26;
    const btn  = this.add.rectangle(cx, btnY, W - PAD * 2, 62, btnColor)
      .setStrokeStyle(2, canAfford ? COLORS.primary : 0x884444, 0.9).setInteractive();
    this.add.text(cx, btnY - 11, 'КУПИТЬ БАЗУ', { ...TF, fontSize: '20px', color: lblColor }).setOrigin(0.5);
    this.add.text(cx, btnY + 13, `${BASE_CONFIG.baseCostCredits.toLocaleString()} кредитов`, { ...TF, fontSize: '16px', color: '#667788' }).setOrigin(0.5);

    if (canAfford) {
      btn.on('pointerover',  () => btn.setFillStyle(0x1a3a24));
      btn.on('pointerout',   () => btn.setFillStyle(btnColor));
      btn.on('pointerdown',  (pointer, lx, ly, event) => {
        if (event) event.stopPropagation();
        this.base.buyBase(this.playerName);
        this.scene.restart({ base: this.base, playerName: this.playerName });
      });
    }

    this._closeBtn(cx, cy + H / 2 - PAD - 24);
  }

  // ── Active / Building: full info panel ────────────────────────────────────

  _buildInfoPanel(cx, cy) {
    const isActive  = this.base.state === 'active';
    const n         = this.base.owners.length || 1;
    const ptsPerHr  = Math.round(BASE_CONFIG.pointsPerSec * 3600 / n);
    const goldPerHr = +(goldPerSecByTier(this.base.pvpTier) * 3600 / n).toFixed(1);

    const isOwner   = this.base.owners.some(o => o.name === this.playerName);
    const ownerRows = Math.max(1, this.base.owners.length);
    const speedUpH  = (!isActive && isOwner) ? 72 : 0;
    const hasShield = this.base.maxShield > 0;
    const hpBlockH  = hasShield ? 68 : 42;
    // Слоты: заголовок "ТУРЕЛЬНЫЕ СЛОТЫ" (40px до первого ряда — раньше было 26px,
    // из-за чего лейбл визуально налезал на первую строку карточек турелей, см.
    // отступ ниже) + 2 ряда карточек (57px + 8px зазор каждый).
    const turretH   = isActive ? (40 + 2 * (57 + 8)) : 0;
    // Найм охраны: кнопка (не нанята, владелец) или строка статуса (уже нанята) —
    // видна только для активной базы (см. диалог "частная охрана - хорошая идея").
    const hireH     = !isActive ? 0 : (this.base.hiredSecurity ? 26 : (isOwner ? 70 : 0));
    const H         = Math.min(780,
      PAD + 50              // title (station name + "ДОБЫВАЮЩАЯ БАЗА" subtitle)
      + 29                  // state
      + hpBlockH             // hp (+ shield) bar block
      + speedUpH
      + 26                  // spacer / income
      + 21 + 5              // owners header
      + ownerRows * 26      // owner rows
      + 29                  // banked
      + (turretH > 0 ? turretH + 21 : 0)
      + hireH
      + 57                  // close button
      + PAD * 2
    );

    this._panel(cx, cy, W, H);
    let y = cy - H / 2 + PAD;

    // Title — station name on top (readable at a glance), corp/type as a smaller
    // subtitle right below so it doesn't compete for attention with the name.
    const corpName = this.base.corp !== 'neutral' ? ` · ${this.base.corp.toUpperCase()}` : '';
    this.add.text(cx, y + 14, this.base.stationName, { ...TF, fontSize: '20px', color: '#4dd0e1' }).setOrigin(0.5);
    this.add.text(cx, y + 34, `ДОБЫВАЮЩАЯ БАЗА${corpName}`, { ...TF, fontSize: '12px', color: '#5a8095' }).setOrigin(0.5);
    y += 50;

    // State line — live-updated every second
    const stateColor = isActive ? '#4dd0e1' : '#ffb74d';
    const stateLbl = this.add.text(cx, y, this._stateText(), { ...TF, fontSize: '16px', color: stateColor }).setOrigin(0.5);
    this.time.addEvent({ delay: 1000, loop: true, callback: () => { if (stateLbl?.active) stateLbl.setText(this._stateText()); } });
    y += 29;

    // HP/shield bars — live-updated during construction and combat (this.base.maxHull/
    // maxShield are tier-scaled getters, not the flat BASE_CONFIG constants — a base on
    // pvp1-3 has less than the pvp4/5 base values, this used to always show/divide by
    // the flat 100% value regardless of tier).
    const barW   = W - PAD * 2;
    this.add.text(cx - barW / 2, y - 12, 'ОБШИВКА', { ...TF, fontSize: '11px', color: '#2a4a5a' }).setOrigin(0, 0.5);
    this.add.rectangle(cx, y, barW, 16, 0x0a1420).setOrigin(0.5).setStrokeStyle(1, 0x1a3a50, 0.7);
    const hpFill = this.add.rectangle(cx - barW / 2, y, 1, 16, COLORS.emerald).setOrigin(0, 0.5);
    const hpTxt  = this.add.text(cx, y + 20, '', { ...TF, fontSize: '13px', color: '#4a7090' }).setOrigin(0.5);
    let shieldFill = null, shieldTxt = null;
    if (hasShield) {
      this.add.rectangle(cx, y + 38, barW, 12, 0x0a1420).setOrigin(0.5).setStrokeStyle(1, 0x1a3a50, 0.7);
      shieldFill = this.add.rectangle(cx - barW / 2, y + 38, 1, 12, 0x80deea).setOrigin(0, 0.5);
      shieldTxt  = this.add.text(cx, y + 56, '', { ...TF, fontSize: '13px', color: '#4a7090' }).setOrigin(0.5);
    }
    const refreshHp = () => {
      const f = this.base.maxHull > 0 ? this.base.hull / this.base.maxHull : 0;
      const c = f > 0.5 ? COLORS.emerald : f > 0.25 ? 0xffb74d : 0xef5350;
      if (hpFill?.active) { hpFill.setDisplaySize(Math.max(1, Math.round(barW * f)), 13).setFillStyle(c); }
      if (hpTxt?.active)  { hpTxt.setText(`HP  ${Math.round(this.base.hull).toLocaleString()} / ${Math.round(this.base.maxHull).toLocaleString()}`); }
      if (hasShield && shieldFill?.active) {
        const sf = this.base.maxShield > 0 ? this.base.shield / this.base.maxShield : 0;
        shieldFill.setDisplaySize(Math.max(1, Math.round(barW * sf)), 9);
        shieldTxt.setText(`ЩИТ  ${Math.round(this.base.shield).toLocaleString()} / ${Math.round(this.base.maxShield).toLocaleString()}`);
      }
    };
    refreshHp();
    this.time.addEvent({ delay: 1000, loop: true, callback: refreshHp });
    y += hpBlockH;

    // Speed-up button (building state, owners only)
    if (!isActive && isOwner) {
      const cost      = this.base.speedUpCost;
      const gs        = this.scene.get('GameScene');
      const canAfford = (gs?.starGold || 0) >= cost;
      const btnColor  = canAfford ? 0x1a2a10 : 0x1a1a10;
      const lblColor  = canAfford ? '#c8e86a' : '#665533';
      const btn = this.add.rectangle(cx, y + 23, W - PAD * 2, 52, btnColor)
        .setStrokeStyle(2, canAfford ? 0xa0c840 : 0x665533, 0.9).setInteractive();
      this.add.text(cx, y + 13, 'УСКОРИТЬ СТРОИТЕЛЬСТВО', { ...TF, fontSize: '16px', color: lblColor }).setOrigin(0.5);
      this.add.text(cx, y + 33, `${cost} ⭐  (у вас: ${Math.floor(gs?.starGold || 0)} ⭐)`, { ...TF, fontSize: '14px', color: canAfford ? '#ffcc44' : '#554422' }).setOrigin(0.5);
      if (canAfford) {
        btn.on('pointerover',  () => btn.setFillStyle(0x263d16));
        btn.on('pointerout',   () => btn.setFillStyle(btnColor));
        btn.on('pointerdown',  (pointer, lx, ly, event) => {
          if (event) event.stopPropagation();
          const ok = this.base.speedUpBuild(this.playerName);
          if (ok) this.scene.restart({ base: this.base, playerName: this.playerName });
        });
      }
      y += speedUpH;
    }

    // Income info (active only)
    if (isActive && this.base.owners.length > 0) {
      this.add.text(cx, y, `Доход: +${ptsPerHr} очков/ч  ·  +${goldPerHr} ⭐/ч  (на владельца)`, { ...TF, fontSize: '14px', color: '#88aa66' }).setOrigin(0.5);
      y += 26;
    }

    // Owners header
    this.add.text(cx - barW / 2, y, 'ВЛАДЕЛЬЦЫ', { ...TF, fontSize: '16px', color: '#ccddff' }).setOrigin(0, 0.5);
    y += 26;

    if (!this.base.owners.length) {
      this.add.text(cx, y, '(нет)', { ...TF, fontSize: '16px', color: '#445566' }).setOrigin(0.5);
      y += 26;
    } else {
      // Column headers
      const cols = [cx - barW / 2, cx - 26, cx + 143, cx + barW / 2];
      this.add.text(cols[0], y, 'Игрок',     { ...TF, fontSize: '13px', color: '#446688' }).setOrigin(0, 0.5);
      this.add.text(cols[1], y, 'Очки',      { ...TF, fontSize: '13px', color: '#446688' }).setOrigin(0, 0.5);
      this.add.text(cols[2], y, '⭐ Золото', { ...TF, fontSize: '13px', color: '#446688' }).setOrigin(0, 0.5);
      y += 21;

      for (const o of this.base.owners.slice(0, 8)) {
        const isMe = o.name === this.playerName;
        const clr  = isMe ? '#4dd0e1' : '#aabbcc';
        this.add.text(cols[0], y, o.name,                                    { ...TF, fontSize: '16px', color: clr      }).setOrigin(0, 0.5);
        this.add.text(cols[1], y, Math.floor(o.points).toLocaleString(),     { ...TF, fontSize: '16px', color: clr      }).setOrigin(0, 0.5);
        this.add.text(cols[2], y, (Math.floor(o.gold * 100) / 100).toFixed(2), { ...TF, fontSize: '16px', color: '#ffcc55' }).setOrigin(0, 0.5);
        y += 26;
      }
    }

    // Banked totals
    this.add.text(cx, y + 5, `Накоплено: ${Math.floor(this.base.pointsBanked).toLocaleString()} очков  /  ${this.base.goldBanked.toFixed(2)} ⭐`, { ...TF, fontSize: '13px', color: '#445566' }).setOrigin(0.5);
    y += 29;

    // Turret slots (active only)
    if (isActive) {
      // 40px до первого ряда карточек, не 26 — на 16px текст "ТУРЕЛЬНЫЕ СЛОТЫ" (origin
      // 0,0.5) с 26px отступом визуально налезал на верх первой карточки (slotH=57,
      // так что верхний край карточки был выше нижнего края лейбла).
      this.add.text(cx - barW / 2, y, 'ТУРЕЛЬНЫЕ СЛОТЫ', { ...TF, fontSize: '16px', color: '#ccddff' }).setOrigin(0, 0.5);
      y += 40;

      const colW  = Math.floor(barW / 3);
      const slotH = 57;

      Array.from({ length: BASE_CONFIG.turretSlots }, (_, i) => i).forEach((i) => {
        const col  = i % 3;
        const row  = Math.floor(i / 3);
        const bx   = cx - barW / 2 + col * colW + colW / 2;
        const by   = y + row * (slotH + 8);
        const type = this.base.turrets[i];

        if (type) {
          const tt = this.base.turretTargets[i];
          const alive = !tt || tt.alive;
          this.add.rectangle(bx, by, colW - 8, slotH, 0x0d2a1a).setStrokeStyle(1, COLORS.primary, 0.7).setOrigin(0.5);
          this.add.text(bx, by - 10, type === 'cannon2' ? 'Cannon II' : 'Cannon I', { ...TF, fontSize: '14px', color: '#4dd0e1' }).setOrigin(0.5);
          this.add.text(bx, by + 10, alive ? '▣ установлена' : '▣ уничтожена',
            { ...TF, fontSize: '12px', color: alive ? '#336644' : '#663333' }).setOrigin(0.5);
        } else if (isOwner) {
          const bg = this.add.rectangle(bx, by, colW - 8, slotH, 0x111828)
            .setStrokeStyle(1, 0x334466, 0.8).setOrigin(0.5).setInteractive();
          this.add.text(bx, by - 10, `Слот ${i + 1}`, { ...TF, fontSize: '13px', color: '#445566' }).setOrigin(0.5);
          this.add.text(bx, by + 10, '+ Купить',       { ...TF, fontSize: '14px', color: '#4488cc' }).setOrigin(0.5);
          bg.on('pointerover',  () => bg.setFillStyle(0x182438));
          bg.on('pointerout',   () => bg.setFillStyle(0x111828));
          bg.on('pointerdown',  (pointer, lx, ly, event) => { if (event) event.stopPropagation(); this._turretPicker(i); });
        } else {
          this.add.rectangle(bx, by, colW - 8, slotH, 0x0a0d14).setStrokeStyle(1, 0x222233, 0.6).setOrigin(0.5);
          this.add.text(bx, by, `Слот ${i + 1}`, { ...TF, fontSize: '13px', color: '#334455' }).setOrigin(0.5);
        }
      });

      y += 2 * (slotH + 8) + 8;
    }

    // Найм Частной Безопасности (active only) — 1 sec_destroyer + 3 sec_drone,
    // разово, навсегда, привязаны к этой базе (см. MiningBase.hireSecurity).
    if (isActive) {
      if (this.base.hiredSecurity) {
        this.add.text(cx, y + 5, '🛡 Охрана нанята', { ...TF, fontSize: '14px', color: '#4dd0e1' }).setOrigin(0.5);
        y += 26;
      } else if (isOwner) {
        const cost      = this.base.hireSecurityCost;
        const gs        = this.scene.get('GameScene');
        const canAfford = (gs?.starGold || 0) >= cost;
        const btnColor  = canAfford ? 0x2a1a0d : 0x1a1a10;
        const lblColor  = canAfford ? '#ffb74d' : '#665533';
        const btn = this.add.rectangle(cx, y + 26, W - PAD * 2, 62, btnColor)
          .setStrokeStyle(2, canAfford ? 0xff9800 : 0x665533, 0.9).setInteractive();
        this.add.text(cx, y + 14, 'НАНЯТЬ ОХРАНУ', { ...TF, fontSize: '16px', color: lblColor }).setOrigin(0.5);
        this.add.text(cx, y + 36, `${cost} ⭐  (у вас: ${Math.floor(gs?.starGold || 0)} ⭐)`, { ...TF, fontSize: '14px', color: canAfford ? '#ffcc44' : '#554422' }).setOrigin(0.5);
        if (canAfford) {
          btn.on('pointerover',  () => btn.setFillStyle(0x3a2412));
          btn.on('pointerout',   () => btn.setFillStyle(btnColor));
          btn.on('pointerdown',  (pointer, lx, ly, event) => {
            if (event) event.stopPropagation();
            const ok = this.base.hireSecurity(this.playerName);
            if (ok) this.scene.restart({ base: this.base, playerName: this.playerName });
          });
        }
        y += 70;
      }
    }

    this._closeBtn(cx, y + 23);
  }

  // ── Turret type picker ────────────────────────────────────────────────────

  _turretPicker(slotIdx) {
    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;
    const pw = 416, ph = 234;
    const created = [];

    const overlay = this.add.rectangle(cx, cy, width, height, 0x000000, 0.45).setInteractive();
    const bg      = this.add.rectangle(cx, cy, pw, ph, 0x080d18).setStrokeStyle(2, COLORS.primary, 0.9);
    created.push(overlay, bg);

    this.add.text(cx, cy - ph / 2 + 21, `СЛОТ ${slotIdx + 1} — выбор турели`, { ...TF, fontSize: '17px', color: '#4dd0e1' }).setOrigin(0.5);
    created.push(this.children.getAll().at(-1));

    const gs = this.scene.get('GameScene');
    const c2cost       = cannon2GoldCost(this.base.pvpTier);
    const c2affordable = (gs?.starGold || 0) >= c2cost;
    const c1affordable = (gs?.credits  || 0) >= BASE_CONFIG.turretCostCredits;

    const options = [
      { label: 'Cannon I  (одиночная)', desc: `${BASE_CONFIG.turretCostCredits.toLocaleString()} кр`, type: 'cannon1', ok: c1affordable },
      { label: 'Cannon II (спаренная)', desc: `${c2cost} ⭐`,                                          type: 'cannon2', ok: c2affordable },
    ];
    options.forEach((opt, i) => {
      const by      = cy - 26 + i * 68;
      const fillClr = opt.ok ? 0x101c28 : 0x120d0d;
      const brdClr  = opt.ok ? 0x336688 : 0x442222;
      const txtClr  = opt.ok ? '#ccddee' : '#664444';
      const subClr  = opt.ok ? (opt.type === 'cannon2' ? '#ffcc44' : '#556677') : '#443333';
      const btn = this.add.rectangle(cx, by, pw - 62, 55, fillClr).setStrokeStyle(1, brdClr, 0.8).setInteractive();
      const lbl = this.add.text(cx, by - 10, opt.label, { ...TF, fontSize: '17px', color: txtClr }).setOrigin(0.5);
      const sub = this.add.text(cx, by + 12, opt.desc,  { ...TF, fontSize: '14px', color: subClr }).setOrigin(0.5);
      created.push(btn, lbl, sub);
      if (opt.ok) {
        btn.on('pointerover',  () => btn.setFillStyle(0x1a2e40));
        btn.on('pointerout',   () => btn.setFillStyle(fillClr));
        btn.on('pointerdown',  (pointer, lx, ly, event) => {
          if (event) event.stopPropagation();
          created.forEach(o => o?.destroy());
          this.base.buyTurret(slotIdx, opt.type, this.playerName);
          this.scene.restart({ base: this.base, playerName: this.playerName });
        });
      }
    });

    const cancel = this.add.text(cx, cy + ph / 2 - 21, 'Отмена', { ...TF, fontSize: '16px', color: '#445566' }).setOrigin(0.5).setInteractive();
    created.push(cancel);
    cancel.on('pointerdown',  (pointer, lx, ly, event) => { if (event) event.stopPropagation(); created.forEach(o => o?.destroy()); });
    overlay.on('pointerdown', (pointer, lx, ly, event) => { if (event) event.stopPropagation(); created.forEach(o => o?.destroy()); });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _panel(cx, cy, w, h) {
    const g = this.add.graphics();
    g.fillStyle(0x060b16, 0.97); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 8);
    g.lineStyle(2, COLORS.primary, 0.85); g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 8);
  }

  _closeBtn(cx, y) {
    const bg = this.add.rectangle(cx, y, 208, 48, 0x0c1622).setStrokeStyle(1, COLORS.primary, 0.75).setInteractive();
    this.add.text(cx, y, 'ЗАКРЫТЬ', { ...TF, fontSize: '16px', color: '#3ac0d0' }).setOrigin(0.5);
    bg.on('pointerover',  () => bg.setFillStyle(0x162638));
    bg.on('pointerout',   () => bg.setFillStyle(0x0c1622));
    bg.on('pointerdown',  (pointer, lx, ly, event) => { if (event) event.stopPropagation(); this.scene.stop(); });
  }

  _stateText() {
    const b = this.base;
    if (b.state === 'building') {
      // b._buildEndsAt — абсолютный timestamp (см. MiningBase._buildEndsAtFromSaved),
      // не накопительный таймер, отражает реально прошедшее время даже после дисконнекта.
      const rem = Math.ceil(Math.max(0, b._buildEndsAt - Date.now()) / 1000);
      const m = Math.floor(rem / 60), s = rem % 60;
      return `СТРОИТСЯ — ${m}:${String(s).padStart(2, '0')} до завершения`;
    }
    if (b.corp === 'neutral') {
      const remSec = Math.max(0, Math.ceil((b._neutralPhaseEndsAt - Date.now()) / 1000));
      const mm = Math.floor(remSec / 60), ss = remSec % 60;
      const timeStr = `${mm}:${String(ss).padStart(2, '0')}`;
      return b._neutralPhase === 'immune' ? `НЕЙТРАЛЬНА  ·  иммунитет — ${timeStr}` : `НЕЙТРАЛЬНА  ·  открыта для захвата — ${timeStr}`;
    }
    return 'АКТИВНА';
  }
}
