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
  { key: 'wisp',     nameKey: 'ship.wisp',     descKey: 'shipdesc.wisp',     tier: 'T1',       levelGate: 1,  price: 0,      currency: null,      displaySize: 77,  hullMax: 1000, shieldBase: 120, baseSpeed: 200, wSlots: 1, sSlots: 1, eSlots: 0, dmgMod: 1.00, garageKey: 'wisp_g', artAngleOffset: -Math.PI / 2,
    engines: [{ x: -10, y: 28 }, { x: 10, y: 28 }] },
  // Остальные корабли: арт нарисован носом ВНИЗ (как wisp) → artAngleOffset −π/2 (разворот 180°);
  // displaySize уменьшен ~25% (были крупнее виспа). Игровой спрайт ↔ orientation; в Гараже арт статичный.
  { key: 'stiletto', nameKey: 'ship.stiletto', descKey: 'shipdesc.stiletto', tier: 'T2',       levelGate: 10, price: 80000,  currency: 'credits', displaySize: 120, hullMax: 850,  shieldBase: 150, baseSpeed: 250, wSlots: 2, sSlots: 2, eSlots: 1, dmgMod: 1.05, garageKey: 'stiletto_g', artAngleOffset: -Math.PI / 2,
    engines: [{ x: 0, y: 50 }] },
  { key: 'anvil',    nameKey: 'ship.anvil',    descKey: 'shipdesc.anvil',    tier: 'T2',       levelGate: 15, price: 120000, currency: 'credits', displaySize: 110, hullMax: 1300, shieldBase: 210, baseSpeed: 205, wSlots: 3, sSlots: 3, eSlots: 1, dmgMod: 1.15, garageKey: 'anvil_g',    artAngleOffset: -Math.PI / 2,
    engines: [{ x: -13, y: 52 }, { x: 13, y: 52 }] },
  { key: 'drover',   nameKey: 'ship.drover',   descKey: 'shipdesc.drover',   tier: 'T3',       levelGate: 25, price: 230000, currency: 'credits', displaySize: 147, hullMax: 1400, shieldBase: 230, baseSpeed: 205, wSlots: 5, sSlots: 5, eSlots: 2, dmgMod: 0.85, garageKey: 'drover_g',   artAngleOffset: -Math.PI / 2,
    engines: [{ x: -12, y: 62 }, { x: 12, y: 62 }] },
  { key: 'aegis',    nameKey: 'ship.aegis',    descKey: 'shipdesc.aegis',    tier: 'T3',       levelGate: 25, price: 260000, currency: 'credits', displaySize: 155, hullMax: 2500, shieldBase: 450, baseSpeed: 200, wSlots: 4, sSlots: 4, eSlots: 2, dmgMod: 0.90, garageKey: 'aegis_g',    artAngleOffset: -Math.PI / 2,
    engines: [{ x: -12, y: 68 }, { x: 12, y: 68 }] },
  { key: 'phantom',  nameKey: 'ship.phantom',  descKey: 'shipdesc.phantom',  tier: 'T4',       levelGate: 40, price: 520000, currency: 'credits', displaySize: 147, hullMax: 1800, shieldBase: 400, baseSpeed: 235, wSlots: 6, sSlots: 6, eSlots: 2, dmgMod: 1.15, garageKey: 'phantom_g',  artAngleOffset: -Math.PI / 2,
    engines: [{ x: 0, y: 71 }] },

  // Prestige — за ⭐, гибрид-гейт. corp задаёт принадлежность (для текста требования).
  { key: 'helion', nameKey: 'ship.helion', descKey: 'shipdesc.helion', tier: 'T4 elite', levelGate: 45, price: 2500, currency: 'star', prestige: true, corp: 'helios', displaySize: 156, hullMax: 3500, shieldBase: 480, baseSpeed: 230, wSlots: 7, sSlots: 6, eSlots: 2, dmgMod: 1.15, garageKey: 'helion_g',  artAngleOffset: -Math.PI / 2,
    engines: [{ x: -14, y: 62 }, { x: 0, y: 65 }, { x: 14, y: 62 }] },
  { key: 'argosy',   nameKey: 'ship.argosy',   descKey: 'shipdesc.argosy',   tier: 'T4 elite', levelGate: 45, price: 2500, currency: 'star', prestige: true, corp: 'karax',  displaySize: 140, hullMax: 3200, shieldBase: 440, baseSpeed: 215, wSlots: 7, sSlots: 6, eSlots: 2, dmgMod: 1.10, garageKey: 'argosy_g',  artAngleOffset: -Math.PI / 2,
    engines: [{ x: -24, y: 58 }, { x: 24, y: 58 }] },
  { key: 'drifter',  nameKey: 'ship.drifter',  descKey: 'shipdesc.drifter',  tier: 'T4 elite', levelGate: 45, price: 2500, currency: 'star', prestige: true, corp: 'tides',  displaySize: 147, hullMax: 2800, shieldBase: 420, baseSpeed: 270, wSlots: 6, sSlots: 7, eSlots: 3, dmgMod: 1.15, garageKey: 'drifter_g',  artAngleOffset: -Math.PI / 2,
    engines: [{ x: 0, y: 70 }] },

  // Admin Ship
  { key: 'argus',    nameKey: 'ship.argus',    descKey: 'shipdesc.argus',    tier: 'ADMIN',    levelGate: 99, price: 0,      currency: null,      displaySize: 182, hullMax: 10000, shieldBase: 5000, baseSpeed: 450, wSlots: 10, sSlots: 10, eSlots: 10, dmgMod: 2.0, artAngleOffset: -Math.PI / 2,
    engines: [{ x: -35, y: 72 }, { x: -12, y: 76 }, { x: 12, y: 76 }, { x: 35, y: 72 }] },
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
// Бонусы корпуса по уровню: на ур.10 +20% корпус/щит, +15% урон, +10% скорость
// (линейно от ур.1). Прокачивает HP/щит/DPS/скорость самого корпуса (не модулей).
export const SHIP_MAX_LEVEL = 10;

export function shipLevelMods(level) {
  const t = (Phaser_clamp(level, 1, SHIP_MAX_LEVEL) - 1) / (SHIP_MAX_LEVEL - 1); // 0..1
  return { hull: 1 + 0.20 * t, shield: 1 + 0.20 * t, damage: 1 + 0.15 * t, speed: 1 + 0.10 * t };
}
function Phaser_clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// Суммарная стоимость прокачки до ур.10 — по тиру (ориентир content-scope).
const TIER_TOTAL = { 'T1': 50000, 'T2': 150000, 'T3': 300000, 'T4': 600000, 'T4 elite': 900000 };
const CURVE_SUM = 285; // Σ L² для L=1..9 — нормировка слабо-экспоненциальной кривой

// Кредиты для перехода ship-level `level` → `level+1` (level 1..9). null если уже макс.
export function shipLevelCost(ship, level) {
  if (level >= SHIP_MAX_LEVEL) return null;
  const total = TIER_TOTAL[ship.tier] || 150000;
  return Math.round(total * level * level / CURVE_SUM);
}
