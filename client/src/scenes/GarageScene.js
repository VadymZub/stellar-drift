import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { i18n } from '../i18n.js';
import { itemName, itemStats, itemSellPrice, SLOT_KEY, creditUpgradeCost, starUpgradeCost, modMult } from '../items.js';
import { SHIPS, SHIP_BY_KEY, purchaseState, shipLevelCost, SHIP_MAX_LEVEL } from '../ships.js';
import { PERK_MAP, RARITY_COLOR, RARITY_LABEL, rollPerk, perkBonus, creditUpgCost, starUpgCost, PERK_CREDIT_COST, PERK_STAR_COST, PERK_REROLL_BASE } from '../perks.js';

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

    // Сплошной темный фон, чтобы полностью скрыть карту
    this.add.rectangle(0, 0, W, H, 0x05070f, 1.0).setOrigin(0).setDepth(-11);

    // Фоновая иллюстрация Гаража
    const bg = this.add.image(W / 2, H / 2, 'bg_garage').setDepth(-10);
    const scale = Math.max(W / bg.width, H / bg.height);
    bg.setScale(scale).setAlpha(0.8).setTint(0x556677); // Увеличиваем альфу до 0.8

    // Дополнительное затемнение для читаемости UI
    this.add.rectangle(0, 0, W, H, 0x000000, 0.2).setOrigin(0).setDepth(-9);

    const pw = Math.min(960, W - 40), ph = Math.min(640, H - 40);
    const px = (W - pw) / 2, py = (H - ph) / 2;
    this.box = { px, py, pw, ph };
    const g = this.add.graphics();
    g.fillStyle(0x0b1622, 0.98); g.fillRoundedRect(px, py, pw, ph, 12);
    g.lineStyle(2, COLORS.primary, 0.8); g.strokeRoundedRect(px, py, pw, ph, 12);

    this.add.text(px + 24, py + 16, i18n.t('garage.title'), this.O('22px', '#4dd0e1'));
    this.add.text(px + pw - 20, py + 22, 'G / ESC', this.F('12px', '#7e9398')).setOrigin(1, 0);

    // ── Табы ──
    this.tab = this.gs.garageTab || 'ships';
    this.tabBtn(px + 130, py + 20, 'garage.tab_ships',   'ships');
    this.tabBtn(px + 270, py + 20, 'garage.tab_equip',   'equip');
    this.tabBtn(px + 430, py + 20, 'garage.tab_upgrade', 'upgrade');
    this.tabBtn(px + 590, py + 20, 'garage.tab_perks',   'perks');

    if      (this.tab === 'ships')   this.renderShipsTab();
    else if (this.tab === 'equip')   this.renderEquipTab();
    else if (this.tab === 'perks')   this.renderPerksTab();
    else                             this.renderUpgradeTab();

    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());
  }

  tabBtn(x, y, key, id) {
    const active = this.tab === id;
    const label = this.add.text(x, y, i18n.t(key), this.O('14px', active ? '#4dd0e1' : '#7e9398'))
      .setInteractive({ useHandCursor: true });
    if (active) this.add.rectangle(x, y + 22, label.width, 2, COLORS.primary).setOrigin(0, 0);
    label.on('pointerdown', () => { this.gs.garageTab = id; this.scene.restart(); });
  }

  // ════════════════ ТАБ «КОРАБЛИ» — витрина модельного ряда ════════════════
  renderShipsTab() {
    const { px, py, pw, ph } = this.box;
    const sel = SHIP_BY_KEY[this.gs.garageSel] ? this.gs.garageSel : this.gs.activeShip;
    this.gs.garageSel = sel;

    // Витрина 3×3 слева
    const cw = 148, ch = 112, gap = 10, lx = px + 28, gy = py + 64;
    SHIPS.forEach((ship, i) => {
      const c = i % 3, r = Math.floor(i / 3);
      this.shipCard(lx + c * (cw + gap), gy + r * (ch + gap), cw, ch, ship, ship.key === sel);
    });

    // Панель описания справа
    const rx = lx + 3 * (cw + gap) + 12;
    const rw = px + pw - rx - 24;
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

    const img = this.shipImg(x + w / 2, y + 42, 62, ship);
    if (locked) img.setTint(0x44525a).setAlpha(0.55);

    this.add.text(x + w / 2, y + 76, i18n.t(ship.nameKey), this.O('14px', locked ? '#6c8086' : '#cfe9ee')).setOrigin(0.5, 0);

    // Статус-строка внизу карточки
    let badge, color;
    if (active) { badge = i18n.t('garage.active'); color = '#ffb74d'; }
    else if (owned) { badge = i18n.t('garage.owned'); color = '#4dd0e1'; }
    else if (buyable) { badge = this.priceStr(ship); color = '#66bb6a'; }
    else if (gs.pilotLevel < ship.levelGate) { badge = `🔒 ${i18n.t('mob.level')}${ship.levelGate}`; color = '#7e9398'; }
    else { badge = '🔒'; color = '#7e9398'; }            // престиж-гейт не выполнен
    this.add.text(x + w / 2, y + h - 20, badge, this.F('11px', color)).setOrigin(0.5, 0);
  }

  // Картинка корабля для Гаража: геройский арт (garageKey) если есть, иначе игровой спрайт.
  // Вписываем в box с сохранением пропорций (арт не квадратный). Возвращает image для тинта.
  shipImg(cx, cy, box, ship) {
    const key = ship.garageKey || ship.key;
    const src = this.textures.get(key).getSourceImage();
    const scale = box / Math.max(src.width, src.height);
    return this.add.image(cx, cy, key).setDisplaySize(src.width * scale, src.height * scale);
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
    const im = this.shipImg(cx, y + 88, 156, ship);   // фото в описании +30% (120→156)
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
    const dmgPct = Math.round((ship.dmgMod - 1) * 100);
    stat(0, i18n.t('garage.hull'), `${ship.hullMax}`);
    stat(1, i18n.t('garage.shield_base'), `${ship.shieldBase}`);
    stat(2, i18n.t('garage.speed'), `${ship.baseSpeed}`);
    stat(3, i18n.t('garage.slots'), `${ship.wSlots}⚔ / ${ship.sSlots}🛡 / ${ship.eSlots || 0}🚀`);
    stat(4, i18n.t('stat.damage'), `${dmgPct >= 0 ? '+' : ''}${dmgPct}%`);

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
    this.selectShip(ship);          // купил → сразу активируем
  }

  selectShip(ship) {
    const gs = this.gs, p = gs.player;
    gs.activeShip = ship.key;
    gs.garageSel = ship.key;
    p.applyShip(SHIP_BY_KEY[ship.key]);
    p.recomputeStats();
    p.shield = p.maxShield;          // свежий корабль — полный щит
    gs.log(i18n.t('garage.switched', { ship: i18n.t(ship.nameKey) }));
    this.scene.restart();
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
      `${i18n.t('garage.dps')}:  ${Math.round(p.weaponDamage * p.weaponFireRate)}`,
      `${i18n.t('garage.speed')}:  ${Math.round(p.baseSpeed)}`,
    ];
    this.add.text(lx + 20, py + 220, lines.join('\n'), this.F('13px', '#9fb3b8')).setLineSpacing(8);

    const cost = shipLevelCost(p.ship, lvl);
    const ay = py + ph - 92;
    if (cost == null) {
      this.bigBtn(lx + lw / 2, ay, 0x5d4037, i18n.t('garage.max_level'), null);
    } else {
      const can = (gs.credits || 0) >= cost;
      this.add.text(lx + lw / 2, ay - 22, `${i18n.t('garage.next_level')}: ${cost.toLocaleString('ru')} кр`,
        this.F('12px', can ? '#66bb6a' : '#ef9a9a')).setOrigin(0.5, 0);
      this.bigBtn(lx + lw / 2, ay, can ? 0x2e7d32 : 0x263238, i18n.t('garage.upgrade_ship'), can ? () => this.upgradeShip() : null);
    }

    // ── Правая колонка: кредит-апгрейд установленных модулей ──
    const rx = px + 400, rw = pw - 440;
    this.add.text(rx, py + 60, i18n.t('garage.modules'), this.O('16px', '#ffe0b2'));
    this.renderModuleUpgrades(rx, py + 92, rw, ph - 150);
  }

  renderModuleUpgrades(x, y, w, h) {
    const p = this.gs.player, gs = this.gs;
    const mods = [];
    for (const k of ['weapon', 'shield', 'engine']) (p.slots[k] || []).forEach((it) => { if (it) mods.push(it); });
    if (!mods.length) { this.add.text(x, y, i18n.t('garage.no_modules'), this.F('14px', '#5e7378')); return; }

    const rowH = 64, gap = 6, maxRows = Math.floor(h / (rowH + gap));
    const bw = 150, bh = 24, bx = x + w - bw - 8;
    mods.slice(0, maxRows).forEach((it, r) => {
      const ry = y + r * (rowH + gap);
      this.add.rectangle(x, ry, w, rowH, 0x10202b, 0.95).setOrigin(0, 0).setStrokeStyle(1, COLORS.primary, 0.2);
      const cl = it.creditLvl || 0, sl = it.starLvl || 0, onStar = sl > 0;
      const pctNow = Math.round((modMult(it) - 1) * 1000) / 10;
      const lvlStr = onStar ? `⭐ ${sl}/5` : `${i18n.t('garage.credit_lvl')} ${cl}/5`;
      this.add.text(x + 12, ry + 8, `${itemName(it)}   ·   ${lvlStr}   (+${pctNow}%)`, this.O('13px', '#ffe0b2'));
      this.add.text(x + 12, ry + 32, this.upgradePreview(it), { ...this.F('11px', '#a5d6a7'), wordWrap: { width: bx - x - 24 } });

      // ── ⭐-кнопка (всегда пока sl<5). Если предмет уже на кредит-пути — старт со сбросом. ──
      const sCost = starUpgradeCost(it);
      const sby = onStar ? ry + (rowH - bh) / 2 : ry + 34;   // только ⭐-путь → центрируем
      if (sCost == null) {
        this.add.text(bx + bw / 2, sby + bh / 2, `⭐ ${i18n.t('garage.max')}`, this.F('11px', '#7e9398')).setOrigin(0.5);
      } else {
        const can = (gs.starGold || 0) >= sCost;
        const b = this.add.rectangle(bx, sby, bw, bh, can ? 0x3a2c12 : 0x1a2a30, 0.95).setOrigin(0, 0)
          .setStrokeStyle(1, can ? COLORS.amber : 0x33484f, 0.85);
        this.add.text(bx + bw / 2, sby + bh / 2, `⭐ ${i18n.t('garage.mod_upgrade')} ${sCost}`,
          this.F('11px', can ? '#ffd54f' : '#5e7378')).setOrigin(0.5);
        if (can) b.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.tryStarUpgrade(it));
      }

      // ── Кредит-кнопка — только пока НЕ на ⭐-пути ──
      if (!onStar) {
        const cCost = creditUpgradeCost(it);
        const cby = ry + 6;
        if (cCost == null) {
          this.add.text(bx + bw / 2, cby + bh / 2, `кред. ${i18n.t('garage.max')}`, this.F('11px', '#7e9398')).setOrigin(0.5);
        } else {
          const can = (gs.credits || 0) >= cCost;
          const b = this.add.rectangle(bx, cby, bw, bh, can ? 0x14331c : 0x1a2a30, 0.95).setOrigin(0, 0)
            .setStrokeStyle(1, can ? COLORS.emerald : 0x33484f, 0.8);
          this.add.text(bx + bw / 2, cby + bh / 2, `${i18n.t('garage.mod_upgrade')} ${cCost.toLocaleString('ru')}`,
            this.F('11px', can ? '#a5d6a7' : '#5e7378')).setOrigin(0.5);
          if (can) b.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.upgradeModule(it));
        }
      }
    });
    if (mods.length > maxRows) this.add.text(x, y + maxRows * (rowH + gap) + 2, `… +${mods.length - maxRows}`, this.F('12px', '#7e9398'));
  }

  // Текущее эффективное значение главного стата модуля (с учётом modMult).
  upgradePreview(it) {
    const k = modMult(it);
    const f = (label, base) => `${label}: ${(base * k).toFixed(1)}`;
    if (it.type === 'cannon') return f(i18n.t('stat.damage'), it.damage);
    if (it.type === 'engine') return f(i18n.t('stat.speed'), it.speed);
    return f(i18n.t('stat.durability'), it.durability);
  }

  upgradeShip() {
    const gs = this.gs, p = gs.player, key = p.ship.key;
    const lvl = gs.shipLevels?.[key] || 1;
    const cost = shipLevelCost(p.ship, lvl);
    if (cost == null || (gs.credits || 0) < cost) return;
    gs.credits -= cost;
    gs.shipLevels = gs.shipLevels || {};
    gs.shipLevels[key] = lvl + 1;
    p.applyShip(p.ship);            // переприменить уровень к активному кораблю (сохранит долю корпуса)
    p.recomputeStats();
    if (p.shield > p.maxShield) p.shield = p.maxShield;
    gs.log(i18n.t('garage.ship_upgraded', { lvl: lvl + 1 }));
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

  // ════════════════ ТАБ «ОБОРУДОВАНИЕ» — слоты модулей + склад ════════════════
  renderEquipTab() {
    const { px, py, pw, ph } = this.box;
    const p = this.gs.player;

    const lx = px + 40, lw = 300;
    this.shipImg(lx + lw / 2, py + 86, 110, p.ship);
    this.add.text(lx + lw / 2, py + 142, i18n.t(p.ship.nameKey), this.O('17px', '#cfe9ee')).setOrigin(0.5, 0);

    // Три группы слотов: оружие (янтарь) / щит (cyan) / двигатели (изумруд)
    this.slotRow(lx, py + 176, i18n.t('garage.weapon'), 'weapon', COLORS.amber);
    this.slotRow(lx, py + 240, i18n.t('garage.shield'), 'shield', COLORS.primary);
    this.slotRow(lx, py + 304, i18n.t('garage.engine'), 'engine', COLORS.emerald);

    const dps = Math.round(p.weaponDamage * p.weaponFireRate);
    const lines = [
      `${i18n.t('garage.dps')}:  ${dps}`,
      `${i18n.t('hud.shield')}:  ${p.maxShield}  (+${p.shieldRegenPerSec}/${i18n.t('unit.sec')})`,
      `${i18n.t('stat.evasion')}:  ${Math.round(p.evasion * 100)}%`,
      `${i18n.t('garage.speed')}:  ${Math.round(p.baseSpeed)}`,
      `${i18n.t('hud.hull')}:  ${p.maxHull}`,
    ];
    this.add.text(lx, py + 376, lines.join('\n'), this.F('13px', '#9fb3b8')).setLineSpacing(7);

    const rx = px + 380, rw = pw - 420;
    this.add.text(rx, py + 60, `${i18n.t('inv.title')}  (${this.gs.inventory.length})`, this.O('16px', '#ffe0b2'));
    this.renderInventory(rx, py + 92, rw, ph - 150);
  }

  // Ряд слотов одного типа: подпись (занято/всего) + квадраты. Клик по занятому → снять.
  slotRow(x, y, label, key, color) {
    const p = this.gs.player;
    const ship = p.ship;
    // Определяем лимит слотов именно для ТЕКУЩЕГО корабля
    const limit = (key === 'weapon') ? ship.wSlots : (key === 'shield') ? ship.sSlots : (ship.eSlots || 0);
    
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
      const box = this.add.rectangle(sx, rowY, sz, sz, it ? 0x12222e : 0x0c1118, 0.95).setOrigin(0, 0)
        .setStrokeStyle(it ? 2 : 1, it ? color : 0x33484f, it ? 0.95 : 0.7);
      if (it) {
        this.add.text(sx + sz / 2, rowY + sz / 2, `T${it.tier}`, this.O('13px', '#e8f3f5')).setOrigin(0.5);
        box.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.unequip(key, i));
      }
    });
  }

  renderInventory(x, y, w, h) {
    const inv = this.gs.inventory;
    if (!inv.length) { this.add.text(x, y, i18n.t('inv.empty'), this.F('14px', '#5e7378')); return; }
    const rowH = 64, gap = 6, maxRows = Math.floor(h / (rowH + gap));
    const bw = 104, bh = 24;            // размеры кнопки «продать»
    inv.slice(0, maxRows).forEach((it, i) => {
      const ry = y + i * (rowH + gap);
      const rect = this.add.rectangle(x, ry, w, rowH, 0x10202b, 0.95).setOrigin(0, 0)
        .setStrokeStyle(1, COLORS.primary, 0.2).setInteractive({ useHandCursor: true });
      rect.on('pointerdown', () => this.equip(it));
      this.add.image(x + 30, ry + rowH / 2, 'lootbox').setDisplaySize(28, 28);

      const price = itemSellPrice(it);
      const bx = x + w - bw - 10, by = ry + (rowH - bh) / 2;
      const sell = this.add.rectangle(bx, by, bw, bh, 0x2a1c10, 0.95).setOrigin(0, 0).setDepth(5)
        .setStrokeStyle(1, COLORS.amber, 0.6).setInteractive({ useHandCursor: true });
      this.add.text(bx + bw / 2, by + bh / 2, `${i18n.t('garage.sell')} ${price}`, this.F('11px', '#ffb74d')).setOrigin(0.5).setDepth(6);
      sell.on('pointerdown', () => this.showSellConfirm(it));

      const textW = bx - 14 - (x + 56);
      this.add.text(x + 56, ry + 9, itemName(it), this.O('14px', '#ffe0b2'));
      this.add.text(x + 56, ry + 33, itemStats(it), { ...this.F('11px', '#cfe9ee'), wordWrap: { width: textW } });
      this.add.text(x + w - 10, ry + 6, i18n.t('garage.equip'), this.F('11px', '#66bb6a')).setOrigin(1, 0);
    });
    if (inv.length > maxRows) this.add.text(x, y + maxRows * (rowH + gap) + 2, `… +${inv.length - maxRows}`, this.F('12px', '#7e9398'));
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
    for (const slot of ['weapon', 'shield']) {
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

    if (slots.length === 0) {
      this.add.text(px + pw / 2, py + ph / 2, 'Нет надетых модулей',
        this.F('16px', '#445566')).setOrigin(0.5);
      return;
    }

    // Track selected slot index
    if (gs.perksSlotIdx === undefined || gs.perksSlotIdx >= slots.length) gs.perksSlotIdx = 0;
    const selIdx = gs.perksSlotIdx;
    const selSlot = slots[selIdx];

    const contentY = py + 58;
    const contentH = ph - 62;

    // ── Left: slot list ──────────────────────────────────────────────────
    const listW = 180;
    const listX = px + 18;
    const itemH = 52;

    this.add.text(listX + listW / 2, contentY + 6, 'СЛОТЫ МОДУЛЕЙ',
      this.O('11px', '#2a4a5a')).setOrigin(0.5, 0);

    slots.forEach(({ item, label }, i) => {
      const iy = contentY + 30 + i * (itemH + 6);
      const active = i === selIdx;
      const pDef = item.perk ? PERK_MAP[item.perk.key] : null;
      const rarColor = pDef ? RARITY_COLOR[pDef.rarity] : 0x334455;

      const card = this.add.rectangle(listX, iy, listW, itemH, active ? 0x0d2030 : 0x081018)
        .setOrigin(0, 0).setStrokeStyle(active ? 2 : 1, active ? COLORS.primary : 0x1a2a3a, 0.9)
        .setInteractive({ useHandCursor: true });
      card.on('pointerdown', () => { gs.perksSlotIdx = i; this.scene.restart(); });
      card.on('pointerover', () => { if (!active) card.setFillStyle(0x0c1828); });
      card.on('pointerout',  () => { if (!active) card.setFillStyle(0x081018); });

      this.add.text(listX + 8, iy + 8, label, this.O('11px', active ? '#4dd0e1' : '#446677')).setOrigin(0, 0);
      if (pDef) {
        const dot = this.add.graphics();
        dot.fillStyle(rarColor, 1); dot.fillCircle(listX + 10, iy + itemH - 14, 4);
        this.add.text(listX + 18, iy + itemH - 22, pDef.name,
          this.F('10px', `#${rarColor.toString(16).padStart(6, '0')}`)).setOrigin(0, 0);
      } else {
        this.add.text(listX + 8, iy + itemH - 22, 'нет перка', this.F('10px', '#223344')).setOrigin(0, 0);
      }
    });

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

    // Perk image
    const imgSize = 96;
    if (this.textures.exists(pDef.key)) {
      const img = this.add.image(cx, cy + imgSize / 2, pDef.key);
      const sc = imgSize / Math.max(img.width, img.height);
      img.setScale(sc).setOrigin(0.5);
    } else {
      // Fallback rect if texture not loaded
      const fg = this.add.graphics();
      fg.fillStyle(rarHex, 0.3); fg.fillRoundedRect(cx - imgSize / 2, cy, imgSize, imgSize, 8);
      fg.lineStyle(2, rarHex, 0.7); fg.strokeRoundedRect(cx - imgSize / 2, cy, imgSize, imgSize, 8);
    }
    cy += imgSize + 12;

    // Rarity badge
    const rbg = this.add.graphics();
    const rlw = 110, rlh = 22;
    rbg.fillStyle(rarHex, 0.15); rbg.fillRoundedRect(cx - rlw / 2, cy, rlw, rlh, 5);
    rbg.lineStyle(1, rarHex, 0.6); rbg.strokeRoundedRect(cx - rlw / 2, cy, rlw, rlh, 5);
    this.add.text(cx, cy + rlh / 2, rarLabel, this.O('10px', rarColor)).setOrigin(0.5);
    cy += rlh + 10;

    // Name
    this.add.text(cx, cy, pDef.name, this.O('16px', rarColor)).setOrigin(0.5, 0);
    cy += 24;

    // Base effect
    this.add.text(cx, cy, pDef.desc(bonus), this.F('13px', '#aaccdd')).setOrigin(0.5, 0);
    cy += 20;

    // Bonus breakdown
    const cLvl = perk.creditLvl || 0, sLvl = perk.starLvl || 0;
    this.add.text(cx, cy,
      `Кред: +${(cLvl * 0.9).toFixed(1)}%  ·  Звёзды: +${(sLvl * 9).toFixed(0)}%`,
      this.F('10px', '#2a4a5a')).setOrigin(0.5, 0);
    cy += 18;

    // Separator
    const dg = this.add.graphics();
    dg.lineStyle(1, 0x162030, 1);
    dg.strokeLineShape(new Phaser.Geom.Line(detX + 16, cy, detX + detW - 16, cy));
    cy += 10;

    // Two upgrade columns
    const halfW = (detW - 40) / 2;
    const colLX = detX + 12, colRX = detX + 20 + halfW;

    // Credits upgrade
    const nextCLvl = cLvl + 1;
    const cCost    = cLvl < 5 ? PERK_CREDIT_COST[cLvl] : null;
    const canCred  = cCost !== null && (gs.credits || 0) >= cCost;

    this.add.text(colLX + halfW / 2, cy, `💰 ПРОКАЧКА (кредиты)`,
      this.O('10px', '#3a6a4a')).setOrigin(0.5, 0);
    this.add.text(colLX + halfW / 2, cy + 16,
      `Ур. ${cLvl}/5  →  +${(cLvl * 0.9).toFixed(1)}% бонус`,
      this.F('10px', '#2a4a3a')).setOrigin(0.5, 0);

    if (cCost !== null) {
      const cbg = this.add.rectangle(colLX + halfW / 2, cy + 48, halfW - 4, 32,
        canCred ? 0x081a10 : 0x060810)
        .setOrigin(0.5).setStrokeStyle(1, canCred ? 0x44aa55 : 0x1a2a1a, 0.9)
        .setInteractive({ useHandCursor: canCred });
      this.add.text(colLX + halfW / 2, cy + 48,
        canCred ? `▲ ${cCost.toLocaleString('ru')} кр` : `🔒 ${cCost.toLocaleString('ru')} кр`,
        this.F('12px', canCred ? '#66cc77' : '#334455')).setOrigin(0.5);
      if (canCred) {
        cbg.on('pointerover', () => cbg.setFillStyle(0x102818));
        cbg.on('pointerout',  () => cbg.setFillStyle(0x081a10));
        cbg.on('pointerdown', () => {
          gs.credits  = (gs.credits || 0) - cCost;
          item.perk.creditLvl = nextCLvl - 1 + 1; // = nextCLvl
          this.scene.restart();
        });
      }
    } else {
      this.add.text(colLX + halfW / 2, cy + 48, '✓ MAX (кред.)',
        this.F('11px', '#66cc77')).setOrigin(0.5);
    }

    // Stars upgrade
    const nextSLvl = sLvl + 1;
    const sCost    = sLvl < 5 ? PERK_STAR_COST[sLvl] : null;
    const canStar  = sCost !== null && (gs.starGold || 0) >= sCost;

    this.add.text(colRX + halfW / 2, cy, `⭐ ПРОКАЧКА (звёзды)`,
      this.O('10px', '#3a5a1a')).setOrigin(0.5, 0);
    this.add.text(colRX + halfW / 2, cy + 16,
      `Ур. ${sLvl}/5  →  +${(sLvl * 9).toFixed(0)}% бонус`,
      this.F('10px', '#3a4a1a')).setOrigin(0.5, 0);

    if (sCost !== null) {
      const sbg = this.add.rectangle(colRX + halfW / 2, cy + 48, halfW - 4, 32,
        canStar ? 0x1a1200 : 0x060810)
        .setOrigin(0.5).setStrokeStyle(1, canStar ? 0xaa9900 : 0x2a2200, 0.9)
        .setInteractive({ useHandCursor: canStar });
      this.add.text(colRX + halfW / 2, cy + 48,
        canStar ? `▲ ${sCost} ⭐` : `🔒 ${sCost} ⭐`,
        this.F('12px', canStar ? '#ffcc44' : '#334455')).setOrigin(0.5);
      if (canStar) {
        sbg.on('pointerover', () => sbg.setFillStyle(0x261c00));
        sbg.on('pointerout',  () => sbg.setFillStyle(0x1a1200));
        sbg.on('pointerdown', () => {
          gs.starGold    = (gs.starGold || 0) - sCost;
          item.perk.starLvl = nextSLvl - 1 + 1;
          this.scene.restart();
        });
      }
    } else {
      this.add.text(colRX + halfW / 2, cy + 48, '✓ MAX (звёзды)',
        this.F('11px', '#ffcc44')).setOrigin(0.5);
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
      this.F('12px', canReroll ? '#bb88dd' : '#334455')).setOrigin(0.5);
    if (canReroll) {
      rbg.on('pointerover', () => rbg.setFillStyle(0x180a24));
      rbg.on('pointerout',  () => rbg.setFillStyle(0x100818));
      rbg.on('pointerdown', () => {
        gs.starGold = (gs.starGold || 0) - rerollCost;
        gs.perkRerollCounts[rerollKey] = rerollN + 1;
        const slotType = item.type === 'cannon' ? 'cannon' : 'shield';
        item.perk = rollPerk(slotType);
        this.scene.restart();
      });
    }

    // Daily reset hint
    this.add.text(cx, ry + 24, 'Счётчик попыток сбрасывается в 00:00 UTC',
      this.F('9px', '#1a2535')).setOrigin(0.5, 0);
  }
}
