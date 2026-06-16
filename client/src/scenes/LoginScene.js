import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';
import { apiPost, setSession, getToken, getUsername } from '../api.js';

const DEV_MODE = true;

export default class LoginScene extends Phaser.Scene {
  constructor() { super('LoginScene'); }

  create() {
    const W = this.scale.width, H = this.scale.height;

    // Фон
    const bg = this.add.image(W / 2, H / 2, 'bg_login');
    bg.setScale(Math.max(W / bg.width, H / bg.height));
    this.add.rectangle(0, 0, W, H, 0x000000, 0.45).setOrigin(0);

    this.add.text(W / 2, H * 0.22, 'STELLAR DRIFT', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '60px',
      color: '#4dd0e1',
      resolution: UI_RES,
    }).setOrigin(0.5);

    this.add.text(W / 2, H * 0.32, 'ВХОД В ИГРУ', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '16px',
      color: '#607d8b',
      resolution: UI_RES,
      letterSpacing: 4,
    }).setOrigin(0.5);

    this._buildOverlay(W, H);
  }

  _buildOverlay(W, H) {
    // DOM-оверлей — поверх canvas
    const wrap = document.createElement('div');
    wrap.id = 'login-overlay';
    Object.assign(wrap.style, {
      position:  'absolute',
      top:       '0', left: '0',
      width:     '100%', height: '100%',
      display:   'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
    });

    const box = document.createElement('div');
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
    const fldUser = this._makeField('Имя игрока', 'text', 'sd-username');
    const fldPass = this._makeField('Пароль', 'password', 'sd-password');

    // Кнопка действия
    const btnAction = document.createElement('button');
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
        this._removeOverlay();
        this.scene.start('TestProfileScene');
      });
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
      errMsg.textContent = '';
    };

    tabLogin.addEventListener('click', () => setMode('login'));
    tabReg.addEventListener('click',   () => setMode('register'));

    btnAction.addEventListener('click', async () => {
      const username = fldUser.querySelector('input').value.trim();
      const password = fldPass.querySelector('input').value;
      if (!username || !password) { errMsg.textContent = 'Заполните все поля'; return; }

      btnAction.disabled = true;
      btnAction.textContent = '…';
      errMsg.textContent = '';

      try {
        const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
        const data = await apiPost(endpoint, { username, password });
        setSession(data.access_token, data.username);
        this._removeOverlay();
        this.scene.start('TestProfileScene');
      } catch (e) {
        errMsg.textContent = e.message || 'Ошибка сервера';
      } finally {
        btnAction.disabled = false;
        btnAction.textContent = mode === 'login' ? 'ВОЙТИ' : 'СОЗДАТЬ АККАУНТ';
      }
    });

    // Enter → submit
    [fldUser, fldPass].forEach(f =>
      f.querySelector('input').addEventListener('keydown', e => {
        if (e.key === 'Enter') btnAction.click();
      })
    );

    box.append(tabBar, fldUser, fldPass, btnAction, errMsg);
    if (devLink) box.append(devLink);
    wrap.append(box);
    document.body.appendChild(wrap);
    this._overlay = wrap;

    // Фокус на первое поле
    setTimeout(() => fldUser.querySelector('input').focus(), 50);
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

  shutdown() { this._removeOverlay(); }
}
