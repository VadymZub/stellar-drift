import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';

// MVP hardcoded missions — 3 daily + 2 story
const MISSIONS = [
  {
    id: 'daily_patrol',
    type: 'daily',
    title: 'Патрульный обход',
    npc: 'npc_corvus',
    npcName: 'Бригадир Корвус',
    desc: 'Сектор снова неспокоен. Уничтожьте пиратские корабли Корсаров, прежде чем они доберутся до базы.',
    objectives: [{ text: 'Уничтожить Корсаров', current: 2, total: 5 }],
    rewards: { xp: 500, credits: 1200, stars: 0 },
    status: 'active',
  },
  {
    id: 'daily_salvage',
    type: 'daily',
    title: 'Сбор обломков',
    npc: 'npc_jakob',
    npcName: 'Старый Якоб',
    desc: 'Недавний бой оставил много интересного. Мне нужны компоненты — не жалей топлива.',
    objectives: [{ text: 'Подобрать контейнеры с лутом', current: 0, total: 10 }],
    rewards: { xp: 350, credits: 900, stars: 0 },
    status: 'available',
  },
  {
    id: 'daily_escort',
    type: 'daily',
    title: 'Сопровождение груза',
    npc: 'npc_morgan',
    npcName: 'Капитан Морган',
    desc: 'Мой транспорт полон редких руд. Нужен эскорт через нейтральный сектор. Заплачу щедро.',
    objectives: [
      { text: 'Прибыть в сектор Karax-2', current: 0, total: 1 },
      { text: 'Защитить транспорт', current: 0, total: 1 },
    ],
    rewards: { xp: 600, credits: 1800, stars: 2 },
    status: 'available',
  },
  {
    id: 'story_signal',
    type: 'story',
    title: 'Эхо Древних',
    npc: 'npc_ancient',
    npcName: 'Голос Древних',
    desc: 'Из глубины сектора R-1 поступает аномальный сигнал. Источник неизвестен. Приказываю разведать.',
    objectives: [
      { text: 'Достичь сектора R-1', current: 0, total: 1 },
      { text: 'Уничтожить Стража данжа', current: 0, total: 1 },
      { text: 'Активировать маяк-ретранслятор', current: 0, total: 1 },
    ],
    rewards: { xp: 2500, credits: 5000, stars: 15 },
    status: 'available',
  },
  {
    id: 'story_supply',
    type: 'story',
    title: 'Цена союза',
    npc: 'npc_terranov',
    npcName: 'Магнат Терранов',
    desc: 'Корпорация Helios нуждается в ресурсах для проекта «Ковчег». Вы — лучший вариант для деликатной работы.',
    objectives: [
      { text: 'Собрать 500 единиц плазмита', current: 120, total: 500 },
      { text: 'Доставить на Станцию «Ковчег»', current: 0, total: 1 },
    ],
    rewards: { xp: 4000, credits: 12000, stars: 30 },
    status: 'active',
  },
];

const TYPE_LABEL  = { daily: 'ЕЖЕДНЕВНАЯ', story: 'СЮЖЕТ' };
const TYPE_COLOR  = { daily: '#4dd0e1', story: '#ffb74d' };
const STATUS_COLOR = { active: '#66bb6a', available: '#4a6678', completed: '#2a5a30' };
const STATUS_LABEL = { active: 'АКТИВНА', available: 'ДОСТУПНА', completed: 'ВЫПОЛНЕНА' };

export default class MissionsScene extends Phaser.Scene {
  constructor() { super('MissionsScene'); }

