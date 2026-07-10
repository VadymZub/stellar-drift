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
  turretSize:       84,    // turret sprite display size px — fitted to the socket
                            // averaged across all 4 base skins, see TURRET_SLOTS below
  baseCostCredits:  20000,
  pointsPerSec:     1,
  goldPerHrLow:     1,   // pvpTier 1-2
  goldPerHrHigh:    2,   // pvpTier 3-5
  maxOwners:        10,

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

// Turret slot offsets relative to base center (world px), tuned for displaySize 460.
// Layout: 2 top, 2 middle (widest), 2 bottom — matches the 6-pod octagonal art.
// Measured directly off the 4 base_*.png skins (each squashed to the 460×460 square
// setDisplaySize forces regardless of native aspect — same squash the game applies)
// and averaged across helios/karax/tides/neutral, since the 4 skins aren't pixel-identical
// (native sizes 460×512 / 433×512 / 404×512 / 442×512). helios/karax/neutral land within
// a few px of this average; tides' pods sit ~35-40px lower in its own canvas, so the fit
// there is the deliberate compromise from averaging rather than a per-skin table.
export const TURRET_SLOTS = [
  { x: -153, y: -174 },
  { x:  153, y: -174 },
  { x: -190, y:  -47 },
  { x:  190, y:  -47 },
  { x: -153, y:   56 },
  { x:  153, y:   56 },
];

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
