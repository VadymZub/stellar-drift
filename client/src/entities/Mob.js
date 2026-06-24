import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { ART_ANGLE_OFFSET, COLORS, UI_RES, MOB_REGEN, BOSS } from '../constants.js';
import { i18n } from '../i18n.js';

function scaleStat(base, level) { return Math.round(base * (1 + 0.5 * (level - 1))); }

export default class Mob {
  // opts: { behavior:'patrol'|'guard'|'roam', patrolRadius, leash, passive, bossRef, orbitLeader, pathDeviation, targets }
  constructor(scene, template, level, x, y, opts = {}) {
    this.scene = scene;
    this.tpl = template;
    this.level = level;
    this.spawnX = x;
    this.spawnY = y;

    this.behavior      = opts.behavior      || 'patrol';
    this.patrolRadius  = opts.patrolRadius  ?? template.patrolRadius ?? 240;
    this.leash         = opts.leash         ?? template.leash ?? Infinity;
    this.targets       = opts.targets       || null;
    this.pathDeviation = opts.pathDeviation || 0;
    this.patrolTarget  = null;
    this.patrolWaitUntil = 0;

    // Ссылка на босса для орбитального патруля охранников
    this.bossRef = opts.bossRef || null;
    this._orbitAngle = Math.random() * Math.PI * 2;
    this._orbitSpeed = 0.35 + Math.random() * 0.25;

    this.maxHull   = scaleStat(template.hull,   level);
    this.maxShield = scaleStat(template.shield, level);
    this.damage    = scaleStat(template.damage, level);
    this.hull      = this.maxHull;
    this.shield    = this.maxShield;

    const mobTexKey = template._prerenderKey || template.key;
    this.sprite = template.anim
      ? scene.add.sprite(x, y, template.sheetKey).setDepth(40)
      : scene.add.image(x, y, mobTexKey).setDepth(40);
    scene.physics.add.existing(this.sprite);
    if (template.anim) this.sprite.play(template.anim);
    const src = template.anim ? null : scene.textures.get(mobTexKey).getSourceImage();
    const natW = template.anim ? template.frameW : (src.naturalWidth ?? src.width);
    const natH = template.anim ? template.frameH : (src.naturalHeight ?? src.height);
    const finalSize = template.displaySize * (this.scene.objScale || 1.0);
    const sc = finalSize / Math.max(natW, natH);
    this.sprite.setDisplaySize(natW * sc, natH * sc);
    this.heading = Phaser.Math.FloatBetween(-Math.PI, Math.PI);

    const label = `${i18n.t(template.nameKey)} ${i18n.t('mob.level')}${level}`;
    this.label = scene.add.text(x, y, label, {
      fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#ef5350', resolution: UI_RES,
    }).setOrigin(0.5, 0).setDepth(41);

    this.bar    = scene.add.graphics().setDepth(41);
    this.fireCooldown  = 0;
    this.lastDamageAt  = -100000;
    this.isBoss  = !!template.boss;
    this.neutral = template.neutral || false;
    // passive: не агрится на игрока (даже при атаке не переходит в aggro)
    this.passive = opts.passive || false;
    this.alive   = true;
    this.state   = 'idle';

    this.leader = opts.leader || null;
    this.group  = [];
    if (this.leader) this.leader.group.push(this);
    // orbitLeader: дрон держит орбиту вокруг лидера вместо следования за ним
    this.orbitLeader = opts.orbitLeader || false;

    this.phase    = 1;
    this.aoeTimer = this.isBoss ? BOSS.aoeCooldownP1 : 0;

    // Leash hysteresis — плавный возврат на базу без дёргания
    this._returning = false;

    // AI-класс способностей
    this._abilityTimer  = 0;
    this._abilityActive = false;
    this._abilityData   = {};
    // berserker: активируется при HP < 50% — один раз
    this._berserkerOn   = false;
    // shielder: флаг активности ауры
    this._shieldAura    = false;
    this._shieldAuraTimer = 0;

    // Boss archetypes
    // roaming: синусоидальный маршрут, флаг побега
    this._roamHeading   = Phaser.Math.FloatBetween(-Math.PI, Math.PI);
    this._roamTimer     = Phaser.Math.FloatBetween(8, 14);
    this._fleeing       = false;
    this._fleeTimer     = 0;
    this._scatterTimer  = 0;

    // dungeon boss (apophis): фазы
    this._apophisPhase  = 1;
    this._apophisSummonDone = false;
    this._apophisDashTimer  = 0;
    this._apophisVoidTimer  = 0;
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  takeDamage(amount, penetration = 0, opts = {}) {
    if (!this.alive) return { shieldHit: 0, hullHit: 0, killed: false };
    this.lastDamageAt = this.scene.time.now;

    if (!opts.ignoreMovEvasion) {
      const body = this.sprite?.body;
      if (body) {
        const spd = Math.sqrt(body.velocity.x ** 2 + body.velocity.y ** 2);
        const movEvasion = Math.min(0.20, spd / 1500);
        if (movEvasion > 0 && Math.random() < movEvasion) return { shieldHit: 0, hullHit: 0, killed: false, dodged: true };
      }
    }

    // Пассивные мобы агрятся при атаке игрока
    if (this.passive) {
      this.passive = false;
      this.state   = 'aggro';
      // Ближайшие пассивные союзники в 600px тоже реагируют
      if (this.scene.mobs) {
        this.scene.mobs.forEach(m => {
          if (m !== this && m.alive && m.passive) {
            const d = Phaser.Math.Distance.Between(this.x, this.y, m.x, m.y);
            if (d < 600) { m.passive = false; m.state = 'aggro'; }
          }
        });
      }
    }
    if (this.neutral && !this.passive) {
      this.neutral = false;
      this.state   = 'aggro';
      if (this.leader) { this.leader.neutral = false; this.leader.state = 'aggro'; }
      this.group.forEach(m => { m.neutral = false; m.state = 'aggro'; });
    }

    const shieldMult = opts.shieldMult ?? 1;
    const hullMult   = opts.hullMult   ?? 1;
    const direct     = amount * penetration;
    const toShieldRaw = amount - direct;
    let hullHit   = 0;
    let shieldHit = 0;

    if (this.shield > 0) {
      hullHit = direct * hullMult;
      const toShield = toShieldRaw * shieldMult;
      shieldHit = toShield;
      if (toShield <= this.shield) { this.shield -= toShield; }
      else { hullHit += (toShield - this.shield) * hullMult; this.shield = 0; }
    } else {
      hullHit = amount * hullMult;
    }

    // shielder-аура: -30% урон соседним мобам
    if (this._shieldAura) hullHit *= 0.7;

    this.hull -= hullHit;
    if (isNaN(this.hull)) this.hull = 0;
    let killed = false;
    if (this.hull <= 0) { this.hull = 0; killed = true; this.die(); }
    return { shieldHit, hullHit, killed };
  }

  die() {
    this.alive = false;
    this.sprite.setVisible(false);
    this.label.setVisible(false);
    this.bar.setVisible(false);
    if (this.leader) {
      const idx = this.leader.group.indexOf(this);
      if (idx !== -1) this.leader.group.splice(idx, 1);
    }
  }

  respawn() {
    this.hull   = this.maxHull;
    this.shield = this.maxShield;
    this.sprite.setPosition(this.spawnX, this.spawnY).setVisible(true).clearTint();
    this.label.setVisible(true);
    this.bar.setVisible(true);
    this.alive   = true;
    this.state   = 'idle';
    this.neutral = this.tpl.neutral || false;
    this.phase   = 1;
    this.aoeTimer = this.isBoss ? BOSS.aoeCooldownP1 : 0;
    this._returning      = false;
    this._berserkerOn    = false;
    this._apophisPhase   = 1;
    this._apophisSummonDone = false;
    this._fleeing        = false;
  }

  enterEnrage() {
    this.phase = 2;
    this.sprite.setTint(BOSS.enrageTint);
    this.aoeTimer = Math.min(this.aoeTimer, 1500);
    this.scene.log(i18n.t('log.boss_enrage', { name: i18n.t(this.tpl.nameKey) }));
  }

  update(dt, player, playerInSafeZone, fireProjectile) {
    if (!this.alive) return;

    const now = this.scene.time.now;
    const sinceDmg = now - this.lastDamageAt;

    // Реген щита и корпуса
    if (this.maxShield > 0 && sinceDmg > MOB_REGEN.shieldDelay && this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + (this.maxShield / MOB_REGEN.shieldFullSec) * dt);
    }
    if (this.isBoss && sinceDmg > MOB_REGEN.bossHullDelay && this.hull < this.maxHull) {
      this.hull = Math.min(this.maxHull, this.hull + this.maxHull * MOB_REGEN.bossHullPctPerSec * dt);
    }

    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    const playerStealthed = (this.scene._stealthEndTime || 0) > now || (this.scene._phantomCloakEndTime || 0) > now;

    // ── Смена состояний ───────────────────────────────────────────────────────
    if (this.passive || playerInSafeZone || !player.alive || playerStealthed) {
      this.state = 'idle';
    } else if (this._returning) {
      this.state = 'idle'; // во время возврата игнорируем агро
    } else if (dist < this.tpl.aggro * (player.aggroRadiusMod ?? 1)) {
      if (!this.neutral) this.state = 'aggro';
    } else if (dist > this.tpl.aggro * (player.aggroRadiusMod ?? 1) * 1.6) {
      this.state = 'idle';
    }

    // ── Leash hysteresis ──────────────────────────────────────────────────────
    const fromAnchor = Phaser.Math.Distance.Between(this.x, this.y, this.spawnX, this.spawnY);
    if (!this._returning && fromAnchor > this.leash * 1.05 && this.leash < Infinity) {
      this._returning = true;
      this.state      = 'idle';
    }
    if (this._returning && fromAnchor < this.leash * 0.75) {
      this._returning = false;
    }

    let moveSpeed = 0;

    // ── Возврат на базу ───────────────────────────────────────────────────────
    if (this._returning) {
      this.heading = Math.atan2(this.spawnY - this.y, this.spawnX - this.x);
      moveSpeed    = this.tpl.speed * 0.85;
      this._applyVelocity(moveSpeed);
      this._updateVisuals();
      return;
    }

    // ── Состояние AGGRO ───────────────────────────────────────────────────────
    if (this.state === 'aggro') {
      // Фаза 2 / ярость
      if (this.isBoss && this.phase === 1 && this.hull / this.maxHull <= BOSS.enrageAt) {
        this.enterEnrage();
      }
      const enraged   = this.isBoss && this.phase >= 2;
      const fireMult  = enraged ? BOSS.enrageFireMult  : 1;
      const speedMult = enraged ? BOSS.enrageSpeedMult : 1;

      // Berserker: при HP < 50% — постоянный буфф
      if (this.tpl.aiClass === 'berserker' && !this._berserkerOn && this.hull / this.maxHull < 0.5) {
        this._berserkerOn = true;
      }
      const berserkFire  = this._berserkerOn ? 1.3 : 1;
      const berserkSpeed = this._berserkerOn ? 1.4 : 1;

      // Roaming boss: синусоидальный маршрут + побег при низком HP
      if (this.isBoss && this.tpl.bossType === 'roaming') {
        moveSpeed = this._updateRoaming(dt, dist, player, speedMult);
        this._updateBossAoe(dt, dist);
        this._updateScatterShot(dt, fireProjectile);
        this.fireCooldown -= dt;
        if (this.fireCooldown <= 0 && dist <= this.tpl.range) {
          this.fireCooldown = 1 / (this.tpl.fireRate * fireMult * berserkFire);
          fireProjectile(this, player.x, player.y);
        }
      } else if (this.isBoss && this.tpl.bossType === 'dungeon') {
        // Apophis: многофазный босс данжа
        moveSpeed = this._updateApophis(dt, dist, player, speedMult, fireProjectile);
        this._updateBossAoe(dt, dist);
      } else {
        // Стандартный aggro
        let targetX = player.x, targetY = player.y;
        if (this.leader && this.leader.alive) {
          const ang = Math.atan2(player.y - this.leader.y, player.x - this.leader.x);
          targetX = this.leader.x + Math.cos(ang) * 120;
          targetY = this.leader.y + Math.sin(ang) * 120;
        }
        this.heading = Math.atan2(targetY - this.y, targetX - this.x);

        if (dist > this.tpl.range && fromAnchor < this.leash) {
          moveSpeed = this.tpl.speed * speedMult * berserkSpeed;
        }

        // AI-класс: dasher
        if (this.tpl.aiClass === 'dasher') {
          this._updateDasher(dt, dist, speedMult);
          if (this._abilityActive) moveSpeed = this.tpl.speed * 2.0;
        }
        // AI-класс: cloaker
        if (this.tpl.aiClass === 'cloaker') {
          this._updateCloaker(dt, player);
        }
        // AI-класс: shielder
        if (this.tpl.aiClass === 'shielder') {
          this._updateShielder(dt);
        }

        // Стрельба
        this.fireCooldown -= dt;
        if (dist <= this.tpl.range && fromAnchor < this.leash + 80 && this.fireCooldown <= 0) {
          this.fireCooldown = 1 / (this.tpl.fireRate * fireMult * berserkFire);
          // gunner: повышенная скорострельность (уже в шаблоне, дополнительно +25% — через меньший cooldown)
          if (this.tpl.aiClass === 'gunner') this.fireCooldown *= 0.8;
          fireProjectile(this, player.x, player.y);
        }

        // AoE для static/default боссов
        if (this.isBoss) this._updateBossAoe(dt, dist);
      }

    } else {
      // ── Состояние IDLE: патруль / сопровождение / орбита ──────────────────
      if (this.leader && this.leader.alive) {
        moveSpeed = this.orbitLeader
          ? this._orbitAround(dt, this.leader.x, this.leader.y, this.leader.tpl.displaySize * 5)
          : this.escort(dt);
      } else if (this.bossRef && this.bossRef.alive) {
        // Охранник: орбита вокруг босса
        moveSpeed = this._orbitAround(dt, this.bossRef.x, this.bossRef.y, this.bossRef.tpl.displaySize * 2.5);
      } else {
        moveSpeed = this.patrol(now);
      }
    }

    this._applyVelocity(moveSpeed);
    this._updateVisuals();
  }

