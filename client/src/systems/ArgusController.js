import Mob from '../entities/Mob.js';
import { MOBS, HONOR_PER_LVL50 } from '../constants.js';
import { galaxy } from '../galaxy.js';

const CHANNEL     = 'stellar-drift-admin';
const HEAL_CD     = 180;
const HEAL_PCT    = 0.30;
const TOP_REWARD  = 8;
const REWARD_GOLD = 100;
const HONOR_GAIN  = HONOR_PER_LVL50 * 10;

// Movement
const ORBIT_R_TIGHT     = 380;
const ORBIT_SPEED       = 1.25;
const OSC_CENTER        = 560;
const OSC_AMP           = 200;
const OSC_FREQ          = 0.22;
const OSC_ORBIT_K       = 0.3;
const ORBIT_TRIGGER_HP  = 0.50;
const ORBIT_TRIGGER_DPS = 0.12;
const ORBIT_MIN_DUR     = 8;
const ORBIT_MAX_DUR     = 12;
const CHASE_DIST        = 1500;

// Quantum FX
const SCAN_PERIOD    = 3.0;   // секунд между sweep-анимациями
const SCAN_DURATION  = 0.8;   // секунд на прохождение корпуса
const FLICKER_MIN    = 2.0;   // сек — мин интервал мерцания
const FLICKER_MAX    = 4.0;
const BERSERK_HP     = 0.40;
const JUMP_DIST      = 400;   // px — дальность квантового прыжка

export default class ArgusController {
  constructor(scene) {
    this.scene        = scene;
    this.mob          = null;
    this._broadcastT  = 0;
    this._healTimer   = 0;
    this._moveTimer   = 0;
    this._orbitAngle  = 0;
    this._movePhase   = 'approach';
    this._orbitModeT  = 0;
    this._orbitModeDur = 10;
    this._damageMap   = new Map();
    this._dmgHistory  = [];

    // Quantum FX state
    this._layerWhite   = null;
    this._layerViolet  = null;
    this._layerBlue    = null;
    this._scanLine     = null;
    this._phaseTimer   = 0;
    this._nextPhase    = FLICKER_MIN + Math.random() * (FLICKER_MAX - FLICKER_MIN);
    this._scanT        = 0;
    this._blueOffX     = 4;
    this._violetOscT   = 0;
    this._berserkApplied = false;

    this._playerFX = null; // quantum layers attached to player ship

    // Player abilities
    this._pulsarData  = null;
    this._cocoonGfx   = null;
    this._cocoonTimer = 0;

    this._ch = null;
    try {
      this._ch = new BroadcastChannel(CHANNEL);
      this._ch.onmessage = ({ data }) => this._onMsg(data);
    } catch (_) {}
  }

  // ── Player-ship quantum FX (DEV key 8) ─────────────────────────────

  attachToPlayer(player) {
    this.detachFromPlayer();
    const gs     = this.scene;
    const texKey = player.sprite.texture.key;
    const dw     = player.sprite.displayWidth;
    const dh     = player.sprite.displayHeight;
    const x = player.sprite.x, y = player.sprite.y;

    // Depths around player (50): white/violet behind, blue just behind, scan above
    this._playerFX = {
      white:      gs.add.image(x, y, texKey).setDepth(48).setAlpha(0.15).setTint(0xe0f7fa).setDisplaySize(dw, dh).setBlendMode('ADD'),
      violet:     gs.add.image(x, y, texKey).setDepth(48).setAlpha(0.25).setTint(0xb39ddb).setDisplaySize(dw, dh).setBlendMode('ADD'),
      blue:       gs.add.image(x, y, texKey).setDepth(49).setAlpha(0.35).setTint(0x00d4ff).setDisplaySize(dw, dh).setBlendMode('ADD'),
      scan:       gs.add.graphics().setDepth(51),
      phaseTimer: 0,
      nextPhase:  FLICKER_MIN + Math.random() * (FLICKER_MAX - FLICKER_MIN),
      scanT:      0,
      blueOffX:   4,
      player,
    };

    // Auto-insert abilities into action bar slots 0 and 1
    const bar = gs.actionBar || (gs.actionBar = Array(10).fill(null));
    bar[0] = 'argus:pulsar';
    bar[1] = 'argus:cocoon';
  }

