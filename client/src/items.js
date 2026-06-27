import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { i18n } from './i18n.js';
import { rollPerk } from './perks.js';

// Модули MVP: Плазма-пушки и Дефлекторы (щиты), тиры T1-T4.
// Числа подобраны под играбельность прототипа (сохраняя дизайн-пропорции тиров).
// roll: base × random(0.85, 1.15) × (1 + max(0, mob_lvl − tier_min)/50)

const CANNON_TIERS = {
  1: { min: 1,  dmg: 20,  pen: 0 },
  2: { min: 11, dmg: 38,  pen: 0 },
  3: { min: 21, dmg: 65,  pen: 0 },
  4: { min: 31, dmg: 105, pen: 0 },
};

const SHIELD_TIERS = {
  1: { min: 1,  dur: 300,  regen: 30,  eva: 0.02 },
  2: { min: 11, dur: 550,  regen: 45,  eva: 0.04 },
  3: { min: 21, dur: 900,  regen: 70,  eva: 0.07 },
  4: { min: 31, dur: 1500, regen: 100, eva: 0.10 },
};

// Броня — прибавка к корпусу (hull). Ставится в слоты щита (sSlots), альтернатива щиту.
// Нет регенерации и уклонения — чистая прочность. 90% от показателей щита по тирам.
// Hull-бонус НЕ масштабируется множителем уровня корабля; добавляется плоско к maxHull.
const ARMOR_TIERS = {
  1: { min: 1,  hull: 270  },
  2: { min: 11, hull: 500  },
  3: { min: 21, hull: 810  },
  4: { min: 31, hull: 1350 },
};

// Двигатели — прирост скорости (px/сек). Ставятся в слоты двигателей (eSlots), со 2-го корабля.
// Значения уменьшены в 3× относительно первоначальных (T4 max-star: ~39 вместо ~116).
const ENGINE_TIERS = {
  1: { min: 1,  speed: 10 },
  2: { min: 11, speed: 15 },
  3: { min: 21, speed: 20 },
  4: { min: 31, speed: 27 },
};

// Laser cannon — single legendary, no tiers.
// Dmg = Plasma T4 × 1.32 (10% above T4 + elite ammo).
// Drops only from Apophis (bigboss). Occupies a weapon slot.
// Special: -20% dmg to shields, +50% dmg to bare hull, 70% base accuracy.
const LASER_DMG = 126; // T4 plasma (105) × 1.20 — 20% stronger than base T4

const roll = () => Phaser.Math.FloatBetween(0.85, 1.15);

export function rollCannon(tier, mobLevel) {
  const t = CANNON_TIERS[tier];
  const scale = 1 + Math.max(0, mobLevel - t.min) / 50;
  return {
    type: 'cannon', tier,
    damage: Math.round(t.dmg * roll() * scale),
    penetration: +(t.pen * roll()).toFixed(3),
    fireRate: 1.0,
    perk: rollPerk('cannon'),
  };
}

export function rollShield(tier, mobLevel) {
  const t = SHIELD_TIERS[tier];
  const scale = 1 + Math.max(0, mobLevel - t.min) / 50;
  return {
    type: 'shield', tier,
    durability: Math.round(t.dur * roll() * scale),
    regen: Math.round(t.regen * roll()),
    evasion: +(t.eva * roll()).toFixed(3),
    perk: rollPerk('shield'),
  };
}

export function rollEngine(tier, mobLevel) {
  const t = ENGINE_TIERS[tier];
  const scale = 1 + Math.max(0, mobLevel - t.min) / 50;
  return { type: 'engine', tier, speed: Math.round(t.speed * roll() * scale), perk: rollPerk('engine') };
}

export function rollArmor(tier, mobLevel) {
  const t = ARMOR_TIERS[tier];
  const scale = 1 + Math.max(0, mobLevel - t.min) / 50;
  return {
    type: 'armor', tier,
    hullBonus: Math.round(t.hull * roll() * scale),
    perk: rollPerk('armor'),
  };
}

