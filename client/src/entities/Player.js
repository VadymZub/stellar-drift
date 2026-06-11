import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { PLAYER, ART_ANGLE_OFFSET, HANDLING } from '../constants.js';
import { defaultLoadout, modMult } from '../items.js';
import { SHIP_BY_KEY, shipLevelMods, SHIP_MAX_LEVEL } from '../ships.js';

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
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  // Сменить активный корабль (из Гаража). Сохраняем долю корпуса, чтобы не «долечивать» сменой.
  applyShip(ship) {
    const hullFrac = this.maxHull ? this.hull / this.maxHull : 1;
    this.ship = ship;
    this.sprite.setTexture(ship.key);
    // Вписываем в displaySize-бокс с сохранением пропорций (спрайты не квадратные).
    const src = this.scene.textures.get(ship.key).getSourceImage();
    const finalSize = ship.displaySize * (this.objScale || 1.0);
    const scale = finalSize / Math.max(src.width, src.height);
    this.sprite.setDisplaySize(src.width * scale, src.height * scale);
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
    const m = isAdmin ? shipLevelMods(SHIP_MAX_LEVEL) : shipLevelMods(this.shipLevel || 1);
    const ship = this.ship;

    if (isAdmin) {
      // Админ-корабль: игнорируем модули, даем сразу топовые статы
      this.weaponDamage = Math.round(ship.hullMax * 0.5 * m.damage); // Огромный урон
      this.weaponPenetration = 0.5;
      this.weaponFireRate = 2.0;
      this.maxShield = Math.round(ship.shieldBase * m.shield);
      this.shieldRegenPerSec = 500;
      this.evasion = 0.25;
      this.baseSpeed = Math.round(ship.baseSpeed * m.speed);
      this.weaponRange = 1500;
      if (this.shield > this.maxShield) this.shield = this.maxShield;
      return;
    }

    // Берем только те модули из глобального списка, для которых есть физические слоты на текущем корпусе.
    const W = (this.slots.weapon || []).slice(0, ship.wSlots).filter(Boolean);
    const S = (this.slots.shield || []).slice(0, ship.sSlots).filter(Boolean);
    const E = (this.slots.engine || []).slice(0, ship.eSlots || 0).filter(Boolean);

    // modMult(x) — кредитный апгрейд модуля (+1.5%/ур, до +7.5%).
    const sumDmg = W.reduce((a, w) => a + w.damage * modMult(w), 0);
    this.weaponDamage = Math.round(sumDmg * this.shipDmgMod * m.damage);
    this.weaponPenetration = W.length ? Math.max(...W.map((w) => w.penetration * modMult(w))) : 0;
    this.weaponFireRate = 1.0;

    const sumDur = S.reduce((a, s) => a + s.durability * modMult(s), 0);
    this.maxShield = Math.round((this.shipShieldBase + sumDur) * m.shield);
    this.shieldRegenPerSec = S.length ? Math.round(S.reduce((a, s) => a + s.regen * modMult(s), 0)) : PLAYER.baseShieldRegen;
    this.evasion = Math.min(0.15, S.reduce((a, s) => a + s.evasion * modMult(s), 0));

    const sumSpd = E.reduce((a, e) => a + (e.speed || 0) * modMult(e), 0);
    this.baseSpeed = Math.round((this.shipBaseSpeed + sumSpd) * m.speed);
    this.weaponRange = this.cfg.weaponRange; // Добавляем дальность стрельбы

    if (this.shield > this.maxShield) this.shield = this.maxShield;
  }

  // Урон: penetration-доля идёт прямо в корпус, остальное — в щит, излишек переливается в корпус.
  // ignoreEvasion: AoE-залпы боссов нельзя увернуться статом — спасает только уход из круга.
  takeDamage(amount, penetration = 0, ignoreEvasion = false) {
    if (!this.alive) return { shieldHit: 0, hullHit: 0, brokeShield: false };
    // Уклонение от щита-дефлектора — шанс полностью избежать урона
    if (!ignoreEvasion && this.evasion && Phaser.Math.FloatBetween(0, 1) < this.evasion) {
      return { shieldHit: 0, hullHit: 0, brokeShield: false, dodged: true };
    }
    this.lastDamageAt = this.scene.time.now;

    const direct = amount * penetration;
    let toShield = amount - direct;
    let hullHit = direct;
    const hadShield = this.shield > 0;

    if (toShield <= this.shield) {
      this.shield -= toShield;
    } else {
      hullHit += (toShield - this.shield);
      this.shield = 0;
    }
    this.hull -= hullHit;

    const brokeShield = hadShield && this.shield <= 0;
    if (this.hull <= 0) { this.hull = 0; this.die(); }
    return { shieldHit: toShield, hullHit, brokeShield };
  }

  die() {
    this.alive = false;
    this.boosting = false;
    this.waypoint = null;
    this.sprite.setVisible(false);
  }

  respawn(x, y) {
    this.hull = this.maxHull;
    this.shield = this.maxShield;
    this.sprite.setPosition(x, y);
    this.sprite.setVisible(true);
    this.alive = true;
  }

  // faceAngle: угол на цель, если игрок её атакует; иначе null → нос по курсу движения.
  update(dt, inSafeZone, faceAngle = null) {
    if (!this.alive) return;
    const now = this.scene.time.now;
    if (this.boosting) this.lastBoostAt = now; // отсчёт «после форсажа» идёт от его конца
    const sinceDamage = now - this.lastDamageAt;
    const sinceBoost = now - this.lastBoostAt;

    // Реген щита: 10 с после урона И 5 с после окончания форсажа (оба условия).
    if (!this.boosting && sinceDamage > this.cfg.shieldRegenDelayDamage &&
        sinceBoost > this.cfg.shieldRegenDelayBoost && this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + this.shieldRegenPerSec * dt);
    }
    // Авто-ремонт корпуса: если не атакуют hullRepairDelay (10 с) — чиним 5%/сек.
    if (sinceDamage > this.cfg.hullRepairDelay && this.hull < this.maxHull) {
      this.hull = Math.min(this.maxHull, this.hull + this.maxHull * this.cfg.hullRepairPctPerSec * dt);
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
  }
}