  O(s, c) { return { fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }
  F(s, c) { return { fontFamily: 'Inter, sans-serif',    fontSize: s, color: c, resolution: UI_RES }; }

  create() {
    this.gs = this.scene.get('GameScene');
    const gs = this.gs;
    const W  = this.scale.width, H = this.scale.height;


    const pw = Math.min(960, W - 40);
    const ph = Math.min(620, H - 60);
    const px = (W - pw) / 2, py = (H - ph) / 2;

    const panel = this.add.graphics();
    panel.fillStyle(0x060c18, 0.96); panel.fillRoundedRect(px, py, pw, ph, 12);
    panel.lineStyle(2, COLORS.primary, 0.6); panel.strokeRoundedRect(px, py, pw, ph, 12);

    this.add.text(px + 22, py + 16, 'МИССИИ', this.O('20px', '#4dd0e1'));
    this.add.text(px + pw - 18, py + 20, 'O / ESC', this.F('10px', '#223344')).setOrigin(1, 0);

    // Filter tabs
    const filters = ['all', 'active', 'completed'];
    const filterLabel = { all: 'ВСЕ', active: 'АКТИВНЫЕ', completed: 'ВЫПОЛНЕННЫЕ' };
    if (!gs.missionsFilter) gs.missionsFilter = 'all';

    const ftabW = 120, ftabH = 26, ftabY = py + 46;
    filters.forEach((f, i) => {
      const ftx = px + 20 + i * (ftabW + 6);
      const sel = gs.missionsFilter === f;
      const fbg = this.add.graphics();
      fbg.fillStyle(sel ? 0x0d2030 : 0x040c15, sel ? 1 : 0.8);
      fbg.fillRoundedRect(ftx, ftabY, ftabW, ftabH, 4);
      if (sel) {
        fbg.lineStyle(1, COLORS.primary, 0.6);
        fbg.strokeRoundedRect(ftx, ftabY, ftabW, ftabH, 4);
      }
      const btn = this.add.rectangle(ftx + ftabW / 2, ftabY + ftabH / 2, ftabW, ftabH, 0, 0)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => { gs.missionsFilter = f; this.scene.restart(); });
      this.add.text(ftx + ftabW / 2, ftabY + ftabH / 2, filterLabel[f],
        this.O('10px', sel ? '#4dd0e1' : '#2a4a5a')).setOrigin(0.5);
    });

    const filtered = this._filteredMissions(gs.missionsFilter);
    if (gs.selectedMissionIdx === undefined || gs.selectedMissionIdx >= filtered.length)
      gs.selectedMissionIdx = 0;
    const selIdx     = gs.selectedMissionIdx;
    const selMission = filtered[selIdx] || null;

    const listW     = Math.floor(pw * 0.38);
    const detW      = pw - listW - 20;
    const contentY  = py + 82;
    const contentH  = ph - 90;

    this._renderList(px + 8, contentY, listW, contentH, filtered, selIdx, gs);
    this._renderDetail(px + listW + 16, contentY, detW, contentH, selMission);

    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());
    this.input.keyboard.on('keydown-O',   () => this.scene.stop());
  }

  _filteredMissions(filter) {
    if (filter === 'active')    return MISSIONS.filter(m => m.status === 'active');
    if (filter === 'completed') return MISSIONS.filter(m => m.status === 'completed');
    return MISSIONS;
  }

  // ── Left mission list ────────────────────────────────────────────────────
  _renderList(x, y, w, h, missions, selIdx, gs) {
    if (!missions.length) {
      this.add.text(x + w / 2, y + 40, 'Нет миссий', this.F('13px', '#2a3a4a')).setOrigin(0.5, 0);
      return;
    }

    const rowH = 72, gap = 6;
    missions.forEach((m, i) => {
      const ry  = y + i * (rowH + gap);
      const sel = i === selIdx;

      const bg  = this.add.graphics();
      bg.fillStyle(sel ? 0x0e2436 : 0x080e1a, sel ? 1 : 0.9);
      bg.fillRoundedRect(x, ry, w, rowH, 6);
      bg.lineStyle(sel ? 2 : 1, sel ? COLORS.primary : 0x0d1a28, 0.9);
      bg.strokeRoundedRect(x, ry, w, rowH, 6);

      const btn = this.add.rectangle(x + w / 2, ry + rowH / 2, w, rowH, 0, 0)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => { gs.selectedMissionIdx = i; this.scene.restart(); });
      btn.on('pointerover',  () => { if (!sel) bg.fillStyle(0x0c1828, 0.95); });
      btn.on('pointerout',   () => { if (!sel) bg.fillStyle(0x080e1a, 0.9); });

      const tColor = TYPE_COLOR[m.type] || '#4dd0e1';
      this.add.text(x + 10, ry + 7,  TYPE_LABEL[m.type] || m.type, this.O('9px', tColor)).setOrigin(0, 0);
      this.add.text(x + 10, ry + 24, m.title, this.O('12px', sel ? '#cce8f4' : '#8ab0bc')).setOrigin(0, 0);

      const sColor = STATUS_COLOR[m.status] || '#4a6678';
      this.add.text(x + 10, ry + 46, STATUS_LABEL[m.status] || m.status, this.F('10px', sColor)).setOrigin(0, 0);
      this.add.text(x + w - 10, ry + 46, `${m.rewards.xp} XP  ${m.rewards.credits}cr`,
        this.F('10px', '#2a5060')).setOrigin(1, 0);
    });
  }

  // ── Right mission detail ─────────────────────────────────────────────────
  _renderDetail(x, y, w, h, mission) {
    const bg = this.add.graphics();
    bg.fillStyle(0x070d1a, 0.9); bg.fillRoundedRect(x, y, w, h, 8);
    bg.lineStyle(1, 0x0e1e30, 0.8); bg.strokeRoundedRect(x, y, w, h, 8);

    if (!mission) {
      this.add.text(x + w / 2, y + h / 2, 'Выберите миссию',
        this.F('14px', '#1a2a3a')).setOrigin(0.5);
      return;
    }

    const portW = 128, portH = 180;
    const portX = x + 18, portY = y + 18;

    if (this.textures.exists(mission.npc)) {
      const img = this.add.image(portX + portW / 2, portY + portH / 2, mission.npc);
      const sc  = Math.min(portW / img.width, portH / img.height);
      img.setScale(sc).setOrigin(0.5);
      const pfg = this.add.graphics();
      pfg.lineStyle(2, COLORS.primary, 0.5);
      pfg.strokeRoundedRect(portX, portY, portW, portH, 6);
    } else {
      const pfg = this.add.graphics();
      pfg.fillStyle(0x0a1828, 1); pfg.fillRoundedRect(portX, portY, portW, portH, 6);
      pfg.lineStyle(2, COLORS.primary, 0.35); pfg.strokeRoundedRect(portX, portY, portW, portH, 6);
      this.add.text(portX + portW / 2, portY + portH / 2, '?',
        this.O('40px', '#1a3a4a')).setOrigin(0.5);
    }

    this.add.text(portX + portW / 2, portY + portH + 8, mission.npcName,
      this.F('11px', '#4a8898')).setOrigin(0.5, 0);

    // Mission info: right of portrait
    const textX = portX + portW + 14, textW = w - portW - 44;
    const tColor = TYPE_COLOR[mission.type] || '#4dd0e1';

    this.add.text(textX, y + 18, TYPE_LABEL[mission.type] || '', this.O('10px', tColor)).setOrigin(0, 0);
    this.add.text(textX, y + 36, mission.title,
      { ...this.O('16px', '#cce8f4'), wordWrap: { width: textW } }).setOrigin(0, 0);
    this.add.text(textX, y + 66, mission.desc,
      { ...this.F('12px', '#5a8090'), wordWrap: { width: textW } }).setOrigin(0, 0);

    // Objectives — below portrait
    const objY = portY + portH + 36;
    this.add.text(x + 18, objY, 'ЗАДАЧИ', this.O('11px', '#2a5a70')).setOrigin(0, 0);

    mission.objectives.forEach((obj, i) => {
      const oy   = objY + 22 + i * 34;
      const done = obj.current >= obj.total;
      const pct  = obj.total > 0 ? Math.min(1, obj.current / obj.total) : 0;

      this.add.text(x + 18, oy, obj.text,
        this.F('12px', done ? '#66bb6a' : '#8ab0bc')).setOrigin(0, 0);

      const barX = x + 18, barY = oy + 16, barW = w - 36, barH = 5;
      const bbg = this.add.graphics();
      bbg.fillStyle(0x0a1828, 1); bbg.fillRoundedRect(barX, barY, barW, barH, 2);
      if (pct > 0) {
        bbg.fillStyle(done ? COLORS.emerald : COLORS.primary, 0.8);
        bbg.fillRoundedRect(barX, barY, Math.floor(barW * pct), barH, 2);
      }
      this.add.text(barX + barW, barY - 2, `${obj.current}/${obj.total}`,
        this.F('10px', done ? '#66bb6a' : '#2a5060')).setOrigin(1, 0);
    });

    // Rewards
    const rewY = y + h - 76;
    const divG = this.add.graphics();
    divG.lineStyle(1, 0x0e1e30, 1);
    divG.strokeLineShape(new Phaser.Geom.Line(x + 14, rewY - 8, x + w - 14, rewY - 8));

    this.add.text(x + 18, rewY, 'НАГРАДА', this.O('11px', '#2a5a70')).setOrigin(0, 0);

    const r = mission.rewards;
    const rewItems = [
      { label: `${r.xp} XP`, color: '#4dd0e1' },
      { label: `${r.credits} cr`, color: '#ffb74d' },
    ];
    if (r.stars > 0) rewItems.push({ label: `${r.stars} ★`, color: '#ffd54f' });

    rewItems.forEach((ri, i) => {
      this.add.text(x + 18 + i * 140, rewY + 22, ri.label,
        this.O('14px', ri.color)).setOrigin(0, 0);
    });

    // Accept/Track button
    if (mission.status !== 'completed') {
      const btnLabel = mission.status === 'active' ? 'СЛЕДИТЬ' : 'ПРИНЯТЬ';
      const bw = 140, bh = 34;
      const bx = x + w - bw - 14, by2 = y + h - bh - 12;
      const btnBg = this.add.graphics();
      btnBg.fillStyle(0x0a2030, 0.92); btnBg.fillRoundedRect(bx, by2, bw, bh, 5);
      btnBg.lineStyle(2, COLORS.primary, 0.6); btnBg.strokeRoundedRect(bx, by2, bw, bh, 5);
      const btn = this.add.rectangle(bx + bw / 2, by2 + bh / 2, bw, bh, 0, 0)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => {
        btnBg.clear();
        btnBg.fillStyle(0x102840, 0.95); btnBg.fillRoundedRect(bx, by2, bw, bh, 5);
      });
      btn.on('pointerout', () => {
        btnBg.clear();
        btnBg.fillStyle(0x0a2030, 0.92); btnBg.fillRoundedRect(bx, by2, bw, bh, 5);
      });
      btn.on('pointerdown', () => {
        if (mission.status === 'available') { mission.status = 'active'; this.scene.restart(); }
      });
      this.add.text(bx + bw / 2, by2 + bh / 2, btnLabel, this.O('12px', '#4dd0e1')).setOrigin(0.5);
    }
  }
}