  detachFromPlayer() {
    // Clear argus ability slots from action bar
    const bar = this.scene?.actionBar;
    if (bar) {
      for (let i = 0; i < bar.length; i++) {
        if ((bar[i] + '').startsWith('argus:')) bar[i] = null;
      }
    }
    this._pulsarData?.beams?.destroy(); this._pulsarData = null;
    this._cocoonGfx?.destroy(); this._cocoonGfx = null;

    if (!this._playerFX) return;
    this._playerFX.white?.destroy();
    this._playerFX.violet?.destroy();
    this._playerFX.blue?.destroy();
    this._playerFX.scan?.destroy();
    this._playerFX = null;
  }

  _updatePlayerQuantum(dt) {
    const fx = this._playerFX;
    if (!fx) return;
    const p = fx.player;

    // Auto-detach if player switched away from argus
    if (!p?.sprite || this.scene.activeShip !== 'argus') { this.detachFromPlayer(); return; }

    const x = p.sprite.x, y = p.sprite.y, rot = p.sprite.rotation;
    fx.white.setPosition(x, y).setRotation(rot);
    fx.blue.setPosition(x + fx.blueOffX, y).setRotation(rot);
    fx.violet.setPosition(x - 4, y).setRotation(rot);

    // Scan-line sweep
    fx.scanT = (fx.scanT + dt) % SCAN_PERIOD;
    fx.scan.clear();
    if (fx.scanT < SCAN_DURATION) {
      const prog  = fx.scanT / SCAN_DURATION;
      const halfH = p.sprite.displayHeight / 2;
      const halfW = p.sprite.displayWidth  / 2;
      fx.scan.fillStyle(0xe0f7fa, 0.15);
      fx.scan.fillRect(x - halfW, y - halfH + p.sprite.displayHeight * prog, p.sprite.displayWidth, 2);
    }

    // Phase flicker
    fx.phaseTimer += dt;
    if (fx.phaseTimer >= fx.nextPhase) {
      fx.phaseTimer = 0;
      fx.nextPhase  = FLICKER_MIN + Math.random() * (FLICKER_MAX - FLICKER_MIN);
      const gs = this.scene;
      gs.tweens.add({ targets: p.sprite, alpha: { from: 1.0, to: 0.3 }, duration: 80, yoyo: true, repeat: 2, ease: 'Stepped' });
      fx.blueOffX = 4 + (Math.random() > 0.5 ? 8 : -8);
      gs.time.delayedCall(200, () => { if (fx === this._playerFX) fx.blueOffX = 4; });
      gs.tweens.add({ targets: fx.blue, alpha: { from: fx.blue.alpha, to: 0.7 }, duration: 100, yoyo: true, ease: 'Linear' });
    }

    this._updatePulsar(dt);
    this._updateCocoon(dt);
  }

  // ── Player abilities ─────────────────────────────────────────────────

  _activatePulsar() {
    // CD is checked by GameScene._activateSkillSlot before calling here
    const fx = this._playerFX;
    if (!fx?.player?.alive) return;
    this._pulsarData?.beams?.destroy();
    this._pulsarData = {
      beams:    this.scene.add.graphics().setDepth(55),
      elapsed:  0,
      duration: 4.0,
      angle:    0,
      radius:   600,
      dmgTimer: 0,
    };
    this.scene.log('⚡ КВАНТОВЫЙ ПУЛЬСАР — 4с');
  }