export function rollLaser() {
  return {
    type: 'laser', tier: 4,
    damage: Math.round(LASER_DMG * roll()),
    penetration: 0,
    fireRate: 1.0,
    perk: rollPerk('laser'),
  };
}

// Apophis boss drop: 8% laser, otherwise T4 random module.
export function rollApophisLoot() {
  if (Math.random() < 0.08) return rollLaser();
  const r = Phaser.Math.Between(0, 99);
  const maker = r < 45 ? rollCannon : r < 80 ? rollShield : rollEngine;
  return maker(4, 50);
}

// Стартовое снаряжение (фиксированное, чтобы корабль сразу был боеспособен).
export function starterCannon() { return { type: 'cannon', tier: 1, damage: 21, penetration: 0.02, fireRate: 1.0 }; }
export function starterShield() { return { type: 'shield', tier: 1, durability: 320, regen: 30, evasion: 0.02 }; }

// Дефолтный лоадаут корабля: слоты по типам, слот 0 оружия/щита засеян T1 (чтобы был боеспособен),
// двигатели пустые (опциональны). Хранится per-ship в GameScene.loadouts — модули физически на корабле.
export function defaultLoadout(wSlots, sSlots, eSlots) {
  const weapon = Array(wSlots).fill(null); if (wSlots > 0) weapon[0] = starterCannon();
  const shield = Array(sSlots).fill(null); if (sSlots > 0) shield[0] = starterShield();
  const engine = Array(eSlots).fill(null);
  return { weapon, shield, engine };
}

// item.type → ключ группы слотов на корабле
export const SLOT_KEY = { cannon: 'weapon', laser: 'weapon', shield: 'shield', armor: 'shield', engine: 'engine' };

// ── Апгрейд модулей: ДВА ВЗАИМОИСКЛЮЧАЮЩИХ пути ──
//  • кредитный — дёшево, слабо: 5 уровней, +1%/ур → до +5%;
//  • ⭐ Звёздное золото — дорого, сильно: 5 уровней, +3%/ур → до +15%.
// Пути НЕ складываются: старт ⭐-пути СБРАСЫВАЕТ кредитный прогресс (creditLvl→0). См. Гараж.
export const CREDIT_UP_COST = [15000, 30000, 75000, 150000, 330000];  // кредиты за ур.1..5
export const STAR_UP_COST = [25, 40, 60, 80, 100];                  // ⭐ за ур.1..5 (Σ=305)
export const MOD_MAX_CREDIT_LVL = 5;
export const MOD_MAX_STAR_LVL = 5;
// Суммарный множитель статов модуля от обоих уровней (в норме активен только один путь).
export function modMult(item) { return 1 + 0.01 * (item.creditLvl || 0) + 0.03 * (item.starLvl || 0); }
// Кредиты для следующего кредит-апгрейда; null если макс.
export function creditUpgradeCost(item) {
  const lvl = item.creditLvl || 0;
  return lvl >= MOD_MAX_CREDIT_LVL ? null : CREDIT_UP_COST[lvl];
}
// ⭐ для следующего ⭐-апгрейда; null если макс.
export function starUpgradeCost(item) {
  const lvl = item.starLvl || 0;
  return lvl >= MOD_MAX_STAR_LVL ? null : STAR_UP_COST[lvl];
}

// Цена продажи лута на складе (по тиру).
const SELL_PRICE = { 1: 200, 2: 550, 3: 1300, 4: 3000 };
export function itemSellPrice(item) { return SELL_PRICE[item.tier] || 100; }

