// Perk system: each weapon/shield module slot has one random perk.
// Credits upgrade path: 5 levels, +4.5% total bonus.
// Stars upgrade path: 5 levels, +45% total bonus.
// Reroll: costs starGold (200⭐ base, escalates per day, resets daily).
// Roll quality: 0.6–1.0 (drop-skewed toward 0.6), refineable with starGold.

// Credit upgrade cost per step (0→1..4→5), keyed by module tier 1–4
export const PERK_CREDIT_COST = {
  1: [1500, 3500,  8000,  20000,  47000],   // Σ = 80 000
  2: [3000, 7000,  16000, 40000,  94000],   // Σ = 160 000
  3: [5000, 12000, 29000, 72000,  170000],  // Σ = 288 000
  4: [7000, 17000, 40000, 100000, 236000],  // Σ = 400 000
};
// Star upgrade cost per step, keyed by module tier 1–4
export const PERK_STAR_COST = {
  1: [2,  5,  10, 20,  53],   // Σ = 90 ⭐
  2: [5,  10, 20, 40,  100],  // Σ = 175 ⭐
  3: [7,  18, 35, 70,  175],  // Σ = 305 ⭐
  4: [10, 25, 50, 100, 250],  // Σ = 435 ⭐
};
// Reroll escalation (per item, resets 00:00 UTC)
export const PERK_REROLL_BASE = 200;

// ─── Roll quality ──────────────────────────────────────────────────────────────
// Roll is stored as perk.roll ∈ [0.6, 1.0]. Higher = stronger base effect.
// Colors chosen not to conflict with RARITY_COLOR (green/purple/yellow/red).
export const ROLL_QUALITY_TIERS = [
  { min: 1.00, label: 'ПЕРФЕКТ',  color: 0xe8eaf6 }, // near-white
  { min: 0.95, label: 'ОТЛИЧНОЕ', color: 0xff7043 }, // deep orange
  { min: 0.85, label: 'СИЛЬНОЕ',  color: 0x00bcd4 }, // cyan
  { min: 0.75, label: 'ХОРОШЕЕ',  color: 0x29b6f6 }, // light blue
  { min: 0.00, label: 'СЛАБОЕ',   color: 0x78909c }, // blue-grey
];

// Refinement cost per tier (basic / advanced / premium), paid in starGold
export const REFINE_COST = {
  1: [30,  80,  200],
  2: [60,  160, 400],
  3: [100, 280, 700],
  4: [160, 450, 1100],
};

// Credit bonus per level (additive fraction, level 1–5)
export const CREDIT_BONUS_PER_LVL = [0, 0.009, 0.018, 0.027, 0.036, 0.045]; // index = lvl
// Star bonus per level
export const STAR_BONUS_PER_LVL   = [0, 0.09,  0.18,  0.27,  0.36,  0.45 ];

// Rarity weights for random rolls
const WEIGHTS = { common: 55, uncommon: 30, rare: 12, jackpot: 3 };

// Rarity display colors
export const RARITY_COLOR = {
  common:   0x66bb6a,  // green
  uncommon: 0xab47bc,  // purple
  rare:     0xffd54f,  // yellow
  jackpot:  0xef5350,  // red
};

export const RARITY_LABEL = {
  common: 'ОБЫЧНЫЙ', uncommon: 'НЕОБЫЧНЫЙ', rare: 'РЕДКИЙ', jackpot: 'ДЖЕКПОТ',
};

// ─── Perk definitions ─────────────────────────────────────────────────────────
// effect: description of base effect at roll=1.0, credit/star lvl 0
// desc(b, r): b = perkBonus result, r = perk.roll (default 1)
// slot: 'weapon' | 'shield' | 'laser' | 'engine' | 'armor'

