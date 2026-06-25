// Палитра бренда Stellar Drift (зафиксирована: cyan primary, amber/emerald акценты).
export const COLORS = {
  primary: 0x4dd0e1,   // cyan — щит, UI, дружественное
  amber: 0xffb74d,     // янтарь — форсаж, премиум-акценты
  emerald: 0x66bb6a,   // изумруд — корпус/HP, свой
  danger: 0xef5350,    // красный — враг, урон по корпусу
  white: 0xffffff,
  bg: 0x05070f,        // глубокий космос
  safezone: 0x4dd0e1,  // граница безопасной зоны
};

// ── Система рангов (Military Fleet) ────────────────────────────────────────
// Рейтинг = (Опыт * 0.4) + (Честь * 0.6). Слоты ограничены для топ-рангов.
export const RANK_FORMULA = { xpWeight: 0.4, honorWeight: 0.6 };

export const RANKS = [
  { id: 1,  name: 'Гранд-Адмирал',      limit: 1,    type: 'fixed' },
  { id: 2,  name: 'Адмирал Флота',      limit: 4,    type: 'fixed' },
  { id: 3,  name: 'Вице-Адмирал',       limit: 14,   type: 'fixed' },
  { id: 4,  name: 'Контр-Адмирал',      percent: 1,  type: 'percent' },
  { id: 5,  name: 'Коммодор',           percent: 3,  type: 'percent' },
  { id: 6,  name: 'Капитан I ранга',    percent: 5,  type: 'percent' },
  { id: 7,  name: 'Капитан II ранга',   percent: 10, type: 'percent' },
  { id: 8,  name: 'Капитан III ранга',  percent: 15, type: 'percent' },
  { id: 9,  name: 'Командор',           percent: 20, type: 'percent' },
  { id: 10, name: 'Капитан-лейтенант',  percent: 25, type: 'percent' },
  { id: 11, name: 'Старший лейтенант',  percent: 30, type: 'percent' },
  { id: 12, name: 'Лейтенант',          percent: 40, type: 'percent' },
  { id: 13, name: 'Младший лейтенант',  percent: 50, type: 'percent' },
  { id: 14, name: 'Мичман',             percent: 60, type: 'percent' },
  { id: 15, name: 'Главный старшина',   percent: 70, type: 'percent' },
  { id: 16, name: 'Старшина I статьи',  percent: 80, type: 'percent' },
  { id: 17, name: 'Старшина II статьи', percent: 90, type: 'percent' },
  { id: 18, name: 'Старший матрос',     percent: 100, type: 'percent' },
  { id: 19, name: 'Матрос',             percent: 100, type: 'percent' },
  { id: 20, name: 'Кадет',              percent: 100, type: 'percent' },
];

// Базовые размеры мира. PvP-секторы масштабируются отдельно.
export const BASE_WORLD = {
  width: 8315,
  height: 4680,
  safeZoneRadius: 320, 
  safeCombatGrace: 2000,
};

export const PVP_WORLD_SCALE = 2.4; // Площадь ×4 относительно PvE (PvE=1.2 → PvP=2.4, ratio площадей = 2.4²/1.2² = 4)

// ── Игрок: корабль Wisp (baseline 1.0× по статам). ──────────────────────────
// Числа упрощены для прототипа; в комментариях — целевые из content-scope.
export const PLAYER = {
  shipKey: 'wisp',
  nameKey: 'ship.wisp',
  level: 1,
  displaySize: 130,       // px на экране
  hullMax: 1000,          // корпус (HP)
  shieldBase: 120,        // врождённый щит; модуль-дефлектор добавляет durability
  speed: 200,             // px/сек базовая (Wisp baseline)
  boostMult: 2.0,         // afterburner ×2
  baseShieldRegen: 20,    // щит/сек без модуля (с модулем — его regen)
  shieldRegenDelayDamage: 10000, // мс после последнего урона до регена щита
  shieldRegenDelayBoost: 6000,   // мс после окончания форсажа до регена щита
  hullRepairDelay: 10000, // мс без атаки до начала авто-ремонта корпуса
  hullRepairPctPerSec: 0.05, // корпус/сек = 5% от макс (полный за 20 сек)
  boostDrainPerSec: 60,   // щит/сек расход на форсаже (≈10% щита/сек)
  weaponRange: 750,       // дальность авто-огня (общая для корабля)
  // Урон/пробитие/скорострельность и щит/реген/уклонение берутся из надетых модулей.
};

