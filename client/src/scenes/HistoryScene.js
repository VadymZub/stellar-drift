import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { getMyLog } from '../api.js';

// Экран "ИСТОРИЯ" — просмотр персистентного лога игрока (см. диалог "нужно доделать
// сохранение и просмотр лога"). Открывается кнопкой поверх плавающей ЛОГ-панели HUD
// (см. HudScene._toggleLogPanel/_historyBtn), тем же паттерном launch без пауз/стопа
// нижней сцены, что и StatsScene (не toggleOverlay — этот экран не эксклюзивен базовым
// меню, PvP-килы/покупки логичнее смотреть в любой момент, не только "на базе").
//
// Категории и срок жизни строго зеркалят AUDIT_RETENTION_DAYS в server/main.py — если
// правишь один, проверь и другой.
const TABS = [
  { id: 'purchase_real_money', label: 'ПОКУПКИ $',  retentionHint: 'хранится всегда' },
  { id: 'purchase_stars',      label: 'ПОКУПКИ ⭐',  retentionHint: 'хранится 7 дней' },
  { id: 'craft',                label: 'КРАФТ',      retentionHint: 'хранится 7 дней' },
  { id: 'earn',                 label: 'ДОХОД',      retentionHint: 'хранится 7 дней' },
  { id: 'pvp_kill',             label: 'PVP',         retentionHint: 'хранится 7 дней' },
];

const ROW_H = 30;

// Человекочитаемое описание строки — по action (см. server-side AuditLog.action и
// клиентские logEvent(...) вызовы). Незнакомый action не ломает рендер — просто
// показывает action+params как есть (см. _describeFallback), так что новые вызовы
// logEvent из будущих фич не требуют правки этого файла, чтобы хотя бы не выглядеть
// пусто — просто добавь сюда красивую строку, когда будет время.
function describeEntry(row) {
  const p = row.params || {};
  switch (row.action) {
    case 'crypto_purchase':
      return `+${p.starGoldAmount ?? '?'} ⭐  за  ${((p.amountUsdtMicro ?? 0) / 1_000_000).toFixed(2)} USDT`;
    case 'pvp_kill':
      return `Вас убил ${p.killer ?? '?'}${p.sector ? `  ·  ${p.sector}` : ''}`;
    case 'pvp_kill_scored':
      return `Вы убили ${p.victim ?? '?'}${p.sector ? `  ·  ${p.sector}` : ''}`;
    default:
      return _describeFallback(row.action, p);
  }
}

function _describeFallback(action, p) {
  const parts = Object.entries(p).map(([k, v]) => `${k}: ${v}`);
  return parts.length ? `${action}  (${parts.join(', ')})` : action;
}

export default class HistoryScene extends Phaser.Scene {
  constructor() { super('HistoryScene'); }