  _activateCocoon() {
    // CD is checked by GameScene._activateSkillSlot before calling here
    const fx = this._playerFX;
    if (!fx?.player?.alive) return;
    const p  = fx.player;
    const gs = this.scene;

    const hullHeal   = Math.round(p.maxHull   * 0.30);
    const shieldHeal = Math.round(p.maxShield * 0.30);
    p.hull   = Math.min(p.maxHull,   p.hull   + hullHeal);
    p.shield = Math.min(p.maxShield, p.shield + shieldHeal);
    p.invulnerable = true;

    this._cocoonGfx?.destroy();
    this._cocoonGfx   = gs.add.graphics().setDepth(49);
    this._cocoonTimer = 2.0;

    gs.time.delayedCall(2000, () => {
      if (p.alive) p.invulnerable = false;
      this._cocoonGfx?.destroy();
      this._cocoonGfx = null;
    });

    gs.log(`🛡 Фазовый кокон: +${hullHeal} HP, +${shieldHeal} щит, 2с неуязвим.`);
  }

  _updatePulsar(dt) {
    const pd = this._pulsarData;
    if (!pd) return;
    const p = this._playerFX?.player;
    if (!p?.alive) { pd.beams.destroy(); this._pulsarData = null; return; }

    pd.elapsed += dt;
    if (pd.elapsed >= pd.duration) { pd.beams.destroy(); this._pulsarData = null; return; }

    const speed = 1.5 + (pd.elapsed / pd.duration) * 1.5; // 1.5→3.0 rad/s
    pd.angle += speed * dt;

    const NUM   = 8;
    const step  = (Math.PI * 2) / NUM;
    const r     = pd.radius;
    pd.beams.clear();
    for (let i = 0; i < NUM; i++) {
      const a  = pd.angle + i * step;
      const ex = p.x + Math.cos(a) * r;
      const ey = p.y + Math.sin(a) * r;
      pd.beams.lineStyle(12, 0x00d4ff, 0.22);
      pd.beams.lineBetween(p.x, p.y, ex, ey);
      pd.beams.lineStyle(2, 0xe0f7fa, 0.95);
      pd.beams.lineBetween(p.x, p.y, ex, ey);
    }

    pd.dmgTimer += dt;
    if (pd.dmgTimer >= 0.1) {
      pd.dmgTimer -= 0.1;
      const HALF = 0.055; // ~3° beam half-width
      const r2   = r * r;
      for (const mob of this.scene.mobs) {
        if (!mob.alive) continue;
        const dx = mob.x - p.x, dy = mob.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2 || d2 < 900) continue;
        const ma = Math.atan2(dy, dx);
        for (let i = 0; i < NUM; i++) {
          let diff = ((ma - (pd.angle + i * step)) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          if (diff < HALF) { mob.takeDamage(300, 0); break; }
        }
      }
    }
  }

  _updateCocoon(dt) {
    if (!this._cocoonGfx) return;
    const p = this._playerFX?.player;
    if (!p?.alive) { this._cocoonGfx?.destroy(); this._cocoonGfx = null; return; }

    this._cocoonTimer = Math.max(0, this._cocoonTimer - dt);
    const alpha = this._cocoonTimer / 2.0;
    this._cocoonGfx.clear();
    if (alpha > 0) {
      this._cocoonGfx.lineStyle(5, 0xe0f7fa, alpha * 0.9);
      this._cocoonGfx.strokeCircle(p.x, p.y, 94);
      this._cocoonGfx.fillStyle(0x00d4ff, alpha * 0.12);
      this._cocoonGfx.fillCircle(p.x, p.y, 94);
    }
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
    this._damageMap      = new Map();
    this._dmgHistory     = [];
    this._healTimer      = 0;
    this._moveTimer      = 0;
    this._orbitAngle     = 0;
    this._movePhase      = 'approach';
    this._orbitModeT     = 0;
    this._phaseTimer     = 0;
    this._nextPhase      = FLICKER_MIN + Math.random() * (FLICKER_MAX - FLICKER_MIN);
    this._scanT          = 0;
    this._blueOffX       = 4;
    this._violetOscT     = 0;
    this._berserkApplied = false;

    this._phaseInvincible = false;
    this._setupQuantumFX();

    // Wrap takeDamage: quantum invincibility + damage tracking + white flash
    const origTD = this.mob.takeDamage.bind(this.mob);
    const ctrl   = this;
    this.mob.takeDamage = function(amount, pen, opts) {
      if (ctrl._phaseInvincible) return { shieldHit: 0, hullHit: 0, killed: false };
      const res = origTD(amount, pen, opts);
      const hit = (res.hullHit || 0) + (res.shieldHit || 0);
      if (hit > 0) {
        const name = ctrl.scene.playerName ?? 'Player';
        ctrl._damageMap.set(name, (ctrl._damageMap.get(name) || 0) + hit);
        ctrl._dmgHistory.push({ ts: Date.now(), amount: hit });
        if (ctrl._layerWhite && ctrl.mob?.phase >= 2) {
          ctrl._layerWhite.setAlpha(0.8);
          ctrl.scene.time.delayedCall(200, () => { if (ctrl._layerWhite) ctrl._layerWhite.setAlpha(0.15); });
        }
      }
      return res;
    };

    gs.log('⚠ АРГУС вышел на орбиту — уровень ' + level);
    this._logAudit('ARGUS_SPAWN', { level, sector: galaxy.current });
    this._broadcast();
  }

