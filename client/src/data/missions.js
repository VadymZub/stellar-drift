// Mission definitions — pure data, no runtime state.
// Runtime state lives in GameScene.missionState[id] = { status, objectives:[{current}], acceptedAt? }
//
// Objective.type drives a generic event dispatcher in GameScene (advanceMissionsByEvent) instead of
// per-mission-id hardcoding: 'kill' | 'collect_loot' | 'collect_resource' | 'clan_resource' |
// 'reach_sector' | 'time_trial' | 'escort' | 'deliver_resource' | 'report' | 'narrative_choice' |
// 'pvp_kill' | 'base_kill' | 'base_control' | 'visit_arena' | 'arena_win' (last two: stubs, arenas
// not implemented yet — see `comingSoon` flag).

// Returns Set of sector keys that are active mission targets for the given corp.
export function getActiveMissionSectorTargets(missionState, playerCorp = 'helios') {
  const targets = new Set();
  if (!missionState) return targets;
  for (const m of MISSIONS) {
    const st = missionState[m.id];
    if (!st || st.status !== 'active') continue;
    // Corp-specific target takes priority over static target
    const target = m.sectorTargetByCorp?.[playerCorp]
      ?? m.sectorTargetByCorp?.['neutral']
      ?? m.sectorTarget;
    if (!target) continue;
    const { key, objIdx } = target;
    const objState = st.objectives[objIdx];
    if (objState && objState.current < m.objectives[objIdx].total) targets.add(key);
  }
  return targets;
}

// Returns the mission's resolved sector target key for a given corp (or null).
export function getMissionSectorTarget(mission, playerCorp = 'helios') {
  const t = mission.sectorTargetByCorp?.[playerCorp]
    ?? mission.sectorTargetByCorp?.['neutral']
    ?? mission.sectorTarget;
  return t ?? null;
}

// Resolves a mission's per-corp NPC portrait/name (falls back to the flat npc/npcName fields).
export function getMissionNpc(mission, playerCorp = 'helios') {
  const npc     = mission.npcByCorp?.[playerCorp]     ?? mission.npcByCorp?.['neutral']     ?? mission.npc;
  const npcName = mission.npcNameByCorp?.[playerCorp] ?? mission.npcNameByCorp?.['neutral'] ?? mission.npcName;
  return { npc, npcName };
}

// Daily missions are grouped into 5 level brackets matching the sector tiers (1-10 .. 40-50).
export function dailyBracketFor(pilotLevel) {
  return Math.min(5, Math.floor(Math.max(0, (pilotLevel ?? 1) - 1) / 10) + 1);
}

// A mandatory story mission whose completion gates entry into `sectorKey` for `playerCorp` (or null).
export function getSectorGateMission(sectorKey, playerCorp = 'helios') {
  for (const m of MISSIONS) {
    if (!m.mandatory || !m.gatesSectorByCorp) continue;
    const target = m.gatesSectorByCorp[playerCorp] ?? m.gatesSectorByCorp.neutral;
    if (target === sectorKey) return m;
  }
  return null;
}

// Does a killed mob satisfy a 'kill' objective (faction list + optional elite/boss tag)?
export function matchKillObjective(mob, obj) {
  if (obj.type !== 'kill') return false;
  // Require at least one constraint — unconstrained 'kill' objectives (e.g. a specific named
  // dungeon boss) are advanced by an explicit call at their own trigger site, not this dispatcher.
  if (!obj.faction && !obj.tag) return false;
  const tpl = mob.tpl ?? mob;
  if (obj.tag === 'elite' && !tpl.elite) return false;
  if (obj.tag === 'boss'  && !tpl.boss)  return false;
  if (obj.faction) {
    const factions = Array.isArray(obj.faction) ? obj.faction : [obj.faction];
    if (!factions.includes(tpl.faction)) return false;
  }
  return true;
}

