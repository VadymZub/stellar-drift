import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';
import { itemName, itemStats, itemSellPrice, itemIconKey, SLOT_KEY, creditUpgradeCost, starUpgradeCost, modMult,
         PLASMATE_GOLD_RATE, PLASMATE_PER_SLOT, totalPlasmateInInventory, removePlasmateFromInventory,
         AMMO_ICON, CONSUMABLES, addConsumableToInventory } from '../items.js';
import { SHIPS, SHIP_BY_KEY, purchaseState, shipLevelCost, shipLevelCostGold, SHIP_MAX_LEVEL } from '../ships.js';
import { PERK_MAP, RARITY_COLOR, RARITY_LABEL, rollPerk, perkBonus, creditUpgCost, starUpgCost, PERK_CREDIT_COST, PERK_STAR_COST, PERK_REROLL_BASE } from '../perks.js';
import { prerenderTex } from '../utils/prerenderTex.js';
import { rollBoard, rollConnector, CONNECTOR_SHAPES, getPoweredNodes, getBoardEffects, STAT_META, BUF_STATS, boardTierLabel, boardPreviewStats, bfsPowered, placedCount, effectiveMask, rotateMask, edgeSides, activeNodes, activeEdges } from '../boards.js';

// Гараж (хоткей G). Два таба:
//  • КОРАБЛИ — витрина всего модельного ряда. Купленные активны, остальные серые,
//    но кликабельны: видно описание + требования (level-gate, цена, гейт престижа).
//    Это «морковка» — стимул качаться по уровню и копить на корабль.
//  • ОБОРУДОВАНИЕ — слоты оружие/щит активного корабля + склад (надеть/снять/продать).
// Состояние таба и выбранного корабля живёт на GameScene (переживает scene.restart).
export default class GarageScene extends Phaser.Scene {
  constructor() { super('GarageScene'); }