export const PROJECTILE = {
  speed: 1400,            // px/сек
  hitRadius: 24,          // дистанция засчёта попадания
  playerColor: COLORS.primary,
  mobColor: COLORS.danger,
};

// Типы снарядов мобов. speed=0 + hitscan=true → мгновенный луч (без Projectile-объекта).
// spread=true → 3 болта в ±12° веере (ion). effect → доп. действие при попадании.
export const PROJ_TYPES = {
  plasma: { color: 0xef5350, speed: 1400, w: 32, h: 13, hitR: 24 },
  ion:    { color: 0x80d8ff, speed: 1400, w: 20, h: 8,  hitR: 18, spread: true },
  acid:   { color: 0x76ff03, speed: 720, w: 34, h: 34, hitR: 20, effect: 'dot',  dotDmg: 0.5,  dotSec: 2.0 },
  grav:   { color: 0xffb74d, speed: 480, w: 36, h: 36, hitR: 24, effect: 'push', pushDist: 180, slowMult: 0.65, slowSec: 1.5 },
  emp:    { color: 0x4dd0e1, speed: 580, w: 28, h: 28, hitR: 22, effect: 'emp',  slowMult: 0.45, slowSec: 2.0 },
  void:   { color: 0xce93d8, speed: 0,   w: 0,  h: 0,  hitR: 0,  hitscan: true,  penetration: 0.65 },
};

