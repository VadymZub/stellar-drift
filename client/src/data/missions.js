// Mission definitions — pure data, no runtime state.
// Runtime state lives in GameScene.missionState[id] = { status, objectives:[{current}] }

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

export const MISSIONS = [
  {
    id: 'daily_patrol',
    type: 'daily',
    title: 'Патрульный обход',
    npc: 'npc_corvus',
    npcName: 'Бригадир Корвус',
    desc: 'Сектор снова неспокоен. Уничтожьте пиратские корабли Корсаров, прежде чем они доберутся до базы.',
    objectives: [{ text: 'Уничтожить Корсаров', total: 5 }],
    rewards: { xp: 500, credits: 1200, stars: 0 },
    defaultStatus: 'available',
    minLevel: 1,
  },
  {
    id: 'daily_salvage',
    type: 'daily',
    title: 'Сбор обломков',
    npc: 'npc_jakob',
    npcName: 'Старый Якоб',
    desc: 'Недавний бой оставил много интересного. Мне нужны компоненты — не жалей топлива.',
    objectives: [{ text: 'Подобрать контейнеры с лутом', total: 10 }],
    rewards: { xp: 350, credits: 900, stars: 0 },
    defaultStatus: 'available',
    minLevel: 1,
  },
  {
    id: 'daily_escort',
    type: 'daily',
    title: 'Сопровождение груза',
    npc: 'npc_morgan',
    npcName: 'Капитан Морган',
    // corp-specific description
    descByCorp: {
      helios:  'Мой транспорт полон редких руд. Нужен эскорт на Орбитальную Верфь. Заплачу щедро.',
      karax:   'Мой транспорт полон редких руд. Нужен эскорт в Магма-Прайм. Заплачу щедро.',
      tides:   'Мой транспорт полон редких руд. Нужен эскорт в Туманность Омут. Заплачу щедро.',
      neutral: 'Мой транспорт полон редких руд. Нужен эскорт в соседний сектор. Заплачу щедро.',
    },
    desc: 'Мой транспорт полон редких руд. Нужен эскорт в соседний сектор. Заплачу щедро.',
    objectives: [
      {
        text: 'Прибыть в соседний сектор',
        total: 1,
        textByCorp: {
          helios:  'Прибыть на Орбитальную Верфь (Helios-2)',
          karax:   'Прибыть в Магма-Прайм (Karax-2)',
          tides:   'Прибыть в Туманность Омут (Tides-2)',
          neutral: 'Прибыть в Орбитальную Верфь (Helios-2)',
        },
      },
      { text: 'Транспорт доставлен', total: 1 },
    ],
    rewards: { xp: 600, credits: 1800, stars: 2 },
    defaultStatus: 'available',
    minLevel: 10,
    // Corp-specific sector targets (all are the 2nd sector of each corp, lvl 10-20)
    sectorTargetByCorp: {
      helios:  { key: 'helios_2', objIdx: 0 },
      karax:   { key: 'karax_2',  objIdx: 0 },
      tides:   { key: 'tides_2',  objIdx: 0 },
      neutral: { key: 'helios_2', objIdx: 0 },
    },
  },
  {
    id: 'story_signal',
    type: 'story',
    title: 'Эхо Древних',
    npc: 'npc_ancient',
    npcName: 'Голос Древних',
    desc: 'Из глубины Алгол: Зов Апофиса поступает аномальный сигнал. Источник неизвестен. Приказываю разведать.',
    objectives: [
      { text: 'Достичь Алгол: Зов Апофиса', total: 1 },
      { text: 'Уничтожить Стража данжа', total: 1 },
      { text: 'Маяк активирован', total: 1 },
    ],
    rewards: { xp: 2500, credits: 5000, stars: 15 },
    defaultStatus: 'available',
    minLevel: 45,
    sectorTarget: { key: 'R-1-boss', objIdx: 0 },
  },
  {
    id: 'story_supply',
    type: 'story',
    title: 'Цена союза',
    npc: 'npc_terranov',
    npcName: 'Магнат Терранов',
    desc: 'Корпорация Helios нуждается в ресурсах для проекта «Ковчег». Вы — лучший вариант для деликатной работы.',
    objectives: [
      { text: 'Собрать 500 единиц плазмита', total: 500 },
      { text: 'Доставить на Станцию «Ковчег»', total: 1 },
    ],
    rewards: { xp: 4000, credits: 12000, stars: 30 },
    defaultStatus: 'active',
    minLevel: 1,
  },
];
