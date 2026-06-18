import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';

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
  members: [
    { name: 'VoidRunner',  role: 'Капитан',  online: true,  contribution: 45000, level: 14 },
    { name: 'NovaStar',    role: 'Офицер',   online: true,  contribution: 32000, level: 12 },
    { name: 'StormEagle',  role: 'Офицер',   online: false, contribution: 28000, level: 11 },
    { name: 'IronPilot',   role: 'Участник', online: true,  contribution: 15000, level: 9  },
    { name: 'DarkMatter',  role: 'Участник', online: false, contribution: 12000, level: 8  },
    { name: 'StarForge',   role: 'Участник', online: false, contribution: 8000,  level: 8  },
    { name: 'EchoWarden',  role: 'Участник', online: true,  contribution: 6000,  level: 8  },
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
    { time: '17.06  22:10', text: 'NovaStar положил предмет на склад',             color: '#4dd0e1' },
    { time: '17.06  19:32', text: 'IronPilot внёс 5 000 кр в казну',              color: '#ffe0b2' },
    { time: '16.06  14:05', text: 'StormEagle взял предмет со склада',             color: '#ef9a9a' },
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
    this.gs = this.scene.get('GameScene');
    const gs = this.gs;
    const W  = this.scale.width, H = this.scale.height;

    if (gs.clan === undefined) gs.clan = null;
    // DEV: to test guild panel: gs.clan = MOCK_MY_GUILD;

    const bgMap = { helios: 'bg_corp_helios', karax: 'bg_corp_karaks', tides: 'bg_corp_tides' };
    const bg    = this.add.image(W / 2, H / 2, bgMap[gs.playerCorp] || 'bg_corp_helios');
    bg.setScale(Math.max(W / bg.width, H / bg.height)).setAlpha(0.8);

    if (!gs.clan) {
      this._renderNoClan(W, H);
    } else {
      this._renderGuildPanel(W, H, gs.clan);
    }

    this.input.keyboard.on('keydown-ESC', () => { this._destroyOverlay(); this.scene.stop(); });
    this.input.keyboard.on('keydown-N',   () => { this._destroyOverlay(); this.scene.stop(); });
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

    // Text search input (HTML overlay)
    const searchY = filterY + 48;
    this._buildSearchInput(px + 14, searchY, pw - 28, 30);

    // Relevance filter + sort
    const query  = (gs._guildSearch || '').trim().toLowerCase();
    const corpF  = gs._guildFilter;
    let guilds   = MOCK_GUILDS.filter(g => corpF === 'все' || g.corp === corpF);
    if (query) {
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

    if (guilds.length === 0 && query) {
      this.add.text(px + pw / 2, listY + 20, 'Ничего не найдено', this.F('13px', '#1a2a3a')).setOrigin(0.5, 0);
    }

    guilds.slice(0, maxRows).forEach((g, i) => {
      const ry = listY + i * (rowH + rowGap);
      const rw = pw - 28, rx = px + 14;

      const rbg = this.add.graphics();
      rbg.fillStyle(0x0a1520, 0.9); rbg.fillRoundedRect(rx, ry, rw, rowH, 6);
      rbg.lineStyle(1, 0x1a2a3a, 0.6); rbg.strokeRoundedRect(rx, ry, rw, rowH, 6);

      const cc = corpCl[g.corp] || '#9fb3b8';
      this.add.text(rx + 12, ry + 8,  `[${g.tag}]`,  this.O('12px', cc));
      this.add.text(rx + 12 + g.tag.length * 9 + 8, ry + 8, g.name, this.O('12px', '#cce8f0'));
      this.add.text(rx + 12, ry + 28, `Ур.${g.level}  ·  ${g.members}/50`, this.F('11px', '#2a5a70'));
      if (g.motto) this.add.text(rx + 12, ry + 46, `"${g.motto}"`, this.F('10px', '#1a3a4a'));

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
    const gs = this.gs;
    const ov = document.createElement('div');
    ov.id = 'sd-guild-overlay';
    ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.75);z-index:1000;font-family:Inter,sans-serif';
    ov.innerHTML = `
      <div style="background:#080e1a;border:2px solid #4dd0e1;border-radius:12px;padding:28px 36px;min-width:340px;color:#cce8f0">
        <div style="font-family:Orbitron,sans-serif;font-size:18px;color:#4dd0e1;margin-bottom:20px">ОСНОВАТЬ ГИЛЬДИЮ</div>
        <label style="display:block;font-size:11px;color:#445566;margin-bottom:4px">НАЗВАНИЕ (3–20 символов)</label>
        <input id="gn" maxlength="20" placeholder="Название гильдии" style="width:100%;box-sizing:border-box;background:#0d1828;border:1px solid #1a3a5a;border-radius:4px;padding:8px 10px;color:#cce8f0;font-size:14px;outline:none;margin-bottom:12px">
        <label style="display:block;font-size:11px;color:#445566;margin-bottom:4px">АББРЕВИАТУРА (2–4 символа)</label>
        <input id="gt" maxlength="4" placeholder="ТЭГГ" style="width:120px;background:#0d1828;border:1px solid #1a3a5a;border-radius:4px;padding:8px 10px;color:#cce8f0;font-size:14px;outline:none;text-transform:uppercase;margin-bottom:16px">
        <div style="font-size:11px;color:#ffe0b2;margin-bottom:16px">Стоимость: 50 000 кр + 100 ⭐</div>
        <div style="display:flex;gap:10px">
          <button id="gc-ok" style="flex:1;padding:10px;background:#0a1a10;border:1px solid #4acc88;border-radius:6px;color:#66bb6a;font-size:13px;cursor:pointer">✓ ОСНОВАТЬ</button>
          <button id="gc-no" style="flex:1;padding:10px;background:#0a0e14;border:1px solid #1a2a3a;border-radius:6px;color:#445566;font-size:13px;cursor:pointer">ОТМЕНА</button>
        </div>
        <div id="gc-err" style="color:#ef9a9a;font-size:11px;margin-top:10px;min-height:16px"></div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('keydown', e => e.stopPropagation());

    const nameI = ov.querySelector('#gn');
    const tagI  = ov.querySelector('#gt');
    const errD  = ov.querySelector('#gc-err');
    tagI.addEventListener('input', () => { tagI.value = tagI.value.toUpperCase(); });
    nameI.focus();

    ov.querySelector('#gc-no').addEventListener('click', () => ov.remove());
    ov.querySelector('#gc-ok').addEventListener('click', () => {
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
    const tagW = this.add.text(px + 20, py + 14, `[${clan.tag}]`, this.O('17px', cc)).width + 10;
    this.add.text(px + 20 + tagW, py + 14, clan.name, this.O('17px', '#cce8f0'));
    const online = (clan.members || []).filter(m => m.online).length;
    this.add.text(px + 20, py + 44,
      `${online} онлайн · ${(clan.members || []).length} участников · Гильдия ур.${clan.level}`,
      this.F('11px', '#2a5a70'));
    const rCol = clan.myRole === 'Капитан' ? '#ffb74d' : clan.myRole === 'Офицер' ? '#4dd0e1' : '#9fb3b8';
    this.add.text(px + pw - 16, py + 18, clan.myRole || 'Участник', this.F('11px', rCol)).setOrigin(1, 0);
    this.add.text(px + pw - 16, py + 36, 'N / ESC', this.F('10px', '#223344')).setOrigin(1, 0);

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

    const tabY = py + 60, tabH = 26, tabW = Math.floor(pw / tabs.length);
    tabs.forEach(({ key, label }, i) => {
      const tx  = px + i * tabW;
      const sel = gs.clanTab === key;
      const tbg = this.add.graphics();
      tbg.fillStyle(sel ? 0x0d2030 : 0x040c15, sel ? 1 : 0.8);
      tbg.fillRoundedRect(tx + 2, tabY, tabW - 4, tabH, 4);
      if (sel) { tbg.lineStyle(1, COLORS.primary, 0.7); tbg.strokeRoundedRect(tx + 2, tabY, tabW - 4, tabH, 4); }
      const btn = this.add.rectangle(tx + tabW / 2, tabY + tabH / 2, tabW - 4, tabH, 0, 0)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => { gs.clanTab = key; this.scene.restart(); });
      btn.on('pointerover', () => { if (!sel) { tbg.clear(); tbg.fillStyle(0x0a1822, 0.9); tbg.fillRoundedRect(tx + 2, tabY, tabW - 4, tabH, 4); } });
      btn.on('pointerout',  () => { if (!sel) { tbg.clear(); tbg.fillStyle(0x040c15, 0.8); tbg.fillRoundedRect(tx + 2, tabY, tabW - 4, tabH, 4); } });
      this.add.text(tx + tabW / 2, tabY + tabH / 2, label, this.O('10px', sel ? '#4dd0e1' : '#2a4a5a')).setOrigin(0.5);
    });

    const cx = px + 12, cy = py + 92, cw = pw - 24, ch = ph - 100;
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
    let   curY   = y;

    // Applications block (officer+)
    if (isOff && apps.length > 0) {
      const appBlockH = 26 + apps.length * 44 + 6;
      const abBg = this.add.graphics();
      abBg.fillStyle(0x0a1810, 0.9); abBg.fillRoundedRect(x, curY, w, appBlockH, 6);
      abBg.lineStyle(1, 0x2a5a2a, 0.5); abBg.strokeRoundedRect(x, curY, w, appBlockH, 6);
      this.add.text(x + 14, curY + 7, `ЗАЯВКИ (${apps.length})`, this.O('11px', '#66bb6a'));

      apps.forEach((app, i) => {
        const ry = curY + 26 + i * 44;
        const rbg2 = this.add.graphics();
        rbg2.fillStyle(0x0c1f10, 0.88); rbg2.fillRoundedRect(x + 8, ry, w - 16, 36, 4);
        this.add.text(x + 22, ry + 6,  app.name,            this.O('12px', '#b8e4c4'));
        this.add.text(x + 22, ry + 22, `Уровень ${app.level}`, this.F('10px', '#2a6a3a'));
        if (app.msg) this.add.text(x + 130, ry + 14, `"${app.msg}"`, this.F('10px', '#1a4a2a')).setOrigin(0, 0.5);

        const bw = 76, bh = 20, btnY = ry + 8;
        this._sBtn(x + w - 16 - bw * 2 - 6, btnY, bw, bh, '✓ ПРИНЯТЬ', '#66bb6a', 0x0a1a0e, () => {
          clan.members.push({ name: app.name, role: 'Участник', online: false, contribution: 0, level: app.level });
          apps.splice(apps.indexOf(app), 1);
          (clan.log = clan.log || []).unshift({ time: this._ts(), text: `${app.name} вступил в гильдию`, color: '#66bb6a' });
          this._sr();
        });
        this._sBtn(x + w - 16 - bw, btnY, bw, bh, '✕ ОТКЛОНИТЬ', '#ef9a9a', 0x1a0a0a, () => {
          apps.splice(apps.indexOf(app), 1);
          this._sr();
        });
      });
      curY += appBlockH + 6;
    }

    // Member rows
    const rowH = 44, rowGap = 4;
    const maxR = Math.floor((h - (curY - y)) / (rowH + rowGap));
    (clan.members || []).slice(0, maxR).forEach((m, i) => {
      const ry = curY + i * (rowH + rowGap);
      const mbg = this.add.graphics();
      mbg.fillStyle(0x0a1520, 0.9); mbg.fillRoundedRect(x, ry, w, rowH, 5);
      mbg.lineStyle(1, m.online ? 0x1a3a20 : 0x0d1a26, 0.6); mbg.strokeRoundedRect(x, ry, w, rowH, 5);

      const dot = this.add.graphics();
      dot.fillStyle(m.online ? COLORS.emerald : 0x334455, 1);
      dot.fillCircle(x + 16, ry + rowH / 2, 5);

      const rc = m.role === 'Капитан' ? '#ffb74d' : m.role === 'Офицер' ? '#4dd0e1' : '#4a6678';
      this.add.text(x + 30, ry + 7,  m.name,  this.O('12px', '#cce8f0'));
      this.add.text(x + 30, ry + 24, m.role,  this.F('10px', rc));
      this.add.text(x + w / 2, ry + rowH / 2, `Ур. ${m.level || '?'}`, this.F('10px', '#2a5a70')).setOrigin(0.5);
      this.add.text(x + w - 14, ry + 8,  `вклад: ${(m.contribution || 0).toLocaleString()}`, this.F('10px', '#1a4060')).setOrigin(1, 0);
      this.add.text(x + w - 14, ry + 26, m.online ? 'онлайн' : 'офлайн', this.F('10px', m.online ? '#2a6a3a' : '#2a3a4a')).setOrigin(1, 0);

      // Role toggle (captain only, not self)
      if (isCapt && m.role !== 'Капитан') {
        const newRole = m.role === 'Офицер' ? 'Участник' : 'Офицер';
        const lbl     = m.role === 'Офицер' ? '▼ Участник' : '▲ Офицер';
        const clr     = m.role === 'Офицер' ? '#ef9a9a' : '#4dd0e1';
        this._sBtn(x + w - 130, ry + rowH - 22, 80, 16, lbl, clr, 0x060e18, () => {
          m.role = newRole; this._sr();
        });
      }
    });
  }

  // ── СКЛАД ─────────────────────────────────────────────────────────────────
  _tabVault(x, y, w, h, clan) {
    const isOff    = ['Капитан', 'Офицер'].includes(clan.myRole);
    const tier     = VAULT_TIERS[clan.vaultTier ?? 0];
    const maxSlots = tier?.slots ?? 10;
    const count    = (clan.vault || []).length;

    this.add.text(x + w / 2, y + 6, `${count} / ${maxSlots} слотов`, this.F('12px', '#2a5a70')).setOrigin(0.5, 0);

    if (isOff) {
      const cargo  = this.gs.inventory || [];
      const canPut = cargo.some(i => i.type !== 'plasmate') && count < maxSlots;
      this._btn(x + w / 2 - 100, y + 24, 200, 26, 'Положить из трюма',
        canPut ? '#66bb6a' : '#2a4a2a', 0x0a1a0e, 0x162818, () => {
          if (!canPut) return;
          const idx = cargo.findIndex(i => i.type !== 'plasmate'); if (idx < 0) return;
          const item = cargo.splice(idx, 1)[0];
          (clan.vault = clan.vault || []).push(item);
          (clan.log = clan.log || []).unshift({ time: this._ts(), text: `${this.gs.playerName || 'Пилот'} положил предмет на склад`, color: '#4dd0e1' });
          this._sr();
        });
    }

    if (!count) {
      this.add.text(x + w / 2, y + 76, isOff ? 'Склад гильдии пуст' : 'Нет доступа к складу', this.F('13px', '#1a2a3a')).setOrigin(0.5, 0);
      return;
    }

    const startY = y + 58, rowH = 48, rowGap = 4;
    const maxR   = Math.floor((h - 62) / (rowH + rowGap));
    clan.vault.slice(0, maxR).forEach((it, i) => {
      const ry  = startY + i * (rowH + rowGap);
      const vbg = this.add.graphics();
      vbg.fillStyle(0x0c1a10, 0.9); vbg.fillRoundedRect(x, ry, w, rowH, 5);
      vbg.lineStyle(1, COLORS.emerald, 0.13); vbg.strokeRoundedRect(x, ry, w, rowH, 5);
      this.add.image(x + 22, ry + rowH / 2, 'lootbox').setDisplaySize(22, 22);
      this.add.text(x + 42, ry + 8,  it.name || it.key || '?', this.O('11px', '#b8e4c4'));
      this.add.text(x + 42, ry + 26, it.stats || '',            this.F('10px', '#5a8860'));
      if (isOff) {
        this._sBtn(x + w - 118, ry + (rowH - 20) / 2, 108, 20, '← забрать в трюм', '#4acc88', 0x0a1a0e, () => {
          if ((this.gs.inventory || []).length >= 30) return;
          const idx = clan.vault.indexOf(it); if (idx < 0) return;
          clan.vault.splice(idx, 1);
          (this.gs.inventory = this.gs.inventory || []).push(it);
          (clan.log = clan.log || []).unshift({ time: this._ts(), text: `${this.gs.playerName || 'Пилот'} взял предмет со склада`, color: '#ef9a9a' });
          this._sr();
        });
      }
    });
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

    const depAmt  = 5000;
    const canDep  = (this.gs.credits || 0) >= depAmt;
    this._btn(lx, y + 90, hW, 28, `Внести ${depAmt.toLocaleString()} кр`, '#4dd0e1', 0x081420, 0x102030, () => {
      if (!canDep) return;
      this.gs.credits -= depAmt;
      treas.credits   += depAmt;
      (clan.log = clan.log || []).unshift({ time: this._ts(), text: `${this.gs.playerName || 'Пилот'} внёс ${depAmt.toLocaleString()} кр в казну`, color: '#ffe0b2' });
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
    const rowH = 32, rowGap = 4, startY = y + 30;
    const maxR = Math.floor((h - 36) / (rowH + rowGap));
    entries.slice(0, maxR).forEach((e, i) => {
      const ry = startY + i * (rowH + rowGap);
      const ebg = this.add.graphics();
      ebg.fillStyle(0x080e18, 0.85); ebg.fillRoundedRect(x, ry, w, rowH, 4);
      ebg.lineStyle(1, 0x0d1a2a, 0.6); ebg.strokeRoundedRect(x, ry, w, rowH, 4);
      this.add.text(x + 14, ry + rowH / 2, e.text, this.F('12px', e.color || '#9fb3b8')).setOrigin(0, 0.5);
      this.add.text(x + w - 14, ry + rowH / 2, e.time || '', this.F('10px', '#1a3a4a')).setOrigin(1, 0.5);
    });
  }

  // ── НАСТРОЙКИ (капитан) ───────────────────────────────────────────────────
  _tabSettings(x, y, w, h, clan) {
    this.add.text(x + w / 2, y + 6, 'НАСТРОЙКИ ГИЛЬДИИ', this.O('13px', '#2a5a70')).setOrigin(0.5, 0);
    const hW = Math.floor((w - 14) / 2);
    const lx = x, rx = x + hW + 14;

    // Left: edit info
    this.add.text(lx + hW / 2, y + 34, 'ИНФОРМАЦИЯ', this.O('11px', '#2a4a5a')).setOrigin(0.5, 0);
    this._btn(lx, y + 56, hW, 30, '✎ Изменить название', '#4dd0e1', 0x081420, 0x102030, () => {
      const v = window.prompt('Новое название гильдии (3–20 символов):', clan.name);
      if (v === null) return;
      const t = v.trim();
      if (t.length < 3 || t.length > 20) { window.alert('Название: 3–20 символов'); return; }
      clan.name = t; this._sr();
    });
    this._btn(lx, y + 94, hW, 30, '✎ Изменить девиз', '#4dd0e1', 0x081420, 0x102030, () => {
      const v = window.prompt('Девиз гильдии (макс. 40 символов):', clan.motto || '');
      if (v === null) return;
      clan.motto = v.trim().substring(0, 40); this._sr();
    });
    const recr = clan.recruiting !== false;
    this._btn(lx, y + 132, hW, 30,
      recr ? '🔒 Закрыть набор' : '🔓 Открыть набор',
      recr ? '#ef9a9a' : '#66bb6a', 0x0a0e14, 0x121820, () => {
        clan.recruiting = !recr; this._sr();
      });

    // Right: management info
    this.add.text(rx + hW / 2, y + 34, 'УПРАВЛЕНИЕ', this.O('11px', '#2a4a5a')).setOrigin(0.5, 0);
    this.add.text(rx + 14, y + 58,
      'Смена ролей участников\nдоступна во вкладке ЧЛЕНЫ.\nОфицер ↔ Участник.',
      this.F('12px', '#2a5060'));

    // Current guild tag
    const tBg = this.add.graphics();
    tBg.fillStyle(0x080e18, 0.9); tBg.fillRoundedRect(rx, y + 116, hW, 38, 6);
    tBg.lineStyle(1, 0x1a2a3a, 0.8); tBg.strokeRoundedRect(rx, y + 116, hW, 38, 6);
    this.add.text(rx + 14, y + 124, 'Тэг гильдии', this.F('11px', '#2a5060'));
    this.add.text(rx + 14, y + 138, `[${clan.tag}]`, this.O('14px', '#4dd0e1'));

    // Dissolve — danger zone at bottom
    const dY  = y + h - 44;
    const dbg = this.add.graphics();
    dbg.fillStyle(0x1a0808, 0.9); dbg.fillRoundedRect(x, dY, w, 34, 5);
    dbg.lineStyle(1, 0x5a1a1a, 0.7); dbg.strokeRoundedRect(x, dY, w, 34, 5);
    const dBtn = this.add.rectangle(x + w / 2, dY + 17, w, 34, 0, 0).setInteractive({ useHandCursor: true });
    this.add.text(x + w / 2, dY + 17, `⚠  РАСПУСТИТЬ ГИЛЬДИЮ «${clan.name}»`, this.F('12px', '#ef5350')).setOrigin(0.5);
    dBtn.on('pointerdown', () => {
      if (!window.confirm(`Распустить гильдию ${clan.name}? Это действие необратимо.`)) return;
      this.gs.clan    = null;
      this.gs.clanTab = null;
      this._sr();
    });
  }

  // ── Search helpers ────────────────────────────────────────────────────────
  _buildSearchInput(x, y, w, h) {
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

    inp.addEventListener('keydown', e => e.stopPropagation());

    inp.addEventListener('input', () => {
      gs._guildSearch = inp.value;
      clearTimeout(this._searchDebounce);
      this._searchDebounce = setTimeout(() => { this.scene.restart(); }, 180);
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
    this.add.text(x + w / 2, y + h / 2, label, this.F('12px', tc)).setOrigin(0.5);
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
    this.add.text(x + w / 2, y + h / 2, label, this.F('10px', tc)).setOrigin(0.5);
    btn.on('pointerdown', cb);
    return btn;
  }
}
