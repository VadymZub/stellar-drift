import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { ART_ANGLE_OFFSET, COLORS, UI_RES, MOB_REGEN, BOSS } from '../constants.js';
import { i18n } from '../i18n.js';

function scaleStat(base, level) { return Math.round(base * (1 + 0.5 * (level - 1))); }

export default class Mob {
  // opts: { behavior:'patrol'|'guard'|'roam', patrolRadius, leash, passive, bossRef, orbitLeader, pathDeviation, targets }
  constructor(scene, template, level, x, y, opts = {}) {
    this.scene = scene;
    // opts.aiClass — переопределение AI-класса из данных данжа (микс классов в пулах);
    // 'minelayer' — не aiClass, а флаг шаблона
    this.tpl = opts.aiClass
      ? (opts.aiClass === 'minelayer' ? { ...template, minelayer: true } : { ...template, aiClass: opts.aiClass })
      : template;
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
    if (opts.hpMult  && opts.hpMult  !== 1) { this.maxHull = Math.round(this.maxHull * opts.hpMult); this.maxShield = Math.round(this.maxShield * opts.hpMult); }
    if (opts.dmgMult && opts.dmgMult !== 1) { this.damage   = Math.round(this.damage  * opts.dmgMult); }
    this.hull      = this.maxHull;
    this.shield    = this.maxShield;

    const mobTexKey = template._prerenderKey || template.key;
    this.sprite = template.anim
      ? scene.add.sprite(x, y, template.sheetKey).setDepth(40)
      : scene.add.image(x, y, mobTexKey).setDepth(40);
    scene.physics.add.existing(this.sprite);
    // Стены данжа: коллайдер здесь покрывает и поздние спавны (охрана депозитов,
    // подкрепления сложности, адды фаз босса, портальные мобы)
    if (scene.walls) scene.physics.add.collider(this.sprite, scene.walls);
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
    this._basePassive = this.passive;
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
    this._apophisVoidTimer  = 10; // первый залп через 10 сек после входа в фазу 3
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  takeDamage(amount, penetration = 0, opts = {}) {
    if (!this.alive) return { shieldHit: 0, hullHit: 0, killed: false };
    if (this._invulTimer > 0) return { shieldHit: 0, hullHit: 0, killed: false, dodged: true };
    this.lastDamageAt = this.scene.time.now;

    if (!opts.ignoreMovEvasion) {
      const body = this.sprite?.body;
      if (body) {
        const spd = Math.sqrt(body.velocity.x ** 2 + body.velocity.y ** 2);
        const movEvasion = Math.min(0.20, spd / 1500);
        if (movEvasion > 0 && Math.random() < movEvasion) return { shieldHit: 0, hullHit: 0, killed: false, dodged: true };
      }
    }

    // Кристальные щиты: ближайший живой shieldDrone поглощает 90% входящего урона по боссу
    if (this.isDungeonBoss && this.scene?.mobs) {
      let nearest = null, nearestDist = 1200;
      for (const m of this.scene.mobs) {
        if (!m.alive || !m.tpl?.shieldDrone) continue;
        const d = Phaser.Math.Distance.Between(m.x, m.y, this.x, this.y);
        if (d < nearestDist) { nearest = m; nearestDist = d; }
      }
      if (nearest) {
        nearest.takeDamage(amount * 0.9, penetration, { ignoreMovEvasion: true });
        amount *= 0.1;
        nearest.sprite?.setTint(0x88ccff);
        this.scene.time.delayedCall(150, () => nearest.sprite?.clearTint());
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
    this.passive = this._basePassive;
    this.phase   = 1;
    this.aoeTimer = this.isBoss ? BOSS.aoeCooldownP1 : 0;
    this._returning      = false;
    this._berserkerOn    = false;
    this._apophisPhase   = 1;
    this._apophisSummonDone = false;
    this._fleeing        = false;
    this._bleedTimer     = 0;
    this._bleedDps       = 0;
  }

  enterEnrage() {
    this.phase = 2;
    this.sprite.setTint(BOSS.enrageTint);
    this.aoeTimer = Math.min(this.aoeTimer, 1500);
    this.scene.log(i18n.t('log.boss_enrage', { name: i18n.t(this.tpl.nameKey) }));
  }

  update(dt, player, playerInSafeZone, fireProjectile) {
    if (!this.alive) return;

    if (this._invulTimer > 0) this._invulTimer -= dt;

    // Plasma Bleed (cannon perk): DOT от последнего попадания пушкой игрока.
    if (this._bleedTimer > 0) {
      this._bleedTimer -= dt;
      const bleedRes = this.takeDamage(this._bleedDps * dt, 1.0, { ignoreMovEvasion: true });
      if (this._bleedTimer <= 0) { this._bleedTimer = 0; this._bleedDps = 0; }
      if (bleedRes.killed) { this.scene.onMobKilled(this); return; }
    }
    if (!this.alive) return; // умер по другой причине в этом же кадре

    const now = this.scene.time.now;
    const sinceDmg = now - this.lastDamageAt;

    // Реген щита и корпуса
    if (this.maxShield > 0 && sinceDmg > MOB_REGEN.shieldDelay && this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + (this.maxShield / MOB_REGEN.shieldFullSec) * dt);
    }
    if (this.isBoss && sinceDmg > MOB_REGEN.bossHullDelay && this.hull < this.maxHull) {
      this.hull = Math.min(this.maxHull, this.hull + this.maxHull * MOB_REGEN.bossHullPctPerSec * dt);
    }

    // Boss healer: 7 сек хила — 3 сек откат, 1000 HP/сек непрерывно
    if (this.tpl.bossHealer && this.bossRef?.alive) {
      const hdist = Phaser.Math.Distance.Between(this.x, this.y, this.bossRef.x, this.bossRef.y);
      if (hdist < (this.tpl.healRange ?? 650)) {
        if (!this._healPhase) this._healPhase = 'healing';
        this._healPhaseTimer = (this._healPhaseTimer ?? 0) + dt;
        if (this._healPhase === 'healing') {
          this._isHealing = true;
          this.bossRef.hull = Math.min(this.bossRef.maxHull, this.bossRef.hull + (this.tpl.healRate ?? 1000) * dt);
          if (this._healPhaseTimer >= 7.0) { this._healPhase = 'cooldown'; this._healPhaseTimer = 0; }
        } else {
          this._isHealing = false;
          if (this._healPhaseTimer >= 3.0) { this._healPhase = 'healing'; this._healPhaseTimer = 0; }
        }
      } else {
        this._isHealing = false;
        this._healPhase = null;
        this._healPhaseTimer = 0;
      }
    }

    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    const playerStealthed = (this.scene._stealthEndTime || 0) > now || (this.scene._phantomCloakEndTime || 0) > now;

    // ── Смена состояний ───────────────────────────────────────────────────────
    if (this.passive || playerInSafeZone || !player.alive || playerStealthed) {
      this.state = 'idle';
    } else if (this._returning) {
      this.state = 'idle'; // во время возврата игнорируем агро
    } else if (dist < this.tpl.aggro * (player.aggroRadiusMod ?? 1) &&
               !this.scene._hasWallBetween?.(this.x, this.y, player.x, player.y)) {
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
    if (this._returning) {
      // Защита от вечного «возврата»: если стены не пускают домой дольше 8с
      // (спавн отрезан после случайных изменений раскладки), сдаёмся на месте —
      // лучше моб останется тут, чем навсегда перестанет агриться
      this._returningT = (this._returningT ?? 0) + dt;
      if (fromAnchor < this.leash * 0.75 || this._returningT > 8) {
        this._returning  = false;
        this._returningT = 0;
      }
    } else {
      this._returningT = 0;
    }

    let moveSpeed = 0;

    // ── Возврат на базу ───────────────────────────────────────────────────────
    if (this._returning) {
      this.heading = Math.atan2(this.spawnY - this.y, this.spawnX - this.x);
      moveSpeed    = this.tpl.speed * 0.85;
      // Без обхода стен моб, разорвавший погоню за стеной, физически не может
      // дойти по прямой до точки спавна за такой же стеной — fromAnchor никогда
      // не опустится ниже leash*0.75, и _returning останется true навсегда,
      // отключая агро к этому мобу до конца сессии
      if (!this._steerAroundWalls(dt)) moveSpeed = 0;
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

      // Berserker: при HP < 50% — постоянный буфф. Тинт — иначе баф скорости/огня
      // никак не читался визуально, только по цифрам.
      if (this.tpl.aiClass === 'berserker' && !this._berserkerOn && this.hull / this.maxHull < 0.5) {
        this._berserkerOn = true;
        this.sprite.setTint(0xff5533);
      }
      const berserkFire  = this._berserkerOn ? 1.3 : 1;
      const berserkSpeed = this._berserkerOn ? 1.4 : 1;

      // Roaming boss: синусоидальный маршрут + побег при низком HP
      if (this.isBoss && this.tpl.bossType === 'roaming') {
        moveSpeed = this._updateRoaming(dt, dist, player, speedMult);
        this._updateBossAoe(dt, dist);
        this._updateScatterShot(dt, player, fireProjectile);
        this.fireCooldown -= dt;
        if (this.fireCooldown <= 0 && dist <= this.tpl.range &&
            !this.scene._hasWallBetween?.(this.x, this.y, player.x, player.y)) {
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

        // Стена между мобом и целью: 3с пытаемся обойти стирингом, потом бросаем
        // погоню и возвращаемся на точку (иначе мобы вечно «трутся» о стену)
        const losBlocked = this.scene._hasWallBetween?.(this.x, this.y, player.x, player.y) ?? false;
        if (losBlocked) {
          this._noLosT = (this._noLosT ?? 0) + dt;
          if (this._noLosT > 3) {
            this._noLosT   = 0;
            this._returning = true;
            this.state      = 'idle';
          }
        } else {
          this._noLosT = 0;
        }

        // losBlocked → двигаемся даже в пределах range, чтобы вернуть линию огня
        if ((dist > this.tpl.range || losBlocked) && fromAnchor < this.leash) {
          moveSpeed = this.tpl.speed * speedMult * berserkSpeed;
          if (!this._steerAroundWalls(dt)) moveSpeed = 0;
        }

        // Физическое застревание (клин корпуса на сегментах стены): хотим двигаться,
        // а позиция стоит — меняем сторону обхода; после ~2.5с сдаёмся и возвращаемся
        if (moveSpeed > 0) {
          this._stuckCheckT = (this._stuckCheckT ?? 0) + dt;
          if (this._stuckCheckT >= 0.5) {
            this._stuckCheckT = 0;
            const moved = this._stuckX === undefined ? 1e9
              : Phaser.Math.Distance.Between(this.x, this.y, this._stuckX, this._stuckY);
            if (moved < 12) {
              this._stuckN = (this._stuckN ?? 0) + 1;
              this._steerSide = -(this._steerSide ?? 1);
              this._steerT = 0; // немедленная перепроба курса
              if (this._stuckN >= 5) { this._stuckN = 0; this._returning = true; this.state = 'idle'; }
            } else {
              this._stuckN = 0;
            }
            this._stuckX = this.x; this._stuckY = this.y;
          }
        } else {
          this._stuckN = 0; this._stuckCheckT = 0; this._stuckX = undefined;
        }

        // AI-класс: bomb
        if (this.tpl.aiClass === 'bomb') {
          this._updateBomb(dt, player);
          if (!this.alive) return;
          if (!this._bombTriggered) moveSpeed = this.tpl.speed;
          this._applyVelocity(moveSpeed);
          this._updateVisuals();
          return;
        }
        // Направленная мина Синдиката: статична (speed 0), при срабатывании — сфокусированный
        // бронебойный импульс в одном направлении (эффективен по корпусу, не по щиту)
        if (this.tpl.aiClass === 'directedMine') {
          this._updateDirectedMine(dt, player);
          if (!this.alive) return;
          this._applyVelocity(0);
          this._updateVisuals();
          return;
        }
        // Импульсная мина Синдиката: статична, ЭМИ в радиусе — глушит двигатели/оружие, без урона по корпусу
        if (this.tpl.aiClass === 'stunMine') {
          this._updateStunMine(dt, player);
          if (!this.alive) return;
          this._applyVelocity(0);
          this._updateVisuals();
          return;
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
        // Минный установщик
        if (this.tpl.minelayer) this._updateMinelayer(dt);

        // Кит данж-босса (D1–D5/prem): фазы-саммоны, скеттер, мины, блинк, дэш
        if (this._bossKit) {
          this._updateBossKit(dt, player, fireProjectile);
          if (this._dashTimer > 0) {
            this._dashTimer -= dt;
            this.heading = this._dashAng;
            moveSpeed = this.tpl.speed * 2.5;
          }
        }

        // Стрельба
        this.fireCooldown -= dt;
        if (dist <= this.tpl.range && fromAnchor < this.leash + 80 && this.fireCooldown <= 0 &&
            !this.scene._hasWallBetween?.(this.x, this.y, player.x, player.y)) {
          this.fireCooldown = 1 / (this.tpl.fireRate * fireMult * berserkFire);
          if (this.tpl.aiClass === 'gunner') this.fireCooldown *= 0.8;
          fireProjectile(this, player.x, player.y);
        }

        // AoE только для главного босса, не для эскортов
        if (this.isBoss && !this.isBossEscort) this._updateBossAoe(dt, dist);
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
        moveSpeed = this.patrol(now, dt);
      }
    }

    this._applyVelocity(moveSpeed);
    this._updateVisuals();
  }

  // Дешёвый обход стен без A*: раз в 0.25с проба курса на 220px вперёд; при блоке
  // перебор отклонений (сначала кэшированная сторона), свободного нет → false (стоим)
  _steerAroundWalls(dt) {
    if (!this.scene._wallLines?.length) return true;
    this._steerT = (this._steerT ?? 0) - dt;
    if (this._steerT <= 0) {
      this._steerT = 0.25;
      const probe = (h) =>
        !this.scene._hasWallBetween(this.x, this.y, this.x + Math.cos(h) * 220, this.y + Math.sin(h) * 220);
      if (probe(this.heading)) {
        this._steerOffset = 0;
      } else {
        const side = this._steerSide ?? 1;
        this._steerOffset = null;
        // веер до разворота (±2.6, π) — из тупика/угла моб выбирается назад
        for (const off of [0.6 * side, -0.6 * side, 1.2 * side, -1.2 * side,
                           1.9 * side, -1.9 * side, 2.6 * side, -2.6 * side, Math.PI]) {
          if (probe(this.heading + off)) {
            this._steerOffset = off;
            this._steerSide = Math.sign(Math.sin(off)) || 1;
            break;
          }
        }
      }
    }
    if (this._steerOffset === null) return false;
    if (this._steerOffset) this.heading += this._steerOffset;
    return true;
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

  // ── Минный установщик: спавн 1-3 бомб каждые N сек ──────────────────────
  _updateMinelayer(dt) {
    this._mineLayTimer = (this._mineLayTimer ?? (this.tpl.mineInterval ?? 6)) - dt;
    if (this._mineLayTimer > 0) return;
    this._mineLayTimer = (this.tpl.mineInterval ?? 6) + Phaser.Math.FloatBetween(-1, 1);
    const count = Phaser.Math.Between(1, 3);
    this.scene._spawnLayerMines?.(this, count);
    // Короткая вспышка тинта в момент закладки — раньше мины появлялись за спиной
    // мобa совершенно незаметно для игрока
    this.sprite.setTint(0xff9a3c);
    this.scene.time?.delayedCall(220, () => { if (this.alive) this.sprite.clearTint(); });
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
  patrol(now, dt) {
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
    // В лабиринтах цель патруля может лежать за углом — обходим стену тем же
    // стирингом, что и в погоне, иначе моб просто утыкается в стену и стоит
    if (!this._steerAroundWalls(dt ?? 0.05)) return 0;
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
    // patrol/guard: точка на периметре patrolRadius. Полная видимость от текущей
    // позиции больше не требуется — patrol() обходит препятствия по пути тем же
    // стирингом, что и погоня; здесь важно лишь не целиться внутрь стены. Пробуем
    // несколько радиусов (уже — для тесных ячеек лабиринта, где polный patrolRadius
    // всегда упирается в соседнюю стену).
    for (const rFrac of [1.0, 0.7, 0.45, 0.25]) {
      for (let i = 0; i < 8; i++) {
        const ang = Phaser.Math.FloatBetween(-Math.PI, Math.PI);
        const r   = this.patrolRadius * rFrac * Phaser.Math.FloatBetween(0.6, 1.0);
        const tx  = this.spawnX + Math.cos(ang) * r;
        const ty  = this.spawnY + Math.sin(ang) * r;
        if (!this.scene._isPointNearWall?.(tx, ty, 50)) return { x: tx, y: ty };
      }
    }
    // Совсем зажат (не должно случаться при patrolRadius ≥ ~120) — короткий шаг
    // от текущей позиции, лишь бы не застыть статуей на месте
    const ang = Phaser.Math.FloatBetween(-Math.PI, Math.PI);
    return { x: this.x + Math.cos(ang) * 60, y: this.y + Math.sin(ang) * 60 };
  }

  // ── Кит данж-босса (D1–D5/prem): собран из готовых механик. Путь Апофиса
  //    (bossType 'dungeon') сюда не заходит — R-1-boss не затронут. ──────────
  _updateBossKit(dt, player, fireProjectile) {
    const kit = this._bossKit;
    if (kit.phases) {
      const frac = this.hull / this.maxHull;
      this._kitPhasesDone = this._kitPhasesDone ?? new Set();
      for (const ph of kit.phases) {
        if (frac <= ph.at && !this._kitPhasesDone.has(ph.at)) {
          this._kitPhasesDone.add(ph.at);
          this.scene.onDungeonBossPhase?.(this, ph);
        }
      }
    }
    if (kit.scatter) this._updateScatterShot(dt, player, fireProjectile);
    if (kit.minelayer) this._updateMinelayer(dt);
    if (kit.blink) this._updateCloaker(dt, player);
    const dashCd = kit.dash ?? this._kitDashCd; // dashOn-фаза включает дэш позже
    if (dashCd) {
      // первый дэш через полкулдауна — ранний телеграф механики
      this._kitDashTimer = (this._kitDashTimer ?? dashCd * 0.5) - dt;
      if (this._kitDashTimer <= 0) {
        this._kitDashTimer = dashCd;
        this._dashAng   = Math.atan2(player.y - this.y, player.x - this.x);
        this._dashTimer = 1.2;
      }
    }
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
        this.sprite.clearTint();
      }
      return;
    }
    if (this._abilityTimer <= 0 && dist < this.tpl.range * 0.6) {
      this._abilityActive      = true;
      this._abilityData.duration = 0.5;
      this._abilityTimer       = 8;
      // Тинт на время рывка — раньше единственным признаком было ×2 к скорости,
      // незаметное на глаз без сравнения с обычным движением
      this.sprite.setTint(0xffffaa);
    }
  }

  _updateCloaker(dt, player) {
    this._abilityTimer -= dt;
    if (this._abilityTimer <= 0) {
      this._abilityTimer = 10;
      const perpAng = Math.atan2(player.y - this.y, player.x - this.x) + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
      const tdist = Phaser.Math.FloatBetween(200, 300);
      // Clamp to world bounds with margin
      const margin = 350;
      const nx = Phaser.Math.Clamp(this.x + Math.cos(perpAng) * tdist, margin, this.scene.worldWidth - margin);
      const ny = Phaser.Math.Clamp(this.y + Math.sin(perpAng) * tdist, margin, this.scene.worldHeight - margin);
      // Skip if outside leash radius from spawn point
      if (Phaser.Math.Distance.Between(nx, ny, this.spawnX, this.spawnY) > (this.leash ?? 640)) return;
      // Не блинкуемся в стену или сквозь стену
      if (this.scene._isPointNearWall?.(nx, ny, 70) ||
          this.scene._hasWallBetween?.(this.x, this.y, nx, ny)) return;
      this.scene.tweens.add({
        targets: this.sprite, alpha: 0, duration: 150, ease: 'Quad.easeIn',
        onComplete: () => {
          if (!this.alive) return;
          this.sprite.body.reset(nx, ny);
          this.scene.tweens.add({ targets: this.sprite, alpha: 1, duration: 150, ease: 'Quad.easeOut' });
        }
      });
    }
  }

  _updateBomb(dt, player) {
    if (!this._bombArmed) { this._bombArmed = true; this._bombFuseTimer = 0; this._bombTriggered = false; }
    if (this._bombTriggered) {
      this._bombFuseTimer -= dt;
      if (this._bombFuseTimer <= 0) {
        this.scene.onBombDetonate?.(this);
        this.alive = false;
      }
      return;
    }
    // Approach player
    if (player?.alive) {
      this.heading = Math.atan2(player.y - this.y, player.x - this.x);
      // Обход стен на подходе — иначе камикадзе прёт по прямой сквозь геометрию
      // коридора и намертво упирается в стену, так и не долетев до цели
      this._steerAroundWalls(dt);
      const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
      if (dist < (this.tpl.bombTriggerRange ?? 110)) {
        this._bombTriggered = true;
        this._bombFuseTimer = this.tpl.bombFuse ?? 1.0;
        this.sprite.setTint(0xff4444);
        this.scene.sfx?.play('sfx_bomb_arm', { volume: 0.5 });
        this.scene.tweens.add({ targets: this.sprite, alpha: { from: 1, to: 0.3 }, duration: 200, yoyo: true, repeat: -1 });
      }
    }
  }

  // ── Мины Синдиката: статичные ловушки (speed 0), взводятся при подходе игрока,
  //    детонируют по фитилю. Общая часть с _updateBomb, но без сближения. ────────
  _updateDirectedMine(dt, player) {
    if (!this._bombArmed) { this._bombArmed = true; this._bombFuseTimer = 0; this._bombTriggered = false; }
    if (this._bombTriggered) {
      this._bombFuseTimer -= dt;
      if (this._bombFuseTimer <= 0) {
        this.scene.onDirectedMineDetonate?.(this);
        this.alive = false;
      }
      return;
    }
    if (player?.alive) {
      this.heading = Math.atan2(player.y - this.y, player.x - this.x);
      const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
      if (dist < (this.tpl.bombTriggerRange ?? 260)) {
        this._bombTriggered = true;
        this._bombFuseTimer = this.tpl.bombFuse ?? 0.6;
        // Направление фиксируется в момент взвода — импульс уйдёт туда, даже если цель сместится
        this._mineFireAngle = this.heading;
        this.sprite.setTint(0xff8844);
        this.scene.sfx?.play('sfx_bomb_arm', { volume: 0.5 });
        this.scene.tweens.add({ targets: this.sprite, alpha: { from: 1, to: 0.3 }, duration: 150, yoyo: true, repeat: -1 });
      }
    }
  }

  _updateStunMine(dt, player) {
    if (!this._bombArmed) { this._bombArmed = true; this._bombFuseTimer = 0; this._bombTriggered = false; }
    if (this._bombTriggered) {
      this._bombFuseTimer -= dt;
      if (this._bombFuseTimer <= 0) {
        this.scene.onStunMineDetonate?.(this);
        this.alive = false;
      }
      return;
    }
    if (player?.alive) {
      const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
      if (dist < (this.tpl.bombTriggerRange ?? 260)) {
        this._bombTriggered = true;
        this._bombFuseTimer = this.tpl.bombFuse ?? 0.6;
        this.sprite.setTint(0x4dd0e1);
        this.scene.sfx?.play('sfx_bomb_arm', { volume: 0.5 });
        this.scene.tweens.add({ targets: this.sprite, alpha: { from: 1, to: 0.3 }, duration: 150, yoyo: true, repeat: -1 });
      }
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

  _updateScatterShot(dt, player, fireProjectile) {
    this._scatterTimer -= dt;
    if (this._scatterTimer <= 0) {
      this._scatterTimer = 8;
      const baseAng = Math.atan2(player.y - this.y, player.x - this.x);
      const SHOTS = 5;
      const SPREAD = Math.PI / 6; // 30° total, ±15° от центра
      for (let i = 0; i < SHOTS; i++) {
        const ang = baseAng + (i - Math.floor(SHOTS / 2)) * (SPREAD / (SHOTS - 1));
        const tx = this.x + Math.cos(ang) * 800;
        const ty = this.y + Math.sin(ang) * 800;
        fireProjectile(this, tx, ty);
      }
    }
  }

  // ── Dungeon boss (Apophis) ────────────────────────────────────────────────
  _updateApophis(dt, dist, player, speedMult, fireProjectile) {
    const hpRatio = this.hull / this.maxHull;

    // Фазы Апофиса
    if (this._apophisPhase === 1 && hpRatio < 0.75) {
      this._apophisPhase = 2;
      this._phaseTint = 0x76ff03;
      this.tpl = { ...this.tpl, projectileType: 'acid' };
      this.sprite.setTint(0x76ff03);
      this.scene.onApophisPhase?.(2);
      this.scene._apophisPhaseShockwave?.(this);
      this._invulTimer = 3.0;
    }
    if (this._apophisPhase === 2 && hpRatio < 0.50) {
      this._apophisPhase = 3;
      this._phaseTint = 0xff9966;
      this.enterEnrage();
      this.sprite.setTint(0xff9966);
      this.scene.onApophisPhase?.(3);
      this.scene._apophisPhaseShockwave?.(this);
      this._invulTimer = 3.0;
    }
    if (this._apophisPhase === 3 && hpRatio < 0.25) {
      this._apophisPhase = 4;
      this._phaseTint = 0xff3333;
      this.sprite.setTint(0xff3333);
      this.scene.onApophisPhase?.(4);
      this.scene._apophisPhaseShockwave?.(this);
      this._invulTimer = 3.0;
    }

    // Фаза 3: войд-залп каждые 15 сек
    if (this._apophisPhase >= 3) {
      this._apophisVoidTimer -= dt;
      if (this._apophisVoidTimer <= 2.0 && !this._voidWarnSent) {
        this._voidWarnSent = true;
        this.scene.log('⚠ Апофис заряжает АННИГИЛЯЦИЮ — уходи в сторону!');
      }
      if (this._apophisVoidTimer <= 0) {
        this._apophisVoidTimer = (this._rageSpeedMult ?? 1) > 1 ? 9 : 15;
        this._voidWarnSent = false;
        this.scene._apophisVoidRing?.(this);
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
      const _rageSpd = this._rageSpeedMult ?? 1;
      return this.tpl.speed * 2.5 * _rageSpd;
    }

    // Стандартное движение: minimal orbit вокруг спавна
    const _rageSpd = this._rageSpeedMult ?? 1;
    this.heading = Math.atan2(this.spawnY - this.y, this.spawnX - this.x);
    return dist > this.patrolRadius * 0.5 ? this.tpl.speed * 0.4 * speedMult * _rageSpd : 0;
  }

  // ── Полоска HP/Shield ────────────────────────────────────────────────────
  // Каждый живой моб на карте держит СВОЙ Graphics-объект для HP-бара, и раньше
  // drawBar() делал clear()+redraw КАЖДЫЙ кадр для КАЖДОГО моба, даже стоящих на
  // месте с полным здоровьем — на карте с десятками мобов (см. "expanded home map
  // spawns") это была одна из главных причин GraphicsWebGLRenderer в профилировке.
  // Позиция моба меняется почти каждый кадр (это ок, setPosition — дешёвая
  // трансформация), а вот содержимое бара (заливка hull/shield) — только когда
  // реально меняется хп/щит, поэтому геометрию рисуем в ЛОКАЛЬНЫХ координатах
  // (относительно (0,0) бара) один раз при изменении, а позиционируем отдельно.
  drawBar() {
    const w = 46, h = 4;
    this.bar.setPosition(this.x, this.y - this.tpl.displaySize * 0.6);
    const hullFrac   = this.hull / this.maxHull;
    const shieldFrac = this.maxShield > 0 ? this.shield / this.maxShield : 0;
    // Числа, не строка — шаблонная строка тут была НОВОЙ аллокацией каждый кадр на
    // каждого моба просто для сравнения, то есть сама решала "не рисовать" ценой
    // мусора, который всё равно копился и вызывал частые паузы GC (см. Memory-график
    // в профилировке — характерная "пила" JS heap).
    const hSig = Math.round(hullFrac * 1000), sSig = Math.round(shieldFrac * 1000);
    if (hSig === this._lastHullSig && sSig === this._lastShieldSig) return;
    this._lastHullSig = hSig; this._lastShieldSig = sSig;
    this.bar.clear();
    this.bar.fillStyle(0x000000, 0.5); this.bar.fillRect(-w / 2 - 1, -1, w + 2, h + 2);
    this.bar.fillStyle(COLORS.danger, 1);
    this.bar.fillRect(-w / 2, 0, w * hullFrac, h);
    if (this.maxShield > 0) {
      this.bar.fillStyle(COLORS.primary, 1);
      this.bar.fillRect(-w / 2, -3, w * shieldFrac, 2);
    }
  }

  destroy() {
    this.sprite.destroy(); this.label.destroy(); this.bar.destroy();
  }
}