  // ── Движение и отрисовка ──────────────────────────────────────────────────
  _applyVelocity(speed) {
    if (speed > 0) {
      this.sprite.body.setVelocity(Math.cos(this.heading) * speed, Math.sin(this.heading) * speed);
    } else {
      this.sprite.body.setVelocity(0, 0);
    }
  }
  _updateVisuals() {
    this.sprite.rotation = this.heading + (this.tpl.artAngleOffset ?? ART_ANGLE_OFFSET);
    this.label.setPosition(this.x, this.y + this.sprite.displayHeight * 0.55);
    this.drawBar();
  }

  // ── Орбита вокруг точки (для дронов и охранников) ────────────────────────
  _orbitAround(dt, cx, cy, radius) {
    this._orbitAngle += this._orbitSpeed * dt;
    const tx = cx + Math.cos(this._orbitAngle) * radius;
    const ty = cy + Math.sin(this._orbitAngle) * radius;
    this.heading = Math.atan2(ty - this.y, tx - this.x);
    const d = Phaser.Math.Distance.Between(this.x, this.y, tx, ty);
    return d > 20 ? this.tpl.speed * 0.7 : 0;
  }

  // ── Escort: обычное следование за лидером ─────────────────────────────────
  escort(dt) {
    const leaderDist = Phaser.Math.Distance.Between(this.x, this.y, this.leader.x, this.leader.y);
    const maxEscortDist = this.leader.tpl.displaySize * 5;
    if (leaderDist > maxEscortDist) {
      this.heading = Math.atan2(this.leader.y - this.y, this.leader.x - this.x);
      return this.leader.tpl.speed * 1.2;
    }
    if (leaderDist > 150) {
      this.heading = Math.atan2(this.leader.y - this.y, this.leader.x - this.x);
      return this.leader.tpl.speed;
    }
    return 0;
  }

