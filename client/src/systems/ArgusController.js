import Mob from '../entities/Mob.js';
import { MOBS } from '../constants.js';
import { galaxy } from '../galaxy.js';

const CHANNEL = 'stellar-drift-admin';

export default class ArgusController {
  constructor(scene) {
    this.scene = scene;
    this.mob   = null;
    this._timer = 0;
    this._ch    = null;
    try {
      this._ch = new BroadcastChannel(CHANNEL);
      this._ch.onmessage = ({ data }) => this._onMsg(data);
    } catch (_) {}
  }

  _onMsg(msg) {
    switch (msg.type) {
      case 'ARGUS_SPAWN':         this._spawn(msg);         break;
      case 'ARGUS_DESPAWN':       this._despawn();          break;
      case 'ARGUS_HEAL':          this._heal(msg);          break;
      case 'ARGUS_FORCE_ABILITY': this._forceAbility(msg);  break;
    }
  }

  _spawn(msg) {
    if (this.mob?.alive) this._removeMob();
    const gs    = this.scene;
    const level = Math.min(50, Math.max(1, msg.level ?? 50));
    const cx    = gs.worldWidth  / 2;
    const cy    = gs.worldHeight / 2;
    this.mob = new Mob(gs, MOBS.argus_boss, level, cx, cy, {
      behavior: 'guard', patrolRadius: 300, leash: Infinity,
    });
    gs.mobs.push(this.mob);
    gs.log(`⚠ АРГУС вышел на орбиту — уровень ${level}`);
    this._logAudit('ARGUS_SPAWN', { level, sector: galaxy.current });
    this._broadcast();
  }

  _despawn() {
    if (!this.mob) return;
    this.scene.log('АРГУС отозван администратором');
    this._removeMob();
    this._logAudit('ARGUS_DESPAWN', {});
    this._broadcast();
  }

  _heal(msg) {
    const m = this.mob;
    if (!m?.alive) return;
    if (msg.hullPct   != null) m.hull   = Math.round(m.maxHull   * msg.hullPct  / 100);
    if (msg.shieldPct != null) m.shield = Math.round(m.maxShield * msg.shieldPct / 100);
    this._logAudit('ARGUS_HEAL', { hullPct: msg.hullPct, shieldPct: msg.shieldPct });
    this._broadcast();
  }

  _forceAbility(msg) {
    const m = this.mob;
    if (!m?.alive) return;
    if (msg.ability === 'aoe') {
      m.requestAoe = true;
      this._logAudit('ARGUS_ABILITY', { ability: 'aoe' });
    } else if (msg.ability === 'enrage') {
      m.phase = 2;
      m.sprite?.setTint(0xff7a6b);
      this._logAudit('ARGUS_ABILITY', { ability: 'enrage' });
    }
  }

  _removeMob() {
    const m = this.mob;
    if (!m) return;
    if (m.alive) m.die();
    m.sprite?.destroy();
    m.label?.destroy();
    m.bar?.destroy();
    this.scene.mobs = this.scene.mobs.filter(x => x !== m);
    if (this.scene.target === m) { this.scene.target = null; this.scene.isFiring = false; }
    this.mob = null;
  }

  // Called on scene restart so stale mob reference is cleared without destroying
  // already-destroyed Phaser objects.
  onSceneRestart() {
    this.mob = null;
  }

  update(dt) {
    this._timer += dt;
    if (this._timer >= 1.0) {
      this._timer = 0;
      // Sync alive flag: if Phaser killed the mob (e.g. player killed it), clear ref
      if (this.mob && !this.mob.alive) {
        this.mob = null;
        this._logAudit('ARGUS_KILLED', {});
      }
      this._broadcast();
    }
  }

  _broadcast() {
    if (!this._ch) return;
    const m = this.mob;
    this._ch.postMessage({
      type:      'ARGUS_UPDATE',
      alive:     m?.alive ?? false,
      hullPct:   (m?.alive) ? Math.round(m.hull   / m.maxHull   * 100) : 0,
      shieldPct: (m?.alive) ? Math.round(m.shield / m.maxShield * 100) : 0,
      phase:     m?.phase  ?? 1,
      sector:    galaxy.current,
      x:         m ? Math.round(m.x) : 0,
      y:         m ? Math.round(m.y) : 0,
    });
  }

  _logAudit(action, params) {
    try {
      const raw = localStorage.getItem('sd_audit');
      const log = raw ? JSON.parse(raw) : [];
      log.unshift({ ts: new Date().toISOString(), action, params, sector: galaxy.current });
      if (log.length > 200) log.length = 200;
      localStorage.setItem('sd_audit', JSON.stringify(log));
    } catch (_) {}
  }

  destroy() {
    this._ch?.close();
    this._ch = null;
  }
}