// ── Consumables & Materials ───────────────────────────────────────────────────
export const CONSUMABLES = {
  repair_pack:     { category: 'consumable', maxPerSlot: 100,   canBuy: true,  price: 3500, sell: 100 },
  speed_boost:     { category: 'consumable', maxPerSlot: 100,   canBuy: true,  price: 2800, sell: 100 },
  scanner_pulse:   { category: 'consumable', maxPerSlot: 100,   canBuy: true,  price: 1800, sell: 100 },
  emergency_warp:  { category: 'consumable', maxPerSlot:  50,   canBuy: true,  price: 5000, sell: 100 },
  biomech_core:    { category: 'material',      maxPerSlot:   5,   canBuy: false, price: 0, sell: 0 },
  quantum_crystal: { category: 'material',      maxPerSlot:   5,   canBuy: false, price: 0, sell: 0 },
  plasma_coil:     { category: 'material',      maxPerSlot:   5,   canBuy: false, price: 0, sell: 0 },
  biomech_fragment: { category: 'dungeonResource', maxPerSlot: 9999, canBuy: false, price: 0, sell: 0 },
  quantum_shard:    { category: 'dungeonResource', maxPerSlot: 9999, canBuy: false, price: 0, sell: 0 },
  plasma_strand:    { category: 'dungeonResource', maxPerSlot: 9999, canBuy: false, price: 0, sell: 0 },
  // Boosters — temporary stat multipliers
  damage_booster: { category: 'consumable', maxPerSlot: 10, canBuy: true,  price: 8000,  sell: 500 },
  hull_booster:   { category: 'consumable', maxPerSlot: 10, canBuy: true,  price: 6000,  sell: 500 },
  shield_booster: { category: 'consumable', maxPerSlot: 10, canBuy: true,  price: 6000,  sell: 500 },
  xp_booster:     { category: 'consumable', maxPerSlot: 10, canBuy: true,  price: 10000, sell: 500 },
  // Ammo — auto-consumed on fire; max 10000 per ammo slot
  ammo_plasma:       { category: 'ammo', maxPerSlot: 10000, canBuy: true,  price: 100, sell: 50  },
  ammo_plasma_elite: { category: 'ammo', maxPerSlot: 10000, canBuy: true,  price: 200, sell: 100 },
  ammo_laser:        { category: 'ammo', maxPerSlot: 10000, canBuy: false, price: 0,   sell: 50  },
};

// ── Dungeon resource system ───────────────────────────────────────────────────
export const DUNGEON_RES_EXCHANGE_RATE = 500; // resources → 1 material
export const DUNGEON_RES_TO_MATERIAL = {
  biomech_fragment: 'biomech_core',
  quantum_shard:    'quantum_crystal',
  plasma_strand:    'plasma_coil',
};
export const BUFF_KEY_TO_RESOURCE = {
  hull:   'biomech_fragment',
  shield: 'quantum_shard',
  damage: 'plasma_strand',
};
export const BUFF_KEY_TO_MATERIAL = {
  hull:   'biomech_core',
  shield: 'quantum_crystal',
  damage: 'plasma_coil',
};
export const RESOURCE_NAMES = {
  biomech_fragment: 'Органит',
  quantum_shard:    'Фазолит',
  plasma_strand:    'Каленит',
};
export const MATERIAL_NAMES = {
  biomech_core:    'Органит-ядро',
  quantum_crystal: 'Фазолит-кристалл',
  plasma_coil:     'Каленит-катушка',
};

// Visual info for ammo types (canvas icon generation)
export const AMMO_ICON = {
  ammo_plasma:       { icon: 'П',  color: 0xffb74d },
  ammo_plasma_elite: { icon: 'ПЭ', color: 0xe53935 },
  ammo_laser:        { icon: 'Л',  color: 0x7c4dff },
};

export function addConsumableToInventory(inventory, type, amount, maxSlots) {
  const def = CONSUMABLES[type];
  if (!def) return amount;
  let rem = amount;
  for (const it of inventory) {
    if (it.type !== type || it.amount >= def.maxPerSlot) continue;
    const space = def.maxPerSlot - it.amount;
    const add = Math.min(space, rem);
    it.amount += add;
    rem -= add;
    if (rem <= 0) return 0;
  }
  while (rem > 0 && inventory.length < maxSlots) {
    const add = Math.min(def.maxPerSlot, rem);
    inventory.push({ type, amount: add });
    rem -= add;
  }
  return rem;
}

