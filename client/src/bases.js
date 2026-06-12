// Mining base game constants
export const CORPS = ['neutral', 'helios', 'karax', 'tides'];

export const BASE_CONFIG = {
  hullMax:          12000,
  displaySize:      460,   // active / building sprite px
  displayDestroyed: 340,   // destroyed sprite (smaller, dimmed)
  captureRadius:    180,   // F-key interact range
  buildTimeSec:     900,   // 15 min
  neutralOpenSec:   1800,  // 30 min open / immune cycle
  neutralImmuneSec: 3600,  // 60 min
  turretSlots:      6,
  turretCostCredits: 5000,
  turretSize:       80,    // turret sprite display size px
  baseCostCredits:  20000,
  pointsPerSec:     1,
  goldPerHrLow:     1,   // pvpTier 1-2
  goldPerHrHigh:    2,   // pvpTier 3-5
  maxOwners:        10,

  cannon1Range:  400,
  cannon1Damage: 80,
  cannon1Rate:   0.8,   // shots / sec

  cannon2Range:  550,
  cannon2Damage: 130,
  cannon2Rate:   1.2,
};

// Turret slot offsets relative to base center (world px), tuned for displaySize 460.
// Layout: 2 top, 2 middle (widest), 2 bottom — matches the 6-pod octagonal art.
export const TURRET_SLOTS = [
  { x: -120, y: -175 },
  { x:  120, y: -175 },
  { x: -170, y:    0 },
  { x:  170, y:    0 },
  { x: -120, y:  175 },
  { x:  120, y:  175 },
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
