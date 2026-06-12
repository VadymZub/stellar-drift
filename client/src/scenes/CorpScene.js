import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import MiningBase from '../entities/MiningBase.js';
import { galaxy } from '../galaxy.js';

const TF = { fontFamily: 'Orbitron', resolution: UI_RES };

const CORP_META = {
  helios:  { label: 'HELIOS',  color: '#ffb74d', hex: 0xffb74d, fill: 0x1a1200 },
  karax:   { label: 'KARAX',   color: '#ef5350', hex: 0xef5350, fill: 0x1a0000 },
  tides:   { label: 'TIDES',   color: '#4dd0e1', hex: 0x4dd0e1, fill: 0x001a1e },
  neutral: { label: 'НЕЙТРАЛ',color: '#90a4ae', hex: 0x90a4ae, fill: 0x0d1219 },
};

// Mock leaderboard — stable values, consistent across restarts
const MOCK_PLAYERS = [
  { name: 'NovaStar',    xp: 2780000, honor: 980000, corp: 'helios' },
  { name: 'VoidRunner',  xp: 2650000, honor: 870000, corp: 'karax'  },
  { name: 'StormEagle',  xp: 2520000, honor: 920000, corp: 'tides'  },
  { name: 'IronPilot',   xp: 2410000, honor: 750000, corp: 'helios' },
  { name: 'DarkMatter',  xp: 2300000, honor: 830000, corp: 'karax'  },
  { name: 'StarForge',   xp: 2180000, honor: 710000, corp: 'tides'  },
  { name: 'EchoWarden',  xp: 2050000, honor: 690000, corp: 'helios' },
  { name: 'PulseRider',  xp: 1920000, honor: 660000, corp: 'karax'  },
  { name: 'CrystalVeil', xp: 1800000, honor: 640000, corp: 'tides'  },
  { name: 'NebulaCraft', xp: 1680000, honor: 600000, corp: 'helios' },
];

// Mock corp baseline XP totals (real base points added on top)
const CORP_MOCK_POINTS = { helios: 8400, karax: 7200, tides: 6100 };

// Starting (home) sector for each corp — player is teleported here on corp switch
const CORP_HOME = { helios: 'helios_1', karax: 'karax_1', tides: 'tides_1' };

function switchCost(n) {
  if (n === 0) return 100;
  if (n === 1) return 300;
  return 1000;
}

export default class CorpScene extends Phaser.Scene {
  constructor() { super('CorpScene'); }