const CORP_CURATOR = {
  helios: { npc: 'npc_corvus', npcName: 'Бригадир Корвус' },
  karax:  { npc: 'npc_hazard', npcName: 'Хазард' },
  tides:  { npc: 'npc_siren',  npcName: 'Сирена' },
};
const CORP_MENTOR = {
  helios: { npc: 'npc_artemis',  npcName: 'Командор Артемис' },
  karax:  { npc: 'npc_terranov', npcName: 'Магнат Терранов' },
  tides:  { npc: 'npc_erixon',   npcName: 'Доктор Эриксон' },
};
function byCorp(map, key) {
  const out = { neutral: map.helios[key] };
  for (const corp of ['helios', 'karax', 'tides']) out[corp] = map[corp][key];
  return out;
}
const CURATOR_NPC      = byCorp(CORP_CURATOR, 'npc');
const CURATOR_NAME     = byCorp(CORP_CURATOR, 'npcName');
const MENTOR_NPC       = byCorp(CORP_MENTOR, 'npc');
const MENTOR_NAME      = byCorp(CORP_MENTOR, 'npcName');

// ── Daily mission brackets ──────────────────────────────────────────────────
// A) Patrol (kill by faction) · B) Salvage (loot) · C) Resource run (plasmate) · D) special slot
const PATROL_FACTION = {
  1: ['corsair'],
  2: ['corsair', 'syndicate'],
  3: ['syndicate'],
  4: ['confed', 'syndicate'],
  5: ['ancient', 'syndicate'],
};
const PATROL_LABEL = {
  1: 'Корсаров', 2: 'Корсаров/Синдикат', 3: 'Синдикат', 4: 'Конфед/Синдикат', 5: 'Древних/Синдикат',
};

function dailyPatrol(bracket, count, rewards) {
  return {
    id: `daily_patrol_t${bracket}`, type: 'daily', bracket, title: 'Патрульный обход',
    npcByCorp: CURATOR_NPC, npcNameByCorp: CURATOR_NAME,
    npc: CURATOR_NPC.helios, npcName: CURATOR_NAME.helios,
    desc: `Сектор снова неспокоен. Уничтожьте вражеские корабли (${PATROL_LABEL[bracket]}), прежде чем они доберутся до базы.`,
    objectives: [{ type: 'kill', faction: PATROL_FACTION[bracket], total: count, text: `Уничтожить: ${PATROL_LABEL[bracket]} ×${count}` }],
    rewards, defaultStatus: 'available', minLevel: (bracket - 1) * 10 + 1,
  };
}
function dailySalvage(bracket, count, rewards) {
  return {
    id: `daily_salvage_t${bracket}`, type: 'daily', bracket, title: 'Сбор обломков',
    npc: 'npc_jakob', npcName: 'Старый Якоб',
    desc: 'Недавний бой оставил много интересного. Мне нужны компоненты — не жалей топлива.',
    objectives: [{ type: 'collect_loot', total: count, text: `Подобрать контейнеры с лутом ×${count}` }],
    rewards, defaultStatus: 'available', minLevel: (bracket - 1) * 10 + 1,
  };
}
function dailyResource(bracket, amount, rewards) {
  return {
    id: `daily_resource_t${bracket}`, type: 'daily', bracket, title: 'Плазмитовая жила',
    npc: 'npc_jakob', npcName: 'Старый Якоб',
    desc: `Плазмит нужен всем — и нам тоже. Собери ${amount} единиц и возвращайся.`,
    objectives: [{ type: 'collect_resource', resource: 'plasmate', total: amount, text: `Собрать плазмит ×${amount}` }],
    rewards, defaultStatus: 'available', minLevel: (bracket - 1) * 10 + 1,
  };
}

// Недельный контракт — разблокируется после 5 (из 7) "идеальных" дней (все дейлики
// бракета выполнены), см. GameScene.initMissionState/_checkDailySetBonus.
function weeklyMission(bracket, killCount, salvageCount, resourceAmt, rewards) {
  return {
    id: `weekly_contract_t${bracket}`, type: 'weekly', bracket, title: 'Недельный контракт',
    npcByCorp: CURATOR_NPC, npcNameByCorp: CURATOR_NAME,
    npc: CURATOR_NPC.helios, npcName: CURATOR_NAME.helios,
    desc: 'Крупный заказ для тех, кто не филонит всю неделю. Три задачи — и щедрая оплата.',
    objectives: [
      { type: 'kill', faction: PATROL_FACTION[bracket], total: killCount, text: `Уничтожить: ${PATROL_LABEL[bracket]} ×${killCount}` },
      { type: 'collect_loot', total: salvageCount, text: `Подобрать контейнеры с лутом ×${salvageCount}` },
      { type: 'collect_resource', resource: 'plasmate', total: resourceAmt, text: `Собрать плазмит ×${resourceAmt}` },
      { type: 'report', total: 1, text: 'Доложить куратору' },
    ],
    rewards, defaultStatus: 'available', minLevel: (bracket - 1) * 10 + 1,
  };
}

