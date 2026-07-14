import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';
import { CONSUMABLES, addConsumableToInventory, countConsumableInInventory, AMMO_ICON } from '../items.js';
import { prerenderTex } from '../utils/prerenderTex.js';

// Обмен золота на опыт — 3× дороже фарма (типичный данж-килл: ~100 XP за ~3 ⭐,
// см. GameScene.onMobKilled/rollStarGold — курс не константа, варьируется по
// мобу/данжу, это калиброванный якорь) ⇒ 100 XP из магазина стоит 9 ⭐.
const XP_GOLD_PER_100XP = 9;
const XP_PRESETS = [1000, 5000, 20000];

// Обмен золота на кредиты — курс взят из уже существующего паритета цен в
// магазине (см. AMMO_ITEMS ниже: ammo_plasma 1000шт/10000кр vs ammo_plasma_elite
// 1000шт/10⭐ — тот же товар, та же цена ⇒ 1⭐ ≈ 1000кр). Без ограничения по сумме
// (в отличие от опыта — там верхняя граница 40 уровня) — только по балансу.
const GOLD_TO_CREDITS_RATE = 1000;
const GOLD_EXCHANGE_STEPS = [1, 10, 100];

const GOLD_PACK = 10;

const BOOSTERS = [
  { key: 'boost_damage', consumableKey: 'damage_booster', label: 'Усилитель урона',  desc: '+10% к урону',        color: 0xff6d00, icon: '⚔' },
  { key: 'boost_hull',   consumableKey: 'hull_booster',   label: 'Усилитель брони',  desc: '+20% к прочности',    color: 0x4fc3f7, icon: '🛡' },
  { key: 'boost_shield', consumableKey: 'shield_booster', label: 'Усилитель щита',   desc: '+20% к щиту',         color: 0x4db6ac, icon: '💠' },
  { key: 'boost_xp',    consumableKey: 'xp_booster',      label: 'Усилитель опыта',  desc: '+25% к получению XP', color: 0xffd54f, icon: '⚡' },
];
const BOOSTER_CONSUMABLE_TYPES = new Set(BOOSTERS.map(b => b.consumableKey));

const WEAPON_PLACEHOLDERS = [
  { label: 'Плазменная пушка T1', desc: 'Стандартное вооружение' },
  { label: 'Двигатель T1',         desc: 'Базовый маршевый' },
  { label: 'Дефлектор T1',         desc: 'Щитовой генератор' },
  { label: 'Броня T1',             desc: 'Корпусная броня' },
];

export default class ShopScene extends Phaser.Scene {
  constructor() { super('ShopScene'); }

