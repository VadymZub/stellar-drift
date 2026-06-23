import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { PLAYER, ART_ANGLE_OFFSET, HANDLING, BASE_SCAN_RADIUS, UI_RES } from '../constants.js';
import { getBoardEffects } from '../boards.js';
import { defaultLoadout, modMult } from '../items.js';
import { perkBonus } from '../perks.js';
import { SHIP_BY_KEY, shipLevelMods, SHIP_MAX_LEVEL } from '../ships.js';

// Цвет тинта иконки по rank.id. Иконка = форма тира, тинт = суб-ранг внутри тира.
// Каждый цвет выбран с максимальным визуальным контрастом к соседям по тиру.
export const RANK_TINTS = {
  // Tier 1 — звезда: белый / золото / глубокий оранжевый
  1: 0xFFFFFF,  // Гранд-Адмирал   — brilliant white
  2: 0xFFD700,  // Адмирал Флота   — gold
  3: 0xFF6D00,  // Вице-Адмирал    — deep orange

  // Tier 2 — ромб+крылья: платина / тёмное серебро (только 2, форма достаточна)
  4: 0xF5F5F5,  // Контр-Адмирал   — platinum
  5: 0x9E9E9E,  // Коммодор        — silver-grey

  // Tier 3 — три бара: золото / серебро / бронза / ярко-cyan (4 чётко разных)
  6: 0xFFD700,  // Капитан I       — gold
  7: 0xE8E8E8,  // Капитан II      — bright silver
  8: 0xCD7F32,  // Капитан III     — bronze
  9: 0x00E5FF,  // Командор        — bright cyan

  // Tier 4 — щит: mint / sky-blue / фиолетовый / лавандовый (4 разных оттенка)
  10: 0x64FFDA, // Капитан-лейтенант — bright mint
  11: 0x40C4FF, // Старший лейтенант — sky blue
  12: 0x7C4DFF, // Лейтенант         — deep violet
  13: 0xCE93D8, // Младший лейтенант — soft lavender

  // Tier 5 — "=": ярко-зелёный / тёмный тил (зелёный vs тил — разные оттенки)
  14: 0x69F0AE, // Мичман            — bright green
  15: 0x26A69A, // Главный старшина  — teal

  // Tier 6 — двойной шеврон: светло-янтарный / насыщенный оранжевый
  16: 0xFFCC80, // Старшина I статьи — amber light
  17: 0xFFA726, // Старшина II статьи — deep amber

  // Tier 7 — одиночный шеврон: от светлого стального к тёмному (максимальный диапазон)
  18: 0xCFD8DC, // Старший матрос    — light steel
  19: 0x78909C, // Матрос            — steel
  20: 0x37474F, // Кадет             — dark steel
};

// Номер тира по rank.id (7 тиров).
export function rankTier(id) {
  if (id <= 3)  return 1;
  if (id <= 5)  return 2;
  if (id <= 9)  return 3;
  if (id <= 13) return 4;
  if (id <= 15) return 5;
  if (id <= 17) return 6;
  return 7;
}