export function countConsumableInInventory(inventory, type) {
  return (inventory || []).filter(i => i.type === type).reduce((s, i) => s + i.amount, 0);
}

export function removeConsumableFromInventory(inventory, type, amount) {
  let rem = amount;
  for (let i = inventory.length - 1; i >= 0 && rem > 0; i--) {
    if (inventory[i].type !== type) continue;
    const take = Math.min(inventory[i].amount, rem);
    inventory[i].amount -= take;
    rem -= take;
    if (inventory[i].amount <= 0) inventory.splice(i, 1);
  }
  return amount - rem;
}

const _CONS_KEYS = Object.keys(CONSUMABLES);
const _MAT_KEYS  = _CONS_KEYS.filter(k => CONSUMABLES[k].category === 'material');
const _USE_KEYS  = _CONS_KEYS.filter(k => CONSUMABLES[k].category === 'consumable');

export function rollConsumableDrop(mob) {
  const chance = (mob.isBoss || mob.tpl.elite) ? 0.40 : 0.12;
  if (Phaser.Math.FloatBetween(0, 1) > chance) return null;
  if ((mob.isBoss || mob.tpl.elite) && Phaser.Math.FloatBetween(0, 1) < 0.5) {
    const type = _MAT_KEYS[Phaser.Math.Between(0, _MAT_KEYS.length - 1)];
    return { type, amount: 1 };
  }
  const type = _USE_KEYS[Phaser.Math.Between(0, _USE_KEYS.length - 1)];
  return { type, amount: Phaser.Math.Between(1, 3) };
}

export function itemIconKey(item) {
  if (!item) return null;
  if (item.type === 'plasmate') return 'plasmate_icon';
  if (CONSUMABLES[item.type])  return `consumable_${item.type}`;
  if (item.type === 'laser')   return 'mod_laser';
  const t = Math.min(item.tier || 1, 4);
  if (item.type === 'cannon') return `mod_plasma_t${t}`;
  if (item.type === 'shield') return `mod_shield_t${t}`;
  if (item.type === 'engine') return `mod_engine_t${t}`;
  if (item.type === 'armor')  return `mod_armor_t${t}`;
  return null;
}

// ── Plasmate resource ─────────────────────────────────────────────────────────
export const PLASMATE_PER_SLOT  = 500;   // units per cargo slot
export const PLASMATE_DAILY_MAX = 20000;  // daily collection cap
export const PLASMATE_GOLD_RATE = 500;   // units → 1 starGold

// Add amount to inventory plasmate stacks; returns leftover that didn't fit.
export function addPlasmateToInventory(inventory, amount, maxSlots) {
  let rem = amount;
  for (const it of inventory) {
    if (it.type !== 'plasmate' || it.amount >= PLASMATE_PER_SLOT) continue;
    const space = PLASMATE_PER_SLOT - it.amount;
    const add   = Math.min(space, rem);
    it.amount += add;
    rem -= add;
    if (rem <= 0) return 0;
  }
  while (rem > 0 && inventory.length < maxSlots) {
    const add = Math.min(PLASMATE_PER_SLOT, rem);
    inventory.push({ type: 'plasmate', amount: add });
    rem -= add;
  }
  return rem;
}

export function totalPlasmateInInventory(inventory) {
  return (inventory || []).filter(i => i.type === 'plasmate').reduce((s, i) => s + i.amount, 0);
}

// Remove up to `amount` plasmate from last-to-first slots; returns actually removed.
export function removePlasmateFromInventory(inventory, amount) {
  let rem = amount;
  for (let i = inventory.length - 1; i >= 0 && rem > 0; i--) {
    if (inventory[i].type !== 'plasmate') continue;
    const take = Math.min(inventory[i].amount, rem);
    inventory[i].amount -= take;
    rem -= take;
    if (inventory[i].amount <= 0) inventory.splice(i, 1);
  }
  return amount - rem;
}