// Легенда области действия:
//  · к кораблю         — суммируется с другими такими же
//  · к кораблю (макс.) — берётся лучший, не суммируется
//  · к предмету        — умножает вклад именно этого предмета
export const PERK_DEFS = [
  // Weapon perks
  { key: 'perk_anti_armor',    imgFile: 'Anti-armor.png',         name: 'Anti-Armor',
    slot: 'weapon', rarity: 'uncommon',
    effect: '+20% урон по низкощитовым (<25%)',
    desc: (b, r = 1) => `+${+(20 * r * (1 + b)).toFixed(1)}% урон по незащищённым · к кораблю` },

  { key: 'perk_critical_edge', imgFile: 'Critical Edge.png',      name: 'Critical Edge',
    slot: 'weapon', rarity: 'rare',
    effect: '+12% шанс критического удара',
    desc: (b, r = 1) => `+${+(12 * r * (1 + b)).toFixed(1)}% крит. шанс · к кораблю` },

  { key: 'perk_hull_breaker',  imgFile: 'Hull-breaker.png',       name: 'Hull-Breaker',
    slot: 'weapon', rarity: 'uncommon',
    effect: '+5% пробитие брони (суммарно макс. 15%)',
    desc: (b, r = 1) => `+${+(5 * r * (1 + b)).toFixed(1)}% пробитие · к кораблю, макс. 15% суммарно` },

  { key: 'perk_marksman',      imgFile: 'Marksman.png',           name: 'Marksman',
    slot: 'weapon', rarity: 'common',
    effect: '+15% урон по неподвижным целям',
    desc: (b, r = 1) => `+${+(15 * r * (1 + b)).toFixed(1)}% урон по стоячей цели · к кораблю` },

  { key: 'perk_plasma_bleed',  imgFile: 'Plasma Bleed.png',       name: 'Plasma Bleed',
    slot: 'weapon', rarity: 'rare',
    effect: '+10% урон за 2с (DOT-эффект)',
    desc: (b, r = 1) => `+${+(10 * r * (1 + b)).toFixed(1)}% DOT 2с · к кораблю` },

  { key: 'perk_splinter',      imgFile: 'Splinter.png',           name: 'Splinter',
    slot: 'weapon', rarity: 'uncommon',
    effect: '+8% урон AOE при взрыве снаряда',
    desc: (b, r = 1) => `+${+(8 * r * (1 + b)).toFixed(1)}% AOE · к кораблю` },

  { key: 'perk_steady_aim',    imgFile: 'Steady Aim.png',         name: 'Steady Aim',
    slot: 'weapon', rarity: 'common',
    effect: '+10% урон этой пушки',
    desc: (b, r = 1) => `+${+(10 * r * (1 + b)).toFixed(1)}% урон · к предмету (вклад в общий урон)` },

  { key: 'perk_vengeance',     imgFile: 'Vengeance.png',          name: 'Vengeance',
    slot: 'weapon', rarity: 'jackpot',
    effect: '+40% урон пока HP < 40%',
    desc: (b, r = 1) => `+${+(40 * r * (1 + b)).toFixed(1)}% урон при HP<40% · к кораблю` },

  // Shield perks
  { key: 'perk_adaptive',          imgFile: 'Adaptive.png',           name: 'Adaptive',
    slot: 'shield', rarity: 'common',
    effect: '+12% сопротивление текущему типу урона',
    desc: (b, r = 1) => `+${+(12 * r * (1 + b)).toFixed(1)}% адаптивное сопр. · к кораблю` },

  { key: 'perk_cooperative',        imgFile: 'Cooperative.png',        name: 'Cooperative',
    slot: 'shield', rarity: 'rare',
    effect: 'Аура: +8% щит союзникам в радиусе 600px',
    desc: (b, r = 1) => `Аура: +${+(8 * r * (1 + b)).toFixed(1)}% щит союзникам · к кораблю` },

  { key: 'perk_energy_shunt',       imgFile: 'Energy Shunt.png',       name: 'Energy Shunt',
    slot: 'shield', rarity: 'uncommon',
    effect: '+15% рег. щита за каждый убитый моб (5с)',
    desc: (b, r = 1) => `+${+(15 * r * (1 + b)).toFixed(1)}% рег. щита с убийства · к кораблю` },

  { key: 'perk_hardened',           imgFile: 'Hardened.png',           name: 'Hardened',
    slot: 'shield', rarity: 'common',
    effect: '+10% сопротивление входящему урону',
    desc: (b, r = 1) => `+${+(10 * r * (1 + b)).toFixed(1)}% физ. сопр. · к кораблю, суммируется` },

  { key: 'perk_last_stand',         imgFile: 'Last Stand.png',         name: 'Last Stand',
    slot: 'shield', rarity: 'jackpot',
    effect: '+50% все статы когда HP < 20%',
    desc: (b, r = 1) => `+${+(50 * r * (1 + b)).toFixed(1)}% все статы при HP<20% · к кораблю` },

  { key: 'perk_pack_aura',          imgFile: 'Pack Aura.png',          name: 'Pack Aura',
    slot: 'shield', rarity: 'rare',
    effect: 'Аура: +5% урон всем союзникам рядом',
    desc: (b, r = 1) => `Аура: +${+(5 * r * (1 + b)).toFixed(1)}% урон союзникам · к кораблю` },

  { key: 'perk_phase_shifter',      imgFile: 'Phase-shifter.png',      name: 'Phase-Shifter',
    slot: 'shield', rarity: 'uncommon',
    effect: '+15% урон по целям с щитом >50%',
    desc: (b, r = 1) => `+${+(15 * r * (1 + b)).toFixed(1)}% урон по щитованным · к кораблю` },

  { key: 'perk_quick_recovery',     imgFile: 'Quick Recovery.png',     name: 'Quick Recovery',
    slot: 'shield', rarity: 'common',
    effect: '-30% задержка начала рег. щита',
    desc: (b, r = 1) => `-${+(30 * r * (1 + b)).toFixed(1)}% задержка рег. щита · к кораблю` },

  { key: 'perk_reactive',           imgFile: 'Reactive.png',           name: 'Reactive',
    slot: 'shield', rarity: 'uncommon',
    effect: '+8% отражение урона при попадании',
    desc: (b, r = 1) => `+${+(8 * r * (1 + b)).toFixed(1)}% отражение урона · к кораблю` },

  { key: 'perk_resonance',          imgFile: 'Resonance.png',          name: 'Resonance',
    slot: 'shield', rarity: 'common',
    effect: '+12% скорость перезарядки щита',
    desc: (b, r = 1) => `+${+(12 * r * (1 + b)).toFixed(1)}% скор. рег. щита · к кораблю, суммируется` },

  { key: 'perk_splinter_resistance', imgFile: 'Splinter Resistance.png', name: 'Splinter Resistance',
    slot: 'shield', rarity: 'common',
    effect: '+20% сопротивление AOE-урону',
    desc: (b, r = 1) => `+${+(20 * r * (1 + b)).toFixed(1)}% AOE сопр. · к кораблю` },

  { key: 'perk_stealth_sync',       imgFile: 'Stealth Sync.png',       name: 'Stealth Sync',
    slot: 'shield', rarity: 'rare',
    effect: '+40% длительность стелса',
    desc: (b, r = 1) => `+${+(40 * r * (1 + b)).toFixed(1)}% длит. стелса · к кораблю` },

  // Laser cannon perks
  { key: 'perk_laser_precision', imgFile: 'Laser Precision.png', name: 'Laser Precision',
    slot: 'laser', rarity: 'uncommon',
    effect: '+15% точность лазера',
    desc: (b, r = 1) => `+${+(15 * r * (1 + b)).toFixed(1)}% точность лазера · к кораблю` },

  { key: 'perk_laser_shredder', imgFile: 'Laser Shredder.png', name: 'Laser Shredder',
    slot: 'laser', rarity: 'rare',
    effect: '+20% урон по корпусу',
    desc: (b, r = 1) => `+${+(20 * r * (1 + b)).toFixed(1)}% урон по корпусу · к кораблю` },

  { key: 'perk_laser_overload', imgFile: 'Laser Overload.png', name: 'Laser Overload',
    slot: 'laser', rarity: 'jackpot',
    effect: '100% точность, -15% перезарядка',
    desc: (b, r = 1) => `100% точность, -${+(15 * r * (1 + b)).toFixed(1)}% КД · к кораблю` },

  // Engine perks
  { key: 'perk_engine_thrust', imgFile: 'Engine Thrust.png', name: 'Engine Thrust',
    slot: 'engine', rarity: 'common',
    effect: '+10% максимальная скорость',
    desc: (b, r = 1) => `+${+(10 * r * (1 + b)).toFixed(1)}% скорость · к кораблю` },

  { key: 'perk_engine_agility', imgFile: 'Engine Agility.png', name: 'Engine Agility',
    slot: 'engine', rarity: 'uncommon',
    effect: '+15% скорость поворота',
    desc: (b, r = 1) => `+${+(15 * r * (1 + b)).toFixed(1)}% поворот · к кораблю` },

  { key: 'perk_engine_boost', imgFile: 'Engine Boost.png', name: 'Shadow Drive',
    slot: 'engine', rarity: 'rare',
    effect: '+50% длительность стелса',
    desc: (b, r = 1) => `+${+(50 * r * (1 + b)).toFixed(1)}% длит. стелса · к кораблю` },

  // Armor perks
  { key: 'perk_armor_plating', imgFile: 'Armor Plating.png', name: 'Armor Plating',
    slot: 'armor', rarity: 'common',
    effect: '+10% прочность этого модуля брони',
    desc: (b, r = 1) => `+${+(10 * r * (1 + b)).toFixed(1)}% прочность · к предмету (вклад в корпус корабля)` },

  { key: 'perk_nimble', imgFile: 'Nimble.png', name: 'Nimble',
    slot: 'armor', rarity: 'uncommon',
    effect: '+6% уклонение',
    desc: (b, r = 1) => `+${+(6 * r * (1 + b)).toFixed(1)}% уклонение · к кораблю, суммируется` },

  { key: 'perk_kinetic_absorb', imgFile: 'Kinetic Absorb.png', name: 'Kinetic Absorb',
    slot: 'armor', rarity: 'rare',
    effect: '15% шанс нивелировать удар (только без щита, не суммируется)',
    desc: (b, r = 1) => `${+(15 * r * (1 + b)).toFixed(1)}% шанс блока удара без щита · к кораблю (макс. один)` },

  { key: 'perk_bulwark', imgFile: 'Bulwark.png', name: 'Bulwark',
    slot: 'armor', rarity: 'jackpot',
    effect: '+20% сопр. урону при полном броне-билде (нет щитов)',
    desc: (b, r = 1) => `+${+(20 * r * (1 + b)).toFixed(1)}% сопр. если все слоты — броня · к кораблю` },
];

