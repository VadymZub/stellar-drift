// Модельный ряд Stellar Drift (content-scope). Два слоя приобретения:
//  • базовые — покупка за КРЕДИТЫ + level-gate по уровню пилота;
//  • prestige — покупка за ⭐ + гибрид-гейт (победа корпы в сезоне + ур.45 + корп-реп ≥ 80%).
// Статы упрощены для прототипа (пропорции из «Базовые характеристики»).
// Слоты (wSlots/sSlots) пока витринные — функционально прототип использует 1 оружие + 1 щит.
// dmgMod — множитель урона в пределах ±15% cap (применяется в Player.recomputeStats).

// СКОРОСТЬ: пол по стартовому Wisp (200) — НИ ОДИН корабль не медленнее старта.
// baseSpeed здесь = скорость КОРПУСА без двигателей. Разрыв растёт через двигатели-модули
// (eS = кол-во слотов двигателей; см. content-scope «Двигатели»). В прототипе двигателей пока
// нет → baseSpeed = эффективная скорость. shieldBase повышен у старших кораблей.
export const SHIPS = [
  // key        name           desc               tier        gate price    cur        prestige corp     size hull  shB  spd  wS sS eS dmg
  // artAngleOffset: спрайт wisp.png нарисован носом ВНИЗ → перёд = −π/2 (иначе летит задом наперёд).
  // engines: позиции сопел в пикселях дисплея относительно центра спрайта.
  //   x — вправо по изображению (положительный = правая сторона арта),
  //   y — к двигателям (положительный = верх изображения = корма корабля).
  // Формула мировых координат: wx = px + x·sin(facing) − y·cos(facing)
  //                             wy = py − x·cos(facing) − y·sin(facing)
  { key: 'wisp',     nameKey: 'ship.wisp',     descKey: 'shipdesc.wisp',     tier: 'T1',       levelGate: 1,  price: 0,      currency: null,      displaySize: 77,  hullMax: 1000, shieldBase: 120, baseSpeed: 200, wSlots: 1, sSlots: 1, eSlots: 0, aSlots: 3, dmgMod: 1.00, garageKey: 'wisp_g', artAngleOffset: -Math.PI / 2,
    activeSkill: { key: 'ship:wisp_recall', nameKey: 'skill.ship_wisp_recall', icon: 'БЗ', color: 0x66bb6a },
    engines: [{ x: -10, y: 28 }, { x: 10, y: 28 }] },
  // Остальные корабли: арт нарисован носом ВНИЗ (как wisp) → artAngleOffset −π/2 (разворот 180°);
  // displaySize уменьшен ~25% (были крупнее виспа). Игровой спрайт ↔ orientation; в Гараже арт статичный.
  { key: 'stiletto', nameKey: 'ship.stiletto', descKey: 'shipdesc.stiletto', tier: 'T2',       levelGate: 10, price: 80000,  currency: 'credits', displaySize: 120, hullMax: 850,  shieldBase: 150, baseSpeed: 250, wSlots: 2, sSlots: 2, eSlots: 1, aSlots: 3, dmgMod: 1.00, garageKey: 'stiletto_g', artAngleOffset: -Math.PI / 2,
    activeSkill: { key: 'ship:stiletto_afterburner', nameKey: 'skill.ship_stiletto_afterburner', icon: 'ФС', color: 0x29b6f6 },
    engines: [{ x: 0, y: 50 }] },
  { key: 'anvil',    nameKey: 'ship.anvil',    descKey: 'shipdesc.anvil',    tier: 'T2',       levelGate: 15, price: 120000, currency: 'credits', displaySize: 110, hullMax: 1300, shieldBase: 210, baseSpeed: 205, wSlots: 3, sSlots: 3, eSlots: 1, aSlots: 4, dmgMod: 1.00, garageKey: 'anvil_g',    artAngleOffset: -Math.PI / 2,
    activeSkill: { key: 'ship:anvil_lockdown', nameKey: 'skill.ship_anvil_lockdown', icon: 'УП', color: 0x90a4ae },
    engines: [{ x: -13, y: 52 }, { x: 13, y: 52 }] },
  { key: 'drover',   nameKey: 'ship.drover',   descKey: 'shipdesc.drover',   tier: 'T3',       levelGate: 25, price: 230000, currency: 'credits', displaySize: 147, hullMax: 1400, shieldBase: 230, baseSpeed: 205, wSlots: 5, sSlots: 5, eSlots: 2, aSlots: 5, dmgMod: 1.00, garageKey: 'drover_g',   artAngleOffset: -Math.PI / 2,
    cargoBonus: 4,
    activeSkill: { key: 'ship:drover_scan', nameKey: 'skill.ship_drover_scanner', icon: 'СК', color: 0xab47bc },
    engines: [{ x: -12, y: 62 }, { x: 12, y: 62 }] },
  { key: 'aegis',    nameKey: 'ship.aegis',    descKey: 'shipdesc.aegis',    tier: 'T3',       levelGate: 25, price: 260000, currency: 'credits', displaySize: 155, hullMax: 2500, shieldBase: 450, baseSpeed: 200, wSlots: 4, sSlots: 5, eSlots: 2, aSlots: 5, dmgMod: 1.00, garageKey: 'aegis_g',    artAngleOffset: -Math.PI / 2,
    passives: { shieldBonus: 0.20, shieldPerAlly: 0.05, reflectChance: 0.07 },
    activeSkill: { key: 'ship:aegis_dome', nameKey: 'skill.ship_aegis_dome', icon: 'ЩК', color: 0x42a5f5 },
    engines: [{ x: -12, y: 68 }, { x: 12, y: 68 }] },
  { key: 'phantom',  nameKey: 'ship.phantom',  descKey: 'shipdesc.phantom',  tier: 'T4',       levelGate: 40, price: 520000, currency: 'credits', displaySize: 147, hullMax: 1800, shieldBase: 400, baseSpeed: 235, wSlots: 6, sSlots: 6, eSlots: 2, aSlots: 6, dmgMod: 1.00, garageKey: 'phantom_g',  artAngleOffset: -Math.PI / 2,
    activeSkill: { key: 'ship:phantom_cloak', nameKey: 'skill.ship_phantom_cloak', icon: 'МС', color: 0x7e57c2 },
    engines: [{ x: 0, y: 71 }] },

  // Prestige — за ⭐, гибрид-гейт. corp задаёт принадлежность (для текста требования).
  // Все три: 7/7/2 слота, dmgMod 1.0. Разница — корпус/скорость + пассив + активный скилл.
  { key: 'helion', nameKey: 'ship.helion', descKey: 'shipdesc.helion', tier: 'T4 elite', levelGate: 45, price: 5000, currency: 'star', prestige: true, corp: 'helios', corpAffinity: 'helios', displaySize: 156, hullMax: 3100, shieldBase: 450, baseSpeed: 220, wSlots: 7, sSlots: 7, eSlots: 2, aSlots: 6, dmgMod: 1.00, garageKey: 'helion_g',  artAngleOffset: -Math.PI / 2,
    passives: { damageBonus: 0.08 },
    activeSkill: { key: 'ship:helion_volley', nameKey: 'skill.ship_helion_volley', icon: 'ЗП', color: 0xffb74d },
    engines: [{ x: -14, y: 62 }, { x: 0, y: 65 }, { x: 14, y: 62 }] },
  { key: 'argosy',   nameKey: 'ship.argosy',   descKey: 'shipdesc.argosy',   tier: 'T4 elite', levelGate: 45, price: 5000, currency: 'star', prestige: true, corp: 'karax',  corpAffinity: 'karax',  displaySize: 140, hullMax: 3600, shieldBase: 480, baseSpeed: 215, wSlots: 7, sSlots: 7, eSlots: 2, aSlots: 6, dmgMod: 1.00, garageKey: 'argosy_g',  artAngleOffset: -Math.PI / 2,
    passives: { hullRegen: 25 },
    activeSkill: { key: 'ship:argosy_repair', nameKey: 'skill.ship_argosy_repair', icon: 'РМ', color: 0x4fc3f7 },
    engines: [{ x: -24, y: 58 }, { x: 24, y: 58 }] },
  { key: 'drifter',  nameKey: 'ship.drifter',  descKey: 'shipdesc.drifter',  tier: 'T4 elite', levelGate: 45, price: 5000, currency: 'star', prestige: true, corp: 'tides',  corpAffinity: 'tides',  displaySize: 147, hullMax: 2900, shieldBase: 440, baseSpeed: 265, wSlots: 7, sSlots: 7, eSlots: 2, aSlots: 6, dmgMod: 1.00, garageKey: 'drifter_g',  artAngleOffset: -Math.PI / 2,
    passives: { evasionBonus: 0.15 },
    activeSkill: { key: 'ship:drifter_jump', nameKey: 'skill.ship_drifter_jump', icon: 'ПР', color: 0x4db6ac },
    engines: [{ x: 0, y: 70 }] },

  // Admin Ship
  { key: 'argus',    nameKey: 'ship.argus',    descKey: 'shipdesc.argus',    tier: 'ADMIN',    levelGate: 99, price: 0,      currency: null,      displaySize: 182, hullMax: 500000, shieldBase: 500000, baseSpeed: 450, wSlots: 15, sSlots: 0, eSlots: 0, aSlots: 6, dmgMod: 2.0, artAngleOffset: -Math.PI / 2,
    engines: [{ x: -35, y: 72 }, { x: -20, y: 74 }, { x: -7, y: 76 }, { x: 7, y: 76 }, { x: 20, y: 74 }, { x: 35, y: 72 }] },
];

