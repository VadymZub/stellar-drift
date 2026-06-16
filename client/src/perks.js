// Perk system: each weapon/shield module slot has one random perk.
// Credits upgrade path: 5 levels, +4.5% total bonus.
// Stars upgrade path: 5 levels, +45% total bonus.
// Reroll: costs starGold (200⭐ base, escalates per day, resets daily).

// Credit upgrade cost per step (0→1, 1→2, 2→3, 3→4, 4→5)
export const PERK_CREDIT_COST = [1500, 3500, 8000, 20000, 50000];
// Star upgrade cost per step
export const PERK_STAR_COST   = [10, 25, 50, 100, 250];
// Reroll escalation (per item, resets 00:00 UTC)
export const PERK_REROLL_BASE = 200;

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
// effect: description of base effect (at credit lvl 0, star lvl 0)
// valueKey: which stat modifier this perk applies (for future game logic)
// slot: 'weapon' | 'shield' | 'any'

export const PERK_DEFS = [
  // Weapon perks
  { key: 'perk_anti_armor',    imgFile: 'Anti-armor.png',         name: 'Anti-Armor',
    slot: 'weapon', rarity: 'uncommon',
    effect: '+20% урон по низкощитовым (<25%)',
    desc: (b) => `+${+(20 * (1 + b)).toFixed(1)}% урон по незащищённым` },

  { key: 'perk_critical_edge', imgFile: 'Critical Edge.png',      name: 'Critical Edge',
    slot: 'weapon', rarity: 'rare',
    effect: '+12% шанс критического удара',
    desc: (b) => `+${+(12 * (1 + b)).toFixed(1)}% крит. шанс` },

  { key: 'perk_hull_breaker',  imgFile: 'Hull-breaker.png',       name: 'Hull-Breaker',
    slot: 'weapon', rarity: 'uncommon',
    effect: '+18% урон прямо по корпусу (игнорирует щит)',
    desc: (b) => `+${+(18 * (1 + b)).toFixed(1)}% пробой щита` },

  { key: 'perk_marksman',      imgFile: 'Marksman.png',           name: 'Marksman',
    slot: 'weapon', rarity: 'common',
    effect: '+15% урон по неподвижным целям',
    desc: (b) => `+${+(15 * (1 + b)).toFixed(1)}% урон по стоячей цели` },

  { key: 'perk_plasma_bleed',  imgFile: 'Plasma Bleed.png',       name: 'Plasma Bleed',
    slot: 'weapon', rarity: 'rare',
    effect: '+10% урон за 2с (DOT-эффект)',
    desc: (b) => `+${+(10 * (1 + b)).toFixed(1)}% DOT 2с` },

  { key: 'perk_splinter',      imgFile: 'Splinter.png',           name: 'Splinter',
    slot: 'weapon', rarity: 'uncommon',
    effect: '+8% урон AOE при взрыве снаряда',
    desc: (b) => `+${+(8 * (1 + b)).toFixed(1)}% AOE` },

  { key: 'perk_steady_aim',    imgFile: 'Steady Aim.png',         name: 'Steady Aim',
    slot: 'weapon', rarity: 'common',
    effect: '+10% базовый урон орудия',
    desc: (b) => `+${+(10 * (1 + b)).toFixed(1)}% урон` },

  { key: 'perk_vengeance',     imgFile: 'Vengeance.png',          name: 'Vengeance',
    slot: 'weapon', rarity: 'jackpot',
    effect: '+40% урон пока HP < 40%',
    desc: (b) => `+${+(40 * (1 + b)).toFixed(1)}% урон HP<40%` },

  // Shield perks
  { key: 'perk_adaptive',          imgFile: 'Adaptive.png',           name: 'Adaptive',
    slot: 'shield', rarity: 'common',
    effect: '+12% сопротивление текущему типу урона',
    desc: (b) => `+${+(12 * (1 + b)).toFixed(1)}% адаптивное сопр.` },

  { key: 'perk_cooperative',        imgFile: 'Cooperative.png',        name: 'Cooperative',
    slot: 'shield', rarity: 'rare',
    effect: 'Аура: +8% щит союзникам в радиусе 600px',
    desc: (b) => `Аура: +${+(8 * (1 + b)).toFixed(1)}% щит союзникам` },

  { key: 'perk_energy_shunt',       imgFile: 'Energy Shunt.png',       name: 'Energy Shunt',
    slot: 'shield', rarity: 'uncommon',
    effect: '+15% рег. щита за каждый убитый моб (5с)',
    desc: (b) => `+${+(15 * (1 + b)).toFixed(1)}% рег. щита с убийства` },

  { key: 'perk_hardened',           imgFile: 'Hardened.png',           name: 'Hardened',
    slot: 'shield', rarity: 'common',
    effect: '+10% физическое сопротивление',
    desc: (b) => `+${+(10 * (1 + b)).toFixed(1)}% физ. сопр.` },

  { key: 'perk_last_stand',         imgFile: 'Last Stand.png',         name: 'Last Stand',
    slot: 'shield', rarity: 'jackpot',
    effect: '+50% все статы когда HP < 20%',
    desc: (b) => `+${+(50 * (1 + b)).toFixed(1)}% все статы HP<20%` },

  { key: 'perk_pack_aura',          imgFile: 'Pack Aura.png',          name: 'Pack Aura',
    slot: 'shield', rarity: 'rare',
    effect: 'Аура: +5% урон всем союзникам рядом',
    desc: (b) => `Аура: +${+(5 * (1 + b)).toFixed(1)}% урон союзникам` },

  { key: 'perk_phase_shifter',      imgFile: 'Phase-shifter.png',      name: 'Phase-Shifter',
    slot: 'shield', rarity: 'uncommon',
    effect: '+15% урон по целям с щитом >50%',
    desc: (b) => `+${+(15 * (1 + b)).toFixed(1)}% урон по щитованным` },

  { key: 'perk_quick_recovery',     imgFile: 'Quick Recovery.png',     name: 'Quick Recovery',
    slot: 'shield', rarity: 'common',
    effect: '-30% задержка начала рег. щита',
    desc: (b) => `-${+(30 * (1 + b)).toFixed(1)}% задержка рег.` },

  { key: 'perk_reactive',           imgFile: 'Reactive.png',           name: 'Reactive',
    slot: 'shield', rarity: 'uncommon',
    effect: '+8% отражение урона при попадании',
    desc: (b) => `+${+(8 * (1 + b)).toFixed(1)}% отражение урона` },

  { key: 'perk_resonance',          imgFile: 'Resonance.png',          name: 'Resonance',
    slot: 'shield', rarity: 'common',
    effect: '+12% скорость перезарядки щита',
    desc: (b) => `+${+(12 * (1 + b)).toFixed(1)}% скор. рег. щита` },

  { key: 'perk_splinter_resistance', imgFile: 'Splinter Resistance.png', name: 'Splinter Resistance',
    slot: 'shield', rarity: 'common',
    effect: '+20% сопротивление AOE-урону',
    desc: (b) => `+${+(20 * (1 + b)).toFixed(1)}% AOE сопр.` },

  { key: 'perk_stealth_sync',       imgFile: 'Stealth Sync.png',       name: 'Stealth Sync',
    slot: 'shield', rarity: 'rare',
    effect: '+40% длительность стелса',
    desc: (b) => `+${+(40 * (1 + b)).toFixed(1)}% длит. стелса` },

  // Laser cannon perks
  { key: 'perk_laser_precision', imgFile: 'Laser Precision.png', name: 'Laser Precision',
    slot: 'laser', rarity: 'uncommon',
    effect: '+15% точность лазера',
    desc: (b) => `+${+(15 * (1 + b)).toFixed(1)}% точность` },

  { key: 'perk_laser_shredder', imgFile: 'Laser Shredder.png', name: 'Laser Shredder',
    slot: 'laser', rarity: 'rare',
    effect: '+20% урон по корпусу',
    desc: (b) => `+${+(20 * (1 + b)).toFixed(1)}% урон по корпусу` },

  { key: 'perk_laser_overload', imgFile: 'Laser Overload.png', name: 'Laser Overload',
    slot: 'laser', rarity: 'jackpot',
    effect: '100% точность, -15% перезарядка',
    desc: (b) => `100% точность, -${+(15 * (1 + b)).toFixed(1)}% КД` },

  // Engine perks
  { key: 'perk_engine_thrust', imgFile: 'Engine Thrust.png', name: 'Engine Thrust',
    slot: 'engine', rarity: 'common',
    effect: '+10% максимальная скорость',
    desc: (b) => `+${+(10 * (1 + b)).toFixed(1)}% скорость` },

  { key: 'perk_engine_agility', imgFile: 'Engine Agility.png', name: 'Engine Agility',
    slot: 'engine', rarity: 'uncommon',
    effect: '+15% скорость поворота',
    desc: (b) => `+${+(15 * (1 + b)).toFixed(1)}% поворот` },

  { key: 'perk_engine_boost', imgFile: 'Engine Boost.png', name: 'Shadow Drive',
    slot: 'engine', rarity: 'rare',
    effect: '+50% длительность стелса',
    desc: (b) => `+${+(50 * (1 + b)).toFixed(1)}% длит. стелса` },
];