  // ── Патруль ───────────────────────────────────────────────────────────────
  patrol(now) {
    if (now < this.patrolWaitUntil) return 0;
    const reached = this.patrolTarget &&
      Phaser.Math.Distance.Between(this.x, this.y, this.patrolTarget.x, this.patrolTarget.y) < 26;
    if (!this.patrolTarget || reached) {
      this.patrolTarget = this.pickPatrolTarget();
      if (this.behavior !== 'roam') {
        this.patrolWaitUntil = now + Phaser.Math.FloatBetween(800, 1800);
        return 0;
      }
    }
    this.heading = Math.atan2(this.patrolTarget.y - this.y, this.patrolTarget.x - this.x);
    return this.tpl.speed * (this.behavior === 'roam' ? 0.6 : 0.4);
  }

  pickPatrolTarget() {
    if (this.behavior === 'roam') {
      if (this.targets && this.targets.length > 0) {
        this.currentTargetIdx = ((this.currentTargetIdx ?? -1) + 1) % this.targets.length;
        const base = this.targets[this.currentTargetIdx];
        // Отклонение от прямой линии патруля
        if (this.pathDeviation > 0) {
          const ang = Math.atan2(base.y - this.y, base.x - this.x) + Math.PI / 2;
          const off = Phaser.Math.FloatBetween(-this.pathDeviation, this.pathDeviation);
          return { x: base.x + Math.cos(ang) * off, y: base.y + Math.sin(ang) * off };
        }
        return base;
      }
      const m = 450;
      const ww = this.scene.worldWidth, wh = this.scene.worldHeight;
      const corners = [[m, m], [ww - m, m], [m, wh - m], [ww - m, wh - m]];
      let best = corners[0], bd = -1;
      for (const c of corners) {
        const d = Phaser.Math.Distance.Between(this.x, this.y, c[0], c[1]);
        if (d > bd) { bd = d; best = c; }
      }
      return { x: best[0] + Phaser.Math.Between(-180, 180), y: best[1] + Phaser.Math.Between(-180, 180) };
    }
    // patrol/guard: точка на периметре patrolRadius (0.6–1.0 от радиуса) с угловым смещением
    const ang = Phaser.Math.FloatBetween(-Math.PI, Math.PI);
    const r   = Phaser.Math.FloatBetween(this.patrolRadius * 0.6, this.patrolRadius);
    return { x: this.spawnX + Math.cos(ang) * r, y: this.spawnY + Math.sin(ang) * r };
  }

