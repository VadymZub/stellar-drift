import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { PROJECTILE } from '../constants.js';

// Плазма-болт. Летит к позиции цели на момент выстрела; попадание — по близости к victim.
export default class Projectile {
  constructor(scene, owner, fromX, fromY, toX, toY, victim, damage, penetration, color) {
    this.scene = scene;
    this.owner = owner;          // 'player' | 'mob'
    this.victim = victim;        // сущность с {x, y, alive, takeDamage()}
    this.damage = damage;
    this.penetration = penetration;
    this.life = 1.6;             // сек до самоуничтожения

    const ang = Math.atan2(toY - fromY, toX - fromX);
    this.vx = Math.cos(ang) * PROJECTILE.speed;
    this.vy = Math.sin(ang) * PROJECTILE.speed;

    // Светящаяся капсула: additive-blend + тинт по владельцу, повёрнута по вектору полёта.
    const big = owner === 'player';
    this.sprite = scene.add.image(fromX, fromY, 'plasma_bolt').setDepth(60);
    this.sprite.setTint(color).setBlendMode(Phaser.BlendModes.ADD);
    this.sprite.setDisplaySize(big ? 42 : 32, big ? 17 : 13);
    this.sprite.rotation = ang;
    // Шлейф — общий эмиттер сцены по владельцу (cyan/red), эмитим точку за кадр.
    this.trail = owner === 'player' ? scene.trailCyan : scene.trailRed;
    this.dead = false;
  }

  // Возвращает true, если снаряд нужно удалить (попал или истёк).
  update(dt) {
    if (this.dead) return true;
    this.sprite.x += this.vx * dt;
    this.sprite.y += this.vy * dt;
    this.life -= dt;
    if (this.trail) this.trail.emitParticleAt(this.sprite.x, this.sprite.y);   // шлейф

    if (this.victim && this.victim.alive) {
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
