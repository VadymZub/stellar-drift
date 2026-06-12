import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';

const TF  = { fontFamily: 'Orbitron, sans-serif',    resolution: UI_RES };
const TFS = { fontFamily: 'Inter, sans-serif',        resolution: UI_RES };

// ─── Branch styling ───────────────────────────────────────────────────────────

const BRANCH_META = {
  combat:      { label: '⚔  БОЕВАЯ',    color: '#ef5350', hex: 0xef5350, fill: 0x1a0606 },
  engineering: { label: '🔧 ИНЖЕНЕРИЯ', color: '#4dd0e1', hex: 0x4dd0e1, fill: 0x041418 },
  trading:     { label: '💰 ТОРГОВЛЯ',  color: '#ffb74d', hex: 0xffb74d, fill: 0x1a0e00 },
};

// ─── Skill definitions ────────────────────────────────────────────────────────
// type: 'active' → can be placed on action bar; 'passive' → always-on bonus
// requires: [[skillKey, minLevel], ...]

const SKILLS_DEF = [
  // ── COMBAT ──
  { key: 'sharpshooter',      branch: 'combat',      type: 'passive', nameRu: 'Снайпер',
    maxLevel: 3, requires: [],
    effects: ['+5% шанс крита', '+10% шанс крита', '+15% шанс крита'] },
  { key: 'heavy_caliber',     branch: 'combat',      type: 'passive', nameRu: 'Тяжёлый калибр',
    maxLevel: 4, requires: [['sharpshooter', 3]],
    effects: ['+8% урон', '+16% урон', '+24% урон', '+32% урон'] },
  { key: 'penetrating_rounds', branch: 'combat',     type: 'passive', nameRu: 'Бронебойные снаряды',
    maxLevel: 3, requires: [['heavy_caliber', 4]],
    effects: ['+10% пробивание', '+20% пробивание', '+30% пробивание'] },
  { key: 'overcharge_shot',   branch: 'combat',      type: 'active',  nameRu: 'Перегрузочный выстрел',
    maxLevel: 3, icon: '⚡', requires: [['penetrating_rounds', 3]],
    effects: ['×1.6 урон, КД 35c', '×1.8 урон, КД 30c', '×2.0 урон, КД 25c'] },
  { key: 'salvo',             branch: 'combat',      type: 'active',  nameRu: 'Залп',
    maxLevel: 4, icon: '🚀', requires: [['penetrating_rounds', 3]],
    effects: ['×3c все орудия, КД 70c', '×4c все орудия, КД 65c', '×5c, КД 60c', '×5c, КД 55c'] },
  { key: 'targeting_ai',      branch: 'combat',      type: 'passive', nameRu: 'ИИ прицеливания',
    maxLevel: 2, requires: [['overcharge_shot', 1]],
    effects: ['+15% захват цели', '+30% захват цели'] },
  { key: 'berserker',         branch: 'combat',      type: 'active',  nameRu: 'Берсерк',
    maxLevel: 4, icon: '💀', requires: [['salvo', 1]],
    effects: ['+30%урон HP<40% КД90c', '+40%урон HP<35% КД80c', '+50%урон HP<30% КД70c', '+60%урон HP<25% КД60c'] },

  // ── ENGINEERING ──
  { key: 'reinforced_hull',   branch: 'engineering', type: 'passive', nameRu: 'Усиленный корпус',
    maxLevel: 3, requires: [],
    effects: ['+8% макс. HP', '+16% макс. HP', '+25% макс. HP'] },
  { key: 'shield_optimizer',  branch: 'engineering', type: 'passive', nameRu: 'Оптимизатор щита',
    maxLevel: 2, requires: [['reinforced_hull', 3]],
    effects: ['+10% макс. щит', '+20% макс. щит'] },
  { key: 'fast_regen',        branch: 'engineering', type: 'passive', nameRu: 'Быстрая регенерация',
    maxLevel: 2, requires: [['shield_optimizer', 2]],
    effects: ['-30% задержка рег.', '-50% задержка рег.'] },
  { key: 'emergency_repair',  branch: 'engineering', type: 'active',  nameRu: 'Аварийный ремонт',
    maxLevel: 3, icon: '💉', requires: [['fast_regen', 2]],
    effects: ['+20% HP, КД 120c', '+25% HP, КД 120c', '+30% HP, КД 120c'] },
  { key: 'shield_burst',      branch: 'engineering', type: 'active',  nameRu: 'Всплеск щита',
    maxLevel: 3, icon: '🛡', requires: [['emergency_repair', 1]],
    effects: ['+80% щит, КД 90c', '+100% щит, КД 90c', '+120% щит, КД 85c'] },
  { key: 'damage_resist',     branch: 'engineering', type: 'passive', nameRu: 'Снижение урона',
    maxLevel: 3, requires: [['emergency_repair', 1]],
    effects: ['-8% вх. урон', '-15% вх. урон', '-20% вх. урон'] },
  { key: 'module_specialist', branch: 'engineering', type: 'passive', nameRu: 'Спец. модулей',
    maxLevel: 3, requires: [['damage_resist', 1]],
    effects: ['+10% эфф. модулей', '+20% эфф. модулей', '+30% эфф. модулей'] },

  // ── TRADING ──
  { key: 'loot_magnet',       branch: 'trading',     type: 'passive', nameRu: 'Магнит лута',
    maxLevel: 2, requires: [],
    effects: ['+40% радиус сбора', '+80% радиус сбора'] },
  { key: 'salvager',          branch: 'trading',     type: 'passive', nameRu: 'Сборщик',
    maxLevel: 2, requires: [['loot_magnet', 2]],
    effects: ['+1 предмет с моба', '+2 предмета с моба'] },
  { key: 'merchants_eye',     branch: 'trading',     type: 'passive', nameRu: 'Торговый взгляд',
    maxLevel: 2, requires: [['salvager', 2]],
    effects: ['+10% цена продажи', '+20% цена продажи'] },
  { key: 'scanner_boost',     branch: 'trading',     type: 'passive', nameRu: 'Усиление сканера',
    maxLevel: 3, requires: [['merchants_eye', 2]],
    effects: ['+20% радиус скана', '+40% радиус скана', '+60% радиус скана'] },
  { key: 'cargo_expand',      branch: 'trading',     type: 'passive', nameRu: 'Расш. грузов',
    maxLevel: 3, requires: [['merchants_eye', 2]],
    effects: ['+20 груз. мест', '+35 груз. мест', '+50 груз. мест'] },
  { key: 'stealth_sprint',    branch: 'trading',     type: 'active',  nameRu: 'Скрытный рывок',
    maxLevel: 3, icon: '👻', requires: [['cargo_expand', 1]],
    effects: ['+25%скор+стелс 5c КД60c', '+30%скор+стелс 6c КД60c', '+35%скор+стелс 8c КД55c'] },
];

