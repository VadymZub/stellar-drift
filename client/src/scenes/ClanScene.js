import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';

const CLAN_VAULT_TIERS = [
  { slots: 10,  costCredits: 0,        costClanPts: 0       },
  { slots: 15,  costCredits: 50000,    costClanPts: 500     },
  { slots: 20,  costCredits: 120000,   costClanPts: 1500    },
  { slots: 25,  costCredits: 250000,   costClanPts: 4000    },
  { slots: 30,  costCredits: 500000,   costClanPts: 10000   },
  { slots: 40,  costCredits: 1200000,  costClanPts: 30000   },
  { slots: 50,  costCredits: 3000000,  costClanPts: 80000   },
];
const BUFF_PCT_PER_LVL = [0, 3, 6, 10, 15, 22]; // % бонуса по уровням 0-5

const MOCK_CLAN = {
  name: 'Nova Fleet',
  tag: 'NF',
  members: [
    { name: 'VoidRunner',  role: 'Командор',  online: true  },
    { name: 'NovaStar',    role: 'Офицер',    online: true  },
    { name: 'StormEagle',  role: 'Офицер',    online: false },
    { name: 'IronPilot',   role: 'Участник',  online: true  },
    { name: 'DarkMatter',  role: 'Участник',  online: false },
    { name: 'StarForge',   role: 'Участник',  online: false },
    { name: 'EchoWarden',  role: 'Участник',  online: true  },
  ],
  vault: [],
  vaultTier: 0,
  clanPoints: 1200,
  treasury: { credits: 18500, materials: 340 },
  buffs: [
    { key: 'hull',   name: 'Броня',   icon: '🛡', lvl: 2, maxLvl: 5 },
    { key: 'shield', name: 'Щит',     icon: '💠', lvl: 1, maxLvl: 5 },
    { key: 'damage', name: 'Урон',    icon: '⚡', lvl: 0, maxLvl: 5 },
  ],
};

export default class ClanScene extends Phaser.Scene {
  constructor() { super('ClanScene'); }

  O(s, c) { return { fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }
  F(s, c) { return { fontFamily: 'Inter, sans-serif',    fontSize: s, color: c, resolution: UI_RES }; }

  create() {
    this.gs  = this.scene.get('GameScene');
    const gs = this.gs;
    const W  = this.scale.width, H = this.scale.height;


    // Ensure mock clan data exists on gs for prototype
    if (gs.clan === undefined) gs.clan = MOCK_CLAN;

    const _corpBgMap = { helios: 'bg_corp_helios', karax: 'bg_corp_karaks', tides: 'bg_corp_tides' };
    const _bgClan = this.add.image(W / 2, H / 2, _corpBgMap[gs.playerCorp] || 'bg_corp_helios');
    _bgClan.setScale(Math.max(W / _bgClan.width, H / _bgClan.height)).setAlpha(0.8);

    if (!gs.clan) {
      this._renderNoClan(W, H);
    } else {
      this._renderClanPanel(W, H, gs.clan);
    }

    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());
    this.input.keyboard.on('keydown-N',   () => this.scene.stop());
  }

  // ── No Clan screen ───────────────────────────────────────────────────────
  _renderNoClan(W, H) {
    const pw = Math.min(500, W - 60), ph = 300;
    const px = (W - pw) / 2, py = (H - ph) / 2;

    const bg = this.add.graphics();
    bg.fillStyle(0x080e1a, 0.94); bg.fillRoundedRect(px, py, pw, ph, 12);
    bg.lineStyle(2, COLORS.primary, 0.6); bg.strokeRoundedRect(px, py, pw, ph, 12);

    this.add.text(px + pw / 2, py + 28, 'КЛАН', this.O('22px', '#4dd0e1')).setOrigin(0.5, 0);
    this.add.text(px + pw / 2, py + 70, 'Вы не состоите в клане',
      this.F('14px', '#445566')).setOrigin(0.5, 0);

    // Search button
    const bw = 180, bh = 36;
    this._makeBtn(px + pw / 2 - bw - 10, py + 120, bw, bh, 'НАЙТИ КЛАН', '#4dd0e1', 0x0a1a22, 0x1a3040,
      () => { /* TODO: open clan search */ });

    // Create button
    this._makeBtn(px + pw / 2 + 10, py + 120, bw, bh, 'СОЗДАТЬ КЛАН', '#66bb6a', 0x0a1a0e, 0x162818,
      () => { /* TODO: open clan creation */ });

    this.add.text(px + pw / 2, py + ph - 24, 'N / ESC', this.F('10px', '#223344')).setOrigin(0.5, 1);
  }