// Корабль игрока. cfg = PLAYER — общие константы движения/регена (одинаковы для всех корпусов).
// Корабль-специфичные статы (корпус/щит/скорость/спрайт/множитель урона) живут в this.ship
// и задаются applyShip(). Логика полёта — systems/Movement.js, стрельба — GameScene.
export default class Player {
  constructor(scene, x, y, objScale = 1.0) {
    this.scene = scene;
    this.cfg = PLAYER;
    this.objScale = objScale;

    const start = SHIP_BY_KEY[PLAYER.shipKey];
    this.sprite = scene.add.image(x, y, start.key).setDepth(50);
    scene.physics.add.existing(this.sprite);
    // applyShip берёт лоадаут корабля из scene.loadouts (слоты модулей) и считает статы.
    this.applyShip(start);
    this.hull = this.maxHull;
    this.shield = this.maxShield;

    // Nameplate над кораблём: иконка тира (ADD blend) + ник со stroke.
    this._npIcon = scene.add.image(0, 0, 'rank_tier1')
      .setDisplaySize(22, 22)
      .setDepth(51);
    this._npText = scene.add.text(0, 0, '', {
      fontFamily: 'Inter, sans-serif', fontSize: '12px',
      color: '#e0e0e0', stroke: '#000000', strokeThickness: 3,
      resolution: UI_RES,
    }).setOrigin(0, 0.5).setDepth(51);

    this.heading = -Math.PI / 2;     // направление ДВИЖЕНИЯ
    this.facing = -Math.PI / 2;      // направление НОСА (в бою — на цель)
    this.waypoint = null;            // {x, y} или null
    this.boosting = false;
    this.speed = 0;                  // текущая скорость (для HUD)
    this.lastDamageAt = -100000;
    this.lastBoostAt = -100000;
    this.lastAttackAt = -100000;     // время последнего выстрела (для снятия защиты безопасной зоны)
    this.fireCooldown = 0;
    this.alive = true;
    this.lockedRotation = false; // флаг для блокировки вращения (при прыжке)

    // Дебаффы от снарядов мобов
    this.dotTimer   = 0;    // кислота: секунд осталось
    this.dotDamage  = 0;    // кислота: урон/сек
    this.empTimer   = 0;    // EMP: секунд осталось
    this.empMult    = 1;    // EMP: множитель скорости (0.45 при активном дебаффе)
    this.gravTimer  = 0;    // гравпульс: секунд замедления осталось
    this.gravMult   = 1;    // гравпульс: множитель скорости
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  // Вызвать из GameScene после того, как pilotRank определён.
  setNameplate(name, rank) {
    const id   = rank?.id ?? 20;
    const tier = rankTier(id);
    const tint = RANK_TINTS[id] ?? 0x888888;
    this._npIcon.setTexture(`rank_tier${tier}`).setTint(tint);
    this._npText.setText(name || 'PILOT');
  }

  // Сменить активный корабль (из Гаража). Сохраняем долю корпуса, чтобы не «долечивать» сменой.
  applyShip(ship) {
    const hullFrac = this.maxHull ? this.hull / this.maxHull : 1;
    this.ship = ship;
    this.sprite.setTexture(ship.key);
    // Вписываем в displaySize-бокс с сохранением пропорций (спрайты не квадратные).
    const src = this.scene.textures.get(ship.key).getSourceImage();
    const finalSize = ship.displaySize * (this.objScale || 1.0);
    const scale = finalSize / Math.max(src.width, src.height);
    const dw = Math.round(src.width  * scale);
    const dh = Math.round(src.height * scale);
    this.sprite.setDisplaySize(dw, dh);
    this.displaySize = finalSize;
    // Уровень корабля 1-10 (прокачка за кредиты) → бонусы корпуса.
    this.shipLevel = this.scene.shipLevels?.[ship.key] || 1;
    this.maxHull = Math.round(ship.hullMax * shipLevelMods(this.shipLevel).hull);
    this.hull = Math.round(this.maxHull * hullFrac);
    this.shipShieldBase = ship.shieldBase;
    this.shipBaseSpeed = ship.baseSpeed;    // база корпуса; двигатели добавляют сверху
    this.shipDmgMod = ship.dmgMod || 1.0;

    // Используем глобально экипированные модули (из GameScene.equipped).
    // Это позволяет сохранять прокачанные пушки/щиты при смене корабля.
    this.slots = this.scene.equipped || defaultLoadout(ship.wSlots, ship.sSlots, ship.eSlots);
    
    // Если слотов на новом корабле МЕНЬШЕ, чем было на старом — лишние модули в расчете не участвуют.
    // Но физически они остаются в массиве this.scene.equipped, чтобы не пропадать.
    this.recomputeStats();
  }

  // Пересчёт статов: суммирование по всем занятым слотам корабля.
  recomputeStats() {
    const isAdmin = this.ship.tier === 'ADMIN';
    const m = shipLevelMods(isAdmin ? 1 : (this.shipLevel || 1));
    const ship = this.ship;

    const W = (this.slots.weapon || []).slice(0, ship.wSlots).filter(Boolean);
    const S = (this.slots.shield || []).slice(0, ship.sSlots).filter(Boolean);
    const E = (this.slots.engine || []).slice(0, ship.eSlots || 0).filter(Boolean);

    const shieldItems = S.filter(s => s.type !== 'armor');
    const armorItems  = S.filter(s => s.type === 'armor');
    const cannonW = W.filter(w => w.type !== 'laser');
    const laserW  = W.filter(w => w.type === 'laser');
    this.hasCannon = cannonW.length > 0 || isAdmin;
    this.hasLaser  = laserW.length > 0;

    const sl  = k => ((this.scene.skillLevels || {})[k] || 0);
    const boardFx = getBoardEffects(this.scene.equippedBoard);
    const BF  = s => (boardFx[s] || 0) / 100;

    // ── Step 1: RAW module sums (without modMult) — item base ────────────────
    const rawCannonSum = cannonW.reduce((a,w)=>a+w.damage, 0) || (isAdmin ? 500 : 0);
    const rawLaserSum  = laserW.reduce((a,w)=>a+w.damage, 0);
    const rawDurSum    = shieldItems.reduce((a,s)=>a+s.durability, 0);
    const rawRegenSum  = shieldItems.reduce((a,s)=>a+s.regen, 0);
    const rawSpdSum    = E.reduce((a,e)=>a+(e.speed||0), 0);

    // ── Step 2: BASE values = ship + ship-level upgrades + raw module values ──
    const BASE_cannon  = Math.round(rawCannonSum * this.shipDmgMod * m.damage);
    const BASE_laser   = Math.round(rawLaserSum  * this.shipDmgMod * m.damage);
    const BASE_hull    = Math.round(ship.hullMax * m.hull);
    const shieldTotal  = this.shipShieldBase + rawDurSum;
    const BASE_shield  = Math.round(shieldTotal * m.shield);
    const speedTotal   = this.shipBaseSpeed + rawSpdSum;
    const BASE_speed   = Math.round(speedTotal * m.speed);
    const BASE_regen   = shieldItems.length
      ? rawRegenSum
      : (isAdmin ? 500 : Math.round(BASE_shield * 0.03));

    // ── Step 3: Upgrade % from modMult — expressed relative to BASE ──────────
    // Each source is a %, summed with skills/perks/board before applying to BASE once.
    const cannonUpgPct = rawCannonSum > 0
      ? cannonW.reduce((a,w) => a + w.damage * (modMult(w) - 1), 0) / rawCannonSum : 0;
    const laserUpgPct  = rawLaserSum > 0
      ? laserW.reduce((a,w) => a + w.damage * (modMult(w) - 1), 0) / rawLaserSum : 0;
    const shieldUpgPct = (shieldTotal > 0 && rawDurSum > 0)
      ? shieldItems.reduce((a,s) => a + s.durability * (modMult(s) - 1), 0) / shieldTotal : 0;
    const speedUpgPct  = (speedTotal > 0 && rawSpdSum > 0)
      ? E.reduce((a,e) => a + (e.speed||0) * (modMult(e) - 1), 0) / speedTotal : 0;
    const regenUpgPct  = rawRegenSum > 0
      ? shieldItems.reduce((a,s) => a + s.regen * (modMult(s) - 1), 0) / rawRegenSum : 0;

    // ── Step 4: Collect ALL perk % contributions in one pass each ────────────
    let cannonPerkPct  = 0, critPerkAdd = 0, hullBreakerPen = 0;
    for (const w of cannonW) {
      if (!w.perk) continue;
      const pb = perkBonus(w.perk);
      if (w.perk.key === 'perk_steady_aim')    cannonPerkPct  += 0.10 * (1 + pb);
      if (w.perk.key === 'perk_critical_edge') critPerkAdd    += 0.12 * (1 + pb);
      if (w.perk.key === 'perk_hull_breaker')  hullBreakerPen += 0.05 * (1 + pb);
    }
    this.turnRateMult   = 1.0;
    this.stealthDurMult = 1.0;
    let engineThrustPct = 0;
    for (const e of E) {
      if (!e.perk) continue;
      const pb = perkBonus(e.perk);
      if (e.perk.key === 'perk_engine_thrust')  engineThrustPct  += 0.10 * (1 + pb);
      if (e.perk.key === 'perk_engine_agility') this.turnRateMult  *= 1 + 0.15 * (1 + pb);
      if (e.perk.key === 'perk_engine_boost')   this.stealthDurMult *= 1 + 0.50 * (1 + pb);
    }
    let regenPerkPct = 0, evasionPerkAdd = 0, piercingResPerkRed = 0, quickRecoveryMult = 1.0;
    this.kineticAbsorbChance = 0;
    for (const s of S) {
      if (!s.perk) continue;
      const pb = perkBonus(s.perk);
      if (s.perk.key === 'perk_resonance')      regenPerkPct       += 0.12 * (1 + pb);
      if (s.perk.key === 'perk_hardened')        piercingResPerkRed += 0.10 * (1 + pb);
      if (s.perk.key === 'perk_quick_recovery')  quickRecoveryMult  *= 1 - 0.30 * (1 + pb);
      if (s.perk.key === 'perk_nimble')          evasionPerkAdd     += 0.06 * (1 + pb);
      if (s.perk.key === 'perk_kinetic_absorb')  this.kineticAbsorbChance = Math.max(this.kineticAbsorbChance, 0.15 * (1 + pb));
      if (s.perk.key === 'perk_bulwark' && shieldItems.length === 0) piercingResPerkRed += 0.20 * (1 + pb);
    }

    // ── Step 5: Armor flat hull bonus — additive from each module's own raw base ─
    const armorHullFlat = armorItems.reduce((a,s) => {
      const base  = s.hullBonus;
      const upgF  = modMult(s) - 1;
      const platF = s.perk?.key === 'perk_armor_plating' ? 0.10 * (1 + perkBonus(s.perk)) : 0;
      return a + Math.round(base * (1 + upgF + platF));
    }, 0);

    // ── Step 6: Active booster % (shop purchases, keyed by expiry timestamp) ───
    const _ab  = this.scene.activeBoosters || {};
    const _now = Date.now();
    const boostDmg    = _ab.boost_damage > _now ? 0.10 : 0;
    const boostHull   = _ab.boost_hull   > _now ? 0.20 : 0;
    const boostShield = _ab.boost_shield > _now ? 0.20 : 0;
    const boostXp     = _ab.boost_xp    > _now ? 0.25 : 0;
    // Consumed-item speed multipliers (speed_boost consumable, stealth)
    const speedBoostPct = (this.scene._speedBoostMult ?? 1.0) * (this.scene._stealthMult ?? 1.0) - 1.0;

    // ── Step 7: FINAL STATS — BASE × (1 + Σ all % sources) ──────────────────
    // Boosters are additive with upgPct/skillPct/perkPct/boardPct — applied to the same
    // BASE that already includes ship-level upgrades (user intent: "базовые = с апгрейдом").
    this.cannonDamage = Math.round(BASE_cannon * (1 + cannonUpgPct + sl('heavy_caliber') * 0.06 + cannonPerkPct + BF('cannonDmg') + boostDmg));
    this.laserDamage  = Math.round(BASE_laser  * (1 + laserUpgPct  + sl('heavy_caliber') * 0.06 + BF('laserDmg') + boostDmg));
    this.maxHull      = Math.round(BASE_hull   * (1 + sl('reinforced_hull') * 0.06 + BF('hullMax') + boostHull)) + armorHullFlat;
    this.maxShield    = Math.round(BASE_shield  * (1 + shieldUpgPct + sl('shield_optimizer') * 0.05 + BF('shieldMax') + boostShield));
    this.baseSpeed    = Math.round(BASE_speed   * (1 + speedUpgPct  + engineThrustPct + BF('speed') + speedBoostPct));
    this.shieldRegenPerSec = Math.round(BASE_regen * (1 + regenUpgPct + regenPerkPct + BF('shieldRegen')));

    // fast_regen skill overrides regen formula when no shield modules equipped
    const fastRegen = sl('fast_regen');
    this.shieldRegenDelaySec = Math.max(1, (6 - fastRegen * 0.25) * quickRecoveryMult);
    if (!shieldItems.length && !isAdmin && fastRegen > 0) {
      this.shieldRegenPerSec = Math.round(this.maxShield * (0.03 + fastRegen * 0.0175));
    }

    // Penetration: absolute additive (not % — small decimal values)
    // Best cannon's effective pen (with its own modMult as its upgrade), then skill/perk/board add on top.
    const bestPen = cannonW.length ? Math.max(...cannonW.map(w => w.penetration * modMult(w))) : (isAdmin ? 0.5 : 0);
    this.weaponPenetration = Math.min(0.40, bestPen + sl('penetrating_rounds') * 0.05 + Math.min(0.15, hullBreakerPen) + BF('piercing'));

    // Evasion: absolute additive from raw module values + perk + board
    const rawEvasion = shieldItems.reduce((a,s) => a + s.evasion * modMult(s), 0);
    this.evasion = Math.min(0.30, rawEvasion + evasionPerkAdd + BF('evasion'));

    // Crit: additive from BASE=0
    this.critChance = Math.min(0.65, critPerkAdd + sl('sharpshooter') * 0.04 + BF('critChance'));
    this.critMult   = BF('critMult') ? Math.min(4.0, 2.0 + 2.0 * BF('critMult')) : 2.0;

    // Reduction stats: 1.0 - Σ(all reductions) — board, skill, perk all additive
    this.damageResistMod   = Math.max(0.10, 1.0 - BF('piercingRes') - sl('damage_resist') * 0.05 - piercingResPerkRed);
    this.activeCooldownMod = Math.max(0.10, 1.0 - BF('cooldown')    - sl('module_specialist') * 0.10);
    this.aggroRadiusMod    = Math.max(0.30, 1.0 - BF('aggroRadius'));

    // ── Economy stats — additive from BASE=1.0 ────────────────────────────────
    this.lootPickupRadiusMult = 1 + sl('loot_magnet') * 0.30;
    this.dropChanceMult       = 1.0 + BF('lootBonus')    + sl('salvager') * 0.10;
    this.creditBonusMod       = Math.max(0.1, 1.0 + BF('creditBonus'));
    this.xpBonusMod           = Math.max(0.1, 1.0 + BF('xpBonus') + boostXp);
    this.repairCostMult       = Math.max(0.10, 1.0 - BF('repairCost')    - sl('merchants_eye') * 0.15);
    this.shopDiscountMod      = Math.max(0.10, 1.0 - BF('shopDiscount'));
    this.cargoBonusMod        = BF('cargoBonus');
    // scanRadius: board and skill both additive from BASE_SCAN_RADIUS
    this.scene.scanRadius     = Math.round(BASE_SCAN_RADIUS * (1 + BF('scanRadius') + sl('scanner_boost') * 0.20));
    this.autoAmmo        = BF('autoAmmo') > 0 || sl('auto_ammo') > 0;
    this.autoConsumables = BF('autoConsumables') > 0 || sl('auto_consumables') > 0;

    // ── Weapon accuracy + laser properties ────────────────────────────────────
    this.weaponType       = this.hasLaser && this.hasCannon ? 'mixed' : this.hasLaser ? 'laser' : 'cannon';
    this.weaponFireRate   = isAdmin ? 2.0 : 1.0;
    this.weaponFireRateMult = 1.0;
    this.cannonAccuracy   = Math.min(1.00, 0.90 + sl('targeting_ai') * 0.02);
    this.laserAccuracy    = 0.80;
    this.weaponShieldMult = 1.0;
    this.weaponHullMult   = 1.0;
    if (this.hasLaser) {
      this.weaponShieldMult = 0.90;
      this.weaponHullMult   = 1.30;
      for (const w of laserW) {
        if (!w.perk) continue;
        const pb = perkBonus(w.perk);
        if (w.perk.key === 'perk_laser_precision') this.laserAccuracy   = Math.min(1.0, this.laserAccuracy + 0.15 * (1 + pb));
        if (w.perk.key === 'perk_laser_shredder')  this.weaponHullMult += 0.20 * (1 + pb);
        if (w.perk.key === 'perk_laser_overload')  { this.laserAccuracy = 1.0; this.weaponFireRateMult *= 1 + 0.15 * (1 + pb); }
      }
      this.laserAccuracy = Math.min(0.97, this.laserAccuracy + sl('targeting_ai') * 0.034);
    }
    this.weaponDamage   = this.cannonDamage + this.laserDamage;
    this.weaponAccuracy = this.hasLaser && !this.hasCannon ? this.laserAccuracy : this.cannonAccuracy;
    this.weaponRange    = isAdmin ? 1500 : this.cfg.weaponRange;

    // ── Ship passives — applied on total (after all % bonuses) ───────────────
    const passives = ship.passives;
    this.hullRegenPerSec = 0;
    if (passives) {
      if (passives.shieldBonus) this.maxShield = Math.round(this.maxShield * (1 + passives.shieldBonus));
      if (passives.shieldPerAlly) {
        const allies = this.scene.groupSize || 0;
        if (allies > 0) this.maxShield = Math.round(this.maxShield * (1 + passives.shieldPerAlly * allies));
      }
      if (passives.damageBonus) {
        const db = 1 + passives.damageBonus;
        this.cannonDamage = Math.round(this.cannonDamage * db);
        this.laserDamage  = Math.round(this.laserDamage  * db);
      }
      if (passives.hullRegen)    this.hullRegenPerSec = passives.hullRegen;
      if (passives.evasionBonus) this.evasion = Math.min(0.30, (this.evasion ?? 0) + passives.evasionBonus);
      this.reflectChance = passives.reflectChance ?? 0;
    } else {
      this.reflectChance = 0;
    }

    // ── Corp prestige bonus — applied on total ────────────────────────────────
    const _prestigeDef = SHIP_BY_KEY[this.scene.activeShip];
    if (_prestigeDef?.corpAffinity && _prestigeDef.corpAffinity === this.scene.playerCorp) {
      const aff = _prestigeDef.corpAffinity;
      if (aff === 'helios') this.baseSpeed  = Math.round(this.baseSpeed  * 1.05);
      if (aff === 'karax')  this.maxHull    = Math.round(this.maxHull    * 1.05);
      if (aff === 'tides')  { this.maxShield = Math.round(this.maxShield * 1.05); this.shieldRegenPerSec = Math.round(this.shieldRegenPerSec * 1.03); }
    }

    this.weaponDamage = this.cannonDamage + this.laserDamage;
    this.hull  = Math.min(this.hull, this.maxHull);
    if (this.shield > this.maxShield) this.shield = this.maxShield;
  }

  // Урон: penetration-доля идёт прямо в корпус, остальное — в щит, излишек переливается в корпус.
  // Третий аргумент: true (ignoreEvasion для AoE) или opts { ignoreMovEvasion, shieldMult, hullMult }.
  takeDamage(amount, penetration = 0, optsOrIgnoreEvasion = false) {
    if (!this.alive) return { shieldHit: 0, hullHit: 0, brokeShield: false };
    if (this.invulnerable) return { shieldHit: 0, hullHit: 0, brokeShield: false };

    const opts        = (typeof optsOrIgnoreEvasion === 'object' && optsOrIgnoreEvasion !== null) ? optsOrIgnoreEvasion : {};
    const ignoreEvasion = optsOrIgnoreEvasion === true || !!opts.ignoreMovEvasion;
    const shieldMult  = opts.shieldMult ?? 1;
    const hullMult    = opts.hullMult   ?? 1;

    if (!ignoreEvasion) {
      const body = this.sprite?.body;
      const spd = body ? Math.sqrt(body.velocity.x * body.velocity.x + body.velocity.y * body.velocity.y) : 0;
      const movEvasion = Math.min(0.12, spd / 1500);
      const totalEvasion = Math.min(0.30, (this.evasion ?? 0) + movEvasion);
      if (totalEvasion > 0 && Phaser.Math.FloatBetween(0, 1) < totalEvasion) {
        return { shieldHit: 0, hullHit: 0, brokeShield: false, dodged: true };
      }
    }
    // Kinetic absorb (armor perk): only procs when shield is fully depleted.
    if (this.shield <= 0 && this.kineticAbsorbChance > 0 && Math.random() < this.kineticAbsorbChance) {
      return { shieldHit: 0, hullHit: 0, brokeShield: false, absorbed: true };
    }
    amount = Math.round(amount * (this.damageResistMod ?? 1) * (this._lockdownMult ?? 1));
    // Aegis dome: hull is immune — all damage forced into shield
    if ((this.scene._aegisDomeEndTime || 0) > this.scene.time.now) penetration = 0;
    this.lastDamageAt = this.scene.time.now;

    const direct       = amount * penetration;
    const toShieldRaw  = amount - direct;
    let hullHit        = direct * hullMult;
    const hadShield    = this.shield > 0;

    if (this.shield > 0) {
      const toShieldEff = toShieldRaw * shieldMult;
      if (toShieldEff <= this.shield) {
        this.shield -= toShieldEff;
      } else {
        hullHit += (toShieldEff - this.shield) * hullMult;
        this.shield = 0;
      }
    } else {
      hullHit = amount * hullMult;
    }
    this.hull -= hullHit;

    // Aegis passive: 7% chance to reflect shield-absorbed damage to nearest mob
    if (hadShield && this.reflectChance > 0 && Math.random() < this.reflectChance) {
      const reflectDmg = Math.round(toShieldRaw * shieldMult * 0.30);
      if (reflectDmg > 0) {
        const mobs = this.scene.mobs ?? [];
        let closest = null, bestD = 700;
        for (const m of mobs) {
          if (!m.alive) continue;
          const d = Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, m.x, m.y);
          if (d < bestD) { closest = m; bestD = d; }
        }
        if (closest) closest.takeDamage(reflectDmg, this.scene);
      }
    }

    const brokeShield = hadShield && this.shield <= 0;
    if (this.hull <= 0) { this.hull = 0; this.die(); }
    return { shieldHit: toShieldRaw * shieldMult, hullHit, brokeShield };
  }

