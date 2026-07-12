import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { RANKS } from '../constants.js';
import { galaxy, SECTORS } from '../galaxy.js';
import { SHIPS } from '../ships.js';

const CORP_HOME = { helios: 'helios_1', karax: 'karax_1', tides: 'tides_1', neutral: 'helios_1' };

const LOOT_PRESETS = [
  { value: 'empty', label: 'Пусто' },
  { value: 't1',    label: 'T1 стартовый' },
  { value: 't2',    label: 'T2 средний' },
  { value: 't3',    label: 'T3 продвинутый' },
  { value: 't4',    label: 'T4 максимальный' },
];

const CORPS = [
  { value: 'helios',  label: '🟡 HELIOS' },
  { value: 'karax',   label: '🔴 KARAX' },
  { value: 'tides',   label: '🔵 TIDES' },
  { value: 'neutral', label: 'НЕЙТРАЛ' },
];

// Playable ships (exclude admin argus)
const PLAYABLE_SHIPS = SHIPS.filter(s => s.key !== 'argus');

// Skill tree for auto-fill — mirrors SKILLS_DEF in SkillScene (key, maxLevel, requires)
const SKILL_TREE = [
  { key: 'sharpshooter',       max: 4, req: [] },
  { key: 'heavy_caliber',      max: 4, req: [['sharpshooter', 2]] },
  { key: 'penetrating_rounds', max: 5, req: [['heavy_caliber', 2]] },
  { key: 'overcharge_shot',    max: 1, req: [['penetrating_rounds', 2]] },
  { key: 'salvo',              max: 1, req: [['penetrating_rounds', 2]] },
  { key: 'targeting_ai',       max: 5, req: [['overcharge_shot', 1]] },
  { key: 'berserker',          max: 4, req: [['salvo', 1]] },
  { key: 'reinforced_hull',    max: 4, req: [] },
  { key: 'shield_optimizer',   max: 4, req: [['reinforced_hull', 2]] },
  { key: 'fast_regen',         max: 4, req: [['shield_optimizer', 2]] },
  { key: 'emergency_repair',   max: 1, req: [['fast_regen', 2]] },
  { key: 'shield_burst',       max: 1, req: [['emergency_repair', 1]] },
  { key: 'damage_resist',      max: 4, req: [['emergency_repair', 1]] },
  { key: 'module_specialist',  max: 4, req: [['damage_resist', 2]] },
  { key: 'loot_magnet',        max: 4, req: [] },
  { key: 'salvager',           max: 4, req: [['loot_magnet', 2]] },
  { key: 'merchants_eye',      max: 3, req: [['salvager', 2]] },
  { key: 'scanner_boost',      max: 3, req: [['merchants_eye', 1]] },
  { key: 'cargo_expand',       max: 3, req: [['merchants_eye', 1]] },
  { key: 'stealth_sprint',     max: 1, req: [['cargo_expand', 1]] },
];

// Greedy SP distribution — fills one point at a time in tree order, respecting deps.
function autoFillSkills(sp) {
  const levels = {};
  let rem = Math.floor(sp);
  let changed = true;
  while (changed && rem > 0) {
    changed = false;
    for (const d of SKILL_TREE) {
      if ((levels[d.key] || 0) >= d.max) continue;
      if (!d.req.every(([k, l]) => (levels[k] || 0) >= l)) continue;
      levels[d.key] = (levels[d.key] || 0) + 1;
      rem--;
      changed = true;
      if (rem <= 0) break;
    }
  }
  return levels;
}

export default class TestProfileScene extends Phaser.Scene {
  constructor() { super('TestProfileScene'); }

  create() {
    this._corp       = 'helios';
    this._premium    = false;
    this._boardTier  = 0;   // 0 = нет, 1–3 = тир платы
    this._autoSkills = false;
    this._div        = null;
    this._style      = null;
    this._buildOverlay();
  }

