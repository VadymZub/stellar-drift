import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import Mob from '../entities/Mob.js';
import { MOBS } from '../constants.js';

// Spawn intervals in seconds
const MAIN_INTERVAL  = 600;  // 10 min — main guard ship
const DRONE_CD_MAIN  = 120;  // 2 min — drone when main is alive
const DRONE_CD_SOLO  = 300;  // 5 min — drone when main is dead
const MAX_DRONES     = 2;
const BASE_GUARD_RAD = 380;  // px — player within this triggers aggro
const ORBIT_RADIUS   = 300;  // px — orbit radius for single-base patrol
const PATH_DEVIATION = 240;  // px — perpendicular variation for multi-base routes

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
    this._main       = null;   // main guard Mob (guard_main)
    this._drones     = [];     // guard drone Mobs
    this._mainCd     = 30;    // first main ship after 30 s
    this._droneCd    = 60;    // first drone after 60 s
    this._active     = false;
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

    // Prune dead refs
    if (this._main && !this._main.alive) this._main = null;
    if (this._drones.some(d => !d?.alive)) this._drones = this._drones.filter(d => d?.alive);

    // Countdown spawn timers (в секундах — тот же шаг, что и _pollTimer выше)
    this._mainCd  -= 1;
    this._droneCd -= 1;

    if (this._mainCd <= 0 && !this._main) {
      this._spawnMain(bases);
      this._mainCd = MAIN_INTERVAL;
    }
    if (this._droneCd <= 0 && this._drones.length < MAX_DRONES) {
      this._spawnDrone(bases);
      this._droneCd = this._main ? DRONE_CD_MAIN : DRONE_CD_SOLO;
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
    const opts   = this._buildOpts(bases);
    const anchor = bases[Math.floor(Math.random() * bases.length)];
    // For single-base orbit spawn on the orbit perimeter so the mob starts moving immediately
    const angle  = Math.random() * Math.PI * 2;
    const ox     = bases.length === 1 ? Math.cos(angle) * ORBIT_RADIUS : Phaser.Math.Between(-140, 140);
    const oy     = bases.length === 1 ? Math.sin(angle) * ORBIT_RADIUS : Phaser.Math.Between(-140, 140);
    const mob    = new Mob(this.scene, MOBS[key], this.level, anchor.x + ox, anchor.y + oy, opts);
    mob.neutral  = true;
    mob._isConfedGuard = true;
    this.scene.mobs.push(mob);
    return mob;
  }

  _spawnMain(bases)  { this._main = this._spawnAt('guard_main', bases); }
  _spawnDrone(bases) { this._drones.push(this._spawnAt('guard_drone', bases)); }

  _despawnAll() {
    for (const m of [this._main, ...this._drones]) {
      if (m?.alive) m.die();
    }
    this._main   = null;
    this._drones = [];
    this._active = false;
  }

  destroy() { this._despawnAll(); }
}
