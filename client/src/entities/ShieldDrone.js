import { COLORS, ART_ANGLE_OFFSET } from '../constants.js';
import { SHIP_BY_KEY } from '../ships.js';
import { prerenderTex } from '../utils/prerenderTex.js';

// Щит-дрон — PvP-расходник (см. память roadmap-future, GameScene._useConsumable case
// 'shield_drone'). Чисто визуальная сущность на клиенте: hull/shield и весь исход боя —
// целиком серверная бухгалтерия (PvpPlayerState.shield_drone_*, server main.py
// _resolve_pvp_hit) — этот класс только рисует то, что сервер уже посчитал, и следует
// за кораблём владельца (сервер НЕ синкает позицию дрона отдельно, см. комментарий у
// SHIELD_DRONE_* в main.py).
//
// Позиция — "невидимая верёвка" (диалог с пользователем): нос дрона развёрнут по НОСУ
// владельца (facing — иначе на бою/circle-strafing дрон визуально "не совпадал" с
// ориентацией корабля, см. _ownerFacingAngle), а точка привязки (см. _ownerAngle/heading)
// прыгает между двумя местами в зависимости от скорости владельца:
//   - стоит на месте / летит небыстро → сбоку (SIDE_ANGLE от курса)
//   - форсаж / быстрый полёт (скорость выше FAST_SPEED_MULT × базовой) → строго позади
// Дистанция увеличена (FOLLOW_DIST, было 42px) — раньше спрайт дрона визуально сливался
// с кораблём владельца (диалог: "не нужно накладывать спрайт один на другой").
const FOLLOW_DIST = 90;
const SIDE_ANGLE = Math.PI / 2;
const FAST_SPEED_MULT = 1.4;
const DISPLAY_SIZE = 30;
// "Болтание" вместо жёсткой привязки (диалог: "не нужно делать его как на железном
// прицепе, может колебаться на 20-40px в любом направлении") — раз в WOBBLE_INTERVAL_MS
// дрон выбирает новую случайную точку в кольце [WOBBLE_MIN, WOBBLE_MAX] от номинальной
// позиции (сбоку/сзади) и медленно дрейфует к ней. MIN_DIST_FROM_OWNER — жёсткий пол
// дистанции ДО владельца (уже ПОСЛЕ применения болтания) — не даёт вильнуть на сам
// корабль, даже если болтание случайно указывает точно на него (диалог: "главное не
// налазить на корабль хозяина").
const WOBBLE_MIN = 20;
const WOBBLE_MAX = 40;
const WOBBLE_INTERVAL_MS = 1400;
const MIN_DIST_FROM_OWNER = 55;

