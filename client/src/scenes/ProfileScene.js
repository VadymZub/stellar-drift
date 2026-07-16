import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { COLORS, UI_RES, CORP_META } from '../constants.js';
import { i18n } from '../i18n.js';
import { profileGetMine, profileUpdate, apiGet, getUsername, changePassword, changeEmail, changeUsername, setSession, verifyEmail, resendVerification } from '../api.js';
import { SHIP_BY_KEY } from '../ships.js';

// Вкладки: Профиль (текстовые поля + приватность + поиск чужого профиля) / Аккаунт
// (ник/пароль/email + любимый корабль + живая статистика: корпорация/звание/опыт/
// честь/наигранное время/победы в PvP — см. диалог "вкладка корабль → в аккаунт").
// Текстовые поля — HTML <input>, наложенные поверх канваса (тот же приём, что чат-инпут
// и инпут приглашения в группу в HudScene) — у Phaser нет нативного текстового ввода.
export default class ProfileScene extends Phaser.Scene {
  constructor() { super('ProfileScene'); }

  create() {
    const gs = this.scene.get('GameScene');
    this._gs = gs;
    const W = this.scale.width, H = this.scale.height;
    this._F = (sz, c) => ({ fontFamily: 'Inter, sans-serif',    fontSize: sz, color: c, resolution: UI_RES });
    this._O = (sz, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: sz, color: c, resolution: UI_RES });