  // ── Босс AoE ─────────────────────────────────────────────────────────────
  _updateBossAoe(dt, dist) {
    if (dist >= this.tpl.aggro) return;
    this.aoeTimer -= dt * 1000;
    if (this.aoeTimer <= 0) {
      this.aoeTimer = this.phase >= 2 ? BOSS.aoeCooldownP2 : BOSS.aoeCooldownP1;
      const victim = this.scene.player;
      this.scene.spawnBossAoe(this, victim.x, victim.y);
    }
  }

  // ── AI-классы ────────────────────────────────────────────────────────────
  _updateDasher(dt, dist, speedMult) {
    this._abilityTimer -= dt;
    if (this._abilityActive) {
      this._abilityData.duration -= dt;
      if (this._abilityData.duration <= 0) {
        this._abilityActive = false;
        this._abilityTimer  = 8;
      }
      return;
    }
    if (this._abilityTimer <= 0 && dist < this.tpl.range * 0.6) {
      this._abilityActive      = true;
      this._abilityData.duration = 0.5;
      this._abilityTimer       = 8;
    }
  }

  _updateCloaker(dt, player) {
    this._abilityTimer -= dt;
    if (this._abilityTimer <= 0) {
      this._abilityTimer = 10;
      // Телепорт на ±300px перпендикулярно к направлению игрока
      const perpAng = Math.atan2(player.y - this.y, player.x - this.x) + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
      const dist = Phaser.Math.FloatBetween(200, 300);
      const nx = this.x + Math.cos(perpAng) * dist;
      const ny = this.y + Math.sin(perpAng) * dist;
      // Плавное исчезновение-появление
      this.scene.tweens.add({
        targets: this.sprite, alpha: 0, duration: 150, ease: 'Quad.easeIn',
        onComplete: () => {
          this.sprite.setPosition(nx, ny);
          this.scene.tweens.add({ targets: this.sprite, alpha: 1, duration: 150, ease: 'Quad.easeOut' });
        }
      });
    }
  }

