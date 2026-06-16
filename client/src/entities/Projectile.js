import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { PROJECTILE } from '../constants.js';

// Плазма-болт. Может лететь прямо или с самонаведением (turnRate рад/сек).
export default class Projectile {
  constructor(scene, owner, fromX, fromY, toX, toY, victim, damage, penetration, color, turnRate = 0) {
    this.scene = scene;
    this.owner = owner;          // 'player' | 'mob'
    this.victim = victim;
    this.damage = damage;
    this.penetration = penetration;
    this.turnRate = turnRate;    // рад/сек; 0 = прямолинейный
    this.life = turnRate > 0 ? 2.0 : 1.6;  // самонаводящиеся живут дольше

    const ang = Math.atan2(toY - fromY, toX - fromX);
    this.vx = Math.cos(ang) * PROJECTILE.speed;
    this.vy = Math.sin(ang) * PROJECTILE.speed;

    const big = owner === 'player';
    this.sprite = scene.add.image(fromX, fromY, 'bolt_sprite').setDepth(60);
    this.sprite.setTint(color).setBlendMode(Phaser.BlendModes.ADD);
    this.sprite.setDisplaySize(big ? 42 : 32, big ? 17 : 13);
    this.sprite.rotation = ang;
    this.trail = owner === 'player' ? scene.trailCyan : scene.trailRed;
    this.dead = false;
  }

  update(dt) {
    if (this.dead) return true;

    // Самонаведение: плавно поворачиваем вектор скорости к цели
    if (this.turnRate > 0 && this.victim?.alive) {
      const tx = this.victim.x, ty = this.victim.y;
      const toTarget = Math.atan2(ty - this.sprite.y, tx - this.sprite.x);
      const curAng   = Math.atan2(this.vy, this.vx);
      // Минимальный угол поворота с учётом wrap-around
      let delta = Phaser.Math.Angle.Wrap(toTarget - curAng);
      const maxTurn = this.turnRate * dt;
      delta = Phaser.Math.Clamp(delta, -maxTurn, maxTurn);
      const newAng = curAng + delta;
      this.vx = Math.cos(newAng) * PROJECTILE.speed;
      this.vy = Math.sin(newAng) * PROJECTILE.speed;
      this.sprite.rotation = newAng;
    }

    this.sprite.x += this.vx * dt;
    this.sprite.y += this.vy * dt;
    this.life -= dt;
    if (this.trail) this.trail.emitParticleAt(this.sprite.x, this.sprite.y);

    if (this.victim?.alive) {
      const d = Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, this.victim.x, this.victim.y);
      if (d < PROJECTILE.hitRadius) { this._hit(); return true; }
    }
    if (this.life <= 0) { this.destroy(); return true; }
    return false;
  }

  _hit() {
    const res = this.victim.takeDamage(this.damage, this.penetration);
    this.scene.onProjectileHit(this, res);
    this.destroy();
  }

  destroy() { this.dead = true; this.sprite.destroy(); }
}
