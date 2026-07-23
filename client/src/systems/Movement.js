import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { HANDLING } from '../constants.js';
import { i18n } from '../i18n.js';

// Движение Andromeda5-style. Плавный доворот носа + разгон.
// ЛКМ по космосу — лететь в точку (без стрелки). Клик по миникарте — курс + стрелка;
// клик по стрелке — форсаж ×2 со сжиганием щита (в любой зоне).
export default class Movement {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;

    // Стрелка курса = индикатор АКТИВАЦИИ форсажа. Показывается только при навигации
    // с миникарты и пока НЕ ускоряемся; на время самого форсажа — скрыта (клик уже сделан).
    // Анимированный спрайт «переливается» (бегущий блик cruise_flow), без пульсации размером.
    // Арт смотрит вправо; аспект — из натурального размера кадра.
    this.courseArrow = scene.add.sprite(0, 0, 'arrow_cruise_anim')
      .setDepth(55).setVisible(false);
    this.courseArrow.play('cruise_flow');
    this.ARROW_AR = this.courseArrow.height / this.courseArrow.width;
    const w = 88;
    this.courseArrow.setDisplaySize(w, w * this.ARROW_AR).setAlpha(0.95);

    this.showArrow = false;
    this.arrivalThreshold = 16;
    this.steerMode = false;   // drift-steer: непрерывное следование за зажатым курсором (GameScene)
  }

  // showArrow=true для навигации с миникарты (дальний прыжок с возможностью форсажа).
  // Любой новый курс сбрасывает форсаж: с миникарты — снова синяя «нажми» стрелка.
  // Половина корпуса корабля — отступ от края мира, чтобы спрайт не вылезал за границу.
  worldMargin() { return (this.player.displaySize || 100) / 2; }

  // Границы клэмпа — обычно весь мир, но в лабиринте арены (arenaMaze) сектор
  // намного больше самого лабиринта (буфер до истинного края мира), и без более
  // тесного клэмпа корабль может выйти через "дверь" базы наружу и облететь ВЕСЬ
  // лабиринт по этому буферу, минуя его целиком (баг из диалога: "облет вокруг
  // лабиринта — не исправлено" — GameScene.createDungeonWalls считает точную
  // коробку лабиринта в this._arenaMazeBounds под этот самый клэмп).
  _clampBounds() {
    const b = this.scene._arenaMazeBounds;
    return b ? { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }
             : { x0: 0, y0: 0, x1: this.scene.worldWidth, y1: this.scene.worldHeight };
  }

  // Базы сидят ровно на краю тесной коробки лабиринта — их полное кольцо
  // безопасной зоны торчит за неё, так что прямой прямоугольный клэмп срезал
  // половину базы (баг из диалога: "базы наполовину за границей карты"). Если
  // точка лежит внутри пузыря какой-то базы — координата не трогается вовсе,
  // даже когда она снаружи тесной коробки: пузырь локальный (не тянется вдоль
  // всего периметра), так что кольцевой облёт всё равно закрыт, а сама база
  // становится полностью достижимой.
  _inArenaBaseBubble(x, y) {
    const bubbles = this.scene._arenaMazeBounds?.bubbles;
    return !!bubbles?.some(bb => Phaser.Math.Distance.Between(x, y, bb.x, bb.y) <= bb.r);
  }

  // Зажать позицию корабля в границах мира (камера теперь не ограничена миром).
  clampToWorld() {
    const m = this.worldMargin(), p = this.player;
    if (this._inArenaBaseBubble(p.sprite.x, p.sprite.y)) return;
    const b = this._clampBounds();
    p.sprite.x = Phaser.Math.Clamp(p.sprite.x, b.x0 + m, b.x1 - m);
    p.sprite.y = Phaser.Math.Clamp(p.sprite.y, b.y0 + m, b.y1 - m);
  }

  setWaypoint(x, y, showArrow = false) {
    if (this._inArenaBaseBubble(x, y)) {
      this.player.waypoint = { x, y };  // цель внутри пузыря базы — клэмп не нужен
    } else {
      const m = this.worldMargin(), b = this._clampBounds();
      this.player.waypoint = { x: Phaser.Math.Clamp(x, b.x0 + m, b.x1 - m), y: Phaser.Math.Clamp(y, b.y0 + m, b.y1 - m) };
    }
    this.showArrow = showArrow;
    this.player.boosting = false;
    if (!showArrow) this.courseArrow.setVisible(false);
  }

  toggleBoost() {
    // Клик по стрелке во время форсажа — выключаем форсаж и убираем стрелку.
    if (this.player.boosting) {
      this.player.boosting = false;
      this.showArrow = false;
      this.courseArrow.setVisible(false);
      return;
    }
    // Арена: носитель флага/груза не может форсировать (правило "форсаж не работает").
    if (this.player._arenaCarrier) { this.scene.log('🚫 Форсаж недоступен с грузом на борту'); return; }
    // В безопасной зоне форсаж бесплатный и доступен даже при нулевом щите.
    // Снаружи — нужен щит (иначе нечего жечь).
    const safe = this.scene.inSafeZone(this.player.x, this.player.y);
    if (!safe && this.player.shield <= 0) { this.scene.log(i18n.t('log.boost_no_shield')); return; }
    this.player.boosting = true;
  }

  isOverBoostChevron(worldX, worldY) {
    return this.courseArrow.visible &&
      this.courseArrow.getBounds().contains(worldX, worldY);
  }

  update(dt, inSafeZone) {
    const p = this.player;
    if (!p.alive) { this.courseArrow.setVisible(false); p.speed = 0; return; }
    // Арена: 5с обратный отсчёт перед боем — движение заблокировано (см. ArenaController.countdownActive)
    if (this.scene._arenaController?.countdownActive) {
      p.speed = 0;
      p.sprite.body?.setVelocity(0, 0);
      this.courseArrow.setVisible(false);
      return;
    }

    if (!p.waypoint) {
      p.speed = Math.max(0, p.speed - HANDLING.accel * dt); // плавное торможение
      p.boosting = false;
      this.showArrow = false;
      this.courseArrow.setVisible(false);
      // дрейф по инерции через velocity
      p.sprite.body.setVelocity(Math.cos(p.heading) * p.speed, Math.sin(p.heading) * p.speed);
      return;
    }

    const dx = p.waypoint.x - p.x;
    const dy = p.waypoint.y - p.y;
    const dist = Math.hypot(dx, dy);

    // Steer mode: stop at cursor but keep waypoint (next frame setWaypoint refreshes from cursor)
    if (this.steerMode && dist <= this.arrivalThreshold) {
      p.speed = 0;
      p.sprite.body.setVelocity(0, 0);
      return;
    }

    if (!this.steerMode && dist <= this.arrivalThreshold) {
      // Долетели — убираем стрелку и сбрасываем состояние
      p.waypoint = null;
      p.boosting = false;
      p.speed = 0;
      this.showArrow = false;
      this.courseArrow.setVisible(false);
      p.sprite.body.setVelocity(0, 0);
      return;
    }

    // Плавный доворот носа к курсу
    const targetHeading = Math.atan2(dy, dx);
    p.heading = Phaser.Math.Angle.RotateTo(p.heading, targetHeading, HANDLING.turnRate * (p.turnRateMult ?? 1) * dt);

    let desired = p.baseSpeed * (p.debuffSpeedMult ?? 1);
    if (p.boosting) {
      if (!inSafeZone) {
        p.shield -= p.maxShield * 0.10 * dt;
        if (p.shield <= 0) { p.shield = 0; p.boosting = false; this.scene.log(i18n.t('log.boost_no_shield')); }
      }
      if (p.boosting) desired *= p.cfg.boostMult;
    }

    // Proximity slowdown — dynamic stopping distance so high-speed ships actually stop
    if (this.steerMode && dist < 50) {
      desired *= Math.max(0.1, dist / 50);
    } else if (!this.steerMode) {
      // Physics stopping distance: v²/(2a). Use 1.4× safety margin.
      // Считаем от desired (целевая скорость крейсерского полёта ДО этого throttle),
      // а не от p.speed — иначе замкнутый цикл, который на форсаже выглядит как
      // ритмичное дёрганье, не связанное с частотой кадров: p.speed чуть падает от
      // самого throttle → stopDist (квадратично зависит от скорости) падает СИЛЬНЕЕ →
      // dist снова >= stopDist → throttle отпускает → скорость снова растёт → stopDist
      // снова растёт → throttle снова включается → повтор. desired — внешняя, не
      // зависящая от собственного torможения величина, цикл разрывается.
      const stopDist = Math.max(120, desired * desired / (2 * HANDLING.accel) * 1.4);
      if (dist < stopDist) desired *= Math.max(0, dist / stopDist);
    }

    if (p.speed < desired) p.speed = Math.min(desired, p.speed + HANDLING.accel * dt);
    else p.speed = Math.max(desired, p.speed - HANDLING.accel * dt);

    // УСТАНОВКА СКОРОСТИ ЧЕРЕЗ ФИЗИКУ (лечит пролёт сквозь стены)
    p.sprite.body.setVelocity(Math.cos(p.heading) * p.speed, Math.sin(p.heading) * p.speed);

    // Стрелка-активатор форсажа: только при навигации с миникарты и пока НЕ форсаж.
    // На время самого ускорения стрелка скрыта — активация уже произошла кликом по ней.
    // Если форсаж невозможен (щит=0 вне безопасной зоны — жечь нечего) — стрелку не показываем.
    // Спрайт сам переливается анимацией cruise_flow — здесь только позиция/поворот/видимость.
    const canBoost = inSafeZone || p.shield > 0;
    if (this.showArrow && !p.boosting && canBoost) {
      const a = this.courseArrow;
      const ahead = 90;
      a.setPosition(p.x + Math.cos(p.heading) * ahead, p.y + Math.sin(p.heading) * ahead);
      a.rotation = p.heading;                  // арт смотрит вправо → поворот = heading
      a.setVisible(true);
    } else {
      this.courseArrow.setVisible(false);      // нет курса с миникарты ИЛИ идёт форсаж → скрыта
    }
  }
}