  _updateShielder(dt) {
    this._abilityTimer -= dt;
    if (this._shieldAura) {
      this._shieldAuraTimer -= dt;
      if (this._shieldAuraTimer <= 0) {
        this._shieldAura = false;
        this.sprite.clearTint();
        // Убираем ауру у соседних мобов
        this.scene.mobs.forEach(m => { if (m !== this && m.alive) m._shieldAura = false; });
      }
      return;
    }
    if (this._abilityTimer <= 0) {
      this._abilityTimer    = 12;
      this._shieldAura      = true;
      this._shieldAuraTimer = 1.5;
      this.sprite.setTint(0x4fc3f7);
      // Соседние мобы в 400px тоже получают ауру
      this.scene.mobs.forEach(m => {
        if (m !== this && m.alive) {
          const d = Phaser.Math.Distance.Between(this.x, this.y, m.x, m.y);
          if (d < 400) m._shieldAura = true;
        }
      });
    }
  }

  // ── Roaming boss ─────────────────────────────────────────────────────────
  _updateRoaming(dt, dist, player, speedMult) {
    // Побег при низком HP
    if (!this._fleeing && this.hull / this.maxHull < 0.25 && dist < this.tpl.aggro * 0.8) {
      this._fleeing   = true;
      this._fleeTimer = 3.0;
      this._roamHeading = Math.atan2(this.y - player.y, this.x - player.x);
    }
    if (this._fleeing) {
      this._fleeTimer -= dt;
      if (this._fleeTimer <= 0) this._fleeing = false;
      this.heading = this._roamHeading;
      return this.tpl.speed * 1.2 * speedMult;
    }

    // Синусоидальный маршрут — смена направления каждые 8–14 сек
    this._roamTimer -= dt;
    if (this._roamTimer <= 0) {
      this._roamTimer   = Phaser.Math.FloatBetween(8, 14);
      this._roamHeading = Phaser.Math.FloatBetween(-Math.PI, Math.PI);
    }
    // Добавляем синус-отклонение для плавной кривой
    const sineOff = Math.sin(this.scene.time.now * 0.0008) * 0.4;
    this.heading = this._roamHeading + sineOff;

    // Граница карты — разворот
    const margin = 400;
    const ww = this.scene.worldWidth, wh = this.scene.worldHeight;
    if (this.x < margin || this.x > ww - margin || this.y < margin || this.y > wh - margin) {
      this._roamHeading = Math.atan2(wh / 2 - this.y, ww / 2 - this.x);
    }

    return this.tpl.speed * 0.7 * speedMult;
  }