  // ── Quantum layers setup/teardown ────────────────────────────────────

  _setupQuantumFX() {
    const m      = this.mob;
    const gs     = this.scene;
    const texKey = m.sprite.texture.key;
    const dw     = m.sprite.displayWidth;
    const dh     = m.sprite.displayHeight;
    const x = m.x, y = m.y;

    // Depth order: white(37) → violet(38) → blue(39) → main sprite(40)
    this._layerWhite  = gs.add.image(x, y, texKey).setDepth(37).setAlpha(0.15).setTint(0xe0f7fa).setDisplaySize(dw, dh).setBlendMode('ADD');
    this._layerViolet = gs.add.image(x, y, texKey).setDepth(38).setAlpha(0.25).setTint(0xb39ddb).setDisplaySize(dw, dh).setBlendMode('ADD');
    this._layerBlue   = gs.add.image(x, y, texKey).setDepth(39).setAlpha(0.35).setTint(0x00d4ff).setDisplaySize(dw, dh).setBlendMode('ADD');
    // Scan-line: Graphics at world origin, coordinates absolute
    this._scanLine    = gs.add.graphics().setDepth(41);
  }

  _destroyQuantumFX() {
    this._layerWhite?.destroy();   this._layerWhite  = null;
    this._layerViolet?.destroy();  this._layerViolet = null;
    this._layerBlue?.destroy();    this._layerBlue   = null;
    this._scanLine?.destroy();     this._scanLine    = null;
  }

  // ── Quantum FX per-frame update ──────────────────────────────────────

  _updateQuantum(dt) {
    const m = this.mob;
    if (!m?.alive || !this._layerBlue) return;

    const rot = m.sprite.rotation;

    // Ghost layers follow main sprite; blue offset is screen-X (chromatic aberration)
    this._layerWhite.setPosition(m.x, m.y).setRotation(rot);
    this._layerBlue.setPosition(m.x + this._blueOffX, m.y).setRotation(rot);
    // Violet oscillates in berserk, otherwise mirrors left
    const vRot = m.phase >= 2
      ? rot + Math.sin(this._violetOscT * (Math.PI * 2 / 0.3)) * (3 * Math.PI / 180)
      : rot;
    this._layerViolet.setPosition(m.x - 4, m.y).setRotation(vRot);
    if (m.phase >= 2) this._violetOscT += dt;

    // Scan-line sweep (redrawn every frame at current mob position)
    this._scanT = (this._scanT + dt) % SCAN_PERIOD;
    this._scanLine.clear();
    if (this._scanT < SCAN_DURATION) {
      const prog  = this._scanT / SCAN_DURATION;
      const halfH = m.sprite.displayHeight / 2;
      const halfW = m.sprite.displayWidth  / 2;
      this._scanLine.fillStyle(0xe0f7fa, 0.15);
      this._scanLine.fillRect(m.x - halfW, m.y - halfH + m.sprite.displayHeight * prog, m.sprite.displayWidth, 2);
    }

    // Phase flicker timer
    this._phaseTimer += dt;
    if (this._phaseTimer >= this._nextPhase) {
      this._phaseTimer = 0;
      const base = m.phase >= 2 ? (FLICKER_MIN / 3) : FLICKER_MIN;
      this._nextPhase = base + Math.random() * (FLICKER_MAX - FLICKER_MIN) / (m.phase >= 2 ? 3 : 1);
      this._triggerPhaseFlicker();
    }

    // Auto-trigger berserk at 40% hull
    if (!this._berserkApplied && m.maxHull > 0 && m.hull / m.maxHull < BERSERK_HP) {
      this._berserkApplied = true;
      m.phase = 2;
      this._applyBerserk();
    }
  }