  O(s, c) { return { fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }
  F(s, c) { return { fontFamily: 'Inter, sans-serif',    fontSize: s, color: c, resolution: UI_RES }; }

  create() {
    const W = this.scale.width, H = this.scale.height;
    const gs = this.scene.get('GameScene');
    this._gs = gs;

    if (this.textures.exists('bg_shop')) {
      const _bg = this.add.image(W / 2, H / 2, 'bg_shop');
      _bg.setScale(Math.max(W / _bg.width, H / _bg.height)).setAlpha(0.8);
    } else {
      this.add.rectangle(0, 0, W, H, 0x060d18, 1).setOrigin(0);
    }

    const pw = Math.min(1140, W - 24), ph = Math.min(700, H - 24);
    const px = (W - pw) / 2, py = (H - ph) / 2;
    this._px = px; this._py = py; this._pw = pw; this._ph = ph;

    // Panel background
    const g = this.add.graphics();
    g.fillStyle(0x080e1c, 0.97); g.fillRoundedRect(px, py, pw, ph, 14);
    g.lineStyle(2, COLORS.amber, 0.9); g.strokeRoundedRect(px, py, pw, ph, 14);

    // Header row
    this.add.text(px + 34, py + 16, 'МАГАЗИН', this.O('20px', '#ffb74d'));
    this.add.text(px + pw - 30, py + 22, 'ESC', this.F('13px', '#445566')).setOrigin(1, 0);

    // Donate button (top-right, above tabs)
    const donW = 180, donH = 26, donX = px + pw - 160, donY = py + 10;
    const donBtn = this.add.rectangle(donX, donY + donH / 2, donW, donH, 0x1a1000)
      .setStrokeStyle(1.5, 0xffd54f, 0.85).setInteractive({ useHandCursor: true });
    this.add.text(donX, donY + donH / 2, '⭐ ДОНАТ МАГАЗИН  ▶', this.O('10px', '#ffd54f')).setOrigin(0.5);
    donBtn.on('pointerover', () => donBtn.setFillStyle(0x2e2000));
    donBtn.on('pointerout',  () => donBtn.setFillStyle(0x1a1000));
    donBtn.on('pointerdown', () => { this.scene.stop(); this.scene.launch('DonateScene'); });

    // Balance display
    const credTxt = this.add.text(px + pw / 2 - 80, py + 20, '', this.O('13px', '#ffd54f')).setOrigin(0, 0);
    const goldTxt = this.add.text(px + pw / 2 + 40, py + 20, '', this.O('13px', '#ffd54f')).setOrigin(0, 0);
    this._refresh = () => {
      credTxt.setText(`💰 ${(gs.credits || 0).toLocaleString()} кр.`);
      goldTxt.setText(`⭐ ${gs.starGold || 0}`);
    };
    this._refresh();

    // ── Tab strip ────────────────────────────────────────────────────────────
    const TABS = ['РАСХОДНИКИ И БОЕПРИПАСЫ', 'БУСТЕРЫ', 'ОБМЕН', 'ВООРУЖЕНИЕ'];
    const tabY = py + 46, tabH = 30;
    // Tabs occupy left portion, donate button occupies right ~320px
    const tabAreaW = pw - 340;
    const tabGap = 8;
    const tabW = Math.floor((tabAreaW - (TABS.length - 1) * tabGap) / TABS.length);
    const tabStartX = px + 20;

    this._activeTab = -1;
    this._tabObjects = [];
    this._tabBgs = [];
    this._tabTxts = [];

    const switchTab = (idx) => {
      if (idx === this._activeTab) return;
      this._activeTab = idx;
      this._tabBgs.forEach((bg, i) => {
        const a = i === idx;
        bg.setFillStyle(a ? 0x1a3a54 : 0x0c1828);
        bg.setStrokeStyle(1, a ? 0x4a8aaa : 0x1a3a54, 1);
      });
      this._tabTxts.forEach((t, i) => t.setColor(i === idx ? '#7abccc' : '#3a6a80'));
      this._tabObjects.forEach(o => { try { o.destroy(); } catch (_) {} });
      this._tabObjects = [];
      if (idx === 0) this._renderConsumables();
      if (idx === 1) this._renderBoosters();
      if (idx === 2) this._renderExchangeTab();
      if (idx === 3) this._renderWeapons();
    };

    TABS.forEach((label, i) => {
      const tx = tabStartX + i * (tabW + tabGap) + tabW / 2;
      const bg = this.add.rectangle(tx, tabY + tabH / 2, tabW, tabH, 0x0c1828)
        .setStrokeStyle(1, 0x1a3a54, 1).setInteractive({ useHandCursor: true });
      const txt = this.add.text(tx, tabY + tabH / 2, label, this.O('10px', '#3a6a80')).setOrigin(0.5);
      this._tabBgs.push(bg); this._tabTxts.push(txt);
      bg.on('pointerover', () => { if (i !== this._activeTab) bg.setFillStyle(0x142a40); });
      bg.on('pointerout',  () => { if (i !== this._activeTab) bg.setFillStyle(0x0c1828); });
      bg.on('pointerdown', () => switchTab(i));
    });

    // Divider below tabs
    const divG = this.add.graphics();
    divG.lineStyle(1, 0x1a3a54, 0.7);
    divG.beginPath();
    divG.moveTo(px + 10, tabY + tabH + 4);
    divG.lineTo(px + pw - 10, tabY + tabH + 4);
    divG.strokePath();

    switchTab(0);
    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());
  }

  // Top of content area (below tab strip + divider)
  _cy0() { return this._py + 46 + 30 + 10; }

  // ── Tab: РАСХОДНИКИ И БОЕПРИПАСЫ ─────────────────────────────────────────
  _renderConsumables() {
    const { _px: px, _pw: pw, _gs: gs } = this;
    const ob = this._tabObjects;
    const cy0 = this._cy0();

    ob.push(this.add.text(px + 34, cy0 + 4, 'РАСХОДНИКИ', this.O('12px', '#4dd0e1')));

    const buyable = Object.entries(CONSUMABLES)
      .filter(([type, d]) => d.canBuy && d.category !== 'ammo' && !BOOSTER_CONSUMABLE_TYPES.has(type))
      .map(([type, def]) => ({ type, ...def }));

    const COLS = 4, CW = 220, CH = 270, GAP = 18;
    const gridW = COLS * CW + (COLS - 1) * GAP;
    const gx = px + (pw - gridW) / 2;
    const rowY = cy0 + 28;

    buyable.forEach((item, i) => {
      const col = i % COLS, row = Math.floor(i / COLS);
      this._drawCard(gx + col * (CW + GAP), rowY + row * (CH + 16), CW, CH, item, gs);
    });

    // Ammo sub-section
    const rows = Math.ceil(buyable.length / COLS);
    const ammoY = rowY + rows * (CH + 16) + 6;
    ob.push(this.add.text(px + 34, ammoY, 'БОЕПРИПАСЫ', this.O('12px', '#ffb74d')));

    const AMMO_ITEMS = [
      { type: 'ammo_plasma',       qty: 1000, price: 10000, currency: 'credits' },
      { type: 'ammo_plasma_elite', qty: 1000, price: 10,    currency: 'gold'    },
      { type: 'ammo_laser',        qty: 1000, price: 15,    currency: 'gold'    },
    ];
    const agridW = AMMO_ITEMS.length * CW + (AMMO_ITEMS.length - 1) * GAP;
    const ax = px + (pw - agridW) / 2;
    AMMO_ITEMS.forEach((item, i) => {
      this._drawAmmoCard(ax + i * (CW + GAP), ammoY + 26, CW, CH, item, gs);
    });
  }

