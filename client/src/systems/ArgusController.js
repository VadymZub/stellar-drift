import Mob from '../entities/Mob.js';
import { MOBS } from '../constants.js';
import { galaxy } from '../galaxy.js';

const CHANNEL     = 'stellar-drift-admin';
const ORBIT_R     = 480;   // px — радиус орбиты вокруг игрока
const HEAL_CD     = 180;   // секунд между авто-хилами (3 минуты)
const HEAL_PCT    = 0.30;  // +30% корпуса и щита за хил
const TOP_REWARD  = 5;     // сколько игроков получают награды
const REWARD_GOLD = 100;   // золото за топ-5 урона
const HONOR_GAIN  = 250000; // очки чести = 10 убийств игрока 50 ур.

export default class ArgusController {
  constructor(scene) {
    this.scene       = scene;
    this.mob         = null;
    this._broadcastT = 0;
    this._healTimer  = 0;
    this._orbitAngle = 0;
    this._damageMap  = new Map(); // playerName → total damage dealt
    this._ch         = null;
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

    this.mob = new Mob(gs, MOBS.argus_boss, level, cx + 800, cy, {
      behavior: 'roam', patrolRadius: 600, leash: Infinity,
    });
    gs.mobs.push(this.mob);

    // Reset per-spawn state
    this._damageMap  = new Map();
    this._healTimer  = 0;
    this._orbitAngle = 0;

    // Wrap takeDamage to track damage for the leaderboard
    const origTD = this.mob.takeDamage.bind(this.mob);
    const ctrl   = this;
    this.mob.takeDamage = function(amount, pen, opts) {
      const res  = origTD(amount, pen, opts);
      const hit  = (res.hullHit || 0) + (res.shieldHit || 0);
      if (hit > 0) {
        const name = ctrl.scene.playerName ?? 'Player';
        ctrl._damageMap.set(name, (ctrl._damageMap.get(name) || 0) + hit);
      }
      return res;
    };

    gs.log('⚠ АРГУС вышел на орбиту — уровень ' + level);
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

  onSceneRestart() { this.mob = null; }

  // ── Main update loop (called from GameScene.update AFTER mobs.forEach) ──

  update(dt) {
    // Detect player kill
    if (this.mob && !this.mob.alive) {
      this._onArgusDied();
      this.mob = null;
    }

    if (this.mob?.alive) {
      this._updateMovement(dt);
      this._updateSelfHeal(dt);
    }

    this._broadcastT += dt;
    if (this._broadcastT >= 0.5) {
      this._broadcastT = 0;
      this._broadcast();
    }
  }

  // ── Movement: chase → orbit ─────────────────────────────────────────

  _updateMovement(dt) {
    const m = this.mob;
    const p = this.scene.player;
    if (!m?.alive || !p?.alive) return;

    const dx   = p.x - m.x;
    const dy   = p.y - m.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    // Always stay in aggro — override whatever Mob.js just set
    m.state = 'aggro';

    // Speed scales with level, same formula as Mob.js; enrage boosts it
    const baseSpeed  = m.tpl.speed * (1 + 0.5 * (m.level - 1));
    const spd        = m.phase >= 2 ? baseSpeed * 1.35 : baseSpeed;

    let vx, vy;
    if (dist > ORBIT_R * 1.4) {
      // Far: fly straight at player
      vx = (dx / dist) * spd;
      vy = (dy / dist) * spd;
    } else {
      // In range: orbit — advance angle proportional to arc speed
      this._orbitAngle += (spd / ORBIT_R) * dt;
      const tx = p.x + Math.cos(this._orbitAngle) * ORBIT_R;
      const ty = p.y + Math.sin(this._orbitAngle) * ORBIT_R;
      const sx = tx - m.x;
      const sy = ty - m.y;
      const sd = Math.sqrt(sx * sx + sy * sy) || 1;
      vx = (sx / sd) * spd;
      vy = (sy / sd) * spd;
    }

    m.sprite.body.setVelocity(vx, vy);

    // Face player
    const facing = Math.atan2(dy, dx);
    m.heading = facing;
    m.sprite.setRotation(facing + (m.tpl.artAngleOffset ?? 0));
  }

  // ── Auto self-heal every HEAL_CD seconds ────────────────────────────

  _updateSelfHeal(dt) {
    const m = this.mob;
    if (!m?.alive) return;
    this._healTimer += dt;
    if (this._healTimer < HEAL_CD) return;
    this._healTimer = 0;

    m.hull   = Math.min(m.maxHull,   m.hull   + m.maxHull   * HEAL_PCT);
    m.shield = Math.min(m.maxShield, m.shield + m.maxShield * HEAL_PCT);

    // Visual: briefly tint cyan then restore phase tint
    m.sprite?.setTint(0x4dd0e1);
    this.scene.time.delayedCall(900, () => {
      if (!m.alive) return;
      if (m.phase >= 2) m.sprite?.setTint(0xff7a6b);
      else m.sprite?.clearTint();
    });

    this.scene.log(`⚕️ АРГУС: регенерация +${Math.round(HEAL_PCT*100)}% корпус, +${Math.round(HEAL_PCT*100)}% щит`);
    this._logAudit('ARGUS_SELF_HEAL', {
      hullPct:   Math.round(m.hull   / m.maxHull   * 100),
      shieldPct: Math.round(m.shield / m.maxShield * 100),
    });
    this._broadcast();
  }

  // ── Death → rewards ─────────────────────────────────────────────────

  _onArgusDied() {
    const gs = this.scene;

    // Sort all participants by damage dealt
    const sorted = [...this._damageMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_REWARD)
      .map(([name, dmg]) => ({ name, dmg: Math.round(dmg) }));

    const inTop = sorted.some(p => p.name === (gs.playerName ?? 'Player'));

    if (inTop) {
      // Gold reward
      gs.starGold = (gs.starGold || 0) + REWARD_GOLD;
      gs.log(`🏆 АРГУС ПОВЕРЖЕН! Топ-${TOP_REWARD} по урону: +${REWARD_GOLD} ⭐`);

      // Corp rating bonus during season
      if (gs.seasonWon) {
        gs.corpRep = Math.min(1.0, (gs.corpRep || 0) + 0.10);
        gs.log('🏅 Сезонный бонус: +10% корпоративный рейтинг');
      }

      // PvP honor equivalent to killing 10 level-50 players
      gs.pilotHonor = (gs.pilotHonor || 0) + HONOR_GAIN;
      gs.log('⚔️ PvP рейтинг: +эквивалент ×10 убийств Lvl50');
    } else {
      gs.log('АРГУС ПОВЕРЖЕН — ты не вошёл в топ-5 по урону');
    }

    this._logAudit('ARGUS_KILLED', {
      killedBy:    gs.playerName ?? 'unknown',
      topDamage:   sorted,
      rewardGiven: inTop,
    });
  }

  // ── BroadcastChannel ────────────────────────────────────────────────

  _broadcast() {
    if (!this._ch) return;
    const m = this.mob;
    this._ch.postMessage({
      type:      'ARGUS_UPDATE',
      alive:     m?.alive ?? false,
      hullPct:   m?.alive ? Math.round(m.hull   / m.maxHull   * 100) : 0,
      shieldPct: m?.alive ? Math.round(m.shield / m.maxShield * 100) : 0,
      phase:     m?.phase  ?? 1,
      sector:    galaxy.current,
      x:         m ? Math.round(m.x) : 0,
      y:         m ? Math.round(m.y) : 0,
    });
  }

  // ── Audit log (localStorage) ─────────────────────────────────────────

  _logAudit(action, params) {
    try {
      const log = JSON.parse(localStorage.getItem('sd_audit') || '[]');
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