// ── Мобы (28 шаблонов в дизайне; в прототипе 3). HP/урон скейлятся по уровню:
// stat × (1 + 0.5 × (L − 1)). Здесь base = lvl 1. ──────────────────────────
// patrolRadius — радиус блуждания вокруг точки спавна (idle-патруль как в Andromeda5).
// leash — макс. удаление от точки охраны при погоне (Infinity = гонится свободно).
// Базовые статы = уровень 1; Mob масштабирует ×(1+0.5(L−1)). Спрайты не квадратные → Mob вписывает по аспекту.
// Фракции/уровни: corsair (Корсары — ранние, ур.1-20) / syndicate (Синдикат — мид, 15-40) / ancient (Древние — поздние, 30-50).
// Топ каждой фракции — мини-босс (boss:true → реген корпуса, фазы ярости, телеграф-AoE, дроп ⭐). elite:true → шанс +1 тир лута.
// starGold: дроп ⭐ {min,max,chance}. apophis — отдельный «большой босс» (анимированный sheet, yoyo).
export const MOBS = {
  // ── Рой (насекомые, бывшие корсары) — ур. 1-20 ──
  // passive:true на helios_1/karax_1/tides_1 выставляется при спавне, не в шаблоне.
  swarm_01: { key: 'swarm_01', nameKey: 'mob.swarm_01', faction: 'swarm', artAngleOffset: -Math.PI / 2, displaySize: 88,  hull: 60,  shield: 0,   damage: 2,  speed: 205, aggro: 780, range: 340, fireRate: 1.0,  credits: 70,   xp: 22,  patrolRadius: 280, leash: 720, projectileType: 'plasma', aiClass: 'gunner' },
  swarm_02: { key: 'swarm_02', nameKey: 'mob.swarm_02', faction: 'swarm', artAngleOffset: -Math.PI / 2, displaySize: 96,  hull: 90,  shield: 0,   damage: 3,  speed: 195, aggro: 820, range: 320, fireRate: 1.0,  credits: 95,   xp: 28,  patrolRadius: 320, leash: 780, projectileType: 'plasma', aiClass: 'gunner' },
  swarm_03: { key: 'swarm_03', nameKey: 'mob.swarm_03', faction: 'swarm', artAngleOffset: -Math.PI / 2, displaySize: 100, hull: 120, shield: 30,  damage: 4,  speed: 195, aggro: 800, range: 380, fireRate: 0.85, credits: 120,  xp: 34,  patrolRadius: 260, leash: 680, projectileType: 'plasma', aiClass: 'gunner' },
  swarm_04: { key: 'swarm_04', nameKey: 'mob.swarm_04', faction: 'swarm', artAngleOffset: -Math.PI / 2, displaySize: 98,  hull: 100, shield: 20,  damage: 5,  speed: 215, aggro: 820, range: 360, fireRate: 0.9,  credits: 130,  xp: 38,  patrolRadius: 300, leash: 760, projectileType: 'plasma', aiClass: 'gunner' },
  swarm_05: { key: 'swarm_05', nameKey: 'mob.swarm_05', faction: 'swarm', artAngleOffset: -Math.PI / 2, displaySize: 112, hull: 160, shield: 40,  damage: 5,  speed: 165, aggro: 820, range: 400, fireRate: 0.75, credits: 160,  xp: 46,  patrolRadius: 240, leash: 640, projectileType: 'plasma', aiClass: 'dasher' },
  swarm_06: { key: 'swarm_06', nameKey: 'mob.swarm_06', faction: 'swarm', artAngleOffset: -Math.PI / 2, displaySize: 116, hull: 200, shield: 50,  damage: 6,  speed: 155, aggro: 850, range: 420, fireRate: 0.7,  credits: 200,  xp: 55,  patrolRadius: 230, leash: 620, projectileType: 'plasma', aiClass: 'dasher' },
  swarm_07: { key: 'swarm_07', nameKey: 'mob.swarm_07', faction: 'swarm', artAngleOffset: -Math.PI / 2, displaySize: 118, hull: 240, shield: 60,  damage: 7,  speed: 150, aggro: 850, range: 420, fireRate: 0.7,  credits: 240,  xp: 64,  patrolRadius: 220, leash: 600, projectileType: 'plasma', aiClass: 'dasher' },
  swarm_08: { key: 'swarm_08', nameKey: 'mob.swarm_08', faction: 'swarm', artAngleOffset: -Math.PI / 2, displaySize: 128, hull: 320, shield: 90,  damage: 8,  speed: 140, aggro: 880, range: 440, fireRate: 0.65, credits: 320,  xp: 82,  patrolRadius: 210, leash: 560, elite: true, starGold: { min: 1, max: 3, chance: 0.05 }, projectileType: 'plasma', aiClass: 'berserker' },
  swarm_09: { key: 'swarm_09', nameKey: 'mob.swarm_09', faction: 'swarm', artAngleOffset: -Math.PI / 2, displaySize: 150, hull: 700, shield: 250, damage: 9,  speed: 135, aggro: 950, range: 480, fireRate: 0.55, credits: 1500, xp: 380, patrolRadius: 200, leash: 460, boss: true, bossType: 'roaming', starGold: { min: 8, max: 20, chance: 1 }, projectileType: 'plasma' },

  // ── Корсары (люди-пираты) — ур. 8-30 ──
  corsair_01: { key: 'corsair_01', nameKey: 'mob.corsair_01', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 88,  hull: 90,  shield: 0,   damage: 4,  speed: 225, aggro: 800, range: 340, fireRate: 1.0,  credits: 85,   xp: 26,  patrolRadius: 280, leash: 720, projectileType: 'plasma', aiClass: 'gunner' },
  corsair_02: { key: 'corsair_02', nameKey: 'mob.corsair_02', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 96,  hull: 120, shield: 20,  damage: 5,  speed: 235, aggro: 830, range: 360, fireRate: 0.95, credits: 115,  xp: 34,  patrolRadius: 300, leash: 760, projectileType: 'plasma', aiClass: 'dasher' },
  corsair_03: { key: 'corsair_03', nameKey: 'mob.corsair_03', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 110, hull: 170, shield: 30,  damage: 6,  speed: 190, aggro: 820, range: 400, fireRate: 0.85, credits: 150,  xp: 44,  patrolRadius: 260, leash: 680, projectileType: 'plasma', aiClass: 'gunner' },
  corsair_04: { key: 'corsair_04', nameKey: 'mob.corsair_04', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 84,  hull: 85,  shield: 0,   damage: 4,  speed: 250, aggro: 840, range: 330, fireRate: 1.0,  credits: 95,   xp: 28,  patrolRadius: 320, leash: 800, projectileType: 'plasma', aiClass: 'dasher' },
  corsair_05: { key: 'corsair_05', nameKey: 'mob.corsair_05', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 118, hull: 220, shield: 50,  damage: 7,  speed: 175, aggro: 850, range: 410, fireRate: 0.8,  credits: 190,  xp: 56,  patrolRadius: 240, leash: 640, projectileType: 'plasma', aiClass: 'gunner' },
  corsair_06: { key: 'corsair_06', nameKey: 'mob.corsair_06', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 108, hull: 170, shield: 90,  damage: 5,  speed: 200, aggro: 860, range: 420, fireRate: 0.8,  credits: 170,  xp: 50,  patrolRadius: 260, leash: 680, projectileType: 'emp',    aiClass: 'shielder' },
  corsair_07: { key: 'corsair_07', nameKey: 'mob.corsair_07', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 130, hull: 340, shield: 80,  damage: 9,  speed: 155, aggro: 870, range: 430, fireRate: 0.72, credits: 310,  xp: 88,  patrolRadius: 230, leash: 620, projectileType: 'plasma', aiClass: 'gunner' },
  corsair_08: { key: 'corsair_08', nameKey: 'mob.corsair_08', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 140, hull: 400, shield: 110, damage: 10, speed: 162, aggro: 880, range: 450, fireRate: 0.68, credits: 390,  xp: 105, patrolRadius: 210, leash: 580, elite: true, starGold: { min: 1, max: 3, chance: 0.06 }, projectileType: 'plasma', aiClass: 'berserker' },
  corsair_09: { key: 'corsair_09', nameKey: 'mob.corsair_09', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 158, hull: 950, shield: 320, damage: 11, speed: 142, aggro: 960, range: 490, fireRate: 0.55, credits: 1800, xp: 450, patrolRadius: 200, leash: 470, boss: true, bossType: 'roaming', starGold: { min: 9, max: 22, chance: 1 }, projectileType: 'plasma' },

  // ── Синдикат (организованная преступность) — ур. 15-45 ──
  syndicate_01: { key: 'syndicate_01', nameKey: 'mob.syndicate_01', faction: 'syndicate', artAngleOffset: -Math.PI / 2, displaySize: 108, hull: 200, shield: 130, damage: 7,  speed: 165, aggro: 860, range: 440, fireRate: 0.8,  credits: 260,  xp: 70,  patrolRadius: 250, leash: 660, projectileType: 'plasma', aiClass: 'gunner' },
  syndicate_02: { key: 'syndicate_02', nameKey: 'mob.syndicate_02', faction: 'syndicate', artAngleOffset: -Math.PI / 2, displaySize: 114, hull: 260, shield: 170, damage: 8,  speed: 165, aggro: 860, range: 500, fireRate: 0.8,  credits: 320,  xp: 86,  patrolRadius: 240, leash: 640, projectileType: 'ion',    aiClass: 'gunner' },
  syndicate_03: { key: 'syndicate_03', nameKey: 'mob.syndicate_03', faction: 'syndicate', artAngleOffset: -Math.PI / 2, displaySize: 120, hull: 330, shield: 210, damage: 9,  speed: 155, aggro: 880, range: 460, fireRate: 0.75, credits: 400,  xp: 105, patrolRadius: 230, leash: 620, projectileType: 'ion',    aiClass: 'shielder' },
  syndicate_04: { key: 'syndicate_04', nameKey: 'mob.syndicate_04', faction: 'syndicate', artAngleOffset: -Math.PI / 2, displaySize: 110, hull: 240, shield: 150, damage: 8,  speed: 195, aggro: 880, range: 440, fireRate: 0.85, credits: 360,  xp: 96,  patrolRadius: 280, leash: 720, projectileType: 'ion',    aiClass: 'shielder' },
  syndicate_05: { key: 'syndicate_05', nameKey: 'mob.syndicate_05', faction: 'syndicate', artAngleOffset: -Math.PI / 2, displaySize: 126, hull: 420, shield: 280, damage: 11, speed: 150, aggro: 900, range: 480, fireRate: 0.7,  credits: 520,  xp: 135, patrolRadius: 220, leash: 600, elite: true, starGold: { min: 1, max: 4, chance: 0.07 }, projectileType: 'emp', aiClass: 'cloaker' },
  syndicate_06: { key: 'syndicate_06', nameKey: 'mob.syndicate_06', faction: 'syndicate', artAngleOffset: -Math.PI / 2, displaySize: 136, hull: 900, shield: 520, damage: 12, speed: 145, aggro: 960, range: 500, fireRate: 0.55, credits: 2200, xp: 520, patrolRadius: 200, leash: 480, boss: true, bossType: 'roaming', starGold: { min: 10, max: 24, chance: 1 }, projectileType: 'emp' },
  syndicate_07: { key: 'syndicate_07', nameKey: 'mob.syndicate_07', faction: 'syndicate', artAngleOffset: -Math.PI / 2, displaySize: 124, hull: 480, shield: 280, damage: 11, speed: 158, aggro: 900, range: 460, fireRate: 0.72, credits: 620,  xp: 160, patrolRadius: 230, leash: 610, projectileType: 'ion',    aiClass: 'gunner' },
  syndicate_08: { key: 'syndicate_08', nameKey: 'mob.syndicate_08', faction: 'syndicate', artAngleOffset: -Math.PI / 2, displaySize: 132, hull: 560, shield: 320, damage: 13, speed: 145, aggro: 900, range: 640, fireRate: 0.65, credits: 720,  xp: 185, patrolRadius: 220, leash: 590, projectileType: 'ion',    aiClass: 'gunner' },
  syndicate_09: { key: 'syndicate_09', nameKey: 'mob.syndicate_09', faction: 'syndicate', artAngleOffset: -Math.PI / 2, displaySize: 116, hull: 360, shield: 240, damage: 10, speed: 205, aggro: 920, range: 480, fireRate: 0.8,  credits: 560,  xp: 145, patrolRadius: 260, leash: 680, elite: true, starGold: { min: 1, max: 3, chance: 0.06 }, projectileType: 'plasma', aiClass: 'cloaker' },
  syndicate_10: { key: 'syndicate_10', nameKey: 'mob.syndicate_10', faction: 'syndicate', artAngleOffset: -Math.PI / 2, displaySize: 142, hull: 800, shield: 480, damage: 14, speed: 150, aggro: 960, range: 500, fireRate: 0.6,  credits: 1100, xp: 280, patrolRadius: 210, leash: 560, elite: true, starGold: { min: 2, max: 6, chance: 0.1 },  projectileType: 'emp',    aiClass: 'gunner' },
  syndicate_11: { key: 'syndicate_11', nameKey: 'mob.syndicate_11', faction: 'syndicate', artAngleOffset: -Math.PI / 2, displaySize: 155, hull: 1600, shield: 900, damage: 16, speed: 140, aggro: 980, range: 520, fireRate: 0.5,  credits: 3000, xp: 700, patrolRadius: 200, leash: 480, boss: true, bossType: 'roaming', starGold: { min: 12, max: 28, chance: 1 }, projectileType: 'emp' },

  // ── Дезертиры Конфедерации (military) — ур. 25-50 ──
  confed_01: { key: 'syndicate_07',     nameKey: 'mob.confed_01', faction: 'confed', artAngleOffset: -Math.PI / 2, displaySize: 112, hull: 380,  shield: 210, damage: 10, speed: 175, aggro: 920,  range: 460, fireRate: 0.85, credits: 480,  xp: 125, patrolRadius: 240, leash: 680, projectileType: 'plasma', aiClass: 'dasher' },
  confed_02: { key: 'syndicate_09',     nameKey: 'mob.confed_02', faction: 'confed', artAngleOffset: -Math.PI / 2, displaySize: 98,  hull: 240,  shield: 180, damage: 8,  speed: 215, aggro: 980,  range: 480, fireRate: 0.9,  credits: 420,  xp: 110, patrolRadius: 300, leash: 780, projectileType: 'plasma', aiClass: 'cloaker' },
  confed_06: { key: 'syndicate_08',     nameKey: 'mob.confed_06', faction: 'confed', artAngleOffset: -Math.PI / 2, displaySize: 116, hull: 450,  shield: 320, damage: 11, speed: 195, aggro: 940,  range: 500, fireRate: 0.75, credits: 600,  xp: 150, patrolRadius: 220, leash: 620, elite: true, projectileType: 'plasma', aiClass: 'dasher' },
  confed_09: { key: 'syndicate_11',     nameKey: 'mob.confed_09', faction: 'confed', artAngleOffset: -Math.PI / 2, displaySize: 140, hull: 1100, shield: 650, damage: 14, speed: 155, aggro: 1050, range: 550, fireRate: 0.6,  credits: 2800, xp: 680, patrolRadius: 200, leash: 500, boss: true, bossType: 'static', starGold: { min: 12, max: 28, chance: 1 }, projectileType: 'grav', aiClass: 'berserker' },

  // ── Частная Безопасность (corporate) — ур. 20-50 ──
  sec_drone:     { key: 'guard_drone', nameKey: 'mob.sec_drone',     faction: 'security', artAngleOffset: -Math.PI / 2, displaySize: 75,  hull: 220,  shield: 350, damage: 6,  speed: 205, aggro: 850,  range: 450, fireRate: 1.0, credits: 380,  xp: 95,   patrolRadius: 250, leash: 700, neutral: true, projectileType: 'ion',  aiClass: 'gunner' },
  sec_destroyer: { key: 'guard_main', nameKey: 'mob.sec_destroyer', faction: 'security', artAngleOffset: -Math.PI / 2, displaySize: 180, hull: 1400, shield: 750, damage: 17, speed: 135, aggro: 1100, range: 650, fireRate: 0.5, credits: 4500, xp: 1100, patrolRadius: 200, leash: 480, boss: true, bossType: 'static', neutral: true, starGold: { min: 15, max: 35, chance: 1 }, projectileType: 'grav' },

  // ── Охрана нейтральных баз (PvP-секторы, пассивны до атаки) ──
  guard_main:  { key: 'guard_main',  nameKey: 'mob.guard_main',  faction: 'guard', artAngleOffset: -Math.PI / 2, displaySize: 130, hull: 650,  shield: 200, damage: 18, speed: 130, aggro: 900, range: 520, fireRate: 0.7, credits: 600,  xp: 140, patrolRadius: 300, leash: 1500, neutral: true, projectileType: 'plasma', aiClass: 'gunner' },
  guard_drone: { key: 'guard_drone', nameKey: 'mob.guard_drone', faction: 'guard', artAngleOffset: -Math.PI / 2, displaySize: 80,  hull: 200,  shield: 80,  damage: 8,  speed: 200, aggro: 700, range: 400, fireRate: 1.2, credits: 200,  xp: 50,  patrolRadius: 300, leash: 1500, neutral: true, projectileType: 'plasma', aiClass: 'gunner' },

  // ── Древние (биомех) — ур. 30-50 ──
  ancient_01: { key: 'ancient_01', nameKey: 'mob.ancient_01', faction: 'ancient', artAngleOffset: -Math.PI / 2, displaySize: 130, hull: 500,  shield: 320, damage: 11, speed: 140, aggro: 950,  range: 500, fireRate: 0.65, credits: 700,  xp: 180, patrolRadius: 220, leash: 520, projectileType: 'acid', aiClass: 'gunner' },
  ancient_02: { key: 'ancient_02', nameKey: 'mob.ancient_02', faction: 'ancient', artAngleOffset: -Math.PI / 2, displaySize: 126, hull: 460,  shield: 380, damage: 12, speed: 150, aggro: 950,  range: 520, fireRate: 0.6,  credits: 760,  xp: 195, patrolRadius: 230, leash: 540, projectileType: 'acid', aiClass: 'shielder' },
  ancient_03: { key: 'ancient_03', nameKey: 'mob.ancient_03', faction: 'ancient', artAngleOffset: -Math.PI / 2, displaySize: 142, hull: 720,  shield: 420, damage: 13, speed: 128, aggro: 970,  range: 520, fireRate: 0.55, credits: 950,  xp: 240, patrolRadius: 210, leash: 500, elite: true, projectileType: 'acid', aiClass: 'gunner' },
  ancient_04: { key: 'ancient_04', nameKey: 'mob.ancient_04', faction: 'ancient', artAngleOffset: -Math.PI / 2, displaySize: 122, hull: 480,  shield: 340, damage: 13, speed: 175, aggro: 960,  range: 500, fireRate: 0.7,  credits: 820,  xp: 210, patrolRadius: 260, leash: 640, projectileType: 'void', aiClass: 'cloaker' },
  ancient_05: { key: 'ancient_05', nameKey: 'mob.ancient_05', faction: 'ancient', artAngleOffset: -Math.PI / 2, displaySize: 150, hull: 820,  shield: 520, damage: 14, speed: 125, aggro: 980,  range: 540, fireRate: 0.5,  credits: 1200, xp: 300, patrolRadius: 200, leash: 480, elite: true, starGold: { min: 2, max: 5, chance: 0.1 }, projectileType: 'acid', aiClass: 'berserker' },
  ancient_06: { key: 'ancient_06', nameKey: 'mob.ancient_06', faction: 'ancient', artAngleOffset: -Math.PI / 2, displaySize: 162, hull: 1400, shield: 820, damage: 15, speed: 130, aggro: 1000, range: 560, fireRate: 0.5,  credits: 3500, xp: 760, patrolRadius: 200, leash: 480, boss: true, bossType: 'static', starGold: { min: 14, max: 30, chance: 1 }, projectileType: 'void' },
  ancient_07: { key: 'ancient_07', nameKey: 'mob.ancient_07', faction: 'ancient', artAngleOffset: -Math.PI / 2, displaySize: 100, hull: 300, shield: 100, damage: 8,  speed: 80,  aggro: 600, range: 350, fireRate: 0.9,  credits: 600,  xp: 150, patrolRadius: 150, leash: 400, projectileType: 'grav',   aiClass: 'gunner' },
  ancient_08: { key: 'ancient_08', nameKey: 'mob.ancient_08', faction: 'ancient', artAngleOffset: -Math.PI / 2, displaySize: 122, hull: 420, shield: 320, damage: 9,  speed: 145, aggro: 960, range: 530, fireRate: 0.65, credits: 800,  xp: 200, patrolRadius: 230, leash: 540, projectileType: 'void',   aiClass: 'shielder' },
  ancient_09: { key: 'ancient_09', nameKey: 'mob.ancient_09', faction: 'ancient', artAngleOffset: -Math.PI / 2, displaySize: 148, hull: 850, shield: 480, damage: 16, speed: 122, aggro: 980, range: 540, fireRate: 0.55, credits: 1050, xp: 265, patrolRadius: 210, leash: 510, projectileType: 'acid',   aiClass: 'gunner' },
  ancient_10: { key: 'ancient_10', nameKey: 'mob.ancient_10', faction: 'ancient', artAngleOffset: -Math.PI / 2, displaySize: 172, hull: 1200, shield: 650, damage: 18, speed: 110, aggro: 990, range: 560, fireRate: 0.5,  credits: 1400, xp: 350, patrolRadius: 200, leash: 490, elite: true, starGold: { min: 3, max: 7, chance: 0.12 }, projectileType: 'acid',   aiClass: 'gunner' },
  ancient_11: { key: 'ancient_11', nameKey: 'mob.ancient_11', faction: 'ancient', artAngleOffset: -Math.PI / 2, displaySize: 132, hull: 520, shield: 300, damage: 15, speed: 188, aggro: 980, range: 520, fireRate: 0.65, credits: 950,  xp: 240, patrolRadius: 250, leash: 640, elite: true, starGold: { min: 2, max: 5, chance: 0.08 }, projectileType: 'void',   aiClass: 'cloaker' },

  // ── БОЛЬШОЙ БОСС (R1-тип) — кристальное ядро + 3 вращающихся кольца (GameScene._apophisRings) ──
  apophis: { key: 'ancient_12', nameKey: 'mob.apophis', faction: 'ancient', artAngleOffset: 0, displaySize: 210, hull: 1800, shield: 1100, damage: 48, speed: 120, aggro: 1100, range: 600, fireRate: 0.5, credits: 5000, xp: 1200, patrolRadius: 240, leash: Infinity, boss: true, bossType: 'dungeon', starGold: { min: 20, max: 40, chance: 1 }, projectileType: 'acid' },

  // ── АРГУС (Admin-only) ──
  argus_boss: { key: 'argus_boss', nameKey: 'mob.argus_boss', faction: 'admin', artAngleOffset: -Math.PI / 2, displaySize: 220, hull: 12000, shield: 8000, damage: 189, speed: 180, aggro: 1400, range: 620, fireRate: 1.5, credits: 0, xp: 0, patrolRadius: 300, leash: Infinity, boss: true, projectileType: 'plasma' },
};