  // ── Tab: БУСТЕРЫ ──────────────────────────────────────────────────────────
  _renderBoosters() {
    const { _px: px, _pw: pw, _gs: gs } = this;
    const ob = this._tabObjects;
    const cy0 = this._cy0();

    ob.push(this.add.text(px + 34, cy0 + 4, 'БУСТЕРЫ — действие 1 час', this.O('12px', '#4dd0e1')));

    const CW = 220, CH = 270, GAP = 18;
    const gridW = BOOSTERS.length * CW + (BOOSTERS.length - 1) * GAP;
    const gx = px + (pw - gridW) / 2;
    const cardsY = cy0 + 30;

    BOOSTERS.forEach((b, i) => {
      this._drawBoosterCard(gx + i * (CW + GAP), cardsY, CW, CH, b, gs);
    });
  }

  // ── Tab: ОБМЕН (золото → опыт / золото → кредиты) ────────────────────────
  _renderExchangeTab() {
    const bottomY = this._renderXpExchange();
    this._renderCreditsExchange(bottomY + 26);
  }

  // Обмен золота на опыт — возвращает нижнюю границу занятой области (нужно
  // разделу обмена на кредиты ниже, чтобы не наложиться).
  _renderXpExchange() {
    const { _px: px, _pw: pw, _gs: gs } = this;
    const ob = this._tabObjects;
    const cy0 = this._cy0();
    const cap = gs.xpBuyCap();

    ob.push(this.add.text(px + 34, cy0 + 4, 'ОБМЕН ЗОЛОТА НА ОПЫТ', this.O('12px', '#4dd0e1')));

    if (cap.locked) {
      ob.push(this.add.text(px + 34, cy0 + 26,
        `Доступно только до 40 уровня пилота (сейчас ${gs.pilotLevel}) — обмен закрыт`,
        this.F('12px', '#5a4030')));
      return cy0 + 26;
    }
    ob.push(this.add.text(px + 34, cy0 + 26,
      `До 40 уровня можно докупить ещё ${cap.remaining.toLocaleString()} XP · курс ×3 от типичного фарма`,
      this.F('12px', '#4a7a90')));

    const CW = 220, CH = 270, GAP = 18;
    const xpItems = [...XP_PRESETS, 'max'];
    const gridW = xpItems.length * CW + (xpItems.length - 1) * GAP;
    const gx = px + (pw - gridW) / 2;
    const cardsY = cy0 + 48;
    xpItems.forEach((preset, i) => {
      this._drawXpCard(gx + i * (CW + GAP), cardsY, CW, CH, preset, cap, gs);
    });
    return cardsY + CH;
  }

  // Обмен золота на кредиты — без верхней границы (в отличие от опыта), сумма
  // набирается степпером +/- и подтверждается диалогом (см. _showConfirm)
  // КАЖДЫЙ раз перед списанием, как и было явно запрошено.
  _renderCreditsExchange(y) {
    const { _px: px, _pw: pw, _gs: gs } = this;
    const ob = this._tabObjects;

    ob.push(this.add.text(px + 34, y, 'ОБМЕН ЗОЛОТА НА КРЕДИТЫ', this.O('12px', '#4dd0e1')));
    ob.push(this.add.text(px + 34, y + 22,
      `Курс: 1 ⭐ = ${GOLD_TO_CREDITS_RATE.toLocaleString()} кр. · без ограничения по сумме (кроме баланса)`,
      this.F('12px', '#4a7a90')));

    const gold = gs.starGold || 0;
    if (this._goldExchangeAmount === undefined) this._goldExchangeAmount = Math.min(10, gold);
    this._goldExchangeAmount = Math.max(0, Math.min(this._goldExchangeAmount, gold));
    const amt = this._goldExchangeAmount;

    const panelY = y + 46, panelH = 96, panelW = Math.min(560, pw - 68);
    const panelX = px + (pw - panelW) / 2;
    const gfx = this.add.graphics();
    gfx.fillStyle(0x0c1a2e, 0.97); gfx.fillRoundedRect(panelX, panelY, panelW, panelH, 10);
    gfx.lineStyle(2, 0xffd54f, 0.7); gfx.strokeRoundedRect(panelX, panelY, panelW, panelH, 10);
    ob.push(gfx);

    const rowY = panelY + 18;
    const amtTxt = this.add.text(panelX + panelW / 2, rowY, `${amt.toLocaleString()} ⭐`, this.O('16px', '#ffd54f')).setOrigin(0.5);
    ob.push(amtTxt);

    const previewTxt = this.add.text(panelX + panelW / 2, rowY + 24,
      `Получите: ${(amt * GOLD_TO_CREDITS_RATE).toLocaleString()} кр.`, this.F('12px', '#6aacb8')).setOrigin(0.5);
    ob.push(previewTxt);

    const refreshAmt = () => {
      this._goldExchangeAmount = Math.max(0, Math.min(this._goldExchangeAmount, gs.starGold || 0));
      amtTxt.setText(`${this._goldExchangeAmount.toLocaleString()} ⭐`);
      previewTxt.setText(`Получите: ${(this._goldExchangeAmount * GOLD_TO_CREDITS_RATE).toLocaleString()} кр.`);
      exBtnTxt.setText(this._goldExchangeAmount > 0 ? `ОБМЕНЯТЬ — ${(this._goldExchangeAmount * GOLD_TO_CREDITS_RATE).toLocaleString()} кр.` : 'ОБМЕНЯТЬ');
    };

    // Степпер: -100/-10/-1 слева, +1/+10/+100 справа, MAX крайним справа
    const stepY = rowY + 46;
    const steps = [-100, -10, -1];
    steps.forEach((s, i) => {
      this._stepBtn(panelX + 24 + i * 44, stepY, 40, 26, `${s}`, () => {
        this._goldExchangeAmount = Math.max(0, Math.min((gs.starGold || 0), this._goldExchangeAmount + s));
        refreshAmt();
      });
    });
    GOLD_EXCHANGE_STEPS.forEach((s, i) => {
      this._stepBtn(panelX + panelW - 24 - (GOLD_EXCHANGE_STEPS.length - i) * 44 - 60, stepY, 40, 26, `+${s}`, () => {
        this._goldExchangeAmount = Math.max(0, Math.min((gs.starGold || 0), this._goldExchangeAmount + s));
        refreshAmt();
      });
    });
    this._stepBtn(panelX + panelW - 24 - 52, stepY, 60, 26, 'MAX', () => {
      this._goldExchangeAmount = gs.starGold || 0;
      refreshAmt();
    }, 0x1a2a3e, 0x4dd0e1);

    const btnW = 220, btnH = 34, btnX = panelX + panelW / 2, btnY = panelY + panelH + 18;
    const exBtn = this.add.rectangle(btnX, btnY, btnW, btnH, 0x2a1a00)
      .setStrokeStyle(1.5, 0xffd54f, 0.85).setInteractive({ useHandCursor: true });
    const exBtnTxt = this.add.text(btnX, btnY, '', this.O('11px', '#ffd54f')).setOrigin(0.5);
    ob.push(exBtn, exBtnTxt);
    refreshAmt();

    exBtn.on('pointerover', () => exBtn.setFillStyle(0x4a2a00));
    exBtn.on('pointerout',  () => exBtn.setFillStyle(0x2a1a00));
    exBtn.on('pointerdown', () => {
      const a = this._goldExchangeAmount;
      if (a <= 0 || a > (gs.starGold || 0)) return;
      const credits = a * GOLD_TO_CREDITS_RATE;
      this._showConfirm(`Обменять ${a.toLocaleString()} ⭐ на ${credits.toLocaleString()} кредитов?`, () => {
        gs.starGold -= a;
        gs.credits = (gs.credits || 0) + credits;
        gs._saveState?.();
        gs.log?.(`Обмен: −${a.toLocaleString()} ⭐  +${credits.toLocaleString()} кр.`);
        this._refresh();
        this._tabObjects.forEach(o => { try { o.destroy(); } catch (_) {} });
        this._tabObjects = [];
        this._renderExchangeTab();
      });
    });
  }