const SKILL_MAP = {};
for (const s of SKILLS_DEF) SKILL_MAP[s.key] = s;

// ─── Per-branch node grid positions (relative to branch center x, tree start y) ──

function layoutFor(branch, cx, sy, rh) {
  const f = 70; // fork half-width
  const L = {
    combat: {
      sharpshooter:       { x: cx,     y: sy },
      heavy_caliber:      { x: cx,     y: sy + rh },
      penetrating_rounds: { x: cx,     y: sy + rh * 2 },
      overcharge_shot:    { x: cx - f, y: sy + rh * 3 },
      salvo:              { x: cx + f, y: sy + rh * 3 },
      targeting_ai:       { x: cx - f, y: sy + rh * 4 },
      berserker:          { x: cx + f, y: sy + rh * 4 },
    },
    engineering: {
      reinforced_hull:    { x: cx,     y: sy },
      shield_optimizer:   { x: cx,     y: sy + rh },
      fast_regen:         { x: cx,     y: sy + rh * 2 },
      emergency_repair:   { x: cx,     y: sy + rh * 3 },
      shield_burst:       { x: cx - f, y: sy + rh * 4 },
      damage_resist:      { x: cx + f, y: sy + rh * 4 },
      module_specialist:  { x: cx + f, y: sy + rh * 5 },
    },
    trading: {
      loot_magnet:    { x: cx,     y: sy },
      salvager:       { x: cx,     y: sy + rh },
      merchants_eye:  { x: cx,     y: sy + rh * 2 },
      scanner_boost:  { x: cx - f, y: sy + rh * 3 },
      cargo_expand:   { x: cx + f, y: sy + rh * 3 },
      stealth_sprint: { x: cx + f, y: sy + rh * 4 },
    },
  };
  return L[branch] || {};
}

const PAID_COSTS = [50, 100, 200, 400, 800];

// ─── Scene ────────────────────────────────────────────────────────────────────

export default class SkillScene extends Phaser.Scene {
  constructor() { super('SkillScene'); }

