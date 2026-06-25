import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { itemName, itemStats, itemIconKey } from '../items.js';
import { prerenderTex } from '../utils/prerenderTex.js';
import { PERK_MAP, RARITY_COLOR, perkBonus } from '../perks.js';

const GUILD_CREATE_CR  = 50_000;
const GUILD_CREATE_ST  = 100;
const GUILD_MIN_LVL    = 8;

const VAULT_TIERS = [
  { slots: 10,  cr: 0,        pts: 0       },
  { slots: 15,  cr: 50000,    pts: 500     },
  { slots: 20,  cr: 120000,   pts: 1500    },
  { slots: 25,  cr: 250000,   pts: 4000    },
  { slots: 30,  cr: 500000,   pts: 10000   },
  { slots: 40,  cr: 1200000,  pts: 30000   },
  { slots: 50,  cr: 3000000,  pts: 80000   },
];

const BUFF_PCT = [0, 3, 6, 10, 15, 22];

const MOCK_GUILDS = [
  { name: 'Nova Fleet',   tag: 'NF',  corp: 'helios', level: 3, members: 12, recruiting: true,  minLvl: 8,  motto: 'В единстве сила',  desc: 'Дружная гильдия опытных пилотов Гелиоса' },
  { name: 'Iron Corsair', tag: 'IC',  corp: 'karax',  level: 5, members: 28, recruiting: true,  minLvl: 10, motto: 'Стальные крылья', desc: 'Ветераны Кликса ищут союзников для рейдов' },
  { name: 'Tidal Force',  tag: 'TF',  corp: 'tides',  level: 2, members: 7,  recruiting: true,  minLvl: 8,  motto: '',                desc: 'Новая гильдия, принимаем всех желающих' },
  { name: 'Deep Void',    tag: 'DV',  corp: 'helios', level: 4, members: 34, recruiting: false, minLvl: 12, motto: 'Пустота зовёт',  desc: 'Топовые PvP пилоты, набор закрыт' },
  { name: 'StarReapers',  tag: 'SR',  corp: 'karax',  level: 6, members: 45, recruiting: true,  minLvl: 15, motto: 'Жнецы звёзд',   desc: 'Элитная гильдия для хардкорных пилотов' },
];

const MOCK_MY_GUILD = {
  name: 'Nova Fleet', tag: 'NF', corp: 'helios', level: 2,
  myRole: 'Капитан',
  clanPoints: 1200,
  recruiting: true,
  motto: 'В единстве сила',
  message: 'Рейд в пятницу в 20:00!',
  members: [
    { name: 'VoidRunner',  role: 'Капитан',  online: true,  contribution: 45000, level: 14 },
    { name: 'NovaStar',    role: 'Офицер',   online: true,  contribution: 32000, level: 12 },
    { name: 'StormEagle',  role: 'Офицер',   online: false, contribution: 28000, level: 11 },
    { name: 'IronPilot',   role: 'Новобранец', online: true,  contribution: 15000, level: 9  },
    { name: 'DarkMatter',  role: 'Новобранец', online: false, contribution: 12000, level: 8  },
    { name: 'StarForge',   role: 'Новобранец', online: false, contribution: 8000,  level: 8  },
    { name: 'EchoWarden',  role: 'Новобранец', online: true,  contribution: 6000,  level: 8  },
  ],
  applications: [
    { name: 'CometRider',  level: 9,  msg: 'Хочу вступить в вашу гильдию!' },
    { name: 'NebulaDrift', level: 11, msg: '' },
  ],
  vault: [], vaultTier: 0,
  treasury: { credits: 18500 },
  buffs: [
    { key: 'hull',   name: 'Броня', icon: '🛡', lvl: 2, maxLvl: 5 },
    { key: 'shield', name: 'Щит',   icon: '💠', lvl: 1, maxLvl: 5 },
    { key: 'damage', name: 'Урон',  icon: '⚡', lvl: 0, maxLvl: 5 },
  ],
  log: [
    { time: '18.06  18:44', text: 'EchoWarden вступил в гильдию',                  color: '#66bb6a' },
    { time: '18.06  15:20', text: 'Уровень гильдии 2 — Броня +6%',                color: '#ffd54f' },
    { time: '17.06  22:10', text: 'NovaStar положил «Плазмопушка T3» на склад',    color: '#4dd0e1' },
    { time: '17.06  19:32', text: 'IronPilot внёс 5 000 кр в казну',              color: '#ffe0b2' },
    { time: '16.06  14:05', text: 'StormEagle взял «Щит T2» со склада',            color: '#ef9a9a' },
    { time: '15.06  09:17', text: 'DarkMatter вступил в гильдию',                  color: '#66bb6a' },
    { time: '14.06  21:44', text: 'OldPilot покинул гильдию',                      color: '#ef9a9a' },
    { time: '13.06  18:00', text: 'Уровень гильдии 1 — Щит +3%',                 color: '#ffd54f' },
    { time: '12.06  11:30', text: 'NovaStar внёс 10 000 кр в казну',              color: '#ffe0b2' },
    { time: '12.06  10:15', text: 'Nova Fleet основана. Добро пожаловать!',        color: '#ce93d8' },
  ],
};

export default class ClanScene extends Phaser.Scene {
  constructor() { super('ClanScene'); }

  O(s, c = '#4dd0e1') { return { fontFamily: 'Orbitron, sans-serif',  fontSize: s, color: c, resolution: UI_RES }; }
  F(s, c = '#cce8f0') { return { fontFamily: 'Inter, sans-serif',     fontSize: s, color: c, resolution: UI_RES }; }

  create() {
    document.getElementById('sd-guild-search')?.remove(); // defensive: clear stale input on any restart
    document.getElementById('sd-dep-inp')?.remove();
    this.gs = this.scene.get('GameScene');
    const gs = this.gs;
    const W  = this.scale.width, H = this.scale.height;

    if (gs.clan === undefined) gs.clan = null;
    // DEV: to test guild panel: gs.clan = MOCK_MY_GUILD;

    const bgMap = { helios: 'bg_corp_helios', karax: 'bg_corp_karaks', tides: 'bg_corp_tides' };
    const bgKey = bgMap[gs.playerCorp] || 'bg_corp_helios';
    if (this.textures.exists(bgKey)) {
      const bg = this.add.image(W / 2, H / 2, bgKey);
      bg.setScale(Math.max(W / bg.width, H / bg.height)).setAlpha(0.8);
    } else {
      this.add.rectangle(0, 0, W, H, 0x060d18, 1).setOrigin(0);
    }

    if (!gs.clan) {
      this._renderNoClan(W, H);
    } else {
      this._renderGuildPanel(W, H, gs.clan);
    }

    if (gs._moveMsg) { this._showMoveMsg(gs._moveMsg); gs._moveMsg = null; }

    this.input.keyboard.on('keydown-ESC', () => {
      // If search input is focused, ESC is handled inside the input's keydown listener
      if (document.activeElement === this._searchInp) return;
      this._destroyOverlay(); this.scene.stop();
    });
    this.input.keyboard.on('keydown-N', () => {
      if (document.activeElement === this._searchInp) return;
      this._destroyOverlay(); this.scene.stop();
    });
  }

  _destroyOverlay() {
    document.getElementById('sd-guild-overlay')?.remove();
    document.getElementById('sd-guild-search')?.remove();
    this._searchInp = null;
  }

  shutdown() {
    clearTimeout(this._searchDebounce);
    this._destroyOverlay();
  }

