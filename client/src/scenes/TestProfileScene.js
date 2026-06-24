import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { RANKS } from '../constants.js';
import { galaxy, SECTORS } from '../galaxy.js';

const CORP_HOME = { helios: 'helios_1', karax: 'karax_1', tides: 'tides_1', neutral: 'helios_1' };

const LOOT_PRESETS = [
  { value: 'empty', label: 'Пусто — нет модулей' },
  { value: 't1',    label: 'Стартовый T1: 2× пушка, 2× щит, 1× движок' },
  { value: 't2',    label: 'Средний T2' },
  { value: 't3',    label: 'Продвинутый T3' },
  { value: 't4',    label: 'Максимальный T4' },
];

const CORPS = [
  { value: 'helios',  label: '🟡 HELIOS' },
  { value: 'karax',   label: '🔴 KARAX' },
  { value: 'tides',   label: '🔵 TIDES' },
  { value: 'neutral', label: 'НЕЙТРАЛ' },
];

export default class TestProfileScene extends Phaser.Scene {
  constructor() { super('TestProfileScene'); }

  create() {
    this._corp    = 'helios';
    this._premium = false;
    this._div     = null;
    this._style   = null;
    this._buildOverlay();
  }

  _buildOverlay() {
    const style = document.createElement('style');
    style.textContent = `
      #tp-ov {
        position:fixed;inset:0;background:rgba(5,7,15,.97);
        display:flex;align-items:center;justify-content:center;
        font-family:"Orbitron",sans-serif;color:#e0f7fa;z-index:9999;overflow-y:auto;
      }
      #tp-card {
        background:rgba(77,208,225,.06);border:1px solid rgba(77,208,225,.3);
        border-radius:8px;padding:40px 48px;min-width:480px;max-width:560px;
      }
      #tp-ov h2 { margin:0 0 4px;font-size:20px;color:#4dd0e1;letter-spacing:3px; }
      #tp-ov .sub { margin:0 0 32px;font-size:11px;color:#607d8b; }
      #tp-ov .row { margin-bottom:20px; }
      #tp-ov label { display:block;font-size:11px;color:#78909c;margin-bottom:6px;letter-spacing:1px; }
      #tp-ov input[type=number],#tp-ov select {
        width:100%;box-sizing:border-box;background:#0a1628;
        border:1px solid #1e4a5c;color:#e0f7fa;
        font-family:inherit;font-size:13px;padding:8px 10px;border-radius:4px;outline:none;
      }
      #tp-ov input:focus,#tp-ov select:focus { border-color:#4dd0e1; }
      .tp-corp-row { display:flex;gap:8px; }
      .tp-corp-btn {
        flex:1;padding:8px 2px;border-radius:4px;cursor:pointer;
        background:#0a1628;border:1px solid #1e4a5c;
        color:#78909c;font-family:inherit;font-size:11px;text-align:center;transition:all .15s;
      }
      .tp-corp-btn.on { border-color:#4dd0e1;color:#4dd0e1;background:#0d2030; }
      .tp-tog-row { display:flex;align-items:center;gap:12px; }
      .tp-tog {
        width:44px;height:22px;border-radius:11px;background:#1e4a5c;
        cursor:pointer;position:relative;transition:background .2s;flex-shrink:0;
      }
      .tp-tog.on { background:#4dd0e1; }
      .tp-tog::after {
        content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;
        border-radius:50%;background:#fff;transition:left .2s;
      }
      .tp-tog.on::after { left:25px; }
      .tp-2col { display:grid;grid-template-columns:1fr 1fr;gap:16px; }
      #tp-launch {
        width:100%;padding:14px;margin-top:8px;background:#4dd0e1;color:#030a10;
        font-family:inherit;font-size:15px;font-weight:700;letter-spacing:2px;
        border:none;border-radius:4px;cursor:pointer;transition:opacity .15s;
      }
      #tp-launch:hover { opacity:.85; }
    `;
    document.head.appendChild(style);
    this._style = style;

    const rankOptions = RANKS.map(r =>
      `<option value="${r.name}"${r.name === 'Лейтенант' ? ' selected' : ''}>${r.name}</option>`
    ).join('');

    const corpBtns = CORPS.map((c, i) =>
      `<button class="tp-corp-btn${i === 0 ? ' on' : ''}" data-v="${c.value}">${c.label}</button>`
    ).join('');

    const lootOptions = LOOT_PRESETS.map(p =>
      `<option value="${p.value}">${p.label}</option>`
    ).join('');

    const div = document.createElement('div');
    div.id = 'tp-ov';
    div.innerHTML = `
      <div id="tp-card">
        <h2>🧪 TEST PROFILE</h2>
        <p class="sub">Конфигурация тест-сессии · Не влияет на prod-данные</p>

        <div class="row">
          <label>УРОВЕНЬ (1–50)</label>
          <input id="tp-lvl" type="number" min="1" max="50" value="25">
        </div>
        <div class="row">
          <label>РАНГ (override — обходит формулу XP×0.4 + Honor×0.6)</label>
          <select id="tp-rank">${rankOptions}</select>
        </div>
        <div class="row">
          <label>КОРПОРАЦИЯ</label>
          <div class="tp-corp-row" id="tp-corps">${corpBtns}</div>
        </div>
        <div class="row">
          <label>ПРЕМИУМ</label>
          <div class="tp-tog-row">
            <div class="tp-tog" id="tp-prem"></div>
            <span id="tp-prem-lbl" style="font-size:12px;color:#78909c">Выкл</span>
          </div>
        </div>
        <div class="row">
          <label>ЛУТ ПО УМОЛЧАНИЮ</label>
          <select id="tp-loot">${lootOptions}</select>
        </div>
        <div class="tp-2col">
          <div class="row">
            <label>КРЕДИТЫ</label>
            <input id="tp-cred" type="number" min="0" value="3000000">
          </div>
          <div class="row">
            <label>ЗОЛОТО ⭐</label>
            <input id="tp-gold" type="number" min="0" value="20000">
          </div>
        </div>
        <button id="tp-launch">▶ ЗАПУСТИТЬ</button>
      </div>
    `;
    document.body.appendChild(div);
    this._div = div;

    div.querySelectorAll('.tp-corp-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        div.querySelectorAll('.tp-corp-btn').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        this._corp = btn.dataset.v;
      });
    });

    const tog    = div.querySelector('#tp-prem');
    const togLbl = div.querySelector('#tp-prem-lbl');
    tog.addEventListener('click', () => {
      this._premium = !this._premium;
      tog.classList.toggle('on', this._premium);
      togLbl.textContent = this._premium ? 'Вкл' : 'Выкл';
    });

    div.querySelector('#tp-launch').addEventListener('click', () => {
      const level    = Math.min(50, Math.max(1, parseInt(div.querySelector('#tp-lvl').value)   || 25));
      const rank     = div.querySelector('#tp-rank').value;
      const loot     = div.querySelector('#tp-loot').value;
      const credits  = Math.max(0, parseInt(div.querySelector('#tp-cred').value) || 0);
      const starGold = Math.max(0, parseInt(div.querySelector('#tp-gold').value) || 0);

      galaxy.current = CORP_HOME[this._corp] ?? 'helios_1';

      window.TEST_PROFILE = {
        level,
        rankOverride: rank,
        corp:         this._corp,
        premium:      this._premium,
        lootPreset:   loot,
        credits,
        starGold,
      };

      this._cleanup();
      // Load starting sector's map before launching (it wasn't loaded at boot).
      const _tpMap = SECTORS[galaxy.current].map;
      const _tpLaunch = () => {
        this.scene.start('GameScene');
        this.scene.launch('BackgroundScene');
        this.scene.launch('HudScene');
      };
      if (this.textures.exists(_tpMap)) {
        _tpLaunch();
      } else {
        this.load.image(_tpMap, `assets/maps/${_tpMap}.png`);
        this.load.once('complete', _tpLaunch);
        this.load.start();
      }
    });
  }

  _cleanup() {
    this._div?.remove();
    this._style?.remove();
    this._div   = null;
    this._style = null;
  }

  shutdown() { this._cleanup(); }
}