  create() {
    const { width: W, height: H } = this.scale;
    this._gs = this.scene.get('GameScene');

    // Init persistent state on gs
    const gs = this._gs;
    if (!gs.skillLevels)    gs.skillLevels    = {};
    if (!gs.actionBar)      gs.actionBar      = Array(10).fill(null);
    if (!gs.respeckCount)   gs.respeckCount   = 0;

    // Panel geometry
    const pw = Math.min(980, W - 40);
    const ph = Math.min(700, H - 40);
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;
    this._p = { px, py, pw, ph };

    // Dark overlay (closes tooltip on click)
    const overlay = this.add.rectangle(0, 0, W, H, 0x000000, 0.72).setOrigin(0).setInteractive();
    overlay.on('pointerdown', () => this._closeTooltip());

    // Panel background
    this._panelGfx = this.add.graphics().setDepth(1);
    this._redrawPanel();

    // Dynamic objects (header, nodes, action bar)
    this._objs = [];
    this._tooltipObjs = [];
    this._selectedKey = null;

    this._redraw();

    // Input
    const kb = this.input.keyboard;
    kb.on('keydown-ESC', () => this.scene.stop());
    kb.on('keydown-K',   () => this.scene.stop());
  }

  // ── Panel background (static, redrawn once) ──────────────────────────────

  _redrawPanel() {
    const { px, py, pw, ph } = this._p;
    const g = this._panelGfx; g.clear();
    g.fillStyle(0x06090f, 0.97); g.fillRoundedRect(px, py, pw, ph, 10);
    g.lineStyle(2, COLORS.primary, 0.65); g.strokeRoundedRect(px, py, pw, ph, 10);
  }

  // ── Full redraw of all dynamic objects ────────────────────────────────────

  _redraw() {
    this._objs.forEach(o => o?.destroy());
    this._objs = [];
    this._closeTooltip();
    this._selectedKey = null;

    const { px, py, pw, ph } = this._p;
    this._drawHeader(px, py, pw);
    this._drawBranches(px, py, pw, ph);
    this._drawActionBarUI(px, py, pw, ph);
  }

  // ── SP helpers ────────────────────────────────────────────────────────────

  _spTotal()  { return Math.max(0, (this._gs.pilotLevel || 1) - 1) + (this._gs.skillAchievementSP || 0); }
  _spSpent()  { return Object.values(this._gs.skillLevels).reduce((a, v) => a + v, 0); }
  _spAvail()  { return this._spTotal() - this._spSpent(); }
  _lvl(key)   { return this._gs.skillLevels[key] || 0; }

  _nodeState(key) {
    const s  = SKILL_MAP[key];
    const lv = this._lvl(key);
    if (lv > 0) return 'unlocked';
    const reqsMet = s.requires.every(([rk, rl]) => this._lvl(rk) >= rl);
    if (reqsMet && this._spAvail() > 0) return 'available';
    if (reqsMet) return 'available_no_sp';  // met reqs but 0 SP left
    return 'locked';
  }

  _canUpgrade(key) {
    const s  = SKILL_MAP[key];
    const lv = this._lvl(key);
    if (lv >= s.maxLevel)  return false;
    if (this._spAvail() < 1) return false;
    return s.requires.every(([rk, rl]) => this._lvl(rk) >= rl);
  }

  // ── Header ────────────────────────────────────────────────────────────────

  _drawHeader(px, py, pw) {
    const avail = this._spAvail();
    const spent = this._spSpent();
    const total = this._spTotal();

    const t1 = this.add.text(px + 20, py + 17, 'ДЕРЕВО СПОСОБНОСТЕЙ',
      { ...TF, fontSize: '18px', color: '#4dd0e1' }).setDepth(10);

    const spClr = avail > 0 ? '#66cc88' : '#557799';
    const t2 = this.add.text(px + pw / 2, py + 20,
      `Очки умений: ${avail}  (потрачено ${spent} / ${total})`,
      { ...TF, fontSize: '13px', color: spClr }).setOrigin(0.5, 0).setDepth(10);

    // Respeck button
    const rbg = this.add.rectangle(px + pw - 90, py + 28, 150, 30, 0x130610)
      .setStrokeStyle(1, 0x553366, 0.8).setDepth(10).setInteractive({ useHandCursor: true });
    const rtxt = this.add.text(px + pw - 90, py + 28, '🔄 СБРОС SP',
      { ...TFS, fontSize: '12px', color: '#cc88bb' }).setOrigin(0.5).setDepth(11);
    rbg.on('pointerover', () => rbg.setFillStyle(0x200a20));
    rbg.on('pointerout',  () => rbg.setFillStyle(0x130610));
    rbg.on('pointerdown', () => this._showRespeckModal());

    // Divider line
    const dg = this.add.graphics().setDepth(10);
    dg.lineStyle(1, 0x162030, 1);
    dg.strokeLineShape(new Phaser.Geom.Line(px + 8, py + 54, px + pw - 8, py + 54));

    // Close hint
    const th = this.add.text(px + pw - 12, py + 16, '[ K / ESC ]',
      { ...TFS, fontSize: '10px', color: '#22333f' }).setOrigin(1, 0).setDepth(10);

    this._objs.push(t1, t2, rbg, rtxt, dg, th);
  }

