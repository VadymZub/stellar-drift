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
  width: 6929,
  height: 3900,
  safeZoneRadius: 320, 
  safeCombatGrace: 2000,
};

export const PVP_WORLD_SCALE = 2.0; // Площадь ×4 (2×2)

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
  shieldRegenDelayBoost: 5000,   // мс после окончания форсажа до регена щита
  hullRepairDelay: 10000, // мс без атаки до начала авто-ремонта корпуса
  hullRepairPctPerSec: 0.05, // корпус/сек = 5% от макс (полный за 20 сек)
  boostDrainPerSec: 60,   // щит/сек расход на форсаже (≈10% щита/сек)
  weaponRange: 750,       // дальность авто-огня (общая для корабля)
  // Урон/пробитие/скорострельность и щит/реген/уклонение берутся из надетых модулей.
};

export const PROJECTILE = {
  speed: 950,             // px/сек
  hitRadius: 22,          // дистанция засчёта попадания
  playerColor: COLORS.primary,
  mobColor: COLORS.danger,
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
  // ── Корсары (насекомые) — ур. 1-20 ──
  pirate_01: { key: 'pirate_01', nameKey: 'mob.pirate_01', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 88,  hull: 60,  shield: 0,   damage: 8,  speed: 205, aggro: 780, range: 340, fireRate: 1.0,  credits: 70,   xp: 22,  patrolRadius: 280, leash: 720 },
  pirate_02: { key: 'pirate_02', nameKey: 'mob.pirate_02', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 96,  hull: 90,  shield: 0,   damage: 11, speed: 195, aggro: 820, range: 320, fireRate: 1.0,  credits: 95,   xp: 28,  patrolRadius: 320, leash: 780 },
  pirate_03: { key: 'pirate_03', nameKey: 'mob.pirate_03', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 100, hull: 120, shield: 30,  damage: 15, speed: 195, aggro: 800, range: 380, fireRate: 0.85, credits: 120,  xp: 34,  patrolRadius: 260, leash: 680 },
  pirate_04: { key: 'pirate_04', nameKey: 'mob.pirate_04', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 98,  hull: 100, shield: 20,  damage: 18, speed: 215, aggro: 820, range: 360, fireRate: 0.9,  credits: 130,  xp: 38,  patrolRadius: 300, leash: 760 },
  pirate_05: { key: 'pirate_05', nameKey: 'mob.pirate_05', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 112, hull: 160, shield: 40,  damage: 21, speed: 165, aggro: 820, range: 400, fireRate: 0.75, credits: 160,  xp: 46,  patrolRadius: 240, leash: 640 },
  pirate_06: { key: 'pirate_06', nameKey: 'mob.pirate_06', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 116, hull: 200, shield: 50,  damage: 25, speed: 155, aggro: 850, range: 420, fireRate: 0.7,  credits: 200,  xp: 55,  patrolRadius: 230, leash: 620 },
  pirate_07: { key: 'pirate_07', nameKey: 'mob.pirate_07', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 118, hull: 240, shield: 60,  damage: 27, speed: 150, aggro: 850, range: 420, fireRate: 0.7,  credits: 240,  xp: 64,  patrolRadius: 220, leash: 600 },
  pirate_08: { key: 'pirate_08', nameKey: 'mob.pirate_08', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 128, hull: 320, shield: 90,  damage: 31, speed: 140, aggro: 880, range: 440, fireRate: 0.65, credits: 320,  xp: 82,  patrolRadius: 210, leash: 560, elite: true, starGold: { min: 1, max: 3, chance: 0.05 } },
  pirate_09: { key: 'pirate_09', nameKey: 'mob.pirate_09', faction: 'corsair', artAngleOffset: -Math.PI / 2, displaySize: 150, hull: 700, shield: 250, damage: 34, speed: 135, aggro: 950, range: 480, fireRate: 0.55, credits: 1500, xp: 380, patrolRadius: 200, leash: 460, boss: true, starGold: { min: 8, max: 20, chance: 1 } },

  // ── Синдикат (серые наёмники) — ур. 15-40 ──
  syndicate_01: { key: 'syndicate_01', nameKey: 'mob.syndicate_01', faction: 'syndicate', artAngleOffset: -Math.PI / 2, displaySize: 108, hull: 200, shield: 130, damage: 26, speed: 165, aggro: 860, range: 440, fireRate: 0.8,  credits: 260,  xp: 70,  patrolRadius: 250, leash: 660 },
  syndicate_02: { key: 'syndicate_02', nameKey: 'mob.syndicate_02', faction: 'syndicate', artAngleOffset: -Math.PI / 2, displaySize: 114, hull: 260, shield: 170, damage: 31, speed: 165, aggro: 860, range: 450, fireRate: 0.8,  credits: 320,  xp: 86,  patrolRadius: 240, leash: 640 },
  syndicate_03: { key: 'syndicate_03', nameKey: 'mob.syndicate_03', faction: 'syndicate', artAngleOffset: -Math.PI / 2, displaySize: 120, hull: 330, shield: 210, damage: 37, speed: 155, aggro: 880, range: 460, fireRate: 0.75, credits: 400,  xp: 105, patrolRadius: 230, leash: 620 },
  syndicate_04: { key: 'syndicate_04', nameKey: 'mob.syndicate_04', faction: 'syndicate', artAngleOffset: -Math.PI / 2, displaySize: 110, hull: 240, shield: 150, damage: 33, speed: 195, aggro: 880, range: 440, fireRate: 0.85, credits: 360,  xp: 96,  patrolRadius: 280, leash: 720 },
  syndicate_05: { key: 'syndicate_05', nameKey: 'mob.syndicate_05', faction: 'syndicate', artAngleOffset: -Math.PI / 2, displaySize: 126, hull: 420, shield: 280, damage: 42, speed: 150, aggro: 900, range: 480, fireRate: 0.7,  credits: 520,  xp: 135, patrolRadius: 220, leash: 600, elite: true, starGold: { min: 1, max: 4, chance: 0.07 } },
  syndicate_06: { key: 'syndicate_06', nameKey: 'mob.syndicate_06', faction: 'syndicate', artAngleOffset: -Math.PI / 2, displaySize: 136, hull: 900, shield: 520, damage: 46, speed: 145, aggro: 960, range: 500, fireRate: 0.55, credits: 2200, xp: 520, patrolRadius: 200, leash: 480, boss: true, starGold: { min: 10, max: 24, chance: 1 } },

  // ── Дезертиры Конфедерации (military) — ур. 25-50 ──
  confed_01: { key: 'm01_striker', nameKey: 'mob.confed_01', faction: 'confed', artAngleOffset: -Math.PI / 2, displaySize: 112, hull: 380, shield: 210, damage: 38, speed: 175, aggro: 920, range: 460, fireRate: 0.85, credits: 480,  xp: 125, patrolRadius: 240, leash: 680 },
  confed_02: { key: 'm02_scout',   nameKey: 'mob.confed_02', faction: 'confed', artAngleOffset: -Math.PI / 2, displaySize: 98,  hull: 240, shield: 180, damage: 32, speed: 215, aggro: 980, range: 480, fireRate: 0.9,  credits: 420,  xp: 110, patrolRadius: 300, leash: 780 },
  confed_06: { key: 'm06_interceptor', nameKey: 'mob.confed_06', faction: 'confed', artAngleOffset: -Math.PI / 2, displaySize: 116, hull: 450, shield: 320, damage: 44, speed: 195, aggro: 940, range: 500, fireRate: 0.75, credits: 600,  xp: 150, patrolRadius: 220, leash: 620, elite: true },
  confed_09: { key: 'm09_elite_fighter', nameKey: 'mob.confed_09', faction: 'confed', artAngleOffset: -Math.PI / 2, displaySize: 140, hull: 1100, shield: 650, damage: 54, speed: 155, aggro: 1050, range: 550, fireRate: 0.6,  credits: 2800, xp: 680, patrolRadius: 200, leash: 500, boss: true, starGold: { min: 12, max: 28, chance: 1 } },

  // ── Частная Безопасность (corporate) — ур. 20-50 ──
  sec_drone: { key: 'aegis', nameKey: 'mob.sec_drone', faction: 'security', artAngleOffset: Math.PI / 2, displaySize: 75, hull: 220, shield: 350, damage: 24, speed: 205, aggro: 850, range: 450, fireRate: 1.0,  credits: 380,  xp: 95,  patrolRadius: 250, leash: 700, neutral: true },
  sec_destroyer: { key: 'anvil', nameKey: 'mob.sec_destroyer', faction: 'security', artAngleOffset: Math.PI / 2, displaySize: 180, hull: 1400, shield: 750, damage: 68, speed: 135, aggro: 1100, range: 650, fireRate: 0.5, credits: 4500, xp: 1100, patrolRadius: 200, leash: 480, boss: true, neutral: true, starGold: { min: 15, max: 35, chance: 1 } },

  // ── Древние (биомех) — ур. 30-50 ──
  ancient_01: { key: 'ancient_01', nameKey: 'mob.ancient_01', faction: 'ancient', artAngleOffset: -Math.PI / 2, displaySize: 130, hull: 500, shield: 320, damage: 44, speed: 140, aggro: 950, range: 500, fireRate: 0.65, credits: 700,  xp: 180, patrolRadius: 220, leash: 520 },
  ancient_02: { key: 'ancient_02', nameKey: 'mob.ancient_02', faction: 'ancient', artAngleOffset: -Math.PI / 2, displaySize: 126, hull: 460, shield: 380, damage: 48, speed: 150, aggro: 950, range: 520, fireRate: 0.6,  credits: 760,  xp: 195, patrolRadius: 230, leash: 540 },
  ancient_03: { key: 'ancient_03', nameKey: 'mob.ancient_03', faction: 'ancient', artAngleOffset: -Math.PI / 2, displaySize: 142, hull: 720, shield: 420, damage: 52, speed: 128, aggro: 970, range: 520, fireRate: 0.55, credits: 950,  xp: 240, patrolRadius: 210, leash: 500, elite: true },
  ancient_04: { key: 'ancient_04', nameKey: 'mob.ancient_04', faction: 'ancient', artAngleOffset: -Math.PI / 2, displaySize: 122, hull: 480, shield: 340, damage: 50, speed: 175, aggro: 960, range: 500, fireRate: 0.7,  credits: 820,  xp: 210, patrolRadius: 260, leash: 640 },
  ancient_05: { key: 'ancient_05', nameKey: 'mob.ancient_05', faction: 'ancient', artAngleOffset: -Math.PI / 2, displaySize: 150, hull: 820, shield: 520, damage: 56, speed: 125, aggro: 980, range: 540, fireRate: 0.5,  credits: 1200, xp: 300, patrolRadius: 200, leash: 480, elite: true, starGold: { min: 2, max: 5, chance: 0.1 } },
  ancient_06: { key: 'ancient_06', nameKey: 'mob.ancient_06', faction: 'ancient', artAngleOffset: -Math.PI / 2, displaySize: 162, hull: 1400, shield: 820, damage: 60, speed: 130, aggro: 1000, range: 560, fireRate: 0.5, credits: 3500, xp: 760, patrolRadius: 200, leash: 480, boss: true, starGold: { min: 14, max: 30, chance: 1 } },

  // ── БОЛЬШОЙ БОСС (R1-тип) — анимированный апекс (6 кадров 306×419, yoyo). Грузится отдельным spritesheet. ──
  apophis: { key: 'bigboss', sheetKey: 'bigboss', anim: 'bigboss_idle', frameW: 306, frameH: 419, nameKey: 'mob.apophis', faction: 'ancient', displaySize: 240, hull: 1800, shield: 1100, damage: 64, speed: 120, aggro: 1100, range: 600, fireRate: 0.5, credits: 5000, xp: 1200, patrolRadius: 240, leash: Infinity, boss: true, starGold: { min: 20, max: 40, chance: 1 } },
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

// Текущая карта-фон сектора (файл assets/maps/<key>.png). Гелиос-Прайм = helios_1.
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

export const RESPAWN_MS = 8000; // моб возвращается в систему через 8 сек после смерти
