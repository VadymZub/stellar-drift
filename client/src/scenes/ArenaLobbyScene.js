// Запись на арену — открывается кнопкой "АРЕНА" в nav-баре домашней базы (см.
// HudScene._showBaseNav). Открывается ПОВЕРХ уже открытого меню (Гараж/Клан/etc — см.
// GameScene.toggleOverlay, откуда эта сцена намеренно исключена) и не закрывает его;
// закрытие этой сцены (ESC/кнопка) возвращает предыдущее меню как есть.
//
// Состояние очереди (режим/таймер) живёт НЕ здесь, а на GameScene (_arenaQueueJoin/
// _arenaQueueCancel/_arenaQueueTimeout) — окно можно закрыть, не отменяя запись, она
// продолжается в фоне; таймаут 3 мин без соперника отменяется и логируется независимо
// от того, открыто ли сейчас это окно (см. диалог). Эта сцена — только UI поверх
// общего состояния: при открытии подхватывает его, если запись уже идёт.
//
// Правила:
// - открыть меню может только лидер группы, ЛИБО игрок без группы (тогда доступна
//   только дуэль 1на1);
// - 4 варианта чекбоксами (дуэль + 3 режима 3на3), выбрать можно только один разом;
// - дуэль недоступна, если игрок В группе; 3на3-режимы недоступны, если группа не
//   ровно из 3 — в обоих случаях чекбокс задизейблен с текстом причины;
// - сервер ДОПОЛНИТЕЛЬНО проверяет разброс уровней внутри группы (>5 — запись
//   невозможна, см. main.py arena_queue_join) — ответ приходит как arena_queue_update
//   {ok:false, reason}.
import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { COLORS, UI_RES, ARENA_MODES } from '../constants.js';

const W = 560;
// Раньше Orbitron — расплывчатость (см. диалог: "текст всё равно расплывается")
// чинили увеличением resolution, но реальная жалоба ("ломаные буквы, плохо
// читаются") была про сам ФОНТ: у Orbitron кириллица без латинского двойника
// (З, Ч, Ф, Ь, Э, Я...) — синтетические/недокованные глифы, выглядят "битыми".
// GarageScene/MissionsScene и так уже разделяют это: O()=Orbitron только для
// коротких лого/цифр, F()=Inter для настоящего кириллического текста — здесь то
// же самое, просто на весь TF сразу (в этой сцене нет отдельных Orbitron-акцентов
// вроде цифр тиров). resolution=max(UI_RES,4) — тот более ранний фикс размытости
// остаётся нужен независимо от фонта.
const TF = { fontFamily: 'Inter, sans-serif', resolution: Math.max(UI_RES, 4) };

const MODE_ORDER = ['duel', 'flag', 'points', 'cargo'];

export default class ArenaLobbyScene extends Phaser.Scene {
  constructor() { super('ArenaLobbyScene'); }