  // ── Branch tree ───────────────────────────────────────────────────────────

  _drawBranches(px, py, pw, ph) {
    const HEADER_H   = 58;   // space for title + divider
    const ACTIONBAR_H = 72;  // action bar at bottom
    const treeAreaY  = py + HEADER_H;
    const treeAreaH  = ph - HEADER_H - ACTIONBAR_H;

    const bw  = Math.floor((pw - 16) / 3);
    const BRANCHES = ['combat', 'engineering', 'trading'];

    // rowH based on engineering (deepest: 6 rows = 5 gaps + 1 node)
    // tree start y = treeAreaY + 36 (branch label height)
    // total height = nodeH + 5*rowH ≤ treeAreaH - 36
    const nodeH = 64;
    const rowH  = Math.floor((treeAreaH - 36 - nodeH) / 5);

    BRANCHES.forEach((branch, ci) => {
      const bx  = px + 8 + ci * bw;
      const bcx = bx + bw / 2;
      const bm  = BRANCH_META[branch];

      // Branch header
      const hdr = this.add.text(bcx, treeAreaY + 10, bm.label,
        { ...TF, fontSize: '13px', color: bm.color }).setOrigin(0.5, 0).setDepth(10);
      this._objs.push(hdr);

      // Compute layout
      const startY = treeAreaY + 36;
      const layout = layoutFor(branch, bcx, startY, rowH);

      // Draw edges behind nodes
      this._drawEdges(layout, branch);

      // Draw nodes
      for (const [key, pos] of Object.entries(layout)) {
        this._drawNode(key, pos.x, pos.y, bw, nodeH);
      }
    });
  }

  _drawEdges(layout, branch) {
    const eg = this.add.graphics().setDepth(8);
    this._objs.push(eg);
    const bm = BRANCH_META[branch];
    const nHalf = 32; // half node height for edge attachment

    for (const s of SKILLS_DEF.filter(s => s.branch === branch)) {
      for (const [reqKey] of s.requires) {
        const from = layout[reqKey];
        const to   = layout[s.key];
        if (!from || !to) continue;

        const parentLvl  = this._lvl(reqKey);
        const childState = this._nodeState(s.key);
        let color = 0x101820, alpha = 0.7;
        if (parentLvl > 0 && childState === 'unlocked') {
          color = bm.hex; alpha = 0.75;
        } else if (parentLvl > 0) {
          color = bm.hex; alpha = 0.3;
        }

        eg.lineStyle(1.5, color, alpha);
        eg.beginPath();
        eg.moveTo(from.x, from.y + nHalf);
        eg.lineTo(to.x,   to.y   - nHalf);
        eg.strokePath();
      }
    }
  }

