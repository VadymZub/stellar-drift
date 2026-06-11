import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { i18n } from './i18n.js';

// Модули MVP: Плазма-пушки и Дефлекторы (щиты), тиры T1-T4.
// Числа подобраны под играбельность прототипа (сохраняя дизайн-пропорции тиров).
// roll: base × random(0.85, 1.15) × (1 + max(0, mob_lvl − tier_min)/50)

const CANNON_TIERS = {
  1: { min: 1,  dmg: 40,  pen: 0.02 },
  2: { min: 11, dmg: 75,  pen: 0.06 },
  3: { min: 21, dmg: 130, pen: 0.12 },
  4: { min: 31, dmg: 210, pen: 0.20 },
};

const SHIELD_TIERS = {
  1: { min: 1,  dur: 300,  regen: 30,  eva: 0.02 },
  2: { min: 11, dur: 550,  regen: 45,  eva: 0.04 },
  3: { min: 21, dur: 900,  regen: 70,  eva: 0.07 },
  4: { min: 31, dur: 1500, regen: 100, eva: 0.10 },
};

// Двигатели — прирост скорости (px/сек). Ставятся в слоты двигателей (eSlots), со 2-го корабля.
const ENGINE_TIERS = {
  1: { min: 1,  speed: 30 },
  2: { min: 11, speed: 45 },
  3: { min: 21, speed: 60 },
  4: { min: 31, speed: 80 },
};

const roll = () => Phaser.Math.FloatBetween(0.85, 1.15);

export function rollCannon(tier, mobLevel) {
  const t = CANNON_TIERS[tier];
  const scale = 1 + Math.max(0, mobLevel - t.min) / 50;
  return {
    type: 'cannon', tier,
    damage: Math.round(t.dmg * roll() * scale),
    penetration: +(t.pen * roll()).toFixed(3),
    fireRate: 1.0,
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
  };
}

export function rollEngine(tier, mobLevel) {
  const t = ENGINE_TIERS[tier];
  const scale = 1 + Math.max(0, mobLevel - t.min) / 50;
  return { type: 'engine', tier, speed: Math.round(t.speed * roll() * scale) };
}

// Стартовое снаряжение (фиксированное, чтобы корабль сразу был боеспособен).
export function starterCannon() { return { type: 'cannon', tier: 1, damage: 42, penetration: 0.02, fireRate: 1.0 }; }
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
export const SLOT_KEY = { cannon: 'weapon', shield: 'shield', engine: 'engine' };

// ── Апгрейд модулей: ДВА ВЗАИМОИСКЛЮЧАЮЩИХ пути (2026-06-04) ──
//  • кредитный — дёшево, слабо: 5 уровней, +1.5%/ур → до +7.5%;
//  • ⭐ Звёздное золото — дорого, сильно: 5 уровней, +9%/ур → до +45%.
// Пути НЕ складываются: старт ⭐-пути СБРАСЫВАЕТ кредитный прогресс (creditLvl→0). См. Гараж.
export const CREDIT_UP_COST = [5000, 10000, 25000, 50000, 100000];  // кредиты за ур.1..5
export const STAR_UP_COST = [25, 40, 60, 80, 100];                  // ⭐ за ур.1..5 (Σ=305)
export const MOD_MAX_CREDIT_LVL = 5;
export const MOD_MAX_STAR_LVL = 5;
// Суммарный множитель статов модуля от обоих уровней (в норме активен только один путь).
export function modMult(item) { return 1 + 0.015 * (item.creditLvl || 0) + 0.09 * (item.starLvl || 0); }
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
  const r = Phaser.Math.Between(0, 99);          // 45% пушка / 35% щит / 20% двигатель
  const maker = r < 45 ? rollCannon : r < 80 ? rollShield : rollEngine;
  return maker(tier, mob.level);
}

// Имя предмета (через i18n).
export function itemName(item) {
  const key = item.type === 'cannon' ? 'item.cannon' : item.type === 'shield' ? 'item.shield' : 'item.engine';
  return `${i18n.t(key)} T${item.tier}`;
}

// Строка статов для UI. Эффективные значения учитывают кредитный апгрейд (modMult).
export function itemStats(item) {
  const k = modMult(item);
  const up = (item.creditLvl || 0) > 0 ? `   ·   ↑${item.creditLvl}` : '';
  if (item.type === 'cannon') {
    return `${i18n.t('stat.damage')} ${Math.round(item.damage * k)}   ·   ${i18n.t('stat.penetration')} ${Math.round(item.penetration * k * 100)}%   ·   ${i18n.t('stat.firerate')} ${item.fireRate.toFixed(1)}/${i18n.t('unit.sec')}${up}`;
  }
  if (item.type === 'engine') {
    return `${i18n.t('stat.speed')} +${Math.round(item.speed * k)}${up}`;
  }
  return `${i18n.t('stat.durability')} ${Math.round(item.durability * k)}   ·   ${i18n.t('stat.regen')} ${Math.round(item.regen * k)}/${i18n.t('unit.sec')}   ·   ${i18n.t('stat.evasion')} ${Math.round(item.evasion * k * 100)}%${up}`;
}