  // ── NO CLAN ──────────────────────────────────────────────────────────────
  _renderNoClan(W, H) {
    const gs      = this.gs;
    const isNeutral = (gs.playerCorp || 'neutral') === 'neutral';
    const pw = Math.min(720, W - 40), ph = Math.min(590, H - 60);
    const px = (W - pw) / 2, py = (H - ph) / 2;

    const bg = this.add.graphics();
    bg.fillStyle(0x080e1a, 0.94); bg.fillRoundedRect(px, py, pw, ph, 12);
    bg.lineStyle(2, COLORS.primary, 0.6); bg.strokeRoundedRect(px, py, pw, ph, 12);

    this.add.text(px + pw / 2, py + 20, 'ГИЛЬДИИ', this.O('22px')).setOrigin(0.5, 0);
    this.add.text(px + pw / 2, py + 54, 'Вы не состоите в гильдии', this.F('13px', '#445566')).setOrigin(0.5, 0);
    this.add.text(px + pw - 16, py + 24, 'N / ESC', this.F('10px', '#223344')).setOrigin(1, 0);

    // Neutral warning — blocks applications
    if (isNeutral) {
      const wBg = this.add.graphics();
      wBg.fillStyle(0x1a1200, 0.95); wBg.fillRoundedRect(px + 14, py + 76, pw - 28, 38, 6);
      wBg.lineStyle(1, 0x5a4a00, 0.8); wBg.strokeRoundedRect(px + 14, py + 76, pw - 28, 38, 6);
      this.add.text(px + pw / 2, py + 95,
        '⚠  Вступление в гильдию доступно только членам корпорации  (C — выбрать корп)',
        this.F('11px', '#ffb74d')).setOrigin(0.5);
    }

    // Pending application banner
    let topOffset = isNeutral ? 48 : 0;
    if (gs.pendingGuildApp) {
      const a    = gs.pendingGuildApp;
      const banY = py + 76 + topOffset;
      const banBg = this.add.graphics();
      banBg.fillStyle(0x0a1820, 0.92); banBg.fillRoundedRect(px + 14, banY, pw - 28, 36, 6);
      banBg.lineStyle(1, 0x2a6a40, 0.7); banBg.strokeRoundedRect(px + 14, banY, pw - 28, 36, 6);
      this.add.text(px + pw / 2, banY + 18,
        `⏳  Заявка подана в [${a.tag}] ${a.name} — ожидает рассмотрения`,
        this.F('11px', '#66bb6a')).setOrigin(0.5);
      const cx = this.add.text(px + pw - 22, banY + 18, '✕', this.F('14px', '#ef9a9a'))
        .setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
      cx.on('pointerdown', () => { gs.pendingGuildApp = null; this._sr(); });
      topOffset += 46;
    }

    // Corp filter
    const filterY = py + 78 + topOffset;
    this.add.text(px + 16, filterY, 'КОРПОРАЦИЯ:', this.F('11px', '#2a5060'));
    if (!gs._guildFilter) gs._guildFilter = 'все';
    const corps  = ['все', 'helios', 'karax', 'tides'];
    const corpCl = { все: '#9fb3b8', helios: '#ffe082', karax: '#ef9a9a', tides: '#80cbc4' };
    corps.forEach((c, i) => {
      const fw = 68, fh = 22, fx = px + 16 + i * (fw + 5), fy = filterY + 18;
      const sel  = gs._guildFilter === c;
      const fbg  = this.add.graphics();
      fbg.fillStyle(sel ? 0x0d2030 : 0x040c15, sel ? 1 : 0.8);
      fbg.fillRoundedRect(fx, fy, fw, fh, 4);
      if (sel) { fbg.lineStyle(1, COLORS.primary, 0.7); fbg.strokeRoundedRect(fx, fy, fw, fh, 4); }
      const fb = this.add.rectangle(fx + fw / 2, fy + fh / 2, fw, fh, 0, 0).setInteractive({ useHandCursor: true });
      this.add.text(fx + fw / 2, fy + fh / 2, c.toUpperCase(), this.F('10px', corpCl[c])).setOrigin(0.5);
      fb.on('pointerdown', () => { gs._guildFilter = c; this.scene.restart(); });
    });

    // Consume first-focus flag set by Enter in search input
    const firstFocus = gs._guildFirstFocus || false;
    gs._guildFirstFocus = false;

    // Text search input (HTML overlay)
    const searchY = filterY + 48;
    this._buildSearchInput(px + 14, searchY, pw - 28, 30);

    // Relevance filter + sort — only apply when 2+ chars typed
    const query  = (gs._guildSearch || '').trim().toLowerCase();
    const corpF  = gs._guildFilter;
    let guilds   = MOCK_GUILDS.filter(g => corpF === 'все' || g.corp === corpF);
    if (query.length >= 2) {
      guilds = guilds
        .map(g => ({ g, score: this._searchScore(g, query) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ g }) => g);
    }

    // Guild list
    const listY   = searchY + 38;
    const rowH    = 68, rowGap = 6;
    const myLvl   = gs.pilotLevel || 1;
    const maxRows = Math.floor((ph - (listY - py) - 54) / (rowH + rowGap));

    if (guilds.length === 0 && query.length >= 2) {
      this.add.text(px + pw / 2, listY + 20, 'Ничего не найдено', this.F('13px', '#1a2a3a')).setOrigin(0.5, 0);
    }

    guilds.slice(0, maxRows).forEach((g, i) => {
      const ry = listY + i * (rowH + rowGap);
      const rw = pw - 28, rx = px + 14;
      const highlight = firstFocus && i === 0;

      const rbg = this.add.graphics();
      rbg.fillStyle(0x0a1520, 0.9); rbg.fillRoundedRect(rx, ry, rw, rowH, 6);
      rbg.lineStyle(highlight ? 2 : 1, highlight ? COLORS.primary : 0x1a2a3a, highlight ? 0.9 : 0.6);
      rbg.strokeRoundedRect(rx, ry, rw, rowH, 6);

      const cc = corpCl[g.corp] || '#9fb3b8';
      this.add.text(rx + 12, ry + 8,  `[${g.tag}]`,  this.O('12px', cc));
      this.add.text(rx + 12 + g.tag.length * 9 + 8, ry + 8, g.name, this.O('12px', '#cce8f0'));
      this.add.text(rx + 12, ry + 28, `Ур.${g.level}  ·  ${g.members}/50`, this.F('11px', '#2a5a70'));
      if (g.motto) this.add.text(rx + 12, ry + 46, `"${g.motto}"`, this.F('10px', '#4a8898'));

      this.add.text(rx + rw - 12, ry + 8, g.recruiting ? '● набор открыт' : '● набор закрыт',
        this.F('10px', g.recruiting ? '#4acc88' : '#334455')).setOrigin(1, 0);
      this.add.text(rx + rw - 12, ry + 26, `мин. ур. ${g.minLvl}`,
        this.F('10px', myLvl >= g.minLvl ? '#2a5a40' : '#5a2a2a')).setOrigin(1, 0);

      const isPend    = gs.pendingGuildApp?.name === g.name;
      const sameCorp  = !isNeutral && g.corp === gs.playerCorp;
      const canApply  = sameCorp && g.recruiting && myLvl >= g.minLvl && !gs.pendingGuildApp;
      const abw = 126, abh = 24, abx = rx + rw - abw - 10, aby = ry + rowH - abh - 8;
      const abg = this.add.graphics();
      abg.fillStyle(canApply ? 0x081a22 : 0x080e14, 0.9);
      abg.fillRoundedRect(abx, aby, abw, abh, 4);
      abg.lineStyle(1, canApply ? COLORS.primary : 0x1a2a3a, 0.5);
      abg.strokeRoundedRect(abx, aby, abw, abh, 4);
      const aBtn = this.add.rectangle(abx + abw / 2, aby + abh / 2, abw, abh, 0, 0)
        .setInteractive({ useHandCursor: canApply });
      const aLbl = isPend      ? '✓ заявка подана'
                 : isNeutral   ? 'нет корпорации'
                 : !sameCorp   ? 'другая корпорация'
                 : 'ПОДАТЬ ЗАЯВКУ';
      this.add.text(abx + abw / 2, aby + abh / 2, aLbl,
        this.F('10px', isPend ? '#66bb6a' : canApply ? '#4dd0e1' : '#2a4a5a')).setOrigin(0.5);
      if (canApply) {
        aBtn.on('pointerover', () => { abg.clear(); abg.fillStyle(0x0d2a38, 0.95); abg.fillRoundedRect(abx, aby, abw, abh, 4); });
        aBtn.on('pointerout',  () => { abg.clear(); abg.fillStyle(0x081a22, 0.9);  abg.fillRoundedRect(abx, aby, abw, abh, 4); });
        aBtn.on('pointerdown', () => { gs.pendingGuildApp = { name: g.name, tag: g.tag }; this._sr(); });
      }
    });

    // Create guild button
    const cY  = py + ph - 46;
    const canC = myLvl >= GUILD_MIN_LVL && (gs.credits || 0) >= GUILD_CREATE_CR && (gs.starGold || 0) >= GUILD_CREATE_ST;
    this.add.text(px + pw / 2, cY - 6,
      myLvl < GUILD_MIN_LVL
        ? `Основать гильдию — требуется уровень ${GUILD_MIN_LVL} (ваш: ${myLvl})`
        : `Основать гильдию — 50 000 кр + 100 ⭐`,
      this.F('11px', canC ? '#ffe0b2' : '#3a2a1a')).setOrigin(0.5, 1);

    const cBw = 240, cBh = 32, cBx = px + pw / 2 - cBw / 2;
    const cbg = this.add.graphics();
    cbg.fillStyle(canC ? 0x0a1a0e : 0x080e0a, 0.92);
    cbg.fillRoundedRect(cBx, cY, cBw, cBh, 5);
    cbg.lineStyle(1, canC ? 0x4acc88 : 0x1a2a1a, 0.6);
    cbg.strokeRoundedRect(cBx, cY, cBw, cBh, 5);
    const cBtn = this.add.rectangle(cBx + cBw / 2, cY + cBh / 2, cBw, cBh, 0, 0)
      .setInteractive({ useHandCursor: canC });
    this.add.text(cBx + cBw / 2, cY + cBh / 2, '+ ОСНОВАТЬ ГИЛЬДИЮ',
      this.F('12px', canC ? '#66bb6a' : '#2a3a2a')).setOrigin(0.5);
    if (canC) {
      cBtn.on('pointerover', () => { cbg.clear(); cbg.fillStyle(0x122818, 0.95); cbg.fillRoundedRect(cBx, cY, cBw, cBh, 5); });
      cBtn.on('pointerout',  () => { cbg.clear(); cbg.fillStyle(0x0a1a0e, 0.92); cbg.fillRoundedRect(cBx, cY, cBw, cBh, 5); });
      cBtn.on('pointerdown', () => this._showCreateDialog());
    }
  }