// ── Боссы: фазы (ярость) + телеграфированный AoE-залп ──────────────────────────
// Дизайн (content-scope): boss-фазы и telegraphed AoE (warning → детонация, ~60% урона если не уйти).
// Числа упрощены для прототипа Стража; масштабируются для D-боссов и R1.
export const BOSS = {
  enrageAt: 0.40,          // доля корпуса, при которой босс входит в ярость (фаза 2)
  enrageFireMult: 1.6,     // ×скорострельность в ярости
  enrageSpeedMult: 1.35,   // ×скорость движения в ярости
  aoeRadius: 210,          // px радиус AoE-залпа
  aoeTelegraphP1: 1100,    // мс предупреждения (фаза 1)
  aoeTelegraphP2: 800,     // мс предупреждения (фаза 2 — короче, опаснее)
  aoeCooldownP1: 6500,     // мс между залпами (фаза 1)
  aoeCooldownP2: 4200,     // мс между залпами (фаза 2)
  aoeDamage: 420,          // урон в ЦЕНТРЕ круга
  aoeEdgeFactor: 0.25,     // доля урона на самом краю (линейный спад центр→край)
  aoePenetration: 0.5,     // доля урона сразу в корпус (≈40% EHP Wisp в центре)
  enrageTint: 0xff7a6b,    // подкраска спрайта в ярости
};

