import { modMult, itemName } from '../items.js';
import { perkBonus, PERK_MAP } from '../perks.js';
import { getBoardEffects } from '../boards.js';
import { shipLevelMods } from '../ships.js';

// Разбивка боевых статов по источникам для окна "Статы конфигурации" (GarageScene → StatsScene).
// Чисто READ-ONLY зеркало формул Player.recomputeStats() — не трогает реальный пайплайн
// (тот остаётся единственным источником истины для геймплея), считает те же цифры заново
// только для отображения. Небольшое дублирование формул сознательно — то же решение,
// что и roadmap_backlog.md п.1 ("не меняет саму формулу — только прозрачность для игрока").

function pctStr(x) {
  const v = Math.round(x * 1000) / 10;
  if (v === 0) return null;
  return (v > 0 ? '+' : '') + v + '%';
}

function perkText(item) {
  if (!item?.perk) return null;
  const pDef = PERK_MAP[item.perk.key];
  if (!pDef) return null;
  return `${pDef.name} — ${pDef.desc(perkBonus(item.perk), item.perk.roll ?? 1)}`;
}

// baseVal — исходное число предмета (item.damage/speed/durability/regen/hullBonus), ДО апгрейда.
// extraUpgFrac — доп. доля апгрейда сверх modMult (сейчас только perk_armor_plating на броне).
function itemRow(category, item, baseVal, extraUpgFrac = 0) {
  const k = modMult(item) - 1 + extraUpgFrac;
  return {
    category, name: itemName(item),
    base: Math.round(baseVal),
    upgradePct: pctStr(k),
    perk: perkText(item),
    rowTotal: Math.round(baseVal * (1 + k)),
  };
}

function itemRowPct(category, item, baseFrac) {
  const k = modMult(item) - 1;
  return {
    category, name: itemName(item),
    base: (baseFrac * 100).toFixed(1) + '%',
    upgradePct: pctStr(k),
    perk: perkText(item),
    rowTotal: (baseFrac * (1 + k) * 100).toFixed(1) + '%',
  };
}

function modRow(label, valueStr) {
  return valueStr ? { label, value: valueStr } : null;
}

function ctx(gs) {
  const p = gs.player;
  const ship = p.ship;
  const isAdmin = ship.tier === 'ADMIN';
  const m = shipLevelMods(isAdmin ? 1 : (p.shipLevel || 1));
  const W = (p.slots.weapon || []).slice(0, ship.wSlots).filter(Boolean);
  const S = (p.slots.shield || []).slice(0, ship.sSlots).filter(Boolean);
  const E = (p.slots.engine || []).slice(0, ship.eSlots || 0).filter(Boolean);
  const cannonW = W.filter(w => w.type !== 'laser');
  const laserW  = W.filter(w => w.type === 'laser');
  const shieldItems = S.filter(s => s.type !== 'armor');
  const armorItems  = S.filter(s => s.type === 'armor');
  const sl = k => ((gs.skillLevels || {})[k] || 0);
  const boardFx = getBoardEffects(gs.equippedBoard);
  const BF = k => (boardFx[k] || 0) / 100;
  const groupN = gs.groupSize || 0;
  const _ab = gs.activeBoosters || {};
  const _mb = gs._mapBoosters || {};
  return { p, ship, isAdmin, m, cannonW, laserW, shieldItems, armorItems, E, sl, BF, groupN, _ab, _mb };
}