export const SHIP_BY_KEY = Object.fromEntries(SHIPS.map((s) => [s.key, s]));

// Можно ли купить корабль прямо сейчас. Возвращает {ok, reasonKey, params}.
// gs — GameScene (pilotLevel, credits, starGold, seasonWon, corpRep).
export function purchaseState(ship, gs) {
  if (gs.ownedShips.has(ship.key)) return { ok: false, owned: true };
  if (gs.pilotLevel < ship.levelGate) return { ok: false, reasonKey: 'garage.need_level', params: { lvl: ship.levelGate } };
  if (ship.prestige) {
    if (!gs.seasonWon || gs.corpRep < 0.8) return { ok: false, reasonKey: 'garage.prestige_gate' };
  }
  const have = ship.currency === 'star' ? gs.starGold : gs.credits;
  if ((have || 0) < ship.price) return { ok: false, reasonKey: 'garage.cant_afford' };
  return { ok: true };
}

// ── Уровень корабля 1-10 (прокачка за КРЕДИТЫ) ──────────────────────────────
// Бонусы по уровню корабля: на ур.10 +60% корпус, +90% щит, +10% скорость, урон не растёт.
// (линейно от ур.1). Не затрагивает модули — только базовые статы корпуса.
export const SHIP_MAX_LEVEL = 10;