  _buildOverlay() {
    const style = document.createElement('style');
    style.textContent = `
      #tp-ov {
        position:fixed;inset:0;background:rgba(5,7,15,.97);
        display:flex;align-items:center;justify-content:center;
        font-family:"Orbitron",sans-serif;color:#e0f7fa;z-index:9999;
        overflow-y:auto;padding:20px 0;
      }
      #tp-card {
        background:rgba(77,208,225,.06);border:1px solid rgba(77,208,225,.3);
        border-radius:8px;padding:28px 36px;min-width:500px;max-width:580px;width:100%;
      }
      #tp-ov h2 { margin:0 0 3px;font-size:19px;color:#4dd0e1;letter-spacing:3px; }
      #tp-ov .sub { margin:0 0 20px;font-size:10px;color:#607d8b; }
      #tp-ov .row { margin-bottom:14px; }
      #tp-ov label {
        display:flex;align-items:center;gap:6px;
        font-size:10px;color:#78909c;margin-bottom:5px;letter-spacing:1px;
      }
      #tp-ov input[type=number],#tp-ov select {
        width:100%;box-sizing:border-box;background:#0a1628;
        border:1px solid #1e4a5c;color:#e0f7fa;
        font-family:inherit;font-size:12px;padding:7px 10px;border-radius:4px;outline:none;
      }
      #tp-ov input:focus,#tp-ov select:focus { border-color:#4dd0e1; }
      .tp-btn-row { display:flex;gap:6px; }
      .tp-btn {
        flex:1;padding:7px 4px;border-radius:4px;cursor:pointer;
        background:#0a1628;border:1px solid #1e4a5c;
        color:#78909c;font-family:inherit;font-size:10px;text-align:center;transition:all .15s;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      }
      .tp-btn.on { border-color:#4dd0e1;color:#4dd0e1;background:#0d2030; }
      .tp-tog-row { display:flex;align-items:center;gap:10px; }
      .tp-tog {
        width:40px;height:20px;border-radius:10px;background:#1e4a5c;
        cursor:pointer;position:relative;transition:background .2s;flex-shrink:0;
      }
      .tp-tog.on { background:#4dd0e1; }
      .tp-tog::after {
        content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;
        border-radius:50%;background:#fff;transition:left .2s;
      }
      .tp-tog.on::after { left:22px; }
      .tp-2col { display:grid;grid-template-columns:1fr 1fr;gap:14px; }
      .tp-3col { display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px; }
      .tp-divider { height:1px;background:rgba(77,208,225,.15);margin:14px 0; }
      #tp-launch {
        width:100%;padding:13px;margin-top:6px;background:#4dd0e1;color:#030a10;
        font-family:inherit;font-size:14px;font-weight:700;letter-spacing:2px;
        border:none;border-radius:4px;cursor:pointer;transition:opacity .15s;
      }
      #tp-launch:hover { opacity:.85; }
      #tp-skill-preview {
        font-size:9px;color:#4dd0e1;opacity:.7;margin-top:3px;
        letter-spacing:.5px;line-height:1.5;min-height:14px;
      }
    `;
    document.head.appendChild(style);
    this._style = style;

    const rankOptions = RANKS.map(r =>
      `<option value="${r.name}"${r.name === 'Лейтенант' ? ' selected' : ''}>${r.name}</option>`
    ).join('');

    const corpBtns = CORPS.map((c, i) =>
      `<button class="tp-btn${i === 0 ? ' on' : ''}" data-corp="${c.value}">${c.label}</button>`
    ).join('');

    const lootOptions = LOOT_PRESETS.map(p =>
      `<option value="${p.value}">${p.label}</option>`
    ).join('');

    const boardBtns = ['Нет платы', 'T1', 'T2', 'T3'].map((label, i) =>
      `<button class="tp-btn${i === 0 ? ' on' : ''}" data-board="${i}">${label}</button>`
    ).join('');

    const div = document.createElement('div');
    div.id = 'tp-ov';
    div.innerHTML = `
      <div id="tp-card">
        <h2>🧪 TEST PROFILE</h2>
        <p class="sub">Конфигурация тест-сессии · DEV only · Не влияет на prod-данные</p>

        <div class="tp-2col">
          <div class="row">
            <label>УРОВЕНЬ ПИЛОТА (1–50)</label>
            <input id="tp-lvl" type="number" min="1" max="50" value="25">
          </div>
          <div class="row">
            <label>РАНГ (override)</label>
            <select id="tp-rank">${rankOptions}</select>
          </div>
        </div>

        <div class="row">
          <label>КОРПОРАЦИЯ</label>
          <div class="tp-btn-row" id="tp-corps">${corpBtns}</div>
        </div>

        <div class="row">
          <label>КОРАБЛЬ</label>
          <select id="tp-ship"><option value="auto">Авто (макс. для уровня)</option></select>
        </div>

        <div class="tp-divider"></div>

        <div class="row">
          <label>ПЛАТА (EXPANSION BOARD)</label>
          <div class="tp-btn-row" id="tp-boards">${boardBtns}</div>
        </div>

        <div class="row">
          <label>ЛУТ ПО УМОЛЧАНИЮ</label>
          <select id="tp-loot">${lootOptions}</select>
        </div>

        <div class="tp-divider"></div>

        <div class="tp-3col">
          <div class="row">
            <label>ПРЕМИУМ</label>
            <div class="tp-tog-row">
              <div class="tp-tog" id="tp-prem"></div>
              <span id="tp-prem-lbl" style="font-size:11px;color:#78909c">Выкл</span>
            </div>
          </div>
          <div class="row">
            <label>АВТО-СКИЛЛЫ</label>
            <div class="tp-tog-row">
              <div class="tp-tog" id="tp-askills"></div>
              <span id="tp-askills-lbl" style="font-size:11px;color:#78909c">Выкл</span>
            </div>
          </div>
          <div></div>
        </div>
        <div id="tp-skill-preview"></div>

        <div class="tp-2col" style="margin-top:14px">
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

    // ── Ship selector: rebuild on level change ────────────────────────────────
    const lvlInput  = div.querySelector('#tp-lvl');
    const shipSel   = div.querySelector('#tp-ship');
    const skillPrev = div.querySelector('#tp-skill-preview');

    const _updateShips = () => {
      const lvl  = Math.min(50, Math.max(1, parseInt(lvlInput.value) || 25));
      const prev = shipSel.value;
      const avail = PLAYABLE_SHIPS.filter(s => s.levelGate <= lvl);
      const nm = k => k.charAt(0).toUpperCase() + k.slice(1);
      shipSel.innerHTML =
        '<option value="auto">Авто (макс. для уровня)</option>' +
        avail.map(s => {
          const star = s.prestige ? ` ★ [${s.corp?.toUpperCase()}]` : '';
          return `<option value="${s.key}">${s.tier}${star} — ${nm(s.key)} (lv.${s.levelGate})</option>`;
        }).join('');
      if ([...shipSel.options].some(o => o.value === prev)) shipSel.value = prev;
      _updateSkillPreview();
    };

    const _updateSkillPreview = () => {
      if (!this._autoSkills) { skillPrev.textContent = ''; return; }
      const lvl = Math.min(50, Math.max(1, parseInt(lvlInput.value) || 25));
      const sl = autoFillSkills(lvl);
      const spent = Object.values(sl).reduce((a, v) => a + v, 0);
      const entries = Object.entries(sl).map(([k, v]) => `${k}=${v}`).join(' · ');
      skillPrev.textContent = `SP потрачено: ${spent}/${lvl} — ${entries}`;
    };

    _updateShips();
    lvlInput.addEventListener('input', _updateShips);

    // ── Corp buttons ──────────────────────────────────────────────────────────
    div.querySelectorAll('[data-corp]').forEach(btn => {
      btn.addEventListener('click', () => {
        div.querySelectorAll('[data-corp]').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        this._corp = btn.dataset.corp;
      });
    });

    // ── Board buttons ─────────────────────────────────────────────────────────
    div.querySelectorAll('[data-board]').forEach(btn => {
      btn.addEventListener('click', () => {
        div.querySelectorAll('[data-board]').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        this._boardTier = parseInt(btn.dataset.board);
      });
    });

    // ── Toggles ───────────────────────────────────────────────────────────────
    const _mkToggle = (togId, lblId, onGet, onSet) => {
      const tog = div.querySelector(togId);
      const lbl = div.querySelector(lblId);
      tog.addEventListener('click', () => {
        const next = !onGet();
        onSet(next);
        tog.classList.toggle('on', next);
        lbl.textContent = next ? 'Вкл' : 'Выкл';
        _updateSkillPreview();
      });
    };

    _mkToggle('#tp-prem',    '#tp-prem-lbl',    () => this._premium,    v => { this._premium    = v; });
    _mkToggle('#tp-askills', '#tp-askills-lbl', () => this._autoSkills, v => { this._autoSkills = v; });

    // ── Launch ────────────────────────────────────────────────────────────────
    div.querySelector('#tp-launch').addEventListener('click', () => {
      const level    = Math.min(50, Math.max(1, parseInt(div.querySelector('#tp-lvl').value)   || 25));
      const rank     = div.querySelector('#tp-rank').value;
      const loot     = div.querySelector('#tp-loot').value;
      const credits  = Math.max(0, parseInt(div.querySelector('#tp-cred').value)  || 0);
      const starGold = Math.max(0, parseInt(div.querySelector('#tp-gold').value)  || 0);

      // Ship: 'auto' → highest non-prestige ship that fits the level
      let shipKey = div.querySelector('#tp-ship').value;
      if (shipKey === 'auto') {
        const nonP = PLAYABLE_SHIPS.filter(s => !s.prestige && s.levelGate <= level);
        shipKey = nonP.length ? nonP[nonP.length - 1].key : 'wisp';
      }

      const skillLevels = this._autoSkills ? autoFillSkills(level) : {};

      galaxy.current = CORP_HOME[this._corp] ?? 'helios_1';

      window.TEST_PROFILE = {
        level,
        rankOverride: rank,
        corp:         this._corp,
        premium:      this._premium,
        lootPreset:   loot,
        credits,
        starGold,
        ship:         shipKey,
        boardTier:    this._boardTier,
        skillLevels,
      };

      this._cleanup();
      const _tpMap    = SECTORS[galaxy.current].map;
      const _tpLaunch = () => {
        document.getElementById('scene-overlay')?.classList.add('active');
        this.scene.start('GameScene');
        this.scene.launch('BackgroundScene');
        this.scene.launch('HudScene');
      };
      if (this.textures.exists(_tpMap)) {
        _tpLaunch();
      } else {
        this.load.image(_tpMap, `assets/maps/${_tpMap}.jpg`);
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