function damageBlock(c, items, dmgKey, label, boardKey) {
  const { p, isAdmin, sl, BF, groupN, _ab, _mb } = c;
  if (!items.length && !(isAdmin && dmgKey === 'cannon')) return null;
  const itemRows = items.map(w => itemRow(dmgKey === 'cannon' ? 'Пушка' : 'Лазер', w, w.damage));
  if (isAdmin && items.length === 0 && dmgKey === 'cannon') {
    itemRows.push({ category: 'Пушка', name: 'ADMIN базовое орудие', base: 500, upgradePct: null, perk: null, rowTotal: 500 });
  }
  let perkPct = 0;
  for (const w of items) {
    if (!w.perk) continue;
    const pb = perkBonus(w.perk);
    if (w.perk.key === 'perk_steady_aim') perkPct += 0.10 * (1 + pb);
  }
  let packAuraPct = 0;
  for (const s of c.shieldItems.concat(c.armorItems)) {
    if (s.perk?.key === 'perk_pack_aura') packAuraPct += 0.05 * (1 + perkBonus(s.perk)) * groupN;
  }
  packAuraPct = Math.min(0.40, packAuraPct);
  const heavyCaliberPct = sl('heavy_caliber') * 0.06;
  const boostDmg = _ab.boost_damage > 0 ? 0.10 : 0;
  const mbDmg = _mb.dmg || 0;
  const allLasersBonus = (dmgKey === 'laser' && p.allLasers) ? 0.05 : 0;
  const modRows = [
    modRow('Улучшение корабля', pctStr(c.m.damage - 1)),
    modRow('Скилл: Тяжёлый калибр', pctStr(heavyCaliberPct)),
    modRow('Перк: Steady Aim (сумм.)', pctStr(perkPct)),
    modRow('Перк: Pack Aura (группа)', pctStr(packAuraPct)),
    modRow('Все слоты — лазеры', pctStr(allLasersBonus)),
    modRow('Плата', pctStr(BF(boardKey))),
    modRow('Бустер урона', pctStr(boostDmg + mbDmg)),
    modRow('Множитель корабля (ship.dmgMod)', pctStr(p.shipDmgMod - 1)),
  ].filter(Boolean);
  const passiveDmg = p.ship.passives?.damageBonus;
  if (passiveDmg) modRows.push({ label: 'Пассивка корабля', value: pctStr(passiveDmg) });
  const total = dmgKey === 'cannon' ? p.cannonDamage : p.laserDamage;
  return { title: label, itemRows, modRows, total, totalLabel: dmgKey === 'cannon' ? 'Урон пушек' : 'Урон лазеров' };
}

export function buildDamageBreakdown(gs) {
  const c = ctx(gs);
  return [damageBlock(c, c.cannonW, 'cannon', 'Пушки', 'cannonDmg'), damageBlock(c, c.laserW, 'laser', 'Лазеры', 'laserDmg')]
    .filter(Boolean);
}

export function buildShieldBreakdown(gs) {
  const c = ctx(gs);
  const { p, isAdmin, sl, BF, groupN, _ab, _mb, shieldItems } = c;
  const capRows = shieldItems.map(s => itemRow('Щит', s, s.durability));
  capRows.unshift({ category: 'Корпус', name: 'База корабля', base: p.shipShieldBase, upgradePct: null, perk: null, rowTotal: p.shipShieldBase });
  let coopShieldPct = 0;
  for (const s of shieldItems) if (s.perk?.key === 'perk_cooperative') coopShieldPct += 0.08 * (1 + perkBonus(s.perk)) * groupN;
  coopShieldPct = Math.min(0.60, coopShieldPct);
  const boostShield = _ab.boost_shield > 0 ? 0.20 : 0;
  const mbShield = _mb.shield || 0;
  const capModRows = [
    modRow('Улучшение корабля', pctStr(c.m.shield - 1)),
    modRow('Скилл: Shield Optimizer', pctStr(sl('shield_optimizer') * 0.05)),
    modRow('Перк: Cooperative (группа)', pctStr(coopShieldPct)),
    modRow('Плата', pctStr(BF('shieldMax'))),
    modRow('Бустер щита', pctStr(boostShield + mbShield)),
  ].filter(Boolean);
  if (p.ship.passives?.shieldBonus) capModRows.push({ label: 'Пассивка корабля', value: pctStr(p.ship.passives.shieldBonus) });
  if (p.ship.passives?.shieldPerAlly && groupN > 0) capModRows.push({ label: 'Пассивка корабля (за союзника)', value: pctStr(p.ship.passives.shieldPerAlly * groupN) });

  const regenRows = shieldItems.map(s => itemRow('Щит', s, s.regen));
  let regenPerkPct = 0;
  for (const s of shieldItems) if (s.perk?.key === 'perk_resonance') regenPerkPct += 0.12 * (1 + perkBonus(s.perk));
  const regenModRows = [
    !shieldItems.length ? { label: 'Реген без щитовых модулей', value: '3% от макс. щита' } : null,
    !shieldItems.length && sl('fast_regen') > 0 ? { label: 'Скилл: Fast Regen', value: `+${(sl('fast_regen') * 1.75).toFixed(1)}% от макс. щита` } : null,
    modRow('Перк: Resonance', pctStr(regenPerkPct)),
    modRow('Плата', pctStr(BF('shieldRegen'))),
  ].filter(Boolean);

  return [
    { title: 'Ёмкость щита', itemRows: capRows, modRows: capModRows, total: p.maxShield, totalLabel: 'Макс. щит' },
    { title: 'Реген щита', itemRows: shieldItems.length ? regenRows : [], modRows: regenModRows, total: Math.round(p.shieldRegenPerSec), totalLabel: 'Реген/сек' },
  ];
}

