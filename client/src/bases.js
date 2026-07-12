// Mining base game constants
export const CORPS = ['neutral', 'helios', 'karax', 'tides'];

export const BASE_CONFIG = {
  // Базовые значения для pvp4/pvp5 (коэф. 1.0) — см. pvpTierMult ниже, масштабирует
  // и это, и урон турелей (cannon1Damage/cannon2Damage) одним и тем же коэффициентом.
  hullMax:          100000,
  shieldMax:        100000,
  turretHullMax:    { cannon1: 10000, cannon2: 20000 },
  turretShieldMax:  { cannon1: 10000, cannon2: 20000 },
  displaySize:      460,   // active / building sprite px
  displayDestroyed: 340,   // destroyed sprite (smaller, dimmed)
  captureRadius:    180,   // F-key interact range
  buildTimeSec:     900,   // 15 min
  neutralOpenSec:   1800,  // 30 min open / immune cycle
  neutralImmuneSec: 3600,  // 60 min
  turretSlots:      6,
  turretCostCredits: 5000,
  turretSize:       84,    // turret sprite display size px — see TURRET_SLOTS_BY_CORP below
  baseCostCredits:  20000,
  pointsPerSec:     1,
  goldPerHrLow:     1,   // pvpTier 1-2
  goldPerHrHigh:    2,   // pvpTier 3-5
  maxOwners:        10,  // выплата при потере контроля — только топ-10 по очкам (см. MiningBase._payoutTop10)
  guardRadius:      700, // "физическая охрана" — радиус вокруг базы для начисления очков/золота (см. MiningBase._presentGuards); чуть больше cannon2Range, чтобы захватывать зону самого боя

  // Урон — базовые значения для pvp4/pvp5 (коэф. 1.0), см. pvpTierMult ниже;
  // дальность/скорострельность НЕ масштабируются по тиру, только урон.
  cannon1Range:  600,
  cannon1Damage: 500,
  cannon1Rate:   1,     // shots / sec

  cannon2Range:  650,
  cannon2Damage: 1000,
  cannon2Rate:   1,
};

// Общий коэффициент по pvp-тиру арены — масштабирует и урон турелей
// (cannon1Damage/cannon2Damage), и прочность/щит базы и турелей (hullMax/shieldMax/
// turretHullMax/turretShieldMax): на pvp1-3 всё слабее заявленных базовых значений,
// на pvp4/pvp5 — полная сила (те и есть базовые значения, коэф. 1.0).
export function pvpTierMult(pvpTier) {
  if (pvpTier <= 1) return 0.3;
  if (pvpTier === 2) return 0.6;
  if (pvpTier === 3) return 0.8;
  return 1.0; // pvpTier 4, 5
}

// Turret slot offsets as FRACTIONS of the base's own half-width/half-height (fx×w/2,
// fy×h/2), not absolute pixels — the base sprite keeps its NATIVE aspect ratio instead
// of being squashed into a square (see MiningBase._fitSize), and each corp skin has a
// different native width AND a genuinely different pod layout (helios/neutral are a
// hexagon — 2 top corners, 2 wide middle, 2 bottom; karax/tides are a diamond — 1 top
// center, 2 mid sides, 1 bottom center, 2 lower-mid — not just a rotated/scaled version
// of the same hexagon), so ONE shared array can't fit all 4 corps. Per-corp, hand-
// calibrated in-game via the DEV drag tool (MiningBase turret sprites draggable in
// devMode, dump via keydown-L — see GameScene/MiningBase.dumpTurretSlots).
export const TURRET_SLOTS_BY_CORP = {
  helios: [
    { fx: -0.557, fy: -0.804 },
    { fx:  0.533, fy: -0.822 },
    { fx: -0.804, fy: -0.289 },
    { fx:  0.795, fy: -0.293 },
    { fx: -0.589, fy:  0.153 },
    { fx:  0.576, fy:  0.129 },
  ],
  karax: [
    { fx:  0.030, fy: -0.826 },
    { fx:  0.625, fy: -0.630 },
    { fx: -0.663, fy: -0.667 },
    { fx:  0.663, fy:  0.093 },
    { fx: -0.669, fy:  0.081 },
    { fx:  0.004, fy:  0.317 },
  ],
  tides: [
    { fx:  0.024, fy: -0.632 },
    { fx:  0.659, fy: -0.444 },
    { fx: -0.653, fy: -0.446 },
    { fx:  0.008, fy:  0.424 },
    { fx: -0.642, fy:  0.242 },
    { fx:  0.664, fy:  0.246 },
  ],
  neutral: [
    { fx: -0.567, fy: -0.826 },
    { fx:  0.548, fy: -0.822 },
    { fx: -0.775, fy: -0.302 },
    { fx:  0.761, fy: -0.285 },
    { fx: -0.581, fy:  0.133 },
    { fx:  0.562, fy:  0.133 },
  ],
};

