import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { ART_ANGLE_OFFSET, COLORS, UI_RES, MOB_REGEN, BOSS } from '../constants.js';
import { i18n } from '../i18n.js';

// NPC-моб. Скейл статов по уровню: stat × (1 + 0.5 × (L − 1)).
function scaleStat(base, level) { return Math.round(base * (1 + 0.5 * (level - 1))); }

export default class Mob {
  // opts: { behavior: 'patrol'|'guard'|'roam', patrolRadius, leash }
  constructor(scene, template, level, x, y, opts = {}) {
    this.scene = scene;
    this.tpl = template;
    this.level = level;
    this.spawnX = x;        // якорь патруля / точка охраны
    this.spawnY = y;

    this.behavior = opts.behavior || 'patrol';
    this.patrolRadius = opts.patrolRadius ?? template.patrolRadius ?? 240;
    this.leash = opts.leash ?? template.leash ?? Infinity;
    this.targets = opts.targets || null; // Список точек для roam
    this.patrolTarget = null;
    this.patrolWaitUntil = 0;

    this.maxHull = scaleStat(template.hull, level);
    this.maxShield = scaleStat(template.shield, level);
    this.damage = scaleStat(template.damage, level);
    this.hull = this.maxHull;
    this.shield = this.maxShield;

    // Анимированный босс → sprite + проигрывание; обычный моб → image. Аспект — из натурального
    // размера кадра/текстуры (кропы не квадратные, setDisplaySize(квадрат) сплющивал бы).
    this.sprite = template.anim
      ? scene.add.sprite(x, y, template.sheetKey).setDepth(40)
      : scene.add.image(x, y, template.key).setDepth(40);
    scene.physics.add.existing(this.sprite);
    if (template.anim) this.sprite.play(template.anim);
    const natW = template.anim ? template.frameW : scene.textures.get(template.key).getSourceImage().width;
    const natH = template.anim ? template.frameH : scene.textures.get(template.key).getSourceImage().height;
    const finalSize = template.displaySize * (this.scene.objScale || 1.0);
    const sc = finalSize / Math.max(natW, natH);
    this.sprite.setDisplaySize(natW * sc, natH * sc);
    this.heading = Phaser.Math.FloatBetween(-Math.PI, Math.PI);

    // Nameplate под кораблём: имя + уровень (цвет врага — красный).
    const label = `${i18n.t(template.nameKey)} ${i18n.t('mob.level')}${level}`;
    this.label = scene.add.text(x, y, label, {
      fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#ef5350', resolution: UI_RES,
    }).setOrigin(0.5, 0).setDepth(41);

    this.bar = scene.add.graphics().setDepth(41);
    this.fireCooldown = 0;
    this.lastDamageAt = -100000;
    this.isBoss = !!template.boss;
    this.neutral = template.neutral || false;
    this.alive = true;
    this.state = 'idle';

    this.leader = opts.leader || null; // Для дронов — ссылка на эсминец
    this.group = []; // Для эсминца — список его дронов
    if (this.leader) this.leader.group.push(this);

    // Босс-механика: фаза (1 → 2 ярость) и таймер до следующего телеграф-AoE.
    this.phase = 1;
    this.aoeTimer = this.isBoss ? BOSS.aoeCooldownP1 : 0;
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  // opts.shieldMult: damage multiplier applied to the shield-bound portion (laser: 0.8).
  // opts.hullMult: damage multiplier applied to hull damage (laser: 1.5).
  takeDamage(amount, penetration = 0, opts = {}) {
    if (!this.alive) return { shieldHit: 0, hullHit: 0, killed: false };
    this.lastDamageAt = this.scene.time.now;

    // Если атаковали нейтрального моба — он и его группа агрятся
    if (this.neutral) {
      this.neutral = false;
      this.state = 'aggro';
      if (this.leader) { this.leader.neutral = false; this.leader.state = 'aggro'; }
      if (this.group.length) this.group.forEach(m => { m.neutral = false; m.state = 'aggro'; });
    }

    const shieldMult = opts.shieldMult ?? 1;
    const hullMult   = opts.hullMult   ?? 1;
    const direct = amount * penetration;
    const toShieldRaw = amount - direct;
    let hullHit = direct * hullMult;
    let shieldHit = 0;

    if (this.shield > 0) {
      const toShield = toShieldRaw * shieldMult;
      shieldHit = toShield;
      if (toShield <= this.shield) { this.shield -= toShield; }
      else { hullHit += (toShield - this.shield) * hullMult; this.shield = 0; }
    } else {
      hullHit += toShieldRaw * hullMult;
    }

    this.hull -= hullHit;
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
    this.hull = this.maxHull;
    this.shield = this.maxShield;
    this.sprite.setPosition(this.spawnX, this.spawnY).setVisible(true);
    this.label.setVisible(true);
    this.bar.setVisible(true);
    this.alive = true;
    this.state = 'idle';
    this.neutral = this.tpl.neutral || false;
    // Сброс босс-механики
    this.phase = 1;
    this.aoeTimer = this.isBoss ? BOSS.aoeCooldownP1 : 0;
    this.sprite.clearTint();
  }

  // Фаза 2: ярость. Ускоряет огонь/движение, подкрашивает спрайт, торопит следующий AoE.
  enterEnrage() {
    this.phase = 2;
    this.sprite.setTint(BOSS.enrageTint);
    this.aoeTimer = Math.min(this.aoeTimer, 1500);
    this.scene.log(i18n.t('log.boss_enrage', { name: i18n.t(this.tpl.nameKey) }));
  }

  update(dt, player, playerInSafeZone, fireProjectile) {
    if (!this.alive) return;

    const now = this.scene.time.now;

    // Реген. Щит — у всех мобов со щитом; корпус — только у боссов (через 1 мин без урона).
    const sinceDmg = now - this.lastDamageAt;
    if (this.maxShield > 0 && sinceDmg > MOB_REGEN.shieldDelay && this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + (this.maxShield / MOB_REGEN.shieldFullSec) * dt);
    }
    if (this.isBoss && sinceDmg > MOB_REGEN.bossHullDelay && this.hull < this.maxHull) {
      this.hull = Math.min(this.maxHull, this.hull + this.maxHull * MOB_REGEN.bossHullPctPerSec * dt);
    }

    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);

