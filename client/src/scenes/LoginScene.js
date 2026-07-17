import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';
import { apiPost, apiGet, setSession, clearSession, getToken, getUsername, verifyEmail, resendVerification, changeEmail } from '../api.js';
import { galaxy, SECTORS } from '../galaxy.js';
import * as vault from '../vault.js';

// Determine the sector the player should start in from their saved state.
// Mirrors the redirect logic in GameScene._applyLoadedState.
function _resolveStartSector(state) {
  if (!state) return 'helios_1';
  const sec = state.currentSector;
  if (sec && SECTORS[sec] && sec !== 'shadow_arena' && sec !== 'R-1-boss') return sec;
  const corp = state.playerCorp || 'helios';
  return corp === 'neutral' ? 'helios_1' : `${corp}_1`;
}

const DEV_MODE = true;

export default class LoginScene extends Phaser.Scene {
  constructor() { super('LoginScene'); }

  create() {
    const W = this.scale.width, H = this.scale.height;

    // Фон
    const bg = this.add.image(W / 2, H / 2, 'bg_login');
    bg.setScale(Math.max(W / bg.width, H / bg.height));
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.45).setOrigin(0);

    const title = this.add.text(W / 2, H * 0.22, 'STELLAR DRIFT', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '60px',
      color: '#4dd0e1',
      resolution: UI_RES,
    }).setOrigin(0.5);

    const subtitle = this.add.text(W / 2, H * 0.32, 'ВХОД В ИГРУ', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '16px',
      color: '#607d8b',
      resolution: UI_RES,
      letterSpacing: 4,
    }).setOrigin(0.5);

    // Логин-форма (HTML-оверлей, см. _buildOverlay) центрируется чистым CSS flexbox —
    // сама следует за реальным размером окна при ресайзе браузера. Фон/заголовок же
    // считались один раз по W/H на момент create() и оставались на месте — при ресайзе
    // окна форма пересобиралась на новом месте, а заголовок "уезжал" и налезал на неё
    // (баг из диалога: "смена размера страницы входа — элементы разъезжаются, налазят
    // один на другой"). Пересчитываем на resize — тот же приём, что и в
    // BackgroundScene.createBackground().
    // this.scale — глобальный ScaleManager (общий на всю игру, не привязан к этому
    // экземпляру сцены), поэтому слушатель обязательно снимаем сами: без .off() при
    // повторном create() (напр. возврат на экран логина) старые замыкания с уже
    // уничтоженными dim/bg/title/subtitle продолжают висеть и падают на следующий resize
    // ("Cannot read properties of null (reading 'setSize')" внутри Rectangle.setSize).
    this.scale.off('resize', this._onResize);
    this._onResize = (gs) => {
      bg.setPosition(gs.width / 2, gs.height / 2)
        .setScale(Math.max(gs.width / bg.width, gs.height / bg.height));
      dim.setSize(gs.width, gs.height);
      title.setPosition(gs.width / 2, gs.height * 0.22);
      subtitle.setPosition(gs.width / 2, gs.height * 0.32);
    };
    this.scale.on('resize', this._onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', this._onResize));

    this._buildOverlay(W, H);
  }

  _buildOverlay(W, H) {
    // DOM-оверлей — поверх canvas
    const wrap = document.createElement('div');
    wrap.id = 'login-overlay';
    // justifyContent: 'flex-start' + paddingTop (не 'center') — форма регистрации на
    // 1 поле (email) выше формы входа; при вертикальном центрировании её верх "уезжал"
    // выше и налезал на заголовок/подзаголовок (те стоят на фиксированных 0.22H/0.32H,
    // см. create()). paddingTop в vh — та же система координат, что и H-доли заголовка,
    // подстраивается под любой размер окна без отдельного resize-пересчёта.
    Object.assign(wrap.style, {
      position:  'absolute',
      top:       '0', left: '0',
      width:     '100%', height: '100%',
      display:   'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingTop: '36vh',
      pointerEvents: 'none',
    });

    // <form> (не <div>) — убирает браузерное DOM-предупреждение "Password field is not
    // contained in a form" (менеджеры паролей/автозаполнение ищут именно тег form).
    // preventDefault на submit — иначе Enter в поле пароля дал бы нативную отправку формы
    // (перезагрузку страницы); вся логика входа и так уже на btnAction 'click' ниже.
    const box = document.createElement('form');
    box.addEventListener('submit', (e) => e.preventDefault());
    Object.assign(box.style, {
      pointerEvents: 'all',
      background:    'rgba(5,10,25,0.92)',
      border:        '1px solid rgba(77,208,225,0.25)',
      borderRadius:  '8px',
      padding:       '36px 44px 32px',
      width:         '340px',
      display:       'flex',
      flexDirection: 'column',
      gap:           '14px',
      fontFamily:    "'Segoe UI', system-ui, sans-serif",
      color:         '#cfd8dc',
    });

    // Табы: Войти / Регистрация
    const tabBar = document.createElement('div');
    Object.assign(tabBar.style, { display: 'flex', gap: '0', marginBottom: '8px' });

    const tabLogin = this._makeTab('ВОЙТИ', true);
    const tabReg   = this._makeTab('РЕГИСТРАЦИЯ', false);
    tabBar.append(tabLogin, tabReg);

    // Поля
    const fldUser  = this._makeField('Имя игрока', 'text', 'sd-username');
    const fldEmail = this._makeField('Email', 'email', 'sd-email');
    const fldPass  = this._makeField('Пароль', 'password', 'sd-password');
    fldEmail.style.display = 'none'; // виден только в режиме регистрации, см. setMode

    // Кнопка действия
    const btnAction = document.createElement('button');
    btnAction.type = 'button'; // box теперь <form> — без явного type кнопка по умолчанию submit
    btnAction.textContent = 'ВОЙТИ';
    Object.assign(btnAction.style, this._btnStyle('#4dd0e1', '#03070f'));

    // Сообщение об ошибке
    const errMsg = document.createElement('div');
    Object.assign(errMsg.style, {
      fontSize: '12px', color: '#ef5350',
      minHeight: '18px', textAlign: 'center',
    });

    // DEV: пропустить авторизацию
    let devLink = null;
    if (DEV_MODE) {
      devLink = document.createElement('div');
      devLink.textContent = '⚡ DEV: пропустить авторизацию';
      Object.assign(devLink.style, {
        fontSize: '11px', color: '#607d8b',
        textAlign: 'center', cursor: 'pointer',
        marginTop: '4px',
      });
      devLink.addEventListener('mouseenter', () => devLink.style.color = '#4dd0e1');
      devLink.addEventListener('mouseleave', () => devLink.style.color = '#607d8b');
      devLink.addEventListener('click', () => {
        clearSession();            // drop any real user token from same tab
        window.PLAYER_STATE = null; // don't carry over real user's saved state
        this._removeOverlay();
        this.scene.start('TestProfileScene');
      });
    }

    // Вейлт мульти-аккаунтов (десктоп-клиент, см. IMPL_NOTES): чекбокс "Сохранить" рядом
    // с формой + отдельная ссылка "Сохранённые аккаунты" (если вейлт уже существует).
    // Полностью скрыты, если Web Crypto недоступен (crypto.subtle требует secure context —
    // см. vault.js) — не показываем UI, который не сможет реально зашифровать данные.
    let saveChk = null, saveRow = null, savedLink = null;
    if (vault.isCryptoAvailable()) {
      saveRow = document.createElement('label');
      Object.assign(saveRow.style, {
        display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px',
        color: '#607d8b', cursor: 'pointer', marginTop: '2px', userSelect: 'none',
      });
      saveChk = document.createElement('input');
      saveChk.type = 'checkbox';
      saveChk.id = 'sd-save-account';
      const saveLbl = document.createElement('span');
      saveLbl.textContent = '💾 Сохранить аккаунт (зашифровано)';
      saveRow.append(saveChk, saveLbl);

      savedLink = this._makeSavedAccountsLink();
    }

    // Состояние: login | register
    let mode = 'login';

    const setMode = (m) => {
      mode = m;
      const isLogin = m === 'login';
      tabLogin.style.borderBottom = isLogin ? '2px solid #4dd0e1' : '2px solid transparent';
      tabLogin.style.color        = isLogin ? '#4dd0e1' : '#607d8b';
      tabReg.style.borderBottom   = isLogin ? '2px solid transparent' : '2px solid #4dd0e1';
      tabReg.style.color          = isLogin ? '#607d8b' : '#4dd0e1';
      btnAction.textContent = isLogin ? 'ВОЙТИ' : 'СОЗДАТЬ АККАУНТ';
      fldEmail.style.display = isLogin ? 'none' : 'flex';
      errMsg.textContent = '';
    };

    tabLogin.addEventListener('click', () => setMode('login'));
    tabReg.addEventListener('click',   () => setMode('register'));

    btnAction.addEventListener('click', async () => {
      const username = fldUser.querySelector('input').value.trim();
      const email    = fldEmail.querySelector('input').value.trim();
      const password = fldPass.querySelector('input').value;
      if (!username || !password || (mode === 'register' && !email)) {
        errMsg.textContent = 'Заполните все поля'; return;
      }
      if (mode === 'register' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errMsg.textContent = 'Некорректный email'; return;
      }

      btnAction.disabled = true;
      btnAction.textContent = '…';
      errMsg.textContent = '';

      try {
        const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
        const payload = mode === 'login' ? { username, password } : { username, email, password };
        const data = await apiPost(endpoint, payload);

        if (saveChk?.checked) await this._saveAccountToVault(username, password);

        await this._completeLogin(data, password);
      } catch (e) {
        errMsg.textContent = e.message || 'Ошибка сервера';
      } finally {
        btnAction.disabled = false;
        btnAction.textContent = mode === 'login' ? 'ВОЙТИ' : 'СОЗДАТЬ АККАУНТ';
      }
    });

    // Enter → submit
    [fldUser, fldEmail, fldPass].forEach(f =>
      f.querySelector('input').addEventListener('keydown', e => {
        if (e.key === 'Enter') btnAction.click();
      })
    );

    box.append(tabBar, fldUser, fldEmail, fldPass, btnAction, errMsg);
    if (saveRow) box.append(saveRow);
    if (savedLink) box.append(savedLink);
    if (devLink) box.append(devLink);
    wrap.append(box);
    document.body.appendChild(wrap);
    this._overlay = wrap;

    // Фокус на первое поле
    setTimeout(() => fldUser.querySelector('input').focus(), 50);
  }

  // Общий "вход в игру" — используется и сразу после логина (email уже подтверждён/не
  // требует подтверждения), и после успешной верификации кода (см. _showVerificationGate).
  async _proceedIntoGame() {
    const username = getUsername();
    const _lsKey = 'stellar_drift_state_' + username;
    try {
      const r = await apiGet('/player/state');
      window.PLAYER_STATE = r.state || {};
      if (!Object.keys(window.PLAYER_STATE).length) {
        const local = localStorage.getItem(_lsKey);
        if (local) try { window.PLAYER_STATE = JSON.parse(local); } catch (_e) {}
      }
    } catch (_) {
      const local = localStorage.getItem(_lsKey);
      window.PLAYER_STATE = local ? (() => { try { return JSON.parse(local); } catch (_e) { return {}; } })() : {};
    }

    galaxy.current = _resolveStartSector(window.PLAYER_STATE);
    const _mapKey = SECTORS[galaxy.current].map;
    const _launch = () => {
      document.getElementById('scene-overlay')?.classList.add('active');
      this.scene.start('GameScene');
      this.scene.launch('BackgroundScene');
      this.scene.launch('HudScene');
    };
    if (this.textures.exists(_mapKey)) {
      _launch();
    } else {
      this.load.image(_mapKey, `assets/maps/${_mapKey}.jpg`);
      this.load.once('complete', _launch);
      this.load.start();
    }
  }

  // Общий "после успешного /auth/login или /auth/register" — используется и обычным
  // сабмитом формы, и логином по сохранённому в вейлте аккаунту (_doLogin).
  async _completeLogin(data, password) {
    setSession(data.access_token, data.username);
    if (data.email_verified === false) {
      this._removeOverlay();
      this._showVerificationGate(password);
      return;
    }
    window.TEST_PROFILE = null; // clear any leftover dev session data
    this._removeOverlay();
    await this._proceedIntoGame();
  }

  // Логин по паре username/password, полученной из вейлта (см. _showAccountListModal) —
  // тот же /auth/login, что и обычная форма, без дублирования логики.
  async _doLogin(username, password) {
    const data = await apiPost('/auth/login', { username, password });
    await this._completeLogin(data, password);
  }

  // Сохранить username/password в локальный зашифрованный вейлт (client/src/vault.js)
  // после успешного логина/регистрации, если отмечен чекбокс "Сохранить аккаунт". Мастер-
  // пароль спрашивается один раз за сессию — см. _promptMasterPassword и диалог "перед
  // сохранением вызывать мастер пароль... запоминать на сессию".
  async _saveAccountToVault(username, password) {
    try {
      if (!vault.hasVault()) {
        await this._promptMasterPassword('create');
      } else if (!vault.isUnlocked()) {
        await this._promptMasterPassword('unlock');
      }
      await vault.saveAccount(username, password);
    } catch (e) {
      // Отменённый мастер-пароль или ошибка вейлта не должны блокировать сам вход в игру.
      console.warn('Не удалось сохранить аккаунт в хранилище:', e.message);
    }
  }

  // Модалка мастер-пароля — отдельный оверлей ПОВЕРХ текущей формы логина (не трогает
  // this._overlay, чтобы после отмены/успеха вернуться к уже заполненной форме как есть).
  // mode: 'create' (первая настройка вейлта, поле повторите-пароль) | 'unlock' (одно поле).
  // Возвращает Promise — resolve после успешного createVault/unlockVault, reject при отмене.
  _promptMasterPassword(mode) {
    return new Promise((resolve, reject) => {
      const modal = document.createElement('div');
      Object.assign(modal.style, {
        position: 'fixed', inset: '0', background: 'rgba(2,4,10,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '1000',
      });
      const box = document.createElement('form');
      box.addEventListener('submit', (e) => e.preventDefault());
      Object.assign(box.style, {
        background: 'rgba(5,10,25,0.97)', border: '1px solid rgba(77,208,225,0.25)',
        borderRadius: '8px', padding: '28px 32px', width: '300px',
        display: 'flex', flexDirection: 'column', gap: '12px',
        fontFamily: "'Segoe UI', system-ui, sans-serif", color: '#cfd8dc',
      });

      const title = document.createElement('div');
      title.textContent = mode === 'create' ? 'СОЗДАЙТЕ МАСТЕР-ПАРОЛЬ' : 'МАСТЕР-ПАРОЛЬ';
      Object.assign(title.style, { fontSize: '13px', letterSpacing: '2px', color: '#4dd0e1', textAlign: 'center' });

      const hint = document.createElement('div');
      hint.textContent = 'Хранится локально, шифрует сохранённые аккаунты на этом устройстве.';
      Object.assign(hint.style, { fontSize: '11px', color: '#607d8b', textAlign: 'center' });

      const fldPass1 = this._makeField('Мастер-пароль', 'password', 'sd-mp-1');
      const fldPass2 = this._makeField('Повторите пароль', 'password', 'sd-mp-2');
      if (mode !== 'create') fldPass2.style.display = 'none';

      const errMsg = document.createElement('div');
      Object.assign(errMsg.style, { fontSize: '12px', color: '#ef5350', minHeight: '18px', textAlign: 'center' });

      const btnOk = document.createElement('button');
      btnOk.type = 'button';
      btnOk.textContent = mode === 'create' ? 'СОЗДАТЬ' : 'РАЗБЛОКИРОВАТЬ';
      Object.assign(btnOk.style, this._btnStyle('#4dd0e1', '#03070f'));

      const btnCancel = document.createElement('div');
      btnCancel.textContent = 'Отмена';
      Object.assign(btnCancel.style, { fontSize: '11px', color: '#607d8b', textAlign: 'center', cursor: 'pointer' });

      const cleanup = () => modal.remove();

      btnCancel.addEventListener('click', () => { cleanup(); reject(new Error('cancelled')); });

      btnOk.addEventListener('click', async () => {
        const p1 = fldPass1.querySelector('input').value;
        const p2 = mode === 'create' ? fldPass2.querySelector('input').value : p1;
        if (!p1) { errMsg.textContent = 'Введите пароль'; return; }
        if (mode === 'create' && p1 !== p2) { errMsg.textContent = 'Пароли не совпадают'; return; }
        btnOk.disabled = true; errMsg.textContent = '';
        try {
          if (mode === 'create') await vault.createVault(p1);
          else await vault.unlockVault(p1);
          cleanup();
          resolve();
        } catch (e) {
          errMsg.textContent = e.message || 'Ошибка';
          btnOk.disabled = false;
        }
      });

      [fldPass1, fldPass2].forEach((f) =>
        f.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') btnOk.click(); })
      );

      box.append(title, hint, fldPass1, fldPass2, errMsg, btnOk, btnCancel);
      modal.append(box);
      document.body.appendChild(modal);
      setTimeout(() => fldPass1.querySelector('input').focus(), 50);
    });
  }

  // Ссылка "Сохранённые аккаунты" — видна только если вейлт уже существует (создаётся
  // впервые через чекбокс "Сохранить аккаунт" при логине/регистрации).
  _makeSavedAccountsLink() {
    if (!vault.hasVault()) return null;
    const link = document.createElement('div');
    link.textContent = '🔐 Сохранённые аккаунты';
    Object.assign(link.style, {
      fontSize: '11px', color: '#607d8b', textAlign: 'center', cursor: 'pointer', marginTop: '4px',
    });
    link.addEventListener('mouseenter', () => link.style.color = '#4dd0e1');
    link.addEventListener('mouseleave', () => link.style.color = '#607d8b');
    link.addEventListener('click', () => this._openSavedAccounts());
    return link;
  }

  async _openSavedAccounts() {
    try {
      if (!vault.isUnlocked()) await this._promptMasterPassword('unlock');
    } catch (_e) {
      return; // отменено
    }
    this._showAccountListModal();
  }

  _showAccountListModal() {
    const accounts = vault.listAccounts();
    const modal = document.createElement('div');
    Object.assign(modal.style, {
      position: 'fixed', inset: '0', background: 'rgba(2,4,10,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '1000',
    });
    const box = document.createElement('div');
    Object.assign(box.style, {
      background: 'rgba(5,10,25,0.97)', border: '1px solid rgba(77,208,225,0.25)',
      borderRadius: '8px', padding: '24px 28px', width: '300px',
      display: 'flex', flexDirection: 'column', gap: '10px',
      fontFamily: "'Segoe UI', system-ui, sans-serif", color: '#cfd8dc',
    });

    const title = document.createElement('div');
    title.textContent = 'СОХРАНЁННЫЕ АККАУНТЫ';
    Object.assign(title.style, { fontSize: '13px', letterSpacing: '2px', color: '#4dd0e1', textAlign: 'center', marginBottom: '4px' });
    box.append(title);

    if (!accounts.length) {
      const empty = document.createElement('div');
      empty.textContent = 'Пока нет сохранённых аккаунтов';
      Object.assign(empty.style, { fontSize: '12px', color: '#607d8b', textAlign: 'center' });
      box.append(empty);
    }

    for (const { username } of accounts) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 10px', background: '#080d1c', border: '1px solid #1e3a4a',
        borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
      });
      const nameEl = document.createElement('span');
      nameEl.textContent = username;
      const rmBtn = document.createElement('span');
      rmBtn.textContent = '✕';
      Object.assign(rmBtn.style, { color: '#607d8b', cursor: 'pointer', padding: '0 4px' });
      rmBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await vault.removeAccount(username);
        modal.remove();
        this._showAccountListModal();
      });
      row.append(nameEl, rmBtn);
      row.addEventListener('mouseenter', () => row.style.borderColor = '#4dd0e1');
      row.addEventListener('mouseleave', () => row.style.borderColor = '#1e3a4a');
      row.addEventListener('click', async () => {
        modal.remove();
        const password = vault.getAccountPassword(username);
        this._removeOverlay();
        try {
          await this._doLogin(username, password);
        } catch (_e) {
          // Сервер недоступен/пароль устарел на сервере — вернуть на обычную форму входа.
          this.scene.restart();
        }
      });
      box.append(row);
    }

    const btnClose = document.createElement('div');
    btnClose.textContent = 'Закрыть';
    Object.assign(btnClose.style, { fontSize: '11px', color: '#607d8b', textAlign: 'center', cursor: 'pointer', marginTop: '6px' });
    btnClose.addEventListener('click', () => modal.remove());
    box.append(btnClose);

    modal.append(box);
    document.body.appendChild(modal);
  }

  // Гейт "подтвердите email" — показывается вместо запуска игры, если сервер вернул
  // email_verified:false (см. диалог: почта должна проверяться уже на регистрации,
  // иначе игрок вводит недоступный адрес и просто никогда не получит письма — код,
  // ожидающий ввода, это и есть тот сигнал "адрес не работает", который клиент может
  // показать пользователю вместо того чтобы молча пустить его в игру).
  async _showVerificationGate(currentPassword) {
    let email = '';
    try { email = (await apiGet('/auth/me')).email || ''; } catch (_e) {}

    const wrap = document.createElement('div');
    wrap.id = 'login-overlay';
    Object.assign(wrap.style, {
      position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'flex-start', paddingTop: '30vh', pointerEvents: 'none',
    });

    const box = document.createElement('form');
    box.addEventListener('submit', e => e.preventDefault());
    Object.assign(box.style, {
      pointerEvents: 'all', background: 'rgba(5,10,25,0.92)',
      border: '1px solid rgba(77,208,225,0.25)', borderRadius: '8px',
      padding: '32px 40px', width: '360px', display: 'flex', flexDirection: 'column',
      gap: '12px', fontFamily: "'Segoe UI', system-ui, sans-serif", color: '#cfd8dc',
    });

    const title = document.createElement('div');
    title.textContent = 'ПОДТВЕРДИТЕ EMAIL';
    Object.assign(title.style, { fontSize: '14px', letterSpacing: '2px', color: '#4dd0e1', textAlign: 'center' });

    const emailTxt = document.createElement('div');
    Object.assign(emailTxt.style, { fontSize: '12px', color: '#78909c', textAlign: 'center' });
    const setEmailTxt = () => { emailTxt.textContent = email ? `Код отправлен на ${email}` : 'Код отправлен на вашу почту'; };
    setEmailTxt();

    const fldCode = this._makeField('Код из письма', 'text', 'sd-verify-code');
    fldCode.querySelector('input').maxLength = 6;

    const btnVerify = document.createElement('button');
    btnVerify.type = 'button';
    btnVerify.textContent = 'ПОДТВЕРДИТЬ';
    Object.assign(btnVerify.style, this._btnStyle('#4dd0e1', '#03070f'));

    const errMsg = document.createElement('div');
    Object.assign(errMsg.style, { fontSize: '12px', color: '#ef5350', minHeight: '18px', textAlign: 'center' });
    const okMsg = document.createElement('div');
    Object.assign(okMsg.style, { fontSize: '11px', color: '#66bb6a', minHeight: '16px', textAlign: 'center' });

    const linkRow = document.createElement('div');
    Object.assign(linkRow.style, { display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '2px' });
    const resendLink = document.createElement('span');
    resendLink.textContent = 'Отправить код повторно';
    Object.assign(resendLink.style, { color: '#607d8b', cursor: 'pointer' });
    const changeEmailLink = document.createElement('span');
    changeEmailLink.textContent = 'Другой email?';
    Object.assign(changeEmailLink.style, { color: '#607d8b', cursor: 'pointer' });
    linkRow.append(resendLink, changeEmailLink);

    // Скрытая по умолчанию форма смены email (нужна current_password — берём из уже
    // введённого при регистрации/логине пароля, чтобы не спрашивать второй раз).
    const fldNewEmail = this._makeField('Новый email', 'email', 'sd-new-email');
    fldNewEmail.style.display = 'none';
    const btnSaveEmail = document.createElement('button');
    btnSaveEmail.type = 'button';
    btnSaveEmail.textContent = 'СОХРАНИТЬ EMAIL';
    Object.assign(btnSaveEmail.style, this._btnStyle('#3a7090', '#03070f'));
    btnSaveEmail.style.display = 'none';

    const logoutLink = document.createElement('div');
    logoutLink.textContent = 'Выйти';
    Object.assign(logoutLink.style, { fontSize: '11px', color: '#607d8b', textAlign: 'center', cursor: 'pointer', marginTop: '6px' });

    resendLink.addEventListener('click', async () => {
      errMsg.textContent = ''; okMsg.textContent = '';
      try { await resendVerification(); okMsg.textContent = 'Код отправлен повторно'; }
      catch (e) { errMsg.textContent = e.message || 'Ошибка'; }
    });

    changeEmailLink.addEventListener('click', () => {
      const showing = fldNewEmail.style.display !== 'none';
      fldNewEmail.style.display = showing ? 'none' : 'flex';
      btnSaveEmail.style.display = showing ? 'none' : 'block';
    });

    btnSaveEmail.addEventListener('click', async () => {
      const newEmail = fldNewEmail.querySelector('input').value.trim();
      if (!newEmail) return;
      errMsg.textContent = ''; okMsg.textContent = '';
      btnSaveEmail.disabled = true;
      try {
        const data = await changeEmail(currentPassword, newEmail);
        setSession(data.access_token, data.username);
        email = newEmail; setEmailTxt();
        fldNewEmail.style.display = 'none'; btnSaveEmail.style.display = 'none';
        okMsg.textContent = 'Email изменён — новый код отправлен';
      } catch (e) {
        errMsg.textContent = e.message || 'Ошибка';
      } finally {
        btnSaveEmail.disabled = false;
      }
    });

    logoutLink.addEventListener('click', () => {
      clearSession();
      window.PLAYER_STATE = null;
      wrap.remove();
      this.scene.restart();
    });

    btnVerify.addEventListener('click', async () => {
      const code = fldCode.querySelector('input').value.trim();
      if (!code) { errMsg.textContent = 'Введите код'; return; }
      btnVerify.disabled = true; btnVerify.textContent = '…'; errMsg.textContent = '';
      try {
        await verifyEmail(code);
        wrap.remove();
        window.TEST_PROFILE = null;
        await this._proceedIntoGame();
      } catch (e) {
        errMsg.textContent = e.message || 'Неверный код';
      } finally {
        btnVerify.disabled = false; btnVerify.textContent = 'ПОДТВЕРДИТЬ';
      }
    });

    fldCode.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') btnVerify.click(); });
    fldNewEmail.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') btnSaveEmail.click(); });

    box.append(title, emailTxt, fldCode, btnVerify, errMsg, okMsg, linkRow, fldNewEmail, btnSaveEmail, logoutLink);
    wrap.append(box);
    document.body.appendChild(wrap);
    this._overlay = wrap;
    setTimeout(() => fldCode.querySelector('input').focus(), 50);
  }

  _makeTab(label, active) {
    const el = document.createElement('div');
    el.textContent = label;
    Object.assign(el.style, {
      flex:          '1',
      textAlign:     'center',
      padding:       '8px 0',
      cursor:        'pointer',
      fontSize:      '11px',
      letterSpacing: '2px',
      borderBottom:  active ? '2px solid #4dd0e1' : '2px solid transparent',
      color:         active ? '#4dd0e1' : '#607d8b',
      transition:    'color .15s',
    });
    return el;
  }

  _makeField(label, type, id) {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '5px' });

    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.htmlFor = id;
    Object.assign(lbl.style, { fontSize: '10px', color: '#607d8b', letterSpacing: '1px', textTransform: 'uppercase' });

    const inp = document.createElement('input');
    inp.type = type; inp.id = id;
    inp.autocomplete = type === 'password' ? 'current-password' : 'username';
    Object.assign(inp.style, {
      background:   '#080d1c',
      border:       '1px solid #1e3a4a',
      color:        '#cfd8dc',
      fontFamily:   'inherit',
      fontSize:     '13px',
      padding:      '9px 12px',
      borderRadius: '4px',
      outline:      'none',
    });
    inp.addEventListener('focus', () => inp.style.borderColor = '#4dd0e1');
    inp.addEventListener('blur',  () => inp.style.borderColor = '#1e3a4a');

    wrap.append(lbl, inp);
    return wrap;
  }

  _btnStyle(bg, color) {
    return {
      background:    bg,
      color:         color,
      border:        'none',
      borderRadius:  '4px',
      padding:       '12px',
      fontSize:      '13px',
      fontWeight:    '700',
      letterSpacing: '2px',
      cursor:        'pointer',
      fontFamily:    'inherit',
      marginTop:     '4px',
    };
  }

  _removeOverlay() {
    this._overlay?.remove();
    this._overlay = null;
  }

  shutdown() {
    this._removeOverlay();
    if (this._onResize) { this.scale.off('resize', this._onResize); this._onResize = null; }
  }
}