  create() {
    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;
    this.gs = this.scene.get('GameScene');
    this._rows = [];
    // Подхватываем уже идущую запись (окно могли закрыть и открыть заново) —
    // см. header-комментарий: состояние живёт на GameScene, не здесь.
    this._selectedMode = this.gs._arenaQueueMode ?? null;
    this._waiting = this.gs._arenaQueueMode != null;

    // БЕЗ полноэкранного затемнения — окно записи на арену должно оставлять видимым
    // и интерактивным меню базы/фон позади себя (см. диалог). Закрыть можно только
    // ESC/кнопкой "ЗАКРЫТЬ" — закрытие НЕ отменяет запись (см. header-комментарий).
    this.input.keyboard.once('keydown-ESC', () => this.close());

    this.gs._arenaLobbyOverlay = this;

    const grp = this.gs.groupSystem;
    const isLeaderOrSolo = !grp?.inGroup || grp.isLeader;
    if (!isLeaderOrSolo) {
      this._panel(cx, cy, W, 180);
      this.add.text(cx, cy - 30, 'ЗАПИСЬ НА АРЕНУ', { ...TF, fontSize: '22px', color: '#4dd0e1' }).setOrigin(0.5);
      this.add.text(cx, cy + 10, 'Открыть запись может только лидер группы.', { ...TF, fontSize: '16px', color: '#ef5350' }).setOrigin(0.5);
      this._closeBtn(cx, cy + 60);
      return;
    }

    // Раньше H=470 с приращениями "на глаз" (y+=6/+=30/+=44 между статусом/кнопками) не
    // хватало места под 4 строки режимов + статус + 2 кнопки — кнопка очереди и кнопка
    // ЗАКРЫТЬ перекрывались на ~7px, а ЗАКРЫТЬ вылезала за нижний край панели (баг из
    // диалога: "кнопки налазят одна на другую"). H и промежутки ниже — из явной суммы
    // высот всех элементов + зазоров, не подбор.
    const H = 570;
    this._panel(cx, cy, W, H);
    let y = cy - H / 2 + 26;
    this.add.text(cx, y, 'ЗАПИСЬ НА АРЕНУ', { ...TF, fontSize: '22px', color: '#4dd0e1' }).setOrigin(0.5);
    y += 40;

    const memberCount = grp?.memberCount ?? 1;
    const inGroup = !!grp?.inGroup && memberCount > 1;
    // ВРЕМЕННЫЙ DEV-БЭКДОР (см. диалог: "как протестировать 3на3, 6 аккаунтов не
    // запущу") — обычно 3на3 доступно только группе РОВНО из 3 (memberCount === 3),
    // здесь снят до реального теста с полными командами (см. парный бэкдор в
    // main.py arena_queue_join — сервер тоже временно принимает любой размер).
    // УБРАТЬ вместе с серверной стороной: вернуть `inGroup && memberCount === 3`.
    this._groupOk3 = true;

    for (const key of MODE_ORDER) {
      const cfg = ARENA_MODES[key];
      const is3v3 = cfg.team === '3v3';
      const disabled = is3v3 ? !this._groupOk3 : inGroup;
      const reason = is3v3
        ? (disabled ? 'нужна группа из 3 игроков' : null)
        : (disabled ? 'недоступно в группе' : null);
      this._buildModeRow(cx, y, key, cfg, disabled, reason);
      y += 78;
    }

    y += 20;
    this._statusTxt = this.add.text(cx, y, '', { ...TF, fontSize: '15px', color: '#ef5350', wordWrap: { width: W - 60 } }).setOrigin(0.5);
    y += 40;  // запас под 2 строки статуса (wordWrap) перед кнопкой

    const QUEUE_BTN_H = 54, CLOSE_BTN_H = 48, BTN_GAP = 16;
    this._queueBtnBg = this.add.rectangle(cx, y, W - 58, QUEUE_BTN_H, 0x0d2a1a).setStrokeStyle(2, COLORS.primary, 0.9).setInteractive();
    this._queueBtnTxt = this.add.text(cx, y, 'ВЫБЕРИТЕ РЕЖИМ', { ...TF, fontSize: '18px', color: '#556655' }).setOrigin(0.5);
    this._queueBtnBg.on('pointerdown', (pointer, lx, ly, event) => { if (event) event.stopPropagation(); this._onQueueBtn(); });
    y += QUEUE_BTN_H / 2 + BTN_GAP + CLOSE_BTN_H / 2;  // центр-в-центр с учётом обеих высот — без нахлёста

    this._closeBtn(cx, y);

    if (this._waiting) {
      for (const r of this._rows) if (r.key === this._selectedMode) r.check.setVisible(true);
      this._statusTxt.setColor('#ffd54f');
      this._statusTxt.setText('Ожидание соперника…');
    }
    this._refreshQueueBtn();
  }

  _buildModeRow(cx, y, key, cfg, disabled, reason) {
    const rowY = y;
    const box = this.add.rectangle(cx - W / 2 + 45, rowY, 22, 22, 0x0a1420)
      .setStrokeStyle(2, disabled ? 0x334455 : COLORS.primary, 0.9);
    const check = this.add.text(cx - W / 2 + 45, rowY, '✓', { ...TF, fontSize: '16px', color: '#4dd0e1' }).setOrigin(0.5).setVisible(false);
    const label = this.add.text(cx - W / 2 + 68, rowY - 8, cfg.label, { ...TF, fontSize: '18px', color: disabled ? '#556677' : '#ccddee' }).setOrigin(0, 0.5);
    const sub = this.add.text(cx - W / 2 + 68, rowY + 13, reason ? `⚠ ${reason}` : (cfg.team === '3v3' ? '3 на 3' : '1 на 1'),
      { ...TF, fontSize: '13px', color: reason ? '#ef5350' : '#557799' }).setOrigin(0, 0.5);
    const hit = this.add.rectangle(cx, rowY, W - 40, 60, 0x000000, 0.001).setInteractive();

    const row = { key, box, check, label, sub, hit, disabled };
    this._rows.push(row);
    if (!disabled) {
      hit.on('pointerover', () => box.setStrokeStyle(2, 0x80deea, 1));
      hit.on('pointerout',  () => box.setStrokeStyle(2, this._selectedMode === key ? 0x80deea : COLORS.primary, this._selectedMode === key ? 1 : 0.9));
      hit.on('pointerdown', (pointer, lx, ly, event) => { if (event) event.stopPropagation(); this._selectMode(key); });
    }
  }

