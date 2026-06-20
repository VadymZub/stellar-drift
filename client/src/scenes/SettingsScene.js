import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { loadSettings, saveSettings, resetSettings, DEFAULTS, UI_SCALE_STEPS } from '../settings.js';

const MINIMAP_LABELS = { small: 'Маленькая', medium: 'Средняя', large: 'Большая' };
const MINIMAP_KEYS   = ['small', 'medium', 'large'];

const TABS = [
  { icon: '🎮', label: 'Игра' },
  { icon: '🎨', label: 'Графика' },
  { icon: '🔊', label: 'Звук' },
  { icon: '⌨',  label: 'Управление' },
  { icon: '🌐', label: 'Язык' },
];

export default class SettingsScene extends Phaser.Scene {
  constructor() { super('SettingsScene'); }

  create() {
    const W = this.scale.width, H = this.scale.height;
    this._draft    = loadSettings();
    this._controls = {};
    this._tabObjs  = TABS.map(() => []);
    this._activeTab = 0;
    this._tabBtns  = [];

    // Font helpers stored on instance for tab builders
    this._F = (sz, c) => ({ fontFamily: 'Inter, sans-serif',    fontSize: sz, color: c, resolution: UI_RES });
    this._O = (sz, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: sz, color: c, resolution: UI_RES });