    const playerStealthed = (this.scene._stealthEndTime || 0) > now;

    // Игрок в безопасной зоне, мёртв или в стелсе — моб НЕ атакует и сбрасывает агро.
    if (playerInSafeZone || !player.alive || playerStealthed) {
       this.state = 'idle';
    } else if (dist < this.tpl.aggro) {
       if (!this.neutral) this.state = 'aggro';
    } else if (dist > this.tpl.aggro * 1.6) {
       this.state = 'idle';
    }

    let moveSpeed = 0;
    if (this.state === 'aggro') {
      const fromAnchor = Phaser.Math.Distance.Between(this.x, this.y, this.spawnX, this.spawnY);
      
      // Логика "мясного щита" для дронов
      let targetX = player.x, targetY = player.y;
      if (this.leader && this.leader.alive) {
        // Пытаемся встать между игроком и лидером
        const angleToPlayer = Math.atan2(player.y - this.leader.y, player.x - this.leader.x);
        targetX = this.leader.x + Math.cos(angleToPlayer) * 120;
        targetY = this.leader.y + Math.sin(angleToPlayer) * 120;
      }

      this.heading = Math.atan2(targetY - this.y, targetX - this.x);

      // Фазовый переход боссов: корпус упал ниже порога → ярость (фаза 2).
      if (this.isBoss && this.phase === 1 && this.hull / this.maxHull <= BOSS.enrageAt) {
        this.enterEnrage();
      }
      const enraged = this.isBoss && this.phase >= 2;
      const fireMult = enraged ? BOSS.enrageFireMult : 1;
      const speedMult = enraged ? BOSS.enrageSpeedMult : 1;

      if (dist > this.tpl.range && fromAnchor < this.leash) {
        moveSpeed = this.tpl.speed * speedMult;
      }
      this.fireCooldown -= dt;
      if (dist <= this.tpl.range && fromAnchor < this.leash + 80 && this.fireCooldown <= 0) {
        this.fireCooldown = 1 / (this.tpl.fireRate * fireMult);
        fireProjectile(this, player.x, player.y);
      }

      // Телеграфированный AoE-залп боссов: каждые aoeCooldown сек кидаем круг под игрока.
      if (this.isBoss && dist < this.tpl.aggro) {
        this.aoeTimer -= dt * 1000;
        if (this.aoeTimer <= 0) {
          this.aoeTimer = this.phase >= 2 ? BOSS.aoeCooldownP2 : BOSS.aoeCooldownP1;
          this.scene.spawnBossAoe(this, player.x, player.y);
        }
      }
    } else {
      // Патруль или Сопровождение
      if (this.leader && this.leader.alive) {
        moveSpeed = this.escort(dt);
      } else {
        moveSpeed = this.patrol(now);
      }
    }

