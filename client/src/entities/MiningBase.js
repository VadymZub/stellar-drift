import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { BASE_CONFIG, turretSlotsFor, CORP_ASSETS, cannon2GoldCost, goldPerSecByTier, pvpTierMult, stationNameKey, TURRET_ORIGIN } from '../bases.js';
import { UI_RES, DPR, TURRET_REWARD, MOBS } from '../constants.js';
import { prerenderTex } from '../utils/prerenderTex.js';
import { miningBaseSave } from '../api.js';
import { i18n } from '../i18n.js';
import Mob from './Mob.js';
import { SECTORS } from '../galaxy.js';

// Persists base ownership/state across sector re-entries.
const _registry = new Map();

// Реген щита/прочности — 30с без урона → щит +5%/сек, 3мин без урона → корпус +0.5%/сек
// (одни и те же ставки для базы и для турелей).
const SHIELD_REGEN_DELAY_MS = 30000;
const SHIELD_REGEN_PCT_SEC  = 0.05;
const HULL_REGEN_DELAY_MS   = 180000;
const HULL_REGEN_PCT_SEC    = 0.005;

// Частная Безопасность (hireSecurity) — платный наём владельцем, привязан к ЭТОЙ
// базе (орбита вокруг неё), не роится по сектору — см. диалог: старый автоматический
// патруль sec_drone/sec_destroyer дублировал ConfedGuardSystem на одних и тех же
// нейтральных базах без всякого лора ("конфедераты и частная охрана - разные
// корпорации? нелогично"). ORBIT_RADIUS то же значение, что ConfedGuardSystem
// использует для одиночной базы (визуальная согласованность двух систем охраны).
const GARRISON_ORBIT_RADIUS = 300;

// Турельные HP-бары — фиксированный размер, не зависит от aspect базы. Экспортируется
// для GameScene._redrawMiningBaseBars() (см. там же, почему бары не Rectangle-объекты).
export const TBAR_W = 46, TBAR_H = 4;

// Боевая проекция ОДНОЙ турели — независимая от базы цель (как моб): свой hull/shield/
// pvpMobId, свой реген, killable без уничтожения самой базы. Визуал (спрайт/поворот/
// стрельба по мобам) остаётся у MiningBase — этот класс несёт только боевое состояние +
// форму, которую ждёт общий PvP-код GameScene (_onPvpMobHitResult, _fireCannon/_fireLaser,
// mobFireClaim): x/y/hull/maxHull/shield/maxShield/alive/canBeAttacked/pvpMobId/corp.
class TurretTarget {
  constructor(base, slotIdx, type) {
    this.base    = base;
    this.slotIdx = slotIdx;
    this.type    = type;
    this.isTurretTarget = true;

    const mult = pvpTierMult(base.pvpTier);
    this.maxHull   = (type === 'cannon2' ? BASE_CONFIG.turretHullMax.cannon2   : BASE_CONFIG.turretHullMax.cannon1)   * mult;
    this.maxShield = (type === 'cannon2' ? BASE_CONFIG.turretShieldMax.cannon2 : BASE_CONFIG.turretShieldMax.cannon1) * mult;
    this.hull         = this.maxHull;
    this.shield       = this.maxShield;
    this.lastDamageAt = -1e9;
    this.alive        = true;
  }

  // Смещение слота — доля от РЕАЛЬНОГО (aspect-корректного) размера базы этого корпа,
  // пересчитывается в MiningBase._recomputeTurretOffsets() при каждой смене corp/state
  // (см. там же, почему это больше не фиксированные пиксели).
  get x() { return this.base.x + (this.base._turretOffsets?.[this.slotIdx]?.x ?? 0); }
  get y() { return this.base.y + (this.base._turretOffsets?.[this.slotIdx]?.y ?? 0); }
  get corp() { return this.base.corp; }
  get canBeAttacked() { return this.alive && this.base.canBeAttacked; }

  // pvpMobId базы навешивается GameScene ПОСЛЕ конструктора MiningBase (нужен ещё не
  // готовый на тот момент this._realtimeRoomKey) — турели же создаются и раньше
  // (restore из registry в конструкторе базы), и позже (buyTurret в течение игры),
  // так что читаем текущее значение базы лениво, а не кэшируем на момент создания.
  get pvpMobId() {
    return this.base.pvpMobId ? `${this.base.pvpMobId}:turret:${this.slotIdx}` : null;
  }

  // Небольшая награда за уничтожение турели (см. TURRET_REWARD) — читается GameScene
  // тем же generic-путём, что и wagonReward у вагона поезда (см. mobFireClaim), просто
  // по имени поля: раньше турель этого геттера не имела вообще, поэтому урон по ней
  // доходил до сервера, но killed-ветка не отправляла никакой награды (баг из диалога:
  // "награда за уничтожение турелей... похоже что её нет ни для станций").
  get wagonReward() { return TURRET_REWARD[this.base.pvpTier] ?? TURRET_REWARD[1]; }

  applyState(saved) {
    if (!saved) return;
    this.hull         = saved.hull ?? this.hull;
    this.shield       = saved.shield ?? this.shield;
    this.lastDamageAt = saved.lastDamageAt ?? this.lastDamageAt;
  }

  // Локальный фоллбэк, когда pvpClient недоступен (DEV: "пропустить авторизацию" в
  // LoginScene сознательно не шлёт токен → WS/pvpClient никогда не поднимается — см.
  // GameScene._localPvpFireResolve). В обычной игре урон турели ВСЕГДА идёт через
  // сервер (turretFireClaim/mobFireClaim), это не вызывается.
  takeDamage(damage) {
    if (!this.canBeAttacked) return { hullHit: 0, shieldHit: 0, killed: false };
    this.lastDamageAt = this.base.scene.time.now;
    let dmg = Math.round(damage);
    let shieldHit = 0;
    if (this.shield > 0) {
      shieldHit = Math.min(dmg, this.shield);
      this.shield -= shieldHit;
      dmg -= shieldHit;
    }
    const hullHit = Math.min(dmg, this.hull);
    this.hull -= hullHit;
    const killed = this.hull <= 0;
    if (killed) { this.alive = false; this.base._onTurretDestroyed(this.slotIdx); }
    return { hullHit, shieldHit, killed };
  }

  update(dt, now) {
    if (!this.alive) return;
    const sinceDmg = now - this.lastDamageAt;
    if (this.maxShield > 0 && sinceDmg > SHIELD_REGEN_DELAY_MS && this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + this.maxShield * SHIELD_REGEN_PCT_SEC * dt);
    }
    if (sinceDmg > HULL_REGEN_DELAY_MS && this.hull < this.maxHull) {
      this.hull = Math.min(this.maxHull, this.hull + this.maxHull * HULL_REGEN_PCT_SEC * dt);
    }
  }
}

export default class MiningBase {
  static get registry() { return _registry; }