export const PERK_MAP = {};
for (const p of PERK_DEFS) PERK_MAP[p.key] = p;

// Perk pools by slot type
const WEAPON_PERKS = PERK_DEFS.filter(p => p.slot === 'weapon');
const SHIELD_PERKS = PERK_DEFS.filter(p => p.slot === 'shield');
const LASER_PERKS  = PERK_DEFS.filter(p => p.slot === 'laser');
const ENGINE_PERKS = PERK_DEFS.filter(p => p.slot === 'engine');

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

// Roll a perk for a slot type
export function rollPerk(slotType) {
  const pool = slotType === 'cannon' ? WEAPON_PERKS
    : slotType === 'laser'  ? LASER_PERKS
    : slotType === 'engine' ? ENGINE_PERKS
    : SHIELD_PERKS;
  const def = weightedPick(pool);
  return { key: def.key, creditLvl: 0, starLvl: 0 };
}

// Total bonus multiplier for a perk (used in tooltips/display)
export function perkBonus(perk) {
  return CREDIT_BONUS_PER_LVL[perk.creditLvl || 0] + STAR_BONUS_PER_LVL[perk.starLvl || 0];
}

// Credit upgrade cost to go from creditLvl → creditLvl+1
export function creditUpgCost(creditLvl) {
  return PERK_CREDIT_COST[creditLvl] || null;
}

// Star upgrade cost to go from starLvl → starLvl+1
export function starUpgCost(starLvl) {
  return PERK_STAR_COST[starLvl] || null;
}
