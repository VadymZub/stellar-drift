import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';

// Single crystal deposit — plasmate or dungeon resource. Respawns within zone.
export default class PlasmateDeposit {
  constructor(scene, x, y, amount, zone, respawnMs = 10 * 60 * 1000, resourceType = 'plasmate') {
    this.scene            = scene;
    this.amount           = amount;
    this.zone             = zone;
    this.respawnMs        = respawnMs;
    this.alive            = true;
    this.resourceType     = resourceType;
    this.isPlasmate       = resourceType === 'plasmate';
    this.isDungeonResource = !this.isPlasmate;
    this.respawnAt        = 0;
    // Общий депозит комнаты (PvP-сектор/групповой данж, см. GameScene._applyPvpResourcesSnapshot) —
    // респавн диктует сервер (pvp_resource_respawned, всегда та же позиция, см.
    // GameScene._onPvpResourceRespawned), локальный таймер/зона ниже должны молчать,
    // иначе узел на миг "оживал" бы у каждого клиента в своей случайной точке зоны
    // раньше/вместо авторитетного события сервера.
    this.resourceId       = null;
    this._build(x, y);
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  _build(x, y) {
    if (this.isPlasmate) {
      this.sprite = this.scene.add.sprite(x, y, 'plasmate_crystal')
        .setDepth(36)
        .setDisplaySize(40, 40)
        .setBlendMode(Phaser.BlendModes.ADD)
        .play('plasmate_idle');
      this.sprite.anims.setProgress(Math.random());
    } else {
      // Данж/клановые ресурсы — своя статичная иконка на ресурс (см. BootScene.js:
      // текстура на ключе = resourceType), без анимации/ADD-блендинга — это не
      // светящаяся энергия, а предметная иконка.
      this.sprite = this.scene.add.sprite(x, y, this.resourceType)
        .setDepth(36)
        .setDisplaySize(40, 40);
    }
  }

  collect() {
    this.alive = false;
    this.sprite.setVisible(false);
    this.respawnAt = this.resourceId ? 0 : this.scene.time.now + this.respawnMs;
  }

  update(now) {
    if (!this.alive) {
      if (this.respawnAt > 0 && now >= this.respawnAt) this._respawn();
    }
  }

  _respawn() {
    const nx = Phaser.Math.Between(this.zone.xMin, this.zone.xMax);
    const ny = Phaser.Math.Between(this.zone.yMin, this.zone.yMax);
    this.sprite.setPosition(nx, ny).setVisible(true);
    if (this.isPlasmate) this.sprite.anims.setProgress(Math.random());
    this.alive = true;
    this.respawnAt = 0;
  }

  // Респавн общего депозита комнаты — сервер решает КОГДА и (одну и ту же) позицию,
  // см. класс-комментарий выше. Не переиспользует _respawn() (тот рандомит внутри zone).
  forceRespawn(x, y) {
    this.sprite.setPosition(x, y).setVisible(true);
    if (this.isPlasmate) this.sprite.anims.setProgress(Math.random());
    this.alive = true;
    this.respawnAt = 0;
  }

  destroy() {
    this.sprite.destroy();
  }
}