const PVP_SECTORS = {
  1: { key: 'pvp_1', name: 'Граница X-12' },
  2: { key: 'pvp_2', name: 'Граница X-44' },
  3: { key: 'pvp_3', name: 'Алгол' },
  4: { key: 'pvp_4', name: 'Нейтральная Зона' },
  5: { key: 'pvp_5', name: 'Сердце Бездны' },
};
function basePvpMission(tier, minLevel, killCount, controlCount, rewards) {
  const sec = PVP_SECTORS[tier];
  return {
    id: `story_base_pvp${tier}`, type: 'story', mandatory: false, title: `Контроль территории: ${sec.name}`,
    npc: 'npc_orion', npcName: 'Капитан Орион',
    desc: `Базы в ${sec.name} — источник золота и влияния. Ослабь вражеские, укрепи свои.`,
    objectives: [
      { type: 'reach_sector', total: 1, text: `Прибыть в ${sec.name}` },
      { type: 'base_kill', sector: sec.key, total: killCount, text: `Уничтожить вражеские майнинг-базы ×${killCount}` },
      { type: 'base_control', sector: sec.key, total: controlCount, text: `Получить выплату за владение базой ×${controlCount}` },
    ],
    rewards, defaultStatus: 'available', minLevel,
    sectorTarget: { key: sec.key, objIdx: 0 },
  };
}

