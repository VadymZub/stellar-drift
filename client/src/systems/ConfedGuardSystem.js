import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import Mob from '../entities/Mob.js';
import { MOBS } from '../constants.js';
import { galaxy } from '../galaxy.js';

// Spawn intervals in seconds
const MAIN_INTERVAL  = 600;  // 10 min — main guard cycle
const DRONE_CD_MAIN  = 120;  // 2 min — drone cycle
const MAX_DRONES     = 2;
const BASE_GUARD_RAD = 380;  // px — player within this triggers aggro
const ORBIT_RADIUS   = 300;  // px — orbit radius for single-base patrol
const PATH_DEVIATION = 240;  // px — perpendicular variation for multi-base routes

// "Нет стража" окно в конце каждого цикла (респавн-гэп) — сек.
const MAIN_RESPAWN_GAP  = 20;
const DRONE_RESPAWN_GAP = 15;

// Детерминированный wall-clock цикл (тот же приём, что GameScene._worldEventHash/
// ArmoredTrain-расписание) — раньше _mainCd/_droneCd были чистыми per-client
// накопителями, стартующими от МОМЕНТА ЗАГРУЗКИ СЦЕНЫ этим конкретным клиентом (баг
// из диалога: "мобы бьют одного игрока, второй вообще не видит мобов" — два клиента,
// зашедшие в сектор в разное реальное время, оказывались в совершенно разных фазах
// СВОЕГО личного таймера). Теперь фаза цикла считается от общего для всех wall-clock
// якоря (хэш ключа), так что любой клиент, оценивающий состояние в один и тот же
// реальный момент, получает одинаковый ответ "должен ли страж существовать сейчас" —
// координация через сервер не нужна. Известное ограничение, НЕ решаемое этим фиксом:
// HP/kill самого моба всё ещё не расшарены между клиентами (нет pvpMobId/PvpMobState,
// как у дронов бронепоезда) — если один игрок убъёт стража локально чуть раньше
// расписания, у другого клиента он останется живым до следующей проверки. Полный фикс
// требует регистрации в ServerMobManager, как у бронепоезда — отдельная задача.
function _guardHash(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

// true в течение (period - gap) сек каждого period-секундного цикла ("страж жив"),
// затем gap сек "в респавне" (стража нет вообще, одинаково для всех клиентов).
function _cyclePhaseAlive(seedKey, period, gap, nowMs) {
  const anchorMs = _guardHash(seedKey) % (period * 1000);
  const periodMs = period * 1000;
  const t = ((nowMs - anchorMs) % periodMs + periodMs) % periodMs;
  return t < (period - gap) * 1000;
}

// Номер текущей итерации цикла (растёт на 1 каждые period сек) — тем же якорем, что
// _cyclePhaseAlive, так что оба всегда согласованы. Нужен, чтобы отличить "этого стража
// убил игрок ДОСРОЧНО, посреди окна alive" от "цикл сам естественно закончился" — см.
// использование в update() ниже.
function _cycleId(seedKey, period, nowMs) {
  const anchorMs = _guardHash(seedKey) % (period * 1000);
  const periodMs = period * 1000;
  return Math.floor((nowMs - anchorMs) / periodMs);
}

// Детерминированный [0,1) ГПСЧ (LCG), засеянный тем же хэшем — см. использование в
// _spawnAt ниже: без этого Math.random() выбирал бы разную позицию на каждом клиенте.
function _seededRandom(seed) {
  let s = _guardHash(seed) || 1;
  return function () {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 4294967296;
  };
}

// Returns the timestamp (ms since epoch, UTC) of the most recent Wed/Sat 22:00 reset.
export function getLastResetTime() {
  const now = Date.now();
  const RESET_DAYS = [3, 6]; // Wed = 3, Sat = 6
  const d = new Date(now);
  for (let i = 0; i < 14; i++) {
    if (RESET_DAYS.includes(d.getUTCDay())) {
      const ts = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 22, 0, 0, 0);
      if (ts <= now) return ts;
    }
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return 0;
}

export default class ConfedGuardSystem {
  // sectorLevel — used as mob level when spawning guards
  constructor(scene, sectorLevel) {
    this.scene       = scene;
    this.level       = Math.max(10, sectorLevel);
    this._main       = null;                        // main guard Mob (guard_main)
    this._drones     = new Array(MAX_DRONES).fill(null); // фиксированные слоты — индекс = свой цикл-якорь
    this._active     = false;
    // Цикл, в котором стража/дрон убили ДОСРОЧНО (не сам _despawnAll на границе окна) —
    // подавляет немедленный респавн до конца ЭТОГО окна alive, см. update().
    this._mainKilledEarlyCycle  = null;
    this._droneKilledEarlyCycle = new Array(MAX_DRONES).fill(null);
  }

  update(dt, player) {
    // _neutralBases()/.filter() и _aggroAll()/spread раньше пересобирали новые
    // массивы КАЖДЫЙ кадр безусловно (даже пока игрок просто стоит у нейтральной
    // базы) — та же "пила" JS heap, что и у projectiles/_attachedFx (см.
    // GameScene.update()). Тут ничего не требует 60Hz-точности (спавн-таймеры
    // считаются секундами, aggro — состояние, а не событие), так что считаем
    // раз в секунду, а не каждый кадр.
    this._pollTimer = (this._pollTimer ?? 0) + dt;
    if (this._pollTimer < 1) return;
    this._pollTimer -= 1;

    const bases = this._neutralBases();

    if (!bases.length) {
      if (this._active) this._despawnAll();
      return;
    }
    this._active = true;

    // Детерминированный wall-clock цикл вместо per-client накопителя — см. комментарий
    // у _cyclePhaseAlive выше. sectorKey — общий для всех клиентов сектора якорь.
    const sectorKey = galaxy.current;
    const now = Date.now();

    // Prune dead refs. Если ссылка ещё не null, а .alive уже false — это НЕ наш
    // собственный плановый деспавн на границе окна (тот сразу же обнуляет ссылку сам,
    // см. else-if ниже) — значит, стража/дрона убил игрок ДОСРОЧНО, посреди окна alive.
    // Запоминаем номер ЭТОГО цикла, чтобы не респавнить немедленно на следующем тике —
    // баг из диалога: "страж базы и дрон охраны — спавн после слива за секунду"
    // (wantMain/wantSlot оставался true до конца окна независимо от факта убийства,
    // а "нет стража"-гэп срабатывал только на естественной границе цикла).
    if (this._main && !this._main.alive) {
      this._main = null;
      this._mainKilledEarlyCycle = _cycleId(`${sectorKey}:guard_main`, MAIN_INTERVAL, now);
    }
    for (let i = 0; i < MAX_DRONES; i++) {
      if (this._drones[i] && !this._drones[i].alive) {
        this._drones[i] = null;
        this._droneKilledEarlyCycle[i] = _cycleId(`${sectorKey}:guard_drone:${i}`, DRONE_CD_MAIN, now);
      }
    }

    const wantMain = _cyclePhaseAlive(`${sectorKey}:guard_main`, MAIN_INTERVAL, MAIN_RESPAWN_GAP, now);
    const mainCycle = _cycleId(`${sectorKey}:guard_main`, MAIN_INTERVAL, now);
    if (wantMain && !this._main) {
      if (this._mainKilledEarlyCycle !== mainCycle) this._main = this._spawnAt('guard_main', bases);
    } else if (!wantMain && this._main) {
      this._main.die(); this._main = null;
    }

    for (let i = 0; i < MAX_DRONES; i++) {
      const wantSlot = _cyclePhaseAlive(`${sectorKey}:guard_drone:${i}`, DRONE_CD_MAIN, DRONE_RESPAWN_GAP, now);
      const droneCycle = _cycleId(`${sectorKey}:guard_drone:${i}`, DRONE_CD_MAIN, now);
      if (wantSlot && !this._drones[i]) {
        if (this._droneKilledEarlyCycle[i] !== droneCycle) this._drones[i] = this._spawnAt('guard_drone', bases);
      } else if (!wantSlot && this._drones[i]) {
        this._drones[i].die(); this._drones[i] = null;
      }
    }

    // Aggro all guards when player enters the protection radius of any neutral base
    if (player?.alive) {
      for (const base of bases) {
        if (Phaser.Math.Distance.Between(player.x, player.y, base.x, base.y) < BASE_GUARD_RAD) {
          this._aggroAll();
          break;
        }
      }
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _neutralBases() {
    return (this.scene.miningBases || []).filter(
      b => b.corp === 'neutral' && b.state === 'active'
    );
  }

  _aggroAll() {
    for (const m of [this._main, ...this._drones]) {
      if (m?.alive && m.neutral) { m.neutral = false; m.state = 'aggro'; }
    }
  }

  _buildOpts(bases) {
    if (bases.length === 1) {
      // Orbit around the single base; spawn above it so patrolWaitUntil timer doesn't block
      return { behavior: 'patrol', patrolRadius: ORBIT_RADIUS };
    }
    // Roam between all neutral bases with random perpendicular deviation each segment
    return {
      behavior: 'roam',
      targets: bases.map(b => ({ x: b.x, y: b.y })),
      pathDeviation: PATH_DEVIATION,
    };
  }

  _spawnAt(key, bases) {
    // Засеянный тем же хэшем ГПСЧ — иначе Math.random()/Phaser.Math.Between выбрали бы
    // РАЗНУЮ базу-якорь/оффсет на каждом клиенте, даже когда "жив ли страж сейчас"
    // уже совпадает (см. _cyclePhaseAlive выше) — два клиента видели бы стража в разных
    // местах сектора. Без cycle-индекса в сиде — позиция стабильна между циклами
    // респавна, не варьируется, это приемлемый компромисс ради согласованности клиентов.
    const rand   = _seededRandom(`${galaxy.current}:${key}:spawn`);
    const opts   = this._buildOpts(bases);
    const anchor = bases[Math.floor(rand() * bases.length)];
    // For single-base orbit spawn on the orbit perimeter so the mob starts moving immediately
    const angle  = rand() * Math.PI * 2;
    const ox     = bases.length === 1 ? Math.cos(angle) * ORBIT_RADIUS : Math.floor(rand() * 281) - 140;
    const oy     = bases.length === 1 ? Math.sin(angle) * ORBIT_RADIUS : Math.floor(rand() * 281) - 140;
    const mob    = new Mob(this.scene, MOBS[key], this.level, anchor.x + ox, anchor.y + oy, opts);
    mob.neutral  = true;
    mob._isConfedGuard = true;
    this.scene.mobs.push(mob);
    return mob;
  }

  _despawnAll() {
    for (const m of [this._main, ...this._drones]) {
      if (m?.alive) m.die();
    }
    this._main   = null;
    this._drones = new Array(MAX_DRONES).fill(null);
    this._active = false;
    this._mainKilledEarlyCycle  = null;
    this._droneKilledEarlyCycle = new Array(MAX_DRONES).fill(null);
  }

  destroy() { this._despawnAll(); }
}