  constructor(scene, x, y, { id, pvpTier = 1, sector = null } = {}) {
    this.scene   = scene;
    this.x       = x;
    this.y       = y;
    this.id      = id || `base_${Math.round(x)}_${Math.round(y)}`;
    this.pvpTier = pvpTier;
    this.sector  = sector;
    // Детерминированное имя по id (стабильно между визитами без хранения на сервере,
    // см. stationNameKey в bases.js) — заменяет плейсхолдер "MINING STATION".
    this.stationName = i18n.t(stationNameKey(this.id));
    // Серверная (не только in-memory _registry) персистентность — см. applyPersistedState()
    // и _scheduleServerSave(); загрузка идёт асинхронно ПОСЛЕ конструктора
    // (GameScene._loadMiningBaseState), поэтому нужен флаг "уже применили" и защита
    // от применения к уже уничтоженному (сектор сменился) объекту.
    this._serverLoaded    = false;
    this._destroyed       = false;
    this._serverSaveTimer = null;
    // Отличаем от Mob/RemotePlayer в общем PvP-коде (_onPvpMobHitResult и т.п.) без
    // instanceof; pvpMobId навешивает GameScene.spawnMobs() после конструктора (нужен
    // this._realtimeRoomKey, которого MiningBase не знает).
    this.isMiningBase = true;
    // Урон по базе+турелям за текущую "жизнь" (с последнего buyBase до следующего
    // _onDestroyed) — имя игрока → суммарный урон, для бонуса захвата (см.
    // _applyCaptureBonus). Чисто эфемерно, не персистится (переживать релоад
    // посреди осады — не критично, см. диалог).
    this._damageBy = {};

    const saved = _registry.get(this.id);
    if (saved) {
      this.corp          = saved.corp;
      this.state         = saved.state;
      this.hull          = saved.hull;
      this.shield        = saved.shield ?? 0;
      this.lastDamageAt  = saved.lastDamageAt ?? -1e9;
      this.owners        = saved.owners.slice();
      this.pointsBanked  = saved.pointsBanked;
      this.goldBanked    = saved.goldBanked;
      this.turrets       = saved.turrets.slice();
      this._turretState  = (saved.turretState || Array(BASE_CONFIG.turretSlots).fill(null)).slice();
      this._neutralPhase = saved.neutralPhase || 'open';
      this._neutralPhaseEndsAt = this._neutralEndsAtFromSaved(saved);
      this._buildEndsAt  = this._buildEndsAtFromSaved(saved);
      this.hiredSecurity = saved.hiredSecurity || false;
    } else {
      this.corp          = 'neutral';
      this.state         = 'destroyed';
      this.hull          = 0;
      this.shield        = 0;
      this.lastDamageAt  = -1e9;
      this.owners        = [];
      this.pointsBanked  = 0;
      this.goldBanked    = 0;
      this.turrets       = Array(BASE_CONFIG.turretSlots).fill(null);
      this._turretState  = Array(BASE_CONFIG.turretSlots).fill(null);
      this._neutralPhase = 'open';
      this._neutralPhaseEndsAt = Date.now() + BASE_CONFIG.neutralOpenSec * 1000;
      this._buildEndsAt  = 0;
      this.hiredSecurity = false;
    }
    // Спавнится лениво из applyPersistedState()/hireSecurity() — ЭФЕМЕРНОЕ (не
    // персистится само по себе, только флаг hiredSecurity выше); { leader, drones }.
    this._garrison = null;

    // Боевые прокси турелей — отдельно от this.turrets (голые строки типа, которые
    // читает BaseMenuScene без изменений). Восстанавливаем hp/shield из _turretState.
    this.turretTargets = this.turrets.map((type, i) => {
      if (!type) return null;
      const tt = new TurretTarget(this, i, type);
      tt.applyState(this._turretState[i]);
      return tt;
    });

    this._earnTimer       = 0;
    this._labelTick       = 0;
    this._turretCooldowns = Array(BASE_CONFIG.turretSlots).fill(0);
    this._turretOffsets   = null; // computed in _createVisuals() below

    this._buildSprite   = null;
    this._baseSprite    = null;
    this._turretSprites = [];
    this._nameLabel     = null;
    this._stateLabel    = null;
    this._ownerLabel    = null;
    this._menuBtnBg     = null;
    this._menuBtnLbl    = null;
    this._zone          = null;

    this._createVisuals();
    // Гарнизон, нанятый ДО этого рестарта сцены — восстанавливаем сразу из
    // синхронного in-memory _registry (переживает scene.restart() внутри одной
    // вкладки, см. диалог про jumpgate-прыжки), не дожидаясь асинхронного
    // applyPersistedState() (тот покрывает только СВЕЖУЮ загрузку с сервера —
    // первый визит в сектор в этой вкладке/после релоада страницы). Без этой
    // строки наём "выживал" по флагу hiredSecurity, но сами мобы пропадали при
    // каждом прыжке туда-обратно внутри одной сессии.
    if (this.hiredSecurity) this._spawnHiredSecurity();
    this._persist();
  }

  // Таймеры базы (иммунитет/строительство) раньше хранились как "сколько секунд УЖЕ
  // прошло в этой фазе" (neutralTimer/buildTimer), и продвигались только внутри
  // update(dt) — т.е. ТОЛЬКО пока клиент реально в игре и рендерит кадры. Дисконнект/
  // закрытая вкладка полностью останавливали отсчёт, так что реальный час простоя
  // засчитывался как секунды факт. игрового времени (баг из диалога: "было 48 минут,
  // переподключился через час — 47"). Теперь это абсолютные timestamp'ы конца фазы
  // (Date.now() + остаток), которые не нужно "тикать" — сравнение с Date.now() само
  // отражает реально прошедшее время независимо от того, была ли вкладка открыта.
  // Миграция старых сохранений (только neutralTimer/buildTimer, без EndsAt) —
  // пересчитываем остаток ОТ ТЕКУЩЕГО момента, лучшее доступное приближение.
  _neutralEndsAtFromSaved(saved) {
    if (saved.neutralPhaseEndsAt) return saved.neutralPhaseEndsAt;
    const phase = saved.neutralPhase || 'open';
    const limit = phase === 'immune' ? BASE_CONFIG.neutralImmuneSec : BASE_CONFIG.neutralOpenSec;
    const elapsed = saved.neutralTimer || 0;
    return Date.now() + Math.max(0, limit - elapsed) * 1000;
  }

