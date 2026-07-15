import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';
import { mailInbox, mailMarkRead, mailThreads, getUsername } from '../api.js';

// Полноценная сцена (не HudScene-панель) — история сообщений потенциально длинная,
// чтение/ответ это осознанное действие "открыл почту", а не фоновый глазковый статус
// (см. план: тот же довод, что и у ClanScene/GarageScene против HudScene-плавающих окон).
//
// Писать можно ЛЮБОМУ игроку по нику (не только другу, см. диалог) — "Входящие"
// показывает реальные переписки (GET /player/pm/threads), а "Написать" принимает
// произвольный ник (плюс список друзей снизу как быстрый доступ).
export default class MailScene extends Phaser.Scene {
  constructor() { super('MailScene'); }

  create() {
    const hud = this.scene.get('HudScene');
    this._hud = hud;
    const W = this.scale.width, H = this.scale.height;
    this._F = (sz, c) => ({ fontFamily: 'Inter, sans-serif',    fontSize: sz, color: c, resolution: UI_RES });
    this._O = (sz, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: sz, color: c, resolution: UI_RES });

    this._activeTab = 0; // 0 = inbox, 1 = compose
    this._selectedUser = null;
    this._threadMsgs = [];
    this._threads = [];
    this._domInputs = [];

    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.55).setOrigin(0).setDepth(0).setInteractive();
    dim.on('pointerdown', () => this._close());

    const PW = 620, PH = 540;
    const px = Math.round((W - PW) / 2), py = Math.round((H - PH) / 2);
    this._px = px; this._py = py; this._PW = PW; this._PH = PH;

    const panel = this.add.graphics().setDepth(1);
    panel.fillStyle(0x03080f, 0.97);
    panel.fillRoundedRect(px, py, PW, PH, 10);
    panel.lineStyle(1.5, COLORS.primary, 0.7);
    panel.strokeRoundedRect(px, py, PW, PH, 10);
    panel.fillStyle(0x081422, 1);
    panel.fillRoundedRect(px, py, PW, 34, { tl: 10, tr: 10, bl: 0, br: 0 });

    this.add.rectangle(px, py, PW, PH, 0, 0.001).setOrigin(0).setDepth(1).setInteractive();

    this.add.text(px + PW / 2, py + 17, i18n.t('mail.title'), this._O('13px', '#4dd0e1')).setOrigin(0.5).setDepth(2);
    const closeBtn = this.add.text(px + PW - 14, py + 17, '✕', this._F('14px', '#335566'))
      .setOrigin(1, 0.5).setDepth(2).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ef5350'));
    closeBtn.on('pointerout',  () => closeBtn.setColor('#335566'));
    closeBtn.on('pointerdown', () => this._close());

    const tabLabels = [i18n.t('mail.tab_inbox'), i18n.t('mail.tab_compose')];
    const TBY = py + 34, TBH = 30, TBW = PW / 2;
    this.add.graphics().setDepth(1).fillStyle(0x050d18, 1).fillRect(px, TBY, PW, TBH);
    this._tabBtns = [];
    tabLabels.forEach((label, i) => {
      const tx = px + i * TBW;
      const btn = this.add.rectangle(tx, TBY, TBW, TBH, 0x050d18, 1).setOrigin(0).setDepth(2)
        .setInteractive({ useHandCursor: true });
      const lbl = this.add.text(tx + TBW / 2, TBY + TBH / 2, label, this._F('10px', '#4a8899')).setOrigin(0.5).setDepth(3);
      btn.on('pointerdown', () => this._switchTab(i));
      this._tabBtns.push({ btn, lbl });
    });
    this.add.graphics().setDepth(2).lineStyle(1, COLORS.primary, 0.3).lineBetween(px, TBY + TBH, px + PW, TBY + TBH);

    this._contentY = TBY + TBH + 10;
    this._contentH = py + PH - this._contentY - 10;
    this._listX = px + 12;
    this._listW = 170;
    this._paneX = this._listX + this._listW + 12;
    this._paneW = px + PW - 12 - this._paneX;

    this._listObjs = [];
    this._paneObjs = [];
    this._composeObjs = [];

    this._renderLeftColumn();
    this._renderPane();
    this._updateTabBtns();
    this._loadThreads();

    this.input.keyboard.on('keydown-ESC', () => this._close());
    this.scale.on('resize', this._onResize = () => this._layoutDomInputs());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this._onResize);
      for (const d of this._domInputs) d.el.remove();
      this._domInputs = [];
    });
  }

  _friends() {
    return (this._hud?._friendsList || []).filter(f => f.status === 'accepted');
  }

  _unreadFor(name) {
    return this._hud?.mailClient?.unreadByUser?.[name] || 0;
  }

  async _loadThreads() {
    try {
      const r = await mailThreads();
      this._threads = r.threads || [];
    } catch (e) {
      console.warn('[MailScene] mailThreads failed', e.message);
    }
    if (this._activeTab === 0) this._renderLeftColumn();
  }

  // Оптимистично двигает/добавляет партнёра в начало списка переписок — не ждём
  // следующего REST-обновления, чтобы отправленное/полученное сообщение сразу
  // отражалось на вкладке "Входящие".
  _touchThread(username, lastText, lastTs) {
    this._threads = this._threads.filter(t => t.username !== username);
    this._threads.unshift({ username, last_text: lastText, last_ts: lastTs, unread_count: 0 });
  }

  _switchTab(i) {
    this._activeTab = i;
    this._updateTabBtns();
    this._renderLeftColumn();
    this._layoutDomInputs();
  }

  _updateTabBtns() {
    this._tabBtns.forEach(({ btn, lbl }, i) => {
      const active = i === this._activeTab;
      btn.setFillStyle(active ? 0x0d2035 : 0x050d18);
      lbl.setColor(active ? '#4dd0e1' : '#4a8899');
    });
  }

  _renderLeftColumn() {
    for (const o of this._listObjs) o.destroy();
    this._listObjs = [];
    for (const o of this._composeObjs) { o.el ? o.el.remove() : o.destroy?.(); }
    this._composeObjs = [];
    this._domInputs = this._domInputs.filter(d => d.tag !== 'compose');

    if (this._activeTab === 1) this._renderComposeTab();
    else this._renderThreadList();
  }

  // ── Вкладка "Входящие" — реальные переписки ──────────────────────────
  _renderThreadList() {
    const track = o => { this._listObjs.push(o); return o; };

    if (!this._threads.length) {
      track(this.add.text(this._listX, this._contentY, i18n.t('mail.empty'),
        { ...this._F('11px', '#607d8b'), wordWrap: { width: this._listW } }).setDepth(3));
      return;
    }

    let y = this._contentY;
    const rowH = 40;
    for (const t of this._threads) {
      const unread = t.unread_count || this._unreadFor(t.username);
      const isSel = t.username === this._selectedUser;
      const bg = track(this.add.rectangle(this._listX, y, this._listW, rowH - 4, isSel ? 0x0d2a3a : 0x081018, 1)
        .setOrigin(0).setDepth(3).setStrokeStyle(1, isSel ? COLORS.primary : 0x1a3040, isSel ? 1 : 0.5)
        .setInteractive({ useHandCursor: true }));
      track(this.add.text(this._listX + 8, y + 6, t.username, this._F('11px', '#c8f0d0')).setDepth(4));
      const preview = (t.last_text || '').slice(0, 26);
      track(this.add.text(this._listX + 8, y + 21, preview, this._F('9px', '#5a7a85')).setDepth(4));
      if (unread > 0) {
        track(this.add.text(this._listX + this._listW - 8, y + 6, `${unread}`,
          this._F('10px', '#ef5350')).setOrigin(1, 0).setDepth(4));
      }
      bg.on('pointerdown', () => { this._openThread(t.username); });
      y += rowH;
    }
  }

  // ── Вкладка "Написать" — ЛЮБОЙ ник + быстрый выбор из друзей ─────────
  _renderComposeTab() {
    const track = o => { this._composeObjs.push(o); return o; };

    track(this.add.text(this._listX, this._contentY, i18n.t('mail.compose_hint'),
      { ...this._F('10px', '#7eb8c8'), wordWrap: { width: this._listW } }).setDepth(3));

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 50;
    input.placeholder = 'Ник игрока…';
    Object.assign(input.style, {
      position: 'fixed', background: '#080d1c', border: '1px solid #1e3a4a',
      color: '#cfd8dc', fontFamily: 'inherit', padding: '0 8px', borderRadius: '4px',
      outline: 'none', boxSizing: 'border-box', zIndex: '1000', display: 'none',
    });
    input.addEventListener('focus', () => input.style.borderColor = '#4dd0e1');
    input.addEventListener('blur',  () => input.style.borderColor = '#1e3a4a');
    document.body.appendChild(input);
    this._domInputs.push({ el: input, tag: 'compose', rect: { x: this._listX, y: this._contentY + 22, w: this._listW, h: 26 } });
    this._composeObjs.push({ el: input });

    const goBtn = track(this.add.rectangle(this._listX, this._contentY + 54, this._listW, 24, 0x0a2030, 1).setOrigin(0)
      .setDepth(3).setStrokeStyle(1, COLORS.primary, 0.8).setInteractive({ useHandCursor: true }));
    track(this.add.text(this._listX + this._listW / 2, this._contentY + 66, 'НАПИСАТЬ', this._F('10px', '#4dd0e1')).setOrigin(0.5).setDepth(4));
    const submit = () => {
      const name = input.value.trim();
      if (!name) return;
      this._activeTab = 0;
      this._updateTabBtns();
      this._renderLeftColumn();
      this._openThread(name);
    };
    goBtn.on('pointerdown', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });

    let y = this._contentY + 92;
    const friends = this._friends();
    if (friends.length) {
      track(this.add.text(this._listX, y, 'Быстрый выбор:', this._F('9px', '#5a7a85')).setDepth(3));
      y += 18;
      const rowH = 26;
      for (const f of friends) {
        const bg = track(this.add.rectangle(this._listX, y, this._listW, rowH - 4, 0x081018, 1).setOrigin(0)
          .setDepth(3).setStrokeStyle(1, 0x1a3040, 0.5).setInteractive({ useHandCursor: true }));
        track(this.add.text(this._listX + 8, y + (rowH - 4) / 2, f.name, this._F('10px', '#8aa0a8')).setOrigin(0, 0.5).setDepth(4));
        bg.on('pointerdown', () => { input.value = f.name; submit(); });
        y += rowH;
      }
    }

    this._layoutDomInputs();
  }

  // ── Правая колонка: переписка + ответ ────────────────────────────────
  _clearPane() {
    for (const o of this._paneObjs) o.destroy();
    this._paneObjs = [];
    for (const d of this._domInputs.filter(d => d.tag !== 'compose')) d.el.remove();
    this._domInputs = this._domInputs.filter(d => d.tag === 'compose');
  }

  _renderPane() {
    this._clearPane();
    const track = o => { this._paneObjs.push(o); return o; };

    if (!this._selectedUser) {
      track(this.add.text(this._paneX, this._contentY, i18n.t('mail.no_selection'),
        { ...this._F('12px', '#607d8b'), wordWrap: { width: this._paneW } }).setDepth(3));
      return;
    }

    track(this.add.text(this._paneX, this._contentY, this._selectedUser, this._O('13px', '#e0f7fa')).setDepth(3));

    const msgY = this._contentY + 26;
    const msgH = this._contentH - 26 - 40;
    if (!this._threadMsgs.length) {
      track(this.add.text(this._paneX, msgY, i18n.t('mail.empty'), this._F('11px', '#607d8b')).setDepth(3));
    } else {
      const myName = getUsername();
      let y = msgY;
      const maxRows = Math.floor(msgH / 34);
      const shown = this._threadMsgs.slice(-maxRows);
      for (const m of shown) {
        const mine = m.from_username === myName;
        const time = new Date(m.ts * 1000);
        const hhmm = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;
        track(this.add.text(this._paneX, y, `[${hhmm}] ${mine ? 'Вы' : m.from_username}:`,
          this._F('10px', mine ? '#4dd0e1' : '#ffb74d')).setDepth(3));
        track(this.add.text(this._paneX, y + 14, m.text,
          { ...this._F('11px', '#cfe9ee'), wordWrap: { width: this._paneW } }).setDepth(3));
        y += 34;
      }
    }

    this._sendErrorTxt = track(this.add.text(this._paneX, this._py + this._PH - 62, '', this._F('10px', '#ef5350')).setDepth(3));

    // Reply input (DOM, поверх канваса — тот же приём, что чат-инпут в HudScene)
    const replyY = this._py + this._PH - 44;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 500;
    input.placeholder = i18n.t('mail.body_placeholder');
    Object.assign(input.style, {
      position: 'fixed', background: '#080d1c', border: '1px solid #1e3a4a',
      color: '#cfd8dc', fontFamily: 'inherit', padding: '0 8px', borderRadius: '4px',
      outline: 'none', boxSizing: 'border-box', zIndex: '1000', display: 'none',
    });
    input.addEventListener('focus', () => input.style.borderColor = '#4dd0e1');
    input.addEventListener('blur',  () => input.style.borderColor = '#1e3a4a');
    input.addEventListener('keydown', e => { if (e.key === 'Enter') this._send(input); });
    document.body.appendChild(input);
    this._domInputs.push({ el: input, rect: { x: this._paneX, y: replyY, w: this._paneW - 70, h: 26 } });
    this._replyInput = input;

    const sendBtn = track(this.add.rectangle(this._px + this._PW - 12 - 56, replyY, 56, 26, 0x0a2030, 1).setOrigin(0)
      .setDepth(3).setStrokeStyle(1, COLORS.primary, 0.8).setInteractive({ useHandCursor: true }));
    track(this.add.text(this._px + this._PW - 12 - 28, replyY + 13, i18n.t('mail.send'), this._F('10px', '#4dd0e1')).setOrigin(0.5).setDepth(4));
    sendBtn.on('pointerdown', () => this._send(input));

    this._layoutDomInputs();
    input.focus();
  }

  _layoutDomInputs() {
    if (!this.game?.canvas) return;
    const r = this.game.canvas.getBoundingClientRect();
    const sx = r.width / this.scale.width, sy = r.height / this.scale.height;
    for (const { el, rect, tag } of this._domInputs) {
      const visible = tag === 'compose' ? this._activeTab === 1 : this._activeTab === 0;
      if (!visible) { el.style.display = 'none'; continue; }
      Object.assign(el.style, {
        display: 'block',
        left:   `${Math.round(r.left + rect.x * sx)}px`,
        top:    `${Math.round(r.top  + rect.y * sy)}px`,
        width:  `${Math.round(rect.w * sx)}px`,
        height: `${Math.round(rect.h * sy)}px`,
        fontSize: `${Math.round(12 * sy)}px`,
      });
    }
  }

  async _openThread(name) {
    this._selectedUser = name;
    this._threadMsgs = [];
    this._activeTab = 0;
    this._updateTabBtns();
    this._renderLeftColumn();
    this._renderPane();
    try {
      const r = await mailInbox(name);
      this._threadMsgs = r.messages || [];
      if (this._selectedUser !== name) return; // пользователь уже переключился на другого
      this._renderPane();

      const myName = getUsername();
      const unreadIds = this._threadMsgs.filter(m => m.to_username === myName && !m.read_at).map(m => m.id);
      if (unreadIds.length) {
        mailMarkRead(unreadIds).catch(() => {});
        const mc = this._hud?.mailClient;
        if (mc) {
          delete mc.unreadByUser[name];
          this._hud._mailUnread = mc.totalUnread;
          this._hud._updateSocialBtnStyles?.();
        }
      }
      const last = this._threadMsgs[this._threadMsgs.length - 1];
      this._touchThread(name, last?.text || '', last?.ts || 0);
      this._renderLeftColumn();
    } catch (e) {
      console.warn('[MailScene] mailInbox failed', e.message);
    }
  }

  _send(input) {
    const text = input.value.trim();
    if (!text || !this._selectedUser) return;
    const mc = this._hud?.mailClient;
    if (!mc) return;
    this._sendErrorTxt?.setText('');
    mc.sendPm(this._selectedUser, text);
    input.value = '';
    const ts = Date.now() / 1000;
    // Оптимистичное добавление в тред — эхо от сервера (см. HudScene ws.onmessage) придёт
    // тем же 'pm' типом и попадёт в чат-панель, но не обязано долистать до этого треда сразу.
    this._threadMsgs.push({
      id: -Date.now(), from_username: getUsername(), to_username: this._selectedUser,
      text, ts, read_at: null,
    });
    this._touchThread(this._selectedUser, text, ts);
    this._renderPane();
  }

  // Вызывается из HudScene.mailClient.onError, если сервер отклонил отправку (заблокирован,
  // игрок не найден, нельзя себе) — показывает причину прямо под полем ответа.
  onMailError(text) {
    // Откатываем последнее оптимистичное сообщение (отрицательный id, см. _send) — оно
    // не было реально доставлено, показывать его как "отправлено" было бы неверно.
    // _renderPane() пересоздаёт _sendErrorTxt заново — сначала перерисовываем тред,
    // ПОТОМ выставляем текст ошибки, иначе он тут же стирается.
    const last = this._threadMsgs[this._threadMsgs.length - 1];
    if (last && last.id < 0) {
      this._threadMsgs.pop();
      this._renderPane();
    }
    if (this._sendErrorTxt) this._sendErrorTxt.setText(text);
  }

  // Вызывается из HudScene.mailClient.onNewMail, если MailScene открыта — дозаписывает
  // сообщение в видимый тред без повторного fetch, либо просто обновляет список переписок.
  onLiveMessage(msg) {
    this._touchThread(msg.from, msg.text, Date.now() / 1000);
    if (msg.from !== this._selectedUser) { this._renderLeftColumn(); return; }
    this._threadMsgs.push({
      id: msg.id, from_username: msg.from, to_username: msg.to, text: msg.text, ts: Date.now() / 1000, read_at: null,
    });
    this._renderPane();
    this._renderLeftColumn();
    if (msg.id != null) {
      mailMarkRead([msg.id]).catch(() => {});
      const mc = this._hud?.mailClient;
      if (mc) { delete mc.unreadByUser[msg.from]; this._hud._mailUnread = mc.totalUnread; this._hud._updateSocialBtnStyles?.(); }
    }
  }

  _close() { this.scene.stop(); }
}