export default class ShieldDrone {
  // owner — Player (свой корабль) либо RemotePlayer; оба дают .x/.y/.heading.
  constructor(scene, ownerUserId, owner, maxHull, maxShield, hull = maxHull, shield = maxShield) {
    this.scene = scene;
    this.ownerUserId = ownerUserId;
    this.owner = owner;
    this.alive = true;
    this.isShieldDrone = true; // отличаем от Mob/RemotePlayer в таргетинге/огне GameScene, тот же приём, что RemotePlayer.isRemotePlayer
    this.maxHull = maxHull;
    this.maxShield = maxShield;
    this.hull = hull;
    this.shield = shield;
    // corp владельца — для ally-fire проверки в _fireCannon/_fireLaser (тот же чек, что
    // и у RemotePlayer.corp), подставляется извне сразу после конструктора (см. GameScene).
    this.corp = owner?.corp ?? null;
    // Сторона "сбоку" — фиксируется один раз при спавне (не мигает туда-сюда сама по
    // себе), лево/право выбирается случайно для визуального разнообразия между активациями.
    this._sideSign = Math.random() < 0.5 ? 1 : -1;
    // Оценка скорости чужого владельца (RemotePlayer не даёт готового .speed, только
    // синканную позицию) — по дельте позиции между кадрами, см. _ownerSpeed.
    this._lastOwnerX = owner?.x ?? 0;
    this._lastOwnerY = owner?.y ?? 0;
    this._estSpeed = 0;
    // Болтание (см. WOBBLE_* выше) — текущее и целевое смещение относительно номинальной
    // точки, лениво инициализируются на первый update() (nextAt=0 форсирует выбор цели сразу).
    this._wobbleCurX = 0; this._wobbleCurY = 0;
    this._wobbleTargetX = 0; this._wobbleTargetY = 0;
    this._wobbleNextAt = 0;

    // 230×115-ish source → 2× oversample (targetMax = displaySize × 2, см. память
    // sprite_rendering_quality) — прямой setDisplaySize(30,30) на сыром ~800px исходнике
    // делал один WebGL-даунскейл огромного отношения (25×+) и выглядел мыльно (диалог:
    // "качество картинки на карте у дрона плохое").
    const hasTex = scene.textures.exists('shield_drone');
    const [sx, sy] = this._ownerPos();
    this.sprite = hasTex
      ? scene.add.image(sx, sy, prerenderTex(scene, 'shield_drone', DISPLAY_SIZE * 2, DISPLAY_SIZE * 2))
          .setDisplaySize(DISPLAY_SIZE, DISPLAY_SIZE).setDepth(41)
      : scene.add.circle(sx, sy, DISPLAY_SIZE / 2, 0x4dd0e1, 0.9).setDepth(41);
    // Арт этого спрайта нарисован носом ВНИЗ (см. промт в assets/consumables/
    // shield_drone_prompts.md) — ПРОТИВОПОЛОЖНО общей конвенции проекта "носом вверх"
    // (см. constants.js:474, ART_ANGLE_OFFSET=+90°) — поэтому здесь знак обратный
    // (-ART_ANGLE_OFFSET), иначе дрон летел развёрнутым на 180° (диалог: "развёрнут
    // задом наперёд").
    this.sprite.rotation = this._ownerFacingAngle() - ART_ANGLE_OFFSET;
    this.bar = scene.add.graphics().setDepth(42);
    this._lastHullSig = -1; this._lastShieldSig = -1;
    this.drawBar();
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  // Курс (направление ДВИЖЕНИЯ) — только для позиции (сбоку/сзади, см. _ownerPos), НЕ для
  // разворота спрайта (см. _ownerFacingAngle) — на позицию влияет то, куда корабль летит,
  // не куда смотрит нос.
  _ownerAngle() {
    if (!this.owner) return 0;
    return this.owner.heading ?? this.owner.facing ?? 0;
  }

  // Направление НОСА владельца — для разворота спрайта дрона (диалог: "дрон не всегда
  // разворачивается в том же направлении куда повёрнут хозяин — когда начинается бой, и
  // когда идёт радиальное движение боком" — при circle-strafing/наведении на цель facing
  // сильно расходится с heading, раньше дрон разворачивался по heading и визуально не
  // совпадал с ориентацией корабля). Свой игрок даёт настоящий facing; RemotePlayer не
  // синкает его отдельно — только heading как приближение.
  _ownerFacingAngle() {
    if (!this.owner) return 0;
    return this.owner.facing ?? this.owner.heading ?? 0;
  }

  // Текущая скорость владельца (px/с). Свой игрок даёт готовое Player.speed; чужой
  // (RemotePlayer) не синкает скорость отдельно — оцениваем по пройденному расстоянию
  // за кадр (см. update ниже, вызывается перед _ownerPos).
  _ownerSpeed() {
    if (typeof this.owner?.speed === 'number') return this.owner.speed;
    return this._estSpeed;
  }

  // Базовая (не форсированная) скорость владельца — порог для "быстрый полёт/форсаж".
  // Свой игрок — Player.baseSpeed напрямую; чужой — приближение по SHIP_BY_KEY его
  // текущего корабля (RemotePlayer._shipKey) — не учитывает чужие скилл-бонусы/бустеры,
  // но для порога "быстро относительно обычного" этого достаточно.
  _ownerBaseSpeed() {
    if (typeof this.owner?.baseSpeed === 'number') return this.owner.baseSpeed;
    const shipDef = this.owner?._shipKey ? SHIP_BY_KEY[this.owner._shipKey] : null;
    return shipDef?.baseSpeed ?? 20;
  }

  _ownerPos() {
    if (!this.owner) return [0, 0];
    const heading = this._ownerAngle();
    const speed = this._ownerSpeed();
    const isFast = speed > this._ownerBaseSpeed() * FAST_SPEED_MULT;
    const offsetAngle = isFast ? (heading + Math.PI) : (heading + this._sideSign * SIDE_ANGLE);
    return [this.owner.x + Math.cos(offsetAngle) * FOLLOW_DIST, this.owner.y + Math.sin(offsetAngle) * FOLLOW_DIST];
  }

  applyDamage({ hull, shield, maxHull, maxShield }) {
    if (hull !== undefined) this.hull = hull;
    if (shield !== undefined) this.shield = shield;
    if (maxHull !== undefined) this.maxHull = maxHull;
    if (maxShield !== undefined) this.maxShield = maxShield;
    this.drawBar();
  }

  drawBar() {
    const w = 36, h = 4;
    this.bar.setPosition(this.x, this.y - DISPLAY_SIZE * 0.7 - 8);
    const hullFrac = Math.max(0, this.hull / this.maxHull);
    const shieldFrac = this.maxShield > 0 ? Math.max(0, this.shield / this.maxShield) : 0;
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

  update(dt) {
    if (!this.owner) return;
    if (typeof this.owner.speed !== 'number' && dt > 0) {
      // Оценка скорости чужого владельца по дельте позиции (см. _ownerSpeed) — лёгкое
      // сглаживание (не сырое мгновенное значение), иначе дискретность pvp_pos-сэмплов
      // (~60мс, см. PvpClient) заставляла бы дрон дёргано скакать между "сбоку"/"сзади".
      const dist = Math.hypot(this.owner.x - this._lastOwnerX, this.owner.y - this._lastOwnerY);
      const instSpeed = dist / dt;
      this._estSpeed += (instSpeed - this._estSpeed) * Math.min(1, dt * 3);
      this._lastOwnerX = this.owner.x; this._lastOwnerY = this.owner.y;
    }

    const now = this.scene.time.now;
    if (now >= this._wobbleNextAt) {
      const ang = Math.random() * Math.PI * 2;
      const r = WOBBLE_MIN + Math.random() * (WOBBLE_MAX - WOBBLE_MIN);
      this._wobbleTargetX = Math.cos(ang) * r;
      this._wobbleTargetY = Math.sin(ang) * r;
      // Небольшой случайный разброс интервала — несколько дронов в одной комнате не
      // "дышат" синхронно в такт.
      this._wobbleNextAt = now + WOBBLE_INTERVAL_MS + Math.random() * 800;
    }
    // Медленный дрейф к цели болтания — резкий rate дал бы дёрганое "телепортирование"
    // между случайными точками вместо органичного покачивания.
    const wt = Math.min(1, dt * 1.2);
    this._wobbleCurX += (this._wobbleTargetX - this._wobbleCurX) * wt;
    this._wobbleCurY += (this._wobbleTargetY - this._wobbleCurY) * wt;

    let [tx, ty] = this._ownerPos();
    tx += this._wobbleCurX; ty += this._wobbleCurY;
    const dx = tx - this.owner.x, dy = ty - this.owner.y;
    const distFromOwner = Math.hypot(dx, dy);
    if (distFromOwner > 0.0001 && distFromOwner < MIN_DIST_FROM_OWNER) {
      const scale = MIN_DIST_FROM_OWNER / distFromOwner;
      tx = this.owner.x + dx * scale;
      ty = this.owner.y + dy * scale;
    }

    const t = Math.min(1, dt * 8); // тот же лерп-темп, что RemotePlayer.update — плавное следование, без телепорта на каждый кадр
    this.sprite.x += (tx - this.sprite.x) * t;
    this.sprite.y += (ty - this.sprite.y) * t;
    // facing (нос корабля), не heading (курс движения) — см. _ownerFacingAngle.
    const targetRot = this._ownerFacingAngle() - ART_ANGLE_OFFSET;
    // Плавный доворот носа (как Player.js/RemotePlayer.js), не мгновенный snap.
    this.sprite.rotation = Phaser_AngleLerp(this.sprite.rotation, targetRot, Math.min(1, dt * 10));
    this.drawBar();
  }

  destroy() {
    this.sprite.destroy();
    this.bar.destroy();
    this.alive = false;
  }
}

// Кратчайший поворот угла a → b на долю t, без зависимости от Phaser.Math.Angle.RotateTo
// (этот класс намеренно не импортирует весь Phaser — единственное, что нужно отсюда).
function Phaser_AngleLerp(a, b, t) {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  else if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