  // ── Main clan panel ──────────────────────────────────────────────────────
  _renderClanPanel(W, H, clan) {
    const pw = Math.min(860, W - 40);
    const ph = Math.min(600, H - 80);
    const px = (W - pw) / 2, py = (H - ph) / 2;

    const panel = this.add.graphics();
    panel.fillStyle(0x080e1a, 0.94); panel.fillRoundedRect(px, py, pw, ph, 12);
    panel.lineStyle(2, COLORS.primary, 0.6); panel.strokeRoundedRect(px, py, pw, ph, 12);

    // Header
    const gs = this.gs;
    this.add.text(px + 22, py + 16, `[${clan.tag}] ${clan.name}`,
      this.O('20px', '#4dd0e1'));
    const online = clan.members.filter(m => m.online).length;
    this.add.text(px + 22, py + 44, `${online} онлайн · ${clan.members.length} участников`,
      this.F('12px', '#2a5a70'));
    this.add.text(px + pw - 18, py + 20, 'N / ESC', this.F('10px', '#223344')).setOrigin(1, 0);

    // Tabs
    const tabs = [
      { key: 'members', label: 'УЧАСТНИКИ' },
      { key: 'vault',   label: 'СКЛАД КЛАНА' },
      { key: 'treasury', label: 'КАЗНА & БАФФЫ' },
    ];
    if (!gs.clanTab) gs.clanTab = 'members';
    const tabY = py + 64, tabH = 30, tabW = Math.floor(pw / tabs.length);

    tabs.forEach(({ key, label }, i) => {
      const tx  = px + i * tabW;
      const sel = gs.clanTab === key;
      const tbg = this.add.graphics();
      tbg.fillStyle(sel ? 0x0d2030 : 0x040c15, sel ? 1 : 0.8);
      tbg.fillRoundedRect(tx + 2, tabY, tabW - 4, tabH, 4);
      if (sel) {
        tbg.lineStyle(1, COLORS.primary, 0.7);
        tbg.strokeRoundedRect(tx + 2, tabY, tabW - 4, tabH, 4);
      }
      const btn = this.add.rectangle(tx + tabW / 2, tabY + tabH / 2, tabW - 4, tabH, 0, 0)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => { gs.clanTab = key; this.scene.restart(); });
      btn.on('pointerover', () => { if (!sel) tbg.fillStyle(0x0a1822, 0.9); });
      btn.on('pointerout',  () => { if (!sel) tbg.fillStyle(0x040c15, 0.8); });
      this.add.text(tx + tabW / 2, tabY + tabH / 2, label,
        this.O('11px', sel ? '#4dd0e1' : '#2a4a5a')).setOrigin(0.5);
    });

    const contentX = px + 12, contentY = py + 100;
    const contentW = pw - 24, contentH = ph - 108;