  _triggerPhaseFlicker() {
    const m  = this.mob;
    const gs = this.scene;
    if (!m?.alive) return;

    // Quantum phase window: 100% evasion for 400ms
    this._phaseInvincible = true;
    gs.time.delayedCall(400, () => { this._phaseInvincible = false; });

    // Main layer: 2 alpha dips (visible "phasing out")
    gs.tweens.add({
      targets: m.sprite,
      alpha: { from: 1.0, to: 0.3 },
      duration: 80, yoyo: true, repeat: 1, ease: 'Stepped',
    });

    // Blue layer: shift + brightness spike
    this._blueOffX = 4 + (Math.random() > 0.5 ? 8 : -8);
    gs.time.delayedCall(200, () => { this._blueOffX = 4; });
    if (this._layerBlue) {
      const targetAlpha = m.phase >= 2 ? 0.85 : 0.7;
      gs.tweens.add({
        targets: this._layerBlue,
        alpha: { from: this._layerBlue.alpha, to: targetAlpha },
        duration: 100, yoyo: true, ease: 'Linear',
      });
    }
  }

  _applyBerserk() {
    if (!this._layerBlue) return;
    this._layerBlue.setAlpha(0.6);
    this.scene.log('⚡ АРГУС: квантовый берсерк — фаза 2');
  }

  _quantumJump() {
    const m  = this.mob;
    const p  = this.scene.player;
    const gs = this.scene;
    if (!m?.alive || !p) return;

    const layers = [m.sprite, this._layerBlue, this._layerViolet, this._layerWhite].filter(Boolean);

    // All layers vanish
    layers.forEach(l => gs.tweens.add({ targets: l, alpha: 0, duration: 50 }));
    this._scanLine?.clear();

    gs.time.delayedCall(100, () => {
      if (!m.alive) return;

      // Teleport to random point 400px from player
      const angle = Math.random() * Math.PI * 2;
      const nx = Phaser.Math.Clamp(p.x + Math.cos(angle) * JUMP_DIST, 200, gs.worldWidth  - 200);
      const ny = Phaser.Math.Clamp(p.y + Math.sin(angle) * JUMP_DIST, 200, gs.worldHeight - 200);

      m.sprite.setPosition(nx, ny);
      if (m.sprite.body) m.sprite.body.reset(nx, ny);

      // Ghost layers materialize with staggered delay (quantum materialisation)
      if (this._layerBlue) {
        this._layerBlue.setPosition(nx + 4, ny);
        gs.tweens.add({ targets: this._layerBlue, alpha: m.phase >= 2 ? 0.6 : 0.35, duration: 200, delay: 200 });
      }
      if (this._layerViolet) {
        this._layerViolet.setPosition(nx - 4, ny);
        gs.tweens.add({ targets: this._layerViolet, alpha: 0.25, duration: 300, delay: 300 });
      }
      if (this._layerWhite) {
        this._layerWhite.setPosition(nx, ny);
        gs.tweens.add({ targets: this._layerWhite, alpha: 0.15, duration: 400, delay: 400 });
      }
      gs.tweens.add({ targets: m.sprite, alpha: 1, duration: 350, delay: 350 });
    });
  }

  // ── Main update ──────────────────────────────────────────────────────

  update(dt) {
    if (this.mob && !this.mob.alive) {
      this._onArgusDied();
      this._destroyQuantumFX();
      this.mob = null;
    }

    if (this.mob?.alive) {
      this._updateMovement(dt);
      this._updateQuantum(dt);
      this._updateSelfHeal(dt);
    }
    this._updatePlayerQuantum(dt);

    this._broadcastT += dt;
    if (this._broadcastT >= 0.5) {
      this._broadcastT = 0;
      this._broadcast();
    }
  }