export function buildHullBreakdown(gs) {
  const c = ctx(gs);
  const { p, sl, BF, _ab, _mb, armorItems } = c;
  const itemRows = [{ category: 'Корпус', name: 'База корабля', base: p.ship.hullMax, upgradePct: null, perk: null, rowTotal: p.ship.hullMax }];
  for (const s of armorItems) {
    const platF = s.perk?.key === 'perk_armor_plating' ? 0.10 * (1 + perkBonus(s.perk)) : 0;
    itemRows.push(itemRow('Броня', s, s.hullBonus, platF));
  }
  const boostHull = _ab.boost_hull > 0 ? 0.20 : 0;
  const mbHull = _mb.hull || 0;
  const modRows = [
    modRow('Улучшение корабля', pctStr(c.m.hull - 1)),
    modRow('Скилл: Reinforced Hull', pctStr(sl('reinforced_hull') * 0.06)),
    modRow('Плата', pctStr(BF('hullMax'))),
    modRow('Бустер прочности', pctStr(boostHull + mbHull)),
  ].filter(Boolean);
  if (p.ship.passives?.hullRegen) modRows.push({ label: 'Пассивка корабля (реген/сек)', value: `+${p.ship.passives.hullRegen}` });
  if (gs.playerCorp === p.ship.corpAffinity && p.ship.corpAffinity === 'karax') modRows.push({ label: 'Престиж корпорации (Karax)', value: '+5%' });
  return [{ title: 'Прочность', itemRows, modRows, total: p.maxHull, totalLabel: 'Макс. прочность' }];
}

export function buildSpeedBreakdown(gs) {
  const c = ctx(gs);
  const { p, sl, BF, E } = c;
  const itemRows = [{ category: 'Корпус', name: 'База корабля', base: p.shipBaseSpeed, upgradePct: null, perk: null, rowTotal: p.shipBaseSpeed }];
  for (const e of E) itemRows.push(itemRow('Двигатель', e, e.speed || 0));
  let engineThrustPct = 0;
  for (const e of E) if (e.perk?.key === 'perk_engine_thrust') engineThrustPct += 0.10 * (1 + perkBonus(e.perk));
  const modRows = [
    modRow('Улучшение корабля', pctStr(c.m.speed - 1)),
    modRow('Перк: Engine Thrust', pctStr(engineThrustPct)),
    modRow('Плата', pctStr(BF('speed'))),
    modRow('Бустер/расходник скорости', pctStr((gs._speedBoostMult ?? 1) * (gs._stealthMult ?? 1) - 1)),
  ].filter(Boolean);
  if (p._arenaCarrier) modRows.push({ label: 'Арена: носитель груза/флага', value: '-25%' });
  if (gs.playerCorp === p.ship.corpAffinity && p.ship.corpAffinity === 'helios') modRows.push({ label: 'Престиж корпорации (Helios)', value: '+5%' });
  return [{ title: 'Скорость', itemRows, modRows, total: Math.round(p.baseSpeed), totalLabel: 'Скорость' }];
}

