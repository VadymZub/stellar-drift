import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { prerenderTex } from '../utils/prerenderTex.js';
import { totalPlasmateInInventory, removePlasmateFromInventory } from '../items.js';
import { MISSIONS } from '../data/missions.js';

const TYPE_LABEL   = { daily: 'ЕЖЕДНЕВНАЯ', story: 'СЮЖЕТ' };
const TYPE_COLOR   = { daily: '#4dd0e1', story: '#ffb74d' };
const STATUS_COLOR = { active: '#66bb6a', available: '#4a6678', completed: '#2a5a30', locked: '#4a3030', failed: '#ef5350' };
const STATUS_LABEL = { active: 'АКТИВНА', available: 'ДОСТУПНА', completed: 'ВЫПОЛНЕНА', locked: 'ЗАБЛОКИРОВАНА', failed: 'ПРОВАЛЕНА' };

export default class MissionsScene extends Phaser.Scene {
  constructor() { super('MissionsScene'); }

  O(s, c) { return { fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }
  F(s, c) { return { fontFamily: 'Inter, sans-serif',    fontSize: s, color: c, resolution: UI_RES }; }

  create() {
    this.gs = this.scene.get('GameScene');
    const gs = this.gs;

    const W  = this.scale.width, H = this.scale.height;

    const _bgMiss = this.add.image(W / 2, H / 2, 'bg_missions');
    _bgMiss.setScale(Math.max(W / _bgMiss.width, H / _bgMiss.height)).setAlpha(0.8);

    const pw = Math.min(1152, W - 40);
    const ph = Math.min(744, H - 60);
    const px = (W - pw) / 2, py = (H - ph) / 2;

    const panel = this.add.graphics();
    panel.fillStyle(0x060c18, 0.96); panel.fillRoundedRect(px, py, pw, ph, 12);
    panel.lineStyle(2, COLORS.primary, 0.6); panel.strokeRoundedRect(px, py, pw, ph, 12);

    this.add.text(px + 26, py + 19, 'МИССИИ', this.O('24px', '#4dd0e1'));
    this.add.text(px + pw - 22, py + 24, 'O / ESC', this.F('12px', '#223344')).setOrigin(1, 0);

    // Filter tabs
    const filters = ['all', 'active', 'completed'];
    const filterLabel = { all: 'ВСЕ', active: 'АКТИВНЫЕ', completed: 'ВЫПОЛНЕННЫЕ' };
    if (!gs.missionsFilter) gs.missionsFilter = 'all';

    const ftabW = 144, ftabH = 31, ftabY = py + 55;
    filters.forEach((f, i) => {
      const ftx = px + 24 + i * (ftabW + 7);
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
        this.O('12px', sel ? '#4dd0e1' : '#2a4a5a')).setOrigin(0.5);
    });

    const filtered = this._filteredMissions(gs);
    if (gs.selectedMissionIdx === undefined || gs.selectedMissionIdx >= filtered.length)
      gs.selectedMissionIdx = 0;
    const selIdx     = gs.selectedMissionIdx;
    const selMission = filtered[selIdx] || null;

    const listW     = Math.floor(pw * 0.38);
    const detW      = pw - listW - 20;
    const contentY  = py + 98;
    const contentH  = ph - 108;

    this._renderList(px + 8, contentY, listW, contentH, filtered, selIdx, gs);
    this._renderDetail(px + listW + 16, contentY, detW, contentH, selMission, gs);

    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());
    this.input.keyboard.on('keydown-O',   () => this.scene.stop());
  }

  _missionStatus(gs, id) {
    return gs.missionState?.[id]?.status ?? 'available';
  }

  _filteredMissions(gs) {
    const filter = gs.missionsFilter ?? 'all';
    const lvl = gs.pilotLevel ?? 1;
    return MISSIONS.filter(m => {
      const s = this._missionStatus(gs, m.id);
      if (filter === 'active')    return s === 'active';
      if (filter === 'completed') return s === 'completed';
      // 'all': show everything except locked missions above current level
      if (s === 'locked') return false;
      return true;
    });
  }

  // ── Left mission list ────────────────────────────────────────────────────
  _renderList(x, y, w, h, missions, selIdx, gs) {
    if (!missions.length) {
      this.add.text(x + w / 2, y + 48, 'Нет миссий', this.F('16px', '#2a3a4a')).setOrigin(0.5, 0);
      return;
    }

    const rowH = 86, gap = 7;
    missions.forEach((m, i) => {
      const ry  = y + i * (rowH + gap);
      const sel = i === selIdx;
      const status = this._missionStatus(gs, m.id);

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
      this.add.text(x + 10, ry + 8,  TYPE_LABEL[m.type] || m.type, this.O('11px', tColor)).setOrigin(0, 0);
      this.add.text(x + 10, ry + 29, m.title, this.O('14px', sel ? '#cce8f4' : '#8ab0bc')).setOrigin(0, 0);

      const sColor = STATUS_COLOR[status] || '#4a6678';
      this.add.text(x + 10, ry + 55, STATUS_LABEL[status] || status, this.F('12px', sColor)).setOrigin(0, 0);
      this.add.text(x + w - 10, ry + 55, `${m.rewards.xp} XP  ${m.rewards.credits}cr`,
        this.F('12px', '#2a5060')).setOrigin(1, 0);
    });
  }

  // ── Right mission detail ─────────────────────────────────────────────────
  _renderDetail(x, y, w, h, mission, gs) {
    const bg = this.add.graphics();
    bg.fillStyle(0x070d1a, 0.9); bg.fillRoundedRect(x, y, w, h, 8);
    bg.lineStyle(1, 0x0e1e30, 0.8); bg.strokeRoundedRect(x, y, w, h, 8);

    if (!mission) {
      this.add.text(x + w / 2, y + h / 2, 'Выберите миссию',
        this.F('17px', '#1a2a3a')).setOrigin(0.5);
      return;
    }

    const status = this._missionStatus(gs, mission.id);
    const mState = gs.missionState?.[mission.id];

    const portW = 154, portH = 216;
    const portX = x + 22, portY = y + 22;

    if (this.textures.exists(mission.npc)) {
      const src = this.textures.get(mission.npc).getSourceImage();
      const sc  = Math.min(portW / src.width, portH / src.height);
      const dw  = Math.round(src.width  * sc);
      const dh  = Math.round(src.height * sc);
      this.add.image(portX + portW / 2, portY + portH / 2, prerenderTex(this, mission.npc, dw, dh))
        .setDisplaySize(dw, dh).setOrigin(0.5);
      const pfg = this.add.graphics();
      pfg.lineStyle(2, COLORS.primary, 0.5);
      pfg.strokeRoundedRect(portX, portY, portW, portH, 6);
    } else {
      const pfg = this.add.graphics();
      pfg.fillStyle(0x0a1828, 1); pfg.fillRoundedRect(portX, portY, portW, portH, 6);
      pfg.lineStyle(2, COLORS.primary, 0.35); pfg.strokeRoundedRect(portX, portY, portW, portH, 6);
      this.add.text(portX + portW / 2, portY + portH / 2, '?',
        this.O('48px', '#1a3a4a')).setOrigin(0.5);
    }

    this.add.text(portX + portW / 2, portY + portH + 10, mission.npcName,
      this.F('13px', '#4a8898')).setOrigin(0.5, 0);

    // Mission info: right of portrait
    const textX = portX + portW + 17, textW = w - portW - 53;
    const tColor = TYPE_COLOR[mission.type] || '#4dd0e1';

    this.add.text(textX, y + 22, TYPE_LABEL[mission.type] || '', this.O('12px', tColor)).setOrigin(0, 0);
    this.add.text(textX, y + 43, mission.title,
      { ...this.O('19px', '#cce8f4'), wordWrap: { width: textW } }).setOrigin(0, 0);
    const corp = gs.playerCorp ?? 'helios';
    const desc = mission.descByCorp?.[corp] ?? mission.desc;
    this.add.text(textX, y + 79, desc,
      { ...this.F('14px', '#5a8090'), wordWrap: { width: textW } }).setOrigin(0, 0);

    // Objectives — below portrait
    const objY = portY + portH + 43;
    this.add.text(x + 22, objY, 'ЗАДАЧИ', this.O('13px', '#2a5a70')).setOrigin(0, 0);

    const playerCorp = gs.playerCorp ?? 'helios';
    mission.objectives.forEach((obj, i) => {
      const oy   = objY + 26 + i * 41;
      const cur  = mState?.objectives[i]?.current ?? 0;
      const done = cur >= obj.total;
      const pct  = obj.total > 0 ? Math.min(1, cur / obj.total) : 0;
      const objText = obj.textByCorp?.[playerCorp] ?? obj.text;

      this.add.text(x + 22, oy, objText,
        this.F('14px', done ? '#66bb6a' : '#8ab0bc')).setOrigin(0, 0);

      const barX = x + 22, barY = oy + 19, barW = w - 44, barH = 6;
      const bbg = this.add.graphics();
      bbg.fillStyle(0x0a1828, 1); bbg.fillRoundedRect(barX, barY, barW, barH, 2);
      if (pct > 0) {
        bbg.fillStyle(done ? COLORS.emerald : COLORS.primary, 0.8);
        bbg.fillRoundedRect(barX, barY, Math.floor(barW * pct), barH, 2);
      }
      this.add.text(barX + barW, barY - 2, `${cur}/${obj.total}`,
        this.F('12px', done ? '#66bb6a' : '#2a5060')).setOrigin(1, 0);
    });

    // Rewards
    const rewY = y + h - 91;
    const divG = this.add.graphics();
    divG.lineStyle(1, 0x0e1e30, 1);
    divG.strokeLineShape(new Phaser.Geom.Line(x + 17, rewY - 10, x + w - 17, rewY - 10));

    this.add.text(x + 22, rewY, 'НАГРАДА', this.O('13px', '#2a5a70')).setOrigin(0, 0);

    const r = mission.rewards;
    const rewItems = [
      { label: `${r.xp} XP`, color: '#4dd0e1' },
      { label: `${r.credits} cr`, color: '#ffb74d' },
    ];
    if (r.stars > 0) rewItems.push({ label: `${r.stars} ★`, color: '#ffd54f' });

    rewItems.forEach((ri, i) => {
      this.add.text(x + 22 + i * 168, rewY + 26, ri.label,
        this.O('16px', ri.color)).setOrigin(0, 0);
    });

    // Deliver cargo button for story_supply
    if (mission.id === 'story_supply' && status === 'active') {
      const obj0State = mState?.objectives[0];
      const obj1State = mState?.objectives[1];
      const obj0Def   = mission.objectives[0];
      const obj1Def   = mission.objectives[1];
      const obj0Done  = (obj0State?.current ?? 0) >= obj0Def.total;
      const obj1Done  = (obj1State?.current ?? 0) >= obj1Def.total;

      if (obj0Done && !obj1Done) {
        const plasmateCount = totalPlasmateInInventory(gs.inventory);
        const canDeliver = gs.atBase && plasmateCount >= 500;
        const bw = 264, bh = 41;
        const bx = x + 22, by2 = rewY - 60;

        const btnBg2 = this.add.graphics();
        const bgColor    = canDeliver ? 0x0a2818 : 0x0a1420;
        const borderColor = canDeliver ? COLORS.emerald : 0x1a3040;
        btnBg2.fillStyle(bgColor, 0.95); btnBg2.fillRoundedRect(bx, by2, bw, bh, 5);
        btnBg2.lineStyle(2, borderColor, 0.8); btnBg2.strokeRoundedRect(bx, by2, bw, bh, 5);

        const lblColor = canDeliver ? '#66bb6a' : '#2a5060';
        this.add.text(bx + bw / 2, by2 + bh / 2, 'СДАТЬ ГРУЗ (−500 плазмита)',
          this.O('13px', lblColor)).setOrigin(0.5);

        if (canDeliver) {
          const btn2 = this.add.rectangle(bx + bw / 2, by2 + bh / 2, bw, bh, 0, 0)
            .setInteractive({ useHandCursor: true });
          btn2.on('pointerover', () => {
            btnBg2.clear();
            btnBg2.fillStyle(0x143820, 0.98); btnBg2.fillRoundedRect(bx, by2, bw, bh, 5);
            btnBg2.lineStyle(2, COLORS.emerald, 1); btnBg2.strokeRoundedRect(bx, by2, bw, bh, 5);
          });
          btn2.on('pointerout', () => {
            btnBg2.clear();
            btnBg2.fillStyle(bgColor, 0.95); btnBg2.fillRoundedRect(bx, by2, bw, bh, 5);
            btnBg2.lineStyle(2, borderColor, 0.8); btnBg2.strokeRoundedRect(bx, by2, bw, bh, 5);
          });
          btn2.on('pointerdown', () => {
            removePlasmateFromInventory(gs.inventory, 500);
            gs.advanceMission('story_supply', 1);
            this.scene.restart();
          });
        } else if (!gs.atBase) {
          this.add.text(bx + bw + 12, by2 + bh / 2, 'только на базе',
            this.F('12px', '#2a4050')).setOrigin(0, 0.5);
        } else if (totalPlasmateInInventory(gs.inventory) < 500) {
          this.add.text(bx + bw + 12, by2 + bh / 2,
            `плазмит: ${totalPlasmateInInventory(gs.inventory)}/500`,
            this.F('12px', '#2a4050')).setOrigin(0, 0.5);
        }
      }
    }

    // Accept / Track button
    if (status !== 'completed') {
      const playerLvl = gs.pilotLevel ?? 1;
      const reqLvl = mission.minLevel ?? 1;
      const lvlLocked = playerLvl < reqLvl;
      const isFailed  = status === 'failed';
      const disabled  = lvlLocked || isFailed || status === 'locked';
      const btnLabel  = lvlLocked ? `🔒 ур. ${reqLvl}`
        : isFailed ? 'ПРОВАЛЕНА (завтра)'
        : (status === 'active' ? 'СЛЕДИТЬ' : 'ПРИНЯТЬ');
      const bw = 168, bh = 41;
      const bx = x + w - bw - 17, by2 = y + h - bh - 14;
      const btnBg = this.add.graphics();
      const bgCol = disabled ? 0x1a0f0f : 0x0a2030;
      const brCol = disabled ? 0x5a2a2a : COLORS.primary;
      const txtCol = isFailed ? '#ef5350' : lvlLocked ? '#7a4040' : '#4dd0e1';
      btnBg.fillStyle(bgCol, 0.92); btnBg.fillRoundedRect(bx, by2, bw, bh, 5);
      btnBg.lineStyle(2, brCol, 0.6); btnBg.strokeRoundedRect(bx, by2, bw, bh, 5);
      if (!disabled) {
        const btn = this.add.rectangle(bx + bw / 2, by2 + bh / 2, bw, bh, 0, 0)
          .setInteractive({ useHandCursor: true });
        btn.on('pointerover', () => {
          btnBg.clear();
          btnBg.fillStyle(0x102840, 0.95); btnBg.fillRoundedRect(bx, by2, bw, bh, 5);
        });
        btn.on('pointerout', () => {
          btnBg.clear();
          btnBg.fillStyle(bgCol, 0.92); btnBg.fillRoundedRect(bx, by2, bw, bh, 5);
        });
        btn.on('pointerdown', () => {
          if (status === 'available') {
            if (gs.missionState?.[mission.id]) gs.missionState[mission.id].status = 'active';
            this.scene.restart();
          }
        });
      }
      this.add.text(bx + bw / 2, by2 + bh / 2, btnLabel, this.O('14px', txtCol)).setOrigin(0.5);
    }
  }
}
