import Mob from '../entities/Mob.js';
import { MOBS, HONOR } from '../constants.js';
import { galaxy } from '../galaxy.js';

const CHANNEL     = 'stellar-drift-admin';
const HEAL_CD     = 180;
const HEAL_PCT    = 0.30;
const TOP_REWARD  = 8;
const REWARD_GOLD = 100;

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
// Окно неуязвимости "квантовой фазы" — детерминированное по wall-clock (Date.now()),
// ТА ЖЕ формула на сервере (см. server _argus_phase_invincible) считает реальный
// дожд урона по этому же расписанию — единое окно для всех атакующих, не
// независимый рандом-таймер на каждом клиенте (было так раньше, см. диалог).
const FLICKER_PERIOD_NORMAL  = 3.0;
const FLICKER_PERIOD_BERSERK = 1.2;
const FLICKER_DURATION       = 0.4;
const BERSERK_HP     = 0.40;
const JUMP_DIST      = 400;   // px — дальность квантового прыжка

// Чисто косметическое мерцание на корабле ИГРОКА, когда он сам летает на Аргусе
// (DEV-клавиша 8, attachToPlayer) — не влияет на бой/неуязвимость (та детерминирована
// и общая, см. FLICKER_PERIOD_*/_isPhaseInvincible выше), только на себе, рандом ок.
const PLAYER_FLICKER_MIN = 2.0;
const PLAYER_FLICKER_MAX = 4.0;

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
    this._dmgHistory  = [];
    this._lastHull    = 0;

    // Quantum FX state
    this._layerWhite   = null;
    this._layerViolet  = null;
    this._layerBlue    = null;
    this._scanLine     = null;
    this._wasPhaseInvincible = false;
    this._scanT        = 0;
    this._blueOffX     = 4;
    this._violetOscT   = 0;
    this._berserkApplied = false;

    this._playerFX = null; // quantum layers attached to player ship
    this._remoteFX = new Map(); // userId → quantum layers attached to ДРУГИХ игроков на Аргусе

    // Player abilities
    this._pulsarData  = null;
    this._cocoonGfx   = null;
    this._cocoonTimer = 0;
    this._missileGfx  = null;
    this._missiles    = null;

    this._ch = null;
    try {
      this._ch = new BroadcastChannel(CHANNEL);
      this._ch.onmessage = ({ data }) => this._onMsg(data);
    } catch (_) {}
  }

  // ── Player-ship quantum FX (DEV key 8) ─────────────────────────────

  // Общие 3 тинтованных слоя-дубликата + скан-графика — используется и для своего
  // корабля (attachToPlayer), и для чужого (attachToRemotePlayer, см. ниже).
  _createQuantumLayers(sprite) {
    const gs     = this.scene;
    const texKey = sprite.texture.key;
    const dw     = sprite.displayWidth;
    const dh     = sprite.displayHeight;
    const x = sprite.x, y = sprite.y;
    // Depths around player (50): white/violet behind, blue just behind, scan above
    return {
      white:      gs.add.image(x, y, texKey).setDepth(48).setAlpha(0.15).setTint(0xe0f7fa).setDisplaySize(dw, dh).setBlendMode('ADD'),
      violet:     gs.add.image(x, y, texKey).setDepth(48).setAlpha(0.25).setTint(0xb39ddb).setDisplaySize(dw, dh).setBlendMode('ADD'),
      blue:       gs.add.image(x, y, texKey).setDepth(49).setAlpha(0.35).setTint(0x00d4ff).setDisplaySize(dw, dh).setBlendMode('ADD'),
      scan:       gs.add.graphics().setDepth(51),
      phaseTimer: 0,
      nextPhase:  PLAYER_FLICKER_MIN + Math.random() * (PLAYER_FLICKER_MAX - PLAYER_FLICKER_MIN),
      scanT:      0,
      blueOffX:   4,
    };
  }

  attachToPlayer(player) {
    this.detachFromPlayer();
    this._playerFX = { ...this._createQuantumLayers(player.sprite), player };

    // Auto-insert abilities into action bar slots 0–2
    const gs = this.scene;
    const bar = gs.actionBar || (gs.actionBar = Array(10).fill(null));
    bar[0] = 'argus:pulsar';
    bar[1] = 'argus:cocoon';
    bar[2] = 'argus:missiles';
    bar[3] = 'argus:phase_strike';
  }

  // Тот же косметический эффект, что и attachToPlayer, но на ДРУГОМ игроке (RemotePlayer)
  // — раньше был виден только владельцу собственного Аргуса, другие видели обычный
  // статичный корабль без переливания/скан-линии (баг из диалога: "игрок не видит эффект
  // фазового сдвига на корпусе Аргуса (аргус у другого игрока)"). Только пассивный
  // визуал (свечение/скан/мерцание) — активные способности (пульсар/кокон/ракеты)
  // остаются как раньше, только у владельца, это отдельная, более крупная задача.
  // Ключ — userId (переживает пересоздание rp не нужно, вызывается явно из
  // RemotePlayer.applyShip/destroy при смене корабля/уходе из комнаты).
  attachToRemotePlayer(rp) {
    this.detachFromRemotePlayer(rp.userId);
    this._remoteFX.set(rp.userId, { ...this._createQuantumLayers(rp.sprite), rp });
  }

  detachFromRemotePlayer(userId) {
    const fx = this._remoteFX.get(userId);
    if (!fx) return;
    fx.white?.destroy(); fx.violet?.destroy(); fx.blue?.destroy(); fx.scan?.destroy();
    this._remoteFX.delete(userId);
  }

  detachFromPlayer() {
    // Clear argus ability slots only if player is no longer on the Argus ship.
    // On scene.restart() (sector jump) the ship stays the same — keep the abilities.
    const bar = this.scene?.actionBar;
    if (bar && this.scene?.activeShip !== 'argus') {
      for (let i = 0; i < bar.length; i++) {
        if ((bar[i] + '').startsWith('argus:')) bar[i] = null;
      }
    }
    this._pulsarData?.beams?.destroy(); this._pulsarData = null;
    this._cocoonGfx?.destroy(); this._cocoonGfx = null;
    this._missileGfx?.destroy(); this._missileGfx = null; this._missiles = null;

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
      fx.nextPhase  = PLAYER_FLICKER_MIN + Math.random() * (PLAYER_FLICKER_MAX - PLAYER_FLICKER_MIN);
      const gs = this.scene;
      gs.tweens.add({ targets: p.sprite, alpha: { from: 1.0, to: 0.3 }, duration: 80, yoyo: true, repeat: 2, ease: 'Stepped' });
      fx.blueOffX = 4 + (Math.random() > 0.5 ? 8 : -8);
      gs.time.delayedCall(200, () => { if (fx === this._playerFX) fx.blueOffX = 4; });
      gs.tweens.add({ targets: fx.blue, alpha: { from: fx.blue.alpha, to: 0.7 }, duration: 100, yoyo: true, ease: 'Linear' });
    }

    this._updatePulsar(dt);
    this._updateCocoon(dt);
    this._updateMissiles(dt);
  }

  // Тот же визуал, что _updatePlayerQuantum, для каждого ДРУГОГО игрока на Аргусе
  // (см. attachToRemotePlayer). Скрываем слои, пока цель мертва (RemotePlayer.die()) —
  // без этого свечение осталось бы висеть на месте гибели, не следуя за респавном.
  _updateRemoteQuantum(dt) {
    for (const [userId, fx] of this._remoteFX) {
      const rp = fx.rp;
      if (!rp?.sprite) { this.detachFromRemotePlayer(userId); continue; }
      const visible = rp.alive;
      fx.white.setVisible(visible);
      fx.violet.setVisible(visible);
      fx.blue.setVisible(visible);
      fx.scan.setVisible(visible);
      if (!visible) continue;

      const x = rp.sprite.x, y = rp.sprite.y, rot = rp.sprite.rotation;
      fx.white.setPosition(x, y).setRotation(rot);
      fx.blue.setPosition(x + fx.blueOffX, y).setRotation(rot);
      fx.violet.setPosition(x - 4, y).setRotation(rot);

      fx.scanT = (fx.scanT + dt) % SCAN_PERIOD;
      fx.scan.clear();
      if (fx.scanT < SCAN_DURATION) {
        const prog  = fx.scanT / SCAN_DURATION;
        const halfH = rp.sprite.displayHeight / 2;
        const halfW = rp.sprite.displayWidth  / 2;
        fx.scan.fillStyle(0xe0f7fa, 0.15);
        fx.scan.fillRect(x - halfW, y - halfH + rp.sprite.displayHeight * prog, rp.sprite.displayWidth, 2);
      }

      fx.phaseTimer += dt;
      if (fx.phaseTimer >= fx.nextPhase) {
        fx.phaseTimer = 0;
        fx.nextPhase  = PLAYER_FLICKER_MIN + Math.random() * (PLAYER_FLICKER_MAX - PLAYER_FLICKER_MIN);
        const gs = this.scene;
        gs.tweens.add({ targets: rp.sprite, alpha: { from: 1.0, to: 0.3 }, duration: 80, yoyo: true, repeat: 2, ease: 'Stepped' });
        fx.blueOffX = 4 + (Math.random() > 0.5 ? 8 : -8);
        gs.time.delayedCall(200, () => { if (fx === this._remoteFX.get(userId)) fx.blueOffX = 4; });
        gs.tweens.add({ targets: fx.blue, alpha: { from: fx.blue.alpha, to: 0.7 }, duration: 100, yoyo: true, ease: 'Linear' });
      }
    }
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
      radius:   720,
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

    const NUM  = 8;
    const step = (Math.PI * 2) / NUM;
    const r    = pd.radius;
    const SEGS = 12; // segments per beam for tip fade
    pd.beams.clear();
    for (let i = 0; i < NUM; i++) {
      const a = pd.angle + i * step;
      for (let s = 0; s < SEGS; s++) {
        const t0   = s / SEGS;
        const t1   = (s + 1) / SEGS;
        const fade = 1.0 - (t0 + t1) * 0.5; // linear: opaque at center, transparent at tip
        const x0 = p.x + Math.cos(a) * r * t0, y0 = p.y + Math.sin(a) * r * t0;
        const x1 = p.x + Math.cos(a) * r * t1, y1 = p.y + Math.sin(a) * r * t1;
        pd.beams.lineStyle(12, 0x00d4ff, 0.22 * fade);
        pd.beams.lineBetween(x0, y0, x1, y1);
        pd.beams.lineStyle(2, 0xe0f7fa, 0.95 * fade);
        pd.beams.lineBetween(x0, y0, x1, y1);
      }
    }

    pd.dmgTimer += dt;
    if (pd.dmgTimer >= 0.1) {
      pd.dmgTimer -= 0.1;
      const HALF = 0.055; // ~3° beam half-width
      const r2   = r * r;
      // Точка (mob/RemotePlayer) в конусе ЛЮБОГО из NUM вращающихся лучей прямо сейчас?
      const inBeam = (x, y) => {
        const dx = x - p.x, dy = y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2 || d2 < 900) return false;
        const ma = Math.atan2(dy, dx);
        for (let i = 0; i < NUM; i++) {
          let diff = ((ma - (pd.angle + i * step)) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          if (diff < HALF) return true;
        }
        return false;
      };
      for (const mob of this.scene.mobs) {
        if (mob.alive && inBeam(mob.x, mob.y)) this._dealAbilityDamage(mob, 'argus_pulsar', 900);
      }
      // Вагоны/турели бронепоезда — см. _trainTargets/_dealAbilityDamage выше (баг из
      // диалога: "ракетный залп и квантовый пульсар не наносят урон турелям и вагонам").
      for (const t of this._trainTargets(p, r)) {
        if (inBeam(t.x, t.y)) this._dealAbilityDamage(t, 'argus_pulsar', 900);
      }
      // Раньше пульсар бил только this.scene.mobs — других игроков вообще не
      // рассматривал целью (баг из диалога: "не действуют на других игроков"). Урон по
      // игроку решает сервер (см. pvp_ability_fire_claim), не локальный takeDamage —
      // у RemotePlayer его и нет, и не должно быть (та же модель, что и у обычного PvP).
      const gs = this.scene;
      if (gs._isPvpSector) {
        for (const rp of gs.pvpClient?.players?.values() ?? []) {
          if (rp.alive && rp.corp !== gs.playerCorp && inBeam(rp.x, rp.y)) {
            this._dealAbilityDamage(rp, 'argus_pulsar', 900);
          }
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

  // ── Homing missiles ─────────────────────────────────────────────────

  // Раньше ракеты искали цель только среди this.scene.mobs — других игроков вообще не
  // рассматривали (баг из диалога: "не действуют на других игроков"). isRemotePlayer
  // (см. RemotePlayer.js) — существующий флаг, уже используемый для таргетинга/огня
  // в GameScene, различает Mob/RemotePlayer без instanceof.
  // Вагоны/турели бронепоезда — не в scene.mobs (лёгкие боевые прокси, см.
  // ArmoredTrain.js), раньше вообще не рассматривались целью ни пульсаром, ни
  // ракетами (баг из диалога: "ракетный залп и квантовый пульсар не наносят урон
  // турелям и вагонам") — они попросту никогда не попадали в список кандидатов.
  _trainTargets(p, radius) {
    const train = this.scene.armoredTrain;
    if (!train) return [];
    const out = [];
    for (const w of train.wagons) {
      if (w.alive && w.canBeAttacked && Math.hypot(w.x - p.x, w.y - p.y) < radius) out.push(w);
      for (const tt of w.turrets) {
        if (tt.alive && tt.canBeAttacked && Math.hypot(tt.x - p.x, tt.y - p.y) < radius) out.push(tt);
      }
    }
    return out;
  }

  _missileCandidates(p, radius) {
    const gs = this.scene;
    const mobs = gs.mobs.filter(m => m.alive && Math.hypot(m.x - p.x, m.y - p.y) < radius);
    const players = gs._isPvpSector
      ? [...(gs.pvpClient?.players?.values() ?? [])].filter(rp =>
          rp.alive && rp.corp !== gs.playerCorp && Math.hypot(rp.x - p.x, rp.y - p.y) < radius)
      : [];
    return [...mobs, ...players, ...this._trainTargets(p, radius)];
  }

  // Единая точка урона для активных способностей (пульсар/ракеты) — раньше мобы
  // (scene.mobs, включая те, у кого уже есть pvpMobId в PvP-комнате) получали урон
  // ЛОКАЛЬНЫМ takeDamage() напрямую, минуя общий сервер-леджер (см. PvpMobState) —
  // остальные клиенты комнаты этот урон вообще не видели, а следующий "нормальный"
  // выстрел по мобу читал нетронутое серверное HP поверх уже подешевевшего локального.
  // Теперь: RemotePlayer — как раньше (abilityFireClaim), любая pvpMobId-цель (моб/
  // турель/вагон) — через сервер (abilityMobFireClaim, см. server pvp_mob_fire_claim),
  // и только когда pvpClient совсем недоступен (соло/дев без сервера) — локальный
  // takeDamage напрямую, тот же фоллбэк, что и у обычного оружия (_localPvpFireResolve).
  _dealAbilityDamage(target, ability, dmg) {
    const gs = this.scene;
    if (target.isRemotePlayer) {
      gs.pvpClient?.abilityFireClaim(target.userId, ability, dmg);
    } else if (target.pvpMobId && gs.pvpClient) {
      gs.pvpClient.abilityMobFireClaim(target.pvpMobId, target.maxHull, target.maxShield, ability, dmg, target.wagonReward);
    } else {
      target.takeDamage(dmg, 0);
    }
  }

  _activateMissiles() {
    const fx = this._playerFX;
    if (!fx?.player?.alive) return;
    const p  = fx.player;
    const gs = this.scene;

    const MISSILE_COUNT  = 8;
    const MISSILE_DAMAGE = 2000;
    const DETECT_RADIUS  = 900;

    const nearby = this._missileCandidates(p, DETECT_RADIUS);

    this._missileGfx?.destroy();
    this._missileGfx = gs.add.graphics().setDepth(56);
    this._missiles   = [];

    for (let i = 0; i < MISSILE_COUNT; i++) {
      const target = nearby.length > 0 ? nearby[i % nearby.length] : null;
      const baseAngle = target
        ? Math.atan2(target.y - p.y, target.x - p.x)
        : (i / MISSILE_COUNT) * Math.PI * 2;
      this._missiles.push({ x: p.x, y: p.y, angle: baseAngle, speed: 580, target, life: 3.0, hit: false, damage: MISSILE_DAMAGE });
    }

    const nTargets = Math.min(nearby.length, MISSILE_COUNT);
    gs.log(`🚀 РАКЕТНЫЙ ЗАЛП — 8 ракет · 2000 урон${nearby.length === 0 ? ' (нет целей)' : ` · ${nTargets} цел.`}`);
  }

  _updateMissiles(dt) {
    if (!this._missiles) return;
    const gs = this.scene;

    let anyAlive = false;
    this._missileGfx.clear();

    for (const m of this._missiles) {
      if (m.hit || m.life <= 0) continue;
      anyAlive = true;
      m.life -= dt;

      // Retarget if current target died
      if (m.target && !m.target.alive) {
        m.target = this._missileCandidates(this._playerFX?.player ?? m, 900)[0] || null;
      }

      // Steer toward target
      if (m.target?.alive) {
        const desired = Math.atan2(m.target.y - m.y, m.target.x - m.x);
        let diff = desired - m.angle;
        // normalise to [-π, π]
        diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        const turn = Math.min(Math.abs(diff), 4.5 * dt);
        m.angle += Math.sign(diff) * turn;
      }

      m.x += Math.cos(m.angle) * m.speed * dt;
      m.y += Math.sin(m.angle) * m.speed * dt;

      // Hit check
      if (m.target?.alive) {
        const dist = Math.hypot(m.target.x - m.x, m.target.y - m.y);
        if (dist < 45) {
          // Раньше — только m.target.takeDamage(...), не работавший бы вовсе на
          // RemotePlayer (нет такого метода, см. баг из диалога), и локально/без сервера
          // для мобов/турелей/вагонов (см. _dealAbilityDamage выше — тот же фикс, что и у
          // пульсара, для "ракетный залп не наносит урон турелям и вагонам").
          this._dealAbilityDamage(m.target, 'argus_missile', m.damage);
          m.hit = true;
          gs.explosion?.(m.x, m.y, 0.4);
          continue;
        }
      }

      // Draw missile: body + nose + exhaust trail
      const ca = Math.cos(m.angle), sa = Math.sin(m.angle);
      const nx = -sa, ny = ca; // perpendicular (normal)

      // Exhaust trail — 3 fading segments behind
      this._missileGfx.lineStyle(6, 0xff4400, 0.35);
      this._missileGfx.lineBetween(m.x - ca * 22, m.y - sa * 22, m.x - ca * 40, m.y - sa * 40);
      this._missileGfx.lineStyle(4, 0xff8800, 0.55);
      this._missileGfx.lineBetween(m.x - ca * 10, m.y - sa * 10, m.x - ca * 24, m.y - sa * 24);
      this._missileGfx.lineStyle(3, 0xffcc44, 0.8);
      this._missileGfx.lineBetween(m.x, m.y - sa * 2, m.x - ca * 12, m.y - sa * 12);

      // Body — tapered rectangle (4 vertices)
      const bL = 20, bW = 5; // body length, half-width
      const p0x = m.x + ca * bL + nx * bW,  p0y = m.y + sa * bL + ny * bW;
      const p1x = m.x + ca * bL - nx * bW,  p1y = m.y + sa * bL - ny * bW;
      const p2x = m.x - ca * 2  - nx * bW,  p2y = m.y - sa * 2  - ny * bW;
      const p3x = m.x - ca * 2  + nx * bW,  p3y = m.y - sa * 2  + ny * bW;
      this._missileGfx.fillStyle(0xffcc44, 1);
      this._missileGfx.fillPoints([
        { x: p0x, y: p0y }, { x: p1x, y: p1y },
        { x: p2x, y: p2y }, { x: p3x, y: p3y },
      ], true);

      // Nose cone — triangle
      const nTip  = bL + 10;
      this._missileGfx.fillStyle(0xffffff, 0.95);
      this._missileGfx.fillTriangle(
        m.x + ca * nTip,          m.y + sa * nTip,
        m.x + ca * bL + nx * bW,  m.y + sa * bL + ny * bW,
        m.x + ca * bL - nx * bW,  m.y + sa * bL - ny * bW,
      );
    }

    if (!anyAlive) {
      this._missileGfx.destroy();
      this._missileGfx = null;
      this._missiles   = null;
    }
  }

  _activatePhaseStrike() {
    const fx = this._playerFX;
    if (!fx?.player?.alive) return;
    const p  = fx.player;
    const gs = this.scene;

    // Find target: current target or nearest mob
    const target = (gs.target?.alive ? gs.target : null)
      || gs.mobs.filter(m => m.alive).sort((a, b) =>
          Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];

    if (!target) { gs.log('🌀 Фазовый удар — нет целей'); return; }

    // Disrupt mob aim for 3 seconds
    gs.mobAimDisrupted = true;
    gs.time.delayedCall(3000, () => { gs.mobAimDisrupted = false; });

    gs.log('🌀 ФАЗОВЫЙ УДАР — прицел врагов сбит на 3с');

    // Destination: 280px past the target along the approach vector (= behind the target)
    const approachAngle = Math.atan2(target.y - p.y, target.x - p.x);
    const destX = Math.max(120, Math.min(gs.worldWidth  - 120, target.x + Math.cos(approachAngle) * 280));
    const destY = Math.max(120, Math.min(gs.worldHeight - 120, target.y + Math.sin(approachAngle) * 280));

    // Phase-out: all FX layers vanish
    const layers = [p.sprite, this._playerFX?.white, this._playerFX?.violet, this._playerFX?.blue].filter(Boolean);
    layers.forEach(l => gs.tweens.add({ targets: l, alpha: 0, duration: 80 }));

    gs.time.delayedCall(100, () => {
      if (!p.alive) return;

      // Camera pans to destination (280ms), then we teleport and resume follow
      const cam = gs.cameras.main;
      cam.stopFollow();
      cam.pan(destX, destY, 280, 'Quad.easeInOut');

      gs.time.delayedCall(300, () => {
        if (!p.alive) { cam.startFollow(p.sprite, false, 0.15, 0.15); return; }

        // Teleport player to destination
        p.sprite.setPosition(destX, destY);
        if (p.sprite.body) p.sprite.body.reset(destX, destY);

        // Rotate nose to face the target immediately
        const faceAngle = Math.atan2(target.y - destY, target.x - destX);
        p.facing = faceAngle;
        p.sprite.rotation = faceAngle + (p.ship?.artAngleOffset ?? Math.PI / 2);

        // Phase-in: layers reappear
        const restoreAlphas = [1, 0.15, 0.25, 0.35];
        layers.forEach((l, i) => gs.tweens.add({ targets: l, alpha: restoreAlphas[i] ?? 1, duration: 120 }));

        // Resume camera follow
        cam.startFollow(p.sprite, false, 0.15, 0.15);
      });
    });
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
      // Прямая правка: фиксированные 5%/сек от maxShield (shieldRegenFullSec=20 → 100%/20с
      // = 5%/с, не зависит от абсолютного размера пула). Задержка была 500мс — этого
      // хватало при 1-2 атакующих, но при реальном рейде (несколько игроков стреляют
      // почти непрерывно) паузы МЕЖДУ выстрелами разных игроков всё равно чаще 500мс
      // почти не бывает, так что реген фактически никогда не успевал начаться — жалоба
      // "всё равно восстанавливается медленно" была именно про это, не про саму ставку
      // 5%/с. Задержка убрана вовсе — реген теперь идёт непрерывно вместе с боем, как
      // встречный "тик" против входящего урона, а не гейтится паузами в стрельбе.
      shieldRegenDelay: 0, shieldRegenFullSec: 20,
    });
    // Аргус — мобовский босс, бой и награды как у босса в групповом данже: реальный
    // общий (не per-client-local) HP/урон через тот же pvpMobId-леджер, что и
    // остальные PvP-мобы/групповые боссы (см. GameScene._fireCannon/_onPvpMobHitResult
    // — они уже обрабатывают ЛЮБОЙ mob.pvpMobId одинаково, отдельного кода не нужно).
    // Раньше был чисто per-client-local Mob без pvpMobId — реальные разные игроки не
    // делили ни HP, ни честный учёт урона (см. диалог "сейчас это дыра").
    this.mob.isArgusBoss = true;
    this.mob.pvpMobId = gs._realtimeRoomKey ? `${gs._realtimeRoomKey}:argus` : null;
    gs.mobs.push(this.mob);

    // Reset per-spawn state (_damageMap заменён на this.mob._damageBy — реальный
    // кросс-клиентский учёт через pvpMobId, см. GameScene._onPvpMobHitResult)
    this._dmgHistory     = [];
    this._healTimer      = 0;
    this._moveTimer      = 0;
    this._orbitAngle     = 0;
    this._movePhase      = 'approach';
    this._orbitModeT     = 0;
    this._wasPhaseInvincible = false;
    this._scanT          = 0;
    this._blueOffX       = 4;
    this._violetOscT     = 0;
    this._berserkApplied = false;

    this._lastHull = this.mob.hull;

    // Mob ability cooldowns (seconds until next use; offset so they don't fire simultaneously)
    this._mobPulsarCd    = 20;
    this._mobMissileCd   = 35;
    this._mobPulsarData  = null;
    this._mobMissileData = null;
    this._mobMissileGfx  = null;

    this._setupQuantumFX();

    gs.log('⚠ АРГУС вышел на орбиту — уровень ' + level);
    this._logAudit('ARGUS_SPAWN', { level, sector: galaxy.current });
    this._broadcast();
  }

  _despawn() {
    if (!this.mob) return;
    this._removeMob();
    this.scene.log('АРГУС отступил.');
    this._logAudit('ARGUS_DESPAWN', {});
    this._broadcast();
  }

  _heal(msg) {
    const m = this.mob;
    if (!m?.alive) return;
    const pct = Math.min(1, Math.max(0, msg.pct ?? HEAL_PCT));
    m.hull   = Math.min(m.maxHull,   m.hull   + m.maxHull   * pct);
    m.shield = Math.min(m.maxShield, m.shield + m.maxShield * pct);
    this.scene.log(`💚 АРГУС восстановил ${Math.round(pct * 100)}% HP и щита.`);
    this._logAudit('ARGUS_HEAL', { pct });
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

    // Окно неуязвимости — не собственный рандом-таймер, а детерминированная функция
    // wall-clock (см. _isPhaseInvincible) — та же формула, что сервер реально
    // применяет как evasion=1.0 при резолве урона (см. server _argus_phase_invincible).
    // Триггерим визуальный "мерцающий" эффект по фронту false→true.
    const hullFrac = m.maxHull > 0 ? m.hull / m.maxHull : 1;
    const invincibleNow = this._isPhaseInvincible(hullFrac);
    if (invincibleNow && !this._wasPhaseInvincible) this._triggerPhaseFlicker();
    this._wasPhaseInvincible = invincibleNow;

    // Auto-trigger berserk at 40% hull
    if (!this._berserkApplied && m.maxHull > 0 && m.hull / m.maxHull < BERSERK_HP) {
      this._berserkApplied = true;
      m.phase = 2;
      this._applyBerserk();
    }
  }

  // Детерминированная (wall-clock, Date.now()) проверка — ИДЕНТИЧНАЯ формула на
  // сервере (см. server _argus_phase_invincible) реально режектит урон, попавший в
  // это окно (evasion=1.0). Общая для всех клиентов эпоха — без неё каждый клиент
  // видел бы своё, несовпадающее окно.
  _isPhaseInvincible(hullFrac) {
    const period = hullFrac < BERSERK_HP ? FLICKER_PERIOD_BERSERK : FLICKER_PERIOD_NORMAL;
    return (Date.now() / 1000) % period < FLICKER_DURATION;
  }

  _triggerPhaseFlicker() {
    const m  = this.mob;
    const gs = this.scene;
    if (!m?.alive) return;

    // Раньше тут ещё стоял this._phaseInvincible (100% "уклонение" на 400мс) — работал
    // через takeDamage-wrapper, которого больше нет (урон теперь серверно-авторитетный
    // через pvpMobId, см. _spawn) — как и у обычного босса в групповом данже, там тоже
    // нет клиентского окна неуязвимости поверх сервера. Остаётся чисто визуальный эффект.

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

  // ── Mob active abilities (pulsar + missiles, 60s CD each) ───────────

  _updateMobAbilities(dt) {
    const m  = this.mob;
    const gs = this.scene;
    const p  = gs.player;
    if (!m?.alive || !p?.alive) return;

    // ── Mob pulsar cooldown ──
    this._mobPulsarCd -= dt;
    if (this._mobPulsarCd <= 0) {
      this._mobPulsarCd = 60;
      this._mobPulsarData?.gfx?.destroy();
      this._mobPulsarData = { gfx: gs.add.graphics().setDepth(41), elapsed: 0, duration: 4.0, angle: 0, radius: 700, dmgTimer: 0 };
      gs.log('⚡ АРГУС: квантовый пульсар');
    }

    // ── Mob pulsar update ──
    const pd = this._mobPulsarData;
    if (pd) {
      pd.elapsed += dt;
      if (pd.elapsed >= pd.duration) {
        pd.gfx.destroy(); this._mobPulsarData = null;
      } else {
        const speed = 1.5 + (pd.elapsed / pd.duration) * 1.5;
        pd.angle += speed * dt;
        const NUM = 8, step = (Math.PI * 2) / NUM, r = pd.radius;
        pd.gfx.clear();
        for (let i = 0; i < NUM; i++) {
          const a = pd.angle + i * step;
          const ex = m.x + Math.cos(a) * r, ey = m.y + Math.sin(a) * r;
          pd.gfx.lineStyle(12, 0x00d4ff, 0.22);
          pd.gfx.lineBetween(m.x, m.y, ex, ey);
          pd.gfx.lineStyle(2, 0xe0f7fa, 0.95);
          pd.gfx.lineBetween(m.x, m.y, ex, ey);
        }
        // Damage player if caught in a beam
        pd.dmgTimer += dt;
        if (pd.dmgTimer >= 0.1) {
          pd.dmgTimer -= 0.1;
          const HALF = 0.055;
          const dx = p.x - m.x, dy = p.y - m.y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r * r && d2 >= 900) {
            const ma = Math.atan2(dy, dx);
            for (let i = 0; i < NUM; i++) {
              let diff = ((ma - (pd.angle + i * step)) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
              if (diff > Math.PI) diff = Math.PI * 2 - diff;
              if (diff < HALF) { p.takeDamage(900, 0, { ignoreMovEvasion: false }); break; }
            }
          }
        }
      }
    }

    // ── Mob missiles cooldown ──
    this._mobMissileCd -= dt;
    if (this._mobMissileCd <= 0 && !this._mobMissileData) {
      this._mobMissileCd = 60;
      this._mobMissileGfx?.destroy();
      this._mobMissileGfx = gs.add.graphics().setDepth(56);
      this._mobMissileData = [];
      for (let i = 0; i < 8; i++) {
        const spread = (i / 8) * Math.PI * 2;
        const baseAngle = Math.atan2(p.y - m.y, p.x - m.x) + (Math.random() - 0.5) * 0.4;
        this._mobMissileData.push({ x: m.x, y: m.y, angle: baseAngle + spread * 0.1, speed: 480, life: 4.0, hit: false });
      }
      gs.log('🚀 АРГУС: ракетный залп');
    }

    // ── Mob missiles update ──
    const missiles = this._mobMissileData;
    if (missiles) {
      let anyAlive = false;
      this._mobMissileGfx.clear();
      for (const mis of missiles) {
        if (mis.hit || mis.life <= 0) continue;
        anyAlive = true;
        mis.life -= dt;
        // Steer toward player
        if (p.alive) {
          const desired = Math.atan2(p.y - mis.y, p.x - mis.x);
          let diff = desired - mis.angle;
          diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
          mis.angle += Math.sign(diff) * Math.min(Math.abs(diff), 4.0 * dt);
        }
        mis.x += Math.cos(mis.angle) * mis.speed * dt;
        mis.y += Math.sin(mis.angle) * mis.speed * dt;
        // Hit check
        if (p.alive && Math.hypot(p.x - mis.x, p.y - mis.y) < 40) {
          p.takeDamage(2000, 0);
          mis.hit = true;
          gs.explosion?.(mis.x, mis.y, 0.4);
          continue;
        }
        // Draw
        const ca = Math.cos(mis.angle), sa = Math.sin(mis.angle);
        const nx = -sa, ny = ca;
        this._mobMissileGfx.lineStyle(6, 0xff4400, 0.35);
        this._mobMissileGfx.lineBetween(mis.x - ca * 22, mis.y - sa * 22, mis.x - ca * 40, mis.y - sa * 40);
        this._mobMissileGfx.lineStyle(4, 0xff8800, 0.55);
        this._mobMissileGfx.lineBetween(mis.x - ca * 10, mis.y - sa * 10, mis.x - ca * 24, mis.y - sa * 24);
        this._mobMissileGfx.lineStyle(3, 0xffcc44, 0.8);
        this._mobMissileGfx.lineBetween(mis.x, mis.y, mis.x - ca * 12, mis.y - sa * 12);
        const bL = 20, bW = 5;
        this._mobMissileGfx.fillStyle(0xffcc44, 1);
        this._mobMissileGfx.fillPoints([
          { x: mis.x + ca * bL + nx * bW, y: mis.y + sa * bL + ny * bW },
          { x: mis.x + ca * bL - nx * bW, y: mis.y + sa * bL - ny * bW },
          { x: mis.x - ca * 2  - nx * bW, y: mis.y - sa * 2  - ny * bW },
          { x: mis.x - ca * 2  + nx * bW, y: mis.y - sa * 2  + ny * bW },
        ], true);
        this._mobMissileGfx.fillStyle(0xffffff, 0.95);
        this._mobMissileGfx.fillTriangle(
          mis.x + ca * (bL + 10), mis.y + sa * (bL + 10),
          mis.x + ca * bL + nx * bW, mis.y + sa * bL + ny * bW,
          mis.x + ca * bL - nx * bW, mis.y + sa * bL - ny * bW,
        );
      }
      if (!anyAlive) {
        this._mobMissileGfx.destroy(); this._mobMissileGfx = null; this._mobMissileData = null;
      }
    }
  }

  _quantumJump() {
    const m  = this.mob;
    const p  = this.scene.player;
    const gs = this.scene;
    if (!m?.alive || !p) return;

    // Квантовый прыжок сбивает прицел, если Аргус был текущей целью — телепорт "за
    // спину" уводит его из-под удержанного лока, автоатака не должна тупо продолжать
    // стрелять в пустоту на старой позиции; повторный лок — заново вручную.
    if (gs.target === m) { gs.target = null; gs.isFiring = false; }

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
      // Реальный урон теперь приходит серверно-авторитетно (mob.hull мутируется извне
      // через _onPvpMobHitResult, см. pvpMobId в _spawn) — раньше это ловил takeDamage-
      // wrapper, которого больше нет. _getRecentDps() (триггер orbit-фазы) кормим
      // разницей hull кадр-к-кадру вместо этого; self-heal тоже поднимает hull, но это
      // редкий и заметный скачок вверх (lost<0 просто игнорируется ниже).
      const lost = this._lastHull - this.mob.hull;
      if (lost > 0) this._dmgHistory.push({ ts: Date.now(), amount: lost });
      this._lastHull = this.mob.hull;

      this._updateMovement(dt);
      this._updateQuantum(dt);
      this._updateSelfHeal(dt);
      this._updateMobAbilities(dt);
    }
    this._updatePlayerQuantum(dt);
    this._updateRemoteQuantum(dt);

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

  _clearMobAbilityFX() {
    this._mobPulsarData?.gfx?.destroy(); this._mobPulsarData = null;
    this._mobMissileGfx?.destroy(); this._mobMissileGfx = null; this._mobMissileData = null;
  }

  _removeMob() {
    this._clearMobAbilityFX();
    this._destroyQuantumFX();
    const m = this.mob;
    if (!m) return;
    if (m.alive) m.die();
    m.sprite?.destroy();
    m.label?.destroy();
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
    // Реальный кросс-клиентский учёт урона — mob._damageBy, тот же общий механизм, что
    // и у обычного босса в групповом данже (см. GameScene._onPvpMobHitResult, копится
    // там же по pvpMobId, не свой отдельный _damageMap только по себе).
    const by = this.mob?._damageBy || {};
    const totalDmg = Object.values(by).reduce((s, d) => s + d, 0);
    const sorted = Object.entries(by)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_REWARD)
      .map(([name, dmg]) => ({ name, dmg: Math.round(dmg) }));

    const myName = gs.playerName ?? 'Player';
    const inTop = sorted.some(p => p.name === myName);

    if (inTop) {
      gs.starGold = (gs.starGold || 0) + REWARD_GOLD;
      gs.log(`🏆 АРГУС ПОВЕРЖЕН! Топ-${TOP_REWARD} по урону: +${REWARD_GOLD} ⭐`);
      if (gs.seasonWon) {
        gs.gainCorpRep?.(0.10);
        gs.log('🏅 Сезонный бонус: +10% корпоративный рейтинг');
      }
      // Честь — как у обычного босса (BOSS_HIGHER/EQUAL/LOWER по уровню Аргуса
      // относительно своего), помноженная на реальную (кросс-клиентскую) долю урона —
      // не фиксированный HONOR.ARGUS всем в топ-8, см. диалог "как у босса в групповом
      // данже". Округление математическое.
      const pl = gs.pilotLevel || 1;
      const argusLevel = this.mob?.level ?? 50;
      const tier = argusLevel > pl ? HONOR.BOSS_HIGHER : argusLevel === pl ? HONOR.BOSS_EQUAL : HONOR.BOSS_LOWER;
      const myShare = totalDmg > 0 ? (by[myName] || 0) / totalDmg : 0;
      const honorGain = Math.round(tier * myShare);
      if (honorGain > 0) gs.gainHonor?.(honorGain);
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
    this._clearMobAbilityFX();
    this.detachFromPlayer();
    for (const userId of [...this._remoteFX.keys()]) this.detachFromRemotePlayer(userId);
    this._destroyQuantumFX();
    this._ch?.close();
    this._ch = null;
  }
}