export const PERK_MAP = {};
for (const p of PERK_DEFS) PERK_MAP[p.key] = p;

// Perk pools by slot type
const WEAPON_PERKS = PERK_DEFS.filter(p => p.slot === 'weapon');
const SHIELD_PERKS = PERK_DEFS.filter(p => p.slot === 'shield');
const LASER_PERKS  = PERK_DEFS.filter(p => p.slot === 'laser');
const ENGINE_PERKS = PERK_DEFS.filter(p => p.slot === 'engine');
const ARMOR_PERKS  = PERK_DEFS.filter(p => p.slot === 'armor');

// Weighted random pick from a pool
function weightedPick(pool) {
  let total = pool.reduce((s, p) => s + WEIGHTS[p.rarity], 0);
  let r = Math.random() * total;
  for (const p of pool) {
    r -= WEIGHTS[p.rarity];
    if (r <= 0) return p;
  }
  return pool[pool.length - 1];
}

// Generate a drop roll in [0.6, 1.0], skewed toward 0.6 (lower rolls are more common)
export function generateRoll() {
  return +(0.6 + 0.4 * Math.pow(Math.random(), 2)).toFixed(3);
}

// Return quality tier info for a given roll value
export function rollQualityInfo(roll) {
  const r = roll ?? 1;
  return ROLL_QUALITY_TIERS.find(t => r >= t.min) || ROLL_QUALITY_TIERS[ROLL_QUALITY_TIERS.length - 1];
}

