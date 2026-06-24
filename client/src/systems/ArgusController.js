import Mob from '../entities/Mob.js';
import { MOBS, HONOR_PER_LVL50 } from '../constants.js';
import { galaxy } from '../galaxy.js';

const CHANNEL     = 'stellar-drift-admin';
const HEAL_CD     = 180;    // секунд между авто-хилами (3 минуты)
const HEAL_PCT    = 0.30;
const TOP_REWARD  = 8;      // топ-8 по урону получают награду
const REWARD_GOLD = 100;
const HONOR_GAIN  = HONOR_PER_LVL50 * 10; // = 10 убийств игрока 50 уровня

// Movement constants
const ORBIT_R_TIGHT = 380;  // радиус орбиты в orbit-режиме (реактивный)
const ORBIT_SPEED   = 1.25; // множитель скорости в orbit-режиме
const OSC_CENTER    = 560;  // центр осцилляции (px от игрока)
const OSC_AMP       = 200;  // амплитуда ±px (диапазон 360–760)
const OSC_FREQ      = 0.22; // рад/сек (один полный цикл ≈ 28 сек)
const OSC_ORBIT_K   = 0.3;  // медленный дрейф по орбите в oscillate-режиме
const ORBIT_TRIGGER_HP  = 0.50; // HP% порог активации orbit-режима
const ORBIT_TRIGGER_DPS = 0.12; // % от maxHull входящего урона за 3 сек → orbit
const ORBIT_MIN_DUR = 8;    // минимальная длительность orbit-режима, сек
const ORBIT_MAX_DUR = 12;
const CHASE_DIST    = 1500; // px — дальность форсированного преследования

export default class ArgusController {
  constructor(scene) {
    this.scene       = scene;
    this.mob         = null;
    this._broadcastT = 0;
    this._healTimer  = 0;
    this._moveTimer  = 0;   // общий таймер движения (для синуса)
    this._orbitAngle = 0;   // текущий угол орбиты/осцилляции
    this._movePhase  = 'approach'; // 'approach' | 'oscillate' | 'orbit'
    this._orbitModeT = 0;   // сколько секунд в текущем orbit-режиме
    this._orbitModeDur = 10;
    this._damageMap  = new Map();
    this._dmgHistory = [];  // [{ts, amount}] — для расчёта входящего DPS
    this._ch         = null;
    try {
      this._ch = new BroadcastChannel(CHANNEL);
      this._ch.onmessage = ({ data }) => this._onMsg(data);
    } catch (_) {}
  }