export const MISSIONS = [
  // ── T1 (1-10) ──────────────────────────────────────────────────────────
  dailyPatrol(1, 5,  { xp: 500,  credits: 1200, stars: 0 }),
  dailySalvage(1, 10, { xp: 350,  credits: 900,  stars: 0 }),
  dailyResource(1, 150, { xp: 300, credits: 700, stars: 0 }),
  {
    id: 'daily_escort', type: 'daily', bracket: 1, title: 'Сопровождение груза',
    npc: 'npc_morgan', npcName: 'Капитан Морган',
    descByCorp: {
      helios:  'Мой транспорт полон редких руд. Нужен эскорт на Орбитальную Верфь. Заплачу щедро.',
      karax:   'Мой транспорт полон редких руд. Нужен эскорт в Магма-Прайм. Заплачу щедро.',
      tides:   'Мой транспорт полон редких руд. Нужен эскорт в Туманность Омут. Заплачу щедро.',
      neutral: 'Мой транспорт полон редких руд. Нужен эскорт в соседний сектор. Заплачу щедро.',
    },
    desc: 'Мой транспорт полон редких руд. Нужен эскорт в соседний сектор. Заплачу щедро.',
    objectives: [
      {
        type: 'reach_sector', total: 1,
        text: 'Прибыть в соседний сектор',
        textByCorp: {
          helios:  'Прибыть на Орбитальную Верфь (Helios-2)',
          karax:   'Прибыть в Магма-Прайм (Karax-2)',
          tides:   'Прибыть в Туманность Омут (Tides-2)',
          neutral: 'Прибыть в Орбитальную Верфь (Helios-2)',
        },
      },
      { type: 'escort', total: 1, text: 'Транспорт доставлен' },
    ],
    rewards: { xp: 600, credits: 1800, stars: 2 },
    defaultStatus: 'available', minLevel: 10,
    sectorTargetByCorp: {
      helios: { key: 'helios_2', objIdx: 0 }, karax: { key: 'karax_2', objIdx: 0 },
      tides:  { key: 'tides_2',  objIdx: 0 }, neutral: { key: 'helios_2', objIdx: 0 },
    },
  },

  // ── T2 (10-20) ─────────────────────────────────────────────────────────
  dailyPatrol(2, 8,  { xp: 1000, credits: 2400, stars: 0 }),
  dailySalvage(2, 14, { xp: 700,  credits: 1800, stars: 0 }),
  dailyResource(2, 250, { xp: 600, credits: 1400, stars: 1 }),
  {
    id: 'daily_bounty_t2', type: 'daily', bracket: 2, title: 'Охота за головами',
    npcByCorp: CURATOR_NPC, npcNameByCorp: CURATOR_NAME,
    npc: CURATOR_NPC.helios, npcName: CURATOR_NAME.helios,
    desc: 'Замечен элитный корабль в патрульных сводках. Убери его — за это хорошо платят.',
    objectives: [{ type: 'kill', faction: PATROL_FACTION[2], tag: 'elite', total: 1, text: 'Уничтожить элитный корабль' }],
    rewards: { xp: 1200, credits: 3600, stars: 3 },
    defaultStatus: 'available', minLevel: 11,
  },

  // ── T3 (20-30) ─────────────────────────────────────────────────────────
  dailyPatrol(3, 10, { xp: 1750, credits: 4200, stars: 2 }),
  dailySalvage(3, 18, { xp: 1225, credits: 3150, stars: 1 }),
  dailyResource(3, 350, { xp: 1050, credits: 2450, stars: 2 }),
  {
    id: 'daily_timetrial_t3', type: 'daily', bracket: 3, title: 'На всех парах',
    npcByCorp: CURATOR_NPC, npcNameByCorp: CURATOR_NAME,
    npc: CURATOR_NPC.helios, npcName: CURATOR_NAME.helios,
    descByCorp: {
      helios:  'Груз горит — нужно долететь до Звёздной Гавани Атрус за 6 минут. Форсаж не жалей.',
      karax:   'Груз горит — нужно долететь до Форж-Нексуса за 6 минут. Форсаж не жалей.',
      tides:   'Груз горит — нужно долететь до Туманного Архива за 6 минут. Форсаж не жалей.',
      neutral: 'Груз горит — нужно долететь до следующего сектора за 6 минут. Форсаж не жалей.',
    },
    desc: 'Груз горит — нужно долететь до следующего сектора за 6 минут. Форсаж не жалей.',
    objectives: [{ type: 'time_trial', total: 1, limitSec: 360, text: 'Прибыть в сектор-3 за 6 мин.' }],
    rewards: { xp: 2100, credits: 6300, stars: 5 },
    defaultStatus: 'available', minLevel: 21,
    sectorTargetByCorp: {
      helios: { key: 'helios_3', objIdx: 0 }, karax: { key: 'karax_3', objIdx: 0 },
      tides:  { key: 'tides_3',  objIdx: 0 }, neutral: { key: 'helios_3', objIdx: 0 },
    },
  },

  // ── T4 (30-40) ─────────────────────────────────────────────────────────
  dailyPatrol(4, 12, { xp: 2750, credits: 6600, stars: 4 }),
  dailySalvage(4, 22, { xp: 1925, credits: 4950, stars: 2 }),
  dailyResource(4, 450, { xp: 1650, credits: 3850, stars: 3 }),
  {
    id: 'daily_clanres_t4', type: 'daily', bracket: 4, title: 'Ресурсы для казны',
    npcByCorp: CURATOR_NPC, npcNameByCorp: CURATOR_NAME,
    npc: CURATOR_NPC.helios, npcName: CURATOR_NAME.helios,
    desc: 'Казна гильдии не наполнит себя сама. Сдай редкие материалы с боссов данжей.',
    objectives: [
      { type: 'clan_resource', resource: 'biomech_core',    total: 2, text: 'Сдать Органит-ядро ×2' },
      { type: 'clan_resource', resource: 'quantum_crystal', total: 2, text: 'Сдать Фазолит-кристалл ×2' },
      { type: 'clan_resource', resource: 'plasma_coil',     total: 2, text: 'Сдать Каленит-катушка ×2' },
    ],
    rewards: { xp: 3300, credits: 9900, stars: 8 },
    defaultStatus: 'available', minLevel: 31,
  },

  // ── T5 (40-50) ─────────────────────────────────────────────────────────
  dailyPatrol(5, 14, { xp: 4000, credits: 9600, stars: 6 }),
  dailySalvage(5, 26, { xp: 2800, credits: 7200, stars: 3 }),
  dailyResource(5, 600, { xp: 2400, credits: 5600, stars: 5 }),
  {
    id: 'daily_bossbounty_t5', type: 'daily', bracket: 5, title: 'Крупная дичь',
    npcByCorp: CURATOR_NPC, npcNameByCorp: CURATOR_NAME,
    npc: CURATOR_NPC.helios, npcName: CURATOR_NAME.helios,
    desc: 'Именной корабль замечен в секторе. Уничтожь его прежде, чем он наберёт силу.',
    objectives: [{ type: 'kill', faction: PATROL_FACTION[5], tag: 'boss', total: 1, text: 'Уничтожить именного босса' }],
    rewards: { xp: 4800, credits: 14400, stars: 12 },
    defaultStatus: 'available', minLevel: 41,
  },

  // ── Недельные контракты — по одному на бракет, разблокируются после 5/7 идеальных дней ──
  weeklyMission(1, 15, 30, 450,  { xp: 5000,  credits: 14000,  stars: 6 }),
  weeklyMission(2, 24, 42, 750,  { xp: 10500, credits: 27500,  stars: 12 }),
  weeklyMission(3, 30, 54, 1050, { xp: 18000, credits: 48000,  stars: 30 }),
  weeklyMission(4, 36, 66, 1350, { xp: 29000, credits: 76000,  stars: 50 }),
  weeklyMission(5, 42, 78, 1800, { xp: 42000, credits: 110000, stars: 78 }),

  // ── Обязательные сюжетные "экзамены" — гейтят переход между секторами корпорации ──
  {
    id: 'story_grad_1', type: 'story', mandatory: true, title: 'Экзамен Форпоста',
    npcByCorp: CURATOR_NPC, npcNameByCorp: CURATOR_NAME,
    npc: CURATOR_NPC.helios, npcName: CURATOR_NAME.helios,
    desc: 'Прежде чем открыть тебе дорогу дальше, докажи, что готов. Уничтожь элитный корабль стража и доложи мне на базе.',
    objectives: [
      { type: 'kill', tag: 'elite', total: 1, text: 'Уничтожить элитный корабль стража' },
      { type: 'report', total: 1, text: 'Доложить куратору на базе' },
    ],
    rewards: { xp: 800, credits: 2000, stars: 3 },
    defaultStatus: 'available', minLevel: 10,
    gatesSectorByCorp: { helios: 'helios_2', karax: 'karax_2', tides: 'tides_2', neutral: 'helios_2' },
  },
  {
    id: 'story_grad_2', type: 'story', mandatory: true, title: 'Испытание Тира-2',
    npcByCorp: MENTOR_NPC, npcNameByCorp: MENTOR_NAME,
    npc: MENTOR_NPC.helios, npcName: MENTOR_NAME.helios,
    descByCorp: {
      helios:  'Гелиос-Прайм пройден. Отправляйся на Орбитальную Верфь и покажи, на что способен.',
      karax:   'Литейные Заводы пройдены. Отправляйся в Магма-Прайм и покажи, на что способен.',
      tides:   'Лазурные Рифы пройдены. Отправляйся в Туманность Омут и покажи, на что способен.',
      neutral: 'Первый сектор пройден. Отправляйся дальше и покажи, на что способен.',
    },
    desc: 'Первый сектор пройден. Отправляйся дальше и покажи, на что способен.',
    objectives: [
      { type: 'reach_sector', total: 1, text: 'Прибыть в сектор-2' },
      { type: 'kill', tag: 'boss', total: 1, text: 'Уничтожить мини-босса сектора' },
      { type: 'report', total: 1, text: 'Доложить куратору' },
    ],
    rewards: { xp: 1500, credits: 4000, stars: 6 },
    defaultStatus: 'available', minLevel: 20,
    sectorTargetByCorp: {
      helios: { key: 'helios_2', objIdx: 0 }, karax: { key: 'karax_2', objIdx: 0 }, tides: { key: 'tides_2', objIdx: 0 },
    },
    gatesSectorByCorp: { helios: 'helios_3', karax: 'karax_3', tides: 'tides_3', neutral: 'helios_3' },
  },
  {
    id: 'story_grad_3', type: 'story', mandatory: true, title: 'Испытание Тира-3',
    npcByCorp: MENTOR_NPC, npcNameByCorp: MENTOR_NAME,
    npc: MENTOR_NPC.helios, npcName: MENTOR_NAME.helios,
    desc: 'Ты добрался дальше многих. Но впереди — настоящая проверка стойкости.',
    objectives: [
      { type: 'reach_sector', total: 1, text: 'Прибыть в сектор-3' },
      { type: 'kill', tag: 'boss', total: 1, text: 'Уничтожить роуминг-босса сектора' },
      { type: 'report', total: 1, text: 'Доложить куратору' },
    ],
    rewards: { xp: 3000, credits: 8000, stars: 12 },
    defaultStatus: 'available', minLevel: 30,
    sectorTargetByCorp: {
      helios: { key: 'helios_3', objIdx: 0 }, karax: { key: 'karax_3', objIdx: 0 }, tides: { key: 'tides_3', objIdx: 0 },
    },
    gatesSectorByCorp: { helios: 'helios_4', karax: 'karax_4', tides: 'tides_4', neutral: 'helios_4' },
  },
  {
    id: 'story_grad_4', type: 'story', mandatory: true, title: 'Ветеран Корпорации',
    npcByCorp: MENTOR_NPC, npcNameByCorp: MENTOR_NAME,
    npc: MENTOR_NPC.helios, npcName: MENTOR_NAME.helios,
    desc: 'Последний рубеж перед элитой корпорации. Возьми статичного стража сектора — и заслужишь место среди лучших.',
    objectives: [
      { type: 'reach_sector', total: 1, text: 'Прибыть в сектор-4' },
      { type: 'kill', tag: 'boss', total: 1, text: 'Уничтожить статик-босса сектора' },
      { type: 'report', total: 1, text: 'Доложить куратору' },
    ],
    rewards: { xp: 6000, credits: 16000, stars: 25 },
    defaultStatus: 'available', minLevel: 40,
    sectorTargetByCorp: {
      helios: { key: 'helios_4', objIdx: 0 }, karax: { key: 'karax_4', objIdx: 0 }, tides: { key: 'tides_4', objIdx: 0 },
    },
    gatesSectorByCorp: { helios: 'helios_5', karax: 'karax_5', tides: 'tides_5', neutral: 'helios_5' },
  },

  // ── Необязательные сюжетные линии — крупный разовый лор, не блокируют прогресс ──
  {
    id: 'story_pvp_ascension', type: 'story', mandatory: false, title: 'Восхождение элиты',
    npc: 'npc_orion', npcName: 'Капитан Орион',
    desc: 'Престижные корпуса не выдают за красивые глаза. Заяви о себе в Сердце Бездны — и заслужишь метку элиты корпорации.',
    objectives: [
      { type: 'reach_sector', total: 1, text: 'Прибыть в Сердце Бездны (PvP-5)' },
      { type: 'pvp_kill', total: 25, text: 'Одержать победу над соперниками ×25' },
      { type: 'report', total: 1, text: 'Доложить куратору на базе' },
    ],
    rewards: { xp: 8000, credits: 20000, stars: 40, unlockFlag: 'corp_elite_paint' },
    defaultStatus: 'available', minLevel: 45,
    sectorTarget: { key: 'pvp_5', objIdx: 0 },
  },

  // Территориальные миссии — по одной на каждый PvP-тир (не обязательные, повторно
  // не сбрасываются как дейлики — разовая награда за уничтожение/удержание баз).
  basePvpMission(1, 11, 2, 1, { xp: 1500, credits: 4000,  stars: 5 }),
  basePvpMission(2, 21, 3, 2, { xp: 2500, credits: 7000,  stars: 8 }),
  basePvpMission(3, 31, 3, 2, { xp: 4000, credits: 11000, stars: 12 }),
  basePvpMission(4, 41, 4, 3, { xp: 6000, credits: 16000, stars: 18 }),
  basePvpMission(5, 45, 5, 3, { xp: 9000, credits: 24000, stars: 28 }),

  // Заглушки: арены 1×1 и 3×3 ещё не реализованы (нет самого режима арены) — миссии
  // определены заранее для дизайна наград/потока, но comingSoon держит их залоченными
  // независимо от уровня (см. initMissionState/MissionsScene).
  {
    id: 'story_arena_1v1', type: 'story', mandatory: false, comingSoon: true, title: 'Дуэль чести',
    npc: 'npc_orion', npcName: 'Капитан Орион',
    desc: 'Арена 1×1 скоро откроется — покажи, кто сильнее один на один. (Режим ещё не реализован.)',
    objectives: [
      { type: 'visit_arena', total: 1, text: 'Посетить Арену 1×1 (скоро)' },
      { type: 'arena_win', total: 3, text: 'Победить в Арене 1×1 ×3 (скоро)' },
    ],
    rewards: { xp: 3000, credits: 8000, stars: 10 },
    defaultStatus: 'locked', minLevel: 20,
  },
  {
    id: 'story_arena_3v3', type: 'story', mandatory: false, comingSoon: true, title: 'Слаженный удар',
    npc: 'npc_orion', npcName: 'Капитан Орион',
    desc: 'Арена 3×3 скоро откроется — командный бой на выбывание. (Режим ещё не реализован.)',
    objectives: [
      { type: 'visit_arena', total: 1, text: 'Посетить Арену 3×3 (скоро)' },
      { type: 'arena_win', total: 3, text: 'Победить в Арене 3×3 ×3 (скоро)' },
    ],
    rewards: { xp: 4000, credits: 10000, stars: 12 },
    defaultStatus: 'locked', minLevel: 25,
  },

  {
    id: 'story_signal', type: 'story', mandatory: false, title: 'Эхо Древних',
    npc: 'npc_ancient', npcName: 'Голос Древних',
    desc: 'Из глубины Алгол: Зов Апофиса поступает аномальный сигнал. Источник неизвестен. Приказываю разведать и уничтожить угрозу.',
    objectives: [
      { type: 'reach_sector', total: 1, text: 'Достичь Алгол: Зов Апофиса' },
      { type: 'kill', total: 1, text: 'Уничтожить Стража данжа — источник сигнала' },
    ],
    rewards: { xp: 2500, credits: 5000, stars: 15 },
    defaultStatus: 'available', minLevel: 45,
    sectorTarget: { key: 'R-1-boss', objIdx: 0 },
  },
  {
    id: 'story_supply', type: 'story', mandatory: false, title: 'Цена союза',
    npcByCorp: MENTOR_NPC, npcNameByCorp: MENTOR_NAME,
    npc: MENTOR_NPC.helios, npcName: MENTOR_NAME.helios,
    descByCorp: {
      helios:  'Корпорация Helios нуждается в ресурсах для проекта «Ковчег». Вы — лучший вариант для деликатной работы.',
      karax:   'Литейным Заводам Karax нужен плазмит для проекта «Ковчег». Ты — лучший вариант для деликатной работы.',
      tides:   'Архивам Tides нужен плазмит для проекта «Ковчег». Вы — лучший вариант для деликатной работы.',
      neutral: 'Проекту «Ковчег» нужны ресурсы. Вы — лучший вариант для деликатной работы.',
    },
    desc: 'Проекту «Ковчег» нужны ресурсы. Вы — лучший вариант для деликатной работы.',
    objectives: [
      { type: 'collect_resource', resource: 'plasmate', total: 500, text: 'Собрать 500 единиц плазмита' },
      { type: 'deliver_resource', resource: 'plasmate', total: 500, text: 'Доставить на Станцию «Ковчег»' },
    ],
    rewards: { xp: 4000, credits: 12000, stars: 30 },
    defaultStatus: 'active', minLevel: 1,
  },
  {
    id: 'story_broker', type: 'story', mandatory: false, title: 'Брокер теней',
    npc: 'npc_lynx', npcName: 'Брокер Линкс',
    desc: 'У меня на примете курьер Синдиката с интересным грузом. Перехвати его — а дальше решай сам, что делать с добычей.',
    objectives: [
      { type: 'kill', faction: ['syndicate'], total: 1, text: 'Перехватить курьера Синдиката' },
      {
        type: 'narrative_choice', total: 1, text: 'Решить судьбу груза',
        options: [
          { id: 'turn_in', label: 'Сдать патрулю',   rewardBonus: { credits: 0,    stars: 0, honor: 50 } },
          { id: 'sell',    label: 'Продать Линксу',  rewardBonus: { credits: 3500, stars: 6, honor: 0 } },
        ],
      },
    ],
    rewards: { xp: 1800, credits: 3000, stars: 4 },
    defaultStatus: 'available', minLevel: 20,
  },
];
