import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { ART_ANGLE_OFFSET, COLORS, UI_RES } from '../constants.js';
import { SHIP_BY_KEY, SHIPS } from '../ships.js';

// Другой живой игрок в той же realtime-комнате (PvP-сектор, домашняя/PvE карта,
// групповой данж — см. GameScene._currentRealtimeRoomKey). В отличие от Player
// (локальный корабль) и Mob (клиент-локальный AI) — только рендер + интерполяция
// к позиции, которую авторитетно шлёт сервер (PvpRoomManager в server/main.py).
// Никакой физики, урона или боевой логики здесь нет — это чистый вид на другого игрока.
export default class RemotePlayer {
  constructor(scene, data, isHostile = true) {
    this.scene  = scene;
    this.userId = data.userId;
    this.name   = data.name || 'Пилот';
    this.alive  = true;
    this.isRemotePlayer = true; // отличаем от Mob/Player в таргетинге/огне GameScene без instanceof

    const shipDef = SHIP_BY_KEY[data.shipKey] || SHIPS[0];
    this.sprite = scene.add.image(data.x, data.y, shipDef.key).setDepth(50);
    const src = scene.textures.get(shipDef.key).getSourceImage();
    const scale = shipDef.displaySize / Math.max(src.width, src.height);
    this.sprite.setDisplaySize(Math.round(src.width * scale), Math.round(src.height * scale));
    this._artAngleOffset = shipDef.artAngleOffset ?? ART_ANGLE_OFFSET;
    // Тинт — враждебный красный в реальном PvP, дружелюбный голубой везде ещё
    // (домашняя карта/PvE/групповой данж — атаковать их нельзя, см. _isPvpSector).
    const tint = isHostile ? 0xff7a7a : 0x7ad4ff;
    this.sprite.setTint(tint);

    this.label = scene.add.text(data.x, data.y, this.name, {
      fontFamily: 'Inter, sans-serif', fontSize: '12px',
      color: isHostile ? '#ff8a8a' : '#8ad8ff', resolution: UI_RES,
    }).setOrigin(0.5, 0).setDepth(51);
    this.bar = scene.add.graphics().setDepth(51);

    this.heading    = data.heading ?? 0;
    this.hull       = data.hull ?? 1;
    this.maxHull    = data.maxHull ?? 1;
    this.shield     = data.shield ?? 0;
    this.maxShield  = data.maxShield ?? 0;

    // Целевая (авторитетная) точка от сервера — визуально доезжаем до неё лерпом
    // между пакетами (~10Hz), а не телепортируемся на каждое обновление.
    this._targetX = data.x;
    this._targetY = data.y;
    this._targetHeading = this.heading;
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  applyPos(x, y, heading) {
    this._targetX = x;
    this._targetY = y;
    if (heading !== undefined) this._targetHeading = heading;
  }

  // Полное состояние (используется на pvp_room_snapshot/pvp_player_joined, а
  // позже — на pvp_hit_result, когда сервер шлёт новый hull/shield жертвы).
  applyState(data) {
    if (data.x !== undefined) this.applyPos(data.x, data.y, data.heading);
    if (data.hull !== undefined) this.hull = data.hull;
    if (data.maxHull !== undefined) this.maxHull = data.maxHull;
    if (data.shield !== undefined) this.shield = data.shield;
    if (data.maxShield !== undefined) this.maxShield = data.maxShield;
  }

  update(dt) {
    // Та же идея, что camera lerp в Movement.js — плавное сближение с последней
    // авторитетной точкой, без собственного предсказания/физики.
    const t = Math.min(1, dt * 8);
    this.sprite.x += (this._targetX - this.sprite.x) * t;
    this.sprite.y += (this._targetY - this.sprite.y) * t;
    const dh = Phaser.Math.Angle.Wrap(this._targetHeading - this.heading);
    this.heading += dh * t;
    this.sprite.rotation = this.heading + this._artAngleOffset;
    this.label.setPosition(this.x, this.y + this.sprite.displayHeight * 0.55);
    this.drawBar();
  }

  // Позиция (this.x/y) меняется почти каждый кадр — setPosition — дешёвая
  // трансформация; содержимое бара (заливка hull/shield) перерисовываем только
  // когда реально изменилось (см. тот же паттерн в Mob.js:drawBar).
  drawBar() {
    const w = 46, h = 4;
    this.bar.setPosition(this.x, this.y - this.sprite.displayHeight * 0.6 - 10);
    const hullFrac   = Math.max(0, this.hull / this.maxHull);
    const shieldFrac = this.maxShield > 0 ? Math.max(0, this.shield / this.maxShield) : 0;
    // Числа, не строка — см. тот же фикс в Mob.js:drawBar (шаблонная строка на
    // сравнение = аллокация каждый кадр = давление на GC).
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
    this.sprite.destroy();
    this.label.destroy();
    this.bar.destroy();
  }
}