  O(s, c) { return { fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }
  F(s, c) { return { fontFamily: 'Inter, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }

  create() {
    this.modal = null;
    this.gs = this.scene.get('GameScene');
    const W = this.scale.width, H = this.scale.height;

    // Если деферрованные асеты ещё не загружены — загрузить немедленно
    if (!this.textures.exists('bg_garage')) this.gs._bgPreloadDeferred?.();

    if (this.textures.exists('bg_garage')) {
      const _bg = this.add.image(W / 2, H / 2, 'bg_garage');
      _bg.setScale(Math.max(W / _bg.width, H / _bg.height)).setAlpha(0.8);
    } else {
      this.add.rectangle(0, 0, W, H, 0x060d18, 1).setOrigin(0);
    }

    const pw = Math.min(960, W - 40), ph = Math.min(720, H - 40);
    const px = (W - pw) / 2, py = (H - ph) / 2;
    this.box = { px, py, pw, ph };
    const g = this.add.graphics();
    g.fillStyle(0x080d18, 0.88); g.fillRoundedRect(px, py, pw, ph, 12);
    g.lineStyle(2, COLORS.primary, 0.75); g.strokeRoundedRect(px, py, pw, ph, 12);
    // Окремий бордер поверх cover-смуг (cover strips depth=12, border depth=15)
    const border = this.add.graphics().setDepth(15);
    border.lineStyle(2, COLORS.primary, 0.75); border.strokeRoundedRect(px, py, pw, ph, 12);

    this.add.text(px + 24, py + 16, i18n.t('garage.title'), this.O('22px', '#4dd0e1')).setDepth(14);
    this.add.text(px + pw - 20, py + 55, 'G / ESC', this.F('12px', '#7e9398')).setOrigin(1, 0).setDepth(14);

    // ── Табы (3 вкладки) ──
    // Migrate old 4-tab state
    if (this.gs.garageTab === 'upgrade' || this.gs.garageTab === 'perks') this.gs.garageTab = 'upg';
    this.tab = this.gs.garageTab || 'ships';

    const tabSpan = pw / 4;
    this.tabBtn(px + tabSpan * 0.5, py + 20, 'garage.tab_ships',  'ships');
    this.tabBtn(px + tabSpan * 1.5, py + 20, 'garage.tab_equip',  'equip');
    this.tabBtn(px + tabSpan * 2.5, py + 20, 'garage.upg_tab',    'upg');
    this.tabBtn(px + tabSpan * 3.5, py + 20, 'garage.tab_boards', 'boards');

    if      (this.tab === 'ships')  this.renderShipsTab();
    else if (this.tab === 'equip')  this.renderEquipTab();
    else if (this.tab === 'boards') this.renderBoardsTab();
    else                            this.renderUpgradePerksTab();

    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());
  }

  tabBtn(x, y, key, id) {
    const active = this.tab === id;
    const label = this.add.text(x, y, i18n.t(key), this.O('14px', active ? '#4dd0e1' : '#7e9398'))
      .setInteractive({ useHandCursor: true }).setDepth(14);
    if (active) this.add.rectangle(x, y + 22, label.width, 2, COLORS.primary).setOrigin(0, 0).setDepth(14);
    label.on('pointerdown', () => { this.gs.garageTab = id; this.scene.restart(); });
  }

  // ════════════════ ТАБ «КОРАБЛИ» — витрина модельного ряда ════════════════
  renderShipsTab() {
    const { px, py, pw, ph } = this.box;
    const sel = SHIP_BY_KEY[this.gs.garageSel] ? this.gs.garageSel : this.gs.activeShip;
    this.gs.garageSel = sel;

    // Витрина 3×3 слева — крупные плитки с геройским артом
    const cw = 200, ch = 152, gap = 12, lx = px + 18, gy = py + 64;
    SHIPS.forEach((ship, i) => {
      const c = i % 3, r = Math.floor(i / 3);
      this.shipCard(lx + c * (cw + gap), gy + r * (ch + gap), cw, ch, ship, ship.key === sel);
    });

    // Панель описания справа
    const rx = lx + 3 * (cw + gap) + 10;
    const rw = px + pw - rx - 16;
    this.shipDetail(rx, py + 64, rw, ph - 92, SHIP_BY_KEY[sel]);
  }

  shipCard(x, y, w, h, ship, selected) {
    const gs = this.gs;
    const owned = gs.ownedShips.has(ship.key);
    const active = gs.activeShip === ship.key;
    const ps = purchaseState(ship, gs);
    const buyable = ps.ok;
    const locked = !owned && !buyable;

    const border = active ? COLORS.amber : (owned ? COLORS.primary : (buyable ? COLORS.emerald : 0x33484f));
    const rect = this.add.rectangle(x, y, w, h, locked ? 0x0c1118 : 0x12222e, 0.96).setOrigin(0, 0)
      .setStrokeStyle(selected ? 3 : (active || owned || buyable ? 2 : 1), border, locked ? 0.8 : 0.9)
      .setInteractive({ useHandCursor: true });
    rect.on('pointerdown', () => { this.gs.garageSel = ship.key; this.scene.restart(); });

    // Inner glow для активного корабля
    if (active) {
      const ig = this.add.graphics();
      ig.fillStyle(COLORS.amber, 0.06); ig.fillRect(x + 1, y + 1, w - 2, h - 2);
    }

    // Hero art (garageKey) — крупное изображение в карточке
    const heroBox = Math.round(h * 0.66);
    const _cardMult = { stiletto: 1.2, wisp: 1.0, anvil: 1.0 };
    const imgBox = Math.round(heroBox * (_cardMult[ship.key] ?? 1.3));
    const img = this.shipImg(x + w / 2, y + Math.round(heroBox / 2) + 8, imgBox, ship);
    if (locked) img.setTint(0x44525a).setAlpha(0.55);

    this.add.text(x + w / 2, y + heroBox + 14, i18n.t(ship.nameKey),
      this.O('13px', locked ? '#6c8086' : '#cfe9ee')).setOrigin(0.5, 0);

    // Статус-строка внизу карточки
    let badge, color;
    if (active) { badge = i18n.t('garage.active'); color = '#ffb74d'; }
    else if (owned) { badge = i18n.t('garage.owned'); color = '#4dd0e1'; }
    else if (buyable) { badge = this.priceStr(ship); color = '#66bb6a'; }
    else if (gs.pilotLevel < ship.levelGate) { badge = `Lv${ship.levelGate}`; color = '#7e9398'; }
    else { badge = '🔒'; color = '#7e9398'; }
    this.add.text(x + w / 2, y + h - 16, badge, this.F('11px', color)).setOrigin(0.5, 0);
  }

// Картинка корабля для Гаража: геройский арт (garageKey) если есть, иначе игровой спрайт.
  // Вписываем в box с сохранением пропорций (арт не квадратный). Возвращает image для тинта.
  shipImg(cx, cy, box, ship) {
    const key = ship.garageKey || ship.key;
    const src = this.textures.get(key).getSourceImage();
    const scale = box / Math.max(src.width, src.height);
    const dw = Math.round(src.width  * scale);
    const dh = Math.round(src.height * scale);
    return this.add.image(cx, cy, prerenderTex(this, key, dw, dh)).setDisplaySize(dw, dh);
  }

  priceStr(ship) {
    if (ship.price === 0) return '—';
    return ship.currency === 'star' ? `${ship.price} ⭐` : `${ship.price.toLocaleString('ru')} кр`;
  }

  shipDetail(x, y, w, h, ship) {
    const gs = this.gs;
    const g = this.add.graphics();
    g.fillStyle(0x09131c, 0.9); g.fillRoundedRect(x, y, w, h, 10);
    g.lineStyle(1, COLORS.primary, 0.25); g.strokeRoundedRect(x, y, w, h, 10);

    const owned = gs.ownedShips.has(ship.key);
    const active = gs.activeShip === ship.key;
    const locked = !owned && !purchaseState(ship, gs).ok;

    const cx = x + w / 2;
    const _heroBox = { stiletto: 187, wisp: 156, anvil: 156, drover: 223, phantom: 223, argosy: 223, helion: 223, drifter: 223 };
    const im = this.shipImg(cx, y + 88, _heroBox[ship.key] ?? 203, ship);
    if (locked) im.setTint(0x55636b).setAlpha(0.7);
    this.add.text(cx, y + 176, i18n.t(ship.nameKey), this.O('20px', '#cfe9ee')).setOrigin(0.5, 0);
    this.add.text(cx, y + 204, `${i18n.t('garage.tier')} ${ship.tier}`, this.F('12px', '#ffb74d')).setOrigin(0.5, 0);

    // Описание
    this.add.text(x + 18, y + 230, i18n.t(ship.descKey),
      { ...this.F('13px', '#9fb3b8'), wordWrap: { width: w - 36 }, lineSpacing: 4 });

    // Статы
    const sy = y + 300;
    const stat = (row, label, val) => {
      this.add.text(x + 18, sy + row * 22, label, this.F('12px', '#7e9398'));
      this.add.text(x + w - 18, sy + row * 22, val, this.F('12px', '#cfe9ee')).setOrigin(1, 0);
    };
    stat(0, i18n.t('garage.hull'), `${ship.hullMax}`);
    stat(1, i18n.t('garage.shield_base'), `${ship.shieldBase}`);
    stat(2, i18n.t('garage.speed'), `${ship.baseSpeed}`);
    stat(3, i18n.t('garage.slots'), `${ship.wSlots}⚔ / ${ship.sSlots}🛡 / ${ship.eSlots || 0}🚀 / ${ship.aSlots || 3}📦`);

    // Пассивные бонусы корабля (cargoBonus / passives / activeSkill)
    let pRow = 4;
    const hasBonuses = ship.cargoBonus || ship.passives || ship.activeSkill;
    if (hasBonuses) {
      const sepY = sy + pRow * 22 + 4;
      const sepG = this.add.graphics();
      sepG.lineStyle(1, 0x1e3a50, 0.7);
      sepG.beginPath(); sepG.moveTo(x + 18, sepY); sepG.lineTo(x + w - 18, sepY); sepG.strokePath();
      this.add.text(x + 18, sepY + 6, i18n.t('garage.passives'), this.F('10px', '#4a6678'));
      pRow++;
      if (ship.cargoBonus) {
        stat(pRow++, i18n.t('garage.cargo_bonus'), `+${ship.cargoBonus} ${i18n.t('garage.slots_unit')}`);
      }
      if (ship.passives?.shieldBonus) {
        stat(pRow++, i18n.t('garage.passive_shield'), `+${Math.round(ship.passives.shieldBonus * 100)}%`);
      }
      if (ship.passives?.shieldPerAlly) {
        stat(pRow++, i18n.t('garage.passive_shield_ally'), `+${Math.round(ship.passives.shieldPerAlly * 100)}% / ${i18n.t('garage.per_ally')}`);
      }
      if (ship.passives?.damageBonus) {
        stat(pRow++, i18n.t('garage.passive_damage'), `+${Math.round(ship.passives.damageBonus * 100)}%`);
      }
      if (ship.passives?.hullRegen) {
        stat(pRow++, i18n.t('garage.passive_hull_regen'), `${ship.passives.hullRegen} HP/с`);
      }
      if (ship.passives?.evasionBonus) {
        stat(pRow++, i18n.t('garage.passive_evasion'), `+${Math.round(ship.passives.evasionBonus * 100)}%`);
      }
      if (ship.activeSkill) {
        stat(pRow++, i18n.t('garage.active_skill'), i18n.t(ship.activeSkill.nameKey));
      }
    }

    // Corp affinity bonus
    if (ship.corpAffinity) {
      const isActive = ship.corpAffinity === gs.playerCorp;
      const bonusLabels = {
        helios: '+5% скорость (Гелиос)',
        karax:  '+5% корпус (Каракс)',
        tides:  '+5% щит / +3% реген (Тидес)',
      };
      const label = bonusLabels[ship.corpAffinity];
      const color = isActive ? '#ffb74d' : '#2a4a5a';
      const sepY = sy + pRow * 22 + 4;
      const sepG = this.add.graphics();
      sepG.lineStyle(1, 0x1e3a50, 0.7);
      sepG.beginPath(); sepG.moveTo(x + 18, sepY); sepG.lineTo(x + w - 18, sepY); sepG.strokePath();
      this.add.text(x + 18, sepY + 6, isActive ? '★ ' + label : label,
        this.F('11px', color));
      pRow++;
    }

    // Требования / действие
    const ay = y + h - 88;
    this.renderAction(x, ay, w, ship);
  }

  renderAction(x, ay, w, ship) {
    const gs = this.gs;
    const cx = x + w / 2;
    const owned = gs.ownedShips.has(ship.key);
    const active = gs.activeShip === ship.key;

    // Строка требований (level-gate / цена / гейт престижа)
    const reqLine = (txt, color) => this.add.text(cx, ay, txt, { ...this.F('12px', color), align: 'center', wordWrap: { width: w - 36 } }).setOrigin(0.5, 0);

    if (active) { this.bigBtn(cx, ay + 28, 0x5d4037, i18n.t('garage.active'), null); return; }
    if (owned) { this.bigBtn(cx, ay + 28, 0x2e7d32, i18n.t('garage.select'), () => this.selectShip(ship)); return; }

    const ps = purchaseState(ship, gs);
    if (ps.ok) {
      reqLine(`${i18n.t('garage.req_level')} ${ship.levelGate}`, '#66bb6a');
      this.bigBtn(cx, ay + 28, 0x2e7d32, `${i18n.t('garage.buy')}  ${this.priceStr(ship)}`, () => this.buyShip(ship));
      return;
    }
    // Заблокирован — показываем причину, кнопка серая неактивная
    let reason;
    if (ps.reasonKey === 'garage.prestige_gate') reason = i18n.t('garage.prestige_gate');
    else if (ps.reasonKey === 'garage.need_level') reason = i18n.t('garage.need_level', { lvl: ship.levelGate });
    else reason = `${i18n.t('garage.cant_afford')} (${this.priceStr(ship)})`;
    reqLine(reason, '#ef9a9a');
    this.bigBtn(cx, ay + 28, 0x263238, i18n.t('garage.locked'), null);
  }

  bigBtn(cx, y, color, label, cb) {
    const bw = 220, bh = 42, bx = cx - bw / 2;
    const r = this.add.rectangle(bx, y, bw, bh, color, cb ? 0.95 : 0.5).setOrigin(0, 0)
      .setStrokeStyle(1, 0xffffff, cb ? 0.2 : 0.08);
    this.add.text(cx, y + bh / 2, label, this.O('15px', cb ? '#ffffff' : '#90a4ae')).setOrigin(0.5);
    if (cb) { r.setInteractive({ useHandCursor: true }).on('pointerdown', cb); }
  }

  buyShip(ship) {
    const gs = this.gs;
    if (!purchaseState(ship, gs).ok) return;
    if (ship.currency === 'star') gs.starGold -= ship.price; else gs.credits -= ship.price;
    gs.ownedShips.add(ship.key);
    gs.log(i18n.t('garage.bought', { ship: i18n.t(ship.nameKey) }));
    gs._saveState?.();
    this.selectShip(ship);
  }

  // Cargo max for a hypothetical active ship (used during overflow check before switch)
  _cargoMaxForShip(shipKey) {
    const gs = this.gs;
    const sl = gs.skillLevels?.cargo_expand || 0;
    const drover = shipKey === 'drover' ? 4 : 0;
    const prem   = gs.premium ? 8 : 0;
    return 8 + drover + sl * (sl + 1) + prem;
  }

  selectShip(ship) {
    const gs = this.gs, p = gs.player;
    const newShip = SHIP_BY_KEY[ship.key];

    // ── Collect overflow items (slots beyond new ship's limits) ──────────
    const eq = gs.equipped || {};
    // Order: weapon first (priority), then shield, then engine
    const SLOT_TYPES = [
      { type: 'weapon', limit: newShip.wSlots },
      { type: 'shield', limit: newShip.sSlots },
      { type: 'engine', limit: newShip.eSlots || 0 },
    ];
    const overflow = [];
    for (const { type, limit } of SLOT_TYPES) {
      const arr = eq[type] || [];
      for (let i = limit; i < arr.length; i++) {
        if (arr[i] != null) overflow.push({ type, idx: i, item: arr[i] });
      }
    }

    if (overflow.length > 0) {
      const newCargoMax = this._cargoMaxForShip(ship.key);
      const cargoFree   = newCargoMax - (gs.inventory || []).length;
      const whFree      = this._whMax() - (gs.warehouse || []).length;

      if (overflow.length > cargoFree + whFree) {
        this._showNoSpaceModal(overflow.length, cargoFree + whFree);
        return;
      }

      // Move overflow in priority order (weapons → shields → engines)
      gs.inventory  = gs.inventory  || [];
      gs.warehouse  = gs.warehouse  || [];
      for (const { type, idx, item } of overflow) {
        if (gs.inventory.length < newCargoMax) {
          gs.inventory.push(item);
        } else {
          gs.warehouse.push(item);
        }
        eq[type][idx] = null;
      }
    }

    gs.activeShip = ship.key;
    gs.garageSel  = ship.key;
    p.applyShip(newShip);
    p.recomputeStats();
    p.shield = p.maxShield;

    // Resize ammoSlots to match new ship's aSlots count
    const _newASlots = newShip.aSlots || 3;
    gs.ammoSlots = gs.ammoSlots || [];
    while (gs.ammoSlots.length < _newASlots) gs.ammoSlots.push({ type: null, count: 0 });
    if (gs.ammoSlots.length > _newASlots) {
      const excess = gs.ammoSlots.splice(_newASlots);
      for (const s of excess) {
        if (s.type && s.count > 0) addConsumableToInventory(gs.inventory, s.type, s.count, this._cargoMax());
      }
    }

    // Sync action bar slot 0 with new ship's active skill
    gs.actionBar = gs.actionBar || Array(10).fill(null);
    const _ask = ship.activeSkill?.key ?? null;
    if (_ask) {
      if (!gs.actionBar[0] || (gs.actionBar[0] + '').startsWith('ship:')) gs.actionBar[0] = _ask;
    } else if ((gs.actionBar[0] + '').startsWith('ship:')) {
      gs.actionBar[0] = null;
    }

    // Auto-fill empty slots 1-9 with learned active skills
    const _ACTIVE_ORDER = ['overcharge_shot', 'salvo', 'emergency_repair', 'shield_burst', 'stealth_sprint', 'berserker'];
    const _used = new Set(gs.actionBar.filter(Boolean));
    for (const sk of _ACTIVE_ORDER) {
      if ((gs.skillLevels?.[sk] || 0) === 0) continue;
      if (_used.has(sk)) continue;
      const slot = gs.actionBar.findIndex((v, i) => i > 0 && v === null);
      if (slot < 0) break;
      gs.actionBar[slot] = sk;
      _used.add(sk);
    }

    gs.log(i18n.t('garage.switched', { ship: i18n.t(ship.nameKey) }));
    gs._saveState?.();
    this.scene.restart();
  }

  _showNoSpaceModal(needed, free) {
    if (this.modal) this.closeModal();
    const W = this.scale.width, H = this.scale.height;
    const objs = [];
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.6).setOrigin(0).setDepth(100).setInteractive();
    objs.push(dim);

    const mw = 420, mh = 180;
    const panel = this.add.rectangle(W / 2, H / 2, mw, mh, 0x0a0f1a)
      .setStrokeStyle(2, 0xef5350, 0.9).setDepth(101);
    objs.push(panel);

    this.add.text(W / 2, H / 2 - 52, '⚠ СМЕНА КОРАБЛЯ НЕВОЗМОЖНА',
      this.O('14px', '#ef5350')).setOrigin(0.5).setDepth(102);
    this.add.text(W / 2, H / 2 - 20,
      `Предметов для переноса: ${needed}   Свободных мест: ${free}`,
      this.F('13px', '#90a4ae')).setOrigin(0.5).setDepth(102);
    this.add.text(W / 2, H / 2 + 4, 'Освободите трюм или склад и попробуйте снова.',
      this.F('12px', '#607d8b')).setOrigin(0.5).setDepth(102);

    const close = () => { objs.forEach(o => o?.destroy()); this.modal = null; };
    dim.on('pointerdown', close);

    const btn = this.add.rectangle(W / 2, H / 2 + 46, 100, 32, 0x1a0a0a)
      .setStrokeStyle(1, 0xef5350, 0.8).setDepth(102).setInteractive({ useHandCursor: true });
    this.add.text(W / 2, H / 2 + 46, 'ОК', this.O('13px', '#ef5350')).setOrigin(0.5).setDepth(103);
    btn.on('pointerdown', close);
    objs.push(btn);

    this.modal = objs;
  }

  // ════════════════ СКЛАД (в вкладке ОБОРУДОВАНИЕ) ════════════════
  renderWarehouse(x, y, w, h, clipBotH) {
    this._renderSlotGrid(x, y, w, h, this.gs.warehouse || [], this._whMax(), 'warehouse', clipBotH);
  }

  // Универсальная слот-сетка: 5 колонок × N рядов, clip-маска + колесо мыши для скролла.
  // type = 'inventory' (трюм, надеть/продать) | 'warehouse' (склад, → трюм)
  _cargoMax() {
    const gs = this.gs; const sl = gs.skillLevels?.cargo_expand || 0;
    const drover = gs.activeShip === 'drover' ? 4 : 0;
    const prem   = gs.premium ? 8 : 0;
    return 8 + drover + sl * (sl + 1) + prem;
  }
  _whMax() { const gs = this.gs; const sl = gs.skillLevels?.cargo_expand || 0; return 8 + sl * (sl + 1) + (gs.premium ? 8 : 0); }

  // clipBotH: высота нижней полосы-заглушки (null = до низа панели, число = ровно столько)
  _renderSlotGrid(ax, ay, aw, ah, items, maxSlots, type, clipBotH) {
    const gs = this.gs;
    const SZ = 68, GAP = 6, COLS = 4;
    const container = this.add.container(ax, ay);

    // Показываем все предметы, даже если их больше лимита (премиум истёк).
    // Пустые ячейки сверх лимита не рисуем — они исчезают при уборке предмета.
    const displaySlots = Math.max(items.length, maxSlots);

    for (let i = 0; i < displaySlots; i++) {
      const col = i % COLS, row = Math.floor(i / COLS);
      const sx = col * (SZ + GAP), sy = row * (SZ + GAP);
      const item = items[i] || null;
      const overflow = i >= maxSlots; // слот за пределами текущего лимита

      if (!item) {
        if (!overflow) {
          container.add(
            this.add.rectangle(sx, sy, SZ, SZ, 0x0f2035, 0.9).setOrigin(0, 0)
              .setStrokeStyle(1, 0x2a4870, 0.65)
          );
        }
        continue;
      }

      const pDef   = item.perk ? PERK_MAP[item.perk.key] : null;
      const rarHex = pDef ? RARITY_COLOR[pDef.rarity] : null;
      const bdrHex = rarHex ?? (COLORS.primary & 0xffffff);
      const SELL_H = 16, BODY_H = SZ - SELL_H;

      if (type === 'inventory') {
        // Plasmate: exchange for gold instead of equip/sell
        if (item.type === 'plasmate') {
          const box = this.add.rectangle(sx, sy, SZ, BODY_H, 0x0a1a2a, 0.95).setOrigin(0, 0)
            .setStrokeStyle(2, 0x44aacc, 0.8);
          const iconK = itemIconKey(item);
          const iconImg = iconK
            ? this.add.image(sx + SZ / 2, sy + BODY_H / 2 - 5, prerenderTex(this, iconK, 38, 38)).setDisplaySize(38, 38).setOrigin(0.5)
            : null;
          const countTxt = this.add.text(sx + SZ / 2, sy + BODY_H - 10,
            `${item.amount}/${PLASMATE_PER_SLOT}`, this.F('10px', '#88eeff')).setOrigin(0.5);
          const canExch = item.amount >= PLASMATE_GOLD_RATE;
          const strip = this.add.rectangle(sx, sy + BODY_H, SZ, SELL_H,
            canExch ? 0x072030 : 0x0d1018, 0.9).setOrigin(0, 0)
            .setStrokeStyle(1, 0x2a6888, 0.5);
          const stripT = this.add.text(sx + SZ / 2, sy + BODY_H + SELL_H / 2,
            canExch ? '⭐ 500→1' : '— плазмит —',
            this.F('9px', canExch ? '#ffcc44' : '#334455')).setOrigin(0.5);
          if (canExch) {
            strip.setInteractive({ useHandCursor: true });
            strip.on('pointerdown', () => {
              const inv = gs.inventory || [];
              const total = totalPlasmateInInventory(inv);
              const sets  = Math.floor(total / PLASMATE_GOLD_RATE);
              if (sets <= 0) return;
              removePlasmateFromInventory(inv, sets * PLASMATE_GOLD_RATE);
              gs.starGold = (gs.starGold || 0) + sets;
              gs.log(i18n.t('log.plasmate_exchanged', { amount: sets * PLASMATE_GOLD_RATE, gold: sets }));
              this.scene.restart();
            });
          }
          const els = [box, countTxt, strip, stripT];
          if (iconImg) els.push(iconImg);
          container.add(els);
          if (overflow) {
            const dg = this.add.graphics();
            dg.fillStyle(0xffa000, 0.85); dg.fillTriangle(sx, sy, sx + 14, sy, sx, sy + 14);
            container.add(dg);
          }
          continue;
        }

        // Consumable or ammo: → слот strip (universal quick-slot)
        if (CONSUMABLES[item.type]) {
          const def    = CONSUMABLES[item.type];
          const isAmmo = def.category === 'ammo';
          const info   = isAmmo ? AMMO_ICON[item.type] : null;
          const hexC   = info?.color ?? 0x44aacc;
          const clrS   = `#${hexC.toString(16).padStart(6, '0')}`;
          const box    = this.add.rectangle(sx, sy, SZ, BODY_H, 0x0a1a2a, 0.95).setOrigin(0, 0)
            .setStrokeStyle(2, hexC, 0.8);
          let iconEl;
          if (info) {
            const isz = 36;
            iconEl = this.textures.exists(item.type)
              ? this.add.image(sx + SZ / 2, sy + BODY_H / 2 - 5, prerenderTex(this, item.type, isz, isz)).setDisplaySize(isz, isz).setOrigin(0.5)
              : this.add.text(sx + SZ / 2, sy + BODY_H / 2 - 5, info.icon ?? '?', this.O('14px', clrS)).setOrigin(0.5);
          } else {
            const iconK = `consumable_${item.type}`;
            const isz = 36;
            iconEl = this.textures.exists(iconK)
              ? this.add.image(sx + SZ / 2, sy + BODY_H / 2 - 5, prerenderTex(this, iconK, isz, isz)).setDisplaySize(isz, isz).setOrigin(0.5)
              : this.add.text(sx + SZ / 2, sy + BODY_H / 2 - 5, '?', this.O('14px', '#88aacc')).setOrigin(0.5);
          }
          const cntTxt = this.add.text(sx + SZ / 2, sy + BODY_H - 8, `${item.amount}/${def.maxPerSlot}`,
            this.F('9px', '#aaccdd')).setOrigin(0.5);
          const ammoSlots = gs.ammoSlots || [];
          const canLoad   = ammoSlots.some(s => s.type === item.type || !s.type);
          const strip = this.add.rectangle(sx, sy + BODY_H, SZ, SELL_H,
            canLoad ? 0x0a1828 : 0x0d1018, 0.9).setOrigin(0, 0)
            .setStrokeStyle(1, canLoad ? hexC : 0x2a3040, 0.5);
          const stripT = this.add.text(sx + SZ / 2, sy + BODY_H + SELL_H / 2,
            canLoad ? '→ слот' : '⚡ нет мест',
            this.F('9px', canLoad ? clrS : '#556677')).setOrigin(0.5);
          if (canLoad) {
            strip.setInteractive({ useHandCursor: true });
            strip.on('pointerdown', () => this._loadAmmoToSlot(item));
          }
          container.add([box, iconEl, cntTxt, strip, stripT]);
          if (overflow) {
            const dg = this.add.graphics();
            dg.fillStyle(0xffa000, 0.85); dg.fillTriangle(sx, sy, sx + 14, sy, sx, sy + 14);
            container.add(dg);
          }
          continue;
        }

        // Верхняя зона: equip
        const eq = this.add.rectangle(sx, sy, SZ, BODY_H, 0x0d1e2c, 0.95).setOrigin(0, 0)
          .setStrokeStyle(2, bdrHex, 0.75).setInteractive({ useHandCursor: true });
        eq.on('pointerover', (p) => { eq.setFillStyle(0x142838); this._showTooltip(p.x, p.y, item); });
        eq.on('pointerout',  ()  => { eq.setFillStyle(0x0d1e2c); this._hideTooltip(); });
        eq.on('pointerdown', ()  => this.equip(item));

        // Нижняя полоска: sell (заблокировано если starLvl > 0)
        const goldLocked = (item.perk?.starLvl || 0) > 0;
        const sl = this.add.rectangle(sx, sy + BODY_H, SZ, SELL_H,
          goldLocked ? 0x1a1200 : 0x1e0e00, 0.9).setOrigin(0, 0)
          .setStrokeStyle(1, goldLocked ? 0x444422 : 0x664422, 0.5);
        const slT = this.add.text(sx + SZ / 2, sy + BODY_H + SELL_H / 2,
          goldLocked ? '⭐ блок' : `₵ ${itemSellPrice(item)}`,
          this.F('9px', goldLocked ? '#666644' : '#aa7744')).setOrigin(0.5);
        if (!goldLocked) {
          sl.setInteractive({ useHandCursor: true });
          sl.on('pointerdown', () => this.showSellConfirm(item));
        }

        const iconK = itemIconKey(item);
        const iconImg = iconK
          ? this.add.image(sx + SZ / 2, sy + BODY_H / 2, prerenderTex(this, iconK, 48, 48)).setDisplaySize(48, 48).setOrigin(0.5)
          : this.add.text(sx + SZ / 2, sy + BODY_H / 2, `T${item.tier}`, this.O('14px', '#ffe0b2')).setOrigin(0.5);
        container.add([eq, sl, slT, iconImg]);
      } else {
        // Warehouse cell
        const box = this.add.rectangle(sx, sy, SZ, BODY_H, 0x0c1a10, 0.9).setOrigin(0, 0)
          .setStrokeStyle(1, bdrHex, pDef ? 0.5 : 0.22).setInteractive({ useHandCursor: true });
        box.on('pointerover', (p) => { box.setFillStyle(0x102018); this._showTooltip(p.x, p.y, item); });
        box.on('pointerout',  ()  => { box.setFillStyle(0x0c1a10); this._hideTooltip(); });
        box.on('pointerdown', ()  => {
          const cargoMax = this._cargoMax();
          const inv = gs.inventory || [];
          if (inv.length >= cargoMax) return;
          const idx = (gs.warehouse || []).indexOf(item); if (idx < 0) return;
          gs.warehouse.splice(idx, 1); inv.push(item);
          this.scene.restart();
        });
        const moveLbl = this.add.rectangle(sx, sy + BODY_H, SZ, SELL_H, 0x0a1a0a, 0.9).setOrigin(0, 0)
          .setStrokeStyle(1, 0x2a6840, 0.4);
        const moveTxt = this.add.text(sx + SZ / 2, sy + BODY_H + SELL_H / 2, '→ трюм',
          this.F('9px', '#4a9860')).setOrigin(0.5);
        const iconK = itemIconKey(item);
        const iconImg = iconK
          ? this.add.image(sx + SZ / 2, sy + BODY_H / 2, prerenderTex(this, iconK, 48, 48)).setDisplaySize(48, 48).setOrigin(0.5)
          : this.add.text(sx + SZ / 2, sy + BODY_H / 2, `T${item.tier}`, this.O('14px', '#b8e4c4')).setOrigin(0.5);
        container.add([box, moveLbl, moveTxt, iconImg]);
      }

      // Rarity dot (top-right corner)
      if (rarHex) {
        const dg = this.add.graphics();
        dg.setPosition(sx, sy); // y must reflect row for visibility grouping
        dg.fillStyle(rarHex, 1); dg.fillCircle(SZ - 6, 6, 4);
        container.add(dg);
      }
      // Overflow indicator: янтарный треугольник в верхнем левом углу (премиум истёк)
      if (overflow) {
        const dg = this.add.graphics();
        dg.setPosition(sx, sy);
        dg.fillStyle(0xffa000, 0.85); dg.fillTriangle(0, 0, 14, 0, 0, 14);
        container.add(dg);
      }
    }

    // ── Row-visibility (virtual scroll): hide rows outside [ay, ay+ah] ────────
    const { py: _py, ph: _ph, px: _px, pw: _pw } = this.box;
    const totalH = Math.ceil(displaySlots / COLS) * (SZ + GAP);

    const rowObjs = {};
    container.list.forEach(obj => {
      const r = Math.max(0, Math.floor(obj.y / (SZ + GAP)));
      (rowObjs[r] = rowObjs[r] || []).push(obj);
    });

    const updateVisibility = (cY) => {
      Object.entries(rowObjs).forEach(([rStr, objs]) => {
        const r = +rStr;
        const wY = cY + r * (SZ + GAP);
        const vis = wY < ay + ah && wY + SZ > ay;
        objs.forEach(o => { o.setVisible(vis); if (o.input) o.input.enabled = vis; });
      });
    };
    updateVisibility(ay);

    // ── Inner panel covers: clip partial rows at grid edges (depth 12) ────────
    // Covers span only the grid column (ax…ax+aw) so the ship image on the left is untouched.
    const bg = 0x080e1a;
    if (ay > _py) this.add.rectangle(ax, _py, aw, ay - _py, bg).setOrigin(0, 0).setDepth(12);
    const botH = _py + _ph - ay - ah;
    if (botH > 0) this.add.rectangle(ax, ay + ah, aw, botH, bg).setOrigin(0, 0).setDepth(12);
    const rW = Math.max(0, _px + _pw - ax - aw);
    if (rW > 0) this.add.rectangle(ax + aw, ay, rW, ah, bg).setOrigin(0, 0).setDepth(12);

    // ── Wheel scroll + scrollbar ───────────────────────────────────────────
    // totalH already computed above
    if (totalH > ah) {
      const startY = ay, minY = ay - (totalH - ah);
      const SBW = 3, thumbH = Math.max(20, Math.round(ah * ah / totalH));
      const thumb = this.add.rectangle(ax + aw - SBW - 2, ay, SBW, thumbH, 0x2a6080, 0.7)
        .setOrigin(0, 0).setDepth(13);
      const updateSB = () => {
        const frac = startY > minY ? (startY - container.y) / (startY - minY) : 0;
        thumb.setY(ay + Math.round(frac * (ah - thumbH)));
      };
      this.input.on('wheel', (p, _o, _dx, dy) => {
        if (p.x < ax || p.x > ax + aw || p.y < ay || p.y > ay + ah) return;
        container.y = Phaser.Math.Clamp(container.y - dy * 0.5, minY, startY);
        updateSB();
        updateVisibility(container.y);
      });
    }
  }

  // ════════════════ ТАБ «АПГРЕЙД + ПЕРКИ» — объединённая вкладка ════════════════
  renderUpgradePerksTab() {
    if (!this.gs.garageUpgSubTab) this.gs.garageUpgSubTab = 'upgrade';
    const subTab = this.gs.garageUpgSubTab;
    const { px, py, pw } = this.box;

    // Sub-tab switcher
    const sw = 160, sh = 28, sy = py + 58;
    const subBtns = [
      { label: 'АПГРЕЙД', id: 'upgrade' },
      { label: 'ПЕРКИ',   id: 'perks'   },
    ];
    subBtns.forEach(({ label, id }, i) => {
      const bx = px + pw / 2 - sw - 4 + i * (sw + 8);
      const active = subTab === id;
      const btn = this.add.rectangle(bx + sw / 2, sy + sh / 2, sw, sh,
        active ? 0x0a2035 : 0x060c18, active ? 0.95 : 0.7)
        .setStrokeStyle(1, active ? COLORS.primary : 0x1e3a50, active ? 1 : 0.6)
        .setInteractive({ useHandCursor: true }).setDepth(14);
      this.add.text(bx + sw / 2, sy + sh / 2, label, this.O('12px', active ? '#4dd0e1' : '#446677'))
        .setOrigin(0.5).setDepth(14);
      if (!active) btn.on('pointerdown', () => { this.gs.garageUpgSubTab = id; this.scene.restart(); });
    });

    if (subTab === 'upgrade') this.renderUpgradeTab();
    else                      this.renderPerksTab();
  }

  // ════════════════ ТАБ «АПГРЕЙД» — уровень корабля + кредит-апгрейд модулей ════════════════
  renderUpgradeTab() {
    const { px, py, pw, ph } = this.box;
    const gs = this.gs, p = gs.player;
    const key = p.ship.key;
    const lvl = gs.shipLevels?.[key] || 1;

    // ── Левая колонка: прокачка корабля ──
    const lx = px + 40, lw = 320;
    this.shipImg(lx + lw / 2, py + 96, 116, p.ship);
    this.add.text(lx + lw / 2, py + 152, i18n.t(p.ship.nameKey), this.O('18px', '#cfe9ee')).setOrigin(0.5, 0);
    this.add.text(lx + lw / 2, py + 180, `${i18n.t('garage.ship_level')}: ${lvl} / ${SHIP_MAX_LEVEL}`, this.O('15px', '#ffb74d')).setOrigin(0.5, 0);

    // Текущие эффективные статы активного корабля
    const lines = [
      `${i18n.t('garage.hull')}:  ${p.maxHull}`,
      `${i18n.t('hud.shield')}:  ${p.maxShield}`,
      `${i18n.t('garage.speed')}:  ${Math.round(p.baseSpeed)}`,
    ];
    this.add.text(lx + 20, py + 220, lines.join('\n'), this.F('13px', '#9fb3b8')).setLineSpacing(8);

    const isPrestige = !!p.ship.prestige;
    const cost = isPrestige ? shipLevelCostGold(p.ship, lvl) : shipLevelCost(p.ship, lvl);
    const ay = py + ph - 92;
    if (cost == null) {
      this.bigBtn(lx + lw / 2, ay, 0x5d4037, i18n.t('garage.max_level'), null);
    } else if (isPrestige) {
      const can = (gs.starGold || 0) >= cost;
      this.add.text(lx + lw / 2, ay - 22, `${i18n.t('garage.next_level')}: ${cost} ⭐`,
        this.F('12px', can ? '#ffd54f' : '#ef9a9a')).setOrigin(0.5, 0);
      this.bigBtn(lx + lw / 2, ay, can ? 0x3a2c00 : 0x263238, i18n.t('garage.upgrade_ship'), can ? () => this.upgradeShip() : null);
    } else {
      const can = (gs.credits || 0) >= cost;
      this.add.text(lx + lw / 2, ay - 22, `${i18n.t('garage.next_level')}: ${cost.toLocaleString('ru')} кр`,
        this.F('12px', can ? '#66bb6a' : '#ef9a9a')).setOrigin(0.5, 0);
      this.bigBtn(lx + lw / 2, ay, can ? 0x2e7d32 : 0x263238, i18n.t('garage.upgrade_ship'), can ? () => this.upgradeShip() : null);
    }

    // ── Правая колонка: кредит-апгрейд установленных модулей ──
    const rx = px + 400, rw = pw - 440;
    this.add.text(rx, py + 98, i18n.t('garage.modules'), this.O('15px', '#ffe0b2')).setDepth(14);
    this.renderModuleUpgrades(rx, py + 126, rw, ph - 176);
  }

  renderModuleUpgrades(x, y, w, h) {
    const p = this.gs.player, gs = this.gs;
    const mods = [];
    for (const k of ['weapon', 'shield', 'engine']) (p.slots[k] || []).forEach((it) => { if (it) mods.push(it); });
    if (!mods.length) { this.add.text(x, y, i18n.t('garage.no_modules'), this.F('14px', '#5e7378')); return; }

    const rowH = 64, gap = 6, rowSpan = rowH + gap;
    const bw = 150, bh = 24, bxAbs = x + w - bw - 8;
    const { py, ph } = this.box;

    // No container — absolute positions, setY on scroll
    const allRows = mods.map((it, r) => {
      const baseY = y + r * rowSpan;
      const ri = []; // [obj, dy, isBtn]

      ri.push([this.add.rectangle(x, baseY, w, rowH, 0x10202b, 0.95).setOrigin(0, 0).setStrokeStyle(1, COLORS.primary, 0.2), 0, false]);

      const cl = it.creditLvl || 0, sl = it.starLvl || 0, onStar = sl > 0;
      const pctNow = Math.round((modMult(it) - 1) * 1000) / 10;
      const lvlStr = onStar ? `⭐ ${sl}/5` : `${i18n.t('garage.credit_lvl')} ${cl}/5`;
      ri.push([this.add.text(x + 12, baseY + 8, `${itemName(it)}   ·   ${lvlStr}   (+${pctNow}%)`, this.O('13px', '#ffe0b2')), 8, false]);
      ri.push([this.add.text(x + 12, baseY + 32, this.upgradePreview(it), { ...this.F('11px', '#a5d6a7'), wordWrap: { width: bxAbs - x - 24 } }), 32, false]);

      const sCost = starUpgradeCost(it);
      const sbdy = onStar ? (rowH - bh) / 2 : 34;
      if (sCost == null) {
        ri.push([this.add.text(bxAbs + bw / 2, baseY + sbdy + bh / 2, `⭐ ${i18n.t('garage.max')}`, this.F('11px', '#7e9398')).setOrigin(0.5), sbdy + bh / 2, false]);
      } else {
        const can = (gs.starGold || 0) >= sCost;
        const b = this.add.rectangle(bxAbs, baseY + sbdy, bw, bh, can ? 0x3a2c12 : 0x1a2a30, 0.95).setOrigin(0, 0).setStrokeStyle(1, can ? COLORS.amber : 0x33484f, 0.85);
        ri.push([b, sbdy, can]);
        ri.push([this.add.text(bxAbs + bw / 2, baseY + sbdy + bh / 2, `⭐ ${i18n.t('garage.mod_upgrade')} ${sCost}`, this.F('11px', can ? '#ffd54f' : '#5e7378')).setOrigin(0.5), sbdy + bh / 2, false]);
        if (can) b.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.tryStarUpgrade(it));
      }

      if (!onStar) {
        const cCost = creditUpgradeCost(it);
        const cbdy = 6;
        if (cCost == null) {
          ri.push([this.add.text(bxAbs + bw / 2, baseY + cbdy + bh / 2, `кред. ${i18n.t('garage.max')}`, this.F('11px', '#7e9398')).setOrigin(0.5), cbdy + bh / 2, false]);
        } else {
          const can = (gs.credits || 0) >= cCost;
          const b = this.add.rectangle(bxAbs, baseY + cbdy, bw, bh, can ? 0x14331c : 0x1a2a30, 0.95).setOrigin(0, 0).setStrokeStyle(1, can ? COLORS.emerald : 0x33484f, 0.8);
          ri.push([b, cbdy, can]);
          ri.push([this.add.text(bxAbs + bw / 2, baseY + cbdy + bh / 2, `${i18n.t('garage.mod_upgrade')} ${cCost.toLocaleString('ru')}`, this.F('11px', can ? '#a5d6a7' : '#5e7378')).setOrigin(0.5), cbdy + bh / 2, false]);
          if (can) b.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.upgradeModule(it));
        }
      }
      return { ri, baseY };
    });