    this._draft = {
      display_name: '', country: '', city: '', goal: '', favorite_games: '',
      social_links: { discord: '', telegram: '', steam: '' },
      favorite_ship_key: null, privacy: 'everyone',
    };
    this._dirty = new Set();
    this._domInputs = [];
    // Общий <form>-контейнер для всех DOM-инпутов сцены — без него браузер пишет в
    // консоль "Password field is not contained in a form" на полях смены пароля/email
    // в аккаунт-вкладке (тот же приём, что уже применялся в LoginScene._buildOverlay).
    this._domForm = document.createElement('form');
    this._domForm.addEventListener('submit', e => e.preventDefault());
    Object.assign(this._domForm.style, { position: 'fixed', top: '0', left: '0', margin: '0', padding: '0' });
    document.body.appendChild(this._domForm);
    this._tabObjs = [[], []];
    this._activeTab = 0;
    this._tabBtns = [];
    this._tabScroll = {};
    this._tabMaxScroll = {};

    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.55).setOrigin(0).setDepth(0).setInteractive();
    dim.on('pointerdown', () => this._close());

    // Высота панели фиксирована (комфортно влезает в обычное окно) — вкладка Аккаунт
    // теперь самая длинная (сюда переехал Корабль + блок статистики, см. диалог) и
    // почти всегда не умещается целиком, поэтому её тело скроллится колесом мыши
    // (см. _setupTabScroll/wheel-обработчик ниже) вместо бесконечного роста PH.
    // 850, не 820: при 820 вкладка Профиль (лукап-кнопка внизу) не помещалась целиком
    // (нужен был скролл всего на ~22px) — нет настоящего клипа (см. _applyTabVisibility),
    // поэтому кнопка визуально налезала на нижнюю панель Сохранить/Отмена (баг найден вживую).
    const PW = 520, PH = 850;
    const px = Math.round((W - PW) / 2), py = Math.round((H - PH) / 2);
    this._px = px; this._py = py;

    const panel = this.add.graphics().setDepth(1);
    panel.fillStyle(0x03080f, 0.97);
    panel.fillRoundedRect(px, py, PW, PH, 10);
    panel.lineStyle(1.5, COLORS.primary, 0.7);
    panel.strokeRoundedRect(px, py, PW, PH, 10);
    panel.fillStyle(0x081422, 1);
    panel.fillRoundedRect(px, py, PW, 34, { tl: 10, tr: 10, bl: 0, br: 0 });

    this.add.rectangle(px, py, PW, PH, 0, 0.001).setOrigin(0).setDepth(1).setInteractive();

    this.add.text(px + PW / 2, py + 17, i18n.t('profile.title'), this._O('13px', '#4dd0e1')).setOrigin(0.5).setDepth(2);
    const closeBtn = this.add.text(px + PW - 14, py + 17, '✕', this._F('14px', '#335566'))
      .setOrigin(1, 0.5).setDepth(2).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ef5350'));
    closeBtn.on('pointerout',  () => closeBtn.setColor('#335566'));
    closeBtn.on('pointerdown', () => this._close());

    const tabLabels = ['profile.tab_identity', 'profile.tab_account'].map(k => i18n.t(k));
    const TBY = py + 34, TBH = 30;
    const TBW = Math.floor(PW / tabLabels.length);
    this.add.graphics().setDepth(1).fillStyle(0x050d18, 1).fillRect(px, TBY, PW, TBH);

    tabLabels.forEach((label, i) => {
      const tx  = px + i * TBW;
      const btn = this.add.rectangle(tx, TBY, TBW, TBH, 0x050d18, 1).setOrigin(0).setDepth(2)
        .setInteractive({ useHandCursor: true });
      const lbl = this.add.text(tx + TBW / 2, TBY + TBH / 2, label, this._F('10px', '#4a8899')).setOrigin(0.5).setDepth(3);
      btn.on('pointerover', () => { if (this._activeTab !== i) { btn.setFillStyle(0x091828); lbl.setColor('#7ec8d8'); } });
      btn.on('pointerout',  () => { if (this._activeTab !== i) { btn.setFillStyle(0x050d18); lbl.setColor('#4a8899'); } });
      btn.on('pointerdown', () => this._switchTab(i));
      this._tabBtns.push({ btn, lbl });
    });

    this.add.graphics().setDepth(2).lineStyle(1, COLORS.primary, 0.3)
      .lineBetween(px, TBY + TBH, px + PW, TBY + TBH);

    const contentY = TBY + TBH + 14;
    const LX = px + 18, RX = px + PW - 18;

    // Bottom buttons
    const btnY = py + PH - 46, BW = 150, BH = 34;

    // Видимая область тела панели (между шапкой вкладок и нижней панелью Сохранить/
    // Отмена) — контент вкладки, не помещающийся сюда, скроллится колесом мыши.
    this._viewportTop = contentY;
    this._viewportBottom = btnY - 10;
    this._viewportH = this._viewportBottom - this._viewportTop;

    const identityBottom = this._buildIdentityTab(contentY, LX, RX);
    const accountBottom  = this._buildAccountTab(contentY, LX, RX);
    this._setupTabScroll(0, identityBottom);
    this._setupTabScroll(1, accountBottom);

    this.input.on('wheel', (pointer, _over, _dx, dy) => {
      const max = this._tabMaxScroll[this._activeTab] || 0;
      if (max <= 0) return;
      if (pointer.x < px || pointer.x > px + PW || pointer.y < this._viewportTop || pointer.y > this._viewportBottom) return;
      const next = Phaser.Math.Clamp((this._tabScroll[this._activeTab] || 0) + dy * 0.5, 0, max);
      this._tabScroll[this._activeTab] = next;
      for (const o of this._tabObjs[this._activeTab]) if (o._baseY != null) o.y = o._baseY - next;
      this._applyTabVisibility();
      // Тот же реприменение, что в _switchTab — иначе секция подтверждения email
      // при скролле "оживает" по попаданию в видимую область, даже когда уже скрыта.
      this._setVerifySectionVisible(!!this._emailUnverified);
      this._layoutDomInputs();
    });

    this._applyTabVisibility();
    this._updateTabBtns();
    const saveX = px + PW / 2 - BW - 8, cancelX = px + PW / 2 + 8;

    const saveRect = this.add.rectangle(saveX, btnY, BW, BH, 0x0a2030, 1).setOrigin(0).setDepth(9)
      .setStrokeStyle(1, COLORS.primary, 0.8).setInteractive({ useHandCursor: true });
    this._saveTxt = this.add.text(saveX + BW / 2, btnY + BH / 2, i18n.t('profile.save'), this._F('12px', '#4dd0e1'))
      .setOrigin(0.5).setDepth(10);
    saveRect.on('pointerover', () => saveRect.setFillStyle(0x102a40));
    saveRect.on('pointerout',  () => saveRect.setFillStyle(0x0a2030));
    saveRect.on('pointerdown', () => this._save());

    const cancelRect = this.add.rectangle(cancelX, btnY, BW, BH, 0x12080a, 1).setOrigin(0).setDepth(9)
      .setStrokeStyle(1, 0x5a2a2a, 0.7).setInteractive({ useHandCursor: true });
    this.add.text(cancelX + BW / 2, btnY + BH / 2, i18n.t('profile.cancel'), this._F('12px', '#aa6666'))
      .setOrigin(0.5).setDepth(10);
    cancelRect.on('pointerover', () => cancelRect.setFillStyle(0x200f10));
    cancelRect.on('pointerout',  () => cancelRect.setFillStyle(0x12080a));
    cancelRect.on('pointerdown', () => this._close());

    const btnBg = this.add.graphics().setDepth(8);
    btnBg.fillStyle(0x03080f, 0.97);
    btnBg.fillRect(px + 1, btnY - 10, PW - 2, BH + 20);
    btnBg.lineStyle(1, COLORS.primary, 0.15);
    btnBg.lineBetween(px + 1, btnY - 10, px + PW - 1, btnY - 10);

    this.input.keyboard.on('keydown-ESC', () => this._close());
    this.scale.on('resize', this._onResize = () => this._layoutDomInputs());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this._onResize);
      for (const d of this._domInputs) d.el.remove();
      this._domInputs = [];
      this._domForm?.remove();
    });

    this._layoutDomInputs();
    this._loadProfile();
  }

  // ── Identity tab (DOM text inputs over the canvas) ──────────────────
  _buildIdentityTab(y, LX, RX) {
    const T = 0;
    for (const [key, labelKey] of [
      ['display_name',   'profile.display_name'],
      ['country',        'profile.country'],
      ['city',            'profile.city'],
      ['goal',            'profile.goal'],
      ['favorite_games',  'profile.favorite_games'],
    ]) {
      this._addTextRow(key, i18n.t(labelKey), T, LX, RX, y, key === 'country' ? 2 : 300);
      y += 46;
    }
    y += 8;
    this._track(this.add.graphics().setDepth(3).lineStyle(1, COLORS.primary, 0.18).lineBetween(LX, y, RX, y), T);
    y += 16;
    for (const [key, labelKey] of [
      ['social_links.discord',  'profile.social_discord'],
      ['social_links.telegram', 'profile.social_telegram'],
      ['social_links.steam',    'profile.social_steam'],
    ]) {
      this._addTextRow(key, i18n.t(labelKey), T, LX, RX, y, 60);
      y += 46;
    }
    y += 8;
    this._track(this.add.graphics().setDepth(3).lineStyle(1, COLORS.primary, 0.18).lineBetween(LX, y, RX, y), T);
    y += 16;

    y = this._buildPrivacyTab(y, LX, RX, T);

    y += 8;
    this._track(this.add.graphics().setDepth(3).lineStyle(1, COLORS.primary, 0.18).lineBetween(LX, y, RX, y), T);
    y += 18;

    // ── Просмотр профиля другого игрока по нику ──────────────────────────
    this._track(this.add.text(LX, y, i18n.t('profile.lookup_title'), this._F('12px', '#4dd0e1')).setDepth(4), T);
    y += 24;
    const lookupInput = this._makeAccountInput(T, LX, RX, y, i18n.t('profile.lookup_placeholder'), 'text'); y += 34;
    const lookupMsg = this._track(this.add.text(LX, y, '', { ...this._F('10px', '#ef5350'), wordWrap: { width: RX - LX } }).setDepth(4), T);
    y += 22;
    this._makeAccountButton(T, LX, y, i18n.t('profile.lookup_button'), () => {
      lookupMsg.setColor('#ef5350').setText('');
      const name = lookupInput.value.trim();
      if (!name) return;
      this._openProfileView(name);
    });
    y += 42;
    return y;
  }

  // ProfileViewScene должна каждый раз стартовать с чистыми данными для нового ника —
  // stop-then-launch, а не голый launch() поверх уже открытой (тот же приём, что в
  // HudScene/ClanScene, см. диалог "не вижу где посмотреть профиль другого игрока").
  _openProfileView(name) {
    if (this.scene.isActive('ProfileViewScene')) this.scene.stop('ProfileViewScene');
    // ProfileViewScene рендерится поверх канваса ProfileScene, но DOM-инпуты (position:fixed,
    // z-index:1000) о сценах ничего не знают и просвечивают сквозь неё — прячем их, пока
    // окно чужого профиля открыто, и возвращаем при его закрытии (см. диалог, баг найден вживую).
    for (const d of this._domInputs) d.el.style.display = 'none';
    this.scene.launch('ProfileViewScene', { viewName: name });
    this.scene.get('ProfileViewScene').events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._layoutDomInputs());
  }

  _addTextRow(key, label, tabIdx, LX, RX, y, maxLen) {
    this._track(this.add.text(LX, y, label, this._F('11px', '#7eb8c8')).setDepth(4), tabIdx);
    const rowY = y + 18, rowH = 26;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = maxLen;
    Object.assign(input.style, {
      position: 'fixed', background: '#080d1c', border: '1px solid #1e3a4a',
      color: '#cfd8dc', fontFamily: 'inherit', padding: '0 8px', borderRadius: '4px',
      outline: 'none', boxSizing: 'border-box', zIndex: '1000', display: 'none',
    });
    input.addEventListener('focus', () => input.style.borderColor = '#4dd0e1');
    input.addEventListener('blur',  () => input.style.borderColor = '#1e3a4a');
    // Без этого ввод текста (например буква "g"/"u"/"1"-"9") долетает до глобальных
    // хоткеев GameScene (гараж/профиль/слоты скиллов) и до Ctrl-огня — тот же приём,
    // что и в HudScene._connectChatWS для чат-инпута.
    input.addEventListener('keydown', e => { e.stopPropagation(); e.stopImmediatePropagation(); });
    input.addEventListener('input', () => this._setDraftField(key, input.value));
    this._domForm.appendChild(input);
    this._domInputs.push({ el: input, key, tabIdx, rect: { x: LX, y: rowY, w: RX - LX, h: rowH } });
  }

  _setDraftField(key, value) {
    if (key.startsWith('social_links.')) {
      const sub = key.split('.')[1];
      this._draft.social_links[sub] = value;
      this._dirty.add('social_links');
    } else {
      this._draft[key] = key === 'country' ? value.toUpperCase() : value;
      this._dirty.add(key);
    }
  }

  _layoutDomInputs() {
    if (!this.game?.canvas) return;
    // ProfileViewScene рендерится поверх канваса ProfileScene, но DOM-инпуты (position:fixed,
    // z-index:1000) о сценах ничего не знают — при простом открытии их прятал _openProfileView,
    // но следующий resize (смена разрешения экрана) снова вызывал этот метод и без этой
    // проверки заново показывал их поверх открытого чужого профиля (см. диалог, баг найден вживую).
    if (this.scene.isActive('ProfileViewScene')) {
      for (const d of this._domInputs) d.el.style.display = 'none';
      return;
    }
    const r = this.game.canvas.getBoundingClientRect();
    const sx = r.width / this.scale.width, sy = r.height / this.scale.height;
    const scroll = this._tabScroll[this._activeTab] || 0;
    for (const d of this._domInputs) {
      const { el, tabIdx, rect } = d;
      if (tabIdx !== this._activeTab || d.hidden) { el.style.display = 'none'; continue; }
      const y = (d._baseY ?? rect.y) - scroll;
      // Скроллом уехавшие ЗА ПРЕДЕЛЫ видимой области (целиком ИЛИ частично) инпуты —
      // просто скрываем. Полное содержание, не "любое пересечение": DOM-инпуты — это
      // обычные HTML-элементы поверх всего канваса (z-index:1000), их не прикрывает
      // непрозрачная плашка панели Сохранить/Отмена (та прикрывает только Phaser-объекты,
      // которые ниже её по depth) — при частичном перекрытии инпут рисовался поверх
      // кнопок снизу (см. диалог, баг найден вживую на реальном аккаунте).
      if (this._viewportTop != null && (y < this._viewportTop || y + rect.h > this._viewportBottom)) {
        el.style.display = 'none'; continue;
      }
      Object.assign(el.style, {
        display: 'block',
        left:   `${Math.round(r.left + rect.x * sx)}px`,
        top:    `${Math.round(r.top  + y * sy)}px`,
        width:  `${Math.round(rect.w * sx)}px`,
        height: `${Math.round(rect.h * sy)}px`,
        fontSize: `${Math.round(12 * sy)}px`,
      });
    }
  }

  // Включает скролл для вкладки, если её контент не влезает в видимую область
  // тела панели (_viewportH) — без этого длинные вкладки требовали бы бесконечно
  // растущий PH (см. диалог, PH уже трижды подрастал раньше конкретно из-за этого).
  _setupTabScroll(tabIdx, contentBottom) {
    const totalH = contentBottom - this._viewportTop;
    const maxScroll = Math.max(0, Math.round(totalH - this._viewportH));
    this._tabMaxScroll[tabIdx] = maxScroll;
    if (maxScroll <= 0) return;
    for (const o of this._tabObjs[tabIdx]) o._baseY = o.y;
    for (const d of this._domInputs) if (d.tabIdx === tabIdx) d._baseY = d.rect.y;
  }

  // ── Любимый корабль: авто-подсказка по наигранному времени + выпадающий список
  // (не построчный список — иначе высота вкладки растёт линейно от числа купленных
  // кораблей, см. диалог) — часть вкладки Аккаунт, см. _buildAccountTab. ────────
  _buildShipSection(y, LX, RX, T) {
    const gs = this._gs;
    const owned = [...(gs.ownedShips || [])].filter(k => SHIP_BY_KEY[k]);
    const playTime = gs._shipPlayTimeSec || {};
    this._autoShipKey = Object.entries(playTime).sort((a, b) => b[1] - a[1])[0]?.[0]
      || owned.slice().sort((a, b) => (gs.shipLevels?.[b] || 0) - (gs.shipLevels?.[a] || 0))[0]
      || null;

    if (this._autoShipKey && SHIP_BY_KEY[this._autoShipKey]) {
      const hrs = Math.round(((playTime[this._autoShipKey] || 0) / 3600) * 10) / 10;
      this._track(this.add.text(LX, y,
        `${i18n.t('profile.suggested_ship')}: ${i18n.t(SHIP_BY_KEY[this._autoShipKey].nameKey)}` + (hrs > 0 ? ` (${hrs} ч)` : ''),
        this._F('11px', '#4dffa0')).setDepth(4), T);

      const useBtn = this._track(this.add.text(RX, y, i18n.t('profile.use_as_favorite'), this._F('11px', '#4dd0e1'))
        .setOrigin(1, 0).setDepth(4).setInteractive({ useHandCursor: true }), T);
      useBtn.on('pointerdown', () => {
        this._draft.favorite_ship_key = this._autoShipKey;
        this._dirty.add('favorite_ship_key');
        if (this._shipSelect) this._shipSelect.value = this._autoShipKey;
      });
      y += 26;
    }

    y += 8;
    const select = document.createElement('select');
    Object.assign(select.style, {
      position: 'fixed', background: '#080d1c', border: '1px solid #1e3a4a',
      color: '#cfd8dc', fontFamily: 'inherit', padding: '0 6px', borderRadius: '4px',
      outline: 'none', boxSizing: 'border-box', zIndex: '1000', display: 'none',
    });
    for (const key of owned) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = i18n.t(SHIP_BY_KEY[key].nameKey);
      select.appendChild(opt);
    }
    select.addEventListener('keydown', e => { e.stopPropagation(); e.stopImmediatePropagation(); });
    select.addEventListener('change', () => {
      this._draft.favorite_ship_key = select.value;
      this._dirty.add('favorite_ship_key');
    });
    this._domForm.appendChild(select);
    this._domInputs.push({ el: select, key: null, tabIdx: T, rect: { x: LX, y, w: RX - LX, h: 26 } });
    if (this._draft.favorite_ship_key) select.value = this._draft.favorite_ship_key;
    this._shipSelect = select;
    y += 34;
    return y;
  }

  // ── Privacy (часть вкладки Профиль, ниже соцсетей) ──────────────────
  _buildPrivacyTab(y, LX, RX, T) {
    this._track(this.add.text(LX, y, i18n.t('profile.tab_privacy'), this._F('12px', '#4dd0e1')).setDepth(4), T);
    y += 24;
    const opts = [
      ['everyone', 'profile.privacy_everyone'],
      ['friends',  'profile.privacy_friends'],
      ['nobody',   'profile.privacy_nobody'],
    ];
    this._privacyRows = [];
    for (const [val, labelKey] of opts) {
      const RH = 40;
      const bg = this._track(this.add.rectangle(LX, y, RX - LX, RH - 6, 0x040c18).setOrigin(0).setDepth(3)
        .setStrokeStyle(1, 0x1a3040, 0.6).setInteractive({ useHandCursor: true }), T);
      this._track(this.add.text(LX + 12, y + (RH - 6) / 2, i18n.t(labelKey), this._F('12px', '#cfe9ee')).setOrigin(0, 0.5).setDepth(4), T);
      const mark = this._track(this.add.text(RX - 12, y + (RH - 6) / 2, '', this._F('12px', '#4dd0e1')).setOrigin(1, 0.5).setDepth(4), T);
      bg.on('pointerdown', () => {
        this._draft.privacy = val;
        this._dirty.add('privacy');
        this._refreshPrivacyRows();
      });
      this._privacyRows.push({ val, bg, mark });
      y += RH;
    }
    return y;
  }

  _refreshPrivacyRows() {
    for (const row of (this._privacyRows || [])) {
      const active = row.val === this._draft.privacy;
      row.bg.setStrokeStyle(1, active ? COLORS.primary : 0x1a3040, active ? 1 : 0.6);
      row.mark.setText(active ? '✓' : '');
    }
  }

  // ── Account tab: любимый корабль + статистика + ник/пароль/email ──
  _buildAccountTab(y, LX, RX) {
    const T = 1;
    const gs = this._gs;

    // ── Любимый корабль ──
    this._track(this.add.text(LX, y, i18n.t('profile.tab_ship'), this._F('12px', '#4dd0e1')).setDepth(4), T);
    y += 24;
    y = this._buildShipSection(y, LX, RX, T);

    y += 8;
    this._track(this.add.graphics().setDepth(3).lineStyle(1, COLORS.primary, 0.18).lineBetween(LX, y, RX, y), T);
    y += 18;

    // ── Статистика — живые данные из GameScene (тот же клиент-доверенный прогресс,
    // что и весь остальной аккаунт, см. PlayerState.state), кроме побед в PvP
    // (серверный AuditLog, см. profileGetMine().pvp_wins ниже) ──────────────────
    this._track(this.add.text(LX, y, i18n.t('profile.stats_title'), this._F('12px', '#4dd0e1')).setDepth(4), T);
    y += 24;
    const corpMeta = CORP_META[gs.playerCorp] || CORP_META.neutral;
    const totalPlayHrs = Math.round((Object.values(gs._shipPlayTimeSec || {}).reduce((a, b) => a + b, 0) / 3600) * 10) / 10;
    const statRow = (label, value, color) => {
      this._track(this.add.text(LX, y, label, this._F('11px', '#7eb8c8')).setDepth(4), T);
      this._track(this.add.text(RX, y, value, this._F('12px', color || '#cfe9ee')).setOrigin(1, 0).setDepth(4), T);
      y += 24;
    };
    statRow(i18n.t('profile.corp_current'), corpMeta.label, corpMeta.color);
    statRow(i18n.t('profile.rank'), gs.pilotRank?.name || '—');
    statRow(i18n.t('profile.xp'), Math.round(gs.pilotXp || 0).toLocaleString());
    statRow(i18n.t('profile.honor'), Math.round(gs.pilotHonor || 0).toLocaleString());
    statRow(i18n.t('profile.playtime'), totalPlayHrs > 0 ? `${totalPlayHrs} ч` : '—');
    this._track(this.add.text(LX, y, i18n.t('profile.pvp_wins'), this._F('11px', '#7eb8c8')).setDepth(4), T);
    this._pvpWinsTxt = this._track(this.add.text(RX, y, '…', this._F('12px', '#cfe9ee')).setOrigin(1, 0).setDepth(4), T);
    y += 24;

    y += 8;
    this._track(this.add.graphics().setDepth(3).lineStyle(1, COLORS.primary, 0.18).lineBetween(LX, y, RX, y), T);
    y += 18;

    this._track(this.add.text(LX, y, 'Имя игрока', this._F('11px', '#7eb8c8')).setDepth(4), T);
    const usernameTxt = this._track(this.add.text(LX, y + 18, getUsername(), this._F('13px', '#cfe9ee')).setDepth(4), T);
    y += 40;

    // ── Смена ника (без email-верификации — раз в сутки, см. диалог) ──
    const newNameInput = this._makeAccountInput(T, LX, RX, y, 'Новый ник', 'text'); y += 34;
    const nameMsg = this._track(this.add.text(LX, y, '', { ...this._F('10px', '#ef5350'), wordWrap: { width: RX - LX } }).setDepth(4), T);
    y += 22;
    this._makeAccountButton(T, LX, y, 'Сменить ник', async () => {
      nameMsg.setColor('#ef5350').setText('');
      const newName = newNameInput.value.trim();
      if (!newName) return;
      try {
        const data = await changeUsername(newName);
        setSession(data.access_token, data.username);
        usernameTxt.setText(data.username);
        newNameInput.value = '';
        nameMsg.setColor('#66bb6a').setText('Ник изменён — следующая смена через сутки');
        // chat_manager/group_manager на сервере держат имя в памяти с момента подключения
        // (не перечитывают из БД) — переподключаем WS, иначе друзья/чат видят старый ник
        // до следующего входа. Тот же реконнект-путь, что и при обрыве связи (ws.onclose).
        this.scene.get('HudScene')?._chatWS?.close();
      } catch (e) { nameMsg.setColor('#ef5350').setText(e.message || 'Ошибка'); }
    });
    y += 42;

    this._track(this.add.graphics().setDepth(3).lineStyle(1, COLORS.primary, 0.18).lineBetween(LX, y, RX, y), T);
    y += 18;

    this._track(this.add.text(LX, y, i18n.t('profile.email_current'), this._F('11px', '#7eb8c8')).setDepth(4), T);
    this._accountEmailTxt = this._track(this.add.text(LX, y + 18, '…', this._F('13px', '#cfe9ee')).setDepth(4), T);
    y += 34;
    this._accountVerifiedTxt = this._track(this.add.text(LX, y, '', this._F('10px', '#ffb74d')).setDepth(4), T);
    y += 20;

    // ── Подтверждение email кодом из письма ──────────────────────────────
    // Раньше код можно было ввести только сразу после логина (гейт в LoginScene) —
    // если email сменили ПРЯМО В ИГРЕ (см. "Сменить email" ниже) или пропустили тот
    // экран, ввести код было негде без релогина (см. диалог). Секция всегда строится
    // (резервирует место), но видима только если email есть и не подтверждён —
    // см. _setVerifySectionVisible, выставляется после ответа /auth/me ниже.
    const codeInput = this._makeAccountInput(T, LX, RX, y, 'Код из письма', 'text'); y += 34;
    const verifyMsg = this._track(this.add.text(LX, y, '', { ...this._F('10px', '#ef5350'), wordWrap: { width: RX - LX } }).setDepth(4), T);
    y += 22;
    const { btn: verifyBtn, label: verifyBtnLbl } = this._makeAccountButton(T, LX, y, 'Подтвердить email', async () => {
      verifyMsg.setColor('#ef5350').setText('');
      const code = codeInput.value.trim();
      if (!code) return;
      try {
        await verifyEmail(code);
        verifyMsg.setColor('#66bb6a').setText('Email подтверждён');
        this._accountVerifiedTxt?.setText('');
        this._emailUnverified = false;
        codeInput.value = '';
      } catch (e) { verifyMsg.setColor('#ef5350').setText(e.message || 'Неверный код'); }
    });
    const resendTxt = this._track(this.add.text(LX + 160, y + 13, 'отправить код повторно', this._F('10px', '#607d8b'))
      .setOrigin(0, 0.5).setDepth(4).setInteractive({ useHandCursor: true }), T);
    resendTxt.on('pointerover', () => resendTxt.setColor('#4dd0e1'));
    resendTxt.on('pointerout',  () => resendTxt.setColor('#607d8b'));
    resendTxt.on('pointerdown', async () => {
      verifyMsg.setColor('#66bb6a').setText('');
      try { await resendVerification(); verifyMsg.setColor('#66bb6a').setText('Код отправлен повторно'); }
      catch (e) { verifyMsg.setColor('#ef5350').setText(e.message || 'Ошибка'); }
    });
    y += 42;

    this._verifyPhaserObjs = [verifyMsg, verifyBtn, verifyBtnLbl, resendTxt];
    this._verifyDomEntry = this._domInputs.find(d => d.el === codeInput);
    this._setVerifySectionVisible(false); // скрыто, пока /auth/me не подтвердит, что нужно

    apiGet('/auth/me').then(d => {
      this._accountEmailTxt?.setText(d.email || '—');
      const unverified = !!(d.email && !d.email_verified);
      this._accountVerifiedTxt?.setText(unverified ? '⚠ Email не подтверждён' : '');
      this._emailUnverified = unverified;
      this._setVerifySectionVisible(unverified);
    }).catch(() => this._accountEmailTxt?.setText('—'));

    y += 8;
    this._track(this.add.graphics().setDepth(3).lineStyle(1, COLORS.primary, 0.18).lineBetween(LX, y, RX, y), T);
    y += 18;

    // ── Смена пароля ──
    this._track(this.add.text(LX, y, 'Сменить пароль', this._F('12px', '#4dd0e1')).setDepth(4), T);
    y += 24;
    const curPassInput = this._makeAccountInput(T, LX, RX, y, 'Текущий пароль', 'password'); y += 34;
    const newPassInput = this._makeAccountInput(T, LX, RX, y, 'Новый пароль', 'password'); y += 34;
    const passMsg = this._track(this.add.text(LX, y, '', { ...this._F('10px', '#ef5350'), wordWrap: { width: RX - LX } }).setDepth(4), T);
    y += 22;
    this._makeAccountButton(T, LX, y, 'Сменить пароль', async () => {
      passMsg.setColor('#ef5350').setText('');
      try {
        await changePassword(curPassInput.value, newPassInput.value);
        passMsg.setColor('#66bb6a').setText('Пароль изменён');
        curPassInput.value = ''; newPassInput.value = '';
      } catch (e) { passMsg.setColor('#ef5350').setText(e.message || 'Ошибка'); }
    });
    y += 42;

    // ── Смена email ──
    this._track(this.add.graphics().setDepth(3).lineStyle(1, COLORS.primary, 0.18).lineBetween(LX, y, RX, y), T);
    y += 18;
    this._track(this.add.text(LX, y, 'Сменить email', this._F('12px', '#4dd0e1')).setDepth(4), T);
    y += 24;
    const curPass2Input  = this._makeAccountInput(T, LX, RX, y, 'Текущий пароль', 'password'); y += 34;
    const newEmailInput  = this._makeAccountInput(T, LX, RX, y, 'Новый email', 'email'); y += 34;
    const emailMsg = this._track(this.add.text(LX, y, '', { ...this._F('10px', '#ef5350'), wordWrap: { width: RX - LX } }).setDepth(4), T);
    y += 22;
    this._makeAccountButton(T, LX, y, 'Сменить email', async () => {
      emailMsg.setColor('#ef5350').setText('');
      try {
        await changeEmail(curPass2Input.value, newEmailInput.value);
        emailMsg.setColor('#66bb6a').setText('Email изменён — на новый адрес отправлен код подтверждения');
        this._accountEmailTxt?.setText(newEmailInput.value);
        this._accountVerifiedTxt?.setText('⚠ Email не подтверждён');
        this._emailUnverified = true;
        this._setVerifySectionVisible(true);
        curPass2Input.value = ''; newEmailInput.value = '';
      } catch (e) { emailMsg.setColor('#ef5350').setText(e.message || 'Ошибка'); }
    });
    y += 34;
    return y;
  }

  // DOM-инпут без привязки к this._draft (в отличие от _addTextRow) — смена пароля/email
  // это немедленное действие через свою кнопку, а не часть общего СОХРАНИТЬ снизу панели.
  _makeAccountInput(tabIdx, LX, RX, y, placeholder, type) {
    const input = document.createElement('input');
    input.type = type;
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    Object.assign(input.style, {
      position: 'fixed', background: '#080d1c', border: '1px solid #1e3a4a',
      color: '#cfd8dc', fontFamily: 'inherit', padding: '0 8px', borderRadius: '4px',
      outline: 'none', boxSizing: 'border-box', zIndex: '1000', display: 'none',
    });
    input.addEventListener('focus', () => input.style.borderColor = '#4dd0e1');
    input.addEventListener('blur',  () => input.style.borderColor = '#1e3a4a');
    // Без этого ввод текста (например буква "g"/"u"/"1"-"9") долетает до глобальных
    // хоткеев GameScene (гараж/профиль/слоты скиллов) и до Ctrl-огня — тот же приём,
    // что и в HudScene._connectChatWS для чат-инпута.
    input.addEventListener('keydown', e => { e.stopPropagation(); e.stopImmediatePropagation(); });
    this._domForm.appendChild(input);
    this._domInputs.push({ el: input, key: null, tabIdx, rect: { x: LX, y, w: RX - LX, h: 26 } });
    return input;
  }

  _makeAccountButton(tabIdx, LX, y, label, onClick) {
    // depth 3 — иначе клик-блокер панели (depth 1, create()) перехватывает pointerdown
    // раньше кнопки (default depth 0), см. баг: клик визуально ничего не делал.
    const btn = this._track(this.add.rectangle(LX, y, 150, 26, 0x0a2030, 1).setOrigin(0).setDepth(3)
      .setStrokeStyle(1, COLORS.primary, 0.8).setInteractive({ useHandCursor: true }), tabIdx);
    const lbl = this._track(this.add.text(LX + 75, y + 13, label, this._F('11px', '#4dd0e1')).setOrigin(0.5).setDepth(5), tabIdx);
    btn.on('pointerdown', onClick);
    return { btn, label: lbl };
  }

  // Резервирует место в layout'е, но показывает секцию "подтвердить email" только
  // когда она реально нужна (email есть и не подтверждён) — см. _buildAccountTab.
  _setVerifySectionVisible(visible) {
    for (const o of (this._verifyPhaserObjs || [])) o?.setVisible(visible);
    if (this._verifyDomEntry) {
      this._verifyDomEntry.hidden = !visible;
      this._layoutDomInputs();
    }
  }

  // ── Tab switching ─────────────────────────────────────────────────────
  _switchTab(idx) {
    this._activeTab = idx;
    this._applyTabVisibility();
    this._updateTabBtns();
    // Блокет "показать все объекты таба" выше не знает про подусловно скрытые
    // элементы (код-подтверждение email видно только если email не подтверждён) —
    // без переприменения секция "оживала" при каждом переключении на АККАУНТ,
    // даже когда email уже подтверждён (см. диалог, баг найден вживую).
    this._setVerifySectionVisible(!!this._emailUnverified);
    this._layoutDomInputs();
  }

  // WebGL-рендерер игнорирует GameObject.setMask() (см. предупреждение Phaser
  // "not supported in WebGL" — было найдено вживую: кнопка "Сменить пароль"
  // рендерилась поверх хотбара при скролле), поэтому клипаем вручную —
  // скрываем объекты вне видимой области тела панели вместо настоящей маски.
  _applyTabVisibility() {
    for (let i = 0; i < this._tabObjs.length; i++) {
      const active = i === this._activeTab;
      for (const o of this._tabObjs[i]) {
        if (!active) { o.setVisible?.(false); continue; }
        if (o._baseY == null) { o.setVisible?.(true); continue; }
        const h = o.displayHeight || o.height || 20;
        o.setVisible?.(o.y + h >= this._viewportTop && o.y <= this._viewportBottom);
      }
    }
  }

  _updateTabBtns() {
    this._tabBtns.forEach(({ btn, lbl }, i) => {
      const active = i === this._activeTab;
      btn.setFillStyle(active ? 0x0d2035 : 0x050d18);
      lbl.setColor(active ? '#4dd0e1' : '#4a8899');
    });
  }

  _track(obj, tabIdx) {
    this._tabObjs[tabIdx].push(obj);
    return obj;
  }

  // ── Load / Save ───────────────────────────────────────────────────────
  async _loadProfile() {
    try {
      const p = await profileGetMine();
      this._draft.display_name   = p.display_name || '';
      this._draft.country        = p.country || '';
      this._draft.city           = p.city || '';
      this._draft.goal           = p.goal || '';
      this._draft.favorite_games = p.favorite_games || '';
      this._draft.social_links   = { discord: '', telegram: '', steam: '', ...(p.social_links || {}) };
      this._draft.favorite_ship_key = p.favorite_ship_key || this._autoShipKey || null;
      this._draft.privacy        = p.privacy || 'everyone';
      this._dirty.clear();
      this._pvpWinsTxt?.setText(String(p.pvp_wins ?? 0));
    } catch (e) {
      console.warn('[ProfileScene] profileGetMine failed (no server session? DEV profile?)', e.message);
      this._pvpWinsTxt?.setText('—');
    }
    for (const { el, key } of this._domInputs) {
      if (!key) continue; // инпуты аккаунта (смена пароля/email) не привязаны к _draft
      const val = key.startsWith('social_links.') ? this._draft.social_links[key.split('.')[1]] : this._draft[key];
      el.value = val || '';
    }
    if (this._shipSelect && this._draft.favorite_ship_key) this._shipSelect.value = this._draft.favorite_ship_key;
    this._refreshPrivacyRows();
  }

  async _save() {
    const payload = { favorite_ship_auto: this._autoShipKey };
    for (const key of this._dirty) {
      if (key === 'social_links') payload.social_links = this._draft.social_links;
      else payload[key] = this._draft[key];
    }
    this._saveTxt.setText(i18n.t('profile.saving'));
    try {
      await profileUpdate(payload);
      this._dirty.clear();
      this._saveTxt.setText(i18n.t('profile.saved'));
      this.time.delayedCall(900, () => this._saveTxt?.setText(i18n.t('profile.save')));
    } catch (e) {
      console.warn('[ProfileScene] save failed', e.message);
      this._saveTxt.setText(i18n.t('profile.save'));
    }
  }

  _close() {
    this.scene.stop();
  }
}
