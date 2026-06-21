// Галактика: 3 корпорации + 6 общих данжей + PvP-зоны + босс-карта.
// Данжи общие для всех корп — доступны через панель на карте (M).
// sx/sy — позиция на схеме (экран M). map — ключ фоновой текстуры.
export const SECTORS = {
  // ══════════════════════════════════════════════════════════════════════
  // HELIOS  (sy = 0, данжи sy = -1)
  // ══════════════════════════════════════════════════════════════════════
  helios_1: { name: 'Гелиос-Прайм',           map: 'helios_1', lvlMin: 1,  lvlMax: 10, sx: 0, sy: 0 },
  helios_2: { name: 'Орбитальная Верфь',       map: 'helios_2', lvlMin: 10, lvlMax: 20, sx: 1, sy: 0 },
  helios_3: { name: 'Звёздная Гавань Атрус',   map: 'helios_3', lvlMin: 20, lvlMax: 30, sx: 2, sy: 0 },
  helios_4: { name: 'Глубокий Гелиос',         map: 'helios_4', lvlMin: 30, lvlMax: 40, sx: 3, sy: 0 },
  helios_5: { name: 'Бастион Конфедерации',    map: 'helios_5', lvlMin: 40, lvlMax: 50, sx: 4, sy: 0 },

  dungeon_1: { name: 'Заброшенная Шахта',      map: 'D1', lvlMin: 5,  lvlMax: 15, sx: 0, sy: -1, isDungeon: true },
  dungeon_2: { name: 'Логово Контрабандистов', map: 'D2', lvlMin: 15, lvlMax: 25, sx: 1, sy: -1, isDungeon: true },
  dungeon_3: { name: 'Забытый Форпост',        map: 'D3', lvlMin: 25, lvlMax: 35, sx: 2, sy: -1, isDungeon: true },
  dungeon_4: { name: 'Обломки Станции',        map: 'D4', lvlMin: 35, lvlMax: 45, sx: 3, sy: -1, isDungeon: true },
  dungeon_5: { name: 'Хранилище Древних',      map: 'D5', lvlMin: 45, lvlMax: 50, sx: 4, sy: -1, isDungeon: true },

  // ══════════════════════════════════════════════════════════════════════
  // PvP — общие зоны для всех корпораций (sy = 1)
  // ══════════════════════════════════════════════════════════════════════
  pvp_1: { name: 'Граница X-12',     map: 'PvP-1',    lvlMin: 11, lvlMax: 25, sx: 1, sy: 1, pvp: true },
  pvp_2: { name: 'Граница X-44',     map: 'PvP-2',    lvlMin: 21, lvlMax: 35, sx: 2, sy: 1, pvp: true },
  pvp_3: { name: 'Алгол',            map: 'PvP-3',    lvlMin: 31, lvlMax: 45, sx: 3, sy: 1, pvp: true },
  pvp_4: { name: 'Нейтральная Зона', map: 'PvP-4',    lvlMin: 41, lvlMax: 50, sx: 4, sy: 1, pvp: true },
  pvp_5: { name: 'Сердце Бездны',    map: 'pvp_5',    lvlMin: 45, lvlMax: 50, sx: 5, sy: 1, pvp: true },
  'R-1-boss': { name: 'Алгол: Зов Апофиса', map: 'R-1-boss', lvlMin: 45, lvlMax: 50, sx: 6, sy: 1, isDungeon: true },

  // Персональный сектор — арена для Боя с тенью. Нет джампгейтов, нет мобов, нет базы.
  shadow_arena: { name: 'Арена Теней', map: 'helios_1', lvlMin: 1, lvlMax: 50, sx: -99, sy: -99, personal: true },

  // ══════════════════════════════════════════════════════════════════════
  // KARAX  (sy = -2)
  // ══════════════════════════════════════════════════════════════════════
  karax_1: { name: 'Литейные Заводы Karax', map: 'kar_1', lvlMin: 1,  lvlMax: 10, sx: 0, sy: -2 },
  karax_2: { name: 'Магма-Прайм',           map: 'kar_2', lvlMin: 10, lvlMax: 20, sx: 1, sy: -2 },
  karax_3: { name: 'Форж-Нексус',           map: 'kar_3', lvlMin: 20, lvlMax: 30, sx: 2, sy: -2 },
  karax_4: { name: 'Железный Узел',         map: 'kar_4', lvlMin: 30, lvlMax: 40, sx: 3, sy: -2 },
  karax_5: { name: 'Сердце Karax',          map: 'kar_5', lvlMin: 40, lvlMax: 50, sx: 4, sy: -2 },


  // ══════════════════════════════════════════════════════════════════════
  // TIDES  (sy = 2)
  // ══════════════════════════════════════════════════════════════════════
  tides_1: { name: 'Лазурные Рифы',        map: 'HM1', lvlMin: 1,  lvlMax: 10, sx: 0, sy: 2 },
  tides_2: { name: 'Туманность Омут',      map: 'HM2', lvlMin: 10, lvlMax: 20, sx: 1, sy: 2 },
  tides_3: { name: 'Туманный Архив',       map: 'HM3', lvlMin: 20, lvlMax: 30, sx: 2, sy: 2 },
  tides_4: { name: 'Бездонный Риф',        map: 'HM4', lvlMin: 30, lvlMax: 40, sx: 3, sy: 2 },
  tides_5: { name: 'Предел Горизонта',     map: 'HM5', lvlMin: 40, lvlMax: 50, sx: 4, sy: 2 },

  tides_d4: { name: 'Лабиринт Тьмы',      map: 'D-prem', lvlMin: 40, lvlMax: 50, sx: 3, sy: 3, isDungeon: true, premium: true },
};

