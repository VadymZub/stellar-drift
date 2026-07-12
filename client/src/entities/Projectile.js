import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { PROJECTILE, PROJ_TYPES } from '../constants.js';

// Плазма-болт / спецснаряд. Может лететь прямо или с самонаведением (turnRate рад/сек).
// type: ключ из PROJ_TYPES (plasma|ion|acid|grav|emp). void — хитскан, не создаёт объект.
// effect: сохраняется из PROJ_TYPES[type].effect для применения при попадании в GameScene.
export default class Projectile {
  constructor(scene, owner, fromX, fromY, toX, toY, victim, damage, penetration, color, turnRate = 0, type = 'plasma', isCrit = false) {
    this.scene = scene;
    this.owner = owner;          // 'player' | 'mob'
    this.victim = victim;
    this.damage = damage;
    this.penetration = penetration;
    this.turnRate = turnRate;    // рад/сек; 0 = прямолинейный
    this.type = type;
    this.isCrit = isCrit;        // для showDamage — крит получает свой цвет числа

    const cfg = PROJ_TYPES[type] || PROJ_TYPES.plasma;
    this.effect = cfg.effect || null;
    this.effectCfg = cfg;
    const speed = cfg.speed || PROJECTILE.speed;
    this.hitRadius = cfg.hitR || PROJECTILE.hitRadius;
    this.life = turnRate > 0 ? 2.0 : (type === 'plasma' ? 1.6 : 1.8);

    const ang = Math.atan2(toY - fromY, toX - fromX);
    this.vx = Math.cos(ang) * speed;
    this.vy = Math.sin(ang) * speed;

    const big = owner === 'player';
    this.sprite = scene.add.image(fromX, fromY, 'bolt_sprite').setDepth(60);
    this.sprite.setTint(color ?? cfg.color).setBlendMode(Phaser.BlendModes.ADD);

    if (big) {
      this.sprite.setDisplaySize(42, 17);
    } else {
      const w = cfg.w || 32, h = cfg.h || 13;
      this.sprite.setDisplaySize(w, h);
    }
    this.sprite.rotation = ang;

    // Trail: игрок = cyan; у мобов каждый тип снаряда — свой цвет шлейфа,
    // подобранный к PROJ_TYPES[type].color (раньше только plasma получала трейл,
    // остальные летели голой капсулой без следа)
    const MOB_TRAILS = { plasma: 'trailRed', ion: 'trailIon', acid: 'trailAcid', grav: 'trailGrav', emp: 'trailEmp' };
    this.trail = owner === 'player' ? scene.trailCyan : (scene[MOB_TRAILS[type]] ?? null);
    this.dead = false;
  }

  update(dt) {
    if (this.dead) return true;

    // Самонаведение: плавно поворачиваем вектор скорости к цели
    if (this.turnRate > 0 && this.victim?.alive) {
      const tx = this.victim.x, ty = this.victim.y;
      const toTarget = Math.atan2(ty - this.sprite.y, tx - this.sprite.x);
      const curAng   = Math.atan2(this.vy, this.vx);
      let delta = Phaser.Math.Angle.Wrap(toTarget - curAng);
      const maxTurn = this.turnRate * dt;
      delta = Phaser.Math.Clamp(delta, -maxTurn, maxTurn);
      const newAng = curAng + delta;
      const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      this.vx = Math.cos(newAng) * speed;
      this.vy = Math.sin(newAng) * speed;
      this.sprite.rotation = newAng;
    }

    this.sprite.x += this.vx * dt;
    this.sprite.y += this.vy * dt;
    this.life -= dt;
    if (this.trail) this.trail.emitParticleAt(this.sprite.x, this.sprite.y);

    if (this.victim?.alive) {
      const d = Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, this.victim.x, this.victim.y);
      if (d < this.hitRadius) { this._hit(); return true; }
    }
    if (this.life <= 0) { this.destroy(); return true; }
    return false;
  }

  _hit() {
    // dmgType — только для снарядов мобов: перк Adaptive у игрока отслеживает
    // повторные попадания одного типа подряд, у мобов такого перка нет.
    const opts = this.owner === 'mob' ? { dmgType: this.type } : undefined;
    const res = this.victim.takeDamage(this.damage, this.penetration, opts);
    this.scene.onProjectileHit(this, res);
    this.destroy();
  }

  destroy() { this.dead = true; this.sprite.destroy(); }
}
