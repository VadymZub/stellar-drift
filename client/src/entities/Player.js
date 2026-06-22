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
    // Admin uses level-1 multipliers (×1.0) so bare ship stats stay flat; gear still adds on top.
    const m = shipLevelMods(isAdmin ? 1 : (this.shipLevel || 1));
    const ship = this.ship;

    // Берем только те модули из глобального списка, для которых есть физические слоты на текущем корпусе.
    const W = (this.slots.weapon || []).slice(0, ship.wSlots).filter(Boolean);
    const S = (this.slots.shield || []).slice(0, ship.sSlots).filter(Boolean);
    const E = (this.slots.engine || []).slice(0, ship.eSlots || 0).filter(Boolean);

    // Shield slots: separate shield modules from armor modules.
    const shieldItems = S.filter(s => s.type !== 'armor');
    const armorItems  = S.filter(s => s.type === 'armor');

    // Armor hull bonus — flat addition to maxHull, NOT scaled by ship level or reinforced_hull skill.
    // perk_armor_plating multiplies each module's contribution individually.
    const sumArmorHull = armorItems.reduce((a, s) => {
      let bonus = s.hullBonus * modMult(s);
      if (s.perk?.key === 'perk_armor_plating') bonus *= (1 + 0.10 * (1 + perkBonus(s.perk)));
      return a + bonus;
    }, 0);

    // Split weapon slots by type: lasers fire hitscan, cannons fire projectiles.
    const cannonW = W.filter(w => w.type !== 'laser');
    const laserW  = W.filter(w => w.type === 'laser');
    this.hasCannon = cannonW.length > 0 || isAdmin;
    this.hasLaser  = laserW.length > 0;

    const sumCannonDmg = cannonW.reduce((a, w) => a + w.damage * modMult(w), 0);
    this.cannonDamage  = Math.round((sumCannonDmg || (isAdmin ? 500 : 0)) * this.shipDmgMod * m.damage);
    this.weaponPenetration = cannonW.length ? Math.max(...cannonW.map(w => w.penetration * modMult(w))) : (isAdmin ? 0.5 : 0);

    const sumLaserDmg = laserW.reduce((a, w) => a + w.damage * modMult(w), 0);
    this.laserDamage  = Math.round(sumLaserDmg * this.shipDmgMod * m.damage);

    this.weaponDamage = this.cannonDamage + this.laserDamage;
    this.weaponFireRate = isAdmin ? 2.0 : 1.0;

    const sumDur = shieldItems.reduce((a, s) => a + s.durability * modMult(s), 0);
    this.maxShield = Math.round((this.shipShieldBase + sumDur) * m.shield);
    const defaultRegen = Math.round(this.maxShield * 0.03);
    this.shieldRegenPerSec = shieldItems.length ? Math.round(shieldItems.reduce((a, s) => a + s.regen * modMult(s), 0)) : (isAdmin ? 500 : defaultRegen);
    this.evasion = Math.min(isAdmin ? 0.25 : 0.15, shieldItems.reduce((a, s) => a + s.evasion * modMult(s), 0));

    const sumSpd = E.reduce((a, e) => a + (e.speed || 0) * modMult(e), 0);
    this.baseSpeed = Math.round((this.shipBaseSpeed + sumSpd) * m.speed);
    this.weaponRange = isAdmin ? 1500 : this.cfg.weaponRange;

    // ── Skill passive bonuses (from gs.skillLevels) ────────────────────────
    const sl = k => ((this.scene.skillLevels || {})[k] || 0);

    // Combat
    const hcMult = 1 + sl('heavy_caliber') * 0.06;
    this.cannonDamage      = Math.round(this.cannonDamage * hcMult);
    this.laserDamage       = Math.round(this.laserDamage  * hcMult);
    this.weaponDamage      = this.cannonDamage + this.laserDamage;
    this.weaponPenetration = Math.min(0.25, this.weaponPenetration + sl('penetrating_rounds') * 0.05);
    this.critChance        = Math.min(0.65, sl('sharpshooter') * 0.04);
    // Engineering — maxHull: база корабля × мульт уровня × скилл. Броня — плоский бонус поверх.
    this.maxHull           = Math.round(this.ship.hullMax * m.hull * (1 + sl('reinforced_hull') * 0.06)) + Math.round(sumArmorHull);
    this.hull              = Math.min(this.hull, this.maxHull);
    this.maxShield         = Math.round(this.maxShield * (1 + sl('shield_optimizer') * 0.05));
    const fastRegen = sl('fast_regen');
    this.shieldRegenDelaySec = 6 - fastRegen * 0.25;
    if (!shieldItems.length && !isAdmin && fastRegen > 0) this.shieldRegenPerSec = Math.round(this.maxShield * (0.03 + fastRegen * 0.0175));
    this.damageResistMod     = Math.max(0.20, 1 - sl('damage_resist') * 0.05);
    this.kineticAbsorbChance = 0;
    this.activeCooldownMod   = Math.max(0.30, 1 - sl('module_specialist') * 0.10);
    // Trading
    this.lootPickupRadiusMult = 1 + sl('loot_magnet') * 0.30;
    this.dropChanceMult       = 1 + sl('salvager')    * 0.10;
    this.repairCostMult       = Math.max(0.30, 1 - sl('merchants_eye') * 0.15);
    this.scene.scanRadius     = Math.round(BASE_SCAN_RADIUS * (1 + sl('scanner_boost') * 0.20));
    if (sl('auto_ammo')        > 0) this.autoAmmo        = true;
    if (sl('auto_consumables') > 0) this.autoConsumables = true;

    // ── Perk bonuses — cannon perks affect cannonDamage, laser perks affect laserDamage ──
    let cannonPerkMult = 1;
    let hullBreakerPen = 0;
    for (const w of cannonW) {
      if (!w.perk) continue;
      const pb = perkBonus(w.perk);
      if (w.perk.key === 'perk_steady_aim')    cannonPerkMult  *= 1 + 0.10 * (1 + pb);
      if (w.perk.key === 'perk_critical_edge') this.critChance  = Math.min(0.65, this.critChance + 0.12 * (1 + pb));
      if (w.perk.key === 'perk_hull_breaker')  hullBreakerPen  += 0.05 * (1 + pb);
    }
    // Perks contribute max 0.15 pen; combined with skill (0.25) total cap is 0.40.
    this.weaponPenetration = Math.min(0.40, this.weaponPenetration + Math.min(0.15, hullBreakerPen));
    this.cannonDamage = Math.round(this.cannonDamage * cannonPerkMult);

    // ── Weapon accuracy + laser properties ────────────────────────────────
    this.weaponType       = this.hasLaser && this.hasCannon ? 'mixed' : this.hasLaser ? 'laser' : 'cannon';
    this.weaponFireRateMult = 1.0;
    // Cannon accuracy: base 90%, targeting_ai +2%/lv → 100%
    this.cannonAccuracy   = Math.min(1.00, 0.90 + sl('targeting_ai') * 0.02);
    // Laser accuracy + multipliers
    this.laserAccuracy    = 0.80;
    this.weaponShieldMult = 1.0;
    this.weaponHullMult   = 1.0;
    if (this.hasLaser) {
      this.weaponShieldMult = 0.90;
      this.weaponHullMult   = 1.30;
      let laserPerkMult = 1;
      for (const w of laserW) {
        if (!w.perk) continue;
        const pb = perkBonus(w.perk);
        if (w.perk.key === 'perk_laser_precision') this.laserAccuracy  = Math.min(1.0, this.laserAccuracy + 0.15 * (1 + pb));
        if (w.perk.key === 'perk_laser_shredder')  this.weaponHullMult += 0.20 * (1 + pb);
        if (w.perk.key === 'perk_laser_overload')  { this.laserAccuracy = 1.0; this.weaponFireRateMult *= 1 + 0.15 * (1 + pb); }
      }
      this.laserDamage  = Math.round(this.laserDamage * laserPerkMult);
      // targeting_ai: +3.4%/level, laser cap 97%
      this.laserAccuracy = Math.min(0.97, this.laserAccuracy + sl('targeting_ai') * 0.034);
    }
    this.weaponDamage    = this.cannonDamage + this.laserDamage;
    // Legacy alias used in a few display spots
    this.weaponAccuracy  = this.hasLaser && !this.hasCannon ? this.laserAccuracy : this.cannonAccuracy;

    // ── Engine perk bonuses ────────────────────────────────────────────────
    this.turnRateMult   = 1.0;
    this.stealthDurMult = 1.0;
    for (const e of E) {
      if (!e.perk) continue;
      const pb = perkBonus(e.perk);
      if (e.perk.key === 'perk_engine_thrust')  this.baseSpeed      = Math.round(this.baseSpeed * (1 + 0.10 * (1 + pb)));
      if (e.perk.key === 'perk_engine_agility') this.turnRateMult  *= 1 + 0.15 * (1 + pb);
      if (e.perk.key === 'perk_engine_boost')   this.stealthDurMult *= 1 + 0.50 * (1 + pb);
    }

    // ── Perk bonuses (shield + armor slots) ───────────────────────────────────
    for (const s of S) {
      if (!s.perk) continue;
      const pb = perkBonus(s.perk);
      // Shield perks
      if (s.perk.key === 'perk_resonance')      this.shieldRegenPerSec   = Math.round(this.shieldRegenPerSec * (1 + 0.12 * (1 + pb)));
      if (s.perk.key === 'perk_hardened')       this.damageResistMod     = Math.max(0.20, this.damageResistMod - 0.10 * (1 + pb));
      if (s.perk.key === 'perk_quick_recovery') this.shieldRegenDelaySec = Math.max(1, this.shieldRegenDelaySec * (1 - 0.30 * (1 + pb)));
      // Armor perks (perk_armor_plating applied earlier in sumArmorHull)
      if (s.perk.key === 'perk_nimble')         this.evasion             = Math.min(0.30, (this.evasion ?? 0) + 0.06 * (1 + pb));
      if (s.perk.key === 'perk_kinetic_absorb') this.kineticAbsorbChance = Math.max(this.kineticAbsorbChance, 0.15 * (1 + pb));
      // perk_bulwark: bonus resist only in pure armor builds (no shield modules at all)
      if (s.perk.key === 'perk_bulwark' && shieldItems.length === 0) this.damageResistMod = Math.max(0.20, this.damageResistMod - 0.20 * (1 + pb));
    }

    // ── Ship passives ──────────────────────────────────────────────────────
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
        this.weaponDamage = this.cannonDamage + this.laserDamage;
      }
      if (passives.hullRegen) this.hullRegenPerSec = passives.hullRegen;
      if (passives.evasionBonus) this.evasion = Math.min(0.30, (this.evasion ?? 0) + passives.evasionBonus);
    }

    // ── Corp prestige bonus ────────────────────────────────────────────────
    // Prestige ships grant a passive bonus when the player's corp matches the ship's corpAffinity.
    const _prestigeDef = SHIP_BY_KEY[this.scene.activeShip];
    if (_prestigeDef?.corpAffinity && _prestigeDef.corpAffinity === this.scene.playerCorp) {
      const aff = _prestigeDef.corpAffinity;
      if (aff === 'helios') this.baseSpeed        = Math.round(this.baseSpeed * 1.05);
      if (aff === 'karax')  this.maxHull          = Math.round(this.maxHull * 1.05);
      if (aff === 'tides') { this.maxShield       = Math.round(this.maxShield * 1.05); this.shieldRegenPerSec = Math.round(this.shieldRegenPerSec * 1.03); }
    }

    // ── Expansion board effects ────────────────────────────────────────────
    // Reset board-derived fields before applying (recomputed every call)
    this.critMult        = 2.0;
    this.aggroRadiusMod  = 1.0;
    this.creditBonusMod  = 1.0;
    this.xpBonusMod      = 1.0;
    this.shopDiscountMod = 1.0;
    this.cargoBonusMod   = 0.0;
    this.autoAmmo        = false;
    this.autoConsumables = false;

    const boardFx = getBoardEffects(this.scene.equippedBoard);
    for (const [stat, pct] of Object.entries(boardFx)) {
      const f = pct / 100;
      // Combat
      if (stat === 'cannonDmg')   { this.cannonDamage = Math.round(this.cannonDamage * (1 + f)); }
      if (stat === 'laserDmg')    { this.laserDamage  = Math.round(this.laserDamage  * (1 + f)); }
      if (stat === 'piercing')    { this.weaponPenetration = Math.min(0.40, this.weaponPenetration + f); }
      if (stat === 'piercingRes') { this.damageResistMod   = Math.max(0.10, this.damageResistMod - f); }
      if (stat === 'shieldMax')   { this.maxShield = Math.round(this.maxShield * (1 + f)); }
      if (stat === 'hullMax')     { this.maxHull   = Math.round(this.maxHull   * (1 + f)); this.hull = Math.min(this.hull, this.maxHull); }
      if (stat === 'speed')       { this.baseSpeed = Math.round(this.baseSpeed * (1 + f)); }
      if (stat === 'cooldown')    { this.activeCooldownMod = Math.max(0.10, this.activeCooldownMod - f); }
      if (stat === 'critChance')  { this.critChance     = Math.min(0.65, this.critChance + f); }
      if (stat === 'critMult')    { this.critMult       = Math.min(4.0, this.critMult * (1 + f)); }
      if (stat === 'evasion')     { this.evasion        = Math.min(0.30, (this.evasion ?? 0) + f); }
      if (stat === 'shieldRegen') { this.shieldRegenPerSec = Math.round(this.shieldRegenPerSec * (1 + f)); }
      if (stat === 'aggroRadius') { this.aggroRadiusMod  = Math.max(0.3, this.aggroRadiusMod - f); }
      // Economy
      if (stat === 'lootBonus')    { this.dropChanceMult  = Math.max(0, this.dropChanceMult * (1 + f)); }
      if (stat === 'creditBonus')  { this.creditBonusMod  = Math.max(0.1, this.creditBonusMod + f); }
      if (stat === 'xpBonus')      { this.xpBonusMod      = Math.max(0.1, this.xpBonusMod + f); }
      if (stat === 'repairCost')   { this.repairCostMult  = Math.max(0.10, this.repairCostMult - f); }
      if (stat === 'shopDiscount') { this.shopDiscountMod  = Math.max(0.10, this.shopDiscountMod - f); }
      // QoL
      if (stat === 'autoAmmo'        && f > 0) { this.autoAmmo        = true; }
      if (stat === 'autoConsumables' && f > 0) { this.autoConsumables = true; }
      if (stat === 'scanRadius')  { this.scene.scanRadius = Math.round(this.scene.scanRadius * (1 + f)); }
      if (stat === 'cargoBonus')  { this.cargoBonusMod   += f; }
    }
    if (Object.keys(boardFx).length > 0) {
      this.weaponDamage = this.cannonDamage + this.laserDamage;
    }

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
    amount = Math.round(amount * (this.damageResistMod ?? 1));
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