export function turretSlotsFor(corp) {
  return TURRET_SLOTS_BY_CORP[corp] || TURRET_SLOTS_BY_CORP.neutral;
}

// Cannon II costs star-gold; price scales with PvP tier (1⭐ on pvp1 … 5⭐ on pvp5)
export function cannon2GoldCost(pvpTier) { return Math.max(1, Math.min(5, pvpTier || 1)); }

// Gold earned per second per owner; 1/hr on low tiers, 2/hr on high tiers
export function goldPerSecByTier(pvpTier) {
  return (pvpTier >= 3 ? BASE_CONFIG.goldPerHrHigh : BASE_CONFIG.goldPerHrLow) / 3600;
}

// Corp → base/cannon asset key suffixes
export const CORP_ASSETS = {
  helios:  { base: 'base_helios',  cannon1: 'cannon1_helios',  cannon2: 'cannon2_helios'  },
  karax:   { base: 'base_karax',   cannon1: 'cannon1_karax',   cannon2: 'cannon2_karax'   },
  tides:   { base: 'base_tides',   cannon1: 'cannon1_tides',   cannon2: 'cannon2_tides'   },
  neutral: { base: 'base_neutral', cannon1: 'cannon1_neutral', cannon2: 'cannon2_neutral'  },
};

// Пул имён станций (i18n-ключи, не хардкод строк — см. CLAUDE.md) — каждой базе
// достаётся одно ИМЯ детерминированно по её id (сектор+индекс слота), стабильно между
// визитами/релоадами без необходимости хранить имя отдельно на сервере.
export const STATION_NAME_KEYS = [
  'base.station_vector', 'base.station_bastion', 'base.station_forpost',
  'base.station_meridian', 'base.station_yakor', 'base.station_gorizont',
  'base.station_avanpost', 'base.station_reduta',
];

export function stationNameKey(baseId) {
  let hash = 0;
  for (let i = 0; i < baseId.length; i++) hash = (hash * 31 + baseId.charCodeAt(i)) >>> 0;
  return STATION_NAME_KEYS[hash % STATION_NAME_KEYS.length];
}

// Точный вертикальный центр КРУГЛОГО/ОВАЛЬНОГО основания турели на каждом ассете — НЕ
// совпадает с геометрическим центром прямоугольника текстуры (пересечением диагоналей
// bbox), т.к. ствол уходит вверх асимметрично и сдвигает bbox вверх относительно
// реального основания. Измерено программно по alpha-каналу (самая широкая
// непрозрачная горизонтальная полоса = основание турели, её собственный вертикальный
// центр) — доля от высоты текстуры; ox везде 0.5 (все ассеты горизонтально
// симметричны, измеренный x-сдвиг был ровно 0 на всех 8). Используется как
// spr.setOrigin(0.5, oy) — и позиционирование, и поворот ствола крутятся вокруг
// настоящего основания, а не вокруг пустоты над ним.
export const TURRET_ORIGIN = {
  helios:  { cannon1: 0.548, cannon2: 0.557 },
  karax:   { cannon1: 0.531, cannon2: 0.608 },
  tides:   { cannon1: 0.568, cannon2: 0.620 },
  neutral: { cannon1: 0.602, cannon2: 0.589 },
};