  _updateScatterShot(dt, fireProjectile) {
    this._scatterTimer -= dt;
    if (this._scatterTimer <= 0) {
      this._scatterTimer = 8;
      const baseAng = this.heading;
      const SHOTS = 5;
      for (let i = 0; i < SHOTS; i++) {
        const ang = baseAng + (i - Math.floor(SHOTS / 2)) * (Math.PI / (SHOTS - 1));
        // Временно меняем heading для fireProjectile
        const tx = this.x + Math.cos(ang) * 600;
        const ty = this.y + Math.sin(ang) * 600;
        fireProjectile(this, tx, ty);
      }
    }
  }

  // ── Dungeon boss (Apophis) ────────────────────────────────────────────────
  _updateApophis(dt, dist, player, speedMult, fireProjectile) {
    const hpRatio = this.hull / this.maxHull;

    // Фазы Апофиса
    if (this._apophisPhase === 1 && hpRatio < 0.70) {
      this._apophisPhase = 2;
      this.tpl = { ...this.tpl, projectileType: 'acid' };
      this.sprite.setTint(0x76ff03);
      this.scene.log('☠ АПОФИС переходит в фазу 2 — кислотные залпы!');
    }
    if (this._apophisPhase === 2 && hpRatio < 0.40) {
      this._apophisPhase = 3;
      this.enterEnrage();
      if (!this._apophisSummonDone) {
        this._apophisSummonDone = true;
        this.scene.spawnApophisMinions?.();
      }
      this.scene.log('☠ АПОФИС — фаза 3: Призыв стражей + войд-залп!');
    }

    // Фаза 3: войд-залп каждые 15 сек
    if (this._apophisPhase >= 3) {
      this._apophisVoidTimer -= dt;
      if (this._apophisVoidTimer <= 0) {
        this._apophisVoidTimer = 15;
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * Math.PI * 2;
          const tx = this.x + Math.cos(ang) * 500;
          const ty = this.y + Math.sin(ang) * 500;
          // Временно устанавливаем void тип для залпа
          const origType = this.tpl.projectileType;
          this.tpl = { ...this.tpl, projectileType: 'void' };
          fireProjectile(this, tx, ty);
          this.tpl = { ...this.tpl, projectileType: origType };
        }
      }
    }