  _onMsg(msg) {
    switch (msg.type) {
      case 'ARGUS_SPAWN':         this._spawn(msg);        break;
      case 'ARGUS_DESPAWN':       this._despawn();         break;
      case 'ARGUS_HEAL':          this._heal(msg);         break;
      case 'ARGUS_FORCE_ABILITY': this._forceAbility(msg); break;
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
    this._dmgHistory = [];
    this._healTimer  = 0;
    this._moveTimer  = 0;
    this._orbitAngle = 0;
    this._movePhase  = 'approach';
    this._orbitModeT = 0;

    // Wrap takeDamage: track damage for leaderboard + incoming DPS for orbit trigger
    const origTD = this.mob.takeDamage.bind(this.mob);
    const ctrl   = this;
    this.mob.takeDamage = function(amount, pen, opts) {
      const res = origTD(amount, pen, opts);
      const hit = (res.hullHit || 0) + (res.shieldHit || 0);
      if (hit > 0) {
        const name = ctrl.scene.playerName ?? 'Player';
        ctrl._damageMap.set(name, (ctrl._damageMap.get(name) || 0) + hit);
        ctrl._dmgHistory.push({ ts: Date.now(), amount: hit });
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

  // ── Main update ──────────────────────────────────────────────────────

  update(dt) {
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

  // ── Movement state machine ───────────────────────────────────────────
  //
  //  approach  — прямое преследование (dist > CHASE_DIST или старт)
  //  oscillate — боевое сближение: синус-дистанция + медленная орбита
  //              Аргус то приближается, то отдаляется, постепенно кружа.
  //  orbit     — реактивная орбита (активируется при низком HP или
  //              высоком входящем DPS). Быстрый тесный круг вокруг игрока.

  _updateMovement(dt) {
    const m = this.mob;
    const p = this.scene.player;
    if (!m?.alive || !p?.alive) return;

    // Override Mob.js AI — Argus is always aggressive
    m.state = 'aggro';

    const dx   = p.x - m.x;
    const dy   = p.y - m.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    // Speed is a flat stat in Mob.js (not level-scaled — only hull/shield/damage scale).
    const baseSpeed = m.tpl.speed;
    const spd       = m.phase >= 2 ? baseSpeed * 1.35 : baseSpeed;

    this._moveTimer += dt;

    // ── State transitions ────────────────────────────────────────────

    if (dist > CHASE_DIST) {
      // Player fled far — chase directly
      this._movePhase = 'approach';
    } else if (this._movePhase === 'approach' && dist < 900) {
      this._movePhase = 'oscillate';
    } else if (this._movePhase === 'orbit') {
      this._orbitModeT += dt;
      if (this._orbitModeT >= this._orbitModeDur) {
        this._movePhase = 'oscillate';
        this._orbitModeT = 0;
      }
    } else {
      // oscillate — check if orbit should trigger
      const hullFrac  = m.hull / m.maxHull;
      const recentDmg = this._getRecentDps();
      const trigger   = hullFrac < ORBIT_TRIGGER_HP || recentDmg > m.maxHull * ORBIT_TRIGGER_DPS;
      if (trigger) {
        this._movePhase   = 'orbit';
        this._orbitModeT  = 0;
        // Vary orbit duration so it doesn't feel mechanical
        this._orbitModeDur = ORBIT_MIN_DUR + Math.abs(Math.sin(this._moveTimer)) * (ORBIT_MAX_DUR - ORBIT_MIN_DUR);
      }
    }

    // ── Velocity calculation ─────────────────────────────────────────

    let vx, vy;

    if (this._movePhase === 'approach') {
      vx = (dx / dist) * spd;
      vy = (dy / dist) * spd;

    } else if (this._movePhase === 'orbit') {
      // Tight, fast orbit — Argus circles rapidly under pressure
      this._orbitAngle += (spd * ORBIT_SPEED / ORBIT_R_TIGHT) * dt;
      const tx = p.x + Math.cos(this._orbitAngle) * ORBIT_R_TIGHT;
      const ty = p.y + Math.sin(this._orbitAngle) * ORBIT_R_TIGHT;
      const sx = tx - m.x, sy = ty - m.y, sd = Math.sqrt(sx*sx + sy*sy) || 1;
      const orbitScale = Math.min(1, sd / 60);
      vx = (sx / sd) * spd * ORBIT_SPEED * Math.max(0.2, orbitScale);
      vy = (sy / sd) * spd * ORBIT_SPEED * Math.max(0.2, orbitScale);

    } else {
      // Oscillate: sine wave on distance + slow angular drift
      // Target distance oscillates between OSC_CENTER ± OSC_AMP
      const targetDist = OSC_CENTER + Math.sin(this._moveTimer * OSC_FREQ) * OSC_AMP;
      this._orbitAngle += (spd * OSC_ORBIT_K / targetDist) * dt;
      const tx = p.x + Math.cos(this._orbitAngle) * targetDist;
      const ty = p.y + Math.sin(this._orbitAngle) * targetDist;
      const sx = tx - m.x, sy = ty - m.y, sd = Math.sqrt(sx*sx + sy*sy) || 1;
      const oscScale = Math.min(1, sd / 80);
      vx = (sx / sd) * spd * 0.9 * Math.max(0.15, oscScale);
      vy = (sy / sd) * spd * 0.9 * Math.max(0.15, oscScale);
    }

    m.sprite.body.setVelocity(vx, vy);

    // Always face the player
    const facing = Math.atan2(dy, dx);
    m.heading = facing;
    m.sprite.setRotation(facing + (m.tpl.artAngleOffset ?? 0));
  }

  // Returns total damage received in the last 3 seconds
  _getRecentDps() {
    const cutoff = Date.now() - 3000;
    this._dmgHistory = this._dmgHistory.filter(d => d.ts > cutoff);
    return this._dmgHistory.reduce((s, d) => s + d.amount, 0);
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

    m.sprite?.setTint(0x4dd0e1);
    this.scene.time.delayedCall(900, () => {
      if (!m.alive) return;
      if (m.phase >= 2) m.sprite?.setTint(0xff7a6b);
      else m.sprite?.clearTint();
    });

    this.scene.log(`⚕️ АРГУС: регенерация +${Math.round(HEAL_PCT * 100)}% корпус, +${Math.round(HEAL_PCT * 100)}% щит`);
    this._logAudit('ARGUS_SELF_HEAL', {
      hullPct:   Math.round(m.hull   / m.maxHull   * 100),
      shieldPct: Math.round(m.shield / m.maxShield * 100),
    });
    this._broadcast();
  }

  // ── Death → rewards ──────────────────────────────────────────────────

  _onArgusDied() {
    const gs = this.scene;
    const sorted = [...this._damageMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_REWARD)
      .map(([name, dmg]) => ({ name, dmg: Math.round(dmg) }));

    const inTop = sorted.some(p => p.name === (gs.playerName ?? 'Player'));

    if (inTop) {
      gs.starGold = (gs.starGold || 0) + REWARD_GOLD;
      gs.log(`🏆 АРГУС ПОВЕРЖЕН! Топ-${TOP_REWARD} по урону: +${REWARD_GOLD} ⭐`);
      if (gs.seasonWon) {
        gs.gainCorpRep?.(0.10);
        gs.log('🏅 Сезонный бонус: +10% корпоративный рейтинг');
      }
      gs.gainHonor?.(HONOR_GAIN);
    } else {
      gs.log(`АРГУС ПОВЕРЖЕН — ты не вошёл в топ-${TOP_REWARD} по урону`);
    }

    this._logAudit('ARGUS_KILLED', {
      killedBy:    gs.playerName ?? 'unknown',
      topDamage:   sorted,
      rewardGiven: inTop,
    });

    // Immediate save — rewards must not be lost on disconnect
    gs._saveState?.();
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
      movePhase: this._movePhase,
      sector:    galaxy.current,
      x:         m ? Math.round(m.x) : 0,
      y:         m ? Math.round(m.y) : 0,
    });
  }

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