  die() {
    this.alive = false;
    this.boosting = false;
    this.waypoint = null;
    this.speed = 0;
    this.sprite.body?.setVelocity(0, 0);
    this.sprite.setVisible(false);
    this._npIcon.setVisible(false);
    this._npText.setVisible(false);
  }

  respawn(x, y) {
    this.hull = this.maxHull;
    this.shield = this.maxShield;
    this.invulnerable = false;
    this.waypoint = null;
    this.speed = 0;
    this.boosting = false;
    this.lockedRotation = false;
    this.sprite.body?.setVelocity(0, 0);
    this.sprite.setPosition(x, y);
    this.sprite.setScale(1);
    this.sprite.setVisible(true);
    this._npIcon.setVisible(true);
    this._npText.setVisible(true);
    this.alive = true;
  }

  // faceAngle: угол на цель, если игрок её атакует; иначе null → нос по курсу движения.
  // Суммарный штраф к скорости от дебаффов (EMP + гравпульс).
  get debuffSpeedMult() { return this.empMult * this.gravMult; }

  update(dt, inSafeZone, faceAngle = null) {
    if (!this.alive) return;
    const now = this.scene.time.now;

    // Дебаффы: кислота (DoT), EMP (замедление скорости), гравпульс (замедление)
    if (this.dotTimer > 0) {
      this.dotTimer -= dt;
      this.takeDamage(this.dotDamage * dt, 0.8); // кислота бьёт преимущественно по корпусу
      if (this.dotTimer <= 0) { this.dotTimer = 0; this.dotDamage = 0; }
    }
    if (this.empTimer > 0) {
      this.empTimer -= dt;
      if (this.empTimer <= 0) { this.empTimer = 0; this.empMult = 1; }
    }
    if (this.gravTimer > 0) {
      this.gravTimer -= dt;
      if (this.gravTimer <= 0) { this.gravTimer = 0; this.gravMult = 1; }
    }
    if (this.boosting) this.lastBoostAt = now; // отсчёт «после форсажа» идёт от его конца
    const sinceDamage = now - this.lastDamageAt;
    const sinceBoost = now - this.lastBoostAt;

    // Реген щита: 6 с после урона И после окончания форсажа (оба условия, одна задержка).
    const regenDelayMs = (this.shieldRegenDelaySec ?? 6) * 1000;
    if (!this.boosting && sinceDamage > regenDelayMs &&
        sinceBoost > regenDelayMs && this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + this.shieldRegenPerSec * dt);
    }
    // Авто-ремонт корпуса: если не атакуют hullRepairDelay (10 с) — чиним 5%/сек.
    if (sinceDamage > this.cfg.hullRepairDelay && this.hull < this.maxHull) {
      this.hull = Math.min(this.maxHull, this.hull + this.maxHull * this.cfg.hullRepairPctPerSec * dt);
    }
    // Пассивный реген корпуса (Argosy): 25 HP/с всегда, без задержки.
    if (this.hullRegenPerSec > 0 && this.hull < this.maxHull) {
      this.hull = Math.min(this.maxHull, this.hull + this.hullRegenPerSec * dt);
    }
    // Нос корабля:
    //  • есть цель в радиусе → плавно доворачиваем к ней;
    //  • цели нет, но летим → плавно к курсу движения;
    //  • стоим без цели → сохраняем положение (никаких рывков после убийства).
    if (!this.lockedRotation) {
      const rot = HANDLING.turnRate * dt;
      if (faceAngle !== null) {
        this.facing = Phaser.Math.Angle.RotateTo(this.facing, faceAngle, rot);
      } else if (this.waypoint || this.speed > 5) {
        this.facing = Phaser.Math.Angle.RotateTo(this.facing, this.heading, rot);
      }
      this.sprite.rotation = this.facing + (this.ship.artAngleOffset ?? ART_ANGLE_OFFSET);
    }

    // Nameplate: над кораблём, центрировано. Float-позиция = двигается 1:1 со спрайтом.
    // Shimmer от 46× downscale решён через pre-render rank_tier в BootScene (44px).
    const npY    = this.y - this.sprite.displayHeight * 0.55 - 13;
    const totalW = 22 + 4 + this._npText.width;
    const npX    = this.x - totalW / 2;
    this._npIcon.setPosition(npX + 11, npY);
    this._npText.setPosition(npX + 22 + 4, npY);
  }
}