    if (gs.clanTab === 'members')  this._renderMembers(contentX, contentY, contentW, contentH, clan);
    if (gs.clanTab === 'vault')    this._renderVault(contentX, contentY, contentW, contentH, clan);
    if (gs.clanTab === 'treasury') this._renderTreasury(contentX, contentY, contentW, contentH, clan);
  }

  // ── УЧАСТНИКИ tab ────────────────────────────────────────────────────────
  _renderMembers(x, y, w, h, clan) {
    const rowH = 44, gap = 5;
    const maxRows = Math.floor(h / (rowH + gap));

    clan.members.slice(0, maxRows).forEach((m, i) => {
      const ry  = y + i * (rowH + gap);
      const bg  = this.add.graphics();
      bg.fillStyle(0x0a1520, 0.9); bg.fillRoundedRect(x, ry, w, rowH, 5);
      bg.lineStyle(1, m.online ? 0x1a3a20 : 0x0d1a26, 0.8);
      bg.strokeRoundedRect(x, ry, w, rowH, 5);

      // Online dot
      const dotG = this.add.graphics();
      dotG.fillStyle(m.online ? COLORS.emerald : 0x334455, 1);
      dotG.fillCircle(x + 16, ry + rowH / 2, 5);

      // Role badge color
      const roleColor = m.role === 'Командор' ? '#ffb74d'
                      : m.role === 'Офицер'   ? '#4dd0e1' : '#4a6678';

      this.add.text(x + 30, ry + 8,  m.name, this.O('13px', '#cce8f0')).setOrigin(0, 0);
      this.add.text(x + 30, ry + 26, m.role, this.F('10px', roleColor)).setOrigin(0, 0);
      this.add.text(x + w - 12, ry + rowH / 2,
        m.online ? 'онлайн' : 'офлайн',
        this.F('10px', m.online ? '#2a6a3a' : '#2a3a4a')).setOrigin(1, 0.5);
    });
  }

  // ── СКЛАД КЛАНА tab ──────────────────────────────────────────────────────
  _renderVault(x, y, w, h, clan) {
    const vaultMax   = CLAN_VAULT_TIERS[clan.vaultTier ?? 0]?.slots ?? 10;
    const vaultCount = (clan.vault || []).length;
    this.add.text(x + w / 2, y + 8, `${vaultCount} / ${vaultMax} слотов`,
      this.F('12px', '#2a5a70')).setOrigin(0.5, 0);

    // "Положить из трюма" button
    const bw = 200, bh = 32;
    const cargo = this.gs.inventory || [];
    const btnColor = cargo.length ? '#66bb6a' : '#2a4a2a';
    this._makeBtn(x + w / 2 - bw / 2, y + 30, bw, bh, 'Положить из трюма',
      btnColor, 0x0a1a0e, 0x162818, () => {
        if (!cargo.length) return;
        if (vaultCount >= vaultMax) return;
        const item = cargo.shift();
        clan.vault = clan.vault || [];
        clan.vault.push(item);
        this.scene.restart();
      });

    if (!vaultCount) {
      this.add.text(x + w / 2, y + 90, 'Склад клана пуст', this.F('14px', '#1a2a3a')).setOrigin(0.5, 0);
      return;
    }

    const rowH = 52, gap = 5, startY = y + 72;
    const maxRows = Math.floor((h - 78) / (rowH + gap));
    clan.vault.slice(0, maxRows).forEach((it, i) => {
      const ry  = startY + i * (rowH + gap);
      const rbg = this.add.graphics();
      rbg.fillStyle(0x0c1a10, 0.9); rbg.fillRoundedRect(x, ry, w, rowH, 5);
      rbg.lineStyle(1, COLORS.emerald, 0.13); rbg.strokeRoundedRect(x, ry, w, rowH, 5);
      this.add.image(x + 24, ry + rowH / 2, 'lootbox').setDisplaySize(26, 26);
      this.add.text(x + 44, ry + 8,  it.name || it.key || '?', this.O('12px', '#b8e4c4')).setOrigin(0, 0);
      this.add.text(x + 44, ry + 30, it.stats || '',           this.F('10px', '#5a8860')).setOrigin(0, 0);

      // "Взять в трюм" button
      const tbw = 120, tbh = 22;
      const tbx = x + w - tbw - 8, tby = ry + (rowH - tbh) / 2;
      const btn = this.add.rectangle(tbx + tbw / 2, tby + tbh / 2, tbw, tbh, 0x0a1a0e, 0.95)
        .setStrokeStyle(1, 0x2a5a38, 0.7).setInteractive({ useHandCursor: true });
      this.add.text(tbx + tbw / 2, tby + tbh / 2, '← в трюм', this.F('10px', '#4acc88')).setOrigin(0.5);
      btn.on('pointerdown', () => {
        const cargoCount = (this.gs.inventory || []).length;
        if (cargoCount >= 30) return;
        const idx = clan.vault.indexOf(it);
        if (idx >= 0) { clan.vault.splice(idx, 1); this.gs.inventory.push(it); this.scene.restart(); }
      });
    });
  }

  // ── КАЗНА & БАФФЫ tab ────────────────────────────────────────────────────
  _renderTreasury(x, y, w, h, clan) {
    const halfW = Math.floor((w - 16) / 2);

    // Left: treasury balances
    const lx = x, lw = halfW;
    this.add.text(lx + lw / 2, y + 8, 'КАЗНА', this.O('13px', '#2a5a70')).setOrigin(0.5, 0);

    const treasury = clan.treasury || { credits: 0, materials: 0 };
    const balRows = [
      { label: 'Кредиты',   val: treasury.credits.toLocaleString(),   color: '#ffe0b2' },
      { label: 'Материалы', val: treasury.materials.toLocaleString(), color: '#b8e4c4' },
    ];

    balRows.forEach((row, i) => {
      const ry = y + 38 + i * 54;
      const bg = this.add.graphics();
      bg.fillStyle(0x080e18, 0.9); bg.fillRoundedRect(lx, ry, lw, 44, 6);
      bg.lineStyle(1, 0x1a2a3a, 0.8); bg.strokeRoundedRect(lx, ry, lw, 44, 6);
      this.add.text(lx + 14, ry + 7,  row.label, this.F('11px', '#2a5060')).setOrigin(0, 0);
      this.add.text(lx + 14, ry + 24, row.val,   this.O('14px', row.color)).setOrigin(0, 0);
    });

    // Deposit credits button (from player)
    this._makeBtn(lx, y + 155, lw, 30, 'Пополнить казну', '#4dd0e1', 0x081420, 0x102030,
      () => { /* TODO: deposit dialog */ });

    // Vault upgrade section
    const vaultTier = clan.vaultTier ?? 0;
    const clanPts   = clan.clanPoints ?? 0;
    const curTier   = CLAN_VAULT_TIERS[vaultTier];
    const nextTier  = CLAN_VAULT_TIERS[vaultTier + 1];

    const vsY = y + 198;
    this.add.text(lx + lw / 2, vsY, 'РАСШИРИТЬ СКЛАД', this.O('11px', '#2a5a70')).setOrigin(0.5, 0);

    const curBg = this.add.graphics();
    curBg.fillStyle(0x080e18, 0.9); curBg.fillRoundedRect(lx, vsY + 18, lw, 38, 5);
    curBg.lineStyle(1, 0x1a2a3a, 0.8); curBg.strokeRoundedRect(lx, vsY + 18, lw, 38, 5);
    this.add.text(lx + 10, vsY + 26, `Тир ${vaultTier}: ${curTier.slots} слотов`,
      this.O('12px', '#4dd0e1')).setOrigin(0, 0);
    this.add.text(lx + lw - 10, vsY + 26, `Очки клана: ${clanPts.toLocaleString()}`,
      this.F('11px', '#2a6a50')).setOrigin(1, 0);

    if (nextTier) {
      const canUpg = treasury.credits >= nextTier.costCredits && clanPts >= nextTier.costClanPts;
      const upgBg  = this.add.graphics();
      upgBg.fillStyle(0x080e18, 0.9); upgBg.fillRoundedRect(lx, vsY + 62, lw, 38, 5);
      upgBg.lineStyle(1, canUpg ? 0x1a4a2a : 0x1a2a3a, 0.8);
      upgBg.strokeRoundedRect(lx, vsY + 62, lw, 38, 5);
      this.add.text(lx + 10, vsY + 70, `Тир ${vaultTier + 1}: ${nextTier.slots} слотов`,
        this.O('12px', canUpg ? '#66cc88' : '#334455')).setOrigin(0, 0);
      const costStr = `${(nextTier.costCredits / 1000).toFixed(0)}k cr · ${nextTier.costClanPts.toLocaleString()} очков`;
      this.add.text(lx + lw - 10, vsY + 70, costStr,
        this.F('10px', canUpg ? '#ffe0b2' : '#2a3a2a')).setOrigin(1, 0);

      if (canUpg) {
        this._makeBtn(lx, vsY + 106, lw, 28, '↑ АПГРЕЙД СКЛАДА', '#66cc88', 0x0a1a10, 0x122818, () => {
          treasury.credits  -= nextTier.costCredits;
          clan.clanPoints    = (clan.clanPoints || 0) - nextTier.costClanPts;
          clan.vaultTier     = vaultTier + 1;
          this.scene.restart();
        });
      } else {
        const lockBg = this.add.graphics();
        lockBg.fillStyle(0x0a0e14, 0.9); lockBg.fillRoundedRect(lx, vsY + 106, lw, 28, 5);
        lockBg.lineStyle(1, 0x1a2a2a, 0.5); lockBg.strokeRoundedRect(lx, vsY + 106, lw, 28, 5);
        this.add.text(lx + lw / 2, vsY + 120, '🔒 НЕДОСТАТОЧНО РЕСУРСОВ',
          this.F('10px', '#2a3a2a')).setOrigin(0.5);
      }
    } else {
      this.add.text(lx + lw / 2, vsY + 66, 'МАКСИМАЛЬНЫЙ ТИР', this.F('12px', '#ffb74d')).setOrigin(0.5);
    }

    // Right: clan buffs
    const rx = x + halfW + 16, rw = halfW;
    this.add.text(rx + rw / 2, y + 8, 'КЛАНОВЫЕ БАФФЫ', this.O('13px', '#2a5a70')).setOrigin(0.5, 0);

    const buffs = clan.buffs || [];
    buffs.forEach((buff, i) => {
      const ry = y + 38 + i * 80;
      const bg = this.add.graphics();
      bg.fillStyle(0x080e18, 0.9); bg.fillRoundedRect(rx, ry, rw, 70, 6);
      bg.lineStyle(1, 0x1a2a3a, 0.7); bg.strokeRoundedRect(rx, ry, rw, 70, 6);

      const pct = BUFF_PCT_PER_LVL[buff.lvl] || 0;
      const pctNext = BUFF_PCT_PER_LVL[buff.lvl + 1] || null;

      this.add.text(rx + 14, ry + 8,  buff.name, this.O('13px', '#4dd0e1')).setOrigin(0, 0);
      this.add.text(rx + 14, ry + 28,
        buff.lvl > 0 ? `+${pct}% эффект` : 'Не активен',
        this.F('12px', buff.lvl > 0 ? '#66bb6a' : '#334455')).setOrigin(0, 0);

      // Level pip track
      for (let p = 0; p < buff.maxLvl; p++) {
        const px2 = rx + 14 + p * 28;
        const pip = this.add.graphics();
        pip.fillStyle(p < buff.lvl ? 0x4dd0e1 : 0x1a2a3a, 1);
        pip.fillRoundedRect(px2, ry + 50, 22, 10, 3);
        if (p === buff.lvl) {
          pip.lineStyle(1, COLORS.primary, 0.4);
          pip.strokeRoundedRect(px2, ry + 50, 22, 10, 3);
        }
      }

      // Upgrade button
      if (buff.lvl < buff.maxLvl) {
        const upgCost = (buff.lvl + 1) * 2000;
        const canAfford = treasury.credits >= upgCost;
        const ubw = 100, ubh = 22;
        const ubx = rx + rw - ubw - 8, uby = ry + (70 - ubh) / 2;
        const btn = this.add.rectangle(ubx + ubw / 2, uby + ubh / 2, ubw, ubh,
          canAfford ? 0x0a1a10 : 0x101010, 0.9)
          .setStrokeStyle(1, canAfford ? 0x2a6840 : 0x1a2a2a, 0.8)
          .setInteractive({ useHandCursor: canAfford });
        this.add.text(ubx + ubw / 2, uby + ubh / 2,
          `↑ ${(upgCost / 1000).toFixed(0)}k`, this.F('10px', canAfford ? '#4acc88' : '#2a3a2a'))
          .setOrigin(0.5);
        if (canAfford) {
          btn.on('pointerdown', () => {
            treasury.credits -= upgCost;
            buff.lvl += 1;
            this.scene.restart();
          });
        }
      } else {
        this.add.text(rx + rw - 60, ry + 35, 'МАКС', this.F('11px', '#ffb74d')).setOrigin(0.5);
      }
    });
  }

  // ── Helper ───────────────────────────────────────────────────────────────
  _makeBtn(x, y, w, h, label, textColor, fillN, fillH, cb) {
    const bg = this.add.graphics();
    bg.fillStyle(fillN, 0.92); bg.fillRoundedRect(x, y, w, h, 5);
    bg.lineStyle(1, COLORS.primary, 0.3); bg.strokeRoundedRect(x, y, w, h, 5);
    const btn = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0, 0)
      .setInteractive({ useHandCursor: true });
    const lbl = this.add.text(x + w / 2, y + h / 2, label,
      this.F('12px', textColor)).setOrigin(0.5);
    btn.on('pointerover',  () => { bg.clear(); bg.fillStyle(fillH, 0.95); bg.fillRoundedRect(x, y, w, h, 5); });
    btn.on('pointerout',   () => { bg.clear(); bg.fillStyle(fillN, 0.92); bg.fillRoundedRect(x, y, w, h, 5); });
    btn.on('pointerdown',  cb);
    return btn;
  }
}