  _selectMode(key) {
    if (this._waiting) return;
    this._selectedMode = this._selectedMode === key ? null : key;
    for (const r of this._rows) {
      const on = r.key === this._selectedMode;
      r.check.setVisible(on);
      if (!r.disabled) r.box.setStrokeStyle(2, on ? 0x80deea : COLORS.primary, on ? 1 : 0.9);
    }
    this._statusTxt.setText('');
    this._refreshQueueBtn();
  }

  _refreshQueueBtn() {
    if (this._waiting) {
      this._queueBtnTxt.setText('ОТМЕНИТЬ ОЖИДАНИЕ');
      this._queueBtnTxt.setColor('#ef9a9a');
      this._queueBtnBg.setStrokeStyle(2, 0xef5350, 0.9);
      return;
    }
    if (this._selectedMode) {
      this._queueBtnTxt.setText('ВСТАТЬ В ОЧЕРЕДЬ');
      this._queueBtnTxt.setColor('#4dd0e1');
      this._queueBtnBg.setStrokeStyle(2, COLORS.primary, 0.9);
    } else {
      this._queueBtnTxt.setText('ВЫБЕРИТЕ РЕЖИМ');
      this._queueBtnTxt.setColor('#556655');
      this._queueBtnBg.setStrokeStyle(2, 0x334455, 0.9);
    }
  }

  _onQueueBtn() {
    if (this._waiting) {
      this.gs._arenaQueueCancel();
      this._waiting = false;
      this._statusTxt.setColor('#ef5350');
      this._statusTxt.setText('Запись отменена.');
      this._refreshQueueBtn();
      return;
    }
    if (!this._selectedMode) return;
    this._waiting = true;
    this._statusTxt.setColor('#ffd54f');
    this._statusTxt.setText('Ожидание соперника…');
    this._refreshQueueBtn();
    this.gs._arenaQueueJoin(this._selectedMode);
  }

  // ── Вызывается из GameScene._onArenaQueueUpdate/_arenaQueueTimeout, если это окно
  // сейчас открыто — таймер и отмена уже произошли на GameScene, здесь только UI. ──
  onQueueUpdate(msg) {
    if (msg.ok === false) {
      this._waiting = false;
      this._statusTxt.setColor('#ef5350');
      this._statusTxt.setText(msg.reason ?? 'Запись невозможна.');
      this._refreshQueueBtn();
      return;
    }
    if (msg.ok && msg.waiting) {
      this._statusTxt.setColor('#ffd54f');
      this._statusTxt.setText('Ожидание соперника…');
    }
  }

  close() {
    // НЕ отменяет запись — очередь живёт на GameScene и продолжается в фоне
    // (см. header-комментарий).
    if (this.gs?._arenaLobbyOverlay === this) this.gs._arenaLobbyOverlay = null;
    this.scene.stop();
  }

  // ── Helpers (стиль BaseMenuScene) ────────────────────────────────────────
  _panel(cx, cy, w, h) {
    const g = this.add.graphics();
    g.fillStyle(0x060b16, 0.97); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 8);
    g.lineStyle(2, COLORS.primary, 0.85); g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 8);
  }

  _closeBtn(cx, y) {
    const bg = this.add.rectangle(cx, y, 208, 48, 0x0c1622).setStrokeStyle(1, COLORS.primary, 0.75).setInteractive();
    this.add.text(cx, y, 'ЗАКРЫТЬ', { ...TF, fontSize: '17px', color: '#3ac0d0' }).setOrigin(0.5);
    bg.on('pointerover', () => bg.setFillStyle(0x162638));
    bg.on('pointerout',  () => bg.setFillStyle(0x0c1622));
    bg.on('pointerdown', (pointer, lx, ly, event) => { if (event) event.stopPropagation(); this.close(); });
  }
}