export function dropChance(mob) { return mob.isBoss ? 1 : 0.6; }

// Дроп ⭐ Звёздного золота: шаблон моба задаёт {min,max,chance}. Боссы — гарантированно, элита — редко.
export function rollStarGold(mob) {
  const sg = mob.tpl.starGold;
  if (!sg) return 0;
  if (Phaser.Math.FloatBetween(0, 1) > sg.chance) return 0;
  return Phaser.Math.Between(sg.min, sg.max);
}

// Тир модуля привязан к УРОВНЮ моба (= карте): T1 ур.1-10, T2 11-20, T3 21-30, T4 31+.
// Так на первой карте падает только T1, а T4 — лишь с мобов/боссов 31+ ур. (HM4+).
function tierForLevel(L) { return L >= 31 ? 4 : L >= 21 ? 3 : L >= 11 ? 2 : 1; }

// Тир по уровню моба (+ шанс +1 тир у боссов/элиты) + случайный тип (пушка / щит / двигатель).
export function rollLootForMob(mob) {
  let tier = tierForLevel(mob.level);
  if ((mob.isBoss || mob.tpl.elite) && tier < 4 && Phaser.Math.Between(0, 99) < 30) tier++;
  const r = Phaser.Math.Between(0, 99);          // 40% пушка / 30% щит / 20% двигатель / 10% броня
  const maker = r < 40 ? rollCannon : r < 70 ? rollShield : r < 90 ? rollEngine : rollArmor;
  return maker(tier, mob.level);
}

// Имя предмета (через i18n).
export function itemName(item) {
  if (item.type === 'plasmate') return `${i18n.t('item.plasmate')} ×${item.amount}`;
  if (CONSUMABLES[item.type])  return `${i18n.t(`item.${item.type}`)} ×${item.amount}`;
  if (item.type === 'laser') return i18n.t('item.laser');
  const key = item.type === 'cannon' ? 'item.cannon'
            : item.type === 'shield' ? 'item.shield'
            : item.type === 'armor'  ? 'item.armor'
            : 'item.engine';
  return `${i18n.t(key)} T${item.tier}`;
}

// Строка статов для UI. Эффективные значения учитывают кредитный апгрейд (modMult).
export function itemStats(item) {
  if (!item || item.type === 'plasmate' || CONSUMABLES[item.type]) return null;
  const k = modMult(item);
  const up = (item.creditLvl || 0) > 0 ? `   ·   ↑${item.creditLvl}` : '';
  if (item.type === 'laser') {
    return `${i18n.t('stat.damage')} ${Math.round(item.damage * k)}   ·   ${i18n.t('stat.accuracy')} 80%   ·   ${i18n.t('stat.firerate')} ${item.fireRate.toFixed(1)}/${i18n.t('unit.sec')}   ·   щит -10%  корпус +30%${up}`;
  }
  if (item.type === 'cannon') {
    return `${i18n.t('stat.damage')} ${Math.round(item.damage * k)}   ·   ${i18n.t('stat.penetration')} ${Math.round(item.penetration * k * 100)}%   ·   ${i18n.t('stat.firerate')} ${item.fireRate.toFixed(1)}/${i18n.t('unit.sec')}${up}`;
  }
  if (item.type === 'engine') {
    return `${i18n.t('stat.speed')} +${Math.round(item.speed * k)}${up}`;
  }
  if (item.type === 'armor') {
    return `${i18n.t('stat.hull')} +${Math.round(item.hullBonus * k)}${up}`;
  }
  return `${i18n.t('stat.durability')} ${Math.round(item.durability * k)}   ·   ${i18n.t('stat.regen')} ${Math.round(item.regen * k)}/${i18n.t('unit.sec')}   ·   ${i18n.t('stat.evasion')} ${Math.round(item.evasion * k * 100)}%${up}`;
}