// Attempt to improve a roll toward 1.0. Returns the new roll value.
// Gain is absolute (added directly to roll), not a fraction of remaining gap.
// gradeIdx: 0=basic (+0.5–2%), 1=advanced (+1.5–4.5%), 2=premium (+3–8%)
export function refineRoll(currentRoll, gradeIdx) {
  const r = currentRoll ?? 1;
  if (r >= 1.0) return 1.0;
  const gainRanges = [[0.005, 0.020], [0.015, 0.045], [0.030, 0.080]];
  const [minG, maxG] = gainRanges[gradeIdx] || gainRanges[0];
  const gain = minG + Math.random() * (maxG - minG);
  return +Math.min(1.0, r + gain).toFixed(3);
}

// Roll a perk for a slot type
export function rollPerk(slotType) {
  const pool = slotType === 'cannon' ? WEAPON_PERKS
    : slotType === 'laser'  ? LASER_PERKS
    : slotType === 'engine' ? ENGINE_PERKS
    : slotType === 'armor'  ? ARMOR_PERKS
    : SHIELD_PERKS;
  const def = weightedPick(pool);
  return { key: def.key, creditLvl: 0, starLvl: 0, roll: generateRoll() };
}

// Total bonus multiplier for a perk (used in tooltips/display)
export function perkBonus(perk) {
  const ci = Math.min(perk.creditLvl || 0, CREDIT_BONUS_PER_LVL.length - 1);
  const si = Math.min(perk.starLvl   || 0, STAR_BONUS_PER_LVL.length   - 1);
  return (CREDIT_BONUS_PER_LVL[ci] ?? 0) + (STAR_BONUS_PER_LVL[si] ?? 0);
}

// Credit upgrade cost to go from creditLvl → creditLvl+1 for given module tier (1–4)
export function creditUpgCost(creditLvl, tier) {
  return (PERK_CREDIT_COST[tier] || PERK_CREDIT_COST[4])[creditLvl] || null;
}

// Star upgrade cost to go from starLvl → starLvl+1 for given module tier (1–4)
export function starUpgCost(starLvl, tier) {
  return (PERK_STAR_COST[tier] || PERK_STAR_COST[4])[starLvl] || null;
}