  _buildEndsAtFromSaved(saved) {
    if (saved.buildEndsAt) return saved.buildEndsAt;
    const elapsed = saved.buildTimer || 0;
    return Date.now() + Math.max(0, BASE_CONFIG.buildTimeSec - elapsed) * 1000;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  get alive() { return this.state === 'active'; }
  get canBeAttacked() {
    return this.alive && !(this.corp === 'neutral' && this._neutralPhase === 'immune');
  }

  // Прочность/щит масштабируются по pvp-тиру арены (см. pvpTierMult в bases.js) —
  // базовые значения в BASE_CONFIG заданы для pvp4/pvp5.
  get maxHull()   { return BASE_CONFIG.hullMax   * pvpTierMult(this.pvpTier); }
  get maxShield() { return BASE_CONFIG.shieldMax * pvpTierMult(this.pvpTier); }

  // Called by Projectile._hit() — must return {hullHit, shieldHit, killed}. На практике
  // мёртвый код для игроков (у базы всегда есть pvpMobId в реальном PvP-секторе, так что
  // урон идёт через mobFireClaim/сервер, не через takeDamage) — но держим корректным на
  // случай локального/оффлайн пути.
  takeDamage(damage) {
    if (!this.canBeAttacked) return { hullHit: 0, shieldHit: 0, killed: false };
    this.lastDamageAt = this.scene.time.now;
    let dmg = Math.round(damage);
    let shieldHit = 0;
    if (this.shield > 0) {
      shieldHit = Math.min(dmg, this.shield);
      this.shield -= shieldHit;
      dmg -= shieldHit;
    }
    const hullHit = Math.min(dmg, this.hull);
    this.hull -= hullHit;
    const killed = this.hull <= 0;
    if (killed) this._onDestroyed();
    return { hullHit, shieldHit, killed };
  }

  // Opens BaseMenuScene; called by menu button click or F key
  interact(playerName) {
    const gs = this.scene;
    // Fully stop the ship: clear waypoint, zero physics velocity, end boost/steer
    const p = gs.player;
    p.waypoint  = null;
    p.speed     = 0;
    p.boosting  = false;
    p.sprite?.body?.setVelocity(0, 0);
    gs.steering = false;
    gs.cancelCollect?.();
    if (gs.movement) {
      gs.movement.showArrow = false;
      gs.movement.courseArrow?.setVisible(false);
    }
    if (gs.scene.isActive('BaseMenuScene')) gs.scene.stop('BaseMenuScene');
    gs.scene.launch('BaseMenuScene', { base: this, playerName });
  }

  get speedUpCost() { return this.pvpTier >= 4 ? 20 : 10; }

  speedUpBuild(playerName) {
    const gs   = this.scene;
    const cost = this.speedUpCost;
    if (!this.owners.some(o => o.name === playerName)) {
      gs.log('Только владелец может ускорить строительство');
      return false;
    }
    if ((gs.starGold || 0) < cost) {
      gs.log(`Недостаточно ⭐ (нужно ${cost})`);
      return false;
    }
    gs.starGold -= cost;
    this.state = 'active';
    this.hull   = this.maxHull;
    this.shield = this.maxShield;
    this._buildEndsAt = Date.now();
    this._labelTick  = 0;
    this._refreshVisuals();
    this._persist();
    gs.log(`Строительство завершено за ${cost} ⭐!`);
    return true;
  }

  buyBase(playerName) {
    const gs = this.scene;
    if ((gs.credits || 0) < BASE_CONFIG.baseCostCredits) {
      gs.log(`Недостаточно кредитов (нужно ${BASE_CONFIG.baseCostCredits})`);
      return;
    }
    gs.credits -= BASE_CONFIG.baseCostCredits;
    // Corp from GameScene.playerCorp (set at scene init from prestige ship ownership).
    this.corp   = gs.playerCorp || 'neutral';
    this.state  = 'building';
    this.hull   = 0;
    this.shield = 0;
    // Покупатель НЕ становится владельцем автоматически и не получает очков —
    // владение появляется только через активную охрану (см. update()/_presentGuards);
    // если он останется рядом, войдёт в owners тем же путём, что и любой другой.
    this.owners = [];
    this._damageBy = {};
    this.turrets = Array(BASE_CONFIG.turretSlots).fill(null);
    this.turretTargets = Array(BASE_CONFIG.turretSlots).fill(null);
    this._buildEndsAt = Date.now() + BASE_CONFIG.buildTimeSec * 1000;
    this._refreshVisuals();
    this._persist();
    gs.gainCorpRep?.(0.05);
    gs.log(`База куплена (${this.corp}) — строится 15 мин`);
  }

  buyTurret(slotIdx, type, playerName) {
    if (this.state !== 'active') return;
    if (this.turrets[slotIdx] !== null) return;
    const gs = this.scene;
    // Как и speedUpBuild() — сервер-стороны эквивалента у нас нет (клиент-авторитетно),
    // так что проверка владения нужна ЗДЕСЬ, а не только скрытием кнопки в
    // BaseMenuScene (та кнопка вообще не рендерится не-владельцу, но buyTurret() сам
    // по себе не должен доверять любому вызывающему коду).
    if (!this.owners.some(o => o.name === playerName)) {
      gs.log('Только владелец может устанавливать турели');
      return;
    }
    if (type === 'cannon2') {
      const cost = cannon2GoldCost(this.pvpTier);
      if ((gs.starGold || 0) < cost) { gs.log(`Недостаточно ⭐ (нужно ${cost})`); return; }
      gs.starGold -= cost;
    } else {
      if ((gs.credits || 0) < BASE_CONFIG.turretCostCredits) {
        gs.log(`Недостаточно кредитов (нужно ${BASE_CONFIG.turretCostCredits})`);
        return;
      }
      gs.credits -= BASE_CONFIG.turretCostCredits;
    }
    this.turrets[slotIdx] = type;
    this.turretTargets[slotIdx] = new TurretTarget(this, slotIdx, type);
    this._refreshTurrets();
    this._persist();
    gs.log(`Турель ${type} установлена на слот ${slotIdx + 1}`);
  }

  // Турель уничтожена индивидуально (killed:true пришёл на её pvpMobId) — освобождаем
  // слот, саму базу это не трогает (в отличие от _onDestroyed, который сносит всё).
  _onTurretDestroyed(slotIdx) {
    this.turrets[slotIdx] = null;
    this.turretTargets[slotIdx] = null;
    this._refreshTurrets();
    this._persist();
    this.scene.log?.(`Турель уничтожена (слот ${slotIdx + 1})`);
  }

  // Корабль (sec_destroyer) стоит как турель 2 уровня (⭐), 3 дрона-эскорта — ещё
  // столько же (см. диалог) — итого 2×cannon2GoldCost(pvpTier). Разово, навсегда,
  // без подписки; погибший гарнизон можно нанять заново (см. _despawnGarrison).
  get hireSecurityCost() { return 2 * cannon2GoldCost(this.pvpTier); }

  hireSecurity(playerName) {
    if (this.state !== 'active') return false;
    if (this.hiredSecurity) return false;
    const gs = this.scene;
    // Как и buyTurret() — сервер-стороны эквивалента у нас нет (клиент-авторитетно),
    // так что проверка владения нужна ЗДЕСЬ, а не только скрытием кнопки в BaseMenuScene.
    if (!this.owners.some(o => o.name === playerName)) {
      gs.log('Только владелец может нанять охрану');
      return false;
    }
    const cost = this.hireSecurityCost;
    if ((gs.starGold || 0) < cost) { gs.log(`Недостаточно ⭐ (нужно ${cost})`); return false; }
    gs.starGold -= cost;
    this.hiredSecurity = true;
    this._spawnHiredSecurity();
    this._persist();
    gs.log(`Охрана нанята за ${cost} ⭐`);
    return true;
  }

  // Спавнит 1 sec_destroyer (лидер) + 3 sec_drone (эскорт, orbitLeader) на орбите
  // ВОКРУГ ЭТОЙ базы (не роятся по сектору, в отличие от старого автоматического
  // патруля). Сервер-авторитетный таргетинг обязателен для всех новых мобов (см.
  // диалог "да все новые мобы серверно управляемые") — registerMob(mobId, this.corp)
  // передаёт ownerCorp тем же путём, что и турели базы (_updateTurrets), сервер
  // фильтрует кандидатов на таргетинг, исключая игроков корпа-владельца. Без этого
  // GameScene.update()'s targetUid-фильтр (isArmoredTrainDrone/isWorldEvent) просто
  // не знал бы про этих мобов — добавлен isHiredSecurity туда же.
  _spawnHiredSecurity() {
    const gs = this.scene;
    if (this._garrison?.leader?.alive) return; // уже заспавнен в этой сессии клиента
    const level = Math.min(50, SECTORS[this.sector]?.lvlMax ?? this.pvpTier * 10 + 15);
    const angle0 = Math.random() * Math.PI * 2;
    const leader = new Mob(gs, MOBS.sec_destroyer, level,
      this.x + Math.cos(angle0) * GARRISON_ORBIT_RADIUS,
      this.y + Math.sin(angle0) * GARRISON_ORBIT_RADIUS,
      { behavior: 'patrol', patrolRadius: GARRISON_ORBIT_RADIUS, neutral: false });
    leader.isConfedBoss = true; // тот же star-gold pity-roll, что был у старого патруля
    leader.noRespawn    = true; // разовый найм, не авто-пополняющийся спавн
    gs.mobs.push(leader);

    const drones = [];
    for (let i = 0; i < 3; i++) {
      const drone = new Mob(gs, MOBS.sec_drone, level, leader.x, leader.y,
        { leader, orbitLeader: true, neutral: false });
      drone.noRespawn = true;
      gs.mobs.push(drone);
      drones.push(drone);
    }

    if (gs._realtimeRoomKey) {
      [leader, ...drones].forEach((m, i) => {
        m.pvpMobId = `${gs._realtimeRoomKey}:hiredsec:${this.id}:${i}`;
        m.isHiredSecurity = true;
        gs.pvpClient?.registerMob(m.pvpMobId, this.corp);
      });
    }

    this._garrison = { leader, drones };
  }

  // Гарнизон уничтожен (леший корабль погиб) ИЛИ база пала — освобождает наём,
  // владелец может нанять заново. Дроны без лидера не переживают (die() всех разом);
  // одиночная гибель дрона при живом лидере наём НЕ заканчивает (noRespawn — дрон
  // просто пропадает, найм остаётся активным до гибели именно лидера).
  _despawnGarrison() {
    if (!this._garrison) return;
    const { leader, drones } = this._garrison;
    if (leader?.alive) leader.die();
    drones.forEach(d => d?.alive && d.die());
    this._garrison = null;
  }

  // Игроки СВОЕГО корпа физически в радиусе guardRadius прямо сейчас — "охрана",
  // единственный источник владения/дохода (см. update()). Учитывает и локального
  // игрока, и остальных через уже известные RemotePlayer-позиции (реального списка
  // "кто ещё физически тут" сервер не ведёт — комната знает только позиции, не
  // радиусы; см. общий разговор про масштаб PvP-реалтайма).
  _presentGuards() {
    const gs = this.scene;
    const R = BASE_CONFIG.guardRadius;
    const names = [];
    const p = gs.player;
    if (p?.alive && p.x !== undefined && Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y) <= R
        && (gs.playerCorp || 'neutral') === this.corp) {
      names.push(gs.playerName);
    }
    for (const rp of gs.pvpClient?.players?.values() ?? []) {
      if (rp.alive && rp.corp === this.corp && Phaser.Math.Distance.Between(this.x, this.y, rp.x, rp.y) <= R) {
        names.push(rp.name);
      }
    }
    return names;
  }