// Реген мобов. Щит — у всех мобов со щитом; корпус — только у боссов, через 1 мин без урона.
export const MOB_REGEN = {
  shieldDelay: 5000,       // мс без урона до начала регена щита
  shieldFullSec: 10,       // полный щит за N секунд
  bossHullDelay: 60000,    // мс без урона до ремонта корпуса босса (1 минута)
  bossHullPctPerSec: 0.05, // корпус/сек = 5% от макс
};

// Плавность управления
export const HANDLING = {
  turnRate: 5.5,   // рад/сек — скорость доворота носа к курсу (сглаживает рывки)
  accel: 800,      // px/сек² — разгон/торможение до целевой скорости
};

// Миникарта (правый верх) — прямоугольная 16:9 под аспект карт. Клик задаёт курс.
export const MINIMAP = { w: 250, h: 140, pad: 16 };

// Текущая карта-фон сектора (файл assets/maps/<key>.jpg). Гелиос-Прайм = helios_1.
// Доступны: HM1-5 (шаблоны), helios_1-5 / kar_1-5 (корп-варианты), D3/D4/D5/D-prem,
// PvP-1..4, Arena-1..3, R-1-boss. Все 1672×941 (16:9), чистый космо-фон без структур.
export const MAP = { key: 'helios_1' };