  O(s, c) { return { fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }
  F(s, c) { return { fontFamily: 'Inter, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }

  create(data) {
    this.tab = data?.tab || TABS[0].id;
    this.scroll = 0;
    this._rows = [];
    this._loading = false;
    const W = this.scale.width, H = this.scale.height;

    if (this.textures.exists('bg_garage')) {
      const bg = this.add.image(W / 2, H / 2, 'bg_garage');
      bg.setScale(Math.max(W / bg.width, H / bg.height)).setAlpha(0.8);
    } else {
      this.add.rectangle(0, 0, W, H, 0x060d18, 1).setOrigin(0);
    }

    const pw = Math.min(760, W - 40), ph = Math.min(700, H - 40);
    const px = (W - pw) / 2, py = (H - ph) / 2;
    this.box = { px, py, pw, ph };

    const g = this.add.graphics();
    g.fillStyle(0x080d18, 0.96); g.fillRoundedRect(px, py, pw, ph, 12);
    g.lineStyle(2, COLORS.primary, 0.75); g.strokeRoundedRect(px, py, pw, ph, 12);

    this.add.text(px + 24, py + 16, 'ИСТОРИЯ', this.O('20px', '#4dd0e1')).setDepth(14);
    const closeBtn = this.add.text(px + pw - 22, py + 24, '✕', this.F('18px', '#335566'))
      .setOrigin(1, 0.5).setDepth(14).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ef5350'));
    closeBtn.on('pointerout',  () => closeBtn.setColor('#335566'));
    closeBtn.on('pointerdown', () => this.scene.stop());
    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());

    const tabSpan = pw / TABS.length;
    TABS.forEach((t, i) => this._tabBtn(px + tabSpan * (i + 0.5), py + 56, t, tabSpan));

    this._hintTxt = this.add.text(px + pw / 2, py + 76,
      TABS.find(t => t.id === this.tab)?.retentionHint ?? '', this.F('10px', '#5a7a8a')).setOrigin(0.5).setDepth(14);

    this._viewX = px + 20;
    this._viewY = py + 96;
    this._viewW = pw - 40;
    this._viewH = ph - 96 - 16;
    this._listObjs = [];

    this._loadTab();

    this.input.on('wheel', (ptr, _go, _dx, dy) => {
      if (ptr.x < this._viewX || ptr.x > this._viewX + this._viewW) return;
      this.scroll = Phaser.Math.Clamp(this.scroll + dy * 0.5, 0, this._maxScroll ?? 0);
      this._draw();
    });
  }

  _tabBtn(x, y, t, span) {
    const active = this.tab === t.id;
    const label = this.add.text(x, y, t.label, this.O('12px', active ? '#4dd0e1' : '#7e9398'))
      .setOrigin(0.5).setDepth(14).setInteractive({ useHandCursor: true });
    if (active) this.add.rectangle(x, y + 14, span - 16, 2, COLORS.primary).setOrigin(0.5, 0).setDepth(14);
    label.on('pointerdown', () => { if (this.tab !== t.id) this.scene.restart({ tab: t.id }); });
  }

  _loadTab() {
    this._loading = true;
    this._rows = [];
    this.scroll = 0;
    this._draw();
    getMyLog(this.tab, { limit: 100 })
      .then(rows => { this._loading = false; this._rows = rows; this._draw(); })
      .catch(() => { this._loading = false; this._rows = []; this._errored = true; this._draw(); });
  }

  _draw() {
    this._listObjs.forEach(o => o?.destroy());
    this._listObjs = [];
    const { _viewX: x, _viewY: y, _viewW: w, _viewH: h } = this;

    const mask = this.make.graphics();
    mask.fillRect(x, y, w, h);

    if (this._loading) {
      this._listObjs.push(this.add.text(x + w / 2, y + h / 2, 'Загрузка…', this.F('12px', '#5a7a8a')).setOrigin(0.5).setDepth(14));
      return;
    }
    if (this._errored) {
      this._listObjs.push(this.add.text(x + w / 2, y + h / 2, 'Не удалось загрузить историю', this.F('12px', '#ef5350')).setOrigin(0.5).setDepth(14));
      return;
    }
    if (!this._rows.length) {
      this._listObjs.push(this.add.text(x + w / 2, y + h / 2, 'Нет записей', this.F('12px', '#5a7a8a')).setOrigin(0.5).setDepth(14));
      return;
    }

    this._maxScroll = Math.max(0, this._rows.length * ROW_H - h);
    this.scroll = Phaser.Math.Clamp(this.scroll, 0, this._maxScroll);

    const container = this.add.container(0, -this.scroll).setDepth(14);
    container.setMask(mask.createGeometryMask());
    this._listObjs.push(container, mask);

    // Виртуализация не нужна — максимум 100 строк на страницу (см. лимит в _loadTab),
    // маска просто отсекает то, что укатилось за видимую область при скролле.
    this._rows.forEach((row, i) => {
      const ry = y + i * ROW_H;
      const dt = new Date(/[Zz]|[+-]\d\d:\d\d$/.test(row.ts) ? row.ts : row.ts + 'Z');
      const timeStr = dt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      container.add(this.add.text(x, ry, timeStr, this.F('10px', '#4a6a7a')));
      container.add(this.add.text(x + 100, ry, describeEntry(row), this.F('11px', '#cce8f0')));
    });
  }
}
