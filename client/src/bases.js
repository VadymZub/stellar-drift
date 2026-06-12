// Mining base game constants
export const CORPS = ['neutral', 'helios', 'karax', 'tides'];

export const BASE_CONFIG = {
  hullMax:          12000,
  displaySize:      320,   // px, matches art footprint
  captureRadius:    180,   // px, collision / F-key range
  buildTimeSec:     900,   // 15 min
  neutralOpenSec:   1800,  // 30 min  open / immune cycle
  neutralImmuneSec: 3600,  // 60 min
  turretSlots:      6,
  turretCostCredits: 5000,
  baseCostCredits:  20000,
  pointsPerSec:     1,     // credits+points earned per owner per second while active
  goldPerSec:       0.05,  // star-gold per owner per second
  maxOwners:        10,
};

// Canonical turret slot offsets (x, y) relative to base center, in world px.
// Layout matches the 6-pod octagonal art: 2 top, 2 middle, 2 bottom.
export const TURRET_SLOTS = [
  { x: -90, y: -140 },
  { x:  90, y: -140 },
  { x: -130, y:   0 },
  { x:  130, y:   0 },
  { x: -90, y:  140 },
  { x:  90, y:  140 },
];

// Cannon II costs star-gold; price scales with PvP tier (1⭐ on pvp1 … 5⭐ on pvp5)
export function cannon2GoldCost(pvpTier) { return Math.max(1, Math.min(5, pvpTier || 1)); }

// Corp → base/cannon asset key suffixes
export const CORP_ASSETS = {
  helios:  { base: 'base_helios',  cannon1: 'cannon1_helios',  cannon2: 'cannon2_helios'  },
  karax:   { base: 'base_karax',   cannon1: 'cannon1_karax',   cannon2: 'cannon2_karax'   },
  tides:   { base: 'base_tides',   cannon1: 'cannon1_tides',   cannon2: 'cannon2_tides'   },
  neutral: { base: 'base_neutral', cannon1: 'cannon1_neutral', cannon2: 'cannon2_neutral'  },
};