  // ── CREATE DIALOG ─────────────────────────────────────────────────────────
  _showCreateDialog() {
    // Guard: remove any existing overlay before creating a new one
    document.getElementById('sd-guild-overlay')?.remove();

    const gs = this.gs;
    const ov = document.createElement('div');
    ov.id = 'sd-guild-overlay';
    ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.75);z-index:1000;font-family:Inter,sans-serif';
    ov.innerHTML = `
      <div style="background:#080e1a;border:2px solid #4dd0e1;border-radius:12px;padding:28px 36px;min-width:340px;color:#cce8f0">
        <div style="font-family:Orbitron,sans-serif;font-size:18px;color:#4dd0e1;margin-bottom:20px">ОСНОВАТЬ ГИЛЬДИЮ</div>
        <label for="sd-gc-name" style="display:block;font-size:11px;color:#445566;margin-bottom:4px">НАЗВАНИЕ (3–20 символов)</label>
        <input id="sd-gc-name" maxlength="20" placeholder="Название гильдии" style="width:100%;box-sizing:border-box;background:#0d1828;border:1px solid #1a3a5a;border-radius:4px;padding:8px 10px;color:#cce8f0;font-size:14px;outline:none;margin-bottom:12px">
        <label for="sd-gc-tag" style="display:block;font-size:11px;color:#445566;margin-bottom:4px">АББРЕВИАТУРА (2–4 символа)</label>
        <input id="sd-gc-tag" maxlength="4" placeholder="ТЭГГ" style="width:120px;background:#0d1828;border:1px solid #1a3a5a;border-radius:4px;padding:8px 10px;color:#cce8f0;font-size:14px;outline:none;text-transform:uppercase;margin-bottom:16px">
        <div style="font-size:11px;color:#ffe0b2;margin-bottom:16px">Стоимость: 50 000 кр + 100 ⭐</div>
        <div style="display:flex;gap:10px">
          <button id="sd-gc-ok" style="flex:1;padding:10px;background:#0a1a10;border:1px solid #4acc88;border-radius:6px;color:#66bb6a;font-size:13px;cursor:pointer">✓ ОСНОВАТЬ</button>
          <button id="sd-gc-cancel" style="flex:1;padding:10px;background:#0a0e14;border:1px solid #1a2a3a;border-radius:6px;color:#445566;font-size:13px;cursor:pointer">ОТМЕНА</button>
        </div>
        <div id="sd-gc-err" style="color:#ef9a9a;font-size:11px;margin-top:10px;min-height:16px"></div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('keydown', e => e.stopPropagation());

    const nameI = ov.querySelector('#sd-gc-name');
    const tagI  = ov.querySelector('#sd-gc-tag');
    const errD  = ov.querySelector('#sd-gc-err');
    tagI.addEventListener('input', () => { tagI.value = tagI.value.toUpperCase(); });
    nameI.focus();

    ov.querySelector('#sd-gc-cancel').addEventListener('click', () => ov.remove());
    ov.querySelector('#sd-gc-ok').addEventListener('click', () => {
      const name = nameI.value.trim(), tag = tagI.value.trim().toUpperCase();
      if (name.length < 3) { errD.textContent = 'Минимум 3 символа в названии'; return; }
      if (tag.length < 2)  { errD.textContent = 'Аббревиатура: 2–4 символа'; return; }
      gs.credits  = (gs.credits  || 0) - GUILD_CREATE_CR;
      gs.starGold = (gs.starGold || 0) - GUILD_CREATE_ST;
      gs.clan = {
        name, tag,
        corp:       gs.playerCorp || 'helios',
        level:      1,
        myRole:     'Капитан',
        clanPoints: 0,
        recruiting: true,
        motto:      '',
        members:    [{ name: gs.playerName || 'Пилот', role: 'Капитан', online: true, contribution: 0, level: gs.pilotLevel || 1 }],
        applications: [],
        vault: [], vaultTier: 0,
        treasury: { credits: 0 },
        buffs: [
          { key: 'hull',   name: 'Броня', icon: '🛡', lvl: 0, maxLvl: 5 },
          { key: 'shield', name: 'Щит',   icon: '💠', lvl: 0, maxLvl: 5 },
          { key: 'damage', name: 'Урон',  icon: '⚡', lvl: 0, maxLvl: 5 },
        ],
        log: [{ time: this._ts(), text: `${gs.playerName || 'Пилот'} основал гильдию ${name}`, color: '#ce93d8' }],
      };
      gs.pendingGuildApp = null;
      gs.clanTab = 'members';
      gs._guildSearch = '';
      gs._guildFilter = 'все';
      ov.remove();
      this._sr();
    });
  }

  _ts() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${dd}.${mo}  ${hh}:${mm}`;
  }

  // ── GUILD PANEL ──────────────────────────────────────────────────────────
  _renderGuildPanel(W, H, clan) {
    const gs  = this.gs;
    const pw  = Math.min(920, W - 40);
    const ph  = Math.min(640, H - 50);
    const px  = (W - pw) / 2, py = (H - ph) / 2;

    const panel = this.add.graphics();
    panel.fillStyle(0x080e1a, 0.94); panel.fillRoundedRect(px, py, pw, ph, 12);
    panel.lineStyle(2, COLORS.primary, 0.6); panel.strokeRoundedRect(px, py, pw, ph, 12);

    // Header
    const cc = { helios: '#ffe082', karax: '#ef9a9a', tides: '#80cbc4' }[clan.corp] || '#4dd0e1';
    const tagW = this.add.text(px + 20, py + 12, `[${clan.tag}]`, this.O('20px', cc)).width + 10;
    this.add.text(px + 20 + tagW, py + 12, clan.name, this.O('20px', '#cce8f0'));
    const online = (clan.members || []).filter(m => m.online).length;
    this.add.text(px + 20, py + 48,
      `${online} онлайн · ${(clan.members || []).length} участников · Гильдия ур.${clan.level}`,
      this.F('13px', '#6aaabb'));
    // Motto (left half of py+66 row)
    if (clan.motto) this.add.text(px + 20, py + 67, '"' + clan.motto + '"', this.F('12px', '#5a9aac'));
    // Message block (right half of py+66 row, different background)
    if (clan.message) {
      const msgBX = px + Math.floor(pw / 2) + 10;
      const msgBW = pw - Math.floor(pw / 2) - 30;
      const msgBG = this.add.graphics();
      msgBG.fillStyle(0x0a1a2c, 0.95); msgBG.fillRoundedRect(msgBX, py + 62, msgBW, 20, 4);
      msgBG.lineStyle(1, 0x1e4a6a, 0.9); msgBG.strokeRoundedRect(msgBX, py + 62, msgBW, 20, 4);
      this.add.text(msgBX + 10, py + 72, '📢 ' + clan.message, this.F('11px', '#7ac8e0')).setOrigin(0, 0.5);
    }
    const rCol = clan.myRole === 'Капитан' ? '#ffb74d' : clan.myRole === 'Офицер' ? '#4dd0e1' : '#9fb3b8';
    this.add.text(px + pw - 16, py + 16, clan.myRole || 'Новобранец', this.F('13px', rCol)).setOrigin(1, 0);
    this.add.text(px + pw - 16, py + 36, 'N / ESC', this.F('11px', '#3a5a6a')).setOrigin(1, 0);

    // Tabs — captain sees all 6, others 5 (no НАСТРОЙКИ)
    const allTabs = [
      { key: 'members',  label: 'ЧЛЕНЫ'     },
      { key: 'vault',    label: 'СКЛАД'     },
      { key: 'treasury', label: 'КАЗНА'     },
      { key: 'buffs',    label: 'БАФФЫ'     },
      { key: 'log',      label: 'ИСТОРИЯ'   },
      { key: 'settings', label: 'НАСТРОЙКИ' },
    ];
    const tabs   = clan.myRole === 'Капитан' ? allTabs : allTabs.filter(t => t.key !== 'settings');
    if (!gs.clanTab || !tabs.find(t => t.key === gs.clanTab)) gs.clanTab = 'members';

    const tabY = py + 84, tabH = 30, tabW = Math.floor(pw / tabs.length);
    tabs.forEach(({ key, label }, i) => {
      const tx  = px + i * tabW;
      const sel = gs.clanTab === key;
      const tbg = this.add.graphics();
      const fillIdle = sel ? 0x0d2030 : 0x112640;
      tbg.fillStyle(fillIdle, 1);
      tbg.fillRoundedRect(tx + 2, tabY, tabW - 4, tabH, 4);
      tbg.lineStyle(1, sel ? COLORS.primary : 0x3a7aaa, sel ? 0.8 : 0.7);
      tbg.strokeRoundedRect(tx + 2, tabY, tabW - 4, tabH, 4);
      const btn = this.add.rectangle(tx + tabW / 2, tabY + tabH / 2, tabW - 4, tabH, 0, 0)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => { gs.clanTab = key; this.scene.restart(); });
      btn.on('pointerover', () => { if (!sel) { tbg.clear(); tbg.fillStyle(0x1a3a54, 1); tbg.fillRoundedRect(tx + 2, tabY, tabW - 4, tabH, 4); tbg.lineStyle(1, 0x4a9ac0, 0.8); tbg.strokeRoundedRect(tx + 2, tabY, tabW - 4, tabH, 4); } });
      btn.on('pointerout',  () => { if (!sel) { tbg.clear(); tbg.fillStyle(0x112640, 1); tbg.fillRoundedRect(tx + 2, tabY, tabW - 4, tabH, 4); tbg.lineStyle(1, 0x3a7aaa, 0.7); tbg.strokeRoundedRect(tx + 2, tabY, tabW - 4, tabH, 4); } });
      this.add.text(tx + tabW / 2, tabY + tabH / 2, label, this.O('12px', sel ? '#4dd0e1' : '#7abccc')).setOrigin(0.5);
    });

    const cx = px + 12, cy = py + 120, cw = pw - 24, ch = ph - 128;
    switch (gs.clanTab) {
      case 'members':  this._tabMembers( cx, cy, cw, ch, clan); break;
      case 'vault':    this._tabVault(   cx, cy, cw, ch, clan); break;
      case 'treasury': this._tabTreasury(cx, cy, cw, ch, clan); break;
      case 'buffs':    this._tabBuffs(   cx, cy, cw, ch, clan); break;
      case 'log':      this._tabLog(     cx, cy, cw, ch, clan); break;
      case 'settings': this._tabSettings(cx, cy, cw, ch, clan); break;
    }
  }

  // ── ЧЛЕНЫ ─────────────────────────────────────────────────────────────────
  _tabMembers(x, y, w, h, clan) {
    const isOff  = ['Капитан', 'Офицер'].includes(clan.myRole);
    const isCapt = clan.myRole === 'Капитан';
    const apps   = clan.applications || [];

    // Calculate apps block height
    let appsBlockH = 0;
    if (isOff && apps.length > 0) {
      appsBlockH = 30 + apps.length * 48 + 12;
    }

    const listY = y + appsBlockH;
    const listH = h - appsBlockH;

    // Member rows — scrollable container (rendered before apps so apps mask overflow)
    const rowH = 50, rowGap = 5;
    const members = clan.members || [];
    const container = this.add.container(x, listY);

    members.forEach((m, i) => {
      const ry = i * (rowH + rowGap);

      const mbg = this.add.graphics();
      mbg.fillStyle(0x0a1520, 0.9); mbg.fillRoundedRect(0, ry, w, rowH, 5);
      mbg.lineStyle(1, m.online ? 0x1a3a20 : 0x0d1a26, 0.6); mbg.strokeRoundedRect(0, ry, w, rowH, 5);

      const dot = this.add.graphics();
      dot.fillStyle(m.online ? 0x66bb6a : 0x334455, 1);
      dot.fillCircle(18, ry + rowH / 2, 5);

      const rc = m.role === 'Капитан' ? '#ffb74d' : m.role === 'Офицер' ? '#4dd0e1' : '#3a5a6a';
      const nameTxt  = this.add.text(34, ry + 9,  m.name, this.O('13px', '#cce8f0'));
      const roleTxt  = this.add.text(34, ry + 28, m.role, this.F('12px', rc));
      const lvlTxt   = this.add.text(w / 2, ry + rowH / 2, 'Ур. ' + (m.level || '?'), this.F('12px', '#2a5a70')).setOrigin(0.5);

      const rowEls = [mbg, dot, nameTxt, roleTxt, lvlTxt];

      if (isCapt && m.role !== 'Капитан') {
        const isOfficer = m.role === 'Офицер';
        const newRole   = isOfficer ? 'Новобранец' : 'Офицер';
        const lbl       = isOfficer ? '▼ в Новобранцы' : '▲ в Офицеры';
        const clr       = isOfficer ? '#ef9a9a' : '#4dd0e1';
        const bw = 114, bh = 20;
        const bx = w - 14 - bw;
        const by = ry + (rowH - bh) / 2;
        const bbg = this.add.graphics();
        bbg.fillStyle(isOfficer ? 0x1a0808 : 0x081822, 0.9);
        bbg.fillRoundedRect(bx, by, bw, bh, 3);
        bbg.lineStyle(1, isOfficer ? 0x5a2a2a : 0x1a4a6a, 0.7);
        bbg.strokeRoundedRect(bx, by, bw, bh, 3);
        const rbtn = this.add.rectangle(bx + bw / 2, by + bh / 2, bw, bh, 0, 0)
          .setInteractive({ useHandCursor: true });
        const rLbl = this.add.text(bx + bw / 2, by + bh / 2, lbl, this.F('11px', clr)).setOrigin(0.5);
        rbtn.on('pointerdown', () => { m.role = newRole; this._sr(); });
        rbtn.on('pointerover', () => { bbg.clear(); bbg.fillStyle(isOfficer ? 0x2a1010 : 0x102030, 0.9); bbg.fillRoundedRect(bx, by, bw, bh, 3); });
        rbtn.on('pointerout',  () => { bbg.clear(); bbg.fillStyle(isOfficer ? 0x1a0808 : 0x081822, 0.9); bbg.fillRoundedRect(bx, by, bw, bh, 3); });
        rowEls.push(bbg, rbtn, rLbl);
      } else if (!isCapt) {
        const contrTxt = this.add.text(w - 14, ry + 10, 'вклад: ' + (m.contribution || 0).toLocaleString(), this.F('11px', '#5a9aac')).setOrigin(1, 0);
        const onlTxt   = this.add.text(w - 14, ry + 28, m.online ? 'онлайн' : 'офлайн', this.F('11px', m.online ? '#5aaa66' : '#5a7a8a')).setOrigin(1, 0);
        rowEls.push(contrTxt, onlTxt);
      }

      container.add(rowEls);
    });

    // Scroll wheel
    const totalH = members.length * (rowH + rowGap);
    if (totalH > listH) {
      this.input.on('wheel', (p, _o, _dx, dy) => {
        if (p.x < x || p.x > x + w || p.y < listY || p.y > listY + listH) return;
        container.y = Phaser.Math.Clamp(container.y - dy * 0.5, listY - (totalH - listH), listY);
      });
      this.add.rectangle(x, listY + listH, w, 60, 0x080e1a).setOrigin(0, 0).setDepth(12);
    }

    // Applications block — rendered AFTER container so its background masks scrolled overflow
    if (isOff && apps.length > 0) {
      const abBg = this.add.graphics();
      abBg.fillStyle(0x0a1810, 0.9); abBg.fillRoundedRect(x, y, w, appsBlockH - 12, 6);
      abBg.lineStyle(1, 0x2a5a2a, 0.5); abBg.strokeRoundedRect(x, y, w, appsBlockH - 12, 6);
      this.add.text(x + 14, y + 9, 'ЗАЯВКИ (' + apps.length + ')', this.O('13px', '#66bb6a'));

      apps.forEach((app, i) => {
        const ry = y + 30 + i * 48;
        const rbg2 = this.add.graphics();
        rbg2.fillStyle(0x0c1f10, 0.88); rbg2.fillRoundedRect(x + 8, ry, w - 16, 40, 4);
        this.add.text(x + 22, ry + 8,  app.name,               this.O('13px', '#b8e4c4'));
        this.add.text(x + 22, ry + 26, 'Уровень ' + app.level, this.F('11px', '#2a6a3a'));
        if (app.msg) this.add.text(x + 140, ry + 18, '"' + app.msg + '"', this.F('11px', '#1a4a2a')).setOrigin(0, 0.5);

        const bw = 86, bh = 22, btnY = ry + 9;
        this._sBtn(x + w - 16 - bw * 2 - 8, btnY, bw, bh, '✓ ПРИНЯТЬ', '#66bb6a', 0x0a1a0e, () => {
          clan.members.push({ name: app.name, role: 'Новобранец', online: false, contribution: 0, level: app.level });
          apps.splice(apps.indexOf(app), 1);
          (clan.log = clan.log || []).unshift({ time: this._ts(), text: app.name + ' вступил в гильдию', color: '#66bb6a' });
          clan.log = clan.log.slice(0, 500);
          this._sr();
        });
        this._sBtn(x + w - 16 - bw, btnY, bw, bh, '✕ ОТКЛОНИТЬ', '#ef9a9a', 0x1a0a0a, () => {
          apps.splice(apps.indexOf(app), 1);
          this._sr();
        });
      });
    }
  }

  // ── СКЛАД ─────────────────────────────────────────────────────────────────
  _tabVault(x, y, w, h, clan) {
    const isOff    = ['Капитан', 'Офицер'].includes(clan.myRole);
    const tier     = VAULT_TIERS[clan.vaultTier ?? 0];
    const maxSlots = tier?.slots ?? 10;
    const vault    = clan.vault || [];
    const count    = vault.length;
    const gs       = this.gs;

    const roleHint = isOff ? '' : '  (просмотр)';
    this.add.text(x + w / 2, y + 6, `СКЛАД ГИЛЬДИИ  ${count} / ${maxSlots}${roleHint}`, this.F('12px', '#2a5a70')).setOrigin(0.5, 0);

    // "Положить из трюма" → переходим в личный склад (CargoScene)
    if (isOff) {
      const canPut = count < maxSlots;
      this._btn(x + w / 2 - 106, y + 24, 212, 26, '+ Положить из трюма',
        canPut ? '#66bb6a' : '#2a4a2a', 0x0a1a0e, 0x162818, () => {
          if (!canPut) return;
          this._destroyOverlay();
          this.scene.stop();
          gs.toggleOverlay?.('CargoScene');
        });
    }

    // Slot grid — larger cells, auto cols, centered
    const SZ = 68, GAP = 6;
    const STRIP_H = 16, BODY_H = SZ - STRIP_H;
    const COLS = Math.min(10, Math.floor((w + GAP) / (SZ + GAP)));
    const gridW = COLS * SZ + (COLS - 1) * GAP;
    const gx = x + Math.floor((w - gridW) / 2);
    const gridY = y + 58;

    for (let si = 0; si < maxSlots; si++) {
      const col = si % COLS, row = Math.floor(si / COLS);
      const sx = gx + col * (SZ + GAP);
      const sy = gridY + row * (SZ + GAP);
      const item = vault[si] ?? null;

      if (!item) {
        const eg = this.add.graphics();
        eg.fillStyle(0x0c1828, 0.95); eg.fillRoundedRect(sx, sy, SZ, SZ, 4);
        eg.lineStyle(1, 0x2a4a6a, 0.65); eg.strokeRoundedRect(sx, sy, SZ, SZ, 4);
        continue;
      }

      const pDef   = item.perk ? PERK_MAP[item.perk.key] : null;
      const rarHex = pDef ? RARITY_COLOR[pDef.rarity] : null;
      const bdrClr = rarHex ?? COLORS.emerald;
      const vbg = this.add.graphics();
      vbg.fillStyle(0x0c1a10, 0.9); vbg.fillRoundedRect(sx, sy, SZ, BODY_H, 4);
      vbg.lineStyle(1, bdrClr, pDef ? 0.6 : 0.35); vbg.strokeRoundedRect(sx, sy, SZ, BODY_H, 4);
      const iconK = itemIconKey(item);
      if (iconK) {
        this.add.image(sx + SZ / 2, sy + BODY_H / 2, prerenderTex(this, iconK, 48, 48))
          .setDisplaySize(48, 48).setOrigin(0.5);
      } else {
        this.add.text(sx + SZ / 2, sy + BODY_H / 2, `T${item.tier}`, this.F('10px', '#b8e4c4')).setOrigin(0.5);
      }
      this.add.text(sx + 3, sy + 3, `T${item.tier || '?'}`, this.F('8px', '#3a6840'));
      if (rarHex) {
        const dg = this.add.graphics();
        dg.fillStyle(rarHex, 1); dg.fillCircle(sx + SZ - 6, sy + 6, 4);
      }

      // Hover tooltip — always interactive regardless of role
      const hitBox = this.add.rectangle(sx + SZ / 2, sy + BODY_H / 2, SZ, BODY_H, 0, 0)
        .setInteractive({ useHandCursor: false });
      hitBox.on('pointerover', (p) => this._showVaultTooltip(p.x, p.y, item));
      hitBox.on('pointerout',  ()  => this._hideVaultTooltip());

      if (isOff) {
        const cargoFull = (gs.inventory || []).length >= 30;
        const sBg = this.add.graphics();
        sBg.fillStyle(cargoFull ? 0x080e0a : 0x0a1a0e, 0.9);
        sBg.fillRoundedRect(sx, sy + BODY_H, SZ, STRIP_H, 0);
        sBg.lineStyle(1, cargoFull ? 0x131a13 : 0x1a4a2a, 0.5);
        sBg.strokeRoundedRect(sx, sy + BODY_H, SZ, STRIP_H, 0);
        const sZone = this.add.rectangle(sx + SZ / 2, sy + BODY_H + STRIP_H / 2, SZ, STRIP_H, 0, 0)
          .setInteractive({ useHandCursor: !cargoFull });
        this.add.text(sx + SZ / 2, sy + BODY_H + STRIP_H / 2, '← в трюм',
          this.F('10px', cargoFull ? '#1a3a22' : '#5cdd9a')).setOrigin(0.5);
        if (!cargoFull) {
          sZone.on('pointerdown', () => {
            this._hideVaultTooltip();
            this._showVaultMoveConfirm(item, vault, clan);
          });
        }
      }
    }
  }

  // ── VAULT TOOLTIP ─────────────────────────────────────────────────────────
  _showVaultTooltip(wx, wy, item) {
    this._hideVaultTooltip();
    if (!item) return;
    const W = this.scale.width, H = this.scale.height;
    const pDef = item.perk ? PERK_MAP[item.perk.key] : null;
    const rarColor = pDef ? `#${RARITY_COLOR[pDef.rarity].toString(16).padStart(6, '0')}` : null;
    const TW = 230, LINE_H = 17;
    const lines = [
      { text: itemName(item),  sty: this.O('13px', '#ffe0b2') },
      { text: itemStats(item), sty: this.F('11px', '#9fb3b8') },
    ];
    if (pDef) {
      lines.push({ text: pDef.name,                       sty: this.F('11px', rarColor) });
      lines.push({ text: pDef.desc(perkBonus(item.perk)), sty: this.F('11px', '#aaccdd') });
    }
    const TH = 10 + lines.length * LINE_H + 6;
    let tx = wx + 16, ty = wy - TH / 2;
    if (tx + TW > W - 8) tx = wx - TW - 8;
    if (ty < 4) ty = 4;
    if (ty + TH > H - 4) ty = H - TH - 4;
    const g = this.add.graphics().setDepth(200);
    g.fillStyle(0x08121e, 0.97); g.fillRoundedRect(tx, ty, TW, TH, 6);
    g.lineStyle(1, 0x1e3a50, 0.9); g.strokeRoundedRect(tx, ty, TW, TH, 6);
    const objs = [g];
    let ly = ty + 8;
    for (const l of lines) {
      objs.push(this.add.text(tx + 10, ly, l.text,
        { ...l.sty, wordWrap: { width: TW - 20 } }).setDepth(201));
      ly += LINE_H;
    }
    this._vaultTooltipObjs = objs;
  }

  _hideVaultTooltip() {
    this._vaultTooltipObjs?.forEach(o => o?.destroy());
    this._vaultTooltipObjs = null;
  }

  // ── VAULT MOVE CONFIRM ────────────────────────────────────────────────────
  _showVaultMoveConfirm(item, vault, clan) {
    if (this._vaultConfirmObjs) this._closeVaultConfirm();
    const W = this.scale.width, H = this.scale.height;
    const gs = this.gs;
    const mw = 320, mh = 150;
    const mx = (W - mw) / 2, my = (H - mh) / 2;
    const objs = [];

    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.65).setOrigin(0).setDepth(60).setInteractive();
    dim.on('pointerdown', () => this._closeVaultConfirm());
    objs.push(dim);

    const panel = this.add.graphics().setDepth(61);
    panel.fillStyle(0x0a0f1a, 0.98); panel.fillRoundedRect(mx, my, mw, mh, 10);
    panel.lineStyle(2, 0x1e6a80, 0.85); panel.strokeRoundedRect(mx, my, mw, mh, 10);
    objs.push(panel);

    objs.push(this.add.text(W / 2, my + 22, 'ВЗЯТЬ ИЗ СКЛАДА ГИЛЬДИИ?', this.O('12px', '#4dd0e1')).setOrigin(0.5).setDepth(62));
    objs.push(this.add.text(W / 2, my + 52, itemName(item), this.F('12px', '#b0bec5')).setOrigin(0.5).setDepth(62));

    const btnY = my + mh - 42;
    const cancelBtn = this.add.rectangle(W / 2 - 75, btnY, 120, 30, 0x0d1e2c, 1)
      .setStrokeStyle(1, 0x2a6888, 0.8).setDepth(61).setInteractive({ useHandCursor: true });
    cancelBtn.on('pointerover', () => cancelBtn.setFillStyle(0x162838));
    cancelBtn.on('pointerout',  () => cancelBtn.setFillStyle(0x0d1e2c));
    cancelBtn.on('pointerdown', () => this._closeVaultConfirm());
    objs.push(cancelBtn);
    objs.push(this.add.text(W / 2 - 75, btnY, 'ОТМЕНА', this.O('11px', '#4dd0e1')).setOrigin(0.5).setDepth(62));

    const takeBtn = this.add.rectangle(W / 2 + 75, btnY, 120, 30, 0x0a1a0e, 1)
      .setStrokeStyle(1, 0x2a6840, 0.8).setDepth(61).setInteractive({ useHandCursor: true });
    takeBtn.on('pointerover', () => takeBtn.setFillStyle(0x142818));
    takeBtn.on('pointerout',  () => takeBtn.setFillStyle(0x0a1a0e));
    takeBtn.on('pointerdown', () => {
      this._closeVaultConfirm();
      const idx = vault.indexOf(item); if (idx < 0) return;
      vault.splice(idx, 1);
      (gs.inventory = gs.inventory || []).push(item);
      (clan.log = clan.log || []).unshift({ time: this._ts(),
        text: `${gs.playerName || 'Пилот'} взял «${itemName(item)}» со склада`,
        color: '#ef9a9a' });
      clan.log = clan.log.slice(0, 500);
      gs._moveMsg = `← В ТРЮМ: ${itemName(item)}`;
      this._sr();
    });
    objs.push(takeBtn);
    objs.push(this.add.text(W / 2 + 75, btnY, 'ВЗЯТЬ', this.O('11px', '#4acc88')).setOrigin(0.5).setDepth(62));

    this._vaultConfirmObjs = objs;
  }

  _closeVaultConfirm() {
    this._vaultConfirmObjs?.forEach(o => o?.destroy());
    this._vaultConfirmObjs = null;
  }

  // ── КАЗНА ─────────────────────────────────────────────────────────────────
  _tabTreasury(x, y, w, h, clan) {
    const isCapt = clan.myRole === 'Капитан';
    const treas  = clan.treasury || { credits: 0 };
    const hW     = Math.floor((w - 14) / 2);

    // Left column
    const lx = x;
    this.add.text(lx + hW / 2, y + 6, 'КАЗНА', this.O('13px', '#2a5a70')).setOrigin(0.5, 0);

    const balBg = this.add.graphics();
    balBg.fillStyle(0x080e18, 0.9); balBg.fillRoundedRect(lx, y + 28, hW, 52, 6);
    balBg.lineStyle(1, 0x1a2a3a, 0.8); balBg.strokeRoundedRect(lx, y + 28, hW, 52, 6);
    this.add.text(lx + 14, y + 36, 'Кредиты',              this.F('11px', '#2a5060'));
    this.add.text(lx + 14, y + 52, treas.credits.toLocaleString(), this.O('16px', '#ffe0b2'));

    // Deposit input + button (side by side)
    const inpW = hW - 92, btnW = 88;
    const depBg = this.add.graphics();
    depBg.fillStyle(0x0d1828, 1); depBg.fillRoundedRect(lx, y + 88, inpW, 28, 4);
    depBg.lineStyle(1, 0x1a3a5a, 0.9); depBg.strokeRoundedRect(lx, y + 88, inpW, 28, 4);
    this._buildDepositInput(lx, y + 88, inpW, 28, clan);
    this._btn(lx + inpW + 4, y + 88, btnW, 28, 'ВНЕСТИ', '#4dd0e1', 0x081420, 0x102030, () => {
      const raw = (document.getElementById('sd-dep-inp')?.value || '').replace(/[^0-9]/g, '');
      const amt = parseInt(raw, 10);
      if (!amt || amt <= 0 || amt > (this.gs.credits || 0)) return;
      document.getElementById('sd-dep-inp')?.blur();
      clan._depAmt = '';
      this.gs.credits -= amt;
      treas.credits   += amt;
      (clan.log = clan.log || []).unshift({ time: this._ts(), text: `${this.gs.playerName || 'Пилот'} внёс ${amt.toLocaleString()} кр в казну`, color: '#ffe0b2' });
      clan.log = clan.log.slice(0, 500);
      this._sr();
    });

    // Clan points
    const ptsBg = this.add.graphics();
    ptsBg.fillStyle(0x080e18, 0.9); ptsBg.fillRoundedRect(lx, y + 130, hW, 42, 6);
    ptsBg.lineStyle(1, 0x1a2a3a, 0.8); ptsBg.strokeRoundedRect(lx, y + 130, hW, 42, 6);
    this.add.text(lx + 14, y + 138, 'Очки гильдии', this.F('11px', '#2a5060'));
    this.add.text(lx + 14, y + 152, (clan.clanPoints || 0).toLocaleString(), this.O('14px', '#ce93d8'));

    // Vault upgrade
    const vt   = clan.vaultTier ?? 0, cur = VAULT_TIERS[vt], nxt = VAULT_TIERS[vt + 1];
    const vsY  = y + 184;
    this.add.text(lx + hW / 2, vsY, 'РАСШИРИТЬ СКЛАД', this.O('11px', '#2a5a70')).setOrigin(0.5, 0);
    const cvBg = this.add.graphics();
    cvBg.fillStyle(0x080e18, 0.9); cvBg.fillRoundedRect(lx, vsY + 18, hW, 34, 5);
    cvBg.lineStyle(1, 0x1a2a3a, 0.8); cvBg.strokeRoundedRect(lx, vsY + 18, hW, 34, 5);
    this.add.text(lx + 10, vsY + 26, `Тир ${vt}: ${cur.slots} слотов`, this.O('11px', '#4dd0e1'));
    this.add.text(lx + hW - 10, vsY + 26, `Очков: ${(clan.clanPoints || 0).toLocaleString()}`, this.F('10px', '#2a6a50')).setOrigin(1, 0);

    if (nxt && isCapt) {
      const canU  = treas.credits >= nxt.cr && (clan.clanPoints || 0) >= nxt.pts;
      const nBg   = this.add.graphics();
      nBg.fillStyle(0x080e18, 0.9); nBg.fillRoundedRect(lx, vsY + 58, hW, 34, 5);
      nBg.lineStyle(1, canU ? 0x1a4a2a : 0x1a2a3a, 0.8); nBg.strokeRoundedRect(lx, vsY + 58, hW, 34, 5);
      this.add.text(lx + 10, vsY + 66, `→ Тир ${vt + 1}: ${nxt.slots} слотов`, this.O('11px', canU ? '#66cc88' : '#334455'));
      this.add.text(lx + hW - 10, vsY + 66, `${(nxt.cr / 1000).toFixed(0)}k кр · ${nxt.pts.toLocaleString()} очков`, this.F('10px', canU ? '#ffe0b2' : '#2a3a2a')).setOrigin(1, 0);
      if (canU) {
        this._btn(lx, vsY + 98, hW, 26, '↑ АПГРЕЙД СКЛАДА', '#66cc88', 0x0a1a10, 0x122818, () => {
          treas.credits    -= nxt.cr;
          clan.clanPoints   = (clan.clanPoints || 0) - nxt.pts;
          clan.vaultTier    = vt + 1;
          this._sr();
        });
      }
    } else if (!nxt) {
      this.add.text(lx + hW / 2, vsY + 74, 'МАКСИМАЛЬНЫЙ ТИР', this.F('11px', '#ffb74d')).setOrigin(0.5);
    }

    // Right column — guild level
    const rx = x + hW + 14;
    this.add.text(rx + hW / 2, y + 6, 'УРОВЕНЬ ГИЛЬДИИ', this.O('13px', '#2a5a70')).setOrigin(0.5, 0);
    const lvl     = clan.level || 1, maxLvl = 10;
    const lvlBg   = this.add.graphics();
    lvlBg.fillStyle(0x080e18, 0.9); lvlBg.fillRoundedRect(rx, y + 28, hW, 64, 6);
    lvlBg.lineStyle(1, 0x1a2a3a, 0.8); lvlBg.strokeRoundedRect(rx, y + 28, hW, 64, 6);
    this.add.text(rx + 14, y + 36, `Уровень ${lvl}`, this.O('16px', '#4dd0e1'));
    const ptsNeed = lvl < maxLvl ? lvl * 50000 : null;
    const lvlTxt  = ptsNeed ? `До ур.${lvl + 1}: ${ptsNeed.toLocaleString()} очков` : 'МАКСИМАЛЬНЫЙ УРОВЕНЬ';
    this.add.text(rx + 14, y + 60, lvlTxt, this.F('10px', '#2a5a70'));
    if (ptsNeed) {
      const barX = rx + 14, barY = y + 76, barW = hW - 28;
      const frac  = Math.min(1, (clan.clanPoints || 0) / ptsNeed);
      const barBg = this.add.graphics();
      barBg.fillStyle(0x0a1420, 1); barBg.fillRoundedRect(barX, barY, barW, 8, 4);
      barBg.fillStyle(0x4dd0e1, 1); barBg.fillRoundedRect(barX, barY, Math.round(barW * frac), 8, 4);
    }
  }

  // ── БАФФЫ ─────────────────────────────────────────────────────────────────
  _tabBuffs(x, y, w, h, clan) {
    const isCapt = clan.myRole === 'Капитан';
    const treas  = clan.treasury || { credits: 0 };
    const buffs  = clan.buffs || [];
    const n      = buffs.length;
    const colW   = Math.floor((w - (n - 1) * 10) / n);

    this.add.text(x + w / 2, y + 6, 'БАФФЫ ГИЛЬДИИ', this.O('13px', '#2a5a70')).setOrigin(0.5, 0);

    buffs.forEach((b, i) => {
      const bx = x + i * (colW + 10), by = y + 30;
      const bh2 = Math.min(230, h - 36);

      const bg2 = this.add.graphics();
      bg2.fillStyle(0x080e18, 0.9); bg2.fillRoundedRect(bx, by, colW, bh2, 8);
      bg2.lineStyle(1, 0x1a2a3a, 0.7); bg2.strokeRoundedRect(bx, by, colW, bh2, 8);

      this.add.text(bx + colW / 2, by + 14, b.icon, { fontSize: '28px', resolution: UI_RES }).setOrigin(0.5, 0);
      this.add.text(bx + colW / 2, by + 52, b.name, this.O('13px', '#4dd0e1')).setOrigin(0.5, 0);
      const pct = BUFF_PCT[b.lvl] || 0;
      this.add.text(bx + colW / 2, by + 74,
        b.lvl > 0 ? `+${pct}%` : 'неактивен',
        this.O('18px', b.lvl > 0 ? '#66bb6a' : '#334455')).setOrigin(0.5, 0);
      this.add.text(bx + colW / 2, by + 100,
        `Уровень ${b.lvl} / ${b.maxLvl}`,
        this.F('11px', '#2a5a70')).setOrigin(0.5, 0);

      const pipW = Math.floor((colW - 20) / b.maxLvl) - 4;
      for (let p = 0; p < b.maxLvl; p++) {
        const pg = this.add.graphics();
        pg.fillStyle(p < b.lvl ? 0x4dd0e1 : 0x1a2a3a, 1);
        pg.fillRoundedRect(bx + 10 + p * (pipW + 4), by + 124, pipW, 10, 3);
        if (p === b.lvl) { pg.lineStyle(1, COLORS.primary, 0.4); pg.strokeRoundedRect(bx + 10 + p * (pipW + 4), by + 124, pipW, 10, 3); }
      }

      if (b.lvl < b.maxLvl) {
        const nPct   = BUFF_PCT[b.lvl + 1];
        const cost   = (b.lvl + 1) * 5000;
        const canAff = treas.credits >= cost;
        this.add.text(bx + colW / 2, by + 146, `→ +${nPct}%`, this.F('10px', '#2a6a50')).setOrigin(0.5, 0);
        this.add.text(bx + colW / 2, by + 162, `${(cost / 1000).toFixed(0)}k кр`, this.F('10px', canAff ? '#ffe0b2' : '#5a3a2a')).setOrigin(0.5, 0);
        if (isCapt) {
          this._btn(bx + 8, by + bh2 - 38, colW - 16, 28,
            '↑ УЛУЧШИТЬ', canAff ? '#66cc88' : '#2a3a2a',
            canAff ? 0x0a1a10 : 0x0a0e0a, 0x122818, () => {
              if (!canAff) return;
              treas.credits -= cost; b.lvl += 1;
              (clan.log = clan.log || []).unshift({ time: this._ts(), text: `${b.name} +${BUFF_PCT[b.lvl]}% — уровень гильдии ${clan.level}`, color: '#ffd54f' });
              clan.log = clan.log.slice(0, 500);
              this._sr();
            });
        } else {
          this.add.text(bx + colW / 2, by + bh2 - 24, '(только капитан)', this.F('10px', '#1a3a4a')).setOrigin(0.5, 1);
        }
      } else {
        this.add.text(bx + colW / 2, by + bh2 - 24, 'МАКСИМУМ', this.F('11px', '#ffb74d')).setOrigin(0.5, 1);
      }
    });
  }

  // ── ИСТОРИЯ ───────────────────────────────────────────────────────────────
  _tabLog(x, y, w, h, clan) {
    this.add.text(x + w / 2, y + 6, 'ИСТОРИЯ ГИЛЬДИИ', this.O('13px', '#2a5a70')).setOrigin(0.5, 0);
    const entries = clan.log || [];
    if (!entries.length) {
      this.add.text(x + w / 2, y + 70, 'История пуста', this.F('13px', '#1a2a3a')).setOrigin(0.5, 0);
      return;
    }
    const rowH = 32, rowGap = 4;
    const listY = y + 28;
    const listH = h - 28;
    const maxVis = Math.floor(listH / (rowH + rowGap));
    const maxOff = Math.max(0, entries.length - maxVis);

    clan._logOffset = Phaser.Math.Clamp(clan._logOffset || 0, 0, maxOff);

    let rowObjs = [];
    const drawRows = (off) => {
      rowObjs.forEach(o => o.destroy());
      rowObjs = [];
      entries.slice(off, off + maxVis).forEach((e, i) => {
        const ry = listY + i * (rowH + rowGap);
        const ebg = this.add.graphics();
        ebg.fillStyle(0x080e18, 0.85); ebg.fillRoundedRect(x, ry, w, rowH, 4);
        ebg.lineStyle(1, 0x0d1a2a, 0.6); ebg.strokeRoundedRect(x, ry, w, rowH, 4);
        const etxt = this.add.text(x + 14,     ry + rowH / 2, e.text,       this.F('12px', e.color || '#9fb3b8')).setOrigin(0, 0.5);
        const ttxt = this.add.text(x + w - 14, ry + rowH / 2, e.time || '', this.F('10px', '#1a3a4a')).setOrigin(1, 0.5);
        rowObjs.push(ebg, etxt, ttxt);
      });
    };

    drawRows(clan._logOffset);

    if (entries.length > maxVis) {
      this.input.on('wheel', (p, _o, _dx, dy) => {
        if (p.x < x || p.x > x + w || p.y < listY || p.y > listY + listH) return;
        const newOff = Phaser.Math.Clamp((clan._logOffset || 0) + (dy > 0 ? 1 : -1), 0, maxOff);
        if (newOff === clan._logOffset) return;
        clan._logOffset = newOff;
        drawRows(newOff);
      });
    }
  }

  // ── НАСТРОЙКИ (капитан) ───────────────────────────────────────────────────
  _tabSettings(x, y, w, h, clan) {
    this.add.text(x + w / 2, y + 6, 'НАСТРОЙКИ ГИЛЬДИИ', this.O('15px', '#5a9aac')).setOrigin(0.5, 0);
    const hW = Math.floor((w - 14) / 2);
    const lx = x, rx = x + hW + 14;

    // Left: edit info — 5 buttons
    this.add.text(lx + hW / 2, y + 36, 'ИНФОРМАЦИЯ', this.O('12px', '#5a8898')).setOrigin(0.5, 0);
    this._btn(lx, y + 58, hW, 32, '✎ Изменить название', '#4dd0e1', 0x081420, 0x102030, () => {
      this._showTextInputModal('ИЗМЕНИТЬ НАЗВАНИЕ', 'Название (3–20 символов)', clan.name, 20, (val) => {
        if (val.length < 3) return;
        clan.name = val; this._sr();
      });
    });
    this._btn(lx, y + 98, hW, 32, '✎ Изменить девиз', '#4dd0e1', 0x081420, 0x102030, () => {
      this._showTextInputModal('ИЗМЕНИТЬ ДЕВИЗ', 'Девиз гильдии (макс. 40 символов)', clan.motto || '', 40, (val) => {
        clan.motto = val.substring(0, 40); this._sr();
      });
    });
    this._btn(lx, y + 138, hW, 32, '✎ Изменить тег', '#4dd0e1', 0x081420, 0x102030, () => {
      this._showTextInputModal('ИЗМЕНИТЬ ТЕГ', 'Аббревиатура (2–4 символа)', clan.tag, 4, (val) => {
        const t = val.toUpperCase();
        if (t.length < 2) return;
        clan.tag = t; this._sr();
      });
    });
    this._btn(lx, y + 178, hW, 32, '✎ Сообщение гильдии', '#ffcc66', 0x0e1408, 0x1a1f08, () => {
      this._showTextInputModal('СООБЩЕНИЕ ГИЛЬДИИ', 'Сообщение для участников (макс. 60 символов)', clan.message || '', 60, (val) => {
        clan.message = val.substring(0, 60); this._sr();
      });
    });
    const recr = clan.recruiting !== false;
    this._btn(lx, y + 218, hW, 32,
      recr ? '🔒 Закрыть набор' : '🔓 Открыть набор',
      recr ? '#ef9a9a' : '#66bb6a', 0x0a0e14, 0x121820, () => {
        clan.recruiting = !recr; this._sr();
      });

    // Right column
    this.add.text(rx + hW / 2, y + 36, 'УПРАВЛЕНИЕ', this.O('12px', '#5a8898')).setOrigin(0.5, 0);
    this.add.text(rx + 14, y + 60,
      'Смена ролей — вкладка ЧЛЕНЫ.\nОфицер ↔ Новобранец (только Капитан).',
      this.F('13px', '#5a9aac'));

    // Current info display
    const infoBg = this.add.graphics();
    infoBg.fillStyle(0x0c1a28, 0.95); infoBg.fillRoundedRect(rx, y + 118, hW, 54, 6);
    infoBg.lineStyle(1, 0x2a4a6a, 0.9); infoBg.strokeRoundedRect(rx, y + 118, hW, 54, 6);
    this.add.text(rx + 14, y + 126, 'Тег:', this.F('12px', '#5a8898'));
    this.add.text(rx + 14, y + 142, '[' + clan.tag + ']', this.O('16px', '#4dd0e1'));
    this.add.text(rx + 14 + 60, y + 126, 'Девиз:', this.F('12px', '#5a8898'));
    this.add.text(rx + 14 + 60, y + 142, clan.motto ? '"' + clan.motto + '"' : '—', this.F('12px', '#5a9aac'));

    // Dissolve — small toggle + button at bottom-right (no guild name in label)
    let dissolveArmed = false;
    const togW = 48, togH = 22, dBtnW = 120, dBtnH = 26, gap = 8;
    const bottomY = y + h - 34;
    const groupW = togW + gap + dBtnW;
    const togX = x + w - 14 - groupW;
    const dBtnX = togX + togW + gap;

    const togBg    = this.add.graphics();
    const togThumb = this.add.graphics();
    const dBtnBg   = this.add.graphics();
    const dBtnTxt  = this.add.text(dBtnX + dBtnW / 2, bottomY + dBtnH / 2, 'РАСПУСТИТЬ',
      this.O('11px', '#2a2020')).setOrigin(0.5).setAlpha(0.35);

    const drawDissolveCtrls = () => {
      togBg.clear();
      togBg.fillStyle(dissolveArmed ? 0x3a0808 : 0x0d1010, dissolveArmed ? 0.9 : 0.35);
      togBg.fillRoundedRect(togX, bottomY + 2, togW, togH, togH / 2);
      togBg.lineStyle(1, dissolveArmed ? 0x8a1a1a : 0x1a2020, dissolveArmed ? 0.9 : 0.25);
      togBg.strokeRoundedRect(togX, bottomY + 2, togW, togH, togH / 2);
      togThumb.clear();
      togThumb.fillStyle(dissolveArmed ? 0xef5350 : 0x2a3a3a, 1);
      const tx2 = dissolveArmed ? togX + togW - togH + 4 : togX + 4;
      togThumb.fillCircle(tx2 + (togH - 8) / 2, bottomY + 2 + togH / 2, (togH - 8) / 2);
      dBtnBg.clear();
      if (dissolveArmed) {
        dBtnBg.fillStyle(0x3a0808, 0.95); dBtnBg.fillRoundedRect(dBtnX, bottomY, dBtnW, dBtnH, 4);
        dBtnBg.lineStyle(1, 0xef5350, 0.9); dBtnBg.strokeRoundedRect(dBtnX, bottomY, dBtnW, dBtnH, 4);
        dBtnTxt.setColor('#ef5350').setAlpha(1);
      } else {
        dBtnBg.fillStyle(0x080808, 0.4); dBtnBg.fillRoundedRect(dBtnX, bottomY, dBtnW, dBtnH, 4);
        dBtnBg.lineStyle(1, 0x1a1a1a, 0.2); dBtnBg.strokeRoundedRect(dBtnX, bottomY, dBtnW, dBtnH, 4);
        dBtnTxt.setColor('#2a2020').setAlpha(0.35);
      }
    };
    drawDissolveCtrls();

    const togHit = this.add.rectangle(togX + togW / 2, bottomY + 2 + togH / 2, togW, togH, 0, 0)
      .setInteractive({ useHandCursor: true });
    togHit.on('pointerdown', () => { dissolveArmed = !dissolveArmed; drawDissolveCtrls(); });

    const dBtnHit = this.add.rectangle(dBtnX + dBtnW / 2, bottomY + dBtnH / 2, dBtnW, dBtnH, 0, 0)
      .setInteractive({ useHandCursor: false });
    dBtnHit.on('pointerdown', () => {
      if (!dissolveArmed) return;
      this._showDissolveModal(clan);
    });
  }

  // ── TEXT INPUT MODAL (replaces window.prompt) ─────────────────────────────
  _showTextInputModal(title, label, initial, maxLen, onOk) {
    document.getElementById('sd-guild-overlay')?.remove();
    const ov = document.createElement('div');
    ov.id = 'sd-guild-overlay';
    ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.78);z-index:1000;font-family:Inter,sans-serif';
    const safeInitial = (initial || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
    ov.innerHTML = `
      <div style="background:#080e1a;border:2px solid #4dd0e1;border-radius:12px;padding:28px 36px;min-width:340px;color:#cce8f0">
        <div style="font-family:Orbitron,sans-serif;font-size:15px;color:#4dd0e1;margin-bottom:16px">${title}</div>
        <label style="display:block;font-size:12px;color:#445566;margin-bottom:6px">${label}</label>
        <input id="sd-ti-inp" maxlength="${maxLen}" value="${safeInitial}"
          style="width:100%;box-sizing:border-box;background:#0d1828;border:1px solid #1a3a5a;border-radius:4px;padding:8px 10px;color:#cce8f0;font-size:14px;outline:none;margin-bottom:16px">
        <div style="display:flex;gap:10px">
          <button id="sd-ti-ok"  style="flex:1;padding:10px;background:#0a1a10;border:1px solid #4acc88;border-radius:6px;color:#66bb6a;font-size:13px;cursor:pointer">✓ СОХРАНИТЬ</button>
          <button id="sd-ti-can" style="flex:1;padding:10px;background:#0a0e14;border:1px solid #1a2a3a;border-radius:6px;color:#445566;font-size:13px;cursor:pointer">ОТМЕНА</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('keydown', e => e.stopPropagation());
    const inp = ov.querySelector('#sd-ti-inp');
    inp.focus(); inp.select();
    ov.querySelector('#sd-ti-can').addEventListener('click', () => ov.remove());
    ov.querySelector('#sd-ti-ok').addEventListener('click', () => {
      const val = inp.value.trim(); ov.remove(); onOk(val);
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); const val = inp.value.trim(); ov.remove(); onOk(val); }
      if (e.key === 'Escape') { e.preventDefault(); ov.remove(); }
    });
  }

  // ── DISSOLVE CONFIRM MODAL ────────────────────────────────────────────────
  _showDissolveModal(clan) {
    const W = this.scale.width, H = this.scale.height;
    const gs = this.gs;
    const mw = 380, mh = 168;
    const mx = (W - mw) / 2, my = (H - mh) / 2;
    const objs = [];
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.72).setOrigin(0).setDepth(60).setInteractive();
    objs.push(dim);
    const panel = this.add.graphics().setDepth(61);
    panel.fillStyle(0x0f0808, 0.99); panel.fillRoundedRect(mx, my, mw, mh, 10);
    panel.lineStyle(2, 0xef5350, 0.9); panel.strokeRoundedRect(mx, my, mw, mh, 10);
    objs.push(panel);
    objs.push(this.add.text(W / 2, my + 26, '⚠  РАСПУСТИТЬ ГИЛЬДИЮ?', this.O('13px', '#ef5350')).setOrigin(0.5).setDepth(62));
    objs.push(this.add.text(W / 2, my + 56, 'Это действие необратимо.', this.F('13px', '#9fb3b8')).setOrigin(0.5).setDepth(62));
    objs.push(this.add.text(W / 2, my + 74, 'Все данные гильдии будут удалены.', this.F('12px', '#6a6a7a')).setOrigin(0.5).setDepth(62));
    const btnY = my + mh - 48;
    const cancelBtn = this.add.rectangle(W / 2 - 90, btnY, 150, 32, 0x0d1e2c, 1)
      .setStrokeStyle(1, 0x2a6888, 0.8).setDepth(61).setInteractive({ useHandCursor: true });
    cancelBtn.on('pointerover', () => cancelBtn.setFillStyle(0x162838));
    cancelBtn.on('pointerout',  () => cancelBtn.setFillStyle(0x0d1e2c));
    cancelBtn.on('pointerdown', () => { objs.forEach(o => o?.destroy()); });
    objs.push(cancelBtn);
    objs.push(this.add.text(W / 2 - 90, btnY, 'ОТМЕНА', this.O('12px', '#4dd0e1')).setOrigin(0.5).setDepth(62));
    const delBtn = this.add.rectangle(W / 2 + 90, btnY, 150, 32, 0x2a0808, 1)
      .setStrokeStyle(1, 0xef5350, 0.8).setDepth(61).setInteractive({ useHandCursor: true });
    delBtn.on('pointerover', () => delBtn.setFillStyle(0x3e1010));
    delBtn.on('pointerout',  () => delBtn.setFillStyle(0x2a0808));
    delBtn.on('pointerdown', () => {
      objs.forEach(o => o?.destroy());
      gs.clan = null; gs.clanTab = null; this._sr();
    });
    objs.push(delBtn);
    objs.push(this.add.text(W / 2 + 90, btnY, 'РАСПУСТИТЬ', this.O('12px', '#ef5350')).setOrigin(0.5).setDepth(62));
  }

  // ── Deposit input ─────────────────────────────────────────────────────────
  _buildDepositInput(x, y, w, h, clan) {
    document.getElementById('sd-dep-inp')?.remove();
    const gs     = this.gs;
    const canvas = document.querySelector('canvas');
    const scaleX = parseFloat(canvas.style.width)  / canvas.width;
    const scaleY = parseFloat(canvas.style.height) / canvas.height;
    const rect   = canvas.getBoundingClientRect();

    const inp = document.createElement('input');
    inp.id          = 'sd-dep-inp';
    inp.type        = 'text';
    inp.inputMode   = 'numeric';
    inp.maxLength   = 7;
    inp.placeholder = 'Сумма';
    inp.value       = clan._depAmt || '';
    inp.style.cssText = `
      position:fixed;
      left:${rect.left + x * scaleX}px;
      top:${rect.top  + y * scaleY}px;
      width:${w * scaleX}px;
      height:${h * scaleY}px;
      background:transparent;
      border:none;
      padding:0 8px;
      color:#cce8f0;
      font-size:${Math.round(13 * scaleY)}px;
      font-family:Inter,sans-serif;
      outline:none;
      box-sizing:border-box;
      z-index:500;
    `;
    document.body.appendChild(inp);

    const gameKbd = gs.input.keyboard;
    inp.addEventListener('focus', () => { gameKbd.enabled = false; });
    inp.addEventListener('blur',  () => { gameKbd.enabled = true; clan._depAmt = inp.value; });

    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); inp.blur(); return; }
      if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); return; }
      const nav = ['Backspace','Delete','ArrowLeft','ArrowRight','Home','End','Tab'];
      if (!nav.includes(e.key) && !/^[0-9]$/.test(e.key)) e.preventDefault();
    });

    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/[^0-9]/g, '').slice(0, 7);
      clan._depAmt = inp.value;
    });
  }

  // ── Search helpers ────────────────────────────────────────────────────────
  _buildSearchInput(x, y, w, h) {
    // Guard: remove any stale input before creating a new one
    document.getElementById('sd-guild-search')?.remove();

    const gs     = this.gs;
    const canvas = document.querySelector('canvas');
    const scaleX = parseFloat(canvas.style.width)  / canvas.width;
    const scaleY = parseFloat(canvas.style.height) / canvas.height;
    const rect   = canvas.getBoundingClientRect();

    const inp = document.createElement('input');
    inp.id          = 'sd-guild-search';
    inp.type        = 'text';
    inp.placeholder = 'Поиск по названию или тэгу…';
    inp.value       = gs._guildSearch || '';
    inp.style.cssText = `
      position:fixed;
      left:${rect.left + x * scaleX}px;
      top:${rect.top  + y * scaleY}px;
      width:${w * scaleX}px;
      height:${h * scaleY}px;
      background:#0d1828;
      border:1px solid #1a3a5a;
      border-radius:4px;
      padding:0 10px;
      color:#cce8f0;
      font-size:${Math.round(13 * scaleY)}px;
      font-family:Inter,sans-serif;
      outline:none;
      box-sizing:border-box;
      z-index:500;
    `;
    document.body.appendChild(inp);
    this._searchInp = inp;

    // Disable GameScene keyboard (G/H/N/K/etc.) while input is focused
    const gameKbd = gs.input.keyboard;
    inp.addEventListener('focus', () => { gameKbd.enabled = false; });
    inp.addEventListener('blur',  () => { gameKbd.enabled = true;  });

    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        // First ESC: clear search, return focus to guild list
        e.preventDefault();
        gs._guildSearch = '';
        inp.value = '';
        clearTimeout(this._searchDebounce);
        inp.blur();            // re-enables GameScene keyboard via blur handler
        this.scene.restart();  // re-render with full unfiltered list
      } else if (e.key === 'Enter') {
        // Enter: blur input and highlight first result
        e.preventDefault();
        gs._guildFirstFocus = true;
        clearTimeout(this._searchDebounce);
        inp.blur();
        this.scene.restart();
      }
    });

    inp.addEventListener('input', () => {
      gs._guildSearch = inp.value;
      clearTimeout(this._searchDebounce);
      // Auto-search only when query is cleared or has 2+ chars
      if (inp.value.length === 0 || inp.value.length >= 2) {
        this._searchDebounce = setTimeout(() => { this.scene.restart(); }, 180);
      }
    });
  }

  _searchScore(g, query) {
    const name = g.name.toLowerCase();
    const tag  = g.tag.toLowerCase();
    if (tag  === query)         return 100;
    if (name === query)         return 90;
    if (tag.startsWith(query))  return 80;
    if (name.startsWith(query)) return 70;
    if (tag.includes(query))    return 60;
    if (name.includes(query))   return 50;
    return 0;
  }

  _showMoveMsg(text) {
    const W = this.scale.width, H = this.scale.height;
    const t = this.add.text(W / 2, H - 110, text, this.O('13px', '#66bb6a'))
      .setOrigin(0.5).setDepth(300).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 150,
      onComplete: () => this.tweens.add({ targets: t, alpha: 0, y: H - 140,
        duration: 600, delay: 900, onComplete: () => t.destroy() }) });
  }

  // save → restart (для всех мутирующих действий)
  _sr() { this.gs._saveState?.(); this.scene.restart(); }

  // ── Helpers ───────────────────────────────────────────────────────────────
  _btn(x, y, w, h, label, tc, fillN, fillH, cb) {
    const bg  = this.add.graphics();
    const _draw = (fill) => {
      bg.clear();
      bg.fillStyle(fill, 0.92); bg.fillRoundedRect(x, y, w, h, 5);
      bg.lineStyle(1, COLORS.primary, 0.3); bg.strokeRoundedRect(x, y, w, h, 5);
    };
    _draw(fillN);
    const btn = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0, 0).setInteractive({ useHandCursor: true });
    this.add.text(x + w / 2, y + h / 2, label, this.F('13px', tc)).setOrigin(0.5);
    btn.on('pointerover',  () => _draw(fillH));
    btn.on('pointerout',   () => _draw(fillN));
    btn.on('pointerdown', cb);
    return btn;
  }

  _sBtn(x, y, w, h, label, tc, fill, cb) {
    const bg = this.add.graphics();
    bg.fillStyle(fill, 0.9); bg.fillRoundedRect(x, y, w, h, 3);
    bg.lineStyle(1, 0x1a3a3a, 0.4); bg.strokeRoundedRect(x, y, w, h, 3);
    const btn = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0, 0).setInteractive({ useHandCursor: true });
    this.add.text(x + w / 2, y + h / 2, label, this.F('12px', tc)).setOrigin(0.5);
    btn.on('pointerdown', cb);
    return btn;
  }
}