    if (moveSpeed > 0) {
      this.sprite.body.setVelocity(Math.cos(this.heading) * moveSpeed, Math.sin(this.heading) * moveSpeed);
    } else {
      this.sprite.body.setVelocity(0, 0);
    }

    this.sprite.rotation = this.heading + (this.tpl.artAngleOffset ?? ART_ANGLE_OFFSET);
    this.label.setPosition(this.x, this.y + this.sprite.displayHeight * 0.55);
    this.drawBar();
  }

  // Логика сопровождения: дроны держатся рядом с лидером (в пределах 5 корпусов)
  escort(dt) {
    const leaderDist = Phaser.Math.Distance.Between(this.x, this.y, this.leader.x, this.leader.y);
    const maxEscortDist = this.leader.tpl.displaySize * 5;
    
    // Если слишком далеко — летим к лидеру
    if (leaderDist > maxEscortDist) {
      this.heading = Math.atan2(this.leader.y - this.y, this.leader.x - this.x);
      return this.leader.tpl.speed * 1.2;
    }
    
    // Если рядом — кружим или просто летим за ним
    if (leaderDist > 150) {
      this.heading = Math.atan2(this.leader.y - this.y, this.leader.x - this.x);
      return this.leader.tpl.speed;
    }
    
    return 0;
  }

  // Патрульное движение. Возвращает скорость (0 = стоим/ждём).
  patrol(now) {
    if (now < this.patrolWaitUntil) return 0;
    const reached = this.patrolTarget &&
      Phaser.Math.Distance.Between(this.x, this.y, this.patrolTarget.x, this.patrolTarget.y) < 26;
    if (!this.patrolTarget || reached) {
      this.patrolTarget = this.pickPatrolTarget();
      // patrol/guard делают паузу на точке; roam летит без остановок
      if (this.behavior !== 'roam') { this.patrolWaitUntil = now + Phaser.Math.Between(500, 2000); return 0; }
    }
    this.heading = Math.atan2(this.patrolTarget.y - this.y, this.patrolTarget.x - this.x);
    return this.tpl.speed * (this.behavior === 'roam' ? 0.6 : 0.4); // спокойный круиз
  }

  pickPatrolTarget() {
    if (this.behavior === 'roam') {
      // Если заданы конкретные цели (например, базы) — курсируем по ним
      if (this.targets && this.targets.length > 0) {
        this.currentTargetIdx = ((this.currentTargetIdx ?? -1) + 1) % this.targets.length;
        return this.targets[this.currentTargetIdx];
      }

      // Иначе: Диагональ через карту
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
    // patrol/guard: случайная точка в радиусе вокруг якоря
    const ang = Phaser.Math.FloatBetween(-Math.PI, Math.PI);
    const r = Phaser.Math.FloatBetween(0, this.patrolRadius);
    return { x: this.spawnX + Math.cos(ang) * r, y: this.spawnY + Math.sin(ang) * r };
  }

  drawBar() {
    const w = 46, h = 4;
    const x = this.x - w / 2, y = this.y - this.tpl.displaySize * 0.6;
    this.bar.clear();
    this.bar.fillStyle(0x000000, 0.5); this.bar.fillRect(x - 1, y - 1, w + 2, h + 2);
    // корпус
    this.bar.fillStyle(COLORS.danger, 1);
    this.bar.fillRect(x, y, w * (this.hull / this.maxHull), h);
    // щит (если есть) — тонкая полоска сверху
    if (this.maxShield > 0) {
      this.bar.fillStyle(COLORS.primary, 1);
      this.bar.fillRect(x, y - 3, w * (this.shield / this.maxShield), 2);
    }
  }

  destroy() {
    this.sprite.destroy(); this.label.destroy(); this.bar.destroy();
  }
}