// Device pixel ratio (масштаб Windows/HiDPI). Игра рендерится в физических пикселях × DPR,
// мир-камера зумится на DPR → крупность прежняя, но без браузерного апскейла = чётко. Кап 2 — перф/память.
export const DPR = Math.min(window.devicePixelRatio || 1, 2);

// Чёткость шрифтов: рендерим текст в ×UI_RES разрешении (лечит блюр на HiDPI/масштабе Windows).
// ×2 от DPR даёт ~2× оверсэмплинг над физическими пикселями. Кап 4 — экономия памяти.
export const UI_RES = Math.min(4, Math.max(2, Math.ceil((window.devicePixelRatio || 1) * 2)));

// Спрайты кораблей/мобов нарисованы носом ВВЕРХ. rotation 0 в Phaser = вправо.
// Поэтому к углу движения прибавляем +90°, чтобы нос смотрел по курсу.
export const ART_ANGLE_OFFSET = Math.PI / 2;

// Базовый радиус сканирования врагов/лута на миникарте (мировые пиксели).
// Скилл scanner_boost добавляет +20% за уровень (×3 уровня = до +60%).
export const BASE_SCAN_RADIUS = 900;

export const RESPAWN_MS = 8000; // моб возвращается в систему через 8 сек после смерти

// Honor awarded for killing a level-50 player in PvP.
// Scales linearly: honorForLevel(lvl) = Math.round(lvl * HONOR_PER_LVL50 / 50)
// Argus = 10× this value.  Apophysis boss = 1× this value.
export const HONOR_PER_LVL50 = 25000;