  // ── Movement state machine ───────────────────────────────────────────

  _updateMovement(dt) {
    const m = this.mob;
    const p = this.scene.player;
    if (!m?.alive || !p?.alive) return;

    m.state = 'aggro';

    const dx   = p.x - m.x;
    const dy   = p.y - m.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    const baseSpeed = m.tpl.speed;
    const spd       = m.phase >= 2 ? baseSpeed * 1.35 : baseSpeed;

    this._moveTimer += dt;

    if (dist > CHASE_DIST) {
      this._movePhase = 'approach';
    } else if (this._movePhase === 'approach' && dist < 900) {
      this._movePhase = 'oscillate';
    } else if (this._movePhase === 'orbit') {
      this._orbitModeT += dt;
      if (this._orbitModeT >= this._orbitModeDur) {
        this._movePhase  = 'oscillate';
        this._orbitModeT = 0;
      }
    } else {
      const hullFrac  = m.hull / m.maxHull;
      const recentDmg = this._getRecentDps();
      if (hullFrac < ORBIT_TRIGGER_HP || recentDmg > m.maxHull * ORBIT_TRIGGER_DPS) {
        this._movePhase    = 'orbit';
        this._orbitModeT   = 0;
        this._orbitModeDur = ORBIT_MIN_DUR + Math.abs(Math.sin(this._moveTimer)) * (ORBIT_MAX_DUR - ORBIT_MIN_DUR);
      }
    }

    let vx, vy;

    if (this._movePhase === 'approach') {
      vx = (dx / dist) * spd;
      vy = (dy / dist) * spd;

    } else if (this._movePhase === 'orbit') {
      this._orbitAngle += (spd * ORBIT_SPEED / ORBIT_R_TIGHT) * dt;
      const tx = p.x + Math.cos(this._orbitAngle) * ORBIT_R_TIGHT;
      const ty = p.y + Math.sin(this._orbitAngle) * ORBIT_R_TIGHT;
      const sx = tx - m.x, sy = ty - m.y, sd = Math.sqrt(sx*sx + sy*sy) || 1;
      const orbitScale = Math.min(1, sd / 60);
      vx = (sx / sd) * spd * ORBIT_SPEED * Math.max(0.2, orbitScale);
      vy = (sy / sd) * spd * ORBIT_SPEED * Math.max(0.2, orbitScale);

    } else {
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
    const facing = Math.atan2(dy, dx);
    m.heading    = facing;
    m.sprite.setRotation(facing + (m.tpl.artAngleOffset ?? 0));
  }

  _getRecentDps() {
    const cutoff = Date.now() - 3000;
    this._dmgHistory = this._dmgHistory.filter(d => d.ts > cutoff);
    return this._dmgHistory.reduce((s, d) => s + d.amount, 0);
  }

  // ── Self-heal ────────────────────────────────────────────────────────

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

  // ── Force abilities ──────────────────────────────────────────────────

  _forceAbility(msg) {
    const m = this.mob;
    if (!m?.alive) return;
    if (msg.ability === 'aoe') {
      m.requestAoe = true;
      this._logAudit('ARGUS_ABILITY', { ability: 'aoe' });
    } else if (msg.ability === 'enrage') {
      m.phase = 2;
      m.sprite?.setTint(0xff7a6b);
      if (!this._berserkApplied) { this._berserkApplied = true; this._applyBerserk(); }
      this._logAudit('ARGUS_ABILITY', { ability: 'enrage' });
    } else if (msg.ability === 'jump') {
      this._quantumJump();
      this._logAudit('ARGUS_ABILITY', { ability: 'jump' });
    }
  }

  // ── Remove mob ───────────────────────────────────────────────────────

  _removeMob() {
    this._destroyQuantumFX();
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

  onSceneRestart() {
    this._destroyQuantumFX();
    this.detachFromPlayer();
    this.mob = null;
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
    this.detachFromPlayer();
    this._destroyQuantumFX();
    this._ch?.close();
    this._ch = null;
  }
}