    const topH = y - py;
    if (topH > 0) this.add.rectangle(x, py, w, topH, 0x080e1a).setOrigin(0, 0).setDepth(12);
    const botH = py + ph - (y + h);
    if (botH > 0) this.add.rectangle(x, y + h, w, botH, 0x080e1a).setOrigin(0, 0).setDepth(12);

    const totalH = mods.length * rowSpan;
    let scrollAmt = 0;

    const applyScroll = (amt) => {
      scrollAmt = amt;
      allRows.forEach(({ ri, baseY }) => {
        const newBase = baseY - scrollAmt;
        const vis = newBase >= py && newBase + rowH <= py + ph;
        ri.forEach(([obj, dy, isBtn]) => {
          obj.setVisible(vis);
          if (isBtn) vis ? obj.setInteractive({ useHandCursor: true }) : obj.disableInteractive();
          if (vis) obj.setY(newBase + dy);
        });
      });
    };
    applyScroll(0);

    if (totalH > h) {
      const maxScroll = totalH - h;
      const SBW = 3, thumbH = Math.max(20, Math.round(h * h / totalH));
      const thumb = this.add.rectangle(x + w - SBW - 2, y, SBW, thumbH, 0x2a6080, 0.7).setOrigin(0, 0).setDepth(13);
      this.input.on('wheel', (ptr, _o, _dx, dy) => {
        if (ptr.x < x || ptr.x > x + w || ptr.y < y || ptr.y > y + h) return;
        scrollAmt = Phaser.Math.Clamp(scrollAmt + dy * 0.2, 0, maxScroll);
        applyScroll(scrollAmt);
        const frac = maxScroll > 0 ? scrollAmt / maxScroll : 0;
        thumb.setY(y + Math.round(frac * (h - thumbH)));
      });
    }
  }

  // Текущее эффективное значение главного стата модуля (с учётом modMult).
  upgradePreview(it) {
    const k = modMult(it);
    const f = (label, base) => `${label}: ${(base * k).toFixed(1)}`;
    if (it.type === 'cannon') return f(i18n.t('stat.damage'), it.damage);
    if (it.type === 'laser')  return f(i18n.t('stat.damage'), it.damage);
    if (it.type === 'engine') return f(i18n.t('stat.speed'), it.speed);
    return f(i18n.t('stat.durability'), it.durability);
  }

  upgradeShip() {
    const gs = this.gs, p = gs.player, key = p.ship.key;
    const lvl = gs.shipLevels?.[key] || 1;
    const isPrestige = !!p.ship.prestige;
    const cost = isPrestige ? shipLevelCostGold(p.ship, lvl) : shipLevelCost(p.ship, lvl);
    if (cost == null) return;
    if (isPrestige) {
      if ((gs.starGold || 0) < cost) return;
      gs.starGold -= cost;
    } else {
      if ((gs.credits || 0) < cost) return;
      gs.credits -= cost;
    }
    gs.shipLevels = gs.shipLevels || {};
    gs.shipLevels[key] = lvl + 1;
    p.applyShip(p.ship);            // переприменить уровень к активному кораблю (сохранит долю корпуса)
    p.recomputeStats();
    if (p.shield > p.maxShield) p.shield = p.maxShield;
    gs.log(i18n.t('garage.ship_upgraded', { lvl: lvl + 1 }));
    gs._saveState?.();
    this.scene.restart();
  }

  upgradeModule(item) {
    const gs = this.gs;
    const cost = creditUpgradeCost(item);
    if (cost == null || (gs.credits || 0) < cost) return;
    gs.credits -= cost;
    item.creditLvl = (item.creditLvl || 0) + 1;
    gs.player.recomputeStats();
    gs.log(i18n.t('garage.mod_upgraded', { item: itemName(item), lvl: item.creditLvl }));
    gs._saveState?.();
    this.scene.restart();
  }

  // ⭐-апгрейд. Если у предмета есть кредитный прогресс — сперва предупреждаем о сбросе.
  tryStarUpgrade(item) {
    if ((item.creditLvl || 0) > 0) this.showResetConfirm(item);
    else this.doStarUpgrade(item);
  }

  doStarUpgrade(item) {
    const gs = this.gs;
    const cost = starUpgradeCost(item);
    if (cost == null || (gs.starGold || 0) < cost) return;
    gs.starGold -= cost;
    item.creditLvl = 0;                          // переход на ⭐-путь сбрасывает кредитный прогресс
    item.starLvl = (item.starLvl || 0) + 1;
    gs.player.recomputeStats();
    gs.log(i18n.t('garage.mod_star_upgraded', { item: itemName(item), lvl: item.starLvl }));
    gs._saveState?.();
    this.scene.restart();
  }

  // Модалка-предупреждение: ⭐-апгрейд сбросит кредитную прокачку.
  showResetConfirm(item) {
    if (this.modal) this.closeModal();
    const W = this.scale.width, H = this.scale.height;
    const objs = [];
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.55).setOrigin(0).setDepth(100).setInteractive();
    dim.on('pointerdown', () => this.closeModal());
    objs.push(dim);

    const mw = Math.min(480, W - 60), mh = 200, mx = (W - mw) / 2, my = (H - mh) / 2;
    const g = this.add.graphics().setDepth(101);
    g.fillStyle(0x10202b, 1); g.fillRoundedRect(mx, my, mw, mh, 10);
    g.lineStyle(2, COLORS.amber, 0.85); g.strokeRoundedRect(mx, my, mw, mh, 10);
    objs.push(g);

    objs.push(this.add.text(mx + mw / 2, my + 30,
      i18n.t('garage.reset_warn', { item: itemName(item), lvl: item.creditLvl }),
      { ...this.F('14px', '#cfe9ee'), align: 'center', wordWrap: { width: mw - 48 } }).setOrigin(0.5, 0).setDepth(102));

    const mkBtn = (cxr, color, brd, label, cb) => {
      const bw = 190, bh = 40, bx = cxr - bw / 2, by = my + mh - bh - 22;
      const r = this.add.rectangle(bx, by, bw, bh, color, 0.95).setOrigin(0, 0).setDepth(102)
        .setStrokeStyle(1, brd, 0.4).setInteractive({ useHandCursor: true });
      const t = this.add.text(cxr, by + bh / 2, label, this.O('13px', '#ffffff')).setOrigin(0.5).setDepth(103);
      r.on('pointerdown', cb);
      objs.push(r, t);
    };
    mkBtn(mx + mw * 0.30, 0x3a2c12, COLORS.amber, i18n.t('garage.reset_yes'), () => { this.closeModal(); this.doStarUpgrade(item); });
    mkBtn(mx + mw * 0.70, 0x37474f, 0xffffff, i18n.t('garage.no'), () => this.closeModal());

    this.modal = objs;
  }

  // ⭐-апгрейд перка. Если у перка есть кредитный прогресс — предупреждаем о сбросе.
  tryStarPerkUpgrade(item) {
    if ((item.perk.creditLvl || 0) > 0) this.showPerkResetConfirm(item);
    else this.doStarPerkUpgrade(item);
  }

  doStarPerkUpgrade(item) {
    const gs = this.gs;
    const sLvl = item.perk.starLvl || 0;
    const cost = sLvl < 5 ? PERK_STAR_COST[sLvl] : null;
    if (cost == null || (gs.starGold || 0) < cost) return;
    gs.starGold -= cost;
    item.perk.creditLvl = 0;
    item.perk.starLvl = sLvl + 1;
    gs._saveState?.();
    this.scene.restart();
  }

  showPerkResetConfirm(item) {
    if (this.modal) this.closeModal();
    const W = this.scale.width, H = this.scale.height;
    const objs = [];
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.55).setOrigin(0).setDepth(100).setInteractive();
    dim.on('pointerdown', () => this.closeModal());
    objs.push(dim);

    const mw = Math.min(480, W - 60), mh = 200, mx = (W - mw) / 2, my = (H - mh) / 2;
    const g = this.add.graphics().setDepth(101);
    g.fillStyle(0x10202b, 1); g.fillRoundedRect(mx, my, mw, mh, 10);
    g.lineStyle(2, COLORS.amber, 0.85); g.strokeRoundedRect(mx, my, mw, mh, 10);
    objs.push(g);

    objs.push(this.add.text(mx + mw / 2, my + 30,
      i18n.t('garage.perk_reset_warn', { lvl: item.perk.creditLvl }),
      { ...this.F('14px', '#cfe9ee'), align: 'center', wordWrap: { width: mw - 48 } }).setOrigin(0.5, 0).setDepth(102));

    const mkBtn = (cxr, color, brd, label, cb) => {
      const bw = 190, bh = 40, bx = cxr - bw / 2, by = my + mh - bh - 22;
      const r = this.add.rectangle(bx, by, bw, bh, color, 0.95).setOrigin(0, 0).setDepth(102)
        .setStrokeStyle(1, brd, 0.4).setInteractive({ useHandCursor: true });
      const t = this.add.text(cxr, by + bh / 2, label, this.O('13px', '#ffffff')).setOrigin(0.5).setDepth(103);
      r.on('pointerdown', cb);
      objs.push(r, t);
    };
    mkBtn(mx + mw * 0.30, 0x3a2c12, COLORS.amber, i18n.t('garage.reset_yes'), () => { this.closeModal(); this.doStarPerkUpgrade(item); });
    mkBtn(mx + mw * 0.70, 0x37474f, 0xffffff, i18n.t('garage.no'), () => this.closeModal());

    this.modal = objs;
  }

  // ════════════════ ТАБ «ОБОРУДОВАНИЕ» — слоты модулей + склад ════════════════
  renderEquipTab() {
    const { px, py, pw, ph } = this.box;
    const p = this.gs.player;

    const lx = px + 40, lw = 300;
    this.shipImg(lx + lw / 2, py + 86, 110, p.ship);
    this.add.text(lx + lw / 2, py + 142, i18n.t(p.ship.nameKey), this.O('17px', '#cfe9ee')).setOrigin(0.5, 0);

    // Четыре группы слотов: оружие (янтарь) / щит (cyan) / двигатели (изумруд) / боеприпасы (оранж)
    this.slotRow(lx, py + 176, i18n.t('garage.weapon'), 'weapon', COLORS.amber);
    this.slotRow(lx, py + 240, i18n.t('garage.shield'), 'shield', COLORS.primary);
    this.slotRow(lx, py + 304, i18n.t('garage.engine'), 'engine', COLORS.emerald);
    this.slotRow(lx, py + 368, i18n.t('garage.ammo'),   'ammo',   0xffb74d);

    const dps = (p.hasCannon ? Math.round(p.cannonDamage * p.weaponFireRate * (p.cannonAccuracy ?? 0.90)) : 0)
              + (p.hasLaser  ? Math.round(p.laserDamage  * p.weaponFireRate * (p.laserAccuracy  ?? 0.80)) : 0);
    const lines = [
      `${i18n.t('garage.dps')}:  ${dps}`,
      `${i18n.t('hud.shield')}:  ${p.maxShield}  (+${p.shieldRegenPerSec}/${i18n.t('unit.sec')})`,
      `${i18n.t('stat.evasion')}:  ${Math.round(p.evasion * 100)}%`,
      `${i18n.t('garage.speed')}:  ${Math.round(p.baseSpeed)}`,
      `${i18n.t('hud.hull')}:  ${p.maxHull}`,
    ];
    this.add.text(lx, py + 440, lines.join('\n'), this.F('13px', '#9fb3b8')).setLineSpacing(7);

    const rx = px + 380, rw = pw - 420;
    const gs = this.gs;
    const cargoMax = this._cargoMax();
    const whCount = (gs.warehouse || []).length, whMax = this._whMax();
    this.add.text(rx, py + 60, `ТРЮМ  ${gs.inventory.length}/${cargoMax}`, this.O('15px', '#ffe0b2')).setDepth(14);

    // Инвентарь на всю доступную высоту (склад убран — отдельное окно C)
    const BTN_H = 34;
    const invH = ph - 92 - BTN_H - 16;
    // clipBotH=4: cover strip занимает только 4px снизу сетки, не закрывает кнопку под ней
    this.renderInventory(rx, py + 92, rw, invH, 4);

    // Кнопка быстрого перехода в окно Трюм/Склад
    const btnY = py + 92 + invH + 8;
    const btnBg = this.add.rectangle(rx, btnY, rw, BTN_H, 0x0d1e2c, 0.95)
      .setOrigin(0, 0).setStrokeStyle(1, 0x1e3a50, 0.7).setInteractive({ useHandCursor: true })
      .setDepth(15);
    const whLabel = this.add.text(rx + rw / 2, btnY + BTN_H / 2,
      `СКЛАД  ${whCount}/${whMax}   →   C`,
      this.O('12px', '#4dd0e1')).setOrigin(0.5).setDepth(15);
    btnBg.on('pointerover', () => { btnBg.setFillStyle(0x142838); whLabel.setColor('#7ee8f0'); });
    btnBg.on('pointerout',  () => { btnBg.setFillStyle(0x0d1e2c); whLabel.setColor('#4dd0e1'); });
    btnBg.on('pointerdown', () => this.gs.toggleOverlay('CargoScene'));
  }

  // Ряд слотов одного типа: подпись (занято/всего) + квадраты. Клик по занятому → снять.
  slotRow(x, y, label, key, color) {
    const p = this.gs.player;
    const ship = p.ship;
    // Определяем лимит слотов именно для ТЕКУЩЕГО корабля
    const limit = (key === 'weapon') ? ship.wSlots
                : (key === 'shield') ? ship.sSlots
                : (key === 'ammo')   ? (ship.aSlots || 0)
                : (ship.eSlots || 0);

    if (key === 'ammo') {
      this._renderAmmoSlotRow(x, y, label, limit, color);
      return;
    }

    // Берем глобальный список модулей, но обрезаем его по лимиту корабля
    const allEquipped = this.gs.equipped[key] || [];
    const arr = allEquipped.slice(0, limit);
    
    const used = arr.filter(Boolean).length;
    this.add.text(x, y, `${label}   ${used}/${limit}`, this.F('11px', '#7e9398'));
    const sz = 36, gap = 5, sy = y + 18;
    if (limit === 0) {
      this.add.text(x, sy + 9, i18n.t('garage.no_slot_short'), this.F('11px', '#5e7378'));
      return;
    }
    arr.forEach((it, i) => {
      const row = Math.floor(i / 7);
      const col = i % 7;
      const sx = x + col * (sz + gap);
      const rowY = sy + row * (sz + gap);

      // Border: perk rarity color if equipped, else slot type color
      const pDef      = it?.perk ? PERK_MAP[it.perk.key] : null;
      const borderCol = it ? (pDef ? RARITY_COLOR[pDef.rarity] : color) : 0x33484f;
      const borderAlpha = it ? 0.9 : 0.7;

      const box = this.add.rectangle(sx, rowY, sz, sz, it ? 0x12222e : 0x0c1118, 0.95).setOrigin(0, 0)
        .setStrokeStyle(it ? 2 : 1, borderCol, borderAlpha);
      if (it) {
        const iconK = itemIconKey(it);
        if (iconK)
          this.add.image(sx + sz / 2, rowY + sz / 2, prerenderTex(this, iconK, 28, 28)).setDisplaySize(28, 28).setOrigin(0.5);
        else
          this.add.text(sx + sz / 2, rowY + sz / 2, `T${it.tier}`, this.O('11px', '#e8f3f5')).setOrigin(0.5);
        // Small rarity dot at bottom-right if has perk
        if (pDef) {
          const dg = this.add.graphics();
          dg.fillStyle(RARITY_COLOR[pDef.rarity], 1);
          dg.fillCircle(sx + sz - 5, rowY + sz - 5, 4);
        }
        box.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.unequip(key, i));
      }
    });
  }

  renderInventory(x, y, w, h, clipBotH) {
    this._renderSlotGrid(x, y, w, h, this.gs.inventory || [], this._cargoMax(), 'inventory', clipBotH);
  }

  // Ammo slot row: N generic slots — any ammo type or consumable
  _renderAmmoSlotRow(x, y, label, limit, color) {
    const gs    = this.gs;
    const slots = gs.ammoSlots || [];
    const sz = 36, gap = 5;
    const used = slots.slice(0, limit).filter(s => s.type && s.count > 0).length;

    this.add.text(x, y, `${label}   ${used}/${limit}`, this.F('11px', '#7e9398'));
    if (limit === 0) {
      this.add.text(x, y + 18 + 9, i18n.t('garage.no_slot_short'), this.F('11px', '#5e7378'));
      return;
    }

    for (let i = 0; i < limit; i++) {
      const slot = slots[i] || { type: null, count: 0 };
      const sx = x + i * (sz + gap);
      const sy = y + 18;
      const isEmpty = !slot.type || slot.count <= 0;
      const ammoInfo = slot.type ? AMMO_ICON[slot.type] : null;
      const hexC = ammoInfo?.color ?? 0x44aacc;
      const borderColor = isEmpty ? 0x33484f : hexC;
      const box = this.add.rectangle(sx, sy, sz, sz, isEmpty ? 0x0c1118 : 0x12222e, 0.95).setOrigin(0, 0)
        .setStrokeStyle(isEmpty ? 1 : 2, borderColor, isEmpty ? 0.35 : 0.85);

      if (!isEmpty) {
        if (ammoInfo) {
          const tsz = sz - 14;
          if (this.textures.exists(slot.type)) {
            this.add.image(sx + sz / 2, sy + sz / 2 - 4, prerenderTex(this, slot.type, tsz, tsz))
              .setDisplaySize(tsz, tsz).setOrigin(0.5);
          } else {
            const clrS = `#${hexC.toString(16).padStart(6, '0')}`;
            this.add.text(sx + sz / 2, sy + sz / 2 - 4, ammoInfo.icon ?? '?',
              this.O('12px', clrS)).setOrigin(0.5);
          }
        } else {
          const iconK = `consumable_${slot.type}`;
          const tsz = sz - 12;
          if (this.textures.exists(iconK)) {
            this.add.image(sx + sz / 2, sy + sz / 2 - 4, prerenderTex(this, iconK, tsz, tsz))
              .setDisplaySize(tsz, tsz).setOrigin(0.5);
          } else {
            this.add.text(sx + sz / 2, sy + sz / 2 - 4, '?', this.O('12px', '#88aacc')).setOrigin(0.5);
          }
        }
        this.add.text(sx + sz / 2, sy + sz - 7, `${slot.count.toLocaleString()}`,
          this.F('8px', '#aaccdd')).setOrigin(0.5);
        const idx = i;
        box.setInteractive({ useHandCursor: true });
        box.on('pointerover', () => box.setFillStyle(0x1e3240));
        box.on('pointerout',  () => box.setFillStyle(0x12222e));
        box.on('pointerdown', () => this._unloadAmmoSlot(idx));
      }
    }
  }

  _loadAmmoToSlot(item) {
    const gs     = this.gs;
    const slots  = gs.ammoSlots || [];
    const def    = CONSUMABLES[item.type];
    if (!def) return;
    const maxPer = def.maxPerSlot;
    let rem = item.amount;
    for (const slot of slots) {
      if (rem <= 0) break;
      if (slot.type === item.type && slot.count < maxPer) {
        const add = Math.min(maxPer - slot.count, rem);
        slot.count += add; rem -= add;
      }
    }
    for (const slot of slots) {
      if (rem <= 0) break;
      if (!slot.type) {
        const add = Math.min(maxPer, rem);
        slot.type = item.type; slot.count = add; rem -= add;
      }
    }
    if (rem <= 0) {
      const idx = (gs.inventory || []).indexOf(item);
      if (idx >= 0) gs.inventory.splice(idx, 1);
    } else {
      item.amount = rem;
    }
    gs._saveState?.();
    this.scene.restart();
  }

  _unloadAmmoSlot(i) {
    const gs   = this.gs;
    const slot = gs.ammoSlots?.[i];
    if (!slot?.type || slot.count <= 0) return;
    addConsumableToInventory(gs.inventory, slot.type, slot.count, this._cargoMax());
    slot.type = null; slot.count = 0;
    gs._saveState?.();
    this.scene.restart();
  }

  // Модалка подтверждения продажи (без restart — отдельные объекты, чистятся по выбору)
  showSellConfirm(item) {
    if (this.modal) this.closeModal();
    const W = this.scale.width, H = this.scale.height;
    const price = itemSellPrice(item);
    const objs = [];

    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.55).setOrigin(0).setDepth(100).setInteractive();
    dim.on('pointerdown', () => this.closeModal());
    objs.push(dim);

    const mw = Math.min(440, W - 60), mh = 180, mx = (W - mw) / 2, my = (H - mh) / 2;
    const g = this.add.graphics().setDepth(101);
    g.fillStyle(0x10202b, 1); g.fillRoundedRect(mx, my, mw, mh, 10);
    g.lineStyle(2, COLORS.amber, 0.8); g.strokeRoundedRect(mx, my, mw, mh, 10);
    objs.push(g);

    objs.push(this.add.text(mx + mw / 2, my + 34,
      i18n.t('garage.sell_confirm', { item: itemName(item), price }),
      { ...this.F('15px', '#cfe9ee'), align: 'center', wordWrap: { width: mw - 48 } }).setOrigin(0.5, 0).setDepth(102));

    const mkBtn = (cxr, color, label, cb) => {
      const bw = 150, bh = 40, bx = cxr - bw / 2, by = my + mh - bh - 22;
      const r = this.add.rectangle(bx, by, bw, bh, color, 0.9).setOrigin(0, 0).setDepth(102)
        .setStrokeStyle(1, 0xffffff, 0.15).setInteractive({ useHandCursor: true });
      const t = this.add.text(cxr, by + bh / 2, label, this.O('15px', '#ffffff')).setOrigin(0.5).setDepth(103);
      r.on('pointerdown', cb);
      objs.push(r, t);
    };
    mkBtn(mx + mw * 0.30, 0x2e7d32, i18n.t('garage.yes'), () => this.sell(item));
    mkBtn(mx + mw * 0.70, 0x37474f, i18n.t('garage.no'), () => this.closeModal());

    this.modal = objs;
  }

  closeModal() {
    if (!this.modal) return;
    this.modal.forEach((o) => o.destroy());
    this.modal = null;
  }

  sell(item) {
    const gs = this.gs, inv = gs.inventory;
    const idx = inv.indexOf(item);
    if (idx < 0) { this.closeModal(); return; }
    const price = itemSellPrice(item);
    inv.splice(idx, 1);
    gs.credits = (gs.credits || 0) + price;
    gs.log(i18n.t('log.sold', { item: itemName(item), price }));
    this.closeModal();
    this.scene.restart();
  }

  // Надеть предмет в слот его типа: первый свободный, иначе заменить слот 0 (старый — в склад).
  equip(item) {
    const p = this.gs.player, inv = this.gs.inventory;
    const key = SLOT_KEY[item.type];
    const arr = this.gs.equipped[key];
    if (!arr) return;

    const idx = inv.indexOf(item);
    if (idx < 0) return;
    inv.splice(idx, 1);

    const free = arr.findIndex((x) => !x);
    if (free < 0) { 
      const prev = arr[0]; 
      arr[0] = item; 
      if (prev) inv.push(prev); 
    } else {
      arr[free] = item;
    }
    
    p.recomputeStats();
    this.scene.restart();
  }

  unequip(key, i) {
    const p = this.gs.player, arr = this.gs.equipped[key];
    if (!arr || !arr[i]) return;
    if (this.gs.inventory.length >= this._cargoMax()) {
      this.gs.log?.('Трюм заполнен');
      return;
    }
    this.gs.inventory.push(arr[i]);
    arr[i] = null;
    p.recomputeStats();
    this.scene.restart();
  }

  // ════════════════ ТАБ «ПЕРКИ» ════════════════════════════════════════════
  // Отображает случайные перки для слотов оружия/щита активного корабля.
  // Левая колонка — список слотов, правая — детали выбранного слота.
  renderPerksTab() {
    const { px, py, pw, ph } = this.box;
    const gs = this.gs;

    // Retroactively assign perks to equipped items that lack them
    for (const slot of ['weapon', 'shield', 'engine']) {
      for (const item of (gs.equipped[slot] || [])) {
        if (item && !item.perk) item.perk = rollPerk(item.type);
      }
    }

    // Build a flat list of all equipped perkable slots
    const slots = [];
    for (const item of (gs.equipped.weapon || [])) {
      if (item) slots.push({ item, label: itemName(item) });
    }
    for (const item of (gs.equipped.shield || [])) {
      if (item) slots.push({ item, label: itemName(item) });
    }
    for (const item of (gs.equipped.engine || [])) {
      if (item) slots.push({ item, label: itemName(item) });
    }

    if (slots.length === 0) {
      this.add.text(px + pw / 2, py + ph / 2, 'Нет надетых модулей',
        this.F('16px', '#445566')).setOrigin(0.5);
      return;
    }

    // Track selected slot index
    if (gs.perksSlotIdx === undefined || gs.perksSlotIdx >= slots.length) gs.perksSlotIdx = 0;
    const selIdx = gs.perksSlotIdx;
    const selSlot = slots[selIdx];

    const contentY = py + 98;   // смещено вниз для sub-tab switcher
    const contentH = ph - 102;

    // ── Left: slot list ──────────────────────────────────────────────────
    const listW = 200;
    const listX = px + 18;
    const itemH = 50;

    this.add.text(listX + listW / 2, contentY + 6, 'СЛОТЫ МОДУЛЕЙ',
      this.O('13px', '#2a4a5a')).setOrigin(0.5, 0).setDepth(14);

    const listAreaY = contentY + 30;
    const listAreaH = contentH - 38;
    const { py: lpy, ph: lph } = this.box;

    // No container — absolute positions, setY on scroll
    const allSlots = slots.map(({ item, label }, i) => {
      const baseY = listAreaY + i * (itemH + 6);
      const active = i === selIdx;
      const pDef = item.perk ? PERK_MAP[item.perk.key] : null;
      const rarColor = pDef ? RARITY_COLOR[pDef.rarity] : 0x334455;
      const si = []; // [obj, dy, isBtn]

      const card = this.add.rectangle(listX, baseY, listW, itemH, active ? 0x0d2030 : 0x081018)
        .setOrigin(0, 0).setStrokeStyle(active ? 2 : 1, active ? COLORS.primary : 0x1a2a3a, 0.9)
        .setInteractive({ useHandCursor: true });
      card.on('pointerdown', () => { gs.perksSlotIdx = i; this.scene.restart(); });
      card.on('pointerover', () => { if (!active) card.setFillStyle(0x0c1828); });
      card.on('pointerout',  () => { if (!active) card.setFillStyle(0x081018); });
      si.push([card, 0, true]);

      si.push([this.add.text(listX + 8, baseY + 8, label, this.O('12px', active ? '#4dd0e1' : '#446677')).setOrigin(0, 0), 8, false]);
      if (pDef) {
        const rarColorHex = `#${rarColor.toString(16).padStart(6, '0')}`;
        const dot = this.add.graphics().setPosition(listX, baseY);
        dot.fillStyle(rarColor, 1); dot.fillCircle(10, 34, 4);
        si.push([dot, 0, false]);
        si.push([this.add.text(listX + 18, baseY + 28, pDef.name, this.F('11px', rarColorHex)).setOrigin(0, 0), 28, false]);
      } else {
        si.push([this.add.text(listX + 8, baseY + 32, 'нет перка', this.F('12px', '#223344')).setOrigin(0, 0), 32, false]);
      }
      return { si, baseY };
    });

    const listTopH = listAreaY - lpy;
    if (listTopH > 0) this.add.rectangle(listX, lpy, listW, listTopH, 0x080e1a).setOrigin(0, 0).setDepth(12);
    const listBotH = lpy + lph - (listAreaY + listAreaH);
    if (listBotH > 0) this.add.rectangle(listX, listAreaY + listAreaH, listW, listBotH, 0x080e1a).setOrigin(0, 0).setDepth(12);

    const totalListH = slots.length * (itemH + 6);
    let listScroll = 0;

    const applyListScroll = (amt) => {
      listScroll = amt;
      allSlots.forEach(({ si, baseY }) => {
        const newBase = baseY - listScroll;
        const vis = newBase >= listAreaY && newBase + itemH <= listAreaY + listAreaH;
        si.forEach(([obj, dy, isBtn]) => {
          obj.setVisible(vis);
          if (isBtn) vis ? obj.setInteractive({ useHandCursor: true }) : obj.disableInteractive();
          if (vis) obj.setY(newBase + dy);
        });
      });
    };
    // Restore scroll so the selected item is visible after scene.restart()
    const maxListScroll = Math.max(0, totalListH - listAreaH);
    const selItemTop = selIdx * (itemH + 6);
    const initialScroll = totalListH > listAreaH
      ? Phaser.Math.Clamp(selItemTop - Math.floor(listAreaH / 2), 0, maxListScroll)
      : 0;
    applyListScroll(initialScroll);

    if (totalListH > listAreaH) {
      const SBW = 3, thumbH = Math.max(20, Math.round(listAreaH * listAreaH / totalListH));
      const thumb = this.add.rectangle(listX + listW - SBW - 2, listAreaY, SBW, thumbH, 0x2a6080, 0.7).setOrigin(0, 0).setDepth(13);
      const frac0 = maxListScroll > 0 ? initialScroll / maxListScroll : 0;
      thumb.setY(listAreaY + Math.round(frac0 * (listAreaH - thumbH)));
      this.input.on('wheel', (ptr, _o, _dx, dy) => {
        if (ptr.x < listX || ptr.x > listX + listW || ptr.y < listAreaY || ptr.y > listAreaY + listAreaH) return;
        listScroll = Phaser.Math.Clamp(listScroll + Math.sign(dy) * (itemH + 6), 0, maxListScroll);
        applyListScroll(listScroll);
        const frac = maxListScroll > 0 ? listScroll / maxListScroll : 0;
        thumb.setY(listAreaY + Math.round(frac * (listAreaH - thumbH)));
      });
    }

    // ── Right: perk detail ───────────────────────────────────────────────
    const detX = px + listW + 28;
    const detW = pw - listW - 38;
    const detH = contentH - 8;

    const bg = this.add.graphics();
    bg.fillStyle(0x070e18, 0.9); bg.fillRoundedRect(detX, contentY, detW, detH, 8);
    bg.lineStyle(1, 0x162030, 0.8); bg.strokeRoundedRect(detX, contentY, detW, detH, 8);

    const item = selSlot.item;
    const perk = item.perk;

    if (!perk) {
      this.add.text(detX + detW / 2, contentY + detH / 2, 'Перк не назначен',
        this.F('14px', '#334455')).setOrigin(0.5);
      this._perkRerollBtn(detX, contentY, detW, detH, item, selIdx, gs);
      return;
    }

    const pDef = PERK_MAP[perk.key];
    if (!pDef) return;

    const rarHex    = RARITY_COLOR[pDef.rarity];
    const rarLabel  = RARITY_LABEL[pDef.rarity];
    const rarColor  = `#${rarHex.toString(16).padStart(6, '0')}`;
    const bonus     = perkBonus(perk);

    let cy = contentY + 18;
    const cx = detX + detW / 2;

    const imgSize = 192;
    const slotScales = { weapon: 1.0, shield: 1.0, laser: 0.8, engine: 0.8 };
    const displaySize = Math.round(imgSize * (slotScales[pDef.slot] || 1.0));
    const imgOffsetY = Math.round((imgSize - displaySize) / 2);
    if (this.textures.exists(pDef.key)) {
      const preKey = prerenderTex(this, pDef.key, displaySize, displaySize);
      this.add.image(cx, cy + imgOffsetY + displaySize / 2, preKey).setDisplaySize(displaySize, displaySize).setOrigin(0.5);
    } else {
      const fg = this.add.graphics();
      fg.fillStyle(rarHex, 0.3); fg.fillRoundedRect(cx - displaySize / 2, cy + imgOffsetY, displaySize, displaySize, 10);
      fg.lineStyle(2, rarHex, 0.7); fg.strokeRoundedRect(cx - displaySize / 2, cy + imgOffsetY, displaySize, displaySize, 10);
    }
    cy += imgSize + 10;

    // Rarity badge
    const rbg = this.add.graphics();
    const rlw = 130, rlh = 24;
    rbg.fillStyle(rarHex, 0.15); rbg.fillRoundedRect(cx - rlw / 2, cy, rlw, rlh, 5);
    rbg.lineStyle(1, rarHex, 0.6); rbg.strokeRoundedRect(cx - rlw / 2, cy, rlw, rlh, 5);
    this.add.text(cx, cy + rlh / 2, rarLabel, this.O('11px', rarColor)).setOrigin(0.5);
    cy += rlh + 10;

    // Name
    this.add.text(cx, cy, pDef.name, this.O('18px', rarColor)).setOrigin(0.5, 0);
    cy += 28;

    // Base effect — крупнее, это главный текст
    this.add.text(cx, cy, pDef.desc(bonus), this.F('15px', '#aaccdd')).setOrigin(0.5, 0);
    cy += 24;

    // Bonus breakdown
    const cLvl = perk.creditLvl || 0, sLvl = perk.starLvl || 0;
    this.add.text(cx, cy,
      `Кред: +${(cLvl * 0.9).toFixed(1)}%  ·  Звёзды: +${(sLvl * 9).toFixed(0)}%`,
      this.F('12px', '#2a4a5a')).setOrigin(0.5, 0);
    cy += 18;

    // Separator — линия с ромбом посередине
    const dg = this.add.graphics();
    const smx = detX + detW / 2, smy = cy + 1, sds = 5;
    dg.lineStyle(1, 0x1e3a50, 0.8);
    dg.strokeLineShape(new Phaser.Geom.Line(detX + 16, smy, smx - sds - 2, smy));
    dg.strokeLineShape(new Phaser.Geom.Line(smx + sds + 2, smy, detX + detW - 16, smy));
    dg.fillStyle(0x2a6080, 0.9);
    dg.beginPath(); dg.moveTo(smx, smy - sds); dg.lineTo(smx + sds, smy); dg.lineTo(smx, smy + sds); dg.lineTo(smx - sds, smy); dg.closePath(); dg.fillPath();
    cy += 14;

    // Two upgrade columns
    const halfW = (detW - 40) / 2;
    const colLX = detX + 12, colRX = detX + 20 + halfW;

    // Credits upgrade
    const goldLocked = sLvl > 0; // starLvl > 0 блокирует кредитный апгрейд
    const nextCLvl = cLvl + 1;
    const cCost    = (!goldLocked && cLvl < 5) ? PERK_CREDIT_COST[cLvl] : null;
    const canCred  = cCost !== null && (gs.credits || 0) >= cCost;

    this.add.text(colLX + halfW / 2, cy, `💰 ПРОКАЧКА (кредиты)`,
      this.O('13px', goldLocked ? '#2a3a2a' : '#3a6a4a')).setOrigin(0.5, 0);
    this.add.text(colLX + halfW / 2, cy + 18,
      goldLocked ? '⭐-прокачка активна — кред. заблокированы'
        : `Ур. ${cLvl}/5  →  +${(cLvl * 0.9).toFixed(1)}% бонус`,
      this.F('12px', goldLocked ? '#444433' : '#2a4a3a')).setOrigin(0.5, 0);

    if (cCost !== null) {
      const cbg = this.add.rectangle(colLX + halfW / 2, cy + 48, halfW - 4, 32,
        canCred ? 0x081a10 : 0x060810)
        .setOrigin(0.5).setStrokeStyle(1, canCred ? 0x44aa55 : 0x1a2a1a, 0.9)
        .setInteractive({ useHandCursor: canCred });
      this.add.text(colLX + halfW / 2, cy + 48,
        canCred ? `▲ ${cCost.toLocaleString('ru')} кр` : `🔒 ${cCost.toLocaleString('ru')} кр`,
        this.F('13px', canCred ? '#66cc77' : '#334455')).setOrigin(0.5);
      if (canCred) {
        cbg.on('pointerover', () => cbg.setFillStyle(0x102818));
        cbg.on('pointerout',  () => cbg.setFillStyle(0x081a10));
        cbg.on('pointerdown', () => {
          gs.credits  = (gs.credits || 0) - cCost;
          item.perk.creditLvl = nextCLvl - 1 + 1; // = nextCLvl
          gs._saveState?.();
          this.scene.restart();
        });
      }
    } else {
      this.add.text(colLX + halfW / 2, cy + 48, '✓ MAX (кред.)',
        this.F('13px', '#66cc77')).setOrigin(0.5);
    }

    // Stars upgrade
    const nextSLvl = sLvl + 1;
    const sCost    = sLvl < 5 ? PERK_STAR_COST[sLvl] : null;
    const canStar  = sCost !== null && (gs.starGold || 0) >= sCost;

    this.add.text(colRX + halfW / 2, cy, `⭐ ПРОКАЧКА (звёзды)`,
      this.O('13px', '#3a5a1a')).setOrigin(0.5, 0);
    this.add.text(colRX + halfW / 2, cy + 18,
      `Ур. ${sLvl}/5  →  +${(sLvl * 9).toFixed(0)}% бонус`,
      this.F('12px', '#3a4a1a')).setOrigin(0.5, 0);

    if (sCost !== null) {
      const sbg = this.add.rectangle(colRX + halfW / 2, cy + 48, halfW - 4, 32,
        canStar ? 0x1a1200 : 0x060810)
        .setOrigin(0.5).setStrokeStyle(1, canStar ? 0xaa9900 : 0x2a2200, 0.9)
        .setInteractive({ useHandCursor: canStar });
      this.add.text(colRX + halfW / 2, cy + 48,
        canStar ? `▲ ${sCost} ⭐` : `🔒 ${sCost} ⭐`,
        this.F('13px', canStar ? '#ffcc44' : '#334455')).setOrigin(0.5);
      if (canStar) {
        sbg.on('pointerover', () => sbg.setFillStyle(0x261c00));
        sbg.on('pointerout',  () => sbg.setFillStyle(0x1a1200));
        sbg.on('pointerdown', () => this.tryStarPerkUpgrade(item));
      }
    } else {
      this.add.text(colRX + halfW / 2, cy + 48, '✓ MAX (звёзды)',
        this.F('13px', '#ffcc44')).setOrigin(0.5);
    }

    cy += 80;

    // Reroll section
    this._perkRerollBtn(detX, cy, detW, 0, item, selIdx, gs);
  }

  _perkRerollBtn(detX, cy, detW, detH, item, slotIdx, gs) {
    const cx = detX + detW / 2;
    // Reroll count tracking per slot (reset daily → simplified: per session count)
    if (!gs.perkRerollCounts) gs.perkRerollCounts = {};
    const rerollKey = `slot_${slotIdx}`;
    const rerollN   = gs.perkRerollCounts[rerollKey] || 0;
    const rerollCost = PERK_REROLL_BASE * Math.pow(2, rerollN); // 200, 400, 800...
    const canReroll  = (gs.starGold || 0) >= rerollCost;

    const ry = detH ? cy + detH - 58 : cy + 12;
    const rbg = this.add.rectangle(cx, ry, 220, 36, canReroll ? 0x100818 : 0x060810)
      .setStrokeStyle(1, canReroll ? 0x664488 : 0x2a1a3a, 0.9)
      .setInteractive({ useHandCursor: canReroll });
    this.add.text(cx, ry,
      canReroll ? `🔄 Реролл перка: ${rerollCost} ⭐  (попытка ${rerollN + 1})` : `🔄 Реролл: ${rerollCost} ⭐ (нет звёзд)`,
      this.F('13px', canReroll ? '#bb88dd' : '#334455')).setOrigin(0.5);
    if (canReroll) {
      rbg.on('pointerover', () => rbg.setFillStyle(0x180a24));
      rbg.on('pointerout',  () => rbg.setFillStyle(0x100818));
      rbg.on('pointerdown', () => {
        gs.starGold = (gs.starGold || 0) - rerollCost;
        gs.perkRerollCounts[rerollKey] = rerollN + 1;
        item.perk = rollPerk(item.type);
        gs._saveState?.();
        this.scene.restart();
      });
    }

    // Daily reset hint
    this.add.text(cx, ry + 24, 'Счётчик попыток сбрасывается в 00:00 UTC',
      this.F('11px', '#1a2535')).setOrigin(0.5, 0);
  }

  _showTooltip(wx, wy, item) {
    this._hideTooltip();
    if (!item) return;
    const W = this.scale.width, H = this.scale.height;
    const pDef = item.perk ? PERK_MAP[item.perk.key] : null;
    const rarColor = pDef ? `#${RARITY_COLOR[pDef.rarity].toString(16).padStart(6, '0')}` : null;
    const TW = 240, GAP = 5;

    const lineDefs = [
      { text: itemName(item),  sty: this.O('13px', '#ffe0b2') },
      { text: itemStats(item), sty: this.F('11px', '#9fb3b8') },
    ];
    if (pDef) {
      lineDefs.push({ text: pDef.name,                       sty: this.F('11px', rarColor) });
      lineDefs.push({ text: pDef.desc(perkBonus(item.perk)), sty: this.F('11px', '#aaccdd') });
    }

    // Первый проход — создаём тексты вне экрана, чтобы замерить реальную высоту с word-wrap
    const textObjs = lineDefs
      .filter(l => l.text)
      .map(l => this.add.text(-9999, -9999, l.text,
        { ...l.sty, wordWrap: { width: TW - 20 } }).setDepth(201));

    const TH = 10 + textObjs.reduce((s, t) => s + t.height + GAP, 0);
    let tx = wx + 16, ty = wy - TH / 2;
    if (tx + TW > W - 8) tx = wx - TW - 8;
    if (ty < 4) ty = 4;
    if (ty + TH > H - 4) ty = H - TH - 4;

    const g = this.add.graphics().setDepth(200);
    g.fillStyle(0x08121e, 0.97); g.fillRoundedRect(tx, ty, TW, TH, 6);
    g.lineStyle(1, 0x1e3a50, 0.9); g.strokeRoundedRect(tx, ty, TW, TH, 6);

    // Второй проход — расставляем тексты по финальным координатам
    let ly = ty + 8;
    textObjs.forEach(t => { t.setPosition(tx + 10, ly); ly += t.height + GAP; });

    this._tooltipObjs = [g, ...textObjs];
  }

  _hideTooltip() {
    if (!this._tooltipObjs) return;
    this._tooltipObjs.forEach(o => o?.destroy());
    this._tooltipObjs = null;
  }

  // ════════════════ ТАБ «ПЛАТЫ» ════════════════════════════════════════════

  renderBoardsTab() {
    const { px, py, pw, ph } = this.box;
    const gs = this.gs;
    gs.boardInventory     = gs.boardInventory ?? [];
    gs.connectorInventory = gs.connectorInventory ?? [];
    gs.equippedBoard      = gs.equippedBoard ?? null;
    gs._boardViewIdx      = Math.min(gs._boardViewIdx ?? 0, Math.max(0, gs.boardInventory.length - 1));
    gs._selectedConnIdx   = gs._selectedConnIdx ?? -1;

    try { this.input.mouse?.disableContextMenu(); } catch (_) {}

    const contentY = py + 55;
    const contentH = ph - 67;
    const listW    = 175;
    const connW    = 182;
    const gap      = 8;
    const listX    = px + 14;
    const pcbX     = listX + listW + gap;
    const pcbW     = pw - listW - connW - gap * 4 - 28;
    const connX    = pcbX + pcbW + gap;
    const pcbCX    = pcbX + pcbW / 2;
    const pcbCY    = contentY + contentH / 2;

    this._boardListX = listX;   this._boardListY = contentY;
    this._boardListW = listW;   this._boardListH = contentH;
    this._boardPcbCX = pcbCX;   this._boardPcbCY = pcbCY;
    this._boardPcbW  = pcbW;    this._boardPcbH  = contentH;
    this._boardConnX = connX;   this._boardConnY = contentY;
    this._boardConnW = connW;   this._boardConnH = contentH;

    const sg = this.add.graphics();
    sg.lineStyle(1, 0x1a3a5a, 0.6);
    sg.lineBetween(pcbX - 4, contentY, pcbX - 4, contentY + contentH);
    sg.lineBetween(connX - 4, contentY, connX - 4, contentY + contentH);

    if (gs.boardInventory.length === 0) {
      this.add.text(pcbCX, pcbCY - 20, '[ Плат нет ]',
        this.F('16px', '#2a4a5a')).setOrigin(0.5).setDepth(14);
      this.add.text(pcbCX, pcbCY + 14, 'Выпадают из мобов и данжей',
        this.F('12px', '#1a3040')).setOrigin(0.5).setDepth(14);
    }

    this._pcbObjs     = [];
    this._effObjs     = [];
    this._listObjs    = [];
    this._connObjs    = [];
    this._confirmObjs = [];

    this._drawBoardList();
    const selBoard = gs.boardInventory[gs._boardViewIdx] ?? null;
    this._drawPCB(selBoard);
    this._drawConnPanel(selBoard);
  }

  _showConfirm(message, onConfirm) {
    (this._confirmObjs || []).forEach(o => o?.destroy());
    this._confirmObjs = [];
    const W = this.scale.width, H = this.scale.height;
    const dw = 360, dh = 110;
    const dx = W / 2, dy = H / 2;
    const _close = () => {
      (this._confirmObjs || []).forEach(o => o?.destroy());
      this._confirmObjs = [];
    };
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55)
      .setDepth(49).setInteractive();
    const dlg = this.add.rectangle(dx, dy, dw, dh, 0x060e1c, 1)
      .setStrokeStyle(1, 0x2a5a8a, 1).setDepth(50);
    const msg = this.add.text(dx, dy - dh / 2 + 12, message,
      { ...this.F('11px', '#aaccee'), wordWrap: { width: dw - 24 }, align: 'center' })
      .setOrigin(0.5, 0).setDepth(51);
    const btnW = 120, btnH = 26;
    const cfmBg = this.add.rectangle(dx - 75, dy + 30, btnW, btnH, 0x0a2010, 1)
      .setStrokeStyle(1, 0x44bb66, 1).setDepth(50).setInteractive({ useHandCursor: true });
    const cfmT = this.add.text(dx - 75, dy + 30, 'Подтвердить',
      this.F('11px', '#44bb66')).setOrigin(0.5).setDepth(51);
    cfmBg.on('pointerover', () => cfmBg.setAlpha(0.7));
    cfmBg.on('pointerout',  () => cfmBg.setAlpha(1));
    cfmBg.on('pointerdown', () => { _close(); onConfirm(); });
    const cnlBg = this.add.rectangle(dx + 75, dy + 30, btnW, btnH, 0x18060a, 1)
      .setStrokeStyle(1, 0x995544, 1).setDepth(50).setInteractive({ useHandCursor: true });
    const cnlT = this.add.text(dx + 75, dy + 30, 'Отмена',
      this.F('11px', '#aa6655')).setOrigin(0.5).setDepth(51);
    cnlBg.on('pointerover', () => cnlBg.setAlpha(0.7));
    cnlBg.on('pointerout',  () => cnlBg.setAlpha(1));
    cnlBg.on('pointerdown', _close);
    this._confirmObjs.push(overlay, dlg, msg, cfmBg, cfmT, cnlBg, cnlT);
  }

  _drawBoardList() {
    (this._listObjs || []).forEach(o => o?.destroy());
    this._listObjs = [];
    const gs       = this.gs;
    const inv      = gs.boardInventory;
    const lx       = this._boardListX, ly = this._boardListY;
    const lw       = this._boardListW, lh = this._boardListH;
    const ITEM_H   = 68;
    const SCROLL_W = 8;
    const BOTTOM_H  = 110;
    const listAreaH = lh - BOTTOM_H;
    const maxScroll = Math.max(0, inv.length * ITEM_H - listAreaH);
    gs._boardListScroll = Math.min(gs._boardListScroll ?? 0, maxScroll);

    // No geometry mask (createGeometryMask not supported in WebGL) — clip by position only
    const TIER_COLOR = [0, 0x44ff88, 0x44aaff, 0xcc44ff];
    for (let i = 0; i < inv.length; i++) {
      const board = inv[i];
      const iy    = ly + i * ITEM_H - gs._boardListScroll;
      // Skip items that extend outside the scrollable area (strict: no partial rendering)
      if (iy < ly || iy + ITEM_H > ly + listAreaH) continue;

      const isSelected = i === gs._boardViewIdx;
      const isEquipped = gs.equippedBoard?.id === board.id;
      const bgCol = isSelected ? 0x0e2a44 : 0x060f1a;
      const bg = this.add.rectangle(lx + lw / 2, iy + ITEM_H / 2, lw - 2, ITEM_H - 2, bgCol, 0.95)
        .setDepth(14);
      if (isSelected) bg.setStrokeStyle(1, COLORS.primary, 0.8);
      this._listObjs.push(bg);

      const tc    = TIER_COLOR[board.tier] || 0xffffff;
      const ul    = board.upgradeLevel ?? 0;
      const tb    = this.add.text(lx + 8, iy + 6,
        `T${board.tier} ${board.name}${ul > 0 ? ' ↑' + ul : ''}`,
        this.O('11px', `#${tc.toString(16).padStart(6, '0')}`)).setDepth(15);
      this._listObjs.push(tb);

      const placed = Object.keys(board.placements || {}).length;
      const ci = this.add.text(lx + 8, iy + 22,
        `Слоты: ${board.maxConn}  Занято: ${placed}`,
        this.F('9px', '#5a8aaa')).setDepth(15);
      this._listObjs.push(ci);

      const preview = boardPreviewStats(board).split(' · ').slice(0, 2).join(' · ');
      const pt = this.add.text(lx + 8, iy + 36, preview,
        this.F('9px', '#8abccc')).setDepth(15).setWordWrapWidth(lw - 16);
      this._listObjs.push(pt);

      if (isEquipped) {
        const et = this.add.text(lx + lw - 8, iy + 6, '✓ АКТИВНА',
          this.F('9px', '#44ff88')).setOrigin(1, 0).setDepth(15);
        this._listObjs.push(et);
      }

      const zone = this.add.rectangle(lx + lw / 2, iy + ITEM_H / 2, lw - 2, ITEM_H - 2, 0, 0)
        .setDepth(16).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => {
        gs._boardViewIdx = i;
        this._drawBoardList();
        const b = gs.boardInventory[i];
        this._drawPCB(b);
        this._drawConnPanel(b);
      });
      this._listObjs.push(zone);
    }

    // Scrollbar
    if (inv.length * ITEM_H > listAreaH) {
      const thumbH = Math.max(24, listAreaH * (listAreaH / (inv.length * ITEM_H)));
      const frac   = maxScroll > 0 ? gs._boardListScroll / maxScroll : 0;
      const thumbY = ly + frac * (listAreaH - thumbH);
      const sbg = this.add.rectangle(lx + lw - 4, ly + listAreaH / 2, SCROLL_W, listAreaH, 0x0a1a28, 0.6).setDepth(15);
      const sth = this.add.rectangle(lx + lw - 4, thumbY + thumbH / 2, SCROLL_W - 2, thumbH, 0x1e4a6a, 0.9).setDepth(15);
      this._listObjs.push(sbg, sth);
    }

    // Wheel scroll (shared: board list left, connector panel right)
    if (!this._boardWheelBound) {
      this._boardWheelBound = true;
      this.input.on('wheel', (ptr, _go, _dx, dy) => {
        if (ptr.x >= (this._boardConnX ?? Infinity)) {
          const ci    = gs.connectorInventory ?? [];
          const CARD  = 42, ROWS = 6, vH = ROWS * CARD;
          const mSc   = Math.max(0, Math.ceil(ci.length / 4) * CARD - vH);
          const raw   = Math.max(0, Math.min(mSc, (gs._connScroll ?? 0) + Math.sign(dy) * CARD));
          gs._connScroll = Math.round(raw / CARD) * CARD;
          const cur = (gs.boardInventory ?? [])[gs._boardViewIdx ?? 0] ?? null;
          this._drawConnPanel(cur);
        } else {
          const aH  = (this._boardListH ?? 0) - 110;
          const mSc = Math.max(0, gs.boardInventory.length * ITEM_H - aH);
          gs._boardListScroll = Math.max(0, Math.min(mSc, (gs._boardListScroll ?? 0) + dy * 0.5));
          this._drawBoardList();
        }
      });
    }

    // ─── Separator + cover for bottom panel ───
    const sepG = this.add.graphics().setDepth(15);
    sepG.lineStyle(1, 0x1a3a5a, 0.7);
    sepG.lineBetween(lx, ly + listAreaH, lx + lw, ly + listAreaH);
    const botCover = this.add.rectangle(lx + lw / 2, ly + listAreaH + (lh - listAreaH) / 2,
      lw, lh - listAreaH, 0x060c14, 1.0).setDepth(14.5);
    this._listObjs.push(sepG, botCover);

    // ─── Bottom: chip counter + upgrade buttons + board disassemble ───
    const selBoard = gs.boardInventory[gs._boardViewIdx] ?? null;
    gs.chips = gs.chips ?? 0;

    let bY = ly + listAreaH + 6;

    // Chip display
    const chipT = this.add.text(lx + lw / 2, bY + 7, `🔩 Чипов: ${gs.chips}`,
      this.F('10px', '#aaddff')).setOrigin(0.5).setDepth(15);
    this._listObjs.push(chipT);
    bY += 18;

    const _upgBtn = (label, enabled, color, onClick) => {
      const bg = this.add.rectangle(lx + lw / 2, bY + 11, lw - 6, 22,
        enabled ? 0x0a1826 : 0x070c12, 0.92)
        .setStrokeStyle(1, enabled ? color : 0x1a2a3a, 0.75).setDepth(15);
      const bt = this.add.text(lx + lw / 2, bY + 11, label,
        this.F('9px', enabled ? `#${color.toString(16).padStart(6,'0')}` : '#1e3040'))
        .setOrigin(0.5).setDepth(16);
      this._listObjs.push(bg, bt);
      if (enabled) {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => bg.setAlpha(0.7));
        bg.on('pointerout',  () => bg.setAlpha(1));
        bg.on('pointerdown', onClick);
      }
      bY += 24;
    };

    if (selBoard) {
      const t = selBoard.tier;
      // ─ Connector slot upgrade ─
      const cUpgLvl = selBoard.connUpgLevel ?? 0;
      const cUpgDelta = [1, 2, 3][t - 1] ?? 1;        // T1:+1, T2:+2, T3:+3 per level
      const cUpgCost  = [[1,2],[2,3],[4,5]][t-1]?.[cUpgLvl] ?? 99;
      const cCanUpg   = cUpgLvl < 2 && gs.chips >= cUpgCost;
      const cLabel    = cUpgLvl < 2
        ? `Слоты +${cUpgDelta}  [${cUpgCost} чип]  (${cUpgLvl}/2)`
        : `Слоты МАКС (${cUpgLvl}/2)`;
      _upgBtn(cLabel, cCanUpg, 0x44aaff, () => {
        gs.chips -= cUpgCost;
        selBoard.maxConn = (selBoard.maxConn || 0) + cUpgDelta;
        selBoard.connUpgLevel = cUpgLvl + 1;
        this._drawBoardList();
        this._drawConnPanel(selBoard);
      });

      // ─ Node upgrade ─
      const nUpgLvl  = selBoard.nodeUpgLevel ?? 0;
      const nUpgCost = [[3,4],[4,5],[5,6]][t-1]?.[nUpgLvl] ?? 99;
      const isT1 = t === 1;
      // T2/T3: pick a random free junc node to assign a random stat
      const eligibleJuncs = !isT1
        ? (selBoard.nodes || []).filter(n => n.type === 'junc' && !n.upgStat && !n.minUpg)
        : [];
      const nCanUpg = nUpgLvl < 2 && gs.chips >= nUpgCost && (isT1 || eligibleJuncs.length > 0);
      const nLabel  = nUpgLvl < 2
        ? (isT1
            ? `Узлы +1  [${nUpgCost} чип]  (${nUpgLvl}/2)`
            : `Узел+свойство  [${nUpgCost} чип]  (${nUpgLvl}/2)`)
        : (isT1 ? `Узлы МАКС (${nUpgLvl}/2)` : `Узел МАКС (${nUpgLvl}/2)`);
      _upgBtn(nLabel, nCanUpg, 0x44ff88, () => {
        gs.chips -= nUpgCost;
        selBoard.nodeUpgLevel = nUpgLvl + 1;
        if (!isT1 && eligibleJuncs.length > 0) {
          const target = eligibleJuncs[Math.floor(Math.random() * eligibleJuncs.length)];
          // Pick a stat not already on this board
          const usedStats = new Set((selBoard.nodes || []).flatMap(n => [n.stat, n.upgStat]).filter(Boolean));
          const avail = BUF_STATS.filter(s => !usedStats.has(s));
          target.upgStat = avail.length > 0
            ? avail[Math.floor(Math.random() * avail.length)]
            : BUF_STATS[Math.floor(Math.random() * BUF_STATS.length)];
        }
        this._drawBoardList();
        const b = gs.boardInventory[gs._boardViewIdx];
        this._drawPCB(b);
        this._drawConnPanel(b);
      });

      // ─ Board disassemble ─
      const dChips = [3, 4, 5][t - 1] ?? 3;
      const placed = placedCount(selBoard);
      const inv = gs.connectorInventory ?? [];
      const noRoom = inv.length + placed > 24;
      const disLabel = noRoom
        ? `РАЗОБРАТЬ (нет места!)`
        : `РАЗОБРАТЬ → ${dChips} чип`;
      _upgBtn(disLabel, !noRoom, 0xff6655, () => {
        const msg = `Разборка платы T${t} "${selBoard.name}".\nВы получите ${dChips} чипов.`;
        this._showConfirm(msg, () => {
          for (const [nodeId, conn] of Object.entries(selBoard.placements || {})) {
            inv.push({ ...(typeof conn === 'object' ? conn : { id: conn }) });
            delete selBoard.placements[nodeId];
          }
          gs.chips += dChips;
          const idx = gs._boardViewIdx ?? 0;
          gs.boardInventory.splice(idx, 1);
          if (gs.equippedBoard?.id === selBoard.id) {
            gs.equippedBoard = null;
            gs.player?.recomputeStats?.();
          }
          gs._boardViewIdx = Math.min(idx, Math.max(0, gs.boardInventory.length - 1));
          this._drawBoardList();
          const nb = gs.boardInventory[gs._boardViewIdx] ?? null;
          this._drawPCB(nb);
          this._drawConnPanel(nb);
        });
      });
    }
  }

  _drawPCB(board) {
    (this._pcbObjs || []).forEach(o => o?.destroy());
    this._pcbObjs = [];
    if (!board) return;

    const gs   = this.gs;
    const cx   = this._boardPcbCX;
    const cy   = this._boardPcbCY;
    const maxW = this._boardPcbW - 20;
    const maxH = this._boardPcbH - 90;

    const TIER_COL = ['', '#44ff88', '#44aaff', '#cc44ff'];
    const placed   = Object.keys(board.placements || {}).length;
    const tt = this.add.text(cx, this._boardConnY + 10,
      `${board.name}  T${board.tier}  [${placed} / ${board.maxConn}]`,
      this.O('13px', TIER_COL[board.tier] || '#ffffff')).setOrigin(0.5, 0).setDepth(16);
    this._pcbObjs.push(tt);

    const visNodes = activeNodes(board);
    const visEdges = activeEdges(board);

    const cols = visNodes.map(n => n.col);
    const rows = visNodes.map(n => n.row);
    const minC = Math.min(...cols), maxC = Math.max(...cols);
    const minR = Math.min(...rows), maxR = Math.max(...rows);
    const spanC = Math.max(1, maxC - minC);
    const spanR = Math.max(1, maxR - minR);

    // Subtract 40px total padding so node circles (radius ≈ CELL*0.28) don't clip panel edges
    const CELL = Math.min(102, Math.floor(Math.min((maxW - 40) / spanC, (maxH - 40) / spanR)));
    const NR   = Math.round(CELL * 0.28);
    const ox   = cx - spanC * CELL / 2;
    const oy   = cy - spanR * CELL / 2 + 16;
    const npos = n => ({ x: ox + (n.col - minC) * CELL, y: oy + (n.row - minR) * CELL });

    const { powered } = bfsPowered(board, {});
    const posMap = Object.fromEntries(visNodes.map(n => [n.id, npos(n)]));

    const C_SRC_ON   = 0xffffff;
    const C_JUNC_ON  = 0x00ccff;
    const C_BUF_ON   = 0x00dd66;
    const C_DEB_ON   = 0xff4444;
    const C_CONN_COL = 0xffcc44;
    const C_DIM_BLUE = 0x2a5060;   // visible dim for junc/buf
    const C_DEB_DIM  = 0x6a2222;   // visible dim for deb
    // mask → box-drawing symbol (T=1,R=2,B=4,L=8)
    const MASK_SYM = { 1:'╵',2:'╶',4:'╷',8:'╴', 5:'┃',10:'━', 3:'┗',6:'┏',12:'┓',9:'┛', 7:'├',14:'┬',13:'┤',11:'┴', 15:'┼' };

    // Edges — depth 13 (drawn below nodes)
    const ge = this.add.graphics().setDepth(13);
    this._pcbObjs.push(ge);
    for (const e of visEdges) {
      const pa = posMap[e.a], pb = posMap[e.b];
      if (!pa || !pb) continue;
      const bothPow = powered.has(e.a) && powered.has(e.b);
      ge.lineStyle(bothPow ? 4 : 2, bothPow ? 0x00ee66 : 0x2a5040, bothPow ? 1.0 : 0.75);
      ge.lineBetween(pa.x, pa.y, pb.x, pb.y);
    }

    // Node circles — depth 14 (covers edge ends cleanly)
    const gn = this.add.graphics().setDepth(14);
    this._pcbObjs.push(gn);

    // Per-node text and zones — depth 16+ (always above circles and edges)
    for (const n of visNodes) {
      const { x, y } = posMap[n.id];
      const isPow  = powered.has(n.id);
      // NOTE: conn/hasCon captured at render time for drawing only.
      // The pointerdown handler always re-reads live state.
      const conn   = board.placements?.[n.id] ?? null;
      const hasCon = !!conn;

      let fc;
      if      (n.type === 'src')  fc = C_SRC_ON;
      else if (n.type === 'junc') fc = isPow ? (hasCon ? C_CONN_COL : C_JUNC_ON) : C_DIM_BLUE;
      else if (n.type === 'buf')  fc = isPow && hasCon ? C_BUF_ON : C_DIM_BLUE;
      else                        fc = isPow ? C_DEB_ON : C_DEB_DIM;

      const r = n.type === 'src' ? NR + 2 : NR;
      gn.fillStyle(0x040c18, 1.0);
      gn.fillCircle(x, y, r);
      gn.lineStyle(hasCon ? 3 : 2, fc, isPow ? 1.0 : 0.65);
      gn.strokeCircle(x, y, r);
      gn.fillStyle(fc, isPow ? 0.22 : 0.14);
      gn.fillCircle(x, y, r - 2);

      // Icon — depth 16
      let icon = '';
      if      (n.type === 'src')  icon = '⚡';
      else if (hasCon)            icon = MASK_SYM[effectiveMask(conn)] ?? '?';
      else if (n.type === 'junc') icon = '+';
      else if (n.type === 'buf')  icon = '○';
      else                        icon = '✕';

      const fcS = `#${fc.toString(16).padStart(6, '0')}`;
      const sz  = NR > 20 ? '12px' : '10px';
      const it  = this.add.text(x, y, icon, this.F(sz, fcS)).setOrigin(0.5).setDepth(16);
      this._pcbObjs.push(it);

      // Dark background panel behind labels
      const hasStatLabel = n.stat && STAT_META[n.stat];
      const hasUpgStat   = !!(n.type === 'junc' && n.upgStat && STAT_META[n.upgStat]);
      if (hasCon || hasStatLabel || hasUpgStat) {
        const bgH = (hasCon ? 13 : 0) + (hasStatLabel ? 12 : 0) + (hasUpgStat ? 12 : 0) + 5;
        const bgY = y + r + 1;
        const lbg = this.add.rectangle(x, bgY + bgH / 2, 52, bgH, 0x040c18, 0.88)
          .setOrigin(0.5).setDepth(15.5);
        this._pcbObjs.push(lbg);
      }

      // Value label under node — depth 16
      if (hasCon) {
        const vt = this.add.text(x, y + r + 3, `+${conn.value}%`,
          this.F('9px', '#ffcc44')).setOrigin(0.5, 0).setDepth(16);
        this._pcbObjs.push(vt);
      }

      // Stat label — depth 16
      if (hasStatLabel) {
        const lbl  = STAT_META[n.stat].label.split(' ')[0];
        const lCol = isPow ? STAT_META[n.stat].color : fcS;
        const lt   = this.add.text(x, y + r + (hasCon ? 14 : 4), lbl,
          this.F('9px', lCol)).setOrigin(0.5, 0).setDepth(16);
        this._pcbObjs.push(lt);
      }

      // upgStat on junc nodes — thin dim gold when not powered, bright thick gold when powered+connector
      if (hasUpgStat) {
        const ugLbl  = STAT_META[n.upgStat].label.split(' ')[0];
        const ugLblY = y + r + (hasCon ? 14 : 4) + (hasStatLabel ? 12 : 0);
        const ugPow  = isPow && hasCon;
        const ugt = ugPow
          ? this.add.text(x, ugLblY, ugLbl, this.O('9px', '#ffcc00'))
              .setOrigin(0.5, 0).setDepth(16).setStroke('#aa7700', 2)
          : this.add.text(x, ugLblY, ugLbl, this.F('8px', '#7a6010'))
              .setOrigin(0.5, 0).setDepth(16);
        this._pcbObjs.push(ugt);
      }

      // Interactive zone — depth 17, reads live state on every click
      if (n.type === 'junc' || n.type === 'buf') {
        const zone = this.add.rectangle(x, y, NR * 2 + 6, NR * 2 + 6, 0, 0)
          .setDepth(17).setInteractive({ useHandCursor: true });
        zone.on('pointerdown', (ptr) => {
          const liveConn = board.placements?.[n.id] ?? null;  // always fresh
          const isRight  = ptr.rightButtonDown?.() || ptr.event?.button === 2;
          if (isRight) {
            if (liveConn) {
              (gs.connectorInventory = gs.connectorInventory ?? []).push({ ...liveConn });
              delete board.placements[n.id];
            }
          } else if (liveConn) {
            const maxRot = CONNECTOR_SHAPES[liveConn.shape]?.maxRot ?? 4;
            liveConn.rotation = ((liveConn.rotation ?? 0) + 1) % maxRot;
          } else {
            const si = gs._selectedConnIdx ?? -1;
            const ci = gs.connectorInventory ?? [];
            if (si >= 0 && si < ci.length && placedCount(board) < board.maxConn) {
              const placed = { ...ci[si] };
              // Auto-rotate to best fit for connected edges
              const nodeMap = Object.fromEntries((board.nodes || []).map(nd => [nd.id, nd]));
              const neededSides = (board.edges || [])
                .filter(e => e.a === n.id || e.b === n.id)
                .map(e => { const { sideA, sideB } = edgeSides(nodeMap[e.a], nodeMap[e.b]); return e.a === n.id ? sideA : sideB; });
              const shape = CONNECTOR_SHAPES[placed.shape];
              let bestRot = 0, bestScore = -1;
              for (let r = 0; r < (shape?.maxRot ?? 4); r++) {
                const m = rotateMask(shape?.mask ?? 0, r);
                const score = neededSides.reduce((a, s) => a + ((m & s) ? 1 : 0), 0);
                if (score > bestScore) { bestScore = score; bestRot = r; }
              }
              placed.rotation = bestRot;
              board.placements[n.id] = placed;
              ci.splice(si, 1);
              gs._selectedConnIdx = -1;
            }
          }
          if (gs.equippedBoard?.id === board.id) {
            gs.equippedBoard = board;
            gs.player?.recomputeStats?.();
          }
          this._drawPCB(board);
          this._drawConnPanel(board);
          this._drawBoardList();
        });
        this._pcbObjs.push(zone);
      }
    }

    const hintY = this._boardConnY + this._boardConnH - 6;
    const hintBg = this.add.rectangle(cx, hintY - 9, 290, 18, 0x020810, 0.80)
      .setOrigin(0.5, 1).setDepth(15.5);
    const hint = this.add.text(cx, hintY,
      'ЛКМ: поставить / повернуть   ПКМ: убрать',
      this.F('10px', '#4a9a7a')).setOrigin(0.5, 1).setDepth(16);
    this._pcbObjs.push(hintBg, hint);
  }

  _drawConnPanel(board) {
    (this._connObjs || []).forEach(o => o?.destroy());
    (this._effObjs  || []).forEach(o => o?.destroy());
    this._connObjs = [];
    this._effObjs  = [];

    const gs   = this.gs;
    const cx   = this._boardConnX;
    const cy   = this._boardConnY;
    const cw   = this._boardConnW;
    const ch   = this._boardConnH;
    const inv  = gs.connectorInventory ?? [];

    // ─── Connector grid (4 cols × 6 rows, max 24 connectors) ───
    const MAX_CONN_INV = 24;
    const COLS   = 4;
    const CARD_W = Math.floor((cw - 14) / COLS);
    const CARD_H = 42;
    const gridY  = cy + 28;
    const maxRows = 6;
    const visH   = maxRows * CARD_H;

    gs._connScroll  = gs._connScroll ?? 0;
    const totalRows = Math.ceil(inv.length / COLS);
    const maxScroll = Math.max(0, totalRows * CARD_H - visH);
    // Snap scroll to row boundaries to prevent partial cards
    gs._connScroll  = Math.round(Math.min(gs._connScroll, maxScroll) / CARD_H) * CARD_H;

    // Title — depth 15 (above card backgrounds at 14)
    const title2 = this.add.text(cx + cw / 2, cy + 8, 'КОННЕКТОРЫ',
      this.O('12px', '#4dd0e1')).setOrigin(0.5, 0).setDepth(15);
    this._connObjs.push(title2);

    const TIER_COLS = [0, 0x44ff88, 0x44aaff, 0xcc44ff];
    const MASK_SYM  = { 1:'╵',2:'╶',4:'╷',8:'╴', 5:'┃',10:'━', 3:'┗',6:'┏',12:'┓',9:'┛', 7:'├',14:'┬',13:'┤',11:'┴', 15:'┼' };

    for (let i = 0; i < inv.length; i++) {
      const conn  = inv[i];
      const ci    = i % COLS;
      const ri    = Math.floor(i / COLS);
      const cardX = cx + 7 + ci * CARD_W;
      const cardY = gridY + ri * CARD_H - gs._connScroll;
      // Strict clip: only fully-inside cards render
      if (cardY < gridY || cardY + CARD_H > gridY + visH) continue;

      const isSel = i === (gs._selectedConnIdx ?? -1);
      const tc    = TIER_COLS[conn.tier] || 0xffffff;
      const bg    = this.add.rectangle(cardX + CARD_W / 2, cardY + CARD_H / 2,
        CARD_W - 2, CARD_H - 2, isSel ? 0x0e2a44 : 0x050c14, 0.9)
        .setStrokeStyle(isSel ? 2 : 1, tc, isSel ? 0.9 : 0.35)
        .setDepth(14);
      const sym = this.add.text(cardX + CARD_W / 2, cardY + 7,
        MASK_SYM[effectiveMask(conn)] ?? '?',
        this.O('12px', `#${tc.toString(16).padStart(6, '0')}`))
        .setOrigin(0.5, 0).setDepth(15);
      const vt = this.add.text(cardX + CARD_W / 2, cardY + 26,
        `+${conn.value}%`, this.F('9px', '#8abccc'))
        .setOrigin(0.5, 0).setDepth(15);
      const zone = this.add.rectangle(cardX + CARD_W / 2, cardY + CARD_H / 2,
        CARD_W - 2, CARD_H - 2, 0, 0)
        .setDepth(16).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => {
        gs._selectedConnIdx = isSel ? -1 : i;
        this._drawConnPanel(board);
      });
      this._connObjs.push(bg, sym, vt, zone);
    }

    if (inv.length === 0) {
      const empty = this.add.text(cx + cw / 2, gridY + visH / 2,
        'Нет коннекторов', this.F('10px', '#1a3a2a')).setOrigin(0.5).setDepth(14);
      this._connObjs.push(empty);
    }

    // Connector scrollbar
    if (totalRows * CARD_H > visH) {
      const thumbH = Math.max(16, visH * (visH / (totalRows * CARD_H)));
      const frac   = maxScroll > 0 ? gs._connScroll / maxScroll : 0;
      const thumbY = gridY + frac * (visH - thumbH);
      const sbg = this.add.rectangle(cx + cw - 3, gridY + visH / 2, 5, visH, 0x0a1a28, 0.6).setDepth(15);
      const sth = this.add.rectangle(cx + cw - 3, thumbY + thumbH / 2, 3, thumbH, 0x1e4a6a, 0.9).setDepth(15);
      this._connObjs.push(sbg, sth);
    }

    // ─── Connector count + separator ───
    let btnY = gridY + visH + 6;
    const cntCol = inv.length >= MAX_CONN_INV ? '#ff8866' : '#5a9aaa';
    const cntT = this.add.text(cx + cw / 2, btnY, `${inv.length} / ${MAX_CONN_INV} коннекторов`,
      this.F('9px', cntCol)).setOrigin(0.5, 0).setDepth(14);
    this._connObjs.push(cntT);
    btnY += 12;
    const sg1 = this.add.graphics().setDepth(14);
    sg1.lineStyle(1, 0x1a3a5a, 0.5);
    sg1.lineBetween(cx, btnY - 2, cx + cw - 8, btnY - 2);
    this._connObjs.push(sg1);

    // ─── Craft / disassemble buttons ───
    const t1Count = inv.filter(c => c.tier === 1).length;
    const t2Count = inv.filter(c => c.tier === 2).length;
    const selIdx  = gs._selectedConnIdx ?? -1;
    const selConn = selIdx >= 0 && selIdx < inv.length ? inv[selIdx] : null;

    const _btn = (label, enabled, onClick) => {
      const bw = cw - 14;
      const bg = this.add.rectangle(cx + cw / 2, btnY + 13, bw, 26,
        enabled ? 0x081820 : 0x060c10, 0.9)
        .setStrokeStyle(1, enabled ? 0x44aaff : 0x1a3040, 0.7).setDepth(14);
      const bt = this.add.text(cx + cw / 2, btnY + 13, label,
        this.F('10px', enabled ? '#44aaff' : '#1a3a5a')).setOrigin(0.5).setDepth(15);
      this._connObjs.push(bg, bt);
      if (enabled) {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => bg.setAlpha(0.7));
        bg.on('pointerout',  () => bg.setAlpha(1));
        bg.on('pointerdown', onClick);
      }
      btnY += 30;
    };

    // Craft preview hint — shape is random, show value range
    const craftBg = this.add.rectangle(cx + cw / 2, btnY + 14, cw - 10, 32, 0x030a14, 0.85)
      .setStrokeStyle(1, 0x1a5a6a, 0.5).setOrigin(0.5, 0).setDepth(14);
    const craftHintT = this.add.text(cx + cw / 2, btnY + 4,
      'КРАФТ (форма рандом):',
      this.F('10px', '#5abccc')).setOrigin(0.5, 0).setDepth(14);
    const rangeT = this.add.text(cx + cw / 2, btnY + 17,
      'T1:+1-2%  T2:+2-4%  T3:+4-6%',
      this.F('9px', '#4a99aa')).setOrigin(0.5, 0).setDepth(14);
    this._connObjs.push(craftBg, craftHintT, rangeT);
    btnY += 34;

    const canCraft = inv.length < MAX_CONN_INV;
    _btn(`3×T1 → T2  (есть: ${t1Count})`, t1Count >= 3 && canCraft, () => {
      let n = 3;
      for (let i = inv.length - 1; i >= 0 && n > 0; i--) {
        if (inv[i].tier === 1) { inv.splice(i, 1); n--; }
      }
      inv.push(rollConnector(2));
      gs._selectedConnIdx = inv.length - 1;
      this._drawConnPanel(board);
    });

    _btn(`4×T2 → T3  (есть: ${t2Count})`, t2Count >= 4 && canCraft, () => {
      let n = 4;
      for (let i = inv.length - 1; i >= 0 && n > 0; i--) {
        if (inv[i].tier === 2) { inv.splice(i, 1); n--; }
      }
      inv.push(rollConnector(3));
      gs._selectedConnIdx = inv.length - 1;
      this._drawConnPanel(board);
    });

    // Disassemble connector → chips (T1:1, T2:2, T3:3)
    const chipYield = selConn ? selConn.tier : 0;
    const disLabel = selConn
      ? `РАЗОБРАТЬ T${selConn.tier} → ${chipYield} чип`
      : 'РАЗОБРАТЬ';
    _btn(disLabel, !!selConn, () => {
      if (!selConn) return;
      const shapeName = CONNECTOR_SHAPES[selConn.shape]?.label ?? selConn.shape;
      const msg = `Разборка коннектора T${selConn.tier} "${shapeName}".\nВы получите ${chipYield} чипа.`;
      this._showConfirm(msg, () => {
        gs.chips = (gs.chips ?? 0) + chipYield;
        inv.splice(selIdx, 1);
        gs._selectedConnIdx = Math.min(selIdx, inv.length - 1);
        this._drawConnPanel(board);
        this._drawBoardList();  // refresh chip count
      });
    });

    // ─── Separator ───
    const sg2 = this.add.graphics().setDepth(14);
    sg2.lineStyle(1, 0x1a3a5a, 0.4);
    sg2.lineBetween(cx, btnY + 2, cx + cw - 8, btnY + 2);
    this._connObjs.push(sg2);
    btnY += 10;

    // ─── Active effects ───
    if (board) {
      const effects = getBoardEffects(board, {});
      const effT = this.add.text(cx, btnY, 'ЭФФЕКТЫ',
        this.F('10px', '#5abccc')).setDepth(14);
      this._connObjs.push(effT);
      btnY += 14;

      for (const [stat, eff] of Object.entries(effects)) {
        const meta = STAT_META[stat];
        if (!meta) continue;
        const col  = eff >= 0 ? '#44ff88' : '#ff5555';
        const valStr = meta.isBool
          ? (eff > 0 ? 'Включено' : 'Выкл.')
          : `${eff >= 0 ? '+' : ''}${Math.round(eff)}%`;
        const lbl  = this.add.text(cx, btnY, meta.label,
          this.F('9px', '#8abccc')).setDepth(14);
        const vt   = this.add.text(cx + cw - 4, btnY,
          valStr, this.F('9px', col)).setOrigin(1, 0).setDepth(14);
        this._connObjs.push(lbl, vt);
        btnY += 13;
        if (btnY > cy + ch - 50) break;
      }

      if (Object.keys(effects).length === 0) {
        const noEff = this.add.text(cx, btnY, 'нет активных',
          this.F('9px', '#1a3a2a')).setDepth(14);
        this._connObjs.push(noEff);
      }
    }

    // ─── Equip / unequip button ───
    if (board) {
      const isEquipped = gs.equippedBoard?.id === board.id;
      const ebY  = cy + ch - 34;
      const ebW  = cw - 8;
      const eBbr = isEquipped ? 0xee4444 : 0x44ee88;
      const ebg  = this.add.rectangle(cx + ebW / 2, ebY, ebW, 30,
        isEquipped ? 0x1a1010 : 0x081810, 0.9)
        .setStrokeStyle(1, eBbr, 0.8).setInteractive({ useHandCursor: true }).setDepth(14);
      const ebt  = this.add.text(cx + ebW / 2, ebY,
        isEquipped ? 'СНЯТЬ' : 'УСТАНОВИТЬ',
        this.O('12px', `#${eBbr.toString(16).padStart(6, '0')}`)).setOrigin(0.5).setDepth(15);
      ebg.on('pointerover', () => ebg.setAlpha(0.75));
      ebg.on('pointerout',  () => ebg.setAlpha(1));
      ebg.on('pointerdown', () => {
        gs.equippedBoard = isEquipped ? null : board;
        gs.player?.recomputeStats?.();
        this._drawConnPanel(board);
        this._drawBoardList();
      });
      this._connObjs.push(ebg, ebt);
    }
  }
}