  // Маленькая кнопка степпера (+/-N, MAX)
  _stepBtn(cx, cy, w, h, label, onClick, bg = 0x1a1000, stroke = 0xffb74d) {
    const ob = this._tabObjects;
    const btn = this.add.rectangle(cx + w / 2, cy + h / 2, w, h, bg)
      .setStrokeStyle(1, stroke, 0.8).setInteractive({ useHandCursor: true });
    const txt = this.add.text(cx + w / 2, cy + h / 2, label, this.F('11px', '#e0c080')).setOrigin(0.5);
    ob.push(btn, txt);
    btn.on('pointerover', () => btn.setFillStyle(0x2e2000));
    btn.on('pointerout',  () => btn.setFillStyle(bg));
    btn.on('pointerdown', onClick);
    return btn;
  }

  // ── Подтверждение (обмен золота, необратимые операции) — тот же паттерн,
  // что и GarageScene._showConfirm, скопирован сюда: у ShopScene своего не было,
  // а обмен на кредиты явно должен спрашивать подтверждение КАЖДЫЙ раз.
  _showConfirm(message, onConfirm) {
    (this._confirmObjs || []).forEach(o => o?.destroy());
    this._confirmObjs = [];
    const W = this.scale.width, H = this.scale.height;
    const dw = 380, dh = 120;
    const dx = W / 2, dy = H / 2;
    const _close = () => {
      (this._confirmObjs || []).forEach(o => o?.destroy());
      this._confirmObjs = [];
    };
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55)
      .setDepth(149).setInteractive();
    const dlg = this.add.rectangle(dx, dy, dw, dh, 0x060e1c, 1)
      .setStrokeStyle(1, 0xffd54f, 1).setDepth(150);
    const msg = this.add.text(dx, dy - dh / 2 + 16, message,
      { ...this.F('12px', '#e0f0ff'), wordWrap: { width: dw - 28 }, align: 'center' })
      .setOrigin(0.5, 0).setDepth(151);
    const btnW = 130, btnH = 30;
    const cfmBg = this.add.rectangle(dx - 78, dy + 34, btnW, btnH, 0x0a2010, 1)
      .setStrokeStyle(1, 0x44bb66, 1).setDepth(150).setInteractive({ useHandCursor: true });
    const cfmT = this.add.text(dx - 78, dy + 34, 'Подтвердить',
      this.F('12px', '#44bb66')).setOrigin(0.5).setDepth(151);
    cfmBg.on('pointerover', () => cfmBg.setAlpha(0.7));
    cfmBg.on('pointerout',  () => cfmBg.setAlpha(1));
    cfmBg.on('pointerdown', () => { _close(); onConfirm(); });
    const cnlBg = this.add.rectangle(dx + 78, dy + 34, btnW, btnH, 0x18060a, 1)
      .setStrokeStyle(1, 0x995544, 1).setDepth(150).setInteractive({ useHandCursor: true });
    const cnlT = this.add.text(dx + 78, dy + 34, 'Отмена',
      this.F('12px', '#aa6655')).setOrigin(0.5).setDepth(151);
    cnlBg.on('pointerover', () => cnlBg.setAlpha(0.7));
    cnlBg.on('pointerout',  () => cnlBg.setAlpha(1));
    cnlBg.on('pointerdown', _close);
    this._confirmObjs.push(overlay, dlg, msg, cfmBg, cfmT, cnlBg, cnlT);
  }

  // ── XP-за-золото card (preset === 'max' ⇒ покупает весь остаток до 40 ур.) ──
  _drawXpCard(cx, cy, cw, ch, preset, cap, gs) {
    const ob = this._tabObjects;
    const buyXp = Math.max(0, Math.min(preset === 'max' ? cap.remaining : preset, cap.remaining));
    const price = Math.max(1, Math.ceil(buyXp * XP_GOLD_PER_100XP / 100));

    const gfx = this.add.graphics();
    gfx.fillStyle(0x0c1a2e, 0.97); gfx.fillRoundedRect(cx, cy, cw, ch, 10);
    gfx.lineStyle(2, 0xffd54f, 0.7); gfx.strokeRoundedRect(cx, cy, cw, ch, 10);
    ob.push(gfx);

    ob.push(this.add.text(cx + cw / 2, cy + 60, '⚡', { ...this.O('56px', '#ffd54f') }).setOrigin(0.5));
    ob.push(this.add.text(cx + cw / 2, cy + 132,
      preset === 'max' ? 'ВЕСЬ ОСТАТОК' : `${preset.toLocaleString()} XP`,
      { ...this.O('14px', '#e0f0ff'), wordWrap: { width: cw - 20 }, align: 'center' }).setOrigin(0.5, 0));
    ob.push(this.add.text(cx + cw / 2, cy + 158,
      preset === 'max' ? `${buyXp.toLocaleString()} XP` : 'до 40 уровня',
      this.F('12px', '#6aacb8')).setOrigin(0.5, 0));

    const btnH = 38, btnY = cy + ch - 48;
    const disabled = buyXp <= 0;
    const btn = this.add.rectangle(cx + cw / 2, btnY + btnH / 2, cw - 28, btnH, disabled ? 0x1a1a1a : 0x2a1a00)
      .setStrokeStyle(1.5, disabled ? 0x3a3a3a : 0xffd54f, 0.85);
    const btnTxt = this.add.text(cx + cw / 2, btnY + btnH / 2,
      disabled ? 'НЕДОСТУПНО' : `КУПИТЬ — ${price} ⭐`, this.O('10px', disabled ? '#5a5a5a' : '#ffd54f')).setOrigin(0.5);
    ob.push(btn, btnTxt);
    if (disabled) return;

    btn.setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setFillStyle(0x4a2a00));
    btn.on('pointerout',  () => btn.setFillStyle(0x2a1a00));
    btn.on('pointerdown', () => {
      if ((gs.starGold || 0) < price) {
        btn.setFillStyle(0x5a1010); this.time.delayedCall(300, () => btn.setFillStyle(0x2a1a00)); return;
      }
      gs.starGold -= price;
      gs._applyRawXp(buyXp);
      gs._saveState?.();
      gs.log?.(`Куплено: ${buyXp.toLocaleString()} XP −${price} ⭐`);
      this._refresh();
      this._tabObjects.forEach(o => { try { o.destroy(); } catch (_) {} });
      this._tabObjects = [];
      this._renderExchangeTab();
    });
  }

  // ── Tab: ВООРУЖЕНИЕ (заготовка) ───────────────────────────────────────────
  _renderWeapons() {
    const { _px: px, _pw: pw } = this;
    const ob = this._tabObjects;
    const cy0 = this._cy0();

    ob.push(this.add.text(px + 34, cy0 + 4, 'ВООРУЖЕНИЕ', this.O('12px', '#3a6a80')));
    ob.push(this.add.text(px + 34, cy0 + 22, 'Раздел в разработке — будет доступен в следующем обновлении',
      this.F('11px', '#2a4a5a')));

    const CW = 220, CH = 270, GAP = 18;
    const gridW = WEAPON_PLACEHOLDERS.length * CW + (WEAPON_PLACEHOLDERS.length - 1) * GAP;
    const gx = px + (pw - gridW) / 2;
    const cardsY = cy0 + 46;

    WEAPON_PLACEHOLDERS.forEach((item, i) => {
      const cx = gx + i * (CW + GAP);
      const g = this.add.graphics();
      g.fillStyle(0x090e18, 0.7); g.fillRoundedRect(cx, cardsY, CW, CH, 10);
      g.lineStyle(1, 0x1a2a3a, 0.5); g.strokeRoundedRect(cx, cardsY, CW, CH, 10);

      const nm = this.add.text(cx + CW / 2, cardsY + 70, item.label,
        { ...this.O('13px', '#2a4054'), wordWrap: { width: CW - 24 }, align: 'center' }).setOrigin(0.5, 0);
      const dc = this.add.text(cx + CW / 2, cardsY + 100, item.desc,
        this.F('12px', '#1e3040')).setOrigin(0.5, 0);
      const sn = this.add.text(cx + CW / 2, cardsY + CH / 2 + 20, 'СКОРО',
        this.O('14px', '#1e3a4a')).setOrigin(0.5, 0.5);

      ob.push(g, nm, dc, sn);
    });
  }

  // ── Consumable card (gold only, no credits) ───────────────────────────────
  _drawCard(cx, cy, cw, ch, item, gs) {
    const ob = this._tabObjects;

    const g = this.add.graphics();
    g.fillStyle(0x0c1a2e, 0.97); g.fillRoundedRect(cx, cy, cw, ch, 10);
    g.lineStyle(2, 0x2a6888, 0.8); g.strokeRoundedRect(cx, cy, cw, ch, 10);
    ob.push(g);

    // Icon — 115px (+20% from 96px)
    const iconKey = `consumable_${item.type}`;
    if (this.textures.exists(iconKey)) {
      const img = this.add.image(cx + cw / 2, cy + 68,
        prerenderTex(this, iconKey, 115, 115)).setDisplaySize(115, 115).setOrigin(0.5);
      ob.push(img);
    }

    // Name — 14px (was 13px)
    const nm = this.add.text(cx + cw / 2, cy + 132,
      i18n.t(`item.${item.type}`),
      { ...this.O('14px', '#e0f0ff'), wordWrap: { width: cw - 20 }, align: 'center' }).setOrigin(0.5, 0);
    ob.push(nm);

    // In cargo — 12px (was 11px)
    const inv = gs.inventory || [];
    const haveTxt = this.add.text(cx + cw / 2, cy + 160,
      `в трюме: ${countConsumableInInventory(inv, item.type)}`,
      this.F('12px', '#4a7a90')).setOrigin(0.5, 0);
    ob.push(haveTxt);

    // Sell hint
    ob.push(this.add.text(cx + cw / 2, cy + 176,
      `продажа: ${item.sell} кр./шт.`,
      this.F('12px', '#4a6040')).setOrigin(0.5, 0));

    // Gold buy button only (×10 = 1⭐)
    const btnH = 38, btnY = cy + ch - 48;
    const btn = this.add.rectangle(cx + cw / 2, btnY + btnH / 2, cw - 28, btnH, 0x2a1a00)
      .setStrokeStyle(1.5, 0xffb74d, 0.85).setInteractive({ useHandCursor: true });
    const btnTxt = this.add.text(cx + cw / 2, btnY + btnH / 2,
      `КУПИТЬ ×${GOLD_PACK}  —  1 ⭐`, this.O('10px', '#ffb74d')).setOrigin(0.5);
    ob.push(btn, btnTxt);

    btn.on('pointerover', () => btn.setFillStyle(0x4a2a00));
    btn.on('pointerout',  () => btn.setFillStyle(0x2a1a00));
    btn.on('pointerdown', () => {
      if ((gs.starGold || 0) < 1) {
        btn.setFillStyle(0x5a1010);
        this.time.delayedCall(300, () => btn.setFillStyle(0x2a1a00));
        return;
      }
      const inv2 = gs.inventory || [];
      const cargoMax = this._cargoMax(gs);
      const space = this._freeConsumableSpace(inv2, item.type, item.maxPerSlot, cargoMax);
      if (space <= 0) {
        btnTxt.setText('ТРЮМ ПОЛОН');
        this.time.delayedCall(1400, () => btnTxt.setText(`КУПИТЬ ×${GOLD_PACK}  —  1 ⭐`));
        return;
      }
      gs.starGold -= 1;
      addConsumableToInventory(inv2, item.type, GOLD_PACK, cargoMax);
      haveTxt.setText(`в трюме: ${countConsumableInInventory(inv2, item.type)}`);
      gs._saveState?.();
      gs.log?.(`Куплено: ${i18n.t(`item.${item.type}`)} ×${GOLD_PACK} −1 ⭐`);
      this._refresh();
    });
  }

  // ── Ammo card ─────────────────────────────────────────────────────────────
  _drawAmmoCard(cx, cy, cw, ch, item, gs) {
    const ob = this._tabObjects;
    const info = AMMO_ICON[item.type];
    const hexC = info?.color ?? 0xffb74d;

    const g = this.add.graphics();
    g.fillStyle(0x0c1a2e, 0.97); g.fillRoundedRect(cx, cy, cw, ch, 10);
    g.lineStyle(2, hexC, 0.7); g.strokeRoundedRect(cx, cy, cw, ch, 10);
    ob.push(g);

    // Icon — 115px
    const texKey = this._ensureAmmoTex(item.type, 115);
    ob.push(this.add.image(cx + cw / 2, cy + 68, texKey).setDisplaySize(115, 115).setOrigin(0.5));

    // Name
    ob.push(this.add.text(cx + cw / 2, cy + 132,
      i18n.t(`item.${item.type}`),
      { ...this.O('14px', '#e0f0ff'), wordWrap: { width: cw - 20 }, align: 'center' }).setOrigin(0.5, 0));

    // Stock counts
    const countInSlots = (gs.ammoSlots || [])
      .filter(s => s.type === item.type).reduce((sum, s) => sum + (s.count || 0), 0);
    const countInCargo = countConsumableInInventory(gs.inventory || [], item.type);
    const haveTxt = this.add.text(cx + cw / 2, cy + 158,
      `в трюме: ${countInCargo}  ·  в патронах: ${countInSlots}`,
      this.F('12px', '#4a7a90')).setOrigin(0.5, 0);
    ob.push(haveTxt);

    const _disc = (item.currency === 'credits') ? (gs?.player?.shopDiscountMod ?? 1) : 1;
    const _effPrice = Math.round(item.price * _disc);
    const priceLabel = item.currency === 'gold' ? `${item.price} ⭐` : `${_effPrice.toLocaleString()} кр.${_disc < 1 ? ' ✦' : ''}`;
    ob.push(this.add.text(cx + cw / 2, cy + 174,
      `пачка 1000 шт. — ${priceLabel}`,
      this.F('12px', '#4a6040')).setOrigin(0.5, 0));

    // Buy button
    const btnH = 38, btnY = cy + ch - 48;
    const btnBg = item.currency === 'gold' ? 0x2a1a00 : 0x0d3a58;
    const btnBd = item.currency === 'gold' ? hexC : 0x4dd0e1;
    const btnTc = item.currency === 'gold' ? `#${hexC.toString(16).padStart(6, '0')}` : '#4dd0e1';
    const btn = this.add.rectangle(cx + cw / 2, btnY + btnH / 2, cw - 28, btnH, btnBg)
      .setStrokeStyle(1.5, btnBd, 0.85).setInteractive({ useHandCursor: true });
    const btnTxt = this.add.text(cx + cw / 2, btnY + btnH / 2,
      `КУПИТЬ 1000  —  ${priceLabel}`, this.O('10px', btnTc)).setOrigin(0.5);
    ob.push(btn, btnTxt);

    const hoverBg = item.currency === 'gold' ? 0x4a2a00 : 0x1a5a80;
    btn.on('pointerover', () => btn.setFillStyle(hoverBg));
    btn.on('pointerout',  () => btn.setFillStyle(btnBg));
    btn.on('pointerdown', () => {
      const inv = gs.inventory || [];
      const cargoMax = this._cargoMax(gs);
      if (item.currency === 'gold') {
        if ((gs.starGold || 0) < item.price) {
          btn.setFillStyle(0x5a1010); this.time.delayedCall(300, () => btn.setFillStyle(btnBg)); return;
        }
        const space = this._freeConsumableSpace(inv, item.type, CONSUMABLES[item.type].maxPerSlot, cargoMax);
        if (space <= 0) {
          btnTxt.setText('ТРЮМ ПОЛОН'); this.time.delayedCall(1400, () => btnTxt.setText(`КУПИТЬ 1000  —  ${priceLabel}`)); return;
        }
        gs.starGold -= item.price;
      } else {
        if ((gs.credits || 0) < _effPrice) {
          btn.setFillStyle(0x5a1010); this.time.delayedCall(300, () => btn.setFillStyle(btnBg)); return;
        }
        const space = this._freeConsumableSpace(inv, item.type, CONSUMABLES[item.type].maxPerSlot, cargoMax);
        if (space <= 0) {
          btnTxt.setText('ТРЮМ ПОЛОН'); this.time.delayedCall(1400, () => btnTxt.setText(`КУПИТЬ 1000  —  ${priceLabel}`)); return;
        }
        gs.credits -= _effPrice;
      }
      addConsumableToInventory(inv, item.type, item.qty, cargoMax);
      gs._saveState?.();
      gs.log?.(`Куплено: ${i18n.t(`item.${item.type}`)} ×${item.qty}`);
      const newSlots = (gs.ammoSlots || []).filter(s => s.type === item.type).reduce((sum, s) => sum + (s.count || 0), 0);
      haveTxt.setText(`в трюме: ${countConsumableInInventory(inv, item.type)}  ·  в патронах: ${newSlots}`);
      this._refresh();
    });
  }

  // ── Booster card ──────────────────────────────────────────────────────────
  _drawBoosterCard(cx, cy, cw, ch, b, gs) {
    const ob = this._tabObjects;

    const gfx = this.add.graphics();
    gfx.fillStyle(0x0c1a2e, 0.97); gfx.fillRoundedRect(cx, cy, cw, ch, 10);
    gfx.lineStyle(2, b.color, 0.7); gfx.strokeRoundedRect(cx, cy, cw, ch, 10);
    ob.push(gfx);

    // Icon — real PNG if loaded, canvas fallback otherwise
    const pngKey = `consumable_${b.consumableKey}`;
    const iconKey = this.textures.exists(pngKey)
      ? prerenderTex(this, pngKey, 115, 115)
      : this._ensureBoosterTex(b.key, b.color, b.icon);
    ob.push(this.add.image(cx + cw / 2, cy + 68, iconKey).setDisplaySize(115, 115).setOrigin(0.5));

    // Name
    ob.push(this.add.text(cx + cw / 2, cy + 132, b.label,
      { ...this.O('14px', '#e0f0ff'), wordWrap: { width: cw - 20 }, align: 'center' }).setOrigin(0.5, 0));

    // Desc + duration
    ob.push(this.add.text(cx + cw / 2, cy + 158, b.desc,
      this.F('12px', '#6aacb8')).setOrigin(0.5, 0));
    ob.push(this.add.text(cx + cw / 2, cy + 174, 'действие: 1 час',
      this.F('12px', '#3a7a6a')).setOrigin(0.5, 0));

    // Active status
    const now = Date.now();
    const expiry = gs.activeBoosters?.[b.key] || 0;
    const isActive = expiry > now;
    const remainMin = isActive ? Math.ceil((expiry - now) / 60000) : 0;
    const statusTxt = this.add.text(cx + cw / 2, cy + 196,
      isActive ? `АКТИВЕН  ${remainMin} мин.` : '',
      this.O('10px', '#5aff80')).setOrigin(0.5, 0);
    ob.push(statusTxt);

    // Buy button
    const btnH = 38, btnY = cy + ch - 48;
    const btn = this.add.rectangle(cx + cw / 2, btnY + btnH / 2, cw - 28, btnH, 0x2a1a00)
      .setStrokeStyle(1.5, 0xffd54f, 0.85).setInteractive({ useHandCursor: true });
    const btnTxt = this.add.text(cx + cw / 2, btnY + btnH / 2,
      'КУПИТЬ  —  20 ⭐', this.O('10px', '#ffd54f')).setOrigin(0.5);
    ob.push(btn, btnTxt);

    btn.on('pointerover', () => btn.setFillStyle(0x4a2a00));
    btn.on('pointerout',  () => btn.setFillStyle(0x2a1a00));
    btn.on('pointerdown', () => {
      if ((gs.starGold || 0) < 20) {
        btn.setFillStyle(0x5a1010); this.time.delayedCall(300, () => btn.setFillStyle(0x2a1a00)); return;
      }
      gs.starGold -= 20;
      gs.activeBoosters = gs.activeBoosters || {};
      // Stack on existing time if already active
      const base = Math.max(Date.now(), gs.activeBoosters[b.key] || 0);
      gs.activeBoosters[b.key] = base + 3_600_000;
      const rem = Math.ceil((gs.activeBoosters[b.key] - Date.now()) / 60000);
      statusTxt.setText(`АКТИВЕН  ${rem} мин.`);
      gs._saveState?.();
      gs.log?.(`Куплен бустер: ${b.label} −20 ⭐`);
      this._refresh();
    });
  }

  // ── Texture helpers ───────────────────────────────────────────────────────
  _ensureAmmoTex(type, sz = 96) {
    if (this.textures.exists(type)) return prerenderTex(this, type, sz, sz);
    const key = `__amtex_${type}_${sz}`;
    if (this.textures.exists(key)) return key;
    const info = AMMO_ICON[type];
    const hexC = info?.color ?? 0x44aacc;
    const r = (hexC >> 16) & 0xff, g = (hexC >> 8) & 0xff, b = hexC & 0xff;
    const tex = this.textures.createCanvas(key, sz, sz);
    const ctx = tex.getContext();
    ctx.fillStyle = `rgb(${Math.round(r * 0.12)},${Math.round(g * 0.12)},${Math.round(b * 0.12)})`;
    ctx.fillRect(0, 0, sz, sz);
    ctx.strokeStyle = `rgba(${r},${g},${b},0.8)`;
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, sz - 4, sz - 4);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.font = `bold ${Math.round(sz * 0.38)}px Orbitron, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(info?.icon ?? '?', sz / 2, sz / 2);
    tex.refresh();
    return key;
  }

  _ensureBoosterTex(key, color, icon) {
    const cacheKey = `__boost_${key}`;
    if (this.textures.exists(cacheKey)) return cacheKey;
    const sz = 115;
    const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
    const tex = this.textures.createCanvas(cacheKey, sz, sz);
    const ctx = tex.getContext();
    ctx.fillStyle = `rgb(${Math.round(r*0.1)},${Math.round(g*0.1)},${Math.round(b*0.1)})`;
    ctx.fillRect(0, 0, sz, sz);
    ctx.strokeStyle = `rgba(${r},${g},${b},0.8)`;
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, sz - 4, sz - 4);
    ctx.font = `${Math.round(sz * 0.42)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(icon, sz / 2, sz / 2);
    tex.refresh();
    return cacheKey;
  }

  _freeConsumableSpace(inv, type, maxPerSlot, cargoMax) {
    let space = 0;
    for (const i of inv) {
      if (i.type === type && i.amount < maxPerSlot) space += maxPerSlot - i.amount;
    }
    space += Math.max(0, cargoMax - inv.length) * maxPerSlot;
    return space;
  }

  _cargoMax(gs) {
    const sl = gs.skillLevels?.cargo_expand || 0;
    const drover = gs.activeShip === 'drover' ? 2 : 0;
    const prem = gs.premium ? (gs.activeShip === 'drover' ? 6 : 8) : 0;
    return 8 + drover + ([0,3,8,16][sl]||0) + prem;
  }
}