    // Overlay dim — depth 0, closes scene on click
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.55).setOrigin(0).setDepth(0).setInteractive();
    dim.on('pointerdown', () => this.scene.stop());

    // Panel
    const PW = 500, PH = 560;
    const px = Math.round((W - PW) / 2), py = Math.round((H - PH) / 2);

    const panel = this.add.graphics().setDepth(1);
    panel.fillStyle(0x03080f, 0.97);
    panel.fillRoundedRect(px, py, PW, PH, 10);
    panel.lineStyle(1.5, COLORS.primary, 0.7);
    panel.strokeRoundedRect(px, py, PW, PH, 10);
    panel.fillStyle(0x081422, 1);
    panel.fillRoundedRect(px, py, PW, 34, { tl: 10, tr: 10, bl: 0, br: 0 });

    // Click-blocker at depth 1 keeps dim from closing when user clicks inside panel
    this.add.rectangle(px, py, PW, PH, 0, 0.001).setOrigin(0).setDepth(1).setInteractive();

    // Title + close
    this.add.text(px + PW / 2, py + 17, '⚙  НАСТРОЙКИ', this._O('13px', '#4dd0e1')).setOrigin(0.5).setDepth(2);
    const closeBtn = this.add.text(px + PW - 14, py + 17, '✕', this._F('14px', '#335566'))
      .setOrigin(1, 0.5).setDepth(2).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ef5350'));
    closeBtn.on('pointerout',  () => closeBtn.setColor('#335566'));
    closeBtn.on('pointerdown', () => this.scene.stop());

    // Tab bar
    const TBY = py + 34, TBH = 30;
    const TBW = Math.floor(PW / TABS.length);
    this.add.graphics().setDepth(1).fillStyle(0x050d18, 1).fillRect(px, TBY, PW, TBH);

    TABS.forEach((tab, i) => {
      const tx  = px + i * TBW;
      const btn = this.add.rectangle(tx, TBY, TBW, TBH, 0x050d18, 1).setOrigin(0).setDepth(2)
        .setInteractive({ useHandCursor: true });
      const lbl = this.add.text(tx + TBW / 2, TBY + TBH / 2, tab.icon + ' ' + tab.label,
        this._F('10px', '#4a8899')).setOrigin(0.5).setDepth(3);
      btn.on('pointerover',  () => { if (this._activeTab !== i) { btn.setFillStyle(0x091828); lbl.setColor('#7ec8d8'); } });
      btn.on('pointerout',   () => { if (this._activeTab !== i) { btn.setFillStyle(0x050d18); lbl.setColor('#4a8899'); } });
      btn.on('pointerdown',  () => this._switchTab(i));
      this._tabBtns.push({ btn, lbl });
    });

    // Tab separator line
    this.add.graphics().setDepth(2).lineStyle(1, COLORS.primary, 0.3)
      .lineBetween(px, TBY + TBH, px + PW, TBY + TBH);

    // Content area bounds
    const contentY = TBY + TBH + 8;
    const LX = px + 16, RX = px + PW - 16;

    // Build all tab contents
    this._buildGameTab(contentY, LX, RX);
    this._buildGraphicsTab(contentY, LX, RX);
    this._buildSoundTab(contentY, LX, RX);
    this._buildControlsTab(contentY, LX, RX);
    this._buildLanguageTab(contentY, LX, RX);

    // Initially hide all but tab 0
    for (let i = 1; i < TABS.length; i++) {
      for (const obj of this._tabObjs[i]) obj.setVisible(false);
    }
    this._updateTabBtns();

    // Bottom buttons — always visible, at highest depth so they show above all tab content
    const btnY = py + PH - 46, BW = 150, BH = 34;
    const saveX = px + PW / 2 - BW - 8, rstX = px + PW / 2 + 8;

    const saveRect = this.add.rectangle(saveX, btnY, BW, BH, 0x0a2030, 1).setOrigin(0).setDepth(9)
      .setStrokeStyle(1, COLORS.primary, 0.8).setInteractive({ useHandCursor: true });
    this.add.text(saveX + BW / 2, btnY + BH / 2, '💾  Сохранить', this._F('12px', '#4dd0e1'))
      .setOrigin(0.5).setDepth(10);
    saveRect.on('pointerover',  () => saveRect.setFillStyle(0x102a40));
    saveRect.on('pointerout',   () => saveRect.setFillStyle(0x0a2030));
    saveRect.on('pointerdown',  () => this._save());

    const rstRect = this.add.rectangle(rstX, btnY, BW, BH, 0x12080a, 1).setOrigin(0).setDepth(9)
      .setStrokeStyle(1, 0x5a2a2a, 0.7).setInteractive({ useHandCursor: true });
    this.add.text(rstX + BW / 2, btnY + BH / 2, '↻  Сбросить', this._F('12px', '#aa6666'))
      .setOrigin(0.5).setDepth(10);
    rstRect.on('pointerover',  () => rstRect.setFillStyle(0x200f10));
    rstRect.on('pointerout',   () => rstRect.setFillStyle(0x12080a));
    rstRect.on('pointerdown',  () => this._reset());

    // Background under buttons so tab content doesn't bleed through
    const btnBg = this.add.graphics().setDepth(8);
    btnBg.fillStyle(0x03080f, 0.97);
    btnBg.fillRect(px + 1, btnY - 8, PW - 2, BH + 16);
    btnBg.lineStyle(1, COLORS.primary, 0.15);
    btnBg.lineBetween(px + 1, btnY - 8, px + PW - 1, btnY - 8);

    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());
  }

  // ── Tab builders ───────────────────────────────────────────────────────────

  _buildGameTab(y, LX, RX) {
    const T = 0;
    this._section('ИНТЕРФЕЙС', T, LX, RX, y); y += 22;
    this._addStepper('UI Scale',  'uiScale',    UI_SCALE_STEPS.map(v => v + '%'), UI_SCALE_STEPS, T, LX, RX, y); y += 36;
    this._addStepper('Миникарта', 'minimapSize', MINIMAP_KEYS.map(k => MINIMAP_LABELS[k]), MINIMAP_KEYS, T, LX, RX, y); y += 36;

    this._section('ПАНЕЛИ', T, LX, RX, y); y += 22;
    this._addToggle('Фон чата',       'chatBg', T, LX, RX, y); y += 36;
    this._addToggle('Фон информации', 'infoBg', T, LX, RX, y); y += 36;
    this._addToggle('Фон лога',       'logBg',  T, LX, RX, y); y += 36;

    this._section('ГЕЙМПЛЕЙ', T, LX, RX, y); y += 22;
    this._addToggle('Авто-цель (Tab)', 'autoTarget', T, LX, RX, y); y += 36;
    this._addToggle('Авто-лут',        'autoLoot',   T, LX, RX, y);
  }

  _buildGraphicsTab(y, LX, RX) {
    const T = 1;
    this._section('ЭФФЕКТЫ', T, LX, RX, y); y += 22;
    this._addToggle('Следы двигателя', 'engineTrails', T, LX, RX, y); y += 36;
    this._addToggle('Тряска камеры',   'cameraShake',  T, LX, RX, y); y += 36;
    this._addToggle('Параллакс фон',   'bgParallax',   T, LX, RX, y); y += 36;

    this._section('ОТОБРАЖЕНИЕ', T, LX, RX, y); y += 22;
    this._addToggle('Счётчик FPS', 'showFps', T, LX, RX, y); y += 36;

    y += 16;
    this._track(
      this.add.text(LX, y, '💡 Часть эффектов применяется после перезапуска', this._F('10px', '#336677')).setDepth(4),
      T
    );
  }

  _buildSoundTab(y, LX, RX) {
    const T = 2;
    const VOL_STEPS  = [0, 25, 50, 75, 100];
    const VOL_LABELS = VOL_STEPS.map(v => v + '%');

    this._section('ГРОМКОСТЬ', T, LX, RX, y); y += 22;
    this._addStepper('Общая',   'masterVol', VOL_LABELS, VOL_STEPS, T, LX, RX, y); y += 36;
    this._addStepper('Музыка',  'musicVol',  VOL_LABELS, VOL_STEPS, T, LX, RX, y); y += 36;
    this._addStepper('Эффекты', 'sfxVol',    VOL_LABELS, VOL_STEPS, T, LX, RX, y); y += 36;

    this._section('ОПЦИИ', T, LX, RX, y); y += 22;
    this._addToggle('Звук в фоне', 'sfxBg', T, LX, RX, y); y += 36;

    y += 16;
    this._track(
      this.add.text(LX, y, '🔇 Аудиосистема подключается в Сезоне 1', this._F('10px', '#336677')).setDepth(4),
      T
    );
  }

  _buildControlsTab(y, LX, RX) {
    const T = 3;

    // Groups: [section label, [[action, key], ...]]
    const GROUPS = [
      ['ДВИЖЕНИЕ', [
        ['Движение к курсору',     'ЛКМ'],
        ['Атака / подбор лута',    '2×ЛКМ'],
        ['Ускорение (форсаж)',      'ЛКМ по шевроне'],
        ['Навигация по миникарте', 'ЛКМ по карте'],
      ]],
      ['БОЙ', [
        ['Авто-цель',              'Tab'],
        ['Стрельба вкл/выкл',      'Ctrl'],
        ['Слоты навыков',          '1–9,  0'],
      ]],
      ['ИНТЕРФЕЙС', [
        ['Настройки',              'S  /  Esc'],
        ['База (взаимодействие)',   'F'],
        ['Гараж',                  'G'],
        ['Инвентарь / Склад',      'I  /  C'],
        ['Навыки',                 'K'],
        ['Карта',                  'M'],
        ['Миссии',                 'O'],
        ['Магазин',                'P'],
        ['Корпорация / Гильдия',   'H  /  N'],
      ]],
    ];

    const SEC_H = 18, ROW = 22;

    GROUPS.forEach(([secLabel, rows]) => {
      const sg = this._track(this.add.graphics().setDepth(3), T);
      sg.fillStyle(0x060f1e, 1).fillRect(LX, y, RX - LX, SEC_H);
      this._track(
        this.add.text(LX + 6, y + SEC_H / 2, secLabel, this._F('9px', '#2a6a7a')).setOrigin(0, 0.5).setDepth(4),
        T
      );
      y += SEC_H;

      rows.forEach(([action, key], i) => {
        const bg = this._track(this.add.graphics().setDepth(3), T);
        bg.fillStyle(i % 2 === 0 ? 0x040c18 : 0x060f1e, 1).fillRect(LX, y, RX - LX, ROW - 1);
        this._track(this.add.text(LX + 8, y + ROW / 2, action, this._F('10px', '#7eb8c8')).setOrigin(0, 0.5).setDepth(4), T);
        this._track(this.add.text(RX - 8, y + ROW / 2, key,    this._F('10px', '#4dd0e1')).setOrigin(1, 0.5).setDepth(4), T);
        y += ROW;
      });

      y += 3;
    });

    this._track(
      this.add.text(LX, y + 2, '⌨ Переназначение клавиш — в Сезоне 1', this._F('10px', '#336677')).setDepth(4),
      T
    );
  }

  _buildLanguageTab(y, LX, RX) {
    const T = 4;
    this._section('ЯЗЫК ИНТЕРФЕЙСА', T, LX, RX, y); y += 28;

    const langs = [
      { code: 'ru', flag: '🇷🇺', label: 'Русский (RU)', available: true },
      { code: 'en', flag: '🇬🇧', label: 'English (EN)', available: false, note: 'с Сезона 1' },
    ];

    langs.forEach(lang => {
      const RH = 46;
      const isActive = (this._draft.lang || 'ru') === lang.code;
      const fillCol  = isActive ? 0x0a2030 : 0x040c18;
      const textCol  = lang.available ? '#cfe9ee' : '#445566';
      const bdCol    = isActive ? COLORS.primary : 0x1a3040;

      const bg = this._track(
        this.add.rectangle(LX, y, RX - LX, RH - 4, fillCol).setOrigin(0).setDepth(3).setStrokeStyle(1, bdCol, 0.6),
        T
      );
      this._track(this.add.text(LX + 40, y + RH / 2 - 2, lang.flag + ' ' + lang.label, this._F('13px', textCol)).setOrigin(0, 0.5).setDepth(4), T);

      if (isActive) {
        this._track(this.add.text(LX + 12, y + RH / 2 - 2, '✓', this._F('14px', '#4dd0e1')).setOrigin(0, 0.5).setDepth(4), T);
      }
      if (!lang.available) {
        this._track(this.add.text(RX - 10, y + RH / 2 - 2, lang.note, this._F('10px', '#445566')).setOrigin(1, 0.5).setDepth(4), T);
      }
      if (lang.available) {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerdown', () => { this._draft.lang = lang.code; });
      }

      y += RH;
    });

    y += 14;
    this._track(
      this.add.text(LX, y, '🌐 Авто-перевод чата — в Сезоне 1', this._F('10px', '#336677')).setDepth(4),
      T
    );
  }

  // ── Shared UI helpers ──────────────────────────────────────────────────────

  _track(obj, tabIdx) {
    this._tabObjs[tabIdx].push(obj);
    return obj;
  }

  _section(label, tabIdx, LX, RX, y) {
    const sg = this._track(this.add.graphics().setDepth(3), tabIdx);
    sg.lineStyle(1, COLORS.primary, 0.18);
    sg.lineBetween(LX, y + 8, RX, y + 8);
    this._track(
      this.add.text(LX + 8, y + 8, ` ${label} `, this._F('10px', '#2a5a6a'))
        .setOrigin(0, 0.5).setDepth(4).setBackgroundColor('#03080f'),
      tabIdx
    );
  }

  _addStepper(label, key, displayVals, dataVals, tabIdx, LX, RX, y) {
    this._track(this.add.text(LX, y + 18, label, this._F('12px', '#7eb8c8')).setOrigin(0, 0.5).setDepth(4), tabIdx);

    const currIdx = () => {
      const idx = dataVals.indexOf(this._draft[key]);
      return idx < 0 ? Math.max(0, dataVals.indexOf(DEFAULTS[key])) : idx;
    };

    const btnW = 26, btnH = 22, valW = 90, gap = 6;
    const by = y + (36 - btnH) / 2;
    const rightBtnX = RX - btnW;
    const valCX     = rightBtnX - gap - valW / 2;
    const leftBtnX  = rightBtnX - gap - valW - gap - btnW;

    const rightHit = this._stepBtn(rightBtnX, by, btnW, btnH, '>', tabIdx);
    const leftHit  = this._stepBtn(leftBtnX,  by, btnW, btnH, '<', tabIdx);

    const valTxt = this._track(
      this.add.text(valCX, y + 18, displayVals[currIdx()], this._F('12px', '#cfe9ee')).setOrigin(0.5).setDepth(5),
      tabIdx
    );

    const refresh = () => {
      const i = currIdx();
      valTxt.setText(displayVals[i]);
      leftHit.setAlpha(i > 0 ? 1 : 0.3);
      rightHit.setAlpha(i < dataVals.length - 1 ? 1 : 0.3);
    };
    refresh();

    leftHit.on('pointerdown',  () => { const i = currIdx(); if (i > 0)                        { this._draft[key] = dataVals[i - 1]; refresh(); } });
    rightHit.on('pointerdown', () => { const i = currIdx(); if (i < dataVals.length - 1)       { this._draft[key] = dataVals[i + 1]; refresh(); } });

    this._controls[key] = { type: 'stepper', refresh };
  }

  _stepBtn(x, y, w, h, label, tabIdx) {
    const g = this._track(this.add.graphics().setDepth(4), tabIdx);
    g.fillStyle(0x0a1828, 1).fillRoundedRect(x, y, w, h, 4);
    g.lineStyle(1, 0x1e4060, 1).strokeRoundedRect(x, y, w, h, 4);
    const txt = this._track(
      this.add.text(x + w / 2, y + h / 2, label, this._F('11px', '#4dd0e1')).setOrigin(0.5).setDepth(5),
      tabIdx
    );
    const hit = this._track(
      this.add.rectangle(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: true }).setDepth(6).setAlpha(0.001),
      tabIdx
    );
    hit.on('pointerover', () => txt.setColor('#80f0ff'));
    hit.on('pointerout',  () => txt.setColor('#4dd0e1'));
    return hit;
  }

  _addToggle(label, key, tabIdx, LX, RX, y) {
    const ROW = 36, BW = 60, BH = 22;
    const by = y + Math.round((ROW - BH) / 2);
    this._track(this.add.text(LX, y + ROW / 2, label, this._F('12px', '#7eb8c8')).setOrigin(0, 0.5).setDepth(4), tabIdx);

    const bx  = RX - BW;
    const bg  = this._track(
      this.add.rectangle(bx, by, BW, BH, 0, 1).setOrigin(0).setDepth(4).setInteractive({ useHandCursor: true }),
      tabIdx
    );
    const txt = this._track(
      this.add.text(bx + BW / 2, by + BH / 2, '', this._F('11px', '#ffffff')).setOrigin(0.5).setDepth(5),
      tabIdx
    );

    const refresh = () => {
      const on = !!this._draft[key];
      bg.setFillStyle(on ? 0x0a3020 : 0x1a0808).setStrokeStyle(1, on ? 0x2a7a50 : 0x5a2a2a, 0.9);
      txt.setText(on ? 'ВКЛ' : 'ВЫКЛ').setColor(on ? '#4dffa0' : '#cc4444');
    };
    refresh();
    bg.on('pointerdown', () => { this._draft[key] = !this._draft[key]; refresh(); });
    this._controls[key] = { type: 'toggle', refresh };
  }

  // ── Tab switching ──────────────────────────────────────────────────────────

  _switchTab(idx) {
    for (const obj of this._tabObjs[this._activeTab]) obj.setVisible(false);
    this._activeTab = idx;
    for (const obj of this._tabObjs[this._activeTab]) obj.setVisible(true);
    this._updateTabBtns();
  }

  _updateTabBtns() {
    this._tabBtns.forEach(({ btn, lbl }, i) => {
      const active = i === this._activeTab;
      btn.setFillStyle(active ? 0x0d2035 : 0x050d18);
      lbl.setColor(active ? '#4dd0e1' : '#4a8899');
    });
  }

  // ── Save / Reset ───────────────────────────────────────────────────────────

  _save() {
    const prev = loadSettings();
    const next = { ...this._draft };
    saveSettings(next);

    const hud = this.scene.get('HudScene');
    const gs  = this.scene.get('GameScene');

    if (hud) {
      hud._refreshInfoPanel?.();
      hud._refreshLogPanel?.();
      hud._rebuildChatPanel?.();
    }
    if (gs) gs.magnetEnabled      = next.autoLoot;
    if (gs) gs._autoTargetEnabled = next.autoTarget;

    if (next.uiScale !== prev.uiScale && hud) {
      this.scene.stop('HudScene');
      this.scene.launch('HudScene');
    }

    this.scene.stop();
  }

  _reset() {
    this._draft = resetSettings();
    for (const ctrl of Object.values(this._controls)) ctrl.refresh();
  }
}