  _drawNode(key, cx, cy, bw, nodeH) {
    const s     = SKILL_MAP[key];
    const state = this._nodeState(key);
    const lv    = this._lvl(key);
    const bm    = BRANCH_META[s.branch];

    // Node width: full-width nodes are narrower, forked nodes slightly smaller
    const nw = Math.min(128, Math.floor(bw * 0.72));

    let fillHex = 0x080c14, borderHex = 0x141e2a, borderAlpha = 0.9;
    let nameClr = '#2a3a44', starsClr = '#1a2a35';

    if (state === 'unlocked') {
      fillHex = bm.fill || 0x0a1820;
      borderHex = bm.hex; borderAlpha = 1.0;
      nameClr = bm.color; starsClr = '#ffcc44';
    } else if (state === 'available') {
      fillHex = 0x0c1420;
      borderHex = bm.hex; borderAlpha = 0.45;
      nameClr = '#4a6a7a'; starsClr = '#2a3a44';
    } else if (state === 'available_no_sp') {
      fillHex = 0x0a1018;
      borderHex = bm.hex; borderAlpha = 0.25;
      nameClr = '#2e4a55'; starsClr = '#1a2a35';
    }

    const ng = this.add.graphics().setDepth(12);
    ng.fillStyle(fillHex, 1);
    ng.fillRoundedRect(cx - nw / 2, cy - nodeH / 2, nw, nodeH, 5);
    ng.lineStyle(state === 'locked' ? 1 : 1.5, borderHex, borderAlpha);
    ng.strokeRoundedRect(cx - nw / 2, cy - nodeH / 2, nw, nodeH, 5);
    this._objs.push(ng);

    // Name text
    const nt = this.add.text(cx, cy - 18, s.nameRu,
      { ...TFS, fontSize: '11px', color: nameClr, wordWrap: { width: nw - 10 }, align: 'center' })
      .setOrigin(0.5, 0).setDepth(13);
    this._objs.push(nt);

    // Stars  ★ filled / ☆ empty
    const stars = '★'.repeat(lv) + '☆'.repeat(s.maxLevel - lv);
    const st = this.add.text(cx, cy + 8, stars,
      { ...TFS, fontSize: '11px', color: starsClr, letterSpacing: 1 })
      .setOrigin(0.5, 0).setDepth(13);
    this._objs.push(st);

    // Active badge + icon, or lock icon
    if (state === 'locked') {
      const lt = this.add.text(cx + nw / 2 - 4, cy - nodeH / 2 + 4, '🔒',
        { fontSize: '9px' }).setOrigin(1, 0).setDepth(13);
      this._objs.push(lt);
    } else if (s.type === 'active') {
      const it = this.add.text(cx - nw / 2 + 5, cy - nodeH / 2 + 4, s.icon || '⚡',
        { fontSize: '11px' }).setOrigin(0, 0).setDepth(13);
      this._objs.push(it);
      // Check if on action bar
      const onBar = (this._gs.actionBar || []).includes(key);
      if (onBar) {
        const bt = this.add.text(cx + nw / 2 - 4, cy - nodeH / 2 + 4, '📌',
          { fontSize: '9px' }).setOrigin(1, 0).setDepth(13);
        this._objs.push(bt);
      }
    }

    // Invisible hit zone
    const hit = this.add.rectangle(cx, cy, nw, nodeH, 0x000000, 0).setDepth(14)
      .setInteractive({ useHandCursor: state !== 'locked' });
    this._objs.push(hit);
    if (state !== 'locked') {
      hit.on('pointerover', () => { ng.setAlpha(0.75); });
      hit.on('pointerout',  () => { ng.setAlpha(1); });
      hit.on('pointerdown', (ptr) => {
        ptr.event.stopPropagation();
        this._showTooltip(key, cx, cy);
      });
    }
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────

  _closeTooltip() {
    this._tooltipObjs.forEach(o => o?.destroy());
    this._tooltipObjs = [];
    this._selectedKey = null;
  }

  _showTooltip(key, nx, ny) {
    this._closeTooltip();
    this._selectedKey = key;

    const s     = SKILL_MAP[key];
    const lv    = this._lvl(key);
    const state = this._nodeState(key);
    const canUp = this._canUpgrade(key);
    const bm    = BRANCH_META[s.branch];
    const { px, py, pw, ph } = this._p;

    const tw = 270, th = Math.min(320, ph * 0.5);
    const DEPTH = 50;

    // Position: right of node, clamped within panel
    let tx = nx + 68;
    if (tx + tw > px + pw - 6) tx = nx - tw - 68;
    tx = Math.max(px + 4, Math.min(tx, px + pw - tw - 4));
    let ty = ny - th / 2;
    ty = Math.max(py + 60, Math.min(ty, py + ph - th - 6));

    const created = this._tooltipObjs;

    // Background
    const bg = this.add.graphics().setDepth(DEPTH);
    bg.fillStyle(0x040810, 0.98);
    bg.fillRoundedRect(tx, ty, tw, th, 7);
    bg.lineStyle(1.5, bm.hex, 0.85);
    bg.strokeRoundedRect(tx, ty, tw, th, 7);
    created.push(bg);

    let cy = ty + 14;

    // Title
    const ico  = s.type === 'active' ? (s.icon || '⚡') + ' ' : '';
    const t1   = this.add.text(tx + 12, cy, `${ico}${s.nameRu}`,
      { ...TF, fontSize: '14px', color: bm.color }).setDepth(DEPTH + 1);
    created.push(t1); cy += 20;

    const typeLabel = s.type === 'active' ? 'АКТИВНЫЙ' : 'ПАССИВНЫЙ';
    const t2 = this.add.text(tx + 12, cy, typeLabel,
      { ...TFS, fontSize: '10px', color: '#334455' }).setDepth(DEPTH + 1);
    created.push(t2); cy += 14;

    // Divider
    const dg = this.add.graphics().setDepth(DEPTH + 1);
    dg.lineStyle(1, 0x182838, 1);
    dg.strokeLineShape(new Phaser.Geom.Line(tx + 6, cy, tx + tw - 6, cy));
    created.push(dg); cy += 8;

    // Level
    const stars = '★'.repeat(lv) + '☆'.repeat(s.maxLevel - lv);
    const t3 = this.add.text(tx + 12, cy,
      `Уровень: ${lv} / ${s.maxLevel}  ${stars}`,
      { ...TFS, fontSize: '12px', color: '#6a8a9a' }).setDepth(DEPTH + 1);
    created.push(t3); cy += 18;

    // Current effect
    if (lv > 0) {
      const te = this.add.text(tx + 12, cy, `Эффект: ${s.effects[lv - 1]}`,
        { ...TFS, fontSize: '11px', color: '#aaccdd', wordWrap: { width: tw - 24 } }).setDepth(DEPTH + 1);
      created.push(te); cy += te.height + 4;
    }

    // Next level preview
    if (lv < s.maxLevel) {
      const nc  = canUp ? '#66aa44' : '#334455';
      const nlt = this.add.text(tx + 12, cy, `Ур.${lv + 1}: ${s.effects[lv]}`,
        { ...TFS, fontSize: '11px', color: nc, wordWrap: { width: tw - 24 } }).setDepth(DEPTH + 1);
      created.push(nlt); cy += nlt.height + 4;
    }

    // Requirements
    if (s.requires.length > 0) {
      cy += 4;
      const tr = this.add.text(tx + 12, cy, 'Требует:',
        { ...TFS, fontSize: '10px', color: '#2a3a44' }).setDepth(DEPTH + 1);
      created.push(tr); cy += 14;
      for (const [rk, rl] of s.requires) {
        const rs  = SKILL_MAP[rk];
        const met = this._lvl(rk) >= rl;
        const tc  = met ? '#44aa66' : '#884444';
        const tm  = this.add.text(tx + 18, cy,
          `${met ? '✓' : '✗'} ${rs.nameRu}  ${this._lvl(rk)}/${rl}`,
          { ...TFS, fontSize: '10px', color: tc }).setDepth(DEPTH + 1);
        created.push(tm); cy += 13;
      }
    }

    cy += 8;

    // Upgrade button
    if (lv < s.maxLevel) {
      const btnBg = this.add.rectangle(tx + tw / 2, cy + 16, tw - 20, 30,
        canUp ? 0x0a2010 : 0x0a0e12)
        .setStrokeStyle(1, canUp ? 0x44aa55 : 0x1a2a30, canUp ? 0.9 : 0.5)
        .setDepth(DEPTH + 1).setInteractive({ useHandCursor: canUp });
      const btnTxt = this.add.text(tx + tw / 2, cy + 16,
        canUp ? `▲ Изучить  (1 SP)` : lv === 0 ? '🔒 Не выполнены требования' : `▲ Изучить  (нет SP)`,
        { ...TFS, fontSize: '12px', color: canUp ? '#66cc77' : '#334455' })
        .setOrigin(0.5).setDepth(DEPTH + 2);
      if (canUp) {
        btnBg.on('pointerover', () => btnBg.setFillStyle(0x103018));
        btnBg.on('pointerout',  () => btnBg.setFillStyle(0x0a2010));
        btnBg.on('pointerdown', (ptr) => {
          ptr.event.stopPropagation();
          this._upgradeSkill(key);
        });
      }
      created.push(btnBg, btnTxt); cy += 36;
    } else {
      const maxTxt = this.add.text(tx + tw / 2, cy + 14, '✓ МАКСИМАЛЬНЫЙ УРОВЕНЬ',
        { ...TFS, fontSize: '11px', color: bm.color }).setOrigin(0.5).setDepth(DEPTH + 1);
      created.push(maxTxt); cy += 30;
    }

    // Action bar assignment (active skills only)
    if (s.type === 'active' && lv > 0) {
      const bar   = this._gs.actionBar || [];
      const onBar = bar.includes(key);
      const slotIdx = bar.indexOf(key);

      const abg = this.add.rectangle(tx + tw / 2, cy + 16, tw - 20, 30,
        onBar ? 0x0a1828 : 0x100a28)
        .setStrokeStyle(1, onBar ? 0x335588 : 0x554488, 0.9)
        .setDepth(DEPTH + 1).setInteractive({ useHandCursor: true });
      const lbl  = onBar ? `📌 На панели (слот ${slotIdx < 9 ? slotIdx + 1 : 0})` : '📌 На панель действий';
      const abtxt = this.add.text(tx + tw / 2, cy + 16, lbl,
        { ...TFS, fontSize: '12px', color: onBar ? '#6688bb' : '#8866cc' })
        .setOrigin(0.5).setDepth(DEPTH + 2);
      abg.on('pointerover', () => abg.setFillStyle(onBar ? 0x0c2030 : 0x180f38));
      abg.on('pointerout',  () => abg.setFillStyle(onBar ? 0x0a1828 : 0x100a28));
      abg.on('pointerdown', (ptr) => {
        ptr.event.stopPropagation();
        if (onBar) this._removeFromBar(key); else this._assignToBar(key);
      });
      created.push(abg, abtxt);
    }
  }

  // ── Skill actions ─────────────────────────────────────────────────────────

  _upgradeSkill(key) {
    if (!this._canUpgrade(key)) return;
    this._gs.skillLevels[key] = (this._gs.skillLevels[key] || 0) + 1;
    this._redraw();
    // Re-show tooltip for the upgraded skill (positions may shift slightly, find node)
    // Simple approach: let user re-click. Tooltip is cleared by _redraw().
  }

  _assignToBar(key) {
    const bar = this._gs.actionBar;
    if (bar.includes(key)) return;
    const emptyIdx = bar.findIndex(s => s === null);
    if (emptyIdx !== -1) {
      bar[emptyIdx] = key;
    } else {
      bar.shift(); bar.push(key); // push off oldest
    }
    this._redraw();
  }

  _removeFromBar(key) {
    const bar = this._gs.actionBar;
    const idx = bar.indexOf(key);
    if (idx !== -1) bar[idx] = null;
    this._redraw();
  }

  // ── Action bar UI ─────────────────────────────────────────────────────────

  _drawActionBarUI(px, py, pw, ph) {
    const bar   = this._gs.actionBar || Array(10).fill(null);
    const barY  = py + ph - 64;
    const slotW = 48, slotH = 48, gap = 4;
    const totalW = 10 * slotW + 9 * gap;
    const startX = px + pw / 2 - totalW / 2;

    const lbl = this.add.text(px + 14, barY - 16, 'ПАНЕЛЬ ДЕЙСТВИЙ  ( 1 – 0 )  ·  ПКМ — снять скилл',
      { ...TFS, fontSize: '10px', color: '#223344' }).setDepth(10);
    this._objs.push(lbl);

    for (let i = 0; i < 10; i++) {
      const sx  = startX + i * (slotW + gap);
      const sy  = barY;
      const key = bar[i];
      const s   = key ? SKILL_MAP[key] : null;

      const sg = this.add.graphics().setDepth(10);
      sg.fillStyle(0x050910, 1);
      sg.fillRoundedRect(sx, sy, slotW, slotH, 4);
      sg.lineStyle(1, s ? 0x223344 : 0x0e1822, 0.9);
      sg.strokeRoundedRect(sx, sy, slotW, slotH, 4);
      this._objs.push(sg);

      // Hotkey label (top-left of slot)
      const hkLabel = i < 9 ? `${i + 1}` : '0';
      const hkt = this.add.text(sx + 3, sy + 2, hkLabel,
        { ...TFS, fontSize: '8px', color: '#1a2a35' }).setDepth(11);
      this._objs.push(hkt);

      if (s) {
        const bm = BRANCH_META[s.branch];
        // Icon
        const it = this.add.text(sx + slotW / 2, sy + slotH / 2 - 6, s.icon || '⚡',
          { fontSize: '16px' }).setOrigin(0.5).setDepth(11);
        // Short name
        const nt = this.add.text(sx + slotW / 2, sy + slotH - 11, s.nameRu.split(' ')[0].slice(0, 8),
          { ...TFS, fontSize: '7px', color: bm.color }).setOrigin(0.5, 0).setDepth(11);
        this._objs.push(it, nt);

        // Right-click to remove
        const hit = this.add.rectangle(sx + slotW / 2, sy + slotH / 2, slotW, slotH, 0, 0)
          .setDepth(12).setInteractive({ useHandCursor: true });
        this._objs.push(hit);
        hit.on('pointerdown', (ptr) => {
          if (ptr.rightButtonDown()) { this._gs.actionBar[i] = null; this._redraw(); }
        });
      }
    }
  }

  // ── Respeck modal ─────────────────────────────────────────────────────────

  _showRespeckModal() {
    const { width: W, height: H } = this.scale;
    const cx = W / 2, cy = H / 2;
    const mw = 480, mh = 300;
    const gs = this._gs;
    const spent = this._spSpent();
    const paidCost = PAID_COSTS[Math.min(gs.respeckCount || 0, PAID_COSTS.length - 1)];
    const canPaid  = (gs.starGold || 0) >= paidCost;
    const freeOk   = !gs.freeRespeckUsed;

    const DEPTH = 80;
    const created = [];
    const closeModal = () => created.forEach(o => o?.destroy());

    const dim = this.add.rectangle(cx, cy, W, H, 0x000000, 0.6).setDepth(DEPTH).setInteractive();
    dim.on('pointerdown', closeModal);
    created.push(dim);

    const panel = this.add.rectangle(cx, cy, mw, mh, 0x050810)
      .setStrokeStyle(2, 0x664466, 0.9).setDepth(DEPTH + 1);
    created.push(panel);

    const t1 = this.add.text(cx, cy - mh / 2 + 22, 'СБРОС SKILL POINTS',
      { ...TF, fontSize: '18px', color: '#cc88bb' }).setOrigin(0.5, 0).setDepth(DEPTH + 2);
    const t2 = this.add.text(cx, cy - 56,
      spent > 0 ? `Вернётся очков: ${spent}` : 'Нет потраченных очков',
      { ...TFS, fontSize: '14px', color: '#8a9aaa' }).setOrigin(0.5).setDepth(DEPTH + 2);
    const t3 = this.add.text(cx, cy - 30,
      'Action bar сохранится (переназначьте скиллы заново)',
      { ...TFS, fontSize: '10px', color: '#334455' }).setOrigin(0.5).setDepth(DEPTH + 2);
    created.push(t1, t2, t3);

    // Free respeck
    const fc = freeOk ? '#44aa66' : '#334455';
    const fbg = this.add.rectangle(cx - 120, cy + 30, 200, 38, freeOk ? 0x081a10 : 0x060810)
      .setStrokeStyle(1, freeOk ? 0x44aa55 : 0x1a2a1a, 0.9)
      .setDepth(DEPTH + 2).setInteractive({ useHandCursor: freeOk });
    const ftxt = this.add.text(cx - 120, cy + 30,
      freeOk ? '🎁 Бесплатный сброс' : '🎁 Доступен в пятницу',
      { ...TFS, fontSize: '13px', color: fc }).setOrigin(0.5).setDepth(DEPTH + 3);
    if (freeOk) {
      fbg.on('pointerover', () => fbg.setFillStyle(0x102818));
      fbg.on('pointerout',  () => fbg.setFillStyle(0x081a10));
      fbg.on('pointerdown', (ptr) => {
        ptr.event.stopPropagation();
        gs.freeRespeckUsed = true;
        this._doRespeck(); closeModal();
      });
    }
    created.push(fbg, ftxt);

    // Paid respeck
    const pc2 = canPaid ? '#ddaa44' : '#443333';
    const pbg = this.add.rectangle(cx + 120, cy + 30, 200, 38, canPaid ? 0x1a0e00 : 0x060810)
      .setStrokeStyle(1, canPaid ? 0xaa8844 : 0x222222, 0.9)
      .setDepth(DEPTH + 2).setInteractive({ useHandCursor: canPaid });
    const ptxt = this.add.text(cx + 120, cy + 30, `💎 ${paidCost} ⭐`,
      { ...TFS, fontSize: '13px', color: pc2 }).setOrigin(0.5).setDepth(DEPTH + 3);
    if (canPaid) {
      pbg.on('pointerover', () => pbg.setFillStyle(0x261a00));
      pbg.on('pointerout',  () => pbg.setFillStyle(0x1a0e00));
      pbg.on('pointerdown', (ptr) => {
        ptr.event.stopPropagation();
        gs.starGold    = (gs.starGold    || 0) - paidCost;
        gs.respeckCount = (gs.respeckCount || 0) + 1;
        this._doRespeck(); closeModal();
      });
    }
    created.push(pbg, ptxt);

    // Cancel
    const cbg = this.add.rectangle(cx, cy + 90, 140, 34, 0x0c1420)
      .setStrokeStyle(1, 0x334466, 0.9).setDepth(DEPTH + 2).setInteractive({ useHandCursor: true });
    const ctxt = this.add.text(cx, cy + 90, 'ОТМЕНА',
      { ...TFS, fontSize: '13px', color: '#557799' }).setOrigin(0.5).setDepth(DEPTH + 3);
    cbg.on('pointerover', () => cbg.setFillStyle(0x142030));
    cbg.on('pointerout',  () => cbg.setFillStyle(0x0c1420));
    cbg.on('pointerdown', closeModal);
    created.push(cbg, ctxt);

    // Escalation info
    const esc = this.add.text(cx, cy + mh / 2 - 16,
      'Платная: 50→100→200→400→800 ⭐  ·  Сброс каждую пятницу',
      { ...TFS, fontSize: '9px', color: '#1e2e3a' }).setOrigin(0.5, 1).setDepth(DEPTH + 2);
    created.push(esc);
  }

  _doRespeck() {
    this._gs.skillLevels = {};
    this._redraw();
  }
}