export function buildOtherBreakdown(gs) {
  const c = ctx(gs);
  const { p, sl, BF, cannonW, laserW, shieldItems, armorItems } = c;

  // Уклонение
  const evRows = shieldItems.map(s => itemRowPct('Щит', s, s.evasion));
  let evasionPerkAdd = 0;
  for (const s of shieldItems) if (s.perk?.key === 'perk_nimble') evasionPerkAdd += 0.06 * (1 + perkBonus(s.perk));
  const evModRows = [modRow('Перк: Nimble', pctStr(evasionPerkAdd)), modRow('Плата', pctStr(BF('evasion')))].filter(Boolean);
  if (p.ship.passives?.evasionBonus) evModRows.push({ label: 'Пассивка корабля', value: pctStr(p.ship.passives.evasionBonus) });
  const evasionBlock = { title: 'Уклонение (потолок 30%)', itemRows: evRows, modRows: evModRows, total: Math.round(p.evasion * 100) + '%', totalLabel: 'Уклонение' };

  // Пробитие
  const penRows = cannonW.map(w => itemRowPct('Пушка', w, w.penetration));
  let hullBreakerPen = 0, laserShredderPen = 0;
  for (const w of cannonW) if (w.perk?.key === 'perk_hull_breaker') hullBreakerPen += 0.05 * (1 + perkBonus(w.perk));
  for (const w of laserW) if (w.perk?.key === 'perk_laser_shredder') laserShredderPen += 0.05 * (1 + perkBonus(w.perk));
  const penModRows = [
    modRow('Скилл: Penetrating Rounds', pctStr(sl('penetrating_rounds') * 0.05)),
    modRow('Перк: Hull Breaker (потолок 15%)', pctStr(Math.min(0.15, hullBreakerPen))),
    modRow('Перк: Laser Shredder (потолок 15%)', pctStr(Math.min(0.15, laserShredderPen))),
    modRow('Плата', pctStr(BF('piercing'))),
  ].filter(Boolean);
  const penBlock = { title: 'Пробитие (потолок 40%)', itemRows: penRows, modRows: penModRows, total: Math.round(p.weaponPenetration * 100) + '%', totalLabel: 'Пробитие' };

  // Крит
  let critPerkAdd = 0;
  for (const w of cannonW) if (w.perk?.key === 'perk_critical_edge') critPerkAdd = Math.max(critPerkAdd, 0.12 * (1 + perkBonus(w.perk)));
  const critModRows = [
    modRow('Перк: Critical Edge (лучшая пушка)', pctStr(critPerkAdd)),
    modRow('Скилл: Sharpshooter', pctStr(sl('sharpshooter') * 0.04)),
    modRow('Плата', pctStr(BF('critChance'))),
  ].filter(Boolean);
  const critBlock = { title: 'Шанс крита (потолок 45%)', itemRows: [], modRows: critModRows, total: Math.round(p.critChance * 100) + '%', totalLabel: 'Крит-шанс' };
  const critMultBlock = { title: 'Множитель крита', itemRows: [], modRows: [modRow('Плата', pctStr(p.critMult - 2.0))].filter(Boolean), total: '×' + p.critMult.toFixed(2), totalLabel: 'Крит-множитель (база ×2.0)' };

  // Сопротивление урону. Hardened: макс. 2 копии на корабль считаются (см.
  // Player.recomputeStats hardenedCount<2 и GarageScene.equip() — диалог "это уже
  // имба, запретить ставить более 2, снизить базу до максимума 10%").
  let piercingResPerkRed = 0, hardenedCount = 0;
  for (const s of shieldItems.concat(armorItems)) {
    if (!s.perk) continue;
    const pb = perkBonus(s.perk);
    if (s.perk.key === 'perk_hardened' && hardenedCount < 2) { piercingResPerkRed += 0.069 * (1 + pb); hardenedCount++; }
    if (s.perk.key === 'perk_bulwark' && shieldItems.length === 0) piercingResPerkRed += 0.20 * (1 + pb);
  }
  const resModRows = [
    modRow('Плата', pctStr(BF('piercingRes'))),
    modRow('Скилл: Damage Resist', pctStr(sl('damage_resist') * 0.05)),
    modRow('Перк: Hardened (макс. 2 шт./корабль) / Bulwark', pctStr(piercingResPerkRed)),
  ].filter(Boolean);
  const resBlock = { title: 'Сопротивление урону (потолок 90%)', itemRows: [], modRows: resModRows, total: Math.round((1 - p.damageResistMod) * 100) + '%', totalLabel: 'Снижение получаемого урона' };

  // Кулдаун способностей
  const cdModRows = [
    modRow('Плата', pctStr(BF('cooldown'))),
    modRow('Скилл: Module Specialist', pctStr(sl('module_specialist') * 0.10)),
  ].filter(Boolean);
  const cdBlock = { title: 'Кулдаун способностей (потолок -75%)', itemRows: [], modRows: cdModRows, total: Math.round((1 - p.activeCooldownMod) * 100) + '%', totalLabel: 'Снижение КД' };

  return [evasionBlock, penBlock, critBlock, critMultBlock, resBlock, cdBlock];
}

export function buildStatsBreakdown(gs) {
  return {
    damage: buildDamageBreakdown(gs),
    shield: buildShieldBreakdown(gs),
    hull: buildHullBreakdown(gs),
    speed: buildSpeedBreakdown(gs),
    other: buildOtherBreakdown(gs),
  };
}