  update(dt) {
    const gs  = this.scene;
    const now = gs.time.now;

    if (this.state === 'building') {
      // Абсолютный timestamp конца стройки (см. _buildEndsAtFromSaved) вместо
      // накопительного таймера — не "зависает", если вкладка была закрыта/в фоне
      // часть из 15 мин стройки (см. диалог про серверное/клиентское время).
      const remainMs = this._buildEndsAt - Date.now();
      const frac = Math.min(1, 1 - Math.max(0, remainMs) / (BASE_CONFIG.buildTimeSec * 1000));
      this.hull = Math.round(this.maxHull * frac);
      this._labelTick += dt;
      if (this._labelTick >= 1) { this._labelTick = 0; this._refreshStateLabel(); }
      if (remainMs <= 0) {
        this.state  = 'active';
        this.hull   = this.maxHull;
        this.shield = this.maxShield;
        this._refreshVisuals();
        this._persist();
        this.scene.log('База построена и активна!');
      }
    }

    // "Владелец" — не тот, кто купил (buyBase больше НЕ добавляет в owners), а тот,
    // кто физически охраняет: в радиусе guardRadius от базы (см. _presentGuards).
    // Регистрируем присутствие уже во время стройки (иначе никто не смог бы набрать
    // очки/попасть в owners к моменту, когда база станет активной и разрешит
    // speedUpBuild/buyTurret — обе проверяют owners), но НАЧИСЛЯЕМ очки/золото только
    // в 'active' — недостроенная база ничего не производит.
    if (this.state === 'building' || this.state === 'active') {
      this._earnTimer += dt;
      if (this._earnTimer >= 1) {
        this._earnTimer -= 1;
        const present = this._presentGuards();
        for (const name of present) {
          if (!this.owners.some(o => o.name === name)) this.owners.push({ name, points: 0, gold: 0 });
        }
        if (this.state === 'active' && present.length > 0) {
          // Делим секундный доход базы между СЕЙЧАС присутствующими, не между всеми
          // когда-либо отметившимися owners — иначе один случайный визитёр размывал
          // бы доход всем последующим настоящим охранникам навсегда.
          const share   = 1 / present.length;
          const goldSec = goldPerSecByTier(this.pvpTier);
          for (const name of present) {
            const o = this.owners.find(o => o.name === name);
            o.points += BASE_CONFIG.pointsPerSec * share;
            o.gold   += goldSec * share;
          }
          if (present.includes(gs.playerName)) gs.gainCorpRep?.(0.0002);
        }
        this._persist();
        this._refreshOwnerLabel();
        // Обратный отсчёт иммунитета/открытости (_refreshStateLabel) для АКТИВНОЙ базы
        // раньше не обновлялся вообще — _labelTick тикает только в состоянии 'building'
        // (см. выше), а для 'active' _refreshStateLabel звался только РАЗ на смену фазы
        // (см. ниже), т.е. цифра рисовалась один раз и висела статично весь цикл (30-60
        // мин) — выглядело как "таймер завис" (диалог). Переиспользуем уже существующий
        // посекундный тик earnTimer вместо отдельного таймера.
        if (this.corp === 'neutral') this._refreshStateLabel();
      }
    }

    if (this.state === 'active') {
      // Neutral immunity cycle — абсолютный timestamp конца фазы, не накопительный
      // таймер (см. комментарий у _neutralEndsAtFromSaved/buyBase выше).
      if (this.corp === 'neutral') {
        if (Date.now() >= this._neutralPhaseEndsAt) {
          this._neutralPhase = this._neutralPhase === 'open' ? 'immune' : 'open';
          const nextLimit = this._neutralPhase === 'open' ? BASE_CONFIG.neutralOpenSec : BASE_CONFIG.neutralImmuneSec;
          this._neutralPhaseEndsAt = Date.now() + nextLimit * 1000;
          this._refreshStateLabel();
          this._persist();
        }
      }

      // Реген щита/прочности базы (см. константы вверху файла — те же ставки для
      // базы и турелей, запрошены пользователем отдельно от урона).
      const sinceDmg = now - this.lastDamageAt;
      if (this.maxShield > 0 && sinceDmg > SHIELD_REGEN_DELAY_MS && this.shield < this.maxShield) {
        this.shield = Math.min(this.maxShield, this.shield + this.maxShield * SHIELD_REGEN_PCT_SEC * dt);
      }
      if (sinceDmg > HULL_REGEN_DELAY_MS && this.hull < this.maxHull) {
        this.hull = Math.min(this.maxHull, this.hull + this.maxHull * HULL_REGEN_PCT_SEC * dt);
      }

      for (const tt of this.turretTargets) tt?.update(dt, now);

      // Гарнизон потерян (лидер погиб) — освобождаем наём, владелец может нанять
      // заново (см. hireSecurity/_spawnHiredSecurity выше).
      if (this.hiredSecurity && this._garrison && !this._garrison.leader?.alive) {
        this.hiredSecurity = false;
        this._despawnGarrison();
        this._persist();
        gs.log?.('Охрана базы уничтожена — можно нанять заново');
      }

      this._updateTurrets(dt);
      // Бары базы/турелей больше не свои Rectangle-объекты — рисуются одним общим
      // канвасом в GameScene._redrawMiningBaseBars() (читает live hull/shield каждый
      // кадр напрямую, включая PvP-попадания извне через _onPvpMobHitResult).
    }
  }

