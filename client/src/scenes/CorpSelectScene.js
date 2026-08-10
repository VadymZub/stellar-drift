import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { i18n } from '../i18n.js';
import { CORP_META } from '../constants.js';
import { galaxy, SECTORS } from '../galaxy.js';

// Порядок панелей слева направо — не влияет на баланс, просто фиксированный визуальный
// порядок (совпадает с порядком в TestProfileScene/CORP_META).
const CORPS = ['helios', 'karax', 'tides'];

// Показывается РОВНО ОДИН РАЗ — только когда у аккаунта ещё нет сохранённого
// playerCorp (см. LoginScene._proceedIntoGame). После выбора корпорация пишется в
// window.PLAYER_STATE.playerCorp, GameScene._applyLoadedState() подхватывает её как
// обычное поле сохранённого стейта — никаких изменений в GameScene не потребовалось.
export default class CorpSelectScene extends Phaser.Scene {
  constructor() { super('CorpSelectScene'); }

  create() {
    this._div = null;
    this._style = null;
    this._buildOverlay();
  }

  _buildOverlay() {
    const style = document.createElement('style');
    style.textContent = `
      #cs-ov {
        position:fixed;inset:0;background:rgba(5,7,15,.97);
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        font-family:"Orbitron",sans-serif;color:#e0f7fa;z-index:9999;
        overflow-y:auto;padding:30px 20px;gap:24px;
      }
      #cs-ov h1 { margin:0;font-size:20px;letter-spacing:4px;color:#e0f7fa;text-align:center; }
      #cs-ov .cs-sub {
        margin:0;max-width:640px;font-size:11px;line-height:1.6;color:#78909c;
        text-align:center;font-family:"Inter",sans-serif;
      }
      #cs-cards {
        display:grid;grid-template-columns:repeat(3, minmax(220px, 300px));gap:20px;
        width:100%;max-width:1000px;justify-content:center;
      }
      .cs-card {
        min-height:480px;display:flex;flex-direction:column;
        background:rgba(20,26,36,.9);border:1px solid var(--cc);border-top:3px solid var(--cc);
        border-radius:6px;padding:24px 20px;transition:transform .15s,box-shadow .15s;
      }
      .cs-card:hover { transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,0,0,.4); }
      .cs-emblem { width:64px;height:64px;margin:0 auto 12px;display:block;filter:drop-shadow(0 0 8px var(--cc)); }
      .cs-card h2 { margin:0 0 2px;font-size:16px;letter-spacing:2px;color:var(--cc);text-align:center; }
      .cs-card .cs-tag { margin:0 0 14px;font-size:10px;letter-spacing:1px;color:#78909c;text-align:center; }
      .cs-card p {
        flex:1;margin:0 0 16px;font-family:"Inter",sans-serif;font-size:12px;
        line-height:1.7;color:#b0bec5;
      }
      .cs-select {
        width:100%;padding:12px;background:transparent;border:1px solid var(--cc);
        color:var(--cc);font-family:inherit;font-size:12px;font-weight:700;letter-spacing:2px;
        border-radius:4px;cursor:pointer;transition:all .15s;
      }
      .cs-select:hover { background:var(--cc);color:#04070a; }
    `;
    document.head.appendChild(style);

    const ov = document.createElement('div');
    ov.id = 'cs-ov';

    const title = document.createElement('h1');
    title.textContent = i18n.t('corpselect.title');
    const sub = document.createElement('p');
    sub.className = 'cs-sub';
    sub.textContent = i18n.t('corpselect.subtitle');

    const cards = document.createElement('div');
    cards.id = 'cs-cards';

    CORPS.forEach(key => {
      const meta = CORP_META[key];
      const card = document.createElement('div');
      card.className = 'cs-card';
      card.style.setProperty('--cc', meta.color);

      const emblem = document.createElement('img');
      emblem.className = 'cs-emblem';
      emblem.src = `assets/corps/emblem_${key}.png`;
      emblem.alt = key;
      const h2 = document.createElement('h2');
      h2.textContent = i18n.t(`corpselect.${key}.name`);
      const tag = document.createElement('div');
      tag.className = 'cs-tag';
      tag.textContent = i18n.t(`corpselect.${key}.tagline`);
      const desc = document.createElement('p');
      desc.textContent = i18n.t(`corpselect.${key}.desc`);
      const btn = document.createElement('button');
      btn.className = 'cs-select';
      btn.textContent = i18n.t('corpselect.select_btn');
      btn.addEventListener('click', () => this._choose(key));

      card.append(emblem, h2, tag, desc, btn);
      cards.append(card);
    });

    ov.append(title, sub, cards);
    document.body.appendChild(ov);
    this._div = ov;
    this._style = style;
  }

  _choose(corpKey) {
    window.PLAYER_STATE = window.PLAYER_STATE || {};
    window.PLAYER_STATE.playerCorp = corpKey;
    galaxy.current = `${corpKey}_1`;

    this._cleanup();

    // Тот же паттерн preload-карты перед стартом, что и LoginScene._proceedIntoGame /
    // TestProfileScene — избегаем чёрного кадра, пока грузится фон сектора.
    const mapKey = SECTORS[galaxy.current].map;
    const launch = () => {
      document.getElementById('scene-overlay')?.classList.add('active');
      this.scene.start('GameScene');
      this.scene.launch('BackgroundScene');
      this.scene.launch('HudScene');
    };
    if (this.textures.exists(mapKey)) {
      launch();
    } else {
      this.load.image(mapKey, `assets/maps/${mapKey}.jpg`);
      this.load.once('complete', launch);
      this.load.start();
    }
  }

  _cleanup() {
    this._div?.remove();
    this._style?.remove();
    this._div = null;
    this._style = null;
  }

  shutdown() { this._cleanup(); }
}