// Связи (двусторонние) — где есть джапгейт между секторами.
export const EDGES = [
  // Helios — цепочка
  ['helios_1', 'helios_2'], ['helios_2', 'helios_3'], ['helios_3', 'helios_4'], ['helios_4', 'helios_5'],
  // Helios — данжи
  ['helios_1', 'dungeon_1'], ['helios_2', 'dungeon_2'], ['helios_3', 'dungeon_3'],
  ['helios_4', 'dungeon_4'], ['helios_5', 'dungeon_5'],
  // Helios → PvP (со второго сектора)
  ['helios_2', 'pvp_1'], ['helios_3', 'pvp_2'], ['helios_4', 'pvp_3'], ['helios_5', 'pvp_4'],

  // Karax — цепочка
  ['karax_1', 'karax_2'], ['karax_2', 'karax_3'], ['karax_3', 'karax_4'], ['karax_4', 'karax_5'],
  // Karax → PvP (со второго сектора)
  ['karax_2', 'pvp_1'], ['karax_3', 'pvp_2'], ['karax_4', 'pvp_3'], ['karax_5', 'pvp_4'],

  // Tides — цепочка
  ['tides_1', 'tides_2'], ['tides_2', 'tides_3'], ['tides_3', 'tides_4'], ['tides_4', 'tides_5'],
  // Tides → PvP (со второго сектора)
  ['tides_2', 'pvp_1'], ['tides_3', 'pvp_2'], ['tides_4', 'pvp_3'], ['tides_5', 'pvp_4'],

  // PvP — внутренняя цепочка
  ['pvp_4', 'pvp_5'], ['pvp_5', 'R-1-boss'],

  // Лабиринт Тьмы — выход через helios_4 (единственный физический джампгейт)
  ['helios_4', 'tides_d4'],
];

// Текущий сектор (мутабельно; переживает scene.restart при прыжке).
export const galaxy = { current: 'helios_1' };

// Соседи сектора (куда есть джапгейт).
export function neighbors(key) {
  const out = [];
  for (const [a, b] of EDGES) {
    if (a === key) out.push(b);
    else if (b === key) out.push(a);
  }
  return out;
}

// Направление на схеме from→to (для размещения портала на соответствующем крае карты).
export function edgeDir(fromKey, toKey) {
  const f = SECTORS[fromKey], t = SECTORS[toKey];
  return { dx: Math.sign(t.sx - f.sx), dy: Math.sign(t.sy - f.sy) };
}

// Доступ по уровню пилота. PvP закрыт выше lvlMax+5. Данжи закрыты выше lvlMax+10. Premium — только с подпиской.
export function sectorAccess(key, pilotLevel, activeShip = 'wisp', premium = false) {
  const s = SECTORS[key];

  if (activeShip === 'argus') {
    if (s.isDungeon) return { ok: false, reason: 'Argus forbidden in Dungeons' };
    return { ok: true };
  }

  if (s.premium && !premium)                    return { ok: false, reason: 'нужен Premium' };
  if (pilotLevel < s.lvlMin)                    return { ok: false, reason: `нужен ур. ${s.lvlMin}` };
  if (s.pvp     && pilotLevel > s.lvlMax + 5)  return { ok: false, reason: `только до ур. ${s.lvlMax + 5}` };
  if (s.isDungeon && pilotLevel > s.lvlMax) return { ok: false, reason: `только до ур. ${s.lvlMax}` };
  return { ok: true };
}