  destroy() {
    this._destroyed = true;
    if (this._serverSaveTimer) { this._serverSaveTimer.remove(); this._serverSaveTimer = null; }
    [this._buildSprite, this._baseSprite,
     this._nameLabel, this._stateLabel, this._ownerLabel,
     this._menuBtnBg, this._menuBtnLbl, this._zone]
      .forEach(o => o?.destroy());
    this._turretSprites.forEach(t => t?.destroy());
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  // Высота = targetH, ширина сохраняет РЕАЛЬНОЕ соотношение сторон загруженной
  // текстуры — раньше setDisplaySize(sz,sz) принудительно тянул/сжимал ЛЮБУЮ
  // текстуру под квадрат, что визуально растягивало по горизонтали некв адратные
  // скины баз (helios 460×512, у остальных другие пропорции — и это будет меняться
  // при каждой замене арта, как только что произошло с karax: 433×512 → 1182×1331).
  // Считаем из РЕАЛЬНЫХ размеров загруженной текстуры, не из хардкода — переживёт
  // будущие замены ассетов без повторной калибровки.
  _fitSize(textureKey, targetH) {
    if (!textureKey || !this.scene.textures.exists(textureKey)) return { w: targetH, h: targetH };
    const src = this.scene.textures.get(textureKey).getSourceImage();
    return { w: Math.round(targetH * src.width / src.height), h: targetH };
  }

  // turretSlotsFor(corp) хранит доли (fx/fy) от половины ширины/высоты АКТИВНОЙ
  // текстуры — своя раскладка на каждый корп (не только разная ширина скина, но и
  // РАЗНАЯ компоновка подов, см. bases.js), пересчитываем при каждой смене corp/state.
  _recomputeTurretOffsets() {
    const assets = CORP_ASSETS[this.corp] || CORP_ASSETS.neutral;
    const { w, h } = this._fitSize(assets.base, BASE_CONFIG.displaySize);
    this._turretOffsets = turretSlotsFor(this.corp).map(s => ({ x: s.fx * w / 2, y: s.fy * h / 2 }));
  }

  // Двигает уже существующие спрайты турелей на пересчитанные offsets — нужно при
  // смене corp (разная ширина/раскладка скина), не только при первом создании. Бары
  // не хранят позицию сами — GameScene._redrawMiningBaseBars() читает _turretOffsets
  // напрямую каждый кадр.
  _repositionTurrets() {
    this._turretOffsets.forEach((off, i) => {
      this._turretSprites[i]?.setPosition(this.x + off.x, this.y + off.y);
    });
  }

  _createVisuals() {
    const { x, y } = this;
    this._recomputeTurretOffsets(); // needed before positioning turret sprites/bars below
    const sz  = BASE_CONFIG.displaySize;       // 460 — active / building (HEIGHT reference)
    const szD = BASE_CONFIG.displayDestroyed;  // 340 — destroyed (smaller, dimmed)
    const tsz = BASE_CONFIG.turretSize;

    // Faint capture-zone circle
    this._zone = this.scene.add.circle(x, y, BASE_CONFIG.captureRadius, 0x4dd0e1, 0.04)
      .setDepth(-5);

    // Building-state sprite
    const buildSize = this._fitSize('base_building', sz);
    this._buildSprite = this.scene.add.image(x, y, 'base_building')
      .setDisplaySize(buildSize.w, buildSize.h).setDepth(5).setVisible(false);

    // Active / destroyed sprite (texture + size swapped on state change)
    const destroyedSize = this._fitSize('base_destroyed', szD);
    this._baseSprite = this.scene.add.image(x, y, 'base_destroyed')
      .setDisplaySize(destroyedSize.w, destroyedSize.h).setDepth(5).setVisible(false);

    // Turret sprites — positioned at slot offsets, hidden until slot is built
    this._turretSprites = this._turretOffsets.map((off, i) =>
      this.scene.add.image(x + off.x, y + off.y, 'cannon1_neutral')
        .setDisplaySize(tsz, tsz).setDepth(6).setVisible(false)
    );

    // DEV-only: перетаскивание турелей мышью для визуальной калибровки offsets — временно
    // отключено по просьбе. Раскомментировать для следующей калибровочной сессии (жми 'L'
    // — см. GameScene DEV-хоткеи — выведет готовый массив слотов этого корпа в консоль).
    /*
    if (this.scene.devMode) {
      this._turretSprites.forEach((spr, i) => {
        spr.setInteractive({ useHandCursor: true });
        this.scene.input.setDraggable(spr, true);
        spr.on('drag', (pointer, dragX, dragY) => {
          this._turretOffsets[i] = { x: dragX - this.x, y: dragY - this.y };
          this._repositionTurrets();
        });
      });
    }
    */

    // HP/shield-бары базы и турелей рисуются НЕ здесь — раньше каждая база держала
    // ~21 отдельных Rectangle-объекта (свой бар ×3 + 6 турелей ×3), и Phaser платит
    // фиксированный WebGL render-overhead ЗА ОБЪЕКТ каждый кадр независимо от того,
    // менялось ли что-то (та же причина, по которой раньше консолидировали мобовские
    // бары в GameScene.mobBarsGfx — см. тот коммит). Теперь один общий канвас на ВСЕ
    // базы сразу: GameScene._redrawMiningBaseBars().

    // Мировая камера зумится на DPR (см. GameScene: setZoom(DPR)) — этот текст рисуется
    // в МИРОВЫХ координатах (в отличие от HUD, где камера всегда zoom=1), так что весь
    // UI_RES-запас резкости съедается зумом камеры обратно (эффективная плотность
    // получается UI_RES/DPR вместо UI_RES). ×DPR компенсирует это — тот же приём, что
    // уже используют турели/корабли под тем же зумом (см. комментарий в _refreshTurrets
    // про displaySize×2 и prerenderTex) — иначе имя станции/статус/бары выглядят мыльно
    // (баг из диалога со скриншотом: "улучшить качество шрифта в меню добывающей базы").
    const tf = { fontFamily: 'Orbitron', fontSize: '16px', color: '#4dd0e1', resolution: UI_RES * DPR };

    // Station name — above HP bar
    const namY = y - sz / 2 - 42;
    this._nameLabel = this.scene.add.text(x, namY, this.stationName,
      { ...tf, fontSize: '18px' }).setOrigin(0.5).setDepth(7);

    // State label — below base sprite
    const stY = y + sz / 2 + 20;
    this._stateLabel = this.scene.add.text(x, stY, '',
      { ...tf, fontSize: '13px', color: '#ffb74d' }).setOrigin(0.5).setDepth(7);

    // Top-3 owner strip
    const owY = y + sz / 2 + 40;
    this._ownerLabel = this.scene.add.text(x, owY, '',
      { ...tf, fontSize: '12px', color: '#aaaacc' }).setOrigin(0.5).setDepth(7);

    // In-world menu button — always visible, opens BaseMenuScene on click
    const btnY = y + sz / 2 + 68;
    this._menuBtnBg = this.scene.add.rectangle(x, btnY, 182, 30, 0x0d1a26, 0.92)
      .setDepth(8).setStrokeStyle(1, 0x4dd0e1, 0.9).setInteractive({ useHandCursor: true });
    this._menuBtnLbl = this.scene.add.text(x, btnY, '[ МЕНЮ БАЗЫ ]',
      { ...tf, fontSize: '13px', color: '#80deea' }).setOrigin(0.5).setDepth(9);

    this._menuBtnBg.on('pointerdown', (pointer, lx, ly, event) => {
      if (event) event.stopPropagation();
      this.interact(this.scene.playerName);
    });

    this._refreshVisuals();
  }

  _refreshVisuals() {
    const s      = this.state;
    const assets = CORP_ASSETS[this.corp] || CORP_ASSETS.neutral;
    const sz     = BASE_CONFIG.displaySize;
    const szD    = BASE_CONFIG.displayDestroyed;

    this._buildSprite.setVisible(s === 'building');
    this._baseSprite.setVisible(s === 'active' || s === 'destroyed');

    if (s === 'destroyed') {
      const dSize = this._fitSize('base_destroyed', szD);
      this._baseSprite.setTexture('base_destroyed').setDisplaySize(dSize.w, dSize.h).setAlpha(0.55);
    } else if (s === 'active') {
      const aSize = this._fitSize(assets.base, sz);
      this._baseSprite.setTexture(assets.base).setDisplaySize(aSize.w, aSize.h).setAlpha(1);
    } else { // building
      const bSize = this._fitSize('base_building', sz);
      this._buildSprite.setDisplaySize(bSize.w, bSize.h);
    }

    // Corp (and hence active-texture aspect) may have changed — re-derive turret slot
    // positions and move already-created sprites there (bars read offsets live, see
    // GameScene._redrawMiningBaseBars()).
    this._recomputeTurretOffsets();
    this._repositionTurrets();

    this._refreshTurrets();
    this._refreshStateLabel();
    this._refreshOwnerLabel();
  }

  _refreshTurrets() {
    const assets = CORP_ASSETS[this.corp] || CORP_ASSETS.neutral;
    const tsz = BASE_CONFIG.turretSize;
    this.turrets.forEach((type, i) => {
      const spr = this._turretSprites[i];
      if (!spr) return;
      if (type && this.state === 'active') {
        const rawKey = type === 'cannon2' ? assets.cannon2 : assets.cannon1;
        // Как и у базы (_fitSize) — принудительный квадрат setDisplaySize(tsz,tsz) без
        // учёта нативного aspect турели растягивал картинку. Фиттим по ВЫСОТЕ (h=tsz
        // всегда), ширина считается по aspect — HP-бар ниже турели (_repositionTurrets,
        // смещение tsz/2) остаётся верным, т.к. высота не меняется, только ширина.
        const { w, h } = this._fitSize(rawKey, tsz);
        // Мировая камера зумится на DPR (см. GameScene: setZoom(DPR)) — спрайт с
        // displaySize=tsz реально занимает tsz*DPR экранных пикселей, так что текстура
        // должна нести БОЛЬШЕ tsz исходных пикселей, иначе Phaser апскейлит её при
        // рендере и получается мыло. Корабли учитывают это уже (BootScene:
        // prepShipTex(..., displaySize*2) — тот же ×2 запас на макс. DPR=2 в этом
        // проекте, см. constants.js). Пробовали привязать к реальному DPR вместо
        // максимума — вращающиеся турели заметно теряли резкость, откачено.
        const key = prerenderTex(this.scene, rawKey, w * 2, h * 2);
        // Origin ≠ (0.5,0.5): центр bbox текстуры — НЕ центр круглого основания турели
        // (ствол торчит вверх асимметрично), см. TURRET_ORIGIN в bases.js. Без этого и
        // позиция, и поворот к цели (_updateTurrets) крутились вокруг пустоты над стволом.
        const oy = TURRET_ORIGIN[this.corp]?.[type] ?? 0.5;
        spr.setTexture(key).setDisplaySize(w, h).setOrigin(0.5, oy).setVisible(true);
      } else {
        spr.setVisible(false);
      }
    });
  }

  _refreshStateLabel() {
    if (this.state === 'destroyed') {
      this._stateLabel.setText('[ РАЗРУШЕНА ]');
    } else if (this.state === 'building') {
      const rem = Math.ceil(Math.max(0, this._buildEndsAt - Date.now()) / 1000);
      const m = Math.floor(rem / 60), s = rem % 60;
      this._stateLabel.setText(`СТРОИТСЯ — ${m}:${String(s).padStart(2, '0')}`);
    } else if (this.corp === 'neutral') {
      // Обратный отсчёт до смены фазы (открыта↔иммунитет, см. update()) — раньше
      // фаза была видна, но НЕ было понятно, сколько осталось до открытия/закрытия,
      // выглядело как "непонятно, застряло это или нет" (см. диалог).
      const remSec = Math.max(0, Math.ceil((this._neutralPhaseEndsAt - Date.now()) / 1000));
      const mm = Math.floor(remSec / 60), ss = remSec % 60;
      const timeStr = `${mm}:${String(ss).padStart(2, '0')}`;
      this._stateLabel.setText(
        this._neutralPhase === 'immune' ? `НЕЙТРАЛЬНА (иммунитет) — ${timeStr}` : `НЕЙТРАЛЬНА (открыта) — ${timeStr}`
      );
    } else {
      this._stateLabel.setText(`АКТИВНА · ${this.corp.toUpperCase()}`);
    }
  }

  _refreshOwnerLabel() {
    if (!this.owners.length) { this._ownerLabel.setText(''); return; }
    const top = this.owners.slice(0, 3)
      .map(o => `${o.name}: ${Math.floor(o.points)} очк`).join('  ');
    this._ownerLabel.setText(top);
  }

  _updateTurrets(dt) {
    const gs     = this.scene;
    const mobs   = gs.mobs || [];
    const player = gs.player;
    // "База атакует" на практике = её турели атакуют (сама база безоружна) — враждебна
    // любому не-своему игроку, той же логике, что и наоборот (см. GameScene._fireCannon/
    // _fireLaser: "t.corp === this.playerCorp" — единственное исключение, свой корпус).
    const playerHostile = !!(player?.alive && this.corp !== (gs.playerCorp || 'neutral'));

    this.turrets.forEach((type, i) => {
      if (!type || !this.turretTargets[i]?.alive) return;
      const tt = this.turretTargets[i];
      // Сервер-авторитетный таргетинг (План Фаза 3) — регистрируем/обновляем ownerCorp
      // лениво ЗДЕСЬ, а не в конструкторе TurretTarget: base.pvpMobId ещё не готов на
      // момент создания турели (см. TurretTarget.pvpMobId), да и corp базы может
      // смениться при перезахвате — шлём заново, только когда реально изменилось (не
      // каждый кадр), сервер обновит фильтр кандидатов на месте (см.
      // ServerMobManager.spawn на сервере).
      if (tt.pvpMobId && tt._registeredCorp !== this.corp) {
        gs.pvpClient?.registerMob(tt.pvpMobId, this.corp);
        tt._registeredCorp = this.corp;
      }

      const range   = type === 'cannon2' ? BASE_CONFIG.cannon2Range  : BASE_CONFIG.cannon1Range;
      const damage  = (type === 'cannon2' ? BASE_CONFIG.cannon2Damage : BASE_CONFIG.cannon1Damage)
        * pvpTierMult(this.pvpTier);
      const rateInv = type === 'cannon2'
        ? 1 / BASE_CONFIG.cannon2Rate
        : 1 / BASE_CONFIG.cannon1Rate;
      const boltCount = type === 'cannon2' ? 2 : 1;

      this._turretCooldowns[i] -= dt;

      const off = this._turretOffsets[i];
      const tx = this.x + off.x;
      const ty = this.y + off.y;

      // Find nearest alive mob in range — every frame, not just on the fire tick,
      // so rotation below can track it smoothly between shots. Player is just another
      // candidate here (if hostile) — turrets pick whichever is closest.
      let nearest = null, nearestDist = range;
      for (const mob of mobs) {
        // Дроны охраны бронепоезда — цель игроков (событие завязано на игроков,
        // убивающих их вручную ради волны/наград), не еда для турелей баз — иначе
        // база бесплатно фармит волну дронов раньше, чем игроки успевают до них дойти.
        if (!mob.alive || mob.isArmoredTrainDrone) continue;
        const d = Phaser.Math.Distance.Between(tx, ty, mob.x, mob.y);
        if (d < nearestDist) { nearest = mob; nearestDist = d; }
      }
      if (playerHostile) {
        const d = Phaser.Math.Distance.Between(tx, ty, player.x, player.y);
        if (d < nearestDist) { nearest = player; nearestDist = d; }
      }

      // Сервер-авторитетный таргетинг (План Фаза 3): если сервер в этот тик назначил
      // ЭТУ турель другому игроку комнаты — ствол ВСЁ РАВНО должен визуально довернуться
      // на реального адресата (RemotePlayer), не замереть на месте (баг из диалога: "нет
      // поворота башни в сторону другого игрока") — реальный ВЫСТРЕЛ (ниже) остаётся
      // только у клиента настоящей цели, см. iAmTarget. Обычных мобов (nearest !== player)
      // не касается — их HP уже общий (PvpMobState), отдельного таргетинга по игрокам там нет.
      let iAmTarget = true;
      if (nearest === player) {
        const targets = gs._serverMobTargets;
        if (tt.pvpMobId && targets) {
          const targetUid = targets[tt.pvpMobId];
          if (targetUid !== undefined && targetUid !== gs.myUserId) {
            iAmTarget = false;
            nearest = gs.pvpClient?.players?.get(targetUid) || null;
          }
        }
      }

      // Turn turret art toward target gradually (sprites drawn nose-up → +π/2
      // offset) — setRotation() only on the fire tick made the barrel visibly
      // snap once per cooldown (1s) instead of tracking smoothly every frame.
      const spr = this._turretSprites[i];
      if (spr?.visible && nearest) {
        const targetAngle = Math.atan2(nearest.y - ty, nearest.x - tx) + Math.PI / 2;
        const diff = Phaser.Math.Angle.Wrap(targetAngle - spr.rotation);
        const maxStep = 6 * dt; // rad/sec turn rate
        spr.rotation += Phaser.Math.Clamp(diff, -maxStep, maxStep);
      }

      if (!nearest || this._turretCooldowns[i] > 0) return;
      this._turretCooldowns[i] = rateInv;
      if (!iAmTarget) return; // визуал (доворот/КД) отыгран, реальный выстрел — только у клиента настоящей цели

      if (nearest === player) {
        // Урон по игроку — как у обычных мобов (Player.takeDamage авторитетен для
        // своего же клиента, сервер тут не нужен — та же модель, что и урон от NPC),
        // через готовый пайплайн fireMobWeapon (снаряд/крит/хитрезолв/шейк/лог щита),
        // не через turretFireClaim/mobFireClaim (это только для общих PvpMobState-целей).
        // pvpMobId — нужен fireMobWeapon для relay "меня атакует турель X" остальным
        // игрокам комнаты (см. pvp_mob_attack_vfx, баг из диалога "второй игрок не видит").
        gs.fireMobWeapon?.(
          { x: tx, y: ty, damage, isBoss: false, tpl: { projectileType: 'plasma' }, pvpMobId: tt.pvpMobId },
          player.x, player.y, player,
        );
        return;
      }

      // Скоростной болт (см. GameScene._fireVisualBolt — тот же спрайт/скорость,
      // что и у выстрелов игрока) — раньше был только muzzleFlash в точке турели,
      // сам летящий снаряд к цели не рисовался. cannon2 стреляет двумя болтами
      // (визуальный стиль "спаренной" пушки), cannon1 — одним.
      const angle = Math.atan2(nearest.y - ty, nearest.x - tx);
      const perpX = -Math.sin(angle), perpY = Math.cos(angle);
      const boltColor = type === 'cannon2' ? 0xff6a00 : 0xffaa44;
      for (let bIdx = 0; bIdx < boltCount; bIdx++) {
        const boltOff = boltCount === 1 ? 0 : (bIdx === 0 ? -7 : 7);
        gs._fireVisualBolt?.(tx + perpX * boltOff, ty + perpY * boltOff, nearest.x + perpX * boltOff, nearest.y + perpY * boltOff, boltColor);
      }
      gs.muzzleFlash?.(tx, ty, 0xffaa44);

      if (nearest.pvpMobId && gs.pvpClient) {
        // Общий моб реалтайм-комнаты — залп идёт через turretFireClaim, НЕ через
        // локальный takeDamage (иначе урон турели видел бы только этот клиент,
        // и мог бы "ожить" мобу, которого уже убили другие — см. Mob-баг выше).
        // turretId = id базы + слот — стабилен, сервер дедуплицирует по нему
        // независимые заявки всех клиентов, видящих эту же турель.
        gs.pvpClient.turretFireClaim(
          `${this.id}:${i}`, nearest.pvpMobId, nearest.maxHull, nearest.maxShield,
          nearest.x, nearest.y, tx, ty, type, damage, this.pvpTier,
        );
      } else {
        // pvpClient недоступен (DEV без логина, см. GameScene._localPvpFireResolve)
        // или моб без pvpMobId (не PvP-сектор) — считаем локально.
        const res = nearest.takeDamage(damage, 0);
        if (res.killed) gs.onMobKilled?.(nearest);
      }
    });
  }

  // Бонус захвата: "как будто отохраняли 1 час", делится пропорционально суммарному
  // урону по базе+турелям за текущую жизнь базы (this._damageBy, см.
  // GameScene._onPvpMobHitResult/_localPvpFireResolve → _recordDamageContribution).
  // Добавляется владельцам ДО итоговой выплаты (_payoutTop10) — на практике почти
  // всегда становится самой выплатой, т.к. захват = мгновенное разрушение = payout.
  _applyCaptureBonus() {
    const entries = Object.entries(this._damageBy || {});
    const totalDmg = entries.reduce((s, [, d]) => s + d, 0);
    if (totalDmg <= 0) return;
    const bonusPoints = BASE_CONFIG.pointsPerSec * 3600;
    const bonusGold   = goldPerSecByTier(this.pvpTier) * 3600;
    for (const [name, dmg] of entries) {
      const share = dmg / totalDmg;
      let o = this.owners.find(o => o.name === name);
      if (!o) { o = { name, points: 0, gold: 0 }; this.owners.push(o); }
      o.points += bonusPoints * share;
      o.gold   += bonusGold * share;
    }
    this._damageBy = {};
  }

  // Урон по базе+турелям — для бонуса захвата (см. _applyCaptureBonus). Вызывается
  // извне (GameScene), т.к. именно там известно, КТО стрелял (attackerUserId/имя).
  _recordDamageContribution(name, amount) {
    if (!name || !(amount > 0)) return;
    this._damageBy[name] = (this._damageBy[name] || 0) + amount;
  }

  // Выплата при утрате контроля (уничтожение врагами ИЛИ еженедельный респаун) —
  // только ТОП-10 по очкам среди накопивших хоть что-то реально получают награду
  // (если очки есть у 20 игроков — награда первым 10 по очкам, остальным ничего).
  _payoutTop10() {
    const gs = this.scene;
    const ranked = this.owners.slice().sort((a, b) => b.points - a.points).slice(0, BASE_CONFIG.maxOwners);
    for (const o of ranked) {
      this.pointsBanked += o.points;
      this.goldBanked   += o.gold;
    }
    const myOwner = ranked.find(o => o.name === gs.playerName);
    if (myOwner) {
      const goldEarned = Math.floor(myOwner.gold);
      if (goldEarned > 0) {
        gs.starGold = (gs.starGold || 0) + goldEarned;
        gs.log(`Награда за владение базой: +${goldEarned} ⭐`);
      }
      // Честь по базам — просто равна добытому золоту (см. диалог: "честь = добытому
      // золоту, округлять математически"), не отдельная формула с тирами как у боссов/
      // PvP — независимое от goldEarned округление (Math.round, не floor).
      const honorGain = Math.round(myOwner.gold);
      if (honorGain > 0) gs.gainHonor?.(honorGain);
      if (goldEarned > 0) gs.advanceMissionsByEvent?.('base_control', obj => !obj.sector || obj.sector === this.sector);
    }
  }

  _onDestroyed() {
    this._applyCaptureBonus();
    this._payoutTop10();
    const gs = this.scene;
    gs.explosion?.(this.x, this.y, 2.0);
    gs.log('Добывающая база разрушена!');
    this.state  = 'destroyed';
    this.hull   = 0;
    this.shield = 0;
    this.corp   = 'neutral';
    this.owners = [];
    this.turrets = Array(BASE_CONFIG.turretSlots).fill(null);
    this.turretTargets = Array(BASE_CONFIG.turretSlots).fill(null);
    this._neutralPhase = 'open';
    this._neutralPhaseEndsAt = Date.now() + BASE_CONFIG.neutralOpenSec * 1000;
    this.hiredSecurity = false;
    this._despawnGarrison();
    this._refreshVisuals();
    this._persist();
    if (gs.scene.isActive('BaseMenuScene')) gs.scene.stop('BaseMenuScene');
  }

  // Сбрасывает базу в нейтральное активное состояние (еженедельный респаун) — тоже
  // "утрата контроля", те же топ-10 выплачиваются (см. _payoutTop10); это не бой,
  // так что бонуса захвата (_applyCaptureBonus) здесь нет.
  resetToNeutral() {
    this._payoutTop10();
    this.corp          = 'neutral';
    this.state         = 'active';
    this.hull          = this.maxHull;
    this.shield        = this.maxShield;
    this.owners        = [];
    this._damageBy     = {};
    this.pointsBanked  = 0;
    this.goldBanked    = 0;
    this.turrets       = Array(BASE_CONFIG.turretSlots).fill(null);
    this.turretTargets = Array(BASE_CONFIG.turretSlots).fill(null);
    this._neutralPhase = 'open';
    this._neutralPhaseEndsAt = Date.now() + BASE_CONFIG.neutralOpenSec * 1000;
    this._buildEndsAt  = 0;
    this.hiredSecurity = false;
    this._despawnGarrison();
    this._refreshVisuals();
    this._persist();
  }

  // DEV: мгновенно "строит" эту базу под указанную корпорацию с фиксированным
  // тестовым набором турелей (3×Cannon I + 3×Cannon II, все 6 слотов) — см. GameScene
  // keydown-R на pvp_4 ("Нейтральная Зона"), нужно для проверки ассетов/калибровки
  // турелей сразу на всех 4 корп-скинах без ручного buyBase/buyTurret по кругу.
  devForceSetup(corp, playerName) {
    this.corp   = corp;
    this.state  = 'active';
    // Владелец — только у базы СВОЕГО корпа игрока; остальные 3 — чужие/нейтральные
    // (owners=[]), иначе isOwner в BaseMenuScene был бы true везде и не давал бы
    // проверить "меню чужой базы открывается, но ничего в нём не нажать".
    const gs = this.scene;
    this.owners = (corp === (gs.playerCorp || 'neutral')) ? [{ name: playerName, points: 0, gold: 0 }] : [];
    this.turrets = ['cannon1', 'cannon1', 'cannon1', 'cannon2', 'cannon2', 'cannon2'];
    this._buildEndsAt  = 0;
    this._neutralPhase = 'open';
    this._neutralPhaseEndsAt = Date.now() + BASE_CONFIG.neutralOpenSec * 1000;
    this.hull   = this.maxHull;
    this.shield = this.maxShield;
    this.turretTargets = this.turrets.map((type, i) => type ? new TurretTarget(this, i, type) : null);
    this._recomputeTurretOffsets();
    this._refreshVisuals();
    this._refreshTurrets();
    this._persist();
  }

  // DEV: печатает текущие смещения турелей (после ручной перетаскиванием калибровки,
  // см. _createVisuals()) как доли half-width/half-height ЭТОЙ базы — готовый массив
  // слотов для TURRET_SLOTS_BY_CORP[this.corp] в bases.js. Хоткей 'L' (GameScene).
  dumpTurretSlots() {
    const assets = CORP_ASSETS[this.corp] || CORP_ASSETS.neutral;
    const { w, h } = this._fitSize(assets.base, BASE_CONFIG.displaySize);
    const slots = this._turretOffsets.map(o => ({ fx: o.x / (w / 2), fy: o.y / (h / 2) }));
    const pad = (n) => (n >= 0 ? ' ' : '') + n.toFixed(3);
    const text = `${this.corp}: [\n`
      + slots.map(s => `    { fx: ${pad(s.fx)}, fy: ${pad(s.fy)} },`).join('\n')
      + '\n  ],';
    console.log(`[turret-calib] ${this.id} (${this.corp}, ${w}x${h}):\n${text}`);
    this.scene.log?.(`Калибровка турелей (${this.corp}) выведена в консоль — F12`);
  }

  _persist() {
    _registry.set(this.id, {
      corp:         this.corp,
      state:        this.state,
      hull:         this.hull,
      shield:       this.shield,
      lastDamageAt: this.lastDamageAt,
      owners:       this.owners.map(o => ({ ...o })),
      pointsBanked: this.pointsBanked,
      goldBanked:   this.goldBanked,
      turrets:      this.turrets.slice(),
      turretState:  this.turretTargets.map(tt => tt
        ? { hull: tt.hull, shield: tt.shield, lastDamageAt: tt.lastDamageAt }
        : null),
      neutralPhase: this._neutralPhase,
      neutralPhaseEndsAt: this._neutralPhaseEndsAt,
      buildEndsAt:  this._buildEndsAt,
      hiredSecurity: this.hiredSecurity,
    });
    this._scheduleServerSave();
  }

  // Дебаунс сетевого сохранения: _persist() дёргается вплоть до раза в секунду (тик
  // начисления очков владельцам), гонять POST на каждый такой вызов незачем — копим
  // изменения 2 сек и шлём один снапшот текущего _registry-состояния.
  _scheduleServerSave() {
    if (this._serverSaveTimer || this._destroyed || !this.sector) return;
    this._serverSaveTimer = this.scene.time.delayedCall(2000, () => {
      this._serverSaveTimer = null;
      if (this._destroyed) return;
      const saved = _registry.get(this.id);
      if (saved) miningBaseSave(this.id, this.sector, saved).catch(() => {});
    });
  }

  // Применяет состояние, загруженное с сервера (GameScene._loadMiningBaseState) —
  // ПОСЛЕ синхронного конструктора с дефолтами, т.к. фетч асинхронный, а спавн баз в
  // spawnMobs() блокировать нельзя. _serverLoaded защищает от повторного применения.
  applyPersistedState(saved) {
    if (this._destroyed || this._serverLoaded) return;
    this._serverLoaded = true;
    this.corp          = saved.corp;
    this.state         = saved.state;
    this.hull          = saved.hull;
    this.shield        = saved.shield ?? 0;
    this.lastDamageAt  = saved.lastDamageAt ?? -1e9;
    this.owners        = (saved.owners || []).slice();
    this.pointsBanked  = saved.pointsBanked || 0;
    this.goldBanked    = saved.goldBanked || 0;
    this.turrets       = (saved.turrets || Array(BASE_CONFIG.turretSlots).fill(null)).slice();
    this._turretState  = (saved.turretState || Array(BASE_CONFIG.turretSlots).fill(null)).slice();
    this._neutralPhase = saved.neutralPhase || 'open';
    this._neutralPhaseEndsAt = this._neutralEndsAtFromSaved(saved);
    this._buildEndsAt  = this._buildEndsAtFromSaved(saved);
    this.hiredSecurity = saved.hiredSecurity || false;

    this.turretTargets.forEach(tt => tt && (tt.alive = false));
    this.turretTargets = this.turrets.map((type, i) => {
      if (!type) return null;
      const tt = new TurretTarget(this, i, type);
      tt.applyState(this._turretState[i]);
      return tt;
    });

    this._recomputeTurretOffsets();
    this._refreshVisuals();
    this._refreshTurrets();
    // Гарнизон, нанятый ДО этого визита (сохранён на сервере) — респавним его на этом
    // клиенте, иначе после релогина/рестарта сцены наём оставался бы "оплачен", но
    // невидим (мобов больше нет в памяти этого конкретного клиента).
    if (this.hiredSecurity) this._spawnHiredSecurity();
    this._persist();
  }
}