  create() {
    const { width: W, height: H } = this.scale;
    const gs = this.scene.get('GameScene');

    // Dark overlay
    this.add.rectangle(0, 0, W, H, 0x000000, 0.65).setOrigin(0);

    // Panel
    const pw = Math.min(920, W - 40);
    const ph = Math.min(660, H - 40);
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;

    const g = this.add.graphics();
    g.fillStyle(0x080c18, 0.97);  g.fillRoundedRect(px, py, pw, ph, 10);
    g.lineStyle(2, COLORS.primary, 0.8); g.strokeRoundedRect(px, py, pw, ph, 10);

    const playerCorp = gs?.playerCorp || 'neutral';
    const cm = CORP_META[playerCorp];

    // Title row
    this.add.text(px + 22, py + 18, 'КОРПОРАЦИИ', { ...TF, fontSize: '22px', color: '#4dd0e1' });
    this.add.text(px + pw - 22, py + 18, `Ваша корп: ${cm.label}`,
      { ...TF, fontSize: '14px', color: cm.color }).setOrigin(1, 0);

    // Divider
    const dg = this.add.graphics();
    dg.lineStyle(1, 0x182838, 1);
    dg.strokeLineShape(new Phaser.Geom.Line(px + 8, py + 52, px + pw - 8, py + 52));

    // Tabs
    const TABS = ['ТОП XP', 'ТОП PvP', 'КОРПОРАЦИИ', 'СМЕНИТЬ КОРП'];
    const tabW = Math.floor((pw - 16) / TABS.length);
    const tabY = py + 57;
    this._tabBgs  = [];
    this._tabTxts = [];
    this._tab     = -1;
    this._objs    = [];

    TABS.forEach((label, i) => {
      const tx = px + 8 + i * tabW + tabW / 2;
      const bg = this.add.rectangle(tx, tabY + 14, tabW - 4, 28, 0x0d1a26)
        .setStrokeStyle(1, 0x1e3a50, 1).setInteractive({ useHandCursor: true });
      const txt = this.add.text(tx, tabY + 14, label, { ...TF, fontSize: '13px', color: '#557799' }).setOrigin(0.5);
      this._tabBgs.push(bg);
      this._tabTxts.push(txt);
      bg.on('pointerdown', () => this._tab !== i && this._showTab(i, px, tabY + 34, pw, gs));
      bg.on('pointerover',  () => { if (this._tab !== i) bg.setFillStyle(0x142233); });
      bg.on('pointerout',   () => { if (this._tab !== i) bg.setFillStyle(0x0d1a26); });
    });

    this._showTab(0, px, tabY + 34, pw, gs);

    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());
    this.input.keyboard.on('keydown-H',   () => this.scene.stop());
  }

  _showTab(idx, px, cy, pw, gs) {
    this._objs.forEach(o => o?.destroy());
    this._objs = [];
    this._tab  = idx;

    this._tabBgs.forEach((bg, i) => {
      const on = i === idx;
      bg.setFillStyle(on ? 0x0a2035 : 0x0d1a26);
      bg.setStrokeStyle(1, on ? COLORS.primary : 0x1e3a50, 1);
      this._tabTxts[i].setColor(on ? '#4dd0e1' : '#557799');
    });

    const draw = [this._drawXp, this._drawPvp, this._drawStandings, this._drawSwitch];
    draw[idx].call(this, px, cy, pw, gs);
  }

  // ── Tab 0: Top XP ───────────────────────────────────────────────────────────

  _drawXp(px, cy, pw, gs) {
    const me = { name: gs?.playerName || 'You', xp: gs?.pilotXp || 0, honor: gs?.pilotHonor || 0, corp: gs?.playerCorp || 'neutral', level: gs?.pilotLevel || 1, isMe: true };
    const all = [...MOCK_PLAYERS.map(p => ({ ...p, level: Math.min(50, 1 + Math.floor(p.xp / 100000)) })), me]
      .sort((a, b) => b.xp - a.xp);

    this._sectionTitle(px + pw / 2, cy + 8, 'ТОП ИГРОКОВ ПО ОПЫТУ');
    this._rowHdr(px, cy + 26, pw, ['#', 'ИМЯ', 'УРОВЕНЬ', 'КОРП', 'ОПЫТ'],
      [20, 58, pw - 270, pw - 170, pw - 60]);

    let y = cy + 46;
    all.slice(0, 12).forEach((p, i) => {
      const c    = CORP_META[p.corp] || CORP_META.neutral;
      const clr  = p.isMe ? '#4dd0e1' : (i < 3 ? '#ffcc44' : '#aabbcc');
      const xpK  = `${Math.round(p.xp / 1000)}k`;
      const data = [`${i + 1}.`, (p.isMe ? '▶ ' : '') + p.name, `${p.level}`, c.label, xpK];
      const row  = this._row(px, y, pw, data, [20, 58, pw - 270, pw - 170, pw - 60], clr);
      // Corp column gets corp color
      row[3]?.setColor(c.color);
      y += 28;
    });
  }

  // ── Tab 1: Top PvP ──────────────────────────────────────────────────────────

  _drawPvp(px, cy, pw, gs) {
    const me = { name: gs?.playerName || 'You', xp: gs?.pilotXp || 0, honor: gs?.pilotHonor || 0, corp: gs?.playerCorp || 'neutral', isMe: true };
    const all = [...MOCK_PLAYERS, me].sort((a, b) => b.honor - a.honor);

    this._sectionTitle(px + pw / 2, cy + 8, 'ТОП ИГРОКОВ ПО PvP (ЧЕСТЬ)');
    this._rowHdr(px, cy + 26, pw, ['#', 'ИМЯ', 'КОРП', 'ОЧКИ ЧЕСТИ'],
      [20, 58, pw - 230, pw - 80]);

    let y = cy + 46;
    all.slice(0, 12).forEach((p, i) => {
      const c   = CORP_META[p.corp] || CORP_META.neutral;
      const clr = p.isMe ? '#4dd0e1' : (i < 3 ? '#ffcc44' : '#aabbcc');
      const data = [`${i + 1}.`, (p.isMe ? '▶ ' : '') + p.name, c.label, `${Math.round(p.honor / 1000)}k`];
      const row  = this._row(px, y, pw, data, [20, 58, pw - 230, pw - 80], clr);
      row[2]?.setColor(c.color);
      y += 28;
    });
  }

  // ── Tab 2: Corp standings ───────────────────────────────────────────────────

  _drawStandings(px, cy, pw, gs) {
    // Aggregate real base data on top of mock baseline
    const pts   = { helios: CORP_MOCK_POINTS.helios, karax: CORP_MOCK_POINTS.karax, tides: CORP_MOCK_POINTS.tides };
    const bases = { helios: 0, karax: 0, tides: 0 };
    for (const d of MiningBase.registry.values()) {
      if (d.corp && d.corp !== 'neutral') {
        pts[d.corp]   = (pts[d.corp]   || 0) + Math.floor(d.pointsBanked || 0);
        if (d.state === 'active') bases[d.corp] = (bases[d.corp] || 0) + 1;
      }
    }

    const sorted = ['helios', 'karax', 'tides']
      .map(c => ({ c, meta: CORP_META[c], pts: pts[c], bases: bases[c] || 0 }))
      .sort((a, b) => b.pts - a.pts);

    this._sectionTitle(px + pw / 2, cy + 8, 'ОЧКИ КОРПОРАЦИЙ');

    const cardW  = Math.floor((pw - 60) / 3);
    const cardH  = 220;
    const cardY  = cy + 30;
    const playerC = gs?.playerCorp || 'neutral';

    sorted.forEach(({ c, meta, pts: p, bases: b }, i) => {
      const cx = px + 20 + i * (cardW + 10) + cardW / 2;
      const isMe = c === playerC;

      const card = this.add.rectangle(cx, cardY + cardH / 2, cardW, cardH, meta.fill)
        .setStrokeStyle(2, meta.hex, isMe ? 1.0 : 0.35);
      this._objs.push(card);

      const rankLabel = ['1.  ⭐', '2.', '3.'][i];
      const t1 = this.add.text(cx, cardY + 26, rankLabel, { ...TF, fontSize: '20px', color: meta.color }).setOrigin(0.5);
      const t2 = this.add.text(cx, cardY + 62, meta.label, { ...TF, fontSize: '22px', color: meta.color }).setOrigin(0.5);
      const t3 = this.add.text(cx, cardY + 100, Math.floor(p).toLocaleString(), { ...TF, fontSize: '20px', color: '#ccddee' }).setOrigin(0.5);
      const t4 = this.add.text(cx, cardY + 124, 'очков', { ...TF, fontSize: '12px', color: '#334455' }).setOrigin(0.5);
      const t5 = this.add.text(cx, cardY + 152, `Баз активных: ${b}`, { ...TF, fontSize: '12px', color: '#445566' }).setOrigin(0.5);
      this._objs.push(t1, t2, t3, t4, t5);

      if (isMe) {
        const badge = this.add.text(cx, cardY + 186, '▶ ВЫ', { ...TF, fontSize: '14px', color: meta.color }).setOrigin(0.5);
        this._objs.push(badge);
      }
    });
  }

  // ── Tab 3: Switch corp ──────────────────────────────────────────────────────

  _drawSwitch(px, cy, pw, gs) {
    const switchCount = gs?.corpSwitchCount || 0;
    const cost        = switchCost(switchCount);
    const balance     = gs?.starGold || 0;
    const canAfford   = balance >= cost;
    const playerCorp  = gs?.playerCorp || 'neutral';
    const cm          = CORP_META[playerCorp];

    this._sectionTitle(px + pw / 2, cy + 8, 'СМЕНИТЬ КОРПОРАЦИЮ');

    // Current corp
    const t1 = this.add.text(px + pw / 2, cy + 36, `Текущая корпорация:  ${cm.label}`,
      { ...TF, fontSize: '18px', color: cm.color }).setOrigin(0.5);
    this._objs.push(t1);

    // Cost / balance
    const costClr = canAfford ? '#ffcc44' : '#884444';
    const t2 = this.add.text(px + pw / 2, cy + 64,
      `Стоимость перехода: ${cost} ⭐  (у вас: ${Math.floor(balance)} ⭐)`,
      { ...TF, fontSize: '15px', color: costClr }).setOrigin(0.5);
    this._objs.push(t2);

    // History / next-cost hint
    const nthLabel   = switchCount === 0 ? 'первый' : switchCount === 1 ? 'второй' : 'третий и далее';
    const nextCost   = switchCost(switchCount + 1);
    const t3 = this.add.text(px + pw / 2, cy + 88,
      `Переходов: ${switchCount}  (это будет ${nthLabel} — ${cost} ⭐)   ·   следующий: ${nextCost} ⭐`,
      { ...TF, fontSize: '12px', color: '#334455' }).setOrigin(0.5);
    this._objs.push(t3);

    // Corp cards
    const targets = ['helios', 'karax', 'tides'].filter(c => c !== playerCorp);
    const cardW   = Math.floor((pw - 20 - (targets.length - 1) * 14) / targets.length);
    const cardH   = 200;
    const cardY   = cy + 112;

    targets.forEach((corp, i) => {
      const meta   = CORP_META[corp];
      const cx     = px + 10 + i * (cardW + 14) + cardW / 2;
      const fill   = canAfford ? meta.fill : 0x0a0d12;
      const border = canAfford ? meta.hex  : 0x222222;

      const card = this.add.rectangle(cx, cardY + cardH / 2, cardW, cardH, fill)
        .setStrokeStyle(2, border, canAfford ? 0.9 : 0.3)
        .setInteractive({ useHandCursor: canAfford });
      this._objs.push(card);

      const tc  = canAfford ? meta.color : '#333';
      const tl1 = this.add.text(cx, cardY + 48,  meta.label,   { ...TF, fontSize: '26px', color: tc }).setOrigin(0.5);
      const tl2 = this.add.text(cx, cardY + 88,  `${cost} ⭐`, { ...TF, fontSize: '18px', color: canAfford ? '#ffcc44' : '#443333' }).setOrigin(0.5);
      const tl3 = this.add.text(cx, cardY + 138, canAfford ? '[ ВСТУПИТЬ ]' : '🔒 НЕДОСТАТОЧНО ⭐',
        { ...TF, fontSize: '14px', color: canAfford ? '#aabbcc' : '#443333' }).setOrigin(0.5);
      this._objs.push(tl1, tl2, tl3);

      if (canAfford) {
        card.on('pointerover',  () => card.setFillStyle(0x0f2840));
        card.on('pointerout',   () => card.setFillStyle(fill));
        card.on('pointerdown',  () => this._confirmSwitch(corp, cost, switchCount, gs));
      }
    });
  }

  // Modal confirmation dialog for corp switch
  _confirmSwitch(corp, cost, switchCount, gs) {
    const { width: W, height: H } = this.scale;
    const cx = W / 2, cy = H / 2;
    const pw = 480, ph = 280;
    const created = [];

    const nextCost = switchCost(switchCount + 1);
    const meta     = CORP_META[corp];

    // Full dim that cancels on click
    const dim = this.add.rectangle(cx, cy, W, H, 0x000000, 0.55)
      .setDepth(20).setInteractive();
    created.push(dim);

    // Dialog panel
    const panel = this.add.rectangle(cx, cy, pw, ph, 0x060c18)
      .setStrokeStyle(2, meta.hex, 0.9).setDepth(21);
    created.push(panel);

    // Title
    const title = this.add.text(cx, cy - ph / 2 + 28, `ВСТУПИТЬ В ${meta.label}?`,
      { ...TF, fontSize: '20px', color: meta.color }).setOrigin(0.5).setDepth(22);
    created.push(title);

    // Cost line
    const costLbl = this.add.text(cx, cy - 44,
      `Будет списано: ${cost} ⭐`,
      { ...TF, fontSize: '16px', color: '#ffcc44' }).setOrigin(0.5).setDepth(22);
    created.push(costLbl);

    // Warning about next switch
    const warnLbl = this.add.text(cx, cy - 14,
      `Следующая смена корпорации будет стоить ${nextCost} ⭐`,
      { ...TF, fontSize: '12px', color: '#664422' }).setOrigin(0.5).setDepth(22);
    created.push(warnLbl);

    const close = () => created.forEach(o => o?.destroy());

    // CONFIRM button
    const confirmBg = this.add.rectangle(cx - 90, cy + 76, 160, 44, 0x0a2a10)
      .setStrokeStyle(2, 0x44aa55, 0.9).setDepth(22).setInteractive({ useHandCursor: true });
    const confirmTxt = this.add.text(cx - 90, cy + 76, 'ПОДТВЕРДИТЬ',
      { ...TF, fontSize: '14px', color: '#66cc77' }).setOrigin(0.5).setDepth(23);
    created.push(confirmBg, confirmTxt);

    confirmBg.on('pointerover',  () => confirmBg.setFillStyle(0x103a18));
    confirmBg.on('pointerout',   () => confirmBg.setFillStyle(0x0a2a10));
    confirmBg.on('pointerdown',  () => {
      close();
      gs.playerCorp      = corp;
      gs.corpSwitchCount = (gs.corpSwitchCount || 0) + 1;
      gs.starGold        = Math.floor((gs.starGold || 0) - cost);
      // Teleport to new corp's home sector
      galaxy.current = CORP_HOME[corp] || 'helios_1';
      this.scene.stop();        // close CorpScene overlay
      gs.scene.restart();       // restart GameScene in the new sector (player spawns at center)
    });

    // CANCEL button
    const cancelBg = this.add.rectangle(cx + 90, cy + 76, 160, 44, 0x111828)
      .setStrokeStyle(2, 0x334466, 0.9).setDepth(22).setInteractive({ useHandCursor: true });
    const cancelTxt = this.add.text(cx + 90, cy + 76, 'ОТМЕНА',
      { ...TF, fontSize: '14px', color: '#557799' }).setOrigin(0.5).setDepth(23);
    created.push(cancelBg, cancelTxt);

    cancelBg.on('pointerover',  () => cancelBg.setFillStyle(0x1a2838));
    cancelBg.on('pointerout',   () => cancelBg.setFillStyle(0x111828));
    cancelBg.on('pointerdown',  () => close());

    dim.on('pointerdown', () => close());
  }

  // ── Shared helpers ───────────────────────────────────────────────────────────

  _sectionTitle(x, y, text) {
    const t = this.add.text(x, y, text, { ...TF, fontSize: '15px', color: '#4a6a7a' }).setOrigin(0.5, 0);
    this._objs.push(t);
  }

  _rowHdr(px, y, pw, labels, xOffsets) {
    labels.forEach((lbl, i) => {
      const t = this.add.text(px + xOffsets[i], y, lbl, { ...TF, fontSize: '11px', color: '#334455' })
        .setOrigin(i === labels.length - 1 ? 1 : 0, 0.5);
      this._objs.push(t);
    });
  }

  _row(px, y, pw, data, xOffsets, color) {
    return data.map((val, i) => {
      const t = this.add.text(px + xOffsets[i], y, String(val),
        { ...TF, fontSize: '15px', color })
        .setOrigin(i === data.length - 1 ? 1 : 0, 0.5);
      this._objs.push(t);
      return t;
    });
  }
}