export function shipLevelMods(level) {
  const t = (Phaser_clamp(level, 1, SHIP_MAX_LEVEL) - 1) / (SHIP_MAX_LEVEL - 1); // 0..1
  return { hull: 1 + 0.60 * t, shield: 1 + 0.90 * t, damage: 1, speed: 1 + 0.10 * t };
}
function Phaser_clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// Суммарная стоимость прокачки до ур.10 — по тиру (ориентир content-scope).
const TIER_TOTAL = { 'T1': 50000, 'T2': 750000, 'T3': 4000000, 'T4': 6500000, 'T4 elite': 900000 };
const CURVE_SUM = 285; // Σ L² для L=1..9 — нормировка слабо-экспоненциальной кривой

// Кредиты для перехода ship-level `level` → `level+1` (level 1..9). null если уже макс.
// Престиж-корабли качаются за золото — см. shipLevelCostGold.
export function shipLevelCost(ship, level) {
  if (ship.prestige) return null;
  if (level >= SHIP_MAX_LEVEL) return null;
  const total = TIER_TOTAL[ship.tier] || 150000;
  return Math.round(total * level * level / CURVE_SUM);
}

// ⭐ для перехода ship-level `level` → `level+1` у престиж-корабля.
// Итого 2750⭐ за полный путь 1→10 по той же слабо-экспоненциальной кривой.
export function shipLevelCostGold(ship, level) {
  if (!ship.prestige) return null;
  if (level >= SHIP_MAX_LEVEL) return null;
  return Math.round(15000 * level * level / CURVE_SUM);
}