    // Dash: каждые 20 сек — рывок через позицию игрока
    this._apophisDashTimer -= dt;
    if (this._apophisDashTimer <= 0) {
      this._apophisDashTimer = 20;
      this._dashAng = Math.atan2(player.y - this.y, player.x - this.x);
      this._dashTimer = 1.2;
    }
    if (this._dashTimer > 0) {
      this._dashTimer -= dt;
      this.heading = this._dashAng;
      return this.tpl.speed * 2.5;
    }

    // Стандартное движение: minimal orbit вокруг спавна
    this.heading = Math.atan2(this.spawnY - this.y, this.spawnX - this.x);
    return dist > this.patrolRadius * 0.5 ? this.tpl.speed * 0.4 * speedMult : 0;
  }

  // ── Полоска HP/Shield ────────────────────────────────────────────────────
  drawBar() {
    const w = 46, h = 4;
    const bx = this.x - w / 2, by = this.y - this.tpl.displaySize * 0.6;
    this.bar.clear();
    this.bar.fillStyle(0x000000, 0.5); this.bar.fillRect(bx - 1, by - 1, w + 2, h + 2);
    this.bar.fillStyle(COLORS.danger, 1);
    this.bar.fillRect(bx, by, w * (this.hull / this.maxHull), h);
    if (this.maxShield > 0) {
      this.bar.fillStyle(COLORS.primary, 1);
      this.bar.fillRect(bx, by - 3, w * (this.shield / this.maxShield), 2);
    }
  }

  destroy() {
    this.sprite.destroy(); this.label.destroy(); this.bar.destroy();
  }
}
